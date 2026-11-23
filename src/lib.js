import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Orders that count as sales. 'Placed' is an order made without paying on the site.
export const PAID_STATUSES = ['Placed', 'Paid', 'Shipped', 'Delivered'];
export const ORDER_STATUSES = ['Pending payment', 'Placed', 'Paid', 'Shipped', 'Delivered', 'Cancelled'];

export function cleanStr(value, min, max, label) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} is required.`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length < min) throw new HttpError(400, `${label} is required.`);
  if (v.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return v;
}

export function cleanText(value, max) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new HttpError(400, 'That value is not valid.');
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `Text must be ${max} characters or fewer.`);
  return v;
}

export function cleanInt(value, min, max, label) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

export function cleanMoney(value, label) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10_000_000) {
    throw new HttpError(400, `${label} must be a positive amount.`);
  }
  return Math.round(n * 100);
}

export function cleanColor(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new HttpError(400, 'Colours must look like #1E3A2C.');
  }
  return value.toUpperCase();
}

export const ART_TYPES = ['jersey', 'cue', 'balls', 'scrabble', 'darts', 'paddle'];

export function publicProduct(p) {
  return {
    id: p.id,
    name: p.name,
    cat: p.category,
    price: p.price_cents / 100,
    stock: p.stock,
    art: p.art,
    c1: p.c1,
    c2: p.c2,
    num: p.num,
    desc: p.description,
    img: p.image || '',
  };
}

export function publicOrder(order, items) {
  return {
    id: order.code,
    date: order.created_at,
    customer: order.customer_name,
    email: order.email,
    phone: order.phone || '',
    address: order.address,
    subtotal: order.subtotal_cents / 100,
    shipping: order.shipping_cents / 100,
    total: order.total_cents / 100,
    status: order.status,
    sample: !!order.is_sample,
    items: items.map((i) => ({
      id: i.product_id,
      name: i.name,
      cat: i.category,
      price: i.price_cents / 100,
      qty: i.qty,
    })),
  };
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
