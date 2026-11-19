// Activity: the audit trail of a file, of a folder (owner or member view) or of the whole account, as a timeline.
// Only real events recorded by the server; nothing is inferred on the client.
import { formatBytes } from '@spd/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { get, qs } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, fmtRelative, getLocale, useT } from '../i18n.ts';
import { Button, cx, ErrorState, Loading } from '../ui.tsx';
import type { ActivityEvent, ActivityPage } from './types.ts';

type T = ReturnType<typeof useT>;
const ICON: Record<string, { icon: string; tone?: 'ok' | 'warn' | 'danger' | 'accent' }> = {
  'file.uploaded': { icon: 'upload', tone: 'accent' }, 'file.version_added': { icon: 'layers', tone: 'accent' }, 'file.version_restored': { icon: 'restore', tone: 'accent' }, 'file.version_deleted': { icon: 'trash' },
  'file.renamed': { icon: 'pencil' }, 'folder.renamed': { icon: 'pencil' }, 'file.downloaded': { icon: 'download' }, 'folder.created': { icon: 'folderPlus' }, 'items.moved': { icon: 'move' }, 'items.copied': { icon: 'copy' },
  'items.trashed': { icon: 'trash', tone: 'warn' }, 'items.restored': { icon: 'restore', tone: 'ok' }, 'items.purged': { icon: 'trash', tone: 'danger' }, 'zip.downloaded': { icon: 'archive' },
  'share.created': { icon: 'link', tone: 'accent' }, 'share.updated': { icon: 'link' }, 'share.revoked': { icon: 'link', tone: 'warn' }, 'share.deleted': { icon: 'link' }, 'share.rotated': { icon: 'refresh' },
  'submission.completed': { icon: 'inbox', tone: 'accent' }, 'scan.infected': { icon: 'warning', tone: 'danger' },
  'collab.member_added': { icon: 'users', tone: 'accent' }, 'collab.member_updated': { icon: 'users' }, 'collab.member_removed': { icon: 'users', tone: 'warn' }, 'collab.workspace_named': { icon: 'users' },
};
const TONE = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', accent: 'bg-accent-soft text-accent', none: 'bg-hover text-ink-2' };
const n = (v: unknown) => (typeof v === 'number' ? v : 0);

/** One sentence per event. An action this client does not know shows its code, so nothing is silently dropped. */
export function sentence(e: ActivityEvent, t: T, o: { withTarget: boolean }): string {
  const m = e.meta ?? {}, name = o.withTarget ? e.target?.name ?? '' : '';
  const named = (k: string, vars: Record<string, string | number> = {}) => (name ? t(`next.act.${k}Named`, { name, ...vars }) : t(`next.act.${k}`, vars));
  const count = n(m.files) + n(m.folders);
  switch (e.action) {
    case 'file.uploaded': return named('uploaded', { size: formatBytes(n(m.size), getLocale()) });
    case 'file.version_added': return named('versionAdded', { size: formatBytes(n(m.size), getLocale()) });
    case 'file.version_restored': return named('versionRestored', { n: n(m.from) });
    case 'file.version_deleted': return named('versionDeleted');
    case 'file.renamed': case 'folder.renamed': return name ? t('next.act.renamedNamed', { from: String(m.from ?? ''), name }) : t('next.act.renamed', { from: String(m.from ?? '') });
    case 'file.downloaded': return named('downloaded');
    case 'folder.created': return named('folderCreated');
    case 'items.moved': return t('next.act.moved', { n: count });
    case 'items.copied': return t('next.act.copied', { n: count });
    case 'items.trashed': return t('next.act.trashed', { n: count });
    case 'items.restored': return t('next.act.restored', { n: count });
    case 'items.purged': return m.all ? t('next.act.purgedAll') : t('next.act.purged', { n: count });
    case 'zip.downloaded': return t('next.act.zip', { n: n(m.files) });
    case 'share.created': return t(m.password ? 'next.act.shareCreatedPw' : 'next.act.shareCreated');
    case 'share.updated': return t('next.act.shareUpdated');
    case 'share.revoked': return t('next.act.shareRevoked');
    case 'share.deleted': return t('next.act.shareDeleted');
    case 'share.rotated': return t('next.act.shareRotated');
    case 'submission.completed': return t('next.act.submission', { n: n(m.placed) });
    case 'scan.infected': return t('next.act.infected', { sig: String(m.signature ?? '') });
    case 'collab.member_added': return named('memberAdded', { role: t(`next.role.${String(m.role ?? 'viewer')}`) });
    case 'collab.member_updated': return named('memberUpdated', { role: t(`next.role.${String(m.role ?? 'viewer')}`) });
    case 'collab.member_removed': return named('memberRemoved');
    case 'collab.workspace_named': return named(m.named ? 'workspaceNamed' : 'workspaceUnnamed');
    default: return e.action;
  }
}
const who = (e: ActivityEvent, t: T) => (e.actor.kind === 'system' ? t('next.act.system') : e.actor.me ? t('next.act.you') : e.actor.displayName ?? t('next.act.anonymous'));
const dayKey = (iso: string) => new Date(iso).toDateString();

/** A timeline fed by one of the activity endpoints (`path` without query). */
export function Timeline({ path, queryKey, withTarget, dense, empty }: { path: string; queryKey: unknown[]; withTarget: boolean; dense?: boolean; empty?: string }) {
  const t = useT();
  const q = useInfiniteQuery({
    queryKey: ['next', 'activity', ...queryKey], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => get<ActivityPage>(`${path}${qs({ before: pageParam, limit: dense ? 30 : 60 })}`),
    getNextPageParam: (last) => (last.more && last.events.length ? last.events[last.events.length - 1]!.id : undefined),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const events = (q.data?.pages ?? []).flatMap((p) => p.events);
  if (!events.length) return <p className="px-2 py-8 text-center text-sm text-ink-3" data-testid="activity-empty">{empty ?? t('next.act.empty')}</p>;
  let last = '';
  return (
    <div data-testid="timeline">
      <ol className="relative">
        {events.map((e) => {
          const meta = ICON[e.action] ?? { icon: 'activity' };
          const day = dayKey(e.at), head = day !== last; last = day;
          const text = sentence(e, t, { withTarget });
          const link = withTarget && e.target?.name && e.target.type === 'folder' ? `/folder/${e.target.id}` : null;
          return (
            <li key={e.id} data-action={e.action}>
              {head ? <p className={cx('spd-eyebrow sticky top-0 z-[1] bg-(--tl-bg,var(--spd-color-canvas)) py-2', dense ? 'pl-0' : 'pl-1')}>{fmtDate(e.at, { weekday: 'long', day: 'numeric', month: 'long' })}</p> : null}
              <div className="relative flex gap-3 pb-4">
                <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-line" />
                <span className={cx('relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TONE[meta.tone ?? 'none'])}><Glyph name={meta.icon} size={15} /></span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[13px] leading-snug break-words text-ink">{link ? <Link href={link} className="hover:underline">{text}</Link> : text}</p>
                  <p className="mt-0.5 text-xs text-ink-3"><span className={cx(e.actor.me ? '' : 'font-medium text-ink-2')}>{who(e, t)}</span>{e.meta?.via === 'grant' ? ` · ${t('next.act.viaGrant')}` : ''} · <time dateTime={e.at} title={fmtDate(e.at)}>{fmtRelative(e.at)}</time></p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage ? <div className="flex justify-center pb-4"><Button size="sm" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('next.act.more')}</Button></div> : null}
    </div>
  );
}

/** The account's activity screen. */
export function ActivityScreen() {
  const t = useT();
  return (
    <div className="pb-dock mx-auto w-full max-w-3xl px-4 pt-3 sm:px-8 sm:pt-6" data-testid="activity-screen">
      <header className="mb-4">
        <h1 className="text-[30px] leading-[1.1] sm:text-[32px]">{t('next.act.title')}</h1>
        <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-2">{t('next.act.intro')} <Link href="/settings/activite" className="font-medium text-accent underline-offset-4 hover:underline">{t('next.act.security')}</Link></p>
      </header>
      <Timeline path="/activity" queryKey={['account']} withTarget empty={t('next.act.emptyAccount')} />
    </div>
  );
}
