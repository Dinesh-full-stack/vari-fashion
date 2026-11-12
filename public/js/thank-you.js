import { boot, esc } from './common.js';

await boot();
const number = new URLSearchParams(location.search).get('order') || '';
let phone = '';
try { const last = JSON.parse(sessionStorage.getItem('lastOrder') || '{}'); if (last.number === number) phone = last.phone; } catch { /* ignore */ }

document.querySelector('[data-thanks]').innerHTML = `
  <span class="eyebrow">Order placed</span>
  <h1 style="font-size:clamp(48px,8vw,110px);margin:16px 0">Thank you.</h1>
  <p style="font-size:18px">Your order number is <b>${esc(number)}</b>.</p>
  <p style="color:var(--muted);max-width:480px;margin:0 auto 32px">We'll send updates to your phone and email. Keep your order number handy to track it or request a return.</p>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
    <a class="btn" href="/track?order=${encodeURIComponent(number)}${phone ? `&phone=${encodeURIComponent(phone)}` : ''}">Track this order</a>
    <a class="btn ghost" href="/shop">Keep shopping</a>
  </div>`;
