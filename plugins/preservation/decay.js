// Freshness/preservation math — pure, timestamp-based, lazily evaluated.
// No tick anywhere in this module: every function either computes a value
// from elapsed time, or writes a checkpoint only when called (from an
// examine/eat/stow/pull call-out, never a periodic scan).
import { query } from '../../server/models/db.js';
import { hasTag, tagValue } from '../../server/engine/tags.js';
import { getZoneTemperature, getZonePowerStatus } from '../../server/engine/environment.js';
import { loadContainerById } from '../../server/engine/commands/inventory.js';
import { isPluggedIn } from '../appliances/index.js';
import {
  TEMP_BUCKETS, TIER_FACTOR, SPOIL_RATE_FACTOR, BASE_DECAY_PER_HOUR,
  POWER_LOSS_BUFFER_MIN, stateFor, WRITE_DIFF_THRESHOLD,
} from './config.js';

const HOUR_MS = 3600000;
const hoursOf = (ms) => ms / HOUR_MS;

function bucketForTemp(c) {
  for (const b of TEMP_BUCKETS) if (c <= b.max) return b.tier;
  return 'ambient';
}

function decayMultiplier(tier, spoilRate, additive = 1) {
  return (TIER_FACTOR[tier] ?? TIER_FACTOR.ambient) * (SPOIL_RATE_FACTOR[spoilRate] ?? 1) * additive;
}

// Resolve the preservation tier an inventory row sits in RIGHT NOW, and whether
// that tier is actually being delivered (vs. degraded — no power/unplugged).
// One-hop container resolution only: `stow` already forbids nesting a container
// inside a container, so there is never a second hop to walk.
export async function resolveEnvironment(invRow, player) {
  if (invRow.container_id) {
    const container = await loadContainerById(invRow.container_id, player);
    const preserves = container?.tags?.preserves;
    if (preserves) {
      const drawsPower = container.kind === 'furniture' && Number(container.power_draw_kw) > 0;
      if (!drawsPower) {
        // Portable / self-contained — a carried item-catalog container, or a
        // furniture instance with no grid draw (e.g. the Zenith Cryocell):
        // always delivers its rated tier, no plug/grid dependency.
        return { tier: preserves, delivering: true, ambientTier: 'ambient' };
      }
      const zoneId = player.current_zone;
      const gridUp = ['powered', 'overloaded'].includes(getZonePowerStatus(zoneId));
      const plugged = isPluggedIn({ flags: container.tags });
      return { tier: preserves, delivering: gridUp && plugged, ambientTier: bucketForTemp(getZoneTemperature(zoneId)) };
    }
    // Contained but not in a preservation environment (a duffel bag, a crate)
    // — falls through to ambient, below.
  }
  const tier = bucketForTemp(getZoneTemperature(player.current_zone));
  return { tier, delivering: true, ambientTier: tier };
}

// Pure function: integrate decay since the last checkpoint given the environment
// resolved for right now. If power/plug was lost partway through this span, the
// buffer window and the ambient-rate remainder are both closed-form time segments
// — no event is needed to detect the moment the buffer runs out.
export function computeCheckpoint(freshness, envNow, spoilRate, nowMs) {
  const elapsedMs = Math.max(0, nowMs - freshness.checkpointAt);
  if (elapsedMs <= 0) return { ...freshness };

  // An antioxidant dosed into the item itself (see preserve.js) is a multiplier
  // on the rate, never a refill of the value — a rancid pie stays rancid, and
  // BHT stacks with the fridge instead of replacing it.
  const additive = freshness.additive ?? 1;

  let decayAmount;
  if (envNow.delivering || envNow.powerLostAt == null) {
    const tier = envNow.delivering ? envNow.tier : envNow.ambientTier;
    decayAmount = hoursOf(elapsedMs) * BASE_DECAY_PER_HOUR * decayMultiplier(tier, spoilRate, additive);
  } else {
    const bufferMs = (POWER_LOSS_BUFFER_MIN[envNow.tier] || 0) * 60000;
    const sinceLossMs = Math.max(0, nowMs - envNow.powerLostAt);
    const preLossMs = Math.max(0, elapsedMs - sinceLossMs); // portion of this span before the loss began
    const bufferedMs = Math.min(sinceLossMs, bufferMs);
    const overBufferMs = Math.max(0, sinceLossMs - bufferMs);
    decayAmount =
      hoursOf(preLossMs + bufferedMs) * BASE_DECAY_PER_HOUR * decayMultiplier(envNow.tier, spoilRate, additive) +
      hoursOf(overBufferMs) * BASE_DECAY_PER_HOUR * decayMultiplier(envNow.ambientTier, spoilRate, additive);
  }

  return {
    value: Math.max(0, freshness.value - decayAmount),
    checkpointAt: nowMs,
    envBucket: envNow.tier,
    powerLostAt: envNow.powerLostAt,
    // Carried forward explicitly: every writer of this object replaces it whole,
    // so a dose left out here would be silently undone by the next checkpoint.
    ...(freshness.additive != null ? { additive: freshness.additive } : {}),
  };
}

// When this row came into being, in ms — the moment a perishable starts ageing.
//
// Without it the seed below stamped `checkpointAt: nowMs`, which started the
// clock at the first EXAMINE rather than at the mint: a steak nobody had ever
// looked at was immortal, and still read `fresh` after a month on an apartment
// floor. `player_inventory.created_at` is the engine's own record of when the
// row was inserted, defaulted in the DDL (server/models/schema.js), so all ~40
// mint sites — vendor deliveries, ground spawns, loot, butchering, the cooking
// plate — seed it for free and a new one cannot forget to. That is the whole
// reason it's a column and not a hook fired at each mint site.
//
// The SELECT runs only for a perishable with no checkpoint yet, which is once in
// an item's life, and is skipped entirely when the caller's own projection
// carried the column (resolveInventoryItem and cmdExamine both do). A row that
// predates the column reads NULL and falls back to now, so nothing already in
// somebody's pack starts rotting at deploy.
//
// Clock skew between the DB's now() and this process's Date.now() needs no guard:
// computeCheckpoint floors the elapsed span at 0, and this value is never itself
// stored — the checkpoint written back is always stamped nowMs.
async function mintedAtOf(invRow) {
  const own = invRow.created_at;
  if (own !== undefined) return own ? new Date(own).getTime() : null;
  const { rows } = await query('SELECT created_at FROM player_inventory WHERE id=$1', [invRow.id]);
  const at = rows[0]?.created_at;
  return at ? new Date(at).getTime() : null;
}

// A PURE "could this have gone off?" answer for a stack sitting in a container,
// with no row to read, nothing written and no DB touched. The delivery pass
// (server/engine/vendor.js) asks it once per stack straight from its own cache,
// so a fully-stocked shop still costs zero queries on the daily tick.
//
// It lives here because the decay curve lives here. The alternative was vendor.js
// growing its own copy of the arithmetic, and two implementations of spoilage is
// exactly the drift this system is built to avoid.
//
// Deliberately OPTIMISTIC: it assumes the case has had power for the whole span,
// so it can only ever UNDER-report. Nothing is deleted on this answer — it only
// decides whether the caller goes and asks the real per-row question, which runs
// ensureFreshnessCurrent like every other call site.
export function stockSpoilCheck({ mintedAt, preserves, zoneId, spoilRate } = {}) {
  if (!mintedAt) return { spoiled: false };
  const tier = preserves || bucketForTemp(getZoneTemperature(zoneId));
  const elapsed = Math.max(0, Date.now() - new Date(mintedAt).getTime());
  const drop = hoursOf(elapsed) * BASE_DECAY_PER_HOUR * decayMultiplier(tier, spoilRate || 'normal');
  return { spoiled: stateFor(Math.max(0, 100 - drop)) === 'spoiled' };
}

// The only function engine call-outs use. No-ops immediately for non-perishable
// items. Diff-gates the write — the guarantee against writing on every glance
// at an untouched item.
export async function ensureFreshnessCurrent(invRow, player) {
  if (!hasTag(invRow, 'perishable')) return null;
  const nowMs = Date.now();
  const cd = invRow.custom_data || {};
  const hadCheckpoint = !!cd.freshness;
  const envNow = await resolveEnvironment(invRow, player);
  // First touch: the clock starts at the MINT, not here — see mintedAtOf. Only
  // asked for when there's no checkpoint to read, so a stocked pantry costs
  // nothing. envBucket is still seeded from the environment resolved just above
  // rather than a hardcoded guess — otherwise a same-instant second call would
  // see the real tier "change" from the guess and rewrite for no real reason.
  const mintedAt = hadCheckpoint ? null : await mintedAtOf(invRow);
  const freshness = cd.freshness || { value: 100, checkpointAt: mintedAt ?? nowMs, envBucket: envNow.tier, powerLostAt: null };
  // Opportunistic power-loss detection: the first time anything notices this
  // container isn't delivering, stamp the moment as "now" (a small grace to the
  // player if nobody looked sooner — no polling tick exists to catch it earlier).
  if (!envNow.delivering && freshness.powerLostAt == null) freshness.powerLostAt = nowMs;
  envNow.powerLostAt = envNow.delivering ? null : freshness.powerLostAt;

  const spoilRate = tagValue(invRow, 'spoil_rate', 'normal');
  const updated = computeCheckpoint(freshness, envNow, spoilRate, nowMs);
  const state = stateFor(updated.value);

  const changed = !hadCheckpoint
    || Math.abs(updated.value - freshness.value) >= WRITE_DIFF_THRESHOLD
    || updated.envBucket !== freshness.envBucket
    || updated.powerLostAt !== freshness.powerLostAt;

  if (changed) {
    await query(
      `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || jsonb_build_object('freshness',$2::jsonb) WHERE id=$1`,
      [invRow.id, JSON.stringify(updated)]
    );
    invRow.custom_data = { ...cd, freshness: updated };
  }
  return { value: updated.value, state };
}
