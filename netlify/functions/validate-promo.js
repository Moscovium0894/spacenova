const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const { code, subtotal } = JSON.parse(event.body || '{}');

    if (!code || typeof code !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No code provided' }) };
    }

    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('active', true)
      .single();

    if (error || !data) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Invalid or expired promo code' }) };
    }

    // Check expiry
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'This promo code has expired' }) };
    }

    // Check usage limit
    if (data.max_uses !== null && data.uses_count >= data.max_uses) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'This promo code has reached its usage limit' }) };
    }

    // Check minimum order value
    if (data.min_order_value && subtotal < data.min_order_value) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          valid: false,
          error: `Minimum order of £${data.min_order_value.toFixed(2)} required for this code`
        })
      };
    }

    // Increment usage count
    await supabase
      .from('promo_codes')
      .update({ uses_count: (data.uses_count || 0) + 1 })
      .eq('id', data.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        code: data.code,
        type: data.discount_type,      // 'percent' or 'fixed'
        value: data.discount_value,    // e.g. 15 (for 15% or £15)
        description: data.description
      })
    };
  } catch (err) {
    console.error('validate-promo error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
