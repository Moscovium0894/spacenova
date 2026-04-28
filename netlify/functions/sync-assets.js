const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { inferPlateCount, normaliseStringArray } = require('./plate-helpers');
const { renderProductPlateFiles } = require('./plate-renderer');
const {
  bundleItemSlugs,
  copyStorageFile,
  extensionFromContentType,
  fetchBuffer,
  getBucket,
  getPassword,
  json,
  listStorageFiles,
  normaliseUrl,
  productRoot,
  productSlug,
  productTypeFolder,
  publicObjectUrl,
  removeStoragePrefix,
  safeStorageName,
  sameImageUrl,
  uploadBuffer,
  uploadJson
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

    const scope = String(body.scope || 'all').trim().toLowerCase();
    const bucket = getBucket();
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (scope === 'product') {
      const slug = body.productSlug || body.slug || (body.product && body.product.slug);
      if (!slug) return json(400, { ok: false, error: 'Missing productSlug' });
      const product = await fetchProduct(supabase, slug);
      if (!product) return json(404, { ok: false, error: `Product not found: ${slug}` });
      const result = await syncProduct({ supabase, bucket, product, wallImageUrl: body.wallImageUrl });
      return json(200, { ok: true, scope, result });
    }

    if (scope === 'bundles') {
      const result = await syncBundles({ supabase, bucket });
      return json(200, { ok: true, scope, result });
    }

    if (scope === 'manifest') {
      const manifest = await writeManifest({ supabase, bucket });
      return json(200, { ok: true, scope, manifest });
    }

    if (scope !== 'all') {
      return json(400, { ok: false, error: 'Invalid scope' });
    }

    const products = await fetchProducts(supabase);
    const productResults = [];
    const failures = [];

    for (const product of products) {
      try {
        productResults.push(await syncProduct({ supabase, bucket, product, wallImageUrl: body.wallImageUrl }));
      } catch (err) {
        failures.push({ slug: product.slug || product.id || product.name, error: err.message || String(err) });
      }
    }

    const bundleResult = await syncBundles({ supabase, bucket });
    const manifest = await writeManifest({ supabase, bucket });

    return json(200, {
      ok: failures.length === 0,
      partialSuccess: failures.length > 0 && productResults.length > 0,
      scope,
      products: productResults,
      bundles: bundleResult,
      manifest,
      failures
    });
  } catch (err) {
    console.error('sync-assets fatal:', err);
    return json(500, { ok: false, error: err.message || 'Failed to sync assets' });
  }
};

async function syncProduct({ supabase, bucket, product, wallImageUrl }) {
  const slug = productSlug(product);
  const root = productRoot(product);
  const platesFolder = `${root}/plates`;
  const mainImageUrl = normaliseUrl(product.image || product.image_url || product.main_image || product.photo);
  const count = inferPlateCount(product);
  const plateNames = normaliseStringArray(product, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], count);
  const plateImages = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], count);
  const result = {
    slug,
    name: product.name || slug,
    type: productTypeFolder(product) === 'collections' ? 'collection' : 'series',
    root,
    main: null,
    plates: [],
    sourcePlates: [],
    mockup: null,
    warnings: []
  };

  await removeStoragePrefix(supabase, bucket, root, path => path.startsWith(`${root}/main.`));
  await removeStoragePrefix(supabase, bucket, platesFolder);

  if (mainImageUrl) {
    const fetched = await fetchBuffer(mainImageUrl);
    const storagePath = `${root}/main${normaliseImageExtension(fetched.extension, fetched.contentType)}`;
    await uploadBuffer(supabase, bucket, storagePath, fetched.buffer, fetched.contentType);
    result.main = fileResult(storagePath, 'main', 'Main image', fetched.buffer);
  } else {
    result.warnings.push('No main image URL found');
  }

  for (let index = 0; index < plateImages.length; index += 1) {
    const sourceUrl = normaliseUrl(plateImages[index]);
    if (!sourceUrl || sameImageUrl(sourceUrl, mainImageUrl)) continue;
    try {
      const fetched = await fetchBuffer(sourceUrl);
      const label = plateNames[index] || `Plate ${index + 1}`;
      const storagePath = `${platesFolder}/source-${String(index + 1).padStart(2, '0')}-${safeStorageName(label, `plate-${index + 1}`)}${normaliseImageExtension(fetched.extension, fetched.contentType)}`;
      await uploadBuffer(supabase, bucket, storagePath, fetched.buffer, fetched.contentType);
      const item = fileResult(storagePath, 'plates', `Source ${label}`, fetched.buffer);
      result.sourcePlates.push(item);
      result.plates.push(item);
    } catch (err) {
      result.warnings.push(`Source plate ${index + 1} skipped: ${err.message || String(err)}`);
    }
  }

  const renderedFiles = await renderProductPlateFiles(product);
  for (const file of renderedFiles) {
    const storagePath = `${platesFolder}/${file.filename}`;
    await uploadBuffer(supabase, bucket, storagePath, file.buffer, file.contentType);
    result.plates.push(fileResult(storagePath, 'plates', file.name, file.buffer, { index: file.index }));
  }

  result.mockup = await syncMockup(product, wallImageUrl);
  return result;
}

async function syncMockup(product, wallImageUrl) {
  const resolvedWallUrl = normaliseUrl(wallImageUrl || process.env.DEFAULT_WALL_IMAGE_URL);
  const slug = productSlug(product);
  const storagePath = `mockups/${slug}-mockup.png`;

  if (!resolvedWallUrl) {
    return {
      skipped: true,
      reason: 'Missing DEFAULT_WALL_IMAGE_URL',
      storagePath,
      zipPath: storagePath
    };
  }

  try {
    const generateMockup = require('./generate-mockup');
    const response = await generateMockup.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ productId: product.slug || product.id || slug, wallImageUrl: resolvedWallUrl })
    });
    const payload = JSON.parse(response.body || '{}');
    const rows = Array.isArray(payload.results) ? payload.results : [];
    const row = rows.find(item => item && (item.slug === product.slug || item.productId === product.id || item.productId === product.slug)) || rows[0] || null;
    if (response.statusCode >= 400 || !row || !row.success) {
      return {
        skipped: true,
        reason: (row && row.error) || payload.error || `Mockup generation failed (${response.statusCode})`,
        storagePath,
        zipPath: storagePath
      };
    }
    return {
      skipped: false,
      storagePath: row.storage_path || storagePath,
      zipPath: row.storage_path || storagePath,
      url: row.wall_image || publicObjectUrl(process.env.SUPABASE_URL, getBucket(), row.storage_path || storagePath)
    };
  } catch (err) {
    return {
      skipped: true,
      reason: err.message || String(err),
      storagePath,
      zipPath: storagePath
    };
  }
}

async function syncBundles({ supabase, bucket }) {
  const [products, bundles] = await Promise.all([
    fetchProducts(supabase),
    fetchBundles(supabase)
  ]);
  const productLookup = buildProductLookup(products);
  const results = [];
  const failures = [];

  for (const bundle of bundles) {
    const bundleSlug = safeStorageName(bundle.slug || bundle.name, 'bundle');
    const bundleRoot = `bundles/${bundleSlug}`;
    const itemSlugs = bundleItemSlugs(bundle);
    const bundleResult = {
      slug: bundleSlug,
      name: bundle.name || bundleSlug,
      root: bundleRoot,
      products: []
    };

    try {
      await removeStoragePrefix(supabase, bucket, bundleRoot);

      for (const itemSlug of itemSlugs) {
        const product = productLookup[itemSlug];
        if (!product) {
          failures.push({ bundle: bundleSlug, slug: itemSlug, error: 'Product not found' });
          continue;
        }

        const sourceRoot = productRoot(product);
        const targetRoot = `${bundleRoot}/${productSlug(product)}`;
        const files = await listStorageFiles(supabase, bucket, sourceRoot);
        const copied = [];

        for (const file of files) {
          const relative = file.path.slice(sourceRoot.length).replace(/^\/+/, '');
          if (!relative) continue;
          const targetPath = `${targetRoot}/${relative}`;
          await copyStorageFile(supabase, bucket, file.path, targetPath);
          copied.push(targetPath);
        }

        bundleResult.products.push({
          slug: productSlug(product),
          name: product.name || productSlug(product),
          root: targetRoot,
          files: copied
        });
      }

      results.push(bundleResult);
    } catch (err) {
      failures.push({ bundle: bundleSlug, error: err.message || String(err) });
    }
  }

  return { ok: failures.length === 0, bundles: results, failures };
}

async function writeManifest({ supabase, bucket }) {
  const manifest = await buildManifest({ supabase, bucket });
  await uploadJson(supabase, bucket, MANIFEST_PATH, manifest);
  return manifest;
}

async function buildManifest({ supabase, bucket }) {
  const [products, bundles, mockupFiles] = await Promise.all([
    fetchProducts(supabase),
    fetchBundles(supabase),
    listStorageFiles(supabase, bucket, 'mockups').catch(() => [])
  ]);
  const productLookup = buildProductLookup(products);
  const manifest = {
    ok: true,
    needsSync: false,
    generatedAt: new Date().toISOString(),
    bucket,
    products: [],
    bundles: [],
    mockups: [],
    files: []
  };

  for (const product of products) {
    const slug = productSlug(product);
    const root = productRoot(product);
    const files = await listProductStorageEntries(supabase, bucket, root, {
      productSlug: slug,
      productName: product.name || slug,
      productType: productTypeFolder(product) === 'collections' ? 'collection' : 'series'
    });
    manifest.products.push({
      slug,
      dbSlug: product.slug || null,
      name: product.name || slug,
      type: productTypeFolder(product) === 'collections' ? 'collection' : 'series',
      root,
      isPublished: product.is_published !== false,
      files
    });
    manifest.files.push(...files);
  }

  for (const mockupFile of mockupFiles) {
    if (!mockupFile.path || mockupFile.path === MANIFEST_PATH) continue;
    const entry = storageEntry(mockupFile.path, {
      kind: 'mockups',
      label: mockupFile.path.split('/').pop(),
      folder: 'mockups'
    });
    manifest.mockups.push(entry);
    manifest.files.push(entry);
  }

  for (const bundle of bundles) {
    const bundleSlug = safeStorageName(bundle.slug || bundle.name, 'bundle');
    const itemSlugs = bundleItemSlugs(bundle);
    const bundleNode = {
      slug: bundleSlug,
      dbSlug: bundle.slug || null,
      name: bundle.name || bundleSlug,
      root: `bundles/${bundleSlug}`,
      itemSlugs,
      products: [],
      files: []
    };

    for (const itemSlug of itemSlugs) {
      const product = productLookup[itemSlug];
      const productSafeSlug = product ? productSlug(product) : itemSlug;
      const root = `${bundleNode.root}/${productSafeSlug}`;
      const files = await listProductStorageEntries(supabase, bucket, root, {
        productSlug: productSafeSlug,
        productName: (product && product.name) || productSafeSlug,
        productType: 'bundle-product',
        bundleSlug
      });
      bundleNode.products.push({
        slug: productSafeSlug,
        name: (product && product.name) || productSafeSlug,
        root,
        files
      });
      bundleNode.files.push(...files);
      manifest.files.push(...files);
    }

    manifest.bundles.push(bundleNode);
  }

  return manifest;
}

async function listProductStorageEntries(supabase, bucket, root, context = {}) {
  const files = await listStorageFiles(supabase, bucket, root).catch(() => []);
  return files
    .map(file => storageEntry(file.path, {
      kind: classifyKind(file.path),
      label: labelForPath(file.path),
      folder: root,
      ...context
    }))
    .filter(entry => entry.kind === 'main' || entry.kind === 'plates');
}

function storageEntry(storagePath, extra = {}) {
  return {
    label: extra.label || storagePath.split('/').pop(),
    kind: extra.kind || classifyKind(storagePath),
    storagePath,
    zipPath: storagePath,
    url: publicObjectUrl(process.env.SUPABASE_URL, getBucket(), storagePath),
    ...extra
  };
}

function classifyKind(storagePath) {
  if (storagePath.startsWith('mockups/')) return 'mockups';
  if (/\/plates\//i.test(storagePath)) return 'plates';
  if (/\/main\.[^/]+$/i.test(storagePath)) return 'main';
  return 'other';
}

function labelForPath(storagePath) {
  const name = storagePath.split('/').pop() || storagePath;
  if (/^main\./i.test(name)) return 'Main image';
  if (/^source-/i.test(name)) return `Source ${humaniseFilename(name.replace(/^source-\d{2}-/i, ''))}`;
  if (/^\d{2}-/i.test(name)) return humaniseFilename(name.replace(/^\d{2}-/i, ''));
  return humaniseFilename(name);
}

function humaniseFilename(name) {
  return String(name || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function fileResult(storagePath, kind, label, buffer, extra = {}) {
  const version = buffer ? crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12) : '';
  return {
    label,
    kind,
    storagePath,
    zipPath: storagePath,
    url: publicObjectUrl(process.env.SUPABASE_URL, getBucket(), storagePath, version),
    ...extra
  };
}

function normaliseImageExtension(ext, contentType) {
  const resolved = extensionFromContentType(contentType, ext || '.jpg');
  return resolved === '.jpeg' ? '.jpg' : resolved;
}

async function fetchProduct(supabase, identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  const bySlug = await supabase.from('products').select('id,slug,name,image,wall_image,wall_source_image,plate_count,plate_map,deleted_at,is_published,in_stock,product_plates(id,position,name,image)').eq('slug', value).is('deleted_at', null).maybeSingle();
  if (bySlug.data) return bySlug.data;
  if (bySlug.error && !isNoRowsError(bySlug.error)) throw bySlug.error;
  const byId = await supabase.from('products').select('id,slug,name,image,wall_image,wall_source_image,plate_count,plate_map,deleted_at,is_published,in_stock,product_plates(id,position,name,image)').eq('id', value).is('deleted_at', null).maybeSingle();
  if (byId.error && !isNoRowsError(byId.error)) throw byId.error;
  return byId.data || null;
}

async function fetchProducts(supabase) {
  const { data, error } = await supabase
    .from('products')
    .select('id,slug,name,image,wall_image,wall_source_image,plate_count,plate_map,deleted_at,is_published,in_stock,product_plates(id,position,name,image)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchBundles(supabase) {
  const { data, error } = await supabase
    .from('bundles')
    .select('*')
    .order('name', { ascending: true });
  if (error) {
    console.warn('sync-assets bundles warning:', error.message || error);
    return [];
  }
  return data || [];
}

function buildProductLookup(products) {
  const lookup = {};
  for (const product of products || []) {
    const safeSlug = productSlug(product);
    lookup[safeSlug] = product;
    if (product.slug) lookup[String(product.slug).trim()] = product;
    if (product.id !== undefined && product.id !== null) lookup[String(product.id).trim()] = product;
  }
  return lookup;
}

function isNoRowsError(error) {
  return error && (error.code === 'PGRST116' || /no rows/i.test(error.message || ''));
}
