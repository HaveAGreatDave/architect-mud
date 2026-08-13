/**
 * Augment state — the catalog cache, the per-player roster, and every derived
 * number read off it.
 *
 * THIS FILE IS THE ONLY WRITER OF `player_augments`. Same funnel rule as
 * server/engine/mutations.js, and for the same reason: the moment two files can
 * write a roster, the in-memory copy and the row drift and nobody can tell which
 * one is lying.
 *
 * RULES
 *
 *   1. STATS ARE DERIVED, NEVER BAKED. This system used to run
 *      `UPDATE players SET stat_brawn = stat_brawn + n` on install. That is the
 *      pattern mutations.js was rewritten away from: a bad crash between the row
 *      write and the stat write leaves a character permanently wrong, and once
 *      calibration and condition scale the contribution there is no honest number
 *      to bake at all. `augmentStatBonus` is summed into `effectiveStat` through
 *      the registered contributor seam and the stored column is never touched.
 *
 *   2. READS ARE SYNCHRONOUS BY CONTRACT. The roster is hydrated once at login
 *      into `player._augments` and read from memory thereafter. `getAugments`,
 *      `augmentStatBonus`, `augmentSoak` and `augScale` never await and never
 *      query — the armour recompute and the strain path both call them.
 *
 *   3. HEAT IS NEVER PERSISTED, AND THAT IS NOT A BUG. Heat is a minutes-scale
 *      session phenomenon; a logout cooling you off is correct. What survives a
 *      session is the CONDITION the heat burned, which is durable and flushed
 *      coalesced on the existing 1m cadence. Do not "fix" this by adding a column.
 *
 *   4. A DEAD AUGMENT IS NOT A DESTROYED ONE. durability.js destroys an item at
 *      zero condition; installed chrome must not vanish out of a torso. At zero
 *      it contributes nothing and waits for a surgeon.
 */
import { query } from '../../server/models/db.js';
import { conditionBand } from '../../server/engine/durability.js';
import { subsystemDown } from '../../server/engine/nullcraft.js';

// ── Nullcraft suppression ────────────────────────────────────────────────────
// These live here rather than in nulltarget.js so the dependency runs one way:
// state.js is imported by everything and imports nothing of the plugin's own.
// They also belong beside getAugments, which is the funnel that reads them.

/** The Null target-key namespace for a piece of installed chrome. */
export const augmentKey = (playerId, augmentId) => `augment:${playerId}:${augmentId}`;

/**
 * Subsystems whose loss takes the whole augment offline.
 *
 * Telemetry is deliberately NOT one of them: killing a telemetry stream blinds
 * the OWNER to their own hardware, it does not stop the hardware working.
 * Collapsing that distinction would make every Null operation the same
 * operation, which is the thing the six-op vocabulary exists to prevent.
 */
export const VITAL = new Set(['power', 'control', 'actuation', 'processing']);

/**
 * Is this augment currently suppressed by a Null operation?
 *
 * SYNC BY CONTRACT — sits under the stat and soak paths via getAugments.
 * Reads RAM timestamps in the nullcraft substrate; never queries.
 */
export function nullAugmentDown(playerId, augmentId) {
  const key = augmentKey(playerId, augmentId);
  for (const sub of VITAL) if (subsystemDown(key, sub)) return true;
  return false;
}

// Slot capacity per body region — caps force real builds over stacking.
export const SLOT_CAPS = { neural: 2, eyes: 1, torso: 2, arms: 1, legs: 1 };

// A botched install is a permanent ceiling on how well the thing can ever be
// tuned. It is the one outcome you cannot buy your way out of afterwards.
export const BOTCHED_CALIBRATION_CAP = 50;

let AUGMENT_CACHE = null;

export async function loadAugments() {
  const { rows } = await query('SELECT * FROM augments');
  const cache = {};
  for (const a of rows) {
    cache[a.id] = a;
    // The inverse of mutation-effects.js's unconsumed-key warning: an augment
    // that can be pushed past spec must be able to say what happens when it
    // lets go. A generic "malfunction" line is the failure this guards against.
    if (Number(a.overclock_max) > 0 && !Object.keys(a.failure_messages || {}).length) {
      console.warn(`[augments] ${a.id} is overclockable but authors no failure_messages — it will fail silently.`);
    }
  }
  AUGMENT_CACHE = cache;
  return cache;
}

export async function catalog() {
  if (!AUGMENT_CACHE) await loadAugments();
  return AUGMENT_CACHE;
}

/** Sync catalog read. Only safe after boot; used by the hot-path helpers. */
export function catalogSync() { return AUGMENT_CACHE || {}; }

export function findAugment(cache, needle) {
  const q = String(needle || '').toLowerCase();
  if (!q) return null;
  const all = Object.values(cache || {});
  return all.find(a => a.id.toLowerCase() === q)
      || all.find(a => a.name.toLowerCase() === q)
      || all.find(a => a.name.toLowerCase().includes(q))
      || null;
}

// --- hydration -------------------------------------------------------------

/**
 * Login hydration. One query per player, once, and every read after this is
 * memory. Mirrors hydrateMutations.
 */
export async function hydrateAugments(player) {
  if (!player?.id) return;
  await catalog();
  const { rows } = await query(
    `SELECT augment_id, slot, condition, calibration, install_quality, overclock_level, custom_data, installed_at
       FROM player_augments WHERE player_id = $1`,
    [player.id]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(r.augment_id, {
      augment_id: r.augment_id,
      slot: r.slot,
      condition: r.condition == null ? 1 : Number(r.condition),
      calibration: r.calibration == null ? 100 : Number(r.calibration),
      install_quality: r.install_quality || 'sound',
      overclock_level: Number(r.overclock_level) || 0,
      custom_data: r.custom_data || {},
      installed_at: Number(r.installed_at) || 0,
    });
  }
  player._augments = map;
  player._augmentsDirty = new Set();
  player._augHeat = new Map();       // augment_id -> { heat, at }  (memory only)
  player._augWearPending = new Map();// augment_id -> condition delta, flushed 1m
  return map;
}

/** The roster, sync. Returns an empty Map for an unhydrated player. */
export function rosterOf(player) {
  return player?._augments instanceof Map ? player._augments : new Map();
}

export function markDirty(player, augmentId) {
  if (!player) return;
  if (!(player._augmentsDirty instanceof Set)) player._augmentsDirty = new Set();
  player._augmentsDirty.add(augmentId);
}

// --- derived reads (SYNC BY CONTRACT) --------------------------------------

/**
 * The scalar every contribution passes through. Three independent factors, each
 * one a thing the player can act on:
 *
 *   calibration — how well it is tuned. 100 reproduces the authored value
 *     exactly (the migration invariant); 0 still gives you half, because chrome
 *     that does nothing at all until you play a minigame is a tax, not a system.
 *   overclock   — what you chose to risk. Output above spec, paid for in heat.
 *   condition   — how beaten up it is, in the SAME currency as a coat, reusing
 *     durability's own band penalty so "Battered" reads identically everywhere.
 */
export function augScale(rec) {
  if (!rec) return 0;
  const cond = Math.max(0, Math.min(1, Number(rec.condition ?? 1)));
  if (cond <= 0) return 0;                       // dead: installed, inert, repairable
  const cal = Math.max(0, Math.min(100, Number(rec.calibration ?? 100)));
  const oc = Math.max(0, Number(rec.overclock_level) || 0);
  const band = conditionBand(cond);
  return (0.5 + 0.5 * (cal / 100)) * (1 + 0.25 * oc) * (band?.penalty ?? 1);
}

/** True while an EMP has chrome knocked out. Memory-only, set by the weather plugin. */
export function chromeDown(player) {
  return !!player?._augFriedUntil && Date.now() < player._augFriedUntil;
}

/**
 * Installed augments as [{ rec, aug }], newest authored data joined in.
 *
 * ── The Nullcraft filter ────────────────────────────────────────────────────
 * Chrome whose control, power or actuation has been suppressed by a Null
 * operation drops out here, which is the same shape `chromeDown` already uses
 * for an EMP: one predicate, applied at the single funnel, so stats, soak and
 * every other derived read inherit it without a second implementation.
 *
 * Deliberately in getAugments rather than in augScale — augScale receives only a
 * record and has no idea whose body it is in, and threading a player through it
 * would touch every call site to express something none of them care about.
 *
 * Sync by contract: nullAugmentDown reads RAM timestamps, never the database.
 */
export function getAugments(player) {
  const cache = catalogSync();
  const out = [];
  for (const rec of rosterOf(player).values()) {
    const aug = cache[rec.augment_id];
    if (!aug) continue;
    if (player?.id && nullAugmentDown(player.id, rec.augment_id)) continue;
    out.push({ rec, aug });
  }
  return out;
}

export function hasAugment(player, augmentId) {
  return rosterOf(player).has(augmentId);
}

export function recordOf(player, augmentId) {
  return rosterOf(player).get(augmentId) || null;
}

/**
 * The registered stat contributor. Scaled and rounded ONCE at the end so a pair
 * of half-points is not silently thrown away.
 */
export function augmentStatBonus(player, stat) {
  if (!player || chromeDown(player)) return 0;
  let total = 0;
  for (const { rec, aug } of getAugments(player)) {
    const mod = Number(aug.stat_modifiers?.[stat]);
    if (!mod) continue;
    total += mod * augScale(rec);
  }
  return Math.round(total);
}

/** Effective condition including wear accrued this minute but not yet flushed. */
export function effectiveAugCondition(player, augmentId) {
  const rec = recordOf(player, augmentId);
  if (!rec) return 0;
  const pending = Number(player?._augWearPending?.get(augmentId)) || 0;
  return Math.max(0, Math.min(1, Number(rec.condition ?? 1) - pending));
}

// --- persistence -----------------------------------------------------------

/**
 * Write one record through immediately.
 *
 * TWO PERSISTENCE PATHS, and the split is deliberate. A DELIBERATE ACT — tuning,
 * setting an overclock, a repair — writes through here and now, because the
 * player just chose it and a crash between the choice and the next tick must not
 * eat it. ACCRUED damage — heat wear, a fault fired from the sync strain path —
 * cannot await at its call site and rides the coalesced 1m flush instead.
 *
 * That is also why there is no logout flush: everything a player DID is already
 * on disk, and the at-most-60s of accrued wear that a logout drops is the same
 * heat that logging out was going to cool off anyway.
 */
export async function persistRec(player, augmentId) {
  const rec = rosterOf(player).get(augmentId);
  if (!rec || !player?.id) return;
  player._augmentsDirty?.delete(augmentId);
  await query(
    `UPDATE player_augments
        SET condition = $1, calibration = $2, install_quality = $3,
            overclock_level = $4, custom_data = $5
      WHERE player_id = $6 AND augment_id = $7`,
    [rec.condition, Math.round(rec.calibration), rec.install_quality,
     rec.overclock_level, JSON.stringify(rec.custom_data || {}), player.id, augmentId]
  );
}

/**
 * Flush dirty rosters. Coalesced: one UPDATE per changed augment, and nothing at
 * all for the overwhelmingly common case of a player whose chrome did not change.
 * Pending wear is folded in here rather than written per strain event.
 */
export async function flushAugments(player) {
  if (!player?.id) return;
  const pending = player._augWearPending;
  if (pending instanceof Map && pending.size) {
    for (const [id, delta] of pending) {
      const rec = rosterOf(player).get(id);
      if (!rec) continue;
      rec.condition = Math.max(0, Math.min(1, Number(rec.condition ?? 1) - Number(delta || 0)));
      markDirty(player, id);
    }
    pending.clear();
  }
  const dirty = player._augmentsDirty;
  if (!(dirty instanceof Set) || !dirty.size) return;
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const rec = rosterOf(player).get(id);
    if (!rec) continue;   // removed rows are DELETEd by install.js, not flushed here
    try {
      await query(
        `UPDATE player_augments
            SET condition = $1, calibration = $2, install_quality = $3,
                overclock_level = $4, custom_data = $5
          WHERE player_id = $6 AND augment_id = $7`,
        [rec.condition, Math.round(rec.calibration), rec.install_quality,
         rec.overclock_level, JSON.stringify(rec.custom_data || {}), player.id, id]
      );
    } catch (e) {
      // Put it back — a lost flush must retry, not silently drop the damage.
      markDirty(player, id);
      console.warn('[augments] flush failed for', id, e.message);
    }
  }
}
