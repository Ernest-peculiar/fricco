// Adds 46 sample orders (marked as samples) so the dashboard has something to show.
// Run with: npm run demo. Remove them any time from the dashboard.
import { config } from './config.js';
import { openDb } from './db.js';

const db = await openDb(config);
if (db.prepare('SELECT COUNT(*) n FROM orders WHERE is_sample = 1').get().n > 0) {
  console.log('Sample orders are already there.');
  process.exit(0);
}

let s = 7;
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const names = ['Amaka O.', 'Tunde B.', 'Chidi E.', 'Sade A.', 'Ife W.', 'Musa K.', 'Zainab L.', 'Kelechi N.', 'Bola F.', 'Dayo R.', 'Ngozi P.', 'Emeka T.'];
const products = db.prepare('SELECT * FROM products WHERE active = 1').all();
const insOrder = db.prepare(
  `INSERT INTO orders (code, customer_name, email, phone, address, subtotal_cents, shipping_cents, total_cents, status, provider, is_sample, created_at, paid_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`
);
const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, category, price_cents, qty) VALUES (?,?,?,?,?,?)');
const base = db.prepare('SELECT COALESCE(MAX(id),0) n FROM orders').get().n;

db.transaction(() => {
  for (let i = 0; i < 46; i += 1) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ p: products[Math.floor(rnd() * products.length)], q: 1 + Math.floor(rnd() * 2) }));
    const sub = lines.reduce((a, l) => a + l.p.price_cents * l.q, 0);
    const ship = sub < Math.round(config.freeShippingOver * 100) ? Math.round(config.shippingFlat * 100) : 0;
    const age = Math.floor(rnd() * 14);
    const when = Date.now() - age * 864e5 - Math.floor(rnd() * 600) * 6e4;
    const r = rnd();
    const status = age > 8 ? (r < 0.1 ? 'Cancelled' : 'Delivered') : age > 3 ? (r < 0.6 ? 'Delivered' : 'Shipped') : r < 0.5 ? 'Paid' : 'Shipped';
    const nm = names[Math.floor(rnd() * names.length)];
    const info = insOrder.run(`FC-${1001 + base + i}`, nm, `${nm.split(' ')[0].toLowerCase()}@example.com`, '', '12 Sample Street', sub, ship, sub + ship, status, 'simulated', when, when);
    for (const l of lines) insItem.run(info.lastInsertRowid, l.p.id, l.p.name, l.p.category, l.p.price_cents, l.q);
  }
})();
console.log('Added 46 sample orders.');
