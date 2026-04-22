(function() {
  'use strict';

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

  var burger = document.getElementById('burger-btn');
  var panel = document.getElementById('mobile-panel');
  var backdrop = document.getElementById('mobile-backdrop');
  var mpClose = document.getElementById('mp-close');
  var moreBtn = document.getElementById('nav-more-btn');
  var moreWrap = document.getElementById('nav-more-wrap');
  var basketToggle = document.getElementById('basket-toggle-btn');
  var mpBasketBtn = document.getElementById('mp-basket-btn');

  function setPanelState(isOpen) {
    if (!panel) return;
    panel.classList.toggle('open', isOpen);
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('panel-open', isOpen);
    if (burger) {
      burger.classList.toggle('open', isOpen);
      burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      burger.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    }
    if (backdrop) backdrop.classList.toggle('open', isOpen);
  }

  function openPanel() {
    setPanelState(true);
  }

  function closePanel() {
    setPanelState(false);
  }

  if (burger) {
    burger.addEventListener('click', function() {
      var shouldOpen = !panel || !panel.classList.contains('open');
      setPanelState(shouldOpen);
    });
  }

  if (mpClose) mpClose.addEventListener('click', closePanel);
  if (backdrop) backdrop.addEventListener('click', closePanel);

  if (panel) {
    panel.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', closePanel);
    });
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closePanel();
      if (moreWrap && moreWrap.classList.contains('open')) {
        moreWrap.classList.remove('open');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

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

  function openBasket() {
    if (typeof window.openBasketDrawer === 'function') {
      window.openBasketDrawer();
    }
    closePanel();
  }

  if (basketToggle) basketToggle.addEventListener('click', openBasket);
  if (mpBasketBtn) mpBasketBtn.addEventListener('click', openBasket);
})();
