/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/screens/Invite.tsx
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

// Account creation from a one-time invitation: a name, a passkey, then the recovery codes shown once.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ApiError, patch, post } from '../api.ts';
import { errorText, getLocale, useT } from '../i18n.ts';
import { AUTH_KEY, deviceLabel, PasskeyCancelled, passkeysSupported, register } from '../session.ts';
import { Alert, AuthFrame, linkCls, RecoveryCodesStep } from '../shell/account-ui.tsx';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../ui.tsx';

export function Invite({ token }: { token: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => post<{ email: string }>('/auth/invite', { invite: token }), staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false });
  const [name, setName] = useState('');
  const [label, setLabel] = useState(deviceLabel());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    const done = async () => { await qc.invalidateQueries({ queryKey: AUTH_KEY }); navigate('/', { replace: true }); };
    return (
      <AuthFrame wide title={t('account.codes.title')} subtitle={t('account.codes.intro')}>
        <RecoveryCodesStep codes={codes} email={invite.data?.email} onDone={() => void done()} doneLabel={t('account.invite.finish')} />
      </AuthFrame>
    );
  }
  if (invite.isLoading) return <Loading />;
  if (invite.error || !invite.data) {
    const e = invite.error;
    const invalid = e instanceof ApiError && (e.status === 403 || e.status === 400 || e.code === 'invite_invalid');
    return (
      <AuthFrame title={t('account.invite.title')}>
        {invalid
          ? <EmptyState icon="link" title={t('account.invite.invalidTitle')} text={t('account.invite.invalidText')} action={<Link href="/login" className={linkCls}>{t('account.invite.toLogin')}</Link>} />
          : <ErrorState error={e} onRetry={() => void invite.refetch()} />}
      </AuthFrame>
    );
  }
  const supported = passkeysSupported();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setFailure(null); setCancelled(false);
    try {
      const c = await register(token, name.trim(), label.trim());
      void patch('/account', { locale: getLocale() }).catch(() => undefined);
      setCodes(c);
    } catch (err) {
      if (err instanceof PasskeyCancelled) setCancelled(true);
      else if (err instanceof ApiError && err.code === 'invite_invalid') { setFailure(errorText(err)); void invite.refetch(); }
      else setFailure(errorText(err));
    } finally { setBusy(false); }
  };
  return (
    <AuthFrame title={t('account.invite.title')} subtitle={<>{t('account.invite.subtitle')} <strong className="font-semibold break-all text-ink">{invite.data.email}</strong></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!supported ? <Alert tone="warn">{t('account.login.unsupported')}</Alert> : null}
        {failure ? <Alert>{failure}</Alert> : null}
        <TextField label={t('account.invite.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} required autoComplete="name" autoFocus />
        <TextField label={t('account.passkey.name')} hint={t('account.passkey.nameHint')} value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={60} autoComplete="off" />
        <Button type="submit" variant="primary" size="lg" icon="key" busy={busy} disabled={!supported || !name.trim()} className="w-full">{t('account.invite.button')}</Button>
        {cancelled ? <p role="status" className="text-center text-sm text-ink-2">{t('account.login.cancelled')}</p> : null}
        <p className="text-xs leading-relaxed text-ink-3">{t('account.login.hint')}</p>
      </form>
    </AuthFrame>
  );
}
