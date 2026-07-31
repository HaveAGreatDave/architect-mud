# npc-drugs

## Purpose

Makes NPCs *subjects* of the drug system, not just the counterparty players buy from
and sell to. A player can get a drug into an NPC and it changes the NPC's behaviour —
sedating a guard, loosening a mark, or panicking someone into flight — using the drug's
own existing data to decide the effect. This is the offensive-dosing half of a larger
plan to fold NPCs into the player drug economy (addict customers are the intended next
build; `slip` is the seam it grows from).

The effect is transient runtime state on the live NPC's AI blackboard (`npc._ai.dose`) —
no NPC DB writes (per the no-new-npc-columns rule; NPC rows are uncached), so a reboot
sobers everyone. The engine reacts to a single plugin-set boolean, `ai.dosedOut`, exactly
as it reacts to burglary's `ai.alarm` — the "plugin owns the state, engine yields the
graph" contract. The only engine touch is one guard line in `tickEntityAI`.

## Commands

- `spike <npc> [with <drug>]` — covert dose. A Deception check (Cool+Brains) vs the room.
  Success doses them unseen with **no heat**; failure means they catch you → assault-tier
  heat and no dose. Trains Deception on use. If `with <drug>` is omitted, the first drug
  you're carrying is used.
- `jab <npc> [with <drug>]` — forced needle. Always lands, always draws assault heat
  (emits `npc.attacked`, which the surveillance/wanted system charges as `attack_npc`).
- `slip <drug> to <npc>` — willing hand-off. Only an NPC flagged `uses_drugs` (or one
  you've already loosened) accepts; consensual, no heat. The addict-economy seam.

## Effect model (derived from the drug — no content edits)

- `effects.hallucination` → **paranoid**: pupils blow, graph suppressed, plugin drives a
  blind-panic flee to a random neighbour (or cowering when boxed in).
- stimulant signature (`peak_mods.stat_reflexes > 0` or `instant.stamina > 0`) → **wired**:
  jittery, agitated flavour; otherwise carries on.
- everything else (downers, alcohol, benzos, cannabis) → **sedated**:
  - 1 dose → **loose**: glassy, pacified, blurts candid lines.
  - 1-4 doses → **loose**: impaired but upright, graph still running.
  - 5+ doses → **out cold** (blackout): `setPosture` lying + `ai.dosedOut` (robbable, passable). Deliberately hard to reach — a habitual drinker never gets there on their own.

Effects last ~60–90s and expire on the plugin's own driver tick (`TICK_MS`), which also
emits the ongoing flavour and flee steps and self-gates when nobody is dosed.

## Pre-show habit (an NPC's own vice)

Data-driven, not hardcoded to anyone: an NPC with `flags.preshow_habit` set to a drug
name will *rarely* dose themselves at home, when a player is present to witness it, and
take on that drug's effect. It reads as a nervy pre-show ritual — the performer who can't
go on flat. Rarity = a 30-min cooldown × a low per-scan roll × "only when watched," so
it's a beat you stumble into. John Akerson (`flags.preshow_habit: "Neural Overclock"`) is
the first: the electric talk-show host racking up a line before the cameras roll, then
swanning around his penthouse a little too sharp, a little too fast.

## Engine contract

- Sets `npc._ai.dosedOut = true` while an NPC is out cold or panicking. `tickEntityAI`
  early-returns on it (mirroring `ai.alarm`). The plugin clears it on expiry / `npc.killed`.
- Uses the engine substrate APIs `setPosture` / `forceStand` for the NPC's posture rather
  than poking `npc.posture` directly.

## Events

- Emits `npc.attacked` `{ actor, npc }` on a `jab` and on a *failed* `spike` (assault heat,
  via the existing surveillance listener — no new crime content).
- Listens to `npc.killed` to drop a dead NPC's effect.

## Seams

- commands: `spike`, `jab`, `slip`
- engine: one guard line in `server/engine/ai-behaviour.js` (`ai.dosedOut`)
