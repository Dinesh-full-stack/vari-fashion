import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import Stage from '../components/Stage.jsx';
import { useApp } from '../app-context.jsx';
import { api, cut, offPct, useTitle } from '../lib.js';
import { Item, Reveal, Stagger } from '../motion.jsx';

function useHomeData() {
  const [state, setState] = useState({ home: null, products: null, error: false });
  useEffect(() => {
    Promise.all([api('/api/homepage'), api('/api/products')])
      .then(([home, products]) => setState({ home, products, error: false }))
      .catch(() => setState({ home: null, products: null, error: true }));
  }, []);
  return state;
}

// Links set in Admin can be pages built in React (/shop, /product/..) or the older pages (/story, /bulk).
const SPA = /^\/(shop|product\/)/;
function SmartLink({ to, children, ...rest }) {
  return SPA.test(to) || to === '/' ? <Link to={to} {...rest}>{children}</Link> : <a href={to} {...rest}>{children}</a>;
}

function Head({ title, to, cta = 'View all' }) {
  return (
    <div className="block-head">
      <Reveal as="h2" y={20}>{title}</Reveal>
      {to && <Reveal y={12}><Link className="link-pill glass" to={to}>{cta} <span aria-hidden="true">→</span></Link></Reveal>}
    </div>
  );
}

export default function Home() {
  const { config } = useApp();
  useTitle(`${config.brand} — Shirts, kurtas & more, made in Tiruppur`);
  const { home, products, error } = useHomeData();

  const data = useMemo(() => {
    if (!home || !products) return null;
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
    const [, ...more] = home.banners.filter((b) => b.active && b.title);
    const tiles = [
      ...home.promos.filter((p) => p.active && p.title),
      ...more.map((b) => ({ ...b, image: b.image || (autoList[b.auto] || inStock)[0]?.image })),
    ].slice(0, 4);
    return { inStock, newest, fill, forLink, tiles, stage: newest.slice(0, 10) };
  }, [home, products]);

  if (error) return <div className="wrap empty"><h2>We couldn't load the store</h2><p>Please check your connection and try again.</p><button className="btn" onClick={() => location.reload()}>Reload</button></div>;
  if (!data) return <div className="stage-sk"><div className="sk" /></div>;

  const sec = home.sections;
  const arrivals = data.newest.slice(0, 4);
  const shown = new Set(arrivals.map((p) => p.id));
  const rest = data.inStock.filter((p) => !shown.has(p.id));
  const trending = (rest.length >= 4 ? rest : data.inStock).slice(0, 8);

  return (
    <>
      <Stage products={data.stage} />

      {sec.newArrivals?.show && arrivals.length > 0 && (
        <section className="wrap block">
          <Head title={sec.newArrivals.title || 'New arrivals'} to="/shop?sort=new" />
          <Stagger className="product-grid" gap={0.08}>
            {arrivals.map((p, i) => <Item key={p.id} y={36}><ProductCard p={p} eager={i < 2} /></Item>)}
          </Stagger>
        </section>
      )}

      {sec.promos?.show !== false && data.tiles.length > 0 && (
        <section className="wrap block">
          <Stagger className="promos" gap={0.1}>
            {data.tiles.map((p, i) => {
              const img = p.image || data.forLink(p.link)?.image;
              return (
                <Item key={i} y={36}>
                  <SmartLink className="promo glass" to={p.link} style={{ '--tint': p.bg }}>
                    <div className="promo-copy">
                      {p.eyebrow && <span className="eyebrow">{p.eyebrow}</span>}
                      <h3>{data.fill(p.title)}</h3>
                      {p.text && <p>{data.fill(p.text)}</p>}
                      <span className="link-pill glass">{p.button} <span aria-hidden="true">→</span></span>
                    </div>
                    {img && <img src={cut(img)} alt="" loading="lazy" />}
                  </SmartLink>
                </Item>
              );
            })}
          </Stagger>
        </section>
      )}

      {sec.trending?.show && trending.length > 0 && (
        <section className="wrap block">
          <Head title={sec.trending.title || 'Trending now'} to="/shop" />
          <Stagger className="product-grid" gap={0.07}>
            {trending.map((p) => <Item key={p.id} y={36}><ProductCard p={p} /></Item>)}
          </Stagger>
        </section>
      )}

      {sec.story?.show && (
        <section className="wrap block">
          <Reveal>
            <a className="story glass" href="/story">
              <div className="story-copy">
                <span className="eyebrow">Our story</span>
                <h2>{sec.story.title}</h2>
                <p>{sec.story.text}</p>
                <span className="link-pill glass">Read our story <span aria-hidden="true">→</span></span>
              </div>
              <div className="story-img"><img src={sec.story.image || '/media/illustrations/hero.svg'} alt="" loading="lazy" /></div>
            </a>
          </Reveal>
        </section>
      )}
    </>
  );
}
