/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/Members.tsx
 * Module           : next
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
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

// Private sharing of a folder: the accounts invited into it, their role, the workspace name and the folder's
// activity. Owner side (the member side is next/Shared.tsx). An invitation needs the exact address of an existing
// account: the server never lists accounts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, del, get, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtDate, useT } from '../i18n.ts';
import type { Folder } from '../types.ts';
import { Button, ConfirmDialog, cx, Dialog, ErrorState, Loading, useToast } from '../ui.tsx';
import { Timeline } from './Activity.tsx';
import type { Member, Role } from './types.ts';

export const ROLES: Role[] = ['viewer', 'editor', 'uploader'];
export const ROLE_ICON: Record<Role, string> = { viewer: 'eye', editor: 'pencil', uploader: 'upload' };
const fieldCls = 'h-11 w-full min-w-0 rounded-[10px] border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:h-9 sm:text-[13px]';
export const membersKey = (id: string) => ['next', 'members', id];

export function RolePicker({ value, onChange, label, disabled }: { value: Role; onChange: (r: Role) => void; label: string; disabled?: boolean }) {
  const t = useT();
  return <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)} className={cx(fieldCls, 'w-auto! pr-8')}>{ROLES.map((r) => <option key={r} value={r}>{t(`next.role.${r}`)}</option>)}</select>;
}

export function MembersPanel({ folderId }: { folderId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: membersKey(folderId), queryFn: () => get<{ folder: Folder & { workspaceName?: string | null }; members: Member[] }>(`/folders/${folderId}/members`) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [ws, setWs] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: membersKey(folderId) }), qc.invalidateQueries({ queryKey: ['next', 'outgoing'] }), qc.invalidateQueries({ queryKey: ['next', 'activity'] }), qc.invalidateQueries({ queryKey: ['explorer'] })]);
  const add = useMutation({
    mutationFn: () => post<Member>(`/folders/${folderId}/members`, { email: email.trim(), role }),
    onSuccess: async (m) => { setEmail(''); setError(null); await refresh(); toast(t('next.mem.added', { name: m.displayName }), { tone: 'ok' }); },
    onError: (e) => setError(e instanceof ApiError && e.status === 404 ? t('next.mem.notFound') : e instanceof ApiError && e.code === 'already_member' ? t('next.mem.already') : e instanceof ApiError && e.code === 'root_immutable' ? t('next.mem.root') : errorText(e)),
  });
  const setMemberRole = async (m: Member, r: Role) => { try { await patch(`/folders/${folderId}/members/${m.userId}`, { role: r }); await refresh(); } catch (e) { toast(errorText(e), { tone: 'error' }); } };
  const saveWs = async () => { try { await patch(`/folders/${folderId}/workspace`, { name: (ws ?? '').trim() || null }); setWs(null); await refresh(); toast(t('next.mem.wsSaved'), { tone: 'ok' }); } catch (e) { toast(errorText(e), { tone: 'error' }); } };
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { members, folder } = q.data;
  const submit = (e: FormEvent) => { e.preventDefault(); if (email.trim()) add.mutate(); };
  const wsValue = ws ?? folder.workspaceName ?? '';
  return (
    <div className="flex flex-col gap-5" data-testid="members">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="spd-member-email" className="text-[13px] font-medium text-ink">{t('next.mem.invite')}</label>
        <div className="flex flex-wrap gap-2">
          <input id="spd-member-email" type="email" inputMode="email" autoComplete="off" autoCapitalize="off" spellCheck={false} required value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder={t('next.mem.emailPlaceholder')} aria-invalid={!!error || undefined} aria-describedby="spd-member-hint" className={cx(fieldCls, 'flex-1 basis-52')} />
          <RolePicker value={role} onChange={setRole} label={t('next.mem.role')} />
          <Button type="submit" variant="primary" icon="plus" busy={add.isPending}>{t('next.mem.add')}</Button>
        </div>
        {error ? <p role="alert" id="spd-member-hint" className="text-xs text-danger">{error}</p> : <p id="spd-member-hint" className="text-xs text-ink-3">{t('next.mem.hint')}</p>}
      </form>

      <section aria-label={t('next.mem.title')}>
        <h3 className="spd-eyebrow mb-1.5">{t('next.mem.count', { n: members.length })}</h3>
        {members.length ? (
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {members.map((m) => (
              <li key={m.grantId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="member" data-role={m.role}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selection text-[12px] font-semibold text-accent" aria-hidden="true">{m.displayName.trim().slice(0, 1).toUpperCase() || '·'}</span>
                <div className="min-w-0 flex-1 basis-40"><p className="truncate text-[13px] font-medium text-ink">{m.displayName}</p><p className="truncate text-xs text-ink-3">{m.email} · {fmtDate(m.createdAt, { dateStyle: 'medium' })}</p></div>
                <RolePicker value={m.role} onChange={(r) => void setMemberRole(m, r)} label={t('next.mem.roleOf', { name: m.displayName })} />
                <button type="button" onClick={() => setRemoving(m)} aria-label={t('next.mem.removeNamed', { name: m.displayName })} title={t('next.mem.remove')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"><Glyph name="x" size={16} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-ink-2">{t('next.mem.none')}</p>}
        <dl className="mt-3 grid gap-1 text-xs text-ink-3 sm:grid-cols-3">
          {ROLES.map((r) => <div key={r} className="flex items-start gap-1.5"><Glyph name={ROLE_ICON[r]} size={13} className="mt-0.5 shrink-0" /><div><dt className="inline font-medium text-ink-2">{t(`next.role.${r}`)}</dt> <dd className="inline">— {t(`next.role.${r}Hint`)}</dd></div></div>)}
        </dl>
      </section>

      <section>
        <label htmlFor="spd-ws-name" className="text-[13px] font-medium text-ink">{t('next.mem.wsLabel')}</label>
        <div className="mt-1.5 flex gap-2">
          <input id="spd-ws-name" value={wsValue} maxLength={80} onChange={(e) => setWs(e.target.value)} placeholder={folder.name} className={cx(fieldCls, 'flex-1')} />
          <Button disabled={ws === null || ws.trim() === (folder.workspaceName ?? '')} onClick={() => void saveWs()}>{t('common.save')}</Button>
        </div>
        <p className="mt-1.5 text-xs text-ink-3">{t('next.mem.wsHint')}</p>
      </section>
      {removing ? <ConfirmDialog danger title={t('next.mem.removeTitle', { name: removing.displayName })} text={t('next.mem.removeText')} confirmLabel={t('next.mem.remove')} onClose={() => setRemoving(null)}
        onConfirm={async () => { await del(`/folders/${folderId}/members/${removing.userId}`); await refresh(); }} /> : null}
    </div>
  );
}

export function MembersDialog({ folder, onClose }: { folder: { id: string; name: string }; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<'members' | 'activity'>('members');
  return (
    <Dialog title={t('next.mem.dialogTitle', { name: folder.name })} onClose={onClose} wide testId="members-dialog">
      <div role="tablist" aria-label={t('next.mem.dialogTitle', { name: folder.name })} className="mb-4 flex gap-1 border-b border-line pb-2">
        {(['members', 'activity'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('h-9 rounded-lg px-3 text-[13px] transition-colors', tab === k ? 'bg-selection font-medium text-ink' : 'text-ink-2 hover:bg-hover')}>{t(k === 'members' ? 'next.mem.title' : 'next.mem.activity')}</button>)}
      </div>
      {tab === 'members' ? <MembersPanel folderId={folder.id} /> : <div style={{ ['--tl-bg' as string]: 'var(--spd-color-surface-raised)' }}><Timeline path={`/folders/${folder.id}/activity`} queryKey={['folder', folder.id]} withTarget dense /></div>}
    </Dialog>
  );
}
