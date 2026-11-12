// Every share link of the account, whatever it targets.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'wouter';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import { ShareDialog } from '../sharing/ShareDialog.tsx';
import { ShareItem } from '../sharing/ShareParts.tsx';
import type { Share } from '../types.ts';
import { cx, EmptyState, ErrorState, Loading } from '../ui.tsx';

const STATUSES: (Share['status'] | 'all')[] = ['all', 'active', 'expired', 'exhausted', 'revoked', 'target_missing'];

export function Shares() {
  const t = useT();
  const q = useQuery({ queryKey: ['shares', 'all'], queryFn: () => get<Share[]>('/shares'), refetchOnMount: 'always' });
  const [filter, setFilter] = useState<Share['status'] | 'all'>('all');
  const [manage, setManage] = useState<Share | null>(null);
  const all = q.data ?? [];
  const shown = filter === 'all' ? all : all.filter((s) => s.status === filter);
  const count = (s: Share['status'] | 'all') => (s === 'all' ? all.length : all.filter((x) => x.status === s).length);
  return (
    <div className="pb-dock mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6 sm:pt-7" data-testid="shares-screen">
      <header className="px-1">
        <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[32px]">{t('sharing.shares.title')}</h1>
        <p className="mt-1.5 text-[15px] text-ink-2">{t('sharing.shares.intro')}</p>
      </header>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !all.length ? <EmptyState icon="link" title={t('sharing.shares.empty')} text={t('sharing.shares.emptyText')} /> : (
        <>
          <div role="group" aria-label={t('sharing.shares.filter')} className="mt-4 flex flex-wrap gap-1.5">
            {STATUSES.filter((s) => s === 'all' || count(s) > 0).map((s) => (
              <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
                className={cx('press h-10 rounded-full px-4 text-sm font-medium', filter === s ? 'grad shadow-sm' : 'bg-surface text-ink-2 ring-1 ring-inset ring-line hover:bg-hover')}>
                {s === 'all' ? t('sharing.shares.all') : t(`sharing.status.${s}`)} <span className="tabular-nums opacity-70">{count(s)}</span>
              </button>
            ))}
          </div>
          <div className="stagger mt-5 space-y-3">
            {shown.length ? shown.map((s) => (
              <ShareItem key={s.id} share={s} heading={
                <p className="mb-1.5 flex min-w-0 items-center gap-2 text-sm">
                  <Glyph name={s.type} size={18} className={cx('shrink-0', s.type === 'folder' ? 'text-accent' : 'text-ink-3')} />
                  {s.status === 'target_missing' || !s.targetName ? <span className="truncate text-ink-3">{s.targetName || t('sharing.shares.targetGone')}</span>
                    : s.type === 'folder' ? <Link href={`/folder/${s.targetId}`} className="truncate font-medium text-accent underline-offset-2 hover:underline">{s.targetName}</Link>
                      : <button type="button" onClick={() => setManage(s)} className="truncate text-left font-medium text-accent underline-offset-2 hover:underline" title={t('sharing.shares.manageFile')}>{s.targetName}</button>}
                </p>} />
            )) : <p className="py-10 text-center text-sm text-ink-3">{t('sharing.shares.noneForFilter')}</p>}
          </div>
        </>
      )}
      {manage ? <ShareDialog target={{ type: manage.type, id: manage.targetId, name: manage.targetName }} onClose={() => setManage(null)} /> : null}
    </div>
  );
}
