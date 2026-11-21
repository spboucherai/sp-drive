/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/preview/MediaView.tsx
 * Module           : preview
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
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

// Video and audio with the browser's own player; the API answers Range requests, so seeking works on large files.
import { useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { DownloadLink, explain, Failure, Panel } from './shared.tsx';

export function MediaView({ source }: { source: PreviewSource }) {
  const t = useT();
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const src = source.contentUrl();
  const onError = () => { void explain(src).then((error) => setFailed({ error })); };
  if (failed) {
    return failed.error
      ? <Failure error={failed.error} source={source} onRetry={() => { setFailed(null); setAttempt((n) => n + 1); }} />
      : <Panel icon={source.kind} tone="warn" title={t('preview.mediaUnsupported')} text={t('preview.mediaUnsupportedText')} testId="preview-error"><DownloadLink source={source} primary /></Panel>;
  }
  if (source.kind === 'video') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-0 sm:p-6">
        <video key={attempt} src={src} controls playsInline preload="metadata" onError={onError} data-testid="video" className="max-h-full max-w-full rounded-none bg-black sm:rounded-2xl" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="flex w-full max-w-lg flex-col items-center gap-5 rounded-2xl border border-line bg-surface p-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Glyph name="audio" size={40} /></div>
        <p className="max-w-full truncate text-sm font-medium text-ink">{source.name}</p>
        <audio key={attempt} src={src} controls preload="metadata" onError={onError} data-testid="audio" className="w-full" />
      </div>
    </div>
  );
}
