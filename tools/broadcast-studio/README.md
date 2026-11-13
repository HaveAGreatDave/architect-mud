# The Broadcast Studio

`npm run broadcast-studio`, then <http://localhost:5190/>. The dev panel links to it under BSM Studio. It's the tool for a show's script and its 3-D sequences. The design and what's still to come are in [docs/proposals/broadcast-3d.md](../../docs/proposals/broadcast-3d.md).

It's a local tool like the Studio and the Modelshop. It binds 127.0.0.1, serves the client's own modules so the preview is what ships, and writes to `content/media_graphics/`. Restart it after adding an NPC.

## The tabs

- **Show.** An entry: the broadcast it airs as, its cast, which sequence plays at each slot, the sample data, and the On air switch. Deadball and Cluster Puck each have one, and The Tonight Show has one that isn't attached to a broadcast yet.
- **Sequence.** The monitor, the storyboard under it and the inspector. Each card is a beat. Click one to edit its camera, framing, move, line, graphics and what's on the set's screen. Space plays from the current beat with ORACLE voicing the lines.
- **Set.** A plan you drag marks, cameras and pieces round, with the monitor looking through the chosen camera. Pick a piece, a mark or a camera to edit it.
- **Script.** BSM Studio.

## The three documents

Each is one `media_graphics` row, with `type` set to the kind and the JSON as `content`, so the content pipeline carries them and there's no new table. [client/shared/sequence.js](../../client/shared/sequence.js) defines them.

- A **set** is a room: its size, pieces, marks and cameras.
- A **sequence** is a set, its roles and its beats. A beat is one shot. A spoken beat lasts as long as its line, so it's a shot list and there's no timeline in seconds to keep in step.
- A **show** is a broadcast's entry.

Text in a line or a graphic takes `{tokens}` from the data. `{a.name}` is role `a`, `{speaker.name}` is whoever has the line, and everything else is what the broadcast sends. A beat can hold several lines and the broadcast picks one. A line with a token the data can't fill is never picked, and a beat left with no line drops out, so a missing fact loses a beat and never airs a hole.

## Templates and skins

A set can be built on another. A **template** (`template: true`, shown as ◇ in the rail) is a room for a kind of show, and its swappable pieces carry a `part` name. A **skin** names its template in `base` and holds only what it changes. `resolveSet` in sequence.js lays one over the other, and the game, the Studio and the gate all draw the result.

- `brand` is `{ name, colour }`. A piece's text reads it as `{brand.name}`, so a template's sign, desk front or lectern shows whatever network the skin names.
- `palette` and `brand` merge key by key over the template's.
- `parts` changes a piece by its part name: fields laid over it, a different `type` to swap it for another piece, or `null` to take it out.
- `pieces` are added after the template's. `marks` and `cameras` merge by name, and `null` takes one out.
- Room, lamps, focus and ambient come from the template unless the skin has its own.
- `picture: 'mono'` shoots the set in black and white (the Colours panel's checkbox): a CSS filter on the stage's canvas, so it costs the renderer nothing, and a copy of the frame for a TV in a room (page-paint.js) takes it too. Standing in a set that's a room (`zone`), you see it in colour. A skin inherits it, and `picture: 'colour'` on a skin turns it off.
- `zone` makes a set a room players can walk into: standing there, the Room Stage shows the set ([Studio sets are rooms](../../docs/systems-broadcast.md#studio-sets-are-rooms)). Neil's basement is KSAB-TV's Sound Stage B.
- `broadcasts` lists the broadcast ids a skin was made for. It beats the room and the kind, so a show gets its own skin wherever it's staged. A template is never staged as itself, and `uses` and `broadcasts` are never inherited.

The templates: talk show, news desk, morning couch, weather wall, game show (a host's lectern and three lettered podiums), product pitch (a counter and a lit plinth, for adverts and shopping shows), pulpit, kitchen, sitcom living room, and booth. Every studio show that has a broadcast row has a skin. Films and the ride-along don't, because they aren't studio shows.

**The Quiet Hour** (`set_quiet_hour`) is a transmitter's control room in the dark, a set of its own, shot in black and white after The Outer Limits. The Control Voice sits at the console with the Horizontal and the Vertical standing either side of it, each on a mark kept `for` them. Its pieces are in [gl/set-control.js](../../client/game/js/panels/gl/set-control.js): `starfield` (a night sky with a galaxy in it), `oscilloscope`, `tape_deck`, `control_desk` and `signal_rings`.

**A title card fills the picture.** When a script's `TITLE` airs while a show is on its set, the card (an SVG or ASCII graphic) covers the 3-D picture. The line straight after it is read over it if nobody on the set says it, which is how a `SHOT` that describes the card is heard. The next line takes the card down, and from then on the set's video wall shows a still of it that rolls now and then (`card` in tv-stage.js, `liveCard` in sequence-player.js). A set with a bank of screens keeps its own pictures.

**The backlot** is where a film is staged. It's 19 stock sets (`set_film_*`, `backlot: true`), one for each kind of place our films go: an office, a corridor, a stairwell, a bar, a shop, a street at night, an alley, a flat, a rich man's lounge, a kitchen, a works floor, a workshop, a brick tunnel, a civic hall, a yard, a pool deck, the same pool drained, open ground, and grand steps. [build-film-sets.mjs](../../scripts/content/build-film-sets.mjs) writes them, so edit that, not the JSON. Their pieces are in [gl/set-film.js](../../client/game/js/panels/gl/set-film.js). Each set's `scenes` is a list of words with weights. When a film's `SLUG` line airs, `sceneSetFor` in the plugin scores every backlot set against it and the 3-D stage moves to the best one. Words before the pipe count double, and a tie goes to the word further along the place, so a SLUG naming the Prine house and then its kitchen is the kitchen. A SLUG that names nothing keeps the set it's on. A film with a set of its own (Slagball's arena, the Ashway hall) stays on it unless that set has `scenes` too. Before its first SLUG a film is on the street, the only set whose `uses` has `film`. `node scripts/content/build-film-sets.mjs --table` prints the set every SLUG in every film gets; run it after adding a film or changing a weight.

**The booth** (`tpl_booth`) is a presenter in front of a bank of screens (`screen_bank`): a big main screen, a tall one either side, a ticker under the main one and the brand along the top, with an anchor desk on a riser to one side. Each screen shows what the show asks, in `screens` on the set, the sequence or a beat (`{ main, left, right, ticker, header }`), from `title`, `logo`, `weather` (a forecaster's map of the Basin), `temps`, `clock`, `brand` and `ticker`; `ticker` on the set or sequence is the crawl, with tokens. [gl/screen-bank.js](../../client/game/js/panels/gl/screen-bank.js) paints them. Raptor News and DOOMCAST are skins of it, and so is the KSAB5 Booth, its own room east of KSAB5's studio. Where two sets do claim one room, `roomDefault` on one makes it the room's set between shows.

**The Tonight Show** (`set_tonight`) is a set of its own, not a skin, and the most dressed one: its pieces live in [gl/set-tonight.js](../../client/game/js/panels/gl/set-tonight.js), which set-mesh.js spreads into `SET_PIECES`. `cw_skyline` is Coldwater at night as a painted backdrop in layers at their own depths (sky, the Curtain, the far shore, the city, the waterfront, the Basin with the lights broken on it), meant to stand behind a `picture_window` (a panelled wall with a window, or a plain panelled wall at width 0). The rest are `stage_deck` (chevron parquet), `tonight_desk` (lettered, with a mug, cards and a mic), `exec_chair`, `chesterfield`, `wing_chair`, `side_table`, `stage_curtain`, `floor_sunburst`, `floor_star`, `bandstand`, `drum_kit`, `keyboard`, `amp`, `mic_stand`, `truss_grid`, `studio_cam`, `potted_palm`, `arc_lamp` and `bulb_sign`. A piece that stands on a deck takes `lift`, and so does its mark.

In the Set tab, **New skin of…** in the rail starts one. Pick a template piece on the plan to change it: **This part is a** swaps it, ✕ takes it out, **Back to the template's** undoes it, and what you drag or type lands in the skin's `parts`. A template's piece with no part name is fixed. **Light it differently** copies the template's lamps into the skin.

The lit pieces (`sign`, the desks' front lettering, `lectern`, `podium`, `counter`) draw their words in the legend face's strokes (`client/shared/legend-font.js`), so any capital, digit, `-` or `/` reads. Other characters are left as a gap.

## The data

A sports show previews a real simulated game. The **data** menu picks the moment and 🎲 plays a different game, so you see what a line says on a bad night as well as a good one. A beat the game leaves out goes grey on the storyboard. The Tokens list is what the feed knows at that moment. Any other show fills tokens from the sample data on its entry.

- **Only if…** on a beat, a graphic or a slot takes conditions on the data, such as `margin` at least 3, `overtime` is true or `hatTrick` exists. They all have to pass.
- **Slots can share a moment.** The first one whose conditions pass plays, so put special cases above the usual one with ▲ and ▼.
- **A table** picks a list under *One row for each* and writes each row as `left: right`, with the row's own fields as tokens: `{player}: {period} {clock}`. The set's screen takes a list the same way.
- **A profile** picks a person under *Who, from the data*, and takes everything else from them.
- **Counts in lines:** use the `...Said` facts, such as `{fightsSaid}`, which says "one fight" or "3 fights".
- **`{live.watching}`**, `{live.weather}`, `{live.tempC}` and `{live.hour}` are what's true as a segment airs. They work in graphics. A game's lines are written before it airs.

## Adding to it

- **A framing, a move or a cut** is a row in `FRAMES`, `MOVES` or `CUTS` in sequence.js. A move also needs its case in `shotCamera`.
- **News graphics**: the headline strap, the story card over the anchor's shoulder and the network bug each take a `colour`, the network's accent, so one show is red and the next blue.
- **A graphic** is a row in `GFX` in sequence.js and a function in `DRAW` in [sequence-gfx.js](../../client/game/js/panels/sequence-gfx.js), with its styles in the sibling `.css`. The inspector builds its form from the row.
- **A piece** is a row in `SET_PIECES` in [gl/set-mesh.js](../../client/game/js/panels/gl/set-mesh.js). The set editor offers it from there.
- **A fact** is a line in [sports/facts.js](../../plugins/broadcast/sports/facts.js), and it's in the Tokens list from then on.
- **A kind of show** is a row in `SHOW_KINDS` in sequence.js: its moments, its usual roles, the tokens its broadcast fills (the sample a new entry starts with) and the `Stage for` word its sets take. The Show tab's **Kind of show** picks it, and the slots' **When** offers only its moments. Sports calls `open`, `break` and `close`; the talk show calls `open` (in place of the greeting at the desk) and `close` (before the sign-off); news calls `open` in place of the anchor's intro, with the lead story's `{headline}` and a `stories` list, `story` in place of each feature story's lead-in (with `{headline}`, `{body}`, `{byline}`, `{n}`, `lead` on the first, and `turn`, `a` or `b`, for whose story it is), and `close` in place of the outro; the morning show calls `open` in place of its cold open and `close` in place of its sign-off. Weather and game shows have no moments yet, so they only play behind the 3D button.
- **A cast member the world doesn't hold**, such as a news anchor who's only a name in the script, is cast as a token: `{anchor}`. The Cast menu offers the kind's `castTokens`; the name comes from the broadcast's data and nobody's schedule changes. Only a sports show's cast is kept at work while a slate is on.
- **A new moment** is a place in the broadcast's assembler that calls `deskSegment` with it, and a row in its kind's `moments`, in the same change. The gate fails a slot at a moment its kind never calls.

A regular script becomes a sequence with **From a script…** in the rail: each spoken line a beat on the last `CAM` line's shot, each speaker a role on the set's next mark.

## Files

**Export** writes one `.broadcast.json` holding what's open and what it needs: a show takes its sequences and their sets. **Import** reads one back, and asks before replacing anything. **Save** writes to `content/`. Nothing reaches the game until it's pushed.

## Putting a show on air

Turn on **On air** on the show's entry, save and push. Its segments then play at their moments as part of the broadcast, in 3-D on the visual rung and as text on the others. Deadball and Cluster Puck are on air.

A show with no entry still plays in 3-D behind the TV's **3D** button, on the set the server picks for it (`stageSet` in plugins/broadcast/sequences.js): a skin that lists the broadcast, then a set that is the **room it is**, then one whose **Stage for** list (`talkshow`, `news`, `default`) has its kind, then the default.

The check is `node scripts/shapes/sequence.mjs`, which is in the push gate.
