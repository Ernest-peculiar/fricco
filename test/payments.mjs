// Tests the Stripe and Paystack integrations without internet: provider replies are faked,
// webhooks are signed exactly the way the real services sign them.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';

const realFetch = globalThis.fetch;
const calls = [];
let reply = () => ({});
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com') || u.startsWith('https://api.paystack.co')) {
    calls.push({ url: u, opts });
    const r = reply(u, opts);
    return Promise.resolve(new Response(JSON.stringify(r), { status: r.__status || 200, headers: { 'content-type': 'application/json' } }));
  }
  return realFetch(url, opts);
};

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log('  ok  ', name); }
  catch (e) { console.log('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
};

async function boot(extra) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fricco-pay-'));
  const cfg = { ...config, dataDir, secureCookies: false, baseUrl: 'https://shop.example.com', ...extra };
  const { app, db, close } = await createApp(cfg);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await realFetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  };
  await call('POST', '/api/signup', { name: 'Pay Tester', email: 'pay@example.com', password: 'secret123' });
  const finish = () => { server.close(); close(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { call, db, cfg, finish };
}
const status = (db, code) => db.prepare('SELECT status FROM orders WHERE code = ?').get(code).status;
const stock = (db, id) => db.prepare('SELECT stock FROM products WHERE id = ?').get(id).stock;
const order = { name: 'Pay Tester', address: '5 Test Road, Lagos', items: [{ id: 1, qty: 2 }] };

/* ---------------- Stripe ---------------- */
console.log('Stripe');
{
  const s = await boot({ paymentProvider: 'stripe', stripeSecretKey: 'sk_test_abc', stripeWebhookSecret: 'whsec_test' });
  let code; let total;

  await t('checkout builds the Stripe session from database prices', async () => {
    reply = () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const r = await s.call('POST', '/api/checkout', { ...order, items: [{ id: 1, qty: 2, price: 0.01 }] });
    assert.equal(r.status, 201);
    assert.equal(r.json.redirect, 'https://checkout.stripe.com/c/pay/cs_test_1');
    code = r.json.order.id; total = Math.round(r.json.order.total * 100);
    const c = calls.at(-1);
    assert.equal(c.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(c.opts.headers.Authorization, 'Bearer sk_test_abc');
    const f = new URLSearchParams(c.opts.body);
    assert.equal(f.get('line_items[0][price_data][unit_amount]'), '4500');
    assert.equal(f.get('line_items[0][quantity]'), '2');
    assert.equal(f.get('line_items[0][price_data][currency]'), 'usd');
    assert.equal(f.get('line_items[1][price_data][product_data][name]'), 'Delivery');
    assert.equal(f.get('line_items[1][price_data][unit_amount]'), '600');
    assert.equal(f.get('success_url'), `https://shop.example.com/api/payments/return?code=${code}`);
    assert.equal(f.get('metadata[order_code]'), code);
    assert.equal(status(s.db, code), 'Pending payment');
  });

  await t('simulated card route is closed when Stripe is the provider', async () => {
    const r = await s.call('POST', `/api/orders/${code}/simulate-pay`, { card: '4242424242424242', exp: '12/40', cvc: '123' });
    assert.equal(r.status, 404);
    assert.equal(status(s.db, code), 'Pending payment');
  });

  await t('returning from Stripe unpaid does not mark the order paid', async () => {
    reply = () => ({ payment_status: 'unpaid', amount_total: total });
    const r = await s.call('GET', `/api/payments/return?code=${code}`);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /payment=failed/);
    assert.equal(status(s.db, code), 'Pending payment');
  });

  await t('a paid session with the wrong amount is refused', async () => {
    reply = () => ({ payment_status: 'paid', amount_total: 1 });
    const r = await s.call('GET', `/api/payments/return?code=${code}`);
    assert.match(r.headers.get('location'), /payment=failed/);
    assert.equal(status(s.db, code), 'Pending payment');
  });

  await t('a verified paid session marks the order paid', async () => {
    reply = () => ({ payment_status: 'paid', amount_total: total });
    const r = await s.call('GET', `/api/payments/return?code=${code}`);
    assert.match(r.headers.get('location'), new RegExp(`payment=paid&order=${code}`));
    assert.equal(status(s.db, code), 'Paid');
  });

  const sign = (body, secret = 'whsec_test', t0 = Math.floor(Date.now() / 1000)) =>
    ({ 'stripe-signature': `t=${t0},v1=${crypto.createHmac('sha256', secret).update(`${t0}.${body}`).digest('hex')}`, 'content-type': 'application/json' });
  const event = (c, amount) => JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', amount_total: amount, metadata: { order_code: c } } } });
  let code2; let total2;
  reply = () => ({ id: 'cs_test_2', url: 'https://checkout.stripe.com/c/pay/cs_test_2' });
  { const r = await s.call('POST', '/api/checkout', { ...order, items: [{ id: 2, qty: 1 }] }); code2 = r.json.order.id; total2 = Math.round(r.json.order.total * 100); }

  await t('webhook with a bad signature, old timestamp or wrong secret is rejected', async () => {
    const body = event(code2, total2);
    assert.equal((await s.call('POST', '/api/webhooks/stripe', Buffer.from(body), { 'stripe-signature': 't=1,v1=00', 'content-type': 'application/json' })).status, 400);
    assert.equal((await s.call('POST', '/api/webhooks/stripe', Buffer.from(body), sign(body, 'whsec_test', Math.floor(Date.now() / 1000) - 3600))).status, 400);
    assert.equal((await s.call('POST', '/api/webhooks/stripe', Buffer.from(body), sign(body, 'whsec_other'))).status, 400);
    assert.equal(status(s.db, code2), 'Pending payment');
  });

  await t('a signed webhook for the wrong amount does not pay the order', async () => {
    const body = event(code2, 1);
    assert.equal((await s.call('POST', '/api/webhooks/stripe', Buffer.from(body), sign(body))).status, 200);
    assert.equal(status(s.db, code2), 'Pending payment');
  });

  await t('a correctly signed webhook pays the order, and repeats are harmless', async () => {
    const body = event(code2, total2);
    assert.equal((await s.call('POST', '/api/webhooks/stripe', Buffer.from(body), sign(body))).status, 200);
    assert.equal(status(s.db, code2), 'Paid');
    assert.equal((await s.call('POST', '/api/webhooks/stripe', Buffer.from(body), sign(body))).status, 200);
    assert.equal(status(s.db, code2), 'Paid');
  });

  await t('a webhook for an unconfigured provider is ignored', async () => {
    assert.equal((await s.call('POST', '/api/webhooks/paystack', Buffer.from('{}'), {})).status, 404);
  });

  await t('if Stripe is down the order is cancelled and stock goes back', async () => {
    const before = stock(s.db, 3);
    reply = () => ({ __status: 500, error: 'down' });
    const r = await s.call('POST', '/api/checkout', { ...order, items: [{ id: 3, qty: 2 }] });
    assert.equal(r.status, 502);
    assert.equal(stock(s.db, 3), before);
  });

  await t('a customer can back out of an unpaid order', async () => {
    reply = () => ({ id: 'cs_test_3', url: 'https://checkout.stripe.com/c/pay/cs_test_3' });
    const before = stock(s.db, 4);
    const r = await s.call('POST', '/api/checkout', { ...order, items: [{ id: 4, qty: 2 }] });
    assert.equal(stock(s.db, 4), before - 2);
    await s.call('POST', `/api/orders/${r.json.order.id}/cancel`);
    assert.equal(stock(s.db, 4), before);
    assert.equal(status(s.db, r.json.order.id), 'Cancelled');
  });
  s.finish();
}

/* ---------------- Paystack ---------------- */
console.log('Paystack');
{
  const s = await boot({ paymentProvider: 'paystack', paystackSecretKey: 'sk_test_paystack', currency: 'NGN' });
  let code; let total; let ref;

  await t('checkout initialises a Paystack transaction in the smallest unit', async () => {
    reply = () => ({ status: true, data: { authorization_url: 'https://checkout.paystack.com/abc123' } });
    const r = await s.call('POST', '/api/checkout', order);
    assert.equal(r.status, 201);
    assert.equal(r.json.redirect, 'https://checkout.paystack.com/abc123');
    code = r.json.order.id; total = Math.round(r.json.order.total * 100);
    const c = calls.at(-1);
    assert.equal(c.url, 'https://api.paystack.co/transaction/initialize');
    const b = JSON.parse(c.opts.body);
    assert.equal(b.amount, total);
    assert.equal(b.currency, 'NGN');
    assert.equal(b.email, 'pay@example.com');
    assert.equal(b.callback_url, `https://shop.example.com/api/payments/return?code=${code}`);
    ref = b.reference;
    assert.ok(ref.startsWith(code));
  });

  await t('return verifies with Paystack before marking paid', async () => {
    reply = () => ({ data: { status: 'abandoned', amount: total } });
    assert.match((await s.call('GET', `/api/payments/return?code=${code}`)).headers.get('location'), /payment=failed/);
    reply = () => ({ data: { status: 'success', amount: 100 } });
    assert.match((await s.call('GET', `/api/payments/return?code=${code}`)).headers.get('location'), /payment=failed/);
    assert.equal(status(s.db, code), 'Pending payment');
    reply = () => ({ data: { status: 'success', amount: total } });
    assert.match((await s.call('GET', `/api/payments/return?code=${code}`)).headers.get('location'), /payment=paid/);
    assert.equal(status(s.db, code), 'Paid');
    assert.ok(calls.at(-1).url.endsWith(`/transaction/verify/${encodeURIComponent(ref)}`));
  });

  const body = (c, amount) => JSON.stringify({ event: 'charge.success', data: { status: 'success', reference: 'r', amount, metadata: { order_code: c } } });
  const sig = (b, key = 'sk_test_paystack') => ({ 'x-paystack-signature': crypto.createHmac('sha512', key).update(b).digest('hex'), 'content-type': 'application/json' });
  reply = () => ({ data: { authorization_url: 'https://checkout.paystack.com/def456' } });
  const r2 = await s.call('POST', '/api/checkout', { ...order, items: [{ id: 5, qty: 1 }] });
  const code2 = r2.json.order.id; const total2 = Math.round(r2.json.order.total * 100);

  await t('Paystack webhook needs a valid HMAC signature', async () => {
    const b = body(code2, total2);
    assert.equal((await s.call('POST', '/api/webhooks/paystack', Buffer.from(b), sig(b, 'wrong-key'))).status, 400);
    assert.equal((await s.call('POST', '/api/webhooks/paystack', Buffer.from(b), { 'x-paystack-signature': 'abc' })).status, 400);
    assert.equal(status(s.db, code2), 'Pending payment');
    assert.equal((await s.call('POST', '/api/webhooks/paystack', Buffer.from(b), sig(b))).status, 200);
    assert.equal(status(s.db, code2), 'Paid');
  });
  s.finish();
}

globalThis.fetch = realFetch;
console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
