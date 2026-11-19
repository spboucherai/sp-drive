// Marks of the AI routes and of the model makers. Simple original monochrome drawings (currentColor) — not the
// companies' trademarks — so the selector can tell at a glance *which API route* carries the request, and, in words
// next to it, *who made the model* (the two differ on a router, or on the local MacLustr endpoint).
import type { SVGProps } from 'react';

const DRAW: Record<string, React.ReactNode> = {
  // MacLustr: a small cluster — three machines on one bus
  maclustr: <><rect x="3.5" y="4" width="5" height="6.5" rx="1.2" /><rect x="9.5" y="4" width="5" height="6.5" rx="1.2" /><rect x="15.500" y="4" width="5" height="6.5" rx="1.2" /><path d="M6 10.500v3.500M12 10.500v3.500M18 10.500v3.500M4 14h16M12 14v3.500M8.500 20h7" /></>,
  // Anthropic: a wide, sober capital A
  anthropic: <path d="M5 19.500L11 4.500h2l6 15M8.200 14.500h7.600" />,
  // OpenAI: a six-petal knot
  openai: <><path d="M12 3.500l7.360 4.250v8.500L12 20.500l-7.360-4.250v-8.500z" /><path d="M12 3.500v8.500l7.360 4.250M12 12l-7.360 4.250" /></>,
  // OpenRouter: one way in, two ways out
  openrouter: <><path d="M3 12h6c3 0 3-5 6-5h5M9 12c3 0 3 5 6 5h5" /><path d="M17.500 4.500L20 7l-2.500 2.500M17.500 14.500L20 17l-2.500 2.500" /></>,
};
export function RouteMark({ id, size = 18, ...rest }: { id: string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-route={id} {...rest}>
      {DRAW[id] ?? <circle cx="12" cy="12" r="7.500" />}
    </svg>
  );
}
