import { defineConfig, devices } from '@playwright/test';

// Design review screenshots. Signed-in screens need Chromium (virtual passkey authenticator); the phone projects use
// the iPhone viewport, pixel ratio and touch input.
const phone = { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent };
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
export default defineConfig({
  testDir: '.', timeout: 300_000, workers: 1, reporter: 'list', expect: { timeout: 20_000 },
  use: { baseURL: process.env.SPD_E2E_BASE ?? 'http://localhost:5183' },
  projects: [
    { name: 'phone-light', use: { ...phone, colorScheme: 'light' } },
    { name: 'phone-dark', use: { ...phone, colorScheme: 'dark' } },
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
  ],
});
