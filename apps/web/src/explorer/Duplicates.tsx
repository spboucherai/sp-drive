// Files with identical content inside the account, grouped; the extra copies of a group can go to the trash.
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'wouter';
import { get } from '../api.ts';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { ownerSource } from '../sources.ts';
import type { FileDetail, FileItem } from '../types.ts';
import { Badge, Button, EmptyState, ErrorState, IconButton, Loading } from '../ui.tsx';
import { pathText } from './Details.tsx';
import { XKEY } from './lib.ts';

interface Group { sha256: string; size: number; files: FileItem[] }

/** Where a file lives. One request per folder, whatever the number of copies in it. */
function Location({ file }: { file: FileItem }) {
  const t = useT();
  const q = useQuery({ queryKey: [XKEY, 'path', file.folderId], queryFn: async () => (await get<FileDetail>(`/files/${file.id}`)).path, staleTime: 60_000 });
  if (!q.data) return <span className="text-ink-3">{q.isLoading ? '…' : ''}</span>;
  return <Link href={q.data.length <= 1 ? '/' : `/folder/${file.folderId}`} className="truncate text-ink-2 underline-offset-2 hover:text-accent hover:underline">{pathText(q.data, t('explorer.root'))}</Link>;
}

export function Duplicates({ onOpen, onTrash }: { onOpen: (f: FileItem) => void; onTrash: (files: FileItem[]) => void }) {
  const t = useT();
  const loc = getLocale();
  const [shown, setShown] = useState(30);
  const q = useQuery({ queryKey: [XKEY, 'duplicates'], queryFn: () => get<{ groups: Group[] }>('/duplicates') });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const groups = q.data.groups;
  if (!groups.length) return <EmptyState icon="duplicate" title={t('explorer.empty.duplicates')} text={t('explorer.empty.duplicatesText')} />;
  const extra = groups.reduce((n, g) => n + g.size * (g.files.length - 1), 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">{t('explorer.dup.summary', { n: groups.length, size: formatBytes(extra, loc) })} <span className="text-ink-3">{t('explorer.dup.note')}</span></p>
      {groups.slice(0, shown).map((g) => (
        <section key={`${g.sha256}:${g.size}`} aria-label={g.files[0]!.name} className="rounded-card border border-line bg-surface" data-testid="dup-group">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Badge tone="accent">{t('explorer.dup.copies', { n: g.files.length })}</Badge>
            <span className="min-w-0 flex-1 text-sm text-ink-2">{t('explorer.dup.each', { size: formatBytes(g.size, loc) })} · {t('explorer.dup.saved', { size: formatBytes(g.size * (g.files.length - 1), loc) })}</span>
            <Button size="sm" icon="trash" onClick={() => onTrash(g.files.slice(1))}>{t('explorer.dup.trashExtra', { n: g.files.length - 1 })}</Button>
          </header>
          <ul className="divide-y divide-line">
            {g.files.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-1.5">
                <Thumb name={f.name} kind={f.kind} className="h-9 w-9 shrink-0 overflow-hidden rounded-md" src={f.thumb && f.scan !== 'infected' ? ownerSource(f).previewUrl('thumb') : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink"><span className="truncate">{f.name}</span>{i === 0 ? <Badge tone="ok">{t('explorer.dup.kept')}</Badge> : null}</p>
                  <p className="flex min-w-0 gap-1 text-xs text-ink-3"><Location file={f} /><span className="shrink-0">· {fmtDate(f.createdAt, { dateStyle: 'medium' })}</span></p>
                </div>
                {f.scan !== 'infected' ? <IconButton icon="eye" size={18} label={t('explorer.openNamed', { name: f.name })} onClick={() => onOpen(f)} /> : null}
                <IconButton icon="trash" size={18} label={t('explorer.trashNamed', { name: f.name })} onClick={() => onTrash([f])} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length > shown ? <Button className="self-center" onClick={() => setShown(shown + 30)}>{t('explorer.dup.more', { n: groups.length - shown })}</Button> : null}
    </div>
  );
}
