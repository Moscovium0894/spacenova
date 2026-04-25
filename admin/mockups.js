(function () {
  'use strict';

  var productSelect = null;
  var wallUrlInput = null;
  var generateOneBtn = null;
  var generateAllBtn = null;
  var resultsEl = null;
  var products = [];

  document.addEventListener('DOMContentLoaded', function () {
    productSelect = document.getElementById('productSelect');
    wallUrlInput = document.getElementById('wallUrl');
    generateOneBtn = document.getElementById('generateOne');
    generateAllBtn = document.getElementById('generateAll');
    resultsEl = document.getElementById('results');

    if (!productSelect || !generateOneBtn || !generateAllBtn || !resultsEl) return;

    generateOneBtn.addEventListener('click', function () {
      var productId = productSelect.value;
      if (!productId) {
        showMessage('Please choose a product first.', 'error');
        return;
      }
      runMockup({ productId: productId });
    });

    generateAllBtn.addEventListener('click', function () {
      runAllMockups();
    });

    loadProducts();
  });

  function loadProducts() {
    setBusy(true, 'Loading products...');

    fetch('/.netlify/functions/load-products', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('Could not load products (' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        products = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
        populateProducts(products);
        showMessage(products.length ? 'Products loaded. Choose one and generate away.' : 'No products found.', products.length ? 'success' : 'error');
      })
      .catch(function (err) {
        populateProducts([]);
        showMessage(err.message || 'Could not load products.', 'error');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function populateProducts(items) {
    productSelect.innerHTML = '';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = items.length ? 'Select a product...' : 'No products available';
    productSelect.appendChild(placeholder);

    items
      .slice()
      .sort(function (a, b) { return getName(a).localeCompare(getName(b)); })
      .forEach(function (product) {
        var id = product.slug || product.id || product.name;
        if (!id) return;
        var option = document.createElement('option');
        option.value = id;
        option.textContent = getName(product);
        productSelect.appendChild(option);
      });
  }

  function runMockup(payload) {
    setBusy(true, 'Generating selected mockup...');

    requestMockup(withWallImage(payload))
      .then(function (data) {
        renderResults(data);
      })
      .catch(function (err) {
        showMessage(err.message || 'Mockup generation failed.', 'error');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function runAllMockups() {
    var queue = products.filter(function (product) {
      return product && (product.slug || product.id || product.name);
    });
    if (!queue.length) {
      showMessage('No products loaded to generate.', 'error');
      return;
    }

    var results = [];
    setBusy(true, 'Generating 0 of ' + queue.length + ' mockups...');

    var chain = Promise.resolve();
    queue.forEach(function (product, index) {
      chain = chain.then(function () {
        var productId = product.slug || product.id || product.name;
        var name = getName(product);
        showMessage('Generating ' + (index + 1) + ' of ' + queue.length + ': ' + name, 'info');

        return requestMockup(withWallImage({ productId: productId }))
          .then(function (data) {
            var rows = normaliseResults(data);
            if (!rows.length) {
              rows = [{ success: false, productId: productId, name: name, error: 'No result returned.' }];
            }
            rows.forEach(function (row) {
              if (!row.name) row.name = name;
              if (!row.productId) row.productId = productId;
              results.push(row);
            });
            renderResults({ results: results });
          })
          .catch(function (err) {
            results.push({
              success: false,
              productId: productId,
              name: name,
              error: err.message || 'Mockup generation failed.'
            });
            renderResults({ results: results });
          });
      });
    });

    chain.finally(function () {
      setBusy(false);
    });
  }

  function requestMockup(payload) {
    return fetch('/.netlify/functions/generate-mockup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Mockup generation failed (' + res.status + ')');
          return data;
        });
      });
  }

  function withWallImage(payload) {
    var next = {};
    Object.keys(payload || {}).forEach(function (key) { next[key] = payload[key]; });
    var wallImageUrl = (wallUrlInput && wallUrlInput.value || '').trim();
    if (wallImageUrl) next.wallImageUrl = wallImageUrl;
    return next;
  }

  function normaliseResults(data) {
    if (data && Array.isArray(data.results)) return data.results;
    if (data && typeof data.success !== 'undefined') return [data];
    return [];
  }

  function renderResults(data) {
    var rows = Array.isArray(data.results) ? data.results : [];
    if (!rows.length) {
      showMessage(data.error || 'No results returned.', 'error');
      return;
    }

    var ok = rows.filter(function (row) { return row.success; }).length;
    var html = '<h2>' + ok + ' of ' + rows.length + ' mockup' + (rows.length === 1 ? '' : 's') + ' generated</h2>';

    rows.forEach(function (row) {
      var status = row.success ? 'success' : 'error';
      html += '<div class="mockup-result mockup-result-' + status + '">';
      html += '<h3>' + escapeHtml(row.name || row.slug || row.productId || 'Product') + '</h3>';
      html += '<p>' + (row.success ? 'Generated ' + (row.pieces || 0) + ' plates from ' + escapeHtml(row.positions_source || 'auto') + ' layout.' : escapeHtml(row.error || 'Failed')) + '</p>';
      if (row.wall_image) {
        html += '<p><a href="' + escapeAttr(row.wall_image) + '" target="_blank" rel="noopener">Open generated mockup</a></p>';
        html += '<img src="' + escapeAttr(row.wall_image) + '" alt="Generated wall mockup for ' + escapeAttr(row.name || 'product') + '">';
      }
      html += '</div>';
    });

    resultsEl.innerHTML = html;
  }

  function showMessage(message, type) {
    resultsEl.innerHTML = '<div class="mockup-message mockup-message-' + (type || 'info') + '">' + escapeHtml(message) + '</div>';
  }

  function setBusy(isBusy, message) {
    generateOneBtn.disabled = isBusy;
    generateAllBtn.disabled = isBusy;
    productSelect.disabled = isBusy;
    if (message) showMessage(message, 'info');
  }

  function getName(product) {
    return product.name || product.title || product.slug || product.id || 'Untitled product';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
}());
