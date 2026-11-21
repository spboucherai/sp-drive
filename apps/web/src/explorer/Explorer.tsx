/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/explorer/Explorer.tsx
 * Module           : explorer
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
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

// The file explorer: one component for the folder view and the recent, starred, trash, search and duplicates views.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, type KeyboardEvent, lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useSearch } from 'wouter';
import { ApiError, get, patch, post, qs } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, useT } from '../i18n.ts';
import { Viewer } from '../preview/Viewer.tsx';
import { RequestDialog } from '../sharing/RequestDialog.tsx';
import { ShareDialog } from '../sharing/ShareDialog.tsx';
import { ownerSource } from '../sources.ts';
import type { Crumb, FileDetail, FileItem, Folder, Item, Listing, Tag } from '../types.ts';
import { Button, ConfirmDialog, cx, Dialog, EmptyState, ErrorState, IconButton, Menu, type MenuItem, useToast } from '../ui.tsx';
import { clearContext, setContext } from '../next/context.ts';
import { Inspector } from '../next/Inspector.tsx';
import { useMeta } from '../next/meta.ts';
import { Snippet } from '../next/Snippet.tsx';
import type { FoundFile, SemanticHit } from '../next/types.ts';
import { fileKey } from './Details.tsx';
import { FolderPicker, NameDialog, TagsDialog, useTags } from './dialogs.tsx';
import { Duplicates } from './Duplicates.tsx';
import { ItemRow, ListHeader, type RowApi, Skeleton, type ViewMode } from './Items.tsx';
import { filesFromDrop, isTouchDevice, pickedFromInput, type Sel, toSel, triggerDownload, useMedia, usePref, XKEY, zipUrl } from './lib.ts';
import { useUploadPanelVisible } from './UploadPanel.tsx';
import { uploads } from './uploads.ts';

const TimeMachine = lazy(() => import('../next/TimeMachine.tsx').then((m) => ({ default: m.TimeMachine })));
const MembersDialog = lazy(() => import('../next/Members.tsx').then((m) => ({ default: m.MembersDialog })));
const SuggestDialog = lazy(() => import('../next/ai/Suggest.tsx').then((m) => ({ default: m.SuggestDialog })));

export type ExplorerView = 'folder' | 'recent' | 'starred' | 'trash' | 'search' | 'duplicates';
type SortKey = 'name' | 'updated' | 'size' | 'created';
type Dir = 'asc' | 'desc';
const SORTS: readonly SortKey[] = ['name', 'updated', 'size', 'created'];
const KINDS = ['any', 'folder', 'image', 'pdf', 'document', 'sheet', 'video', 'audio', 'archive', 'text'] as const;
const DRAG = 'application/x-spd-items';
const EMPTY = new Set<string>();
/** Items being dragged inside the page (a DataTransfer cannot be read while hovering). */
let dragSel: Sel | null = null;
const isInternalDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG);
const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files') && !isInternalDrag(e);

type Dlg =
  | { type: 'newFolder' } | { type: 'rename'; item: Item } | { type: 'move' | 'copy'; items: Item[] } | { type: 'tags'; file: FileItem } | { type: 'share'; item: Item }
  | { type: 'request'; folder: Folder } | { type: 'purge'; items: Item[] } | { type: 'emptyTrash' } | { type: 'infected'; file: FileItem }
  | { type: 'moveConflict'; sel: Sel; dest: Crumb; name: string } | { type: 'versions'; file: FileItem } | { type: 'members'; folder: Folder } | { type: 'suggest'; files: FileItem[] };
/** Depth of the folder shown last: going deeper slides the new place in from the right, going back from the left. */
let lastDepth = -1;
const PAGE = 240; // rows rendered at first, and added each time the end of the list comes into view
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
type VT = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

export function Explorer({ view, folderId }: { view: ExplorerView; folderId?: string }) {
  const qc = useQueryClient();
  useEffect(() => { uploads.bind(qc); }, [qc]);
  return (
    <Screen key={`${view}:${folderId ?? ''}`} view={view} folderId={folderId} />
  );
}

// --- breadcrumbs: every crumb is a link and a drop target; the middle collapses into a menu when space is short ---
function CrumbLink({ crumb, root, current, onDropTo }: { crumb: Crumb; root: boolean; current: boolean; onDropTo: (c: Crumb) => void }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const name = root ? t('explorer.root') : crumb.name;
  const can = () => !!dragSel && !current && !dragSel.folderIds.includes(crumb.id);
  return (
    <Link href={root ? '/' : `/folder/${crumb.id}`} aria-current={current ? 'page' : undefined} draggable={false}
      onDragOver={(e) => { if (!can()) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!can()) return; e.preventDefault(); e.stopPropagation(); setOver(false); onDropTo({ id: crumb.id, name }); }}
      className={cx('flex min-w-0 items-center gap-1.5 rounded-xl px-2 transition', current ? 'min-h-11 text-ink' : 'h-9 text-[15px] font-medium text-accent hover:bg-hover sm:h-8 sm:text-[13px] sm:text-ink-2 sm:hover:text-ink', over && 'drop-target')}>
      {root ? <Glyph name="home" size={18} className={cx('shrink-0', current && 'max-sm:hidden')} /> : null}
      <span className={cx('truncate', current ? 'text-[30px] leading-[1.15] group-data-[scrolled=true]/head:text-[20px] sm:text-[22px]' : 'max-w-40')}>{name}</span>
    </Link>
  );
}
function Crumbs({ crumbs, onDropTo }: { crumbs: Crumb[]; onDropTo: (c: Crumb) => void }) {
  const t = useT();
  const [, navigate] = useLocation();
  const narrow = useMedia('(max-width: 639px)');
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const tail = narrow ? 1 : 3;
  const collapse = crumbs.length > tail + 1;
  const hidden = collapse ? crumbs.slice(1, crumbs.length - tail) : [];
  const shown = collapse ? [crumbs[0]!, ...crumbs.slice(crumbs.length - tail)] : crumbs;
  return (
    <nav aria-label={t('explorer.breadcrumbs')} className="min-w-0">
      <ol className="-ml-2 flex min-w-0 flex-wrap items-center sm:flex-nowrap">
        {shown.map((c, i) => {
          const current = c === crumbs[crumbs.length - 1];
          return (
            <li key={c.id} className={cx('flex items-center', current ? 'min-w-0 max-sm:basis-full' : 'shrink-0')}>
              {i > 0 ? <Glyph name="chevronRight" size={14} className={cx('shrink-0 text-ink-3', current && !(i === 1 && hidden.length) && 'max-sm:hidden')} /> : null}
              {i === 1 && hidden.length ? (
                <>
                  <button type="button" aria-label={t('explorer.crumbsHidden', { n: hidden.length })} aria-haspopup="menu" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
                    className="flex h-10 w-9 items-center justify-center rounded-xl text-ink-2 hover:bg-hover hover:text-ink"><Glyph name="dots" size={18} strokeWidth={2.4} /></button>
                  <Glyph name="chevronRight" size={14} className={cx('shrink-0 text-ink-3', current && 'max-sm:hidden')} />
                </>
              ) : null}
              {current ? <h1 className="min-w-0"><CrumbLink crumb={c} root={c === crumbs[0]} current onDropTo={onDropTo} /></h1> : <CrumbLink crumb={c} root={c === crumbs[0]} current={false} onDropTo={onDropTo} />}
            </li>
          );
        })}
      </ol>
      {menu ? <Menu label={t('explorer.breadcrumbs')} anchor={{ x: menu.left, y: menu.bottom + 4 }} onClose={() => setMenu(null)} items={hidden.map((c) => ({ label: c.name, icon: 'folder', onSelect: () => navigate(`/folder/${c.id}`) }))} /> : null}
    </nav>
  );
}

const sectionCls = 'spd-eyebrow mb-2 px-1';
const selectCls = 'h-11 sm:h-9 w-full min-w-0 rounded-[10px] border border-line-strong bg-surface px-2.5 text-base sm:text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15';
function Filters({ params, tags, open, content, onChange }: { params: URLSearchParams; tags: Tag[]; open: boolean; content: boolean; onChange: (patch: Record<string, string | undefined>) => void }) {
  const t = useT();
  const [q, setQ] = useState(params.get('q') ?? '');
  const urlQ = params.get('q') ?? '';
  const typed = useRef(urlQ);
  useEffect(() => { if (urlQ !== typed.current) { typed.current = urlQ; setQ(urlQ); } }, [urlQ]); // the query changed from outside (top bar)
  useEffect(() => {
    if (q.trim() === typed.current) return;
    const id = setTimeout(() => { typed.current = q.trim(); onChange({ q: q.trim() || undefined }); }, 250);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const starred = params.get('starred') === '1';
  const field = (label: string, node: ReactNode, cls = '') => <label className={cx('flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-3', cls)}>{label}{node}</label>;
  return (
    <form role="search" aria-label={t('explorer.filters.label')} onSubmit={(e) => e.preventDefault()} className={cx('mt-2 grid-cols-2 items-end gap-2 sm:grid', content ? 'sm:grid-cols-[minmax(10rem,2fr)_1fr_1fr_1fr_1fr_1fr_auto]' : 'sm:grid-cols-[minmax(10rem,2fr)_1fr_1fr_1fr_1fr_auto]', open ? 'grid' : 'hidden')}>
      {field(t('explorer.filters.q'), <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('explorer.filters.qPlaceholder')} maxLength={200} className={selectCls} />, 'col-span-2 sm:col-span-1')}
      {content ? field(t('next.search.in'), <select value={params.get('in') ?? 'all'} onChange={(e) => onChange({ in: e.target.value === 'all' ? undefined : e.target.value })} className={selectCls} data-testid="search-in">{['all', 'name', 'content'].map((k) => <option key={k} value={k}>{t(`next.search.in.${k}`)}</option>)}</select>) : null}
      {field(t('explorer.filters.kind'), <select value={params.get('kind') ?? 'any'} onChange={(e) => onChange({ kind: e.target.value === 'any' ? undefined : e.target.value })} className={selectCls}>{KINDS.map((k) => <option key={k} value={k}>{t(`explorer.filters.kind.${k}`)}</option>)}</select>)}
      {field(t('explorer.filters.tag'), <select value={params.get('tag') ?? ''} onChange={(e) => onChange({ tag: e.target.value || undefined })} className={selectCls}><option value="">{t('explorer.filters.anyTag')}</option>{tags.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>)}
      {field(t('explorer.filters.from'), <input type="date" value={params.get('from') ?? ''} max={params.get('to') ?? undefined} onChange={(e) => onChange({ from: e.target.value || undefined })} className={selectCls} />)}
      {field(t('explorer.filters.to'), <input type="date" value={params.get('to') ?? ''} min={params.get('from') ?? undefined} onChange={(e) => onChange({ to: e.target.value || undefined })} className={selectCls} />)}
      <button type="button" aria-pressed={starred} onClick={() => onChange({ starred: starred ? undefined : '1' })}
        className={cx('press col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border px-3 text-[13px] font-medium sm:col-span-1 sm:h-9', starred ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover')}>
        <Glyph name="star" size={16} fill={starred ? 'currentColor' : 'none'} />{t('explorer.filters.starred')}
      </button>
    </form>
  );
}

function Screen({ view, folderId }: { view: ExplorerView; folderId?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const meta = useMeta();
  const has = (f: string) => (meta.features as string[]).includes(f);
  const semantic = view === 'search' && params.get('mode') === 'semantic' && has('semantic');
  const wide = useMedia('(min-width: 1024px)');
  const touch = useMemo(isTouchDevice, []);
  const panelUp = useUploadPanelVisible();

  // --- preferences, sort ---
  const [mode, setMode] = usePref<ViewMode>('spd.explorer.view', window.matchMedia('(max-width: 639px)').matches ? 'list' : 'grid', ['grid', 'list']);
  const [prefSort, setPrefSort] = usePref<SortKey>('spd.explorer.sort', 'name', SORTS);
  const [prefDir, setPrefDir] = usePref<Dir>('spd.explorer.dir', 'asc', ['asc', 'desc']);
  const sortable = view === 'folder' || view === 'search';
  const urlSort = params.get('sort') as SortKey | null, urlDir = params.get('dir');
  const sort: SortKey = view === 'search' ? (urlSort && SORTS.includes(urlSort) ? urlSort : 'name') : prefSort;
  const dir: Dir = view === 'search' ? (urlDir === 'desc' ? 'desc' : 'asc') : prefDir;
  const setSearch = useCallback((p: Record<string, string | undefined>) => {
    const cur = Object.fromEntries(new URLSearchParams(window.location.search));
    navigate(`/search${qs({ ...cur, ...p })}`, { replace: true });
  }, [navigate]);
  const applySort = (s: SortKey, d: Dir) => { if (view === 'search') setSearch({ sort: s === 'name' ? undefined : s, dir: d === 'asc' ? undefined : d }); else { setPrefSort(s); setPrefDir(d); } };

  // --- data ---
  const path = view === 'folder' ? `/folders/${folderId ?? 'root'}${qs({ sort, dir })}`
    : view === 'search' ? `/search${qs({ q: params.get('q'), kind: params.get('kind'), tag: params.get('tag'), starred: params.get('starred') === '1' ? 1 : undefined, from: params.get('from'), to: params.get('to'), in: params.get('in'), sort, dir })}`
    : `/${view}`;
  const listing = useQuery({
    queryKey: [XKEY, 'listing', path], queryFn: () => get<Listing>(path), enabled: view !== 'duplicates' && !semantic, placeholderData: (prev) => prev,
    // a file just uploaded gets its antivirus verdict and its thumbnail a moment later
    refetchInterval: (q) => (q.state.data?.files.some((f) => (f.scan === 'pending' || (!f.thumb && ['image', 'heic', 'pdf'].includes(f.kind))) && Date.now() - new Date(f.updatedAt).getTime() < 90_000) ? 4000 : false),
  });
  const tagsQ = useTags();
  const tags = useMemo(() => new Map((tagsQ.data ?? []).map((g) => [g.id, g])), [tagsQ.data]);
  const data = listing.data;
  const folder = view === 'folder' ? data?.folder : undefined;
  const crumbs = data?.breadcrumbs;
  const items = useMemo<Item[]>(() => (data ? [...data.folders, ...data.files] : []), [data]);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: [XKEY] }), [qc]);

  // --- state ---
  const [selected, setSelected] = useState<Set<string>>(EMPTY);
  const [focusId, setFocusId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const wantFocus = useRef(false); // the keyboard focus belongs to the listing: give it back when a row moves or disappears
  const [menu, setMenu] = useState<{ items: MenuItem[]; anchor: { x: number; y: number } | DOMRect; label: string; rowId?: string } | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<FileItem | null>(null);
  const [viewerPage, setViewerPage] = useState<number | undefined>(undefined);
  const [viewerSide, setViewerSide] = useState<'details' | 'ask' | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const pendingFocus = useRef<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const [scrolled, setScrolled] = useState(false); // the large title folds once the listing has moved
  const grid = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), dirInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);

  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const byId = (id: string | null | undefined) => (id ? items.find((i) => i.id === id) : undefined);
  const tabId = focusId && items.some((i) => i.id === focusId) ? focusId : items[0]?.id ?? null;
  const focusRow = (id: string | null | undefined) => { if (id) grid.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(); };
  const fail = (e: unknown) => toast(errorText(e), { tone: 'error' });
  const detailsItem = byId(detailsId);
  useEffect(() => {
    if (wantFocus.current && !dlg && !menu && !viewer && tabId && document.activeElement === document.body) grid.current?.querySelector<HTMLElement>(`[data-id="${tabId}"]`)?.focus({ preventScroll: true });
  });
  useEffect(() => { if (detailsId && chosen.length === 1 && chosen[0]!.id !== detailsId) setDetailsId(chosen[0]!.id); }, [chosen, detailsId]); // the panel follows the selection

  // --- deep link: /folder/<id>?file=<fileId> opens that file's preview ---
  const fileParam = view === 'folder' ? params.get('file') : null;
  const linked = useQuery({ queryKey: fileKey(fileParam ?? ''), queryFn: () => get<FileDetail>(`/files/${fileParam}`), enabled: !!fileParam });
  useEffect(() => {
    if (!fileParam) return;
    if (linked.data) { if (linked.data.file.scan === 'infected') toast(t('common.error.infected'), { tone: 'error' }); else { const pg = Number(params.get('page')); setViewerPage(pg > 1 ? pg : undefined); setViewer(linked.data.file); } }
    else if (linked.error) { fail(linked.error); navigate(location, { replace: true }); }
  }, [fileParam, linked.data, linked.error]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The thumbnail of a row, when it is on screen: the file card and the preview are one element for the eye. */
  const thumbOf = (id: string) => grid.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-testid=thumb]`) ?? null;
  const morph = (el: HTMLElement | null, change: () => void, opening: boolean) => {
    const doc = document as VT;
    if (!el || !doc.startViewTransition || reducedMotion()) { change(); return; }
    if (opening) el.style.viewTransitionName = 'spd-morph';
    const vt = doc.startViewTransition(() => { flushSync(change); el.style.viewTransitionName = opening ? '' : 'spd-morph'; });
    void vt.finished.finally(() => { el.style.viewTransitionName = ''; });
  };
  const closeViewer = () => {
    const id = viewer?.id;
    morph(id ? thumbOf(id) : null, () => { setViewer(null); setViewerSide(null); setViewerPage(undefined); }, false);
    if (fileParam) navigate(location, { replace: true });
  };

  // --- actions ---
  const openItem = (it: Item) => {
    if (it.type === 'folder') { if (view === 'trash') toast(t('explorer.trash.restoreFirst')); else navigate(`/folder/${it.id}`); return; }
    if (it.scan === 'infected') { toast(t('common.error.infected'), { tone: 'error' }); return; }
    const page = (it as FoundFile).match?.page ?? undefined;
    morph(thumbOf(it.id), () => { setViewerPage(page && page > 1 ? page : undefined); setViewer(it); }, true);
  };
  const downloadItems = (list: Item[]) => {
    const one = list.length === 1 ? list[0]! : null;
    if (one?.type === 'file') { if (one.scan === 'infected') setDlg({ type: 'infected', file: one }); else triggerDownload(ownerSource(one).contentUrl({ download: true })); return; }
    const sel = toSel(list.filter((i) => i.type === 'folder' || i.scan !== 'infected'));
    if (!sel.fileIds.length && !sel.folderIds.length) { toast(t('common.error.empty_selection'), { tone: 'error' }); return; }
    if (sel.fileIds.length + sel.folderIds.length < list.length) toast(t('explorer.zipSkipsInfected'));
    triggerDownload(zipUrl(sel));
  };
  const star = async (list: Item[], on: boolean) => {
    try { await Promise.all(list.map((i) => patch(`/${i.type === 'file' ? 'files' : 'folders'}/${i.id}`, { starred: on }))); toast(on ? t('explorer.starredDone', { n: list.length }) : t('explorer.unstarredDone', { n: list.length }), { tone: 'ok' }); } catch (e) { fail(e); }
    await refresh();
  };
  const restore = async (sel: Sel, quiet = false) => {
    try { await post('/restore', sel); if (!quiet) toast(t('explorer.restored', { n: sel.fileIds.length + sel.folderIds.length }), { tone: 'ok' }); setSelected(EMPTY); } catch (e) { fail(e); }
    await refresh();
  };
  const trash = async (list: Item[]) => {
    if (!list.length) return;
    const sel = toSel(list);
    try {
      await post('/trash', sel);
      setSelected(EMPTY);
      if (detailsId && list.some((i) => i.id === detailsId)) setDetailsId(null);
      toast(list.length === 1 ? t('explorer.trashedOne', { name: list[0]!.name }) : t('explorer.trashedN', { n: list.length }), { ms: 8000, action: { label: t('common.cancel'), run: () => void restore(sel, true) } });
    } catch (e) { fail(e); }
    await refresh();
  };
  const moveTo = async (sel: Sel, dest: Crumb, onConflict: 'fail' | 'rename' = 'fail') => {
    await post('/move', { ...sel, destinationId: dest.id, onConflict });
    setSelected(EMPTY);
    await refresh();
    toast(t('explorer.moved', { n: sel.fileIds.length + sel.folderIds.length, name: dest.name }), { tone: 'ok' });
  };
  const dropMove = (dest: Crumb) => {
    const sel = dragSel;
    dragSel = null;
    if (!sel) return;
    moveTo(sel, dest).catch((e) => { if (e instanceof ApiError && e.code === 'name_conflict') setDlg({ type: 'moveConflict', sel, dest, name: String(e.data.name ?? '') }); else fail(e); });
  };
  const upload = (list: FileList | null) => { if (folder && list?.length) uploads.enqueue(pickedFromInput(list), folder.id); };
  const single = (list: Item[]) => (list.length === 1 ? list[0]! : null);

  // --- what this screen offers to the command palette and the transfer centre ---
  useEffect(() => {
    const canAct = view !== 'trash';
    setContext({
      folder: folder ? { id: folder.id, name: folder.parentId ? folder.name : t('explorer.root') } : null, selection: chosen,
      newFolder: folder ? () => setDlg({ type: 'newFolder' }) : undefined, upload: folder ? () => fileInput.current?.click() : undefined,
      moveSelection: canAct && chosen.length ? () => setDlg({ type: 'move', items: chosen }) : undefined,
      shareSelection: canAct && chosen.length === 1 && !(chosen[0]!.type === 'file' && chosen[0]!.scan === 'infected') ? () => setDlg({ type: 'share', item: chosen[0]! }) : undefined,
    });
  }, [folder, chosen, view, t]);
  useEffect(() => clearContext, []);
  // rows beyond the first page are rendered when the end of the list comes into view
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  });
  useEffect(() => { const id = pendingFocus.current; if (id && grid.current?.querySelector(`[data-id="${id}"]`)) { pendingFocus.current = null; focusRow(id); grid.current.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); } });
  // direction of the navigation, decided once when the place is known
  const navDir = useRef<'deeper' | 'back' | 'same' | null>(null);
  if (!navDir.current && (data || view !== 'folder')) {
    const depth = view === 'folder' ? crumbs?.length ?? 1 : 0;
    navDir.current = view !== 'folder' || lastDepth < 0 ? 'same' : depth > lastDepth ? 'deeper' : depth < lastDepth ? 'back' : 'same';
    lastDepth = view === 'folder' ? depth : lastDepth;
  }

  const menuFor = (list: Item[]): MenuItem[] => {
    const one = single(list);
    const infected = one?.type === 'file' && one.scan === 'infected';
    const out: MenuItem[] = [];
    const add = (cond: unknown, m: MenuItem) => { if (cond) out.push(m); };
    if (view === 'trash') {
      add(true, { label: t('explorer.a.restore'), icon: 'restore', onSelect: () => void restore(toSel(list)) });
      add(one?.type === 'file' && !infected, { label: t('common.open'), icon: 'eye', onSelect: () => openItem(one!) });
      add(one?.type === 'file', { label: t('common.download'), icon: 'download', onSelect: () => downloadItems(list) });
      add(one, { label: t('explorer.a.details'), icon: 'info', onSelect: () => setDetailsId(one!.id) });
      add(true, { label: t('explorer.a.purge'), icon: 'trash', danger: true, separatorBefore: true, onSelect: () => setDlg({ type: 'purge', items: list }) });
      return out;
    }
    const allStarred = list.every((i) => i.starred);
    add(one && !infected, { label: t('common.open'), icon: one?.type === 'folder' ? 'folder' : 'eye', onSelect: () => openItem(one!), shortcut: '↵' });
    add(one && view !== 'folder', { label: t('explorer.a.reveal'), icon: 'external', onSelect: () => { const id = one!.type === 'file' ? one!.folderId : one!.parentId; navigate(id ? `/folder/${id}` : '/'); } });
    add(true, { label: list.length > 1 || one?.type === 'folder' ? t('explorer.a.downloadZip') : t('common.download'), icon: 'download', onSelect: () => downloadItems(list) });
    add(one && !infected, { label: t('explorer.a.share'), icon: 'share', onSelect: () => setDlg({ type: 'share', item: one! }) });
    add(one?.type === 'folder' && has('collab') && !!(one as Folder).parentId, { label: t('next.mem.menu'), icon: 'users', onSelect: () => setDlg({ type: 'members', folder: one as Folder }) });
    add(one?.type === 'folder', { label: t('explorer.a.request'), icon: 'inbox', onSelect: () => setDlg({ type: 'request', folder: one as Folder }) });
    add(one, { label: t('explorer.a.rename'), icon: 'pencil', separatorBefore: true, onSelect: () => setDlg({ type: 'rename', item: one! }), shortcut: 'F2' });
    add(true, { label: t('explorer.a.move'), icon: 'move', separatorBefore: !one, onSelect: () => setDlg({ type: 'move', items: list }) });
    add(true, { label: t('explorer.a.copy'), icon: 'copy', onSelect: () => setDlg({ type: 'copy', items: list }) });
    add(true, { label: allStarred ? t('explorer.a.unstar') : t('explorer.a.star'), icon: 'star', onSelect: () => void star(list, !allStarred) });
    add(one?.type === 'file', { label: t('explorer.a.tags'), icon: 'tag', onSelect: () => setDlg({ type: 'tags', file: one as FileItem }) });
    add(one?.type === 'file' && !infected, { label: t('next.tm.menu'), icon: 'history', onSelect: () => setDlg({ type: 'versions', file: one as FileItem }) });
    add(has('ai') && list.length <= 20 && list.every((i) => i.type === 'file'), { label: t('next.sug.menu'), icon: 'wand', onSelect: () => setDlg({ type: 'suggest', files: list as FileItem[] }) });
    add(one, { label: t('explorer.a.details'), icon: 'info', onSelect: () => setDetailsId(one!.id) });
    add(true, { label: t('explorer.a.trash'), icon: 'trash', danger: true, separatorBefore: true, onSelect: () => void trash(list), shortcut: '⌫' });
    return out;
  };
  const openMenu = (list: Item[], at: { x: number; y: number } | DOMRect, rowId?: string) => {
    if (list.length) setMenu({ items: menuFor(list), anchor: at, rowId, label: list.length === 1 ? t('explorer.actionsFor', { name: list[0]!.name }) : t('explorer.actionsForN', { n: list.length }) });
  };
  const closeMenu = useCallback(() => setMenu((m) => { if (m?.rowId) focusRow(m.rowId); return null; }), []);

  // --- rows talk to the latest state through one stable object ---
  const live = useRef({ items, selected, chosen, openItem, openMenu, dropMove });
  live.current = { items, selected, chosen, openItem, openMenu, dropMove };
  const api = useMemo<RowApi>(() => {
    const item = (id: string) => live.current.items.find((i) => i.id === id);
    const range = (a: string, b: string) => { const ids = live.current.items.map((i) => i.id); const [x, y] = [ids.indexOf(a), ids.indexOf(b)].sort((m, n) => m - n); return x! < 0 ? [b] : ids.slice(x, y! + 1); };
    const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    return {
      click(e, id, viaTouch) {
        const it = item(id);
        if (!it) return;
        e.stopPropagation();
        if (viaTouch) { if (live.current.selected.size) toggle(id); else live.current.openItem(it); return; }
        if (e.shiftKey && anchor.current) setSelected(new Set(range(anchor.current, id)));
        else if (e.metaKey || e.ctrlKey) { toggle(id); anchor.current = id; } else { setSelected(new Set([id])); anchor.current = id; }
        setFocusId(id);
      },
      open(id) { const it = item(id); if (it) live.current.openItem(it); },
      menu(id, at) {
        const it = item(id);
        if (!it) return;
        const inSel = live.current.selected.has(id);
        if (!inSel) { setSelected(new Set([id])); anchor.current = id; }
        live.current.openMenu(inSel ? live.current.chosen : [it], at, id);
      },
      longPress(id) { toggle(id); anchor.current = id; },
      focus(id) { wantFocus.current = true; setFocusId(id); },
      dragStart(e, id) {
        const it = item(id);
        if (!it) return;
        const list = live.current.selected.has(id) ? live.current.chosen : [it];
        if (!live.current.selected.has(id)) { setSelected(new Set([id])); anchor.current = id; }
        dragSel = toSel(list);
        e.dataTransfer.setData(DRAG, String(list.length));
        e.dataTransfer.effectAllowed = 'move';
      },
      dragEnd() { dragSel = null; },
      canDrop: (id) => !!dragSel && !dragSel.folderIds.includes(id),
      drop(id) { const it = item(id); if (it) live.current.dropMove({ id, name: it.name }); },
    };
  }, []);

  // --- keyboard: roving focus, selection, shortcuts ---
  const vertical = (el: HTMLElement, step: 1 | -1): HTMLElement | null => {
    const rows = [...(grid.current?.querySelectorAll<HTMLElement>('[role=row][data-id]') ?? [])];
    const r = el.getBoundingClientRect(), mid = r.left + r.width / 2;
    let best: HTMLElement | null = null, bestD = Infinity, rowTop: number | null = null;
    for (let j = rows.indexOf(el) + step; j >= 0 && j < rows.length; j += step) {
      const b = rows[j]!.getBoundingClientRect();
      if (step > 0 ? b.top < r.bottom - 1 : b.bottom > r.top + 1) continue; // still on the same visual line
      if (rowTop === null) rowTop = b.top; else if (Math.abs(b.top - rowTop) > 1) break;
      const d = Math.abs(b.left + b.width / 2 - mid);
      if (d < bestD) { bestD = d; best = rows[j]!; }
    }
    return best;
  };
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.getAttribute('role') !== 'row' || !el.dataset.id) return; // keys typed on a row itself, not in one of its buttons
    const id = el.dataset.id, ids = items.map((i) => i.id), i = ids.indexOf(id), mod = e.metaKey || e.ctrlKey;
    const targets = chosen.length ? chosen : items.filter((x) => x.id === id);
    const go = (to: string | undefined) => {
      if (!to) return;
      e.preventDefault();
      if (e.shiftKey) { const a = anchor.current ?? id; anchor.current = a; const [x, y] = [ids.indexOf(a), ids.indexOf(to)].sort((m, n) => m - n); setSelected(new Set(ids.slice(Math.max(0, x!), y! + 1))); }
      if (!grid.current?.querySelector(`[data-id="${to}"]`)) { pendingFocus.current = to; setLimit(items.length); return; } // beyond what is rendered so far
      focusRow(to);
      grid.current?.querySelector<HTMLElement>(`[data-id="${to}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') go(mode === 'list' ? ids[i + 1] : vertical(el, 1)?.dataset.id);
    else if (e.key === 'ArrowUp') go(mode === 'list' ? ids[i - 1] : vertical(el, -1)?.dataset.id);
    else if (e.key === 'ArrowRight' && mode === 'grid') go(ids[i + 1]);
    else if (e.key === 'ArrowLeft' && mode === 'grid') go(ids[i - 1]);
    else if (e.key === 'Home') go(ids[0]);
    else if (e.key === 'End') go(ids[ids.length - 1]);
    else if (e.key === ' ') { e.preventDefault(); anchor.current = id; setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = byId(id); if (it) openItem(it); }
    else if (e.key === 'a' && mod) { e.preventDefault(); setSelected(new Set(ids)); }
    else if (e.key === 'Escape') { if (selected.size) { e.preventDefault(); setSelected(EMPTY); } }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (view === 'trash') setDlg({ type: 'purge', items: targets }); else void trash(targets); }
    else if (e.key === 'F2' && view !== 'trash') { e.preventDefault(); if (targets.length === 1) setDlg({ type: 'rename', item: targets[0]! }); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); api.menu(id, el.getBoundingClientRect()); }
  };

  // --- drop from the desktop ---
  const drag = {
    onDragEnter: (e: DragEvent) => { if (!isFileDrag(e)) return; dragDepth.current++; if (folder) setDropping(true); },
    onDragOver: (e: DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = folder ? 'copy' : 'none'; },
    onDragLeave: (e: DragEvent) => { if (!isFileDrag(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault(); dragDepth.current = 0; setDropping(false);
      if (!folder) return;
      const target = folder.id;
      void filesFromDrop(e.dataTransfer).then((picked) => { if (picked.length) uploads.enqueue(picked, target); else toast(t('explorer.dropNothing'), { tone: 'error' }); });
    },
  };

  // --- header pieces ---
  const title = view === 'folder' ? (folder && !folder.parentId ? t('explorer.root') : folder?.name ?? '') : t(`explorer.view.${view}`);
  useEffect(() => { if (title) document.title = `${title} · ${t('common.appName')}`; }, [title, t]);
  const [filtersOpen, setFiltersOpen] = useState(false); // phones: the filters fold away, the top bar already holds the query
  const nFilters = ['kind', 'tag', 'from', 'to', 'starred'].filter((k) => params.get(k)).length;
  const [toolMenu, setToolMenu] = useState<{ kind: 'new' | 'sort'; rect: DOMRect } | null>(null);
  const newItems: MenuItem[] = [
    { label: t('explorer.newFolder'), icon: 'folderPlus', onSelect: () => setDlg({ type: 'newFolder' }) },
    { label: t('explorer.uploadFiles'), icon: 'upload', separatorBefore: true, onSelect: () => fileInput.current?.click() },
    { label: t('explorer.uploadFolder'), icon: 'folder', onSelect: () => dirInput.current?.click() },
    ...(touch ? [{ label: t('explorer.takePhoto'), icon: 'camera', onSelect: () => cameraInput.current?.click() }] : []),
  ];
  const sortItems: MenuItem[] = [
    ...SORTS.map((s) => ({ label: t(`explorer.sort.${s}`), icon: s === sort ? 'check' : 'blank', onSelect: () => applySort(s, dir) })),
    { label: t('explorer.sort.asc'), icon: dir === 'asc' ? 'check' : 'blank', separatorBefore: true, onSelect: () => applySort(sort, 'asc') },
    { label: t('explorer.sort.desc'), icon: dir === 'desc' ? 'check' : 'blank', onSelect: () => applySort(sort, 'desc') },
  ];
  const allStarred = chosen.length > 0 && chosen.every((i) => i.starred);
  const toolbar = chosen.length ? (
    <div role="toolbar" aria-label={t('explorer.selection.label')} className="anim-pop flex w-full items-center gap-0.5 rounded-full bg-selection pr-1 max-sm:[&>button]:w-9 sm:w-auto sm:[&>button]:h-9 sm:[&>button]:w-9" data-testid="selection-bar">
      <IconButton icon="x" label={t('explorer.selection.clear')} onClick={() => setSelected(EMPTY)} />
      <span className="mr-auto min-w-0 truncate px-1 text-[15px] font-semibold whitespace-nowrap text-ink tabular-nums sm:mr-2 sm:text-sm" aria-live="polite">{t('explorer.selection.n', { n: chosen.length })}</span>
      {view === 'trash' ? (
        <>
          <IconButton icon="restore" label={t('explorer.a.restore')} onClick={() => void restore(toSel(chosen))} />
          <IconButton icon="trash" label={t('explorer.a.purge')} className="text-danger" onClick={() => setDlg({ type: 'purge', items: chosen })} />
        </>
      ) : (
        <>
          <IconButton icon="download" label={chosen.length > 1 || chosen[0]!.type === 'folder' ? t('explorer.a.downloadZip') : t('common.download')} onClick={() => downloadItems(chosen)} />
          <IconButton icon="move" label={t('explorer.a.move')} onClick={() => setDlg({ type: 'move', items: chosen })} />
          <IconButton icon="star" label={allStarred ? t('explorer.a.unstar') : t('explorer.a.star')} onClick={() => void star(chosen, !allStarred)} />
          <IconButton icon="trash" label={t('explorer.a.trash')} onClick={() => void trash(chosen)} />
        </>
      )}
      <IconButton icon="dots" label={t('common.more')} aria-haspopup="menu" onClick={(e) => openMenu(chosen, e.currentTarget.getBoundingClientRect())} />
    </div>
  ) : (
    <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:flex-nowrap">
      {view === 'folder' ? <Button variant="primary" icon="plus" className="order-last ml-1 max-sm:rounded-full" disabled={!folder} aria-haspopup="menu" onClick={(e) => setToolMenu({ kind: 'new', rect: e.currentTarget.getBoundingClientRect() })}>{t('explorer.new')}</Button> : null}
      {view === 'trash' ? <Button icon="trash" className="sm:order-last sm:ml-1" disabled={!items.length} onClick={() => setDlg({ type: 'emptyTrash' })}>{t('explorer.trash.empty')}</Button> : null}
      {view === 'search' ? <Button icon="filter" className="sm:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>{nFilters ? t('explorer.filters.toggleN', { n: nFilters }) : t('explorer.filters.toggle')}</Button> : null}
      {view === 'search' && has('semantic') ? (
        <div role="group" aria-label={t('next.search.mode')} className="flex h-10 shrink-0 items-center rounded-[10px] bg-well p-0.5 whitespace-nowrap sm:h-9" data-testid="search-mode">
          {(['words', 'semantic'] as const).map((k) => <button key={k} type="button" aria-pressed={(k === 'semantic') === semantic} onClick={() => setSearch({ mode: k === 'semantic' ? 'semantic' : undefined })} className={cx('h-full rounded-lg px-2.5 text-[13px] transition-colors', (k === 'semantic') === semantic ? 'bg-surface font-medium text-ink shadow-(--shadow-card)' : 'text-ink-2 hover:text-ink')}>{t(`next.search.mode.${k}`)}</button>)}
        </div>
      ) : null}
      <span className="flex-1" />
      {sortable && !semantic ? (
        <button type="button" aria-haspopup="menu" aria-label={t('explorer.sort.label', { by: t(`explorer.sort.${sort}`) })} onClick={(e) => setToolMenu({ kind: 'sort', rect: e.currentTarget.getBoundingClientRect() })}
          className="press inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink max-sm:order-first sm:h-9">
          <Glyph name="sort" size={16} /><span>{t(`explorer.sort.${sort}`)}</span><Glyph name={dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={14} />
        </button>
      ) : null}
      {view !== 'duplicates' && !semantic ? <IconButton icon={mode === 'grid' ? 'list' : 'grid'} label={mode === 'grid' ? t('explorer.toList') : t('explorer.toGrid')} data-testid="view-toggle" data-mode={mode} onClick={() => setMode(mode === 'grid' ? 'list' : 'grid')} /> : null}
    </div>
  );

  // --- body ---
  const notFound = listing.error instanceof ApiError && listing.error.status === 404;
  let body: ReactNode;
  if (view === 'duplicates') body = <Duplicates onOpen={openItem} onTrash={(files) => void trash(files)} />;
  else if (semantic) body = <SemanticResults q={params.get('q') ?? ''} onOpen={(f, page) => { setViewerPage(page && page > 1 ? page : undefined); setViewer(f); }} />;
  else if (listing.isLoading) body = <Skeleton mode={mode} />;
  else if (view === 'folder' && (notFound || (listing.error instanceof ApiError && listing.error.code === 'invalid_request'))) {
    body = <EmptyState icon="folder" title={t('explorer.notFound.title')} text={t('explorer.notFound.text')} action={<Link href="/" className="btn-grad press inline-flex h-11 items-center gap-2 rounded-[10px] px-5 text-[15px] font-semibold"><Glyph name="home" size={18} />{t('explorer.notFound.home')}</Link>} />;
  } else if (listing.error && !data) body = <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />;
  else if (!items.length) {
    const toFiles = <Link href="/" className="press inline-flex h-11 items-center gap-2 rounded-[10px] px-4 text-[15px] font-medium text-ink ring-1 ring-line-strong ring-inset hover:bg-hover sm:h-9 sm:text-[13px]"><Glyph name="folder" size={16} />{t('account.nav.files')}</Link>;
    body = view === 'folder' ? <EmptyState icon="upload" title={t('explorer.empty.folder')} text={touch ? t('explorer.empty.folderTextTouch') : t('explorer.empty.folderText')}
        action={<><Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()}>{t('explorer.uploadFiles')}</Button><Button icon="folderPlus" onClick={() => setDlg({ type: 'newFolder' })}>{t('next.empty.newFolder')}</Button>{folder?.parentId ? <Button icon="inbox" onClick={() => setDlg({ type: 'request', folder })}>{t('next.empty.portal')}</Button> : null}</>} />
      : view === 'trash' ? <EmptyState icon="trash" title={t('explorer.empty.trash')} text={t('explorer.empty.trashText')} action={toFiles} />
      : view === 'search' ? <EmptyState icon="search" title={t('explorer.empty.search')} text={t('explorer.empty.searchText')}
          action={<>{params.get('in') || nFilters ? <Button icon="filter" onClick={() => setSearch({ in: undefined, kind: undefined, tag: undefined, from: undefined, to: undefined, starred: undefined })}>{t('next.empty.clearFilters')}</Button> : null}{has('semantic') && params.get('q') ? <Button icon="sparkle" onClick={() => setSearch({ mode: 'semantic' })}>{t('next.empty.trySemantic')}</Button> : null}</>} />
      : view === 'starred' ? <EmptyState icon="star" title={t('explorer.empty.starred')} text={t('explorer.empty.starredText')} action={toFiles} />
      : <EmptyState icon="clock" title={t('explorer.empty.recent')} text={t('explorer.empty.recentText')} action={toFiles} />;
  } else {
    const row = (it: Item, index: number) => <ItemRow key={it.id} item={it} index={index} mode={mode} selected={selected.has(it.id)} tabbable={it.id === tabId} tags={tags} api={api} />;
    const cols = 'grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-x-2 sm:gap-y-4';
    const folderCols = 'grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]';
    const nFolders = data!.folders.length;
    const shownFolders = data!.folders.slice(0, limit), shownFiles = data!.files.slice(0, Math.max(0, limit - nFolders));
    body = (
      <div ref={grid} role="grid" aria-label={t('explorer.listLabel', { name: title })} aria-multiselectable="true" aria-rowcount={items.length} onKeyDown={onKey}
        onBlur={(e) => { const to = e.relatedTarget as HTMLElement | null; if (to && !e.currentTarget.contains(to) && !to.closest('[role=dialog],[role=menu]')) wantFocus.current = false; }} data-testid="listing" data-mode={mode} data-dir={navDir.current ?? 'same'} className={cx('anim-nav', mode === 'list' && 'overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)')}>
        {mode === 'list' ? (
          <>
            <ListHeader sort={sortable ? sort : undefined} dir={dir} onSort={sortable ? (k) => applySort(k, sort === k && dir === 'asc' ? 'desc' : 'asc') : undefined} />
            {items.slice(0, limit).map(row)}
          </>
        ) : (
          <>
            {nFolders ? <><p className={sectionCls}>{t('explorer.section.folders')}</p><div role="rowgroup" className={cx(folderCols, 'mb-6')}>{shownFolders.map(row)}</div></> : null}
            {shownFiles.length ? <><p className={sectionCls}>{t('explorer.section.files')}</p><div role="rowgroup" className={cols}>{shownFiles.map((f, i) => row(f, nFolders + i))}</div></> : null}
          </>
        )}
        {items.length > limit ? <div ref={sentinel} className="h-px" data-testid="more-rows" data-rendered={limit} /> : null}
        {view === 'search' && (data!.files.length >= 500 || nFolders >= 300) ? <p className="py-3 text-center text-xs text-ink-3">{t('explorer.searchCapped')}</p> : null}
      </div>
    );
  }

  const detailsProps = detailsItem ? { item: detailsItem, tags, folderPath: detailsItem.type === 'folder' && view === 'folder' ? crumbs : undefined, onTags: (f: FileItem) => setDlg({ type: 'tags', file: f }), onShare: (i: Item) => setDlg({ type: 'share', item: i }), onClose: () => setDetailsId(null), onTimeMachine: (f: FileItem) => setDlg({ type: 'versions', file: f }) } : null;
  const previewable = useMemo(() => (data?.files ?? []).filter((f) => f.scan !== 'infected'), [data]);
  const vi = viewer ? previewable.findIndex((f) => f.id === viewer.id) : -1;
  const viewerFile = viewer ? previewable[vi] ?? viewer : null;
  const moving = dlg?.type === 'move' || dlg?.type === 'copy' ? dlg : null;

  return (
    <div className="flex h-full min-h-0 flex-col" {...drag}>
      <header data-scrolled={scrolled} className={cx('group/head z-10 shrink-0 px-4 pb-2.5 transition-shadow duration-300 sm:px-6 sm:pt-1', scrolled && 'hairline-b')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
            {view === 'folder' && crumbs?.length ? <Crumbs crumbs={crumbs} onDropTo={dropMove} />
              : <h1 className="flex min-h-11 items-center truncate text-[30px] leading-[1.15] text-ink group-data-[scrolled=true]/head:text-[20px] sm:text-[22px]">{view === 'folder' ? (listing.isLoading ? ' ' : t('explorer.notFound.title')) : title}</h1>}
          </div>
          {toolbar}
        </div>
        {view === 'search' && !semantic ? <Filters params={params} tags={tagsQ.data ?? []} open={filtersOpen} content={has('content-search')} onChange={setSearch} /> : null}
        {semantic ? <p className="px-1 pt-1.5 text-[13px] leading-relaxed text-ink-3" data-testid="semantic-note">{t('next.search.semanticNote')}</p> : null}
        {view === 'trash' && items.length ? <p className="px-1 pt-1.5 text-[13px] text-ink-3">{t('explorer.trash.note')}</p> : null}
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className={cx('min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-2 sm:px-6', panelUp ? 'pb-[calc(var(--dock)+7.5rem)] lg:pb-8' : 'pb-dock')}
            onScroll={(e) => { const y = e.currentTarget.scrollTop; if (y > 28 && !scrolled) setScrolled(true); else if (y < 4 && scrolled) setScrolled(false); }} onClick={(e) => { if (!(e.target as HTMLElement).closest('[role=row],button,a,input')) { setSelected(EMPTY); wantFocus.current = false; } }}>
            {body}
          </div>
        </div>
        {detailsProps && wide ? (
          <aside aria-label={t('explorer.a.details')} className="anim-side flex w-[22rem] shrink-0 flex-col border-l border-line bg-pane px-4 pt-3 pb-4" data-testid="details" style={{ ['--insp-bg' as string]: 'var(--spd-color-surface)' }}>
            <div className="mb-2 flex shrink-0 items-center justify-between"><h2 className="spd-eyebrow">{t('explorer.a.details')}</h2><IconButton icon="x" label={t('common.close')} className="-my-2 -mr-2 h-9! w-9!" size={16} onClick={() => setDetailsId(null)} /></div>
            <Inspector key={detailsProps.item.id} {...detailsProps} />
          </aside>
        ) : null}
        {dropping && folder ? (
          <div className="anim-pop pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-4 rounded-[20px] border-2 border-dashed border-accent bg-canvas/80 text-accent backdrop-blur-md" data-testid="drop-overlay">
            <span className="drop-target flex h-16 w-16 items-center justify-center rounded-[14px]"><Glyph name="upload" size={30} /></span>
            <p className="spd-display px-6 text-center text-[24px] text-ink">{t('explorer.dropHere', { name: title })}</p>
          </div>
        ) : null}
      </div>

      <input ref={fileInput} type="file" multiple hidden data-testid="upload-input" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      <input ref={dirInput} type="file" multiple hidden data-testid="upload-dir-input" {...{ webkitdirectory: '' }} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />

      {menu ? <Menu items={menu.items} anchor={menu.anchor} label={menu.label} onClose={closeMenu} /> : null}
      {toolMenu ? <Menu items={toolMenu.kind === 'new' ? newItems : sortItems} label={toolMenu.kind === 'new' ? t('explorer.new') : t('explorer.sort.menu')} anchor={toolMenu.kind === 'new' && !wide ? { x: toolMenu.rect.left, y: toolMenu.rect.bottom + 4 } : toolMenu.rect} onClose={() => setToolMenu(null)} /> : null}
      {detailsProps && !wide ? <Dialog title={t('explorer.a.details')} onClose={() => setDetailsId(null)}><div data-testid="details" className="flex min-h-[50dvh] flex-col"><Inspector key={detailsProps.item.id} {...detailsProps} /></div></Dialog> : null}

      {dlg?.type === 'newFolder' && folder ? <NameDialog title={t('explorer.newFolder')} label={t('explorer.name.folder')} submitLabel={t('common.create')} onClose={() => setDlg(null)}
        onSubmit={async (name) => { await post('/folders', { parentId: folder.id, name }); await refresh(); }} /> : null}
      {dlg?.type === 'rename' ? <NameDialog title={t('explorer.a.rename')} label={t('explorer.name.new')} initial={dlg.item.name} selectStem={dlg.item.type === 'file'} submitLabel={t('explorer.a.rename')} onClose={() => setDlg(null)}
        onSubmit={async (name) => { await patch(`/${dlg.item.type === 'file' ? 'files' : 'folders'}/${dlg.item.id}`, { name }); await refresh(); }} /> : null}
      {moving ? <FolderPicker title={moving.type === 'move' ? t('explorer.pick.moveTitle', { n: moving.items.length }) : t('explorer.pick.copyTitle', { n: moving.items.length })}
        confirmLabel={moving.type === 'move' ? t('explorer.pick.moveHere') : t('explorer.pick.copyHere')} allowKeepBoth={moving.type === 'move'} blockedIds={moving.type === 'move' ? toSel(moving.items).folderIds : []} onClose={() => setDlg(null)}
        onConfirm={async (dest, onConflict) => {
          const sel = toSel(moving.items);
          if (moving.type === 'move') { await moveTo(sel, dest, onConflict); return; }
          await post('/copy', { ...sel, destinationId: dest.id });
          setSelected(EMPTY); await refresh();
          toast(t('explorer.copied', { n: moving.items.length, name: dest.name }), { tone: 'ok' });
        }} /> : null}
      {dlg?.type === 'tags' ? <TagsDialog file={dlg.file} onClose={() => setDlg(null)} /> : null}
      {dlg?.type === 'share' ? <ShareDialog target={{ type: dlg.item.type, id: dlg.item.id, name: dlg.item.name }} onClose={() => { setDlg(null); void refresh(); }} /> : null}
      {dlg?.type === 'request' ? <RequestDialog folder={{ id: dlg.folder.id, name: dlg.folder.name }} onClose={() => setDlg(null)} /> : null}
      {dlg?.type === 'purge' ? <ConfirmDialog danger title={t('explorer.purge.title')} text={dlg.items.length === 1 ? t('explorer.purge.textOne', { name: dlg.items[0]!.name }) : t('explorer.purge.textN', { n: dlg.items.length })} confirmLabel={t('explorer.a.purge')} onClose={() => setDlg(null)}
        onConfirm={async () => { await post('/purge', toSel(dlg.items)); setSelected(EMPTY); setDetailsId(null); await refresh(); toast(t('explorer.purged', { n: dlg.items.length }), { tone: 'ok' }); }} /> : null}
      {dlg?.type === 'emptyTrash' ? <ConfirmDialog danger title={t('explorer.trash.empty')} text={t('explorer.trash.emptyText', { n: items.length })} confirmLabel={t('explorer.trash.empty')} onClose={() => setDlg(null)}
        onConfirm={async () => { await post('/purge', { all: true }); setSelected(EMPTY); setDetailsId(null); await refresh(); toast(t('explorer.trash.emptied'), { tone: 'ok' }); }} /> : null}
      {dlg?.type === 'infected' ? <ConfirmDialog danger title={t('explorer.infected')} text={t('explorer.infectedDownload', { name: dlg.file.name })} confirmLabel={t('explorer.infectedConfirm')} onClose={() => setDlg(null)}
        onConfirm={() => triggerDownload(ownerSource(dlg.file).contentUrl({ download: true }))} /> : null}
      {dlg?.type === 'moveConflict' ? <ConfirmDialog title={t('explorer.a.move')} text={`${t('explorer.pick.conflict', { name: dlg.name })} ${t('explorer.pick.keepBothHint')}`} confirmLabel={t('explorer.keepBoth')} onClose={() => setDlg(null)}
        onConfirm={() => moveTo(dlg.sel, dlg.dest, 'rename')} /> : null}

      <Suspense fallback={null}>
        {dlg?.type === 'versions' ? <TimeMachine file={dlg.file} onClose={() => setDlg(null)} /> : null}
        {dlg?.type === 'members' ? <MembersDialog folder={{ id: dlg.folder.id, name: dlg.folder.name }} onClose={() => setDlg(null)} /> : null}
        {dlg?.type === 'suggest' ? <SuggestDialog files={dlg.files} onClose={() => { setDlg(null); void refresh(); }} /> : null}
      </Suspense>

      {viewerFile ? <Viewer source={ownerSource(viewerFile)} onClose={closeViewer} initialPage={viewerPage}
        side={viewerSide ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4" style={{ ['--insp-bg' as string]: 'var(--surface)' }}>
            <div className="mb-2 flex shrink-0 items-center justify-between"><h2 className="spd-eyebrow">{t('next.insp.title')}</h2><IconButton icon="x" label={t('common.close')} className="-my-2 -mr-2 h-9! w-9!" size={16} onClick={() => setViewerSide(null)} /></div>
            <Inspector key={`${viewerFile.id}:${viewerSide}`} initialTab={viewerSide} item={viewerFile} tags={tags} onTags={(f) => setDlg({ type: 'tags', file: f })} onShare={(i) => setDlg({ type: 'share', item: i })} onClose={closeViewer} onTimeMachine={(f) => setDlg({ type: 'versions', file: f })} />
          </div>
        ) : undefined}
        onPrev={vi > 0 ? () => setViewer(previewable[vi - 1]!) : undefined} onNext={vi >= 0 && vi < previewable.length - 1 ? () => setViewer(previewable[vi + 1]!) : undefined}
        actions={<>
          {view !== 'trash' && has('ai') ? <IconButton icon="sparkle" label={t('next.ai.askFile')} active={viewerSide === 'ask'} data-testid="viewer-ask" onClick={() => setViewerSide(viewerSide === 'ask' ? null : 'ask')} /> : null}
          <IconButton icon="panel" label={t('next.insp.title')} active={viewerSide === 'details'} data-testid="viewer-inspector" onClick={() => setViewerSide(viewerSide === 'details' ? null : 'details')} />
          {view !== 'trash' ? <IconButton icon="share" label={t('explorer.a.share')} onClick={() => setDlg({ type: 'share', item: viewerFile })} /> : null}
        </>} /> : null}
    </div>
  );
}

/** Results by meaning: one passage per file, in the server's order. The score is never shown: only the order means something. */
function SemanticResults({ q, onOpen }: { q: string; onOpen: (f: FileItem, page?: number | null) => void }) {
  const t = useT();
  const r = useQuery({ queryKey: [XKEY, 'semantic', q], queryFn: () => get<{ available: boolean; hits: SemanticHit[] }>(`/search/semantic${qs({ q, limit: 30 })}`), enabled: q.trim().length > 0 });
  if (!q.trim()) return <EmptyState icon="sparkle" title={t('next.search.semanticEmptyQ')} text={t('next.search.semanticEmptyQText')} />;
  if (r.isLoading) return <Skeleton mode="list" />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  if (!r.data.available) return <EmptyState icon="sparkle" title={t('next.search.semanticOff')} text={t('next.search.semanticOffText')} />;
  if (!r.data.hits.length) return <EmptyState icon="search" title={t('explorer.empty.search')} text={t('next.search.semanticNone')} />;
  return (
    <ol className="anim-nav flex flex-col divide-y divide-line overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)" data-dir="same" data-testid="semantic-results">
      {r.data.hits.map((h, i) => (
        <li key={h.file.id}>
          <button type="button" onClick={() => onOpen(h.file, h.passage.page)} className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-hover" data-testid="semantic-hit">
            <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2"><span className="truncate text-[14px] font-medium text-ink">{h.file.name}</span>{h.passage.page ? <span className="shrink-0 text-xs text-ink-3">{t('next.search.page', { n: h.passage.page })}</span> : null}</span>
              <span className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-ink-2"><Snippet text={h.passage.text} /></span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
