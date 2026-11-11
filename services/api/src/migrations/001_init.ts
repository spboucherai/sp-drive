export const id = '001_init';

export const up = `
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null,
  role text not null check (role in ('admin', 'user')),
  locale text not null default 'fr',
  webauthn_handle bytea not null unique,
  totp_secret bytea,
  totp_enabled_at timestamptz,
  totp_last_step bigint,
  disabled_at timestamptz,
  created_at timestamptz not null default now());

create table quotas (
  user_id uuid primary key references users on delete cascade,
  limit_bytes bigint not null check (limit_bytes >= 0),
  updated_at timestamptz not null default now());

create table passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports jsonb not null default '[]',
  device_type text not null default '',
  backed_up boolean not null default false,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz);
create index passkeys_user on passkeys (user_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  token_hash text not null unique,
  prev_token_hash text,
  prev_valid_until timestamptz,
  rotated_at timestamptz not null default now(),
  method text not null check (method in ('passkey', 'recovery')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reauth_at timestamptz,
  ip text not null default '',
  user_agent text not null default '',
  revoked_at timestamptz);
create index sessions_user on sessions (user_id);
create index sessions_prev on sessions (prev_token_hash) where prev_token_hash is not null;

create table auth_challenges (
  id uuid primary key,
  kind text not null,
  challenge text not null,
  user_id uuid references users on delete cascade,
  data jsonb not null default '{}',
  expires_at timestamptz not null);

create table recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  code_hash text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now());
create index recovery_codes_user on recovery_codes (user_id);

create table invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email citext not null,
  role text not null check (role in ('admin', 'user')),
  quota_bytes bigint not null,
  created_by uuid references users on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now());

-- The tree. Every user has exactly one root folder (parent_id null). name_key = NFC lower-case name.
create table folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete restrict,
  parent_id uuid references folders on delete cascade,
  name text not null,
  name_key text not null,
  starred_at timestamptz,
  trashed_at timestamptz,
  trash_root uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((trashed_at is null) = (trash_root is null)));
create unique index folders_one_root on folders (owner_id) where parent_id is null;
create unique index folders_live_name on folders (parent_id, name_key) where trashed_at is null and parent_id is not null;
create index folders_parent on folders (parent_id);
create index folders_owner_trash on folders (owner_id, trash_root) where trashed_at is not null;
create index folders_name_trgm on folders using gin (name_key gin_trgm_ops);

create table storage_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete restrict,
  sha256 text not null,
  size bigint not null check (size >= 0),
  storage_key text not null unique,
  wrapped_key bytea not null,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'error')),
  scan_detail text,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, sha256, size));

create table files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete restrict,
  folder_id uuid not null references folders on delete cascade,
  name text not null,
  name_key text not null,
  current_version_id uuid,
  size bigint not null default 0,
  sha256 text not null default '',
  origin text not null default 'upload' check (origin in ('upload', 'request', 'copy')),
  starred_at timestamptz,
  trashed_at timestamptz,
  trash_root uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((trashed_at is null) = (trash_root is null)));
create unique index files_live_name on files (folder_id, name_key) where trashed_at is null;
create index files_owner_updated on files (owner_id, updated_at desc) where trashed_at is null;
create index files_owner_sha on files (owner_id, sha256) where trashed_at is null;
create index files_owner_trash on files (owner_id, trash_root) where trashed_at is not null;
create index files_name_trgm on files using gin (name_key gin_trgm_ops);

create table file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files on delete cascade,
  seq int not null,
  object_id uuid not null references storage_objects on delete restrict,
  size bigint not null,
  sha256 text not null,
  created_by uuid references users on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (file_id, seq));
create index file_versions_object on file_versions (object_id);
alter table files add constraint files_current_version foreign key (current_version_id) references file_versions deferrable initially deferred;

-- Derived previews of an object (thumbnail, PDF rendition, JSON inventory…), stored encrypted like objects.
create table previews (
  object_id uuid not null references storage_objects on delete cascade,
  kind text not null check (kind in ('thumb', 'image', 'pdf', 'sheet', 'archive')),
  status text not null check (status in ('pending', 'ready', 'failed', 'unsupported')),
  storage_key text,
  wrapped_key bytea,
  size bigint,
  error text,
  updated_at timestamptz not null default now(),
  primary key (object_id, kind));

create table tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  name text not null,
  name_key text not null,
  color text not null default 'slate',
  created_at timestamptz not null default now(),
  unique (owner_id, name_key));
create table file_tags (
  file_id uuid not null references files on delete cascade,
  tag_id uuid not null references tags on delete cascade,
  primary key (file_id, tag_id));
create index file_tags_tag on file_tags (tag_id);

create table shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  file_id uuid references files on delete cascade,
  folder_id uuid references folders on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  can_download boolean not null default true,
  password_hash text,
  expires_at timestamptz,
  max_views int check (max_views > 0),
  view_count int not null default 0,
  max_downloads int check (max_downloads > 0),
  download_count int not null default 0,
  single_use boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_access_at timestamptz,
  check ((file_id is null) <> (folder_id is null)));
create index shares_owner on shares (owner_id);

create table share_access_events (
  id bigserial primary key,
  share_id uuid not null references shares on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  ok boolean not null,
  ip text not null default '',
  user_agent text not null default '',
  file_id uuid,
  detail text not null default '');
create index share_access_events_share on share_access_events (share_id, at desc);

-- Deposit portals ("file requests").
create table upload_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  folder_id uuid not null references folders on delete cascade,
  token_hash text not null unique,
  title text not null,
  description text not null default '',
  instructions text not null default '',
  confirmation_message text not null default '',
  brand_name text not null default '',
  brand_color text not null default '#2563eb',
  password_hash text,
  expires_at timestamptz,
  active boolean not null default true,
  revoked_at timestamptz,
  max_file_bytes bigint not null check (max_file_bytes > 0),
  max_total_bytes bigint not null check (max_total_bytes > 0),
  max_files_per_submission int not null check (max_files_per_submission > 0),
  max_submissions int check (max_submissions > 0),
  submissions_per_hour int not null default 20 check (submissions_per_hour > 0),
  allowed_extensions text[] not null default '{}',
  fields jsonb not null,
  require_consent boolean not null default false,
  consent_text text not null default '',
  retention_note text not null default '',
  subfolder_per_submission boolean not null default true,
  notify_owner boolean not null default true,
  bytes_received bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index upload_requests_owner on upload_requests (owner_id);

create table upload_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references upload_requests on delete cascade,
  public_ref text not null unique,
  token_hash text not null unique,
  status text not null check (status in ('open', 'processing', 'completed', 'rejected', 'expired')),
  submitter_name text not null default '',
  submitter_email text not null default '',
  reference text not null default '',
  meta jsonb not null default '{}',
  consent_at timestamptz,
  declared_bytes bigint not null,
  ip text not null default '',
  user_agent text not null default '',
  folder_id uuid references folders on delete set null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  completed_at timestamptz);
create index upload_submissions_request on upload_submissions (request_id, created_at desc);

create table upload_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references upload_submissions on delete cascade,
  original_name text not null,
  safe_name text not null,
  declared_size bigint not null,
  size bigint,
  sha256 text,
  detected_mime text,
  status text not null check (status in ('uploading', 'quarantined', 'placed', 'rejected')),
  reject_code text,
  quarantine_path text,
  file_id uuid references files on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index upload_items_submission on upload_items (submission_id);

-- Resumable uploads (signed-in users and portal items).
create table uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  actor_user_id uuid references users on delete cascade,
  item_id uuid unique references upload_items on delete cascade,
  folder_id uuid references folders on delete cascade,
  name text not null,
  size bigint not null check (size >= 0),
  received bigint not null default 0,
  on_conflict text not null default 'rename' check (on_conflict in ('fail', 'rename', 'version')),
  status text not null default 'active' check (status in ('active', 'completing', 'done', 'aborted')),
  file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check ((actor_user_id is null) <> (item_id is null)));
create index uploads_owner_active on uploads (owner_id) where status in ('active', 'completing');

create table audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('user', 'anonymous', 'system')),
  actor_user_id uuid,
  owner_id uuid,
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  ip text not null default '',
  user_agent text not null default '',
  meta jsonb not null default '{}');
create index audit_events_owner on audit_events (owner_id, at desc);
create index audit_events_target on audit_events (target_type, target_id, at);

create table jobs (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz);
create index jobs_ready on jobs (run_at) where status = 'queued';
create unique index jobs_dedupe on jobs (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  kind text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now());
create index notifications_user on notifications (user_id, created_at desc);
`;

export const down = `
drop table if exists notifications, jobs, audit_events, uploads, upload_items, upload_submissions, upload_requests,
  share_access_events, shares, file_tags, tags, previews, file_versions, files, storage_objects, folders, invites,
  recovery_codes, auth_challenges, sessions, passkeys, quotas, users cascade;
`;
