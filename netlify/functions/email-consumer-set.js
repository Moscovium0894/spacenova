const nodemailer = require('nodemailer');
const { trackEvent } = require('./amplitude');

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024; // keep within typical provider limits

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, max-age=0'
    },
    body: JSON.stringify(body)
  };
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  if (!email) return false;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const toEmail = String(body.toEmail || '').trim();
  const filename = String(body.filename || 'spacenova-set.spacenova-set.json').trim();
  const contentType = String(body.contentType || 'application/json').trim();
  const setName = String(body.setName || '').trim();
  const fileBase64 = String(body.fileBase64 || '').trim();

  if (!isValidEmail(toEmail)) return json(400, { ok: false, error: 'Invalid toEmail' });
  if (!fileBase64) return json(400, { ok: false, error: 'Missing fileBase64' });

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch (e) {
    return json(400, { ok: false, error: 'Invalid base64' });
  }

  if (!buffer || !buffer.length) return json(400, { ok: false, error: 'Empty file' });
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return json(413, { ok: false, error: 'File too large to email. Download instead.' });
  }

  // If no email env vars are set, just acknowledge (avoids hard crash in dev)
  if (!process.env.SMTP_HOST) {
    console.log('Set export email (no SMTP configured):', { toEmail, filename, bytes: buffer.length, setName });
    await trackEvent('anonymous', 'Consumer Set Email Requested', { bytes: buffer.length });
    return json(200, { ok: true, queued: false });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    const subject = setName ? `Your Spacenova set file: ${setName}` : 'Your Spacenova set file';
    const text = [
      'Here is your Spacenova set file.',
      '',
      'To make it real: import it in the creator and then save/export in admin.',
      '',
      `Filename: ${filename}`,
      `Size: ${buffer.length} bytes`
    ].join('\n');

    await transporter.sendMail({
      from: `"Spacenova" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject,
      text,
      attachments: [
        {
          filename,
          content: buffer,
          contentType
        }
      ]
    });

    await trackEvent('anonymous', 'Consumer Set Email Sent', { bytes: buffer.length });
    return json(200, { ok: true, queued: false });
  } catch (err) {
    console.error('email-consumer-set error:', err);
    return json(500, { ok: false, error: 'Failed to send email' });
  }
};

