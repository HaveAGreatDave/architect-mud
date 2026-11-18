// One-shot: Cyd's flat, 38-B in the Solenne, arranged as he asked. The desk in the corner where the two walls of
// glass meet, a balcony round the glass sides with the lounge chair, the boombox, the cigarette box and a teak bench
// on it, the silk rug under the bed, the sofa facing the set, a long dining table by the kitchen with eight chairs,
// and the card table and its six chairs in the middle.
//
//   node scripts/content/solenne-38b.mjs
//
// The room is 23.8 by 9.1 m: u runs west (-) to east (+), v from the north glass (0) back to the lift wall (9.1).
// The kitchen is the east wall's run, v 2.6 to 6.9; the Cachet's bar wall is on the back wall, west of the door.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const C = path.resolve(process.cwd(), 'content');
const file = (dir, id) => path.join(C, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const write = (dir, o) => fs.writeFileSync(file(dir, o.id), canonicalJson(o));
const ZONE = 'zone_solenne_apt_b';

// the room: a deck round the glass front and both ends (the back is the lift), and the rug under the bed
const BED = [-6.7, 5.3];
{ const z = read('zones', ZONE);
  z.flags.room.balcony = { wrap: 'sides' };
  z.flags.room.decor = { ...(z.flags.room.decor || {}), rug: { at: BED, w: 3.4, d: 3.6, style: 'persian' } };
  write('zones', z); }

// where each of his pieces goes; turn 180 faces north-to-south (+v), 0 faces the glass, 90 faces east, -90 west
const spot = (id, s) => { const f = read('furniture', id); f.flags.spot = s; write('furniture', f); };
spot('furn_solenne_bed_b', { at: BED, turn: 90 });
spot('furn_solenne_b_pc_desk', { at: [-10.7, 1.1], turn: -180 });
spot('furn_solenne_b_reading_chair', { at: [-10.2, 2.4], turn: -45 });
// on the balcony: the deck is 2.4 m deep past the north glass, so v is negative
spot('furn_solenne_apt_b_lounger', { at: [-6.2, -1.3], turn: 0 });
spot('furn_solenne_apt_b_boombox', { at: [-4.7, -0.6], turn: 180 });
spot('furn_solenne_apt_b_smokes', { at: [-7.7, -0.7], turn: 0 });
// the sofa at the back of the lounge facing the set on the back wall, the coffee table at its side (both must
// stand in the lounge, v 0 to 5.3), the cassette deck beside the set
spot('furn_solenne_tv_apt_b', { wall: 'back', along: -1.5 });
spot('furn_solenne_b_sofa', { at: [-1.5, 4.7], turn: 180 });
spot('furn_solenne_b_table', { at: [0.4, 4.5], turn: 0 });
spot('furn_betamax_zone_solenne_apt_b', { at: [0.5, 8.7], turn: 0 });
// the card table in the middle, long side east-west, two chairs a side and one at each end
const PX = 2.5, PY = 3.2;
spot('furn_solenne_apt_b_dining', { at: [PX, PY], turn: 0 });
spot('furn_solenne_b_card_chair_1', { at: [PX - 0.6, PY - 1.2], turn: 180 });
spot('furn_solenne_b_card_chair_2', { at: [PX + 0.6, PY - 1.2], turn: 180 });
spot('furn_solenne_b_card_chair_4', { at: [PX - 0.6, PY + 1.2], turn: 0 });
spot('furn_solenne_b_card_chair_5', { at: [PX + 0.6, PY + 1.2], turn: 0 });
spot('furn_solenne_b_card_chair_6', { at: [PX - 1.7, PY], turn: 90 });
spot('furn_solenne_b_card_chair_3', { at: [PX + 1.7, PY], turn: -90 });

// new: a long dining table by the kitchen, long side north-south, three chairs a side and one at each end
const DX = 6.6, DY = 4.8;
write('furniture', {
  id: 'furn_solenne_b_dining_table', zone_id: ZONE, object_type: 'furniture', name: 'dining table', price: 4200,
  description: 'A long table in black walnut by the kitchen, seating eight, with a runner of grey linen down the middle. Nobody eats at it. The card table gets all the use.',
  flags: { interactions: ['examine'], look: { arche: 'table', form: 'dining', dims: [2.4, 1.0, 0.76] }, spot: { at: [DX, DY], turn: 90 } },
});
const CHAIRS = [
  [DX - 0.95, DY - 0.8, 90], [DX - 0.95, DY, 90], [DX - 0.95, DY + 0.8, 90],
  [DX + 0.95, DY - 0.8, -90], [DX + 0.95, DY, -90], [DX + 0.95, DY + 0.8, -90],
  [DX, DY - 1.65, 180], [DX, DY + 1.65, 0],
];
CHAIRS.forEach(([u, v, turn], i) => write('furniture', {
  id: `furn_solenne_b_dining_chair_${i + 1}`, zone_id: ZONE, object_type: 'furniture', name: 'dining chair', price: 480,
  description: 'A walnut dining chair with a grey linen seat, one of eight round the long table.',
  flags: { aliases: ['chair'], interactions: ['sit'], look: { arche: 'seat', form: 'chair', fabric: '#8a8578', wood: '#2e2119', wear: 0.04 }, spot: { at: [+u.toFixed(2), +v.toFixed(2)], turn } },
}));
// new: a teak bench on the balcony
write('furniture', {
  id: 'furn_solenne_b_balcony_bench', zone_id: ZONE, object_type: 'furniture', name: 'teak bench', price: 1100,
  description: 'A slatted teak bench on the balcony, silvered by the weather, facing the bay. The wind up here finds you wherever you sit.',
  flags: { interactions: ['sit'], look: { arche: 'bench', form: 'bench', dims: [1.8, 0.5, 0.46] }, spot: { at: [-1.2, -1.6], turn: 180 } },
});
console.log('solenne-38b: done');
