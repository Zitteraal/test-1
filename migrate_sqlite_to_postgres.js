// migrate_sqlite_to_postgres.js
// Usage:
//   export DATABASE_URL="postgres://user:pass@host:5432/dbname"
//   node migrate_sqlite_to_postgres.js
//
// Optional dry-run:
//   node migrate_sqlite_to_postgres.js --dry
//
// Requirements:
//   npm i pg better-sqlite3

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

const SQLITE_PATH = process.env.SQLITE_FILE || path.join(__dirname, 'hackerChess.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry') || process.env.DRY_RUN === '1';

if (!DATABASE_URL) {
  console.error('ERROR: Please set DATABASE_URL environment variable to your Postgres connection string.');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error('ERROR: SQLite file not found at', SQLITE_PATH);
  process.exit(1);
}

(async function main() {
  try {
    // Create backup
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `hackerChess.db.bak.${ts}`);
    fs.copyFileSync(SQLITE_PATH, backupPath);
    console.log(`Backup created: ${backupPath}`);

    // Open SQLite
    const sqlite = new Database(SQLITE_PATH, { readonly: true });
    console.log('Opened SQLite DB:', SQLITE_PATH);

    // Read users and games from sqlite (handle missing tables gracefully)
    const sqliteUsers = sqlite.prepare(`
      SELECT id, username, password_hash, created_at
      FROM users
    `).all ? sqlite.prepare('SELECT id, username, password_hash, created_at FROM users').all() : [];
    const sqliteGames = sqlite.prepare(`
      SELECT id, user_id, pgn, fens, created_at
      FROM games
    `).all ? sqlite.prepare('SELECT id, user_id, pgn, fens, created_at FROM games').all() : [];

    console.log(`Found ${sqliteUsers.length} users and ${sqliteGames.length} games in SQLite.`);

    if (DRY_RUN) {
      console.log('Dry-run mode: no writes to Postgres will be performed.');
    }

    // Connect Postgres
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
    const client = await pool.connect();
    try {
      // Ensure tables exist in Postgres
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS games (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pgn TEXT,
          fens TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Build map sqliteUserId -> pgUserId
      const userMap = new Map();
      let insertedUsers = 0;
      await client.query('BEGIN');
      try {
        for (const u of sqliteUsers) {
          const username = u.username;
          // Check existing in Postgres
          const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);
          if (existing.rows.length > 0) {
            userMap.set(u.id, existing.rows[0].id);
            continue;
          }
          if (DRY_RUN) {
            console.log(`[DRY] Would insert user: ${username}`);
            continue;
          }
          const res = await client.query(
            'INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3) RETURNING id',
            [username, u.password_hash || '', u.created_at || new Date().toISOString()]
          );
          const newId = res.rows[0].id;
          userMap.set(u.id, newId);
          insertedUsers++;
        }

        // Insert games
        let insertedGames = 0;
        for (const g of sqliteGames) {
          const oldUid = g.user_id;
          const pgUid = userMap.get(oldUid);
          if (!pgUid) {
            console.warn(`Skipping game id=${g.id} because user_id ${oldUid} not migrated/found.`);
            continue;
          }
          // Normalize fens field: ensure valid JSON string
          let fensStr = '';
          if (g.fens == null) fensStr = '[]';
          else if (typeof g.fens === 'string') {
            try { JSON.parse(g.fens); fensStr = g.fens; } catch (e) { /* not JSON */ fensStr = JSON.stringify([g.fens]); }
          } else {
            // stored as object/array
            fensStr = JSON.stringify(g.fens);
          }

          if (DRY_RUN) {
            console.log(`[DRY] Would insert game for pgUser ${pgUid}: pgn length ${ (g.pgn || '').length }`);
            insertedGames++;
            continue;
          }

          await client.query(
            'INSERT INTO games (user_id, pgn, fens, created_at) VALUES ($1, $2, $3, $4)',
            [pgUid, g.pgn || '', fensStr, g.created_at || new Date().toISOString()]
          );
          insertedGames++;
        }

        if (!DRY_RUN) {
          await client.query('COMMIT');
          console.log(`Migration complete: ${insertedUsers} users, ${insertedGames} games inserted into Postgres.`);
        } else {
          await client.query('ROLLBACK');
          console.log(`Dry-run complete: would have inserted ${insertedUsers} users and ${insertedGames} games.`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      client.release();
      await pool.end();
    }

    sqlite.close();
    console.log('SQLite closed. Backup retained at', backupPath);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(2);
  }
})();
