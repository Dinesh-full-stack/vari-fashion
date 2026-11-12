// End-to-end API test in TEST MODE (no Razorpay/Shiprocket keys). Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `store-test-${process.pid}.db`);
let proc;
let cookie = '';

const api = async (method, url, body, { admin = false } = {}) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const customer = { name: 'Test Buyer', phone: '9876543210', email: 'buyer@example.com', line1: '12 Test Street', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' };

before(async () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
  proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: 'test-password-123', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', SHIPROCKET_EMAIL: '', RATE_LIMIT_MULTIPLIER: '20' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(BASE + '/api/config')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
});

after(() => { proc?.kill(); });

test('full order lifecycle', async () => {
  const products = (await api('GET', '/api/products')).data;
  const variant = products.flatMap((p) => p.variants).find((v) => v.available);
  assert.ok(variant, 'some variant in stock');

  // Over the per-item cap is refused with a pointer to bulk enquiries
  const big = await api('POST', '/api/checkout', { items: [{ variantId: variant.id, qty: 11 }], customer, paymentMethod: 'cod' });
  assert.equal(big.status, 400);
  assert.match(big.data.error, /bulk|left/i);

  // COD order is confirmed straight away
  const cod = await api('POST', '/api/checkout', { items: [{ variantId: variant.id, qty: 1 }], customer, paymentMethod: 'cod' });
  assert.equal(cod.status, 200, JSON.stringify(cod.data));
  assert.equal(cod.data.payment.mode, 'cod');

  // Prepaid order waits for payment, then test-mode payment confirms it
  const pre = await api('POST', '/api/checkout', { items: [{ variantId: variant.id, qty: 1 }], customer, paymentMethod: 'prepaid' });
  assert.equal(pre.data.payment.mode, 'mock');
  const paid = await api('POST', '/api/payment/mock-complete', { number: pre.data.order.number });
  assert.equal(paid.data.status, 'confirmed');

  // Tracking needs the matching phone number
  assert.equal((await api('POST', '/api/track', { number: pre.data.order.number, phone: '9000000000' })).status, 404);
  const tr = await api('POST', '/api/track', { number: pre.data.order.number, phone: customer.phone });
  assert.equal(tr.data.status, 'confirmed');
  assert.ok(tr.data.invoiceUrl);

  // Admin: login, ship (test courier), deliver
  assert.equal((await api('GET', '/api/admin/dashboard', null, { admin: true })).status, 401);
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
  const shipped = await api('POST', `/api/admin/orders/${pre.data.order.number}/ship`, {}, { admin: true });
  assert.equal(shipped.data.status, 'shipped', JSON.stringify(shipped.data));
  assert.match(shipped.data.awb, /^TEST/);
  const bad = await api('POST', `/api/admin/orders/${pre.data.order.number}/status`, { status: 'packed' }, { admin: true });
  assert.equal(bad.status, 400, 'cannot go backwards');
  const delivered = await api('POST', `/api/admin/orders/${pre.data.order.number}/status`, { status: 'delivered' }, { admin: true });
  assert.equal(delivered.data.status, 'delivered');

  // Customer requests a refund return; admin approves, receives (restocks) and refunds
  const itemId = tr.data.items[0].id;
  const ret = await api('POST', '/api/returns', { number: pre.data.order.number, phone: customer.phone, type: 'refund', reason: 'Too small', items: [{ itemId, qty: 1 }] });
  assert.equal(ret.status, 200, JSON.stringify(ret.data));
  const dup = await api('POST', '/api/returns', { number: pre.data.order.number, phone: customer.phone, type: 'refund', reason: 'again', items: [{ itemId, qty: 1 }] });
  assert.equal(dup.status, 400, 'cannot return the same item twice');
  for (const action of ['approve', 'receive', 'refund']) {
    const r = await api('POST', `/api/admin/returns/${ret.data.number}/action`, { action }, { admin: true });
    assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`);
  }
  const detail = await api('GET', `/api/admin/orders/${pre.data.order.number}`, null, { admin: true });
  assert.equal(detail.data.payment_status, 'refunded');

  // Dashboard numbers reflect the activity
  const dash = await api('GET', '/api/admin/dashboard', null, { admin: true });
  assert.equal(dash.data.sales.orders, 2);
  assert.ok(dash.data.sales.refunded > 0);
});

test('stock cannot oversell', async () => {
  const products = (await api('GET', '/api/products')).data;
  const v = products.flatMap((p) => p.variants).find((x) => x.low === 2);
  if (!v) return; // seed data may not have a variant with exactly 2 left
  const orders = await Promise.all([1, 2, 3].map(() =>
    api('POST', '/api/checkout', { items: [{ variantId: v.id, qty: 1 }], customer, paymentMethod: 'cod' })));
  assert.equal(orders.filter((o) => o.status === 200).length, 2);
});

test('homepage content is editable from admin and sanitised', async () => {
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
  const current = (await api('GET', '/api/admin/homepage', null, { admin: true })).data;
  assert.ok(current.banners.length >= 1);
  current.topStrip = 'Diwali sale · Free shipping';
  current.banners[0].title = 'Diwali sale';
  current.banners[0].link = 'javascript:alert(1)';
  current.banners[0].image = '/etc/passwd';
  const saved = await api('PUT', '/api/admin/homepage', current, { admin: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.banners[0].link, '/shop', 'unsafe link replaced');
  assert.equal(saved.data.banners[0].image, '', 'image outside uploads rejected');
  const pub = (await api('GET', '/api/homepage')).data;
  assert.equal(pub.banners[0].title, 'Diwali sale');
  assert.equal((await api('GET', '/api/config')).data.topStrip, 'Diwali sale · Free shipping');
  const none = await api('PUT', '/api/admin/homepage', { ...current, banners: [] }, { admin: true });
  assert.equal(none.status, 400, 'needs at least one banner');
});

test('coupons: apply, limits, discount on order and refund', async () => {
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
  const made = await api('POST', '/api/admin/coupons', { code: 'test10', kind: 'percent', value: 10, minOrder: 100, perCustomerLimit: 1 }, { admin: true });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal((await api('POST', '/api/admin/coupons', { code: 'TEST10', kind: 'percent', value: 10 }, { admin: true })).status, 400, 'duplicate code');

  const products = (await api('GET', '/api/products')).data;
  const v = products.flatMap((p) => p.variants.map((x) => ({ ...x, price: p.price }))).find((x) => x.available && x.low === null);
  const items = [{ variantId: v.id, qty: 1 }];
  const buyer = { ...customer, phone: '9123456780' };

  const bad = (await api('POST', '/api/bag/quote', { items, couponCode: 'NOPE' })).data;
  assert.equal(bad.discountPaise, 0);
  assert.match(bad.couponError, /not valid/);
  const good = (await api('POST', '/api/bag/quote', { items, couponCode: 'test10' })).data;
  assert.equal(good.discountPaise, Math.floor(v.price * 0.1));

  const order = await api('POST', '/api/checkout', { items, customer: buyer, paymentMethod: 'cod', couponCode: 'TEST10' });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  const again = await api('POST', '/api/checkout', { items, customer: buyer, paymentMethod: 'cod', couponCode: 'TEST10' });
  assert.equal(again.status, 400, 'one use per customer');
  assert.match(again.data.error, /already used/);

  const n = order.data.order.number;
  const detail = (await api('GET', `/api/admin/orders/${n}`, null, { admin: true })).data;
  assert.equal(detail.discount_paise, Math.floor(v.price * 0.1));
  assert.equal(detail.coupon_code, 'TEST10');

  // deliver, return, and check the refund excludes the coupon share
  await api('POST', `/api/admin/orders/${n}/ship`, {}, { admin: true });
  await api('POST', `/api/admin/orders/${n}/status`, { status: 'delivered' }, { admin: true });
  const tr = (await api('POST', '/api/track', { number: n, phone: buyer.phone })).data;
  const ret = await api('POST', '/api/returns', { number: n, phone: buyer.phone, type: 'refund', reason: 'Too big', items: [{ itemId: tr.items[0].id, qty: 1 }], refundUpi: 'buyer@upi' });
  assert.equal(ret.status, 200, JSON.stringify(ret.data));
  const r = (await api('GET', '/api/admin/returns', null, { admin: true })).data.find((x) => x.number === ret.data.number);
  assert.equal(r.refund_paise, v.price - Math.floor(v.price * 0.1));

  const list = (await api('GET', '/api/admin/coupons', null, { admin: true })).data;
  assert.equal(list.find((c) => c.code === 'TEST10').used, 1);
});

test('size chart saved per product', async () => {
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
  const p = (await api('GET', '/api/admin/products', null, { admin: true })).data[0];
  const body = { ...p, price: p.price / 100, mrp: p.mrp / 100, variants: p.variants.map((v) => ({ ...v, colorHex: p.colors.find((c) => c.name === v.color).hex })),
    sizeChart: 'Size\tChest (in)\tLength (in)\nS\t38\t27\nM\t40\t28' };
  const saved = await api('PUT', `/api/admin/products/${p.id}`, body, { admin: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const pub = (await api('GET', `/api/products/${p.slug}`)).data;
  assert.deepEqual(pub.sizeChart.header, ['Size', 'Chest (in)', 'Length (in)']);
  assert.equal(pub.sizeChart.rows.length, 2);
});

test('order emails are triggered at each step (logged as skipped without SMTP)', async () => {
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
  assert.equal((await api('PUT', '/api/admin/settings', { order_alert_email: 'owner@test.local' }, { admin: true })).status, 200);
  const products = (await api('GET', '/api/products')).data;
  const v = products.flatMap((p) => p.variants).find((x) => x.available && x.low === null);
  const o = await api('POST', '/api/checkout', { items: [{ variantId: v.id, qty: 1 }], customer: { ...customer, phone: '9988776655', email: 'mail@test.local' }, paymentMethod: 'cod' });
  const n = o.data.order.number;
  await api('POST', `/api/admin/orders/${n}/ship`, {}, { admin: true });
  await api('POST', `/api/admin/orders/${n}/status`, { status: 'delivered' }, { admin: true });
  await new Promise((r) => setTimeout(r, 300)); // emails are sent in the background
  const log = (await api('GET', '/api/admin/emails', null, { admin: true })).data.filter((m) => m.ref === n);
  const kinds = log.map((m) => m.kind).sort();
  assert.deepEqual(kinds, ['new_order_alert', 'order_confirmed', 'order_delivered', 'order_shipped']);
  assert.ok(log.every((m) => m.status === 'skipped'));
  assert.ok(log.find((m) => m.kind === 'order_confirmed').to_addr === 'mail@test.local');
});

test('customer accounts: sign up and log in with an emailed code, orders linked', async () => {
  let jar = '';
  const call = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(jar ? { Cookie: jar } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) jar = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const person = { name: 'Asha K', phone: '9012345678', email: 'asha@test.local' };

  assert.equal((await call('GET', '/api/account/me')).data, null, 'guest');
  const start = await call('POST', '/api/account/signup', person);
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.match(start.data.devCode, /^\d{6}$/, 'test mode returns the code');
  const wrong = await call('POST', '/api/account/verify', { email: person.email, code: start.data.devCode === '000000' ? '111111' : '000000', purpose: 'signup' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /4 tries left/);
  const ok = await call('POST', '/api/account/verify', { email: person.email, code: start.data.devCode, purpose: 'signup' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await call('GET', '/api/account/me')).data.email, person.email);
  assert.equal((await call('POST', '/api/account/verify', { email: person.email, code: start.data.devCode, purpose: 'signup' })).status, 400, 'code works once');
  assert.equal((await call('POST', '/api/account/signup', person)).status, 400, 'duplicate account');

  // Order while logged in -> appears in My orders, address remembered
  const products = (await api('GET', '/api/products')).data;
  const v = products.flatMap((p) => p.variants).find((x) => x.available && x.low === null);
  const order = await call('POST', '/api/checkout', { items: [{ variantId: v.id, qty: 1 }], customer: { ...customer, ...person }, paymentMethod: 'cod' });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  const mine = (await call('GET', '/api/account/orders')).data;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].number, order.data.order.number);
  assert.equal((await call('GET', '/api/account/me')).data.address.pincode, customer.pincode);
  const detail = await call('GET', `/api/account/orders/${order.data.order.number}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.phone, person.phone);

  // Someone else's order is not visible
  const other = await api('POST', '/api/checkout', { items: [{ variantId: v.id, qty: 1 }], customer: { ...customer, phone: '9333333333' }, paymentMethod: 'cod' });
  assert.equal((await call('GET', `/api/account/orders/${other.data.order.number}`)).status, 404);

  // Log out, log back in
  await call('POST', '/api/account/logout', {});
  assert.equal((await call('GET', '/api/account/me')).data, null);
  assert.equal((await call('POST', '/api/account/login', { email: 'nobody@test.local' })).status, 400);
  const login = await call('POST', '/api/account/login', { email: person.email });
  const back = await call('POST', '/api/account/verify', { email: person.email, code: login.data.devCode, purpose: 'login' });
  assert.equal(back.status, 200);
  assert.equal((await call('GET', '/api/account/orders')).data.length, 1);
});

test('staff roles: each role is limited to its own pages', async () => {
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
  for (const role of ['orders', 'catalogue', 'manager']) {
    const r = await api('POST', '/api/admin/staff', { name: role, email: `${role}@test.local`, password: 'staff-password-1', role }, { admin: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const as = async (role) => { cookie = ''; assert.equal((await api('POST', '/api/admin/login', { email: `${role}@test.local`, password: 'staff-password-1' })).status, 200); };
  const code = async (method, url, body) => (await api(method, url, body ?? (method === 'GET' ? null : {}), { admin: true })).status;

  await as('orders');
  assert.equal(await code('GET', '/api/admin/orders'), 200);
  assert.equal(await code('GET', '/api/admin/returns'), 200);
  assert.equal(await code('GET', '/api/admin/products'), 403);
  assert.equal(await code('GET', '/api/admin/settings'), 403);
  assert.equal(await code('GET', '/api/admin/ledger'), 403);
  assert.equal(await code('GET', '/api/admin/export/orders.csv'), 403);
  const dash = (await api('GET', '/api/admin/dashboard', null, { admin: true })).data;
  assert.equal(dash.showSales, false);
  assert.equal(dash.money, null, 'no money figures for orders staff');

  await as('catalogue');
  assert.equal(await code('GET', '/api/admin/products'), 200);
  assert.equal(await code('GET', '/api/admin/homepage'), 200);
  assert.equal(await code('GET', '/api/admin/orders'), 403);
  assert.equal(await code('GET', '/api/admin/coupons'), 403);

  await as('manager');
  assert.equal(await code('GET', '/api/admin/orders'), 200);
  assert.equal(await code('GET', '/api/admin/coupons'), 200);
  assert.equal(await code('GET', '/api/admin/customers'), 200);
  assert.equal(await code('GET', '/api/admin/settings'), 200);
  assert.equal(await code('PUT', '/api/admin/settings', { brand_name: 'X' }), 403);
  assert.equal(await code('GET', '/api/admin/staff'), 403);

  cookie = '';
  assert.equal((await api('POST', '/api/admin/login', { email: 'owner@test.local', password: 'test-password-123' })).status, 200);
});
