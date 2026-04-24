(function () {
  function toInt(value, fallback) {
    var n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function setIndex(media, idx) {
    var total = toInt(media.dataset.cardCount, 1);
    var next = Math.max(0, Math.min(total - 1, idx));
    media.dataset.activeIndex = String(next);
    media.querySelectorAll('.card-flick-dot').forEach(function (dot) {
      dot.classList.toggle('active', toInt(dot.dataset.idx, -1) === next);
    });
  }

  function wireMedia(media) {
    if (!media || media.dataset.flickInit === '1') return;
    media.dataset.flickInit = '1';

    var total = toInt(media.dataset.cardCount, 1);
    if (total <= 1) return;

    setIndex(media, toInt(media.dataset.activeIndex, 0));

    var startX = 0;
    var startY = 0;
    var deltaX = 0;
    var deltaY = 0;
    var dragging = false;
    var suppressClick = false;

    media.addEventListener('touchstart', function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      deltaX = 0;
      deltaY = 0;
      dragging = true;
    }, { passive: true });

    media.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      deltaX = t.clientX - startX;
      deltaY = t.clientY - startY;
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        e.preventDefault();
      }
    }, { passive: false });

    media.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;

      if (Math.abs(deltaX) >= 28 && Math.abs(deltaX) > Math.abs(deltaY)) {
        var current = toInt(media.dataset.activeIndex, 0);
        var dir = deltaX < 0 ? 1 : -1;
        var next = (current + dir + total) % total;
        setIndex(media, next);
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 250);
      }
    }, { passive: true });

    var link = media.closest('a.card-link');
    if (link) {
      link.addEventListener('click', function (e) {
        if (suppressClick) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }

    media.querySelectorAll('.card-flick-dot').forEach(function (dot) {
      dot.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setIndex(media, toInt(dot.dataset.idx, 0));
      });
    });
  }

  window.initCardFlickGalleries = function (root) {
    var scope = root || document;
    scope.querySelectorAll('[data-card-flick]').forEach(wireMedia);
  };
})();
