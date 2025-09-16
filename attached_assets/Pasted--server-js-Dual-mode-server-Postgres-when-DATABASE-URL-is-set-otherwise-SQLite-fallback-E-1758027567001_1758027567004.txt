// server.js
// Dual-mode server: Postgres when DATABASE_URL is set, otherwise SQLite fallback.
// Endpoints: /api/status, /api/register, /api/login, /api/logout, /api/me, /api/import, /api/games

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const usePostgres = !!process.env.DATABASE_URL;
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_production';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const CORS_ORIGIN = process.env.CORS_ORIGIN || true; // restrict in prod

const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

let dbClient = null;      // for postgres pool or sqlite db object
let queries = {};         // wrapper for DB ops (uniform API)
let sessionMiddleware;    // express-session configured with appropriate store

async function initPostgres() {
  const { Pool } = require('pg');
  const PgSession = require('connect-pg-simple')(session);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });

  // create tables if not exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pgn TEXT,
      fens TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // uniform query wrappers
  queries.findUserByName = async (username) => {
    const r = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    return r.rows[0] || null;
  };
  queries.insertUser = async (username, password_hash) => {
    const r = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [username, password_hash]);
    return r.rows[0].id;
  };
  queries.insertGamesBulk = async (userId, games) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const g of games) {
        await client.query('INSERT INTO games (user_id, pgn, fens) VALUES ($1, $2, $3)', [userId, g.pgn || '', JSON.stringify(g.fens || [])]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
  queries.getGamesByUser = async (userId) => {
    const r = await pool.query('SELECT id, pgn, fens, created_at FROM games WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return r.rows.map(r => ({ id: r.id, pgn: r.pgn, fens: JSON.parse(r.fens || '[]'), date: r.created_at }));
  };

  // setup session store in Postgres
  sessionMiddleware = session({
    store: new PgSession({ pool }),
    name: 'hacker_sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', maxAge: 24 * 3600 * 1000 }
  });

  dbClient = pool;
  console.log('Using Postgres DB');
}

function initSqlite() {
  const Database = require('better-sqlite3');
  const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'hackerChess.db');
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pgn TEXT,
      fens TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `).run();

  queries.findUserByName = (username) => {
    return db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) || null;
  };
  queries.insertUser = (username, password_hash) => {
    const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, password_hash);
    return info.lastInsertRowid;
  };
  queries.insertGamesBulk = (userId, games) => {
    const insert = db.prepare('INSERT INTO games (user_id, pgn, fens) VALUES (?, ?, ?)');
    const tx = db.transaction((garr) => { for (const g of garr) insert.run(userId, g.pgn || '', JSON.stringify(g.fens || [])); });
    tx(games);
  };
  queries.getGamesByUser = (userId) => {
    const rows = db.prepare('SELECT id, pgn, fens, created_at FROM games WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    return rows.map(r => ({ id: r.id, pgn: r.pgn, fens: JSON.parse(r.fens || '[]'), date: r.created_at }));
  };

  // session: default MemoryStore (ok for dev)
  sessionMiddleware = session({
    name: 'hacker_sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', maxAge: 24 * 3600 * 1000 }
  });

  dbClient = db;
  console.log('Using SQLite DB at', DB_FILE);
}

// initialize DB & session middleware synchronously/async
(async () => {
  if (usePostgres) {
    try {
      await initPostgres();
    } catch (err) {
      console.error('Failed to initialize Postgres:', err);
      process.exit(1);
    }
  } else {
    initSqlite();
  }

  app.use(sessionMiddleware);

  // Helper middleware
  function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.status(401).json({ error: 'not_authenticated' });
  }

  // Basic endpoints
  app.get('/api/status', (req, res) => res.json({ ok: true, mode: usePostgres ? 'postgres' : 'sqlite' }));

  app.get('/api/me', (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'not_authenticated' });
    return res.json({ username: req.session.username });
  });

  app.post('/api/register', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'username_and_password_required' });

      const existing = usePostgres ? await queries.findUserByName(username) : queries.findUserByName(username);
      if (existing) return res.status(409).json({ error: 'username_taken' });

      const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);
      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

      const insertedId = usePostgres ? await queries.insertUser(username, password_hash) : queries.insertUser(username, password_hash);

      // auto-login
      req.session.regenerate(err => {
        if (err) { console.error('session.regenerate', err); return res.status(500).json({ error: 'session_error' }); }
        req.session.userId = insertedId;
        req.session.username = username;
        return res.status(201).json({ username });
      });
    } catch (err) {
      console.error('register error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'username_and_password_required' });

      const user = usePostgres ? await queries.findUserByName(username) : queries.findUserByName(username);
      if (!user) return res.status(401).json({ error: 'invalid_credentials' });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

      req.session.regenerate(err => {
        if (err) { console.error('session.regenerate', err); return res.status(500).json({ error: 'session_error' }); }
        req.session.userId = user.id;
        req.session.username = user.username;
        return res.json({ username: user.username });
      });
    } catch (err) {
      console.error('login error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) { console.error('logout', err); return res.status(500).json({ error: 'logout_failed' }); }
      res.clearCookie('hacker_sid');
      return res.json({ ok: true });
    });
  });

  // import user's games
  app.post('/api/import', requireAuth, async (req, res) => {
    try {
      const payload = req.body || {};
      if (!payload || !Array.isArray(payload.games)) return res.status(400).json({ error: 'invalid_payload' });

      const userId = req.session.userId;
      if (usePostgres) {
        await queries.insertGamesBulk(userId, payload.games);
      } else {
        queries.insertGamesBulk(userId, payload.games);
      }
      return res.json({ imported: payload.games.length });
    } catch (err) {
      console.error('import error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  app.get('/api/games', requireAuth, async (req, res) => {
    try {
      const gs = usePostgres ? await queries.getGamesByUser(req.session.userId) : queries.getGamesByUser(req.session.userId);
      return res.json({ games: gs });
    } catch (err) {
      console.error('games list error', err);
      return res.status(500).json({ error: 'internal' });
    }
  });

  // serve static files if public exists
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use('/', express.static(publicDir));
    console.log('Serving static files from ./public');
  }

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT} mode=${usePostgres ? 'postgres' : 'sqlite'}`);
    if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set — set it in environment for production');
  });
})();
