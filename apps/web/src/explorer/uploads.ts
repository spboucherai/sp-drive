// Upload manager. A module-level store: transfers keep running while the user moves between folders and screens, as
// long as the page stays open. Three files travel at once; each one is a resumable session on the server.
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError, del, get, patch, post } from '../api.ts';
import { AUTH_KEY } from '../session.ts';
import type { FileItem, UploadState } from '../types.ts';
import { transfer, wholeFileSha } from '../upload-engine.ts';
import { type Picked, XKEY } from './lib.ts';

export type Decision = 'version' | 'rename' | 'skip';
export type UpState = 'queued' | 'uploading' | 'paused' | 'finishing' | 'conflict' | 'done' | 'skipped' | 'error';
export interface UploadItem {
  key: number; batch: number; file: File; name: string; size: number; folderId: string; relativePath?: string;
  /** Set when the upload is a new version of a known file. */
  fileId?: string;
  /** Set when the file goes into a folder shared with this account (member routes; the bytes count on the owner's quota). */
  grantId?: string;
  uploadId?: string; sent: number; state: UpState; error?: unknown; speed: number;
  /** Bytes the server already held when an earlier session was continued (0 = started from scratch). */
  resumedFrom: number;
  result?: FileItem; created?: boolean; decided?: Decision;
}
/** A session started before a page reload. It continues when the user picks the same file again. */
export interface Pending { uploadId: string; name: string; size: number; lastModified: number; folderId: string; relativePath?: string }
export interface Snapshot { items: UploadItem[]; pending: Pending[]; batchSizes: Record<number, number> }

const PARALLEL = 3;
/** Owner uploads and uploads through a grant speak the same protocol on two route families. */
const base = (it: { grantId?: string }) => (it.grantId ? `/shared/${it.grantId}/uploads` : '/uploads');
const STORE = 'spd.uploads.pending';
const ACTIVE: UpState[] = ['queued', 'uploading', 'finishing', 'conflict'];

let items: UploadItem[] = [];
let seq = 0, batchSeq = 0, running = 0;
const ctrls = new Map<number, AbortController>();
const started = new Set<number>(); // keys with a run() in flight
const decisions = new Map<number, Decision>(); // batch → answer given with "apply to all"
const hashes = new WeakMap<File, Promise<string | undefined>>();
const listeners = new Set<() => void>();
let client: QueryClient | null = null;
let snapshot: Snapshot = { items, pending: [], batchSizes: {} };

const loadPending = (): Pending[] => { try { const v = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const savePending = (p: Pending[]) => { try { localStorage.setItem(STORE, JSON.stringify(p.slice(-500))); } catch { /* storage full or disabled: resuming after a reload is lost, nothing else */ } };
const dropPending = (uploadId?: string) => { if (uploadId) savePending(loadPending().filter((p) => p.uploadId !== uploadId)); };

const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
function emit(): void {
  const mine = new Set(items.map((i) => i.uploadId));
  const batchSizes: Record<number, number> = {};
  for (const i of items) batchSizes[i.batch] = (batchSizes[i.batch] ?? 0) + 1;
  snapshot = { items, pending: loadPending().filter((p) => !mine.has(p.uploadId)), batchSizes };
  if (items.some((i) => ACTIVE.includes(i.state))) window.addEventListener('beforeunload', warn); else window.removeEventListener('beforeunload', warn);
  listeners.forEach((f) => f());
}
const find = (key: number) => items.find((i) => i.key === key);
function set(key: number, p: Partial<UploadItem>): void { items = items.map((i) => (i.key === key ? { ...i, ...p } : i)); emit(); }

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function refresh(): void { // several files finishing together refresh the listing once
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { void client?.invalidateQueries({ queryKey: [XKEY] }); void client?.invalidateQueries({ queryKey: ['next'] }); void client?.invalidateQueries({ queryKey: AUTH_KEY }); }, 250);
}
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';
const refused = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

function pump(): void {
  for (const it of items) {
    if (running >= PARALLEL) return;
    if (it.state === 'queued' && !started.has(it.key)) void run(it.key);
  }
}
async function run(key: number): Promise<void> {
  running++; started.add(key);
  const ctrl = new AbortController();
  ctrls.set(key, ctrl);
  const signal = ctrl.signal;
  try {
    const it = find(key)!;
    set(key, { state: 'uploading', error: undefined, speed: 0 });
    let uploadId = it.uploadId, startAt = 0;
    if (!uploadId && !it.fileId && !it.grantId) { // the same file was being sent before a reload: continue that session
      const p = loadPending().find((x) => x.name === it.name && x.size === it.size && x.lastModified === it.file.lastModified && x.folderId === it.folderId && (x.relativePath ?? '') === (it.relativePath ?? '') && !items.some((o) => o.uploadId === x.uploadId));
      if (p) uploadId = p.uploadId;
    }
    if (uploadId) {
      try {
        const s = await get<UploadState>(`${base(it)}/${uploadId}`, { signal });
        if (s.status === 'done') { set(key, { uploadId, state: 'done', sent: it.size }); dropPending(uploadId); refresh(); return; }
        if (s.status !== 'active' || s.size !== it.size) throw new ApiError(410, 'upload_closed', 'closed');
        startAt = s.received;
        set(key, { uploadId, sent: startAt, resumedFrom: it.uploadId ? it.resumedFrom : startAt });
      } catch (e) {
        if (!refused(e)) throw e;
        dropPending(uploadId); uploadId = undefined; set(key, { uploadId: undefined, sent: 0, resumedFrom: 0 });
      }
    }
    if (!uploadId) {
      const s = it.grantId
        ? await post<UploadState>(base(it), { folderId: it.folderId || undefined, name: it.name, size: it.size, relativePath: it.relativePath, onConflict: 'rename' }, { signal })
        : await post<UploadState>('/uploads', { folderId: it.folderId, name: it.name, size: it.size, relativePath: it.relativePath, onConflict: 'fail', fileId: it.fileId }, { signal });
      uploadId = s.id;
      set(key, { uploadId });
      if (!it.fileId && !it.grantId) savePending([...loadPending(), { uploadId, name: it.name, size: it.size, lastModified: it.file.lastModified, folderId: it.folderId, relativePath: it.relativePath }]);
    }
    const t0 = performance.now(), from = startAt;
    await transfer({
      file: it.file, startAt, signal, chunkPath: (o) => `${base(it)}/${uploadId}?offset=${o}`, statusPath: `${base(it)}/${uploadId}`,
      onProgress: (sent) => { const dt = (performance.now() - t0) / 1000; set(key, { sent, speed: dt > 0.2 && sent > from ? (sent - from) / dt : 0 }); },
    });
    await finish(key);
  } catch (e) {
    if (isAbort(e)) return; // paused or cancelled: the state was set by whoever aborted
    if (refused(e)) dropPending(find(key)?.uploadId); // the server will not take this session any more
    if (find(key)) set(key, { state: 'error', error: e });
  } finally {
    ctrls.delete(key); started.delete(key); running--;
    pump();
  }
}
/** Ask the server to seal the file. A name collision stops here until the user (or the batch rule) decides. */
async function finish(key: number): Promise<void> {
  const it = find(key);
  if (!it?.uploadId) return;
  set(key, { state: 'finishing', sent: it.size });
  if (!hashes.has(it.file)) hashes.set(it.file, wholeFileSha(it.file));
  const sha256 = await hashes.get(it.file);
  try {
    const r = await post<UploadState & { file: FileItem; created?: boolean }>(`${base(it)}/${it.uploadId}/complete`, sha256 ? { sha256 } : {});
    dropPending(it.uploadId);
    if (find(key)) set(key, { state: 'done', result: r.file, created: r.created });
    refresh();
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'name_conflict' || it.fileId || it.grantId || it.decided) throw e;
    const rule = decisions.get(it.batch);
    if (rule) return decide(key, rule);
    set(key, { state: 'conflict' });
  }
}
async function decide(key: number, d: Decision): Promise<void> {
  const it = find(key);
  if (!it?.uploadId) return;
  try {
    if (d === 'skip') {
      await del(`${base(it)}/${it.uploadId}`).catch((e) => { if (!refused(e)) throw e; });
      dropPending(it.uploadId);
      set(key, { state: 'skipped', decided: d });
      return;
    }
    set(key, { state: 'finishing', decided: d });
    await patch(`/uploads/${it.uploadId}/options`, { onConflict: d });
    await finish(key);
  } catch (e) { if (find(key)) set(key, { state: 'error', error: e }); }
}

export const uploads = {
  /** Called once by the explorer so finished files refresh the listings. */
  bind(qc: QueryClient): void { client = qc; },
  enqueue(picked: Picked[], folderId: string, o: { fileId?: string; grantId?: string } = {}): void {
    if (!picked.length) return;
    const batch = ++batchSeq;
    items = [...items, ...picked.map((p): UploadItem => ({ key: ++seq, batch, file: p.file, name: p.file.name, size: p.file.size, folderId, relativePath: p.relativePath, fileId: o.fileId, grantId: o.grantId, sent: 0, state: 'queued', speed: 0, resumedFrom: 0 }))];
    emit(); pump();
  },
  pause(key: number): void {
    const it = find(key);
    if (!it || (it.state !== 'uploading' && it.state !== 'queued')) return;
    set(key, { state: 'paused', speed: 0 });
    ctrls.get(key)?.abort();
  },
  /** Resume a paused file or retry a failed one: the server is asked where it stopped. */
  resume(key: number): void {
    const it = find(key);
    if (!it || (it.state !== 'paused' && it.state !== 'error')) return;
    set(key, { state: 'queued', error: undefined, decided: undefined });
    pump();
  },
  cancel(key: number): void {
    const it = find(key);
    if (!it) return;
    ctrls.get(key)?.abort();
    items = items.filter((i) => i.key !== key);
    if (it.uploadId && it.state !== 'done' && it.state !== 'skipped') { dropPending(it.uploadId); void del(`${base(it)}/${it.uploadId}`).catch(() => {}); }
    emit(); pump();
  },
  /** Answer a name collision; `all` applies the same answer to every collision of the batch, present and to come. */
  resolve(key: number, d: Decision, all: boolean): void {
    const it = find(key);
    if (!it) return;
    if (all) decisions.set(it.batch, d);
    for (const x of all ? items.filter((i) => i.batch === it.batch && i.state === 'conflict') : [it]) void decide(x.key, d);
  },
  clearFinished(): void { items = items.filter((i) => i.state !== 'done' && i.state !== 'skipped'); emit(); },
  /** Give up an interrupted session from before a reload: its bytes are discarded on the server. */
  forget(uploadId: string): void { dropPending(uploadId); void del(`/uploads/${uploadId}`).catch(() => {}); emit(); },
  isActive: (i: UploadItem) => ACTIVE.includes(i.state),
};
snapshot = { items, pending: loadPending(), batchSizes: {} };

export function useUploads(): Snapshot {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => snapshot);
}
