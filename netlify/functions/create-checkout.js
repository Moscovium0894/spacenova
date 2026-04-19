const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const { items } = JSON.parse(event.body || '{}');
  const lineItems = items.map(item => ({
    price: item.priceData || item.price,
    quantity: item.qty || 1
  }));

  const session = await Stripe.checkout.sessions.create({
    line_items: lineItems,
    mode: 'payment',
    success_url: process.env.SITE_URL + '/success.html?session={CHECKOUT_SESSION_ID}',
    cancel_url: process.env.SITE_URL + '/index.html'
  });

  return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
};