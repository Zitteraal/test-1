/**
 * server.js
 * Postgres-only auth backend (Express + pg + connect-pg-simple + bcrypt + sessions)
 *
 * Usage:
 *   - set env: DATABASE_URL, SESSION_SECRET, (optional) DB_SSL, COOKIE_SECURE, CORS_ORIGIN
 *   - npm install express helmet cors express-session bcrypt pg connect-pg-simple body-parser
 *   - node server.js
 *
 * Minimal comments only where necessary (why).
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const ConnectPgSimple = require('connect-pg-simple')(session);
const path = require('path');
const fs = require('fs');

// Config from ENV
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_production';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false') === 'true'; // set true in production with HTTPS
const DB_SSL = String(process.env.DB_SSL || 'false') === 'true'; // if needed for remote db
const CORS_ORIGIN = process.env.CORS_ORIGIN || true; // set to specific origin in production
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is required.');
  process.exit(1);
}

// Create Postgres pool (SSL optional)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
});

// Simple query helper (will throw on error)
async function q(text, params=[]) {
  const res = await pool.query(text, params);
  return res;
}

/* Ensure required tables exist. Doing this on startup avoids migration step for small apps.
   In production you may want proper migration tooling (eg. Flyway/Knex/TypeORM migrations). */
async function ensureTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pgn TEXT,
      fens TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// DB wrappers (uniform API)
const db = {
  findUserByName: async (username) => {
    const res = await q('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    return res.rows[0] || null;
  },
  insertUser: async (username, password_hash) => {
    const res = await q('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [username, password_hash]);
    return res.rows[0].id;
  },
  insertGamesBulk: async (userId, games) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertText = 'INSERT INTO games (user_id, pgn, fens, created_at) VALUES ($1, $2, $3, $4)';
      for (const g of games) {
        const pgn = g.pgn || '';
        const fens = (g.fens == null) ? '[]' : (typeof g.fens === 'string' ? ( (() => { try { JSON.parse(g.fens); return g.fens; } catch(e){ return JSON.stringify([g.fens]); } })() ) : JSON.stringify(g.fens));
        const created_at = g.date || g.created_at || new Date().toISOString();
        await client.query(insertText, [userId, pgn, fens, created_at]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  getGamesByUser: async (userId) => {
    const res = await q('SELECT id, pgn, fens, created_at FROM games WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return res.rows.map(r => ({ id: r.id, pgn: r.pgn, fens: JSON.parse(r.fens || '[]'), date: r.created_at }));
  }
};

// App & middleware
const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// Session store in Postgres (persistent sessions)
const sessionStore = new ConnectPgSimple({
  pool,                // re-use same pg pool
  tableName: 'session' // default 'session'
});

app.use(session({
  store: sessionStore,
  name: 'hacker_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: 24 * 3600 * 1000 // 1 day
  }
}));

// Small helper middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

// Health / status
app.get('/api/status', (req, res) => {
  res.json({ ok: true, mode: 'postgres' });
});

// Whoami
app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'not_authenticated' });
  return res.json({ username: req.session.username });
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'username_and_password_required' });
    }

    const existing = await db.findUserByName(username);
    if (existing) return res.status(409).json({ error: 'username_taken' });

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const newId = await db.insertUser(username, password_hash);

    // Auto-login: regenerate session for security
    req.session.regenerate(err => {
      if (err) {
        console.error('session.regenerate error', err);
        return res.status(500).json({ error: 'session_error' });
      }
      req.session.userId = newId;
      req.session.username = username;
      return res.status(201).json({ username });
    });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username_and_password_required' });

    const user = await db.findUserByName(username);
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    req.session.regenerate(err => {
      if (err) {
        console.error('session.regenerate error', err);
        return res.status(500).json({ error: 'session_error' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.json({ username: user.username });
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('logout error', err);
      return res.status(500).json({ error: 'logout_failed' });
    }
    res.clearCookie('hacker_sid');
    return res.json({ ok: true });
  });
});

// Import games endpoint (auth required) - payload: { games: [...] }
app.post('/api/import', requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload || !Array.isArray(payload.games)) return res.status(400).json({ error: 'invalid_payload' });

    const userId = req.session.userId;
    await db.insertGamesBulk(userId, payload.games);
    return res.json({ imported: payload.games.length });
  } catch (err) {
    console.error('import error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// List games (auth)
app.get('/api/games', requireAuth, async (req, res) => {
  try {
    const games = await db.getGamesByUser(req.session.userId);
    return res.json({ games });
  } catch (err) {
    console.error('games list error', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Serve static frontend if exists
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use('/', express.static(publicDir));
  console.log('Serving static files from ./public');
}

// Initialize tables then start server
(async () => {
  try {
    await ensureTables();
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT} (mode=postgres)`);
      if (!process.env.SESSION_SECRET) console.warn('WARNING: SESSION_SECRET not set. Set it for production.');
    });
  } catch (err) {
    console.error('Startup error', err);
    process.exit(1);
  }
})();
