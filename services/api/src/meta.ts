/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/meta.ts
 * Module           : services
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

// Capability discovery: what this server really offers, so a 2.0 client hides what an older or smaller server lacks.
import type { FastifyInstance } from 'fastify';
import { aiEnabled } from './ai/providers.ts';
import { config } from './config.ts';
import { semanticBackend } from './textindex.ts';
import { textkitInfo } from './tools.ts';

export async function features(): Promise<string[]> {
  const [kit, sem] = await Promise.all([textkitInfo(), semanticBackend()]);
  return [
    'events', ...(config.indexContent ? ['content-search'] : []), ...(config.indexContent && config.ocr && kit ? ['ocr'] : []), ...(sem.available ? ['semantic'] : []),
    ...(aiEnabled() ? ['ai'] : []), 'collab', 'collections', 'activity', 'storage', ...(kit ? ['similar-images'] : []), 'upload-history',
  ];
}
export function metaRoutes(app: FastifyInstance): void {
  app.get('/api/v1/meta', async () => ({ api: 2, version: config.version, features: await features() }));
}

