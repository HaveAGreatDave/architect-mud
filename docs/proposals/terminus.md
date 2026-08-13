# TERMINUS — the Exodus settlement

**STATUS: Design. Nothing built.** Scoped 2026-08-11.

The east limb of Coldwater's void currently points at `zone_exodus_waypoint`, **a zone that does not
exist** — a walker who takes that fork is deposited nowhere. This is what goes there.

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

**No retcon is needed.** The org file says they *"abandoned Coldwater Basin entirely"* — the
**Basin**, not the planet. "Will not tell you where to" is about their destination, not their
address. They are at Terminus, working on the next leaving.

---

## The pairing that was already written

Cass Renner, at Buzzard Field, unprompted (`content/npcs/npc_1784516450269.json`):

> *"You think about where you'd go? If you had to go."* … *"No. That's the point of here."*

**The Reach is where you go to stop. Terminus is where you go to keep going.** Two forks of one
void, and nobody had written it down.

---

## The design problem, and the answer

A settlement that shuns outsiders is a **wall, not a destination**. Let players in and it isn't
secret; keep them out and it's a dead end at the end of a very long drive.

Half the answer already exists in `docs/proposals/void-arrival-checkpoint.md`:

> **Exodus** — Renounce-faction vetting — *ideology/rep, not law.*

So: **two tiers**, split by a wall.

### Outside — the apron

Anyone can come. It exists because **purity is expensive**: a creed that renounces the machine still
needs bearings, and somebody has to buy them from Coldwater. That is the district's joke, and the
tone guardrails ask every district for one.

- **Last Requisition** — the quartermaster's. Buys machine parts they publicly renounce, sells fuel
  at a price that makes the disapproval explicit. Run by a man who hates his own job and is very
  good at it.
- **The Gantry** — a VTOL pad, not an airstrip. They built it to leave the *planet*; an aeroplane
  was never the point. Reuses the existing `vtolOnlyField` circle-H rendering for free.
- **The truck depot** — `flags.truck_depot` + `truck_fuel` on the apron street tile. THE LONG HAUL's
  third yard and its longest run.
- **The gate** — visible, shut, and staffed. You are turned away politely, every time, until you are
  not.

### Inside — earned

**Two stages, both using systems that already exist:**

1. **Exodus rep gets you spoken to.** `systems-jobboard.md` already grants Exodus rep for ruin-site
   jobs, so the ladder is in place before the door is.
2. **Declaring the Exodus path gets you through.** A real character commitment, on the existing
   ideology axis. No new mechanic.

Behind it is the thing the org file describes and **nothing has ever built**:

> *"they still a room and move what is in it without a touch, press a thought whole into another
> skull, and speak of the mind as the last country the Architect could never wire shut."*

- **The Stillhouse** — where the disciplines are practised. (A still room; a still; stilling a room.)
- **The Waking Hall** — assembly, and the creed. Their motto is *awaken*.

Psionics is currently design-space only (`docs/design.md` and one codex chapter). Terminus is where
it would live. **A real gate wants a real reward** — but see Scope below: the region can ship without
it.

### How the inside reads: the rule

**Nothing is ever named.** No robes, no chanting, no one says "we are a cult", nobody demonstrates a
power. The moment a thing is stated it becomes a mechanic and stops being unnerving. Everything below
is inference, and the player is allowed to conclude nothing at all.

**Psionics, shown four ways and never explained:**

- **Answered before asked.** Somebody hands you the thing you were about to ask for and does not
  notice they did it. They are not showing off. They think that is how conversation works.
- **Conversations with holes in them.** Two people talk, pause, and one of them replies to something
  that was not said out loud. Then they carry on. The gap is the tell.
- **Objects in impossible order.** Rope coiled to the millimetre with nobody near it. Dust with no
  handprints on a shelf that was rearranged this morning. A door that is open before you reach it and
  nobody behind it.
- **Rooms that go quiet in a way that is not sound.** Pressure. The sense of having been read, filed,
  and found uninteresting. Never confirmed.

**Cultishness, shown four ways and never named:**

- **Uniformity without uniforms.** No dress code, and everyone is dressed the same anyway. No bell,
  and everyone stops at once.
- **Absence as evidence.** No locks. No arguments. No possessions worth the word. No waste, anywhere,
  of anything. That is the frightening bit, not the robes.
- **Nothing is explained**, because everyone already knows, and asking marks you.
- **The horror of kindness.** They are not sinister. They are *warm*, patient and pleased you came,
  and they will not tell you a single thing you want to know, and none of that is a contradiction to
  them. A hostile cult is easy to leave.

**Children are the sharpest instrument and should be used twice at most.** A child who is too calm, or
who answers a question you only thought, does more than a room full of adults. Overuse it and it
becomes a gag.

**The one line never to write:** anything where a character explains the creed to the player. Ivo
Stannard, out on the apron, is the *only* one who talks plainly about what this place is — and he can
only do that because he is the one who touched the machine, and he is not going with them.

---

## Geography

| | |
|---|---|
| Bounding box | **x 1200–1213, y 934–947** (14×14 = 196 tiles, hole-free rectangle) — as built |
| Base terrain | `redrock` — continues Coldwater's east rim honestly, and "remote launch mesa" is the canon image (`systems-wildlands.md:83`) |
| Clearance | ~245 tiles east of Coldwater's rim. Nothing exists past x=955 anywhere |
| Latitude | Sits inside the y 909–947 band, the only **land** on Coldwater's east edge — y 896–908 is basin, and **water is never a rim**. Moved south to y 934–947 (2026-08-12) so it is not sitting on the coast: the basin reaches y909 on this side, and the old y910 north edge read as a shoreline settlement. Its south edge is now level with Coldwater's own south rim, and the return leg lands at `zone_district_955_940` |

**The route is the void's east limb, and only that.** The overland stub reserved in the Wildblood
proposal (`919_927`, which `systems-wildlands.md` calls `921_927` — the docs disagree) becomes
**signage pointing east**, not a second route. The road and the void are already the same space:
walked it is a crossing, driven it is a highway.

### The limb needs a `length`, and the number is the best decision here

The east limb is distance-derived and would **clamp to `MIN_ROOMS` (5)** exactly as the Reach did —
255 tiles straight-line is under one room's worth. It needs an explicit `length` in `VOIDS`.

**Proposed: `length: 12`.**

| | corridor | one way | round trip | drive |
|---|---|---|---|---|
| Terminus (12) | 1,080 | ~1,170 | ~2,340 | ~23 min |
| The Reach (8) | 720 | 765 | 1,530 | ~15 min |

And then the fleet does something lovely with no extra code:

| truck | tank | can it reach Terminus? |
|---|---|---|
| Krell Barrow | 850 | **no** (0.73) |
| Ostrek Courier | 1,100 | **no** (0.94) |
| Vachon Drayman | 1,400 | yes (1.20) |
| Orlov Continental | 2,100 | yes (1.79) |

**The truck ladder becomes a map gate.** You need an 11,500₵ rig to reach Terminus at all — and
since the round trip is 2,340 against a best tank of 2,100, **nobody gets home without refuelling
there.** You must buy diesel from people who disapprove of diesel. That is the joke, the economy and
the gate in one number, and it costs nothing to build.

*(A beater can still gamble on a roadside `fuel_yard` spawning on the corridor. Running dry means
`park` and walk — humiliating, not fatal.)*

---

## Scope

Costed against The Reach, which is the precedent for a small region.

| | The Reach | Terminus |
|---|---|---|
| region file | 1 | 1 |
| zone JSONs | 400 | 400 |
| generator + power_zones | 1 + 400 | 1 + 400 |
| building facades (+ interiors) | 4 | 4 |
| NPCs | 6 | 5 |

The tiles are fill. **The authored cost is four buildings and five people.**

**Ship in two passes:**

- **Pass 1 — the apron.** Region, tiles, the wall, Last Requisition, The Gantry, the depot, the
  gate, and 2 NPCs (quartermaster, gate warden). The east limb stops being broken, the Long Haul
  gets its long route, and the inside is a rumour. *This is a complete, playable thing.*
- **Pass 2 — through the gate.** The Stillhouse, The Waking Hall, 3 more NPCs, the ideology gate,
  and whatever psionics turns out to be.

---

## Open questions

1. **Does psionics ship with pass 2, or is the inside "place and people" only at first?** It is a
   whole system and it does not have to block the region.
2. **Do the Pioneers ever contest it?** `ideology_pioneers` is expansion-gated and its designed home
   is literally a rebuilt frontier settlement. A later claim on the apron is free drama.
3. ~~**Return leg.**~~ **SOLVED**, and for both at once, as this predicted. `region_terminus` and
   `region_the_reach` now have their own `VOIDS` entries — the same crossing read backwards, same
   `length` so the tank that got you there gets you back, landing on the rim tile that faces the way
   you went. It mattered most here, because The Gantry is `vtol_only, charter: false`: a trucker who
   drove to Terminus was stranded unless they already owned an aircraft. Four regress invariants now
   pin it (anything reachable is leavable; every limb has a matching leg back; both legs are the
   same length), and a dest names its endpoint `region` on the edge rather than reading it off live
   zone state, because that check is about the shape of the table.
4. **The `919_927` / `921_927` discrepancy** in the Wildblood and Wildlands docs should be settled
   whichever way this goes.

---

## Conventions this must respect

- **No em dashes in Exodus dialogue.** That punctuation is a voice tell reserved for the Ascendants
  and the Architect.
- **Unique NPC names** — no two NPCs in the world share a name, full or given. Check before writing.
- **Greeting split** — root node gets `first` (one-time intro) plus `text`, `known`, `familiar`.
- **Dialogue trees are flat and rooted at `root`**, options carrying `next` and `label`. Not
  `{ nodes, edges }`, despite the VINE editor's own format.
- **A new building gets its map icon in the same build**, never backfilled.
- **New interior zones get power + a light fixture** in the same build, or they ship dark.
- Ship through the **`codex`** skill; run **`map-audit`** on the facades.
