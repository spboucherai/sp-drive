// Light by default; the user may choose dark or follow the system. Applied before first paint by main.tsx.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'spd.theme';
const listeners = new Set<() => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');
export const getTheme = (): ThemeChoice => { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'system' ? v : 'light'; };
export const isDark = (): boolean => { const c = getTheme(); return c === 'dark' || (c === 'system' && media.matches); };
export function applyTheme(): void {
  document.documentElement.classList.toggle('dark', isDark());
  listeners.forEach((f) => f());
}
export function setTheme(c: ThemeChoice): void { localStorage.setItem(KEY, c); applyTheme(); }
media.addEventListener('change', applyTheme);
export function useTheme(): { choice: ThemeChoice; dark: boolean } {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => `${getTheme()}:${isDark()}`);
  return { choice: snap.split(':')[0] as ThemeChoice, dark: snap.endsWith('true') };
}
