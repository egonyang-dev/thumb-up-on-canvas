'use strict';

/* ============================================================
   CONFIGURATION  — edit these to tune the piece
   ============================================================ */
const CONFIG = {
  world: { width: 3000, height: 2000 },
  zoom: {
    min:        0.08,
    max:        10,
    scanScale:  1.6,    // absolute scale during scanning
    wheelStep:  0.10,   // zoom speed per wheel tick
  },
  scan: {
    totalDuration:  3200,   // ms — full press-and-hold time
    minDuration:    1200,   // ms — below this: rejected
  },
  thumb: {
    worldWidth:     115,    // world-px width of rendered mark
    worldHeight:    152,    // world-px height of rendered mark
    canvasWidth:    160,    // internal canvas resolution
    canvasHeight:   210,
  },
  timing: {
    zoomIn:         1100,   // ms
    zoomOut:         950,   // ms
    noticeShowDelay: 200,   // ms before showing instruction after zoom
    completeFade:   2800,   // ms — "Thumb-up training complete." stays
  },
};

/* ============================================================
   STORAGE ADAPTER
   — Swap load / save for an API when backend is ready
   ============================================================ */
const StorageAdapter = (() => {
  const KEY = 'thumb-up-canvas-v1';

  // Future backend: replace with fetch('/api/thumbs')
  async function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[storage] load failed', e);
      return [];
    }
  }

  // Future backend: replace with fetch('/api/thumbs', { method:'POST', body: JSON.stringify(thumb) })
  async function save(thumb) {
    try {
      const all = await load();
      all.push(thumb);
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('[storage] save failed', e);
    }
  }

  return { load, save };
})();

/* ============================================================
   SEEDED RANDOM
   ============================================================ */
function makeRNG(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
}

/* ============================================================
   THUMB GENERATOR
   — Produces a unique Canvas element per interaction
   ============================================================ */
const ThumbGenerator = (() => {
  const CW = CONFIG.thumb.canvasWidth;
  const CH = CONFIG.thumb.canvasHeight;

  function generate({ duration, totalMovement, contactSize, seed }) {
    const canvas = document.createElement('canvas');
    canvas.width  = CW;
    canvas.height = CH;
    const ctx = canvas.getContext('2d');

    const rng = makeRNG(seed);

    // Normalised inputs
    const pressure    = Math.pow(Math.min(duration    / CONFIG.scan.totalDuration, 1), 0.65);
    const instability = Math.min(totalMovement / 90, 1);
    const sizeMod     = 0.72 + Math.min(contactSize / 28, 0.45);

    const cx = CW / 2;
    const cy = CH * 0.57;

    // Thumb radii
    const rx = (26 + sizeMod * 20) * (0.92 + pressure * 0.08);
    const ry = (38 + sizeMod * 26) * (0.93 + pressure * 0.07);

    // Slight global tilt
    const tilt = (rng() - 0.5) * 0.18 * (0.5 + instability * 0.5);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.translate(-cx, -cy);

    /* -- Thumb silhouette path -------------------------------- */
    function drawThumbPath(jitterScale = 1) {
      ctx.beginPath();
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a   = (i / steps) * Math.PI * 2 - Math.PI / 2;
        // flatten the bottom half
        const yScale = Math.sin(a) > 0 ? 0.76 : 1;
        const noise  = 1 + (rng() - 0.5) * 0.13 * instability * jitterScale;
        const x = cx + Math.cos(a) * rx * noise;
        const y = cy + Math.sin(a) * ry * yScale * noise;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    /* -- 1. Smear ghost (unstable press) --------------------- */
    if (instability > 0.15) {
      const smearMag   = instability * 18;
      const smearAngle = rng() * Math.PI * 2;
      ctx.save();
      ctx.translate(
        Math.cos(smearAngle) * smearMag * 0.6,
        Math.sin(smearAngle) * smearMag * 0.6
      );
      drawThumbPath(1.3);
      ctx.fillStyle = `rgba(18, 55, 185, ${0.035 + instability * 0.07})`;
      ctx.fill();
      ctx.restore();
    }

    /* -- 2. Clip to thumb shape ------------------------------ */
    drawThumbPath();
    ctx.save();
    ctx.clip();

    /* -- 3. Base fill — radial gradient ---------------------- */
    const baseA = 0.10 + pressure * 0.20;
    const grad  = ctx.createRadialGradient(cx, cy - ry * 0.08, 3, cx, cy, ry * 1.15);
    grad.addColorStop(0,   `rgba(22, 58, 195, ${baseA * 1.7})`);
    grad.addColorStop(0.5, `rgba(18, 50, 185, ${baseA})`);
    grad.addColorStop(1,   `rgba(14, 42, 175, ${baseA * 0.25})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);

    /* -- 4. Fingerprint ridges ------------------------------- */
    const ridgeCount = Math.floor(9 + pressure * 13 + rng() * 5);

    for (let i = 0; i < ridgeCount; i++) {
      const t         = i / Math.max(ridgeCount - 1, 1);
      const ridgeY    = (cy - ry * 0.88) + t * ry * 1.72;
      const normY     = (ridgeY - cy) / ry;
      // account for bottom flatten
      const normYadj  = normY > 0 ? normY / 0.76 : normY;
      const absNormY  = Math.abs(normYadj);
      if (absNormY >= 1) continue;

      const halfW   = rx * Math.sqrt(1 - normYadj * normYadj);
      if (halfW < 5) continue;

      // Waviness: higher in the middle, less at tips
      const waviness = halfW * 0.22 * (1 - absNormY * 0.5) * (1 + instability * 0.7);

      const y0  = ridgeY + (rng() - 0.5) * 3.5;
      const x0  = cx - halfW * (0.88 + rng() * 0.12);
      const x1  = cx + halfW * (0.88 + rng() * 0.12);
      const cp1x = x0 + (x1 - x0) * (0.22 + rng() * 0.12);
      const cp1y = y0 + (rng() - 0.5) * waviness;
      const cp2x = x0 + (x1 - x0) * (0.68 + rng() * 0.12);
      const cp2y = y0 + (rng() - 0.5) * waviness;

      ctx.beginPath();
      ctx.moveTo(x0, y0 + (rng() - 0.5) * 2);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x1, y0 + (rng() - 0.5) * 2);

      const edgeFade   = 1 - absNormY * 0.42;
      const ridgeAlpha = (0.32 + pressure * 0.48) * edgeFade * (0.55 + rng() * 0.45);
      ctx.strokeStyle = `rgba(12, 44, 172, ${ridgeAlpha})`;
      ctx.lineWidth   = 0.7 + pressure * 0.75 + rng() * 0.55;
      ctx.stroke();
    }

    /* -- 5. Pore details (higher pressure = more visible) ---- */
    if (pressure > 0.28) {
      const poreCount = Math.floor((pressure - 0.28) * 55 * (0.4 + rng() * 0.6));
      for (let i = 0; i < poreCount; i++) {
        const a  = rng() * Math.PI * 2;
        const r  = rng() * rx * 0.82;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r * 0.76;
        ctx.beginPath();
        ctx.arc(px, py, 0.6 + rng() * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10, 38, 168, ${0.28 + pressure * 0.42})`;
        ctx.fill();
      }
    }

    ctx.restore(); // end clip

    /* -- 6. Edge vignette — blur the silhouette softly ------- */
    const vig = ctx.createRadialGradient(cx, cy, rx * 0.28, cx, cy, rx * 1.45);
    vig.addColorStop(0,   'rgba(255,255,255,0)');
    vig.addColorStop(0.7, 'rgba(255,255,255,0)');
    vig.addColorStop(1,   'rgba(255,255,255,0.92)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CW, CH);

    ctx.restore(); // end tilt

    return canvas;
  }

  return { generate };
})();

/* ============================================================
   INTERACTION TRACKER
   ============================================================ */
const InteractionTracker = (() => {
  let t0        = null;
  let positions = [];
  let maxC      = 0;

  function start(x, y, contact = 1) {
    t0        = Date.now();
    positions = [{ x, y }];
    maxC      = contact;
  }

  function update(x, y, contact = 1) {
    if (!t0) return;
    positions.push({ x, y });
    if (contact > maxC) maxC = contact;
  }

  function end() {
    if (!t0) return null;
    const duration = Date.now() - t0;
    let totalMovement = 0;
    for (let i = 1; i < positions.length; i++) {
      const dx = positions[i].x - positions[i - 1].x;
      const dy = positions[i].y - positions[i - 1].y;
      totalMovement += Math.sqrt(dx * dx + dy * dy);
    }
    // Seed derived from interaction specifics
    const seed = (
      Math.floor(t0 * 0.001) * 31 +
      Math.floor(totalMovement) * 17 +
      Math.floor(duration) * 7 +
      Math.floor((positions[0]?.x ?? 0)) * 3 +
      Math.floor((positions[0]?.y ?? 0)) * 5
    ) & 0x7fffffff;

    t0 = null;
    return { duration, totalMovement, contactSize: maxC, seed };
  }

  return { start, update, end };
})();

/* ============================================================
   ZOOM / PAN CONTROLLER
   ============================================================ */
const ZoomPan = (() => {
  const WW = CONFIG.world.width;
  const WH = CONFIG.world.height;

  let scale = 1, offsetX = 0, offsetY = 0;
  let worldEl   = null;
  let panActive = false;
  let panOrigin = { x: 0, y: 0, ox: 0, oy: 0 };
  let panEnabled = false;

  function init(el) {
    worldEl = el;
    resetToOverview(false);
  }

  function resetToOverview(animate = false) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    scale   = Math.min(vw / WW, vh / WH) * 0.92;
    offsetX = (vw - WW * scale) / 2;
    offsetY = (vh - WH * scale) / 2;
    apply(animate ? CONFIG.timing.zoomOut : 0);
  }

  function apply(duration = 0) {
    if (!worldEl) return;
    worldEl.style.transition = duration > 0
      ? `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`
      : 'none';
    worldEl.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
  }

  // Screen → world coordinates
  function screenToWorld(sx, sy) {
    return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
  }

  // World → screen coordinates
  function worldToScreen(wx, wy) {
    return { x: wx * scale + offsetX, y: wy * scale + offsetY };
  }

  // Zoom to a screen point, reaching targetScale
  function zoomToPoint(sx, sy, targetScale, duration = CONFIG.timing.zoomIn) {
    const wx = (sx - offsetX) / scale;
    const wy = (sy - offsetY) / scale;
    scale   = Math.max(CONFIG.zoom.min, Math.min(CONFIG.zoom.max, targetScale));
    offsetX = sx - wx * scale;
    offsetY = sy - wy * scale;
    apply(duration);
    return new Promise(r => setTimeout(r, duration));
  }

  function zoomOut() {
    resetToOverview(true);
    return new Promise(r => setTimeout(r, CONFIG.timing.zoomOut));
  }

  function enablePan() { panEnabled = true; }

  /* Pan / zoom event handlers — called from App */
  function onWheel(e) {
    if (!panEnabled) return;
    e.preventDefault();
    const dir    = e.deltaY < 0 ? 1 : -1;
    const factor = 1 + dir * CONFIG.zoom.wheelStep;
    const newS   = Math.max(CONFIG.zoom.min, Math.min(CONFIG.zoom.max, scale * factor));
    const wx     = (e.clientX - offsetX) / scale;
    const wy     = (e.clientY - offsetY) / scale;
    scale   = newS;
    offsetX = e.clientX - wx * scale;
    offsetY = e.clientY - wy * scale;
    apply(0);
  }

  function onPointerDown(e) {
    if (!panEnabled) return;
    panActive = true;
    panOrigin = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!panActive || !panEnabled) return;
    offsetX = panOrigin.ox + (e.clientX - panOrigin.x);
    offsetY = panOrigin.oy + (e.clientY - panOrigin.y);
    apply(0);
  }

  function onPointerUp() { panActive = false; }

  return {
    init,
    screenToWorld,
    worldToScreen,
    zoomToPoint,
    zoomOut,
    enablePan,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    getScale: () => scale,
  };
})();

/* ============================================================
   THUMB RENDERER
   ============================================================ */
const ThumbRenderer = (() => {
  let worldEl = null;

  function init(el) { worldEl = el; }

  function renderOne(data) {
    const img       = document.createElement('img');
    img.src         = data.imageData;
    img.className   = 'thumb-mark';
    img.style.left  = (data.wx - data.displayW / 2) + 'px';
    img.style.top   = (data.wy - data.displayH / 2) + 'px';
    img.style.width  = data.displayW + 'px';
    img.style.height = data.displayH + 'px';
    img.style.transform = `rotate(${data.rotation}deg)`;
    img.style.opacity   = data.opacity;
    img.style.filter    = `blur(${data.blur}px)`;
    worldEl.appendChild(img);
  }

  function renderAll(list) { list.forEach(renderOne); }

  return { init, renderOne, renderAll };
})();

/* ============================================================
   NOTIFICATION HELPER
   ============================================================ */
const Notice = (() => {
  const el = () => document.getElementById('notification');
  let hideTimer = null;

  function show(text, autohideMs = 0) {
    clearTimeout(hideTimer);
    const n = el();
    n.textContent = text;
    // Force reflow to restart transition
    n.classList.remove('visible');
    void n.offsetWidth;
    n.classList.add('visible');

    if (autohideMs > 0) {
      return new Promise(resolve => {
        hideTimer = setTimeout(() => {
          hide();
          setTimeout(resolve, 450);
        }, autohideMs);
      });
    }
    return Promise.resolve();
  }

  function hide() {
    clearTimeout(hideTimer);
    el().classList.remove('visible');
  }

  return { show, hide };
})();

/* ============================================================
   SCAN OVERLAY CONTROLLER
   ============================================================ */
const ScanOverlay = (() => {
  let animFrame  = null;
  let startedAt  = null;
  let onComplete = null;

  function show() {
    const vh = window.innerHeight;
    const overlay = document.getElementById('scan-overlay');
    const line    = document.getElementById('scan-line');

    overlay.classList.remove('hidden');

    // Position scan line at top of frame
    line.style.top = (vh / 2 - 75) + 'px';

    startedAt = null;
  }

  function hide() {
    document.getElementById('scan-overlay').classList.add('hidden');
    cancelAnimationFrame(animFrame);
  }

  // Starts the sweep animation; calls cb when full duration is reached
  function startSweep(cb) {
    const vh     = window.innerHeight;
    const topY   = vh / 2 - 75;
    const botY   = vh / 2 + 75;
    const dur    = CONFIG.scan.totalDuration;
    const line   = document.getElementById('scan-line');
    onComplete   = cb;
    startedAt    = null;

    cancelAnimationFrame(animFrame);

    function frame(ts) {
      if (!startedAt) startedAt = ts;
      const t = Math.min((ts - startedAt) / dur, 1);
      line.style.top = (topY + (botY - topY) * t) + 'px';
      if (t < 1) {
        animFrame = requestAnimationFrame(frame);
      } else {
        onComplete && onComplete();
      }
    }
    animFrame = requestAnimationFrame(frame);
  }

  function resetSweep() {
    cancelAnimationFrame(animFrame);
    const vh  = window.innerHeight;
    const line = document.getElementById('scan-line');
    line.style.top = (vh / 2 - 75) + 'px';
    startedAt = null;
  }

  return { show, hide, startSweep, resetSweep };
})();

/* ============================================================
   APPLICATION — state machine
   States: idle | awaiting_click | zooming | scanning | completing | inspecting
   ============================================================ */
const App = (() => {
  let state       = 'idle';
  let clickWorld  = null;   // { x, y } world coords of the click
  let pressing    = false;
  let pressStart  = 0;
  let capturedId  = null;

  function setState(s) {
    state = s;
    document.body.dataset.state = s;
  }

  /* ---- init ------------------------------------------------ */
  async function init() {
    const world = document.getElementById('world');
    ZoomPan.init(world);
    ThumbRenderer.init(world);

    const thumbs = await StorageAdapter.load();
    ThumbRenderer.renderAll(thumbs);

    // Bind events
    document.getElementById('btn-like').addEventListener('click', onLike);

    const vp = document.getElementById('viewport');
    vp.addEventListener('wheel',        ZoomPan.onWheel, { passive: false });
    vp.addEventListener('pointerdown',  onPointerDown);
    vp.addEventListener('pointermove',  onPointerMove);
    vp.addEventListener('pointerup',    onPointerUp);
    vp.addEventListener('pointercancel', onPointerUp);

    setState('idle');
  }

  /* ---- Like button ----------------------------------------- */
  function onLike() {
    const prompt = document.getElementById('initial-prompt');
    prompt.classList.add('fade-out');
    setTimeout(() => {
      prompt.style.display = 'none';
      Notice.show('Click anywhere.');
      setState('awaiting_click');
    }, 720);
  }

  /* ---- Pointer events -------------------------------------- */
  function onPointerDown(e) {
    if (state === 'awaiting_click') {
      handleFirstClick(e);
    } else if (state === 'scanning') {
      handlePressDown(e);
    } else if (state === 'inspecting') {
      ZoomPan.onPointerDown(e);
    }
  }

  function onPointerMove(e) {
    if (state === 'scanning' && pressing) {
      InteractionTracker.update(e.clientX, e.clientY, e.width ?? 1);
    } else if (state === 'inspecting') {
      ZoomPan.onPointerMove(e);
    }
  }

  function onPointerUp(e) {
    if (state === 'scanning' && pressing) {
      handlePressUp(e);
    } else if (state === 'inspecting') {
      ZoomPan.onPointerUp(e);
    }
  }

  /* ---- First canvas click: zoom in ------------------------- */
  async function handleFirstClick(e) {
    setState('zooming');
    Notice.hide();

    const sx = e.clientX;
    const sy = e.clientY;
    clickWorld = ZoomPan.screenToWorld(sx, sy);

    // Zoom into click point
    await ZoomPan.zoomToPoint(sx, sy, CONFIG.zoom.scanScale, CONFIG.timing.zoomIn);

    // Small delay, then instruction
    await delay(CONFIG.timing.noticeShowDelay);
    Notice.show('Press and hold.');

    ScanOverlay.show();
    setState('scanning');
  }

  /* ---- Press down: begin scan ------------------------------ */
  function handlePressDown(e) {
    if (pressing) return;
    pressing   = true;
    pressStart = Date.now();
    capturedId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    InteractionTracker.start(e.clientX, e.clientY, e.width ?? 1);
    Notice.hide();

    ScanOverlay.startSweep(() => {
      // Full duration reached while still pressing
      if (pressing) completeScan();
    });
  }

  /* ---- Press up: check if duration met --------------------- */
  function handlePressUp(e) {
    if (!pressing) return;
    pressing = false;

    const held = Date.now() - pressStart;
    ScanOverlay.resetSweep();
    InteractionTracker.update(e.clientX, e.clientY, e.width ?? 1);

    if (held < CONFIG.scan.minDuration) {
      // Too short — reject and allow retry
      Notice.show('Hold still.');
    } else {
      // Sufficient duration — complete with whatever data was collected
      completeScan();
    }
  }

  /* ---- Complete scan, generate thumb ----------------------- */
  async function completeScan() {
    if (state !== 'scanning') return;
    setState('completing');
    pressing = false;

    const data = InteractionTracker.end();
    ScanOverlay.hide();
    Notice.hide();

    if (!data) { setState('scanning'); return; } // safety guard

    // Generate the unique thumb mark
    const thumbCanvas = ThumbGenerator.generate(data);
    const imageData   = thumbCanvas.toDataURL('image/png');

    // Small random display size variation
    const rngLocal  = makeRNG(data.seed + 99);
    const sizeMult  = 0.85 + rngLocal() * 0.35;
    const displayW  = CONFIG.thumb.worldWidth  * sizeMult;
    const displayH  = CONFIG.thumb.worldHeight * sizeMult;
    const rotation  = (rngLocal() - 0.5) * 14;
    const opacity   = 0.68 + rngLocal() * 0.30;
    const blur      = rngLocal() * 0.6; // very subtle blur on some

    const thumbData = {
      id:       Date.now().toString(36) + Math.random().toString(36).slice(2),
      wx:       clickWorld.x,
      wy:       clickWorld.y,
      imageData,
      displayW,
      displayH,
      rotation,
      opacity,
      blur,
      timestamp: Date.now(),
    };

    await StorageAdapter.save(thumbData);
    ThumbRenderer.renderOne(thumbData);

    // Zoom out, then enable navigation immediately
    await ZoomPan.zoomOut();
    ZoomPan.enablePan();
    setState('inspecting');

    // Final message (non-blocking — user can already pan/zoom)
    Notice.show('Thumb-up training complete.', CONFIG.timing.completeFade);
  }

  return { init };
})();

/* ============================================================
   UTILITIES
   ============================================================ */
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ============================================================
   BOOT
   ============================================================ */
window.addEventListener('DOMContentLoaded', () => App.init());
