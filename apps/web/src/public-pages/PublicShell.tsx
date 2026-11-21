/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/public-pages/PublicShell.tsx
 * Module           : public-pages
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
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

// Frame of the anonymous pages: follows the system colour scheme (never the saved application theme), offers the
// language switch, and carries no link into the application.
import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useLayoutEffect } from 'react';
import { Art } from '../art.tsx';
import { paintChrome } from '../theme.ts';
import { getLocale, setLocale, useT } from '../i18n.ts';
import { cx } from '../ui.tsx';

function useSystemTheme(): void {
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.classList.toggle('dark', media.matches); paintChrome(media.matches); };
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
    <div className="aurora flex min-h-full flex-col bg-bg text-ink">
      <div className="safe-t" />
      <div className={cx('mx-auto flex w-full items-center justify-between pt-3', wide ? 'max-w-5xl' : 'max-w-xl')} style={pad}>
        <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight" aria-hidden="true"><PublicMark />{t('common.appName')}</span>
        <div role="group" aria-label={t('public.language')} className="glass inline-flex overflow-hidden rounded-full p-0.5 text-xs font-bold">
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={getLocale() === l} onClick={() => setLocale(l)} aria-label={l === 'fr' ? 'Français' : 'English'}
              className={cx('h-9 min-w-11 rounded-full px-3 uppercase transition', getLocale() === l ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-hover')}>{l}</button>
          ))}
        </div>
      </div>
      <main className={cx('anim-rise mx-auto w-full flex-1 py-5 sm:py-8', wide ? 'max-w-5xl' : 'max-w-xl')} style={pad}>{children}</main>
      <footer className="safe-b pt-2"><div className="h-5" /></footer>
    </div>
  );
}
function PublicMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs><linearGradient id="spd-pm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f46e5" /><stop offset="1" stopColor="#9b3dea" /></linearGradient></defs>
      <rect width="64" height="64" rx="15" fill="url(#spd-pm)" />
      <path d="M14 30v-7a4 4 0 0 1 4-4h8.3a3 3 0 0 1 2.1.9L31.5 23H46a4 4 0 0 1 4 4v3z" fill="#fff" fillOpacity=".55" />
      <rect x="14" y="27" width="36" height="21" rx="5" fill="#fff" />
      <path d="M25.5 37.5l4.5 4.500 8.500-9" fill="none" stroke="#5b3fe6" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A neutral full-card message (link unavailable, portal closed…). */
export function Notice({ icon, title, text, action, tone = 'neutral' }: { icon: string; title: string; text?: string; action?: ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <section className="card flex flex-col items-center px-6 py-12 text-center" data-testid="notice">
      <Art name={icon} tone={tone === 'warn' ? 'warn' : 'neutral'} />
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">{title}</h1>
      {text ? <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-2">{text}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </section>
  );
}

/** 16 px inputs (no zoom on iOS), 48 px tall, error tied to the field and announced. */
export const pInput = 'h-[52px] w-full rounded-2xl border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-60';
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
