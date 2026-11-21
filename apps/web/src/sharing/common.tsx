/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/sharing/common.tsx
 * Module           : sharing
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

// Pieces shared by the share-link and deposit-portal screens of the signed-in owner.
import QRCode from 'qrcode';
import { type ReactNode, useMemo, useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import { Button, CopyField, cx, Field } from '../ui.tsx';

export const inputCls = 'h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-base sm:text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-60';

/** QR code drawn as inline SVG (no data: URL, nothing fetched). Always dark on white so that cameras read it in dark mode too. */
export function QrCode({ text, size = 176, label }: { text: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    let path = '';
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.data[y * m.size + x]) path += `M${x} ${y}h1v1h-1z`;
    return { n: m.size, d: path };
  }, [text]);
  return <svg role="img" aria-label={label} width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} shapeRendering="crispEdges" className="rounded-xl" data-testid="qr"><rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#ffffff" /><path d={d} fill="#000000" /></svg>;
}

/** A link that the server returns once: copy it, hand it to the system share sheet, or scan it. */
export function LinkOnce({ url, title, qr }: { url: string; title: string; qr?: boolean }) {
  const t = useT();
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="space-y-3" data-testid="link-once">
      <CopyField value={url} label={t('sharing.link.label')} />
      <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-warn"><Glyph name="warning" size={18} className="mt-px shrink-0" /><span>{t('sharing.link.once')}</span></p>
      {qr ? <div className="flex flex-col items-center gap-2 rounded-2xl border border-line py-4"><QrCode text={url} label={t('sharing.link.qr')} /><p className="text-xs text-ink-3">{t('sharing.link.qrHint')}</p></div> : null}
      {canShare ? <Button icon="share" className="w-full" onClick={() => void navigator.share({ title, url }).catch(() => {})}>{t('sharing.link.native')}</Button> : null}
    </div>
  );
}

/** "iPhone · Safari" from a User-Agent header. */
export function uaSummary(ua: string, unknown: string): string {
  if (!ua) return unknown;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|wget|python|node|bot/i.test(ua) ? ua.split(/[ /]/)[0]! : '';
  return [device, browser].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

/** <input type="datetime-local"> value ↔ ISO instant, in the browser's time zone. */
export const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string): string | null => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

export type ExpiryChoice = 'never' | '1' | '7' | '30' | 'date';
/** Expiry as quick choices or a precise date. `resolve` turns the pair into the ISO instant sent to the API. */
export const resolveExpiry = (choice: ExpiryChoice, date: string): string | null =>
  choice === 'never' ? null : choice === 'date' ? fromLocalInput(date) : new Date(Date.now() + Number(choice) * 86_400_000).toISOString();
export function ExpiryField({ choice, date, onChange, error }: { choice: ExpiryChoice; date: string; onChange: (c: ExpiryChoice, d: string) => void; error?: string | null }) {
  const t = useT();
  const opts: ExpiryChoice[] = ['never', '1', '7', '30', 'date'];
  return (
    <Field label={t('sharing.expiry.label')} error={error}>{(id, desc) => (
      <div className="space-y-2">
        <div role="radiogroup" aria-labelledby={undefined} aria-label={t('sharing.expiry.label')} className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={choice === o} onClick={() => onChange(o, o === 'date' && !date ? toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()) : date)}
              className={cx('h-9 rounded-full border px-3 text-sm transition', choice === o ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-strong text-ink-2 hover:bg-hover')}>{t(`sharing.expiry.${o}`)}</button>
          ))}
        </div>
        {choice === 'date' ? <input id={id} aria-describedby={desc} type="datetime-local" value={date} onChange={(e) => onChange('date', e.target.value)} className={inputCls} /> : <input id={id} type="hidden" />}
      </div>
    )}</Field>
  );
}

/** Titled block of a long form. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full"><span className="block text-sm font-semibold text-ink">{title}</span>{hint ? <span className="mt-0.5 block text-xs text-ink-3">{hint}</span> : null}</legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}
/** Number input bound to a string state (empty allowed = "no limit"). */
export function NumberField({ label, hint, value, onChange, min = 1, max, step, placeholder, error, suffix }: { label: string; hint?: string; value: string; onChange: (v: string) => void; min?: number; max?: number; step?: number | 'any'; placeholder?: string; error?: string | null; suffix?: string }) {
  return (
    <Field label={label} hint={hint} error={error}>{(id, d) => (
      <div className="relative">
        <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} type="number" inputMode={step === 'any' ? 'decimal' : 'numeric'} min={min} max={max} step={step} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, suffix && 'pr-12')} />
        {suffix ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3">{suffix}</span> : null}
      </div>
    )}</Field>
  );
}
export function useFlag(initial = false): [boolean, () => void, () => void] { const [v, set] = useState(initial); return [v, () => set(true), () => set(false)]; }
