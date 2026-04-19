exports.handler = async (event) => {
  const { password } = JSON.parse(event.body || '{}');
  // Password comes ONLY from Netlify environment variable
  const correct = process.env.ADMIN_PASSWORD;
  if (!correct) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ADMIN_PASSWORD not set' }) };
  }
  if (password === correct) {
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }
  return { statusCode: 401, body: JSON.stringify({ ok: false }) };
};