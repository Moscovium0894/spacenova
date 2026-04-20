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
    const order = JSON.parse(event.body || '{}');

    if (!order.ref || !order.items || !order.delivery) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid order payload' })
      };
    }

    const d = order.delivery;

    const { error } = await supabase
      .from('orders')
      .insert([{
        ref: order.ref,
        items: order.items,
        delivery: d,
        customer_name: `${d.firstName || ''} ${d.lastName || ''}`.trim(),
        email: d.email || null,
        address: {
          line1: d.address1 || null,
          line2: d.address2 || null,
          city: d.city || null,
          postcode: d.postcode || null,
          country: d.country || null
        },
        total: order.total ?? null,
        promo_code: order.promo_code || null,
        discount: order.discount || 0,
        created_at: order.createdAt || new Date().toISOString()
      }]);

    if (error) {
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
