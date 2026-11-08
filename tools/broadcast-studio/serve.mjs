// THE BROADCAST STUDIO's server (`npm run broadcast-studio`, :5190). A local tool, as the Studio and
// the Modelshop are: it serves the page, the client's own modules so the preview is what ships, and
// reads and writes content/media_graphics. A set, a sequence or a show is one row there, with the
// document as its `content` (client/shared/sequence.js), so the content pipeline carries it live and
// the schema doesn't change.
//
// ⚠ LOCALHOST ONLY. It writes files, so it binds 127.0.0.1 and takes no auth.

import { createServer } from 'node:http';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
import { canonicalJson } from '../../scripts/content/lib.mjs';
import { sampleFacts } from '../../plugins/broadcast/sports/sample-game.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GRAPHICS = join(ROOT, 'content', 'media_graphics');
const SCRIPTS = join(ROOT, 'data', 'scripts');
const PORT = Number(process.argv[2]) || 5190;
const KINDS = new Set(['set', 'sequence', 'show']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};
const mimeOf = (p) => MIME[/\.[a-z0-9]+$/i.exec(p)?.[0]?.toLowerCase()] || 'application/octet-stream';
const send = (res, code, body, type) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), MIME['.json']);
const bodyOf = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', no); });

// Only the client is served, and /shared/ is /client/shared/ as it is on the game's own origin.
const CLIENT = join(ROOT, 'client');
function served(path) {
  const rel = path.startsWith('/shared/') ? `client${path}` : path.startsWith('/js/') || path.startsWith('/assets/') ? `client/game${path}` : path.replace(/^\/+/, '');
  const abs = normalize(join(ROOT, decodeURIComponent(rel)));
  return abs === CLIENT || abs.startsWith(CLIENT + sep) ? abs : null;
}

function readDocs() {
  const out = [];
  for (const f of readdirSync(GRAPHICS)) {
    if (!f.endsWith('.json')) continue;
    let row;
    try { row = JSON.parse(readFileSync(join(GRAPHICS, f), 'utf8')); } catch { continue; }
    if (!KINDS.has(row.type)) continue;
    try { out.push(JSON.parse(row.content)); } catch { /* a row somebody broke by hand: the Studio can't open it */ }
  }
  return out;
}

// Names and looks for the cast picker. Scanned once: restart the tool after adding an NPC.
let _npcs = null;
function npcs() {
  if (_npcs) return _npcs;
  const dir = join(ROOT, 'content', 'npcs');
  _npcs = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const n = JSON.parse(readFileSync(join(dir, f), 'utf8')); _npcs.push({ id: n.id, name: n.name, sex: n.sex, figure: n.flags?.figure || null }); } catch { /* skip it */ }
  }
  _npcs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return _npcs;
}

// Which broadcasts there are, for a show's entry.
function broadcasts() {
  const dir = join(ROOT, 'content', 'media_broadcasts'), out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const b = JSON.parse(readFileSync(join(dir, f), 'utf8')); out.push({ id: b.id, name: b.name }); } catch { /* skip it */ }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname;
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return send(res, 200, await readFile(join(HERE, 'index.html')), MIME['.html']);
    if (req.method === 'GET' && /^\/(studio\.js|studio\.css)$/.test(path)) return send(res, 200, await readFile(join(HERE, path.slice(1))), mimeOf(path));
    if (req.method === 'GET' && path === '/bsm-studio.html') return send(res, 200, await readFile(join(ROOT, 'client', 'game', 'bsm-studio.html')), MIME['.html']);
    if (req.method === 'GET' && path === '/bsm-compiler.js') return send(res, 200, await readFile(join(ROOT, 'client', 'devpanel', 'js', 'bsm-compiler.js')), MIME['.js']);

    if (req.method === 'GET' && path === '/api/docs') return json(res, 200, { docs: readDocs() });
    if (req.method === 'GET' && path === '/api/npcs') return json(res, 200, { npcs: npcs() });
    if (req.method === 'GET' && path === '/api/broadcasts') return json(res, 200, { broadcasts: broadcasts() });
    // A real simulated game's facts at a moment, for the preview and the token list.
    if (req.method === 'GET' && path === '/api/sample') {
      const id = url.searchParams.get('broadcast') || '';
      if (!/^[\w-]+$/.test(id)) return json(res, 400, { error: 'bad id' });
      const row = JSON.parse(await readFile(join(ROOT, 'content', 'media_broadcasts', id + '.json'), 'utf8')).sports_pools;
      if (!row) return json(res, 404, { error: 'not a sports broadcast' });
      return json(res, 200, sampleFacts(row, Number(url.searchParams.get('seed')) || 1, url.searchParams.get('when') || 'open', Number(url.searchParams.get('n')) || 0));
    }
    if (req.method === 'GET' && path === '/api/scripts') return json(res, 200, { scripts: readdirSync(SCRIPTS).filter((f) => f.endsWith('.bsm')) });
    if (req.method === 'GET' && path === '/api/script') {
      const name = url.searchParams.get('name') || '';
      if (!/^[\w.-]+\.bsm$/.test(name)) return json(res, 400, { error: 'bad name' });
      return send(res, 200, await readFile(join(SCRIPTS, name)), 'text/plain; charset=utf-8');
    }

    if (req.method === 'PUT' && path === '/api/doc') {
      const doc = JSON.parse(await bodyOf(req));
      if (!KINDS.has(doc?.kind) || !/^[\w-]+$/.test(doc?.id || '')) return json(res, 400, { error: 'a document needs a kind and an id' });
      const file = join(GRAPHICS, doc.id + '.json');
      let prior = null;
      try { prior = JSON.parse(await readFile(file, 'utf8')); } catch { /* a new row */ }
      if (prior && !KINDS.has(prior.type)) return json(res, 409, { error: `${doc.id} is already a ${prior.type} graphic` });
      const now = String(Math.floor(Date.now() / 1000));
      const row = { content: JSON.stringify(doc, null, 1), created_at: prior?.created_at || now, description: doc.description || '', id: doc.id, name: doc.name || doc.id, tags: doc.tags || [], type: doc.kind, updated_at: now };
      await writeFile(file, canonicalJson(row) + '\n', 'utf8');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && path === '/api/doc') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w-]+$/.test(id)) return json(res, 400, { error: 'bad id' });
      const row = JSON.parse(await readFile(join(GRAPHICS, id + '.json'), 'utf8'));
      if (!KINDS.has(row.type)) return json(res, 409, { error: 'not a Studio document' });
      await unlink(join(GRAPHICS, id + '.json'));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      const abs = served(path);
      if (abs) return send(res, 200, await readFile(abs), mimeOf(abs));
    }
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, err.code === 'ENOENT' ? 404 : 500, { error: err.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Broadcast Studio: http://localhost:${PORT}/`));
