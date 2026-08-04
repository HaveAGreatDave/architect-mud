// Who sells the thing you're short of.
//
// The Recipe Assistant could always say WHAT you were missing and never where to
// get it, which left the last and most tedious step of the errand — remembering
// which shop had the cream — in the player's head, exactly as the shopping list
// found the errand itself there.
//
// TWO RULES SHAPE IT.
//
// **It names a shop only if you know the shopkeeper.** There is no visited-zone
// record in this game and inventing one for a HUD hint would be a per-player
// table earning its keep once; what there IS is `player_npc_relations`, which
// already answers a better question than "have you been there" — have you MET
// them. So a shop is named at `known` or above, which is the tier you reach by
// talking to somebody or buying something from them. A grocer you've never met
// stays "somewhere in town": true, useful (it exists, go and look), and not a
// map to a district you haven't walked. That read is sync and query-free —
// `getRelation` is hydrated at login — so the gate costs the panel nothing.
//
// **The catalogue, not the shelf.** `vendor_stock` is the rotating subset a
// vendor happens to have out today and it is restocked on a clock; a hint keyed
// on it would tell you Bodega Vu doesn't sell tomatoes on a Tuesday. What the
// player wants to know is who DEALS in the thing, which is `vendor_inventory`.
//
// One query, cached: vendors change when an author edits them, not while
// somebody is cooking.
import { query } from '../../server/models/db.js';
import { getItemCache } from '../../server/engine/items-cache.js';
import { getRelation, relationAtLeast } from '../../server/engine/relations.js';

// Long, because the thing it caches is authored content. A vendor added by the
// dev panel shows up within the hour and nobody is waiting on it.
const TTL_MS = 60 * 60 * 1000;

let cache = null;         // { at, byItem: Map(item_id → [vendor]), vendors: [] }
let inflight = null;

// Exported for the regress suite and for anything that edits vendors — the dev
// panel's NPC save is the one thing that can make this stale on purpose.
export function invalidateStockists() { cache = null; }

async function load() {
  const { rows } = await query(
    `SELECT id, name, vendor_shop_name, zone_id, vendor_inventory
       FROM npcs
      WHERE jsonb_array_length(vendor_inventory) > 0`
  );
  const byItem = new Map();
  for (const r of rows) {
    // The name over the door beats the name of the person behind it: "Bodega Vu"
    // is what a player is looking for on a sign, and half of them never learn the
    // clerk's name at all.
    const vendor = { npcId: r.id, shop: r.vendor_shop_name || r.name, zoneId: r.zone_id };
    for (const e of r.vendor_inventory || []) {
      if (!e?.item_id) continue;
      if (!byItem.has(e.item_id)) byItem.set(e.item_id, []);
      byItem.get(e.item_id).push(vendor);
    }
  }
  cache = { at: Date.now(), byItem };
  return cache;
}

async function index() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  // One loader, however many kitchens open at once — the panel is a burst of
  // reads and this must not become a burst of identical queries.
  if (!inflight) inflight = load().finally(() => { inflight = null; });
  return inflight;
}

// Item ids that would answer a shortfall. A CLASS is satisfied by anything
// carrying the profile — the same test `markShelf` marks the shelf with, and the
// reason the shopping list stores classes in the first place: whoever stocks a
// soft vegetable answers "a soft vegetable", with nothing authored to say so.
function itemsAnswering({ itemId = null, profile = null }) {
  if (itemId) return [itemId];
  if (!profile) return [];
  const out = [];
  for (const item of getItemCache().values()) {
    const tags = item?.tags || {};
    if (tags.food_profile === profile || tags.food_also === profile) out.push(item.id);
  }
  return out;
}

// Two, and the rest is "and elsewhere". A hint is a nudge towards the door; a
// list of every grocer in Coldwater is a directory, and the tablet map is where
// somebody who wants one should be sent.
const MAX_SHOPS = 2;

/**
 * Where to buy one shortfall.
 *
 * Returns `{ shops: [name], sold: bool }` — `shops` is only ever places whose
 * keeper you know, and `sold` says whether ANYBODY stocks it. The two are
 * deliberately separate: an empty `shops` with `sold: true` is "you'll find it,
 * you just haven't met the shop", and `sold: false` is the genuinely useful
 * answer that no vendor carries this and you are going to have to catch it,
 * grow it or loot it.
 */
export async function whereToBuy(player, want) {
  const { byItem } = await index();
  const seen = new Set();
  const known = [];
  let sold = false;
  for (const id of itemsAnswering(want)) {
    for (const v of byItem.get(id) || []) {
      sold = true;
      if (seen.has(v.npcId)) continue;
      seen.add(v.npcId);
      if (relationAtLeast(getRelation(player, v.npcId), 'known')) known.push(v.shop);
    }
  }
  // Dedup by SHOP, not by vendor: a chain with two clerks is one place to walk to.
  const shops = [...new Set(known)].slice(0, MAX_SHOPS);
  return { shops, sold };
}

// Every shortfall of one recipe, resolved together. The index is loaded once and
// the per-want work is in-memory, so this is one query for the whole panel
// however many recipes are short of however many things.
export async function whereToBuyAll(player, wants) {
  if (!wants.length) return [];
  await index();
  return Promise.all(wants.map(w => whereToBuy(player, w)));
}
