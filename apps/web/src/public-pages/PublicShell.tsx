// Frame of the anonymous pages: follows the system colour scheme (never the saved application theme), offers the
// language switch, and carries no link into the application.
import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useLayoutEffect } from 'react';
import { Glyph } from '../glyphs.tsx';
import { getLocale, setLocale, useT } from '../i18n.ts';
import { cx } from '../ui.tsx';

function useSystemTheme(): void {
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply); // registered after the application's own listener, so this one has the last word
    return () => media.removeEventListener('change', apply);
  }, []);
}

export function PublicShell({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const t = useT();
  useSystemTheme();
  useEffect(() => { document.title = title; }, [title]);
  const pad = { paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' };
  return (
    <div className="flex min-h-full flex-col bg-bg text-ink">
      <div className="safe-t" />
      <div className={cx('mx-auto flex w-full justify-end pt-3', wide ? 'max-w-5xl' : 'max-w-xl')} style={pad}>
        <div role="group" aria-label={t('public.language')} className="inline-flex overflow-hidden rounded-lg border border-line bg-surface text-xs font-semibold">
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={getLocale() === l} onClick={() => setLocale(l)} aria-label={l === 'fr' ? 'Français' : 'English'}
              className={cx('h-9 min-w-11 px-3 uppercase transition', getLocale() === l ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-hover')}>{l}</button>
          ))}
        </div>
      </div>
      <main className={cx('mx-auto w-full flex-1 py-4 sm:py-6', wide ? 'max-w-5xl' : 'max-w-xl')} style={pad}>{children}</main>
      <footer className="safe-b px-4 pt-2 text-center text-xs text-ink-3"><p className="pb-5">{t('common.appName')}</p></footer>
    </div>
  );
}

/** A neutral full-card message (link unavailable, portal closed…). */
export function Notice({ icon, title, text, action, tone = 'neutral' }: { icon: string; title: string; text?: string; action?: ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <section className="rounded-2xl border border-line bg-surface px-6 py-12 text-center" data-testid="notice">
      <div className={cx('mx-auto flex h-14 w-14 items-center justify-center rounded-2xl', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-hover text-ink-2')}><Glyph name={icon} size={28} /></div>
      <h1 className="mt-4 text-lg font-semibold text-ink">{title}</h1>
      {text ? <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{text}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}

/** 16 px inputs (no zoom on iOS), 48 px tall, error tied to the field and announced. */
export const pInput = 'h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60';
export function PField({ label, error, hint, optional, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string; optional?: string }) {
  const id = useId();
  const desc = error || hint ? `${id}-d` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}{p.required ? <span aria-hidden="true" className="text-danger"> *</span> : optional ? <span className="font-normal text-ink-3"> · {optional}</span> : null}</label>
      <input id={id} aria-describedby={desc} aria-invalid={!!error || undefined} {...p} className={cx(pInput, error && 'border-danger')} />
      {error ? <p id={desc} role="alert" className="text-sm text-danger">{error}</p> : hint ? <p id={desc} className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}
