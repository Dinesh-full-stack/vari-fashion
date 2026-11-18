import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api, cut, money, parseDate, useTitle } from '../lib.js';

const STEPS = [['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
const RETURN_LABEL = { requested: 'Requested — we will review it within 1–2 days', approved: 'Approved — pickup being arranged', received: 'Received — being checked', refunded: 'Refunded', exchanged: 'Exchange sent', rejected: 'Not approved' };
const fmt = (d) => parseDate(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const CANCEL_REASONS = ['Ordered by mistake', 'Found a better price', 'Delivery is taking too long', 'Want to change size or colour', 'Other'];

/** Lets the customer cancel until the parcel ships. Asks once before doing it. */
function CancelPanel({ order, onDone }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prepaid = order.paymentMethod !== 'cod' && order.paymentStatus === 'paid';

  const cancel = async () => {
    setBusy(true); setError('');
    try {
      await api('/api/orders/cancel', { method: 'POST', body: { number: order.number, phone: order.phone, reason } });
      onDone(prepaid);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="panel glass" id="cancel">
      <h3>Cancel this order</h3>
      {!asking ? (
        <>
          <p className="muted">Changed your mind? You can cancel until the order ships.{prepaid ? ' Your payment will be refunded to the original payment method.' : ''}</p>
          <div className="actions"><button className="btn glass-btn danger" onClick={() => setAsking(true)}>Cancel order</button></div>
        </>
      ) : (
        <div className="return-form">
          <p><b>Cancel order {order.number}?</b> The items go back on sale.{prepaid ? ' Banks usually take 5–7 working days to show the refund.' : ''}</p>
          <div className="field"><label htmlFor="cancel-reason">Why are you cancelling? (optional)</label>
            <select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose…</option>{CANCEL_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          {error && <p className="notice err" role="alert">{error}</p>}
          <div className="actions">
            <button className="btn danger-solid" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Yes, cancel my order'}</button>
            <button className="btn glass-btn" disabled={busy} onClick={() => setAsking(false)}>Keep my order</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReturnForm({ order, onDone }) {
  const { config } = useApp();
  const [type, setType] = useState('exchange');
  const [picked, setPicked] = useState({});
  const [qtys, setQtys] = useState({});
  const [exchangeSize, setExchangeSize] = useState('');
  const [refundUpi, setRefundUpi] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const until = new Date(order.returnBy).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const items = order.items.filter((i) => picked[i.id]).map((i) => ({ itemId: i.id, qty: Number(qtys[i.id] || i.qty), exchangeSize }));
    setBusy(true);
    try {
      const r = await api('/api/returns', { method: 'POST', body: { number: order.number, phone: order.phone, type, reason, items, refundUpi } });
      onDone(r.number);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="return-form">
      <p className="muted">You can request a return until <b>{until}</b>. Items must be unworn with tags attached.</p>
      <fieldset><legend>Which items?</legend>
        {order.items.map((i) => (
          <label key={i.id} className="check">
            <input type="checkbox" checked={!!picked[i.id]} onChange={(e) => setPicked((p) => ({ ...p, [i.id]: e.target.checked }))} />
            {i.name} ({i.color}, {i.size})
            {i.qty > 1 && <> · qty <input type="number" min="1" max={i.qty} value={qtys[i.id] ?? i.qty} onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value }))} className="qty-in" /></>}
          </label>
        ))}
      </fieldset>
      <div className="pay-options">
        <label className="pay-opt"><input type="radio" name="type" checked={type === 'exchange'} onChange={() => setType('exchange')} /><span>Exchange for another size<small>Tell us the size you need below</small></span><span /></label>
        <label className="pay-opt"><input type="radio" name="type" checked={type === 'refund'} onChange={() => setType('refund')} /><span>Refund<small>{order.paymentMethod === 'cod' ? 'Sent by UPI after we receive the item' : 'To your original payment method after we receive the item'}</small></span><span /></label>
      </div>
      {type === 'exchange' && <div className="field"><label htmlFor="exsize">Size you want instead</label><input id="exsize" maxLength={10} value={exchangeSize} onChange={(e) => setExchangeSize(e.target.value)} /></div>}
      {type === 'refund' && order.paymentMethod === 'cod' && <div className="field"><label htmlFor="upi">Your UPI ID for the refund</label><input id="upi" placeholder="name@bank" value={refundUpi} onChange={(e) => setRefundUpi(e.target.value)} /></div>}
      <div className="field"><label htmlFor="reason">Why are you returning it?</label><textarea id="reason" required value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {error && <p className="notice err" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Request return'}</button>
      <span className="sr-only">{config.returnDays}-day returns</span>
    </form>
  );
}

export default function Track() {
  const { config, account, accountReady } = useApp();
  const [sp] = useSearchParams();
  const [number, setNumber] = useState(sp.get('order') || '');
  const [phone, setPhone] = useState(sp.get('phone') || '');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelNotice, setCancelNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useTitle(`Track your order — ${config.brand}`);

  const lookup = async (n, p) => {
    setError(''); setNotice(''); setCancelNotice(''); setBusy(true);
    try {
      const o = await api('/api/track', { method: 'POST', body: { number: n, phone: p } });
      setOrder({ ...o, phone: p });
    } catch (e) { setError(e.message); setOrder(null); }
    setBusy(false);
  };

  // Arriving from a link: a phone number in the link is used once; a signed-in customer needs no phone number.
  useEffect(() => {
    if (!accountReady) return;
    const o = sp.get('order'); const p = sp.get('phone');
    if (o && !p && account) {
      api(`/api/account/orders/${encodeURIComponent(o)}`).then((full) => { setPhone(full.phone); setOrder(full); }).catch(() => { /* not this customer's order: use the form */ });
    } else if (o && p) {
      history.replaceState(null, '', `/track?order=${encodeURIComponent(o)}${location.hash}`);
      lookup(o, p);
    }
  }, [accountReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const o = order;
  const idx = o ? STEPS.findIndex(([s]) => s === o.status) : -1;
  const stepIdx = o?.status === 'delivered' ? 3 : idx;
  const special = o && ['cancelled', 'rto', 'pending_payment'].includes(o.status);

  return (
    <div className="wrap page-narrow-lg">
      <div className="page-head"><span className="eyebrow">Orders</span><h1>Track your order</h1><p className="muted">Enter your order number and the mobile number you used at checkout. You can also download your invoice and request a return here.</p></div>
      <form className="panel glass" onSubmit={(e) => { e.preventDefault(); lookup(number.trim(), phone.trim()); }}>
        <div className="grid-2">
          <div className="field"><label htmlFor="num">Order number</label><input id="num" placeholder="e.g. RA10001" required autoCapitalize="characters" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
          <div className="field"><label htmlFor="ph">Mobile number</label><input id="ph" inputMode="numeric" maxLength={10} required value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        {error && <p className="notice err" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Looking…' : 'Find my order'}</button>
      </form>

      {o && (
        <>
          {cancelNotice && <p className="notice ok" role="status">{cancelNotice}</p>}
          <div className="panel glass">
            <div className="order-title"><h2>Order {o.number}</h2><span className="muted">Placed {fmt(o.createdAt)}</span></div>
            <p className="status-line"><b>{o.statusLabel}</b>{o.awb ? ` · ${o.courier || 'Courier'} AWB ` : ''}{o.awb && <b>{o.awb}</b>}</p>
            {!special && <div className="steps">{STEPS.map(([, l], i) => <div key={l} className={i <= stepIdx ? 'on' : ''}>{l}</div>)}</div>}
            {o.paymentStatus === 'failed' && o.status === 'pending_payment' && <p className="notice err">Payment has not gone through yet. If money left your account, it will be confirmed or returned automatically.</p>}
            {o.scans.length > 0 && (<><h3>Courier updates</h3><ol className="timeline">{o.scans.map((s, i) => <li key={i} className={i === 0 ? 'now' : 'done'}><div className="t">{s.status}</div><div className="d">{s.location} · {s.at}</div></li>)}</ol></>)}
            <h3>History</h3>
            <ol className="timeline">{[...o.events].reverse().map((e, i) => <li key={i} className={i === 0 ? 'now' : 'done'}><div className="t">{e.note || e.status}</div><div className="d">{fmt(e.created_at)}</div></li>)}</ol>
          </div>

          <div className="panel glass">
            <h3>Items</h3>
            {o.items.map((i) => (
              <div className="line compact" key={i.id}>
                <span className="thumb"><img src={cut(i.image)} alt="" /></span>
                <div><a className="n" href={`/product/${i.slug}`}>{i.name}</a><div className="meta">{i.color} · {i.size} · Qty {i.qty}</div></div>
                <div className="line-price">{money(i.price * i.qty)}</div>
              </div>
            ))}
            {o.discount > 0 && <div className="row ok"><span>Coupon {o.coupon || ''}</span><span>−{money(o.discount)}</span></div>}
            <div className="row"><span>Shipping</span><span>{o.shipping ? money(o.shipping) : 'Free'}</span></div>
            {o.codFee > 0 && <div className="row"><span>COD fee</span><span>{money(o.codFee)}</span></div>}
            <div className="row total"><span>Total</span><span>{money(o.total)}</span></div>
            <p className="muted small">{o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'} · Delivering to {o.customer.city}, {o.customer.state} {o.customer.pincode}</p>
            {o.invoiceUrl && <a className="btn glass-btn" href={o.invoiceUrl} target="_blank" rel="noopener">Download invoice</a>}
          </div>

          {o.returns.length > 0 && (
            <div className="panel glass"><h3>Your returns</h3>
              {o.returns.map((r) => <p key={r.number}><b>{r.number}</b> · {r.type === 'refund' ? 'Refund' : 'Exchange'} · {RETURN_LABEL[r.status] || r.status}{r.type === 'refund' && r.refund_paise ? ` · ${money(r.refund_paise)}` : ''}</p>)}
            </div>
          )}

          {o.canCancel && (
            <CancelPanel order={o} onDone={async (refund) => {
              await lookup(o.number, o.phone);
              setCancelNotice(refund ? 'Your order is cancelled. We will refund your payment to the original payment method; banks usually take 5–7 working days.' : 'Your order is cancelled. There is nothing to pay.');
            }} />
          )}

          <div className="panel glass" id="return">
            <h3>Return or exchange</h3>
            {notice && <p className="notice ok">{notice}</p>}
            {o.canReturn
              ? <ReturnForm order={o} onDone={async (n) => { await lookup(o.number, o.phone); setNotice(`Return ${n} requested. We'll contact you about pickup.`); }} />
              : <p className="muted">{o.status === 'delivered' ? `The ${config.returnDays}-day return window for this order has closed.` : `Returns open once your order is delivered. You'll have ${config.returnDays} days.`}</p>}
          </div>
        </>
      )}
    </div>
  );
}
