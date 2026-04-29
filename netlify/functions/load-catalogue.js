const { createClient } = require('@supabase/supabase-js');
const {
  inferPlateCount,
  normalisePlateMap,
  resolvePlatePricing
} = require('./plate-helpers');
const { PRODUCT_SELECT, getProductImageUrl, mapProductPlates } = require('./product-data');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normaliseProduct(p) {
  const plateCount = inferPlateCount(p);
  const plateMap = normalisePlateMap(p, plateCount);
  const plateData = mapProductPlates(p, plateCount);
  const pricing = resolvePlatePricing(p, plateCount);

  return {
    id:             p.id != null ? String(p.id) : p.slug,
    slug:           p.slug,
    name:           p.name,
    category:       p.categories?.name || null,
    categorySlug:   p.categories?.slug || null,
    categoryId:     p.category_id || p.categories?.id || null,
    price:          pricing.setPrice,
    priceLabel:     p.price_label,
    short:          p.short_description || p.short,
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
    image:          getProductImageUrl(p.image),
    wallImage:      getProductImageUrl(p.wall_image),
    wallSourceImage: getProductImageUrl(p.wall_source_image),
    updatedAt:      p.updated_at || null,
    isCollection:   !!p.is_collection,
    isBundle:       !!p.is_bundle,
    // Default inStock to true if the column doesn't exist yet
    inStock:        p.in_stock !== false,
    isPublished:    p.is_published !== false,
    plateNames:     plateData.names,
    plateImages:    plateData.images,
    productPlates:  plateData.rows,
    plateMap,
    panelNames:     plateData.names,
    panelImages:    plateData.images,
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
  const allMatchedInStock = matchedProducts.length
    ? matchedProducts.every(product => product.inStock !== false)
    : true;
  const firstProduct = matchedProducts[0] || null;
  const itemImages = matchedProducts
    .map(p => p && p.image)
    .filter(Boolean)
    .slice(0, 4);
  const price = Number(b.price || 0) || 0;

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
    inStock:       allMatchedInStock,
    isPublished:   true,
    items,
    itemSlugs:     items.map(item => item.slug).filter(Boolean),
    itemNames:     items.map(item => {
      const product = productLookup[item.slug];
      return (product && product.name) || item.label || item.slug;
    }).filter(Boolean),
    itemImages,
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

async function queryFeaturedRows() {
  try {
    const { data, error } = await supabase
      .from('featured_slugs')
      .select('slug, sort_order, products!inner(slug,is_published,deleted_at)')
      .order('sort_order', { ascending: true })
      .is('products.deleted_at', null)
      .eq('products.is_published', true);

    if (error) {
      console.warn('load-catalogue featured_slugs warning:', error.message || error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('load-catalogue featured_slugs error:', err.message || err);
    return [];
  }
}

async function queryDealsRows() {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('deals')
      .select('slug, title, subtitle, badge, type, value, applies_to, product_slug, expires_at, sort_order, active')
      .eq('active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('sort_order', { ascending: true });

    if (error) {
      console.warn('load-catalogue deals warning:', error.message || error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('load-catalogue deals error:', err.message || err);
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Build the product select — try with in_stock, fall back without it
    let productsRes = await supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .is('deleted_at', null)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    // If the query failed (e.g. in_stock column missing), try a fallback select
    if (productsRes.error) {
      console.warn('load-catalogue products query error (trying fallback):', productsRes.error.message || productsRes.error);

      // Fallback: remove in_stock from select
      const FALLBACK_SELECT = PRODUCT_SELECT.replace(',in_stock', '').replace('in_stock,', '');
      productsRes = await supabase
        .from('products')
        .select(FALLBACK_SELECT)
        .is('deleted_at', null)
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (productsRes.error) {
        console.error('load-catalogue products fallback query error:', productsRes.error);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Failed to load products' })
        };
      }
    }

    const [bundles, featuredRows, dealsRows] = await Promise.all([
      queryOptional('bundles', '*', 'name'),
      queryFeaturedRows(),
      queryDealsRows()
    ]);

    const products = (productsRes.data || []).map(normaliseProduct);
    const productLookup = {};
    products.forEach(product => {
      if (product.slug) productLookup[product.slug] = product;
      if (product.id) productLookup[product.id] = product;
    });
    const featuredSlugs = featuredRows.map(row => row.slug).filter(Boolean);
    const deals = (dealsRows || []).map(deal => ({
      slug: deal.slug,
      title: deal.title,
      subtitle: deal.subtitle,
      badge: deal.badge,
      type: deal.type,
      value: deal.value,
      applies_to: deal.applies_to,
      product_slug: deal.product_slug,
      expires_at: deal.expires_at,
      sort_order: deal.sort_order,
      active: deal.active
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-store, max-age=0'
      },
      body: JSON.stringify({
        products,
        bundles: bundles.map(bundle => normaliseBundle(bundle, productLookup)),
        deals,
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
