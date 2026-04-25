async function loadProducts() {
  try {
    const res = await fetch('/.netlify/functions/load-catalogue');
    const data = await res.json();

    const products = data.products || [];
    const select = document.getElementById('productSelect');

    select.innerHTML = products.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');
  } catch (err) {
    console.error('Failed to load products', err);
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

    const data = await res.json();

    resultsDiv.innerHTML = data.results.map(r => `
      <div style="margin-bottom:20px;">
        <strong>${r.productId}</strong><br/>
        ${r.success
          ? `<img src="${r.wall_image}" style="max-width:100%;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,0.15);"/>`
          : `<span style="color:red">Error: ${r.error}</span>`
        }
      </div>
    `).join('');

  } catch (err) {
    resultsDiv.innerHTML = `<p style="color:red">Failed: ${err.message}</p>`;
  }
}

document.getElementById('generateOne').onclick = () => generate(false);
document.getElementById('generateAll').onclick = () => generate(true);

loadProducts();
