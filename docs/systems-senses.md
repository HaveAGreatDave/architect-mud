# Senses (as built)

Perception as a **substrate**, not a feature. The engine owns the senses; everything that has a
smell or makes a noise contributes to them from wherever it already lives.

The design rule the whole system is held to: **a sense must answer a question no other sense can.**
`smell` reaches what you cannot see; `listen` reaches what is not in the room; sight reaches into the
dark. A sense that only restates what `look` already told you is a fourth readout, not a sense, and
does not get built.

## The pieces

| File | Holds |
|---|---|
| [`server/engine/senses.js`](../server/engine/senses.js) | **pure** — acuity, the perception band, overload, the prose. No DB, no clock |
| [`server/engine/commands/world.js`](../server/engine/commands/world.js) | the `smell` / `listen` / `attune` verbs, and the engine's own contributions |
| [`server/engine/commands/describe.js`](../server/engine/commands/describe.js) | sight — applied to room visibility, not a verb |
| [`server/engine/bodily.js`](../server/engine/bodily.js) | two substrates: stains (persistent) and air taint (transient) |
| [`server/engine/effects.js`](../server/engine/effects.js) | the `sense_overload` status, and `acuity` on any status effect |

## Contributions

A sense verb gathers `{ text, strength, source }` from every interested plugin over a **gather
hook**, and shows the strongest few.

```js
'zone.smells': (zone, player) => [{ text: 'fat spitting in a pan', strength: 7, source: 'burning' }]
'zone.sounds': (zone, player, { distance, here }) => [{ text: 'a pot ticking over', strength: 5 }]
```

`gatherHook` exists because `fireHook` keeps only the **last** non-undefined result. That's the right
shape for "what is this value" and the wrong shape for "what does everyone have to contribute" — a
kitchen genuinely smells of burnt fat *and* piss *and* the street outside, and none of those
overwrites the others.

`source` is optional and names what a contribution *is* (`feces`, `burning`, `blood`, `corpses`,
`blast`…). It is quoted back when that contribution is the thing that overwhelmed you, so the prose
can say what did it instead of going vague at the exact moment specificity matters most.

### The strength scale

| | |
|---|---|
| 3–5 | background — a lone person, a cook just started |
| 6–8 | obvious — a crowd, an unflushed toilet, blood |
| 9–11 | foul — shit on the floor, food burnt to carbon |
| **12+** | **extreme — overwhelms an ordinary person with no stat and no augment** |
| 14+ | the worst things in the world — a room of corpses |

### The contributor contract

**In-memory only. No queries, no IO.** A contributor is called once per zone per verb, and `listen`
walks up to `LISTEN_MAX_ZONES` (12) of them — so a single query inside a contributor becomes twelve
round trips on an uncooldowned verb. The cooking plugin is the model: it answers from a `Map` it
already keeps for its own purposes.

In practice far fewer than twelve are reached: a zone nobody is making noise in is skipped by the
**noisy-zone index** before the hook is called at all (see `listen`, below). The cap is a backstop;
the index is what makes the verb cheap.

This is not hypothetical. `zone.smells` originally shipped with cooking answering it via a
`jsonb_exists` scan of `player_inventory` — a table scan per sniff, over a remote connection, on a
verb with no cooldown. It was replaced with the in-memory `liveCooks` registry in `cook.js`.

## Acuity

One number decides what the band is: how faint a thing you notice, and how many you hold at once.

| acuity | floor | lines |
|---|---|---|
| −2 (blunted) | 8 | 1 |
| 0 (normal) | 5 | 3 |
| +2 (sharpened) | 2 | 5 |

**Acuity does not decide whether contributors run.** Every faint thing is generated either way; a
normal nose discards it. That is what makes a sharpened sense deepen content that already exists
rather than needing content of its own — and any contributor written in future gets the same benefit
on the day it lands.

### Where it comes from

| source | how | notes |
|---|---|---|
| **`stat_senses`** | the dominant/second ladder | the main path. No hardware required |
| **status effects** | `registerStatusEffect({ acuity: { smell: 2 } })` | one line for a drug, mutation or injury |
| **worn gear** | `tags.sense_damp: { smell: -2 }` | negative only — protection, not enhancement |
| **`sense.acuity` hook** | plugin gather hook | for anything conditional enough to need real code |

Totals clamp to **[−3, +5]**, so no amount of stacking runs away.

### The stat ladder

`stat_senses` alone makes you super — paid for the ordinary way, in points that did not go into
brawn. What it does **not** do is make you good at everything: you have a dominant sense and a
second, and the rest stay human.

| stat_senses | dominant | second |
|---|---|---|
| 0–2 | — | — |
| 3–5 | +1 | — |
| 6–8 | +2 | +1 |
| 9–11 | +3 | +1 |
| 12+ | +4 | +2 |

`attune <sense>` sets which. Free the first time — a player crossing the threshold shouldn't need to
know the system exists to benefit. Changing it afterwards is **surgery and needs a clinic**; the old
dominant demotes to second rather than vanishing. Stored in `player_flags`, hydrated onto the live
player at login beside `combat_stance` (never queried per verb).

**You can never be superb at two.** There's a regress case asserting `second < dominant`.

## Overload — what a sharp sense costs

A sense that only ever helped would be the one free upgrade in the game.

A sharp sense **cannot look away**. Walk it into something strong enough and it saturates: you take
the `sense_overload` status, which carries **−3 acuity**, so for the next 20 seconds you perceive
*less* than an ordinary person would have. That's the counter — anyone who knows what you are can
blind you with your own advantage.

```
overloadThreshold(acuity) = clamp(12 − acuity × 1.5, 6, 16)
```

- **Nobody is immune.** An ordinary person still goes down to a 12+ event.
- **The sharper you are, the less it takes.** That is the deal you took.
- The upper clamp is **16, not 12** — deliberately. Damping has to be able to push the threshold
  *above* the worst thing in the game, or gear could never save anyone from the events it exists for.

### Gear

`tags.sense_damp` cuts what you perceive **and** raises what it takes to overwhelm you, by the same
amount. Protection and perception are one dial turned opposite ways.

| | cheap (−1) | proper (−2) |
|---|---|---|
| smell | nose plugs | half-face respirator |
| hearing | foam earplugs | ear defenders |
| sight | — | smoked lenses |

Damping sums across everything worn. A single cheap pair will **not** get you through a corpse room;
a real seal will, and you walk through it perceiving nothing at all.

Cached on the live player by `recomputeSenseDamp`, hung off `recomputeEquipped` — the one funnel
every equip/unequip already passes through. Same pattern as armor and insulation.

## The senses

### smell

Room-level. Works on things you neither hold nor own, and does not care about light or line of
sight. It answers *who is in here that I cannot see* — a single quiet person sits at strength 3,
below a normal nose and above a sharp one.

Engine contributions: floor stains, air taint, creatures (soiled, bleeding, crowds), and **corpses**,
which are the first thing in the game to reach the extreme band.

### listen

The only sense that reaches **out of the room**. Propagation is not reinvented —
[`sounds.js`](../server/engine/sounds.js)'s `getSoundReach` already walks zone exits with
inverse-square falloff and door muffling, so a closed door genuinely deadens what comes through.

A **noisy-zone index** (`markNoisy`/`isNoisy` in sounds.js) keeps the fan-out honest: a source of
ongoing noise registers its zone, so a listen in a quiet street costs **zero** hook calls and one next
to a kitchen costs one. The 12-zone cap is now only a backstop, not the load-bearing limit.

Reach scales as `3 + acuity × 2`. Direction is itself acuity-gated: baseline gets "through the wall",
+1 and up gets a compass bearing — which is what makes it actionable rather than atmospheric.

> **`listen` is a SHARED VERB.** The broadcast plugin owns it (plugins beat engine builtins); in a
> room with a radio or screen it means "what's on", and everywhere else it falls through to
> `cmdListen`. `watch` deliberately does **not** fall through — watching is visual. See
> [plugins.md](plugins.md).

### sight

**Not a verb.** There is nothing for one to do that `look` doesn't already; instead acuity shifts the
room's visibility along the light ladder, so keen eyes see where others cannot.

| sight | a pitch-dark room reads as | effect |
|---|---|---|
| +2 | dark | the room, but not enemies or items |
| **+3** | gloomy | **enemies and NPCs visible — functional in the dark** |
| +4 | dim | everything, just short on detail |

Applied in `describeZone` **after** the `visibility.perceive` hook, not inside it: `fireHook` keeps
only the last handler's answer, so a keen-eyed player holding a flashlight would otherwise get one or
the other. As a relative shift the two compose.

Read through **`acuitySync`** — the synchronous variant that skips the plugin hook. `describeZone`
runs on every move and every look, and one plugin doing IO inside `sense.acuity` would put a round
trip on every step a player takes. The explicit verbs, typed deliberately, pay for the async version.

### touch

Deliberately **not** built. No verb, no substrate, and the only designs on offer were inventing a
mechanic to justify a tag. It was removed from `SENSES` rather than left as something a player could
attune to and receive nothing from — there's a regress case asserting every attunable sense has
something that reads it.

## Costs

| | |
|---|---|
| New tables | **0** |
| New columns | **0** |
| Ticks | **0** — overload rides the existing 1s effects tick |
| Timers | **0** |
| Persistent writes | 2 flags, on `attune` only |
| Queries per verb | **0** |

Stains, air taint, damping and attunement all live in RAM, decayed or derived at read.

## Not built

- **Augment abilities** — chrome currently contributes acuity like anything else. The interesting
  version is *capability*: tracking a scent to the exit it left by, hearing through a wall. The
  `augments` plugin (slot-limited, clinic-installed, removable) is the right home.
- **The mutation mirror** — the organic path to a sharp sense, conflicting with chrome via the
  existing `player.chromed` guard.
- **Cooking's `taste`** currently scales on Cooking *skill* alone. Smell and taste are the same
  channel; a smell-attuned character reading better at the table would connect the two systems.

## History

- Shipped with a `jsonb_exists` scan of `player_inventory` behind `zone.smells`, on an uncooldowned
  verb. Replaced with the in-memory `liveCooks` registry; the fix also caught a pre-existing timer
  leak in `plateVessel`, which deletes rows without ending their sessions.
- `listen` was first written as an engine builtin, colliding with the broadcast plugin's existing
  `listen`. Resolved with the shared-verb pattern `cook` already uses.
- Overload originally had a hard `acuity >= 2` gate, meaning ordinary people were immune to
  everything. Removed — the threshold curve alone expresses it, and now nobody is immune.
- Overload prose was originally per-sense only, so a corpse and a blocked drain read identically.
  `source` was added so the sense that is *about* specificity doesn't go vague when it fails.
