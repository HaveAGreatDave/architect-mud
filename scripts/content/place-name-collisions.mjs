/**
 * Fourteen names held by places that have nothing to do with each other. 2026-08-26.
 *
 * `node scripts/docs/place-names.mjs` reports two different problems under one
 * heading, and only one of them is a problem.
 *
 * ── Not a collision: a facade and its interior ───────────────────────────────
 *
 * The Chorus' Den and The Fleshery each showed as a three-way. Two of the three
 * are `zone_scw_*` (the tile you stand on outside) and `zone_thorn_*` (the room
 * you walk into), which is one place with one name. The checker filters that
 * pair when exactly one grid tile claims the name as a BUILDING, and the
 * Thornwarren is deliberately `building_type` and nothing else — see
 * docs/proposals/scarletwastes.md, where putting 62 tiles into the map-code
 * namespace is the exhaustion Terminus hit at thirteen. So the filter cannot
 * see it, and it never will. Left alone.
 *
 * The third member of each was real: two Coldwater district tiles carrying the
 * superseded Wildlands camp draft, ALL-CAPS headers and all, describing a
 * Chorus and a Gristle who now live out in the Thornwarren instead. Rather than
 * renaming them to nothing, they become what they are: the camp the Wildblood
 * left when they moved south, with the chimes and the slab still there.
 *
 * ── The rest: a name kept by whichever place it fits better ──────────────────
 *
 * Every settlement builds a mess hall and a workshop, so four Long Tables and
 * three Benches is realistic and also unnavigable — the map and the GPS both
 * print a name and expect it to mean one place. Each rename below is taken out
 * of the losing tile's own description rather than invented, so nothing has to
 * be re-established: eleven different tables really is what that room is made
 * of, and the tools at Terminus really are each on their own painted outline.
 *
 * ⚠ Renames run over a NAME + ID-PREFIX pair, not one id, because a landform
 * name covers a block of tiles — The Bare Mile alone is 327 of them.
 *
 * Run: node scripts/content/place-name-collisions.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'zones');
const WRITE = process.argv.includes('--write');

// [ prefix, old name, new name, why ]
const RENAMES = [
  ['zone_dw_',       'The Bench',       'The Dry Bench',   'Deadwater: the one thing a bench there needs to be'],
  ['zone_terminus_', 'The Bench',       'The Outlines',    'every tool on its own painted outline'],
  ['zone_dw_',       'The Long Table',  'The Trestles',    'trestles and boards under roofing sheet'],
  ['zone_scw_',      'The Long Table',  'The Eleven Tables', 'made from eleven different tables'],
  ['zone_terminus_', 'The Long Table',  'The Open Shed',   'the whole south side folded open on props'],
  ['zone_scw_',      'Cinder Lane',     'Kiln Lane',       'Coldwater keeps Cinder Lane; there are no cinders in redrock'],
  ['zone_dw_',       'Low Row',         'Tin Row',         'the row of tins with something green coming up in each'],
  ['zone_scw_',      'The Bare Mile',   'The Red Mile',    'red rock to the horizon, not grey ash'],
  ['zone_dw_',       'The Line',        'The Line Shaft',  'the overhead shaft every workshop takes its power off'],
  ['zone_asc_',      'The Nave',        'The Cold Aisle',  'St Garneau keeps the nave; a datacentre term that still sounds like one'],
  ['zone_terminus_', 'The Notch',       'The Ledges',      'ledges the width of a boot'],
  ['zone_dw_',       'The Rows',        'The Painted Doors', 'every door a different colour and every one painted recently'],
  ['zone_dw_',       'The Stacks',      'The Drum Store',  'drums of oil in a cradle; the library keeps the stacks'],
  ['zone_scw_',      'The Steps',       'The Narrow',      'barely two abreast, and not a step in it'],
  ['zone_scw_',      'The Way Up',      'The Slide',       'a whole section come down at once and never cleared'],
];

// The superseded camp draft. New text, because the old text describes people
// who live somewhere else now.
const REWRITES = [
  ['zone_district_919_926.json', 'The Bone Chimes',
    'Hides that were hung here have gone to strips and come down. The chimes have not: finger-bone on '
    + 'gut cord, a dozen of them, still turning in the draught off the trail. Somebody cut them down to '
    + 'shoulder height before they left, so they would not tangle. A narrow trail slips south.'],
  ['zone_district_920_925.json', 'The Scrubbed Slab',
    'The tent is gone and the frame it stood on is still pegged out. In the middle of it is a stone slab, '
    + 'scrubbed, with a drain cut into one end and a shallow gutter worked around three sides. It has been '
    + 'rained on for a long time and it is still the cleanest thing for a mile.'],
];

const files = fs.readdirSync(ROOT);
let n = 0;
for (const [prefix, from, to, why] of RENAMES) {
  let hits = 0;
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const p = path.join(ROOT, f);
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d.name !== from) continue;
    d.name = to;
    if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
    hits++;
  }
  console.log('  ' + String(hits).padStart(4) + '  ' + (from + ' -> ' + to).padEnd(38) + why);
  n += hits;
}
for (const [f, name, desc] of REWRITES) {
  const p = path.join(ROOT, f);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const was = d.name;
  d.name = name; d.description = desc;
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  console.log('     1  ' + (was + ' -> ' + name).padEnd(38) + 'the camp the Wildblood left');
  n++;
}
console.log('\n  ' + n + ' tiles\n' + (WRITE ? 'WROTE' : 'dry run'));
