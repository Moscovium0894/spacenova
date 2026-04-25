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

function normaliseProduct(p) {
  const plateCount = inferPlateCount(p);
  const plateMap = normalisePlateMap(p, plateCount);
  const plateNames = normaliseStringArray(p, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], plateCount);
  const plateImages = normaliseStringArray(p, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], plateCount);
  const pricing = resolvePlatePricing(p, plateCount);

  return {
    id:             p.id != null ? String(p.id) : p.slug,
    slug:           p.slug,
    name:           p.name,
    category:       p.category,
    price:          pricing.setPrice,
    priceLabel:     p.price_label,
    short:          p.short,
    description:    p.description,
    note:           p.note,
    accent:         p.accent,
    size:           p.size,
    material:       p.material,
    pieces:         plateCount,
    plateCount,
    plateUnitPrice: pricing.unitPrice,
    plateSetPrice:  pricing.setPrice,
    panelHint:      p.panel_hint,
    image:          p.image,
    wallImage:      p.wall_image || null,
    wallSourceImage: p.wall_source_image || null,
    isCollection:   !!p.is_collection,
    isBundle:       !!p.is_bundle,
    isPublished:    p.is_published !== false,
    plateNames,
    plateImages,
    plateMap,
    panelNames:     plateNames,
    panelImages:    plateImages,
    panelMap:       plateMap
  };
}

function normaliseBundle(b) {
  return {
    slug:  b.slug,
    name:  b.name,
    price: b.price,
    items: Array.isArray(b.items) ? b.items : [],
    text:  b.text || null
  };
}

async function queryOptional(table, select, orderColumn) {
  const query = supabase.from(table).select(select);
  const result = orderColumn
    ? await query.order(orderColumn, { ascending: true })
    : await query;

  if (result.error) {
    console.warn(`load-catalogue ${table} warning:`, result.error.message || result.error);
    return [];
  }
  return result.data || [];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const [productsRes, bundles, featuredRows] = await Promise.all([
      supabase
        .from('products')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false }),
      queryOptional('bundles', '*', 'name'),
      queryOptional('featured_slugs', 'slug, sort_order', 'sort_order')
    ]);

    if (productsRes.error) {
      console.error('products query error:', productsRes.error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Failed to load products' })
      };
    }

    const products = (productsRes.data || []).map(normaliseProduct);
    const featuredSlugs = featuredRows
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map(row => row.slug)
      .filter(Boolean);

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=30, stale-while-revalidate=60'
      },
      body: JSON.stringify({
        products,
        bundles: bundles.map(normaliseBundle),
        featuredSlugs
      })
    };

  } catch (err) {
    console.error('load-catalogue fatal error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to load catalogue' })
    };
  }
};
