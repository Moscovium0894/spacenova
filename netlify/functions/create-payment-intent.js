const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { amount, currency = 'gbp', items } = JSON.parse(event.body || '{}');

    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid amount' })
      };
    }

    const paymentIntent = await Stripe.paymentIntents.create({
      amount,           // in pence, e.g. 34999 = £349.99
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        items: JSON.stringify((items || []).map(i => `${i.name} x${i.qty}`).join(', ')).substring(0, 500)
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };
  } catch (err) {
    console.error('PaymentIntent error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
