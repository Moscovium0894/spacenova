let mockupProducts = [];

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadProducts() {
  try {
    const res = await fetch('/.netlify/functions/load-catalogue', { cache: 'no-store' });
    const data = await readJsonResponse(res);

    mockupProducts = data.products || [];
    const select = document.getElementById('productSelect');

    select.innerHTML = mockupProducts.map(p => {
      const value = p.slug || p.id || '';
      return `<option value="${esc(value)}">${esc(p.name || value)}</option>`;
    }).join('');

    return mockupProducts;
  } catch (err) {
    console.error('Failed to load products', err);
    return [];
  }
}

async function readJsonResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(plain ? `Non-JSON response: ${plain.slice(0, 180)}` : err.message);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderResults(results, intro) {
  const resultsDiv = document.getElementById('results');
  if (!results || !results.length) {
    resultsDiv.innerHTML = intro || '<p>No mockup results returned.</p>';
    return;
  }

  resultsDiv.innerHTML = (intro || '') + results.map(r => `
    <div style="margin-bottom:20px;">
      <strong>${esc(r.name || r.slug || r.productId || 'Product')}</strong><br/>
      ${r.success || r.wall_image
        ? `<img src="${esc(r.wall_image)}" style="max-width:100%;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,0.15);"/>
           <p style="color:#666;font-size:.85rem;margin-top:8px;">${esc(r.storage_path || '')}${r.positions_source ? ' - layout: ' + esc(r.positions_source) : ''}</p>`
        : `<span style="color:red">Error: ${esc(r.error || 'Unknown error')}</span>`
      }
    </div>
  `).join('');
}

async function renderCurrentMockups(all, selected) {
  await new Promise(resolve => setTimeout(resolve, 400));
  const products = await loadProducts();
  const visible = all
    ? products
    : products.filter(p => (p.slug || p.id || '') === selected);
  const results = visible
    .filter(p => p.wallImage)
    .map(p => ({
      success: true,
      name: p.name,
      slug: p.slug,
      wall_image: p.wallImage
    }));

  if (results.length) {
    renderResults(results, '<p style="color:#666">Saved mockups are shown below. The generator response was delayed or unreadable, but storage has the latest available URLs.</p>');
  }
}

async function generate(all=false) {
  const productId = document.getElementById('productSelect').value;
  const wallUrl = document.getElementById('wallUrl').value;

  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '<p>Generating mockups...</p>';

  try {
    const res = await fetch('/.netlify/functions/generate-mockup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, all, wallImageUrl: wallUrl })
    });

    const data = await readJsonResponse(res);
    renderResults(data.results || [], data.partialSuccess ? '<p style="color:#9a6b00">Some mockups finished and some failed.</p>' : '');
  } catch (err) {
    console.error('Generate mockups response error:', err);
    resultsDiv.innerHTML = `<p style="color:#9a6b00">The generator response could not be read cleanly. Checking saved mockups...</p>`;
    await renderCurrentMockups(all, productId);
    if (resultsDiv.textContent.includes('Checking saved mockups')) {
      resultsDiv.innerHTML = `<p style="color:red">Failed: ${esc(err.message)}</p>`;
    }
  }
}

document.getElementById('generateOne').onclick = () => generate(false);
document.getElementById('generateAll').onclick = () => generate(true);

loadProducts();
