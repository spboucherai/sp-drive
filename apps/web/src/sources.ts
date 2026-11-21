/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/sources.ts
 * Module           : web
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

import { qs } from './api.ts';
import type { FileItem, PreviewSource } from './types.ts';

/** Preview source for a file of the signed-in owner (optionally one of its versions). */
export function ownerSource(f: Pick<FileItem, 'id' | 'name' | 'size' | 'kind' | 'scan'>, versionId?: string): PreviewSource {
  const base = `/api/v1/files/${f.id}`;
  return {
    id: versionId ? `${f.id}:${versionId}` : f.id, name: f.name, size: f.size, kind: f.kind, canDownload: true,
    contentUrl: (o = {}) => `${base}/content${qs({ v: versionId, download: o.download ? 1 : undefined, as: o.text ? 'text' : undefined, infected: o.download && f.scan === 'infected' ? 'ack' : undefined })}`,
    previewUrl: (kind) => `${base}/preview/${kind}${qs({ v: versionId })}`,
  };
}
