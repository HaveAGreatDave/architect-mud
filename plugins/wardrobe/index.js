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
  const rows = await loadOutfits(player.id, container.id);
  view.type = 'wardrobe_view';
  view.outfits = rows.map(r => describeOutfit(r, available));
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

export const specializedActions = [
  { verb: 'outfits', requiredTag: 'wardrobe', handler: cmdOutfits },
];

export const commands = {
  outfit: cmdOutfit,
  outfitsetid: cmdOutfitSetId,
  outfitwearid: cmdOutfitWearId,
  outfitdelid: cmdOutfitDelId,
};

export const hooks = {
  'container.view': decorateView,
  'furniture.describe': onFurnitureDescribe,
};

// Exposed for the regression harness.
export const _test = { OUTFIT_SLOTS, resolveWardrobe, describeOutfit, decorateView, saveOutfit, wearOutfit, onFurnitureDescribe, taught, F_TAUGHT };

console.log('[wardrobe] Plugin loaded.');
