// Pieces shared by the shell and the account screens (sign-in, invitation, recovery, settings, administration).
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { useLocation } from 'wouter';
import { patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { getLocale, type Locale, setLocale, useT } from '../i18n.ts';
import { AUTH_KEY, PasskeyCancelled, withFreshAuth } from '../session.ts';
import { setTheme, useTheme } from '../theme.ts';
import type { AuthState } from '../types.ts';
import { Button, copyText, cx, IconButton, useToast } from '../ui.tsx';

/** The SP Drive mark (same drawing as public/pwa/favicon.svg). */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="shrink-0">
      <rect width="64" height="64" rx="14" fill="#2456e6" />
      <path d="M14 24a4 4 0 0 1 4-4h9l4 4h15a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="#fff" />
      <path d="M26 37l5 5 9-10" fill="none" stroke="#2456e6" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Sign out, forget every cached answer of this account, and show the sign-in page. */
export function useSignOut(): () => Promise<void> {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  return async () => {
    await post('/auth/logout').catch(() => undefined); // offline or already expired: the local state is cleared anyway
    qc.setQueryData<AuthState>(AUTH_KEY, { authenticated: false });
    navigate('/login', { replace: true });
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] });
  };
}
/** Change the interface language now, and remember it on the account when signed in. */
export function changeLocale(l: Locale, signedIn: boolean): void {
  setLocale(l);
  if (signedIn) void patch('/account', { locale: l }).catch(() => undefined);
}
export const otherLocale = (): Locale => (getLocale() === 'fr' ? 'en' : 'fr');

export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { dark } = useTheme();
  return <IconButton icon={dark ? 'sun' : 'moon'} label={dark ? t('account.theme.toLight') : t('account.theme.toDark')} onClick={() => setTheme(dark ? 'light' : 'dark')} className={className} />;
}
export function LanguageToggle({ signedIn = false }: { signedIn?: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={() => changeLocale(otherLocale(), signedIn)} aria-label={t('account.lang.switchTo')} title={t('account.lang.switchTo')}
      className="inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-2 transition hover:bg-hover hover:text-ink">
      <Glyph name="globe" size={18} /><span aria-hidden="true">{otherLocale().toUpperCase()}</span>
    </button>
  );
}

/** Frame of the signed-out pages: one calm card, centred, with the mark and the language / theme switches. */
export function AuthFrame({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const t = useT();
  return (
    <div className="safe-t safe-b flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5"><Mark size={28} /><span className="text-sm font-semibold tracking-tight text-ink">{t('common.appName')}</span></div>
        <div className="flex items-center gap-1"><LanguageToggle /><ThemeToggle /></div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-10 sm:items-center sm:pt-0">
        <div className={cx('w-full', wide ? 'max-w-lg' : 'max-w-md')}>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm leading-relaxed text-ink-2">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? <div className="mt-5 text-center text-sm text-ink-2">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
/** Inline error, announced to assistive technology. */
export function Alert({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'warn' | 'info' }) {
  const c = { danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn', info: 'bg-accent-soft text-accent' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm leading-snug', c)}>
      <Glyph name={tone === 'info' ? 'info' : 'warning'} size={18} className="mt-px shrink-0" /><div className="min-w-0">{children}</div>
    </div>
  );
}
export const linkCls = 'font-medium text-accent underline-offset-2 hover:underline';

// --- recovery codes: shown once, to keep outside the device ---
function printCodes(title: string, lines: string[]): void {
  // A print-only block next to #root: nothing else of the page is printed, and no new window or frame is needed.
  const box = document.createElement('div'); box.id = 'spd-print';
  const h = document.createElement('h1'); h.textContent = title; box.appendChild(h);
  const pre = document.createElement('pre'); pre.textContent = lines.join('\n'); box.appendChild(pre);
  const style = document.createElement('style');
  style.textContent = '@media screen{#spd-print{display:none}}@media print{body>*:not(#spd-print){display:none!important}#spd-print{display:block;padding:24px;color:#000;background:#fff;font-family:ui-monospace,Menlo,monospace}#spd-print h1{font:600 16px system-ui,sans-serif;margin:0 0 16px}#spd-print pre{font-size:15px;line-height:1.9;margin:0}}';
  document.head.appendChild(style); document.body.appendChild(box);
  const clean = () => { box.remove(); style.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  window.print();
  setTimeout(clean, 60_000); // some browsers never fire afterprint
}
export function RecoveryCodes({ codes, email }: { codes: string[]; email?: string }) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const header = `${t('account.codes.fileTitle')}${email ? ` — ${email}` : ''}`;
  const text = [header, new Date().toISOString().slice(0, 10), '', ...codes, '', t('account.codes.fileNote'), ''].join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'sp-drive-codes-recuperation.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label={t('account.codes.listLabel')} data-testid="recovery-codes" className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-line bg-bg px-4 py-3 font-mono text-[13px] text-ink sm:grid-cols-2">
        {codes.map((c, i) => <li key={c} className="flex items-center gap-2 whitespace-nowrap"><span className="w-5 text-right text-xs text-ink-3" aria-hidden="true">{i + 1}</span><span className="select-all tracking-wide">{c}</span></li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button icon={copied ? 'check' : 'copy'} onClick={async () => { if (await copyText(codes.join('\n'))) { setCopied(true); setTimeout(() => setCopied(false), 1800); } else toast(t('account.codes.copyFailed'), { tone: 'error' }); }}>{copied ? t('common.copied') : t('common.copy')}</Button>
        <Button icon="download" onClick={download}>{t('account.codes.download')}</Button>
        <Button icon="print" onClick={() => printCodes(header, codes)}>{t('account.codes.print')}</Button>
      </div>
    </div>
  );
}
/** The codes, an explanation, and a box to tick before going on: there is no second chance to see them. */
export function RecoveryCodesStep({ codes, email, onDone, doneLabel }: { codes: string[]; email?: string; onDone: () => void; doneLabel: string }) {
  const t = useT();
  const id = useId();
  const [kept, setKept] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warn">{t('account.codes.once')}</Alert>
      <RecoveryCodes codes={codes} email={email} />
      <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
        <input id={id} type="checkbox" checked={kept} onChange={(e) => setKept(e.currentTarget.checked)} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
        {t('account.codes.kept')}
      </label>
      <Button variant="primary" size="lg" disabled={!kept} onClick={onDone} className="w-full">{doneLabel}</Button>
    </div>
  );
}

/** "Chrome · macOS" from a user-agent string; the raw string when nothing is recognised. */
export function summariseUA(ua: string, unknown: string): { text: string; icon: 'device' | 'laptop' } {
  if (!ua) return { text: unknown, icon: 'laptop' };
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl\//.test(ua) ? 'curl' : '';
  const text = [browser, os].filter(Boolean).join(' · ');
  return { text: text || ua.slice(0, 60), icon: /iPhone|Android.*Mobile/.test(ua) ? 'device' : 'laptop' };
}

/** A titled block of a settings or administration page. */
export function Section({ title, text, action, children }: { title: string; text?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0 flex-1 basis-56"><h2 className="text-base font-semibold text-ink">{title}</h2>{text ? <p className="mt-1 text-sm leading-relaxed text-ink-2">{text}</p> : null}</div>
        {action}
      </header>
      <div className="px-4 pt-3 pb-4 sm:px-5">{children}</div>
    </section>
  );
}
/** Page frame inside the shell: a title, an optional line of text, and the content at a comfortable width. */
export function Page({ title, text, children, wide }: { title: string; text?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('mx-auto flex w-full flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7', wide ? 'max-w-6xl' : 'max-w-3xl')}>
      <div><h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>{text ? <p className="mt-1 text-sm text-ink-2">{text}</p> : null}</div>
      {children}
    </div>
  );
}

/** A sensitive call: re-authenticate when the server asks; a dismissed passkey sheet becomes a plain readable error. */
export async function sensitive<T>(fn: () => Promise<T>, cancelledText: string): Promise<T> {
  try { return await withFreshAuth(fn); } catch (e) {
    if (e instanceof PasskeyCancelled) throw new Error(cancelledText);
    throw e;
  }
}
