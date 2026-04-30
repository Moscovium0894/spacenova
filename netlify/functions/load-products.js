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
    slug:            p.slug,
    name:            p.name,
    category:        p.categories?.name || null,
    categorySlug:    p.categories?.slug || null,
    categoryId:      p.category_id || p.categories?.id || null,
    price:           pricing.setPrice,
    priceLabel:      p.price_label,
    short:           p.short_description || p.short,
    description:     p.description,
    note:            p.note,
    accent:          p.accent,
    size:            p.size,
    material:        p.material,
    pieces:          plateCount,
    plateCount,
    plateUnitPrice:  pricing.unitPrice,
    plateSetPrice:   pricing.setPrice,
    panelHint:       p.panel_hint,
    image:           getProductImageUrl(p.image),
    wallImage:       getProductImageUrl(p.wall_image),
    wallSourceImage: getProductImageUrl(p.wall_source_image),
    updatedAt:       p.updated_at || null,
    isCollection:    !!p.is_collection,
    // Bundles live in the `bundles` table and are loaded separately.
    isBundle:        false,
    inStock:         p.in_stock !== false,
    isPublished:     p.is_published !== false,
    plateNames:      plateData.names,
    plateImages:     plateData.images,
    productPlates:   plateData.rows,
    plateMap,
    panelNames:      plateData.names,
    panelImages:     plateData.images,
    panelMap:        plateMap
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .is('deleted_at', null)
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('load-products error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify((data || []).map(normaliseProduct))
    };
  } catch (err) {
    console.error('load-products fatal error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to load products' })
    };
  }
};
