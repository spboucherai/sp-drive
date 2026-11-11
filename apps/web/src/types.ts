// Shapes returned by the API (see services/api/src). Keep in step with the server serialisers.
import type { PreviewKind, RequestFields } from '@spd/shared';

export interface User { id: string; email: string; display_name: string; role: 'admin' | 'user'; locale: string }
export interface AuthState { authenticated: boolean; recovery?: boolean; user?: User; quota?: { limit: number; used: number }; freshAuth?: boolean }
export interface Folder { id: string; type: 'folder'; name: string; parentId: string | null; starred: boolean; createdAt: string; updatedAt: string; trashedAt: string | null }
export interface FileItem {
  id: string; type: 'file'; name: string; folderId: string; size: number; sha256: string; kind: PreviewKind; origin: 'upload' | 'request' | 'copy'; starred: boolean;
  createdAt: string; updatedAt: string; trashedAt: string | null; scan: 'pending' | 'clean' | 'infected' | 'error'; thumb: boolean; tagIds: string[]; versions: number;
}
export type Item = Folder | FileItem;
export interface Crumb { id: string; name: string }
export interface Listing { folder?: Folder; breadcrumbs?: Crumb[]; folders: Folder[]; files: FileItem[] }
export interface Version { id: string; seq: number; size: number; sha256: string; createdAt: string; note: string; current: boolean }
export interface FileDetail { file: FileItem; path: Crumb[]; shares: number; versions: Version[]; previews: Record<string, 'pending' | 'ready' | 'failed' | 'unsupported'> }
export interface Tag { id: string; name: string; color: string; files: number }
export interface UploadState { id: string; name: string; size: number; received: number; status: 'active' | 'completing' | 'done' | 'aborted'; fileId: string | null }
export interface Share {
  id: string; type: 'file' | 'folder'; targetId: string; targetName: string; label: string; canDownload: boolean; hasPassword: boolean; expiresAt: string | null;
  maxViews: number | null; viewCount: number; maxDownloads: number | null; downloadCount: number; singleUse: boolean; revokedAt: string | null; createdAt: string; lastAccessAt: string | null;
  status: 'active' | 'revoked' | 'expired' | 'exhausted' | 'target_missing';
}
export interface ShareEvent { id: string; at: string; kind: 'open' | 'password' | 'download'; ok: boolean; ip: string; userAgent: string; detail: string }
export interface Portal {
  id: string; folderId: string; folderName?: string; title: string; description: string; instructions: string; confirmationMessage: string; brandName: string; brandColor: string; hasPassword: boolean;
  expiresAt: string | null; active: boolean; revokedAt: string | null; maxFileBytes: number; maxTotalBytes: number; maxFilesPerSubmission: number; maxSubmissions: number | null; submissionsPerHour: number;
  allowedExtensions: string[]; fields: RequestFields; requireConsent: boolean; consentText: string; retentionNote: string; subfolderPerSubmission: boolean; notifyOwner: boolean;
  bytesReceived: number; submissions: number; createdAt: string; state: 'open' | 'paused' | 'revoked' | 'expired' | 'full' | 'target_missing';
}
export interface Submission { id: string; ref: string; status: 'open' | 'processing' | 'completed' | 'rejected' | 'expired'; name: string; email: string; reference: string; createdAt: string; completedAt: string | null; folderId: string | null; files: number; placed: number; rejected: number; bytes: number }
export interface SubmissionDetail extends Omit<Submission, 'files' | 'placed' | 'rejected' | 'bytes'> {
  requestId: string; meta: Record<string, string>; consentAt: string | null; ip: string; userAgent: string;
  items: { id: string; name: string; originalName: string; size: number; sha256: string | null; mime: string | null; status: 'uploading' | 'quarantined' | 'placed' | 'rejected'; rejectCode: string | null; fileId: string | null }[];
  events: { id: string; at: string; action: string; meta: Record<string, unknown> }[];
}
export interface Notification { id: string; kind: string; data: Record<string, any>; read: boolean; createdAt: string }
/** What the preview viewer needs to show one file, whoever serves it (owner API or a public share). */
export interface PreviewSource {
  id: string; name: string; size: number; kind: PreviewKind; canDownload: boolean;
  /** Original bytes. `text` asks for a text/plain answer; `download` for an attachment. */
  contentUrl(o?: { download?: boolean; text?: boolean }): string;
  /** Derived preview: 'thumb' | 'image' (HEIC as JPEG) | 'pdf' (office document as PDF) | 'sheet' | 'archive' (JSON). 202 = not ready yet, 422 = failed. */
  previewUrl(kind: 'thumb' | 'image' | 'pdf' | 'sheet' | 'archive'): string;
}
