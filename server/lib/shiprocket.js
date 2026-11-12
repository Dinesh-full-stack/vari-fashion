import crypto from 'node:crypto';
import { config, shippingLive } from '../config.js';

const API = 'https://apiv2.shiprocket.in/v1/external';
let token = null;
let tokenExpires = 0;

async function getToken() {
  if (token && Date.now() < tokenExpires) return token;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.shiprocket.email, password: config.shiprocket.password }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw Object.assign(new Error('Shiprocket login failed'), { status: 502 });
  token = data.token;
  tokenExpires = Date.now() + 8 * 24 * 3600 * 1000; // tokens last 10 days; refresh early
  return token;
}

async function call(method, pathname, body) {
  const res = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `Shiprocket ${method} ${pathname} failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data;
}

/** Push an order to Shiprocket and assign a courier. Returns ids and the AWB (tracking number). */
export async function createShipment(order, items) {
  if (!shippingLive) {
    return {
      shiprocketOrderId: `mock_${order.number}`,
      shipmentId: `mock_${crypto.randomUUID().slice(0, 8)}`,
      awb: `TEST${Math.floor(1e9 + Math.random() * 9e9)}`,
      courier: 'Test Courier',
      mock: true,
    };
  }
  const [first, ...rest] = order.customer_name.trim().split(/\s+/);
  const weightKg = Math.max(0.1, items.reduce((s, i) => s + (i.weight_grams || 400) * i.qty, 0) / 1000);
  const created = await call('POST', '/orders/create/adhoc', {
    order_id: order.number,
    order_date: order.created_at.slice(0, 16).replace('T', ' '),
    pickup_location: config.shiprocket.pickupLocation,
    billing_customer_name: first,
    billing_last_name: rest.join(' ') || '.',
    billing_address: order.address_line1,
    billing_address_2: order.address_line2,
    billing_city: order.city,
    billing_pincode: order.pincode,
    billing_state: order.state,
    billing_country: 'India',
    billing_email: order.email,
    billing_phone: order.phone,
    shipping_is_billing: true,
    order_items: items.map((i) => ({
      name: `${i.product_name} (${i.color}/${i.size})`,
      sku: i.sku,
      units: i.qty,
      selling_price: i.unit_price_paise / 100,
      hsn: i.hsn,
    })),
    payment_method: order.payment_method === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges: order.shipping_paise / 100,
    sub_total: order.total_paise / 100,
    length: 30, breadth: 25, height: 5, weight: weightKg,
  });
  const awb = await call('POST', '/courier/assign/awb', { shipment_id: created.shipment_id });
  const data = awb?.response?.data || {};
  try { await call('POST', '/courier/generate/pickup', { shipment_id: [created.shipment_id] }); } catch { /* pickup can be scheduled from the Shiprocket panel */ }
  return {
    shiprocketOrderId: String(created.order_id),
    shipmentId: String(created.shipment_id),
    awb: data.awb_code || '',
    courier: data.courier_name || '',
  };
}

/** Live tracking scans for an AWB. Returns [] in test mode or on failure. */
export async function trackAwb(awb) {
  if (!shippingLive || !awb || awb.startsWith('TEST')) return [];
  try {
    const data = await call('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
    const acts = data?.tracking_data?.shipment_track_activities || [];
    return acts.map((a) => ({ at: a.date, status: a.activity || a['sr-status-label'] || '', location: a.location || '' }));
  } catch {
    return [];
  }
}

/** Map Shiprocket's status text to our order status, or null if it isn't one we act on. */
export function mapShiprocketStatus(text = '') {
  const s = text.toUpperCase();
  if (s.includes('RTO')) return 'rto';
  if (s === 'DELIVERED') return 'delivered';
  if (s.includes('CANCEL')) return null; // staff decide
  if (/(PICKED UP|SHIPPED|IN TRANSIT|OUT FOR DELIVERY|REACHED)/.test(s)) return 'shipped';
  return null;
}
