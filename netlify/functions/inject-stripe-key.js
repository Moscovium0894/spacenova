#!/usr/bin/env node
/**
 * inject-stripe-key.js
 * Run during Netlify build to replace %%STRIPE_PUBLISHABLE_KEY%%
 * placeholder in index.html with the actual env var value.
 *
 * Located at: netlify/functions/inject-stripe-key.js
 * Run via netlify.toml: node netlify/functions/inject-stripe-key.js
 *
 * Netlify runs build commands from the repo root, so __dirname will be
 * <repo-root>/netlify/functions — we resolve index.html relative to
 * process.cwd() (repo root) instead.
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

// process.cwd() is the repo root when Netlify runs the build command
const filePath = path.join(process.cwd(), 'index.html');

if (!fs.existsSync(filePath)) {
  console.error('[inject-stripe-key] ERROR: index.html not found at ' + filePath);
  process.exit(1);
}

let html = fs.readFileSync(filePath, 'utf8');

const placeholder = '%%STRIPE_PUBLISHABLE_KEY%%';
if (!html.includes(placeholder)) {
  console.warn('[inject-stripe-key] Warning: placeholder not found in index.html — already injected or placeholder missing?');
} else {
  html = html.replace(new RegExp(placeholder.replace(/[%]/g, '\\%'), 'g'), pk);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log('[inject-stripe-key] ✓ Stripe publishable key injected into index.html');
}
