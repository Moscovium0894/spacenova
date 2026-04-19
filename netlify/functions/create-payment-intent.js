// netlify/functions/create-payment-intent.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const amount = data.amount; // in pence from your front-end
    const currency = data.currency || "gbp";

    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid amount" }),
      };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to create PaymentIntent" }),
    };
  }
};
