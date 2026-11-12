import { boot, api, bag, money, esc, quoteBag } from './common.js';

const config = await boot();
const $ = (s, r = document) => r.querySelector(s);
const form = $('[data-form]');
const errBox = $('[data-error]');
const submit = $('[data-submit]');

if (!bag.items().length) location.replace('/bag');

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
$('#state').insertAdjacentHTML('beforeend', STATES.map((s) => `<option>${s}</option>`).join(''));

if (!config.paymentsLive) {
  $('[data-test-banner]').innerHTML = '<p class="test-banner"><b>Test mode.</b> No Razorpay keys are set, so online payments are simulated and no money moves.</p>';
}

$('[data-pay]').innerHTML = `
  <label class="pay-opt"><input type="radio" name="pay" value="prepaid" checked>
    <span>Pay online<small>UPI, cards, net banking, wallets</small></span><span>Secure</span></label>
  ${config.codEnabled ? `<label class="pay-opt"><input type="radio" name="pay" value="cod">
    <span>Cash on delivery<small>Pay in cash or UPI when your order arrives</small></span><span>${config.codFee ? '+' + money(config.codFee) : ''}</span></label>` : ''}`;

// Remember the address in this browser for next time.
const SAVED = 'checkout.contact.v1';
try {
  const saved = JSON.parse(localStorage.getItem(SAVED) || '{}');
  for (const [k, v] of Object.entries(saved)) if (form.elements[k]) form.elements[k].value = v;
} catch { /* storage unavailable */ }

const method = () => form.elements.pay.value || 'prepaid';

// Coupon chosen by the customer; remembered for this visit. The server re-checks it at every quote and at checkout.
let couponCode = '';
try { couponCode = sessionStorage.getItem('coupon') || ''; } catch { /* ignore */ }
const setCoupon = (code) => { couponCode = code; try { code ? sessionStorage.setItem('coupon', code) : sessionStorage.removeItem('coupon'); } catch { /* ignore */ } };
let couponMsg = '';

async function renderSummary() {
  const s = $('[data-summary]');
  let q;
  try { q = await quoteBag(method(), { couponCode, phone: form.elements.phone.value }); } catch (e) { s.innerHTML = `<p class="notice err">${esc(e.message)}</p>`; return; }
  if (couponCode && q?.couponError) { couponMsg = q.couponError; setCoupon(''); }
  if (!q) return;
  const issues = Object.keys(q.issues).length;
  s.innerHTML = `<h2 style="font-size:28px">Your order</h2>
    ${bag.items().map((i) => `<div class="line" style="grid-template-columns:64px 1fr auto;padding:12px 0">
      <img src="${esc(i.image)}" alt="" style="width:64px">
      <div><div class="n" style="font-size:16px">${esc(i.name)}</div><div class="meta">${esc(i.color)} · ${esc(i.size)} · Qty ${i.qty}</div>
      ${q.issues[i.variantId] ? `<div class="issue">${esc(q.issues[i.variantId].message)}</div>` : ''}</div>
      <div>${money(i.price * i.qty)}</div></div>`).join('')}
    <div class="coupon-box">
      ${q.coupon
        ? `<div class="row"><span>Coupon <b>${esc(q.coupon.code)}</b> applied (${esc(q.coupon.label)})</span><button type="button" class="link" data-coupon-remove style="background:none;border:0;padding:0">Remove</button></div>`
        : `<form data-coupon-form class="coupon-form"><input name="code" placeholder="Coupon code" aria-label="Coupon code" autocapitalize="characters"><button>Apply</button></form>`}
      ${couponMsg ? `<p class="coupon-msg">${esc(couponMsg)}</p>` : ''}
    </div>
    <div class="row"><span>Subtotal</span><span>${money(q.itemsPaise)}</span></div>
    ${q.discountPaise ? `<div class="row" style="color:var(--ok)"><span>Coupon discount</span><span>−${money(q.discountPaise)}</span></div>` : ''}
    <div class="row"><span>Shipping</span><span>${q.shippingPaise ? money(q.shippingPaise) : 'Free'}</span></div>
    ${q.codFeePaise ? `<div class="row"><span>Cash on delivery fee</span><span>${money(q.codFeePaise)}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${money(q.totalPaise)}</span></div>
    <div class="tax-note">Includes GST</div>
    ${issues ? '<p class="notice err">Some items changed. <a class="link" href="/bag">Update your bag</a> to continue.</p>' : ''}`;
  submit.disabled = issues > 0;
  submit.textContent = method() === 'cod' ? `Place order · ${money(q.totalPaise)}` : `Pay ${money(q.totalPaise)}`;
}

form.addEventListener('change', (e) => { if (e.target.name === 'pay') renderSummary(); });

$('[data-summary]').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-coupon-form]')) return;
  e.preventDefault();
  const code = e.target.code.value.trim().toUpperCase();
  if (!code) return;
  setCoupon(code); couponMsg = '';
  renderSummary();
});
$('[data-summary]').addEventListener('click', (e) => {
  if (!e.target.closest('[data-coupon-remove]')) return;
  setCoupon(''); couponMsg = '';
  renderSummary();
});

function showError(msg) {
  errBox.innerHTML = msg ? `<p class="notice err">${esc(msg)}</p>` : '';
  if (msg) errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function done(number, phone) {
  try { sessionStorage.setItem('lastOrder', JSON.stringify({ number, phone })); } catch { /* ignore */ }
  bag.clear();
  location.href = `/thank-you?order=${encodeURIComponent(number)}`;
}

let pending = null; // an order already created, waiting for payment (lets the customer retry without a new order)

async function pay(order, payment, phone) {
  if (payment.mode === 'mock') {
    errBox.innerHTML = `<div class="test-banner" style="display:grid;gap:10px"><b>Test payment for ${money(payment.amount)}</b>
      <span>In live mode the Razorpay window opens here.</span>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-mock-ok>Simulate success</button>
      <button type="button" class="btn ghost" data-mock-fail>Simulate failure</button></div></div>`;
    $('[data-mock-ok]').onclick = async () => { await api('/api/payment/mock-complete', { method: 'POST', body: { number: order.number } }); done(order.number, phone); };
    $('[data-mock-fail]').onclick = async () => {
      await api('/api/payment/failed', { method: 'POST', body: { number: order.number, reason: 'test failure' } });
      showError('Payment did not go through. Your items are held for 30 minutes. Press "Pay" to try again.');
      submit.disabled = false;
    };
    return;
  }
  if (!window.Razorpay) { showError('The payment window could not load. Check your connection and try again.'); submit.disabled = false; return; }
  const rzp = new window.Razorpay({
    key: payment.key,
    amount: payment.amount,
    currency: 'INR',
    name: payment.name,
    description: `Order ${order.number}`,
    order_id: payment.gatewayOrderId,
    prefill: payment.prefill,
    theme: { color: '#1c1916' },
    handler: async (resp) => {
      try {
        await api('/api/payment/verify', { method: 'POST', body: { number: order.number, ...resp } });
      } catch { /* the webhook will still confirm the order; show the thank-you page either way */ }
      done(order.number, phone);
    },
    modal: {
      ondismiss: () => {
        api('/api/payment/failed', { method: 'POST', body: { number: order.number, reason: 'closed' } }).catch(() => {});
        showError('Payment was not completed. Your items are held for 30 minutes. Press "Pay" to try again.');
        submit.disabled = false;
      },
    },
  });
  rzp.on('payment.failed', (r) => showError(r?.error?.description || 'Payment failed. Please try another method.'));
  rzp.open();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const f = Object.fromEntries(new FormData(form));
  const customer = { name: f.name, phone: f.phone, email: f.email, line1: f.line1, line2: f.line2, city: f.city, state: f.state, pincode: f.pincode };
  for (const el of form.querySelectorAll('[required]')) {
    if (!el.value.trim()) { el.focus(); return showError(`Please fill in "${el.labels[0]?.textContent}".`); }
  }
  try { localStorage.setItem(SAVED, JSON.stringify({ ...customer })); } catch { /* ignore */ }

  submit.disabled = true;
  const label = submit.textContent;
  submit.textContent = 'Please wait…';
  try {
    if (pending && pending.method === method() && method() === 'prepaid') {
      await pay(pending.order, pending.payment, customer.phone);
    } else {
      const items = bag.items().map(({ variantId, qty }) => ({ variantId, qty }));
      const res = await api('/api/checkout', { method: 'POST', body: { items, customer, paymentMethod: method(), couponCode } });
      setCoupon('');
      if (res.payment.mode === 'cod') return done(res.order.number, customer.phone);
      pending = { ...res, method: method() };
      await pay(res.order, res.payment, customer.phone);
    }
  } catch (err) {
    showError(err.message);
    submit.disabled = false;
    renderSummary();
  } finally {
    submit.textContent = label;
  }
});

renderSummary();
