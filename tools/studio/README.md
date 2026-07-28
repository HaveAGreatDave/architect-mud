# The Studio

A map editor that edits **files**.

```bash
npm run studio
```

→ <http://localhost:5180>. Local only; there is no auth and no reason to expose it.

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

## What it writes

`content/zones/<id>.json`, through the same `canonicalJson` writer `content:export`
uses — so a no-op save produces **no diff at all**, and a terrain paint produces a
one-line one. Review it with `git diff` like any other change and ship it with a
push.

## What it does not do yet

This is increment 1 of spec §11 step 8. It views any map, edits every authored field
of a tile, and paints terrain. It does **not** yet do New Building, Move Building,
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
