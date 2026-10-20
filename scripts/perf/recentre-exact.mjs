// recentre-exact: does a RENDER_TUNE switch change what a RECENTRING flight draws?
//
//   node scripts/perf/recentre-exact.mjs lutShift            # off = 0, on = 1
//   node scripts/perf/recentre-exact.mjs groundWorld 0 1 --place marrow --seat cab --frames 160
//   node scripts/perf/recentre-exact.mjs flockShift 0 1 --churn 40
//
// perf:exact paints still views, so a cache that only does something when the server moves the
// window (shifting what it kept by the change of centre) is never exercised there. This flies the
// perf:move route (straight north, turning 0.2 degrees a frame, the window resent through
// map-intern.js every --resend frames and recentred on the craft) once with the switch off and
// once on, each in its own process, and compares every frame: each sink the GPU is handed, the
// floor's LUT and its byte planes, the GL cell list and the canvas log. Numbers are rounded to
// 1e-6 before hashing, so float noise from a shift by whole tiles passes and nothing else does.
// A decal or stroke with its pull still to do (`pl` > 0) is compared by its raw corners (`rp`, `ra`,
// `rb`), which are what gl/decals.js and gl/strokes.js read; its CPU-pulled `p` or `a`/`b` reach no
// layer, and a kept set carries them from the frame it was recorded at.
//
// `--churn K` also changes K cells within 12 tiles of the craft at each resend (a road dropped, a
// biome swapped between park and badlands), the same cells in both runs. A recentre alone only moves
// cells in and out at the window's edges, so a cache's test for a changed neighbour is never asked.
//
// Exits 1 if any frame differs, and names the first few frames and what differed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const child = opt('--child', null);

if (!child) {
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
  const key = pos[0];
  if (!key) { console.error('usage: node scripts/perf/recentre-exact.mjs <tuneKey> [off=0] [on=1] [--place p] [--seat s] [--frames n] [--resend n]'); process.exit(2); }
  const offV = pos[1] ?? '0', onV = pos[2] ?? '1';
  const pass = args.filter((a) => a !== key && a !== offV && a !== onV);
  const run = (val) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', `${key}=${val}`, ...pass], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(2); }
    return r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  };
  const A = run(offV), B = run(onV);
  const bad = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const a = A[i] || {}, b = B[i] || {};
    const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'i' && k !== 'rc' && a[k] !== b[k]);
    if (diff.length) bad.push(`frame ${i}${a.rc ? ' (recentre)' : ''}: ${diff.join(', ')}`);
  }
  const rcs = A.filter((r) => r.rc).length;
  console.log(`${key} ${offV} -> ${onV}: ${A.length} frames, ${rcs} recentres, ${bad.length} frames differ`);
  for (const l of bad.slice(0, 12)) console.log('  ' + l);
  process.exit(bad.length ? 1 : 0);
}

const { openScene, PLACES } = await import('./scene.mjs');
const { internMap } = await import('../../client/game/js/panels/map-intern.js');
const place = opt('--place', 'halcyon'), seat = opt('--seat', 'cockpit');
const FRAMES = Number(opt('--frames', 200)), RESEND = Number(opt('--resend', 20));
const SPEED = Number(opt('--speed', seat === 'cab' ? 0.03 : 0.05)), TURN = Number(opt('--turn', 0.2));

// FNV-1a over a canonical walk, numbers rounded to 1e-6. Keys starting with _ are a record's own
// cache bookkeeping, as in perf:exact, and a canvas is only a canvas.
function hasher() {
  let h = 0x811c9dc5;
  const s = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
  const walk = (v, depth = 0) => {
    if (v == null) { s('~'); return; }
    if (typeof v === 'number') { s(String(Math.round(v * 1e6))); s(','); return; }
    if (typeof v === 'string' || typeof v === 'boolean') { s(String(v)); s(','); return; }
    if (typeof v === 'function') return;
    if (depth > 12) { s('^'); return; }
    if (ArrayBuffer.isView(v)) { s('['); for (let i = 0; i < v.length; i++) walk(v[i]); s(']'); return; }
    if (Array.isArray(v)) { s('['); for (const x of v) walk(x, depth + 1); s(']'); return; }
    if (v.getContext) { s('canvas'); return; }
    s('{');
    for (const k of Object.keys(v).sort()) { if (k[0] === '_' || v[k] === undefined) continue; s(k); s(':'); walk(v[k], depth + 1); }
    s('}');
  };
  return { walk, done: () => (h >>> 0).toString(16) };
}
const digest = (v) => { const H = hasher(); H.walk(v); return H.done(); };

const scene = await openScene();
const [k0, v0val] = child.split('=');
scene.ws.RENDER_TUNE[k0] = Number.isFinite(+v0val) ? +v0val : v0val;
let hook = null;
scene.ws.installGLWorld((cells, cam, o) => { hook = { cells, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
const view = scene.view(place, seat, { hour: Number(opt('--hour', 13)), heading: 0 });
const clone = (map) => map.map((row) => row.map((c) => JSON.parse(JSON.stringify(c))));
const [X0, Y0] = PLACES[place];
let map = view.map, k = 0;
const clock = globalThis.performance, t0 = 1e6;
for (let i = 0; i < FRAMES; i++) {
  globalThis.performance = { ...clock, now: () => t0 + i * 16 };
  const dist = i * SPEED;
  let rc = false;
  if (RESEND && i && i % RESEND === 0) {
    const kOld = k;
    k = Math.round(dist);
    rc = k !== kOld;
    const fresh = clone(scene.view([X0, Y0 - k], seat).map);
    const CH = Number(opt('--churn', 0)), Rw = (fresh.length - 1) >> 1;
    for (let j = 0; j < CH; j++) {
      const h = (u) => { const x = Math.sin(i * 12.9898 + j * 78.233 + u * 37.719) * 43758.5453; return x - Math.floor(x); };
      const c = fresh[Rw + Math.round((h(1) - 0.5) * 24)]?.[Rw + Math.round((h(2) - 0.5) * 24)];
      if (!c || c.bt) continue;
      if (c.road) delete c.road; else c.biome = c.biome === 'park' ? 'badlands' : 'park';
    }
    map = internMap(map, X0, Y0 - kOld, fresh, X0, Y0 - k);
  }
  scene.takeLog();
  scene.ws.paintWindshield('__perf', { ...view, map, mapCenter: { x: X0, y: Y0 - k }, heading: i * TURN, mapOffset: { x: 0.3, y: -(dist - k) } });
  const { cells, o } = hook;
  const row = { i, rc };
  const gpu = (r) => {
    if (r && r.sz && r.sz[0] > 0 && 'r' in r) { const { r: _r, ...rest } = r; r = rest; }   // the sprite shader sizes it from `sz`
    if (!(r && r.pl > 0)) return r;
    if (r.rp) { const { p, ...rest } = r; return rest; }
    if (r.ra) { const { a, b, ...rest } = r; return rest; }
    return r;
  };
  // Every list the hook is handed (sprites, strokes, decals, scatter, ground, fauna, clouds and the rest).
  for (const s of Object.keys(o).sort()) if (Array.isArray(o[s])) row[s] = digest(o[s].map(gpu));
  const fl = o.floor;
  row.floor = fl ? digest(Object.fromEntries(Object.entries(fl).filter(([kk]) => kk !== 'tag' && kk !== 'wild' && kk !== 'lut'))) : '-';
  row.lut = fl && fl.lut ? digest(fl.lut) : '-';
  row.cells = digest((cells || []).map((c) => [c.gx, c.gy, c.wx, c.wy, c.seed, c.h, c.fh, c.jit, c.m && c.m.type, c.E]));
  row.canvas = digest(scene.takeLog());
  row.flocks = digest(scene.ws.lastFlockAnchors ? scene.ws.lastFlockAnchors() || [] : []);
  // --dump i sink: that frame's records, one per line, for diffing two runs by hand.
  if (Number(opt('--dump', -1)) === i) for (const r of o[opt('--sink', 'decals')] || []) console.error(JSON.stringify(r, (kk, v) => (kk[0] === '_' || kk === 'img' ? undefined : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
  console.log(JSON.stringify(row));
}
globalThis.performance = clock;
scene.close();
