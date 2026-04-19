const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const { password, product } = JSON.parse(event.body || '{}');
  const adminPw = process.env.ADMIN_PASSWORD;

  if (!adminPw || password !== adminPw) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const stripeId = 'aether_' + product.slug;
  const priceInPence = Math.round((product.price || 49.99) * 100);

  // Create or update Stripe product
  try {
    await Stripe.products.update(stripeId, {
      name: product.name,
      description: product.short || '',
      images: product.image ? [product.image] : [],
      metadata: { slug: product.slug, pieces: String(product.pieces || 6) }
    });
  } catch (e) {
    await Stripe.products.create({
      id: stripeId,
      name: product.name,
      description: product.short || '',
      images: product.image ? [product.image] : [],
      metadata: { slug: product.slug, pieces: String(product.pieces || 6) }
    });
  }

  // Archive old price, create new
  const prices = await Stripe.prices.list({ product: stripeId, active: true });
  if (prices.data[0]) {
    await Stripe.prices.update(prices.data[0].id, { active: false });
  }

  const newPrice = await Stripe.prices.create({
    product: stripeId,
    unit_amount: priceInPence,
    currency: 'gbp',
    lookup_key: product.slug,
    transfer_lookup_key: true
  });

  return { statusCode: 200, body: JSON.stringify({ ok: true, priceId: newPrice.id }) };
};