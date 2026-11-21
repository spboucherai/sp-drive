/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/playwright.config.ts
 * Module           : tests
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
