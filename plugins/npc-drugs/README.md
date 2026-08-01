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

## Effect model — the reaction reflects what KIND of drug it is

Keyed off **`drugs.flags.drug_family`**, authored per drug:

| family | state | what it looks like | graph |
|---|---|---|---|
| `stimulant` | **wired** | jaw working, heel jackhammering, talks over you | runs |
| `nootropic` | **lucid** | unnervingly precise, finished sentences, corrects you politely | runs |
| `cannabis` | **mellow** | an inch lower into themselves, in no hurry, starving and doing nothing about it | runs |
| `psychedelic` | **tripping** | absorbed, delighted, running a hand along the wall watching where their fingers have been | runs |
| `dissociative` | **dissociated** | upright and awake but a long way back; answers four seconds late | **yielded** |
| `deliriant` | **paranoid** | pupils blow, blind-panic flee to a random neighbour (or cowering when boxed in) | **yielded** |
| `depressant`, `opioid` | **sedated** | see below | runs until `out` |

`sedated` keeps its dose ladder: 1–4 doses → **loose** (glassy, candid, impaired but
upright); 5+ → **out cold** (`setPosture` lying + `ai.dosedOut`, robbable and passable),
deliberately hard to reach. A `thug`/`mercenary`/`lowlife`-personality NPC gets
**belligerent** riding on top of loose.

Durations differ because the drugs do: a trip runs ~3 min, stoned ~2 min, a
dissociative hole only ~45 s, an upper or a downer ~60–90 s. All expire on the plugin's
own driver tick, which also emits the ongoing flavour and flee steps and self-gates when
nobody is dosed.

> **⚠ `drug_family` is NOT `drug_class`.** `drug_class` means one specific thing —
> *"this kills by additive load"* — and drives the shared polydrug overdose ceiling,
> cross-tolerance and withdrawal substitution in `drugs.js`. Only `depressant` and
> `stimulant` carry it, and psychedelics are deliberately excluded
> ([systems-survival.md](../../docs/systems-survival.md)): dangerous in other ways, but
> they don't stop your breathing by stacking. Describing the whole pharmacopoeia through
> that field would silently give every psychedelic a shared overdose ceiling nobody
> designed. **Family describes; class kills.** A regress case fails the build if any drug
> acquires a `drug_class` outside the additive-load set.

`drug_class` is still read as a *fallback* when there's no family, so a depressant never
needs both authored. A drug with neither (the hand-mixed compound, whose effects vary per
mix) falls back to the original hallucination/reflexes derivation, so nothing unauthored
regressed.

## An NPC's own habit — and the standard for all of them

**An NPC never simply *is* high.** Every self-administered dose in the game runs through
`runRitual()`: three or four beats, five to eight seconds apart, in which the NPC fetches
the thing, prepares it, takes it — and only THEN does `doseNpc` fire. Each beat re-validates
(dead, moved, fighting, asleep, out cold), so an interrupted ritual never reaches the dose.
A player walking in mid-ritual sees a person making a choice rather than a status effect
appearing on a body. Ritual pools are they/them throughout, because any NPC can carry any
of these flags and a pool that says "his" fits exactly one man.

**Four flags — two cadences × two substances**, all data-driven and hardcoded to nobody:

| | a DRINK | a DRUG |
|---|---|---|
| **standing** (a dependency: 20-min cooldown × 35%/scan, needs no schedule) | `booze_habit` | `drug_habit` |
| **pre-show** (an occasion: ~2 game-hours before curtain, one 10% roll per show, 5–6 game hours so it covers the lead-up *and* the broadcast) | `preshow_drink` | `preshow_habit` |

The **drink** column is always **sedated** and `neverOut`: an NPC who folds stops running
their graph and stops turning up for work — "often drunk, still on air" is the character,
"missing, face down at home" is not. The **drug** column takes the drug's own classified
effect and *can* put them under.

**The columns are separate flags rather than one flag we sniff, and that is load-bearing.**
A drink's name is authored flavour — "embassy reserve" will never be in the drugs
catalogue — so the drug path's unrecognised-name default would hand a broadcast anchor a
stimulant jag off a glass of whisky, narrated as a line racked up on a hand mirror. Each
column also has its own ritual pool, because tipping a hit of whisky under your tongue is
not a thing anyone does.

The scanners skip an NPC who is asleep, mid-comedown, or already dosed, so a habit waits
its turn rather than stacking on itself. The pre-show roll latches per NPC **per flag**, so
someone keeping both a bottle and a baggie gets one roll each.

- **John Akerson** — `preshow_habit` + `drug_habit`, both "Neural Overclock", plus
  `uses_drugs`: the talk-show host racking up a line before the cameras roll, then swanning
  around his penthouse a little too sharp — and paying for it later, below.
- **Neil Mcmanistan** — `booze_habit` + `preshow_drink`, both "embassy reserve": the same
  shape of man, one column to the left.

**Editing them:** the dev panel's NPC form has a **Habits** section (four fields, above the
raw Flags JSON). NPC flags are *not* catalogue-validated the way zone and item tags are, so
a hand-typed key is accepted silently and inert forever — the fields exist to stop that.

## The aftermath — why it changes behaviour *from that point on*

Coming down is not the same as never having taken it. On expiry `sober()` sets
`ai.comedown = { kind, until }` for 45–90 game minutes, during which the NPC emits
occasional worse-for-wear lines and reads differently in conversation.

For a stimulant it also sets **`ai.crashSleepy`** — a timestamp the ENGINE reads in
`AT_HOME_LIFE` to raise the chance of going to bed from 15% to 50%, and to change the
line to *"folds onto the bed mid-sentence"*. One plugin-owned field, one engine read,
the same contract as `ai.dosedOut`. That flag is the whole point: the drug taken at eight
o'clock is why they are face down at eleven, and a player can watch the entire arc.

## Talking to someone who is on something

The `npc.talk` hook emits ONE tell to the room (`TALK_TELL`, keyed off the pure
`doseState()`) and returns `undefined` — it never claims the conversation, so the
dialogue tree, the vendor shop and every other plugin that wanted this NPC run exactly
as before. A doped NPC is visibly doped *in the conversation*, not just in the room log.

## Engine contract

- Sets `npc._ai.dosedOut = true` while an NPC is out cold or panicking. `tickEntityAI`
  early-returns on it (mirroring `ai.alarm`). The plugin clears it on expiry / `npc.killed`.
- Sets `npc._ai.crashSleepy` (a timestamp) on a stimulant comedown. `AT_HOME_LIFE` reads it
  to make bed much likelier. Cleared with the comedown on the plugin's own tick.
- Reads (never writes) `npc._ai.homeSleeping` — the engine's sleep flag. A habit does not
  wake someone up, and a ritual does not finish if its owner falls asleep partway through.
- Uses the engine substrate APIs `setPosture` / `forceStand` for the NPC's posture rather
  than poking `npc.posture` directly.

## Events

- Emits `npc.attacked` `{ actor, npc }` on a `jab` and on a *failed* `spike` (assault heat,
  via the existing surveillance listener — no new crime content).
- Listens to `npc.killed` to drop a dead NPC's effect.

## Seams

- commands: `spike`, `jab`, `slip`
- hooks: `npc.talk` (flavour only — always returns `undefined`)
- engine: two read points in `server/engine/ai-behaviour.js` — the `ai.dosedOut` guard in
  `tickEntityAI`, and `ai.crashSleepy` in `AT_HOME_LIFE`
