// THE MODELSHOP — the editor for GLASS building models.
//
//   npm run modelshop            → http://localhost:5181
//   npm run modelshop -- 5200    → pick another port
//
// Local-only. Do not expose it.
//
// GLASS — Geometry, Lights, Aircraft, Streets & Structures — is the renderer in
// client/game/js/panels/windshield.js: CPU only, a plain 2D canvas, no WebGL, faces
// queued and flushed back-to-front because there is no depth buffer. Every building
// in the flight sim and the truck cab is one of its ~145 model arms, and until this
// tool the only way to look at one was to fly to it.
//
// WHY IT IS ITS OWN SERVER, BESIDE THE STUDIO RATHER THAN INSIDE IT
// ─────────────────────────────────────────────────────────────────
// Same argument scripts/dev.mjs makes about the Studio: no database in this process,
// validation on the request path, and nothing that could stall the game server's tick
// loop. Separate from the Studio because the Studio's client is a top-down 2-D tile
// editor with zero imports, and this one must `import` windshield.js as a module —
// a different serving story and a different module graph. Two small tools beat one
// tool with two personalities.
//
// THE PREVIEW IS THE SHIP. The browser imports the REAL renderer and calls
// renderModelPreview(), which is a named entry into the real drawTypeModel. This
// server owns no geometry, no palette and no camera, so it cannot draw a building
// the sim would not. That is the same contract the Studio states about derive.mjs,
// and it is why the one interesting route here is a static file server.
import { createServer } from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
// The validator and the compile the BUILD uses, not a second opinion — see the write path below.
import { validateModel } from '../../client/shared/building-model-schema.js';
import { bakeModels, readModelFiles, renderModule, OUT as BAKE_OUT } from '../../scripts/shapes/bake-models.mjs';
// The canonical serialiser every content file in this repo is written with. Object keys sort,
// ARRAY ORDER IS PRESERVED — which matters here, because a segment list is a paint order.
import { canonicalJson } from '../../scripts/content/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MODEL_DIR = join(ROOT, 'content', 'building_models');
const PORT = Number(process.argv[2]) || 5181;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));

// Capped, because a local tool is still a server and an unbounded read is an unbounded read.
const MAX_BODY = 2 * 1024 * 1024;
function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('body is not valid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

// ── THE ONE ROUTE THE STUDIO DOES NOT HAVE ──────────────────────────────────
// The browser resolves windshield.js's own relative imports itself, so it is not
// enough to serve that one file — the whole subtree it reaches has to be there,
// under its real paths, or every import specifier in it is a 404.
//
// So: an ALLOWLIST OF DIRECTORIES, not a root. `content/`, `server/`, `plugins/`,
// `.env*` and the git tree are unreachable by construction rather than by a filter
// somebody has to remember to update. On top of that the resolved path is checked to
// still be inside its allowed directory after normalisation, which is what actually
// stops `..` — a character-class test on the request path is not enough here, because
// unlike the Studio's zone-icon route these paths legitimately contain slashes and
// dots. Local-only tool or not, a traversal reads any file on the machine.
const SERVE_DIRS = [
  join(ROOT, 'client', 'game', 'js'),
  join(ROOT, 'client', 'game', 'assets'),
  join(ROOT, 'client', 'shared'),
];
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const mimeOf = (p) => MIME[/\.[a-z0-9]+$/i.exec(p)?.[0]?.toLowerCase()] || 'application/octet-stream';

function resolveServed(path) {
  const abs = normalize(join(ROOT, decodeURIComponent(path).replace(/^\/+/, '')));
  for (const dir of SERVE_DIRS) if (abs === dir || abs.startsWith(dir + sep)) return abs;
  return null;
}

// Scanned once and cached: ~15k zone files, and the answer only changes when the world does.
// Restart the tool after a world edit — it is a local tool, and a stat-per-file watcher would
// cost more than it is worth.
let _bindables = null;
function bindables() {
  if (_bindables) return _bindables;
  const dir = join(ROOT, 'content', 'zones');
  const types = new Map(), names = new Map();
  let building = 0, named = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let z;
      try { z = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
      const bt = z.flags?.building_type;
      if (!bt) continue;
      building++;
      const bn = z.flags.building_name || null;
      if (bn) named++;
      const t = types.get(bt) || { key: bt, tiles: 0, unnamed: 0 };
      t.tiles++; if (!bn) t.unnamed++;
      types.set(bt, t);
      if (bn) {
        const n = names.get(bn) || { key: bn, tiles: 0, type: bt };
        n.tiles++;
        names.set(bn, n);
      }
    }
  } catch { /* no content tree — the editor degrades to a free-text bind */ }
  const bySize = (a, b) => b.tiles - a.tiles || a.key.localeCompare(b.key);
  _bindables = {
    types: [...types.values()].sort(bySize),
    names: [...names.values()].sort(bySize),
    buildingTiles: building,
    namedTiles: named,
  };
  return _bindables;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return send(res, 200, await readFile(join(HERE, 'index.html')), 'text/html; charset=utf-8');
    }
    // The tool's own modules. Name-restricted and joined onto this directory, so it cannot climb
    // out of it — the same shape as the client allowlist below, and the reason it is a pattern
    // rather than a list of filenames is that `app.js` importing `./editor.js` 404s otherwise.
    const own = /^\/([a-z0-9-]+)\.js$/.exec(path);
    if (req.method === 'GET' && own) {
      try {
        return send(res, 200, await readFile(join(HERE, own[1] + '.js')), 'text/javascript; charset=utf-8');
      } catch { return send(res, 404, 'no such module', 'text/plain; charset=utf-8'); }
    }
    // The dev panel's own palettes, so the Modelshop wears the same themes the rest
    // of the tooling does rather than a second set of colours.
    if (req.method === 'GET' && path === '/shared/themes.css') {
      return send(res, 200, await readFile(join(ROOT, 'client', 'shared', 'themes.css')), 'text/css; charset=utf-8');
    }

    // ── THE WRITE PATH ──────────────────────────────────────────────────────
    // WRITES ARE VALIDATED BEFORE THEY LAND, against the same validator `models:bake` and
    // `shapes:smoke` run — imported, never restated. The tool must not be able to author
    // something the push gate will reject; finding that out at push time is exactly the loop
    // this replaces. It is the Studio's rule, in the Studio's words, for the same reason.
    //
    // ⚠ AND A SAVE RE-BAKES. client/shared/building-models.js is what the renderer actually
    // imports, so a file written without re-baking is a change you cannot see and a red
    // `shapes:smoke` later. Doing it here means the two can never be out of step by hand.
    if (req.method === 'GET' && path === '/api/models') {
      return json(res, 200, { models: readModelFiles(MODEL_DIR) });
    }

    // ── WHAT A MODEL CAN BIND TO ────────────────────────────────────────────
    // The `bind` field decides whether a model is ever seen, and it is the single easiest
    // thing to get wrong: `modelFor` prefers a building's NAME over its TYPE, and 408 of the
    // 416 building tiles in Coldwater carry a name — so a type bind draws on almost nothing.
    // The worked example shipped bound to a type whose three tiles are all named, invisible
    // in the game and healthy in every gate.
    //
    // So the editor offers the real targets with their real tile counts, instead of a text
    // box. Counted from content/zones, which is the same tree the deploy reads.
    if (req.method === 'GET' && path === '/api/bindables') {
      return json(res, 200, bindables());
    }

    if ((req.method === 'PUT' || req.method === 'DELETE') && path === '/api/models') {
      const body = req.method === 'PUT' ? await readJson(req) : { file: url.searchParams.get('file') };
      const file = String(body.file || '');
      // A filename reaches the filesystem, so it is matched rather than sanitised: one segment,
      // lower-case, and a .json suffix. Sanitising is a list of things you remembered.
      if (!/^[a-z0-9][a-z0-9_-]*\.json$/.test(file)) {
        return json(res, 400, { errors: [`bad filename '${file}' — lower-case letters, digits, _ and - only, ending .json`] });
      }
      const target = join(MODEL_DIR, file);

      // What was there before, so a refused write can be put back. Validation alone cannot answer
      // the question below — a bind collision is a property of the COLLECTION, invisible to a
      // single document — so the only way to check it is to make the change and re-bake.
      let prior = null;
      try { prior = await readFile(target, 'utf8'); } catch { /* new file */ }

      if (req.method === 'DELETE') {
        try { await unlink(target); } catch (e) { return json(res, 404, { errors: [e.message] }); }
      } else {
        const { errors, warnings } = validateModel(body.doc, file);
        if (errors.length) return json(res, 400, { errors, warnings });
        await mkdir(MODEL_DIR, { recursive: true });
        await writeFile(target, canonicalJson(body.doc), 'utf8');
      }

      // Re-bake from the DIRECTORY, not from the document just posted.
      //
      // ⚠ AND ROLL BACK IF IT FAILS. Leaving the file and refusing the bake reads as the honest
      // state — the file is what you asked for, the build says no — but it is not: it leaves the
      // repo broken by a tool whose entire promise is that it cannot author something the push
      // gate rejects. So a rejected write is undone, and the answer says so.
      const { models, errors: bakeErrors, warnings: bakeWarnings } = bakeModels(readModelFiles(MODEL_DIR));
      if (bakeErrors.length) {
        if (prior != null) await writeFile(target, prior, 'utf8');
        else await unlink(target).catch(() => {});
        return json(res, 409, { errors: bakeErrors, warnings: bakeWarnings, saved: false, rolledBack: true });
      }
      await writeFile(BAKE_OUT, renderModule(models), 'utf8');
      return json(res, 200, { ok: true, file, warnings: bakeWarnings, bindings: Object.keys(models).length });
    }

    if (req.method === 'GET' && path.startsWith('/client/')) {
      const abs = resolveServed(path);
      if (!abs) return send(res, 403, 'outside the served tree', 'text/plain; charset=utf-8');
      try {
        return send(res, 200, await readFile(abs), mimeOf(abs));
      } catch { return send(res, 404, 'no such file', 'text/plain; charset=utf-8'); }
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Modelshop → http://localhost:${PORT}`);
  console.log('GLASS building models, drawn by the real renderer — no database in this process.');
});
