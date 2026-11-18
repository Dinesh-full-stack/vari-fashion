import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { bag, cut, money, quoteBag, useBag, useTitle } from '../lib.js';

export default function Bag() {
  const { config, toast } = useApp();
  const items = useBag();
  const [quote, setQuote] = useState(null);
  useTitle(`Your bag — ${config.brand}`);

  useEffect(() => {
    if (!items.length) { setQuote(null); return undefined; }
    let live = true;
    quoteBag().then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    return () => { live = false; };
  }, [items]);

  if (!items.length) {
    return (
      <div className="wrap page-narrow">
        <div className="empty"><h1>Your bag is empty</h1><p>Pieces you add will wait for you here.</p><Link className="btn" to="/shop">Explore the collection</Link></div>
      </div>
    );
  }

  const issues = quote?.issues || {};
  const sub = quote ? quote.itemsPaise : items.reduce((s, i) => s + i.price * i.qty, 0);
  const ship = quote ? quote.shippingPaise : 0;
  const blocked = Object.keys(issues).length > 0;

  return (
    <div className="wrap">
      <div className="page-head"><h1>Your bag</h1></div>
      <div className="bag-layout">
        <div className="panel glass">
          {items.map((i) => {
            const issue = issues[i.variantId];
            const max = Math.min(config.maxQty, issue?.maxQty || config.maxQty);
            return (
              <div className="line" key={i.variantId}>
                <Link className="thumb" to={`/product/${i.slug}`}><img src={cut(i.image)} alt="" loading="lazy" /></Link>
                <div>
                  <Link className="n" to={`/product/${i.slug}`}>{i.name}</Link>
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

        <aside className="summary panel glass">
          <h2>Summary</h2>
          <div className="row"><span>Subtotal</span><span>{money(sub)}</span></div>
          <div className="row"><span>Shipping</span><span>{ship ? money(ship) : 'Free'}</span></div>
          {sub < config.freeShippingOver && <div className="ship-meter">Add {money(config.freeShippingOver - sub)} more for free shipping</div>}
          <div className="row total"><span>Total</span><span>{money(sub + ship)}</span></div>
          <p className="muted small">Includes GST. Cash on delivery fee, if any, is shown at checkout.</p>
          {blocked && <p className="notice err">Some items need your attention before checkout.</p>}
          {blocked
            ? <button className="btn block" onClick={() => toast('Fix the items marked in your bag first.')}>Checkout</button>
            : <a className="btn block" href="/checkout">Checkout <span aria-hidden="true">→</span></a>}
          <p className="muted small">Buying more than {config.maxQty} of an item? <a className="link" href="/bulk">Request a bulk quote</a>.</p>
        </aside>
      </div>
    </div>
  );
}
