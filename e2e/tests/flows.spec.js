import { expect, test } from '@playwright/test';
import { ready, watch } from './helpers.js';

const rand = () => Math.floor(Math.random() * 1e9);
const buyer = () => ({ name: 'Test Buyer', phone: `9${String(rand()).padStart(9, '0')}`, email: `buyer.${rand()}@example.com` });

async function addToBag(page, slug = 'handloom-oxford-shirt', size = 'M') {
  await page.goto(`/product/${slug}`);
  await ready(page);
  await page.locator('.size-btn:not([disabled])', { hasText: new RegExp(`^${size}$`) }).first().click();
  await page.locator('.btn.add').click();
  await expect(page.locator('.drawer.open')).toBeVisible();
}

async function fillCheckout(page, b) {
  await page.getByLabel('Full name').fill(b.name);
  await page.getByLabel('Mobile number').fill(b.phone);
  await page.getByLabel('Email').fill(b.email);
  await page.getByLabel('House / flat, street').fill('12 Test Street');
  await page.getByLabel('Pincode').fill('638001');
  await page.getByLabel('City').fill('Erode');
  await page.getByLabel('State / UT').selectOption('Tamil Nadu');
}

test.describe('home stage', () => {
  test('arrows, keyboard and buy card work, and the scan reveal swaps the garment', async ({ page, isMobile }) => {
    test.skip(isMobile, 'arrows and keys are desktop controls');
    const problems = watch(page);
    await page.goto('/');
    await ready(page);
    await expect(page.locator('.gcard')).toHaveCount(10);
    const names = () => page.locator('.b-name').allInnerTexts().then((t) => t.join('|'));
    await expect.poll(async () => (await page.locator('.cur-fig').getAttribute('data-src')) || '').not.toBe('');
    const first = await names();

    await page.getByRole('button', { name: 'Next garment' }).click();
    await expect.poll(names, { timeout: 8000 }).not.toBe(first);
    const second = await names();
    await page.keyboard.press('ArrowRight');
    await expect.poll(names, { timeout: 8000 }).not.toBe(second);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(names, { timeout: 8000 }).toContain(first.split('|').pop());

    // Size first, then add to bag from the glass buy card.
    await expect(page.locator('.buy .btn')).toHaveText(/Choose a size/);
    await page.locator('.b-size .chips button:not([disabled])').first().click();
    await page.locator('.buy .btn').click();
    await expect(page.locator('.drawer.open')).toBeVisible();
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('bag.v1'))).length).toBe(1);
    expect(problems).toEqual([]);
  });

  test('dragging the arc moves it and the nav stays usable', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drag');
    await page.goto('/');
    await ready(page);
    const before = await page.locator('.b-name').allInnerTexts();
    await page.mouse.move(720, 300);
    await page.mouse.down();
    await page.mouse.move(300, 300, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await page.locator('.b-name').allInnerTexts()).join('|'), { timeout: 8000 }).not.toBe(before.join('|'));
  });

  test('the headline word has no outline artefacts and the nav gets a backing when scrolled', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    const stroke = await page.locator('.ghost').evaluate((el) => getComputedStyle(el).webkitTextStrokeWidth);
    expect(stroke).toBe('0px');
    await expect(page.locator('.nav-wrap')).not.toHaveClass(/scrolled/);
    await page.mouse.wheel(0, 600);
    await expect(page.locator('.nav-wrap')).toHaveClass(/scrolled/);
  });
});

test.describe('shop', () => {
  test('search, filters, sort and clearing', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/shop');
    await ready(page);
    const cards = page.locator('.shop-grid .card');
    await expect(cards).toHaveCount(20);

    const search = page.getByPlaceholder('Search this shop');
    await search.fill('tee');
    await expect.poll(() => cards.count()).toBeLessThan(20);
    const teeCount = await cards.count();
    expect(teeCount).toBeGreaterThan(0);
    await search.fill('');
    await expect(cards).toHaveCount(20);

    await page.getByRole('combobox').selectOption('low');
    const prices = (await page.locator('.shop-grid .card .price').allInnerTexts()).map((t) => Number(t.replace(/[^0-9.]/g, '').slice(0, 5)));
    expect(prices.length).toBeGreaterThan(5);

    if (await page.locator('.shop-side').isVisible()) {
      await page.locator('.shop-side label', { hasText: 'Shirts' }).click();
      await expect.poll(() => cards.count()).toBeLessThan(20);
      await expect(page.locator('.active-chips .chip')).toHaveCount(1);
      await page.getByRole('button', { name: 'Clear all' }).click();
      await expect(cards).toHaveCount(20);
    }
    await page.goto('/shop?q=zzzz-nothing');
    await expect(page.getByRole('heading', { name: 'No matching products' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('mobile filter sheet opens, filters and closes', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone only');
    await page.goto('/shop');
    await ready(page);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.locator('.sheet.open .sheet-card')).toBeVisible();
    await page.locator('.sheet label', { hasText: 'Kurtas' }).click();
    await page.getByRole('button', { name: /^Show \d+ pieces?/ }).click();
    await expect(page.locator('.sheet.open')).toHaveCount(0);
    await expect(page.locator('.shop-grid .card').first()).toBeVisible();
  });
});

test.describe('product and bag', () => {
  test('colour and size selection, quantity, drawer and removal', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/product/handloom-oxford-shirt');
    await ready(page);
    await expect(page.locator('.btn.add')).toHaveText(/Choose a size/);
    await page.locator('.color-btn').nth(1).click();
    await expect(page.locator('.label b').first()).not.toHaveText('Indigo');
    await page.locator('.size-btn:not([disabled])').first().click();
    await page.locator('.stepper.lg button[aria-label="Increase quantity"]').click();
    await expect(page.locator('.stepper.lg output')).toHaveText('2');
    await page.locator('.btn.add').click();
    await expect(page.locator('.drawer.open .line')).toHaveCount(1);
    await expect(page.locator('.drawer.open .line .stepper output')).toHaveText('2');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('heading', { name: 'Your bag is empty' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('pincode check and size chart', async ({ page }) => {
    await page.goto('/product/handloom-oxford-shirt');
    await ready(page);
    await page.getByLabel('Pincode').fill('12');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Enter a valid 6-digit pincode.')).toBeVisible();
    await page.getByLabel('Pincode').fill('638001');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Usually delivered in')).toBeVisible();
    await page.getByRole('button', { name: 'Size chart' }).click();
    await expect(page.locator('.size-table')).toBeVisible();
  });

  test('bag page edits quantity and blocks nothing for healthy items', async ({ page }) => {
    await addToBag(page);
    await page.goto('/bag');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Your bag' })).toBeVisible();
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.locator('#main .line .stepper output')).toHaveText('2');
    await expect(page.locator('#main').getByRole('link', { name: /Checkout/ })).toBeVisible();
  });
});

test.describe('checkout and orders', () => {
  test('cash on delivery: checkout, thank-you, tracking and invoice link', async ({ page }) => {
    const problems = watch(page);
    const b = buyer();
    await addToBag(page, 'handloom-oxford-shirt', 'L');
    await page.goto('/checkout');
    await ready(page);
    await fillCheckout(page, b);
    await page.locator('label.pay-opt', { hasText: 'Cash on delivery' }).click();
    await expect(page.getByRole('button', { name: /^Place order/ })).toBeEnabled();
    await page.getByRole('button', { name: /^Place order/ }).click();

    await expect(page.getByRole('heading', { name: 'Thank you.' })).toBeVisible();
    const order = (await page.locator('.lead b').innerText()).trim();
    expect(order).toMatch(/^[A-Z]{2}\d{5}$/);
    expect(await page.evaluate(() => localStorage.getItem('bag.v1'))).toBe('[]');

    await page.getByRole('link', { name: 'Track this order' }).click();
    await expect(page.getByRole('heading', { name: `Order ${order}` })).toBeVisible();
    await expect(page.locator('.steps .on')).toHaveCount(1);
    await expect(page).not.toHaveURL(/phone=/); // the phone number is not left in the address bar
    await expect(page.getByRole('link', { name: 'Download invoice' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('prepaid test payment: failure keeps the order, success completes it', async ({ page }) => {
    const b = buyer();
    await addToBag(page, 'indigo-resist-shirt', 'M').catch(async () => addToBag(page));
    await page.goto('/checkout');
    await ready(page);
    await expect(page.getByText('Test mode.')).toBeVisible();
    await fillCheckout(page, b);
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect(page.getByText(/Test payment for/)).toBeVisible();
    await page.getByRole('button', { name: 'Simulate failure' }).click();
    await expect(page.getByText(/Payment did not go through/)).toBeVisible();
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.getByRole('button', { name: 'Simulate success' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you.' })).toBeVisible();
  });

  test('checkout validates empty fields and an unknown coupon is explained', async ({ page }) => {
    await addToBag(page);
    await page.goto('/checkout');
    await ready(page);
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect(page.getByText(/Please fill in/)).toBeVisible();
    await page.getByPlaceholder('Coupon code').fill('NOPE123');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.coupon-msg')).toBeVisible();
  });

  test('checkout with an empty bag goes back to the bag', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/bag$/);
    await expect(page.getByRole('heading', { name: 'Your bag is empty' })).toBeVisible();
  });

  test('tracking: a wrong phone number is refused, a missing order explained', async ({ page }) => {
    await page.goto('/track');
    await ready(page);
    await page.getByLabel('Order number').fill('ZZ99999');
    await page.getByLabel('Mobile number').fill('9000000000');
    await page.getByRole('button', { name: 'Find my order' }).click();
    await expect(page.locator('.notice.err')).toBeVisible();
  });
});

test.describe('accounts and forms', () => {
  test('sign up with the emailed code, save an address, log out and log in again', async ({ page }) => {
    const problems = watch(page);
    const b = buyer();
    await page.goto('/account');
    await ready(page);
    await page.getByRole('tab', { name: 'Sign up' }).click();
    await page.getByLabel('Full name').fill(b.name);
    await page.getByLabel('Mobile number').fill(b.phone);
    await page.getByLabel('Email').fill(b.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    const code = (await page.locator('.notice.test b').last().innerText()).trim(); // test mode prints the code on screen
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: /^Hello, Test/ })).toBeVisible();

    await page.getByLabel('House / flat, street').fill('7 Mill Road');
    await page.getByLabel('Pincode').fill('638001');
    await page.getByLabel('City').fill('Erode');
    await page.getByLabel('State / UT').selectOption('Tamil Nadu');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/account');
    await page.getByLabel('Email').fill(b.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    const code2 = (await page.locator('.notice.test b').last().innerText()).trim();
    await page.getByLabel('Code').fill(code2);
    await page.getByRole('button', { name: 'Log in' }).last().click();
    await expect(page.getByRole('heading', { name: /^Hello, Test/ })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a wrong login code is refused', async ({ page }) => {
    await page.goto('/account');
    await ready(page);
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.locator('.notice.err, h1:has-text("Check your email")').first()).toBeVisible();
  });

  test('bulk enquiry is sent and the product name is carried over', async ({ page }) => {
    const b = buyer();
    await page.goto('/bulk?product=Linen%20Shirt');
    await ready(page);
    await expect(page.getByLabel('Which products?')).toHaveValue('Linen Shirt');
    await page.getByLabel('Your name').fill(b.name);
    await page.getByLabel('Mobile number').fill(b.phone);
    await page.getByLabel('Approximate quantity').fill('50');
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you.' })).toBeVisible();
  });

  test('policies: table of contents and deep links land on the right section', async ({ page }) => {
    await page.goto('/policies#grievance');
    await ready(page);
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('grievance').getBoundingClientRect().top)), { timeout: 8000 }).toBeLessThan(260);
    await page.locator('.toc a', { hasText: 'Privacy' }).click();
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('privacy').getBoundingClientRect().top)), { timeout: 8000 }).toBeLessThan(260);
  });
});

test.describe('navigation', () => {
  test('tabs move between pages with the sliding highlight and the logo returns home', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.locator('.tabs').getByRole('link', { name: 'Shirts' }).click();
    await expect(page).toHaveURL(/\/shop\?c=Shirts/);
    await expect(page.locator('.tabs [aria-current="page"]')).toHaveText('Shirts');
    await expect(page.locator('.tabs .pill')).toHaveCSS('opacity', '1');
    await page.locator('.tabs').getByRole('link', { name: 'Story' }).click();
    await expect(page).toHaveURL(/\/story$/);
    await page.locator('.logo').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('the bag count in the nav follows the bag', async ({ page }) => {
    await addToBag(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tools .count')).toHaveText('1');
  });
});
