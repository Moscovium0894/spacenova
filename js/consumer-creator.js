(function () {
  'use strict';

  var HEX_W = 97;
  var HEX_H = 112;
  var COL_PITCH = 104;      // matches admin creator preview spacing
  var ROW_PITCH = 84;       // matches admin creator preview spacing
  var ODD_OFFSET = 52;
  var HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

  var E = {
    status: document.getElementById('cc-status'),
    setName: document.getElementById('cc-set-name'),
    email: document.getElementById('cc-email'),
    pieces: document.getElementById('cc-pieces'),
    layout: document.getElementById('cc-layout'),
    mainFile: document.getElementById('cc-main-file'),
    mainZoom: document.getElementById('cc-main-zoom'),
    singleBlock: document.getElementById('cc-single-block'),
    perHexBlock: document.getElementById('cc-perhex-block'),
    selectedTitle: document.getElementById('cc-selected-title'),
    previewMeta: document.getElementById('cc-preview-meta'),
    hexWrap: document.getElementById('cc-hex-preview'),
    cropPreview: document.getElementById('cc-crop-preview'),
    hexFile: document.getElementById('cc-hex-file'),
    fit: document.getElementById('cc-fit'),
    zoomIn: document.getElementById('cc-zoom-in'),
    zoomOut: document.getElementById('cc-zoom-out'),
    x: document.getElementById('cc-x'),
    y: document.getElementById('cc-y'),
    openCrop: document.getElementById('cc-open-crop'),
    resetHex: document.getElementById('cc-reset-hex'),
    resetAll: document.getElementById('cc-reset-all'),
    download: document.getElementById('cc-download'),
    emailBtn: document.getElementById('cc-email-btn'),
    modal: document.getElementById('cc-crop-modal'),
    modalBackdrop: document.getElementById('cc-crop-backdrop'),
    modalClose: document.getElementById('cc-crop-close'),
    modalDone: document.getElementById('cc-crop-done'),
    modalTitle: document.getElementById('cc-modal-title'),
    cropPreviewLg: document.getElementById('cc-crop-preview-lg'),
    fitLg: document.getElementById('cc-fit-lg'),
    zoomInLg: document.getElementById('cc-zoom-in-lg'),
    zoomOutLg: document.getElementById('cc-zoom-out-lg'),
    xLg: document.getElementById('cc-x-lg'),
    yLg: document.getElementById('cc-y-lg'),
    resetHexLg: document.getElementById('cc-reset-hex-lg')
  };

  var state = {
    mode: 'single', // single | perHex
    mainImage: '',
    mainZoom: 1,
    activePanel: 0,
    panelNames: [],
    panelImages: [],
    panelPositions: [],
    panelTransforms: []
  };

  function setStatus(message) {
    if (E.status) E.status.textContent = message;
  }

  function clampNumber(value, min, max, fallback) {
    var n = parseFloat(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function defaultTransform() {
    return { fit: 'cover', scale: 1, x: 50, y: 50 };
  }

  function normaliseTransform(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      fit: value.fit === 'contain' ? 'contain' : 'cover',
      scale: clampNumber(value.scale != null ? value.scale : value.zoom, 0.2, 3, 1),
      x: clampNumber(value.x != null ? value.x : value.positionX, 0, 100, 50),
      y: clampNumber(value.y != null ? value.y : value.positionY, 0, 100, 50)
    };
  }

  function safeStorageName(value, fallback) {
    return String(value || fallback || 'set')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || (fallback || 'set');
  }

  function ensureArrays() {
    var count = clampNumber(E.pieces && E.pieces.value, 1, 24, 6);
    while (state.panelNames.length < count) state.panelNames.push('');
    while (state.panelImages.length < count) state.panelImages.push('');
    while (state.panelPositions.length < count) state.panelPositions.push({ row: 0, col: state.panelPositions.length });
    while (state.panelTransforms.length < count) state.panelTransforms.push(defaultTransform());

    state.panelNames = state.panelNames.slice(0, count);
    state.panelImages = state.panelImages.slice(0, count);
    state.panelPositions = state.panelPositions.slice(0, count);
    state.panelTransforms = state.panelTransforms.slice(0, count).map(normaliseTransform);
  }

  function applyPresetLayout() {
    ensureArrays();
    var count = state.panelPositions.length;
    var preset = (E.layout && E.layout.value) || 'auto';
    var pos = [];

    if (preset === 'line') {
      for (var i = 0; i < count; i++) pos.push({ row: 0, col: i });

    } else if (preset === 'arc') {
      for (var j = 0; j < count; j++) {
        pos.push({ row: (j === 0 || j === count - 1) ? 1 : 0, col: j });
      }

    } else if (preset === 'cluster' || preset === 'honeycomb' || preset === 'auto') {
      var presets = {
        1: [[0, 0]],
        2: [[0, 0], [0, 1]],
        3: [[0, 0], [0, 1], [1, 0]],
        4: [[0, 0], [0, 1], [1, 0], [1, 1]],
        5: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
        6: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
        7: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
        8: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1]],
        9: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
        10: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2]],
        11: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3]],
        12: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3]]
      };

      var chosen = presets[count];
      if (chosen) {
        chosen.forEach(function (pair) { pos.push({ row: pair[0], col: pair[1] }); });
      } else {
        var cols = Math.max(3, Math.ceil(Math.sqrt(count)));
        var rows = Math.ceil(count / cols);
        var placed = 0;
        for (var r = 0; r < rows && placed < count; r++) {
          var remaining = count - placed;
          var rowCols = Math.min(cols, remaining);
          var offset = Math.floor((cols - rowCols) / 2);
          for (var c = 0; c < rowCols; c++) {
            pos.push({ row: r, col: c + offset });
            placed++;
          }
        }
      }
    }

    if (pos.length === count) state.panelPositions = pos;
  }

  function gridToPixel(row, col) {
    return {
      x: col * COL_PITCH + (row % 2 !== 0 ? ODD_OFFSET : 0),
      y: row * ROW_PITCH
    };
  }

  function getPixelPositions() {
    ensureArrays();
    return state.panelPositions.map(function (p) {
      return gridToPixel(parseInt(p.row, 10) || 0, parseInt(p.col, 10) || 0);
    });
  }

  function getBounds(positions) {
    if (!positions.length) return { minX: 0, minY: 0, width: HEX_W, height: HEX_H };
    var minX = Math.min.apply(null, positions.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, positions.map(function (p) { return p.y; }));
    var maxX = Math.max.apply(null, positions.map(function (p) { return p.x + HEX_W; }));
    var maxY = Math.max.apply(null, positions.map(function (p) { return p.y + HEX_H; }));
    return { minX: minX, minY: minY, width: maxX - minX, height: maxY - minY };
  }

  function getUsablePlateImage(idx) {
    var url = String(state.panelImages[idx] || '').trim();
    return url ? url : '';
  }

  function selectPanel(idx) {
    ensureArrays();
    var safe = Math.max(0, Math.min(state.panelPositions.length - 1, parseInt(idx, 10) || 0));
    state.activePanel = safe;
    syncSelectedControls();
    render();
  }

  function isGridOccupied(row, col, ignoreIdx) {
    return state.panelPositions.some(function (pos, idx) {
      return idx !== ignoreIdx && (parseInt(pos.row, 10) || 0) === row && (parseInt(pos.col, 10) || 0) === col;
    });
  }

  function nearestFreeGridPosition(x, y, ignoreIdx) {
    var maxRow = 0, maxCol = 0;
    state.panelPositions.forEach(function (pos) {
      maxRow = Math.max(maxRow, parseInt(pos.row, 10) || 0);
      maxCol = Math.max(maxCol, parseInt(pos.col, 10) || 0);
    });

    var best = null;
    for (var r = 0; r <= maxRow + 6; r++) {
      for (var c = 0; c <= maxCol + 6; c++) {
        if (isGridOccupied(r, c, ignoreIdx)) continue;
        var px = gridToPixel(r, c);
        var distance = Math.pow(px.x - x, 2) + Math.pow(px.y - y, 2);
        if (!best || distance < best.distance) best = { row: r, col: c, distance: distance };
      }
    }
    return best ? { row: best.row, col: best.col } : { row: 0, col: 0 };
  }

  function bindDrag(hex, idx, pixelPositions, bounds) {
    hex.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      selectPanel(idx);

      var startX = event.clientX;
      var startY = event.clientY;
      var startPos = pixelPositions[idx] || gridToPixel(0, idx);
      var snapped = state.panelPositions[idx] || { row: 0, col: idx };
      var moved = false;
      hex.classList.add('is-dragging');
      hex.setPointerCapture(event.pointerId);

      function move(e) {
        var target = { x: startPos.x + e.clientX - startX, y: startPos.y + e.clientY - startY };
        snapped = nearestFreeGridPosition(target.x, target.y, idx);
        var preview = gridToPixel(snapped.row, snapped.col);
        hex.style.left = Math.round(preview.x - bounds.minX) + 'px';
        hex.style.top = Math.round(preview.y - bounds.minY) + 'px';
        moved = true;
      }

      function up() {
        hex.classList.remove('is-dragging');
        hex.removeEventListener('pointermove', move);
        hex.removeEventListener('pointerup', up);
        hex.removeEventListener('pointercancel', up);
        if (moved) {
          state.panelPositions[idx] = snapped;
          render();
        }
      }

      hex.addEventListener('pointermove', move);
      hex.addEventListener('pointerup', up);
      hex.addEventListener('pointercancel', up);
    });
  }

  function renderHexGrid() {
    ensureArrays();
    var wrap = E.hexWrap;
    if (!wrap) return;

    var pixelPositions = getPixelPositions();
    var bounds = getBounds(pixelPositions);
    wrap.innerHTML = '';
    if (!pixelPositions.length) return;

    var gridW = Math.round(Math.max(1, bounds.width));
    var gridH = Math.round(Math.max(1, bounds.height));
    var zoom = clampNumber(state.mainZoom, 1, 2.5, 1);
    var canvasW = Math.round(gridW * zoom);
    var canvasH = Math.round(gridH * zoom);
    var zoomOffX = Math.round((canvasW - gridW) / 2);
    var zoomOffY = Math.round((canvasH - gridH) / 2);

    wrap.style.position = 'relative';
    wrap.style.display = 'block';
    wrap.style.width = gridW + 'px';
    wrap.style.height = gridH + 'px';
    wrap.style.margin = '0 auto';

    pixelPositions.forEach(function (pos, idx) {
      var tileLeft = Math.round(pos.x - bounds.minX);
      var tileTop = Math.round(pos.y - bounds.minY);

      var hex = document.createElement('div');
      hex.className = 'hex-cell-preview' + (idx === state.activePanel ? ' is-selected' : '');
      hex.dataset.idx = idx;
      hex.style.cssText = [
        'position:absolute',
        'left:' + tileLeft + 'px',
        'top:' + tileTop + 'px',
        'width:' + HEX_W + 'px',
        'height:' + HEX_H + 'px',
        'margin:0',
        'overflow:visible'
      ].join(';');

      var inner = document.createElement('div');
      inner.style.cssText = [
        'position:absolute',
        'inset:0',
        'clip-path:' + HEX_CLIP,
        'overflow:hidden',
        'background:#2a2825'
      ].join(';');

      var individualUrl = getUsablePlateImage(idx);
      var canUseMain = state.mode === 'single' && state.mainImage;

      if (individualUrl) {
        var t = normaliseTransform(state.panelTransforms[idx]);
        var img = document.createElement('img');
        img.src = individualUrl;
        img.alt = '';
        img.style.cssText = [
          'position:absolute',
          'inset:0',
          'width:100%',
          'height:100%',
          'object-fit:' + t.fit,
          'object-position:' + t.x + '% ' + t.y + '%',
          'transform:scale(' + t.scale + ')',
          'transform-origin:' + t.x + '% ' + t.y + '%',
          'display:block',
          'pointer-events:none',
          'user-select:none'
        ].join(';');
        inner.style.background = '#050505';
        inner.appendChild(img);
      } else if (canUseMain) {
        var imgLeft = -(tileLeft * zoom + zoomOffX);
        var imgTop = -(tileTop * zoom + zoomOffY);
        var img2 = document.createElement('img');
        img2.src = state.mainImage;
        img2.alt = '';
        img2.style.cssText = [
          'position:absolute',
          'display:block',
          'pointer-events:none',
          'user-select:none',
          'max-width:none',
          'width:' + canvasW + 'px',
          'height:' + canvasH + 'px',
          'left:' + Math.round(imgLeft) + 'px',
          'top:' + Math.round(imgTop) + 'px',
          'object-fit:cover'
        ].join(';');
        inner.style.background = '#050505';
        inner.appendChild(img2);
      }

      var label = document.createElement('span');
      label.className = 'hex-label-preview';
      label.textContent = idx + 1;

      hex.appendChild(inner);
      hex.appendChild(label);
      hex.addEventListener('click', function () { selectPanel(idx); });
      bindDrag(hex, idx, pixelPositions, bounds);
      wrap.appendChild(hex);
    });

    if (E.previewMeta) E.previewMeta.textContent = state.panelPositions.length + ' hexes';
  }

  function syncSelectedControls() {
    ensureArrays();
    var idx = Math.max(0, Math.min(state.panelPositions.length - 1, state.activePanel || 0));
    state.activePanel = idx;
    var name = state.panelNames[idx] || ('Hex ' + (idx + 1));
    var t = normaliseTransform(state.panelTransforms[idx]);
    if (E.selectedTitle) E.selectedTitle.textContent = name;
    if (E.fit) E.fit.value = t.fit;
    if (E.x) E.x.value = t.x;
    if (E.y) E.y.value = t.y;
    if (E.modalTitle) E.modalTitle.textContent = name;
    if (E.fitLg) E.fitLg.value = t.fit;
    if (E.xLg) E.xLg.value = t.x;
    if (E.yLg) E.yLg.value = t.y;
    renderCropPreview();
    renderCropPreviewLg();
  }

  function renderCropPreview() {
    if (!E.cropPreview) return;
    ensureArrays();
    var idx = state.activePanel || 0;
    var url = String(state.panelImages[idx] || '').trim();
    E.cropPreview.innerHTML = '';

    if (!url) {
      E.cropPreview.classList.add('is-empty');
      return;
    }
    E.cropPreview.classList.remove('is-empty');

    var t = normaliseTransform(state.panelTransforms[idx]);
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.objectFit = t.fit;
    img.style.objectPosition = t.x + '% ' + t.y + '%';
    img.style.transform = 'scale(' + t.scale + ')';
    img.style.transformOrigin = t.x + '% ' + t.y + '%';
    E.cropPreview.appendChild(img);
  }

  function renderCropPreviewLg() {
    if (!E.cropPreviewLg) return;
    ensureArrays();
    var idx = state.activePanel || 0;
    var url = String(state.panelImages[idx] || '').trim();
    E.cropPreviewLg.innerHTML = '';

    if (!url) {
      E.cropPreviewLg.classList.add('is-empty');
      return;
    }
    E.cropPreviewLg.classList.remove('is-empty');

    var t = normaliseTransform(state.panelTransforms[idx]);
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.objectFit = t.fit;
    img.style.objectPosition = t.x + '% ' + t.y + '%';
    img.style.transform = 'scale(' + t.scale + ')';
    img.style.transformOrigin = t.x + '% ' + t.y + '%';
    E.cropPreviewLg.appendChild(img);
  }

  function updateActiveTransform(patch) {
    ensureArrays();
    var idx = Math.max(0, Math.min(state.panelTransforms.length - 1, state.activePanel || 0));
    var current = normaliseTransform(state.panelTransforms[idx]);
    Object.keys(patch || {}).forEach(function (k) { current[k] = patch[k]; });
    state.panelTransforms[idx] = normaliseTransform(current);
    syncSelectedControls();
    renderHexGrid();
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsDataURL(file);
    });
  }

  function modeChanged(next) {
    state.mode = next === 'perHex' ? 'perHex' : 'single';
    if (E.singleBlock) E.singleBlock.style.display = state.mode === 'single' ? '' : 'none';
    if (E.perHexBlock) E.perHexBlock.style.display = state.mode === 'perHex' ? '' : 'none';
    render();
  }

  function buildExportPayload() {
    ensureArrays();
    var setName = String(E.setName && E.setName.value || '').trim() || 'Custom Set';
    var email = String(E.email && E.email.value || '').trim();

    return {
      type: 'spacenova_consumer_set',
      version: 1,
      createdAt: new Date().toISOString(),
      setName: setName,
      customer: { email: email || null },
      mode: state.mode,
      plateCount: state.panelPositions.length,
      image: state.mode === 'single' ? (state.mainImage || '') : '',
      mainZoom: state.mainZoom,
      plateNames: state.panelNames.slice(),
      plateImages: state.panelImages.slice(),
      plateMap: {
        version: 2,
        geometry: 'pointy_hex',
        positions: state.panelPositions.map(function (p) { return { row: parseInt(p.row, 10) || 0, col: parseInt(p.col, 10) || 0 }; }),
        transforms: state.panelTransforms.map(normaliseTransform),
        mockup: {}
      }
    };
  }

  function downloadJson(payload) {
    var safeName = safeStorageName(payload && payload.setName, 'spacenova-set');
    var filename = safeName + '.spacenova-set.json';
    var jsonText = JSON.stringify(payload, null, 2);
    var blob = new Blob([jsonText], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
    setStatus('Downloaded ' + filename);
  }

  function toBase64Utf8(text) {
    return btoa(unescape(encodeURIComponent(String(text || ''))));
  }

  async function emailSet(payload) {
    var toEmail = String(E.email && E.email.value || '').trim();
    if (!toEmail) {
      setStatus('Add your email first (optional field at the top).');
      return;
    }

    var safeName = safeStorageName(payload && payload.setName, 'spacenova-set');
    var filename = safeName + '.spacenova-set.json';
    var jsonText = JSON.stringify(payload, null, 2);
    var fileBase64 = toBase64Utf8(jsonText);

    setStatus('Sending email…');
    try {
      var res = await fetch('/.netlify/functions/email-consumer-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: toEmail,
          setName: payload.setName,
          filename: filename,
          contentType: 'application/json',
          fileBase64: fileBase64
        })
      });
      var body = {};
      try { body = await res.json(); } catch (e) { body = {}; }
      if (!res.ok || !body.ok) throw new Error((body && body.error) || 'Failed to send email');
      setStatus('Sent ' + filename + ' to ' + toEmail);
    } catch (err) {
      setStatus((err && err.message) || 'Failed to send email');
    }
  }

  function resetAll() {
    state.mainImage = '';
    state.mainZoom = 1;
    state.activePanel = 0;
    state.panelNames = [];
    state.panelImages = [];
    state.panelPositions = [];
    state.panelTransforms = [];
    if (E.setName) E.setName.value = '';
    if (E.email) E.email.value = '';
    if (E.mainZoom) E.mainZoom.value = '1';
    if (E.layout) E.layout.value = 'auto';
    if (E.pieces) E.pieces.value = '6';
    setStatus('Ready.');
    applyPresetLayout();
    render();
  }

  function resetActiveHex() {
    ensureArrays();
    var idx = state.activePanel || 0;
    state.panelTransforms[idx] = defaultTransform();
    if (E.fit) E.fit.value = 'cover';
    if (E.fitLg) E.fitLg.value = 'cover';
    syncSelectedControls();
    render();
  }

  function bumpZoom(delta) {
    ensureArrays();
    var idx = state.activePanel || 0;
    if (!state.panelImages[idx]) return;
    var current = normaliseTransform(state.panelTransforms[idx]);
    updateActiveTransform({ scale: clampNumber(current.scale + delta, 0.2, 3, 1) });
  }

  function openCropModal() {
    if (!E.modal) return;
    E.modal.classList.add('is-open');
    E.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
    syncSelectedControls();
    if (E.modalClose) {
      window.requestAnimationFrame(function () { E.modalClose.focus(); });
    }
  }

  function closeCropModal() {
    if (!E.modal) return;
    E.modal.classList.remove('is-open');
    E.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
  }

  function render() {
    ensureArrays();
    renderHexGrid();
    syncSelectedControls();
  }

  function bindCropGestures() {
    if (!E.cropPreview) return;

    var drag = { active: false, startX: 0, startY: 0, startPx: 50, startPy: 50 };

    E.cropPreview.style.clipPath = HEX_CLIP;
    E.cropPreview.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      var idx = state.activePanel || 0;
      if (!state.panelImages[idx]) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      var t = normaliseTransform(state.panelTransforms[idx]);
      drag.startPx = t.x;
      drag.startPy = t.y;
      E.cropPreview.setPointerCapture(event.pointerId);
    });

    E.cropPreview.addEventListener('pointermove', function (event) {
      if (!drag.active) return;
      var rect = E.cropPreview.getBoundingClientRect();
      var dx = (event.clientX - drag.startX) / Math.max(1, rect.width);
      var dy = (event.clientY - drag.startY) / Math.max(1, rect.height);
      updateActiveTransform({
        x: clampNumber(drag.startPx + dx * 120, 0, 100, 50),
        y: clampNumber(drag.startPy + dy * 120, 0, 100, 50)
      });
    });

    function end() { drag.active = false; }
    E.cropPreview.addEventListener('pointerup', end);
    E.cropPreview.addEventListener('pointercancel', end);

    E.cropPreview.addEventListener('wheel', function (event) {
      var idx = state.activePanel || 0;
      if (!state.panelImages[idx]) return;
      event.preventDefault();
      bumpZoom(event.deltaY > 0 ? -0.08 : 0.08);
    }, { passive: false });
  }

  function bindCropGesturesLg() {
    if (!E.cropPreviewLg) return;

    var drag = { active: false, startX: 0, startY: 0, startPx: 50, startPy: 50 };

    E.cropPreviewLg.style.clipPath = HEX_CLIP;
    E.cropPreviewLg.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      var idx = state.activePanel || 0;
      if (!state.panelImages[idx]) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      var t = normaliseTransform(state.panelTransforms[idx]);
      drag.startPx = t.x;
      drag.startPy = t.y;
      E.cropPreviewLg.setPointerCapture(event.pointerId);
    });

    E.cropPreviewLg.addEventListener('pointermove', function (event) {
      if (!drag.active) return;
      var rect = E.cropPreviewLg.getBoundingClientRect();
      var dx = (event.clientX - drag.startX) / Math.max(1, rect.width);
      var dy = (event.clientY - drag.startY) / Math.max(1, rect.height);
      updateActiveTransform({
        x: clampNumber(drag.startPx + dx * 120, 0, 100, 50),
        y: clampNumber(drag.startPy + dy * 120, 0, 100, 50)
      });
    });

    function end() { drag.active = false; }
    E.cropPreviewLg.addEventListener('pointerup', end);
    E.cropPreviewLg.addEventListener('pointercancel', end);

    E.cropPreviewLg.addEventListener('wheel', function (event) {
      var idx = state.activePanel || 0;
      if (!state.panelImages[idx]) return;
      event.preventDefault();
      bumpZoom(event.deltaY > 0 ? -0.08 : 0.08);
    }, { passive: false });
  }

  function bind() {
    if (E.pieces) E.pieces.addEventListener('change', function () { applyPresetLayout(); render(); });
    if (E.layout) E.layout.addEventListener('change', function () { applyPresetLayout(); render(); });
    if (E.mainZoom) E.mainZoom.addEventListener('input', function () {
      state.mainZoom = clampNumber(E.mainZoom.value, 1, 2.5, 1);
      renderHexGrid();
    });

    document.querySelectorAll('input[name="cc-mode"]').forEach(function (r) {
      r.addEventListener('change', function () { modeChanged(r.value); });
    });

    if (E.mainFile) {
      E.mainFile.addEventListener('change', async function () {
        var file = E.mainFile.files && E.mainFile.files[0];
        if (!file) return;
        try {
          state.mainImage = await readFileAsDataUrl(file);
          setStatus('Loaded main image: ' + file.name);
          render();
        } catch (e) {
          setStatus('Could not load image');
        }
        E.mainFile.value = '';
      });
    }

    if (E.hexFile) {
      E.hexFile.addEventListener('change', async function () {
        var file = E.hexFile.files && E.hexFile.files[0];
        if (!file) return;
        ensureArrays();
        try {
          state.panelImages[state.activePanel || 0] = await readFileAsDataUrl(file);
          setStatus('Loaded hex image: ' + file.name);
          render();
          openCropModal();
        } catch (e) {
          setStatus('Could not load image');
        }
        E.hexFile.value = '';
      });
    }

    if (E.fit) E.fit.addEventListener('change', function () { updateActiveTransform({ fit: E.fit.value }); });
    if (E.x) E.x.addEventListener('input', function () { updateActiveTransform({ x: clampNumber(E.x.value, 0, 100, 50) }); });
    if (E.y) E.y.addEventListener('input', function () { updateActiveTransform({ y: clampNumber(E.y.value, 0, 100, 50) }); });
    if (E.zoomIn) E.zoomIn.addEventListener('click', function () { bumpZoom(0.12); });
    if (E.zoomOut) E.zoomOut.addEventListener('click', function () { bumpZoom(-0.12); });

    if (E.openCrop) E.openCrop.addEventListener('click', openCropModal);
    if (E.modalBackdrop) E.modalBackdrop.addEventListener('click', closeCropModal);
    if (E.modalClose) E.modalClose.addEventListener('click', closeCropModal);
    if (E.modalDone) E.modalDone.addEventListener('click', closeCropModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && E.modal && E.modal.classList.contains('is-open')) closeCropModal();
    });

    if (E.fitLg) E.fitLg.addEventListener('change', function () { updateActiveTransform({ fit: E.fitLg.value }); });
    if (E.xLg) E.xLg.addEventListener('input', function () { updateActiveTransform({ x: clampNumber(E.xLg.value, 0, 100, 50) }); });
    if (E.yLg) E.yLg.addEventListener('input', function () { updateActiveTransform({ y: clampNumber(E.yLg.value, 0, 100, 50) }); });
    if (E.zoomInLg) E.zoomInLg.addEventListener('click', function () { bumpZoom(0.12); });
    if (E.zoomOutLg) E.zoomOutLg.addEventListener('click', function () { bumpZoom(-0.12); });
    if (E.resetHexLg) E.resetHexLg.addEventListener('click', resetActiveHex);

    if (E.resetAll) E.resetAll.addEventListener('click', resetAll);
    if (E.resetHex) E.resetHex.addEventListener('click', resetActiveHex);
    if (E.download) E.download.addEventListener('click', function () { downloadJson(buildExportPayload()); });
    if (E.emailBtn) E.emailBtn.addEventListener('click', function () { emailSet(buildExportPayload()); });

    bindCropGestures();
    bindCropGesturesLg();
  }

  applyPresetLayout();
  bind();
  render();
})();
