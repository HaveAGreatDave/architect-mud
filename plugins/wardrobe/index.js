/**
 * Wardrobe — saved outfits layered over an ordinary container.
 *
 * A wardrobe is not a new object type. It is `object_type:'container'` furniture
 * carrying `flags.wardrobe`, so every existing storage verb (open/stow/pull, the
 * capacity accounting, the by-id panel refresh) works on it unchanged. All this
 * plugin adds is a second reading of the same box: an outfit is an ordered list
 * of ITEM TEMPLATE ids, and wearing one dresses you from whatever is hanging in
 * that wardrobe (falling back to what you're already carrying).
 *
 * Why template ids and not inventory row ids: rows are volatile — stow/pull can
 * merge and re-create them, and a replaced shirt is a new row. A saved look
 * should mean "that jacket", not "that particular instance of that jacket".
 *
 * Read-tier note (docs/architecture.md): nothing here hangs off a hot path. The
 * only queries run on an explicit player action — opening the panel, or saving /
 * wearing / deleting an outfit.
 */
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { emit } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer, teachVerb, pointAt } from '../../server/engine/messaging.js';
import {
  BODY_SLOTS, recomputeEquipped, cmdEquipById, buildContainerView,
  cmdUndress, containerCapacity, containerContentsWeight, loadContainerById,
} from '../../server/engine/commands/inventory.js';

// What an outfit captures. Body slots plus accessories — a look includes the
// rings and the shades. The wielded weapon is deliberately excluded: that's
// armament, not clothing, and swapping outfits should never disarm you.
const OUTFIT_SLOTS = [...BODY_SLOTS, 'accessory'];

const MAX_OUTFITS = 12;
const MAX_NAME = 24;

// --- Resolution -------------------------------------------------------------

// The wardrobe the player is standing at. With a name given, match it; without,
// take the only one in the room (a room with two wardrobes wants a name).
async function resolveWardrobe(player, nameStr) {
  const like = nameStr ? `%${nameStr}%` : null;
  const { rows } = await query(
    `SELECT id, name FROM furniture
      WHERE zone_id=$1 AND object_type='container' AND flags->>'wardrobe'='true'
        AND ($2::text IS NULL OR name ILIKE $2 OR flags->>'aliases' ILIKE $2)`,
    [player.current_zone, like]
  );
  if (!rows.length) return null;
  return rows.length === 1 ? rows[0] : 'ambiguous';
}

// Confirm an id really is a wardrobe in this room before acting on it — the
// panel's by-id verbs are client-supplied and must not be trusted.
async function loadWardrobeById(player, furnId) {
  const { rows } = await query(
    `SELECT id, name FROM furniture
      WHERE id=$1 AND zone_id=$2 AND object_type='container' AND flags->>'wardrobe'='true'`,
    [furnId, player.current_zone]
  );
  return rows[0] || null;
}

// --- Outfit storage ---------------------------------------------------------

// The look currently on the player's body, in outfit terms. Ordered so the panel
// renders pads head-to-foot rather than in whatever order the rows came back.
async function loadEquipped(player) {
  const { rows } = await query(
    `SELECT DISTINCT pi.item_id, pi.slot FROM player_inventory pi
      WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)`,
    [player.id, OUTFIT_SLOTS]
  );
  return rows
    .map(r => ({ itemId: r.item_id, slot: r.slot, name: getItem(r.item_id)?.name || r.item_id }))
    .sort((a, b) => OUTFIT_SLOTS.indexOf(a.slot) - OUTFIT_SLOTS.indexOf(b.slot));
}

async function loadOutfits(playerId, furnId) {
  const { rows } = await query(
    'SELECT name, item_ids FROM player_outfits WHERE player_id=$1 AND furniture_id=$2 ORDER BY name',
    [playerId, furnId]
  );
  return rows;
}

// Decorate a saved outfit for the panel: resolve each template id to its name
// and slot, and mark whether the piece is actually reachable right now (hanging
// in this wardrobe, or already in the player's hands).
function describeOutfit(row, availableIds) {
  const items = (row.item_ids || []).map((itemId) => {
    const it = getItem(itemId);
    return {
      itemId,
      name: it?.name || itemId,
      slot: it?.tags?.slot || null,
      layer: it?.tags?.layer || null,
      available: availableIds.has(itemId),
    };
  });
  return { name: row.name, items, wearable: items.length > 0 && items.every(i => i.available) };
}

async function saveOutfit(player, furnId, name, itemIds) {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return { ok: false, message: 'Give the outfit a name.' };
  if (!itemIds.length) return { ok: false, message: 'An outfit needs at least one piece.' };
  const { rows: existing } = await query(
    'SELECT 1 FROM player_outfits WHERE player_id=$1 AND furniture_id=$2 AND lower(name)=lower($3)',
    [player.id, furnId, clean]
  );
  if (!existing.length) {
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS n FROM player_outfits WHERE player_id=$1 AND furniture_id=$2',
      [player.id, furnId]
    );
    if (countRows[0].n >= MAX_OUTFITS) {
      return { ok: false, message: `This wardrobe only holds ${MAX_OUTFITS} outfits. Delete one first.` };
    }
  }
  await query(
    `INSERT INTO player_outfits (player_id, furniture_id, name, item_ids) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (player_id, furniture_id, name) DO UPDATE SET item_ids = EXCLUDED.item_ids`,
    [player.id, furnId, clean, JSON.stringify(itemIds)]
  );
  return { ok: true, message: `Saved "${clean}" — ${itemIds.length} piece${itemIds.length === 1 ? '' : 's'}.` };
}

// --- Wearing ----------------------------------------------------------------

// The inventory row to equip for a template id: prefer one already in the
// player's hands, otherwise a copy hanging in this wardrobe. Returns the row id,
// pulling it out of the wardrobe first if that's where it came from.
async function claimForWear(player, furnId, itemId) {
  const { rows } = await query(
    `SELECT id, container_id FROM player_inventory
      WHERE item_id=$1 AND is_equipped=0
        AND ((player_id=$2 AND container_id IS NULL) OR container_id=$3)
      ORDER BY (container_id IS NULL) DESC LIMIT 1`,
    [itemId, player.id, furnId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (row.container_id) {
    await query('UPDATE player_inventory SET container_id=NULL, player_id=$1 WHERE id=$2', [player.id, row.id]);
  }
  return row.id;
}

async function wearOutfit(player, furnId, name, broadcast) {
  const { rows } = await query(
    'SELECT name, item_ids FROM player_outfits WHERE player_id=$1 AND furniture_id=$2 AND lower(name)=lower($3)',
    [player.id, furnId, name.trim()]
  );
  if (!rows.length) return { ok: false, message: `No outfit called "${name}" in this wardrobe.` };
  const outfit = rows[0];
  const itemIds = outfit.item_ids || [];

  // Strip what's on first, in one statement — the same shape as `undress`, so
  // shed pieces land in the pack rather than vanishing. Layering is rebuilt from
  // scratch below, which is why this can't be a per-piece swap.
  await query(
    `UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL
      WHERE player_id=$1 AND is_equipped=1 AND slot = ANY($2)`,
    [player.id, OUTFIT_SLOTS]
  );

  const worn = [], missing = [];
  for (const itemId of itemIds) {
    const rowId = await claimForWear(player, furnId, itemId);
    if (!rowId) { missing.push(getItem(itemId)?.name || itemId); continue; }
    // No per-piece broadcast: the room gets one line for the whole change.
    const res = await cmdEquipById(rowId, player, null);
    if (res?.type === 'error') missing.push(getItem(itemId)?.name || itemId);
    else worn.push(getItem(itemId)?.name || itemId);
  }

  await recomputeEquipped(player);
  emit('inventory.changed', { actor: player });
  if (worn.length) {
    broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} changes into a different outfit.` }, player.id);
  }

  let msg = worn.length
    ? `You dress in "${outfit.name}" — ${worn.join(', ')}.`
    : `You couldn't put any of "${outfit.name}" together.`;
  if (missing.length) msg += ` Missing: ${missing.join(', ')}.`;
  return { ok: true, message: msg };
}

// --- Undressing into the box ------------------------------------------------

// `undress <wardrobe>` — the true inverse of `dress`: take everything off AND hang
// it up, in one action. Note this covers OUTFIT_SLOTS (body + accessories), not the
// engine's body-only BODY_SLOTS, precisely because it pairs with an outfit; the
// wielded weapon still stays put (see OUTFIT_SLOTS).
//
// Capacity is honoured the same way `stow` honours it, but partially: garments that
// fit get hung, the rest stay shed in your pack rather than failing the whole strip.
// Clothing is non-stackable, so this needs none of stow's stack-merging.
async function undressInto(player, wardrobe, broadcast) {
  const { rows } = await query(
    `SELECT pi.id, pi.item_id, i.name, i.weight FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.is_equipped=1 AND pi.slot = ANY($2)
      ORDER BY i.name`,
    [player.id, OUTFIT_SLOTS]
  );
  if (!rows.length) return { ok: false, message: "You're not wearing anything to take off." };

  // Unequip first: whatever doesn't fit is still off your body and in your pack,
  // which is exactly what a bare `undress` would have left you with.
  await query(
    `UPDATE player_inventory SET is_equipped=0, slot=NULL, layer=NULL, equipped_at=NULL
      WHERE player_id=$1 AND is_equipped=1 AND slot = ANY($2)`,
    [player.id, OUTFIT_SLOTS]
  );

  const container = await loadContainerById(wardrobe.id, player);
  const cap = containerCapacity(container);
  let used = await containerContentsWeight(wardrobe.id);

  const hung = [], kept = [];
  for (const r of rows) {
    const w = r.weight || 0;
    if (used + w > cap) { kept.push(r.name); continue; }
    await query('UPDATE player_inventory SET container_id=$1, is_equipped=0, slot=NULL WHERE id=$2', [wardrobe.id, r.id]);
    used += w;
    hung.push(r.name);
  }

  await recomputeEquipped(player);
  emit('inventory.changed', { actor: player });
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} strips down and hangs up.` }, player.id);

  let msg = hung.length
    ? `You strip off and hang up ${hung.length} piece${hung.length === 1 ? '' : 's'} — ${hung.join(', ')}.`
    : `You strip down.`;
  if (kept.length) msg += ` The ${wardrobe.name} is full, so ${kept.join(', ')} stayed in your pack.`;
  return { ok: true, message: msg };
}

// --- Teaching the verb ------------------------------------------------------

// House convention (messaging.js): the first time prose mentions a new verb, the
// verb shimmers and is clickable. Fires once per character, from whichever comes
// first — examining a wardrobe or opening one.
const F_TAUGHT = 'wardrobe_outfits_taught';

// Players known to have already had the lesson. The flag read is one query, and
// this keeps it to one per session instead of one per wardrobe interaction
// forever after — examine and open are cheap paths, but they aren't free.
const taught = new Set();

async function claimTeach(player) {
  if (!player?.id || taught.has(player.id)) return false;
  if (await getFlag('player', F_TAUGHT, player)) { taught.add(player.id); return false; }
  taught.add(player.id);
  await setFlag('player', F_TAUGHT, 'true', player);
  return true;
}

function teachLine() {
  return `<span class="ambient">Whatever you hang in here, it will remember as a set. ${teachVerb('outfits', 'outfits')} lists the looks you've saved — and you can build a new one by dressing the doll when the doors are open.</span>`;
}

// Examine path: the prose teaches the verb, and the wardrobe's own link up in the
// room pane ripples, so the nudge lands in both places a player might look.
async function onFurnitureDescribe(furniture, player) {
  if (furniture?.flags?.wardrobe !== true) return undefined;
  if (!(await claimTeach(player))) return undefined;
  pointAt(player.id, 'examine', furniture.name);
  return teachLine();
}

// --- Panel view -------------------------------------------------------------

// Retype a container view into a wardrobe view. Mutates in place — see the
// container.view hook contract in engine commands/inventory.js.
async function decorateView({ view, container, player }) {
  if (container.kind !== 'furniture' || container.tags?.wardrobe !== true) return;
  const available = new Set();
  for (const r of view.containerItems || []) available.add(r.item_id);
  for (const r of view.invItems || []) available.add(r.item_id);
  // What you're WEARING counts as reachable too. buildContainerView's invItems is
  // deliberately is_equipped=0 (it lists the pack), so without this an outfit saved
  // from your current look renders every piece "missing" the instant you save it —
  // the card greys out while you are visibly wearing the clothes.
  const equipped = await loadEquipped(player);
  for (const r of equipped) available.add(r.itemId);
  const rows = await loadOutfits(player.id, container.id);
  view.type = 'wardrobe_view';
  // Which silhouette the panel draws. Same call the tablet's Gear app makes
  // (plugins/tablet/gear-app.js) off the same field, so a character is the same
  // shape in both places — the wardrobe doll and the gear doll are one body seen
  // twice, and they would look like two different people if this disagreed.
  view.sex = player.biological_sex === 'female' ? 'female' : 'male';
  view.outfits = rows.map(r => describeOutfit(r, available));
  // Seeds the panel's "Wearing" button, so composing a look from what's on your
  // back doesn't mean re-dragging pieces the server already knows about.
  view.equipped = equipped;
  // Opening a wardrobe without ever examining one still counts as the first
  // mention. No ripple here — the thing to click is the panel, not the pane.
  if (await claimTeach(player)) sendToPlayer(player.id, { type: 'output', message: teachLine() });
}

// Every wardrobe action answers with the refreshed panel, so the client never
// has to re-request it. `notify` is the one-line status the panel shows.
async function viewWith(player, furnId, notify) {
  const view = await buildContainerView(furnId, player);
  if (view.type === 'wardrobe_view' && notify) view.notify = notify;
  return view;
}

// --- Commands ---------------------------------------------------------------

// `outfits` / `outfit list` — the text listing, for players who never open the panel.
async function listOutfits(player, wardrobe) {
  const rows = await loadOutfits(player.id, wardrobe.id);
  if (!rows.length) return { type: 'output', message: `The ${wardrobe.name} holds no saved outfits yet. Wear something and try "outfit save <name>".` };
  let msg = `<span class="inv-header">OUTFITS — ${wardrobe.name}</span>`;
  for (const r of rows) {
    const names = (r.item_ids || []).map(id => getItem(id)?.name || id);
    msg += `\n  ${r.name} — ${names.join(', ') || '(empty)'}`;
  }
  return { type: 'output', message: msg };
}

// Registered as a tag-gated specialized action rather than a plain command, so
// `availableActions` surfaces it when you examine a wardrobe — the verb is
// discoverable on the object instead of being something you had to be told.
// Returns undefined with no wardrobe in reach, falling through to the dispatcher.
async function cmdOutfits(args, raw, player) {
  const wardrobe = await resolveWardrobe(player, args.join(' ') || null);
  if (wardrobe === 'ambiguous') return { type: 'error', message: 'Which wardrobe? Try "outfits <name>".' };
  if (!wardrobe) return undefined;
  return listOutfits(player, wardrobe);
}

async function cmdOutfit(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();
  const wardrobe = await resolveWardrobe(player, null);
  if (wardrobe === 'ambiguous') return { type: 'error', message: 'There is more than one wardrobe here — open the one you mean.' };
  if (!wardrobe) return { type: 'error', message: "There's no wardrobe here." };

  if (!sub || sub === 'list') return listOutfits(player, wardrobe);

  if (sub === 'save') {
    if (!rest) return { type: 'error', message: 'Save it as what? Try "outfit save work".' };
    const { rows } = await query(
      `SELECT DISTINCT item_id FROM player_inventory
        WHERE player_id=$1 AND is_equipped=1 AND slot = ANY($2)`,
      [player.id, OUTFIT_SLOTS]
    );
    if (!rows.length) return { type: 'error', message: "You're not wearing anything to save." };
    const res = await saveOutfit(player, wardrobe.id, rest, rows.map(r => r.item_id));
    return { type: res.ok ? 'output' : 'error', message: res.message };
  }

  if (sub === 'wear') {
    if (!rest) return { type: 'error', message: 'Wear which outfit?' };
    const res = await wearOutfit(player, wardrobe.id, rest, broadcast);
    return { type: res.ok ? 'output' : 'error', message: res.message, refresh: !!res.ok };
  }

  if (sub === 'delete' || sub === 'remove') {
    if (!rest) return { type: 'error', message: 'Delete which outfit?' };
    const { rowCount } = await query(
      'DELETE FROM player_outfits WHERE player_id=$1 AND furniture_id=$2 AND lower(name)=lower($3)',
      [player.id, wardrobe.id, rest]
    );
    return rowCount
      ? { type: 'output', message: `Deleted the "${rest}" outfit.` }
      : { type: 'error', message: `No outfit called "${rest}" in this wardrobe.` };
  }

  return { type: 'error', message: 'Try: outfit list | outfit save <name> | outfit wear <name> | outfit delete <name>' };
}

// Panel verbs. All take the wardrobe id explicitly (the panel knows which box it
// is showing) and answer with the refreshed view.

// outfitsetid <furnId> <name>|<itemId,itemId,…>  — the paper doll's Save.
async function cmdOutfitSetId(args, raw, player) {
  const furnId = args[0];
  const payload = args.slice(1).join(' ');
  const wardrobe = furnId && await loadWardrobeById(player, furnId);
  if (!wardrobe) return { type: 'container_error', message: 'Wardrobe not found.' };
  const sep = payload.indexOf('|');
  if (sep === -1) return { type: 'container_error', message: 'Malformed outfit.' };
  const name = payload.slice(0, sep);
  const itemIds = payload.slice(sep + 1).split(',').map(s => s.trim()).filter(Boolean);
  const res = await saveOutfit(player, furnId, name, itemIds);
  return viewWith(player, furnId, res.message);
}

async function cmdOutfitWearId(args, raw, player, broadcast) {
  const furnId = args[0];
  const name = args.slice(1).join(' ');
  const wardrobe = furnId && await loadWardrobeById(player, furnId);
  if (!wardrobe) return { type: 'container_error', message: 'Wardrobe not found.' };
  const res = await wearOutfit(player, furnId, name, broadcast);
  return viewWith(player, furnId, res.message);
}

async function cmdOutfitDelId(args, raw, player) {
  const furnId = args[0];
  const name = args.slice(1).join(' ').trim();
  const wardrobe = furnId && await loadWardrobeById(player, furnId);
  if (!wardrobe) return { type: 'container_error', message: 'Wardrobe not found.' };
  const { rowCount } = await query(
    'DELETE FROM player_outfits WHERE player_id=$1 AND furniture_id=$2 AND lower(name)=lower($3)',
    [player.id, furnId, name]
  );
  return viewWith(player, furnId, rowCount ? `Deleted "${name}".` : `No outfit called "${name}".`);
}

// `dress [name]` — the natural-language front door to `outfit wear`. Bare `dress`
// with exactly one saved outfit just wears it (the common case in your own bedroom);
// with several, it lists them rather than guessing which look you meant.
async function cmdDress(args, raw, player, broadcast) {
  const name = args.join(' ').trim();
  const wardrobe = await resolveWardrobe(player, null);
  if (wardrobe === 'ambiguous') return { type: 'error', message: 'There is more than one wardrobe here — open the one you mean.' };
  if (!wardrobe) return { type: 'error', message: "There's no wardrobe here to dress from." };
  if (!name) {
    const rows = await loadOutfits(player.id, wardrobe.id);
    if (rows.length === 1) {
      const res = await wearOutfit(player, wardrobe.id, rows[0].name, broadcast);
      return { type: res.ok ? 'output' : 'error', message: res.message, refresh: !!res.ok };
    }
    return listOutfits(player, wardrobe);
  }
  const res = await wearOutfit(player, wardrobe.id, name, broadcast);
  return { type: res.ok ? 'output' : 'error', message: res.message, refresh: !!res.ok };
}

// `undress [wardrobe]` — overrides the engine builtin (plugins beat builtins, see
// docs/plugins.md). With no argument this is the ordinary strip-to-your-pack and is
// delegated straight back to the engine, so the plain verb is untouched for every
// player who never stands at a wardrobe.
async function cmdUndressHere(args, raw, player, broadcast) {
  const target = args.join(' ').trim();
  if (!target) return cmdUndress(player, broadcast);
  const wardrobe = await resolveWardrobe(player, target);
  if (wardrobe === 'ambiguous') return { type: 'error', message: 'Which wardrobe? Try "undress <name>".' };
  // Not a wardrobe by that name — fall back to the plain strip rather than erroring
  // out on someone who typed `undress quickly` or similar.
  if (!wardrobe) return cmdUndress(player, broadcast);
  const res = await undressInto(player, wardrobe, broadcast);
  return { type: res.ok ? 'output' : 'error', message: res.message, refresh: !!res.ok };
}

// Panel verb: the Undress button inside an open wardrobe, answering with the view.
async function cmdUndressId(args, raw, player, broadcast) {
  const furnId = args[0];
  const wardrobe = furnId && await loadWardrobeById(player, furnId);
  if (!wardrobe) return { type: 'container_error', message: 'Wardrobe not found.' };
  const res = await undressInto(player, wardrobe, broadcast);
  return viewWith(player, furnId, res.message);
}

export const specializedActions = [
  { verb: 'outfits', requiredTag: 'wardrobe', handler: cmdOutfits },
];

export const commands = {
  outfit: cmdOutfit,
  dress: cmdDress,
  undress: cmdUndressHere,
  undressid: cmdUndressId,
  outfitsetid: cmdOutfitSetId,
  outfitwearid: cmdOutfitWearId,
  outfitdelid: cmdOutfitDelId,
};

export const hooks = {
  'container.view': decorateView,
  'furniture.describe': onFurnitureDescribe,
};

// Exposed for the regression harness.
export const _test = { OUTFIT_SLOTS, resolveWardrobe, describeOutfit, decorateView, saveOutfit, wearOutfit, onFurnitureDescribe, taught, F_TAUGHT, loadEquipped, undressInto, cmdDress, cmdUndressHere };

console.log('[wardrobe] Plugin loaded.');
