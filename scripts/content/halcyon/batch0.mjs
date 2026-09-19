/**
 * Halcyon Fields, batch 0 — the armature.
 *
 * Lays the street grid into Coldwater's empty southwest meadow, files the quarter under a
 * district of its own, and closes four perimeter tiles that never mentioned the wall they
 * stand on. No buildings: this ships the ground they will sit on, so the map is verifiable
 * before a single facade exists.
 *
 * ⚠ THERE IS NO ROAD ALONG y=919, AND THAT IS A DECISION RATHER THAN AN OMISSION.
 * `curtainSegs` (windshield.js) builds the Curtain's arms FROM THE TILE CENTRE, spanning the
 * whole tile along its run axis — not along the tile's edge, which is only how the 2-D map
 * strokes it. So a curtain tile on a straight east-west run carries a solid wall (CURTAIN_H
 * 0.9, vehicle collision through `curtainTopZAt`) through its own middle. A road laid along
 * the wall would be a road with the wall down the centre of every tile of it: walkable,
 * undrivable, and obviously wrong to look at. The y=919 row stays verge.
 *
 * The same fact is why Kettle Lane RUNS to y=919 and stops there. That tile's wall crosses it
 * east-west, so the lane dead-ends into the Curtain exactly as Meltwater Row already does at
 * 911,919 — the one tile of this pattern the world already shipped.
 *
 * Idempotent: re-running writes the same bytes. `--dry-run` reports and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib.mjs';

const DRY = process.argv.includes('--dry-run');
const ZONES = 'content/zones';
const DISTRICTS = 'content/districts';
const zonePath = (x, y) => path.join(ZONES, `zone_district_${x}_${y}.json`);

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

const rename = (x, y, name) => { const z = readZone(x, y); z.name = name; write(zonePath(x, y), z); };

// ── 1. The district row ──────────────────────────────────────────────────────
// A developer names the estate after the meadow it is built on. The works being INSIDE
// Halcyon Fields is the part the artist's impression leaves out.
console.log('\n[1] district row');
write(path.join(DISTRICTS, 'halcyon_fields.json'), {
  blurb: 'The meadow the Glasshouse is building over, sold by the plot and named after what used to grow here.',
  color: '#9fb36b',
  id: 'halcyon_fields',
  landmark: 'zone_district_899_916',
  name: 'Halcyon Fields',
  prefixes: [],
  signature: [
    'Cut grass and hot tar, which is a smell this quarter did not have last year.',
    'Somewhere behind the hoardings a generator runs, and nothing it powers is finished.',
    'The wind comes off the open ground and arrives all at once, carrying seed heads and grit together.',
    'The Curtain hums at the edge of hearing, the way a fridge does in another room.',
  ],
  skyline: 'half-built frontage along the north side, open grass to the south, and the Curtain closing both far edges',
  sort: 15,
});

// ── 2. The streets ───────────────────────────────────────────────────────────
// Roads auto-tile at derive time off `terrain: 'road'` neighbours, so no connector icon is
// authored here. A junction takes both street names, alphabetically, which is the convention
// the existing junctions already follow.
const CURTAIN_LINE = "The Architect's Curtain seals the edge here: a floor-to-sky sheet of humming hard light. There's no way through but the South Gate.";
const HF = 'halcyon_fields';

const road = (x, y, name, description, district) => {
  const z = readZone(x, y);
  z.name = name;
  // A curtain tile keeps saying so. Kettle Lane's south end is one.
  z.description = (z.flags?.curtain && !/Curtain/.test(description))
    ? `${description} ${CURTAIN_LINE}`
    : description;
  z.ambient_theme = 'city';
  delete z.color;           // road tiles carry no colour override; the grass ones do
  z.flags = {
    ...z.flags,
    district,
    terrain: 'road',
    street_life: true,
    scavenging_table_id: 'scav_roadside_junk',
  };
  write(zonePath(x, y), z);
};

console.log('\n[2a] Halcyon Boulevard, extended west');
road(892, 910, 'Halcyon Boulevard',
  "The boulevard's western end, where the made surface gives out and the grass takes it back inside a stride. The Curtain stands a little way off. The road has no reason to go further and does not.",
  'glasshouse');
road(893, 910, 'Halcyon Boulevard',
  'Under the helipad flank the road is swept oddly clean, rotor wash having pushed the grit into long banks at either edge. The middle stays bare stone.',
  'glasshouse');
// 899,910 becomes a crossroads the moment Kettle Lane carries on south.
rename(899, 910, 'Halcyon Boulevard + Kettle Lane');

console.log('\n[2b] Kettle Lane, extended south');
const KETTLE = {
  911: 'Kettle Lane runs out of terrace at the boulevard and takes its name south anyway, out into open ground with nothing built on either side of it yet.',
  912: 'Crushed rubble rolled flat, newer and meaner than the lane it continues. A line of stub posts marks where a fence was started and thought better of.',
  913: "Hoarding runs the whole of this stretch, board after board of the same artist's impression. The buildings printed on it are not the buildings here.",
  914: 'Chain-link sags between its posts along the west side, fencing off a plot with nothing on it. East of the road the grass comes right up to the kerb.',
  915: 'The lane narrows where the ground was never cut properly back. Grass overhangs the stone on both sides and hides it, so the road reads a foot thinner than it is.',
  917: 'Drainage was an afterthought here and looks it. Water stands along the western kerb in a long shallow strip that never entirely dries.',
  918: 'The last made stretch. Gravel thins toward the end of it, and the wind off the open ground comes straight up the lane with nothing to break it.',
  919: 'The lane stops. Not at a junction, not at a gate, simply at the point where the ground ahead stops being somewhere you can go.',
};
for (const [y, d] of Object.entries(KETTLE)) road(899, Number(y), 'Kettle Lane', d, HF);

console.log('\n[2c] Kerbstone Row (new, east-west)');
const KERB = {
  892: 'The western end of the cut, where the new stone stops and the meadow resumes as though nothing had been done to it.',
  893: 'Someone scraped the grass back to the old camber here and found a road under it, cracked but true. The kerbs stand proud again on both sides, chipped where the digger caught them.',
  894: "Surveyor's pins stand along the verge in a line, each with a strip of orange tape gone pale, and the grass leans away from the new stone.",
  895: 'Old kerbstones, re-laid by somebody who cared more about speed than line. The road they edge is half fresh gravel and half whatever was already down there, and the join shows.',
  896: 'Grass still comes up through the middle in a thin green seam, stubborn, where nobody has driven enough to kill it off yet.',
  897: 'A drain lid sits in the road here, older than the surface around it, lifted and re-bedded at the wrong height. Water stands against its upstream side and goes nowhere.',
  898: 'The cut runs straight where the meadow ran shapeless. The wind moves along it now instead of across it.',
  900: 'Fresh grit lies in the ruts, not yet flattened. Two sets of tyre tracks run the length of it and nothing else has been along since.',
  901: 'A stack of kerbstones waits at the verge, banded and labelled, for a stretch of road nobody has dug yet.',
  903: "The surface changes here without ceremony: new stone gives out, old stone carries on, a shade darker and a hand's width lower.",
  904: 'Cable ducting runs open along the north verge, orange pipe in a trench somebody stopped backfilling halfway along.',
  905: 'A standpipe stands at the kerb with a padlocked cap, the only thing on this stretch that was actually finished.',
  906: 'The meadow on both sides has been mown once and left. The cuttings lie in grey windrows that have not rotted down.',
  907: 'Old sleepers are laid in along one edge where the ground goes soft, sunk unevenly, so the kerb runs in a slow wave.',
  908: 'The road firms up toward the east end, more used, gritted deeper. Somebody comes this way often enough to keep it open.',
  909: 'Ash blows in off the flats and collects along the northern kerb in a grey line that redraws itself every night.',
  910: 'The last of the row before it meets Meltwater Row, cut square to it, the join patched with a different stone entirely.',
};
for (const [x, d] of Object.entries(KERB)) road(Number(x), 916, 'Kerbstone Row', d, HF);
road(899, 916, 'Kerbstone Row + Kettle Lane',
  'The middle of the quarter, such as it is: two new roads meeting at a corner nobody has built on. The stop line is painted. The give-way sign is still in its wrapping, leaning against its post.',
  HF);
road(902, 916, 'Cinder Lane + Kerbstone Row',
  'Cinder Lane comes down off the boulevard and ends against the row here. The junction was laid all at once and is the smoothest surface for a quarter of a mile in any direction.',
  HF);
// Meltwater Row's tile takes the name of the road now arriving at it.
rename(911, 916, 'Kerbstone Row + Meltwater Row');

console.log('\n[2d] Cinder Lane, extended south');
const CINDER = {
  911: 'Cinder Lane south of the boulevard, newly surfaced and already patched. The white line somebody painted onto the grass to show where it would run is still there, off to one side by a good yard.',
  912: 'Cinders, properly, which is where the lane got the name: rolled hard and black, still smelling faintly of the works they came out of.',
  913: 'A run of new kerb along the east side stops mid-stone, sawn off clean. The rest of it never came.',
  914: 'The lane dips through a hollow the grading never took out. In wet weather the low point holds a pool the full width of the road.',
  915: 'Almost at the row. The last stretch is the worst of it, laid in a hurry and settling unevenly already.',
};
for (const [y, d] of Object.entries(CINDER)) road(902, Number(y), 'Cinder Lane', d, HF);

// ── 3. The district retag ────────────────────────────────────────────────────
// The meadow was filed `wasteland`, which is what the whole southwest reads as on the tablet
// today. Only tiles currently filed that way are touched, so the commercial and nightlife
// backs along the east edge keep their own district.
console.log('\n[3] district retag (wasteland -> halcyon_fields)');
let retagged = 0;
for (let x = 891; x <= 910; x++) for (let y = 911; y <= 919; y++) {
  const f = zonePath(x, y);
  if (!fs.existsSync(f)) continue;
  const z = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (z.flags?.district !== 'wasteland') continue;
  z.flags.district = HF;
  write(f, z);
  retagged++;
}
console.log(`  ${retagged} tile(s) retagged`);

// ── 4. Four perimeter tiles that never mentioned the wall ────────────────────
// 60 of the 64 curtain/gate tiles end on the Curtain line. These four do not: the three gun
// nests are written entirely about the gun, and Meltwater Row's terminus is the tile a truck
// actually drives into the wall at.
console.log('\n[4] Curtain prose');
for (const [x, y] of [[891, 903], [891, 905], [891, 907], [911, 919]]) {
  const z = readZone(x, y);
  if (/Curtain/.test(z.description)) { same++; continue; }
  z.description = `${z.description} ${CURTAIN_LINE}`;
  write(zonePath(x, y), z);
}

console.log(`\n${DRY ? 'DRY RUN — ' : ''}${wrote} file(s) ${DRY ? 'would change' : 'written'}, ${same} unchanged`);
