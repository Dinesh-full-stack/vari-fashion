import crypto from 'node:crypto';
import { config, paymentsLive } from '../config.js';

const API = 'https://api.razorpay.com/v1';

async function call(method, pathname, body) {
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const res = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || `Razorpay ${method} ${pathname} failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Create a Razorpay order. In test mode returns a fake id so checkout can be exercised without keys. */
export async function createGatewayOrder({ amountPaise, receipt }) {
  if (!paymentsLive) return { id: `mock_order_${crypto.randomUUID().slice(0, 12)}`, mock: true };
  return call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 });
}

/** Checks the signature Razorpay Checkout returns to the browser after a successful payment. */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!paymentsLive) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

/** Captured payment for a gateway order, if any. Used to rescue paid orders whose browser callback never arrived. */
export async function findCapturedPayment(gatewayOrderId) {
  if (!paymentsLive || gatewayOrderId.startsWith('mock_')) return null;
  const data = await call('GET', `/orders/${gatewayOrderId}/payments`);
  return (data.items || []).find((p) => p.status === 'captured') || null;
}

export async function refundPayment(paymentId, amountPaise, notes = {}) {
  if (!paymentsLive || !paymentId || paymentId.startsWith('mock_')) {
    return { id: `mock_rfnd_${crypto.randomUUID().slice(0, 12)}`, mock: true };
  }
  return call('POST', `/payments/${paymentId}/refund`, { amount: amountPaise, notes });
}
