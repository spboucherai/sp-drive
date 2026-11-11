// Development-only page that mounts the preview viewer on real files of the signed-in account, so that the viewer
// can be exercised (tests/e2e/preview.spec.ts) without the explorer. It is reached through /preview-harness.html on
// the Vite dev server only: the production build has a single entry (index.html) and never includes this module.
//   /preview-harness.html?ids=<fileId>,<fileId>…   viewer on the first file, previous/next through the list
//   &thumbs=1  a wall of thumbnails instead · &dark=1 dark theme · &lang=en · &nodownload=1 · &kind=<kind> forces the kind
import '../styles.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setLocale } from '../i18n.ts';
import { ownerSource } from '../sources.ts';
import type { FileDetail, FileItem, PreviewSource } from '../types.ts';
import { IconButton } from '../ui.tsx';
import { Thumb } from './Thumb.tsx';
import { Viewer } from './Viewer.tsx';

if (!import.meta.env.DEV && !import.meta.env.VITE_PREVIEW_HARNESS) throw new Error('the preview harness only exists in development');
const q = new URLSearchParams(location.search);
if (q.get('dark')) document.documentElement.classList.add('dark');
setLocale(q.get('lang') === 'en' ? 'en' : 'fr');

function Harness() {
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const [flag, setFlag] = useState(0);
  useEffect(() => {
    const ids = (q.get('ids') ?? '').split(',').filter(Boolean);
    void Promise.all(ids.map((id) => fetch(`/api/v1/files/${id}`, { credentials: 'same-origin' }).then((r) => r.json() as Promise<FileDetail>).then((d) => d.file))).then(setFiles);
  }, []);
  if (!files) return <p data-testid="harness-loading">…</p>;
  if (q.get('thumbs')) {
    return (
      <div className="flex flex-wrap items-end gap-4 bg-bg p-6" data-testid="thumb-wall">
        {[32, 48, 96, 200].map((size) => (
          <div key={size} className="flex flex-wrap items-end gap-3">
            {files.map((f) => <span key={f.id} style={{ width: size, height: size }} className="inline-flex"><Thumb src={f.thumb || q.get('allthumbs') ? ownerSource(f).previewUrl('thumb') : undefined} name={f.name} kind={f.kind} className="h-full w-full" /></span>)}
            <span style={{ width: size, height: size }} className="inline-flex"><Thumb name="Dossier" kind="folder" className="h-full w-full" /></span>
          </div>
        ))}
      </div>
    );
  }
  const f = files[index];
  if (!f) return <p>no file</p>;
  let source: PreviewSource = ownerSource(f);
  if (q.get('nodownload')) source = { ...source, canDownload: false };
  if (q.get('kind')) source = { ...source, kind: q.get('kind') as PreviewSource['kind'] };
  return (
    <div className="p-6">
      <button type="button" data-testid="harness-open" onClick={() => setOpen(true)}>open</button>
      <p data-testid="harness-state">{open ? 'open' : 'closed'} {index} flag={flag}</p>
      <div style={{ height: 3000 }} />
      {open ? (
        <Viewer source={source} onClose={() => setOpen(false)}
          onPrev={files.length > 1 && index > 0 ? () => setIndex(index - 1) : undefined} onNext={files.length > 1 && index < files.length - 1 ? () => setIndex(index + 1) : undefined}
          actions={q.get('actions') ? <IconButton icon="star" label="action" data-testid="harness-action" onClick={() => setFlag((n) => n + 1)} /> : undefined} />
      ) : null}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
