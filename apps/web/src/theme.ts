/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/theme.ts
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

// Follows the system by default; the user may choose light or dark. Applied before first paint by main.tsx.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'spd.theme';
const listeners = new Set<() => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');
export const getTheme = (): ThemeChoice => { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : 'system'; };
export const isDark = (): boolean => { const c = getTheme(); return c === 'dark' || (c === 'system' && media.matches); };
/** The browser chrome (status bar, address bar) takes the colour of the page. */
export function paintChrome(dark: boolean): void {
  document.querySelectorAll<HTMLMetaElement>('meta[name=theme-color]').forEach((m) => { m.removeAttribute('media'); m.content = dark ? '#050508' : '#f4f4f9'; });
}
export function applyTheme(): void {
  const dark = isDark();
  document.documentElement.classList.toggle('dark', dark);
  paintChrome(dark);
  listeners.forEach((f) => f());
}
export function setTheme(c: ThemeChoice): void {
  localStorage.setItem(KEY, c);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(applyTheme); else applyTheme();
}
media.addEventListener('change', applyTheme);
export function useTheme(): { choice: ThemeChoice; dark: boolean } {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => `${getTheme()}:${isDark()}`);
  return { choice: snap.split(':')[0] as ThemeChoice, dark: snap.endsWith('true') };
}
