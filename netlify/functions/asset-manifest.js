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

    const [productsRes, bundlesRes, mockupsRes] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('bundles').select('*').order('name', { ascending: true }),
      listAllObjects(supabase, bucket, 'mockups')
    ]);

    if (productsRes.error) {
      console.error('asset-manifest products error:', productsRes.error);
      return json(500, { ok: false, error: productsRes.error.message || 'Failed to load products' });
    }

    const products = productsRes.data || [];
    const bundles = bundlesRes && !bundlesRes.error ? (bundlesRes.data || []) : [];

    const productLookup = {};
    products.forEach((p) => {
      if (p && p.slug) productLookup[p.slug] = p;
    });

    const mockupsList = Array.isArray(mockupsRes) ? mockupsRes : [];
    const mockups = mockupsList
      .map((item) => ({
        name: item.name,
        storagePath: `mockups/${item.name}`,
        url: publicObjectUrl(process.env.SUPABASE_URL, bucket, `mockups/${item.name}`),
      }))
      .filter((x) => x.name);

    const manifestProducts = [];
    for (const p of products) {
      const slug = String(p.slug || '').trim();
      if (!slug) continue;
      const type = p.is_collection ? 'collection' : 'series';
      const plateNames = normaliseArray(p.plate_names);
      const plateImages = normaliseArray(p.plate_images);
      const plates = plateImages
        .map((url, index) => ({
          index,
          name: plateNames[index] || `Plate ${index + 1}`,
          url: String(url || '').trim(),
        }))
        .filter((plate) => !!plate.url);

      let exported = [];
      try {
        const objects = await listAllObjects(supabase, bucket, `exports/${slug}`);
        exported = objects.map((item) => ({
          filename: item.name,
          storagePath: `exports/${slug}/${item.name}`,
          url: publicObjectUrl(process.env.SUPABASE_URL, bucket, `exports/${slug}/${item.name}`),
        })).filter((x) => x.filename);
      } catch (err) {
        exported = [];
      }

      manifestProducts.push({
        slug,
        name: p.name || slug,
        category: p.category || '',
        type,
        isPublished: p.is_published !== false,
        mainImage: String(p.image || '').trim(),
        wallImage: String(p.wall_image || '').trim(),
        plates,
        exported,
      });
    }

    const manifestBundles = bundles
      .map((b) => {
        const slug = String(b.slug || '').trim();
        if (!slug) return null;
        const itemSlugs = normaliseArray(b.items)
          .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') return String(item.slug || item.id || item.name || '').trim();
            return '';
          })
          .filter(Boolean);

        const products = itemSlugs
          .map((s) => {
            const prod = productLookup[s];
            if (!prod) return null;
            return { slug: s, name: prod.name || s };
          })
          .filter(Boolean);

        return { slug, name: b.name || slug, itemSlugs, products };
      })
      .filter(Boolean);

    return json(200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      bucket,
      products: manifestProducts,
      bundles: manifestBundles,
      mockups,
    });
  } catch (err) {
    console.error('asset-manifest fatal:', err);
    return json(500, { ok: false, error: err.message || 'Failed to build asset manifest' });
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

function publicObjectUrl(supabaseUrl, bucket, storagePath) {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
}

async function listAllObjects(supabase, bucket, path) {
  const items = [];
  const limit = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(path, { limit, offset });
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    items.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }

  return items;
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

