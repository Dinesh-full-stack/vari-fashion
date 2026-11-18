import { Link } from 'react-router-dom';
import { cut, money, offPct } from '../lib.js';

/** A frosted-glass product card. The garment floats on the glass; the sheen sweeps across on hover. */
export default function ProductCard({ p, eager = false }) {
  const off = offPct(p);
  const few = !p.soldOut && p.variants.filter((v) => v.available).length <= 2;
  const first = cut(p.colors[0]?.images[0] || p.image);
  const second = p.colors[1]?.images[0] ? cut(p.colors[1].images[0]) : null;
  return (
    <Link className="card glass" to={`/product/${p.slug}`}>
      <div className="media">
        <img src={first} alt={p.name} loading={eager ? 'eager' : 'lazy'} width="600" height="800" />
        {second && <img className="alt" src={second} alt="" loading="lazy" width="600" height="800" />}
        {(p.soldOut || few || off > 0) && <span className={`tag ${p.soldOut ? 'dark' : off && !few ? 'accent' : ''}`}>{p.soldOut ? 'Sold out' : few ? 'Few left' : `${off}% off`}</span>}
      </div>
      <div className="info">
        <div className="top"><span className="name">{p.name}</span><span className="price">{money(p.price)}{off > 0 && <s>{money(p.mrp)}</s>}</span></div>
        <div className="sub">
          <span>{p.category}</span>
          <span className="dots" aria-label={`${p.colors.length} colours`}>{p.colors.slice(0, 4).map((c) => <i key={c.name} style={{ background: c.hex }} title={c.name} />)}{p.colors.length > 4 && <em>+{p.colors.length - 4}</em>}</span>
        </div>
      </div>
    </Link>
  );
}
