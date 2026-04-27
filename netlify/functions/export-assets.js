const archiver = require('archiver');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { createClient } = require('@supabase/supabase-js');
const {
  downloadStorageBuffer,
  downloadStorageText,
  getBucket,
  getPassword,
  json,
  publicObjectUrl,
  safeFilename,
  safeZipPath
} = require('./asset-helpers');

const MANIFEST_PATH = 'asset-manifest.json';

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
    const bucket = getBucket();
    const mode = String(body.mode || 'all').trim().toLowerCase();
    const requestedFilename = String(body.filename || '').trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = safeFilename(requestedFilename || `spacenova-export-${timestamp}.zip`);
    const explicitEntries = Array.isArray(body.entries) ? body.entries : null;

    const entries = explicitEntries
      ? sanitiseEntries(explicitEntries)
      : await manifestEntries({ supabase, bucket, mode });

    if (!entries.length) {
      return json(400, { ok: false, error: 'No assets selected. Run Sync assets first if the export tree is empty.' });
    }

    const { buffer, skipped } = await buildZip({ supabase, bucket, entries });
    const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
    const storagePath = `downloads/${filename}`;

    const upload = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType: 'application/zip',
      cacheControl: '0',
      upsert: true
    });
    if (upload.error) throw upload.error;

    return json(200, {
      ok: true,
      filename,
      bytes: buffer.length,
      fileCount: entries.length,
      skipped,
      storagePath,
      url: publicObjectUrl(process.env.SUPABASE_URL, bucket, storagePath, hash)
    });
  } catch (err) {
    console.error('export-assets fatal:', err);
    const missingManifest = isMissingManifestError(err);
    return json(missingManifest ? 409 : 500, {
      ok: false,
      needsSync: missingManifest || undefined,
      error: missingManifest ? 'Run Sync assets first' : (err.message || 'Failed to export assets')
    });
  }
};

async function manifestEntries({ supabase, bucket, mode }) {
  const manifest = JSON.parse(await downloadStorageText(supabase, bucket, MANIFEST_PATH));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const filtered = files.filter(entry => {
    const storagePath = safeZipPath(entry && entry.storagePath);
    if (!storagePath || storagePath === MANIFEST_PATH || storagePath.startsWith('downloads/')) return false;
    if (mode === 'products-only' && storagePath.startsWith('bundles/')) return false;
    return true;
  });
  return sanitiseEntries(filtered);
}

function sanitiseEntries(entries) {
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const storagePath = safeZipPath(entry.storagePath || entry.path || '');
    const zipPath = safeZipPath(entry.zipPath || storagePath);
    if (!storagePath || !zipPath) continue;
    if (storagePath === MANIFEST_PATH || storagePath.startsWith('downloads/')) continue;
    out.push({ storagePath, zipPath });
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

async function buildZip({ supabase, bucket, entries }) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks = [];
  const skipped = [];

  const done = new Promise((resolve, reject) => {
    output.on('data', chunk => chunks.push(chunk));
    output.on('end', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);

  for (const entry of entries) {
    try {
      const buffer = await downloadStorageBuffer(supabase, bucket, entry.storagePath);
      archive.append(buffer, { name: entry.zipPath });
    } catch (err) {
      skipped.push({
        storagePath: entry.storagePath,
        zipPath: entry.zipPath,
        error: err.message || String(err)
      });
    }
  }

  if (skipped.length) {
    archive.append(
      Buffer.from(
        skipped
          .map(item => `${item.zipPath}\n  ${item.storagePath}\n  ${item.error}`)
          .join('\n\n'),
        'utf8'
      ),
      { name: 'errors.txt' }
    );
  }

  await archive.finalize();
  await done;

  return { buffer: Buffer.concat(chunks), skipped };
}

function isMissingManifestError(error) {
  const text = `${error && error.statusCode ? error.statusCode : ''} ${error && error.error ? error.error : ''} ${error && error.message ? error.message : ''}`;
  return /not found|does not exist|no such|404/i.test(text);
}
