import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { api, useTitle } from '../lib.js';

export default function Bulk() {
  const { config } = useApp();
  const [sp] = useSearchParams();
  const product = sp.get('product') || '';
  const [f, setF] = useState({ name: '', phone: '', email: '', quantity: '', product, message: '' });
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useTitle(`Bulk orders — ${config.brand}`);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await api('/api/enquiries', { method: 'POST', body: f }); setSent(true); }
    catch (ex) { setError(ex.message); }
    setBusy(false);
  };

  return (
    <div className="wrap page-narrow-lg">
      <div className="page-head"><span className="eyebrow">Bulk &amp; corporate</span><h1>Ordering in bulk?</h1>
        <p className="muted">Online orders are limited to {config.maxQty} pieces per item. For larger quantities, for teams, events, weddings or stores, tell us what you need and we will reply with pricing and timelines.</p></div>
      {sent ? (
        <div className="panel glass thanks"><h2>Thank you.</h2><p>We have your enquiry and will contact you within one working day.</p></div>
      ) : (
        <form className="panel glass" onSubmit={submit}>
          <div className="grid-2">
            <div className="field"><label htmlFor="n">Your name</label><input id="n" autoComplete="name" required value={f.name} onChange={set('name')} /></div>
            <div className="field"><label htmlFor="p">Mobile number</label><input id="p" inputMode="numeric" maxLength={10} required value={f.phone} onChange={set('phone')} /></div>
          </div>
          <div className="grid-2">
            <div className="field"><label htmlFor="e">Email (optional)</label><input id="e" type="email" value={f.email} onChange={set('email')} /></div>
            <div className="field"><label htmlFor="q">Approximate quantity</label><input id="q" type="number" min="1" inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></div>
          </div>
          <div className="field"><label htmlFor="pr">Which products?</label><input id="pr" value={f.product} onChange={set('product')} /></div>
          <div className="field"><label htmlFor="m">Anything else (sizes, colours, deadline)</label><textarea id="m" value={f.message} onChange={set('message')} /></div>
          {error && <p className="notice err" role="alert">{error}</p>}
          <div className="actions">
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
            {config.whatsapp && <a className="btn glass-btn" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${encodeURIComponent(config.whatsapp)}?text=${encodeURIComponent(`Hi, I'd like a bulk quote${product ? ` for ${product}` : ''}.`)}`}>WhatsApp instead</a>}
          </div>
        </form>
      )}
    </div>
  );
}
