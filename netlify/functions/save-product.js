const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const { password, product } = JSON.parse(event.body || '{}');
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const payload = {
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    price_label: product.priceLabel,
    short: product.short,
    description: product.description,
    note: product.note,
    accent: product.accent,
    size: product.size,
    material: product.material,
    pieces: product.pieces,
    panel_hint: product.panelHint,
    image: product.image,
    is_collection: product.isCollection,
    panel_names: product.panelNames,
    panel_images: product.panelImages,
    panel_map: product.panelMap,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('products')
    .upsert(payload, { onConflict: 'slug' });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
