# wardrobe

Saved outfits layered over ordinary container storage.

## What a wardrobe is

Furniture with `object_type: "container"` and `flags.wardrobe: true`. It is a
normal container in every other respect — `flags.container` sets capacity, and
`open` / `stow` / `pull` all work unmodified. The only difference is that the
`container.view` hook retypes the panel payload to `wardrobe_view` and hangs the
player's saved outfits off it.

## Outfits

An outfit is an ordered list of **item template ids**, scoped to
`(player, wardrobe furniture)` in `player_outfits`. Template ids, not inventory
row ids: rows merge and are re-created by stow/pull, and a replaced jacket is a
new row — a saved look should mean "that jacket", not "that instance of it".

Wearing an outfit strips every body slot plus accessories (the wielded weapon is
left alone — that's armament, not clothing), then equips each piece, preferring
one already carried and falling back to a copy hanging in that wardrobe (which
is pulled out first). Pieces it can't find are reported, not fatal.

## Teaching the verb

House convention (`teachVerb` in `server/engine/messaging.js`): the first time a
character examines *or* opens any wardrobe, one line of prose shimmers `outfits`
as a clickable verb. The examine path also ripples the wardrobe's own room-pane
link (`pointAt`), so the nudge lands in both places a player might look. Guarded
by the `wardrobe_outfits_taught` player flag, cached in memory per session so the
flag read doesn't repeat on every later wardrobe.

## Verbs

| verb | who uses it |
| --- | --- |
| `outfits [name]` | player — text listing (a `wardrobe`-tagged specialized action, so examine surfaces it) |
| `outfit list\|save <name>\|wear <name>\|delete <name>` | player |
| `outfitsetid <furnId> <name>\|<ids>` | wardrobe panel — paper-doll Save |
| `outfitwearid <furnId> <name>` | wardrobe panel |
| `outfitdelid <furnId> <name>` | wardrobe panel |

The three by-id verbs answer with the refreshed `wardrobe_view`, so the panel
never has to re-request it.

## Client

`client/game/js/panels/wardrobe.js` (+ the `#wardrobe-panel` markup in
`client/game/index.html` and the `.wdr-*` block in `client/game/styles.css`).
Three columns: saved outfits, a paper doll of drop pads, and the wardrobe's
hanging stock over your carried clothes. Drag any garment onto its matching pad,
name the look, save.
