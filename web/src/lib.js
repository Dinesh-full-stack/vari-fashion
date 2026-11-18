import { useEffect, useSyncExternalStore } from 'react';

export const money = (paise) => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const offPct = (p) => (p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0);

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
  return data;
}

export function useTitle(title) {
  useEffect(() => { if (title) document.title = title; }, [title]);
}

// ---------- Bag ----------
// Same storage key and item shape as the older pages (bag, checkout), so a bag filled here carries straight through to checkout.
const KEY = 'bag.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
let items = read();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
function write(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: the bag lasts for this visit only */ }
  items = next;
  emit();
}
addEventListener('storage', (e) => { if (e.key === KEY) { items = read(); emit(); } });

export const bag = {
  get: () => items,
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  add(item, max) {
    const next = [...items];
    const found = next.find((i) => i.variantId === item.variantId);
    if (found) next[next.indexOf(found)] = { ...found, qty: Math.min(max, found.qty + item.qty) };
    else next.push({ ...item, qty: Math.min(max, item.qty) });
    write(next);
  },
  setQty: (variantId, qty) => write(items.map((i) => (i.variantId === variantId ? { ...i, qty } : i)).filter((i) => i.qty > 0)),
  remove: (variantId) => write(items.filter((i) => i.variantId !== variantId)),
};
export const useBag = () => useSyncExternalStore(bag.subscribe, bag.get);
export const bagCount = (list) => list.reduce((s, i) => s + i.qty, 0);
