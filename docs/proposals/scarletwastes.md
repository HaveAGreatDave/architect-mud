# The Scarletwastes & the Thornwarren (as built)

> **Status: BUILT, 2026-08-12; the infrastructure pass shipped 2026-08-18.** The region, its
> weather, the walled Wildblood town and its people all ship. The second pass added what the town
> did not have: **fifteen enterable rooms**, sixteen people, a gate that is actually shut, three
> guards on the road outside it and the things the town makes. What is still deliberately NOT built
> is listed at the bottom.
>
> Read alongside [systems-wildlands.md](../systems-wildlands.md) (the Curtain and the South Gate that
> point at this place), [systems-ideologies.md](../systems-ideologies.md) (stance/path, and why the
> peace out here is structural), [systems-weather-extreme.md](../systems-weather-extreme.md) (acid
> rain, which this region extended), and [reference/land-taxonomy.md](../reference/land-taxonomy.md)
> (region vs district vs terrain).

## What it is

A fourth region on `map_world`: **x1000–1092, y950–1001**, 93×52, **4,836 tiles**, the same box size
as Coldwater. Zone ids are `zone_scw_<x>_<y>` and match their grid coordinates exactly (the Reach's
id/coord mismatch is a trap; it is not repeated here).

Reached from the northwest off Coldwater's rim: by air at **The Strip** (`scarlet_strip`, lawless, no
rental, a windsock repaired with a shirt) or overland to **The Roadhead** (`1024_957`, truck depot +
fuel). The old Deeper Wild tile south of the South Gate now names it and points at it.

### The landform (2026-08-12)

The region originally shipped as one flat sheet of `redrock`, to be hand-painted in the Studio later.
It never was, and 4,836 identical tiles is not a canvas, it is a colour. The landform is now
**derived** in the generator, under the rule that replaces "paint it later":

> **The ground is a field, not a sprinkle.**

Every terrain comes off **one continuous height surface** (two-octave hashed value noise, no RNG, so
a rebuild is byte-identical), and each family is a threshold on it. That is what makes the bands
contiguous: a mesa always sheds its own scree skirt, never a cliff straight to hardpan, and scrub
takes the low ground because the low ground is where the runoff goes. A per-tile scatter — a tile
disagreeing with its neighbour by accident — is the failure the original brief was guarding against,
and it is still the thing not to do. **If you want it different, change the surface.**

| Family | `flags.terrain` | Tiles | What it is |
|---|---|---|---|
| `flat` | `redrock` | 1792 | the original country, still what you cross most of |
| `scrub` | `scrub` | 1074 | grey-green thorn in the drainage lines |
| `mesa` | `plateau` | 542 | caprock tablelands, flat on top and a long way up |
| `scree` | `gravel` | 500 | the talus skirt a mesa sheds |
| `cliff` | `cliff` | 324 | the rim of a tableland. **Impassable** |
| `pan` | `sand` | 121 | dry lake floor, the flattest ground here |
| `ramp` | `ramp` | 77 | the break in a rim, and the only way up |
| `lake` | `water` | 68 | the Slake |
| `shore` | `dirt` | 29 | rutted cart ground at the waterline |
| `haul` | `dirt_road` | 20 | the Water Road |

### The mesas are walled, and the gaps are the point

A mesa tile with a lower neighbour is the edge of a tableland, and the edge of a tableland is a face
you do not walk up. That one rule turns loose high ground into **walled massifs** — `cliff` is the only
impassable ground in the game ([systems-terrain.md](../systems-terrain.md#high-ground-cliff--plateau--ramp-2026-08-12))
— so crossing this country becomes a question of where the ways through are.

The ways through come from a **second continuous field**, not a per-tile roll, and that is the whole
difference between a pass and a hole: noise above a threshold clusters, so a gap is two or three
walkable tiles in a row you can see from a distance and aim for. A hash per rim tile would scatter
single-tile pinholes around every massif, and a wall with a door every fifth stone funnels nobody.

A flood-fill pass then **guarantees every massif has a way up**: any massif whose rim holds no pass has
its most pass-like tile promoted to one. A sealed tableland is the worst outcome available, because it
breaks the reading — "there is no way up here" has to imply "so there is one somewhere else". A
one-tile massif is exempt: that is a stack of rock with no inside to reach, and cutting a notch into a
boulder to reach its own outer edge is not a pass.

**The high-ground test is not `fbm > MESA_H`.** It also excludes the town box, the authored set, the
lake and the road, because a tile the landform pass never gets to decide is not high ground whatever
the height field says. Ask the field alone and the rim believes the massif continues into the
Thornwarren, declines to draw a face there, and the tableland meets the thorn wall with no drop between
them. Verified after every build: **zero plateau tiles touch open ground.**

**Authored tiles and the whole town box are exempt** and keep flat `redrock`. Those are set-pieces
whose prose names the surface underfoot, and a mesa top under the Screaming Line contradicts the
sentence above it.

### The Slake, and why it is not the town's pride

The lake sits at **(1030, 978)**, west of the wall, in the floor of the region's one real basin. It
is the Wildblood's water source and it is deliberately **not** the thing they boast about. The
Sweetwater takes rain off the roofs; that is what Sill Moraine built. The Slake is the dry-month
fallback: hauled by cart, tipped into a second plated inlet at the top of the same limestone and bone
beds, tested in the same glass tubes. **SLAKE WATER: BOTH BEDS, TWICE.**

That ordering is load-bearing. A town with a lake at the door does not need to invent the best
filtration for sixty miles, and the filtration is the argument. So the lake is authored as *work* —
ruts, barrels, a graded hard standing, two people leaning into a loaded cart and not talking.

The **Water Road** runs from the waterline round the outside of the thorn to the Sally Gate, which is
now the water gate in everything but name. It is an explicit tile list, not a derived path: a route
that bends around a town is a decision somebody made with a loaded cart, and it stops one tile short
of the water, because a road drawn one tile further is a road in the lake.

**The basin is the second hole in the radiation curve** (rad 4, keyed off the lake field so the hard
standing is not a sixteen-point step from the water it stands in) for exactly the same reason the
town is the first one.

## The two things that make it a place rather than a rectangle

### Acid rain, and the one engine change in the whole feature

Acid rain was a purely **global hero event**: `heroEventForDate()` seeds one world-wide day in ~25
(`HERO_EVENT_DAY_CHANCE = 0.04`). A region that is acidic *most of the time* cannot be said that way,
and raising the global chance to get it would make the entire world acidic to flavour one corner.

The seam that made it cheap is that the acid **hazard** was already local. `gameLoop.js` fires on
`getZonePrecip(zone).precipType === 'acid'` per tile. So the change is one new key on the existing
per-region climate bias — `acid` (0..1), beside `temp` and `dryness`, in `plugins/weather/index.js` —
and everything downstream works untouched: the `corroding` effect, `player.acidCover` shielding,
gear durability wear, the rain audio route, the broadcast pool, the forecast.

**The roll belongs to the weather cell, never the tile.** Each cell gets a stable `seed` at spawn and
keeps it for life, so a squall is acid or it is not and stays that way as it drifts. A per-tile roll
would put the boundary between burning and not burning one step apart, which is not weather. The
region ships `climate_bias: { acid: 0.75, dryness: 0.8, temp: 7 }`, tunable from the dev panel's
Weather tab like any other region. **A global hero acid day still overrides everything, everywhere,
including here** — that override is applied after the bias and was left alone.

### Radiation is a gradient, and the town is the hole in it

`flags.radiation` rises toward the **Quickening Pool** (`1057_988`, 70, lethal), which sits
**outside** the wall on purpose: a rite you walk out to is a rite somebody chose. Open waste runs
9–58 on distance. Inside the wall it drops to **12**, lower than the country around it, because these
people swept, sealed and drained the ground they intended to raise children on.

That dip is the region's argument made in integers, and it is the only place the argument is made at
all. **A town that irradiates its own children is not this town.**

## The Thornwarren

A walled town at **x1038–1054, y968–984**: 62 wall tiles, two gates, 195 tiles inside.

### The wall is grown, not built

Thorn, cultivated for thirty years through a lattice of salvage plate, and where you cut it, it
closes. The Architect's Curtain is a sheet of hard light: absolute, sterile, doing forever exactly
what it was told. This one is a hedge that heals. Two philosophies stated as masonry, and neither
side has to say a word about it.

**Technically it is `building_type` and nothing else** — no `is_building`, no `building_name`. Read
the comment in the generator before changing that. `bt` (what stops a truck) comes from
`building_type` alone, while the *marker namespace* keys off `is_building` and derives the code from
`building_name`. Sixty-two tiles called "Thornwarren Wall N" all reach for `TW`, collide with
Terminus's wall, and spill into numbered codes. That is the exhaustion Terminus hit at **thirteen**
tiles. A boundary is not a landmark; the town reads on the map as its own outline.

### The rule the whole town is written under

> **The terror is on the approach. The inside is domestic, and nothing ever remarks on it.**

**Outside** (`1046_963`–`1046_967`): the trophy road. Staked drones, skulls wired at the jaw, bone
flutes tuned by drilled spacing, hounds that shadow and never close. All of it is a performance, and
the tell is that it is **maintained**: the wire is bright and replaced a bit at a time, the way you
keep anything you intend to keep. The props are visibly acid-eaten and re-made.

**Inside**: laundry pegged in order of size, a stew nobody will say the contents of, a school slate,
a bathhouse queue, a burial ground with a full water jar on a new marker, and an argument about a
bucket. The ambient pools share no words and no subject.

**The single highest-leverage object is the mask rack at the North Gate.** The masks are lined with
quilted rag, stitched down flat at every edge, **so they do not chafe on a long shift**. There is a
tally board of names against hours. The horror is a costume, the costume is rota'd, and somebody's
grandmother sews the lining.

The town's proudest structure is **The Sweetwater**: rain off every roof, through settling tanks and
beds of crushed limestone and burnt bone, into a covered cistern, tested twice a day in two hands for
years. The best engineering for sixty miles belongs to the people the city calls animals. Nobody
mentions this.

### The six

Faction `ideology_wildblood`. Names checked against all 192 existing NPCs.

| NPC | Role | Where |
|---|---|---|
| **The Chorus** | Elder. Keeps the rota. Decided the town would frighten people, and discusses it as staffing. | The Chorus' Den |
| **Sill Moraine** | Water engineer. Built the covers. The Chorus's daughter, which neither of them mentions. | The Sweetwater |
| **Rindle Ashcroft** | Trader (`OPEN_SHOP`). The eleven-name card is the town's whole economy. | Rindle's |
| **Gristle Thole** | Physic. Burns, backs, teeth, babies. Wore an unkind name flat. | The Physic |
| **Bracken Hale** | Houndmaster. The scariest thing here, doing ears with a rag. | The Houndyard |
| **Ossa Vurn** | Fifteen. Wears the mask, hates it, wants the tanks. | The North Gate (Tue/Fri 12–18) |

**Ossa is Sledge Vurn's son** — the built Coldwater Breaker. This is the one deliberate exception to
the unique-name rule, and it is load-bearing: it connects the town to the three Wildblood who already
existed inside the walls, and it is how Ossa explains why he does the shift.

**Nobody ever says they are not monsters.** Not one line argues it, defends the town, or invites the
player to revise. Thole gets exactly one beat about it and closes the subject himself, because he has
a patient and you are not it. The revision is the player's own work or it does not happen.

## The other two presences (recon, not bases)

Deliberately small, because only two orders have established homes in the world (Ascendants;
Exodus at Terminus) and this adds one, not three.

- **The Rise** (`1041_961`) — a Long Watch hide. Netting over a frame, a lens catching the light,
  nobody comes down. This is the only pairing that can reach the ideology model's **−200 resting
  floor** (opposite stance *and* different path), so it is where real friction lives.
- **The Stripping Ground** (`1068_990`, `1069_990`) — a Null scavenger crew, working wrecks
  methodically and keeping only the parts that used to do the thinking. Expansion-gated ideology, so
  it can never win the player's lean: a presence you meet before the order is playable.

**The uneasy peace is structural, not authored.** Wildblood and Null share `renounce` stance and
differ only by path, so `restingRep` puts them at **0**: they can cool toward each other and can
never permanently hate each other. Only the Long Watch can bottom out. The ideology model already
encoded this; nothing was added for it.

## The infrastructure pass (2026-08-18)

The town shipped as 195 named tiles and **not one room**. Every landmark in it — the Physic, the
Chorus' Den, Rindle's — was a patch of ground with a good sentence over it, which reads fine walking
through and gives you nowhere to stand still.

### The rule the interiors are written under

> **A mutation is a trade, and the town is organised around what each body turned out to be good
> for.**

Nobody here is "a mutant". They are the woman whose hands run twenty degrees cold and therefore
holds the mutagen stock; the man whose skin sheds heat and therefore takes ingots off the fire
barehanded; the one who has not slept in thirty-one years and therefore owns the night rota in the
long-term ward. Every job in this town is held by the person whose body suits it, the rotas are
chalked on walls where anybody can read them, and **no line of dialogue anywhere states it.**

The register is body horror on the outside and domestic on the inside, and — unlike Terminus, where
the two are separated by a wall — here they are usually **in the same room**. The Fleshery is a
horror and it is also a clinic with a mop, a kettle and one chipped mug, and neither cancels the
other. **Nobody ever argues that they are not monsters**; not one line defends the town or invites
the player to revise, exactly as when the town shipped.

Aesthetically it is chaos: nothing matches, everything is made of eleven other things. But nothing
is dirty and nothing is broken, because these people mend. **Chaos is a look here, not a failure.**

### The fifteen rooms

Two open lanes cross at the Commons — the row at y976 and the run at x1046 — and **every building
fronts one and none sits on either**. A facade is solid, so a plaza whose four neighbours are all
doors is a cul-de-sac; the generator flood-fills the town and all 225 interior tiles stay reachable.

| Room | Who | What it is for |
|---|---|---|
| **The Fleshery** | Tallow Skeen | The Quickening. A table with a drain, a padded restraint, a rack of flasks, a kettle, and a chair at the head that somebody sits in for six hours |
| **The Milkhouse** | Wick Ollam | **The mutagen stock.** 211 flasks in cut felt, the only padlock in the town, and a log whose gaps each have a name beside them |
| **The Physic** | Gristle Thole | The hospital. Instruments made across the yard; a drawer labelled TEETH and one labelled TEETH, THE OTHER KIND |
| **The Kept** | Marrow Kell | Long-term care for the ones the Quickening took too far. Ten beds, ten different frames |
| **The Whelping Room** | Cobble Enns | The children, and the numbers by the door, and the much longer list under them |
| **The Chorus' Den** | The Chorus | Cushions, salvage, and a rota that is the entire government of the place |
| **The Long Fire** | Pitch Halloway | Forty feet of fire trench. Nobody pays; there is an owing board instead |
| **The Foundry** | Ferrous Bight | Eleven blades and no two alike, because eleven hands and no two alike |
| **The Thorn Gate** | Quarrel Nine, Ossa Vurn | The mask rack, quilted and stitched flat, and the tally board |
| **The Sweetwater** | Sill Moraine | The test bench, twice a day, for years |
| **The Bathhouse** | Brine Tack | The most used building in the town, and the one where nobody is hiding anything |
| **Rindle's** | Rindle Ashcroft | Ordinary stock on the left, the reason people drive four days on the right |
| **The Kiln** | Sump Rhee | Every bowl in the Thornwarren, and the red jars the flasks live in |
| **The Roofwalk** | — | The rain harvest, and WE BUILT THIS written under the top rail |
| **The Houndyard** | Bracken Hale | Sixteen collars on pegs with no dogs attached, oiled on the same rota as the working ones |

The single highest-leverage object is still **the mask rack**, and the second is **the sign in The
Kept**, which carries the only sentence in the town that could be called a creed and is not about
evolution: **NOBODY IS CARRIED OUT ALONE.**

### The guards, and the first non-aggro enemies in the game

Three templates stand outside the wall: **a Gate Warden** (320 hp) at each gate, **a Road Harrow**
(230 hp) walking the trophy road, and **a Field Cull** (180 hp) on a circuit of the open ground.
They are enormous, they are wrong in specific ways, and they do not speak. Quarrel Nine does the
talking; they do the other thing.

**⚠ Their `behavior` is `sentinel` and they carry no `behaviour_graph`, and that is load-bearing.**
`canAggro` in [gameLoop.js](../../server/engine/gameLoop.js) is exactly
`behavior === 'aggressive' || behavior === 'territorial' || behaviour_graph._start` — nothing else
in the game ever aggros on its own, and these are the first enemies to sit outside that set. Flip
any one of the three and the road up to the gate becomes a road nobody can walk. Attacking one sets
`targetId` on the ordinary combat path and then it fights, and so does everything beside it. Regress
asserts all three, by id.

### The way in: `thornwarrengate`

The town shipped **open** — 195 tiles anybody could walk into off the waste. Survivable while it was
scenery; not survivable with a mutagen store, a ritual room and ten people in beds behind the wall.

The lock lives in [plugins/mutations/door.js](../../plugins/mutations/door.js) and is the deliberate
sibling of psionics' `terminusgate`, written twice rather than shared. Two halves, both required:

1. **`thorn_admitted`** — Quarrel Nine set it. The gate is never opened by standing at it.
2. **The flesh is not already somebody else's** — it reads the ordinary `path_*` ideology flags and
   refuses when machine/mind/human is **at or above** `path_flesh`. **A tie refuses.**

**Reputation is deliberately not read.** Half this town has taken money off the city and all of them
despise it; standing is what you have done, and the path is what you decided to be.

The refusal is flat except once: the path refusal fires the warden's one-shot line
(`thorn_gate_told`), because **a Wildblood who would not say why has started behaving like the
city.**

The doors sit on the seam **between the gate tile and the first tile inside**, never on the
approach, so `quest_wild_seen` (which sends the player to stand on `zone_scw_1046_968`) keeps
working for somebody who has not been let in. You can stand in the gateway. You cannot go through
it.

**The chain**, which sits in front of the arc that already existed rather than replacing any of it:

1. **`quest_thorn_toll`, "The Toll"** — one of Bracken Hale's hounds is out on the flats, heavy in
   whelp, and he is fifty-one and has been out three nights. Quarrel Nine is explicit that this is
   not a test and buys you nothing, and asks anyway. She is telling the truth: it is not a test.
2. **The question** — *"What are you going to do with your body?"* Answering it one particular way
   runs `ADJUST_PATH { flesh }`, `ADJUST_STANCE` and sets `thorn_admitted`. The other two answers
   are treated as real answers and she says so.
3. Then the built arc runs on inside: `quest_wild_seen` → `quest_wild_proving` →
   `quest_wild_quickening`, and `wildblood_trust` 1 → 2 → 3, which is still the only thing that
   opens the mutagen flask on Rindle's shelf.

### What they make

Fourteen items and six stationless recipes, because the Thornwarren has no chem lab and never will.
Weapons cut for one specific body — a hooked pommel for a hand with no thumb, a two-hand haft with
its grips a hand apart in height, a spike with a hide-lined socket and no grip because it was never
meant to be gripped. A living thorn flail that has to be watered. A gate mask that is a horror
outside and quilted rag inside. Bone meal, grave salt, drawing poultices, thorn tea, bone broth, and
one **raw draw** straight off the Pool that Wick Ollam will describe to you at length and will not
sell you.

### Two latent bugs this pass surfaced

Both are the same class: **the generator was stale against a later hand-fix, and every rebuild
silently reverted it.**

- **The Deadleg's door.** Its shed interior, vendor and depot were added by a later script this
  generator never knew about, so every run replaced its `north` exit — the only way into the shed —
  with an ordinary link to the hardpan behind it. It is now a `preserve` entry in the buildings
  table: the geometry pass knows it is a facade and regenerates nothing else about it.
- **The depot shape.** The generator wrote the old loose `truck_depot` (no `yard`) onto the yard
  tile, which trucking's regress fails by name — a flag on open hardstand has no building for the
  renderer to extrude, so `drive` pulls a rig out of bare ground. The depot proper lives on the shed
  interior; the tile is the **yard** it names.

And a third of the same shape: **nothing ever pruned a blocked-connection file** when the geometry
stopped needing one, so promoting fifteen tiles to facades left walls standing in front of walls.
The generator now sweeps its own namespace first.

## Not built

The recruitment arc, `GRANT_MUTATION`, `mut_thornhide` and the mutagen/feral-gear/rad-med item set
are all **built** now. What is left of [wildblood-stronghold.md](wildblood-stronghold.md) is the
repeatable `quest_wild_hunt` gig loop and nothing else.

Still genuinely unbuilt, and each one is a real gap rather than a deferral:

- **The town has no economy of its own.** Nobody buys what the Foundry or the Kiln makes, and the
  owing board in the Long Fire is prose rather than a ledger. The most interesting economic idea in
  the region — a town that runs on debt nobody intends to settle — is currently a wall decoration.
- **Nothing ever goes wrong.** There is no raid, no bad season, no Ascendant survey crew that
  actually turns up. Quarrel Nine names four incidents at the gate and all four are backstory.
- **The Breakers cell inside Coldwater is not connected to any of this.** Ossa Vurn is Sledge Vurn's
  son and the game still says so in exactly one place.
- **The Quickening's outcomes are not modelled.** Tallow Skeen's tally board says 360 / 38 / 9 / 4,
  and the game only implements the first number.

## Rebuilding it

```bash
node scripts/build-scarletwastes.mjs
node scripts/build-thornwarren-npcs.mjs
node scripts/build-thornwarren-people.mjs
npm run content:import && npm run map:derive
```

Both generators are idempotent and carry any existing `marker` forward.
`scripts/demote-thornwarren-shells.mjs` is the one-shot that retired the four empty Coldwater camp
shells to a picket; it has already run.
