/**
 * THE HUGHSON COLISEUM AT TRUE SIZE: the park on 121 tiles (docs/proposals/coliseum-true-size.md,
 * phase 3).
 *
 *   node scripts/content/coliseum-park.mjs [--dry-run]
 *
 * Phases 1 and 2 (coliseum-ground.mjs, coliseum-resite.mjs) moved the Curtain and the buildings off
 * the square x 887-897, y 910-920. This lays the park on it, at the size the broadcast always drew
 * it, as client/shared/coliseum-plan.js lays it out: one building on 121 tiles, four of them doors.
 *
 * ⚠ WHAT WAS THERE IS SET ASIDE, NOT DELETED. The square's 112 street and meadow tiles move onto the
 * holding map `map_set_aside`, in their own layout on rows 11 to 21 (grid x minus 886, y minus 899),
 * keeping their ids, names, furniture and power rows, with `flags.set_aside_from`. Nothing on the
 * holding map connects to the world: every link from a set-aside tile to one that isn't is cut.
 *
 * ⚠ THE PARK'S TILES ARE zone_ballpark_<x>_<y>, so the nine the nine-tile park had keep their ids
 * where they stand and take new roles, and 112 are new. Their types are the plan's slices
 * (`ballpark_<bc>_<br>`, and `ballpark`, `ballpark_bleachers`, `ballpark_gate_c`, `ballpark_gate_d`
 * for the four doors), which glass/models/coliseum.js draws as one park.
 *
 * ⚠ THE GATES MOVE, THEIR ROOMS DON'T. The main gate's interior (the rotunda and everything past it)
 * and the bleachers' are re-hung on the new doors: their maps' parent, the links in and out, and every
 * room's `world_exit_zone`. GATE C on the Cart Yard and GATE D on the river road are new, each a hall
 * into the bleachers.
 *
 * ⚠ A SEALED SLICE IS WALLED ON EVERY SIDE a neighbour would walk in from, with a blocked connection,
 * and `exits` is rewritten from the projected graph afterwards, which content:lint holds it to.
 *
 * It refuses to run twice: once zone_ballpark_887_910 exists there's nothing to do.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';
import { CARDINAL, OPPOSITE, projectEdges } from './derive.mjs';
import { BLOCK, HALF, HP, SH, parkTiles } from '../../client/shared/coliseum-plan.js';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const NAME = 'Charles B. Hughson Coliseum';
const ROOMS = 'The Coliseum';
const DISTRICT = 'halcyon_fields';
const REGION = 'region_coldwater';
const HOLD = 'map_set_aside';
const X0 = 887, Y0 = 910;
const BLK = { x0: X0, x1: X0 + BLOCK - 1, y0: Y0, y1: Y0 + BLOCK - 1 };
const parkId = (x, y) => `zone_ballpark_${x}_${y}`;
const inSquare = (z) => z?.map_id === 'map_world' && (z.grid_z ?? 0) === 0
  && z.grid_x >= BLK.x0 && z.grid_x <= BLK.x1 && z.grid_y >= BLK.y0 && z.grid_y <= BLK.y1;
const world = () => store.all('zones').filter((z) => z.map_id === 'map_world' && (z.grid_z ?? 0) === 0);
const atTile = (x, y) => world().find((z) => z.grid_x === x && z.grid_y === y);

if (store.get('zones', parkId(887, 910))) { console.log('The park already stands on 121 tiles; nothing to do.'); process.exit(0); }

// ── 0. THE VENUE ─────────────────────────────────────────────────────────────────────────────
// The broadcast's park and the map's are one place: the Deadball row names the block, and home
// plate's tile coordinates are where the plan puts it.
const BC = 'bc_1783289744953';
{
  const bc = store.get('media_broadcasts', BC);
  const site = bc?.sports_pools?.venue?.site;
  if (!site) throw new Error(`${BC} has no venue site`);
  const hp = (i) => Math.round(((i ? Y0 : X0) + HALF + HP[i] * SH) * 100) / 100;
  store.patch('media_broadcasts', BC, {
    sports_pools: { ...bc.sports_pools, venue: { ...bc.sports_pools.venue, site: { ...site, block: BLK, x: hp(0), y: hp(1) } } },
  });
}

// What stood on each cell before the square went, for the power rows the park takes over.
const wasAt = new Map(world().map((z) => [`${z.grid_x},${z.grid_y}`, z.id]));

// ── 1. SET ASIDE THE SQUARE ──────────────────────────────────────────────────────────────────
const held = world().filter((z) => inSquare(z) && !z.id.startsWith('zone_ballpark_'));
if (held.length !== BLOCK * BLOCK - 9) throw new Error(`expected 112 tiles to set aside, found ${held.length}`);
if (held.some((z) => z.flags?.facade || z.flags?.building_type)) throw new Error('a building is still standing in the square; run coliseum-resite.mjs first');
const heldIds = new Set(held.map((z) => z.id));
for (const z of held) {
  store.patch('zones', z.id, {
    map_id: HOLD, grid_x: z.grid_x - X0 + 1, grid_y: z.grid_y - Y0 + 11, grid_z: 0,
    flags: { ...(z.flags || {}), set_aside: true, set_aside_from: `${z.grid_x},${z.grid_y}` },
  });
}
// Their links to the world go: every connection file with one end set aside and the other not.
const dropConns = new Set();
for (const c of store.all('connections')) {
  const a = heldIds.has(c.a), b = heldIds.has(c.b);
  if (a !== b) dropConns.add(c.id);
}

// ── 2. THE PARK'S TILES ──────────────────────────────────────────────────────────────────────
const SLICE = {
  field: 'The field of the Hughson Coliseum under its retractable roof: grass, a dirt infield, and the stands round it.',
  stands: 'The stands of the Hughson Coliseum, raked up from the field to the bowl wall under its retractable roof.',
  wall: 'The bowl wall of the Hughson Coliseum: limestone between marble fins, tall bronze-framed windows onto the concourse, and a copper cornice.',
  tower: 'A corner of the Hughson Coliseum, where one of its four stepped light towers stands over the bowl wall.',
};
const roleOf = (t) => {
  const edge = Math.min(t.bc, t.br, BLOCK - 1 - t.bc, BLOCK - 1 - t.br);
  if (t.floors >= 18) return 'tower';
  if (edge === 0) return 'wall';
  const [u, v] = [(t.bc - HALF + 0.5) / SH, (t.br - HALF + 0.5) / SH];
  return Math.hypot(u - HP[0], v - HP[1]) < 1.9 && (u > HP[0] - 0.1 || v > HP[1] - 0.1) ? 'stands' : 'field';
};
const oldFacades = { main: parkId(897, 913), bleachers: parkId(895, 911) };
const oldTiles = new Map(store.all('zones').filter((z) => z.id.startsWith('zone_ballpark_')).map((z) => [z.id, z]));
const doors = {};
for (const t of parkTiles()) {
  const x = X0 + t.bc, y = Y0 + t.br, id = parkId(x, y);
  const replaced = { id: wasAt.get(`${x},${y}`) };
  if (t.door) { doors[t.type] = { id, x, y, facing: t.facing, floors: t.floors }; continue; }
  store.put('zones', {
    ambient_events: [], ambient_theme: 'urban', bg_color: '#2a1d18', color: '#d8c9a8',
    description: SLICE[roleOf(t)], exits: {},
    flags: { building_name: NAME, building_type: t.type, district: DISTRICT, entrance: t.facing, floors: t.floors, region_id: REGION, venue_lights: true, venue_roof: true },
    grid_x: x, grid_y: y, grid_z: 0, id, map_id: 'map_world', name: NAME, parent_zone: null,
  });
  // the city grid feeds the park as it fed what stood here
  const prev = store.get('power_zones', replaced?.id) || store.get('power_zones', id);
  if (prev) store.patch('power_zones', id, { ...prev, id, name: NAME });
}

// ── 3. THE GATES ─────────────────────────────────────────────────────────────────────────────
// The main gate and the bleacher gate: their rooms re-hung on the new doors.
const streetOf = (d) => { const [dx, dy] = CARDINAL[d.facing]; const s = atTile(d.x + dx, d.y + dy); if (!s) throw new Error(`no street ${d.facing} of ${d.x},${d.y}`); return s; };
const rehang = (oldId, d, mapId, marker, description) => {
  const old = oldTiles.get(oldId), street = streetOf(d);
  if (!old) throw new Error(`${oldId} is gone`);
  const replaced = { id: wasAt.get(`${d.x},${d.y}`) };
  store.put('zones', {
    ambient_events: [], ambient_theme: 'urban', bg_color: old.bg_color, color: old.color, description,
    exits: {},
    flags: { building_name: NAME, building_type: Object.entries(doors).find(([, v]) => v === d)[0], district: DISTRICT, entrance: d.facing, facade: true, floors: d.floors, is_building: true, region_id: REGION, venue_lights: true, venue_roof: true, world_exit_zone: street.id },
    grid_x: d.x, grid_y: d.y, grid_z: 0, id: d.id, map_id: 'map_world', marker, name: NAME, parent_zone: null,
  });
  const prev = store.get('power_zones', replaced?.id);
  if (prev && !store.get('power_zones', d.id)) store.patch('power_zones', d.id, { ...prev, id: d.id, name: NAME });
  store.patch('maps', mapId, { parent_zone_id: d.id });
  for (const z of store.all('zones')) {
    if (z.flags?.world_exit_zone === oldId && z.id !== d.id) store.patch('zones', z.id, { flags: { ...z.flags, world_exit_zone: d.id } });
    if (z.parent_zone === oldId) store.patch('zones', z.id, { parent_zone: d.id });
  }
  // the link into the rooms moves to the new door; the old link onto the street goes
  for (const c of store.all('connections')) {
    if (c.a !== oldId && c.b !== oldId) continue;
    const other = c.a === oldId ? c.b : c.a, o = store.get('zones', other);
    if (o && o.map_id !== 'map_world') store.patch('connections', c.id, c.a === oldId ? { a: d.id } : { b: d.id });
    else dropConns.add(c.id);
  }
  const sid = `conn_hf_ballpark_${d.x}_${d.y}_${d.facing}`;
  store.put('connections', { a: d.id, b: street.id, blocked: false, dir: d.facing, id: sid, lockable: false, one_way: false });
  return street;
};
const main = doors.ballpark, bl = doors.ballpark_bleachers;
const mainStreet = rehang(oldFacades.main, main, 'map_int_hughson', 'HC',
  'The main gate of the Charles B. Hughson Coliseum: a stepped limestone frontispiece on Sorrel Way between two fluted pylons, the name in raised gilt on a bronze plate over bronze doors and a sunburst fanlight. The bowl wall runs away either side of it.');
const blStreet = rehang(oldFacades.bleachers, bl, 'map_int_hughsonbl', 'BG',
  'The bleacher gate of the Hughson Coliseum on Halcyon Boulevard: two grille gates between fluted pylons, BLEACHERS in gilt on a bronze plate over them, and the roof standing over the wall.');
// The old doors are sealed slices of the park now.
for (const id of Object.values(oldFacades)) {
  const z = store.get('zones', id);
  if (z.grid_x === main.x && z.grid_y === main.y) continue;
  const t = parkTiles().find((p) => X0 + p.bc === z.grid_x && Y0 + p.br === z.grid_y);
  const { facade, is_building, world_exit_zone, ...flags } = z.flags;
  store.put('zones', { ...z, exits: {}, marker: undefined, description: SLICE[roleOf(t)], flags: { ...flags, building_type: t.type, entrance: t.facing, floors: t.floors } });
}

// GATE C on the Cart Yard and GATE D on the river road: a hall each, into the bleachers.
const sideGate = async (type, slug, label, street, into, intoDir, description, hall) => {
  const d = doors[type];
  const replaced = { id: wasAt.get(`${d.x},${d.y}`) };
  const res = await authorBuilding(store, {
    slug, name: NAME, roomName: ROOMS, type, facadeId: d.id, streetId: street.id,
    x: d.x, y: d.y, entrance: d.facing, floors: d.floors, marker: label === 'GATE C' ? 'G3' : 'G4', district: DISTRICT,
    facade: { bgColor: '#2a1d18', color: '#d8c9a8', description },
    // the plant room under the hall, named to the house pattern and under 30 characters (docs:prose)
    utility: { name: `${label === 'GATE C' ? 'Gate C' : 'Gate D'} Plant`, description: 'A low room under the gate hall: the turnstiles' counters on a board, a junction box and a dehumidifier that runs all summer.' },
    rooms: [{ key: 'hall', name: label === 'GATE C' ? 'Gate C' : 'Gate D', floor: 'tile', description: hall }],
  });
  // authorBuilding names the door but doesn't place a new one on the map
  store.patch('zones', d.id, { grid_x: d.x, grid_y: d.y, grid_z: 0, map_id: 'map_world', flags: { ...store.get('zones', d.id).flags, venue_lights: true, venue_roof: true } });
  const hallId = `zone_${slug}_hall`;
  store.patch('zones', hallId, { exits: { ...store.get('zones', hallId).exits, [intoDir]: into } });
  store.patch('zones', into, { exits: { ...store.get('zones', into).exits, [OPPOSITE[intoDir]]: hallId } });
  store.put('connections', { a: hallId, b: into, blocked: false, dir: intoDir, id: `conn_hf_${slug}_hall_${intoDir}`, lockable: false, one_way: false });
  const prev = store.get('power_zones', replaced?.id);
  if (prev && !store.get('power_zones', d.id)) store.patch('power_zones', d.id, { ...prev, id: d.id, name: NAME });
  return res;
};
const BLEACHERS = 'zone_hughsonbl_bleachers';
const gc = await sideGate('ballpark_gate_c', 'hughsongc', 'GATE C', atTile(898, 912), BLEACHERS, 'west',
  'GATE C of the Hughson Coliseum, on the Cart Yard: a plain stepped frontispiece in the bowl\'s limestone, bronze doors under a lit fanlight, and GATE C in gilt on a bronze plate.',
  'A tiled hall inside GATE C, with a turnstile, a closed ticket window and a run of coat hooks nobody uses. A ramp climbs west to the bleachers.');
const gd = await sideGate('ballpark_gate_d', 'hughsongd', 'GATE D', atTile(886, 912), BLEACHERS, 'east',
  'GATE D of the Hughson Coliseum, on the river road: a plain stepped frontispiece in the bowl\'s limestone, bronze doors under a lit fanlight, and GATE D in gilt on a bronze plate.',
  'A tiled hall inside GATE D, with a turnstile and a bench under a faded fixture list. A ramp climbs east to the bleachers. The Curtain hums through the doors behind you.');

// ── 4. WALLS ROUND EVERY SEALED SLICE ────────────────────────────────────────────────────────
// Old walls touching the park's tiles go, and a fresh one stands on every side a neighbour could
// walk in from: between two slices, and between a slice and the street.
const parkIds = new Set(parkTiles().map((t) => parkId(X0 + t.bc, Y0 + t.br)));
for (const c of store.all('connections')) if (c.blocked && (parkIds.has(c.a) || parkIds.has(c.b))) dropConns.add(c.id);
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;
const live = () => store.all('zones').filter((z) => z.map_id === 'map_world' && (z.grid_z ?? 0) === 0);
const cellOf = new Map(live().map((z) => [`${z.grid_x},${z.grid_y}`, z]));
const walled = new Set();
let walls = 0;
for (const id of parkIds) {
  const z = store.get('zones', id);
  for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
    const n = cellOf.get(`${z.grid_x + dx},${z.grid_y + dy}`);
    if (!n || facadeBlocks(z, dir) || facadeBlocks(n, OPPOSITE[dir])) continue;
    if (z.flags?.facade) continue;                  // a door's open side is its street link
    const key = [z.id, n.id].sort().join('~');
    if (walled.has(key)) continue;
    walled.add(key);
    const cid = `conn_${slug(z.id)}_${dir}_${suffix(z.id, dir, n.id)}`;
    store.put('connections', { a: z.id, b: n.id, blocked: true, dir, id: cid, lockable: false, one_way: false });
    dropConns.delete(cid);
    walls++;
  }
}

// ── 5. THE STREETS AT THE DOORS ──────────────────────────────────────────────────────────────
store.patch('zones', mainStreet.id, { description: 'Sorrel Way outside the Hughson Coliseum\'s main gate, a stepped limestone frontispiece with the name in gilt over bronze doors. Cable covers run across the road in yellow rubber, feeding the floods. Crowd barriers are chained to the lamp posts.' });
store.patch('zones', blStreet.id, { description: 'Halcyon Boulevard where Vetch Mews meets it, under the Hughson Coliseum\'s north wall. The bleacher gate opens off the south side, two grille gates under BLEACHERS in gilt.' });
store.patch('zones', 'zone_hughson_rotunda', { flags: { ...store.get('zones', 'zone_hughson_rotunda').flags, window: { ...store.get('zones', 'zone_hughson_rotunda').flags.window, description: 'Bronze doors under a sunburst fanlight, folded back against the stone on game nights. Sorrel Way is outside, and Fitz\'s Franks across it.' } } });

// ── 6. EXITS FROM THE PROJECTED GRAPH ────────────────────────────────────────────────────────
const conns = store.all('connections').filter((c) => !dropConns.has(c.id));
const { edges } = projectEdges(store.all('zones'), conns);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
const near = (z) => (z.map_id === 'map_world' && z.grid_x >= BLK.x0 - 2 && z.grid_x <= BLK.x1 + 2 && z.grid_y >= BLK.y0 - 2 && z.grid_y <= BLK.y1 + 2)
  || z.map_id === HOLD || ['map_int_hughson', 'map_int_hughsonbl', gc.mapId, gd.mapId].includes(z.map_id);
let rewired = 0;
for (const z of store.all('zones')) {
  if (!near(z)) continue;
  const nx = out.get(z.id) || {};
  if (JSON.stringify(Object.entries(z.exits || {}).sort()) === JSON.stringify(Object.entries(nx).sort())) continue;
  store.patch('zones', z.id, { exits: nx });
  rewired++;
}

// MARK-4: a marker is unique across the world.
for (const mk of ['HC', 'BG', 'G3', 'G4']) {
  const has = store.all('zones').filter((z) => z.marker === mk);
  if (has.length !== 1) throw new Error(`map code ${mk} is on ${has.map((z) => z.id).join(', ') || 'nothing'}`);
}

const written = store.flush({ dryRun: DRY });
const removed = [];
for (const id of dropConns) {
  const p = path.join(store.baseDir, 'connections', `${id}.json`);
  if (fs.existsSync(p)) { removed.push(p); if (!DRY) fs.unlinkSync(p); }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} connection file(s) ${DRY ? 'would be removed' : 'removed'}`);
console.log(`  set aside ${held.length} tile(s) on ${HOLD}; ${walls} wall(s) round the sealed slices; exits rewritten on ${rewired} tile(s)`);
console.log(`  doors: main ${main.id}, bleachers ${bl.id}, GATE C ${gc.facadeId}, GATE D ${gd.facadeId}`);
