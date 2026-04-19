// netlify/functions/save-order.js
// Saves order details including delivery address and items.
// In production, write to a database (FaunaDB, Supabase, etc.)
// For now, we log the order and optionally write to /tmp (ephemeral on Netlify)

const fs = require('fs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const order = JSON.parse(event.body || '{}');

    // Validate essentials
    if (!order.ref || !order.items || !order.delivery) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order payload' }) };
    }

    const ordersPath = '/tmp/orders.json';
    let orders = [];
    try { orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8') || '[]'); } catch (e) {}

    orders.push(order);

    try { fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2)); } catch (e) {
      console.error('Could not write orders to /tmp:', e.message);
    }

    // Log for Netlify function log visibility
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
