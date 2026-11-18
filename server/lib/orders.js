import { db, tx, nextCounter, intSetting, setting, audit } from '../db.js';
import { gstRateFor, includedTax, financialYear, rupees } from './money.js';
import { findCapturedPayment } from './razorpay.js';
import { notifyOrder, notifyReturn } from './notify.js';

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * Order statuses and the moves allowed between them.
 *   pending_payment -> confirmed (paid) | cancelled (payment failed / hold expired)
 *   confirmed       -> packed | shipped | cancelled
 *   packed          -> shipped | cancelled
 *   shipped         -> delivered | rto
 *   delivered, rto, cancelled: final (returns are tracked separately)
 */
export const TRANSITIONS = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'shipped', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'rto'],
  delivered: [],
  rto: [],
  cancelled: [],
};

export const STATUS_LABEL = {
  pending_payment: 'Awaiting payment',
  confirmed: 'Order confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  rto: 'Returned to us (not delivered)',
  cancelled: 'Cancelled',
};

const addEvent = (orderId, status, note = '', actor = 'system') =>
  db.prepare('INSERT INTO order_events (order_id, status, note, actor) VALUES (?, ?, ?, ?)').run(orderId, status, note, actor);

const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalisePhone(p = '') {
  const digits = String(p).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export const normaliseCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 30);
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

/** Checks a coupon against dates, minimum order and usage limits. Returns the discount on the items total. */
export function checkCoupon(code, itemsPaise, phone = '') {
  const c = db.prepare('SELECT * FROM coupons WHERE code = ?').get(normaliseCode(code));
  if (!c || !c.active) throw new UserError('That coupon code is not valid.');
  const today = todayIST();
  if (c.starts_on && today < c.starts_on) throw new UserError('This coupon is not active yet.');
  if (c.ends_on && today > c.ends_on) throw new UserError('This coupon has expired.');
  if (itemsPaise < c.min_order_paise) throw new UserError(`Add ${rupees(c.min_order_paise - itemsPaise)} more to use ${c.code}.`);
  if (c.usage_limit) {
    const used = db.prepare(`SELECT COUNT(*) n FROM orders WHERE coupon_code = ? AND status != 'cancelled'`).get(c.code).n;
    if (used >= c.usage_limit) throw new UserError('This coupon has been fully used.');
  }
  if (phone && c.per_customer_limit) {
    const mine = db.prepare(`SELECT COUNT(*) n FROM orders WHERE coupon_code = ? AND phone = ? AND status != 'cancelled'`).get(c.code, phone).n;
    if (mine >= c.per_customer_limit) throw new UserError('You have already used this coupon.');
  }
  let d = c.kind === 'percent' ? Math.floor((itemsPaise * c.value) / 100) : c.value;
  if (c.max_discount_paise) d = Math.min(d, c.max_discount_paise);
  d = Math.min(d, itemsPaise);
  return { code: c.code, discountPaise: d, label: c.kind === 'percent' ? `${c.value}% off` : `${rupees(c.value)} off` };
}

/**
 * Price a bag against current prices and stock. Never trusts prices sent by the browser.
 * A coupon discount is split across the lines in proportion to their value, and GST is worked out on the
 * discounted amount. With `lenient`, a bad coupon is reported in `couponError` instead of failing the quote.
 */
export function priceBag(rawItems, paymentMethod = 'prepaid', { couponCode = '', phone = '', lenient = false } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new UserError('Your bag is empty.');
  if (rawItems.length > 50) throw new UserError('Too many lines in the bag.');
  const maxQty = intSetting('max_qty_per_item');

  const merged = new Map();
  for (const it of rawItems) {
    const id = Number(it.variantId), qty = Number(it.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1) throw new UserError('Invalid item in bag.');
    merged.set(id, (merged.get(id) || 0) + qty);
  }

  const getVariant = db.prepare(`
    SELECT v.id, v.color, v.size, v.sku, v.stock, p.id AS product_id, p.name, p.slug, p.price_paise, p.hsn,
           p.weight_grams, p.active, p.images, p.silhouette, v.color_hex
    FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`);

  const lines = [];
  for (const [variantId, qty] of merged) {
    const v = getVariant.get(variantId);
    if (!v || !v.active) throw new UserError('An item in your bag is no longer available.');
    if (qty > maxQty) {
      throw new UserError(`You can order up to ${maxQty} of "${v.name}" online. For larger quantities, use the bulk enquiry form.`);
    }
    if (qty > v.stock) {
      throw new UserError(v.stock === 0
        ? `"${v.name}" (${v.color}, ${v.size}) is sold out.`
        : `Only ${v.stock} left of "${v.name}" (${v.color}, ${v.size}).`);
    }
    lines.push({ ...v, variantId, qty, lineTotal: v.price_paise * qty });
  }

  const itemsPaise = lines.reduce((s, l) => s + l.lineTotal, 0);
  let coupon = null, couponError = '';
  if (couponCode) {
    try { coupon = checkCoupon(couponCode, itemsPaise, phone); }
    catch (err) { if (!lenient || !(err instanceof UserError)) throw err; couponError = err.message; }
  }
  const discountPaise = coupon ? coupon.discountPaise : 0;
  let left = discountPaise;
  lines.forEach((l, i) => {
    l.discountPaise = i === lines.length - 1 ? left : Math.floor((l.lineTotal * discountPaise) / itemsPaise);
    left -= l.discountPaise;
    const net = l.lineTotal - l.discountPaise;
    l.gstRate = gstRateFor(Math.round(net / l.qty));
    l.taxPaise = includedTax(net, l.gstRate);
  });

  const afterDiscount = itemsPaise - discountPaise;
  const shippingPaise = afterDiscount >= intSetting('free_shipping_over_paise') ? 0 : intSetting('shipping_fee_paise');
  const codFeePaise = paymentMethod === 'cod' ? intSetting('cod_fee_paise') : 0;
  const taxPaise = lines.reduce((s, l) => s + l.taxPaise, 0);
  return {
    lines, itemsPaise, discountPaise, coupon, couponError, shippingPaise, codFeePaise, taxPaise,
    totalPaise: afterDiscount + shippingPaise + codFeePaise,
  };
}

function validateCustomer(c = {}) {
  const out = {
    name: String(c.name || '').trim().slice(0, 80),
    phone: normalisePhone(c.phone),
    email: String(c.email || '').trim().toLowerCase().slice(0, 120),
    line1: String(c.line1 || '').trim().slice(0, 160),
    line2: String(c.line2 || '').trim().slice(0, 160),
    city: String(c.city || '').trim().slice(0, 60),
    state: String(c.state || '').trim().slice(0, 60),
    pincode: String(c.pincode || '').trim(),
  };
  if (out.name.length < 2) throw new UserError('Enter your full name.');
  if (!PHONE.test(out.phone)) throw new UserError('Enter a valid 10-digit Indian mobile number.');
  if (!EMAIL.test(out.email)) throw new UserError('Enter a valid email address.');
  if (out.line1.length < 5) throw new UserError('Enter your street address.');
  if (!out.city) throw new UserError('Enter your city.');
  if (!out.state) throw new UserError('Choose your state.');
  if (!PIN.test(out.pincode)) throw new UserError('Enter a valid 6-digit pincode.');
  return out;
}

/**
 * Create an order and take its stock off sale in one transaction, so two buyers can never
 * both get the last unit. Prepaid orders hold stock until payment arrives or the hold expires.
 */
function createOrderTx({ items, customer, paymentMethod, couponCode = '', customerId = null }) {
  if (setting('store_open') !== '1') throw new UserError('The store is closed for orders right now. Please try again later.', 503);
  if (!['prepaid', 'cod'].includes(paymentMethod)) throw new UserError('Choose a payment method.');
  if (paymentMethod === 'cod' && setting('cod_enabled') !== '1') throw new UserError('Cash on delivery is not available right now.');
  const c = validateCustomer(customer);

  return tx(() => {
    const bag = priceBag(items, paymentMethod, { couponCode, phone: c.phone }); // re-checked inside the transaction
    const takeStock = db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?');
    for (const l of bag.lines) {
      if (takeStock.run(l.qty, l.variantId, l.qty).changes !== 1) throw new UserError(`"${l.name}" just sold out.`);
    }
    const number = `${setting('brand_name').slice(0, 2).toUpperCase()}${nextCounter('order', 10000)}`;
    const isCod = paymentMethod === 'cod';
    const holdMins = intSetting('payment_hold_minutes');
    const info = db.prepare(`
      INSERT INTO orders (number, customer_name, phone, email, address_line1, address_line2, city, state, pincode,
        payment_method, payment_status, status, items_paise, shipping_paise, cod_fee_paise, total_paise, tax_paise, coupon_code, discount_paise, customer_id, hold_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${isCod ? 'NULL' : `datetime('now', '+${holdMins} minutes')`})`).run(
      number, c.name, c.phone, c.email, c.line1, c.line2, c.city, c.state, c.pincode,
      paymentMethod, isCod ? 'cod_pending' : 'pending', isCod ? 'confirmed' : 'pending_payment',
      bag.itemsPaise, bag.shippingPaise, bag.codFeePaise, bag.totalPaise, bag.taxPaise, bag.coupon?.code || null, bag.discountPaise, customerId,
    );
    const orderId = Number(info.lastInsertRowid);
    const addItem = db.prepare(`INSERT INTO order_items (order_id, variant_id, product_id, product_name, color, size, sku, hsn,
      unit_price_paise, qty, gst_rate, tax_paise, discount_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of bag.lines) {
      addItem.run(orderId, l.variantId, l.product_id, l.name, l.color, l.size, l.sku, l.hsn, l.price_paise, l.qty, l.gstRate, l.taxPaise, l.discountPaise);
    }
    addEvent(orderId, isCod ? 'confirmed' : 'pending_payment', (isCod ? 'Cash on delivery order placed' : 'Waiting for online payment') + (bag.coupon ? ` · coupon ${bag.coupon.code} (−${rupees(bag.discountPaise)})` : ''));
    if (isCod) assignInvoiceNo(orderId);
    return getOrder(orderId);
  });
}

function assignInvoiceNo(orderId) {
  const fy = financialYear();
  const n = nextCounter(`invoice_${fy}`, 0);
  db.prepare('UPDATE orders SET invoice_no = ? WHERE id = ? AND invoice_no IS NULL').run(`INV/${fy}/${String(n).padStart(5, '0')}`, orderId);
}

export const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
export const getOrderByNumber = (n) => db.prepare('SELECT * FROM orders WHERE number = ?').get(String(n || '').trim().toUpperCase());
export const getOrderItems = (orderId) => db.prepare(`
  SELECT oi.*, p.weight_grams, p.slug, p.silhouette, v.color_hex
  FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN variants v ON v.id = oi.variant_id
  WHERE order_id = ?`).all(orderId);
export const getOrderEvents = (orderId) => db.prepare('SELECT status, note, actor, created_at FROM order_events WHERE order_id = ? ORDER BY id').all(orderId);

function restoreStock(orderId) {
  const put = db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?');
  for (const it of db.prepare('SELECT variant_id, qty FROM order_items WHERE order_id = ?').all(orderId)) put.run(it.qty, it.variant_id);
}

/**
 * Mark a prepaid order paid. Safe to call more than once (browser callback and webhook both call it).
 * If the hold had already expired and stock was released, it takes the stock again; if that stock
 * is gone, the order is flagged for staff to refund.
 */
function markPaidTx(order, paymentId, source) {
  return tx(() => {
    const o = getOrder(order.id);
    if (o.payment_status === 'paid') return o;
    if (o.status === 'cancelled') {
      const lines = db.prepare('SELECT variant_id, qty FROM order_items WHERE order_id = ?').all(o.id);
      const ok = lines.every((l) => db.prepare('SELECT stock FROM variants WHERE id = ?').get(l.variant_id).stock >= l.qty);
      if (ok) {
        for (const l of lines) db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ?').run(l.qty, l.variant_id);
        db.prepare(`UPDATE orders SET status='confirmed', payment_status='paid', razorpay_payment_id=?, updated_at=datetime('now') WHERE id=?`).run(paymentId, o.id);
        addEvent(o.id, 'confirmed', `Late payment received (${source}); order revived`);
      } else {
        db.prepare(`UPDATE orders SET payment_status='paid_needs_refund', razorpay_payment_id=?, updated_at=datetime('now') WHERE id=?`).run(paymentId, o.id);
        addEvent(o.id, 'cancelled', `Payment arrived after stock was released and sold. REFUND NEEDED (${source})`);
        return getOrder(o.id);
      }
    } else {
      db.prepare(`UPDATE orders SET status='confirmed', payment_status='paid', razorpay_payment_id=?, hold_expires_at=NULL, updated_at=datetime('now') WHERE id=?`).run(paymentId, o.id);
      addEvent(o.id, 'confirmed', `Payment received (${source})`);
    }
    assignInvoiceNo(o.id);
    return getOrder(o.id);
  });
}

export function markPaymentFailed(order, reason = 'Payment failed') {
  db.prepare(`UPDATE orders SET payment_status='failed', updated_at=datetime('now') WHERE id=? AND payment_status='pending'`).run(order.id);
  addEvent(order.id, order.status, reason);
}

/** Move an order to a new status, enforcing the allowed transitions. */
function changeStatusTx(orderId, next, { actor = 'system', note = '', adminId = null } = {}) {
  return tx(() => {
    const o = getOrder(orderId);
    if (!o) throw new UserError('Order not found.', 404);
    if (o.status === next) return o;
    if (!TRANSITIONS[o.status]?.includes(next)) throw new UserError(`Can't move an order from "${STATUS_LABEL[o.status]}" to "${STATUS_LABEL[next]}".`);
    if (next === 'cancelled' || next === 'rto') restoreStock(o.id);
    const extra = next === 'delivered' ? ", delivered_at=datetime('now')"
      + (o.payment_method === 'cod' ? ", payment_status='cod_collected'" : '')
      : next === 'shipped' ? ", shipped_at=COALESCE(shipped_at, datetime('now'))" : '';
    db.prepare(`UPDATE orders SET status=?, updated_at=datetime('now')${extra} WHERE id=?`).run(next, o.id);
    if (next === 'cancelled' && o.payment_status === 'paid') {
      db.prepare(`UPDATE orders SET payment_status='paid_needs_refund' WHERE id=?`).run(o.id);
    }
    addEvent(o.id, next, note || (next === 'rto' ? 'Parcel came back to us; stock restored' : ''), actor);
    if (adminId) audit(adminId, 'order.status', 'order', o.number, `${o.status} -> ${next}`);
    return getOrder(o.id);
  });
}

/** Cancel prepaid orders whose payment hold ran out, after one last check with the gateway. */
export async function releaseExpiredHolds() {
  const expired = db.prepare(`SELECT * FROM orders WHERE status='pending_payment' AND hold_expires_at < datetime('now')`).all();
  for (const o of expired) {
    try {
      const paid = o.razorpay_order_id ? await findCapturedPayment(o.razorpay_order_id) : null;
      if (paid) { markPaid(o, paid.id, 'reconcile'); continue; }
      changeStatus(o.id, 'cancelled', { note: 'Payment not completed in time; stock released' });
      db.prepare(`UPDATE orders SET payment_status='failed' WHERE id=? AND payment_status='pending'`).run(o.id);
    } catch (err) {
      console.error(`[holds] ${o.number}:`, err.message);
    }
  }
}

/** Customer-side return request: only for delivered orders inside the return window. */
function requestReturnTx(order, { type, reason, items, refundUpi }) {
  if (order.status !== 'delivered' || !order.delivered_at) throw new UserError('Returns open once your order is delivered.');
  const days = intSetting('return_window_days');
  const age = (Date.now() - Date.parse(order.delivered_at.replace(' ', 'T') + 'Z')) / 86400000;
  if (age > days) throw new UserError(`The ${days}-day return window for this order has closed.`);
  if (!['refund', 'exchange'].includes(type)) throw new UserError('Choose refund or exchange.');
  const why = String(reason || '').trim().slice(0, 500);
  if (why.length < 3) throw new UserError('Tell us briefly why you are returning the item.');
  const upi = String(refundUpi || '').trim().slice(0, 80);
  if (type === 'refund' && order.payment_method === 'cod' && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) {
    throw new UserError('For cash-on-delivery orders, enter the UPI ID where we should send your refund.');
  }

  const orderItems = getOrderItems(order.id);
  const already = new Map();
  for (const r of db.prepare(`SELECT items FROM returns WHERE order_id=? AND status NOT IN ('rejected')`).all(order.id)) {
    for (const i of JSON.parse(r.items)) already.set(i.itemId, (already.get(i.itemId) || 0) + i.qty);
  }
  const chosen = [];
  for (const it of Array.isArray(items) ? items : []) {
    const oi = orderItems.find((x) => x.id === Number(it.itemId));
    const qty = Number(it.qty);
    if (!oi || !Number.isInteger(qty) || qty < 1) continue;
    if (qty + (already.get(oi.id) || 0) > oi.qty) throw new UserError(`You've already requested a return for "${oi.product_name}".`);
    chosen.push({ itemId: oi.id, qty, exchangeSize: type === 'exchange' ? String(it.exchangeSize || '').slice(0, 10) : '' });
  }
  if (!chosen.length) throw new UserError('Choose at least one item to return.');
  const refundPaise = type === 'refund'
    ? chosen.reduce((s, c) => { const oi = orderItems.find((x) => x.id === c.itemId); return s + oi.unit_price_paise * c.qty - Math.round(((oi.discount_paise || 0) * c.qty) / oi.qty); }, 0)
    : 0;

  return tx(() => {
    const number = `R${nextCounter('return', 500)}`;
    db.prepare(`INSERT INTO returns (number, order_id, type, reason, items, refund_upi, refund_paise) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(number, order.id, type, why, JSON.stringify(chosen), upi, refundPaise);
    addEvent(order.id, order.status, `Return ${number} requested (${type})`, 'customer');
    return db.prepare('SELECT * FROM returns WHERE number = ?').get(number);
  });
}

/** Put returned units back on sale. Only called after staff inspect the returned items. */
export function restockReturn(ret) {
  if (ret.restocked) return;
  const items = JSON.parse(ret.items);
  const put = db.prepare('UPDATE variants SET stock = stock + ? WHERE id = (SELECT variant_id FROM order_items WHERE id = ?)');
  for (const i of items) put.run(i.qty, i.itemId);
  db.prepare('UPDATE returns SET restocked = 1 WHERE id = ?').run(ret.id);
}

// ---- Public versions: run the change, then send emails once it is saved ----

export function createOrder(args) {
  const order = createOrderTx(args);
  if (order.status === 'confirmed') notifyOrder(order.id, 'confirmed'); // COD orders are confirmed at once
  return order;
}

export function markPaid(order, paymentId, source) {
  const before = getOrder(order.id)?.payment_status;
  const after = markPaidTx(order, paymentId, source);
  if (before !== 'paid' && after.payment_status === 'paid' && after.status === 'confirmed') notifyOrder(after.id, 'confirmed');
  return after;
}

export function changeStatus(orderId, next, opts = {}) {
  const prev = getOrder(orderId)?.status;
  const after = changeStatusTx(orderId, next, opts);
  if (after.status !== prev) {
    if (next === 'shipped' || next === 'delivered') notifyOrder(after.id, next);
    // Unpaid online orders that simply time out don't get a cancellation email
    if (next === 'cancelled' && prev !== 'pending_payment') notifyOrder(after.id, 'cancelled');
  }
  return after;
}

/** A customer may cancel until the parcel has a tracking number: unpaid, confirmed or packed. After that they can return it once it is delivered. */
export const canCustomerCancel = (o) => ['pending_payment', 'confirmed', 'packed'].includes(o.status) && !o.awb;

export function cancelByCustomer(order, reason = '') {
  if (!canCustomerCancel(order)) throw new UserError('This order has already shipped or been closed, so it can no longer be cancelled here. Once it is delivered you can request a return from the Track order page.');
  const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const after = changeStatus(order.id, 'cancelled', { actor: 'customer', note: `Cancelled by the customer${why ? `: ${why}` : ''}` });
  notifyOrder(order.id, 'customer_cancelled'); // tells the owner; changeStatus already emailed the customer
  return after;
}

export function requestReturn(order, body) {
  const r = requestReturnTx(order, body);
  notifyReturn(r.number, 'requested');
  return r;
}

export { addEvent };
