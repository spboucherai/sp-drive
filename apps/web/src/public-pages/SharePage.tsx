// A share link, as seen by a visitor without an account. Opening the link counts one view on the server and sets a
// short-lived grant cookie; everything after that is re-checked by the server on each request.
import { formatBytes, type PreviewKind } from '@spd/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { Viewer } from '../preview/Viewer.tsx';
import type { PreviewSource } from '../types.ts';
import { Button, cx, IconButton, ProgressBar, Spinner } from '../ui.tsx';
import { Notice, PField, PublicShell } from './PublicShell.tsx';
import { store, tokenKey } from './util.ts';

interface PubFile { id: string; name: string; size: number; kind: PreviewKind; updatedAt: string; thumb: boolean }
interface PubFolder { id: string; name: string; updatedAt: string }
type Opened = { label: string; owner: string; canDownload: boolean; expiresAt: string | null } & ({ type: 'file'; file: PubFile } | { type: 'folder'; root: { id: string; name: string } });
interface FolderListing { folder: { id: string; name: string }; breadcrumbs: { id: string; name: string }[]; folders: PubFolder[]; files: PubFile[] }
type State = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'error'; tooMany?: boolean } | { kind: 'gate'; needsPassword: boolean; locked: boolean } | { kind: 'open'; share: Opened };
/** What a failed call means for the page: the link died, the grant expired, or something else. */
type Fate = 'unavailable' | 'locked' | 'other';
const fateOf = (e: unknown): Fate => (e instanceof ApiError && e.code === 'share_unavailable' ? 'unavailable' : e instanceof ApiError && e.code === 'share_locked' ? 'locked' : 'other');

const base = (token: string) => `/api/v1/public/shares/${token}`;
const sourceOf = (token: string, f: PubFile, canDownload: boolean): PreviewSource => ({
  id: f.id, name: f.name, size: f.size, kind: f.kind, canDownload,
  contentUrl: (o) => `${base(token)}/files/${f.id}/content${o?.download ? '?download=1' : o?.text ? '?as=text' : ''}`,
  previewUrl: (k) => `${base(token)}/files/${f.id}/preview/${k}`,
});
const KIND_ICON: Partial<Record<PreviewKind, string>> = { image: 'image', heic: 'image', svg: 'image', video: 'video', audio: 'audio', archive: 'archive', sheet: 'sheet', csv: 'sheet', text: 'text', markdown: 'text', json: 'text' };
/** Above this size a download is handed to the browser directly instead of being read in memory first. */
const BLOB_LIMIT = 300 * 1024 * 1024;

// One "open" per page load, even if React mounts the page twice (development) or the visitor double-submits.
const opening = new Map<string, Promise<Opened>>();
const openOnce = (token: string, password?: string): Promise<Opened> => {
  const k = `${token}|${password ?? ''}`;
  let p = opening.get(k);
  if (!p) { p = post<Opened>(`/public/shares/${token}/open`, password ? { password } : {}); opening.set(k, p); void p.catch(() => opening.delete(k)); }
  return p;
};

export function SharePage({ token }: { token: string }) {
  const t = useT();
  const key = tokenKey('spd.share', token);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [round, setRound] = useState(0);

  const enter = useCallback((share: Opened) => { store.set(key, share); setState({ kind: 'open', share }); }, [key]);
  /** A call failed in the middle of the visit: revoked or expired link → neutral state; grant expired → reopen. */
  const fail = useCallback((e: unknown): Fate => {
    const f = fateOf(e);
    if (f === 'unavailable') { store.del(key); setState({ kind: 'unavailable' }); }
    if (f === 'locked') { store.del(key); opening.clear(); setState((s) => ({ kind: 'gate', needsPassword: s.kind === 'gate' ? s.needsPassword : false, locked: true })); void get<{ needsPassword: boolean }>(`/public/shares/${token}`).then((r) => setState((s) => (s.kind === 'gate' ? { ...s, needsPassword: r.needsPassword } : s)), (x) => { if (fateOf(x) === 'unavailable') setState({ kind: 'unavailable' }); }); }
    return f;
  }, [key, token]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { needsPassword } = await get<{ needsPassword: boolean }>(`/public/shares/${token}`);
        // a reload of the tab while the grant is still valid does not count a second view
        const cached = store.get<Opened>(key);
        if (cached) {
          try {
            if (cached.type === 'folder') await get(`/public/shares/${token}/list`);
            else await probe(token, cached.file.id);
            if (live) setState({ kind: 'open', share: cached });
            return;
          } catch (e) { store.del(key); if (fateOf(e) === 'unavailable') throw e; }
        }
        if (needsPassword) { if (live) setState({ kind: 'gate', needsPassword: true, locked: false }); return; }
        const share = await openOnce(token);
        if (live) enter(share);
      } catch (e) {
        if (!live) return;
        setState(e instanceof ApiError && e.status === 404 ? { kind: 'unavailable' } : { kind: 'error', tooMany: e instanceof ApiError && e.status === 429 });
      }
    })();
    return () => { live = false; };
  }, [token, key, round, enter]);

  const share = state.kind === 'open' ? state.share : null;
  const title = share ? share.label || (share.type === 'file' ? share.file.name : share.root.name) : t('public.share.title');
  return (
    <PublicShell title={title} wide={share?.type === 'folder'}>
      {state.kind === 'loading' ? <div className="flex justify-center py-24 text-ink-3"><Spinner size={28} /></div>
        : state.kind === 'unavailable' ? <Notice icon="link" title={t('public.share.unavailable')} text={t('public.share.unavailableText')} />
          : state.kind === 'error' ? <Notice icon="warning" tone="warn" title={state.tooMany ? t('public.err.tooMany') : t('public.err.network')} action={<Button size="lg" icon="refresh" onClick={() => { setState({ kind: 'loading' }); setRound((n) => n + 1); }}>{t('public.retry')}</Button>} />
            : state.kind === 'gate' ? <Gate token={token} needsPassword={state.needsPassword} locked={state.locked} onOpen={enter} onGone={() => setState({ kind: 'unavailable' })} />
              : state.share.type === 'file' ? <FileShare token={token} share={state.share} file={state.share.file} fail={fail} />
                : <FolderShare token={token} share={state.share} rootId={state.share.root.id} fail={fail} />}
    </PublicShell>
  );
}

/** Is the file still reachable? One byte of content is asked for; nothing is counted. */
async function probe(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${base(token)}/files/${fileId}/content`, { headers: { Range: 'bytes=0-0' }, credentials: 'same-origin' }).catch(() => { throw new ApiError(0, 'network', ''); });
  if (res.ok) { void res.body?.cancel().catch(() => {}); return; }
  const body = await res.json().catch(() => null);
  if (body?.error === 'preview_unsupported') return; // alive, simply not displayable inline
  throw new ApiError(res.status, body?.error ?? 'http_error', body?.message ?? '');
}

function Gate({ token, needsPassword, locked, onOpen, onGone }: { token: string; needsPassword: boolean; locked: boolean; onOpen: (s: Opened) => void; onGone: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsPassword && !password) { setError(t('public.err.passwordRequired')); return; }
    setBusy(true); setError(null);
    try { onOpen(await openOnce(token, needsPassword ? password : undefined)); }
    catch (x) {
      setBusy(false);
      const c = x instanceof ApiError ? x : new ApiError(0, 'network', '');
      if (c.status === 404) onGone();
      else setError(c.code === 'password_invalid' ? t('public.err.passwordInvalid') : c.code === 'password_required' ? t('public.err.passwordRequired') : c.status === 429 ? t('public.err.tooMany') : c.status === 0 ? t('public.err.network') : t('public.err.generic'));
    }
  };
  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-sm rounded-2xl border border-line bg-surface px-6 py-8" data-testid="gate">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Glyph name={locked ? 'clock' : 'lock'} size={28} /></div>
      <h1 className="mt-4 text-center text-lg font-semibold">{locked ? t('public.share.locked') : t('public.share.protected')}</h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-ink-2">{locked ? t('public.share.lockedText') : t('public.share.protectedText')}</p>
      <div className="mt-5 space-y-4">
        {needsPassword ? <PField label={t('public.password')} type="password" autoComplete="off" autoFocus value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} error={error} /> : error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" busy={busy} className="w-full">{locked && !needsPassword ? t('public.share.reopen') : t('public.share.open')}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- downloads ----------------------------------------------------------------
type Dl = { id: string; pct: number | null } | null;
/**
 * Download through fetch so that a refusal (limit reached, link revoked, grant expired) is explained on the page instead
 * of the browser showing the server's raw answer. Very large files go to the browser's own download manager.
 */
function useDownload(fail: (e: unknown) => Fate) {
  const t = useT();
  const [active, setActive] = useState<Dl>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (id: string, url: string, name: string, size: number | null) => {
    if (active) return;
    setMessage(null);
    if (size === null || size > BLOB_LIMIT) { window.location.assign(url); return; }
    setActive({ id, pct: null });
    try {
      const res = await fetch(url, { credentials: 'same-origin' }).catch(() => { throw new ApiError(0, 'network', ''); });
      if (!res.ok) { const b = await res.json().catch(() => null); throw new ApiError(res.status, b?.error ?? 'http_error', b?.message ?? ''); }
      const total = Number(res.headers.get('content-length')) || size || 0;
      const parts: BlobPart[] = []; let got = 0;
      const reader = res.body?.getReader();
      if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.byteLength; if (total) setActive({ id, pct: Math.min(99, Math.floor((got / total) * 100)) }); }
      else parts.push(await res.blob());
      const blobUrl = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = blobUrl; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      if (fail(e) === 'other') {
        const c = e instanceof ApiError ? e : new ApiError(0, 'network', '');
        setMessage(c.code === 'download_limit' ? t('public.share.downloadLimit') : c.code === 'download_forbidden' ? t('public.share.downloadForbidden') : c.code === 'empty_selection' ? t('public.share.emptyZip')
          : c.status === 404 ? t('public.share.fileGone') : c.status === 429 ? t('public.err.tooMany') : c.status === 0 ? t('public.err.network') : t('public.err.generic'));
      }
    } finally { setActive(null); }
  };
  return { active, message, setMessage, run };
}
function Alert({ text, onClose }: { text: string | null; onClose: () => void }) {
  const t = useT();
  return text ? (
    <div role="alert" className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn" data-testid="share-alert">
      <Glyph name="warning" size={18} className="mt-px shrink-0" /><p className="min-w-0 flex-1">{text}</p>
      <button type="button" onClick={onClose} aria-label={t('public.share.dismiss')} className="-m-1 shrink-0 rounded p-1"><Glyph name="x" size={16} /></button>
    </div>
  ) : null;
}
function ShareHead({ share, name, icon, sub }: { share: Opened; name: string; icon: string; sub?: string }) {
  const t = useT();
  return (
    <header className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Glyph name={icon} size={24} /></div>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl leading-snug font-semibold break-words">{name}</h1>
        {share.label && share.label !== name ? <p className="mt-0.5 text-sm break-words text-ink-2">{share.label}</p> : null}
        <p className="mt-1 text-sm text-ink-3">{[sub, share.owner ? t('public.share.sharedBy', { owner: share.owner }) : '', share.expiresAt ? t('public.share.expires', { date: fmtDate(share.expiresAt) }) : ''].filter(Boolean).join(' · ')}</p>
        {share.canDownload ? null : <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-hover px-2.5 py-1 text-xs font-medium text-ink-2" title={t('public.share.viewOnlyText')}><Glyph name="eye" size={14} />{t('public.share.viewOnly')}</p>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- one file ----------------------------------------------------------------
function FileShare({ token, share, file, fail }: { token: string; share: Opened; file: PubFile; fail: (e: unknown) => Fate }) {
  const t = useT();
  const loc = getLocale();
  const [viewing, setViewing] = useState(false);
  const [checking, setChecking] = useState(false);
  const dl = useDownload(fail);
  const src = sourceOf(token, file, share.canDownload);
  const open = async () => {
    setChecking(true);
    try { await probe(token, file.id); setViewing(true); } catch (e) { if (fail(e) === 'other') dl.setMessage(e instanceof ApiError && e.status === 404 ? t('public.share.fileGone') : t('public.err.network')); } finally { setChecking(false); }
  };
  return (
    <div className="mx-auto max-w-xl space-y-4" data-testid="file-share">
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <ShareHead share={share} name={file.name} icon={KIND_ICON[file.kind] ?? 'file'} sub={formatBytes(file.size, loc)} />
        <button type="button" onClick={open} aria-label={`${t('public.share.preview')} — ${file.name}`}
          className="mt-5 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-bg">
          <Thumb src={file.thumb ? src.previewUrl('thumb') : undefined} name={file.name} kind={file.kind} className="h-full w-full rounded-none!" />
        </button>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button size="lg" variant={share.canDownload ? 'secondary' : 'primary'} icon="eye" className="sm:flex-1" busy={checking} onClick={open}>{t('public.share.preview')}</Button>
          {share.canDownload ? <Button size="lg" variant="primary" icon="download" className="sm:flex-1" busy={!!dl.active} onClick={() => void dl.run(file.id, src.contentUrl({ download: true }), file.name, file.size)}>{dl.active?.pct != null ? t('public.share.downloading', { pct: dl.active.pct }) : t('public.share.download')}</Button> : null}
        </div>
        {dl.active?.pct != null ? <div className="mt-3"><ProgressBar value={dl.active.pct / 100} label={t('public.share.downloadName', { name: file.name })} /></div> : null}
      </section>
      <Alert text={dl.message} onClose={() => dl.setMessage(null)} />
      {viewing ? <Viewer source={src} onClose={() => setViewing(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- a folder ----------------------------------------------------------------
const hashFolder = () => { const h = window.location.hash.slice(1); return /^[0-9a-f-]{36}$/i.test(h) ? h : null; };
function FolderShare({ token, share, rootId, fail }: { token: string; share: Opened; rootId: string; fail: (e: unknown) => Fate }) {
  const t = useT();
  const loc = getLocale();
  const [folderId, setFolderId] = useState<string | null>(hashFolder);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [grid, setGrid] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const dl = useDownload(fail);
  const failRef = useRef(fail); failRef.current = fail;
  const setMessage = dl.setMessage;

  useEffect(() => { const h = () => setFolderId(hashFolder()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const go = (id: string) => { window.location.hash = id === rootId ? '' : id; setFolderId(id === rootId ? null : id); };
  const load = useCallback(async (id: string | null, quiet = false): Promise<boolean> => {
    if (!quiet) setLoading(true);
    try { setListing(await get<FolderListing>(`/public/shares/${token}/list${id ? `?folder=${id}` : ''}`)); return true; }
    catch (e) {
      if (failRef.current(e) === 'other') {
        if (e instanceof ApiError && e.status === 404 && id) { setMessage(t('public.share.folderGone')); window.location.hash = ''; setFolderId(null); } // outside the share, or deleted since
        else setMessage(e instanceof ApiError && e.status === 429 ? t('public.err.tooMany') : t('public.err.network'));
      }
      return false;
    } finally { setLoading(false); }
  }, [token, setMessage, t]);
  useEffect(() => { setViewIndex(null); void load(folderId); }, [folderId, load]);

  const files = listing?.files ?? [], folders = listing?.folders ?? [];
  /** Re-ask the server before showing a file: a revoked link must not appear to work. */
  const openFile = async (i: number) => { if (await load(folderId, true)) setViewIndex(i); };
  const viewed = viewIndex !== null ? files[viewIndex] : undefined;
  const hasSub = folders.length > 0, sum = files.reduce((n, f) => n + f.size, 0);
  const zip = () => void dl.run('zip', `${base(token)}/zip${listing && listing.folder.id !== rootId ? `?folder=${listing.folder.id}` : ''}`, `${listing?.folder.name ?? 'dossier'}.zip`, hasSub ? null : sum);

  return (
    <div className="space-y-4" data-testid="folder-share">
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <ShareHead share={share} name={share.type === 'folder' ? share.root.name : ''} icon="folder" />
      </section>
      <Alert text={dl.message} onClose={() => dl.setMessage(null)} />
      <section className="rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <nav aria-label={t('public.share.breadcrumb')} className="min-w-0 flex-1">
            <ol className="flex flex-wrap items-center gap-0.5 text-sm" data-testid="crumbs">
              {(listing?.breadcrumbs ?? [{ id: rootId, name: share.type === 'folder' ? share.root.name : '' }]).map((c, i, all) => (
                <li key={c.id} className="flex min-w-0 items-center gap-0.5">
                  {i ? <Glyph name="chevronRight" size={14} className="shrink-0 text-ink-3" /> : null}
                  {i === all.length - 1 ? <span aria-current="page" className="truncate px-1.5 py-1.5 font-semibold">{c.name}</span>
                    : <button type="button" onClick={() => go(c.id)} className="max-w-40 truncate rounded-md px-1.5 py-1.5 text-ink-2 hover:bg-hover hover:text-ink">{c.name}</button>}
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton icon={grid ? 'list' : 'grid'} label={grid ? t('public.share.viewList') : t('public.share.viewGrid')} onClick={() => setGrid((g) => !g)} />
            {share.canDownload && (files.length || folders.length) ? <Button icon="download" busy={dl.active?.id === 'zip'} onClick={zip} data-testid="zip">{dl.active?.id === 'zip' && dl.active.pct != null ? t('public.share.downloading', { pct: dl.active.pct }) : t('public.share.downloadAll')}</Button> : null}
          </div>
        </div>
        {loading && !listing ? <div className="flex justify-center py-16 text-ink-3"><Spinner /></div>
          : !files.length && !folders.length ? <p className="px-6 py-16 text-center text-sm text-ink-3">{t('public.share.emptyFolder')}</p>
            : grid ? (
              <ul className={cx('grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-4', loading && 'opacity-60')} data-testid="entries">
                {folders.map((d) => (
                  <li key={d.id}><button type="button" onClick={() => go(d.id)} className="flex w-full flex-col overflow-hidden rounded-xl border border-line bg-bg text-left hover:border-line-strong" data-entry="folder">
                    <span className="flex aspect-[4/3] w-full items-center justify-center text-accent"><Thumb name={d.name} kind="folder" className="h-14 w-14" /></span>
                    <span className="truncate border-t border-line bg-surface px-3 py-2.5 text-sm font-medium">{d.name}</span>
                  </button></li>
                ))}
                {files.map((f, i) => (
                  <li key={f.id} className="relative overflow-hidden rounded-xl border border-line bg-bg hover:border-line-strong" data-entry="file">
                    <button type="button" onClick={() => void openFile(i)} aria-label={t('public.share.openItem', { name: f.name })} className="flex w-full flex-col text-left">
                      <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden text-ink-3"><Thumb src={f.thumb ? sourceOf(token, f, false).previewUrl('thumb') : undefined} name={f.name} kind={f.kind} className="h-full w-full rounded-none!" /></span>
                      <span className={cx('block w-full border-t border-line bg-surface py-2 pl-3', share.canDownload ? 'pr-11' : 'pr-3')}><span className="block truncate text-sm font-medium">{f.name}</span><span className="block text-xs text-ink-3">{formatBytes(f.size, loc)}</span></span>
                    </button>
                    {share.canDownload ? <IconButton icon="download" size={18} label={t('public.share.downloadName', { name: f.name })} disabled={!!dl.active} className="absolute right-0.5 bottom-1" onClick={() => void dl.run(f.id, sourceOf(token, f, true).contentUrl({ download: true }), f.name, f.size)} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className={cx('divide-y divide-line', loading && 'opacity-60')} data-testid="entries">
                {folders.map((d) => (
                  <li key={d.id}><button type="button" onClick={() => go(d.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover" data-entry="folder">
                    <Thumb name={d.name} kind="folder" className="h-10 w-10" /><span className="min-w-0 flex-1 truncate text-[15px] font-medium">{d.name}</span><Glyph name="chevronRight" size={18} className="shrink-0 text-ink-3" />
                  </button></li>
                ))}
                {files.map((f, i) => (
                  <li key={f.id} className="flex items-center hover:bg-hover" data-entry="file">
                    <button type="button" onClick={() => void openFile(i)} aria-label={t('public.share.openItem', { name: f.name })} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left">
                      <Thumb src={f.thumb ? sourceOf(token, f, false).previewUrl('thumb') : undefined} name={f.name} kind={f.kind} className="h-10 w-10" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{f.name}</span><span className="block text-xs text-ink-3">{formatBytes(f.size, loc)} · {t('public.share.modified', { date: fmtDate(f.updatedAt, { dateStyle: 'medium' }) })}</span></span>
                    </button>
                    {share.canDownload ? <IconButton icon="download" label={t('public.share.downloadName', { name: f.name })} disabled={!!dl.active} className="mx-1 h-11 w-11" onClick={() => void dl.run(f.id, sourceOf(token, f, true).contentUrl({ download: true }), f.name, f.size)} /> : <span className="w-3" />}
                  </li>
                ))}
              </ul>
            )}
        {listing && (files.length || folders.length) ? <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">{t('public.share.items', { n: files.length + folders.length })}</p> : null}
      </section>
      {viewed ? <Viewer source={sourceOf(token, viewed, share.canDownload)} onClose={() => setViewIndex(null)}
        onPrev={viewIndex! > 0 ? () => setViewIndex(viewIndex! - 1) : undefined} onNext={viewIndex! < files.length - 1 ? () => setViewIndex(viewIndex! + 1) : undefined} /> : null}
    </div>
  );
}
