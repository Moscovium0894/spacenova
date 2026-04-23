const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    // Password comes from the x-admin-password header (set by creator.html)
    const password = (event.headers && (
      event.headers['x-admin-password'] ||
      event.headers['X-Admin-Password']
    )) || '';

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const product = JSON.parse(event.body || '{}');

    if (!product || !product.slug || !product.name) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required product fields (slug, name)' })
      };
    }

    const payload = {
      slug:          product.slug,
      name:          product.name,
      category:      product.category      || null,
      price:         product.price         ?? null,
      price_label:   product.price_label   || product.priceLabel   || null,
      short:         product.short         || null,
      description:   product.description   || null,
      note:          product.note          || null,
      accent:        product.accent        || null,
      size:          product.size          || null,
      material:      product.material      || null,
      pieces:        product.pieces        || null,
      panel_hint:    product.panel_hint    || product.panelHint    || null,
      image:         product.image         || null,
      wall_image:    product.wall_image    || product.wallImage    || null,
      is_collection: !!product.is_collection || !!product.isCollection,
      is_bundle:     !!product.is_bundle    || !!product.isBundle,
      is_published:  product.is_published  !== false && product.isPublished !== false,
      panel_names:   Array.isArray(product.panel_names)  ? product.panel_names  : (Array.isArray(product.panelNames)  ? product.panelNames  : []),
      panel_images:  Array.isArray(product.panel_images) ? product.panel_images : (Array.isArray(product.panelImages) ? product.panelImages : []),
      panel_map:     product.panel_map || product.panelMap || {},
      updated_at:    new Date().toISOString()
    };

    const { error } = await supabase
      .from('products')
      .upsert(payload, { onConflict: 'slug' });

    if (error) {
      console.error('save-product supabase error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, slug: product.slug })
    };
  } catch (err) {
    console.error('save-product fatal:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to save product' })
    };
  }
};
