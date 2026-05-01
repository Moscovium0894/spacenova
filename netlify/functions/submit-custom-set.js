const nodemailer = require('nodemailer');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  if (!body.customerEmail || !body.name || !body.image) return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };

  if (!process.env.SMTP_HOST) return { statusCode: 200, body: JSON.stringify({ ok: true, queued: false }) };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const fileName = (body.name || 'custom-set').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() + '.snova';
  await transporter.sendMail({
    from: `"Spacenova Custom Builder" <${process.env.SMTP_USER}>`,
    to: process.env.CONTACT_EMAIL || 'hello@spacenova.co.uk',
    replyTo: body.customerEmail,
    subject: `[Custom Set Draft] ${body.name}`,
    text: `New custom set draft from ${body.customerEmail}.\nThis remains draft-only until explicitly created in admin creator.`,
    attachments: [{ filename: fileName, content: JSON.stringify(body, null, 2), contentType: 'application/json' }]
  });

  return { statusCode: 200, body: JSON.stringify({ ok: true, file: fileName }) };
};
