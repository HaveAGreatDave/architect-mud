/**
 * NULLCRAFT — the substrate under the Null's technological discipline.
 *
 * The Wildblood become something else (mutations). The Ascendants build something
 * better (bionics). The Long Watch master themselves (skills). The Null make the
 * machine go silent, and this is the seam that lets them.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────────
 *
 * NULLCRAFT NEVER INVENTS A SECOND COPY OF STATE THAT ALREADY EXISTS.
 *
 * That is not a style preference, it is the entire reason this was built as a
 * substrate rather than as a plugin with its own tables. When this was scoped, a
 * surprising amount of it was already shipping — camera-scoped, and scattered:
 *
 *   - `security_devices.status_flags` has held { jammed, spoofed, hijacked_by,
 *     looping, blinded } since the surveillance plugin was written. Five of the
 *     six operations in nullcraft-ops.js already had a persisted vocabulary.
 *   - `getInterferenceZones()` already computed zone-level jamming and spoofing,
 *     with a cache, a jam-beats-spoof precedence and a relay counter-measure.
 *   - `cameraLiveInZone` / `isWitnessed` already gated the WANTED system on it, so
 *     jamming a zone already defeated the law.
 *   - `hack-gear.js` was already the single funnel for intrusion hardware.
 *
 * So the correct move was never to write a NullService that re-implements
 * jamming. It was to promote the model and widen the target set. Everything here
 * is built to make the second implementation impossible: a Null-jammed camera and
 * a jammer-furniture-jammed camera must be indistinguishable to every reader
 * downstream, and plugins/nullcraft/regress.js asserts exactly that.
 *
 * ── Read tier ────────────────────────────────────────────────────────────────
 *
 * The accessors in the first section are SYNC BY CONTRACT — no awaits, no
 * queries. They are called from notice rolls, witness checks and combat-adjacent
 * paths, which are hot. This is the `relations.js` / `hygieneOf` contract and it
 * must not be relaxed: if one of these ever needs to await, the caller is wrong,
 * not this file.
 *
 * ── Persistence tier ─────────────────────────────────────────────────────────
 *
 * Trace, heat, and every transient operation live in module-scope Maps and are
 * DECAYED AT READ against a timestamp. Nothing ticks and nothing is written.
 * A logout drops them, which is correct and matches how `wantedRuntime` treats
 * pursuit — the machine forgets you were poking it, eventually, on its own.
 *
 * Only durable consequences reach the database, and they reach it through the
 * contributor's own writer (an augment's condition, a device's status_flags),
 * never through a table owned here. THIS FILE OWNS NO TABLE. That is deliberate
 * and is the main thing to preserve.
 */
import { gatherHook } from './plugins.js';
import { getNullOperation, operationApplies } from './nullcraft-ops.js';
import { effectiveSkill, skillCheck } from './skills.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
//
// Trace is the "how long do I stay inside this system" clock of spec §11. It
// climbs on every operation and every failure, and bleeds off on its own. The
// half-life is deliberately short in real terms — a couple of minutes — because
// trace is a TACTICAL pressure, not a punishment that follows you around. A Null
// who walks away and waits should be clean; a Null who keeps working should not.
export const TRACE_HALFLIFE_MS = 120_000;
export const TRACE_ALERT = 60;     // owner is told something touched their gear
export const TRACE_LOCKOUT = 100;  // the interface closes; no more operations

// Heat is the player's own electronic conspicuousness — jammers running, decks
// hot, operations in flight. It feeds detection, and it is what makes an
// always-on jammer a real cost rather than a free upgrade.
export const HEAT_HALFLIFE_MS = 90_000;

// playerId -> { trace, heat, at }
const playerState = new Map();
// targetKey -> { ops: Map<subsystemId, { op, until, by }>, trace, at }
const targetState = new Map();
// playerId -> { until, strength }  — the veil window (spec §12)
const veils = new Map();
// playerId -> { until, strength, radius, selective, zoneId } — carried jammers
const carriedJammers = new Map();

const now = () => Date.now();

// Exponential decay to a timestamp. The whole persistence story of this file.
function decayed(value, at, halfLife) {
  if (!(value > 0)) return 0;
  const elapsed = now() - (at || 0);
  if (elapsed <= 0) return value;
  return value * Math.pow(0.5, elapsed / halfLife);
}

// ── Sync accessors (no awaits, no queries — see the header) ──────────────────

/** A player's decayed trace and heat. Never throws; an unknown player is clean. */
export function nullState(playerId) {
  const s = playerState.get(playerId);
  if (!s) return { trace: 0, heat: 0 };
  return {
    trace: decayed(s.trace, s.at, TRACE_HALFLIFE_MS),
    heat: decayed(s.heat, s.at, HEAT_HALFLIFE_MS),
  };
}

export function traceOf(playerId) { return nullState(playerId).trace; }
export function heatOf(playerId) { return nullState(playerId).heat; }

/**
 * Add trace and heat. Both decay first, so time away is never retroactively
 * cancelled by one more action — the same ordering `adjustReputation` uses, and
 * for the same reason: a stale value resurrected by a fresh delta is a bug that
 * only shows up in players who took a break.
 */
export function addTrace(playerId, trace = 0, heat = 0) {
  const cur = nullState(playerId);
  playerState.set(playerId, {
    trace: Math.max(0, cur.trace + trace),
    heat: Math.max(0, cur.heat + heat),
    at: now(),
  });
  return playerState.get(playerId).trace;
}

export function clearTrace(playerId) { playerState.delete(playerId); }

/** Live transient operations against one target, expired entries dropped. */
export function intrusionState(targetKey) {
  const s = targetState.get(targetKey);
  if (!s) return { ops: new Map(), trace: 0 };
  const t = now();
  for (const [sub, entry] of s.ops) if (entry.until <= t) s.ops.delete(sub);
  return { ops: s.ops, trace: decayed(s.trace, s.at, TRACE_HALFLIFE_MS) };
}

/**
 * Is this subsystem currently suppressed?
 *
 * SYNC BY CONTRACT — combat, movement and notice paths call this. Returns the
 * operation id ('lock', 'crash', …) rather than a boolean, because the caller
 * almost always wants to say WHICH failure the owner is experiencing, and a
 * boolean would send every caller back here for a second lookup.
 */
export function subsystemDown(targetKey, subsystemId) {
  const s = targetState.get(targetKey);
  if (!s) return null;
  const entry = s.ops.get(subsystemId);
  if (!entry) return null;
  if (entry.until <= now()) { s.ops.delete(subsystemId); return null; }
  return entry.op;
}

/** Suppress a subsystem for a while. Transient only — durable ops write elsewhere. */
export function suppressSubsystem(targetKey, subsystemId, op, durationMs, by = null) {
  let s = targetState.get(targetKey);
  if (!s) { s = { ops: new Map(), trace: 0, at: now() }; targetState.set(targetKey, s); }
  const until = now() + durationMs;
  const existing = s.ops.get(subsystemId);
  // Refresh takes the LATER expiry, matching applyEffect's Math.max rule — a
  // second jam on top of a running one extends it rather than cutting it short.
  s.ops.set(subsystemId, { op, until: Math.max(until, existing?.until || 0), by });
  return until;
}

export function releaseSubsystem(targetKey, subsystemId) {
  targetState.get(targetKey)?.ops.delete(subsystemId);
}

/**
 * How strongly the air is being jammed in this zone by CARRIED Null hardware.
 *
 * This is deliberately only the carried half. `getInterferenceZones()` in the
 * surveillance plugin remains the sole owner of the PLANTED half — it already
 * handles device power, relays and precedence, and duplicating any of that here
 * would be the exact second implementation this file exists to prevent. The two
 * are merged by the surveillance plugin, which reads this. One direction only.
 */
export function carriedJamAt(zoneId) {
  let best = 0;
  const t = now();
  for (const j of carriedJammers.values()) {
    if (j.until <= t) continue;
    if (j.zoneId !== zoneId) continue;
    if (j.selective) continue;   // selective gear targets a signal, not a room
    if (j.strength > best) best = j.strength;
  }
  return best;
}

export function setCarriedJammer(playerId, { zoneId, strength, radius = 0, selective = false, durationMs }) {
  carriedJammers.set(playerId, { zoneId, strength, radius, selective, until: now() + durationMs });
}
export function stopCarriedJammer(playerId) { carriedJammers.delete(playerId); }
export function jammerOf(playerId) {
  const j = carriedJammers.get(playerId);
  return j && j.until > now() ? j : null;
}

/**
 * 0..1 — how much of this player's electronic signature is hidden right now.
 *
 * SYNC BY CONTRACT: the surveillance witness roll reads it. 0 means fully
 * visible, which is what an unknown player returns, so a caller that has never
 * heard of Nullcraft gets today's behaviour exactly.
 *
 * ⚠ This must never reach 1. Ghosting makes you hard to WITNESS; it must not make
 * you unarrestable. The jail system's whole downed-while-wanted path assumes the
 * law can still eventually win, and a player who cannot be seen by any camera
 * ever has left the game's consequence loop rather than outplayed it.
 */
export const VEIL_CAP = 0.85;

export function veilFactor(playerId) {
  const v = veils.get(playerId);
  if (!v || v.until <= now()) return 0;
  return Math.min(VEIL_CAP, v.strength);
}

export function setVeil(playerId, strength, durationMs) {
  veils.set(playerId, { strength: Math.min(VEIL_CAP, strength), until: now() + durationMs });
}
export function clearVeil(playerId) { veils.delete(playerId); }

/** Drop every scrap of runtime state for a player. Called on logout. */
export function forgetPlayer(playerId) {
  playerState.delete(playerId);
  veils.delete(playerId);
  carriedJammers.delete(playerId);
}

// ── Targets ──────────────────────────────────────────────────────────────────

/**
 * Everything technological the player could point Nullcraft at right now.
 *
 * The substrate knows nothing about augments, cameras, drones or aircraft. Each
 * owning plugin contributes its own targets through the `tech.targets` gather
 * hook — the `workspace.provider` seam, which has already been proven twice
 * (cooking's kitchen and synthesis's chembench, the second added with no change
 * to the consumer at all).
 *
 * A contributor returns objects shaped:
 *
 *   { key, ownerId, ownerName, zoneId, name, kind,
 *     subsystems: [{ id, kind, exposure }],
 *     security:   { rating, encryption, wireless, auth },
 *     apply(op, subsystem, ctx) -> { message, ownerMessage? } }
 *
 * `apply` is the load-bearing field and the reason this design holds together:
 * the substrate rolls, traces and narrates, and the CONTRIBUTOR mutates its own
 * state. That is what keeps this file free of imports from augments, surveillance
 * and flight, and it is why a camera's `status_flags` stays the one truth about
 * whether a camera is jammed.
 */
export async function gatherTechTargets(player, ctx = {}) {
  const groups = await gatherHook('tech.targets', player, ctx);
  const out = [];
  for (const g of (groups || [])) {
    if (!g) continue;
    for (const t of (Array.isArray(g) ? g : [g])) {
      if (t && t.key && typeof t.apply === 'function') out.push(t);
    }
  }
  return out;
}

/** Find one target by a player-typed fragment. Name first, then key. */
export function matchTarget(targets, fragment) {
  if (!fragment) return null;
  const f = fragment.toLowerCase().trim();
  return targets.find(t => t.name.toLowerCase() === f)
      || targets.find(t => t.name.toLowerCase().includes(f))
      || targets.find(t => t.key.toLowerCase().includes(f))
      || null;
}

/**
 * Effective difficulty of an operation against a subsystem.
 *
 * Composed rather than authored: the operation's own base, the target's security
 * rating, and how exposed that particular subsystem is. Exposure SUBTRACTS,
 * which is what makes reconnaissance worth doing — §8 of the brief is explicit
 * that the interesting decision is "don't attack the arm, attack its cooling",
 * and that decision only exists if subsystems differ in difficulty.
 */
export function operationDifficulty(target, subsystem, opId) {
  const op = getNullOperation(opId);
  if (!op) return 99;
  const security = Number(target?.security?.rating) || 0;
  const exposure = Number(subsystem?.exposure) || 0;
  return Math.max(1, op.baseDifficulty + (security / 10) - (exposure / 20));
}

/** Can this operation be pointed at this subsystem at all? Returns a reason, or null. */
export function operationRefusal(player, target, subsystem, opId) {
  const op = getNullOperation(opId);
  if (!op) return `There is no such operation.`;
  if (!subsystem) return `You would have to name a subsystem.`;
  if (!operationApplies(opId, subsystem.kind)) {
    return `You can't ${op.label.toLowerCase()} ${subsystem.label || subsystem.id} — there's nothing there that works that way.`;
  }
  // The manual-override counterplay (spec §21): an owner who disconnects the
  // radio takes a penalty elsewhere and becomes unreachable through the network
  // layer. This is the line that stops Nullcraft invalidating expensive gear.
  if (subsystem.kind === 'network' && target.security?.wireless === false) {
    return `${target.name} has no radio to reach. Somebody hardened it on purpose.`;
  }
  return null;
}

/**
 * Run the check behind an operation.
 *
 * Kept separate from the minigame so the two rungs of the Display Mode ladder
 * that don't play a board still get an authoritative outcome from the same
 * numbers. Returns the raw check so callers can report margin to `awardSkillUse`
 * — remember its third argument is the MARGIN, not an amount.
 */
export async function operationCheck(player, target, subsystem, opId) {
  const difficulty = operationDifficulty(target, subsystem, opId);
  return skillCheck(player, 'nullcraft', difficulty);
}

export async function nullcraftLevel(player) {
  return effectiveSkill(player, 'nullcraft');
}
