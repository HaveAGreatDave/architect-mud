/**
 * THE TURN — what it costs your body to become something else.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * MUTATING IS AN INJURY. Not a notification, not a level-up, not a message with
 * a green tick on it. Something is being rebuilt while you are still inside it,
 * and for a while afterwards you are no good to anybody.
 *
 * Before this, a mutation arrived as a line of text and a stat change, which
 * made the most extreme thing that can happen to a character in this game the
 * cheapest thing that can happen to them. The `turning` status is the correction:
 * real HP that has to be MENDED afterwards, stamina burned to nothing, and a
 * stretch of being genuinely weak while your body argues with itself.
 *
 * ── Why the Wildblood give you a room ────────────────────────────────────────
 *
 * This is the mechanic that makes the Quickening's fiction true. The Chorus
 * already tells you "you will be sick for a week" and "Gristle will sit with you
 * for the week", and until now that was a nice line over nothing. Now it is a
 * description of what the status does: you are on your back, weak, bleeding
 * HP, in a walled town four regions from anywhere, and somebody you have done
 * three jobs for is watching the door.
 *
 * Take mutagen in an alley in Coldwater and nobody is watching the door.
 *
 * ── The one hard limit ───────────────────────────────────────────────────────
 *
 * IT CANNOT KILL YOU. HP is floored at 1, the same rule the Custodian turrets
 * follow. A system that killed you for the content you went and found would be
 * teaching players not to engage with it, and dying to your own biology mid-turn
 * would be unreadable — you would not know what had happened to you.
 */
import { registerStatusEffect, applyEffect, clearEffect } from '../../server/engine/effects.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer } from '../../server/engine/world.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
//
// Ticks are seconds (the engine's status tick is 1 Hz). Radiation is an accident
// your body is coping with badly; mutagen is a deliberate demolition, and it is
// worse on every axis. That gap is the price of the ladder mutagen buys you.
const ONSET = {
  radiation: { baseTicks: 45,  perExpr: 0.9, hpPerTick: 0.10, stamHit: 0.55, weakness: 1 },
  mutagen:   { baseTicks: 110, perExpr: 1.7, hpPerTick: 0.16, stamHit: 0.90, weakness: 2 },
};

// HP is floored here, never at zero. See the header.
const HP_FLOOR = 1;

// ── The prose ────────────────────────────────────────────────────────────────
//
// Three beats, because a body does not hurt uniformly: it starts wrong, it gets
// worse, and then it is over and you are wrecked. Fired at fractions of the
// remaining duration so a short turn still gets all three.

const EARLY = [
  `Something under your skin moves that should not be able to move.`,
  `Your teeth ache. All of them, at the roots, at once.`,
  `You taste metal, and then you taste it more.`,
  `A deep itch starts somewhere you cannot reach because it is not on the outside.`,
];

const MIDDLE = [
  `Your bones are hot. You can feel the shape of them, which you never could before.`,
  `Something tears and knits and tears again, and you hear it rather than feel it.`,
  `You go down onto one knee without deciding to.`,
  `A muscle you do not have a name for cramps and does not stop.`,
  `You bite down on something to stop the noise you are making.`,
];

const LATE = [
  `It is easing. What is left is a kind of ringing exhaustion, everywhere, all at once.`,
  `Your body has finished arguing with itself. Something won. You are not sure it was you.`,
  `The pain lets go all at once and leaves you shaking and wringing wet.`,
];

const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];

// ── The status ───────────────────────────────────────────────────────────────
//
// Registered ONCE, at two severities, because the effects registry keys stat
// penalties by NAME and there is no per-instance payload. `turning` and
// `turning_deep` are the same mechanic at two weights; onTick reads the per-player
// state hung on `_turning` for everything that does vary.

function makeTurning(name, label, weakness) {
  registerStatusEffect({
    name, label,
    // WEAK AT FIRST. This is the half the player feels in play rather than in
    // the log: you cannot fight, you cannot carry, and you should not be outside.
    stats: {
      stat_brawn: -weakness, stat_reflexes: -weakness,
      stat_endurance: -weakness, stat_cool: -Math.max(1, weakness - 1),
    },
    // Blunted, too. Everything is loud and far away at the same time.
    acuity: { sight: -1, hearing: -1, smell: -1 },
    onTick: (player) => {
      const st = player?._turning;
      if (!st) return undefined;
      st.ticksLeft = (st.ticksLeft ?? 0) - 1;

      // HP that has to be MENDED afterwards. It is ordinary damage on the
      // ordinary pool, so a medkit, a clinic, a bed and time all work on it in
      // the ordinary way — nothing here invents a second kind of wound.
      const before = player.hp ?? player.hp_max ?? 100;
      const bite = Math.max(1, Math.round((player.hp_max || 40) * st.hpPerTick / 10));
      player.hp = Math.max(HP_FLOOR, before - bite);
      player._resDirty = true;

      // And it keeps taking the wind out of you, so you cannot simply walk it off.
      if (player.stamina != null) player.stamina = Math.max(0, player.stamina - 1);

      const total = st.totalTicks || 1;
      const done = total - st.ticksLeft;
      if (done === Math.floor(total * 0.10)) return pick(EARLY);
      if (done === Math.floor(total * 0.45)) return pick(MIDDLE);
      if (st.ticksLeft === 2) return pick(LATE);
      return undefined;
    },
  });
}

makeTurning('turning', 'Turning', ONSET.radiation.weakness);
makeTurning('turning_deep', 'Turning (deep)', ONSET.mutagen.weakness);

/**
 * Put a body through it. Duration and severity both scale with expression, so
 * the legendary outcome everybody wants is also the one that nearly finishes you.
 */
export function beginTurning(player, { expression = 30, source = 'radiation', mutationName = null } = {}) {
  if (!player) return null;
  const cfg = ONSET[source === 'mutagen' ? 'mutagen' : 'radiation'];
  const ticks = Math.round(cfg.baseTicks + expression * cfg.perExpr);

  player._turning = {
    ticksLeft: ticks, totalTicks: ticks,
    hpPerTick: cfg.hpPerTick, source, mutationName,
  };

  // The opening hit lands NOW rather than on the first tick, because the moment
  // it starts has to be the moment it hurts. Stamina goes first and goes hard:
  // whatever you were about to do, you are not doing it.
  if (player.stamina != null) {
    player.stamina = Math.max(0, Math.round(player.stamina * (1 - cfg.stamHit)));
  }
  const opening = Math.max(2, Math.round((player.hp_max || 40) * (source === 'mutagen' ? 0.22 : 0.12)));
  player.hp = Math.max(HP_FLOOR, (player.hp ?? player.hp_max ?? 100) - opening);
  player._resDirty = true;

  // Clear the other rung first so the two can never both be running.
  clearEffect(player, source === 'mutagen' ? 'turning' : 'turning_deep');
  applyEffect(player, source === 'mutagen' ? 'turning_deep' : 'turning', ticks);

  return { ticks, opening };
}

// ── Wiring ───────────────────────────────────────────────────────────────────
//
// Hung off the substrate's `mutation.gained` rather than off each grant path, so
// the radiation roll, the flask and any authored GRANT_MUTATION all pay the same
// price and a future path cannot forget to.
on('mutation.gained', ({ player, mutation, expression, source }) => {
  const live = player?.statuses ? player : getLivePlayer(player?.id);
  if (!live) return;

  const res = beginTurning(live, { expression, source, mutationName: mutation?.name });
  if (!res) return;

  const deep = source === 'mutagen';
  sendToPlayer(live.id, {
    type: 'zone_event',
    message: `\n<span class="rad-warning">${deep
      ? 'It starts in your spine and goes outward, and it is not survivable-feeling.'
      : 'Something goes wrong in you, all at once, and keeps going.'}</span>\n`
      + `<span class="text-dim">You lose ${res.opening} and most of your wind. `
      + `This will take a while, and you will be no good to anybody while it does.</span>`,
    player_update: { hp: live.hp, stamina: live.stamina },
  });
});

/** True while a body is mid-turn. Read by anything that should refuse. */
export function isTurning(player) {
  return (player?.statuses || []).some(s => s.name === 'turning' || s.name === 'turning_deep');
}

export const _test = { ONSET, beginTurning, isTurning, HP_FLOOR };
