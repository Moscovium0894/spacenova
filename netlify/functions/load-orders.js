const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normaliseLegacyItems(items) {
  const list = Array.isArray(items) ? items : (items && typeof items === 'object' ? [items] : []);
  return list.map(item => ({
    slug: item.slug || item.id || null,
    name: item.name || item.slug || item.id || 'Unknown product',
    qty: Number(item.qty || item.quantity || 1) || 1,
    price: Number(item.price || item.unit_price || item.unitPrice || 0) || 0,
    snapshot: item.snapshot || item
  }));
}

function normaliseOrderItems(order) {
  if (Array.isArray(order.order_items) && order.order_items.length > 0) {
    return order.order_items.map(item => ({
      slug: item.slug,
      name: item.name,
      qty: Number(item.quantity || 1) || 1,
      price: Number(item.unit_price || 0) || 0,
      snapshot: item.snapshot || null,
      product_id: item.product_id || null
    }));
  }
  return normaliseLegacyItems(order.items);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    }

    const { data, error } = await supabase
      .from('orders')
      .select('ref,total,discount,shipping_type,promo_code,created_at,updated_at,email,customer_name,status,stripe_payment_intent,stripe_session_id,items,address,delivery,order_items(id,product_id,slug,name,quantity,unit_price,snapshot)')
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      console.error('load-orders query error:', error);
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to load orders' }) };
    }

    const rawOrders = Array.isArray(data) ? data : [];
    const orders = rawOrders.map(order => ({
      ...order,
      items: normaliseOrderItems(order)
    }));
    const now = Date.now();
    const monthMs = 1000 * 60 * 60 * 24 * 30;

    let totalRevenue = 0;
    let monthRevenue = 0;
    for (const o of orders) {
      const total = toNumber(o.total);
      totalRevenue += total;
      const ts = Date.parse(o.created_at || '');
      if (Number.isFinite(ts) && now - ts <= monthMs) monthRevenue += total;
    }

    const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        ok: true,
        summary: {
          orderCount: orders.length,
          totalRevenue,
          monthRevenue,
          avgOrderValue,
          paidOrders: orders.filter(order => order.status === 'paid').length
        },
        recentOrders: orders
      })
    };
  } catch (err) {
    console.error('load-orders fatal:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to load orders' }) };
  }
};
