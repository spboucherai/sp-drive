// Small illustrations for empty states and notices: drawn here (no image file, no network), in the gradient of the
// family. One scene, whose centre piece is the glyph of the subject.
import { useId } from 'react';
import { glyphPath } from './glyphs.tsx';

export function Art({ name, tone = 'accent', size = 132 }: { name: string; tone?: 'accent' | 'warn' | 'neutral'; size?: number }) {
  const id = useId().replace(/:/g, '');
  const [a, b] = tone === 'warn' ? ['#f59e0b', '#ef4444'] : tone === 'neutral' ? ['#8b8ba3', '#5d5d75'] : ['var(--grad-a)', 'var(--grad-b)'];
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" fill="none" aria-hidden="true" focusable="false" className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
        <radialGradient id={`${id}h`} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor={b} stopOpacity="0.28" /><stop offset="1" stopColor={b} stopOpacity="0" /></radialGradient>
        <filter id={`${id}s`} x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor={b} floodOpacity="0.38" /></filter>
      </defs>
      <circle cx="66" cy="66" r="66" fill={`url(#${id}h)`} />
      {/* two sheets fanned behind the tile */}
      <rect x="27" y="36" width="56" height="64" rx="14" transform="rotate(-14 55 68)" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
      <rect x="49" y="34" width="56" height="64" rx="14" transform="rotate(12 77 66)" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
      <g className="anim-float">
        <g filter={`url(#${id}s)`}><rect x="35" y="33" width="62" height="62" rx="19" fill={`url(#${id}g)`} /></g>
        <rect x="35.75" y="33.75" width="60.5" height="60.5" rx="18.25" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.5" />
        <g transform="translate(48 46) scale(1.5)" stroke="#fff" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d={glyphPath(name)} /></g>
      </g>
      {/* sparks */}
      <path d="M108 22l2.2 5.8L116 30l-5.800 2.200L108 38l-2.200-5.800L100 30l5.800-2.200z" fill={`url(#${id}g)`} />
      <circle cx="20" cy="40" r="4" fill={`url(#${id}g)`} opacity="0.75" />
      <circle cx="114" cy="96" r="3" fill={`url(#${id}g)`} opacity="0.55" />
      <circle cx="26" cy="104" r="2.500" fill={a} opacity="0.4" />
    </svg>
  );
}
