import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { useApp } from '../app-context.jsx';
import { api, bag, money, offPct, useBag, useTitle } from '../lib.js';
import { Item, Magnetic, Reveal, SplitText, Stagger } from '../motion.jsx';

// The server embeds the product as JSON in the page (for search engines and a faster first paint).
function embeddedProduct(slug) {
  try {
    const p = JSON.parse(document.getElementById('product-data')?.textContent || 'null');
    return p && p.slug === slug ? p : null;
  } catch { return null; }
}

const savedPin = () => { try { return localStorage.getItem('pin') || ''; } catch { return ''; } };

function SizeGuide({ p, sizes }) {
  if (p.sizeChart?.rows?.length) {
    return (
      <>
        <table className="size-table"><thead><tr>{p.sizeChart.header.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{p.sizeChart.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
        <p className="muted small">Measurements are of the garment, laid flat. Between sizes? Pick the larger one.</p>
      </>
    );
  }
  const bottom = sizes.some((s) => /^\d+$/.test(s));
  const rows = bottom
    ? [['28', '28', '36'], ['30', '30', '38'], ['32', '32', '40'], ['34', '34', '42'], ['36', '36', '44']]
    : [['XS', '34', '25'], ['S', '36', '26'], ['M', '38', '27'], ['L', '40', '28'], ['XL', '42', '29'], ['XXL', '44', '30']];
  return (
    <>
      <table className="size-table"><thead><tr><th>Size</th><th>{bottom ? 'Waist (in)' : 'Chest (in)'}</th><th>{bottom ? 'Hip (in)' : 'Length (in)'}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
      <p className="muted small">General guide. Message us on WhatsApp if you're unsure about your size.</p>
    </>
  );
}

function Gallery({ p, color }) {
  const images = (p.colors.find((c) => c.name === color) || p.colors[0]).images;
  const track = useRef(null);
  const [at, setAt] = useState(0);
  useEffect(() => { setAt(0); track.current?.scrollTo({ left: 0 }); }, [color]);
  return (
    <div className="gallery">
      <div className="gallery-track" ref={track} onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {images.map((src, i) => (
          <Reveal as="figure" key={src} y={i ? 56 : 24} delay={i ? 0.05 : 0}><img src={src} alt={`${p.name} in ${color}, view ${i + 1}`} width="600" height="800" loading={i ? 'lazy' : 'eager'} fetchPriority={i ? 'low' : 'high'} /></Reveal>
        ))}
      </div>
      {images.length > 1 && <div className="gallery-dots" aria-hidden="true">{images.map((_, i) => <i key={i} className={i === at ? 'on' : ''} />)}</div>}
    </div>
  );
}

function Pincode({ config }) {
  const [pin, setPin] = useState(savedPin());
  const [result, setResult] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    try { localStorage.setItem('pin', pin.trim()); } catch { /* ignore */ }
    setResult(/^[1-9]\d{5}$/.test(pin.trim()) ? 'ok' : 'bad');
  };
  return (
    <div className="deliver">
      <span className="mono label">Delivery</span>
      <form onSubmit={submit}>
        <input inputMode="numeric" maxLength={6} placeholder="Enter pincode" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label="Pincode" />
        <button className="btn ghost">Check</button>
      </form>
      {result === 'bad' && <p className="err small">Enter a valid 6-digit pincode.</p>}
      {result === 'ok' && (
        <ul className="small"><li>Usually delivered in <b>3–7 working days</b> to {pin}</li>{config.codEnabled && <li><b>Cash on delivery</b> available</li>}<li>Easy <b>{config.returnDays}-day</b> exchange or refund</li></ul>
      )}
    </div>
  );
}

export default function Product() {
  const { slug } = useParams();
  const { config, openBag, toast } = useApp();
  const items = useBag();
  const [p, setP] = useState(() => embeddedProduct(slug));
  const [similar, setSimilar] = useState([]);
  const [error, setError] = useState('');
  const [color, setColor] = useState(null);
  const [size, setSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [chart, setChart] = useState(false);
  const sizesRef = useRef(null);

  useEffect(() => {
    setError(''); setSize(null); setQty(1); setChart(false);
    api(`/api/products/${encodeURIComponent(slug)}`).then((full) => { setP(full); setSimilar(full.similar || []); }).catch((e) => { setError(e.message); if (!embeddedProduct(slug)) setP(null); });
  }, [slug]);
  useEffect(() => {
    if (p) setColor((c) => (p.colors.some((x) => x.name === c) ? c : (p.colors.find((x) => p.variants.some((v) => v.color === x.name && v.available)) || p.colors[0]).name));
  }, [p]);

  useTitle(p ? `${p.name} — ${config.brand}` : undefined);
  const sizes = useMemo(() => (p ? [...new Set(p.variants.map((v) => v.size))] : []), [p]);

  if (!p) {
    return error
      ? <div className="wrap empty"><h2>We couldn't find that piece</h2><p>{error}</p><Link className="btn" to="/shop">Back to the shop</Link></div>
      : <div className="wrap pdp"><div className="sk" style={{ aspectRatio: '3/4', borderRadius: 24 }} /><div className="sk" style={{ height: 420 }} /></div>;
  }
  if (!color) return null;

  const variant = p.variants.find((v) => v.color === color && v.size === size);
  const inBag = variant ? items.find((i) => i.variantId === variant.id)?.qty || 0 : 0;
  const cap = variant ? Math.max(0, config.maxQty - inBag) : config.maxQty;
  const q = Math.max(1, Math.min(qty, cap || 1));
  const off = offPct(p);
  const canAdd = variant && variant.available && cap > 0 && config.storeOpen;
  const label = !config.storeOpen ? 'Store closed for orders' : !size ? 'Choose a size' : !variant?.available ? 'Sold out' : cap === 0 ? `Limit of ${config.maxQty} reached` : 'Add to bag';
  const stockNote = !variant ? '' : !variant.available ? 'Sold out in this size' : variant.low ? `Only ${variant.low} left` : '';

  const add = () => {
    if (!size) { sizesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Pick a size first'); return; }
    if (!canAdd) return;
    const col = p.colors.find((x) => x.name === color);
    bag.add({ variantId: variant.id, productId: p.id, slug: p.slug, name: p.name, color: variant.color, size: variant.size, price: p.price, image: col.images[0], qty: q }, config.maxQty);
    toast(`Added ${p.name} (${variant.size}) to your bag`);
    setQty(1);
    openBag();
  };

  return (
    <div className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to={`/shop?c=${encodeURIComponent(p.category)}`}>{p.category}</Link><span>/</span><b>{p.name}</b></nav>
      <div className="pdp">
        <Gallery p={p} color={color} />

        <div className="buybox">
          <div className="brand-line mono">{config.brand} — {p.category}</div>
          <SplitText key={p.slug} as="h1" text={p.name} delay={0.1} stagger={0.07} />
          {p.tagline && <p className="tagline">{p.tagline}</p>}
          <div className="pdp-price"><b>{money(p.price)}</b>{off > 0 && <><s>{money(p.mrp)}</s><span className="off">{off}% off</span></>}</div>
          <div className="muted small">MRP inclusive of all taxes</div>

          <div className="opt">
            <div className="opt-head"><span className="mono label">Colour — <b>{color}</b></span></div>
            <div className="colors" role="group" aria-label="Colour">
              {p.colors.map((c) => (
                <button key={c.name} className="color-btn" aria-pressed={c.name === color} aria-label={c.name} title={c.name}
                  onClick={() => { setColor(c.name); if (size && !p.variants.find((v) => v.color === c.name && v.size === size)?.available) setSize(null); }}>
                  <span style={{ background: c.hex }} /></button>
              ))}
            </div>
          </div>

          <div className="opt" ref={sizesRef}>
            <div className="opt-head"><span className="mono label">Size{size && <> — <b>{size}</b></>}</span>
              <button type="button" className="link plain" onClick={() => setChart((v) => !v)}>{chart ? 'Hide size chart' : 'Size chart'}</button></div>
            {chart && <div className="chart-box"><SizeGuide p={p} sizes={sizes} /></div>}
            <div className="sizes" role="group" aria-label="Size">
              {sizes.map((s) => {
                const sv = p.variants.find((x) => x.color === color && x.size === s);
                return <button key={s} className="size-btn" aria-pressed={s === size} disabled={!sv?.available} onClick={() => setSize(s)}>{s}</button>;
              })}
            </div>
            <div className="stock-note" aria-live="polite">{stockNote}</div>
          </div>

          <div className="buy-row">
            <div className="stepper lg">
              <button aria-label="Decrease quantity" disabled={q <= 1} onClick={() => setQty(q - 1)}>−</button>
              <output aria-live="polite">{q}</output>
              <button aria-label="Increase quantity" disabled={!variant || q >= cap || q >= (variant.low || Infinity)} onClick={() => setQty(q + 1)}>+</button>
            </div>
            <Magnetic className="add-wrap" strength={0.12}><button className="btn add" disabled={!!size && !canAdd} onClick={add}>{label} <span aria-hidden="true">→</span></button></Magnetic>
          </div>
          <p className="muted small">Up to {config.maxQty} per item online. Need more? <a className="link" href={`/bulk?product=${encodeURIComponent(p.name)}`}>Ask for a bulk quote</a>.</p>

          <Pincode config={config} />
          <ul className="perks"><li>Free shipping over {money(config.freeShippingOver)}</li><li>{config.codEnabled ? 'Cash on delivery' : 'UPI & cards'}</li><li>{config.returnDays}-day returns</li></ul>

          <div className="details">
            <details open><summary>Description</summary><div className="body">{p.description}</div></details>
            <details><summary>Fabric &amp; care</summary><div className="body"><p><b>Fabric:</b> {p.fabric}</p><p>{p.care}</p></div></details>
            <details><summary>Delivery &amp; returns</summary><div className="body">Ships in 1–2 working days, delivered in 3–7 days across India. Return or exchange within {config.returnDays} days of delivery. <a className="link" href="/policies#returns">Read the policy</a>.</div></details>
            <details><summary>Product details</summary><div className="body">SKU: {variant?.sku || p.variants[0]?.sku} · HSN {p.hsn} · Country of origin: India<br />Marketed by {config.sellerName}, {config.sellerAddress} · Customer care: {config.supportPhone}</div></details>
          </div>
        </div>
      </div>

      {similar.length > 0 && (
        <section className="block">
          <div className="block-head"><div><span className="mono idx">More</span><SplitText as="h2" text="You may also like" inView stagger={0.05} /></div></div>
          <Stagger className="stag-grid" gap={0.1}>{similar.map((s) => <Item key={s.id} className="stag-item"><ProductCard p={s} /></Item>)}</Stagger>
        </section>
      )}

      <div className="mobile-buy">
        <div><b>{money(p.price)}</b>{off > 0 && <s>{money(p.mrp)}</s>}</div>
        <button className="btn" disabled={!!size && !canAdd} onClick={add}>{label}</button>
      </div>
    </div>
  );
}
