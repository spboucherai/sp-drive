// The application frame: sidebar and top bar on a desktop, compact top bar and tab bar on a phone or tablet. The routed
// screen is the only scrolling area.
import { formatBytes } from '@spd/shared';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Glyph } from '../glyphs.tsx';
import { getLocale, useT } from '../i18n.ts';
import { useAuth } from '../session.ts';
import { cx, Dialog, ProgressBar } from '../ui.tsx';
import { LanguageToggle, Mark, ThemeToggle, useSignOut } from './account-ui.tsx';
import { ADMIN, NAV, type NavItem, SETTINGS, TABS } from './nav.ts';
import { Notifications } from './Notifications.tsx';
import { Palette } from './Palette.tsx';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

function Quota() {
  const t = useT();
  const { state } = useAuth();
  const q = state?.quota;
  if (!q) return null;
  const ratio = q.limit > 0 ? q.used / q.limit : 0;
  const l = getLocale();
  return (
    <div className="flex flex-col gap-2" data-testid="quota">
      <div className="flex items-center justify-between text-xs"><span className="font-medium text-ink-2">{t('account.quota.title')}</span>{q.limit > 0 ? <span className="text-ink-3">{Math.round(ratio * 100)} %</span> : null}</div>
      <ProgressBar value={ratio} label={t('account.quota.title')} />
      <p className={cx('text-xs', ratio >= 0.95 ? 'text-danger' : 'text-ink-3')}>{t('account.quota.usedOf', { used: formatBytes(q.used, l), limit: formatBytes(q.limit, l) })}</p>
    </div>
  );
}

function NavLink({ item, path, onNavigate }: { item: NavItem; path: string; onNavigate?: () => void }) {
  const t = useT();
  const on = item.match(path);
  return (
    <Link href={item.href} aria-current={on ? 'page' : undefined} onClick={onNavigate}
      className={cx('flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition', on ? 'bg-accent-soft font-semibold text-accent' : 'font-medium text-ink-2 hover:bg-hover hover:text-ink')}>
      <Glyph name={item.icon} size={19} className="shrink-0" /><span className="truncate">{t(item.label)}</span>
    </Link>
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
  const item = 'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-ink outline-none transition hover:bg-hover focus:bg-hover';
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('account.menu.label', { name: user.display_name })} title={t('account.menu.title')} onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-hover">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden="true">{initials(user.display_name)}</span>
      </button>
      {open ? (
        <div role="menu" aria-label={t('account.menu.title')} onKeyDown={onKey} className="anim-pop absolute top-full right-0 z-40 mt-2 w-64 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-raised p-1 shadow-pop">
          <div className="px-3 py-2.5"><p className="truncate text-sm font-semibold text-ink">{user.display_name}</p><p className="truncate text-xs text-ink-3">{user.email}</p></div>
          <div className="my-1 h-px bg-line" role="separator" />
          <Link href="/settings" role="menuitem" className={item} onClick={() => setOpen(false)}><Glyph name="settings" size={18} className="shrink-0 opacity-80" />{t('account.nav.settings')}</Link>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); void signOut(); }}><Glyph name="logout" size={18} className="shrink-0 opacity-80" />{t('account.menu.signOut')}</button>
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
    <form role="search" onSubmit={submit} className="relative min-w-0 flex-1 lg:max-w-xl">
      <Glyph name="search" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
      <input ref={input} type="search" name="q" value={value} onChange={(e) => setValue(e.currentTarget.value)} aria-label={t('account.search.label')} placeholder={t('account.search.placeholder')} enterKeyHint="search" autoComplete="off"
        onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
        className="h-10 w-full rounded-lg border border-transparent bg-hover pr-3 pl-10 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/25 focus:outline-none lg:pr-20 [&::-webkit-search-cancel-button]:hidden" />
      <button type="button" onClick={onPalette} aria-label={t('account.palette.open')} title={t('account.palette.open')}
        className="absolute top-1/2 right-1.5 hidden h-7 -translate-y-1/2 items-center rounded-md border border-line bg-surface px-2 text-xs font-medium text-ink-3 transition hover:text-ink lg:flex">
        <kbd className="font-sans">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
    </form>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const { state } = useAuth();
  const [path] = useLocation();
  const signOut = useSignOut();
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const admin = state?.user?.role === 'admin';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setMore(false); setPalette((p) => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const tabs = NAV.filter((n) => TABS.includes(n.href));
  const rest = [...NAV.filter((n) => !TABS.includes(n.href)), SETTINGS, ...(admin ? [ADMIN] : [])];
  const inRest = rest.some((n) => n.match(path));
  const tab = 'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition';
  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-ink">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink">{t('account.skip')}</a>

      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="flex h-14 items-center gap-2.5 px-5" aria-label={t('account.home')}><Mark size={28} /><span className="text-[15px] font-semibold tracking-tight">{t('common.appName')}</span></Link>
        <nav aria-label={t('account.nav.label')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((n) => <NavLink key={n.href} item={n} path={path} />)}
          {admin ? <><div className="mx-3 my-2 h-px bg-line" role="separator" /><NavLink item={ADMIN} path={path} /></> : null}
        </nav>
        <div className="border-t border-line px-5 py-4"><Quota /></div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-t shrink-0 border-b border-line bg-surface">
          <div className="flex h-14 items-center gap-2 px-3 lg:gap-3 lg:px-5">
            <Link href="/" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg lg:hidden" aria-label={t('account.home')}><Mark size={28} /></Link>
            <SearchBox onPalette={() => setPalette(true)} />
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <ThemeToggle />
              <Notifications />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none">{children}</main>
        <nav aria-label={t('account.nav.label')} className="safe-b shrink-0 border-t border-line bg-surface lg:hidden">
          <div className="flex">
            {tabs.map((n) => {
              const on = n.match(path);
              return <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={cx(tab, on ? 'text-accent' : 'text-ink-2')}><Glyph name={n.icon} size={22} /><span className="max-w-full truncate px-1">{t(n.short ?? n.label)}</span></Link>;
            })}
            <button type="button" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)} className={cx(tab, inRest ? 'text-accent' : 'text-ink-2')}><Glyph name="menu" size={22} /><span>{t('account.nav.more')}</span></button>
          </div>
        </nav>
      </div>

      {more ? (
        <Dialog title={t('account.nav.more')} onClose={() => setMore(false)}>
          <div className="flex flex-col gap-4">
            <nav aria-label={t('account.nav.more')} className="-mx-2 flex flex-col gap-0.5">{rest.map((n) => <NavLink key={n.href} item={n} path={path} onNavigate={() => setMore(false)} />)}</nav>
            <div className="rounded-xl border border-line px-4 py-3"><Quota /></div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1"><ThemeToggle /><LanguageToggle signedIn /></div>
              <button type="button" onClick={() => { setMore(false); void signOut(); }} className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-2 transition hover:bg-hover hover:text-ink"><Glyph name="logout" size={18} />{t('account.menu.signOut')}</button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {palette ? <Palette onClose={() => setPalette(false)} /> : null}
    </div>
  );
}
