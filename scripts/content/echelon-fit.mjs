// THE ECHELON'S ROOMS, FITTED TO HER HULL (docs/proposals/echelon-decks.md).
//
//   node scripts/content/echelon-fit.mjs            write the rooms' flags.room, grid and exits, and the stair files
//   node scripts/content/echelon-fit.mjs --check    write nothing; fail if a file differs from what this would write
//
// Rooms fit the model (docs/reference/building-styles.md): every room's size, the taper and lean of its walls, its raked
// screen, its height and where its stairs are come from client/shared/yacht-hull.js, the table GLASS draws her from.
// Edit a number there or here and run this, never the zone files by hand. It writes only `flags.room` (keeping the
// decor, tone and anything else a room already carries), `grid_x/y/z`, `exits`, and the connection files for her stairs
// and the suite's hatch.
//
// Her decks, bow (north) to stern:
//   lower deck, in the hull:  Broadcast Complex | Engineering Corridor | Engine Room
//   main deck, tier 0:        Cyd's Suite (+ head) | Boarding Foyer | Stern Lounge | Helipad (open, aft deck)
//   owner's deck, tier 1:     Stair Landing
//   bridge deck, tier 2:      Bridge
//   sun deck, tier 2's roof:  Sun Deck (open)
import fs from 'node:fs';
import path from 'node:path';
import { YACHT_TIERS, YACHT_DECKZ, YACHT_RAKE, YACHT_PAD_OY, YACHT_BOW, YACHT_LEN, M_OX, M_OY, M_Z, yachtHullAt } from '../../client/shared/yacht-hull.js';
import { ROOM_GAP } from '../../client/shared/building-graph.js';

const CHECK = process.argv.includes('--check');
const C = path.resolve(process.cwd(), 'content');
const r2 = (x) => Math.round(x * 100) / 100;

// ── the ship in metres: `fz` is metres forward of her origin, so the bow is +33 and the transom −22 ──
const fz = (oy) => -oy * M_OY;
const DECK = 3.0;                                 // deck to deck, metres; the tiers are 3.0, 2.99 and 2.93
const LINING = 0.15;                              // the house's skin inboard of its glass
const HULL_IN = 0.35;                             // the hull's frames and lining, inboard of the plating
const T = YACHT_TIERS.map((t) => ({ fore: fz(t.fore), aft: fz(t.aft), half: t.hw * M_OX - LINING, head: t.hwT * M_OX - LINING, deck: t.deck * M_OX }));
const hullHalfAt = (f) => yachtHullAt(-f / M_OY)[0] * M_OX;   // the hull's half-beam at `fz`
const TRANSOM = fz(YACHT_BOW + YACHT_LEN);
const RAKE = YACHT_RAKE * M_OY;

// ── a room of a face-0 or face-180 run along her length: [fore, aft] in fz, and its sides from the hull or a tier ──
// `side(f)` is [floor half-width, head half-width] at fz `f`. v runs back from the front wall: aft for face 0, forward
// for face 180.
function sides(fore, aft, face, side, n = 4) {
  const d = fore - aft, rows = [];
  for (let i = 0; i <= n; i++) { const v = d * i / n, f = face === 0 ? fore - v : aft + v, [a, b] = side(f); rows.push([r2(v), r2(a), r2(b)]); }
  return rows;
}
const tierSide = (t) => () => [T[t].half, T[t].head];
const hullSide = (inset, flare = 0.15) => (f) => { const h = hullHalfAt(f) - inset; return [h, h + flare]; };
const widest = (rows) => r2(Math.max(...rows.map((r) => Math.max(r[1], r[2]))) * 2);

// ── the main deck, fore to aft, each room butted against the next across ROOM_GAP ──
const SUITE_D = 4.6, SUITE_BATH = { w: 3, d: 2.2, finish: 'fine' }, FOYER_W = 3.6;
const suite = { fore: T[0].fore, aft: T[0].fore - SUITE_D };
const suiteDeep = 0.14 + SUITE_BATH.d;            // building-graph.js deepOf: WALL_T + the en-suite
const foyer = { fore: suite.aft - suiteDeep - ROOM_GAP };
foyer.aft = foyer.fore - FOYER_W;
const stern = { fore: foyer.aft - ROOM_GAP, aft: T[0].aft };
const pad = { fore: stern.aft - ROOM_GAP, aft: TRANSOM + 0.45 };
const foyerMid = (foyer.fore + foyer.aft) / 2;

// ── the lower deck: the corridor under the foyer, the studio forward of it and the engines aft ──
const CORRIDOR_D = 6.0;
const corridor = { fore: foyerMid + CORRIDOR_D / 2, aft: foyerMid - CORRIDOR_D / 2 };
const broadcast = { fore: corridor.fore + ROOM_GAP + 6.0, aft: corridor.fore + ROOM_GAP };
const engine = { fore: corridor.aft - ROOM_GAP, aft: corridor.aft - ROOM_GAP - 9.0 };

// ── up the house: the landing over the foyer, the bridge filling tier 2, the sun deck on its roof ──
const LANDING_D = 4.0;
const landing = { fore: foyerMid + LANDING_D / 2, aft: foyerMid - LANDING_D / 2 };
const bridge = { fore: T[2].fore, aft: T[2].aft + 0.15 };
// the sun deck is tier 2's roof plate, which the model carries a little past the house at each end
const sun = { fore: fz(YACHT_TIERS[2].fore + YACHT_RAKE - 0.012), aft: fz(YACHT_TIERS[2].aft + 0.018) };
// the companionway up to it, where drawYacht's hatch is (sunAft - 0.046)
const HATCH = fz(YACHT_TIERS[2].aft + 0.018 - 0.046);
// a point at fz `f` as v in a face-0 room's frame
const v0 = (R, f) => r2(R.fore - f);

const rooms = {
  zone_echelon_suite: {
    grid: [0, -1, 1], face: 0, d: SUITE_D, h: DECK, glass: ['front', 'left', 'right'],
    hull: { sides: sides(suite.fore, suite.aft, 0, tierSide(0), 1), rake: r2(RAKE) }, ensuite: SUITE_BATH,
    // the hatch to the foyer in the middle of the back wall, beside the head (a flat's door defaults to a corner)
    doors: { south: 0 },
    exits: { south: 'zone_echelon_foyer', in: 'zone_echelon_suite_bath' },
  },
  zone_echelon_foyer: {
    // face 90: its front wall is her starboard side, where the gangway door is, and her fore and aft are its sides
    grid: [0, 0, 1], face: 90, w: FOYER_W, d: r2(T[0].half * 2), h: DECK, glass: ['front'],
    doors: { up: [-0.9, r2(T[0].half)], down: [0.9, r2(T[0].half)] },
    exits: { north: 'zone_echelon_suite', south: 'zone_echelon_stern', up: 'zone_echelon_landing', down: 'zone_echelon_engineering', out: 'zone_echelon_exterior' },
  },
  zone_echelon_stern: {
    // face 180: its front is the aft glass onto the helipad
    grid: [0, 1, 1], face: 180, d: r2(stern.fore - stern.aft), h: DECK, glass: ['front', 'left', 'right'],
    hull: { sides: sides(stern.fore, stern.aft, 180, tierSide(0), 1) },
    exits: { north: 'zone_echelon_foyer', south: 'zone_echelon_helipad' },
  },
  zone_echelon_helipad: {
    grid: [0, 2, 1], face: 180, d: r2(pad.fore - pad.aft), h: DECK, open: true,
    hull: { sides: sides(pad.fore, pad.aft, 180, hullSide(0.25, 0), 6), deck: true },
    pad: { at: [0, r2(fz(YACHT_PAD_OY) - pad.aft)], r: 4.8 },
    exits: { north: 'zone_echelon_stern' },
  },
  zone_echelon_engineering: {
    grid: [0, 0, 0], face: 0, w: 2.6, d: CORRIDOR_D, h: DECK, windowless: true,
    // the stair up comes out where the foyer's `down` is (building-graph.js stacks the two by them)
    doors: { up: [0, v0(corridor, foyerMid - 0.9)] },
    exits: { north: 'zone_echelon_broadcast', south: 'zone_echelon_engine', up: 'zone_echelon_foyer' },
  },
  zone_echelon_broadcast: {
    grid: [0, -1, 0], face: 0, d: r2(broadcast.fore - broadcast.aft), h: DECK, windowless: true,
    hull: { sides: sides(broadcast.fore, broadcast.aft, 0, hullSide(HULL_IN), 3) },
    exits: { south: 'zone_echelon_engineering' },
  },
  zone_echelon_engine: {
    grid: [0, 1, 0], face: 180, d: r2(engine.fore - engine.aft), h: DECK, windowless: true,
    hull: { sides: sides(engine.fore, engine.aft, 180, hullSide(HULL_IN), 3) },
    exits: { north: 'zone_echelon_engineering' },
  },
  zone_echelon_landing: {
    grid: [0, 0, 2], face: 0, d: LANDING_D, h: DECK, glass: ['left', 'right'],
    hull: { sides: sides(landing.fore, landing.aft, 0, tierSide(1), 1) },
    doors: { down: [0, v0(landing, foyerMid + 0.9)], up: [0, v0(landing, foyerMid - 1.0)] },
    exits: { down: 'zone_echelon_foyer', up: 'zone_echelon_bridge' },
  },
  zone_echelon_bridge: {
    grid: [0, 0, 3], face: 0, d: r2(bridge.fore - bridge.aft), h: DECK, glass: ['front', 'left', 'right'],
    hull: { sides: sides(bridge.fore, bridge.aft, 0, tierSide(2), 1), rake: r2(RAKE) },
    doors: { down: [0, v0(bridge, foyerMid - 1.0)], up: [0, v0(bridge, HATCH)] },
    exits: { down: 'zone_echelon_landing', up: 'zone_echelon_sundeck' },
  },
  zone_echelon_sundeck: {
    grid: [0, 0, 4], face: 0, d: r2(sun.fore - sun.aft), h: DECK, open: true,
    hull: { sides: sides(sun.fore, sun.aft, 0, () => [T[2].deck - 0.12, T[2].deck - 0.12], 1), deck: true },
    doors: { down: [0, v0(sun, HATCH)] },
    exits: { down: 'zone_echelon_bridge' },
  },
};
for (const R of Object.values(rooms)) if (R.hull && !R.w) R.w = widest(R.hull.sides);
// Every flight is on her centreline. The foyer faces starboard, so its `up` (u -0.9) is 0.9 m forward of its middle
// and its `down` 0.9 m aft; the rooms over and under it put theirs at the same fz, and building-graph.js stacks each
// pair by them (across). buildingLayout's gate fails a pair that doesn't meet.

// ── write ──
const changed = [];
const put = (file, obj) => {
  const p = path.join(C, file), text = JSON.stringify(obj, null, 2) + '\n';
  const was = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (was === text) return;
  changed.push(file);
  if (!CHECK) fs.writeFileSync(p, text);
};
const sortKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
for (const [id, R] of Object.entries(rooms)) {
  const file = `zones/${id}.json`, z = JSON.parse(fs.readFileSync(path.join(C, file), 'utf8'));
  const room = { ...(z.flags.room || {}) };
  for (const k of ['w', 'd', 'h', 'face', 'glass', 'hull', 'doors', 'ensuite', 'windowless', 'open']) delete room[k];
  Object.assign(room, { w: R.w, d: R.d, h: R.h, face: R.face });
  if (R.glass) room.glass = R.glass;
  if (R.hull) room.hull = R.hull;
  if (R.doors) room.doors = R.doors;
  if (R.ensuite) room.ensuite = R.ensuite;
  if (R.windowless) room.windowless = true;
  if (R.open) room.open = true;
  if (R.pad) room.decor = { ...(room.decor || {}), pad: R.pad };
  z.flags.room = room;
  [z.grid_x, z.grid_y, z.grid_z] = R.grid;
  z.exits = R.exits;
  put(file, sortKeys(z));
}
// her plan's middle (the foyer's) in her own frame, and her main deck over the water, for one-world to put her rooms on
// her hull (plugins/roomstage buildingRoomsNear)
{
  const file = 'zones/zone_echelon_exterior.json', z = JSON.parse(fs.readFileSync(path.join(C, file), 'utf8'));
  z.flags.vessel_plan = { deck_m: r2(YACHT_DECKZ * M_Z), fz: r2(foyerMid) };
  put(file, sortKeys(z));
}
const conn = (id, a, b, dir, extra = {}) => put(`connections/${id}.json`, sortKeys({ a, b, blocked: false, dir, id, lockable: false, one_way: false, ...extra }));
conn('conn_echelon_landing_up_xy1p', 'zone_echelon_landing', 'zone_echelon_bridge', 'up');
conn('conn_echelon_bridge_up_sun1', 'zone_echelon_bridge', 'zone_echelon_sundeck', 'up');
conn('conn_echelon_foyer_north_cyd1', 'zone_echelon_foyer', 'zone_echelon_suite', 'north', { lockable: true });
const gone = path.join(C, 'connections/conn_echelon_landing_north_zvua.json');
if (fs.existsSync(gone)) { changed.push('connections/conn_echelon_landing_north_zvua.json (deleted)'); if (!CHECK) fs.unlinkSync(gone); }
{
  const file = 'doors/door_echelon_suite.json', d = JSON.parse(fs.readFileSync(path.join(C, file), 'utf8'));
  Object.assign(d, { connection_id: 'conn_echelon_foyer_north_cyd1', zone_id: 'zone_echelon_foyer', exit_dir: 'north' });
  put(file, sortKeys(d));
}

console.log(`echelon-fit: ${changed.length ? (CHECK ? 'would change ' : 'wrote ') + changed.join(', ') : 'every file already fits'}`);
console.log(`  main deck: suite ${r2(suite.fore)}..${r2(suite.aft)}, foyer ${r2(foyer.fore)}..${r2(foyer.aft)}, stern ${r2(stern.fore)}..${r2(stern.aft)}, pad ${r2(pad.fore)}..${r2(pad.aft)} (fz, metres)`);
console.log(`  lower: broadcast ${r2(broadcast.fore)}..${r2(broadcast.aft)}, corridor ${r2(corridor.fore)}..${r2(corridor.aft)}, engine ${r2(engine.fore)}..${r2(engine.aft)}`);
console.log(`  up: landing ${r2(landing.fore)}..${r2(landing.aft)}, bridge ${r2(bridge.fore)}..${r2(bridge.aft)}, sun deck ${r2(sun.fore)}..${r2(sun.aft)}, hatch ${r2(HATCH)}`);
if (CHECK && changed.length) process.exit(1);
