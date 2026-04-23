const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normaliseProduct(p) {
  return {
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
    wallImage: p.wall_image || null,   // ← NEW
    isCollection: !!p.is_collection,
    isPublished: p.is_published !== false,
    panelNames: Array.isArray(p.panel_names) ? p.panel_names : [],
    panelImages: Array.isArray(p.panel_images) ? p.panel_images : [],
    panelMap:
      p.panel_map && typeof p.panel_map === 'object'
        ? p.panel_map
        : { positions: [], transforms: [] }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const [productsRes, bundlesRes, artifactsRes, wholesaleRes, featuredRes] =
      await Promise.all([
        supabase.from('products').select('*').order('updated_at', { ascending: false }),
        supabase.from('bundles').select('*').order('name', { ascending: true }),
        supabase.from('artifacts').select('*').order('name', { ascending: true }),
        supabase.from('wholesale_sources').select('*').order('name', { ascending: true }),
        supabase.from('featured_slugs').select('slug').order('sort_order', { ascending: true })
      ]);

    const errors = [productsRes, bundlesRes, artifactsRes, wholesaleRes, featuredRes]
      .map((res) => res && res.error)
      .filter(Boolean);

    if (errors.length) {
      console.error('load-catalogue query errors:', errors);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Failed to load catalogue' })
      };
    }

    const products = (productsRes.data || []).map(normaliseProduct);
    const bundles = (bundlesRes.data || []).map((b) => ({
      slug: b.slug,
      name: b.name,
      price: b.price,
      items: Array.isArray(b.items) ? b.items : [],
      text: b.text
    }));
    const artifacts = (artifactsRes.data || []).map((a) => ({
      name: a.name,
      category: a.category,
      price: a.price,
      desc: a.desc,
      image: a.image
    }));
    const wholesaleSources = (wholesaleRes.data || []).map((w) => ({
      name: w.name,
      url: w.url,
      desc: w.desc,
      best: w.best
    }));
    const featuredSlugs = (featuredRes.data || []).map((f) => f.slug).filter(Boolean);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ products, bundles, artifacts, wholesaleSources, featuredSlugs })
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
