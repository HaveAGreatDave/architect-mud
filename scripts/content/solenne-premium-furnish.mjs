// One-shot: the Solenne's premium flats (34-A, 36-A, 40-A) furnished like Cyd's 38-B (solenne-38b.mjs): a balcony
// round the glass sides with the lounge chair and a teak bench on it, the silk rug under the bed, and a dining
// table for six by the kitchen.
//
//   node scripts/content/solenne-premium-furnish.mjs
//
// u runs west (-) to east (+), v from the north glass (0) back to the lift wall. The kitchen is the east wall's
// run, starting at KITCHEN_U; the dining table stands west of it.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const C = path.resolve(process.cwd(), 'content');
const file = (dir, id) => path.join(C, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const write = (dir, o) => fs.writeFileSync(file(dir, o.id), canonicalJson(o));

const KITCHEN_U = { p: 8.35, q: 8.75, r: 9.55 };
for (const k of ['p', 'q', 'r']) {
  const ZONE = `zone_solenne_apt_${k}`;
  const bed = read('furniture', `furn_solenne_bed_${k}`).flags.spot.at;
  { const z = read('zones', ZONE);
    z.flags.room.balcony = { wrap: 'sides' };
    z.flags.room.decor = { ...(z.flags.room.decor || {}), rug: { at: bed, w: 3.4, d: 3.6, style: 'persian' } };
    write('zones', z); }
  // the lounge chair out on the deck (v is negative past the north glass)
  { const f = read('furniture', `furn_solenne_apt_${k}_lounger`); f.flags.spot = { at: [-6, -1.3], turn: 0 }; write('furniture', f); }
  write('furniture', {
    id: `furn_solenne_${k}_balcony_bench`, zone_id: ZONE, object_type: 'furniture', name: 'teak bench', price: 1100,
    description: 'A slatted teak bench on the balcony, silvered by the weather, facing the bay.',
    flags: { interactions: ['sit'], look: { arche: 'bench', form: 'bench', dims: [1.8, 0.5, 0.46] }, spot: { at: [-1.2, -1.6], turn: 180 } },
  });
  // a dining table for six west of the kitchen, its long side north-south
  const DX = +(KITCHEN_U[k] - 2.3).toFixed(2), DY = 4.4;
  write('furniture', {
    id: `furn_solenne_${k}_dining_table`, zone_id: ZONE, object_type: 'furniture', name: 'dining table', price: 3600,
    description: 'A walnut dining table by the kitchen, seating six, with a runner of grey linen down the middle.',
    flags: { interactions: ['examine'], look: { arche: 'table', form: 'dining', dims: [2.0, 0.95, 0.76] }, spot: { at: [DX, DY], turn: 90 } },
  });
  [[-0.92, -0.65, 90], [-0.92, 0, 90], [-0.92, 0.65, 90], [0.92, -0.65, -90], [0.92, 0, -90], [0.92, 0.65, -90]].forEach(([du, dv, turn], i) => write('furniture', {
    id: `furn_solenne_${k}_dining_chair_${i + 1}`, zone_id: ZONE, object_type: 'furniture', name: 'dining chair', price: 480,
    description: 'A walnut dining chair with a grey linen seat, one of six round the table.',
    flags: { aliases: ['chair'], interactions: ['sit'], look: { arche: 'seat', form: 'chair', fabric: '#8a8578', wood: '#2e2119', wear: 0.04 }, spot: { at: [+(DX + du).toFixed(2), +(DY + dv).toFixed(2)], turn } },
  }));
}
console.log('solenne-premium-furnish: done');
