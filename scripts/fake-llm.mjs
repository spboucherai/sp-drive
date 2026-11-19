#!/usr/bin/env node
// A fake OpenAI-compatible chat endpoint for development and the end-to-end suite — NOT a model. It streams a canned
// sentence that cites source [1] for a question, and a canned JSON proposal for an organisation request, so the AI
// screens of the web application can be exercised without any real provider. Every answer says it is fake.
//   node scripts/fake-llm.mjs [port]        (default 8669; scripts/dev-stack.sh starts it when SPD_DEV_AI=fake)
import http from 'node:http';

const port = Number(process.argv[2] ?? process.env.SPD_FAKE_LLM_PORT ?? 8669);
const read = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({}); } }); });
http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [] })); }
  const body = await read(req);
  const last = String(body.messages?.filter((m) => m.role === 'user').pop()?.content ?? '');
  let answer = 'Réponse du serveur factice (aucun modèle réel) : la réponse se trouve dans le passage cité [1].';
  if (/\bREFUSE\b/.test(last)) { res.writeHead(503); return res.end('fake provider down'); }
  try { // an organisation request carries a JSON payload listing the files
    const payload = JSON.parse(last);
    if (Array.isArray(payload.files)) answer = JSON.stringify({ suggestions: payload.files.map((f) => ({ fileId: f.fileId, name: `Classé – ${f.name}`, tags: ['Factice'], category: 'Test', reason: 'Proposition du serveur factice (aucun modèle réel).' })) });
  } catch { /* a question */ }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const words = answer.match(/\S+\s*/g) ?? [];
  for (const w of words) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`); await new Promise((r) => setTimeout(r, 15)); }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: words.length } })}\n\n`);
  res.end('data: [DONE]\n\n');
}).listen(port, '127.0.0.1', () => console.log(`fake LLM (not a model) on http://127.0.0.1:${port}/v1`));
