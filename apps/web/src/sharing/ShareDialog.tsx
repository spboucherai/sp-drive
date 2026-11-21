/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/sharing/ShareDialog.tsx
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

// Share links of one file or folder: the existing links with their state and actions, and the creation of a new one.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { Share } from '../types.ts';
import { Button, Dialog, ErrorState, Loading } from '../ui.tsx';
import { LinkOnce } from './common.tsx';
import { ShareForm, ShareItem, useInvalidateShares } from './ShareParts.tsx';

export function ShareDialog({ target, onClose }: { target: { type: 'file' | 'folder'; id: string; name: string }; onClose: () => void }) {
  const t = useT();
  const invalidate = useInvalidateShares();
  const q = useQuery({ queryKey: ['shares', target.type, target.id], queryFn: () => get<Share[]>(`/shares?${target.type === 'file' ? 'fileId' : 'folderId'}=${target.id}`), refetchOnMount: 'always' });
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'create' } | { kind: 'created'; url: string }>({ kind: 'list' });
  const empty = !q.isLoading && !q.error && !q.data?.length;
  return (
    <Dialog title={t('sharing.dialog.title', { name: target.name })} onClose={onClose} wide>
      {view.kind === 'created' ? (
        <div className="space-y-4" data-testid="share-created">
          <p className="flex items-center gap-2 text-sm font-medium text-ok"><Glyph name="check" size={18} />{t('sharing.dialog.created')}</p>
          <LinkOnce url={view.url} title={target.name} />
          <div className="flex justify-end"><Button variant="primary" onClick={() => setView({ kind: 'list' })}>{t('sharing.link.done')}</Button></div>
        </div>
      ) : view.kind === 'create' || empty ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">{empty ? t('sharing.dialog.emptyIntro') : t('sharing.dialog.createIntro')}</p>
          <ShareForm target={target} onCancel={() => (empty ? onClose() : setView({ kind: 'list' }))} onDone={(r) => { void invalidate(); setView({ kind: 'created', url: r.url! }); }} />
        </div>
      ) : q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">{t('sharing.dialog.count', { n: q.data!.length })}</p>
            <Button variant="primary" icon="plus" onClick={() => setView({ kind: 'create' })}>{t('sharing.form.create')}</Button>
          </div>
          {q.data!.map((s) => <ShareItem key={s.id} share={s} />)}
        </div>
      )}
    </Dialog>
  );
}
