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

## History

- Shipped rendering layers server-side, at 6 KB per sizzle to every player in the zone. Replaced with
  parameters + seed; the generator moved to `client/shared/` so one implementation serves both sides.
- The dev-panel tag `material` collided with the existing crafting-material flag. Because both were
  keys in the same object literal, the new one **silently overwrote** the old rather than erroring —
  caught only by `content:lint` failing on 21 unrelated items. Renamed `sound_material`.
- The pee stream was `sendToPlayer` only, so a character relieving themselves in a crowded room was
  silent to the room. Both it and `flatus` are zone-audible now.
