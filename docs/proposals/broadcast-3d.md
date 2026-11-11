# Broadcast 3-D: shows and films on a set

**Status: the first version is built and on air: the KSAB5 sports desk inside both games, a 3-D button on the TV for every text show, the sequence format and the Broadcast Studio (section 0). Phases 1 to 3 are design.** Since this was written the Room Stage, the comic look and lip sync shipped, so sections 1, 3, 5 and 6 note where they replaced what's here.

## 0. The first version (as built)

Two people at KSAB5's desk open every game, take the break and close it. The same parts make any show: nothing below knows a sport.

- **The format** is [client/shared/sequence.js](../../client/shared/sequence.js): a **set**, a **sequence** of beats on it, and a **show** that says which sequence plays at which moment of a broadcast. Each is a `media_graphics` row, so there's no new table and they're in the boot cache. A beat is one shot, and a spoken beat lasts as long as its line, so a sequence is a shot list and can't fall out of step with the voice.
- **The picture** is [sequence-player.js](../../client/game/js/panels/sequence-player.js) on `gl/room.js`, so a set is lit and inked as a flat is, and the people are the close-up figure. [gl/set-mesh.js](../../client/game/js/panels/gl/set-mesh.js) builds a set from the room kit. [sequence-gfx.js](../../client/game/js/panels/sequence-gfx.js) draws lower thirds, over-the-shoulder boxes, pictures in pictures, player profiles, score panels, tables, cards and a ticker over it. A box or a picture in picture shows the live game, the set's screen or another camera.
- **The facts** are [sports/facts.js](../../plugins/broadcast/sports/facts.js). `factsAt(sport, game, at)` walks the game's own beats up to a moment and returns everything known there: the score, the margin, the status, shots, hits, penalties, fights, injuries, goals or home runs with who and when, stars of the game, who's missing, the table, and each man's number, colour and season. A break can't mention anything that hasn't happened, and it can't disagree with the booth, because it reads what the booth reads. A new fact is a line in the sport's section.
- **Conditions** make a show change with the game. A beat, a graphic or a slot can carry `if`, conditions on the facts. A beat that fails is left out, and several slots can share a moment, the first that passes playing, so Cluster Puck has a blowout intermission above its usual one. A line with a token the facts can't fill is never picked.
- **Lists and people.** A table runs over a list in the data (`goals`, `stars`, `table`), and the set's wall can show one. A profile points at a person (`lastGoal`, `gameStar`, `hatTrick`, `star`), and takes their number, club colour, season and tonight's line from there.
- **At air time** `_sportsOnAir` adds `live` to the first line's data: viewers, weather, temperature and the hour. A game's lines are written when it's assembled, so `{live.watching}` works in graphics and not in lines.
- **The tool** is the Broadcast Studio ([README](../../tools/broadcast-studio/README.md)), on its own port and linked from the dev panel. It holds BSM Studio on its Script tab, and Deadball and Cluster Puck each have an entry in it. Files export and import.
- **On air**, a broadcast calls `deskSegment` ([plugins/broadcast/sequences.js](../../plugins/broadcast/sequences.js)) at a moment (`open`, `break`, `close`) with that moment's facts. The lines air as ordinary booth lines, each carrying a `desk` overlay. The first takes the documents with it, about 10 KB. The desk's lines come off their own seed, so no line of the booth's moves, and regress holds that.
- **The moments.** Cluster Puck's break is each intermission, first thing, and its lines run straight through with the pacer's silence left to the booth. Deadball's is the seventh-inning stretch, before the bottom of the seventh.
- **The cast** are [Joan Dempsey](../../content/npcs/npc_joan_dempsey.json) and [Lou Ferraro](../../content/npcs/npc_lou_ferraro.json). They work real shifts: `_sportsOnAir` holds a segment's lines back unless everybody cast is standing on the set's `zone`. KSAB5 has a game in every slot, so anyone cast in a live show is on shift while any slate has a game on, which is round the clock but for Cup day. They share Kestrel Court 11B, two tiles from the stage.
- **The TV** is [tv-desk.js](../../client/game/js/panels/tv-desk.js), over the sub-screen, with the game running under it. A desk segment is part of the broadcast: on the visual rung it comes up by itself at its moment and goes again after its last line, and on the other rungs, or with no WebGL2, its lines air as text. Both leagues' entries are on air. An entry's **On air** switch decides whether its lines air at all.
- **Text shows** get a **3D** button on the TV and the tablet's TV ([tv-stage.js](../../client/game/js/panels/tv-stage.js)), shown for any programme that isn't a game. It asks the server for the stage once a programme (`tv_stage`, `stageFor` in the plugin): the set from the show's entry, else the set built for the room it's staged in (`zone`), else one whose `uses` names its kind of show, else the `default` one, and the people in it, being the programme's cast and anybody standing on its stage now. Every line the TV shows is then a cut, chosen by `autoShot` in sequence.js: the speaker from the camera that faces them, a two-shot every third exchange in a back-and-forth, the whole set for the announcer, a lower third the first time somebody speaks. Somebody with no seat left is heard over the wide shot. The choice stays on for the next show (`tv.stage` in the browser's storage).
- **Films** are staged on the backlot: 19 stock sets, and each `SLUG` line moves the stage to the one its words name (`sceneSetFor`). A film's speakers take the marks as strangers in the order they speak. See [the backlot](../../tools/broadcast-studio/README.md).

Not done yet: a location show such as *Cooking Shit With Neil* has no set of its own, so it plays on the default talk set until somebody builds the kitchen. A highlight reel in a box (the comic replays exist, and nothing plays them here), a facts feed for anything but the two sports, and anchors have no seated talking clips, so they sit in their idle poses with their mouths moving, and a player or a live impairment isn't in the picture, since the desk plays its sequence and has no census (section 5). The profile's photo is the card camera's and needs that league's renderer, so the first one is slow.

## 1. The idea

The TV gets a 3-D picture. A show or film plays on a set you can see: the room, the cast standing in
it, and the cut from one camera to the next. The text still airs underneath, and it's still what
the game treats as having happened.

The model is Lionhead's *The Movies* (2005): you wrote a script, picked a set off the backlot, cast
actors, and the game shot the film. THOMAS already has most of the parts:

- **The script** is a `.bsm` file ([bsm-format.md](../bsm-format.md)).
- **The script editor** is [BSM Studio](../../client/game/bsm-studio.html). A graphical stage editor
  inside it is phase 3.
- **The renderer** is the Grandstand's: Deadball's park in 3-D
  ([systems-broadcast.md](../systems-broadcast.md), "The park in 3-D").
- **The staging** already happens in real rooms. A live or acted show is performed by NPCs standing
  on a floor in front of numbered cameras ([systems-broadcast.md](../systems-broadcast.md), "Live
  Realism"). The 3-D view shows that floor and adds no staging of its own.

The missing part is the backlot. No room in the game has a shape.

### The look

**Replaced 2026-11-07.** This section asked for flat *South Park* faces. On 2026-11-01 the whole game went comic ([comic-ink.md](comic-ink.md)), so a set is drawn in the house look and its people are the close-up figure ([hd-figure.md](hd-figure.md)) with its inked faces. The broadcast grade over the top is still to do. The Grandstand and the rink keep their own renderers.

## 2. What it builds on

| Part | Where | What it gives this |
|---|---|---|
| HDR, SSAO, spotlight shadows | [gl/ballpark.js](../../client/game/js/panels/gl/ballpark.js), [gl/hdr.js](../../client/game/js/panels/gl/hdr.js), [gl/ssao.js](../../client/game/js/panels/gl/ssao.js), [gl/spotshadow.js](../../client/game/js/panels/gl/spotshadow.js) | The lighting pipeline. The cel look replaces its GGX shading with bands |
| The cel look | `RENDER_TUNE.glToon` and `glInk` ([glass-notes.md](../reference/glass-notes.md), "The cel look") | Banded light with hard-edged shadow and occlusion, and ink lines found from depth differences (Saito and Takahashi) in `gl/ssao.js`'s depth prepass. In GLASS it covers the city's buildings only; this view uses it on everything |
| The broadcast lens and grade | [gl/broadcast.js](../../client/game/js/panels/gl/broadcast.js) | Per-shot depth of field, and the `broadcast` grade (lifted blacks, soft colour, CCD smear, tube glass), applied over the cel image |
| Skinned people | [actor3d.js](../../client/game/js/panels/actor3d.js), [gl/actors.js](../../client/game/js/panels/gl/actors.js) | A 19-bone body with clips baked into textures. The street figure's realistic head and face atlas ([actor-head.js](../../client/game/js/panels/actor-head.js), [actor-faces.js](../../client/game/js/panels/actor-faces.js)) aren't used; this view has its own cartoon head |
| The TV voice bus | `busFor('tv_voice')` in [audio-engine.js](../../client/shared/audio-engine.js) | The audio node an analyser taps for lip sync |
| A rig with IK and a clip library | [diamond/rig.js](../../client/game/js/panels/diamond/rig.js), [gl/skin.js](../../client/game/js/panels/gl/skin.js), `content/animation_clips/`, the Modelshop's Pose Lab | Where the indoor clips get keyed |
| A view with a fallback | [gameday-grandstand.js](../../client/game/js/panels/gameday-grandstand.js) | The pattern: lazy-loaded, the same five methods as the 2-D view (`apply`, `clear`, `setCaption`, `showIdle`, `showCard`), and a hand-over to 2-D when WebGL2 can't draw |
| Cameras that are objects | `media_cameras` rows, camcorders, camera droids | Every cut is executed by a numbered unit standing in a room, and `direction` is already a column |
| Room presence and impairment | `tickBroadcastGraph`, `_actorImpairment`, the tangent runner | Who is on the floor and what state they're in, already worked out on the server every tick |
| The city | GLASS | What a window looks out on |

## 3. What's missing: rooms have no shape

`zone_stgarneau_basement` is a paragraph of prose, two exits, `floor: tile` and a parent tile. It
has no size, walls, doors in walls or windows. Its two camcorders and its deck are furniture rows
with a zone and no position. All 17,690 zone files are like that.

So each room that goes on air needs a **layout**:

- **Shell:** a floor polygon in metres, ceiling height, and the floor, wall and ceiling materials.
- **Openings:** each door and window, which wall it's in, its offset, width, height and sill. A door
  names the exit it is.
- **Fixtures:** light sources with a type and output, switched by the zone's power.
- **Placements:** furniture by id (so the deck that's really in the room is the one drawn), plus
  set dressing that exists only in the picture (pans, the taped notes on the cupboards).
- **Marks:** named spots: `counter`, `stove`, `pan`, `pantry door`, `kitchen door`.
- **Camera positions:** each `media_cameras` id with a position and height. The existing `direction`
  column gives its default heading.

Marks matter because scripts already name them. Neil's show has `CAM 1 WIDE on the kitchen counter`,
`CAM 3 FOLLOW to the pantry door` and `CAM 1 SNAP_TIGHT on the pan`. A camera label's "on the X" or
"to the X" resolves to a mark, or to an actor when X is somebody's name.

Furniture rows don't change. Placement lives in the layout, keyed by furniture id, so nothing new
goes through the furniture funnel in world.js. A placed piece that's no longer in the room (the deck
somebody carried out) isn't drawn.

### The room has to agree with its building

A layout is realistic only if it fits the outside. The footprint has to fit inside the shape the
building records through `SHAPE_SINK` ([building-shapes.md](../reference/building-shapes.md)), a
window has to be a window on the GLASS facade, and the floor has to sit at the right storey. Phase 1
dodges most of this, because a basement has no windows. A gate that checks a layout against its
building's recorded shape belongs in phase 1 anyway, so the rule exists before the first window.

## 4. Rules

1. **The text is what happened; 3-D is a view of it.** Every payload is the one the text TV gets.
   When the 3-D view can't draw, it hands over to text with the last payload, as the Grandstand
   does.
2. **The server says who and what; the client decides where.** Positions come from marks and a
   seed. The server never tracks where in a room somebody is standing, and nothing on the hot path
   gets a query.
3. **One authoring format.** Shows are `.bsm` files. The graphical studio in phase 3 writes `.bsm`,
   and it uses the vendored `compileBsm` like the rest of BSM Studio.
4. **Every existing script plays.** A script with no new directives gets inferred coverage (section
   6). New directives are for writers who want more control.
5. **No `setRoom()` for a broadcast.** The viewer's room is the room you hear
   ([systems-deadball-sound.md](../systems-deadball-sound.md)). The set's acoustic is baked into the
   voices it sends: a short set of early reflections sized from the layout's volume.

## 5. Data

### Layouts

**Replaced.** The Room Stage shipped a room spec (`flags.room`), `roomLayout` and pieces with spots ([room-stage.md](room-stage.md)), so a real room's shape comes from there and `room_layouts` isn't needed. A real room needs marks and camera positions on top of that, which a set document already has. A sequence on a real room should be a set whose shell comes from the zone's room spec.

### Sets

**Built**, in a wider form than this asked for: a set document is a shell, pieces from `SET_PIECES`, marks and cameras. It can stand for a real stage (`zone`) or for flats on one. A script naming a set with `@set` is still to do.

### Props

A kit of prop models keyed by `object_type`, with variants, built like the building arms: affine
geometry in metres, one file per family, and a Node gate that runs every prop against the DOM stub
the way [shapes/smoke.mjs](../../scripts/shapes/smoke.mjs) runs every building. The clone facility
is the quality bar ([building-styles.md](../reference/building-styles.md)). This is the largest
single pile of work in the whole project, and phase 1 deliberately needs only a kitchen's worth.

### The stage census

A viewer across town has never seen the room, so the payload has to say who and what is in it. For
an acted show, each tick's payload to a viewer with the 3-D view open gets a census of the stage:
the NPCs present with their impairment state and level, any players present with their appearance,
and the placed furniture ids still in the room. It's built from the world Maps the tick already
reads (`getZoneFurniture`, the zone's occupants), so it costs no queries. It goes only to viewers
who've opened the 3-D view.

A recording (a `film` or `scripted` show that isn't acted) has no room to census. It draws its cast
from the script's `npc_anchor` nodes, on the set the script names.

## 6. Direction

### Camera labels

`CAM` lines already carry a small shot vocabulary. Across the 19 scripts that use them there are 82
labels; `WIDE` (28), `CLOSEUP` (18) and `MEDIUM` (15) are 61 of them, and the rest are moves like
`SNAP_TIGHT`, `PAN`, `FOLLOW`, `HANDHELD`, `PULL_BACK` and `TRACKING`. Each one becomes a framing
rule (a shot size and a subject) solved from the camera's position, plus a move over the cut. The
compiler already keeps the label on the `camera_cut` node, so this is client work.

### Inferred coverage

Between a script's own cuts, a director chooses shots the way a vision mixer would: the speaker on a
change of speaker, a two-shot for back-and-forth, wide on `ENTER` and `ACTION`, and a cutaway when a
tangent's co-host steps in. It can only cut to cameras that are working and in the room, using the
same rule the server already applies. A script that numbers its cameras keeps them.

### Blocking and clips

Actors start on marks. `ENTER` walks somebody in through the door the layout names. An `ACTION`
line is free prose ("stirs the pot", "slams the freezer"), so it goes through a verb table to a clip,
with a talking gesture for anything the table doesn't know. That table is the weakest part of the
design and needs a gate that lists every `ACTION` verb in the shipped scripts that has no clip.

The indoor clips phase 1 needs: stand, stand at a counter, turn to camera, talk with gestures, stir,
chop, pour, open a door, walk in and out, sit, and, for impairment, sway, steady yourself on the
counter and fold. A slurring anchor who stands perfectly still would look worse than no 3-D at all.

### Faces and lip sync

**Replaced.** [lip-sync.js](../../client/shared/lip-sync.js) drives the close-up figure's mouth from ORACLE's own timing: `speak()` fills `opt.trace` with each phoneme, and the mouth follows the pauses and stretches. It's more exact than reading the sound would be, so the analyser planned here wasn't built. In the Studio the mouth takes the trace directly. On the TV, tv.js passes it to the desk as the line is spoken, and with the sound off the mouth reads the letters at speaking pace.

An impairment state on the face is still to do, and needs the census.

## 7. Light, sound and the world outside

- **Fixtures** are real lights, banded like the rest of the cel lighting. A few take hard-edged
  spotlight shadows through `spotshadow.js`, the rest light the room without shadows. A power outage turns them off, through the building outage wire
  GLASS already has ([glass-notes.md](../reference/glass-notes.md), "Building power outages"). A
  live show in a blacked-out room is a dark picture, then tech difficulties.
- **Windows** (phase 2 and after) show GLASS's city from that building's tile and storey, at the
  current hour and weather, and daylight comes in through them. The city in a window always draws
  with `glToon` and `glInk` on, whatever the player's Cel Shading setting, so it matches the room.
- **The grade** is per channel. A network studio gets `broadcast`; a show going out from a church
  basement can look like it.
- **The room's own events** (a player walking into shot, a heckle, something breaking) already go
  out on air through the studio-floor relay. In 3-D, a player in the census is drawn standing
  wherever they came in.

## 8. Phases

### Phase 1: St Garneau's basement kitchen

The show is *Cooking Shit With Neil McManistan*, Tuesdays at 11:00 on KSAB
(`stgarneau-tue-1100`). It's acted, shot on location (`@location zone_stgarneau_basement`), and it
has everything this system needs to prove in one room: two camcorders, two camera droids on the call
sheet, eleven `CAM` cuts including a `FOLLOW` and three `SNAP_TIGHT`s, a host whose impairment
changes his delivery and starts tangents, a producer who wrangles him, and a deck that can be carried
out of the room.

Build:

- the `room_layouts` table, its content directory and import, and the layout for
  `zone_stgarneau_basement`, with marks for every place the script's camera labels name;
- the kitchen's prop kit: steel counters, the six-burner range, the chest freezer, the deep sink,
  shelving, strip lights (one dead), pans, and the taped notes;
- a 3-D TV view (`stage-3d.js`, with `gl/stage.js`) on the Grandstand's pipeline and interface, with
  the text fallback, drawn in the cel look: banded light, hard shadows and ink lines on everything;
- the stage census on the payload;
- the label parser, the inferred-coverage director, marks and blocking;
- the phase 1 clips, keyed in the Pose Lab;
- the cartoon head and face parts, faces for Neil, Phil, Father Jerome and the droids' camera eyes,
  and a face row for every `_DELIVERY` state;
- lip sync from the TV voice bus, the six-mouth chart tuned in the Voice Lab, and the text-timed
  flap for players with TV speech off;
- the baked early reflections for the kitchen;
- gates: props and layout run under the DOM stub; a layout lint (every opening's exit exists, every
  placed furniture id and camera id exists, every mark a script's labels name resolves, the
  footprint fits the building); and the `ACTION` verb table check.

Done when the Tuesday show airs in 3-D from where the cameras stand, and all of these show up in
the picture without anything new in the script:

- Neil not turning up gives an empty kitchen and then the stand-by card;
- Neil impaired sways, grips the counter, goes heavy-lidded and loses the thread on camera;
- every mouth moves with its own voice, including through a garbled line's stalls and repeats;
- `CAM 3 FOLLOW to the pantry door` shows a droid walking there and the shot it takes;
- a player who walks in is in the shot;
- the deck carried out gives tech difficulties, the same as the text;
- a browser without WebGL2 gets the text TV.

### Phase 2: a soundstage set

The stage is KSAB-TV Studio Stage (`zone_studio_1782953094650`). Its prose already describes a
cyclorama "behind it can be any skyline in the world", and the [Media Lot](media-lot.md)'s phase
3 is the lot's insides. Phase 2 builds:

- the stage itself as a real room: the lighting grid, the cyclorama, the cameras' home positions,
  the anchor desk;
- sets: the `kind: "set"` layout, flats and backings, and `@set` in the compiler, BSM Studio's
  vendored copy and the importer;
- one recorded show on a set, cast from its script with no census. *Chrome & Circumstance* or
  *Neighbors from 14B* are the candidates;
- the first window onto the city. The cyclorama can show the live GLASS skyline from the lot, at
  the current hour and weather, behind the anchor desk.

### Phase 3 and later

Named here so the first two phases don't close them off; none of them are planned yet.

- **The graphical BSM Studio:** a top-down stage where you drag marks and cameras, preview the
  cuts, and assemble a set from the kit. It writes `.bsm`.
- More real rooms, as shows go on location in them.
- Player-built sets, depending on the answer in section 9.

## 9. Decisions

Answered 2026-11-07, for the first version.

- **Look:** the house comic figure.
- **Who's at the desk:** real shifts, with their schedules set so they're always available, and a home nearby.
- **How far:** the tool, with the TV behind a flag.
- **Where the editor lives:** a new Broadcast Studio on its own port, opened from the dev panel, taking in BSM Studio. Files export and import, and Deadball and Cluster Puck have their own entries.
- **It has to make shows in general:** so the format knows no sport, and a linear `.bsm` reads into a sequence.

Still open, for later phases:

**Can a viewer walk the set?** The recommendation stands: TV picture only.

**Who builds sets?** Authored sets for now. Player-built sets need moderation, a size limit and a storage plan that fits the Neon egress budget ([ops-usage-watch.md](../ops-usage-watch.md)).

**Which rooms get a set?** Only rooms that go on air.

## 10. Risks

- **Props.** Breadth is the cost. A kitchen is fine; ten locations is a quarter of building work.
- **`ACTION` prose to clips.** Free prose won't map cleanly. The verb table and its gate keep the
  failures visible.
- **Lip sync thresholds.** Reading mouth shapes from the spectrum is approximate. It needs tuning
  against every ORACLE voice and both accents, and a high or breathy voice may need its own
  thresholds.
- **The grade over a cartoon.** CCD smear and tube glass are tuned for a lit image. They may soften
  the ink lines more than they should, so the grade may need a cel variant.
- **Phones.** The Grandstand has a governor with rungs; this view needs the same, and a room with
  three spotlight shadows needs measuring on a phone before phase 1 is called done.
- **The census payload.** It's small and goes only to viewers with the view open, but it's sent
  every tick of an acted show. Measure it against the egress budget in phase 1.
