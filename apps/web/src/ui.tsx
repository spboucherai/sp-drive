/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/ui.tsx
 * Module           : web
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

// Small accessible building blocks shared by every screen. No external UI library.
import { type ButtonHTMLAttributes, createContext, type InputHTMLAttributes, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Art } from './art.tsx';
import { Glyph } from './glyphs.tsx';
import { errorText, useT } from './i18n.ts';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// --- buttons ---
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'btn-grad font-medium',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'bg-danger text-white dark:text-[#1a0508] font-semibold hover:brightness-110',
};
export function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean; icon?: string }) {
  return (
    <button type="button" {...p} disabled={p.disabled || busy} aria-busy={busy || undefined}
      className={cx('press inline-flex items-center justify-center gap-2 font-medium select-none disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 rounded-lg px-3 text-[13px]' : size === 'lg' ? 'h-13 rounded-xl px-5 text-base sm:text-[17px]' : 'h-11 rounded-[10px] px-4 text-[15px] sm:h-9 sm:text-[13px]', VARIANT[variant], className)}>
      {busy ? <Spinner size={16} /> : icon ? <Glyph name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 20 : 18} className="shrink-0" /> : null}
      {children}
    </button>
  );
}
export function IconButton({ icon, label, className, size = 20, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; size?: number; active?: boolean }) {
  return (
    <button type="button" {...p} aria-label={label} title={label} aria-pressed={active}
      className={cx('press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-hover hover:text-ink active:bg-hover disabled:opacity-40 disabled:pointer-events-none', active && 'bg-accent-soft text-accent', className)}>
      <Glyph name={icon} size={size} />
    </button>
  );
}
export function Spinner({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" role="status" aria-label="…"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

// --- form fields ---
// 16 px on phones: iOS zooms the page when a focused field is smaller
const inputCls = 'h-12 sm:h-9 w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-base sm:text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-60';
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  const desc = hint || error ? `${id}-d` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      {children(id, desc)}
      {error ? <p id={desc} role="alert" className="text-xs text-danger">{error}</p> : hint ? <p id={desc} className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
export function TextField({ label, hint, error, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  return <Field label={label} hint={hint} error={error}>{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} {...p} className={cx(inputCls, className)} />}</Field>;
}
export function TextArea({ label, hint, rows = 3, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return <Field label={label} hint={hint}>{(id, d) => <textarea id={id} aria-describedby={d} rows={rows} {...p} className={cx(inputCls, 'h-auto! sm:h-auto! py-2.5 leading-relaxed')} />}</Field>;
}
export function Select({ label, hint, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  return <Field label={label} hint={hint}>{(id, d) => <select id={id} aria-describedby={d} {...p} className={inputCls}>{children}</select>}</Field>;
}
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer"><span className="block text-sm font-medium text-ink">{label}</span>{hint ? <span className="block text-xs text-ink-3">{hint}</span> : null}</label>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 disabled:opacity-50', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 left-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-300 ease-(--ease-spring)', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'; children: ReactNode }) {
  const c = { neutral: 'bg-hover text-ink-2', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', accent: 'bg-accent-soft text-accent' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', c)}>{children}</span>;
}
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-well"><div className="h-full w-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${v})`, transition: 'transform var(--spd-motion-progress)' }} /></div>;
}
export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="anim-rise flex flex-col items-center justify-center gap-3 px-6 py-12 text-center sm:py-16">
      <Art name={icon} />
      <h2 className="spd-display mt-1 text-[26px] leading-tight text-ink sm:text-[28px]">{title}</h2>
      {text ? <p className="max-w-sm text-[15px] leading-relaxed text-ink-2">{text}</p> : null}
      {action ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return <EmptyState icon="warning" title={errorText(error)} action={onRetry ? <Button onClick={onRetry} icon="refresh">{t('common.retry')}</Button> : undefined} />;
}
export function Loading({ label }: { label?: string }) {
  const t = useT();
  return <div className="flex items-center justify-center gap-3 py-16 text-ink-3"><span className="text-accent"><Spinner /></span><span className="text-sm">{label ?? t('common.loading')}</span></div>;
}

// --- dialog: modal on desktop, bottom sheet on phones; focus is trapped and restored, Escape closes ---
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Dialog({ title, onClose, children, footer, wide, dismissable = true, layout = 'sheet', testId }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean | 'xl'; dismissable?: boolean;
  /** `sheet`: bottom sheet on phones, centred card elsewhere. `palette`: a bare translucent panel near the top (the command palette). `side`: a panel on the right edge (a sheet on phones). */
  layout?: 'sheet' | 'palette' | 'side'; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const t = useT();
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []);
  // The focused control may disappear while the dialog is open (a button that no longer applies): the focus then
  // falls on the page behind. Keys typed there still belong to the topmost dialog: Escape closes it, Tab comes back in.
  const live = useRef({ onClose, dismissable });
  live.current = { onClose, dismissable };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el || (e.key !== 'Escape' && e.key !== 'Tab')) return;
      const a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return;
      const all = document.querySelectorAll('[role=dialog][aria-modal=true]');
      if (all[all.length - 1] !== el) return;
      e.preventDefault();
      if (e.key === 'Escape') { if (live.current.dismissable) live.current.onClose(); } else (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab') return;
    const f = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const backdrop = (e: React.MouseEvent) => { if (e.target === e.currentTarget && dismissable) onClose(); };
  if (layout === 'palette') return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-(--scrim) px-3 pt-[max(env(safe-area-inset-top),0.75rem)] sm:pt-[14vh]" onMouseDown={backdrop}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKey} data-testid={testId}
        className="glass anim-pop flex max-h-[min(34rem,calc(100dvh-1.5rem))] w-full max-w-[620px] flex-col overflow-hidden rounded-[14px] outline-none">
        <h2 id={titleId} className="sr-only">{title}</h2>
        {children}
      </div>
    </div>, document.body);
  if (layout === 'side') return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-end bg-(--scrim) sm:items-stretch" onMouseDown={backdrop}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKey} data-testid={testId}
        className="anim-sidesheet safe-b relative flex max-h-[92dvh] w-full flex-col rounded-t-[20px] bg-raised shadow-pop outline-none sm:max-h-none sm:w-[30rem] sm:max-w-[92vw] sm:rounded-none">
        <span aria-hidden="true" className="absolute top-2 left-1/2 h-[5px] w-10 -translate-x-1/2 rounded-full bg-line-strong sm:hidden" />
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 pt-6 pb-3 sm:pt-4">
          <h2 id={titleId} className="min-w-0 truncate text-[20px] leading-tight">{title}</h2>
          <IconButton icon="x" label={t('common.close')} onClick={onClose} className="-mr-2 h-9! w-9!" size={18} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>, document.body);
  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-(--scrim) sm:items-center sm:p-4" onMouseDown={backdrop}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKey} data-testid={testId}
        className={cx('anim-sheet safe-b relative flex max-h-[92dvh] w-full flex-col rounded-t-[20px] bg-raised shadow-pop outline-none sm:rounded-[14px]', wide === 'xl' ? 'sm:max-w-5xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <span aria-hidden="true" className="absolute top-2 left-1/2 h-[5px] w-10 -translate-x-1/2 rounded-full bg-line-strong sm:hidden" />
        <header className="flex items-center justify-between gap-3 px-5 pt-6 pb-2 sm:pt-5">
          <h2 id={titleId} className="min-w-0 truncate text-[20px] leading-tight">{title}</h2>
          {dismissable ? <IconButton icon="x" label={t('common.close')} onClick={onClose} className="-mr-2 h-9! w-9!" size={18} /> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 max-sm:flex-col-reverse max-sm:items-stretch">{footer}</footer> : null}
      </div>
    </div>, document.body);
}

// --- menu (dropdown or context menu) with arrow-key navigation ---
export interface MenuItem { label: string; icon?: string; onSelect: () => void; danger?: boolean; disabled?: boolean; separatorBefore?: boolean; shortcut?: string }
export function Menu({ items, anchor, onClose, label }: { items: MenuItem[]; anchor: { x: number; y: number } | DOMRect; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const x = 'width' in anchor ? anchor.right - r.width : anchor.x, y = 'width' in anchor ? anchor.bottom + 4 : anchor.y;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const scroll = (e: Event) => { if (!ref.current?.hasAttribute('data-sheet')) close(e); }; // a sheet covers the page: nothing under it can move away
    window.addEventListener('mousedown', close); window.addEventListener('scroll', scroll, true); window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); } else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
  };
  // on a phone the menu is an action sheet at the bottom of the screen, within reach of the thumb
  const sheet = isMobile();
  const list = items.map((it, i) => (
    <div key={i}>
      {it.separatorBefore ? <div className={cx('h-px bg-line', sheet ? 'mx-4 my-1.5' : 'mx-2 my-1')} role="separator" /> : null}
      <button type="button" role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onSelect(); }}
        className={cx('flex w-full items-center text-left outline-none transition focus:bg-hover hover:bg-hover active:bg-hover disabled:opacity-40', sheet ? 'min-h-[52px] gap-4 rounded-2xl px-4 text-[17px]' : 'gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]', it.danger ? 'text-danger' : 'text-ink')}>
        {it.icon ? <Glyph name={it.icon} size={sheet ? 22 : 18} className={cx('shrink-0', it.danger ? '' : 'text-ink-2')} /> : null}
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
        {it.shortcut ? <kbd className="hidden font-sans text-xs text-ink-3 sm:block">{it.shortcut}</kbd> : null}
      </button>
    </div>
  ));
  if (sheet) return createPortal(
    <div className="anim-fade fixed inset-0 z-[60] flex items-end bg-(--scrim)" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="menu" aria-label={label} onKeyDown={onKey} data-sheet
        className="anim-sheet safe-b relative max-h-[82dvh] w-full overflow-y-auto overscroll-contain rounded-t-[20px] bg-raised px-2 pt-7 shadow-pop">
        <span aria-hidden="true" className="absolute top-2 left-1/2 h-[5px] w-10 -translate-x-1/2 rounded-full bg-line-strong" />
        <p className="truncate px-4 pb-2 text-[13px] font-medium text-ink-3" aria-hidden="true">{label}</p>
        {list}
        <div className="h-2" />
      </div>
    </div>, document.body);
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKey} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="glass anim-pop fixed z-[60] min-w-52 max-w-[calc(100vw-16px)] rounded-[12px] p-1">
      {list}
    </div>, document.body);
}

// --- toasts ---
interface Toast { id: number; text: string; tone: 'info' | 'ok' | 'error'; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(text: string, o?: { tone?: Toast['tone']; action?: Toast['action']; ms?: number }) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, o: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { id, text, tone: o.tone ?? 'info', action: o.action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), o.ms ?? (o.tone === 'error' ? 7000 : 4000));
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4" style={{ bottom: 'calc(var(--dock) + 14px)' }} aria-live="polite" aria-atomic="false">
        {toasts.map((x) => (
          <div key={x.id} role={x.tone === 'error' ? 'alert' : 'status'} className={cx('anim-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl py-3 pr-4 pl-3 text-sm font-medium shadow-pop', x.tone === 'error' ? 'bg-danger text-white dark:text-[#1a0508]' : 'bg-ink text-bg')}>
            <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', x.tone === 'ok' ? 'bg-ok text-white dark:text-black' : 'bg-white/15 dark:bg-black/10')}><Glyph name={x.tone === 'error' ? 'warning' : x.tone === 'ok' ? 'check' : 'info'} size={16} strokeWidth={2.2} /></span>
            <span className="min-w-0">{x.text}</span>
            {x.action ? <button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => { x.action!.run(); setToasts((ts) => ts.filter((y) => y.id !== x.id)); }}>{x.action.label}</button> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ConfirmDialog({ title, text, confirmLabel, danger, onConfirm, onClose }: { title: string; text: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { toast(errorText(e), { tone: 'error' }); setBusy(false); } };
  return (
    <Dialog title={title} onClose={onClose} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={run} data-autofocus>{confirmLabel}</Button></>}>
      <p className="text-[15px] leading-relaxed text-ink-2">{text}</p>
    </Dialog>
  );
}
/** Copy text; falls back to a selection-based copy where the async clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
/** A read-only value with a copy button (links shown once, recovery codes…). */
export function CopyField({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly aria-label={label} value={value} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, 'font-mono text-xs')} />
      <Button variant="primary" icon={done ? 'check' : 'copy'} onClick={async () => { if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1800); } }}>{done ? t('common.copied') : t('common.copy')}</Button>
    </div>
  );
}
export const isMobile = () => window.matchMedia('(max-width: 639px)').matches;
