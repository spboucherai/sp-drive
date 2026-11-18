// Native clients (macOS, iOS): device sessions, device linking, a change feed and optimistic concurrency on content.
// Everything is additive: the web application keeps working unchanged.
export const id = '002_native_clients';

export const up = `
-- A device session is opened by a native client. Its token is sent as "Authorization: Bearer", is never rotated
-- (several processes of one device share it) and its lifetime slides while the device keeps syncing.
alter table sessions add column kind text not null default 'web' check (kind in ('web', 'device'));
alter table sessions add column device_name text not null default '';

-- Linking a device without a passkey on it: the device shows a short code, a signed-in browser approves it.
create table device_links (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null unique,
  user_code text not null unique,
  device_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'consumed')),
  user_id uuid references users on delete cascade,
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null);

-- Change feed. Every write to a folder or a file takes the owner's tree lock and then draws the next revision, so
-- for one owner revisions are committed in increasing order: "rev > cursor" never misses a change.
create sequence sync_rev_seq;
alter table folders add column rev bigint not null default 0;
alter table files add column rev bigint not null default 0;
update folders set rev = nextval('sync_rev_seq');
update files set rev = nextval('sync_rev_seq');
create index folders_owner_rev on folders (owner_id, rev);
create index files_owner_rev on files (owner_id, rev);

-- Items deleted for good (purged from the trash). Trashed items are not here: they stay rows with trashed_at set.
create table sync_tombstones (
  owner_id uuid not null,
  item_id uuid not null,
  kind text not null check (kind in ('file', 'folder')),
  rev bigint not null,
  deleted_at timestamptz not null default now(),
  primary key (owner_id, item_id));
create index sync_tombstones_owner_rev on sync_tombstones (owner_id, rev);

create function spd_bump_rev() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('spd-tree:' || new.owner_id::text, 0));
  new.rev := nextval('sync_rev_seq');
  return new;
end $$;
create function spd_tombstone() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('spd-tree:' || old.owner_id::text, 0));
  insert into sync_tombstones (owner_id, item_id, kind, rev) values (old.owner_id, old.id, tg_argv[0], nextval('sync_rev_seq'))
    on conflict (owner_id, item_id) do update set rev = excluded.rev, deleted_at = now();
  return old;
end $$;
create trigger folders_rev before insert or update on folders for each row execute function spd_bump_rev();
create trigger files_rev before insert or update on files for each row execute function spd_bump_rev();
create trigger folders_tombstone after delete on folders for each row execute function spd_tombstone('folder');
create trigger files_tombstone after delete on files for each row execute function spd_tombstone('file');

-- A new version sent by a syncing client names the version it was derived from; a different current version is a conflict.
alter table uploads add column base_version_id uuid;
`;

export const down = `
alter table uploads drop column if exists base_version_id;
drop trigger if exists files_tombstone on files;
drop trigger if exists folders_tombstone on folders;
drop trigger if exists files_rev on files;
drop trigger if exists folders_rev on folders;
drop function if exists spd_tombstone();
drop function if exists spd_bump_rev();
drop table if exists sync_tombstones;
drop index if exists files_owner_rev;
drop index if exists folders_owner_rev;
alter table files drop column if exists rev;
alter table folders drop column if exists rev;
drop sequence if exists sync_rev_seq;
drop table if exists device_links;
alter table sessions drop column if exists device_name;
alter table sessions drop column if exists kind;
`;
