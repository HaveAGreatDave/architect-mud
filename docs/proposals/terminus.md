# TERMINUS — the Exodus settlement (as built)

> **Status: BUILT.** Pass 1 (the apron) shipped 2026-08-12. **The redraw shipped 2026-08-18** and
> is what this document describes: a 40×40 region with a derived landform, a walled compound, a
> launch pad at the centre of it, 16 enterable interiors, 15 people and a way in. What is
> deliberately not built is listed at the bottom.
>
> Read alongside [systems-psionics.md](../systems-psionics.md) (the discipline behind the wall, and
> the `psi` lock this region's doors use), [systems-ideologies.md](../systems-ideologies.md)
> (stance/path, which is what the gate actually reads),
> [proposals/scarletwastes.md](scarletwastes.md) (the other walled town, and the landform machinery
> this borrowed), and [reference/land-taxonomy.md](../reference/land-taxonomy.md).

---

## The finding that shapes everything

**"Exodus" is an ORDER, not a place.** One of the four (`content/orgs/ideology_exodus.json`):
renounce · mind, motto *awaken*. And the codex is explicit
(`plugins/tablet/codex/chapters.js:238`):

> *"They are the only order whose stated goal is to leave, and the only one that will not tell you
> where to."*

So the settlement **cannot be called Exodus** — the void's `heading: 'Exodus'` reads as *the
direction the Exodus went*. It is called **Terminus**: a transit word meaning end-of-the-line, used
by people who meant it as the last stop before somewhere better. They were right about the first
part.

**The Reach is where you go to stop. Terminus is where you go to keep going.** Two forks of one
void, and Cass Renner at Buzzard Field wrote the pairing before anybody noticed
(*"You think about where you'd go? If you had to go." … "No. That's the point of here."*).

---

## Geography (as built)

| | |
|---|---|
| Bounding box | **x 1200–1239, y 921–960** — 40×40, **1,600 tiles**, hole-free |
| Zone ids | `zone_terminus_<x>_<y>`, matching grid coordinates exactly |
| Arrival | `zone_terminus_1200_940`, on the west rim, off Coldwater's east limb |
| Compound | wall ring **x1211–1229, y931–949** (19×19, 72 wall tiles), one gate at **(1211, 940)** |
| Inside | x1212–1228, y932–948 — 17×17, 289 tiles |
| The pad | **(1220, 940)**, the exact centre of the compound and of the region |

**The region grew east, north and south, and its west rim did not move**, so the void's arrival tile
is unchanged and **no engine change was needed for any of the redraw**. `VOIDS` still reads
`{ key: 'exodus', dest: 'zone_terminus_1200_940', length: 12 }` in both directions.

### What the redraw changed, and why

Pass 1 drew the wall as a straight **column** down the middle of a 14×14 box: apron west, rumour
east. That was right for a place whose entire content was a shut door, and wrong the moment the
inside became real.

1. **A wall that is a LINE is a border, not a defence.** You cannot walk round a settlement that has
   no round. The wall is a ring now, and the compound is a thing with an outside.
2. **196 tiles of one flat terrain is not country, it is a colour** — the exact finding the
   Scarletwastes wrote down when its own flat sheet never got hand-painted.
3. **The Gantry was a pad on the apron**, which made the Exodus's one great work a car park for
   visitors.

### The landform

Nine terrains off **one continuous height surface** (two-octave hashed value noise, no RNG, so a
rebuild is byte-identical and a re-import produces no diff). Each family is a threshold on that one
field, which is what makes the bands contiguous rather than speckled.

> **The ground is a field, not a sprinkle.** If you want it different, change the surface.

| Family | `flags.terrain` | Tiles | What it is |
|---|---|---|---|
| `flat` | `redrock` | 430 | the country you cross most of |
| `scree` | `gravel` | 210 | the talus skirt a mesa sheds |
| `cliff` | `cliff` | 143 | the rim of a tableland. **Impassable** |
| `mesa` | `plateau` | 126 | caprock, flat on top and a long way up |
| `pan` | `hardpan` | 100 | cracked pale lakebed in the low ground |
| `scrub` | `scrub` | 95 | thorn following the drainage lines |
| `salt` | `alkali` | 58 | one flat, southwest, and nowhere else |
| `dune` | `sand` | 43 | blown sand collecting in the lee |
| `ramp` | `ramp` | 22 | the break in a rim, and the only way up |
| road | `dirt_road` | 10 | the approach |

**⚠ The thresholds are tuned to THIS WINDOW, not to the unit interval.** Value noise is only uniform
over an infinite plane; across this particular 40×40 patch the height field runs 0.29–0.91 with its
median at **0.633**. Reusing the Scarletwastes' numbers unchanged is exactly what the first build of
this region did, and it produced 63% of the country above the scree line and **not one tile of
hardpan, sand or salt anywhere**, because three of the nine bands sat below the field's own floor.
If you move the box, re-measure the field before you trust the numbers.

**Two exemptions, and both are correctness rather than taste.** The approach corridor (three rows
deep along y940, west of the wall) and the ground under the Gantry and Last Requisition are never
given to the landform pass. `cliff` is the only impassable terrain in the game and the height field
has never heard of the road: one cliff tile dropped across y940 makes the whole region unreachable
on foot, with nothing anywhere to say so. **The generator flood-fills from the arrival tile and
fails the build** if the gate, the pad or any courtyard tile is unreachable.

---

## The compound

### The wall

72 tiles, and they carry **`building_type` and nothing else** — no `is_building`, no
`building_name`. This is the Thornwarren rule, and Terminus is the region that proved why it exists:
`bt` (what stops a truck, what the flight sim extrudes) reads `building_type` alone, while the map's
marker namespace keys off `is_building` and derives a two-letter code from `building_name`. Pass 1
gave **thirteen** wall tiles a unique name apiece to dodge the collision, which worked and produced
W2..W8 and six copies of WA. A boundary is not a landmark. The wall reads on the map as the
compound's own outline, which is what a wall should look like.

**⚠ The marker carry-forward must be scoped to facades.** The redraw demoted 68 named wall tiles and
four glasshouses to anonymous mass, and the generator's "preserve any existing marker" line kept
twenty dead codes alive in content — tiles with no `building_name` to derive one from, still
shipping T2..T9 and G1..G5, one of which then collided with a code the new gate legitimately
derived. A stale marker is worse than a missing one, because the map draws it.

### The Ascension, and why there are two pads

**The pad is the middle of the temple.** A hundred feet of poured concrete with four lattice masts
around it and, between them on gantries, the beginnings of something that has been the beginnings of
something for a very long time. The welds nearest the ground have been ground back and redone in a
better hand than the ones at the top.

| field | id | where | who it is for |
|---|---|---|---|
| **The Gantry** | `terminus_gantry` | the apron, (1203, 943) | visitors, and the trucker who drove 1,170 tiles |
| **The Ascension** | `terminus_ascension` | the centre, (1220, 940) | them |

Both are `vtol_only`, so both render the circle-H pad rather than a strip, and anything with a wing
can use neither. They were never building for aeroplanes.

**Yes, you can land on the Ascension without being let through the gate, and that is deliberate
rather than a hole.** The wall is a rule about the *road*. What stops a stranger walking off the pad
into the assembly is the hall's own door, which does not open, and nobody will tell them why.

### The 16 interiors

| Room | `building_type` | Who is in it |
|---|---|---|
| **The Waking Hall** | `civic` | Thankful Sedge. Benches facing a floor rather than an altar. `psi`-locked |
| **The Stillhouse** | `clinic` | Silence Marrable, and the chair |
| **The Stillwell** | *(back room)* | nobody. A stone basin of water that is not still. `psi`-locked |
| **The Long Table** | `diner` | Comfort Delaide. Forty feet of it, and neither end is the head |
| **The Wash House** | `bathhouse` | a copper, a trough, and everybody's own towel |
| **The Long Dormitory** | `apartment` | sixty identical beds and one book about tides |
| **The Mending Room** | `clinic` | Mercy Vantry, and every drawer labelled in one hand |
| **The Creche** | `civic` | Amity Locke, and eleven children drawing the same thing |
| **The Open Door** | `hotel` | Patience Colm. Six made beds, a ledger of first names |
| **The Quiet Ground** | `undertaker` | Remember Sett, a bier, and a book in an impossible hand |
| **The Bench** | `fabrication` | Constant Ferris, and the drawing on the wall |
| **The Seed Vault** | `cold_storage` | Preserved Wain. 406 drawers, no lock |
| **The Glasshouse** | `greenhouse` | the food, and the reason the wall is worth looking over |
| **The Standing Charge** | `dynamo` | Increase Talley, and the one machine they keep |
| **The Gate House** | `civic` | the rota, and a bell with no rope |
| **Last Requisition** | `truck_depot` | Ivo Stannard. Built in pass 1; the redraw moved the world around it |

Every interior ships with a utility room, a junction box, a generator, power rows and a light
fixture, because **an interior that ships without power ships dark** and that has happened here
before. The Stillwell is the one deliberate exception: no fixture, no switch, no lamp. The only
reason to build a windowless room with no light in it is that the people who use it do not need one.

**The plant moved inside the wall**, and that is the joke the apron is built on: the trading post
outside the gate, the diesel pump and the lamps in Last Requisition all run off the one machine
these people renounce. They power the thing they disapprove of and never once mention it.

---

## `flags.exodus_space`, and the flag that had no home

The armour taboo (`plugins/psionics/reactions.js`) has shipped since psionics Phase 1 and reads
`flags.exodus_space`. **No zone in the world carried it.** The taboo had never fired anywhere.

It is now on every tile inside the wall and on the wall's own buildings, and on **nothing** outside
the gate — because the trading post on the apron is exactly where the creed is suspended. It is also
now in the tag catalog (`client/shared/tagCatalog.js`), which is what `content:lint` checks.

---

## The way in

The player chose the softest of three readings: **standing is never consulted, only the path.** You
can have run jobs for all four orders and still be let in. What you cannot be is *signed up*.

### The gate lock: `terminusgate`

Registered in `plugins/psionics/door.js` beside the `psi` one, and it asks a different question.
`psi` asks what you can DO; this asks what you ARE. Two halves, both required:

1. **`terminus_admitted`** — somebody let you in. The gate is never opened by standing at it.
2. **The mind is not already somebody else's** — it reads the ordinary `path_machine` /
   `path_flesh` / `path_human` / `path_mind` flags and refuses when any non-mind path is **at or
   above** `path_mind`. **A tie refuses**: somebody equally committed to two paths has not chosen,
   and the whole gate is about having chosen.

**It must NOT be a `psi` door.** The purifier chair that awakens you is *inside* the wall, so gating
the gate on awakening puts the door in front of its own key. That is the commonest way a chain like
this dies quietly.

**There is no membership flag doing the real work.** The rule reads the ideology axes and nothing
else, so a player who later leans back toward the mind through ordinary play walks in, and one who
takes Ascendant work walks out, with nothing in the plugin to keep in sync.

The refusal is flat, like every door here — **except** the path refusal, which fires Verity
Strand's one-shot line (`terminus_gate_told`). A player who did both errands, answered the child and
is then refused invisibly is looking at a bug rather than at a decision. She explains *them*, never
the creed, and never names the order they belong to.

### The chain

Verity Strand has been saying this since pass 1, and the admission had to honour it:

> *"Go and live. Do the work you'd have done anyway. Someone will notice, and it will not be me, and
> you'll be told."*

So it is not the warden who lets you in, and it is not a quest board.

1. **`quest_terminus_1`, "Nothing Owing"** — Ivo Stannard. Carry a sealed box to the gate and bring
   the empty back. He says twice not to open it and then apologises for saying it twice. What is in
   it is a set of gauges he made before his hands stopped being his, which they will not take from
   him, and he knows why and will not say it out loud in his own shed.
2. **`quest_terminus_2`, "The Long Way Round"** — Tace Ambler, who only offers it once Ivo's is
   done. Walk the outside of the wall. All of it. She says there is nothing to see and that she is
   not going to pretend otherwise, and asks you not to ask what it is for.
3. **The child.** **Hopestill**, nine years old, sitting on a rock on the *outside* of a wall with
   no way through it, asks one question: *"What are you for?"* Answering it one particular way runs
   `ADJUST_PATH { mind }`, `ADJUST_STANCE`, and sets `terminus_admitted`. Then she walks at the gate
   and it comes apart in front of her, and she does not look back to see whether you are following.

**Nothing ever explains how she got out.** Nobody remarks on it.

Both errands refuse to be about anything, which is the register the Oracle-9 chain
(`quest_exo_1..3`) established for this order. What is actually being measured is whether you will
do a pointless thing carefully, and that is never said by anybody.

---

## How the place reads

**The terror is at the wall. The inside is domestic, and nothing ever remarks on it.** Outside you
are turned away, politely, forever, by people who will not say what is behind them. Inside it is a
kitchen, a laundry, a sick room and a school. Both are true and neither is a trick.

**Four instruments, used everywhere and named nowhere:** somebody answers before they were asked and
does not notice; a great many people do one thing at one moment with no signal for it; objects are
in an order nobody was near enough to have put them in; a room goes quiet in a way that has nothing
to do with sound.

**The one line never to write** is any line where a character explains the creed to the player. **Ivo
Stannard is the only exception**, and he has it because he touched the machine and is not going with
them.

**The names.** People born inside carry virtue names (Verity, Thankful, Silence, Comfort, Mercy,
Constant, Amity, Patience, Increase, Remember, Preserved, Hopestill). People who came carry ordinary
ones (Ivo, Tace, Josiah). **Nothing in the game says so**, no NPC remarks on it, and no quest rewards
working it out.

**Psionic content is exactly two objects and two doors, and all four are real.** The stillhouse chair
carries `psi_purifier`, which `plugins/psionics/purifier.js` reads; the Waking Hall and the Stillwell
are `lock:psi`. The Stillwell is prose in a room whose *door* is the mechanic. Nothing here invents a
flag that nothing reads — the rule the mutations system bought the expensive way with its `effects`
keys.

---

## Rebuilding it

```bash
node scripts/build-terminus.mjs
```

Then, in order — the middle step exists because a building's two-letter map code can only be chosen
by something that sees every building in the world at once:

```bash
npm run content:import && npm run map:derive && node scripts/bake-terminus-markers.mjs && npm run content:import
```

```bash
node scripts/build-terminus-npcs.mjs && npm run content:import
```

Both generators are idempotent and carry any existing `marker` forward. **⚠ `build-terminus.mjs`
prunes every `conn_terminus_*` / `conn_exo_*` file before reminting**, and the importer only deletes
rows for files deleted *in git between the marker and HEAD* — so after a local rebuild the dev DB
keeps orphan `connections` rows and `zone_edges` comes out short. Committing the deletion fixes it
on deploy; locally, delete the rows whose file is gone.

---

## Not built (deliberate)

- **The Pioneers never contest the apron.** `ideology_pioneers` is expansion-gated and its designed
  home is a rebuilt frontier settlement. A later claim on the trading post is free drama.
- **Nobody ever leaves.** The thing on the pad is under construction and stays that way. There is no
  launch, no countdown and no ending, and Increase Talley's line about the generator staying behind
  is as close as the district gets to one.
- **The `919_927` / `921_927` discrepancy** between the Wildblood and Wildlands docs is still
  unsettled.
