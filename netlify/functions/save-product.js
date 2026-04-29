const { createClient } = require('@supabase/supabase-js');
const {
  inferPlateCount,
  normalisePlateMap,
  normaliseStringArray,
  resolvePlatePricing
} = require('./plate-helpers');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resolveCategoryId(product) {
  const directId = Number(product.category_id || product.categoryId);
  if (Number.isFinite(directId) && directId > 0) return directId;

  const raw = String(product.category_slug || product.categorySlug || product.category || '').trim();
  if (!raw) return null;

  const { data, error } = await supabase
    .from('categories')
    .select('id,slug,name')
    .or(`slug.eq.${raw},name.eq.${raw}`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data && data.id ? data.id : null;
}

function buildPlates(product, plateCount) {
  const names = normaliseStringArray(product, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], plateCount);
  const images = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], plateCount);
  return names.map((name, index) => ({
    position: index + 1,
    name: String(name || '').trim() || `Plate ${index + 1}`,
    image: String(images[index] || '').trim() || null
  }));
}

async function buildPayload(product) {
  const plateCount = inferPlateCount(product);
  const plateMap = normalisePlateMap(product, plateCount);
  const categoryId = await resolveCategoryId(product);
  const pricing = resolvePlatePricing(product, plateCount);

  return {
    plateRows: buildPlates(product, plateCount),
    slug: product.slug,
    name: product.name,
    category_id: categoryId,
    price: Number.isFinite(pricing.setPrice) ? pricing.setPrice : null,
    short_description: product.short_description || product.short || null,
    description: product.description || null,
    note: product.note || null,
    accent: product.accent || null,
    size: product.size || null,
    material: product.material || null,
    plate_count: plateCount,
    plate_unit_price: pricing.unitPrice,
    panel_hint: product.panel_hint || product.panelHint || null,
    image: product.image || null,
    wall_image: product.wall_image || product.wallImage || null,
    wall_source_image: product.wall_source_image || product.wallSourceImage || null,
    is_collection: !!product.is_collection || !!product.isCollection,
    is_bundle: !!product.is_bundle || !!product.isBundle,
    in_stock: product.in_stock !== false && product.inStock !== false,
    is_published: product.is_published !== false && product.isPublished !== false,
    deleted_at: Object.prototype.hasOwnProperty.call(product, 'deleted_at')
      ? product.deleted_at
      : (Object.prototype.hasOwnProperty.call(product, 'deletedAt') ? product.deletedAt : null),
    plate_map: plateMap,
    updated_at: new Date().toISOString()
  };
}

function splitBundleItems(value) {
  if (Array.isArray(value)) return value.map(item => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') return item.slug || item.id || item.name || '';
    return '';
  }).filter(Boolean);

  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildBundlePayload(product) {
  const bundle = product.bundle && typeof product.bundle === 'object' ? product.bundle : {};
  const slug = String(bundle.slug || product.slug || '').trim();
  const name = String(bundle.name || product.name || '').trim();
  const price = Number(bundle.price || product.bundle_price || product.bundlePrice || product.price || 0);
  const items = splitBundleItems(bundle.items || product.bundle_items || product.bundleItems);
  const text = String(bundle.text || product.bundle_text || product.bundleText || product.short_description || product.short || product.description || '').trim();

  return {
    slug,
    name,
    price,
    items,
    text: text || null,
    updated_at: new Date().toISOString()
  };
}

async function upsertProduct(payload) {
  const productPayload = { ...payload };
  const plateRows = Array.isArray(productPayload.plateRows) ? productPayload.plateRows : [];
  delete productPayload.plateRows;

  const upsertResult = await supabase
    .from('products')
    .upsert(productPayload, { onConflict: 'slug' })
    .select('id,slug')
    .single();

  if (upsertResult.error) return upsertResult;

  const productId = upsertResult.data && upsertResult.data.id;
  if (!productId) return upsertResult;

  const del = await supabase.from('product_plates').delete().eq('product_id', productId);
  if (del.error) return { error: del.error };

  if (plateRows.length) {
    const rows = plateRows.map(row => ({ ...row, product_id: productId }));
    const ins = await supabase.from('product_plates').insert(rows);
    if (ins.error) return { error: ins.error };
  }

  return { data: upsertResult.data, error: null };
}

async function upsertBundle(payload) {
  return supabase
    .from('bundles')
    .upsert(payload, { onConflict: 'slug' });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const password = (event.headers && (
      event.headers['x-admin-password'] ||
      event.headers['X-Admin-Password']
    )) || '';

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const product = JSON.parse(event.body || '{}');

    if (!product || !product.slug || !product.name) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required product fields (slug, name)' })
      };
    }

    const isBundle = !!product.is_bundle || !!product.isBundle;
    const bundlePayload = isBundle ? buildBundlePayload(product) : null;

    if (isBundle && (!bundlePayload.slug || !bundlePayload.name || !Number.isFinite(bundlePayload.price) || bundlePayload.price <= 0)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required bundle fields (slug, name, price)' })
      };
    }

    const { error } = isBundle
      ? await upsertBundle(bundlePayload)
      : await upsertProduct(await buildPayload(product));

    if (error) {
      console.error('save-product supabase error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, slug: product.slug, type: isBundle ? 'bundle' : 'product' })
    };
  } catch (err) {
    console.error('save-product fatal:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to save product' })
    };
  }
};
