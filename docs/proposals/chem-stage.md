# The Chem Stage: drugs, labs and rolling in 3D

> **Status: phases 0 to 3 built (the matter data, the lab standing in ROOM, every form's chain and the splice at the Chem Stage, accidents played); the rest is design.** Where this doc disagrees with
> [plugins/synthesis/README.md](../../plugins/synthesis/README.md) or
> [plugins/rolling/README.md](../../plugins/rolling/README.md), the README wins.

## Why

Drug cooking is `plugins/synthesis`. A cook is one 2D canvas minigame picked by
the drug's form (`synthlab.js`), and a splice is a five-stage 2D overlay
(`splicelab.js`); both draw with `lab-kit.js`. The chem lab is one furniture
row (`furn_chem_lab`), hidden behind the Cachet Vantage 900 cabinet by
`plugins/concealment`. Rolling is a single verb that turns a gram of leaf into
one joint or cigarette, with no skill and no game.

Cooking food already has a 3D rung, the [Kitchen Stage](kitchen-stage.md), on
ROOM's renderer. This doc carries drugs the same way and further: a lab you can
see standing in the room, glassware that holds real-looking liquids, powders,
crystals and fumes, a stage chain per form instead of one dial, sound for every
step, two new labs, and rolling as a game of its own.

## Rules

These are the Kitchen Stage's rules, applied to the bench.

1. **One payload, three rungs.** The server stays authoritative. The Stage
   draws the `chembench` workspace payload (`plugins/synthesis/workspace.js`)
   and the `synth_minigame` message. Every gesture sends the command the 2D
   overlay or a typist would send. On `log`, a cook resolves as a skill check,
   as it does now.
2. **Typing never loses.** A stage you can't see scores neutral: 50, which is a
   `minigameBonus` of 0. A good hand gains a little. The ±2 cap in
   `synthresolve` stays the ceiling, now shared across the stages of a chain.
3. **Matter is data.** A drug's look and behaviour come from `flags.form` plus
   a new `flags.matter` block on its drug row: colour, viscosity, grain size,
   crystal habit, fume colour, smoke density. The renderer never names a drug.
4. **The props come from the room.** The lab's `station_quality` (scavenged,
   refined, clinical) picks the glassware set. Nothing about Coldwater goes in
   `gl/`.
5. **Matter changes on a beat.** Colour and phase move only when the server's
   beat moves, as food does in the kitchen. A smooth ramp would be a countdown.
   Bubbles, flow and smoke may move freely between beats.

## Rungs

| Rung | Bench |
|---|---|
| `visual` | The Chem Stage, if WebGL2 builds; otherwise today's 2D overlays |
| `textgames` | Today's 2D overlays (`synthlab.js`, `splicelab.js`) |
| `log` | Unchanged: a skill check |

## The labs

### The concealed lab, rebuilt

The Drum basement lab behind the Cachet Vantage 900. The keypad's reveal plays
in ROOM: the cabinet pivots on its turntable into the wall cavity, and the lab
rolls out on its rail into the same slot, which is what `standIns` in
`commands/describe.js` already says happens. The lab you then sit at is the
same model, not a separate overlay. Scavenged tier: a fume hood whose fan has a
bad bearing, ring stands, a rotovap built from a fish-tank pump, reagent
bottles in three languages and the skull.

The Solenne pair (`furn_cachet_v900_solenne_b`, `furn_chem_lab_solenne_b`) uses
the same models at refined tier.

### A licensed lab

A new, legal lab in Coldwater: a pharmacy back room or a college teaching lab.
Clinical tier, stocked with legal reagents. Cooking a controlled drug there
works, and is seen: the room's camera feeds the wanted system
([systems-surveillance.md](../systems-surveillance.md)) unless the camera is
dealt with first. That makes it the better bench and the riskier one.

It follows the building rules: sited with `scripts/content/sitecheck.mjs`, a
plain name if it's a college, pun then trade if it's a shop, a bespoke map
icon in the same build, power and lighting wired in the same build, staff NPCs
with `npc_residences` written for them.

### Models

One kit, `client/game/js/panels/gl/lab-mesh.js`, in batches like
`kitchen-mesh.js`:

- the bench, fume hood and duct, sink and drying rack
- glassware by tier: beakers, graduated cylinder, round-bottom flask, reflux
  condenser, separatory funnel, Büchner funnel and flask, crystallising dish,
  bell jar, ampoules and vials
- the solids line: mortar and pestle, sieve, pill press, scale
- heat and gas: hot plate with stir bar, spirit burner, gas cylinder and
  regulator, tubing
- the botanical line: drying screen, curing jars

`room-decor` and `room-fittings` place the lab's idle set in the ordinary Room
Stage, so the lab is part of the room whether or not anyone is cooking.
Sitting at it hands the camera to the bench, as the Kitchen Stage does at the
counter. Each piece is viewable in the Room Lab and the Modelshop.

## Material physics

One module, `gl/lab-matter.js`, deterministic from a seed so two players in
the room see the same pour.

- **Liquids.** Grows `kitchen-liquid.js`: a surface heightfield per vessel that
  sloshes when the vessel moves, a meniscus, a pour stream drawn as a ribbon
  that breaks into drops when it thins, colour mixed by volume, boiling bubbles
  driven by heat, and two layers that don't mix in the separatory funnel.
- **Powders.** A grain heightfield that slumps to its angle of repose, moved by
  scoop and tap, clumping when humid, puffing dust when dropped.
- **Crystals.** Grown on the server's beat in the habit `matter.habit` names
  (needles, plates, cubes, shards). Slow cooling makes few large clear
  crystals; fast cooling makes many small cloudy ones. The mortar breaks them
  into powder.
- **Fumes and gas.** Soft puffs pulled toward the hood by its draft. Fan
  strength is the hood's condition; when it fails the fumes pool at head
  height, and breathing them is a dose ([systems-survival.md](../systems-survival.md)).
- **Smoke.** Shared with rolling: an ember that glows when drawn on, smoke that
  curls and rises, ash that grows.

Budgets follow [glass-notes.md](../reference/glass-notes.md): particle counts
are capped, phones get half, and the lab's static set is baked as GLASS Lite
bakes buildings.

## The stage chains

Each form family gets a chain of short stages instead of one dial. The scores
roll up into the one `synthresolve` token the server already checks.

- **Wet** (liquid, gel, paste): measure to the line on the cylinder, heat to a
  temperature read off the thermometer (no countdown), keep the condenser's
  water running through the reflux, open and close the funnel's stopcock at the
  interface, then evaporate.
- **Solids** (powder, pill, crystal): weigh on the scale, grind in the mortar
  with a circular gesture, then either press pills (force and alignment) or
  crystallise (pick the cooling rate) and filter on the Büchner.
- **Gas**: set the regulator, check a joint for leaks with soapy water, collect
  under the bell jar.
- **Botanical** (leaf, blotter): dry on the screen, cure in jars and burp them
  on the beat, extract.
- **Splice**: the existing MIX, POUR, STIR, STABILIZE and SET stages, played on
  the real vessels with real liquid in them. A catastrophe is an event in the
  room: a flash fire, a flask bursting, a fume flood. The room sees it.

**Purity shows.** The product's colour, clarity and crystal size come from the
server's grade, so `examine` and a buyer NPC can say what they see.

**The bench bites back.** Fire, burns, cuts from broken glass on a body part
([combat.md](../combat.md)), fumes. The lab gets dirty
([systems-cleaning.md](../systems-cleaning.md)) and its glassware wears
([systems-durability.md](../systems-durability.md)).

## Rolling

`plugins/rolling` grows into a game, with a stage of its own
(`client/game/js/panels/rolling-stage.js`, `gl/rolling-mesh.js`).

- **What you can roll:** a joint, a spliff, a blunt (gut a cigarillo, refill
  the wrap), a cigarette, and a cigar from leaf (bunch, binder, wrapper). New
  items: papers, blunt wraps, crutches and filters, tobacco and cannabis leaf in
  grades.
- **Stages:** grind for fineness, fill an even line, tuck and roll (the paper
  curls round the leaf, using `gl/cloth.js`), lick and seal, pack or twist the
  end. A cigar is bunch, binder, the wrapper's spiral, and the cap.
- **Grade:** evenness, tightness and weight. The grade sets burn time and dose
  (`smoking` reads `custom_data.quality`). A bad roll canoes, runs or goes out
  and needs relighting.
- **Smoking it in ROOM:** held through `room-held.js`, with the ember and smoke
  from `lab-matter.js` and ash you tap off.
- **Typing never loses:** a typed `roll` makes exactly what it makes today, at
  a neutral grade.

## Sound

SIREN presets written by `scripts/content/build-sfx.mjs`, built as
[sfx-craft.md](../reference/sfx-craft.md) says and passed through
`sfx-lint.mjs`:

- glass clinks by vessel size, a pour whose pitch rises as the vessel fills,
  boiling that thickens with heat, burner hiss, regulator hiss, the stir bar's
  hum, the mortar's grind, the pill press's thunk, crystals ticking as they
  form, the hood fan's bad bearing
- a glass burst and a flash fire for the catastrophes
- rolling: paper rustle, grinder, lighter flick, the ember's crackle on a draw

## Phases

| Phase | What |
|---|---|
| 0 | This doc; `flags.matter` on every cookable drug row, and a `content:lint` check that each has one |
| 1 | `lab-mesh.js`; the lab standing in the Room Stage; Room Lab and Modelshop views |
| 2 | `lab-matter.js` liquids and powders; the wet and solids chains |
| 3 | Crystals, gas and botanical chains; the splice in 3D; catastrophes |
| 4 | The concealed reveal in ROOM; the licensed lab (content, icon, lighting, staff) |
| 5 | The rolling stage, the new papers, wraps and leaf, smoking in ROOM |
| 6 | The sound pass; the phone tier |

Each phase is its own commit and passes regress.

### Phase 0, as built

- `client/shared/chem-matter.js` holds the forms, the matter keys, the defaults per form,
  `matterOf(drug)` (defaults with `flags.matter` over them) and `drugMatterProblems`. It's pure
  data, like `kitchen-matter.js`, so the server, the client and the lint share it.
- The matter keys: `viscosity` (0 to 1), `grain` (fine, coarse, granular), `habit` (needle,
  plate, cube, shard), `clarity` (0 to 1), `fume` (#rrggbb) and `smoke` (0 to 1). `flags.color`
  is the product's own colour, not its trip's.
- `content:lint` checks every drug's form, colour and matter, and fails a drug a chemistry
  recipe cooks if it has no form, no colour, or lacks the matter keys its form needs (a liquid
  needs `viscosity`, a crystal `habit` and `clarity`, and so on).
- All 27 cooked drugs carry them. Until this, no drug row had a `flags.form`, so every cook
  played the wet game and the splice bench guessed each drug's package from a hash of its id.
  Now the cook game follows the form (9 wet, 10 solids, 3 gas, 5 botanical) and splice packages
  show the real form and colour.

### Phase 1, as built

- **The grades are the game's own.** `flags.station_quality` is standard (absent), refined or
  pristine, the same key `plugins/synthesis` reads for its bonus, so the model and the odds can't
  disagree. `labGrade(flags)` in `client/shared/room-layout.js` reads it, and an unknown value is
  standard. (This doc's design called them scavenged, refined and clinical; those are now the
  looks of standard, refined and pristine.)
- **One model, two ways in.** A turned Cachet already drew the `chemwall` form; now it carries the
  hidden lab's grade (`lab` on the piece). A lab row that stands on its own
  (`crafting_station: chem_lab`, not behind a cabinet) lays out as `surface`/`chemwall` too, at
  2.4 × 0.72 × 2.3 m, whatever its `object_type`, and its bench is a `workspace` station, as a
  turned Cachet's is. Both draw through `drawLab` in
  `client/game/js/panels/gl/lab-mesh.js`.
- **The kit is ROOM's frame, not the kitchen's.** The design said centimetres and z up like
  `kitchen-mesh.js`. It's metres in a piece's own frame instead, on the room's helpers, because the
  bench is drawn inside ROOM and the Chem Stage will be ROOM's renderer too; a converter in between
  would buy nothing. Each piece is its own function (`vessel`, `refluxRig`, `separator`,
  `filterRig`, `crystalDish`, `mortar`, `scale`, `stirrer`, `pillPress`, `reagents`, `gasBottle`),
  so the stage can pick them up one at a time.
- **Glass is clear and blended**, drawn into the room's glass batch, which shows only highlights
  and Fresnel. A vessel is that glass, a solid liquid inside it (`fillOf` clips the profile at the
  fill line) and a solid lip.
- **What each grade has out.** All three: casework, a hood with a lit roof, a framed sash and a
  duct; a reflux rig and a separatory funnel under it; a scale and a mortar at the front of the open
  bench; two shelves of labelled reagents; a gas bottle strapped in the knee space. Standard: a
  steel-sheet top with scars, a spirit burner on a tripod, a measuring cylinder, a skull and tape
  on the hood post. Refined: an epoxy top, a heating mantle, a Büchner filter, a crystal dish and a
  hotplate stirrer. Pristine adds white casework, a stainless hood, a tablet press, a balance with
  a draught shield and an eyewash.
- **Gate.** Section 13 of `scripts/shapes/room-stage.mjs` checks that a lab row and a turned
  Cachet lay out at their grade, that a sealed Cachet is still a bar wall, and that each grade at
  both sizes builds, puts glass in the room and keeps every vertex inside the footprint the walker
  collides with.
- **The Room Lab** opens it: `?zone=zone_solenne_apt_b&turned=1&lab=pristine`. The Drum basement's
  lab has no room spec, so it isn't drawn in ROOM yet; that comes with phase 4.

### Phase 2, as built

- **Where a cook goes.** The server arms a cook as it always has. On the visual rung,
  `synth_minigame` opens the Chem Stage (`client/game/js/panels/chem-stage.js`, loaded by
  `openChemStageOr` in `lazy-views.js`) when `chainFor(family, form)` has a chain; gas, leaf and
  blotter drugs, the dev `cooktest`, and a client with no WebGL2 get the 2D bench as before. The
  message now carries `grade` (the lab's `station_quality`) and `color` (the drug's `flags.color`),
  for the picture only.
- **The chains** are pure sims in `client/shared/chem-chain.js`. A liquid, gel or paste plays
  measure, heat, reflux and evaporate; a powder or crystal plays weigh and grind; a pill plays weigh,
  grind and press. Each stage scores 0 to 100, and the chain sends their mean as the one
  `synthresolve <recipe> <score> <nonce>` the 2D game sends, so the ±2 cap, the chemistry check and
  the catastrophe roll are the server's, unchanged. The difficulty the server sends (4 to 12) narrows
  every band and window to about half at the hardest.
- **What each stage asks.** Measure: hold to tip a bottle, and let go so what's still in the neck
  lands on the red line. Heat: drag (or the wheel, or the arrow keys) to set the hotplate's dial;
  the mercury lags behind it, so you lead it onto the green mark and hold it there; past the boil it
  boils over. Reflux: open the water tap enough to keep the vapour ring low in the condenser as the
  heat drifts; too little and it climbs out of the top. Evaporate: take it off the heat when it's
  just dry; early is wet, late scorches. Weigh: hold to tip the spatula, with the scale's readout
  over it; what's in the air still lands. Grind: hold and circle the pestle round the bowl (or the
  left and right keys); too fast and it flies out. Press: hold to bring the punch down and let go
  on the gauge's mark, three times; too hard cracks the tablet.
- **No countdown.** Nothing on screen times the right moment. The beat in the evaporating dish (wet,
  dry, scorched) is the stage's own: during a cook the server only arms and resolves, so there's no
  server beat to follow.
- **The picture.** A small windowless room round the phase 1 lab, drawn by ROOM's renderer on its
  own canvas. The bench is drawn `working`: its open bench cleared, the sash pushed up, and the
  stage's own tools put out (`workingSet` in `lab-mesh.js`), rebuilt once per stage so its glass is
  real glass. What moves is `drawStage` in `gl/lab-matter.js`, as the room's props each frame, at the
  places `benchOf` gives both files.
- **The matter.** A liquid's surface tilts on a damped spring when it's poured into or boils
  (`slosh`); a powder lands on a radial heightfield that slumps to its angle of repose and keeps its
  mass (`heap`); the reagent's colour is the product's mixed by volume with a clear solvent. The
  design said this would grow `kitchen-liquid.js`; that's a 2D grid for stirring a wide pan, and a
  narrow vessel wanted a tilting surface instead, so it's its own model.
- **Not in phase 2** (both came with phase 3). Separating at the funnel's stopcock waited for the layered liquid, and
  crystal drugs play the powder chain until the crystallising branch comes with phase 3. The sound is
  `lab-kit.js`'s placeholder `AX` set (pour, clink, good, bad) until phase 6.
- **Gate.** `scripts/shapes/chem-stage-smoke.mjs` (in `shapes:smoke`) plays every stage at the
  easiest and hardest difficulty: a good hand scores 80 or more, a bad or idle one 35 or less, and a
  seed always plays the same. It checks which forms play which chains, plays a whole pill chain, and
  checks that a heap keeps its mass and angle of repose, that a slosh dies away, that colours mix by
  volume, and that every stage draws finite geometry at every grade, on a bench whose open bench is
  cleared.
- **The Room Lab** opens it with no server: `__labChem('pill', 'pristine', { difficulty, color })`.
  The score lands on `window.__labChemScore`. With the pane hidden, `__chem._chemTest.step(seconds,
  input)` steps it by hand and `__chemSnap(name)` writes a frame.

### Phase 3, as built

- **Every form has a chain now** (`CHAINS` in `chem-chain.js`): a liquid, gel or paste plays measure,
  heat, reflux, separate and evaporate; a crystal plays heat (to dissolve it), crystallise and
  filter; a gas plays regulate, leak test and collect; a leaf plays dry and cure; a blotter plays
  measure and dry. The splice is its own chain: measure, stir, heat and set.
- **The new stages.** Separate: hold the stopcock open and shut it where the two layers meet.
  Crystallise: set how hard the dish is pushed into the ice; a steady rate grows a few big clear
  crystals, a fast one a cloudy crust. Filter: pour the slurry onto the Büchner as the vacuum pulls it
  through, never over the rim and never letting the cake run dry and crack. Regulate: hold the gauge in
  the green as the bottle empties, under the red where the relief valve blows. Leak test: brush the
  joints (click, or 1 to 4) until one bubbles, then hold on it until it's tight, and no longer, or it
  strips. Collect: let the gas push the water in the jar down to the mark. Dry: heat the leaves and
  take them off (a tap, not a drag) when they're crisp but green. Cure: burp the jar when the
  hygrometer's in its window, four times; late moulds. Stir: circle the rod at a steady pace. Set:
  strike as each ring closes on the flask, six beats.
- **The splice** opens the Stage on the visual rung, at its difficulty plus four times its
  instability. A stage an automation rig carries (`SPLICE_RIG` maps the 2D keys) is done for you at the
  rig's score, as before. The score goes back as the same `spliceresolve <token> <score>`.
- **Accidents are seen.** The Stage sends its score as soon as the last stage is done and keeps the
  card up. The server answers with `chem_outcome` (`tellOutcome` in `plugins/synthesis`): `fire` for a
  wet cook's catastrophe, `burst` for solids and gas, `fumes` for botanicals, `flash` for a splice,
  `spoiled` for a failure, `ok` for a success. The Stage plays it: flames, glass flying, fumes, a white
  flash. What an accident costs is decided on the server exactly as before. The room now gets a line
  when a bench goes up ("Ash's bench catches fire.").

### The picture

The Stage is meant to look like the best thing in the game. What it takes, beyond phases 1 and 2:

- **Two additions to ROOM's renderer** (`gl/room.js`), shared with every room and inert in any that
  doesn't use them. `setGlows(list)` takes up to eight coloured point lights that light the room's
  surfaces, not only beasts: a hotplate's element, a burner, the reaction's pulse, a fire. Liquids are
  material 44 in the glass pass, tinted, lit and see-through, from the room's own glass batch
  (`liquidLathe` in `lab-mesh.js`, for what stands still) or from a stage's own (`setPropsGlass`, for
  what moves). `setStageHalos` adds a stage's soft glows to the halo pass.
- **Light, not objects.** `lightStage` in `lab-matter.js` gives each frame its glows and halos:
  hotplates glowing red under their glass, the standard bench's burner throwing blue, LEDs haloed, the
  reaction flooding the bench with its colour on the beat, steam as soft wisps, dust turning in the key
  light. An outcome is mostly light: fire is tall plumes in the halo pass with a few small solid cores,
  pooling orange on the bench; a flash whites the room out.
- **Lighting a set, not a flat.** No daylight; a warm key over the open bench, the hood's cool tube and
  a low cool fill. The wall behind a working bench is tiled grey-green the whole width, so glass and
  glows read against it. The room is larger so its other walls fall into the dark.
- **A camera that acts.** A wide establishing shot of the bench that glides into the first stage; a
  slow breathing drift; a push-in as a stage comes to its moment (the line nearly reached, the ring
  nearly closed, the cake nearly dry); shake on a botched stage and on an accident; a pull-back on the
  card. Letterbox bars for the opening and the result, and a vignette.

## Open questions

- College teaching lab or pharmacy back room for the licensed lab.
- Whether rolling gets its own skill or rides Dexterity.
- Whether a catastrophe can damage the room itself (scorch decals, a broken
  hood that stays broken until repaired).
