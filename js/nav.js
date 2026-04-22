(function() {
  'use strict';

  // NAV SCROLL
  var nav = document.getElementById('main-nav');
  if (nav) {
    var onScroll = function() {
      if (window.scrollY > 40) {
        nav.classList.add('nav-scrolled');
        nav.classList.remove('nav-transparent');
      } else {
        nav.classList.remove('nav-scrolled');
        nav.classList.add('nav-transparent');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // BURGER / MOBILE PANEL
  var burger = document.getElementById('burger-btn');
  var panel = document.getElementById('mobile-panel');
  var backdrop = document.getElementById('mobile-backdrop');
  var mpClose = document.getElementById('mp-close');

  function openPanel() {
    if (!panel) return;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
    if (burger) burger.setAttribute('aria-expanded', 'true');
  }
  function closePanel() {
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    if (burger) burger.setAttribute('aria-expanded', 'false');
  }

  if (burger) burger.addEventListener('click', openPanel);
  if (mpClose) mpClose.addEventListener('click', closePanel);
  if (backdrop) backdrop.addEventListener('click', closePanel);

  // MORE DROPDOWN
  var moreBtn = document.getElementById('nav-more-btn');
  var moreWrap = document.getElementById('nav-more-wrap');
  var dropdown = document.getElementById('nav-dropdown');

  if (moreBtn && moreWrap) {
    moreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = moreWrap.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function(e) {
      if (!moreWrap.contains(e.target)) {
        moreWrap.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // BASKET TOGGLE (delegates to basket.js openDrawer)
  var basketToggle = document.getElementById('basket-toggle-btn');
  var mpBasketBtn = document.getElementById('mp-basket-btn');
  function openBasket() {
    if (typeof window.openBasketDrawer === 'function') {
      window.openBasketDrawer();
    }
    closePanel();
  }
  if (basketToggle) basketToggle.addEventListener('click', openBasket);
  if (mpBasketBtn) mpBasketBtn.addEventListener('click', openBasket);

})();
