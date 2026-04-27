const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { getPlateDimensions, renderProductPlateFiles } = require('./plate-renderer');
const {
  getBucket,
  getPassword,
  json,
  productRoot,
  productSlug,
  publicObjectUrl,
  removeStoragePrefix,
  uploadBuffer
} = require('./asset-helpers');

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

    const product = body.product && typeof body.product === 'object' ? body.product : body;
    const slug = productSlug(product);
    const bucket = getBucket();
    const root = productRoot(product);
    const platesFolder = `${root}/plates`;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const renderedFiles = await renderProductPlateFiles(product);

    await removeStoragePrefix(supabase, bucket, platesFolder, path => /\/\d{2}-[^/]+\.png$/i.test(path));

    const files = [];
    for (const file of renderedFiles) {
      const storagePath = `${platesFolder}/${file.filename}`;
      await uploadBuffer(supabase, bucket, storagePath, file.buffer, file.contentType);
      const hash = crypto.createHash('sha1').update(file.buffer).digest('hex').slice(0, 12);
      files.push({
        index: file.index,
        name: file.name,
        filename: file.filename,
        storagePath,
        zipPath: storagePath,
        url: publicObjectUrl(process.env.SUPABASE_URL, bucket, storagePath, hash)
      });
    }

    return json(200, {
      ok: true,
      slug,
      root,
      files,
      dimensions: getPlateDimensions()
    });
  } catch (err) {
    console.error('export-plates fatal:', err);
    return json(500, { ok: false, error: err.message || 'Failed to export plate PNGs' });
  }
};
