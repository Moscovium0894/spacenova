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
    const { password, product } = JSON.parse(event.body || '{}');

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (!product || !product.slug || !product.name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required product fields' })
      };
    }

    const payload = {
      slug: product.slug,
      name: product.name,
      category: product.category || null,
      price: product.price ?? null,
      price_label: product.priceLabel || null,
      short: product.short || null,
      description: product.description || null,
      note: product.note || null,
      accent: product.accent || null,
      size: product.size || null,
      material: product.material || null,
      pieces: product.pieces || null,
      panel_hint: product.panelHint || null,
      image: product.image || null,
      wall_image: product.wallImage || null,   // ← NEW
      is_collection: !!product.isCollection,
      is_published: product.isPublished !== false,
      panel_names: Array.isArray(product.panelNames) ? product.panelNames : [],
      panel_images: Array.isArray(product.panelImages) ? product.panelImages : [],
      panel_map: product.panelMap || {},
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('products')
      .upsert(payload, { onConflict: 'slug' });

    if (error) {
      console.error('save-product error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, slug: product.slug })
    };
  } catch (err) {
    console.error('save-product fatal error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save product' })
    };
  }
};
