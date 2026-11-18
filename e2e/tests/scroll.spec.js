import { expect, test } from '@playwright/test';
import { overflowX, ready, scrollThrough, shot, watch } from './helpers.js';

// Scrolls each long page one screen at a time. At every stop: nothing may be wider than the screen,
// nothing may throw, and a screenshot is saved for review.
const PAGES = [
  ['home', '/'], ['shop', '/shop'], ['product', '/product/handloom-oxford-shirt'], ['story', '/story'], ['policies', '/policies'],
];

for (const [name, path] of PAGES) {
  test(`${name}: scroll audit`, async ({ page }, info) => {
    const problems = watch(page);
    await page.goto(path);
    await ready(page);
    await scrollThrough(page, async (n) => {
      expect(await overflowX(page), `sideways overflow at stop ${n}`).toBeLessThanOrEqual(0);
      await shot(page, `${info.project.name}-${name}-scroll-${String(n).padStart(2, '0')}`);
    });
    expect(problems).toEqual([]);
  });
}
