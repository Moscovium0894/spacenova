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

function escapeInValue(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

function buildNotInList(values) {
  return '(' + values.map(escapeInValue).join(',') + ')';
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

function buildProductPayload(product, now) {
  const plateCount = inferPlateCount(product);
  const plateMap = normalisePlateMap(product, plateCount);
  const plateNames = normaliseStringArray(product, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], plateCount);
  const plateImages = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], plateCount);
  const pricing = resolvePlatePricing(product, plateCount);

  return {
    slug:             product.slug,
    name:             product.name,
    category:         product.category || null,
    price:            pricing.setPrice,
    price_label:      product.priceLabel || product.price_label || null,
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
    panel_hint:       product.panelHint || product.panel_hint || null,
    image:            product.image || null,
    wall_image:       product.wallImage || product.wall_image || null,
    wall_source_image: product.wallSourceImage || product.wall_source_image || null,
    is_collection:    !!product.isCollection || !!product.is_collection,
    is_published:     product.isPublished !== false && product.is_published !== false,
    plate_names:      nullIfBlankArray(plateNames),
    plate_images:     nullIfBlankArray(plateImages),
    plate_map:        plateMap,
    panel_names:      nullIfBlankArray(plateNames),
    panel_images:     nullIfBlankArray(plateImages),
    panel_map:        plateMap,
    updated_at:       now
  };
}

function nullIfBlankArray(values) {
  const cleaned = (Array.isArray(values) ? values : [])
    .map(value => (value == null ? '' : String(value).trim()));
  return cleaned.some(Boolean) ? cleaned : null;
}

async function upsertProducts(payload) {
  if (!payload.length) return;

  const result = await supabase.from('products').upsert(payload, { onConflict: 'slug' });
  if (!result.error) return;
  if (!isMissingColumnError(result.error)) throw result.error;

  console.warn('sync-catalogue: advanced plate columns missing, falling back to legacy product payload');
  const legacyPayload = payload.map(stripAdvancedPlateFields);
  const legacyResult = await supabase.from('products').upsert(legacyPayload, { onConflict: 'slug' });
  if (legacyResult.error) throw legacyResult.error;
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

    const productPayload = products
      .map(product => buildProductPayload(product, now))
      .filter(product => product.slug && product.name);

    const bundlePayload = bundles.map((bundle) => ({
      slug: bundle.slug,
      name: bundle.name,
      price: bundle.price,
      items: Array.isArray(bundle.items) ? bundle.items : [],
      text: bundle.text || null,
      updated_at: now
    })).filter((bundle) => bundle.slug && bundle.name && bundle.price);

    const wholesalePayload = wholesaleSources.map((source) => ({
      name: source.name,
      url: source.url || null,
      description: source.description || source.desc || null,
      best: source.best || null,
      updated_at: now
    })).filter((source) => source.name);

    const featuredPayload = featuredSlugs.filter(Boolean).map((slug, i) => ({
      slug: slug,
      sort_order: i,
      updated_at: now
    }));

    if (hasProducts) {
      await upsertProducts(productPayload);
      if (!body.preserveMissing) {
        await deleteMissingRows('products', 'slug', productPayload.map((product) => product.slug));
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
