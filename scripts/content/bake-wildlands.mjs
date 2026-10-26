// Bakes the wildlands field: content/map/wildlands.json + the placed surface tiles in
// content/zones → client/shared/wildlands-field.js.
//
// The ground between regions depends on how far a point is from each region, from the bay and from
// any land at all. Only the placed map knows that, and the server and every client have to agree
// about it to the tile, so it is baked into a module both can import rather than derived at
// runtime from whatever tiles one side happens to hold.
//
//   node scripts/content/bake-wildlands.mjs           write the module
//   node scripts/content/bake-wildlands.mjs --check   fail if the module is stale (pretest:regress)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWildlands, decodeReliefPlanes } from '../../client/shared/wildlands.js';
import { bakeRelief } from './relief-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'client', 'shared', 'wildlands-field.js');
const CELL = 4;          // tiles per baked cell; the fields are smooth, the noise adds the detail
const PAD = 70;          // wildlands drawn this far past the outermost placed tile
const SEA_PAD = 50;      // and this far north, for the open sea

const cfg = JSON.parse(readFileSync(join(ROOT, 'content', 'map', 'wildlands.json'), 'utf8'));
delete cfg._comment;
const routesFile = JSON.parse(readFileSync(join(ROOT, 'content', 'map', 'routes.json'), 'utf8'));
const routesCfg = routesFile.routes || {}, hwTypes = routesFile.types || {};
const voidsCfg = JSON.parse(readFileSync(join(ROOT, 'content', 'map', 'voids.json'), 'utf8')).voids || {};

const WATER = new Set(['water', 'hotspring']);
const tiles = [];
const zdir = join(ROOT, 'content', 'zones');
for (const f of readdirSync(zdir)) {
  if (!f.endsWith('.json')) continue;
  const z = JSON.parse(readFileSync(join(zdir, f), 'utf8'));
  if (z.map_id !== 'map_world' || (z.grid_z ?? 0) !== 0 || z.grid_x == null || z.grid_y == null) continue;
  const fl = z.flags || {};
  tiles.push({ x: z.grid_x, y: z.grid_y, r: fl.region_id || null, w: WATER.has(fl.terrain) || !!fl.swimmable, t: fl.terrain || null });
}
tiles.sort((a, b) => a.y - b.y || a.x - b.x);   // file order must not change the bake
if (!tiles.length) throw new Error('bake-wildlands: no placed map_world tiles');

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const t of tiles) { minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y); }
const X0 = minX - PAD, Y0 = minY - PAD - SEA_PAD, X1 = maxX + PAD, Y1 = maxY + PAD;
const TW = X1 - X0 + 1, TH = Y1 - Y0 + 1;

// The bay: water within `bayDepth` rows of the coast region's north edge. Inland water further
// south is a river or a pond and must not drag the sea off the map with it.
const coastRegion = cfg.coast?.region;
let coastTop = Infinity;
for (const t of tiles) if (t.r === coastRegion) coastTop = Math.min(coastTop, t.y);
if (!Number.isFinite(coastTop)) throw new Error(`bake-wildlands: coast region ${coastRegion} has no tiles`);
const coastY = coastTop + (cfg.coast.offset ?? 0);
const bayShoreY = coastTop + (cfg.coast.bayDepth ?? 14);

// Two-pass chamfer distance at tile resolution, carrying the nearest source's row.
function field(isSeed) {
  const N = TW * TH, d = new Float32Array(N).fill(1e9), sy = new Float32Array(N).fill(1e9), si = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (isSeed[i]) { d[i] = 0; sy[i] = (i / TW) | 0; si[i] = i; }
  const rl = (i, j, c) => { const n = d[j] + c; if (n < d[i]) { d[i] = n; sy[i] = sy[j]; si[i] = si[j]; } };
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = y * TW + x;
    if (y > 0) { rl(i, i - TW, 1); if (x > 0) rl(i, i - TW - 1, Math.SQRT2); if (x < TW - 1) rl(i, i - TW + 1, Math.SQRT2); }
    if (x > 0) rl(i, i - 1, 1);
  }
  for (let y = TH - 1; y >= 0; y--) for (let x = TW - 1; x >= 0; x--) {
    const i = y * TW + x;
    if (y < TH - 1) { rl(i, i + TW, 1); if (x < TW - 1) rl(i, i + TW + 1, Math.SQRT2); if (x > 0) rl(i, i + TW - 1, Math.SQRT2); }
    if (x < TW - 1) rl(i, i + 1, 1);
  }
  return { d, sy, si };
}
const seed = (pred) => { const s = new Uint8Array(TW * TH); for (const t of tiles) if (pred(t)) s[(t.y - Y0) * TW + (t.x - X0)] = 1; return s; };

const regions = Object.keys(cfg.halo || {});
// The terrain of every placed land tile, by grid index, so each wildlands point knows what the
// region edge it is nearest to is made of. Index 0 means "no terrain".
const TERR = ['', ...[...new Set(tiles.filter((t) => !t.w && t.t).map((t) => t.t))].sort()];
const terrAt = new Uint8Array(TW * TH);
for (const t of tiles) if (!t.w && t.t) terrAt[(t.y - Y0) * TW + (t.x - X0)] = TERR.indexOf(t.t);
const planes = {};
planes.land = field(seed((t) => !t.w));
planes.bay = field(seed((t) => t.w && t.y <= bayShoreY));
for (const r of regions) planes[r] = field(seed((t) => t.r === r));

// Sample every CELL tiles. Distances clamp at 255 tiles, which is past every reach.
const CW = Math.ceil(TW / CELL) + 1, CH = Math.ceil(TH / CELL) + 1;
function pack(fn) {
  const a = new Uint8Array(CW * CH);
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const tx = Math.min(TW - 1, cx * CELL), ty = Math.min(TH - 1, cy * CELL);
    a[cy * CW + cx] = Math.max(0, Math.min(255, Math.round(fn(ty * TW + tx, ty))));
  }
  return Buffer.from(a).toString('base64');
}
const out = {
  x0: X0, y0: Y0, x1: X1, y1: Y1, cell: CELL, cw: CW, ch: CH, coastY, bayShoreY,
  routes: routesCfg, voids: voidsCfg, hwTypes,
  halo: cfg.halo, landforms: cfg.landforms || [], edgeTerrains: TERR, edge: cfg.edge || {},
  // centres of each region, so a plume can be aimed "toward" one by id
  centres: Object.fromEntries(regions.map((r) => {
    let sx = 0, sy = 0, n = 0; for (const t of tiles) if (t.r === r) { sx += t.x; sy += t.y; n++; }
    return [r, n ? [sx / n, sy / n] : null];
  })),
  planes: {
    land: pack((i) => planes.land.d[i]),
    edge: pack((i) => (planes.land.si[i] >= 0 ? terrAt[planes.land.si[i]] : 0)),
    bay: pack((i) => planes.bay.d[i]),
    // how far SOUTH the nearest bay water is, +128; > 128 means it is south of you (offshore)
    baySouth: pack((i, ty) => 128 + Math.max(-127, Math.min(127, planes.bay.sy[i] - ty))),
    ...Object.fromEntries(regions.map((r) => [r, pack((i) => planes[r].d[i])])),
  },
};

// ── the relief (docs/proposals/wildlands-relief.md) ──
// Carved off the field built above, through a wildlands bound to IT rather than to the shipped
// module: the coast and the volcano are inputs to the carving, and the shipped module is the
// previous bake.
//
// Five planes on 2-tile cells: height (1/4000 of a tier, 16 bits), how layered the rock is,
// drainage on a log scale, moisture, and the depth of any pit fill (a dry lakebed). Each is stored
// as its residual from the gradient predictor (left + up - upleft, PNG's), which on a smooth
// surface is a small number, so brotli finds the smoothness: height's high byte is almost all
// zeros. Height went out as two row-deltas first and was 41 KB of the 101 KB the field cost.
if (cfg.relief) {
  const rc = { ...cfg.relief }; delete rc._comment;
  // Every pair of regions a highway joins gets a pass (see bakeRelief), sorted so the bake is stable.
  const links = [...new Set(Object.entries(voidsCfg).flatMap(([from, v]) => (v.dests || []).map((d) => [from, d.region].sort().join('~'))))].sort().map((k) => k.split('~'));
  const R = bakeRelief({ rect: { x0: X0, y0: Y0, x1: X1, y1: Y1 }, tiles, cfg: rc, wild: createWildlands(out), links });
  // ⚠ THE PRECISION IS WHAT THE BYTES ARE. The fine hills are real noise at 2-tile spacing, so every
  // bit of height kept below what anything can see is a bit brotli can't remove: 1/1000 of a tier
  // is 1/2000 of a world unit. Drainage below 2^6 is hillside trickle that no rule reads (a wash
  // starts at 900), and storing it was 18 KB.
  const q = { h: 1000, flow: 6, flowMin: 6, lake: 400, frac: 63 }, n = R.cw * R.ch, cw = R.cw;
  const q8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const hv = new Uint16Array(n), lay = new Uint8Array(n), flow = new Uint8Array(n), wet = new Uint8Array(n), lake = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    hv[i] = Math.max(0, Math.min(65535, Math.round(R.h[i] * q.h)));
    lay[i] = q8(R.layered[i] * q.frac);
    const lf = Math.log2(1 + R.flow[i]);
    flow[i] = lf >= q.flowMin ? q8((lf - q.flowMin) * q.flow) + 1 : 0;
    wet[i] = q8(R.moisture[i] * q.frac);
    lake[i] = q8(R.lake[i] * q.lake);
  }
  const pred = (a, i) => { const x = i % cw, l = x ? a[i - 1] : 0, u = i >= cw ? a[i - cw] : 0, ul = x && i >= cw ? a[i - cw - 1] : 0; return l + u - ul; };
  const b64 = (a) => Buffer.from(a).toString('base64');
  const hHi = new Uint8Array(n), hLo = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const r = (hv[i] - pred(hv, i)) & 0xffff; hHi[i] = r >> 8; hLo[i] = r & 255; }
  const res8 = (a) => { const r = new Uint8Array(n); for (let i = 0; i < n; i++) r[i] = (a[i] - pred(a, i)) & 255; return b64(r); };
  out.relief = {
    x0: X0, y0: Y0, cell: R.cell, cw: R.cw, ch: R.ch, zScale: rc.zScale ?? 0.5, dip: rc.dip ?? 0.5, caps: R.caps, rules: rc.rules || {}, roads: rc.roads || {}, q,
    planes: { hHi: b64(hHi), hLo: b64(hLo), layered: res8(lay), flow: res8(flow), wet: res8(wet), lake: res8(lake) },
  };
  // ⚠ THE GROUND IS FLAT UNDER EVERY PLACED TILE, read back through the reader the game uses. The
  // city, the airfields and the regions don't move, and this is the one place that holds every
  // placed tile without reading 17,000 zone files a second time (gl:wildlands runs --check).
  const back = createWildlands(out);
  const raised = tiles.filter((t) => back.groundZ(t.x, t.y) > 0.02);
  if (raised.length) {
    console.error(`✗ bake-wildlands: the relief lifts ${raised.length} placed tile(s), first at ${raised[0].x},${raised[0].y} (z ${back.groundZ(raised[0].x, raised[0].y).toFixed(3)})`);
    process.exit(1);
  }
}

const body = `// GENERATED by scripts/content/bake-wildlands.mjs from content/map/wildlands.json and the
// placed map_world tiles. Do not edit; run \`npm run wildlands:bake\`. Read through wildlands.js.
export const WILDLANDS_FIELD = ${JSON.stringify(out)};
`;

if (process.argv.includes('--check')) {
  // Line endings are ignored: with autocrlf a fresh Windows checkout writes this
  // file as CRLF, and the bake emits LF, so a byte compare called it stale.
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== body.replace(/\r\n/g, '\n') && !sameWithinRounding(cur, out)) { console.error('✗ client/shared/wildlands-field.js is stale — run npm run wildlands:bake'); process.exit(1); }
  console.log('✓ wildlands field is fresh');
} else {
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT} (${(body.length / 1024).toFixed(0)} KB, ${CW}x${CH} cells, rect ${X0},${Y0}–${X1},${Y1})`);
}

// ⚠ THE RELIEF IS COMPARED WITHIN A ROUNDING STEP. Its erosion is fed by the volcano, which runs
// Math.pow, atan2 and sin, and those may differ in the last bit between V8 versions; one flipped
// quantisation step in 56,000 cells would otherwise call a fresh field stale on CI. Everything else
// in the field is compared exactly.
function sameWithinRounding(curText, fresh) {
  const m = curText.match(/export const WILDLANDS_FIELD = (\{[\s\S]*\});\s*$/);
  if (!m) return false;
  let cur; try { cur = JSON.parse(m[1]); } catch { return false; }
  const strip = (f) => ({ ...f, relief: f.relief ? { ...f.relief, planes: null } : null });
  if (JSON.stringify(strip(cur)) !== JSON.stringify(strip(fresh))) return false;
  if (!cur.relief || !fresh.relief) return !cur.relief && !fresh.relief;
  const { cw, ch } = fresh.relief;
  const a = decodeReliefPlanes(cur.relief), b = decodeReliefPlanes(fresh.relief);
  for (let i = 0; i < cw * ch; i++) {
    if (Math.abs(a.h[i] - b.h[i]) > 2) return false;
    for (const k of ['layered', 'flow', 'wet', 'lake']) if (Math.abs(a[k][i] - b[k][i]) > 1) return false;
  }
  return true;
}
