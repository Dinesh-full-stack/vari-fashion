import { boot, money } from './common.js';

const c = await boot();
const set = (sel, v) => document.querySelectorAll(sel).forEach((el) => { el.textContent = v; });
set('[data-ship-fee]', money(c.shippingFee));
set('[data-free-over]', money(c.freeShippingOver));
set('[data-days]', c.returnDays);
set('[data-max]', c.maxQty);
set('[data-grievance]', c.grievanceOfficer);
set('[data-email]', c.supportEmail);
set('[data-phone]', c.supportPhone);
set('[data-seller]', c.sellerName);
set('[data-address]', c.sellerAddress);
