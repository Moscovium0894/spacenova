const { createClient } = require('@supabase/supabase-js');
const {
  inferPlateCount,
  isMissingColumnError,
  normalisePlateMap,
  normaliseStringArray,
  resolvePlatePricing,
  stripAdvancedPlateFields
} = require('./plate-helpers');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function buildPayload(product) {
  const plateCount = inferPlateCount(product);
  const plateMap = normalisePlateMap(product, plateCount);
  const plateNames = normaliseStringArray(product, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], plateCount);
  const plateImages = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], plateCount);
  const pricing = resolvePlatePricing(product, plateCount);
  const parsedPrice = Number.isFinite(pricing.setPrice) ? pricing.setPrice : 0;

  return {
    slug:             product.slug,
    name:             product.name,
    category:         product.category || null,
    price:            parsedPrice,
    price_label:      product.price_label || product.priceLabel || null,
    short:            product.short || null,
    description:      product.description || null,
    note:             product.note || null,
    accent:           product.accent || null,
    size:             product.size || null,
    material:         product.material || null,
    pieces:           plateCount,
    plate_count:      plateCount,
    plate_unit_price: pricing.unitPrice,
    plate_set_price:  pricing.setPrice,
    panel_hint:       product.panel_hint || product.panelHint || null,
    image:            product.image || null,
    wall_image:       product.wall_image || product.wallImage || null,
    wall_source_image: product.wall_source_image || product.wallSourceImage || null,
    is_collection:    !!product.is_collection || !!product.isCollection,
    is_published:     product.is_published !== false && product.isPublished !== false,
    plate_names:      plateNames,
    plate_images:     plateImages,
    plate_map:        plateMap,
    panel_names:      plateNames,
    panel_images:     plateImages,
    panel_map:        plateMap,
    updated_at:       new Date().toISOString()
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
  const price = String(bundle.price || product.bundle_price || product.bundlePrice || product.price || '').trim();
  const items = splitBundleItems(bundle.items || product.bundle_items || product.bundleItems);
  const text = String(bundle.text || product.bundle_text || product.bundleText || product.short || product.description || '').trim();

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
  const result = await supabase
    .from('products')
    .upsert(payload, { onConflict: 'slug' });

  if (!result.error) return result;
  if (!isMissingColumnError(result.error)) return result;

  console.warn('save-product: advanced plate columns missing, falling back to legacy payload');
  return supabase
    .from('products')
    .upsert(stripAdvancedPlateFields(payload), { onConflict: 'slug' });
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

    if (isBundle && (!bundlePayload.slug || !bundlePayload.name || !bundlePayload.price)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required bundle fields (slug, name, price)' })
      };
    }

    const { error } = isBundle
      ? await upsertBundle(bundlePayload)
      : await upsertProduct(buildPayload(product));

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
