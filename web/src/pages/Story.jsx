import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api, cut, money, useTitle } from '../lib.js';
import { Item, Reveal, Stagger } from '../motion.jsx';

const LABELS = {
  hero: 'A finished piece being worn, or the workshop at work',
  'workshop-cutting': 'The cutting table',
  'workshop-stitching': 'A tailor at the machine',
  'workshop-checking': 'Someone checking a finished piece',
  'detail-1': 'A close-up: fabric, stitching or a label',
  team: 'The workshop team together',
  'shop-erode': 'The shop in Erode',
};

/** A photo from public/media/. Until the real file is uploaded it shows the drawing, and failing that a labelled empty frame. */
function Photo({ name, alt, fig, caption, eager = false, className = '' }) {
  const [stage, setStage] = useState(0);
  const src = stage === 0 ? `/media/${name}.jpg` : `/media/illustrations/${name}.svg`;
  return (
    <figure className={`photo glass ${className}`}>
      {stage < 2
        ? <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} onError={() => setStage((s) => s + 1)} />
        : <div className="frame-empty"><span><b>Photo goes here</b>{LABELS[name]}<br />public/media/{name}.jpg</span></div>}
      <figcaption><span>Fig. {fig}</span> {caption}{stage === 1 && <em> Illustration, photo coming soon</em>}</figcaption>
    </figure>
  );
}

export default function Story() {
  const { config: c } = useApp();
  const [products, setProducts] = useState(null);
  useTitle(`Our story — ${c.brand}`);
  useEffect(() => { api('/api/products').then((p) => setProducts(p.filter((x) => !x.soldOut).slice(0, 6))).catch(() => setProducts([])); }, []);
  const address = c.sellerAddress && !/replace/i.test(c.sellerAddress) ? c.sellerAddress : 'Shop address (set in Admin › Settings)';

  return (
    <div className="story-page">
      <div className="wrap">
        <div className="masthead mono"><span>Issue No. 01</span><span>Erode &amp; Tiruppur, Tamil Nadu</span><span>Since 2019</span></div>

        <section className="opening">
          <Reveal className="opening-photo"><Photo name="hero" alt={`${c.brand} clothes`} fig="1" caption="Our workshop in Tiruppur." eager /></Reveal>
          <div className="opening-copy">
            <Reveal as="h1" y={26}>Stitched in Tiruppur. <em>Sold from our little shop in Erode.</em></Reveal>
            <Reveal as="p" className="lede" delay={0.1}>{c.brand} is a small label run by a few friends and one family workshop. Around ten tailors make everything we sell, and every piece is checked by hand before it's folded.</Reveal>
            <Reveal delay={0.2} className="actions"><Link className="btn" to="/shop">Shop the collection <span aria-hidden="true">→</span></Link><a className="link" href="#letter">Read how we started</a></Reveal>
          </div>
        </section>

        <Reveal as="section" className="letter panel glass" id="letter">
          <aside><span className="eyebrow">A note from us</span></aside>
          <div>
            <h2>How {c.brand} started</h2>
            <div className="columns">
              <p>In 2019 a few of us stopped talking about starting a clothing label and actually started one. We already knew Tiruppur. A huge share of the clothes made in India get stitched there, mostly in big units turning out thousands of the same piece.</p>
              <p>We wanted the opposite. A small room, a handful of machines, and people who would still be there next year. So we set up a family workshop in Tiruppur. Today it's around ten people: tailors, a cutter, and someone whose job is to say “no, do that seam again”.</p>
              <p>We make things in small runs. If a style sells, we make a little more. If it doesn't, we learn something and move on. Nothing sits in a warehouse for years.</p>
              <p>Finished pieces travel about an hour up the road to our shop in Erode. That's where most of our customers have met us so far. They come in, feel the cloth, try things on and tell us what they'd change. This website is how we bring that shop to people who can't drop in.</p>
            </div>
            <p className="signoff">— The {c.brand} team, Erode</p>
          </div>
        </Reveal>

        <Stagger className="towns" gap={0.15} aria-label="Where we make and sell">
          <Item className="town panel glass"><span className="eyebrow">Where it's made</span><h3>Tiruppur</h3><p>Our family workshop. Cutting, stitching, checking and packing all happen in one place, under one roof.</p></Item>
          <Item className="route" aria-hidden="true">
            <svg viewBox="0 0 400 120"><path d="M10 92 C 90 20, 170 110, 240 56 S 350 30, 390 30" /><circle cx="10" cy="92" r="5" /><circle cx="390" cy="30" r="5" /><text x="200" y="114" textAnchor="middle">about an hour by road</text></svg>
          </Item>
          <Item className="town panel glass"><span className="eyebrow">Where you'll find us</span><h3>Erode</h3><p>Our shop. Come in, try things on, and say hello.</p></Item>
        </Stagger>

        <section className="making" aria-label="How a piece gets made">
          <div className="block-head"><Reveal as="h2" y={20}>How a piece gets made</Reveal></div>
          <div className="making-grid">
            <Reveal className="m-photo"><Photo name="workshop-cutting" alt="Cutting fabric" fig="2" caption="The cutting table." /></Reveal>
            <Reveal className="m-step panel glass" delay={0.08}><b>1</b><h3>Cut in small batches</h3><p>Fabric is laid out and cut a few dozen pieces at a time, so we're never sitting on a thousand of one shirt.</p></Reveal>
            <Reveal className="m-photo"><Photo name="workshop-stitching" alt="Stitching at the machine" fig="3" caption="Stitching, Tiruppur." /></Reveal>
            <Reveal className="m-step panel glass" delay={0.08}><b>2</b><h3>Stitched by people, not a line</h3><p>Each piece goes through the hands of our tailors. Ten people, not a floor of three hundred.</p></Reveal>
            <Reveal className="m-step panel glass"><b>3</b><h3>Checked before it's folded</h3><p>Seams, buttons and measurements are checked against the size chart. Anything that isn't right goes back to the machine.</p></Reveal>
            <Reveal className="m-photo"><Photo name="workshop-checking" alt="Checking a finished piece" fig="4" caption="Final check." /></Reveal>
            <Reveal className="m-step panel glass"><b>4</b><h3>Then to Erode, and to you</h3><p>Finished pieces go to our shop, and online orders are packed by the same people who sell over the counter.</p></Reveal>
          </div>
        </section>

        <section className="pull">
          <Reveal as="blockquote" y={30}>“If we wouldn't wear it ourselves, it doesn't go on the shelf.”</Reveal>
          <Reveal className="pull-photo"><Photo name="detail-1" alt="Close-up of stitching" fig="5" caption="Detail." /></Reveal>
        </section>

        <section className="spread" id="collection" aria-label="The collection">
          <div className="block-head"><Reveal as="h2" y={20}>This season</Reveal><Link className="link-pill glass" to="/shop">See all pieces <span aria-hidden="true">→</span></Link></div>
          {products === null ? <div className="sk" style={{ height: 300 }} /> : products.length
            ? (
              <Stagger className="spread-grid" gap={0.08}>
                {products.map((p, i) => (
                  <Item key={p.id}>
                    <Link className="sp glass" to={`/product/${p.slug}`}>
                      <div className="media"><img src={cut(p.image)} alt={p.name} loading="lazy" width="600" height="800" /></div>
                      <div className="cap"><div><span className="no mono">No. {String(i + 1).padStart(2, '0')}</span><span className="nm">{p.name}</span></div><span className="pr">{money(p.price)}</span></div>
                    </Link>
                  </Item>
                ))}
              </Stagger>
            )
            : <p><Link className="link" to="/shop">See the collection</Link></p>}
        </section>

        <section className="people">
          <Reveal className="people-photo"><Photo name="team" alt={`The ${c.brand} workshop team`} fig="6" caption="The workshop, Tiruppur." /></Reveal>
          <Reveal className="people-copy" delay={0.1}>
            <span className="eyebrow">The people</span>
            <h2>Around ten of us, most of us family.</h2>
            <p>There's no factory floor here, just a workshop where everyone knows everyone. When you write to us, the person who answers can usually tell you who stitched your order.</p>
          </Reveal>
        </section>

        <section className="visit">
          <Reveal className="visit-photo"><Photo name="shop-erode" alt={`The ${c.brand} shop in Erode`} fig="7" caption="Our shop, Erode." /></Reveal>
          <Reveal className="visit-copy panel glass" delay={0.1}>
            <h2>Come and see us in Erode</h2>
            <p className="addr">{address}</p>
            {c.shopHours && <p className="hours muted">{c.shopHours}</p>}
            {c.whatsapp && <a className="link" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${encodeURIComponent(c.whatsapp)}`}>Message us on WhatsApp</a>}
            <ul className="facts">
              <li><b>Delivery</b> <span>{c.freeShippingOver ? `Free above ${money(c.freeShippingOver)}, anywhere in India` : 'Anywhere in India'}</span></li>
              <li><b>Payment</b> <span>UPI, cards, net banking or cash on delivery</span></li>
              <li><b>Returns</b> <span>Exchange or refund within {c.returnDays} days of delivery</span></li>
              <li><b>Buying more?</b> <span><a className="link" href="/bulk">Ask us for a bulk price</a></span></li>
            </ul>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
