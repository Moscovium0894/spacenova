const fs = require('fs');

exports.handler = async () => {
  let products = [];
  const dbPath = '/tmp/products.json';
  try { products = JSON.parse(fs.readFileSync(dbPath, 'utf8') || '[]'); } catch(e) {}
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(products)
  };
};