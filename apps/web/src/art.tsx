/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/art.tsx
 * Module           : web
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
