import { boot, api, esc, money, cardHtml } from './common.js';

const $ = (s, r = document) => r.querySelector(s);

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

// ---------- Hero: the first active banner, shown with the product itself ----------
const banners = home.banners.filter((b) => b.active && b.title);
const autoList = { new: newest, offer: offers.length ? offers : inStock, all: inStock.slice(3) };
const hero = $('[data-hero]');
const [lead, ...moreBanners] = banners;

if (lead) {
  const tiles = lead.image
    ? [{ href: lead.link, src: lead.image, alt: '' }]
    : (autoList[lead.auto] || inStock).slice(0, 3).map((p) => ({ href: `/product/${p.slug}`, src: p.image, alt: p.name }));
  const facts = [
    config.freeShippingOver ? `<li><b>Free shipping</b> above ${money(config.freeShippingOver)}</li>` : '',
    '<li><b>Cash on delivery</b> across India</li>',
    `<li><b>${config.returnDays || 7}-day</b> easy returns</li>`,
  ].join('');
  hero.innerHTML = `
    <div class="hero-copy">
      ${lead.eyebrow ? `<span class="eyebrow">${esc(lead.eyebrow)}</span>` : ''}
      <h1>${esc(fillTokens(lead.title))}</h1>
      ${lead.text ? `<p>${esc(fillTokens(lead.text))}</p>` : ''}
      <div class="hero-actions">
        <a class="btn" href="${esc(lead.link)}">${esc(lead.button)}</a>
        <a class="btn ghost" href="/shop">Shop all</a>
      </div>
      <ul class="hero-facts">${facts}</ul>
    </div>
    ${tiles.length ? `<div class="hero-art ${tiles.length === 1 ? 'single' : ''}">${tiles.map((t, i) =>
      `<a class="tile" href="${esc(t.href)}" ${t.alt ? '' : 'aria-label="' + esc(lead.button) + '"'}><img src="${esc(t.src)}" alt="${esc(t.alt)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></a>`).join('')}</div>` : ''}`;
} else {
  hero.hidden = true;
}

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

// New arrivals and trending never show the same product twice
const arrivals = newest.slice(0, 4);
$('[data-arrivals]').innerHTML = arrivals.map(cardHtml).join('');
const shown = new Set(arrivals.map((p) => p.id));
const rest = inStock.filter((p) => !shown.has(p.id));
$('[data-trending]').innerHTML = (rest.length >= 4 ? rest : inStock).slice(0, 8).map(cardHtml).join('');

// Offer tiles: the promo tiles from Admin, then any further banners
const promos = [
  ...home.promos.filter((p) => p.active && p.title),
  ...moreBanners.map((b) => ({ ...b, image: b.image || (autoList[b.auto] || inStock)[0]?.image })),
];
promos.length = Math.min(promos.length, 4); // two rows at most, so the section stays within two screens
$('[data-promos]').innerHTML = promos.map((p) => {
  const img = p.image || productForLink(p.link)?.image;
  return `<a class="promo" style="--bg:${esc(p.bg)}" href="${esc(p.link)}">
    <div>${p.eyebrow ? `<span class="eyebrow">${esc(p.eyebrow)}</span>` : ''}<h3>${esc(fillTokens(p.title))}</h3>
      ${p.text ? `<p>${esc(fillTokens(p.text))}</p>` : ''}<span class="link">${esc(p.button)} →</span></div>
    ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}</a>`;
}).join('');
if (!promos.length) $('[data-promos]').hidden = true;

// Story band
const story = home.sections.story;
$('[data-story-text]').textContent = story.text || '';
if (story.image) $('[data-story-img]').src = story.image;
