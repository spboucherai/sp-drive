/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/screens/Requests.tsx
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

// Deposit portals of the account.
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { FolderPicker, PortalActions, PortalState } from '../sharing/PortalParts.tsx';
import { RequestDialog } from '../sharing/RequestDialog.tsx';
import type { Portal } from '../types.ts';
import { Button, EmptyState, ErrorState, Loading, ProgressBar } from '../ui.tsx';

export function Requests() {
  const t = useT();
  const loc = getLocale();
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ['requests', 'list'], queryFn: () => get<Portal[]>('/requests'), refetchOnMount: 'always' });
  const [picking, setPicking] = useState(false);
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(null);
  const create = <Button variant="primary" icon="plus" onClick={() => setPicking(true)}>{t('sharing.requests.new')}</Button>;
  return (
    <div className="pb-dock mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6 sm:pt-7" data-testid="requests-screen">
      <header className="flex flex-col items-start justify-between gap-3 px-1 sm:flex-row">
        <div className="min-w-0 flex-1"><h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[32px]">{t('sharing.requests.title')}</h1><p className="mt-1.5 text-[15px] text-ink-2">{t('sharing.requests.intro')}</p></div>
        {q.data?.length ? create : null}
      </header>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState icon="inbox" title={t('sharing.requests.empty')} text={t('sharing.requests.emptyText')} action={create} /> : (
        <ul className="stagger mt-5 space-y-3">
          {q.data.map((p) => (
            <li key={p.id} className="card p-5" data-testid="portal-card" data-state={p.state}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full" style={{ background: p.brandColor }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2"><Link href={`/requests/${p.id}`} className="min-w-0 truncate text-base font-semibold underline-offset-2 hover:underline">{p.title}</Link><PortalState state={p.state} /></p>
                  <p className="mt-0.5 text-xs text-ink-3">{t(`sharing.pstateHint.${p.state}`)}</p>
                  <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-ink-2"><Glyph name="folder" size={16} className="shrink-0 text-ink-3" />
                    {p.state === 'target_missing' ? <span className="truncate">{p.folderName}</span> : <Link href={`/folder/${p.folderId}`} className="truncate text-accent underline-offset-2 hover:underline">{p.folderName}</Link>}</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-ink-3">{t('sharing.requests.deposits')}</dt><dd className="font-medium tabular-nums" data-testid="portal-deposits">{p.submissions}{p.maxSubmissions !== null ? ` / ${p.maxSubmissions}` : ''}</dd></div>
                <div><dt className="text-xs text-ink-3">{t('sharing.requests.volume')}</dt><dd className="font-medium tabular-nums">{formatBytes(p.bytesReceived, loc)} / {formatBytes(p.maxTotalBytes, loc)}</dd></div>
                <div className="col-span-2 sm:col-span-1"><dt className="text-xs text-ink-3">{t('sharing.requests.expiry')}</dt><dd className="font-medium">{p.expiresAt ? fmtDate(p.expiresAt) : t('sharing.item.noExpiry')}</dd></div>
              </dl>
              <div className="mt-2"><ProgressBar value={p.maxTotalBytes ? p.bytesReceived / p.maxTotalBytes : 0} label={t('sharing.requests.volume')} /></div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <Button size="sm" icon="inbox" onClick={() => navigate(`/requests/${p.id}`)} className="mr-auto">{t('sharing.requests.view')}</Button>
                <PortalActions portal={p} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {picking ? <FolderPicker title={t('sharing.picker.title')} confirmLabel={t('sharing.picker.confirm')} onClose={() => setPicking(false)} onPick={(f) => { setPicking(false); setFolder(f); }} /> : null}
      {folder ? <RequestDialog folder={folder} onClose={() => setFolder(null)} /> : null}
    </div>
  );
}
