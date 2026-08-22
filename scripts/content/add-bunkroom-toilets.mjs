/**
 * A toilet in each depot bunkroom.
 *
 * `object_type: 'toilet'` is the whole requirement — `isToilet` in
 * plugins/bodily matches on object_type, a `flags.toilet` key, OR the word in
 * the name, and the first of those is the one that does not depend on how
 * somebody spelled it. Every shipped toilet in the world uses it.
 *
 * `water_source` is set the way the apartment fixtures do it: the cistern is
 * plumbed, so the room now has two places to fill something (the sink already
 * had it) and neither is a special case.
 *
 * The bunkrooms already read as having plumbing — the authored description
 * mentions the sink and the strip of mirror — so this is furniture catching up
 * with a room that was already described as having it, in the same flat register
 * as the rest of the fittings.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ROOT = path.resolve(process.cwd(), 'content', 'furniture');

// Per depot, so the rooms are not five copies of one sentence. Same fixture,
// same age, different building.
const FLAVOUR = {
  bonded:   'A steel pan in the corner behind a half-height partition that stops at the shoulder, which everybody has agreed to treat as a door. The cistern runs on for a while after it is used and then thinks better of it.',
  deadleg:  'A steel pan behind a partition, bolted through the concrete and a good deal older than the shed around it. Somebody has stencilled FLUSH TWICE on the wall at eye height, in the same paint as the trailer numbers outside.',
  dryrun:   'A steel pan behind a plywood partition gone soft at the bottom edge. The cistern fills slowly enough that there is an understood interval between one driver and the next, and everybody keeps to it.',
  lastload: 'A steel pan behind a partition somebody has patched with a road sign. The cistern was replaced recently and works better than anything else in the building, which is either luck or the only thing anyone here has ever prioritised.',
  roadhead: 'A steel pan behind a partition, scrubbed to a shine that is frankly out of keeping with the rest of the depot. There is a rota taped above it. The rota is being kept.',
};

for (const [depot, description] of Object.entries(FLAVOUR)) {
  const obj = {
    id: `furn_bunk_${depot}_toilet`,
    name: 'a steel toilet',
    zone_id: `zone_bunk_${depot}`,
    object_type: 'toilet',
    description,
    flags: {
      aliases: 'toilet,pan,bog,head,cistern',
      water_source: true,
    },
    hp: null, hp_max: null,
    light_type: null, lumen_output: null,
    power_draw_kw: null,
    price: 0,
  };
  fs.writeFileSync(path.join(ROOT, `${obj.id}.json`), canonicalJson(obj), 'utf8');
  console.log(`  created content/furniture/${obj.id}.json`);
}

console.log('done.');
