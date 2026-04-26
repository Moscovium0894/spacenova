const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const {
  inferPlateCount,
  normalisePlateMap,
  normaliseStringArray,
  smartPlatePositions,
  isMissingColumnError
} = require('./plate-helpers');

const DEFAULT_BUCKET = 'product-images';
const HEX_H = 210;
const HEX_W = Math.round(HEX_H * 0.866);
const HEX_GAP = 0;
const COL_PITCH = HEX_W + HEX_GAP;
const ROW_PITCH = Math.round(HEX_H * 0.75) + HEX_GAP;
const ODD_OFFSET = Math.round(COL_PITCH / 2);
const ORIGIN_X = 470;
const ORIGIN_Y = 185;
const FRAME_WIDTH = 5;
const FRAME_COLOUR = '#1a1a1a';
const SHADOW_OFFSET_X = 10;
const SHADOW_OFFSET_Y = 10;
const SHADOW_BLUR = 6;
const SHADOW_PAD = 20;
const DEPTH_OFFSET_X = 5;
const DEPTH_OFFSET_Y = 7;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed', results: [] });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const wallImageUrl = normaliseUrl(body.wallImageUrl || process.env.DEFAULT_WALL_IMAGE_URL);
    const bucket = process.env.SUPABASE_BUCKET || DEFAULT_BUCKET;

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { success: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable', results: [] });
    }

    if (!wallImageUrl) {
      return json(400, { success: false, error: 'Missing wallImageUrl and DEFAULT_WALL_IMAGE_URL is not set', results: [] });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    let products = [];
    if (body.all) {
      const { data, error } = await supabase.from('products').select('*');
      if (error) throw error;
      products = data || [];
    } else if (body.productId) {
      const { data, error } = await getProductByIdentifier(supabase, body.productId);
      if (error || !data) return json(404, { success: false, error: 'Product not found', results: [] });
      products = [data];
    } else {
      return json(400, { success: false, error: 'Provide productId or all:true', results: [] });
    }

    const wallBuffer = await fetchBuffer(wallImageUrl);
    const results = [];

    for (const product of products) {
      try {
        const imageUrl = normaliseUrl(product.image || product.image_url || product.main_image || product.photo);
        if (!imageUrl) {
          results.push({ productId: product.id, success: false, skipped: true, error: 'No product image URL found' });
          continue;
        }

        const positions = getPositions(product);
        const pieceCount = positions.length;
        const productBuffer = await fetchBuffer(imageUrl);
        const plateImages = normaliseStringArray(product, ['plate_images', 'plateImages', 'panel_images', 'panelImages'], pieceCount);
        const plateTransforms = getPlateTransforms(product, pieceCount);
        const mockupBuffer = await generateMockup({
          wallBuffer,
          productBuffer,
          productImageUrl: imageUrl,
          positions,
          plateImages,
          plateTransforms
        });
        const productKey = getProductKey(product);
        const storagePath = `mockups/${safeStorageName(productKey)}-mockup.png`;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, mockupBuffer, {
            contentType: 'image/png',
            upsert: true
          });

        if (uploadError) throw uploadError;

        const wallImage = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
        await updateProductWallImage(supabase, product, wallImage, wallImageUrl);

        results.push({
          productId: product.id || product.slug,
          slug: product.slug || null,
          name: product.name,
          pieces: pieceCount,
          success: true,
          storage_path: storagePath,
          wall_image: wallImage,
          positions_source: getStoredPlatePositions(product) ? 'plate_map' : 'auto'
        });
      } catch (err) {
        results.push({ productId: product.id || product.slug, slug: product.slug || null, name: product.name, success: false, error: err.message });
      }
    }

    const okCount = results.filter(r => r.success).length;
    const failCount = results.length - okCount;
    return json(200, { success: okCount > 0 && failCount === 0, partialSuccess: okCount > 0 && failCount > 0, results });
  } catch (err) {
    console.error('generate-mockup error:', err);
    return json(500, { success: false, error: err.message || 'Failed to generate mockup', results: [] });
  }
};

function getPieceCount(product) {
  return inferPlateCount(product);
}

async function getProductByIdentifier(supabase, identifier) {
  const value = String(identifier || '').trim();
  if (!value) return { data: null, error: new Error('Missing product identifier') };

  const bySlug = await supabase
    .from('products')
    .select('*')
    .eq('slug', value)
    .maybeSingle();

  if (bySlug.data || (bySlug.error && !isNoRowsError(bySlug.error))) return bySlug;

  return supabase
    .from('products')
    .select('*')
    .eq('id', value)
    .maybeSingle();
}

async function updateProductWallImage(supabase, product, wallImage, wallSourceImage) {
  const attempts = [];
  if (product.slug) attempts.push({ column: 'slug', value: product.slug });
  if (product.id !== undefined && product.id !== null) attempts.push({ column: 'id', value: product.id });

  let lastError = null;
  for (const attempt of attempts) {
    const updatePayload = { wall_image: wallImage, wall_source_image: wallSourceImage || null };
    let { data, error } = await supabase
      .from('products')
      .update(updatePayload)
      .eq(attempt.column, attempt.value)
      .select(attempt.column);

    if (error && isMissingColumnError(error)) {
      ({ data, error } = await supabase
        .from('products')
        .update({ wall_image: wallImage })
        .eq(attempt.column, attempt.value)
        .select(attempt.column));
    }

    if (!error && data && data.length > 0) return data[0];
    if (error) lastError = error;
  }

  throw lastError || new Error(`No product row matched ${product.slug || product.id || product.name || 'unknown product'}`);
}

function getProductKey(product) {
  return product.slug || product.id || product.name || `product-${Date.now()}`;
}

function safeStorageName(value) {
  return String(value || 'product')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
}

function getStoredPlatePositions(product) {
  const plateMap = product.plate_map || product.plateMap || product.panel_map || product.panelMap;
  return plateMap && Array.isArray(plateMap.positions) ? plateMap.positions : null;
}

function getPositions(product) {
  const mapped = getStoredPlatePositions(product);
  if (mapped && mapped.length > 0) {
    const positions = mapped
      .map(p => gridToPixel(parseInt(p.row, 10), parseInt(p.col, 10)))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (positions.length > 0) return positions;
  }

  return autoHoneycomb(getPieceCount(product));
}

function gridToPixel(row, col) {
  const safeRow = Number.isFinite(row) ? row : 0;
  const safeCol = Number.isFinite(col) ? col : 0;
  return {
    x: safeCol * COL_PITCH + (safeRow % 2 !== 0 ? ODD_OFFSET : 0),
    y: safeRow * ROW_PITCH
  };
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

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateMockup({ wallBuffer, productBuffer, productImageUrl, positions, pieceCount, plateImages, plateTransforms }) {
  const wallMeta = await sharp(wallBuffer).metadata();
  const wallWidth = wallMeta.width || 1200;
  const wallHeight = wallMeta.height || 800;
  const tilePositions = Array.isArray(positions) && positions.length ? positions : autoHoneycomb(pieceCount || 3);
  const bounds = getBounds(tilePositions);
  const pieceImages = await createSlicedFramedPieces(productBuffer, tilePositions, bounds, {
    productImageUrl,
    plateImages,
    plateTransforms
  });
  const shadow = await createContactShadow();
  const depth = await createDepthLayer();
  const highlight = await createWallContactHighlight();
  const composites = [];

  for (let i = 0; i < tilePositions.length; i += 1) {
    const left = Math.round(ORIGIN_X + tilePositions[i].x);
    const top = Math.round(ORIGIN_Y + tilePositions[i].y);
    composites.push({ input: shadow, left: left - SHADOW_PAD + SHADOW_OFFSET_X, top: top - SHADOW_PAD + SHADOW_OFFSET_Y });
    composites.push({ input: depth, left, top });
    composites.push({ input: pieceImages[i], left, top });
    composites.push({ input: highlight, left, top });
  }

  return sharp(wallBuffer)
    .resize({ width: wallWidth, height: wallHeight, fit: 'cover' })
    .modulate({ brightness: 0.995 })
    .composite(composites)
    .png({ quality: 92 })
    .toBuffer();
}

function autoHoneycomb(count) {
  return normalisePlateMap({ plate_map: { positions: smartPlatePositions(count) } }, count)
    .positions
    .map(pos => gridToPixel(pos.row, pos.col));
}

function getBounds(positions) {
  const minX = Math.min(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxX = Math.max(...positions.map(p => p.x + HEX_W));
  const maxY = Math.max(...positions.map(p => p.y + HEX_H));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

async function createSlicedFramedPieces(productBuffer, positions, bounds, options = {}) {
  const innerW = HEX_W - FRAME_WIDTH * 2;
  const innerH = HEX_H - FRAME_WIDTH * 2;
  const canvasW = Math.max(HEX_W, Math.round(bounds.width));
  const canvasH = Math.max(HEX_H, Math.round(bounds.height));
  const imageCanvas = await sharp(productBuffer)
    .resize(canvasW, canvasH, { fit: 'cover' })
    .png()
    .toBuffer();

  const outerMask = Buffer.from(hexMaskSvg(HEX_W, HEX_H));
  const innerMask = Buffer.from(hexMaskSvg(innerW, innerH));
  const pieces = [];
  const imageCache = new Map();

  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i];
    const cropLeft = Math.max(0, Math.round(pos.x - bounds.minX));
    const cropTop = Math.max(0, Math.round(pos.y - bounds.minY));
    const safeLeft = Math.min(cropLeft, Math.max(0, canvasW - HEX_W));
    const safeTop = Math.min(cropTop, Math.max(0, canvasH - HEX_H));
    const individualUrl = getIndividualPlateImage(options.plateImages && options.plateImages[i], options.productImageUrl);
    let slice;

    if (individualUrl) {
      let individualBuffer = imageCache.get(individualUrl);
      if (!individualBuffer) {
        individualBuffer = await fetchBuffer(individualUrl);
        imageCache.set(individualUrl, individualBuffer);
      }
      slice = await createIndividualPlateSlice(
        individualBuffer,
        innerW,
        innerH,
        innerMask,
        normaliseTransform(options.plateTransforms && options.plateTransforms[i])
      );
    } else {
      slice = await sharp(imageCanvas)
        .extract({ left: safeLeft, top: safeTop, width: HEX_W, height: HEX_H })
        .resize(innerW, innerH, { fit: 'cover' })
        .composite([{ input: innerMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    }

    const frame = await sharp({
      create: {
        width: HEX_W,
        height: HEX_H,
        channels: 4,
        background: FRAME_COLOUR
      }
    })
      .composite([{ input: outerMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    const piece = await sharp(frame)
      .composite([
        { input: slice, left: FRAME_WIDTH, top: FRAME_WIDTH },
        { input: Buffer.from(hexStrokeSvg(HEX_W, HEX_H)), left: 0, top: 0 }
      ])
      .png()
      .toBuffer();

    pieces.push(piece);
  }

  return pieces;
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
    create: {
      width: innerW,
      height: innerH,
      channels: 4,
      background: '#050505'
    }
  })
    .composite([
      { input: overlay, left, top },
      { input: innerMask, blend: 'dest-in' }
    ])
    .png()
    .toBuffer();
}

function getPlateTransforms(product, count) {
  return normalisePlateMap(product, count).transforms;
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

function sameImageUrl(a, b) {
  const normalise = value => normaliseUrl(value).replace(/\/+$/, '').toLowerCase();
  return !!a && !!b && normalise(a) === normalise(b);
}

async function createContactShadow() {
  const totalW = HEX_W + SHADOW_PAD * 2;
  const totalH = HEX_H + SHADOW_PAD * 2;
  const pts = [
    `${SHADOW_PAD + HEX_W * 0.5},${SHADOW_PAD}`,
    `${SHADOW_PAD + HEX_W},${SHADOW_PAD + HEX_H * 0.25}`,
    `${SHADOW_PAD + HEX_W},${SHADOW_PAD + HEX_H * 0.75}`,
    `${SHADOW_PAD + HEX_W * 0.5},${SHADOW_PAD + HEX_H}`,
    `${SHADOW_PAD},${SHADOW_PAD + HEX_H * 0.75}`,
    `${SHADOW_PAD},${SHADOW_PAD + HEX_H * 0.25}`
  ].join(' ');
  const svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s"><feGaussianBlur stdDeviation="${SHADOW_BLUR}"/></filter></defs><polygon points="${pts}" fill="rgba(0,0,0,0.28)" filter="url(#s)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createWallContactHighlight() {
  const svg = `<svg width="${HEX_W}" height="${HEX_H}" viewBox="0 0 ${HEX_W} ${HEX_H}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(HEX_W, HEX_H)}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1"/><polygon points="${hexPoints(HEX_W, HEX_H)}" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1.2"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createDepthLayer() {
  const totalW = HEX_W + DEPTH_OFFSET_X;
  const totalH = HEX_H + DEPTH_OFFSET_Y;
  const pts = hexPoints(HEX_W, HEX_H, DEPTH_OFFSET_X, DEPTH_OFFSET_Y);
  const svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg"><polygon points="${pts}" fill="rgba(12,10,8,0.52)"/><polygon points="${pts}" fill="url(#edge)"/><defs><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,0.08)"/><stop offset="0.45" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.28)"/></linearGradient></defs></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function hexPoints(w, h, ox = 0, oy = 0) {
  return [
    `${ox + w * 0.5},${oy}`,
    `${ox + w},${oy + h * 0.25}`,
    `${ox + w},${oy + h * 0.75}`,
    `${ox + w * 0.5},${oy + h}`,
    `${ox},${oy + h * 0.75}`,
    `${ox},${oy + h * 0.25}`
  ].join(' ');
}

function hexMaskSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(w, h)}" fill="white"/></svg>`;
}

function hexStrokeSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,0.16)"/><stop offset="0.42" stop-color="rgba(255,255,255,0.02)"/><stop offset="1" stop-color="rgba(0,0,0,0.15)"/></linearGradient></defs><polygon points="${hexPoints(w, h)}" fill="url(#surface)"/><polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="1"/><polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="1.2"/></svg>`;
}

function isNoRowsError(error) {
  return error && (error.code === 'PGRST116' || /no rows/i.test(error.message || ''));
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
