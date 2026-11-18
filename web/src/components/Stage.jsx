import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useApp } from '../app-context.jsx';
import { bag, cut, money } from '../lib.js';
import { ease, m } from '../motion.jsx';
import { Icon } from './Layout.jsx';

const mod = (a, n) => ((a % n) + n) % n;
const XS_DESKTOP = [0, 0.215, 0.345, 0.432, 0.49, 0.52];
const XS_PHONE = [0, 0.36, 0.5, 0.56, 0.6, 0.62];
const across = (t, table) => {
  const i = Math.min(table.length - 2, Math.floor(t));
  return table[i] + (table[i + 1] - table[i]) * Math.min(1, t - i);
};
const isTyping = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

function useReduced() {
  const [r, setR] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}

/** Text that rolls up and out when it changes. */
function Roll({ text, className = '' }) {
  return (
    <span className={`ln ${className}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <m.span key={text} style={{ display: 'block' }} initial={{ y: '110%' }} animate={{ y: 0 }} exit={{ y: '-110%' }} transition={{ duration: 0.62, ease }}>{text}</m.span>
      </AnimatePresence>
    </span>
  );
}

/** The round glass cursor: TRY ON over a card, DRAG over empty space. Only on devices with a mouse. */
function Cursor({ stageRef }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!matchMedia('(pointer:fine)').matches) return undefined;
    const stage = stageRef.current;
    const el = ref.current;
    const st = { x: 0, y: 0, tx: 0, ty: 0 };
    const move = (e) => {
      st.tx = e.clientX; st.ty = e.clientY;
      const t = e.target;
      el.dataset.mode = t.closest('[data-card]') ? 'try' : t.closest('button, a, input, [data-nodrag]') ? 'btn' : 'drag';
      el.classList.add('show');
    };
    const leave = () => el.classList.remove('show');
    const down = () => el.classList.add('down');
    const up = () => el.classList.remove('down');
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    stage.addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    let raf;
    const loop = () => {
      st.x += (st.tx - st.x) * 0.22; st.y += (st.ty - st.y) * 0.22;
      el.style.transform = `translate(${st.x - 29}px, ${st.y - 29}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerleave', leave); stage.removeEventListener('pointerdown', down);
      removeEventListener('pointerup', up);
    };
  }, [stageRef]);
  return (
    <div className="cur" ref={ref} data-mode="drag" aria-hidden="true">
      <span className="ring" /><span className="dot" /><span className="t-try">TRY ON</span><span className="t-drag">DRAG</span>
    </div>
  );
}

export default function Stage({ products }) {
  const { config, toast, openBag } = useApp();
  const reduced = useReduced();
  // The arc loops, so it needs enough cards to wrap around; short catalogues repeat.
  const cards = useMemo(() => (products.length ? Array.from({ length: Math.max(8, products.length) }, (_, i) => products[i % products.length]) : []), [products]);
  const N = cards.length;
  const lite = useMemo(() => innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4, []);

  const stageRef = useRef(null);
  const cardEls = useRef([]);
  const curRef = useRef(null);
  const nextRef = useRef(null);
  const gridRef = useRef(null);
  const scanRef = useRef(null);
  const anims = useRef([]);
  const S = useRef({ pos: 0, target: 0, intro: 0, dragging: false, drag: null, px: 0, py: 0, sx: 0, sy: 0, W: 1, H: 1, phone: false, shown: -1 }).current;

  const [shownIdx, setShownIdx] = useState(0);
  const item = cards[shownIdx % Math.max(1, N)];
  const [sel, setSel] = useState({ color: null, size: null });
  useEffect(() => { if (item) setSel({ color: item.colors[0].name, size: null }); }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const color = item ? (item.colors.find((c) => c.name === sel.color) || item.colors[0]) : null;
  const figSrc = item ? cut(color.images[0] || item.image) : '';

  // ---- Try-on: a scan line sweeps down the figure and reveals the new garment ----
  useEffect(() => {
    const cur = curRef.current; const next = nextRef.current;
    if (!figSrc || !cur || cur.dataset.src === figSrc) return;
    anims.current.forEach((a) => a.cancel());
    if (reduced) { cur.src = figSrc; cur.dataset.src = figSrc; cur.style.opacity = 1; return; }
    next.src = figSrc;
    const o = { duration: 950, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' };
    const a1 = next.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], o);
    const a2 = gridRef.current.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)', offset: 0.5 }, { clipPath: 'inset(100% 0 0 0)' }], { ...o, duration: 1092 });
    const a3 = scanRef.current.animate([
      { top: '0%', transform: 'scaleX(.2)', opacity: 0 }, { top: '6%', transform: 'scaleX(1)', opacity: 1, offset: 0.08 },
      { top: '94%', transform: 'scaleX(1)', opacity: 1, offset: 0.92 }, { top: '100%', transform: 'scaleX(.2)', opacity: 0 }], o);
    const a4 = next.animate([{ transform: 'scale(1.012)' }, { transform: 'scale(1)' }], { duration: 1250, easing: 'ease-out', fill: 'forwards' });
    anims.current = [a1, a2, a3, a4];
    a1.onfinish = () => {
      cur.src = figSrc; cur.dataset.src = figSrc; cur.style.opacity = 1;
      (cur.decode ? cur.decode() : Promise.resolve()).catch(() => {}).then(() => anims.current.forEach((a) => a.cancel()));
    };
  }, [figSrc, reduced]);

  // ---- The arc: one animation frame loop moves every card ----
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !N) return undefined;
    const measure = () => { const r = stage.getBoundingClientRect(); S.W = r.width; S.H = r.height; S.phone = innerWidth < 768; };
    measure();
    addEventListener('resize', measure);
    const seeds = cards.map((_, i) => i * 1.7);
    const half = N / 2;
    let raf = 0;
    let visible = true;

    const frame = (now) => {
      const t = now / 1000;
      if (!S.dragging) S.pos += (S.target - S.pos) * (reduced ? 1 : 0.11);
      S.intro = Math.min(1, S.intro + (reduced ? 1 : 0.012));
      const ie = 1 - (1 - S.intro) ** 3;
      S.sx += (S.px - S.sx) * 0.06; S.sy += (S.py - S.sy) * 0.06;
      const XS = S.phone ? XS_PHONE : XS_DESKTOP;
      for (let i = 0; i < N; i++) {
        const el = cardEls.current[i];
        if (!el) continue;
        const u = mod(i - S.pos + half, N) - half;
        const a = Math.abs(u);
        const sg = u < 0 ? -1 : 1;
        const x = sg * across(Math.min(a, 5), XS) * S.W * ie;
        let s; let z; let op; let ry; let blur = 0;
        if (a < 1) { s = 0.55 + 0.45 * a; z = -260 * (1 - a); op = a; ry = -sg * 16 * a; }
        else { s = 1 / (1 + 0.3 * (a - 1) ** 1.15); z = -110 * (a - 1); op = 1; ry = -sg * (16 + 9 * Math.min(2, a - 1)); blur = Math.max(0, a - 1.6) * 2.4; }
        if (a > 3.4) op = Math.max(0, 1 - (a - 3.4) / 0.8);
        const bob = reduced ? 0 : Math.sin(t * 1.1 + seeds[i]) * S.H * 0.006 * Math.min(1, a);
        const y = bob - (1 - s) * S.H * 0.04;
        ry += S.sx * 10;
        const o = op * ie;
        el.style.transform = `translate(${x}px, ${y}px) perspective(1300px) translateZ(${z}px) rotateY(${ry}deg) rotateX(${-S.sy * 6}deg) scale(${s * (0.6 + 0.4 * ie)})`;
        el.style.opacity = o;
        el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
        el.style.zIndex = a < 1 ? 1 : Math.round(100 - 10 * a);
        el.style.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';
      }
      stage.style.setProperty('--ie', ie.toFixed(4));
      stage.style.setProperty('--sx', S.sx.toFixed(4));
      stage.style.setProperty('--sy', S.sy.toFixed(4));
      if (!S.dragging && Math.abs(S.target - S.pos) < 0.02) {
        const idx = mod(Math.round(S.target), N);
        if (idx !== S.shown) { S.shown = idx; setShownIdx(idx); }
      }
      raf = visible ? requestAnimationFrame(frame) : 0;
    };
    raf = requestAnimationFrame(frame);

    // Stop spending frames while the arc is scrolled out of view.
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); });
    io.observe(stage);
    const onPointer = (e) => {
      const r = stage.getBoundingClientRect();
      S.px = (e.clientX - r.left) / r.width - 0.5; S.py = (e.clientY - r.top) / r.height - 0.5;
    };
    stage.addEventListener('pointermove', onPointer);
    return () => { cancelAnimationFrame(raf); io.disconnect(); removeEventListener('resize', measure); stage.removeEventListener('pointermove', onPointer); };
  }, [N, reduced, cards, S]);

  // ---- Input: drag, flick, wheel, keys ----
  const step = (dir) => { S.target = Math.round(S.target) + dir; };
  const toCard = (i) => { const u = mod(i - S.pos + N / 2, N) - N / 2; S.target = Math.round(S.pos + u); };

  const onPointerDown = (e) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('[data-nodrag]')) return;
    const px = (S.phone ? XS_PHONE : XS_DESKTOP)[1] * S.W;
    const d = { x0: e.clientX, p0: S.pos, lastX: e.clientX, lastT: performance.now(), v: 0, moved: 0, card: e.target.closest('[data-card]'), px };
    S.drag = d; S.dragging = true;
    const move = (ev) => {
      const dx = ev.clientX - d.x0;
      d.moved = Math.max(d.moved, Math.abs(dx));
      S.pos = d.p0 - dx / d.px;
      const now = performance.now();
      d.v = (ev.clientX - d.lastX) / Math.max(1, now - d.lastT);
      d.lastX = ev.clientX; d.lastT = now;
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      S.dragging = false;
      if (d.moved < 6 && d.card) toCard(Number(d.card.dataset.i));
      else S.target = Math.round(S.pos - Math.max(-6, Math.min(6, (d.v / d.px) * 144 * 3.2)));
      S.drag = null;
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let acc = 0; let last = 0;
    const wheel = (e) => {
      // Sideways swipes step through garments; plain vertical scrolling still scrolls the page.
      if (!(Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) return;
      e.preventDefault();
      acc += e.deltaX || e.deltaY;
      const now = performance.now();
      if (Math.abs(acc) > 60 && now - last > 260) { step(acc > 0 ? 1 : -1); acc = 0; last = now; }
    };
    const key = (e) => {
      if (isTyping(document.activeElement) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const r = stage.getBoundingClientRect();
      if (r.bottom < innerHeight * 0.3 || r.top > innerHeight * 0.7) return;
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    addEventListener('keydown', key);
    return () => { stage.removeEventListener('wheel', wheel); removeEventListener('keydown', key); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!N) return null;
  const word = String(config.brand).split(' ')[0].toUpperCase();
  const sizes = [...new Set(item.variants.map((v) => v.size))];
  const variantFor = (size) => item.variants.find((v) => v.color === color.name && v.size === size);
  const variant = sel.size ? variantFor(sel.size) : null;
  const label = !config.storeOpen ? 'Store closed' : !sel.size ? 'Choose a size' : !variant?.available ? 'Sold out' : 'Add to bag';
  const add = () => {
    if (!sel.size) { toast('Pick a size first'); return; }
    if (!variant?.available || !config.storeOpen) return;
    bag.add({ variantId: variant.id, productId: item.id, slug: item.slug, name: item.name, color: variant.color, size: variant.size, price: item.price, image: color.images[0], qty: 1 }, config.maxQty);
    toast(`Added ${item.name} (${variant.size}) to your bag`);
    openBag();
  };

  return (
    <section className={`stage ${lite ? 'lite' : ''}`} ref={stageRef} onPointerDown={onPointerDown} aria-roledescription="carousel" aria-label="Garments you can try on">
      <h1 className="sr-only">{item.name} — {config.brand}</h1>
      <div className="ghost" aria-hidden="true">{word.split('').map((ch, i) => <span key={i} style={{ '--k': i }}>{ch}</span>)}</div>

      <div className="arc">
        {cards.map((p, i) => (
          <button key={i} type="button" data-card data-i={i} className="gcard glass" ref={(el) => { cardEls.current[i] = el; }}
            aria-label={`${p.name}, ${money(p.price)}`} onClick={(e) => { if (e.detail === 0) toCard(i); }}>
            <span className="sheen" />
            <img className="g" src={cut(p.colors[0].images[0] || p.image)} alt="" draggable="false" />
            <span className="gname">{p.name}</span>
            <span className="gprice">{money(p.price)}</span>
          </button>
        ))}
      </div>

      <div className="floor" aria-hidden="true" />
      <div className="model" aria-hidden="true">
        <img ref={curRef} className="fig cur-fig" alt="" draggable="false" style={{ opacity: 0 }} />
        <img ref={nextRef} className="fig next-fig" alt="" draggable="false" />
        <div ref={gridRef} className="scan-grid" />
        <div ref={scanRef} className="scan" />
      </div>

      <button type="button" className="arrow left glass" data-nodrag aria-label="Previous garment" onClick={() => step(-1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <button type="button" className="arrow right glass" data-nodrag aria-label="Next garment" onClick={() => step(1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m9 5 7 7-7 7" /></svg>
      </button>

      <div className="rail glass" data-nodrag>
        <Link className="on" to="/shop" aria-label="Shop all" title="Shop all">{Icon.grid}</Link>
        <button type="button" onClick={openBag} aria-label="Open bag" title="Bag">{Icon.bag}</button>
        <a href="/track" aria-label="Track an order" title="Track an order">{Icon.truck}</a>
        <a href="/account" aria-label="My account" title="My account">{Icon.user}</a>
      </div>

      <div className="buy glass" data-nodrag>
        <m.div className="b-thumb" key={item.id} initial={{ y: '70%', scale: 0.8 }} animate={{ y: 0, scale: 1 }} transition={{ duration: 0.65, ease }}>
          <img src={cut(item.colors[0].images[0] || item.image)} alt="" draggable="false" />
        </m.div>
        <div className="b-info"><Roll text={item.name} className="b-name" /><Roll text={money(item.price)} className="b-price" /></div>
        <div className="b-size" role="group" aria-label="Size">
          <span>Size</span>
          <div className="chips">{sizes.map((s) => (
            <button key={s} type="button" aria-pressed={sel.size === s} disabled={!variantFor(s)?.available} onClick={() => setSel((v) => ({ ...v, size: s }))}>{s}</button>
          ))}</div>
        </div>
        <div className="b-color">
          <span className="lbl">Color · <Roll text={color.name} /></span>
          <div className="cdots" role="group" aria-label="Colour">{item.colors.map((c) => (
            <button key={c.name} type="button" aria-pressed={c.name === color.name} aria-label={c.name} title={c.name} style={{ background: c.hex }}
              onClick={() => setSel((v) => ({ color: c.name, size: item.variants.find((x) => x.color === c.name && x.size === v.size)?.available ? v.size : null }))} />
          ))}</div>
        </div>
        <div className="b-act">
          <button type="button" className="btn" disabled={!!sel.size && !variant?.available} onClick={add}>{label}</button>
          <Link className="b-more" to={`/product/${item.slug}`}>Details</Link>
        </div>
      </div>

      <Cursor stageRef={stageRef} />
    </section>
  );
}
