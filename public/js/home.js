import { boot, api, esc, cardHtml } from './common.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const config = await boot();

// Home page content comes from Admin › Homepage.
const [home, products] = await Promise.all([
  api('/api/homepage').catch(() => null),
  api('/api/products').catch(() => []),
]);
if (!home) throw new Error('Home page content unavailable');

const inStock = products.filter((p) => !p.soldOut);
const offPct = (p) => (p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);
const newest = [...inStock].sort((a, b) => b.id - a.id);
const offers = [...inStock].filter(offPct).sort((a, b) => offPct(b) - offPct(a));
const maxOff = offers.length ? offPct(offers[0]) : 0;
const fillTokens = (t) => String(t || '').replace(/\{maxOff\}/g, String(maxOff));
const thumb = (p) => `<a href="/product/${esc(p.slug)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></a>`;

// Picks a product image for a tile that has no uploaded image, based on where its link points.
function productForLink(link) {
  try {
    const q = new URL(link, location.origin).searchParams;
    if (q.get('c')) return inStock.find((p) => p.category === q.get('c').split(',')[0]);
    if (q.get('max')) return inStock.filter((p) => p.price <= Number(q.get('max')) * 100).sort((a, b) => a.price - b.price)[0];
    if (q.get('sort') === 'discount') return offers[0];
  } catch { /* fall through */ }
  return inStock[0];
}

// ---------- Banners ----------
const banners = home.banners.filter((b) => b.active && b.title);
const autoList = { new: newest, offer: offers.length ? offers : inStock, all: inStock.slice(3) };
const track = $('[data-slides]');
track.innerHTML = banners.map((b, i) => `
  <article class="slide ${b.image ? 'has-image' : ''}" style="--bg:${esc(b.bg)}" data-slide>
    <div class="slide-copy">
      ${b.eyebrow ? `<span class="eyebrow">${esc(b.eyebrow)}</span>` : ''}
      ${i === 0 ? '<h1>' : '<h2 class="h1">'}${esc(fillTokens(b.title))}${i === 0 ? '</h1>' : '</h2>'}
      ${b.text ? `<p>${esc(fillTokens(b.text))}</p>` : ''}
      <a class="btn" href="${esc(b.link)}">${esc(b.button)}</a>
    </div>
    ${b.image
      ? `<a class="slide-photo" href="${esc(b.link)}"><img src="${esc(b.image)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></a>`
      : `<div class="slide-imgs">${(autoList[b.auto] || inStock).slice(0, 3).map(thumb).join('')}</div>`}
  </article>`).join('');

const slides = $$('[data-slide]');
const dots = $('[data-dots]');
let current = 0;
let timer;
dots.innerHTML = slides.length > 1 ? slides.map((_, i) => `<button aria-label="Show offer ${i + 1}"></button>`).join('') : '';
$$('.slide-arrow').forEach((b) => { b.hidden = slides.length < 2; });
function go(i) {
  current = (i + slides.length) % slides.length;
  track.style.transform = `translateX(-${current * 100}%)`;
  $$('button', dots).forEach((d, j) => d.setAttribute('aria-current', String(j === current)));
  slides.forEach((s, j) => s.setAttribute('aria-hidden', String(j !== current)));
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const auto = () => { clearInterval(timer); if (!reduced && slides.length > 1) timer = setInterval(() => go(current + 1), 5500); };
$('[data-prev]').onclick = () => { go(current - 1); auto(); };
$('[data-next]').onclick = () => { go(current + 1); auto(); };
$$('button', dots).forEach((d, i) => { d.onclick = () => { go(i); auto(); }; });
let startX = null;
track.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
track.addEventListener('touchend', (e) => {
  if (startX == null) return;
  const dx = e.changedTouches[0].clientX - startX;
  if (Math.abs(dx) > 40) { go(current + (dx < 0 ? 1 : -1)); auto(); }
  startX = null;
});
$('.hero-slider').addEventListener('mouseenter', () => clearInterval(timer));
$('.hero-slider').addEventListener('mouseleave', auto);
go(0); auto();

// ---------- Sections: show/hide and headings ----------
for (const [key, s] of Object.entries(home.sections)) {
  const el = $(`[data-section="${key}"]`);
  if (!el) continue;
  el.hidden = !s.show;
  const t = $('[data-title]', el);
  if (t && s.title) t.textContent = s.title;
}

// Categories
$('[data-cats]').innerHTML = (config.categories || []).map((c) => {
  const items = products.filter((p) => p.category === c);
  const p = items.find((x) => !x.soldOut) || items[0];
  return `<a class="cat" href="/shop?c=${encodeURIComponent(c)}"><div class="ci">${p ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}</div>
    <b>${esc(c)}</b><small>${items.length} style${items.length === 1 ? '' : 's'}</small></a>`;
}).join('');

// New arrivals
const rail = $('[data-rail]');
rail.innerHTML = newest.slice(0, 10).map(cardHtml).join('');
const step = () => rail.clientWidth * 0.8;
$('[data-rail-prev]').onclick = () => rail.scrollBy({ left: -step(), behavior: 'smooth' });
$('[data-rail-next]').onclick = () => rail.scrollBy({ left: step(), behavior: 'smooth' });

// Promo tiles
const promos = home.promos.filter((p) => p.active && p.title);
$('[data-promos]').innerHTML = promos.map((p) => {
  const img = p.image || productForLink(p.link)?.image;
  return `<a class="promo" style="--bg:${esc(p.bg)}" href="${esc(p.link)}">
    <div>${p.eyebrow ? `<span class="eyebrow">${esc(p.eyebrow)}</span>` : ''}<h3>${esc(fillTokens(p.title))}</h3>
      ${p.text ? `<p>${esc(fillTokens(p.text))}</p>` : ''}<span class="link">${esc(p.button)} →</span></div>
    ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}</a>`;
}).join('');
if (!promos.length) $('[data-promos]').hidden = true;

// Trending
$('[data-trending]').innerHTML = inStock.slice(0, 8).map(cardHtml).join('');

// Story strip
const story = home.sections.story;
$('[data-story-text]').textContent = story.text || '';
if (story.image) $('[data-story-img]').src = story.image;
