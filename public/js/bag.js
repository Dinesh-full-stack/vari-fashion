import { boot, bag, money, quoteBag, lineHtml, onLineClick } from './common.js';

const config = await boot();
const $ = (s) => document.querySelector(s);
const lines = $('[data-lines]');
const summary = $('[data-summary]');
lines.addEventListener('click', onLineClick);

async function render() {
  const items = bag.items();
  if (!items.length) {
    lines.innerHTML = `<div class="empty"><h3>Your bag is empty</h3><p>Pieces you add will wait for you here.</p><a class="btn" href="/shop" style="margin-top:16px">Explore the collection</a></div>`;
    summary.hidden = true;
    return;
  }
  summary.hidden = false;
  let q = null;
  try { q = await quoteBag(); } catch { /* fall back to stored prices */ }
  const issues = q?.issues || {};
  lines.innerHTML = items.map((i) => lineHtml(i, issues[i.variantId], Math.min(config.maxQty, issues[i.variantId]?.maxQty || config.maxQty))).join('');
  const sub = q ? q.itemsPaise : items.reduce((s, i) => s + i.price * i.qty, 0);
  const ship = q ? q.shippingPaise : 0;
  const blocked = Object.keys(issues).length > 0;
  summary.innerHTML = `
    <h2 style="font-size:28px">Summary</h2>
    <div class="row"><span>Subtotal</span><span>${money(sub)}</span></div>
    <div class="row"><span>Shipping</span><span>${ship ? money(ship) : 'Free'}</span></div>
    ${sub < config.freeShippingOver ? `<div class="ship-meter">Add ${money(config.freeShippingOver - sub)} more for free shipping</div>` : ''}
    <div class="row total"><span>Total</span><span>${money(sub + ship)}</span></div>
    <div class="tax-note">Includes GST. Cash on delivery fee, if any, is shown at checkout.</div>
    ${blocked ? '<p class="notice err">Some items need your attention before checkout.</p>' : ''}
    <a class="btn block" href="/checkout" ${blocked ? 'data-blocked aria-disabled="true" style="opacity:.5"' : ''}>Checkout <span class="arrow">→</span></a>
    <p class="bulk-hint">Buying more than ${config.maxQty} of an item? <a class="link" href="/bulk">Request a bulk quote</a>.</p>`;
}

document.addEventListener('bag:change', render);
render();
