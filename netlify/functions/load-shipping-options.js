const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY  // public read — no auth needed
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=120, stale-while-revalidate=300'
  };

  try {
    const { data, error } = await supabase
      .from('shipping_options')
      .select('key, label, description, price, free_threshold, region, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('load-shipping-options error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load shipping options' }) };
    }

    const options = (data || []).map(o => ({
      key:           o.key,
      label:         o.label,
      description:   o.description || '',
      price:         parseFloat(o.price),
      freeThreshold: o.free_threshold ? parseFloat(o.free_threshold) : null,
      region:        o.region
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ options })
    };
  } catch (err) {
    console.error('load-shipping-options fatal:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load shipping options' }) };
  }
};
