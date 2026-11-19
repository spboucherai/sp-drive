// SP Drive 2.0 ("Next Generation"). Everything is additive: a 1.0 client keeps working against this schema, and
// `down` removes exactly what `up` adds (the 1.0 code runs again on the result).
export const id = '003_next';

export const up = `
-- Native clients announce themselves (X-SPD-Client: macos/2.0.0 (27.0)); shown in the devices dashboard.
alter table sessions add column client_platform text not null default '';
alter table sessions add column client_version text not null default '';
alter table sessions add column client_os text not null default '';

-- The account's own switch for external AI providers (the server switch SPD_AI_EXTERNAL must be on as well).
alter table users add column ai_external boolean not null default false;

-- Sync events: a hint to listening API processes that an owner's head revision moved. Identical notifications of
-- one transaction are folded by PostgreSQL, so a bulk change costs one message.
create function spd_notify_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then perform pg_notify('spd_change', old.owner_id::text);
  else perform pg_notify('spd_change', new.owner_id::text); end if;
  return null;
end $$;
create trigger folders_notify after insert or update or delete on folders for each row execute function spd_notify_change();
create trigger files_notify after insert or update or delete on files for each row execute function spd_notify_change();
create function spd_notify_notification() returns trigger language plpgsql as $$
begin
  perform pg_notify('spd_notify', new.user_id::text || ':' || left(new.kind, 60));
  return null;
end $$;
create trigger notifications_notify after insert on notifications for each row execute function spd_notify_notification();

-- Content index. Passages are plaintext in PostgreSQL: a documented trade-off, switched off by SPD_INDEX_CONTENT=off.
create text search configuration spd_fr (copy = french);
alter text search configuration spd_fr alter mapping for hword, hword_part, word with unaccent, french_stem;
create text search configuration spd_en (copy = english);
alter text search configuration spd_en alter mapping for hword, hword_part, word with unaccent, english_stem;
create text search configuration spd_plain (copy = simple);
alter text search configuration spd_plain alter mapping for hword, hword_part, word with unaccent, simple;

create table object_text (
  object_id uuid primary key references storage_objects on delete cascade,
  status text not null check (status in ('pending', 'ready', 'empty', 'unsupported', 'failed')),
  source text not null default '',
  lang text not null default '',
  pages int not null default 0,
  chars int not null default 0,
  error text,
  updated_at timestamptz not null default now());
create table object_passages (
  object_id uuid not null references storage_objects on delete cascade,
  seq int not null,
  page int,
  text text not null,
  tsv tsvector not null,
  embedding real[],
  primary key (object_id, seq));
create index object_passages_tsv on object_passages using gin (tsv);

-- Perceptual hash of images (64-bit difference hash, hexadecimal), computed by the worker.
create table object_phash (
  object_id uuid primary key references storage_objects on delete cascade,
  dhash text not null check (dhash ~ '^[0-9a-f]{16}$'),
  created_at timestamptz not null default now());

-- Private sharing: a folder granted to another account. A workspace is a granted folder with a name.
alter table folders add column workspace_name text;
create table folder_grants (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references folders on delete cascade,
  owner_id uuid not null references users on delete cascade,
  grantee_id uuid not null references users on delete cascade,
  role text not null check (role in ('viewer', 'editor', 'uploader')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (owner_id <> grantee_id));
create unique index folder_grants_live on folder_grants (folder_id, grantee_id) where revoked_at is null;
create index folder_grants_grantee on folder_grants (grantee_id) where revoked_at is null;
create index folder_grants_owner on folder_grants (owner_id);
-- An upload made through a grant: its bytes belong to (and are charged to) the folder's owner.
alter table uploads add column grant_id uuid references folder_grants on delete cascade;

-- Smart collections: a saved rule, compiled to parameterised SQL from a whitelist. Never copies bytes.
create table collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  name text not null,
  name_key text not null,
  icon text not null default '',
  color text not null default 'slate',
  rule jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name_key));

-- Small facts the processes publish for the administration view (worker heartbeat, converter probe…).
create table system_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now());

create index audit_events_owner_target on audit_events (owner_id, target_type, target_id, at desc);
`;

export const down = `
drop index if exists audit_events_owner_target;
drop table if exists system_state;
drop table if exists collections;
alter table uploads drop column if exists grant_id;
drop table if exists folder_grants;
alter table folders drop column if exists workspace_name;
drop table if exists object_phash;
drop table if exists object_passages;
drop table if exists object_text;
drop text search configuration if exists spd_plain;
drop text search configuration if exists spd_en;
drop text search configuration if exists spd_fr;
drop trigger if exists notifications_notify on notifications;
drop function if exists spd_notify_notification();
drop trigger if exists files_notify on files;
drop trigger if exists folders_notify on folders;
drop function if exists spd_notify_change();
alter table users drop column if exists ai_external;
alter table sessions drop column if exists client_os;
alter table sessions drop column if exists client_version;
alter table sessions drop column if exists client_platform;
`;
