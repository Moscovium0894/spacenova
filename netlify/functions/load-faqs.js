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
    const { data, error } = await supabase
      .from('faqs')
      .select('id, category, question, answer, sort_order')
      .eq('active', true)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });

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
