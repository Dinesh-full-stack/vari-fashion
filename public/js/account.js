import { boot, api, money, esc, getAccount } from './common.js';

const config = await boot();
const $ = (s, r = document) => r.querySelector(s);
const root = $('[data-account]');
const next = new URLSearchParams(location.search).get('next');
const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const fmtDate = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const err = (el, e) => { el.innerHTML = e ? `<p class="notice err">${esc(e.message || e)}</p>` : ''; };

// ---------------- Logged out: log in / sign up with an emailed code ----------------
function renderAuth(mode = 'login', step = 'form', data = {}) {
  const isSignup = mode === 'signup';
  root.innerHTML = `<div class="auth-box">
    <div class="auth-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${!isSignup}" data-mode="login">Log in</button>
      <button type="button" role="tab" aria-selected="${isSignup}" data-mode="signup">Sign up</button>
    </div>
    ${step === 'form' ? `
      <form data-start class="auth-form">
        <h1>${isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p class="muted">${isSignup ? 'We’ll email you a 6-digit code to confirm it’s you.' : 'Enter your email and we’ll send you a 6-digit login code.'}</p>
        ${isSignup ? `<div class="field"><label for="a-name">Full name</label><input id="a-name" name="name" autocomplete="name" required value="${esc(data.name || '')}"></div>
          <div class="field"><label for="a-phone">Mobile number</label><input id="a-phone" name="phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" required value="${esc(data.phone || '')}"></div>` : ''}
        <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email" required value="${esc(data.email || '')}"></div>
        <div data-err></div>
        <button class="btn block">Send code</button>
        <p class="muted small">${isSignup ? 'Already have an account? <a class="link" href="#" data-mode="login">Log in</a>' : 'New here? <a class="link" href="#" data-mode="signup">Create an account</a>'}</p>
      </form>` : `
      <form data-verify class="auth-form">
        <h1>Check your email</h1>
        <p class="muted">We sent a 6-digit code to <b>${esc(data.email)}</b>. It expires in 10 minutes. Can’t find it? Check your spam folder.</p>
        ${data.devCode ? `<p class="test-banner"><b>Test mode:</b> email isn’t set up yet, so here is your code: <b>${esc(data.devCode)}</b></p>` : ''}
        <div class="field"><label for="a-code">Code</label><input id="a-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required class="otp-input"></div>
        <div data-err></div>
        <button class="btn block">${isSignup ? 'Create account' : 'Log in'}</button>
        <p class="muted small"><a class="link" href="#" data-resend>Send a new code</a> · <a class="link" href="#" data-back>Change details</a></p>
      </form>`}
  </div>`;

  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); renderAuth(b.dataset.mode, 'form', data); }));
  const start = $('[data-start]', root);
  if (start) {
    start.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(start));
      const btn = start.querySelector('button.btn'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await api(`/api/account/${mode}`, { method: 'POST', body });
        renderAuth(mode, 'code', { ...body, devCode: r.devCode });
      } catch (ex) { err($('[data-err]', start), ex); btn.disabled = false; btn.textContent = 'Send code'; }
    });
    start.querySelector('input')?.focus();
  }
  const verify = $('[data-verify]', root);
  if (verify) {
    $('#a-code').focus();
    verify.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/account/verify', { method: 'POST', body: { email: data.email, code: verify.code.value.trim(), purpose: mode } });
        if (safeNext) location.href = safeNext; else location.reload();
      } catch (ex) { err($('[data-err]', verify), ex); }
    });
    $('[data-back]', verify).addEventListener('click', (e) => { e.preventDefault(); renderAuth(mode, 'form', data); });
    $('[data-resend]', verify).addEventListener('click', async (e) => {
      e.preventDefault();
      try { const r = await api(`/api/account/${mode}`, { method: 'POST', body: data }); renderAuth(mode, 'code', { ...data, devCode: r.devCode }); }
      catch (ex) { err($('[data-err]', verify), ex); }
    });
  }
}

// ---------------- Logged in: profile, address, orders ----------------
async function renderAccount(me) {
  let orders = [];
  try { orders = await api('/api/account/orders'); } catch { /* show empty */ }
  const a = me.address || {};
  root.innerHTML = `<div class="account-head"><div><h1>Hello, ${esc(me.name.split(' ')[0])}</h1><p class="muted">${esc(me.email)} · ${esc(me.phone)}</p></div>
      <button class="btn ghost" type="button" data-logout>Log out</button></div>
    <div class="account-grid">
      <section class="card-box" style="margin-top:0">
        <h2>My orders</h2>
        ${orders.length ? `<div class="order-list">${orders.map((o) => `
          <a class="order-row" href="/track?order=${encodeURIComponent(o.number)}">
            ${o.image ? `<img src="${esc(o.image)}" alt="">` : '<span></span>'}
            <div><b>${esc(o.title)}${o.pieces > 1 ? ` + ${o.pieces - 1} more` : ''}</b><div class="muted small">Order ${esc(o.number)} · ${fmtDate(o.createdAt)}</div>
              <span class="status s-${esc(o.status)}">${esc(o.statusLabel)}</span></div>
            <div class="amt">${money(o.total)}<span class="muted small">${o.paymentMethod === 'cod' ? 'COD' : 'Paid'}</span></div>
          </a>`).join('')}</div>`
          : '<div class="empty" style="padding:30px 0"><h3>No orders yet</h3><p>When you order while logged in, it will show up here.</p><a class="btn" href="/shop">Start shopping</a></div>'}
      </section>
      <aside>
        <form class="card-box" data-profile style="margin-top:0;display:grid;gap:14px">
          <h2>My details</h2>
          <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${esc(me.name)}" required></div>
          <div class="field"><label>Mobile</label><input value="${esc(me.phone)}" disabled></div>
          <div class="field"><label>Email</label><input value="${esc(me.email)}" disabled></div>
          <h3 style="margin-top:6px">Delivery address</h3>
          <div class="field"><label for="p-l1">House / flat, street</label><input id="p-l1" name="line1" value="${esc(a.line1 || '')}"></div>
          <div class="field"><label for="p-l2">Area, landmark</label><input id="p-l2" name="line2" value="${esc(a.line2 || '')}"></div>
          <div class="grid-2"><div class="field"><label for="p-pin">Pincode</label><input id="p-pin" name="pincode" inputmode="numeric" maxlength="6" value="${esc(a.pincode || '')}"></div>
            <div class="field"><label for="p-city">City</label><input id="p-city" name="city" value="${esc(a.city || '')}"></div></div>
          <div class="field"><label for="p-state">State / UT</label><select id="p-state" name="state"><option value="">Choose…</option>${STATES.map((s) => `<option ${s === a.state ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div data-err></div>
          <button class="btn">Save</button>
          <p class="muted small">To change your mobile number or email, message us on WhatsApp.</p>
        </form>
      </aside>
    </div>`;
  $('[data-logout]').addEventListener('click', async () => { await api('/api/account/logout', { method: 'POST', body: {} }); location.href = '/'; });
  $('[data-profile]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const hasAddress = f.line1 || f.city || f.pincode;
    try {
      await api('/api/account/me', { method: 'PUT', body: { name: f.name, ...(hasAddress ? { address: f } : {}) } });
      const btn = e.target.querySelector('button.btn'); btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1800);
      err($('[data-err]', e.target), null);
    } catch (ex) { err($('[data-err]', e.target), ex); }
  });
}

const me = await getAccount();
document.title = `${me ? 'My account' : 'Log in'} — ${config.brand}`;
if (me) renderAccount(me);
else renderAuth(new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login');
