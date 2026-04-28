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

function escapeInValue(value) {
  return '"' + String(value).replace(/"/g, '\"') + '"';
}

function buildNotInList(values) {
  return '(' + values.map(escapeInValue).join(',') + ')';
}

async function softDeleteMissingProducts(keepValues, now) {
  if (!Array.isArray(keepValues)) return;

  const query = supabase.from('products').update({ deleted_at: now }).is('deleted_at', null);
  const result = keepValues.length === 0
    ? await query.not('slug', 'is', null)
    : await query.not('slug', 'in', buildNotInList(keepValues));

  if (result.error) throw result.error;
}

async function deleteMissingRows(table, key, keepValues) {
  if (!Array.isArray(keepValues)) return;

  if (keepValues.length === 0) {
    const result = await supabase.from(table).delete().not(key, 'is', null);
    if (result.error) throw result.error;
    return;
  }

  const result = await supabase
    .from(table)
    .delete()
    .not(key, 'in', buildNotInList(keepValues));

  if (result.error) throw result.error;
}

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

function buildPlateRows(product, plateCount, slug) {
  const names = normaliseStringArray(product, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], plateCount);
  const images = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], plateCount);
  return names.map((name, index) => ({
    product_slug: slug,
    position: index + 1,
    name: String(name || '').trim() || `Plate ${index + 1}`,
    image: String(images[index] || '').trim() || null
  }));
}

async function buildProductPayload(product, now) {
  const plateCount = inferPlateCount(product);
  const plateMap = normalisePlateMap(product, plateCount);
  const pricing = resolvePlatePricing(product, plateCount);
  const categoryId = await resolveCategoryId(product);

  return {
    plateRows: buildPlateRows(product, plateCount, product.slug),
    slug:             product.slug,
    name:             product.name,
    category_id:      categoryId,
    price:            pricing.setPrice,
    short_description: product.short_description || product.short || null,
    description:      product.description || null,
    note:             product.note || null,
    accent:           product.accent || null,
    size:             product.size || null,
    material:         product.material || null,
    plate_count:      plateCount,
    plate_unit_price: pricing.unitPrice,
    panel_hint:       product.panelHint || product.panel_hint || null,
    image:            product.image || null,
    wall_image:       product.wallImage || product.wall_image || null,
    wall_source_image: product.wallSourceImage || product.wall_source_image || null,
    is_collection:    !!product.isCollection || !!product.is_collection,
    is_bundle:        !!product.isBundle || !!product.is_bundle,
    in_stock:         product.inStock !== false && product.in_stock !== false,
    is_published:     product.isPublished !== false && product.is_published !== false,
    plate_map:        plateMap,
    updated_at:       now
  };
}


async function upsertProducts(payload) {
  if (!payload.length) return;

  const rows = payload.map(item => {
    const copy = { ...item };
    delete copy.plateRows;
    copy.deleted_at = null;
    return copy;
  });

  const result = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'slug' })
    .select('id,slug');
  if (result.error) throw result.error;

  const bySlug = {};
  (result.data || []).forEach(row => { if (row.slug) bySlug[row.slug] = row.id; });

  for (const product of payload) {
    const productId = bySlug[product.slug];
    if (!productId) continue;

    const del = await supabase.from('product_plates').delete().eq('product_id', productId);
    if (del.error) throw del.error;

    const plateRows = (product.plateRows || []).map(plate => ({
      product_id: productId,
      position: plate.position,
      name: plate.name,
      image: plate.image
    }));

    if (plateRows.length) {
      const ins = await supabase.from('product_plates').insert(plateRows);
      if (ins.error) throw ins.error;
    }
  }
}


async function filterExistingProductSlugs(slugs) {
  const unique = Array.from(new Set((Array.isArray(slugs) ? slugs : []).filter(Boolean)));
  if (!unique.length) return [];
  const { data, error } = await supabase.from('products').select('slug').in('slug', unique);
  if (error) throw error;
  const allowed = new Set((data || []).map(row => row.slug));
  return unique.filter(slug => allowed.has(slug));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const password = body.password;
    const hasProducts = Array.isArray(body.products);
    const hasBundles = Array.isArray(body.bundles);
    const hasWholesaleSources = Array.isArray(body.wholesaleSources);
    const hasFeaturedSlugs = Array.isArray(body.featuredSlugs);
    const products = hasProducts ? body.products : [];
    const bundles = hasBundles ? body.bundles : [];
    const wholesaleSources = hasWholesaleSources ? body.wholesaleSources : [];
    const featuredSlugs = hasFeaturedSlugs ? body.featuredSlugs : [];
    const config = body.config;

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const now = new Date().toISOString();

    const productPayload = (await Promise.all(products
      .map(product => buildProductPayload(product, now))))
      .filter(product => product.slug && product.name);

    const bundlePayload = bundles.map((bundle) => ({
      slug: bundle.slug,
      name: bundle.name,
      price: Number(bundle.price || 0),
      items: Array.isArray(bundle.items) ? bundle.items : [],
      text: bundle.text || null,
      updated_at: now
    })).filter((bundle) => bundle.slug && bundle.name && bundle.price);

    const wholesalePayload = wholesaleSources.map((source) => ({
      name: source.name,
      url: source.url || null,
      description: source.description || source.desc || null,
      best: source.best || null,
      product: source.product || source.Product || null,
      updated_at: now
    })).filter((source) => source.name);

    const validFeaturedSlugs = await filterExistingProductSlugs(featuredSlugs);
    const featuredPayload = validFeaturedSlugs.map((slug, i) => ({
      slug: slug,
      sort_order: i,
      updated_at: now
    }));

    if (hasProducts) {
      await upsertProducts(productPayload);
      if (!body.preserveMissing) {
        await softDeleteMissingProducts(productPayload.map((product) => product.slug), now);
      }
    }

    if (hasBundles) {
      if (bundlePayload.length > 0) {
        const result = await supabase.from('bundles').upsert(bundlePayload, { onConflict: 'slug' });
        if (result.error) throw result.error;
      }
      if (!body.preserveMissing) {
        await deleteMissingRows('bundles', 'slug', bundlePayload.map((bundle) => bundle.slug));
      }
    }

    if (hasWholesaleSources) {
      if (wholesalePayload.length > 0) {
        const result = await supabase.from('wholesale_sources').upsert(wholesalePayload, { onConflict: 'name' });
        if (result.error) throw result.error;
      }
      if (!body.preserveMissing) {
        await deleteMissingRows('wholesale_sources', 'name', wholesalePayload.map((source) => source.name));
      }
    }

    if (hasFeaturedSlugs) {
      const clearFeatured = await supabase.from('featured_slugs').delete().not('id', 'is', null);
      if (clearFeatured.error) throw clearFeatured.error;

      if (featuredPayload.length > 0) {
        const result = await supabase.from('featured_slugs').insert(featuredPayload);
        if (result.error) throw result.error;
      }
    }

    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const configPayload = Object.keys(config).map((key) => ({
        key: key,
        value: config[key],
        updated_at: now
      }));

      if (configPayload.length > 0) {
        const result = await supabase.from('store_config').upsert(configPayload, { onConflict: 'key' });
        if (result.error) throw result.error;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        synced: true,
        counts: {
          products: productPayload.length,
          bundles: bundlePayload.length,
          wholesaleSources: wholesalePayload.length,
          featuredSlugs: featuredPayload.length
        }
      })
    };
  } catch (err) {
    console.error('sync-catalogue fatal error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to sync catalogue' })
    };
  }
};
