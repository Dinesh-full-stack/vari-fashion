import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { STATES, api, cut, money, parseDate, useTitle } from '../lib.js';

const fmtDate = (d) => parseDate(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------------- Logged out: log in or sign up with an emailed code ----------------
function Auth({ initialMode, next, onDone }) {
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState('form');
  const [data, setData] = useState({ name: '', phone: '', email: '' });
  const [devCode, setDevCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const set = (k) => (e) => setData((d) => ({ ...d, [k]: e.target.value }));

  const send = async (e) => {
    e?.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api(`/api/account/${mode}`, { method: 'POST', body: data });
      setDevCode(r.devCode || ''); setStep('code');
    } catch (ex) { setError(ex.message); }
    setBusy(false);
  };
  const verify = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/api/account/verify', { method: 'POST', body: { email: data.email, code: code.trim(), purpose: mode } });
      onDone(next);
    } catch (ex) { setError(ex.message); setBusy(false); }
  };
  const switchMode = (m) => { setMode(m); setStep('form'); setError(''); };

  return (
    <div className="auth panel glass">
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!signup} onClick={() => switchMode('login')}>Log in</button>
        <button type="button" role="tab" aria-selected={signup} onClick={() => switchMode('signup')}>Sign up</button>
      </div>
      {step === 'form' ? (
        <form onSubmit={send} className="auth-form">
          <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">{signup ? 'We’ll email you a 6-digit code to confirm it’s you.' : 'Enter your email and we’ll send you a 6-digit login code.'}</p>
          {signup && (
            <>
              <div className="field"><label htmlFor="a-name">Full name</label><input id="a-name" autoComplete="name" required value={data.name} onChange={set('name')} /></div>
              <div className="field"><label htmlFor="a-phone">Mobile number</label><input id="a-phone" inputMode="numeric" maxLength={10} autoComplete="tel-national" required value={data.phone} onChange={set('phone')} /></div>
            </>
          )}
          <div className="field"><label htmlFor="a-email">Email</label><input id="a-email" type="email" autoComplete="email" required value={data.email} onChange={set('email')} /></div>
          {error && <p className="notice err" role="alert">{error}</p>}
          <button className="btn block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          <p className="muted small">{signup ? <>Already have an account? <button type="button" className="link" onClick={() => switchMode('login')}>Log in</button></> : <>New here? <button type="button" className="link" onClick={() => switchMode('signup')}>Create an account</button></>}</p>
        </form>
      ) : (
        <form onSubmit={verify} className="auth-form">
          <h1>Check your email</h1>
          <p className="muted">We sent a 6-digit code to <b>{data.email}</b>. It expires in 10 minutes. Can’t find it? Check your spam folder.</p>
          {devCode && <p className="notice test"><b>Test mode:</b> email isn’t set up yet, so here is your code: <b>{devCode}</b></p>}
          <div className="field"><label htmlFor="a-code">Code</label><input id="a-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} /></div>
          {error && <p className="notice err" role="alert">{error}</p>}
          <button className="btn block" disabled={busy}>{signup ? 'Create account' : 'Log in'}</button>
          <p className="muted small"><button type="button" className="link" onClick={send}>Send a new code</button> · <button type="button" className="link" onClick={() => setStep('form')}>Change details</button></p>
        </form>
      )}
    </div>
  );
}

// ---------------- Logged in: orders and details ----------------
function Profile({ me, refresh }) {
  const nav = useNavigate();
  const a = me.address || {};
  const [orders, setOrders] = useState(null);
  const [f, setF] = useState({ name: me.name, line1: a.line1 || '', line2: a.line2 || '', pincode: a.pincode || '', city: a.city || '', state: a.state || '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/account/orders').then(setOrders).catch(() => setOrders([])); }, []);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const hasAddress = f.line1 || f.city || f.pincode;
    try {
      await api('/api/account/me', { method: 'PUT', body: { name: f.name, ...(hasAddress ? { address: { line1: f.line1, line2: f.line2, city: f.city, state: f.state, pincode: f.pincode } } : {}) } });
      setSaved(true); setTimeout(() => setSaved(false), 1800); refresh();
    } catch (ex) { setError(ex.message); }
  };
  const logout = async () => { await api('/api/account/logout', { method: 'POST', body: {} }); await refresh(); nav('/'); };

  return (
    <>
      <div className="page-head account-head"><div><h1>Hello, {me.name.split(' ')[0]}</h1><p className="muted">{me.email} · {me.phone}</p></div><button className="btn glass-btn" type="button" onClick={logout}>Log out</button></div>
      <div className="account-grid">
        <section className="panel glass">
          <h2>My orders</h2>
          {orders === null && <div className="sk" style={{ height: 120 }} />}
          {orders && orders.length > 0 && (
            <div className="order-list">{orders.map((o) => (
              <Link className="order-row" key={o.number} to={`/track?order=${encodeURIComponent(o.number)}`}>
                {o.image ? <span className="thumb"><img src={cut(o.image)} alt="" /></span> : <span />}
                <div><b>{o.title}{o.pieces > 1 ? ` + ${o.pieces - 1} more` : ''}</b><div className="muted small">Order {o.number} · {fmtDate(o.createdAt)}</div><span className={`status s-${o.status}`}>{o.statusLabel}</span></div>
                <div className="amt">{money(o.total)}<span className="muted small">{o.paymentMethod === 'cod' ? 'COD' : 'Paid'}</span></div>
              </Link>
            ))}</div>
          )}
          {orders && !orders.length && <div className="empty tight"><h3>No orders yet</h3><p>When you order while logged in, it will show up here.</p><Link className="btn" to="/shop">Start shopping</Link></div>}
        </section>
        <aside>
          <form className="panel glass" onSubmit={save}>
            <h2>My details</h2>
            <div className="field"><label htmlFor="p-name">Name</label><input id="p-name" value={f.name} onChange={set('name')} required /></div>
            <div className="field"><label>Mobile</label><input value={me.phone} disabled /></div>
            <div className="field"><label>Email</label><input value={me.email} disabled /></div>
            <h3>Delivery address</h3>
            <div className="field"><label htmlFor="p-l1">House / flat, street</label><input id="p-l1" value={f.line1} onChange={set('line1')} /></div>
            <div className="field"><label htmlFor="p-l2">Area, landmark</label><input id="p-l2" value={f.line2} onChange={set('line2')} /></div>
            <div className="grid-2">
              <div className="field"><label htmlFor="p-pin">Pincode</label><input id="p-pin" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set('pincode')} /></div>
              <div className="field"><label htmlFor="p-city">City</label><input id="p-city" value={f.city} onChange={set('city')} /></div>
            </div>
            <div className="field"><label htmlFor="p-state">State / UT</label><select id="p-state" value={f.state} onChange={set('state')}><option value="">Choose…</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></div>
            {error && <p className="notice err" role="alert">{error}</p>}
            <button className="btn">{saved ? 'Saved ✓' : 'Save'}</button>
            <p className="muted small">To change your mobile number or email, message us on WhatsApp.</p>
          </form>
        </aside>
      </div>
    </>
  );
}

export default function Account() {
  const { config, account, accountReady, loadAccount } = useApp();
  const [sp] = useSearchParams();
  const next = sp.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const nav = useNavigate();
  useTitle(`${account ? 'My account' : 'Log in'} — ${config.brand}`);

  if (!accountReady) return <div className="wrap page-narrow-lg"><div className="sk" style={{ height: 320, borderRadius: 32 }} /></div>;
  return (
    <div className="wrap page-narrow-lg">
      {account
        ? <Profile me={account} refresh={loadAccount} />
        : <Auth initialMode={sp.get('mode') === 'signup' ? 'signup' : 'login'} next={safeNext} onDone={async (to) => { await loadAccount(); nav(to || '/account', { replace: true }); }} />}
    </div>
  );
}
