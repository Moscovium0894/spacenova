(function () {
  'use strict';

  var stripe;
  var elements;
  var shippingAddressElement;
  var linkAuthElement;
  var linkAuthEmail = '';

  /* Shipping options loaded from Supabase — starts empty, populated on init */
  var SHIPPING_OPTIONS = {};  /* key → { label, price, freeThreshold } */

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

  function getShippingCost(method, subtotal) {
    var opt = SHIPPING_OPTIONS[method];
    if (!opt) return 0;
    if (opt.freeThreshold && subtotal >= opt.freeThreshold) return 0;
    return opt.price;
  }

  function getDefaultShippingOptions() {
    return [
      { key: 'uk_standard', label: 'UK Standard (3–5 working days)', price: 4.99, freeThreshold: 150 },
      { key: 'uk_express', label: 'UK Express (1–2 working days)', price: 9.99, freeThreshold: null },
      { key: 'eu_standard', label: 'Europe Standard (5–10 working days)', price: 12.99, freeThreshold: null },
      { key: 'us_ca_standard', label: 'USA & Canada Standard (7–14 working days)', price: 14.99, freeThreshold: null },
      { key: 'row_standard', label: 'Rest of World Standard (10–21 working days)', price: 17.99, freeThreshold: null }
    ];
  }

  async function fetchJSONWithRetry(url, options, retries) {
    var lastErr;
    for (var attempt = 0; attempt <= retries; attempt += 1) {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 8000);
      try {
        var reqOpts = Object.assign({}, options || {}, { signal: controller.signal });
        var res = await fetch(url, reqOpts);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        clearTimeout(timeout);
        return await res.json();
      } catch (err) {
        clearTimeout(timeout);
        lastErr = err;
        if (attempt < retries) {
          await new Promise(function(resolve) { setTimeout(resolve, 350 * (attempt + 1)); });
        }
      }
    }
    throw lastErr;
  }

  /* ── Populate the shipping <select> from Supabase data ── */
  function populateShippingSelect(options) {
    var select = document.getElementById('shipping-method');
    if (!select) return;

    /* Build the SHIPPING_OPTIONS lookup map */
    SHIPPING_OPTIONS = {};
    options.forEach(function (o) {
      SHIPPING_OPTIONS[o.key] = {
        label:         o.label,
        price:         o.price,
        freeThreshold: o.freeThreshold
      };
    });

    /* Rebuild <select> options */
    select.innerHTML = '';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.key;

      /* Build a friendly cost string */
      var costStr;
      if (o.freeThreshold) {
        costStr = 'Free over \u00a3' + o.freeThreshold.toFixed(0) + ', otherwise \u00a3' + o.price.toFixed(2);
      } else {
        costStr = '\u00a3' + o.price.toFixed(2);
      }

      opt.textContent = o.label + ' \u2014 ' + costStr;
      select.appendChild(opt);
    });
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
    var method   = methodEl ? methodEl.value : '';
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
    var method   = methodEl ? methodEl.value : (Object.keys(SHIPPING_OPTIONS)[0] || 'uk_standard');

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
    /* 1. Load shipping options from Supabase */
    try {
      var shData = await fetchJSONWithRetry('/.netlify/functions/load-shipping-options', { cache: 'no-store' }, 1);
      if (shData.options && shData.options.length) {
        populateShippingSelect(shData.options);
      } else {
        console.warn('No shipping options from DB — using defaults');
        populateShippingSelect(getDefaultShippingOptions());
      }
    } catch (e) {
      console.error('Failed to load shipping options:', e);
      populateShippingSelect(getDefaultShippingOptions());
    }

    /* 2. Populate order summary */
    populateSummary();

    /* 3. Load Stripe publishable key */
    var keyRes  = await fetch('/.netlify/functions/stripe-config');
    var keyData = await keyRes.json();
    if (!keyData.publishableKey) {
      showError('Payment system could not be loaded. Please refresh.');
      return;
    }
    stripe = Stripe(keyData.publishableKey);

    /* 4. Mount Stripe elements */
    try {
      await mountElements();
    } catch (err) {
      showError(err.message || 'Failed to load payment form.');
      return;
    }

    /* 5. Re-mount elements when shipping method changes */
    var methodSelect = document.getElementById('shipping-method');
    if (methodSelect) {
      methodSelect.addEventListener('change', function() {
        populateSummary();
        mountElements().catch(function(e) { showError(e.message); });
      });
    }

    /* 6. Form submit */
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
