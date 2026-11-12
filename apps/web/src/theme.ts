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
