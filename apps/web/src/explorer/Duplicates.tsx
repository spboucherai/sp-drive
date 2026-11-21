/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/explorer/Duplicates.tsx
 * Module           : explorer
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

// Files with identical content inside the account, grouped; the extra copies of a group can go to the trash.
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'wouter';
import { get } from '../api.ts';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { ownerSource } from '../sources.ts';
import type { FileDetail, FileItem } from '../types.ts';
import { useFeature } from '../next/meta.ts';
import type { SimilarGroup } from '../next/types.ts';
import { Badge, Button, cx, EmptyState, ErrorState, IconButton, Loading } from '../ui.tsx';
import { pathText } from './Details.tsx';
import { XKEY } from './lib.ts';

interface Group { sha256: string; size: number; distinctNames?: boolean; files: FileItem[] }

/** Where a file lives. One request per folder, whatever the number of copies in it. */
function Location({ file }: { file: FileItem }) {
  const t = useT();
  const q = useQuery({ queryKey: [XKEY, 'path', file.folderId], queryFn: async () => (await get<FileDetail>(`/files/${file.id}`)).path, staleTime: 60_000 });
  if (!q.data) return <span className="text-ink-3">{q.isLoading ? '…' : ''}</span>;
  return <Link href={q.data.length <= 1 ? '/' : `/folder/${file.folderId}`} className="truncate text-ink-2 underline-offset-2 hover:text-accent hover:underline">{pathText(q.data, t('explorer.root'))}</Link>;
}

/** Pictures that look alike without being the same bytes (resized, re-encoded, converted). Nothing is proposed for deletion in bulk. */
function Similar({ onOpen, onTrash }: { onOpen: (f: FileItem) => void; onTrash: (files: FileItem[]) => void }) {
  const t = useT();
  const loc = getLocale();
  const [distance, setDistance] = useState(6);
  const q = useQuery({ queryKey: [XKEY, 'duplicates', 'similar', distance], queryFn: () => get<{ groups: SimilarGroup[] }>(`/duplicates?mode=similar-images&distance=${distance}`), placeholderData: (p) => p });
  const strict = (
    <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">{t('next.dup.tolerance')}
      <select value={distance} onChange={(e) => setDistance(Number(e.target.value))} className="h-9 rounded-[10px] border border-line-strong bg-surface px-2 text-[13px] text-ink">{[2, 6, 10, 14].map((d) => <option key={d} value={d}>{t(`next.dup.tol.${d}`)}</option>)}</select>
    </label>
  );
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.groups.length) return <div className="flex flex-col gap-3">{strict}<EmptyState icon="image" title={t('next.dup.similarNone')} text={t('next.dup.similarNoneText')} /></div>;
  return (
    <div className="flex flex-col gap-3" data-testid="similar-groups">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-ink-2">{t('next.dup.similarSummary', { n: q.data.groups.length })} <span className="text-ink-3">{t('next.dup.similarNote')}</span></p>{strict}</div>
      {q.data.groups.map((g, gi) => (
        <section key={gi} aria-label={g.files[0]!.name} className="rounded-[12px] p-3 shadow-(--spd-elevation-e0)" data-testid="similar-group">
          <p className="mb-2 text-xs text-ink-3">{t('next.dup.images', { n: g.files.length })} · {g.maxDistance === 0 ? t('next.dup.sameLook') : t('next.dup.bits', { n: g.maxDistance })}</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
            {g.files.map((f) => (
              <li key={f.id} className="min-w-0">
                <button type="button" onClick={() => onOpen(f)} aria-label={t('explorer.openNamed', { name: f.name })} className="block w-full overflow-hidden rounded-[10px] bg-well shadow-(--spd-elevation-e0)"><Thumb name={f.name} kind={f.kind} className="aspect-[4/3] w-full rounded-none!" src={f.thumb && f.scan !== 'infected' ? ownerSource(f).previewUrl('thumb') : undefined} /></button>
                <div className="mt-1 flex items-start gap-1">
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-ink">{f.name}</p><p className="truncate text-xs text-ink-3">{formatBytes(f.size, loc)} · <Location file={f} /></p></div>
                  <IconButton icon="trash" size={16} className="h-8! w-8!" label={t('explorer.trashNamed', { name: f.name })} onClick={() => onTrash([f])} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Duplicates(p: { onOpen: (f: FileItem) => void; onTrash: (files: FileItem[]) => void }) {
  const t = useT();
  const similar = useFeature('similar-images');
  const [mode, setMode] = useState<'exact' | 'similar'>('exact');
  return (
    <div className="flex flex-col gap-4">
      {similar ? (
        <div role="tablist" aria-label={t('next.dup.modes')} className="flex w-fit gap-0.5 rounded-[10px] bg-well p-0.5" data-testid="dup-modes">
          {(['exact', 'similar'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cx('h-9 rounded-lg px-3 text-[13px] transition-colors sm:h-8', mode === k ? 'bg-surface font-medium text-ink shadow-(--shadow-card)' : 'text-ink-2 hover:text-ink')}>{t(`next.dup.mode.${k}`)}</button>)}
        </div>
      ) : null}
      {mode === 'similar' && similar ? <Similar {...p} /> : <Exact {...p} />}
    </div>
  );
}

function Exact({ onOpen, onTrash }: { onOpen: (f: FileItem) => void; onTrash: (files: FileItem[]) => void }) {
  const t = useT();
  const loc = getLocale();
  const [shown, setShown] = useState(30);
  const q = useQuery({ queryKey: [XKEY, 'duplicates'], queryFn: () => get<{ groups: Group[] }>('/duplicates') });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const groups = q.data.groups;
  if (!groups.length) return <EmptyState icon="duplicate" title={t('explorer.empty.duplicates')} text={t('explorer.empty.duplicatesText')} />;
  const extra = groups.reduce((n, g) => n + g.size * (g.files.length - 1), 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{t('explorer.dup.summary', { n: groups.length, size: formatBytes(extra, loc) })} <span className="text-ink-3">{t('explorer.dup.note')}</span></p>
      {groups.slice(0, shown).map((g) => (
        <section key={`${g.sha256}:${g.size}`} aria-label={g.files[0]!.name} className="overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)" data-testid="dup-group">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Badge tone="accent">{t('explorer.dup.copies', { n: g.files.length })}</Badge>
            {g.distinctNames ? <span data-testid="distinct-names"><Badge tone="warn">{t('next.dup.distinctNames')}</Badge></span> : null}
            <span className="min-w-0 flex-1 text-sm text-ink-2">{t('explorer.dup.each', { size: formatBytes(g.size, loc) })} · {t('explorer.dup.saved', { size: formatBytes(g.size * (g.files.length - 1), loc) })}</span>
            <Button size="sm" icon="trash" onClick={() => onTrash(g.files.slice(1))}>{t('explorer.dup.trashExtra', { n: g.files.length - 1 })}</Button>
          </header>
          <ul className="divide-y divide-line">
            {g.files.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-1.5">
                <Thumb name={f.name} kind={f.kind} className="h-9 w-9 shrink-0 overflow-hidden rounded-lg" src={f.thumb && f.scan !== 'infected' ? ownerSource(f).previewUrl('thumb') : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink"><span className="truncate">{f.name}</span>{i === 0 ? <Badge tone="ok">{t('explorer.dup.kept')}</Badge> : null}</p>
                  <p className="flex min-w-0 gap-1 text-xs text-ink-3"><Location file={f} /><span className="shrink-0">· {fmtDate(f.createdAt, { dateStyle: 'medium' })}</span></p>
                </div>
                {f.scan !== 'infected' ? <IconButton icon="eye" size={18} label={t('explorer.openNamed', { name: f.name })} onClick={() => onOpen(f)} /> : null}
                <IconButton icon="trash" size={18} label={t('explorer.trashNamed', { name: f.name })} onClick={() => onTrash([f])} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length > shown ? <Button className="self-center" onClick={() => setShown(shown + 30)}>{t('explorer.dup.more', { n: groups.length - shown })}</Button> : null}
    </div>
  );
}
