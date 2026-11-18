import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api, bag, bagCount, money, useBag } from '../lib.js';

const Icon = {
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  bag: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>,
  user: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  menu: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 8h16M4 16h16" /></svg>,
  close: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>,
};

function Logo({ brand }) {
  const [a, ...rest] = String(brand).split(' ');
  return <Link className="logo" to="/" aria-label={`${brand} home`}><b>{a}</b>{rest.length > 0 && <span>{rest.join(' ')}</span>}</Link>;
}

function Header({ onMenu }) {
  const { config, account, openBag } = useApp();
  const items = useBag();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const cat = new URLSearchParams(search).get('c');
  const [scrolled, setScrolled] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  useEffect(() => setQ(new URLSearchParams(search).get('q') || ''), [search]);

  const strip = config.topStrip === '' ? null : String(config.topStrip || `Free shipping above ${money(config.freeShippingOver)} · Cash on delivery available · ${config.returnDays}-day easy returns`).split('·').map((x) => x.trim());
  const count = bagCount(items);
  const active = (c) => pathname === '/shop' && (cat || '') === (c || '');

  return (
    <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      {strip && <div className="topstrip">{strip.map((t, i) => <span key={i}>{t}</span>)}</div>}
      <div className="hbar wrap">
        <button className="icon-btn menu-btn" aria-label="Open menu" onClick={onMenu}>{Icon.menu}</button>
        <Logo brand={config.brand} />
        <nav className="cats" aria-label="Categories">
          <Link to="/shop" aria-current={active('') ? 'page' : undefined}>All</Link>
          {(config.categories || []).map((c) => <Link key={c} to={`/shop?c=${encodeURIComponent(c)}`} aria-current={active(c) ? 'page' : undefined}>{c}</Link>)}
          <a href="/story">Our story</a>
        </nav>
        <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); nav(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop'); }}>
          {Icon.search}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shirts, kurtas, dresses" aria-label="Search products" />
        </form>
        <div className="h-icons">
          <a className="icon-btn" href="/account" aria-label={account ? 'My account' : 'Log in'}>{Icon.user}<small>{account ? account.name.split(' ')[0].slice(0, 10) : 'Log in'}</small></a>
          <button className="icon-btn" onClick={openBag} aria-label={`Open bag${count ? `, ${count} items` : ''}`}>{Icon.bag}<small>Bag</small>{count > 0 && <span className="bag-count">{count}</span>}</button>
        </div>
      </div>
    </header>
  );
}

function MobileNav({ open, onClose }) {
  const { config } = useApp();
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} />
      <nav className={`mobile-nav ${open ? 'open' : ''}`} aria-label="Mobile" aria-hidden={!open}>
        <div className="panel-head"><b>Menu</b><button className="icon-btn" aria-label="Close menu" onClick={onClose}>{Icon.close}</button></div>
        <Link to="/shop" onClick={onClose}>All products</Link>
        {(config.categories || []).map((c) => <Link key={c} to={`/shop?c=${encodeURIComponent(c)}`} onClick={onClose}>{c}</Link>)}
        <hr />
        <a href="/story">Our story</a><a href="/account">My account</a><a href="/track">Track order</a><a href="/bulk">Bulk orders</a>
      </nav>
    </>
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
      <aside className={`drawer ${bagOpen ? 'open' : ''}`} aria-label="Shopping bag" aria-hidden={!bagOpen}>
        <div className="panel-head"><h2>Your bag</h2><button className="icon-btn" aria-label="Close bag" onClick={closeBag}>{Icon.close}</button></div>
        {!items.length ? (
          <div className="drawer-empty"><h3>Your bag is empty</h3><p>Pieces you add will wait for you here.</p>
            <Link className="btn" to="/shop" onClick={closeBag}>Explore the collection</Link></div>
        ) : (
          <>
            <div className="drawer-lines">
              {items.map((i) => {
                const issue = quote?.issues?.[i.variantId];
                const max = Math.min(config.maxQty, issue?.maxQty || config.maxQty);
                return (
                  <div className="line" key={i.variantId}>
                    <Link to={`/product/${i.slug}`} onClick={closeBag}><img src={i.image} alt="" loading="lazy" /></Link>
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
                  </div>
                );
              })}
            </div>
            <div className="drawer-foot">
              <div className="ship-meter">{left ? `Add ${money(left)} more for free shipping` : 'You get free shipping'}
                <div className="bar"><i style={{ width: `${Math.min(100, (sub / config.freeShippingOver) * 100)}%` }} /></div></div>
              <div className="row"><span>Subtotal</span><b>{money(sub)}</b></div>
              {blocked
                ? <button className="btn block" disabled>Fix the items marked above</button>
                : <a className="btn block" href="/checkout">Checkout</a>}
              <a className="link center" href="/bag">View full bag</a>
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
      <div className="wrap trust">
        <div><b>Free shipping</b><span>On orders above {money(c.freeShippingOver)}</span></div>
        <div><b>Cash on delivery</b><span>Pay when it arrives</span></div>
        <div><b>{c.returnDays}-day returns</b><span>Easy exchange or refund</span></div>
        <div><b>Made in Tiruppur</b><span>By our family workshop</span></div>
      </div>
      <div className="wrap footer-grid">
        <div><h4>Shop</h4>{(c.categories || []).map((x) => <Link key={x} to={`/shop?c=${encodeURIComponent(x)}`}>{x}</Link>)}<Link to="/shop">All products</Link></div>
        <div><h4>Help</h4><a href="/track">Track your order</a><a href="/track#return">Return or exchange</a><a href="/bulk">Bulk orders</a>{c.whatsapp && <a href={`https://wa.me/${encodeURIComponent(c.whatsapp)}`} target="_blank" rel="noopener noreferrer">WhatsApp us</a>}</div>
        <div><h4>Policies</h4><a href="/policies#shipping">Shipping</a><a href="/policies#returns">Returns &amp; refunds</a><a href="/policies#privacy">Privacy</a><a href="/policies#terms">Terms</a><a href="/policies#grievance">Grievance officer</a></div>
        <div><h4>{c.brand}</h4><p>Made by our family workshop in Tiruppur since 2019. Visit our shop in Erode.</p><a href="/story">Our story</a>
          <p className="small">{c.sellerName}<br />{c.sellerAddress}<br />{c.supportEmail} · {c.supportPhone}</p></div>
      </div>
      <div className="wrap footer-base"><span>© {new Date().getFullYear()} {c.brand}. All prices in INR, inclusive of GST.</span><span>UPI · Cards · Net banking · Cash on delivery</span></div>
    </footer>
  );
}

export default function Layout() {
  const { config, toastMsg } = useApp();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => { scrollTo(0, 0); setMenu(false); }, [pathname]);
  return (
    <>
      <Header onMenu={() => setMenu(true)} />
      <MobileNav open={menu} onClose={() => setMenu(false)} />
      <main id="main"><Outlet /></main>
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
