import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useApp } from '../app-context.jsx';
import { api, bag, bagCount, cut, money, useBag } from '../lib.js';
import { ease, m } from '../motion.jsx';
import Backdrop from './Backdrop.jsx';

export const Icon = {
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  bag: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>,
  user: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  close: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  truck: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>,
  grid: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></svg>,
};

function Logo({ brand }) {
  const [a, ...rest] = String(brand).split(' ');
  return <Link className="logo glass" to="/" aria-label={`${brand} home`}><b>{a}</b>{rest.length > 0 && <span>{rest.join(' ')}</span>}</Link>;
}

function Header() {
  const { config, account, openBag } = useApp();
  const items = useBag();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const cat = new URLSearchParams(search).get('c');
  const [q, setQ] = useState('');
  const tabs = useRef(null);
  const [pill, setPill] = useState({ x: 0, w: 0, on: false });

  useEffect(() => setQ(new URLSearchParams(search).get('q') || ''), [search]);
  useLayoutEffect(() => {
    const a = tabs.current?.querySelector('[aria-current="page"]');
    setPill(a ? { x: a.offsetLeft, w: a.offsetWidth, on: true } : (p) => ({ ...p, on: false }));
  }, [pathname, search, config.categories]);

  const count = bagCount(items);
  const active = (c) => pathname === '/shop' && (cat || '') === (c || '');

  return (
    <header className="nav-wrap">
      <a className="skip" href="#main">Skip to content</a>
      <Logo brand={config.brand} />
      <nav className="tabs glass" aria-label="Categories" ref={tabs}>
        <span className="pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w, opacity: pill.on ? 1 : 0 }} />
        <Link to="/shop" aria-current={active('') ? 'page' : undefined}>All</Link>
        {(config.categories || []).map((c) => <Link key={c} to={`/shop?c=${encodeURIComponent(c)}`} aria-current={active(c) ? 'page' : undefined}>{c}</Link>)}
        <Link to="/story" aria-current={pathname === '/story' ? 'page' : undefined}>Story</Link>
      </nav>
      <div className="tools glass">
        <form className="nav-search" role="search" onSubmit={(e) => { e.preventDefault(); nav(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop'); }}>
          <label className="sr-only" htmlFor="nav-q">Search products</label>
          {Icon.search}
          <input id="nav-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        </form>
        <Link className="round" to="/account" aria-label={account ? `My account, ${account.name.split(' ')[0]}` : 'Log in'} title={account ? account.name : 'Log in'}>{Icon.user}</Link>
        <button className="round" onClick={openBag} aria-label={`Open bag${count ? `, ${count} items` : ''}`}>
          {Icon.bag}
          {count > 0 && <m.span key={count} className="count" initial={{ scale: 1.7 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }}>{count}</m.span>}
        </button>
      </div>
    </header>
  );
}

function BagDrawer() {
  const { config, bagOpen, closeBag } = useApp();
  const items = useBag();
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    if (!bagOpen || !items.length) { setQuote(null); return undefined; }
    let live = true;
    api('/api/bag/quote', { method: 'POST', body: { items: items.map(({ variantId, qty }) => ({ variantId, qty })), paymentMethod: 'prepaid' } })
      .then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    return () => { live = false; };
  }, [bagOpen, items]);

  useEffect(() => {
    if (!bagOpen) return undefined;
    const esc = (e) => e.key === 'Escape' && closeBag();
    addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [bagOpen, closeBag]);

  const sub = quote ? quote.itemsPaise : items.reduce((s, i) => s + i.price * i.qty, 0);
  const left = Math.max(0, config.freeShippingOver - sub);
  const blocked = quote && Object.keys(quote.issues || {}).length > 0;

  return (
    <>
      <div className={`scrim ${bagOpen ? 'open' : ''}`} onClick={closeBag} />
      <aside className={`drawer glass ${bagOpen ? 'open' : ''}`} aria-label="Shopping bag" aria-hidden={!bagOpen}>
        <div className="panel-head"><h2>Your bag</h2><button className="round flat" aria-label="Close bag" onClick={closeBag}>{Icon.close}</button></div>
        {!items.length ? (
          <div className="drawer-empty"><h3>Your bag is empty</h3><p>Pieces you add will wait for you here.</p>
            <Link className="btn" to="/shop" onClick={closeBag}>Explore the collection</Link></div>
        ) : (
          <>
            <div className="drawer-lines">
              <AnimatePresence initial={false}>
                {items.map((i) => {
                  const issue = quote?.issues?.[i.variantId];
                  const max = Math.min(config.maxQty, issue?.maxQty || config.maxQty);
                  return (
                    <m.div className="line" key={i.variantId} layout exit={{ opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0 }} transition={{ duration: 0.35, ease }}>
                      <Link className="thumb" to={`/product/${i.slug}`} onClick={closeBag}><img src={cut(i.image)} alt="" loading="lazy" /></Link>
                      <div>
                        <Link className="n" to={`/product/${i.slug}`} onClick={closeBag}>{i.name}</Link>
                        <div className="meta">{i.color} · {i.size}</div>
                        <div className="stepper">
                          <button aria-label="Decrease quantity" disabled={i.qty <= 1} onClick={() => bag.setQty(i.variantId, i.qty - 1)}>−</button>
                          <output>{i.qty}</output>
                          <button aria-label="Increase quantity" disabled={i.qty >= max} onClick={() => bag.setQty(i.variantId, i.qty + 1)}>+</button>
                        </div>
                        {issue && <div className="issue">{issue.message}</div>}
                        <button className="rm" onClick={() => bag.remove(i.variantId)}>Remove</button>
                      </div>
                      <div className="line-price">{money(i.price * i.qty)}</div>
                    </m.div>
                  );
                })}
              </AnimatePresence>
            </div>
            <div className="drawer-foot">
              <div className="ship-meter">{left ? `Add ${money(left)} more for free shipping` : 'You get free shipping'}
                <div className="bar"><i style={{ width: `${Math.min(100, (sub / config.freeShippingOver) * 100)}%` }} /></div></div>
              <div className="row"><span>Subtotal</span><b>{money(sub)}</b></div>
              {blocked
                ? <button className="btn block" disabled>Fix the items marked above</button>
                : <Link className="btn block" to="/checkout" onClick={closeBag}>Checkout</Link>}
              <Link className="link center" to="/bag" onClick={closeBag}>View full bag</Link>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Footer() {
  const { config: c } = useApp();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="trust">
          <span className="chip-glass glass">Free shipping above {money(c.freeShippingOver)}</span>
          <span className="chip-glass glass">Cash on delivery</span>
          <span className="chip-glass glass">{c.returnDays}-day returns</span>
          <span className="chip-glass glass">Made in Tiruppur</span>
        </div>
        <div className="footer-panel glass">
          <div className="footer-grid">
            <div><h4>Shop</h4>{(c.categories || []).map((x) => <Link key={x} to={`/shop?c=${encodeURIComponent(x)}`}>{x}</Link>)}<Link to="/shop">All products</Link></div>
            <div><h4>Help</h4><Link to="/track">Track your order</Link><Link to="/track#return">Return or exchange</Link><Link to="/bulk">Bulk orders</Link>{c.whatsapp && <a href={`https://wa.me/${encodeURIComponent(c.whatsapp)}`} target="_blank" rel="noopener noreferrer">WhatsApp us</a>}</div>
            <div><h4>Policies</h4><Link to="/policies#shipping">Shipping</Link><Link to="/policies#returns">Returns &amp; refunds</Link><Link to="/policies#privacy">Privacy</Link><Link to="/policies#terms">Terms</Link><Link to="/policies#grievance">Grievance officer</Link></div>
            <div><h4>{c.brand}</h4><p>Made by our family workshop in Tiruppur since 2019. Visit our shop in Erode.</p><Link to="/story">Our story</Link>
              <p className="small">{c.sellerName}<br />{c.sellerAddress}<br />{c.supportEmail} · {c.supportPhone}</p></div>
          </div>
          <div className="footer-base"><span>© {new Date().getFullYear()} {c.brand}. All prices in INR, inclusive of GST.</span><span>UPI · Cards · Net banking · Cash on delivery</span></div>
        </div>
      </div>
    </footer>
  );
}

export default function Layout() {
  const { config, toastMsg } = useApp();
  const { pathname } = useLocation();
  const outlet = useOutlet();
  return (
    <>
      <Backdrop />
      <Header />
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => scrollTo(0, 0)}>
        <m.main id="main" data-page={pathname === '/' ? 'home' : 'page'} key={pathname} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.36, ease }}>
          {outlet}
        </m.main>
      </AnimatePresence>
      <Footer />
      <BagDrawer />
      {config.whatsapp && (
        <a className="wa-float" href={`https://wa.me/${encodeURIComponent(config.whatsapp)}`} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3c-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" /></svg>
        </a>
      )}
      <div className={`toast ${toastMsg ? 'show' : ''}`} role="status">{toastMsg}</div>
    </>
  );
}
