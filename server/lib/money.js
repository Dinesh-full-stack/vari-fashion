import { intSetting } from '../db.js';

/** GST rate for one piece. Apparel GST in India depends on per-piece price. [verify current slabs with a CA] */
export function gstRateFor(unitPricePaise) {
  return unitPricePaise <= intSetting('gst_threshold_paise') ? intSetting('gst_low_rate') : intSetting('gst_high_rate');
}

/** Tax included in a GST-inclusive amount: amount * rate / (100 + rate), rounded to the paisa. */
export function includedTax(amountPaise, rate) {
  return Math.round((amountPaise * rate) / (100 + rate));
}

export const rupees = (paise) =>
  '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** Indian financial year label, e.g. 2026-27 for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYear(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
