# graffiti

**Purpose** — spraying a tag on any wall of a building: the front, a side or the back. The `graffiti` crime has sat in the registry (`server/engine/crimes.js`) at 0.3★ since the crime system was built, charging nobody, because there was no verb. This is the verb.

## Commands
- `tag <direction|building|side|back> <text>` — spray up to 48 characters on a wall next door. `tag` alone lists the walls to hand.
- `spraycan [wall]` — the same act with the lid off: the in-browser can (per-letter colour, weight, saved designs). `tag <dir>` with no words and a can in hand opens it too, which is how anybody finds it.

The verb is **`spraycan`, not `spray`** — the flight plugin already owns `spray` (the Locust's crop-duster boom), and plugins beat engine builtins but never each other; the later loader would simply have eaten one of them.

Removal is **not** here — it's `clean` in the [cleaning](../cleaning/README.md) plugin. One verb for "make this room right" beats two.

## The three rules

**1. You spray a BUILDING, not a tile.** `tag` finds the buildings (`flags.is_building`) on the four tiles around you and refuses on open ground. That's the difference between graffiti and a text field: it lands on a thing that exists in the world, and the room line says which thing and which wall of it: *"Somebody's tagged the side of Bodega Vu: …"*. The check is `wallsNear()`, and if it ever returns a non-building the premise is gone, which is why regress guards it.

**Any wall will do.** Since 2026-09-30 the walls are found on the grid, not through exits. A building tile has one exit, on its entrance side, so reading exits could only ever find a front, and the blank flank of a building (where graffiti actually goes, and where the renderer has the most bare brick to put it) couldn't be reached from the street running past it. Each wall is named by which one it is: the `front` faces `flags.entrance`, the `back` faces away from it, and anything else is a `side`. A building with no `entrance` flag calls the wall with its door the front. The front reads as the building's name, the others as *"the side of …"* and *"the back of …"*, and `tag side …` or `tag back …` picks one.

Three limits keep that honest. Only tiles on `map_world` look at the grid, since every other map is a local frame. Standing on a building tile, the building next door shares a party wall with yours and isn't offered. And exits are still read after the grid, so a facade that isn't the tile next door stays sprayable as its front.

Since 2026-08-01 the room line sits **with the room's prose** rather than up among the `[SAFE]`/district/light chips — a tag describes a thing that is in the room. That placement is `describe.js`'s, and it moved every `zone.describeRoom` contributor with it (elevator readouts, shop shutters, airfield notes), which is the right home for all of them.

**2. One tag per wall, and anyone may paint over anyone.** The cap isn't a limit, it's the design. The wall is a contested slot, so the question stops being "what shall I write" and becomes "whose tag is up". It's also what makes the cap a **PRIMARY KEY** rather than a rule somebody enforces: a wall is the pair `(zone_id, target_zone_id)`, the tile you **stand in** and the building you paint, `zone_graffiti` can never hold more than one row per wall in the world, and painting over is an UPSERT. The buried author isn't notified; you find out by walking past.

The tile you stand in is half the key because that's the room a tag is read from, and the room line prints one line per tagged wall. The building is the other half because an alley has a building on each side, and tagging one mustn't paint over the other. Until 2026-09-30 the key was the tile alone. Indoors, both halves are the room.

The unrest sim's own paint (`tagFromWorld`) takes a bare wall when a tile has one, and its teardown scrubs only the wall it painted.

**3. It comes down on its own, eventually.** A tag ages out after `TAG_LIFE_DAYS` (3) **game** days, derived from the game DATE via `gameDayIndex` (the same trick as `zone-filth.js`) rather than a counter or a tick. Stateless: no column to reset, no sweep to schedule, and a restart can't repaint the city. Expiry is **lazy** — asked on read, and it fails toward *"the tag is still there"*, because a clock hiccup silently erasing every wall in the city is much worse than one stale tag.

At the default `timeScale: 1`, three game days is three real days.

## The teeth

`clean` removes every tag on the walls around you, but **only with a real `cleaning_tool`** — bare hands do floor filth, not brickwork. That asymmetry is deliberate and it is the whole point: floor filth yields to a determined scrub because requiring a tool would mean nobody ever cleans, but if defacing a shopfront cost the owner nothing to undo it wouldn't mean anything. A storefront owner goes and buys a solvent like everybody else.

## The crime

Spraying emits `graffiti.tagged`; the surveillance plugin charges `graffiti` through the ordinary witness gate. Nothing here decides whether you got away with it. Worth knowing what 0.3★ means after the severity scaling: it floors at `sevFactor` 0.25× and it's a **one-shot** roll, so at default camera effectiveness it's a single ~2.5% chance. You will nearly always walk. That's correct — the rare bust should be a funny slap, not a tax on the one expressive thing in the game.

## Cost model

**No tick, no skill, no stat.** RAM is authoritative: every tag hydrates once on first read and is mutated in memory thereafter, so the room-description path — which runs on every `look` in the game — never queries. This plugin is the **only writer** of `zone_graffiti`, which is what makes that cache safe (CLAUDE.md's write-funnel rule). The DB write happens on the spray or the scrub, once per act, on a cold path.

## The can

`spraycan` opens a dialog in the browser. You write the words, select letters (click one, drag a run, shift-click to extend, or leave it alone to mean the whole tag), and paint them: a colour off the **shared** wheel, plus bold, italic, underline and strike, plus a rainbow fade because it's the one effect nobody wants to do letter by letter. The preview is the honest one — it renders through the same code the room line will use, on a strip of wall.

The wheel is `client/game/js/panels/color-picker.js`, lifted whole out of the hangar paint bench so there is exactly one of them. It takes its LOOK from whoever opened it (`themeFrom` copies the host's `--hb-*` tokens onto the popover, which lives on `<body>`), which is why the bench's is brass and the can's is fluorescent green with one stylesheet.

**Style is data, never markup.** This is the rule that lets per-letter colour exist at all next to the escaping rule below. The dialog sends `{t: text, r: runs}`, never a string of tags; a run is `{n, c, f}` and nothing else, `c` has to match `/^#[0-9a-f]{6}$/` or it is dropped, and `f` is masked to four bits. So the text still arrives and is stored escaped exactly as it always was, and a room description still contains no markup anybody typed. `paint.js` is the only thing that turns a run into HTML.

The trap that shapes `paint.js`: **`esc` changes the LENGTH of the string** (`<` becomes `&lt;`) but a run counts characters the PLAYER TYPED. So the renderer never indexes the escaped text — it splits it back into one unit per original character, the same trick the chat rainbow uses. Index it naively and you slice an entity in half and put a live `<` back on the wall.

**The client decides nothing.** `sprayapply` re-asks whether there's a wall there and a can in your hand, re-validates every colour, and re-measures the length. The panel is a nicer way to say a sentence the server was always going to check.

## Letterforms

A throw-up comes in four letterforms, listed as `TAG_FACES` in `client/shared/tag-strokes.js`:

- `bubble`: the hand-drawn sheet traced into `client/shared/tag-glyphs.js`.
- `round`: thick strokes with every corner smoothed off and round ends.
- `block`: square ends and cut corners, upright.
- `sharp`: thinner, leaning forward, mitred to points, with chisel-cut ends.

The last three are one skeleton alphabet (`tag-strokes.js`) stroked three ways, and it also covers the digits and the punctuation a tag uses, so no letter falls back to a system font.

The can's **Style** row picks one. `any` leaves it to the wall, which rolls the hand and the letterform off the street tile, the same way it always rolled the hand. Picking a letterform makes the tag a throw-up, because the others only exist there. Under the row is the piece as the flight window will paint it, baked by the renderer's own `tagPreview`.

The choice is stored in `zone_graffiti.face` and `player_sprays.face`. `safeFace` in `paint.js` only accepts a name off `TAG_FACES`, so a payload can't ask the renderer for anything it doesn't draw, and `wall.tags` hands it on as `f`.

Letters touch and never overlap. `tagLayout` in `windshield.js` spaces them by their outlines so the bodies stop a small gap apart at their nearest, and the bake lays every keyline before any fill, so a piece has one outline round the outside and one line between each pair. `scripts/shapes/tagspace.mjs` checks it for every letterform.

## The shelf

Designs save to `player_sprays` (cap **12**, per player) and load back onto the can. The oldest is never silently dropped — you're told the shelf is full and you pick what goes, because auto-eviction eats the one somebody meant to keep. Save and bin both answer with the **whole fresh shelf** rather than a delta, so an open panel can't drift from the table.

A saved spray stores what you typed, unescaped, because it goes back into a text field; the wall stores it escaped. Nothing off the shelf reaches a room description without going through the same `esc` on the way in.

## Player text is HTML

The text is player-authored and lands in a stranger's room description, which the client renders as HTML. It is escaped **on the way in** and stored escaped — one place to get it wrong, and no way to double-handle it. The regress suite treats `esc` as a security boundary, not a formatting detail.

## Paint

A `spray_paint`-tagged item, sold at hardware shops (*Screw It*, *Marrow Street Hardware*, ₵120 — the same counter that sells the mop and the acetone that undo it).

**A can holds 120 characters of paint, spent by the letter** (`CAN_CAPACITY`), not one tag per can. The remainder lives on the inventory row's `custom_data.paint`, which is what makes a half-used can a real object — droppable, tradeable, still half empty when it's picked up. A stack shares the row, so the remainder always describes the can in hand and the next one starts full. Spending is measured on what was TYPED, same as the length cap, and the `spraycan` dialog's counter is `min(TAG_MAX_LEN, paint)` so it stops you where the can does; `sprayapply` re-checks both anyway. A tag is refused before anything is written rather than going up half-painted.

The budget is the point of the price: at ₵120 a can and 120 characters in it, a letter costs a credit, and brevity is worth something.

## Extension points
- `items.tags.spray_paint`
- `events.graffiti.tagged`

## Files
- `index.js` — the verbs, the RAM authority, the one write path (`applyTag`)
- `paint.js` — the per-letter style model and the only thing that renders it, plus `safeFace`
- `client/game/js/panels/spraycan.js` — the dialog
- `client/game/js/panels/color-picker.js` — the shared wheel (also the hangar bench's)
- `client/shared/tag-strokes.js`: the stroke alphabet and the `TAG_FACES` list
- `client/shared/tag-glyphs.js`: the traced bubble sheet (regenerate with `scripts/tags/trace-sheet.cjs`)

## See also
[docs/systems-surveillance.md](../../docs/systems-surveillance.md) · [docs/systems-cleaning.md](../../docs/systems-cleaning.md)
