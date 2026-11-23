import { HttpError, cleanStr, cleanText } from './lib.js';

const MAX_LINES = 30;
const MAX_QTY = 20;

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Your cart is empty.');
  if (items.length > MAX_LINES) throw new HttpError(400, 'That is too many different items in one order.');
  const merged = new Map();
  for (const it of items) {
    const id = it && it.id;
    const qty = it && it.qty;
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new HttpError(400, `Each item needs a quantity from 1 to ${MAX_QTY}.`);
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  return [...merged].map(([id, qty]) => ({ id, qty }));
}

export function shippingFor(subtotalCents, config) {
  if (subtotalCents <= 0) return 0;
  return subtotalCents < Math.round(config.freeShippingOver * 100) ? Math.round(config.shippingFlat * 100) : 0;
}

/**
 * Creates a pending order and reserves its stock in one transaction.
 * Prices always come from the database, never from the browser.
 */
export function createOrder(db, config, user, body) {
  const name = cleanStr(body.name, 1, 80, 'Name');
  const address = cleanStr(body.address, 5, 300, 'Delivery address');
  const phone = cleanText(body.phone, 30);
  const lines = normalizeItems(body.items);

  const tx = db.transaction(() => {
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
    const reserve = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
    let subtotal = 0;
    const rows = [];
    for (const l of lines) {
      const p = getProduct.get(l.id);
      if (!p) throw new HttpError(409, 'An item in your cart is no longer available. Remove it and try again.');
      if (p.stock < l.qty) {
        throw new HttpError(409, p.stock > 0 ? `Only ${p.stock} of ${p.name} left.` : `${p.name} just sold out.`);
      }
      rows.push({ p, qty: l.qty });
      subtotal += p.price_cents * l.qty;
    }
    const shipping = shippingFor(subtotal, config);
    const total = subtotal + shipping;
    const next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM orders').get().n;
    const code = `FC-${1000 + next}`;
    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO orders (code, user_id, customer_name, email, phone, address, subtotal_cents, shipping_cents, total_cents, status, provider, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(code, user.id, name, user.email, phone, address, subtotal, shipping, total, config.paymentProvider === 'none' ? 'Placed' : 'Pending payment', config.paymentProvider, now);
    const addItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, category, price_cents, qty) VALUES (?,?,?,?,?,?)'
    );
    for (const { p, qty } of rows) {
      if (reserve.run(qty, p.id, qty).changes !== 1) throw new HttpError(409, `${p.name} just sold out.`);
      addItem.run(info.lastInsertRowid, p.id, p.name, p.category, p.price_cents, qty);
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  });
  return tx();
}

export function getOrderByCode(db, code) {
  return db.prepare('SELECT * FROM orders WHERE code = ?').get(String(code));
}

export function getItems(db, orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
}

/** Puts reserved stock back and marks the order cancelled. Safe to call twice. */
export function cancelOrder(db, orderId) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || order.status === 'Cancelled') return order;
    const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    for (const item of getItems(db, orderId)) {
      if (item.product_id) restore.run(item.qty, item.product_id);
    }
    db.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(orderId);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  })();
}

/** Marks an order paid. If it had already expired, the stock is taken again. */
export function markPaid(db, orderId) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return null;
    if (order.status === 'Pending payment') {
      db.prepare("UPDATE orders SET status = 'Paid', paid_at = ? WHERE id = ?").run(Date.now(), orderId);
    } else if (order.status === 'Cancelled') {
      const take = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?');
      for (const item of getItems(db, orderId)) {
        if (item.product_id) take.run(item.qty, item.product_id);
      }
      db.prepare("UPDATE orders SET status = 'Paid', paid_at = ? WHERE id = ?").run(Date.now(), orderId);
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  })();
}

/** Cancels orders that were never paid so their stock goes back on sale. */
export function expirePending(db, minutes) {
  const cutoff = Date.now() - minutes * 60_000;
  const stale = db
    .prepare("SELECT id FROM orders WHERE status = 'Pending payment' AND is_sample = 0 AND created_at < ?")
    .all(cutoff);
  for (const o of stale) cancelOrder(db, o.id);
  return stale.length;
}
