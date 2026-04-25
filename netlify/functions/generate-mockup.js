const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BUCKET = 'product-images';
const HEX_SIZE = 210;
const ORIGIN_X = 470;
const ORIGIN_Y = 185;
const FRAME_WIDTH = 4;
const FRAME_COLOUR = '#111111';
const CONTACT_SHADOW = 'rgba(0,0,0,0.16)';

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

        const pieceCount = getPieceCount(product);
        const productBuffer = await fetchBuffer(imageUrl);
        const mockupBuffer = await generateMockup({ wallBuffer, productBuffer, pieceCount });
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
  const direct = parseInt(product.pieces || product.panel_count || product.tile_count, 10);
  if (Number.isFinite(direct) && direct > 0) return Math.min(direct, 24);
  if (Array.isArray(product.panel_names) && product.panel_names.length) return Math.min(product.panel_names.length, 24);
  if (Array.isArray(product.panelImages) && product.panelImages.length) return Math.min(product.panelImages.length, 24);
  return 3;
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

async function generateMockup({ wallBuffer, productBuffer, pieceCount }) {
  const wallMeta = await sharp(wallBuffer).metadata();
  const wallWidth = wallMeta.width || 1200;
  const wallHeight = wallMeta.height || 800;
  const positions = getHoneycombPositions(pieceCount);
  const bounds = getBounds(positions);
  const pieceImages = await createSlicedFramedPieces(productBuffer, positions, bounds);
  const shadow = await createContactShadow();
  const composites = [];

  for (let i = 0; i < positions.length; i += 1) {
    const left = Math.round(ORIGIN_X + positions[i].x);
    const top = Math.round(ORIGIN_Y + positions[i].y);
    composites.push({ input: shadow, left: left + 3, top: top + 4 });
    composites.push({ input: pieceImages[i], left, top });
    composites.push({ input: await createWallContactHighlight(), left, top });
  }

  return sharp(wallBuffer)
    .resize({ width: wallWidth, height: wallHeight, fit: 'cover' })
    .modulate({ brightness: 0.995 })
    .composite(composites)
    .png({ quality: 92 })
    .toBuffer();
}

function getHoneycombPositions(count) {
  const stepX = HEX_SIZE * 0.75;
  const stepY = HEX_SIZE * 0.5;
  const coordsByCount = {
    1: [[0, 0]],
    2: [[0, 0], [1, 0]],
    3: [[0, 0], [1, 0], [0.5, 1]],
    4: [[0.5, 0], [1.5, 0], [0, 1], [1, 1]],
    5: [[0.5, 0], [1.5, 0], [0, 1], [1, 1], [2, 1]],
    6: [[0.5, 0], [1.5, 0], [0, 1], [1, 1], [2, 1], [0.5, 2]],
    7: [[1, 0], [0.5, 1], [1.5, 1], [0, 2], [1, 2], [2, 2], [1, 3]]
  };

  const coords = coordsByCount[count] || makeRows(count);
  return coords.map(([col, row]) => ({ x: col * stepX, y: row * stepY }));
}

function makeRows(count) {
  const rows = [];
  let remaining = count;
  let row = 0;
  while (remaining > 0) {
    const rowCount = Math.min(4, remaining);
    const offset = row % 2 ? 0 : 0.5;
    for (let col = 0; col < rowCount; col += 1) rows.push([col + offset, row]);
    remaining -= rowCount;
    row += 1;
  }
  return rows;
}

function getBounds(positions) {
  const minX = Math.min(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxX = Math.max(...positions.map(p => p.x + HEX_SIZE));
  const maxY = Math.max(...positions.map(p => p.y + HEX_SIZE));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

async function createSlicedFramedPieces(productBuffer, positions, bounds) {
  const innerSize = HEX_SIZE - FRAME_WIDTH * 2;
  const imageCanvas = await sharp(productBuffer)
    .resize(Math.round(bounds.width), Math.round(bounds.height), { fit: 'cover' })
    .png()
    .toBuffer();

  const outerMask = Buffer.from(hexMaskSvg(HEX_SIZE));
  const innerMask = Buffer.from(hexMaskSvg(innerSize));
  const pieces = [];

  for (const pos of positions) {
    const cropLeft = Math.max(0, Math.round(pos.x - bounds.minX));
    const cropTop = Math.max(0, Math.round(pos.y - bounds.minY));

    const slice = await sharp(imageCanvas)
      .extract({ left: cropLeft, top: cropTop, width: HEX_SIZE, height: HEX_SIZE })
      .resize(innerSize, innerSize, { fit: 'cover' })
      .composite([{ input: innerMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    const frame = await sharp({
      create: {
        width: HEX_SIZE,
        height: HEX_SIZE,
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
        { input: Buffer.from(hexStrokeSvg(HEX_SIZE)), left: 0, top: 0 }
      ])
      .png()
      .toBuffer();

    pieces.push(piece);
  }

  return pieces;
}

async function createContactShadow() {
  const pad = 8;
  const total = HEX_SIZE + pad * 2;
  const shiftedPoints = [
    `${pad + HEX_SIZE * 0.5},${pad}`,
    `${pad + HEX_SIZE},${pad + HEX_SIZE * 0.25}`,
    `${pad + HEX_SIZE},${pad + HEX_SIZE * 0.75}`,
    `${pad + HEX_SIZE * 0.5},${pad + HEX_SIZE}`,
    `${pad},${pad + HEX_SIZE * 0.75}`,
    `${pad},${pad + HEX_SIZE * 0.25}`
  ].join(' ');
  const svg = `<svg width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s"><feGaussianBlur stdDeviation="2.3"/></filter></defs><polygon points="${shiftedPoints}" fill="${CONTACT_SHADOW}" filter="url(#s)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createWallContactHighlight() {
  const svg = `<svg width="${HEX_SIZE}" height="${HEX_SIZE}" viewBox="0 0 ${HEX_SIZE} ${HEX_SIZE}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(HEX_SIZE)}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1"/><polygon points="${hexPoints(HEX_SIZE)}" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1.2"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function hexPoints(size) {
  return [
    `${size * 0.5},0`,
    `${size},${size * 0.25}`,
    `${size},${size * 0.75}`,
    `${size * 0.5},${size}`,
    `0,${size * 0.75}`,
    `0,${size * 0.25}`
  ].join(' ');
}

function hexMaskSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(size)}" fill="white"/></svg>`;
}

function hexStrokeSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><polygon points="${hexPoints(size)}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1"/><polygon points="${hexPoints(size)}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1.2"/></svg>`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
