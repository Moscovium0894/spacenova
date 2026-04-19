const fs = require('fs');

exports.handler = async (event) => {
  const { password, product } = JSON.parse(event.body || '{}');
  const adminPw = process.env.ADMIN_PASSWORD;

  if (!adminPw || password !== adminPw) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let products = [];
  const dbPath = '/tmp/products.json';
  try { products = JSON.parse(fs.readFileSync(dbPath, 'utf8') || '[]'); } catch(e) {}

  const idx = products.findIndex(p => p.slug === product.slug);
  if (idx >= 0) products[idx] = product; else products.push(product);

  fs.writeFileSync(dbPath, JSON.stringify(products, null, 2));
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};