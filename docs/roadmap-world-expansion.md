# World Expansion Roadmap — Toward the 100×100 Coldwater Basin

> **Status:** Vision + phased plan + open decisions. Nothing here is built. This is the guide we
> steer by, not a spec. Every section ends with **multiple-choice decisions** — answer them inline
> (edit the doc, or tell me) and the plan sharpens around your picks.
>
> **Companion:** [roadmap-world-map.svg](roadmap-world-map.svg) — the zoomed-out overview of the
> target world. Open it in a browser or the dev panel.

---

## 0. The One-Paragraph Vision

Coldwater Basin grows from today's compact hub-and-spoke into a **concentric world roughly 100×100
grid-cells across** on `map_world`, with danger rising the further you get from the safe core. The
centre stays sacred (PvP-off, vendors, anchors); the city proper wraps it; beyond that lie the
**inner ruins** (gray-zone, contested), the **badlands** (faction territory, live PvP, real loot),
and the **outer wastes** (lethal frontier, resource runs, the endgame). Interiors — buildings,
undercity, the Architect's data center — remain their **own child maps**, so 100×100 is the
*surface* area, and the true content volume is many times that. We grow it **in waves**, each wave a
self-contained, playable district with a reason to exist beyond "more tiles."

---

## 1. What 100×100 Actually Means (technical grounding)

This is grounded in how the engine already works, so the vision is buildable, not fantasy:

- **The grid is real but decorative for traversal.** Zones carry `grid_x / grid_y / grid_z` and a
  `map_id`. `map_world` is the outdoor surface. **Exits (JSONB) are the source of truth for
  movement** — the grid only positions tiles for the minimap and the dev-panel map editor
  ([docs/systems-world.md](systems-world.md)). So "100×100" is a *layout target*, not a hard
  engine limit, and we can leave holes (impassable rubble, water, walls) without penalty.
- **Interiors don't spend surface cells.** A building occupies **one** `map_world` cell but opens
  into its own `map_int_*` child map with many rooms. The undercity and the data center are just
  large child maps hanging off a surface cell. This is why 100×100 is plenty.
- **10,000 cells is the ceiling, not the target.** A fully-packed grid would be miserable to build
  and to walk. Realistic authored surface content is more like **600–1,500 distinct outdoor rooms**,
  with the rest as connective tissue, terrain, or deliberate emptiness. The rings do the heavy lifting.
- **The minimap and map popup already scope by `map_id` + `grid_z`** and BFS the exit graph, so they
  scale to a big surface as-is — but wayfinding *at 100×100* needs new affordances (see §9).

### Decision 1 — How literal is "100×100"?
- **(A) Hard 100×100 outdoor grid, filled in waves.** *(Recommended)* Fixed canvas; we author into it
  ring by ring, leaving intentional gaps. Predictable, legible, matches the SVG.
- **(B) ~100×100 as a soft target.** Aim for that scale but let districts size themselves; final
  dimensions drift.
- **(C) Bigger surface (e.g. 150×150), sparser fill.** More frontier, more emptiness between
  landmarks — a lonelier wasteland feel.
- **(D) Smaller dense surface (e.g. 60×60), everything closer together.** Less travel, higher
  encounter density, more HellMOO-claustrophobic.

### Decision 2 — Density philosophy
- **(A) Dense core, sparse frontier.** *(Recommended)* Rooms packed near the centre, thinning to
  lonely landmarks in the wastes. Rewards pushing out.
- **(B) Even density throughout.** Consistent "every tile has something" texture everywhere.
- **(C) Archipelago.** Clusters of dense content separated by deliberately empty crossings that are
  themselves a survival challenge.

---

## 2. Where We Are Today (the seed)

The current live world is the **safe core + a sliver of the first ring** — the dashed "BUILT TODAY"
boundary on the map. Roughly:

- **The Threshold** — central safe hub: anchor point, vendors, PvP-off, no radiation.
- **Eight safe city tiles** around it, plus a **merchant cluster** (The Meridian, Drum's Fits,
  Velk's Pre-Owned, specialty shops) as building interiors.
- **The residential block** — Embassy Hotel & Bar with rentable apartments, below the Franchise Strip.
- **A short western danger buffer** — Rust Quarter West → Static Wood → **Coldwater Power Station**
  (the fuel-free generator that keeps the city lit; a piece of the Architect's silent competence).
- **Partial edges already authored** — the **Marquee District** (east downtown, atmospheric shells)
  and the **Slagworks / Ashway** (west frontier starter). These are the natural anchor points that
  the next waves grow *out from*, so we don't restart geography — we extend it.

The important design fact ([docs/design.md](design.md)): *"The map has shrunk at least once already
and is expected to grow back out in waves rather than all at once."* This roadmap is that waved
growth, made explicit.

---

## 3. The Ring Model (the world's skeleton)

Five concentric bands, danger rising outward. This is the spine every phase hangs off.

| Band | Grid footprint (approx) | Danger | PvP | Purpose |
|---|---|---|---|---|
| **Safe Core** | centre ~10×10 | Safe | Off | Hub, anchors, vendors, banking, social. Sacred. |
| **The City** | ~30×30 around core | Low | Off / opt-in | Districts, shops, apartments, quests, first jobs. |
| **Inner Ruins** | ~55×55 band | Medium | Contested | Gray-zone. Scavenging, gangs, gray-market, low-tier fights. |
| **The Badlands** | ~80×80 band | High | Live | Faction territory, real loot, enemy density, the war layer. |
| **The Outer Wastes** | edge ~100×100 | Lethal | Live | Resource frontier, mega-landmarks, the endgame, the Architect. |

The bands are **not literal circles** — they're organic and lobed (see the map), so travel between
two same-band districts can still cross a dangerous notch, and a road can punch a safe-ish spoke
deep into the badlands. That irregularity is where interesting geography lives.

### Decision 3 — Danger gradient shape
- **(A) Smooth concentric gradient.** *(Recommended)* Predictable "further = deadlier" the player
  can reason about and plan around.
- **(B) Patchwork.** Danger islands anywhere — a lethal pocket two tiles from the core, a calm
  oasis deep in the wastes. Less legible, more surprising.
- **(C) Directional.** Danger rises sharply toward one edge (e.g. west = death, east = trade),
  giving the compass real meaning.

### Decision 4 — PvP in the middle band (the Inner Ruins)
This is the classic open question ([docs/design.md](design.md), Open Questions).
- **(A) Opt-in / flagged PvP.** *(Recommended)* You choose to go "hot"; gray zones are tense but
  not a gank field for newcomers.
- **(B) Fully open PvP.** Everything outside the city is a knife fight. Maximally brutal, HellMOO-pure.
- **(C) Time-gated.** Ruins go PvP-hot at night / during world events only.
- **(D) Faction-gated.** PvP only between members of opposed factions in contested territory.

---

## 4. Phase Plan (the waves)

Each phase is **shippable on its own** and gated so the world is always coherently playable. Phases
are ordered by dependency, not calendar — we do the next one when the prior is solid.

### Phase 0 — Foundations (build-the-tools-to-build)
*Before pouring 1,000 rooms, make pouring them cheap and safe.*
- **Bulk zone authoring** — reliable direct-DB + `/world/reload` path already proven
  ([reference: MUD Content Build](../MEMORY.md)); harden it into a repeatable district-stamping flow.
- **Region metadata** — a `region` tag on zones (band + district name) so danger, ambience,
  spawn tables, and faction ownership can be assigned *per region* instead of per room.
- **Wayfinding primitives** — see §9 (fast travel, road network, map-at-scale). At least one must
  exist before the city gets big enough to walk across.
- **Regression + backup discipline** — every wave ends with `npm run test:regress` and a dev-panel
  export.

### Phase 1 — Finish the Basin Core & City (the lived-in centre)
Complete the safe core and first city ring into a genuinely dense, populated downtown: the Marquee
District fully furnished (NPCs, vendors, jobs), more apartment stock, ATMs and vendors placed for
real ([design.md](design.md) defers ATM coverage to exactly this pass), civic landmarks (a clinic,
a market hall, a transit node that will later anchor fast travel).

### Phase 2 — The Inner Ruins (the first real expansion ring)
The gray-zone band: scavenging fields, the gray market, low-tier enemies, the first faction
*presences* (not yet full territory war). This is where the **Archivist Stacks** (underground
library, a child map) and early **Glitch** data-havens appear. Danger is medium; death is possible
but recoverable. This ring is the tutorial for the badlands.

### Phase 3 — The Badlands & Faction Territory (the war layer)
The high-danger band, carved into **faction turf**: Custodian arcology approaches (NE), Breaker
camps (SW), Franchise-controlled retail ruins (S). This is where the **Corps/orgs system**
([docs/systems-corps.md](systems-corps.md), Phase 0 engine already built) meets geography —
territory becomes a thing corps *hold and contest*. Real loot, live PvP, enemy density scaled up.

### Phase 4 — The Outer Wastes & Frontier (the deep end)
Lethal edge: the Slagworks scaled into a full resource frontier, the **Cinder Reach** (EMP-scarred,
power-dead), long dangerous crossings, high-tier resource nodes, the rare-recipe and rare-material
economy that makes the badlands worth holding. Survival mechanics (extreme weather, radiation,
thermal) are the *primary* threat out here, not just monsters.

### Phase 5 — Verticality & Mega-Interiors (the third dimension)
The **Undercity** (a large `grid_z < 0` child-map network under the city), **arcology towers**
(`grid_z > 0`), and the **Deep Data Center — the Architect's Core** (endgame child map, far NE).
These use `grid_z` and child maps to add enormous content without spending surface cells. The
Architect Interface skill ([design.md](design.md)) finally has somewhere to *go*.

### Phase 6 — The Living World (endgame systems over geography)
Territory war, world events over real map regions, dynamic faction tides, the Architect reacting to
power concentration ([systems-corps.md](systems-corps.md)). The map stops being scenery and becomes
the board the metagame is played on.

### Decision 5 — Phase ordering priority
Which axis do we push *first* after Phase 1?
- **(A) Outward by ring (2→3→4).** *(Recommended)* Finish each danger band before the next. Clean,
  legible, always-coherent world.
- **(B) Down first (jump to Phase 5 Undercity early).** Verticality and mystery before horizontal
  sprawl — leans into the Architect mystery sooner.
- **(C) Faction-war first (pull Phase 6 forward).** Make the *existing* small map a live territory
  battleground before expanding it — depth before breadth.
- **(D) Frontier-jump.** Build a far-wastes destination early (the Slagworks endgame) so there's a
  "there there" pulling veterans outward, with the middle filled in later.

### Decision 6 — How big is one "wave"?
- **(A) One district per wave (~40–120 rooms).** *(Recommended)* Digestible, testable, always ships.
- **(B) One full ring per wave.** Bigger, more coherent thematically, but longer between playable drops.
- **(C) Landmark-first waves.** Ship the *destination* (a named mega-location) first, connect the
  surrounding tiles later.

---

## 5. Geography & Landmarks (the memorable places)

A big map is forgettable without anchors. Proposed named mega-landmarks (on the SVG):

- **The Threshold** — the eternal safe centre.
- **The Marquee District / Merchant Row / Franchise Strip** — the city's living downtown.
- **Coldwater Power Station** — keeps the lights on, unexplained. Already lore-load-bearing.
- **The Archivist Stacks** — underground library, paranoid academics, lore & recipe economy.
- **The Glitch / Data Havens** — rogue-AI-fragment tech mystics; the "talk to the Architect" thread.
- **Custodian Arcology** — corporate cult fortress; the establishment power.
- **Breaker Camps** — anti-tech gang sprawl; the chaos power.
- **The Slagworks / Ashway** — industrial resource frontier and the trek to reach it.
- **The Cinder Reach** — EMP-dead scar; power-starved survival horror.
- **The Stadium City-State** — a micro-civilisation with its own absurd legal code (NFL-rulebook law).
- **The Undercity** — the buried layer; smuggling, hiding, old infrastructure.
- **The Deep Data Center** — the Architect's core. The deepest narrative thread, the endgame.

### Decision 7 — The Architect's Core payoff
- **(A) Reachable but near-unsurvivable endgame zone.** *(Recommended)* A real place veterans
  mount expeditions toward; arriving is a legend-making feat, not a quest turn-in.
- **(B) Never physically reachable.** It's always "over there," felt through infrastructure and
  signals only — preserving the mystery permanently ([story.md](story.md): the machine is watching,
  never seen).
- **(C) Reachable, and it *responds*.** The one place the Architect acts directly — the single
  exception to its silence.

### Decision 8 — Which landmarks are must-haves vs. optional?
*(multi-select — mark all you consider core to the vision)*
- **(A) Undercity** — verticality & smuggling.
- **(B) Stadium City-State** — comedic micro-culture set-piece.
- **(C) Cinder Reach** — power-dead survival zone.
- **(D) All faction HQs as physical, holdable places.**

---

## 6. Factions & Territory (the map as a political board)

The five seed factions ([story.md](story.md)) map naturally onto the badlands ring as **territory
owners**, tying geography to the already-built Corps/orgs engine ([systems-corps.md](systems-corps.md)):

| Faction | Turf (band/quadrant) | Fantasy |
|---|---|---|
| The Custodians | Arcology, NE badlands | Corporate cult; law, order, service to the Architect |
| The Breakers | Camps, SW badlands | Anti-tech gangs; raid, wreck, take |
| The Franchise | Retail ruins, S | Sinister loyalty-program commerce |
| The Archivists | Underground, W | Knowledge hoarders; recipes & lore |
| The Glitch | Data havens, E | Unhinged tech-mystics; the Architect whisperers |

### Decision 9 — How does territory work mechanically?
- **(A) Influence tug-of-war per region.** *(Recommended)* Regions have an ownership meter corps
  push via the five power levers ([systems-corps.md](systems-corps.md)); control grants perks
  (vendors, spawn control, tolls). Matches the already-designed corp system.
- **(B) Hard capture points.** Discrete objectives you take and hold; more RTS, less simulation.
- **(C) Soft / cosmetic only.** Factions *flavour* regions (ambience, NPC attitude) but don't
  mechanically own them — keeps it simple.

### Decision 10 — Player agency over territory
- **(A) Player corps can take badlands territory from NPC factions.** *(Recommended)* The endgame
  fantasy: carve your own turf out of the map.
- **(B) NPC factions own the badlands permanently; players only earn rep/access.** Stabler world,
  less player-driven upheaval.
- **(C) Mixed: some regions capturable, faction heartlands never.** Best of both — a contested
  frontier around fixed strongholds.

---

## 7. What Fills the Space (content-per-band)

So the map isn't empty tiles, each band gets a distinct content menu:

- **Safe Core / City** — vendors, apartments, jobs/quests, social spaces, civic services, crafting
  stations, banking. *Reason to be here: everything social and economic.*
- **Inner Ruins** — scavenging fields (the scavenging system already exists), gray-market vendors,
  low-tier enemies, minor faction outposts, environmental puzzles. *Reason: cheap loot & XP with
  manageable risk.*
- **Badlands** — faction turf, mid/high enemies, contested resource nodes, PvP, apartments-as-
  forward-bases, rare vendors. *Reason: real reward, real risk, the war.*
- **Wastes** — top-tier resource nodes, rare recipes/materials, extreme-weather survival, mega-
  landmark expeditions. *Reason: the best stuff, and legend.*

### Decision 11 — Density of "reasons to travel"
- **(A) Every district has a unique draw (vendor, node, quest hub).** *(Recommended)* No filler
  districts.
- **(B) Hub-and-spoke draws.** A few big destination districts; the rest is connective wasteland.
- **(C) Procedural top-up.** Hand-author landmarks; let scavenging/spawn systems make the tiles
  between them worth crossing without bespoke content.

---

## 8. Travel & Time-to-Cross (the pacing problem)

At 100×100, walking core-to-edge tile-by-tile could be dozens of moves. That can be a feature
(distance = danger = commitment) or a chore. We need a stance.

### Decision 12 — Primary long-distance travel
- **(A) Fast-travel between discovered safe anchors.** *(Recommended)* Walk it once to unlock it;
  thereafter jump between anchors you've reached. Distance still matters the *first* time and in
  hot zones (no fast-travel while in danger / combat).
- **(B) A transit line / road network.** Physical routes (a rail spur, a highway) with stops —
  in-world, ganking-able, breakable. More immersive, more work.
- **(C) Pure legwork.** No shortcuts. The map is meant to be big and crossing it is the game.
  Maximally hardcore.
- **(D) Vehicles / mounts.** Player-owned transport that speeds outdoor movement. Big new system.

### Decision 13 — Should distance gate danger progression?
- **(A) Yes — hard to reach = hard content, and travel itself is the gate.** *(Recommended)*
- **(B) No — let players teleport near danger; the danger itself is the gate.** Friendlier to
  drop-in play.

### Decision 14 — Travel time & the survival clock
Hunger/thirst/thermal deplete in real time. Long crossings interact with survival.
- **(A) Crossings are meant to stress the survival meters — pack supplies or die.** *(Recommended)*
  Makes the frontier feel like an expedition.
- **(B) Keep crossings short enough that survival isn't a travel tax.** Survival stays a
  base-management layer, not a travel one.

---

## 9. Wayfinding at Scale (don't get lost)

The current 5×5 ASCII minimap and BFS map popup are fine for 30 rooms; at 1,000 they need help:

- **Region-level overworld map** — a zoomed-out view (like the SVG) showing bands/districts, not
  individual rooms; drill into the local minimap for detail.
- **Named destinations & `go`** — already supported ([systems-world.md](systems-world.md)); extend
  with discovered-landmark waypoints.
- **Fog-of-war / discovery** — the overworld reveals as you explore, giving a sense of a *big
  unknown* to fill in (leans into the wastes fantasy).

### Decision 15 — Overworld map style
- **(A) Zoomed-out district map + drill-down local minimap.** *(Recommended)* Two levels, like the SVG.
- **(B) One big scrollable room-grid map.** Everything at once; can get noisy at scale.
- **(C) List/compass wayfinder, no big map.** Text-first, minimal — "Custodian Arcology: NE, ~far."

### Decision 16 — Discovery / fog-of-war
- **(A) Yes — the overworld fills in as you explore.** *(Recommended)* Big-unknown feel, rewards
  scouting.
- **(B) No — the whole map is visible from the start.** Simpler; players plan freely.

---

## 10. Systems That Must Scale With the Map

A checklist so growth doesn't silently break existing systems:

- **Spawning** — per-region spawn tables & density budgets (Phase 0 region metadata enables this).
- **Economy nodes** — ATMs, banks, vendors deliberately placed per district ([design.md](design.md)
  defers this to expansion — this is that pass).
- **Weather field** — already samples over `map_world` by grid coords; a bigger surface means more
  cells but the model already scales.
- **Sound propagation** — BFS over exits; fine, but denser graphs mean tuning `HEAR_THRESHOLD`.
- **Ambience** — per-region ambient themes so districts *sound* distinct.
- **Power grid** — citywide lighting sim; new districts need power topology (or deliberate darkness,
  e.g. the Cinder Reach).
- **Faction/corp territory** — the map becomes the corp system's board (§6).
- **Performance** — in-memory world cache loads all zones at boot; 1,000+ zones is fine for Postgres
  + Maps, but worth a load-time check at each ring.

### Decision 17 — Regionization approach
- **(A) Add a `region` field to zones; assign danger/spawns/ambience/ownership per region.**
  *(Recommended)* One schema touch (deliberate, per the no-migration rule), huge authoring leverage.
- **(B) Keep everything per-zone.** No schema change; more repetitive authoring, more drift risk.

---

## 11. Tone & Texture Guardrails (so 100×100 still feels like *this* game)

The bigger it gets, the easier it is to drift into generic open-world. Anchors from
[story.md](story.md) / [design.md](design.md) to hold:

- **Darkly funny, always.** Every district needs a joke — an HOA in the ruins, a cult built around a
  vending machine, a Franchise loyalty program that never stopped.
- **Systems outlive purpose.** Infrastructure that still runs for no one (Coldwater Power Station is
  the template — do more of that).
- **Brutal but recoverable.** Death is common, funny, a setback — not a wall.
- **The machine is watching.** The further out, the more Architect-adjacent the texture, peaking at
  the Deep Data Center.
- **Legibility over sprawl.** Players should always be able to reason about "how deep am I, how bad
  is it, how do I get home."

### Decision 18 — Nostalgia era for pop-culture rot ([story.md](story.md) open question)
- **(A) 2010s.** *(Recommended)* Streaming-era, social-media, gig-economy detritus — richest satire vein.
- **(B) 2000s.** Mall culture, early internet, reality TV.
- **(C) 2020s.** AI hype, crypto, remote-work ghost offices — closest to the bone.
- **(D) Deliberately blurred across all three.**

### Decision 19 — Non-human NPC types in the deep map ([story.md](story.md) open question)
*(multi-select)*
- **(A) Mutants** (already have a mutation system to hang this off).
- **(B) Cyborgs / augmented humans.**
- **(C) AI-bodied creatures / drones / rogue automata** (fits the Architect theme).
- **(D) Keep it human — the horror is that it's all just people.**

---

## 12. How We'll Actually Build It (working method)

- **One wave at a time**, each ending in `npm run test:regress` + a dev-panel DB export.
- **Content lives in Postgres**, authored via the dev panel / bulk-DB flow — never hardcoded
  ([CLAUDE.md](../CLAUDE.md) core rule).
- **Engine changes are rare and deliberate** — most of this is *content* + a little Phase-0 tooling
  (region metadata, wayfinding). Any schema touch follows the no-startup-migration rule
  (one-shot script + `SCHEMA_SQL` edit).
- **The SVG is the north star** — as districts land, update
  [roadmap-world-map.svg](roadmap-world-map.svg) and the "BUILT TODAY" boundary so the map always
  shows real progress.

### Decision 20 — First concrete step after you approve this plan
- **(A) Phase 0 tooling** (region metadata + a wayfinding primitive) so scale-building is cheap.
  *(Recommended)*
- **(B) Phase 1 content** — start filling the Marquee District & city ring immediately; tooling as
  we hit friction.
- **(C) A vertical slice** — build one *badlands district end-to-end* (spawns, faction, loot,
  travel) as a proof-of-concept template for every later district.

---

## Decision Summary (answer these and the roadmap locks in)

| # | Topic | Recommended |
|---|---|---|
| 1 | How literal is 100×100 | A — hard grid, filled in waves |
| 2 | Density philosophy | A — dense core, sparse frontier |
| 3 | Danger gradient shape | A — smooth concentric |
| 4 | PvP in inner ruins | A — opt-in / flagged |
| 5 | Phase ordering | A — outward by ring |
| 6 | Wave size | A — one district per wave |
| 7 | Architect's Core payoff | A — reachable near-unsurvivable endgame |
| 8 | Must-have landmarks | *(multi-select)* |
| 9 | Territory mechanics | A — influence tug-of-war |
| 10 | Player agency over territory | A — corps can capture badlands |
| 11 | Reasons to travel | A — every district a unique draw |
| 12 | Long-distance travel | A — fast-travel between anchors |
| 13 | Distance gates danger | A — yes |
| 14 | Travel vs survival clock | A — crossings stress meters |
| 15 | Overworld map style | A — district map + drill-down |
| 16 | Fog-of-war | A — yes, fills in |
| 17 | Regionization | A — add `region` field |
| 18 | Nostalgia era | A — 2010s |
| 19 | Non-human NPC types | *(multi-select)* |
| 20 | First concrete step | A — Phase 0 tooling |
