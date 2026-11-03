// ONE-SHOT: re-site the buildings the Coliseum at true size displaces (docs/proposals/coliseum-true-size.md,
// phase 2).
//
//   node scripts/content/coliseum-resite.mjs [--write]
//
// Twenty-three buildings stand in the park's 11 by 11 square or on the new Halcyon Boulevard, and the
// Helipad stands on the boulevard too. Each moves to a new plot on the ground phase 1 took in, and
// keeps its id, name, keeper, interior, furniture and power row, so nothing that names it needs an
// edit. It keeps its entrance as well: a facade's hall has exits of its own, and turning the door
// round would collide with them. So each goes to a plot with a street on the side its door faces.
//
// A move is a swap: the building takes the plot's cell and the meadow tile on the plot takes the
// building's old cell, so no tile is created or deleted. Phase 3 sets the square aside whole.
//
//   - a facade's street link (the connection out of its door) is re-pointed at the new street, and
//     `world_exit_zone` with it;
//   - a sealed tower (a building with no door) loses its old walls and is walled on all four sides
//     where it lands;
//   - the cells the boulevard houses and the Helipad leave become Halcyon Boulevard, and a lane down
//     x 889 north of the boulevard, Vetch Mews, serves the houses that moved off the old mews.
//
// Then `exits` is rewritten from the projected graph, as phase 1 does, because content:lint holds the
// two edge for edge. It refuses to run twice: once the Helipad stands at 890,904 there's nothing to do.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, OPPOSITE, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const ZD = path.join(CONTENT_DIR, 'zones');
const CD = path.join(CONTENT_DIR, 'connections');
const REGION = 'region_coldwater';

// [from x, y, to x, y, building name]. The name is checked, so a map that moved under this refuses.
const MOVES = [
  // The boulevard's south side, as before, on the new boulevard west of the park.
  [892, 909, 887, 908, '1 Halcyon Boulevard'],
  [895, 909, 888, 908, '7 Halcyon Boulevard'],
  [896, 909, 890, 908, '9 Halcyon Boulevard'],
  [897, 909, 891, 908, '11 Halcyon Boulevard'],
  // East doors onto the new Vetch Mews, and the Helipad across the lane from them.
  [892, 913, 888, 906, '5 Vetch Mews'],
  [892, 912, 888, 905, '7 Vetch Mews'],
  [892, 914, 888, 904, '1 Sorrel Way'],
  [893, 909, 890, 904, 'Helipad'],
  // North doors onto the new Sorrel Way, facing the park; Fitz's across from the main gate.
  [893, 917, 888, 922, 'Halcyon West Halt'],
  [893, 911, 890, 922, 'Coldwater Recital Hall'],
  [895, 915, 892, 922, '4 Sorrel Way'],
  [892, 911, 894, 922, '2 Halcyon Boulevard'],
  [894, 911, 896, 922, "Fitz's Franks"],
  // East of the park: Kettle Lane runs on south to Sorrel Way, Windrow Lane along the north.
  [894, 912, 900, 919, "Pruitt's Peanuts & Pretzels"],
  [892, 917, 901, 919, '2 Kerbstone Row'],
  [894, 917, 902, 919, '6 Kerbstone Row'],
  [895, 917, 903, 919, '8 Kerbstone Row'],
  [896, 917, 904, 919, '10 Kerbstone Row'],
  [897, 917, 905, 919, '12 Kerbstone Row'],
  [894, 913, 898, 920, "Kimble's Souvenirs & Cards"],
  [894, 915, 900, 920, 'Halcyon Pavilion'],
  [896, 915, 902, 920, 'The Winter Garden'],
  [892, 915, 904, 920, '1 Kerbstone Row'],
  [897, 915, 906, 920, '15 Kerbstone Row'],
];

const readDir = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
const zones = readDir(ZD);
let conns = readDir(CD);
const byId = new Map(zones.map((z) => [z.id, z]));
const onWorld = (z) => z && z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
const reindex = () => { cell.clear(); for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z); };
reindex();
const at = (x, y) => cell.get(`${x},${y}`);

if (at(890, 904)?.name === 'Helipad') { console.log('The Helipad already stands at 890,904; nothing to do.'); process.exit(0); }

// ── 1. Check, then swap ─────────────────────────────────────────────────────
const plan = MOVES.map(([fx, fy, tx, ty, name]) => {
  const b = at(fx, fy), p = at(tx, ty);
  if (b?.name !== name) throw new Error(`${fx},${fy} should be ${name}, is ${b?.name}`);
  if (!p || p.flags?.building_type || p.flags?.facade || p.flags?.curtain || p.flags?.district === 'wilds' || p.flags?.terrain === 'road') {
    throw new Error(`${tx},${ty} is not an open plot: ${p?.id} ${p?.name}`);
  }
  return { b, p, fx, fy, tx, ty };
});
const movedIds = new Set();
for (const { b, p, fx, fy, tx, ty } of plan) {
  b.grid_x = tx; b.grid_y = ty; p.grid_x = fx; p.grid_y = fy;
  b._dirty = p._dirty = true;
  movedIds.add(b.id); movedIds.add(p.id);
}
reindex();

// ── 2. The new streets ──────────────────────────────────────────────────────
const boulevard = byId.get('zone_district_894_909');
const MEWS_DESC = [
  'A short cul-de-sac off the boulevard, block-paved and swept. The houses that stood on the old mews were moved here whole, numbers and all.',
  'Vetch Mews, new again: a paved lane with a turning circle at the end and bollards at the mouth. The street sign is the old one, bolted to a new post.',
];
const roadTile = (z, name, description, district) => {
  z.name = name;
  z.description = description;
  z.flags = { district, region_id: REGION, scavenging_table_id: 'scav_roadside_junk', street_life: true, terrain: 'road' };
  z.ambient_theme = 'city';
  z.ambient_events = [];
  delete z.color; delete z.bg_color; delete z.marker;
  z._dirty = true;
};
for (let x = 892; x <= 897; x++) {
  const z = at(x, 909);
  if (z && !z.flags?.building_type && z.flags?.terrain !== 'road') roadTile(z, 'Halcyon Boulevard', boulevard.description, 'glasshouse');
}
for (let y = 902; y <= 908; y++) roadTile(at(889, y), 'Vetch Mews', MEWS_DESC[y % 2], 'halcyon_fields');
roadTile(at(889, 909), 'Halcyon Boulevard + Vetch Mews', at(889, 909).description, 'glasshouse');

// ── 3. Doors and walls follow ───────────────────────────────────────────────
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest()
  .readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const dropped = [], minted = [], report = [];
for (const { b } of plan) {
  const f = b.flags || {};
  const mine = conns.filter((c) => (c.a === b.id || c.b === b.id) && onWorld(byId.get(c.a === b.id ? c.b : c.a)));
  if (f.facade) {
    const [dx, dy] = CARDINAL[f.entrance];
    const street = at(b.grid_x + dx, b.grid_y + dy);
    if (!street || street.flags?.terrain !== 'road') throw new Error(`${b.name}: no road ${f.entrance} of ${b.grid_x},${b.grid_y} (${street?.name})`);
    for (const c of mine) {
      if (c.blocked) { dropped.push(c.id); continue; }
      if (c.a === b.id && c.dir === f.entrance) { c.b = street.id; c._dirty = true; }
      else if (c.b === b.id && c.dir === OPPOSITE[f.entrance]) { c.a = street.id; c._dirty = true; }
      else throw new Error(`${b.name}: unexpected link ${c.id}`);
    }
    if (!mine.some((c) => !c.blocked)) throw new Error(`${b.name}: no street link to re-point`);
    if (f.world_exit_zone) { f.world_exit_zone = street.id; }
    report.push(`${b.name}: door ${f.entrance} onto ${street.name}`);
  } else if (f.building_type) {
    // Sealed: wall it in where it lands.
    for (const c of mine) dropped.push(c.id);
    for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
      const n = at(b.grid_x + dx, b.grid_y + dy);
      if (!n || (n.flags?.facade && n.flags.entrance !== OPPOSITE[dir])) continue;   // a facade is a wall already
      minted.push({ id: `conn_${slug(b.id)}_${dir}_${suffix(b.id, dir, n.id)}`, a: b.id, b: n.id, blocked: true, dir, lockable: false, one_way: false, _dirty: true });
    }
    report.push(`${b.name}: sealed, walled round at ${b.grid_x},${b.grid_y}`);
  } else {
    if (mine.length) throw new Error(`${b.name}: open ground with connections, not handled`);
    report.push(`${b.name}: open ground at ${b.grid_x},${b.grid_y}`);
  }
}
const droppedSet = new Set(dropped);
conns = conns.filter((c) => !droppedSet.has(c.id)).concat(minted);
for (const { p } of plan) if (conns.some((c) => c.a === p.id || c.b === p.id)) throw new Error(`${p.id} carried a connection into the square`);

// ── 4. Exits from the projected graph ───────────────────────────────────────
const strip = (o) => { const { _dirty, ...rest } = o; return rest; };
const { edges } = projectEdges(zones.map(strip), conns.map(strip));
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
let exitsChanged = 0;
const outside = [];
for (const z of zones) {
  const nx = out.get(z.id) || {};
  if (canonicalJson(z.exits || {}) === canonicalJson(nx)) continue;
  const inWindow = onWorld(z) && z.grid_x >= 884 && z.grid_x <= 912 && z.grid_y >= 900 && z.grid_y <= 924;
  if (!inWindow && !movedIds.has(z.id)) { outside.push(z.id); continue; }
  z.exits = nx;
  z._dirty = true;
  exitsChanged++;
}

for (const r of report) console.log('  ' + r);
console.log(`${plan.length} moved; connections: ${dropped.length} dropped, ${minted.length} walls minted; exits rewritten on ${exitsChanged} tile(s)`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const z of zones) if (z._dirty) fs.writeFileSync(path.join(ZD, `${z.id}.json`), canonicalJson(strip(z)), 'utf8');
for (const c of conns) if (c._dirty) fs.writeFileSync(path.join(CD, `${c.id}.json`), canonicalJson(strip(c)), 'utf8');
for (const id of dropped) fs.rmSync(path.join(CD, `${id}.json`), { force: true });
console.log('✓ written');
