(function() {
  'use strict';

  var stripe;
  var elements;
  var paymentElement;
  var shippingAddressElement;
  var linkAuthElement;
  var clientSecret;
  var customerEmail = '';

  var form = document.getElementById('payment-form');
  var submitBtn = document.getElementById('submit-btn');
  var btnText = document.getElementById('btn-text');
  var spinner = document.getElementById('btn-spinner');
  var errorMsg = document.getElementById('payment-errors');
  var orderSummary = document.getElementById('order-summary');
  var summarySubtotal = document.getElementById('summary-subtotal');
  var summaryDiscount = document.getElementById('summary-discount');
  var summaryDiscountRow = document.getElementById('summary-discount-row');
  var summaryShipping = document.getElementById('summary-shipping');
  var summaryTotal = document.getElementById('summary-total');
  var shippingMethodSelect = document.getElementById('shipping-method');
  var loader = document.getElementById('payment-loader');

  var FREE_SHIPPING = 150;
  var SHIPPING_OPTIONS = {
    uk_standard: { label: 'UK Standard (3\u20135 working days)', amount: 4.99, freeThreshold: FREE_SHIPPING },
    uk_express: { label: 'UK Express (1\u20132 working days)', amount: 9.99 },
    eu_standard: { label: 'Europe Standard (5\u201310 working days)', amount: 12.99 },
    us_ca_standard: { label: 'USA & Canada Standard (7\u201314 working days)', amount: 14.99 },
    row_standard: { label: 'Rest of World Standard (10\u201321 working days)', amount: 17.99 }
  };

  function fmt(n) { return '\u00a3' + parseFloat(n).toFixed(2); }

  function getBasketData() {
    try { return JSON.parse(localStorage.getItem('sn_basket')) || []; }
    catch(e) { return []; }
  }

  function getAppliedPromo() {
    try {
      if (typeof window.getAppliedPromo === 'function') {
        return window.getAppliedPromo();
      }
    } catch (e) {}
    return null;
  }

  function calcDiscount(sub, promo) {
    if (!promo) return 0;
    if (promo.type === 'percent') return sub * (promo.value / 100);
    if (promo.type === 'fixed') return Math.min(promo.value, sub);
    return 0;
  }

  function getShippingCost(discountedSubtotal, method) {
    var selected = SHIPPING_OPTIONS[method] || SHIPPING_OPTIONS.uk_standard;
    if (selected.freeThreshold && discountedSubtotal >= selected.freeThreshold) return 0;
    return selected.amount;
  }

  function calcTotals(items, promo, method) {
    var sub = items.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
    var disc = calcDiscount(sub, promo);
    var discountedSubtotal = Math.max(0, sub - disc);
    var ship = getShippingCost(discountedSubtotal, method);
    return { sub: sub, disc: disc, ship: ship, total: discountedSubtotal + ship };
  }

  function renderSummary(items, totals) {
    if (orderSummary) {
      orderSummary.innerHTML = items.map(function(i) {
        return '<div class="co-item"><span class="co-item-name">' + i.name + ' &times;' + i.qty + '</span><span class="co-item-price">' + fmt(i.price * i.qty) + '</span></div>';
      }).join('');
    }
    if (summarySubtotal) summarySubtotal.textContent = fmt(totals.sub);
    if (summaryDiscountRow) summaryDiscountRow.style.display = totals.disc > 0 ? '' : 'none';
    if (summaryDiscount) summaryDiscount.textContent = '-' + fmt(totals.disc);
    if (summaryShipping) summaryShipping.textContent = totals.ship === 0 ? 'Free' : fmt(totals.ship);
    if (summaryTotal) summaryTotal.textContent = fmt(totals.total);
  }

  async function getPublishableKey() {
    var keyRes = await fetch('/.netlify/functions/stripe-config');
    var keyData = await keyRes.json();
    if (!keyRes.ok || !keyData.publishableKey || typeof keyData.publishableKey !== 'string') {
      throw new Error(keyData.error || 'Stripe publishable key is unavailable');
    }
    return keyData.publishableKey;
  }

  async function createPaymentIntent(items, promo, shippingMethod) {
    var intentRes = await fetch('/.netlify/functions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items,
        promo: promo,
        shippingMethod: shippingMethod
      })
    });
    var intentData = await intentRes.json();
    if (!intentRes.ok) throw new Error(intentData.error || 'Could not create payment intent');
    return intentData;
  }

  async function mountElements() {
    var items = getBasketData();
    var promo = getAppliedPromo();
    var shippingMethod = shippingMethodSelect ? shippingMethodSelect.value : 'uk_standard';
    var totals = calcTotals(items, promo, shippingMethod);

    renderSummary(items, totals);

    var intentData = await createPaymentIntent(items, promo, shippingMethod);
    clientSecret = intentData.clientSecret;

    if (paymentElement) paymentElement.destroy();
    if (shippingAddressElement) shippingAddressElement.destroy();
    if (linkAuthElement) linkAuthElement.destroy();

    elements = stripe.elements({
      clientSecret: clientSecret,
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary: '#c8a96e',
          fontFamily: 'Syne, sans-serif',
          borderRadius: '4px'
        }
      }
    });

    linkAuthElement = elements.create('linkAuthentication');
    linkAuthElement.on('change', function(event) {
      customerEmail = event && event.value ? (event.value.email || '') : '';
    });
    linkAuthElement.mount('#link-authentication-element');

    // Fix: remove validation.phone entirely when fields.phone is 'never'
    shippingAddressElement = elements.create('address', {
      mode: 'shipping',
      allowedCountries: ['GB', 'US', 'CA', 'FR', 'DE', 'ES', 'IT', 'NL', 'IE', 'AU', 'NZ'],
      fields: { phone: 'never' }
    });
    shippingAddressElement.mount('#shipping-address-element');

    paymentElement = elements.create('payment', {
      layout: 'tabs',
      wallets: { applePay: 'auto', googlePay: 'auto' }
    });
    paymentElement.mount('#payment-element');

    if (loader) loader.style.display = 'none';
  }

  async function init() {
    var items = getBasketData();
    if (!items.length) {
      window.location.href = '/shop.html';
      return;
    }

    try {
      var key = await getPublishableKey();
      stripe = Stripe(key);

      await mountElements();

      if (shippingMethodSelect) {
        shippingMethodSelect.addEventListener('change', async function() {
          try {
            setLoading(true);
            await mountElements();
          } catch (err) {
            if (errorMsg) { errorMsg.textContent = err.message; errorMsg.style.display = 'block'; }
          } finally {
            setLoading(false);
          }
        });
      }
    } catch(err) {
      if (errorMsg) { errorMsg.textContent = err.message; errorMsg.style.display = 'block'; }
      if (loader) loader.style.display = 'none';
    }
  }

  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      if (!stripe || !elements) return;
      setLoading(true);
      if (errorMsg) errorMsg.style.display = 'none';

      try {
        var addressResult = await shippingAddressElement.getValue();
        if (!addressResult.complete) {
          throw new Error('Please complete your shipping address.');
        }

        var submitResult = await elements.submit();
        if (submitResult.error) {
          throw new Error(submitResult.error.message);
        }

        var shippingData = addressResult.value;
        var shippingMethod = shippingMethodSelect ? shippingMethodSelect.value : 'uk_standard';

        // Snapshot checkout state into localStorage so success.html can reconstruct the order
        var items = getBasketData();
        var promo = getAppliedPromo();
        var totals = calcTotals(items, promo, shippingMethod);
        var orderRef = 'SN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

        var pendingOrder = {
          ref: orderRef,
          items: items,
          delivery: {
            firstName: (shippingData.name || '').split(' ')[0] || '',
            lastName: (shippingData.name || '').split(' ').slice(1).join(' ') || '',
            address1: shippingData.address.line1 || '',
            address2: shippingData.address.line2 || '',
            city: shippingData.address.city || '',
            postcode: shippingData.address.postal_code || '',
            country: shippingData.address.country || '',
            email: customerEmail || ''
          },
          customer_name: shippingData.name || '',
          email: customerEmail || '',
          address: {
            line1: shippingData.address.line1 || '',
            line2: shippingData.address.line2 || '',
            city: shippingData.address.city || '',
            postcode: shippingData.address.postal_code || '',
            country: shippingData.address.country || ''
          },
          total: totals.total,
          promo_code: promo ? (promo.code || null) : null,
          discount: totals.disc,
          shipping_type: shippingMethod,
          created_at: new Date().toISOString()
        };

        // Persist order snapshot — success.html will read and save this
        try { localStorage.setItem('sn_pending_order', JSON.stringify(pendingOrder)); } catch(e) {}

        var result = await stripe.confirmPayment({
          elements: elements,
          confirmParams: {
            return_url: window.location.origin + '/success.html',
            receipt_email: customerEmail || undefined,
            shipping: {
              name: shippingData.name,
              address: {
                line1: shippingData.address.line1,
                line2: shippingData.address.line2 || undefined,
                city: shippingData.address.city,
                state: shippingData.address.state || undefined,
                postal_code: shippingData.address.postal_code,
                country: shippingData.address.country
              }
            }
          }
        });

        if (result.error) {
          throw new Error(result.error.message);
        }
      } catch (err) {
        if (errorMsg) { errorMsg.textContent = err.message; errorMsg.style.display = 'block'; }
        setLoading(false);
      }
    });
  }

  function setLoading(on) {
    if (submitBtn) submitBtn.disabled = on;
    if (btnText) btnText.style.display = on ? 'none' : '';
    if (spinner) spinner.style.display = on ? '' : 'none';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
