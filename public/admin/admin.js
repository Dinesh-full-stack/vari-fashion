// Admin panel: a small hash-routed app over /api/admin.

const root = document.getElementById('root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const short = (p) => { const r = p / 100; return r >= 1e7 ? `₹${(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `₹${(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `₹${(r / 1e3).toFixed(r >= 1e4 ? 0 : 1)}k` : `₹${r}`; };
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const when = (d) => d ? new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const day = (d) => d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch('/api/admin' + path, {
    method,
    headers: form ? { 'X-Requested-With': 'fetch' } : body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { me = null; renderLogin(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let toastEl;
function toast(msg) {
  toastEl ||= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toast', role: 'status' });
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastEl.t);
  toastEl.t = setTimeout(() => toastEl.classList.remove('on'), 2600);
}
const errMsg = (el, e) => { el.innerHTML = e ? `<div class="msg err">${esc(e.message || e)}</div>` : ''; };

/**
 * Shrinks a photo in the browser before upload: longest side at most `max` px, saved as WebP (JPEG if the
 * browser can't make WebP). A 5 MB phone photo usually becomes 150–400 KB, so the shop stays fast on mobile data.
 */
async function shrinkImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // PNG transparency becomes white
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
    const out = blob && blob.type === 'image/webp' ? blob : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!out || out.size >= file.size) return file; // already small
    return new File([out], file.name.replace(/\.\w+$/, out.type === 'image/webp' ? '.webp' : '.jpg'), { type: out.type });
  } catch { return file; }
}

const STATUS = {
  pending_payment: ['Awaiting payment', 'warn'], confirmed: ['Confirmed', 'info'], packed: ['Packed', 'info'], shipped: ['Shipped', 'info'],
  delivered: ['Delivered', 'ok'], rto: ['Returned (RTO)', 'err'], cancelled: ['Cancelled', ''],
};
const PAY = { pending: ['Unpaid', 'warn'], paid: ['Paid', 'ok'], failed: ['Failed', 'err'], cod_pending: ['COD due', 'warn'], cod_collected: ['COD collected', 'ok'],
  refunded: ['Refunded', ''], partially_refunded: ['Part refunded', 'info'], paid_needs_refund: ['Refund needed', 'err'] };
const RET = { requested: ['Requested', 'warn'], approved: ['Approved', 'info'], received: ['Received', 'info'], refunded: ['Refunded', 'ok'], exchanged: ['Exchanged', 'ok'], rejected: ['Rejected', ''] };
const pill = (map, k) => { const [l, c] = map[k] || [k, '']; return `<span class="pill ${c}">${esc(l)}</span>`; };

let me = null;
let counts = {};

// ---------------- Login ----------------
function renderLogin() {
  root.innerHTML = `<div class="login"><form data-login>
    <h1>Admin</h1>
    <label class="f">Email<input name="email" type="email" autocomplete="username" required></label>
    <label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label>
    <div data-err></div>
    <button class="btn" style="justify-content:center;min-height:42px">Sign in</button>
    <a href="/" class="muted" style="text-align:center;font-size:13px">← Back to the store</a>
  </form></div>`;
  $('[data-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      me = await api('/me');
      shell(); route();
    } catch (ex) { errMsg($('[data-err]'), ex); }
  });
}

// ---------------- Shell ----------------
const NAV = [
  ['dashboard', 'Dashboard'], ['orders', 'Orders', 'toShip'], ['returns', 'Returns', 'pendingReturns'], ['products', 'Products'], ['homepage', 'Homepage'], ['coupons', 'Coupons'],
  ['enquiries', 'Bulk enquiries', 'newEnquiries'], ['money', 'Money'], ['settings', 'Settings'], ['staff', 'Staff & security'], ['activity', 'Activity log'],
];

function shell() {
  root.innerHTML = `<div class="app">
    <nav class="side" data-side aria-label="Admin">
      <div class="brand" data-brand>Admin</div>
      ${NAV.map(([k, l, c]) => `<a href="#${k}" data-nav="${k}">${l}${c ? `<span class="badge" data-count="${c}" hidden></span>` : ''}</a>`).join('')}
      <div class="grow"></div>
      <a href="/" target="_blank">View store ↗</a>
      <div class="me">${esc(me.name)} · ${esc(me.role)}<br><button data-logout>Sign out</button></div>
    </nav>
    <div class="main">
      <div class="topbar"><div class="actions"><button class="btn sec menu-toggle" data-menu>☰</button><h1 data-title></h1></div>
        <div class="actions">${!me.paymentsLive ? '<span class="mode">Payments: test mode</span>' : ''}${!me.shippingLive ? '<span class="mode">Shipping: test mode</span>' : ''}</div></div>
      <div data-view></div>
    </div></div>`;
  $('[data-logout]').onclick = async () => { await api('/logout', { method: 'POST', body: {} }).catch(() => {}); me = null; renderLogin(); };
  $('[data-menu]').onclick = () => $('[data-side]').classList.toggle('open');
  fetch('/api/config').then((r) => r.json()).then((c) => { $('[data-brand]').textContent = c.brand; document.title = `Admin — ${c.brand}`; });
}

async function refreshCounts() {
  try {
    const d = await api('/dashboard?days=7');
    counts = d.actions;
    $$('[data-count]').forEach((b) => { const n = counts[b.dataset.count] || 0; b.textContent = n; b.hidden = !n; });
  } catch { /* ignore */ }
}

const view = () => $('[data-view]');
const title = (t) => { $('[data-title]').textContent = t; };

async function route() {
  if (!me) return renderLogin();
  const [name, arg] = (location.hash.slice(1) || 'dashboard').split('/');
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name || (name === 'order' && a.dataset.nav === 'orders') || (name === 'product' && a.dataset.nav === 'products')));
  $('[data-side]')?.classList.remove('open');
  view().innerHTML = '<p class="muted">Loading…</p>';
  const pages = { dashboard, orders, order, products, product, homepage, coupons, returns, enquiries, money: moneyPage, settings, staff, activity };
  try { await (pages[name] || dashboard)(decodeURIComponent(arg || '')); }
  catch (e) { if (e.message !== 'Signed out') view().innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  refreshCounts();
}
addEventListener('hashchange', route);

// ---------------- Dashboard ----------------
async function dashboard() {
  title('Dashboard');
  const days = Number(sessionStorage.getItem('dash.days') || 30);
  const d = await api(`/dashboard?days=${days}`);
  const a = d.actions;
  view().innerHTML = `
    <div class="tiles">
      ${actionTile('Ready to ship', a.toShip, '#orders?status=to_ship', a.toShip > 0)}
      ${actionTile('Returns to handle', a.pendingReturns, '#returns', a.pendingReturns > 0)}
      ${actionTile('Refunds needed', a.needsRefund, '#orders?status=needs_refund', a.needsRefund > 0)}
      ${actionTile('In transit', a.inTransit, '#orders?status=shipped')}
      ${actionTile('Awaiting payment', a.awaitingPayment, '#orders?status=pending_payment')}
      ${actionTile('New bulk enquiries', a.newEnquiries, '#enquiries', a.newEnquiries > 0)}
    </div>

    <div class="panel">
      <div class="panel-head"><div><h2>Sales</h2><p>Orders placed in the last ${d.days} days (excludes unpaid and cancelled)</p></div>
        <div class="actions">${[7, 30, 90].map((n) => `<button class="btn small ${n === d.days ? '' : 'sec'}" data-days="${n}">${n} days</button>`).join('')}</div></div>
      <div class="tiles" style="margin-bottom:8px">
        ${tile('Net sales', money(d.sales.net), `${money(d.sales.gross)} gross − ${money(d.sales.refunded)} refunded`)}
        ${tile('Orders', d.sales.orders, `Avg order ${money(d.sales.aov)}`)}
        ${tile('Cash on delivery share', pct(d.sales.codShare), 'of orders')}
        ${tile('RTO rate', pct(d.rates.rto), `${d.rates.rtoCount} parcels refused or returned`)}
        ${tile('Return rate', pct(d.rates.returns), `of ${d.rates.delivered} delivered orders`)}
      </div>
      ${salesChart(d.daily, d.days)}
    </div>

    <div class="grid cols-2">
      <div class="panel">
        <div class="panel-head"><div><h2>Money due to you (estimate)</h2><p>Not your bank balance. Each line comes from a different source.</p></div><a class="btn small sec" href="#money">Record a payout</a></div>
        <div class="money-line"><span>Waiting at payment gateway</span><b>${money(d.money.gatewayPending)}</b>
          <span class="src">Prepaid sales − refunds − estimated fees (${d.money.feeRatePct}%, ${money(d.money.gatewayFees)}) − settlements you recorded. Last settlement recorded: ${day(d.money.lastSettlement)}. Check the Razorpay dashboard for the exact figure.</span></div>
        <div class="money-line"><span>COD cash held by courier</span><b>${money(d.money.codPending)}</b>
          <span class="src">Delivered COD orders − COD remittances you recorded. Shiprocket deducts freight and RTO charges before paying out. Last remittance recorded: ${day(d.money.lastRemit)}.</span></div>
        <div class="money-line"><span>Refunds you still owe</span><b style="color:var(--err)">−${money(d.money.refundsOwed)}</b>
          <span class="src">Approved or received returns not yet refunded, plus paid orders that need a refund.</span></div>
        <div class="money-line"><span>Paid out to your bank so far</span><b>${money(d.money.paidToBank)}</b>
          <span class="src">Sum of settlements and remittances recorded on the Money page.</span></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Low stock</h2><a class="btn small sec" href="#products">Update stock</a></div>
        ${d.lowStock.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Product</th><th>Variant</th><th class="num">Left</th></tr></thead><tbody>
          ${d.lowStock.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.color)} / ${esc(s.size)}</td><td class="num">${s.stock === 0 ? '<span class="pill err">0</span>' : s.stock}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">Everything has more than 3 in stock.</p>'}
        <h2 style="margin-top:20px">Top products (${d.days} days)</h2>
        ${d.topProducts.length ? `<table class="t"><tbody>${d.topProducts.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.units} sold</td><td class="num">${money(t.sales)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sales yet.</p>'}
      </div>
    </div>`;
  $$('[data-days]').forEach((b) => { b.onclick = () => { sessionStorage.setItem('dash.days', b.dataset.days); dashboard(); }; });
  bindChart();
}

const tile = (k, v, s = '') => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;
const actionTile = (k, v, href, alert = false) => `<a class="tile ${alert ? 'alert' : ''}" href="${href}"><div class="k">${esc(k)}</div><div class="v">${v}</div></a>`;

/** Daily sales: single-series bar chart with hover tooltips and a table view. */
function salesChart(rows, days) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const data = [];
  const now = new Date(Date.now() + 330 * 60000); // IST
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    data.push({ day: dt, sales: byDay.get(dt)?.sales || 0, orders: byDay.get(dt)?.orders || 0 });
  }
  const W = 1000, H = 240, padL = 52, padB = 26, padT = 8;
  const max = Math.max(1, ...data.map((x) => x.sales));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const bw = (W - padL) / data.length;
  const gap = Math.max(2, bw * 0.25);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const labelEvery = Math.ceil(data.length / 8);
  const bars = data.map((x, i) => {
    const bx = padL + i * bw + gap / 2, w = Math.max(1, bw - gap), by = y(x.sales), h = H - padB - by;
    const r = Math.min(4, w / 2, h);
    const path = h <= 0 ? '' : `M${bx},${H - padB} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + w - r} Q${bx + w},${by} ${bx + w},${by + r} V${H - padB} Z`;
    return `<rect class="bar-hit" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" data-i="${i}"></rect><path class="bar" d="${path}"></path>`;
  }).join('');
  window.__chart = data;
  return `<div class="chart" data-chart>
    <div class="actions" style="justify-content:flex-end;margin-bottom:6px"><button class="btn small sec" data-chart-table>Show as table</button></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily sales for the last ${days} days. Highest day ${money(max)}.">
      ${ticks.map((t) => `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line><text class="axis" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('')}
      ${bars}
      ${data.map((x, i) => (i % labelEvery === 0 ? `<text class="axis" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${day(x.day)}</text>` : '')).join('')}
    </svg>
    <div class="tip" data-tip></div>
    <div class="table-wrap" data-chart-tbl hidden><table class="t"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Sales</th></tr></thead>
      <tbody>${[...data].reverse().map((x) => `<tr><td>${day(x.day)}</td><td class="num">${x.orders}</td><td class="num">${money(x.sales)}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function bindChart() {
  const c = $('[data-chart]');
  if (!c) return;
  const tip = $('[data-tip]', c);
  const svg = $('svg', c);
  svg.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.bar-hit');
    $$('.bar.hl', svg).forEach((b) => b.classList.remove('hl'));
    if (!hit) { tip.classList.remove('on'); return; }
    const x = window.__chart[Number(hit.dataset.i)];
    hit.nextElementSibling.classList.add('hl');
    const box = c.getBoundingClientRect();
    tip.innerHTML = `${day(x.day)}<br><b>${money(x.sales)}</b> · ${x.orders} order${x.orders === 1 ? '' : 's'}`;
    tip.style.left = `${e.clientX - box.left}px`;
    tip.style.top = `${e.clientY - box.top}px`;
    tip.classList.add('on');
  });
  svg.addEventListener('mouseleave', () => { tip.classList.remove('on'); $$('.bar.hl', svg).forEach((b) => b.classList.remove('hl')); });
  $('[data-chart-table]', c).onclick = (e) => {
    const t = $('[data-chart-tbl]', c);
    t.hidden = !t.hidden;
    svg.style.display = t.hidden ? '' : 'none';
    e.target.textContent = t.hidden ? 'Show as table' : 'Show as chart';
  };
}

// ---------------- Orders ----------------
async function orders() {
  title('Orders');
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const status = q.get('status') || '';
  const search = q.get('q') || '';
  const page = Number(q.get('page') || 1);
  const d = await api(`/orders?status=${encodeURIComponent(status)}&q=${encodeURIComponent(search)}&page=${page}`);
  const TABS = [['', 'All'], ['to_ship', 'To ship'], ['pending_payment', 'Awaiting payment'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['rto', 'RTO'], ['cancelled', 'Cancelled'], ['needs_refund', 'Needs refund']];
  view().innerHTML = `<div class="panel">
    <div class="panel-head">
      <div class="tabs">${TABS.map(([k, l]) => `<a href="#orders?status=${k}" class="${k === status ? 'on' : ''}">${l}</a>`).join('')}</div>
      <form class="actions" data-search><input class="inp" name="q" value="${esc(search)}" placeholder="Order no, name, phone, AWB" style="width:240px"><button class="btn sec">Search</button>
        <a class="btn sec" href="/api/admin/export/orders.csv">Export CSV</a></form>
    </div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
      ${d.rows.map((o) => `<tr class="click" data-href="#order/${esc(o.number)}"><td><b>${esc(o.number)}</b>${o.awb ? `<div class="mono muted">${esc(o.awb)}</div>` : ''}</td>
        <td>${when(o.created_at)}</td><td>${esc(o.customer_name)}<div class="muted">${esc(o.city)}, ${esc(o.state)}</div></td>
        <td>${o.payment_method === 'cod' ? 'COD' : 'Prepaid'}<div>${pill(PAY, o.payment_status)}</div></td><td>${pill(STATUS, o.status)}</td><td class="num">${money(o.total_paise)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">No orders here.</td></tr>'}
    </tbody></table></div>
    ${d.total > 50 ? `<div class="actions" style="margin-top:12px">${page > 1 ? `<a class="btn sec small" href="#orders?status=${status}&q=${encodeURIComponent(search)}&page=${page - 1}">← Newer</a>` : ''}
      <span class="muted">Page ${page} of ${Math.ceil(d.total / 50)}</span>${page * 50 < d.total ? `<a class="btn sec small" href="#orders?status=${status}&q=${encodeURIComponent(search)}&page=${page + 1}">Older →</a>` : ''}</div>` : ''}
  </div>`;
  $('[data-search]').onsubmit = (e) => { e.preventDefault(); location.hash = `orders?status=${status}&q=${encodeURIComponent(e.target.q.value)}`; };
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a,button,input,select')) location.hash = row.dataset.href;
});

async function order(number) {
  const o = await api(`/orders/${encodeURIComponent(number)}`);
  title(`Order ${o.number}`);
  const NEXT_LABEL = { packed: 'Mark packed', shipped: 'Mark shipped (manual)', delivered: 'Mark delivered', rto: 'Mark RTO (came back)', cancelled: 'Cancel order', confirmed: 'Mark confirmed' };
  const canShip = ['confirmed', 'packed'].includes(o.status) && !o.awb;
  view().innerHTML = `<div class="grid cols-2" style="grid-template-columns:1.4fr 1fr">
    <div>
      <div class="panel">
        <div class="panel-head"><div class="actions">${pill(STATUS, o.status)} ${pill(PAY, o.payment_status)} <span class="muted">${o.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid'} · ${when(o.created_at)}</span></div>
          ${o.invoiceUrl ? `<a class="btn small sec" href="${esc(o.invoiceUrl)}" target="_blank">Invoice ${esc(o.invoice_no)}</a>` : ''}</div>
        ${o.payment_status === 'paid_needs_refund' ? `<div class="msg err">This order was paid but cannot be fulfilled. Refund ${money(o.total_paise - o.refunded_paise)}. <button class="btn small" data-refund>Refund now</button></div>` : ''}
        <div class="actions" style="margin-bottom:6px">
          ${canShip ? `<button class="btn" data-ship>Create shipment${me.shippingLive ? ' (Shiprocket)' : ' (test)'}</button>` : ''}
          ${o.next.filter((s) => !(s === 'shipped' && canShip)).map((s) => `<button class="btn ${s === 'cancelled' || s === 'rto' ? 'danger' : 'sec'}" data-status="${s}">${NEXT_LABEL[s] || s}</button>`).join('')}
        </div>
        ${canShip ? `<details style="margin-top:8px"><summary class="muted" style="cursor:pointer">Shipped another way? Enter tracking manually</summary>
          <form class="actions" data-awb style="margin-top:8px"><input class="inp" name="courier" placeholder="Courier" style="width:150px"><input class="inp" name="awb" placeholder="AWB / tracking no" style="width:200px"><button class="btn sec">Save & mark shipped</button></form></details>` : ''}
        ${o.awb ? `<p style="margin-top:12px">Courier: <b>${esc(o.courier || '—')}</b> · AWB <span class="mono">${esc(o.awb)}</span></p>` : ''}
        <div data-err></div>
      </div>
      <div class="panel"><h2 style="margin-bottom:10px">Items</h2>
        <table class="t"><thead><tr><th>Item</th><th>SKU</th><th class="num">Qty</th><th class="num">Price</th><th class="num">GST</th></tr></thead><tbody>
        ${o.items.map((i) => `<tr><td>${esc(i.product_name)}<div class="muted">${esc(i.color)} / ${esc(i.size)}</div></td><td class="mono">${esc(i.sku)}</td><td class="num">${i.qty}</td><td class="num">${money(i.unit_price_paise * i.qty)}</td><td class="num">${i.gst_rate}%</td></tr>`).join('')}
        ${o.discount_paise ? `<tr><td colspan="3">Coupon <b>${esc(o.coupon_code)}</b></td><td class="num" style="color:var(--ok)">−${money(o.discount_paise)}</td><td></td></tr>` : ''}
        <tr><td colspan="3">Shipping${o.cod_fee_paise ? ' + COD fee' : ''}</td><td class="num">${money(o.shipping_paise + o.cod_fee_paise)}</td><td></td></tr>
        <tr><td colspan="3"><b>Total</b> <span class="muted">(GST included: ${money(o.tax_paise)})</span></td><td class="num"><b>${money(o.total_paise)}</b></td><td></td></tr>
        ${o.refunded_paise ? `<tr><td colspan="3">Refunded</td><td class="num" style="color:var(--err)">−${money(o.refunded_paise)}</td><td></td></tr>` : ''}
        </tbody></table></div>
      ${o.returns.length ? `<div class="panel"><h2>Returns</h2>${o.returns.map((r) => `<p><a href="#returns">${esc(r.number)}</a> · ${r.type} · ${pill(RET, r.status)} ${r.refund_paise ? money(r.refund_paise) : ''}</p>`).join('')}</div>` : ''}
    </div>
    <div>
      <div class="panel"><h2 style="margin-bottom:8px">Customer</h2>
        <p style="margin:0"><b>${esc(o.customer_name)}</b><br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a href="https://wa.me/91${esc(o.phone)}" target="_blank">WhatsApp</a><br>${esc(o.email)}</p>
        <p style="margin:10px 0 0">${esc(o.address_line1)}<br>${o.address_line2 ? esc(o.address_line2) + '<br>' : ''}${esc(o.city)}, ${esc(o.state)} ${esc(o.pincode)}</p></div>
      <div class="panel"><h2 style="margin-bottom:10px">History</h2>
        <ul class="tl">${[...o.events].reverse().map((e) => `<li class="${e.actor === 'admin-note' ? 'note' : ''}"><div>${esc(e.note || e.status)}</div><div class="when">${when(e.created_at)} · ${esc(e.actor === 'admin-note' ? 'internal note' : e.actor)}</div></li>`).join('')}</ul>
        <form class="actions" data-note style="margin-top:10px"><input class="inp" name="note" placeholder="Add an internal note" style="flex:1"><button class="btn sec">Add</button></form></div>
    </div></div>`;
  const err = $('[data-err]');
  const run = async (fn) => { try { await fn(); route(); } catch (e) { errMsg(err, e); } };
  $$('[data-status]').forEach((b) => {
    b.onclick = () => {
      const s = b.dataset.status;
      if ((s === 'cancelled' || s === 'rto') && !confirm(`${NEXT_LABEL[s]}? Stock will be put back on sale.`)) return;
      run(() => api(`/orders/${o.number}/status`, { method: 'POST', body: { status: s } }));
    };
  });
  $('[data-ship]')?.addEventListener('click', (e) => { e.target.disabled = true; e.target.textContent = 'Creating…'; run(() => api(`/orders/${o.number}/ship`, { method: 'POST', body: {} })).finally(() => { e.target.disabled = false; }); });
  $('[data-awb]')?.addEventListener('submit', (e) => { e.preventDefault(); run(() => api(`/orders/${o.number}/manual-awb`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })); });
  $('[data-note]').addEventListener('submit', (e) => { e.preventDefault(); run(() => api(`/orders/${o.number}/note`, { method: 'POST', body: { note: e.target.note.value } })); });
  $('[data-refund]')?.addEventListener('click', () => confirm('Refund the full amount to the customer?') && run(() => api(`/orders/${o.number}/refund`, { method: 'POST', body: {} })));
}

// ---------------- Products ----------------
async function products() {
  title('Products');
  const list = await api('/products');
  view().innerHTML = `<div class="panel">
    <div class="panel-head"><p>${list.length} products. Click a row to edit details, stock and photos.</p><a class="btn" href="#product/new">+ New product</a></div>
    <div class="table-wrap"><table class="t"><thead><tr><th></th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody>
    ${list.map((p) => `<tr class="click" data-href="#product/${p.id}"><td><img class="thumb" src="${esc(p.images[0] || p.image)}" alt=""></td>
      <td><b>${esc(p.name)}</b><div class="muted">${p.variants.length} variants · ${p.colors.map((c) => esc(c.name)).join(', ')}</div></td>
      <td>${esc(p.category)}</td><td class="num">${money(p.price)}</td>
      <td class="num">${p.totalStock === 0 ? '<span class="pill err">0</span>' : p.totalStock}${p.variants.some((v) => v.stock === 0) && p.totalStock ? '<div class="muted">some sizes out</div>' : ''}</td>
      <td>${p.active ? '<span class="pill ok">Live</span>' : '<span class="pill">Hidden</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

async function product(id) {
  const all = await api('/products');
  const p = id === 'new' ? { name: '', category: 'Shirts', price: 0, mrp: 0, hsn: '6205', silhouette: 'shirt', tagline: '', description: '', fabric: '', care: '', variants: [], images: [], similar: [], active: true, sort: all.length, weightGrams: 400 }
    : all.find((x) => x.id === Number(id));
  if (!p) throw new Error('Product not found');
  title(id === 'new' ? 'New product' : p.name);
  let variants = p.variants.map((v) => ({ ...v, colorHex: p.colors.find((c) => c.name === v.color)?.hex || '#888888' }));
  const SIL = ['shirt', 'tee', 'kurta', 'dress', 'trousers', 'jacket'];

  view().innerHTML = `<form data-pform>
    <div class="grid cols-2" style="grid-template-columns:1.4fr 1fr">
    <div>
      <div class="panel"><h2 style="margin-bottom:14px">Details</h2>
        <div class="form-grid">
          <label class="f">Name<input name="name" value="${esc(p.name)}" required></label>
          <label class="f">Category<input name="category" value="${esc(p.category)}" list="cats"></label>
          <label class="f">Price (₹, incl. GST)<input name="price" type="number" step="1" min="1" value="${p.price / 100 || ''}" required></label>
          <label class="f">MRP (₹)<input name="mrp" type="number" step="1" min="1" value="${p.mrp / 100 || ''}"><small>Shown struck-through if higher than price</small></label>
          <label class="f">HSN code<input name="hsn" value="${esc(p.hsn)}"><small>Ask your CA. e.g. 6205 shirts, 6211 kurtas</small></label>
          <label class="f">Shipping weight (g)<input name="weightGrams" type="number" value="${p.weightGrams}"></label>
          <label class="f">Placeholder shape<select name="silhouette">${SIL.map((s) => `<option ${s === p.silhouette ? 'selected' : ''}>${s}</option>`).join('')}</select><small>Used until you upload photos</small></label>
          <label class="f">Sort order<input name="sort" type="number" value="${p.sort}"></label>
        </div>
        <datalist id="cats">${[...new Set(all.map((x) => x.category))].map((c) => `<option>${esc(c)}</option>`).join('')}</datalist>
        <div class="grid" style="margin-top:14px;gap:14px">
          <label class="f">Tagline<input name="tagline" value="${esc(p.tagline)}"></label>
          <label class="f">Description<textarea name="description">${esc(p.description)}</textarea></label>
          <div class="form-grid"><label class="f">Fabric<input name="fabric" value="${esc(p.fabric)}"></label><label class="f">Care<input name="care" value="${esc(p.care)}"></label></div>
          <label class="f">Size chart<textarea name="sizeChart" class="mono" style="min-height:120px" placeholder="Size, Chest (in), Length (in)&#10;S, 38, 27&#10;M, 40, 28&#10;L, 42, 29">${esc(p.sizeChart ? [p.sizeChart.header, ...p.sizeChart.rows].map((r) => r.join(', ')).join('\n') : '')}</textarea>
            <small>One size per line, values separated by commas. First line is the heading. You can paste straight from Excel. Leave empty to show the general chart.</small></label>
          <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Show in store</label>
        </div>
      </div>
      <div class="panel"><div class="panel-head"><div><h2>Sizes, colours &amp; stock</h2><p>Stock is the number you can sell right now.</p></div></div>
        <div class="table-wrap"><table class="t var-table"><thead><tr><th>Colour</th><th></th><th>Size</th><th>SKU</th><th class="num">Stock</th><th></th></tr></thead><tbody data-vars></tbody></table></div>
        <div class="actions" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
          <input class="inp" data-nc placeholder="Colour name" style="width:140px"><input type="color" data-nh value="#7a6a58" style="width:44px;height:38px;border:1px solid var(--line);border-radius:6px">
          <input class="inp" data-ns placeholder="Sizes e.g. S,M,L,XL" style="width:180px" value="${esc([...new Set(variants.map((v) => v.size))].join(',') || 'S,M,L,XL,XXL')}">
          <input class="inp" data-nq type="number" placeholder="Stock each" style="width:110px" value="0">
          <button type="button" class="btn sec" data-addcolor>+ Add colour</button>
        </div>
      </div>
    </div>
    <div>
      <div class="panel"><h2 style="margin-bottom:10px">Photos</h2>
        ${id === 'new' ? '<p class="muted">Save the product first, then add photos.</p>' : `
        <div class="imgs" data-imgs></div>
        <label class="btn sec" style="margin-top:12px">Upload photos<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden data-upload></label>
        <p class="muted" style="font-size:12px;margin-top:8px">JPG, PNG or WebP, up to 5 MB each. Portrait 3:4 works best. The first photo is the main one.</p>`}
      </div>
      <div class="panel"><h2 style="margin-bottom:10px">Similar items</h2><p class="muted" style="font-size:12px;margin-top:0">Pick up to 4. If you pick none, items from the same category are shown.</p>
        <div style="max-height:260px;overflow:auto;display:grid;gap:4px">${all.filter((x) => x.id !== p.id).map((x) => `<label class="check"><input type="checkbox" name="similar" value="${x.id}" ${p.similar.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>
      </div>
      <div class="panel" style="position:sticky;top:12px"><div data-err></div>
        <div class="actions"><button class="btn">Save product</button><a class="btn sec" href="#products">Cancel</a>
        ${id !== 'new' ? `<a class="btn sec" href="/product/${esc(p.slug)}" target="_blank">View in store ↗</a>` : ''}</div></div>
    </div></div></form>`;

  const tbody = $('[data-vars]');
  const drawVars = () => {
    tbody.innerHTML = variants.map((v, i) => `<tr>
      <td><input data-i="${i}" data-k="color" value="${esc(v.color)}"></td><td><input type="color" data-i="${i}" data-k="colorHex" value="${esc(v.colorHex)}"></td>
      <td><input data-i="${i}" data-k="size" value="${esc(v.size)}" style="width:70px"></td><td><input data-i="${i}" data-k="sku" value="${esc(v.sku || '')}" placeholder="auto" class="mono"></td>
      <td class="num"><input class="stock" type="number" min="0" data-i="${i}" data-k="stock" value="${v.stock}"></td>
      <td><button type="button" class="btn small danger" data-rmv="${i}" aria-label="Remove">×</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No variants yet. Add a colour below.</td></tr>';
  };
  drawVars();
  tbody.addEventListener('input', (e) => {
    const i = e.target.dataset.i, k = e.target.dataset.k;
    if (i == null) return;
    variants[i][k] = k === 'stock' ? Number(e.target.value) : e.target.value;
    if (k === 'colorHex') variants.forEach((v) => { if (v.color === variants[i].color) v.colorHex = e.target.value; });
  });
  tbody.addEventListener('click', (e) => { const i = e.target.dataset.rmv; if (i != null) { variants.splice(Number(i), 1); drawVars(); } });
  $('[data-addcolor]').onclick = () => {
    const color = $('[data-nc]').value.trim();
    if (!color) return toast('Enter a colour name');
    const sizes = $('[data-ns]').value.split(',').map((s) => s.trim()).filter(Boolean);
    for (const size of sizes) if (!variants.some((v) => v.color === color && v.size === size)) variants.push({ color, colorHex: $('[data-nh]').value, size, sku: '', stock: Number($('[data-nq]').value) || 0 });
    $('[data-nc]').value = '';
    drawVars();
  };

  if (id !== 'new') {
    let images = [...p.images];
    const drawImgs = () => {
      $('[data-imgs]').innerHTML = images.map((u, i) => `<figure><img src="${esc(u)}" alt=""><button type="button" data-rmimg="${i}" aria-label="Remove photo">×</button></figure>`).join('') || '<p class="muted">No photos yet; the store shows a placeholder.</p>';
    };
    drawImgs();
    $('[data-imgs]').addEventListener('click', async (e) => {
      const i = e.target.dataset.rmimg;
      if (i == null || !confirm('Remove this photo?')) return;
      images.splice(Number(i), 1);
      images = (await api(`/products/${p.id}/images`, { method: 'PUT', body: { images } })).images;
      drawImgs();
    });
    $('[data-upload]').addEventListener('change', async (e) => {
      const fd = new FormData();
      toast('Preparing photos…');
      for (const f of [...e.target.files]) fd.append('images', await shrinkImage(f));
      try { images = (await api(`/products/${p.id}/images`, { method: 'POST', form: fd })).images; drawImgs(); toast('Photos uploaded'); }
      catch (ex) { toast(ex.message); }
      e.target.value = '';
    });
  }

  $('[data-pform]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const body = Object.fromEntries(fd);
    body.active = f.active.checked;
    body.similar = fd.getAll('similar').map(Number);
    body.variants = variants;
    try {
      const saved = await api(id === 'new' ? '/products' : `/products/${p.id}`, { method: id === 'new' ? 'POST' : 'PUT', body });
      toast('Saved');
      if (id === 'new') location.hash = `product/${saved.id}`; else route();
    } catch (ex) { errMsg($('[data-err]'), ex); }
  });
}

// ---------------- Returns ----------------
async function returns() {
  title('Returns');
  const status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
  const list = await api(`/returns?status=${status}`);
  const TABS = [['', 'All'], ['requested', 'Requested'], ['approved', 'Approved'], ['received', 'Received'], ['refunded', 'Refunded'], ['exchanged', 'Exchanged'], ['rejected', 'Rejected']];
  view().innerHTML = `<div class="tabs">${TABS.map(([k, l]) => `<a href="#returns?status=${k}" class="${k === status ? 'on' : ''}">${l}</a>`).join('')}</div>
    <p class="muted" style="margin-top:-4px">Flow: approve the request → arrange pickup → mark received after checking the item (stock goes back on sale) → refund or send the exchange.</p>
    ${list.map(returnCard).join('') || '<div class="panel muted">No returns here.</div>'}`;
  $$('[data-ret]').forEach((card) => {
    const num = card.dataset.ret;
    const err = $('[data-err]', card);
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const body = { action: b.dataset.act, note: $('[name=note]', card)?.value || '' };
      if (body.action === 'receive') body.restock = $('[name=restock]', card).checked;
      if (body.action === 'refund') { body.amount = $('[name=amount]', card).value; body.reference = $('[name=reference]', card)?.value || ''; }
      if (body.action === 'exchange') body.reference = $('[name=reference]', card)?.value || '';
      if (body.action === 'reject' && !body.note) return errMsg(err, 'Add a note explaining why (the customer will see the status).');
      if (body.action === 'refund' && !confirm(`Refund ₹${body.amount}?`)) return;
      b.disabled = true;
      try { await api(`/returns/${num}/action`, { method: 'POST', body }); toast('Updated'); route(); }
      catch (ex) { errMsg(err, ex); b.disabled = false; }
    });
  });
}

function returnCard(r) {
  const actions = {
    requested: `<button class="btn" data-act="approve">Approve</button><button class="btn danger" data-act="reject">Reject</button>`,
    approved: `<label class="check"><input type="checkbox" name="restock" checked> Put items back in stock</label><button class="btn" data-act="receive">Mark received &amp; checked</button>`,
    received: r.type === 'refund'
      ? `<label class="f" style="width:130px">Refund (₹)<input name="amount" type="number" value="${r.refund_paise / 100}" max="${r.refund_paise / 100}"></label>
         ${r.payment_method === 'cod' ? `<label class="f" style="width:220px">UPI transaction ref<input name="reference" placeholder="after sending to ${esc(r.refund_upi)}"></label>` : ''}
         <button class="btn" data-act="refund">${r.payment_method === 'cod' ? 'Record UPI refund' : 'Refund via Razorpay'}</button>`
      : `<label class="f" style="width:200px">New shipment AWB (optional)<input name="reference"></label><button class="btn" data-act="exchange">Mark exchange sent</button>`,
  }[r.status] || '';
  return `<div class="panel" data-ret="${esc(r.number)}">
    <div class="panel-head"><div class="actions"><b>${esc(r.number)}</b> ${pill(RET, r.status)} <span class="pill">${r.type === 'refund' ? 'Refund' : 'Exchange'}</span>
      <span class="muted">Order <a href="#order/${esc(r.order_number)}">${esc(r.order_number)}</a> · ${esc(r.customer_name)} · ${esc(r.phone)} · ${when(r.created_at)}</span></div>
      ${r.type === 'refund' ? `<b>${money(r.refund_paise)}</b>` : ''}</div>
    <p style="margin:0 0 6px">${r.items.map((i) => `${esc(i.product_name)} (${esc(i.color)}/${esc(i.size)}) × ${i.qty}${i.exchangeSize ? ` → size <b>${esc(i.exchangeSize)}</b>` : ''}`).join('<br>')}</p>
    <p class="muted" style="margin:0">Reason: ${esc(r.reason)}${r.refund_upi ? ` · Refund UPI: <span class="mono">${esc(r.refund_upi)}</span>` : ''}${r.refund_ref ? ` · Ref: <span class="mono">${esc(r.refund_ref)}</span>` : ''}${r.admin_note ? ` · Note: ${esc(r.admin_note)}` : ''}</p>
    ${actions ? `<div class="actions" style="margin-top:12px;align-items:end">${r.status === 'requested' ? '<input class="inp" name="note" placeholder="Note (required to reject)" style="width:260px">' : ''}${actions}</div>` : ''}
    <div data-err></div></div>`;
}

// ---------------- Coupons ----------------
async function coupons(_arg, editId = null) {
  title('Coupons');
  const list = await api('/coupons');
  const c = list.find((x) => x.id === editId) || { code: '', kind: 'percent', value: 10, min_order_paise: 0, max_discount_paise: 0, starts_on: '', ends_on: '', usage_limit: 0, per_customer_limit: 1, active: 1, note: '' };
  const isEdit = Boolean(editId && c.id);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const status = (x) => (!x.active ? ['Off', ''] : x.ends_on && x.ends_on < today ? ['Expired', 'err'] : x.starts_on && x.starts_on > today ? ['Scheduled', 'info']
    : x.usage_limit && x.used >= x.usage_limit ? ['Used up', 'warn'] : ['Live', 'ok']);
  const describe = (x) => `${x.kind === 'percent' ? `${x.value}% off` : `${money(x.value)} off`}${x.max_discount_paise ? ` (max ${money(x.max_discount_paise)})` : ''}${x.min_order_paise ? ` on orders above ${money(x.min_order_paise)}` : ''}`;

  view().innerHTML = `<div data-cp>
    <div class="panel"><div class="panel-head"><div><h2>${isEdit ? `Edit ${esc(c.code)}` : 'New coupon'}</h2><p>Customers type the code at checkout. The discount applies to item prices (not shipping).</p></div>
      ${isEdit ? '<button type="button" class="btn sec small" data-new>+ New coupon instead</button>' : ''}</div>
      <form class="form-grid" data-form>
        <label class="f">Code<input name="code" value="${esc(c.code)}" required placeholder="DIWALI10" style="text-transform:uppercase"></label>
        <label class="f">Type<select name="kind"><option value="percent" ${c.kind === 'percent' ? 'selected' : ''}>Percent off (%)</option><option value="flat" ${c.kind === 'flat' ? 'selected' : ''}>Rupees off (₹)</option></select></label>
        <label class="f">Value<input name="value" type="number" step="1" min="1" value="${c.kind === 'flat' ? c.value / 100 : c.value}" required><small>e.g. 10 for 10%, or 200 for ₹200</small></label>
        <label class="f">Minimum order (₹)<input name="minOrder" type="number" min="0" value="${c.min_order_paise / 100 || ''}" placeholder="No minimum"></label>
        <label class="f">Maximum discount (₹)<input name="maxDiscount" type="number" min="0" value="${c.max_discount_paise / 100 || ''}" placeholder="No cap"><small>Only for percent coupons</small></label>
        <label class="f">Starts on<input name="startsOn" type="date" value="${esc(c.starts_on)}"><small>Empty = starts now</small></label>
        <label class="f">Ends on<input name="endsOn" type="date" value="${esc(c.ends_on)}"><small>Empty = never expires</small></label>
        <label class="f">Total uses allowed<input name="usageLimit" type="number" min="0" value="${c.usage_limit || ''}" placeholder="Unlimited"></label>
        <label class="f">Uses per customer<input name="perCustomerLimit" type="number" min="0" value="${c.per_customer_limit}"><small>Counted by mobile number. 0 = unlimited</small></label>
        <label class="f">Note (only you see this)<input name="note" value="${esc(c.note)}" placeholder="e.g. Instagram Diwali post"></label>
        <label class="check" style="align-self:center"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Active</label>
        <div class="actions" style="align-self:end"><button class="btn">${isEdit ? 'Save changes' : 'Create coupon'}</button>${isEdit ? '<button type="button" class="btn sec" data-cancel>Cancel</button>' : ''}</div>
      </form><div data-err></div></div>

    <div class="panel"><h2 style="margin-bottom:10px">All coupons</h2>
      <div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Offer</th><th>Dates</th><th class="num">Used</th><th class="num">Discount given</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td><b class="mono" style="font-size:13px">${esc(x.code)}</b>${x.note ? `<div class="muted" style="font-size:12px">${esc(x.note)}</div>` : ''}</td>
        <td>${esc(describe(x))}</td><td class="muted">${x.starts_on ? day(x.starts_on) : 'Now'} → ${x.ends_on ? day(x.ends_on) : 'No end'}</td>
        <td class="num">${x.used}${x.usage_limit ? ` / ${x.usage_limit}` : ''}</td><td class="num">${money(x.discount_given)}</td>
        <td>${(([l, k]) => `<span class="pill ${k}">${l}</span>`)(status(x))}</td>
        <td class="actions"><button type="button" class="btn small sec" data-edit="${x.id}">Edit</button><button type="button" class="btn small danger" data-del="${x.id}">${x.used ? 'Turn off' : 'Delete'}</button></td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">No coupons yet. Create one above.</td></tr>'}
      </tbody></table></div></div></div>`;

  const box = $('[data-cp]');
  box.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { ...Object.fromEntries(new FormData(f)), active: f.active.checked };
    try {
      await api(isEdit ? `/coupons/${c.id}` : '/coupons', { method: isEdit ? 'PUT' : 'POST', body });
      toast(isEdit ? 'Coupon saved' : `Coupon ${body.code.toUpperCase()} created`);
      coupons();
    } catch (ex) { errMsg($('[data-err]', box), ex); }
  });
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.edit) { coupons('', Number(t.dataset.edit)); scrollTo(0, 0); }
    else if (t.dataset.new !== undefined || t.dataset.cancel !== undefined) coupons();
    else if (t.dataset.del) {
      if (!confirm('Remove this coupon? Customers will no longer be able to use it.')) return;
      const r = await api(`/coupons/${t.dataset.del}`, { method: 'DELETE' });
      toast(r.deactivated ? 'Coupon turned off (kept for order history)' : 'Coupon deleted');
      coupons();
    }
  });
}

// ---------------- Homepage ----------------
// `edited` carries unsaved changes when the form is redrawn (after add / delete / move / image upload).
async function homepage(_arg, edited = null, dirty = false) {
  title('Homepage');
  const h = edited || await api('/homepage');
  const S = h.sections;
  const AUTO = { new: 'Newest products', offer: 'Biggest discounts', all: 'Any products' };
  const cats = (await fetch('/api/config').then((r) => r.json()).catch(() => ({}))).categories || [];
  const LINKS = [['/shop', 'All products'], ['/shop?sort=new', 'New arrivals'], ['/shop?sort=discount', 'Best discounts'], ['/shop?max=1999', 'Under ₹1,999'],
    ...cats.map((c) => [`/shop?c=${encodeURIComponent(c)}`, c])];

  const imgField = (val) => `<div class="f" style="gap:6px">Image <small>Optional. Without one, product photos are used automatically. Wide images (about 1200×800) work best for banners.</small>
    <div class="actions">${val ? `<img src="${esc(val)}" alt="" style="width:90px;height:60px;object-fit:cover;border-radius:6px">` : '<span class="muted" style="font-size:12px">No image</span>'}
    <label class="btn sec small">Upload<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-upload></label>
    ${val ? '<button type="button" class="btn small danger" data-clear-img>Remove</button>' : ''}</div></div>`;
  const linkField = (val) => `<label class="f">Button goes to<input list="hp-links" data-k="link" value="${esc(val)}"><small>Pick from the list or type a link, e.g. /shop?c=Kurtas</small></label>`;
  const colorField = (val) => `<label class="f">Background colour<input type="color" data-k="bg" value="${esc(val)}" style="height:38px;padding:2px"></label>`;

  const bannerCard = (b, i) => `<div class="panel" data-item="banners:${i}" style="border-left:6px solid ${esc(b.bg)}">
    <div class="panel-head"><div class="actions"><b>Banner ${i + 1}</b><label class="check"><input type="checkbox" data-k="active" ${b.active ? 'checked' : ''}> Show on site</label></div>
      <div class="actions"><button type="button" class="btn small sec" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" class="btn small sec" data-move="1" ${i === h.banners.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button type="button" class="btn small danger" data-del>Delete</button></div></div>
    <div class="form-grid">
      <label class="f">Small label<input data-k="eyebrow" value="${esc(b.eyebrow)}" placeholder="e.g. Diwali sale"></label>
      <label class="f">Headline<input data-k="title" value="${esc(b.title)}"><small>Write {maxOff} to show your biggest real discount</small></label>
      <label class="f">Button text<input data-k="button" value="${esc(b.button)}"></label>
      ${linkField(b.link)}${colorField(b.bg)}
      <label class="f">Without an image, show<select data-k="auto">${Object.entries(AUTO).map(([k, l]) => `<option value="${k}" ${b.auto === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="f" style="margin-top:12px">Description<textarea data-k="text" style="min-height:60px">${esc(b.text)}</textarea></label>
    <div style="margin-top:12px">${imgField(b.image)}</div></div>`;

  const promoCard = (p, i) => `<div class="panel" data-item="promos:${i}" style="border-left:6px solid ${esc(p.bg)}">
    <div class="panel-head"><div class="actions"><b>Tile ${i + 1}</b><label class="check"><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}> Show on site</label></div>
      <button type="button" class="btn small danger" data-del>Delete</button></div>
    <div class="form-grid">
      <label class="f">Small label<input data-k="eyebrow" value="${esc(p.eyebrow)}"></label>
      <label class="f">Title<input data-k="title" value="${esc(p.title)}"></label>
      <label class="f">Text<input data-k="text" value="${esc(p.text)}"></label>
      <label class="f">Link text<input data-k="button" value="${esc(p.button)}"></label>
      ${linkField(p.link)}${colorField(p.bg)}
    </div>
    <div style="margin-top:12px">${imgField(p.image)}</div></div>`;

  const secRow = (k, label, withTitle = true) => `<div class="form-grid" data-item="sections:${k}" style="align-items:end;margin-bottom:10px">
    <label class="check"><input type="checkbox" data-k="show" ${S[k].show ? 'checked' : ''}> Show “${label}”</label>
    ${withTitle ? `<label class="f">Heading<input data-k="title" value="${esc(S[k].title || '')}"></label>` : '<span></span>'}</div>`;

  view().innerHTML = `<div data-hp>
    <datalist id="hp-links">${LINKS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</datalist>
    <div class="panel"><div class="panel-head"><div><h2>Top message strip</h2><p>The thin dark line above the header on every page. Separate messages with a · dot. Leave empty to hide it.</p></div>
      <a class="btn sec small" href="/" target="_blank">View home page ↗</a></div>
      <input class="inp" data-top value="${esc(h.topStrip)}"></div>

    <div class="panel-head" style="margin:22px 0 10px"><div><h2>Offer banners</h2><p>The big sliding banners at the top of the home page. Up to 6.</p></div>
      <button type="button" class="btn sec" data-add="banners" ${h.banners.length >= 6 ? 'disabled' : ''}>+ Add banner</button></div>
    ${h.banners.map(bannerCard).join('')}

    <div class="panel-head" style="margin:22px 0 10px"><div><h2>Promo tiles</h2><p>The coloured boxes in the middle of the home page. Up to 4.</p></div>
      <button type="button" class="btn sec" data-add="promos" ${h.promos.length >= 4 ? 'disabled' : ''}>+ Add tile</button></div>
    ${h.promos.map(promoCard).join('') || '<div class="panel muted">No tiles. Add one, or leave this empty to hide the section.</div>'}

    <div class="panel"><h2 style="margin-bottom:12px">Home page sections</h2>
      ${secRow('categories', 'Shop by category')}${secRow('newArrivals', 'New arrivals')}${secRow('promos', 'Promo tiles', false)}${secRow('trending', 'Trending now')}${secRow('story', 'Our story strip')}
      <div data-item="sections:story"><label class="f" style="margin-top:6px">Our story strip text<textarea data-k="text" style="min-height:60px">${esc(S.story.text || '')}</textarea></label>
      <div style="margin-top:12px">${imgField(S.story.image)}</div></div>
    </div>

    <div class="panel" style="position:sticky;bottom:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:space-between">
      <div data-err style="flex:1"></div>
      <div class="actions"><span class="muted" data-dirty>${dirty ? 'Unsaved changes' : ''}</span><button type="button" class="btn" data-save>Save homepage</button></div></div>
  </div>`;

  const box = $('[data-hp]');
  const itemOf = (el) => { const [list, key] = el.closest('[data-item]').dataset.item.split(':'); return list === 'sections' ? S[key] : h[list][Number(key)]; };
  const read = () => {
    h.topStrip = $('[data-top]', box).value;
    $$('[data-item] [data-k]', box).forEach((el) => { itemOf(el)[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
  };
  const redraw = () => { const y = scrollY; homepage('', h, true).then(() => scrollTo(0, y)); };
  box.addEventListener('input', () => { $('[data-dirty]', box).textContent = 'Unsaved changes'; });

  box.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    read();
    if (t.dataset.add) {
      h[t.dataset.add].push(t.dataset.add === 'banners'
        ? { eyebrow: '', title: 'New banner', text: '', button: 'Shop now', link: '/shop', bg: '#f2eee8', image: '', auto: 'all', active: true }
        : { eyebrow: '', title: 'New tile', text: '', button: 'Shop now', link: '/shop', bg: '#f2eee8', image: '', active: true });
      redraw();
    } else if (t.dataset.del !== undefined) {
      if (!confirm('Delete this? It is removed from the site when you save.')) return;
      const [list, i] = t.closest('[data-item]').dataset.item.split(':');
      h[list].splice(Number(i), 1);
      redraw();
    } else if (t.dataset.move) {
      const i = Number(t.closest('[data-item]').dataset.item.split(':')[1]);
      const j = i + Number(t.dataset.move);
      [h.banners[i], h.banners[j]] = [h.banners[j], h.banners[i]];
      redraw();
    } else if (t.dataset.clearImg !== undefined) {
      itemOf(t).image = '';
      redraw();
    } else if (t.dataset.save !== undefined) {
      try {
        Object.assign(h, await api('/homepage', { method: 'PUT', body: h }));
        $('[data-dirty]', box).textContent = '';
        errMsg($('[data-err]', box), null);
        toast('Homepage saved. Refresh the store to see it.');
      } catch (ex) { errMsg($('[data-err]', box), ex); }
    }
  });

  box.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-upload]');
    if (!input?.files[0]) return;
    const fd = new FormData();
    fd.append('image', await shrinkImage(input.files[0], 1920));
    try {
      const { url } = await api('/homepage/image', { method: 'POST', form: fd });
      read();
      itemOf(input).image = url;
      redraw();
      toast('Image uploaded. Press “Save homepage” to publish it.');
    } catch (ex) { toast(ex.message); }
  });
}

// ---------------- Enquiries ----------------
async function enquiries() {
  title('Bulk enquiries');
  const list = await api('/enquiries');
  view().innerHTML = `<div class="panel"><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Name</th><th>Contact</th><th>Product</th><th class="num">Qty</th><th>Message</th><th>Status</th></tr></thead><tbody>
    ${list.map((q) => `<tr><td>${when(q.created_at)}</td><td>${esc(q.name)}</td><td><a href="https://wa.me/91${esc(q.phone)}" target="_blank">${esc(q.phone)}</a><div class="muted">${esc(q.email)}</div></td>
      <td>${esc(q.product)}</td><td class="num">${q.quantity || '—'}</td><td style="max-width:280px">${esc(q.message)}</td>
      <td><select class="inp" data-enq="${q.id}" style="min-height:32px">${['new', 'contacted', 'won', 'lost'].map((s) => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">No enquiries yet.</td></tr>'}
  </tbody></table></div></div>`;
  $$('[data-enq]').forEach((s) => { s.onchange = () => api(`/enquiries/${s.dataset.enq}`, { method: 'POST', body: { status: s.value } }).then(() => toast('Saved')); });
}

// ---------------- Money ----------------
async function moneyPage() {
  title('Money');
  const [list, d] = await Promise.all([api('/ledger'), api('/dashboard?days=30')]);
  const KIND = { gateway_settlement: 'Gateway settlement (Razorpay → bank)', cod_remittance: 'COD remittance (courier → bank)', adjustment: 'Adjustment' };
  view().innerHTML = `
    <div class="tiles">${tile('Waiting at gateway (est.)', money(d.money.gatewayPending))}${tile('COD held by courier (est.)', money(d.money.codPending))}
      ${tile('Refunds owed', money(d.money.refundsOwed))}${tile('Paid to bank (recorded)', money(d.money.paidToBank))}</div>
    <div class="panel"><div class="panel-head"><div><h2>Record money that reached your bank</h2>
      <p>When Razorpay settles or Shiprocket remits COD, enter the amount here so the estimates above stay accurate. Copy the amount and reference from their dashboards.</p></div></div>
      <form class="form-grid" data-ledger style="align-items:end">
        <label class="f">Type<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="f">Amount (₹)<input name="amount" type="number" step="0.01" required></label>
        <label class="f">Date<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
        <label class="f">Reference / UTR<input name="reference"></label>
        <label class="f">Note<input name="note"></label>
        <button class="btn">Add entry</button>
      </form><div data-err></div></div>
    <div class="panel"><h2 style="margin-bottom:10px">Entries</h2><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th>Note</th><th></th></tr></thead><tbody>
      ${list.map((l) => `<tr><td>${day(l.entry_date)}</td><td>${esc(KIND[l.kind])}</td><td class="num">${money(l.amount_paise)}</td><td class="mono">${esc(l.reference)}</td><td>${esc(l.note)}</td>
        <td>${me.role === 'owner' ? `<button class="btn small danger" data-del="${l.id}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing recorded yet.</td></tr>'}
    </tbody></table></div></div>`;
  $('[data-ledger]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/ledger', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Recorded'); route(); }
    catch (ex) { errMsg($('[data-err]'), ex); }
  });
  $$('[data-del]').forEach((b) => { b.onclick = async () => { if (confirm('Delete this entry?')) { await api(`/ledger/${b.dataset.del}`, { method: 'DELETE' }); route(); } }; });
}

// ---------------- Settings ----------------
async function settings() {
  title('Settings');
  const s = await api('/settings');
  const ro = me.role !== 'owner';
  const rupee = (k) => (Number(s[k]) / 100).toString();
  const F = (label, name, value, hint = '', type = 'text') => `<label class="f">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${ro ? 'disabled' : ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const B = (label, name) => `<label class="check"><input type="checkbox" name="${name}" ${s[name] === '1' ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${label}</label>`;
  view().innerHTML = `<form data-settings>
    ${ro ? '<div class="msg warn">Only the owner can change settings.</div>' : ''}
    <div class="panel"><h2 style="margin-bottom:12px">Store</h2><div class="form-grid">
      ${F('Brand name', 'brand_name', s.brand_name)}
      ${F('WhatsApp number', 'whatsapp_number', s.whatsapp_number, 'With country code, no +. e.g. 919876543210')}
      ${F('Support email', 'support_email', s.support_email)}${F('Support phone', 'support_phone', s.support_phone)}
      ${F('Erode shop hours', 'shop_hours', s.shop_hours, 'Shown on the home page, e.g. Open every day, 10am to 9pm')}
    </div><div class="actions" style="margin-top:14px;gap:24px">${B('Store open for orders', 'store_open')}${B('Offer cash on delivery', 'cod_enabled')}</div></div>
    <div class="panel"><h2 style="margin-bottom:12px">Orders &amp; shipping</h2><div class="form-grid">
      ${F('Max quantity per item', 'max_qty_per_item', s.max_qty_per_item, 'Above this, buyers are sent to the bulk form', 'number')}
      ${F('Return window (days)', 'return_window_days', s.return_window_days, '', 'number')}
      ${F('Shipping fee (₹)', 'shipping_fee', rupee('shipping_fee_paise'), '', 'number')}
      ${F('Free shipping above (₹)', 'free_shipping_over', rupee('free_shipping_over_paise'), '', 'number')}
      ${F('COD fee (₹)', 'cod_fee', rupee('cod_fee_paise'), 'Shown to the customer before they choose COD', 'number')}
      ${F('Payment hold (minutes)', 'payment_hold_minutes', s.payment_hold_minutes, 'How long stock is held for an unpaid online order', 'number')}
    </div></div>
    <div class="panel"><h2 style="margin-bottom:4px">Emails</h2>
      <p class="muted" style="margin:0 0 12px;font-size:13px">${me.mailLive ? '✅ Email is set up.' : '⚠️ Email is not set up yet. Add your Gmail or Zoho SMTP details to the .env file (see .env.example) and restart the server. Until then, emails are listed below as “skipped”.'}</p>
      <div class="form-grid">
      ${F('Send new-order alerts to', 'order_alert_email', s.order_alert_email, 'Your email. Gets every new order and return request', 'email')}
      </div><div class="actions" style="margin-top:12px">${B('Email customers about their orders (confirmed, shipped, delivered, returns)', 'email_customers')}</div></div>
    <div class="panel"><h2 style="margin-bottom:12px">Business &amp; tax</h2><div class="form-grid">
      ${F('Legal business name', 'seller_legal_name', s.seller_legal_name)}${F('Registered address', 'seller_address', s.seller_address)}
      ${F('State (for GST)', 'seller_state', s.seller_state, 'Same state = CGST+SGST, other states = IGST')}${F('GSTIN', 'seller_gstin', s.seller_gstin)}
      ${F('Grievance officer name', 'grievance_officer', s.grievance_officer, 'Required by the E-Commerce Rules 2020')}
      ${F('GST slab threshold (₹ per piece)', 'gst_threshold', rupee('gst_threshold_paise'), 'Confirm current apparel slabs with your CA', 'number')}
      ${F('GST rate at or below threshold (%)', 'gst_low_rate', s.gst_low_rate, '', 'number')}${F('GST rate above threshold (%)', 'gst_high_rate', s.gst_high_rate, '', 'number')}
      ${F('Gateway fee estimate (basis points)', 'gateway_fee_bps', s.gateway_fee_bps, '236 = 2.36% (2% + 18% GST). Used only for the money estimate', 'number')}
    </div></div>
    <div data-err></div>${ro ? '' : '<button class="btn">Save settings</button>'}</form>`;
  $('[data-settings]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = Object.fromEntries(new FormData(f));
    const paise = (x) => String(Math.round(Number(x) * 100));
    const body = { ...v, store_open: f.store_open.checked ? '1' : '0', cod_enabled: f.cod_enabled.checked ? '1' : '0', email_customers: f.email_customers.checked ? '1' : '0',
      shipping_fee_paise: paise(v.shipping_fee), free_shipping_over_paise: paise(v.free_shipping_over), cod_fee_paise: paise(v.cod_fee), gst_threshold_paise: paise(v.gst_threshold) };
    ['shipping_fee', 'free_shipping_over', 'cod_fee', 'gst_threshold'].forEach((k) => delete body[k]);
    try { await api('/settings', { method: 'PUT', body }); toast('Settings saved'); } catch (ex) { errMsg($('[data-err]'), ex); }
  });

  // Email test + log (outside the settings form)
  const log = await api('/emails');
  const ST = { sent: ['Sent', 'ok'], failed: ['Failed', 'err'], skipped: ['Skipped', 'warn'] };
  view().insertAdjacentHTML('beforeend', `<div class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>Email log</h2><p>The last 100 emails the store tried to send.</p></div>
      <form class="actions" data-test-mail><input class="inp" name="to" type="email" required placeholder="you@example.com" value="${esc(s.order_alert_email || me.email)}" style="width:240px"><button class="btn sec">Send test email</button></form></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
    ${log.map((m) => `<tr><td>${when(m.created_at)}</td><td>${esc(m.to_addr)}</td><td>${esc(m.subject)}</td><td>${pill(ST, m.status)}${m.error ? `<div class="muted" style="font-size:12px">${esc(m.error)}</div>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">No emails yet.</td></tr>'}
    </tbody></table></div></div>`);
  $('[data-test-mail]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/emails/test', { method: 'POST', body: { to: e.target.to.value } }); toast('Test email sent. Check your inbox (and spam folder).'); route(); }
    catch (ex) { toast(ex.message); }
  });
}

// ---------------- Staff ----------------
async function staff() {
  title('Staff & security');
  const list = await api('/staff');
  const owner = me.role === 'owner';
  view().innerHTML = `<div class="grid cols-2">
    <div class="panel"><h2 style="margin-bottom:10px">People with access</h2>
      <table class="t"><tbody>${list.map((a) => `<tr><td><b>${esc(a.name)}</b><div class="muted">${esc(a.email)}</div></td><td><span class="pill ${a.role === 'owner' ? 'info' : ''}">${a.role}</span></td>
        <td>${owner && a.role !== 'owner' ? `<button class="btn small danger" data-rm="${a.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${owner ? `<h2 style="margin:20px 0 10px">Add staff</h2><form class="grid" data-add style="gap:10px">
        <label class="f">Name<input name="name" required></label><label class="f">Email<input name="email" type="email" required></label>
        <label class="f">Temporary password<input name="password" type="text" minlength="10" required><small>Share it privately; they should change it after signing in.</small></label>
        <div data-err></div><button class="btn">Add staff</button></form>` : ''}
      <p class="muted" style="font-size:12px;margin-top:14px">Staff can manage orders, returns, products and stock. Only the owner can change settings, staff and delete money entries.</p></div>
    <div class="panel"><h2 style="margin-bottom:10px">Change your password</h2>
      <form class="grid" data-pw style="gap:10px"><label class="f">Current password<input name="current" type="password" required autocomplete="current-password"></label>
      <label class="f">New password<input name="next" type="password" minlength="10" required autocomplete="new-password"><small>At least 10 characters</small></label>
      <div data-err></div><button class="btn">Change password</button></form></div></div>`;
  $('[data-add]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/staff', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Staff added'); route(); }
    catch (ex) { errMsg($('[data-err]', e.target), ex); }
  });
  $$('[data-rm]').forEach((b) => { b.onclick = async () => { if (confirm('Remove this person\'s access?')) { await api(`/staff/${b.dataset.rm}`, { method: 'DELETE' }); route(); } }; });
  $('[data-pw]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Password changed'); e.target.reset(); }
    catch (ex) { errMsg($('[data-err]', e.target), ex); }
  });
}

// ---------------- Activity ----------------
async function activity() {
  title('Activity log');
  const list = await api('/audit');
  view().innerHTML = `<div class="panel"><p class="muted" style="margin-top:0">Every change to stock, prices, orders, refunds, settings and staff, with who made it.</p>
    <div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Detail</th></tr></thead><tbody>
    ${list.map((l) => `<tr><td>${when(l.created_at)}</td><td>${esc(l.admin_name || 'system')}</td><td class="mono">${esc(l.action)}</td><td>${esc(l.entity)} ${esc(l.entity_id)}</td><td class="muted" style="max-width:360px">${esc(l.detail)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// ---------------- Boot ----------------
(async () => {
  try { me = await (await fetch('/api/admin/me')).json(); if (!me.id) throw 0; shell(); route(); }
  catch { me = null; renderLogin(); }
})();
