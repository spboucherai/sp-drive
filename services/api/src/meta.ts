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

