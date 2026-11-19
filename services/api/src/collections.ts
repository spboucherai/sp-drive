// Smart collections: a saved rule over the owner's live files. A rule is data, never SQL: every condition is checked
// against a whitelist of fields and operators and compiled to a parameterised fragment (values only ever travel as
// bind parameters). A collection references files; it never copies bytes.
import { nameKey, sanitizeName } from '@spd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, userOf } from './auth.ts';
import { config, notFound, UserError } from './config.ts';
import { type Db, sql } from './db.ts';
import { tsQuery } from './textindex.ts';
import { type FileRow, fileJoin, fileJson, fileSelect } from './tree.ts';

const Id = z.uuid();
export const KIND_EXT: Record<string, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'svg', 'tif', 'tiff', 'bmp'], pdf: ['pdf'], document: ['doc', 'docx', 'odt', 'ppt', 'pptx', 'odp', 'rtf', 'pages', 'key'], sheet: ['xlsx', 'xls', 'ods', 'csv', 'numbers'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'], audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'], archive: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'], text: ['txt', 'md', 'json', 'xml', 'log', 'yaml', 'yml', 'tex'],
};
const Kind = z.enum(['image', 'pdf', 'document', 'sheet', 'video', 'audio', 'archive', 'text']);
const DateStr = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
/** One condition per allowed (field, operator) pair; anything else fails validation with 400. */
const Condition = z.discriminatedUnion('field', [
  z.object({ field: z.literal('kind'), op: z.enum(['is', 'isNot']), value: Kind }),
  z.object({ field: z.literal('ext'), op: z.enum(['is', 'isNot']), value: z.string().regex(/^[A-Za-z0-9]{1,10}$/) }),
  z.object({ field: z.literal('name'), op: z.enum(['contains', 'is', 'isNot']), value: z.string().min(1).max(200) }),
  z.object({ field: z.literal('tag'), op: z.enum(['is', 'isNot']), value: Id }),
  z.object({ field: z.literal('untagged'), op: z.literal('is'), value: z.boolean() }),
  z.object({ field: z.literal('size'), op: z.enum(['gt', 'lt']), value: z.number().int().min(0).max(1e15) }),
  // gt / lt take a date, within takes a number of days
  ...(['modified', 'created'] as const).map((f) => z.object({ field: z.literal(f), op: z.enum(['gt', 'lt', 'within']), value: z.union([DateStr, z.number().int().min(1).max(36500)]) })
    .refine((c) => (c.op === 'within') === (typeof c.value === 'number'), 'gt and lt take a date, within takes a number of days')),
  z.object({ field: z.literal('starred'), op: z.literal('is'), value: z.boolean() }),
  z.object({ field: z.literal('shared'), op: z.literal('is'), value: z.boolean() }),
  z.object({ field: z.literal('folder'), op: z.enum(['is', 'isNot']), value: Id }),
  z.object({ field: z.literal('text'), op: z.literal('contains'), value: z.string().trim().min(1).max(200) }),
]);
export const Rule = z.object({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(Condition).min(1).max(20),
  sort: z.object({ by: z.enum(['name', 'updated', 'size', 'created']), dir: z.enum(['asc', 'desc']).default('asc') }).optional(),
}).strict();
export type RuleT = z.infer<typeof Rule>;
type Cond = z.infer<typeof Condition>;

const EXT_SQL = (t: Db) => t`lower(substring(f.name from '\\.([^.]+)$'))`;
/** One condition → a boolean SQL fragment over the alias f (files), scoped to `ownerId`. */
function compileOne(t: Db, ownerId: string, c: Cond) {
  const not = (frag: ReturnType<Db>, negate: boolean) => (negate ? t`not coalesce(${frag}, false)` : frag);
  switch (c.field) {
    case 'kind': return not(t`${EXT_SQL(t)} = any(${KIND_EXT[c.value]!})`, c.op === 'isNot');
    case 'ext': return not(t`${EXT_SQL(t)} = ${c.value.toLowerCase()}`, c.op === 'isNot');
    case 'name': {
      if (c.op === 'contains') return t`unaccent(f.name_key) like unaccent(${`%${nameKey(c.value).replace(/[\\%_]/g, (x) => `\\${x}`)}%`})`;
      return not(t`f.name_key = ${nameKey(c.value)}`, c.op === 'isNot');
    }
    case 'tag': return not(t`exists (select 1 from file_tags ft join tags tg on tg.id = ft.tag_id where ft.file_id = f.id and tg.id = ${c.value} and tg.owner_id = ${ownerId})`, c.op === 'isNot');
    case 'untagged': return not(t`not exists (select 1 from file_tags ft where ft.file_id = f.id)`, !c.value);
    case 'size': return c.op === 'gt' ? t`f.size > ${c.value}` : t`f.size < ${c.value}`;
    case 'modified': case 'created': {
      const col = c.field === 'modified' ? t`f.updated_at` : t`f.created_at`;
      if (c.op === 'within') return t`${col} >= now() - make_interval(days => ${c.value as number})`;
      return c.op === 'gt' ? t`${col} > ${c.value as string}::timestamptz` : t`${col} < ${c.value as string}::timestamptz`;
    }
    case 'starred': return not(t`f.starred_at is not null`, !c.value);
    case 'shared': return not(t`(exists (select 1 from shares s where s.file_id = f.id and s.owner_id = ${ownerId} and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))
      or exists (with recursive up as (select id, parent_id from folders where id = f.folder_id union all select p.id, p.parent_id from folders p join up on p.id = up.parent_id)
        select 1 from up where exists (select 1 from folder_grants g where g.folder_id = up.id and g.owner_id = ${ownerId} and g.revoked_at is null)
          or exists (select 1 from shares s where s.folder_id = up.id and s.owner_id = ${ownerId} and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))))`, !c.value);
    case 'folder': return not(t`f.folder_id in (with recursive sub as (select id, 0 as depth from folders where id = ${c.value} and owner_id = ${ownerId} and trashed_at is null
      union all select d.id, sub.depth + 1 from folders d join sub on d.parent_id = sub.id where d.trashed_at is null and sub.depth < 100) select id from sub)`, c.op === 'isNot');
    case 'text': return config.indexContent ? t`exists (select 1 from object_passages p where p.object_id = v.object_id and p.tsv @@ ${tsQuery(t, c.value)})` : t`false`;
  }
}
const SORT = { name: 'name_key', updated: 'updated_at', size: 'size', created: 'created_at' } as const;
/** The files a rule selects: always the caller's own live files, whatever the rule says. */
export async function runRule(ownerId: string, rule: RuleT, o: { limit: number; offset: number }): Promise<{ files: FileRow[]; total: number }> {
  const parts = rule.conditions.map((c) => compileOne(sql, ownerId, c));
  const where = parts.slice(1).reduce((acc, p) => (rule.match === 'all' ? sql`${acc} and (${p})` : sql`${acc} or (${p})`), sql`(${parts[0]!})`);
  const by = SORT[rule.sort?.by ?? 'name'], dir = rule.sort?.dir === 'desc' ? sql`desc` : sql`asc`;
  const base = sql`from files f ${fileJoin(sql)} where f.owner_id = ${ownerId} and f.trashed_at is null and (${where})`;
  const [files, count] = await Promise.all([
    sql<FileRow[]>`select ${fileSelect(sql)} ${base} order by f.${sql(by)} ${dir}, f.id limit ${o.limit} offset ${o.offset}`,
    sql<{ n: number }[]>`select count(*)::int as n ${base}`,
  ]);
  return { files, total: count[0]!.n };
}

interface Row { id: string; name: string; icon: string; color: string; rule: RuleT; created_at: Date; updated_at: Date }
const json = (c: Row, count?: number) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, rule: c.rule, createdAt: c.created_at, updatedAt: c.updated_at, ...(count === undefined ? {} : { count }) });
const Body = z.object({ name: z.string().trim().min(1).max(80), icon: z.string().max(40).regex(/^[A-Za-z0-9._-]*$/).default(''),
  color: z.enum(['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']).default('slate'), rule: Rule });
/** Identifiers a rule mentions must be the caller's own: a foreign tag or folder is refused, not silently empty. */
async function checkRefs(ownerId: string, rule: RuleT): Promise<void> {
  const tags = rule.conditions.filter((c) => c.field === 'tag').map((c) => c.value as string), folders = rule.conditions.filter((c) => c.field === 'folder').map((c) => c.value as string);
  if (tags.length && (await sql`select 1 from tags where owner_id = ${ownerId} and id = any(${tags})`).length !== new Set(tags).size) throw notFound('tag not found');
  if (folders.length && (await sql`select 1 from folders where owner_id = ${ownerId} and id = any(${folders})`).length !== new Set(folders).size) throw notFound('folder not found');
}

export function collectionRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };
  const mine = async (ownerId: string, id: string) => { const [c] = await sql<Row[]>`select * from collections where id = ${id} and owner_id = ${ownerId}`; if (!c) throw notFound('collection not found'); return { ...c, rule: Rule.parse(c.rule) }; };
  const conflict = (e: { code?: string }) => { if (e.code === '23505') throw new UserError('name_conflict', 'a collection with this name already exists', 409); throw e; };

  app.get('/api/v1/collections', authed, async (req) => {
    const u = userOf(req);
    const rows = await sql<Row[]>`select * from collections where owner_id = ${u.id} order by name_key limit 100`;
    return Promise.all(rows.map(async (c) => { const rule = Rule.safeParse(c.rule); return json(c, rule.success ? (await runRule(u.id, rule.data, { limit: 1, offset: 0 })).total : 0); }));
  });
  app.post('/api/v1/collections', authed, async (req) => {
    const b = Body.parse(req.body), u = userOf(req), name = sanitizeName(b.name);
    await checkRefs(u.id, b.rule);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from collections where owner_id = ${u.id}`;
    if (n!.n >= 100) throw new UserError('too_many_collections', 'too many collections', 409);
    const [c] = await sql<Row[]>`insert into collections (owner_id, name, name_key, icon, color, rule) values (${u.id}, ${name}, ${nameKey(name)}, ${b.icon}, ${b.color}, ${sql.json(b.rule as never)}) returning *`.catch(conflict) as Row[];
    return json(c!);
  });
  /** Try a rule without saving it. */
  app.post('/api/v1/collections/preview', authed, async (req) => {
    const b = z.object({ rule: Rule, limit: z.number().int().min(1).max(200).default(50) }).parse(req.body), u = userOf(req);
    await checkRefs(u.id, b.rule);
    const r = await runRule(u.id, b.rule, { limit: b.limit, offset: 0 });
    return { files: r.files.map(fileJson), total: r.total };
  });
  app.patch('/api/v1/collections/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = Body.partial().parse(req.body), u = userOf(req);
    await mine(u.id, id);
    if (b.rule) await checkRefs(u.id, b.rule);
    const name = b.name ? sanitizeName(b.name) : null;
    const [c] = await sql<Row[]>`update collections set name = coalesce(${name}, name), name_key = coalesce(${name ? nameKey(name) : null}, name_key), icon = coalesce(${b.icon ?? null}, icon), color = coalesce(${b.color ?? null}, color),
      rule = coalesce(${b.rule ? sql.json(b.rule as never) : null}, rule), updated_at = now() where id = ${id} and owner_id = ${u.id} returning *`.catch(conflict) as Row[];
    return json(c!);
  });
  app.delete('/api/v1/collections/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const r = await sql`delete from collections where id = ${id} and owner_id = ${userOf(req).id} returning id`;
    if (!r.length) throw notFound('collection not found');
    return { ok: true };
  });
  app.get('/api/v1/collections/:id/items', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) }).parse(req.query);
    const u = userOf(req);
    const c = await mine(u.id, id);
    const r = await runRule(u.id, c.rule, q);
    return { collection: json(c), files: r.files.map(fileJson), total: r.total, limit: q.limit, offset: q.offset };
  });
}
