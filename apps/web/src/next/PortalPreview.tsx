// Live preview of a deposit portal while it is being built: the page a depositor will see, drawn from the values of
// the form (nothing is saved or sent). It is a picture of the settings, not a working page: the whole frame is inert.
import { formatBytes } from '@spd/shared';
import { useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { cx } from '../ui.tsx';

export interface PortalDraft {
  title: string; description: string; instructions: string; brandName: string; brandColor: string; ink: string; hasPassword: boolean; expiresAt: string | null; active: boolean;
  maxFileBytes: number; maxFiles: number; extensions: string[]; name: 'off' | 'optional' | 'required'; email: 'off' | 'optional' | 'required'; reference: 'off' | 'optional' | 'required';
  custom: { label: string; required: boolean }[]; requireConsent: boolean; consentText: string; retentionNote: string; confirmation: string; notify: boolean; folderName: string;
}

export function PortalPreview({ d }: { d: PortalDraft }) {
  const t = useT();
  const [step, setStep] = useState<'form' | 'done'>('form');
  const field = (label: string, mode: 'optional' | 'required', key: string) => (
    <div key={key}><p className="text-[11px] font-medium text-ink">{label}{mode === 'optional' ? <span className="font-normal text-ink-3"> · {t('next.pp.optional')}</span> : null}</p><div className="mt-1 h-8 rounded-lg border border-line-strong bg-surface" /></div>
  );
  const fields = [
    d.name !== 'off' ? field(t('sharing.portal.field.name'), d.name, 'name') : null, d.email !== 'off' ? field(t('sharing.portal.field.email'), d.email, 'email') : null, d.reference !== 'off' ? field(t('sharing.portal.field.reference'), d.reference, 'ref') : null,
    ...d.custom.filter((c) => c.label.trim()).map((c, i) => field(c.label, c.required ? 'required' : 'optional', `c${i}`)),
  ].filter(Boolean);
  return (
    <section aria-label={t('next.pp.title')} data-testid="portal-preview" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="spd-eyebrow">{t('next.pp.title')}</h3>
        <div role="tablist" aria-label={t('next.pp.title')} className="flex gap-0.5 rounded-lg bg-well p-0.5">
          {(['form', 'done'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={step === k} onClick={() => setStep(k)} className={cx('h-7 rounded-md px-2 text-xs transition-colors', step === k ? 'bg-surface font-medium text-ink shadow-(--shadow-card)' : 'text-ink-2')}>{t(`next.pp.${k}`)}</button>)}
        </div>
      </div>
      <div {...{ inert: true }} aria-hidden="true" className="overflow-hidden rounded-[20px] border border-line-strong bg-canvas shadow-(--spd-elevation-e1) select-none" data-step={step}>
        <div className="px-4 pt-5 pb-4" style={{ background: d.brandColor, color: d.ink }}>
          {d.brandName ? <p className="text-[11px] font-semibold opacity-90" data-testid="pp-brand">{d.brandName}</p> : null}
          <p className="spd-display text-[19px] leading-tight break-words" data-testid="pp-title">{d.title || t('sharing.portal.titlePh')}</p>
          {d.description ? <p className="mt-1 text-xs leading-snug break-words opacity-95">{d.description}</p> : null}
        </div>
        {step === 'form' ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            {!d.active ? <p className="rounded-lg bg-warn-soft px-2.5 py-1.5 text-[11px] text-warn" data-testid="pp-paused">{t('next.pp.paused')}</p> : null}
            {d.hasPassword ? <p className="flex items-center gap-1.5 rounded-lg bg-hover px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="pp-password"><Glyph name="lock" size={12} />{t('next.pp.password')}</p> : null}
            {d.instructions ? <p className="text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-2">{d.instructions}</p> : null}
            <ul className="flex flex-col gap-1 text-[11px] text-ink-2" data-testid="pp-rules">
              <li className="flex items-start gap-1.5"><Glyph name="file" size={12} className="mt-px shrink-0 text-ink-3" />{d.extensions.length ? t('next.pp.types', { list: d.extensions.map((x) => `.${x}`).join(' ') }) : t('next.pp.anyType')}</li>
              <li className="flex items-start gap-1.5"><Glyph name="layers" size={12} className="mt-px shrink-0 text-ink-3" />{t('next.pp.limits', { n: d.maxFiles, size: formatBytes(d.maxFileBytes, getLocale()) })}</li>
              {d.expiresAt ? <li className="flex items-start gap-1.5"><Glyph name="clock" size={12} className="mt-px shrink-0 text-ink-3" />{t('next.pp.until', { date: fmtDate(d.expiresAt) })}</li> : null}
            </ul>
            <div className="flex flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed border-line-strong px-3 py-5 text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: d.brandColor, color: d.ink }}><Glyph name="upload" size={15} /></span>
              <p className="text-xs font-medium text-ink">{t('next.pp.drop')}</p>
            </div>
            {fields.length ? <div className="flex flex-col gap-2" data-testid="pp-fields">{fields}</div> : null}
            {d.requireConsent ? <p className="flex items-start gap-2 text-[11px] leading-snug text-ink-2" data-testid="pp-consent"><span className="mt-px h-3.5 w-3.5 shrink-0 rounded border border-line-strong" /><span className="break-words">{d.consentText || t('next.pp.consentDefault')}</span></p> : null}
            {d.retentionNote ? <p className="text-[11px] leading-snug break-words text-ink-3">{d.retentionNote}</p> : null}
            <div className="flex h-9 items-center justify-center rounded-[10px] text-xs font-semibold" style={{ background: d.brandColor, color: d.ink }}>{t('next.pp.send')}</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center" data-testid="pp-done">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ok-soft text-ok"><Glyph name="check" size={18} strokeWidth={2.2} /></span>
            <p className="spd-display text-[17px] text-ink">{t('next.pp.received')}</p>
            <p className="text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-2">{d.confirmation || t('next.pp.confirmationDefault')}</p>
            <p className="spd-mono rounded-md bg-hover px-2 py-1 text-ink-2">{t('next.pp.ref')}</p>
          </div>
        )}
      </div>
      <p className="text-[11px] leading-snug text-ink-3">{t('next.pp.note', { folder: d.folderName })}{d.notify ? ` ${t('next.pp.notify')}` : ''}</p>
    </section>
  );
}
