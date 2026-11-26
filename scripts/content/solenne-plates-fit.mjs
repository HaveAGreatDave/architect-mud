// One-shot: the Solenne's rooms refitted to the stacked-plate tower (docs/proposals/solenne-plates.md), every room
// inside the glass box that client/shared/solenne-plates.js gives the GLASS arm.
//
//   node scripts/content/solenne-plates-fit.mjs           lay out, check and write
//   node scripts/content/solenne-plates-fit.mjs --dry     lay out and check, write nothing
//
// The lift is in the middle of the plate, entered from the back of the lobby, which is 6.5 m deep. Floors:
//   1 to 3     the lobby, Sweat Equity and Bishop's Blend, in the podium
//   4, 5       three flats each round a short landing: west, south-east and north-east
//   6, 8, 10   two flats each, west and east of a corridor
//   14         the Aerie
//   16, 18     one flat each: the flat (west, with its en-suite) and its east room, off a landing private to it
//   20 to 27   four premium flats on two storeys each: as a whole floor, with a stair up to a room across the north half
//   28 to 31   the penthouse: as a whole floor, then three storeys up its stair
//   32         the lift's top landing, a flight under the roof deck: the Lantern, the sky deck and the pad
// Every flat keeps its zone id (so its lease, its residents, Cyd's cat and the Cachet go with it) and takes the label
// of its new floor. A run that fails a check writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';
import {
  roomSpecOf, withAnnex, annexFrame, layRows, roomLayout, placeSpot, seatApproach, roomPath, roomNearFree, doorwaysOf, hallOf,
  screenView, mayFaceScreen, pieceBoxes,
} from '../../client/shared/room-layout.js';
import { walkPlans, buildingView, buildingGraph, buildingLayout } from '../../client/shared/building-graph.js';
import { TILE_M } from '../../client/shared/world-scale.js';
import { BOX, PODIUM, CROWN, STOREY, floorM, plateProblems } from '../../client/shared/solenne-plates.js';

const C = path.resolve(process.cwd(), 'content');
const DRY = process.argv.includes('--dry');
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const readOne = (dir, id) => JSON.parse(fs.readFileSync(path.join(C, dir, `${id}.json`), 'utf8'));
const has = (dir, id) => fs.existsSync(path.join(C, dir, `${id}.json`));
const zones = readDir('zones'), maps = readDir('maps'), furniture = readDir('furniture'), connections = readDir('connections'), doorRows = readDir('doors');
const items = new Map(readDir('items').map((i) => [i.id, i]));
const Z = new Map(zones.map((z) => [z.id, z]));
const FU = new Map(furniture.map((f) => [f.id, f]));
const r2 = (x) => +x.toFixed(2);
const S = (k) => `zone_solenne_${k}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

if (Z.get(S('hall_u16'))) { console.log('solenne-plates-fit: already done'); process.exit(0); }

const writes = new Map(), fails = [];
const put = (dir, obj) => writes.set(`${dir}/${obj.id}.json`, obj);
const edit = (id, fn) => { const z = clone(Z.get(id)); fn(z); Z.set(id, z); put('zones', z); return z; };
const suffix = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36).slice(-4).padStart(4, '0'); };
const newId = (s) => `${s}_${suffix(s)}`;
const OPP = { south: 'north', north: 'south', east: 'west', west: 'east', up: 'down', down: 'up' };
for (const p of plateProblems()) fails.push(`plates: ${p}`);

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────
// Every rect is [x0, x1, n0, n1] in metres in the tower tile's frame (x east, n north), the room's own floor only.
// A wall's name in a room's frame from its compass side: face 0 has its front north, face 180 its front south.
const REL = { 0: { north: 'front', south: 'back', west: 'left', east: 'right' }, 180: { south: 'front', north: 'back', east: 'left', west: 'right' } };
const WALL_T = 0.14, deepOf = (en) => (en ? r2(WALL_T + en.d) : 0);
const { x0: XL, x1: XR, n0: SB, n1: NB } = BOX;
const LIFT = [-1.1, 1.1];
const LAND_N0 = 0.87;   // the landings stand north of the lift, 0.28 off its car
const EN = { w: 2.8, d: 1.8, dress: 'spa' };   // a flat's en-suite on the plates (the premium flats keep their own)
// `doors` is { dir: where along that wall, in absolute metres: x on a north or south wall, n on an east or west one }
function setRoom(id, { face = 0, rect, glass = [], doors = {}, ensuite, extra = {}, drop = [] }) {
  const [x0, x1, n0, n1] = rect, cx = (x0 + x1) / 2, cn = (n0 + n1) / 2;
  const off = {};
  for (const [dir, at] of Object.entries(doors)) off[dir] = r2(dir === 'north' || dir === 'south' || dir === 'in' ? at - cx : at - cn);
  edit(id, (z) => {
    const r = { ...(z.flags.room || {}), w: r2(x1 - x0), d: r2(n1 - n0), face, doors: off, glass: glass.map((g) => REL[face][g]), balcony: false, ...extra };
    if (ensuite) r.ensuite = ensuite;
    for (const k of drop) delete r[k];
    if (!r.glass.length) delete r.glass;
    z.flags.room = r;
  });
}

// ── the connections and doors between two rooms ──────────────────────────────────────────────────────
const connBetween = (a, b) => [...connections, ...[...writes.entries()].filter(([k]) => k.startsWith('connections/')).map(([, v]) => v)]
  .find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
// rewrite (or make) the link from `a` to `b` going `dir`, with the exits on both zones; `lock` copies a flat's
// hololock door from `lockFrom` onto it
function link(a, dir, b, { lockable = true, door = null } = {}) {
  edit(a, (z) => { z.exits = { ...z.exits, [dir]: b }; });
  edit(b, (z) => { z.exits = { ...z.exits, [OPP[dir]]: a }; });
  const old = connBetween(a, b);
  const row = old ? { ...old, ...(old.a === a ? { dir } : { dir: OPP[dir] }) } : { a, b, blocked: false, dir, id: newId(`conn_${a.replace('zone_', '')}_${dir}`), lockable, one_way: false };
  put('connections', row);
  const d = doorRows.find((x) => x.connection_id === row.id) || (door ? { ...door } : null);
  if (d) {
    const fromSide = d.zone_id === b ? b : a, to = fromSide === a ? b : a;
    put('doors', { ...d, connection_id: row.id, zone_id: fromSide, target_zone: to, exit_dir: fromSide === a ? dir : OPP[dir] });
  }
  return row;
}
// drop an exit from a zone (and nothing else: the link it was on is rewritten by `link`)
const unexit = (id, ...dirs) => edit(id, (z) => { for (const d of dirs) delete z.exits[d]; });

// ── the floors ───────────────────────────────────────────────────────────────────────────────────────
const ORD = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 8: 'eighth', 10: 'tenth', 14: 'fourteenth', 16: 'sixteenth', 18: 'eighteenth', 20: 'twentieth', 21: 'twenty-first', 22: 'twenty-second', 23: 'twenty-third', 24: 'twenty-fourth', 25: 'twenty-fifth', 26: 'twenty-sixth', 27: 'twenty-seventh', 28: 'twenty-eighth', 29: 'twenty-ninth', 30: 'thirtieth', 31: 'thirty-first', 32: 'thirty-second' };
const Title = (n) => `The ${ORD[n].replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())} Floor`;
const stops = [];
const mark = (id, n) => edit(id, (z) => { z.marker = String(n); z.grid_z = n; });
const landing = (id, n, { rect, doors, label, name = Title(n), text, extra = {} }) => {
  setRoom(id, { face: 0, rect, doors: { in: 0, ...doors }, extra: { windowless: true, ...extra } });
  edit(id, (z) => { z.name = name; z.description = text; z.grid_x = 0; z.grid_y = -1; });
  mark(id, n);
  stops.push({ n, label, zone: id });
};
const flatText = {
  W: (lbl, ord, way) => `A long flat down the west side of the ${ord} floor, glass along the length of it and the mountains at the far end. Oak, pale plaster, a platform bed, a galley kitchen in grey stone, heating underfoot. Leave <b>${way}</b> to the landing.`,
  E: (lbl, ord, way) => `A long flat down the east side of the ${ord} floor, glass along the length of it and the bay below. Oak, pale plaster, a platform bed, a galley kitchen in grey stone. Leave <b>${way}</b> to the landing.`,
  SE: (lbl, ord, way) => `A one-bedroom in the south-east corner of the ${ord} floor, the long glass wall looking down Marrow Street. Warm oak, a platform bed, a galley kitchen. Leave <b>${way}</b> to the landing.`,
  NE: (lbl, ord, way) => `A one-bedroom across the north end of the ${ord} floor, glass on two sides and the gardens below. Warm oak, a platform bed, a galley kitchen. Leave <b>${way}</b> to the landing.`,
};
// a flat: its name, door label, rent and text
const label = (id, lbl, rent, text) => {
  edit(id, (z) => { z.name = `Solenne Residence ${lbl}`; z.description = text; if (rent) z.flags.rent_cost = rent; });
  const bath = Z.get(`${id}_bath`);
  if (bath) edit(bath.id, (z) => { z.name = `Residence ${lbl} en-suite`; });
  for (const p of [id, `${id}_bath`]) if (has('power_zones', p)) put('power_zones', { ...readOne('power_zones', p), name: p.endsWith('_bath') ? `Residence ${lbl} en-suite` : `Solenne Residence ${lbl}` });
  if (has('doors', `door_solenne_${id.replace('zone_solenne_', '')}`)) put('doors', { ...readOne('doors', `door_solenne_${id.replace('zone_solenne_', '')}`), name: `Residence ${lbl} hololock` });
};

// the podium
setRoom(S('lobby'), { face: 180, rect: [-7.5, 7.5, -8.39, -1.89], doors: { in: 0, south: 0 }, extra: {}, glass: [] });
edit(S('lobby'), (z) => { const r = z.flags.room; r.glass = ['front']; delete r.balcony; });
const PH = PODIUM.half - 0.3;
for (const [n, hall, room, lbl] of [[2, 'hall_12', 'gym', 'Fitness Club'], [3, 'hall_18', 'salon', "Bishop's Blend"]]) {
  landing(S(hall), n, { rect: [-3, 3, LAND_N0, 2.87], doors: { north: 0 }, label: lbl, name: Z.get(S(hall)).name, text: Z.get(S(hall)).description });
  setRoom(S(room), { face: 0, rect: [-PH, PH, 3.15, PH], doors: { south: 0 }, glass: ['north', 'east', 'west'] });
  mark(S(room), n);
}

// floors 4 and 5: three flats round a short landing
const THREE = [
  { n: 4, hall: 'residences', W: 'a', SE: 'c', NE: 'g' },
  { n: 5, hall: 'residences_34', W: 'd', SE: 'e', NE: 'f' },
];
const L3 = [-2.4, 1.1, LAND_N0, 2.87], L3m = (L3[2] + L3[3]) / 2, L3x = (L3[0] + L3[1]) / 2;
for (const F of THREE) {
  const h = S(F.hall), W = S(`apt_${F.W}`), SE = S(`apt_${F.SE}`), NE = S(`apt_${F.NE}`);
  for (const id of [h, W, SE, NE]) unexit(id, 'north', 'south', 'east', 'west');
  landing(h, F.n, { rect: L3, doors: { in: 0, west: L3m, east: L3m, north: L3x }, label: 'The Residences', name: Title(F.n),
    text: `The ${ORD[F.n]} floor: a short landing in walnut and stone, three doors off it. ${F.n}-A is <b>west</b>, ${F.n}-B <b>east</b> and ${F.n}-C <b>north</b>. The elevator is <b>in</b> behind you.` });
  edit(h, (z) => { z.flags.room.doors.in = r2(0 - L3x); z.flags.room.decor = { ...(z.flags.room.decor || {}), plaques: { [W]: `${F.n}-A`, [SE]: `${F.n}-B`, [NE]: `${F.n}-C` }, plants: [], sconces: { points: [['back', -1.2]], y: 1.8 } }; });
  setRoom(W, { face: 180, rect: [XL, L3[0] - 0.28, SB, r2(NB - deepOf(EN))], glass: ['south', 'west'], doors: { east: L3m }, ensuite: EN });
  setRoom(SE, { face: 0, rect: [LIFT[1] + 0.28, XR, r2(SB + deepOf(EN)), L3[3]], glass: ['east'], doors: { west: L3m }, ensuite: EN });
  const ENs = { w: 2.4, d: 1.5, dress: 'spa' };   // the north flat's is smaller: it's the shallowest of the three
  // its door in its front wall, so the en-suite is behind it on the north side and there's no hall past it
  setRoom(NE, { face: 180, rect: [L3[0], XR, r2(L3[3] + 0.28), r2(NB - deepOf(EN))], glass: ['east'], doors: { south: L3x }, ensuite: EN });
  link(W, 'east', h); link(SE, 'west', h); link(NE, 'south', h);
  label(W, `${F.n}-A`, 380, flatText.W(`${F.n}-A`, ORD[F.n], 'east'));
  label(SE, `${F.n}-B`, 340, flatText.SE(`${F.n}-B`, ORD[F.n], 'west'));
  label(NE, `${F.n}-C`, 360, flatText.NE(`${F.n}-C`, ORD[F.n], 'south'));
  for (const id of [W, SE, NE]) { mark(id, F.n); edit(id, (z) => { z.flags.room.storeys = 32; }); }
}

// floors 6, 8 and 10: two flats either side of a corridor
const TWO = [{ n: 6, hall: 'hall_24', W: 'j', E: 'k' }, { n: 8, hall: 'hall_26', W: 'l', E: 'm' }, { n: 10, hall: 'hall_28', W: 'n', E: 'o' }];
const L2 = [-1.2, 1.1, LAND_N0, NB], L2d = 4.0, Lx = (L2[0] + L2[1]) / 2;
for (const F of TWO) {
  const h = S(F.hall), W = S(`apt_${F.W}`), E = S(`apt_${F.E}`);
  for (const id of [h, W, E]) unexit(id, 'north', 'south', 'east', 'west');
  landing(h, F.n, { rect: L2, doors: { west: L2d, east: L2d }, label: 'The Residences',
    text: `The ${ORD[F.n]} floor: a narrow hall in walnut and stone running north from the lift, a runner of dark carpet, a door each side. ${F.n}-A is <b>west</b> and ${F.n}-B <b>east</b>. The elevator is <b>in</b> behind you.` });
  edit(h, (z) => { z.flags.room.doors.in = r2(0 - Lx); z.flags.room.decor = { ...(z.flags.room.decor || {}), plaques: { [W]: `${F.n}-A`, [E]: `${F.n}-B` } }; });
  setRoom(W, { face: 180, rect: [XL, L2[0] - 0.28, SB, r2(NB - deepOf(EN))], glass: ['south', 'west'], doors: { east: L2d }, ensuite: EN });
  setRoom(E, { face: 180, rect: [L2[1] + 0.28, XR, SB, r2(NB - deepOf(EN))], glass: ['south', 'east'], doors: { west: L2d }, ensuite: EN });
  link(W, 'east', h); link(E, 'west', h);
  label(W, `${F.n}-A`, 520, flatText.W(`${F.n}-A`, ORD[F.n], 'east'));
  label(E, `${F.n}-B`, 520, flatText.E(`${F.n}-B`, ORD[F.n], 'west'));
  for (const id of [W, E]) { mark(id, F.n); edit(id, (z) => { z.flags.room.storeys = 32; }); }
}

// floor 14: the Aerie
landing(S('hall_41'), 14, { rect: [-3, 3, LAND_N0, 3.87], doors: { north: 0 }, label: 'The Aerie: members', name: Title(14), text: Z.get(S('hall_41')).description.replace(/nineteenth/gi, 'fourteenth') });
setRoom(S('aerie'), { face: 0, rect: [XL, XR, 4.15, NB], doors: { south: 0 }, glass: ['north', 'east', 'west'] });
edit(S('aerie'), (z) => { z.description = z.description.replace(/nineteen floors up, where the Solenne is narrowest: /, 'fourteen floors up: ').replace(/ and the stem flares away above and below/, ''); });
mark(S('aerie'), 14);

// ── the whole-floor flats ─────────────────────────────────────────────────────────────────────────────
// A landing private to the flat (`flags.private_to`, plugins/residency), the flat itself west of it with its
// en-suite, its east room, and on the premium floors a stair up to a room across the north half.
const LW = [-1.2, 1.1, LAND_N0, 2.87], LWm = (LW[2] + LW[3]) / 2, LWx = (LW[0] + LW[1]) / 2;
const W_RECT = (en) => [XL, LW[0] - 0.28, SB, r2(NB - deepOf(en))];
const E_RECT = [LW[1] + 0.28, XR, SB, NB];
const UP_RECT = [XL, XR, LAND_N0, NB];
// the stair from the flat up: its foot 0.3 m north of the lift's line, 0.65 m in from the west glass, climbing north
const STAIR = { x: XL + 0.65, n: 0.3, w: 1.1 };
const RISE = STOREY, GOING = 0.27, RISER = 0.19;
const FLIGHT = r2((Math.ceil(RISE / RISER) - 1) * GOING);
// what goes where when a flat's things are shared between its rooms: the kitchen, the table, the bar and the cat stay
// in the flat (whose zone keeps the lease), the bed and the desk go to the east room, the sitting room upstairs
const TO_E = /(^|_)(bed|wardrobe|pc_desk|desk|reading_chair|boombox|smokes|lounger|bonsai)(_|$)/;
const TO_UP = /(sofa|_table$|coffee|tv_|betamax|persian_rug|lantern|balcony_bench|card_chair|apt_b_dining|chess|club_chair|fireplace|humidor|_lounge$|pent_table)/;
const lightFrom = (id, src) => { const l = readOne('furniture', `furn_light_${src}`); const f = { ...l, id: `furn_light_${id}`, zone_id: id }; FU.set(f.id, f); put('furniture', f); };
const powerFrom = (id, src, name) => put('power_zones', { ...readOne('power_zones', src), id, name });
const NEW_ZONES = [];
function newRoom(id, src, { name, text, n, exits = {}, flags = {} }) {
  const z = { ...clone(Z.get(src)), id, name, description: text, exits, grid_x: 0, grid_y: 0, grid_z: n, marker: String(n) };
  delete z.ambient_events;
  for (const k of ['is_apartment', 'rent_cost', 'owner_id', 'owner', 'tenant_id', 'leased_to', 'window', 'rest_multiplier']) delete z.flags[k];
  z.flags = { ...z.flags, ...flags };
  z.flags.room = { ...(z.flags.room || {}) };
  delete z.flags.room.ensuite; delete z.flags.room.decor; delete z.flags.room.stair; delete z.flags.room.sign;
  Z.set(id, z); put('zones', z); NEW_ZONES.push(id);
  lightFrom(id, src); powerFrom(id, src, name);
  return z;
}
const WHOLE = [
  { n: 16, hall: 'hall_u16', W: 'i', lbl: '16', rent: 900 },
  { n: 18, hall: 'hall_u18', W: 'h', lbl: '18', rent: 950 },
  { n: 20, hall: 'hall_34', W: 'p', lbl: '20', rent: 1400, up: 1 },
  { n: 22, hall: 'hall_36', W: 'q', lbl: '22', rent: 1450, up: 1 },
  { n: 24, hall: 'hall_38', W: 'b', lbl: '24', rent: null, up: 1 },
  { n: 26, hall: 'hall_40r', W: 'r', lbl: '26', rent: 1550, up: 1 },
  { n: 28, hall: 'ph_landing', W: 'penthouse', lbl: 'Penthouse', rent: null, up: 3 },
];
const hall41 = Z.get(S('hall_41'));
for (const F of WHOLE) {
  const h = S(F.hall), W = F.W === 'penthouse' ? S('penthouse') : S(`apt_${F.W}`), Wk = W.replace('zone_solenne_', ''), E = `${W}_e`;
  const pent = F.W === 'penthouse', title = pent ? 'The Penthouse' : `Residence ${F.lbl}`;
  // the landing: a new one cloned from the Aerie's, or the floor's own
  if (!Z.get(h)) {
    const z = { ...clone(hall41), id: h, exits: { in: S('elevator') } };
    delete z.ambient_events; delete z.flags.room.sign; delete z.flags.room.decor?.doors;
    Z.set(h, z); put('zones', z); NEW_ZONES.push(h);
    put('power_zones', { ...readOne('power_zones', S('hall_41')), id: h, name: Title(F.n) });
    lightFrom(h, S('hall_41'));
    put('connections', { a: S('elevator'), b: h, blocked: false, dir: 'up', id: newId(`conn_solenne_elevator_up_${F.n}`), lockable: false, one_way: true });
    put('connections', { a: h, b: S('elevator'), blocked: false, dir: 'in', id: newId(`conn_solenne_hall_${F.n}_in`), lockable: false, one_way: true });
  }
  for (const id of [h, W]) unexit(id, 'north', 'south', 'east', 'west');
  if (Z.get(W).exits?.up) unexit(W, 'up');
  // the flat's old landing on floors 8 and 10 loses its door to it
  for (const old of [S('residences'), S('residences_34')]) if (Object.values(Z.get(old).exits).includes(W)) edit(old, (z) => { for (const [d, t] of Object.entries(z.exits)) if (t === W) delete z.exits[d]; });
  landing(h, F.n, { rect: LW, doors: { west: LWm, east: LWm }, label: title, name: pent ? 'The Penthouse Landing' : Title(F.n),
    text: pent
      ? 'The penthouse\'s own landing, walnut and stone, the lift behind you and nobody else\'s door. The flat is <b>west</b>, its east room <b>east</b>. The elevator is <b>in</b>.'
      : `The ${ORD[F.n]} floor, which is one flat: a short landing in walnut and stone, the lift behind you. ${title} is <b>west</b>, its east room <b>east</b>. The elevator is <b>in</b>.`,
    extra: {} });
  edit(h, (z) => { z.flags.room.doors.in = r2(0 - LWx); z.flags.private_to = W; z.flags.room.decor = { ...(z.flags.room.decor || {}), plaques: { [W]: pent ? 'PH' : F.lbl } }; });
  const en0 = Z.get(W).flags.room?.ensuite || EN, en = en0.d > 3 ? { ...en0, d: 3 } : en0;
  setRoom(W, { face: 180, rect: W_RECT(en), glass: ['south', 'west'], doors: { east: LWm }, ensuite: en, extra: { h: F.up ? STOREY : 3, storeys: 32 } });
  link(W, 'east', h);
  mark(W, F.n);
  // its east room
  newRoom(E, W, { name: pent ? 'The Penthouse, the east room' : `${title}, the east room`, n: F.n,
    text: `The east side of the ${pent ? 'penthouse\'s first floor' : `${ORD[F.n]} floor`}, glass on three sides and the bay below it. The landing is <b>west</b>.`,
    flags: { private_to: W } });
  setRoom(E, { face: 180, rect: E_RECT, glass: ['south', 'east', 'north'], doors: { west: LWm }, extra: { h: 3, storeys: 32 } });
  link(E, 'west', h, { lockable: false });
  edit(E, (z) => { z.grid_x = 1; z.grid_y = -1; });
  // its rooms upstairs
  const ups = [];
  for (let k = 1; k <= (F.up || 0); k++) {
    const id = pent ? S(`penthouse_${k + 1}`) : `${W}_up`, n = F.n + k;
    newRoom(id, W, { name: pent ? `The Penthouse, the ${ORD[n]} floor` : `${title}, upstairs`, n,
      text: pent
        ? (k === F.up ? 'The top of the penthouse, thirty-one floors up: glass on three sides, the roof deck over your head and the whole Basin under you. The stair is <b>down</b>.'
          : `The penthouse's ${ORD[n]} floor, glass on three sides, the city level with you. The stair goes <b>up</b> and <b>down</b>.`)
        : `Upstairs, the ${ORD[n]} floor across the north side of the tower, glass on three sides and the gardens below. The stair is <b>down</b>.`,
      flags: { private_to: W } });
    setRoom(id, { face: 0, rect: UP_RECT, glass: ['north', 'east', 'west'], extra: { h: k === F.up ? 3 : STOREY, storeys: 32 } });
    edit(id, (z) => { z.grid_x = 0; z.grid_y = -2; });
    ups.push(id);
  }
  // the stairs: the flat's from its west side, then (in the penthouse) east along the south of each floor and back
  const chain = [W, ...ups];
  for (let k = 0; k < ups.length; k++) {
    const lo = chain[k], hi = chain[k + 1], loR = k === 0 ? W_RECT(en) : UP_RECT, loFace = k === 0 ? 180 : 0;
    const lcx = (loR[0] + loR[1]) / 2;
    // the foot and the top of the flight, in metres in the tile's frame
    let foot, top, climb;
    if (k === 0) { foot = [STAIR.x, STAIR.n]; top = [STAIR.x, r2(STAIR.n + FLIGHT)]; climb = 'back'; }
    else if (k % 2 === 1) { foot = [XL + 1.0, 1.6]; top = [r2(XL + 1.0 + FLIGHT), 1.6]; climb = 'right'; }
    else { foot = [r2(XL + 1.0 + FLIGHT + 0.6), 2.8]; top = [r2(XL + 1.6), 2.8]; climb = 'left'; }
    // a point in a room's own frame: u across from its middle, v in from its front wall
    const uv = (R, face, [x, n]) => { const cx = (R[0] + R[1]) / 2; return face === 180 ? [r2(-(x - cx)), r2(n - R[2])] : [r2(x - cx), r2(R[3] - n)]; };
    edit(lo, (z) => { z.flags.room.stair = { at: uv(loR, loFace, foot), climb, w: STAIR.w }; z.exits = { ...z.exits, up: hi }; });
    edit(hi, (z) => { z.flags.room.doors = { ...(z.flags.room.doors || {}), down: uv(UP_RECT, 0, top) }; z.exits = { ...z.exits, down: lo }; });
    put('connections', { a: lo, b: hi, blocked: false, dir: 'up', id: newId(`conn_${lo.replace('zone_', '')}_up`), lockable: false, one_way: false });
    void lcx;
  }
  // the flat's things shared out between its rooms
  for (const f of [...FU.values()].filter((x) => x.zone_id === W && x.object_type !== 'light')) {
    const to = TO_E.test(f.id) ? E : TO_UP.test(f.id) ? (pent ? (/bed|wardrobe/.test(f.id) ? ups[1] : ups[0]) : ups[0] || E) : null;
    if (!to) continue;
    const g = { ...clone(f), zone_id: to };
    if (g.flags?.spot && !g.flags.spot.on) delete g.flags.spot;
    FU.set(g.id, g); put('furniture', g);
  }
  if (pent) for (const f of [...FU.values()].filter((x) => x.zone_id === W && /bed|wardrobe/.test(x.id))) { const g = { ...clone(f), zone_id: ups[1] }; delete g.flags?.spot; FU.set(g.id, g); put('furniture', g); }
  if (F.rent) edit(W, (z) => { z.flags.rent_cost = F.rent; });
  label(W, F.lbl.match(/^\d/) ? F.lbl : 'Penthouse', null, pent
    ? 'The penthouse\'s first floor: the kitchen in black stone, the long table, the bar. Glass down the west side and along the south, and a stair in the corner going <b>up</b> three more floors. The landing is <b>east</b>.'
    : `${title}, the whole ${ORD[F.n]} floor: the kitchen in grey stone, the table, and glass down the west side and along the south${F.up ? ', with a stair going <b>up</b> to the floor above' : ''}. The landing is <b>east</b>.`);
  if (pent) edit(W, (z) => { z.name = 'The Solenne Penthouse'; });
}
// Cyd's own words for his flat
edit(S('apt_b'), (z) => { z.description = 'Residence 24, the whole twenty-fourth floor and the room upstairs: glass down the west side and the city turning slowly past it as the light shifts. A card table by the bar, the kitchen in grey stone, the heating underfoot. The silence is total. This is what money buys when it stops needing to prove anything. The landing is <b>east</b>; the stair goes <b>up</b>.'; });

// the crown: the lift's top landing, under the roof deck
landing(S('hall_45'), 32, { rect: [-3, 3, LAND_N0, 5.47], doors: {}, label: 'Sky Deck & Pad', name: Title(32), text: Z.get(S('hall_45')).description.replace(/fortieth/gi, 'thirty-second') });
edit(S('hall_45'), (z) => { delete z.flags.room.windowless; });

// the lift's stops, in order
edit(S('elevator'), (z) => {
  const list = stops.filter((s) => s.n > 1).sort((a, b) => a.n - b.n);
  z.flags.elevator_floors = list; z.exits.up = list.map((s) => s.zone);
});

// text elsewhere that names Cyd's flat
{ const id = 'secdev_solenne_30b_door', o = readOne('furniture', id), s = JSON.stringify(o).replace(/\b\d+-B's door/g, "Residence 24's door");
  const next = JSON.parse(s); FU.set(id, next); put('furniture', next); }

// ── the plan: every room laid out, and the roof rooms sized to the deck ──────────────────────────────
const annexZoneOf = (z) => {
  const inner = z?.exits?.in ? Z.get(Array.isArray(z.exits.in) ? z.exits.in[0] : z.exits.in) : null;
  const out = inner?.exits?.out, back = Array.isArray(out) ? out[0] : out;
  return inner && back === z.id && inner.parent_zone === z.id ? inner : null;
};
const specById = (id) => {
  const z = Z.get(id);
  if (!z) return null;
  const mark2 = parseInt(z.marker, 10);
  const spec = roomSpecOf(z.flags, !!z.flags?.is_apartment, { storey: Number.isFinite(mark2) ? mark2 : null });
  if (!spec) return null;
  const a = annexZoneOf(z);
  return a ? withAnnex(spec, a.id, a.name) : spec;
};
const report = [];
function planNow() {
  const bld = buildingGraph({ zones: Z, maps, specOf: (z) => specById(z.id) }).get('map_int_solenne');
  const P = buildingLayout(bld, { zones: Z, specOf: (z) => specById(z.id) });
  const front = (P.doors || []).find((d) => d.kind === 'front' && d.from === S('lobby'));
  const EDGE = 0.47 * TILE_M, dx = -front.at[0], dn = -EDGE - front.at[2];
  const tile = (R) => { const f = R.foot || [R.box[0], R.box[1], R.box[4], R.box[5]]; return [f[0] + dx, f[1] + dx, f[2] + dn, f[3] + dn]; };
  return { P, tile };
}
// the roof: the Lantern stands where the plan puts it over the stair; the sky deck north of it and the pad east, out
// to the deck's edge
{
  const { P, tile } = planNow(), L = P.rooms[S('hall_40')];
  if (!L) fails.push('the Lantern is not in the plan');
  else {
    const [lx0, lx1, ln0, ln1] = tile(L), DECK = 7.4;
    // the sky deck down the west side of the Lantern, the pad east of it
    const sd = [r2(-DECK), r2(lx0 - 0.28), r2(-5.4), r2(BOX.n1 + 0.6)];
    unexit(S('hall_40'), 'north'); unexit(S('skydeck'), 'south');
    setRoom(S('skydeck'), { face: 0, rect: sd, doors: { east: (ln0 + ln1) / 2 }, extra: { open: true } });
    link(S('skydeck'), 'east', S('hall_40'), { lockable: false });
    const hp = [r2(lx1 + 0.28), r2(DECK), r2(-5.4), r2(BOX.n1 + 0.6)];
    setRoom(S('helipad'), { face: 0, rect: hp, doors: { west: (ln0 + ln1) / 2 }, extra: { open: true } });
    // the helipad keeps its compass bearing: face 90 in its file, so turn the rect
    edit(S('helipad'), (z) => { const r = z.flags.room, w = r.w; r.face = 90; r.w = r.d; r.d = w; r.doors = { west: r2(((ln0 + ln1) / 2) - (hp[2] + hp[3]) / 2) }; });
    mark(S('hall_40'), 33); mark(S('skydeck'), 33); mark(S('helipad'), 33);
    // the infinity pool runs down the deck's length, which is shorter than the old deck's width
    { const p = clone(FU.get('furn_solenne_pool')); p.flags.look.dims = [9, 1.8, 0.5]; p.flags.spot = { at: [-1.4, 7.3], turn: 90 }; FU.set(p.id, p); put('furniture', p);
      const s = clone(FU.get('furn_skydeck_sofa')); s.flags.spot = { at: [0.9, 12.6], turn: 90 }; FU.set(s.id, s); put('furniture', s);
      const fpit = clone(FU.get('furn_skydeck_firepit')); fpit.flags.spot = { at: [1.15, 0.7], turn: 0 }; FU.set(fpit.id, fpit); put('furniture', fpit); }
  }
}

// ── the furniture: every room that changed, its pieces placed again inside its new walls ────────────
const itemOf = (f) => (f.flags?.item_id ? items.get(f.flags.item_id) || null : null);
const fp = (p) => { const q = Math.round((((p.turn % 360) + 360) % 360) / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [p.u - hw, p.u + hw, p.v - hd, p.v + hd]; };
function doorPoint(L) {
  const Sp = L.spec, o = doorwaysOf(Sp).find((x) => !x.annex) || null;
  if (!o) return roomNearFree(L, 0, Sp.d / 2, 3);
  const mid = (o.a + o.b) / 2, hall = o.wall === 'back' && hallOf(Sp, o);
  if (o.wall === 'back') return roomNearFree(L, mid, hall ? hall.v1 - 0.4 : Sp.d - 0.4, 1.2) || roomNearFree(L, mid, Sp.d - 0.6, 1.5);
  if (o.wall === 'front') return roomNearFree(L, mid, 0.5, 1.5);
  return roomNearFree(L, o.wall === 'left' ? -Sp.w / 2 + 0.5 : Sp.w / 2 - 0.5, mid, 1.5);
}
const plans = walkPlans({ zones: Z, maps, specOf: (z) => specById(z.id) });
const stageSpec = (id) => { const s = specById(id), b = s && plans.get(id); return b ? buildingView(b, id, s, { specOf: specById }).spec : s; };
const RESPOT = [...new Set([...writes.keys()].filter((k) => k.startsWith('zones/')).map((k) => k.slice(6, -5)).filter((id) => Z.get(id)?.flags?.room && !id.endsWith('_bath') && id !== S('elevator')))];
for (const id of RESPOT) {
  const spec = stageSpec(id);
  if (!spec) { fails.push(`${id}: no Stage spec`); continue; }
  if (!plans.get(id)) { fails.push(`${id}: not on the Solenne's walk`); continue; }
  const rows = [...FU.values()].filter((f) => f.zone_id === id && f.object_type !== 'light');
  const placed = [], newSpot = new Map();
  // every piece with a spot is placed again from the nearest free spot to where it was, scaled to the new room
  const spotted = rows.filter((f) => f.flags?.spot && !f.flags.spot.on);
  const looks = layRows(spotted.map((f) => ({ ...f, flags: { ...(f.flags || {}), spot: undefined } })), spec, { finish: spec.finish, itemOf }).pieces;
  for (const p of looks) {
    const row = spotted.find((f) => f.id === p.id), was = row.flags.spot || {}, tries = [];
    if (was.wall) {
      const lo = (w) => (w === 'front' || w === 'back' ? -spec.w / 2 : 0), hi = (w) => (w === 'front' || w === 'back' ? spec.w / 2 : spec.d);
      for (const wall of [was.wall, ...['left', 'right', 'front', 'back'].filter((x) => x !== was.wall)]) for (let a = lo(wall); a <= hi(wall) + 1e-6; a += 0.1) tries.push({ spot: { ...was, wall, along: r2(a) }, cost: Math.abs(a - Math.max(lo(wall), Math.min(hi(wall), was.along || 0))) + (wall === was.wall ? 0 : 20) });
    } else if (was.at) {
      const tu = Math.max(-spec.w / 2, Math.min(spec.w / 2, was.at[0])), tv = Math.max(0.5, Math.min(spec.d - 0.5, was.at[1]));
      for (let v = 0.3; v <= spec.d - 0.3 + 1e-6; v += 0.15) for (let u = -spec.w / 2 + 0.3; u <= spec.w / 2 - 0.3 + 1e-6; u += 0.15) for (const dt of [0, 90, -90, 180]) {
        tries.push({ spot: { at: [r2(u), r2(v)], turn: (((was.turn ?? 0) + dt + 540) % 360) - 180 }, cost: Math.hypot(u - tu, v - tv) + (dt ? 0.5 : 0) });
      }
    }
    tries.sort((a, b) => a.cost - b.cost);
    const hit = tries.find((t) => placeSpot(spec, placed, p.arche, p.dims, { crt: p.crt, form: p.form, test: t.spot }));
    // no free spot near its old one: the Stage places it itself, as it does the pieces with no spot
    if (!hit) { newSpot.set(p.id, null); continue; }
    newSpot.set(p.id, hit.spot);
    placed.push({ ...p, spot: hit.spot });
  }
  let withSpots = rows.map((f) => {
    if (!newSpot.has(f.id)) return f;
    const sp = newSpot.get(f.id), flags = { ...(f.flags || {}) };
    if (sp) flags.spot = sp; else delete flags.spot;
    return { ...f, flags };
  });
  const annexId = spec.annex?.zone, annexRows = annexId ? [...FU.values()].filter((f) => f.zone_id === annexId && f.object_type !== 'light') : [];
  const layOut = (Sp) => {
    const main = layRows(withSpots, Sp, { finish: Sp.finish, itemOf }).pieces;
    const all = Sp.annex ? [...main, ...layRows(annexRows, annexFrame(Sp).spec, { annex: true, finish: Sp.annex.finish, itemOf }).pieces] : main;
    return { main, L: roomLayout(Sp, all) };
  };
  const blocked = (L) => L.placed.filter((sc) => sc.arche === 'screen' && !sc.annex).filter((sc) => {
    const r = screenView(sc), meets = (q) => q[0] < r[1] - 0.01 && q[1] > r[0] + 0.01 && q[2] < r[3] - 0.01 && q[3] > r[2] + 0.01;
    return L.placed.some((p) => p !== sc && !p.annex && !mayFaceScreen(p, sc) && pieceBoxes(p).some(meets));
  });
  for (const sc of blocked(layOut(spec).L)) {
    const others = layOut(spec).L.placed.filter((p) => p.id !== sc.id && !p.annex).map((p) => ({ ...p, spot: p.spot?.on ? p.spot : { at: [p.u, p.v], turn: p.turn } }));
    const at = placeSpot(spec, others, 'screen', sc.dims, { crt: sc.crt, form: sc.form });
    if (!at) { fails.push(`${id}: no clear wall for ${sc.id}`); continue; }
    newSpot.set(sc.id, at);
    withSpots = withSpots.map((f) => (f.id === sc.id ? { ...f, flags: { ...(f.flags || {}), spot: at } } : f));
  }
  for (const sc of blocked(layOut(spec).L)) fails.push(`${id}: something stands in front of ${sc.id}`);
  const { main, L } = layOut(spec);
  const lost = main.filter((p) => !L.placed.some((q) => q.id === p.id));
  if (lost.length) fails.push(`${id}: no room for ${lost.map((p) => p.name).join(', ')}`);
  for (const p of L.placed.filter((q) => !q.annex && !q.on)) {
    const f = fp(p);
    if (f[0] < -L.w / 2 - 1e-6 || f[1] > L.w / 2 + 1e-6 || f[2] < -1e-6 || f[3] > L.d + 1e-6) fails.push(`${id}: ${p.name} stands through a wall`);
  }
  const from = doorPoint(L);
  if (!from) fails.push(`${id}: no floor inside the door`);
  const stuck = L.seats.filter((s) => { const at = seatApproach(L, s, 1.8); return !(from && at && roomPath(L, from, at)); });
  if (stuck.length && process.env.DEBUG) console.log(id, 'from', JSON.stringify(from), L.placed.filter((q) => !q.annex).map((q) => `${q.id} u${q.u.toFixed(1)} v${q.v.toFixed(1)} ${q.w?.toFixed?.(1)}x${q.d?.toFixed?.(1)} t${q.turn}`).join(' | '));
  if (stuck.length) fails.push(`${id}: seats not reachable from the door: ${[...new Set(stuck.map((s) => s.piece))].join(', ')}`);
  for (const f of withSpots) if (newSpot.has(f.id)) { FU.set(f.id, f); put('furniture', f); }
  report.push(`${id.replace('zone_solenne_', '').padEnd(16)} ${spec.w} x ${spec.d} m, ${rows.length} pieces (${newSpot.size} moved), ${L.seats.length} seats`);
}

// ── the fit: every room inside the glass box (the podium's, or the crown's) at its height ───────────────
{
  const { P, tile } = planNow();
  if (P.problems?.length) fails.push(`layout problems: ${JSON.stringify(P.problems)}`);
  for (const [id, R] of Object.entries(P.rooms)) {
    const [x0, x1, n0, n1] = tile(R);
    const z = Z.get(id), open = z?.flags?.open_sky || z?.flags?.room?.open;
    const fl = R.floor / STOREY + 1;   // the lift floor this room stands on
    const lim = id === S('lobby') ? { x0: -PODIUM.half, x1: PODIUM.half, n0: -8.39 - 0.05, n1: PODIUM.half }
      : fl < 4 - 0.01 ? { x0: -PODIUM.half, x1: PODIUM.half, n0: -PODIUM.half, n1: PODIUM.half }
        : open ? { x0: -7.6, x1: 7.6, n0: -6.4, n1: BOX.n1 + 1.0 }
          : id === S('hall_40') ? { x0: -7.6, x1: 7.6, n0: -6.4, n1: BOX.n1 + 1.0 } : fl > 31.99 ? CROWN : BOX;
    const over = Math.max(lim.x0 - x0, x1 - lim.x1, lim.n0 - n0, n1 - lim.n1);
    const want = Math.abs(R.floor - floorM(Math.round(fl)));
    report.push(`${over > 0.05 || (want > 0.05 && !open) ? 'OUT ' : ' ok '}${id.replace('zone_solenne_', '').padEnd(16)} floor ${R.floor.toFixed(1).padStart(6)} (${fl.toFixed(2)})  x ${x0.toFixed(2)}..${x1.toFixed(2)}  n ${n0.toFixed(2)}..${n1.toFixed(2)}`);
    if (over > 0.05) fails.push(`${id} stands ${over.toFixed(2)} m outside the tower`);
    if (want > 0.05 && !open && id !== S('hall_40')) fails.push(`${id} stands ${want.toFixed(2)} m off its storey`);
  }
  for (const id of NEW_ZONES) if (!P.rooms[id]) fails.push(`${id} is not in the plan`);
}

for (const line of report) console.log(line);
if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`\n✗ solenne-plates-fit: ${fails.length} problem(s); nothing written`);
  process.exit(1);
}
let wrote = 0;
for (const [rel, data] of writes) {
  const file = path.join(C, rel), json = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json) continue;
  if (!DRY) fs.writeFileSync(file, json);
  wrote++;
}
console.log(`✓ solenne-plates-fit: ${wrote} files ${DRY ? 'to write' : 'written'}`);
