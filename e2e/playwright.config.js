import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The tests start their own copy of the store on a spare port with a throwaway database,
// so they never touch real data. Uses the Chrome already installed on this computer.
const PORT = 3200;
const DB = path.join(os.tmpdir(), 'ramani-e2e', 'store.db');
export const ADMIN = { email: 'owner@test.local', password: 'test-password-123' };

if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  for (const f of ['', '-wal', '-shm']) fs.rmSync(DB + f, { force: true });
}

export default defineConfig({
  testDir: './tests',
  outputDir: './results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one shared server and database
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'node server/index.js',
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DB_FILE: DB,
      NODE_ENV: 'development',
      SITE_URL: `http://127.0.0.1:${PORT}`,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', SHIPROCKET_EMAIL: '', SHIPROCKET_PASSWORD: '',
      SMTP_HOST: '',
      RATE_LIMIT_MULTIPLIER: '100',
    },
  },
});
