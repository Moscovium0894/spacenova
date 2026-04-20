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
    const { password, products } = JSON.parse(event.body || '{}');

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (!Array.isArray(products) || products.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No products provided' }) };
    }

    const payload = products.map((product) => ({
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
      is_collection: !!product.isCollection,
      panel_names: product.panelNames || [],
      panel_images: product.panelImages || [],
      panel_map: product.panelMap || {},
      updated_at: new Date().toISOString()
    }));

    // Upsert all products in one call — updates existing slugs, inserts new ones
    const { error } = await supabase
      .from('products')
      .upsert(payload, { onConflict: 'slug' });

    if (error) {
      console.error('sync-catalogue upsert error:', error);
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    // Remove any products from the DB that are no longer in the creator
    const slugsToKeep = products.map((p) => p.slug);
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .not('slug', 'in', `(${slugsToKeep.map((s) => `"${s}"`).join(',')})`);

    if (deleteError) {
      // Non-fatal — log but still return ok since upsert succeeded
      console.warn('sync-catalogue delete stale warning:', deleteError);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, synced: products.length })
    };
  } catch (err) {
    console.error('sync-catalogue fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to sync catalogue' }) };
  }
};
