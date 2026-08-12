// Demote the old Thornwarren shells to a picket.
//
// Four tiles south of the Curtain were authored in 2026-07 as the Wildblood camp and then never
// populated. Their descriptions promise an elder called the Chorus holding court, a trader's lean-to
// and a surgeon's tent, and none of those three things exist anywhere in the world. A room that
// names people who are not in it is worse than an empty room: it reads as a bug the first time and
// as neglect every time after.
//
// The Thornwarren is now a walled town in The Scarletwastes (scripts/build-scarletwastes.mjs), where
// the Chorus, the trader and the physic actually stand. So these four stop pretending to be the camp
// and become what they always physically were: a forward picket a day's walk from the South Gate,
// held by nobody in particular, pointing southeast at the real thing.
//
// Nothing here is deleted and no exit changes. Only `name` and `description`, and only on these four.
// Re-runnable. Run: node scripts/demote-thornwarren-shells.mjs

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function canonical(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + '\n';
}

const EDITS = {
  zone_district_919_924: {
    name: 'The Bone Arch',
    description: 'An arch of welded bone and rail standing over the track for no structural reason whatsoever, which is the point of it. Rags hang from the span, eaten to lace by the rain. The ground underneath has been walked to powder by a great many feet going both ways over a great many years. Somebody maintains this: the wire at the joints is bright, and it has been replaced a bit at a time rather than all at once. Nobody is here now.',
  },
  zone_district_919_925: {
    name: 'The Picket',
    description: 'A forward camp, and an old one: three lean-tos of salvage panel around a fire pit gone cold, a rack for drying, and a water drum lidded and chained. It is swept. Whoever uses this place uses it in passing and expects to come back, and has not been back for a few days. A board on the arch post carries a chalked list of names against dates, most of them crossed through. The track runs on southeast, and the ruts leaving that way are much deeper than the ruts arriving.',
  },
  zone_district_920_926: {
    name: 'The Seep',
    description: 'A shallow scald in the rock holding water that has no business being that colour, fed by something under the ground that nobody has ever found the top of. The rim is crusted white. Bones in the shallows, small ones, gone the same shade as the crust. This is not a holy place and nothing has been left here on purpose. It is simply where the ground leaks, and the Wildblood who pass through here fill nothing from it and camp upwind.',
  },
  zone_district_919_927: {
    name: 'The Deeper Wild',
    description: 'The trail thins to a game-track running southeast, out into flat blasted country that goes to the horizon and keeps going. This is the road to The Scarletwastes: four days on foot if the weather holds, which out there it does not, and the rain past the second day eats through a coat and then through you. There is a cairn at the trailhead with a lamp on it, sheltered, and the lamp has oil in it, and somebody comes out this far to fill it. Far off to the southeast the horizon carries a dark line that does not behave like a ridge.',
  },
};

let n = 0;
for (const [id, patch] of Object.entries(EDITS)) {
  const p = join(ROOT, 'content', 'zones', `${id}.json`);
  const z = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, canonical({ ...z, ...patch }), 'utf8');
  n++;
}
console.log(`demoted ${n} Thornwarren shell(s) to picket; the camp now lives in region_scarletwastes`);
