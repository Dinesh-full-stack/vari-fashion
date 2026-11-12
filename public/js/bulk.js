import { boot, api, esc } from './common.js';

const config = await boot();
const $ = (s) => document.querySelector(s);
const form = $('[data-form]');
const product = new URLSearchParams(location.search).get('product');
if (product) $('[data-product]').value = product;
$('[data-bulk-intro]').textContent = `Online orders are limited to ${config.maxQty} pieces per item. For larger quantities, for teams, events, weddings or stores, tell us what you need and we will reply with pricing and timelines.`;
$('[data-wa]').href = `https://wa.me/${encodeURIComponent(config.whatsapp)}?text=${encodeURIComponent(`Hi, I'd like a bulk quote${product ? ` for ${product}` : ''}.`)}`;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-error]');
  err.innerHTML = '';
  try {
    await api('/api/enquiries', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    form.innerHTML = `<h2 style="font-size:34px">Thank you.</h2><p>We have your enquiry and will contact you within one working day.</p>`;
  } catch (ex) {
    err.innerHTML = `<p class="notice err">${esc(ex.message)}</p>`;
  }
});
