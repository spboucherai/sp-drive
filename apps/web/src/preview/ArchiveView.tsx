// Archive inventory: the worker listed the entries (names and declared sizes) without extracting anything.
import { useMemo, useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { IconButton } from '../ui.tsx';
import { DerivedGate, fmtSize, Note, Tools, useDerived, useWindow } from './shared.tsx';

/** Same shape as ArchiveListing in services/api/src/tools.ts. */
export interface ArchiveListing { format: 'zip' | 'tar'; entries: { path: string; size: number; dir: boolean }[]; totalEntries: number; totalBytes: number; truncated: boolean; suspicious: boolean }
interface Node { name: string; path: string; dir: boolean; size: number; files: number; children: Node[] }

function buildTree(entries: ArchiveListing['entries']): Node {
  const root: Node = { name: '', path: '', dir: true, size: 0, files: 0, children: [] };
  const index = new Map<string, Node>([['', root]]);
  const ensureDir = (path: string): Node => {
    const hit = index.get(path); if (hit) return hit;
    const cut = path.lastIndexOf('/');
    const parent = ensureDir(cut < 0 ? '' : path.slice(0, cut));
    const node: Node = { name: path.slice(cut + 1), path, dir: true, size: 0, files: 0, children: [] };
    parent.children.push(node); index.set(path, node);
    return node;
  };
  for (const e of entries) {
    const path = e.path.replace(/\/+$/, '');
    if (!path) continue;
    if (e.dir) { ensureDir(path); continue; }
    const cut = path.lastIndexOf('/');
    const parent = ensureDir(cut < 0 ? '' : path.slice(0, cut));
    if (index.get(path)?.dir) continue; // a name used both as a file and as a folder: keep the folder
    parent.children.push({ name: path.slice(cut + 1), path, dir: false, size: e.size, files: 1, children: [] });
  }
  const finish = (n: Node): void => {
    if (!n.dir) return;
    n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const c of n.children) { finish(c); n.size += c.size; n.files += c.files; }
  };
  finish(root);
  return root;
}
const ROW = 40;

function Inventory({ data }: { data: ArchiveListing }) {
  const t = useT();
  const root = useMemo(() => buildTree(data.entries), [data]);
  const allDirs = useMemo(() => { const out: string[] = []; const walk = (n: Node) => { for (const c of n.children) if (c.dir) { out.push(c.path); walk(c); } }; walk(root); return out; }, [root]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(root.children.length <= 8 ? root.children.filter((c) => c.dir).map((c) => c.path) : []));
  const rows = useMemo(() => {
    const out: { node: Node; depth: number }[] = [];
    const walk = (n: Node, depth: number) => { for (const c of n.children) { out.push({ node: c, depth }); if (c.dir && open.has(c.path)) walk(c, depth + 1); } };
    walk(root, 0);
    return out;
  }, [root, open]);
  const { ref, start, end, before, after } = useWindow(rows.length, ROW);
  const toggle = (path: string) => setOpen((s) => { const n = new Set(s); if (!n.delete(path)) n.add(path); return n; });
  return (
    <>
      <Tools>
        <IconButton icon="expandAll" label={t('preview.expandAll')} disabled={!allDirs.length} onClick={() => setOpen(new Set(allDirs))} data-testid="archive-expand" />
        <IconButton icon="collapseAll" label={t('preview.collapseAll')} disabled={!allDirs.length} onClick={() => setOpen(new Set())} />
      </Tools>
      <Note testId="archive-note">{t('preview.archiveNote')} <strong className="font-semibold text-ink" data-testid="archive-totals">{t('preview.archiveTotals', { n: data.totalEntries, size: fmtSize(data.totalBytes), format: data.format.toUpperCase() })}</strong></Note>
      {data.suspicious ? <Note tone="warn" testId="archive-suspicious">{t('preview.archiveSuspicious')}</Note> : null}
      {data.truncated ? <Note tone="warn" testId="archive-truncated">{t('preview.archiveTruncated', { shown: data.entries.length, n: data.totalEntries })}</Note> : null}
      <div ref={ref} className="min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0} role="tree" aria-label={t('preview.archiveContents')} data-testid="archive-tree">
        {rows.length === 0 ? <p className="p-6 text-center text-sm text-ink-3">{t('preview.archiveEmpty')}</p> : null}
        <div style={{ height: before }} />
        {rows.slice(start, end).map(({ node, depth }) => {
          const pad = { paddingLeft: 12 + depth * 18 };
          const cells = <>
            {node.dir ? <Glyph name={open.has(node.path) ? 'chevronDown' : 'chevronRight'} size={16} className="shrink-0 text-ink-3" /> : <span className="w-4 shrink-0" />}
            <Glyph name={node.dir ? 'folder' : 'file'} size={18} className={node.dir ? 'shrink-0 text-accent' : 'shrink-0 text-ink-3'} />
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={node.path}>{node.name}</span>
            {node.dir ? <span className="hidden shrink-0 text-xs text-ink-3 sm:block">{t('preview.archiveFiles', { n: node.files })}</span> : null}
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-3">{fmtSize(node.size)}</span>
          </>;
          return node.dir
            ? <button key={node.path} type="button" role="treeitem" aria-expanded={open.has(node.path)} onClick={() => toggle(node.path)} style={{ ...pad, height: ROW }} data-testid="archive-row" data-path={node.path}
                className="flex w-full items-center gap-2 border-b border-line pr-4 text-left hover:bg-hover">{cells}</button>
            : <div key={node.path} role="treeitem" style={{ ...pad, height: ROW }} data-testid="archive-row" data-path={node.path} className="flex items-center gap-2 border-b border-line pr-4">{cells}</div>;
        })}
        <div style={{ height: after }} />
      </div>
    </>
  );
}
export function ArchiveView({ source }: { source: PreviewSource }) {
  const [state, retry] = useDerived<ArchiveListing>(source.previewUrl('archive'), 'json');
  return <DerivedGate state={state} retry={retry} source={source}>{(data) => <Inventory data={data} />}</DerivedGate>;
}
