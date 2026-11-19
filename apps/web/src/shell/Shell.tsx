// The application frame: sidebar and top bar on a desktop, compact top bar and tab bar on a phone or tablet. The routed
// screen is the only scrolling area. The frame also owns what must be reachable from every screen: the command
// palette, the transfer centre, live refresh.
import { formatBytes } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { get } from '../api.ts';
import { TransferButton, TransferCentre } from '../explorer/UploadPanel.tsx';
import { uploads } from '../explorer/uploads.ts';
import { Glyph } from '../glyphs.tsx';
import { getLocale, useT } from '../i18n.ts';
import { useLive, useLiveState } from '../next/live.ts';
import { useMeta } from '../next/meta.ts';
import type { Collection } from '../next/types.ts';
import { useAuth } from '../session.ts';
import { cx, Dialog } from '../ui.tsx';
import { LanguageToggle, Mark, ThemeToggle, useSignOut } from './account-ui.tsx';
import { ADMIN, type NavItem, SETTINGS, TABS, visibleNav } from './nav.ts';
import { Notifications } from './Notifications.tsx';

const Palette = lazy(() => import('./Palette.tsx').then((m) => ({ default: m.Palette })));
const CollectionDialog = lazy(() => import('../next/Collections.tsx').then((m) => ({ default: m.CollectionDialog })));

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
export const COLLECTION_DOT: Record<string, string> = { slate: 'bg-slate-500', red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-500', green: 'bg-green-500', teal: 'bg-teal-500', blue: 'bg-blue-500', violet: 'bg-violet-500', pink: 'bg-pink-500' };

/** The storage meter of the sidebar: one line, one bar; the details live on the storage screen. */
function Quota({ link }: { link: boolean }) {
  const t = useT();
  const { state } = useAuth();
  const q = state?.quota;
  if (!q) return null;
  const ratio = q.limit > 0 ? Math.min(1, q.used / q.limit) : 0;
  const l = getLocale();
  const tone = ratio >= 0.95 ? 'bg-danger' : ratio >= 0.9 ? 'bg-warn' : 'bg-accent';
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2"><span className="spd-eyebrow">{t('account.quota.title')}</span>{q.limit > 0 ? <span className="spd-figure text-[13px] text-ink">{Math.round(ratio * 100)} %</span> : null}</div>
      <div role="progressbar" aria-label={t('account.quota.title')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-well">
        <div className={cx('anim-grow-x h-full w-full origin-left rounded-full', tone)} style={{ transform: `scaleX(${Math.max(ratio, 0.012)})`, animation: 'none', transition: 'transform var(--spd-duration-slow) var(--spd-curve-enter)' }} />
      </div>
      <p className={cx('text-xs', ratio >= 0.95 ? 'text-danger' : 'text-ink-3')}>{t('account.quota.usedOf', { used: formatBytes(q.used, l), limit: formatBytes(q.limit, l) })}</p>
    </>
  );
  return link
    ? <Link href="/storage" data-testid="quota" className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-canvas">{body}</Link>
    : <div data-testid="quota" className="flex flex-col gap-1.5 px-3 py-2.5">{body}</div>;
}

function NavLink({ item, path, onNavigate, trailing }: { item: NavItem; path: string; onNavigate?: () => void; trailing?: ReactNode }) {
  const t = useT();
  const on = item.match(path);
  return (
    <Link href={item.href} aria-current={on ? 'page' : undefined} onClick={onNavigate}
      className={cx('relative flex h-11 items-center gap-2.5 rounded-lg px-2.5 text-[15px] transition-colors lg:h-8 lg:text-[13px]', on ? 'bg-selection font-medium text-ink' : 'text-ink-2 hover:bg-canvas hover:text-ink max-lg:hover:bg-hover')}>
      <Glyph name={item.icon} size={17} className={cx('shrink-0', on ? 'text-accent' : 'text-ink-3')} /><span className="min-w-0 flex-1 truncate">{t(item.label)}</span>{trailing}
    </Link>
  );
}

/** Smart collections in the sidebar: saved rules, each with its live count. */
function CollectionsNav({ path, onNavigate, onNew }: { path: string; onNavigate?: () => void; onNew: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['next', 'collections'], queryFn: () => get<Collection[]>('/collections'), staleTime: 15_000 });
  return (
    <section aria-label={t('next.col.title')} className="mt-4" data-testid="collections-nav">
      <div className="flex h-7 items-center justify-between pr-1 pl-2.5">
        <h2 className="spd-eyebrow">{t('next.col.title')}</h2>
        <button type="button" onClick={onNew} aria-label={t('next.col.new')} title={t('next.col.new')} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-canvas hover:text-ink max-lg:hover:bg-hover"><Glyph name="plus" size={14} strokeWidth={2} /></button>
      </div>
      {(q.data ?? []).map((c) => {
        const on = path === `/collections/${c.id}`;
        return (
          <Link key={c.id} href={`/collections/${c.id}`} aria-current={on ? 'page' : undefined} onClick={onNavigate}
            className={cx('flex h-11 items-center gap-2.5 rounded-lg px-2.5 text-[15px] transition-colors lg:h-8 lg:text-[13px]', on ? 'bg-selection font-medium text-ink' : 'text-ink-2 hover:bg-canvas hover:text-ink max-lg:hover:bg-hover')}>
            <span className="flex w-[17px] shrink-0 justify-center"><span className={cx('h-2 w-2 rounded-full', COLLECTION_DOT[c.color] ?? 'bg-slate-500')} /></span>
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            {typeof c.count === 'number' ? <span className="text-xs text-ink-3 tabular-nums">{c.count}</span> : null}
          </Link>
        );
      })}
      {q.data && !q.data.length ? <button type="button" onClick={onNew} className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-xs text-ink-3 hover:text-ink">{t('next.col.emptyNav')}</button> : null}
    </section>
  );
}

function AccountMenu() {
  const t = useT();
  const { state } = useAuth();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const user = state?.user;
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const out = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', out);
    return () => window.removeEventListener('mousedown', out);
  }, [open]);
  if (!user) return null;
  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); wrap.current?.querySelector<HTMLElement>('button')?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const item = 'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-ink outline-none transition-colors hover:bg-hover focus:bg-hover';
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('account.menu.label', { name: user.display_name })} title={t('account.menu.title')} onClick={() => setOpen((o) => !o)}
        className="press flex h-11 w-11 items-center justify-center rounded-full">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-selection text-[12px] font-semibold text-accent" aria-hidden="true">{initials(user.display_name)}</span>
      </button>
      {open ? (
        <div role="menu" aria-label={t('account.menu.title')} onKeyDown={onKey} className="glass anim-pop absolute top-full right-0 z-40 mt-1 w-60 max-w-[calc(100vw-1rem)] rounded-[14px] p-1.5">
          <div className="px-2.5 py-2"><p className="truncate text-[15px] font-semibold text-ink">{user.display_name}</p><p className="truncate text-xs text-ink-3">{user.email}</p></div>
          <div className="my-1 h-px bg-line" role="separator" />
          <Link href="/settings" role="menuitem" className={item} onClick={() => setOpen(false)}><Glyph name="settings" size={16} className="shrink-0 text-ink-3" />{t('account.nav.settings')}</Link>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); void signOut(); }}><Glyph name="logout" size={16} className="shrink-0 text-ink-3" />{t('account.menu.signOut')}</button>
        </div>
      ) : null}
    </div>
  );
}

function SearchBox({ onPalette }: { onPalette: () => void }) {
  const t = useT();
  const [path, navigate] = useLocation();
  const search = useSearch();
  const current = path === '/search' ? new URLSearchParams(search).get('q') ?? '' : '';
  const [value, setValue] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(current); }, [current, path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[role=dialog][aria-modal=true]')) return;
      e.preventDefault(); input.current?.focus(); input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); const q = value.trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`); };
  return (
    <form role="search" onSubmit={submit} className="relative min-w-0 flex-1 lg:max-w-[34rem]">
      <Glyph name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-ink-3" />
      <input ref={input} type="search" name="q" value={value} onChange={(e) => setValue(e.currentTarget.value)} aria-label={t('account.search.label')} placeholder={t('account.search.placeholder')} enterKeyHint="search" autoComplete="off"
        onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
        className="h-10 w-full rounded-[10px] border border-transparent bg-pane pr-3 pl-9 text-base text-ink transition-[border-color,box-shadow,background-color] placeholder:text-ink-3 focus:border-accent focus:bg-canvas focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm lg:h-9 lg:pr-16 [&::-webkit-search-cancel-button]:hidden" />
      <button type="button" onClick={onPalette} aria-label={t('account.palette.open')} title={t('account.palette.open')}
        className="absolute top-1/2 right-1.5 hidden h-6 -translate-y-1/2 items-center rounded-md border border-line bg-canvas px-1.5 text-[11px] font-medium text-ink-3 transition-colors hover:text-ink lg:flex">
        <kbd className="font-sans">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
    </form>
  );
}

/** A dot that says whether changes arrive by themselves. Colour is never alone: the title says it in words. */
function LiveDot() {
  const t = useT();
  const s = useLiveState();
  if (s === 'off') return null;
  const label = s === 'live' ? t('next.live.on') : s === 'connecting' ? t('next.live.connecting') : t('next.live.polling');
  return <span role="status" title={label} aria-label={label} data-testid="live-state" data-state={s} className="mx-1 hidden h-11 items-center gap-1.5 text-[11px] text-ink-3 xl:flex"><span className={cx('h-1.5 w-1.5 rounded-full', s === 'live' ? 'bg-ok' : 'anim-ambient bg-warn')} />{s === 'live' ? t('next.live.short') : t('next.live.pollingShort')}</span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const qc = useQueryClient();
  const { state } = useAuth();
  const meta = useMeta();
  const [path] = useLocation();
  const signOut = useSignOut();
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const admin = state?.user?.role === 'admin';
  useEffect(() => { uploads.bind(qc); }, [qc]);
  useLive(meta.features.includes('events'), meta.api >= 2);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setMore(false); setPalette((p) => !p); } };
    const onAsk = (e: Event) => { const what = (e as CustomEvent).detail?.what; if (what === 'palette') setPalette(true); else if (what === 'new-collection') setNewCollection(true); };
    window.addEventListener('keydown', onKey); window.addEventListener('spd:shell', onAsk);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('spd:shell', onAsk); };
  }, []);
  const nav = visibleNav(meta.features);
  const collections = meta.features.includes('collections');
  const tabs = nav.filter((n) => TABS.includes(n.href));
  const rest = [...nav.filter((n) => !TABS.includes(n.href)), SETTINGS, ...(admin ? [ADMIN] : [])];
  const inRest = rest.some((n) => n.match(path)) || path.startsWith('/collections/');
  const tab = 'press relative flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium';
  const group = (g: NavItem['group'], onNavigate?: () => void) => nav.filter((n) => n.group === g).map((n) => <NavLink key={n.href} item={n} path={path} onNavigate={onNavigate} />);
  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-ink">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink">{t('account.skip')}</a>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-pane lg:flex">
        <Link href="/" className="flex h-14 items-center gap-2.5 px-4" aria-label={t('account.home')}><Mark size={26} /><span className="spd-title text-[17px]">{t('common.appName')}</span></Link>
        <nav aria-label={t('account.nav.label')} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1 pb-3">
          <div className="flex flex-col gap-px">{group('places')}</div>
          {collections ? <CollectionsNav path={path} onNew={() => setNewCollection(true)} /> : null}
          <h2 className="spd-eyebrow mt-4 flex h-7 items-center pl-2.5">{t('next.nav.library')}</h2>
          <div className="flex flex-col gap-px">{group('library')}</div>
          {admin ? <><div className="mx-2.5 my-2 h-px bg-line" role="separator" /><NavLink item={ADMIN} path={path} /></> : null}
        </nav>
        <div className="border-t border-line p-1.5"><Quota link={meta.features.includes('storage')} /></div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="safe-t z-20 shrink-0 bg-bg">
          <div className="flex h-14 items-center gap-2 pr-1.5 pl-4 lg:gap-3 lg:pr-3 lg:pl-5">
            <Link href="/" className="press flex h-11 w-8 shrink-0 items-center justify-center lg:hidden" aria-label={t('account.home')}><Mark size={30} /></Link>
            <SearchBox onPalette={() => setPalette(true)} />
            <div className="ml-auto flex shrink-0 items-center">
              <LiveDot />
              <TransferButton />
              <ThemeToggle className="max-sm:hidden" />
              <Notifications />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none">{children}</main>
        <nav aria-label={t('account.nav.label')} className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 lg:hidden" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
          <div className="glass pointer-events-auto relative mx-auto flex max-w-md rounded-[18px] px-1">
            {tabs.map((n) => {
              const on = n.match(path);
              return <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={cx(tab, on ? 'text-accent' : 'text-ink-2')}><Glyph name={n.icon} size={22} strokeWidth={on ? 2.1 : 1.6} /><span className="max-w-full truncate px-1">{t(n.short ?? n.label)}</span></Link>;
            })}
            <button type="button" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)} className={cx(tab, inRest ? 'text-accent' : 'text-ink-2')}><Glyph name="menu" size={22} strokeWidth={inRest ? 2.1 : 1.6} /><span>{t('account.nav.more')}</span></button>
          </div>
        </nav>
        <TransferCentre />
      </div>

      {more ? (
        <Dialog title={t('account.nav.more')} onClose={() => setMore(false)}>
          <div className="flex flex-col gap-3">
            <nav aria-label={t('account.nav.more')} className="flex flex-col gap-px">
              {rest.map((n) => <NavLink key={n.href} item={n} path={path} onNavigate={() => setMore(false)} />)}
              {collections ? <CollectionsNav path={path} onNavigate={() => setMore(false)} onNew={() => { setMore(false); setNewCollection(true); }} /> : null}
            </nav>
            <div className="rounded-xl bg-pane"><Quota link={false} /></div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1"><ThemeToggle /><LanguageToggle signedIn /></div>
              <button type="button" onClick={() => { setMore(false); void signOut(); }} className="press inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium text-danger hover:bg-danger-soft"><Glyph name="logout" size={18} />{t('account.menu.signOut')}</button>
            </div>
          </div>
        </Dialog>
      ) : null}
      <Suspense fallback={null}>
        {palette ? <Palette onClose={() => setPalette(false)} /> : null}
        {newCollection ? <CollectionDialog onClose={() => setNewCollection(false)} /> : null}
      </Suspense>
    </div>
  );
}
