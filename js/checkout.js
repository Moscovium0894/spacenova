(function () {
  'use strict';

  var stripe;
  var elements;
  var shippingAddressElement;
  var linkAuthElement;

  var form      = document.getElementById('payment-form');
  var submitBtn = document.getElementById('submit-btn');
  var btnText   = document.getElementById('btn-text');
  var btnSpinner = document.getElementById('btn-spinner');
  var errorsEl  = document.getElementById('payment-errors');
  var loaderEl  = document.getElementById('payment-loader');

  var summaryEl   = document.getElementById('order-summary');
  var subtotalEl  = document.getElementById('summary-subtotal');
  var discRow     = document.getElementById('summary-discount-row');
  var discEl      = document.getElementById('summary-discount');
  var shippingEl  = document.getElementById('summary-shipping');
  var totalEl     = document.getElementById('summary-total');

  /* Stripe appearance — matches Spacenova theme exactly */
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
        border:     '1px solid #d4780f',
        boxShadow:  '0 0 0 3px rgba(212,120,15,0.12)',
        outline:    'none',
      },
      '.Input::placeholder': {
        color: '#b0aa9f',
      },
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
      '.Tab:hover':   { borderColor: '#c9c0b4' },
      '.Tab--selected': {
        borderColor: '#d4780f',
        boxShadow:   '0 0 0 2px rgba(212,120,15,0.2)',
        color:       '#d4780f',
      },
      '.CheckboxInput': {
        border:       '1px solid #ddd8d0',
        borderRadius: '5px',
      },
      '.CheckboxInput--checked': {
        backgroundColor: '#d4780f',
        borderColor:     '#d4780f',
      },
      '.Error': {
        fontSize: '13px',
        color:    '#c0392b',
      },
    },
  };

  /* Address element options — with proper placeholders */
  var addressOptions = {
    mode: 'shipping',
    defaultValues: {
      address: { country: 'GB' },
    },
    fields: {
      phone: 'always',
    },
    validation: {
      phone: { required: 'always' },
    },
    display: {
      name: 'full',
    },
  };

  function fmt(n) { return '\u00a3' + n.toFixed(2); }

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

  /* ── Basket → order summary ── */
  function populateSummary() {
    var raw = localStorage.getItem('spacenova_basket');
    var basket = [];
    try { basket = raw ? JSON.parse(raw) : []; } catch(e) {}

    if (!summaryEl) return;

    if (!basket.length) {
      summaryEl.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Your basket is empty.</p>';
      return;
    }

    summaryEl.innerHTML = basket.map(function(item) {
      var lineTotal = (item.price || 0) * (item.qty || 1);
      return (
        '<div class="co-item">' +
          '<span class="co-item-name">' + item.name + (item.qty > 1 ? ' &times;' + item.qty : '') + '</span>' +
          '<span class="co-item-price">' + fmt(lineTotal) + '</span>' +
        '</div>'
      );
    }).join('');

    var sub = basket.reduce(function(s, i) { return s + (i.price || 0) * (i.qty || 1); }, 0);
    if (subtotalEl) subtotalEl.textContent = fmt(sub);
    if (shippingEl) shippingEl.textContent = 'Calculated at checkout';
    if (totalEl)    totalEl.textContent    = fmt(sub);
  }

  /* ── Mount Stripe Elements ── */
  async function mountElements() {
    if (!stripe) return;

    var raw = localStorage.getItem('spacenova_basket');
    var basket = [];
    try { basket = raw ? JSON.parse(raw) : []; } catch(e) {}
    var amount = Math.round(basket.reduce(function(s, i) { return s + (i.price || 0) * (i.qty || 1); }, 0) * 100);

    /* Create PaymentIntent */
    var piRes = await fetch('/.netlify/functions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount || 100, currency: 'gbp' }),
    });
    var piData = await piRes.json();
    if (!piData.clientSecret) throw new Error('Could not initialise payment.');

    /* Destroy old instances */
    if (linkAuthElement)     { linkAuthElement.destroy();     linkAuthElement = null; }
    if (shippingAddressElement) { shippingAddressElement.destroy(); shippingAddressElement = null; }

    elements = stripe.elements({
      clientSecret: piData.clientSecret,
      appearance: stripeAppearance,
      loader: 'auto',
    });

    /* Link authentication (email) */
    var linkEl = document.getElementById('link-authentication-element');
    if (linkEl) {
      linkAuthElement = elements.create('linkAuthentication');
      linkAuthElement.mount('#link-authentication-element');
    }

    /* Shipping address */
    var addrEl = document.getElementById('shipping-address-element');
    if (addrEl) {
      shippingAddressElement = elements.create('address', addressOptions);
      shippingAddressElement.mount('#shipping-address-element');
    }

    /* Payment element */
    var payEl = document.getElementById('payment-element');
    if (payEl) {
      var paymentElement = elements.create('payment', {
        layout: { type: 'tabs', defaultCollapsed: false },
        fields: { billingDetails: 'auto' },
        wallets: { applePay: 'auto', googlePay: 'auto' },
      });
      paymentElement.mount('#payment-element');
      paymentElement.on('ready', function() {
        if (loaderEl) loaderEl.style.display = 'none';
      });
    }
  }

  /* ── Shipping cost by method ── */
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

  function updateShippingDisplay() {
    var method = document.getElementById('shipping-method');
    if (!method || !shippingEl) return;
    var raw = localStorage.getItem('spacenova_basket');
    var basket = []; try { basket = raw ? JSON.parse(raw) : []; } catch(e) {}
    var sub = basket.reduce(function(s, i) { return s + (i.price || 0) * (i.qty || 1); }, 0);
    var ship = getShippingCost(method.value, sub);
    shippingEl.textContent = ship === 0 ? 'Free' : fmt(ship);
    if (totalEl) totalEl.textContent = fmt(sub + ship);
  }

  /* ── Init ── */
  async function init() {
    populateSummary();

    /* Fetch publishable key */
    var keyRes = await fetch('/.netlify/functions/stripe-config');
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

    /* Shipping method change */
    var methodSelect = document.getElementById('shipping-method');
    if (methodSelect) {
      methodSelect.addEventListener('change', function() {
        updateShippingDisplay();
        /* Remount elements with updated amount */
        mountElements().catch(function(e) { showError(e.message); });
      });
    }

    /* Form submit */
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!stripe || !elements) return;
        showError('');
        setLoading(true);

        try {
          /* Validate address */
          if (shippingAddressElement) {
            var addrResult = await shippingAddressElement.getValue();
            if (!addrResult.complete) {
              throw new Error('Please complete your shipping address.');
            }
          }

          /* Validate elements */
          var submitResult = await elements.submit();
          if (submitResult.error) throw new Error(submitResult.error.message);

          /* Confirm */
          var raw  = localStorage.getItem('spacenova_basket');
          var basket = []; try { basket = raw ? JSON.parse(raw) : []; } catch(e) {}
          var methodSel = document.getElementById('shipping-method');
          var sub  = basket.reduce(function(s, i) { return s + (i.price || 0) * (i.qty || 1); }, 0);
          var ship = getShippingCost(methodSel ? methodSel.value : 'uk_standard', sub);

          var result = await stripe.confirmPayment({
            elements: elements,
            confirmParams: {
              return_url: window.location.origin + '/success.html',
              shipping: shippingAddressElement
                ? (await shippingAddressElement.getValue()).value
                : undefined,
              payment_method_data: {
                billing_details: {
                  email: linkAuthElement
                    ? (await linkAuthElement.getValue()).value.email
                    : undefined,
                },
              },
            },
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
