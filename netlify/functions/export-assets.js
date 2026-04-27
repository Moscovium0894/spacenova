const archiver = require('archiver');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BUCKET = 'product-images';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const password = getPassword(event, body);
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return json(401, { ok: false, error: 'Unauthorized' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: 'Missing Supabase environment variables' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const bucket = process.env.SUPABASE_BUCKET || DEFAULT_BUCKET;

    const mode = String(body.mode || 'all').trim().toLowerCase();
    const requestedFilename = String(body.filename || '').trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = safeFilename(requestedFilename || `spacenova-export-${timestamp}.zip`);

    const explicitEntries = Array.isArray(body.entries) ? body.entries : null;
    const entries = explicitEntries
      ? sanitiseEntries(explicitEntries)
      : await buildAllEntries({ supabase, bucket, includeBundles: mode !== 'products-only' });

    if (!entries.length) {
      return json(400, { ok: false, error: 'No assets selected' });
    }

    const { buffer, skipped } = await buildZip(entries);
    const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
    const storagePath = `downloads/${filename}`;

    const upload = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType: 'application/zip',
      cacheControl: '0',
      upsert: true,
    });
    if (upload.error) throw upload.error;

    return json(200, {
      ok: true,
      filename,
      bytes: buffer.length,
      fileCount: entries.length,
      skipped,
      storagePath,
      url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}?v=${hash}`,
    });
  } catch (err) {
    console.error('export-assets fatal:', err);
    return json(500, { ok: false, error: err.message || 'Failed to export assets' });
  }
};

function getPassword(event, body) {
  return (
    (event.headers &&
      (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) ||
    body.password ||
    ''
  );
}

function safeFilename(value) {
  const cleaned = String(value || 'export.zip')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
  return cleaned.toLowerCase().endsWith('.zip') ? cleaned : `${cleaned}.zip`;
}

function safeZipPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  const parts = raw
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p !== '.' && p !== '..');
  return parts.join('/');
}

function sanitiseEntries(entries) {
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const url = String(entry.url || '').trim();
    const zipPath = safeZipPath(entry.zipPath || entry.path || entry.name || '');
    if (!url || !zipPath) continue;
    out.push({ url, zipPath });
  }
  return dedupeByPath(out);
}

function dedupeByPath(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (seen.has(entry.zipPath)) continue;
    seen.add(entry.zipPath);
    out.push(entry);
  }
  return out;
}

function normaliseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function extensionFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\.([a-z0-9]{1,5})$/i);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch (err) {
    const match = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{1,5})$/i);
    if (match) return `.${match[1].toLowerCase()}`;
  }
  return fallback || '.jpg';
}

async function buildAllEntries({ supabase, bucket, includeBundles }) {
  const [productsRes, bundlesRes, mockupsRes] = await Promise.all([
    supabase.from('products').select('*').order('created_at', { ascending: false }),
    includeBundles ? supabase.from('bundles').select('*').order('name', { ascending: true }) : Promise.resolve({ data: [] }),
    supabase.storage.from(bucket).list('mockups', { limit: 1000 }),
  ]);

  if (productsRes.error) throw productsRes.error;
  const products = productsRes.data || [];
  const bundles = (bundlesRes && !bundlesRes.error ? bundlesRes.data : []) || [];

  const productLookup = {};
  products.forEach((p) => {
    if (p && p.slug) productLookup[p.slug] = p;
  });

  const entries = [];

  // Mockups folder (all)
  if (Array.isArray(mockupsRes.data)) {
    for (const item of mockupsRes.data) {
      const name = item.name;
      if (!name) continue;
      const storagePath = `mockups/${name}`;
      entries.push({
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`,
        zipPath: `mockups/${name}`,
      });
    }
  }

  // Products (series + collections)
  for (const p of products) {
    const slug = String(p.slug || '').trim();
    if (!slug) continue;
    const typeFolder = p.is_collection ? 'collections' : 'series';

    const mainImageUrl = String(p.image || '').trim();
    if (mainImageUrl) {
      entries.push({
        url: mainImageUrl,
        zipPath: `${typeFolder}/${slug}/main${extensionFromUrl(mainImageUrl, '.jpg')}`,
      });
    }

    const plateNames = normaliseArray(p.plate_names);
    const plateImages = normaliseArray(p.plate_images);
    for (let i = 0; i < plateImages.length; i += 1) {
      const url = String(plateImages[i] || '').trim();
      if (!url) continue;
      const name = safeSegment(plateNames[i] || `plate-${String(i + 1).padStart(2, '0')}`);
      entries.push({
        url,
        zipPath: `${typeFolder}/${slug}/plate-images/${String(i + 1).padStart(2, '0')}-${name}${extensionFromUrl(url, '.png')}`,
      });
    }

    // Exported plate PNGs (creator export)
    try {
      const listRes = await supabase.storage.from(bucket).list(`exports/${slug}`, { limit: 1000 });
      if (Array.isArray(listRes.data)) {
        for (const item of listRes.data) {
          const file = item.name;
          if (!file) continue;
          const storagePath = `exports/${slug}/${file}`;
          entries.push({
            url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`,
            zipPath: `${typeFolder}/${slug}/plate-exports/${file}`,
          });
        }
      }
    } catch (err) {
      // ignore
    }
  }

  // Bundles -> nested product folders
  if (includeBundles) {
    for (const b of bundles) {
      const bundleSlug = String(b.slug || '').trim();
      if (!bundleSlug) continue;
      const itemSlugs = normaliseArray(b.items)
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object') return String(item.slug || item.id || item.name || '').trim();
          return '';
        })
        .filter(Boolean);

      for (const itemSlug of itemSlugs) {
        const p = productLookup[itemSlug];
        if (!p) continue;

        const mainImageUrl = String(p.image || '').trim();
        if (mainImageUrl) {
          entries.push({
            url: mainImageUrl,
            zipPath: `bundles/${bundleSlug}/${itemSlug}/main${extensionFromUrl(mainImageUrl, '.jpg')}`,
          });
        }

        const plateNames = normaliseArray(p.plate_names);
        const plateImages = normaliseArray(p.plate_images);
        for (let i = 0; i < plateImages.length; i += 1) {
          const url = String(plateImages[i] || '').trim();
          if (!url) continue;
          const name = safeSegment(plateNames[i] || `plate-${String(i + 1).padStart(2, '0')}`);
          entries.push({
            url,
            zipPath: `bundles/${bundleSlug}/${itemSlug}/plate-images/${String(i + 1).padStart(2, '0')}-${name}${extensionFromUrl(url, '.png')}`,
          });
        }

        try {
          const listRes = await supabase.storage.from(bucket).list(`exports/${itemSlug}`, { limit: 1000 });
          if (Array.isArray(listRes.data)) {
            for (const item of listRes.data) {
              const file = item.name;
              if (!file) continue;
              const storagePath = `exports/${itemSlug}/${file}`;
              entries.push({
                url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`,
                zipPath: `bundles/${bundleSlug}/${itemSlug}/plate-exports/${file}`,
              });
            }
          }
        } catch (err) {
          // ignore
        }
      }
    }
  }

  return dedupeByPath(entries);
}

function safeSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

async function buildZip(entries) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks = [];
  const skipped = [];

  const done = new Promise((resolve, reject) => {
    output.on('data', (chunk) => chunks.push(chunk));
    output.on('end', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);

  for (const entry of entries) {
    try {
      const buffer = await fetchBuffer(entry.url);
      archive.append(buffer, { name: entry.zipPath });
    } catch (err) {
      skipped.push({ zipPath: entry.zipPath, url: entry.url, error: err.message || String(err) });
    }
  }

  if (skipped.length) {
    archive.append(
      Buffer.from(
        skipped.map((s) => `${s.zipPath}\n  ${s.url}\n  ${s.error}`).join('\n\n'),
        'utf8'
      ),
      { name: 'errors.txt' }
    );
  }

  await archive.finalize();
  await done;

  return { buffer: Buffer.concat(chunks), skipped };
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, max-age=0',
    },
    body: JSON.stringify(body),
  };
}

