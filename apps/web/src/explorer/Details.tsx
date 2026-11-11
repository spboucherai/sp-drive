// Details of one item: properties, checksum, location, tags, share count and the version history of a file.
import { extOf, formatBytes } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { Link } from 'wouter';
import { get, post, del } from '../api.ts';
import { errorText, fmtDate, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { ownerSource } from '../sources.ts';
import type { Crumb, FileDetail, FileItem, Item, Tag, Version } from '../types.ts';
import { Badge, Button, ConfirmDialog, copyText, IconButton, Loading, useToast } from '../ui.tsx';
import { TagChip } from './Items.tsx';
import { triggerDownload, XKEY } from './lib.ts';
import { uploads } from './uploads.ts';

export const fileKey = (id: string) => [XKEY, 'file', id];
const Line = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex gap-3 py-1.5 text-sm"><dt className="w-24 shrink-0 text-ink-3">{label}</dt><dd className="min-w-0 flex-1 break-words text-ink">{children}</dd></div>
);
export const pathText = (path: Crumb[], root: string) => path.map((c, i) => (i === 0 ? root : c.name)).join(' / ');

function Versions({ file, versions, readOnly }: { file: FileItem; versions: Version[]; readOnly: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<Version | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [XKEY] });
  const restore = async (v: Version) => {
    try { await post(`/files/${file.id}/versions/${v.id}/restore`); await refresh(); toast(t('explorer.ver.restored', { n: v.seq }), { tone: 'ok' }); } catch (e) { toast(errorText(e), { tone: 'error' }); }
  };
  const note = (v: Version) => { const m = /^restored from version (\d+)$/.exec(v.note); return m ? t('explorer.ver.restoredFrom', { n: Number(m[1]) }) : v.note; };
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('explorer.ver.title', { n: versions.length })}</h3>
      <ul className="divide-y divide-line" aria-label={t('explorer.ver.title', { n: versions.length })}>
        {versions.map((v) => (
          <li key={v.id} className="flex items-center gap-1 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">{t('explorer.ver.n', { n: v.seq })}{v.current ? <Badge tone="accent">{t('explorer.ver.current')}</Badge> : null}</p>
              <p className="truncate text-xs text-ink-3">{formatBytes(v.size, getLocale())} · {fmtDate(v.createdAt)}{v.note ? ` · ${note(v)}` : ''}</p>
            </div>
            <IconButton icon="download" size={18} label={t('explorer.ver.download', { n: v.seq })} onClick={() => triggerDownload(ownerSource(file, v.id).contentUrl({ download: true }))} />
            {!v.current && !readOnly ? <IconButton icon="restore" size={18} label={t('explorer.ver.restore', { n: v.seq })} onClick={() => void restore(v)} /> : null}
            {!v.current && !readOnly ? <IconButton icon="trash" size={18} label={t('explorer.ver.delete', { n: v.seq })} onClick={() => setRemoving(v)} /> : null}
          </li>
        ))}
      </ul>
      {!readOnly ? (
        <>
          <input ref={input} type="file" hidden data-testid="version-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploads.enqueue([{ file: f }], file.folderId, { fileId: file.id }); }} />
          <Button icon="upload" className="mt-2 w-full" onClick={() => input.current?.click()}>{t('explorer.ver.upload')}</Button>
          <p className="mt-1.5 text-xs text-ink-3">{t('explorer.ver.hint')}</p>
        </>
      ) : null}
      {removing ? <ConfirmDialog danger title={t('explorer.ver.deleteTitle', { n: removing.seq })} text={t('explorer.ver.deleteText')} confirmLabel={t('common.delete')} onClose={() => setRemoving(null)}
        onConfirm={async () => { await del(`/files/${file.id}/versions/${removing.id}`); await refresh(); }} /> : null}
    </section>
  );
}

export interface DetailsProps { item: Item; tags: Map<string, Tag>; folderPath?: Crumb[]; onTags: (f: FileItem) => void; onShare: (i: Item) => void; onClose: () => void }
export function DetailsBody({ item, tags, folderPath, onTags, onShare, onClose }: DetailsProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const q = useQuery({ queryKey: fileKey(item.id), queryFn: () => get<FileDetail>(`/files/${item.id}`), enabled: item.type === 'file' });
  const file = item.type === 'file' ? q.data?.file ?? item : null;
  const cur = file ?? item;
  const trashed = !!cur.trashedAt;
  const path = file ? q.data?.path : folderPath;
  const where = path?.length ? path[path.length - 1]! : null;
  const ext = extOf(cur.name);
  return (
    <div>
      <div className="flex items-center gap-3">
        <Thumb name={cur.name} kind={file ? file.kind : 'folder'} className="h-12 w-12 shrink-0 overflow-hidden rounded-lg"
          src={file && file.thumb && file.scan !== 'infected' ? ownerSource(file).previewUrl('thumb') : undefined} />
        <p className="min-w-0 flex-1 text-sm font-semibold break-words text-ink">{cur.name}</p>
      </div>
      {file?.scan === 'infected' ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t('explorer.infectedText')}</p> : null}
      {file?.origin === 'request' ? <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink-2">{t('explorer.viaPortal')}</p> : null}
      <dl className="mt-3">
        <Line label={t('explorer.d.type')}>{file ? `${t(`explorer.kind.${file.kind}`)}${ext ? ` (.${ext})` : ''}` : t('explorer.kind.folder')}</Line>
        {file ? <Line label={t('explorer.d.size')}>{formatBytes(file.size, getLocale())}<span className="text-ink-3"> · {t('explorer.d.bytes', { n: new Intl.NumberFormat(getLocale()).format(file.size) })}</span></Line> : null}
        <Line label={t('explorer.d.updated')}>{fmtDate(cur.updatedAt)}</Line>
        <Line label={t('explorer.d.created')}>{fmtDate(cur.createdAt)}</Line>
        {cur.trashedAt ? <Line label={t('explorer.d.trashed')}>{fmtDate(cur.trashedAt)}</Line> : null}
        {path?.length ? (
          <Line label={t('explorer.d.location')}>
            {trashed ? pathText(path, t('explorer.root')) : <Link href={path.length === 1 ? '/' : `/folder/${where!.id}`} onClick={onClose} className="text-accent underline-offset-2 hover:underline">{pathText(path, t('explorer.root'))}</Link>}
          </Line>
        ) : null}
        {file ? (
          <Line label="SHA-256">
            <span className="flex items-start gap-1">
              <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all text-ink-2" data-testid="sha256">{file.sha256}</code>
              <IconButton icon={copied ? 'check' : 'copy'} size={16} className="-my-1.5" label={copied ? t('common.copied') : t('explorer.d.copySha')}
                onClick={async () => { if (await copyText(file.sha256)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }} />
            </span>
          </Line>
        ) : null}
        {file ? (
          <Line label={t('explorer.d.tags')}>
            <span className="flex flex-wrap items-center gap-1.5">
              {file.tagIds.map((id) => tags.get(id)).filter((x): x is Tag => !!x).map((g) => <TagChip key={g.id} tag={g} />)}
              {!file.tagIds.length ? <span className="text-ink-3">{t('common.none')}</span> : null}
              {!trashed ? <button type="button" className="rounded px-1 text-xs font-medium text-accent hover:underline" onClick={() => onTags(file)}>{t('common.edit')}</button> : null}
            </span>
          </Line>
        ) : null}
        {file && q.data ? (
          <Line label={t('explorer.d.shares')}>
            <span className="flex flex-wrap items-center gap-1.5">
              {q.data.shares ? t('explorer.d.sharesN', { n: q.data.shares }) : <span className="text-ink-3">{t('explorer.d.sharesNone')}</span>}
              {!trashed && file.scan !== 'infected' ? <button type="button" className="rounded px-1 text-xs font-medium text-accent hover:underline" onClick={() => onShare(file)}>{t('explorer.d.manageShares')}</button> : null}
            </span>
          </Line>
        ) : null}
      </dl>
      {file ? (q.isLoading ? <Loading /> : q.error ? <p role="alert" className="mt-4 text-sm text-danger">{errorText(q.error)}</p> : q.data ? <Versions file={file} versions={q.data.versions} readOnly={trashed} /> : null) : null}
    </div>
  );
}
