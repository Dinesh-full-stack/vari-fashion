import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, useMotionValue, useSpring } from 'framer-motion';
import ProductCard from '../components/ProductCard.jsx';
import { useApp } from '../app-context.jsx';
import { api, money, offPct, useTitle } from '../lib.js';
import { Item, Magnetic, Parallax, Reveal, SplitText, Stagger, WordScroll, ease, m } from '../motion.jsx';

function useHomeData() {
  const [state, setState] = useState({ home: null, products: null, error: false });
  useEffect(() => {
    Promise.all([api('/api/homepage'), api('/api/products')])
      .then(([home, products]) => setState({ home, products, error: false }))
      .catch(() => setState({ home: null, products: null, error: true }));
  }, []);
  return state;
}

// Same lists the older homepage used: banners can point at "new", "offer" or "all" products.
function build(products) {
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
  return { inStock, newest, fill, autoList, forLink };
}

// Links set in Admin can be pages built in React (/shop, /product/..) or the older pages (/story, /bulk).
const SPA = /^\/(shop|product\/)/;
function SmartLink({ to, children, ...rest }) {
  return SPA.test(to) || to === '/' ? <Link to={to} {...rest}>{children}</Link> : <a href={to} {...rest}>{children}</a>;
}

function Hero({ lead, ctx }) {
  const { config } = useApp();
  const tiles = lead.image
    ? [{ href: lead.link, src: lead.image, alt: '' }]
    : (ctx.autoList[lead.auto] || ctx.inStock).slice(0, 2).map((p) => ({ href: `/product/${p.slug}`, src: p.image, alt: p.name }));
  const [big, small] = tiles;
  const frame = (t, cls, delay) => t && (
    <m.div className={`hero-img ${cls}`} initial={{ clipPath: 'inset(100% 0 0 0)' }} animate={{ clipPath: 'inset(0% 0 0 0)' }} transition={{ duration: 1.3, ease, delay }}>
      <SmartLink to={t.href} aria-label={t.alt || lead.button}>
        <Parallax amount={6}><img src={t.src} alt={t.alt} fetchPriority={cls === 'big' ? 'high' : 'low'} loading={cls === 'big' ? 'eager' : 'lazy'} /></Parallax>
      </SmartLink>
    </m.div>
  );
  return (
    <section className="hero wrap" aria-label="Featured">
      <m.div className="hero-top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.1 }}>
        <span className="mono">{lead.eyebrow || 'New season'}</span>
        <span className="mono">Tiruppur, India</span>
      </m.div>
      <SplitText text={ctx.fill(lead.title)} className="hero-title" delay={0.15} />
      <div className="hero-lower">
        <m.div className="hero-copy" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.7 }}>
          {lead.text && <p>{ctx.fill(lead.text)}</p>}
          <div className="hero-actions">
            <Magnetic><SmartLink className="btn" to={lead.link}>{lead.button} <span aria-hidden="true">→</span></SmartLink></Magnetic>
            <Link className="btn ghost" to="/shop">Shop all</Link>
          </div>
          <ul className="hero-facts mono">
            {config.freeShippingOver > 0 && <li>Free shipping above {money(config.freeShippingOver)}</li>}
            <li>Cash on delivery</li>
            <li>{config.returnDays}-day returns</li>
          </ul>
        </m.div>
        {frame(small, 'small', 0.95)}
        {frame(big, `big ${small ? '' : 'solo'}`, 0.75)}
      </div>
    </section>
  );
}

function Marquee() {
  const { config } = useApp();
  const items = [
    config.freeShippingOver > 0 ? `Free shipping above ${money(config.freeShippingOver)}` : null,
    'Cash on delivery across India',
    `${config.returnDays}-day returns`,
    'Made in Tiruppur',
    'Stitched by our own tailors',
  ].filter(Boolean);
  const row = (hidden) => (
    <ul aria-hidden={hidden || undefined}>{items.map((t) => <li key={t}>{t}<i aria-hidden="true" /></li>)}</ul>
  );
  return <div className="marquee" role="presentation"><div className="marquee-track">{row(false)}{row(true)}{row(true)}</div></div>;
}

/** Large category names. A picture of the hovered category follows the pointer. */
function CatIndex({ cats }) {
  const [hover, setHover] = useState(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const x = useSpring(px, { stiffness: 260, damping: 28 });
  const y = useSpring(py, { stiffness: 260, damping: 28 });
  const hovered = hover !== null ? cats[hover] : null;
  return (
    <>
      <Stagger as="ul" className="cat-index" gap={0.08} onMouseMove={(e) => { px.set(e.clientX + 28); py.set(e.clientY - 150); }} onMouseLeave={() => setHover(null)}>
        {cats.map((c, i) => (
          <Item as="li" key={c.name} y={30} onMouseEnter={() => setHover(i)}>
            <Link to={`/shop?c=${encodeURIComponent(c.name)}`} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <span className="n mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="t">{c.name}</span>
              <span className="c mono">{c.count} style{c.count === 1 ? '' : 's'}</span>
              <span className="a" aria-hidden="true">↗</span>
              {c.image && <img className="thumb" src={c.image} alt="" loading="lazy" />}
            </Link>
          </Item>
        ))}
      </Stagger>
      <AnimatePresence>
        {hovered?.image && (
          <m.div className="cat-peek" style={{ x, y }} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.25, ease }} aria-hidden="true">
            <img src={hovered.image} alt="" />
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SectionHead({ index, title, to, cta = 'View all' }) {
  return (
    <div className="block-head">
      <div>
        <Reveal as="span" className="mono idx" y={14}>{index}</Reveal>
        <SplitText as="h2" text={title} inView stagger={0.05} />
      </div>
      {to && <Reveal y={14}><Link className="link-arrow" to={to}>{cta} <span aria-hidden="true">→</span></Link></Reveal>}
    </div>
  );
}

function Skeleton() {
  return <div className="wrap hero"><div className="sk" style={{ height: 40, width: 160 }} /><div className="sk" style={{ height: 220, margin: '24px 0' }} /><div className="sk" style={{ height: 380 }} /></div>;
}

export default function Home() {
  const { config } = useApp();
  useTitle(`${config.brand} — Shirts, kurtas & more, made in Tiruppur`);
  const { home, products, error } = useHomeData();
  const ctx = useMemo(() => (home && products ? build(products) : null), [home, products]);

  if (error) return <div className="wrap empty"><h2>We couldn't load the store</h2><p>Please check your connection and try again.</p><button className="btn" onClick={() => location.reload()}>Reload</button></div>;
  if (!ctx) return <Skeleton />;

  const sec = home.sections;
  const banners = home.banners.filter((b) => b.active && b.title);
  const [lead, ...more] = banners;
  const arrivals = ctx.newest.slice(0, 3);
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
      <Marquee />

      {sec.categories?.show && cats.length > 0 && (
        <section className="wrap block">
          <SectionHead index="N°01" title={sec.categories.title || 'Shop by category'} />
          <CatIndex cats={cats} />
        </section>
      )}

      {sec.newArrivals?.show && arrivals.length > 0 && (
        <section className="wrap block">
          <SectionHead index="N°02" title={sec.newArrivals.title || 'New arrivals'} to="/shop?sort=new" />
          <Stagger className="eg" gap={0.14}>
            {arrivals.map((p, i) => <Item key={p.id} className="eg-item"><ProductCard p={p} eager={i === 0} /></Item>)}
          </Stagger>
        </section>
      )}

      {sec.promos?.show !== false && promos.length > 0 && (
        <section className="wrap block spreads">
          {promos.map((p, i) => {
            const img = p.image || ctx.forLink(p.link)?.image;
            return (
              <SmartLink key={i} className={`spread ${i % 2 ? 'flip' : ''}`} to={p.link} style={{ '--bg': p.bg }}>
                <div className="spread-copy">
                  <Reveal as="span" className="mono" y={12}>N°{String(i + 1).padStart(2, '0')}{p.eyebrow ? ` — ${p.eyebrow}` : ''}</Reveal>
                  <SplitText as="h3" text={ctx.fill(p.title)} inView stagger={0.07} />
                  {p.text && <Reveal as="p" delay={0.2} y={16}>{ctx.fill(p.text)}</Reveal>}
                  <Reveal as="span" className="link-arrow" delay={0.3} y={12}>{p.button} <span aria-hidden="true">→</span></Reveal>
                </div>
                {img && <Parallax className="spread-img" amount={8}><img src={img} alt="" loading="lazy" /></Parallax>}
              </SmartLink>
            );
          })}
        </section>
      )}

      {sec.trending?.show && trending.length > 0 && (
        <section className="wrap block">
          <SectionHead index="N°03" title={sec.trending.title || 'Trending now'} to="/shop" />
          <Stagger className="stag-grid" gap={0.1}>
            {trending.map((p) => <Item key={p.id} className="stag-item"><ProductCard p={p} /></Item>)}
          </Stagger>
        </section>
      )}

      {sec.story?.show && (
        <section className="story-band">
          <div className="wrap story-wrap">
            <div className="story-main">
              <Reveal as="span" className="mono" y={12}>Our story</Reveal>
              <WordScroll className="story-big" text={sec.story.title} />
              <Reveal as="p" className="story-text" delay={0.1}>{sec.story.text}</Reveal>
              <Reveal delay={0.2}><a className="link-arrow light" href="/story">Read our story <span aria-hidden="true">→</span></a></Reveal>
            </div>
            <Reveal className="story-pic" y={60}>
              <Parallax amount={9}><img src={sec.story.image || '/media/illustrations/hero.svg'} alt="" loading="lazy" /></Parallax>
            </Reveal>
          </div>
        </section>
      )}
    </>
  );
}
