#!/usr/bin/env node
// listen.mjs: serves the blind A/B listening test listen-build.py made, and scores it.
//
//   node tools/voice-fit/ddsp/listen.mjs <test dir> [--port 5651]   serve it
//   node tools/voice-fit/ddsp/listen.mjs <test dir> --score          tally answers.json
//
// The page (listen.html) sees pairs.json only. Each answer is POSTed to /answer and kept in
// <test dir>/answers.json, one per pair (answering again replaces it), so a test can stop and
// carry on. key.json, which says which side was the rules, is read only by --score.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DIR = args[0];
if (!DIR) { console.error('usage: listen.mjs <test dir> [--port N] [--score]'); process.exit(2); }
const ANS = join(DIR, 'answers.json');
const answers = () => (existsSync(ANS) ? JSON.parse(readFileSync(ANS, 'utf8')) : {});

if (args.includes('--score')) {
  const key = JSON.parse(readFileSync(join(DIR, 'key.json'), 'utf8')), ans = answers();
  // The base is the side every pair shares (the rules, unless listen-build.py had --base).
  const count = {};
  for (const k of Object.values(key)) for (const v of [k.a, k.b]) count[v] = (count[v] || 0) + 1;
  const meta = join(DIR, 'meta.json');
  const base = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')).base : Object.keys(count).sort((x, y) => count[y] - count[x])[0];
  const t = {};
  for (const [n, a] of Object.entries(ans)) {
    const k = key[n]; if (!k) continue;
    const cand = k.a === base ? k.b : k.a;
    const row = (t[cand] ||= { better: 0, same: 0, worse: 0 });
    if (a.choice === 'same') row.same++;
    else if (k[a.choice] === base) row.worse++;
    else row.better++;
  }
  // Sign test on better against worse, ties left out: the chance of a split this lopsided or
  // more if the listener had no preference.
  const binom = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c; };
  const p2 = (b, w) => { const n = b + w, m = Math.min(b, w); let s = 0; for (let i = 0; i <= m; i++) s += binom(n, i); return Math.min(1, 2 * s / 2 ** n); };
  console.log(`${Object.keys(ans).length} of ${Object.keys(key).length} pairs answered`);
  for (const [c, r] of Object.entries(t))
    console.log(`${c.padEnd(18)} preferred ${r.better}, same ${r.same}, ${base} preferred ${r.worse}   p = ${p2(r.better, r.worse).toFixed(3)}`);
  process.exit(0);
}

const port = +(args[args.indexOf('--port') + 1] || 0) || 5651;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.wav': 'audio/wav' };
createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && url === '/answer') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const { n, choice } = JSON.parse(body);
        if (!['a', 'b', 'same'].includes(choice) || !Number.isInteger(n)) throw new Error('bad answer');
        const all = answers(); all[n] = { choice, at: new Date().toISOString() };
        writeFileSync(ANS, JSON.stringify(all, null, 1));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  let file;
  if (url === '/' || url === '/index.html') file = join(HERE, 'listen.html');
  else if (url === '/pairs.json') file = join(DIR, 'pairs.json');
  else if (url === '/answers.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answers())); return; }
  else if (/^\/wav\/[a-z0-9]+\.wav$/.test(url)) file = join(DIR, normalize(url));
  if (!file || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`listening test on http://localhost:${port}`));
