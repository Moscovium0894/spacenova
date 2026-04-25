async function loadProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  const select = document.getElementById('productSelect');
  select.innerHTML = data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

async function generate(all=false) {
  const productId = document.getElementById('productSelect').value;
  const layout = document.getElementById('layout').value;
  const wallUrl = document.getElementById('wallUrl').value;

  const res = await fetch('/.netlify/functions/generate-mockup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, all, layout, wallImageUrl: wallUrl })
  });

  const data = await res.json();
  const resultsDiv = document.getElementById('results');

  resultsDiv.innerHTML = data.results.map(r => `
    <div>
      <strong>${r.productId}</strong><br/>
      ${r.success ? `<img src="${r.wall_image}"/>` : `Error: ${r.error}`}
    </div>
  `).join('');
}

document.getElementById('generateOne').onclick = () => generate(false);
document.getElementById('generateAll').onclick = () => generate(true);

loadProducts();