// The shopping list — what you still have to go and buy.
//
// A recipe's shortfall is already computed in three places (the workspace
// Assistant, the Cookbook app's detail card, `prepare`'s refusal). None of them
// survived leaving the room, which meant the actual workflow — read what you're
// missing, walk to the market, try to remember it — happened in the player's
// head. This is that list, written down.
//
// THE RULE THAT SHAPES IT: **the list stores what you WANT, never what you have.**
// Whether an entry is satisfied is DERIVED at read time from your inventory, so
// nothing has to fire when you buy something, nothing can go stale, and there is
// no write on acquisition to miss. Buying the onion ticks the box because the
// box is a question, not a record.
//
// Storage is one `player_flags` row — `shoplist`, a small JSON array — beside
// `cookbook:` and `recipe:`. No new table, no new `players` column.
import { query } from '../../server/models/db.js';
import { getFlagById, setFlagById, clearFlagsIn } from '../../server/engine/flags.js';
import { getItem, getItemCache } from '../../server/engine/items-cache.js';
import { PROFILES, profileNameFor } from './profiles.js';
import { unitsOf, ingredientLine, keyNounFor, DISHES } from './dishes.js';

export const SHOPLIST_FLAG = 'shoplist';
export const MAX_ENTRIES = 24;

// An entry is one of two shapes, and they answer different questions:
//   { k:'p', v:<profile>, n:<units>, label }  — a CLASS ("about 500g of meat")
//   { k:'i', v:<item_id>, n:<count>, label }  — a specific thing (ramen noodles)
// Class entries are the common case, because that's what a recipe actually asks
// for; a keyed dish is the exception and names its anchor outright.
export async function getList(playerOrId) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const raw = await getFlagById(playerId, SHOPLIST_FLAG);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? refresh(list.filter(e => e && e.k && e.v)) : [];
  } catch { return []; }
}

// THE LABEL IS DERIVED TOO.
//
// The rule at the top of this file — store what you want, derive the rest at read
// time — was applied to whether a line is SATISFIED and to nothing else. The
// line's prose was written once, at add time, and then kept forever in a flag.
// So a list survived a change to the recipe it came from and went on describing
// the old one: penne alla gin used to want a `liquid`, and a list added back then
// still asks for "800g–1.2kg of liquid — tomato for the body, a slug of gin,
// cream to finish" long after the dish was rewritten into a tomato, a cream and
// two named bottles. Nothing was going to correct it, because nothing re-read the
// recipe.
//
// So the recipe is re-read on every load. A stored entry keeps the two things
// that are genuinely a RECORD of a decision — which class or item you wanted, and
// how much you were short — and everything a reader sees is rebuilt from the
// template. A list written by any older build heals itself the moment you open it.
//
// Sync and query-free: `catalogTemplate` and the item cache are both in memory,
// so this costs a read path nothing.
// COMPONENTS vs ALTERNATIVES — the two things a nested line can mean, and the
// one distinction a shopping list is not allowed to blur.
//
// A generic class carries buyable EXAMPLES: "400g of liquid" is one errand and
// tinned tomatoes OR stock OR cream each finish it. You buy one.
//
// A `parts` group is the opposite: penne alla gin's sauce is tomato AND gin AND
// cream, all three, and the reason to nest them is that they are one thing —
// the sauce — rather than three unrelated errands filed next to the pasta. You
// buy all of them.
//
// Both nest. So both have to SAY which they are, or nesting makes them look
// identical. Alternatives get "or" between them and no checkboxes; components
// keep their own boxes under a named parent. The label a component sits under is
// stamped here, on the entry, so every reader (the verb, the tablet) groups the
// same way without either of them re-deriving it.
// The group an entry belongs to, and WHERE IN IT — `of` is one ordered list and
// its order is the order the thing is made in, so the position travels with the
// entry. Without it the sauce reads back as tomato, cream, gin: the order the
// storage happened to be in, which is not an order anybody cooks in.
export function partFor(template, entry) {
  for (const part of template?.parts || []) {
    const at = (part.of || []).indexOf(entry.v);
    if (at >= 0) return { label: part.label, at };
  }
  return null;
}

// A COMPONENT GROUP IS ALL-OR-NOTHING, so the list completes it.
//
// Relabelling wasn't enough. A list added before penne alla gin was rewritten
// held only its two key items, so the sauce — three things — rendered as "1
// things that make it" with the tomato and the cream nowhere on screen. Dropping
// a dead line was half the job; a recipe that GAINS an ingredient is the other
// half, and no reader could tell "absent because you already own it" from
// "absent because this list predates the ingredient".
//
// So a part is completed and only a part. You cannot buy two thirds of a sauce,
// and a group that shows one third of itself is worse than no group at all.
// Loose lines keep their shortfall meaning — those really are "what you were
// short of", and backfilling them would put things you already own on a list
// whose whole promise is that it doesn't do that.
function completeParts(list, template, forLabel, itemRow) {
  const out = [...list];
  for (const part of template?.parts || []) {
    // Only a group this list is already carrying — adding one nobody asked for
    // would put a sauce on the list of somebody who only wanted the pasta.
    const present = (part.of || []).filter(v => list.some(e => e.v === v));
    if (!present.length) continue;
    for (const [at, v] of (part.of || []).entries()) {
      if (list.some(e => e.v === v)) continue;
      if (String(v).startsWith('item_')) {
        out.push({ k: 'i', v, n: 1, label: itemRow(v)?.name || v.replace(/^item_/, '').replace(/_/g, ' '), for: forLabel, part: part.label, partAt: at });
      } else {
        const need = template.needs?.[v];
        if (need == null) continue;
        const named = classLabel(v, need, template);
        const want = Array.isArray(need) ? need[0] : need;
        out.push({ k: 'p', v, n: want, label: named.label, base: named.base, ex: named.ex, for: forLabel, part: part.label, partAt: at });
      }
    }
  }
  return out;
}

export function refresh(list) {
  const itemRow = id => { try { return getItem(id); } catch { return null; } };
  // Complete every incomplete component group first, so the pass below relabels
  // the backfilled lines exactly like the stored ones. One list in, one out.
  let work = list;
  for (const forLabel of new Set(list.map(e => e.for).filter(Boolean))) {
    const template = catalogTemplate(forLabel)?.template;
    if (!template?.parts?.length) continue;
    const mine = work.filter(e => e.for === forLabel);
    const completed = completeParts(mine, template, forLabel, itemRow);
    if (completed.length !== mine.length) {
      work = [...work.filter(e => e.for !== forLabel), ...completed];
    }
  }
  const out = [];
  for (const e of work) {
    const template = e.for ? catalogTemplate(e.for)?.template : null;
    // A loose want, or one from a player's own recipe: nothing to re-derive it
    // from, so it stays exactly as written. That's the whole of its truth.
    if (!template) { out.push(e); continue; }

    const part = partFor(template, e);
    const stamp = { part: part?.label ?? null, partAt: part?.at ?? null };
    if (e.k === 'i') { out.push({ ...e, label: itemRow(e.v)?.name || e.label, ...stamp }); continue; }

    const need = template.needs?.[e.v];
    // The recipe doesn't want this class any more. Not a line to relabel — a line
    // that should never have survived the dish being rewritten.
    if (need == null) continue;
    // ...and a class a key item on this same list satisfies outright is the
    // duplicate that dedup already removes at add time. Applied here too, so an
    // older list stops asking for the penne twice.
    const [lo, hi] = Array.isArray(need) ? need : [need, need];
    const keyed = (template.keyItems || []).some(id =>
      itemRow(id)?.tags?.food_profile === e.v && list.some(x => x.k === 'i' && x.v === id));
    if (keyed && lo === 1 && hi === 1) continue;

    const named = classLabel(e.v, need, template);
    out.push({ ...e, label: named.label, base: named.base, ex: named.ex, ...stamp });
  }
  return out;
}

async function putList(playerId, list) {
  await setFlagById(playerId, SHOPLIST_FLAG, JSON.stringify(list.slice(0, MAX_ENTRIES)));
}

// What you're carrying, in the same units the recipes count in. One query, and
// it is the only one this module makes.
export async function holdings(playerId) {
  const { rows } = await query(
    `SELECT pi.item_id, pi.quantity, pi.custom_data, i.weight, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1`,
    [playerId]
  );
  const byProfile = {};
  const byItem = {};
  for (const r of rows) {
    // A finished dish is dinner, not an ingredient — the same rule the Assistant
    // uses. Buying a stew does not tick "500g of meat" off your list.
    if (r.custom_data?.dish || r.custom_data?.cooked) continue;
    const p = profileNameFor(r);
    if (p && PROFILES[p]) byProfile[p] = (byProfile[p] || 0) + unitsOf(r, p);
    const id = r.item_id;
    if (id) byItem[id] = (byItem[id] || 0) + (Number(r.quantity) || 1);
  }
  return { byProfile, byItem };
}

// The list, with each entry answered. Derived — nothing here writes.
export function answer(list, held) {
  return list.map(e => {
    const have = e.k === 'p' ? (held.byProfile[e.v] || 0) : (held.byItem[e.v] || 0);
    return { ...e, have, done: have >= (e.n || 1) - 1e-9 };
  });
}

const sameEntry = (a, b) => a.k === b.k && a.v === b.v;

// THINGS YOU CAN ACTUALLY BUY, not the class and not the note.
//
// A recipe card's note is prose written for the cook — penne alla gin says
// "tomato for the body, a slug of gin, cream to finish", which reads perfectly
// and sends you home with a fresh tomato that doesn't count: a tomato is a
// `soft_vegetable`, and the liquid in that sauce is the TINNED one, or the
// paste, cooked down. On a recipe card that's a fine thing to say. On a shopping
// list it is a wrong answer, because the list's only job is to be shoppable.
//
// So the list names examples derived from the catalogue instead, and the test is
// the one the matcher itself applies: `food_profile` exactly, the same field
// `profileNameFor` reads. Everything named here therefore ticks the entry off
// when you buy it. The entry stays a CLASS entry — this is the label, not the
// rule — so whatever else the shop happens to stock still counts too.
// Three. Four starts reading as a catalogue rather than a hint, and the tail of
// any profile is always the thing nobody wants to be told to cook with.
const MAX_EXAMPLES = 3;

export function buyableExamples(profileName, template = null) {
  const keyed = new Set(template?.keyItems || []);
  // The note still gets a say in the ORDER, which is the half of it that was
  // right: it knows this sauce is mostly tomato and only a slug of gin. What it
  // doesn't get is the last word on whether the thing it names counts — a noun
  // only survives here if a real item carries the profile.
  const note = String(template?.notes?.[profileName] || '').toLowerCase();
  const cands = new Map();       // noun → rank tuple
  for (const item of getItemCache().values()) {
    const tags = item?.tags || {};
    if (tags.food_profile !== profileName) continue;
    const noun = String(tags.food_noun || item.name || '').toLowerCase().trim();
    if (!noun) continue;
    const at = note && new RegExp(`\\b${noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(note)
      ? note.indexOf(noun.split(' ')[0]) : Infinity;
    const rank = [at, keyed.has(item.id) ? 0 : 1, noun];
    const prev = cands.get(noun);
    if (!prev || rank[0] < prev[0] || (rank[0] === prev[0] && rank[1] < prev[1])) cands.set(noun, rank);
  }
  return [...cands.values()]
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || a[2].localeCompare(b[2]))
    .slice(0, MAX_EXAMPLES)
    .map(r => r[2]);
}

// "tinned tomatoes, gin or cream" — an English list, because this line is read
// standing in a shop and not parsed by anything.
function examplesLine(examples) {
  if (!examples.length) return '';
  if (examples.length === 1) return examples[0];
  return `${examples.slice(0, -1).join(', ')} or ${examples[examples.length - 1]}`;
}

// The label one class shortfall carries, as its PARTS rather than one string:
//   { label }      — the whole line, which is what the text list prints
//   { base }       — the ask on its own ("400g of liquid")
//   { ex }         — the buyable nouns that would answer it
//
// Kept separate because they are two different KINDS of thing and a display that
// can tell them apart can nest them. `base` is a line you tick; `ex` is a set of
// alternatives, any ONE of which ticks it — which is exactly why they are not
// themselves list entries. Anything that just wants a line still reads `label`.
//
// The weight comes from the recipe (the same number the matcher counts against);
// the nouns come from the shelf.
function classLabel(profile, need, template) {
  const itemInfo = id => { try { return getItem(id); } catch { return null; } };
  // A class the dish wants exactly one of already prints its key item's own noun
  // ("125g of penne"). That IS the buyable thing; listing four more starches
  // after it would only make a solved line ambiguous again.
  //
  // The note is suppressed on every branch, not just the one below. "125g of penne
  // — a portion a head, no more" is a good line on a recipe card and noise on a
  // shopping list, which has one job: say what to buy. How much of it goes in the
  // pan is the card's business, and the card still says it.
  const plain = { ...template, notes: {} };
  if (keyNounFor(template, profile, itemInfo)) {
    const label = ingredientLine(profile, need, plain, itemInfo);
    return { label, base: label, ex: [] };
  }
  const examples = buyableExamples(profile, template);
  if (!examples.length) {
    const label = ingredientLine(profile, need, plain, itemInfo);
    return { label, base: label, ex: [] };
  }
  // Note suppressed deliberately — see above. The examples replace it, and they
  // are the half of it that can be handed over a counter.
  const base = ingredientLine(profile, need, plain, itemInfo);
  return { label: `${base} — ${examplesLine(examples)}`, base, ex: examples };
}

// Add a recipe's SHORTFALL, not its whole ingredient list. You already own half
// of most recipes, and a shopping list that told you to buy things off your own
// shelf would be one nobody read twice.
export async function addShortfall(playerOrId, template, { label = null } = {}) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const held = await holdings(playerId);
  const list = await getList(playerId);
  const added = [];

  // KEY ITEMS ARE COUNTED FIRST, and they count TWICE over — once as the specific
  // thing you have to go and buy, and once against the class they belong to.
  // A key item is mandatory (the matcher refuses the dish without it), so the
  // moment it lands in the basket it also satisfies one unit of its own profile.
  // Without this, penne alla gin wrote "125g of penne" AND "box of penne" as two
  // separate lines — the same shopping trip, twice, because the class label had
  // already borrowed the key item's noun.
  const itemRow = id => { try { return getItem(id); } catch { return null; } };
  const keyMissing = [];                 // key items not already in hand
  const keyCovers = {};                  // profile → units those missing keys will supply
  for (const id of template.keyItems || []) {
    if ((held.byItem[id] || 0) >= 1) continue;
    keyMissing.push(id);
    const p = itemRow(id)?.tags?.food_profile;
    if (p && PROFILES[p]) keyCovers[p] = (keyCovers[p] || 0) + 1;
  }

  for (const [profile, need] of Object.entries(template.needs || {})) {
    const want = Array.isArray(need) ? need[0] : need;
    const have = held.byProfile[profile] || 0;
    // The recipe's own floor, so the list and the matcher agree about "enough".
    const short = want - have - (keyCovers[profile] || 0);
    if (short <= 0.05) continue;
    // Once a key item is covering part of the class, the line has to describe
    // what's LEFT — "800g–1.2kg of liquid" when the gin is already on the list
    // below it is the same overcount the duplicate line was.
    const named = classLabel(profile, keyCovers[profile] ? short : need, template);
    const entry = {
      k: 'p', v: profile, n: Math.round(short * 100) / 100,
      label: named.label, base: named.base, ex: named.ex,
      for: label || null,
    };
    const at = list.findIndex(e => sameEntry(e, entry));
    if (at >= 0) { if (list[at].n < entry.n) list[at] = entry; }
    else { list.push(entry); added.push(entry); }
  }

  for (const id of keyMissing) {
    const entry = { k: 'i', v: id, n: 1, label: itemRow(id)?.name || id.replace(/^item_/, '').replace(/_/g, ' '), for: label || null };
    if (list.some(e => sameEntry(e, entry))) continue;
    list.push(entry);
    added.push(entry);
  }

  await putList(playerId, list);
  return { added, total: Math.min(list.length, MAX_ENTRIES) };
}

// Drop everything already in your hands. The one bit of housekeeping worth a
// verb — the rest of the list is answered live, so nothing else can go stale.
export async function tidy(playerOrId) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const held = await holdings(playerId);
  const list = await getList(playerId);
  const kept = answer(list, held).filter(e => !e.done).map(({ have, done, ...e }) => e);
  await putList(playerId, kept);
  return { removed: list.length - kept.length, left: kept.length };
}

export async function clearList(playerOrId) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  await clearFlagsIn(playerId, [SHOPLIST_FLAG]);
}

export async function removeAt(playerOrId, index) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const list = await getList(playerId);
  if (index < 0 || index >= list.length) return { ok: false };
  const [gone] = list.splice(index, 1);
  await putList(playerId, list);
  return { ok: true, gone };
}

// Resolve a recipe name to something with `needs` — the authored catalog first,
// then the player's own book, so "add my house special to the list" works.
export function catalogTemplate(nameStr) {
  const q = String(nameStr || '').trim().toLowerCase();
  for (const [key, t] of Object.entries(DISHES)) {
    if (key === q || key.replace(/_/g, ' ') === q) return { key, template: t };
  }
  return null;
}
