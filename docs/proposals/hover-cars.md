# Hover cars: three more starter mini VTOLs

**Status: built (2026-11-22). The class, the Castellan Wraith, the Brakk Wolverine and the Vex Hornet
each have a mesh, a type row, four liveries, flight and road rows, a voice, a maker and a cockpit,
with HOVER, LOCK, BOOST and PIT working for any car in the class. The setup menu and the underglow
are still the Merlin's alone. The dealership on Marrow Street that sells them is a separate build.**

The Merlin is a class of one. This adds three more cars to the class, each from its own maker, so a
new player has four to pick from at the dealership on Marrow Street. They are starting cars: a
little different from each other, and none better than another.

## The class

Every hover car is the Merlin's kind of machine:

- two seats side by side, 4 to 5 m long;
- four ducted fans where the wheels would be, a pusher in the tail, three feet with mag-lock pucks;
- flight, transition and road, with HOVER, LOCK, BOOST and PIT on the same keys (K, L, Space, U);
- an aircraft row, so hangars, liveries, fuel and repair work with no new tables;
- the same price, 18,000, and the same hire, 240 an hour.

The class is listed once, in `client/shared/hover-cars.js`. Code that used to ask "is this the
Merlin" asks "is this a hover car" there, and reads the car's own flight row, road row, pusher and
length from its entry. A fifth car is a row in that file plus its own files.

## The makers

A maker sets the cabin's colours, its finish and the colour of its light line
([systems-flight.md](../systems-flight.md#cockpit-makers-and-stick-rules)). Red, amber and green are
warnings in every seat, so no maker's line is one of them. Corvane's is violet, Harcourt's warm
white, Lumen's blue and Ostler's yellow-green; the three below are teal, arc white and magenta.

### Castellan Coachbuilders

Castellan built bodies for other firms' running gear: limousines, hearses, two state cars. It bought
its fans from Corvane and its motors from whoever was cheapest that year. The works is on the east
side and still takes orders by post. Every order is countersigned "R. Castellan" in the same blue ink.
The foreman has worked there since he was sixteen and hasn't met him.

- **House look:** tan hide, dark green carpet, a wood dash, brass switchgear. Satin finish, nothing
  lacquered.
- **Light line:** sea teal, `[84, 226, 208]`.
- **Badge:** a tower on a shield, on the nose and the wheel boss.

### Brakk Motor Works

Brakk makes lift fans for freight: the units under a rig's trailer and on the dock cranes. The
Wolverine began as four freight fans a night shift welded into a frame to see if it would fly. It did.
Brakk sells it with the weld seams showing and charges nothing extra for them.

- **House look:** black vinyl, bare steel, body-colour metal on the dash. The steel is brushed and
  everything else is matte.
- **Light line:** arc white, `[214, 232, 255]`, the blue-white of a welding arc.
- **Badge:** a block-cut B in a bolted octagon, cut through by a stencil line, on the grille and the wheel boss.

### Vex Motors

Vex made delivery pods and mobility carts for Halcyon Assurance, which insures most of them. The
Hornet is the delivery pod with windows, a second seat and a licence to fly. Halcyon lists it in the
lowest premium band of anything with fans.

- **House look:** pale grey cloth with a check, cream plastic, one bright colour picked up from the
  paint. Soft sheen, wipe-clean.
- **Light line:** magenta, `[255, 110, 214]`.
- **Badge:** a V in a circle, on the nose and the wheel pad.

## The cars

| | Corvane Merlin | Castellan Wraith | Brakk Wolverine | Vex Hornet |
| --- | --- | --- | --- | --- |
| id and class | `merlin` | `wraith` | `wolverine` | `hornet` |
| Kind | wedge supercar | long-nosed grand tourer | blunt muscle car | upright city car |
| Length | 4.6 m | 4.9 m | 4.7 m | 4.0 m |
| Doors | gull wing, hinged on the roof rail | long doors hinged at the front | scissor doors that lift on the front edge | coach doors hinged at the back |
| Control | cut yoke with a hub screen | three-spoke wood-rim wheel | deep-dish steel wheel and a floor lever | squared wheel round one big dial |
| Liveries | Rosso, Nero, Giallo, Bianco | Racing, Claret, Ivory, Midnight | Orange, Black, Primer, Plum | Mint, Custard, Coral, Slate |

**Castellan Wraith.** The cab sits two thirds of the way back behind a long bonnet with a power bulge
and two rows of louvres. Round lamps under glass covers, a low oval mouth, a fastback roof that runs
down to a cut-off tail with two round lamps a side. The front fans sit well forward, so there's
more bonnet than car behind them. No wing. Modelled on the Jaguar E-Type's proportions.

**Brakk Wolverine.** Square and wide, with a high waist and a short strip of glass. A flat bonnet
with a scoop through it, a full-width grille with four lamps set into it, a flat tail with one
light bar from side to side, and a lip spoiler. The fans are the biggest in the class and their
housings stand proud of the body. Two stripes run nose to tail in the trim colour. Modelled on the
1970 Dodge Challenger.

**Vex Hornet.** One box, 4 m long and taller than the others, with the windscreen starting almost
at the nose and glass most of the way round. Two round lamps, a flat hatch at the back with upright
tail lamps, small fans tucked into the corners. Modelled on the 1959 Mini and the Honda e.

Each has a mesh written by `scripts/shapes/concepts/<id>.mjs` into
`content/vehicle_models/mesh_<id>.json`, with its body stated once in `client/shared/cabin-<id>.js`,
and its own cockpit in `client/shared/interior-<id>.js`.

## Balance

Eight numbers a player can feel. The Merlin's are the baseline and don't change.

| | Merlin | Wraith | Wolverine | Hornet |
| --- | --- | --- | --- | --- |
| Cruise (kt) | 175 | **186** | 172 | 162 |
| Roll (deg/s) | **62** | 56 | 58 | 61 |
| Yaw (deg/s) | 80 | 76 | 74 | **88** |
| Climb (ft/min) | 3000 | 3000 | 3150 | **3200** |
| Road pull-away (kt/s) | 18 | 17 | **19.8** | 18.5 |
| Road top speed (kt) | 120 | **128** | 120 | 110 |
| Endurance (charge over burn) | 563 | **619** | 514 | 587 |
| Hull | 12 | 12 | **13** | 11 |

What each leads on, and what it gives up for it:

- **Merlin:** the quickest roll. It has the second shortest endurance and nothing else of its own.
- **Wraith:** the fastest across country and the longest legs. It's the slowest to roll and the
  slowest off the line.
- **Wolverine:** the hardest launch, the toughest hull, and a BOOST that adds a little more (90%
  against the Merlin's 85%). It has the shortest endurance and the slowest yaw.
- **Hornet:** it turns in the least room, in the air and on the road (104 deg/s of steering against
  the Merlin's 95), and climbs best. It's the slowest in both modes and has the thinnest hull.

Everything else is the same on all four: price, hire, seats, charge type, ceiling, BOOST's heat
and cool times, PIT's 16 kt, ride height, and the pad rules. Cargo is 15, 16, 15 and 14.

### How it's checked

`scripts/hover-cars.mjs` is the class's gate. It reads the eight numbers out of the flight rows and
the type rows (it doesn't keep its own copy) and fails if:

- any number is more than 10% from the Merlin's;
- any car is at least as good as another on all eight (that car would dominate);
- any car leads the class on no number, or trails it on none;
- the eight percentages against the Merlin add up to more than 4 points either way for any car, so
  no car is a little better at everything.

It then flies each car through the Merlin's own mode checks: HOVER down and up, the road row, BOOST
to the cut-out, PIT, and LOCK onto a car park pad. `scripts/merlin-modes.mjs` stays as it was.

## What's built

| Piece | Where |
| --- | --- |
| The class: one list of hover cars, and what differs between them | `client/shared/hover-cars.js` |
| HOVER, LOCK, BOOST and PIT for any car on its own rows | `client/game/js/panels/merlin-modes.js` (`newMerlinState(cls)`), gated by `scripts/hover-cars.mjs`; the Merlin's own gate is unchanged |
| The class in the seat, the renderer and the server: doors, yaw jets, the pusher, the boost flame, the wash over water, the road scrape, stepping out on foot | `cockpit.js`, `windshield.js`, `plugins/flight/index.js`, each asking `isHoverCar` |
| A body as a surface, shared by a car's exterior and its cockpit | `client/shared/cabin-hovercar.js` |
| The exterior machinery every car has: fans, jets, feet, doors on four kinds of hinge, the glass frame | `scripts/shapes/concepts/hovercar-lib.mjs` |
| The room every cockpit is built in, off the car's own body | `client/shared/interior-hovercar-kit.js`, gated per car by `scripts/shapes/cockpit-hovercar-lib.mjs` |
| The Castellan Wraith | `cabin-wraith.js`, `scripts/shapes/concepts/wraith.mjs`, `mesh_wraith.json`, `ac_wraith.json`, four liveries, `wraith` and `wraith_road` in `flight-model.js`, `wraith` in `engine-audio.js`, `castellan` in `interior-brands.js`, `interior-wraith.js`, `scripts/shapes/cockpit-wraith.mjs` |
| The Brakk Wolverine | `cabin-wolverine.js`, `scripts/shapes/concepts/wolverine.mjs`, `mesh_wolverine.json`, `ac_wolverine.json`, four liveries, `wolverine` and `wolverine_road` in `flight-model.js`, `wolverine` in `engine-audio.js`, `brakk` in `interior-brands.js`, `interior-wolverine.js`, `scripts/shapes/cockpit-wolverine.mjs` |
| The Vex Hornet | `cabin-hornet.js`, `scripts/shapes/concepts/hornet.mjs`, `mesh_hornet.json`, `ac_hornet.json`, four liveries, `hornet` and `hornet_road` in `flight-model.js`, `hornet` in `engine-audio.js`, `vex` in `interior-brands.js`, `interior-hornet.js`, `scripts/shapes/cockpit-hornet.mjs` |
| The three emblems, drawn once for the car, the cockpit and any sign | `client/shared/hover-car-emblems.js` (`HOVER_EMBLEMS`) |
| What a dealer stocks by | `data.segment: "hover_car"` and `data.maker` on each of the four type rows, the Merlin's included; `scripts/hover-cars.mjs` fails a hover car without them |

The Merlin keeps its own older files (`cabin-merlin.js`, `merlin.mjs`, `interior-merlin.js`): the
shared ones were written from them and it wasn't ported back.

**The Wraith's cockpit.** A walnut board under a hide roll, two big dials (KNOTS and FEET) either
side of three warning lamps, small dials for CHARGE, FANS and LIFT round the chart, four brass
toggles (START, LIGHTS, PANEL, CABIN), four ringed push buttons (HOVER, LOCK, BOOST with its heat
arc, PIT), a HUD knob, a wood-rimmed wheel on three drilled spokes and two brass stalks behind it
that step the lift. Fluted tan seats, green carpet, a glovebox with the car's name on it.

**The Wolverine's cockpit.** A flat steel dash with a painted top rail, a ribbon speedometer the
width of the wheel, a height counter, bars for CHG and LIFT, three warning lamps, a tachometer for
the fans on a pod on top of the dash, four rockers (START, LIGHTS, PANEL, CABIN), four square push
buttons in a block (HOVER, LOCK, BOOST with its heat bar, PIT), a HUD knob, and a deep-dish steel
wheel. The lift is a pistol-grip lever in a slotted plate on the tunnel, marked OFF and MAX: you
drag it. High-backed vinyl buckets with harnesses, a roll hoop and an extinguisher behind them.

**The Hornet's cockpit.** An open rubber-floored tray right across under the screen, with one big
dial on a pod in the middle of the car turned to the driver: speed on a needle, height as a number,
charge and lift as arcs up either side, the fans as a number, and what the car is doing. Under the
tray's lip, eight piano keys: START, LIGHTS, PANEL, CABIN in cream, then HOVER, LOCK, BOOST and PIT in
colours. A sat-nav on a stalk, three warning lamps in a hood behind the wheel, a HUD knob, and a
squared wheel with the lift on two thumb keys, UP and DN, that turn with it. Thin check-cloth seats,
door bins, cup holders.

### As measured

| | Length | Width across the fans | Height on its feet | Faces near, far |
| --- | --- | --- | --- | --- |
| Wraith | 4.90 m | 2.58 m | 1.39 m | 4,032, 158 |
| Wolverine | 4.70 m | 2.88 m | 1.30 m | 4,128, 172 |
| Hornet | 4.00 m | 2.44 m | 1.62 m to the roof | 3,293, 157 |

### Checked, and not

Each car's gates pass: its cockpit gate, `scripts/hover-cars.mjs`, the controls and legibility gate,
and the mesh, livery, hangar, shell and ink gates. All three were looked at in the Modelshop,
outside and from the seat. None of the three has been flown in the running game, and
`npm run test:regress` wasn't run for this build.

## Names

The three were first built as the Hallard Lanner, the Garrow Bustard and the Minim Pipit. David
renamed them on 2026-11-22, makers and models, and the emblems were redrawn. No file, id or livery
keeps an old name.

## Open questions

- Should a maker's dealership stock differ by district, or does Marrow Street sell all four?
- The underglow and the setup menu are the Merlin's. Do the other three get them, or is that
  Corvane's extra?

## Paint finishes and glass (as built, 2026-11-24)

The booth offers five show coats beside gloss, satin, matte and weathered, for every aircraft and not
only the hover cars: metallic, metal flake, pearlescent, candy and chameleon. Each one is shaded on the
GPU by `gl/solids.js`. `finishCodeOf` in `client/shared/vehicle-materials.js` gives a face its code,
and `writeQuad` packs the code into the coat's strength (8 down per code). Flake is a cell grid in the
car's own metres, so it rides with the body.

- **Pearl** works like real tri-coat pearl. A base colour sits under mica whose film reflects one
  colour, the **Pearl** swatch (white pearl if none is picked). That colour shows round the highlight
  and wherever the coat mirrors bright sky; away from it you see the base. A dark base shows the pearl
  strongly; a light base shows it faintly, with a hint of its complement.
- **Chameleon** is colour-shift pigment over a black ground. The base is the face-on colour and
  **Shift to** is the edge colour. The hue travels the short way round the wheel between them, and the
  coat is bright only where its flakes catch light.
- Both carry the second colour packed into the vertex colour (`rgb2`, peeled off as `flipC`). It's
  stored in the livery's `accent`.
- A hover car's panes get glass code 6: Schlick Fresnel, the world reflected sharp, a faint smear and
  a hard sun spot.

Most of the showroom sets now name a show coat (Rosso is candy, Bianco is pearl, Nero is flake, Plum is
chameleon, and so on).
