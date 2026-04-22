const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parseAmount(metaVal, fallbackMinor) {
  const n = Number(metaVal);
  if (Number.isFinite(n) && n >= 0) return n;
  return Number(fallbackMinor || 0) / 100;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
      return { statusCode: 400, body: 'Missing webhook signature or secret' };
    }

    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

    const stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (stripeEvent.type === 'payment_intent.succeeded') {
      const pi = stripeEvent.data.object;
      const shipping = pi.shipping || {};
      const shippingAddress = shipping.address || {};
      const metadata = pi.metadata || {};

      const parsedItems = String(metadata.items || '')
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

      const payload = {
        ref: pi.id,
        stripe_payment_id: pi.id,
        customer_name: shipping.name || null,
        email: pi.receipt_email || null,
        items: parsedItems,
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

      const { error } = await supabase
        .from('orders')
        .upsert([payload], { onConflict: 'ref' });

      if (error) {
        console.error('Failed to persist order from webhook:', error);
        return { statusCode: 500, body: 'Failed to persist order' };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('stripe-webhook error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }
};
