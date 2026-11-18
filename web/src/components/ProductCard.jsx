import { Link } from 'react-router-dom';
import { money, offPct } from '../lib.js';

export default function ProductCard({ p, eager = false }) {
  const off = offPct(p);
  const few = !p.soldOut && p.variants.filter((v) => v.available).length <= 2;
  const first = p.colors[0]?.images[0] || p.image;
  const second = p.colors[1]?.images[0];
  return (
    <Link className="card" to={`/product/${p.slug}`}>
      <div className="media">
        <img src={first} alt={p.name} loading={eager ? 'eager' : 'lazy'} width="600" height="800" />
        {second && <img className="alt" src={second} alt="" loading="lazy" width="600" height="800" />}
        {p.soldOut ? <span className="tag dark">Sold out</span> : few ? <span className="tag">Only a few left</span> : off ? <span className="tag accent">{off}% off</span> : null}
      </div>
      <div className="info">
        <div className="name">{p.name}</div>
        <div className="sub">
          <span>{p.category}</span>
          <span className="dots" aria-label={`${p.colors.length} colours`}>{p.colors.slice(0, 4).map((c) => <i key={c.name} style={{ background: c.hex }} title={c.name} />)}{p.colors.length > 4 && <em>+{p.colors.length - 4}</em>}</span>
        </div>
        <div className="price"><b>{money(p.price)}</b>{off > 0 && <s>{money(p.mrp)}</s>}</div>
      </div>
    </Link>
  );
}
