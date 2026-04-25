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
    slug:            p.slug,
    name:            p.name,
    category:        p.category,
    price:           pricing.setPrice,
    priceLabel:      p.price_label,
    short:           p.short,
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
    image:           p.image,
    wallImage:       p.wall_image || null,
    wallSourceImage: p.wall_source_image || null,
    isCollection:    !!p.is_collection,
    isBundle:        !!p.is_bundle,
    isPublished:     p.is_published !== false,
    plateNames,
    plateImages,
    plateMap,
    panelNames:      plateNames,
    panelImages:     plateImages,
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
      .select('*')
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
