'use strict';
const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
const fs      = require('fs');

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Storage ──────────────────────────────────────────────────────────────────
let pool = null;
const FALLBACK = path.join(__dirname, '.data', 'thumbs.json');

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.query(`
    CREATE TABLE IF NOT EXISTS thumbs (
      id          TEXT PRIMARY KEY,
      wx          DOUBLE PRECISION NOT NULL,
      wy          DOUBLE PRECISION NOT NULL,
      display_w   DOUBLE PRECISION NOT NULL,
      display_h   DOUBLE PRECISION NOT NULL,
      rotation    DOUBLE PRECISION NOT NULL,
      opacity     DOUBLE PRECISION NOT NULL,
      blur        DOUBLE PRECISION NOT NULL,
      duration    INTEGER          NOT NULL,
      total_move  DOUBLE PRECISION NOT NULL,
      contact     DOUBLE PRECISION NOT NULL,
      seed        BIGINT           NOT NULL,
      draw_path   JSONB            DEFAULT '[]',
      ig_handle   TEXT,
      created_at  TIMESTAMPTZ      DEFAULT NOW()
    )
  `).catch(e => console.error('[db] init error:', e.message));
}

function readFallback() {
  try { return JSON.parse(fs.readFileSync(FALLBACK, 'utf8')); } catch { return []; }
}
function writeFallback(data) {
  try {
    fs.mkdirSync(path.dirname(FALLBACK), { recursive: true });
    fs.writeFileSync(FALLBACK, JSON.stringify(data));
  } catch (e) { console.error('[file] write error:', e.message); }
}

function row2obj(r) {
  return {
    id:            r.id,
    wx:            +r.wx,
    wy:            +r.wy,
    displayW:      +r.display_w,
    displayH:      +r.display_h,
    rotation:      +r.rotation,
    opacity:       +r.opacity,
    blur:          +r.blur,
    duration:      +r.duration,
    totalMovement: +r.total_move,
    contactSize:   +r.contact,
    seed:          +r.seed,
    drawPath:      r.draw_path  || [],
    igHandle:      r.ig_handle  || null,
    createdAt:     r.created_at,
  };
}

// ── GET /api/thumbs ──────────────────────────────────────────────────────────
app.get('/api/thumbs', async (_req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM thumbs ORDER BY created_at ASC');
      return res.json(rows.map(row2obj));
    }
    res.json(readFallback());
  } catch (e) {
    console.error('[api] GET /api/thumbs:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/thumbs ─────────────────────────────────────────────────────────
app.post('/api/thumbs', async (req, res) => {
  const t = req.body;
  if (!t?.id || t.wx == null || t.wy == null) {
    return res.status(400).json({ error: 'missing required fields' });
  }
  try {
    if (pool) {
      await pool.query(
        `INSERT INTO thumbs
           (id, wx, wy, display_w, display_h, rotation, opacity, blur,
            duration, total_move, contact, seed, draw_path, ig_handle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [ t.id, t.wx, t.wy, t.displayW, t.displayH, t.rotation,
          t.opacity, t.blur, t.duration, t.totalMovement, t.contactSize,
          t.seed, JSON.stringify(t.drawPath || []), t.igHandle || null ]
      );
    } else {
      const all = readFallback();
      if (!all.find(x => x.id === t.id)) { all.push(t); writeFallback(all); }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[api] POST /api/thumbs:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = pool ? 'postgres' : 'file fallback';
  console.log(`[thumb-up] http://localhost:${PORT}  (${mode})`);
});
