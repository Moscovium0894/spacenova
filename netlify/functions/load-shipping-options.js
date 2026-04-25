const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY  // public read — no auth needed
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=120, stale-while-revalidate=300'
  };

  try {
    let { data, error } = await queryShippingOptions(true);

    if (error) {
      console.warn('load-shipping-options: active option query failed, retrying without active filter:', error.message || error);
      ({ data, error } = await queryShippingOptions(false));
    } else if (!data || data.length === 0) {
      console.warn('load-shipping-options: no active options, falling back to all');
      ({ data, error } = await queryShippingOptions(false));
    }

    if (error || !data || data.length === 0) {
      console.error('load-shipping-options error:', error);
      return { statusCode: 200, headers, body: JSON.stringify({ options: defaultShippingOptions() }) };
    }

    const options = (data || []).map(o => ({
      key:           o.key,
      label:         o.label,
      description:   o.description || '',
      price:         parseFloat(o.price),
      freeThreshold: o.free_threshold != null ? parseFloat(o.free_threshold) : null,
      region:        o.region
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ options })
    };
  } catch (err) {
    console.error('load-shipping-options fatal:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ options: defaultShippingOptions() }) };
  }
};

async function queryShippingOptions(filterActive, includeSortOrder = true) {
  const selectColumns = includeSortOrder
    ? 'key, label, description, price, free_threshold, region, sort_order'
    : 'key, label, description, price, free_threshold, region';

  let query = supabase
    .from('shipping_options')
    .select(selectColumns);

  if (filterActive) query = query.eq('active', true);
  if (includeSortOrder) query = query.order('sort_order', { ascending: true });

  const result = await query;
  if (result.error && includeSortOrder && isMissingColumnError(result.error, 'sort_order')) {
    console.warn('load-shipping-options: sort_order unavailable, retrying without sort_order');
    return queryShippingOptions(filterActive, false);
  }

  return result;
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

function isMissingColumnError(error, column) {
  const message = String((error && (error.message || error.details || error.hint || error.code)) || '');
  return message.toLowerCase().includes(column.toLowerCase());
}
