import { boot, api, cardHtml, esc, money } from './common.js';

await boot();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const params = new URLSearchParams(location.search);
const list = (k) => (params.get(k) ? params.get(k).split(',') : []);
const state = {
  q: (params.get('q') || '').trim(),
  cats: list('c'),
  sizes: list('s'),
  colors: list('col'),
  max: Number(params.get('max')) || 0,
  min: Number(params.get('min')) || 0,
  stock: params.get('stock') === '1',
  sort: params.get('sort') || 'featured',
};

let products = [];
try { products = await api('/api/products'); }
catch (e) { $('[data-grid]').innerHTML = `<p class="notice err">${esc(e.message)}</p>`; }

const PRICES = [[0, 1499], [1500, 2499], [2500, 3999], [4000, 0]];
const priceLabel = ([lo, hi]) => (hi ? `${money(lo * 100)} – ${money(hi * 100)}` : `${money(lo * 100)} and above`);
const off = (p) => (p.mrp > p.price ? (1 - p.price / p.mrp) : 0);
const allCats = [...new Set(products.map((p) => p.category))];
const allSizes = [...new Set(products.flatMap((p) => p.variants.map((v) => v.size)))];
const allColors = [];
products.forEach((p) => p.colors.forEach((c) => { if (!allColors.find((x) => x.name === c.name)) allColors.push(c); }));

function matches(p, skip) {
  if (state.q) {
    const hay = `${p.name} ${p.category} ${p.tagline} ${p.colors.map((c) => c.name).join(' ')}`.toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (skip !== 'cat' && state.cats.length && !state.cats.includes(p.category)) return false;
  if (skip !== 'size' && state.sizes.length && !p.variants.some((v) => state.sizes.includes(v.size) && v.available)) return false;
  if (skip !== 'color' && state.colors.length && !p.colors.some((c) => state.colors.includes(c.name))) return false;
  if (skip !== 'price' && state.max && p.price > state.max * 100) return false;
  if (skip !== 'price' && state.min && p.price < state.min * 100) return false;
  if (state.stock && p.soldOut) return false;
  return true;
}
const countFor = (skip, test) => products.filter((p) => matches(p, skip) && test(p)).length;

function renderFilters() {
  $('[data-f-cat]').innerHTML = allCats.map((c) => `<label><input type="checkbox" data-cat="${esc(c)}" ${state.cats.includes(c) ? 'checked' : ''}> ${esc(c)} <span class="count">(${countFor('cat', (p) => p.category === c)})</span></label>`).join('');
  $('[data-f-size]').innerHTML = `<div class="chips">${allSizes.map((s) => `<button type="button" class="chip" data-size="${esc(s)}" aria-pressed="${state.sizes.includes(s)}">${esc(s)}</button>`).join('')}</div>`;
  $('[data-f-price]').innerHTML = PRICES.map(([lo, hi]) => {
    const on = state.min === lo && state.max === hi;
    return `<label><input type="radio" name="price" data-price="${lo}-${hi}" ${on ? 'checked' : ''}> ${priceLabel([lo, hi])} <span class="count">(${countFor('price', (p) => p.price >= lo * 100 && (!hi || p.price <= hi * 100))})</span></label>`;
  }).join('') + (state.max && !PRICES.some(([lo, hi]) => lo === state.min && hi === state.max) ? `<label><input type="radio" name="price" checked disabled> Under ${money(state.max * 100)}</label>` : '');
  $('[data-f-color]').innerHTML = allColors.map((c) => `<label><input type="checkbox" data-color="${esc(c.name)}" ${state.colors.includes(c.name) ? 'checked' : ''}> <span class="swatch" style="background:${esc(c.hex)}"></span> ${esc(c.name)}</label>`).join('');
  $('[data-f-stock]').checked = state.stock;
  $('[data-sort]').value = state.sort;
}

function render() {
  let out = products.filter((p) => matches(p));
  if (state.sort === 'low') out.sort((a, b) => a.price - b.price);
  else if (state.sort === 'high') out.sort((a, b) => b.price - a.price);
  else if (state.sort === 'new') out.sort((a, b) => b.id - a.id);
  else if (state.sort === 'discount') out.sort((a, b) => off(b) - off(a));
  else out.sort((a, b) => Number(a.soldOut) - Number(b.soldOut));

  const title = state.q ? `Results for “${state.q}”` : state.cats.length === 1 ? state.cats[0] : 'All products';
  $('[data-title]').textContent = title;
  $('[data-crumb]').textContent = title;
  document.title = `${title} — ${document.title.split(' — ').pop()}`;
  $('[data-count]').textContent = `${out.length} item${out.length === 1 ? '' : 's'}`;

  const active = [
    ...(state.q ? [['q', state.q, `“${state.q}”`]] : []),
    ...state.cats.map((c) => ['c', c, c]), ...state.sizes.map((s) => ['s', s, `Size ${s}`]), ...state.colors.map((c) => ['col', c, c]),
    ...(state.max || state.min ? [['price', '', state.max ? `${money(state.min * 100)} – ${money(state.max * 100)}` : `${money(state.min * 100)}+`]] : []),
  ];
  $('[data-active]').innerHTML = active.map(([k, v, l]) => `<button type="button" class="chip" data-remove="${k}" data-value="${esc(v)}">${esc(l)} ✕</button>`).join('');

  $('[data-grid]').innerHTML = out.length ? out.map(cardHtml).join('')
    : `<div class="empty" style="grid-column:1/-1"><h3>No matching products</h3><p>Try removing a filter or searching for something else.</p><button class="btn ghost" type="button" data-clear>Clear filters</button></div>`;

  const q = new URLSearchParams();
  if (state.q) q.set('q', state.q);
  if (state.cats.length) q.set('c', state.cats.join(','));
  if (state.sizes.length) q.set('s', state.sizes.join(','));
  if (state.colors.length) q.set('col', state.colors.join(','));
  if (state.min) q.set('min', state.min);
  if (state.max) q.set('max', state.max);
  if (state.stock) q.set('stock', '1');
  if (state.sort !== 'featured') q.set('sort', state.sort);
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
}

const update = () => { renderFilters(); render(); };
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.cat !== undefined) state.cats = toggle(state.cats, t.dataset.cat);
  else if (t.dataset.color !== undefined) state.colors = toggle(state.colors, t.dataset.color);
  else if (t.dataset.price) { const [lo, hi] = t.dataset.price.split('-').map(Number); state.min = lo; state.max = hi; }
  else if (t.matches('[data-f-stock]')) state.stock = t.checked;
  else if (t.matches('[data-sort]')) state.sort = t.value;
  else return;
  update();
});
document.addEventListener('click', (e) => {
  const size = e.target.closest('[data-size]');
  const rm = e.target.closest('[data-remove]');
  if (size) { state.sizes = toggle(state.sizes, size.dataset.size); update(); }
  else if (rm) {
    const k = rm.dataset.remove, v = rm.dataset.value;
    if (k === 'q') state.q = ''; else if (k === 'c') state.cats = state.cats.filter((x) => x !== v);
    else if (k === 's') state.sizes = state.sizes.filter((x) => x !== v); else if (k === 'col') state.colors = state.colors.filter((x) => x !== v);
    else { state.min = 0; state.max = 0; }
    const input = $('.search input'); if (input && k === 'q') input.value = '';
    update();
  } else if (e.target.closest('[data-clear]')) {
    Object.assign(state, { q: '', cats: [], sizes: [], colors: [], min: 0, max: 0, stock: false });
    const input = $('.search input'); if (input) input.value = '';
    update();
  } else if (e.target.closest('[data-open-panel]')) $('[data-panel]').classList.add('open');
  else if (e.target.closest('[data-close-panel]')) $('[data-panel]').classList.remove('open');
});

if (products.length) update();
