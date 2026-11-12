// Home page content (banners, promo tiles, section headings) — edited in Admin › Homepage, stored as JSON in settings.
import { db, setting } from '../db.js';
import { UserError } from './orders.js';

export const DEFAULT_HOMEPAGE = {
  topStrip: 'Free shipping above ₹1,999 · Cash on delivery available · 7-day easy returns',
  banners: [
    { eyebrow: 'New season', title: 'Fresh styles from our Tiruppur workshop', text: 'Shirts, kurtas, dresses and more. Made in small batches by our own tailors.', button: 'Shop new arrivals', link: '/shop?sort=new', bg: '#f6e6db', image: '', auto: 'new', active: true },
    { eyebrow: 'Offers', title: 'Up to {maxOff}% off selected styles', text: "Limited sizes in every style, so grab yours before it's gone.", button: 'Shop the offers', link: '/shop?sort=discount', bg: '#e4e9f1', image: '', auto: 'offer', active: true },
    { eyebrow: 'Pay your way', title: 'Cash on delivery, anywhere in India', text: 'Pay by UPI, card or cash when it arrives. Easy 7-day exchange or refund.', button: 'Start shopping', link: '/shop', bg: '#e7ece2', image: '', auto: 'all', active: true },
  ],
  promos: [
    { eyebrow: 'Budget picks', title: 'Under ₹1,999', text: 'Everyday styles at easy prices.', button: 'Shop now', link: '/shop?max=1999', bg: '#fbefe8', image: '', active: true },
    { eyebrow: 'Most loved', title: 'Shirts for every day', text: 'Our best-selling shirts in many sizes.', button: 'Shop now', link: '/shop?c=Shirts', bg: '#e9eef5', image: '', active: true },
  ],
  sections: {
    categories: { show: true, title: 'Shop by category' },
    newArrivals: { show: true, title: 'New arrivals' },
    promos: { show: true },
    trending: { show: true, title: 'Trending now' },
    story: { show: true, title: 'Made by our family workshop in Tiruppur, since 2019', text: 'Around ten tailors make everything we sell, and every piece is checked by hand. Visit our shop in Erode, or read how we started.', image: '' },
  },
};

export function getHomepage() {
  try {
    const saved = JSON.parse(setting('homepage') || 'null');
    if (!saved) return structuredClone(DEFAULT_HOMEPAGE);
    return { ...structuredClone(DEFAULT_HOMEPAGE), ...saved, sections: { ...structuredClone(DEFAULT_HOMEPAGE.sections), ...(saved.sections || {}) } };
  } catch {
    return structuredClone(DEFAULT_HOMEPAGE);
  }
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v : d);
// Only site links (/shop?...) or full https links; blocks javascript: and other schemes.
const link = (v) => { const s = str(v, 300); return s.startsWith('/') && !s.startsWith('//') ? s : /^https:\/\//i.test(s) ? s : '/shop'; };
const image = (v) => { const s = str(v, 300); return /^\/(uploads|media)\/[\w./-]+$/.test(s) && !s.includes('..') ? s : ''; };
const AUTO = ['new', 'offer', 'all'];

export function saveHomepage(body = {}) {
  const banners = (Array.isArray(body.banners) ? body.banners : []).slice(0, 6).map((b) => ({
    eyebrow: str(b.eyebrow, 40), title: str(b.title, 90), text: str(b.text, 200), button: str(b.button, 30) || 'Shop now',
    link: link(b.link), bg: color(b.bg, '#f2eee8'), image: image(b.image), auto: AUTO.includes(b.auto) ? b.auto : 'all', active: b.active !== false,
  }));
  if (!banners.some((b) => b.active && b.title)) throw new UserError('Keep at least one active banner with a title.');
  const promos = (Array.isArray(body.promos) ? body.promos : []).slice(0, 4).map((p) => ({
    eyebrow: str(p.eyebrow, 40), title: str(p.title, 60), text: str(p.text, 140), button: str(p.button, 30) || 'Shop now',
    link: link(p.link), bg: color(p.bg, '#f2eee8'), image: image(p.image), active: p.active !== false,
  }));
  const s = body.sections || {};
  const sec = (k, withTitle = true) => ({ show: s[k]?.show !== false, ...(withTitle ? { title: str(s[k]?.title, 90) || DEFAULT_HOMEPAGE.sections[k].title } : {}) });
  const data = {
    topStrip: str(body.topStrip, 160),
    banners,
    promos,
    sections: {
      categories: sec('categories'), newArrivals: sec('newArrivals'), promos: sec('promos', false), trending: sec('trending'),
      story: { ...sec('story'), text: str(s.story?.text, 300), image: image(s.story?.image) },
    },
  };
  db.prepare(`INSERT INTO settings (key, value) VALUES ('homepage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(data));
  return data;
}
