# The Under gate to North City + map readability + colors

**Status:** Workstreams **B, C BUILT 2026-07-03**. Workstream **A's live-in-production status is
unverified** — a 2026-07-04 spot-check found production zone exits that don't match the sealed-gate
description below; a follow-up task was spawned to confirm one way or the other. Workstream **D's
mesh-to-avenue rollouts never actually landed** (see correction below); superseded by the **Named
arteries** tagging pass, **BUILT 2026-07-04** (world reload/restart PENDING). Companion doc:
[the-under.md](the-under.md) (A is recorded there too, as the "North City gate corridor" box).

## Context

Three connected asks:

1. **The Under → gate to North City (NW).** North City (the safe govt/NC/uptown heights,
   `zone_gov_*`/`zone_nc_*`/`zone_up_vellum`) was reached by simply walking north across a wide-open
   grid seam. Goal: make the northwest approach feel *earned* — **one guarded surface chokepoint** plus
   **a compact underground corridor (The Under)** as the atmospheric route up. Deliberately **minimal**
   (a gate corridor, not the full 26-tile metro/cavern dungeon still scoped in
   [the-under.md](the-under.md)). Far-west Redline/Slagworks neck excluded.

2. **Map readability.** The full-screen map popup already drew exit connectors (`─ │ ╱ ╲`) between
   tiles, but the **sidebar 5×5 minimap did not** — floating cells with no lines, so you couldn't tell
   which neighbours were walkable vs. walled. Fix: draw connectors on the minimap + a blocked cue
   (HellMOO-style "streets between rooms").

3. **Colors.** The sidebar minimap coloured cells by danger as *text colour only*, which read weakly.

## Files

- `client/game/js/panels/minimap.js` — `renderMinimap()` (sidebar) mirrors `openMapPopup()`'s
  connector model. `luminanceTextColor()`, `FUNC_LEGEND`.
- `client/game/styles.css` — `.mm-*` minimap rules; `.map-c/.map-link/.map-room` full-map rules.
- `server/engine/exits.js` — `removeExit()` / `addExit()` canonical exit mutation helpers.
- Content build: direct-DB writes + `POST /api/world/reload` per touched zone (per the
  `reference-mud-content-build` pattern — bypasses the `zone-validator` autoRepair hook).

---

## Workstream A — The Under gate corridor  ✅ BUILT

The NW North City enclave is **14 safe tiles** (govt block + west North City + the uptown finger
`zone_up_vellum`), sealed today by 14 surface crossings into the surrounding wastes/bay/civic grid.

- **Surface wall / chokepoint:** severed 13 of the 14 crossings; kept one open — **The Steps**,
  `zone_civ_steps` ↔ `zone_up_vellum` (gate tile marked ⛩). The only surface way in.
- **The Under corridor (3 new z-1 tiles):** `zone_under_commons` (−3,−3, `up`→`zone_civ_commons`) →
  `zone_under_deep` (−3,−4) → `zone_under_landing` (−3,−5, `up`→`zone_gov_mezzanine`). Descend at the
  Commons, walk the tunnel, resurface in the government quarter. Free walkable tunnel; **no express
  train** (that's the future `plugins/metro/`).
- **Verified:** global BFS — 223/223 tiles reachable, no orphans, no zero-exit tiles; enclave boundary
  seams are exactly The Steps + the Under landing. `npm run test:regress` **207/207**.
- **Scope boundary:** North City's **east** half (x 5..8, across the bay, reached from The Yards) is
  untouched — this gates the NW approach only. Sealing the east would need the same treatment on the
  Yards seam (future).
- **Live:** content is in Postgres; **world reload/restart PENDING** to go live. Build script lived in
  the session scratchpad (`build-under-gate.mjs`), not the repo.

---

## Workstream B — Minimap connectors + blocked cues  ✅ BUILT

`renderMinimap()` now builds a **9×9 room+gap grid** (mirroring `openMapPopup()`): even tracks hold
rooms, odd tracks hold the connector *between* two rooms. A gap with a connector (`─`/`│`) = a walkable
exit; an empty gap = a wall. Connectors are drawn from each tile's real exits, so the new gate wall
reads instantly. Applied to all three minimaps (sidebar, HUD, mobile); CSS switched the containers to
`display:grid` with shared track layout + per-context `--mm-room`/`--mm-gap` sizes, kept within the
sidebar width (no scrollbar).

---

## Workstream C — Colors  ✅ BUILT

Minimap room cells now carry **danger-tinted backgrounds with borders** (safe→green, low→amber,
medium→orange, high/lethal→red, lethal glows) — the same palette as the full map's `.map-room.danger-*`,
so the two views read consistently. Connector/void cells are dimmed so real rooms dominate. (The
regional `FUNC_LEGEND` land-use palette was left as-is; nudge low-contrast pairs later if needed.)

---

## Workstream D — Full-map street rework

Three tiers (full detail in the session plan file). **Tier 1 BUILT 2026-07-04; Tiers 2–3 planned.**

### Tier 1 — client-only street rework  ✅ BUILT
Reworked `openMapPopup()` + `.map-*` CSS in [minimap.js](../../client/game/js/panels/minimap.js) /
[styles.css](../../client/game/styles.css):
- **Drawn streets:** connectors are now CSS-drawn bars (`.map-street-h/-v` via `::before`) filling the
  gap cell, not floating `─ │` glyphs — continuous lines that meet room edges and form junctions.
  (Diagonals keep the glyph fallback; they're vanishingly rare.)
- **Coloured streets:** each segment is tinted via inline `--street` — the *higher danger* of its two
  endpoints in zone view (any street touching lethal glows red), or a blend of the two land-use
  colours in regional view (`streetColor()`).
- **Your-exits emphasis:** streets touching the current tile get `.map-street-open` (brighter/thicker
  accent bar) — "where can I go" pops.
- **Building markers:** tiles with a non-empty `buildings[]` get a corner dot (`.map-has-building`).
- **Dead-end cue:** a room with exactly one connector is dimmed (`.map-deadend`).
- **Legend keys:** street / your-exits / building added to both legends.
- No server change, no data dependency.

### Landmark POI icons  ✅ BUILT 2026-07-04
Colour-coded landmark icons on the full map, from clean signals (no guesswork), kept **sparse**
(~18 icons over 220 tiles). Server `mapPoi()` in [movement.js](../../server/engine/commands/movement.js)
classifies each tile by priority and adds `icon`/`poi` to the map payload; the client
([minimap.js](../../client/game/js/panels/minimap.js) `openMapPopup`) draws the icon in place of the
2-letter abbrev with a per-category colour + a legend key.
- ✈ **Airport** (`airfield_name` flag, 6) · ★ **Police** (`building_type=police`) · ⚡ **Power plant**
  (name/id + adjacent power *building*) · ♥ **Strip club** (`building_type=club`) · $ **Vendor**
  (`building_type=shop`/`grocery` or a vendor NPC in the tile) · ⇕ **Stairs** (up/down exit — surfaces
  the Under seams).
- Priority order per tile picks the single most salient landmark; current-tile beacon still wins.

### Tier 2 — semantic crossings  ⏳ PLANNED (needs a small read-only payload add)
Stair (▲/▼) glyphs for `up`/`down` exits — makes the Under gate visible on the surface map — and
door/locked-crossing glyphs; back-port both to the sidebar minimap. Requires extending `mapTile()`
([movement.js](../../server/engine/commands/movement.js)) with vertical-exit + door/lock flags.

### Tier 3 — ambitious / optional  ⏳ PLANNED
Click-to-path (reuse `findPath`), district-label overlay, fog-of-war discovery, or a `<canvas>`
rewrite if the CSS grid ever struggles at full-rectangle regional zoom. Likely separate projects.

## Player "you are here" beacon  ✅ BUILT 2026-07-04

The current-tile marker was the glyph `()`, hard to read at small sizes. Replaced with a CSS-drawn
beacon — a glowing accent core (`::before`) plus a pulsing locator ring (`::after`, `@keyframes
you-ping`, honours `data-motion=off`) — shared by `.mm-current` (sidebar/HUD/mobile), `.map-current`
(full map), and the legend swatches. The old `map-current-pulse` keyframes were removed.

## Dedicated pathways — street network (prototype BUILT 2026-07-04)

**Why:** the surface is an open mesh — avg **3.5 / 4 cardinal exits per tile, 133/220 fully
4-connected** — so the drawn street connectors depict a meaningless lattice and districts have no
front/back. Channelling movement onto arteries makes the map legible, makes districts feel like
places, and makes The Under/metro worth using. Target: drop avg degree toward ~2–2.5 (arteries 2–3 at
intersections, blocks/cul-de-sacs at 1).

**Prototype (applied to live content, reversible):** the downtown/docks core **x −1..4, y −4..1
(36 tiles)** was converted from mesh to an avenue grid — Grand Avenue (x0, N–S), Quay Road + Cross
Boulevard (E–W), east/west avenues, 1st–3rd Streets, a boatyard pier — severing **40 internal
block-edges** not on a street. Preserved: all `in`/`up`/`down` exits, every boundary-crossing edge
(rest of map untouched), and the North City gate (The Steps). Avg exits in the rect **3.61 → 2.50**.
Verified: whole-map BFS **220/220 reachable, no orphans**, the devised docks→North City route walks
end-to-end (`fishmarket → quays → wharf → media_plaza → the Steps → up_vellum`), `npm run
test:regress` **217/217**. Built via scratchpad `proto-streets.mjs`; originals snapshotted to
`proto-streets.snapshot.json` (run `--revert` to restore). **World reload/restart PENDING** to walk
it live. The pre-change state is also in the normal DB backup/export.

**Rollout #2 — The Yards (BUILT 2026-07-04):** the freight rail yard east of the core
(**x 5..8, y −3..2, 24 tiles**) converted to a deliberately *linear* layout — long N–S sidings with
two E–W haul roads (North Head + Main Haul) — the opposite of downtown's grid, to show the model fits
a district's character. 24 internal edges severed, avg **3.75 → 2.75**, BFS 220/220, regress
**217/217**. Script `proto-streets-yards.mjs` (+ `.snapshot.json`, `--revert`). Seam to downtown left
open (multiple x4↔x5 crossings) — gating district seams to single "gates" is a later refinement.

**Rollout #3 — The Undermarket / Deep Sprawl (BUILT 2026-07-04):** the southern slum
(**x −3..2, y 2..3, 12 tiles**) given an organic *twisty warren* — one alley zig-zagging through the
market (hub `zone_slums`, whose `down` to The Under is preserved) with cul-de-sac stubs, not a grid.
10 internal edges severed, avg **3.17 → 2.33** (twistiest yet), BFS 220/220, regress **217/217**.
Script `proto-streets-under.mjs`. Three districts now each read differently: downtown grid · Yards
sidings · Undermarket warren.

**Rollout #4 — The Wastes / Ashway (BUILT 2026-07-04):** the western rubble (core **x −8..−2,
y −3..1, 35 tiles**) made a *sparse broken maze* — the **Ashway** (y=0) stays the through-road west to
the Slagworks, a deterministic DFS maze (fixed sin-hash, no RNG) carves winding **dead-end** paths off
it, and the region is **seam-gated**: only 4 boundary gateways stay open (Ashway→Slagworks, an east
road to Franchise Strip, a civic breach by The Steps, a south link to the Undermarket) — so the wastes
read as enclosed, not an open field. First rollout to gate boundaries (loads neighbour tiles to sever
reciprocals; `civ_commons` `down` to The Under preserved). 64 edges severed, avg **3.89 → 2.09**
(sparsest district), **4 dead-ends**, BFS 220/220, regress **217/217**. Script `proto-streets-wastes.mjs`.
Four districts now: downtown grid · Yards sidings · Undermarket warren · Wastes maze.

**Rollout #5 — North City interior (BUILT 2026-07-04):** the 14-tile govt/elite enclave (already
gated at The Steps + the Under) given a formal **monumental grid** — a grand N–S ceremonial Axis
(x −1) up from the gate, the E–W **Mall** across the ministry frontage (y −7), a Ministry Row (y −6),
orderly blocks, and only two corner **monument-square** dead-ends (Sable, Spindle). Interior-only
(the enclave boundary IS the gate); `gov_mezzanine`'s `down` to The Under and the Steps gate both
preserved. Just 4 internal edges severed (it was already tight), avg **2.64 → 2.43** — deliberately
*more* connected than the wastes maze, fitting an elite planned quarter. Script
`proto-streets-northcity.mjs`. Five districts now, each legibly different.

**Rollout (if kept):** continue phase district by district (like the coldwater build), BFS/regress each phase,
and watch the gameplay seams the exit graph drives — enemy patrols & pathfinding, fleeing (dead-ends
become death traps), spawn/quest reachability, NPC wandering. This is a project, not a one-shot.

**Correction (2026-07-04):** direct inspection of production found none of Rollouts #1–5 actually
landed — `map_world` still averages **3.61** cardinal exits/tile (the documented *pre-rework* baseline),
no zone carries a street/artery flag, and none of the "Row/Lane" names found are multi-tile corridors
(they're ordinary single-room flavor names). The mesh-to-avenue conversion described above was either
reverted or never actually applied to the live database — the docs above were stale. Superseded by the
lighter-weight "Named arteries" tagging pass below, which achieves the readability goal without
re-deriving the mesh-severing project.

## Named arteries (BUILT 2026-07-04)

Since the mesh-to-avenue rework never actually landed, delivered the "highlight major roads" ask a
different way: a `flags.artery` tag (array of street names, so an intersection tile can carry more
than one) on top of the **existing, unmodified mesh** — no exits changed, no BFS/regress risk.

- **Server:** `mapTile()` in [movement.js](../../server/engine/commands/movement.js) exposes
  `artery: string[] | null` per tile from `zone.flags.artery`.
- **Client:** `openMapPopup()` in [minimap.js](../../client/game/js/panels/minimap.js) colours a street
  segment as a major road (fixed cyan, thicker) when both endpoint tiles share a named artery —
  distinct from the pink "your exits" highlight, which still wins when both apply. New legend row.
- **Content:** [scripts/tag-arteries.js](../../scripts/tag-arteries.js) (idempotent, additive) tagged
  **7 named arteries / 34 tiles** across four districts, each verified against the real exit graph
  before tagging:
  - **Grand Avenue** — downtown N–S spine, x=0 (Rebar Field → Mediaform Plaza → Limelight Lot →
    Threshold Plaza North → The Threshold → The Sprawl Gate)
  - **Quay Road** — downtown docks E–W, y=−3 (Civic Steps → Mediaform Plaza → The Wharf → The Quays →
    Fishmarket Dock → Smuggler's Slip)
  - **The Haul Road** — Wastes/Ashway E–W, y=0, Slagworks Gate → Franchise Strip (8 tiles)
  - **North Head** / **Main Haul** — The Yards' two E–W haul roads, y=−1 and y=0 (4 tiles each)
  - **The Axis** — North City ceremonial N–S spine, x=−1, up from the Steps gate (5 tiles)
  - **The Mall** — North City ministry-frontage E–W, y=−7 (5 tiles)
  - Deliberate intersections carry both names: Mediaform Plaza (Grand Avenue × Quay Road), Civic Steps
    (Quay Road × The Axis), Halcyon Heights (The Axis × The Mall).
  - **The Strip** — Marquee nightlife-district main street, y=0 (The Marquee → Battery Square →
    Muster Yard; Muster Yard is a second intersection, already carrying Main Haul)
- Applied directly to production (`scripts/tag-arteries.js` run against `PROD_DATABASE_URL`).
  **World reload/restart PENDING** to go live.

### Avenue View (BUILT 2026-07-04)

A rendering-mode toggle on the full map popup — `#map-avenue-toggle` button next to the
interior/zone/regional tabs — that strips room symbols down to a road-passage glyph so the artery
network reads at a glance: `||` where a named artery runs north/south through the tile, `=` for
east/west, `+` at a crossing, blank otherwise. Pure client-side re-render (`renderMapGrid()`,
factored out of `openMapPopup()` so the toggle doesn't need a server round-trip); `mapState.tiles`
now holds the last-fetched tile set for this. Toggle state persists across pans/zoom-level changes
within the session.

Also fixed a real gap while at it: the full map popup didn't refresh while open if you walked around —
only the sidebar minimap did. `refreshMapIfOpen()` (minimap.js) now silently re-issues `map <mode>`
after every move if the popup is currently open, so it live-tracks you.

## Verification

- **Beacon:** open the client — the current tile shows a pulsing accent beacon (not `()`) on both
  minimap and full map, legibly at every size.
- **Street prototype:** after world reload — walk the downtown/docks core: E–W movement only on Quay
  Road / Cross Boulevard, N–S on the avenues; the docks→North City route threads the Quay to the
  Steps; no tile is a dead pocket you can't leave. `--revert` restores the mesh.
- **B/C:** open the game client, move between zones — the sidebar minimap shows walkable connectors,
  blocked = no line, colours read clearly, and `#sidebar` never scrolls (mobile + HUD too). A faithful
  static preview was generated during the build.
- **A:** after `world/reload` or restart — walk the NW: only The Steps crosses on the surface; the
  Under stair-down → tunnel → stair-up resurfaces you inside North City. DB/BFS + regress already green.
