# Vehicle comic: the figures' ink on the aircraft, the rigs, the boats and the pod racer

> **Status: V1 and V2 built (2026-11-03), V5 built (2026-11-07); V3, V4 and V6 are design.** See
> [V1, as built](#v1-as-built), [V2, as built](#v2-as-built) and [V5, as built](#v5-as-built). The
> preview concepts are a live page in Dave's artifacts, "Vehicle Comic Ink".

## Why

[comic-ink.md](comic-ink.md) put the whole game in one comic look, but the vehicles only got the
city's half of it (its Coverage table): two bands, their own grey shade side, and
the city's screen-pass outline, which a phone doesn't draw. The ballplayers and the skaters have
the weighted line, inked kits, a painted shade colour and hatching. Next to a ballplayer an aircraft
reads as a city building with wings. The cockpits, where a pilot or a driver spends the most time,
have no cel look at all.

This doc covers every vehicle `drawAircraftModel` draws (the `fw`, `truck`, `boat` and `mesh`
kinds in [vehicle-model-schema.js](../../client/shared/vehicle-model-schema.js)), the pod racer,
and every seat interior.

## How vehicles are drawn today

- **The outside** is a face soup built on the CPU by aircraft3d.js from a row of numbers or a
  `mesh` file. Each face has a `role` (wing, fin, nacelle, gear...) and a baked shade `sh`. GLASS 2
  draws it in [gl/solids.js](../../client/game/js/panels/gl/solids.js). The own ship is its own layer
  in its own frame (`mp`, `uploadShip`), lit per pixel (`uLmL`). Every other vehicle's light is
  baked on the CPU into `rv` each frame.
- **There are no textures on the outside.** A livery is a colour picked per face by its pattern
  (`stripe`, `pinstripe`, `tiger`... in aircraft3d.js), plus decals drawn on a canvas
  (`decalTex`) and wrapped onto the hull as a grid of cells. So the kits' trick, painting ink into
  an atlas, has nowhere to go.
- **The cel look** reaches vehicles through `bindToonInk` ([gl/toon.js](../../client/game/js/panels/gl/toon.js)).
  The own ship bands its sun term; the rest swap the smooth shade ramp for a banded one. The
  outline is the city's, from the shared depth prepass.
- **The cockpit** is the same layer with `CABIN` defined, lit per pixel by `cabinShade` in the
  cab's own frame. `drawInterior` clears depth first and binds no toon and no ink, so the cel
  switch never reaches it.

## The look

The same five layers as the figures, translated to things made of panels:

1. **A weighted silhouette.** About 2.5 px of a 900-wide picture, swelling to `HOUSE.weigh` (1.7)
   on the side away from the sun.
2. **Panel lines.** Ink where the hull creases (two faces meeting at more than about 35°) and where
   one part meets another (a wing root, a fin on the spine, a door on a cab). Half the
   silhouette's width. This is the rule from comic-ink.md, "lines between garments, never inside
   one": a part is a garment.
3. **Inked livery.** A hairline where one paint meets another (the stripe on the trailer, the
   tiger's edges), an ink outline round every decal, and a quarter-strength grime toward the belly
   and the wheel arches.
4. **Two tones, painted.** `HOUSE.shade`, the warm violet, in place of `TOON_SHADE`'s grey. A
   hard white glint on canopy glass and chrome. Hatching on faces deep in shadow, laid in the
   face's own plane, so it rides the hull.
5. **Comic cockpits.** The cabin's key light banded and its shade painted, and panel lines on the
   dash, the frame and the consoles.

### Where ink never goes

- **Lettering, gauge faces and displays.** The Drake is the bar
  ([cockpit-lettering.md](../reference/cockpit-lettering.md)): every label stays exactly as
  legible as it is now. A face carrying a legend, a gauge or a lit display takes no band, no line
  and no hatching.
- **Glass you look through** (`vTex` 10). It gets the glint and nothing else.
- **Anything moving fast or glowing**: the pod racer's plumes and its binder arc, a spinning rotor
  or prop disc, the exhaust heat. These stay soft; a line on a blur reads as a solid object.
- **Thin parts at range.** A gear strut or a minigun barrel a few pixels wide gets its silhouette
  only, or it comes out solid black, as the balcony rails did in the city
  ([glass-notes.md](../reference/glass-notes.md#the-cel-look-render_tunegltoon-glink), Traps).

## How

### One edge list per mesh

The silhouette and the panel lines come from one edge list, built once per mesh from the face
soup: each edge with its two faces' normals, and a kind.

- **Crease**: the two normals differ by more than the threshold.
- **Part**: the two faces have different roles.
- **Paint**: same role, same plane, different livery colour.
- **Silhouette**: decided per frame in the vertex shader. One face looks at the eye and the other
  doesn't. An open edge (one face) is always a silhouette.

Each edge is drawn as a screen-space quad, widened in the vertex shader in pixels, the way
[gl/ink.js](../../client/game/js/panels/gl/ink.js) widens its hull, and tested against depth with a
small bias toward the eye so the face under it doesn't swallow it. This is the classic GPU
silhouette-edge method; an inverted hull doesn't work on a flat-shaded soup, because its faces
split apart at every crease.

- **The own ship** is static in its own frame, so its list is built once per class and drawn under
  the ship's model matrix.
- **Every other vehicle** is rebuilt on the CPU each frame (`wv`). The topology is cached per class
  and only the positions are refreshed, and only for vehicles near enough to show a line (the
  vehicle's screen height over about 40 px). Far ones keep the city's outline as now.
- **The cockpit** is static in the cab's frame, so its list is built once per seat.

### The rest

- **Painted shade and glint** go in solids.js's existing toon branch, read from
  [gl/house-style.js](../../client/game/js/panels/gl/house-style.js) as the figures read
  `figureLightOf`. Off and plain 'on' must hand back today's numbers exactly.
- **Inked decals** are drawn in the decal's own canvas painter (`decalTex`), so they cost nothing
  per frame. The texture is drawn twice and cached by its id plus the look.
- **Grime** is a CPU colour pick in `finishCoat`, read off face height, so it lands in `rv`
  (other vehicles) and in the own ship's upload alike.
- **Hatching** uses `celInk`'s stroke from [gl/cel-figure.js](../../client/game/js/panels/gl/cel-figure.js),
  laid along a point in the vehicle's own frame: `vLocal` in the cab, and for the own ship its
  `aPos` before `uModel`, passed on as a new varying. Other vehicles' points are world points
  rebuilt each frame, so their hatching would swim; they get none.
- **The cockpit** gets `bindToonInk` on the interior draw and a banded branch in `cabinShade`
  that skips anything with lettering, a gauge or emissive light (`vCA`'s emissive term over a
  floor). The edge list is drawn after the room and before the glass.

## Order of work

| Phase | What | Where | Risk |
|---|---|---|---|
| V1 | Painted shade and glint on every vehicle | solids.js toon branch, house-style.js | Low. Shader branch, off is off |
| V2 | Edge list: weighted silhouette, creases, part lines on the own ship | new gl/vehicle-ink.js, aircraft3d.js | Medium. Z-fighting, thin parts |
| V3 | The edge list on other vehicles near the eye | solids.js upload | Medium. CPU cost in traffic |
| V4 | Inked livery: paint lines, decal outlines, grime, hatching | aircraft3d.js decal painter and `finishCoat` | Low |
| V5 | Comic cockpits | solids.js CABIN branch, context.js `drawInterior` | High. Legibility |
| V6 | The hangar turntable and the depot bays on the 2-D painter | hangar.js, depot shell | Low. A stroke per edge |

V1 alone closes much of the gap with the figures and is the smallest change. V5 is the one Dave would
notice most, and the riskiest, because every cockpit has to keep the Drake bar.

## V1, as built

With Settings → Cel Shading → Comic, every vehicle outside takes the figures' comic light in
[gl/solids.js](../../client/game/js/panels/gl/solids.js), from `vehicleLightOf` in
[gl/house-style.js](../../client/game/js/panels/gl/house-style.js).

- **Two tones.** `comicStep` and `comicShadeK` from
  [gl/comic-light.js](../../client/game/js/panels/gl/comic-light.js), so the terminator sits where a
  figure's does, a little past side-on, with the shadow's core and bounce.
- **The own ship** (`uLmOn`): the lit side at the shade floor plus 0.9 of the sun's share
  (`COMIC.lit`), the shadow at the floor, tinted toward `HOUSE.shade` by `COMIC.tint` times the sun's
  strength. No sun, no tint, so a night hull doesn't turn violet.
- **Every other vehicle**: the baked colour divided by the shade ramp, as 'on' already did, then put
  back in the same two tones, with the tint times `uSunK`.
- **The glint.** The sun's highlight on a metal, a coat or a pane goes through a fixed hard edge
  (0.16 to 0.2), so it's a white shape with nothing round it. A fixed edge rather than `fwidth`,
  because that branch is per face.
- **Off and 'on' draw as before.** `uVComic` is bound on every draw and is 1 only with the toon
  switch on, so the cabin and the mirror pass get 0. `scripts/shapes/house-style.mjs` checks the
  bind and that both of the old lights are still there.
- **Seen:** the Modelshop's `__street` with `seat: 'air'`, external, at 17:00. A hard terminator
  runs along the fuselage, with a lavender-grey shade under it. On white paint under a high sun
  the change is small, because most of the hull is lit. Not looked at on a phone.

## V2, as built

The own ship's lines are [gl/vehicle-ink.js](../../client/game/js/panels/gl/vehicle-ink.js): a pure
edge-list builder (`buildEdges`) and a GL layer that context.js uploads in `uploadShip` and draws in
`drawSolids` straight after the ship, only with the comic look and the toon switch on.

- **The records.** windshield.js now puts `src`, the mesh's own face, on every own-ship GL record
  beside its local points (`mp`). The part line keys on `src.part` (an authored mesh's part id) and
  falls back to `src.role` for the builder classes.
- **Built once per set of faces.** The list is rebuilt only when the faces change (another class,
  the gear stowing): 3 to 26 ms, the Drake's 4,816 faces the most. A record that moved (a hinged
  surface) or faded rewrites only its own edges and its neighbours', in spans, as solids.js does
  for the cabin.
- **The widths** are `vehicleInkOf` in house-style.js: the outline at the city's 2.5 px of a
  900-wide picture, held to a pixel at least, up to 1.7 times on the side away from the sun; the
  creases, part lines and seams at half that.
- **⚠ The lines write depth.** The floor and the sea are drawn after the solids (world.js), so a line
  that wrote none was painted over wherever it stood off the hull: the whole outside half of every
  silhouette went, and only the panel lines were left. That was the first build.
- **Gate:** `scripts/shapes/vehicle-ink.mjs` (in the shapes group) checks the classifier on known
  shapes (a cube is twelve creases, a door is one part line, a lone sheet is four seams, a strut is
  thin, glass and the cabin take nothing), and that every id in `VEHICLE_IDS` builds a sane list at
  both details.
- **Seen:** the Modelshop's `__street` with `seat: 'air'`, external, against 'on' at the same view:
  the wing, the nacelles and the fuselage take a black outline and the nacelles and tail their panel
  lines. On the hauler's near-black paint the lines are there but hard to see.
- **Short panel lines are dropped.** A crease, part line or seam shorter on screen than four of its
  own widths (`VINK.minLen`) isn't drawn. Without it the Drake went nearly black a few lengths off,
  every line a few pixels long and piled on the next; it's the city's rule that a feature a few
  taps across gets no line. The outline keeps every edge, or a curve's silhouette would break up.
- **The Drake** (the Modelshop's GLASS 2 view, against 'on'): close up, the head, the bill, the
  belly and the outline read well. The ruff is the busiest part, every quill outlined, and it reads
  as feather hatching. Further off, with the rule above, the shapes still read and the ruff is the
  darkest part. Its mesh has 5,352 open edges of 10,190, most of them in the ruff and the armour.
- **The pod racer** (the pod's mesh): a clean outline, part lines on the rails and the trim, and the
  V1 terminator across the body. Nothing busy. Its turbines weren't in the frame.
- **Not yet looked at:** a phone.

## V5, as built

With Comic on, every cockpit takes the look in the CABIN branch of
[gl/solids.js](../../client/game/js/panels/gl/solids.js), and its lines from
[gl/vehicle-ink.js](../../client/game/js/panels/gl/vehicle-ink.js) in cabin mode.

- **Only faces with a material.** A face whose texture kind is 0 (lettering, a gauge face, a lamp, a
  display) takes no band, no wear, no hatching and no line, and neither does glass. That's the
  whole legibility rule, so the Drake bar holds without a list of exceptions.
- **Bands.** The light a face gets against its own colour is rounded to a band every 0.8 of a stop,
  with an edge about a pixel wide, after the floods and the sun patches. Bands under the room's
  plain light are painted toward `HOUSE.shade`. Metals keep their own ramp and glint.
- **Hatching** in the bands under the plain light, about 14 mm apart in the face's own plane,
  crossed in the deepest band, lighter at night, gone before it's finer than a pixel.
- **Wear, by aircraft.** `CABIN_WEAR` in [gl/house-style.js](../../client/game/js/panels/gl/house-style.js)
  gives each class its grime, chips, hatching, grain and dirt colour: the Drake nearly clean, the
  Reaper chipped grey enamel and soot, the Locust chemical crust, a boat dried salt, the wreck rust
  everywhere. A 2076 airframe gets a third of the grime and a quarter of the chips. Grime is
  hard-edged, with a darker line where it stops, and heavier low in the room; chips are flakes with
  an ink rim; cloth, leather and carpet wear lighter instead. The photographic grain is cut to the
  class's `grain` share, because it fights a painted surface.
- **Lines.** The cabin's records go through `buildEdges` with their material (texture kind) as the
  part and every normal turned toward the eye, so only creases and changes of material draw. Never
  the colour: the Drake's veneer is walnut bands laid as strips, and keyed on colour every band
  took an ink line. Open edges and silhouettes don't draw either, because a cockpit lays its trim
  on as flat strips. The Drake also takes almost no wear.
- **Wood is painted its own way** (`cabWood`): its photographic grain goes, and it takes two or three
  flat tones in broad bands, a few long wavy strokes in a darker shade of its own colour (never
  ink), and the odd knot.
  All at `cabinInkOf`'s width, 1.2 px of a 900-wide picture (held to a pixel), under the seat's
  attitude (`seatAtt`, copied into the ink shader). Drawn after the room and before the glass.
- **Seen** with the Modelshop's `seatShot` at 11:00: the Reaper, the Drake, the Grasshopper and the
  wreck; and the Leviathan at 21:00 with the panel and dome lights on. Every gauge and label reads
  as before. Not looked at: a phone, the boats, the trucks, the pod racer.

## Per tier

| Layer | Full | Laptop | Phone |
|---|---|---|---|
| Painted shade, glint | yes | yes | yes |
| Own ship's edges | yes | yes | yes. No prepass, so cheap (unmeasured) |
| Traffic's edges | yes | near only | no |
| Inked livery | yes | yes | yes |
| Hatching (own ship and cab only) | yes | yes | no |
| Comic cockpit | yes | yes | bands only |

The phone has no city outline at all, so on a phone the own ship's edge list is its only line. It
should be cheap (a few thousand quads, no extra pass), but that's to be measured with `__glPassMs`
before it's on.

## Gates

- `scripts/shapes/house-style.mjs` grows the vehicle helpers: off and 'on' hand back today's
  numbers.
- A new gate in `shapes:smoke` builds the edge list for every id in `VEHICLE_IDS` and every seat:
  no NaN, every edge has a kind, and a sane count per class. It's the same coverage the shape smoke
  gives buildings: it proves the lists build, not that the lines look right.
- `cockpit-lettering`'s gate must stay green with the comic cockpit on; any label the ink touches
  is a fail.
- The Modelshop's `seatShot` and `__street` shots before and after, at noon and at night, for the
  Drake, the Warthog, the hauler, the hydro and the pod racer.

## Open questions

1. How heavy should cockpit ink be? The preview uses a thinner line inside (about 1.2 px) because
   the dash is close and busy.
2. Do traffic vehicles get panel lines, or only the silhouette? Lines on every truck in a jam may
   be too busy.
3. Does wear (durability) drive the grime, so a beaten truck looks beaten? That ties the look to
   [systems-durability.md](../systems-durability.md) and would need the condition on the contact.
