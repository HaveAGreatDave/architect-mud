/**
 * Stealth — being unnoticed, as a substrate.
 *
 * NOT A NEW SIMULATION. Everything stealth needs already exists in this engine
 * and was built for other reasons; this module is the seam that makes them agree
 * on one question: *has that particular observer noticed you?*
 *
 *   posture.js      the `sneaking` state itself, and forceStand() already breaks
 *                   it on any attack, incoming hit or move — so you cannot sneak
 *                   your way out of a fight
 *   senses.js       acuitySync(observer, 'sight'|'hearing') — how well THIS being
 *                   perceives, already folding in stat, status effects and gear
 *   environment.js  getZoneVisibility() — a dark room is easier to cross
 *   impairment.js   being drunk or high makes you worse at sneaking AND worse at
 *                   noticing, from the same provider chain
 *   skills.js       deception vs the observer's perception; no new axis
 *
 * PER-OBSERVER, NOT GLOBAL. You are not "hidden"; you are unnoticed BY someone.
 * Two people in the same room roll separately, so the bartender can miss you
 * while the man in the corner does not — which is what makes a busy room
 * genuinely harder than an empty one, without a crowd modifier.
 *
 * SNEAKING IS ITSELF SUSPICIOUS. Failing the roll does not merely mean "seen" —
 * it means seen CREEPING, which is a different and worse thing to be caught
 * doing. The reaction is the caller's business (an NPC gets alarmed, an enemy
 * attacks), but the roll is the same one.
 *
 * Sync by contract: called from movement and from describe-adjacent paths.
 *
 * See docs/systems-stealth.md.
 */
import { acuitySync } from './senses.js';
import { getZoneVisibility } from './environment.js';
import { impairmentOf } from './impairment.js';
import { mutationNumber } from './mutations.js';
import { getPosture } from './posture.js';
import { emit } from './events.js';

const r8 = () => 1 + Math.floor(Math.random() * 8);

export const SNEAKING = 'sneaking';

/** Is this player actually sneaking right now? */
export function isSneaking(player) {
  return getPosture(player) === SNEAKING;
}

// Who has clocked whom. sneakerId -> Set(observerId). Absence means "not yet
// rolled against", which is NOT the same as unnoticed — callers roll on entry
// and on every move, so the set is only ever a record of failures.
const noticedBy = new Map();

export function clearNotices(sneakerId) { noticedBy.delete(sneakerId); }

/**
 * Should this viewer see this person at all?
 *
 * The single question every describe/broadcast path asks. It is the whole reason
 * the notice record exists: without a consumer, rolling to be unnoticed changed
 * nothing about what anybody saw.
 *
 * Cheap by construction — a posture read and one Set lookup, no query, no clone.
 */
export function isHiddenFrom(person, viewerId) {
  if (!person || !viewerId || person.id === viewerId) return false;
  return isSneaking(person) && !hasNoticed(person.id, viewerId);
}

export function hasNoticed(sneakerId, observerId) {
  return !!noticedBy.get(sneakerId)?.has(observerId);
}
function markNoticed(sneakerId, observerId) {
  if (!noticedBy.has(sneakerId)) noticedBy.set(sneakerId, new Set());
  noticedBy.get(sneakerId).add(observerId);
}

/**
 * How hard this player is to spot right now, as a difficulty an observer must
 * beat. Higher is better hidden.
 *
 * Deliberately made of things a player can SEE and act on — shoot the lights,
 * put the heavy coat down, sober up — rather than a hidden stealth stat.
 */
export function concealment(player, zoneId) {
  let score = 0;

  // Darkness is the big one, and it is the lever players already have: the
  // lighting system, the power grid and a shot-out bulb all feed this.
  const vis = getZoneVisibility(zoneId) || {};
  if (vis.category === 'pitch_dark') score += 6;
  else if (vis.category === 'dark') score += 4;
  else if (vis.category === 'dim') score += 2;

  // Your own state. Being wrecked makes you clumsy and loud — the same provider
  // chain that already slows your movement and costs you accuracy.
  const imp = impairmentOf(player) || {};
  score -= Math.round((imp.moveStaminaExtra || 0) / 2);

  // Your own senses help you sneak, not just notice: knowing how much noise you
  // are making is most of not making it.
  score += Math.floor(acuitySync(player, 'hearing') / 2);
  // Skin that changes to match what it is against. Stacks with the darkness and
  // the crouch already scored above rather than replacing the roll, so a
  // camouflaged body in a lit room is still findable and one in the dark is very
  // nearly not.
  score += mutationNumber(player, 'camouflage');
  // …and the other end of the same dial. A body that glows, clicks, reeks or
  // simply cannot be mistaken for anything else is worse at not being seen.
  // Both ends live on this one line so the reward and the cost can never drift
  // apart, the same reason hygiene keeps its pair together.
  score -= mutationNumber(player, 'stealth_penalty');

  return score;
}

/**
 * Roll one observer against one sneaker. Returns true if the observer NOTICES.
 *
 * Idempotent per pair while the sneak lasts: once somebody has clocked you they
 * stay clocked, so walking back and forth cannot re-roll a bad result into a
 * good one. Coming out of sneak clears the record.
 */
export function noticeRoll(observer, sneaker, zoneId) {
  if (!observer || !sneaker) return false;
  const observerId = observer.id || observer.instanceId;
  if (!observerId) return false;
  if (hasNoticed(sneaker.id, observerId)) return true;

  // An observer already out cold, asleep or otherwise absent notices nothing.
  // This is what makes a knocked-out guard genuinely out of the picture, and it
  // is why the two systems had to know about each other.
  if (observer._koUntil > Date.now() || observer.sleeping) return false;

  // Sight is the primary sense; hearing backs it up, which is why a blind-dark
  // room is not a free pass against something with good ears.
  const perception = Math.max(
    acuitySync(observer, 'sight'),
    Math.floor(acuitySync(observer, 'hearing') * 0.75),
  );
  const hidden = concealment(sneaker, zoneId);
  // 2d8-2d8 swing, the same contest shape the skill system uses everywhere else.
  const swing = (r8() + r8()) - (r8() + r8());
  const noticed = (perception + swing) > hidden;
  if (noticed) {
    markNoticed(sneaker.id, observerId);
    emit('stealth.noticed', { sneaker, observer, zoneId });
  }
  return noticed;
}

/**
 * Roll every NPC and enemy in a room against a sneaking player.
 *
 * Returns the beings that noticed, so the caller can decide what each does — an
 * NPC gets alarmed and runs, an enemy attacks. The roll is identical; only the
 * reaction differs, because that difference IS the design.
 */
/**
 * THE CLOCK. Staying unnoticed is not a state you reach, it is a thing that
 * keeps being true — every window the room gets another look at you.
 *
 * This is what makes stealth a race rather than a switch: get in, do the thing,
 * get out. Being well hidden buys you seconds rather than immunity, so darkness
 * is time and time is what you actually needed.
 */
export const SNEAK_WINDOW_MS = 20000;

export function armSneakWindow(player, zoneId) {
  if (!player) return;
  player._sneakUntil = Date.now() + SNEAK_WINDOW_MS + Math.max(0, concealment(player, zoneId)) * 1000;
}

/**
 * Sweep live players whose window has run out and emit `stealth.window` for each.
 *
 * Called from the game loop's existing per-second player walk, alongside
 * tickUnconscious and for the same reason: no timer bookkeeping per sneaker
 * across logout, death and reconnect. The re-roll itself is the plugin's
 * business — the engine only owns the clock.
 */
export function tickStealth(players) {
  const now = Date.now();
  for (const p of players) {
    if (!p?._sneakUntil) continue;
    if (!isSneaking(p)) { p._sneakUntil = 0; continue; }
    if (p._sneakUntil > now) continue;
    armSneakWindow(p, p.current_zone);
    emit('stealth.window', { player: p, zoneId: p.current_zone });
  }
}

export function noticeSweep(sneaker, zoneId, beings) {
  const caught = [];
  for (const b of beings || []) {
    if (noticeRoll(b, sneaker, zoneId)) caught.push(b);
  }
  return caught;
}
