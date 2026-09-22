// WHEN THE HULL LETS GO.
//
// A race boat at speed is a person sitting inside a thin shell with an engine behind their head,
// and the shell is the only thing between them and the water. So the consequence of the hull bar
// reaching zero is not "the vehicle is unusable" — it is that the boat is no longer there and you
// are in the basin at a hundred miles an hour.
//
// ── ⚠ IT INVENTS NO DAMAGE SYSTEM, AND THAT IS THE WHOLE DESIGN ──────────────
//
// The obvious way to write "a random amount of damage spread at random over your body" is a loop
// that picks a body part and subtracts from `player.hp`. That is wrong here for the reason CLAUDE.md
// states about every other system that was tempted by it: writing hp by hand skips the part roll,
// the typed soak, the armour wear and every damage observer, so an injury plugin hangs nothing off
// it and a player wearing a survival suit takes exactly what a naked one does.
//
// `applyStrikeToPlayer` ALREADY DOES ALL OF IT. It rolls a body part off the player's own target
// weights, scales for the damage type, subtracts the part's soak, wears the armour that stopped it,
// fires the damage event, and reports whether that strike was lethal. So a break-up is not a damage
// model — it is a NUMBER OF STRIKES, and both the count and their size come off the impact.
//
// ── ⚠ AND LETHALITY IS THE CALLER'S TO ROUTE ────────────────────────────────
//
// `applyStrikeToPlayer`'s own contract says so: "Lethal outcomes are left for the caller to route
// through handlePlayerDeath." So this reports `killed` and stops. It does not kill anybody itself,
// because a death that skipped the engine's death path is a corpse with no loot, no respawn zone
// and no wanted-star handling.
//
// ── ⚠ AND IT STOPS THE MOMENT YOU ARE DOWN ──────────────────────────────────
//
// The strikes are a loop, and a loop that keeps going after the first lethal one is a player who
// dies four times in one accident — which reaches the death path four times and reads as the game
// stuttering. Once `killed` comes back true the rest of the wreck is narration.

import { applyStrikeToPlayer } from '../../server/engine/combat.js';

// How an impact turns into strikes. Both curves are deliberately shallow at the bottom: the hull
// reaching zero at walking pace should hurt and not maim, and the difference between a bad one and
// a fatal one should be the SPEED you did it at rather than a roll.
export const WRECK = {
  // The fewest and most strikes a break-up can throw. A single strike would make the whole thing a
  // coin flip on one body part; a dozen would guarantee a head hit and make survival a fiction.
  minHits: 2, maxHits: 6,
  // Damage per strike, before soak, at severity 0 and 1. `applyStrikeToPlayer` rolls between them.
  lo0: 3, lo1: 18,
  hi0: 9, hi1: 44,
  // ⚠ 'explosive' RATHER THAN 'kinetic'. The boat is coming apart around you — this is blunt and
  // it is everywhere, which is what the explosive channel already models, and it is the channel a
  // survival suit's soak is authored against. Kinetic would read as being shot by your own boat.
  damageType: 'explosive',
};

// Severity 0..1 from the two things that decide how bad a wreck is: how fast you were going, and
// how hard the thing that finished the hull hit. Pure, so the regress suite can sweep it.
//
// ⚠ SPEED IS THE DOMINANT TERM AND IS SQUARED, because energy is. A hull that fails while you are
// idling is a boat that sinks under you; the same failure at full chat is the one that hurts, and a
// linear term makes those two too close together.
export function wreckSeverity({ speed = 0, topSpeed = 138, impact = 0 } = {}) {
  const v = Math.max(0, Math.min(1, speed / Math.max(1, topSpeed)));
  const slam = Math.max(0, Math.min(1, impact / 1.2));
  return Math.max(0, Math.min(1, v * v * 0.78 + slam * 0.35));
}

// The strikes a wreck of this severity throws, as a plan. Split out from the applying so the suite
// can read the plan without a player, and so the count and the sizes are inspectable rather than
// buried in a loop.
export function wreckPlan(sev, rand = Math.random) {
  const s = Math.max(0, Math.min(1, sev));
  const span = WRECK.maxHits - WRECK.minHits;
  // ⚠ ROUNDED, NOT FLOORED. Floored, severity has to reach 1.0 before the top count is reachable at
  // all, so the worst wreck in the game is one nobody ever sees.
  const hits = WRECK.minHits + Math.round(span * s * (0.65 + 0.35 * rand()));
  return {
    hits: Math.max(WRECK.minHits, Math.min(WRECK.maxHits, hits)),
    min: Math.round(WRECK.lo0 + (WRECK.lo1 - WRECK.lo0) * s),
    max: Math.round(WRECK.hi0 + (WRECK.hi1 - WRECK.hi0) * s),
    damageType: WRECK.damageType,
  };
}

// Hurt the person who was sitting in it. Returns what happened, for the caller to narrate and to
// route a death with.
export async function hurtInWreck(player, sev, rand = Math.random) {
  const plan = wreckPlan(sev, rand);
  const hits = [];
  let killed = false;
  for (let i = 0; i < plan.hits && !killed; i++) {
    const r = await applyStrikeToPlayer(player, { min: plan.min, max: plan.max, damageType: plan.damageType });
    hits.push({ part: r.part, partLabel: r.partLabel, damage: r.damage });
    killed = !!r.killed;
  }
  return { plan, hits, killed, severity: sev };
}

// What the room and the player are told. One line for the boat and one for the body, because they
// are two different facts and a player who survives needs to know which parts took it.
//
// ⚠ THE PARTS ARE NAMED AND THE NUMBERS ARE NOT. `applyStrikeToPlayer` already fires the damage
// event that drives the usual numeric feedback, so restating totals here would be the same number
// twice in two voices. What this adds is WHERE.
export function wreckLines(res, boatName = 'the boat') {
  const sev = res.severity;
  const hull = sev > 0.7
    ? boatName + ' comes apart underneath you. One moment there is a boat and the next there is not.'
    : sev > 0.35
      ? boatName + ' breaks up around you — the canopy goes first, then the deck, then the water.'
      : boatName + ' folds and goes down under you.';
  const parts = [...new Set(res.hits.map((h) => h.partLabel || h.part))];
  const body = parts.length
    ? 'You come up spitting basin water. ' + (parts.length === 1
      ? 'Your ' + parts[0] + ' took it.'
      : 'It got your ' + parts.slice(0, -1).join(', your ') + ' and your ' + parts[parts.length - 1] + '.')
    : 'You come up spitting basin water, somehow whole.';
  return { hull, body };
}
