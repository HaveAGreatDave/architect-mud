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

Since 2026-08-01 the room line sits **with the room's prose** rather than up among the `[SAFE]`/district/light chips — a tag describes a thing that is in the room. That placement is `describe.js`'s. Since 2026-10-26 it only applies to a `zone.describeRoom` line with no link in it: a line that carries one (an elevator's floors, a shop's shutter, an airfield's hangar bay) prints above the prose with the room's other clickable rows. A tag line has no link, so it stays with the prose.

**2. One tag per wall, and anyone may paint over anyone.** The cap isn't a limit, it's the design. The wall is a contested slot, so the question stops being "what shall I write" and becomes "whose tag is up". It's also what makes the cap a **PRIMARY KEY** rather than a rule somebody enforces: a wall is the pair `(zone_id, target_zone_id)`, the tile you **stand in** and the building you paint, `zone_graffiti` can never hold more than one row per wall in the world, and painting over is an UPSERT. The buried author isn't notified; you find out by walking past.

The tile you stand in is half the key because that's the room a tag is read from, and the room line prints one line per tagged wall. The building is the other half because an alley has a building on each side, and tagging one mustn't paint over the other. Until 2026-09-30 the key was the tile alone. Indoors, both halves are the room.

The unrest sim's own paint (`tagFromWorld`) takes a bare wall when a tile has one, and its teardown scrubs only the wall it painted.

**3. It comes down on its own, eventually.** A tag ages out after `TAG_LIFE_DAYS` (3) **game** days, derived from the game DATE via `gameDayIndex` (the same trick as `zone-filth.js`) rather than a counter or a tick. Stateless: no column to reset, no sweep to schedule, and a restart can't repaint the city. Expiry is **lazy** — asked on read, and it fails toward *"the tag is still there"*, because a clock hiccup silently erasing every wall in the city is much worse than one stale tag.

At the default `timeScale: 1`, three game days is three real days.

## The teeth

`clean` removes every tag on the walls around you, but **only with a real `cleaning_tool`** — bare hands do floor filth, not brickwork. That asymmetry is deliberate and it is the whole point: floor filth yields to a determined scrub because requiring a tool would mean nobody ever cleans, but if defacing a shopfront cost the owner nothing to undo it wouldn't mean anything. A storefront owner goes and buys a solvent like everybody else.

## Painting over a camera
`tag camera` (or `tag <the camera's name>`, or `spraycan camera`) gives a security camera's lens a blast of paint, and the camera stops seeing. Any of *camera*, *cam*, *cctv* or *lens* in the command means a camera rather than a wall. A bare *camera* picks among the ones in plain sight; a name is matched by SIFT over those first and only then over hidden ones, so the answer never lists a hidden camera you didn't name. It costs `LENS_PAINT` (6) characters of paint off the can. A camera that's already painted says so.

A painted camera doesn't witness crimes, its feed (the SPECTER hub, a television patch, a flat's door panel) shows paint, and it records nothing. That's all the surveillance plugin's, which owns the camera rows: graffiti calls its `paintLens`, and the paint is `status_flags.painted` on the device's row, read from the device snapshot every reader already holds.

It's quick, not free. The charge is `vandalism` (1★), rolled before the paint lands, so the camera you're painting is still live for it: it gets its own 50% look at you raising the can (`LENS_CATCH`, less in bad weather or behind a Null veil), and every other camera and cop in the room gets the ordinary roll. Painting your own camera is no crime. The owner gets a `⚠ TAMPER` ping.

It comes off with `clean camera` and a tool ([cleaning](../cleaning/README.md)), by anybody. A police camera also has a city crew: four game hours after it was painted it counts as clean, and a 10-minute sweep wipes the row and tells the room. A private camera stays painted until somebody cleans it.

ROOM and GLASS don't draw the city's cameras, so there's no paint to show on a lens in 3-D.

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

## In 3-D: the spray session

With a 3-D view up (the Room Stage, or the street on foot in GLASS), **G** opens the can on the wall you're facing: in a room that's `spraycan` on the room's wall, on the street `spraycan <the way you face>`. In ROOM the can in the **Pack** does the same. It's the ordinary dialog, and the server answers as it always has (no can, no wall).

Its SPRAY IT then doesn't send at once. It starts the **spray session** (`client/game/js/panels/spray-session.js`) over the view. **First you shake the can**: drag up and down, or press the arrows or WASD back and forth (the same key twice doesn't count), ten strokes in all. Each one knocks the ball bearing against the end of the can (`spray-shake`), and every good shake (one each way) fills an arc of the ring round the can with a note up the scale; the ring runs down if you stop for long. Shaken, the can gives a squirt to clear the nozzle and goes in your hand, and the drag you were shaking with ends there, so it can't count as a stroke. Then the piece is cut into sections, one for every four letters up to six (`sectionsFor`), and each section is a pattern of two to four strokes drawn as arrows of paint, the later sections longer, some with a spin (↻ or ↺: round once, starting anywhere). Drag them with the mouse or a finger, or press them on the arrows or WASD. Nothing sits in a window: the strokes, the ring, the keys and the ghost of the piece float over the view. An arrow fills with the player's own paint as the drag goes along it and drains if the hand comes off, a done stroke drips, and the WASD keys under it light the one wanted (for a spin the light goes round them). A wrong stroke sputters and that section starts again; a right one hisses, and the last one sweeps the section on. When the piece is finished it sends the same `sprayapply` the dialog always sent. Put the lid back on (Esc) and nothing is sent or spent. The sounds are SIREN cues in `client/shared/sfx-catalog.js` (group `spray`): the rattle when the dialog opens, one clack a shake, a burst of hiss a stroke from the keys, a held hiss while the nozzle's down, a puff each quarter of a dragged stroke (`spray-trace`, brighter as it fills), a ping as a stroke lands (`spray-step`), a fifth as a section goes on (`spray-section`), the whistle when it's shaken (`spray-ready`), a sputter, a section going on, and the finish. The tonal ones are tuned to the finish's G and the session moves them up a G minor pentatonic stroke by stroke and section by section, so the piece climbs into the signature. The hisses are noise round 5 to 6 kHz fluttering on a random source, with air over it and the valve's crack on the front; a clack is a click, the tin ringing at a thin shell's partials (a `modes` layer), the can body's knock and the ball bouncing back.

**The can is 3-D** (`client/game/js/panels/spray-can-3d.js`): a small WebGL view of its own, an aerosol turned on a lathe with a few dents in it, the colour collar and the actuator with its nozzle. It sits big in the panel while you shake it, springing with the hand (`SecondOrder`), and then follows the pointer with its nozzle on the spot you're spraying. In the comic look it takes the house ink and two bands. **Its label is the item's**: the `can_label` tag on the can (see [items.md](../../docs/items.md)), sent with the can on `spray_editor`, so the Chromaflux 167 reads PRISMATIK with its prism and its hazard diamond, and another brand is a content file. A can with no label gets a plain grey one, and with no WebGL the session keeps the old flat CSS can.

**The finish is the tag signature** (`spray-done`), and it plays whenever a tag goes up, not only at the end of a session. The session builds into it: every stroke that lands is a stab on the band (a slap synth bass with a fuzz guitar two octaves over it, `spray-step`) a step further up the E major scale, each section is a band hit on the note the climb has reached (`spray-section`), and the signature is the release, one bar of hard funk at 115 bpm on the E blues scale on the same band, with kicks, a snare and sparkles. It has no `vary`, so it's the same every time. A typed `tag` and the dialog with no 3-D view get it on the server's reply (`cue: 'spray-done'` on the success output, played by dispatch.js's `output` handler), so it sounds only when the tag landed. The session plays it the moment the piece is finished and sends `sprayapply … q`, so the reply doesn't play it twice.

**The session decides nothing.** A miss costs time, not paint, and how you did is only the line at the end. The server checks the wall, the can and the paint on `sprayapply` exactly as before, so a client that skipped the session would only skip the picture.

Which view is up is `client/game/js/panels/spray-aim.js`: the Room Stage and the street view register a host while they're on screen, and `spraycan.js` asks it. With no host (the text rungs) SPRAY IT sends at once.

**In a room, the paint goes where you looked.** The Stage aims the eye's ray at the walls of the room you're in (`aimWall` in `client/game/js/panels/room-tags.js`, 3.5 m reach) and sends the spot with the payload as `s`: `{ u, v, y, n }`, metres in the Stage's frame, `n` the wall's inward normal. `safeSpot` in `paint.js` keeps it to numbers and one of four names, and `applyTag` keeps it only for a room's own wall, in `zone_graffiti.spot`. A street wall's place on the facade is GLASS's to solve, as before. The `room.tags` hook hands the room's tag to plugins/roomstage, which sends it on `room_view` as `tags` and again as `room_tags` when `graffiti.tagged` or `graffiti.removed` fires; the Stage draws it on the plaster through `setDecals` in `gl/room.js`, baked by the same `tag-bake.js` GLASS uses. During the session the piece goes on that wall section by section. A room tag sprayed from the log has no spot, and lies on the left wall.

**On the street,** the session shows the piece in its own close-up on brick, and plugins/freelook sends the window again to whoever's on foot within reach of the building when a tag goes up or comes down, so the wall has it.

## Letterforms

A throw-up comes in ten letterforms, listed as `TAG_FACES` in `client/shared/tag-strokes.js`:

- `bubble`: the hand-drawn sheet traced into `client/shared/tag-glyphs.js`.
- `round`: thick strokes with every corner smoothed off and round ends.
- `block`: square ends and cut corners, upright.
- `sharp`: thinner, leaning forward, mitred to points, with chisel-cut ends.
- `treat` (Graffiti Treat Front), `degrassi` (Degrassi Front), `spray` (Rubik Spray Paint, offered as "overspray"), `drip` (Rubik Wet Paint), `brush` (Knewave) and `lacquer` (Lacquer): a face's own letters, set at the spec's `size` and `fat`, spaced and centred on their measured ink, and inflated only by the spec's `puff` (default 0.2 of a bubble letter's), or the faces' own counters close.

The `round`, `block` and `sharp` faces are one skeleton alphabet (`tag-strokes.js`) stroked three ways, and it also covers the digits and the punctuation a tag uses, so no letter falls back to a system font. The font letterforms are `TAG_FACE_SPEC` entries with a `font` in `tag-bake.js`. The can window shows every style as a tile of the player's own words.

## Special finishes

A piece can be sprayed in a finish laid over its colours: `chrome`, `gold`, `holo`, `glow` or `neon` (`TAG_FINISHES` in `client/shared/tag-strokes.js`). The bake (`tagFinish` in `tag-bake.js`) paints it into a mask of the letters, so the keyline, the block and the cloud stay the piece's: banded metal for chrome and gold, a diagonal rainbow with glitter for holo, saturated paint with a bloom and a hot core for neon, and a pale phosphor for glow that lights up with its halo in the night bake. The room line wraps the paint in `graffiti-finish graffiti-<x>` (styles.css), and the finish rides to the walls as `x` beside `f`.

A player may use a finish if they carry a can of it or have earned it:

- **Cans** are items tagged `paint_finish` as well as `spray_paint`, and a tag in that finish spends that can's paint. Prismatik Lumen (neon) and Prismatik Nightglo (glow) are in Desmond Watts's stock beside the Chromaflux; Mirrorcoat (chrome) turns up in industrial salvage and Spectra Holo (holo) in consumer trash, rare and hard.
- **Earned** finishes come with walls: `graffiti_tags` in `player_flags` counts every tag a player puts up, and 25, 50 and 100 set `graffiti_finish_holo`, `_chrome` and `_gold`. An earned finish comes out of any can. Gold is earned only: no can of it exists.

`spray_editor` sends the finishes this player can use (`finishes`) and the cans that carry them; `sprayapply` checks again and refuses a finish the player hasn't got. `zone_graffiti.finish` and `player_sprays.finish` store it.

The other hands set their letters in self-hosted faces from `client/shared/fonts/` ([docs/reference/fonts.md](../../docs/reference/fonts.md)), fetched by `loadTagFaces` in `tag-bake.js` on the first bake:

- `hand`: Sedgwick Ave Display, Rock Salt, Rainbow 2000 or Permanent Marker, rolled on the words, so one name is in one hand on every wall.
- `stencil`: Big Shoulders Stencil, Operation Napalm or Allerta Stencil, rolled the same way. These faces bring their own bridges, so the bake's random ones are only drawn over the system fallback.
- `roller`: Bowlby One SC.
- The scrawls round a throw-up and on a buff: Sedgwick Ave.
- `gothic`: UnifrakturMaguntia, loaded with the sign faces.

A tag baked before the faces arrive is baked in the system fallback, and the tag cache is emptied when they land, so every wall re-bakes in its real hand.

The can's **Style** row picks one. `any` leaves it to the wall, which rolls the hand and the letterform off the street tile, the same way it always rolled the hand. Picking a letterform makes the tag a throw-up, because the others only exist there. Under the row is the piece as the flight window will paint it, baked by the renderer's own `tagPreview`.

The choice is stored in `zone_graffiti.face` and `player_sprays.face`. `safeFace` in `paint.js` only accepts a name off `TAG_FACES`, so a payload can't ask the renderer for anything it doesn't draw, and `wall.tags` hands it on as `f`.

Letters touch and never overlap. `tagLayout` in `windshield.js` spaces them by their outlines so the bodies stop a small gap apart at their nearest, and the bake lays every keyline before any fill, so a piece has one outline round the outside and one line between each pair. `scripts/shapes/tagspace.mjs` checks it for every letterform.

## The shelf

Designs save to `player_sprays` (cap **12**, per player) and load back onto the can. The oldest is never silently dropped — you're told the shelf is full and you pick what goes, because auto-eviction eats the one somebody meant to keep. Save and bin both answer with the **whole fresh shelf** rather than a delta, so an open panel can't drift from the table.

A saved spray stores what you typed, unescaped, because it goes back into a text field; the wall stores it escaped. Nothing off the shelf reaches a room description without going through the same `esc` on the way in.

## Player text is HTML

The text is player-authored and lands in a stranger's room description, which the client renders as HTML. It is escaped **on the way in** and stored escaped — one place to get it wrong, and no way to double-handle it. The regress suite treats `esc` as a security boundary, not a formatting detail.

## Paint

A `spray_paint`-tagged item, sold at hardware shops (*Screw It*, *Nuts to That*, ₵120 — the same counter that sells the mop and the acetone that undo it).

**A can holds 120 characters of paint, spent by the letter** (`CAN_CAPACITY`), not one tag per can. The remainder lives on the inventory row's `custom_data.paint`, which is what makes a half-used can a real object — droppable, tradeable, still half empty when it's picked up. A stack shares the row, so the remainder always describes the can in hand and the next one starts full. Spending is measured on what was TYPED, same as the length cap, and the `spraycan` dialog's counter is `min(TAG_MAX_LEN, paint)` so it stops you where the can does; `sprayapply` re-checks both anyway. A tag is refused before anything is written rather than going up half-painted.

The budget is the point of the price: at ₵120 a can and 120 characters in it, a letter costs a credit, and brevity is worth something.

## Extension points
- `items.tags.spray_paint`
- `events.graffiti.tagged`
- `events.graffiti.removed` (`{ zoneId, targetZoneId? }`, from `removeTag` and `removeTagsAt`): ROOM and the street view repaint
- `hooks.wall.tags`, `hooks.room.tags`
- surveillance's `camerasHere`, `paintLens` and `cleanLens`: the camera half, imported when asked for

## Files
- `index.js` — the verbs, the RAM authority, the one write path (`applyTag`)
- `paint.js` — the per-letter style model and the only thing that renders it, plus `safeFace`
- `client/game/js/panels/spraycan.js` — the dialog
- `client/game/js/panels/spray-session.js` (and `.css`): the spray session over a 3-D view; `spray-aim.js`, which view is up
- `client/game/js/panels/room-tags.js`: where ROOM aims the can, and a room's tags as quads on its walls
- `client/game/js/panels/color-picker.js` — the shared wheel (also the hangar bench's)
- `client/shared/tag-strokes.js`: the stroke alphabet and the `TAG_FACES` list
- `client/shared/tag-glyphs.js`: the traced bubble sheet (regenerate with `scripts/tags/trace-sheet.cjs`)

## See also
[docs/systems-surveillance.md](../../docs/systems-surveillance.md) · [docs/systems-cleaning.md](../../docs/systems-cleaning.md)
