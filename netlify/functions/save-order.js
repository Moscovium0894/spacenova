const fs = require('fs'); // Keep for logging fallback if needed
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const order = JSON.parse(event.body || '{}');

    if (!order.ref || !order.items || !order.delivery) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order payload' }) };
    }

    const { data, error } = await supabase
      .from('orders')
      .insert([{
        ref: order.ref,
        items: order.items,
        delivery: order.delivery,
        total: order.total,
        createdAt: order.createdAt
      }]);

    if (error) {
      console.error('Supabase insert error:', error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save order' }) };
    }

    // Log for Netlify visibility
    console.log('NEW ORDER:', JSON.stringify({
      ref: order.ref,
      name: `${order.delivery.firstName} ${order.delivery.lastName}`,
      email: order.delivery.email,
      total: order.total,
      itemCount: order.items.length,
      createdAt: order.createdAt
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ref: order.ref })
    };
  } catch (err) {
    console.error('save-order error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save order' }) };
  }
};
