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
      const [id, qty, price, name, plateToken, plateCount, priceMode] = token.split('::');
      const selectedPlateIndexes = String(plateToken || '')
        .split(',')
        .filter(value => value !== '')
        .map(value => Number(value))
        .filter(Number.isFinite);
      const count = Number(plateCount || 0);
      return {
        id: id || null,
        qty: Number(qty || 0),
        price: Number(price || 0),
        name: name || null,
        selected_plate_indexes: selectedPlateIndexes,
        selected_plates: selectedPlateIndexes.map(index => ({ index, number: index + 1 })),
        plate_count: count || null,
        is_full_set: count > 0 && selectedPlateIndexes.length === count,
        price_mode: priceMode || null
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
    const { paymentIntentId, checkoutSessionId } = JSON.parse(event.body || '{}');
    if (!paymentIntentId && !checkoutSessionId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing paymentIntentId or checkoutSessionId' }) };
    }

    let resolvedPaymentIntentId = paymentIntentId;
    if (!resolvedPaymentIntentId && checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      resolvedPaymentIntentId = session && session.payment_intent
        ? String(session.payment_intent)
        : '';
    }

    if (!resolvedPaymentIntentId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'No payment intent found' }) };
    }

    const pi = await stripe.paymentIntents.retrieve(resolvedPaymentIntentId);
    if (!pi || pi.status !== 'succeeded') {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Payment not completed' }) };
    }

    const shipping = pi.shipping || {};
    const shippingAddress = shipping.address || {};
    const metadata = pi.metadata || {};

    const charge = pi.charges && Array.isArray(pi.charges.data) ? pi.charges.data[0] : null;
    const billing = (charge && charge.billing_details) || {};

    const payload = {
      ref: pi.id,
      customer_name: shipping.name || null,
      email: pi.receipt_email || billing.email || metadata.customer_email || null,
      items: parseItems(metadata.items),
      discount: parseAmount(metadata.discount, 0),
      shipping_type: metadata.shipping_label || metadata.shipping_method || null,
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
