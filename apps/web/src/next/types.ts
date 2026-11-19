// Shapes of the 2.0 API (docs/next/API-NEXT.md). Additive: everything here is optional for a 1.0 server.
import type { FileItem, Folder } from '../types.ts';

export type Feature = 'events' | 'content-search' | 'ocr' | 'semantic' | 'ai' | 'collab' | 'collections' | 'activity' | 'storage' | 'similar-images' | 'upload-history';
export interface Meta { api: number; version: string; features: Feature[] }

export interface Match { where: 'name' | 'content' | 'both'; snippet?: string; page?: number | null }
export type FoundFile = FileItem & { match?: Match };
export interface SemanticHit { file: FileItem; score: number; passage: { text: string; page: number | null } }
export interface TextStatus { status: 'pending' | 'ready' | 'empty' | 'unsupported' | 'failed'; source: string | null; pages: number; chars: number; excerpt: string; error: string | null }

export interface AiModel { id: string; label: string; creator: string }
export interface AiProvider { id: 'maclustr' | 'anthropic' | 'openai' | 'openrouter' | string; label: string; local: boolean; configured: boolean; usable: boolean; models: AiModel[] }
export interface AiProviders { enabled: boolean; externalAllowed: boolean; external: { server: boolean; account: boolean }; default: { provider: string; model: string } | null; providers: AiProvider[] }
export interface AiSource { n: number; fileId: string; name: string; page: number | null; text: string }
export interface AiSuggestion { fileId: string; name?: string; tags?: string[]; folder?: { id: string; path: string }; category?: string; reason: string }

export type Role = 'viewer' | 'editor' | 'uploader';
export interface Member { grantId: string; userId: string; displayName: string; email: string; role: Role; createdAt: string }
export interface SharedWithMe { grantId: string; role: Role; owner: { displayName: string }; folder: { id: string; name: string; workspaceName: string | null; updatedAt: string }; createdAt: string }
export type SharedFolder = Folder & { isGrantRoot: boolean; workspaceName?: string | null };
export interface SharedListing { grantId: string; role: Role; folder: SharedFolder; breadcrumbs: { id: string; name: string }[]; folders: SharedFolder[]; files: FileItem[] }

export type Field = 'kind' | 'ext' | 'name' | 'tag' | 'untagged' | 'size' | 'modified' | 'created' | 'starred' | 'shared' | 'folder' | 'text';
export type Op = 'is' | 'isNot' | 'contains' | 'gt' | 'lt' | 'within';
export interface Condition { field: Field; op: Op; value: string | number | boolean }
export interface Rule { match: 'all' | 'any'; conditions: Condition[]; sort?: { by: 'name' | 'updated' | 'size' | 'created'; dir: 'asc' | 'desc' } }
export interface Collection { id: string; name: string; icon: string; color: string; rule: Rule; createdAt: string; updatedAt: string; count?: number }

export interface ActivityEvent {
  id: string; at: string; action: string;
  actor: { kind: 'user' | 'anonymous' | 'system'; userId?: string; displayName: string | null; me?: boolean };
  target: { type: string; id: string; name?: string | null } | null; meta: Record<string, any>;
}
export interface ActivityPage { events: ActivityEvent[]; more: boolean }

export interface StorageOverview {
  quota: { limit: number; used: number; uploading: number }; liveBytes: number; trashBytes: number; oldVersionBytes: number;
  counts: { files: number; folders: number; versions: number; trashedFiles: number };
  byKind: { kind: string; files: number; bytes: number }[];
  byFolder: { folder: Folder; files: number; bytes: number; direct?: boolean }[];
  largest: FileItem[]; growth: { date: string; bytes: number; versions: number }[];
  duplicates: { groups: number; duplicateBytes: number; reclaimableBytes: number };
}
export interface StorageFolder { folder: Folder; breadcrumbs: { id: string; name: string }[]; total: { files: number; bytes: number }; direct: { files: number; bytes: number }; children: { folder: Folder; files: number; bytes: number }[]; files: FileItem[] }
export interface ExactGroup { sha256: string; size: number; distinctNames?: boolean; files: FileItem[] }
export interface SimilarGroup { maxDistance: number; files: (FileItem & { dhash: string })[] }

export interface VersionInfo { id: string; seq: number; size: number; sha256: string; createdAt: string; note: string; current: boolean; scan: string; createdBy: { userId: string; displayName: string; me: boolean } | null }
export interface VersionList { fileId: string; currentVersionId: string; versions: VersionInfo[] }
export interface UploadRecord { id: string; name: string; size: number; received: number; status: 'active' | 'completing' | 'done' | 'aborted'; fileId: string | null; fileExists: boolean; folderId: string | null; grantId: string | null; createdAt: string; updatedAt: string }
export interface SessionInfo { id: string; createdAt: string; lastSeenAt: string; ip: string; userAgent: string; method: string; kind: 'web' | 'device'; deviceName?: string | null; current: boolean; client: { platform: string; version: string; os: string | null } | null }
