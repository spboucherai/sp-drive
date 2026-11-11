// Account settings: profile, security (passkeys, recovery codes, authenticator app), devices, activity.
import { formatBytes } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, Redirect } from 'wouter';
import { del, get, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtDate, fmtRelative, getLocale, type Locale, useT } from '../i18n.ts';
import { addPasskey, deviceLabel, PasskeyCancelled, passkeysSupported, useAuth, useRefreshAuth } from '../session.ts';
import { Alert, changeLocale, Page, RecoveryCodesStep, Section, sensitive, summariseUA } from '../shell/account-ui.tsx';
import { setTheme, type ThemeChoice, useTheme } from '../theme.ts';
import { Badge, Button, ConfirmDialog, CopyField, cx, Dialog, EmptyState, ErrorState, IconButton, Loading, ProgressBar, Select, TextField, useToast } from '../ui.tsx';

const TABS = [{ id: 'profil', icon: 'user' }, { id: 'securite', icon: 'shield' }, { id: 'appareils', icon: 'laptop' }, { id: 'activite', icon: 'activity' }] as const;
type TabId = (typeof TABS)[number]['id'];

interface Passkey { id: string; label: string; deviceType: string; backedUp: boolean; transports: string[]; createdAt: string; lastUsedAt: string | null }
interface SessionRow { id: string; createdAt: string; lastSeenAt: string; ip: string; userAgent: string; method: string; current: boolean }
interface Security { recoveryCodesLeft: number; totpEnabled: boolean }
interface Activity { id: string; at: string; action: string; ip: string; userAgent: string; meta: unknown }

const row = 'flex items-center gap-3 py-3';
const rows = 'divide-y divide-line';

// --- profile -------------------------------------------------------------------------------------------------
function Profile() {
  const t = useT();
  const toast = useToast();
  const { state } = useAuth();
  const refresh = useRefreshAuth();
  const { choice } = useTheme();
  const user = state?.user;
  const [name, setName] = useState(user?.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!user) return <Loading />;
  const dirty = name.trim() !== user.display_name && name.trim().length > 0;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true); setFailure(null);
    try { await patch('/account', { displayName: name.trim() }); await refresh(); toast(t('account.profile.saved'), { tone: 'ok' }); } catch (err) { setFailure(errorText(err)); }
    setBusy(false);
  };
  const q = state.quota;
  const ratio = q && q.limit > 0 ? q.used / q.limit : 0;
  const themes: { id: ThemeChoice; icon: string }[] = [{ id: 'light', icon: 'sun' }, { id: 'dark', icon: 'moon' }, { id: 'system', icon: 'laptop' }];
  return (
    <>
      <Section title={t('account.profile.identity')}>
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <TextField label={t('account.profile.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} autoComplete="name" error={failure} />
          <TextField label={t('account.profile.email')} value={user.email} readOnly disabled hint={t('account.profile.emailHint')} />
          <div><Button type="submit" variant="primary" busy={busy} disabled={!dirty}>{t('common.save')}</Button></div>
        </form>
      </Section>
      <Section title={t('account.profile.appearance')}>
        <div className="flex flex-col gap-5">
          <Select label={t('account.profile.language')} value={getLocale()} onChange={(e) => { changeLocale(e.currentTarget.value as Locale, true); void refresh(); }}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </Select>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">{t('account.profile.theme')}</legend>
            <div className="grid grid-cols-3 gap-2">
              {themes.map((x) => (
                <label key={x.id} className={cx('flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
                  choice === x.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover')}>
                  <input type="radio" name="theme" value={x.id} checked={choice === x.id} onChange={() => setTheme(x.id)} className="sr-only" />
                  <Glyph name={x.icon} size={18} className="shrink-0" /><span className="truncate">{t(`account.theme.${x.id}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Section>
      {q ? (
        <Section title={t('account.profile.storage')}>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink"><span className="text-2xl font-semibold tracking-tight">{formatBytes(q.used, getLocale())}</span> <span className="text-ink-2">{t('account.quota.of', { limit: formatBytes(q.limit, getLocale()) })}</span></p>
            <ProgressBar value={ratio} label={t('account.profile.storage')} />
            <p className="text-xs text-ink-3">{t('account.profile.storageHint')}</p>
          </div>
        </Section>
      ) : null}
    </>
  );
}

// --- security ------------------------------------------------------------------------------------------------
function PasskeyNameDialog({ title, initial, confirm, icon, onSubmit, onClose }: { title: string; initial: string; confirm: string; icon?: string; onSubmit: (label: string) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [label, setLabel] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true); setFailure(null);
    try { await onSubmit(label.trim()); onClose(); } catch (err) { setFailure(err instanceof PasskeyCancelled ? t('account.reauth.cancelled') : errorText(err)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField label={t('account.passkey.name')} hint={t('account.passkey.nameHint')} value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={60} autoComplete="off" data-autofocus error={failure} />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" variant="primary" icon={icon} busy={busy} disabled={!label.trim()}>{confirm}</Button></div>
      </form>
    </Dialog>
  );
}

function Passkeys() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['account', 'passkeys'], queryFn: () => get<Passkey[]>('/account/passkeys') });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ['account', 'passkeys'] });
  const only = (q.data?.length ?? 0) <= 1;
  return (
    <Section title={t('account.passkey.title')} text={t('account.passkey.text')}
      action={<Button variant="primary" icon="plus" disabled={!passkeysSupported()} onClick={() => setAdding(true)}>{t('account.passkey.add')}</Button>}>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <ul className={rows} aria-label={t('account.passkey.title')}>
          {q.data.map((p) => (
            <li key={p.id} className={row} data-testid="passkey">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Glyph name="key" size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink"><span className="min-w-0 truncate">{p.label}</span>{p.backedUp ? <Badge tone="ok">{t('account.passkey.synced')}</Badge> : <Badge>{t('account.passkey.single')}</Badge>}</p>
                <p className="mt-0.5 text-xs text-ink-3">{t('account.passkey.created', { date: fmtDate(p.createdAt, { dateStyle: 'medium' }) })} · {p.lastUsedAt ? t('account.passkey.lastUsed', { when: fmtRelative(p.lastUsedAt) }) : t('account.passkey.neverUsed')}</p>
              </div>
              <IconButton icon="pencil" label={t('account.passkey.rename', { name: p.label })} onClick={() => setRenaming(p)} />
              <IconButton icon="trash" label={only ? t('account.passkey.lastOne') : t('account.passkey.remove', { name: p.label })} disabled={only} onClick={() => setRemoving(p)} />
            </li>
          ))}
        </ul>
      )}
      {only && q.data ? <p className="mt-1 text-xs text-ink-3">{t('account.passkey.lastOneHint')}</p> : null}
      {adding ? <PasskeyNameDialog title={t('account.passkey.addTitle')} initial={deviceLabel()} confirm={t('account.passkey.addConfirm')} icon="key" onClose={() => setAdding(false)}
        onSubmit={async (label) => { await addPasskey(label); await reload(); void qc.invalidateQueries({ queryKey: ['notifications'] }); toast(t('account.passkey.added'), { tone: 'ok' }); }} /> : null}
      {renaming ? <PasskeyNameDialog title={t('account.passkey.renameTitle')} initial={renaming.label} confirm={t('common.save')} onClose={() => setRenaming(null)}
        onSubmit={async (label) => { await patch(`/account/passkeys/${renaming.id}`, { label }); await reload(); }} /> : null}
      {removing ? <ConfirmDialog danger title={t('account.passkey.removeTitle')} text={t('account.passkey.removeText', { name: removing.label })} confirmLabel={t('account.passkey.removeConfirm')} onClose={() => setRemoving(null)}
        onConfirm={async () => { await sensitive(() => del(`/account/passkeys/${removing.id}`), t('account.reauth.cancelled')); await reload(); void qc.invalidateQueries({ queryKey: ['notifications'] }); toast(t('account.passkey.removed'), { tone: 'ok' }); }} /> : null}
    </Section>
  );
}

function TotpSetup({ setup, onClose, onEnabled }: { setup: { challengeId: string; secret: string; uri: string }; onClose: () => void; onEnabled: () => void }) {
  const t = useT();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { let live = true; void QRCode.toDataURL(setup.uri, { margin: 2, width: 440, errorCorrectionLevel: 'M' }).then((u) => { if (live) setQr(u); }, () => undefined); return () => { live = false; }; }, [setup.uri]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true); setFailure(null);
    try { await sensitive(() => post('/account/totp/enable', { challengeId: setup.challengeId, code }), t('account.reauth.cancelled')); onEnabled(); onClose(); } catch (err) { setFailure(errorText(err)); setBusy(false); }
  };
  return (
    <Dialog title={t('account.totp.setupTitle')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm leading-relaxed text-ink-2">{t('account.totp.setupText')}</p>
        {/* a QR code is always dark on white, whatever the theme, so that every camera reads it */}
        <div className="mx-auto flex h-[220px] w-[220px] items-center justify-center rounded-xl border border-line bg-white">{qr ? <img src={qr} width={220} height={220} alt={t('account.totp.qrAlt')} className="rounded-xl" /> : <Loading />}</div>
        <div><p className="mb-1.5 text-sm font-medium text-ink">{t('account.totp.secret')}</p><CopyField value={setup.secret} label={t('account.totp.secret')} /></div>
        <TextField label={t('account.totp.code')} hint={t('account.totp.codeHint')} value={code} onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-widest" error={failure} />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>{t('account.totp.enable')}</Button></div>
      </form>
    </Dialog>
  );
}

function RecoveryAndTotp() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { state } = useAuth();
  const q = useQuery({ queryKey: ['account', 'security'], queryFn: () => get<Security>('/account/security') });
  const [confirmCodes, setConfirmCodes] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [setup, setSetup] = useState<{ challengeId: string; secret: string; uri: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ['account', 'security'] });
  const start = async () => {
    setStarting(true);
    try { setSetup(await sensitive(() => post<{ challengeId: string; secret: string; uri: string }>('/account/totp/setup'), t('account.reauth.cancelled'))); } catch (e) { toast(errorText(e), { tone: 'error' }); }
    setStarting(false);
  };
  const left = q.data?.recoveryCodesLeft ?? 0;
  return (
    <>
      <Section title={t('account.codes.sectionTitle')} text={t('account.codes.sectionText')} action={<Button icon="refresh" onClick={() => setConfirmCodes(true)}>{t('account.codes.regenerate')}</Button>}>
        {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-ink" data-testid="codes-left"><Badge tone={left === 0 ? 'danger' : left <= 3 ? 'warn' : 'ok'}>{left} / 10</Badge>{t('account.codes.left', { n: left })}</p>
            {left <= 3 ? <Alert tone="warn">{t('account.codes.low')}</Alert> : null}
          </div>
        )}
      </Section>
      <Section title={t('account.totp.title')} text={t('account.totp.text')}
        action={q.data ? (q.data.totpEnabled ? <Button onClick={() => setDisabling(true)}>{t('account.totp.disable')}</Button> : <Button busy={starting} onClick={() => void start()}>{t('account.totp.setup')}</Button>) : null}>
        {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          : <p className="flex items-center gap-2 text-sm text-ink-2" data-testid="totp-state">{q.data.totpEnabled ? <Badge tone="ok">{t('account.totp.on')}</Badge> : <Badge>{t('account.totp.off')}</Badge>}{q.data.totpEnabled ? t('account.totp.onText') : t('account.totp.offText')}</p>}
      </Section>
      {confirmCodes ? <ConfirmDialog title={t('account.codes.regenerateTitle')} text={t('account.codes.regenerateText')} confirmLabel={t('account.codes.regenerate')} onClose={() => setConfirmCodes(false)}
        onConfirm={async () => { const r = await sensitive(() => post<{ recoveryCodes: string[] }>('/account/recovery-codes'), t('account.reauth.cancelled')); setCodes(r.recoveryCodes); void reload(); }} /> : null}
      {codes ? (
        <Dialog title={t('account.codes.title')} onClose={() => setCodes(null)} dismissable={false} wide>
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-ink-2">{t('account.codes.introNew')}</p>
            <RecoveryCodesStep codes={codes} email={state?.user?.email} onDone={() => setCodes(null)} doneLabel={t('account.codes.done')} />
          </div>
        </Dialog>
      ) : null}
      {setup ? <TotpSetup setup={setup} onClose={() => setSetup(null)} onEnabled={() => { void reload(); toast(t('account.totp.enabled'), { tone: 'ok' }); }} /> : null}
      {disabling ? <ConfirmDialog danger title={t('account.totp.disableTitle')} text={t('account.totp.disableText')} confirmLabel={t('account.totp.disable')} onClose={() => setDisabling(false)}
        onConfirm={async () => { await sensitive(() => del('/account/totp'), t('account.reauth.cancelled')); await reload(); toast(t('account.totp.disabled'), { tone: 'ok' }); }} /> : null}
    </>
  );
}

// --- devices -------------------------------------------------------------------------------------------------
function Devices() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['account', 'sessions'], queryFn: () => get<SessionRow[]>('/account/sessions') });
  const [revoking, setRevoking] = useState<SessionRow | null>(null);
  const [all, setAll] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ['account', 'sessions'] });
  const others = q.data?.filter((s) => !s.current).length ?? 0;
  return (
    <Section title={t('account.devices.title')} text={t('account.devices.text')} action={<Button icon="logout" disabled={!others} onClick={() => setAll(true)}>{t('account.devices.revokeOthers')}</Button>}>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? <EmptyState icon="laptop" title={t('account.devices.empty')} /> : (
        <ul className={rows} aria-label={t('account.devices.title')}>
          {q.data.map((s) => {
            const ua = summariseUA(s.userAgent, t('account.devices.unknown'));
            return (
              <li key={s.id} className={row} data-testid="session" data-current={s.current || undefined}>
                <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', s.current ? 'bg-accent-soft text-accent' : 'bg-hover text-ink-2')}><Glyph name={ua.icon} size={20} /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink"><span className="min-w-0 truncate" title={s.userAgent}>{ua.text}</span>{s.current ? <Badge tone="accent">{t('account.devices.current')}</Badge> : null}{s.method === 'recovery' ? <Badge tone="warn">{t('account.devices.recovery')}</Badge> : null}</p>
                  <p className="mt-0.5 text-xs break-words text-ink-3">{s.ip || '—'} · {s.current ? t('account.devices.activeNow') : t('account.devices.lastSeen', { when: fmtRelative(s.lastSeenAt) })} · {t('account.devices.since', { date: fmtDate(s.createdAt, { dateStyle: 'medium' }) })}</p>
                </div>
                {s.current ? null : <Button size="sm" className="h-10" onClick={() => setRevoking(s)} aria-label={t('account.devices.revokeLabel', { name: ua.text })}>{t('account.devices.revoke')}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {revoking ? <ConfirmDialog danger title={t('account.devices.revokeTitle')} text={t('account.devices.revokeText', { name: summariseUA(revoking.userAgent, t('account.devices.unknown')).text })} confirmLabel={t('account.devices.revoke')} onClose={() => setRevoking(null)}
        onConfirm={async () => { await del(`/account/sessions/${revoking.id}`); await reload(); toast(t('account.devices.revoked'), { tone: 'ok' }); }} /> : null}
      {all ? <ConfirmDialog danger title={t('account.devices.revokeOthers')} text={t('account.devices.revokeOthersText')} confirmLabel={t('account.devices.revokeOthersConfirm')} onClose={() => setAll(false)}
        onConfirm={async () => { const r = await post<{ revoked: number }>('/account/sessions/revoke-others'); await reload(); toast(t('account.devices.revokedN', { n: r.revoked }), { tone: 'ok' }); }} /> : null}
    </Section>
  );
}

// --- activity ------------------------------------------------------------------------------------------------
const ACTION: Record<string, { icon: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = {
  'auth.login': { icon: 'key', tone: 'ok' }, 'auth.login_failed': { icon: 'warning', tone: 'danger' }, 'auth.logout': { icon: 'logout', tone: 'neutral' },
  'auth.recovery_used': { icon: 'shield', tone: 'warn' }, 'auth.recovery_failed': { icon: 'warning', tone: 'danger' }, 'account.created': { icon: 'user', tone: 'ok' },
  'account.passkey_added': { icon: 'key', tone: 'ok' }, 'account.passkey_removed': { icon: 'key', tone: 'warn' }, 'account.session_revoked': { icon: 'laptop', tone: 'neutral' },
  'account.sessions_revoked': { icon: 'laptop', tone: 'neutral' }, 'account.recovery_codes_regenerated': { icon: 'refresh', tone: 'warn' }, 'account.totp_enabled': { icon: 'lock', tone: 'ok' },
  'account.totp_disabled': { icon: 'lock', tone: 'warn' },
};
const TONE = { neutral: 'bg-hover text-ink-2', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger' };
function ActivityList() {
  const t = useT();
  const q = useQuery({ queryKey: ['account', 'activity'], queryFn: () => get<Activity[]>('/account/activity') });
  return (
    <Section title={t('account.activity.title')} text={t('account.activity.text')}>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? <EmptyState icon="activity" title={t('account.activity.empty')} /> : (
        <ul className={rows} aria-label={t('account.activity.title')}>
          {q.data.map((e) => {
            const a = ACTION[e.action];
            const ua = e.userAgent ? summariseUA(e.userAgent, '').text : '';
            return (
              <li key={e.id} className="flex items-start gap-3 py-3" data-action={e.action}>
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', TONE[a?.tone ?? 'neutral'])}><Glyph name={a?.icon ?? 'info'} size={17} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{a ? t(`account.activity.${e.action}`) : e.action}</p>
                  <p className="mt-0.5 text-xs break-words text-ink-3">{[fmtDate(e.at), e.ip, ua].filter(Boolean).join(' · ')}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function Settings({ tab }: { tab?: string }) {
  const t = useT();
  if (tab && !TABS.some((x) => x.id === tab)) return <Redirect to="/settings/profil" replace />;
  const current: TabId = (tab as TabId | undefined) ?? 'profil';
  return (
    <Page title={t('account.settings.title')}>
      <nav aria-label={t('account.settings.title')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max min-w-full gap-1 border-b border-line">
          {TABS.map((x) => {
            const on = x.id === current;
            return (
              <li key={x.id}>
                <Link href={`/settings/${x.id}`} aria-current={on ? 'page' : undefined}
                  className={cx('-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition', on ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink')}>
                  <Glyph name={x.icon} size={18} />{t(`account.settings.tab.${x.id}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {current === 'profil' ? <Profile /> : current === 'securite' ? <><Passkeys /><RecoveryAndTotp /></> : current === 'appareils' ? <Devices /> : <ActivityList />}
    </Page>
  );
}
