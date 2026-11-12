/** Tiny fixed-window rate limiter keyed by IP. Good enough for one server; swap for a shared store if you scale out. */
export function rateLimit({ windowMs, max, message = 'Too many requests. Please wait a minute and try again.' }) {
  max *= Number(process.env.RATE_LIMIT_MULTIPLIER) || 1; // tests raise this; leave unset in production
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) hits.set(key, { start: now, count: 1 });
    else if (++h.count > max) return res.status(429).json({ error: message });
    next();
  };
}
