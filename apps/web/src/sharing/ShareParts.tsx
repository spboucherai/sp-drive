/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/sharing/ShareParts.tsx
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

// One share link as the owner sees it (status, counters, actions) and the form that creates or edits a link.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { ApiError, del, get, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtDate, fmtRelative, useT } from '../i18n.ts';
import type { Share, ShareEvent } from '../types.ts';
import { Badge, Button, ConfirmDialog, Dialog, ErrorState, IconButton, Loading, Menu, Switch, TextField, useToast } from '../ui.tsx';
import { type ExpiryChoice, ExpiryField, LinkOnce, NumberField, resolveExpiry, toLocalInput, uaSummary } from './common.tsx';

export const SHARE_TONE: Record<Share['status'], 'ok' | 'danger' | 'warn' | 'neutral'> = { active: 'ok', revoked: 'danger', expired: 'warn', exhausted: 'warn', target_missing: 'neutral' };
export const useInvalidateShares = () => { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ['shares'] }); };

type Target = { type: 'file' | 'folder'; id: string };
/** Create (`target`) or edit (`share`) the settings of a link. */
export function ShareForm({ target, share, onDone, onCancel }: { target?: Target; share?: Share; onDone: (r: { share: Share; url?: string }) => void; onCancel: () => void }) {
  const t = useT();
  const [label, setLabel] = useState(share?.label ?? '');
  const [canDownload, setCanDownload] = useState(share?.canDownload ?? true);
  const [password, setPassword] = useState('');
  const [dropPassword, setDropPassword] = useState(false);
  const [choice, setChoice] = useState<ExpiryChoice>(share?.expiresAt ? 'date' : 'never');
  const [date, setDate] = useState(toLocalInput(share?.expiresAt));
  const [maxViews, setMaxViews] = useState(share?.maxViews?.toString() ?? '');
  const [maxDownloads, setMaxDownloads] = useState(share?.maxDownloads?.toString() ?? '');
  const [singleUse, setSingleUse] = useState(share?.singleUse ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const int = (v: string, k: string) => { if (!v.trim()) return null; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1_000_000) { errs[k] = t('sharing.form.badNumber'); return null; } return n; };
    const views = int(maxViews, 'maxViews'), downloads = int(maxDownloads, 'maxDownloads');
    if (password && password.length < 4) errs.password = t('sharing.form.passwordShort');
    const expiresAt = resolveExpiry(choice, date);
    if (choice === 'date' && !expiresAt) errs.expiry = t('sharing.form.badDate');
    else if (expiresAt && new Date(expiresAt) <= new Date() && (!share || expiresAt !== share.expiresAt)) errs.expiry = t('common.error.bad_expiry');
    setErrors(errs);
    if (Object.keys(errs).length) { requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    const body = {
      label: label.trim(), canDownload, expiresAt: share && choice === 'date' && toLocalInput(share.expiresAt) === date ? share.expiresAt : expiresAt, maxViews: views, maxDownloads: canDownload ? downloads : null, singleUse,
      password: password ? password : share ? (dropPassword ? null : undefined) : undefined,
    };
    setBusy(true);
    try {
      if (share) onDone({ share: await patch<Share>(`/shares/${share.id}`, body) });
      else onDone(await post<{ share: Share; url: string }>('/shares', { ...body, [target!.type === 'file' ? 'fileId' : 'folderId']: target!.id }));
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiError && x.code === 'bad_expiry') setErrors({ expiry: errorText(x) }); else setErrors({ form: errorText(x) });
    }
  };
  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-4" data-testid="share-form">
      <TextField label={t('sharing.form.label')} hint={t('sharing.form.labelHint')} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} data-autofocus />
      <Switch label={t('sharing.form.canDownload')} hint={canDownload ? t('sharing.form.canDownloadOn') : t('sharing.form.canDownloadOff')} checked={canDownload} onChange={setCanDownload} />
      <TextField label={share?.hasPassword ? t('sharing.form.passwordChange') : t('sharing.form.password')} hint={share?.hasPassword ? t('sharing.form.passwordKeep') : t('sharing.form.passwordHint')} value={password} maxLength={200}
        onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={dropPassword} />
      {share?.hasPassword ? <Switch label={t('sharing.form.passwordRemove')} checked={dropPassword} onChange={(v) => { setDropPassword(v); if (v) setPassword(''); }} /> : null}
      <ExpiryField choice={choice} date={date} onChange={(c, d) => { setChoice(c); setDate(d); }} error={errors.expiry} />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label={t('sharing.form.maxViews')} placeholder={t('sharing.form.unlimited')} value={maxViews} onChange={setMaxViews} max={1_000_000} error={errors.maxViews} />
        {canDownload ? <NumberField label={t('sharing.form.maxDownloads')} placeholder={t('sharing.form.unlimited')} value={maxDownloads} onChange={setMaxDownloads} max={1_000_000} error={errors.maxDownloads} /> : null}
      </div>
      <Switch label={t('sharing.form.singleUse')} hint={t('sharing.form.singleUseHint')} checked={singleUse} onChange={setSingleUse} />
      {errors.form ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{errors.form}</p> : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" busy={busy} icon={share ? 'check' : 'link'}>{share ? t('common.save') : t('sharing.form.create')}</Button>
      </div>
    </form>
  );
}

/** Access journal of one link. */
export function ShareEventsDialog({ share, onClose }: { share: Share; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ['shares', 'events', share.id], queryFn: () => get<ShareEvent[]>(`/shares/${share.id}/events`), staleTime: 0 });
  return (
    <Dialog title={t('sharing.events.title', { name: share.label || share.targetName })} onClose={onClose} wide footer={<><Button icon="refresh" onClick={() => void q.refetch()} busy={q.isFetching}>{t('sharing.refresh')}</Button><Button variant="primary" onClick={onClose}>{t('common.close')}</Button></>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <p className="py-10 text-center text-sm text-ink-3">{t('sharing.events.empty')}</p> : (
        <ul className="divide-y divide-line" data-testid="share-events">
          {q.data.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2.5" data-kind={e.kind} data-ok={e.ok}>
              <Glyph name={e.kind === 'download' ? 'download' : e.kind === 'password' ? 'lock' : 'eye'} size={18} className={e.ok ? 'mt-0.5 shrink-0 text-ink-3' : 'mt-0.5 shrink-0 text-danger'} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{t(`sharing.events.${e.kind}`)}<Badge tone={e.ok ? 'ok' : 'danger'}>{e.ok ? t('sharing.events.ok') : e.detail === 'limit' ? t('sharing.events.refusedLimit') : t('sharing.events.refused')}</Badge></p>
                <p className="text-xs text-ink-3">{fmtDate(e.at, { dateStyle: 'medium', timeStyle: 'medium' })} · {e.ip || '—'} · {uaSummary(e.userAgent, t('sharing.events.unknownDevice'))}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

type Sub = { kind: 'edit' } | { kind: 'events' } | { kind: 'revoke' } | { kind: 'purge' } | { kind: 'rotate' } | { kind: 'url'; url: string } | null;
/** One link: what it allows, how much it was used, and every action on it. */
export function ShareItem({ share, heading }: { share: Share; heading?: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateShares();
  const [sub, setSub] = useState<Sub>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const live = !share.revokedAt;
  const name = share.label || share.targetName;
  return (
    <article className="card p-5" data-testid="share-item" data-status={share.status}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {heading}
          <p className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">{share.label || t('sharing.item.untitled')}</span>
            <Badge tone={SHARE_TONE[share.status]}><span title={t(`sharing.statusHint.${share.status}`)}>{t(`sharing.status.${share.status}`)}</span></Badge>
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
            <span className="inline-flex items-center gap-1"><Glyph name={share.canDownload ? 'download' : 'eye'} size={14} />{share.canDownload ? t('sharing.item.download') : t('sharing.item.viewOnly')}</span>
            {share.hasPassword ? <span className="inline-flex items-center gap-1"><Glyph name="lock" size={14} />{t('sharing.item.password')}</span> : null}
            {share.singleUse ? <span>{t('sharing.item.singleUse')}</span> : null}
            <span>{share.expiresAt ? t(new Date(share.expiresAt) < new Date() ? 'sharing.item.expired' : 'sharing.item.expires', { date: fmtDate(share.expiresAt) }) : t('sharing.item.noExpiry')}</span>
          </p>
          <p className="mt-1 text-xs text-ink-3" data-testid="share-counters">
            {t('sharing.item.views', { n: share.viewCount })}{share.maxViews !== null ? ` / ${share.maxViews}` : ''} · {t('sharing.item.downloads', { n: share.downloadCount })}{share.maxDownloads !== null ? ` / ${share.maxDownloads}` : ''}
            {' · '}{share.lastAccessAt ? t('sharing.item.lastAccess', { when: fmtRelative(share.lastAccessAt) }) : t('sharing.item.neverUsed')} · {t('sharing.item.created', { date: fmtDate(share.createdAt, { dateStyle: 'medium' }) })}
          </p>
        </div>
        <IconButton icon="dots" label={t('sharing.item.actions', { name })} onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} className="-mt-1 -mr-2" />
      </div>
      <p className="mt-2 text-xs text-ink-3">{t(`sharing.statusHint.${share.status}`)}</p>
      {menu ? <span onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}><Menu anchor={menu} label={t('sharing.item.actions', { name })} onClose={() => setMenu(null)} items={[
        ...(live ? [{ label: t('sharing.item.edit'), icon: 'pencil', onSelect: () => setSub({ kind: 'edit' }) }, { label: t('sharing.item.rotate'), icon: 'refresh', onSelect: () => setSub({ kind: 'rotate' }) }] : []),
        { label: t('sharing.item.journal'), icon: 'history', onSelect: () => setSub({ kind: 'events' }) },
        ...(live ? [{ label: t('sharing.item.revoke'), icon: 'x', danger: true, separatorBefore: true, onSelect: () => setSub({ kind: 'revoke' }) }] : []),
        { label: t('sharing.item.purge'), icon: 'trash', danger: true, separatorBefore: !live, onSelect: () => setSub({ kind: 'purge' }) },
      ]} /></span> : null}
      {sub?.kind === 'edit' ? <Dialog title={t('sharing.item.editTitle')} onClose={() => setSub(null)}><ShareForm share={share} onCancel={() => setSub(null)} onDone={() => { void invalidate(); setSub(null); toast(t('sharing.saved'), { tone: 'ok' }); }} /></Dialog> : null}
      {sub?.kind === 'events' ? <ShareEventsDialog share={share} onClose={() => setSub(null)} /> : null}
      {sub?.kind === 'rotate' ? <ConfirmDialog title={t('sharing.item.rotate')} text={t('sharing.item.rotateText')} confirmLabel={t('sharing.item.rotateConfirm')} onClose={() => setSub((s) => (s?.kind === 'rotate' ? null : s))}
        onConfirm={async () => { const r = await post<{ url: string }>(`/shares/${share.id}/rotate`); void invalidate(); setSub({ kind: 'url', url: r.url }); }} /> : null}
      {sub?.kind === 'url' ? <Dialog title={t('sharing.link.newTitle')} onClose={() => setSub(null)} footer={<Button variant="primary" onClick={() => setSub(null)}>{t('sharing.link.done')}</Button>}><LinkOnce url={sub.url} title={name} /></Dialog> : null}
      {sub?.kind === 'revoke' ? <ConfirmDialog danger title={t('sharing.item.revoke')} text={t('sharing.item.revokeText')} confirmLabel={t('sharing.item.revoke')} onClose={() => setSub(null)}
        onConfirm={async () => { await del(`/shares/${share.id}`); void invalidate(); toast(t('sharing.item.revoked'), { tone: 'ok' }); }} /> : null}
      {sub?.kind === 'purge' ? <ConfirmDialog danger title={t('sharing.item.purge')} text={t('sharing.item.purgeText')} confirmLabel={t('common.delete')} onClose={() => setSub(null)}
        onConfirm={async () => { await del(`/shares/${share.id}?purge=1`); void invalidate(); toast(t('sharing.item.purged'), { tone: 'ok' }); }} /> : null}
    </article>
  );
}
