/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/main.tsx
 * Module           : web
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

import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api.ts';
import { App } from './App.tsx';
import { applyTheme } from './theme.ts';
import { ToastProvider } from './ui.tsx';

applyTheme();
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500) }, mutations: { retry: false } },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><ToastProvider><App /></ToastProvider></QueryClientProvider></StrictMode>,
);
// Installable app shell. Never registered in development: a stale worker would hide code changes.
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
