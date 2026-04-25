const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const { password, product } = JSON.parse(event.body || '{}');
  const adminPw = process.env.ADMIN_PASSWORD;

  if (!adminPw || password !== adminPw) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const stripeId = 'aether_' + product.slug;
  const plateCount = product.plate_count || product.plateCount || product.pieces || 6;
  const unitPrice = product.plate_unit_price || product.plateUnitPrice || null;
  const setPrice = product.plate_set_price || product.plateSetPrice || product.price || 49.99;
  const priceInPence = Math.round(setPrice * 100);

  // Create or update Stripe product
  try {
    await stripe.products.update(stripeId, {
      name: product.name,
      description: product.short || '',
      images: product.image ? [product.image] : [],
      metadata: {
        slug: product.slug,
        pieces: String(plateCount),
        plate_count: String(plateCount),
        plate_unit_price: unitPrice == null ? '' : String(unitPrice),
        plate_set_price: String(setPrice)
      }
    });
  } catch (e) {
    await stripe.products.create({
      id: stripeId,
      name: product.name,
      description: product.short || '',
      images: product.image ? [product.image] : [],
      metadata: {
        slug: product.slug,
        pieces: String(plateCount),
        plate_count: String(plateCount),
        plate_unit_price: unitPrice == null ? '' : String(unitPrice),
        plate_set_price: String(setPrice)
      }
    });
  }

  // Archive old price, create new
  const prices = await stripe.prices.list({ product: stripeId, active: true });
  if (prices.data[0]) {
    await stripe.prices.update(prices.data[0].id, { active: false });
  }

  const newPrice = await stripe.prices.create({
    product: stripeId,
    unit_amount: priceInPence,
    currency: 'gbp',
    lookup_key: product.slug,
    transfer_lookup_key: true
  });

  return { statusCode: 200, body: JSON.stringify({ ok: true, priceId: newPrice.id }) };
};
