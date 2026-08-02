# bodily

**Purpose** — the body's plumbing, and what it does to a room. Bowel and bladder pressure simulation, involuntary release, and the relief verbs — plus the social consequences, which are the actual point.

The **stains and the digestion loads stay in the engine** (`server/engine/bodily.js` substrate); this plugin owns the verbs, the routines and the reactions.

## Commands
**Relief:** `pee` / `urinate` / `piss` · `poop` / `defecate` / `shit` · `fart` · `flush` · `take shit` (scoop a fouled toilet) · `throw <filth> at <someone>`
**Washing:** `shower` · `soap` / `scrub`

## The routines are timed, and specific
Relief is a **timed routine onto a target** — a toilet, the ground, furniture, or a lying creature.
- **poop** drops legwear and squats for 20–40s.
- **pee** takes 10s, standing for male and sitting for female.
- Farts are **pressure-scaled**; plops and surface-varied pee-stream cues go out through `bodily.sfx`.

## The social layer
NPCs **yell when peed on**. Bystanders recoil at public elimination, and that also emits `bodily.publicRelief` → an **indecent-exposure charge**. Toilets stay **fouled until flushed**.

## Taking it back out
A fouled toilet can be **scooped by hand** — `take shit` / `get filth` — and the reason it costs almost nothing to support is that **the filth was already an item**: `pee in <bowl>` / `poop in <bowl>` produce an ordinary `player_inventory` row (engine `depositIntoVessel`), so a scooped turd is the same `item_vessel_filth`, arriving by a worse route. Nothing about dropping, stowing, containers, mixing bowls or cooking had to learn anything.

Two things stop it being a free pickup:
- it **clears the bowl** (you took the mess — the room stops smelling of it), and
- it goes **on your hands** via `stainCreatureBodyPart`, which soaks the garment covering a part when there is one. **Gloves take it instead of your skin**, which is the first mechanical argument the game has ever made for wearing any.

Bare hands mean `hygieneOf` reads `feces` off your `soiled_state` and the whole room can smell you, at strength 9 — the worst contaminant in the table. `wash hands` at any sink clears it (engine `clearBodyStain`, **part-scoped**, so it is a hand wash and not a free shower).

## A bowl fills up — and that is how people learn to flush

`TOILET_CAPACITY = 5`. The **fifth** deposit overflows, and so does every one after it: an overflowing toilet does not repair itself, and the only thing that fixes it is the verb nobody was using.

Three things happen on overflow, and all three are the point:

- **the floor is stained twice** (`stainZone` — the room now needs a `mop` as well as a `flush`),
- **the person sitting on it is stained** — on the **feet**, because their legwear is round their ankles, which is exactly why it lands there. Shoes take it if they're wearing any, same garment-first rule as everything else,
- **the room is told**, so the culprit isn't anonymous. Plus a `bodily.publicRelief` emit, so it's witness-gated into the same charge as any other public mess.

An overflowing bowl is also the **strongest smell the plugin can contribute** (strength 10, above an ordinary unflushed one) — you can smell it from the doorway, which is the warning.

**Bailing works.** `scoopToilet` decrements by ONE rather than emptying, so bare hands are a real if grim answer to an overflowing bowl — one deposit at a time, each one a `measure of filth` you now have to do something with.

### The nightly sweep

The city cleans itself; your bathroom doesn't. Toilets ride **exactly** the cadence `zones.stains` runs on — an unowned bowl is flushed nightly by whoever works there, a bowl in a room you OWN stays as you left it until the `STAIN_KEEP_DAYS` absentee backstop.

It reads the engine's `deepClean` flag off the new **`world.dailyMaintenance`** event rather than re-deriving the cadence, so the two can never drift. **Stateless** — the day comes from the game date, so a restart can't hand everyone a clean slate. The engine emits; it must not import a plugin.

A bowl with **no zone recorded is never spared** — nobody can own it, and sparing it would leak the entry forever.

### Scooping is not flushing
Taking the solid out removes **the mass, not the water**. That's the `residueToilets` state: the bowl reads and smells better (a weaker line, worded to say why) and is **exactly as unsafe to drink from** — `bodily.toiletContamination` keeps answering `fouled: true`, so the water and fillable plugins go on making you sick with no idea anything happened. **Only a flush moves water.**

For the same reason `foulToilet(id, 'poop')` marks the bowl **peed as well** — nobody sits down and does only the one thing, and that's what makes the leftover water worth being sick over. It is a **one-way rule**: a piss is just a piss. The piss line is suppressed underneath the fouled line so one bowl never reports as two.

Discovery is the `take filth` action-link in the `use toilet` panel, shown **only while the bowl is actually fouled**. The `take` handler is a self-gating specialized action: no toilet in the room and it returns `undefined`, so an ordinary ground pickup is untouched.

## Throwing it
`throw <filth> at <someone>` — and `throw <filth> at <someone>'s <part>`. This is **deliberately not a general throw mechanic**: there is no throwing in this game, and inventing ballistics for every item is a system, not a joke. Registered as an **input matcher** claiming only the `X at Y` shape where X resolves to something tagged `bodily_filth`.

`throw` used to be a **blanket alias for `stow`** — added for one shape, `throw <thing> in <bin>`, which stow's trash-bin path even narrates as "you throw it in the bin". But an alias rewrites the first word *before* dispatch, so it claimed every other shape too and `throw rock at bob` silently stowed a rock. It's now an ordinary builtin that reads its preposition: `in` → stow, `at` → whatever matcher claims it (bodily, for filth) or an honest refusal, bare → a usage line.

It is cheap because the landing was already built — `stainCreatureBodyPart` is the same call behind `shit on <someone>'s face`, **garment first, bare skin otherwise**. Flat **25% miss** (no stat roll: there is no throwing skill and inventing one would be the general mechanic this isn't), and the item is spent either way — a miss stains the floor instead.

An NPC yells, and takes a **−35 warmth** hit, the biggest single one in the plugin. The charge is a new **`filth_assault`, 1★**, emitted as `bodily.filthThrown` and mapped by surveillance exactly like public relief and graffiti. It is **not** `attack_npc`: nothing was damaged and nobody was hurt, so a 4-star police response to a thrown turd would be absurd — but it sits above graffiti.

## `shower` vs. MIS `wash`
`shower` is the **superset**: it strips `clothing_contamination`, `soiled_state`, `ejaculate_state` and `covered_in_blood`, and leaves a brief cosmetic "refreshed" badge. MIS `wash` deliberately leaves the bodily stains.

## Hooks
- `furniture.describe` — toilet and sink panels.
- `zone.smells` — the body's contribution to the smell pass.

## Events
- **Emits:** `bodily.sfx`, `bodily.publicRelief`
- **Consumes:** `player.logout`

## Tick
- **1m** — pressure.

## Discovery gaps (known, documented in the manifest)
`flush` and `shower` are room-object gated and error otherwise; both are surfaced as action-links inside the `use toilet` / `use shower` panels rather than on examine, because toilet and sink are not in examine's hardcoded `object_type` branches. `soap` is a declaration-only specialized action on `water_source` furniture — the sink advertises SOAP, and the verb self-resolves its target given a carried item tagged `soap`.

## See also
[docs/systems-hygiene.md](../../docs/systems-hygiene.md) — this is the source of most of what the hygiene substrate smells.
