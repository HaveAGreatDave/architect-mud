// The KIT a recipe needs — the pan, the spoon, the knife.
//
// A recipe has always known what food goes in it and said nothing about what you
// make it IN. That was survivable while the only reader was the cook standing in
// a kitchen with a pan already on the hob, and useless everywhere else: the
// Cookbook card described a stew in grams and never mentioned the pot, and the
// shopping list — whose entire promise is "this is what to go and buy" — sent
// you to market for meat and potatoes and let you come home without the pot.
//
// THE RULE THAT SHAPES IT: gear is DERIVED from the template, never authored.
// `vessel: 'pot'` already says which pan; the profiles already declare their
// turns (so the dish knows whether it wants stirring or turning) and their
// `needsPrep` (so it knows whether it wants a knife). Every line below is read
// back out of data that was already there — which is why 47 recipes gained a kit
// list with no edit to the catalog, and why one authored next month has one too.
//
// One catalog, one matcher, one set of nouns. The Cookbook card, the workspace
// Assistant and the shopping list all read this file, so a dish can never be
// described as needing a pot in one place and a pan in another.
//
// Sync and query-free by contract: everything here is either plugin-local
// balance data or the in-memory item cache. It is called from the shopping
// list's read path and from the workspace build, and neither may spend a round
// trip finding out that a stew wants a pot.
import { PROFILES, HANDLING_VERB } from './profiles.js';
import { getItemCache } from '../../server/engine/items-cache.js';

// A piece of kit, by the tags that answer it.
//
// `tags` is an OR — any one of them satisfies the line, which is how a butcher's
// knife counts as something to cut with. `kind` is only for the vessel family,
// where the tag is present on every pan and it's its VALUE that has to match.
//
// `shoppable` is the one field that isn't about the kitchen at all: a stove is
// furniture bolted to a room, so it belongs on a recipe card ("you need heat")
// and must never reach a shopping list, which is a list of things you can carry
// out of a shop. Anything with `shoppable: false` is stated and never listed.
export const GEAR = {
  'vessel:pan':   { label: 'a pan',   tags: ['vessel_kind'], kind: 'pan',  shoppable: true },
  'vessel:pot':   { label: 'a pot',   tags: ['vessel_kind'], kind: 'pot',  shoppable: true },
  'vessel:tray':  { label: 'a tray',  tags: ['vessel_kind'], kind: 'tray', shoppable: true },
  'vessel:bowl':  { label: 'a bowl',  tags: ['vessel_kind'], kind: 'bowl', shoppable: true },
  'tool:stir':    { label: 'something to stir it with', tags: ['can_stir'], shoppable: true },
  'tool:turn':    { label: 'something to turn it with', tags: ['can_turn'], shoppable: true },
  'tool:chop':    { label: 'a blade to cut it down with', tags: ['can_chop', 'butchering'], shoppable: true },
  'heat':         { label: 'a stove to put it on', tags: [], shoppable: false },
};

// WHY `bread` IS NOT IN THE CATALOG.
//
// A sandwich's vessel is the bread, and the bread is an ingredient the recipe
// already counts. Listing it as kit would put it on the shopping list twice —
// once as food and once as a thing to make it in — and would tell a player to go
// and buy a reusable loaf.
const NOT_KIT = new Set(['bread']);

// What one recipe needs to be made, in the order you'd reach for it.
//
// `req` splits two genuinely different sentences. REQUIRED means the verb
// refuses without it: the matcher will not resolve a stew that isn't in a pot,
// and nothing cooks without heat. BETTER means the dish is achievable without it
// and worse for it — a spoon isn't a gate, it's the difference between a stirred
// sauce and a caught one. A list that ran them together would be lying about one
// of them, so the distinction travels all the way to the display.
export function gearFor(template) {
  const out = [];
  const vessel = template?.vessel;
  if (vessel && !NOT_KIT.has(vessel) && GEAR[`vessel:${vessel}`]) {
    out.push({ key: `vessel:${vessel}`, req: 'required', ...GEAR[`vessel:${vessel}`] });
  }

  // A bowl dish is worked, not cooked — the same test the Assistant already
  // made, and the whole reason bowl recipes exist. No heat, and nothing to turn.
  const cooked = vessel !== 'bowl' && !NOT_KIT.has(vessel);
  const profiles = Object.keys(template?.needs || {})
    .map(n => [n, PROFILES[n]]).filter(([, p]) => p && !p.modifier);

  if (cooked) {
    out.push({ key: 'heat', req: 'required', ...GEAR.heat });
    // Turns come from the profiles, exactly as `methodLines` reads them: a dish
    // nobody should fuss ("Don't fuss it. Turning this makes it worse.") must
    // not be sold a spatula on the strength of it.
    const turns = Math.max(0, ...profiles.map(([, p]) => p.turns || 0));
    if (turns > 0) {
      const key = profiles.some(([n]) => HANDLING_VERB[n] === 'stir') ? 'tool:stir' : 'tool:turn';
      out.push({ key, req: 'better', ...GEAR[key] });
    }
  }

  // "Cut everything down first — you'll want a knife" is a line the method
  // already prints. This is that line, as something you can put on a list.
  if (profiles.some(([, p]) => p.needsPrep)) out.push({ key: 'tool:chop', req: 'better', ...GEAR['tool:chop'] });

  return out;
}

// Every tag that could make an item a piece of kit, for the one caller that has
// to ask the DATABASE the question rather than the item cache. Derived from the
// catalog so a piece of kit added above is included here without a second edit.
export const GEAR_TAGS = [...new Set(['vessel_kind', ...Object.values(GEAR).flatMap(g => g.tags)])];

// Which kit keys ONE item answers. The single matcher — the shopping list counts
// what you hold with it and the shop marks its shelf with it, so a thing that
// ticks a line off your list is exactly a thing the shelf highlights.
export function gearKeysOf(tags) {
  if (!tags) return [];
  const out = [];
  const kind = tags.vessel_kind;
  if (kind && GEAR[`vessel:${kind}`]) out.push(`vessel:${kind}`);
  for (const [key, spec] of Object.entries(GEAR)) {
    if (key.startsWith('vessel:')) continue;
    if (spec.tags.some(t => tags[t])) out.push(key);
  }
  return out;
}

// Three things in the shop that would answer this line, same cap and same reason
// as the ingredient examples: four reads as a catalogue rather than a hint.
const MAX_EXAMPLES = 3;

export function gearExamples(key) {
  const spec = GEAR[key];
  if (!spec?.shoppable) return [];
  const names = new Set();
  for (const item of getItemCache().values()) {
    if (!gearKeysOf(item?.tags).includes(key)) continue;
    names.add(String(item.name || '').toLowerCase().trim());
    if (names.size >= MAX_EXAMPLES) break;
  }
  return [...names].filter(Boolean).sort();
}

// The kit as prose, for a card that has a paragraph rather than a checklist.
// "a pot, a stove to put it on, and something to stir it with".
export function gearLine(template) {
  const gear = gearFor(template);
  if (!gear.length) return null;
  const parts = gear.map(g => g.label);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
