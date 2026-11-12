import { boot, api, money, esc } from './common.js';

const config = await boot();
const $ = (s, r = document) => r.querySelector(s);
const form = $('[data-lookup]');
const result = $('[data-result]');
const fmt = (d) => new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const STEPS = [['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
const RETURN_LABEL = { requested: 'Requested — we will review it within 1–2 days', approved: 'Approved — pickup being arranged', received: 'Received — being checked', refunded: 'Refunded', exchanged: 'Exchange sent', rejected: 'Not approved' };

let current = null;

async function lookup(number, phone) {
  $('[data-error]', form).innerHTML = '';
  try {
    current = await api('/api/track', { method: 'POST', body: { number, phone } });
    current.phone = phone;
    render();
  } catch (e) {
    $('[data-error]', form).innerHTML = `<p class="notice err">${esc(e.message)}</p>`;
    result.innerHTML = '';
  }
}

function render() {
  const o = current;
  const idx = STEPS.findIndex(([s]) => s === o.status);
  const stepIdx = o.status === 'delivered' ? 3 : idx;
  const special = ['cancelled', 'rto', 'pending_payment'].includes(o.status);
  result.innerHTML = `
    <div class="card-box">
      <div class="row" style="align-items:baseline;flex-wrap:wrap"><h2 style="font-size:34px">Order ${esc(o.number)}</h2>
        <span class="eyebrow">Placed ${fmt(o.createdAt)}</span></div>
      <p style="font-size:18px;margin-top:8px"><b>${esc(o.statusLabel)}</b>${o.awb ? ` · ${esc(o.courier || 'Courier')} AWB <b>${esc(o.awb)}</b>` : ''}</p>
      ${special ? '' : `<div class="steps">${STEPS.map(([, l], i) => `<div class="${i <= stepIdx ? 'on' : ''}">${l}</div>`).join('')}</div>`}
      ${o.paymentStatus === 'failed' && o.status === 'pending_payment' ? '<p class="notice err">Payment has not gone through yet. If money left your account, it will be confirmed or returned automatically.</p>' : ''}

      ${o.scans.length ? `<h3 style="font-size:24px;margin-top:24px">Courier updates</h3><ol class="timeline">${o.scans.map((s, i) =>
        `<li class="${i === 0 ? 'now' : 'done'}"><div class="t">${esc(s.status)}</div><div class="d">${esc(s.location)} · ${esc(s.at)}</div></li>`).join('')}</ol>` : ''}

      <h3 style="font-size:24px;margin-top:24px">History</h3>
      <ol class="timeline">${[...o.events].reverse().map((e, i) =>
        `<li class="${i === 0 ? 'now' : 'done'}"><div class="t">${esc(e.note || e.status)}</div><div class="d">${fmt(e.created_at)}</div></li>`).join('')}</ol>
    </div>

    <div class="card-box">
      <h3 style="font-size:24px;margin-bottom:12px">Items</h3>
      ${o.items.map((i) => `<div class="line" style="grid-template-columns:64px 1fr auto"><img src="${esc(i.image)}" alt="" style="width:64px">
        <div><a class="n" style="font-size:17px" href="/product/${esc(i.slug)}">${esc(i.name)}</a><div class="meta">${esc(i.color)} · ${esc(i.size)} · Qty ${i.qty}</div></div>
        <div>${money(i.price * i.qty)}</div></div>`).join('')}
      ${o.discount ? `<div class="row" style="margin-top:12px;color:var(--ok)"><span>Coupon ${esc(o.coupon || '')}</span><span>−${money(o.discount)}</span></div>` : ''}
      <div class="row" style="margin-top:12px"><span>Shipping</span><span>${o.shipping ? money(o.shipping) : 'Free'}</span></div>
      ${o.codFee ? `<div class="row"><span>COD fee</span><span>${money(o.codFee)}</span></div>` : ''}
      <div class="row total"><span>Total</span><span>${money(o.total)}</span></div>
      <p class="tax-note">${o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'} · Delivering to ${esc(o.customer.city)}, ${esc(o.customer.state)} ${esc(o.customer.pincode)}</p>
      ${o.invoiceUrl ? `<a class="btn ghost" href="${esc(o.invoiceUrl)}" target="_blank" rel="noopener" style="margin-top:12px">Download invoice</a>` : ''}
    </div>

    ${o.returns.length ? `<div class="card-box"><h3 style="font-size:24px">Your returns</h3>${o.returns.map((r) =>
      `<p style="margin-top:12px"><b>${esc(r.number)}</b> · ${r.type === 'refund' ? 'Refund' : 'Exchange'} · ${esc(RETURN_LABEL[r.status] || r.status)}
        ${r.type === 'refund' && r.refund_paise ? ` · ${money(r.refund_paise)}` : ''}</p>`).join('')}</div>` : ''}

    <div class="card-box" id="return">
      <h3 style="font-size:24px">Return or exchange</h3>
      ${o.canReturn ? returnForm(o) : `<p style="color:var(--muted);margin-top:8px">${o.status === 'delivered'
        ? `The ${config.returnDays}-day return window for this order has closed.`
        : `Returns open once your order is delivered. You'll have ${config.returnDays} days.`}</p>`}
    </div>`;
  if (o.canReturn) bindReturn();
}

function returnForm(o) {
  const until = new Date(o.returnBy).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  return `<p style="color:var(--muted);margin:8px 0 16px">You can request a return until <b>${until}</b>. Items must be unworn with tags attached.</p>
    <form data-return style="display:grid;gap:16px">
      <fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend class="eyebrow" style="margin-bottom:8px">Which items?</legend>
        ${o.items.map((i) => `<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="item" value="${i.id}" data-qty="${i.qty}">
          ${esc(i.name)} (${esc(i.color)}, ${esc(i.size)})${i.qty > 1 ? ` · qty <input type="number" name="qty-${i.id}" min="1" max="${i.qty}" value="${i.qty}" style="width:60px">` : ''}</label>`).join('')}
      </fieldset>
      <div class="pay-options">
        <label class="pay-opt"><input type="radio" name="type" value="exchange" checked><span>Exchange for another size<small>Tell us the size you need below</small></span><span></span></label>
        <label class="pay-opt"><input type="radio" name="type" value="refund"><span>Refund<small>${o.paymentMethod === 'cod' ? 'Sent by UPI after we receive the item' : 'To your original payment method after we receive the item'}</small></span><span></span></label>
      </div>
      <div class="field" data-exsize><label for="exsize">Size you want instead</label><input id="exsize" name="exchangeSize" maxlength="10"></div>
      ${o.paymentMethod === 'cod' ? '<div class="field" data-upi hidden><label for="upi">Your UPI ID for the refund</label><input id="upi" name="refundUpi" placeholder="name@bank"></div>' : ''}
      <div class="field"><label for="reason">Why are you returning it?</label><textarea id="reason" name="reason" required></textarea></div>
      <div data-rerror role="alert"></div>
      <button class="btn" type="submit">Request return</button>
    </form>`;
}

function bindReturn() {
  const f = $('[data-return]');
  f.addEventListener('change', () => {
    const refund = f.elements.type.value === 'refund';
    $('[data-exsize]', f).hidden = refund;
    const upi = $('[data-upi]', f);
    if (upi) upi.hidden = !refund;
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const items = fd.getAll('item').map((id) => ({ itemId: Number(id), qty: Number(fd.get(`qty-${id}`) || 1), exchangeSize: fd.get('exchangeSize') }));
    try {
      const r = await api('/api/returns', { method: 'POST', body: {
        number: current.number, phone: current.phone, type: fd.get('type'), reason: fd.get('reason'), items, refundUpi: fd.get('refundUpi') || '',
      } });
      await lookup(current.number, current.phone);
      $('#return').insertAdjacentHTML('afterbegin', `<p class="notice ok">Return ${esc(r.number)} requested. We'll contact you about pickup.</p>`);
    } catch (err) {
      $('[data-rerror]', f).innerHTML = `<p class="notice err">${esc(err.message)}</p>`;
    }
  });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  lookup(form.elements.number.value.trim(), form.elements.phone.value.trim());
});

// Prefill from the thank-you page link, then drop the phone number from the address bar.
const q = new URLSearchParams(location.search);
if (q.get('order')) form.elements.number.value = q.get('order');
if (q.get('phone')) {
  form.elements.phone.value = q.get('phone');
  history.replaceState(null, '', `/track?order=${encodeURIComponent(q.get('order') || '')}${location.hash}`);
  lookup(form.elements.number.value, form.elements.phone.value);
}
