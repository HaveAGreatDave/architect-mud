/**
 * Grab — the first consumer of `grants.capability`.
 *
 * `body_parts[].grants` has three shapes. Two of them were wired from the start:
 * `component` silences a damage type when every part granting it is maimed, and
 * `dodge` strips evasion. The third, `capability`, was built as a deliberate
 * seam with no consumer — a named string other systems could gate on, so that a
 * behaviour could check it without enemy.js ever learning about that behaviour.
 * It sat unconsumed. This is the behaviour on the other side of that seam.
 *
 * The rule it implements:
 *
 *     A creature with an intact grabbing part does not let you walk away.
 *     Ruin the part that does the holding and you can go.
 *
 * That is the whole point of the capability seam, and it is what gives `aim` a
 * target worth picking for a reason other than "more damage". Two enemies gain
 * behaviour the moment this loads, with no content change at all: the harbor
 * lurker (its maw) and the tar-pit horror (both tendrils).
 *
 * ── Why a move gate rather than a status effect ──────────────────────────────
 * Being grabbed is a DERIVED predicate — "is a creature with an intact grabbing
 * part holding me right now" — not a duration. Modelling it with applyEffect
 * would mean either re-applying a 1-tick effect from a new per-tick sweep, or
 * leaving a stale "Grabbed" on the HUD after the thing is dead. The engine makes
 * the same call about mobs and statuses in combat.js: better absent than pretend.
 * So it is computed at the moment it matters and stored nowhere.
 *
 * ── Why it cannot softlock ───────────────────────────────────────────────────
 * The contest costs NOTHING — no stamina, no cooldown. The attack-cycle price of
 * breaking contact already belongs to `weapon:flee`, which runs after this one,
 * and charging twice would let a stamina-dead player burn attempts on a move the
 * pacing gate was going to refuse anyway. So a held player can keep rolling once
 * per move command indefinitely, and there are five other ways out besides:
 * kill it, maim the granting part, stun it, break its target, or log out.
 */
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { playerFleeRoll, isStunned } from '../../server/engine/combat.js';
import { getZoneEnemies } from '../../server/engine/world.js';
import { on } from '../../server/engine/events.js';
import { enemyHasCapability, partLabel } from './enemy.js';

// The flat surcharge for being physically held, on top of the grabber's own
// competence. Breaking a grab should be strictly harder than the ordinary
// break-away in weapon:flee, which this runs ahead of.
const GRAB_DIFFICULTY = 2;

// …and the ceiling on the whole thing. This is load-bearing, not a safety
// blanket. The contest is `(dodge + defense - 1 - E) + 2d8-2d8 >= 0`, so at zero
// Dodge each point of E costs about a third of the remaining odds:
//
//     E=4 → 17%      E=6 → 8%      E=8 → 3%      E=12 → 0.12%
//
// Feeding a grabber's raw `hit` in would put the Sump Widow (hit 8) at E=10 and
// an Arbiter-tier grabber at E=12 — winnable on paper, a softlock in practice.
// Halving `hit` keeps the ordering (a better grabber IS harder to shake) while
// the cap holds the worst case in the game to roughly one attempt in twelve.
const GRAB_MAX_RATING = 6;

function grabRating(enemy) {
  return Math.min(Math.ceil((enemy.hit || 1) / 2) + GRAB_DIFFICULTY, GRAB_MAX_RATING);
}

// The creature in this room that has hold of you, or null.
//
// `attackersOf` flattens its results to {name, hit}, but the capability lives on
// the INSTANCE, so this walks the zone itself. Three exclusions, each doing real
// work: a dead thing isn't holding anything; a creature that isn't targeting YOU
// has no grip on you (you can always walk away from something not fighting you);
// and a stunned creature has let go — which is what gives the taser a tactical
// use here rather than being a flat damage choice.
export function grabberOn(player) {
  if (!player?.current_zone) return null;
  for (const e of getZoneEnemies(player.current_zone)) {
    if (!e || e._dead) continue;
    if (e.targetId !== player.id) continue;
    if (isStunned(e)) continue;
    if (enemyHasCapability(e, 'grab')) return e;
  }
  return null;
}

// Which part is doing the holding — named so the refusal can point at the thing
// the player needs to destroy. Only intact granters count: once a part is maimed
// it stops granting, so what is named here is always still a live target.
function grabbingPart(enemy) {
  const parts = Array.isArray(enemy?.body_parts) ? enemy.body_parts : [];
  const sev = enemy?._injuries;
  const intact = parts.filter(p => p?.grants?.capability === 'grab'
    && (sev?.get(p.part)?.sev || 0) < 3);
  const pick = intact[0] || parts.find(p => p?.grants?.capability === 'grab');
  return pick ? partLabel(pick.part) : 'grip';
}

/**
 * The gate. Registered as 'injury:grab'.
 *
 * ORDERING MATTERS: plugin load order is alphabetical, so `injury` registers
 * before `weapon` and this resolves before the generic break-away. That is the
 * right way round — you should be told you are being physically held before you
 * spend an attack cycle discovering it. tests assert the ordering rather than
 * trusting the filesystem.
 */
export async function grabGate({ player, opts }) {
  // System moves (shove, .gohome, elevators) and weapon's own retry are exempt.
  if (opts?.bypassEncumbrance || opts?.fleeing) return;

  const grabber = grabberOn(player);
  if (!grabber) { if (player) player._grabbedBy = null; return; }

  if (await playerFleeRoll(player, grabRating(grabber))) {
    player._grabbedBy = null;
    return; // through to weapon:flee, which owns the cost of breaking contact
  }

  const held = player._grabbedBy === grabber.instanceId;
  player._grabbedBy = grabber.instanceId;
  return {
    block: true,
    message: held
      ? `You pull against it. ${grabber.name} does not appear to have noticed.`
      : `${grabber.name} has you. Its ${grabbingPart(grabber)} is not letting go.`,
  };
}
registerMoveGate(grabGate, 'injury:grab');

// A creature that can hold you should read as one BEFORE it does. This is the
// same loop enemyWoundNote closes from the other end: examine tells you what to
// aim at, and then tells you when it worked — because once every granting part
// is maimed this returns nothing, and the silence is the confirmation.
export function enemyCapabilityNote(enemy) {
  if (!enemyHasCapability(enemy, 'grab')) return null;
  return `Its ${grabbingPart(enemy)} looks built for holding on to things.`;
}

// `stop` already means "disengage from everything you were doing". A player who
// has typed it should not still be told they are held by something they are no
// longer fighting; the grabber check will re-derive the truth on the next move.
on('player.stop', ({ player }) => { if (player) player._grabbedBy = null; });
