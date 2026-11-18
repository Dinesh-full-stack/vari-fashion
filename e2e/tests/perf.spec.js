import { expect, test } from '@playwright/test';
import { ready } from './helpers.js';

// Performance checks. The CPU is slowed 4x to stand in for a mid-range phone, which is where lag shows up first.
const THROTTLE = 4;

// The test recorder's own screenshots would slow the page down and spoil the numbers.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
// Other programs on the computer can steal CPU for a moment, so a frame-time check gets two more tries before it counts as a failure.
test.describe.configure({ retries: 2 });

async function throttled(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await cdp.send('Performance.enable');
  return cdp;
}

const taskSeconds = async (cdp) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;

/** Measures frame-to-frame time in the page for `ms` milliseconds. */
const frames = (page, ms) => page.evaluate((span) => new Promise((resolve) => {
  const dts = []; let last = performance.now(); const end = last + span;
  const tick = (t) => { dts.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(dts.slice(1)); };
  requestAnimationFrame(tick);
}), ms);

/** Times a blank page under the same slowdown. If even that stutters, the computer is busy with other work and a fair speed measurement is impossible. */
async function computerIsBusy(page) {
  await page.goto('about:blank');
  const s = stats(await frames(page, 1500));
  return s.p50 > 25 || s.slow / s.frames > 0.1;
}

const stats = (dts) => {
  const s = [...dts].sort((a, b) => a - b);
  return { frames: s.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], worst: s[s.length - 1], slow: s.filter((d) => d > 50).length };
};

test('home stage: idle cost is low once the intro has played', async ({ page }, info) => {
  const cdp = await throttled(page);
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(3500); // intro animation
  const t0 = await taskSeconds(cdp);
  await page.waitForTimeout(3000);
  const busy = (await taskSeconds(cdp)) - t0;
  const fraction = busy / 3;
  console.log(`[perf ${info.project.name}] home idle main-thread busy: ${(fraction * 100).toFixed(0)}% (at ${THROTTLE}x slowdown)`);
  expect(fraction, 'the stage should not keep the CPU busy while nothing is moving').toBeLessThan(0.35);
});

test('home stage: stepping through garments stays smooth', async ({ page }, info) => {
  const cdp = await throttled(page);
  test.skip(await computerIsBusy(page), 'This computer is too busy right now for a fair speed measurement');
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(3500);
  const pending = frames(page, 3500);
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900); }
  const s = stats(await pending);
  console.log(`[perf ${info.project.name}] home stepping frames: p50 ${s.p50?.toFixed(0)}ms, p95 ${s.p95?.toFixed(0)}ms, worst ${s.worst?.toFixed(0)}ms, slow frames ${s.slow}/${s.frames}`);
  await cdp.detach();
  expect(s.slow / s.frames, 'fewer than 1 frame in 8 may take longer than 50ms').toBeLessThan(0.125);
});

for (const [name, path] of [['shop', '/shop'], ['home below the stage', '/']]) {
  test(`${name}: scrolling stays smooth`, async ({ page }, info) => {
    const cdp = await throttled(page);
    test.skip(await computerIsBusy(page), 'This computer is too busy right now for a fair speed measurement');
    await page.goto(path);
    await ready(page);
    await page.waitForTimeout(3000);
    if (name.startsWith('home')) await page.evaluate(() => window.scrollTo({ top: innerHeight, behavior: 'instant' }));
    await page.waitForTimeout(800);
    const pending = frames(page, 3000);
    for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, 260); await page.waitForTimeout(230); }
    const s = stats(await pending);
    console.log(`[perf ${info.project.name}] ${name} scroll frames: p50 ${s.p50?.toFixed(0)}ms, p95 ${s.p95?.toFixed(0)}ms, worst ${s.worst?.toFixed(0)}ms, slow frames ${s.slow}/${s.frames}`);
    await cdp.detach();
    expect(s.slow / s.frames, 'fewer than 1 frame in 8 may take longer than 50ms').toBeLessThan(0.125);
  });
}
