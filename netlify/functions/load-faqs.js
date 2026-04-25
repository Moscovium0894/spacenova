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
      .from('faqs')
      .select('*');

    if (error) {
      console.error('load-faqs error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load FAQs' }) };
    }

    const rows = normaliseFAQRows(data || []);
    const grouped = {};
    const categoryOrder = [];

    for (const faq of rows) {
      if (!grouped[faq.category]) {
        grouped[faq.category] = [];
        categoryOrder.push(faq.category);
      }
      grouped[faq.category].push({
        id: faq.id,
        question: faq.question,
        answer: faq.answer
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

function normaliseFAQRows(rawRows) {
  const rows = rawRows.map((row, index) => {
    const category = getField(row, ['category', 'section', 'group', 'topic']) || 'General';
    return {
      id: getField(row, ['id', 'uuid']) || `${slugify(category)}-${index}`,
      category,
      question: getField(row, ['question', 'faq_question', 'title', 'q']),
      answer: getField(row, ['answer', 'faq_answer', 'content', 'body', 'a']),
      sortOrder: numberOr(getField(row, ['sort_order', 'sortOrder', 'order', 'position', 'display_order']), index),
      active: activeState(getField(row, ['active', 'is_active', 'enabled', 'published', 'is_published']))
    };
  }).filter(row => row.question && row.answer);

  const hasActiveValues = rows.some(row => row.active !== null);
  const activeRows = hasActiveValues ? rows.filter(row => row.active !== false) : rows;
  if (hasActiveValues && activeRows.length === 0 && rows.length > 0) {
    console.warn('load-faqs: active flag filtered every row, returning all FAQs');
  }

  return (activeRows.length ? activeRows : rows).sort((a, b) => {
    const categorySort = a.category.localeCompare(b.category);
    if (categorySort) return categorySort;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.question.localeCompare(b.question);
  });
}

function getField(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined && row[name] !== '') {
      return row[name];
    }
  }
  return null;
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

function slugify(value) {
  return String(value || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
