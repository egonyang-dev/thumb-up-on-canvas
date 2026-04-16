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
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS relay_pending (
      id          INTEGER PRIMARY KEY,
      sender_name TEXT,
      city        TEXT,
      message     TEXT,
      image_b64   TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `))
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

const RELAY_FALLBACK = path.join(__dirname, '.data', 'relay.json');
function readRelayFallback() {
  try { return JSON.parse(fs.readFileSync(RELAY_FALLBACK, 'utf8')); } catch { return null; }
}
function writeRelayFallback(data) {
  try {
    fs.mkdirSync(path.dirname(RELAY_FALLBACK), { recursive: true });
    fs.writeFileSync(RELAY_FALLBACK, JSON.stringify(data));
  } catch (e) { console.error('[relay] write error:', e.message); }
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

// ── POST /api/relay ──────────────────────────────────────────────────────────
// Relay logic: read pending → send to current participant → store current as new pending.
// The previous sender's email is never stored or exposed.
app.post('/api/relay', async (req, res) => {
  const { email, senderName, city, message, imageBase64 } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  if (!imageBase64) return res.status(400).json({ error: 'missing image' });

  const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_PORT, SITE_URL } = process.env;
  const smtpReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
  const siteUrl   = SITE_URL || 'https://thumb-up-on-canvas.onrender.com';

  // 1. Read pending message (the previous person's note)
  let pending = null;
  try {
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM relay_pending WHERE id = 1');
      if (rows.length) pending = rows[0];
    } else {
      pending = readRelayFallback();
    }
  } catch (e) {
    console.error('[relay] read pending error:', e.message);
  }

  // 2. If a pending note exists it must be delivered before we can accept a new one.
  //    If delivery is impossible or fails, abort — do not overwrite the pending note.
  let received = false;
  if (pending && pending.image_b64) {
    if (!smtpReady) {
      console.warn('[relay] SMTP not configured — pending note preserved, relay blocked');
      return res.status(503).json({ error: 'relay unavailable' });
    }

    const from    = (pending.sender_name || 'someone').slice(0, 60);
    const cityStr = (pending.city        || '').slice(0, 60).trim();
    const msgStr  = (pending.message     || '').slice(0, 160).trim();

    const cityLine = cityStr ? `<p style="font-size:11px;letter-spacing:0.10em;color:#aaa;margin:0 0 14px">${esc(cityStr.toLowerCase())}</p>` : '';
    const msgLine  = msgStr  ? `<p style="font-size:14px;letter-spacing:0.04em;line-height:1.75;margin:0 0 28px">${esc(msgStr)}</p>`          : '';
    const fromLine = `<p style="font-size:11px;letter-spacing:0.08em;color:#888;margin:0 0 36px">&#8212; ${esc(from)}</p>`;

    const html = `<!DOCTYPE html>
<html><body style="background:#fff;font-family:'Courier New',Courier,monospace;color:#111;max-width:560px;margin:0 auto;padding:48px 24px;">
<p style="font-size:10px;letter-spacing:0.14em;color:#bbb;margin:0 0 36px;text-transform:lowercase">a stranger left this for you.</p>
<img src="cid:thumb" alt="" style="width:100%;max-width:480px;display:block;margin:0 auto 36px">
${cityLine}${msgLine}${fromLine}
<hr style="border:none;border-top:1px solid #eee;margin:0 0 22px">
<p style="font-size:10px;color:#ccc;letter-spacing:0.06em;line-height:1.8">thumb-up-on-canvas<br>
<a href="${siteUrl}" style="color:#ccc;text-decoration:none">${siteUrl}</a><br><br>
<a href="https://www.instagram.com/yangyukuang/" style="color:#ccc;text-decoration:none">@yangyukuang</a> &nbsp;·&nbsp;
<a href="https://www.instagram.com/patch.paper/" style="color:#ccc;text-decoration:none">@patch.paper</a></p>
</body></html>`;

    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || '587'),
        secure: SMTP_PORT === '465',
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporter.sendMail({
        from:    SMTP_FROM || SMTP_USER,
        to:      email.slice(0, 120),
        subject: 'someone left a note for you',
        html,
        attachments: [{ filename: 'thumb-up.png', content: pending.image_b64, encoding: 'base64', cid: 'thumb' }],
      });
      console.log(`[relay] sent pending note to ${email}`);
      received = true;
    } catch (e) {
      // Send failed — pending note is preserved, relay chain intact
      console.error('[relay] send error:', e.message);
      return res.status(500).json({ error: 'relay send failed' });
    }
  }

  // 3. Store current participant's message as the new pending (email never stored).
  //    Reached only when: (a) no pending existed, or (b) pending was successfully delivered.
  const imgData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const newName = (senderName || '').slice(0, 60).trim() || null;
  const newCity = (city       || '').slice(0, 60).trim() || null;
  const newMsg  = (message    || '').slice(0, 160).trim() || null;

  try {
    if (pool) {
      await pool.query(
        `INSERT INTO relay_pending (id, sender_name, city, message, image_b64, created_at)
         VALUES (1, $1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE SET
           sender_name = EXCLUDED.sender_name,
           city        = EXCLUDED.city,
           message     = EXCLUDED.message,
           image_b64   = EXCLUDED.image_b64,
           created_at  = EXCLUDED.created_at`,
        [newName, newCity, newMsg, imgData]
      );
    } else {
      writeRelayFallback({ senderName: newName, city: newCity, message: newMsg, imageB64: imgData, createdAt: new Date().toISOString() });
    }
  } catch (e) {
    console.error('[relay] store error:', e.message);
    return res.status(500).json({ error: 'store failed' });
  }

  res.json({ ok: true, received });
});

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = pool ? 'postgres' : 'file fallback';
  console.log(`[thumb-up] http://localhost:${PORT}  (${mode})`);
});
