exports.handler = async () => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

  if (!publishableKey || typeof publishableKey !== 'string' || !publishableKey.startsWith('pk_')) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Stripe publishable key is not configured' })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ publishableKey })
  };
};
