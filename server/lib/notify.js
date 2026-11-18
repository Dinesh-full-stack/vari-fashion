// Order and return emails. Called after the database change is committed; runs in the background
// so a slow or failing email server never delays checkout or admin actions.
import { db, getSettings } from '../db.js';
import { config } from '../config.js';
import { sendMail } from './mailer.js';
import { rupees } from './money.js';
import { invoiceToken } from './invoice.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trackUrl = (o) => `${config.siteUrl}/track?order=${encodeURIComponent(o.number)}`;

/** Simple, email-client-safe layout (tables + inline styles). */
function layout(s, heading, inner, button) {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ef;font-family:Arial,Helvetica,sans-serif;color:#1f1d1b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ef;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="padding:20px 24px;border-bottom:3px solid #b4532a;font-size:22px;font-weight:bold">${esc(s.brand_name)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${esc(heading)}</h1>
${inner}
${button ? `<p style="margin:24px 0 8px"><a href="${esc(button.url)}" style="display:inline-block;background:#b4532a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${esc(button.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;background:#fafaf8;font-size:12px;color:#7a746c">
Questions? Reply to this email or WhatsApp us on +${esc(s.whatsapp_number)}.<br>${esc(s.seller_legal_name)} · ${esc(s.seller_address)}
</td></tr></table></td></tr></table></body></html>`;
}

function itemsTable(o, items) {
  const rows = items.map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.product_name)}<br><span style="color:#7a746c;font-size:13px">${esc(i.color)} · ${esc(i.size)} · Qty ${i.qty}</span></td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap">${rupees(i.unit_price_paise * i.qty)}</td></tr>`).join('');
  const line = (label, v, color = '') => `<tr><td style="padding:4px 0;${color}">${label}</td><td align="right" style="padding:4px 0;${color}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0">${rows}
    ${o.discount_paise ? line(`Coupon ${esc(o.coupon_code || '')}`, `−${rupees(o.discount_paise)}`, 'color:#1e7a4c') : ''}
    ${line('Shipping', o.shipping_paise ? rupees(o.shipping_paise) : 'Free')}
    ${o.cod_fee_paise ? line('Cash on delivery fee', rupees(o.cod_fee_paise)) : ''}
    <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #1f1d1b">Total</td><td align="right" style="padding:8px 0;font-weight:bold;border-top:2px solid #1f1d1b">${rupees(o.total_paise)}</td></tr></table>`;
}

const address = (o) => `<p style="font-size:14px;color:#4b4741;margin:0">Delivering to:<br>${esc(o.customer_name)}, ${esc(o.address_line1)} ${esc(o.address_line2)}<br>${esc(o.city)}, ${esc(o.state)} ${esc(o.pincode)}</p>`;
const text = (...lines) => lines.filter(Boolean).join('\n');

function load(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = o ? db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId) : [];
  return { o, items, s: getSettings() };
}

async function orderEmail(orderId, event) {
  const { o, items, s } = load(orderId);
  if (!o) return;
  const toCustomer = s.email_customers === '1';
  const pay = o.payment_method === 'cod' ? `Cash on delivery: please keep ${rupees(o.total_paise)} ready (cash or UPI).` : 'Paid online. Thank you!';

  if (event === 'confirmed') {
    if (toCustomer) {
      await sendMail({
        to: o.email, kind: 'order_confirmed', ref: o.number,
        subject: `Order ${o.number} confirmed — ${s.brand_name}`,
        html: layout(s, `Thank you, ${o.customer_name.split(' ')[0]}! Your order is confirmed.`,
          `<p style="font-size:14px">Order <b>${esc(o.number)}</b>. We'll pack it within 1–2 working days and email you the tracking link when it ships. You can cancel it from the tracking page any time before it ships.</p>
           ${itemsTable(o, items)}<p style="font-size:14px">${esc(pay)}</p>${address(o)}`,
          { label: 'Track your order', url: trackUrl(o) }),
        text: text(`Thank you! Order ${o.number} is confirmed.`, ...items.map((i) => `- ${i.product_name} (${i.color}/${i.size}) x${i.qty}`), `Total: ${rupees(o.total_paise)}`, pay, `Track: ${trackUrl(o)}`),
      });
    }
    if (s.order_alert_email) {
      await sendMail({
        to: s.order_alert_email, kind: 'new_order_alert', ref: o.number,
        subject: `New order ${o.number} · ${rupees(o.total_paise)} · ${o.payment_method === 'cod' ? 'COD' : 'Prepaid'}`,
        html: layout(s, `New order ${o.number}`,
          `<p style="font-size:14px">${esc(o.customer_name)} · ${esc(o.phone)} · ${esc(o.city)}, ${esc(o.state)}<br>${o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online'}</p>${itemsTable(o, items)}`,
          { label: 'Open in admin', url: `${config.siteUrl}/admin/#order/${encodeURIComponent(o.number)}` }),
        text: text(`New order ${o.number}`, `${o.customer_name} ${o.phone}`, ...items.map((i) => `- ${i.product_name} (${i.color}/${i.size}) x${i.qty}`), `Total ${rupees(o.total_paise)}`),
      });
    }
  } else if (event === 'shipped' && toCustomer) {
    await sendMail({
      to: o.email, kind: 'order_shipped', ref: o.number,
      subject: `Your order ${o.number} has shipped — ${s.brand_name}`,
      html: layout(s, 'Your order is on its way',
        `<p style="font-size:14px">Order <b>${esc(o.number)}</b> has left our workshop${o.courier ? ` with <b>${esc(o.courier)}</b>` : ''}.${o.awb ? ` Tracking number: <b>${esc(o.awb)}</b>.` : ''}</p>
         <p style="font-size:14px">Delivery usually takes 3–7 working days. ${esc(o.payment_method === 'cod' ? pay : '')}</p>${address(o)}`,
        { label: 'Track your order', url: trackUrl(o) }),
      text: text(`Order ${o.number} has shipped.`, o.courier && `Courier: ${o.courier}`, o.awb && `Tracking number: ${o.awb}`, `Track: ${trackUrl(o)}`),
    });
  } else if (event === 'delivered' && toCustomer) {
    const days = s.return_window_days;
    await sendMail({
      to: o.email, kind: 'order_delivered', ref: o.number,
      subject: `Delivered: order ${o.number} — ${s.brand_name}`,
      html: layout(s, 'Your order has been delivered',
        `<p style="font-size:14px">We hope you love it. If something doesn't fit, you can ask for an exchange or refund within <b>${esc(days)} days</b> from the tracking page.</p>
         ${o.invoice_no ? `<p style="font-size:14px"><a href="${esc(`${config.siteUrl}/invoice/${o.number}?t=${invoiceToken(o.number)}`)}" style="color:#b4532a">Download your invoice</a></p>` : ''}`,
        { label: 'Exchange or return', url: `${trackUrl(o)}#return` }),
      text: text(`Order ${o.number} has been delivered.`, `Need an exchange or refund? You have ${days} days: ${trackUrl(o)}`),
    });
  } else if (event === 'customer_cancelled') {
    if (s.order_alert_email) {
      const refund = o.payment_status === 'paid_needs_refund';
      await sendMail({
        to: s.order_alert_email, kind: 'order_cancelled_alert', ref: o.number,
        subject: `Customer cancelled order ${o.number}${refund ? ' · REFUND NEEDED' : ''}`,
        html: layout(s, `Order ${o.number} was cancelled by the customer`,
          `<p style="font-size:14px">${esc(o.customer_name)} · ${esc(o.phone)}<br>${o.payment_method === 'cod' ? 'Cash on delivery: nothing to refund.' : refund ? `<b>Paid online: refund ${rupees(o.total_paise)} from the order page.</b>` : 'Online payment was not completed.'}</p>${itemsTable(o, items)}<p style="font-size:14px">The items are back on sale.</p>`,
          { label: 'Open in admin', url: `${config.siteUrl}/admin/#order/${encodeURIComponent(o.number)}` }),
        text: text(`Order ${o.number} was cancelled by the customer.`, `${o.customer_name} ${o.phone}`, refund ? `REFUND NEEDED: ${rupees(o.total_paise)}` : 'No refund needed.'),
      });
    }
  } else if (event === 'cancelled' && toCustomer) {
    const refund = o.payment_status === 'paid_needs_refund' || o.payment_status === 'refunded';
    await sendMail({
      to: o.email, kind: 'order_cancelled', ref: o.number,
      subject: `Order ${o.number} cancelled — ${s.brand_name}`,
      html: layout(s, 'Your order has been cancelled',
        `<p style="font-size:14px">Order <b>${esc(o.number)}</b> has been cancelled.${refund ? ' Your payment will be refunded to the original payment method; banks usually take 5–7 working days.' : ''}</p>
         <p style="font-size:14px">If you didn't expect this, just reply to this email.</p>`, null),
      text: text(`Order ${o.number} has been cancelled.`, refund && 'Your payment will be refunded within 5-7 working days.'),
    });
  }
}

const RETURN_TEXT = {
  requested: ['We got your return request', 'We will review it within 1–2 working days and let you know about pickup.'],
  approved: ['Your return is approved', 'We will arrange a pickup from your address. Please keep the item packed with its tags attached.'],
  rejected: ['About your return request', 'We are sorry, we could not approve this return.'],
  received: ['We received your return', 'We are checking the item now. Your refund or exchange will follow shortly.'],
  refunded: ['Your refund has been sent', ''],
  exchanged: ['Your exchange is on its way', 'The replacement has been shipped to you.'],
};

async function returnEmail(returnNumber, event) {
  const r = db.prepare('SELECT * FROM returns WHERE number = ?').get(returnNumber);
  if (!r || !RETURN_TEXT[event]) return;
  const { o, s } = load(r.order_id);
  if (event === 'requested' && s.order_alert_email) {
    await sendMail({
      to: s.order_alert_email, kind: 'return_alert', ref: r.number,
      subject: `Return request ${r.number} for order ${o.number}`,
      html: layout(s, `Return request ${r.number}`, `<p style="font-size:14px">${esc(o.customer_name)} · ${esc(o.phone)}<br>${r.type === 'refund' ? 'Refund' : 'Exchange'} · Reason: ${esc(r.reason)}</p>`,
        { label: 'Open returns', url: `${config.siteUrl}/admin/#returns` }),
      text: text(`Return request ${r.number} for order ${o.number}`, `Reason: ${r.reason}`),
    });
  }
  if (s.email_customers !== '1') return;
  const [heading, body] = RETURN_TEXT[event];
  const extra = event === 'refunded'
    ? `${rupees(r.refund_paise)} has been refunded${o.payment_method === 'cod' ? ` by UPI to ${r.refund_upi}` : ' to your original payment method; banks usually take 5–7 working days'}.${r.refund_ref ? ` Reference: ${r.refund_ref}.` : ''}`
    : event === 'rejected' && r.admin_note ? `Reason: ${r.admin_note}` : '';
  await sendMail({
    to: o.email, kind: `return_${event}`, ref: r.number,
    subject: `${heading} (${r.number}) — ${s.brand_name}`,
    html: layout(s, heading, `<p style="font-size:14px">Return <b>${esc(r.number)}</b> for order ${esc(o.number)}.</p><p style="font-size:14px">${esc(body)} ${esc(extra)}</p>`,
      { label: 'View return status', url: `${trackUrl(o)}#return` }),
    text: text(`${heading} (${r.number}, order ${o.number})`, body, extra),
  });
}

const background = (fn) => setImmediate(() => fn().catch((e) => console.error('[notify]', e.message)));
export const notifyOrder = (orderId, event) => background(() => orderEmail(orderId, event));
export const notifyReturn = (returnNumber, event) => background(() => returnEmail(returnNumber, event));
