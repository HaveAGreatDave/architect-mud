// One-shot: the Solenne Residences' rooms re-planned to fit the 2 by 2 tower that GLASS draws (the `solenne` arm in
// client/game/js/panels/glass/models/downtown.js). The model stays as it is; the rooms change to fit it.
//
//   node scripts/content/solenne-rooms.mjs           lay out, check and write
//   node scripts/content/solenne-rooms.mjs --dry     lay out and check, write nothing
//
// The tower's plate shrinks and turns as it rises: 31.4 m square across the podium, 25.4 m usable at floor 10,
// 18.9 m at floor 18, 11.1 m at floor 41, then 26.4 m again in the bowl at floors 44 and 45, with the rim terrace on
// top at 162.7 m. The lift car stands on the block's centre line, 4.4 m south of the middle, and every landing is
// north of it. So:
//   - the lobby is 22 m across the podium, the street door at its east end under the porte-cochère;
//   - the residences move from floors 30 and 34, which are 13 m across, to floors 8 and 10, four flats a floor in a
//     pinwheel round a square landing: A and D north, B and E east, the new G and H south beside the lift, C and F
//     west. Every flat has glass on its two outside walls and its en-suite behind its back wall. Balconies come off:
//     the tower's glass is sheer;
//   - the gym (12), Bishop's Blend (18) and the Aerie (19, the small members' room) stand against the glass on two
//     sides;
//   - the penthouse takes floor 44 in the bowl, 25 m along the north glass;
//   - the lift's top stop is floor 45, a hall in the bowl with a stair up through the roof into the foot of the
//     lantern (the old fortieth-floor hall, moved). The Sky Deck is the terrace north of the lantern, with the pool
//     on the north parapet as the model has it, and the pad is the south-east corner over the front door.
// G and H are cloned from C and F: the zone, the en-suite, the doors, the connections, power and furniture.
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

const C = path.resolve(process.cwd(), 'content');
const DRY = process.argv.includes('--dry');
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const readOne = (dir, id) => JSON.parse(fs.readFileSync(path.join(C, dir, `${id}.json`), 'utf8'));
const zones = readDir('zones'), maps = readDir('maps'), furniture = readDir('furniture');
const items = new Map(readDir('items').map((i) => [i.id, i]));
const Z = new Map(zones.map((z) => [z.id, z]));
const FU = new Map(furniture.map((f) => [f.id, f]));
const r2 = (x) => +x.toFixed(2);
const S = (k) => `zone_solenne_${k}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

if (Z.get(S('residences')).flags?.room?.w === 6 && Z.get(S('apt_g'))) { console.log('solenne-rooms: already done'); process.exit(0); }

const writes = new Map(), fails = [];
const put = (dir, obj) => writes.set(`${dir}/${obj.id}.json`, obj);
const edit = (id, fn) => { const z = clone(Z.get(id)); fn(z); Z.set(id, z); put('zones', z); return z; };
const room = (id, patch, drop = []) => edit(id, (z) => { const r = { ...(z.flags.room || {}), ...patch }; for (const k of drop) delete r[k]; z.flags.room = r; });

// ── the flats ────────────────────────────────────────────────────────────────────────────────────────
// floor 8: A north, B east, G south, C west; floor 10: D, E, H, F. Letters stay with their zones, so a key, a rent
// and a resident follow their flat.
const FLATS = {
  a: { floor: 8, dir: 'south' }, b: { floor: 8, dir: 'west' }, c: { floor: 8, dir: 'east' }, g: { floor: 8, dir: 'north', from: 'c' },
  d: { floor: 10, dir: 'south' }, e: { floor: 10, dir: 'west' }, f: { floor: 10, dir: 'east' }, h: { floor: 10, dir: 'north', from: 'f' },
};
const SIZE = { 8: { w: 11.4, d: 7, ensuite: { w: 3.2, d: 2.6, dress: 'spa' } }, 10: { w: 11, d: 6.6, ensuite: { w: 3.2, d: 2.4, dress: 'spa' } } };
const LANDING = { 8: S('residences'), 10: S('residences_34') };
const GRID = { g: [0, 0, 3], h: [0, 0, 6] };
const RENT = { 8: 400, 10: 460 };
const label = (k) => `${FLATS[k].floor}-${k.toUpperCase()}`;
const TEXT = {
  a: 'A one-bedroom on the north corner, glass on two sides and the bay in both of them. Engineered oak underfoot, a low platform bed in cloud-grey linen, and a kitchen that is one seam of stone with no handles anywhere. Everything is quiet and exactly where it should be. The door locks with a whisper. Leave <b>south</b> to the landing.',
  b: 'A corner residence, glass on two sides, the city turning slowly past the windows as the light shifts. A platform bed on a silk Persian rug, a black computer desk in the corner of the glass. The heating is underfoot and the silence is total. This is what money buys when it stops needing to prove anything. Leave <b>west</b> to the landing.',
  c: 'A one-bedroom on the west corner facing the mountains: pale plaster, warm oak, a platform bed under the long window. A galley kitchen, a soaking tub, a window seat built for watching the storms roll in from somewhere safe and dry. The door seals with a soft magnetic sigh. Leave <b>east</b> to the landing.',
  d: 'A sky residence on the bay side: engineered oak, two walls of glass, and a platform bed in the corner where they meet. The kitchen is a single seam of stone. Leave <b>south</b> to the landing.',
  e: 'The east corner of the tenth floor, glass on two sides: the bay on one and the long grey run of Coldwater on the other, the light crossing the room all day without ever being harsh. A bath cut from a single block of stone behind the bedroom wall. Leave <b>west</b> to the landing.',
  f: 'A one-bedroom on the west corner facing the mountains, two floors above its twin and quieter for it: pale plaster, warm oak, a platform bed under the long window. A galley kitchen, a window seat built for watching the storms arrive from somewhere safe and dry. Leave <b>east</b> to the landing.',
  g: 'A one-bedroom on the south corner, over the street. You can see the traffic and hear none of it. Warm oak, a platform bed, a galley kitchen in grey stone, and glass from floor to ceiling on two sides. Leave <b>north</b> to the landing.',
  h: 'The south corner of the tenth floor, over the street and the porte-cochère: oak, stone, a platform bed, a galley kitchen and two walls of glass. Ten floors is high enough that the traffic is a light show and not a noise. Leave <b>north</b> to the landing.',
};
const LANDING_TEXT = {
  8: 'The eighth floor: a square hall panelled in walnut round the lift, a runner of dark blue carpet, bronze lamps between the doors. A flat opens off each side. 8-A is <b>north</b>, 8-B <b>east</b>, 8-G <b>south</b> beside the lift and 8-C <b>west</b>. The elevator is <b>in</b> behind you.',
  10: 'The tenth floor, the same walnut as the eighth with a green runner instead of blue. 10-D is <b>north</b>, 10-E <b>east</b>, 10-H <b>south</b> beside the lift and 10-F <b>west</b>. The elevator is <b>in</b> behind you.',
};

// G and H: every file of C and F with the letter changed. Four rows get text of their own: the originals are over
// the furniture length the prose gate holds (scripts/docs/prose.mjs), and a copy would count twice.
const CLONE_TEXT = {
  furn_solenne_fridge_g: 'Brushed alloy, with shelves that rearrange themselves round whatever you put in, and a light that comes on half a second before the door opens. A freezer drawer at the top. The plate says Polaris Executive.',
  furn_solenne_fridge_h: 'A brushed-alloy Polaris Executive with a freezer drawer up top. The shelves move themselves to fit what you put in, and the light inside comes on just before you open the door.',
  furn_solenne_wardrobe_g: 'A walnut cabinet with brass corners. The doors ease open as you come near and never slam. Inside, a lit rail and cedar-scented air a degree cooler than the room. The brass plate says Valet, by Polaris.',
  furn_solenne_wardrobe_h: 'Dark walnut and brass, with doors that open for you and shut without a sound. A lit rail inside, the air cool and smelling of cedar. Valet, by Polaris, says the plate, and it will pick your clothes if you let it.'
};

const swap = (from, to) => (s) => s.replace(new RegExp(`apt_${from}(?=_|\\b|$)`, 'g'), `apt_${to}`).replace(new RegExp(`_${from}_`, 'g'), `_${to}_`).replace(new RegExp(`_${from}$`), `_${to}`);
// the connections' ids, rolled once, so a second database gets the same rows
const SUFFIX = { conn_solenne_apt_g_north: '004h', conn_solenne_apt_g_bath_out: 'rb5a', conn_solenne_apt_h_north: 'hmue', conn_solenne_apt_h_bath_out: 'n04u' };
const newId = (s) => `${s}_${SUFFIX[s]}`;
for (const [k, F] of Object.entries(FLATS)) {
  if (!F.from || Z.get(S(`apt_${k}`))) continue;
  const sw = swap(F.from, k), src = Z.get(S(`apt_${F.from}`)), bath = Z.get(S(`apt_${F.from}_bath`));
  const z = { ...clone(src), id: S(`apt_${k}`), exits: { in: S(`apt_${k}_bath`), [F.dir]: LANDING[F.floor] } };
  [z.grid_x, z.grid_y, z.grid_z] = GRID[k];
  Z.set(z.id, z); put('zones', z);
  const b = { ...clone(bath), id: S(`apt_${k}_bath`), exits: { out: z.id }, parent_zone: z.id };
  Z.set(b.id, b); put('zones', b);
  for (const f of furniture.filter((x) => x.zone_id === src.id || x.zone_id === bath.id)) {
    const g = { ...clone(f), id: sw(f.id), zone_id: sw(f.zone_id) };
    if (CLONE_TEXT[g.id]) g.description = CLONE_TEXT[g.id];
    if (FU.has(g.id)) throw new Error(`clone ${g.id} already exists`);
    FU.set(g.id, g); furniture.push(g); put('furniture', g);
  }
  for (const p of [src.id, bath.id]) { const pz = readOne('power_zones', p); put('power_zones', { ...pz, id: sw(p) }); }
  const conn = { a: z.id, b: LANDING[F.floor], blocked: false, dir: F.dir, id: newId(`conn_solenne_apt_${k}_${F.dir}`), lockable: true, one_way: false };
  const bconn = { a: b.id, b: z.id, blocked: false, dir: 'out', id: newId(`conn_solenne_apt_${k}_bath_out`), lockable: true, one_way: false };
  put('connections', conn); put('connections', bconn);
  const door = readOne('doors', `door_solenne_apt_${F.from}`), bdoor = readOne('doors', `door_zone_solenne_apt_${F.from}_bath`);
  put('doors', { ...door, id: `door_solenne_apt_${k}`, connection_id: conn.id, exit_dir: F.dir, target_zone: LANDING[F.floor], zone_id: z.id });
  put('doors', { ...bdoor, id: `door_zone_solenne_apt_${k}_bath`, connection_id: bconn.id, target_zone: z.id, zone_id: b.id, tags: { ...bdoor.tags, 'lock:privacylock': { ...bdoor.tags['lock:privacylock'], privacySide: b.id } } });
}
for (const [k, F] of Object.entries(FLATS)) {
  const id = S(`apt_${k}`), L = label(k);
  room(id, { ...SIZE[F.floor], h: 3, glass: ['front', 'left'], balcony: false, storeys: 45, finish: 'fine' });
  edit(id, (z) => { z.name = `Solenne Residence ${L}`; z.marker = String(F.floor); z.description = TEXT[k]; z.flags.rent_cost = RENT[F.floor]; });
  edit(`${id}_bath`, (z) => { z.name = `Residence ${L} en-suite`; });
  const drel = `doors/door_solenne_apt_${k}.json`, door = writes.get(drel) || readOne('doors', `door_solenne_apt_${k}`);
  put('doors', { ...door, name: `Residence ${L} hololock` });
  for (const p of [id, `${id}_bath`]) {
    const rel = `power_zones/${p}.json`, pz = writes.get(rel) || readOne('power_zones', p);
    put('power_zones', { ...pz, name: p.endsWith('_bath') ? `Residence ${L} en-suite` : `Solenne Residence ${L}` });
  }
}

// ── the landings: 6 m square on the lift, a door each way; the flats' doors are 2.4 m along, so they turn round it ──
for (const fl of [8, 10]) {
  const id = LANDING[fl], ks = Object.keys(FLATS).filter((k) => FLATS[k].floor === fl);
  room(id, { w: 6, d: 6, h: 3, doors: { north: -2.4, south: 2.4, east: 2.4, west: -2.4 } });
  edit(id, (z) => {
    z.name = fl === 8 ? 'The Eighth Floor' : 'The Tenth Floor';
    z.description = LANDING_TEXT[fl];
    z.exits = { in: S('elevator'), ...Object.fromEntries(ks.map((k) => [{ south: 'north', north: 'south', east: 'west', west: 'east' }[FLATS[k].dir], S(`apt_${k}`)])) };
    const dec = z.flags.room.decor;
    dec.plaques = Object.fromEntries(ks.map((k) => [S(`apt_${k}`), label(k)]));
    dec.art = [{ at: -1.6, h: 1, seed: dec.art?.[0]?.seed ?? 31, w: 1.15, wall: 'left', y: 1.62 }, { at: 4.4, h: 1, seed: dec.art?.[1]?.seed ?? 36, w: 1.15, wall: 'right', y: 1.62 }];
    dec.sconces = { points: [['front', 1.2], ['left', 3.6], ['right', 1.4], ['back', -1.6]], y: 1.82 };
  });
}

// ── the lift ─────────────────────────────────────────────────────────────────────────────────────────
const STOPS = [
  { n: 8, label: 'The Residences', zone: S('residences') },
  { n: 10, label: 'The Residences', zone: S('residences_34') },
  { n: 12, label: 'Fitness Club', zone: S('hall_12') },
  { n: 18, label: "Bishop's Blend", zone: S('hall_18') },
  { n: 19, label: 'The Aerie: members', zone: S('hall_41') },
  { n: 44, label: 'The Penthouse', zone: S('ph_landing') },
  { n: 45, label: 'Sky Deck & Pad', zone: S('hall_45') },
];
edit(S('elevator'), (z) => { z.exits.up = STOPS.map((s) => s.zone); z.flags.elevator_floors = STOPS; });

// ── the lobby: across the podium, the lift in the middle of its back wall, the street door at its east end ──
room(S('lobby'), {
  w: 22, d: 11.5, h: 7, doors: { south: 8.93, in: 0 },
  sign: { at: 0, size: 0.6, sub: 'RESIDENCES', text: 'SOLENNE', wall: 'back', y: 4.4 },
});
edit(S('lobby'), (z) => {
  const dec = z.flags.room.decor;
  dec.floor = { ...dec.floor, medallion: [0, 5.75, 1.8] };
  dec.lights = [{ at: [0, 5.75], drop: 2.4, k: 1.9, r: 1.3, tiers: 3 }, { at: [-6.5, 5.75], drop: 2, k: 1.2, r: 0.7, tiers: 2 }, { at: [6.5, 5.75], drop: 2, k: 1.2, r: 0.7, tiers: 2 }];
  dec.plants = [[-2.4, 10.6, 1.2], [2.4, 10.6, 1.2], [10.3, 0.95, 1.1], [-6.3, 0.95, 1.05], [-10.4, 10.6, 1.05], [10.4, 10.6, 1.05]];
  dec.sconces = { points: [['back', -3.4], ['back', 3.4], ['back', -7.8], ['back', 7.8]], y: 2.9 };
  dec.art = [{ at: 5.75, h: 1.6, seed: 13, w: 3, wall: 'right', y: 2.6 }];
  dec.walls = { ...dec.walls, y1: 4 };
});

// ── the gym, the café and the Aerie, against the glass ───────────────────────────────────────────────
room(S('gym'), { w: 14, d: 11.4, doors: { south: -4.8 } });
room(S('salon'), { d: 8.8, doors: { south: -3.45 } });
room(S('aerie'), { w: 11, d: 8.8, doors: { south: 3.95 } });
edit(S('aerie'), (z) => {
  z.description = z.description.replace('forty-one floors up', 'nineteen floors up');
  const dec = z.flags.room.decor;
  dec.art = [{ at: 2.6, h: 1.2, seed: 5, w: 1.6, wall: 'right', y: 1.95 }, { at: 5.6, h: 1.2, seed: 44, w: 1.6, wall: 'right', y: 1.95 }];
  dec.lights = [{ at: [0, 4.4], drop: 1.5, k: 1.6, r: 0.95, tiers: 3 }];
  dec.plants = [[4.9, 0.9, 1.05], [-4.9, 8.1, 0.95]];
  dec.sconces = { points: [['right', 1.2], ['right', 4.1], ['right', 7.1], ['back', -4.2], ['back', -1.8]], y: 1.9 };
});
edit(S('hall_41'), (z) => { z.name = 'The Nineteenth Floor'; });

// ── the penthouse: floor 44, the north half of the bowl ───────────────────────────────────────────────
// Not a studio: a studio's plan puts its way in at the right-hand end of the back wall, and the penthouse's door is
// in the middle, where the landing is.
room(S('penthouse'), {
  w: 25, d: 9.3, h: 5, studio: false, balcony: false, glass: ['front', 'left'], doors: { south: 0 },
  ensuite: { w: 4.2, d: 3.4, dress: 'spa' }, pit: { at: [-3, 3, 2.2, 7.2], depth: 0.42, step: 0.42 }, storey: 44, storeys: 45,
});
edit(S('penthouse'), (z) => {
  z.description = 'The whole forty-fourth floor, inside the glass bowl at the top of the tower. One long room of glass and pale stone under a five-metre ceiling, the bay along the whole of one side and the mountains at the end, and none of it able to look back in. An emperor bed on a raised platform at the glass end, a sunken lounge in the middle, a private bar, and a fireplace of honed basalt in the one stone wall. Nothing up here is loud, because nothing up here has to be. Step <b>south</b> to the landing.';
});

// ── the top: the forty-fifth floor's hall, a stair up into the lantern, the deck and the pad round it ──
room(S('hall_45'), { w: 6, d: 4.6, h: 2.91, stair: { at: [-1.4, 4.0], climb: 'front', w: 1.1, going: 0.22 }, sign: { size: 0.2, text: 'ROOF', wall: 'front', y: 2.5 } });
edit(S('hall_45'), (z) => {
  z.exits = { in: S('elevator'), up: S('hall_40') };
  delete z.flags.residents_only; delete z.flags.residents_only_deny;
  z.flags.room.decor.sconces = { points: [['front', -1.55], ['front', 1.55], ['back', 1.7]], y: 1.7 };
  z.description = 'The top of the lift shaft, inside the glass bowl: a bare stone hall with a flight of stone stairs going <b>up</b> through the roof. The wind is loud at the top of them. A fire door marked STAIRS is locked. The elevator is <b>in</b> behind you.';
});
room(S('hall_40'), { w: 4.6, d: 4.6, h: 3.6, face: 0, doors: { down: [-1.4, 1.4] }, glass: ['front', 'left', 'right'] }, ['sign']);
edit(S('hall_40'), (z) => {
  z.name = 'The Lantern';
  [z.grid_x, z.grid_y, z.grid_z] = [0, 0, 9];
  z.exits = { down: S('hall_45'), east: S('helipad'), north: S('skydeck') };
  const dec = z.flags.room.decor;
  delete dec.doors;
  dec.plants = [[1.6, 0.6, 0.85]];
  dec.sconces = { points: [['back', 1.2]], y: 1.8 };
  z.description = 'The foot of the lantern on the roof: a small room under the first of its turned glass tiers, gold light running up the corners. The stairs come up through the floor from the hall <b>down</b> below. The Sky Deck and the pool are <b>north</b>, and the pad is out to the <b>east</b>.';
});
room(S('skydeck'), { w: 27, d: 11, face: 0 });
edit(S('skydeck'), (z) => {
  [z.grid_x, z.grid_y, z.grid_z] = [0, -1, 9];
  z.flags.room.decor.plants = [[12.6, 10.2, 1.1], [-12.6, 10.2, 1.1], [-12.6, 3.4, 0.9], [12.6, 3.4, 0.9]];
  z.description = 'The roof terrace on the north side of the lantern, open to a sky the colour of cold pewter. A lap pool runs the length of the north parapet behind a glass rail, its edge spilling into the drop so the water seems to pour off the roof and into the city itself. Teak loungers, a low fire-trough, and a glass pavilion on the east corner with a marble bar in it. The wind up here is clean and constant, and the whole of Coldwater is spread out beneath you like something you might, one day, afford. The lantern is <b>south</b>.';
});
// the pad's H stands where the model's helideck is: over the facade tile's middle, 3.75 m across the circle
room(S('helipad'), { w: 15.9, d: 11, face: 90, doors: { west: 5.65 } });
edit(S('helipad'), (z) => {
  [z.grid_x, z.grid_y, z.grid_z] = [1, 0, 9];
  z.exits = { west: S('hall_40') };
  const dec = z.flags.room.decor;
  delete dec.doors;
  dec.pad = { at: [3.28, 4.65], r: 3.75 };
  z.description = 'The south-east corner of the roof, over the front door: a square of non-slip deck ringed in recessed landing lights, the H in a circle in the middle of it. A lit windsock at the rail, and past the rail a hundred and sixty metres of air. A refuelling point under a brass cover in the deck. The lantern is <b>west</b>.';
});
// the old fortieth floor's connections go with its hall up to the roof
put('connections', { ...readOne('connections', 'conn_solenne_skydeck_in_onzy'), a: S('hall_45'), dir: 'up', b: S('hall_40'), one_way: false });
put('connections', { ...readOne('connections', 'conn_solenne_elevator_up_lslf'), a: S('hall_40'), dir: 'east', b: S('helipad'), one_way: false });

// ── text elsewhere that names the old floors ────────────────────────────────────────────────────────
const retext = (dir, id, from, to) => {
  const rel = `${dir}/${id}.json`, o = writes.get(rel) || readOne(dir, id), s = JSON.stringify(o);
  if (!s.includes(from)) { fails.push(`${id}: no "${from}" to change`); return; }
  const next = JSON.parse(s.split(from).join(to));
  if (dir === 'zones') Z.set(id, next);
  if (dir === 'furniture') FU.set(id, next);
  put(dir, next);
};
retext('furniture', 'furn_solenne_pool', 'the forty-metre drop', 'a hundred and sixty metres of drop');
retext('furniture', 'secdev_solenne_30b_door', "30-B's door", "8-B's door");
retext('zones', 'zone_seam_914_907', 'forty floors over the grass', 'forty-five floors over the grass');

// ── the furniture: everything in a room that changed, placed again inside its new walls ─────────────
// placed first, by hand: the pool along the north parapet as the model has it, the penthouse's lounge in its pit,
// and 8-B's set on the back wall between the two doors, the one wall it has that's neither glass nor kitchen (the
// Stage put it in front of the card table)
const FIXED = {
  furn_solenne_pool: { at: [0, 1.1], turn: 180 },
  furn_penthouse_lounge: { at: [0, 4.7], turn: 90 },
  furn_solenne_tv_apt_b: { wall: 'back', along: 1.7 },
};
// placeSpot keeps everything out of a pit, and what's in one is there on purpose, so the lounge stands as it's set
const AS_SET = new Set(['furn_penthouse_lounge']);
const LOOK = { furn_solenne_pool: [24, 1.8, 0.5] };
for (const [id, dims] of Object.entries(LOOK)) { const f = clone(FU.get(id)); f.flags.look.dims = dims; FU.set(id, f); put('furniture', f); }
const RESPOT = [...Object.keys(FLATS).map((k) => S(`apt_${k}`)), S('lobby'), S('residences'), S('residences_34'), S('gym'), S('salon'), S('aerie'), S('penthouse'), S('skydeck'), S('helipad'), S('hall_40'), S('hall_45')];

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
  const before = readOne('zones', id.replace(/apt_[gh]$/, (m) => `apt_${FLATS[m.slice(-1)].from}`)).flags.room || {};
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
  if (stuck.length) fails.push(`${id}: seats not reachable from the door: ${[...new Set(stuck.map((s) => s.piece))].join(', ')}`);
  for (const f of withSpots) if (newSpot.has(f.id)) { FU.set(f.id, f); put('furniture', f); }
  report.push(`${id.replace('zone_solenne_', '')}: ${spec.w} x ${spec.d} m, ${rows.length} pieces (${newSpot.size} moved), ${L.seats.length} seats`);
}

// ── the fit: the whole building laid out, every room inside the tower at its height ─────────────────
{
  const M = 1 / TILE_M, ST = 3.6 * M, zPod = 2 * ST, zStem0 = zPod + 0.025, zStem1 = 41 * ST, N = 20, W0 = 0.80, TW = 0.52;
  const segZ = (i) => zStem0 + (zStem1 - zStem0) * (i / N);
  const tierW = (t) => (t < 0.34 ? W0 * (1 - 0.10 * (t / 0.34)) : t < 0.68 ? W0 * 0.80 * (1 - 0.12 * ((t - 0.34) / 0.34)) : W0 * 0.62 * (1 - 0.18 * ((t - 0.68) / 0.32)));
  const parts = [[0, zPod, 0.88, 0]];
  for (let i = 0; i < N; i++) parts.push([segZ(i), segZ(i + 1), tierW(i / N), TW * i / N]);
  [[0.46, 0.39], [0.54, 0.26], [0.62, 0.13], [0.70, 0]].forEach(([Sz, th], j) => parts.push([zStem1 + j * 0.5 * ST, zStem1 + (j + 1) * 0.5 * ST, Sz, th]));
  parts.push([43 * ST, 45 * ST, 0.74, 0], [45 * ST, 45 * ST + 0.04, 0.78, 0]);
  const T = (x) => x * TILE_M, roof = T(45 * ST + 0.04);
  const usable = (z0, z1) => { const ps = parts.filter((p) => T(p[1]) > z0 + 1e-3 && T(p[0]) < z1 - 1e-3); return ps.length ? Math.min(...ps.map(([, , Sz, th]) => T(Sz) / (Math.cos(th) + Math.sin(th)))) : Infinity; };
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
    const half = R.floor >= roof - 0.05 ? T(0.78 - 0.008) : usable(R.floor, top);
    const slack = (0.97 - 0.88) * TILE_M + 0.05;
    const over = Math.max(-x0 - half, x1 - half, -n0 - (id === S('lobby') ? half + slack : half), n1 - half);
    report.push(`${over > 0.05 ? 'OUT ' : ' ok '}${id.replace('zone_solenne_', '').padEnd(14)} floor ${R.floor.toFixed(1).padStart(6)}  x ${x0.toFixed(1)}..${x1.toFixed(1)}  n ${n0.toFixed(1)}..${n1.toFixed(1)}  plate ±${half.toFixed(1)}`);
    if (over > 0.05) fails.push(`${id} stands ${over.toFixed(2)} m outside the tower`);
  }
}

for (const line of report) console.log(line);
if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`\n✗ solenne-rooms: ${fails.length} problem(s); nothing written`);
  process.exit(1);
}
let wrote = 0;
for (const [rel, data] of writes) {
  const file = path.join(C, rel), json = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json) continue;
  if (!DRY) fs.writeFileSync(file, json);
  wrote++;
}
console.log(`✓ solenne-rooms: ${wrote} files ${DRY ? 'to write' : 'written'}`);
