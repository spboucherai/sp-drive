// Administrators only: the infrastructure behind the drive, from the extended GET /admin/system — the job worker, the
// queue by kind, preview failures, the document converter and the text helper, antivirus signatures, the content
// index, live streams and the backups. Read-only: this view controls nothing.
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { Section } from '../shell/account-ui.tsx';
import { cx, ErrorState, Loading } from '../ui.tsx';

interface BackupPart { ok?: boolean; at?: string; ageS?: number; error?: string; durationS?: number; dump?: string; dumpBytes?: number; dumpsKept?: number; blobs?: number; blobBytes?: number; objects?: number; files?: number; host?: string; sampled?: number; mismatched?: number; missing?: number; errors?: string[] }
interface Infra {
  version?: string; features?: string[];
  worker?: { alive: boolean; heartbeatAgeS: number | null; pid: number | null };
  jobs?: { kind: string; status: string; count: number; oldestAgeS: number | null }[];
  previewFailures?: { kind: string; count: number; lastError: string }[];
  converter?: { available: boolean | null; path?: string | null }; textkit?: { available: boolean | null; contextual?: boolean | null };
  antivirusSignatures?: { engine: string; signatures: number; signaturesAt: string; ageS: number } | null;
  index?: { enabled: boolean; ocr: boolean; byStatus: Record<string, number>; semantic: { available: boolean; model: string | null; dim?: number } };
  events?: { owners: number; streams: number; timers: number };
  backup?: { dir: string; last: BackupPart | null; restoreTest: BackupPart | null; verify: BackupPart | null; offNode: BackupPart | null };
}
type Tone = 'ok' | 'warn' | 'danger' | 'none';
const DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', none: 'bg-line-strong' };
const ICON: Record<Tone, string> = { ok: 'check', warn: 'warning', danger: 'warning', none: 'info' };

function Tile({ icon, label, tone, value, detail, testId }: { icon: string; label: string; tone: Tone; value: ReactNode; detail?: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-[12px] px-3.5 py-3 shadow-(--spd-elevation-e0)" data-testid={testId} data-tone={tone}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-2"><Glyph name={icon} size={16} /></span>
      <div className="min-w-0 flex-1">
        <dt className="spd-eyebrow">{label}</dt>
        <dd className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-ink"><span className={cx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-white dark:text-black', DOT[tone])} aria-hidden="true">{tone !== 'none' ? <Glyph name={ICON[tone]} size={9} strokeWidth={3} /> : null}</span><span className="min-w-0 truncate">{value}</span></dd>
        {detail ? <dd className="mt-0.5 text-xs leading-snug break-words text-ink-3">{detail}</dd> : null}
      </div>
    </div>
  );
}

export function InfrastructureCard() {
  const t = useT();
  const l = getLocale();
  const q = useQuery({ queryKey: ['admin', 'system'], queryFn: () => get<Infra>('/admin/system'), refetchInterval: 30_000 });
  const s = q.data;
  const num = (v: number) => new Intl.NumberFormat(l).format(v);
  const age = (sec: number | null | undefined) => (sec == null ? '—' : sec < 90 ? t('next.infra.ageS', { n: Math.round(sec) }) : sec < 5400 ? t('next.infra.ageM', { n: Math.round(sec / 60) }) : sec < 172800 ? t('next.infra.ageH', { n: Math.round(sec / 3600) }) : t('next.infra.ageD', { n: Math.round(sec / 86400) }));
  const tri = (v: boolean | null | undefined): Tone => (v == null ? 'none' : v ? 'ok' : 'danger');
  const word = (v: boolean | null | undefined) => (v == null ? t('next.infra.unknown') : v ? t('next.infra.available') : t('next.infra.unavailable'));
  if (q.isLoading) return <Section title={t('next.infra.title')}><Loading /></Section>;
  if (q.error || !s) return <Section title={t('next.infra.title')}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Section>;
  if (!s.worker) return null; // a 1.0 server: nothing more to show
  const b = s.backup;
  const part = (p: BackupPart | null | undefined, staleS: number): Tone => (!p ? 'none' : p.ok === false ? 'danger' : (p.ageS ?? 0) > staleS ? 'warn' : 'ok');
  const jobs = [...(s.jobs ?? [])].sort((a, c) => a.kind.localeCompare(c.kind) || a.status.localeCompare(c.status));
  const jobTone = (st: string): string => (st === 'failed' || st === 'dead' ? 'text-danger' : st === 'queued' || st === 'running' ? 'text-accent' : 'text-ink-2');
  return (
    <Section title={t('next.infra.title')} text={t('next.infra.text', { version: s.version ?? '—' })}>
      <div className="flex flex-col gap-5" data-testid="infrastructure">
        <dl className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Tile testId="infra-worker" icon="bolt" label={t('next.infra.worker')} tone={s.worker.alive ? 'ok' : 'danger'} value={s.worker.alive ? t('next.infra.alive') : t('next.infra.silent')} detail={`${t('next.infra.heartbeat', { age: age(s.worker.heartbeatAgeS) })}${s.worker.pid ? ` · PID ${s.worker.pid}` : ''}`} />
          <Tile icon="doc" label={t('next.infra.converter')} tone={tri(s.converter?.available)} value={word(s.converter?.available)} detail={s.converter?.path ?? undefined} />
          <Tile icon="text" label={t('next.infra.textkit')} tone={tri(s.textkit?.available)} value={word(s.textkit?.available)} detail={s.textkit?.available ? (s.textkit.contextual ? t('next.infra.contextualOn') : t('next.infra.contextualOff')) : undefined} />
          <Tile icon="shield" label={t('next.infra.signatures')} tone={!s.antivirusSignatures ? 'none' : s.antivirusSignatures.ageS > 7 * 86400 ? 'warn' : 'ok'} value={s.antivirusSignatures ? t('next.infra.sigAge', { age: age(s.antivirusSignatures.ageS) }) : t('next.infra.unknown')} detail={s.antivirusSignatures ? `ClamAV ${s.antivirusSignatures.engine} · ${num(s.antivirusSignatures.signatures)}` : t('next.infra.sigNone')} />
          <Tile testId="infra-index" icon="search" label={t('next.infra.index')} tone={s.index?.enabled ? 'ok' : 'none'} value={s.index?.enabled ? t('next.infra.indexOn') : t('next.infra.indexOff')}
            detail={s.index ? `${Object.entries(s.index.byStatus).map(([k, v]) => `${t(`next.text.${k}`) === `next.text.${k}` ? k : t(`next.text.${k}`)} ${num(v)}`).join(' · ') || '—'} · OCR ${s.index.ocr ? '✓' : '—'} · ${s.index.semantic.available ? `${s.index.semantic.model}` : t('next.infra.noSemantic')}` : undefined} />
          <Tile icon="activity" label={t('next.infra.events')} tone="none" value={t('next.infra.streams', { n: s.events?.streams ?? 0 })} detail={t('next.infra.owners', { n: s.events?.owners ?? 0 })} />
        </dl>

        <section aria-label={t('next.infra.backups')}>
          <h3 className="spd-eyebrow mb-2">{t('next.infra.backups')}</h3>
          <dl className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="infra-backup">
            <Tile icon="database" label={t('next.infra.bLast')} tone={part(b?.last, 36 * 3600)} value={b?.last ? (b.last.ok === false ? t('next.infra.bFailed') : age(b.last.ageS)) : t('next.infra.never')} detail={b?.last ? (b.last.error ?? `${b.last.dumpBytes != null ? formatBytes(b.last.dumpBytes, l) : ''}${b.last.blobs != null ? ` · ${t('next.infra.blobs', { n: b.last.blobs })}` : ''}${b.last.dumpsKept != null ? ` · ${t('next.infra.kept', { n: b.last.dumpsKept })}` : ''}`) : t('next.infra.bNone')} />
            <Tile icon="restore" label={t('next.infra.bRestore')} tone={part(b?.restoreTest, 14 * 86400)} value={b?.restoreTest ? (b.restoreTest.ok === false ? t('next.infra.bFailed') : age(b.restoreTest.ageS)) : t('next.infra.never')} detail={b?.restoreTest?.error ?? (b?.restoreTest ? t('next.infra.restored', { n: b.restoreTest.files ?? 0 }) : undefined)} />
            <Tile icon="check" label={t('next.infra.bVerify')} tone={part(b?.verify, 7 * 86400)} value={b?.verify ? (b.verify.ok === false ? t('next.infra.bFailed') : age(b.verify.ageS)) : t('next.infra.never')} detail={b?.verify ? (b.verify.errors?.length ? b.verify.errors.join(' · ') : t('next.infra.sampled', { n: b.verify.sampled ?? 0, bad: (b.verify.mismatched ?? 0) + (b.verify.missing ?? 0) })) : undefined} />
            <Tile icon="cloud" label={t('next.infra.bOff')} tone={part(b?.offNode, 3 * 86400)} value={b?.offNode ? (b.offNode.ok === false ? t('next.infra.bFailed') : age(b.offNode.ageS)) : t('next.infra.never')} detail={b?.offNode ? b.offNode.host : t('next.infra.bOffNone')} />
          </dl>
          {b?.last?.at ? <p className="mt-1.5 text-xs text-ink-3">{t('next.infra.bDir', { dir: b.dir, date: fmtDate(b.last.at) })}</p> : b ? <p className="mt-1.5 text-xs text-ink-3">{b.dir}</p> : null}
        </section>

        <section aria-label={t('next.infra.jobs')}>
          <h3 className="spd-eyebrow mb-2">{t('next.infra.jobs')}</h3>
          {jobs.length ? (
            <div className="overflow-x-auto rounded-[12px] shadow-(--spd-elevation-e0)">
              <table className="w-full text-left text-[13px]" data-testid="infra-jobs">
                <thead><tr className="border-b border-line text-ink-3"><th className="px-3 py-2 font-medium">{t('next.infra.jKind')}</th><th className="px-3 py-2 font-medium">{t('next.infra.jStatus')}</th><th className="px-3 py-2 text-right font-medium">{t('next.infra.jCount')}</th><th className="px-3 py-2 text-right font-medium">{t('next.infra.jOldest')}</th></tr></thead>
                <tbody className="divide-y divide-line">{jobs.map((j) => <tr key={`${j.kind}:${j.status}`}><td className="spd-mono px-3 py-1.5 text-ink">{j.kind}</td><td className={cx('px-3 py-1.5', jobTone(j.status))}>{j.status}</td><td className="px-3 py-1.5 text-right text-ink tabular-nums">{num(j.count)}</td><td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{j.oldestAgeS == null ? '—' : age(j.oldestAgeS)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="text-[13px] text-ink-3">{t('next.infra.jNone')}</p>}
          {s.previewFailures?.length ? <ul className="mt-3 flex flex-col gap-1.5" data-testid="infra-failures">{s.previewFailures.map((f) => <li key={f.kind} className="flex items-start gap-2 rounded-[10px] bg-warn-soft px-3 py-2 text-xs text-warn"><Glyph name="warning" size={14} className="mt-px shrink-0" /><span><span className="font-medium">{t('next.infra.pfail', { n: f.count, kind: f.kind })}</span> — {f.lastError}</span></li>)}</ul> : null}
        </section>
      </div>
    </Section>
  );
}
