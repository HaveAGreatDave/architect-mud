// ONE-SHOT: move 2 Halcyon Boulevard off Sorrel Way onto the River Road ridge, put Kimble's
// Souvenirs & Cards on its plot beside Fitz's Franks, and make Kimble's old plot a garden
// (docs/proposals/hughson-towers.md, "2 Halcyon Boulevard").
//
//   node scripts/content/twin-tower-ridge.mjs [--write]
//
// David, 2026-11-09. A three-way rotation, so no zone file is created or deleted and every id stays:
//
//   2 Halcyon Boulevard  896,922 -> 887,904   door turned north -> west, onto the River Road (886,904)
//   Kimble's             898,920 -> 896,922   door turned south -> north, onto Sorrel Way (896,921)
//   887,904's meadow     887,904 -> 898,920   Windrow Corner's second tile, walled from 27 Hughson Way
//
// Turning a door: the facade's street link and its link into the building change direction, and
// the rooms behind it take the mirror. 2 Halcyon Boulevard's lobby has only up and down besides, and
// Kimble's shop has its stock room, which goes to the far side. The connection ids stay, though the
// direction in their names now reads backwards: renaming means deleting files.
//
// Then sealed neighbours are walled, and `exits` is rewritten from the projected graph inside the
// touched windows, because content:lint holds the two edge for edge. Each prose edit names the text
// it replaces. It refuses to run twice: once 887,904 is a building there's nothing to do.
// Afterwards: content:import, building-stage.mjs, wildlands:bake, snapshot-flight-world.mjs.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const dirOf = (t) => path.join(CONTENT_DIR, t);
const tables = {};
for (const t of ['zones', 'connections']) {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json'))
    .map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dirOf(t), f), 'utf8'))]));
}
const dirty = new Set();
const touch = (t, id) => dirty.add(`${t}/${id}`);
const zones = [...tables.zones.values()];
const byId = (id) => tables.zones.get(id) || (() => { throw new Error(`no zone ${id}`); })();
const conn = (id) => tables.connections.get(id) || (() => { throw new Error(`no connection ${id}`); })();
const onWorld = (z) => z && z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
const reindex = () => { cell.clear(); for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z); };
reindex();
const at = (x, y) => cell.get(`${x},${y}`);

const need = (x, y, id, test, what) => {
  const z = at(x, y);
  if (!z || z.id !== id || !test(z)) throw new Error(`${x},${y} should be ${what} (${id}), is ${z?.id} ${z?.name}`);
  return z;
};
if (at(887, 904)?.flags?.is_building) { console.log('887,904 is already a building; nothing to do.'); process.exit(0); }

const TWOHB = need(896, 922, 'zone_district_892_911', (z) => z.flags?.facade && z.name === '2 Halcyon Boulevard' && z.flags.entrance === 'north', '2 Halcyon Boulevard');
const KIM = need(898, 920, 'zone_parkside_894_913', (z) => z.flags?.facade && z.name === "Kimble's Souvenirs & Cards" && z.flags.entrance === 'south', "Kimble's");
const MEADOW = need(887, 904, 'zone_district_887_904', (z) => !z.flags?.is_building && z.flags?.terrain === 'grass', 'meadow');
const RIVER = need(886, 904, 'zone_district_886_904', (z) => z.flags?.terrain === 'road', 'the River Road');
const SORREL = need(896, 921, 'zone_district_896_921', (z) => z.flags?.terrain === 'road', 'Sorrel Way');
const TOWER27 = need(897, 920, 'zone_ballpark_891_920', (z) => z.flags?.is_building && !z.flags.facade, '27 Hughson Way');
for (const c of tables.connections.values()) if (c.a === MEADOW.id || c.b === MEADOW.id) throw new Error(`${MEADOW.id} carries a connection: ${c.id}`);

// ── 1. The rotation ─────────────────────────────────────────────────────────
const moves = [[TWOHB, 887, 904], [KIM, 896, 922], [MEADOW, 898, 920]];
for (const [z, x, y] of moves) { z.grid_x = x; z.grid_y = y; touch('zones', z.id); }
reindex();
for (const [z, x, y] of moves) if (at(x, y) !== z) throw new Error(`${x},${y} holds two tiles`);
const moved = new Set(moves.map(([z]) => z.id));

// ── 2. Doors ────────────────────────────────────────────────────────────────
// [link, expect a, expect b, expect dir, new b, new dir]
const LINKS = [
  ['conn_hf_district_892_911_north', TWOHB.id, 'zone_district_896_921', 'north', RIVER.id, 'west'],
  ['conn_hf_district_892_911_south', TWOHB.id, 'zone_hf_common_lobby', 'south', null, 'east'],
  ['conn_hf_parkside_894_913_south', KIM.id, 'zone_district_898_921', 'south', SORREL.id, 'north'],
  ['conn_hf_parkside_894_913_north', KIM.id, 'zone_kimble_shop', 'north', null, 'south'],
  ['conn_hf_kimble_shop_north', 'zone_kimble_shop', 'zone_kimble_stock', 'north', null, 'south'],
];
for (const [id, a, b, dir, nb, nd] of LINKS) {
  const c = conn(id);
  if (c.a !== a || c.b !== b || c.dir !== dir || c.blocked) throw new Error(`${id} should be ${a} ${dir} ${b}, is ${c.a} ${c.dir} ${c.b}`);
  if (nb) c.b = nb;
  c.dir = nd;
  touch('connections', id);
}
TWOHB.flags.entrance = 'west';
TWOHB.flags.world_exit_zone = RIVER.id;
KIM.flags.entrance = 'north';
KIM.flags.world_exit_zone = SORREL.id;

// ── 3. The garden on 898,920 ────────────────────────────────────────────────
MEADOW.name = 'Windrow Corner';
MEADOW.ambient_theme = 'urban';
MEADOW.description = 'The rest of Windrow Corner, on Sorrel Way where Kimble\'s stood: a gravel path, two benches and a bed of low shrubs. 27 Hughson Way\'s blank side wall closes it on the west.';
MEADOW.flags = { district: 'halcyon_fields', park_feature: 'benches', region_id: 'region_coldwater', street_life: true, terrain: 'park' };

// ── 4. Walls ────────────────────────────────────────────────────────────────
// A sealed tile is walled on every side a neighbour could walk in from. Drop a wall that no longer
// joins two adjacent tiles, then wall every grid edge between a moved tile and a sealed one.
const sealed = (z) => !!z?.flags?.building_type && !z.flags.facade;
const dirBetween = (a, b) => {
  if (!onWorld(a) || !onWorld(b)) return null;
  for (const [d, [dx, dy]] of Object.entries(CARDINAL)) if (a.grid_x + dx === b.grid_x && a.grid_y + dy === b.grid_y) return d;
  return null;
};
const dropped = [];
for (const [id, c] of [...tables.connections]) {
  if (!c.blocked || !(moved.has(c.a) || moved.has(c.b))) continue;
  const a = byId(c.a), b = byId(c.b);
  if (dirBetween(a, b) === c.dir && (sealed(a) || sealed(b))) continue;
  dropped.push(id);
}
if (dropped.length) throw new Error(`walls that would need deleting (do it by hand, import first): ${dropped.join(', ')}`);
const pair = (a, b) => [a, b].sort().join('~');
const spoken = new Set([...tables.connections.values()].map((c) => pair(c.a, c.b)));
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const minted = [];
for (const e of projectEdges(zones, [...tables.connections.values()]).edges) {
  if (e.kind !== 'grid' || !(moved.has(e.from_zone) || moved.has(e.to_zone))) continue;
  if (!sealed(byId(e.from_zone)) && !sealed(byId(e.to_zone))) continue;
  const key = pair(e.from_zone, e.to_zone);
  if (spoken.has(key)) continue;
  spoken.add(key);
  const id = `conn_${slug(e.from_zone)}_${e.direction}_${suffix(e.from_zone, e.direction, e.to_zone)}`;
  if (tables.connections.has(id) || fs.existsSync(path.join(dirOf('connections'), `${id}.json`))) throw new Error(`${id} already exists`);
  tables.connections.set(id, { a: e.from_zone, b: e.to_zone, blocked: true, dir: e.direction, id, lockable: false, one_way: false });
  touch('connections', id);
  minted.push(id);
}
if (!minted.some((id) => { const c = tables.connections.get(id); return pair(c.a, c.b) === pair(TOWER27.id, MEADOW.id); })) {
  throw new Error('no wall minted between 27 Hughson Way and the garden');
}

// ── 5. Prose ────────────────────────────────────────────────────────────────
const PROSE = [
  ['zone_district_896_921', 'On the south side 2 Halcyon Boulevard stands back behind a bare forecourt.',
    'On the south side is Kimble\'s Souvenirs & Cards, with pennants in the window.'],
  ['zone_district_897_922', 'beside 2 Halcyon Boulevard', 'beside Kimble\'s Souvenirs & Cards'],
  ['zone_district_898_919', 'Kettle Lane, behind Kimble\'s:', 'Kettle Lane:'],
  ['zone_district_886_904', 'like a fridge in another room.',
    'like a fridge in another room. On the east side 2 Halcyon Boulevard stands back behind a bare forecourt.'],
];
for (const [id, from, to] of PROSE) {
  const z = byId(id);
  if (!z.description.includes(from)) throw new Error(`${id}: "${from}" not found`);
  z.description = z.description.replace(from, to);
  touch('zones', id);
}

// ── 6. Exits from the projected graph ───────────────────────────────────────
const { edges } = projectEdges(zones, [...tables.connections.values()]);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
const ROOMS = new Set(['zone_hf_common_lobby', 'zone_hf_common_bridge', 'zone_util_zone_hf_common_lobby', 'zone_kimble_shop', 'zone_kimble_stock', 'zone_util_zone_kimble_shop']);
const WINDOWS = [[885, 889, 902, 906], [894, 900, 918, 924]];
const inWindow = (z) => ROOMS.has(z.id) || (onWorld(z) && WINDOWS.some(([x0, x1, y0, y1]) => z.grid_x >= x0 && z.grid_x <= x1 && z.grid_y >= y0 && z.grid_y <= y1));
let exitsChanged = 0;
const outside = [];
for (const z of zones) {
  const nx = out.get(z.id) || {};
  if (canonicalJson(z.exits || {}) === canonicalJson(nx)) continue;
  if (!inWindow(z)) { outside.push(z.id); continue; }
  z.exits = nx;
  touch('zones', z.id);
  exitsChanged++;
}

for (const key of dirty) {
  const [t, id] = key.split('/');
  if (t === 'zones' && String(tables.zones.get(id).description || '').includes('—')) throw new Error(`${id}: em dash`);
}
console.log(`walls minted: ${minted.join(', ') || 'none'}; exits rewritten on ${exitsChanged} zone(s); ${dirty.size} files:`, [...dirty]);
if (outside.length) console.log(`⚠ ${outside.length} zone(s) outside the windows disagree with the projection (left alone):`, outside.slice(0, 10));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, id] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${id}.json`), canonicalJson(tables[t].get(id)), 'utf8');
}
console.log('written');
