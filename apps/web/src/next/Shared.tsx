// Private sharing, both sides of it on one screen: the folders other accounts shared with me ("Partagés avec moi"),
// and the folders I share. A shared folder is browsed through the /shared/:grantId routes, with what the role allows:
// a viewer reads, an editor also creates, renames, sends and trashes, an uploader only gets a surface to send files in.
import { formatBytes } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ApiError, get, patch, post, qs } from '../api.ts';
import { NameDialog } from '../explorer/dialogs.tsx';
import { filesFromDrop, pickedFromInput, type Picked, triggerDownload } from '../explorer/lib.ts';
import { transferCentre } from '../explorer/UploadPanel.tsx';
import { uploads, useUploads } from '../explorer/uploads.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtRelative, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { Viewer } from '../preview/Viewer.tsx';
import type { FileItem, Folder, PreviewSource } from '../types.ts';
import { Badge, Button, ConfirmDialog, cx, Dialog, EmptyState, ErrorState, IconButton, Loading, Menu, type MenuItem, useToast } from '../ui.tsx';
import { Timeline } from './Activity.tsx';
import { MembersDialog, ROLE_ICON } from './Members.tsx';
import type { Role, SharedListing, SharedWithMe } from './types.ts';

const sharedSource = (grantId: string, f: FileItem): PreviewSource => {
  const base = `/api/v1/shared/${grantId}/files/${f.id}`;
  return { id: `${grantId}:${f.id}`, name: f.name, size: f.size, kind: f.kind, canDownload: true,
    contentUrl: (o = {}) => `${base}/content${qs({ download: o.download ? 1 : undefined, as: o.text ? 'text' : undefined })}`, previewUrl: (kind) => `${base}/preview/${kind}` };
};
export function RolePill({ role }: { role: Role }) {
  const t = useT();
  return <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11px] font-medium text-ink-2" data-role={role}><Glyph name={ROLE_ICON[role]} size={11} />{t(`next.role.${role}`)}</span>;
}

/** /shared — what others shared with me, and what I share. */
export function SharedScreen() {
  const t = useT();
  const mine = useQuery({ queryKey: ['next', 'shared-with-me'], queryFn: () => get<SharedWithMe[]>('/shared-with-me'), refetchOnMount: 'always' });
  const out = useQuery({ queryKey: ['next', 'outgoing'], queryFn: () => get<{ folder: Folder & { workspaceName?: string | null }; members: number }[]>('/collab/outgoing'), refetchOnMount: 'always' });
  const [manage, setManage] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="pb-dock mx-auto w-full max-w-4xl px-4 pt-3 sm:px-8 sm:pt-6" data-testid="shared-screen">
      <header className="mb-5">
        <h1 className="text-[30px] leading-[1.1] sm:text-[32px]">{t('next.shared.title')}</h1>
        <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-2">{t('next.shared.intro')}</p>
      </header>
      <section aria-label={t('next.shared.withMe')}>
        <h2 className="spd-eyebrow mb-2">{t('next.shared.withMe')}</h2>
        {mine.isLoading ? <Loading /> : mine.error ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : !mine.data?.length ? (
          <p className="rounded-[12px] border border-dashed border-line-strong px-5 py-8 text-center text-[13px] leading-relaxed text-ink-2" data-testid="shared-empty">{t('next.shared.none')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {mine.data.map((g) => (
              <li key={g.grantId}>
                <Link href={`/shared/${g.grantId}`} data-testid="grant" data-role={g.role} className="press flex items-center gap-3 rounded-[12px] px-3 py-3 shadow-(--spd-elevation-e0) transition-colors hover:bg-hover">
                  <Thumb name={g.folder.name} kind="folder" className="h-10 w-10 shrink-0 rounded-[10px]!" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{g.folder.workspaceName ?? g.folder.name}</span>
                    <span className="block truncate text-xs text-ink-3">{t('next.shared.by', { name: g.owner.displayName })} · {fmtRelative(g.folder.updatedAt)}</span>
                  </span>
                  <RolePill role={g.role} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('next.shared.byMe')} className="mt-8">
        <h2 className="spd-eyebrow mb-2">{t('next.shared.byMe')}</h2>
        {out.isLoading ? <Loading /> : out.error ? <ErrorState error={out.error} onRetry={() => void out.refetch()} /> : !out.data?.length ? (
          <p className="rounded-[12px] border border-dashed border-line-strong px-5 py-8 text-center text-[13px] leading-relaxed text-ink-2">{t('next.shared.noneOut')}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)">
            {out.data.map((o) => (
              <li key={o.folder.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="outgoing">
                <Thumb name={o.folder.name} kind="folder" className="h-9 w-9 shrink-0 rounded-[8px]!" />
                <Link href={`/folder/${o.folder.id}`} className="min-w-0 flex-1 hover:underline"><span className="block truncate text-[14px] font-medium text-ink">{o.folder.workspaceName ?? o.folder.name}</span><span className="block truncate text-xs text-ink-3">{o.folder.workspaceName ? `${o.folder.name} · ` : ''}{t('next.mem.count', { n: o.members })}</span></Link>
                <Button size="sm" icon="users" onClick={() => setManage({ id: o.folder.id, name: o.folder.name })}>{t('next.shared.manage')}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {manage ? <MembersDialog folder={manage} onClose={() => { setManage(null); void out.refetch(); }} /> : null}
    </div>
  );
}

/** The surface an uploader gets: nothing is listed, files only go in. */
function UploadSurface({ grantId, folderId, title, onPick }: { grantId: string; folderId?: string; title?: string; onPick: (p: Picked[]) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { items } = useUploads();
  const mine = items.filter((i) => i.grantId === grantId);
  const sent = mine.filter((i) => i.state === 'done');
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void filesFromDrop(e.dataTransfer).then((p) => { if (p.length) onPick(p); }); };
  return (
    <div data-testid="upload-surface" data-folder={folderId ?? ''}>
      <div onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cx('flex flex-col items-center gap-3 rounded-[20px] border-2 border-dashed px-6 py-12 text-center transition-colors', over ? 'drop-target border-transparent' : 'border-line-strong')}>
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent"><Glyph name="upload" size={26} /></span>
        <h2 className="spd-display text-[24px] text-ink">{title ?? t('next.shared.uploaderTitle')}</h2>
        <p className="max-w-sm text-[14px] leading-relaxed text-ink-2">{t('next.shared.uploaderText')}</p>
        <input ref={input} type="file" multiple hidden data-testid="shared-upload-input" onChange={(e) => { const p = pickedFromInput(e.target.files); e.target.value = ''; if (p.length) onPick(p); }} />
        <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>{t('next.shared.choose')}</Button>
      </div>
      {mine.length ? (
        <p className="mt-3 text-center text-[13px] text-ink-2" role="status" data-testid="uploader-status">
          {t('next.shared.sentN', { n: sent.length, total: mine.length })} · <button type="button" className="font-medium text-accent hover:underline" onClick={() => transferCentre.open()}>{t('next.shared.seeTransfers')}</button>
        </p>
      ) : null}
    </div>
  );
}

/** /shared/:grantId[/:folderId] — a folder shared with me. */
export function SharedBrowser({ grantId, folderId }: { grantId: string; folderId?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [, navigate] = useLocation();
  const loc = getLocale();
  const grants = useQuery({ queryKey: ['next', 'shared-with-me'], queryFn: () => get<SharedWithMe[]>('/shared-with-me') });
  const grant = grants.data?.find((g) => g.grantId === grantId);
  const uploader = grant?.role === 'uploader';
  const key = ['next', 'shared', grantId, folderId ?? ''];
  const q = useQuery({ queryKey: key, queryFn: () => get<SharedListing>(`/shared/${grantId}/children${qs({ folderId })}`), enabled: !!grant && !uploader, retry: false });
  const [viewer, setViewer] = useState<FileItem | null>(null);
  const [menu, setMenu] = useState<{ items: MenuItem[]; anchor: DOMRect; label: string } | null>(null);
  const [dlg, setDlg] = useState<{ type: 'folder' } | { type: 'rename'; item: FileItem | Folder } | { type: 'trash'; item: FileItem | Folder } | { type: 'activity' } | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['next', 'shared', grantId] });
  const send = (p: Picked[]) => { uploads.enqueue(p, folderId ?? '', { grantId }); transferCentre.open(); };

  const head = (name: string, role: Role | undefined, owner?: string) => (
    <header className="mb-4">
      <nav aria-label={t('explorer.breadcrumbs')} className="mb-1 flex flex-wrap items-center gap-1 text-[13px] text-ink-2" data-testid="shared-crumbs">
        <Link href="/shared" className="rounded px-1 hover:bg-hover hover:text-ink">{t('next.shared.title')}</Link>
        {(q.data?.breadcrumbs ?? []).map((c, i, all) => <span key={c.id} className="flex items-center gap-1"><Glyph name="chevronRight" size={12} className="text-ink-3" />{i === all.length - 1 ? <span className="px-1 font-medium text-ink">{i === 0 ? grant?.folder.workspaceName ?? c.name : c.name}</span> : <Link href={i === 0 ? `/shared/${grantId}` : `/shared/${grantId}/${c.id}`} className="rounded px-1 hover:bg-hover hover:text-ink">{i === 0 ? grant?.folder.workspaceName ?? c.name : c.name}</Link>}</span>)}
      </nav>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 truncate text-[28px] leading-[1.15] sm:text-[30px]">{name}</h1>
        {role ? <RolePill role={role} /> : null}
        <span className="flex-1" />
        {role && role !== 'uploader' ? <Button size="sm" icon="activity" onClick={() => setDlg({ type: 'activity' })}>{t('next.mem.activity')}</Button> : null}
        {role === 'editor' ? <><Button size="sm" icon="folderPlus" onClick={() => setDlg({ type: 'folder' })}>{t('explorer.newFolder')}</Button><Button size="sm" variant="primary" icon="upload" onClick={() => input.current?.click()}>{t('next.shared.send')}</Button></> : null}
      </div>
      {owner ? <p className="mt-1 text-[13px] text-ink-3">{t('next.shared.by', { name: owner })} · {t(`next.role.${role}Hint`)}</p> : null}
    </header>
  );
  const wrap = 'pb-dock mx-auto w-full max-w-4xl px-4 pt-3 sm:px-8 sm:pt-6';
  if (grants.isLoading) return <Loading />;
  if (!grant) return <div className={wrap} data-testid="shared-gone"><EmptyState icon="users" title={t('next.shared.goneTitle')} text={t('next.shared.goneText')} action={<Link href="/shared" className="btn-grad press inline-flex h-9 items-center rounded-[10px] px-4 text-[13px] font-medium">{t('next.shared.title')}</Link>} /></div>;
  const display = grant.folder.workspaceName ?? grant.folder.name;
  if (uploader) return <div className={wrap} data-testid="shared-browser" data-role="uploader">{head(display, 'uploader', grant.owner.displayName)}<UploadSurface grantId={grantId} onPick={send} /></div>;
  if (q.isLoading) return <div className={wrap}>{head(display, grant.role, grant.owner.displayName)}<Loading /></div>;
  if (q.error || !q.data) return <div className={wrap}>{q.error instanceof ApiError && q.error.status === 404 ? <EmptyState icon="users" title={t('next.shared.goneTitle')} text={t('next.shared.goneText')} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}</div>;
  const d = q.data, editor = d.role === 'editor';
  const title = d.folder.isGrantRoot ? display : d.folder.name;
  const rowMenu = (it: FileItem | Folder, rect: DOMRect) => {
    const items: MenuItem[] = [];
    if (it.type === 'file') { items.push({ label: t('common.open'), icon: 'eye', onSelect: () => setViewer(it) }); items.push({ label: t('common.download'), icon: 'download', onSelect: () => triggerDownload(sharedSource(grantId, it).contentUrl({ download: true })) }); }
    else items.push({ label: t('common.open'), icon: 'folder', onSelect: () => navigate(`/shared/${grantId}/${it.id}`) });
    if (editor) { items.push({ label: t('explorer.a.rename'), icon: 'pencil', separatorBefore: true, onSelect: () => setDlg({ type: 'rename', item: it }) }); items.push({ label: t('explorer.a.trash'), icon: 'trash', danger: true, onSelect: () => setDlg({ type: 'trash', item: it }) }); }
    setMenu({ items, anchor: rect, label: t('explorer.actionsFor', { name: it.name }) });
  };
  const empty = !d.folders.length && !d.files.length;
  return (
    <div className={cx(wrap, 'relative min-h-full')} data-testid="shared-browser" data-role={d.role}
      onDragOver={(e) => { if (editor && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!editor) return; e.preventDefault(); setOver(false); void filesFromDrop(e.dataTransfer).then((p) => { if (p.length) send(p); }); }}>
      {head(title, d.role, d.folder.isGrantRoot ? grant.owner.displayName : undefined)}
      <input ref={input} type="file" multiple hidden data-testid="shared-upload-input" onChange={(e) => { const p = pickedFromInput(e.target.files); e.target.value = ''; if (p.length) send(p); }} />
      {empty ? <EmptyState icon="folder" title={t('explorer.empty.folder')} text={editor ? t('next.shared.emptyEditor') : t('next.shared.emptyViewer')} action={editor ? <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>{t('next.shared.send')}</Button> : undefined} /> : (
        <ul className={cx('anim-nav divide-y divide-line overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)', over && 'drop-target')} data-dir="same" data-testid="shared-listing">
          {[...d.folders, ...d.files].map((it) => {
            const file = it.type === 'file' ? it : null;
            const inner = (
              <>
                <Thumb name={it.name} kind={file ? file.kind : 'folder'} className="h-9 w-9 shrink-0 overflow-hidden rounded-[8px]!" src={file && file.thumb && file.scan !== 'infected' ? sharedSource(grantId, file).previewUrl('thumb') : undefined} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium text-ink" data-name>{it.name}</span><span className="block truncate text-xs text-ink-3">{file ? `${formatBytes(file.size, loc)} · ` : ''}{fmtRelative(it.updatedAt)}</span></span>
                {file?.scan === 'infected' ? <Badge tone="danger">{t('explorer.infected')}</Badge> : null}
              </>
            );
            const cls = 'flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left';
            return (
              <li key={it.id} className="flex items-center transition-colors hover:bg-hover" data-type={it.type} data-testid="shared-row">
                {file ? <button type="button" className={cls} disabled={file.scan === 'infected'} onClick={() => setViewer(file)}>{inner}</button> : <Link href={`/shared/${grantId}/${it.id}`} className={cls}>{inner}</Link>}
                <IconButton icon="dots" size={18} label={t('explorer.actionsFor', { name: it.name })} aria-haspopup="menu" onClick={(e) => rowMenu(it, e.currentTarget.getBoundingClientRect())} />
              </li>
            );
          })}
        </ul>
      )}
      {menu ? <Menu items={menu.items} anchor={menu.anchor} label={menu.label} onClose={() => setMenu(null)} /> : null}
      {dlg?.type === 'folder' ? <NameDialog title={t('explorer.newFolder')} label={t('explorer.name.folder')} submitLabel={t('common.create')} onClose={() => setDlg(null)} onSubmit={async (name) => { await post(`/shared/${grantId}/folders`, { parentId: folderId, name, onConflict: 'fail' }); await refresh(); }} /> : null}
      {dlg?.type === 'rename' ? <NameDialog title={t('explorer.a.rename')} label={t('explorer.name.new')} initial={dlg.item.name} selectStem={dlg.item.type === 'file'} submitLabel={t('explorer.a.rename')} onClose={() => setDlg(null)} onSubmit={async (name) => { await patch(`/shared/${grantId}/items/${dlg.item.id}`, { name }); await refresh(); }} /> : null}
      {dlg?.type === 'trash' ? <ConfirmDialog danger title={t('next.shared.trashTitle', { name: dlg.item.name })} text={t('next.shared.trashText')} confirmLabel={t('explorer.a.trash')} onClose={() => setDlg(null)}
        onConfirm={async () => { await post(`/shared/${grantId}/trash`, dlg.item.type === 'file' ? { fileIds: [dlg.item.id] } : { folderIds: [dlg.item.id] }); await refresh(); toast(t('explorer.trashedOne', { name: dlg.item.name })); }} /> : null}
      {dlg?.type === 'activity' ? <Dialog title={t('next.mem.activity')} onClose={() => setDlg(null)} wide><div style={{ ['--tl-bg' as string]: 'var(--spd-color-surface-raised)' }}><Timeline path={`/shared/${grantId}/activity`} queryKey={['grant', grantId]} withTarget dense /></div></Dialog> : null}
      {viewer ? <Viewer source={sharedSource(grantId, viewer)} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}
