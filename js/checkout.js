(function() {
  'use strict';

  var stripe;
  var elements;
  var paymentElement;
  var clientSecret;

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

  var FREE_SHIPPING = 150;

  function fmt(n) { return '\u00a3' + parseFloat(n).toFixed(2); }

  function getBasketData() {
    try { return JSON.parse(localStorage.getItem('sn_basket')) || []; }
    catch(e) { return []; }
  }

  function calcTotals(items, promo) {
    var sub = items.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
    var disc = 0;
    if (promo) {
      if (promo.type === 'percent') disc = sub * (promo.value / 100);
      else if (promo.type === 'fixed') disc = Math.min(promo.value, sub);
    }
    var ship = (sub - disc) >= FREE_SHIPPING ? 0 : 4.99;
    return { sub: sub, disc: disc, ship: ship, total: sub - disc + ship };
  }

  async function init() {
    var items = getBasketData();
    if (!items.length) {
      window.location.href = '/shop.html';
      return;
    }

    var promo = null;
    if (typeof window.getAppliedPromo === 'function') promo = window.getAppliedPromo();
    var totals = calcTotals(items, promo);

    // Render summary
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

    // Fetch Stripe key and create PaymentIntent
    try {
      var keyRes = await fetch('/.netlify/functions/inject-stripe-key');
      var keyData = await keyRes.json();
      stripe = Stripe(keyData.publishableKey);

      var intentRes = await fetch('/.netlify/functions/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items, promoCode: promo ? promo.code : null })
      });
      var intentData = await intentRes.json();
      if (!intentRes.ok) throw new Error(intentData.error || 'Could not create payment intent');
      clientSecret = intentData.clientSecret;

      elements = stripe.elements({ clientSecret: clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#c8a96e', fontFamily: 'Syne, sans-serif', borderRadius: '4px' } } });
      paymentElement = elements.create('payment');
      paymentElement.mount('#payment-element');

      var loader = document.getElementById('payment-loader');
      if (loader) loader.style.display = 'none';
    } catch(err) {
      if (errorMsg) { errorMsg.textContent = err.message; errorMsg.style.display = 'block'; }
    }
  }

  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      if (!stripe || !elements) return;
      setLoading(true);
      if (errorMsg) errorMsg.style.display = 'none';

      var name = document.getElementById('co-name') ? document.getElementById('co-name').value.trim() : '';
      var email = document.getElementById('co-email') ? document.getElementById('co-email').value.trim() : '';

      var result = await stripe.confirmPayment({
        elements: elements,
        confirmParams: {
          return_url: window.location.origin + '/success.html',
          payment_method_data: { billing_details: { name: name, email: email } }
        }
      });

      if (result.error) {
        if (errorMsg) { errorMsg.textContent = result.error.message; errorMsg.style.display = 'block'; }
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
