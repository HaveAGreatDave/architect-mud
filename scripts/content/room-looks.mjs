// One-shot authoring pass for the Room Stage (docs/proposals/room-stage.md): gives the rows in a flat
// the `flags.look` that their flags can't say, because a mattress and a sofa are both `sit` and `lie`,
// and writes the Solenne Residences' `flags.room`. Idempotent; re-run it after adding a row with one
// of these names. It only ever touches rows in a flat or that flat's en-suite.
//
//   node scripts/content/room-looks.mjs
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/', FURN = 'content/furniture/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const zones = new Map(fs.readdirSync(ZONES).filter((f) => f.endsWith('.json')).map((f) => { const z = read(ZONES + f); return [z.id, z]; }));
const flats = [...zones.values()].filter((z) => z.flags?.is_apartment || z.flags?.is_dwelling);
const home = new Set(flats.map((z) => z.id));
for (const z of flats) { const b = zones.get(z.exits?.in); if (b?.parent_zone === z.id) home.add(b.id); }

// by name, in a flat: what the row is, since its flags don't say
const LOOKS = [
  [/^(platform bed)$/, { arche: 'bed', form: 'platform' }],
  [/^emperor bed$/, { arche: 'bed', form: 'platform', dims: [3.6, 2.7, 0.62] }],
  [/^(a |the )?(prefab |wide |proper |iron |iron-frame |iron-frame single |black-silk )?bed$/, { arche: 'bed', form: 'bed' }],
  [/mattress$/, { arche: 'bed', form: 'mattress' }],
  [/(^|\s)cot$|camp bed$/, { arche: 'sofa', form: 'cot' }],
  [/bathtub$|^the bath$/, { arche: 'shower', form: 'bath' }],
  [/soaking tub$|^stone bath$/, { arche: 'shower', form: 'soak' }],
  [/induction seam$/, { arche: 'hob', form: 'seam' }],
  [/micro-LED screen$/, { arche: 'screen', form: 'flat', dims: [3.4, 0.1, 1.5] }],
  [/^glass-front cabinet$/, { arche: 'cabinet', form: 'vitrine' }],
  [/^lacquered box$/, { arche: 'small', form: 'box' }],
  [/bean-to-cup$/, { arche: 'top', form: 'press' }],
  [/^dish rack$/, { arche: 'cabinet', form: 'rack' }],
  [/coffee table$/, { arche: 'table', form: 'coffee' }],
  [/^fold-down table$/, { arche: 'table', form: 'dining' }],
  [/crate$|footlocker$/, { arche: 'store', form: 'crate' }],
  [/armchair$/, { arche: 'seat', form: 'armchair' }],
  [/shelving unit$|shelf of ring binders$/, { arche: 'store', form: 'shelves' }],
  [/^mirrored wardrobe$/, { arche: 'wardrobe', form: 'wardrobe' }],
  [/hot ?plate$/, { arche: 'hob', form: 'cooktop' }],
  [/^rust-run sink$/, { arche: 'sink', form: 'kitchen' }],
];
// a bathroom in the tower is a wet room in stone, with a wall-hung pan
const FINE_BATH = { toilet: { arche: 'toilet', form: 'hung' }, shower: { arche: 'shower', form: 'wetroom' } };

// the Solenne Residences: a corner flat and the crown have glass on two sides. The crown's third side
// is the wall the set hangs on and the kitchen runs down
const FINE = { finish: 'fine', storeys: 36, ensuite: { w: 3.2, d: 3.4 } };
const ROOMS = {
  zone_solenne_apt_a: { w: 10, d: 11.5, h: 2.9, glass: ['front'], ...FINE },
  zone_solenne_apt_b: { w: 12, d: 13, h: 3, glass: ['front', 'left'], ...FINE },
  zone_solenne_apt_c: { w: 10, d: 11, h: 2.9, glass: ['front'], ...FINE },
  zone_solenne_apt_d: { w: 11, d: 12, h: 2.9, glass: ['front'], ...FINE },
  zone_solenne_apt_e: { w: 12.5, d: 13.5, h: 3, glass: ['front', 'left'], ...FINE },
  zone_solenne_apt_f: { w: 10, d: 11, h: 2.9, glass: ['front'], ...FINE },
  zone_solenne_penthouse: { w: 16, d: 18, h: 5, glass: ['front', 'left'], storey: 35, ...FINE, ensuite: { w: 4.2, d: 4.4 }, balcony: { wrap: 'all' }, ground: 'stone', pit: { at: [-2.4, 3.8, 3.2, 9.2], depth: 0.42, step: 0.42 } },
};

// rows a room's text promises and nothing stood for: the tower's D, E and F en-suites had none, and
// 30-B's text names a chair and a stone bath
const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const NEW = [
  row('furn_solenne_b_reading_chair', 'zone_solenne_apt_b', 'reading chair', 'furniture', 'A deep chair in grey wool, turned a little off square so it faces the corner of the glass and not the room.', { interactions: ['sit'], look: { arche: 'seat', form: 'armchair' }, spot: { at: [-4.4, 1.7], turn: -38 } }),
  row('furn_solenne_b_stone_bath', 'zone_solenne_apt_b', 'stone bath', 'decoration', 'A bath cut from a single block of grey stone, deep enough to sit up to your neck in. It stands out in the room by the north glass. Nobody has to see you in it, and at this height nobody can.', { look: { arche: 'shower', form: 'soak' }, spot: { at: [-4.7, 8.2], turn: 90 } }),
];
// a lounge for each of them: the tower's rows were a bed, a kitchen and a set, and a studio this size
// has a whole end of the room with nothing in it. The crown's is sunken, and its rows are written by
// hand with their spots, so this leaves them alone
for (const [id, zone] of [['a', 'zone_solenne_apt_a'], ['b', 'zone_solenne_apt_b'], ['c', 'zone_solenne_apt_c'], ['d', 'zone_solenne_apt_d'], ['e', 'zone_solenne_apt_e'], ['f', 'zone_solenne_apt_f']]) {
  NEW.push(row(`furn_solenne_${id}_sofa`, zone, 'low sofa', 'furniture', 'A long low sofa in grey wool, deep enough to sleep on and firm enough that you would rather not.', { interactions: ['sit', 'lie'] }));
  NEW.push(row(`furn_solenne_${id}_table`, zone, 'coffee table', 'furniture', 'A low oak table with two books on it that nobody chose.', { interactions: ['lean'], look: { arche: 'table', form: 'coffee' } }));
}
for (const id of ['d', 'e', 'f']) {
  const z = `zone_solenne_apt_${id}_bath`;
  NEW.push(row(`furn_${z}_shower`, z, 'shower', 'shower', 'A rain head let into the ceiling over a fall in the stone floor, behind one pane of glass.', {}));
  NEW.push(row(`furn_${z}_sink`, z, 'sink', 'sink', 'A bowl cut into a slab of grey stone that floats off the wall, under a mirror lit from behind.', { water_source: true }));
  NEW.push(row(`furn_${z}_toilet`, z, 'toilet', 'toilet', 'A low pan hung off a stone panel, its cistern somewhere in the wall.', {}));
}

// a file is only written when it would change, so a second run writes nothing
const save = (file, data) => {
  const text = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 0;
  fs.writeFileSync(file, text, 'utf8');
  return 1;
};
let wrote = 0;
for (const f of fs.readdirSync(FURN)) {
  if (!f.endsWith('.json')) continue;
  const r = read(FURN + f);
  if (!home.has(r.zone_id)) continue;
  const fine = /^zone_solenne_/.test(r.zone_id) && /_bath$/.test(r.zone_id);
  const look = (fine && FINE_BATH[r.object_type]) || LOOKS.find(([re]) => re.test(r.name))?.[1];
  if (!look) continue;
  // a size written on the row by hand stays; this only says what the row is
  r.flags = { ...(r.flags || {}), look: r.flags?.look?.dims ? { ...look, dims: r.flags.look.dims } : look };
  wrote += save(FURN + f, r);
}
for (const r of NEW) {
  const look = /_bath$/.test(r.zone_id) ? FINE_BATH[r.object_type] : null;
  if (look) r.flags.look = look;
  wrote += save(FURN + r.id + '.json', r);
}
for (const [id, room] of Object.entries(ROOMS)) {
  const z = zones.get(id);
  z.flags.room = room;
  wrote += save(`${ZONES}${id}.json`, z);
}
console.log(`${wrote} files written`);
