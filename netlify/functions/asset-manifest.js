const { createClient } = require('@supabase/supabase-js');
const {
  downloadStorageText,
  getBucket,
  getPassword,
  json
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

    try {
      const text = await downloadStorageText(supabase, bucket, MANIFEST_PATH);
      const manifest = JSON.parse(text);
      return json(200, {
        ...manifest,
        ok: true,
        needsSync: false,
        bucket: manifest.bucket || bucket
      });
    } catch (err) {
      if (!isMissingObjectError(err)) {
        console.error('asset-manifest read error:', err);
        return json(500, { ok: false, error: err.message || 'Failed to read asset manifest' });
      }

      return json(200, {
        ok: true,
        needsSync: true,
        bucket,
        generatedAt: null,
        products: [],
        bundles: [],
        mockups: [],
        files: [],
        message: 'Run Sync assets first'
      });
    }
  } catch (err) {
    console.error('asset-manifest fatal:', err);
    return json(500, { ok: false, error: err.message || 'Failed to load asset manifest' });
  }
};

function isMissingObjectError(error) {
  const text = `${error && error.statusCode ? error.statusCode : ''} ${error && error.error ? error.error : ''} ${error && error.message ? error.message : ''}`;
  return /not found|does not exist|no such|404|object/i.test(text) && /not found|does not exist|no such|404/i.test(text);
}
