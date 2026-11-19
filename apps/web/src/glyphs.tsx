// Inline icons (24×24, stroke = currentColor). One component, a `name` prop: no icon font, no network.
import type { SVGProps } from 'react';

const P: Record<string, string> = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5a1 1 0 1 0 0-.01',
  video: 'M4 6h11v12H4zM15 10l5-3v10l-5-3',
  audio: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  archive: 'M4 4h16v4H4zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  sheet: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  text: 'M6 4h12v16H6zM9 9h6M9 13h6M9 17h3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12.5l4.5 4.5L19 7.5', search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z', clock: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4.5l3 2',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6', share: 'M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM22 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM22 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM7.6 10.6l8.8-3.4M7.6 13.4l8.8 3.4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  inbox: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5a3 3 0 0 0 6 0h5', settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', dots: 'M5 12h.01M12 12h.01M19 12h.01',
  chevronRight: 'M9 6l6 6-6 6', chevronLeft: 'M15 6l-6 6 6 6', chevronDown: 'M6 9l6 6 6-6', arrowUp: 'M12 19V5M6 11l6-6 6 6', arrowDown: 'M12 5v14M6 13l6 6 6-6',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', key: 'M14.5 9.5a4 4 0 1 0-3.9 3.9L4 20v0h3v-2h2v-2h2l1.6-1.6', shield: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  pencil: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19zM14.5 6.5l3 3', move: 'M5 9l-3 3 3 3M19 9l3 3-3 3M9 5l3-3 3 3M9 19l3 3 3-3M2 12h20M12 2v20', copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01', history: 'M4 12a8 8 0 1 0 2.6-5.9L4 8M4 4v4h4M12 8v4.5l3 2', info: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 11v5M12 8h.01', warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z', menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10', zoomIn: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4M11 8v6M8 11h6', zoomOut: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4M8 11h6',
  pause: 'M8 5v14M16 5v14', play: 'M7 4l13 8-13 8z', refresh: 'M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4', restore: 'M4 12a8 8 0 1 0 2.6-5.9L4 8M4 4v4h4', duplicate: 'M8 8h12v12H8zM4 16V4h12',
  device: 'M7 3h10v18H7zM11 18h2', external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  print: 'M7 8V4h10v4M7 17H4V9a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v8h-3M7 14h10v6H7z', globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.400-3.5 9c-2.500-2.600-3.500-5.600-3.500-9s1-6.400 3.500-9z',
  activity: 'M3 12h4l3-8 4 16 3-8h4', laptop: 'M5 5h14v10H5zM2 19h20', server: 'M4 4h16v7H4zM4 13h16v7H4zM8 7.500h.01M8 16.500h.01',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5', sort: 'M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3', blank: 'M0 0',
  fitWidth: 'M4 5v14M20 5v14M8 12h8M10.5 9.5L8 12l2.5 2.5M13.5 9.5L16 12l-2.5 2.5', fitPage: 'M6 3h12v18H6zM12 7.5v9M9.8 9.7L12 7.5l2.2 2.2M9.8 14.3L12 16.5l2.2-2.2', wrap: 'M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5',
  expandAll: 'M7 9l5-5 5 5M7 15l5 5 5-5', collapseAll: 'M7 4l5 5 5-5M7 20l5-5 5 5',
  pdf: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8.5 17.5c2-1.5 3.5-4.5 3.5-7 0 3 2 5.5 4 6-2.5 0-5.5.3-7.5 1z', doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8.5 12.5h7M8.5 15.5h7M8.5 18.500h4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', canvas: 'M3 5h7v6H3zM14 4h7v4h-7zM13 12h8v8h-8zM4 15h5v5H4z', bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  panel: 'M4 5h16v14H4zM14 5v14', arrowRight: 'M5 12h14M13 6l6 6-6 6', swap: 'M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3', compare: 'M12 3v18M4 6h5v12H4zM15 6h5v12h-5z',
  collection: 'M5 4h14v4H5zM3 10h18v4H3zM5 16h14v4H5z', wand: 'M5 19L16 8M14 6l1-3 1 3 3 1-3 1-1 3-1-3-3-1zM6 6l.6 1.900L8.500 8.500l-1.900.6L6 11l-.6-1.900L3.500 8.500l1.900-.6z', send: 'M4 12l16-8-6 16-3-7z',
  stop: 'M7 7h10v10H7z', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5', hash: 'M9 4L7 20M17 4l-2 16M4 9h17M3 15h17', mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  cloud: 'M7 18a4 4 0 0 1-.6-7.960A5.500 5.500 0 0 1 17 9a4.500 4.500 0 0 1 .5 9z', database: 'M5 6c0-1.700 3.100-3 7-3s7 1.300 7 3-3.100 3-7 3-7-1.300-7-3zM5 6v12c0 1.700 3.100 3 7 3s7-1.300 7-3V6M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2', tablet: 'M5 3h14v18H5zM11 18h2', quote: 'M6 17c2-1 3-3 3-6V7H5v5h3M15 17c2-1 3-3 3-6V7h-4v5h3',
  sparkle: 'M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900zM19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8z',
};
export type GlyphName = keyof typeof P;
export const glyphPath = (name: string): string => P[name] ?? P.file!;
export function Glyph({ name, size = 20, ...rest }: { name: string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={P[name] ?? P.file} />
    </svg>
  );
}
