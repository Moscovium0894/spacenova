const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { inferPlateCount, resolvePlatePricing } = require('./plate-helpers');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const FALLBACK_SHIPPING = {
  uk_standard:    { label: 'UK Standard',    amount: 4.99,  freeThreshold: 150 },
  uk_express:     { label: 'UK Express',      amount: 9.99,  freeThreshold: null },
  eu_standard:    { label: 'Europe Standard', amount: 12.99, freeThreshold: null },
  us_ca_standard: { label: 'USA & Canada',    amount: 14.99, freeThreshold: null },
  row_standard:   { label: 'Rest of World',   amount: 17.99, freeThreshold: null }
};

async function getShippingOptions() {
  try {
    const { data, error } = await supabase
      .from('shipping_options')
      .select('*');

    if (error) {
      console.warn('getShippingOptions DB error - using fallback:', error.message || error);
      return FALLBACK_SHIPPING;
    }

    const map = {};
    normaliseShippingOptions(data || []).forEach(option => {
      map[option.key] = option;
    });

    return Object.keys(map).length ? map : FALLBACK_SHIPPING;
  } catch (e) {
    console.warn('getShippingOptions fatal DB error - using fallback:', e.message);
    return FALLBACK_SHIPPING;
  }
}

function toPence(value) {
  return Math.round(Number(value || 0) * 100);
}

function computeDiscount(subtotal, promo) {
  if (!promo || !promo.type) return 0;
  if (promo.type === 'percent') return subtotal * (Number(promo.value || 0) / 100);
  if (promo.type === 'fixed') return Math.min(Number(promo.value || 0), subtotal);
  return 0;
}

function normaliseShippingOptions(rawRows) {
  const rows = rawRows.map((row, index) => ({
    key: cleanKey(getField(row, ['key', 'shipping_key', 'method_key', 'method', 'code', 'slug', 'id']), index),
    label: getField(row, ['label', 'name', 'service', 'method', 'title']),
    amount: moneyOr(getField(row, ['price', 'amount', 'cost', 'shipping_price', 'rate']), 0),
    freeThreshold: nullableMoney(getField(row, ['free_threshold', 'freeThreshold', 'free_over', 'free_shipping_threshold', 'free_delivery_threshold'])),
    sortOrder: numberOr(getField(row, ['sort_order', 'sortOrder', 'order', 'position', 'display_order']), index),
    active: activeState(getField(row, ['active', 'is_active', 'enabled', 'published', 'is_published']))
  })).filter(row => row.key && row.label);

  const hasActiveValues = rows.some(row => row.active !== null);
  const activeRows = hasActiveValues ? rows.filter(row => row.active !== false) : rows;
  if (hasActiveValues && activeRows.length === 0 && rows.length > 0) {
    console.warn('getShippingOptions: active flag filtered every row, returning all options');
  }

  return (activeRows.length ? activeRows : rows)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map(({ key, label, amount, freeThreshold }) => ({
      key,
      label,
      amount,
      freeThreshold
    }));
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

function normalisePlateIndexes(item) {
  if (Array.isArray(item.selectedPlateIndexes)) {
    return item.selectedPlateIndexes.map(Number).filter(Number.isFinite);
  }
  if (Array.isArray(item.plates)) {
    return item.plates
      .map(plate => Number(plate && (plate.index ?? plate.number - 1)))
      .filter(Number.isFinite);
  }
  return [];
}

function compactItem(item) {
  const indexes = normalisePlateIndexes(item);
  const plateToken = indexes.join(',');
  const plateCount = Number(item.plateCount || 0) || '';
  const priceMode = item.isFullSet ? 'set' : (item.priceMode || '');
  return [
    String(item.id || '').slice(0, 40),
    Number(item.qty || item.quantity || 1),
    Number(item.price || 0).toFixed(2),
    String(item.name || '').replace(/[|:]/g, '').slice(0, 50),
    plateToken,
    plateCount,
    String(priceMode).replace(/[|:]/g, '').slice(0, 16)
  ].join('::');
}

async function priceItemsFromCatalogue(items) {
  const slugs = Array.from(new Set(items
    .map(item => item.productSlug || item.slug || '')
    .filter(Boolean)));

  if (!slugs.length) return items;

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .in('slug', slugs);

    if (error) {
      console.warn('priceItemsFromCatalogue DB error - using basket prices:', error.message || error);
      return items;
    }

    const bySlug = {};
    (data || []).forEach(product => { bySlug[product.slug] = product; });

    return items.map(item => {
      const slug = item.productSlug || item.slug || '';
      const product = bySlug[slug];
      if (!product) return item;

      const plateCount = inferPlateCount(product);
      const pricing = resolvePlatePricing(product, plateCount);
      const selectedCount = normalisePlateIndexes(item).length;
      const itemPrice = selectedCount && selectedCount < plateCount
        ? selectedCount * pricing.unitPrice
        : pricing.setPrice;

      return {
        ...item,
        price: Number(itemPrice.toFixed(2)),
        plateCount,
        isFullSet: !selectedCount || selectedCount === plateCount,
        priceMode: (!selectedCount || selectedCount === plateCount) ? 'set' : 'individual'
      };
    });
  } catch (err) {
    console.warn('priceItemsFromCatalogue fatal - using basket prices:', err.message || err);
    return items;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body || '{}');
    let items = Array.isArray(data.items) ? data.items : [];
    const promo = data.promo || null;
    const requestedMethod = data.shippingMethod || 'uk_standard';

    if (!items.length) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Basket is empty' })
      };
    }

    const shippingOptions = await getShippingOptions();
    const shippingMethod = shippingOptions[requestedMethod]
      ? requestedMethod
      : Object.keys(shippingOptions)[0] || 'uk_standard';

    items = await priceItemsFromCatalogue(items);

    const subtotal = items.reduce((sum, item) => {
      return sum + Number(item.price || 0) * Number(item.qty || item.quantity || 1);
    }, 0);

    const discount = computeDiscount(subtotal, promo);
    const discountedSubtotal = Math.max(0, subtotal - discount);

    const selectedShipping = shippingOptions[shippingMethod];
    const shippingCost =
      selectedShipping.freeThreshold && discountedSubtotal >= selectedShipping.freeThreshold
        ? 0
        : selectedShipping.amount;

    const total = discountedSubtotal + shippingCost;
    const amount = toPence(total);

    if (!amount || amount < 50) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Invalid order total' })
      };
    }

    const compactItems = items
      .map(compactItem)
      .join('|')
      .slice(0, 500);

    const metadata = {
      items: compactItems,
      subtotal: subtotal.toFixed(2),
      discount: discount.toFixed(2),
      shipping_cost: shippingCost.toFixed(2),
      shipping_method: shippingMethod,
      shipping_label: selectedShipping.label,
      total: total.toFixed(2),
      promo_code: promo && promo.code ? String(promo.code) : ''
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        totals: {
          subtotal,
          discount,
          shipping: shippingCost,
          total,
          shippingMethod
        }
      })
    };
  } catch (err) {
    console.error('create-payment-intent error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message || 'Failed to create payment intent' })
    };
  }
};
