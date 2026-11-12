// Shared storefront code: API, bag, header/footer, drawer, toasts.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (paise) => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
  return data;
}

let configPromise;
export const getConfig = () => (configPromise ||= api('/api/config'));

// The logged-in customer, or null for guests.
let accountPromise;
export const getAccount = () => (accountPromise ||= api('/api/account/me').catch(() => null));

// ---------- Bag (stored in this browser; prices are re-checked by the server) ----------
const KEY = 'bag.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = (items) => {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: bag lasts for this page only */ }
  memory = items;
  document.dispatchEvent(new CustomEvent('bag:change', { detail: items }));
};
let memory = read();

export const bag = {
  items: () => memory,
  count: () => memory.reduce((s, i) => s + i.qty, 0),
  add(item, max) {
    const items = [...memory];
    const found = items.find((i) => i.variantId === item.variantId);
    if (found) found.qty = Math.min(max, found.qty + item.qty);
    else items.push({ ...item, qty: Math.min(max, item.qty) });
    write(items);
  },
  setQty(variantId, qty) {
    write(memory.map((i) => (i.variantId === variantId ? { ...i, qty } : i)).filter((i) => i.qty > 0));
  },
  remove(variantId) { write(memory.filter((i) => i.variantId !== variantId)); },
  clear() { write([]); },
};
addEventListener('storage', (e) => { if (e.key === KEY) { memory = read(); document.dispatchEvent(new CustomEvent('bag:change', { detail: memory })); } });

// ---------- Toast ----------
let toastEl, toastTimer;
export function toast(msg) {
  toastEl ||= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toast', role: 'status' });
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

// ---------- Header / footer ----------
const ICON = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  truck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};
const logoHtml = (brand) => { const [a, ...b] = String(brand).split(' '); return `<b>${esc(a)}</b>${b.length ? `<span>${esc(b.join(' '))}</span>` : ''}`; };
let NAV = [['/shop', 'All'], ['/story', 'Our story']];

function header(c) {
  const params = new URLSearchParams(location.search);
  const cat = params.get('c');
  NAV = [['/shop', 'All'], ...(c.categories || []).map((x) => [`/shop?c=${encodeURIComponent(x)}`, x]), ['/story', 'Our story']];
  const isOn = (h) => (h.includes('?c=')
    ? location.pathname === '/shop' && h.endsWith(`=${encodeURIComponent(cat || '')}`)
    : location.pathname === h && (h !== '/shop' || !cat));
  return `<a class="skip" href="#main">Skip to content</a>
  ${c.topStrip === '' ? '' : `<div class="topstrip">${String(c.topStrip || `Free shipping above ${money(c.freeShippingOver || 199900)} · Cash on delivery available · ${c.returnDays || 7}-day easy returns`).split('·').map((x) => esc(x.trim())).join(' <i>·</i> ')}</div>`}
  <div class="hbar wrap">
    <button class="icon-btn menu-btn" aria-label="Open menu" aria-expanded="false" data-menu>${ICON.menu}</button>
    <a class="logo" href="/" aria-label="${esc(c.brand)} home">${logoHtml(c.brand)}</a>
    <nav class="cats" aria-label="Categories">${NAV.map(([h, t]) => `<a href="${h}" ${isOn(h) ? 'aria-current="page"' : ''}>${esc(t)}</a>`).join('')}</nav>
    <form class="search" action="/shop" role="search">
      <span>${ICON.search}</span>
      <input name="q" type="search" placeholder="Search shirts, kurtas, dresses…" aria-label="Search products" value="${esc(params.get('q') || '')}">
    </form>
    <div class="h-icons">
      <a class="icon-btn" href="/account" data-account-link>${ICON.user}<small>Log in</small></a>
      <a class="icon-btn hide-sm" href="/track">${ICON.truck}<small>Track</small></a>
      <button class="icon-btn" data-open-bag aria-label="Open bag">${ICON.bag}<small>Bag</small><span class="bag-count" data-bag-count></span></button>
    </div>
  </div>`;
}

function footer(c) {
  const wa = `https://wa.me/${encodeURIComponent(c.whatsapp)}`;
  return `<div class="trust wrap">
      <div><b>Free shipping</b><span>On orders above ${money(c.freeShippingOver || 199900)}</span></div>
      <div><b>Cash on delivery</b><span>Pay when it arrives</span></div>
      <div><b>${c.returnDays || 7}-day returns</b><span>Easy exchange or refund</span></div>
      <div><b>Made in Tiruppur</b><span>By our family workshop</span></div>
    </div>
    <div class="wrap footer-grid">
      <div><h4>Shop</h4>${(c.categories || []).map((x) => `<a href="/shop?c=${encodeURIComponent(x)}">${esc(x)}</a>`).join('')}<a href="/shop">All products</a></div>
      <div><h4>Help</h4><a href="/track">Track your order</a><a href="/track#return">Return or exchange</a><a href="/bulk">Bulk orders</a><a href="${wa}" target="_blank" rel="noopener">WhatsApp us</a></div>
      <div><h4>Policies</h4><a href="/policies#shipping">Shipping</a><a href="/policies#returns">Returns &amp; refunds</a><a href="/policies#privacy">Privacy</a><a href="/policies#terms">Terms</a><a href="/policies#grievance">Grievance officer</a></div>
      <div><h4>${esc(c.brand)}</h4><p>Made by our family workshop in Tiruppur since 2019. Visit our shop in Erode.</p><a href="/story">Our story</a>
        <p class="small">${esc(c.sellerName)}<br>${esc(c.sellerAddress)}<br>${esc(c.supportEmail)} · ${esc(c.supportPhone)}</p></div>
    </div>
    <div class="wrap footer-base"><span>© ${new Date().getFullYear()} ${esc(c.brand)}. All prices in INR, inclusive of GST.</span><span>UPI · Cards · Net banking · Cash on delivery</span></div>`;
}

function mobileNav() {
  const el = document.createElement('nav');
  el.className = 'mobile-nav';
  el.setAttribute('aria-label', 'Mobile');
  el.innerHTML = `<div class="mn-head"><b>Menu</b><button class="close" aria-label="Close menu">×</button></div>
    ${NAV.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('')}<hr><a href="/account">My account</a><a href="/track">Track order</a><a href="/bulk">Bulk orders</a>`;
  const back = Object.assign(document.createElement('div'), { className: 'drawer-backdrop' });
  document.body.append(back, el);
  const btn = document.querySelector('[data-menu]');
  const set = (open) => {
    el.classList.toggle('open', open); back.classList.toggle('open', open);
    btn?.setAttribute('aria-expanded', String(open)); document.body.style.overflow = open ? 'hidden' : '';
  };
  btn?.addEventListener('click', () => set(true));
  back.addEventListener('click', () => set(false));
  el.querySelector('.close').addEventListener('click', () => set(false));
  el.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => set(false)));
}

function headerScroll(h) {
  const onScroll = () => h.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ---------- Bag drawer ----------
let drawer, backdrop;

function buildDrawer() {
  backdrop = Object.assign(document.createElement('div'), { className: 'drawer-backdrop' });
  drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.setAttribute('aria-label', 'Shopping bag');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `<header><h2>Your bag</h2><button class="close" aria-label="Close bag">×</button></header>
    <div class="lines" data-lines></div><footer data-foot></footer>`;
  document.body.append(backdrop, drawer);
  backdrop.addEventListener('click', closeBag);
  drawer.querySelector('.close').addEventListener('click', closeBag);
  addEventListener('keydown', (e) => e.key === 'Escape' && closeBag());
  drawer.addEventListener('click', onLineClick);
}

export async function openBag() {
  drawer || buildDrawer();
  await renderDrawer();
  drawer.classList.add('open'); backdrop.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  drawer.querySelector('.close').focus();
}
export function closeBag() {
  if (!drawer) return;
  drawer.classList.remove('open'); backdrop.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
}

export async function quoteBag(paymentMethod = 'prepaid', extra = {}) {
  const items = bag.items();
  if (!items.length) return null;
  return api('/api/bag/quote', { method: 'POST', body: { items: items.map(({ variantId, qty }) => ({ variantId, qty })), paymentMethod, ...extra } });
}

export function lineHtml(i, issue, max) {
  return `<div class="line" data-variant="${i.variantId}">
    <a href="/product/${esc(i.slug)}"><img src="${esc(i.image)}" alt="" loading="lazy"></a>
    <div><a class="n" href="/product/${esc(i.slug)}">${esc(i.name)}</a>
      <div class="meta">${esc(i.color)} · ${esc(i.size)}</div>
      <div class="qty"><button data-dec aria-label="Decrease quantity" ${i.qty <= 1 ? 'disabled' : ''}>−</button><output>${i.qty}</output><button data-inc aria-label="Increase quantity" ${i.qty >= max ? 'disabled' : ''}>+</button></div>
      ${issue ? `<div class="issue">${esc(issue.message)}</div>` : ''}
      <button class="rm" data-rm>Remove</button></div>
    <div>${money(i.price * i.qty)}</div></div>`;
}

export function onLineClick(e) {
  const line = e.target.closest('[data-variant]');
  if (!line) return;
  const id = Number(line.dataset.variant);
  const item = bag.items().find((i) => i.variantId === id);
  if (!item) return;
  if (e.target.closest('[data-inc]')) bag.setQty(id, item.qty + 1);
  else if (e.target.closest('[data-dec]')) bag.setQty(id, item.qty - 1);
  else if (e.target.closest('[data-rm]')) bag.remove(id);
}

async function renderDrawer() {
  if (!drawer) return;
  const c = await getConfig();
  const lines = drawer.querySelector('[data-lines]');
  const foot = drawer.querySelector('[data-foot]');
  const items = bag.items();
  if (!items.length) {
    lines.innerHTML = `<div class="empty"><h3>Your bag is empty</h3><p>Pieces you add will wait for you here.</p></div>`;
    foot.innerHTML = `<a class="btn block" href="/shop">Explore the collection <span class="arrow">→</span></a>`;
    return;
  }
  let q = null;
  try { q = await quoteBag(); } catch { /* show bag without live quote */ }
  lines.innerHTML = items.map((i) => lineHtml(i, q?.issues?.[i.variantId], Math.min(c.maxQty, q?.issues?.[i.variantId]?.maxQty || c.maxQty))).join('');
  const sub = q ? q.itemsPaise : items.reduce((s, i) => s + i.price * i.qty, 0);
  const left = Math.max(0, c.freeShippingOver - sub);
  foot.innerHTML = `<div class="ship-meter">${left ? `Add ${money(left)} more for free shipping` : 'You get free shipping'}
      <div class="bar"><i style="width:${Math.min(100, (sub / c.freeShippingOver) * 100)}%"></i></div></div>
    <div class="row"><span>Subtotal</span><span>${money(sub)}</span></div>
    <a class="btn block" href="/checkout" ${q && Object.keys(q.issues).length ? 'aria-disabled="true" data-blocked style="opacity:.5"' : ''}>Checkout <span class="arrow">→</span></a>
    <a class="link" style="justify-self:center;font-size:13px" href="/bag">View bag</a>`;
}

function updateCount() {
  document.querySelectorAll('[data-bag-count]').forEach((el) => { el.textContent = bag.count() || ''; });
}

// ---------- Scroll reveal for regular pages ----------
export function observeReveals(root = document) {
  const els = root.querySelectorAll('.reveal:not(.in)');
  if (!('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

// ---------- Product card ----------
export function cardHtml(p) {
  const sizes = [...new Set(p.variants.map((v) => v.size))];
  const inStock = (sz) => p.variants.some((v) => v.size === sz && v.available);
  const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const few = !p.soldOut && p.variants.filter((v) => v.available).length <= 2;
  return `<a class="card reveal" href="/product/${esc(p.slug)}">
    <div class="media">
      <img src="${esc(p.colors[0]?.images[0] || p.image)}" alt="${esc(p.name)}" loading="lazy" width="600" height="800">
      ${p.colors[1] ? `<img class="alt" src="${esc(p.colors[1].images[0])}" alt="" loading="lazy" width="600" height="800">` : ''}
      ${p.soldOut ? '<span class="tag dark">Sold out</span>' : few ? '<span class="tag">Only few left</span>' : ''}
      <div class="quick" aria-hidden="true"><small>Sizes:</small> ${sizes.map((sz) => `<span class="${inStock(sz) ? '' : 'out'}">${esc(sz)}</span>`).join('')}</div>
    </div>
    <div class="info">
      <div class="name">${esc(p.name)}</div>
      <div class="sub">${esc(p.category)} · ${p.colors.length} colour${p.colors.length > 1 ? 's' : ''}</div>
      <div class="price"><b>${money(p.price)}</b>${off ? ` <s>${money(p.mrp)}</s> <span class="off">${off}% off</span>` : ''}</div>
    </div>
  </a>`;
}

// ---------- Boot ----------
export async function boot() {
  const c = await getConfig().catch(() => ({ brand: 'Vari Fashion', whatsapp: '', sellerName: '', sellerAddress: '', supportEmail: '', supportPhone: '', categories: [] }));
  document.title = document.title.replace('{brand}', c.brand);
  const h = document.getElementById('site-header');
  if (h) {
    h.className = 'site-header';
    h.innerHTML = header(c);
    headerScroll(h);
    mobileNav();
    getAccount().then((me) => {
      const a = h.querySelector('[data-account-link] small');
      if (me && a) { a.textContent = me.name.split(' ')[0].slice(0, 10); a.parentElement.setAttribute('aria-label', 'My account'); }
    });
  }
  const f = document.getElementById('site-footer');
  if (f) { f.className = 'site-footer'; f.innerHTML = footer(c); }
  if (c.whatsapp && !document.body.dataset.noWa) {
    const wa = document.createElement('a');
    wa.className = 'wa-float';
    wa.href = `https://wa.me/${encodeURIComponent(c.whatsapp)}`;
    wa.target = '_blank'; wa.rel = 'noopener';
    wa.setAttribute('aria-label', 'Chat with us on WhatsApp');
    wa.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3c-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"/></svg>';
    document.body.appendChild(wa);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-bag]')) { e.preventDefault(); openBag(); }
    if (e.target.closest('[data-blocked]')) { e.preventDefault(); toast('Fix the items marked in your bag first.'); }
  });
  document.addEventListener('bag:change', () => { updateCount(); if (drawer?.classList.contains('open')) renderDrawer(); });
  updateCount();
  observeReveals();
  return c;
}
