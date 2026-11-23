// Default mode: no payment on the site. Checkout needs a login, then simply places the order.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fricco-nopay-'));
const cfg = { ...config, dataDir, paymentProvider: 'none', secureCookies: false };
const { app, db, close } = await createApp(cfg);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const client = () => {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let json = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  };
};
let passed = 0;
const t = async (n, f) => { try { await f(); passed += 1; console.log('  ok  ', n); } catch (e) { console.log('  FAIL', n, '\n      ', e.message); process.exitCode = 1; } };
const guest = client(); const cust = client(); const admin = client();
const items = [{ id: 1, qty: 2 }];
const addr = { name: 'Chi Test', address: '9 Market Road, Lagos', phone: '0800 000 0000' };

await t('payment is off by default', async () => {
  assert.equal(config.paymentProvider, 'none');
  assert.equal((await guest('GET', '/api/config')).json.payment, 'none');
});
await t('guests still have to log in to order', async () => {
  const r = await guest('POST', '/api/checkout', { ...addr, items });
  assert.equal(r.status, 401); assert.equal(r.json.login, true);
});
await t('a logged-in customer places an order with no payment step', async () => {
  await cust('POST', '/api/signup', { name: 'Chi Test', email: 'chi@example.com', password: 'secret123' });
  const before = db.prepare('SELECT stock FROM products WHERE id = 1').get().stock;
  const r = await cust('POST', '/api/checkout', { ...addr, items });
  assert.equal(r.status, 201);
  assert.equal(r.json.placed, true);
  assert.equal(r.json.order.status, 'Placed');
  assert.equal(r.json.order.total, 96);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, before - 2);
});
await t('there is no card payment route', async () => {
  const code = db.prepare('SELECT code FROM orders').get().code;
  assert.equal((await cust('POST', `/api/orders/${code}/simulate-pay`, { card: '4242424242424242', exp: '12/40', cvc: '123' })).status, 404);
});
await t('placed orders count as sales on the dashboard and stay placed', async () => {
  await admin('POST', '/api/login', { email: cfg.adminEmail, password: cfg.adminPassword });
  const s = (await admin('GET', '/api/admin/summary?tz=0')).json;
  assert.equal(s.revenue, 96); assert.equal(s.orders, 1); assert.equal(s.units, 2);
  await admin('GET', '/api/admin/orders');
  assert.equal(db.prepare('SELECT status FROM orders').get().status, 'Placed');
});
await t('admin can mark it paid, ship it, or cancel it and restore stock', async () => {
  const code = db.prepare('SELECT code FROM orders').get().code;
  assert.equal((await admin('PATCH', `/api/admin/orders/${code}`, { status: 'Paid' })).json.order.status, 'Paid');
  const before = db.prepare('SELECT stock FROM products WHERE id = 1').get().stock;
  await admin('PATCH', `/api/admin/orders/${code}`, { status: 'Cancelled' });
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, before + 2);
  assert.equal((await admin('GET', '/api/admin/summary?tz=0')).json.revenue, 0);
});
server.close(); close(); fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
