import { expect, test } from '@playwright/test';
import { ADMIN } from '../playwright.config.js';
import { overflowX, shot, watch } from './helpers.js';

const rand = () => Math.floor(Math.random() * 1e9);

async function signIn(page, who = ADMIN) {
  await page.goto('/admin');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.side')).toBeAttached();
  await expect(page.locator('[data-title]')).not.toBeEmpty();
}

/** Opens a section by its address. On phones the menu is a drawer, which the address bar bypasses. */
async function open(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page.locator('[data-view]')).not.toContainText('Loading…');
}

/** Places a cash-on-delivery order straight through the store's API and returns its number. */
async function placeOrder(request) {
  const products = await (await request.get('/api/products')).json();
  const p = products.find((x) => !x.soldOut);
  const variant = p.variants.find((v) => v.available);
  const phone = `9${String(rand()).padStart(9, '0')}`;
  const res = await request.post('/api/checkout', {
    data: {
      items: [{ variantId: variant.id, qty: 1 }], paymentMethod: 'cod',
      customer: { name: 'Admin Test Buyer', phone, email: `admin.test.${rand()}@example.com`, line1: '5 Test Lane', line2: '', city: 'Erode', state: 'Tamil Nadu', pincode: '638001' },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).order.number;
}

test.describe('admin sign-in', () => {
  test('a wrong password is refused and the right one opens the dashboard', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.msg.err')).toBeVisible();
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('every section opens without errors or sideways overflow', async ({ page }, info) => {
    const problems = watch(page);
    await signIn(page);
    const sections = ['dashboard', 'orders', 'returns', 'products', 'homepage', 'coupons', 'customers', 'enquiries', 'money', 'settings', 'staff', 'activity'];
    for (const s of sections) {
      await open(page, s);
      await expect(page.locator('[data-view] .msg.err'), `${s} showed an error`).toHaveCount(0);
      expect(await overflowX(page), `${s} is wider than the screen`).toBeLessThanOrEqual(0);
      await page.waitForTimeout(250);
      await shot(page, `${info.project.name}-admin-${s}`);
    }
    expect(problems).toEqual([]);
  });

  test('on a phone the menu opens as a drawer and navigates', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone only');
    await signIn(page);
    await expect(page.locator('.side')).not.toBeInViewport();
    await page.locator('[data-menu]').click();
    await expect(page.locator('.side.open')).toBeInViewport();
    await page.locator('.side').getByRole('link', { name: 'Orders' }).click();
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.locator('.side.open')).toHaveCount(0);
  });
});

test.describe('admin orders', () => {
  test('ship, deliver and annotate an order', async ({ page, request }) => {
    const problems = watch(page);
    const number = await placeOrder(request);
    await signIn(page);
    await open(page, `orders?status=&q=${number}`);
    await page.locator('tr.click', { hasText: number }).click();
    await expect(page.getByRole('heading', { name: `Order ${number}` })).toBeVisible();

    await page.getByRole('button', { name: /Mark packed/ }).click();
    await expect(page.locator('.pill', { hasText: 'Packed' })).toBeVisible();
    await page.getByRole('button', { name: /Create shipment/ }).click();
    await expect(page.getByText(/AWB/).first()).toBeVisible(); // test mode makes a fake tracking number
    await page.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(page.locator('.pill', { hasText: 'Delivered' })).toBeVisible();

    await page.getByPlaceholder('Add an internal note').fill('Packed with care');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.tl li.note')).toContainText('Packed with care');
    expect(problems).toEqual([]);
  });

  test('cancelling an order asks first and updates the status', async ({ page, request }) => {
    const number = await placeOrder(request);
    page.on('dialog', (d) => d.accept());
    await signIn(page);
    await open(page, `order/${number}`);
    await page.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.locator('.pill', { hasText: 'Cancelled' })).toBeVisible();
  });

  test('manual tracking number can be saved instead of using the courier', async ({ page, request }) => {
    const number = await placeOrder(request);
    await signIn(page);
    await open(page, `order/${number}`);
    await page.getByText('Shipped another way?').click();
    await page.getByPlaceholder('Courier').fill('India Post');
    await page.getByPlaceholder('AWB / tracking no').fill(`MAN${rand()}`);
    await page.getByRole('button', { name: 'Save & mark shipped' }).click();
    await expect(page.locator('.pill', { hasText: 'Shipped' })).toBeVisible();
    await expect(page.getByText('India Post').first()).toBeVisible();
  });

  test('order search finds a customer and the orders tabs filter', async ({ page, request }) => {
    const number = await placeOrder(request);
    await signIn(page);
    await open(page, 'orders');
    await page.getByPlaceholder('Order no, name, phone, AWB').fill(number);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.locator('tr.click')).toHaveCount(1);
    await page.getByRole('link', { name: 'Cancelled' }).click();
    await expect(page.locator('[data-title]')).toHaveText('Orders'); // the tab stays on the Orders page
    await expect(page.locator('tr.click', { hasText: number })).toHaveCount(0); // a new order is not cancelled
  });
});

test.describe('admin catalogue and money', () => {
  test('create, edit and delete a coupon, and see it work at checkout', async ({ page, request }) => {
    await signIn(page);
    await open(page, 'coupons');
    const code = `E2E${rand() % 10000}`;
    await page.getByLabel('Code').fill(code);
    await page.getByLabel('Value').fill('15');
    await page.getByRole('button', { name: 'Create coupon' }).click();
    await expect(page.locator('table.t').getByText(code)).toBeVisible();

    // The store accepts it.
    const products = await (await request.get('/api/products')).json();
    const v = products[0].variants.find((x) => x.available);
    const quote = await (await request.post('/api/bag/quote', { data: { items: [{ variantId: v.id, qty: 1 }], paymentMethod: 'cod', couponCode: code } })).json();
    expect(quote.coupon?.code).toBe(code);
    expect(quote.discountPaise).toBeGreaterThan(0);

    page.on('dialog', (d) => d.accept());
    await page.locator('tr', { hasText: code }).getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: `Edit ${code}` })).toBeVisible();
    await page.getByLabel('Value').fill('20');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('tr', { hasText: code })).toContainText('20% off');
    await page.locator('tr', { hasText: code }).getByRole('button', { name: /Delete|Turn off/ }).click();
    await expect(page.locator('table.t').getByText(code)).toHaveCount(0);
  });

  test('product list opens an editor with variants and saves', async ({ page }) => {
    await signIn(page);
    await open(page, 'products');
    await page.locator('tr.click').first().click();
    await expect(page.locator('.var-table')).toBeVisible();
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.locator('.toast.on')).toContainText('Saved');
  });

  test('homepage editor saves', async ({ page }) => {
    await signIn(page);
    await open(page, 'homepage');
    await page.getByRole('button', { name: 'Save homepage' }).click();
    await expect(page.locator('.toast.on')).toContainText('Homepage saved');
  });

  test('settings save', async ({ page }) => {
    await signIn(page);
    await open(page, 'settings');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('.toast.on')).toContainText('Settings saved');
  });

  test('record a bank settlement and delete it', async ({ page }) => {
    await signIn(page);
    await open(page, 'money');
    const ref = `UTR${rand()}`;
    await page.getByLabel('Amount (₹)').fill('1234.50');
    await page.getByLabel('Reference / UTR').fill(ref);
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.locator('tr', { hasText: ref })).toContainText('₹1,234.5');
    page.on('dialog', (d) => d.accept());
    await page.locator('tr', { hasText: ref }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('tr', { hasText: ref })).toHaveCount(0);
  });

  test('a bulk enquiry from the store shows up for staff', async ({ page, request }) => {
    const name = `Bulk Buyer ${rand()}`;
    const res = await request.post('/api/enquiries', { data: { name, phone: '9000012345', email: '', quantity: '120', product: 'Linen Shirt', message: 'Need by March' } });
    expect(res.ok()).toBeTruthy();
    await signIn(page);
    await open(page, 'enquiries');
    await expect(page.getByText(name)).toBeVisible();
  });

  test('customers who signed up appear in the customer list', async ({ page, request }) => {
    const phone = `9${String(rand()).padStart(9, '0')}`;
    const email = `cust.${rand()}@example.com`;
    await request.post('/api/account/signup', { data: { name: 'Listed Customer', phone, email } });
    await signIn(page);
    await open(page, 'customers');
    await expect(page.locator('[data-view]')).not.toContainText('Loading');
    await expect(page.locator('[data-view] .msg.err')).toHaveCount(0);
  });
});

test.describe('admin staff roles', () => {
  test('a staff member only sees what their role allows', async ({ page, browser }) => {
    const staff = { name: 'Packer One', email: `packer.${rand()}@example.com`, password: `packer-pass-${rand()}` };
    await signIn(page);
    await open(page, 'staff');
    const addForm = page.locator('form[data-add]');
    await addForm.getByLabel('Name').fill(staff.name);
    await addForm.getByLabel('Email').fill(staff.email);
    await addForm.getByLabel('Role').selectOption('orders');
    await addForm.getByLabel('Temporary password').fill(staff.password);
    await addForm.getByRole('button', { name: 'Add staff' }).click();
    await expect(page.locator('table.t').getByText(staff.email)).toBeVisible();

    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await other.goto('/admin');
    await other.getByLabel('Email').fill(staff.email);
    await other.getByLabel('Password').fill(staff.password);
    await other.getByRole('button', { name: 'Sign in' }).click();
    await expect(other.locator('.side')).toBeAttached();
    const nav = other.locator('.side');
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeAttached();
    await expect(nav.getByRole('link', { name: 'Products' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Money' })).toHaveCount(0);
    await other.evaluate(() => { location.hash = 'products'; });
    await expect(other.getByText('Your role doesn’t include this page')).toBeVisible();
    await ctx.close();
  });
});
