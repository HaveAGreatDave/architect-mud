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

function decayMultiplier(tier, spoilRate) {
  return (TIER_FACTOR[tier] ?? TIER_FACTOR.ambient) * (SPOIL_RATE_FACTOR[spoilRate] ?? 1);
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

  let decayAmount;
  if (envNow.delivering || envNow.powerLostAt == null) {
    const tier = envNow.delivering ? envNow.tier : envNow.ambientTier;
    decayAmount = hoursOf(elapsedMs) * BASE_DECAY_PER_HOUR * decayMultiplier(tier, spoilRate);
  } else {
    const bufferMs = (POWER_LOSS_BUFFER_MIN[envNow.tier] || 0) * 60000;
    const sinceLossMs = Math.max(0, nowMs - envNow.powerLostAt);
    const preLossMs = Math.max(0, elapsedMs - sinceLossMs); // portion of this span before the loss began
    const bufferedMs = Math.min(sinceLossMs, bufferMs);
    const overBufferMs = Math.max(0, sinceLossMs - bufferMs);
    decayAmount =
      hoursOf(preLossMs + bufferedMs) * BASE_DECAY_PER_HOUR * decayMultiplier(envNow.tier, spoilRate) +
      hoursOf(overBufferMs) * BASE_DECAY_PER_HOUR * decayMultiplier(envNow.ambientTier, spoilRate);
  }

  return {
    value: Math.max(0, freshness.value - decayAmount),
    checkpointAt: nowMs,
    envBucket: envNow.tier,
    powerLostAt: envNow.powerLostAt,
  };
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
  // First touch: seed envBucket from the environment resolved just above, not
  // a hardcoded guess — otherwise a same-instant second call would see the
  // real tier "change" from the guess and rewrite for no real reason.
  const freshness = cd.freshness || { value: 100, checkpointAt: nowMs, envBucket: envNow.tier, powerLostAt: null };
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
