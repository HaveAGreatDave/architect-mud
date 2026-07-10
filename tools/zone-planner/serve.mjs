// Zone planner — local editor server (no dependencies). Hosts the paint GUI and
// gives it a tiny API to list / read / write blueprint files and to seed a
// blueprint into the LOCAL dev DB by shelling out to apply.mjs.
//
//   node tools/zone-planner/serve.mjs         → http://localhost:5178
//   node tools/zone-planner/serve.mjs 5200    → pick another port
//
// Nothing here talks to the DB directly; seeding goes through apply.mjs exactly
// as the CLI does (same idempotency + validation), so the browser never becomes
// a second, divergent write path. Local-only tool — do not expose it.
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BP_DIR = join(HERE, 'blueprints');
// The zone-icon library the GAME serves and renders on the minimap — the editor
// reads/writes the same folder so what you paint is exactly what ships.
const ICON_DIR = join(HERE, '..', '..', 'client', 'game', 'assets', 'zone-icons');
const PORT = Number(process.argv[2]) || 5178;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b));
});
// Blueprint names are bare slugs; refuse anything with path separators.
const safeName = (n) => /^[a-z0-9_-]+$/i.test(String(n || '')) ? String(n) : null;
const bpFile = (n) => join(BP_DIR, `${n}.bp.json`);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    // ── Static: the editor itself ──
    if (req.method === 'GET' && (path === '/' || path === '/editor.html')) {
      return send(res, 200, await readFile(join(HERE, 'editor.html')), 'text/html; charset=utf-8');
    }

    // ── List blueprints ──
    if (req.method === 'GET' && path === '/api/blueprints') {
      const files = await readdir(BP_DIR).catch(() => []);
      const names = files.filter(f => f.endsWith('.bp.json')).map(f => basename(f, '.bp.json'));
      return json(res, 200, { names });
    }

    // ── Read / write one blueprint ──
    const m = path.match(/^\/api\/blueprints\/([^/]+)$/);
    if (m) {
      const name = safeName(decodeURIComponent(m[1]));
      if (!name) return json(res, 400, { error: 'bad blueprint name' });
      if (req.method === 'GET') {
        const txt = await readFile(bpFile(name), 'utf8').catch(() => null);
        if (txt == null) return json(res, 404, { error: 'not found' });
        return send(res, 200, txt);
      }
      if (req.method === 'PUT') {
        let bp;
        try { bp = JSON.parse(await readBody(req)); }
        catch { return json(res, 400, { error: 'body is not valid JSON' }); }
        await writeFile(bpFile(name), JSON.stringify(bp, null, 2) + '\n');
        return json(res, 200, { ok: true, saved: `${name}.bp.json` });
      }
    }

    // ── Icon library: list, serve one, upload one (shared with the game) ──
    if (req.method === 'GET' && path === '/api/icons') {
      const files = await readdir(ICON_DIR).catch(() => []);
      return json(res, 200, { names: files.filter(f => f.endsWith('.svg')).map(f => basename(f, '.svg')).sort() });
    }
    const im = path.match(/^\/icons\/([a-z0-9_-]+)\.svg$/i);
    if (im && req.method === 'GET') {
      const svg = await readFile(join(ICON_DIR, `${im[1]}.svg`)).catch(() => null);
      if (svg == null) return json(res, 404, { error: 'no such icon' });
      return send(res, 200, svg, 'image/svg+xml');
    }
    const iu = path.match(/^\/api\/icons\/([^/]+)$/);
    if (iu && req.method === 'PUT') {
      const name = safeName(decodeURIComponent(iu[1]));
      if (!name) return json(res, 400, { error: 'bad icon name (use letters, digits, - and _)' });
      const body = await readBody(req);
      if (!/<svg[\s>]/i.test(body)) return json(res, 400, { error: 'body is not an SVG' });
      await writeFile(join(ICON_DIR, `${name}.svg`), body);
      return json(res, 200, { ok: true, name });
    }

    // ── Seed: run apply.mjs (dry-run by default, --apply when apply=1) ──
    if (req.method === 'POST' && path === '/api/seed') {
      const { name, apply, force } = JSON.parse(await readBody(req) || '{}');
      const clean = safeName(name);
      if (!clean) return json(res, 400, { error: 'bad blueprint name' });
      const flags = [bpFile(clean), ...(apply ? ['--apply'] : []), ...(force ? ['--force'] : [])];
      const child = spawn(process.execPath, [join(HERE, 'apply.mjs'), ...flags], { cwd: join(HERE, '..', '..') });
      let out = '';
      child.stdout.on('data', d => (out += d));
      child.stderr.on('data', d => (out += d));
      child.on('close', (code) => json(res, 200, { code, output: out }));
      return;
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Zone planner editor → http://localhost:${PORT}`);
  console.log(`Blueprints: ${BP_DIR}`);
});
