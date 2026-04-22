const nodemailer = require('nodemailer');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, subject, order, message } = body;
  if (!name || !email || !subject || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // If no email env vars are set, just acknowledge (avoids hard crash in dev)
  if (!process.env.SMTP_HOST) {
    console.log('Contact form submission (no SMTP configured):', { name, email, subject, order, message });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const subjectLabels = {
    order: 'Order Query',
    product: 'Product Question',
    returns: 'Returns & Refunds',
    shipping: 'Shipping',
    other: 'Other'
  };

  try {
    await transporter.sendMail({
      from: `"Spacenova Contact" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_EMAIL || 'hello@spacenova.co.uk',
      replyTo: email,
      subject: `[Contact] ${subjectLabels[subject] || subject} — ${name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Subject: ${subjectLabels[subject] || subject}`,
        order ? `Order: ${order}` : '',
        ``,
        message
      ].filter(Boolean).join('\n')
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Contact email error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send message' }) };
  }
};
