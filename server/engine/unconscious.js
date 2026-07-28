/**
 * Unconsciousness — being out cold, as a substrate.
 *
 * NOT A COMBAT OUTCOME. A fight in this game is to the death; HP reaching zero
 * kills, and nothing here changes that. Being knocked out is always something
 * somebody DECIDED — a deliberate subdual (plugins/subdue), a police takedown at
 * high heat, or eventually a drug. A random KO mid-fight would be invisible
 * anyway: auto-attack finishes an unconscious body a second later.
 *
 * The state is engine-owned because three unrelated systems have to react to it:
 * the command dispatcher (you cannot act), the AI tick (an NPC out cold yields
 * its behaviour graph), and the room description (`bodyTell`). The verb that
 * causes it is a plugin.
 *
 * WHAT IT REUSES. The whole mind/body split already built for dreams applies
 * unchanged — the body stays in the room, listed, lootable, and killable where
 * it lies. `bodyTell` gains a third state and everything else is free.
 *
 * ⚠ AN UNCONSCIOUS BODY CAN BE KILLED. That is deliberate. It is why a subdual
 * is a choice with a consequence rather than a polite alternative to violence,
 * and why finishing one is charged as its own, worse crime.
 *
 * HP IS PINNED AT 1, NEVER 0. NPC death is `hp <= 0`, so an NPC knocked to zero
 * would simply die. One is the floor for anything out cold.
 *
 * See docs/systems-unconscious.md.
 */
import { setPosture } from './posture.js';
import { applyEffect, registerStatusEffect } from './effects.js';
import { emit } from './events.js';

// How long you are out, before any modifiers. Long enough to be robbed or
// finished, short enough not to be a session-ending punishment.
export const KO_MS = 45000;

// CONCUSSION. Without this, waking up is free and a knockout is just a nap you
// took. Short and sharp on purpose — a beat you feel and then shake off, not a
// debuff you carry into your evening. Registered here rather than in effects.js
// because the state and its after-effect belong together.
export const CONCUSSION_TICKS = 6;
registerStatusEffect({
  name: 'concussed',
  label: 'Concussed',
  stats: { stat_brains: -2, stat_reflexes: -2 },
  onTick: () => undefined,
});

/** Is this player or NPC out cold? */
export function isOut(being) {
  const until = being?._koUntil || 0;
  return until > Date.now();
}

/**
 * Put someone out.
 *
 * Works on a live player or an NPC — the fields are the same, and keeping one
 * function means the two can never drift on what "out cold" means.
 * `by` is recorded so a finishing blow can be attributed and so the victim can
 * be told who it was when they come round.
 */
export function knockOut(being, { ms = KO_MS, by = null } = {}) {
  if (!being) return false;
  being._koUntil = Date.now() + ms;
  being._koBy = by?.handle || by?.name || null;
  // Pinned, never zero: zero is death for an NPC, and a body at zero HP is a
  // corpse everywhere else in the engine.
  if ((being.hp ?? 1) < 1) being.hp = 1;
  setPosture(being, 'lying');
  // The AI tick yields on this the same way it does for a drugged NPC — one
  // boolean, checked in one place (ai-behaviour.js).
  if (being._ai) being._ai.dosedOut = true;
  emit('being.knockedOut', { being, by });
  return true;
}

/**
 * Bring someone round. Idempotent, and safe on anyone who was never out.
 *
 * Returns true if they were actually unconscious, so callers can decide whether
 * to narrate. The concussion is applied HERE rather than at knockout so that
 * being finished while out cold never leaves a status on a corpse.
 */
export function wakeUp(being) {
  if (!being?._koUntil) return false;
  const wasOut = isOut(being);
  being._koUntil = 0;
  being._koBy = null;
  if (being._ai) being._ai.dosedOut = false;
  if (wasOut) {
    setPosture(being, 'standing');
    applyEffect(being, 'concussed', CONCUSSION_TICKS);
    emit('being.cameRound', { being });
  }
  return wasOut;
}

/**
 * Sweep for anyone whose time is up. Called from the game loop rather than
 * scheduling a timer per victim — there is already a per-second tick walking
 * live players, and a knockout is far too short-lived to justify its own timer
 * bookkeeping across logout, death and reconnect.
 */
export function tickUnconscious(beings, notify) {
  for (const b of beings) {
    if (!b?._koUntil || isOut(b)) continue;
    const by = b._koBy;
    if (wakeUp(b) && notify) {
      notify(b, by
        ? `You come round on the floor with a head full of broken glass. ${by}, you think. You are fairly sure it was ${by}.`
        : `You come round on the floor with a head full of broken glass, and no idea how long you were down.`);
    }
  }
}
