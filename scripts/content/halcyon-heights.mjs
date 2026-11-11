// ONE-SHOT: move the two-shaft tower off 1 River Road into the ridge north of Halcyon Boulevard,
// and put a mid-sized block on 1 River Road (docs/proposals/hughson-towers.md, "Halcyon Heights").
//
//   node scripts/content/halcyon-heights.mjs [--write]
//
// David, 2026-11-09: the fifty storeys at 887,910 stood over the Coliseum's left-field corner. They go
// to 887,907 on the River Road, among 1 Halcyon Boulevard, 7 Vetch Mews and the Spire, and 887,910
// drops to ten storeys. The tower is a sealed tile like the rest of the Hughson towers: `is_building`
// with no `facade`, walled with a blocked connection on every grid edge, exits rewritten from the
// projected graph. It refuses to run twice: once 887,907 is a building there's nothing to do.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const dirOf = (t) => path.join(CONTENT_DIR, t);
const tables = {};
for (const t of ['zones', 'connections']) {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json'))
    .map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dirOf(t), f), 'utf8'))]));
}
const dirty = new Set();
const zones = [...tables.zones.values()];
const onWorld = (z) => z && z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
for (const z of zones) if (onWorld(z) && !cell.has(`${z.grid_x},${z.grid_y}`)) cell.set(`${z.grid_x},${z.grid_y}`, z);
const byId = (id) => tables.zones.get(id) || (() => { throw new Error(`no zone ${id}`); })();

const tower = byId('zone_district_887_907');
const old = byId('zone_ballpark_887_910');
if (tower.flags?.is_building) { console.log('887,907 is already a building; nothing to do.'); process.exit(0); }
if (old.flags?.floors !== 50) throw new Error(`887,910 is ${old.flags?.floors} storeys, not the 50 this expects`);
for (const c of tables.connections.values()) if (c.a === tower.id || c.b === tower.id) throw new Error(`${tower.id} carries a connection: ${c.id}`);

// ── 1. The tower on 887,907 ─────────────────────────────────────────────────
const MARKER_NEW = 'R1';
if (zones.some((z) => z.marker === MARKER_NEW)) throw new Error(`map code ${MARKER_NEW} is taken`);
tower.name = 'Halcyon Heights';
tower.description = 'Two unequal glass shafts off one podium, tied together by glazed links high up, fifty storeys in all. The upper link is a residents\' lounge, and from the River Road you can see one person in it.';
tower.ambient_theme = 'urban';
tower.ambient_events = [];
delete tower.color; delete tower.bg_color;
tower.marker = old.marker;   // Q1 goes with the tower
tower.flags = {
  building_name: 'Halcyon Heights', building_type: 'sky_court', district: 'halcyon_fields',
  entrance: 'west', floors: 50, is_building: true, region_id: 'region_coldwater',
};
dirty.add(`zones/${tower.id}`);

// ── 2. A ten-storey block on 1 River Road ────────────────────────────────────
old.description = 'Ten storeys of glass stepped back in a sawtooth, each step a terrace with a planter on it. From the top terrace you can see over the left-field wall into the Coliseum.';
old.marker = MARKER_NEW;
old.flags = { ...old.flags, building_type: 'cascade_block', floors: 10 };
dirty.add(`zones/${old.id}`);

// ── 3. Prose that stopped being true ─────────────────────────────────────────
const prose = [
  ['zone_district_888_907', 'A Halcyon board on two posts says the plot is sold, and a sticker under it says it\'s sold again.',
    'Halcyon Heights stands next door, and its podium\'s shadow lies across the grass all afternoon.'],
];
for (const [id, from, to] of prose) {
  const z = byId(id);
  if (!z.description.includes(from)) throw new Error(`${id}: "${from}" not found`);
  z.description = z.description.replace(from, to);
  dirty.add(`zones/${id}`);
}

// ── 4. Walls, then exits from the projected graph ───────────────────────────
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const walled = new Set();
for (const e of projectEdges(zones, [...tables.connections.values()]).edges) {
  if (e.kind !== 'grid' || !(e.from_zone === tower.id || e.to_zone === tower.id)) continue;
  const pair = [e.from_zone, e.to_zone].sort().join('~');
  if (walled.has(pair)) continue;
  walled.add(pair);
  const id = `conn_${e.from_zone.replace(/^zone_/, '')}_${e.direction}_${suffix(e.from_zone, e.direction, e.to_zone)}`;
  if (tables.connections.has(id)) throw new Error(`${id} already exists`);
  tables.connections.set(id, { a: e.from_zone, b: e.to_zone, blocked: true, dir: e.direction, id, lockable: false, one_way: false });
  dirty.add(`connections/${id}`);
}
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
  const inWindow = onWorld(z) && z.grid_x >= 885 && z.grid_x <= 889 && z.grid_y >= 905 && z.grid_y <= 909;
  if (!inWindow) { outside.push(z.id); continue; }
  z.exits = nx;
  dirty.add(`zones/${z.id}`);
  exitsChanged++;
}

for (const key of dirty) {
  const [t, file] = key.split('/');
  if (t !== 'zones') continue;
  const d = String(tables.zones.get(file).description);
  if (d.includes('—')) throw new Error(`${file}: em dash`);
}
console.log(`${walled.size} walls; exits rewritten on ${exitsChanged} tile(s); ${dirty.size} files:`, [...dirty]);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
console.log('written');
