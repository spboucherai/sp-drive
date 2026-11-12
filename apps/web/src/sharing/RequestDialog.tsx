// Create a deposit portal on a folder, or edit an existing one. The public link exists only at creation or after a
// rotation: the server stores a hash, so it can never be shown again.
import { type CustomField, DEFAULT_FIELDS, type FieldMode } from '@spd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiError, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, useT } from '../i18n.ts';
import { BLOCKED_EXT, inkOn, safeColor } from '../public-pages/util.ts';
import type { Portal } from '../types.ts';
import { Button, ConfirmDialog, cx, Dialog, Field, Select, Switch, TextArea, TextField, useToast } from '../ui.tsx';
import { fromLocalInput, inputCls, LinkOnce, NumberField, Section, toLocalInput } from './common.tsx';

const MIB = 1024 ** 2, GIB = 1024 ** 3;
const PRESETS: Record<string, string[]> = {
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'rtf', 'csv'],
  images: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif', 'tif', 'tiff'],
  pdf: ['pdf'],
  any: [],
};
const SWATCHES = ['#2563eb', '#0f766e', '#15803d', '#b45309', '#b91c1c', '#7c3aed', '#be185d', '#111827'];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** Field key the API accepts ([a-z0-9_]{1,30}), derived from the label and unique within the form. */
function keyFor(label: string, taken: Set<string>): string {
  const stem = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'champ';
  let k = stem;
  for (let i = 2; taken.has(k); i++) k = `${stem.slice(0, 27)}_${i}`;
  taken.add(k);
  return k;
}
const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function RequestDialog({ folder, portal, onClose }: { folder: { id: string; name: string }; portal?: Portal; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [s, setS] = useState(() => ({
    title: portal?.title ?? '', description: portal?.description ?? '', instructions: portal?.instructions ?? '', brandName: portal?.brandName ?? '', brandColor: safeColor(portal?.brandColor),
    password: '', dropPassword: false, expires: toLocalInput(portal?.expiresAt), active: portal?.active ?? true,
    maxFileMb: num((portal?.maxFileBytes ?? 200 * MIB) / MIB), maxFiles: String(portal?.maxFilesPerSubmission ?? 20), maxTotalGb: num((portal?.maxTotalBytes ?? 5 * GIB) / GIB),
    maxSubmissions: portal?.maxSubmissions?.toString() ?? '', perHour: String(portal?.submissionsPerHour ?? 20), extensions: portal?.allowedExtensions ?? [],
    name: (portal?.fields ?? DEFAULT_FIELDS).name, email: (portal?.fields ?? DEFAULT_FIELDS).email, reference: (portal?.fields ?? DEFAULT_FIELDS).reference,
    custom: (portal?.fields.custom ?? []).map((c) => ({ ...c })) as (Omit<CustomField, 'key'> & { key?: string })[],
    requireConsent: portal?.requireConsent ?? false, consentText: portal?.consentText ?? '', retentionNote: portal?.retentionNote ?? '',
    subfolder: portal?.subfolderPerSubmission ?? true, notify: portal?.notifyOwner ?? true, confirmation: portal?.confirmationMessage ?? '',
  }));
  const [ext, setExt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const up = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => { setS((cur) => ({ ...cur, [k]: v })); if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest); };

  const addExt = (raw: string) => {
    const list = raw.split(/[\s,;]+/).map((x) => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
    if (!list.length) return;
    const bad = list.find((x) => !/^[a-z0-9]{1,10}$/.test(x)), blocked = list.find((x) => BLOCKED_EXT.has(x));
    if (bad) { setErrors((e) => ({ ...e, ext: t('sharing.portal.extBad', { ext: bad }) })); return; }
    if (blocked) { setErrors((e) => ({ ...e, ext: t('sharing.portal.extBlocked', { ext: blocked }) })); return; }
    if (new Set([...s.extensions, ...list]).size > 60) { setErrors((e) => ({ ...e, ext: t('sharing.portal.extMany') })); return; }
    up('extensions', [...new Set([...s.extensions, ...list])]); setExt(''); setErrors(({ ext: _, ...rest }) => rest);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const range = (v: string, k: string, min: number, max: number, int = true) => { const n = Number(v); if (!v.trim() || Number.isNaN(n) || n < min || n > max || (int && !Number.isInteger(n))) { errs[k] = t('sharing.portal.range', { min, max }); return min; } return n; };
    if (!s.title.trim()) errs.title = t('sharing.portal.titleRequired');
    if (s.password && s.password.length < 4) errs.password = t('sharing.form.passwordShort');
    const expiresAt = fromLocalInput(s.expires);
    const expiryChanged = toLocalInput(portal?.expiresAt) !== s.expires;
    if (expiresAt && expiryChanged && new Date(expiresAt) <= new Date()) errs.expires = t('common.error.bad_expiry');
    const mb = range(s.maxFileMb, 'maxFileMb', 1, 2048, false), files = range(s.maxFiles, 'maxFiles', 1, 200), gb = range(s.maxTotalGb, 'maxTotalGb', 0.001, 100_000, false), perHour = range(s.perHour, 'perHour', 1, 1000);
    const maxSubmissions = s.maxSubmissions.trim() ? range(s.maxSubmissions, 'maxSubmissions', 1, 1_000_000) : null;
    const taken = new Set(s.custom.map((c) => c.key).filter((k): k is string => !!k));
    const custom: CustomField[] = [];
    s.custom.forEach((c, i) => { if (!c.label.trim()) errs[`custom${i}`] = t('sharing.portal.customLabelRequired'); else custom.push({ key: c.key ?? keyFor(c.label, taken), label: c.label.trim(), required: c.required }); });
    setErrors(errs);
    if (Object.keys(errs).length) { requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    const body = {
      title: s.title.trim(), description: s.description, instructions: s.instructions, confirmationMessage: s.confirmation, brandName: s.brandName, brandColor: s.brandColor,
      password: s.password ? s.password : portal ? (s.dropPassword ? null : undefined) : undefined, expiresAt: portal && !expiryChanged ? undefined : expiresAt, active: s.active,
      maxFileBytes: Math.min(2048 * MIB, Math.round(mb * MIB)), maxTotalBytes: Math.round(gb * GIB), maxFilesPerSubmission: files, maxSubmissions, submissionsPerHour: perHour, allowedExtensions: s.extensions,
      fields: { name: s.name, email: s.email, reference: s.reference, custom }, requireConsent: s.requireConsent, consentText: s.consentText, retentionNote: s.retentionNote, subfolderPerSubmission: s.subfolder, notifyOwner: s.notify,
    };
    setBusy(true);
    try {
      if (portal) { await patch(`/requests/${portal.id}`, body); await qc.invalidateQueries({ queryKey: ['requests'] }); toast(t('sharing.saved'), { tone: 'ok' }); onClose(); }
      else { const r = await post<{ request: Portal; url: string }>('/requests', { ...body, folderId: folder.id }); void qc.invalidateQueries({ queryKey: ['requests'] }); setUrl(r.url); }
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiError && x.code === 'bad_expiry') setErrors({ expires: errorText(x) }); else setErrors({ form: errorText(x) });
    }
  };

  if (url) return (
    <Dialog title={rotated ? t('sharing.link.newTitle') : t('sharing.portal.createdTitle')} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('sharing.link.done')}</Button>}>
      <div className="space-y-4" data-testid="portal-created">
        <p className="flex items-center gap-2 text-sm font-medium text-ok"><Glyph name="check" size={18} />{rotated ? t('sharing.portal.rotated') : t('sharing.portal.created', { folder: folder.name })}</p>
        <LinkOnce url={url} title={s.title} qr />
      </div>
    </Dialog>
  );

  const ink = inkOn(s.brandColor);
  const modes: FieldMode[] = ['off', 'optional', 'required'];
  const preset = Object.keys(PRESETS).find((k) => sameSet(PRESETS[k]!, s.extensions));
  return (
    <Dialog title={portal ? t('sharing.portal.editTitle') : t('sharing.portal.newTitle')} onClose={onClose} wide
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form={formId} variant="primary" busy={busy} icon={portal ? 'check' : 'inbox'}>{portal ? t('common.save') : t('sharing.portal.create')}</Button></>}>
      <form id={formId} ref={form} onSubmit={submit} noValidate className="space-y-5" data-testid="portal-form">
        <p className="flex items-center gap-2 rounded-xl bg-hover px-3 py-2 text-sm text-ink-2"><Glyph name="folder" size={18} className="shrink-0 text-accent" /><span className="min-w-0 truncate">{t('sharing.portal.target', { folder: folder.name })}</span></p>

        <Section title={t('sharing.portal.sPresentation')}>
          <TextField label={t('sharing.portal.title')} value={s.title} maxLength={120} onChange={(e) => up('title', e.target.value)} error={errors.title} required data-autofocus placeholder={t('sharing.portal.titlePh')} />
          <TextArea label={t('sharing.portal.description')} hint={t('sharing.portal.descriptionHint')} value={s.description} maxLength={2000} rows={2} onChange={(e) => up('description', e.target.value)} />
          <TextArea label={t('sharing.portal.instructions')} hint={t('sharing.portal.instructionsHint')} value={s.instructions} maxLength={4000} rows={4} onChange={(e) => up('instructions', e.target.value)} />
        </Section>

        <Section title={t('sharing.portal.sAppearance')}>
          <TextField label={t('sharing.portal.brandName')} hint={t('sharing.portal.brandNameHint')} value={s.brandName} maxLength={80} onChange={(e) => up('brandName', e.target.value)} />
          <Field label={t('sharing.portal.brandColor')}>{(id) => (
            <div className="flex flex-wrap items-center gap-2">
              <input id={id} type="color" value={s.brandColor} onChange={(e) => up('brandColor', e.target.value)} className="h-10 w-14 cursor-pointer rounded-xl border border-line-strong bg-surface p-1" />
              {SWATCHES.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={s.brandColor.toLowerCase() === c} onClick={() => up('brandColor', c)} style={{ background: c }} className={cx('h-8 w-8 rounded-full border-2', s.brandColor.toLowerCase() === c ? 'border-ink' : 'border-transparent')} />)}
            </div>
          )}</Field>
          <div aria-label={t('sharing.portal.preview')} role="img" className="overflow-hidden rounded-2xl border border-line" data-testid="brand-preview">
            <div className="px-4 py-4" style={{ background: s.brandColor, color: ink }}>
              {s.brandName ? <p className="text-xs font-semibold opacity-90">{s.brandName}</p> : null}
              <p className="text-lg leading-tight font-semibold break-words">{s.title || t('sharing.portal.titlePh')}</p>
              {s.description ? <p className="mt-1 line-clamp-2 text-xs opacity-95">{s.description}</p> : null}
            </div>
            <p className="bg-surface px-4 py-2 text-xs text-ink-3">{t('sharing.portal.previewHint')}</p>
          </div>
        </Section>

        <Section title={t('sharing.portal.sAccess')}>
          <Switch label={t('sharing.portal.active')} hint={s.active ? t('sharing.portal.activeOn') : t('sharing.portal.activeOff')} checked={s.active} onChange={(v) => up('active', v)} />
          <TextField label={portal?.hasPassword ? t('sharing.form.passwordChange') : t('sharing.form.password')} hint={portal?.hasPassword ? t('sharing.form.passwordKeep') : t('sharing.portal.passwordHint')} value={s.password} maxLength={200}
            onChange={(e) => up('password', e.target.value)} error={errors.password} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={s.dropPassword} />
          {portal?.hasPassword ? <Switch label={t('sharing.form.passwordRemove')} checked={s.dropPassword} onChange={(v) => setS((c) => ({ ...c, dropPassword: v, password: v ? '' : c.password }))} /> : null}
          <Field label={t('sharing.portal.expires')} hint={t('sharing.portal.expiresHint')} error={errors.expires}>{(id, d) => (
            <div className="flex gap-2">
              <input id={id} aria-describedby={d} aria-invalid={!!errors.expires || undefined} type="datetime-local" value={s.expires} onChange={(e) => up('expires', e.target.value)} className={inputCls} />
              {s.expires ? <Button onClick={() => up('expires', '')}>{t('sharing.portal.noExpiry')}</Button> : null}
            </div>
          )}</Field>
          {portal && !portal.revokedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
              <p className="min-w-0 flex-1 text-xs text-ink-2">{t('sharing.portal.linkHidden')}</p>
              <Button size="sm" icon="refresh" onClick={() => setConfirmRotate(true)}>{t('sharing.portal.rotate')}</Button>
            </div>
          ) : null}
        </Section>

        <Section title={t('sharing.portal.sLimits')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField label={t('sharing.portal.maxFileMb')} hint={t('sharing.portal.maxFileMbHint')} value={s.maxFileMb} onChange={(v) => up('maxFileMb', v)} max={2048} step="any" suffix={t('sharing.portal.mb')} error={errors.maxFileMb} />
            <NumberField label={t('sharing.portal.maxFiles')} value={s.maxFiles} onChange={(v) => up('maxFiles', v)} max={200} error={errors.maxFiles} />
            <NumberField label={t('sharing.portal.maxTotalGb')} hint={t('sharing.portal.maxTotalGbHint')} value={s.maxTotalGb} onChange={(v) => up('maxTotalGb', v)} min={0.001} step="any" suffix={t('sharing.portal.gb')} error={errors.maxTotalGb} />
            <NumberField label={t('sharing.portal.maxSubmissions')} placeholder={t('sharing.form.unlimited')} value={s.maxSubmissions} onChange={(v) => up('maxSubmissions', v)} max={1_000_000} error={errors.maxSubmissions} />
            <NumberField label={t('sharing.portal.perHour')} hint={t('sharing.portal.perHourHint')} value={s.perHour} onChange={(v) => up('perHour', v)} max={1000} error={errors.perHour} />
          </div>
        </Section>

        <Section title={t('sharing.portal.sTypes')} hint={t('sharing.portal.typesHint')}>
          <div role="group" aria-label={t('sharing.portal.presets')} className="flex flex-wrap gap-1.5">
            {Object.keys(PRESETS).map((k) => (
              <button key={k} type="button" aria-pressed={preset === k} onClick={() => { up('extensions', PRESETS[k]!); setErrors(({ ext: _, ...rest }) => rest); }}
                className={cx('h-9 rounded-full border px-3 text-sm transition', preset === k ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line-strong text-ink-2 hover:bg-hover')}>{t(`sharing.portal.preset.${k}`)}</button>
            ))}
          </div>
          {s.extensions.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('sharing.portal.extList')} data-testid="ext-chips">
              {s.extensions.map((x) => (
                <li key={x} className="inline-flex items-center gap-1 rounded-full bg-hover py-1 pr-1 pl-2.5 text-xs font-medium text-ink">.{x}
                  <button type="button" aria-label={t('sharing.portal.extRemove', { ext: x })} onClick={() => up('extensions', s.extensions.filter((y) => y !== x))} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink"><Glyph name="x" size={12} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-2">{t('sharing.portal.extAny')}</p>}
          <Field label={t('sharing.portal.extAdd')} hint={t('sharing.portal.extAddHint')} error={errors.ext}>{(id, d) => (
            <div className="flex gap-2">
              <input id={id} aria-describedby={d} value={ext} onChange={(e) => setExt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addExt(ext); } }} placeholder="pdf, docx" autoCapitalize="none" spellCheck={false} className={inputCls} />
              <Button icon="plus" onClick={() => addExt(ext)}>{t('sharing.portal.extAddBtn')}</Button>
            </div>
          )}</Field>
        </Section>

        <Section title={t('sharing.portal.sForm')} hint={t('sharing.portal.formHint')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(['name', 'email', 'reference'] as const).map((k) => (
              <Select key={k} label={t(`sharing.portal.field.${k}`)} value={s[k]} onChange={(e) => up(k, e.target.value as FieldMode)}>{modes.map((m) => <option key={m} value={m}>{t(`sharing.portal.mode.${m}`)}</option>)}</Select>
            ))}
          </div>
          {s.custom.map((c, i) => (
            <div key={i} className="flex items-end gap-2" data-testid="custom-field">
              <div className="min-w-0 flex-1"><TextField label={t('sharing.portal.customLabel', { n: i + 1 })} value={c.label} maxLength={80} error={errors[`custom${i}`]} onChange={(e) => { const v = e.target.value; setS((cur) => ({ ...cur, custom: cur.custom.map((x, j) => (j === i ? { ...x, label: v } : x)) })); }} /></div>
              <label className="flex h-10 shrink-0 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.required} onChange={(e) => { const v = e.target.checked; setS((cur) => ({ ...cur, custom: cur.custom.map((x, j) => (j === i ? { ...x, required: v } : x)) })); }} />{t('sharing.portal.mode.required')}</label>
              <Button variant="ghost" icon="trash" aria-label={t('sharing.portal.customRemove', { n: i + 1 })} className="px-2.5" onClick={() => setS((cur) => ({ ...cur, custom: cur.custom.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          {s.custom.length < 10 ? <Button icon="plus" onClick={() => setS((cur) => ({ ...cur, custom: [...cur.custom, { label: '', required: false }] }))}>{t('sharing.portal.customAdd')}</Button> : null}
        </Section>

        <Section title={t('sharing.portal.sConsent')}>
          <Switch label={t('sharing.portal.requireConsent')} hint={t('sharing.portal.requireConsentHint')} checked={s.requireConsent} onChange={(v) => up('requireConsent', v)} />
          {s.requireConsent ? <TextArea label={t('sharing.portal.consentText')} hint={t('sharing.portal.consentTextHint')} value={s.consentText} maxLength={2000} rows={3} onChange={(e) => up('consentText', e.target.value)} /> : null}
          <TextArea label={t('sharing.portal.retentionNote')} hint={t('sharing.portal.retentionNoteHint')} value={s.retentionNote} maxLength={1000} rows={2} onChange={(e) => up('retentionNote', e.target.value)} />
        </Section>

        <Section title={t('sharing.portal.sAfter')}>
          <Switch label={t('sharing.portal.subfolder')} hint={s.subfolder ? t('sharing.portal.subfolderOn') : t('sharing.portal.subfolderOff')} checked={s.subfolder} onChange={(v) => up('subfolder', v)} />
          <Switch label={t('sharing.portal.notify')} hint={t('sharing.portal.notifyHint')} checked={s.notify} onChange={(v) => up('notify', v)} />
          <TextArea label={t('sharing.portal.confirmation')} hint={t('sharing.portal.confirmationHint')} value={s.confirmation} maxLength={1000} rows={2} onChange={(e) => up('confirmation', e.target.value)} />
        </Section>
        {errors.form ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{errors.form}</p> : null}
      </form>
      {confirmRotate && portal ? <ConfirmDialog title={t('sharing.portal.rotate')} text={t('sharing.portal.rotateText')} confirmLabel={t('sharing.item.rotateConfirm')} onClose={() => setConfirmRotate(false)}
        onConfirm={async () => { const r = await post<{ url: string }>(`/requests/${portal.id}/rotate`); setRotated(true); setUrl(r.url); }} /> : null}
    </Dialog>
  );
}
