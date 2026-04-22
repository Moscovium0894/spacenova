#!/usr/bin/env node
/**
 * inject-stripe-key.js
 * Run during Netlify build to replace %%STRIPE_PUBLISHABLE_KEY%%
 * placeholder in index.html with the actual env var value.
 *
 * Add to netlify.toml:
 *   [build]
 *     command = "node inject-stripe-key.js"
 */

const fs = require('fs');
const path = require('path');

const pk = process.env.STRIPE_PUBLISHABLE_KEY;

if (!pk) {
  console.error('[inject-stripe-key] ERROR: STRIPE_PUBLISHABLE_KEY env var is not set.');
  process.exit(1);
}

if (!pk.startsWith('pk_')) {
  console.error('[inject-stripe-key] ERROR: STRIPE_PUBLISHABLE_KEY does not look like a valid Stripe key (should start with pk_).');
  process.exit(1);
}

const filePath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

const placeholder = '%%STRIPE_PUBLISHABLE_KEY%%';
if (!html.includes(placeholder)) {
  console.warn('[inject-stripe-key] Warning: placeholder not found in index.html — already injected?');
} else {
  html = html.replace(new RegExp(placeholder, 'g'), pk);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log('[inject-stripe-key] ✓ Stripe publishable key injected into index.html');
}
