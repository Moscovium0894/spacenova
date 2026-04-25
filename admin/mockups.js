const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const {
  inferPlateCount,
  normalisePlateMap,
  smartPlatePositions,
  isMissingColumnError
} = require('./plate-helpers');

const DEFAULT_BUCKET = 'product-images';

// ─── Hex geometry constants ────────────────────────────────────────────────
// Pointy-top hexagon, gap-free interlocking:
//
//   HEX_H       = full height of one tile
//   HEX_W       = HEX_H × √3/2  (exact, no rounding on pitch calculations)
//   ROW_PITCH   = HEX_H × 0.75  (rows share an edge — no gap)
//   COL_PITCH   = HEX_W         (columns share an edge — no gap)
//   ODD_OFFSET  = HEX_W / 2     (alternate rows shift right by half a tile)
//
// Using floats for all pitch calculations avoids sub-pixel gaps that
// integer rounding would introduce. Only the final pixel positions are
// rounded to whole numbers.
const HEX_H        = 210;
const HEX_W        = HEX_H * Math.sqrt(3) / 2;  // ≈ 181.87
const ROW_PITCH    = HEX_H * 0.75;               // = 157.5  (zero-gap row step)
const COL_PITCH    = HEX_W;                      // ≈ 181.87 (zero-gap col step)
const ODD_OFFSET   = HEX_W / 2;                  // ≈ 90.93

// Visual framing
const FRAME_WIDTH   = 5;
const FRAME_COLOUR  = '#1a1a1a';

// Drop shadow (rendered behind each tile, not overlapping neighbours)
const SHADOW_BLUR   = 6;
const SHADOW_PAD    = 20;
const SHADOW_OFFSET_X = 10;
const SHADOW_OFFSET_Y = 10;

// Parallax depth edge (dark sliver below/right each tile)
const DEPTH_OFFSET_X = 5;
const DEPTH_OFFSET_Y = 7;

// Cluster origin on the wall canvas (top-left of bounding box)
const ORIGIN_X = 470;
const ORIGIN_Y = 185;

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
        const plateImages = getPlateImages(product);

        const productBuffer = await fetchBuffer(imageUrl);
        const mockupBuffer = await generateMockup({ wallBuffer, productBuffer, positions, plateImages, imageUrl });

        const productKey = getProductKey(product);
        const storagePath = `mockups/${safeStorageName(productKey)}-mockup.png`;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, mockupBuffer, { contentType: 'image/png', upsert: true });

        if (uploadError) throw uploadError;

        const wallImage = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
        await updateProductWallImage(supabase, product, wallImage, wallImageUrl);

        results.push({
          productId: product.id || product.slug,
          slug: product.slug || null,
          name: product.name,
          pieces: positions.length,
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

// ─── Product helpers ──────────────────────────────────────────────────────

function getProductKey(product) {
  return product.slug || product.id || product.name || `product-${Date.now()}`;
}

function safeStorageName(value) {
  return String(value || 'product')
    .trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
}

function getStoredPlatePositions(product) {
  const plateMap = product.plate_map || product.plateMap || product.panel_map || product.panelMap;
  return (plateMap && Array.isArray(plateMap.positions) && plateMap.positions.length)
    ? plateMap.positions
    : null;
}

function getPositions(product) {
  const stored = getStoredPlatePositions(product);
  if (stored && stored.length > 0) {
    const positions = stored
      .map(p => gridToPixel(parseInt(p.row, 10) || 0, parseInt(p.col, 10) || 0))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (positions.length > 0) return positions;
  }
  return autoHoneycomb(inferPlateCount(product));
}

/** Extract per-plate image URLs (if any) from product data */
function getPlateImages(product) {
  const arr = product.plate_images || product.plateImages || product.panel_images || product.panelImages;
  return Array.isArray(arr) ? arr : [];
}

async function getProductByIdentifier(supabase, identifier) {
  const value = String(identifier || '').trim();
  if (!value) return { data: null, error: new Error('Missing product identifier') };

  const bySlug = await supabase.from('products').select('*').eq('slug', value).maybeSingle();
  if (bySlug.data || (bySlug.error && !isNoRowsError(bySlug.error))) return bySlug;
  return supabase.from('products').select('*').eq('id', value).maybeSingle();
}

async function updateProductWallImage(supabase, product, wallImage, wallSourceImage) {
  const attempts = [];
  if (product.slug) attempts.push({ column: 'slug', value: product.slug });
  if (product.id !== undefined && product.id !== null) attempts.push({ column: 'id', value: product.id });

  let lastError = null;
  for (const attempt of attempts) {
    const updatePayload = { wall_image: wallImage, wall_source_image: wallSourceImage || null };
    let { data, error } = await supabase
      .from('products').update(updatePayload).eq(attempt.column, attempt.value).select(attempt.column);

    if (error && isMissingColumnError(error)) {
      ({ data, error } = await supabase
        .from('products').update({ wall_image: wallImage }).eq(attempt.column, attempt.value).select(attempt.column));
    }

    if (!error && data && data.length > 0) return data[0];
    if (error) lastError = error;
  }
  throw lastError || new Error(`No product row matched ${product.slug || product.id || 'unknown'}`);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────

/**
 * Convert grid coordinates to pixel position (top-left of tile bounding box).
 * Uses float arithmetic to avoid rounding-induced gaps.
 */
function gridToPixel(row, col) {
  return {
    x: col * COL_PITCH + (row % 2 !== 0 ? ODD_OFFSET : 0),
    y: row * ROW_PITCH
  };
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

// ─── Mockup composer ──────────────────────────────────────────────────────

async function generateMockup({ wallBuffer, productBuffer, positions, plateImages, imageUrl }) {
  const wallMeta = await sharp(wallBuffer).metadata();
  const wallW = wallMeta.width || 1200;
  const wallH = wallMeta.height || 800;

  if (!positions || !positions.length) positions = autoHoneycomb(3);
  const bounds = getBounds(positions);

  // Build tile images. If a plate has its own image URL, fetch and use it;
  // otherwise slice from the main product image.
  const tileBuffers = await buildTileBuffers(productBuffer, positions, bounds, plateImages, imageUrl);

  const shadowBuffer = await createContactShadow();
  const depthBuffer  = await createDepthLayer();
  const highlightBuffer = await createWallContactHighlight();

  const composites = [];
  for (let i = 0; i < positions.length; i++) {
    const left = Math.round(ORIGIN_X + positions[i].x);
    const top  = Math.round(ORIGIN_Y + positions[i].y);

    composites.push({ input: shadowBuffer,    left: left - SHADOW_PAD + SHADOW_OFFSET_X, top: top - SHADOW_PAD + SHADOW_OFFSET_Y });
    composites.push({ input: depthBuffer,     left, top });
    composites.push({ input: tileBuffers[i],  left, top });
    composites.push({ input: highlightBuffer, left, top });
  }

  return sharp(wallBuffer)
    .resize({ width: wallW, height: wallH, fit: 'cover' })
    .modulate({ brightness: 0.995 })
    .composite(composites)
    .png({ quality: 92 })
    .toBuffer();
}

/**
 * Build a framed hex tile for each plate.
 * - If the plate has its own image URL → fetch and fill the tile
 * - Otherwise → slice a proportional crop from the main product image
 */
async function buildTileBuffers(productBuffer, positions, bounds, plateImages, mainImageUrl) {
  const tileW  = Math.round(HEX_W);
  const tileH  = Math.round(HEX_H);
  const innerW = tileW - FRAME_WIDTH * 2;
  const innerH = tileH - FRAME_WIDTH * 2;

  // Resize the main product image to cover the entire cluster bounds
  const canvasW = Math.max(tileW, Math.round(bounds.width));
  const canvasH = Math.max(tileH, Math.round(bounds.height));
  const mainCanvas = await sharp(productBuffer)
    .resize(canvasW, canvasH, { fit: 'cover' })
    .png()
    .toBuffer();

  const outerMask = Buffer.from(hexMaskSvg(tileW, tileH));
  const innerMask = Buffer.from(hexMaskSvg(innerW, innerH));

  // Cache for individually-fetched plate images
  const fetchedCache = {};

  const tiles = [];
  for (let i = 0; i < positions.length; i++) {
    const pos    = positions[i];
    const imgUrl = plateImages[i] && plateImages[i].trim() ? plateImages[i].trim() : null;

    let sliceBuffer;

    if (imgUrl && imgUrl !== mainImageUrl) {
      // Individual plate image
      if (!fetchedCache[imgUrl]) {
        try {
          fetchedCache[imgUrl] = await fetchBuffer(imgUrl);
        } catch (_) {
          fetchedCache[imgUrl] = productBuffer; // fallback to main on error
        }
      }
      sliceBuffer = await sharp(fetchedCache[imgUrl])
        .resize(innerW, innerH, { fit: 'cover' })
        .composite([{ input: innerMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } else {
      // Crop from main product image
      const cropLeft = Math.max(0, Math.round(pos.x - bounds.minX));
      const cropTop  = Math.max(0, Math.round(pos.y - bounds.minY));
      const safeLeft = Math.min(cropLeft, Math.max(0, canvasW - tileW));
      const safeTop  = Math.min(cropTop,  Math.max(0, canvasH - tileH));

      sliceBuffer = await sharp(mainCanvas)
        .extract({ left: safeLeft, top: safeTop, width: tileW, height: tileH })
        .resize(innerW, innerH, { fit: 'cover' })
        .composite([{ input: innerMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    }

    // Compose: dark frame → photo slice → surface gloss → edge stroke
    const frame = await sharp({
      create: { width: tileW, height: tileH, channels: 4, background: FRAME_COLOUR }
    })
      .composite([{ input: outerMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    const tile = await sharp(frame)
      .composite([
        { input: sliceBuffer, left: FRAME_WIDTH, top: FRAME_WIDTH },
        { input: Buffer.from(hexStrokeSvg(tileW, tileH)), left: 0, top: 0 }
      ])
      .png()
      .toBuffer();

    tiles.push(tile);
  }
  return tiles;
}

// ─── SVG helpers ──────────────────────────────────────────────────────────

/** Pointy-top hex vertex string for use in SVG <polygon> */
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
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<polygon points="${hexPoints(w, h)}" fill="white"/></svg>`;
}

function hexStrokeSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="rgba(255,255,255,0.16)"/>` +
      `<stop offset="0.42" stop-color="rgba(255,255,255,0.02)"/>` +
      `<stop offset="1" stop-color="rgba(0,0,0,0.15)"/>` +
    `</linearGradient></defs>` +
    `<polygon points="${hexPoints(w, h)}" fill="url(#surface)"/>` +
    `<polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="1"/>` +
    `<polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="1.2"/>` +
    `</svg>`;
}

async function createContactShadow() {
  const totalW = Math.round(HEX_W) + SHADOW_PAD * 2;
  const totalH = Math.round(HEX_H) + SHADOW_PAD * 2;
  const pts = hexPoints(Math.round(HEX_W), Math.round(HEX_H), SHADOW_PAD, SHADOW_PAD);
  const svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><filter id="s"><feGaussianBlur stdDeviation="${SHADOW_BLUR}"/></filter></defs>` +
    `<polygon points="${pts}" fill="rgba(0,0,0,0.28)" filter="url(#s)"/>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createWallContactHighlight() {
  const w = Math.round(HEX_W);
  const h = Math.round(HEX_H);
  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>` +
    `<polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1.2"/>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createDepthLayer() {
  const w = Math.round(HEX_W);
  const h = Math.round(HEX_H);
  const totalW = w + DEPTH_OFFSET_X;
  const totalH = h + DEPTH_OFFSET_Y;
  const pts = hexPoints(w, h, DEPTH_OFFSET_X, DEPTH_OFFSET_Y);
  const svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="rgba(255,255,255,0.08)"/>` +
      `<stop offset="0.45" stop-color="rgba(0,0,0,0)"/>` +
      `<stop offset="1" stop-color="rgba(0,0,0,0.28)"/>` +
    `</linearGradient></defs>` +
    `<polygon points="${pts}" fill="rgba(12,10,8,0.52)"/>` +
    `<polygon points="${pts}" fill="url(#edge)"/>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Network helpers ──────────────────────────────────────────────────────

function normaliseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.pathname = url.pathname.split('/').map(part =>
      encodeURIComponent(decodeURIComponent(part))
    ).join('/');
    return url.toString();
  } catch (_) {
    return value.replace(/ /g, '%20');
  }
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Misc helpers ─────────────────────────────────────────────────────────

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
