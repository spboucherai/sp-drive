// 2.0: content index — extraction per family (text, office XML, PDF text layer, OCR), full-text search with snippets,
// GET /files/:id/text, GET /index/status, the reindex backfill, semantic search, perceptual hashes. Real PostgreSQL,
// real clamd, the real local helper inside the sandbox.
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { hamming } from '../src/insights.ts';
import { decodeText, passagesOf, reindex, textFamily, xmlToText } from '../src/textindex.ts';
import { resetTextkitProbe, runSandboxed, withWorkDir } from '../src/tools.ts';
import { closeAll, pdfWithText, signup, work } from './harness.ts';

afterAll(closeAll);
const FX = `${process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test'}/fixtures-index`;
let a: Awaited<ReturnType<typeof signup>>;
const zip = async (path: string, entries: Record<string, string>) => { const z = new yazl.ZipFile(); for (const [n, c] of Object.entries(entries)) z.addBuffer(Buffer.from(c), n); z.end(); await pipeline(z.outputStream, createWriteStream(path)); return readFileSync(path); };
const up = async (name: string, data: Buffer, c = a) => { const r = await c.client.upload(c.rootId, name, data); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body.file; };
const text = async (id: string, c = a) => (await c.client.get(`/api/v1/files/${id}/text`)).body;
const search = async (q: string, extra = '', c = a) => (await c.client.get(`/api/v1/search?q=${encodeURIComponent(q)}${extra}`)).body;
let png: Buffer, scanPdf: Buffer;

beforeAll(async () => {
  expect(existsSync(config.textkit), 'dist/spd-textkit is missing: run scripts/textkit-build.sh').toBe(true);
  a = await signup();
  mkdirSync(FX, { recursive: true });
  // a "scan": big letters rendered to a bitmap (no text layer anywhere), as a PNG and as an image-only PDF
  const big = join(FX, 'big.pdf');
  (await import('node:fs')).writeFileSync(big, pdfWithText(['FACTURE 4471', 'Plomberie Gagnon', 'Total 318 dollars'], 54));
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', big, '--out', join(FX, 'scan.png')], { stdio: 'pipe' });
  execFileSync('/usr/bin/sips', ['-s', 'format', 'pdf', join(FX, 'scan.png'), '--out', join(FX, 'scan.pdf')], { stdio: 'pipe' });
  png = readFileSync(join(FX, 'scan.png')); scanPdf = readFileSync(join(FX, 'scan.pdf'));
});

describe('text helpers', () => {
  it('decides the extraction family from the name', () => {
    expect([textFamily('a.txt'), textFamily('a.MD'), textFamily('a.pdf'), textFamily('a.docx'), textFamily('a.jpeg'), textFamily('a.doc'), textFamily('a.html'), textFamily('a.ppt'), textFamily('a.mp4'), textFamily('a.zip'), textFamily('sans-extension')])
      .toEqual(['text', 'text', 'pdf', 'zipxml', 'image', 'textutil', 'html', 'legacy-office', null, null, null]);
  });
  it('decodes text, refuses binary, strips markup, cuts passages at natural ends', () => {
    expect(decodeText(Buffer.from('été'))).toBe('été');
    expect(decodeText(Buffer.from([0xe9, 0x74, 0xe9]))).toBe('été'); // Windows-1252
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('été', 'utf16le')]))).toBe('été');
    expect(decodeText(Buffer.from([0, 1, 2, 3, 0, 0, 7, 8, 0, 0, 0, 1]))).toBeNull();
    expect(xmlToText('<p>Un &amp; deux</p><script>alert(1)</script><p>trois&#233;</p>').trim().split(/\s*\n\s*/)).toEqual(['Un & deux', 'troisé']);
    const long = `${'Première phrase assez longue pour compter. '.repeat(30)}\n\n${'Seconde partie du document. '.repeat(40)}`;
    const ps = passagesOf(long, 3);
    expect(ps.length).toBeGreaterThan(2);
    expect(ps.every((p) => p.text.length <= 900 && p.page === 3)).toBe(true);
    expect(ps.slice(0, -1).every((p) => /[.!?]$/.test(p.text))).toBe(true);
    expect(passagesOf('   \n ')).toEqual([]);
  });
});

describe('content index', () => {
  it('indexes text, office XML, PDF text layers and scans after a clean antivirus scan', async () => {
    const txt = await up('notes de réunion.txt', Buffer.from('Ordre du jour\n\nLe budget de la coopérative Hirondelle est adopté.\nProchaine assemblée en février.\n'));
    const docx = await up('contrat.docx', await zip(join(FX, 'contrat.docx'), { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Contrat de location du chalet</w:t></w:r></w:p><w:p><w:r><w:t>Le locataire verse un dépôt de 500 dollars.</w:t></w:r></w:p></w:body></w:document>' }));
    const pptx = await up('présentation.pptx', await zip(join(FX, 'p.pptx'), { 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Stratégie numérique</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Calendrier de déploiement</a:t></a:r></a:p></p:sld>', 'ppt/notesSlides/notesSlide2.xml': '<p:notes><a:p><a:r><a:t>Mentionner le fournisseur Nordik</a:t></a:r></a:p></p:notes>' }));
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Inventaire'); ws.addRow(['Article', 'Quantité']); ws.addRow(['Tournevis cruciforme', 12]);
    await wb.xlsx.writeFile(join(FX, 'stock.xlsx'));
    const xlsx = await up('stock.xlsx', readFileSync(join(FX, 'stock.xlsx')));
    const pdf = await up('rapport.pdf', pdfWithText(['Rapport trimestriel', 'La société Borealis a livré 42 turbines.', 'The maintenance schedule was approved.']));
    const scan = await up('reçu.png', png);
    const scanned = await up('numérisation.pdf', scanPdf);
    const video = await up('film.mp4', Buffer.from('not really a video'));
    const empty = await up('vide.txt', Buffer.from('   \n\n'));
    // before the worker ran: pending for what will be indexed, unsupported for what never will
    expect((await text(txt.id)).status).toBe('pending');
    expect((await text(video.id)).status).toBe('unsupported');
    await work();

    expect(await text(txt.id)).toMatchObject({ status: 'ready', source: 'text', pages: 0, error: null });
    expect((await text(txt.id)).excerpt).toContain('coopérative Hirondelle');
    expect((await text(txt.id)).chars).toBeGreaterThan(60);
    expect(await text(docx.id)).toMatchObject({ status: 'ready', source: 'office-xml' });
    expect((await text(docx.id)).excerpt).toMatch(/Contrat de location du chalet\nLe locataire verse/);
    expect(await text(pptx.id)).toMatchObject({ status: 'ready', source: 'office-xml', pages: 2 });
    expect((await text(xlsx.id)).excerpt).toContain('Tournevis cruciforme');
    expect((await text(xlsx.id)).excerpt).toContain('Inventaire'); // sheet names count
    expect(await text(pdf.id)).toMatchObject({ status: 'ready', source: 'pdf-text', pages: 1 });
    expect((await text(pdf.id)).excerpt).toContain('Borealis a livré 42 turbines');
    expect(await text(scan.id)).toMatchObject({ status: 'ready', source: 'ocr' });
    expect((await text(scan.id)).excerpt).toMatch(/FACTURE 4471/i);
    expect((await text(scan.id)).excerpt).toMatch(/Plomberie Gagnon/i);
    expect(await text(scanned.id)).toMatchObject({ status: 'ready', source: 'ocr', pages: 1 });
    expect((await text(scanned.id)).excerpt).toMatch(/318 dollars/i);
    expect((await text(video.id)).status).toBe('unsupported');
    expect((await text(empty.id)).status).toBe('empty');
    // pages are kept: a PDF hit can open at the right page
    const [p] = await sql`select page from object_passages p join file_versions v on v.object_id = p.object_id where v.file_id = ${pptx.id} and p.text like '%Calendrier%'`;
    expect(p!.page).toBe(2);
    const st = (await a.client.get('/api/v1/index/status')).body;
    expect(st.content).toMatchObject({ enabled: true, ready: 7, pending: 0, failed: 0, unsupported: 1, empty: 1 });
  });

  it('finds files by their content, with a marked snippet, alongside name matches', async () => {
    let r = await search('turbines');
    expect(r.files.map((f: any) => f.name)).toEqual(['rapport.pdf']);
    expect(r.files[0].match).toMatchObject({ where: 'content', page: 1 });
    expect(r.files[0].match.snippet).toMatch(/⟦turbines⟧/);
    // accents and case do not matter; French stemming matches the plural
    expect((await search('COOPERATIVE hirondelle')).files[0].match.snippet).toMatch(/⟦coopérative⟧ ⟦Hirondelle⟧/);
    expect((await search('turbine')).files.map((f: any) => f.name)).toEqual(['rapport.pdf']);
    // English stemming too
    expect((await search('schedules approved')).files[0].match.snippet).toMatch(/⟦schedule⟧ was ⟦approved⟧/);
    // OCR text is searchable like any other
    expect((await search('plomberie')).files.map((f: any) => f.name).sort()).toEqual(['numérisation.pdf', 'reçu.png']);
    // a word present in a name and in a text: both
    r = await search('contrat');
    expect(r.files.find((f: any) => f.name === 'contrat.docx').match.where).toBe('both');
    // in= narrows where to look; the 1.0 filters still apply
    expect((await search('contrat', '&in=name')).files[0].match).toEqual({ where: 'name' });
    expect((await search('rapport', '&in=content')).files.map((f: any) => f.name)).toEqual(['rapport.pdf']); // "Rapport trimestriel" is in the text
    expect((await search('location', '&in=name')).files).toEqual([]);
    expect((await search('location', '&in=content')).files.map((f: any) => f.name)).toEqual(['contrat.docx']);
    expect((await search('plomberie', '&kind=pdf')).files.map((f: any) => f.name)).toEqual(['numérisation.pdf']);
    // without a query the answer keeps its 1.0 shape (no `match`)
    r = (await a.client.get('/api/v1/search?kind=pdf')).body;
    expect(r.files.length).toBe(2); expect(r.files[0].match).toBeUndefined();
    // hostile input is data
    for (const q of ["'); drop table files; --", '"unclosed', '& | ! <->', 'a:*', '\\']) expect((await a.client.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).status).toBe(200);
    expect((await a.client.get('/api/v1/search?q=x&in=everything')).status).toBe(400);
  });

  it('never returns another account\'s content, trashed files or infected files', async () => {
    const b = await signup();
    expect((await search('turbines', '', b)).files).toEqual([]);
    expect((await (b.client.get(`/api/v1/files/${(await search('turbines')).files[0].id}/text`))).status).toBe(404);
    const secret = await up('journal.txt', Buffer.from('Le mot de passe du coffre est zinzolin.'), b);
    await work();
    expect((await search('zinzolin', '', b)).files).toHaveLength(1);
    expect((await search('zinzolin')).files).toEqual([]);
    await b.client.post('/api/v1/trash', { fileIds: [secret.id], folderIds: [] });
    expect((await search('zinzolin', '', b)).files).toEqual([]);
    // an infected file is never indexed: its text does not exist in the database
    const eicar = await up('note-eicar.txt', Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), b);
    await work();
    expect((await b.client.get(`/api/v1/files/${eicar.id}`)).body.file.scan).toBe('infected');
    expect(await sql`select 1 from object_passages p join file_versions v on v.object_id = p.object_id where v.file_id = ${eicar.id}`).toHaveLength(0);
    expect((await text(eicar.id, b)).status).toBe('unsupported');
    expect((await search('EICAR', '&in=content', b)).files).toEqual([]);
  });

  it('enforces limits and reports failures without retrying for ever', async () => {
    const saved = { text: config.textMaxBytes, pages: config.extractMaxPages };
    config.textMaxBytes = 1000;
    try {
      const big = await up('gros.txt', Buffer.from('mot '.repeat(600)));
      await work();
      expect(await text(big.id)).toMatchObject({ status: 'unsupported', excerpt: '' });
      expect((await text(big.id)).error).toMatch(/too large/);
    } finally { config.textMaxBytes = saved.text; }
    const broken = await up('cassé.pdf', Buffer.from('%PDF-1.4\nthis is not a PDF at all'));
    const bomb = await up('bombe.docx', await (async () => { const z = new yazl.ZipFile(); const { Readable } = await import('node:stream'); z.addReadStream(Readable.from((function* () { const blk = Buffer.alloc(1 << 20); for (let i = 0; i < 400; i++) yield blk; })()), 'word/document.xml'); z.end(); const path = join(FX, 'bombe.docx'); await pipeline(z.outputStream, createWriteStream(path)); return readFileSync(path); })());
    await work();
    expect((await text(broken.id)).status).toBe('failed');
    expect(await text(bomb.id)).toMatchObject({ status: 'failed' });
    expect((await text(bomb.id)).error).toMatch(/unreasonable size/);
    expect(await sql`select 1 from jobs where kind = 'extract_text' and status in ('queued', 'running')`).toHaveLength(0);
  });

  it('the helper runs offline and cannot read the drive (sandbox unchanged for it)', async () => {
    await withWorkDir(async (w) => {
      const net = await runSandboxed(w, '/usr/bin/curl', ['-s', '-m', '3', 'https://example.com'], { timeoutMs: 8000, modelCache: true });
      expect(net.code).not.toBe(0);
      const key = await runSandboxed(w, '/bin/cat', [config.masterKeyFile], { timeoutMs: 5000, modelCache: true });
      expect(key.code).not.toBe(0); expect(key.stdout).toBe('');
      const home = await runSandboxed(w, '/bin/ls', [`${process.env.HOME}/Documents`], { timeoutMs: 5000, modelCache: true });
      expect(home.code).not.toBe(0);
      const blobs = await runSandboxed(w, '/bin/ls', [config.blobDir], { timeoutMs: 5000, modelCache: true });
      expect(blobs.code).not.toBe(0);
    });
  });

  it('SPD_INDEX_CONTENT=off indexes nothing; the reindex backfill catches up afterwards', async () => {
    config.indexContent = false;
    let f;
    try {
      f = await up('plus tard.txt', Buffer.from('Le perroquet Kakariki mange des graines.'));
      await work();
      expect((await text(f.id)).status).toBe('unsupported');
      expect((await search('kakariki')).files).toEqual([]);
      expect(await reindex()).toBe(0);
    } finally { config.indexContent = true; }
    // objects from before the upgrade have no row at all: simulate one more
    const [o] = await sql<{ object_id: string }[]>`select v.object_id from file_versions v join files f on f.id = v.file_id where f.name = 'rapport.pdf' and f.owner_id = ${a.userId}`;
    await sql`delete from object_text where object_id = ${o!.object_id}`; await sql`delete from object_passages where object_id = ${o!.object_id}`;
    expect((await search('turbines')).files).toEqual([]);
    expect(await reindex()).toBeGreaterThanOrEqual(2);
    await work();
    expect((await search('kakariki')).files.map((x: any) => x.name)).toEqual(['plus tard.txt']);
    expect((await search('turbines')).files.map((x: any) => x.name)).toEqual(['rapport.pdf']);
    expect(await reindex()).toBe(0); // nothing left to do
  });

  it('a new version replaces what is searchable', async () => {
    const f = await up('brouillon.txt', Buffer.from('Première version avec le mot ornithorynque.'));
    await work();
    expect((await search('ornithorynque')).files).toHaveLength(1);
    await a.client.upload(a.rootId, 'brouillon.txt', Buffer.from('Seconde version avec le mot salamandre.'), { fileId: f.id });
    await work();
    expect((await search('ornithorynque')).files).toEqual([]); // only current versions are searched
    expect((await search('salamandre')).files).toHaveLength(1);
  });
});

describe('semantic search', () => {
  it('answers with the nearest passages when the local model is present, and says so honestly when it is not', async () => {
    const st = (await a.client.get('/api/v1/index/status')).body.semantic;
    const meta = (await (await import('./harness.ts')).server()).inject({ method: 'GET', url: '/api/v1/meta' });
    expect((await meta).json().features.includes('semantic')).toBe(st.available);
    const res = await a.client.get(`/api/v1/search/semantic?q=${encodeURIComponent('réunion des membres de la coopérative')}&limit=3`);
    expect(res.status, res.raw.toString().slice(0, 300)).toBe(200);
    const r = res.body;
    expect(r.available).toBe(st.available);
    if (st.available) {
      expect(st.model).toBe('apple-nl-contextual'); expect(st.embedded).toBeGreaterThan(5);
      expect(r.hits.length).toBeGreaterThan(0); expect(r.hits.length).toBeLessThanOrEqual(3);
      expect(r.hits[0]).toMatchObject({ file: { type: 'file' }, passage: { text: expect.any(String) } });
      expect(r.hits[0].score).toBeGreaterThan(0); expect(r.hits[0].score).toBeLessThanOrEqual(1.0001);
      expect(r.hits.map((h: any) => h.file.name)).toContain('notes de réunion.txt');
      // only the caller's own live files
      const b = await signup();
      expect((await b.client.get('/api/v1/search/semantic?q=coop%C3%A9rative')).body.hits).toEqual([]);
    }
    // switched off: the feature reports unavailable instead of pretending
    config.semantic = 'off'; resetTextkitProbe();
    try {
      expect((await a.client.get('/api/v1/search/semantic?q=budget')).body).toEqual({ available: false, hits: [] });
      expect((await a.client.get('/api/v1/index/status')).body.semantic).toMatchObject({ available: false, model: null });
    } finally { config.semantic = 'auto'; }
    expect((await a.client.get('/api/v1/search/semantic')).status).toBe(400);
  });
});

describe('perceptual hash', () => {
  it('groups images that look alike and leaves different ones apart', async () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64); expect(hamming('00000000000000f0', '0000000000000030')).toBe(2);
    const u = await signup();
    // an opaque picture (the PNG above has a transparent background, which a JPEG would turn black: a different picture)
    execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', join(FX, 'big.pdf'), '--out', join(FX, 'base.jpg')], { stdio: 'pipe' });
    const base = readFileSync(join(FX, 'base.jpg'));
    const mk = (args: string[], out: string) => { execFileSync('/usr/bin/sips', [...args, join(FX, 'base.jpg'), '--out', join(FX, out)], { stdio: 'pipe' }); return readFileSync(join(FX, out)); };
    await up('original.jpg', base, u);
    await up('plus petit.jpg', mk(['-Z', '300'], 'small.jpg'), u);
    await up('en png.png', mk(['-s', 'format', 'png'], 'conv.png'), u);
    await up('tourné.jpg', mk(['-r', '90'], 'rot.jpg'), u);
    await up('copie exacte.jpg', base, u);
    await work();
    expect((await sql`select count(*)::int as n from object_phash h join storage_objects o on o.id = h.object_id where o.owner_id = ${u.userId}`)[0]!.n).toBe(4); // four distinct contents
    const r = (await u.client.get('/api/v1/duplicates?mode=similar-images')).body;
    expect(r.mode).toBe('similar-images');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].files.map((f: any) => f.name).sort()).toEqual(['copie exacte.jpg', 'en png.png', 'original.jpg', 'plus petit.jpg']);
    expect(r.groups[0].files[0].dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.groups[0].maxDistance).toBeLessThanOrEqual(6);
    // exact duplicates stay the business of mode=exact, which flags different names
    const e = (await u.client.get('/api/v1/duplicates')).body;
    expect(e.mode).toBe('exact'); expect(e.groups).toHaveLength(1);
    expect(e.groups[0]).toMatchObject({ distinctNames: true }); expect(e.groups[0].files.map((f: any) => f.name).sort()).toEqual(['copie exacte.jpg', 'original.jpg']);
    expect((await u.client.get('/api/v1/duplicates?mode=fuzzy')).status).toBe(400);
    // nothing was deleted by looking
    expect((await u.client.get('/api/v1/folders/root')).body.files).toHaveLength(5);
  });
});
