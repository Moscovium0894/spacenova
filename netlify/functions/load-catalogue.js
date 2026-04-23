const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normaliseProduct(p) {
  return {
    slug:        p.slug,
    name:        p.name,
    category:    p.category,
    price:       p.price,
    priceLabel:  p.price_label,
    short:       p.short,
    description: p.description,
    note:        p.note,
    accent:      p.accent,
    size:        p.size,
    material:    p.material,
    pieces:      p.pieces,
    panelHint:   p.panel_hint,
    image:       p.image,
    wallImage:   p.wall_image    || null,
    isCollection: !!p.is_collection,
    isBundle:    !!p.is_bundle,
    isPublished: p.is_published !== false,
    panelNames:  p.panel_names   || [],
    panelImages: p.panel_images  || [],
    panelMap:    (p.panel_map && typeof p.panel_map === 'object')
                   ? p.panel_map
                   : { positions: [], transforms: [] }
  };
}

function normaliseArtifact(a) {
  return {
    slug:        a.slug  || null,
    id:          a.id    || null,
    name:        a.name  || '',
    category:    a.category || '',
    price:       a.price || 0,
    desc:        a.desc  || a.description || '',
    description: a.desc  || a.description || '',
    image:       a.image || null,
    isPublished: a.is_published !== false,
    isArtifact:  true
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const [productsRes, artifactsRes] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('artifacts').select('*').order('name', { ascending: true })
    ]);

    // artifacts table might not exist yet — treat that as empty, not an error
    const products  = (productsRes.data  || []).map(normaliseProduct);
    const artifacts = artifactsRes.error
      ? []
      : (artifactsRes.data || []).map(normaliseArtifact);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ products, artifacts })
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
