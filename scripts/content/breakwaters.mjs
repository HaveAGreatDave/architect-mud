// The Basin breakwaters: two rubble moles across the north of the harbour, so the water between
// Fairweather Marina and the Eastern Marina, and the river mouth west of it, lies calm.
//
//   West Mole   878,901 (beach) north up 878,900..898, the knuckle at 878,897, east along row 897
//               to its head at 895,897 (green light).
//   The mouth   896..899 on row 897 stays open water: the Echelon moors at 897,898.
//   East Mole   head at 900,897 (red light), east along row 897 to its green head at 909,897.
//   Ship gap    910..912 on row 897 stays open water: the freighter berthed at 911,902 steams in and
//               out up column 911. The gap's red head is 913,897; the mole runs on to 925,897.
//
// The tiles were open water. Each keeps its id and its exits (so a swimmer can still climb out or
// go in off the side) and becomes `terrain: concrete`, which is land to GLASS: shelterFill finds it
// upwind and flattens the sea behind it, drawn and ridden. Writes content/zones; run
// `npm run content:import` after. Idempotent.
import { readFileSync, writeFileSync } from 'fs';
import { canonicalJson } from './lib.mjs';

const run = (x, y) => `zone_district_${x}_${y}`;
const tiles = [];
for (const y of [900, 899, 898]) tiles.push({ x: 878, y, bt: 'breakwater', ent: 'south', mole: 'West', part: 'root' });
tiles.push({ x: 878, y: 897, bt: 'breakwater_knuckle', ent: 'south', mole: 'West', part: 'knuckle' });
for (let x = 879; x <= 894; x++) tiles.push({ x, y: 897, bt: 'breakwater', ent: 'east', mole: 'West', part: 'run' });
tiles.push({ x: 895, y: 897, bt: 'breakwater_head_green', ent: 'east', mole: 'West', part: 'head' });
tiles.push({ x: 900, y: 897, bt: 'breakwater_head_red', ent: 'east', mole: 'East', part: 'head' });
for (let x = 901; x <= 908; x++) tiles.push({ x, y: 897, bt: 'breakwater', ent: 'east', mole: 'East', part: 'run' });
tiles.push({ x: 909, y: 897, bt: 'breakwater_head_green', ent: 'east', mole: 'East', part: 'gapWest' });
tiles.push({ x: 913, y: 897, bt: 'breakwater_head_red', ent: 'east', mole: 'East', part: 'gapEast' });
for (let x = 914; x <= 924; x++) tiles.push({ x, y: 897, bt: 'breakwater', ent: 'east', mole: 'East', part: 'run' });
tiles.push({ x: 925, y: 897, bt: 'breakwater', ent: 'east', mole: 'East', part: 'root' });

const PROSE = {
  West: {
    root: ['The West Mole', 'A rubble mole runs out from the beach, rock under a concrete cap wide enough for two to pass. Armour blocks are piled down both sides. The sea is on the left and flat water on the right.'],
    knuckle: ['The West Mole: The Knuckle', 'The mole turns east here. The cap is wider on the corner and the blocks are stacked higher where the weather comes in. Someone has left a bucket wedged between two of them.'],
    run: ['The West Mole', 'The cap runs east along the top of the rubble, with a low wall either side. North of it the sea comes in grey. South of it the water inside lies still enough to see the bottom.'],
    head: ['The West Mole: Head', 'The end of the West Mole. A short white tower carries a green light for boats coming in. The gap to the East Mole is wide enough for the Echelon.'],
  },
  East: {
    root: ['The East Mole', 'The East Mole comes ashore on the end of the runway. The cap is cracked where the rubble has settled. To the south the Eastern Marina sits in quiet water.'],
    run: ['The East Mole', 'A rubble mole with a concrete cap and a low wall either side. Armour blocks lie in a heap down both sides. The open sea breaks on the north face, and the Basin is calm behind it.'],
    head: ['The East Mole: Head', 'The end of the East Mole. A short white tower carries a red light for boats coming in. Across the gap the green one answers it.'],
    gapWest: ['The East Mole: Ship Gap', 'The mole stops at a green light. East of it a gap three tiles wide lets the container ships in to the gantries. A rusty ladder goes down the end into the water.'],
    gapEast: ['The East Mole: Ship Gap', 'The mole starts again at a red light. West of it is the gap the container ships use. The armour on this end is scraped where a hull has come too close.'],
  },
};
const AMBIENT = [
  'A wave hits the armour on the sea side and comes over the wall as spray.',
  'The light on the head comes round to its blink and goes out again.',
  'A gull stands on a block out of the wind and watches the water.',
  'Inside the mole the water barely moves.',
];

let n = 0;
for (const t of tiles) {
  const p = `content/zones/${run(t.x, t.y)}.json`;
  const z = JSON.parse(readFileSync(p, 'utf8'));
  const [name, description] = PROSE[t.mole][t.part];
  z.name = name;
  z.description = description;
  z.ambient_theme = 'coast';
  z.ambient_events = AMBIENT;
  z.color = '#8a8c88';
  z.flags = {
    ...z.flags,
    building_type: t.bt,
    district: 'docks',
    entrance: t.ent,
    fishing_table_id: 'fish_coldwater_bay',
    floors: 1,
    liquid: false,
    region_id: 'region_coldwater',
    routable: true,
    swimmable: false,
    terrain: 'concrete',
  };
  writeFileSync(p, canonicalJson(z));
  n++;
}
console.log(`breakwaters: ${n} tiles written`);
