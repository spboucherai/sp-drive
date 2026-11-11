// The bell: unread count, and a panel with one human sentence per notification.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { get, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtRelative, useT } from '../i18n.ts';
import type { Notification } from '../types.ts';
import { Button, cx, EmptyState, ErrorState, IconButton, Loading } from '../ui.tsx';

const KEY = ['notifications'];
type T = ReturnType<typeof useT>;
interface Line { icon: string; tone: 'accent' | 'warn' | 'danger'; title: string; text?: string; href?: string }
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** What a notification says. Unknown kinds show their kind, so nothing is silently dropped. */
export function describe(n: Notification, t: T): Line {
  const d = n.data ?? {};
  switch (n.kind) {
    case 'security.recovery_used': return { icon: 'shield', tone: 'warn', title: t('account.notif.recoveryUsed'), text: str(d.ip) ? t('account.notif.recoveryUsedIp', { ip: str(d.ip) }) : undefined, href: '/settings/activite' };
    case 'security.passkey_added': return { icon: 'key', tone: 'accent', title: t('account.notif.passkeyAdded'), text: str(d.label) || undefined, href: '/settings/securite' };
    case 'security.passkey_removed': return { icon: 'key', tone: 'warn', title: t('account.notif.passkeyRemoved'), href: '/settings/securite' };
    case 'scan.infected': {
      const files = (Array.isArray(d.files) ? d.files : []) as { id?: unknown; name?: unknown }[];
      const names = files.map((f) => str(f?.name)).filter(Boolean);
      return { icon: 'warning', tone: 'danger', title: t('account.notif.infected', { n: names.length || 1 }), text: [names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''), str(d.signature)].filter(Boolean).join(' — ') || undefined };
    }
    case 'request.submission': {
      const who = str(d.name) || t('account.notif.someone');
      const parts = [t('account.notif.placed', { n: num(d.placed) }), num(d.rejected) > 0 ? t('account.notif.rejected', { n: num(d.rejected) }) : '', str(d.ref)].filter(Boolean);
      return { icon: 'inbox', tone: 'accent', title: t('account.notif.submission', { name: who, title: str(d.title) }), text: parts.join(' · '), href: str(d.requestId) ? `/requests/${str(d.requestId)}` : undefined };
    }
    default: return { icon: 'bell', tone: 'accent', title: n.kind };
  }
}

export function Notifications() {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: KEY, queryFn: () => get<Notification[]>('/notifications'), refetchInterval: 60_000 });
  const unread = q.data?.filter((n) => !n.read).length ?? 0;
  const read = useMutation({
    mutationFn: (ids?: string[]) => post('/notifications/read', ids ? { ids } : {}),
    onMutate: (ids) => { qc.setQueryData<Notification[]>(KEY, (l) => l?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))); },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const close = (refocus: boolean) => { setOpen(false); if (refocus) wrap.current?.querySelector<HTMLElement>('button')?.focus(); };
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    void q.refetch();
    const out = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', out);
    return () => window.removeEventListener('mousedown', out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const dot = { accent: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger' };
  return (
    <div ref={wrap} className="relative">
      <IconButton icon="bell" label={unread ? t('account.notif.bellUnread', { n: unread }) : t('account.notif.bell')} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} />
      {unread ? <span aria-hidden="true" data-testid="unread-count" className="pointer-events-none absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-none font-semibold text-white">{unread > 99 ? '99+' : unread}</span> : null}
      {open ? (
        <div ref={panel} role="dialog" aria-label={t('account.notif.title')} tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } }}
          className="anim-pop fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 flex max-h-[min(32rem,calc(100dvh-9rem))] flex-col rounded-2xl border border-line bg-raised shadow-pop outline-none sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[26rem]">
          <header className="flex items-center justify-between gap-3 border-b border-line py-2 pr-2 pl-4">
            <h2 className="text-sm font-semibold text-ink">{t('account.notif.title')}</h2>
            <div className="flex items-center">
              {unread ? <Button variant="ghost" size="sm" className="h-10" onClick={() => read.mutate(undefined)}>{t('account.notif.markAll')}</Button> : null}
              <IconButton icon="x" label={t('common.close')} onClick={() => close(true)} />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState icon="bell" title={t('account.notif.empty')} text={t('account.notif.emptyText')} /> : (
              <ul className="divide-y divide-line">
                {q.data.map((n) => {
                  const l = describe(n, t);
                  const body = (
                    <>
                      <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', dot[l.tone])}><Glyph name={l.icon} size={16} /></span>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-sm leading-snug text-ink', !n.read && 'font-semibold')}>{l.title}</span>
                        {l.text ? <span className="mt-0.5 block text-xs leading-snug break-words text-ink-2">{l.text}</span> : null}
                        <span className="mt-1 block text-xs text-ink-3">{fmtRelative(n.createdAt)}</span>
                      </span>
                      {!n.read ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"><span className="sr-only">{t('account.notif.unread')}</span></span> : null}
                    </>
                  );
                  const cls = 'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-hover focus-visible:bg-hover';
                  const mark = () => { if (!n.read) read.mutate([n.id]); };
                  return (
                    <li key={n.id} data-kind={n.kind}>
                      {l.href ? <Link href={l.href} className={cls} onClick={() => { mark(); close(false); }}>{body}</Link>
                        : n.read ? <div className={cls}>{body}</div>
                        : <button type="button" className={cls} onClick={mark} title={t('account.notif.markOne')}>{body}</button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
