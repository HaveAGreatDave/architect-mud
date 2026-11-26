// One-shot, after solenne-plates-fit.mjs: the Solenne's map grid and the two flats that changed landing.
//
//   node scripts/content/solenne-plates-grid.mjs
//
// zone_edges projects an edge between two rooms of a map that stand side by side on its grid, so each room's grid
// cell has to agree with its exits: on every floor (grid_z is the lift floor) the landing is at 0,-1, a flat west of
// it at -1,-1, east at 1,-1 and north at 0,-2; a room up a flat's stair stands over the flat. En-suites stand off to
// one side, touching nothing. And 16 and 18 (zone_solenne_apt_i and _h) keep the connection and hololock door they
// had on floors 8 and 10, pointed at their new landings. Safe to run twice.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const C = path.resolve(process.cwd(), 'content');
const file = (dir, id) => path.join(C, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const write = (dir, obj) => { const j = canonicalJson(obj); if (!fs.existsSync(file(dir, obj.id)) || fs.readFileSync(file(dir, obj.id), 'utf8') !== j) { fs.writeFileSync(file(dir, obj.id), j); n++; } };
let n = 0;
const S = (k) => `zone_solenne_${k}`;

// [zone, x, y, z]
const GRID = [
  ['hall_12', 0, -1, 2], ['gym', 0, -2, 2], ['hall_18', 0, -1, 3], ['salon', 0, -2, 3],
  ['residences', 0, -1, 4], ['apt_a', -1, -1, 4], ['apt_c', 1, -1, 4], ['apt_g', 0, -2, 4],
  ['residences_34', 0, -1, 5], ['apt_d', -1, -1, 5], ['apt_e', 1, -1, 5], ['apt_f', 0, -2, 5],
  ['hall_24', 0, -1, 6], ['apt_j', -1, -1, 6], ['apt_k', 1, -1, 6],
  ['hall_26', 0, -1, 8], ['apt_l', -1, -1, 8], ['apt_m', 1, -1, 8],
  ['hall_28', 0, -1, 10], ['apt_n', -1, -1, 10], ['apt_o', 1, -1, 10],
  ['hall_41', 0, -1, 14], ['aerie', 0, -2, 14],
  ['hall_u16', 0, -1, 16], ['apt_i', -1, -1, 16], ['apt_i_e', 1, -1, 16],
  ['hall_u18', 0, -1, 18], ['apt_h', -1, -1, 18], ['apt_h_e', 1, -1, 18],
  ...[[20, 'hall_34', 'p'], [22, 'hall_36', 'q'], [24, 'hall_38', 'b'], [26, 'hall_40r', 'r']].flatMap(([z, h, k]) => [[h, 0, -1, z], [`apt_${k}`, -1, -1, z], [`apt_${k}_e`, 1, -1, z], [`apt_${k}_up`, -1, -1, z + 1]]),
  ['ph_landing', 0, -1, 28], ['penthouse', -1, -1, 28], ['penthouse_e', 1, -1, 28],
  ['penthouse_2', -1, -1, 29], ['penthouse_3', -1, -1, 30], ['penthouse_4', -1, -1, 31],
  ['hall_45', 0, -1, 32], ['hall_40', 0, -1, 33], ['skydeck', -1, -1, 33], ['helipad', 1, -1, 33],
];
for (const [k, x, y, z] of GRID) {
  const zone = read('zones', S(k));
  if (zone.grid_x !== x || zone.grid_y !== y || zone.grid_z !== z) write('zones', { ...zone, grid_x: x, grid_y: y, grid_z: z });
}
// every en-suite off to the east of the map, one column each, touching nothing
let col = 0;
for (const f of fs.readdirSync(path.join(C, 'zones')).filter((f) => /^zone_solenne_.*_bath\.json$/.test(f)).sort()) {
  const b = JSON.parse(fs.readFileSync(path.join(C, 'zones', f), 'utf8')), parent = read('zones', b.parent_zone);
  const want = { grid_x: 10 + 2 * col++, grid_y: 5, grid_z: parent.grid_z };
  if (b.grid_x !== want.grid_x || b.grid_y !== want.grid_y || b.grid_z !== want.grid_z) write('zones', { ...b, ...want });
}

// 16 and 18: the old connection and door, pointed at the new landing; the one the fit made goes
for (const [k, old, made, hall] of [['i', 'conn_solenne_apt_i_west_bhpu', 'conn_solenne_apt_i_east_ji8o', 'hall_u16'], ['h', 'conn_solenne_apt_h_north_hmue', 'conn_solenne_apt_h_east_z8mt', 'hall_u18']]) {
  if (fs.existsSync(file('connections', old))) write('connections', { ...read('connections', old), a: S(`apt_${k}`), b: S(hall), dir: 'east' });
  if (fs.existsSync(file('connections', made))) { fs.unlinkSync(file('connections', made)); n++; }
  write('doors', { ...read('doors', `door_solenne_apt_${k}`), connection_id: old, exit_dir: 'east', target_zone: S(hall), zone_id: S(`apt_${k}`) });
}
console.log(`✓ solenne-plates-grid: ${n} files changed`);
