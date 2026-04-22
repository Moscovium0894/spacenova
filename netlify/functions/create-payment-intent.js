const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const FREE_SHIPPING_THRESHOLD = 150;
const SHIPPING_OPTIONS = {
  uk_standard: { label: 'UK Standard', amount: 4.99, freeThreshold: FREE_SHIPPING_THRESHOLD },
  uk_express: { label: 'UK Express', amount: 9.99 },
  eu_standard: { label: 'Europe Standard', amount: 12.99 },
  us_ca_standard: { label: 'USA & Canada Standard', amount: 14.99 },
  row_standard: { label: 'Rest of World Standard', amount: 17.99 }
};

function toPence(value) {
  return Math.round(Number(value || 0) * 100);
}

function computeDiscount(subtotal, promo) {
  if (!promo || !promo.type) return 0;
  if (promo.type === 'percent') return subtotal * (Number(promo.value || 0) / 100);
  if (promo.type === 'fixed') return Math.min(Number(promo.value || 0), subtotal);
  return 0;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body || '{}');
    const items = Array.isArray(data.items) ? data.items : [];
    const promo = data.promo || null;
    const shippingMethod = SHIPPING_OPTIONS[data.shippingMethod] ? data.shippingMethod : 'uk_standard';

    if (!items.length) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Basket is empty' })
      };
    }

    const subtotal = items.reduce((sum, item) => {
      const price = Number(item.price || 0);
      const qty = Number(item.qty || 0);
      return sum + price * qty;
    }, 0);

    const discount = computeDiscount(subtotal, promo);
    const discountedSubtotal = Math.max(0, subtotal - discount);

    const selectedShipping = SHIPPING_OPTIONS[shippingMethod];
    const shippingCost = selectedShipping.freeThreshold && discountedSubtotal >= selectedShipping.freeThreshold
      ? 0
      : selectedShipping.amount;

    const total = discountedSubtotal + shippingCost;
    const amount = toPence(total);

    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid order total' })
      };
    }

    const compactItems = items
      .map((item) => `${String(item.id || '').slice(0, 40)}::${Number(item.qty || 0)}::${Number(item.price || 0).toFixed(2)}::${String(item.name || '').replace(/[|:]/g, '').slice(0, 50)}`)
      .join('|')
      .slice(0, 500);

    const metadata = {
      items: compactItems,
      subtotal: subtotal.toFixed(2),
      discount: discount.toFixed(2),
      shipping_cost: shippingCost.toFixed(2),
      shipping_method: shippingMethod,
      shipping_label: selectedShipping.label,
      total: total.toFixed(2),
      promo_code: promo && promo.code ? String(promo.code) : ''
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        totals: {
          subtotal,
          discount,
          shipping: shippingCost,
          total,
          shippingMethod
        }
      })
    };
  } catch (err) {
    console.error('create-payment-intent error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message || 'Failed to create payment intent' })
    };
  }
};
