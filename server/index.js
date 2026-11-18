import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT, paymentsLive, shippingLive } from './config.js';
import { db, setting } from './db.js';
import { ensureOwnerAccount } from './lib/auth.js';
import { releaseExpiredHolds } from './lib/orders.js';
import { loadProduct, loadProducts } from './lib/catalog.js';
import { router as publicRouter } from './routes/public.js';
import { router as adminRouter } from './routes/admin.js';
import { seedIfEmpty } from './seed.js';

const app = express();
app.disable('x-powered-by');
// Which proxy to trust for the visitor's real IP (used by rate limits and login throttling).
// 'loopback' = nginx/Caddy on the same server (VPS). On Render and similar hosts set TRUST_PROXY=1.
const trustProxy = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.razorpay.com",
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  });
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const PUBLIC = path.join(ROOT, 'public');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The React storefront (web/) is built into web/dist. Its pages (/, /shop, /product/:slug) are used when that build exists;
// otherwise the server falls back to the plain HTML pages in public/, so the store still runs without a build.
const WEB = path.join(ROOT, 'web', 'dist');
const reactIndex = () => { try { return fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'); } catch { return null; } };

// Product pages get their title, description, social tags and schema.org data rendered on the server so search engines can read them.
const productTemplate = () => fs.readFileSync(path.join(PUBLIC, 'product.html'), 'utf8');
app.get('/product/:slug', (req, res, next) => {
  const found = loadProduct('slug', req.params.slug);
  if (!found || !found.row.active) return next();
  const p = found.product;
  const brand = setting('brand_name');
  const url = `${config.siteUrl}/product/${p.slug}`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description,
    image: p.colors.map((c) => config.siteUrl + c.images[0]), sku: p.variants[0]?.sku, brand: { '@type': 'Brand', name: brand },
    offers: { '@type': 'Offer', url, priceCurrency: 'INR', price: (p.price / 100).toFixed(2), availability: `https://schema.org/${p.soldOut ? 'OutOfStock' : 'InStock'}`, itemCondition: 'https://schema.org/NewCondition' },
  };
  const head = `<title>${esc(p.name)} — ${esc(brand)}</title>
<meta name="description" content="${esc(p.tagline || p.description.slice(0, 155))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product"><meta property="og:title" content="${esc(p.name)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(config.siteUrl + p.image)}"><meta property="product:price:amount" content="${(p.price / 100).toFixed(2)}"><meta property="product:price:currency" content="INR">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  const body = `<h1>${esc(p.name)}</h1><p>${esc(p.description)}</p><p>Price: ₹${(p.price / 100).toLocaleString('en-IN')}</p>`;
  const json = JSON.stringify(p).replace(/</g, '\\u003c');
  const react = reactIndex();
  // Function replacers keep "$" in product text from being read as a replacement pattern.
  const html = react
    ? react
      .replace(/\s*<meta name="description"[^>]*>/, '')
      .replace(/<title>[\s\S]*?<\/title>/, () => head)
      .replace('<!--SSR-BODY-->', () => `<div class="ssr-fallback">${body}</div>`)
      .replace('</head>', () => `<script id="product-data" type="application/json">${json}</script></head>`)
    : productTemplate()
      .replace(/\s*<meta name="description" content="">/, '')
      .replace(/<title>[\s\S]*?<\/title>/, () => head)
      .replace('<!--SSR-PRODUCT-->', () => `<div class="ssr-fallback">${body}</div>`)
      .replace('"__PRODUCT_JSON__"', () => json);
  res.type('html').set('Cache-Control', 'no-cache').send(html);
});

// Browsers ask for /favicon.ico on their own; answer with the SVG icon instead of a 404.
app.get('/favicon.ico', (req, res) => res.type('image/svg+xml').sendFile(path.join(PUBLIC, 'favicon.svg')));
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /invoice/\nSitemap: ${config.siteUrl}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/shop', '/story', '/bulk', '/policies', ...loadProducts().map((p) => `/product/${p.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${config.siteUrl}${u}</loc></url>`).join('')}</urlset>`);
});

app.use(publicRouter);
app.use('/api/admin', adminRouter);

app.use('/app', express.static(WEB, { index: false, maxAge: config.isProd ? '30d' : 0 }));
app.get(['/', '/shop', '/bag', '/checkout', '/thank-you', '/track', '/account', '/story', '/policies', '/bulk'], (req, res, next) => {
  const html = reactIndex();
  if (!html) return next();
  res.type('html').set('Cache-Control', 'no-cache').send(html);
});

app.use('/vendor/gsap', express.static(path.join(ROOT, 'node_modules', 'gsap', 'dist'), { maxAge: '30d' }));
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d' }));
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

// Clean URLs for pages that are plain HTML files.
for (const [route, file] of Object.entries({ '/admin': 'admin/index.html', '/thank-you': 'thank-you.html' })) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC, file)));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((req, res) => {
  const html = reactIndex();
  if (html) return res.status(404).type('html').set('Cache-Control', 'no-cache').send(html); // the React app shows its own "not found" page
  res.status(404).sendFile(path.join(PUBLIC, '404.html'));
});

// Errors: UserError messages are safe to show; anything else is logged and hidden.
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  const message = status < 500 || err.status === 502 || err.status === 503 ? err.message : 'Something went wrong on our side. Please try again.';
  if (req.originalUrl.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).send(esc(message));
});

ensureOwnerAccount();
seedIfEmpty();

setInterval(() => releaseExpiredHolds().catch((e) => console.error('[holds]', e)), 60_000).unref();

const server = app.listen(config.port, () => {
  console.log(`Store running at ${config.siteUrl} (port ${config.port})`);
  console.log(`Payments: ${paymentsLive ? 'Razorpay LIVE keys' : 'TEST MODE (no Razorpay keys)'} · Shipping: ${shippingLive ? 'Shiprocket' : 'TEST MODE (no Shiprocket login)'}`);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app };
