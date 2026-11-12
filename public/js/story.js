import { boot, api, money, esc } from './common.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const config = await boot();

// ---------- Photos: show a labelled empty frame until the real file is in public/media/ ----------
const LABELS = {
  hero: 'A finished piece being worn, or the workshop at work',
  'workshop-cutting': 'The cutting table',
  'workshop-stitching': 'A tailor at the machine',
  'workshop-checking': 'Someone checking a finished piece',
  'detail-1': 'A close-up: fabric, stitching or a label',
  team: 'The workshop team together',
  'shop-erode': 'The shop in Erode',
};
function emptyFrame(img) {
  const name = img.dataset.media;
  const div = document.createElement('div');
  div.className = 'frame-empty';
  div.innerHTML = `<span><b>Photo goes here</b>${esc(LABELS[name] || '')}<br>public/media/${esc(name)}.jpg</span>`;
  img.replaceWith(div);
}
// Missing photo -> show the drawing from public/media/illustrations/ and say so in the caption.
// If the drawing is missing too, fall back to the labelled empty frame.
function useIllustration(img) {
  if (img.dataset.fallback) return emptyFrame(img);
  img.dataset.fallback = '1';
  img.addEventListener('error', () => emptyFrame(img), { once: true });
  img.src = `/media/illustrations/${img.dataset.media}.svg`;
  const cap = img.closest('figure')?.querySelector('figcaption');
  if (cap) cap.insertAdjacentHTML('beforeend', ' <em class="ill">Illustration, photo coming soon</em>');
}
$$('img[data-media]').forEach((img) => {
  if (img.complete && img.naturalWidth === 0) useIllustration(img);
  else img.addEventListener('error', () => useIllustration(img), { once: true });
});

// ---------- Shop details from settings ----------
if (config.sellerAddress && !/replace/i.test(config.sellerAddress)) $('[data-address]').textContent = config.sellerAddress;
if (config.shopHours) $('[data-hours]').textContent = config.shopHours;
$('[data-wa]').href = `https://wa.me/${encodeURIComponent(config.whatsapp)}`;
if (config.freeShippingOver) $('[data-free-ship]').textContent = `Free above ${money(config.freeShippingOver)}, anywhere in India`;

// ---------- Collection spread ----------
try {
  const products = (await api('/api/products')).filter((p) => !p.soldOut).slice(0, 6);
  $('[data-spread]').innerHTML = products.map((p, i) => `
    <a class="sp" href="/product/${esc(p.slug)}" data-rise>
      <div class="media"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="600" height="800"></div>
      <div class="cap"><div><span class="no">No. ${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(p.name)}</span></div>
        <span class="pr">${money(p.price)}</span></div>
    </a>`).join('');
} catch { $('[data-spread]').innerHTML = '<p><a class="link" href="/shop">See the collection</a></p>'; }

// ---------- Motion: a few quiet effects, skipped for reduced-motion users ----------
const { gsap, ScrollTrigger } = window;
if (gsap && ScrollTrigger && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.registerPlugin(ScrollTrigger);

  // Photos uncover top-down as they arrive
  $$('[data-reveal]').forEach((fig) => {
    const target = fig.firstElementChild;
    gsap.fromTo(target, { clipPath: 'inset(0% 0% 100% 0%)' }, {
      clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'power3.inOut',
      scrollTrigger: { trigger: fig, start: 'top 88%', once: true },
    });
  });

  // Text and cards rise a little
  gsap.set('[data-rise]', { y: 28, opacity: 0 });
  ScrollTrigger.batch('[data-rise]', {
    start: 'top 92%', once: true,
    onEnter: (els) => gsap.to(els, { y: 0, opacity: 1, duration: .9, stagger: .08, ease: 'power2.out', overwrite: true }),
  });

  // Gentle drift on the big photos
  $$('.opening-photo, .people-photo, .m-photo.b').forEach((fig) => {
    gsap.fromTo(fig, { yPercent: 4 }, { yPercent: -4, ease: 'none', scrollTrigger: { trigger: fig, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  // The road from Tiruppur to Erode draws itself
  const route = $('[data-route]');
  if (route) {
    const len = route.getTotalLength();
    gsap.fromTo(route, { strokeDasharray: `${len}`, strokeDashoffset: len }, {
      strokeDashoffset: 0, ease: 'none',
      scrollTrigger: { trigger: '.towns', start: 'top 80%', end: 'center 45%', scrub: true },
      onComplete: () => route.style.removeProperty('stroke-dasharray'),
    });
  }

  addEventListener('load', () => ScrollTrigger.refresh());
}
