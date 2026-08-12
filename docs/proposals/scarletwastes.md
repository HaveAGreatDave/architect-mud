# The Scarletwastes & the Thornwarren (as built)

> **Status: BUILT, 2026-08-12.** The region, its weather, the walled Wildblood town and its six
> people all ship. What is deliberately NOT built is listed at the bottom (the recruitment arc, the
> mutation grant, the Wildblood item set) — those were always a second pass.
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

**Every tile outside the town is `redrock` and nothing else.** That is the brief, not a shortcut: the
region ships as one flat canvas so it can be painted by hand in the Studio afterwards. There are no
roads, no scrub, no marsh. Do not scatter terrain into it in code. Paint it.

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

## Not built (second pass)

The recruitment arc (`quest_wild_proving` / `_quickening` / `_hunt`), the `GRANT_MUTATION` action,
`mut_thornhide`, and the mutagen/feral-gear/rad-med item set — all still specced in
[wildblood-stronghold.md](wildblood-stronghold.md). The town is walkable and populated without them.

## Rebuilding it

```bash
node scripts/build-scarletwastes.mjs
node scripts/build-thornwarren-npcs.mjs
npm run content:import && npm run map:derive
```

Both generators are idempotent and carry any existing `marker` forward.
`scripts/demote-thornwarren-shells.mjs` is the one-shot that retired the four empty Coldwater camp
shells to a picket; it has already run.
