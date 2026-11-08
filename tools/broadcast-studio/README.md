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
- **A graphic** is a row in `GFX` in sequence.js and a function in `DRAW` in [sequence-gfx.js](../../client/game/js/panels/sequence-gfx.js), with its styles in the sibling `.css`. The inspector builds its form from the row.
- **A piece** is a row in `SET_PIECES` in [gl/set-mesh.js](../../client/game/js/panels/gl/set-mesh.js). The set editor offers it from there.
- **A fact** is a line in [sports/facts.js](../../plugins/broadcast/sports/facts.js), and it's in the Tokens list from then on.
- **A kind of show** is a row in `SHOW_KINDS` in sequence.js: its moments, its usual roles, the tokens its broadcast fills (the sample a new entry starts with) and the `Stage for` word its sets take. The Show tab's **Kind of show** picks it, and the slots' **When** offers only its moments. Sports calls `open`, `break` and `close`; the talk show calls `open` (in place of the greeting at the desk) and `close` (before the sign-off); news calls `open` in place of the anchor's intro, with the lead story's `{headline}` and a `stories` list, and `close` in place of the outro; the morning show calls `open` in place of its cold open and `close` in place of its sign-off. Weather and game shows have no moments yet, so they only play behind the 3D button.
- **A cast member the world doesn't hold**, such as a news anchor who's only a name in the script, is cast as a token: `{anchor}`. The Cast menu offers the kind's `castTokens`; the name comes from the broadcast's data and nobody's schedule changes. Only a sports show's cast is kept at work while a slate is on.
- **A new moment** is a place in the broadcast's assembler that calls `deskSegment` with it, and a row in its kind's `moments`, in the same change. The gate fails a slot at a moment its kind never calls.

A regular script becomes a sequence with **From a script…** in the rail: each spoken line a beat on the last `CAM` line's shot, each speaker a role on the set's next mark.

## Files

**Export** writes one `.broadcast.json` holding what's open and what it needs: a show takes its sequences and their sets. **Import** reads one back, and asks before replacing anything. **Save** writes to `content/`. Nothing reaches the game until it's pushed.

## Putting a show on air

Turn on **On air** on the show's entry, save and push. Its segments then play at their moments as part of the broadcast, in 3-D on the visual rung and as text on the others. Deadball and Cluster Puck are on air.

A show with no entry still plays in 3-D behind the TV's **3D** button, on the set the server picks for it. Give a set a **Stage for** list (`talkshow`, `news`, `default`) or the **room it is**, and the shows of that kind, or staged in that room, play on it.

The check is `node scripts/shapes/sequence.mjs`, which is in the push gate.
