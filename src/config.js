import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

function num(value, fallback) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export const config = {
  siteName: 'Fricco Collection',
  port: num(env.PORT, 3000),
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
  publicDir: path.join(root, 'public'),

  // Public address of the site, for example https://fricco.example.com.
  // Payment providers send customers back here. When empty, the address of the request is used.
  baseUrl: (env.BASE_URL || '').replace(/\/+$/, ''),

  // Prices are stored in the smallest unit (cents, kobo). Set CURRENCY to your currency code.
  currency: (env.CURRENCY || 'USD').toUpperCase(),
  shippingFlat: num(env.SHIPPING_FLAT, 6),
  freeShippingOver: num(env.FREE_SHIPPING_OVER, 100),

  // none (orders are placed without paying on the site), simulated (test card form), stripe or paystack
  paymentProvider: (env.PAYMENT_PROVIDER || 'none').toLowerCase(),
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  paystackSecretKey: env.PAYSTACK_SECRET_KEY || '',

  // The admin account is created on first start. Change the password in the dashboard (Security tab).
  adminEmail: (env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'admin',

  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY === 'true',
  sessionDays: 14,
  pendingMinutes: 120,
};

export function validateConfig(c = config) {
  const providers = ['none', 'simulated', 'stripe', 'paystack'];
  if (!providers.includes(c.paymentProvider)) {
    throw new Error(`PAYMENT_PROVIDER must be one of: ${providers.join(', ')}`);
  }
  if (c.paymentProvider === 'stripe' && !c.stripeSecretKey) {
    throw new Error('PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY');
  }
  if (c.paymentProvider === 'paystack' && !c.paystackSecretKey) {
    throw new Error('PAYMENT_PROVIDER=paystack needs PAYSTACK_SECRET_KEY');
  }
  if (!/^[A-Z]{3}$/.test(c.currency)) {
    throw new Error('CURRENCY must be a 3 letter code such as USD or NGN');
  }
}
