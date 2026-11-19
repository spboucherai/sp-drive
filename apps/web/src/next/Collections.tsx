// Smart collections: a saved rule that selects files of the account (it references files, it never copies bytes).
// The builder writes the rule field by field and shows, live, what the server would select (POST /collections/preview).
import { formatBytes } from '@spd/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ApiError, del, get, patch, post } from '../api.ts';
import { useTags } from '../explorer/dialogs.tsx';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtRelative, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { ownerSource } from '../sources.ts';
import type { FileItem } from '../types.ts';
import { Button, ConfirmDialog, cx, Dialog, EmptyState, ErrorState, IconButton, Loading, useToast } from '../ui.tsx';
import type { Collection, Condition, Field, Op, Rule } from './types.ts';

const COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];
const DOT: Record<string, string> = { slate: 'bg-slate-500', red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-500', green: 'bg-green-500', teal: 'bg-teal-500', blue: 'bg-blue-500', violet: 'bg-violet-500', pink: 'bg-pink-500' };
const KINDS = ['image', 'pdf', 'document', 'sheet', 'video', 'audio', 'archive', 'text'];
const FIELDS: Field[] = ['kind', 'name', 'ext', 'text', 'tag', 'untagged', 'size', 'modified', 'created', 'starred', 'shared', 'folder'];
const OPS: Record<Field, Op[]> = { kind: ['is', 'isNot'], ext: ['is', 'isNot'], name: ['contains', 'is', 'isNot'], tag: ['is', 'isNot'], untagged: ['is'], size: ['gt', 'lt'], modified: ['within', 'gt', 'lt'], created: ['within', 'gt', 'lt'], starred: ['is'], shared: ['is'], folder: ['is', 'isNot'], text: ['contains'] };
const MIB = 1024 * 1024;
const sel = 'h-11 min-w-0 rounded-[10px] border border-line-strong bg-surface px-2.5 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:h-9 sm:text-[13px]';
const defaultValue = (f: Field, op: Op): Condition['value'] => (f === 'kind' ? 'pdf' : f === 'untagged' || f === 'starred' || f === 'shared' ? true : f === 'size' ? 10 * MIB : (f === 'modified' || f === 'created') ? (op === 'within' ? 30 : new Date().toISOString().slice(0, 10)) : '');
const complete = (c: Condition) => (typeof c.value === 'string' ? c.value.trim().length > 0 : typeof c.value === 'number' ? Number.isFinite(c.value) && c.value > 0 : true);
export const collectionsKey = ['next', 'collections'];
const opKey = (f: Field, o: Op) => `next.col.op.${f === 'size' ? 'size.' : f === 'modified' || f === 'created' ? 'date.' : ''}${o}`;

function ConditionRow({ c, onChange, onRemove, folders }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void; folders: { id: string; name: string }[] }) {
  const t = useT();
  const tags = useTags().data ?? [];
  const setField = (f: Field) => { const op = OPS[f][0]!; onChange({ field: f, op, value: f === 'tag' ? tags[0]?.id ?? '' : f === 'folder' ? folders[0]?.id ?? '' : defaultValue(f, op) }); };
  const setOp = (op: Op) => onChange({ ...c, op, value: (c.field === 'modified' || c.field === 'created') && (op === 'within') !== (c.op === 'within') ? defaultValue(c.field, op) : c.value });
  let value: React.ReactNode;
  const label = t('next.col.value');
  if (c.field === 'kind') value = <select aria-label={label} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cx(sel, 'flex-1')}>{KINDS.map((k) => <option key={k} value={k}>{t(`explorer.filters.kind.${k}`)}</option>)}</select>;
  else if (c.field === 'tag') value = tags.length ? <select aria-label={label} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cx(sel, 'flex-1')}>{tags.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select> : <span className="flex-1 self-center text-xs text-ink-3">{t('next.col.noTags')}</span>;
  else if (c.field === 'folder') value = <select aria-label={label} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cx(sel, 'flex-1')}>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>;
  else if (c.field === 'untagged' || c.field === 'starred' || c.field === 'shared') value = <select aria-label={label} value={c.value ? '1' : '0'} onChange={(e) => onChange({ ...c, value: e.target.value === '1' })} className={cx(sel, 'flex-1')}><option value="1">{t('next.col.yes')}</option><option value="0">{t('next.col.no')}</option></select>;
  else if (c.field === 'size') value = <span className="flex flex-1 items-center gap-1.5"><input aria-label={label} type="number" min={0} step="any" value={Number(c.value) / MIB} onChange={(e) => onChange({ ...c, value: Math.round(Number(e.target.value) * MIB) })} className={cx(sel, 'w-full flex-1')} /><span className="text-xs text-ink-3">{t('next.col.mb')}</span></span>;
  else if ((c.field === 'modified' || c.field === 'created') && c.op === 'within') value = <span className="flex flex-1 items-center gap-1.5"><input aria-label={label} type="number" min={1} max={36500} value={Number(c.value)} onChange={(e) => onChange({ ...c, value: Math.round(Number(e.target.value)) })} className={cx(sel, 'w-full flex-1')} /><span className="text-xs text-ink-3">{t('next.col.days')}</span></span>;
  else if (c.field === 'modified' || c.field === 'created') value = <input aria-label={label} type="date" value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value })} className={cx(sel, 'flex-1')} />;
  else value = <input aria-label={label} type="text" maxLength={c.field === 'ext' ? 10 : 200} value={String(c.value)} onChange={(e) => onChange({ ...c, value: c.field === 'ext' ? e.target.value.replace(/[^A-Za-z0-9]/g, '') : e.target.value })} placeholder={t(`next.col.ph.${c.field}`)} className={cx(sel, 'flex-1')} />;
  return (
    <li className="flex flex-wrap items-center gap-1.5" data-testid="condition">
      <select aria-label={t('next.col.field')} value={c.field} onChange={(e) => setField(e.target.value as Field)} className={cx(sel, 'basis-36')}>{FIELDS.map((f) => <option key={f} value={f}>{t(`next.col.f.${f}`)}</option>)}</select>
      {OPS[c.field].length > 1 ? <select aria-label={t('next.col.op')} value={c.op} onChange={(e) => setOp(e.target.value as Op)} className={cx(sel, 'basis-32')}>{OPS[c.field].map((o) => <option key={o} value={o}>{t(opKey(c.field, o))}</option>)}</select> : <span className="px-1 text-[13px] text-ink-3">{t(opKey(c.field, OPS[c.field][0]!))}</span>}
      {value}
      <IconButton icon="x" size={16} label={t('next.col.removeCondition')} className="h-9! w-9!" onClick={onRemove} />
    </li>
  );
}

function FileLine({ f }: { f: FileItem }) {
  return (
    <Link href={`/folder/${f.folderId}?file=${f.id}`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-hover" data-testid="collection-file">
      <Thumb name={f.name} kind={f.kind} className="h-8 w-8 shrink-0 overflow-hidden rounded-[6px]!" src={f.thumb && f.scan !== 'infected' ? ownerSource(f).previewUrl('thumb') : undefined} />
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink" data-name>{f.name}</span><span className="block truncate text-xs text-ink-3">{formatBytes(f.size, getLocale())} · {fmtRelative(f.updatedAt)}</span></span>
    </Link>
  );
}

/** Create or edit a collection. */
export function CollectionDialog({ collection, onClose }: { collection?: Collection; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [, navigate] = useLocation();
  const [name, setName] = useState(collection?.name ?? '');
  const [color, setColor] = useState(collection?.color || 'violet');
  const [match, setMatch] = useState<Rule['match']>(collection?.rule.match ?? 'all');
  const [conditions, setConditions] = useState<Condition[]>(collection?.rule.conditions ?? [{ field: 'kind', op: 'is', value: 'pdf' }]);
  const [sort, setSort] = useState(collection?.rule.sort ?? { by: 'updated' as const, dir: 'desc' as const });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folders = useQuery({ queryKey: ['explorer', 'listing', '/folders/root?'], queryFn: () => get<{ folders: { id: string; name: string }[] }>('/folders/root'), staleTime: 30_000 }).data?.folders ?? [];
  const rule = useMemo<Rule>(() => ({ match, conditions: conditions.filter(complete), sort }), [match, conditions, sort]);
  const [debounced, setDebounced] = useState(rule);
  useEffect(() => { const h = setTimeout(() => setDebounced(rule), 300); return () => clearTimeout(h); }, [rule]);
  const preview = useQuery({ queryKey: ['next', 'collection-preview', debounced], queryFn: () => post<{ files: FileItem[]; total: number }>('/collections/preview', { rule: debounced, limit: 6 }), enabled: debounced.conditions.length > 0, placeholderData: keepPreviousData, retry: false });
  const valid = name.trim().length > 0 && rule.conditions.length > 0 && rule.conditions.length === conditions.length;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = { name: name.trim(), color, rule };
      const c = collection ? await patch<Collection>(`/collections/${collection.id}`, body) : await post<Collection>('/collections', body);
      await qc.invalidateQueries({ queryKey: ['next'] });
      toast(collection ? t('next.col.saved') : t('next.col.created', { name: c.name }), { tone: 'ok' });
      onClose();
      if (!collection) navigate(`/collections/${c.id}`);
    } catch (e) { setError(e instanceof ApiError && e.code === 'name_conflict' ? t('next.col.nameTaken') : e instanceof ApiError && e.code === 'too_many_collections' ? t('next.col.tooMany') : errorText(e)); setBusy(false); }
  };
  return (
    <Dialog title={collection ? t('next.col.edit') : t('next.col.new')} onClose={onClose} wide testId="collection-dialog"
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={() => void save()}>{collection ? t('common.save') : t('common.create')}</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5 text-[13px] font-medium text-ink">{t('next.col.name')}
            <input data-autofocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('next.col.namePh')} className={cx(sel, 'w-full font-normal')} />
          </label>
          <div role="radiogroup" aria-label={t('next.col.color')} className="flex h-11 items-center gap-1.5 sm:h-9">
            {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={cx('h-5 w-5 rounded-full transition-transform', DOT[c], color === c ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-(--raised)' : 'opacity-80 hover:opacity-100')} />)}
          </div>
        </div>
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-ink">
            <span>{t('next.col.matchLead')}</span>
            <select aria-label={t('next.col.match')} value={match} onChange={(e) => setMatch(e.target.value as Rule['match'])} className={cx(sel, 'h-9!')}><option value="all">{t('next.col.all')}</option><option value="any">{t('next.col.any')}</option></select>
            <span>{t('next.col.matchTail')}</span>
          </div>
          <ul className="flex flex-col gap-2">{conditions.map((c, i) => <ConditionRow key={i} c={c} folders={folders} onChange={(n) => setConditions((cs) => cs.map((x, j) => (j === i ? n : x)))} onRemove={() => setConditions((cs) => cs.filter((_, j) => j !== i))} />)}</ul>
          <Button size="sm" icon="plus" className="mt-2" disabled={conditions.length >= 20} onClick={() => setConditions((cs) => [...cs, { field: 'name', op: 'contains', value: '' }])}>{t('next.col.addCondition')}</Button>
        </section>
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-ink">{t('next.col.sort')}
          <select value={`${sort.by}:${sort.dir}`} onChange={(e) => { const [by, dir] = e.target.value.split(':'); setSort({ by: by as 'name', dir: dir as 'asc' }); }} className={cx(sel, 'h-9!')}>
            {(['updated:desc', 'updated:asc', 'name:asc', 'name:desc', 'size:desc', 'size:asc', 'created:desc'] as const).map((k) => <option key={k} value={k}>{t(`next.col.sort.${k}`)}</option>)}
          </select>
        </label>
        <section aria-label={t('next.col.preview')} className="rounded-[12px] border border-line" data-testid="collection-preview">
          <header className="flex items-center justify-between border-b border-line px-3 py-2"><h3 className="spd-eyebrow">{t('next.col.preview')}</h3><span className="text-xs text-ink-2 tabular-nums" data-testid="preview-total">{!rule.conditions.length ? '' : preview.isFetching && !preview.data ? '…' : preview.error ? '' : t('next.col.total', { n: preview.data?.total ?? 0 })}</span></header>
          {!rule.conditions.length ? <p className="px-3 py-5 text-center text-xs text-ink-3">{t('next.col.previewEmptyRule')}</p>
            : preview.error ? <p role="alert" className="px-3 py-5 text-center text-xs text-danger">{errorText(preview.error)}</p>
            : preview.data?.files.length ? <ul className="divide-y divide-line">{preview.data.files.map((f) => <li key={f.id}><FileLine f={f} /></li>)}</ul>
            : <p className="px-3 py-5 text-center text-xs text-ink-3">{preview.isLoading ? t('common.loading') : t('next.col.previewNone')}</p>}
        </section>
        {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}

/** /collections/:id — what the rule selects now. */
export function CollectionScreen({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [limit, setLimit] = useState(200);
  const q = useQuery({ queryKey: ['next', 'collection', id, limit], queryFn: () => get<{ collection: Collection; files: FileItem[]; total: number }>(`/collections/${id}/items?limit=${limit}`), placeholderData: keepPreviousData, retry: false });
  const describe = (c: Condition) => `${t(`next.col.f.${c.field}`)}`;
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="px-4 pt-6">{q.error instanceof ApiError && q.error.status === 404 ? <EmptyState icon="collection" title={t('next.col.gone')} text={t('next.col.goneText')} action={<Link href="/" className="btn-grad press inline-flex h-9 items-center rounded-[10px] px-4 text-[13px] font-medium">{t('account.nav.files')}</Link>} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}</div>;
  const { collection: c, files, total } = q.data;
  return (
    <div className="pb-dock mx-auto w-full max-w-4xl px-4 pt-3 sm:px-8 sm:pt-6" data-testid="collection-screen">
      <header className="mb-4">
        <p className="spd-eyebrow flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', DOT[c.color] ?? 'bg-slate-500')} />{t('next.col.one')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 truncate text-[28px] leading-[1.15] sm:text-[30px]">{c.name}</h1>
          <span className="flex-1" />
          <Button size="sm" icon="pencil" onClick={() => setEdit(true)}>{t('next.col.editRule')}</Button>
          <Button size="sm" icon="trash" onClick={() => setRemove(true)}>{t('common.delete')}</Button>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2" data-testid="collection-rule">
          <span className="tabular-nums">{t('next.col.total', { n: total })}</span>·<span>{t(c.rule.match === 'all' ? 'next.col.allOf' : 'next.col.anyOf')}</span>
          {c.rule.conditions.map((x, i) => <span key={i} className="rounded-md bg-hover px-1.5 py-0.5 text-xs text-ink-2">{describe(x)}</span>)}
        </p>
      </header>
      {!files.length ? <EmptyState icon="collection" title={t('next.col.empty')} text={t('next.col.emptyText')} action={<Button icon="pencil" onClick={() => setEdit(true)}>{t('next.col.editRule')}</Button>} /> : (
        <ul className="anim-nav divide-y divide-line overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)" data-dir="same" data-testid="collection-items">{files.map((f) => <li key={f.id}><FileLine f={f} /></li>)}</ul>
      )}
      {total > files.length ? <div className="flex justify-center py-4"><Button size="sm" busy={q.isFetching} disabled={limit >= 500} onClick={() => setLimit(500)}>{t('next.col.more', { n: Math.min(500, total) - files.length })}</Button></div> : null}
      {edit ? <CollectionDialog collection={c} onClose={() => setEdit(false)} /> : null}
      {remove ? <ConfirmDialog danger title={t('next.col.deleteTitle', { name: c.name })} text={t('next.col.deleteText')} confirmLabel={t('common.delete')} onClose={() => setRemove(false)}
        onConfirm={async () => { await del(`/collections/${id}`); await qc.invalidateQueries({ queryKey: collectionsKey }); navigate('/'); }} /> : null}
    </div>
  );
}
