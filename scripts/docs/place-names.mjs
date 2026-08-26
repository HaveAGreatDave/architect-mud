/**
 * place-names.mjs — can a reader resolve the places our prose names?
 *
 *   node scripts/docs/place-names.mjs              the report
 *   node scripts/docs/place-names.mjs --refs       also list every prose use
 *
 * Written 2026-08-25 after "the wash" turned out to mean four different things:
 * the Long Watch's approach channel, a laundrette on Ironside Street, an Exodus
 * wash house, and Ferric Wash, a redrock district in the Scarletwastes. Prose
 * had been using it as shorthand for eleven instances without anything, anywhere,
 * telling the player which one was meant or what it was.
 *
 * A REPORTER, not a gate. Two of the three checks below have legitimate hits and
 * a shared name is sometimes deliberate.
 *
 * WHAT IT CHECKS
 *
 *   1. COLLIDING NAMES. One name held by zones from unrelated families — an
 *      interior room and a wilderness district, two different factions' rooms.
 *      Many tiles of one street sharing a name is normal and is not reported;
 *      `zone_district_921_915` and `zone_district_922_909` both being Kessler
 *      Street is how streets work.
 *
 *   2. UNRESOLVABLE SHORTHAND. Prose saying "the <word>" where <word> reads like
 *      a place and no zone name contains it. This is the check that would have
 *      caught an invented place before it shipped.
 *
 *   3. NEVER ESTABLISHED. A place named in prose that no NPC anywhere explains.
 *      Weak by nature — it only asks whether the word appears in dialogue at all
 *      near an explaining verb — so treat it as a reading list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const SHOW_REFS = process.argv.includes('--refs');

const readAll = dir => fs.readdirSync(path.join(ROOT, dir))
  .filter(f => f.endsWith('.json'))
  .map(f => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')) }));

// ── the world's own gazetteer ───────────────────────────────────────────────
const zones = readAll('zones');
const byName = new Map();
for (const { data } of zones) {
  if (!data.name) continue;
  if (!byName.has(data.name)) byName.set(data.name, []);
  byName.get(data.name).push(data.id);
}

// The family a zone id belongs to: zone_district_* is the city grid, zone_scw_*
// the Scarletwastes, zone_lw_* the Long Watch, and so on.
const familyOf = id => {
  const m = /^zone_([a-z]+)_/.exec(id);
  if (!m) return 'other';
  return /^\d/.test(id.replace('zone_' + m[1] + '_', '')) ? m[1] + '(grid)' : m[1];
};

// ── 1. colliding names ──────────────────────────────────────────────────────
// Interior labels that are SUPPOSED to repeat across buildings. A tenement and a
// tower block both having a Lobby is not a collision, it is architecture.
const GENERIC = /^(utility room|lobby|unit \d+|bathroom|bedroom|kitchen|stairwell|elevator|lift|grand lobby|bullpen|stockroom|floor \d+|utility nook|corridor|hallway|basement|roof|office|storeroom|cellar|landing|foyer|reception|.* — utility room)$/i;
// A shop's facade tile and its interior share a name on purpose — that is one
// place seen from outside and inside, and every building in the game is built
// that way. They all carry the same flags.building_name, so the whole group
// agreeing on it is the signal that this is a building rather than a clash.
const buildingNameOf = new Map();
for (const { data } of zones) buildingNameOf.set(data.id, data.flags?.building_name ?? null);
// Interiors sit at grid 0,0 and often carry no building_name of their own, so
// the test is: exactly one tile on the world grid claims this name as a
// building, and everything else sharing it is an interior. That is a facade and
// its rooms. Two grid tiles in different regions is a real clash.
const gridOf = new Map();
for (const { data } of zones) gridOf.set(data.id, data.grid_x);
const isOneBuilding = (name, ids) => {
  const onGrid = ids.filter(id => (gridOf.get(id) ?? 0) > 0);
  const interiors = ids.filter(id => (gridOf.get(id) ?? 0) === 0);
  return onGrid.length === 1
    && buildingNameOf.get(onGrid[0]) === name
    && interiors.every(id => {
      const bn = buildingNameOf.get(id);
      return bn === null || bn === name;
    });
};

const collisions = [];
for (const [name, ids] of byName) {
  const fams = new Set(ids.map(familyOf));
  if (GENERIC.test(name)) continue;
  if (isOneBuilding(name, ids)) continue;
  if (fams.size > 1) collisions.push({ name, ids, fams: [...fams] });
}
collisions.sort((a, b) => b.fams.length - a.fams.length || a.name.localeCompare(b.name));

// ── prose corpus ────────────────────────────────────────────────────────────
const prose = [];
const push = (where, text) => { if (typeof text === 'string' && text.length > 20) prose.push({ where, text }); };
for (const { file, data } of readAll('quests')) {
  push('quests/' + file, data.description);
  for (const o of data.objectives || []) { push('quests/' + file, o.desc); (o.emotes || []).forEach(e => push('quests/' + file, e)); }
  for (const f of data.fail_on || []) push('quests/' + file, f.desc);
}
for (const { file, data } of readAll('npcs')) {
  push('npcs/' + file, data.description);
  const t = JSON.stringify(data.dialogue_tree || {});
  for (const m of t.match(/"text":("(?:[^"\\]|\\.)*"|\[[^\]]*\])/g) || []) push('npcs/' + file, m);
}
for (const { file, data } of readAll('zones')) push('zones/' + file, data.description);

// ── 2. unresolvable shorthand ───────────────────────────────────────────────
// "the <noun>" where the noun looks like a named feature. Stoplist is the boring
// half of English plus the game's own furniture.
const STOP = new Set(('city machine architect basin player way world thing things time times day days night nights '
  + 'man woman men women people person hand hands face eye eyes door doors room rooms wall walls floor street streets '
  + 'money job jobs work worker workers water food air light dark cold heat rain wind sky ground dirt dust '
  + 'first last other others rest same only whole point kind sort part parts side end top bottom back front '
  + 'one two three four five six seven eight nine ten dozen half quarter '
  + 'watch order company shop counter shelf shelves bench ledger book books list lists paper papers file files '
  + 'gun guns knife blade pipe coat boots bag box tin case parcel package charge set kit gear stuff '
  + 'name names word words line lines question answer story reason problem trouble '
  + 'morning evening afternoon week weeks month months year years hour hours minute minutes second seconds '
  + 'north south east west left right ').split(/\s+/).filter(Boolean));

const zoneWords = new Set();
for (const name of byName.keys()) for (const w of name.toLowerCase().split(/[^a-z]+/)) if (w.length > 3) zoneWords.add(w);

const shorthand = new Map();   // word -> Set(files)
for (const { where, text } of prose) {
  for (const m of text.matchAll(/\bthe ([a-z]{4,14})\b/g)) {
    const w = m[1];
    if (STOP.has(w) || !zoneWords.has(w)) continue;
    if (!shorthand.has(w)) shorthand.set(w, new Set());
    shorthand.get(w).add(where);
  }
}

// A shorthand is a problem when the word it points at belongs to more than one
// distinct place — the reader has no way to pick.
const ambiguousShorthand = [];
for (const [word, files] of shorthand) {
  const matches = [...byName.entries()].filter(([n]) => n.toLowerCase().split(/[^a-z]+/).includes(word));
  const fams = new Set(matches.flatMap(([, ids]) => ids.map(familyOf)));
  if (files.size > 25 || files.size < 2) continue;
  if (fams.size > 1) ambiguousShorthand.push({ word, files: [...files], places: matches.map(([n]) => n), fams: [...fams] });
}
ambiguousShorthand.sort((a, b) => b.files.length - a.files.length);

// ── report ──────────────────────────────────────────────────────────────────
console.log('PLACE NAMES — ' + byName.size + ' distinct zone names over ' + zones.length + ' zones\n');

console.log('1. NAMES HELD BY UNRELATED PLACES  (' + collisions.length + ')\n');
for (const c of collisions.slice(0, 20)) {
  console.log('   "' + c.name + '"  — ' + c.fams.join(' + '));
  console.log('      ' + c.ids.slice(0, 4).join(', ') + (c.ids.length > 4 ? ' …+' + (c.ids.length - 4) : ''));
}

console.log('\n2. SHORTHAND A READER CANNOT RESOLVE  (' + ambiguousShorthand.length + ')\n');
for (const s of ambiguousShorthand) {
  console.log('   "the ' + s.word + '"  used in ' + s.files.length + ' file(s)');
  console.log('      could mean: ' + s.places.slice(0, 5).join(' · '));
  if (SHOW_REFS) s.files.slice(0, 8).forEach(f => console.log('        ' + f));
}

console.log('\n3. NAMED BUT NEVER EXPLAINED\n');
const dialogue = prose.filter(p => p.where.startsWith('npcs/')).map(p => p.text.toLowerCase()).join(' ');
const unexplained = ambiguousShorthand.filter(s =>
  !new RegExp('the ' + s.word + '[^.]{0,40}\\b(is|means|was|runs|used to)\\b').test(dialogue));
for (const s of unexplained) console.log('   "the ' + s.word + '" — no NPC anywhere says what it is');
if (!unexplained.length) console.log('   (every ambiguous name is explained somewhere)');

console.log('\n  --refs to list the files.');
