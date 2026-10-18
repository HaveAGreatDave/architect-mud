/**
 * Halcyon Fields, batch 10: addresses, not puns.
 *
 * Every building in the quarter was named with a property pun (Plot Twist, Going Concern, Glass
 * Ceiling), and every sign in GLASS letters the building's name. That reads as a high street of
 * independent shops, which is the one thing this quarter is not: it is one developer's estate,
 * built in one campaign and let through one office. So the signs say what an estate's signs say.
 *
 *   - A building the estate built and lets is named by its ADDRESS: "8 Halcyon Boulevard".
 *   - A building the estate runs for itself is a HALCYON property with a plain name: the Land
 *     Office, the Sales Suite, the Estate Office, the Site Office, the Records Office, the
 *     Institute, the halts and the plant.
 *   - The three things that were here before the estate (the recital hall, the pumping station and
 *     the gasholder) keep a plain name of their own, as does the winter garden, which is older than
 *     the road outside it.
 *
 * HOUSE NUMBERS. Odd on one side and even on the other, counted along the street from the end it
 * starts at: Kerbstone Row, Windrow Lane, Sorrel Way and the boulevard run west to east, Kettle
 * Lane, Cinder Lane and Cowslip Rise run south off the boulevard, and Vetch Mews runs north off
 * Kerbstone Row. The number comes from the tile, so a plot the estate named plainly still uses
 * its number and the numbers either side of it skip it, which is how a real street reads.
 *
 * WHAT THIS CHANGES: every string in content/ that names one of the 68 buildings (facade tiles,
 * room titles, maps, generators, power_zones, vendor shop names, dialogue), the prose that only
 * made sense as an explanation of a pun, and the 68 map codes, which were the puns' initials.
 * IDs are untouched (zone_hf_glassceiling_lobby stays), so no connection, spawn or residence moves.
 *
 * ⚠ RUN IT AFTER batch0-batch9. Those still author the old names, so re-running any of them puts a
 * pun back; running this one afterwards takes it out again. It is idempotent: every rewrite checks
 * that either its old text or its new text is present, and throws if neither is, so a prose edit
 * made since cannot be skipped silently.
 *
 * ⚠ THE GLASS SIDE IS NOT IN HERE. Models bound by name (`NAMED_MODELS` in
 * client/game/js/panels/glass/model-registry.js) are keyed by the slug of the name, so each of the
 * forty-two keys moved with its building, and building-shapes.js and flightsim-world.json carry the
 * names they were baked from.
 *
 *   node scripts/content/halcyon/batch10.mjs [--dry-run]
 */
import { loadContentStore } from './lib.mjs';
import { REGISTRY } from '../../../server/models/content-registry.js';
import { nameDerivedMarkers, twoLetterAbbrev, uniqueMarkerFor } from '../derive.mjs';

const DRY = process.argv.includes('--dry-run');

// Old name to new name, all 68. Grouped by street, in house-number order.
export const RENAME = {
  // Halcyon Boulevard, the y910 stretch. North side odd, south side even, numbered from x892.
  'Top Brass': '1 Halcyon Boulevard',
  'Rising Sums': '7 Halcyon Boulevard',
  'Bent Double': '9 Halcyon Boulevard',
  'Curve Appeal': '11 Halcyon Boulevard',
  'Common Ground': '2 Halcyon Boulevard',
  'Sound Investment': 'Coldwater Recital Hall',
  'Vested Interest': '6 Halcyon Boulevard',
  'Going Concern': '8 Halcyon Boulevard',
  'Course Correction': 'The Halcyon Institute',
  'Plot Twist': 'Halcyon Land Office',
  // Kerbstone Row. North side (y915) odd, south side (y917) even, numbered from x892.
  'Light Relief': '1 Kerbstone Row',
  'Leaf It Out': 'Halcyon Pavilion',
  'Glass Half Full': 'The Winter Garden',
  'Ivory Tower': '15 Kerbstone Row',
  'Top of the Market': '17 Kerbstone Row',
  'Sweeping Statement': '25 Kerbstone Row',
  'Air Rights': 'Halcyon Arch',
  'New to Market': '31 Kerbstone Row',
  'Priced to Sell': '33 Kerbstone Row',
  'Crossed Wires': 'Kerbstone Row Exchange',
  'Party Wall': '2 Kerbstone Row',
  'Standing Room Only': 'Halcyon West Halt',
  'Right of Way': '6 Kerbstone Row',
  'Scope for Improvement': '8 Kerbstone Row',
  'Well Appointed': '10 Kerbstone Row',
  'Change of Use': '12 Kerbstone Row',
  'Rent Review': '14 Kerbstone Row',
  'Sunk Costs': '18 Kerbstone Row',
  'Blue Chip': '20 Kerbstone Row',
  'Stamp Duty': 'Halcyon Records Office',
  'Cold Comfort': 'Halcyon Cooling Plant',
  'Snagging List': 'Halcyon Site Office',
  'Holding Pattern': 'Kerbstone Row Gasholder',
  'Frond Memories': 'The Palm House',
  'Current Affairs': 'Halcyon Substation',
  'Line of Enquiry': 'Halcyon East Halt',
  'Best Offer': '36 Kerbstone Row',
  // Kettle Lane. West side (x898) odd, east side (x900) even, numbered south from the boulevard.
  'Salad Days': '1 Kettle Lane',
  'Second Wind': '5 Kettle Lane',
  'Above Board': '2 Kettle Lane',
  'Under Offer': '4 Kettle Lane',
  'Mains Attraction': 'Kettle Lane Pumping Station',
  'Chain Free': '8 Kettle Lane',
  'Sitting Tenant': '10 Kettle Lane',
  // Cinder Lane. West side (x901) odd, east side (x903) even.
  'Safe as Houses': '1 Cinder Lane',
  'Fixed Rate': '3 Cinder Lane',
  'Break Clause': '5 Cinder Lane',
  'Root Cause': '7 Cinder Lane',
  'Ground Rent': 'Halcyon Estate Office',
  'Overlooked': '2 Cinder Lane',
  'Prime Location': '4 Cinder Lane',
  'Vacant Possession': '6 Cinder Lane',
  'Mod Cons': '8 Cinder Lane',
  'Aspect Ratio': '10 Cinder Lane',
  // Cowslip Rise. West side (x904) odd, east side (x906) even. Number 1 is the quarter's tallest
  // building, and it carries the developer's name instead.
  'Glass Ceiling': 'Halcyon Point',
  'Subject to Contract': '3 Cowslip Rise',
  'Peppercorn': '5 Cowslip Rise',
  'Completion Date': '7 Cowslip Rise',
  'Dual Aspect': '8 Cowslip Rise',
  // Sorrel Way. North side (y913) odd, south side (y915) even, numbered from the mews.
  'Long Lease': '1 Sorrel Way',
  'Fixed Assets': '3 Sorrel Way',
  'Grounds for Concern': '5 Sorrel Way',
  'Fit for Purpose': '7 Sorrel Way',
  'Deposit Taken': '4 Sorrel Way',
  // Vetch Mews, numbered north from Kerbstone Row. West side (x892) odd, east side (x894) even.
  'Quiet Enjoyment': '5 Vetch Mews',
  'Rising Damp': '7 Vetch Mews',
  "Artist's Impression": 'Halcyon Sales Suite',
  'Terms Agreed': '8 Vetch Mews',
};

// Prose that only made sense as an explanation of a pun, or that a plain substitution would leave
// reading badly ("Chain Free, on the corner of Kettle Lane" becomes a street named twice). Applied
// BEFORE the name substitution, so `from` quotes the text as it stood under the old names.
const PROSE = [
  // The facades.
  ['Somebody has added the name in marker across the bottom of the hoarding and it has been scrubbed at rather than removed.',
   'Somebody has written a word in marker across the bottom of the hoarding and it has been scrubbed at rather than removed.'],
  ['Cut into the lintel in letters a foot high: SOUND INVESTMENT.',
   'Cut into the lintel in letters a foot high: COLDWATER RECITAL HALL.'],
  ['The whole ground floor is a physiotherapy practice, which is a joke the practice made first and put on the door.',
   'The whole ground floor is a physiotherapy practice, with a skeleton in the window wearing a back brace.'],
  ['The name is in chrome script across the drum, and beneath it, on a chalkboard propped against the glass, somebody rewrites a joke every morning that is never quite as good as the name.',
   'The number is in chrome script across the drum, and beneath it, on a chalkboard propped against the glass, somebody writes up the soup every morning and spells it differently each time.'],
  ['and every single person in it has an opinion about the name.',
   'and every single person in it has an opinion about the signage.'],
  ['The name is cut into the canopy fascia, small, in letters about four inches high.',
   'The number is cut into the canopy fascia, small, in figures about four inches high.'],
  ['It was named before the streets round it were laid, which means it has spent four years being the prime location in a field.',
   'It was sold off the plan before the streets round it were laid, which means it has spent four years as the best address in a field.'],
  ['with the name cut into the stone above it in letters a foot high',
   'with the number cut into the stone above it in figures a foot high'],
  ['and that is where the name comes from and it is not a boast.',
   'which the brochure calls dual aspect and which is, for once, not a boast.'],
  ['There is no sign. Everyone calls it the Arch.',
   'There is no sign. The estate calls it the Halcyon Arch and everyone else calls it the Arch.'],
  ['It has been new to market for two years.',
   'It has been on the market for two years.'],
  // The rooms behind them.
  ['The only decoration is the name again, in the same letters as outside,',
   'The only decoration is the number again, in the same figures as outside,'],
  ['Behind the lobby wall the name is cut into,',
   'Behind the lobby wall the number is cut into,'],
  ['a single framed card with the name on it and no menu,',
   'a single framed card with the address on it and no menu,'],
  // Things and people.
  ['a Common Ground brochure', 'a Halcyon Boulevard brochure'],
  ['with SECOND WIND stitched into one corner', 'with HALCYON stitched into one corner'],
  ['Do they mind the building being called that?', 'Do they mind the signage?'],
  ['There were three pinned notes downstairs within a week of the signage going up.',
   "The estate put a plate by the door that says RESIDENCE'S FOR FELLOWS, and there were three pinned notes downstairs within a week of it going up."],
  ['"The estate named it. The estate names everything in this quarter with a joke in it, and they have been doing it since the first hoarding went up, and the fellows have decided the correct response is dignity." She stamps something. "Which is of course exactly the response that makes the name funny. I have pointed this out. It did not help."',
   '"The estate letters everything in this quarter off one template and nobody proofreads the template, and the fellows have decided the correct response is dignity." She stamps something. "Which is why the correction is typed, signed by four of them and pinned at eye level. I have pointed out that this is not dignity. It did not help."'],
  ['"It is called Quiet Enjoyment because that is a thing written into the lease. It means nobody may interfere with your use of the flat."',
   '"Quiet enjoyment is a thing written into the lease. It means nobody may interfere with your use of the flat."'],
  ['I sell it as water. The building is called what it is called and I did not name it.',
   'I sell it as water. The estate printed RESTORATIVE on the card and I did not write the card.'],
  ['"Change of Use, on the row, is going through all this with the land office.',
   '"Twelve Kerbstone Row is going through a change of use with the land office.'],
  ['Chain Free, on the corner of Kettle Lane and Sorrel Way,',
   'Number 8 Kettle Lane, on the corner of Sorrel Way,'],
  ['Vacant Possession has a file in nine different years.',
   'Number 6 Cinder Lane has a file in nine different years.'],
];

// Names that are also ordinary words or phrases. Matched as whole words and case-sensitively, so
// "a peppercorn" in Vallance's lease talk and "overlooked" as a verb are left alone.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OLD = Object.keys(RENAME).sort((a, b) => b.length - a.length);
const SUBS = [];
for (const o of OLD) {
  SUBS.push([new RegExp(`(?<![A-Za-z0-9])${esc(o)}(?![A-Za-z0-9])`, 'g'), RENAME[o]]);
  SUBS.push([new RegExp(`(?<![A-Za-z0-9])${esc(o.toUpperCase())}(?![A-Za-z0-9])`, 'g'), RENAME[o].toUpperCase()]);
}

const store = loadContentStore();
const tables = REGISTRY.filter((e) => e.class === 'content').map((e) => e.table);

// Every string in a row, mapped. Returns the same object when nothing changed.
function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) { let ch = false; const out = v.map((x) => { const y = mapStrings(x, fn); if (y !== x) ch = true; return y; }); return ch ? out : v; }
  if (v && typeof v === 'object') {
    let ch = false; const out = {};
    for (const k of Object.keys(v)) { const y = mapStrings(v[k], fn); if (y !== v[k]) ch = true; out[k] = y; }
    return ch ? out : v;
  }
  return v;
}

// ⚠ THE NAME SUBSTITUTION IS SCOPED TO THE QUARTER, because the puns are not unique to it: the
// Filaments has a café called Grounds for Concern too (906,908), with its own room, generator and
// vendor, and it keeps its name. In scope: every tile in the district (the streets name the
// buildings too), every room on their interior maps and
// under them, and the generators, power_zones, furniture and NPCs that belong to those rooms.
// Anything outside that still mentions a name is listed at the end and left alone.
let facades = store.all('zones').filter((z) => z.map_id === 'map_world' && z.flags?.is_building && z.flags?.district === 'halcyon_fields');
const scope = new Set(store.all('zones').filter((z) => z.map_id === 'map_world' && z.flags?.district === 'halcyon_fields').map((z) => z.id));
const mapIds = new Set(store.all('maps').filter((m) => scope.has(m.parent_zone_id)).map((m) => m.id));
for (let grew = true; grew;) {
  grew = false;
  for (const z of store.all('zones')) {
    if (scope.has(z.id)) continue;
    if (mapIds.has(z.map_id) || scope.has(z.parent_zone) || scope.has(z.id.replace(/^zone_util_/, ''))) { scope.add(z.id); grew = true; }
  }
}
const inScope = (table, row) => {
  switch (table) {
    case 'zones': case 'power_zones': return scope.has(row.id);
    case 'maps': return mapIds.has(row.id);
    case 'generators': case 'furniture': return scope.has(row.zone_id);
    case 'npcs': return scope.has(row.home_zone) || scope.has(row.work_zone_id);
    default: return false;
  }
};

const proseHit = new Map(PROSE.map(([from]) => [from, 0]));
const proseDone = new Map(PROSE.map(([from]) => [from, 0]));
let touched = 0;
const subsCount = new Map();
const outside = [];
for (const table of tables) {
  for (const row of store.all(table)) {
    const ours = inScope(table, row);
    let missed = false;
    const next = mapStrings(row, (s) => {
      let t = s;
      for (const [from, to] of PROSE) {
        if (t.includes(from)) { t = t.split(from).join(to); proseHit.set(from, proseHit.get(from) + 1); }
        else if (t.includes(to)) proseDone.set(from, proseDone.get(from) + 1);
      }
      for (const [re, to] of SUBS) {
        if (!ours) { if (re.test(t)) missed = true; re.lastIndex = 0; continue; }
        t = t.replace(re, () => { subsCount.set(table, (subsCount.get(table) || 0) + 1); return to; });
      }
      return t;
    });
    if (missed) outside.push(`${table}/${row.id ?? JSON.stringify(row).slice(0, 40)}`);
    if (next !== row) { store.put(table, next); touched++; }
  }
}
const lost = PROSE.filter(([from]) => !proseHit.get(from) && !proseDone.get(from)).map(([from]) => from);
if (lost.length) throw new Error(`batch10: ${lost.length} prose rewrite(s) found neither their old nor their new text:\n  ${lost.join('\n  ')}`);

// Every new name lands on exactly one facade, and no other building in the world already uses it.
facades = store.all('zones').filter((z) => scope.has(z.id) && z.map_id === 'map_world' && z.flags?.is_building);
const newNames = new Set(Object.values(RENAME));
if (newNames.size !== 68 || facades.length !== 68) throw new Error(`batch10: expected 68 names on 68 facades, have ${newNames.size} and ${facades.length}`);
for (const z of facades) {
  if (!newNames.has(z.flags.building_name) || z.name !== z.flags.building_name) throw new Error(`batch10: ${z.id} is named "${z.name}" / "${z.flags.building_name}", which is not in RENAME`);
}
const elsewhere = store.all('zones').filter((z) => !facades.includes(z) && z.flags?.is_building && z.map_id === 'map_world' && newNames.has(z.flags?.building_name || z.name));
if (elsewhere.length) throw new Error(`batch10: ${elsewhere.map((z) => z.id).join(', ')} already carry one of the new names`);

// Map codes. The old ones were the puns' initials. An address gets the street's initial and the
// house number when that fits two glyphs, and the bare number when the number is two digits;
// a Halcyon property is coded from the words after Halcyon, since every one of them starts with
// an H; anything that collides takes derive's own ladder. Assigned from scratch
// in id order against every other building's code, so a re-run gives the same answer.
const ours = new Set(facades.map((z) => z.id));
const taken = new Set(store.all('zones')
  .filter((z) => !ours.has(z.id) && z.map_id === 'map_world' && (z.flags?.facade || z.flags?.is_building) && z.marker)
  .map((z) => String(z.marker).trim()));
for (const z of [...facades].sort((a, b) => (a.id < b.id ? -1 : 1))) {
  const name = z.flags.building_name;
  const m = /^(\d+) (\S+)(?: (\S+))?/.exec(name);
  const cands = [];
  if (m) {
    const n = m[1];
    if (n.length === 2) cands.push(n);
    else for (const w of [m[2], m[3]]) if (w) cands.push(w[0].toUpperCase() + n);
  }
  const own = /^(?:The )?Halcyon (.+)$/.exec(name);
  if (own) cands.push(twoLetterAbbrev(own[1]), ...[...nameDerivedMarkers(own[1])].sort());
  const code = cands.find((c) => !taken.has(c)) || uniqueMarkerFor(name, taken);
  if (!code) throw new Error(`batch10: no free map code for ${name}`);
  taken.add(code);
  if (z.marker !== code) store.put('zones', { ...store.get('zones', z.id), marker: code });
}

const written = store.flush({ dryRun: DRY });
console.log(`batch10${DRY ? ' (dry run)' : ''}: ${touched} rows rewritten, ${written.length} files ${DRY ? 'would change' : 'written'}`);
for (const [t, n] of subsCount) console.log(`  ${t}: ${n} name substitutions`);
if (DRY && process.env.LIST) for (const p of written) console.log('   ' + p);
console.log(`  prose: ${[...proseHit.values()].filter(Boolean).length} rewritten, ${[...proseDone.values()].filter(Boolean).length} already done`);
if (outside.length) console.log(`  left alone, outside the quarter but sharing an old name: ${outside.join(', ')}`);
