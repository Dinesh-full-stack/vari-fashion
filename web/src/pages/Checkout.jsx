import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { STATES, api, bag, cut, money, quoteBag, useBag, useTitle } from '../lib.js';

const SAVED = 'checkout.contact.v1';
const EMPTY = { name: '', phone: '', email: '', line1: '', line2: '', pincode: '', city: '', state: '' };
const LABELS = { name: 'Full name', phone: 'Mobile number', email: 'Email', line1: 'House / flat, street', pincode: 'Pincode', city: 'City', state: 'State / UT' };

let razorpayLoad;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  razorpayLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve; s.onerror = () => { razorpayLoad = null; reject(new Error('The payment window could not load. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return razorpayLoad;
}

export default function Checkout() {
  const { config, account, accountReady } = useApp();
  const items = useBag();
  const nav = useNavigate();
  useTitle(`Checkout — ${config.brand}`);

  const [form, setForm] = useState(() => {
    try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(SAVED) || '{}') }; } catch { return EMPTY; }
  });
  const [pay, setPay] = useState('prepaid');
  const [couponCode, setCouponCode] = useState(() => { try { return sessionStorage.getItem('coupon') || ''; } catch { return ''; } });
  const [couponMsg, setCouponMsg] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState(null);
  const pending = useRef(null); // an order already created and waiting for payment, so a retry doesn't make a second order
  const phoneRef = useRef('');
  phoneRef.current = form.phone;
  const errRef = useRef(null);

  useEffect(() => { if (!items.length && !busy) nav('/bag', { replace: true }); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signed-in customers get their saved details filled in.
  useEffect(() => {
    if (!account) return;
    const a = account.address || {};
    setForm((f) => ({
      ...f, name: account.name || f.name, phone: account.phone || f.phone, email: account.email || f.email,
      line1: f.line1 || a.line1 || '', line2: f.line2 || a.line2 || '', city: f.city || a.city || '', state: f.state || a.state || '', pincode: f.pincode || a.pincode || '',
    }));
  }, [account]);

  const setCoupon = (code) => {
    setCouponCode(code);
    try { if (code) sessionStorage.setItem('coupon', code); else sessionStorage.removeItem('coupon'); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!items.length) return undefined;
    let live = true;
    quoteBag(pay, { couponCode, phone: phoneRef.current })
      .then((q) => {
        if (!live || !q) return;
        setQuoteErr('');
        if (couponCode && q.couponError) { setCouponMsg(q.couponError); setCoupon(''); }
        setQuote(q);
      })
      .catch((e) => live && setQuoteErr(e.message));
    return () => { live = false; };
  }, [items, pay, couponCode]);

  const showError = (msg) => {
    setError(msg);
    if (msg) setTimeout(() => errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const done = (number, phone) => {
    try { sessionStorage.setItem('lastOrder', JSON.stringify({ number, phone })); } catch { /* ignore */ }
    bag.clear();
    nav(`/thank-you?order=${encodeURIComponent(number)}`);
  };

  const takePayment = async (order, payment, phone) => {
    if (payment.mode === 'mock') { setMock({ order, amount: payment.amount, phone }); return; }
    await loadRazorpay();
    const rzp = new window.Razorpay({
      key: payment.key, amount: payment.amount, currency: 'INR', name: payment.name, description: `Order ${order.number}`,
      order_id: payment.gatewayOrderId, prefill: payment.prefill, theme: { color: '#11141b' },
      handler: async (resp) => {
        try { await api('/api/payment/verify', { method: 'POST', body: { number: order.number, ...resp } }); } catch { /* the webhook still confirms the order */ }
        done(order.number, phone);
      },
      modal: {
        ondismiss: () => {
          api('/api/payment/failed', { method: 'POST', body: { number: order.number, reason: 'closed' } }).catch(() => {});
          showError('Payment was not completed. Your items are held for 30 minutes. Press "Pay" to try again.');
          setBusy(false);
        },
      },
    });
    rzp.on('payment.failed', (r) => showError(r?.error?.description || 'Payment failed. Please try another method.'));
    rzp.open();
  };

  const submit = async (e) => {
    e.preventDefault();
    showError('');
    for (const k of Object.keys(LABELS)) if (!String(form[k]).trim()) { document.getElementById(`f-${k}`)?.focus(); return showError(`Please fill in "${LABELS[k]}".`); }
    try { localStorage.setItem(SAVED, JSON.stringify(form)); } catch { /* ignore */ }
    setBusy(true);
    try {
      if (pending.current && pending.current.method === pay && pay === 'prepaid') {
        await takePayment(pending.current.order, pending.current.payment, form.phone);
      } else {
        const lines = bag.get().map(({ variantId, qty }) => ({ variantId, qty }));
        const res = await api('/api/checkout', { method: 'POST', body: { items: lines, customer: form, paymentMethod: pay, couponCode } });
        setCoupon('');
        if (res.payment.mode === 'cod') return done(res.order.number, form.phone);
        pending.current = { ...res, method: pay };
        await takePayment(res.order, res.payment, form.phone);
      }
    } catch (err) {
      showError(err.message);
      setBusy(false);
    }
  };

  const issues = quote ? Object.keys(quote.issues).length : 0;
  const cta = !quote ? 'Please wait…' : pay === 'cod' ? `Place order · ${money(quote.totalPaise)}` : `Pay ${money(quote.totalPaise)}`;

  return (
    <div className="wrap">
      <div className="page-head"><h1>Checkout</h1></div>
      <div className="checkout">
        <form className="panel glass" onSubmit={submit} noValidate>
          {!config.paymentsLive && <p className="notice test"><b>Test mode.</b> No Razorpay keys are set, so online payments are simulated and no money moves.</p>}
          {accountReady && (account
            ? <p className="notice ok">Logged in as <b>{account.name}</b>. This order will appear in <Link className="link" to="/account">My account</Link>.</p>
            : <p className="notice">Have an account? <Link className="link" to="/account?next=/checkout">Log in</Link> for faster checkout, or continue as a guest.</p>)}

          <h2 className="step-title">Contact</h2>
          <div className="grid-2">
            <div className="field"><label htmlFor="f-name">Full name</label><input id="f-name" autoComplete="name" value={form.name} onChange={set('name')} required /></div>
            <div className="field"><label htmlFor="f-phone">Mobile number</label><input id="f-phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={form.phone} onChange={set('phone')} required /><span className="hint">For delivery updates and order tracking</span></div>
          </div>
          <div className="field"><label htmlFor="f-email">Email</label><input id="f-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required /></div>

          <h2 className="step-title">Delivery address</h2>
          <div className="field"><label htmlFor="f-line1">House / flat, street</label><input id="f-line1" autoComplete="address-line1" value={form.line1} onChange={set('line1')} required /></div>
          <div className="field"><label htmlFor="f-line2">Area, landmark (optional)</label><input id="f-line2" autoComplete="address-line2" value={form.line2} onChange={set('line2')} /></div>
          <div className="grid-2">
            <div className="field"><label htmlFor="f-pincode">Pincode</label><input id="f-pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code" value={form.pincode} onChange={set('pincode')} required /></div>
            <div className="field"><label htmlFor="f-city">City</label><input id="f-city" autoComplete="address-level2" value={form.city} onChange={set('city')} required /></div>
          </div>
          <div className="field"><label htmlFor="f-state">State / UT</label>
            <select id="f-state" autoComplete="address-level1" value={form.state} onChange={set('state')} required><option value="">Choose…</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></div>

          <h2 className="step-title">Payment</h2>
          <div className="pay-options">
            <label className="pay-opt"><input type="radio" name="pay" checked={pay === 'prepaid'} onChange={() => setPay('prepaid')} /><span>Pay online<small>UPI, cards, net banking, wallets</small></span><span>Secure</span></label>
            {config.codEnabled && <label className="pay-opt"><input type="radio" name="pay" checked={pay === 'cod'} onChange={() => setPay('cod')} /><span>Cash on delivery<small>Pay in cash or UPI when your order arrives</small></span><span>{config.codFee ? `+${money(config.codFee)}` : ''}</span></label>}
          </div>

          <div ref={errRef} role="alert">
            {error && <p className="notice err">{error}</p>}
            {mock && (
              <div className="notice test mock">
                <b>Test payment for {money(mock.amount)}</b>
                <span>In live mode the Razorpay window opens here.</span>
                <div className="mock-actions">
                  <button type="button" className="btn" onClick={async () => { await api('/api/payment/mock-complete', { method: 'POST', body: { number: mock.order.number } }); done(mock.order.number, mock.phone); }}>Simulate success</button>
                  <button type="button" className="btn glass-btn" onClick={async () => { await api('/api/payment/failed', { method: 'POST', body: { number: mock.order.number, reason: 'test failure' } }); setMock(null); showError('Payment did not go through. Your items are held for 30 minutes. Press "Pay" to try again.'); setBusy(false); }}>Simulate failure</button>
                </div>
              </div>
            )}
          </div>
          <button className="btn block" type="submit" disabled={busy || !quote || issues > 0}>{busy ? 'Please wait…' : cta}</button>
          <p className="muted small">By placing your order you agree to our <a className="link" href="/policies#terms" target="_blank" rel="noopener">terms</a> and <a className="link" href="/policies#returns" target="_blank" rel="noopener">return policy</a>. Prices include GST.</p>
        </form>

        <aside className="summary panel glass">
          {quoteErr && <p className="notice err">{quoteErr}</p>}
          <h2>Your order</h2>
          {items.map((i) => (
            <div className="line compact" key={i.variantId}>
              <span className="thumb"><img src={cut(i.image)} alt="" /></span>
              <div><div className="n">{i.name}</div><div className="meta">{i.color} · {i.size} · Qty {i.qty}</div>{quote?.issues[i.variantId] && <div className="issue">{quote.issues[i.variantId].message}</div>}</div>
              <div className="line-price">{money(i.price * i.qty)}</div>
            </div>
          ))}
          {quote && (
            <>
              <div className="coupon-box">
                {quote.coupon
                  ? <div className="row"><span>Coupon <b>{quote.coupon.code}</b> applied ({quote.coupon.label})</span><button type="button" className="link" onClick={() => { setCoupon(''); setCouponMsg(''); }}>Remove</button></div>
                  : (
                    <form className="coupon-form" onSubmit={(e) => { e.preventDefault(); const c = codeInput.trim().toUpperCase(); if (!c) return; setCoupon(c); setCouponMsg(''); setCodeInput(''); }}>
                      <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Coupon code" aria-label="Coupon code" autoCapitalize="characters" />
                      <button className="btn glass-btn">Apply</button>
                    </form>
                  )}
                {couponMsg && <p className="coupon-msg">{couponMsg}</p>}
              </div>
              <div className="row"><span>Subtotal</span><span>{money(quote.itemsPaise)}</span></div>
              {quote.discountPaise > 0 && <div className="row ok"><span>Coupon discount</span><span>−{money(quote.discountPaise)}</span></div>}
              <div className="row"><span>Shipping</span><span>{quote.shippingPaise ? money(quote.shippingPaise) : 'Free'}</span></div>
              {quote.codFeePaise > 0 && <div className="row"><span>Cash on delivery fee</span><span>{money(quote.codFeePaise)}</span></div>}
              <div className="row total"><span>Total</span><span>{money(quote.totalPaise)}</span></div>
              <p className="muted small">Includes GST</p>
              {issues > 0 && <p className="notice err">Some items changed. <Link className="link" to="/bag">Update your bag</Link> to continue.</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
