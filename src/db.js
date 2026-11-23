import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from './security.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  art TEXT NOT NULL DEFAULT 'jersey',
  c1 TEXT NOT NULL DEFAULT '#1E3A2C',
  c2 TEXT NOT NULL DEFAULT '#F2EB3C',
  num TEXT NOT NULL DEFAULT '10',
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  payment_ref TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(payment_ref);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export const SEED_PRODUCTS = [
  ['Fricco Home Jersey 2026', 'Jerseys', 45, 24, 'jersey', '#1E3A2C', '#F2EB3C', '10', 'Breathable match-day knit with a slim cut and heat-pressed number.'],
  ['Fricco Away Jersey 2026', 'Jerseys', 45, 18, 'jersey', '#E9E6D8', '#1B2A22', '7', 'Light-weight away kit with a charcoal collar and contrast trim.'],
  ['Retro 94 Stripe Jersey', 'Jerseys', 52, 9, 'jersey', '#B3402E', '#F6F3E8', '9', 'A throwback colourway with a soft cotton blend and tonal stripes.'],
  ['Court Basketball Jersey', 'Jerseys', 39, 4, 'jersey', '#26407A', '#F2C230', '23', 'Mesh panels for airflow and a roomy armhole for full range.'],
  ['Pro Pool Cue 58 in', 'Pool', 89, 12, 'cue', '#2A1D14', '#F2C230', '10', 'Two-piece maple cue with a 13 mm tip and a leather-wrapped grip.'],
  ['Tournament Ball Set', 'Pool', 62, 15, 'balls', '#2A59B8', '#D33B2F', '10', '16 phenolic resin balls with a polished finish and a cue ball.'],
  ['Scrabble Classic Edition', 'Board Games', 38, 30, 'scrabble', '#2F6B4F', '#EFD9A0', '10', 'The full word game with 100 tiles, 4 racks and a score pad.'],
  ['Scrabble Deluxe Turntable', 'Board Games', 64, 6, 'scrabble', '#7A2F2F', '#EFD9A0', '10', 'A rotating board with raised edges so tiles stay put during play.'],
  ['Dart Board Pro', 'Table Sports', 41, 3, 'darts', '#1F7A45', '#D33B2F', '10', 'Sisal bristle board with a staple-free bullseye and 6 steel darts.'],
  ['Table Tennis Paddle Pair', 'Table Sports', 28, 40, 'paddle', '#D33B2F', '#1B1B1B', '10', 'Two rubber-faced paddles with balls and a carry case.'],
];

export async function openDb(config) {
  fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
  const db = new Database(path.join(config.dataDir, 'fricco.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

  // Phones for orders were added after the first schema; keep older databases working.
  const orderCols = db.prepare("PRAGMA table_info('orders')").all().map((c) => c.name);
  if (!orderCols.includes('phone')) db.exec("ALTER TABLE orders ADD COLUMN phone TEXT NOT NULL DEFAULT ''");

  const now = Date.now();

  if (db.prepare('SELECT COUNT(*) n FROM products').get().n === 0) {
    const insert = db.prepare(
      'INSERT INTO products (name, category, price_cents, stock, art, c1, c2, num, description, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    db.transaction(() => {
      for (const p of SEED_PRODUCTS) insert.run(p[0], p[1], Math.round(p[2] * 100), p[3], p[4], p[5], p[6], p[7], p[8], now);
    })();
  }

  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    const hash = await hashPassword(config.adminPassword);
    db.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES ('Admin', ?, ?, 'admin', ?)").run(
      config.adminEmail,
      hash,
      now
    );
  }

  return db;
}
