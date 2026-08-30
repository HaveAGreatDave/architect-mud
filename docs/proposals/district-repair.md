# District repair — the city is filed as wilderness

**Status: the painter is BUILT; the `util` prefix is FIXED; the painting is the work that
remains** (restamped 2026-08-30). Split out of [unrest.md](unrest.md) on 2026-08-24, where it
had been written as that system's phase 0. It is not a prerequisite for anything. It is worth
doing because three shipped systems are degraded without it.

- **§1 the District Painter — BUILT**, in `926a0b9fb` (2026-08-23), with all four tools, the
  district-content palette and the resolved-vs-authored display. ⚠ It shipped the day *before*
  this doc was written calling it design; the status line was stale on arrival.
- **§2's second bug — FIXED.** `util` is off `media.json`'s prefixes, so the 116 `zone_util_*`
  corridors no longer classify as the Media District.
- **The painting — still to do**, and it is the whole remaining job.

**Two corrections to the census below, measured 2026-08-30.** The urban figures hold almost
exactly (274 tiles now, `wasteland` 160), so nothing has drifted. But:

**The 28 `wilds` tiles are not part of the bug.** They are a single column at x918 running
y920–947 — *south of the city*, whose bbox ends at y919. The Glacis, the Scoured Plain, Ferric
Wash, Bloodrock Table, Ochre Draw: that is the Gate Road leaving town through actual
wilderness, and `wilds` is the right answer for every one of them. The real defect is **160
tiles, not 188**.

**And the job is ~14 decisions, not 274.** The tiles carry STREET NAMES, and a street is a
coherent unit to assign — Meltwater Row (23 tiles), Runway (21), Kessler Street (15), Halcyon
Boulevard (14), Grasslands (12), Ironside Street (11), Marrow Street (9), Fisherman's Green
(8), the Gate Road (7), Glacier Street (5), Voss Avenue (4), Cinder Lane (2), Foundry Way (2),
plus 106 single-tile buildings that can take the street they stand on. This is what makes the
"an afternoon with a brush" estimate below optimistic in the right direction: the eye is still
needed to say WHICH district a street belongs to, but it is answering fourteen questions
rather than painting a field.

⚠ **Several streets already straddle two districts** — Meltwater Row is part `docks` and part
`wasteland`, Kessler Street part `wasteland` and part `residential` — which is the direct cause
of the crossing line firing every seventh step. Assigning by street fixes the boundary noise as
a side effect, because a street stops being an edge.

## The symptom

`districtFor` is not a dormant helper. It runs **per move, per describe, and per ambient
beat** — [schema.js:140](../../server/models/schema.js:140) records it as sync and query-free
by contract for exactly that reason. Three live consumers:

| Consumer | What it does with the district |
|---|---|
| [movement.js:798](../../server/engine/commands/movement.js:798) | the boundary-crossing threshold — `You cross into {name}.` plus a once-per-player mood blurb |
| [describe.js:1213](../../server/engine/commands/describe.js:1213) | room description |
| [district-ambience](../../plugins/district-ambience/index.js:41) | the leitmotif that is supposed to make the Docks smell different |

All three are currently wrong in Coldwater, and not in the way the first draft assumed. The
problem is not mainly that tiles are unassigned — it is that **the city's streets and
buildings are affirmatively filed as wilderness.**

Measured against the tree on 2026-08-24, over Coldwater's 273 urban tiles (terrain in
road / asphalt / concrete / park / dirt_road, or carrying a building):

| Authored `flags.district` on an urban tile | tiles |
|---|---|
| `wasteland` | **159** |
| `residential` | 34 |
| `docks` | 28 |
| `wilds` | **28** |
| `yards` | 24 |

**187 of 273 — 68% of the built city — are labelled `wasteland` or `wilds`.** So
`district-ambience`, whose whole stated purpose is that "nobody is told which district they
are in, they just notice the Docks smell different", plays wasteland leitmotifs on the
downtown pavement.

The crossing line is worse, because the values are interleaved rather than uniform. Of the
393 orthogonally adjacent urban tile pairs, **54 cross a district boundary — 14%.** Walking a
street in Coldwater fires `You cross into The Wastes.` roughly every seventh step. The line
exists to turn an invisible neighbourhood edge into a felt threshold; at that rate it is
noise, and the once-per-player blurb behind it is spent on a boundary that is not real.

Separately, twelve of the twenty authored districts hold **zero** tiles — `ashway`, `redline`,
`northcity`, `government`, `slum`, `civic`, `commercial`, `industrial`, `media`, `nightlife`,
`slaglands`, `hazard` — including every one the fiction leans on.

## Root cause

Coldwater's modern grid is `zone_district_<x>_<y>`, which matches no entry in the legacy
`DISTRICT_PREFIX` table, so `flags.district` is a tile's only identity
([districts.js:88](../../server/engine/districts.js:88)). Where it went unset the tile falls
through to `FALLBACK_KEY = 'residential'`; where it was set during the region build it was set
from terrain, which is why paved streets inside the city carry `wasteland`.

The 478 Coldwater tiles carrying no district key at all are almost entirely harmless — 442 of
them are open water.

### A second, smaller bug

`content/districts/media.json` claims the prefix `util`, and there are 116 `zone_util_*`
tiles. Every utility corridor in the game classifies as the Media District, so
"the Media District is under lockdown" would fire in a plant room. Fix the prefix in the same
pass.

## The fix

### 1. Build a District Painter — a new mode in the Maps editor

4,900 tiles would be a script and a guess. 273 is an afternoon with a brush, and the eye is
the only thing that can tell a high street from a side street.

Add a `district` mode to [maps.js](../../client/devpanel/js/panels/maps.js) beside the
existing Terrain / Paint / Safe-Zone modes, with **the same four tools the terrain painter
already has** — brush, flood-fill, rectangle-marquee and eyedropper
([`terrainPaintStart:1368`](../../client/devpanel/js/panels/maps.js:1368),
[`terrainPick:1385`](../../client/devpanel/js/panels/maps.js:1385),
[`terrainFill:1395`](../../client/devpanel/js/panels/maps.js:1395),
[`terrainRectStart:1419`](../../client/devpanel/js/panels/maps.js:1419)) — and the same undo
stack and draggable tool panel.

**The palette needs no new file.** `TERRAIN_TYPES` is loaded from `content/map/terrain.json`
because terrain had no content home; districts do — `content/districts/*.json` already carries
`id`, `name` and `color`, which is exactly a swatch. The painter writes `flags.district` and
nothing else, so it inherits the tile-save path terrain already uses.

Two rules specific to this painter:

- It must **show the resolved district, not just the authored one**, mirroring
  `mapZoneTerrain`'s authored-wins-then-infer shape at
  [maps.js:1118](../../client/devpanel/js/panels/maps.js:1118), so a builder can see both the
  `residential` fallback and the `wasteland`-on-tarmac case and paint over them.
- It must **flag any tile whose resolved district sits outside `region_coldwater`**, which is
  how the Deadwater and Terminus fallout gets caught by eye rather than in play. Those regions
  fall through to `residential` too.

### 2. Paint the 273

Then fix the `util` prefix on `media.json`. Ships via CODEX like any other content.

## Verification

- **Regress:** `districtFor()` returns a non-wilderness district for every urban Coldwater
  tile; no `zone_util_*` tile resolves to `media`; the share of adjacent urban pairs crossing
  a boundary drops below a stated threshold (a real district edge should be rare, not one step
  in seven).
- `npm run content:lint` before `content:import`.
- `npm run client:smoke` covers the painter for parse errors — the only automated coverage it
  gets, since there is no headless UI test. ⚠ Devpanel panels are large HTML template
  literals: quote identifiers inside them with 'single quotes', never backticks.
- **Manual:** open the painter, confirm it renders the resolved district so both the
  `residential` fallback and the `wasteland`-on-tarmac case are visible, paint a block with
  each of the four tools, reload and confirm `flags.district` persisted, confirm the
  out-of-region warning fires on a Deadwater tile. Then walk a street and confirm the crossing
  line has gone quiet.

## Relationship to Unrest

[unrest.md](unrest.md) originally made this its phase 0, on the assumption that named
districts had to be the ledger's cell. They do not — that system now derives its cells from
grid coordinates and needs nothing here. If this ships, Unrest can adopt districts by swapping
one key function, and it gains the ability to have an NPC say *"the Ashway"* instead of a
bearing. That is an upgrade to it, never a dependency of it.
