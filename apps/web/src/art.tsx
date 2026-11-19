// The illustration of empty states and notices: the subject's symbol in a quiet halo (design system: SPDEmptyState).
// Drawn here — no image file, no network — in the one accent colour; nothing moves.
import { glyphPath } from './glyphs.tsx';

export function Art({ name, tone = 'accent', size = 132 }: { name: string; tone?: 'accent' | 'warn' | 'neutral'; size?: number }) {
  const c = tone === 'warn' ? 'var(--spd-color-warning)' : tone === 'neutral' ? 'var(--spd-color-text-tertiary)' : 'var(--spd-color-brand)';
  const s = Math.round(size * 0.62);
  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="40" cy="40" r="40" fill={c} opacity="0.07" />
      <circle cx="40" cy="40" r="28" fill={c} opacity="0.1" />
      <g transform="translate(24 24) scale(1.3333)" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={glyphPath(name)} /></g>
    </svg>
  );
}
