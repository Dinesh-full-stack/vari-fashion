import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env('PORT', '3000')),
  isProd: env('NODE_ENV') === 'production',
  siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: env('SESSION_SECRET', 'dev-only-secret'),
  dbFile: env('DB_FILE', path.join(ROOT, 'data', 'store.db')),
  uploadsDir: path.join(ROOT, 'uploads'),
  admin: { email: env('ADMIN_EMAIL', 'admin@example.com'), password: env('ADMIN_PASSWORD', 'admin12345') },
  razorpay: {
    keyId: env('RAZORPAY_KEY_ID'),
    keySecret: env('RAZORPAY_KEY_SECRET'),
    webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
  },
  smtp: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '465')),
    secure: env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : env('SMTP_PORT', '465') === '465', // 465 = TLS from the start; 587 = STARTTLS
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('MAIL_FROM'),
    fromName: env('MAIL_FROM_NAME'),
  },
  shiprocket: {
    email: env('SHIPROCKET_EMAIL'),
    password: env('SHIPROCKET_PASSWORD'),
    pickupLocation: env('SHIPROCKET_PICKUP_LOCATION', 'Primary'),
    webhookToken: env('SHIPROCKET_WEBHOOK_TOKEN'),
  },
};

export const paymentsLive = Boolean(config.razorpay.keyId && config.razorpay.keySecret);
export const shippingLive = Boolean(config.shiprocket.email && config.shiprocket.password);

if (config.isProd && config.sessionSecret === 'dev-only-secret') {
  throw new Error('Set SESSION_SECRET in .env before running in production.');
}
