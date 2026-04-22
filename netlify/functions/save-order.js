const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_SHIPPING_TYPES = new Set([
  'uk_standard', 'uk_express', 'eu_standard', 'us_ca_standard', 'row_standard'
]);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const order = JSON.parse(event.body || '{}');

    // Validation
    if (!order.ref) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: ref' }) };
    }
    if (!order.items || !Array.isArray(order.items) || !order.items.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: items' }) };
    }
    if (!order.delivery) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: delivery' }) };
    }
    if (!order.shipping_type) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: shipping_type' }) };
    }
    if (!VALID_SHIPPING_TYPES.has(order.shipping_type)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid shipping_type: ' + order.shipping_type }) };
    }

    const d = order.delivery;

    const { error } = await supabase
      .from('orders')
      .insert([{
        ref: order.ref,
        items: order.items,
        delivery: d,
        customer_name: order.customer_name || `${d.firstName || ''} ${d.lastName || ''}`.trim(),
        email: order.email || d.email || null,
        address: order.address || {
          line1: d.address1 || null,
          line2: d.address2 || null,
          city: d.city || null,
          postcode: d.postcode || null,
          country: d.country || null
        },
        total: order.total ?? null,
        promo_code: order.promo_code || null,
        discount: order.discount || 0,
        shipping_type: order.shipping_type,
        created_at: order.created_at || new Date().toISOString()
      }]);

    if (error) {
      // Unique constraint violation on ref — order already saved, treat as success
      if (error.code === '23505') {
        console.log('Duplicate order ref ignored:', order.ref);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, ref: order.ref, duplicate: true })
        };
      }
      console.error('Supabase insert error:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message || 'Failed to save order' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ref: order.ref })
    };
  } catch (err) {
    console.error('save-order error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save order' })
    };
  }
};
