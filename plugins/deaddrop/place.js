// ── The player-placed cache (proposal §8b) ───────────────────────────────────
//
// Phases 0–2 are AUTHORED caches, and their worst failure is a quest item going
// missing. This is the phase where `search` becomes a way to take another
// player's property, so the three decisions behind it are worth restating here
// rather than left in a doc nobody opens.
//
// **A cache is bought, carried and deployed.** You buy a stash box — an ordinary
// item — and `deploy` mints the furniture row; `recover` takes it back up. So
// placement is limited by what you paid for, and the world gains no cache nobody
// bought. The rejected alternative, *any existing container in a public room*,
// needs no content at all and is exactly why it fails: every bin and locker in
// Coldwater becomes potentially somebody's stash, which makes sweeping every room
// in the city worth doing, forever.
//
// **Taking somebody else's cache is not a crime — finders keepers.** No wanted
// stars, no witness check, no ownership test at `open`. A found cache is simply
// lost, which is the tone this game is written in.
//
// ⚠ **Which is what makes the concealment tiers load-bearing.** With no legal
// defence, the only two things between a stocked cache and a sweeper are
// `STRANGER_BAR` and the keypad. The one-row box below is the DISPOSABLE tier —
// for a handoff measured in minutes, where losing one should feel like weather.
//
// The tempting fourth rule is "nominate a recipient", so only your courier can
// open it. Deliberately not built: it turns a dead drop into a mailbox, and the
// reason to use one is precisely that the world can get at it and mostly doesn't.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { insertFurniture, deleteFurniture, getZoneFurniture, getFurnitureById } from '../../server/engine/world.js';
import { tagValue } from '../../server/engine/tags.js';

const DEFAULT_CAPACITY = 4000;          // grams, if the item authors none

// One rent cycle, the same number `zone-filth.js` sweeps stains on and for the
// same reason — a thing you stopped looking after stops being yours. Deliberately
// a local constant rather than an import: they are the same duration because of
// what they mean, not because they share a definition.
export const CACHE_KEEP_DAYS = 7;

const isPlacedCache = (f) => !!f?.flags?.dead_drop_placed;

// ── deploy ───────────────────────────────────────────────────────────────────
// Tag-gated on the carried box, the way `plugins/generator` gates its own
// `deploy` on `portable_generator` — two plugins can register one verb when the
// GATE differs, which is how `use` already belongs to both the ATM and the TV.
export async function deployCache(args, raw, player, broadcast) {
  const hint = args.join(' ').trim();
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.quantity, i.id AS item_id, i.name, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL AND jsonb_exists(i.tags, 'stash_box')
        AND ($2 = '' OR i.name ILIKE $3)
      ORDER BY i.name LIMIT 1`,
    [player.id, hint, `%${hint}%`]
  );
  if (!rows.length) {
    return { type: 'error', message: `You aren't carrying a stash box${hint ? ` matching "${hint}"` : ''}.` };
  }
  const row = rows[0];

  // ⚠ ONE CACHE PER ROOM. Two concealed boxes in one room is a room where the
  // `search` provider can only ever report the first, so the second is invisible
  // forever — and stacking them would be the obvious way to defeat a sweeper.
  if (getZoneFurniture(player.current_zone).some(isPlacedCache)) {
    return { type: 'error', message: 'There is already a stash box tucked away in this room. Two would only draw the eye.' };
  }

  const cfg = tagValue(row, 'stash_box', {}) || {};
  const capacity = Number(cfg.capacity) || DEFAULT_CAPACITY;

  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.inv_id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);

  const id = `ddrop_${randomUUID()}`;
  await insertFurniture({
    id,
    zone_id: player.current_zone,
    name: row.name,
    description: 'A flat steel case, matte and unbranded, sitting where nothing about the room suggests a case should be.',
    // ⚠ `object_type` must be 'container' or `cmdOpenContainer` will not resolve
    // it, and `flags.container` must ALSO be set or `plugins/container` will not
    // open it. They are two different questions and a cache needs both answered.
    object_type: 'container',
    flags: JSON.stringify({
      container: capacity,
      concealed: true,          // the room description refuses to mention it
      dead_drop: true,          // findable AS A CACHE (plugins/deaddrop)
      dead_drop_placed: true,   // a player put it here, so it can be taken up again
      placed_day: currentDay(),
      aliases: 'stash box, box, case, stash',
    }),
    // Keeps it out of `content:export` — a player's box is runtime property, not
    // world content, exactly as a planted generator is.
    origin: 'player',
    owner_id: player.id,
  });

  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} crouches, does something brief and unremarkable, and stands up again.`, refresh: true }, player.id);
  return { type: 'use', message: `You tuck the ${row.name} out of sight. Nothing about the room says it is there.` };
}

// ── recover ──────────────────────────────────────────────────────────────────
// ⚠ EMPTY ONLY, AND ANYONE MAY DO IT. Ownership is not tested, because the whole
// feature rests on finders keepers — but a LOADED box cannot be picked up, so a
// thief has to open it and take the contents out one at a time through the path
// that already exists. Without that rule `recover` is a one-word way to walk off
// with a stranger's entire cache, which skips every interesting part of it,
// including the disturbance mark the owner would otherwise read.
export async function recoverCache(args, raw, player, broadcast) {
  const hint = args.join(' ').trim().toLowerCase();
  const here = getZoneFurniture(player.current_zone).filter(isPlacedCache);
  if (!here.length) return undefined;   // nothing of ours here — let another handler try
  const cache = hint
    ? here.find((f) => String(f.name).toLowerCase().includes(hint) || String(f.flags?.aliases || '').toLowerCase().includes(hint)) || here[0]
    : here[0];

  const { rows } = await query('SELECT count(*)::int AS n FROM player_inventory WHERE container_id=$1', [cache.id]);
  if (rows[0].n > 0) {
    return { type: 'error', message: `The ${cache.name} still has something in it. Empty it before you lift it.` };
  }

  await deleteFurniture(cache.id);
  const itemId = 'item_stash_box';
  await query(
    `INSERT INTO player_inventory (player_id, item_id, quantity) VALUES ($1,$2,1)`,
    [player.id, itemId]
  );
  broadcast?.(player.current_zone, { type: 'zone_event', message: `${player.handle} crouches for a moment and pockets something.`, refresh: true }, player.id);
  return { type: 'use', message: `You work the ${cache.name} free and pocket it.` };
}

// ── Going stale ──────────────────────────────────────────────────────────────
// An untouched cache is cleared a cycle later. Driven off `environment.dayRollover`
// — the same event rent and daily maintenance already ride — so there is NO REAPER
// TICK of its own, and a restart cannot reset everyone's clock because the age is a
// difference of two game dates rather than a timer that was running.
//
// This is what stops the map silting up with the boxes of players who stopped
// logging in. An EMPTY box is simply removed; a LOADED one is left alone, because
// deleting furniture with rows pointing into it orphans those rows forever and a
// forgotten cache with something in it is a better story than a vanished one.
export function currentDay() {
  // Whole in-game days since the epoch. A plain number, so "how old is this" is a
  // subtraction and never a parsed timestamp.
  return Math.floor(Date.now() / 86400000);
}

export async function sweepStaleCaches({ getZonesWithCaches } = {}) {
  const today = currentDay();
  const { rows } = await query(
    `SELECT id, name, zone_id, flags FROM furniture
      WHERE object_type='container' AND origin='player' AND flags->>'dead_drop_placed'='true'`
  ).catch(() => ({ rows: [] }));
  let cleared = 0;
  for (const f of rows) {
    const placed = Number(f.flags?.placed_day);
    if (!Number.isFinite(placed) || today - placed < CACHE_KEEP_DAYS) continue;
    const { rows: held } = await query('SELECT count(*)::int AS n FROM player_inventory WHERE container_id=$1', [f.id]);
    if (held[0].n > 0) continue;        // something is in it — leave it be
    await deleteFurniture(f.id);
    cleared++;
  }
  return cleared;
}

export const _test = { isPlacedCache, currentDay, CACHE_KEEP_DAYS, sweepStaleCaches, deployCache, recoverCache };
