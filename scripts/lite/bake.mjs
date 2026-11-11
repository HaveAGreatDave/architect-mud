// GLASS LITE · THE BAKE.
//
// Writes client/game/assets/lite/: the surface map's buildings as GLASS 2 draws them, in 32×32-tile chunks
// (client/game/js/panels/gl/lite-format.js), for the GLASS Lite renderer (gl/lite.js). A phone then
// draws the city from these files instead of running each building's arm, which is most of what a
// GLASS 2 frame costs on its CPU. See docs/reference/glass-notes.md, GLASS Lite.
//
// Where everything comes from, so nothing here has its own idea of a building:
//   - the cells: client/game/flightsim-world.json, written by scripts/snapshot-flight-world.mjs
//     through the same deriveSurfaceCell the seats receive;
//   - which tiles and how each is built: windshield.js `liteCellOf`, the function the world pass
//     builds its GL cells with;
//   - the faces: gl/world.js `captureTileMesh`, the pass's own tileMesh;
//   - the signs, lights and masts: windshield.js `canvasResidue`, the arm run as a GL frame runs it,
//     from all four sides at noon and at midnight, with the artwork's recipe recorded by
//     `signArgsTap`.
//
// Run:  npm run lite:bake            (re-run after moving a building or editing an arm)
//       node scripts/lite/bake.mjs --check   (compare with the files on disk, write nothing)
//
// It names no region. It needs no database and no network.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { loadWindshield } from '../shapes/dom-stub.mjs';

const ROOT = new URL('../../', import.meta.url);
const OUT = new URL('client/game/assets/lite/', ROOT);

export async function bakeLite({ log = () => {} } = {}) {
  const ws = await loadWindshield();
  // A frozen clock, so a clock-animated part draws the same in every bake and the gate can compare.
  const clock = globalThis.performance, wall = Date.now;
  globalThis.performance = { ...clock, now: () => 1e6 };
  Date.now = () => 1.7e12;
  try {
    const { captureTileMesh, meshParamsOf } = await import('../../client/game/js/panels/gl/world.js');
    const { encodeChunk, chunkOf, chunkName, localRecord, LITE_CHUNK } = await import('../../client/game/js/panels/gl/lite-format.js');
    const world = JSON.parse(readFileSync(new URL('client/game/flightsim-world.json', ROOT), 'utf8'));
    const deps = {
      captureModelMesh: ws.captureModelMesh, modelSolid: ws.modelSolid,
      palette: new Map(ws.wallPaletteInfo().map((p) => [p.key, p.rgb])),
      wallMaterialId: ws.wallMaterialId, roofMaterialId: ws.roofMaterialId,
    };
    const tap = new Map();
    ws.signArgsTap(tap);
    const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const cams = SIDES.map((S) => {
      const hd = (Math.atan2(-S[0], S[1]) * 180 / Math.PI + 360) % 360;
      return ws.makeCam(640, 160, 360, { heading: hd, height: 0, eyeH: 0.24, map: null });
    });
    const stats = { tiles: 0, faces: 0, verts: 0, decals: 0, sprites: 0, strokes: 0, dropped: {} };
    const chunks = new Map();
    const keys = Object.keys(world.cells).map((k) => k.split(',').map(Number))
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [wx, wy] of keys) {
      const c = world.cells[wx + ',' + wy];
      if (!c || !c.bt || c.mark) continue;
      const cell = ws.liteCellOf(c, wx, wy);
      if (!cell) continue;
      const it = { ...cell, gx: 0, gy: 0 };
      const faces = captureTileMesh(deps, it);
      if (!faces || !faces.length) continue;
      const [cx, cy] = chunkOf(wx, wy);
      const ck = cx + ',' + cy;
      let ch = chunks.get(ck);
      if (!ch) chunks.set(ck, ch = { cx, cy, tiles: [], arts: [], artIx: new Map() });
      const art = (r) => { const s = JSON.stringify(r); let i = ch.artIx.get(s); if (i == null) { i = ch.arts.length; ch.arts.push(r); ch.artIx.set(s, i); } return i; };
      const recs = {};
      for (const night of [0, 1]) {
        const seen = new Set(), d = [], sp = [], st = [], lv = [];
        SIDES.forEach((S, si) => {
          const dx = -2 * S[0], dy = -2 * S[1];
          const prev = ws.setTilePlace({ biome: c.biome, wx, wy, vl: c.vl, svc: 0 });
          let r;
          try {
            // ⚠ POWERED, whatever the snapshot's grid said that day (`pw: 1`). The frame dims a dark
            // building itself, by giving it the noon set (windshield.js, where it calls LITE.emit).
            r = ws.canvasResidue(cell.m, { cam: cams[si], night, bn: c.bn || '', brd: c.brd, dx, dy, fh: cell.fh, h: cell.h, seed: cell.seed, E: cell.E, cell: { ...c, pw: 1 }, collect: true, who: false, live: true, base: true });
          } finally { ws.setTilePlace(prev); }
          if (!r || r.threw || !r.sink) return;
          for (const q of r.sink.decals || []) {
            const key = String(q.key || '');
            let recipe = tap.get(q.img) || null;
            if (!recipe) {
              const sm = /(?:^|\|)solid\|(.+)$/.exec(key), rm = /(?:^|\|)ramp\|([^|]+)\|([^|]+)$/.exec(key);
              recipe = sm ? { solid: sm[1] } : rm ? { ramp: [rm[1], rm[2]] } : null;
            }
            if (!recipe) { const k = key.split('|')[0].replace(/[0-9]+/g, '#').slice(0, 20); stats.dropped[k] = (stats.dropped[k] || 0) + 1; continue; }
            const loc = localRecord('d', q, dx, dy);
            const at = loc.rc || loc.rp || loc.p;
            const sig = 'd' + JSON.stringify(recipe).length + ':' + at.map((p) => p.map((v) => Math.round(v * 500)).join(',')).join(';');
            if (seen.has(sig)) continue;
            seen.add(sig);
            loc.art = art(recipe);
            // A sign's quad was fitted to the stub's texture; the device fits the raw board to its own.
            if (recipe.label != null && loc.rc) loc.fit = 1;
            d.push(loc);
          }
          for (const q of r.sink.sprites || []) {
            const loc = localRecord('sp', q, dx, dy);
            const sig = 's' + [loc.x, loc.y, loc.z].map((v) => Math.round(v * 500)).join(',') + (q.rgb || '') + ':' + q.r;
            if (seen.has(sig)) continue;
            seen.add(sig); sp.push(loc);
          }
          for (const q of r.sink.strokes || []) {
            const loc = localRecord('st', q, dx, dy);
            const A = loc.ra || loc.a, B = loc.rb || loc.b;
            const sig = 't' + [...A, ...B].map((v) => Math.round(v * 500)).join(',') + (q.rgb || '');
            if (seen.has(sig)) continue;
            seen.add(sig); st.push(loc);
          }
          // The moving parts: a sky beam or a stack's smoke, as canvasResidue describes them
          // (LIVE_RECORD). They're cut out of the sinks above because a frozen frame of one is
          // wrong; the frame draws each from this record with the live clock (windshield.js
          // liteLiveDraw). The beam's sweep phase rides on the tile's seed, as the arm's does.
          for (const q of r.live || []) {
            const loc = localRecord('sp', q, dx, dy);
            if (q.k === 'beam') loc.seed = cell.seed;
            const sig = 'l' + q.k + [loc.x, loc.y, loc.z].map((v) => Math.round(v * 500)).join(',');
            if (seen.has(sig)) continue;
            seen.add(sig); lv.push(loc);
          }
        });
        recs['n' + night] = lv.length ? { d, sp, st, lv } : { d, sp, st };
      }
      // ⚠ AN ARM THAT MOVES WITH THE CLOCK ISN'T BAKED AS A PICTURE. The kept-arm test, as GLASS 2
      // runs it (armKeep's shadow runs at +1.2 s and +9.9 s): the same arm at midnight from two
      // sides at three moments, its moving parts already cut out by `live`. Any difference (a
      // lighthouse's turning light, a revolving restaurant) marks the tile `an`, and the frame runs
      // its arm for everything but the mesh, which still comes from here.
      let an = 0;
      const sig = (now, si) => {
        const prev = ws.setTilePlace({ biome: c.biome, wx, wy, vl: c.vl, svc: 0 });
        let r;
        try { r = ws.canvasResidue(cell.m, { cam: cams[si], night: 1, now, bn: c.bn || '', brd: c.brd, dx: -2 * SIDES[si][0], dy: -2 * SIDES[si][1], fh: cell.fh, h: cell.h, seed: cell.seed, E: cell.E, cell: { ...c, pw: 1 }, collect: true, who: false, live: true, base: true }); }
        finally { ws.setTilePlace(prev); }
        const s = r && r.sink;
        if (!s) return '';
        const n4 = (v) => (typeof v === 'number' ? Math.round(v * 1e4) : v);
        return JSON.stringify([s.sprites, s.strokes, (s.decals || []).map((d) => [d.p, d.alpha, d.key])], (k, v) => (k === 'img' || k === '_who' ? undefined : n4(v)));
      };
      for (const si of [0, 2]) {
        const a0 = sig(1e6, si);
        if (a0 !== sig(1e6 + 1234.5, si) || a0 !== sig(1e6 + 9876.5, si)) { an = 1; break; }
      }
      if (an) stats.animated = (stats.animated || 0) + 1;
      // Noon's strokes are nearly always midnight's; say so rather than store them twice.
      if (JSON.stringify(recs.n0.st) === JSON.stringify(recs.n1.st)) recs.n1.st = 'n0';
      stats.tiles++; stats.faces += faces.length;
      for (const f of faces) stats.verts += f.p.length;
      for (const n of ['n0', 'n1']) { stats.decals += recs[n].d.length; stats.sprites += recs[n].sp.length; if (Array.isArray(recs[n].st)) stats.strokes += recs[n].st.length; }
      ch.tiles.push({ x: wx, y: wy, key: meshParamsOf(it), bt: c.bt, bn: c.bn, an, faces, recs });
    }
    ws.signArgsTap(null);
    const files = new Map();
    for (const ch of chunks.values()) {
      const bin = encodeChunk({ cx: ch.cx, cy: ch.cy, tiles: ch.tiles, arts: ch.arts });
      files.set(chunkName(ch.cx, ch.cy), { bin, cx: ch.cx, cy: ch.cy, tiles: ch.tiles.length });
    }
    const index = {
      v: 1, chunk: LITE_CHUNK,
      // What the bake was made from: the snapshot's own bounds, so a reader can tell a stale index.
      bounds: world.bounds,
      chunks: [...files.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([file, f]) => ({
        file, cx: f.cx, cy: f.cy, tiles: f.tiles, bytes: f.bin.length,
        hash: createHash('sha256').update(f.bin).digest('hex').slice(0, 16),
      })),
    };
    log(stats);
    return { files, index, stats };
  } finally {
    globalThis.performance = clock; Date.now = wall;
  }
}

// Run from the command line: write the files (or, with --check, compare and write nothing).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const CHECK = process.argv.includes('--check');
  const t0 = Date.now();
  const { files, index, stats } = await bakeLite();
  const ms = Date.now() - t0;
  const idxJson = JSON.stringify(index, null, 1) + '\n';
  if (CHECK) {
    const stale = [];
    for (const [name, f] of files) {
      const p = new URL(name, OUT);
      if (!existsSync(p) || Buffer.compare(readFileSync(p), Buffer.from(f.bin)) !== 0) stale.push(name);
    }
    const idxP = new URL('index.json', OUT);
    if (!existsSync(idxP) || readFileSync(idxP, 'utf8') !== idxJson) stale.push('index.json');
    if (stale.length) { console.log(`lite:bake is stale: ${stale.slice(0, 8).join(', ')}${stale.length > 8 ? ` and ${stale.length - 8} more` : ''}. Run npm run lite:bake.`); process.exit(1); }
    console.log(`lite:bake is current (${files.size} chunks).`);
    process.exit(0);
  }
  mkdirSync(OUT, { recursive: true });
  for (const name of readdirSync(OUT)) if (/^c_-?\d+_-?\d+\.bin$/.test(name) && !files.has(name)) unlinkSync(new URL(name, OUT));
  let raw = 0, br = 0;
  for (const [name, f] of files) {
    writeFileSync(new URL(name, OUT), f.bin);
    raw += f.bin.length;
    br += brotliCompressSync(f.bin, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  }
  writeFileSync(new URL('index.json', OUT), idxJson);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`lite:bake: ${stats.tiles} buildings in ${files.size} chunks, ${stats.faces} faces, ${stats.verts} vertices, `
    + `${stats.decals} signs, ${stats.sprites} lights, ${stats.strokes} strokes, ${stats.animated || 0} animated. ${kb(raw)} raw, ${kb(br)} brotli. ${ms} ms.`);
  const drop = Object.entries(stats.dropped).sort((a, b) => b[1] - a[1]);
  if (drop.length) console.log('  artwork with no recipe, left out: ' + drop.map(([k, v]) => `${k} ${v}`).join(', '));
  process.exit(0);
}
