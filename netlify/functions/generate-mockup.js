const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BUCKET = 'product-images';
const HEX_SIZE = 210;
const ORIGIN_X = 520;
const ORIGIN_Y = 190;
const FRAME_WIDTH = 5;
const FRAME_COLOUR = '#111111';

const LAYOUTS = {
  single: [{ x: 0, y: 0 }],
  three: [{ x: 0, y: 0 }, { x: 0.75, y: 0 }, { x: 0.375, y: 0.65 }],
  five: [{ x: 0.375, y: 0 }, { x: 1.125, y: 0 }, { x: 0, y: 0.65 }, { x: 0.75, y: 0.65 }, { x: 1.5, y: 0.65 }],
  seven: [{ x: 0.75, y: 0 }, { x: 0, y: 0.65 }, { x: 0.75, y: 0.65 }, { x: 1.5, y: 0.65 }, { x: 0, y: 1.3 }, { x: 0.75, y: 1.3 }, { x: 1.5, y: 1.3 }]
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const layoutName = body.layout || 'three';
    const wallImageUrl = body.wallImageUrl || process.env.DEFAULT_WALL_IMAGE_URL;
    const bucket = process.env.SUPABASE_BUCKET || DEFAULT_BUCKET;

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { success: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable' });
    }

    if (!wallImageUrl) {
      return json(400, { success: false, error: 'Missing wallImageUrl and DEFAULT_WALL_IMAGE_URL is not set' });
    }

    if (!LAYOUTS[layoutName]) {
      return json(400, { success: false, error: `Unknown layout: ${layoutName}` });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    let products = [];
    if (body.all) {
      const { data, error } = await supabase.from('products').select('*');
      if (error) throw error;
      products = data || [];
    } else if (body.productId) {
      const { data, error } = await supabase.from('products').select('*').eq('id', body.productId).single();
      if (error || !data) return json(404, { success: false, error: 'Product not found' });
      products = [data];
    } else {
      return json(400, { success: false, error: 'Provide productId or all:true' });
    }

    const wallBuffer = await fetchBuffer(wallImageUrl);
    const results = [];

    for (const product of products) {
      try {
        const imageUrl = product.image || product.image_url || product.main_image || product.photo;
        if (!imageUrl) {
          results.push({ productId: product.id, success: false, skipped: true, error: 'No product image URL found' });
          continue;
        }

        const productBuffer = await fetchBuffer(imageUrl);
        const mockupBuffer = await generateMockup({ wallBuffer, productBuffer, layoutName });
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

        results.push({ productId: product.id, name: product.name, success: true, wall_image: wallImage });
      } catch (err) {
        results.push({ productId: product.id, name: product.name, success: false, error: err.message });
      }
    }

    return json(200, { success: true, results });
  } catch (err) {
    console.error('generate-mockup error:', err);
    return json(500, { success: false, error: err.message || 'Failed to generate mockup' });
  }
};

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateMockup({ wallBuffer, productBuffer, layoutName }) {
  const wallMeta = await sharp(wallBuffer).metadata();
  const wallWidth = wallMeta.width || 1200;
  const wallHeight = wallMeta.height || 800;

  const productHex = await createFramedProductHex(productBuffer);
  const shadow = await createHexShadow();
  const composites = [];

  for (const pos of LAYOUTS[layoutName]) {
    const left = Math.round(ORIGIN_X + pos.x * HEX_SIZE);
    const top = Math.round(ORIGIN_Y + pos.y * HEX_SIZE);
    composites.push({ input: shadow, left: left + 7, top: top + 9 });
    composites.push({ input: productHex, left, top });
  }

  return sharp(wallBuffer)
    .resize({ width: wallWidth, height: wallHeight, fit: 'cover' })
    .composite(composites)
    .png({ quality: 92 })
    .toBuffer();
}

async function createFramedProductHex(productBuffer) {
  const outerMask = Buffer.from(hexMaskSvg(HEX_SIZE));
  const innerSize = HEX_SIZE - FRAME_WIDTH * 2;
  const innerMask = Buffer.from(hexMaskSvg(innerSize));

  const framedBase = await sharp({
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

  const innerImage = await sharp(productBuffer)
    .resize(innerSize, innerSize, { fit: 'cover' })
    .composite([{ input: innerMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(framedBase)
    .composite([{ input: innerImage, left: FRAME_WIDTH, top: FRAME_WIDTH }])
    .png()
    .toBuffer();
}

async function createHexShadow() {
  const svg = hexShadowSvg(HEX_SIZE);
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

function hexShadowSvg(size) {
  const pad = 28;
  const total = size + pad * 2;
  const shiftedPoints = [
    `${pad + size * 0.5},${pad}`,
    `${pad + size},${pad + size * 0.25}`,
    `${pad + size},${pad + size * 0.75}`,
    `${pad + size * 0.5},${pad + size}`,
    `${pad},${pad + size * 0.75}`,
    `${pad},${pad + size * 0.25}`
  ].join(' ');

  return `<svg width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="8"/></filter></defs><polygon points="${shiftedPoints}" fill="rgba(0,0,0,0.22)" filter="url(#s)"/></svg>`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
