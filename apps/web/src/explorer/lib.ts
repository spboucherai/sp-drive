// Small helpers shared by the explorer's files: query key, tag colours, downloads, preferences, dropped folders.
import { useCallback, useState, useSyncExternalStore } from 'react';
import { qs } from '../api.ts';
import type { Item } from '../types.ts';

/** Root of every react-query key owned by the explorer: one invalidation refreshes listings, details and tags. */
export const XKEY = 'explorer';

export const TAG_COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export const TAG_STYLE: Record<string, { chip: string; dot: string }> = {
  slate: { chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300', dot: 'bg-slate-500' },
  red: { chip: 'bg-red-500/15 text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  orange: { chip: 'bg-orange-500/15 text-orange-800 dark:text-orange-300', dot: 'bg-orange-500' },
  amber: { chip: 'bg-amber-500/20 text-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
  green: { chip: 'bg-green-500/15 text-green-800 dark:text-green-300', dot: 'bg-green-500' },
  teal: { chip: 'bg-teal-500/15 text-teal-800 dark:text-teal-300', dot: 'bg-teal-500' },
  blue: { chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  violet: { chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  pink: { chip: 'bg-pink-500/15 text-pink-700 dark:text-pink-300', dot: 'bg-pink-500' },
};
export const tagStyle = (color: string) => TAG_STYLE[color] ?? TAG_STYLE.slate!;

export interface Sel { fileIds: string[]; folderIds: string[] }
export const toSel = (items: Item[]): Sel => ({ fileIds: items.filter((i) => i.type === 'file').map((i) => i.id), folderIds: items.filter((i) => i.type === 'folder').map((i) => i.id) });

/** Start a browser download without leaving the page (the API answers with an attachment). */
export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url; a.download = ''; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
}
export const zipUrl = (s: Sel) => `/api/v1/zip${qs({ files: s.fileIds.join(','), folders: s.folderIds.join(',') })}`;

/** A string preference kept in localStorage. */
export function usePref<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { const s = localStorage.getItem(key) as T | null; return s && allowed.includes(s) ? s : initial; });
  const set = useCallback((n: T) => { localStorage.setItem(key, n); setV(n); }, [key]);
  return [v, set];
}
export function useMedia(query: string): boolean {
  return useSyncExternalStore((cb) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); }, () => window.matchMedia(query).matches);
}
export const isTouchDevice = () => navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

/** A file chosen for upload; `relativePath` ("Dossier/sous/fichier.txt") recreates the folders of a folder upload. */
export interface Picked { file: File; relativePath?: string }
export const pickedFromInput = (list: FileList | null): Picked[] => [...(list ?? [])].map((file) => ({ file, relativePath: file.webkitRelativePath || undefined }));

const readAll = (dir: FileSystemDirectoryEntry) => new Promise<FileSystemEntry[]>((resolve, reject) => {
  const reader = dir.createReader(), out: FileSystemEntry[] = [];
  const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(out); else { out.push(...batch); next(); } }, reject); // readEntries answers in batches
  next();
});
async function walk(entry: FileSystemEntry, out: Picked[], top: boolean): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, relativePath: top ? undefined : entry.fullPath.replace(/^\/+/, '') });
  } else if (entry.isDirectory) for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, out, false);
}
/** Files of a desktop drop, walking dropped folders. The entries are taken before the first await: the DataTransfer dies with the event. */
export async function filesFromDrop(dt: DataTransfer): Promise<Picked[]> {
  const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? null);
  const plain = [...dt.files];
  if (!entries.some(Boolean)) return plain.map((file) => ({ file }));
  const out: Picked[] = [];
  for (const e of entries) if (e) await walk(e, out, true).catch(() => {});
  return out;
}
