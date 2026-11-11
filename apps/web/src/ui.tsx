// Small accessible building blocks shared by every screen. No external UI library.
import { type ButtonHTMLAttributes, createContext, type InputHTMLAttributes, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Glyph } from './glyphs.tsx';
import { errorText, useT } from './i18n.ts';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// --- buttons ---
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110',
};
export function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean; icon?: string }) {
  return (
    <button type="button" {...p} disabled={p.disabled || busy} aria-busy={busy || undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition select-none disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-5 text-base' : 'h-10 px-4 text-sm', VARIANT[variant], className)}>
      {busy ? <Spinner size={16} /> : icon ? <Glyph name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}
export function IconButton({ icon, label, className, size = 20, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; size?: number; active?: boolean }) {
  return (
    <button type="button" {...p} aria-label={label} title={label} aria-pressed={active}
      className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-40 disabled:pointer-events-none', active && 'bg-accent-soft text-accent', className)}>
      <Glyph name={icon} size={size} />
    </button>
  );
}
export function Spinner({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" role="status" aria-label="…"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

// --- form fields ---
const inputCls = 'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60';
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
  return <Field label={label} hint={hint}>{(id, d) => <textarea id={id} aria-describedby={d} rows={rows} {...p} className={cx(inputCls, 'h-auto py-2 leading-relaxed')} />}</Field>;
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
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'; children: ReactNode }) {
  const c = { neutral: 'bg-hover text-ink-2', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', accent: 'bg-accent-soft text-accent' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', c)}>{children}</span>;
}
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${v * 100}%` }} /></div>;
}
export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Glyph name={icon} size={28} /></div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {text ? <p className="max-w-sm text-sm text-ink-2">{text}</p> : null}
      {action}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return <EmptyState icon="warning" title={errorText(error)} action={onRetry ? <Button onClick={onRetry} icon="refresh">{t('common.retry')}</Button> : undefined} />;
}
export function Loading({ label }: { label?: string }) {
  const t = useT();
  return <div className="flex items-center justify-center gap-3 py-16 text-ink-3"><Spinner /><span className="text-sm">{label ?? t('common.loading')}</span></div>;
}

// --- dialog: modal on desktop, bottom sheet on phones; focus is trapped and restored, Escape closes ---
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Dialog({ title, onClose, children, footer, wide, dismissable = true }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissable?: boolean }) {
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
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab') return;
    const f = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKey}
        className={cx('anim-pop safe-b flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-raised shadow-pop outline-none sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold">{title}</h2>
          {dismissable ? <IconButton icon="x" label={t('common.close')} onClick={onClose} className="-mr-2" /> : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer> : null}
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
    el.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus();
  }, [anchor]);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', close); window.addEventListener('scroll', onClose, true); window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('scroll', onClose, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); } else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
  };
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKey} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="anim-pop fixed z-[60] min-w-52 max-w-[calc(100vw-16px)] rounded-xl border border-line bg-raised p-1 shadow-pop">
      {items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore ? <div className="my-1 h-px bg-line" role="separator" /> : null}
          <button type="button" role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onSelect(); }}
            className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none transition focus:bg-hover hover:bg-hover disabled:opacity-40', it.danger ? 'text-danger' : 'text-ink')}>
            {it.icon ? <Glyph name={it.icon} size={18} className="shrink-0 opacity-80" /> : null}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.shortcut ? <kbd className="hidden text-xs text-ink-3 sm:block">{it.shortcut}</kbd> : null}
          </button>
        </div>
      ))}
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
      <div className="safe-b pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4" aria-live="polite" aria-atomic="false">
        {toasts.map((x) => (
          <div key={x.id} role={x.tone === 'error' ? 'alert' : 'status'} className={cx('anim-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-pop', x.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-bg')}>
            <Glyph name={x.tone === 'error' ? 'warning' : x.tone === 'ok' ? 'check' : 'info'} size={18} className="shrink-0" />
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
      <p className="text-sm leading-relaxed text-ink-2">{text}</p>
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
