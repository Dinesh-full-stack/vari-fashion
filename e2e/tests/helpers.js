import fs from 'node:fs';
import path from 'node:path';

export const SHOTS = path.resolve(import.meta.dirname, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Hosts the tests cannot reach on purpose or that are not part of the store.
const IGNORED_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|checkout\.razorpay\.com|wa\.me/;

/** Collects everything that should never happen on a healthy page: script errors, console errors, failed or 4xx/5xx requests. */
export function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || IGNORED_HOSTS.test(m.text())) return;
    // Asking "who is signed in?" while signed out answers 401 by design; the browser logs that as a console error.
    if (/status of 401/.test(m.text())) return;
    problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => { if (!IGNORED_HOSTS.test(r.url())) problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`); });
  page.on('response', (r) => {
    if (r.status() >= 400 && !IGNORED_HOSTS.test(r.url()) && !/\/api\/(account|admin)\/me$/.test(r.url()) && !r.url().endsWith('.jpg')) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return problems;
}

/** Waits until the React app has drawn the page's main content. */
export async function ready(page) {
  await page.waitForLoadState('networkidle');
  await page.locator('#main').waitFor();
}

/** Anything wider than the screen is a layout bug (sideways scrolling on phones). */
export const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

/** Scrolls down the page in steps, calling `each(step, y)` at every stop after things have settled. */
export async function scrollThrough(page, each, { stepRatio = 0.8, max = 40 } = {}) {
  const vh = await page.evaluate(() => innerHeight);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  let y = 0; let n = 0;
  while (n < max) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(700);
    await each(n, y);
    if (y + vh >= total - 2) break;
    y += Math.round(vh * stepRatio); n += 1;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}
