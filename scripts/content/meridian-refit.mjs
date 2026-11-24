// One-shot: the Meridian's flats cut from 24 to 14 so they fit the tower GLASS draws (the `meridian` arm in
// client/game/js/panels/glass/models/downtown.js). The model stays as it is; the rooms change to fit it.
//
//   node scripts/content/meridian-refit.mjs           write
//   node scripts/content/meridian-refit.mjs --dry     say what it would do, write nothing
//   then: node scripts/content/meridian-rooms.mjs     (each room's size, windows and text)
//
// The old plan put four 10 x 8 m flats round a 16 m hall on each of six floors: 43 m across on a 17.9 m tile, so
// the flats' windows hung in the air over Ration Nine. The tower at 919,908 is a 15.7 m shaft (window floors from
// 11.5 m), a 12.1 m setback (from 30.1 m) and an 8.6 m one (from 42.9 m). So:
//   - floor 1 is a mezzanine behind the frieze, with no flats; the model has no windows there;
//   - floors 2 to 6 keep their north and south flats (x01 and x03);
//   - floors 7, 8 and 9 are new landings, one flat each on the west side: units 102, 202 and 302 moved up;
//   - floor 10 is a new landing with the penthouse off it, two storeys: 402 below and 502 above, up its own stair.
//     It's Sir Charles's.
//   - units 101, 103, 104, 204, 304, 404, 504, 602 and 604 go, with their doors, connections, power and furniture.
// Every household that loses its flat moves: the bank's supervisor to Corbett Mansions 12B on Lever Lane, the rest
// to the Chrome's empty rooms. 402 and 502's households move too. npc_residences and each NPC's home_zone follow.
// Refuses to run twice: once floor 7 exists there's nothing to do.
import fs from 'node:fs';
import { canonicalJson } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const C = 'content/';
const P = (dir, id) => `${C}${dir}/${id}.json`;
const read = (dir, id) => JSON.parse(fs.readFileSync(P(dir, id), 'utf8'));
const has = (dir, id) => fs.existsSync(P(dir, id));
const M = (s) => `zone_meridian_${s}`;

if (has('zones', M('floor_7'))) { console.log('meridian-refit: already done'); process.exit(0); }

const writes = new Map(), drops = new Set();
const put = (dir, obj) => writes.set(P(dir, obj.id), obj);
const drop = (dir, id) => { if (!has(dir, id)) throw new Error(`no ${dir}/${id}`); drops.add(P(dir, id)); };
const listDir = (dir) => fs.readdirSync(C + dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(C + dir + '/' + f, 'utf8')));

// ── the households that move ─────────────────────────────────────────────────────────────────────────
const MOVE = {
  unit_103: 'zone_corbett_12b',
  unit_101: 'zone_mq_chrome_101', unit_104: 'zone_mq_chrome_102', unit_204: 'zone_mq_chrome_103', unit_304: 'zone_mq_chrome_104',
  unit_404: 'zone_mq_chrome_201', unit_504: 'zone_mq_chrome_202', unit_402: 'zone_mq_chrome_203', unit_502: 'zone_mq_chrome_204',
  unit_602: 'zone_mq_chrome_301',
};
const residences = listDir('npc_residences'), npcs = listDir('npcs');
const resAt = new Set(residences.map((r) => r.zone_id));
for (const [from, to] of Object.entries(MOVE)) {
  const old = M(from);
  if (resAt.has(to) || npcs.some((n) => n.home_zone === to)) throw new Error(`${to} isn't empty`);
  const r = residences.find((x) => x.zone_id === old);
  if (r) { put('npc_residences', { ...r, zone_id: to, id: to }); drop('npc_residences', old); }
  for (const n of npcs.filter((x) => x.home_zone === old || x.zone_id === old)) {
    const m = { ...n };
    if (m.home_zone === old) m.home_zone = to;
    if (m.zone_id === old) m.zone_id = to;
    put('npcs', m);
  }
}
// npc_residences rows carry no `id`: they're keyed by the file name, which is the zone
for (const [k, v] of writes) if (k.includes('/npc_residences/')) delete v.id;
// unit 604 has nobody; check nobody else lives in a unit that goes
const GONE = ['unit_101', 'unit_103', 'unit_104', 'unit_204', 'unit_304', 'unit_404', 'unit_504', 'unit_602', 'unit_604'];
for (const u of GONE) if (!MOVE[u] && (resAt.has(M(u)) || npcs.some((n) => n.home_zone === M(u)))) throw new Error(`${u} has a resident and nowhere to go`);

// ── the units that go: the zone and everything hung on it ───────────────────────────────────────────
const conns = listDir('connections'), doors = listDir('doors'), furn = listDir('furniture');
for (const u of GONE) {
  const id = M(u);
  drop('zones', id);
  if (has('power_zones', id)) drop('power_zones', id);
  for (const c of conns.filter((x) => x.a === id || x.b === id)) drop('connections', c.id);
  for (const d of doors.filter((x) => x.zone_id === id || x.target_zone === id)) drop('doors', d.id);
  for (const f of furn.filter((x) => x.zone_id === id)) drop('furniture', f.id);
}

// ── the landings ────────────────────────────────────────────────────────────────────────────────────
const zone = (id) => (writes.get(P('zones', id)) || read('zones', id));
const edit = (id, fn) => { const z = structuredClone(zone(id)); fn(z); put('zones', z); return z; };
const below = (n) => (n === 1 ? M('lobby') : M(`floor_${n - 1}`));
edit(M('floor_1'), (z) => { z.exits = { down: M('lobby'), up: M('floor_2') }; });
for (let n = 2; n <= 6; n++) edit(M(`floor_${n}`), (z) => { z.exits = { down: below(n), up: M(`floor_${n + 1}`), north: M(`unit_${n}01`), south: M(`unit_${n}03`) }; });

// floors 7 to 10, each a copy of floor 2's file with its own exits, power, light and stair door
const UNIT_AT = { 7: 'unit_102', 8: 'unit_202', 9: 'unit_302', 10: 'unit_402' };
const SUF = { 6: 'k2vt', 7: 'r8qe', 8: 'w3mz', 9: 'p6dn', 10: 'f4xa' };   // the new stair connections' ids, rolled once
const f2 = read('zones', M('floor_2')), pz2 = read('power_zones', M('floor_2')), light2 = read('furniture', 'furn_light_zone_meridian_floor_2');
const stair2 = read('doors', 'door_meridian_stair_f2');
for (let n = 7; n <= 10; n++) {
  const id = M(`floor_${n}`);
  put('zones', { ...structuredClone(f2), id, name: `The Meridian - Floor ${n} Landing`, grid_z: n,
    exits: { down: below(n), up: n === 10 ? M('roof') : M(`floor_${n + 1}`), west: M(UNIT_AT[n]) } });
  put('power_zones', { ...pz2, id, name: `The Meridian — Floor ${n} Landing` });
  put('furniture', { ...light2, id: `furn_light_zone_meridian_floor_${n}`, zone_id: id });
}
// the stairs up: floor 6's old connection to the roof now goes to floor 7, and each floor above gets its own
const stairConn = (n) => (n === 6 ? 'conn_meridian_floor_6_up_08bc' : `conn_meridian_floor_${n}_up_${SUF[n]}`);
for (let n = 6; n <= 10; n++) {
  const a = M(`floor_${n}`), b = n === 10 ? M('roof') : M(`floor_${n + 1}`);
  put('connections', { a, b, blocked: false, dir: 'up', id: stairConn(n), lockable: true, one_way: false });
  put('doors', { ...stair2, id: `door_meridian_stair_f${n}`, connection_id: stairConn(n), target_zone: b, zone_id: a });
}
edit(M('roof'), (z) => { z.exits = { down: M('floor_10') }; z.grid_z = 11; });

// ── the flats that move up: 102, 202, 302 to floors 7, 8, 9 and 402 to floor 10, each off the west side ──
const connOf = (id) => conns.find((c) => c.a === id || c.b === id);
for (const [n, u] of Object.entries(UNIT_AT)) {
  const id = M(u), hall = M(`floor_${n}`), c = connOf(id), d = doors.find((x) => x.zone_id === id);
  edit(id, (z) => { z.exits = u === 'unit_402' ? { east: hall, up: M('unit_502') } : { east: hall }; z.grid_x = -1; z.grid_y = 0; z.grid_z = Number(n); z.marker = String(n); });
  put('connections', { ...c, a: id, b: hall, dir: 'east' });
  put('doors', { ...d, exit_dir: 'east', target_zone: hall });
}
// the penthouse's upper floor: up its own stair from 402, no door of its own
{
  const id = M('unit_502'), c = connOf(id), d = doors.find((x) => x.zone_id === id);
  edit(id, (z) => { z.exits = { down: M('unit_402') }; z.grid_x = -1; z.grid_y = 0; z.grid_z = 11; z.marker = '11'; });
  put('connections', { ...c, a: id, b: M('unit_402'), dir: 'down', lockable: false });
  if (d) drop('doors', d.id);
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────────
for (const k of writes.keys()) drops.delete(k);
console.log(`meridian-refit: ${writes.size} files to write, ${drops.size} to delete`);
if (DRY) { for (const k of [...writes.keys()].sort()) console.log('  write', k); for (const k of [...drops].sort()) console.log('  delete', k); process.exit(0); }
for (const [file, obj] of writes) fs.writeFileSync(file, canonicalJson(obj), 'utf8');
for (const file of drops) fs.unlinkSync(file);
console.log('done; now run node scripts/content/meridian-rooms.mjs');
