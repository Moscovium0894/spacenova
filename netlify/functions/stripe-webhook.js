const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setOrderStatusBySession(sessionId, status, paymentIntentId) {
  if (!sessionId) return;
  const payload = {
    status,
    stripe_session_id: sessionId,
    stripe_payment_intent: paymentIntentId || null
  };

  const bySession = await supabase
    .from('orders')
    .update(payload)
    .eq('stripe_session_id', sessionId)
    .select('id');

  if (bySession.error) throw bySession.error;
  if (Array.isArray(bySession.data) && bySession.data.length) return;

  if (paymentIntentId) {
    const byRef = await supabase
      .from('orders')
      .update(payload)
      .eq('ref', paymentIntentId);
    if (byRef.error) throw byRef.error;
  }
}

async function setOrderStatusByPaymentIntent(paymentIntentId, status) {
  if (!paymentIntentId) return;
  const { error } = await supabase
    .from('orders')
    .update({ status, stripe_payment_intent: paymentIntentId })
    .eq('stripe_payment_intent', paymentIntentId);

  if (error) throw error;
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

    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const paymentIntentId = session && session.payment_intent
        ? String(typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id)
        : null;

      await setOrderStatusBySession(session.id, 'paid', paymentIntentId);
    }

    if (stripeEvent.type === 'payment_intent.payment_failed') {
      const paymentIntent = stripeEvent.data.object;
      await setOrderStatusByPaymentIntent(paymentIntent.id, 'cancelled');
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('stripe-webhook error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }
};
