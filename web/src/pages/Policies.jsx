import { useApp } from '../app-context.jsx';
import { money, useHashScroll, useTitle } from '../lib.js';

const TOC = [['shipping', 'Shipping'], ['returns', 'Returns & refunds'], ['cancellation', 'Cancellation'], ['privacy', 'Privacy'], ['terms', 'Terms'], ['grievance', 'Grievance officer'], ['seller', 'Seller details']];

export default function Policies() {
  const { config: c, ready } = useApp();
  useTitle(`Policies — ${c.brand}`);
  useHashScroll(ready);

  return (
    <div className="wrap page-narrow-lg">
      <div className="page-head"><span className="eyebrow">The fine print</span><h1>Policies</h1>
        <p className="muted">Last updated: 12 November 2026. These are starting templates. Have them reviewed by your lawyer or CA before launch.</p></div>
      <nav className="toc" aria-label="Policy sections">{TOC.map(([id, label]) => <a key={id} className="chip" href={`#${id}`}>{label}</a>)}</nav>

      <div className="prose panel glass">
        <h2 id="shipping">Shipping</h2>
        <ul>
          <li>We deliver across India. We do not ship outside India.</li>
          <li>Orders are packed within 1–2 working days. Delivery usually takes 3–7 working days after dispatch, depending on your pincode.</li>
          <li>Shipping is {money(c.shippingFee)}, and free on orders above {money(c.freeShippingOver)}.</li>
          <li>You get a tracking number by SMS or email when your order ships, and you can follow it on our <a className="link" href="/track">Track order</a> page.</li>
        </ul>

        <h2 id="returns">Returns, exchanges and refunds</h2>
        <ul>
          <li>You can request a return or exchange within <b>{c.returnDays}</b> days of delivery from the <a className="link" href="/track">Track order</a> page.</li>
          <li>Items must be unworn, unwashed, and have their original tags attached.</li>
          <li>We arrange a pickup from your address where our courier serves your pincode. Otherwise we will share an address to send the item to.</li>
          <li>Every return is checked when it reaches us. We approve the refund or send the exchange once the item passes this check.</li>
          <li><b>Prepaid orders:</b> refunds go back to the original payment method. Banks usually take 5–7 working days to show it.</li>
          <li><b>Cash on delivery orders:</b> refunds are sent by UPI to the UPI ID you give us in the return request.</li>
          <li>Shipping charges are not refunded unless the item was damaged or wrong.</li>
          <li>Exchanges depend on stock. If your new size is sold out, we will refund you instead.</li>
        </ul>

        <h2 id="cancellation">Cancellation</h2>
        <ul>
          <li>You can cancel an order before it ships by messaging us on WhatsApp or email with your order number.</li>
          <li>Once an order has shipped it cannot be cancelled, but you can return it after delivery.</li>
          <li>Refunds for cancelled prepaid orders go back to the original payment method.</li>
        </ul>

        <h2 id="privacy">Privacy</h2>
        <p>We collect your name, phone number, email and delivery address only to deliver your order, send updates about it, and handle returns. We share them only with our payment gateway (to take payment) and our courier partner (to deliver). We do not sell your data. Card and UPI details are handled by the payment gateway; we never see or store them.</p>
        <p>We keep order records for as long as tax law requires. You can ask us to correct your details, or delete them where the law allows, by writing to the grievance officer below.</p>

        <h2 id="terms">Terms of sale</h2>
        <ul>
          <li>All prices are in Indian Rupees and include GST.</li>
          <li>Colours on screen can look slightly different from the fabric in daylight. Small variations between pieces made in different batches are normal.</li>
          <li>Online orders are limited to {c.maxQty} pieces per item. For larger quantities, use our <a className="link" href="/bulk">bulk enquiry</a> form.</li>
          <li>We may cancel an order if an item is mispriced or unavailable. If you paid, we refund you in full.</li>
        </ul>

        <h2 id="grievance">Grievance officer</h2>
        <p>As required by the Consumer Protection (E-Commerce) Rules, 2020, complaints can be sent to:</p>
        <p><b>{c.grievanceOfficer}</b><br />{c.supportEmail} · {c.supportPhone}</p>
        <p>We acknowledge complaints within 48 hours and aim to resolve them within one month.</p>

        <h2 id="seller">Seller details</h2>
        <p><b>{c.sellerName}</b><br />{c.sellerAddress}</p>
      </div>
    </div>
  );
}
