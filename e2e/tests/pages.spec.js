import { expect, test } from '@playwright/test';
import { overflowX, ready, shot, watch } from './helpers.js';

const ROUTES = [
  ['home', '/'], ['shop', '/shop'], ['shop-category', '/shop?c=Shirts'], ['product', '/product/handloom-oxford-shirt'],
  ['bag', '/bag'], ['track', '/track'], ['account', '/account'], ['bulk', '/bulk'], ['policies', '/policies'], ['story', '/story'],
];

for (const [name, path] of ROUTES) {
  test(`${name} loads with no errors and no sideways overflow`, async ({ page }, info) => {
    const problems = watch(page);
    const res = await page.goto(path);
    expect(res.status()).toBe(200);
    await ready(page);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('.nav-wrap')).toBeVisible();
    expect(await overflowX(page), 'page is wider than the screen').toBeLessThanOrEqual(0);
    await shot(page, `${info.project.name}-${name}`);
    expect(problems).toEqual([]);
  });
}

test('unknown address shows the styled 404 page with a 404 status', async ({ page }) => {
  const res = await page.goto('/definitely-not-a-page');
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Lost the thread.' })).toBeVisible();
});

test('old fallback address for the admin panel still opens', async ({ page }) => {
  const res = await page.goto('/admin');
  expect(res.status()).toBe(200);
});
