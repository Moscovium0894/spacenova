const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const { amount, currency = "gbp", items, customerEmail } = data;

    if (!amount || typeof amount !== "number" || amount < 50) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid amount — must be at least 50p" })
      };
    }

    // Build line-item description for Stripe metadata
    const itemSummary = Array.isArray(items)
      ? items.map(i => `${i.name} x${i.qty}`).join(", ").slice(0, 500)
      : "Spacenova order";

    const paymentIntentParams = {
      amount: Math.round(amount),
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        items: itemSummary
      }
    };

    if (customerEmail) {
      paymentIntentParams.receipt_email = customerEmail;
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };
  } catch (err) {
    console.error("create-payment-intent error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message || "Failed to create payment intent" })
    };
  }
};
