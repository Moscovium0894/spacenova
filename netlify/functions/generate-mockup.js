const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BUCKET = 'product-images';
const HEX_H = 210;
const HEX_W = Math.round(HEX_H * 0.866);
const HEX_GAP = 2;
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
      const { data, error } = await supabase.from('products').select('*').eq('id', body.productId).single();
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
        const mockupBuffer = await generateMockup({ wallBuffer, productBuffer, positions });
        const storagePath = `mockups/${product.id}-wall-mockup.png`;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, mockupBuffer, {
            contentType: 'image/png',
            upsert: true
          });

        if (uploadError) throw uploadError;

        const wallImage = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
        const { error: updateError } = await supabase
          .from('products')
          .update({ wall_image: wallImage })
          .eq('id', product.id);

        if (updateError) throw updateError;

        results.push({ productId: product.id, name: product.name, pieces: pieceCount, success: true, wall_image: wallImage });
      } catch (err) {
        results.push({ productId: product.id, name: product.name, success: false, error: err.message });
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
  const mapped = getPanelMapPositions(product);
  if (mapped && mapped.length > 0) return mapped.length;
  const direct = parseInt(product.pieces || product.panel_count || product.tile_count, 10);
  if (Number.isFinite(direct) && direct > 0) return Math.min(direct, 24);
  if (Array.isArray(product.panel_names) && product.panel_names.length) return Math.min(product.panel_names.length, 24);
  if (Array.isArray(product.panelImages) && product.panelImages.length) return Math.min(product.panelImages.length, 24);
  return 3;
}

function getPanelMapPositions(product) {
  const panelMap = product.panel_map || product.panelMap;
  return panelMap && Array.isArray(panelMap.positions) ? panelMap.positions : null;
}

function getPositions(product) {
  const mapped = getPanelMapPositions(product);
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

async function generateMockup({ wallBuffer, productBuffer, positions, pieceCount }) {
  const wallMeta = await sharp(wallBuffer).metadata();
  const wallWidth = wallMeta.width || 1200;
  const wallHeight = wallMeta.height || 800;
  const tilePositions = Array.isArray(positions) && positions.length ? positions : autoHoneycomb(pieceCount || 3);
  const bounds = getBounds(tilePositions);
  const pieceImages = await createSlicedFramedPieces(productBuffer, tilePositions, bounds);
  const shadow = await createContactShadow();
  const highlight = await createWallContactHighlight();
  const composites = [];

  for (let i = 0; i < tilePositions.length; i += 1) {
    const left = Math.round(ORIGIN_X + tilePositions[i].x);
    const top = Math.round(ORIGIN_Y + tilePositions[i].y);
    composites.push({ input: shadow, left: left - SHADOW_PAD + SHADOW_OFFSET_X, top: top - SHADOW_PAD + SHADOW_OFFSET_Y });
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
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
  const result = [];
  let placed = 0;
  let row = 0;

  while (placed < count) {
    const rowCols = Math.min(cols, count - placed);
    for (let col = 0; col < rowCols; col += 1) result.push(gridToPixel(row, col));
    placed += rowCols;
    row += 1;
  }

  return result;
}

function getBounds(positions) {
  const minX = Math.min(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxX = Math.max(...positions.map(p => p.x + HEX_W));
  const maxY = Math.max(...positions.map(p => p.y + HEX_H));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

async function createSlicedFramedPieces(productBuffer, positions, bounds) {
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

  for (const pos of positions) {
    const cropLeft = Math.max(0, Math.round(pos.x - bounds.minX));
    const cropTop = Math.max(0, Math.round(pos.y - bounds.minY));
    const safeLeft = Math.min(cropLeft, Math.max(0, canvasW - HEX_W));
    const safeTop = Math.min(cropTop, Math.max(0, canvasH - HEX_H));

    const slice = await sharp(imageCanvas)
      .extract({ left: safeLeft, top: safeTop, width: HEX_W, height: HEX_H })
      .resize(innerW, innerH, { fit: 'cover' })
      .composite([{ input: innerMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

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

function hexMaskSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(w, h)}" fill="white"/></svg>`;
}

function hexStrokeSvg(w, h) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1"/><polygon points="${hexPoints(w, h)}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1.2"/></svg>`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
