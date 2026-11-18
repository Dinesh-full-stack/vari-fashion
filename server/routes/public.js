import express from 'express';
import { db, getSettings, intSetting, setting } from '../db.js';
import { config, paymentsLive } from '../config.js';
import { loadProducts, loadProduct, similarProducts } from '../lib/catalog.js';
import {
  UserError, priceBag, createOrder, getOrderByNumber, getOrderItems, getOrderEvents, markPaid, markPaymentFailed,
  requestReturn, normalisePhone, STATUS_LABEL, changeStatus, addEvent,
} from '../lib/orders.js';
import { createGatewayOrder, verifyCheckoutSignature, verifyWebhookSignature } from '../lib/razorpay.js';
import { trackAwb, mapShiprocketStatus } from '../lib/shiprocket.js';
import { renderInvoice, invoiceToken, verifyInvoiceToken } from '../lib/invoice.js';
import { placeholderSvg } from '../lib/placeholder.js';
import { getHomepage } from '../lib/homepage.js';
import {
  startSignup, startLogin, verifyCode, currentCustomer, endCustomerSession, requireCustomer, publicCustomer, updateProfile, rememberAddress,
} from '../lib/customers.js';
import { rateLimit } from '../lib/ratelimit.js';

export const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Webhooks need the raw body for signature checks, so they are registered before express.json() ----

router.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
  if (!verifyWebhookSignature(req.body, req.headers['x-razorpay-signature'])) return res.status(400).json({ error: 'bad signature' });
  const event = JSON.parse(req.body.toString('utf8'));
  const payment = event?.payload?.payment?.entity;
  if (payment?.order_id) {
    const order = db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(payment.order_id);
    if (order) {
      if (event.event === 'payment.captured' || event.event === 'order.paid') markPaid(order, payment.id, 'webhook');
      else if (event.event === 'payment.failed') markPaymentFailed(order, `Payment failed: ${payment.error_description || 'declined'}`);
    }
  }
  res.json({ ok: true }); // always 200 for events we don't act on, so Razorpay stops retrying
}));

// Shiprocket refuses webhook URLs containing "shiprocket", so /courier is the path to register there.
router.post(['/api/webhooks/shiprocket', '/api/webhooks/courier'], express.json({ limit: '1mb' }), (req, res) => {
  const token = config.shiprocket.webhookToken;
  if (!token || req.headers['x-api-key'] !== token) return res.status(401).json({ error: 'unauthorised' });
  const { awb, current_status: statusText } = req.body || {};
  const order = awb && db.prepare('SELECT * FROM orders WHERE awb = ?').get(String(awb));
  const next = mapShiprocketStatus(statusText);
  if (order && next && order.status !== next) {
    try {
      // A shipment can jump straight from confirmed/packed to delivered when scans arrive late.
      if (next === 'delivered' && ['confirmed', 'packed'].includes(order.status)) changeStatus(order.id, 'shipped', { actor: 'courier' });
      changeStatus(order.id, next, { actor: 'courier', note: String(statusText).slice(0, 120) });
    } catch (err) {
      addEvent(order.id, order.status, `Courier update ignored: ${statusText} (${err.message})`, 'courier');
    }
  }
  res.json({ ok: true });
});

router.use(express.json({ limit: '100kb' }));

// ---- Catalogue ----

router.get('/api/config', (req, res) => {
  const s = getSettings();
  res.json({
    brand: s.brand_name,
    storeOpen: s.store_open === '1',
    codEnabled: s.cod_enabled === '1',
    maxQty: Number(s.max_qty_per_item),
    returnDays: Number(s.return_window_days),
    shippingFee: Number(s.shipping_fee_paise),
    freeShippingOver: Number(s.free_shipping_over_paise),
    codFee: Number(s.cod_fee_paise),
    whatsapp: s.whatsapp_number,
    supportEmail: s.support_email,
    supportPhone: s.support_phone,
    sellerName: s.seller_legal_name,
    sellerAddress: s.seller_address,
    shopHours: s.shop_hours,
    topStrip: getHomepage().topStrip,
    categories: db.prepare('SELECT category, COUNT(*) n FROM products WHERE active = 1 GROUP BY category ORDER BY MIN(sort)').all().map((r) => r.category),
    grievanceOfficer: s.grievance_officer,
    paymentsLive,
    razorpayKey: paymentsLive ? config.razorpay.keyId : null,
  });
});

router.get('/api/homepage', (req, res) => res.json(getHomepage()));

router.get('/api/products', (req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  res.json(loadProducts());
});

router.get('/api/products/:slug', (req, res) => {
  const found = loadProduct('slug', req.params.slug);
  if (!found || !found.row.active) return res.status(404).json({ error: 'Product not found.' });
  res.json({ ...found.product, similar: similarProducts(found.row) });
});

router.get('/img/ph/:kind/:hex.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(placeholderSvg(req.params.kind, req.params.hex, req.query.view, req.query.cut === '1'));
});

// ---- Bag & checkout ----

/** Prices the bag and reports problems per line instead of failing outright, so the bag page can explain them. */
router.post('/api/bag/quote', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
  const maxQty = intSetting('max_qty_per_item');
  const getV = db.prepare(`SELECT v.id, v.stock, p.active FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`);
  const issues = {};
  const ok = [];
  for (const it of items) {
    const v = getV.get(Number(it.variantId));
    const qty = Number(it.qty);
    if (!v || !v.active) issues[it.variantId] = { message: 'No longer available', maxQty: 0 };
    else if (v.stock === 0) issues[it.variantId] = { message: 'Sold out', maxQty: 0 };
    else if (qty > v.stock) issues[it.variantId] = { message: `Only ${v.stock} left`, maxQty: v.stock };
    else if (qty > maxQty) issues[it.variantId] = { message: `Limit ${maxQty} per item online`, maxQty };
    else ok.push({ variantId: v.id, qty });
  }
  let quote = { itemsPaise: 0, shippingPaise: 0, codFeePaise: 0, totalPaise: 0, lines: [] };
  if (ok.length) {
    quote = priceBag(ok, req.body?.paymentMethod === 'cod' ? 'cod' : 'prepaid', {
      couponCode: req.body?.couponCode, phone: normalisePhone(req.body?.phone), lenient: true,
    });
  }
  res.json({
    issues,
    itemsPaise: quote.itemsPaise,
    discountPaise: quote.discountPaise || 0,
    coupon: quote.coupon || null,
    couponError: quote.couponError || '',
    shippingPaise: quote.shippingPaise,
    codFeePaise: quote.codFeePaise,
    totalPaise: quote.totalPaise,
    freeShippingOver: intSetting('free_shipping_over_paise'),
  });
});

const checkoutLimiter = rateLimit({ windowMs: 60000, max: 10 });

router.post('/api/checkout', checkoutLimiter, wrap(async (req, res) => {
  const { items, customer, paymentMethod, couponCode } = req.body || {};
  const account = currentCustomer(req);
  const order = createOrder({ items, customer, paymentMethod, couponCode, customerId: account?.id || null });
  if (account) rememberAddress(account.id, order);
  if (order.payment_method === 'cod') {
    return res.json({ order: { number: order.number, total: order.total_paise }, payment: { mode: 'cod' } });
  }
  let gw;
  try {
    gw = await createGatewayOrder({ amountPaise: order.total_paise, receipt: order.number });
  } catch (err) {
    changeStatus(order.id, 'cancelled', { note: `Could not start payment: ${err.message}` });
    throw new UserError('We could not start the payment. Please try again in a moment.', 502);
  }
  db.prepare('UPDATE orders SET razorpay_order_id = ? WHERE id = ?').run(gw.id, order.id);
  res.json({
    order: { number: order.number, total: order.total_paise },
    payment: {
      mode: gw.mock ? 'mock' : 'razorpay',
      key: config.razorpay.keyId || null,
      gatewayOrderId: gw.id,
      amount: order.total_paise,
      name: setting('brand_name'),
      prefill: { name: order.customer_name, email: order.email, contact: order.phone },
    },
  });
}));

router.post('/api/payment/verify', (req, res) => {
  const { number, razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
  const order = getOrderByNumber(number);
  if (!order || order.razorpay_order_id !== oid) throw new UserError('Order not found.', 404);
  if (!verifyCheckoutSignature({ orderId: oid, paymentId: pid, signature: sig })) {
    throw new UserError('We could not confirm this payment. If money was taken, it will be confirmed automatically within a few minutes.');
  }
  const updated = markPaid(order, pid, 'checkout');
  res.json({ number: updated.number, status: updated.status, paymentStatus: updated.payment_status });
});

/** Test mode only: completes a payment without Razorpay so the full flow can be tried locally. */
router.post('/api/payment/mock-complete', (req, res) => {
  if (paymentsLive) return res.status(404).json({ error: 'Not available.' });
  const order = getOrderByNumber(req.body?.number);
  if (!order || order.payment_method !== 'prepaid') throw new UserError('Order not found.', 404);
  const updated = markPaid(order, `mock_pay_${order.number}`, 'test mode');
  res.json({ number: updated.number, status: updated.status });
});

router.post('/api/payment/failed', (req, res) => {
  const order = getOrderByNumber(req.body?.number);
  if (order && order.payment_status === 'pending') markPaymentFailed(order, `Payment not completed: ${String(req.body?.reason || 'closed').slice(0, 120)}`);
  res.json({ ok: true });
});

// ---- Tracking, returns, invoice ----

const lookupLimiter = rateLimit({ windowMs: 60000, max: 20 });

function findCustomerOrder(number, phone) {
  const order = getOrderByNumber(number);
  if (!order || order.phone !== normalisePhone(phone)) throw new UserError('No order matches that order number and phone number.', 404);
  return order;
}

/** Everything the tracking page shows for one order. */
async function trackView(order) {
  const items = getOrderItems(order.id);
  const returns = db.prepare('SELECT number, type, status, refund_paise, items, created_at, updated_at FROM returns WHERE order_id = ? ORDER BY id').all(order.id);
  const days = intSetting('return_window_days');
  const deliveredMs = order.delivered_at ? Date.parse(order.delivered_at.replace(' ', 'T') + 'Z') : null;
  const returnBy = deliveredMs ? new Date(deliveredMs + days * 86400000).toISOString() : null;
  return {
    number: order.number,
    status: order.status,
    statusLabel: STATUS_LABEL[order.status],
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    createdAt: order.created_at,
    total: order.total_paise,
    shipping: order.shipping_paise,
    codFee: order.cod_fee_paise,
    discount: order.discount_paise,
    coupon: order.coupon_code,
    customer: { name: order.customer_name, city: order.city, state: order.state, pincode: order.pincode },
    awb: order.awb,
    courier: order.courier,
    items: items.map((i) => ({ id: i.id, name: i.product_name, color: i.color, size: i.size, qty: i.qty, price: i.unit_price_paise, slug: i.slug, image: `/img/ph/${i.silhouette}/${i.color_hex.replace('#', '')}.svg` })),
    events: getOrderEvents(order.id).filter((e) => e.actor !== 'admin-note'),
    scans: await trackAwb(order.awb),
    returns: returns.map((r) => ({ ...r, items: JSON.parse(r.items) })),
    returnBy,
    canReturn: order.status === 'delivered' && returnBy && Date.now() < Date.parse(returnBy),
    invoiceUrl: order.invoice_no ? `/invoice/${order.number}?t=${invoiceToken(order.number)}` : null,
  };
}

router.post('/api/track', lookupLimiter, wrap(async (req, res) => {
  res.json(await trackView(findCustomerOrder(req.body?.number, req.body?.phone)));
}));

// ---- Customer accounts ----

const otpLimiter = rateLimit({ windowMs: 15 * 60000, max: 10, message: 'Too many attempts. Please wait a few minutes.' });

router.post('/api/account/signup', otpLimiter, wrap(async (req, res) => res.json({ ok: true, ...(await startSignup(req.body || {})) })));
router.post('/api/account/login', otpLimiter, wrap(async (req, res) => res.json({ ok: true, ...(await startLogin(req.body || {})) })));
router.post('/api/account/verify', otpLimiter, (req, res) => res.json(verifyCode(res, req.body || {})));
router.post('/api/account/logout', (req, res) => { endCustomerSession(req, res); res.json({ ok: true }); });
router.get('/api/account/me', (req, res) => {
  const c = currentCustomer(req);
  res.set('Cache-Control', 'no-store');
  res.json(c ? publicCustomer(c) : null);
});
router.put('/api/account/me', requireCustomer, (req, res) => res.json(updateProfile(req.customer, req.body)));

const ownedOrder = (customer, number) => {
  const o = getOrderByNumber(number);
  if (!o || o.customer_id !== customer.id) throw new UserError('Order not found.', 404);
  return o;
};
router.get('/api/account/orders', requireCustomer, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = db.prepare(`SELECT id, number, status, payment_method, total_paise, created_at FROM orders
    WHERE customer_id = ? AND NOT (status = 'cancelled' AND payment_status = 'failed') ORDER BY id DESC LIMIT 100`).all(req.customer.id);
  const firstItem = db.prepare(`SELECT oi.product_name, p.silhouette, v.color_hex, (SELECT SUM(qty) FROM order_items WHERE order_id = ?) AS pieces
    FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN variants v ON v.id = oi.variant_id WHERE oi.order_id = ? LIMIT 1`);
  res.json(rows.map((o) => {
    const it = firstItem.get(o.id, o.id) || {};
    return { number: o.number, status: o.status, statusLabel: STATUS_LABEL[o.status], paymentMethod: o.payment_method, total: o.total_paise, createdAt: o.created_at,
      title: it.product_name || '', pieces: it.pieces || 0, image: it.silhouette ? `/img/ph/${it.silhouette}/${String(it.color_hex).replace('#', '')}.svg` : '' };
  }));
});
router.get('/api/account/orders/:number', requireCustomer, wrap(async (req, res) => {
  const o = ownedOrder(req.customer, req.params.number);
  res.set('Cache-Control', 'no-store');
  res.json({ ...(await trackView(o)), phone: o.phone });
}));

router.post('/api/returns', lookupLimiter, (req, res) => {
  const order = findCustomerOrder(req.body?.number, req.body?.phone);
  const r = requestReturn(order, req.body);
  res.json({ number: r.number, status: r.status });
});

router.get('/invoice/:number', (req, res) => {
  const order = getOrderByNumber(req.params.number);
  if (!order || !order.invoice_no || !verifyInvoiceToken(order.number, req.query.t)) return res.status(404).send('Invoice not found.');
  res.type('html').send(renderInvoice(order, getOrderItems(order.id)));
});

// ---- Bulk enquiries ----

router.post('/api/enquiries', rateLimit({ windowMs: 3600000, max: 5 }), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = normalisePhone(b.phone);
  if (name.length < 2) throw new UserError('Enter your name.');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new UserError('Enter a valid 10-digit mobile number.');
  db.prepare('INSERT INTO enquiries (name, phone, email, product, quantity, message) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, phone, String(b.email || '').trim().slice(0, 120), String(b.product || '').slice(0, 120),
    Math.max(0, Math.min(100000, Number(b.quantity) || 0)), String(b.message || '').trim().slice(0, 1000),
  );
  res.json({ ok: true });
});
