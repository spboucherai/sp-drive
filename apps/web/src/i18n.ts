// French by default, English available. Each area of the app owns one dictionary file in src/i18n/; keys are
// namespaced by area ("common.cancel", "explorer.newFolder"). A missing key shows the key itself, so it is noticed.
import { useSyncExternalStore } from 'react';
import { account } from './i18n/account.ts';
import { common } from './i18n/common.ts';
import { explorer } from './i18n/explorer.ts';
import { preview } from './i18n/preview.ts';
import { publicPages } from './i18n/public.ts';
import { sharing } from './i18n/sharing.ts';

export type Locale = 'fr' | 'en';
export type Dict = { fr: Record<string, string>; en: Record<string, string> };
const AREAS: Record<string, Dict> = { common, account, explorer, preview, public: publicPages, sharing };

const KEY = 'spd.locale';
let locale: Locale = ((): Locale => {
  const saved = localStorage.getItem(KEY);
  if (saved === 'fr' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
})();
const listeners = new Set<() => void>();
export const getLocale = (): Locale => locale;
export function setLocale(l: Locale): void { locale = l; localStorage.setItem(KEY, l); document.documentElement.lang = l; listeners.forEach((f) => f()); }
document.documentElement.lang = locale;

/** t('explorer.items', { n: 3 }) — `{n}` placeholders; "one | other" plural forms chosen by `n`. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const [area, ...rest] = key.split('.');
  const d = AREAS[area ?? ''];
  let s = d?.[locale][rest.join('.')] ?? d?.fr[rest.join('.')] ?? key;
  if (s.includes(' | ') && typeof vars.n === 'number') { const [one, other] = s.split(' | '); s = (vars.n === 1 || (locale === 'fr' && vars.n === 0) ? one : other) ?? s; }
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
/** Re-renders the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => locale);
  return t;
}
export const fmtDate = (iso: string | Date | null | undefined, o: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  iso ? new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', o).format(new Date(iso)) : '';
export function fmtRelative(iso: string | Date): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000, a = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (a < 60) return rtf.format(Math.round(s), 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return fmtDate(iso, { dateStyle: 'medium' });
}
/** Message for an API error: a translated text for known codes, the server's message otherwise. */
export function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code;
  const known = code ? common[locale][`error.${code}`] ?? common.fr[`error.${code}`] : undefined;
  return known ?? (e as Error)?.message ?? t('common.error.unknown');
}
