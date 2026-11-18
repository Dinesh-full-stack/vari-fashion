import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../app-context.jsx';
import { useTitle } from '../lib.js';

export default function ThankYou() {
  const { config } = useApp();
  const [sp] = useSearchParams();
  const number = sp.get('order') || '';
  let phone = '';
  try { const last = JSON.parse(sessionStorage.getItem('lastOrder') || '{}'); if (last.number === number) phone = last.phone; } catch { /* ignore */ }
  useTitle(`Thank you — ${config.brand}`);
  return (
    <div className="wrap page-narrow">
      <div className="thanks panel glass">
        <span className="eyebrow">Order placed</span>
        <h1>Thank you.</h1>
        <p className="lead">Your order number is <b>{number}</b>.</p>
        <p className="muted">We'll send updates to your phone and email. Keep your order number handy to track it. Changed your mind? You can cancel from the tracking page until your order ships.</p>
        <div className="actions">
          <Link className="btn" to={`/track?order=${encodeURIComponent(number)}${phone ? `&phone=${encodeURIComponent(phone)}` : ''}`}>Track this order</Link>
          <Link className="btn glass-btn" to="/shop">Keep shopping</Link>
        </div>
      </div>
    </div>
  );
}
