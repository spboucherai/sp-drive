import type { ReactNode } from 'react';
import type { PreviewSource } from '../types.ts';

/** STUB — full-screen preview of one file. `actions` are extra buttons for the toolbar (share, details…). */
export function Viewer(_p: { source: PreviewSource; onClose: () => void; onPrev?: () => void; onNext?: () => void; actions?: ReactNode }) { return null; }
