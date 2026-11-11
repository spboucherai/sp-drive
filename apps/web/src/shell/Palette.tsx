// Command palette (⌘K / Ctrl+K): the application's commands, and live file and folder results.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatBytes } from '@spd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { get, qs } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { getLocale, useT } from '../i18n.ts';
import { useAuth } from '../session.ts';
import { setTheme, useTheme } from '../theme.ts';
import type { Listing } from '../types.ts';
import { cx, Dialog, Spinner } from '../ui.tsx';
import { changeLocale, otherLocale, useSignOut } from './account-ui.tsx';
import { ADMIN, NAV, SETTINGS } from './nav.ts';

interface Entry { id: string; icon: string; label: string; hint?: string; group: 'commands' | 'results'; run: () => void }
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ICON: Record<string, string> = { image: 'image', heic: 'image', svg: 'image', video: 'video', audio: 'audio', archive: 'archive', sheet: 'sheet', csv: 'sheet', text: 'text', markdown: 'text', json: 'text' };

export function Palette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [, navigate] = useLocation();
  const { state } = useAuth();
  const { dark } = useTheme();
  const signOut = useSignOut();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = setTimeout(() => setTerm(query.trim()), 180); return () => clearTimeout(h); }, [query]);
  const searching = term.length >= 2;
  const found = useQuery({ queryKey: ['palette-search', term], queryFn: ({ signal }) => get<Listing>(`/search${qs({ q: term })}`, { signal }), enabled: searching, placeholderData: keepPreviousData, staleTime: 10_000 });

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => navigate(href);
    const commands: Entry[] = [
      ...[...NAV, SETTINGS, ...(state?.user?.role === 'admin' ? [ADMIN] : [])].map((n) => ({ id: `nav${n.href}`, icon: n.icon, label: t(n.label), hint: t('account.palette.goTo'), group: 'commands' as const, run: go(n.href) })),
      { id: 'theme', icon: dark ? 'sun' : 'moon', label: dark ? t('account.theme.toLight') : t('account.theme.toDark'), group: 'commands', run: () => setTheme(dark ? 'light' : 'dark') },
      { id: 'lang', icon: 'globe', label: t('account.lang.switchTo'), group: 'commands', run: () => changeLocale(otherLocale(), true) },
      { id: 'signout', icon: 'logout', label: t('account.menu.signOut'), group: 'commands', run: () => void signOut() },
    ];
    const f = fold(query.trim());
    const out = f ? commands.filter((c) => fold(c.label).includes(f)) : commands;
    if (searching && found.data && query.trim().length >= 2) {
      for (const d of found.data.folders.slice(0, 6)) out.push({ id: `d${d.id}`, icon: 'folder', label: d.name, hint: t('account.palette.folder'), group: 'results', run: go(`/folder/${d.id}`) });
      for (const x of found.data.files.slice(0, 12)) out.push({ id: `f${x.id}`, icon: ICON[x.kind] ?? 'file', label: x.name, hint: formatBytes(x.size, getLocale()), group: 'results', run: go(`/folder/${x.folderId}?file=${x.id}`) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching, found.data, state?.user?.role, dark, t, getLocale()]);
  useEffect(() => { setActive(0); }, [query]);
  const index = Math.min(active, Math.max(0, entries.length - 1));
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, entries]);

  const run = (e: Entry | undefined) => { if (!e) return; onClose(); e.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    const n = entries.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((index + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((index - 1 + n) % n); }
    else if (e.key === 'Home' && n) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && n) { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(entries[index]); }
  };
  const pending = query.trim().length >= 2 && (found.isFetching || term !== query.trim());
  const groups: { key: Entry['group']; title: string }[] = [{ key: 'commands', title: t('account.palette.commands') }, { key: 'results', title: t('account.palette.results') }];
  return (
    <Dialog title={t('account.palette.title')} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Glyph name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input data-autofocus type="text" role="combobox" aria-expanded="true" aria-controls="spd-palette-list" aria-autocomplete="list" aria-label={t('account.palette.placeholder')}
            aria-activedescendant={entries[index] ? `spd-palette-${entries[index]!.id}` : undefined} placeholder={t('account.palette.placeholder')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={onKey}
            autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
            className="h-12 w-full rounded-xl border border-line-strong bg-surface pr-10 pl-10 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none" />
          {pending ? <span className="absolute top-1/2 right-3 -translate-y-1/2 text-ink-3"><Spinner size={16} /></span> : null}
        </div>
        <div ref={list} id="spd-palette-list" role="listbox" aria-label={t('account.palette.title')} className="-mx-2 h-[min(22rem,50dvh)] overflow-y-auto">
          {groups.map((g) => {
            const items = entries.filter((e) => e.group === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key} role="group" aria-label={g.title}>
                <div className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-ink-3 uppercase" aria-hidden="true">{g.title}</div>
                {items.map((e) => {
                  const on = entries[index]?.id === e.id;
                  return (
                    <div key={e.id} id={`spd-palette-${e.id}`} role="option" aria-selected={on} onMouseMove={() => { if (!on) setActive(entries.indexOf(e)); }} onClick={() => run(e)}
                      className={cx('mx-1 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm', on ? 'bg-accent-soft text-ink' : 'text-ink')}>
                      <Glyph name={e.icon} size={18} className={cx('shrink-0', on ? 'text-accent' : 'text-ink-3')} />
                      <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      {e.hint ? <span className="shrink-0 text-xs text-ink-3">{e.hint}</span> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!entries.length && !pending ? <p className="px-3 py-8 text-center text-sm text-ink-2" role="status">{found.error ? t('account.palette.searchError') : t('account.palette.nothing')}</p> : null}
        </div>
        <p className="hidden items-center gap-4 border-t border-line pt-3 text-xs text-ink-3 sm:flex" aria-hidden="true">
          <span><kbd className="font-sans">↑↓</kbd> {t('account.palette.hintMove')}</span><span><kbd className="font-sans">↵</kbd> {t('account.palette.hintOpen')}</span><span><kbd className="font-sans">Esc</kbd> {t('common.close')}</span>
        </p>
      </div>
    </Dialog>
  );
}
