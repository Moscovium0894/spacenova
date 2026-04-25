const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normaliseProduct(p) {
  return {
    id:           p.id != null ? String(p.id) : p.slug,
    slug:         p.slug,
    name:         p.name,
    category:     p.category,
    price:        p.price,
    priceLabel:   p.price_label,
    short:        p.short,
    description:  p.description,
    note:         p.note,
    accent:       p.accent,
    size:         p.size,
    material:     p.material,
    pieces:       p.pieces,
    panelHint:    p.panel_hint,
    image:        p.image,
    wallImage:    p.wall_image || null,
    isCollection: !!p.is_collection,
    isBundle:     false,
    isPublished:  p.is_published !== false,
    panelNames:   Array.isArray(p.panel_names)  ? p.panel_names  : [],
    panelImages:  Array.isArray(p.panel_images) ? p.panel_images : [],
    panelMap:     (p.panel_map && typeof p.panel_map === 'object')
                    ? p.panel_map
                    : { positions: [], transforms: [] }
  };
}

/*
  Artifacts table columns (actual schema):
    id bigint, name text, category text, price numeric,
    description text, image text, updated_at timestamptz
  No slug, no is_published, no desc alias.
*/
function normaliseArtifact(a) {
  return {
    id:          String(a.id || ''),
    name:        a.name        || '',
    category:    a.category    || '',
    price:       a.price       || 0,
    description: a.description || '',
    image:       a.image       || null,
    isArtifact:  true
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const [productsRes, artifactsRes] = await Promise.all([
      supabase
        .from('products')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('artifacts')
        .select('*')
        .order('name', { ascending: true })
    ]);

    if (productsRes.error) {
      console.error('products query error:', productsRes.error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Failed to load products' })
      };
    }

    const products  = (productsRes.data  || []).map(normaliseProduct);
    // Artifacts table might be empty — never treat empty as an error
    const artifacts = artifactsRes.error
      ? []
      : (artifactsRes.data || []).map(normaliseArtifact);

    if (artifactsRes.error) {
      console.warn('artifacts query warning (non-fatal):', artifactsRes.error.message);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=30, stale-while-revalidate=60'
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
