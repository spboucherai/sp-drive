/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/screens/RequestDetail.tsx
 * Module           : screens
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

// One deposit portal: its settings in short, and every deposit received with its journal.
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { uaSummary } from '../sharing/common.tsx';
import { PortalActions, PortalState, REJECT_CODES } from '../sharing/PortalParts.tsx';
import type { Crumb, Portal, Submission, SubmissionDetail } from '../types.ts';
import { Badge, Button, Dialog, EmptyState, ErrorState, Loading } from '../ui.tsx';

const SUB_TONE: Record<Submission['status'], 'ok' | 'danger' | 'warn' | 'neutral' | 'accent'> = { open: 'accent', processing: 'accent', completed: 'ok', rejected: 'danger', expired: 'warn' };
const busyOf = (s: { status: string }) => s.status === 'open' || s.status === 'processing';

export function RequestDetail({ id }: { id: string }) {
  const t = useT();
  const loc = getLocale();
  const [, navigate] = useLocation();
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['requests', 'one', id], queryFn: () => get<{ request: Portal; folderPath: Crumb[] }>(`/requests/${id}`), refetchOnMount: 'always' });
  // while a deposit is being sent or inspected, the table follows it
  const subs = useQuery({ queryKey: ['requests', 'submissions', id], queryFn: () => get<Submission[]>(`/requests/${id}/submissions`), refetchOnMount: 'always', refetchInterval: (query) => (query.state.data?.some(busyOf) ? 3000 : false) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data.request, path = q.data.folderPath;
  const modes = (['name', 'email', 'reference'] as const).filter((k) => p.fields[k] !== 'off').map((k) => `${t(`sharing.portal.field.${k}`)} (${t(`sharing.portal.mode.${p.fields[k]}`).toLowerCase()})`);
  const facts: [string, string][] = [
    [t('sharing.detail.limits'), `${t('sharing.detail.perFile', { size: formatBytes(p.maxFileBytes, loc) })} · ${t('sharing.detail.files', { n: p.maxFilesPerSubmission })} · ${t('sharing.detail.perHour', { n: p.submissionsPerHour })}`],
    [t('sharing.requests.volume'), `${formatBytes(p.bytesReceived, loc)} / ${formatBytes(p.maxTotalBytes, loc)}`],
    [t('sharing.requests.deposits'), `${p.submissions}${p.maxSubmissions !== null ? ` / ${p.maxSubmissions}` : ''}`],
    [t('sharing.portal.sTypes'), p.allowedExtensions.length ? p.allowedExtensions.map((e) => `.${e}`).join(' ') : t('sharing.portal.preset.any')],
    [t('sharing.portal.sForm'), [...modes, ...p.fields.custom.map((c) => `${c.label}${c.required ? ` (${t('sharing.portal.mode.required').toLowerCase()})` : ''}`)].join(' · ') || t('sharing.detail.noFields')],
    [t('sharing.portal.sAccess'), [p.hasPassword ? t('sharing.item.password') : t('sharing.detail.noPassword'), p.expiresAt ? t('sharing.item.expires', { date: fmtDate(p.expiresAt) }) : t('sharing.item.noExpiry'), p.requireConsent ? t('sharing.detail.consent') : ''].filter(Boolean).join(' · ')],
    [t('sharing.portal.sAfter'), [p.subfolderPerSubmission ? t('sharing.detail.subfolder') : t('sharing.detail.flat'), p.notifyOwner ? t('sharing.detail.notify') : t('sharing.detail.noNotify')].join(' · ')],
  ];
  return (
    <div className="pb-dock mx-auto w-full max-w-4xl px-4 pt-3 sm:px-6 sm:pt-7" data-testid="request-detail">
      <Link href="/requests" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><Glyph name="chevronLeft" size={16} />{t('sharing.requests.title')}</Link>
      <header className="mt-3 card overflow-hidden">
        <div className="h-1.5" style={{ background: p.brandColor }} aria-hidden="true" />
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="min-w-0 text-2xl font-bold tracking-tight break-words">{p.title}</h1><PortalState state={p.state} /></div>
              <p className="mt-0.5 text-xs text-ink-3">{t(`sharing.pstateHint.${p.state}`)}</p>
              {p.description ? <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{p.description}</p> : null}
              <p className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-sm text-ink-2"><Glyph name="folder" size={16} className="shrink-0 text-ink-3" />
                {path.map((c, i) => <span key={c.id} className="inline-flex min-w-0 items-center gap-1">{i ? <Glyph name="chevronRight" size={12} className="text-ink-3" /> : null}
                  {p.state === 'target_missing' ? <span className="truncate">{c.name}</span> : <Link href={i === 0 ? '/' : `/folder/${c.id}`} className="truncate text-accent underline-offset-2 hover:underline">{i === 0 ? t('sharing.picker.root') : c.name}</Link>}</span>)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2"><PortalActions portal={{ ...p, folderName: path[path.length - 1]?.name ?? '' }} onPurged={() => navigate('/requests')} /></div>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-line pt-4 text-sm sm:grid-cols-2" data-testid="portal-facts">
            {facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-ink-3">{k}</dt><dd className="break-words">{v}</dd></div>)}
          </dl>
        </div>
      </header>

      <section className="mt-6" aria-labelledby="subs-h">
        <div className="flex items-center justify-between gap-3">
          <h2 id="subs-h" className="text-base font-semibold">{t('sharing.detail.submissions')}{subs.data ? <span className="ml-2 text-sm font-normal text-ink-3">{subs.data.length}</span> : null}</h2>
          <Button size="sm" variant="ghost" icon="refresh" busy={subs.isFetching} onClick={() => void subs.refetch()}>{t('sharing.refresh')}</Button>
        </div>
        {subs.isLoading ? <Loading /> : subs.error ? <ErrorState error={subs.error} onRetry={() => void subs.refetch()} /> : !subs.data?.length ? <EmptyState icon="inbox" title={t('sharing.detail.empty')} text={t('sharing.detail.emptyText')} /> : (
          <div className="mt-3 card overflow-hidden">
            <table className="w-full text-left text-sm" data-testid="submissions">
              <thead className="hidden border-b border-line text-xs text-ink-3 sm:table-header-group"><tr>
                <th className="px-4 py-2.5 font-medium">{t('sharing.detail.ref')}</th><th className="px-2 py-2.5 font-medium">{t('sharing.detail.depositor')}</th><th className="px-2 py-2.5 font-medium">{t('sharing.detail.date')}</th>
                <th className="px-2 py-2.5 font-medium">{t('sharing.detail.status')}</th><th className="px-2 py-2.5 font-medium">{t('sharing.detail.filesCol')}</th><th className="px-2 py-2.5 font-medium">{t('sharing.requests.volume')}</th><th className="px-4 py-2.5"><span className="sr-only">{t('sharing.detail.folder')}</span></th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {subs.data.map((s) => (
                  <tr key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-hover sm:table-row sm:p-0" data-status={s.status}>
                    <td className="sm:px-4 sm:py-3"><button type="button" onClick={() => setOpenId(s.id)} className="font-mono text-sm font-semibold whitespace-nowrap text-accent underline-offset-2 hover:underline" aria-label={t('sharing.detail.openSub', { ref: s.ref })}>{s.ref}</button></td>
                    <td className="min-w-0 flex-1 sm:px-2 sm:py-3"><span className="block truncate">{s.name || s.email || t('sharing.detail.anonymous')}</span>{s.name && s.email ? <span className="block truncate text-xs text-ink-3">{s.email}</span> : null}</td>
                    <td className="w-full text-xs text-ink-3 sm:w-auto sm:px-2 sm:py-3 sm:text-sm sm:text-ink-2">{fmtDate(s.createdAt)}</td>
                    <td className="sm:px-2 sm:py-3"><Badge tone={SUB_TONE[s.status]}>{t(`sharing.sstatus.${s.status}`)}</Badge></td>
                    <td className="tabular-nums sm:px-2 sm:py-3"><span className="text-ok">{t('sharing.detail.accepted', { n: s.placed })}</span>{s.rejected ? <span className="text-danger"> · {t('sharing.detail.refused', { n: s.rejected })}</span> : null}</td>
                    <td className="text-ink-2 tabular-nums sm:px-2 sm:py-3">{formatBytes(s.bytes, loc)}</td>
                    <td className="sm:px-4 sm:py-3 sm:text-right">{s.folderId ? <Link href={`/folder/${s.folderId}`} className="whitespace-nowrap text-accent underline-offset-2 hover:underline">{t('sharing.detail.openFolder')}</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {openId ? <SubmissionDialog id={openId} portal={p} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function SubmissionDialog({ id, portal, onClose }: { id: string; portal: Portal; onClose: () => void }) {
  const t = useT();
  const loc = getLocale();
  const q = useQuery({ queryKey: ['requests', 'submission', id], queryFn: () => get<SubmissionDetail>(`/submissions/${id}`), refetchInterval: (query) => (query.state.data && busyOf(query.state.data) ? 2500 : false) });
  const s = q.data;
  const reason = (code: string | null) => t(`sharing.reject.${REJECT_CODES.includes(code ?? '') ? code : 'other'}`);
  const eventText = (e: SubmissionDetail['events'][number]) => {
    const m = e.meta as Record<string, any>;
    switch (e.action) {
      case 'submission.started': return t('sharing.event.started', { n: m.files ?? 0, size: formatBytes(Number(m.bytes ?? 0), loc) });
      case 'submission.finalized': return m.incomplete ? t('sharing.event.finalizedPartial', { n: m.received ?? 0, k: m.incomplete }) : t('sharing.event.finalized', { n: m.received ?? 0 });
      case 'submission.item_rejected': return t('sharing.event.itemRejected', { name: String(m.name ?? ''), reason: reason(String(m.code ?? '')) });
      case 'submission.completed': return t('sharing.event.completed', { n: m.placed ?? 0, k: m.rejected ?? 0 });
      case 'submission.rejected': return m.reason ? t('sharing.event.rejectedWhy', { reason: reason(String(m.reason)) }) : t('sharing.event.rejected');
      default: return e.action;
    }
  };
  const answers: [string, string][] = s ? [
    ...(['name', 'email', 'reference'] as const).filter((k) => s[k]).map((k): [string, string] => [t(`sharing.portal.field.${k}`), s[k]]),
    ...Object.entries(s.meta ?? {}).map(([k, v]): [string, string] => [portal.fields.custom.find((c) => c.key === k)?.label ?? k, String(v)]),
  ] : [];
  return (
    <Dialog title={s ? t('sharing.detail.subTitle', { ref: s.ref }) : t('common.loading')} onClose={onClose} wide footer={<>{s?.folderId ? <Link href={`/folder/${s.folderId}`} className="mr-auto text-sm text-accent underline-offset-2 hover:underline">{t('sharing.detail.openFolder')}</Link> : null}<Button variant="primary" onClick={onClose}>{t('common.close')}</Button></>}>
      {q.isLoading ? <Loading /> : q.error || !s ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-5" data-testid="submission-detail">
          <p className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={SUB_TONE[s.status]}>{t(`sharing.sstatus.${s.status}`)}</Badge><span className="text-ink-2">{t('sharing.detail.received', { date: fmtDate(s.createdAt) })}{s.completedAt ? ` · ${t('sharing.detail.processed', { date: fmtDate(s.completedAt, { timeStyle: 'medium' }) })}` : ''}</span></p>
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('sharing.detail.answers')}</h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="answers">
              {answers.length ? answers.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-ink-3">{k}</dt><dd className="break-words whitespace-pre-line">{v}</dd></div>) : <p className="text-ink-3">{t('sharing.detail.noAnswers')}</p>}
              <div><dt className="text-xs text-ink-3">{t('sharing.detail.consentAt')}</dt><dd>{s.consentAt ? fmtDate(s.consentAt, { dateStyle: 'medium', timeStyle: 'medium' }) : t('sharing.detail.consentNone')}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-3">{t('sharing.detail.origin')}</dt><dd className="break-words">{s.ip || '—'} · {uaSummary(s.userAgent, t('sharing.events.unknownDevice'))}</dd></div>
            </dl>
          </section>
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('sharing.detail.filesCol')}</h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="sub-items">
              {s.items.map((i) => (
                <li key={i.id} className="flex items-start gap-3 px-3 py-2.5" data-status={i.status}>
                  <Glyph name={i.status === 'placed' ? 'check' : i.status === 'rejected' ? 'x' : 'clock'} size={18} className={i.status === 'placed' ? 'mt-0.5 shrink-0 text-ok' : i.status === 'rejected' ? 'mt-0.5 shrink-0 text-danger' : 'mt-0.5 shrink-0 text-ink-3'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{i.name}{i.originalName !== i.name ? <span className="font-normal text-ink-3"> ({t('sharing.detail.sentAs', { name: i.originalName })})</span> : null}</p>
                    <p className="text-xs text-ink-3">{formatBytes(i.size, loc)}{i.mime ? ` · ${i.mime}` : ''}</p>
                    {i.status === 'rejected' ? <p className="text-sm text-danger">{t('sharing.detail.itemRejected')} — {reason(i.rejectCode)}</p>
                      : i.status === 'placed' ? <p className="text-sm text-ok">{t('sharing.detail.itemPlaced')}{s.folderId ? <> · <Link href={`/folder/${s.folderId}`} className="text-accent underline-offset-2 hover:underline">{t('sharing.detail.openFolder')}</Link></> : null}</p>
                        : <p className="text-sm text-ink-2">{i.status === 'quarantined' ? t('sharing.detail.itemQuarantine') : t('sharing.detail.itemUploading')}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('sharing.detail.journal')}</h3>
            <ol className="mt-2 space-y-2" data-testid="sub-events">
              {s.events.map((e) => <li key={e.id} className="flex gap-3 text-sm" data-action={e.action}><time className="w-20 shrink-0 text-xs text-ink-3 tabular-nums" dateTime={e.at}>{fmtDate(e.at, { timeStyle: 'medium' })}</time><span className="min-w-0 break-words">{eventText(e)}</span></li>)}
            </ol>
          </section>
        </div>
      )}
    </Dialog>
  );
}
