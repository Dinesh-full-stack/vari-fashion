import { Fragment, useRef } from 'react';
import { LazyMotion, MotionConfig, domAnimation, m, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion';

export const ease = [0.22, 0.61, 0.36, 1];

/** Loads only the small animation feature set, and switches movement off for visitors who ask for reduced motion. */
export function MotionRoot({ children }) {
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict>{children}</LazyMotion></MotionConfig>;
}

/** Fades and lifts its content when it scrolls into view. */
export function Reveal({ as = 'div', delay = 0, y = 32, className, children, ...rest }) {
  const Tag = m[as];
  return (
    <Tag className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }} transition={{ duration: 0.85, ease, delay }} {...rest}>
      {children}
    </Tag>
  );
}

/** A group whose direct <Item> children arrive one after another as the group scrolls into view. */
export function Stagger({ as = 'div', gap = 0.09, delay = 0, className, children, ...rest }) {
  const Tag = m[as];
  return (
    <Tag className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }} {...rest}>
      {children}
    </Tag>
  );
}
export function Item({ as = 'div', y = 44, className, children, ...rest }) {
  const Tag = m[as];
  return (
    <Tag className={className} variants={{ hidden: { opacity: 0, y }, show: { opacity: 1, y: 0, transition: { duration: 0.9, ease } } }} {...rest}>
      {children}
    </Tag>
  );
}

/** Headline whose words rise out of a mask, one by one. Plays on load, or when scrolled to if inView is set. */
export function SplitText({ text, as = 'h1', className, delay = 0, stagger = 0.06, inView = false }) {
  const Tag = m[as];
  const words = String(text || '').split(' ').filter(Boolean);
  const trigger = inView ? { whileInView: 'show', viewport: { once: true, margin: '0px 0px -10% 0px' } } : { animate: 'show' };
  return (
    <Tag className={className} aria-label={text} initial="hidden" {...trigger}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="sw" aria-hidden="true">
            <m.span className="sw-in" variants={{ hidden: { y: '115%', rotate: 3 }, show: { y: 0, rotate: 0, transition: { duration: 1, ease } } }}>{w}</m.span>
          </span>{' '}
        </Fragment>
      ))}
    </Tag>
  );
}

/** Pulls its child gently towards the pointer. */
export function Magnetic({ children, strength = 0.3, className }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.4 });
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const leave = () => { x.set(0); y.set(0); };
  return <m.span ref={ref} className={className} style={{ x: sx, y: sy, display: 'inline-flex' }} onMouseMove={move} onMouseLeave={leave}>{children}</m.span>;
}

/** An image frame whose picture drifts slower than the page as it scrolls past. */
export function Parallax({ children, amount = 7, className }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [`${amount}%`, `-${amount}%`]);
  return (
    <div ref={ref} className={`parallax ${className || ''}`}>
      <m.div className="parallax-in" style={{ y }}>{children}</m.div>
    </div>
  );
}

function Word({ word, progress, from, to }) {
  const opacity = useTransform(progress, [from, to], [0.16, 1]);
  return <><m.span style={{ opacity }}>{word}</m.span>{' '}</>;
}

/** Text that lights up word by word as the section scrolls through the screen. */
export function WordScroll({ text, className }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.55'] });
  const words = String(text || '').split(' ').filter(Boolean);
  return (
    <p ref={ref} className={className} aria-label={text}>
      {words.map((w, i) => <Word key={i} word={w} progress={scrollYProgress} from={i / words.length} to={Math.min(1, (i + 1.6) / words.length)} />)}
    </p>
  );
}

export { m };
