/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/Snippet.tsx
 * Module           : next
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
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
