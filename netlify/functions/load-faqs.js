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
    let { data, error } = await queryFAQs(true);

    if (error) {
      console.warn('load-faqs: active FAQ query failed, retrying without active filter:', error.message || error);
      ({ data, error } = await queryFAQs(false));
    } else if (!data || data.length === 0) {
      console.warn('load-faqs: no active FAQs found, falling back to all FAQs');
      ({ data, error } = await queryFAQs(false));
    }

    if (error) {
      console.error('load-faqs error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load FAQs' }) };
    }

    // Group by category, preserving sort order within each group
    const grouped = {};
    const categoryOrder = [];
    for (const faq of (data || [])) {
      if (!grouped[faq.category]) {
        grouped[faq.category] = [];
        categoryOrder.push(faq.category);
      }
      grouped[faq.category].push({
        id:       faq.id,
        question: faq.question,
        answer:   faq.answer
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ categories: categoryOrder, faqs: grouped })
    };
  } catch (err) {
    console.error('load-faqs fatal:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load FAQs' }) };
  }
};

async function queryFAQs(filterActive, includeSortOrder = true) {
  const selectColumns = includeSortOrder
    ? 'id, category, question, answer, sort_order'
    : 'id, category, question, answer';

  let query = supabase
    .from('faqs')
    .select(selectColumns);

  if (filterActive) query = query.eq('active', true);
  query = query.order('category', { ascending: true });
  if (includeSortOrder) query = query.order('sort_order', { ascending: true });

  const result = await query;
  if (result.error && includeSortOrder && isMissingColumnError(result.error, 'sort_order')) {
    console.warn('load-faqs: sort_order unavailable, retrying without sort_order');
    return queryFAQs(filterActive, false);
  }

  return result;
}

function isMissingColumnError(error, column) {
  const message = String((error && (error.message || error.details || error.hint || error.code)) || '');
  return message.toLowerCase().includes(column.toLowerCase());
}
