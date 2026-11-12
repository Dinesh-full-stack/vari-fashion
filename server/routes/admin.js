import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db, tx, getSettings, intSetting, audit } from '../db.js';
import { config, paymentsLive, shippingLive } from '../config.js';
import {
  requireAdmin, requireOwner, can, permsFor, ROLES, startSession, endSession, currentAdmin, verifyPassword, hashPassword,
  loginThrottled, noteLoginFailure, clearLoginFailures,
} from '../lib/auth.js';
import { loadProducts, loadProduct } from '../lib/catalog.js';
import {
  UserError, getOrderByNumber, getOrderItems, getOrderEvents, changeStatus, addEvent, restockReturn, STATUS_LABEL, TRANSITIONS,
} from '../lib/orders.js';
import { createShipment } from '../lib/shiprocket.js';
import { refundPayment } from '../lib/razorpay.js';
import { invoiceToken } from '../lib/invoice.js';
import { rateLimit } from '../lib/ratelimit.js';
import { getHomepage, saveHomepage } from '../lib/homepage.js';
import { notifyReturn } from '../lib/notify.js';
import { sendMail, mailLive } from '../lib/mailer.js';

export const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(express.json({ limit: '200kb' }));

// ---- Session ----

router.post('/login', rateLimit({ windowMs: 60000, max: 20 }), (req, res) => {
  const ip = req.ip;
  if (loginThrottled(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || !verifyPassword(String(req.body?.password || ''), admin.password_hash)) {
    noteLoginFailure(ip);
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  clearLoginFailures(ip);
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  startSession(res, admin.id);
  audit(admin.id, 'login', 'admin', admin.id);
  res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });
});

router.post('/logout', (req, res) => { endSession(req, res); res.json({ ok: true }); });

router.get('/me', (req, res) => {
  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Please sign in.' });
  res.json({ ...admin, roleLabel: ROLES[admin.role]?.label, perms: permsFor(admin.role), paymentsLive, shippingLive, mailLive: mailLive() });
});

router.use(requireAdmin);

// Every admin route needs a permission. Anything not listed here is owner-only, so a new route is safe by default.
const RULES = [
  [/^\/(password|dashboard)$/, null],
  [/^\/(products|variants)(\/|$)/, 'products'],
  [/^\/homepage(\/|$)/, 'homepage'],
  [/^\/coupons(\/|$)/, 'coupons'],
  [/^\/orders\/[^/]+\/refund$/, 'refunds'],
  [/^\/export\//, 'export'],
  [/^\/orders(\/|$)/, 'orders'],
  [/^\/returns(\/|$)/, 'returns'],
  [/^\/enquiries(\/|$)/, 'enquiries'],
  [/^\/customers(\/|$)/, 'customers'],
  [/^\/ledger(\/|$)/, (m) => (m === 'DELETE' ? 'money.delete' : 'money')],
  [/^\/(settings|emails)(\/|$)/, (m) => (m === 'GET' ? 'settings.view' : 'settings.edit')],
  [/^\/staff(\/|$)/, 'staff'],
  [/^\/audit$/, 'audit'],
];
router.use((req, res, next) => {
  const rule = RULES.find(([re]) => re.test(req.path));
  const perm = rule ? (typeof rule[1] === 'function' ? rule[1](req.method) : rule[1]) : 'owner-only';
  if (perm && !can(req.admin, perm)) return res.status(403).json({ error: 'Your role doesn’t allow this. Ask the owner if you need access.' });
  next();
});

router.post('/password', (req, res) => {
  const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
  if (!verifyPassword(String(req.body?.current || ''), row.password_hash)) throw new UserError('Current password is wrong.');
  const next = String(req.body?.next || '');
  if (next.length < 10) throw new UserError('Use at least 10 characters.');
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.admin.id);
  audit(req.admin.id, 'password.change', 'admin', req.admin.id);
  res.json({ ok: true });
});

// ---- Dashboard ----

const sum = (sql, ...args) => db.prepare(sql).get(...args)?.v ?? 0;
const SOLD = `status NOT IN ('pending_payment','cancelled')`;

router.get('/dashboard', (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
  const since = `datetime('now', '-${days} days')`;

  const gross = sum(`SELECT COALESCE(SUM(total_paise),0) v FROM orders WHERE ${SOLD} AND created_at >= ${since}`);
  const orders = sum(`SELECT COUNT(*) v FROM orders WHERE ${SOLD} AND created_at >= ${since}`);
  const codOrders = sum(`SELECT COUNT(*) v FROM orders WHERE ${SOLD} AND payment_method='cod' AND created_at >= ${since}`);
  const refunded = sum(`SELECT COALESCE(SUM(refunded_paise),0) v FROM orders WHERE created_at >= ${since}`);
  const delivered = sum(`SELECT COUNT(*) v FROM orders WHERE status='delivered' AND created_at >= ${since}`);
  const rto = sum(`SELECT COUNT(*) v FROM orders WHERE status='rto' AND created_at >= ${since}`);
  const returnsCount = sum(`SELECT COUNT(*) v FROM returns r JOIN orders o ON o.id=r.order_id WHERE r.status!='rejected' AND o.created_at >= ${since}`);

  const daily = db.prepare(`
    SELECT date(created_at, '+330 minutes') AS day, COUNT(*) AS orders, COALESCE(SUM(total_paise),0) AS sales
    FROM orders WHERE ${SOLD} AND created_at >= ${since} GROUP BY day ORDER BY day`).all();

  // ---- Money due (estimates) ----
  const bps = intSetting('gateway_fee_bps');
  const prepaidCollected = sum(`SELECT COALESCE(SUM(total_paise),0) v FROM orders WHERE payment_method='prepaid'
    AND payment_status IN ('paid','paid_needs_refund','refunded','partially_refunded')`);
  const prepaidRefunded = sum(`SELECT COALESCE(SUM(refunded_paise),0) v FROM orders WHERE payment_method='prepaid'`);
  const gatewayFees = Math.round((prepaidCollected * bps) / 10000);
  const settled = sum(`SELECT COALESCE(SUM(amount_paise),0) v FROM ledger WHERE kind='gateway_settlement'`);
  const codDelivered = sum(`SELECT COALESCE(SUM(total_paise),0) v FROM orders WHERE payment_method='cod' AND payment_status='cod_collected'`);
  const codRemitted = sum(`SELECT COALESCE(SUM(amount_paise),0) v FROM ledger WHERE kind='cod_remittance'`);
  const codRefunded = sum(`SELECT COALESCE(SUM(refunded_paise),0) v FROM orders WHERE payment_method='cod'`);
  const refundsOwed = sum(`SELECT COALESCE(SUM(refund_paise),0) v FROM returns WHERE type='refund' AND status IN ('approved','received')`)
    + sum(`SELECT COALESCE(SUM(total_paise - refunded_paise),0) v FROM orders WHERE payment_status='paid_needs_refund'`);
  const lastSettlement = db.prepare(`SELECT entry_date FROM ledger WHERE kind='gateway_settlement' ORDER BY entry_date DESC LIMIT 1`).get()?.entry_date || null;
  const lastRemit = db.prepare(`SELECT entry_date FROM ledger WHERE kind='cod_remittance' ORDER BY entry_date DESC LIMIT 1`).get()?.entry_date || null;

  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const pendingReturns = sum(`SELECT COUNT(*) v FROM returns WHERE status IN ('requested','approved','received')`);
  const newEnquiries = sum(`SELECT COUNT(*) v FROM enquiries WHERE status='new'`);
  const needsRefund = sum(`SELECT COUNT(*) v FROM orders WHERE payment_status='paid_needs_refund'`);
  const lowStock = db.prepare(`SELECT p.name, v.color, v.size, v.sku, v.stock FROM variants v JOIN products p ON p.id=v.product_id
    WHERE p.active=1 AND v.stock <= 3 ORDER BY v.stock, p.name LIMIT 20`).all();
  const topProducts = db.prepare(`SELECT oi.product_name name, SUM(oi.qty) units, SUM(oi.qty*oi.unit_price_paise) sales
    FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.${SOLD.replace('status', 'status')} AND o.created_at >= ${since}
    GROUP BY oi.product_id ORDER BY sales DESC LIMIT 5`).all();

  const showSales = can(req.admin, 'sales');
  res.json({
    days,
    showSales,
    sales: { gross, net: gross - refunded, refunded, orders, aov: orders ? Math.round(gross / orders / 100) * 100 : 0, codShare: orders ? codOrders / orders : 0 },
    rates: { rto: delivered + rto ? rto / (delivered + rto) : 0, returns: delivered ? returnsCount / delivered : 0, delivered, rtoCount: rto },
    daily,
    money: {
      gatewayPending: prepaidCollected - prepaidRefunded - gatewayFees - settled,
      gatewayFees, settled, lastSettlement,
      codPending: codDelivered - codRefunded - codRemitted, codRemitted, lastRemit,
      refundsOwed,
      paidToBank: settled + codRemitted,
      feeRatePct: bps / 100,
    },
    actions: {
      toShip: (counts.confirmed || 0) + (counts.packed || 0),
      awaitingPayment: counts.pending_payment || 0,
      inTransit: counts.shipped || 0,
      pendingReturns, newEnquiries, needsRefund,
    },
    lowStock,
    topProducts,
    ...(showSales ? {} : { sales: null, rates: null, daily: [], money: null, topProducts: [] }),
  });
});

// ---- Products ----

router.get('/products', (req, res) => res.json(loadProducts({ activeOnly: false, forAdmin: true })));

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 60);
const SIL = ['shirt', 'tee', 'kurta', 'dress', 'trousers', 'jacket'];

/**
 * Size chart typed like a spreadsheet: one row per line, cells separated by commas (or tabs when pasted from Excel).
 * The first line is the header, e.g. "Size, Chest (in), Length (in)". Stored as JSON; empty text clears the chart.
 */
function parseSizeChart(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) return '';
  const rows = lines.map((l) => l.split(l.includes('\t') ? '\t' : ',').map((c) => c.trim().slice(0, 30)).slice(0, 8));
  if (rows.length < 2) throw new UserError('Size chart needs a header line and at least one size line.');
  return JSON.stringify({ header: rows[0], rows: rows.slice(1) });
}

function saveProduct(body, id = null) {
  const name = String(body.name || '').trim();
  if (name.length < 2) throw new UserError('Product name is required.');
  const price = Math.round(Number(body.price) * 100);
  const mrp = Math.round(Number(body.mrp || body.price) * 100);
  if (!Number.isFinite(price) || price <= 0) throw new UserError('Enter a valid price.');
  if (mrp < price) throw new UserError('MRP cannot be lower than the selling price.');
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!variants.length) throw new UserError('Add at least one size/colour.');
  const seen = new Set();
  for (const v of variants) {
    v.color = String(v.color || '').trim(); v.size = String(v.size || '').trim();
    v.colorHex = /^#[0-9a-f]{6}$/i.test(v.colorHex) ? v.colorHex : '#888888';
    v.stock = Math.max(0, Math.floor(Number(v.stock) || 0));
    if (!v.color || !v.size) throw new UserError('Every variant needs a colour and a size.');
    const key = `${v.color}|${v.size}`.toLowerCase();
    if (seen.has(key)) throw new UserError(`Duplicate variant: ${v.color} / ${v.size}.`);
    seen.add(key);
  }
  const fields = {
    slug: slugify(body.slug || name), name, category: String(body.category || 'Shirts').trim(),
    tagline: String(body.tagline || '').trim(), description: String(body.description || '').trim(),
    fabric: String(body.fabric || '').trim(), care: String(body.care || '').trim(),
    price_paise: price, mrp_paise: mrp, hsn: String(body.hsn || '6205').trim(),
    silhouette: SIL.includes(body.silhouette) ? body.silhouette : 'shirt',
    similar: JSON.stringify((body.similar || []).map(Number).filter(Boolean).slice(0, 8)),
    weight_grams: Math.max(50, Number(body.weightGrams) || 400),
    size_chart: parseSizeChart(body.sizeChart),
    active: body.active === false ? 0 : 1, sort: Number(body.sort) || 0,
  };
  return tx(() => {
    const clash = db.prepare('SELECT id FROM products WHERE slug = ? AND id IS NOT ?').get(fields.slug, id);
    if (clash) throw new UserError('Another product already uses this URL name (slug).');
    if (id) {
      const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE products SET ${sets} WHERE id = @id`).run({ ...fields, id });
    } else {
      const keys = Object.keys(fields);
      id = Number(db.prepare(`INSERT INTO products (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`).run(fields).lastInsertRowid);
    }
    const existing = db.prepare('SELECT * FROM variants WHERE product_id = ?').all(id);
    const keepIds = new Set();
    for (const v of variants) {
      const match = existing.find((e) => e.id === Number(v.id)) || existing.find((e) => e.color === v.color && e.size === v.size);
      const sku = String(v.sku || '').trim() || `${fields.slug.slice(0, 10).toUpperCase()}-${v.color.slice(0, 3).toUpperCase()}-${v.size}`.replace(/[^A-Z0-9-]/g, '');
      if (match) {
        db.prepare('UPDATE variants SET color=?, color_hex=?, size=?, sku=?, stock=? WHERE id=?').run(v.color, v.colorHex, v.size, sku, v.stock, match.id);
        keepIds.add(match.id);
      } else {
        const r = db.prepare('INSERT INTO variants (product_id, color, color_hex, size, sku, stock) VALUES (?, ?, ?, ?, ?, ?)').run(id, v.color, v.colorHex, v.size, sku, v.stock);
        keepIds.add(Number(r.lastInsertRowid));
      }
    }
    for (const e of existing) {
      if (keepIds.has(e.id)) continue;
      const used = db.prepare('SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1').get(e.id);
      if (used) db.prepare('UPDATE variants SET stock = 0 WHERE id = ?').run(e.id); // keep for order history
      else db.prepare('DELETE FROM variants WHERE id = ?').run(e.id);
    }
    return id;
  });
}

router.post('/products', (req, res) => {
  const id = saveProduct(req.body);
  audit(req.admin.id, 'product.create', 'product', id, req.body.name);
  res.json(loadProduct('id', id, { forAdmin: true }).product);
});

router.put('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new UserError('Product not found.', 404);
  saveProduct(req.body, id);
  audit(req.admin.id, 'product.update', 'product', id, { price: req.body.price, stock: (req.body.variants || []).map((v) => `${v.color}/${v.size}:${v.stock}`).join(' ') });
  res.json(loadProduct('id', id, { forAdmin: true }).product);
});

router.patch('/variants/:id/stock', (req, res) => {
  const v = db.prepare('SELECT * FROM variants WHERE id = ?').get(Number(req.params.id));
  if (!v) throw new UserError('Variant not found.', 404);
  const stock = Math.max(0, Math.floor(Number(req.body?.stock)));
  if (!Number.isFinite(stock)) throw new UserError('Enter a stock number.');
  db.prepare('UPDATE variants SET stock = ? WHERE id = ?').run(stock, v.id);
  audit(req.admin.id, 'stock.set', 'variant', v.sku, `${v.stock} -> ${stock}`);
  res.json({ id: v.id, stock });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif' })[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype)),
});

router.post('/products/:id/images', upload.array('images', 8), (req, res) => {
  const p = db.prepare('SELECT images FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) throw new UserError('Product not found.', 404);
  const images = JSON.parse(p.images).concat((req.files || []).map((f) => `/uploads/${f.filename}`));
  db.prepare('UPDATE products SET images = ? WHERE id = ?').run(JSON.stringify(images), Number(req.params.id));
  audit(req.admin.id, 'product.images.add', 'product', req.params.id, `${req.files?.length || 0} file(s)`);
  res.json({ images });
});

router.put('/products/:id/images', (req, res) => {
  const p = db.prepare('SELECT images FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) throw new UserError('Product not found.', 404);
  const current = JSON.parse(p.images);
  const next = (req.body?.images || []).filter((u) => current.includes(u)); // reorder / remove only
  for (const u of current.filter((u) => !next.includes(u))) {
    fs.rm(path.join(config.uploadsDir, path.basename(u)), () => {});
  }
  db.prepare('UPDATE products SET images = ? WHERE id = ?').run(JSON.stringify(next), Number(req.params.id));
  res.json({ images: next });
});

// ---- Orders ----

router.get('/orders', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.status === 'to_ship') where.push(`status IN ('confirmed','packed')`);
  else if (req.query.status === 'needs_refund') where.push(`payment_status = 'paid_needs_refund'`);
  else if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
  if (req.query.q) {
    const q = `%${String(req.query.q).trim()}%`;
    where.push('(number LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR email LIKE ? OR awb LIKE ?)');
    args.push(q, q, q, q, q);
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const sql = `FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = db.prepare(`SELECT COUNT(*) n ${sql}`).get(...args).n;
  const rows = db.prepare(`SELECT id, number, customer_name, phone, city, state, payment_method, payment_status, status, total_paise, awb, created_at
    ${sql} ORDER BY id DESC LIMIT 50 OFFSET ?`).all(...args, (page - 1) * 50);
  res.json({ total, page, rows });
});

function orderDetail(order) {
  return {
    ...order,
    statusLabel: STATUS_LABEL[order.status],
    next: TRANSITIONS[order.status],
    items: getOrderItems(order.id),
    events: getOrderEvents(order.id),
    returns: db.prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY id').all(order.id).map((r) => ({ ...r, items: JSON.parse(r.items) })),
    invoiceUrl: order.invoice_no ? `/invoice/${order.number}?t=${invoiceToken(order.number)}` : null,
  };
}

const findOrder = (n) => { const o = getOrderByNumber(n); if (!o) throw new UserError('Order not found.', 404); return o; };

router.get('/orders/:number', (req, res) => res.json(orderDetail(findOrder(req.params.number))));

router.post('/orders/:number/status', (req, res) => {
  const o = findOrder(req.params.number);
  const updated = changeStatus(o.id, String(req.body?.status), { actor: req.admin.name, note: String(req.body?.note || '').slice(0, 300), adminId: req.admin.id });
  res.json(orderDetail(updated));
});

router.post('/orders/:number/note', (req, res) => {
  const o = findOrder(req.params.number);
  const note = String(req.body?.note || '').trim().slice(0, 500);
  if (!note) throw new UserError('Write a note first.');
  addEvent(o.id, o.status, note, 'admin-note');
  res.json(orderDetail(o));
});

router.post('/orders/:number/ship', wrap(async (req, res) => {
  const o = findOrder(req.params.number);
  if (!['confirmed', 'packed'].includes(o.status)) throw new UserError('Only confirmed or packed orders can be shipped.');
  if (o.awb) throw new UserError('This order already has a shipment.');
  const s = await createShipment(o, getOrderItems(o.id));
  db.prepare('UPDATE orders SET shiprocket_order_id=?, shipment_id=?, awb=?, courier=? WHERE id=?').run(s.shiprocketOrderId, s.shipmentId, s.awb, s.courier, o.id);
  const updated = changeStatus(o.id, 'shipped', { actor: req.admin.name, note: `${s.courier} · AWB ${s.awb}${s.mock ? ' (test mode)' : ''}`, adminId: req.admin.id });
  res.json(orderDetail(updated));
}));

router.post('/orders/:number/manual-awb', (req, res) => {
  const o = findOrder(req.params.number);
  const awb = String(req.body?.awb || '').trim().slice(0, 40);
  const courier = String(req.body?.courier || '').trim().slice(0, 60);
  if (!awb) throw new UserError('Enter the tracking (AWB) number.');
  db.prepare('UPDATE orders SET awb=?, courier=? WHERE id=?').run(awb, courier, o.id);
  const updated = ['confirmed', 'packed'].includes(o.status)
    ? changeStatus(o.id, 'shipped', { actor: req.admin.name, note: `${courier} · AWB ${awb}`, adminId: req.admin.id })
    : findOrder(o.number);
  res.json(orderDetail(updated));
});

/** Full refund for a cancelled prepaid order (for example, paid after its stock was released). */
router.post('/orders/:number/refund', wrap(async (req, res) => {
  const o = findOrder(req.params.number);
  if (o.payment_status !== 'paid_needs_refund') throw new UserError('This order has no pending refund.');
  const amount = o.total_paise - o.refunded_paise;
  const r = await refundPayment(o.razorpay_payment_id, amount, { order: o.number });
  db.prepare(`UPDATE orders SET payment_status='refunded', refunded_paise=refunded_paise+? WHERE id=?`).run(amount, o.id);
  addEvent(o.id, o.status, `Refunded ₹${amount / 100} (ref ${r.id})`, req.admin.name);
  audit(req.admin.id, 'order.refund', 'order', o.number, `${amount} ${r.id}`);
  res.json(orderDetail(findOrder(o.number)));
}));

// ---- Returns ----

router.get('/returns', (req, res) => {
  const status = String(req.query.status || '');
  const rows = db.prepare(`SELECT r.*, o.number order_number, o.customer_name, o.phone, o.payment_method
    FROM returns r JOIN orders o ON o.id = r.order_id ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.id DESC LIMIT 200`).all(...(status ? [status] : []));
  res.json(rows.map((r) => {
    const items = JSON.parse(r.items).map((i) => ({ ...i, ...db.prepare('SELECT product_name, color, size, unit_price_paise FROM order_items WHERE id = ?').get(i.itemId) }));
    return { ...r, items };
  }));
});

/**
 * Return flow: requested -> approved (arrange pickup) -> received (inspected) -> refunded | exchanged
 *              requested -> rejected
 */
const RETURN_FLOW = { approve: ['requested', 'approved'], reject: ['requested', 'rejected'], receive: ['approved', 'received'] };

router.post('/returns/:number/action', wrap(async (req, res) => {
  const r = db.prepare('SELECT * FROM returns WHERE number = ?').get(String(req.params.number));
  if (!r) throw new UserError('Return not found.', 404);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(r.order_id);
  const action = String(req.body?.action);
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const by = req.admin.name;

  if (RETURN_FLOW[action]) {
    const [from, to] = RETURN_FLOW[action];
    if (r.status !== from) throw new UserError(`This return is "${r.status}", so it can't be ${action}d.`);
    db.prepare(`UPDATE returns SET status=?, admin_note=?, updated_at=datetime('now') WHERE id=?`).run(to, note || r.admin_note, r.id);
    if (action === 'receive' && req.body?.restock !== false) restockReturn(r);
    addEvent(order.id, order.status, `Return ${r.number} ${to}${note ? ': ' + note : ''}`, by);
  } else if (action === 'refund') {
    if (!can(req.admin, 'refunds')) throw new UserError('Your role doesn’t allow refunds. Ask the owner or a manager.', 403);
    if (r.type !== 'refund' || r.status !== 'received') throw new UserError('Refund only after the item is received and inspected.');
    const amount = Math.round(Number(req.body?.amount ?? r.refund_paise / 100) * 100);
    if (!(amount > 0) || amount > r.refund_paise) throw new UserError('Refund amount must be more than 0 and no more than the item value.');
    let ref = String(req.body?.reference || '').trim();
    if (order.payment_method === 'prepaid') {
      ref = (await refundPayment(order.razorpay_payment_id, amount, { return: r.number })).id;
    } else if (!ref) {
      throw new UserError(`Send ₹${amount / 100} to ${r.refund_upi} by UPI, then enter the UPI transaction reference here.`);
    }
    tx(() => {
      db.prepare(`UPDATE returns SET status='refunded', refund_paise=?, refund_ref=?, admin_note=?, updated_at=datetime('now') WHERE id=?`).run(amount, ref, note || r.admin_note, r.id);
      db.prepare('UPDATE orders SET refunded_paise = refunded_paise + ? WHERE id = ?').run(amount, order.id);
      const fully = db.prepare('SELECT refunded_paise >= total_paise AS f FROM orders WHERE id = ?').get(order.id).f;
      if (order.payment_method === 'prepaid') db.prepare(`UPDATE orders SET payment_status=? WHERE id=?`).run(fully ? 'refunded' : 'partially_refunded', order.id);
    });
    addEvent(order.id, order.status, `Refund of ₹${amount / 100} for return ${r.number} sent (ref ${ref})`, by);
  } else if (action === 'exchange') {
    if (r.type !== 'exchange' || r.status !== 'received') throw new UserError('Mark the exchange done only after the returned item is received.');
    db.prepare(`UPDATE returns SET status='exchanged', refund_ref=?, admin_note=?, updated_at=datetime('now') WHERE id=?`)
      .run(String(req.body?.reference || ''), note || r.admin_note, r.id);
    addEvent(order.id, order.status, `Exchange for return ${r.number} sent${req.body?.reference ? ' (AWB ' + req.body.reference + ')' : ''}`, by);
  } else {
    throw new UserError('Unknown action.');
  }
  audit(req.admin.id, `return.${action}`, 'return', r.number, note);
  notifyReturn(r.number, { approve: 'approved', reject: 'rejected', receive: 'received', refund: 'refunded', exchange: 'exchanged' }[action]);
  res.json({ ok: true });
}));

// ---- Enquiries ----

router.get('/enquiries', (req, res) => res.json(db.prepare('SELECT * FROM enquiries ORDER BY id DESC LIMIT 200').all()));
router.post('/enquiries/:id', (req, res) => {
  const status = ['new', 'contacted', 'won', 'lost'].includes(req.body?.status) ? req.body.status : 'contacted';
  db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

// ---- Money ledger (settlements from gateway, COD remittances from courier) ----

router.get('/ledger', (req, res) => res.json(db.prepare('SELECT * FROM ledger ORDER BY entry_date DESC, id DESC LIMIT 300').all()));
router.post('/ledger', (req, res) => {
  const kind = String(req.body?.kind);
  const amount = Math.round(Number(req.body?.amount) * 100);
  const date = String(req.body?.date || '').slice(0, 10);
  if (!['gateway_settlement', 'cod_remittance', 'adjustment'].includes(kind)) throw new UserError('Choose an entry type.');
  if (!Number.isFinite(amount) || amount === 0) throw new UserError('Enter an amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError('Enter the date.');
  db.prepare('INSERT INTO ledger (kind, amount_paise, reference, note, entry_date) VALUES (?, ?, ?, ?, ?)').run(
    kind, amount, String(req.body?.reference || '').slice(0, 80), String(req.body?.note || '').slice(0, 300), date);
  audit(req.admin.id, 'ledger.add', 'ledger', kind, `${amount}`);
  res.json({ ok: true });
});
router.delete('/ledger/:id', requireOwner, (req, res) => {
  db.prepare('DELETE FROM ledger WHERE id = ?').run(Number(req.params.id));
  audit(req.admin.id, 'ledger.delete', 'ledger', req.params.id);
  res.json({ ok: true });
});

// ---- Settings & staff (owner only for changes) ----

// ---- Customers (accounts) ----

router.get('/customers', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT c.id, c.name, c.phone, c.email, c.created_at, c.last_login_at,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('pending_payment','cancelled')) AS orders,
      (SELECT COALESCE(SUM(o.total_paise - o.refunded_paise), 0) FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('pending_payment','cancelled')) AS spent
    FROM customers c WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? ORDER BY c.id DESC LIMIT 300`).all(q, q, q));
});

// ---- Emails ----

router.get('/emails', (req, res) => res.json(db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 100').all()));
router.post('/emails/test', wrap(async (req, res) => {
  const to = String(req.body?.to || '').trim();
  if (!mailLive()) throw new UserError('Email is not set up yet. Add SMTP_HOST, SMTP_USER and SMTP_PASS to the .env file and restart the server.');
  const ok = await sendMail({ to, kind: 'test', subject: 'Test email from your store', text: 'Email is working. Order emails will be sent from this address.',
    html: '<p>Email is working. Order emails will be sent from this address.</p>' });
  if (!ok) throw new UserError('The test email failed. Check the email log below for the reason.');
  res.json({ ok: true });
}));

// ---- Coupons ----

const COUPON_COLS = `c.*, (SELECT COUNT(*) FROM orders o WHERE o.coupon_code = c.code AND o.status != 'cancelled') AS used,
  (SELECT COALESCE(SUM(o.discount_paise), 0) FROM orders o WHERE o.coupon_code = c.code AND o.status != 'cancelled') AS discount_given`;

function couponFields(b) {
  const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new UserError('Code must be 3–20 letters or numbers, e.g. DIWALI10.');
  const kind = b.kind === 'flat' ? 'flat' : 'percent';
  const raw = Number(b.value);
  if (kind === 'percent' && !(raw >= 1 && raw <= 90)) throw new UserError('Percent off must be between 1 and 90.');
  if (kind === 'flat' && !(raw > 0)) throw new UserError('Enter the rupees off.');
  const date = (d) => { const v = String(d || '').slice(0, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError('Dates must be in YYYY-MM-DD format.'); return v; };
  const f = {
    code, kind, value: kind === 'percent' ? Math.round(raw) : Math.round(raw * 100),
    min_order_paise: Math.max(0, Math.round(Number(b.minOrder || 0) * 100)),
    max_discount_paise: kind === 'percent' ? Math.max(0, Math.round(Number(b.maxDiscount || 0) * 100)) : 0,
    starts_on: date(b.startsOn), ends_on: date(b.endsOn),
    usage_limit: Math.max(0, Math.floor(Number(b.usageLimit) || 0)),
    per_customer_limit: Math.max(0, Math.floor(Number(b.perCustomerLimit ?? 1) || 0)),
    active: b.active === false ? 0 : 1, note: String(b.note || '').slice(0, 200),
  };
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw new UserError('End date is before the start date.');
  return f;
}

router.get('/coupons', (req, res) => res.json(db.prepare(`SELECT ${COUPON_COLS} FROM coupons c ORDER BY c.id DESC`).all()));
router.post('/coupons', (req, res) => {
  const f = couponFields(req.body || {});
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ?').get(f.code)) throw new UserError('A coupon with this code already exists.');
  const keys = Object.keys(f);
  db.prepare(`INSERT INTO coupons (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`).run(f);
  audit(req.admin.id, 'coupon.create', 'coupon', f.code, `${f.kind} ${f.value}`);
  res.json({ ok: true });
});
router.put('/coupons/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!cur) throw new UserError('Coupon not found.', 404);
  const f = couponFields(req.body || {});
  const used = db.prepare(`SELECT COUNT(*) n FROM orders WHERE coupon_code = ?`).get(cur.code).n;
  if (f.code !== cur.code && used) throw new UserError('This code has already been used on orders, so it can’t be renamed. Create a new coupon instead.');
  if (f.code !== cur.code && db.prepare('SELECT 1 FROM coupons WHERE code = ? AND id != ?').get(f.code, id)) throw new UserError('A coupon with this code already exists.');
  db.prepare(`UPDATE coupons SET ${Object.keys(f).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...f, id });
  audit(req.admin.id, 'coupon.update', 'coupon', f.code, `${f.kind} ${f.value} active=${f.active}`);
  res.json({ ok: true });
});
router.delete('/coupons/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM coupons WHERE id = ?').get(Number(req.params.id));
  if (!cur) throw new UserError('Coupon not found.', 404);
  if (db.prepare('SELECT 1 FROM orders WHERE coupon_code = ? LIMIT 1').get(cur.code)) {
    db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(cur.id);
    audit(req.admin.id, 'coupon.deactivate', 'coupon', cur.code);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM coupons WHERE id = ?').run(cur.id);
  audit(req.admin.id, 'coupon.delete', 'coupon', cur.code);
  res.json({ ok: true });
});

// ---- Homepage content (banners, promo tiles, section headings) ----

router.get('/homepage', (req, res) => res.json(getHomepage()));
router.put('/homepage', (req, res) => {
  const data = saveHomepage(req.body);
  audit(req.admin.id, 'homepage.update', 'homepage', '', `${data.banners.length} banners, ${data.promos.length} promos`);
  res.json(data);
});
router.post('/homepage/image', upload.single('image'), (req, res) => {
  if (!req.file) throw new UserError('Choose a JPG, PNG or WebP image up to 5 MB.');
  audit(req.admin.id, 'homepage.image', 'homepage', req.file.filename);
  res.json({ url: `/uploads/${req.file.filename}` });
});

router.get('/settings', (req, res) => res.json(getSettings()));
router.put('/settings', requireOwner, (req, res) => {
  const allowed = Object.keys(getSettings());
  const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [k, v] of Object.entries(req.body || {})) if (allowed.includes(k)) upd.run(String(v).slice(0, 500), k);
  audit(req.admin.id, 'settings.update', 'settings', '', Object.keys(req.body || {}).join(','));
  res.json(getSettings());
});

router.get('/staff', (req, res) => res.json(db.prepare('SELECT id, email, name, role, created_at FROM admins ORDER BY id').all()));
router.post('/staff', requireOwner, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !name) throw new UserError('Enter a name and email.');
  if (password.length < 10) throw new UserError('Temporary password must be at least 10 characters.');
  if (db.prepare('SELECT 1 FROM admins WHERE email = ?').get(email)) throw new UserError('That email already has an account.');
  const role = ['manager', 'orders', 'catalogue'].includes(req.body?.role) ? req.body.role : 'orders';
  db.prepare(`INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, ?)`).run(email, name, hashPassword(password), role);
  audit(req.admin.id, 'staff.add', 'admin', email);
  res.json({ ok: true });
});
router.put('/staff/:id', requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body?.role || '');
  if (!['manager', 'orders', 'catalogue'].includes(role)) throw new UserError('Choose Manager, Orders staff or Catalogue staff.');
  const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!target || target.role === 'owner') throw new UserError('This account’s role can’t be changed.');
  db.prepare('UPDATE admins SET role = ? WHERE id = ?').run(role, id);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(id); // signs them out so the new role applies at once
  audit(req.admin.id, 'staff.role', 'admin', target.email, `${target.role} -> ${role}`);
  res.json({ ok: true });
});

router.delete('/staff/:id', requireOwner, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) throw new UserError("You can't remove your own account.");
  db.prepare(`DELETE FROM admins WHERE id = ? AND role != 'owner'`).run(id);
  audit(req.admin.id, 'staff.remove', 'admin', id);
  res.json({ ok: true });
});

router.get('/audit', (req, res) => res.json(db.prepare(`SELECT l.*, a.name admin_name FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id
  ORDER BY l.id DESC LIMIT 300`).all()));

router.get('/export/orders.csv', (req, res) => {
  const rows = db.prepare(`SELECT number, invoice_no, created_at, customer_name, phone, email, city, state, pincode, payment_method,
    payment_status, status, items_paise, shipping_paise, cod_fee_paise, tax_paise, total_paise, refunded_paise, awb, courier FROM orders ORDER BY id`).all();
  const head = Object.keys(rows[0] || { number: '' });
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.type('text/csv').attachment(`orders-${new Date().toISOString().slice(0, 10)}.csv`)
    .send([head.join(','), ...rows.map((r) => head.map((k) => cell(r[k])).join(','))].join('\n'));
});
