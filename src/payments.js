import crypto from 'node:crypto';
import { HttpError, randomToken } from './lib.js';

/**
 * Each provider has the same three jobs:
 *   start(order, items, ctx)   -> { redirect } or { simulated: true }
 *   verify(order)              -> true when the money has really arrived
 *   webhook(req)               -> { code, ref } for a confirmed payment, or null
 */

async function api(url, options) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, 'The payment provider could not be reached. Please try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Payment provider error', res.status, JSON.stringify(data).slice(0, 300));
    throw new HttpError(502, 'The payment provider rejected the request. Please try again.');
  }
  return data;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const simulated = {
  name: 'simulated',
  async start() {
    return { simulated: true };
  },
  async verify() {
    return false; // simulated orders are marked paid by the simulate-pay route only
  },
  webhook() {
    return null;
  },
};

function stripeProvider(config) {
  const base = 'https://api.stripe.com/v1';
  const headers = { Authorization: `Bearer ${config.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  return {
    name: 'stripe',
    async start(order, items, ctx) {
      const form = new URLSearchParams();
      form.set('mode', 'payment');
      form.set('success_url', `${ctx.baseUrl}/api/payments/return?code=${order.code}`);
      form.set('cancel_url', `${ctx.baseUrl}/api/payments/return?code=${order.code}&cancelled=1`);
      form.set('client_reference_id', order.code);
      form.set('customer_email', order.email);
      form.set('metadata[order_code]', order.code);
      let i = 0;
      const line = (name, cents, qty) => {
        form.set(`line_items[${i}][price_data][currency]`, config.currency.toLowerCase());
        form.set(`line_items[${i}][price_data][product_data][name]`, name);
        form.set(`line_items[${i}][price_data][unit_amount]`, String(cents));
        form.set(`line_items[${i}][quantity]`, String(qty));
        i += 1;
      };
      for (const it of items) line(it.name, it.price_cents, it.qty);
      if (order.shipping_cents > 0) line('Delivery', order.shipping_cents, 1);
      const session = await api(`${base}/checkout/sessions`, { method: 'POST', headers, body: form });
      return { redirect: session.url, ref: session.id };
    },
    async verify(order) {
      if (!order.payment_ref) return false;
      const s = await api(`${base}/checkout/sessions/${encodeURIComponent(order.payment_ref)}`, { headers });
      return s.payment_status === 'paid' && s.amount_total === order.total_cents;
    },
    webhook(req) {
      const raw = req.body;
      const header = req.get('stripe-signature') || '';
      const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
      const t = Number(parts.t);
      if (!config.stripeWebhookSecret || !t || Math.abs(Date.now() / 1000 - t) > 300) return null;
      const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
      if (!safeEqual(expected, parts.v1 || '')) return null;
      const event = JSON.parse(raw.toString('utf8'));
      const obj = event?.data?.object;
      if (event.type === 'checkout.session.completed' && obj?.payment_status === 'paid') {
        return { code: obj.metadata?.order_code || obj.client_reference_id, ref: obj.id, amount: obj.amount_total };
      }
      return null;
    },
  };
}

function paystackProvider(config) {
  const base = 'https://api.paystack.co';
  const headers = { Authorization: `Bearer ${config.paystackSecretKey}`, 'Content-Type': 'application/json' };
  return {
    name: 'paystack',
    async start(order, items, ctx) {
      const reference = `${order.code}-${randomToken(6)}`;
      const data = await api(`${base}/transaction/initialize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: order.email,
          amount: order.total_cents,
          currency: config.currency,
          reference,
          callback_url: `${ctx.baseUrl}/api/payments/return?code=${order.code}`,
          metadata: { order_code: order.code },
        }),
      });
      return { redirect: data.data.authorization_url, ref: reference };
    },
    async verify(order) {
      if (!order.payment_ref) return false;
      const r = await api(`${base}/transaction/verify/${encodeURIComponent(order.payment_ref)}`, { headers });
      return r.data?.status === 'success' && r.data.amount === order.total_cents;
    },
    webhook(req) {
      const raw = req.body;
      const sig = req.get('x-paystack-signature') || '';
      const expected = crypto.createHmac('sha512', config.paystackSecretKey).update(raw).digest('hex');
      if (!safeEqual(expected, sig)) return null;
      const event = JSON.parse(raw.toString('utf8'));
      if (event.event === 'charge.success' && event.data?.status === 'success') {
        return { code: event.data.metadata?.order_code, ref: event.data.reference, amount: event.data.amount };
      }
      return null;
    },
  };
}

const none = { name: 'none', async start() { return { placed: true }; }, async verify() { return false; }, webhook() { return null; } };

export function createProvider(config) {
  if (config.paymentProvider === 'none') return none;
  if (config.paymentProvider === 'stripe') return stripeProvider(config);
  if (config.paymentProvider === 'paystack') return paystackProvider(config);
  return simulated;
}

/** Luhn check, used for the simulated card form so typos are still caught. */
export function luhn(number) {
  let sum = 0;
  let alt = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let n = Number(number[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
