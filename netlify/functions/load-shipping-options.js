const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, max-age=0'
  };

  try {
    const { data, error } = await supabase
      .from('shipping_options')
      .select('*');

    if (error) {
      console.error('load-shipping-options error:', error);
      return { statusCode: 200, headers, body: JSON.stringify({ options: defaultShippingOptions(), source: 'fallback' }) };
    }

    const options = normaliseShippingOptions(data || []);
    if (!options.length) {
      console.warn('load-shipping-options: no database options found, using defaults');
      return { statusCode: 200, headers, body: JSON.stringify({ options: defaultShippingOptions(), source: 'fallback' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ options, source: 'database' })
    };
  } catch (err) {
    console.error('load-shipping-options fatal:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ options: defaultShippingOptions(), source: 'fallback' }) };
  }
};

function normaliseShippingOptions(rawRows) {
  const rows = rawRows.map((row, index) => ({
    key: cleanKey(getField(row, ['key', 'shipping_key', 'method_key', 'method', 'code', 'slug', 'id']), index),
    label: getField(row, ['label', 'name', 'service', 'method', 'title']),
    description: getField(row, ['description', 'delivery', 'delivery_time', 'estimated_time', 'eta', 'time']) || '',
    price: moneyOr(getField(row, ['price', 'amount', 'cost', 'shipping_price', 'rate']), 0),
    freeThreshold: nullableMoney(getField(row, ['free_threshold', 'freeThreshold', 'free_over', 'free_shipping_threshold', 'free_delivery_threshold'])),
    region: getField(row, ['region', 'zone', 'country_group', 'destination', 'area']) || 'Worldwide',
    sortOrder: numberOr(getField(row, ['sort_order', 'sortOrder', 'order', 'position', 'display_order']), index),
    active: activeState(getField(row, ['active', 'is_active', 'enabled', 'published', 'is_published']))
  })).filter(row => row.key && row.label);

  const hasActiveValues = rows.some(row => row.active !== null);
  const activeRows = hasActiveValues ? rows.filter(row => row.active !== false) : rows;
  if (hasActiveValues && activeRows.length === 0 && rows.length > 0) {
    console.warn('load-shipping-options: active flag filtered every row, returning all options');
  }

  return (activeRows.length ? activeRows : rows)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map(({ key, label, description, price, freeThreshold, region }) => ({
      key,
      label,
      description,
      price,
      freeThreshold,
      region
    }));
}

function defaultShippingOptions() {
  return [
    { key: 'uk_standard',    label: 'UK Standard',           description: '3-5 working days',   price: 4.99,  freeThreshold: 150,  region: 'United Kingdom' },
    { key: 'uk_express',     label: 'UK Express',            description: '1-2 working days',   price: 9.99,  freeThreshold: null, region: 'United Kingdom' },
    { key: 'eu_standard',    label: 'Europe Standard',       description: '5-10 working days',  price: 12.99, freeThreshold: null, region: 'Europe' },
    { key: 'us_ca_standard', label: 'USA & Canada Standard', description: '7-14 working days',  price: 14.99, freeThreshold: null, region: 'USA & Canada' },
    { key: 'row_standard',   label: 'Rest of World Standard', description: '10-21 working days', price: 17.99, freeThreshold: null, region: 'Rest of World' }
  ];
}

function getField(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined && row[name] !== '') {
      return row[name];
    }
  }
  return null;
}

function cleanKey(value, fallbackIndex) {
  const raw = value == null ? `shipping_${fallbackIndex + 1}` : String(value);
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function moneyOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullableMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function activeState(value) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === '') return null;
  const normalised = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalised)) return true;
  if (['false', '0', 'no', 'n'].includes(normalised)) return false;
  return null;
}
