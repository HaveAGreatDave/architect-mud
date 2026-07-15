# Zone Planner

Materialize a blueprint into zones — grid placement, adjacency exits
(exits stay the traversability law; the planner *writes* them), and full
facade + interior wiring for every building glyph — plus a connectivity lint
for existing maps.

## Paint the map (recommended)

A browser paint editor is the fast, human-first path — draw the district by
hand, no JSON by hand:

```
node tools/zone-planner/serve.mjs            # → http://localhost:5178
```

Open that URL and you get a grid you paint with a **palette** of zone types
(each type = a free-form label, bg/text colour or a click-to-set quick-pair, an
optional marker glyph / map icon, and its zone spec: template, name, tags, and —
for buildings — `building_type` + interior lobby). Cell gestures: **left-drag** =
paint, **right-drag** = erase, **shift-click** = fork just that tile into its own
variant, **ctrl-click** = pick a tile's type as the brush. Grow the map on any
edge with the Grow/shrink controls (top/left growth shifts the origin so painted
tiles keep their world coords). **Save** writes the blueprint straight into
`blueprints/`; **Dry-run** shows the diff and **Apply** seeds it into your local
dev DB (both just run `apply.mjs` under the hood — same idempotency and
validation as the CLI). Work autosaves to `localStorage` between saves;
Download/Import buttons are a server-free fallback.

The painter writes the **v2** blueprint format (a `palette` + a 2-D `cells`
grid); `apply.mjs` reads it directly.
[blueprints/example-block.bp.json](blueprints/example-block.bp.json) is a small
v2 sample (a 5×3 block with two icon-bearing buildings).

### Map icons

A palette type can carry a **map icon** — a named SVG that draws on the game
minimap tile in place of the marker glyph. The SVGs are checked-in files under
`client/game/assets/zone-icons/*.svg` (so they ship on a normal push and the
game static-serves them); a zone stores only the icon **name** in `flags.icon`.
Pick one in the palette dialog's icon field, or **↥ SVG** to upload a new one
into the shared library. Icons are drawn as a `currentColor` mask, so keep them
simple/monochrome (stroke or fill on `currentColor`) — they take the tile's
text colour automatically.

## CLI (v1 ASCII, still supported)

```
node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/<bp>.bp.json            # dry-run diff
node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/<bp>.bp.json --apply    # write to local DB
node tools/zone-planner/lint.mjs [--map map_world]                                      # read-only report
```

The ASCII grid/legend format is one char per cell — see the header comment in
[apply.mjs](apply.mjs) for a worked v1 example. `apply.mjs` auto-detects which
format a file uses (a `palette`+`cells` file is v2, a `grid`+`legend` file is v1).

Either way the tail of the flow is the same: `--apply` against the local dev DB
→ fill in the `[PLANNER STUB]` descriptions in the dev panel →
`npm run content:export` → commit → push (the CODEX deploy).

Building glyphs (legend entries with `interior`) produce the full Phase-5
facade shape: a non-standable `facade`-tagged tile that auto-forwards players
into the building's lobby, an interior map row, and a `world_exit_zone` front
door on the adjacent street.

**Every new building also gets a utility room by default** — a below-grade
(`grid_z − 1`) `utility_room` zone wired `up`/`down` off the lobby, holding a
junction box + caged worklight, plus an overhead light in the lobby, all fed by
a `junction_box` generator linked to the nearest city plant. This is authored
content (the `down` exit is written into `zones.exits`, not a runtime override),
so it survives `content:export` → prod. A building whose interior network
already has a power source is skipped (hand-made basement, re-run). Opt a
building out with `"interior": { "no_utility": true }` in its palette/legend
entry. The shared authoring routine lives in
[../lib/utility-room.mjs](../lib/utility-room.mjs) and is reused by
`scripts/backfill-vendor-utility.mjs`.

Re-running a blueprint is safe on a grown map:
grid coords and planner-drawn exits are reasserted, hand-written prose and
hand-wired exits are preserved, and foreign zones are never touched
(see the idempotency contract in apply.mjs).

The lint reports: grid-adjacent walkable tiles with no connecting exit (the
"map looks connected but isn't" disjointedness — 112 findings on map_world at
first run, 2026-07), teleport-shaped cardinal exits, facade invariant
violations, and runtime exit overrides duplicating authored exits.
