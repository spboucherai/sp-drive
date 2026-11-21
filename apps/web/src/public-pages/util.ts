/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/public-pages/util.ts
 * Module           : public-pages
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

// Helpers shared by the two anonymous pages. Nothing here knows about the signed-in application.
import { extOf, sanitizeName } from '@spd/shared';

export { BLOCKED_EXT } from '@spd/shared';
import { BLOCKED_EXT } from '@spd/shared';
/** Extension the server will see for a client file name. */
export const serverExt = (name: string): string => extOf(sanitizeName(name));

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** A valid #rrggbb, or the default accent. */
export const safeColor = (c: string | undefined | null): string => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#2563eb');
/** Text colour (near-black or white) with the better WCAG contrast on a background colour. */
export function inkOn(bg: string): string {
  const l = lum(safeColor(bg));
  return ratio(l, 1) >= ratio(l, lum('#0f1419')) ? '#ffffff' : '#0f1419';
}
/** CSS variables that make `bg-accent text-accent-ink` use a portal's colour on one element (the theme tokens are resolved at the root, so both layers are set). */
export const accentVars = (color: string): React.CSSProperties => ({ '--accent': safeColor(color), '--accent-ink': inkOn(color), '--color-accent': safeColor(color), '--color-accent-ink': inkOn(color), '--grad-a': safeColor(color), '--grad-b': safeColor(color), '--grad-ink': inkOn(color) }) as React.CSSProperties;

/** Storage key derived from a link token without containing it. */
export function tokenKey(prefix: string, token: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < token.length; i++) { h1 = Math.imul(h1 ^ token.charCodeAt(i), 0x01000193); h2 = Math.imul(h2 + token.charCodeAt(i), 0x85ebca6b) ^ (h2 >>> 13); }
  return `${prefix}.${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}
export const store = {
  get<T>(key: string): T | null { try { const v = sessionStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(key: string, value: unknown): void { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the page works without it */ } },
  del(key: string): void { try { sessionStorage.removeItem(key); } catch { /* idem */ } },
};
export const isTouch = (): boolean => window.matchMedia('(pointer: coarse)').matches;
