import crypto from 'node:crypto';
import { config } from '../config.js';
import { getSettings } from '../db.js';
import { rupees, includedTax } from './money.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Token that lets a customer open their invoice from the tracking page without logging in. */
export const invoiceToken = (orderNumber) =>
  crypto.createHmac('sha256', config.sessionSecret).update(`invoice:${orderNumber}`).digest('base64url').slice(0, 24);

export function verifyInvoiceToken(orderNumber, token) {
  const a = Buffer.from(invoiceToken(orderNumber)), b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** GST tax invoice. Prices are GST-inclusive; tax is split into CGST+SGST (same state) or IGST (other state). */
export function renderInvoice(order, items) {
  const s = getSettings();
  const intra = order.state.trim().toLowerCase() === s.seller_state.trim().toLowerCase();
  const rows = items.map((i, n) => {
    const disc = i.discount_paise || 0;
    const gross = i.unit_price_paise * i.qty - disc;
    const taxable = gross - i.tax_paise;
    const taxCols = intra
      ? `<td>${i.gst_rate / 2}%<br>${rupees(Math.floor(i.tax_paise / 2))}</td><td>${i.gst_rate / 2}%<br>${rupees(Math.ceil(i.tax_paise / 2))}</td>`
      : `<td colspan="2">IGST ${i.gst_rate}%<br>${rupees(i.tax_paise)}</td>`;
    return `<tr><td>${n + 1}</td><td>${esc(i.product_name)}<br><small>${esc(i.color)} / ${esc(i.size)} · ${esc(i.sku)}</small></td>
      <td>${esc(i.hsn)}</td><td>${i.qty}</td><td>${rupees(i.unit_price_paise)}</td><td>${disc ? '−' + rupees(disc) : '—'}</td><td>${rupees(taxable)}</td>${taxCols}<td>${rupees(gross)}</td></tr>`;
  }).join('');
  // Shipping and COD fee are taxed at 18% (supply of service) — confirm treatment with your CA.
  const charges = [['Shipping', order.shipping_paise], ['Cash on delivery fee', order.cod_fee_paise]].filter(([, v]) => v > 0)
    .map(([label, v]) => `<tr><td></td><td>${label}</td><td>9965</td><td>1</td><td>${rupees(v)}</td><td>—</td><td>${rupees(v - includedTax(v, 18))}</td>
      ${intra ? `<td>9%</td><td>9%</td>` : '<td colspan="2">IGST 18%</td>'}<td>${rupees(v)}</td></tr>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(order.invoice_no || order.number)}</title>
<style>
  body{font:14px/1.5 system-ui,sans-serif;color:#1d1a17;max-width:900px;margin:32px auto;padding:0 16px;background:#fff}
  h1{font:600 22px/1.2 Georgia,serif;letter-spacing:.08em;margin:0}
  .top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:2px solid #1d1a17;padding-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}
  th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left;vertical-align:top}
  th{background:#f5f1ea;font-weight:600}
  .tot td{border:none;padding:4px 6px}.tot tr:last-child td{font-weight:700;font-size:16px;border-top:2px solid #1d1a17}
  .muted{color:#6b645c}.print{margin-top:24px}@media print{.print{display:none}}
</style></head><body>
<div class="top">
  <div><h1>${esc(s.brand_name)}</h1><div>${esc(s.seller_legal_name)}</div><div class="muted">${esc(s.seller_address)}</div>
  <div>GSTIN: ${esc(s.seller_gstin || 'Not yet registered — add in Admin > Settings')}</div></div>
  <div><strong>TAX INVOICE</strong><div>Invoice no: ${esc(order.invoice_no || '—')}</div><div>Order: ${esc(order.number)}</div>
  <div>Date: ${esc(order.created_at.slice(0, 10))}</div><div>Payment: ${order.payment_method === 'cod' ? 'Cash on delivery' : 'Prepaid online'}</div></div>
</div>
<p><strong>Bill / Ship to:</strong> ${esc(order.customer_name)}, ${esc(order.address_line1)} ${esc(order.address_line2)}, ${esc(order.city)},
 ${esc(order.state)} ${esc(order.pincode)} · ${esc(order.phone)}<br><span class="muted">Place of supply: ${esc(order.state)}</span></p>
<table><thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th>Qty</th><th>Rate (incl. GST)</th><th>Discount</th><th>Taxable value</th>
<th>${intra ? 'CGST' : 'IGST'}</th><th>${intra ? 'SGST' : ''}</th><th>Amount</th></tr></thead><tbody>${rows}${charges}</tbody></table>
<table class="tot" style="width:auto;margin-left:auto"><tr><td>Items</td><td>${rupees(order.items_paise)}</td></tr>
${order.discount_paise ? `<tr><td>Coupon ${esc(order.coupon_code || '')}</td><td>−${rupees(order.discount_paise)}</td></tr>` : ''}
<tr><td>Shipping</td><td>${rupees(order.shipping_paise)}</td></tr>${order.cod_fee_paise ? `<tr><td>COD fee</td><td>${rupees(order.cod_fee_paise)}</td></tr>` : ''}
<tr><td>Total (incl. GST)</td><td>${rupees(order.total_paise)}</td></tr></table>
<p class="muted">Prices include GST. This is a computer-generated invoice. Grievance officer: ${esc(s.grievance_officer)} · ${esc(s.support_email)}</p>
<p class="print muted">To save a PDF, press Ctrl+P (or Share → Print on a phone) and choose "Save as PDF".</p>
</body></html>`;
}
