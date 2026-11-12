# Online-Only Premium Garment Store (India)

* **Author:** neuralnet-admin
* **Date:** 2026-11-12

## Overview

A new garment brand will sell only through its own website, to customers anywhere in India, with prices in INR. The brand has no existing customers, followers or sales channel.

The site has two sides.

**Customer side:**

- A home page and story pages that explain the brand, with animations that play as the visitor scrolls.
- About 20 products in different sizes and colors, each with a few hand-picked similar items.
- A bag, checkout and order tracking.
- 7-day returns and refunds.
- Payment by gateway (UPI, cards and net banking, at about 2% per payment) or cash on delivery (COD).
- A limit of 10 per item. Anyone wanting more goes to a "contact us for bulk" form or WhatsApp link.

**Admin side:**

- One or two staff enter stock by hand.
- They manage products, orders and returns.
- They see sales figures and an estimate of money still due to the business.

An AI coding assistant builds the site for an owner who is not a developer.

Success means steady orders coming through checkout instead of WhatsApp. The exact numeric target is still open (see D9).

Facts marked **[verify]** come from reviewer memory and must be checked against current vendor pages, or with a chartered accountant (CA), before anyone relies on them.

## Analysis

Seven independent reviewers looked at the concept. Their findings are grouped below, most serious first.

### 1. The choice between building from scratch and using a hosted platform cannot stay open

This one choice decides about 80% of the work.

**If the store is custom-built,** the owner becomes responsible for:

- payment confirmation that never creates the same order twice;
- stock that two buyers can't both buy;
- admin security, backups, hosting and software updates;
- GST invoices and duties for handling personal data.

The owner can't read code. Every later fix needs a new AI session that first has to re-read the whole project.

**If a hosted platform such as Shopify is used,** it already provides:

- products, sizes and colors, stock, orders and staff logins;
- refunds and abandoned-cart emails;
- Razorpay, Cashfree and COD apps;
- a Shiprocket app, returns apps and GST invoice apps;
- Google and Meta product feeds;
- an editor the owner can use without code.

The only custom work would be the scroll storytelling sections. Six of the seven reviewers prefer this. Its cost:

- Shopify Payments isn't available in India.
- A third-party gateway adds about 2% (Basic plan), 1% (Grow) or 0.6% (Advanced) on top of the gateway's own fee of about 2.36% including GST **[verify]**.
- On top of that come the plan fee (about ₹1,500 to ₹2,000 a month **[verify]**) and app fees.
- The checkout page can't be customised.

Switching platforms after launch means moving products, orders and returns history, and losing search rankings. It's close to a rebuild, so the choice has to be made first.

### 2. The real constraint is getting visitors, not the store

A brand with no audience will get no orders from a well-built store alone. The plan treats "people can check out without help" as the problem. The harder problem is "people want to buy." That second problem needs its own workstream:

- product photography and size guides;
- Instagram and Meta;
- free Google Merchant Center listings;
- product data that search engines can read.

The decision to sell "only through our own site" should be made on purpose. An Instagram shop or WhatsApp catalogue that sends buyers to the same store costs almost nothing.

### 3. Cash on delivery is the largest cost the plan hasn't priced

COD parcels the customer refuses at the door come back to you. This is called return-to-origin (RTO). In Indian online fashion it is often 20 to 30% or more **[verify]**, and a new, unknown brand is likely to be at the high end. Each one costs:

- shipping both ways;
- stock tied up while the parcel travels.

COD cash also arrives about a week after delivery **[verify]**, minus freight and RTO charges.

The 10-per-item limit doesn't address this risk. The controls that do are:

- a maximum order value for COD;
- an OTP or WhatsApp confirmation before shipping;
- blocking high-refusal pincodes and repeat refusers;
- a discount for paying upfront, or a COD fee shown before checkout.

Under India's 2023 dark-patterns guidelines, a fee added late in checkout isn't allowed.

### 4. Tax and legal requirements will decide the launch date

**GST:**

- Shipping to other states requires GST registration from day one, at any turnover.
- Apparel tax depends on price per piece: 5% up to ₹2,500 and 18% above, since September 2025 **[verify with a CA]**.
- Rates apply after discounts.
- Invoices need GSTIN, HSN codes and place of supply.
- Refunds need credit notes.

**Consumer Protection (E-Commerce) Rules 2020:**

- The seller's legal name and address must be published.
- A grievance officer must acknowledge complaints within 48 hours and resolve them within a month.
- Return, refund, shipping and cancellation policies must be published.

**Legal Metrology (packaging labels):** product pages must show MRP, manufacturer details, country of origin and a customer-care contact.

**Privacy (DPDP Act 2023):** the site needs a privacy notice and must ask for consent.

**Approval timing:** payment gateways usually require a live site with these policy pages before turning on real payments, and Shiprocket COD needs separate verification. These approvals take longer than the build, so start them now.

### 5. Scroll storytelling as described would hurt sales, speed and search

- **ScrollMagic** has not been maintained since about 2019–2020 **[verify]**. Use GSAP ScrollTrigger or the browser's built-in CSS scroll-driven animations instead **[verify licences and browser support]**.
- **Where:** animate only the home and story pages. Product, bag and checkout pages stay fast and plain, and every story section ends with a "Shop this" link.
- **Who sees it:** visitors who turn off motion, use data saver, or have slow phones or networks see still images instead.
- **Launch gate:** pages must load within a set budget on a real mid-range Android phone over 4G.

### 6. "Balance in hand" would mislead the owner

- The gateway reports what it paid out, not what is in your bank.
- There's no confirmed way to read "money still held by the gateway" or "COD the courier owes you" automatically **[verify]**.

A single figure would look like spendable cash when it isn't. Instead, call it "money due to you (estimate)" and show separate lines, each with its source and an "as of" time:

- paid out by the gateway;
- pending at the gateway;
- pending COD from the courier;
- minus refunds owed.

In version 1 this can be dashboard links or a weekly manual check.

### 7. Order, stock and return rules are not written down

The plan needs:

- **A list of order states**, from pending payment through to refunded or exchanged, and what moves an order from one to the next.
- **Stock rules:**
  - when stock is held for an order, and when the hold is released;
  - whether COD orders hold stock;
  - what happens to abandoned UPI payments;
  - that returned items go back on sale only after inspection.
- **Return rules:**
  - the window starts on the delivery date;
  - who pays for the return pickup;
  - whether part of an order can be returned;
  - whether shipping is refunded;
  - what condition items must be in (for example, tags on);
  - how an exchange works when the requested size is out of stock.

**COD refunds:** refunding by manual bank transfer means storing customers' bank details and invites fraud. Use the gateway's payout feature, UPI refund links where the customer enters their own UPI ID, or store credit.

### 8. Ownership, operations and content are missing

**Accounts:** the owner must hold every account (domain, platform, gateway, Shiprocket, Google, email, WhatsApp Business), each with two-factor login. Each staff member gets their own limited login.

**Written step-by-step guides** are needed for:

- daily orders;
- returns and refunds;
- RTO;
- stock counts;
- a payment with no matching order;
- the site or gateway being down.

**Before launch:**

- a test copy of the store;
- a test of each payment path;
- a soft launch with friends, including one refund;
- a switch to turn off COD or the whole store.

**Content only the owner can supply:**

- photos and copy;
- size charts;
- fabric and care details;
- package weights and dimensions (needed for shipping rates);
- opening stock per size and color;
- prices.

### Core trade-offs and how to resolve them

| Trade-off | Resolution |
|---|---|
| Owning custom code vs low maintenance for a non-developer | Rent the store engine on a hosted platform. Build only the storytelling sections as theme add-ons. |
| Rich animation vs fast, accessible, searchable pages | Animate only story pages. Write the story as real text and images, with motion added on top. Show still images on weak devices. |
| COD brings more buyers vs RTO cost and slow cash | Offer COD only when risk rules pass, and reward paying upfront. |
| Admin approves every return vs only one or two staff | Accept pickup requests automatically within the window. Move the human check to the refund, after inspecting the item. **This changes your stated rule. Your decision.** |
| One balance figure vs accuracy | Separate, dated estimates that show mismatches instead of hiding them. |

**Ideal end state:**

- A hosted platform runs payments, COD rules, stock, shipping, return pickups and refunds without supervision.
- A small storytelling layer sits on top.
- Staff do three things: enter stock, inspect returns and check money mismatches.
- The owner never touches code.
- Orders come in through checkout, not WhatsApp.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * **G1:** About 20 products with sizes and colors. Payment by UPI, card or net banking through a gateway, plus COD as a customer choice (D5).
  * **G2:** Shipping, tracking and return pickup through Shiprocket, using its tracking page.
  * **G3:** 7-day exchange or refund under a published policy. Prepaid refunds go to the original payment method; COD refunds go through payouts or store credit.
  * **G4:** Staff manage products, stock, orders and returns in the platform admin, with individual logins and a record of changes.
  * **G5:** One scroll-storytelling home and story experience that meets a mobile speed budget, supports reduced motion, and never blocks buying.
  * **G6:** A legally compliant launch: GST invoices, policy pages, a grievance officer, product label fields and a privacy notice.
  * **G7:** Numeric success targets with dates, and search-readable product pages (server-rendered HTML, product structured data, a sitemap).
  * The 10-per-item limit and the WhatsApp/contact link for bulk orders.

* **Out-of-Scope Non-Goals:**
  * A hosted store platform (Shopify or similar). The author chose a custom build instead (D1).
  * Marketing and visitor acquisition, which the owner handles (D11).
  * An automatically combined "balance in hand" figure (version 1 uses separate estimates or links).
  * Automatic "similar items" suggestions (they are hand-picked instead).
  * A custom tracking page.
  * Animation on product, bag or checkout pages.
  * Bulk or pre-order checkout.
  * International shipping, other currencies, marketplaces, Tally/ERP sync, multiple warehouses, wholesale pricing and loyalty programmes.

## Alternatives Weighed

| Alternative | Outcome | Reason |
|---|---|---|
| In-house payment gateway | Rejected by author | Needs an RBI Payment Aggregator licence (₹15 crore net worth at application), PCI-DSS audits and bank agreements. |
| Direct UPI to own bank with manual reference-number matching | Rejected by author | The site can't confirm payment, staff would check every payment by hand, fake-screenshot fraud is common, and refunds are manual. |
| Pre-order flow for bulk buyers | Rejected by author | A contact form or WhatsApp link is enough and much cheaper to build. |
| Fully custom store (for example Next.js with a database, Razorpay and Shiprocket APIs, and a custom admin) | Not preferred by reviewers; owner decision pending | Lowest platform fees, but the owner carries every security, payment, stock and maintenance risk, with paid AI or developer time for every change. |
| Headless Shopify (custom front end with Shopify behind it) | Rejected for v1 by reviewers | Brings back custom hosting, code and SEO work, and loses the no-code editor and many apps. It can be added later. |
| WooCommerce | Rejected by reviewers | Self-hosted, so the owner takes on updates and plugin security. |
| Indian hosted platforms (Dukaan, Zoho Commerce, Instamojo) | Price-check as a fallback | Possibly cheaper, with local COD and GST support, but likely less design freedom for the storytelling **[verify]**. |
| Manual bank transfer for COD refunds | Rejected by reviewers | Fraud risk and storage of customer bank details. Use payouts, UPI refund links or store credit. |
| ScrollMagic library | Rejected by reviewers | Unmaintained **[verify]**. Use GSAP ScrollTrigger or CSS scroll-driven animations. |

## Key Decisions & Staging for Next Steps

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Platform | **Decided by author: fully custom build.** The owner is a developer and will maintain the code; Shopify's monthly fee and extra per-order fee were rejected. The custom-build duties in Analysis section 1 (payment confirmation that never creates the same order twice, stock locking, admin security, backups, updates) are now in scope. | **Decided** |
| D2 | Business setup | Business entity, current account, GSTIN, trademark search. A CA confirms the GST rates, HSN codes and invoice series. Start gateway and Shiprocket verification now. | Open |
| D3 | Legal pages and product label fields | Write them before asking the gateway to enable live payments | Open |
| D4 | Order states and stock rules | Write them down, or adopt the platform's | Open |
| D5 | COD policy | **Decided by author:** both prepaid and COD are offered, and the customer chooses. Reviewer-recommended COD limits are not adopted at launch (accepted risk: refused parcels). RTO rate is still tracked in the admin panel, so limits can be added later. | **Decided** |
| D6 | Returns policy | Answer every rule in section 7. Keep "admin approves every return" or move the check to inspection. | **Open: owner** |
| D7 | Animation | **Decided by author:** drop ScrollMagic and use GSAP ScrollTrigger on the story and home pages, with a reduced-motion fallback and a speed budget as a launch gate. | **Decided** |
| D11 | Getting visitors | **Decided by author:** the owner handles marketing and visitor acquisition through their own contacts. It is outside this project's scope. | **Decided** |
| D8 | Money view | "Money due (estimate)" as separate dated lines; links or a manual check in v1 | Proposed |
| D9 | Success metrics | For example, N orders a week by week 12, at least 95% via checkout, plus RTO, return rate and conversion | **Open: owner sets N** |
| D10 | Ownership and operations | Owner holds all accounts with two-factor login. Step-by-step guides, test store, soft launch, store and COD off switch. | Proposed |

**Suggested phases:**

1. **Phase 0:** decisions D1 to D3, and start verifications.
2. **Phase 1:** a selling store with prepaid checkout, Shiprocket and a simple story page.
3. **Phase 2:** COD with controls, plus returns, exchanges and refunds. COD never goes live without its controls.
4. **Phase 3:** full scroll storytelling, gated by the speed budget.
5. **Phase 4:** automated money view.

A visitor-acquisition workstream runs alongside every phase.
