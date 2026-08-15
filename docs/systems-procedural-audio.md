# Procedural Material/Action Audio (as built)

Sound generated from **what happened**, not from a library of recordings.

There is no "chopping a carrot" sound and no "chopping a rat haunch" sound. There is one chop
generator, and the material tells it how hard, how wet and how dense the thing under the blade is.
85 food items across ten material classes therefore cost one generator, and a new ingredient is
audible the day it's tagged without anyone opening the audio code.

```
ACTION → MATERIAL → INTENSITY → (STATE) → layer parameters → sound
```

Cooking is the first implementation, not the owner. `stream` and `flatus` already prove the point —
they're the same machinery with nothing culinary about them.

## Where it lives

| File | Holds |
|---|---|
| [`client/shared/procedural-sfx.js`](../client/shared/procedural-sfx.js) | **everything acoustic** — tables, generators, the seeded RNG. Dual-mode (window + ESM import) |
| [`plugins/audio/index.js`](../plugins/audio/index.js) | the routing: semantic event → parameters + seed → the wire |
| [`client/game/js/dispatch.js`](../client/game/js/dispatch.js) | `audio_sfx_proc` — rebuilds the cue from the seed and plays it |
| [`client/shared/audio-engine.js`](../client/shared/audio-engine.js) | the synth. **Not touched by this system** |

**No new synthesis was written.** `AudioEngine.buildLayer` already did audio-rate FM
(`fm: { rate, depth }`, so index = depth / carrier), filtered noise, pitch bends, tremolo and ADSR.
This system only decides the numbers, and emits the same `{ config: { duration, layers } }` def shape
every other cue in the game uses.

## The contract

A system that makes noise **emits semantics and never a sound**:

```js
emit('cooking.sfx', { zoneId, playerId, action: 'chop', material: 'wet_meat', intensity: 0.8 })
```

It must not know what that sounds like. The one thing a caller owns is the translation from its own
vocabulary to the shared one — cooking maps its `food_profile` catalog to material tokens, because
the profiles are cooking's property.

That separation is what lets smithing, chemistry, repair or industrial machinery emit
`{ action: 'impact', surface: 'metal', intensity }` and get audio for nothing.

## Parameters, not layers

**The server never sends layers.** It sends the semantic parameters plus a seed; the client rebuilds
the identical sound locally.

| cue | rendered | on the wire | |
|---|---|---|---|
| sizzle (high heat) | 5,958 B | **78 B** | 76× |
| boil (rolling) | 6,910 B | **74 B** | 93× |
| chop | 675 B | 68 B | 10× |

This matters because a sizzle is a *particle field* — ~32 randomised burst layers — and it goes to
every player in the room, and `deglaze` fires three cues at once. The first version shipped the
rendered layers and cost 6 KB a sniff.

Every random draw goes through **mulberry32**, seeded per cue. Server and client must agree exactly,
and a cue has to be reproducible while someone is tuning it. `buildActionCue` seeds on entry and
restores `Math.random` in a `finally` — leaving a seeded generator armed would make every subsequent
cue in that tab deterministic.

> Only generators with a **generated layer field** need this. All 33 other server-sent cues in the
> game are hand-authored with a handful of fixed layers and are already cheap; the 22-layer poker
> shuffle lives client-side and never crosses the wire.

## Generators

| | for | driven by |
|---|---|---|
| `impact` | utensils, cookware, a mallet, a plate | surface, weight, intensity |
| `chop` | chop / cut / mince / score | material hardness, moisture, density |
| `scrape` | spreading, scouring, dragging | surface, intensity |
| `stir` | stirring | viscosity, moisture, vessel |
| `pour` | liquid leaving a vessel | flow, viscosity |
| `sizzle` | food meeting heat | heat, moisture, fat |
| `boil` | liquid at temperature | heat, viscosity |
| `stream` | a jet of liquid on a surface | **pressure**, surface, phase |
| `flatus` | exactly what you think | **pressure** |
| `note` | a struck/plucked musical note | instrument voice, note, **velocity** |
| `footstep` | one step, per tile entered | footing class, intensity, **wet**, **foot** |
| `door` | a door leaf opening or closing | `door_type`, open/close, powered |
| `lock` | the mechanism, not the leaf | lock family, lock/unlock/**denied** |

One generator is not like the others: **`note`** makes a *musical* sound rather than noise made by an
object, and it is the only one here with **no `vary()` in it at all**. Everything above jitters itself
so the ninth chop doesn't sound machine-stamped; a note must not, because two people standing in the
same room build the performance independently and have to arrive at the same sound. There is no seed
on its wire format for the same reason — there is nothing random to reproduce. Its table is
`INSTRUMENTS`, and the parameter the whole thing rests on is `fm.depthTo`: a modulation index that
**collapses across the note** is what reads as *struck*. See [systems-instruments.md](systems-instruments.md).

Deliberately **not** separate generators: `fry_crackle` is `sizzle` at high heat; `whisk` is `stir`
with high-frequency movement; metal/ceramic/wood resonance are `impact` with a surface. Reuse over
proliferation is the whole design.

### Styles

Pressure alone made every fart the same fart, just longer and lower. `flatus` therefore has a second
axis: **style** — brassy, squeak, drone, flutter, staccato, falter, silent, ripper — expressed as
multipliers over the same generator (pitch, duration, buzz rate, tremolo depth, noise, pulse count).
Adding one is a row in a table, not a new function, and multi-pulse styles reuse the same burst-field
technique `sizzle` uses.

The style is rolled from the **seed**, so the client reproduces whatever the server picked, and
eligibility is gated by pressure — a nearly-empty gut can only squeak, and a drone needs real
commitment.

The style NAME is a shared vocabulary, like a material token. The **caller** owns when each style can
occur and what the room reads; the **generator** owns what it sounds like. Neither imports the other,
so a new style needs a line in both — which is honest, because it genuinely needs a sound and
something for the room to read. A regress case asserts the two key sets match.

### Tables

**Materials** are acoustic, not culinary — `hardness`, `moisture`, `density`, `viscosity`, `fat`.
**Surfaces** ring: wood, metal, ceramic. **States** bend a material for an unusual condition
(`frozen`, `cooked`).

States are the *sparse* alternative to per-item authoring. Putting five acoustic numbers on all 85
food items would be 425 hand-tuned values expressing differences nobody can hear — a carrot and a
potato chop identically at any resolution a game client reproduces. An item can override its class
with `tags.sound_material` for genuine outliers (a bone, a husk, a shell), and `frozen` costs nothing
because the cooking system already computes it for thaw timing.

> The tag is `sound_material`, **not** `material` — that name is long since taken by the crafting
> flag, and a duplicate key in the tag catalog silently overwrites rather than erroring.

## Tuning

The knobs of a procedural system are its **tables**, not its cues: there is no single "chop" to edit,
there is a hardness number that makes every chop brighter.

So the tables are surfaced in the dev panel (**Sounds → Sound Effects → Procedural material/action
tables**) as four entries — `proc:materials`, `proc:surfaces`, `proc:streams`, `proc:flatus` — riding the existing
`interface_sfx` override plumbing. Same fetch, same editor, same persistence the poker cues use. No
new table and no new endpoint.

Overrides merge **per key**, so tuning one material doesn't require hand-maintaining the other nine,
and a material added in code later still appears for someone carrying an old override.

## Intensity

Every generator takes normalised 0..1 values, and intensity is expected to mean something real rather
than being a constant someone picked:

- **cooking** — burner tier drives `heat`; piece count drives chop intensity
- **bodily** — `digestive_load` / `hydration_load` over 110 drives stream and flatus pressure

That last one is the clearest example of the design paying off. The old hand-authored pee stream
sounded identical whether the character was bursting or barely needed to go, because the only inputs
were the surface and a phase. Now a full bladder is a hard, high, tight jet that splatters and takes
several spurts to finish; a nearly-empty one is a loose dribble that doesn't splash at all.

## The dense tier — footsteps, doors, locks

Everything above fires when a player *does* something. This tier is the world
running continuously underneath that, and it exists for the `log` rung: a room
description is abbreviated there, so the ground under your feet and the door
behind you arrive as sound rather than as lines you have to read.

It is gated by **Sound Detail** (`off` / `limited` / `full`) — one row in
`A11Y_OPTIONS`, defaulting to `full` only at the `log` rung. See
[systems-display-mode.md](systems-display-mode.md#sound-detail).

**The gate is a stamp on the NEW cues, never a category on all of them.** The
server sets `tier: 'full'` and the client drops those below the top rung; an
unmarked cue is untouched. That is what makes `limited` — what everybody who has
never chosen gets — a *provable* no-op against every cue that shipped before this,
and it is the property that made the tier safe to turn on for the whole game.

### A crossing is a walk, not a click

A room transition is not an instant. `stepCadenceMs(player)` — the game's one step
clock, in [plugins/pacing/index.js](../plugins/pacing/index.js), the same number
the pacing throttle uses and `plugins/pinch`'s walker paces off — says a crossing
takes 900ms walking, 700 running, 350 sprinting, road-scaled. One 130ms cue across
that span is a tap, not a footstep, and no amount of gain fixes it.

So `movement.step` sends **one message describing a cadence**, not one footfall:
`series: {count: 4, interval: cadence/2, key: 'step'}`. The client schedules it
([dispatch.js](../client/game/js/dispatch.js) — `playSeries`), alternating `foot`
per footfall and deriving a per-footfall seed from the base one, so the copy the
room hears is the same performance the walker hears.

One message, not four, for the reason the tier is affordable at all: a step is
~70 bytes, and quadrupling the message count on the per-move path to say something
the client can schedule itself gives that back for nothing.

⚠ **The tail is the arrival, and it falls out of cancellation rather than being a
special case.** Four footfalls at half-cadence span 1.5× a crossing, and a new step
*replaces* the pending remainder. So walking continuously is one unbroken cadence,
and the last two footfalls only ever play when you actually **stopped** — which is
precisely when a listener needs to know they have arrived. Two consequences: the
server no longer flips `foot` per move (the client advances it within the series,
so flipping too would land the same foot twice at every room boundary), and any new
repeating cue must carry a `key` or it will pile up on itself.

### The level, and why it is in the generator

The tier shipped **inaudible**, and the cause was two defensible decisions
multiplying. The generators write quiet layers because these sounds are the floor
of the mix; the transport then applies its own sub-1 gain (`OWN_STEP_GAIN`, the
door's `0.6`) for the same reason. Together they put footsteps 13–20 dB under a cue
like `chop` — under the noise floor of a rain bed.

The correction is `STEP_LEVEL` / `DOOR_LEVEL` / `LOCK_LEVEL` in
[procedural-sfx.js](../client/shared/procedural-sfx.js), which put the family at
**~6 dB under `chop`**. They live in the generator, not the transport, because the
transport numbers each say something true — your own feet against someone else's, a
refusal against an open — and raising them past 1 would destroy that reading to fix
a problem in the source material. **The three constants differ only to cancel three
different transport gains; they are not three opinions about loudness.** Retune by
moving the 6 dB target, never one family on its own.

### Nothing is authored twice

| The sound of | comes from | authored |
|---|---|---|
| outdoor ground | `flags.terrain` | already the ground-surface SSOT |
| indoor floor | `flags.floor` | **new** — 591 interiors, seeded then hand-corrected |
| a door leaf | `doors.door_type` | already on every door |
| a lock | the door's `lock:<family>` tag | already on every locked door |

Three of those four cost nothing. `flags.floor` is the exception and it has to
be: `resolveTerrain` returns `null` indoors **by design** — an interior has no
ground surface — so the indoor half of the question genuinely had no answer in the
world yet. [`scripts/content/seed-floors.mjs`](../scripts/content/seed-floors.mjs)
proposes one per room from the zone name and `building_type`; it writes only where
the key is absent, so it is re-runnable and can never overwrite a hand-made call.

Footing classes are **coarse on purpose**. Redrock, hardpan, alkali, basalt and a
plateau are one sound under a boot — the same argument that keeps 85 food items on
ten material classes. A regress case walks the terrain enum in `tagCatalog.js` and
fails if any value is unmapped, because a terrain added later is otherwise the
wrong ground under a whole region with nothing to notice it.

### Bearable for ten thousand repetitions

A footstep fires on nearly every input for as long as somebody plays, which makes
it the only cue in the game where listening *fatigue* is the design problem. Volume
is not the answer — **a quiet sound repeated identically is more irritating than a
loud one that varies.** Four things carry it:

- **Alternating feet.** `foot` is 0/1 from a per-player RAM counter; the trailing
  foot is fractionally lighter and lower. `vary()` alone cannot do this — random
  jitter is heard as *noise*, an alternating pair is heard as *walking*. Regress
  pins that the two feet differ at the same seed.
- **A cadence floor.** Auto-walk, run mode and a held key deliver moves faster than
  a person walks. Under `MIN_STEP_MS` the step is **dropped, never queued** — a
  queue turns a sprint into a machine-gun that runs on after you stop.
- **Under the mix.** Own steps at 0.55, other people's at 0.3. A footstep is the
  floor of the mix, not an event in it.
- **Steps get out of the way of speech.** Anything that carries information —
  a refused lock, combat, dialogue — sits above this tier deliberately.

### Blending with the weather

A step does not merely duck under rain, it **gets wet**. `wet` (0–1, from
`getZonePrecip`, and only outdoors) moves the step toward the rain's own spectrum:
the strike is deadened, the top end fills in, a splash layer appears. Then it ducks
as well. The two together are the difference between *"quieter"* and *"in the
rain"* — which is the whole point, since a cue that only drops in volume still cuts
through the bed with the wrong timbre.

⚠ **Only the DELTA does anything.** `wet` is applied as
`max(0, wet − surface.wetness)`, so rain changes nothing about standing water or a
marsh. The first version scaled by `wet` directly and went on softening a surface
that could not get any softer; regress pins it.

### `denied` is information, not decoration

`lock` has three cues and the third is the one that earns its place. At the `log`
rung a lock that opens and a lock that turns you away must not be the same sound,
or the player is reading the log to find out whether the door in front of them just
worked. It is the one cue in this tier deliberately mixed **above** the others.

## History

- Shipped rendering layers server-side, at 6 KB per sizzle to every player in the zone. Replaced with
  parameters + seed; the generator moved to `client/shared/` so one implementation serves both sides.
- The dev-panel tag `material` collided with the existing crafting-material flag. Because both were
  keys in the same object literal, the new one **silently overwrote** the old rather than erroring —
  caught only by `content:lint` failing on 21 unrelated items. Renamed `sound_material`.
- The pee stream was `sendToPlayer` only, so a character relieving themselves in a crowded room was
  silent to the room. Both it and `flatus` are zone-audible now.
