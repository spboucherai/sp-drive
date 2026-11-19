// Measures how well the local embedding backends retrieve the right passage on the fixture set
// (services/api/test/fixtures/semantic.json): recall@1, recall@3 and mean reciprocal rank, per backend and per
// query family. Run on the node: pnpm exec tsx scripts/semantic-eval.mts   (needs dist/spd-textkit).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fx = JSON.parse(readFileSync(new URL('../services/api/test/fixtures/semantic.json', import.meta.url), 'utf8')) as { passages: { id: string; lang: string; text: string }[]; queries: { q: string; answer: string }[] };
const bin = process.env.SPD_TEXTKIT ?? 'dist/spd-textkit';
const dir = mkdtempSync(join(tmpdir(), 'spd-sem-'));
function embed(model: string, texts: { text: string; lang?: string }[]): { lang: string; vector: number[] | null }[] {
  writeFileSync(join(dir, 'in.json'), JSON.stringify({ texts }));
  execFileSync(bin, ['embed', join(dir, 'in.json'), join(dir, 'out.json'), '--model', model]);
  return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')).vectors;
}
const cos = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };
const langOf = (id: string) => fx.passages.find((p) => p.id === id)!.lang;
for (const model of ['contextual', 'sentence']) {
  const P = embed(model, fx.passages.map((p) => ({ text: p.text, lang: p.lang })));
  const fam: Record<string, { n: number; r1: number; r3: number; mrr: number }> = {};
  for (const q of fx.queries) {
    // the sentence backend has one vector space per language: a query is embedded in the language of each candidate
    const ranks = fx.passages.map((p, i) => {
      const [qv] = embed(model, [{ text: q.q, ...(model === 'sentence' ? { lang: p.lang } : {}) }]);
      return { id: p.id, score: qv!.vector && P[i]!.vector && qv!.vector.length === P[i]!.vector!.length ? cos(qv!.vector, P[i]!.vector!) : -1 };
    }).sort((a, b) => b.score - a.score);
    const rank = ranks.findIndex((r) => r.id === q.answer) + 1;
    const qLang = /[éèàçùêâî]| (le|la|les|de|du|des|mon|pour) /.test(` ${q.q} `) ? 'fr' : 'en';
    const family = qLang === langOf(q.answer) ? `${qLang}→${qLang}` : `${qLang}→${langOf(q.answer)} (cross-language)`;
    for (const k of [family, 'all']) { const f = (fam[k] ??= { n: 0, r1: 0, r3: 0, mrr: 0 }); f.n++; f.r1 += rank === 1 ? 1 : 0; f.r3 += rank <= 3 ? 1 : 0; f.mrr += 1 / rank; }
  }
  console.log(`\nbackend: ${model} (dim ${P.find((p) => p.vector)?.vector?.length ?? 0}, passages without a vector: ${P.filter((p) => !p.vector).length}/${P.length})`);
  for (const [k, f] of Object.entries(fam)) console.log(`  ${k.padEnd(28)} n=${String(f.n).padStart(2)}  recall@1 ${(f.r1 / f.n).toFixed(2)}  recall@3 ${(f.r3 / f.n).toFixed(2)}  MRR ${(f.mrr / f.n).toFixed(2)}`);
}
// How sure is the best hit? Absolute cosines of this model sit in a narrow high band, so the useful signal is how far the
// best passage stands above the others for that query (z-score). Off-topic questions should not stand out.
{
  const P = embed('contextual', fx.passages.map((p) => ({ text: p.text, lang: p.lang })));
  const z = (q: string) => { const [qv] = embed('contextual', [{ text: q }]); const s = P.map((p) => cos(qv!.vector!, p.vector!)); const m = s.reduce((a, b) => a + b, 0) / s.length; const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length); const top = Math.max(...s); return { top, z: (top - m) / sd, best: fx.passages[s.indexOf(top)]!.id }; };
  const on = fx.queries.map((q) => ({ ...z(q.q), ok: z(q.q).best === q.answer }));
  const off = ['quelle est la capitale de la Mongolie', 'who won the hockey game last night', 'paroles de chanson sur la pluie', 'how to train a dragon', 'prix du bitcoin aujourd\'hui', 'best pizza topping'].map((q) => z(q));
  const stat = (xs: number[]) => `min ${Math.min(...xs).toFixed(2)}  median ${[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(2)}  max ${Math.max(...xs).toFixed(2)}`;
  console.log(`\ncontextual, best-hit cosine      on-topic: ${stat(on.map((x) => x.top))}   off-topic: ${stat(off.map((x) => x.top))}`);
  console.log(`contextual, best-hit z-score     right answer on top: ${stat(on.filter((x) => x.ok).map((x) => x.z))}   wrong on top: ${stat(on.filter((x) => !x.ok).map((x) => x.z))}   off-topic: ${stat(off.map((x) => x.z))}`);
}
console.log(`\nchance: recall@1 ${(1 / fx.passages.length).toFixed(2)}, recall@3 ${(3 / fx.passages.length).toFixed(2)}`);
