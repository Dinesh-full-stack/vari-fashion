import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { Icon } from '../components/Layout.jsx';
import { useApp } from '../app-context.jsx';
import { api, money, useTitle } from '../lib.js';
import { Reveal } from '../motion.jsx';

const PRICES = [[0, 1499], [1500, 2499], [2500, 3999], [4000, 0]];
const priceLabel = ([lo, hi]) => (hi ? `${money(lo * 100)} – ${money(hi * 100)}` : `${money(lo * 100)} and above`);
const SORTS = [['featured', 'Featured'], ['new', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['discount', 'Biggest discount']];
const list = (v) => (v ? v.split(',') : []);

export default function Shop() {
  const { config } = useApp();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(false);

  useEffect(() => { api('/api/products').then(setProducts).catch((e) => setError(e.message)); }, []);

  const f = {
    q: (params.get('q') || '').trim(), cats: list(params.get('c')), sizes: list(params.get('s')), colors: list(params.get('col')),
    min: Number(params.get('min')) || 0, max: Number(params.get('max')) || 0, stock: params.get('stock') === '1', sort: params.get('sort') || 'featured',
  };
  const patch = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === '' || v === 0 || v === false || (Array.isArray(v) && !v.length) || v === 'featured') next.delete(k);
      else next.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : String(v));
    }
    setParams(next, { replace: true });
  };
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const matches = (p, skip) => {
    if (f.q) {
      const hay = `${p.name} ${p.category} ${p.tagline} ${p.colors.map((c) => c.name).join(' ')}`.toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    if (skip !== 'cat' && f.cats.length && !f.cats.includes(p.category)) return false;
    if (skip !== 'size' && f.sizes.length && !p.variants.some((v) => f.sizes.includes(v.size) && v.available)) return false;
    if (skip !== 'color' && f.colors.length && !p.colors.some((c) => f.colors.includes(c.name))) return false;
    if (skip !== 'price' && f.max && p.price > f.max * 100) return false;
    if (skip !== 'price' && f.min && p.price < f.min * 100) return false;
    if (f.stock && p.soldOut) return false;
    return true;
  };

  const facets = useMemo(() => {
    if (!products) return null;
    const colors = [];
    products.forEach((p) => p.colors.forEach((c) => { if (!colors.find((x) => x.name === c.name)) colors.push(c); }));
    return { cats: [...new Set(products.map((p) => p.category))], sizes: [...new Set(products.flatMap((p) => p.variants.map((v) => v.size)))], colors };
  }, [products]);

  const out = useMemo(() => {
    if (!products) return [];
    const r = products.filter((p) => matches(p));
    const off = (p) => (p.mrp > p.price ? 1 - p.price / p.mrp : 0);
    if (f.sort === 'low') r.sort((a, b) => a.price - b.price);
    else if (f.sort === 'high') r.sort((a, b) => b.price - a.price);
    else if (f.sort === 'new') r.sort((a, b) => b.id - a.id);
    else if (f.sort === 'discount') r.sort((a, b) => off(b) - off(a));
    else r.sort((a, b) => Number(a.soldOut) - Number(b.soldOut));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, params]);

  const title = f.q ? `“${f.q}”` : f.cats.length === 1 ? f.cats[0] : 'All products';
  useTitle(`${title} — ${config.brand}`);
  const count = (skip, test) => (products || []).filter((p) => matches(p, skip) && test(p)).length;

  const chips = [
    ...(f.q ? [['q', `“${f.q}”`, () => patch({ q: '' })]] : []),
    ...f.cats.map((c) => [`c${c}`, c, () => patch({ c: f.cats.filter((x) => x !== c) })]),
    ...f.sizes.map((s) => [`s${s}`, `Size ${s}`, () => patch({ s: f.sizes.filter((x) => x !== s) })]),
    ...f.colors.map((c) => [`col${c}`, c, () => patch({ col: f.colors.filter((x) => x !== c) })]),
    ...(f.min || f.max ? [['price', f.max ? `${money(f.min * 100)} – ${money(f.max * 100)}` : `${money(f.min * 100)}+`, () => patch({ min: 0, max: 0 })]] : []),
    ...(f.stock ? [['stock', 'In stock', () => patch({ stock: false })]] : []),
  ];
  const clear = () => setParams({}, { replace: true });

  const filters = facets && (
    <div className="filters">
      <fieldset><legend>Category</legend>
        {facets.cats.map((c) => <label key={c}><input type="checkbox" checked={f.cats.includes(c)} onChange={() => patch({ c: toggle(f.cats, c) })} /> {c} <span className="count">{count('cat', (p) => p.category === c)}</span></label>)}
      </fieldset>
      <fieldset><legend>Size</legend>
        <div className="chips">{facets.sizes.map((s) => <button type="button" key={s} className="chip" aria-pressed={f.sizes.includes(s)} onClick={() => patch({ s: toggle(f.sizes, s) })}>{s}</button>)}</div>
      </fieldset>
      <fieldset><legend>Price</legend>
        {PRICES.map(([lo, hi]) => (
          <label key={lo}><input type="radio" name="price" checked={f.min === lo && f.max === hi} onChange={() => patch({ min: lo, max: hi })} /> {priceLabel([lo, hi])} <span className="count">{count('price', (p) => p.price >= lo * 100 && (!hi || p.price <= hi * 100))}</span></label>
        ))}
      </fieldset>
      <fieldset><legend>Colour</legend>
        <div className="swatches">{facets.colors.map((c) => <button type="button" key={c.name} className="swatch" aria-pressed={f.colors.includes(c.name)} aria-label={c.name} title={c.name} onClick={() => patch({ col: toggle(f.colors, c.name) })}><span style={{ background: c.hex }} /></button>)}</div>
      </fieldset>
      <label className="switch"><input type="checkbox" checked={f.stock} onChange={(e) => patch({ stock: e.target.checked })} /> Hide sold out</label>
    </div>
  );

  return (
    <div className="wrap shop">
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><b>Shop</b></nav>
          <Reveal as="h1" key={title} y={22}>{title}</Reveal>
          <span className="muted">{products ? `${out.length} ${out.length === 1 ? 'piece' : 'pieces'}` : ' '}</span>
        </div>
        <div className="shop-tools">
          <form className="search-pill glass" role="search" onSubmit={(e) => e.preventDefault()}>
            {Icon.search}
            <input type="search" value={f.q} onChange={(e) => patch({ q: e.target.value })} placeholder="Search this shop" aria-label="Search this shop" />
          </form>
          <button className="btn glass-btn filter-btn" onClick={() => setPanel(true)}>Filters{chips.length ? ` (${chips.length})` : ''}</button>
          <label className="sort glass"><span className="sr-only">Sort by</span>
            <select value={f.sort} onChange={(e) => patch({ sort: e.target.value })}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
      </div>
      {chips.length > 0 && <div className="active-chips">{chips.map(([k, label, rm]) => <button key={k} className="chip on" onClick={rm}>{label} <span aria-hidden="true">✕</span></button>)}<button className="link" onClick={clear}>Clear all</button></div>}

      <div className="shop-body">
        <aside className="shop-side glass" aria-label="Filters">{filters}</aside>
        <div className={`sheet ${panel ? 'open' : ''}`} aria-hidden={!panel}>
          <div className="sheet-card glass"><div className="panel-head"><b>Filters</b><button className="round flat" aria-label="Close filters" onClick={() => setPanel(false)}>{Icon.close}</button></div>
            <div className="sheet-body">{filters}</div>
            <div className="sheet-foot"><button className="btn block" onClick={() => setPanel(false)}>Show {out.length} {out.length === 1 ? 'piece' : 'pieces'}</button></div></div>
          <div className="scrim open" onClick={() => setPanel(false)} />
        </div>

        <div className="shop-results">
          {error && <p className="notice err">{error}</p>}
          {!products && !error && <div className="product-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk card-sk" />)}</div>}
          {products && (out.length
            ? <div className="product-grid shop-grid">{out.map((p, i) => <Reveal key={p.id} y={34} delay={(i % 3) * 0.06}><ProductCard p={p} eager={i < 3} /></Reveal>)}</div>
            : <div className="empty"><h3>No matching products</h3><p>Try removing a filter or searching for something else.</p><button className="btn" onClick={clear}>Clear filters</button></div>)}
        </div>
      </div>
    </div>
  );
}
