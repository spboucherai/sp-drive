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
