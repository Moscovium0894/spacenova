(function () {
  'use strict';

  var stripe;
  var elements;
  var shippingAddressElement;
  var linkAuthElement;
  var linkAuthEmail = '';

  var form       = document.getElementById('payment-form');
  var submitBtn  = document.getElementById('submit-btn');
  var btnText    = document.getElementById('btn-text');
  var btnSpinner = document.getElementById('btn-spinner');
  var errorsEl   = document.getElementById('payment-errors');
  var loaderEl   = document.getElementById('payment-loader');

  var summaryEl  = document.getElementById('order-summary');
  var subtotalEl = document.getElementById('summary-subtotal');
  var discRow    = document.getElementById('summary-discount-row');
  var discEl     = document.getElementById('summary-discount');
  var shippingEl = document.getElementById('summary-shipping');
  var totalEl    = document.getElementById('summary-total');

  var stripeAppearance = {
    theme: 'stripe',
    variables: {
      colorPrimary:         '#d4780f',
      colorBackground:      '#faf9f6',
      colorText:            '#1a1814',
      colorTextSecondary:   '#7a7267',
      colorTextPlaceholder: '#b0aa9f',
      colorDanger:          '#c0392b',
      colorSuccess:         '#1a9e40',
      fontFamily:           '"DM Mono", ui-monospace, monospace',
      fontSizeBase:         '14px',
      fontWeightNormal:     '300',
      borderRadius:         '10px',
      spacingUnit:          '5px',
    },
    rules: {
      '.Input': {
        border:          '1px solid #ddd8d0',
        boxShadow:       'none',
        padding:         '13px 16px',
        fontSize:        '14px',
        backgroundColor: '#faf9f6',
        transition:      'border-color 0.18s ease, box-shadow 0.18s ease',
      },
      '.Input:focus': {
        border:    '1px solid #d4780f',
        boxShadow: '0 0 0 3px rgba(212,120,15,0.12)',
        outline:   'none',
      },
      '.Input::placeholder': { color: '#b0aa9f' },
      '.Label': {
        fontFamily:    '"DM Mono", monospace',
        fontSize:      '11px',
        fontWeight:    '400',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color:         '#9a9088',
        marginBottom:  '6px',
      },
      '.Tab': {
        border:          '1px solid #ddd8d0',
        backgroundColor: '#faf9f6',
        boxShadow:       'none',
        borderRadius:    '10px',
      },
      '.Tab:hover':     { borderColor: '#c9c0b4' },
      '.Tab--selected': {
        borderColor: '#d4780f',
        boxShadow:   '0 0 0 2px rgba(212,120,15,0.2)',
        color:       '#d4780f',
      },
      '.CheckboxInput':          { border: '1px solid #ddd8d0', borderRadius: '5px' },
      '.CheckboxInput--checked': { backgroundColor: '#d4780f', borderColor: '#d4780f' },
      '.Error':                  { fontSize: '13px', color: '#c0392b' },
    },
  };

  var addressOptions = {
    mode: 'shipping',
    defaultValues: { address: { country: 'GB' } },
    fields: { phone: 'always' },
    validation: { phone: { required: 'always' } },
    display: { name: 'full' },
  };

  function fmt(n) { return '\u00a3' + Number(n).toFixed(2); }

  function setLoading(on) {
    if (!submitBtn) return;
    submitBtn.disabled = on;
    if (btnText)    btnText.style.display    = on ? 'none' : '';
    if (btnSpinner) btnSpinner.style.display = on ? '' : 'none';
  }

  function showError(msg) {
    if (!errorsEl) return;
    errorsEl.textContent = msg || '';
    errorsEl.style.display = msg ? '' : 'none';
  }

  function getBasket() {
    var raw = localStorage.getItem('sn_basket') || localStorage.getItem('spacenova_basket');
    try { return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
  }

  var SHIPPING_COSTS = {
    uk_standard:    4.99,
    uk_express:     9.99,
    eu_standard:    12.99,
    us_ca_standard: 14.99,
    row_standard:   17.99,
  };
  var FREE_SHIPPING_THRESHOLD = 150;

  function getShippingCost(method, subtotal) {
    if (method === 'uk_standard' && subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
    return SHIPPING_COSTS[method] || 0;
  }

  function populateSummary() {
    var basket = getBasket();
    if (!summaryEl) return;

    if (!basket.length) {
      summaryEl.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Your basket is empty.</p>';
      return;
    }

    summaryEl.innerHTML = basket.map(function(item) {
      var lineTotal = (item.price || 0) * (item.qty || 1);
      return '<div class="co-item"><span class="co-item-name">' + item.name +
        (item.qty > 1 ? ' &times;' + item.qty : '') +
        '</span><span class="co-item-price">' + fmt(lineTotal) + '</span></div>';
    }).join('');

    var sub = basket.reduce(function(s, i) { return s + (i.price || 0) * (i.qty || 1); }, 0);
    var methodEl = document.getElementById('shipping-method');
    var method   = methodEl ? methodEl.value : 'uk_standard';
    var ship     = getShippingCost(method, sub);

    if (subtotalEl) subtotalEl.textContent = fmt(sub);
    if (shippingEl) shippingEl.textContent = ship === 0 ? 'Free' : fmt(ship);
    if (totalEl)    totalEl.textContent    = fmt(sub + ship);
  }

  async function mountElements() {
    if (!stripe) return;

    var basket = getBasket();
    if (!basket.length) throw new Error('Your basket is empty.');

    var methodEl = document.getElementById('shipping-method');
    var method   = methodEl ? methodEl.value : 'uk_standard';

    var piRes = await fetch('/.netlify/functions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items:          basket,
        shippingMethod: method,
        promo:          window.getAppliedPromo ? window.getAppliedPromo() : null,
      }),
    });

    var piData = await piRes.json();
    if (!piRes.ok) throw new Error(piData.error || 'Could not initialise payment.');
    if (!piData.clientSecret) throw new Error('Could not initialise payment.');

    /* Update totals from server response */
    if (piData.totals) {
      if (subtotalEl) subtotalEl.textContent = fmt(piData.totals.subtotal);
      if (shippingEl) shippingEl.textContent = piData.totals.shipping === 0 ? 'Free' : fmt(piData.totals.shipping);
      if (totalEl)    totalEl.textContent    = fmt(piData.totals.total);
      if (piData.totals.discount > 0) {
        if (discRow) discRow.style.display = '';
        if (discEl)  discEl.textContent    = '-' + fmt(piData.totals.discount);
      }
    }

    if (linkAuthElement)        { linkAuthElement.destroy();        linkAuthElement = null; }
    if (shippingAddressElement) { shippingAddressElement.destroy(); shippingAddressElement = null; }

    /* Reset captured email whenever elements are remounted */
    linkAuthEmail = '';

    elements = stripe.elements({
      clientSecret: piData.clientSecret,
      appearance:   stripeAppearance,
      loader:       'auto',
    });

    var linkEl = document.getElementById('link-authentication-element');
    if (linkEl) {
      linkAuthElement = elements.create('linkAuthentication');
      linkAuthElement.mount('#link-authentication-element');

      /* Capture email via change event — getValue() is not supported on this element */
      linkAuthElement.on('change', function(e) {
        if (e && e.value && e.value.email) {
          linkAuthEmail = e.value.email;
        }
      });
    }

    var addrEl = document.getElementById('shipping-address-element');
    if (addrEl) {
      shippingAddressElement = elements.create('address', addressOptions);
      shippingAddressElement.mount('#shipping-address-element');
    }

    var payEl = document.getElementById('payment-element');
    if (payEl) {
      var paymentElement = elements.create('payment', {
        layout:  { type: 'tabs', defaultCollapsed: false },
        fields:  { billingDetails: 'auto' },
        wallets: { applePay: 'auto', googlePay: 'auto' },
      });
      paymentElement.mount('#payment-element');
      paymentElement.on('ready', function() {
        if (loaderEl) loaderEl.style.display = 'none';
      });
    }
  }

  async function init() {
    populateSummary();

    var keyRes  = await fetch('/.netlify/functions/stripe-config');
    var keyData = await keyRes.json();
    if (!keyData.publishableKey) {
      showError('Payment system could not be loaded. Please refresh.');
      return;
    }
    stripe = Stripe(keyData.publishableKey);

    try {
      await mountElements();
    } catch (err) {
      showError(err.message || 'Failed to load payment form.');
      return;
    }

    var methodSelect = document.getElementById('shipping-method');
    if (methodSelect) {
      methodSelect.addEventListener('change', function() {
        populateSummary();
        mountElements().catch(function(e) { showError(e.message); });
      });
    }

    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!stripe || !elements) return;
        showError('');
        setLoading(true);

        try {
          if (shippingAddressElement) {
            var addrResult = await shippingAddressElement.getValue();
            if (!addrResult.complete) throw new Error('Please complete your shipping address.');
          }

          var submitResult = await elements.submit();
          if (submitResult.error) throw new Error(submitResult.error.message);

          var confirmParams = {
            return_url: window.location.origin + '/success.html',
          };

          if (shippingAddressElement) {
            var addrVal = await shippingAddressElement.getValue();
            confirmParams.shipping = addrVal.value;
          }

          /* Use the email captured from the change event, not getValue() */
          if (linkAuthEmail) {
            confirmParams.payment_method_data = {
              billing_details: { email: linkAuthEmail },
            };
          }

          var result = await stripe.confirmPayment({
            elements:      elements,
            confirmParams: confirmParams,
          });

          if (result.error) throw new Error(result.error.message);

        } catch (err) {
          showError(err.message || 'Payment failed. Please try again.');
          setLoading(false);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    init().catch(function(err) {
      showError('Could not load checkout. Please refresh the page.');
      console.error(err);
    });
  });
})();
