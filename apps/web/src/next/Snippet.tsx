// A search snippet from the server: plain text in which matched words are wrapped in ⟦ ⟧ (U+27E6 / U+27E7). The
// markers become <mark> elements; the text itself is never interpreted as HTML.
import { cx } from '../ui.tsx';

export function Snippet({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(⟦[^⟦⟧]*⟧)/g);
  return (
    <span className={cx('break-words', className)} data-testid="snippet">
      {parts.map((p, i) => (p.startsWith('⟦') && p.endsWith('⟧')
        ? <mark key={i} className="rounded-[3px] bg-accent-soft px-0.5 font-medium text-ink">{p.slice(1, -1)}</mark>
        : <span key={i}>{p.replace(/[⟦⟧]/g, '')}</span>))}
    </span>
  );
}
