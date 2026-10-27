# Broadcast 3-D: shows and films on a set

**Status: design only.** Nothing here is built. Phase 1 is St Garneau's basement kitchen and
*Cooking Shit With Neil McManistan*; phase 2 is a soundstage set on KSAB's stage. Section 9 lists
the decisions that need answering before phase 1 starts.

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

Cel-shaded, with simple comical faces in the style of *South Park*, and mouths that move to the
sound of the voice.

- **Cel shading** on everything in the frame: the set, the props, the people, and the city through
  a window. Light falls in a few hard bands, shadows have hard edges, and every shape has an ink
  outline.
- **Faces** are flat and cartoonish: two big white eyes with dot pupils, brows as single strokes, and
  a mouth picked from a small chart of shapes. There's no realistic skin, nose or lip detail. The
  bodies are still the skinned 3-D figures, shaded in bands.
- **Lip sync** comes from the audio as it plays (section 6). Whatever is heard moves the mouth,
  including ORACLE's voice, the garbler's fumbles and pauses, and a sampled clip.
- **The broadcast grade goes over the top**, so it reads as a cartoon on an old TV.

This look is for shows and films. The Grandstand and the rink keep their own.

A cartoon also lowers the cost of the riskiest parts. A prop needs a clean silhouette and flat
colour instead of a material, and a face with six mouth shapes and a few eyelid positions can't
fall into the uncanny valley.

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

A layout is a few kilobytes of JSON. Zones load into RAM at boot, so a layout shouldn't ride on the
zone row: every boot would read thousands of layouts that only a viewer of a 3-D show ever uses.
The proposal is its own table, `room_layouts` (`zone_id` primary key, `layout` JSONB), one file per
room under `content/room_layouts/`, fetched by the client the first time it shows that room and
cached by the browser after that. Section 9 asks whether this is the right place.

### Sets (phase 2)

A set is a layout with `kind: "set"`, standing on a stage zone. It has flats instead of walls, no
ceiling, one open side facing the cameras, and a backing (a painted cloth, or the cyclorama). A
script names one with `@set <id>`. A set is the stage's, so moving the show to another stage
means building or copying the set there.

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

### Faces

The head is a simple rounded shape, and the face is drawn flat onto its front from a few parts: the
eyes (white, a dot pupil, an upper lid that can drop), two brow strokes, and the mouth. A character's
face is their head shape, skin and hair colours, eye spacing and a few extras (glasses, stubble, a
moustache). By default it comes from a seed on the NPC id, and an author can set it on the NPC. The
street figures take their faces from an anonymous token so nobody can be identified from a street
away, but a show's cast are named on air, so a face tied to the NPC is fine here.

The eyes and brows show the impairment state the census carries. `drunk` and `loose` get half-shut
lids, `wired` wide eyes and pinned pupils, `paranoid` eyes that dart between cameras, `tripping`
huge pupils, and `out` closed eyes. It's one row per `_DELIVERY` state, and the same gate that
requires a tangent voice for each state should require a face.

### Lip sync from the sound

An `AnalyserNode` taps the TV voice bus and is read once a frame:

- **How open the mouth is** comes from the signal's level, smoothed with a fast attack and a slower
  release so it doesn't chatter.
- **The mouth's shape** comes from where the energy is in the spectrum. Most of it above about 4 kHz
  gives teeth (s, sh, f, ch). Low energy with a low centroid gives round (o, oo, w). Strong energy
  in the second-formant range gives wide (ee). Otherwise the shape is open, at the size the level
  says. Silence gives closed. A loud onset straight after silence shows a closed frame first, so m,
  b and p read.
- **Whose mouth moves** comes from the payload. The `tv` speech channel plays one line at a time,
  so it only carries the current line's speaker. The `scene` channel (the Grandstand's voices) plays
  on the same bus, so if both ever sound at once the analyser hears both. That can't happen inside
  this view, but a gate should check it stays that way.

The chart is about six mouths: closed, small, open, wide, round and teeth. The thresholds are
tuned against ORACLE in the Voice Lab, and that tuning is most of the work.

Because it listens to the output, ORACLE doesn't change. A garbled line lip-syncs correctly as it's
garbled: a stall closes the mouth and a repeated word moves it twice. A player with TV speech
switched off hears nothing, so for them the mouth flaps from the text instead, timed by the
existing `Speech.estimate()` and `Speech.phonemesFor()`.

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

## 9. Decisions to make

Each has a recommendation. These need answers before phase 1 starts, because each one changes what
phase 1 builds.

**1. Is 3-D only the TV picture, or can a viewer walk the set?**

- *TV picture only (recommended).* You see what the cameras see. Real sets get away with this:
  only what a lens frames has to hold up, so the prop and layout work is bounded by camera coverage,
  and the look stays cinematic.
- *A free camera on the set.* Every corner has to hold up from every angle, which roughly doubles
  the prop and layout work and turns the picture into a level viewer.

**2. Who builds sets?**

- *Authored sets only, through content (recommended for phases 1 and 2).* Sets go through git and
  CODEX like every other piece of content.
- *Players build sets in the phase 3 studio.* That's the full *The Movies* loop, and it needs
  moderation, a size limit, and a storage plan that fits the Neon egress budget
  ([ops-usage-watch.md](../ops-usage-watch.md)). It can be decided at phase 3 as long as the set
  format in phase 2 doesn't assume an author.

**3. Which rooms get layouts?**

- *Only rooms that go on air (recommended).* The scope is the shows, and grows one location at a
  time.
- *Every room, eventually.* That's a world-modelling project (17,690 zones) that broadcasts would
  only be one use of, and it should get its own proposal before anything here assumes it.

**4. Where do layouts live?**

- *Their own table and content directory, fetched by the client on demand (recommended).* Nothing
  is added to boot, and a layout is read only by someone watching.
- *A key on the zone's `flags`.* Simpler, but it puts every layout into the boot read and the
  world Maps.

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
