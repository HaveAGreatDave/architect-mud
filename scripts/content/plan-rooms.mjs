// Rooms from a building's plan (docs/proposals/model-plan.md, phase 3): reads a plan, lays its rooms out
// (client/shared/building-plan.js), furnishes them with a starting kit (client/shared/room-kits.js) and writes the
// content files straight into content/. Review is the git diff: commit what you like, leave the rest.
//
//   node scripts/content/plan-rooms.mjs <plan.json> [--seed <text>]   into content/, for a building with no rooms yet;
//                   refuses one that has them
//   ... --replace   over a building's rooms: a file with the same id keeps its name, its prose and
//                   the flags the generator doesn't own, a door between the same two rooms keeps its file, and
//                   furniture a person placed stays (its room gets no kit). Nothing is deleted: rooms, doors and
//                   generated furniture the new layout leaves over, and the people living in those rooms, are listed
//                   (and written to left-over.txt in the run folder) for a person to set aside or delete.
//   ... --dry       writes nothing to content/: only the report, and a copy of the files in the run folder
//   ... --undo      puts back what the last run of this plan wrote: deletes the files it added and restores the ones
//                   it changed, leaving alone (and listing) any edited since. It reads the run folder's manifest.json.
// It never imports or commits, and refuses if the Stage's check below fails.
//
// Undo matters because the tree is shared: `git checkout -- <file>` would also throw away somebody else's unstaged
// work in that file, and deleting ninety new files by hand is easy to get wrong.
//
// Plans live in scripts/content/plans/, written by hand until phase 2 records them from the models. The run folder
// is plan-out/<slug>/ in the system's temp folder (or --out), outside the repo; it holds the copy, the manifest and
// left-over.txt. Each run empties it, so --undo reaches back one run.
//
// What it writes: maps/, zones/ (the lobby, the landings and halls, every flat and room, the utility room under the
// lobby), connections/ (one a door and one a climb, and the street door) and furniture/ (the kit, `flags.gen`). Names
// are plain defaults and descriptions are empty: prose, people, `npc_residences`, lights and `power_zones` stay
// authored.
//
// Then it checks its own output the way the Building Stage will draw it: builds the building's graph and plan
// (client/shared/building-graph.js) from the files, and fails if a room lands anywhere but where the plan put it,
// or the graph or the plan has a defect. And it prints a report: the floors as text, where the core went, the
// choices the seed made and the bracket, so a reviewer reads one screen before the JSON.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { planRooms, roomFrame, drawFloor, BEARING, OPP } from '../../client/shared/building-plan.js';
import { kitFor, bracketOf, finishFor } from '../../client/shared/room-kits.js';
import { buildingGraph, buildingDefects, buildingLayout, zoneSpecOf } from '../../client/shared/building-graph.js';
import { flightOf } from '../../client/shared/room-layout.js';
import { canonicalJson } from './lib.mjs';

const args = process.argv.slice(2);
const planPath = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--seed');
if (!planPath) { console.error('usage: node scripts/content/plan-rooms.mjs <plan.json> [--replace | --dry | --undo] [--seed <text>] [--out <dir>]'); process.exit(2); }
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const C = path.resolve(process.cwd(), 'content');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const seed = opt('--seed') || plan.facade;
const OUT = path.resolve(opt('--out') || path.join(os.tmpdir(), 'plan-out', plan.slug || 'plan'));

const fail = (why) => { console.error(`plan-rooms: ${why}`); process.exit(1); };

// --undo: the last run's manifest, each file put back only if nobody has touched it since
if (args.includes('--undo')) {
  const mf = path.join(OUT, 'manifest.json');
  if (!fs.existsSync(mf)) fail(`no manifest at ${mf}: nothing to undo`);
  const { files: done } = JSON.parse(fs.readFileSync(mf, 'utf8'));
  let n = 0;
  const skipped = [];
  for (const { file, before, after } of done) {
    const p = path.join(C, file), now = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (now !== after) { skipped.push(file); continue; }
    if (before === null) fs.rmSync(p); else fs.writeFileSync(p, before);
    n++;
  }
  console.log(`undid ${n} of ${done.length} files`);
  if (skipped.length) { console.log(`left alone, edited since the run (${skipped.length}):`); for (const f of skipped) console.log(`  content/${f}`); }
  fs.rmSync(mf);
  process.exit(0);
}
const readC = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(C, dir, `${id}.json`), 'utf8')); } catch { return null; } };

const res = planRooms(plan, { seed });
if (!res.rooms) fail(res.problems.join('; '));
const facade = readC('zones', plan.facade);
if (!facade) fail(`no facade zone ${plan.facade} in content/zones`);
const region = readC('regions', facade.flags?.region_id || 'region_coldwater');
const br = plan.bracket ? { bracket: plan.bracket, why: 'the plan' } : bracketOf({ facadeFlags: facade.flags || {}, tileX: plan.tile?.[0], gradient: region?.street_gradient });

// `ids` in the plan maps a generated room to an id the building already has (its lobby to `hall`, say), so a
// replace keeps that room's file, its people and its door
const S = plan.slug, P = `zone_${S}_`, zid = (id) => `${P}${plan.ids?.[id] || id}`, mapId = `map_int_${S}`;
const bname = facade.flags?.building_name || facade.name;
const ORD = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth'];
const RENT = { poor: [60, 10], middle: [150, 20], rich: [300, 40] };
let unitNo = 0;
const unitName = new Map();
const nameOf = (r) => {
  if (r.role === 'lobby') return `${bname}, Lobby`;
  if (r.role === 'landing') return `${bname}, ${ORD[r.s] || `Floor ${r.s}`} Floor Landing`;
  if (r.role === 'hall') return `${bname}, ${ORD[r.s] || `Floor ${r.s}`} Floor Hall`;
  if (r.role === 'shop') return `${bname}, Shop`;
  if (r.role === 'backroom') return `${bname}, Back Room`;
  if (r.role === 'office') return `${bname}, Office`;
  if (r.role === 'washroom') return `${bname}, ${ORD[r.s] || `Floor ${r.s}`} Floor Bathroom`;
  if (!unitName.has(r.unit)) unitName.set(r.unit, `${r.s}.${r.s ? ++unitNo : unitName.size + 1}`);
  const n = unitName.get(r.unit);
  return `${bname}, ${r.role === 'room' ? 'Room' : 'Flat'} ${n}${r.role === 'bedroom' ? ', Bedroom' : r.role === 'bath' ? ', Bathroom' : ''}`;
};
// numbering restarts each floor
const floorsSeen = new Set();
for (const r of res.rooms) { if (r.unit && !floorsSeen.has(r.s)) { floorsSeen.add(r.s); unitNo = 0; } if (r.unit) nameOf(r); }

// ── zones ──────────────────────────────────────────────────────────────────────────────────────────
const zones = new Map(), byId = new Map(res.rooms.map((r) => [r.id, r]));
const common = { building_name: bname, building_type: facade.flags?.building_type || plan.building_type, is_building: true, is_interior: true, world_exit_zone: plan.facade };   // the map's anchor, as content:lint holds it
const ox = byId.get('lobby').room, origin = [(ox[0] + ox[1]) / 2, (ox[2] + ox[3]) / 2];
for (const r of res.rooms) {
  const F = roomFrame(r.room, r.face), room = { w: r.w, d: r.d, h: r.h, face: r.face, studio: r.role === 'flat' && r.w >= 6.5 && r.d >= 7.5 ? undefined : false };
  if (room.studio === undefined) delete room.studio;
  if (r.panes.length) room.panes = r.panes; else room.windowless = true;
  if (r.s > 0) room.floor_m = r.floor;
  const flags = { ...common, room };
  if (r.unit && ['flat', 'living', 'room'].includes(r.role)) { flags.is_apartment = true; flags.rent_cost = RENT[br.bracket][0] + RENT[br.bracket][1] * Math.min(4, res.walk.indexOf(r.s)); }
  if (r.role === 'lobby') room.street_door = { kind: 'single', w: 1 };
  // the plan's finish (room-kits.js FINISHES): tones, decor and the floor
  const fin = plan.finish ? finishFor(plan.finish, r.role, { w: r.w, d: r.d, h: r.h, id: zid(r.id) }) : null;
  if (fin) { room.tone = fin.tone; room.decor = fin.decor; if (fin.ground) room.ground = fin.ground; }
  zones.set(r.id, {
    ambient_theme: 'indoors', description: '', exits: {}, flags, id: zid(r.id), map_id: mapId, name: nameOf(r), parent_zone: plan.facade,
    // even cells only: two zones a cell apart are joined by the grid (derive.mjs projectEdges) whether or not a
    // door is there, so no generated room is ever next to another and only the connections join them
    grid_x: 2 * Math.round(((r.rect[0] + r.rect[1]) / 2 - origin[0]) / 4), grid_y: -2 * Math.round(((r.rect[2] + r.rect[3]) / 2 - origin[1]) / 4), grid_z: r.s,
  });
}
const conns = [];
const conn = (aId, dir, bId) => conns.push({ a: aId, b: bId, blocked: false, dir, id: `conn_${aId.replace(/^zone_/, '')}_${dir}`, lockable: false, one_way: false });
for (const d of res.doors) {
  const A = zones.get(d.a), B = zones.get(d.b);
  A.exits[d.dir] = B.id; B.exits[OPP[d.dir]] = A.id;
  (A.flags.room.doors ||= {})[d.dir] = d.offA;
  (B.flags.room.doors ||= {})[OPP[d.dir]] = d.offB;
  conn(A.id, d.dir, B.id);
}
// the street door
const lobby = zones.get('lobby'), L = byId.get('lobby');
lobby.exits[plan.door.side] = plan.facade;
{ const ns = plan.door.side === 'north' || plan.door.side === 'south', mid = ns ? (L.room[0] + L.room[1]) / 2 : (L.room[2] + L.room[3]) / 2;
  (lobby.flags.room.doors ||= {})[plan.door.side] = Math.round(((plan.door.at ?? mid) - mid) * 100) / 100; }
conn(lobby.id, plan.door.side, plan.facade);
// the climbs
for (const c of res.climbs) {
  const A = byId.get(c.a), B = byId.get(c.b), ZA = zones.get(c.a), ZB = zones.get(c.b), FA = roomFrame(A.room, A.face), FB = roomFrame(B.room, B.face);
  ZA.exits.up = ZB.id; ZB.exits.down = ZA.id;
  const foot = FA.toRoom(c.at);
  if (c.flight) {
    const st = { at: foot, climb: FA.wallOn(c.climb), w: 1.1 };
    ZA.flags.room.stair = st;
    const head = FA.fromRoom(flightOf(st, A.h).head);
    (ZB.flags.room.doors ||= {}).down = FB.toRoom(head);
  } else {
    (ZA.flags.room.doors ||= {}).up = foot;
    (ZB.flags.room.doors ||= {}).down = FB.toRoom(c.at);
  }
  conn(ZA.id, 'up', ZB.id);
}
// the utility room under the lobby: text only, as every building has (`ids.util` keeps one the building has)
const util = { description: '', exits: { up: lobby.id }, flags: { floor: 'concrete', is_interior: true, world_exit_zone: common.world_exit_zone }, grid_x: 0, grid_y: 0, grid_z: -1, id: plan.ids?.util ? zid('util') : `zone_util_${lobby.id}`, map_id: mapId, name: `${bname}, The Basement`, parent_zone: plan.facade };
lobby.exits.down = util.id;
conn(lobby.id, 'down', util.id);

// ── furniture ──────────────────────────────────────────────────────────────────────────────────────
const furniture = [];
for (const r of res.rooms) for (const p of kitFor(r.role, br.bracket)) {
  const { key, ...row } = p;
  furniture.push({ description: '', ...row, id: `furn_${S}_${r.id}_${key}`, zone_id: zid(r.id) });
}

// ── check it the way the Stage will draw it ─────────────────────────────────────────────────────────
const allZones = [...zones.values(), util, { ...facade, exits: { ...facade.exits, [OPP[plan.door.side]]: lobby.id } }];
const Z = new Map(allZones.map((z) => [z.id, z])), specOf = (z) => zoneSpecOf(Z, z);
const map = { id: mapId, name: bname, parent_zone_id: plan.facade, entry_zone_id: lobby.id };
const bld = buildingGraph({ zones: allZones, maps: [map], specOf }).get(mapId);
const checks = [];
if (!bld) checks.push('no building came out of the graph');
else {
  for (const d of buildingDefects(bld)) checks.push(`graph: ${JSON.stringify(d)}`);
  const lay = buildingLayout(bld, { zones: Z, specOf });
  for (const p of lay.problems) checks.push(`plan: ${JSON.stringify(p)}`);
  const missing = res.rooms.filter((r) => !lay.rooms[zid(r.id)]).map((r) => r.id);
  if (missing.length) checks.push(`not on the walk: ${missing.join(', ')}`);
  for (const r of res.rooms) {
    const got = lay.rooms[zid(r.id)];
    if (!got) continue;
    const want = [r.room[0] - origin[0], r.room[1] - origin[0], r.room[2] - origin[1], r.room[3] - origin[1]], have = [got.box[0], got.box[1], got.box[4], got.box[5]];
    const err = Math.max(...want.map((v, i) => Math.abs(v - have[i])), Math.abs(got.floor - r.floor));
    if (err > 0.05) checks.push(`${r.id}: drawn ${err.toFixed(2)} m from where the plan put it (want ${want.map((v) => v.toFixed(2))} @${r.floor}, got ${have} @${got.floor})`);
  }
}

// ── what's already in content/ for this building ────────────────────────────────────────────────────
const REPLACE = args.includes('--replace'), WRITE = !args.includes('--dry');
const readDir = (dir) => { const d = path.join(C, dir); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => ({ file: `${dir}/${f}`, data: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) })) : []; };
const oldZones = readDir('zones').filter((f) => f.data.map_id === mapId);
const oldIds = new Set(oldZones.map((f) => f.data.id));
const hasRooms = oldZones.length > 0 || fs.existsSync(path.join(C, 'maps', `${mapId}.json`));
const newZones = [...zones.values(), util], newIds = new Set(newZones.map((z) => z.id));
const touches = (c) => oldIds.has(c.a) || oldIds.has(c.b) || newIds.has(c.a) || newIds.has(c.b);
const oldConns = readDir('connections').filter((f) => touches(f.data));
const oldFurn = readDir('furniture').filter((f) => oldIds.has(f.data.zone_id));
const files = [];   // [dir, obj, 'new' | 'changed']

if (WRITE) {
  if (checks.length) fail('it failed the Stage\'s check, so nothing goes into content/ (run with --dry to see why)');
  if (hasRooms && !REPLACE) fail(`${bname} already has rooms (${oldZones.length} zones on ${mapId}). --replace writes over them and lists what's left over`);
}

// --replace: a file with the same id keeps what a person wrote in it (its name, its description, its prose and every
// flag the generator doesn't own) and takes the new geometry. A connection between the same two rooms keeps its file
// (and its lock, its door). Furniture a person placed stays, and a room that has any gets no kit.
const GEOMETRY = ['w', 'd', 'h', 'face', 'panes', 'windowless', 'doors', 'stair', 'floor_m', 'studio', 'at', 'glass', 'sash', 'balcony', 'windows', 'window', 'door'];
const mergeZone = (z) => {
  const old = oldZones.find((f) => f.data.id === z.id)?.data;
  if (!old) return z;
  const keptRoom = Object.fromEntries(Object.entries(old.flags?.room && typeof old.flags.room === 'object' && !Array.isArray(old.flags.room) ? old.flags.room : {}).filter(([k]) => !GEOMETRY.includes(k)));
  // geometry from the plan; everything else a person set (decor, tone, its floor) wins over the finish
  const geo = Object.fromEntries(Object.entries(z.flags.room || {}).filter(([k]) => GEOMETRY.includes(k)));
  const flags = { ...old.flags, ...z.flags };
  if (z.flags.room) flags.room = { ...z.flags.room, ...keptRoom, ...geo };
  if (old.flags?.rent_cost != null) flags.rent_cost = old.flags.rent_cost;
  delete flags.gen;   // a person has had their hands on it
  return { ...old, exits: z.exits, flags, map_id: z.map_id, parent_zone: z.parent_zone, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z, name: old.name || z.name, description: old.description || z.description };
};
const pairKey = (c) => [c.a, c.b].sort().join('~');
const oldByPair = new Map(oldConns.map((f) => [pairKey(f.data), f.data]));
const authoredIn = new Set(oldFurn.filter((f) => !f.data.flags?.gen).map((f) => f.data.zone_id));

const outZones = REPLACE ? newZones.map(mergeZone) : newZones;
const outConns = conns.map((c) => { const old = REPLACE ? oldByPair.get(pairKey(c)) : null; return old ? { ...old, a: c.a, b: c.b, dir: c.dir, one_way: false } : c; });   // the generator writes the exit both ways, so its file goes both ways
const outFurn = furniture.filter((f) => !(REPLACE && authoredIn.has(f.zone_id)));
// the facade's way in: its exit back into the lobby
const facadeOut = { ...facade, exits: { ...facade.exits, [OPP[plan.door.side]]: lobby.id } };

// A flat's front door gets a hololock, as fit-apartment-hololocks.mjs fits every other (same row, same lock): the
// step from a flat to a room that isn't the flat's own. A connection that already has a door keeps it.
const oldDoors = readDir('doors');
const doorOn = new Map(oldDoors.map((f) => [f.data.connection_id, f.data]));
const outZoneById = new Map(outZones.map((z) => [z.id, z]));
const unitOf = new Map(res.rooms.filter((r) => r.unit).map((r) => [zid(r.id), r.unit]));
const outDoors = [];
for (const c of outConns) {
  if (c.blocked) continue;
  // a door already on this connection follows it (its rooms and direction may have changed)
  if (doorOn.has(c.id)) { const d = doorOn.get(c.id); if (d.zone_id !== c.a || d.target_zone !== c.b || d.exit_dir !== c.dir) outDoors.push({ ...d, exit_dir: c.dir, target_zone: c.b, zone_id: c.a }); if (Object.keys(d.tags || {}).some((k) => k.startsWith('lock:'))) c.lockable = true; continue; }
  const A = outZoneById.get(c.a), B = outZoneById.get(c.b);
  if (!A || !B) continue;
  const flat = [A, B].find((z) => z.flags?.is_apartment), other = flat === A ? B : A;
  if (!flat || other.flags?.is_apartment || (unitOf.get(other.id) && unitOf.get(other.id) === unitOf.get(flat.id))) continue;
  c.lockable = true;
  const id = `door_${flat.id.replace(/^zone_/, '')}`, old = oldDoors.find((f) => f.data.id === id)?.data;
  // the flat's own door, on a connection the new layout dropped (it opened on the landing and now opens on a hall):
  // moved onto the new connection, keeping its lock and state
  if (old && !outConns.some((x) => x.id === old.connection_id)) { outDoors.push({ ...old, connection_id: c.id, exit_dir: c.dir, target_zone: c.b, zone_id: c.a }); continue; }
  if (old) fail(`content/doors/${id}.json is already on another connection`);
  outDoors.push({
    connection_id: c.id, door_type: 'basic', exit_dir: c.dir, flags: {}, hololock_difficulty: 5,
    hp: 1000, hp_max: 1000, id, is_locked: 0, is_open: 0, lock_state: 'locked', name: `${flat.name} door`,
    tags: { 'lock:hololock': { canHack: true, difficulty: 5 } }, target_zone: c.b, zone_id: c.a,
  });
}

// What a replace leaves over: rooms, doors and generated furniture the new layout doesn't have, and the people who
// live or work in those rooms. Nothing here is deleted: a person sets aside or deletes it, as yards-fit.mjs set floor 10 aside.
const keptConnIds = new Set(outConns.map((c) => c.id));
const left = {
  zones: oldZones.filter((f) => !newIds.has(f.data.id)),
  connections: oldConns.filter((f) => !keptConnIds.has(f.data.id)),
  furniture: oldFurn.filter((f) => !newIds.has(f.data.zone_id) || (f.data.flags?.gen && !outFurn.some((g) => g.id === f.data.id))),
};
const leftConnIds = new Set(left.connections.map((f) => f.data.id));
left.doors = oldDoors.filter((f) => leftConnIds.has(f.data.connection_id) && !outDoors.some((d) => d.id === f.data.id));
const goneIds = new Set(left.zones.map((f) => f.data.id));
const people = REPLACE ? readDir('npcs').filter((f) => goneIds.has(f.data.home_zone) || goneIds.has(f.data.work_zone_id)) : [];
const homes = REPLACE ? readDir('npc_residences').filter((f) => goneIds.has(f.data.zone_id)) : [];

// ── write ───────────────────────────────────────────────────────────────────────────────────────────
if (!path.relative(C, OUT).startsWith('..')) fail('the review folder must not be content/');
fs.rmSync(OUT, { recursive: true, force: true });
// content/'s own form: keys sorted all the way down, so a diff shows only what changed
const json = (obj) => canonicalJson(obj);
const putTo = (root, dir, obj) => { fs.mkdirSync(path.join(root, dir), { recursive: true }); fs.writeFileSync(path.join(root, dir, `${obj.id}.json`), json(obj)); };
const all = [['maps', map], ...outZones.map((z) => ['zones', z]), ...outConns.map((c) => ['connections', c]), ...outFurn.map((f) => ['furniture', f]), ...outDoors.map((d) => ['doors', d]), ['zones', facadeOut]];
for (const [dir, obj] of all) putTo(OUT, dir, obj);
const rel = path.relative(process.cwd(), OUT);
const manifest = [];
if (WRITE) for (const [dir, obj] of all) {
  const p = path.join(C, dir, `${obj.id}.json`), was = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (was === json(obj)) continue;
  // a file another building owns is never written over
  if (was && dir === 'zones' && obj.id !== plan.facade && JSON.parse(was).map_id !== mapId) fail(`content/${dir}/${obj.id}.json belongs to ${JSON.parse(was).map_id}; rename the plan's slug`);
  if (was && dir === 'connections' && !oldConns.some((f) => f.data.id === obj.id)) fail(`content/${dir}/${obj.id}.json is another building's connection`);
  if (was && dir === 'furniture' && !JSON.parse(was).flags?.gen && !oldIds.has(JSON.parse(was).zone_id)) fail(`content/${dir}/${obj.id}.json is somebody else's furniture`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, json(obj));
  manifest.push({ file: `${dir}/${obj.id}.json`, before: was, after: json(obj) });
  files.push(`${was ? 'changed' : 'new    '} content/${dir}/${obj.id}.json`);
}
const leftLines = [
  ...left.zones.map((f) => `zone        content/${f.file}  (${f.data.name})`),
  ...left.connections.map((f) => `connection  content/${f.file}  (${f.data.a} ${f.data.dir} ${f.data.b})`),
  ...left.furniture.map((f) => `furniture   content/${f.file}  (${f.data.name} in ${f.data.zone_id})`),
  ...left.doors.map((f) => `door        content/${f.file}  (${f.data.name})`),
  ...people.map((f) => `person      content/${f.file}  (${f.data.name}: ${goneIds.has(f.data.home_zone) ? `lives in ${f.data.home_zone}` : ''}${goneIds.has(f.data.work_zone_id) ? ` works in ${f.data.work_zone_id}` : ''})`),
  ...homes.map((f) => `residence   content/${f.file}  (${f.data.npc_id} in ${f.data.zone_id})`),
];
if (REPLACE) fs.writeFileSync(path.join(OUT, 'left-over.txt'), `${leftLines.join('\n')}\n`);
if (manifest.length) fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ plan: planPath, files: manifest }));

// ── report ──────────────────────────────────────────────────────────────────────────────────────────
const out = [];
out.push(`${bname} (${plan.facade}), plan ${path.basename(planPath)}, seed "${seed}"`);
out.push(`layout ${res.layout}, chain ${res.core.mode} along ${res.core.axis}, landing at the ${res.core.hi ? 'high' : 'low'} end, stair foot at [${res.core.foot}] climbing ${res.core.climbSide}`);
out.push(`floors with rooms: ${res.walk.join(', ')} of ${Math.max(...plan.masses.map((m) => m.storeys[1]))} storeys; climbs: ${res.climbs.map((c) => `${c.a}->${c.b} ${c.flight ? 'flight' : 'told'}`).join(', ')}`);
out.push(`bracket ${br.bracket} (${br.why}); ${res.rooms.filter((r) => ['flat', 'living', 'room'].includes(r.role)).length} flats or rooms, ${zones.size + 1} zones, ${conns.length} connections, ${furniture.length} pieces`);
if (plan.roof?.lift) out.push('the roof has a lift housing: no lift car is generated yet; the landings say so in prose');
for (const p of res.problems) out.push(`! ${p}`);
const dark = res.rooms.filter((r) => !r.panes.length && !['bath', 'washroom', 'landing', 'hall', 'lobby', 'backroom'].includes(r.role));
for (const r of dark) out.push(`! ${r.id} (${r.role}) has no window`);
for (const s of res.walk) out.push(`\nstorey ${s} (floor ${res.rooms.find((r) => r.s === s).floor} m), north up:\n${drawFloor(res.rooms, s)}`);
out.push(`\nrun folder ${rel}`);
if (!WRITE) out.push('--dry: nothing written to content/');
if (checks.length) { out.push(`\nFAILED the Stage's check (${checks.length}):`); for (const c of checks) out.push(`  ${c}`); }
else out.push('the Building Stage lays every room where the plan put it');
if (!WRITE && hasRooms) out.push(`\n${bname} already has ${oldZones.length} rooms; --replace would write over them`);
if (WRITE) {
  out.push(`\n${files.length} files written to content/ (nothing committed or imported):`);
  for (const f of files) out.push(`  ${f}`);
  out.push('Next: read the diff, add names and prose, wire the lights, then npm run content:import and walk it.');
  out.push(`Not happy? Don't commit it, and put it back with: node scripts/content/plan-rooms.mjs ${planPath} --undo`);
}
if (REPLACE && leftLines.length) {
  out.push(`\nLEFT OVER (${leftLines.length}), not deleted; content won't import cleanly until each is set aside or deleted, and its people moved:`);
  for (const l of leftLines) out.push(`  ${l}`);
  out.push(`(also in ${path.join(rel, 'left-over.txt')})`);
}
console.log(out.join('\n'));
process.exit(checks.length ? 1 : 0);
