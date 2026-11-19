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
