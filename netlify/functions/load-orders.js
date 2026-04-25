const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
      .select('ref,total,subtotal,discount,shipping_cost,shipping_method,promo_code,created_at,email,customer_name,items,address,delivery')
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      console.error('load-orders query error:', error);
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to load orders' }) };
    }

    const orders = Array.isArray(data) ? data : [];
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
          paidOrders: orders.length
        },
        recentOrders: orders
      })
    };
  } catch (err) {
    console.error('load-orders fatal:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to load orders' }) };
  }
};
