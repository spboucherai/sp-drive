// Dialogs of the explorer: name (new folder, rename), destination picker (move, copy), tags.
import { splitExt } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, del, get, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, useT } from '../i18n.ts';
import type { FileItem, Folder, Tag } from '../types.ts';
import { Button, cx, Dialog, IconButton, Loading, Spinner, TextField, useToast } from '../ui.tsx';
import { TAG_COLORS, tagStyle, XKEY } from './lib.ts';

/** Ask for a name; a refusal of the server (409 name_conflict…) is shown under the field and the dialog stays open. */
export function NameDialog({ title, label, initial = '', submitLabel, selectStem, onSubmit, onClose }: { title: string; label: string; initial?: string; submitLabel: string; selectStem?: boolean; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { const el = form.current?.querySelector('input'); if (!el) return; el.focus(); el.setSelectionRange(0, selectStem ? splitExt(initial)[0].length : initial.length); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    if (v === initial) { onClose(); return; }
    setBusy(true); setError(null);
    try { await onSubmit(v); onClose(); } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form ref={form} onSubmit={submit} className="flex flex-col gap-4">
        <TextField label={label} value={name} error={error} maxLength={255} autoComplete="off" autoCapitalize="sentences" spellCheck={false} data-autofocus
          onChange={(e) => { setName(e.target.value); setError(null); }} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>{submitLabel}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// --- destination picker ---
type Child = Folder & { hasChildren: boolean };
interface Children { folder: Folder; children: Child[] }
const childrenKey = (id: string) => [XKEY, 'children', id];

function Node({ id, name, depth, hasChildren, root, selected, expanded, blocked, onSelect, onToggle }: {
  id: string; name: string; depth: number; hasChildren: boolean; root?: boolean; selected: string | null; expanded: Set<string>; blocked: Set<string>;
  onSelect: (id: string, name: string) => void; onToggle: (id: string) => void;
}) {
  const t = useT();
  const open = expanded.has(id);
  const q = useQuery({ queryKey: childrenKey(id), queryFn: () => get<Children>(`/folders/${id}/children`), enabled: open });
  const off = blocked.has(id);
  const kids = q.data?.children ?? [];
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={selected === id} aria-disabled={off || undefined}>
      <div className={cx('flex items-center rounded-lg', selected === id ? 'bg-accent-soft' : 'hover:bg-hover', off && 'opacity-45')} style={{ paddingLeft: depth * 18 }}>
        {hasChildren && !off
          ? <button type="button" aria-label={open ? t('explorer.pick.collapse', { name }) : t('explorer.pick.expand', { name })} onClick={() => onToggle(id)} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:text-ink">
            {q.isFetching && !q.data ? <Spinner size={14} /> : <Glyph name={open ? 'chevronDown' : 'chevronRight'} size={16} />}
          </button>
          : <span className="w-9 shrink-0" />}
        <button type="button" disabled={off} data-folder-name={name} onClick={() => onSelect(id, name)} onDoubleClick={() => { if (hasChildren) onToggle(id); }}
          className={cx('flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg pr-3 text-left text-sm', selected === id ? 'font-medium text-accent' : 'text-ink')}>
          <Glyph name={root ? 'home' : 'folder'} size={18} className="shrink-0 opacity-80" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open && !off ? (
        q.error ? <p role="alert" className="py-1 text-xs text-danger" style={{ paddingLeft: (depth + 1) * 18 + 36 }}>{errorText(q.error)}</p>
          : kids.length ? <ul role="group">{kids.map((c) => <Node key={c.id} id={c.id} name={c.name} depth={depth + 1} hasChildren={c.hasChildren} selected={selected} expanded={expanded} blocked={blocked} onSelect={onSelect} onToggle={onToggle} />)}</ul> : null
      ) : null}
    </li>
  );
}

/**
 * Choose a destination folder in a tree loaded level by level. `onConfirm` may be called a second time with
 * `rename` after a name collision ("keep both"). Folders being moved cannot be chosen (nor opened: their content neither).
 */
export function FolderPicker({ title, confirmLabel, blockedIds = [], allowKeepBoth, onConfirm, onClose }: {
  title: string; confirmLabel: string; blockedIds?: string[]; allowKeepBoth?: boolean; onConfirm: (dest: { id: string; name: string }, onConflict: 'fail' | 'rename') => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const root = useQuery({ queryKey: childrenKey('root'), queryFn: () => get<Children>('/folders/root/children') });
  const rootId = root.data?.folder.id;
  const [dest, setDest] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const blocked = new Set(blockedIds);
  const sel = dest ?? (rootId ? { id: rootId, name: t('explorer.root') } : null);
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const go = async (mode: 'fail' | 'rename') => {
    if (!sel) return;
    setBusy(true); setError(null);
    try { await onConfirm(sel, mode); onClose(); } catch (e) {
      const conflict = e instanceof ApiError && e.code === 'name_conflict';
      setError({ text: conflict && e.data.name ? t('explorer.pick.conflict', { name: String(e.data.name) }) : errorText(e), conflict: conflict && !!allowKeepBoth });
      setBusy(false);
    }
  };
  const createFolder = async (e: FormEvent) => {
    e.preventDefault();
    if (!sel || !naming?.trim()) return;
    setNameError(null);
    try {
      const f = await post<Folder>('/folders', { parentId: sel.id, name: naming.trim() });
      await qc.invalidateQueries({ queryKey: [XKEY] });
      setExpanded((s) => new Set(s).add(sel.id));
      setDest({ id: f.id, name: f.name }); setNaming(null); setError(null);
    } catch (err) { setNameError(errorText(err)); }
  };
  return (
    <Dialog title={title} onClose={onClose} footer={
      <>
        <Button icon="plus" variant="ghost" className="mr-auto" disabled={!sel || naming !== null} onClick={() => { setNaming(''); setNameError(null); }}>{t('explorer.newFolder')}</Button>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {error?.conflict
          ? <Button variant="primary" busy={busy} onClick={() => void go('rename')}>{t('explorer.keepBoth')}</Button>
          : <Button variant="primary" busy={busy} disabled={!sel} onClick={() => void go('fail')}>{confirmLabel}</Button>}
      </>
    }>
      {root.isLoading ? <Loading /> : root.error || !rootId ? <p role="alert" className="text-sm text-danger">{errorText(root.error)}</p> : (
        <ul role="tree" aria-label={t('explorer.pick.tree')} className="-mx-2 min-h-48">
          <li role="treeitem" aria-expanded aria-selected={sel?.id === rootId}>
            <button type="button" data-folder-name={t('explorer.root')} onClick={() => { setDest({ id: rootId, name: t('explorer.root') }); setError(null); }}
              className={cx('flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm', sel?.id === rootId ? 'bg-accent-soft font-medium text-accent' : 'text-ink hover:bg-hover')}>
              <Glyph name="home" size={18} className="shrink-0 opacity-80" /><span className="truncate">{t('explorer.root')}</span>
            </button>
            <ul role="group">
              {root.data!.children.map((c) => <Node key={c.id} id={c.id} name={c.name} depth={0} hasChildren={c.hasChildren} selected={sel?.id ?? null} expanded={expanded} blocked={blocked}
                onSelect={(id, name) => { setDest({ id, name }); setError(null); }} onToggle={toggle} />)}
            </ul>
          </li>
        </ul>
      )}
      {naming !== null && sel ? (
        <form onSubmit={createFolder} className="mt-3 flex flex-col gap-2 rounded-xl border border-line p-3">
          <TextField label={t('explorer.pick.newIn', { name: sel.name })} value={naming} error={nameError} maxLength={255} autoFocus autoComplete="off" onChange={(e) => { setNaming(e.target.value); setNameError(null); }} />
          <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setNaming(null)}>{t('common.cancel')}</Button><Button size="sm" type="submit" variant="primary" disabled={!naming.trim()}>{t('common.create')}</Button></div>
        </form>
      ) : null}
      {sel ? <p className="mt-3 text-xs text-ink-3" aria-live="polite">{t('explorer.pick.dest', { name: sel.name })}</p> : null}
      {error ? <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error.text}{error.conflict ? ` ${t('explorer.pick.keepBothHint')}` : ''}</p> : null}
    </Dialog>
  );
}

// --- tags ---
function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('explorer.tags.color')} className="flex flex-wrap gap-1">
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t(`explorer.color.${c}`)} title={t(`explorer.color.${c}`)} onClick={() => onChange(c)}
          className={cx('flex h-8 w-8 items-center justify-center rounded-full', value === c && 'ring-2 ring-accent')}>
          <span className={cx('h-5 w-5 rounded-full', tagStyle(c).dot)} />
        </button>
      ))}
    </div>
  );
}
export const tagsKey = [XKEY, 'tags'];
export const useTags = () => useQuery({ queryKey: tagsKey, queryFn: () => get<Tag[]>('/tags'), staleTime: 30_000 });

/** Tick tags on one file; create, rename, recolour and delete the account's tags. */
export function TagsDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const tags = useTags();
  const [ids, setIds] = useState<string[]>(file.tagIds);
  const [edit, setEdit] = useState<{ id: string; name: string; color: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', color: 'blue' });
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [XKEY] });
  const assign = async (next: string[]) => {
    const prev = ids;
    setIds(next);
    try { await patch(`/files/${file.id}`, { tagIds: next }); void refresh(); } catch (e) { setIds(prev); toast(errorText(e), { tone: 'error' }); }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setError(null);
    try {
      const tag = await post<Tag>('/tags', { name: draft.name.trim(), color: draft.color });
      setDraft({ name: '', color: draft.color });
      await refresh();
      await assign([...ids, tag.id]);
    } catch (err) { setError(err instanceof ApiError && err.code === 'name_conflict' ? t('explorer.tags.exists') : errorText(err)); }
  };
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit?.name.trim()) return;
    try { await patch(`/tags/${edit.id}`, { name: edit.name.trim(), color: edit.color }); await refresh(); setEdit(null); setEditError(null); }
    catch (err) { setEditError(err instanceof ApiError && err.code === 'name_conflict' ? t('explorer.tags.exists') : errorText(err)); }
  };
  const remove = async (id: string) => {
    try { await del(`/tags/${id}`); setIds((x) => x.filter((y) => y !== id)); setRemoving(null); await refresh(); } catch (e) { toast(errorText(e), { tone: 'error' }); }
  };
  return (
    <Dialog title={t('explorer.tags.title', { name: file.name })} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('explorer.tags.done')}</Button>}>
      {tags.isLoading ? <Loading /> : tags.error ? <p role="alert" className="text-sm text-danger">{errorText(tags.error)}</p> : (
        <ul className="-mx-2 flex flex-col">
          {tags.data!.length === 0 ? <li className="px-2 py-3 text-sm text-ink-3">{t('explorer.tags.empty')}</li> : null}
          {tags.data!.map((g) => edit?.id === g.id ? (
            <li key={g.id} className="my-1 rounded-xl border border-line p-3">
              <form onSubmit={saveEdit} className="flex flex-col gap-2.5">
                <TextField label={t('explorer.tags.name')} value={edit.name} maxLength={40} error={editError} autoFocus onChange={(e) => { setEdit({ ...edit, name: e.target.value }); setEditError(null); }} />
                <Swatches value={edit.color} onChange={(color) => setEdit({ ...edit, color })} />
                <div className="flex justify-end gap-2"><Button size="sm" onClick={() => { setEdit(null); setEditError(null); }}>{t('common.cancel')}</Button><Button size="sm" type="submit" variant="primary">{t('common.save')}</Button></div>
              </form>
            </li>
          ) : removing === g.id ? (
            <li key={g.id} className="my-1 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2">
              <p className="min-w-0 flex-1 text-sm text-danger">{t('explorer.tags.confirmDelete', { name: g.name, n: g.files })}</p>
              <Button size="sm" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button><Button size="sm" variant="danger" onClick={() => void remove(g.id)}>{t('common.delete')}</Button>
            </li>
          ) : (
            <li key={g.id} className="flex items-center rounded-lg hover:bg-hover">
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 px-2">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" checked={ids.includes(g.id)} onChange={(e) => void assign(e.target.checked ? [...ids, g.id] : ids.filter((x) => x !== g.id))} />
                <span className={cx('truncate rounded-full px-2 py-0.5 text-xs font-medium', tagStyle(g.color).chip)}>{g.name}</span>
                <span className="shrink-0 text-xs text-ink-3">{t('explorer.tags.count', { n: g.files })}</span>
              </label>
              <IconButton icon="pencil" size={16} label={t('explorer.tags.edit', { name: g.name })} onClick={() => { setEdit({ id: g.id, name: g.name, color: g.color }); setRemoving(null); }} />
              <IconButton icon="trash" size={16} label={t('explorer.tags.delete', { name: g.name })} onClick={() => { setRemoving(g.id); setEdit(null); }} />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
        <TextField label={t('explorer.tags.new')} value={draft.name} maxLength={40} error={error} autoComplete="off" onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setError(null); }} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Swatches value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          <Button type="submit" icon="plus" disabled={!draft.name.trim()}>{t('explorer.tags.create')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
