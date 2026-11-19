// AI organisation suggestions for a handful of files: a review list. The server proposes (a clearer name, tags, a
// folder) and applies nothing; each proposal is applied here with the ordinary endpoints, one at a time, only when
// the user confirms it.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, get, patch, post } from '../../api.ts';
import { Glyph } from '../../glyphs.tsx';
import { errorText, useT } from '../../i18n.ts';
import type { FileItem, Tag } from '../../types.ts';
import { Button, cx, Dialog, Spinner } from '../../ui.tsx';
import type { AiSuggestion } from '../types.ts';
import { AiUnavailable, useAiProviders } from './Ask.tsx';
import { RouteMark } from './marks.tsx';

type Part = 'name' | 'tags' | 'folder';
type Done = Record<string, 'applied' | 'dismissed' | 'busy' | { error: string }>;
const TAG_COLORS = ['blue', 'violet', 'teal', 'green', 'amber', 'orange', 'pink', 'red', 'slate'];

export function SuggestDialog({ files, onClose }: { files: FileItem[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const providers = useAiProviders();
  const [state, setState] = useState<Done>({});
  const run = useMutation({ mutationFn: () => post<{ provider: string; model: string; suggestions: AiSuggestion[] }>('/ai/suggest', { fileIds: files.map((f) => f.id) }) });
  const enabled = providers.data?.enabled;
  useEffect(() => { if (enabled && run.isIdle) run.mutate(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(files.map((f) => [f.id, f]));
  const mark = (k: string, v: Done[string]) => setState((s) => ({ ...s, [k]: v }));
  const apply = async (s: AiSuggestion, part: Part) => {
    const k = `${s.fileId}:${part}`;
    mark(k, 'busy');
    try {
      if (part === 'name') await patch(`/files/${s.fileId}`, { name: s.name });
      else if (part === 'folder') await post('/move', { fileIds: [s.fileId], folderIds: [], destinationId: s.folder!.id, onConflict: 'fail' });
      else {
        // tags by name: reuse the account's tags, create the missing ones, then add them to the file's own
        let all = await get<Tag[]>('/tags');
        const ids: string[] = [];
        for (const [i, name] of (s.tags ?? []).entries()) {
          let tag = all.find((g) => g.name.toLowerCase() === name.toLowerCase());
          if (!tag) { tag = await post<Tag>('/tags', { name, color: TAG_COLORS[(all.length + i) % TAG_COLORS.length] }); all = [...all, tag]; }
          ids.push(tag.id);
        }
        const cur = (await get<{ file: FileItem }>(`/files/${s.fileId}`)).file.tagIds;
        await patch(`/files/${s.fileId}`, { tagIds: [...new Set([...cur, ...ids])] });
      }
      mark(k, 'applied');
      void qc.invalidateQueries({ queryKey: ['explorer'] });
    } catch (e) { mark(k, { error: e instanceof ApiError && e.code === 'name_conflict' ? t('next.sug.conflict') : errorText(e) }); }
  };
  const row = (s: AiSuggestion, part: Part, icon: string, label: string, value: React.ReactNode) => {
    const k = `${s.fileId}:${part}`, st = state[k];
    if (st === 'dismissed') return null;
    return (
      <li key={part} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-testid="suggestion" data-part={part} data-state={typeof st === 'string' ? st : st ? 'error' : 'open'}>
        <Glyph name={icon} size={15} className="shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1 basis-48"><p className="spd-eyebrow">{label}</p><p className="mt-0.5 text-[13px] break-words text-ink">{value}</p>{st && typeof st === 'object' ? <p role="alert" className="mt-0.5 text-xs text-danger">{st.error}</p> : null}</div>
        {st === 'applied' ? <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><Glyph name="check" size={14} strokeWidth={2.2} />{t('next.sug.applied')}</span> : (
          <span className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="ghost" disabled={st === 'busy'} onClick={() => mark(k, 'dismissed')}>{t('next.sug.ignore')}</Button>
            <Button size="sm" variant="primary" busy={st === 'busy'} onClick={() => void apply(s, part)}>{t('next.sug.apply')}</Button>
          </span>
        )}
      </li>
    );
  };
  const list = run.data?.suggestions ?? [];
  return (
    <Dialog title={t('next.sug.title')} onClose={onClose} wide testId="suggest-dialog">
      {providers.isLoading ? <div className="flex justify-center py-10 text-accent"><Spinner /></div>
        : providers.data && !providers.data.enabled ? <AiUnavailable data={providers.data} compact />
        : run.isPending || run.isIdle ? <div className="flex flex-col items-center gap-3 py-12 text-ink-3"><span className="text-accent"><Spinner /></span><p className="text-[13px]">{t('next.sug.thinking', { n: files.length })}</p></div>
        : run.error ? <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center"><p className="max-w-sm text-[13px] text-danger">{run.error instanceof ApiError && t(`next.ai.err.${run.error.code}`) !== `next.ai.err.${run.error.code}` ? t(`next.ai.err.${run.error.code}`) : errorText(run.error)}</p><Button icon="refresh" onClick={() => run.mutate()}>{t('common.retry')}</Button></div>
        : (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-ink-2">{t('next.sug.intro')}</p>
            {list.map((s) => {
              const f = byId.get(s.fileId);
              const parts = [s.name ? row(s, 'name', 'pencil', t('next.sug.name'), s.name) : null, s.tags?.length ? row(s, 'tags', 'tag', t('next.sug.tags'), s.tags.join(' · ')) : null, s.folder ? row(s, 'folder', 'move', t('next.sug.folder'), s.folder.path) : null].filter(Boolean);
              return (
                <section key={s.fileId} className="rounded-[12px] border border-line px-3.5 py-2.5" data-testid="suggestion-file">
                  <h3 className="flex items-baseline gap-2 text-[14px] font-medium text-ink"><span className="truncate">{f?.name ?? s.fileId}</span>{s.category ? <span className="shrink-0 rounded bg-hover px-1.5 py-px text-[11px] font-medium text-ink-2">{s.category}</span> : null}</h3>
                  {s.reason ? <p className="mt-0.5 text-xs leading-snug text-ink-3">{s.reason}</p> : null}
                  {parts.length ? <ul className="mt-1 divide-y divide-line">{parts}</ul> : <p className="mt-2 text-xs text-ink-3">{t('next.sug.nothingFor')}</p>}
                </section>
              );
            })}
            {!list.length ? <p className="py-6 text-center text-[13px] text-ink-2" data-testid="suggest-empty">{t('next.sug.none')}</p> : null}
            {files.filter((f) => !list.some((s) => s.fileId === f.id)).length && list.length ? <p className="text-xs text-ink-3">{t('next.sug.missing', { n: files.filter((f) => !list.some((s) => s.fileId === f.id)).length })}</p> : null}
            {run.data ? <p className={cx('flex items-center gap-1.5 text-[11px] text-ink-3')}><RouteMark id={run.data.provider} size={13} />{run.data.model} · {t('next.sug.note')}</p> : null}
          </div>
        )}
    </Dialog>
  );
}
