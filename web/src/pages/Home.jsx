import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { useApp } from '../app-context.jsx';
import { api, money, offPct, useTitle } from '../lib.js';

function useHomeData() {
  const [state, setState] = useState({ home: null, products: null, error: false });
  useEffect(() => {
    Promise.all([api('/api/homepage'), api('/api/products')])
      .then(([home, products]) => setState({ home, products, error: false }))
      .catch(() => setState({ home: null, products: null, error: true }));
  }, []);
  return state;
}

// Reaches the same lists the old homepage used: banners can point at "new", "offer" or "all" products.
function build(home, products) {
  const inStock = products.filter((p) => !p.soldOut);
  const newest = [...inStock].sort((a, b) => b.id - a.id);
  const offers = inStock.filter(offPct).sort((a, b) => offPct(b) - offPct(a));
  const maxOff = offers.length ? offPct(offers[0]) : 0;
  const fill = (t) => String(t || '').replace(/\{maxOff\}/g, String(maxOff));
  const autoList = { new: newest, offer: offers.length ? offers : inStock, all: inStock.slice(3) };
  const forLink = (link) => {
    try {
      const q = new URL(link, location.origin).searchParams;
      if (q.get('c')) return inStock.find((p) => p.category === q.get('c').split(',')[0]);
      if (q.get('max')) return inStock.filter((p) => p.price <= Number(q.get('max')) * 100).sort((a, b) => a.price - b.price)[0];
      if (q.get('sort') === 'discount') return offers[0];
    } catch { /* fall through */ }
    return inStock[0];
  };
  return { inStock, newest, offers, fill, autoList, forLink };
}

// Links in Admin can be internal pages built in React (/shop, /product/..) or older pages (/story, /bulk).
const SPA = /^\/(shop|product\/)/;
function SmartLink({ to, children, ...rest }) {
  return SPA.test(to) || to === '/' ? <Link to={to} {...rest}>{children}</Link> : <a href={to} {...rest}>{children}</a>;
}

function Hero({ lead, ctx }) {
  const { config } = useApp();
  const tiles = lead.image
    ? [{ href: lead.link, src: lead.image, alt: '' }]
    : (ctx.autoList[lead.auto] || ctx.inStock).slice(0, 3).map((p) => ({ href: `/product/${p.slug}`, src: p.image, alt: p.name }));
  return (
    <section className="hero wrap" aria-label="Featured">
      <div className="hero-copy">
        {lead.eyebrow && <span className="eyebrow">{lead.eyebrow}</span>}
        <h1>{ctx.fill(lead.title)}</h1>
        {lead.text && <p>{ctx.fill(lead.text)}</p>}
        <div className="hero-actions">
          <SmartLink className="btn" to={lead.link}>{lead.button}</SmartLink>
          <Link className="btn ghost" to="/shop">Shop all</Link>
        </div>
        <ul className="hero-facts">
          {config.freeShippingOver > 0 && <li><b>Free shipping</b> above {money(config.freeShippingOver)}</li>}
          <li><b>Cash on delivery</b> across India</li>
          <li><b>{config.returnDays}-day</b> easy returns</li>
        </ul>
      </div>
      {tiles.length > 0 && (
        <div className={`hero-art ${tiles.length === 1 ? 'single' : ''}`}>
          {tiles.map((t, i) => (
            <SmartLink key={t.href + i} className="tile" to={t.href} aria-label={t.alt || lead.button}>
              <img src={t.src} alt={t.alt} fetchPriority={i ? 'low' : 'high'} loading={i ? 'lazy' : 'eager'} />
            </SmartLink>
          ))}
        </div>
      )}
    </section>
  );
}

function Skeleton() {
  return <div className="hero wrap"><div className="hero-copy"><div className="sk" style={{ height: 24, width: 120 }} /><div className="sk" style={{ height: 150, margin: '18px 0' }} /><div className="sk" style={{ height: 48, width: 220 }} /></div><div className="hero-art"><div className="sk tile" /><div className="sk tile" /><div className="sk tile" /></div></div>;
}

export default function Home() {
  const { config } = useApp();
  useTitle(`${config.brand} — Shirts, kurtas & more, made in Tiruppur`);
  const { home, products, error } = useHomeData();
  const ctx = useMemo(() => (home && products ? build(home, products) : null), [home, products]);

  if (error) return <div className="wrap empty"><h2>We couldn't load the store</h2><p>Please check your connection and try again.</p><button className="btn" onClick={() => location.reload()}>Reload</button></div>;
  if (!ctx) return <Skeleton />;

  const sec = home.sections;
  const banners = home.banners.filter((b) => b.active && b.title);
  const [lead, ...more] = banners;
  const arrivals = ctx.newest.slice(0, 4);
  const shown = new Set(arrivals.map((p) => p.id));
  const rest = ctx.inStock.filter((p) => !shown.has(p.id));
  const trending = (rest.length >= 4 ? rest : ctx.inStock).slice(0, 8);
  const promos = [
    ...home.promos.filter((p) => p.active && p.title),
    ...more.map((b) => ({ ...b, image: b.image || (ctx.autoList[b.auto] || ctx.inStock)[0]?.image })),
  ].slice(0, 4);
  const cats = (config.categories || []).map((name) => {
    const items = products.filter((p) => p.category === name);
    return { name, count: items.length, image: (items.find((x) => !x.soldOut) || items[0])?.image };
  });

  return (
    <>
      {lead && <Hero lead={lead} ctx={ctx} />}

      {sec.categories?.show && cats.length > 0 && (
        <section className="wrap block">
          <div className="block-head"><h2>{sec.categories.title || 'Shop by category'}</h2></div>
          <div className="cat-grid">
            {cats.map((c) => (
              <Link key={c.name} className="cat" to={`/shop?c=${encodeURIComponent(c.name)}`}>
                {c.image && <img src={c.image} alt="" loading="lazy" />}
                <b>{c.name}</b><small>{c.count} style{c.count === 1 ? '' : 's'}</small>
              </Link>
            ))}
          </div>
        </section>
      )}

      {sec.newArrivals?.show && arrivals.length > 0 && (
        <section className="wrap block">
          <div className="block-head"><h2>{sec.newArrivals.title || 'New arrivals'}</h2><Link className="link" to="/shop?sort=new">View all</Link></div>
          <div className="product-grid">{arrivals.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </section>
      )}

      {sec.promos?.show !== false && promos.length > 0 && (
        <section className="wrap block promos">
          {promos.map((p, i) => {
            const img = p.image || ctx.forLink(p.link)?.image;
            return (
              <SmartLink key={i} className="promo" to={p.link} style={{ '--bg': p.bg }}>
                <div>{p.eyebrow && <span className="eyebrow">{p.eyebrow}</span>}<h3>{ctx.fill(p.title)}</h3>{p.text && <p>{ctx.fill(p.text)}</p>}<span className="link">{p.button} →</span></div>
                {img && <img src={img} alt="" loading="lazy" />}
              </SmartLink>
            );
          })}
        </section>
      )}

      {sec.trending?.show && trending.length > 0 && (
        <section className="wrap block">
          <div className="block-head"><h2>{sec.trending.title || 'Trending now'}</h2><Link className="link" to="/shop">View all</Link></div>
          <div className="product-grid">{trending.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </section>
      )}

      {sec.story?.show && (
        <section className="story-band">
          <a className="wrap story-strip" href="/story">
            <div className="story-img"><img src={sec.story.image || '/media/illustrations/hero.svg'} alt="" loading="lazy" /></div>
            <div className="story-copy">
              <span className="eyebrow">Our story</span>
              <h2>{sec.story.title}</h2>
              <p>{sec.story.text}</p>
              <span className="story-link">Read our story <span aria-hidden="true">→</span></span>
            </div>
          </a>
        </section>
      )}
    </>
  );
}
