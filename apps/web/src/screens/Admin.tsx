// Administration: accounts and quotas, invitations, and the state of the system.
import { formatBytes } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { del, get, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtDate, fmtRelative, getLocale, useT } from '../i18n.ts';
import { useAuth } from '../session.ts';
import { Alert, Page, Section, sensitive } from '../shell/account-ui.tsx';
import { Badge, Button, ConfirmDialog, CopyField, cx, Dialog, EmptyState, ErrorState, IconButton, Loading, ProgressBar, Select, Switch, TextField, useToast } from '../ui.tsx';

interface AdminUser { id: string; email: string; displayName: string; role: 'admin' | 'user'; disabled: boolean; createdAt: string; quota: number; used: number; passkeys: number }
interface InviteRow { id: string; email: string; role: 'admin' | 'user'; expiresAt: string; usedAt: string | null; createdAt: string }
interface System {
  db: boolean; storage: { ok: boolean; freeBytes: number; totalBytes: number }; antivirus: boolean; queueLagS: number; failedJobs: number; avMode: 'required' | 'optional'; commit?: string | null;
  counts: { users: number; files: number; objects: number; bytes: number; shares: number; requests: number; quarantined: number };
}
const GIB = 1024 ** 3;
const toGb = (bytes: number) => String(Math.round((bytes / GIB) * 100) / 100);
const fromGb = (s: string): number | null => { const n = Number(s.replace(',', '.')); return s.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 900_000 ? Math.round(n * GIB) : null; };

// --- users ---------------------------------------------------------------------------------------------------
function EditUser({ user, self, onClose, onSaved }: { user: AdminUser; self: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [gb, setGb] = useState(toGb(user.quota));
  const [role, setRole] = useState(user.role);
  const [disabled, setDisabled] = useState(user.disabled);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const bytes = fromGb(gb);
  const body = { ...(bytes !== null && bytes !== user.quota ? { quotaBytes: bytes } : {}), ...(role !== user.role ? { role } : {}), ...(disabled !== user.disabled ? { disabled } : {}) };
  const dirty = Object.keys(body).length > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (bytes === null || !dirty) return;
    setBusy(true); setFailure(null);
    try { await sensitive(() => patch(`/admin/users/${user.id}`, body), t('account.reauth.cancelled')); onSaved(); onClose(); } catch (err) { setFailure(errorText(err)); setBusy(false); }
  };
  return (
    <Dialog title={t('account.admin.editTitle', { name: user.displayName })} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm break-all text-ink-2">{user.email}</p>
        {failure ? <Alert>{failure}</Alert> : null}
        <TextField label={t('account.admin.quotaGb')} hint={t('account.admin.quotaHint', { used: formatBytes(user.used, getLocale()) })} value={gb} onChange={(e) => setGb(e.currentTarget.value)} inputMode="decimal" autoComplete="off" data-autofocus
          error={bytes === null ? t('account.admin.quotaInvalid') : null} />
        <Select label={t('account.admin.role')} value={role} disabled={self} hint={self ? t('account.admin.selfHint') : undefined} onChange={(e) => setRole(e.currentTarget.value as AdminUser['role'])}>
          <option value="user">{t('account.admin.role.user')}</option>
          <option value="admin">{t('account.admin.role.admin')}</option>
        </Select>
        <Switch label={t('account.admin.disable')} hint={t('account.admin.disableHint')} checked={disabled} disabled={self} onChange={setDisabled} />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" variant="primary" busy={busy} disabled={!dirty || bytes === null}>{t('common.save')}</Button></div>
      </form>
    </Dialog>
  );
}

function Usage({ u }: { u: AdminUser }) {
  const l = getLocale();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs whitespace-nowrap text-ink-2">{formatBytes(u.used, l)} / {formatBytes(u.quota, l)}</span>
      <ProgressBar value={u.quota > 0 ? u.used / u.quota : 0} />
    </div>
  );
}
function Users() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { state } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<AdminUser[]>('/admin/users') });
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const badges = (u: AdminUser) => <>{u.role === 'admin' ? <Badge tone="accent">{t('account.admin.role.admin')}</Badge> : <Badge>{t('account.admin.role.user')}</Badge>}{u.disabled ? <Badge tone="danger">{t('account.admin.disabled')}</Badge> : null}</>;
  const th = 'px-3 py-2 text-left text-xs font-medium tracking-wide text-ink-3 uppercase';
  return (
    <Section title={t('account.admin.users')} text={q.data ? t('account.admin.usersCount', { n: q.data.length }) : undefined}>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? <EmptyState icon="users" title={t('account.admin.noUsers')} /> : (
        <>
          <div className="-mx-2 hidden md:block">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead><tr className="border-b border-line">
                <th scope="col" className={cx(th, 'w-[36%]')}>{t('account.admin.col.user')}</th><th scope="col" className={cx(th, 'w-[20%]')}>{t('account.admin.col.role')}</th>
                <th scope="col" className={cx(th, 'w-[24%]')}>{t('account.admin.col.storage')}</th><th scope="col" className={cx(th, 'w-[10%]')}>{t('account.admin.col.passkeys')}</th><th scope="col" className="w-[10%]"><span className="sr-only">{t('common.edit')}</span></th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.map((u) => (
                  <tr key={u.id} data-testid="admin-user" data-email={u.email} className={cx(u.disabled && 'opacity-70')}>
                    <td className="px-3 py-2.5"><p className="truncate font-medium text-ink">{u.displayName}</p><p className="truncate text-xs text-ink-3">{u.email}</p></td>
                    <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{badges(u)}</div></td>
                    <td className="px-3 py-2.5"><Usage u={u} /></td>
                    <td className="px-3 py-2.5 text-ink-2">{u.passkeys}</td>
                    <td className="px-1 py-1 text-right"><IconButton icon="pencil" label={t('account.admin.edit', { name: u.displayName })} onClick={() => setEditing(u)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {q.data.map((u) => (
              <li key={u.id} data-testid="admin-user" data-email={u.email} className="flex items-start gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div><p className="truncate text-sm font-medium text-ink">{u.displayName}</p><p className="truncate text-xs text-ink-3">{u.email}</p></div>
                  <div className="flex flex-wrap items-center gap-1">{badges(u)}<span className="ml-1 text-xs text-ink-3">{t('account.admin.passkeysN', { n: u.passkeys })}</span></div>
                  <Usage u={u} />
                </div>
                <IconButton icon="pencil" label={t('account.admin.edit', { name: u.displayName })} onClick={() => setEditing(u)} />
              </li>
            ))}
          </ul>
        </>
      )}
      {editing ? <EditUser user={editing} self={editing.id === state?.user?.id} onClose={() => setEditing(null)}
        onSaved={() => { void qc.invalidateQueries({ queryKey: ['admin', 'users'] }); void qc.invalidateQueries({ queryKey: ['auth'] }); toast(t('account.admin.saved'), { tone: 'ok' }); }} /> : null}
    </Section>
  );
}

// --- invitations ---------------------------------------------------------------------------------------------
function NewInvite({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [gb, setGb] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const bytes = gb.trim() === '' ? undefined : fromGb(gb);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && bytes !== null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setFailure(null);
    try {
      const r = await sensitive(() => post<{ id: string; url: string }>('/admin/invites', { email: email.trim(), role, ...(bytes !== undefined && bytes !== null ? { quotaBytes: bytes } : {}) }), t('account.reauth.cancelled'));
      setUrl(r.url); onCreated();
    } catch (err) { setFailure(errorText(err)); }
    setBusy(false);
  };
  if (url) return (
    // its own key: a new dialog instance, so that focus moves into it (the form that held the focus is gone)
    <Dialog key="ready" title={t('account.admin.inviteReady')} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('account.admin.inviteDone')}</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-2">{t('account.admin.inviteReadyText', { email: email.trim() })}</p>
        <CopyField value={url} label={t('account.admin.inviteLink')} />
        <Alert tone="warn">{t('account.admin.inviteOnce')}</Alert>
      </div>
    </Dialog>
  );
  return (
    <Dialog key="form" title={t('account.admin.inviteNew')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {failure ? <Alert>{failure}</Alert> : null}
        <TextField label={t('account.admin.inviteEmail')} type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="off" inputMode="email" autoCapitalize="off" maxLength={200} required data-autofocus />
        <Select label={t('account.admin.role')} value={role} onChange={(e) => setRole(e.currentTarget.value as 'user' | 'admin')}>
          <option value="user">{t('account.admin.role.user')}</option>
          <option value="admin">{t('account.admin.role.admin')}</option>
        </Select>
        <TextField label={t('account.admin.quotaGb')} hint={t('account.admin.inviteQuotaHint')} value={gb} onChange={(e) => setGb(e.currentTarget.value)} inputMode="decimal" autoComplete="off" error={bytes === null ? t('account.admin.quotaInvalid') : null} />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" variant="primary" busy={busy} disabled={!valid}>{t('account.admin.inviteCreate')}</Button></div>
      </form>
    </Dialog>
  );
}
function Invites() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'invites'], queryFn: () => get<InviteRow[]>('/admin/invites') });
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<InviteRow | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
  return (
    <Section title={t('account.admin.invites')} text={t('account.admin.invitesText')} action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t('account.admin.inviteNew')}</Button>}>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? <EmptyState icon="link" title={t('account.admin.noInvites')} text={t('account.admin.noInvitesText')} /> : (
        <ul className="divide-y divide-line" aria-label={t('account.admin.invites')}>
          {q.data.map((i) => {
            const expired = !i.usedAt && new Date(i.expiresAt).getTime() < Date.now();
            return (
              <li key={i.id} data-testid="admin-invite" data-email={i.email} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink"><span className="min-w-0 truncate">{i.email}</span>
                    {i.usedAt ? <Badge tone="ok">{t('account.admin.inviteUsed')}</Badge> : expired ? <Badge tone="danger">{t('account.admin.inviteExpired')}</Badge> : <Badge tone="accent">{t('account.admin.invitePending')}</Badge>}
                    {i.role === 'admin' ? <Badge>{t('account.admin.role.admin')}</Badge> : null}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{i.usedAt ? t('account.admin.inviteUsedOn', { date: fmtDate(i.usedAt) }) : expired ? t('account.admin.inviteExpiredOn', { date: fmtDate(i.expiresAt) }) : t('account.admin.inviteExpires', { when: fmtRelative(i.expiresAt) })}</p>
                </div>
                {i.usedAt ? <span className="w-10" /> : <IconButton icon="trash" label={t('account.admin.inviteDelete', { email: i.email })} onClick={() => setRemoving(i)} />}
              </li>
            );
          })}
        </ul>
      )}
      {creating ? <NewInvite onClose={() => setCreating(false)} onCreated={() => void reload()} /> : null}
      {removing ? <ConfirmDialog danger title={t('account.admin.inviteDeleteTitle')} text={t('account.admin.inviteDeleteText', { email: removing.email })} confirmLabel={t('common.delete')} onClose={() => setRemoving(null)}
        onConfirm={async () => { await del(`/admin/invites/${removing.id}`); await reload(); toast(t('account.admin.inviteDeleted'), { tone: 'ok' }); }} /> : null}
    </Section>
  );
}

// --- system --------------------------------------------------------------------------------------------------
function Stat({ label, value, tone, detail }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'danger'; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-bg px-3.5 py-3">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">{tone ? <span aria-hidden="true" className={cx('h-2 w-2 shrink-0 rounded-full', tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-danger')} /> : null}<span className="min-w-0 truncate">{value}</span></span>
        {detail ? <span className="text-xs break-words text-ink-3">{detail}</span> : null}
      </dd>
    </div>
  );
}
function SystemCard() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'system'], queryFn: () => get<System>('/admin/system'), refetchInterval: 30_000 });
  const l = getLocale();
  const s = q.data;
  const n = (v: number) => new Intl.NumberFormat(l).format(v);
  return (
    <Section title={t('account.system.title')} text={s?.commit ? t('account.system.version', { commit: s.commit.slice(0, 12) }) : undefined}
      action={<IconButton icon="refresh" label={t('account.system.refresh')} disabled={q.isFetching} onClick={() => void q.refetch()} />}>
      {q.isLoading ? <Loading /> : q.error || !s ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="flex flex-col gap-4" data-testid="system">
          <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            <Stat label={t('account.system.db')} tone={s.db ? 'ok' : 'danger'} value={s.db ? t('account.system.up') : t('account.system.down')} />
            <Stat label={t('account.system.storage')} tone={!s.storage.ok ? 'danger' : s.storage.totalBytes && s.storage.freeBytes / s.storage.totalBytes < 0.1 ? 'warn' : 'ok'}
              value={s.storage.ok ? t('account.system.free', { free: formatBytes(s.storage.freeBytes, l) }) : t('account.system.down')} detail={s.storage.ok ? t('account.system.total', { total: formatBytes(s.storage.totalBytes, l) }) : undefined} />
            <Stat label={t('account.system.antivirus')} tone={s.antivirus ? 'ok' : s.avMode === 'optional' ? 'warn' : 'danger'} value={s.antivirus ? t('account.system.up') : t('account.system.down')}
              detail={s.avMode === 'required' ? t('account.system.avRequired') : t('account.system.avOptional')} />
            <Stat label={t('account.system.queue')} tone={s.queueLagS > 120 ? 'warn' : 'ok'} value={s.queueLagS > 0 ? t('account.system.lag', { n: s.queueLagS }) : t('account.system.noLag')} />
            <Stat label={t('account.system.failed')} tone={s.failedJobs > 0 ? 'warn' : 'ok'} value={n(s.failedJobs)} />
            <Stat label={t('account.system.quarantined')} tone={s.counts.quarantined > 0 ? 'warn' : 'ok'} value={n(s.counts.quarantined)} />
          </dl>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {([['users', s.counts.users], ['files', s.counts.files], ['objects', s.counts.objects], ['shares', s.counts.shares], ['requests', s.counts.requests]] as const).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line pb-2"><dt className="min-w-0 truncate text-ink-2">{t(`account.system.count.${k}`)}</dt><dd className="font-semibold text-ink">{n(v)}</dd></div>
            ))}
            <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2"><dt className="min-w-0 truncate text-ink-2">{t('account.system.count.bytes')}</dt><dd className="font-semibold whitespace-nowrap text-ink">{formatBytes(s.counts.bytes, l)}</dd></div>
          </dl>
        </div>
      )}
    </Section>
  );
}

export function Admin() {
  const t = useT();
  return (
    <Page wide title={t('account.admin.title')} text={t('account.admin.subtitle')}>
      <SystemCard />
      <Users />
      <Invites />
    </Page>
  );
}
