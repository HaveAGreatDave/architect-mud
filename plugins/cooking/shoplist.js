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
import { getItem } from '../../server/engine/items-cache.js';
import { PROFILES, profileNameFor } from './profiles.js';
import { unitsOf, ingredientLine, DISHES } from './dishes.js';

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
    return Array.isArray(list) ? list.filter(e => e && e.k && e.v) : [];
  } catch { return []; }
}

async function putList(playerId, list) {
  await setFlagById(playerId, SHOPLIST_FLAG, JSON.stringify(list.slice(0, MAX_ENTRIES)));
}

// What you're carrying, in the same units the recipes count in. One query, and
// it is the only one this module makes.
export async function holdings(playerId) {
  const { rows } = await query(
    `SELECT pi.quantity, pi.custom_data, i.weight, i.tags
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

// Add a recipe's SHORTFALL, not its whole ingredient list. You already own half
// of most recipes, and a shopping list that told you to buy things off your own
// shelf would be one nobody read twice.
export async function addShortfall(playerOrId, template, { label = null } = {}) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const held = await holdings(playerId);
  const list = await getList(playerId);
  const added = [];

  for (const [profile, need] of Object.entries(template.needs || {})) {
    const want = Array.isArray(need) ? need[0] : need;
    const have = held.byProfile[profile] || 0;
    // The recipe's own floor, so the list and the matcher agree about "enough".
    const short = want - have;
    if (short <= 0.05) continue;
    const entry = {
      k: 'p', v: profile, n: Math.round(short * 100) / 100,
      label: ingredientLine(profile, need, template, id => { try { return getItem(id); } catch { return null; } }),
      for: label || null,
    };
    const at = list.findIndex(e => sameEntry(e, entry));
    if (at >= 0) { if (list[at].n < entry.n) list[at] = entry; }
    else { list.push(entry); added.push(entry); }
  }

  for (const id of template.keyItems || []) {
    if ((held.byItem[id] || 0) >= 1) continue;
    const entry = { k: 'i', v: id, n: 1, label: getItem(id)?.name || id.replace(/^item_/, '').replace(/_/g, ' '), for: label || null };
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
