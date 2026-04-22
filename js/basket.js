(function() {
  'use strict';

  var STORAGE_KEY = 'sn_basket';
  var FREE_SHIPPING_THRESHOLD = 150;
  var PROMO_FUNCTION = '/.netlify/functions/validate-promo';

  // STATE
  var basket = loadBasket();
  var appliedPromo = null;

  // DOM
  var overlay = document.getElementById('basket-overlay');
  var drawer = document.getElementById('basket-drawer');
  var closeBtn = document.getElementById('basket-close');
  var body = document.getElementById('basket-body');
  var footer = document.getElementById('basket-footer');
  var badgeNav = document.getElementById('basket-badge');
  var badgeMp = document.getElementById('mp-badge');
  var subtotalEl = document.getElementById('basket-subtotal');
  var discountRow = document.getElementById('discount-row');
  var discountEl = document.getElementById('basket-discount');
  var shippingEl = document.getElementById('basket-shipping');
  var totalEl = document.getElementById('basket-total');
  var promoInput = document.getElementById('promo-input');
  var promoApplyBtn = document.getElementById('promo-apply-btn');
  var promoApplied = document.getElementById('promo-applied');
  var promoAppliedText = document.getElementById('promo-applied-text');
  var promoRemoveBtn = document.getElementById('promo-remove-btn');
  var promoError = document.getElementById('promo-error');
  var freeShippingNote = document.getElementById('free-shipping-note');

  // PUBLIC
  window.openBasketDrawer = openDrawer;
  window.addToBasket = addItem;
  window.getBasket = function() { return basket; };
  window.getAppliedPromo = function() { return appliedPromo; };

  function loadBasket() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch(e) { return []; }
  }
  function saveBasket() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(basket));
  }

  function addItem(product, qty) {
    qty = qty || 1;
    var existing = basket.find(function(i) { return i.id === product.id; });
    if (existing) {
      existing.qty += qty;
    } else {
      basket.push({ id: product.id, name: product.name, price: parseFloat(product.price), image: product.image || '', qty: qty });
    }
    saveBasket();
    render();
    openDrawer();
    showToast(product.name + ' added to basket');
  }

  function removeItem(id) {
    basket = basket.filter(function(i) { return i.id !== id; });
    saveBasket();
    render();
  }

  function changeQty(id, delta) {
    var item = basket.find(function(i) { return i.id === id; });
    if (!item) return;
    item.qty += delta;
    if (item.qty < 1) item.qty = 1;
    saveBasket();
    render();
  }

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.classList.add('drawer-open');
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('drawer-open');
  }

  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (overlay) overlay.addEventListener('click', closeDrawer);

  function calcSubtotal() {
    return basket.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
  }
  function calcDiscount(subtotal) {
    if (!appliedPromo) return 0;
    if (appliedPromo.type === 'percent') return subtotal * (appliedPromo.value / 100);
    if (appliedPromo.type === 'fixed') return Math.min(appliedPromo.value, subtotal);
    return 0;
  }
  function calcShipping(subtotal) {
    return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : 4.99;
  }

  function fmt(n) { return '\u00a3' + n.toFixed(2); }

  function render() {
    var count = basket.reduce(function(s, i) { return s + i.qty; }, 0);
    if (badgeNav) { badgeNav.textContent = count > 0 ? count : ''; badgeNav.style.display = count > 0 ? '' : 'none'; }
    if (badgeMp) { badgeMp.textContent = count > 0 ? count : ''; badgeMp.style.display = count > 0 ? '' : 'none'; }

    if (!body) return;
    if (!basket.length) {
      body.innerHTML = '<div class="basket-empty"><p>Your basket is empty.</p><a class="btn btn-ghost btn-sm" href="/shop.html">Browse the shop</a></div>';
      if (footer) footer.style.display = 'none';
      return;
    }

    body.innerHTML = basket.map(function(item) {
      return '<div class="basket-item" data-id="' + item.id + '">' +
        (item.image ? '<img class="bi-img" src="' + item.image + '" alt="' + item.name + '">' : '<div class="bi-img bi-img-placeholder"></div>') +
        '<div class="bi-info"><div class="bi-name">' + item.name + '</div><div class="bi-price">' + fmt(item.price) + '</div></div>' +
        '<div class="bi-controls">' +
          '<button class="qty-btn qty-minus" data-id="' + item.id + '">&#8722;</button>' +
          '<span class="qty-val">' + item.qty + '</span>' +
          '<button class="qty-btn qty-plus" data-id="' + item.id + '">+</button>' +
          '<button class="bi-remove" data-id="' + item.id + '">&times;</button>' +
        '</div>' +
      '</div>';
    }).join('');

    body.querySelectorAll('.qty-minus').forEach(function(btn) {
      btn.addEventListener('click', function() { changeQty(this.dataset.id, -1); });
    });
    body.querySelectorAll('.qty-plus').forEach(function(btn) {
      btn.addEventListener('click', function() { changeQty(this.dataset.id, 1); });
    });
    body.querySelectorAll('.bi-remove').forEach(function(btn) {
      btn.addEventListener('click', function() { removeItem(this.dataset.id); });
    });

    if (footer) footer.style.display = '';
    var sub = calcSubtotal();
    var disc = calcDiscount(sub);
    var ship = calcShipping(sub - disc);
    var total = sub - disc + ship;
    if (subtotalEl) subtotalEl.textContent = fmt(sub);
    if (discountRow) discountRow.style.display = disc > 0 ? '' : 'none';
    if (discountEl) discountEl.textContent = '-' + fmt(disc);
    if (shippingEl) shippingEl.textContent = ship === 0 ? 'Free' : fmt(ship);
    if (totalEl) totalEl.textContent = fmt(total);
    var remaining = FREE_SHIPPING_THRESHOLD - (sub - disc);
    if (freeShippingNote) {
      freeShippingNote.textContent = remaining > 0
        ? 'Add ' + fmt(remaining) + ' more for free UK shipping'
        : '\u2713 You qualify for free UK shipping';
    }
  }

  // PROMO
  if (promoApplyBtn) {
    promoApplyBtn.addEventListener('click', async function() {
      var code = promoInput ? promoInput.value.trim() : '';
      if (!code) return;
      promoApplyBtn.disabled = true;
      if (promoError) promoError.style.display = 'none';
      try {
        var res = await fetch(PROMO_FUNCTION, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code })
        });
        var data = await res.json();
        if (!res.ok || !data.valid) throw new Error(data.error || 'Invalid code');
        appliedPromo = data.promo;
        if (promoApplied) promoApplied.style.display = '';
        if (promoAppliedText) promoAppliedText.textContent = code.toUpperCase() + ' \u2014 ' + (appliedPromo.type === 'percent' ? appliedPromo.value + '% off' : '\u00a3' + appliedPromo.value + ' off');
        if (promoInput) promoInput.style.display = 'none';
        if (promoApplyBtn) promoApplyBtn.style.display = 'none';
        render();
      } catch(err) {
        if (promoError) { promoError.textContent = 'Invalid or expired code'; promoError.style.display = 'block'; }
      }
      promoApplyBtn.disabled = false;
    });
  }
  if (promoRemoveBtn) {
    promoRemoveBtn.addEventListener('click', function() {
      appliedPromo = null;
      if (promoApplied) promoApplied.style.display = 'none';
      if (promoInput) { promoInput.value = ''; promoInput.style.display = ''; }
      if (promoApplyBtn) promoApplyBtn.style.display = '';
      if (promoError) promoError.style.display = 'none';
      render();
    });
  }

  // TOAST
  window.showToast = function(msg) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    container.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('show'); });
    setTimeout(function() {
      t.classList.remove('show');
      setTimeout(function() { t.remove(); }, 400);
    }, 2800);
  };

  render();
})();
