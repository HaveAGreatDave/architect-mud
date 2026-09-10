/**
 * Frostbite — the cold injury the core-temperature model can't have.
 *
 * `body_temp_c` asks one question: is the body as a whole winning? Frostbite is what happens
 * to the parts the body has decided to SACRIFICE in order to keep winning it. Peripheral
 * vasoconstriction is the first thing a cold body does, and it works: the core holds 37°C for
 * hours while fingers, toes and ears freeze solid. So the two are not the same hazard on
 * different scales, they are opposite ends of one trade — which is why standing in −30°C in a
 * superb coat could previously be done indefinitely at zero cost.
 *
 * A PLUGIN, not engine code, and deliberately: core temperature is a substrate (the weather,
 * the swimming plugin and the wetness plugin all feed it), whereas this is one system built on
 * top of it. It reads `player.extremityExposure` — owned by `recomputeInsulation`, so this
 * plugin never touches inventory — and the same windproofed apparent temperature the body-temp
 * tick uses, and it writes nothing but its own status effects and its own flag.
 */
import { registerStatusEffect, applyEffect, clearEffect } from '../../server/engine/effects.js';
import { getAllLivePlayers, bodyZoneOf, getZone } from '../../server/engine/world.js';
import { feltAmbientC } from '../../server/engine/environment.js';
import { getFlag, setFlags } from '../../server/engine/flags.js';

const FLAG = 'frostbite';
// The floor the meter can no longer thaw below. Frostnip and frostbite are circulation
// injuries and they go away; DEEP frostbite is tissue death, and dead tissue does not warm
// up and come back. So crossing 90 latches a floor there, and from then on the cold is not
// something you wait out — it's something you get treated.
const FLOOR_FLAG = 'frostbite_floor';

// Tissue starts to freeze a little below freezing, not at it — skin is salty, perfused and
// warmer than the air. −5°C with any wind at all is a realistic onset for bare hands.
const ONSET_C = -5;
// …and it thaws whenever the skin is comfortably above freezing. The gap between the two is
// deliberate: shuttling across the boundary shouldn't chatter the meter.
const THAW_C = 5;
const ACCRUAL_PER_DEGREE = 0.1;   // per minute, per °C below onset, fully exposed
const THAW_PER_MIN = 0.4;         // ~40 min of warmth to walk off a deep case
// Even fully gloved and hooded you are not immune, you are just slow — which is true, and is
// what stops a hat from being a checkbox that switches the hazard off.
const COVERED_FLOOR = 0.25;

// Stage floors. The meter is 0–100; the stage is what the player and the DB actually care about.
const STAGES = [
  { at: 90, name: 'deep_frostbite', label: 'Deep Frostbite', ref: -3,
    onset: '<span style="color:var(--red)">The pain in your fingers and toes stops. They have gone hard and waxy and white, and they don\'t belong to you any more.</span>' },
  { at: 60, name: 'frostbite', label: 'Frostbite', ref: -2,
    onset: '<span style="color:var(--orange)">Your fingertips and the rims of your ears have gone numb and bloodless. You can\'t feel the difference between touching something and not.</span>' },
  { at: 25, name: 'frostnip', label: 'Frostnip', ref: -1,
    onset: 'Your fingers and ears sting, then itch, then start to go numb at the tips.' },
];
const THAW_MSG = {
  deep_frostbite: "Sensation crawls back into your hands. It's much worse than the numbness was.",
  frostbite: 'The feeling returns to your fingers and ears in a slow, ugly burn.',
  frostnip: 'The sting fades out of your fingers.',
};

for (const s of STAGES) {
  registerStatusEffect({
    name: s.name,
    label: s.label,
    // Reflexes, for the same reason the core cold penalty takes Reflexes: numb hands are a
    // dexterity problem, not a thinking one. It stacks with that penalty on purpose — being
    // hypothermic AND having dead fingers is worse than either, and a body can absolutely be
    // both at once.
    stats: { stat_reflexes: s.ref },
    onTick: () => undefined,   // the meter below owns progression; the effect is just the readout
  });
}

const stageFor = (meter) => STAGES.find(s => meter >= s.at) || null;
const DEEP_AT = STAGES[0].at;

// ── The public surface other systems treat through ──────────────────────────
// Mirrors plugins/injury: a report anyone can price off, a FIELD treatment that walks the
// damage back but floors out, and a clinic-only clearance that makes you whole. Kept in the
// same shape deliberately — a clinic that already knows how to bill for wounds should not
// have to learn a second vocabulary to bill for frozen fingers.

// Null when there's nothing wrong. `permanent` is what makes this different from a wound:
// once it's true, waiting will not fix it.
export function frostbiteReport(player) {
  const meter = player?._frostbite ?? 0;
  const stage = stageFor(meter);
  if (!stage) return null;
  return { stage: stage.name, label: stage.label, meter, permanent: (player?._frostbiteFloor ?? 0) > 0 };
}

// Hydrate + persist together: the meter and its floor are one fact and must never disagree.
async function saveFrostbite(player) {
  await setFlags(player, {
    [FLAG]: String(Math.round(player._frostbite)),
    [FLOOR_FLAG]: String(Math.round(player._frostbiteFloor)),
  }).catch(() => {});
}

// Re-seat the status effect for whatever stage the meter is now at. One funnel, so the
// tick, the field kit and the clinic can never leave a stale effect on a healed body.
function syncStageEffect(player) {
  const stage = stageFor(player._frostbite);
  for (const s of STAGES) if (s !== stage) clearEffect(player, s.name);
  // Duration is generous because tickEffects runs once a SECOND and the meter only once a
  // minute — refreshed long before it can lapse, and cleared explicitly when the stage drops.
  if (stage) applyEffect(player, stage.name, 180);
  return stage;
}

// FIELD TREATMENT. Walks the injury back by `steps` stages but never past `floor` — the same
// bargain the injury system strikes, and for the same reason: gear should buy you function,
// not absolution. A trauma kit gets your hand working again; it does not give you the hand
// back. Returns the stage moved from/to, or null if there was nothing to do.
export async function treatFrostbite(player, { steps = 1, floor = 1 } = {}) {
  const from = stageFor(player._frostbite ?? 0);
  if (!from) return null;
  // Stage indices run worst-first, so walking DOWN the severity means walking UP the array.
  const fromIdx = STAGES.indexOf(from);
  const toIdx = Math.min(STAGES.length, fromIdx + Math.max(1, steps));
  // `floor: 1` = cannot clear outright; the best a kit can do is the mildest stage.
  const target = toIdx >= STAGES.length && floor >= 1 ? STAGES[STAGES.length - 1] : STAGES[toIdx] || null;
  const newMeter = target ? target.at : 0;
  if (newMeter >= player._frostbite) return null;
  player._frostbite = newMeter;
  // The floor comes down with it — that IS the treatment. Otherwise a kit would move the
  // meter and the next thaw would drag it straight back up to a floor nobody had cleared.
  player._frostbiteFloor = Math.min(player._frostbiteFloor ?? 0, newMeter);
  syncStageEffect(player);
  await saveFrostbite(player);
  return { from: from.label, to: target?.label || null };
}

// THE SURGICAL TIER. Clears frostbite outright, floor and all — the only thing that does.
// Called by plugins/clinic, exactly as `clearInjuries` is.
export async function clearFrostbite(player) {
  const had = frostbiteReport(player);
  if (!had) return null;
  player._frostbite = 0;
  player._frostbiteFloor = 0;
  syncStageEffect(player);
  await saveFrostbite(player);
  return had;
}

// The temperature at the SKIN of an extremity: the windproofed apparent temperature, with no
// credit for core insulation. A parka does nothing for your fingers, which is the entire
// point of this system — only what actually covers them (via `extremityExposure`) does.
// A heated vehicle cabin, however, DOES: that is air, not clothing, and `feltAmbientC` hands
// back its temperature for a player sealed in a running one. Same function the body-temp drift
// calls, so a cab can never warm the core and freeze the hands.
function peripheralTempC(player) {
  const zoneId = bodyZoneOf(player);
  const zone = getZone(zoneId);
  if (!zone) return null;
  return feltAmbientC(player, zoneId, zone.flags?.temp_offset || 0);
}

export const hooks = {
  'tick.minute': async ({ broadcast }) => {
    for (const player of getAllLivePlayers()) {
      // Lazy hydrate. Player flags are hydrated into RAM at login, so this is a Map read on
      // every path but the first, and never a query on the hot path.
      if (player._frostbite === undefined) {
        player._frostbite = Number(await getFlag('player', FLAG, player)) || 0;
        player._frostbiteFloor = Number(await getFlag('player', FLOOR_FLAG, player)) || 0;
        // A body that logs back in already maimed wears it immediately, rather than looking
        // healthy until the first tick that happens to change stage.
        if (player._frostbite > 0) syncStageEffect(player);
      }

      // Submerged doesn't count: cold water is a core-temperature problem and a fast one.
      // Freezing tissue needs air below freezing, and you cannot get that under the surface
      // of water that is by definition still liquid.
      const skin = player._submerged ? null : peripheralTempC(player);
      const before = player._frostbite;

      if (skin != null && skin < ONSET_C) {
        const exposure = COVERED_FLOOR + (1 - COVERED_FLOOR) * (player.extremityExposure ?? 1);
        player._frostbite = Math.min(100, before + (ONSET_C - skin) * ACCRUAL_PER_DEGREE * exposure);
        // Reaching the deep stage latches the floor there, permanently. Everything above
        // this line is reversible circulation damage; below it, tissue has died.
        if (player._frostbite >= DEEP_AT) player._frostbiteFloor = DEEP_AT;
      } else if (skin == null || skin > THAW_C) {
        // Thaws toward the floor, not toward zero. For an undamaged body the floor IS zero,
        // so nothing changes until you've been careless enough to earn one.
        player._frostbite = Math.max(player._frostbiteFloor ?? 0, before - THAW_PER_MIN);
      }

      const wasStage = stageFor(before), nowStage = stageFor(player._frostbite);
      if (wasStage?.name === nowStage?.name) continue;

      syncStageEffect(player);

      const worsened = (nowStage?.at ?? 0) > (wasStage?.at ?? 0);
      const msg = worsened ? nowStage.onset : THAW_MSG[wasStage.name];
      if (msg && broadcast) broadcast(null, { type: 'output', message: `<em>${msg}</em>` }, null, player.id);

      // Persist on STAGE change only — once every tens of minutes of real exposure, not once
      // a minute. The meter itself is RAM; on relog it restores to the stage's floor, which
      // loses at most a few minutes of progress toward the next stage and costs the DB
      // nothing. The injury is what's worth remembering, not the exact number.
      await saveFrostbite(player);
    }
  },

  // FIELD MEDICINE. Fired by the engine's consumable path for every item used, so this must
  // be cheap and silent for the overwhelming majority that are food — the same contract the
  // injury plugin's hook works under. A kit is never REQUIRED: frostnip and frostbite thaw on
  // their own, and only a deep case needs anything at all. What a kit buys is time and the
  // use of your hands, which is why it floors out instead of curing.
  'item.consumed': async (player, tags) => {
    const rx = tags?.treat_frostbite;
    if (!rx) return undefined;
    if (!frostbiteReport(player)) return 'Nothing on you is frozen. You put it away.';
    const moved = await treatFrostbite(player, rx);
    if (!moved) return 'You warm and wrap what you can. The damage is past what this can reach.';
    return moved.to
      ? `You work the circulation back as far as it'll go. ${moved.from} — ${moved.to}.`
      : 'You work the feeling back into your hands.';
  },
};

export const _test = { STAGES, stageFor, ONSET_C, THAW_C, THAW_PER_MIN, ACCRUAL_PER_DEGREE, COVERED_FLOOR };
