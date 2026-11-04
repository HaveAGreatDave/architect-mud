/**
 * THE HUGHSON COLISEUM AT FIVE TILES (docs/proposals/coliseum-five-tiles.md).
 *
 *   node scripts/content/coliseum-five.mjs [--dry-run]
 *
 * At 11 by 11 the park stood 13 towers wide. This takes it to 5 by 5 in the south-east corner of the
 * same lot, x 893-897, y 916-920, as client/shared/coliseum-plan.js lays it out, and opens the other
 * 96 tiles of Sir Charles's lot as ground.
 *
 *              x 887 . . . . 892 . . . . 897
 *        y 910   G G G G G G G G G G  r
 *              . G G G G G G G G G G  r       G  Hughson Green
 *              . G G G G G G G G G G  r       r  Hughson Way
 *              . G G G G G G G G G G  r       c  the Hughson Car Park
 *              . G G G G G G G G G G  r       P  the park
 *        y 915   r r r r r r r r r r  r
 *              . c c c c c r P P P P  P
 *              . c c c c c r P P P P  P
 *              . c c c c c r P P P P  P
 *              . c c c c c r P P P P  P
 *        y 920   c c c c c r P P P P  P
 *
 * ⚠ EVERY ID STAYS. A tile that was a slice of the park keeps its zone_ballpark_<x>_<y> id and takes
 * a new role, so no zone file goes and nothing that names one is orphaned. The only files removed are
 * connections: the walls round the old slices and the doors' links.
 *
 * ⚠ THE GATES MOVE, THEIR ROOMS DON'T, as they did for the 121 tiles (coliseum-park.mjs): each
 * interior is re-hung on its new door by its map's parent, the links in and out, and every room's
 * `world_exit_zone`.
 *
 * It refuses to run twice: once the venue's block starts at x 893 there's nothing to do.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadContentStore } from './halcyon/lib.mjs';
import { CARDINAL, OPPOSITE, projectEdges } from './derive.mjs';
import { BLOCK, HALF, HP, SH, parkTiles } from '../../client/shared/coliseum-plan.js';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const NAME = 'Charles B. Hughson Coliseum';
const DISTRICT = 'halcyon_fields';
const REGION = 'region_coldwater';
const LOT = { x0: 887, x1: 897, y0: 910, y1: 920 };
const X0 = 893, Y0 = 916;
const BLK = { x0: X0, x1: X0 + BLOCK - 1, y0: Y0, y1: Y0 + BLOCK - 1 };
const BC = 'bc_1783289744953';
const parkId = (x, y) => `zone_ballpark_${x}_${y}`;
const pick = (list, x, y) => list[(x * 3 + y * 5) % list.length];

// ── 0. THE VENUE ─────────────────────────────────────────────────────────────────────────────
const bc = store.get('media_broadcasts', BC);
const site = bc?.sports_pools?.venue?.site;
if (!site) throw new Error(`${BC} has no venue site`);
if (site.block?.x0 === BLK.x0) { console.log('The park already stands on five tiles; nothing to do.'); process.exit(0); }
const hp = (i) => Math.round(((i ? Y0 : X0) + HALF + HP[i] * SH) * 100) / 100;
store.patch('media_broadcasts', BC, {
  sports_pools: { ...bc.sports_pools, venue: { ...bc.sports_pools.venue, site: { ...site, block: BLK, x: hp(0), y: hp(1) } } },
});

const atTile = (x, y) => store.all('zones').find((z) => z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x === x && z.grid_y === y);

// ── 1. THE PARK'S 25 TILES ───────────────────────────────────────────────────────────────────
const SLICE = {
  field: 'The field of the Hughson Coliseum under its retractable roof: grass, a dirt infield, and the stands round it.',
  stands: 'The stands of the Hughson Coliseum, raked up from the field to the bowl wall under its retractable roof.',
  wall: 'The bowl wall of the Hughson Coliseum: limestone between marble fins, tall bronze-framed windows onto the concourse, and a copper cornice.',
  tower: 'A corner of the Hughson Coliseum, where one of its four stepped light towers stands over the bowl wall.',
};
const roleOf = (t) => {
  const edge = Math.min(t.bc, t.br, BLOCK - 1 - t.bc, BLOCK - 1 - t.br);
  const corner = (t.bc === 0 || t.bc === BLOCK - 1) && (t.br === 0 || t.br === BLOCK - 1);
  if (corner) return 'tower';
  if (edge === 0) return 'wall';
  const [u, v] = [(t.bc - HALF + 0.5) / SH, (t.br - HALF + 0.5) / SH];
  return Math.hypot(u - HP[0], v - HP[1]) < 1.9 && (u > HP[0] - 0.1 || v > HP[1] - 0.1) ? 'stands' : 'field';
};
const park = new Map(parkTiles().map((t) => [parkId(X0 + t.bc, Y0 + t.br), t]));
const inPark = (id) => park.has(id);

// The doors, new and old. `describe` is the facade's prose where the street it opens on has changed.
const DOOR = {
  ballpark: { old: parkId(894, 920), map: 'map_int_hughson', marker: 'HC' },
  ballpark_bleachers: {
    old: parkId(889, 910), map: 'map_int_hughsonbl', marker: 'BG',
    describe: 'The bleacher gate of the Hughson Coliseum on Hughson Way: two grille gates between fluted pylons, BLEACHERS in gilt on a bronze plate over them, and the roof standing over the wall.',
  },
  ballpark_gate_c: {
    old: parkId(897, 912), map: 'map_int_hughsongc', marker: 'G3',
    describe: 'GATE C of the Hughson Coliseum, at the end of Kerbstone Row: a plain stepped frontispiece in the bowl\'s limestone, bronze doors under a lit fanlight, and GATE C in gilt on a bronze plate.',
  },
  ballpark_gate_d: {
    old: parkId(887, 912), map: 'map_int_hughsongd', marker: 'G4',
    describe: 'GATE D of the Hughson Coliseum, on Hughson Way across from the car park: a plain stepped frontispiece in the bowl\'s limestone, bronze doors under a lit fanlight, and GATE D in gilt on a bronze plate.',
  },
};
const snapshot = new Map(Object.values(DOOR).map((d) => [d.old, structuredClone(store.get('zones', d.old))]));

for (const [id, t] of park) {
  const x = X0 + t.bc, y = Y0 + t.br, was = store.get('zones', id);
  if (!was) throw new Error(`${id} is gone`);
  const flags = { building_name: NAME, building_type: t.type, district: DISTRICT, entrance: t.facing, floors: t.floors, region_id: REGION, venue_lights: true, venue_roof: true };
  const base = { ambient_events: [], ambient_theme: 'urban', bg_color: '#2a1d18', color: '#d8c9a8', exits: {}, grid_x: x, grid_y: y, grid_z: 0, id, map_id: 'map_world', name: NAME, parent_zone: null };
  if (!t.door) { store.put('zones', { ...base, description: SLICE[roleOf(t)], flags }); continue; }
  const d = DOOR[t.type], old = snapshot.get(d.old);
  const [dx, dy] = CARDINAL[t.facing];
  d.id = id; d.x = x; d.y = y; d.facing = t.facing;
  d.streetAt = [x + dx, y + dy];
  store.put('zones', {
    ...base, bg_color: old.bg_color, color: old.color, description: d.describe || old.description, marker: d.marker,
    flags: { ...flags, facade: true, is_building: true, world_exit_zone: null },
  });
}

// ── 2. THE GROUND ────────────────────────────────────────────────────────────────────────────
const GREEN = [
  'Open grass behind the Hughson Coliseum, cut short. It\'s Sir Charles\'s ground, and the mowing comes out of the gate money.',
  'Mown grass and one bench. Halcyon\'s towers stand round the edge of the green and stop there.',
  'Flat grass worn thin along the line people walk from the boulevard to the gates. Nobody has put a path in.',
  'The green, level from the boulevard to Hughson Way. On a game night people bring blankets and listen to the crowd through the walls.',
];
const GREEN_EVENTS = [
  'Somebody cuts across the grass towards the gates with a folded scorecard.',
  'A dog runs a long circle round nothing and comes back.',
  'The wind brings over the smell of frying onions from Sorrel Way.',
];
const WAY = [
  'Hughson Way, the short road round Sir Charles\'s lot. It doesn\'t go anywhere but the park, and it\'s swept more often than the public streets.',
  'Hughson Way, two lanes and a kerb with the lot either side of it. Crowd barriers are stacked against a lamp post, ready for game night.',
];
const WAY_WALL = 'Hughson Way, under the Coliseum\'s limestone wall: marble fins, tall bronze windows and a copper cornice, with the dome standing over them.';
const CAR = [
  'Tarmac bays lined in white for the game-night crowd, with a concrete stop at the head of each. The blue sign on the post means Coliseum patrons, and nobody checks.',
  'Bays of tarmac with a lamp post and a kerb. The dome stands over the far end, and an attendant\'s folding chair is chained to the post.',
  'Bays lined in white, oil-marked down the middle. Ticket stubs have blown against the kerb and stayed there.',
];
const CAR_EVENTS = [
  'A car noses into a bay and the driver sits a minute with the engine off.',
  'Somebody walks the row twice, trying to remember where they parked.',
  'A car door shuts somewhere along the row, and the sound comes back off the Coliseum.',
];
const roadAt = (x, y) => y === 915 || (x === 892 && y >= 916) || (x === 897 && y <= 914);
const counts = { green: 0, way: 0, car: 0 };
for (let y = LOT.y0; y <= LOT.y1; y++) for (let x = LOT.x0; x <= LOT.x1; x++) {
  const id = parkId(x, y);
  if (inPark(id)) continue;
  const flags = { district: DISTRICT, region_id: REGION, street_life: true };
  const base = { ambient_theme: 'urban', exits: {}, grid_x: x, grid_y: y, grid_z: 0, id, map_id: 'map_world', parent_zone: null };
  if (roadAt(x, y)) {
    counts.way++;
    const underWall = (y === 915 && x >= X0) || (x === 892 && y >= Y0);
    store.put('zones', { ...base, ambient_events: [], ambient_theme: 'city', description: underWall ? WAY_WALL : pick(WAY, x, y), flags: { ...flags, scavenging_table_id: 'scav_roadside_junk', terrain: 'road' }, name: 'Hughson Way' });
  } else if (y < 915) {
    counts.green++;
    store.put('zones', { ...base, ambient_events: GREEN_EVENTS, color: '#8ba36a', description: pick(GREEN, x, y), flags: { ...flags, terrain: 'grass' }, name: 'Hughson Green' });
  } else {
    counts.car++;
    store.put('zones', {
      ...base, ambient_events: CAR_EVENTS, color: '#5a5f62', description: pick(CAR, x, y),
      flags: { ...flags, building_name: 'Hughson Car Park', building_type: 'car_park', entrance: 'east', floors: 1, terrain: 'asphalt' }, name: 'Hughson Car Park',
    });
  }
  const pz = store.get('power_zones', id);
  if (pz) store.patch('power_zones', id, { ...pz, name: store.get('zones', id).name });
}

// ── 3. THE GATES ─────────────────────────────────────────────────────────────────────────────
// Links from an old door into its rooms move to the new one; links from it to the world go.
const dropConns = new Set();
for (const d of Object.values(DOOR)) {
  const street = atTile(...d.streetAt);
  if (!street) throw new Error(`no street at ${d.streetAt}`);
  d.street = street;
  store.patch('zones', d.id, { flags: { ...store.get('zones', d.id).flags, world_exit_zone: street.id } });
  store.patch('maps', d.map, { parent_zone_id: d.id });
  for (const z of store.all('zones')) {
    if (z.id === d.id) continue;
    if (z.flags?.world_exit_zone === d.old) store.patch('zones', z.id, { flags: { ...z.flags, world_exit_zone: d.id } });
    if (z.parent_zone === d.old) store.patch('zones', z.id, { parent_zone: d.id });
  }
  for (const c of store.all('connections')) {
    if (c.a !== d.old && c.b !== d.old) continue;
    const other = store.get('zones', c.a === d.old ? c.b : c.a);
    if (other && other.map_id !== 'map_world') store.patch('connections', c.id, c.a === d.old ? { a: d.id } : { b: d.id });
    else dropConns.add(c.id);
  }
  store.put('connections', { a: d.id, b: street.id, blocked: false, dir: d.facing, id: `conn_hf_ballpark_${d.x}_${d.y}_${d.facing}`, lockable: false, one_way: false });
}

// ── 4. WALLS ROUND EVERY SEALED SLICE ────────────────────────────────────────────────────────
// Every wall on the lot goes, and a fresh one stands on each side of the park a neighbour could walk
// in from. The lot's ground opens onto its streets by geometry, with no connection files.
const lotIds = new Set();
for (let y = LOT.y0; y <= LOT.y1; y++) for (let x = LOT.x0; x <= LOT.x1; x++) lotIds.add(parkId(x, y));
for (const c of store.all('connections')) if (c.blocked && (lotIds.has(c.a) || lotIds.has(c.b))) dropConns.add(c.id);
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;
const cellOf = new Map(store.all('zones').filter((z) => z.map_id === 'map_world' && (z.grid_z ?? 0) === 0).map((z) => [`${z.grid_x},${z.grid_y}`, z]));
const walled = new Set();
let walls = 0;
for (const id of park.keys()) {
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

// ── 5. THE PROSE ROUND IT ────────────────────────────────────────────────────────────────────
const say = (id, description) => store.patch('zones', id, { description });
const window_ = (id, description) => { const z = store.get('zones', id); store.patch('zones', id, { flags: { ...z.flags, window: { ...z.flags.window, description } } }); };
say('zone_district_896_921', 'Sorrel Way outside the Hughson Coliseum\'s main gate, a stepped limestone frontispiece with the name in gilt over bronze doors. Cable covers run across the road in yellow rubber, feeding the floods. Crowd barriers are chained to the lamp posts.');
say('zone_district_894_921', 'The middle of Sorrel Way, under the Hughson Coliseum\'s south wall: limestone fins and lit windows along the north side, and the estate\'s chrome along the south. Ticket stubs collect in the gutter.');
say('zone_district_889_909', 'Halcyon Boulevard where Vetch Mews meets it, with Hughson Green open along the south side and the Coliseum\'s dome past the far end of it.');
say('zone_district_898_912', 'A paved yard between Hughson Way and Kettle Lane, where the food carts park in a row under tarpaulins: a lemonade cart, a candy-floss wheel, a cart of roasting chestnuts. On game nights they roll out to the gates.');
say('zone_district_898_916', 'The cut runs straight where the meadow ran shapeless, and stops at GATE C of the Hughson Coliseum, bronze doors in a stepped limestone front. The wind moves along it now instead of across it.');
say('zone_parkside_898_913', 'A low limestone pavilion on Sorrel Way, a short walk from the Coliseum, three barred ticket windows under a bronze canopy and BOX OFFICE in gilt over them. A queue rail of brass tube runs along the pavement in front.');
say('zone_hughsongd_hall', 'A tiled hall inside GATE D, with a turnstile and a bench under a faded fixture list. A ramp climbs east to the bleachers. The car park is through the doors behind you.');
window_('zone_hcbox_windows', 'Three windows onto Sorrel Way, each with a brass grille and a slot worn smooth at the bottom. The Coliseum\'s dome stands over the roofs to the south.');
window_('zone_mulcahy_bar', 'Green-painted windows with MULCAHY\'S in gold leaf, backwards from in here. Halcyon Boulevard is outside, and Hughson Green across the corner.');
window_('zone_sound_foyer', 'Five tall lights onto Sorrel Way, and through them the new road and the Coliseum\'s car park beyond it. The glass is very clean.');

// ── 6. EXITS FROM THE PROJECTED GRAPH ────────────────────────────────────────────────────────
const conns = store.all('connections').filter((c) => !dropConns.has(c.id));
const { edges } = projectEdges(store.all('zones'), conns);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
const near = (z) => (z.map_id === 'map_world' && z.grid_x >= LOT.x0 - 2 && z.grid_x <= LOT.x1 + 2 && z.grid_y >= LOT.y0 - 2 && z.grid_y <= LOT.y1 + 2)
  || Object.values(DOOR).some((d) => d.map === z.map_id);
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
console.log(`  ground: ${counts.green} green, ${counts.way} Hughson Way, ${counts.car} car park; ${walls} wall(s) round the park; exits rewritten on ${rewired} tile(s)`);
for (const d of Object.values(DOOR)) console.log(`  ${d.marker}: ${d.id} ${d.facing} onto ${d.street.id} (${d.street.name})`);
