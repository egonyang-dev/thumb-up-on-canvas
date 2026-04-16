'use strict';
const express    = require('express');
const path       = require('path');
const { Pool }   = require('pg');
const fs         = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Storage ──────────────────────────────────────────────────────────────────
let pool = null;
const FALLBACK = path.join(__dirname, '.data', 'thumbs.json');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
      likes       INTEGER          DEFAULT 0,
      created_at  TIMESTAMPTZ      DEFAULT NOW()
    )
  `)
  .then(() => pool.query('ALTER TABLE thumbs ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0'))
  .then(() => console.log('[storage] mode: postgres'))
  .catch(e => {
    console.error('[db] init error:', e.message);
    if (IS_PRODUCTION) console.error('[storage] WARN: postgres init failed — data will NOT persist on Render');
  });
} else {
  if (IS_PRODUCTION) {
    console.error('[storage] ERROR: DATABASE_URL is not set in production. Thumbs will be lost on restart.');
  } else {
    console.log('[storage] mode: local file fallback (dev only) →', FALLBACK);
  }
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
    likes:         +r.likes     || 0,
    createdAt:     r.created_at,
  };
}

// ── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ storage: pool ? 'postgres' : 'file-fallback', uptime: process.uptime() });
});

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

// ── POST /api/thumbs/:id/like ────────────────────────────────────────────────
app.post('/api/thumbs/:id/like', async (req, res) => {
  const { id } = req.params;
  try {
    if (pool) {
      const { rows } = await pool.query(
        'UPDATE thumbs SET likes = likes + 1 WHERE id = $1 RETURNING likes',
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'not found' });
      return res.json({ likes: rows[0].likes });
    } else {
      const all = readFallback();
      const t = all.find(x => x.id === id);
      if (!t) return res.status(404).json({ error: 'not found' });
      t.likes = (t.likes || 0) + 1;
      writeFallback(all);
      return res.json({ likes: t.likes });
    }
  } catch (e) {
    console.error('[api] like:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/postcard ───────────────────────────────────────────────────────
app.post('/api/postcard', async (req, res) => {
  const { to, senderName, city, message, imageBase64 } = req.body || {};

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  if (!imageBase64) return res.status(400).json({ error: 'missing image' });

  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_PORT, SITE_URL } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[postcard] SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS');
    return res.status(503).json({ error: 'mail not configured' });
  }

  const from     = (senderName || '').slice(0, 60).trim() || 'someone';
  const cityStr  = (city        || '').slice(0, 60).trim();
  const msgStr   = (message     || '').slice(0, 160).trim();
  const siteUrl  = SITE_URL || 'https://thumb-up-on-canvas.onrender.com';
  const imgData  = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const cityLine   = cityStr ? `<p style="font-size:11px;letter-spacing:0.10em;color:#aaa;margin:0 0 14px">${esc(cityStr.toLowerCase())}</p>` : '';
  const msgLine    = msgStr   ? `<p style="font-size:14px;letter-spacing:0.04em;line-height:1.75;margin:0 0 28px">${esc(msgStr)}</p>` : '';
  const fromLine   = `<p style="font-size:11px;letter-spacing:0.08em;color:#888;margin:0 0 36px">&#8212; ${esc(from)}</p>`;

  const html = `<!DOCTYPE html>
<html><body style="background:#fff;font-family:'Courier New',Courier,monospace;color:#111;max-width:560px;margin:0 auto;padding:48px 24px;">
<img src="cid:thumb" alt="" style="width:100%;max-width:480px;display:block;margin:0 auto 36px">
${cityLine}${msgLine}${fromLine}
<hr style="border:none;border-top:1px solid #eee;margin:0 0 22px">
<p style="font-size:10px;color:#ccc;letter-spacing:0.06em;line-height:1.8">thumb-up-on-canvas<br>
<a href="${siteUrl}" style="color:#ccc;text-decoration:none">${siteUrl}</a><br><br>
<a href="https://www.instagram.com/patchpaper/" style="color:#ccc;text-decoration:none">@patchpaper</a> &nbsp;·&nbsp;
<a href="https://www.instagram.com/yu.kuang/" style="color:#ccc;text-decoration:none">@yu.kuang</a></p>
</body></html>`;

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '587'),
      secure: SMTP_PORT === '465',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to:   to.slice(0, 120),
      subject: 'a thumb-up for you',
      html,
      attachments: [{ filename: 'thumb-up.png', content: imgData, encoding: 'base64', cid: 'thumb' }],
    });
    console.log(`[postcard] sent to ${to}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[postcard] send error:', e.message);
    res.status(500).json({ error: 'send failed' });
  }
});

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = pool ? 'postgres' : 'file fallback';
  console.log(`[thumb-up] http://localhost:${PORT}  (${mode})`);
});
