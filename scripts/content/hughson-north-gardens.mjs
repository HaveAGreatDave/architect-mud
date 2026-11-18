// ONE-SHOT: the North Gardens, on the Hughson Court block north of the Coliseum.
//
//   node scripts/content/hughson-north-gardens.mjs [--write]
//
//         892 893 894 895 896 897
//  y 910   R  (Halcyon Boulevard frontage stays)
//  y 911   R   gv  ft  ft  gv  R        gv grove, ft fountain
//  y 912   R   pg  pt  pt  pg  R        pg pergola, pt parterre
//  y 913   R   F   F   F   F   R        F North Plaza (forecourt)
//  y 914   the Coliseum's north wall
//
// ⚠ NOTHING IS DELETED. The twelve buildings (eight sealed Hughson Court towers, 2, 9 and 11
// Hughson Way and the Sales Suite) go to the holding map on rows 25 and 27, a cell apart, and the ten Hughson Green and
// Vetch Green tiles waiting there come back to take their plots. Two more tiles are minted from a
// green. The four facades keep their rooms; their street links go and `world_exit_zone` points at
// the facade itself. The three NPCs who work inside take `flags.set_aside`.
//
// Walls and exits as in hughson-gardens.mjs. It refuses to run twice: once 893,913 isn't the
// Sales Suite there's nothing to do. Afterwards: content:import, snapshot-flight-world.mjs,
// shapes:bake, wildlands:bake, lite:bake.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world', HOLD = 'map_set_aside';
const FOCUS = { x: 894.5, y: 913.5 };   // the middle of the Coliseum's north wall, in front of the block
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {}, raw = new Map();
for (const t of ['zones', 'connections', 'power_zones', 'npcs']) {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json')).map((f) => {
    const s = fs.readFileSync(path.join(dirOf(t), f), 'utf8');
    raw.set(`${t}/${f.slice(0, -5)}`, s);
    return [f.slice(0, -5), JSON.parse(s)];
  }));
}
const dirty = new Set();
const touch = (t, file) => dirty.add(`${t}/${file}`);
const zones = [...tables.zones.values()];
const byId = tables.zones;
const onWorld = (z) => z && z.map_id === WORLD && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
const reindex = () => { cell.clear(); for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z); };
reindex();
const at = (x, y) => cell.get(`${x},${y}`);
const dirtyZone = (z) => touch('zones', z.id);

// ── 1. The tiles ────────────────────────────────────────────────────────────
if (at(893, 913)?.name !== 'Halcyon Sales Suite') { console.log('893,913 is no longer the Sales Suite; nothing to do.'); process.exit(0); }
const PLAN = {
  911: ['grove', 'fountain', 'fountain', 'grove'],
  912: ['pergola', 'parterre', 'parterre', 'pergola'],
  913: ['forecourt', 'forecourt', 'forecourt', 'forecourt'],
};
const PLOTS = [];
for (const y of [911, 912, 913]) for (let i = 0; i < 4; i++) {
  const x = 893 + i, b = at(x, y);
  if (!b?.flags?.building_type) throw new Error(`${x},${y} should be a building, is ${b?.id} ${b?.name}`);
  PLOTS.push({ x, y, feature: PLAN[y][i], b });
}
const GREENS = ['zone_ballpark_893_910', 'zone_ballpark_893_914', 'zone_ballpark_894_910', 'zone_ballpark_894_914',
  'zone_ballpark_895_910', 'zone_ballpark_895_914', 'zone_ballpark_896_910',
  'zone_district_895_912', 'zone_district_896_912', 'zone_district_897_912'].map((id) => {
  const z = byId.get(id);
  if (!z || z.map_id !== HOLD || !z.flags?.set_aside) throw new Error(`${id} isn't a set-aside green`);
  return z;
});
// Two more, minted from the first green.
for (const id of ['zone_northgardens_1', 'zone_northgardens_2']) {
  if (byId.has(id)) throw new Error(`${id} exists`);
  const z = JSON.parse(JSON.stringify(GREENS[0]));
  z.id = id; z.grid_x = null; z.grid_y = null;
  zones.push(z); byId.set(id, z);
  const pw = JSON.parse(JSON.stringify(tables.power_zones.get(GREENS[0].id)));
  pw.id = id; tables.power_zones.set(id, pw); touch('power_zones', id);
  GREENS.push(z);
}
PLOTS.forEach((p, i) => { p.g = GREENS[i]; });
const moved = new Set(PLOTS.flatMap((p) => [p.g.id, p.b.id]));

// ── 2. The buildings go to the holding map, row 25 ──────────────────────────
for (let i = 0; i < PLOTS.length; i++) {
  const hx = 1 + 2 * (i % 6), hy = 25 + 2 * Math.floor(i / 6);
  const taken = zones.find((z) => z.map_id === HOLD && z.grid_x === hx && z.grid_y === hy);
  if (taken) throw new Error(`holding cell ${hx},${hy} holds ${taken.id}`);
}
const dropped = [];
PLOTS.forEach(({ x, y, b }, i) => {
  b.flags.set_aside = true;
  b.flags.set_aside_from = `${x},${y}`;
  b.map_id = HOLD; b.grid_x = 1 + 2 * (i % 6); b.grid_y = 25 + 2 * Math.floor(i / 6);
  if (b.flags.facade) {
    const link = [...tables.connections.values()].find((c) => (c.a === b.id || c.b === b.id) && !c.blocked
      && byId.get(c.a === b.id ? c.b : c.a)?.map_id === WORLD && onWorld(byId.get(c.a === b.id ? c.b : c.a)));
    if (link) { dropped.push(link.id); tables.connections.delete(link.id); }
    b.flags.world_exit_zone = b.id;
  }
  dirtyZone(b);
});
for (const id of ['npc_hf_marchetti', 'npc_hf_salad_okonjo', 'npc_wind_marchbank']) {
  const n = tables.npcs.get(id);
  if (!n) throw new Error(`${id} missing`);
  n.flags = { ...(n.flags || {}), set_aside: true };
  touch('npcs', id);
}

// ── 3. The gardens ──────────────────────────────────────────────────────────
const PROSE = {
  grove: "The North Gardens, a stand of plane trees at the corner with benches under them. The Coliseum's north wall shows through the leaves.",
  fountain: "The North Gardens, a limestone fountain in two tiers with a gilt sun on top and yews in planters at the corners. On game nights there are ticket stubs in the water.",
  pergola: 'The North Gardens, a pergola of limestone piers and timber with wisteria hanging through. There are benches underneath and lavender along the edges.',
  parterre: "The North Gardens, a parterre of clipped box fanned out toward the Coliseum and planted red, white and gold. There's a sign asking you not to sit on the hedges.",
  forecourt: "North Plaza, granite flags along the Coliseum's north wall with a bronze lamp standard every few steps. The gardens are on the north side.",
};
const EVENTS = [
  'The fountains drop for a second, then come back up.',
  'A groundskeeper picks ticket stubs out of a hedge one at a time.',
  'Somebody eats a hot dog on a bench and watches the Coliseum wall.',
];
for (const { x, y, feature, g } of PLOTS) {
  g.map_id = WORLD; g.grid_x = x; g.grid_y = y; g.grid_z = 0;
  delete g.flags.set_aside; delete g.flags.set_aside_from;
  g.flags.terrain = 'park';
  g.flags.park_feature = feature;
  g.flags.park_focus = { ...FOCUS };
  g.flags.street_life = true;
  g.name = feature === 'forecourt' ? 'North Plaza' : 'North Gardens';
  g.description = PROSE[feature];
  g.ambient_events = EVENTS.slice();
  g.ambient_theme = 'urban';
  g.color = '#8fd08a';
  dirtyZone(g);
  const row = tables.power_zones.get(g.id);
  if (row && row.name !== g.name) { row.name = g.name; touch('power_zones', g.id); }
}
reindex();
for (const { x, y, g } of PLOTS) if (at(x, y) !== g) throw new Error(`${x},${y} holds two tiles`);

// ── 4. Walls ────────────────────────────────────────────────────────────────
const sealed = (z) => !!z?.flags?.building_type && !z.flags.facade;
const dirBetween = (a, b) => {
  if (!onWorld(a) || !onWorld(b)) return null;
  for (const [d, [dx, dy]] of Object.entries(CARDINAL)) if (a.grid_x + dx === b.grid_x && a.grid_y + dy === b.grid_y) return d;
  return null;
};
for (const [id, c] of [...tables.connections]) {
  if (!c.blocked || !(moved.has(c.a) || moved.has(c.b))) continue;
  const a = byId.get(c.a), b = byId.get(c.b);
  if (dirBetween(a, b) === c.dir && (sealed(a) || sealed(b))) continue;
  dropped.push(id);
  tables.connections.delete(id);
}
const pair = (a, b) => [a, b].sort().join('~');
const spoken = new Set([...tables.connections.values()].map((c) => pair(c.a, c.b)));
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const minted = [];
for (const e of projectEdges(zones, [...tables.connections.values()]).edges) {
  if (e.kind !== 'grid' || !(moved.has(e.from_zone) || moved.has(e.to_zone))) continue;
  if (!onWorld(byId.get(e.from_zone)) || !onWorld(byId.get(e.to_zone))) continue;
  if (!sealed(byId.get(e.from_zone)) && !sealed(byId.get(e.to_zone))) continue;
  const key = pair(e.from_zone, e.to_zone);
  if (spoken.has(key)) continue;
  spoken.add(key);
  const id = `conn_${slug(e.from_zone)}_${e.direction}_${suffix(e.from_zone, e.direction, e.to_zone)}`;
  if (tables.connections.has(id) || fs.existsSync(path.join(dirOf('connections'), `${id}.json`))) throw new Error(`${id} already exists`);
  tables.connections.set(id, { a: e.from_zone, b: e.to_zone, blocked: true, dir: e.direction, id, lockable: false, one_way: false });
  touch('connections', id);
  minted.push(id);
}

// ── 5. Exits from the projected graph ───────────────────────────────────────
const { edges } = projectEdges(zones, [...tables.connections.values()]);
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
  const near = onWorld(z) && z.grid_x >= 891 && z.grid_x <= 898 && z.grid_y >= 909 && z.grid_y <= 915;
  if (!near && !moved.has(z.id)) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── 6. Check, then write ────────────────────────────────────────────────────
for (const key of dirty) {
  const was = raw.get(key);
  if (was != null && canonicalJson(JSON.parse(was)) !== was) throw new Error(`${key} isn't canonical on disk`);
}
for (const { g } of PLOTS) if (Object.keys(g.exits || {}).length < 2) throw new Error(`${g.id} is cut off: ${JSON.stringify(g.exits)}`);
console.log(`12 buildings set aside, 12 garden tiles; walls: ${dropped.length} dropped, ${minted.length} minted; exits on ${exitsChanged} tile(s); ${dirty.size} files`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) elsewhere disagree with the projection (left alone)`);
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
for (const id of dropped) fs.rmSync(path.join(dirOf('connections'), `${id}.json`), { force: true });
console.log('✓ written');
