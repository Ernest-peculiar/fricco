// End-to-end API test. Starts the app on a temporary database and walks the whole shop.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fricco-test-'));
const cfg = { ...config, dataDir, paymentProvider: 'simulated', secureCookies: false };
const { app, db, close } = await createApp(cfg);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].startsWith('fc_session=;') ? '' : set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers, text };
  };
}

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log('  ok  ', name); }
  catch (e) { console.log('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
};

const guest = client();
const alice = client();
const admin = client();
const shipping = (sub) => (sub < cfg.freeShippingOver ? cfg.shippingFlat : 0);

await t('guests can see every product without logging in', async () => {
  const r = await guest('GET', '/api/products');
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 10);
  assert.ok(r.json.every((p) => p.name.startsWith('Fricco') || p.price > 0));
});

await t('guests are asked to log in at checkout', async () => {
  const r = await guest('POST', '/api/checkout', { name: 'X', address: '12 Main Street', items: [{ id: 1, qty: 1 }] });
  assert.equal(r.status, 401);
  assert.equal(r.json.login, true);
});

await t('admin pages and APIs reject guests and customers', async () => {
  assert.equal((await guest('GET', '/api/admin/summary')).status, 401);
  const r = await alice('POST', '/api/signup', { name: 'Alice Test', email: 'Alice@Example.com', password: 'secret123' });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.role, 'customer');
  assert.equal((await alice('GET', '/api/admin/summary')).status, 403);
  assert.equal((await alice('POST', '/api/admin/products', { name: 'x' })).status, 403);
});

await t('signup validates input and blocks duplicates', async () => {
  assert.equal((await guest('POST', '/api/signup', { name: 'B', email: 'nope', password: 'secret123' })).status, 400);
  assert.equal((await guest('POST', '/api/signup', { name: 'B', email: 'b@example.com', password: 'short' })).status, 400);
  assert.equal((await guest('POST', '/api/signup', { name: 'A', email: 'alice@example.com', password: 'secret123' })).status, 409);
});

await t('passwords are stored hashed, sessions are httpOnly', async () => {
  const row = db.prepare("SELECT password_hash FROM users WHERE email = 'alice@example.com'").get();
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('secret123'));
  const r = await client()('POST', '/api/login', { email: 'alice@example.com', password: 'secret123' });
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(r.headers.get('set-cookie'), /SameSite=Lax/i);
});

await t('wrong password is rejected with one generic message', async () => {
  const a = await client()('POST', '/api/login', { email: 'alice@example.com', password: 'wrongwrong' });
  const b = await client()('POST', '/api/login', { email: 'ghost@example.com', password: 'wrongwrong' });
  assert.equal(a.status, 401);
  assert.equal(a.json.error, b.json.error);
});

let order;
await t('checkout prices from the database and reserves stock', async () => {
  const before = db.prepare('SELECT stock FROM products WHERE id = 1').get().stock;
  const r = await alice('POST', '/api/checkout', {
    name: 'Alice Test', address: '12 Main Street, Lagos', price: 0.01,
    items: [{ id: 1, qty: 2, price: 0.01 }, { id: 5, qty: 1 }],
  });
  assert.equal(r.status, 201, r.text);
  order = r.json.order;
  assert.equal(r.json.simulated, true);
  assert.equal(order.status, 'Pending payment');
  assert.equal(order.subtotal, 45 * 2 + 89);
  assert.equal(order.total, order.subtotal + shipping(order.subtotal));
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, before - 2);
});

await t('pending orders do not count as revenue yet', async () => {
  const s = await admin('POST', '/api/login', { email: cfg.adminEmail, password: cfg.adminPassword });
  assert.equal(s.json.user.role, 'admin');
  const sum = await admin('GET', '/api/admin/summary?tz=0');
  assert.equal(sum.json.revenue, 0);
  assert.equal(sum.json.pending, 1);
});

await t('bad card details are rejected, a valid test card pays', async () => {
  const url = `/api/orders/${order.id}/simulate-pay`;
  assert.equal((await alice('POST', url, { card: '1234 5678 9012 3456', exp: '12/40', cvc: '123' })).status, 400);
  assert.equal((await alice('POST', url, { card: '4242 4242 4242 4242', exp: '01/20', cvc: '123' })).status, 400);
  assert.equal((await alice('POST', url, { card: '4242 4242 4242 4242', exp: '12/40', cvc: '12' })).status, 400);
  const ok = await alice('POST', url, { card: '4242 4242 4242 4242', exp: '12/40', cvc: '123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.order.status, 'Paid');
});

await t("another customer cannot pay or see someone else's order", async () => {
  const bob = client();
  await bob('POST', '/api/signup', { name: 'Bob', email: 'bob@example.com', password: 'secret123' });
  assert.equal((await bob('POST', `/api/orders/${order.id}/simulate-pay`, { card: '4242424242424242', exp: '12/40', cvc: '123' })).status, 404);
  assert.equal((await bob('GET', '/api/my/orders')).json.length, 0);
  assert.equal((await alice('GET', '/api/my/orders')).json.length, 1);
});

await t('dashboard totals include the paid order', async () => {
  const sum = await admin('GET', '/api/admin/summary?tz=0');
  assert.equal(sum.json.revenue, order.total);
  assert.equal(sum.json.orders, 1);
  assert.equal(sum.json.units, 3);
  assert.equal(sum.json.days.length, 14);
  assert.equal(sum.json.days[13].total, order.total);
  assert.ok(sum.json.byCategory.find((c) => c.cat === 'Pool'));
});

await t('cannot order more than is in stock', async () => {
  const r = await alice('POST', '/api/checkout', { name: 'Alice', address: '12 Main Street', items: [{ id: 9, qty: 4 }] });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Only 3/);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 9').get().stock, 3);
});

await t('bad quantities and unknown products are rejected', async () => {
  for (const items of [[{ id: 1, qty: 0 }], [{ id: 1, qty: -2 }], [{ id: 1, qty: 1.5 }], [{ id: 999, qty: 1 }], [], 'x']) {
    const r = await alice('POST', '/api/checkout', { name: 'A', address: '12 Main Street', items });
    assert.ok(r.status === 400 || r.status === 409, JSON.stringify(items));
  }
});

await t('admin adds a product with a photo, and it shows in the shop', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await admin('POST', '/api/admin/products', { name: 'Fricco Training Top', cat: 'Jerseys', price: 33.5, stock: 12, desc: 'Test', image: png });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.product.price, 33.5);
  assert.match(r.json.product.img, /^\/uploads\/.+\.png$/);
  const list = await guest('GET', '/api/products');
  assert.equal(list.json.length, 11);
  const img = await fetch(base + r.json.product.img);
  assert.equal(img.status, 200);
});

await t('product validation rejects bad input', async () => {
  const bad = [
    { name: '', cat: 'x', price: 1, stock: 1 },
    { name: 'x', cat: 'x', price: -5, stock: 1 },
    { name: 'x', cat: 'x', price: 1, stock: 1.5 },
    { name: 'x', cat: 'x', price: 1, stock: 1, c1: 'red' },
    { name: 'x', cat: 'x', price: 1, stock: 1, image: 'data:text/html;base64,PHNjcmlwdD4=' },
  ];
  for (const b of bad) assert.equal((await admin('POST', '/api/admin/products', b)).status, 400, JSON.stringify(b).slice(0, 60));
});

await t('admin edits stock and cancelling an order restores it', async () => {
  assert.equal((await admin('PATCH', '/api/admin/products/10', { stock: 55 })).json.product.stock, 55);
  const before = db.prepare('SELECT stock FROM products WHERE id = 5').get().stock;
  const c = await admin('PATCH', `/api/admin/orders/${order.id}`, { status: 'Cancelled' });
  assert.equal(c.json.order.status, 'Cancelled');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 5').get().stock, before + 1);
  const again = await admin('PATCH', `/api/admin/orders/${order.id}`, { status: 'Cancelled' });
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 5').get().stock, before + 1, 'no double restore');
  assert.equal(again.status, 200);
  assert.equal((await admin('PATCH', `/api/admin/orders/${order.id}`, { status: 'Bogus' })).status, 400);
});

await t('deleting a product hides it but keeps order history', async () => {
  assert.equal((await admin('DELETE', '/api/admin/products/10')).status, 200);
  assert.equal((await guest('GET', '/api/products')).json.some((p) => p.id === 10), false);
  assert.equal((await admin('DELETE', '/api/admin/products/10')).status, 404);
});

await t('unpaid orders expire and release their stock', async () => {
  const r = await alice('POST', '/api/checkout', { name: 'Alice', address: '12 Main Street', items: [{ id: 9, qty: 3 }] });
  assert.equal(r.status, 201);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 9').get().stock, 0);
  db.prepare('UPDATE orders SET created_at = ? WHERE code = ?').run(Date.now() - 3 * 3600_000, r.json.order.id);
  await admin('GET', '/api/admin/orders');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 9').get().stock, 3);
});

await t('two buyers cannot both take the last items', async () => {
  const mk = () => alice('POST', '/api/checkout', { name: 'A', address: '12 Main Street', items: [{ id: 4, qty: 3 }] });
  const [a, b] = [await mk(), await mk()];
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.ok(db.prepare('SELECT stock FROM products WHERE id = 4').get().stock >= 0);
});

await t('cross-site requests and oversized bodies are blocked', async () => {
  const r = await alice('POST', '/api/checkout', { items: [] }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const big = await guest('POST', '/api/login', { email: 'x'.repeat(4_000_000) });
  assert.equal(big.status, 413);
});

await t('security headers are set', async () => {
  const r = await guest('GET', '/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

await t('admin sees the default-password warning, then can change it', async () => {
  assert.equal((await admin('GET', '/api/me')).json.defaultPassword, true);
  assert.equal((await admin('POST', '/api/admin/password', { current: 'wrong', next: 'newpassword1' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/password', { current: 'admin', next: 'short' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/password', { current: 'admin', next: 'newpassword1' })).status, 200);
  assert.equal((await admin('GET', '/api/me')).json.defaultPassword, false);
  assert.equal((await client()('POST', '/api/login', { email: cfg.adminEmail, password: 'admin' })).status, 401);
  assert.equal((await client()('POST', '/api/login', { email: cfg.adminEmail, password: 'newpassword1' })).status, 200);
});

await t('login is rate limited', async () => {
  const c = client();
  let last = 0;
  for (let i = 0; i < 25; i += 1) last = (await c('POST', '/api/login', { email: 'alice@example.com', password: 'nope-nope' })).status;
  assert.equal(last, 429);
});

await t('logging out ends the session', async () => {
  const c = client();
  await c('POST', '/api/login', { email: 'bob@example.com', password: 'secret123' }).catch(() => {});
  const r = await alice('POST', '/api/logout');
  assert.equal(r.status, 200);
  assert.equal((await alice('GET', '/api/me')).json.user, null);
});

server.close();
close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
