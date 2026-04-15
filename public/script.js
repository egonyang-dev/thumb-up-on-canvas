'use strict';

/* ============================================================
   CONFIGURATION
   ============================================================ */
const CONFIG = {
  world: { width: 3000, height: 2000 },
  zoom:  { min: 0.06, max: 12, scanScale: 1.8, wheelStep: 0.10 },
  scan:  { totalDuration: 7000, minDuration: 1500 },
  thumb: { worldWidth: 120, worldHeight: 158, canvasW: 160, canvasH: 210 },
  timing:{ zoomIn: 1100, zoomOut: 950, noticeDelay: 180, completeFade: 3000 },
  frame: { w: 110, h: 150 },
};

const LIKE_ZOOM_THRESHOLD = 1.4;

const TEXT_PRESETS = [
  '我有按讚',
  '我愛此網站',
  '已按讚',
  'i like this website.',
  'my mom like this website.',
  'I ♥ website.',
  'I left my thumb here.',
  'trained to like',
  'certified liker',
  '小小按一下',
  '小藍手報到',
  '我有乖乖按',
];

const STYLE_PRESETS = {
  colors: { black: '#111', blue: 'rgba(20,55,200,0.88)', gray: '#888' },
  fonts:  { mono: '"Courier New",Courier,monospace', sans: 'system-ui,sans-serif' },
};

/* ============================================================
   STORAGE ADAPTER
   ============================================================ */
const StorageAdapter = (() => {
  const LS_KEY = 'thumb-up-canvas-v2';
  function lsLoad()  { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function lsSave(t) { const a = lsLoad(); if (!a.find(x => x.id === t.id)) { a.push(t); try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch {} } }

  async function load() {
    try {
      const r = await fetch('/api/thumbs');
      if (!r.ok) throw new Error(r.status);
      return r.json();
    } catch { return lsLoad(); }
  }

  async function save(thumb) {
    try {
      const r = await fetch('/api/thumbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thumb),
      });
      if (!r.ok) throw new Error(r.status);
    } catch { lsSave(thumb); }
  }

  return { load, save };
})();

/* ============================================================
   SEEDED RNG
   ============================================================ */
function makeRNG(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };
}

/* ============================================================
   THUMB GENERATOR  — deterministic from params
   ============================================================ */
const ThumbGenerator = (() => {
  const CW = CONFIG.thumb.canvasW;
  const CH = CONFIG.thumb.canvasH;

  function generate({ duration, totalMovement, contactSize, seed, drawPath = [] }) {
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');
    const rng = makeRNG(seed);

    const pressure    = Math.pow(Math.min(duration / CONFIG.scan.totalDuration, 1), 0.55);
    const instability = Math.min(totalMovement / 70, 1);
    const sizeMod     = 0.65 + Math.min(contactSize / 25, 0.55);

    const cx = CW / 2, cy = CH * 0.56;
    const rx = (22 + sizeMod * 22) * (0.85 + pressure * 0.18);
    const ry = (32 + sizeMod * 30) * (0.88 + pressure * 0.14);
    const tilt = (rng() - 0.5) * 0.22 * (0.4 + instability * 0.6);

    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(tilt); ctx.translate(-cx, -cy);

    function thumbPath(jitter = 1) {
      ctx.beginPath();
      for (let i = 0; i <= 52; i++) {
        const a = (i / 52) * Math.PI * 2 - Math.PI / 2;
        const yFlat = Math.sin(a) > 0 ? 0.74 : 1;
        const noise = 1 + (rng() - 0.5) * 0.14 * instability * jitter;
        const x = cx + Math.cos(a) * rx * noise;
        const y = cy + Math.sin(a) * ry * yFlat * noise;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    if (pressure > 0.15) {
      ctx.save(); thumbPath(0.4);
      ctx.fillStyle = `rgba(18,52,195,${pressure * 0.06})`; ctx.fill(); ctx.restore();
    }
    if (instability > 0.12) {
      const mag = instability * 22, ang = rng() * Math.PI * 2;
      ctx.save();
      ctx.translate(Math.cos(ang) * mag * 0.55, Math.sin(ang) * mag * 0.55);
      thumbPath(1.4);
      ctx.fillStyle = `rgba(16,48,188,${0.03 + instability * 0.09})`; ctx.fill(); ctx.restore();
    }

    thumbPath(); ctx.save(); ctx.clip();

    const baseAlpha = Math.pow(pressure, 0.8) * 0.42;
    const g = ctx.createRadialGradient(cx, cy - ry * 0.1, 2, cx, cy, ry * 1.2);
    g.addColorStop(0,    `rgba(20,55,200,${baseAlpha * 1.85})`);
    g.addColorStop(0.45, `rgba(16,48,190,${baseAlpha})`);
    g.addColorStop(1,    `rgba(12,40,180,${baseAlpha * 0.18})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);

    if (pressure > 0.2) {
      const grains = Math.floor(pressure * 160 * (0.4 + rng() * 0.6));
      for (let i = 0; i < grains; i++) {
        const ang = rng() * Math.PI * 2, rad = rng() * rx * 0.92;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.74, 0.4 + rng() * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(10,36,172,${0.12 + pressure * 0.28 + rng() * 0.15})`; ctx.fill();
      }
    }

    const ridgeCount = Math.floor(4 + pressure * 22 + rng() * 4);
    for (let i = 0; i < ridgeCount; i++) {
      const t = i / Math.max(ridgeCount - 1, 1);
      const ridgeY = (cy - ry * 0.88) + t * ry * 1.72;
      const normY  = (ridgeY - cy) / ry;
      const normYa = normY > 0 ? normY / 0.74 : normY;
      const absN   = Math.abs(normYa);
      if (absN >= 1) continue;
      const halfW = rx * Math.sqrt(1 - normYa * normYa);
      if (halfW < 4) continue;
      const wave = halfW * 0.24 * (1 - absN * 0.45) * (1 + instability * 0.85);
      const y0 = ridgeY + (rng() - 0.5) * 4;
      const x0 = cx - halfW * (0.86 + rng() * 0.14);
      const x1 = cx + halfW * (0.86 + rng() * 0.14);
      if (instability > 0.4 && rng() < instability * 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + (rng() - 0.5) * 3);
      ctx.bezierCurveTo(
        x0 + (x1 - x0) * (0.20 + rng() * 0.14), y0 + (rng() - 0.5) * wave,
        x0 + (x1 - x0) * (0.66 + rng() * 0.14), y0 + (rng() - 0.5) * wave,
        x1, y0 + (rng() - 0.5) * 3
      );
      const edgeFade   = 1 - absN * 0.44;
      const ridgeAlpha = (0.22 + pressure * 0.62) * edgeFade * (0.5 + rng() * 0.5);
      ctx.strokeStyle = `rgba(10,40,172,${ridgeAlpha})`;
      ctx.lineWidth   = 0.6 + pressure * 0.95 + rng() * 0.6;
      ctx.stroke();
    }

    if (drawPath && drawPath.length > 1) {
      for (let i = 1; i < drawPath.length; i++) {
        const p0 = drawPath[i - 1], p1 = drawPath[i];
        const mapX = nx => (cx - rx * 0.88) + nx * (rx * 1.76);
        const mapY = ny => (cy - ry * 0.82) + ny * (ry * 1.60);
        let x0 = mapX(p0.x), y0 = mapY(p0.y);
        let x1 = mapX(p1.x), y1 = mapY(p1.y);
        const sY0 = (cy - ry * 0.88) + (p0.t || 0) * ry * 1.72;
        const sY1 = (cy - ry * 0.88) + (p1.t || 0) * ry * 1.72;
        const d0 = Math.max(0, 1 - Math.abs(y0 - sY0) / 28) * 7;
        const d1 = Math.max(0, 1 - Math.abs(y1 - sY1) / 28) * 7;
        y0 += (y0 > sY0 ? -d0 : d0) * 0.7; y1 += (y1 > sY1 ? -d1 : d1) * 0.7;
        x0 += (rng() - 0.5) * d0 * 1.4;    x1 += (rng() - 0.5) * d1 * 1.4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.strokeStyle = `rgba(8,35,175,${0.45 + pressure * 0.40})`;
        ctx.lineWidth = 1.2 + pressure * 1.8 + rng() * 0.5;
        ctx.lineCap = 'round'; ctx.stroke();
      }
    }

    ctx.restore();

    const vig = ctx.createRadialGradient(cx, cy, rx * 0.25, cx, cy, rx * 1.5);
    vig.addColorStop(0,    'rgba(255,255,255,0)');
    vig.addColorStop(0.65, 'rgba(255,255,255,0)');
    vig.addColorStop(1,    'rgba(255,255,255,0.94)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, CW, CH);
    ctx.restore();

    return canvas;
  }

  return { generate };
})();

/* ============================================================
   INTERACTION TRACKER
   ============================================================ */
const InteractionTracker = (() => {
  let t0 = null, positions = [], maxC = 0, drawPath = [];

  function start(x, y, contact = 1) {
    t0 = Date.now(); positions = [{x,y}]; maxC = contact; drawPath = [];
  }
  function update(x, y, contact = 1) {
    if (!t0) return;
    positions.push({x,y});
    if (contact > maxC) maxC = contact;
  }
  function addDrawPoint(nx, ny) {
    if (!t0) return;
    const nt = Math.min((Date.now() - t0) / CONFIG.scan.totalDuration, 1);
    drawPath.push({ x: nx, y: ny, t: nt });
  }
  function end() {
    if (!t0) return null;
    const duration = Date.now() - t0;
    let totalMovement = 0;
    for (let i = 1; i < positions.length; i++) {
      const dx = positions[i].x - positions[i-1].x, dy = positions[i].y - positions[i-1].y;
      totalMovement += Math.sqrt(dx*dx + dy*dy);
    }
    const seed = (
      Math.floor(t0 * 0.001) * 31 + Math.floor(totalMovement) * 17 +
      Math.floor(duration)   * 7  + Math.floor(positions[0]?.x ?? 0) * 3 +
      Math.floor(positions[0]?.y ?? 0) * 5
    ) & 0x7fffffff;
    t0 = null;
    return { duration, totalMovement, contactSize: maxC, seed, drawPath: [...drawPath] };
  }
  return { start, update, addDrawPoint, end };
})();

/* ============================================================
   DRAW CANVAS — real-time visual inside scan frame
   ============================================================ */
const DrawCanvas = (() => {
  let ctx = null, lastPos = null;
  function init() { ctx = document.getElementById('draw-canvas').getContext('2d'); }
  function clear() { if (!ctx) return; ctx.clearRect(0, 0, CONFIG.frame.w, CONFIG.frame.h); lastPos = null; }
  function tryDraw(sx, sy) {
    if (!ctx) return null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const fl = vw / 2 - CONFIG.frame.w / 2, ft = vh / 2 - CONFIG.frame.h / 2;
    const lx = sx - fl, ly = sy - ft;
    if (lx < 0 || lx > CONFIG.frame.w || ly < 0 || ly > CONFIG.frame.h) { lastPos = null; return null; }
    if (lastPos) {
      ctx.beginPath(); ctx.moveTo(lastPos.x, lastPos.y); ctx.lineTo(lx, ly);
      ctx.strokeStyle = 'rgba(18,55,210,0.5)'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.stroke();
    }
    lastPos = { x: lx, y: ly };
    return { x: lx / CONFIG.frame.w, y: ly / CONFIG.frame.h };
  }
  return { init, clear, tryDraw };
})();

/* ============================================================
   ZOOM / PAN CONTROLLER
   ============================================================ */
const ZoomPan = (() => {
  const WW = CONFIG.world.width, WH = CONFIG.world.height;
  let scale = 1, offsetX = 0, offsetY = 0;
  let worldEl = null, panActive = false, panEnabled = false;
  let panOrigin = {};
  let zoomCb = null;

  function init(el) { worldEl = el; resetToOverview(false); }

  function resetToOverview(animate) {
    const vw = window.innerWidth, vh = window.innerHeight;
    scale   = Math.min(vw / WW, vh / WH) * 0.92;
    offsetX = (vw - WW * scale) / 2;
    offsetY = (vh - WH * scale) / 2;
    apply(animate ? CONFIG.timing.zoomOut : 0);
  }

  function apply(ms = 0) {
    if (!worldEl) return;
    worldEl.style.transition = ms > 0 ? `transform ${ms}ms cubic-bezier(0.4,0,0.2,1)` : 'none';
    worldEl.style.transform  = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
    if (zoomCb) zoomCb(scale);
  }

  function screenToWorld(sx, sy) { return { x: (sx-offsetX)/scale, y: (sy-offsetY)/scale }; }

  function zoomToPoint(sx, sy, targetScale, ms = CONFIG.timing.zoomIn) {
    const wx = (sx-offsetX)/scale, wy = (sy-offsetY)/scale;
    scale   = Math.max(CONFIG.zoom.min, Math.min(CONFIG.zoom.max, targetScale));
    offsetX = sx - wx * scale; offsetY = sy - wy * scale;
    apply(ms);
    return new Promise(r => setTimeout(r, ms));
  }

  function zoomOut() { resetToOverview(true); return new Promise(r => setTimeout(r, CONFIG.timing.zoomOut)); }
  function enablePan() { panEnabled = true; }
  function setZoomCallback(fn) { zoomCb = fn; }

  function onWheel(e) {
    if (!panEnabled) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const ns  = Math.max(CONFIG.zoom.min, Math.min(CONFIG.zoom.max, scale * (1 + dir * CONFIG.zoom.wheelStep)));
    const wx  = (e.clientX-offsetX)/scale, wy = (e.clientY-offsetY)/scale;
    scale = ns; offsetX = e.clientX - wx*scale; offsetY = e.clientY - wy*scale;
    apply(0);
  }
  function onPointerDown(e) {
    if (!panEnabled) return;
    if (e.target.closest('.like-btn')) return; // don't pan when tapping like
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

  return { init, screenToWorld, zoomToPoint, zoomOut, enablePan, setZoomCallback,
           onWheel, onPointerDown, onPointerMove, onPointerUp };
})();

/* ============================================================
   THUMB RENDERER
   ============================================================ */
const ThumbRenderer = (() => {
  let worldEl = null;
  function init(el) { worldEl = el; }

  function renderOne(data) {
    const rng     = makeRNG(data.seed + 99);
    const dW  = data.displayW  ?? (CONFIG.thumb.worldWidth  * (0.85 + rng() * 0.35));
    const dH  = data.displayH  ?? (CONFIG.thumb.worldHeight * (dW / CONFIG.thumb.worldWidth));
    const rot = data.rotation  ?? ((rng() - 0.5) * 14);
    const opa = data.opacity   ?? (0.68 + rng() * 0.30);
    const bl  = data.blur      ?? (rng() * 0.6);

    const tc  = ThumbGenerator.generate({
      duration: data.duration, totalMovement: data.totalMovement,
      contactSize: data.contactSize, seed: data.seed, drawPath: data.drawPath || [],
    });

    const img = document.createElement('img');
    img.src       = tc.toDataURL('image/png');
    img.className = 'thumb-mark';
    img.draggable = false;
    img.style.left   = (data.wx - dW / 2) + 'px';
    img.style.top    = (data.wy - dH / 2) + 'px';
    img.style.width  = dW + 'px';
    img.style.height = dH + 'px';
    img.style.transform = `rotate(${rot}deg)`;
    img.style.opacity   = opa;
    if (bl > 0.1) img.style.filter = `blur(${bl}px)`;
    worldEl.appendChild(img);

    // Like UI (world-space, shown only when zoomed in)
    const likeEl = document.createElement('div');
    likeEl.className       = 'thumb-like-ui';
    likeEl.dataset.thumbId = data.id;
    likeEl.style.left      = (data.wx - dW / 2) + 'px';
    likeEl.style.top       = (data.wy + dH / 2 + 5) + 'px';
    likeEl.style.width     = dW + 'px';
    const count    = data.likes || 0;
    const isLiked  = LikeSystem.isLiked(data.id);
    likeEl.innerHTML =
      `<span class="like-count">${count > 0 ? count : ''}</span>` +
      `<button class="like-btn${isLiked ? ' liked' : ''}" data-thumb-id="${data.id}">+</button>`;
    worldEl.appendChild(likeEl);
  }

  function renderAll(list) { list.forEach(renderOne); }
  return { init, renderOne, renderAll };
})();

/* ============================================================
   LIKE SYSTEM
   ============================================================ */
const LikeSystem = (() => {
  const LS_KEY  = 'thumb-up-liked-ids';
  const likedSet = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));

  function saveLocal() { localStorage.setItem(LS_KEY, JSON.stringify([...likedSet])); }

  function isLiked(id) { return likedSet.has(id); }

  async function like(id) {
    if (likedSet.has(id)) return;
    likedSet.add(id); saveLocal();

    // Optimistic UI update
    document.querySelectorAll(`.like-btn[data-thumb-id="${id}"]`)
      .forEach(b => b.classList.add('liked'));

    try {
      const r = await fetch(`/api/thumbs/${encodeURIComponent(id)}/like`, { method: 'POST' });
      if (r.ok) {
        const { likes } = await r.json();
        document.querySelectorAll(`.thumb-like-ui[data-thumb-id="${id}"] .like-count`)
          .forEach(el => { el.textContent = likes > 0 ? likes : ''; });
      }
    } catch { /* offline — optimistic state is enough */ }
  }

  return { isLiked, like };
})();

/* ============================================================
   NOTICE HELPER
   ============================================================ */
const Notice = (() => {
  const el = () => document.getElementById('notification');
  let timer = null;
  function show(text, autohideMs = 0) {
    clearTimeout(timer);
    const n = el(); n.textContent = text;
    n.classList.remove('visible'); void n.offsetWidth; n.classList.add('visible');
    if (autohideMs > 0) return new Promise(resolve => {
      timer = setTimeout(() => { hide(); setTimeout(resolve, 450); }, autohideMs);
    });
    return Promise.resolve();
  }
  function hide() { clearTimeout(timer); el().classList.remove('visible'); }
  return { show, hide };
})();

/* ============================================================
   SCAN OVERLAY
   ============================================================ */
const ScanOverlay = (() => {
  let raf = null, onComplete = null;
  function show() {
    const vh = window.innerHeight;
    document.getElementById('scan-overlay').classList.remove('hidden');
    document.getElementById('scan-line').style.top = (vh / 2 - CONFIG.frame.h / 2) + 'px';
    DrawCanvas.clear();
  }
  function hide() { document.getElementById('scan-overlay').classList.add('hidden'); cancelAnimationFrame(raf); }
  function startSweep(cb) {
    const vh = window.innerHeight;
    const topY = vh / 2 - CONFIG.frame.h / 2, botY = vh / 2 + CONFIG.frame.h / 2;
    const dur = CONFIG.scan.totalDuration;
    const line = document.getElementById('scan-line');
    onComplete = cb; cancelAnimationFrame(raf);
    let t0 = null;
    function frame(ts) {
      if (!t0) t0 = ts;
      const t = Math.min((ts - t0) / dur, 1);
      line.style.top = (topY + (botY - topY) * t) + 'px';
      t < 1 ? (raf = requestAnimationFrame(frame)) : (onComplete && onComplete());
    }
    raf = requestAnimationFrame(frame);
  }
  function resetSweep() {
    cancelAnimationFrame(raf);
    document.getElementById('scan-line').style.top = (window.innerHeight / 2 - CONFIG.frame.h / 2) + 'px';
    DrawCanvas.clear();
  }
  return { show, hide, startSweep, resetSweep };
})();

/* ============================================================
   SHARE MODULE
   ============================================================ */
const Share = (() => {
  let pendingData   = null;
  let selectedPreset = 0;
  let selectedColor  = 'black';
  let selectedFont   = 'mono';

  function init() {
    // Inject text preset buttons
    const container = document.getElementById('text-presets');
    TEXT_PRESETS.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.className   = 'text-preset-btn' + (i === 0 ? ' active' : '');
      btn.textContent = text;
      btn.addEventListener('click', () => {
        selectedPreset = i;
        container.querySelectorAll('.text-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      container.appendChild(btn);
    });

    // Color swatches
    document.querySelectorAll('.swatch').forEach(s => {
      s.addEventListener('click', () => {
        selectedColor = s.dataset.color;
        document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
        s.classList.add('active');
      });
    });

    // Font buttons
    document.querySelectorAll('.font-btn').forEach(b => {
      b.addEventListener('click', () => {
        selectedFont = b.dataset.font;
        document.querySelectorAll('.font-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });

    document.getElementById('btn-share').addEventListener('click',     shareAction);
    document.getElementById('btn-download').addEventListener('click',  downloadAction);
    document.getElementById('btn-copy-link').addEventListener('click', copyLinkAction);
    document.getElementById('btn-dismiss-share').addEventListener('click', () => {
      document.getElementById('share-panel').classList.add('hidden');
    });
  }

  function setPending(data) { pendingData = data; }

  function buildCanvas() {
    const W = 1080, H = 1920;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    // Thumb
    const tc = ThumbGenerator.generate({
      duration: pendingData.duration, totalMovement: pendingData.totalMovement,
      contactSize: pendingData.contactSize, seed: pendingData.seed, drawPath: pendingData.drawPath || [],
    });
    const maxW = W * 0.62, maxH = H * 0.40;
    const sc   = Math.min(maxW / tc.width, maxH / tc.height);
    const tw = tc.width * sc, th = tc.height * sc;
    ctx.drawImage(tc, (W - tw) / 2, H * 0.12, tw, th);

    const color  = STYLE_PRESETS.colors[selectedColor];
    const font   = STYLE_PRESETS.fonts[selectedFont];
    const handle = (document.getElementById('ig-handle').value || '').trim();

    // IG handle
    if (handle) {
      const igh = handle.startsWith('@') ? handle : '@' + handle;
      ctx.font      = `30px ${font}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(igh, W / 2, H * 0.70);
    }

    // Main text
    const text   = TEXT_PRESETS[selectedPreset] || TEXT_PRESETS[0];
    const isZh   = /[\u4e00-\u9fa5]/.test(text);
    const fSize  = isZh ? 80 : Math.max(40, Math.min(72, Math.floor(1800 / text.length)));
    const fSpec  = isZh
      ? `bold ${fSize}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",${font}`
      : `${fSize}px ${font}`;
    ctx.font      = fSpec;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    wrapText(ctx, text, W / 2, H * 0.80, W * 0.82, fSize * 1.35);

    return c;
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    // Chinese: wrap by characters; English: wrap by words
    const isZh = /[\u4e00-\u9fa5]/.test(text);
    if (isZh || !text.includes(' ')) {
      ctx.fillText(text, x, y); return;
    }
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y); line = word; y += lineH;
      } else { line = test; }
    }
    ctx.fillText(line, x, y);
  }

  async function blobFromCanvas() {
    const c = buildCanvas();
    return new Promise(r => c.toBlob(r, 'image/png'));
  }

  function setStatus(msg) {
    const el = document.getElementById('share-status');
    if (el) el.textContent = msg;
  }

  // ── Share (Web Share API, fallback to download + copy) ──────────────────
  // True native share (including to Instagram) only if browser supports files in Web Share API.
  // On iOS Safari 15+ and Android Chrome: supported. On desktop: usually falls back.
  async function shareAction() {
    if (!pendingData) return;
    setStatus('');
    const blob = await blobFromCanvas();
    const file = new File([blob], 'thumb-up.png', { type: 'image/png' });
    const url  = location.href;

    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: 'thumb-up-on-canvas', url, files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled
        // Fall through to manual fallback
      }
    }

    // Fallback: download + copy link
    _download(blob);
    await _copyLink(url);
    setStatus('Image downloaded. Link copied.');
  }

  // ── Download only ────────────────────────────────────────────────────────
  async function downloadAction() {
    if (!pendingData) return;
    const blob = await blobFromCanvas();
    _download(blob);
    setStatus('Downloaded.');
  }

  // ── Copy link only ───────────────────────────────────────────────────────
  async function copyLinkAction() {
    const ok = await _copyLink(location.href);
    setStatus(ok ? 'Link copied.' : location.href);
  }

  function _download(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'thumb-up.png'; a.click();
    URL.revokeObjectURL(a.href);
  }

  async function _copyLink(url) {
    try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
  }

  return { init, setPending };
})();

/* ============================================================
   APPLICATION
   ============================================================ */
const App = (() => {
  let state = 'idle', clickWorld = null, pressing = false, pressStart = 0;

  function setState(s) { state = s; document.body.dataset.state = s; }

  async function init() {
    const world = document.getElementById('world');
    ZoomPan.init(world);
    ThumbRenderer.init(world);
    DrawCanvas.init();
    Share.init();

    // Zoom level → like UI visibility
    ZoomPan.setZoomCallback(s => {
      document.body.dataset.zoom = s >= LIKE_ZOOM_THRESHOLD ? 'close' : 'far';
    });

    const thumbs = await StorageAdapter.load();
    ThumbRenderer.renderAll(thumbs);

    document.getElementById('btn-like').addEventListener('click', onLike);

    // Like button delegation (inside world)
    document.getElementById('world').addEventListener('click', e => {
      const btn = e.target.closest('.like-btn');
      if (btn) { e.stopPropagation(); LikeSystem.like(btn.dataset.thumbId); }
    });

    const vp = document.getElementById('viewport');
    vp.addEventListener('wheel',         ZoomPan.onWheel, { passive: false });
    vp.addEventListener('pointerdown',   onPointerDown);
    vp.addEventListener('pointermove',   onPointerMove);
    vp.addEventListener('pointerup',     onPointerUp);
    vp.addEventListener('pointercancel', onPointerUp);

    // Android fix: prevent browser scroll/zoom during scan
    vp.addEventListener('touchmove', e => {
      if (state === 'scanning' || state === 'zooming') e.preventDefault();
    }, { passive: false });

    setState('idle');
  }

  function onLike() {
    const el = document.getElementById('initial-prompt');
    el.classList.add('fade-out');
    setTimeout(() => {
      el.style.display = 'none';
      Notice.show('Click anywhere.');
      setState('awaiting_click');
    }, 720);
  }

  function onPointerDown(e) {
    if      (state === 'awaiting_click') handleFirstClick(e);
    else if (state === 'scanning')       handlePressDown(e);
    else if (state === 'inspecting')     ZoomPan.onPointerDown(e);
  }
  function onPointerMove(e) {
    if (state === 'scanning' && pressing) {
      InteractionTracker.update(e.clientX, e.clientY, e.width ?? 1);
      const norm = DrawCanvas.tryDraw(e.clientX, e.clientY);
      if (norm) InteractionTracker.addDrawPoint(norm.x, norm.y);
    } else if (state === 'inspecting') {
      ZoomPan.onPointerMove(e);
    }
  }
  function onPointerUp(e) {
    if      (state === 'scanning' && pressing) handlePressUp(e);
    else if (state === 'inspecting')           ZoomPan.onPointerUp(e);
  }

  async function handleFirstClick(e) {
    setState('zooming');
    Notice.hide();
    clickWorld = ZoomPan.screenToWorld(e.clientX, e.clientY);
    await ZoomPan.zoomToPoint(e.clientX, e.clientY, CONFIG.zoom.scanScale, CONFIG.timing.zoomIn);
    await delay(CONFIG.timing.noticeDelay);
    Notice.show('Press and hold.');
    ScanOverlay.show();
    setState('scanning');
  }

  function handlePressDown(e) {
    if (pressing) return;
    pressing = true; pressStart = Date.now();
    e.currentTarget.setPointerCapture(e.pointerId);
    InteractionTracker.start(e.clientX, e.clientY, e.width ?? 1);
    Notice.hide();
    ScanOverlay.startSweep(() => { if (pressing) completeScan(); });
  }

  function handlePressUp(e) {
    if (!pressing) return;
    pressing = false;
    const held = Date.now() - pressStart;
    ScanOverlay.resetSweep();
    InteractionTracker.update(e.clientX, e.clientY, e.width ?? 1);
    if (held < CONFIG.scan.minDuration) Notice.show('Hold still.');
    else completeScan();
  }

  async function completeScan() {
    if (state !== 'scanning') return;
    setState('completing');
    pressing = false;
    const data = InteractionTracker.end();
    if (!data) { setState('scanning'); return; }

    ScanOverlay.hide(); Notice.hide();

    const rngD     = makeRNG(data.seed + 99);
    const sizeMult = 0.85 + rngD() * 0.35;
    const displayW = CONFIG.thumb.worldWidth  * sizeMult;
    const displayH = CONFIG.thumb.worldHeight * sizeMult;
    const rotation = (rngD() - 0.5) * 14;
    const opacity  = 0.68 + rngD() * 0.30;
    const blur     = rngD() * 0.6;

    const thumbData = {
      id:            Date.now().toString(36) + Math.random().toString(36).slice(2),
      wx: clickWorld.x, wy: clickWorld.y,
      displayW, displayH, rotation, opacity, blur,
      duration:      data.duration,
      totalMovement: data.totalMovement,
      contactSize:   data.contactSize,
      seed:          data.seed,
      drawPath:      data.drawPath,
      igHandle:      null,
      likes:         0,
      timestamp:     Date.now(),
    };

    await StorageAdapter.save(thumbData);
    ThumbRenderer.renderOne(thumbData);
    Share.setPending(thumbData);

    await ZoomPan.zoomOut();
    ZoomPan.enablePan();
    setState('inspecting');

    document.getElementById('share-panel').classList.remove('hidden');
    Notice.show('Thumb-up training complete.', CONFIG.timing.completeFade);
  }

  return { init };
})();

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

window.addEventListener('DOMContentLoaded', () => App.init());
