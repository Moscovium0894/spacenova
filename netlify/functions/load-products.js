const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const products = (data || []).map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      price: p.price,
      priceLabel: p.price_label,
      short: p.short,
      description: p.description,
      note: p.note,
      accent: p.accent,
      size: p.size,
      material: p.material,
      pieces: p.pieces,
      panelHint: p.panel_hint,
      image: p.image,
      isCollection: p.is_collection,
      panelNames: p.panel_names || [],
      panelImages: p.panel_images || [],
      panelMap: p.panel_map || { positions: [], transforms: [] }
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(products)
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
