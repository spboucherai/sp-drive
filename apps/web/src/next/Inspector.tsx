// The contextual inspector of the explorer: everything about the selected item without leaving the listing —
// properties, tags, versions and sharing (the 1.0 details), its activity, the state of its extracted text, the
// members of a shared folder, and questions to the document when AI is available.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get } from '../api.ts';
import { DetailsBody, type DetailsProps } from '../explorer/Details.tsx';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { FileItem } from '../types.ts';
import { Badge, cx, Loading } from '../ui.tsx';
import { Timeline } from './Activity.tsx';
import { AskPanel } from './ai/Ask.tsx';
import { MembersPanel } from './Members.tsx';
import { useMeta } from './meta.ts';
import type { TextStatus } from './types.ts';

type Tab = 'details' | 'activity' | 'content' | 'members' | 'ask';
const TAB_ICON: Record<Tab, string> = { details: 'info', activity: 'activity', content: 'text', members: 'users', ask: 'sparkle' };
let lastTab: Tab = 'details';

const TONE: Record<TextStatus['status'], 'ok' | 'warn' | 'danger' | 'neutral' | 'accent'> = { ready: 'ok', pending: 'accent', empty: 'neutral', unsupported: 'neutral', failed: 'danger' };
/** What the server extracted from the file for search and AI: status, source (text layer, OCR…), an excerpt. */
export function TextPanel({ file }: { file: FileItem }) {
  const t = useT();
  const q = useQuery({ queryKey: ['next', 'text', file.id, file.sha256], queryFn: () => get<TextStatus>(`/files/${file.id}/text`), refetchInterval: (x) => (x.state.data?.status === 'pending' ? 4000 : false) });
  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return <p role="alert" className="py-6 text-center text-sm text-danger">{t('next.text.error')}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="text-status" data-status={d.status}>
      <div className="flex items-center gap-2"><Badge tone={TONE[d.status]}>{t(`next.text.${d.status}`)}</Badge>{d.source ? <span className="text-xs text-ink-3">{t(`next.text.src.${d.source}`) === `next.text.src.${d.source}` ? d.source : t(`next.text.src.${d.source}`)}</span> : null}</div>
      <p className="text-[13px] leading-relaxed text-ink-2">{t(`next.text.${d.status}Text`)}{d.error ? ` (${d.error})` : ''}</p>
      {d.status === 'ready' ? (
        <>
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <div className="rounded-[10px] bg-hover px-3 py-2"><dt className="spd-eyebrow">{t('next.text.chars')}</dt><dd className="spd-figure mt-0.5 text-[17px] text-ink">{new Intl.NumberFormat().format(d.chars)}</dd></div>
            <div className="rounded-[10px] bg-hover px-3 py-2"><dt className="spd-eyebrow">{t('next.text.pages')}</dt><dd className="spd-figure mt-0.5 text-[17px] text-ink">{d.pages || '—'}</dd></div>
          </dl>
          <div><h4 className="spd-eyebrow mb-1">{t('next.text.excerpt')}</h4><p className="max-h-56 overflow-y-auto rounded-[10px] border border-line bg-surface px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-2" data-testid="text-excerpt">{d.excerpt}</p></div>
        </>
      ) : null}
      <p className="text-xs leading-relaxed text-ink-3">{t('next.text.note')}</p>
    </div>
  );
}

export function Inspector(p: DetailsProps & { initialTab?: 'details' | 'ask' }) {
  const t = useT();
  const meta = useMeta();
  const { item } = p;
  const file = item.type === 'file' ? item : null;
  const trashed = !!item.trashedAt;
  const tabs: Tab[] = ['details'];
  if (meta.features.includes('activity')) tabs.push('activity');
  if (file && meta.features.includes('content-search')) tabs.push('content');
  if (!file && meta.features.includes('collab') && !trashed && item.type === 'folder' && item.parentId) tabs.push('members');
  if (file && meta.features.includes('ai') && !trashed && file.scan !== 'infected') tabs.push('ask');
  const [tabState, setTabState] = useState<Tab>(p.initialTab ?? lastTab);
  const tab = tabs.includes(tabState) ? tabState : 'details';
  const setTab = (x: Tab) => { lastTab = x; setTabState(x); };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inspector">
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={t('next.insp.tabs')} className="mb-3 flex shrink-0 gap-0.5 rounded-[10px] bg-well p-0.5">
          {tabs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} title={t(`next.insp.${k}`)} onClick={() => setTab(k)} data-tab={k}
              className={cx('flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 text-xs transition-colors', tab === k ? 'bg-surface font-medium text-ink shadow-(--shadow-card)' : 'text-ink-2 hover:text-ink')}>
              <Glyph name={TAB_ICON[k]} size={14} className="shrink-0" /><span className={cx('truncate', tabs.length > 3 && tab !== k && 'sr-only')}>{t(`next.insp.${k}`)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" className={cx('min-h-0 flex-1', tab === 'ask' ? 'flex flex-col' : 'overflow-y-auto')} style={{ ['--tl-bg' as string]: 'var(--insp-bg, var(--spd-color-surface-raised))' }}>
        {tab === 'details' ? <DetailsBody {...p} />
          : tab === 'activity' ? <Timeline path={file ? `/files/${file.id}/activity` : `/folders/${item.id}/activity`} queryKey={[item.type, item.id]} withTarget={!file} dense />
          : tab === 'content' && file ? <TextPanel file={file} />
          : tab === 'members' ? <MembersPanel folderId={item.id} />
          : tab === 'ask' && file ? <AskPanel scope={{ fileIds: [file.id] }} compact placeholder={t('next.ai.placeholderFile')} intro={<p className="text-[13px] leading-relaxed text-ink-3">{t('next.ai.fileIntro', { name: file.name })}</p>} />
          : null}
      </div>
    </div>
  );
}
