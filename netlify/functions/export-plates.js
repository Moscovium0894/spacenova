const sharp = require('sharp');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  inferPlateCount,
  normalisePlateMap,
  normaliseStringArray,
  smartPlatePositions
} = require('./plate-helpers');

const DEFAULT_BUCKET = 'product-images';
const CONFIGURED_PX_PER_MM = Number(process.env.PLATE_EXPORT_PX_PER_MM || 10);
const PX_PER_MM = Number.isFinite(CONFIGURED_PX_PER_MM) && CONFIGURED_PX_PER_MM > 0
  ? CONFIGURED_PX_PER_MM
  : 10;
const OUTER_W = Math.round(200 * PX_PER_MM);
const OUTER_H = Math.round(OUTER_W / (Math.sqrt(3) / 2));
const FRAME_PX = Math.round(5 * PX_PER_MM);
const INNER_W = OUTER_W - FRAME_PX * 2;
const INNER_H = OUTER_H - FRAME_PX * 2;
const COL_PITCH = OUTER_W;
const ROW_PITCH = Math.round(OUTER_H * 0.75);
const ODD_OFFSET = Math.floor(COL_PITCH / 2);

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
    const slug = safeStorageName(product.slug || product.name || 'product');
    const bucket = process.env.SUPABASE_BUCKET || DEFAULT_BUCKET;
    const mainImageUrl = normaliseUrl(product.image || product.image_url || product.main_image || product.photo);
    const count = inferPlateCount(product);
    const plateMap = normalisePlateMap(product, count);
    const plateImages = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], count);
    const plateNames = normaliseStringArray(product, ['plate_names', 'plateNames', 'panel_names', 'panelNames'], count);
    const positions = getPositions(plateMap.positions, count);
    const hasPlateImage = plateImages.some(url => {
      const normalised = normaliseUrl(url);
      return normalised && !sameImageUrl(normalised, mainImageUrl);
    });

    if (!mainImageUrl && !hasPlateImage) {
      return json(400, { ok: false, error: 'Add a main image or individual plate images before exporting' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const buffers = await createPlatePngs({
      mainImageUrl,
      plateImages,
      transforms: plateMap.transforms || [],
      positions
    });
    const folder = `exports/${slug}`;
    await removeOldExports(supabase, bucket, folder);

    const files = [];
    for (let i = 0; i < buffers.length; i += 1) {
      const buffer = buffers[i];
      const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 12);
      const name = plateNames[i] || `plate-${i + 1}`;
      const filename = `${slug}-plate-${String(i + 1).padStart(2, '0')}-${safeStorageName(name)}.png`;
      const path = `${folder}/${filename}`;
      const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
        contentType: 'image/png',
        cacheControl: '0',
        upsert: true
      });
      if (error) throw error;
      files.push({
        index: i,
        name,
        filename,
        storagePath: path,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}?v=${hash}`
      });
    }

    return json(200, {
      ok: true,
      slug,
      files,
      dimensions: {
        exportedWidth: INNER_W,
        exportedHeight: INNER_H,
        outerWidth: OUTER_W,
        outerHeight: OUTER_H,
        framePx: FRAME_PX,
        pxPerMm: PX_PER_MM
      }
    });
  } catch (err) {
    console.error('export-plates fatal:', err);
    return json(500, { ok: false, error: err.message || 'Failed to export plate PNGs' });
  }
};

function getPassword(event, body) {
  return (event.headers && (
    event.headers['x-admin-password'] ||
    event.headers['X-Admin-Password']
  )) || body.password || '';
}

async function createPlatePngs({ mainImageUrl, plateImages, transforms, positions }) {
  const bounds = getBounds(positions);
  const canvasW = Math.max(OUTER_W, Math.round(bounds.width));
  const canvasH = Math.max(OUTER_H, Math.round(bounds.height));
  const innerMask = Buffer.from(hexMaskSvg(INNER_W, INNER_H));
  const mainBuffer = mainImageUrl ? await fetchBuffer(mainImageUrl) : null;
  const mainCanvas = mainBuffer
    ? await sharp(mainBuffer).rotate().resize(canvasW, canvasH, { fit: 'cover' }).png().toBuffer()
    : null;
  const cache = new Map();
  const result = [];

  for (let i = 0; i < positions.length; i += 1) {
    const plateUrl = getIndividualPlateImage(plateImages[i], mainImageUrl);
    if (plateUrl) {
      let plateBuffer = cache.get(plateUrl);
      if (!plateBuffer) {
        plateBuffer = await fetchBuffer(plateUrl);
        cache.set(plateUrl, plateBuffer);
      }
      result.push(await createIndividualPlateSlice(
        plateBuffer,
        INNER_W,
        INNER_H,
        innerMask,
        normaliseTransform(transforms[i])
      ));
      continue;
    }

    if (!mainCanvas) {
      result.push(await emptyPlate(innerMask));
      continue;
    }

    const pos = positions[i];
    const cropLeft = Math.max(0, Math.round(pos.x - bounds.minX + FRAME_PX));
    const cropTop = Math.max(0, Math.round(pos.y - bounds.minY + FRAME_PX));
    const safeLeft = Math.min(cropLeft, Math.max(0, canvasW - INNER_W));
    const safeTop = Math.min(cropTop, Math.max(0, canvasH - INNER_H));

    result.push(await sharp(mainCanvas)
      .extract({ left: safeLeft, top: safeTop, width: INNER_W, height: INNER_H })
      .composite([{ input: innerMask, blend: 'dest-in' }])
      .png()
      .toBuffer());
  }

  return result;
}

async function createIndividualPlateSlice(sourceBuffer, innerW, innerH, innerMask, transform) {
  const meta = await sharp(sourceBuffer).metadata();
  const sourceW = meta.width || innerW;
  const sourceH = meta.height || innerH;
  const fit = transform.fit === 'cover' ? 'cover' : 'contain';
  const baseScale = fit === 'cover'
    ? Math.max(innerW / sourceW, innerH / sourceH)
    : Math.min(innerW / sourceW, innerH / sourceH);
  const resizeScale = baseScale * transform.scale;
  const resizedW = Math.max(1, Math.round(sourceW * resizeScale));
  const resizedH = Math.max(1, Math.round(sourceH * resizeScale));
  const positionX = transform.x / 100;
  const positionY = transform.y / 100;

  let overlay = await sharp(sourceBuffer)
    .rotate()
    .resize(resizedW, resizedH, { fit: 'fill', withoutEnlargement: false })
    .png()
    .toBuffer();
  let overlayW = resizedW;
  let overlayH = resizedH;
  let left = 0;
  let top = 0;

  if (overlayW > innerW || overlayH > innerH) {
    const cropLeft = overlayW > innerW ? Math.round((overlayW - innerW) * positionX) : 0;
    const cropTop = overlayH > innerH ? Math.round((overlayH - innerH) * positionY) : 0;
    const extractW = Math.min(innerW, overlayW);
    const extractH = Math.min(innerH, overlayH);
    overlay = await sharp(overlay)
      .extract({
        left: Math.max(0, Math.min(cropLeft, overlayW - extractW)),
        top: Math.max(0, Math.min(cropTop, overlayH - extractH)),
        width: extractW,
        height: extractH
      })
      .png()
      .toBuffer();
    overlayW = extractW;
    overlayH = extractH;
  }

  if (overlayW < innerW) left = Math.round((innerW - overlayW) * positionX);
  if (overlayH < innerH) top = Math.round((innerH - overlayH) * positionY);

  return sharp({
    create: { width: innerW, height: innerH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: overlay, left, top },
      { input: innerMask, blend: 'dest-in' }
    ])
    .png()
    .toBuffer();
}

async function emptyPlate(innerMask) {
  return sharp({
    create: { width: INNER_W, height: INNER_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: innerMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function getPositions(mapPositions, count) {
  const source = Array.isArray(mapPositions) && mapPositions.length
    ? mapPositions
    : smartPlatePositions(count);
  return source.map(pos => gridToPixel(parseInt(pos.row, 10), parseInt(pos.col, 10)));
}

function gridToPixel(row, col) {
  const safeRow = Number.isFinite(row) ? row : 0;
  const safeCol = Number.isFinite(col) ? col : 0;
  return {
    x: safeCol * COL_PITCH + (safeRow % 2 !== 0 ? ODD_OFFSET : 0),
    y: safeRow * ROW_PITCH
  };
}

function getBounds(positions) {
  const minX = Math.min(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxX = Math.max(...positions.map(p => p.x + OUTER_W));
  const maxY = Math.max(...positions.map(p => p.y + OUTER_H));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function hexMaskSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(w, h)}" fill="white"/></svg>`;
}

function hexPoints(w, h) {
  return [
    `${w * 0.5},0`,
    `${w},${h * 0.25}`,
    `${w},${h * 0.75}`,
    `${w * 0.5},${h}`,
    `0,${h * 0.75}`,
    `0,${h * 0.25}`
  ].join(' ');
}

function getIndividualPlateImage(value, mainImageUrl) {
  const url = normaliseUrl(value);
  if (!url || sameImageUrl(url, mainImageUrl)) return '';
  return url;
}

function normaliseTransform(transform) {
  const item = transform && typeof transform === 'object' ? transform : {};
  return {
    fit: item.fit === 'cover' ? 'cover' : 'contain',
    x: clampNumber(item.x ?? item.positionX, 0, 100, 50),
    y: clampNumber(item.y ?? item.positionY, 0, 100, 50),
    scale: clampNumber(item.scale ?? item.zoom, 0.2, 3, 1)
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normaliseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.pathname = url.pathname.split('/').map(part => encodeURIComponent(decodeURIComponent(part))).join('/');
    return url.toString();
  } catch (err) {
    return value.replace(/ /g, '%20');
  }
}

function sameImageUrl(a, b) {
  return !!a && !!b && imageIdentity(a) === imageIdentity(b);
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

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function removeOldExports(supabase, bucket, folder) {
  const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  if (error || !Array.isArray(data) || !data.length) return;
  const paths = data.map(item => `${folder}/${item.name}`).filter(Boolean);
  if (!paths.length) return;
  const result = await supabase.storage.from(bucket).remove(paths);
  if (result.error) console.warn('export-plates: could not remove old exports:', result.error.message || result.error);
}

function safeStorageName(value) {
  return String(value || 'product')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
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
