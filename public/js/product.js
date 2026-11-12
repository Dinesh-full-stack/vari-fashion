import { boot, api, bag, money, esc, cardHtml, observeReveals, openBag, toast } from './common.js';

const config = await boot();
const $ = (s, r = document) => r.querySelector(s);

// The server embeds the product JSON in the page; fall back to the API if it's missing.
let p;
try {
  const raw = JSON.parse($('#product-data').textContent);
  p = typeof raw === 'object' ? raw : null;
} catch { p = null; }
const slug = decodeURIComponent(location.pathname.split('/').pop());
let similar = [];
try {
  const full = await api(`/api/products/${encodeURIComponent(slug)}`);
  p = full; similar = full.similar || [];
} catch (e) {
  if (!p) {
    $('[data-pdp]').innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>We couldn't find that piece</h3><p>${esc(e.message)}</p><a class="btn" href="/shop">Back to the shop</a></div>`;
    throw e;
  }
}

document.title = `${p.name} — ${config.brand}`;
$('[data-crumb]').textContent = p.name;

const sizes = [...new Set(p.variants.map((v) => v.size))];
const state = { color: (p.colors.find((c) => p.variants.some((v) => v.color === c.name && v.available)) || p.colors[0]).name, size: null, qty: 1 };
const variantFor = () => p.variants.find((v) => v.color === state.color && v.size === state.size);
const inBag = (id) => bag.items().find((i) => i.variantId === id)?.qty || 0;
const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;

function gallery() {
  const c = p.colors.find((x) => x.name === state.color);
  $('[data-gallery]').innerHTML = c.images.map((src, i) =>
    `<figure><img src="${esc(src)}" alt="${esc(p.name)} in ${esc(c.name)}, view ${i + 1}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} width="600" height="800"></figure>`).join('');
}

function buybox() {
  const v = variantFor();
  const cap = v ? Math.max(0, config.maxQty - inBag(v.id)) : config.maxQty;
  state.qty = Math.max(1, Math.min(state.qty, cap || 1));
  const stockNote = !v ? '' : !v.available ? 'Sold out in this size' : v.low ? `Only ${v.low} left` : '';
  const canAdd = v && v.available && cap > 0 && config.storeOpen;
  const label = !config.storeOpen ? 'Store closed for orders' : !state.size ? 'Choose a size' : !v?.available ? 'Sold out' : cap === 0 ? `Limit of ${config.maxQty} reached` : 'Add to bag';

  $('[data-buybox]').innerHTML = `
    <div class="brand-line">${esc(config.brand)}</div>
    <h1>${esc(p.name)}</h1>
    <p class="tagline">${esc(p.tagline)}</p>
    <div class="price">${money(p.price)}${off ? `<s>${money(p.mrp)}</s><span class="off">${off}% OFF</span>` : ''}</div>
    <div class="tax-note">MRP inclusive of all taxes</div>

    <div class="opt">
      <div class="opt-head"><span class="eyebrow">Colour<b>${esc(state.color)}</b></span></div>
      <div class="colors" role="group" aria-label="Colour">${p.colors.map((c) => `
        <button class="color-btn" data-color="${esc(c.name)}" aria-pressed="${c.name === state.color}" aria-label="${esc(c.name)}" title="${esc(c.name)}"><span style="background:${esc(c.hex)}"></span></button>`).join('')}
      </div>
    </div>

    <div class="opt">
      <div class="opt-head"><span class="eyebrow">Select size ${state.size ? `<b>${esc(state.size)}</b>` : ''}</span>
        <button type="button" class="link" data-chart-toggle style="background:none;border:0;padding:0;font-size:13px">${state.chartOpen ? 'Hide size chart' : 'Size chart'}</button></div>
      ${state.chartOpen ? `<div class="chart-box">${sizeGuide()}</div>` : ''}
      <div class="sizes" role="group" aria-label="Size">${sizes.map((s) => {
        const sv = p.variants.find((x) => x.color === state.color && x.size === s);
        return `<button class="size-btn" data-size="${esc(s)}" aria-pressed="${s === state.size}" ${sv?.available ? '' : 'disabled aria-disabled="true"'}>${esc(s)}</button>`;
      }).join('')}</div>
      <div class="stock-note" aria-live="polite">${esc(stockNote)}</div>
    </div>

    <div class="qty-row">
      <div class="qty"><button data-q="-1" aria-label="Decrease quantity" ${state.qty <= 1 ? 'disabled' : ''}>−</button><output aria-live="polite">${state.qty}</output><button data-q="1" aria-label="Increase quantity" ${!v || state.qty >= cap || state.qty >= (v.low || Infinity) ? 'disabled' : ''}>+</button></div>
      <button class="btn" data-add ${canAdd ? '' : 'disabled'}>${label}</button>
    </div>
    <p class="bulk-hint">Up to ${config.maxQty} per item online. Need more? <a class="link" href="/bulk?product=${encodeURIComponent(p.name)}">Ask for a bulk quote</a>.</p>

    <div class="deliver">
      <div class="opt-head"><span class="eyebrow">Delivery options</span></div>
      <form data-pin><input name="pin" inputmode="numeric" maxlength="6" placeholder="Enter pincode" value="${esc(savedPin())}" aria-label="Pincode"><button>Check</button></form>
      <div class="result" data-pin-result></div>
    </div>
    <div class="perks"><div>Free shipping over ${money(config.freeShippingOver)}</div><div>${config.codEnabled ? 'Cash on delivery' : 'UPI & cards'}</div><div>${config.returnDays}-day returns</div></div>

    <div class="details">
      <details open><summary>Description</summary><div class="body">${esc(p.description)}</div></details>
      <details><summary>Fabric &amp; care</summary><div class="body"><p><b>Fabric:</b> ${esc(p.fabric)}</p><p>${esc(p.care)}</p></div></details>
      <details><summary>Delivery &amp; returns</summary><div class="body">Ships in 1–2 working days, delivered in 3–7 days across India.
        Return or exchange within ${config.returnDays} days of delivery. <a class="link" href="/policies#returns">Read the policy</a>.</div></details>
      <details><summary>Product details</summary><div class="body">SKU: ${esc(v?.sku || p.variants[0]?.sku)} · HSN ${esc(p.hsn)} · Country of origin: India<br>
        Marketed by ${esc(config.sellerName)}, ${esc(config.sellerAddress)} · Customer care: ${esc(config.supportPhone)}</div></details>
    </div>`;
}

function savedPin() { try { return localStorage.getItem('pin') || ''; } catch { return ''; } }

function pinResult(pin) {
  if (!/^[1-9]\d{5}$/.test(pin)) return '<span style="color:var(--err)">Enter a valid 6-digit pincode.</span>';
  return `<ul style="padding-left:18px;margin:0">
    <li>Usually delivered in <b>3–7 working days</b> to ${esc(pin)}</li>
    ${config.codEnabled ? '<li><b>Cash on delivery</b> available</li>' : ''}
    <li>Easy <b>${config.returnDays}-day</b> exchange or refund</li></ul>`;
}

function sizeGuide() {
  if (p.sizeChart?.rows?.length) {
    const { header, rows } = p.sizeChart;
    return `<table class="size-table"><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 0">Measurements are of the garment, laid flat. Between sizes? Pick the larger one.</p>`;
  }
  const isBottom = sizes.some((s) => /^\d+$/.test(s));
  const rows = isBottom
    ? [['28', '28', '36'], ['30', '30', '38'], ['32', '32', '40'], ['34', '34', '42'], ['36', '36', '44']]
    : [['XS', '34', '25'], ['S', '36', '26'], ['M', '38', '27'], ['L', '40', '28'], ['XL', '42', '29'], ['XXL', '44', '30']];
  return `<table class="size-table"><thead><tr><th>Size</th><th>${isBottom ? 'Waist (in)' : 'Chest (in)'}</th><th>${isBottom ? 'Hip (in)' : 'Length (in)'}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p style="font-size:12px;color:var(--muted);margin:8px 0 0">General guide. Message us on WhatsApp if you're unsure about your size.</p>`;
}

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-pin]')) return;
  e.preventDefault();
  const pin = e.target.pin.value.trim();
  try { localStorage.setItem('pin', pin); } catch { /* ignore */ }
  $('[data-pin-result]').innerHTML = pinResult(pin);
});

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-color]');
  const s = e.target.closest('[data-size]');
  const q = e.target.closest('[data-q]');
  if (c) {
    state.color = c.dataset.color;
    if (state.size && !variantFor()?.available) state.size = null;
    gallery(); buybox();
  } else if (s && !s.disabled) {
    state.size = s.dataset.size; buybox();
  } else if (q && !q.disabled) {
    state.qty += Number(q.dataset.q); buybox();
  } else if (e.target.closest('[data-chart-toggle]')) {
    state.chartOpen = !state.chartOpen; buybox();
  } else if (e.target.closest('[data-add]')) {
    const v = variantFor();
    if (!v) return;
    const col = p.colors.find((x) => x.name === state.color);
    bag.add({ variantId: v.id, productId: p.id, slug: p.slug, name: p.name, color: v.color, size: v.size, price: p.price, image: col.images[0], qty: state.qty }, config.maxQty);
    toast(`Added ${p.name} (${v.size}) to your bag`);
    state.qty = 1;
    buybox();
    openBag();
  }
});

gallery();
buybox();
if (similar.length) { $('[data-similar]').innerHTML = similar.map(cardHtml).join(''); observeReveals($('[data-similar]')); }
else { $('.section-title').remove(); }

// Structured data is already in the page from the server; nothing else to do for SEO here.
