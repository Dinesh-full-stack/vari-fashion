# Garment store

A premium online store for an Indian garment brand. It has three parts:

- **Storefront** (`public/`): plain HTML, CSS and JavaScript. The home page tells the brand story with GSAP ScrollTrigger animations. The other pages are the shop, product pages, bag, checkout, order tracking, returns, bulk enquiries and policies.
- **API and admin** (`server/`): Node.js, Express and SQLite. Node's built-in `node:sqlite` stores the data, so the database needs no native modules.
- **Admin panel** (`/admin`): dashboard, orders, shipping, returns and refunds, products and stock, bulk enquiries, the money view, settings, staff and the activity log.

Payments go through **Razorpay** (UPI, cards, net banking) or **cash on delivery**. Shipping and tracking go through **Shiprocket**. If you leave the keys for either one blank, that part runs in **test mode**, so you can try every flow locally without moving money.

## Run it locally

Requires Node.js 22.5 or newer.

```bash
npm install
cp .env.example .env      # then edit it
npm start                 # http://localhost:3000
npm test                  # end-to-end order flow tests
```

On first start the server does two things:

- It creates the owner account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Sign in at `/admin` and change the password under *Staff & security*.
- It adds 20 sample products. Edit or replace them under *Admin › Products*.

## Before launch: your content

| What | Where |
|---|---|
| Brand name, WhatsApp number, support contacts | Admin › Settings |
| Legal name, address, GSTIN, state, grievance officer | Admin › Settings (these appear on invoices, the policies page and product pages) |
| GST slab threshold and rates | Admin › Settings. **Confirm the current apparel slabs and HSN codes with your CA.** |
| Product photos, descriptions, fabric, prices, stock | Admin › Products (the store uses SVG placeholders until you upload photos) |
| Hero and chapter images on the home page | `public/index.html`. Each section has a comment showing where to put a real photo |
| The four figures in the "numbers" band | `public/index.html` (marked `REPLACE`) |
| Size charts | `public/js/product.js` → `sizeGuide()` |
| Policy wording | `public/policies.html`. Have a lawyer or CA review it |

## How orders work

- **Stock is taken off sale when the order is placed**, inside one database transaction, so two buyers can never both get the last unit.
- **Prepaid** orders hold their stock for 30 minutes (*Settings › Payment hold*). Payment is confirmed in either of two ways:
  - the browser sends back Razorpay's signed response;
  - Razorpay's webhook arrives.

  Both paths can safely run for the same order. If the hold runs out, the server first asks Razorpay whether the payment went through, and only then releases the stock. If a payment arrives after its stock has been sold, the order is flagged **Refund needed** on the dashboard.
- **Cash on delivery** orders are confirmed immediately.
- **Order statuses:** awaiting payment → confirmed → packed → shipped → delivered, plus cancelled and RTO (the parcel came back). Invalid moves are refused. Cancelling an order or marking it RTO puts the stock back on sale.
- **Quantity limit:** at most 10 per item (*Settings*). Above that, the customer is sent to the bulk enquiry form.
- **Returns:**
  1. The customer requests a return on the Track page, within 7 days of delivery.
  2. An admin **approves** it, marks it **received** once the item is checked (this restocks it), then **refunds** or **sends the exchange**.

  Prepaid refunds go through the Razorpay API. COD refunds are paid by UPI to the ID the customer gave; the admin then enters the UPI reference.
- **Invoices:** GST tax invoices are numbered per financial year (`INV/2026-27/00001`). Same-state orders show CGST + SGST and other states show IGST. Customers download theirs from the Track page.

## "Money due to you" on the dashboard

This is an **estimate**, not your bank balance. It is shown as separate lines:

- **Waiting at gateway:** prepaid sales − refunds − estimated gateway fees − settlements you recorded.
- **COD held by courier:** delivered COD orders − remittances you recorded. Shiprocket also deducts freight and RTO charges.
- **Refunds you still owe.**

When money reaches your bank, record it on the **Money** page. Check exact figures in the Razorpay and Shiprocket dashboards.

## Order emails

The store emails customers when an order is confirmed, shipped (with the tracking number), delivered and cancelled, and at each return step. It also emails you about every new order and return request.

1. In `.env`, fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASS` (`.env.example` has Gmail and Zoho examples). With Gmail you must use an **App Password**, not your normal password.
2. Restart the server.
3. In **Admin › Settings › Emails**, enter the address for new-order alerts and press **Send test email**.

Every email, whether sent, failed or skipped, is listed in the email log under Settings. Until SMTP is set up, emails are logged as "skipped" and orders work normally.

## Coupons, size charts, homepage

- **Admin › Coupons:** percent or rupees off, minimum order, maximum discount, start and end dates, total uses, and uses per customer (counted by mobile number). The discount is spread across the items, so GST and refunds are worked out on what the customer actually paid.
- **Admin › Products › Size chart:** one size per line, values separated by commas, or paste from Excel.
- **Admin › Homepage:** top message strip, offer banners, promo tiles, and section headings and visibility.
- Photos are shrunk in the browser before upload (longest side 1600 px, WebP), so the shop stays fast.

## Customer accounts and staff roles

**Customers** can shop as guests, or create an account at `/account`. To sign up they enter their name, mobile number and email; a 6-digit code is emailed to them, and entering it creates the account. Later logins use email + code, so there are no passwords. Signed-in customers get **My orders** (track and return without the phone number), a saved delivery address and checkout filled in for them. Earlier guest orders with the same email and phone are added to the account at sign-up. Until email (SMTP) is set up, the code is shown on screen in test mode; in production the login is switched off instead.

**Staff roles** (Admin › Staff & security; only the owner can change them):

| Role | Can use |
|---|---|
| Owner | Everything |
| Manager | Orders, refunds, returns, products, homepage, coupons, customers, money, activity log, and can view settings. Cannot change settings or staff. |
| Orders staff | Orders, shipping, returns (no refunds) and bulk enquiries. No sales or money figures. |
| Catalogue staff | Products, stock, photos and the homepage |

Permissions are checked by the server on every admin request. A route not listed in the permission table is owner-only by default.

## Deploy on an India VPS (about ₹400–550/month)

Any 1 vCPU / 1 GB Ubuntu server in Mumbai or Bangalore is enough.

```bash
# 1. Install Node 22+ and Caddy (automatic HTTPS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs caddy

# 2. Copy the project to /srv/store, then:
cd /srv/store && npm ci --omit=dev
cp .env.example .env && nano .env   # NODE_ENV=production, SITE_URL=https://yourdomain.in, a long SESSION_SECRET, keys

# 3. Run it as a service
sudo tee /etc/systemd/system/store.service <<'EOF'
[Unit]
Description=Garment store
After=network.target
[Service]
WorkingDirectory=/srv/store
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
EOF
sudo chown -R www-data:www-data /srv/store/data /srv/store/uploads
sudo systemctl enable --now store

# 4. HTTPS reverse proxy
echo 'yourdomain.in { reverse_proxy 127.0.0.1:3000 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Backups (do this on day one)

Everything that matters is in `data/store.db` and `uploads/`. Back them up every night:

```bash
# /etc/cron.daily/store-backup
sqlite3 /srv/store/data/store.db ".backup '/srv/backups/store-$(date +%F).db'"
tar czf /srv/backups/uploads-$(date +%F).tgz -C /srv/store uploads
find /srv/backups -mtime +30 -delete
```

Copy `/srv/backups` off the server too, for example with `rclone` to Google Drive or Backblaze. Test a restore once.

### Connect Razorpay

1. Complete KYC and get **live** API keys. Razorpay usually asks to see the live site with its policy pages first.
2. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
3. Under Dashboard › Webhooks, add `https://yourdomain.in/api/webhooks/razorpay` with the events `payment.captured`, `payment.failed` and `order.paid`. Choose a secret and put the same value in `RAZORPAY_WEBHOOK_SECRET`.

### Connect Shiprocket

1. Under Settings › API, create an API user and put its email and password in `.env`.
2. Set `SHIPROCKET_PICKUP_LOCATION` to the exact pickup location name in your Shiprocket account.
3. Under Settings › Webhooks, add `https://yourdomain.in/api/webhooks/courier` (Shiprocket rejects URLs containing "shiprocket") with the `x-api-key` token type and a token. Put the same token in `SHIPROCKET_WEBHOOK_TOKEN`. Orders then move to shipped, delivered or RTO automatically.

### Launch checklist

- [ ] GSTIN registered, and all business details filled in under Settings
- [ ] Policies reviewed; grievance officer named
- [ ] Real photos, prices and stock entered; sample products removed or hidden
- [ ] Live Razorpay keys and webhook set; one real ₹1 test order paid and refunded
- [ ] Shiprocket connected; one test shipment created and cancelled
- [ ] Nightly backups running, and one restore tested
- [ ] Owner password changed; each staff member has their own login

## Project layout

```
server/
  index.js            app, security headers, server-rendered product pages, sitemap
  db.js               schema, settings, transactions
  seed.js             sample catalogue
  lib/orders.js       pricing, stock, order state machine, payment holds, returns
  lib/razorpay.js     gateway client (test mode without keys)
  lib/shiprocket.js   courier client (test mode without keys)
  lib/invoice.js      GST invoice
  routes/public.js    storefront API + webhooks
  routes/admin.js     admin API
public/
  index.html          scroll storytelling home (css/story.css, js/home.js)
  shop, product, bag, checkout, track, bulk, policies pages
  admin/              admin panel
test/flow.test.js     end-to-end order lifecycle test
```
