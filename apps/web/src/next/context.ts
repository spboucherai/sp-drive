/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/context.ts
 * Module           : next
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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

// What the screen in front can do, for the pieces that live outside it (command palette, transfer centre): the
// folder being shown, the current selection, and the commands the explorer offers on them. The explorer publishes,
// the shell reads. Nothing here is persisted.
import { useSyncExternalStore } from 'react';
import type { Item } from '../types.ts';

export interface ExplorerContext {
  folder: { id: string; name: string } | null;
  selection: Item[];
  newFolder?: () => void;
  upload?: () => void;
  moveSelection?: () => void;
  shareSelection?: () => void;
}
let ctx: ExplorerContext = { folder: null, selection: [] };
const listeners = new Set<() => void>();
export const getContext = (): ExplorerContext => ctx;
export function setContext(c: ExplorerContext): void { ctx = c; listeners.forEach((f) => f()); }
export const clearContext = (): void => setContext({ folder: null, selection: [] });
export const useExplorerContext = (): ExplorerContext => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => ctx);

/** Ask the shell for something from anywhere (open the transfer centre, the palette…). */
export type ShellRequest = 'transfers' | 'palette' | 'new-collection';
export const requestShell = (what: ShellRequest, detail?: unknown): void => { window.dispatchEvent(new CustomEvent('spd:shell', { detail: { what, detail } })); };
