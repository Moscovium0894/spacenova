const DEFAULT_BUCKET = 'product-images';

function getBucket() {
  return process.env.SUPABASE_BUCKET || DEFAULT_BUCKET;
}

function getPassword(event, body) {
  return (
    (event.headers &&
      (event.headers['x-admin-password'] || event.headers['X-Admin-Password'])) ||
    (body && body.password) ||
    ''
  );
}

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

function safeStorageName(value, fallback = 'item') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function safeFilename(value, fallback = 'export.zip') {
  const cleaned = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
  return cleaned.toLowerCase().endsWith('.zip') ? cleaned : `${cleaned}.zip`;
}

function safeZipPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  return raw
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => part !== '.' && part !== '..')
    .join('/');
}

function normaliseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.pathname = url.pathname
      .split('/')
      .map(part => encodeURIComponent(decodeURIComponent(part)))
      .join('/');
    return url.toString();
  } catch (err) {
    return value.replace(/ /g, '%20');
  }
}

function imageIdentity(value) {
  const raw = normaliseUrl(value);
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch (err) {
    return String(raw || '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  }
}

function sameImageUrl(a, b) {
  return !!a && !!b && imageIdentity(a) === imageIdentity(b);
}

function extensionFromContentType(contentType, fallback = '.jpg') {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/svg+xml') return '.svg';
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
  return fallback;
}

function extensionFromUrl(url, fallback = '.jpg') {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.([a-z0-9]{1,5})$/i);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch (err) {
    const match = String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]{1,5})$/i);
    if (match) return `.${match[1].toLowerCase()}`;
  }
  return fallback;
}

function contentTypeFromExtension(ext, fallback = 'application/octet-stream') {
  const value = String(ext || '').toLowerCase();
  if (value === '.png') return 'image/png';
  if (value === '.jpg' || value === '.jpeg') return 'image/jpeg';
  if (value === '.webp') return 'image/webp';
  if (value === '.gif') return 'image/gif';
  if (value === '.svg') return 'image/svg+xml';
  if (value === '.json') return 'application/json';
  if (value === '.zip') return 'application/zip';
  return fallback;
}

function publicObjectUrl(supabaseUrl, bucket, storagePath, version) {
  const base = `${String(supabaseUrl || '').replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${storagePath}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

function productTypeFolder(product) {
  return product && (product.is_collection || product.isCollection) ? 'collections' : 'series';
}

function productSlug(product) {
  return safeStorageName(product && (product.slug || product.id || product.name), 'product');
}

function productRoot(product) {
  return `${productTypeFolder(product)}/${productSlug(product)}`;
}

function normaliseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .map(key => value[key])
      .filter(item => item !== null && item !== undefined && String(item).trim() !== '');
  }
  return [];
}

function bundleItemSlugs(bundle) {
  return normaliseArray(bundle && bundle.items)
    .map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return String(item.slug || item.id || item.productSlug || item.name || '').trim();
      return '';
    })
    .filter(Boolean)
    .map(slug => safeStorageName(slug));
}

async function fetchBuffer(url) {
  const safeUrl = normaliseUrl(url);
  if (!safeUrl) throw new Error('Missing URL');
  const res = await fetch(safeUrl);
  if (!res.ok) throw new Error(`Failed to fetch (${res.status}): ${safeUrl}`);
  const contentType = res.headers.get('content-type') || contentTypeFromExtension(extensionFromUrl(safeUrl), 'application/octet-stream');
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType,
    extension: extensionFromContentType(contentType, extensionFromUrl(safeUrl, '.jpg')),
    url: safeUrl
  };
}

async function uploadBuffer(supabase, bucket, storagePath, buffer, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
    contentType: contentType || 'application/octet-stream',
    cacheControl: '0',
    upsert: true
  });
  if (error) throw error;
  return storagePath;
}

async function uploadJson(supabase, bucket, storagePath, value) {
  return uploadBuffer(
    supabase,
    bucket,
    storagePath,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    'application/json'
  );
}

async function downloadStorageBuffer(supabase, bucket, storagePath) {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

async function downloadStorageText(supabase, bucket, storagePath) {
  const buffer = await downloadStorageBuffer(supabase, bucket, storagePath);
  return buffer.toString('utf8');
}

async function listAllObjects(supabase, bucket, prefix) {
  const items = [];
  const limit = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    items.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }

  return items;
}

function isFolderObject(item) {
  if (!item || !item.name) return false;
  return item.id === null || item.id === undefined;
}

async function listStorageFiles(supabase, bucket, prefix = '') {
  const cleanPrefix = String(prefix || '').replace(/^\/+|\/+$/g, '');
  const listed = await listAllObjects(supabase, bucket, cleanPrefix);
  const files = [];

  for (const item of listed) {
    if (!item || !item.name) continue;
    const path = cleanPrefix ? `${cleanPrefix}/${item.name}` : item.name;
    if (isFolderObject(item)) {
      const nested = await listStorageFiles(supabase, bucket, path);
      files.push(...nested);
    } else {
      files.push({ ...item, path });
    }
  }

  return files;
}

async function removeStoragePaths(supabase, bucket, paths) {
  const cleanPaths = Array.from(new Set((paths || []).map(safeZipPath).filter(Boolean)));
  for (let i = 0; i < cleanPaths.length; i += 100) {
    const chunk = cleanPaths.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) throw error;
  }
  return cleanPaths.length;
}

async function removeStoragePrefix(supabase, bucket, prefix, predicate) {
  const files = await listStorageFiles(supabase, bucket, prefix);
  const paths = files
    .map(file => file.path)
    .filter(path => !predicate || predicate(path));
  if (!paths.length) return 0;
  return removeStoragePaths(supabase, bucket, paths);
}

async function copyStorageFile(supabase, bucket, fromPath, toPath) {
  await removeStoragePaths(supabase, bucket, [toPath]).catch(() => {});
  const { error } = await supabase.storage.from(bucket).copy(fromPath, toPath);
  if (error) throw error;
  return toPath;
}

module.exports = {
  DEFAULT_BUCKET,
  bundleItemSlugs,
  contentTypeFromExtension,
  copyStorageFile,
  downloadStorageBuffer,
  downloadStorageText,
  extensionFromContentType,
  extensionFromUrl,
  fetchBuffer,
  getBucket,
  getPassword,
  json,
  listAllObjects,
  listStorageFiles,
  normaliseArray,
  normaliseUrl,
  productRoot,
  productSlug,
  productTypeFolder,
  publicObjectUrl,
  removeStoragePaths,
  removeStoragePrefix,
  safeFilename,
  safeStorageName,
  safeZipPath,
  sameImageUrl,
  uploadBuffer,
  uploadJson
};
