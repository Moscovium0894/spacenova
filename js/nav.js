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
  var moreDropdown = document.getElementById('nav-dropdown');
  var basketToggle = document.getElementById('basket-toggle-btn');
  var mpBasketBtn = document.getElementById('mp-basket-btn');
  var lastFocusedElement = null;

  function setPanelState(isOpen) {
    if (!panel) return;
    if (isOpen) {
      lastFocusedElement = document.activeElement;
    }
    panel.classList.toggle('open', isOpen);
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('panel-open', isOpen);
    if (burger) {
      burger.classList.toggle('open', isOpen);
      burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      burger.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    }
    if (backdrop) backdrop.classList.toggle('open', isOpen);
    if (isOpen && mpClose) {
      window.requestAnimationFrame(function() {
        mpClose.focus();
      });
    }
    if (!isOpen && lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
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
    if (e.key === 'Tab' && panel && panel.classList.contains('open')) {
      var focusable = panel.querySelectorAll('a[href], button:not([disabled])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    if (e.key === 'Escape') {
      closePanel();
      if (moreWrap && moreWrap.classList.contains('open')) {
        moreWrap.classList.remove('open');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
        if (moreBtn) moreBtn.focus();
      }
    }
  });

  if (moreBtn && moreWrap && moreDropdown) {
    var moreItems = moreDropdown.querySelectorAll('[role="menuitem"]');

    moreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = moreWrap.classList.toggle('open');
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && moreItems.length) {
        moreItems[0].focus();
      }
    });

    moreBtn.addEventListener('keydown', function(e) {
      if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !moreWrap.classList.contains('open')) {
        e.preventDefault();
        moreWrap.classList.add('open');
        moreBtn.setAttribute('aria-expanded', 'true');
        if (moreItems.length) moreItems[0].focus();
      }
    });

    moreDropdown.addEventListener('keydown', function(e) {
      if (!moreItems.length) return;
      var currentIndex = Array.prototype.indexOf.call(moreItems, document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moreItems[(currentIndex + 1 + moreItems.length) % moreItems.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moreItems[(currentIndex - 1 + moreItems.length) % moreItems.length].focus();
      } else if (e.key === 'Tab' && !e.shiftKey && currentIndex === moreItems.length - 1) {
        moreWrap.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('click', function(e) {
      if (!moreWrap.contains(e.target)) {
        moreWrap.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  window.addEventListener('resize', function() {
    if (window.innerWidth > 860) {
      closePanel();
    }
  });

  function openBasket() {
    if (typeof window.openBasketDrawer === 'function') {
      window.openBasketDrawer();
    }
    closePanel();
  }

  if (basketToggle) basketToggle.addEventListener('click', openBasket);
  if (mpBasketBtn) mpBasketBtn.addEventListener('click', openBasket);
})();
