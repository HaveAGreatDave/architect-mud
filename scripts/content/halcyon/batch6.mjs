/**
 * Halcyon Fields, batch 6 — the second armature.
 *
 * batch0 gave the quarter four streets: Halcyon Boulevard along the top, Kerbstone Row across
 * the middle, and Kettle Lane and Cinder Lane down through it. That is a grid of superblocks,
 * and the biggest of them is seven tiles by five with no way into the middle of it at all —
 * which is why two thirds of Halcyon Fields is still meadow with a tower standing in it.
 *
 * This lays the streets that open the middle, plus the perimeter lane along the Curtain.
 *
 * ⚠ ONLY TWO TILES ON KERBSTONE ROW CAN CARRY A ROAD NORTH INTO THE BIG BLOCK. The block's
 * north edge (y911) is a solid frontage onto the boulevard and its west edge is the Curtain, so
 * every way in comes off Kerbstone Row or Kettle Lane — and of the seven tiles on Kerbstone Row
 * that face the block, five are already built on (Light Relief, Leaf It Out, Glass Half Full,
 * Ivory Tower and, one row in, Second Wind). x893 and x898 are the only two left. The mews goes
 * up x893, and x898 is kept as a plot, because a second parallel mews four tiles away would
 * serve nothing a through street does not.
 *
 * ⚠ AND SORREL WAY RUNS ALONG y914 RATHER THAN y913 SO THAT IT IS A STREET AND NOT A SPUR.
 * Second Wind stands at 898,913, so a road on that row dead-ends against its flank; one row
 * south the same road reaches Kettle Lane at 899,914 and the block gets a route through it.
 *
 * ⚠ VETCH GREEN IS THREE TILES THAT NO STREET CAN REACH, AND THAT IS WHY IT IS A GREEN.
 * 895–897,912 are enclosed on all four sides by frontage: the boulevard row above them, Sorrel
 * Way's plots below, and the mews too far west to help. A building there would have no door.
 * A garden square behind a boulevard frontage is what that shape of land is actually for.
 *
 * ⚠ THERE IS STILL NO ROAD ALONG y919, FOR batch0'S REASON: `curtainSegs` builds the Curtain's
 * arms from the TILE CENTRE, so a road laid on the wall's own row is a road with a wall down
 * the middle of every tile of it. Windrow Lane runs one row in, at y918, and y919 stays verge.
 *
 * Idempotent: re-running writes the same bytes. `--dry-run` reports and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib.mjs';

const DRY = process.argv.includes('--dry-run');
const ZONES = 'content/zones';
const zonePath = (x, y) => path.join(ZONES, `zone_district_${x}_${y}.json`);
const HF = 'halcyon_fields';

let wrote = 0, same = 0;
const write = (file, obj) => {
  const json = canonicalJson(obj);
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === json) { same++; return; }
  if (!DRY) fs.writeFileSync(file, json, 'utf8');
  wrote++;
  console.log(`  ${prev === null ? 'create' : 'update'}  ${file}`);
};

const readZone = (x, y) => {
  const f = zonePath(x, y);
  if (!fs.existsSync(f)) throw new Error(`no zone file at ${x},${y}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
};

// A tile a street is about to be laid on must be open ground. Refusing here rather than
// overwriting is the whole reason this script can be re-run: a plot that has since been built
// on is a mistake in the plan, not a tile to pave over.
const road = (x, y, name, description) => {
  const z = readZone(x, y);
  if (z.flags?.is_building) throw new Error(`${x},${y} is ${z.name}, a building — the street plan is wrong`);
  z.name = name;
  z.description = description;
  z.ambient_theme = 'city';
  delete z.color;                 // road tiles carry no colour override; the grass ones do
  delete z.flags.park_feature;
  z.flags = {
    ...z.flags,
    district: HF,
    terrain: 'road',
    street_life: true,
    scavenging_table_id: 'scav_roadside_junk',
  };
  write(zonePath(x, y), z);
};

const rename = (x, y, name, description) => {
  const z = readZone(x, y);
  z.name = name;
  if (description) z.description = description;
  write(zonePath(x, y), z);
};

// ── 1. Vetch Mews — north off Kerbstone Row into the big block ───────────────
// A mews, because that is what it is: a service lane up the back of a boulevard frontage,
// dead-ending at the rear wall of the recital hall. It was drawn on the plan as a crescent
// with a turning head. It was built as a straight line with nowhere to turn.
console.log('\n[1] Vetch Mews (x893, y912-915)');
const VETCH = {
  915: 'A lane turns off the row here between two towers and goes north into the block, narrow enough that two vehicles meeting would have to talk about it. The sign at the mouth has the estate crest on it and a name in a script nobody would choose for a service road.',
  914: 'Bin stores on both sides, chrome-fronted and numbered, each with a keypad and a smell that no amount of brushed steel does anything about. A cat that belongs to nobody has an arrangement with the one at the north end.',
  913: 'The mews crosses Sorrel Way at a junction with no markings on it, the two roads simply meeting and carrying on. Somebody has spray-painted a give-way triangle onto the stone, freehand, roughly where one ought to go.',
  912: "The dead end. Sound Investment's back wall closes it off: forty feet of blank chrome with a stage door in it, a bell, and a grille over the bell. Delivery vans reverse the whole length of the mews rather than try to turn here.",
};
for (const [y, d] of Object.entries(VETCH)) road(893, Number(y), 'Vetch Mews', d);

// ── 2. Sorrel Way — the through street across the block ──────────────────────
console.log('\n[2] Sorrel Way (y914, x894-898)');
const SORREL = {
  894: 'The west end of Sorrel Way, where it comes off the mews. The stone is newer here than anywhere else in the quarter and has not been driven on enough to grey.',
  895: 'A row of young trees stands in chrome grilles along the north kerb, each one strapped to three stakes and each one dead. The straps are still tight.',
  896: 'The middle of the street, and the only stretch of Halcyon Fields where you can stand in a road and see buildings on both sides of you. It is not much, but it is the first of it.',
  897: 'Cable covers run across the road here in yellow rubber, taped down and lifting at the corners, feeding a site nobody is working on today. The tape has been retaped twice.',
  898: 'Sorrel Way meets Kettle Lane at a corner cut wide enough for an articulated lorry, which is the only part of the estate that has ever been tested and found adequate.',
};
for (const [x, d] of Object.entries(SORREL)) road(Number(x), 914, 'Sorrel Way', d);
rename(893, 914, 'Sorrel Way + Vetch Mews',
  'Where the mews crosses the new street. Four ways out of one square of stone, and on a quarter this empty that is enough to make it a place people say they will meet.');
rename(899, 914, 'Kettle Lane + Sorrel Way',
  'The chain-link that used to fence off the plot on the west side has been rolled up and stood against a post, and the new street runs in through the gap it left. East of the lane the grass still comes right up to the kerb.');

// ── 3. Vetch Green — the three tiles no street can reach ────────────────────
console.log('\n[3] Vetch Green (895-897, 912)');
const GREEN = {
  895: ['Vetch Green', 'benches',
    'A square of mown grass behind the boulevard frontage, with four benches set facing inward at the corners and a bin that is emptied. The backs of five expensive buildings look down into it. It is completely private and completely overlooked, which is a combination the plan does not seem to have noticed.'],
  896: ['Vetch Green', 'flowerbeds',
    'Planting in raised chrome beds, laid out in a pattern you can only read from about the eighth floor. From the ground it is a lot of low shrubs with gravel between them and a hose reel chained to a post.'],
  897: ['Vetch Green', 'grove',
    'A stand of six birches, semi-mature when they were craned in and doing better than the ones along Sorrel Way. Somebody has been eating their lunch under them: the grass is worn in one spot the size of a person.'],
};
for (const [x, [name, feature, description]] of Object.entries(GREEN)) {
  const z = readZone(Number(x), 912);
  z.name = name;
  z.description = description;
  z.ambient_theme = 'city';
  z.color = '#8fd08a';
  z.flags = { ...z.flags, district: HF, terrain: 'park', park_feature: feature, street_life: true };
  delete z.flags.scavenging_table_id;
  write(zonePath(Number(x), 912), z);
}

// ── 4. Cowslip Rise — north off Kerbstone Row, east of Cinder Lane ──────────
// The east block's only way in. It dead-ends at the back of The Dead Pigeon, which is a
// commercial-district bar that was there first and has its own opinion about the estate.
console.log('\n[4] Cowslip Rise (x905, y911-915)');
const COWSLIP = {
  915: 'A new road off the row, rising perhaps a foot over its whole length, which is enough for the developer to have called it a Rise. The nameplate is chrome and the letters are cut rather than printed.',
  914: 'Service bays on the east side, marked out in white on stone that has never carried a vehicle. A gull stands in one of them most mornings.',
  913: 'Halfway up, where the surfacing changes from the estate stone to something cheaper that was laid first and kept. The join runs straight across the road and you feel it through the wheel.',
  912: 'Hoarding along the west side, printed with the estate as it will be, at dusk, from an angle no one can stand at. The buildings on it are taller than the ones behind it and there are people on the pavements.',
  911: "The top of the Rise, against the back of The Dead Pigeon: a windowless flank in soot-black brick with a cellar hatch and a stack of empty kegs. The estate's plan does not show this building at all.",
};
for (const [y, d] of Object.entries(COWSLIP)) road(905, Number(y), 'Cowslip Rise', d);

// ── 5. Windrow Lane — the perimeter road inside the Curtain ─────────────────
// ⚠ It serves BACKS, on purpose. Kerbstone Row's south frontage faces north, so this is the
// lane behind it: bin stores, plant, substation feeds, and the wall humming at the end of
// every side turning. It is also the only way to drive the south edge of the city.
console.log('\n[5] Windrow Lane (y918)');
const WINDROW = {
  892: 'The west end, stopped a car length short of the Curtain by a line of concrete blocks. The light off the wall lies along the road here even at noon and makes the stone look wet.',
  893: 'Cut grass has been blown into a long ridge against the south kerb and left to go grey. It is the windrow the lane is named after, and it was an accident.',
  894: 'A bin store gate stands open onto the lane, chocked with a brick, chrome-fronted and full. Whatever the estate pays for collections it is not paying for enough of them.',
  895: 'The lane runs dead straight along the back of the row. Every fifty yards there is a numbered gate, and every gate is the back of something with a much better front.',
  896: 'Ducting comes up out of the ground here and goes into a wall, lagged and taped, with a cage round the bottom three feet of it that somebody has already been into.',
  897: 'A puddle that never goes, fed by a downpipe that discharges straight onto the stone instead of into the gully four feet away. The gully is clean and unused.',
  898: 'Gulls on the wall of the plant yard, eleven or twelve of them, facing the same way. Something in one of these bins is worth the wait.',
  900: 'East of Kettle Lane the surfacing changes and the lane narrows by a foot without any sign saying so. Wing mirrors have been taking the corner of the plant yard for a year.',
  901: 'The back of the substation compound: palisade, a warning triangle, and a hum you feel rather than hear, underneath the other hum that comes off the wall.',
  902: 'Cinder Lane comes down to the perimeter here and stops against it in a T with no markings. Two skips stand on the corner and have been there long enough to have grass growing out of them.',
  903: 'The lane passes the cooling plant and the temperature drops a few degrees for the length of it. In cold weather the air over this stretch shimmers.',
  904: 'A stretch with nothing on either side of it: the plant yard fence to the north, the verge and the wall to the south. The most exposed hundred yards in the quarter.',
  905: 'Gas main markers along the north kerb, yellow and new, running toward the holder. Somebody has counted them and written the number on the last one.',
  906: 'Behind the pavilion the planting comes over the fence and hangs into the lane, and for one tile it smells of something green rather than of bins and hot stone.',
  907: 'The switchgear yard backs onto the lane here behind a blank chrome hoarding with one door in it. The door has three locks and no handle.',
  908: 'Under the halt the lane goes into shadow, the platform deck overhead on its legs, and comes out the other side. Rain does not reach this bit and the dust never gets washed off it.',
  909: 'A turning head that was built to a standard and is used by nobody, because the lane carries on. Three bollards, a hatched box, and grass in the joints.',
  910: 'The east end of the lane, hard against Meltwater Row, where the estate stone gives out and the older city takes over at a different level. The ramp between them was an afterthought and rides like one.',
};
for (const [x, d] of Object.entries(WINDROW)) road(Number(x), 918, 'Windrow Lane', d);
rename(899, 918, 'Kettle Lane + Windrow Lane',
  'The lane crosses Kettle Lane at the only junction in the quarter with a working streetlight over it. It comes on at dusk and goes off at two, and nobody has ever found out why two.');

console.log(`\n${DRY ? 'DRY RUN — ' : ''}${wrote} file(s) ${DRY ? 'would change' : 'written'}, ${same} unchanged`);
