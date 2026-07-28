# The Studio

A map editor that edits **files**.

```bash
npm run dev        # game server on :3000 AND the Studio on :5180
npm run studio     # the Studio alone
```

→ <http://localhost:5180>. Local only; there is no auth and no reason to expose it.

`npm run dev` starts both because needing two terminals was the only real cost of
keeping them apart ([scripts/dev.mjs](../../scripts/dev.mjs) is the whole of that
integration — it spawns, it reports, it takes the other one down when one dies).
They remain two processes, and that is the point: this one has no database in it,
and its save path lints ~10k files synchronously, which inside the game server
would stall the tick loop on every save. `npm run dev -- --no-studio` opts out.

## What it is

The dev panel's Maps tab edits a live database and mirrors each edit into a file
afterwards. The Studio reads and writes `content/` and nothing else — **there is no
database in the process at all** — which removes a whole class of "it looked right
in the tool and shipped wrong". Two properties do that work, and both are pinned by
`npm run test:regress`:

**The preview is the ship.** Every fill, ink and glyph on the canvas comes from the
render spec produced by [`scripts/content/derive.mjs`](../../scripts/content/derive.mjs)
— the same module `content:import` runs. The server owns no palette, the client owns
no contrast function, so neither can draw a colour the build would not produce. That
matters more than it sounds: before the pipeline's step 3 there were **three**
disagreeing terrain palettes and two different contrast functions, so the same tile
was lettered differently depending on which tool you looked at it through.

You can watch it be true. Paint `grass` onto a wilderness tile and it stays dark
brown, because the palette entry sets `authored_bg_wins` and the tile's own
`bg_color` is its room-colour identity. A naive editor would have shown you green
and shipped you brown.

**The form is the catalog.** The inspector is generated from
[`client/shared/tagCatalog.js`](../../client/shared/tagCatalog.js) — label, shape,
group, help text, enum options, `refTable`. There are no hand-written form fields, so
a column added to the catalog is editable here without touching this tool, and a
field that is *not* catalogued cannot be typed in by accident.

## What it refuses

Every save runs the same shape checks `content:lint` runs, plus the schema's own
column list, and **refuses on error**. The Studio must not be able to author
something the deploy gate will reject — finding that out at push time is the loop
this replaces. Proven against all five failure modes:

| you try to | it says |
|---|---|
| point `audio_theme_id` at a song that doesn't exist | `is not a row of audio_songs` |
| set `flags.radiation` to `"hot"` | `radiation (number: got "hot")` |
| invent a flag | `is not in the field catalog` |
| invent a column | `is not a column of zones` |
| set an out-of-range enum | `not in indoors/outdoors/city/…` |

A refused save leaves the file untouched, byte for byte.

Unresolvable references are also shown rather than hidden: a `ref` field whose value
names nothing renders red and says `NOT IN <table>`, instead of silently accepting a
dead string. Per spec §10.1 the Studio will **not** create the missing target — a
loot table or an audio theme is somebody else's entity, made in the dev panel or
`design-cli`. Its job ends at *"this tile points at that table."*

## The map owns what belongs to the map

Some things are facts about a whole map, not about each of its tiles, and the
tool used to ask for them per tile. **A map hangs off one world tile** — that is
`maps.parent_zone_id` — and every tile carries a copy in `parent_zone` so the
engine can read it off the tile it is standing on. When 331 tiles each hold their
own copy, they drift, and the drift is silent because a stale id still resolves:

- Halcyon's **Elevator** named its own Grand Lobby as its parent, not the tower's
  street tile. Half the world used `parent_zone` that way; every runtime reader
  uses it the other way.
- Three utility rooms — under Jitter, the Meltwater Diner and Ward Nine Permits —
  still named the world tile their building stood on **before it was moved**. A
  player leaving through one would have surfaced two blocks away.

So the anchor is edited on the map (**Map properties…**) and **pushed to every
tile in the same save**, and it is *locked* on the tile inspector with a note
saying where to change it. `content:lint` errors on any tile that disagrees, so
a drift reintroduced by hand or by an old script fails at the gate rather than
shipping. The repair for an existing tree is
[`scripts/content/sync-map-anchors.mjs`](../../scripts/content/sync-map-anchors.mjs),
which is idempotent.

Tiles on **no map** are untouched: there `parent_zone` is the dev panel's room
grouping, which is a different thing and stays editable.

**A map's name works the same way.** Leave it empty and an interior map is named
after the building it hangs off, so renaming the facade renames the map. 17 of 69
had already drifted apart — The Cherry Pit's interior was still filed under
"Cathode Row", Ampersand Electronics under "The Overpass", Ration Nine under
"Battery Square". Type a name only to override that; four maps do, because their
facade is named for a room rather than for the building. Nothing player-facing
reads `maps.name` — it is an authoring label in this list, the dev panel's, and
the audit — which is what makes deriving it safe.

## What it writes

`content/zones/<id>.json`, through the same `canonicalJson` writer `content:export`
uses — so a no-op save produces **no diff at all**, and a terrain paint produces a
one-line one. Review it with `git diff` like any other change and ship it with a
push.

## What it does not do yet

This is increment 2 of spec §11 step 8. It views any map, edits every authored field
of a tile, paints terrain, and owns the map-level properties above. It does **not**
yet do New Building, Move Building,
the region planner, connection editing, or multi-tile structural operations — those
stay in the dev panel and in
[`scripts/place-building.mjs`](../../scripts/place-building.mjs) until the next
increment moves them.

The dev panel's Maps tab now carries a banner saying which side of the fence it is
on. Both tools work; what does not work is assuming they can see each other. Paint
in the Studio and the dev panel is stale until `npm run content:import`.

## Lint

The bottom-right badge runs `content:lint` over the working tree on every save, so
the authored-half rules answer **live** (spec §8.4). The derived-half rules — the
ones that read `zone_render` and `zone_edges` — need an import and the badge says so
rather than implying a freshness it doesn't have.
