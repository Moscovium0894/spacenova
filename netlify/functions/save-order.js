const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseAmount(metaVal, fallbackMinor) {
  const n = Number(metaVal);
  if (Number.isFinite(n) && n >= 0) return n;
  return Number(fallbackMinor || 0) / 100;
}

function parseItems(metaItems) {
  return String(metaItems || '')
    .split('|')
    .filter(Boolean)
    .map((token) => {
      const [id, qty, price, name] = token.split('::');
      return {
        id: id || null,
        qty: Number(qty || 0),
        price: Number(price || 0),
        name: name || null
      };
    });
}

async function incrementPromoUse(promoCode) {
  if (!promoCode) return;
  const { data, error } = await supabase
    .from('promo_codes')
    .select('id,uses_count')
    .ilike('code', String(promoCode).trim())
    .single();

  if (error || !data) return;

  await supabase
    .from('promo_codes')
    .update({ uses_count: (data.uses_count || 0) + 1 })
    .eq('id', data.id);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { paymentIntentId } = JSON.parse(event.body || '{}');
    if (!paymentIntentId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing paymentIntentId' }) };
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi || pi.status !== 'succeeded') {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Payment not completed' }) };
    }

    const shipping = pi.shipping || {};
    const shippingAddress = shipping.address || {};
    const metadata = pi.metadata || {};

    const payload = {
      ref: pi.id,
      stripe_payment_id: pi.id,
      customer_name: shipping.name || null,
      email: pi.receipt_email || null,
      items: parseItems(metadata.items),
      subtotal: parseAmount(metadata.subtotal, pi.amount),
      discount: parseAmount(metadata.discount, 0),
      shipping_cost: parseAmount(metadata.shipping_cost, 0),
      shipping_method: metadata.shipping_label || metadata.shipping_method || null,
      delivery: {
        full_name: shipping.name || null,
        address1: shippingAddress.line1 || null,
        address2: shippingAddress.line2 || null,
        city: shippingAddress.city || null,
        state: shippingAddress.state || null,
        postcode: shippingAddress.postal_code || null,
        country: shippingAddress.country || null
      },
      address: {
        line1: shippingAddress.line1 || null,
        line2: shippingAddress.line2 || null,
        city: shippingAddress.city || null,
        postcode: shippingAddress.postal_code || null,
        country: shippingAddress.country || null
      },
      total: parseAmount(metadata.total, pi.amount),
      promo_code: metadata.promo_code || null,
      created_at: new Date((pi.created || Date.now() / 1000) * 1000).toISOString()
    };

    const { data: existingOrder } = await supabase
      .from('orders')
      .select('ref')
      .eq('ref', pi.id)
      .maybeSingle();

    const { error } = await supabase
      .from('orders')
      .upsert([payload], { onConflict: 'ref' });

    if (error) {
      console.error('save-order supabase error:', error);
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to persist order' }) };
    }

    if (!existingOrder) {
      await incrementPromoUse(metadata.promo_code || null);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ref: pi.id })
    };
  } catch (err) {
    console.error('save-order fatal error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to save order' }) };
  }
};
