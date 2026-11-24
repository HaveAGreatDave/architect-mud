// One-shot: the two car parks (Airport Parking Plaza, Marrow Street Parking) cut down to four rooms each, fitted to
// their GLASS models (docs/proposals/one-world-interiors.md). The model stays as it is; the rooms change to fit it.
//
//   node scripts/content/carpark-carousel.mjs [--write]
//
// Before, each had a lobby, a lift, a roof pad, and on each of four levels a landing with three slot bays off it:
// sixteen rooms laid about 30 m across a model 12 to 13 m square. The carousel is a machine, so nobody needs to walk
// its levels. What's left:
//   - the lobby, on the street, with the pay station, fitted so the lift car stands on the model's core;
//   - the core lift, the car mover, which rides you up with your craft;
//   - the carousel (the old level 2 room, its id kept): a strip of floor along the drum with one cradle where the drum
//     opens. Your craft is run out to it when you arrive (plugins/flight/hangars.js `bay_zone`);
//   - the roof pad, unchanged.
// Levels 3 to 5 and the twelve slot bays are deleted with their connections and terminals; the slots themselves stay
// slots in the drum (`levels` on the terminals, three a level), so a ticket still names one. A player logged out in
// a deleted room is rescued at login (server/index.js).
//
// It refuses to run twice: once level 3 is gone there's nothing to do.
import fs from 'node:fs';
import path from 'node:path';

const C = path.resolve(process.cwd(), 'content');
const WRITE = process.argv.includes('--write');
const file = (dir, id) => path.join(C, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
// the files keep their own key order (they aren't canonical), so a write changes only what it changes
const writes = new Map(), deletes = [];
const put = (dir, obj) => writes.set(`${dir}/${obj.id}`, obj);

// The model at each tile (shapeFor + buildingScale): the apark's plate is 12 m square, the sdeck's 13.2 m, both with
// a core box across most of it and decks about 2.2 m apart. The lobby runs from the street wall to the core, so the
// car behind it stands on the core's axis, and the carousel stands across the car from its doors, on the street side.
const PARKS = [
  { P: 'zone_apark_', bld: 'Airport Parking Plaza', street: 'east', face: 90, half: 6.0 },
  { P: 'zone_sdeck_', bld: 'Marrow Street Parking', street: 'south', face: 180, half: 6.6 },
];

if (!fs.existsSync(file('zones', 'zone_sdeck_l3')) && !fs.existsSync(file('zones', 'zone_apark_l3'))) {
  console.log('carpark-carousel: already done');
  process.exit(0);
}

const conns = fs.readdirSync(path.join(C, 'connections')).map((f) => JSON.parse(fs.readFileSync(path.join(C, 'connections', f), 'utf8')));
const furn = fs.readdirSync(path.join(C, 'furniture')).map((f) => JSON.parse(fs.readFileSync(path.join(C, 'furniture', f), 'utf8')));

for (const { P, bld, street, face, half } of PARKS) {
  const L2 = `${P}l2`, LIFT = `${P}lift`, LOBBY = `${P}lobby`, PAD = `${P}pad`;
  const gone = new Set([3, 4, 5].map((n) => `${P}l${n}`).concat(Array.from({ length: 12 }, (_, i) => `${P}s${i + 1}`)));
  const CAR = 1.1, D = Math.round((half - CAR) * 10) / 10;

  // the lobby: the street wall to the core
  const lobby = read('zones', LOBBY);
  lobby.flags.room = { w: 10, d: D, h: 3.4, face, finish: 'plain', ground: 'concrete', studio: false, balcony: false,
    doors: { [street]: 0, in: 0 }, street_door: { kind: 'sliding', w: 1.6 } };
  put('zones', lobby);

  // the core lift: two stops, the carousel and the pad
  const lift = read('zones', LIFT);
  lift.exits = { ...lift.exits, up: [L2, PAD] };
  lift.flags.elevator_floors = lift.flags.elevator_floors.filter((f) => f.zone === L2 || f.zone === PAD)
    .map((f) => (f.zone === L2 ? { ...f, label: 'Carousel' } : f));
  lift.flags.room = { balcony: false, car: true, d: 2.2, face, finish: 'plain', h: 2.7, studio: false, w: 2.2, windowless: true };
  put('zones', lift);

  // the carousel: the old level 2, a strip along the drum with one cradle
  const car = read('zones', L2);
  car.name = `${bld}, Carousel`;
  car.description = 'A strip of black concrete along the carousel drum, with a cyan line at the edge and one cradle bay where the drum opens. Feed the terminal your ticket and whatever you parked comes out of the wall on rails. The lift is <b>in</b>.';
  car.exits = { in: LIFT };
  const room = car.flags.room;
  car.flags = { ...car.flags, sdeck_bay: true, field_zone: read('furniture', `furn_${P.slice(5, -1)}_pay_station`).flags.field_zone };
  car.flags.room = { ...room, w: 12, d: D, h: 3.4, face, doors: {},
    stand: { kind: 'sdeck', at: [2.6, D / 2], face: 'right', from: 'back', len: 6.4, wid: 4 },
    decor: { ...(room.decor || {}), signs: [{ wall: 'back', along: -3, y: 2.6, h: 0.16, text: 'CAROUSEL', hex: '#28c4e4', plateHex: '#0d0f12' }],
      strips: [{ along: 'u', at: [0, D - 0.6], len: 8 }], paint: [{ kind: 'line', from: [-5.8, 0.3], to: [5.8, 0.3], hex: '#28c4e4', t: 0.1 }, { kind: 'hazard', rect: [-0.8, 6, 0.6, D - 0.6], t: 0.2 }] } };
  put('zones', car);

  // terminals: every one names the carousel; slot 1's moves into it, the rest go
  const swap = (f) => { const fl = { ...f.flags, bay_zone: L2 }; delete fl.slot_prefix; return { ...f, flags: fl }; };
  for (const f of furn) {
    if (f.zone_id === LOBBY || f.zone_id === PAD) { if (f.flags?.slot_prefix) put('furniture', swap(f)); continue; }
    if (!gone.has(f.zone_id)) continue;
    deletes.push(`furniture/${f.id}`);
    if (f.zone_id === `${P}s1`) put('furniture', { ...swap(f), id: `furn_${P.slice(5, -1)}_carousel_terminal`, zone_id: L2, name: 'carousel terminal',
      description: 'A steel terminal by the cradle with a ticket slot. Feed it your ticket and you climb in; the lift takes you and your craft up to the roof pad.' });
  }
  for (const c of conns) if (gone.has(c.a) || gone.has(c.b)) deletes.push(`connections/${c.id}`);
  for (const id of gone) deletes.push(`zones/${id}`);
  // the lift's up exits are connections too: one each way to every stop it had
  for (const c of conns) if ((c.a === LIFT && gone.has(c.b)) || (c.b === LIFT && gone.has(c.a))) deletes.push(`connections/${c.id}`);
}

const del = [...new Set(deletes)].filter((k) => !writes.has(k));
console.log(`carpark-carousel: ${writes.size} files written, ${del.length} deleted${WRITE ? '' : ' (dry run; --write to apply)'}`);
for (const k of writes.keys()) console.log('  write ', k);
for (const k of del) console.log('  delete', k);
if (WRITE) {
  for (const [k, obj] of writes) {
    const p = path.join(C, `${k}.json`);
    const nl = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').endsWith('\n') : true;
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + (nl ? '\n' : ''));
  }
  for (const k of del) fs.rmSync(path.join(C, `${k}.json`), { force: true });
}
