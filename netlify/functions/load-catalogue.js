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
  const plateNames = normaliseStringArray(p, ['panel_names', 'panelNames', 'plate_names', 'plateNames'], plateCount);
  const plateImages = normaliseStringArray(p, ['panel_images', 'panelImages', 'plate_images', 'plateImages'], plateCount);
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

function normaliseBundleItem(item) {
  if (typeof item === 'string') return { slug: item, label: item };
  if (item && typeof item === 'object') {
    return {
      slug: item.slug || item.id || item.productSlug || item.name || '',
      label: item.name || item.label || item.slug || item.id || ''
    };
  }
  return { slug: '', label: '' };
}

function normaliseBundle(b, productLookup) {
  const items = (Array.isArray(b.items) ? b.items : [])
    .map(normaliseBundleItem)
    .filter(item => item.slug || item.label);
  const matchedProducts = items
    .map(item => productLookup[item.slug])
    .filter(Boolean);
  const firstProduct = matchedProducts[0] || null;
  const price = Number.parseFloat(b.price || 0) || 0;

  return {
    id:            b.slug,
    slug:          b.slug,
    name:          b.name,
    price,
    priceLabel:    price ? 'Bundle price' : '',
    short:         b.text || '',
    description:   b.text || (items.length ? `Includes ${items.map(item => item.label || item.slug).join(', ')}` : ''),
    image:         firstProduct && firstProduct.image ? firstProduct.image : '',
    wallImage:     firstProduct && firstProduct.wallImage ? firstProduct.wallImage : null,
    isCollection:  true,
    isBundle:      true,
    isPublished:   true,
    items,
    itemSlugs:     items.map(item => item.slug).filter(Boolean),
    itemNames:     items.map(item => {
      const product = productLookup[item.slug];
      return (product && product.name) || item.label || item.slug;
    }).filter(Boolean),
    text:          b.text || null,
    recordType:    'bundle'
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
    const productLookup = {};
    products.forEach(product => {
      if (product.slug) productLookup[product.slug] = product;
      if (product.id) productLookup[product.id] = product;
    });
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
        bundles: bundles.map(bundle => normaliseBundle(bundle, productLookup)),
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
