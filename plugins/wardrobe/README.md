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
| `outfitwearnowid <furnId> <ids>` | wardrobe panel — doll's "Wear Now", no save required |
| `outfitdelid <furnId> <name>` | wardrobe panel |

The three by-id verbs answer with the refreshed `wardrobe_view`, so the panel
never has to re-request it.

## Client

`client/game/js/panels/wardrobe.js` (+ the `#wardrobe-panel` markup in
`client/game/index.html` and the `.wdr-*` block in `client/game/styles.css`).
Three columns: saved outfits, a paper doll of drop pads, and three rails —
what's **hanging** in the box, what you're **carrying**, and what you're
**wearing**. Drag any garment onto its matching pad, name the look, save.

Each body pad is a stack, not a slot: a piece lands on its own `layer`
(underwear / outerwear / armor), so a liner, a shirt and a plate coexist and all
three are saved. Every body pad carries a **layer strip** — three pips named for
that body part (Liner / Hat / Helmet), filled when occupied, each naming its
garment and removing exactly that layer. The pips are read-and-remove only, never
drop targets: a garment's layer is its own tag and the server re-derives it on
wear, so re-aiming one would build a look that dresses differently from how it
was composed. The worn rail carries no inventory row — a garment on your body
can dress the doll but can't be hung or taken (that's `Undress`), and the missing
row is what enforces it.
