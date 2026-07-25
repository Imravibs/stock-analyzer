// ═══════════════════════════════════════════════════════════
// db.js — SQLite database setup & schema
// ═══════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'stockpulse.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema Migrations ───
db.exec(`
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan        TEXT DEFAULT 'free',   -- free | premium
    created_at  INTEGER DEFAULT (strftime('%s', 'now')),
    last_login  INTEGER
  );

  -- Sessions (JWT blacklist for logout)
  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Watchlists
  CREATE TABLE IF NOT EXISTS watchlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    symbol      TEXT NOT NULL,
    added_at    INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(user_id, symbol)
  );

  -- Saved Screens
  CREATE TABLE IF NOT EXISTS screens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    name        TEXT NOT NULL,
    description TEXT,
    query       TEXT NOT NULL,    -- raw DSL string
    columns     TEXT,             -- JSON array of selected columns
    is_public   INTEGER DEFAULT 0,
    fork_of     INTEGER REFERENCES screens(id),
    created_at  INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Screen Alert Subscriptions
  CREATE TABLE IF NOT EXISTS screen_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    screen_id   INTEGER NOT NULL REFERENCES screens(id),
    last_run    INTEGER,
    last_matches TEXT,            -- JSON array of matching symbols from last run
    created_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Portfolio Holdings
  CREATE TABLE IF NOT EXISTS holdings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    symbol      TEXT NOT NULL,
    quantity    REAL NOT NULL,
    avg_price   REAL NOT NULL,
    buy_date    TEXT NOT NULL,    -- YYYY-MM-DD
    notes       TEXT,
    created_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Stock Notebook (private notes per company)
  CREATE TABLE IF NOT EXISTS notebooks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    symbol      TEXT NOT NULL,
    content     TEXT DEFAULT '',
    updated_at  INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(user_id, symbol)
  );

  -- Red Flags (AI-detected anomalies)
  CREATE TABLE IF NOT EXISTS red_flags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    flag_type   TEXT NOT NULL,    -- related_party | auditor_change | margin_spike | promoter_pledge | debtor_days
    severity    TEXT DEFAULT 'medium',  -- low | medium | high | critical
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    ai_summary  TEXT,
    detected_at INTEGER DEFAULT (strftime('%s', 'now')),
    data_period TEXT             -- e.g. "Q2 FY25"
  );

  -- Backtest Results cache
  CREATE TABLE IF NOT EXISTS backtest_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    screen_id   INTEGER REFERENCES screens(id),
    user_id     INTEGER REFERENCES users(id),
    query       TEXT NOT NULL,
    params      TEXT NOT NULL,    -- JSON: { rebalance, startDate, endDate }
    result      TEXT NOT NULL,    -- JSON: { cagr, maxDrawdown, ... }
    computed_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);

// ─── Prepared Statements ───
export const stmts = {
  // Users
  createUser: db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById: db.prepare('SELECT id, email, name, plan, created_at FROM users WHERE id = ?'),
  updateLastLogin: db.prepare('UPDATE users SET last_login = strftime(\'%s\', \'now\') WHERE id = ?'),

  // Watchlist
  addToWatchlist: db.prepare('INSERT OR IGNORE INTO watchlist (user_id, symbol) VALUES (?, ?)'),
  removeFromWatchlist: db.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?'),
  getWatchlist: db.prepare('SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at DESC'),

  // Screens
  saveScreen: db.prepare('INSERT INTO screens (user_id, name, description, query, is_public) VALUES (?, ?, ?, ?, ?)'),
  updateScreen: db.prepare('UPDATE screens SET name = ?, description = ?, query = ?, is_public = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ? AND user_id = ?'),
  deleteScreen: db.prepare('DELETE FROM screens WHERE id = ? AND user_id = ?'),
  getMyScreens: db.prepare('SELECT * FROM screens WHERE user_id = ? ORDER BY updated_at DESC'),
  getPublicScreens: db.prepare('SELECT s.*, u.name as author_name FROM screens s LEFT JOIN users u ON s.user_id = u.id WHERE s.is_public = 1 ORDER BY s.updated_at DESC LIMIT 50'),
  getScreenById: db.prepare('SELECT * FROM screens WHERE id = ?'),
  forkScreen: db.prepare('INSERT INTO screens (user_id, name, description, query, fork_of) VALUES (?, ?, ?, ?, ?)'),

  // Screen Alerts
  subscribeAlert: db.prepare('INSERT OR IGNORE INTO screen_alerts (user_id, screen_id) VALUES (?, ?)'),
  unsubscribeAlert: db.prepare('DELETE FROM screen_alerts WHERE user_id = ? AND screen_id = ?'),
  getAlertSubs: db.prepare('SELECT sa.*, s.query, s.name FROM screen_alerts sa JOIN screens s ON sa.screen_id = s.id'),
  updateAlertRun: db.prepare('UPDATE screen_alerts SET last_run = strftime(\'%s\', \'now\'), last_matches = ? WHERE id = ?'),

  // Notebook
  upsertNote: db.prepare('INSERT INTO notebooks (user_id, symbol, content, updated_at) VALUES (?, ?, ?, strftime(\'%s\', \'now\')) ON CONFLICT(user_id, symbol) DO UPDATE SET content = excluded.content, updated_at = strftime(\'%s\', \'now\')'),
  getNote: db.prepare('SELECT content, updated_at FROM notebooks WHERE user_id = ? AND symbol = ?'),

  // Red Flags
  insertRedFlag: db.prepare('INSERT OR IGNORE INTO red_flags (symbol, flag_type, severity, title, description, ai_summary, data_period) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  getRedFlags: db.prepare('SELECT * FROM red_flags WHERE symbol = ? ORDER BY detected_at DESC LIMIT 10'),
  getAllRedFlags: db.prepare('SELECT * FROM red_flags ORDER BY detected_at DESC LIMIT 100'),

  // Holdings
  addHolding: db.prepare('INSERT INTO holdings (user_id, symbol, quantity, avg_price, buy_date, notes) VALUES (?, ?, ?, ?, ?, ?)'),
  getHoldings: db.prepare('SELECT * FROM holdings WHERE user_id = ? ORDER BY symbol'),
  deleteHolding: db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?'),
  updateHolding: db.prepare('UPDATE holdings SET quantity = ?, avg_price = ?, notes = ? WHERE id = ? AND user_id = ?'),
};

export default db;
