import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, DUMMY_HASH, rateLimit, securityHeaders, sameOrigin } from './security.js';
import {
  HttpError, PAID_STATUSES, ORDER_STATUSES, ART_TYPES, cleanStr, cleanText, cleanInt, cleanMoney, cleanColor,
  publicProduct, publicOrder, randomToken, sha256,
} from './lib.js';
import { createOrder, getOrderByCode, getItems, cancelOrder, markPaid, expirePending } from './orders.js';
import { createProvider, luhn } from './payments.js';

const COOKIE = 'fc_session';
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const PAID_SQL = PAID_STATUSES.map((s) => `'${s}'`).join(',');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function createApp(config) {
  const db = await openDb(config);
  const provider = createProvider(config);
  const app = express();
  if (config.trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(securityHeaders(config));

  const baseUrlOf = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;

  /* ---------- sessions ---------- */
  function startSession(res, userId) {
    const token = randomToken();
    const expires = Date.now() + config.sessionDays * 864e5;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, expires);
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: config.sessionDays * 864e5,
    });
  }
  function loadUser(req) {
    const token = parseCookies(req.get('cookie'))[COOKIE];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
      )
      .get(sha256(token));
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      return null;
    }
    return row;
  }
  app.use((req, res, next) => {
    req.user = loadUser(req);
    next();
  });
  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', login: true });
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', login: true });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
    next();
  };

  /* ---------- webhooks need the raw body, so they come before JSON parsing ---------- */
  app.post('/api/webhooks/:name', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (req.params.name !== provider.name) return res.status(404).end();
    let event = null;
    try {
      event = provider.webhook(req);
    } catch {
      return res.status(400).end();
    }
    if (!event) return res.status(400).end();
    const order = event.code ? getOrderByCode(db, event.code) : null;
    if (order && (event.amount === undefined || event.amount === order.total_cents)) markPaid(db, order.id);
    res.json({ received: true });
  });

  app.use(sameOrigin);
  app.use(express.json({ limit: '3mb' }));

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, key: (req) => `a:${req.ip}` });
  const payLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, key: (req) => `p:${req.user?.id ?? req.ip}` });

  /* ---------- public ---------- */
  app.get('/api/config', (req, res) => {
    res.json({
      siteName: config.siteName,
      currency: config.currency,
      shippingFlat: config.shippingFlat,
      freeShippingOver: config.freeShippingOver,
      payment: config.paymentProvider,
    });
  });

  app.get('/api/products', (req, res) => {
    const rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC').all();
    res.json(rows.map(publicProduct));
  });

  /* ---------- accounts ---------- */
  const userJson = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

  app.post('/api/signup', authLimiter, async (req, res) => {
    const name = cleanStr(req.body.name, 1, 80, 'Your name');
    const email = cleanStr(req.body.email, 3, 120, 'Email').toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Use a password with at least 8 characters.');
    if (password.length > 200) throw new HttpError(400, 'That password is too long.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'An account with that email already exists. Try logging in.');
    }
    const hash = await hashPassword(password);
    const info = db
      .prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?,?,?,'customer',?)")
      .run(name, email, hash, Date.now());
    startSession(res, info.lastInsertRowid);
    res.status(201).json({ user: { id: info.lastInsertRowid, name, email, role: 'customer' } });
  });

  app.post('/api/login', authLimiter, async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) throw new HttpError(400, 'Enter your email and password.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'That email and password do not match.');
    startSession(res, user.id);
    res.json({ user: userJson(user) });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req.get('cookie'))[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const out = { user: userJson(req.user) };
    if (req.user.role === 'admin') {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      out.defaultPassword = await verifyPassword('admin', row.password_hash);
    }
    res.json(out);
  });

  /* ---------- checkout ---------- */
  app.post('/api/checkout', requireUser, payLimiter, async (req, res) => {
    expirePending(db, config.pendingMinutes);
    const order = createOrder(db, config, req.user, req.body);
    const items = getItems(db, order.id);
    try {
      const started = await provider.start(order, items, { baseUrl: baseUrlOf(req) });
      // placed: no payment step, the order is already in
      if (started.ref) db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(started.ref, order.id);
      res.status(201).json({ order: publicOrder(order, items), ...started });
    } catch (err) {
      cancelOrder(db, order.id);
      throw err;
    }
  });

  // Simulated card payment: checks the card details like a form would, charges nothing.
  app.post('/api/orders/:code/simulate-pay', requireUser, payLimiter, (req, res) => {
    if (provider.name !== 'simulated') throw new HttpError(404, 'Not found.');
    const order = getOrderByCode(db, req.params.code);
    if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Order not found.');
    const card = String(req.body.card || '').replace(/\s+/g, '');
    const exp = String(req.body.exp || '').trim();
    const cvc = String(req.body.cvc || '').trim();
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(exp);
    if (!/^\d{12,19}$/.test(card) || !luhn(card)) throw new HttpError(400, 'That card number is not valid. For a test, use 4242 4242 4242 4242.');
    if (!m || new Date(2000 + Number(m[2]), Number(m[1]), 1) <= new Date()) throw new HttpError(400, 'Enter an expiry date in the future as MM/YY.');
    if (!/^\d{3,4}$/.test(cvc)) throw new HttpError(400, 'Enter the 3 or 4 digit CVC.');
    if (order.status !== 'Pending payment' && order.status !== 'Paid') throw new HttpError(409, 'This order can no longer be paid. Please place it again.');
    const paid = markPaid(db, order.id);
    res.json({ order: publicOrder(paid, getItems(db, paid.id)) });
  });

  // Lets a customer back out of a payment they did not finish, so the stock goes back on sale.
  app.post('/api/orders/:code/cancel', requireUser, (req, res) => {
    const order = getOrderByCode(db, req.params.code);
    if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Order not found.');
    if (order.status === 'Pending payment') cancelOrder(db, order.id);
    res.json({ ok: true });
  });

  // Customers land here after Stripe or Paystack. The payment is verified with the provider before anything is marked paid.
  app.get('/api/payments/return', async (req, res) => {
    const code = String(req.query.code || '');
    const order = getOrderByCode(db, code);
    let outcome = 'failed';
    if (order && req.query.cancelled) {
      outcome = 'cancelled';
    } else if (order) {
      if (order.status === 'Paid' || order.status === 'Shipped' || order.status === 'Delivered') outcome = 'paid';
      else {
        try {
          if (await provider.verify(order)) {
            markPaid(db, order.id);
            outcome = 'paid';
          }
        } catch (err) {
          console.error('Payment verify failed', err.message);
        }
      }
    }
    res.redirect(`/?payment=${outcome}&order=${encodeURIComponent(code)}`);
  });

  app.get('/api/my/orders', requireUser, (req, res) => {
    const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
    res.json(rows.map((o) => publicOrder(o, getItems(db, o.id))));
  });

  /* ---------- admin ---------- */
  app.get('/api/admin/summary', requireAdmin, (req, res) => {
    const tz = Number.isInteger(Number(req.query.tz)) ? Number(req.query.tz) : 0;
    const totals = db
      .prepare(`SELECT COALESCE(SUM(total_cents),0) rev, COUNT(*) n, COALESCE(SUM(CASE WHEN is_sample=1 THEN 1 ELSE 0 END),0) samples FROM orders WHERE status IN (${PAID_SQL})`)
      .get();
    const units = db
      .prepare(`SELECT COALESCE(SUM(i.qty),0) u FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN (${PAID_SQL})`)
      .get().u;
    const byCat = db
      .prepare(
        `SELECT i.category c, SUM(i.price_cents * i.qty) r FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN (${PAID_SQL}) GROUP BY i.category ORDER BY r DESC`
      )
      .all();
    const top = db
      .prepare(
        `SELECT i.name n, SUM(i.qty) u, SUM(i.price_cents * i.qty) r FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status IN (${PAID_SQL}) GROUP BY i.name ORDER BY u DESC, r DESC LIMIT 5`
      )
      .all();
    const dayMs = 864e5;
    const today = Math.floor((Date.now() - tz * 60000) / dayMs);
    const days = Array.from({ length: 14 }, (_, k) => {
      const idx = today - 13 + k;
      return { date: new Date(idx * dayMs).toISOString().slice(0, 10), idx, total: 0 };
    });
    const recent = db
      .prepare(`SELECT total_cents, created_at FROM orders WHERE status IN (${PAID_SQL}) AND created_at >= ?`)
      .all(Date.now() - 16 * dayMs);
    for (const o of recent) {
      const d = days.find((x) => x.idx === Math.floor((o.created_at - tz * 60000) / dayMs));
      if (d) d.total += o.total_cents / 100;
    }
    const low = db.prepare('SELECT * FROM products WHERE active = 1 AND stock <= 5 ORDER BY stock, name').all();
    res.json({
      revenue: totals.rev / 100,
      orders: totals.n,
      units,
      sampleOrders: totals.samples,
      pending: db.prepare("SELECT COUNT(*) n FROM orders WHERE status = 'Pending payment'").get().n,
      days: days.map(({ date, total }) => ({ date, total: Math.round(total * 100) / 100 })),
      byCategory: byCat.map((r) => ({ cat: r.c, total: r.r / 100 })),
      top: top.map((r) => ({ name: r.n, units: r.u, total: r.r / 100 })),
      low: low.map(publicProduct),
    });
  });

  app.get('/api/admin/orders', requireAdmin, (req, res) => {
    expirePending(db, config.pendingMinutes);
    const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all();
    res.json(rows.map((o) => publicOrder(o, getItems(db, o.id))));
  });

  app.patch('/api/admin/orders/:code', requireAdmin, (req, res) => {
    const order = getOrderByCode(db, req.params.code);
    if (!order) throw new HttpError(404, 'Order not found.');
    const status = req.body.status;
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'That status is not valid.');
    if (status === 'Cancelled') {
      cancelOrder(db, order.id); // puts the stock back
    } else {
      if (order.status === 'Cancelled') markPaid(db, order.id); // takes the stock again
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    }
    const out = getOrderByCode(db, order.code);
    res.json({ order: publicOrder(out, getItems(db, out.id)) });
  });

  app.post('/api/admin/sample-orders/clear', requireAdmin, (req, res) => {
    const n = db.prepare('DELETE FROM orders WHERE is_sample = 1').run().changes;
    res.json({ removed: n });
  });

  function saveImage(dataUrl) {
    if (dataUrl === undefined || dataUrl === null || dataUrl === '') return null;
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) throw new HttpError(400, 'Photos must be JPG, PNG or WebP.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(400, 'That photo is over 2 MB. Choose a smaller one.');
    const name = `${randomToken(12)}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(config.dataDir, 'uploads', name), buf);
    return `/uploads/${name}`;
  }

  function productFields(body, partial) {
    const f = {};
    const has = (k) => body[k] !== undefined;
    if (!partial || has('name')) f.name = cleanStr(body.name, 1, 100, 'Product name');
    if (!partial || has('cat')) f.category = cleanStr(body.cat, 1, 40, 'Category');
    if (!partial || has('price')) f.price_cents = cleanMoney(body.price, 'Price');
    if (!partial || has('stock')) f.stock = cleanInt(body.stock, 0, 100000, 'Stock');
    if (!partial || has('desc')) f.description = cleanText(body.desc, 400);
    if (!partial || has('art')) {
      const art = body.art === undefined ? 'jersey' : body.art;
      if (!ART_TYPES.includes(art)) throw new HttpError(400, 'Choose one of the listed illustrations.');
      f.art = art;
    }
    if (!partial || has('c1')) f.c1 = cleanColor(body.c1, '#1E3A2C');
    if (!partial || has('c2')) f.c2 = cleanColor(body.c2, '#F2EB3C');
    if (!partial || has('num')) f.num = cleanText(body.num, 3) || '10';
    return f;
  }

  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const f = productFields(req.body, false);
    f.image = saveImage(req.body.image);
    const info = db
      .prepare(
        `INSERT INTO products (name, category, price_cents, stock, art, c1, c2, num, description, image, created_at)
         VALUES (@name,@category,@price_cents,@stock,@art,@c1,@c2,@num,@description,@image,@created_at)`
      )
      .run({ ...f, created_at: Date.now() });
    res.status(201).json({ product: publicProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid)) });
  });

  app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
    if (!existing) throw new HttpError(404, 'Product not found.');
    const f = productFields(req.body, true);
    if (req.body.image !== undefined) f.image = saveImage(req.body.image);
    const keys = Object.keys(f);
    if (keys.length) {
      db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...f, id });
    }
    res.json({ product: publicProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id)) });
  });

  // Products that appear in past orders are hidden, not erased, so order history stays intact.
  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    const info = db.prepare('UPDATE products SET active = 0 WHERE id = ? AND active = 1').run(Number(req.params.id));
    if (!info.changes) throw new HttpError(404, 'Product not found.');
    res.json({ ok: true });
  });

  app.post('/api/admin/password', requireAdmin, authLimiter, async (req, res) => {
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const next = typeof req.body.next === 'string' ? req.body.next : '';
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'Your current password is not correct.');
    if (next.length < 8) throw new HttpError(400, 'Use a new password with at least 8 characters.');
    if (next.length > 200) throw new HttpError(400, 'That password is too long.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
    const keep = sha256(parseCookies(req.get('cookie'))[COOKIE]);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, keep);
    res.json({ ok: true });
  });

  /* ---------- files ---------- */
  app.use(
    '/uploads',
    express.static(path.join(config.dataDir, 'uploads'), {
      maxAge: '7d', index: false, dotfiles: 'deny',
      setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; sandbox"),
    })
  );
  app.use(express.static(config.publicDir, { maxAge: 0, index: 'index.html' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request could not be read.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  const timers = [
    setInterval(() => expirePending(db, config.pendingMinutes), 10 * 60_000),
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 60 * 60_000),
  ];
  timers.forEach((t) => t.unref());

  return { app, db, close: () => { timers.forEach(clearInterval); db.close(); } };
}
