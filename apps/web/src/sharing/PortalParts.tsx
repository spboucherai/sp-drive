// Deposit portals, owner side: state badge, the actions on a portal, the folder picker used to create one.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { del, get, patch, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { Folder, Portal } from '../types.ts';
import { Badge, Button, ConfirmDialog, cx, Dialog, ErrorState, IconButton, Menu, Spinner, useToast } from '../ui.tsx';
import { LinkOnce } from './common.tsx';
import { RequestDialog } from './RequestDialog.tsx';

export const PORTAL_TONE: Record<Portal['state'], 'ok' | 'danger' | 'warn' | 'neutral'> = { open: 'ok', paused: 'neutral', revoked: 'danger', expired: 'warn', full: 'warn', target_missing: 'danger' };
export function PortalState({ state }: { state: Portal['state'] }) {
  const t = useT();
  return <Badge tone={PORTAL_TONE[state]}><span title={t(`sharing.pstateHint.${state}`)} data-testid="portal-state">{t(`sharing.pstate.${state}`)}</span></Badge>;
}
/** Reject codes written by the inspection worker, in the owner's words. */
export const REJECT_CODES = ['type_not_allowed', 'incomplete', 'executable', 'type_mismatch', 'infected', 'unscannable', 'target_unavailable', 'quota_exceeded', 'expired'];

type Sub = 'edit' | 'revoke' | 'purge' | 'rotate' | { url: string } | null;
/** Pause/reactivate button and the menu of the other actions; owns the dialogs they open. */
export function PortalActions({ portal, onPurged }: { portal: Portal; onPurged?: () => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests'] });
  const [sub, setSub] = useState<Sub>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const live = !portal.revokedAt;
  const toggle = async () => {
    setBusy(true);
    try { await patch(`/requests/${portal.id}`, { active: !portal.active }); await invalidate(); toast(portal.active ? t('sharing.portal.paused') : t('sharing.portal.resumed'), { tone: 'ok' }); }
    catch { toast(t('common.error.unknown'), { tone: 'error' }); } finally { setBusy(false); }
  };
  const label = t('sharing.item.actions', { name: portal.title });
  return (
    <>
      {live ? <Button size="sm" icon={portal.active ? 'pause' : 'play'} busy={busy} onClick={toggle}>{portal.active ? t('sharing.portal.pause') : t('sharing.portal.resume')}</Button> : null}
      <IconButton icon="dots" label={label} onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} className="h-8 w-8" />
      {menu ? <Menu anchor={menu} label={label} onClose={() => setMenu(null)} items={[
        ...(live ? [{ label: t('common.edit'), icon: 'pencil', onSelect: () => setSub('edit') }, { label: t('sharing.item.rotate'), icon: 'refresh', onSelect: () => setSub('rotate') },
          { label: t('sharing.item.revoke'), icon: 'x', danger: true, separatorBefore: true, onSelect: () => setSub('revoke') }] : []),
        { label: t('common.delete'), icon: 'trash', danger: true, onSelect: () => setSub('purge') },
      ]} /> : null}
      {sub === 'edit' ? <RequestDialog folder={{ id: portal.folderId, name: portal.folderName ?? '' }} portal={portal} onClose={() => setSub(null)} /> : null}
      {sub === 'rotate' ? <ConfirmDialog title={t('sharing.portal.rotate')} text={t('sharing.portal.rotateText')} confirmLabel={t('sharing.item.rotateConfirm')} onClose={() => setSub((s) => (s === 'rotate' ? null : s))}
        onConfirm={async () => { const r = await post<{ url: string }>(`/requests/${portal.id}/rotate`); setSub({ url: r.url }); }} /> : null}
      {sub && typeof sub === 'object' ? <Dialog title={t('sharing.link.newTitle')} onClose={() => setSub(null)} footer={<Button variant="primary" onClick={() => setSub(null)}>{t('sharing.link.done')}</Button>}><LinkOnce url={sub.url} title={portal.title} qr /></Dialog> : null}
      {sub === 'revoke' ? <ConfirmDialog danger title={t('sharing.portal.revokeTitle')} text={t('sharing.portal.revokeText')} confirmLabel={t('sharing.item.revoke')} onClose={() => setSub(null)}
        onConfirm={async () => { await del(`/requests/${portal.id}`); await invalidate(); toast(t('sharing.portal.revoked'), { tone: 'ok' }); }} /> : null}
      {sub === 'purge' ? <ConfirmDialog danger title={t('sharing.portal.purgeTitle')} text={t('sharing.portal.purgeText')} confirmLabel={t('common.delete')} onClose={() => setSub(null)}
        onConfirm={async () => { await del(`/requests/${portal.id}?purge=1`); toast(t('sharing.portal.purged'), { tone: 'ok' }); if (onPurged) onPurged(); await invalidate(); }} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- folder picker ----------------------------------------------------------------
interface Children { folder: Folder; children: (Folder & { hasChildren: boolean })[] }
function Node({ id, name, depth, hasChildren, selected, onSelect, startOpen }: { id: string; name: string; depth: number; hasChildren: boolean; selected: string | null; onSelect: (f: { id: string; name: string }) => void; startOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(!!startOpen);
  const q = useQuery({ queryKey: ['folder-children', id], queryFn: () => get<Children>(`/folders/${id}/children`), enabled: open });
  const realId = id === 'root' ? q.data?.folder.id ?? 'root' : id;
  const label = id === 'root' ? t('sharing.picker.root') : name;
  const isSel = selected === realId || selected === id;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={isSel}>
      <div className={cx('flex items-center rounded-lg', isSel ? 'bg-accent-soft' : 'hover:bg-hover')} style={{ paddingLeft: depth * 18 }}>
        {hasChildren ? <button type="button" aria-label={open ? t('sharing.picker.collapse', { name: label }) : t('sharing.picker.expand', { name: label })} onClick={() => setOpen((o) => !o)} className="inline-flex h-10 w-9 shrink-0 items-center justify-center text-ink-3">
          {open && q.isLoading ? <Spinner size={14} /> : <Glyph name={open ? 'chevronDown' : 'chevronRight'} size={16} />}</button> : <span className="w-9 shrink-0" />}
        <button type="button" onClick={() => onSelect({ id: realId, name: label })} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left text-sm">
          <Glyph name={id === 'root' ? 'home' : 'folder'} size={18} className={cx('shrink-0', isSel ? 'text-accent' : 'text-ink-3')} /><span className={cx('truncate', isSel && 'font-semibold text-accent')}>{label}</span>
        </button>
      </div>
      {open && q.data?.children.length ? <ul role="group">{q.data.children.map((c) => <Node key={c.id} id={c.id} name={c.name} depth={depth + 1} hasChildren={c.hasChildren} selected={selected} onSelect={onSelect} />)}</ul> : null}
      {open && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
    </li>
  );
}
/** Choose one folder of the drive (root included). Children are fetched when a branch is opened. */
export function FolderPicker({ title, confirmLabel, onPick, onClose }: { title: string; confirmLabel: string; onPick: (f: { id: string; name: string }) => void; onClose: () => void }) {
  const t = useT();
  const [sel, setSel] = useState<{ id: string; name: string } | null>(null);
  return (
    <Dialog title={title} onClose={onClose} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!sel} onClick={() => sel && onPick(sel)}>{confirmLabel}</Button></>}>
      <p className="mb-3 text-sm text-ink-2">{t('sharing.picker.intro')}</p>
      <ul role="tree" aria-label={title} data-testid="folder-tree"><Node id="root" name="" depth={0} hasChildren selected={sel?.id ?? null} onSelect={setSel} startOpen /></ul>
    </Dialog>
  );
}
