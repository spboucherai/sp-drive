// Command palette (⌘K / Ctrl+K). Real commands only: every entry navigates, or runs an action the screen in front
// really offers (the explorer publishes its folder and selection in next/context). Typing also searches the files —
// by name and, when the server indexes content, inside the documents (a snippet shows the passage found).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatBytes } from '@spd/shared';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { get, qs } from '../api.ts';
import { transferCentre } from '../explorer/UploadPanel.tsx';
import { Glyph } from '../glyphs.tsx';
import { getLocale, useT } from '../i18n.ts';
import { getContext } from '../next/context.ts';
import { useMeta } from '../next/meta.ts';
import { Snippet } from '../next/Snippet.tsx';
import type { Collection, FoundFile } from '../next/types.ts';
import { useAuth } from '../session.ts';
import { setTheme, useTheme } from '../theme.ts';
import type { Folder, Listing } from '../types.ts';
import { cx, Dialog, Spinner } from '../ui.tsx';
import { changeLocale, otherLocale, useSignOut } from './account-ui.tsx';
import { ADMIN, SETTINGS, visibleNav } from './nav.ts';

type Group = 'actions' | 'commands' | 'collections' | 'recent' | 'results';
interface Entry { id: string; icon: string; label: string; hint?: string; detail?: ReactNode; group: Group; run: () => void }
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ICON: Record<string, string> = { image: 'image', heic: 'image', svg: 'image', video: 'video', audio: 'audio', archive: 'archive', sheet: 'sheet', csv: 'sheet', text: 'text', markdown: 'text', json: 'text', pdf: 'pdf', office: 'doc' };
export const fileHref = (f: { id: string; folderId: string }, page?: number | null) => `/folder/${f.folderId}?file=${f.id}${page ? `&page=${page}` : ''}`;

export function Palette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [, navigate] = useLocation();
  const { state } = useAuth();
  const meta = useMeta();
  const { dark } = useTheme();
  const signOut = useSignOut();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const ctx = useMemo(getContext, []); // what the screen offered when the palette opened
  useEffect(() => { const h = setTimeout(() => setTerm(query.trim()), 180); return () => clearTimeout(h); }, [query]);
  const searching = term.length >= 2;
  const found = useQuery({ queryKey: ['palette-search', term], queryFn: ({ signal }) => get<{ folders: Folder[]; files: FoundFile[] }>(`/search${qs({ q: term })}`, { signal }), enabled: searching, placeholderData: keepPreviousData, staleTime: 10_000 });
  const recent = useQuery({ queryKey: ['explorer', 'listing', '/recent'], queryFn: () => get<Listing>('/recent'), staleTime: 30_000 });
  const cols = useQuery({ queryKey: ['next', 'collections'], queryFn: () => get<Collection[]>('/collections'), enabled: meta.features.includes('collections'), staleTime: 30_000 });

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => navigate(href);
    const sel = ctx.selection;
    const actions: Entry[] = [];
    if (ctx.newFolder) actions.push({ id: 'a-newfolder', icon: 'folderPlus', label: t('next.pal.newFolder'), hint: ctx.folder?.name, group: 'actions', run: ctx.newFolder });
    if (ctx.upload) actions.push({ id: 'a-upload', icon: 'upload', label: t('next.pal.upload'), hint: ctx.folder?.name, group: 'actions', run: ctx.upload });
    if (sel.length && ctx.moveSelection) actions.push({ id: 'a-move', icon: 'move', label: t('next.pal.move', { n: sel.length }), group: 'actions', run: ctx.moveSelection });
    if (sel.length === 1 && ctx.shareSelection) actions.push({ id: 'a-share', icon: 'link', label: t('next.pal.share', { name: sel[0]!.name }), group: 'actions', run: ctx.shareSelection });
    actions.push({ id: 'a-transfers', icon: 'swap', label: t('next.pal.transfers'), group: 'actions', run: () => transferCentre.open() });
    actions.push({ id: 'a-dups', icon: 'duplicate', label: t('next.pal.duplicates'), group: 'actions', run: go('/duplicates') });
    if (meta.features.includes('collections')) actions.push({ id: 'a-newcol', icon: 'collection', label: t('next.col.new'), group: 'actions', run: () => window.dispatchEvent(new CustomEvent('spd:shell', { detail: { what: 'new-collection' } })) });
    const commands: Entry[] = [
      ...[...visibleNav(meta.features), SETTINGS, ...(state?.user?.role === 'admin' ? [ADMIN] : [])].map((n) => ({ id: `nav${n.href}`, icon: n.icon, label: t(n.label), hint: t('account.palette.goTo'), group: 'commands' as const, run: go(n.href) })),
      { id: 'theme', icon: dark ? 'sun' : 'moon', label: dark ? t('account.theme.toLight') : t('account.theme.toDark'), group: 'commands', run: () => setTheme(dark ? 'light' : 'dark') },
      { id: 'lang', icon: 'globe', label: t('account.lang.switchTo'), group: 'commands', run: () => changeLocale(otherLocale(), true) },
      { id: 'signout', icon: 'logout', label: t('account.menu.signOut'), group: 'commands', run: () => void signOut() },
    ];
    const collections: Entry[] = (cols.data ?? []).map((c) => ({ id: `c${c.id}`, icon: 'collection', label: c.name, hint: t('next.pal.collection'), group: 'collections', run: go(`/collections/${c.id}`) }));
    const recents: Entry[] = (recent.data?.files ?? []).slice(0, 6).map((x) => ({ id: `r${x.id}`, icon: ICON[x.kind] ?? 'file', label: x.name, hint: t('next.pal.recent'), group: 'recent', run: go(fileHref(x)) }));
    const f = fold(query.trim());
    const all = [...actions, ...commands, ...collections, ...recents];
    const out = f ? all.filter((c) => fold(c.label).includes(f)) : all;
    if (searching && found.data && query.trim().length >= 2) {
      const seen = new Set(out.filter((e) => e.group === 'recent').map((e) => e.id.slice(1)));
      for (const d of found.data.folders.slice(0, 5)) out.push({ id: `d${d.id}`, icon: 'folder', label: d.name, hint: t('account.palette.folder'), group: 'results', run: go(`/folder/${d.id}`) });
      for (const x of found.data.files.slice(0, 12)) {
        if (seen.has(x.id)) continue;
        const m = x.match;
        out.push({ id: `f${x.id}`, icon: ICON[x.kind] ?? 'file', label: x.name, hint: m?.page ? t('next.search.page', { n: m.page }) : formatBytes(x.size, getLocale()), group: 'results',
          detail: m?.snippet ? <Snippet text={m.snippet} className="line-clamp-1" /> : undefined, run: go(fileHref(x, m?.page)) });
      }
      out.push({ id: 'all-results', icon: 'search', label: t('next.pal.allResults', { q: query.trim() }), group: 'results', run: go(`/search?q=${encodeURIComponent(query.trim())}`) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching, found.data, recent.data, cols.data, state?.user?.role, dark, t, getLocale(), meta.features.join()]);
  useEffect(() => { setActive(0); }, [query]);
  const index = Math.min(active, Math.max(0, entries.length - 1));
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, entries]);

  const run = (e: Entry | undefined) => { if (!e) return; onClose(); setTimeout(e.run, 0); }; // after the dialog gave the focus back
  const onKey = (e: React.KeyboardEvent) => {
    const n = entries.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((index + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((index - 1 + n) % n); }
    else if (e.key === 'Home' && n) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && n) { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(entries[index]); }
  };
  const pending = query.trim().length >= 2 && (found.isFetching || term !== query.trim());
  const groups: { key: Group; title: string }[] = [
    { key: 'actions', title: t('next.pal.actions') }, { key: 'commands', title: t('account.palette.commands') }, { key: 'collections', title: t('next.col.title') },
    { key: 'recent', title: t('next.pal.recentTitle') }, { key: 'results', title: t('account.palette.results') },
  ];
  return (
    <Dialog title={t('account.palette.title')} onClose={onClose} layout="palette" testId="palette">
      <div className="relative shrink-0 border-b border-line">
        <Glyph name="search" size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3" />
        <input data-autofocus type="text" role="combobox" aria-expanded="true" aria-controls="spd-palette-list" aria-autocomplete="list" aria-label={t('account.palette.placeholder')}
          aria-activedescendant={entries[index] ? `spd-palette-${entries[index]!.id}` : undefined} placeholder={t('account.palette.placeholder')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={onKey}
          autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
          className="h-14 w-full bg-transparent pr-11 pl-11 text-[17px] text-ink outline-none placeholder:text-ink-3" />
        {pending ? <span className="absolute top-1/2 right-4 -translate-y-1/2 text-ink-3"><Spinner size={16} /></span> : null}
      </div>
      <div ref={list} id="spd-palette-list" role="listbox" aria-label={t('account.palette.title')} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {groups.map((g) => {
          const items = entries.filter((e) => e.group === g.key);
          if (!items.length) return null;
          return (
            <div key={g.key} role="group" aria-label={g.title} className="pb-1">
              <div className="spd-eyebrow px-2.5 pt-2 pb-1" aria-hidden="true">{g.title}</div>
              {items.map((e) => {
                const on = entries[index]?.id === e.id;
                return (
                  <div key={e.id} id={`spd-palette-${e.id}`} role="option" aria-selected={on} onMouseMove={() => { if (!on) setActive(entries.indexOf(e)); }} onClick={() => run(e)}
                    className={cx('flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm text-ink max-sm:min-h-11', on && 'bg-selection')}>
                    <Glyph name={e.icon} size={17} className={cx('shrink-0', on ? 'text-accent' : 'text-ink-3')} />
                    <span className="min-w-0 flex-1"><span className="block truncate">{e.label}</span>{e.detail ? <span className="block text-xs text-ink-3">{e.detail}</span> : null}</span>
                    {e.hint ? <span className="max-w-[40%] shrink-0 truncate text-xs text-ink-3">{e.hint}</span> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!entries.length && !pending ? <p className="px-3 py-8 text-center text-sm text-ink-2" role="status">{found.error ? t('account.palette.searchError') : t('account.palette.nothing')}</p> : null}
      </div>
      <p className="hidden shrink-0 items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-3 sm:flex" aria-hidden="true">
        <span><kbd className="font-sans">↑↓</kbd> {t('account.palette.hintMove')}</span><span><kbd className="font-sans">↵</kbd> {t('account.palette.hintOpen')}</span><span><kbd className="font-sans">Esc</kbd> {t('common.close')}</span>
      </p>
    </Dialog>
  );
}
