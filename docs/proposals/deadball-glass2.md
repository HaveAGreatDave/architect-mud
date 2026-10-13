# Deadball in GLASS 2

**Status: Phase 0, sim v2 and Phases 1 to 3 built, behind a flag: the park in 3-D with its light, air, lens and grade, the arcade graphics, and the city round
the park as a set with the park's own outside (1a to 1e); skinned players who pitch, swing, catch
and call every pitch at its real speed and spot, and the Pose Lab their clips are keyed in (2a to
2e); every ball in play decided on the server, with the booth's lines sorted to agree with it
(3a), the clips to play it with, players who travel as they move (3b), every ball in play
played out in the park with its cameras and its cutaways (3c), and the men on the bases running
it out and trotting up after ball four, the changeover, and the steals, throws over and wild
pitches played on the bases (3d), and the spectacle: the comet's tail, sparks off the bat,
fireworks, the home-run camera and the splash words (3e); and from Phase 4, reduced motion and
the play by play in words for a screen reader (4a), slow-motion replays (4b), a crowd that gets
up for the plays (4c), and the dead time: the infield keeping the game's marks, the field
resetting between at-bats and the grounds crew in the fifth (4d). The rest of Phase 4 and Phases 5
to 7 are design.** A plan for giving Deadball a 3-D sub-screen the way Cluster Puck got Rinkside, at the
highest fidelity the engine can reach. Deadball is a live sport on KSAB, and the broadcast borrows
the look of a 1990s arcade baseball game. That means skinned, detailed players, authored animation
with a wide spread of plays, light from the park's own towers and a crowd that fills the stands.
Around them go chunky chrome lettering, splash words, trails and fireworks, an announcer over a full
synthesised sound bank, a playoff package, and a park inside the Curtain on Halcyon Fields. What's
built is in [systems-broadcast.md](../systems-broadcast.md#the-park-in-3-d-the-grandstand-behind-a-flag)
and under Phases below. The audio engine work is on its own branch.

How it got here, all on 2026-10-11:

- The first draft aimed at a 1990s video-game look and offered three: 32-bit console, 64-bit console
  and arcade cabinet.
- The second went to high fidelity, with a 1990s broadcast around the game.
- The third put the park outside Coldwater's South Gate, with the city beyond the outfield.
- The fourth took the arcade look, at high definition, using everything THOMAS, GLASS, SIREN and
  ORACLE can do. The second draft's broadcast picture stays as a preset.
- This one moves the park inside the Curtain, onto a block of nine tiles in Halcyon Fields, and
  draws the city round it up close. It drops the in-world cabinet, because Deadball is a live sport
  on television and "arcade" names only its look. It adds a high-score table of the league's
  leaders, a spread of plays from the ball off the bat to errors and stolen bases, and a proper grip
  on the bat. The audio engine work went to its own plan and branch.
- Decided the same day: the park is **Halcyon Field**; on the map it takes a compact block of nine
  tiles, six buildings and Vetch Green, which are set aside for later use rather than deleted; and
  sim v2 goes in as soon as it's ready, without waiting for a new season. A first site at full scale
  took 41 buildings and was turned down.
- Later the same day, the city round the park on TV became a set composed for the cameras from the
  map's buildings, in place of the map bent round the park.
- Then the players got the Modelshop's heads: the street figure's head and its face atlas, with caps
  and helmets fitted to the skull.

Read with [systems-broadcast.md](../systems-broadcast.md#sports--two-codes-one-pipeline) (the sports
pipeline, Rinkside and the CPhL's clubs), [bsm-format.md](../bsm-format.md) (how the booth's lines
are authored), [glass-notes.md](../reference/glass-notes.md) (GLASS 2's traps),
[world-rendering.md](../reference/world-rendering.md) (the street figures this builds on),
[street-figure-heads.md](street-figure-heads.md), [glass-materials.md](glass-materials.md) and
[engine-plugin-boundary.md](engine-plugin-boundary.md).

**It depends on the Cluster Puck branch.** Rinkside's GLASS 2 renderer
([gl/arena.js](../../client/game/js/panels/gl/arena.js)), the club seam
([club-crest.js](../../client/game/js/panels/club-crest.js)), the CPhL build script and the
hockey pacing are on `cphl-club-identities` and `ccr-91a64fd1-pbqpbt`, not on `main`. Main has
the older 2-D-only `gameday-rink.js`. This branch is built on that work, so it reaches `main` with
this branch or ahead of it.

## The short version

- **Fidelity:** players of 12,000 to 20,000 triangles up close, skinned on the GPU, with the
  Modelshop's street-figure heads and painted faces under caps and helmets fitted to the skull, cloth with fabric normal maps, and dirt that collects on uniforms over
  a game. Animation from an authored clip library with IK for every contact (glove to ball, hands to
  bat, feet to dirt), gated by tests that measure foot slide and contact error.
- **Light:** four of the park's six light towers cast real shadows, so every player stands on a star
  of soft shadows, as players do under stadium lights. HDR, ambient occlusion, bloom, haze with
  light shafts, and a lens that throws the crowd out of focus behind a close-up.
- **The arcade look, on live TV:** the graphics are chunky chrome-and-flame lettering in the
  client's own display faces, count lamps, a strike-zone marker, matchup cards, splash words on the
  big plays, and between innings a high-score table of the league's leaders. The camera is the
  batting view from behind the plate, and the spectacle is comet trails and fireworks. The picture is
  full 24-bit colour with punchy contrast. An optional "tube glass" adds a period television's
  scanlines and curved tube.
- **Variety:** every ball in play gets a direction, a speed off the bat and a fielding grade, so
  grounders, liners, gappers and wall-scrapers spray the field by handedness and outs run from
  routine to diving. A second version of the sim, switched on at a recorded slot as soon as it's
  ready, adds errors, stolen bases, pickoffs, wild pitches and hit batters, each with its own clips
  and graphics.
- **The whole engine:** a table maps each capability to a use, from cloth bunting and a starling
  murmuration at dusk to lightning over the skyline in an ion storm.
- **Playoffs:** the one-game final gets a gold package, a logo painted behind the plate, bunting,
  rally towels and searchlights. It ends with confetti and fireworks over the city.
- **Sound:** a high-fidelity SIREN bank of about 50 cues sits 9 dB under the announcer and ducks
  6 dB further while the announcer speaks. ORACLE calls the big plays.
- **A place in the world:** Halcyon Field stands inside the Curtain on a block of nine tiles in
  Halcyon Fields, six buildings and Vetch Green, set aside for later use. No street closes, and its
  gates open onto Halcyon Boulevard and Sorrel Way. On the map it's drawn at the map's compressed
  scale, as GLASS draws every landmark. It's lit on game nights and seen from the streets, the towers
  and the air.
- **The shape:** Rinkside's. A view shell with the same five methods, a world, a director that
  stages one payload, a camera, replays, a frame governor, and smoke gates that play real games.
- **What GLASS 2 has and what it needs:** it already has an HDR chain, ambient occlusion, height fog
  with light shafts and instanced, vertex-animated crowds of procedural people. It has no GPU
  skinning, no normal maps, no sRGB textures and no spotlight shadows; this plan adds them as engine
  pieces any view can use.
- **Coldwater beyond the outfield:** on TV the park is full size, and the city round it is a set
  composed for the cameras, not a copy of the map: a street grid in a rectangle of three straight
  Curtain walls and a straight shore, with each of the map's buildings on a plot near its true
  bearing from home plate. The park faces north-west, so the Spire and Halcyon Towers stand over
  centre field and right-centre, and the estate's tower row along the West Curtain over left. The
  buildings are GLASS's own baked shapes, drawn for close range: facades with lit rooms, streets with
  lamps, cars and people walking to the game, and the park's own brick exterior. The sky follows
  Coldwater's clock and the weather at the park.
- **The fallback:** today's 2-D Gameday view.
- **The server:** the sim stays as it is until sim v2 switches on at a recorded slot, and every game
  before that slot replays exactly as it aired. The payload gains a small cosmetic play description
  chosen on the server, so the booth's line and the picture can't disagree. Sending the standings
  once a game instead of on every at-bat cuts about a third of the bytes the sub-screen costs.
- **The clubs:** yes, through the club seam, with crests and wordmarks drawn at texture resolutions
  that hold up in a close-up.
- **Seven phases**, the first three behind a flag. Look-dev renders of the target are on the review
  page.

## What exists today

### Rinkside, the pattern to follow

[gameday-rink.js](../../client/game/js/panels/gameday-rink.js) is the shell: header, strip,
caption, cards, intermission board, sound mapping and the frame loop. It returns
`{ apply, clear, setCaption, showIdle, showCard }`, so [tv.js](../../client/game/js/panels/tv.js)
(`_gamedayViewFor`) picks a view by `gd.sport` and nothing else in tv.js knows which sport it is.
The work is in [panels/rink/](../../client/game/js/panels/rink/):

- `sim.js` is the world, stepped at 120 Hz. Between beats it plays cosmetic hockey that never shoots.
- `director.js` stages one payload: who moves where, when the puck goes, and `onLand`, the
  moment the play lands, which is when the held caption and card go up and Read Aloud speaks.
- `camera.js` never yaws or rolls, solves its framing so the puck and the net are both in shot,
  and writes the same camera out as GL matrices.
- `replay.js` keeps the last ten seconds of what's drawn at 30 Hz and plays it at half speed.
- `rig.js` is a 21-joint procedural skeleton with strides, shots, punches and ragdolls.
- `figure.js` and `render.js` are the 2-D canvas renderer used when there's no WebGL2.

[gl/arena.js](../../client/game/js/panels/gl/arena.js) draws it. Bodies are rebuilt on the CPU every
frame from the joints, at 946 triangles for a skater at broadcast distance and 2,684 close up;
jerseys come from a 1024² atlas of 128² slots. Its lit shader is one fixed key light, a hemisphere
and a Blinn-Phong highlight, with no shadow maps, HDR or ambient occlusion. Two gates cover it:
[rink-smoke.mjs](../../scripts/shapes/rink-smoke.mjs) plays two real games through the view over a
DOM stub and checks the picture agrees with the sim; [arena-smoke.mjs](../../scripts/shapes/arena-smoke.mjs)
checks matrices, mesh budgets and the no-WebGL2 path without a GPU.

Things Rinkside doesn't do, which this plan does and could hand back: it never calls `loseContext()`
when it's closed (a page gets 16 contexts; see
[glass-notes.md](../reference/glass-notes.md#releasing-gl-scenes-2026-09-17)), it keeps drawing while
the tab is hidden, and it doesn't read `prefersReducedMotion()`.

### What GLASS 2 already has

Every layer is a factory that takes a `gl`, so a separate view can create them on its own context.
What ties most of them to the city is the camera: they read a GLASS camera's scalars rather than a
matrix.

| Module | What it gives the ballpark | What it needs |
|---|---|---|
| [hdr.js](../../client/game/js/panels/gl/hdr.js) | RGBA16F target with 4× MSAA, bloom, ACES tone curve, exposure | Nothing; it imports only `programs.js` and `colour.js`. Needs `EXT_color_buffer_float`. |
| [ssao.js](../../client/game/js/panels/gl/ssao.js) | 12-tap hemisphere occlusion with a blur, 0.6 to 1.3 ms in the city | A variant that reconstructs position from a projection matrix instead of the city camera's scalars. |
| [fog.js](../../client/game/js/panels/gl/fog.js) | Analytic height fog and per-light in-scatter (light shafts) as GLSL | Nothing; pure strings. |
| [envcube.js](../../client/game/js/panels/gl/envcube.js) | A small reflection cube | A larger cube and a GGX prefilter for glossy helmets and shin guards. |
| [shadow.js](../../client/game/js/panels/gl/shadow.js) | One 2048² sun map fitted to the scene | Spotlight maps for several towers at once. New. |
| [actors.js](../../client/game/js/panels/gl/actors.js) with [actor3d.js](../../client/game/js/panels/actor3d.js) | Procedural people on a 19-bone skeleton, baked into vertex-animation textures and drawn instanced: 4,780 triangles near, 626 far, eight hand-written clips | Seated, standing and cheering clips for a crowd. The approach is the crowd. |
| [cloth.js](../../client/game/js/panels/gl/cloth.js) | Baked cloth animation for flags and shelters | Pennants and the centre-field flag. |
| [street-figure-heads.md](street-figure-heads.md) | Head meshes at 1,840 / 696 / 232 triangles and a 2048×1280 face atlas, built but not yet drawn in the game | Drawing it, which this view would be first to do, and `skullPoint` exported from `actor-head.js` so headwear can be fitted to the skull. |

Nothing in the client does GPU skinning, normal mapping or sRGB texture decoding, and only the rink's
ice uses anisotropic filtering. GGX lighting and the environment cube exist and are off by default
([glass-materials.md](glass-materials.md)). The Modelshop edits buildings and vehicles; it has no
character, pose or clip tools, and its Actor Lab only views a bake. Every frame time in the docs comes
from one machine with a discrete NVIDIA card; integrated GPUs and phones are untested.

### Deadball's Gameday view

[gameday.js](../../client/game/js/panels/gameday.js) is a top-down, 2-D field in HTML and SVG,
beside a 176 px rail (count, pitch plot, matchup, play card, standings). Per payload it:

- plays the server's pitches one every 2.6 s at most, 13 s in all, each a 340 ms ball from mound to
  plate, with the count from each pitch;
- derives where the ball goes on the client, from a hash of the batter, inning and pitch
  (`_hitTrajectory`): an angle, a depth from the kind, and a fielder picked by angle;
- runs the bases one at a time, peels scoring runners off to the dugout, and lights the bases to
  match `basesAfter` once it settles;
- holds the caption and any card until the play lands, then idles until the next payload;
- plays nine inline SIREN layers (`mitt`, `crack`, `whiff`, `glove`, `base`, `run`, `homer`,
  `strikeout`, `out`) on the `tv` category.

It had no gate: `client:smoke` parsed it, and nothing ran it. Phase 0's `gameday-smoke` runs it now.

The sim, [baseball.js](../../plugins/broadcast/sports/baseball.js), resolves plate appearances
only: thirteen kinds (strikeout, groundout, flyout, popout, single, walk, double, triple, home
run, double play, triple play, sac fly, productive out), base advances, extra innings and
walk-offs. It has no pitches, hit direction, fielders, errors, steals or substitutions.
`synthPitches` makes the pitches afterwards, as cosmetic keyframes seeded from the game. The
assembler, `assembleSportsGraph` in [index.js](../../plugins/broadcast/index.js), puts a `gameday`
payload on the lead line of each called at-bat and a `phase: 'half'` payload on each half-inning's
framing line. Baseball has no `narrate`, no `paceCalls` and no cues: every game line holds the same
time.

### The club seam

`sports_pools.clubs` on a broadcast row holds each club's identity: colours, a vector crest,
`kit.home` and `kit.road`, and optionally a tartan sett. [build-cphl-clubs.mjs](../../scripts/content/build-cphl-clubs.mjs)
writes the CPhL's and fails `--check` when the row is stale. Payloads carry a `clubsRev` stamp; the
client asks once with `tv_clubs` and keeps the set in localStorage per sport. Only hockey uses it:
`clubsRevOf` lives in `hockey.js`, and `sendTvClubs` assumes hockey when no sport is given.

### Measured

Assembled from the Deadball content row over six slots (3, 50, 101, 222, 777, 1200):

| | Per game |
|---|---|
| Game lines | 128 to 149, mean 139 |
| At-bat payloads | 64 to 80 |
| Half-inning payloads | 17 or 18 |
| Pitches per at-bat payload | 3.8 to 4.3 on average, 8 at most |
| Payload size, standings left out | about 0.8 KB, 1.4 KB at most |
| Payload size with the 8-row standings | 1.1 to 1.9 KB, about 1.4 KB typical |

So a game is about 87 payloads, not 300, and about 115 KB per viewer with the sub-screen open. The
standings are the same rows all game (`gdStandings` is computed once when the graph is assembled),
about 0.5 KB each time. A line holds `slot × 0.85 ÷ lines`, between 10 and 90 seconds: about 66 s at
`timeScale` 1 and 22 s at `timeScale` 3. The 3-D view has that long for each at-bat.

The TV window is at most 760×520 CSS pixels, and a 4:3 picture beside the stats rail comes to about
400×300. There's no full-screen or big-screen path for the TV today.

## The look

### High fidelity, presented like a 1990s arcade game

Two layers, kept apart so each can be tuned on its own.

**The game itself is drawn as well as the engine can draw it.** Detailed players and equipment,
authored motion, physically based materials, the light towers as the only lights at night, real
shadows and occlusion, a park full of people and the city beyond it. Nothing is made deliberately
crude.

**The presentation around it borrows the look of a 1990s arcade baseball game.** It's still a
live broadcast on KSAB: nobody plays it, and nothing in the world is a cabinet. Five parts:

- *The graphics package*:
  - slanted panels with chrome rims;
  - names and numbers in chunky lettering with an extruded edge, chrome for names and flame for runs
    and big moments;
  - the count as lamps (three green for balls, two amber for strikes, two red for outs) and lit
    bases;
  - the pitch speed in big digits;
  - a matchup card with a VS badge on a starburst for each plate appearance;
  - the strike zone drawn over the plate with the last pitch marked;
  - a stolen base's card with the runner's count of steals, the pitcher's time to the plate and the
    catcher's pop time.

  All of it is original and drawn at the screen's own resolution, in faces the client already ships:
  Bungee and Bungee Inline for the big words, Big Shoulders Display for names and numbers, Audiowide
  for small labels.
- *Splash words* on the plays that earn them: Strike Three, Home Run, Grand Slam, Double Play, Triple
  Play, Walk-off, Safe, Out. They punch in, hold and clear, with the distance under a home run.
  `tv.js` already names these events in `_applySportsFx` (home run, grand slam, walk-off, extras,
  game win, double play, the final, champion), and the 3-D view draws its own version of each.
- *The leaders table*: between innings and before the first pitch, a high-score table over the live
  picture. Rank, player, club with its colour, home runs, RBI, average and steals, the sort column
  lit, the leader's row in gold, and tonight's game across the foot. It cycles through home runs,
  average, steals and the pitchers' strikeouts. The numbers are the season's own, from the box
  scores the sim already keeps.
- *The camera grammar*:
  - every pitch from the batting view, behind and above the plate, the way the period's arcade games
    framed it; the long-lens centre-field camera stays for replays and as a setting;
  - balls in play cut to high home and follow the ball;
  - home runs get a side-on angle that shows the arc, then a slow replay.
- *Spectacle*: a comet trail on fly balls, a flash at contact, fireworks over the outfield and the
  city on home runs, crowd camera flashes at night, and the scoreboard answering the play. Reduced
  motion turns all of it into still cards.

**The picture is the arcade board's, not broadcast video's.** It has full saturation, deep blacks, a
contrast curve with warm highlights over cool shadows, light sharpening and a soft vignette. An
optional "tube glass" setting adds a period television's scanlines, aperture grille, gently curved
tube and rounded corners, and moves the graphics inside a title-safe area. The second draft's
broadcast picture (lifted blacks, soft colour, the CCD smear) stays as a preset.

### Look-dev

A throwaway WebGL2 page, kept out of the repo, rendered the target in headless Chromium on a software
renderer: seventeen procedural players at about 12,300 triangles each, 4,853 instanced fans at about
420 triangles each, 2.4 million triangles in all, four 2048² tower shadow maps, a 4× MSAA RGBA16F
target, half-resolution ambient occlusion, a 28-tap depth of field, a six-level bloom, and either
the broadcast pass or the arcade grade with its graphics drawn in the client's own faces. The players
are stand-ins built for the review (lofted tubes posed by IK); the plan's own models go well past
them. What it showed:

- **The towers make the look.** Four shadowed lights give each player the overlapping soft shadows of
  a night game, and the spill falling off into the stands keeps the field the brightest thing in the
  picture without a separate grade.
- **Depth of field is worth its cost.** The crowd softens behind the batter in the first-base close-up
  and behind the plate from centre field, the way a broadcast long lens renders it, and it hides how
  simple crowd figures are at close range.
- **A real centre-field camera works.** About 445 ft out and 62 ft up with a 3.7° lens frames
  pitcher, batter, catcher and umpire with the plate clear, and the pitch reads as a few pixels, which
  is what television shows.
- **The front row needs a parapet.** Seat backs hide the legs of each row from the one behind it, but
  the first row needs a wall in front or its fans appear to be standing.
- **At the TV's size** (400×300 CSS pixels, rendered at 2×) players, count and pitch speed read
  clearly; the graphics have to be sized against the sub-screen with minimums, not scaled down from
  a full-screen design.
- **Grass needs restraint.** At grazing angles its specular sheen washes the near field out; a high
  roughness and a low reflectance keep the mowing pattern and the colour.
- **Coldwater works as a backdrop.** A second pass placed all 224 of the city's buildings from
  GLASS's baked shapes around the park's site at true scale. The Spire and Halcyon Towers read at a
  glance, and the blue hour at first pitch is the strongest frame of the set.
- **Outside the walls, a set works better than the map.** At GLASS's scale a ballpark and its stands
  need about 10 tiles by 9, and the map gives the park nine. Bending the map round a full-size park
  kept every bearing but bowed the West Curtain and curved the streets. Composing the city instead (a
  street grid inside straight walls, each building on a plot near its bearing) kept the skyline where
  a viewer expects it, and it reads as a city from every camera, the air included.
- **The main gate wants a corner.** With the ring streets meeting behind home plate, the gate looks
  across a small plaza to a crossing, and the street camera stands across it. A lamp post beside that
  camera's lens filled a third of the frame, so the set keeps tall things 48 ft clear of street-level
  cameras.
- **Inside the Curtain the city is close, so it has to hold up close.** With the park in Halcyon
  Fields the nearest buildings stand just outside the stands, and the towers about 400 ft past the
  outfield wall. A window pattern and dark ground didn't survive that, so the city gained:
  - facades with mullions, lit rooms that are brighter at the ceiling, blinds half down, now and then
    the blue of a television left on, and lobbies and shopfronts on the ground floor;
  - the estate's chrome as dark brushed steel, which catches the floods without going white;
  - streets from each road tile's arms: kerbs, pavement slabs, a double yellow line, broken lane
    lines and crossings at the junctions;
  - cobra-head sodium lamps with pools of light, parked cars at the kerbs and some moving with their
    lights on;
  - about 1,900 people walking to the gates, thick near the main gate and thinning out with distance;
  - the park's own exterior: brick piers, an arcade lit from the concourse, the club level's arched
    windows, an open steel tier under the upper deck, flags along the top and the name over the main
    gate.
- **The floods must not light the city like the field.** The towers' beams aimed at the field also
  reach the towers past the outfield. The city takes a narrower beam and the inverse square, so the
  faces toward the park catch some light and nothing more.
- **GLASS's tablelands are low.** `CLIFF_H` is about half a tile, roughly 30 ft. Drawn any taller,
  the red rock past the West Curtain stood over left field as brown walls.
- **A stolen base reads from the first-base side of second.** A low camera with a 16° lens holds the
  slide, the tag, the dust and the base umpire's call in one frame.
- **The grip needs fists, not tubes.** Hands that wrap the handle with ridged fingers, a thumb, a heel
  and a strap, stacked from the knob, with the hands at the back shoulder, read as holding a bat.
- **Arcade at high definition works.** The chrome-and-flame lettering, lamps and splash words sit
  over a fully lit scene without fighting it, and the client's own faces carry the period.
- **A home run reads side-on.** From behind home the trail foreshortens into a short streak. From
  the first-base side the whole arc shows, falling toward the Spire under the fireworks.
- **Tube glass needs a title-safe area.** The curved tube crops the corners, so the graphics move
  in by a tenth when it's on.
- **A sellout costs triangles.** With every seat filled the look-dev crowd reached about 6 million
  triangles. The real crowd needs its far level and cards for the distant rows (see Performance).
- **The Modelshop's heads make ballplayers.** The street figure's head at level 0, with its face from
  the atlas, replaced the look-dev's painted eggs: brows, irises with catchlights, a nose, lips and
  ears read from a head-and-shoulders portrait out to the first-base camera. Three changes made them
  athletes: a thicker neck and a slightly broader jaw; no makeup layouts and nobody past forty; and
  lips taken halfway back to the skin, because the atlas's lip colour read as lipstick under the
  floods.
- **Headwear has to fit the skull.** Caps and helmets sized as ellipsoids round the old egg covered
  the eyes. Grown off the skull's own surface to a band line, the cap's band sits above the brow and
  the bill shades the eyes without hiding them.

## Using the whole engine

Every capability below already exists unless it's marked new, and each has a job in the park.

| Capability | Where | In the ballpark |
|---|---|---|
| HDR, MSAA, bloom, ACES | `gl/hdr.js` | The frame. Lamps, fireworks and trails bloom. |
| Height fog and light shafts | `gl/fog.js` | Haze over the left-field wall; the towers' beams in it. |
| Ambient occlusion | `gl/ssao.js` | Contact under players, seats and dugouts (needs a matrix variant). |
| Reflection cube, planar mirror | `gl/envcube.js`, `gl/mirror.js` | Helmets and shin guards; puddles on the warning track after rain. |
| Spotlight shadows | `gl/spotshadow.js` (new) | Four towers' shadows. |
| GPU skinning | `gl/skin.js` (new) | The players. |
| Particles | `gl/spectacle.js` (new) | Fireworks, confetti (none exists today), contact sparks, trails. |
| Instanced, animated people | `gl/actors.js`, `actor3d.js` | The crowd. |
| Heads and faces | `actor-head.js`, `actor-faces.js` | Close-ups, and live portraits on the matchup card. |
| Baked cloth | `cloth3d.js` | Bunting, pennants on the light towers, the flag in centre field, rally towels. |
| The city | `building-shapes.js`, `gl/cityscape.js` (new) | The skyline. |
| The Curtain | `gl/curtain.js` | The band of light past the outfield, red in a lockdown. |
| Sky, moon, meteors, aurora | windshield.js keyframes, `moon.js` | The sky on Coldwater's clock; a shooting star in a lull. |
| Weather | `weather-fx.js`, `lightning.js`, lens beads | Rain and acid drizzle, wet dirt, beads on the lens, lightning over the skyline in an ion storm. |
| Birds | `birds.js`, `gl/murmur-gpu.js` | Gulls over the outfield; a starling murmuration at dusk. |
| Fireworks | `drawFireworks`, `plugins/fireworks` | Home runs and the title; the server's show launched from the park on a clinch. |
| Searchlights and sky beams | `skyBeam`, `drawSearchlights` | Sweeping the sky before the final. |
| Lens flare | windshield.js | The light towers into a low camera. |
| Camera flashes, goal-lamp wash, slow replays | Rinkside's `arena.js` and `replay.js` | Flashes in the crowd at night, a red wash on a walk-off, replays. |
| Display faces | `client/shared/fonts` | Bungee, Bungee Inline, Big Shoulders Display, Audiowide, loaded with the view. |
| Seven-segment digits | `SEG7` in `interior-kit.js` | The pitch speed and the scoreboard clock. |
| CRT overlays and bezels | `minigame-common.js` | Tube glass. |
| SIREN | `audio-engine.js` | The bank, the organ through the tracker, a ballpark room. |
| ORACLE | `audio-engine.js` | The announcer's calls, the umpire, the public address, a vendor. |
| Clock, weather, power | `getEnvSnapshot()`, the power sim | The sky, the park's weather, the city's lit windows. |
| The club seam | `club-crest.js` | Sixteen identities. |
| Read Aloud, reduced motion | `settings.js` | Parity and comfort. |
| Dev tools | Voice Lab, the Audio tab, the time-and-weather panel, Modelshop, Studio | Tuning the voice and the bank, look-dev at any hour, the Pose Lab, placing the park. |

Most of GLASS's spectacle (fireworks, explosions, lightning, aurora, lens flare) is painted on the
windshield's 2-D canvas through its Mode-7 projection. The ballpark has its own WebGL2 context, so it
ports what it uses to `gl/spectacle.js` rather than importing the windshield.

## Architecture

### What carries over from Rinkside

| Piece | Carry over? | Notes |
|---|---|---|
| View shell and its five methods | yes | `gameday-grandstand.js` (working name Grandstand). tv.js changes one line: baseball mounts it, and it falls back to the 2-D view on its own. |
| Lazy loading | yes | Heavy modules load on first mount, as Rinkside's do. |
| World stepped on a fixed clock | yes, 120 Hz | Slow-motion replays of a pitch need the sim's fine steps. |
| Director: one payload in, `onLand` out | yes | Stagers per play kind instead of per hockey beat. |
| "Nothing on the field decides anything" | yes | Between beats nobody throws a pitch, since a pitch changes the count. |
| Numbers from names, randomness seeded from the payload | yes | Same rules, same trap: a `rand()` added to the sim replays the season. |
| Camera that never rolls, framing solved from points | yes | Points to frame: ball, fielder, target base. Long moves cut. |
| Camera written out as GL matrices, checked against a pure projection | yes | The arena-smoke pattern. |
| Replay buffer | yes, richer | Bone poses at 60 Hz, ball position and spin. |
| Frame governor with renderer-supplied rungs | yes | Rungs below. |
| Vertex streams, programs prewarm | yes | `stream.js`, `programs.js`. |
| CPU-rebuilt bodies | no | GPU skinning instead (below). |
| Procedural 21-joint rig | partly | Its IK and contact rules carry over; the motion comes from authored clips. |
| Painted ice with dirty tiles | yes, as dirt | The infield keeps the game (below). |
| Mirror pass | no | Grass doesn't reflect. |
| 2-D renderer of the same world | no | The fallback is the existing Gameday view. |
| Smoke gates over a DOM stub | yes | Plus animation-quality and texture-budget gates. |

### Files

| File | Side | What it holds |
|---|---|---|
| `client/game/js/panels/gameday-grandstand.js` | THOMAS | The shell: interface, frame loop, governor, fallback, caption and cards. |
| `client/game/js/panels/diamond/geo.js` | THOMAS | The field in feet, the fence profile read from venue data. |
| `diamond/world.js` | THOMAS | Bodies, the ball, the bases, events, the rituals between beats. |
| `diamond/director.js` | THOMAS | Stages a payload: walk-up, pitches, the play, running, landing, reconciling. |
| `diamond/anim.js` | THOMAS | The clip player: sampling, blending, root motion, IK and contact layers. |
| `diamond/camera.js`, `diamond/replay.js`, `diamond/hud.js` | THOMAS | Shots and cuts; the replay buffer; the arcade graphics package. |
| `diamond/dirt.js` | THOMAS | The infield canvas and what's painted into it. |
| `diamond/board.js` | THOMAS | Which of the scoreboard's lamps are lit: the line score, the count and the names. |
| `gl/ballpark.js` | GLASS | The renderer: passes, lights, materials. Returns null without WebGL2. |
| `gl/ballpark-mesh.js` | GLASS | Pure builders for the park from venue data and for equipment. Node-runnable. |
| `gl/skin.js` | GLASS | GPU skinning: bone palettes in a float texture, four weights a vertex, dual-quaternion option. New to GLASS. |
| `gl/spotshadow.js` | GLASS | Perspective shadow maps for several lights, PCF lookup as a GLSL chunk. New. |
| `gl/crowd.js` | GLASS | The instanced crowd on `actors.js`'s vertex-animation approach. |
| `gl/broadcast.js` | GLASS | Depth of field, the arcade grade and the tube glass, and the broadcast preset (chroma, fringing, smear). |
| `gl/cityscape.js` | GLASS | A city drawn far: buildings from the baked shapes, facades, lights, the Curtain. Names no region. New. |
| `client/shared/city-set.js` | GLASS | Composes the set round a site: the superblock, the street grid, a plot for each building by bearing, filler, straight edges. Pure, so the gate runs it in Node. Names no region. New. |
| `client/shared/building-lights.js` | GLASS data | Generated by the shapes bake: each model's lights. New. |
| `client/shared/sky-keys.js` | THOMAS | The clock's sky keyframes, moved out of `windshield.js` so other views can read them. |
| `gl/spectacle.js` | GLASS | GPU particles: fireworks, confetti, contact sparks, trails. New. |
| `client/shared/audio-engine.js` | THOMAS | SIREN and ORACLE changes: ducking, a limiter, an announcer channel, better noise, pan and sends. |
| `client/shared/deadball-sfx.js` | Architect | The Deadball bank: about 50 cues, the nine in gameday.js among them. |
| `content/animation_clips/*.json` | THOMAS data | The clip library, authored in the Pose Lab (below). |

### The 2-D fallback

With no WebGL2, no `EXT_color_buffer_float`, a shader that won't build or a lost context, the
Grandstand mounts the existing `createGamedayView` in its own host and re-applies the last payload. A
play in progress restarts in 2-D. The 2-D view stays maintained, and Phase 0 gives it a gate.

## Models

### Players

- **One body, many players.** A single topology with blend shapes for build (height, weight,
  shoulders, a pitcher's long frame, a catcher's thick one), chosen from the name so a player looks
  the same all season. Built procedurally the way [actor3d.js](../../client/game/js/panels/actor3d.js)
  builds street figures (lofted torso, limbs as continuous tubes through the joints, so elbows and
  knees bend without seams), then skinned.
- **Levels of detail.** About 18,000 triangles for the close cameras (the batter from first base, the
  pitcher in a replay), 7,000 at broadcast distance, 1,500 for outfielders in the wide shot, chosen by
  projected height the way actors are.
- **Heads and faces.** The street figure's head from the Modelshop work
  ([actor-head.js](../../client/game/js/panels/actor-head.js),
  [street-figure-heads.md](street-figure-heads.md)): a skull whose edge loops sit on the face's
  landmarks, shaped ears, a neck and five hair styles, at its three levels by projected height (L0,
  1,840 triangles, for the close cameras). The face is a layout from the baked atlas
  ([actor-faces.js](../../client/game/js/panels/actor-faces.js)) tinted with the player's own skin,
  hair, lips and eyes by `FACE_GLSL`, the scalp painted to the hairline by `HAIRLINE_GLSL`, as the
  Actor Lab draws them. Under a cap brim at broadcast distance a face is mostly shadow, so the close
  cameras are where faces have to hold up, and the matchup card can carry a live portrait of each
  face. For a ballplayer:
  - the pick comes from the player's name, so a player's face is the same all season, with no makeup
    layouts, nobody past forty and stubble or a beard on about 45%; umpires can be any age;
  - the neck is thicker than the street figure's, most of all at the collar, and the jaw a little
    broader;
  - the lips are taken halfway back to the skin;
  - about 30% wear eye black, an oval smudge on each cheekbone, painted in the face shader rather than
    the atlas;
  - under a cap only the cropped, neat and long styles fit, so the long one shows as a mullet.
- **Uniforms.** Separate meshes for jersey, undershirt, pants, belt, stirrup socks and cleats, cut
  the way the period wore them: pants to below the knee with stirrups showing, or full length by
  player. Jerseys carry pinstripes or flannel weave, piping, a chest wordmark and tackle-twill
  numbers with a stitched edge in a normal map.
- **Wear over a game.** A per-player dirt mask on knees, seat and chest, raised by slides, dives and
  the catcher's crouch, so a uniform in the ninth shows the game.

### Equipment

Every piece of headwear is fitted to the head's own skull, not sized round it: a shell grown off
`skullPoint` a set distance out, down to a band line that runs round the head, so the band sits above
the brow and the eyes show. Caps with a curved bill, a crown in panels, a button and an embroidered
crest, the band at the forehead falling toward the nape. Batting helmets in glossy shell with a padded
inside, an ear flap over the pitcher-side ear that stops behind the cheekbone, a short bill and a
decal. Fielders' gloves with laced webbing,
a first baseman's mitt and the catcher's round mitt. The catcher's helmet, mask, chest protector and
shin guards; the plate umpire's mask and the protector under the shirt. Bats with grain, a darker handle
and the knob. The ball with its red seams in a normal map, so spin reads in a slow-motion replay.

### The park

Field, walls, stands, bleachers, batter's eye, light towers, dugouts, scoreboard and foul poles built
from venue data by `gl/ballpark-mesh.js`, with rows of seats, seat backs, a parapet in front of the
first row, aisles and the crater in section nine from Chip's chatter. Static lighting on the
structure (occlusion under the upper deck, the seats' own shadowing) is baked into vertex colours
when the venue is built. The city around it is the next section's.

### Textures

- **sRGB decoding** for every colour texture (new to GLASS; the city does the conversion in its
  shaders), mipmaps everywhere, anisotropic filtering on the field and the uniforms.
- **Normal and roughness maps**, new to GLASS: fabric weave, numbers and lettering, glove leather,
  ball seams, wall padding, the dirt's grain.
- **The infield keeps the game.** The dirt is one painted canvas, as the rink's ice is: chalk lines
  that cleats scuff, the batter's box dug out over nine innings, the pitcher's landing spot, slide
  marks, footprints, and the grounds crew raking it smooth in the fifth. Only the touched tiles
  upload, the arena's rule.
- **Grass** from a detail texture and the venue's mowing pattern, shaded so the stripes change with
  the camera's direction as real mowing does.
- **Budget**: player and equipment atlases at 2048², one 4096² field canvas pair (colour and
  roughness) where `MAX_TEXTURE_SIZE` allows, 2048 otherwise. About 150 MB of GPU memory at full
  quality, 60 MB on the phone tier.

## Animation

### The rig

About 40 bones: pelvis, three spine, neck, head, clavicles, shoulders, elbows, forearm twist, wrists,
a few finger groups for grips, hips, knees, ankles and toes, plus attachment points for the bat, the
glove and the ball. Four weights a vertex, dual quaternions for the forearm and shoulder so they
don't collapse when twisted.

### The clip library

Authored clips, about 120 to start and about 170 once sim v2 lands:

- *Pitching*: windup and stretch per arm slot (over the top, three-quarter, sidearm), pickoff throws,
  the follow-through, fielding position after the pitch, warm-up tosses.
- *Batting*: stances, the load, swing paths for each contact height and direction, takes, check
  swings, fouls off, the bunt, the follow-through and bat drop, stepping out.
- *Catching and umpiring*: the catcher's setups, receiving and framing, the throw back, blocking; the
  plate umpire's stance, the calls and the punch-out (a few styles, one per umpire); the base
  umpires' safe and out.
- *Fielding*: ready steps timed to the pitch, grounders forehand, backhand and charging, the
  barehanded pickup, fly balls drifting and camping, diving, sliding and leaping catches, the catch
  at the wall, the double-play pivot, throws by distance and from the knees, the sweep and straddle
  tags. With sim v2: the bobble, the ball through the legs, the wild throw, the catcher's throw to
  second from the crouch, the rundown.
- *Running*: leads, the first step, turning a base, slides feet-first (bent-leg and pop-up),
  head-first and hooked away from the tag, the dive back to first on a pickoff, the trot after a home
  run, the walk-off mob. With sim v2: the jump on a steal, the hit batter's walk to first.
- *Between beats*: stepping out, gloves, signs, the mound visit, jogging on and off.

### Layers over the clips

- **IK for every contact.** The glove meets the ball at the catch frame, both hands stay on the bat,
  feet stay where they land, the ball leaves the hand at the release frame.
- **Look-at.** Heads and eyes track the ball.
- **Speed matching.** Runs and drifts pick the cycle and stride that fit the distance and the time
  the director gives them, so the ball and the fielder arrive together.
- **Variation from the name.** Arm slot, leg kick, stance, batting-glove colour, walk-up habits. Stable
  all season, so regular viewers recognise players.
- **Secondary motion.** Jersey and pants flutter in the vertex shader from velocity, caps and helmet
  flaps settle.

### Authoring

There's no motion capture. Clips are keyed in a **Pose Lab**, a new Modelshop page that poses the rig
against reference frames, keys clips, previews them on a player and writes `content/animation_clips/`.
Timings come from published biomechanics (a delivery is about 1.4 s from leg lift to release, arm
acceleration about 50 ms; a swing about 150 ms from launch to contact). The look-dev's six-frame
delivery is the blocking a Pose Lab session starts from.

### Ball flight

A cosmetic path with drag and spin (Magnus), fitted so it ends exactly where the play says: the
pitch at its plate location, a fly at its landing spot. Spin axis and rate by pitch type, so a
four-seamer and a curve look different in slow motion.

## What baseball needs that hockey didn't

### A pitch

The payload already carries everything a pitch needs: type, speed, where it crosses the plate (`x`,
`y`), the result (ball, called strike, swinging strike, foul, in play) and the count after it.

- **Location is exact.** The ball flies from the release point to the payload's `x`, `y` mapped onto
  the plate and the batter's zone. The gate checks every pitch crosses within 0.05 ft of its spot.
- **Speed is real.** 54 ft at 95 mph is 0.39 s; at 75 mph, 0.49 s. Never slow the ball to fit a hold;
  cut rituals instead.
- **Each result has its own picture.** Ball, called strike (with the punch-out on strike three),
  swinging strike, foul (into the screen or the stands, from the pitch's seed), in play.
- **The plot and the picture mirror each other.** The rail's pitch plot is the catcher's view; the
  centre-field camera looks the other way, so a pitch on the plot's left crosses on the screen's
  right. That's how television does it. Don't flip either one to make them agree.
- **Handedness comes from the name.** The server works out bats and throws once and puts them on the
  payload.

### Pacing an at-bat

A pitch with its rituals is about 4 s. The director gets a budget of 0.45 × `hold`, kept between 13 s
(today's figure, and the budget when a payload carries no `hold`) and 26 s, and spends it in this
order: pitches at real speed first, then reactions, then the set, then the throw back. The play
lands, `onLand` fires, the caption and the card go up, and the rest of the hold is replays and dead
time.

The booth keeps one line per at-bat. The rail shows each pitch as it's thrown ("88 SLIDER, swinging,
1-2"), generated from the payload the picture uses. A pitch-by-pitch booth (Chip calling each pitch,
timed by cues the way Cluster Puck's touches are) is a question for you: it's the more authentic
broadcast and about three times the lines in the log.

### The people

Pitcher, catcher, batter and plate umpire are always in the main shot and get the close level of
detail. The seven other fielders play straight-up positions shaded toward the batter's pull side,
with numbers from team and position. Runners take leads, run on contact and slide; the sim's bases
are three booleans, so in v1 runners carry no names (v2 names them; see below). Base coaches, an
on-deck hitter and base umpires dress the field.

### Balls in play

| Kind | What the picture does |
|---|---|
| Groundout | Grounder to the named infielder, fielded, thrown to first ahead of the runner. |
| Flyout, sac fly | Fly to the named outfielder at the named depth, caught. On a sac fly the runner on third tags and scores. |
| Popout | Pop-up to an infielder or the catcher, fair or foul. |
| Single | Through a hole, a liner or a bloop; fielded and thrown to the cutoff. |
| Double | To a gap or down a line, off the wall or rolling to it; a slide into second. |
| Triple | Into a corner or splitting the outfielders, a carom, a slide into third. |
| Home run | Over the fence at the chosen spot; the outfielder goes back to the wall and watches it go. |
| Double play | 6-4-3, 4-6-3 or 5-4-3 as chosen, with the pivot at second. |
| Triple play | Always 5-4-3. Two of the script's four triple-play lines say so (a ground ball to the left side; third, second, first) and the other two don't say where. |
| Productive out | A grounder that moves the runners up. One of the three lines puts it on the right side, so that line airs only when the play goes there. |
| Walk | The bat dropped, a jog to first; forced runners move up. |
| Strikeout | The punch-out or the swing; with nobody on, the infield throws it around the horn. |

### Variety in every play

Thirty games a club means a regular viewer sees every kind of play many times, so no two should
look the same. `synthPlay` decides more than a zone:

- **Direction.** An angle across the field in degrees, not one of a few zones. Spray follows
  handedness: a pull hitter's grounders go to the pull side about three times in five, and fly balls
  spread more evenly. No two grounders to short go to the same spot.
- **Power and trajectory.** An exit speed from about 50 to 115 mph and a launch angle together make
  the kind of contact: a chopper, a grounder, a liner, a fly or a pop-up. Within a kind the speed
  varies, so a single can be a seeing-eye roller, a line drive or a bloop, and a double can split the
  gap or hook down the line into the corner.
- **Fielding grade.** From where the fielder starts and where the ball goes: routine, ranging,
  diving, sliding, leaping at the wall, or over the rail into the stands for a foul pop. Each grade
  has its clips: the backhand, the dive and the throw from the knees, the barehanded pickup on a slow
  roller, the jump at the wall with the glove over the pad. An out that needed a dive gets a replay.
- **Throws.** On the bag, in the dirt and scooped, or wide and pulling the first baseman off the base
  for a hit; the relay through the cutoff; the throw home.
- **Double plays** vary: the turn at second, the shortstop stepping on the bag, 3-6-3 and 1-6-3.
- **Home runs**: the wall-scraper, the no-doubter into the seats, the one off the foul pole, the one
  a leaping outfielder nearly brings back.

### Errors, steals and the rest: sim v2

Today's sim has no errors, stolen bases, pickoffs, wild pitches, passed balls or hit batters. Each of
them changes results, so they come as a second version of the sim, switched on as soon as it's ready
rather than at a new season:

- **Every game is a pure function of its slot**, and much of the system re-simulates past slots
  instead of reading stored results: the standings fold (`broadcast.computeStandings`) walks every
  slot of the season, the recap reel replays the day's earlier games, and team cards replay recent
  form. Swapping the sim in place would rewrite games that have already aired.
- **So the switch is a slot, not a date.** `sportsGameForSlot`, the one function every caller goes
  through, picks the version by slot. Every game before the switch replays as it aired; every game
  from it on plays v2. A season that straddles the switch counts both, which is what happened.
- **The server records the slot (as built).** This plan first put the slot in content, with a push
  guard to refuse a slot that had already aired. That guard couldn't work: the slots come from the
  in-game clock, which lives in the database and staff can skip, so nothing outside the server
  knows which have aired. Instead `@sim 2` in the `.bsm` (`sports_pools.sim.version`) asks for v2,
  and the server writes the first slot of the next in-game day to world_flags the first time it
  sees it. That slot is in the future when it's written and never moves; turning v2 off writes an
  end slot the same way. See [systems-broadcast.md](../systems-broadcast.md#sim-v2).
- **Seeded as the pitches are**, each new draw from `sportsHash` with its own salt, so v1 never
  changes, and the recorded hash of a hundred seeded games still holds for every slot before the
  switch.
- **Runners get names.** A steal depends on who is running, so v2 tracks the player on each base
  instead of three booleans, and a runner's speed comes from the same name hash that already picks
  handedness.
- **What it adds:**
  - errors: a bobble, a ball through the legs, a throw into the stands or past first, and the runners
    taking the extra base;
  - the running game: steals decided by the runner's speed, the pitcher's time to the plate and the
    catcher's arm; caught stealing; pickoffs, and the throw over that the runner beats back; the
    double steal; rundowns;
  - wild pitches and passed balls, the runners moving up;
  - a hit batter and the walk to first.
- **On screen:** each gets its kinds or pitch results in the payload, its pools for the booth, its
  clips (the feet-first, head-first and hook slides; the sweep tag and the straddle tag; the dive
  back to first; the catcher's throw from the crouch; the base umpire's safe and out) and its
  graphics (the stolen-base card, an E in the line score).
- **The box score** gains E, SB and CS.

### Running the bases and keeping in step with the sim

Runners follow the payload's `moves`, each runner's and the batter's fate, which Phase 0 works out
from `basesBefore`, `basesAfter`, the kind and the change in the batting side's score, not `rbi` (a
run scores on a double play with no RBI). Sim v2 hands over its own. The booth doesn't
call every at-bat, so the field the picture is showing and the next payload often disagree. When
they do, the director cuts to a crowd shot or the wide camera, places everyone, and cuts back.
Rinkside's rule applies: anything that moves a player farther than they could run happens on a cut.
The half-inning payload changes sides: one team jogs off, the other takes the field, the new pitcher
throws warm-up pitches.

### Home runs and the fence

The fence comes from the venue data. A home run's landing spot is chosen beyond it, and the gate
checks it lands there. The distance graphic is computed from that spot. A walk-off gets the mob at
home plate.

### Cameras

| Shot | When |
|---|---|
| Batting view | Every pitch, as the period's arcade games framed it: behind and above the plate, the pitcher and the city beyond. |
| Centre field, long lens | Replays and close plays, and every pitch when the batting view is off. About 445 ft out and 62 ft up, offset to left-centre. |
| High home | Balls in play: follows the ball, then frames the fielder and the base. |
| Fly-ball follow | Long flies, from behind the fielder as the ball comes down. |
| First- and third-base cameras | Close-ups of the batter and the pitcher; plays at first and double plays. |
| Low home | Walk-ups, plays at the plate, the walk-off mob. |
| Cutaways | Crowd, dugout, scoreboard, the light towers, the haze. Dead time and reconciling cuts. |
| Skyline | Back from a break and between innings: high behind home with the city beyond, or the long lens on the Spire over right-centre. |
| The bag | Steals, pickoffs and close plays at a base: low, on the side the runner comes from, with a 16° lens. |
| Street | Before the first pitch: the main gate from the corner of Sorrel Way and Kettle Lane, with the crowd going in. |
| Replay | Reverse angles, slow motion with the ball's spin. |

The camera never rolls; a big move is a cut; framing is solved from the points that must be seen.
Focus follows the subject, and depth of field is set per shot from the lens.

### Between beats and replays

A hold is mostly dead time, which is real baseball. The world fills it with things that decide
nothing: stepping out, signs, a throw over to first that the runner beats back, a mound visit, the
on-deck hitter, the crowd, cutaways. Home runs, double and triple plays, triples, walk-offs and close
plays get a slow-motion replay from a second angle under a Replay bug in the arcade lettering.

## Lighting and the frame

At night the six light towers are the only lights. Each is a bank of lamps, and the venue says which
lamps work: Chip says the lights work about sixty percent of the time, so dead lamps are part of the
park and each tower's output follows its live count.

The frame, in order:

1. **Shadows.** Four spotlight shadow maps (2048², the nearest towers to the play), players and the
   ball only, 12-tap PCF. The field and stands take their static shading from the bake.
2. **Depth prepass** at full resolution, for occlusion and the lens.
3. **Main pass** into `hdr.js`'s RGBA16F target with 4× MSAA: sky, city, park, players, crowd, then
   the backstop netting, steam, the Curtain, beams, trails and fireworks (additive), and the ball's
   motion blur.
4. **Ambient occlusion** at half resolution from the depth, blurred.
5. **Depth of field** from the depth and the shot's focus, before the tone curve.
6. **Bloom** on the lamps, fireworks, trails and the bright uniforms.
7. **Tone curve** (ACES, as `hdr.js` has) and the arcade grade: saturation, the contrast curve, light
   sharpening, the vignette. Then the tube glass, if it's on. The broadcast preset swaps in the
   second draft's pass.
8. **Graphics** on a 2-D canvas at the screen's resolution.

Materials are GGX with roughness by surface: matte cloth with a sheen, skin with a wrap for light
through it, glossy helmets and shin guards with the reflection cube, leather, wood, chalk, wet and dry
dirt. Fog is `fog.js`'s height fog with its light-shaft in-scatter, so the towers glow in the haze
over the left-field wall.

Unlike the city's shaders, which saturate at 1.0 (so only emissive decals bloom there), the
ballpark lights in real HDR values, so bloom and the tone curve have something to work with.

## Coldwater beyond the outfield

### Where the park stands

Halcyon Field stands inside the Curtain, in Halcyon Fields, the Glasshouse's own estate, built in
one campaign in a deliberately narrow palette ([halcyon-fields-infill.md](halcyon-fields-infill.md)).

**On the map it's a block of nine tiles:** x 895 to 897, y 911 to 913, the middle of the north half
of the estate's central block.

- **Six buildings and Vetch Green.** Going Concern, Course Correction and Plot Twist along Halcyon
  Boulevard; Fixed Assets, Grounds for Concern and Fit for Purpose along Sorrel Way; and the three
  tiles of Vetch Green between them. None is in the Glasshouse district and none has a Modelshop
  model. They hold 11 rooms, 4 NPCs and 31 pieces of furniture, all self-contained: nothing else in
  the repo points at them. They're set aside for later use (see *The park on the map*).
- **No street closes.** The block is bounded by Halcyon Boulevard to the north and Sorrel Way to the
  south, with Vested Interest, Terms Agreed and Artist's Impression to the west and Salad Days and
  Second Wind to the east, all of which keep their doors.
- **Home plate** sits at tile (897.55, 913.55), near the block's south-east corner, with centre field
  on a compass bearing of 315°, so the foul lines run along the tile grid. The site is content:
  `sports_pools.venue.site` is `{ x, y, bearing, block }`.
- **Why so small.** A storey is 3.5 m, so a tile is about 17.9 m (58.6 ft, as
  [glass-notes.md](../reference/glass-notes.md) has it), and a full ballpark with its stands needs
  about 10 tiles by 9: the first site at that scale took 41 buildings. GLASS already draws every
  landmark compressed on the map (a 21-storey office stands on one tile), so the park does the same:
  the map's model is a compact bowl fitted to its nine tiles.

### On TV the city is a set

The broadcast's park is full size, so it can't sit in the map's nine tiles, and what the cameras
show outside its walls is an abstraction: a city composed for television from the map's buildings,
not a copy of the map. A first try bent the map round the full-size park instead. It kept every
building's bearing, but the West Curtain bowed and the streets curved, and from the air it looked
wrong. A set keeps what a viewer reads (the landmarks over the outfield, the Curtain round the city,
the bay to the north) and lays out the rest cleanly.

It's composed from three inputs:

- the park's outline at full size, from the park model;
- the buildings within reach of the site, from the manifest under *What it costs*;
- the distances from home plate to the West, South and East Curtains and to the shore, from the map.

And six rules:

1. **The park stands in a superblock**, the tiles its outline touches. Between the park's walls and
   the streets round it is a paved plaza, with lamp standards along the walls and the crowd thick at
   the gates.
2. **Streets run every third tile** out from the superblock on each side, so a block is two plots by
   two. The ring streets meet behind home plate, so the main gate looks across the plaza to a
   corner.
3. **The edges are straight.** The three Curtain walls and the shore stand at the map's distances,
   pushed out past the park like everything else (rule 4) and put on tile lines, so the city is a
   rectangle. A lane runs inside the South Curtain and a road along the shore. Past the walls is red
   rock to the horizon; past the shore, the bay.
4. **Each building gets a plot near its bearing.** Its target is its place on the map, pushed out
   along its bearing from home plate by the difference, in that direction, between the full park's
   outline and the block's edge, so nothing lands inside the park. Nearest first, each takes the
   free plot closest to its target. Piers and landing stages stay on the water, as far off the set's
   shore as they stand off the map's, and buildings outside the Curtain stay outside it.
5. **Plots no building claims get filler**: plain blocks in the quarter's style, chrome and glass to
   the west, brick and works to the east, lower near the park.
6. **The set is dressed for its cameras.** Nothing tall stands within 48 ft of a street-level
   camera.

Composing is a pure function of those inputs, so every client builds the same set and a gate checks
it in Node. In the look-dev it placed all 218 buildings within reach and filled 129 plots. Bearings
moved by 1.6° at the median; the worst within 900 ft was 22°, Fairweather Marina on the waterfront,
where the straight shore takes up the slack. The Spire, about 510 ft from home plate on the map,
stands about 790 ft away on TV.

From home plate on TV:

- **Over centre field**, the Spire and the Shrine, with Top Brass in front of them and the Ascension
  Gate to their right.
- **Over right-centre and right**, Halcyon Towers and Voltage's sky beam, with the boulevard's towers
  (Rising Sums, Bent Double, Curve Appeal) in front.
- **Over left-centre and left**, the estate's tower row along the West Curtain (Common Ground, Rising
  Damp, Quiet Enjoyment), with the Curtain's glow behind them; Long Lease and Light Relief stand past
  the third-base stands.
- **Behind the plate**, the corner outside the main gate, Chain Free and the rest of the estate, then
  the South Curtain.

The scoreboard stands on legs behind the right-centre bleachers.

The set and the map needn't agree beyond those bearings. The map is where players walk, ride and fly,
and it has its own compact park (*The park on the map*); the set is only ever seen on TV.

### Drawing the city

**The buildings are GLASS's own shapes.** [building-shapes.js](../../client/shared/building-shapes.js)
holds every Coldwater building as segments captured from the windshield's models, each value an
affine `a·fh + b·h + c`. The cold open already draws the real city from it as a wireframe without
importing `windshield.js` ([world-rendering.md](../reference/world-rendering.md)). A new
`gl/cityscape.js` does the same in solid form:

- It reads a manifest of buildings (tile, type, floors, name, entrance) and resolves each with
  `shapeFor`, sized by [skyline-scale.js](../../client/shared/skyline-scale.js). The windshield's
  per-tile jitter (`buildingScaleFor`) moves into that module too, so a tower is the same height on
  the TV as from the cockpit.
- It skips the buildings on the park's block (until Phase 6 sets them aside, the manifest still
  carries them), composes the set as above with `client/shared/city-set.js`, and stands each
  building on its plot.
- It builds one static vertex buffer when the venue loads. Each frame sets uniforms and nothing else.
- In the look-dev all 218 buildings within reach resolved, and with the set's streets, about 900
  lamps, 1,750 cars and 1,900 people, the city came to about 240,000 triangles.

**Facades are drawn by one shader** from bay and storey coordinates:

- Each building has a style: glass, chrome, concrete, brick, works, grow light, Ascendant stone, or
  unlit for Old Coldwater. West is glass and money and east is brick and work, as
  [building-styles.md](../reference/building-styles.md) has it, and the estate's chrome is dark
  brushed steel.
- Windows have mullions, two or three panes to a bay.
- A share of windows is lit. Offices light a floor zone at a time; homes light window by window. A lit
  room is brighter near its ceiling, some have a blind half down, and now and then one shows the blue
  of a television left on. The ground floor is lobbies and shopfronts, mostly lit.
- Once a window is smaller than a pixel, the pattern is averaged to its mean colour, so far towers
  don't shimmer.

**Streets.** Each of the set's road tiles is drawn from its arms, the road tiles beside it:
carriageway and pavement, a pale kerb, slabs about five feet square, a double yellow line and broken
lane lines on straight tiles, and crossings on every arm of a junction. Plots and the plaza are
paved.

**Lights.**

- Cobra-head sodium lamps stand on the pavements, two a tile, staggered across the road, each with a
  pool of light on the ground beneath it.
- Aircraft beacons go on the tall roofs.
- GLASS's models give the city a night signature: the Spire's blue corner runners, Halcyon Towers'
  cyan and magenta edges, KSAB's mast lights, the Beacon's beam, the sky beams over the Glasshouse,
  steam from the Yards' cooling towers and smoke from Ash Management's chimney.
- The baked shapes carry no lights. Phase 4 extends `scripts/shapes/bake.mjs` to record each model's
  lights beside its geometry into a generated `client/shared/building-lights.js`: a position as
  affine triples, a colour, and a kind (steady, blinking, beam, neon). The cold open and any far
  view then get the same lights without the windshield.
- The park's floods reach the city through a narrower beam and the inverse square, so the faces
  toward the park catch some light and no more.

**Life on the streets.** On a game night the streets near the park carry parked cars at the kerbs,
some moving with their lights on, and people walking to the gates: thick by the main gate, thinning
out with distance. They're the same instanced figures as the crowd, so they cost one draw.

**The park's own exterior.** Its outline is a brick wall in the manner of the city ballparks of the
early 1990s: piers, a ground arcade lit from the concourse, the club level's arched windows, an
open steel tier under the upper deck with its ceiling lamps showing, cast-stone bands and a
cornice, flags along the top, and the name over the main gate behind home plate. Round the outfield
it drops to the bleachers' height. From inside the park its back is plain.

**The Curtain** is the set's three walls, drawn with
[gl/curtain.js](../../client/game/js/panels/gl/curtain.js)'s shader at `CURTAIN_H`: its four-stop
body, scan bands, rain streaks and crown line.

**Ground and sea.** Past the walls the ground is red rock, flat to the horizon. Past the shore is the
bay, dark water, with the quay's face where the city stops.

**Tuning.** The searchlights and the Curtain come well down from their windshield strengths, because
the field has to stay the brightest thing in the picture.

### Coldwater's clock and weather

- **The sky follows the world clock** (`getEnvSnapshot()` on the client). It uses GLASS's sky
  keyframes (sunset at 18.5 h, the blue hour at 19.1 h, full night from 20:00), and the sun's
  azimuth is taken against the park's bearing. The keyframes live in `windshield.js` today and move
  to a shared module, so the ballpark doesn't import the windshield.
- **First pitch is in the blue hour.** The script sets Deadball's airtime at 19:00 (its playlist
  slot opens at 18:00). At 19:00 the west is still lit over left field, the windows are coming on
  and the light towers are already doing the work. By the third inning it's full night.
- **The night sky carries Coldwater's glow** from the region grade (`[255, 96, 168]`, kept faint),
  so the broadcast's night matches the windshield's.
- **Weather is the park's own.** Rain falls only under a weather cell, so the server adds the venue
  tile's weather word and precipitation to each payload, read from the in-memory cells `skyState`
  uses. Haze, rain on the lens, wet dirt and a dimmer city follow it, and an ion storm puts lightning
  over the skyline.
- **Power, optional.** GLASS lights windows by each tile's power from the power sim. A small
  per-district mask, sent only when it changes, would let a brownout dim its part of the skyline.

### What it costs

- **Data.** The manifest is what the cold open already sends (`coldwaterSkyline()` in
  [plugins/prologue/index.js](../../plugins/prologue/index.js)): 224 buildings, about 15 KB as JSON
  and 4 KB gzipped, plus the four distances that place the set's edges. The set makes its own
  streets, so no road tiles go with it. It goes with the venue once per client per content revision,
  inside the venue's 64 KB budget. The server helper that builds it takes a site and a radius and
  names no region; the prologue's function becomes one of its callers.
- **Code.** `building-shapes.js` is 284 KB (31 KB gzipped). It loads with the ballpark's modules on
  first mount, and the browser caches it.
- **GPU.** One static buffer of about 240,000 triangles in four draws: facades and streets, lights,
  the lamps' pools, and the glow of the Curtain and beams. The people walking in share the crowd's
  instancing. The facade shader is the only real per-pixel cost, and the city covers a third of the
  frame at most.
- **Server.** No query and no hot path. The manifest is built from the in-memory world when the
  venue loads, then cached. The payload's weather comes from the in-memory cells.

## Playoffs

### What the league has

- **One game.** After a 30-day regular season (240 slots, 30 games a team), the top two meet in a
  single final (`seedFinal` and the crowning in
  [plugins/sportsleague/index.js](../../plugins/sportsleague/index.js)). There's no bracket and no
  series. Cluster Puck's Coldwater Cup works the same way.
- **What the final gets today:** a "Winner Takes the Season" card, a champion's card with the trophy,
  a TV-guide label, the tablet's Championship phase and news headlines. It skips the recap reel and
  the standings flash.
- **The name.** The script and the TV cards call it the World Series, which is Major League
  Baseball's mark. The graphics here use an original name, Curtain Call, as a placeholder, and the
  script and cards should follow whatever name is chosen.
- **Three bugs to fix on the way** (Phase 5):
  - the final's slot ignores KSAB's Monday, Wednesday and Friday mask, so some finals are crowned
    without airing;
  - the #1 seed plays as the away team;
  - the news generator hardcodes Deadball, so a Coldwater Cup final is announced as a Deadball one.

### The final's presentation

- **Graphics in gold.** The score panel turns gold with the final's name, the seeds and "One Game".
  The banner across the foot of the picture reads "Winner Takes the Season", the line the show
  already uses. Splash words get a gold variant.
- **The park dressed for it.**
  - The final's logo is painted behind the plate and on the foul lines, as a decal over the grass.
  - Fan bunting hangs along the upper deck's fascia (`cloth3d.js`), with pennants on the light
    towers.
  - Every seat is sold, and the crowd waves rally towels (a held-cloth crowd clip).
- **Before the first pitch:** searchlights sweep the sky over the city, the public address
  introduces both line-ups with a card for each player, and the organ plays an original league
  anthem through the tracker.
- **The last out:**
  - a freeze-frame, then "Champions" in flame lettering with the club's crest;
  - confetti from the upper deck (new particles), and fireworks over the outfield and the city;
  - the dogpile on the mound (two clips), the trophy (a new model) and the most valuable player's
    card.

  `plugins/fireworks` can launch the server's show from the park, so the city sees it too.
- **Around it:** no recap reel and no standings flash, as now. Until the next season opens, the
  leaders table closes on the champion's card and the final's line score.

### A longer postseason, optional

A bracket fits the sim without touching the regular season: the top four, semifinals best of three,
a final best of five.

- **Seeding the games.** Postseason games go through the override path the final already uses,
  salted per game number (for example `sportsHash(slot, 0x77, n)`). The standings never pass an
  override, so they stay as they are.
- **What it needs:** series columns on the season row, and a schedule that puts games on KSAB's air
  days.
- **Its graphics:** a lamp per win under each team, a "Game 5" badge, an elimination banner and a
  bracket card between games.

Whether to build it is a question below.

### What the payload needs

`season`, once a game: its number, `phase` (regular or final) and both seeds. It's a key of its own
because a payload's own `phase` already marks a half-inning break. A series would add the game
number and the series score.

## A place in the world

### The park on the map

Today the park exists only on television. Putting it on the map:

- **The site** is the nine tiles above, inside the walls: no radiation, no spawns, no street closed
  and nothing that crosses the Curtain.
- **The six buildings and Vetch Green are set aside for later use, not deleted.** Deleting a content
  file deletes its row on the next deploy and silently orphans any player row that points at it, so
  every file stays in the tree.
  - Each tile moves off the world map onto a holding map, `map_set_aside`, laid out on a grid of its
    own. It keeps its id, name, prose, flags and door, and its interiors, furniture and connections
    come with it untouched. Nothing on the holding map connects to the world.
  - The park's tiles take new ids (`zone_ballpark_<x>_<y>`), so no building's identity is
    overwritten.
  - The NPCs who live or work inside are set aside with their buildings: a `set_aside` flag the NPC
    scheduler reads keeps them in their rooms with their routines paused, so nobody tries to walk to
    an ATM from a building that isn't on the map.
  - Before the move, a check lists player rows that point into those zones (respawn points, rented
    rooms, items left on the floor, mail) and a one-shot moves each to the nearest estate building.
  - The GLASS models stay in `halcyon-fields.js`, bound by name, and the shapes bake keeps their
    entries, so a building that comes back looks the same.
  - A building comes back by moving its tile onto a new plot and reconnecting its door.
- **The park's own rooms are new**: the concourse, the club level, the ticket office, the press box
  and the bars.
- **Getting there is a walk.** The main gate behind home plate opens onto Sorrel Way a step from
  Kettle Lane, and the bleacher gate onto Halcyon Boulevard. Both streets keep running past the park.
- **The tiles.**
  - A new `ballpark` building type gets its `TYPE_FLOORS` row.
  - The gates and turnstiles are entrance tiles with their connections. The concourse, the seating
    sections, the club level and the press box are interior zones.
  - The tiles keep `district: 'halcyon_fields'`.
  - `sitecheck.mjs` checks every gate's street access, as it does for any plot.
- **The model.** No GLASS model draws across tiles; each arm gets only its own tile.
  - The closest precedent is the South Lock: the server flood-fills up to 64 `gate_lock` tiles into
    one hall and tells each tile which slice to draw.
  - The park takes the same route with a `ballpark` fill of nine tiles, well under the cap. Each
    tile draws its slice of a compact bowl fitted to the block: the field, the stands, the exterior
    and the six towers, at the map's compressed scale.
  - The shapes bake records it, so the cold open, collision and the skyline see it too.
- **Game nights.** A cell bit derived from `broadcast.getNextOnAir` switches the light towers on.
  - It follows the lockdown's red lamps and the anti-aircraft batteries' state, which both work this
    way.
  - Only lights can change per tile, not geometry, and open freelook views need the bit pushed to
    them.
  - From the streets the floods glow over the stands; from the air the park is a bright bowl in the
    Curtain's south-west corner.

### Watching in person

A seat can't be a vantage, because a vantage always opens the city view over its own tile. The TV
route can open a different scene. So a seat is a `broadcast_receiver`-style fixture, as Reel
Estate's cinema screen is.

- It opens the 3-D view from that section's camera, with no broadcast graphics.
- The public address and the crowd are heard live.
- Tickets are bought at the turnstile, and a foul ball into your section could become an item.

This is the largest piece of the place-in-the-world work and comes last.

## Server changes

### What the payload has and what's missing

| Needed by the 3-D view | Today | Change |
|---|---|---|
| Teams, abbreviations, inning, half, outs, score | yes | none |
| Batter, pitcher | yes | none |
| Kind, `basesBefore`, `basesAfter`, `rbi`, `walkoff` | yes | none |
| Pitches with type, speed, location, result, count | yes | none |
| Line score | yes | none |
| `sport` | missing (tv.js treats "no sport" as baseball) | add `sport: 'baseball'` |
| Where the ball goes and who fields it | derived on the client from a hash, so it can contradict the line | add `play`, chosen on the server |
| Bats and throws | missing | add `bats`, `throws`, from the names |
| How long the line holds | missing | add `hold` (ms) |
| Club identity stamp | missing | add `clubsRev` once Deadball has clubs |
| Standings | the same 8 rows on every payload | send once a game (first payload and catch-up) |
| Where the park stands and the city around it | none | `venue.site` and the skyline manifest, with the venue |
| Weather at the park | missing | add `wx`: the venue tile's weather word and precipitation |
| Season phase and seeds | missing | add `season`: its number, `phase` and both seeds, once a game |

### The play, and lines that agree with it

The booth's lines name directions: "rolls out to the right side", "laces one to the wall", "splits
the outfielders", "around the horn: third, second, first". The 2-D view's hashed trajectory ignores
them, so today the picture and the line can disagree. Hockey solved the same problem by having the
narrator decide cosmetic facts so the line and the picture agree.

- **`synthPlay(seed, kind, bases, bats)`** in baseball.js returns the cosmetic play: the zone, the
  trajectory, the depth, the fielders in order (`[6, 4, 3]`), a landing spot for a home run. It's
  seeded from `sportsHash` with its own salt, like the pitches, and never touches the sim's random
  stream, so no game in the season changes.
- **Pools gain optional direction suffixes.** `atbat.groundout.right`, `atbat.double.wall`,
  `atbat.single.gap` and so on, falling back to the bare pool. The assembler picks the play first,
  then a line from the matching suffixed pool if it has any, else from the bare pool. No `.bsm`
  syntax changes; only pool keys.
- **The bare pools must be direction-free.** A regress check reads every bare pool for direction
  words (left, right, centre, gap, wall, line, deep, shallow, short, around the horn) and fails on
  one. The current lines that name a direction move into suffixed pools.

**As built (3a).** `synthPlay(seed, kind, o)` decides more than the zone: the spray in degrees, the
exit speed and launch angle, the fielding grade and the throw, judged on the field in
[diamond/play.js](../../client/game/js/panels/diamond/play.js), which the 3-D park reads too. Two
things changed from the above. A suffixed pool's lines join the bare pool's in one draw instead of
replacing them, so a play's direction line airs often without crowding the rest out; the bare pool
has to be true of every play either way. And the check reads more than direction: the contact (a
liner, a chopper), the catch (routine, diving, at the wall) and the slide are also things only some
plays of a kind show, so they're tags too. See
[bsm-format.md](../bsm-format.md#lines-that-agree-with-the-play-baseball).

### Egress and read tiers

Nothing here touches a hot path or adds a query. The graph is assembled once per slot and cached
(`getSportsGraph`); everything new is computed during assembly from data already in memory. The club
set and the venue come from the broadcast row the script is loaded from.

Per viewer with the sub-screen open, per game:

| | Today | After |
|---|---|---|
| Standings | about 87 × 0.5 KB = 43 KB | about 0.5 KB |
| Play, handedness, hold, sport | none | about 87 × 0.1 KB = 9 KB |
| Weather at the park | none | about 87 × 40 bytes = 3.5 KB |
| The men's lines and the leaders (built in 1d) | none | about 87 × 37 bytes + 1.6 KB once = 4.8 KB |
| Everything else | about 70 KB | about 70 KB |
| Total | about 115 KB | about 88 KB |
| Club set and venue, with the skyline manifest | none | once per client per revision, held under 64 KB (the venue with its manifest is 18 KB, 5 KB gzipped, built in 1e) |

The rendering's weight is all on the client: textures and clips ship with the client code, not per
broadcast. The CPhL's eight clubs are 57 KB as data, mostly crest paths; Deadball's sixteen get a size
budget and simpler crests.

## Engine and content

Applying [the litmus tests](engine-plugin-boundary.md#litmus-tests-apply-in-order): would a second
game built on THOMAS keep it byte-for-byte?

| Piece | Side | Why |
|---|---|---|
| `gl/skin.js`, `gl/spotshadow.js`, `gl/broadcast.js`, `gl/crowd.js` | GLASS (engine) | General capabilities: skinning, spotlight shadows, a lens and period pictures, a crowd. Any view could use them. |
| `gl/ballpark.js`, `gl/ballpark-mesh.js` | GLASS (engine) | Draw a baseball park and players from data; they mustn't name Deadball, Coldwater or a club. |
| `gl/cityscape.js`, `city-set.js`, the light bake, `sky-keys.js` | GLASS and THOMAS (engine) | Any city set round any site, from shapes, a manifest and four edges. A second game's city works the same way. |
| The skyline manifest helper | THOMAS (engine) | Builds the buildings around a site and radius from the in-memory world; names no region. |
| The park's site and bearing | Architect (content) | `sports_pools.venue.site`. |
| The arcade graphics package and the particles | THOMAS and GLASS (engine) | `diamond/hud.js` draws panels, lamps, cards and splash words from a theme, and `gl/spectacle.js` draws particles. Neither names Deadball. |
| The package's theme: words, colours, faces, the final's gold | Architect (content) | With the venue and club data. |
| The postseason format | broadcast plugin | The sport module and `plugins/sportsleague`. |
| Sim v2: errors, steals, pickoffs, wild pitches, hit batters, named runners | broadcast plugin | `baseball.js`, chosen by slot in `sportsGameForSlot`. |
| Whether Deadball plays sim v2 | Architect (content) | `@sim 2` in `baseball.bsm`, compiled to `sports_pools.sim.version`; the server records the slot (world_flags). |
| SIREN and ORACLE changes | THOMAS (engine) | Ducking, the announcer channel, better noise, pan and sends help every view. |
| The bank, the call words, the announcer's voice | Architect (content) | `deadball-sfx.js`, the words, a Voice Lab preset. |
| The park on the map and the seats | Architect (content) | Zones, connections, furniture and a model arm in the region's file. The game-night cell bit is engine. |
| `panels/diamond/`, `gameday-grandstand.js`, the clip library | THOMAS (engine) | Baseball, not Deadball: a second game with a baseball broadcast keeps them. |
| `baseball.js` including `synthPlay` | broadcast plugin | The sport module, as now. |
| The venue: fence, walls, signs, scoreboard, towers and their dead lamps, the haze, the crater | Architect (content) | `sports_pools.venue`, written by the build script and served with the club set. |
| The broadcast-picture preset and its default strength | Architect (content) | Deadball's art direction. Defaults live in code. |
| Clubs: colours, caps, uniforms, crests, wordmarks | Architect (content) | `sports_pools.clubs`, through the existing seam. |
| Lines and pools; the sound bank's presets | Architect (content) | As now. |

Two existing leaks not to copy: Rinkside's sponsor names (`HOARDINGS` in `rink/textures.js`) and the
2-D view's "DEADBALL · GAMEDAY" and "◆ Chip Vega" strings are content inside engine files.

### Should Deadball's clubs use the seam?

Yes. Identities are what make a high-fidelity picture read as a league rather than a demo, and the
seam is already sport-neutral on the client and proven by Rinkside. Baseball's convention fits it:
`kit.home` is whites with club trim, `kit.road` is greys, and the cap and helmet carry the colour and
the crest. Crests and wordmarks are painted from the vector data at the resolution a close-up needs,
which is where vector crests pay off. Until then, kits are hashed from team names, as Rinkside's
fallback does.

What it takes: `scripts/content/build-deadball-clubs.mjs` for sixteen clubs with a `--check` gate and
a size budget; `clubsRevOf` moved out of hockey.js to a shared module; `sendTvClubs` told the sport;
`clubsRev` on Deadball's payloads. Baseball kit fields: jersey, fabric (pinstripe, flannel, plain),
trim, pants, cap, bill, helmet, undershirt, stirrups, number and edge, chest wordmark.

## Text parity and accessibility

- **The line and the picture agree**, by construction and by test. Baseball gets the parity rule
  hockey has.
- **Every pitch is text** in the rail's ticker, generated from the same data the picture draws, in a
  polite `aria-live` region a player can switch off.
- **Read Aloud speaks on landing**, as both views do now.
- **Reduced motion**, read from `prefersReducedMotion()` each time: no camera moves (hard cuts
  between still shots), no lens breathing, no shake, no cut flashes, no trails, fireworks or
  confetti, splash words shown still, no smear, replays as stills with the play described.
- **Splash words are text too.** Each one is also a line in the rail, and the announcer's calls
  follow the same rule as the booth's lines: what's said is what's shown.
- **No flashing.** Dead lamps stay dead; any flicker, the crowd's camera flashes and the fireworks
  included, stays under three flashes a second.
- **The canvases are labelled**; the graphics canvas is `aria-hidden`, since everything on it is also
  in the rail or the header.
- **Colour isn't the only signal**: abbreviations beside every chip, home whites and road greys
  different in lightness.

## Sound: the announcer on top

### What the engine does today

This is `main`. The `siren-fidelity` branch has since built the fixes (see below).

- **Five buses** (music, sfx, ambient, tv and ui) feed a plain master gain with no limiter.
  - Players set a slider per bus.
  - The defaults are master 0.40, music 0.40, and sfx, ambient and tv 0.25.
- **Nothing ducks for speech.** The only duck is `duckLoop`, which dips the rain and wind beds under
  thunder.
- **Speech** goes to the tv bus at a fixed level, through its own compressor.
  - There's one global voice: each `speak()` cancels the last.
  - Every typed command cancels speech, even with Read Aloud off.
  - Broadcasts are silent unless the TV's read button is on.
- **The 2-D Gameday** plays nine inline cues on the tv bus, sharing it with the voice.
- **Fidelity limits:**
  - noise is one 2-second mono buffer, always started at its beginning, so layered noise is
    identical and long beds repeat every two seconds;
  - filter gain is never read, so shelf and peaking filters do nothing;
  - there's no per-layer pan and no per-cue reverb send;
  - the reverb room follows the listener's zone, not the scene on screen.

### The mix

| Layer | Level | While the announcer speaks |
|---|---|---|
| The announcer (ORACLE) | 0 dB, the reference | |
| The umpire's calls and the public address | -3 dB | |
| Effects: bat, leather, ball, running, the graphics' stings | -9 dB | ducked a further 6 dB |
| Music: the organ and the jingles | -12 dB | ducked a further 6 dB |
| The crowd bed and the park's ambience | -14 dB | ducked a further 4 dB |

The duck is the branch's `duck()`, driven by `speak({ duck })` for the line's length: 60 ms down,
held, then 350 ms back up. A shout can also duck the crowd bed through a cue's `config.duck`. The
levels are defaults to set by ear in the sandbox. The player's TV slider still scales everything,
and Sound Detail still decides what plays.

### Engine work in SIREN and ORACLE

Split off into its own plan, [siren-fidelity.md](siren-fidelity.md), and built on the
`siren-fidelity` branch in six commits, with its regress green. It isn't merged.

- A brickwall limiter on the master, and `duck(buses, dB, { attack, hold, release })` per bus.
- Two speech channels, `tv` and `ui`: typing cancels only Read Aloud, and Read Aloud ducks the TV
  by 12 dB instead of cutting it off.
- `setTvBalance({ voiceDb, fxDb })` for the announcer and the effects under one TV slider, with a
  `tv_fx` category.
- Eight-second stereo noise in white, pink and brown with seeded offsets; `filter.gain` read for
  peaking and shelf filters; per-layer `pan` and per-cue `send`; `setRoom('ballpark')`, a short
  open-air room with a slap-back at 120 ms.
- Voice Lab voices saved as `audio_instruments` rows, and an Audio tab that edits every layer field.
- Eight new gates in the `audio` group.

Still open: nothing in the game reads saved voices yet, and the levels need setting by ear. The bank
below is built on this.

### The bank

`client/shared/deadball-sfx.js` follows the `hockey-sfx.js` pattern (`def`, `variant`, group
`deadball`) and loads before `sfx-catalog.js`. It holds about 50 cues, each built from several
layers and seeded per event, so no two cracks are the same:

- **Contact:** the barrel's crack, the end of the bat, a jam off the handle, a foul tip, a bunt, a
  broken bat. The wood's body modes come from `formants`, the crack from shaped noise and the ring
  from FM.
- **Leather:** the catcher's mitt pop, a fielder's glove, the first baseman's stretch, the tag, a
  pickoff throw slapping into the glove.
- **The ball:** a short hop on the dirt, a roll on the grass, the padded wall, the foul pole's ring,
  the backstop net, a clatter in the seats.
- **Running:** cleats on dirt, a slide, a dive back to the bag, a dive for a liner, a collision at the
  plate.
- **Sim v2's plays:** a ball in the dirt on a wild pitch, the backstop's rattle on a passed ball, a
  hit batter's thud.
- **The park:** the Curtain's hum past left field, the towers' buzz and a dead lamp's flicker, traffic
  and a horn in the streets beyond the stands, the Beacon's foghorn from the harbour, wind over the
  Curtain, acid drizzle on the roof.
- **The crowd:** a stereo bed that follows the game, a swell on contact, a roar, a groan, boos, a
  gasp, the "ooh" of a near miss, rhythmic claps, the towel wave in the final.
- **The graphics:** splash stings in FM brass, the count lamps' click, the speed readout's beep, the
  trail's whoosh, the replay's rewind, the inning sweep, the leaders table rolling in.
- **Fireworks:** the launch whistle, the burst, the crackle, the echo off the city.

### Voices

- **The announcer's calls:** short all-caps lines of 20 letters or fewer, which ORACLE already turns
  into a shout: Strike Three, Home Run, Double Play, Grand Slam, Walk-off. The announcer gets a voice
  of its own, tuned in the Voice Lab.
- **The plate umpire** in a gravelly voice, **the public address** with ORACLE's PA horn through the
  ballpark room, and **a vendor** now and then.
- **Chip's lines** from the booth, spoken on landing when the TV's read button is on, as now.

The calls play whenever TV audio is on and the 3-D view is open; that default is a question below.
Sound Detail decides how much plays: `off` keeps the calls, `limited` adds the events, and `full`
adds the beds, the organ, the public address and the park.

## Performance

### Budgets by tier

| | Full | Laptop | Phone |
|---|---|---|---|
| Resolution | the box × device pixels, up to 2× | up to 1.5× | 1× |
| MSAA | 4× | 4× | off |
| Players | close level for the four in the main shot | broadcast level | far level, 3,000 triangles |
| Shadows | 4 towers at 2048² | 2 towers at 2048² | blobs |
| Ambient occlusion | half resolution, 16 taps | quarter resolution | off |
| Depth of field | 28 taps | 12 taps | off |
| Crowd | 5,000 instanced fans | 3,000 | 1,500, far level |
| City | every building, windows, lights, beams, steam | the same without steam | facades without the window pattern; no beams or steam |
| Spectacle | fireworks, confetti, trails, crowd flashes | the same with fewer particles | trails and splash words only |
| Triangles per frame | 2.5 million | 1.2 million | 300,000 |
| Frame time, GPU | 8 ms | 12 ms | 16 ms at 30 fps |
| GPU memory | 250 MB | 180 MB | 90 MB |

The sub-screen is small (about 400×300 CSS pixels), so per-pixel work is cheap next to the city's
full-window frame; geometry and the crowd are what cost. A sellout fills about 14,000 seats: the
5,000 nearest get full figures and the rest are cards rendered from the same figures, keeping their
colours and towels. Tiers follow GLASS's phone tier (a coarse
pointer and a short side under 600 CSS pixels) and the governor.

### The governor

Rinkside's pattern, with these rungs in order: depth of field to 12 taps, ambient occlusion to quarter
resolution, shadows to two towers, crowd to the far level, players down one level, MSAA off,
resolution down a step. The loop pauses while the tab is hidden or the sub-screen is closed, and
`clear()` calls `loseContext()`.

The look-dev ran on a software renderer, so it gives no GPU timings. Phase 1 measures on the
reference machine and on an integrated laptop GPU and writes the numbers into
[systems-broadcast.md](../systems-broadcast.md).

## Gates and tests

| Gate | Group | What it checks |
|---|---|---|
| `scripts/shapes/gameday-smoke.mjs` (Phase 0) | shapes | Real Deadball games through the 2-D view: every payload resolves, runners end on `basesAfter`, nothing throws. |
| `scripts/shapes/ballpark-smoke.mjs` | shapes | Pure, no GPU: meshes finite and inside each level's budget, the park from venue data, GL matrices against the pure projection, skin weights summing to one, texture budgets; every cap, helmet and mask clears the skull and the ears and leaves both eyes open; every player's face pick is the same twice and never a makeup layout. |
| `scripts/shapes/anim-smoke.mjs` | shapes | Every clip: joint limits, no velocity spikes at blend points, planted feet sliding under 0.1 ft, hands on the bat within 0.05 ft, the glove at the ball within 0.1 ft on the catch frame, release at the release frame. |
| `scripts/shapes/diamond-smoke.mjs <slot>` | shapes, one game per gate | Real games through the world and director over the DOM stub: pitch count, each pitch at its spot, the terminal pitch matches the kind, captions held until `onLand`, fielders as the play names them, outs at the right base, runners end on `basesAfter`, runs equal the score change, home runs land past the fence, no runner faster than a runner could go outside a cut, ball and fielder in frame, replays start and hand back, sounds played. |
| `scripts/shapes/variety-smoke.mjs` | shapes | Over a season of seeded plays: directions spread by handedness, exit speeds cover their range, every fielding grade and, under v2, every new event appears, and every clip in the library is reached. |
| `scripts/content/build-deadball-clubs.mjs --check` | content | The row matches the script, sizes inside budget, colours hex. |
| `scripts/audio/deadball-bank-smoke.mjs` | audio | Every cue builds from known layer fields, its summed peak gain stays under its group's ceiling, and every call fits ORACLE's shout length. |
| `plugins/broadcast/regress.js`, the postseason | regress | `season` with its phase and the seeds on payloads, the final scheduled on an air day, the #1 seed at home. |
| `plugins/broadcast/regress.js`, sim v2 | regress | Built: the v1 hash holds; v2 with its new plays off is the v1 game; every v2 play's moves account for every man, the runs and the outs; the rates; the switch by slot; the payloads; the hitting race; a line for every new play. |
| `scripts/shapes/smoke.mjs` and `sitecheck.mjs`, the park | shapes, content | Phase 6: every slice of the park draws without throwing, and every gate has its street. |
| `scripts/shapes/cityscape-smoke.mjs` | shapes | Built: pure, composes the set from the content tree's manifest. Every building within reach resolves to a shape at the windshield's size and gets a plot or its place on the water, none inside the park's outline; bearings move under 3° at the median and under 25° within 900 ft; the edges are straight and on tile lines; every plot fronts a street or backs onto the set's edge; every road tile's arms draw; nothing tall stands within 48 ft of a street-level camera; the engine files name no region. Phase 4 adds that the light bake is fresh. |
| `plugins/broadcast/regress.js` | regress | `sport`, `bats`, `throws`, `hold` present; `play` consistent with the kind; standings once a game; bare pools direction-free; a recorded hash of a hundred seeded games unchanged. |

`client:smoke` and `imports:smoke` cover new files without being asked. Each gate stays inside the 60
s CPU budget. A triple play comes up in about one game in 540, so the diamond gate also feeds one
synthesised triple-play payload. No gate draws a real frame (the DOM stub has no WebGL), so a sandbox
page, `tools/sandbox/deadball-park-test.html`, runs the real sim and assembler into the real view for
screenshots and tuning by hand, as `hockey-rink-test.html` does.

## Phases

Each phase ends with its gates green and the sandbox showing it.

**Sim v2 runs on its own track** and ships as soon as it's ready, before the 3-D view if it gets
there first. It needs nothing from the phases below: the sim, the booth's pools, the 2-D Gameday's
text and graphics, the box score's E, SB and CS, and the switch slot. Its 3-D clips land with
Phase 3, or with sim v2 if that comes later.
- Named runners; errors; steals, caught stealing, pickoffs, the double steal and rundowns; wild
  pitches and passed balls; hit batters.
- Tested by: regress (the v1 hash, v2 off equal to v1, the switch by slot), `gameday-smoke` on v2
  games, `variety-smoke` once Phase 3 exists. Built, with the E in the line score, apart from
  rundowns as plays of their own (a pickoff line can call one), the stolen-base card, and SB and
  CS anywhere on screen. The switch is `@sim 2`.

**Phase 0: groundwork.** No visible change.
- Standings once a game; `sport`, `bats`, `throws`, `hold`, `season`, `moves` and the park's weather
  on payloads.
- The `siren-fidelity` branch merged (limiter, ducking, speech channels; built); the bank moved out of
  gameday.js; `gameday-smoke.mjs`; the sandbox page.
- Tested by: broadcast regress, the new gates, egress re-measured.

**Phase 1: the park, the light and the look.** Behind a flag (a localStorage key).
- `gl/ballpark.js` on `hdr.js`, `fog.js` and a matrix-based `ssao.js`; `gl/spotshadow.js`; sRGB,
  normal and roughness maps; the park from venue defaults; the dirt canvas; the arcade grade and the
  tube glass; the cameras, starting with the batting view.
- The arcade graphics package, still: panels, lamps, cards, the zone marker, the leaders table.
- Players as static, posed meshes at final quality, with their heads, faces and fitted headwear, so
  lighting and materials are judged on the real models.
- The park's site and the skyline manifest; `city-set.js`, and `gl/cityscape.js` with the facades,
  the streets, the lamps and the Curtain, at a fixed hour; the park's exterior.
- Tested by: `ballpark-smoke`, `cityscape-smoke`, sandbox screenshots, GPU timings on two machines.
- **1a built:** the park from the venue's defaults (`gl/ballpark-mesh.js`, about 54,000 triangles
  and 5,100 fans, the crowd instanced at its far level of 196 triangles a figure); `gl/ballpark.js`
  on `hdr.js` with the towers as the only lights, the painted field and the dirt canvas, bloom and
  ACES taken in linear light (it uses `hdr.resolve()` and grades its own frame); the scoreboard lit
  from the payloads; the shots with their matrices held to the pinhole; the HTML score bug, line
  and cards; `ballpark-smoke`; the sandbox's `?park=3d`. The flag is the localStorage key
  `deadball.grandstand`. Two things changed on the way: the wall's distances lie along the wall,
  not square to the bearing (in the gaps the fence runs at a slant, and a plate square to the
  bearing sank an end into the padding, so 375 read as 75, in the look-dev too); and a shot fits a
  wide screen by closing its vertical lens by the square root of the extra width, except the
  batting view, which keeps its height so the plate stays in frame.
- **1b built:** `gl/spotshadow.js` (four perspective maps from the field-side towers, 12-tap PCF,
  always bound because WebGL2 refuses a shadow sampler with nothing behind it; nothing casts until
  the players arrive in 1c); `fog.js`'s height fog and light shafts in every lit pass and the sky;
  the depth blitted out of the multisampled target, occlusion from it at half size through a new
  `createDepthSSAO` in `ssao.js` (with a slope-scaled bias the city doesn't use, because the field
  at a grazing angle self-occluded in rows); and `gl/broadcast.js` with the depth of field (28
  taps, per shot), the arcade grade, sharpening and the vignette, the broadcast preset and the
  tube glass. The tower lamps take a gentler bloom than the look-dev's (0.18 over `hdr.js`'s two
  octaves), which keeps each bank's lamps apart.
- **1c built:** `gl/ballplayer-mesh.js`, the look-dev's posed bodies ported as a pure builder
  (about 14,500 triangles a player, every pose under 17,000), with `actor-head.js`'s level-0 head
  and `actor-faces.js`'s atlas, and the cap, helmet and mask grown off the skull (`skullPoint` and
  `ZC` are now exported for it); `diamond/cast.js`, who stands where for a payload, each role in a
  fixed kit slot so a new batter rebuilds only the batter; `diamond/kits.js`, the kit atlas, the
  monograms and the leather, wood and mask textures. A lefty batter or pitcher is his pose in a
  mirror. Fewer players have long hair than the look-dev gave them, and no umpire does. The
  players cast the towers' shadows, and the faces shade as the Actor Lab's do. Their colours stay
  placeholders (cream and navy at home, grey and rust away) until Phase 5 brings the clubs'.
- **1d built:** `diamond/hud.js`, the arcade package as a canvas over the picture, a pure layout
  the gate checks at the wall TV's, the tablet's and the sandbox's sizes and a painter: the score
  with the bases, the count as lamps, the pitch speed, the zone with the last pitch (through the
  tube's bulge when the glass is on), a matchup card as each man comes up, the steal's card and
  clocks, splash words for the cards the broadcast already throws, and between innings the
  leaders' table, one race at a time; the final's gold; the title-safe area and the glass's
  scanlines. No word is set under 6 px, which on the tablet's small TV beats scaling down. The
  numbers are real: the season fold (`foldGame`) now counts steals and the pitchers' wins,
  losses, outs, earned runs and strikeouts; every play carries the batter's and pitcher's lines
  as they stood before it, the first payload the leaders, and a steal the clocks from the traits
  that decided it. Two things moved from the look-dev: the pitch speed sits below the park's
  scoreboard, which the batting view puts top right on a wide screen, and the matchup card shows
  for the first seconds of a plate appearance rather than all of it, because at the TV's size it
  covers the batter. The HTML score bug and cards are gone, and the score is written out for a
  screen reader. The theme's words, colours and bug are code defaults until the venue carries
  them (Phase 5); tv.js passes the station's name.
- **1e built:** the skyline manifest as a pure `client/shared/skyline-manifest.js` (the buildings
  within reach of a site and an edge per side, a Curtain line or a shore), which the server builds
  from the in-memory map with the engine's own rule for a building's door
  (`server/engine/skyline.js`; the cold open's `coldwaterSkyline()` builds its rows with the
  same `skylineEntry`);
  the venue on the wire as `tv_venue` once per revision, stamped `venueRev` on a game's first
  payload, 18 KB and 5 KB gzipped; `client/shared/city-set.js` composing the set; and
  `gl/cityscape.js` building it: 218 buildings from their baked shapes, 136 filler plots, 838
  cobra-head lamps with their pools and 36 aircraft beacons, about 75,000 triangles, composed in
  about 20 ms and built in about 90 ms. Bearings move 1.65° at the median, and the worst within
  900 ft is still Fairweather Marina at 19°. The windshield's per-tile jitter and `CURTAIN_H`
  moved into `skyline-scale.js` as `buildingScale`, so a tower is the same height in the cockpit
  and on TV. The art direction is content (`sports_pools.venue.city`), and so is the park's
  `name`, lit over the main gate. Outside, the park has its brick wall, flags and sign, its back
  plain from inside. Three things changed on the way. The look-dev's arcade had its piers where
  the openings were, so the arches drew as dark brick and the club level's windows never showed;
  the openings now glow from the concourse. Where a block is three plots deep (beside the ring street and the
  north and south edges, where a cross street is dropped), its middle plot in the column against
  the West Curtain has no street of its own and backs onto the wall; the gate allows that and
  no other plot without a street. And the light bake isn't part of
  `cityscape-smoke` yet, because it comes with Phase 4. GPU timings on real machines are still to
  be taken: the sandbox's screenshots here come from SwiftShader.

**Phase 2: skinned players and the pitch.** Behind the flag.
- `gl/skin.js`, the rig, `diamond/anim.js`, the Pose Lab, the pitching, batting, catching and
  umpiring clips; every pitch result staged; strikeouts and walks in full, with their calls and
  splash words.
- Tested by: `anim-smoke`, `diamond-smoke` (pitches, counts, captions).
- **2a built:** the rig, `diamond/rig.js`: the pose language and its solver moved out of
  `ballplayer-mesh.js`, the look-dev's whole delivery and its slide, tag and safe added to the
  pose table, and twenty bones (the spine's five, three a leg, three an arm, two fists and the bat)
  whose frames are read off a solved pose. `buildBody` builds a player once in a bind pose with
  four bone weights a vertex: the torso's rings blend along the spine's frames, a limb's across
  its knee or elbow and into the pelvis or chest at its root, the head between the neck and the
  skull, and everything else rides one bone. A hitter's fists and bat are built in a batting
  stance on bones of their own that fold to nothing while his hands are free, as the open hands
  do while they grip. `gl/skin.js` keeps the bones in a float texture, a row a kit slot, and the
  shaders skin by it, the towers' shadows too; the jersey's cell and the face's slot come from the
  draw, so a body is kept for who a player is, not where he stands. Skinned on the CPU with the
  shader's own sum, every pose lies within 0.25 ft of the posed build's surface, the head lands
  vertex for vertex and the grips stay within 0.05 ft of the bat's axis (`anim-smoke`, 45
  checks). Two things are smaller than this section asked: twenty bones rather than about forty,
  because a grip is a fist of its own rather than finger bones and nothing yet needs a clavicle
  or a forearm twist; and linear blending without the dual-quaternion option, because each limb
  is its own tube that turns whole with its bone, so there's no twist to collapse. Both can come
  in behind `gl/skin.js` when a clip needs them.
- **2b built:** the clip player, `diamond/anim.js`, and the library's format. A clip is a file
  under `content/animation_clips/` ([clip-schema.js](../../client/game/js/panels/diamond/clip-schema.js)
  says what it may hold): poses in the rig's language at times, the events the director waits on
  (`release`, `contact`, `catch`, `call`, `step`) and the stretches a foot is planted.
  `npm run clips:bake` checks each file, fills in every key's pose and writes `diamond/clips.js`.
  Playback runs every number on a Catmull-Rom curve through the keys, with a Kochanek-Bartels
  tension a key (the release key at -1 carries the hand through it at full speed); a clip starts
  and ends at rest, and a loop runs on round its end. A planted foot is held on its spot, easing
  on and off over a tenth of a second with its toe laid flat, and where a held foot is out of
  reach the pelvis sinks, smoothly. The rig's IK now softens near full stretch, so a knee
  straightens without snapping. The layers: `reach` brings a glove to the ball, turning the hand
  along the arm and moving the body by up to the catch's `follow`; `lookAt`; `vary`, a player's
  own way off his name; a left-hander's mirror; and `mixPose` for a crossfade. A catch says the
  box its glove covers, so the director can send a ball outside it to another clip. Four clips to
  start, each keyed to pass the gate: the delivery from the set (the look-dev's frames re-keyed to
  the rig's legs: a 4.4 ft stride, the pelvis down to 2.5 ft at foot strike, the hand at 111 ft/s
  at the release), the hitter's stance with a waggle, the catcher's receive and the plate umpire
  set. `anim-smoke` plays every clip (84 checks in all): the joint limits on every frame, caps on
  each joint's speed and acceleration, no jump in velocity at a blend point (under 1 ft/s, taken
  to zero time), planted feet still within 0.1 ft, the hands on the bat within 0.05 ft, the glove
  at the ball within 0.1 ft across its box, the release within a frame of the hand's top speed,
  and the pitcher on the real mound both ways round. Root motion waits for the running clips in
  Phase 3; until then a clip moves within its own frame and the director places the frame.
- **2c built:** the pitch's clips, thirty in all, each keyed to pass the gate. The pitcher's: a
  delivery from the stretch and one from the windup for each arm slot (over the top,
  three-quarters, sidearm: the throwing arm turned about its shoulder, the trunk's lean easing as
  the slot drops), coming set, and taking the throw back and walking up to the rubber. The
  hitter's: the stance, the load and stride, a swing for each contact height (the sweet spot at
  2.1, 3.0 and 3.8 ft), the take, the check swing, ball four (the bat tossed, off to first),
  strike three (the walk off) and the hit by pitch. The catcher's: the signs and target, the
  receive, the throw back and the block. The plate umpire's: set, the rise after a ball, the
  strike, three strikeout calls (the hammer, the bow and arrow and the point; the director gives
  each umpire his own), the foul and the dead ball. The hand is at 102 to 108 ft/s at each
  release and the sweet spot at 107 to 108 ft/s at contact. The arm slot is now a choice of clip,
  so `vary` keeps only the kick and the stance; and each clip has to hold up done every player's
  way, at the ends of each trait's range, which `anim-smoke` checks too (277 checks). Three things
  came in with them: a catch says which way the ball comes (`from`), so its box stands across the
  ball's line; a bat let go at a key hands the wrists over where the bat really had them, at the
  same speed; and the bake refuses a key that turns more than half round from the last, which is
  always the long way round. The walks off are keyed step by step for now; the running clips of
  Phase 3 and the Pose Lab will do them better.
- **2d built:** the director and the pitch. [diamond/director.js](../../client/game/js/panels/diamond/director.js)
  takes an at-bat and works out the whole of it when the payload arrives, as times on the clock
  of [diamond/world.js](../../client/game/js/panels/diamond/world.js), which keeps who's moving,
  their layers, the ball and a queue, stepped at 120 Hz. Each pitch is a path fitted through its
  plate spot at its real speed under gravity, drag and its type's spin
  ([diamond/flight.js](../../client/game/js/panels/diamond/flight.js)), from where the delivery
  has the hand at its release, and every clip is lined up on it: the release on the pitch's start,
  the catch on the ball reaching the mitt (the catcher sets up across from it, and blocks a ball
  that would come in under his box), the swing's contact on the ball reaching the bat, a miss 0.03
  s off with the barrel over or under, the flinch on the ball reaching the batter. A swing meets
  the ball where it's the sweet spot's length from the hands: out in front for a pitch in on him,
  deeper for one away. The bat layer (`aimBat`) turns the barrel through it, carries the knob up
  to 1.25 ft toward a pitch on the outer edge, and moves the body after a hand that would come
  off the bat, bending at the waist for a low one. Heads follow the ball in. One timeline serves
  both the plan and the staging, so the pacing the plan works out is the pacing played: the
  pitches cut in at the stride first, then reactions (the hitter's camera, `side` or the new
  `sideL` for a left-hander, with the umpire's call in it), then the motion and the set, then the
  throw back and the walk up (`mound`), and a long at-bat on a short hold leaves out pitches from
  the middle. The view (gameday-grandstand.js) runs frames while an at-bat plays: the battery's
  poses and the ball (`setBall` in gl/ballpark.js, drawn at 1.4 times its size so it reads at
  400 pixels) go to the renderer each frame, the count goes up as each pitch is decided, never
  showing a fourth ball or a third strike, and the held line, the card and a strikeout's or a
  walk's splash go up at `onLand`. The 2-D view's cues from the shared bank play on their moments:
  the mitt's pop, the bat's crack, a miss's whiff, the ball into a glove, and the play's own sound
  as it lands. `diamond-smoke` checks it all on two games at two holds (about 6,900 checks each),
  and the view itself with a recording renderer. What it doesn't do yet: a ball put in play flies
  out over fielders who stand still (Phase 3), the bank is still the 2-D view's (the fuller bank
  and the mix are Phase 4), and the umpire's and the announcer's voices wait on the
  `siren-fidelity` branch.
- **2e built:** the Pose Lab, `/pose-lab.html` in the Modelshop
  ([tools/modelshop/pose-lab.js](../../tools/modelshop/pose-lab.js)). It plays the clip under edit
  on a skinned player in the real park, where his role stands, and edits everything in a clip
  file: its fields, the keys and their tension, every field of a key's pose, the events and the
  plants, with the schema's verdict and the selected key's joints shown as you go. It shows a
  left-hander and the ends of each trait's range, and holds a reference frame over the picture to
  pose against. A new clip starts from its role's still, a copy, or the look-dev's six-frame
  delivery. Save goes through `planSave` in `bake-clips.mjs`, which bakes the library with the
  clip in place before anything is written, so the Lab can't write a clip the gate refuses;
  `anim-smoke` holds every clip on disk to the Lab's own format, so a save is a diff of what
  changed.

**Phase 3: balls in play.** Behind the flag.
- `synthPlay` with direction, exit speed and fielding grade, and the suffixed pools; fielding,
  throwing, running and sliding clips for every grade; ball flight with spin; reconciling cuts; the
  half-inning changeover; the play cameras.
- `gl/spectacle.js`: trails, contact sparks and fireworks; the side-on home-run camera; splash words
  for every play that earns one.
- Tested by: `diamond-smoke` in full, `variety-smoke`, regress for the play and the season hash.
- **3a built:** every ball in play is decided on the server. `synthPlay` in
  [baseball.js](../../plugins/broadcast/sports/baseball.js) gives each one its spray, exit speed
  and launch angle, where it's fielded or comes down, the fielders it goes through, the fielding
  grade and the throw, and for a hit the wall, the slide and any man who dove for it and missed,
  and for a home run its kind. The field it's judged on is
  [diamond/play.js](../../client/game/js/panels/diamond/play.js): where the nine stand, shaded to
  the hitter's pull side (the 3-D cast stands them there too), how far a ball carries or rolls,
  and how far a fielder gets in the time, so a grade is the share of his reach the play took.
  Every candidate is drawn round the man who has to make the play and kept with the chance a play
  that hard gets made, so about seven groundouts in ten are routine and one in fifty takes a
  dive. The payload carries it as `play`, about 75 bytes. The booth's ball-in-play lines were
  sorted into bare pools that are true of every play of their kind and 85 suffixed pools for what
  only some plays show, and the assembler draws from both (`sportsPickTagged`). The 2-D view
  draws the play: the ball to the man it names and on through the bags the outs were made at.
  Tested by `variety-smoke`, regress (every play against its kind and the sim, the payloads
  leaving the game as it was, the bare pools, the tags) and `gameday-smoke`'s ball check.
- **3b built:** the clips to play a ball in play with, 37 of them, 67 in the library. A clip that
  travels carries its own path (`root`), keyed in the frame that moves with him; its planted
  feet stay where they landed, the world carries the body's frame on by it, a crossfade between
  two clips mixes them in one frame, and a clip played out of or into another can say it's
  `moving` at that end, so its legs don't stop at the seam. The runs (a jog, a run, a sprint),
  pulling up, the hitter out of the box for each hand (first base is 43 degrees round for a
  right-hander and 134 for a left-hander, so each has his own clip), and the slides feet first,
  head first and hooked. Ground balls taken routine, backhand, forehand, diving either way and up
  onto the knees, and barehanded with the throw sidearm on the run; the throws over the top, from
  the knees, the flip and the crow hop, the infielders' borrowing the pitcher's arm; the first
  baseman's stretch and scoop, both pivots at second and the relay; the outfielder's charge,
  pickup and throw. Catches camped, running, diving, sliding, up at the wall and over the rail,
  the catcher's pop-up, a fielder watching one go, and the base umpires' safe and out. Every
  catch says where its glove can take the ball, and the gate holds it to every ball in that box.
  The Pose Lab plays a travelling clip across the park and edits its root. The clips were keyed
  by a footstep planner (each foot's spots on the ground, the swings between them, the body
  over them) rather than by hand, then held to the gate: `anim-smoke` plays all 67 at 120 frames
  a second, at a third of its CPU budget once its save check stopped baking the library once a
  clip. Turning a run round a bag is the director's path for 3d, not a clip.

- **3c built:** every ball in play played out in the park as the server decided it.
  [diamond/plays.js](../../client/game/js/panels/diamond/plays.js) plans it from the payload's
  `play` and the director stages it on the world's clock. The ball goes where and when the
  server said: on the ground on play.js's own roll, up off its last hop into the glove; in the
  air down in its hang time; over the fence into the seats. The seven set as the pitch comes and
  every head follows the ball. Each fielding clip is placed so its catch lands on the ball, the
  run to it a run cycle at the speed it takes (carried round a sharp turn, and offset half a mix
  at each end so starting and stopping don't surge), and a clip with no time for its first steps
  is taken up part way through. The throws go man to man, each turned so the hand's way at the
  release points at its man and held until he can be there: to first, through the pivot at second
  and on, to the cutoff. The batter runs to first at his own legs' pace and never beats the ball
  on an out there; a throw he beats waits for him; the base umpire calls it. Errors play as
  their kind: booted and picked up, through the legs, dropped, past the bag or into the stands.
  The high camera follows the ball, a play at first cuts to the first-base camera as the throw
  goes, and a long fly cuts to a camera behind the man under it. Runners and the batter's turn
  at first are 3d's, so an at-bat that starts from bags the picture didn't leave opens on the
  wide shot over the city while everyone takes their places. `diamond-smoke` holds every glove to
  its ball, every throw to its hand, the call at first to the picture, every pelvis under 52 ft/s
  outside a cut and the ball in the high camera's frame, over two games; the planner takes about
  5 ms an at-bat.

- **3d built so far, the men on the bases:** on a ball in play every man runs the payload's
  `moves` at his own legs' pace ([diamond/bases.js](../../client/game/js/panels/diamond/bases.js);
  play.js `legsOf` is the sim's speedOf, which the browser can't import). His way round a bag is a
  bowed turn through it, and the run cycle is carried round it a few degrees at a time, changing
  from the run to the sprint at the same point in the stride as he comes up to speed. A man
  holding stays in his lead (a new clip, `run_lead`) on the ground and goes back to his bag on a
  ball in the air; one tagging up leaves on the catch, and a close sac fly gets the throw home
  behind him and his slide. A man forced out gets there after the ball and slides, and the base
  umpire calls it; the batter runs through first on a play there, rounds it and comes back on a
  single to the outfield, slides into second or third where the play says, and trots round on a
  home run. A man who scores goes on over the plate past the catcher and jogs off toward his
  dugout. A throw to a bag a man's safe at waits for him, and the play lands with every man on
  his bag and every run in; a man still running once the ball's back in gets one cut to the bag
  he's going to, two of them new cameras (the plate, third). A play never hurries to fit its
  budget: a long one leaves out the first pitch too, and the last pitch and the play run over if
  they must, by a quarter of a second at most over 25 games. The picture now leaves the bags the
  play left, so a cutaway is only for an at-bat the booth skipped. `diamond-smoke` holds every
  man over every bag on his way, on his bag by the landing and at the end, the forced man after
  the ball and the safe man before the throw, no two men within 2.5 ft and the runs to the play's.

  Then walks and the changeover. On ball four or a hit batsman the batter trots to first once
  he's away, every man forced trots up a bag and a man not forced walks back to his. On the third
  out every man on the field jogs off to his side's dugout, planned from the world once the play's
  landed, and the high camera watches them go; at the break the side taking the field runs out of
  its dugout and the pitcher throws his warm-ups, as many as the hold has room for. A dugout is a
  row of spots in foul ground up the line, handed out by when the men get there, the first in to
  the end furthest from the field, and a man holds back where he'd pass too close to one gone
  before him. The first baseman steps off the bag after the last out there, so a man who held
  first can go back to it. `diamond-smoke` holds everyone going off to his own dugout and 2 ft
  clear of everyone else, and at every changeover each man to his spot and each warm-up to the
  pitcher's hand and the catcher's mitt.

  Then the clips for the plays on the bases, eleven of them, 79 in the library: the catcher's
  throw from the crouch to second and to third, the tag astride a bag for a runner coming from
  ahead or from beside, the first baseman's tag on a pickoff, the pickoff move (a right-hander's
  jump turn to first, a left-hander's step, keyed as its mirror), the dive back to first, up off
  the ground from either slide, and a ball picked up where it lies. A tag is a new kind of event,
  and `anim-smoke` holds the glove at its lowest there; it checks every pitcher's clip on the
  mound in the frame the clip has carried him to, and each get-up from its slide's last pose.

  Then the plays on the bases staged ([diamond/runs.js](../../client/game/js/panels/diamond/runs.js)).
  A steal, a throw over, a wild pitch or a passed ball is played as an at-bat with one pitch or
  one throw over, the board at no balls and no strikes. A steal's delivery is played at the
  tempo that gets it to the mitt on the card's time to the plate, and the catcher throws in what's
  left of the pop time, so the card's clocks are the picture's; the runner breaks so his slide is
  in a beat before the tag when he's safe and just after it when he's out, and his lead takes up
  what no jump would. A throw over places the first baseman by where his tag comes down and the
  runner by where the dive back's hand does, and a pickoff's runner is a beat late. A pitch that
  gets by rolls to the backstop, on a camera of its own when a man scores, and the catcher picks
  it up where it stops while every man moves up. Once the call's made the man who took the throw
  jogs back to his spot and a man safe steps onto his bag; on a third out the tagger steps off
  past the bag, away from the man he got, and waits for him to get up before everyone goes off.
  The going off now lets two men who start close (the batter and the catcher) part from where they
  are, where one of them used to stand ten seconds first. A mix now turns back a wrist bent past
  96 degrees and lifts a toe it took through the floor. `diamond-smoke` stages every play on the
  bases in the game and the first of each kind it lacks from the games after it: the clocks to
  0.01 s, the throw out of the hand and into the glove, the call against the tag and the touch,
  the ball picked up where it lies, everyone where he should be at the end, and a third out on
  the bases taking everyone off clear of each other; the view plays them live, with the steal's
  card on the call.

- **3e built, the spectacle:** a comet's tail down the ball's way on a ball hit 100 mph or
  harder and on every home run, sparks off the bat at hard contact, and fireworks over the
  outfield after a home run or a walk-off, planned in
  [diamond/spectacle.js](../../client/game/js/panels/diamond/spectacle.js) and drawn by
  [gl/spectacle.js](../../client/game/js/panels/gl/spectacle.js) as light added over the frame,
  each particle worked out in the vertex shader from the time, so it blooms and a stopped clock
  draws it the same. A home run cuts to a camera riding beside the ball, then to the wide shot
  over the outfield for the shells and back to the high camera for the trot; its distance and
  its speed off the bat take the pitch speed's box. A play earns its own splash words: a triple,
  an error, a catch at the wall or one robbing a home run, a diving or sliding catch, one over the
  rail, a diving stop, a barehanded play, a pickoff, a wild pitch, a passed ball and a hit
  batsman, beside strike three and ball four. Reduced motion drops the riding camera, the sparks
  and the shells (and since 4a the tail). `diamond-smoke` stages every home run, ball hit hard and
  walk-off, and `tools/sandbox/deadball-shots.mjs` takes the sandbox's pictures headless.

- **4a built, reduced motion and the play by play in words:** with reduced motion (the Motion
  switch or the system's setting, read as each play is staged) the cameras that would follow the
  ball hold still and cut instead: each frames where the ball's flight ends and cuts to the next
  as the next throw goes, never within a second of its last cut (`plays.js` stillShots). None of
  the spectacle is drawn, the tail included, and the graphics come up still. The 2-D view draws no
  trails, no wipe on a cut and no celebration, and runs no idle loop between plays. For everyone,
  the shells go up more than a third of a second apart, so no second has more than three bursts.
  A new accessibility option, Play by Play (`accessibility plays`, on by default), has both views
  write into a polite live log, for a screen reader, each pitch as it's thrown ("88 slider,
  swinging strike, 1 and 2", gameday.js `pitchText`), the booth's line as it goes up and every card
  and splash word; the 3-D view also says the matchup, a steal's card and a home run's distance,
  and its board in words has the leaders' table between innings. Replays are 4b's, and will come
  as stills with the play described. `diamond-smoke` stages every ball in play again with reduced
  motion and checks every camera holds still with the ball in the frame as each flight ends, and
  that the live text says each pitch in order; `gameday-smoke` checks the 2-D view's.

- **4b built, replays in slow motion:** a walk-off, a home run, a triple or double play, a catch
  that took a dive, a slide or a leap, a triple and a call at first closer than 0.15 s each get a
  replay ([diamond/replay.js](../../client/game/js/panels/diamond/replay.js)). Nothing is
  recorded: staging is a pure function of the payload, so the play is staged again in a world of
  its own, stepped to just before its moment and played at 0.4 of its speed from a second camera
  (centre field's long lens on a swing, the bag at second for a double play, the plate for the
  winning run, third for a triple, first for a close call, low beside the man for a catch), at most
  3.4 s of play, silent, under a REPLAY bug beside the score. It starts 1.8 s after the play lands,
  or once the fireworks are out after a home run or a walk-off, only if it ends a second before
  the next payload's due, and the live world carries on behind it;
  a cut the live director makes meanwhile waits for it. With reduced motion it's a still of the
  moment for 3.2 s, and the live text says "Replay" with the play. `diamond-smoke` stages every
  play in the game that earns one again (and a triple, a walk-off that isn't a home run and a
  triple play from the next games) and checks it's the same play to a micron with its moment in
  its camera's frame, and the view plays one, at 0.4 of the live clock, its bug up and its camera
  on, and the live camera back after.

- **4c built, the crowd that reacts:** every fan is one figure in three poses, sitting, standing
  and cheering, which `crowdMorph` pairs vertex for vertex, and [gl/crowd.js](../../client/game/js/panels/gl/crowd.js)'s
  vertex shader moves him between them by how loud his side is, drawn as the crowd already was, one
  instanced draw for each pose a fan rests in. A play's cheer (`cheerOf`) gives the side, how loud and how long: a home
  run brings its side's fans up off the bat, and a run, a double play, a great catch or a
  strikeout ending a half as it lands. Each side's roar (`createRoar`) is a pure function of time,
  and each fan gets up at his own threshold, hashed from his seat, then bounces and sways on his
  own beat; with reduced motion he stands without the bouncing. Most fans are the home side's,
  more of the visitors' up the third-base line. This is the plan's crowd without the
  vertex-animation clips: a crowd seen from the cameras' distances reads by standing up, not by
  what its hands do. The camera flashes at night are 4e's.

- **4d.1 built, the infield keeps the game:** every pitch leaves the pitcher's stride where his
  front foot lands and the hitter's back foot dug into his box, and every slide and dive its scar,
  a stretch at a time as he makes it, worked out from the staging
  ([diamond/marks.js](../../client/game/js/panels/diamond/marks.js)) and said by the director as
  they're made. The park keeps its own copy of the infield canvas and paints each one on it
  ([diamond/dirt.js](../../client/game/js/panels/diamond/dirt.js) `paintMark`, only where there's
  dirt), and only the rect a mark touches goes up to the GPU again, a few hundred texels a mark. A
  game's worth of strides digs a hole where the deliveries land; a new game starts on a fresh
  infield. `diamond-smoke` checks every pitch leaves its stride and its dig, at the foot, on the
  dirt, a slide's scar running to where he got to, and the view handing every mark to the
  renderer; `ballpark-smoke` checks where the dirt is and that each mark paints inside its rect.
  The grounds crew's drag (4d.3) puts back what it passes over.

- **4d.2 built, between at-bats:** once a play's landed the view asks the director for the dead
  time till the next payload's due ([diamond/between.js](../../client/game/js/panels/diamond/between.js)).
  From wherever the play left him, every fielder walks back to his spot and stands easy (a jog for
  a long way), the pitcher walks off the back of the mound and rubs up the ball, the catcher goes
  back behind the plate while the plate umpire steps aside, a base umpire goes back to his spot, a
  man on a bag stands easy on it and a man who's out goes off to his dugout. Each sets off when
  his play's done with him, from what the director's queued for him (a strikeout's walk off
  starts after the call), held back while his way would take him within reach of somebody
  already going and routed round anybody standing; nobody walks up the mound's slope. The
  on-deck hitter swings in his circle through every at-bat. The cameras go round the park: wide
  as the field resets, the on-deck circle for a swing, the pitcher rubbing up the ball, a stand
  of fans, and wide again, after any replay. Four new clips: a walk, standing easy, a practice
  swing and the rub. Not after a third out or a walk-off, and nothing for a payload that doesn't
  say how long it holds. `diamond-smoke` plays the dead time after every at-bat at the long hold:
  everyone at rest a beat before the next payload's due and where he was sent, nobody jumping,
  nobody within 2 ft of anybody (or nearer than the two started), the walks and rests inside
  their joints, the on-deck hitter in his circle and swinging for his camera; `ballpark-smoke`
  checks each new camera has what it's for. On a long hold the cameras come round again, a
  cutaway every 9 s of the wide shot (the on-deck circle, the city, the crowd).

- **4d.3 built, the grounds crew:** in the middle of the fifth, when the break holds 84 s or
  more, four of them drag the infield ([diamond/crew.js](../../client/game/js/panels/diamond/crew.js)):
  two to a mat, the pairs side by side, in from foul ground beyond third, round the whole skirt
  past second base on two arcs, the inner clear of the bags and the outer of the grass, and off
  beyond first, turning onto each arc and off it rather than on the spot. They're people in work
  clothes (gl/ballplayer-mesh.js dresses the crew as it does the umpires), walking with
  `run_walk` and pulling with a new clip, `crew_drag`; the mats and their ropes, up over each
  man's right shoulder to his hands, are drawn each frame (gl/ballpark.js `setMats`). Behind each
  mat the dirt is put back as painted (`smoothDirt`, a third of a second of the drag an upload),
  so the game's marks in the skirt are gone and the ones at its edges stay. The pitcher warms up
  while they drag and the infielders wait by their dugout till the mats are off the dirt. The
  leaders' table comes down a few seconds into the drag and the crew camera follows them round
  from a well across the field, first base's side and then third's; with reduced motion it
  holds still where they'll walk through. `diamond-smoke` plays the middle of the fifth at a long
  hold: the four of them only then, each man where his mat has him while he pulls, each mat on
  the dirt, nobody jumping or within 2 ft of the crew, their walks and pulls inside their joints,
  the infielders waiting and in place a beat before the next payload's due, the table down once
  and the crew in the crew camera's frame; `ballpark-smoke` checks the crew's dress builds, a mat
  and its ropes, and that the drag copies the dirt back inside its polygon only.

- **4e.1 built, the sky on Coldwater's clock:** each payload carries the minute of the day it
  aired at (`clock`, added on air beside `wx`), and the park's light follows it
  ([diamond/sky.js](../../client/game/js/panels/diamond/sky.js)): the sky's zenith and horizon, the
  ambient from above and below, the haze, the stars, the city's glow and its windows and lamps.
  Deadball airs from 18:00, so a game starts as the sun goes down, the horizon warm in the west
  (over left field at Halcyon Field, taken against the venue's bearing) and cooler away from it,
  goes through the blue hour as the windows come on, and is the night the park was tuned at from
  20:00. The keyframes moved out of the windshield to
  [client/shared/sky-keys.js](../../client/shared/sky-keys.js), so both blend the same table, and the
  night sky carries the city's own glow from the venue's art (`city.glow`, Coldwater's pink).
  `ballpark-smoke` holds the night exact, the dusk brighter toward sunset and under its cap, the
  windows and stars coming on, the warm horizon in the west whichever way a park faces;
  `diamond-smoke` that a payload's minute reaches the renderer; broadcast regress that it's read on
  air. The sandbox and the shot tool take `hour`.

- **4e.2 built, the park's own weather:** the payload's `wx` sets the look
  ([diamond/weather.js](../../client/game/js/panels/diamond/weather.js), folded into the sky): cloud
  takes the stars and its underside carries the city's glow, the haze thickens, the city dims
  through it and rain wets the field: the dirt and the track go darker with a dull sheen, and
  puddles lie flat in their low spots and catch the floods.
  What falls is one instanced draw ([gl/weather.js](../../client/game/js/panels/gl/weather.js)) in
  the air each camera looks through: rain as streaks catching the floods, sleet, snow and ash as
  flakes, acid rain green. A thunderstorm, a storm or an ion storm (violet, and more often) puts
  bolts from client/shared/lightning.js out past the outfield over the skyline, each a function of
  the world's clock and flashing the sky once; with reduced motion they don't flash.
  `ballpark-smoke` checks every word's look, a clear night still the tuned night, the bolts the
  same twice and as many a minute as the weather says, and a bolt's ribbon; `diamond-smoke` that
  the weather reaches the renderer; broadcast regress that the park knows every weather word. The
  sandbox and the shot tool take `wx`, `rate` and `event`.

**Phase 4: the broadcast.** On by default wherever WebGL2 and float targets work.
- `gl/crowd.js` with seated and reaction clips; replays in slow motion; dead-time rituals; the grounds
  crew in the fifth; reduced motion; the tiers and the governor.
- The full bank and the mix; the umpire, the public address and the vendor.
- The sky on Coldwater's clock and the park's own weather; the light bake and the city's lights,
  beams and steam; the cars and the people walking in; birds.
- Tested by: `diamond-smoke` (replays, sounds, reduced motion), the bank's gate, measured frame times
  written into the docs.

**Phase 5: the clubs and the playoffs.**
- Sixteen identities through the seam; caps, uniforms, wordmarks and crests in the atlases; the 2-D
  view picks up the colours too.
- The final's gold package, logo, bunting, towels and searchlights; the champions' finish with
  confetti, fireworks and the trophy.
- The three postseason bugs fixed, and the final renamed in the script and the cards.
- Tested by: `--check`, `ballpark-smoke`, regress (the final airs, the #1 seed hosts).

**Phase 6: a place in the world.**
- Halcyon Field on the map: the six buildings, Vetch Green and their NPCs set aside on the holding
  map, the player-row check and its one-shot, the type, the tiles, the fill, the model, the gates on
  their streets, the game-night lights.
- Seats in person, last.
- Tested by: `shapes:smoke`, `sitecheck.mjs`, `content:lint`, a walk from Sorrel Way through the
  main gate in regress, and a set-aside gate: nothing on the holding map connects to the world, and
  every set-aside building still resolves its interiors, furniture and NPCs.

**Phase 7: optional.** A longer postseason; a pitch-by-pitch booth; a park per club; the batter's
season line; the throwback presets; the same lighting for Rinkside; the skyline dimming with the
power grid.

## Risks

- **The art and animation are the work.** A rig, a Pose Lab and about 120 keyed clips is more effort
  than all the code around them, with no motion capture to start from. Phase 2 stages only pitches so
  the pipeline is proved on the motion viewers see most.
- **Faces in close-ups.** The street-figure heads have never been drawn in the game. The look-dev drew
  them from a head-and-shoulders portrait out to the first-base camera and they held up. The open
  question is variety: 32 layouts for a league of 16 clubs, about 400 players, which skin, hair, eyes,
  hair style and eye black stretch.
- **Hardware.** Every GLASS number comes from one discrete GPU. A ballpark that needs float targets
  and four shadow maps has to be measured on integrated laptops and phones before it goes on by
  default; the 2-D view is the floor.
- **The line and the picture disagreeing** is the first thing a viewer notices. The suffixed pools and
  the word check exist for it.
- **Memory.** A sub-screen holding 250 MB is a lot next to a city scene; the governor and `loseContext()`
  on close keep it honest.
- **Determinism.** `synthPlay` and handedness must not draw from the sim's random stream. The season
  hash in regress catches it.
- **Trademarks.** Original clubs, marks and graphics only; the panels are generic. The final's
  current name in content is Major League Baseball's mark and should change.
- **The announcer cut off, and loudness.** On `main` every typed command cancels speech, each
  `speak()` cancels the last, and the master has no limiter. The `siren-fidelity` branch fixes all
  three; until it merges, Phase 2's calls can't ship.
- **Spectacle and comfort.** Fireworks, flashes and splash words can get to be too much. Reduced
  motion turns them into stills, nothing flashes more than three times a second, and the crowd's
  camera flashes stay small.
- **Scope.** Seats in person are a feature of their own and come last.
- **The park isn't on the map.** Until Phase 6 puts it there, a player who walks or flies over
  south-west Halcyon Fields finds the estate where the broadcast shows a ballpark. Putting it there
  means setting aside six buildings and Vetch Green.
- **Content set aside.** The park takes six buildings (11 rooms, 4 NPCs) and Vetch Green out of play
  from a campaign that shipped recently. Nothing is deleted. The risk is player rows that point into
  those zones; the check before the move finds them.
- **The set isn't the map.** A player who knows the estate will see streets on TV that the map
  doesn't have. The landmarks keep their bearings and the Curtain and the bay are where they should
  be, and the set is only ever seen on TV.
- **Sim v2 changes results.** Errors and steals change scores, and the standings re-simulate every
  past slot, so the server records the switch slot in the future and never moves it, and the v1
  hash in regress proves no game before it moved.
- **The Curtain's height.** GLASS draws it 0.9 tiles tall, about 53 ft, though its comment in
  `windshield.js` and the zones' prose call it taller than anything in the city. The broadcast draws
  what GLASS draws, so the two agree, until someone decides otherwise for both.

## Questions for you

Decided on 2026-10-11:

- **The site and the name:** Halcyon Field, on the nine-tile block under *Where the park stands*. A
  first site at full scale took 41 buildings; the most the park may take is eight to twelve tiles.
- **The buildings it displaces:** six buildings and Vetch Green, set aside for later use, as under
  *The park on the map*.
- **Sim v2:** in as soon as it's ready, switched on at a recorded slot rather than at a new season.
- **The city on TV:** an abstraction, a set composed for the cameras round the full-size park (*On
  TV the city is a set*), not the map bent round it.

Still open:

1. **Tube glass by default?** Off, with a clean high-definition picture (recommended), or on, with a
   period television's scanlines and curved tube?
2. **Animation authoring.** Keyed clips in a new Pose Lab (recommended), or procedural motion like the
   rink's, which is quicker to build and looks less natural?
3. **Size.** Should the TV get a full-window mode? At 400×300 the arcade graphics and the
   close-ups lose the most (recommended: yes).
4. **Layout:** a 4:3 picture beside the stats rail (recommended), or full width with the stats inside
   the picture?
5. **The announcer.** Calls on whenever TV audio is on and the 3-D view is open (recommended), with
   Chip's full lines still behind the read button? Or everything behind the read button, as today?
   Or Chip calling every pitch?
6. **The mix.** Effects 9 dB under the announcer with a further 6 dB duck while the announcer
   speaks, as a starting point to set by ear in the sandbox (recommended), or another balance?
7. **Clubs:** author all sixteen? Should a club's colours follow its district, even where that matches
   the CPhL club from the same district?
8. **Parks:** one league ballpark (recommended), or a park per club later?
9. **Time of day.** Follow Coldwater's clock (recommended), so a 19:00 first pitch is in the blue
   hour and the city's windows come on through the early innings, or always full night? And which
   start is right: the script's 19:00 or the playlist's 18:00, which is before sunset?
10. **The final's name.** World Series is Major League Baseball's mark. What should it be called?
    Curtain Call is the placeholder.
11. **The postseason.** Keep the one-game final (recommended for now), or add a bracket with series?
12. **The 2-D Gameday:** keep it as a "classic" option players can pick, or only as the fallback?
13. **The view's name:** "Grandstand" is a working name for the 3-D view, as "Rinkside" is the
    rink's. The park is Halcyon Field either way.
14. **A place in the world.** The park on the map in Phase 6 (recommended), and seats in person
    later?
15. **The Curtain.** Draw it as GLASS does, about 53 ft (recommended, so the TV and the windshield
    agree), or floor to sky as the prose describes it, which means changing `CURTAIN_H` for the
    windshield too?
