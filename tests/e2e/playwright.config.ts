import { defineConfig, devices } from '@playwright/test';

// Runs against a running stack (scripts/dev-stack.sh, or SPD_E2E_BASE for another one). Passkeys are exercised with
// Chromium's virtual authenticator, so the signed-in projects are Chromium (desktop and phone viewport); the public
// pages (share links, deposit portals) also run on WebKit with an iPhone profile.
export default defineConfig({
  testDir: '.', timeout: 120_000, workers: 1, reporter: 'list', outputDir: '../../test-results', expect: { timeout: 15_000 },
  use: { baseURL: process.env.SPD_E2E_BASE ?? 'http://localhost:5183', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-public', use: { ...devices['iPhone 15'] }, testMatch: /public\..*\.spec\.ts/ },
  ],
});
