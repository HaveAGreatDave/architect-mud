// One-shot: the Solenne's upper floors on the hourglass tower (client/game/js/panels/glass/models/solenne-profile.js),
// after solenne-rooms.mjs moved every flat down to floors 8 and 10.
//
//   node scripts/content/solenne-upper.mjs           lay out, check and write
//   node scripts/content/solenne-upper.mjs --dry     lay out and check, write nothing
//
// The stem narrows from the podium to a waist at floor 19 and widens again to the bowl. So:
//   - floors 8 and 10 keep their four flats a floor; floor 8's east flat is a new 8-B, cloned from 8-C as 8-G was;
//   - the gym (12) and Bishop's Blend (18) shrink with the stem, and the Aerie (19) is the waist: a glass viewing
//     room, glass on three sides;
//   - floors 24, 26 and 28 each get two flats, west and east of a narrow landing that runs north from the lift;
//   - floors 34, 36, 38 and 40, 23 to 25 m across, are one flat each, north of a short landing, just under the
//     penthouse. 38-B is Cyd's, back up from 8-B with everything in it (the zone keeps its id, so Scrappy, the
//     Cachet, the residents and the lease follow it); 34-A, 36-A and 40-A are premium flats furnished like it;
//   - the penthouse (44) grows with the wider bowl.
// The new flats are cloned: the zone, the en-suite, the doors, the connections, power and furniture.
// A run that fails a check writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';
import {
  roomSpecOf, withAnnex, annexFrame, layRows, roomLayout, placeSpot, seatApproach, roomPath, roomNearFree, doorwaysOf, hallOf,
  screenView, mayFaceScreen, pieceBoxes,
} from '../../client/shared/room-layout.js';
import { walkPlans, buildingView, buildingGraph, buildingLayout } from '../../client/shared/building-graph.js';
import { TILE_M } from '../../client/shared/world-scale.js';
import { usableAt, usableHalf, zRim } from '../../client/game/js/panels/glass/models/solenne-profile.js';

const C = path.resolve(process.cwd(), 'content');
const DRY = process.argv.includes('--dry');
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const readOne = (dir, id) => JSON.parse(fs.readFileSync(path.join(C, dir, `${id}.json`), 'utf8'));
const zones = readDir('zones'), maps = readDir('maps'), furniture = readDir('furniture');
const items = new Map(readDir('items').map((i) => [i.id, i]));
const Z = new Map(zones.map((z) => [z.id, z]));
const FU = new Map(furniture.map((f) => [f.id, f]));
const r2 = (x) => +x.toFixed(2);
const r1 = (x) => +x.toFixed(1);
const S = (k) => `zone_solenne_${k}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

if (Z.get(S('hall_38'))) { console.log('solenne-upper: already done'); process.exit(0); }

const writes = new Map(), fails = [];
const put = (dir, obj) => writes.set(`${dir}/${obj.id}.json`, obj);
const edit = (id, fn) => { const z = clone(Z.get(id)); fn(z); Z.set(id, z); put('zones', z); return z; };
const room = (id, patch, drop = []) => edit(id, (z) => { const r = { ...(z.flags.room || {}), ...patch }; for (const k of drop) delete r[k]; z.flags.room = r; });
// a connection id's suffix, from its name, so a second run makes the same rows
const suffix = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36).slice(-4).padStart(4, '0'); };
const newId = (s) => `${s}_${suffix(s)}`;
const OPP = { south: 'north', north: 'south', east: 'west', west: 'east' };

// ── the landings ───────────────────────────────────────────────────────────────────────────────────
// floor -> its grid layer. The fortieth floor's hall is `hall_40r`: `hall_40` is the Lantern, the old fortieth-floor
// hall that went up to the roof and kept its id.
const UPPER = { 24: { z: 10 }, 26: { z: 11 }, 28: { z: 12 }, 34: { z: 14 }, 36: { z: 15 }, 38: { z: 13 }, 40: { z: 16 } };
const ORD = { 24: 'twenty-fourth', 26: 'twenty-sixth', 28: 'twenty-eighth', 34: 'thirty-fourth', 36: 'thirty-sixth', 38: 'thirty-eighth', 40: 'fortieth' };
const TITLE = Object.fromEntries(Object.entries(ORD).map(([n, o]) => [n, `The ${o.replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())} Floor`]));
// the whole-floor flats, each north of a short landing: Cyd's 38-B, and the premium flats furnished like it
const WHOLE = { 34: { k: 'p', label: '34-A' }, 36: { k: 'q', label: '36-A' }, 38: { k: 'b', label: '38-B' }, 40: { k: 'r', label: '40-A' } };
const HALL = (fl) => S(Number(fl) === 40 ? 'hall_40r' : `hall_${fl}`);
// a whole-floor flat fills its floor north of the landing: the plate's width, from the landing to the far glass
const LAND_D = 2;
const wholeSize = (fl) => {
  const U = usableAt(Number(fl)), en = { w: 3.4, d: 2.6, dress: 'spa' };
  return { w: r1(2 * U - 0.6), d: r1(U + 1.1 - LAND_D + 1 - en.d - 0.6), ensuite: en };
};

// ── the flats ────────────────────────────────────────────────────────────────────────────────────────
// new letters i to o; `label` is what the door says
const FLATS = {
  i: { floor: 8, dir: 'west', label: '8-B', landing: S('residences'), grid: [1, -1, 3] },
  j: { floor: 24, dir: 'east', label: '24-A', grid: [-1, -1, 10] }, k: { floor: 24, dir: 'west', label: '24-B', grid: [1, -1, 10] },
  l: { floor: 26, dir: 'east', label: '26-A', grid: [-1, -1, 11] }, m: { floor: 26, dir: 'west', label: '26-B', grid: [1, -1, 11] },
  n: { floor: 28, dir: 'east', label: '28-A', grid: [-1, -1, 12] }, o: { floor: 28, dir: 'west', label: '28-B', grid: [1, -1, 12] },
};
for (const F of Object.values(FLATS)) F.landing ||= HALL(F.floor);
const RENT = { 8: 400, 24: 520, 26: 540, 28: 560 };
const SIDE = { 8: { w: 11.4, d: 7, ensuite: { w: 3.2, d: 2.6, dress: 'spa' } }, up: { w: 14, d: 4.4, ensuite: { w: 2.8, d: 1.8, dress: 'spa' } } };
const TEXT = {
  i: 'A one-bedroom on the east corner, glass on two sides: the bay on one and the long grey run of Coldwater on the other. Warm oak, a platform bed, a galley kitchen in grey stone, and the heating underfoot. Leave <b>west</b> to the landing.',
  j: 'A long one-bedroom down the west side of the {ord} floor, glass on three sides and the mountains filling the end of it. Oak, pale plaster, a platform bed, a galley kitchen in grey stone. Leave <b>east</b> to the landing.',
  k: 'A long one-bedroom down the east side of the {ord} floor, glass on three sides, the bay along the whole of it. Oak, pale plaster, a platform bed, a galley kitchen in grey stone. Leave <b>west</b> to the landing.',
};
const textOf = (k) => { const F = FLATS[k], t = k === 'i' ? TEXT.i : F.dir === 'east' ? TEXT.j : TEXT.k; return t.replace('{ord}', ORD[F.floor]); };

// clone 8-C for each new flat
const swap = (from, to) => (s) => s.replace(new RegExp(`apt_${from}(?=_|\\b|$)`, 'g'), `apt_${to}`).replace(new RegExp(`_${from}_`, 'g'), `_${to}_`).replace(new RegExp(`_${from}$`), `_${to}`);
const SRC = 'c';
for (const [k, F] of Object.entries(FLATS)) {
  const sw = swap(SRC, k), src = Z.get(S(`apt_${SRC}`)), bath = Z.get(S(`apt_${SRC}_bath`));
  const z = { ...clone(src), id: S(`apt_${k}`), exits: { in: S(`apt_${k}_bath`), [F.dir]: F.landing } };
  [z.grid_x, z.grid_y, z.grid_z] = F.grid;
  Z.set(z.id, z); put('zones', z);
  const b = { ...clone(bath), id: S(`apt_${k}_bath`), exits: { out: z.id }, parent_zone: z.id };
  Z.set(b.id, b); put('zones', b);
  for (const f of furniture.filter((x) => x.zone_id === src.id || x.zone_id === bath.id)) {
    const g = { ...clone(f), id: sw(f.id), zone_id: sw(f.zone_id) };
    if (FU.has(g.id)) throw new Error(`clone ${g.id} already exists`);
    FU.set(g.id, g); put('furniture', g);
  }
  for (const p of [src.id, bath.id]) { const pz = readOne('power_zones', p); put('power_zones', { ...pz, id: sw(p) }); }
  const conn = { a: z.id, b: F.landing, blocked: false, dir: F.dir, id: newId(`conn_solenne_apt_${k}_${F.dir}`), lockable: true, one_way: false };
  const bconn = { a: b.id, b: z.id, blocked: false, dir: 'out', id: newId(`conn_solenne_apt_${k}_bath_out`), lockable: true, one_way: false };
  put('connections', conn); put('connections', bconn);
  const door = readOne('doors', `door_solenne_apt_${SRC}`), bdoor = readOne('doors', `door_zone_solenne_apt_${SRC}_bath`);
  put('doors', { ...door, id: `door_solenne_apt_${k}`, connection_id: conn.id, exit_dir: F.dir, target_zone: F.landing, zone_id: z.id, name: `Residence ${F.label} hololock` });
  put('doors', { ...bdoor, id: `door_zone_solenne_apt_${k}_bath`, connection_id: bconn.id, target_zone: z.id, zone_id: b.id, tags: { ...bdoor.tags, 'lock:privacylock': { ...bdoor.tags['lock:privacylock'], privacySide: b.id } } });
  room(z.id, { ...(F.floor === 8 ? SIDE[8] : SIDE.up), h: 3, glass: F.floor === 8 ? ['front', 'left'] : ['front', 'left', 'right'], balcony: false, storeys: 45, finish: 'fine', ...(F.floor === 8 ? {} : { doors: { [F.dir]: 0 } }) });
  edit(z.id, (x) => { x.name = `Solenne Residence ${F.label}`; x.marker = String(F.floor); x.description = textOf(k); x.flags.rent_cost = RENT[F.floor]; });
  edit(b.id, (x) => { x.name = `Residence ${F.label} en-suite`; });
  put('power_zones', { ...writes.get(`power_zones/${z.id}.json`), name: `Solenne Residence ${F.label}` });
  put('power_zones', { ...writes.get(`power_zones/${b.id}.json`), name: `Residence ${F.label} en-suite` });
}

// the new landings, cloned from the nineteenth floor's hall (its light and power too), without the Aerie's sign
const hall41 = Z.get(S('hall_41'));
for (const [fl, U] of Object.entries(UPPER)) {
  const id = HALL(fl), ks = Object.keys(FLATS).filter((k) => FLATS[k].floor === Number(fl));
  const exits = { in: S('elevator'), ...Object.fromEntries(ks.map((k) => [OPP[FLATS[k].dir], S(`apt_${k}`)])) };
  const W = WHOLE[fl];
  if (W) exits.north = S(`apt_${W.k}`);
  const z = { ...clone(hall41), id, name: TITLE[fl], exits, grid_x: 0, grid_y: -1, grid_z: U.z };
  delete z.ambient_events;
  const R = z.flags.room;
  delete R.sign; delete R.decor.doors;
  if (W) Object.assign(R, { w: 6, d: LAND_D, doors: { north: 0 } });
  else Object.assign(R, { w: 2.4, d: 8, doors: { east: 0, west: 0 } });
  R.decor.plants = W ? [[2.35, 0.65, 0.85]] : [[0.6, 7.4, 0.8]];
  R.decor.sconces = W ? { points: [['back', -1.7], ['back', 1.7]], y: 1.8 } : { points: [['left', 5.5], ['right', 5.5], ['front', 0]], y: 1.8 };
  R.decor.plaques = W ? { [S(`apt_${W.k}`)]: W.label } : Object.fromEntries(ks.map((k) => [S(`apt_${k}`), FLATS[k].label]));
  const [w, e] = [ks.find((k) => FLATS[k].dir === 'east'), ks.find((k) => FLATS[k].dir === 'west')];
  z.description = W
    ? `The ${ORD[fl]} floor: a short hall in walnut and stone, one door in it. ${W.label} is <b>north</b>, and it is the whole floor. The elevator is <b>in</b> behind you.`
    : `The ${ORD[fl]} floor: a narrow hall in walnut and stone running north from the lift, a runner of dark carpet, a door each side. ${FLATS[w].label} is <b>west</b> and ${FLATS[e].label} <b>east</b>. The elevator is <b>in</b> behind you.`;
  Z.set(id, z); put('zones', z);
  put('power_zones', { ...readOne('power_zones', S('hall_41')), id, name: TITLE[fl] });
  const light = readOne('furniture', 'furn_light_zone_solenne_hall_41');
  const lf = { ...light, id: `furn_light_${id}`, zone_id: id };
  FU.set(lf.id, lf); put('furniture', lf);
  put('connections', { a: S('elevator'), b: id, blocked: false, dir: 'up', id: newId(`conn_solenne_elevator_up_${fl}`), lockable: false, one_way: true });
  put('connections', { a: id, b: S('elevator'), blocked: false, dir: 'in', id: newId(`conn_solenne_hall_${fl}_in`), lockable: false, one_way: true });
}

// ── 38-B: Cyd's flat up under the penthouse, the whole thirty-eighth floor north of its landing ─────────────
// One long wall of glass and two solid ones: the Cachet's bar wall stands on the east wall and the set on the back.
room(S('apt_b'), { ...wholeSize(38), doors: { south: 0 }, h: 3, glass: ['front', 'left'], balcony: false, storeys: 45, finish: 'fine' });
edit(S('apt_b'), (z) => {
  z.name = 'Solenne Residence 38-B'; z.marker = '38';
  z.exits = { in: S('apt_b_bath'), south: HALL(38) };
  [z.grid_x, z.grid_y, z.grid_z] = [0, -2, UPPER[38].z];
  z.description = 'The whole thirty-eighth floor north of the lift, glass on two sides and the city turning slowly past it as the light shifts. A platform bed on a silk Persian rug, a black computer desk in the corner of the glass, a card table by the bar. The heating is underfoot and the silence is total. This is what money buys when it stops needing to prove anything. Leave <b>south</b> to the landing.';
});
edit(S('apt_b_bath'), (z) => { z.name = 'Residence 38-B en-suite'; });
for (const p of [S('apt_b'), S('apt_b_bath')]) put('power_zones', { ...readOne('power_zones', p), name: p.endsWith('_bath') ? 'Residence 38-B en-suite' : 'Solenne Residence 38-B' });
put('connections', { ...readOne('connections', 'conn_solenne_apt_b_west_pd1x'), b: HALL(38), dir: 'south' });
put('doors', { ...readOne('doors', 'door_solenne_apt_b'), exit_dir: 'south', target_zone: HALL(38), name: 'Residence 38-B hololock' });

// ── the premium flats: whole floors furnished like 38-B ──────────────────────────────────────────────
// Cloned from 38-B with what's Cyd's own left behind: the card table and its chairs, the cat's things, the Cachet
// and what it hides, the boombox and the cigarette box. The set, the deck, the desk, the bonsai and the rest come.
const CYDS_OWN = /card_chair|apt_b_dining|cat_bowls|litter_tray|cachet|chem_lab|boombox|smokes/;
const PREMIUM_TEXT = {
  34: 'The whole thirty-fourth floor north of the lift, glass on three sides and the bay along the length of it. A platform bed on a Persian rug, a low sofa, a black desk in the corner of the glass, a bonsai juniper by the window. Pale stone, warm oak, heating underfoot. Leave <b>south</b> to the landing.',
  36: 'The whole thirty-sixth floor north of the lift: glass on three sides, the mountains at one end and the bay at the other. A platform bed on a Persian rug, a lounge chair turned to the view, a black desk, a paper lantern. Quiet enough to hear the lift go past. Leave <b>south</b> to the landing.',
  40: 'The whole fortieth floor north of the lift, two floors over 38-B and four under the penthouse, glass on three sides. A platform bed on a Persian rug, a low sofa facing the bay, a black desk in the corner, a bonsai juniper. At this height the weather goes past level with you. Leave <b>south</b> to the landing.',
};
const PREMIUM_RENT = { 34: 1100, 36: 1150, 40: 1300 };
const cyd = Z.get(S('apt_b')), cydBath = Z.get(S('apt_b_bath'));
for (const [fl, W] of Object.entries(WHOLE)) {
  if (W.k === 'b') continue;
  const k = W.k, sw = swap('b', k), id = S(`apt_${k}`), bid = `${id}_bath`;
  const z = { ...clone(cyd), id, name: `Solenne Residence ${W.label}`, marker: fl, description: PREMIUM_TEXT[fl], exits: { in: bid, south: HALL(fl) }, grid_x: 0, grid_y: -2, grid_z: UPPER[fl].z };
  z.flags.rent_cost = PREMIUM_RENT[fl];
  delete z.flags.owner_id; delete z.flags.owner; delete z.flags.tenant_id; delete z.flags.leased_to;
  z.flags.room = { ...z.flags.room, ...wholeSize(fl), doors: { south: 0 }, h: 3, glass: ['front', 'left', 'right'], balcony: false, storeys: 45, finish: 'fine' };
  Z.set(id, z); put('zones', z);
  const b = { ...clone(cydBath), id: bid, name: `Residence ${W.label} en-suite`, exits: { out: id }, parent_zone: id };
  Z.set(bid, b); put('zones', b);
  for (const f of [...FU.values()].filter((x) => (x.zone_id === cyd.id || x.zone_id === cydBath.id) && !CYDS_OWN.test(x.id))) {
    const g = { ...clone(f), id: sw(f.id), zone_id: sw(f.zone_id) };
    delete g.owner_id;
    if (g.id === f.id || FU.has(g.id)) throw new Error(`clone ${f.id} -> ${g.id}`);
    FU.set(g.id, g); put('furniture', g);
  }
  for (const p of [cyd.id, cydBath.id]) { const pz = readOne('power_zones', p); put('power_zones', { ...pz, id: sw(p), name: p.endsWith('_bath') ? `Residence ${W.label} en-suite` : `Solenne Residence ${W.label}` }); }
  const conn = { a: id, b: HALL(fl), blocked: false, dir: 'south', id: newId(`conn_solenne_apt_${k}_south`), lockable: true, one_way: false };
  const bconn = { a: bid, b: id, blocked: false, dir: 'out', id: newId(`conn_solenne_apt_${k}_bath_out`), lockable: true, one_way: false };
  put('connections', conn); put('connections', bconn);
  const door = readOne('doors', 'door_solenne_apt_b'), bdoor = readOne('doors', 'door_zone_solenne_apt_b_bath');
  put('doors', { ...door, id: `door_solenne_apt_${k}`, connection_id: conn.id, exit_dir: 'south', target_zone: HALL(fl), zone_id: id, name: `Residence ${W.label} hololock` });
  put('doors', { ...bdoor, id: `door_zone_solenne_apt_${k}_bath`, connection_id: bconn.id, target_zone: id, zone_id: bid, tags: { ...bdoor.tags, 'lock:privacylock': { ...bdoor.tags['lock:privacylock'], privacySide: bid } } });
}
// floor 8's east door is the new 8-B
edit(S('residences'), (z) => {
  z.exits.east = S('apt_i');
  const pl = z.flags.room.decor.plaques; delete pl[S('apt_b')]; pl[S('apt_i')] = '8-B';
});

// ── the floors the waist squeezes: the gym, Bishop's Blend and the Aerie, each north of its hall ──────────
const shrink = (id, fl, extra = {}) => { const U = usableAt(fl); room(id, { w: r1(Math.min(2 * U - 0.6, 22)), d: r1(U - 0.4), doors: { south: 0 }, ...extra }); };
shrink(S('gym'), 12);
shrink(S('salon'), 18);
shrink(S('aerie'), 19, { glass: ['front', 'left', 'right'] });
edit(S('aerie'), (z) => {
  z.description = 'The members\' room at the waist of the tower, nineteen floors up, where the Solenne is narrowest: glass on three sides, so the city is all round you and the stem flares away above and below. Deep chairs, a long bar, and staff who never ask your name twice. The hall is <b>south</b>.';
  const dec = z.flags.room.decor; delete dec.art; delete dec.plants;
  dec.sconces = { points: [['back', -3], ['back', 3]], y: 1.9 };
});
// ── the penthouse fills the wider bowl ───────────────────────────────────────────────────────────────
room(S('penthouse'), { w: 27.4, d: 10.3 });

// ── the lift ─────────────────────────────────────────────────────────────────────────────────────────
edit(S('elevator'), (z) => {
  const add = Object.keys(UPPER).map(Number).map((n) => ({ n, label: WHOLE[n] ? `Residence ${WHOLE[n].label}` : 'The Residences', zone: HALL(n) }));
  const stops = [...z.flags.elevator_floors.filter((s) => !add.some((a) => a.n === s.n) && Z.has(s.zone)), ...add].sort((a, b) => a.n - b.n);
  stops.find((s) => s.zone === S('hall_41')).label = 'The Aerie: members';
  z.flags.elevator_floors = stops; z.exits.up = stops.map((s) => s.zone);
});

// ── text elsewhere that names the flat ───────────────────────────────────────────────────────────────
{ const id = 'secdev_solenne_30b_door', o = readOne('furniture', id), s = JSON.stringify(o).replace(/\b\d+-B's door/g, "38-B's door");
  const next = JSON.parse(s); FU.set(id, next); put('furniture', next); }

// ── the furniture: every room that changed, its pieces placed again inside its new walls ────────────
// Cyd's set on his back wall east of the door, and his card table and its six chairs as one group by the bar
const W38 = wholeSize(38), TX = r1(W38.w / 2 - 4.2), TV = r1(W38.d / 2);
const FIXED = {
  furn_solenne_tv_apt_b: { wall: 'back', along: 5 },
  furn_solenne_apt_b_dining: { at: [TX, TV], turn: 90 },
  furn_solenne_b_card_chair_1: { at: [TX, r2(TV - 1.75)], turn: 180 }, furn_solenne_b_card_chair_4: { at: [TX, r2(TV + 1.75)], turn: 0 },
  furn_solenne_b_card_chair_2: { at: [r2(TX - 1.25), r2(TV - 0.5)], turn: 90 }, furn_solenne_b_card_chair_6: { at: [r2(TX - 1.25), r2(TV + 0.5)], turn: 90 },
  furn_solenne_b_card_chair_3: { at: [r2(TX + 1.25), r2(TV - 0.5)], turn: -90 }, furn_solenne_b_card_chair_5: { at: [r2(TX + 1.25), r2(TV + 0.5)], turn: -90 },
  furn_solenne_tv_apt_p: { wall: 'back', along: 5 }, furn_solenne_tv_apt_q: { wall: 'back', along: 5 }, furn_solenne_tv_apt_r: { wall: 'back', along: 5 },
};
const AS_SET = new Set();
const RESPOT = [...Object.values(WHOLE).map((W) => S(`apt_${W.k}`)), ...Object.keys(FLATS).map((k) => S(`apt_${k}`)), ...Object.keys(UPPER).map(HALL), S('gym'), S('salon'), S('aerie'), S('penthouse')];
// the room a piece's old spot was measured in: a new flat's is 8-C's, a premium flat's Cyd's, a new landing's the
// nineteenth floor's hall, and anything else its own file
const BEFORE = (id) => (Object.values(WHOLE).some((W) => id === S(`apt_${W.k}`)) ? S('apt_b') : Object.keys(FLATS).some((k) => id === S(`apt_${k}`)) ? S(`apt_${SRC}`) : Object.keys(UPPER).some((fl) => id === HALL(fl)) ? S('hall_41') : id);

const annexZoneOf = (z) => {
  const inner = z?.exits?.in ? Z.get(Array.isArray(z.exits.in) ? z.exits.in[0] : z.exits.in) : null;
  const out = inner?.exits?.out, back = Array.isArray(out) ? out[0] : out;
  return inner && back === z.id && inner.parent_zone === z.id ? inner : null;
};
const specById = (id) => {
  const z = Z.get(id);
  if (!z) return null;
  const mark = parseInt(z.marker, 10);
  const spec = roomSpecOf(z.flags, !!z.flags?.is_apartment, { storey: Number.isFinite(mark) ? mark : null });
  if (!spec) return null;
  const a = annexZoneOf(z);
  return a ? withAnnex(spec, a.id, a.name) : spec;
};
const itemOf = (f) => (f.flags?.item_id ? items.get(f.flags.item_id) || null : null);
const fp = (p) => { const q = Math.round((((p.turn % 360) + 360) % 360) / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [p.u - hw, p.u + hw, p.v - hd, p.v + hd]; };
function doorPoint(L) {
  const Sp = L.spec, o = doorwaysOf(Sp).find((x) => x.wall === 'back' && !x.annex) || doorwaysOf(Sp).find((x) => !x.annex) || null;
  if (!o) return roomNearFree(L, 0, Sp.d / 2, 3);
  const a = o.a, b = o.b, mid = (a + b) / 2, hall = o.wall === 'back' && hallOf(Sp, o);
  if (o.wall === 'back') return roomNearFree(L, mid, hall ? hall.v1 - 0.4 : Sp.d - 0.4, 1.2) || roomNearFree(L, mid, Sp.d - 0.6, 1.5);
  if (o.wall === 'front') return roomNearFree(L, mid, 0.5, 1.5);
  return roomNearFree(L, o.wall === 'left' ? -Sp.w / 2 + 0.5 : Sp.w / 2 - 0.5, mid, 1.5);
}
const plans = walkPlans({ zones: Z, maps, specOf: (z) => specById(z.id) });
const stageSpec = (id) => { const s = specById(id), b = s && plans.get(id); return b ? buildingView(b, id, s, { specOf: specById }).spec : s; };
const report = [];
for (const id of RESPOT) {
  const spec = stageSpec(id);
  if (!plans.get(id)) { fails.push(`${id}: not on the Solenne's walk`); continue; }
  const rows = [...FU.values()].filter((f) => f.zone_id === id && f.object_type !== 'light');
  const before = readOne('zones', BEFORE(id)).flags.room || {};
  const oldRoom = { w: Number(before.w) || spec.w, d: Number(before.d) || spec.d };
  // only the pieces with a spot of their own; the rest the Stage places itself, and the check below holds it to that
  const spotted = rows.filter((f) => (f.flags?.spot && !f.flags.spot.on) || FIXED[f.id]);
  const looks = layRows(spotted.map((f) => ({ ...f, flags: { ...(f.flags || {}), spot: undefined } })), spec, { finish: spec.finish, itemOf }).pieces;
  const placed = [], newSpot = new Map();
  looks.sort((a, b) => (FIXED[b.id] ? 1 : 0) - (FIXED[a.id] ? 1 : 0));
  for (const p of looks) {
    const row = spotted.find((f) => f.id === p.id), was = row.flags.spot || {};
    const tries = [];
    if (FIXED[p.id]) tries.push({ spot: FIXED[p.id], cost: -2 });
    if (was.wall) {
      const len = (w) => (w === 'front' || w === 'back' ? spec.w : spec.d), oldLen = (w) => (w === 'front' || w === 'back' ? oldRoom.w : oldRoom.d);
      const target = (w) => was.along * len(w) / oldLen(w);
      for (const wall of [was.wall, ...['left', 'right', 'front', 'back'].filter((x) => x !== was.wall)]) {
        const lo = wall === 'front' || wall === 'back' ? -spec.w / 2 : 0, hi = wall === 'front' || wall === 'back' ? spec.w / 2 : spec.d;
        for (let a = lo; a <= hi + 1e-6; a += 0.1) tries.push({ spot: { ...was, wall, along: r2(a) }, cost: Math.abs(a - target(wall)) + (wall === was.wall ? 0 : 20) });
      }
    } else if (was.at) {
      const tu = was.at[0] * spec.w / oldRoom.w, tv = Math.max(0.5, was.at[1]) * spec.d / oldRoom.d;
      for (let v = 0.3; v <= spec.d - 0.3 + 1e-6; v += 0.1) for (let u = -spec.w / 2 + 0.3; u <= spec.w / 2 - 0.3 + 1e-6; u += 0.1) for (const dt of [0, 90, -90, 180]) {
        tries.push({ spot: { at: [r2(u), r2(v)], turn: (((was.turn ?? 0) + dt + 540) % 360) - 180 }, cost: Math.hypot(u - tu, v - tv) + (dt ? 0.5 : 0) });
      }
    }
    tries.sort((a, b) => a.cost - b.cost);
    const hit = AS_SET.has(p.id) ? tries[0] : tries.find((t) => placeSpot(spec, placed, p.arche, p.dims, { crt: p.crt, form: p.form, test: t.spot }));
    if (!hit) { fails.push(`${id}: no room for ${p.id} (${p.name})`); if (process.env.DEBUG) console.log(JSON.stringify({ plan: spec.plan, dims: p.dims, arche: p.arche, placed: placed.map((q) => [q.id, q.spot, q.dims]) })); continue; }
    newSpot.set(p.id, hit.spot);
    placed.push({ ...p, spot: hit.spot });
  }
  let withSpots = rows.map((f) => (newSpot.has(f.id) ? { ...f, flags: { ...(f.flags || {}), spot: newSpot.get(f.id) } } : f));
  const annexId = spec.annex?.zone, annexRows = annexId ? [...FU.values()].filter((f) => f.zone_id === annexId && f.object_type !== 'light') : [];
  const layOut = (Sp) => {
    const main = layRows(withSpots, Sp, { finish: Sp.finish, itemOf }).pieces;
    const all = Sp.annex ? [...main, ...layRows(annexRows, annexFrame(Sp).spec, { annex: true, finish: Sp.annex.finish, itemOf }).pieces] : main;
    return { main, L: roomLayout(Sp, all) };
  };
  // nothing stands in front of a set (scripts/shapes/room-stage.mjs), laid out as the Stage does and as the gate does,
  // without the building's doorways. A set the Stage places itself that something blocks gets a wall of its own.
  const plain = specById(id);
  const blocked = (L) => L.placed.filter((sc) => sc.arche === 'screen' && !sc.annex).filter((sc) => {
    const r = screenView(sc), meets = (q) => q[0] < r[1] - 0.01 && q[1] > r[0] + 0.01 && q[2] < r[3] - 0.01 && q[3] > r[2] + 0.01;
    return L.placed.some((p) => p !== sc && !p.annex && !mayFaceScreen(p, sc) && pieceBoxes(p).some(meets));
  });
  for (const Sp of [plain, spec]) {
    for (const sc of blocked(layOut(Sp).L)) {
      const row = withSpots.find((f) => f.id === sc.id);
      if (row?.flags?.spot) { fails.push(`${id}: something stands in front of ${sc.id}`); continue; }
      const others = layOut(Sp).L.placed.filter((p) => p.id !== sc.id && !p.annex).map((p) => ({ ...p, spot: p.spot?.on ? p.spot : { at: [p.u, p.v], turn: p.turn } }));
      const at = placeSpot(Sp, others, 'screen', sc.dims, { crt: sc.crt, form: sc.form });
      if (!at) { fails.push(`${id}: no clear wall for ${sc.id}`); continue; }
      newSpot.set(sc.id, at);
      withSpots = withSpots.map((f) => (f.id === sc.id ? { ...f, flags: { ...(f.flags || {}), spot: at } } : f));
    }
  }
  for (const Sp of [plain, spec]) for (const sc of blocked(layOut(Sp).L)) fails.push(`${id}: something stands in front of ${sc.id}`);
  const { main, L } = layOut(spec);
  const lost = main.filter((p) => !L.placed.some((q) => q.id === p.id));
  if (lost.length) fails.push(`${id}: not laid out: ${lost.map((p) => p.name).join(', ')}`);
  for (const p of L.placed.filter((q) => !q.annex && !q.on)) {
    const f = fp(p);
    if (f[0] < -L.w / 2 - 1e-6 || f[1] > L.w / 2 + 1e-6 || f[2] < -1e-6 || f[3] > L.d + 1e-6) fails.push(`${id}: ${p.name} stands through a wall`);
  }
  const from = doorPoint(L);
  if (!from) fails.push(`${id}: no floor inside the door`);
  const stuck = L.seats.filter((s) => { const at = seatApproach(L, s, 1.8); return !(from && at && roomPath(L, from, at)); });
  if (stuck.length && process.env.DEBUG) console.log(id, 'from', JSON.stringify(from), 'doors', JSON.stringify(doorwaysOf(L.spec)), L.placed.filter((q) => !q.annex).map((q) => `${q.id.replace(/^furn_/, '')} u${q.u.toFixed(1)} v${q.v.toFixed(1)} ${q.w?.toFixed?.(1)}x${q.d?.toFixed?.(1)} t${q.turn}`).join(' | '));
  if (stuck.length) fails.push(`${id}: seats not reachable from the door: ${[...new Set(stuck.map((s) => s.piece))].join(', ')}`);
  for (const f of withSpots) if (newSpot.has(f.id)) { FU.set(f.id, f); put('furniture', f); }
  report.push(`${id.replace('zone_solenne_', '')}: ${spec.w} x ${spec.d} m, ${rows.length} pieces (${newSpot.size} moved), ${L.seats.length} seats`);
}

// ── the fit: the whole building laid out, every room inside the tower at its height ─────────────────
{
  // the tower's masses are solenne-profile.js's, the ones the arm draws
  const T = (x) => x * TILE_M, roof = T(zRim), usable = usableHalf;
  const bld = buildingGraph({ zones: Z, maps, specOf: (z) => specById(z.id) }).get('map_int_solenne');
  const P = buildingLayout(bld, { zones: Z, specOf: (z) => specById(z.id) });
  if (P.problems?.length) fails.push(`layout problems: ${JSON.stringify(P.problems)}`);
  const front = (P.doors || []).find((d) => d.kind === 'front' && d.from === S('lobby'));
  const EDGE = 0.47 * TILE_M, ctr = [-0.5 * TILE_M, 0.5 * TILE_M], dx = -front.at[0], dn = -EDGE - front.at[2];
  // The lobby's street wall stands at the street door, which the Stage puts at EDGE, 0.47 tiles out from the facade
  // tile's middle: 0.97 from the block's, against the podium's 0.88. The portal and the porte-cochère cover that
  // 1.6 m; every building has the gap (multi-tile-buildings.md, open questions), and the podium can't come out to
  // meet it, because each quarter is at the 0.44 clamp already.
  for (const [id, R] of Object.entries(P.rooms)) {
    const f = R.foot || [R.box[0], R.box[1], R.box[4], R.box[5]];
    const x0 = f[0] + dx - ctr[0], x1 = f[1] + dx - ctr[0], n0 = f[2] + dn - ctr[1], n1 = f[3] + dn - ctr[1];
    const z = Z.get(id), open = z?.flags?.open_sky || z?.flags?.room?.open, top = R.floor + (open ? 0.1 : R.h);
    const half = R.floor >= roof - 0.05 ? T(0.84 - 0.008) : usable(R.floor, top);
    const slack = (0.97 - 0.88) * TILE_M + 0.05;
    const over = Math.max(-x0 - half, x1 - half, -n0 - (id === S('lobby') ? half + slack : half), n1 - half);
    report.push(`${over > 0.05 ? 'OUT ' : ' ok '}${id.replace('zone_solenne_', '').padEnd(14)} floor ${R.floor.toFixed(1).padStart(6)}  x ${x0.toFixed(1)}..${x1.toFixed(1)}  n ${n0.toFixed(1)}..${n1.toFixed(1)}  plate ±${half.toFixed(1)}`);
    if (over > 0.05) fails.push(`${id} stands ${over.toFixed(2)} m outside the tower`);
  }
}

for (const line of report) console.log(line);
if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`\n✗ solenne-upper: ${fails.length} problem(s); nothing written`);
  process.exit(1);
}
let wrote = 0;
for (const [rel, data] of writes) {
  const file = path.join(C, rel), json = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json) continue;
  if (!DRY) fs.writeFileSync(file, json);
  wrote++;
}
console.log(`✓ solenne-upper: ${wrote} files ${DRY ? 'to write' : 'written'}`);
