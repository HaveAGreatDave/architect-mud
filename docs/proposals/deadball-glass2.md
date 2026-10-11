# Deadball in GLASS 2

**Status: design, revised 2026-10-11.** A plan for giving Deadball a 3-D sub-screen the way Cluster
Puck got Rinkside, at the highest fidelity the engine can reach, presented as a 1990s arcade
cabinet. That means skinned, detailed players, authored animation, light from the park's own
towers and a crowd that fills the stands. Around them go chunky chrome lettering, splash words,
trails and fireworks, an announcer over a full synthesised sound bank, a playoff package, and a park
with a place on the map. No code for it exists yet. The questions that need an answer before Phase 1
are at the end.

How it got here, all on 2026-10-11:

- The first draft aimed at a 1990s video-game look and offered three: 32-bit console, 64-bit console
  and arcade cabinet.
- The second went to high fidelity, with a 1990s broadcast around the game.
- The third put the park outside Coldwater's South Gate, with the city beyond the outfield.
- This one takes the arcade cabinet, at high definition, using everything THOMAS, GLASS, SIREN and
  ORACLE can do. The second draft's broadcast picture stays as a preset.

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
the older 2-D-only `gameday-rink.js`. That work has to reach `main` before Phase 1 starts.

## The short version

- **Fidelity:** players of 12,000 to 20,000 triangles up close, skinned on the GPU, with faces from
  the street-figure head work, cloth with fabric normal maps, and dirt that collects on uniforms over
  a game. Animation from an authored clip library with IK for every contact (glove to ball, hands to
  bat, feet to dirt), gated by tests that measure foot slide and contact error.
- **Light:** four of the park's six light towers cast real shadows, so every player stands on a star
  of soft shadows the way he does under stadium lights. HDR, ambient occlusion, bloom, haze with
  light shafts, and a lens that throws the crowd out of focus behind a close-up.
- **The arcade cabinet:** the graphics are chunky chrome-and-flame lettering in the client's own
  display faces, count lamps, a strike-zone marker, matchup cards, and splash words on the big plays.
  The camera is the batting view from behind the plate, and the spectacle is comet trails and
  fireworks. The picture is full 24-bit colour with punchy contrast. An optional "cabinet glass" adds
  scanlines and a curved tube.
- **The whole engine:** a table maps each capability to a use, from cloth bunting and a starling
  murmuration at dusk to lightning over the skyline in an ion storm.
- **Playoffs:** the one-game final gets a gold package, a logo painted behind the plate, bunting,
  rally towels and searchlights. It ends with confetti and fireworks over the city.
- **Sound:** a high-fidelity SIREN bank of about 50 cues sits 9 dB under the announcer and ducks
  6 dB further while the announcer speaks. ORACLE calls the big plays.
- **A place in the world:** the park goes on the map outside the South Gate, lit on game nights and
  seen from the city, the road and the air. A Deadball cabinet goes in the Penny Drops.
- **The shape:** Rinkside's. A view shell with the same five methods, a world, a director that
  stages one payload, a camera, replays, a frame governor, and smoke gates that play real games.
- **What GLASS 2 has and what it needs:** it already has an HDR chain, ambient occlusion, height fog
  with light shafts and instanced, vertex-animated crowds of procedural people. It has no GPU
  skinning, no normal maps, no sRGB textures and no spotlight shadows; this plan adds them as engine
  pieces any view can use.
- **Coldwater beyond the outfield:** the park stands on the flats outside the South Gate, facing
  north-north-west, so the walled city fills the outfield: the Spire and Halcyon Towers over
  left-centre, the Curtain's band of light along the wall. The buildings are GLASS's own baked
  shapes, and the sky follows Coldwater's clock and the weather at the park.
- **The fallback:** today's 2-D Gameday view.
- **The server:** the sim stays as it is. The payload gains a small cosmetic play description chosen
  on the server, so the booth's line and the picture can't disagree. Sending the standings once a
  game instead of on every at-bat cuts about a third of the bytes the sub-screen costs.
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
| [street-figure-heads.md](street-figure-heads.md) | Head meshes at 1,840 / 696 / 232 triangles and a 2048×1280 face atlas, built but not yet drawn in the game | Drawing it, which this view would be first to do. |

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

It has no gate. `client:smoke` parses it, and nothing runs it.

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

### High fidelity, 1990s arcade cabinet

Two layers, kept apart so each can be tuned on its own.

**The game itself is drawn as well as the engine can draw it.** Detailed players and equipment,
authored motion, physically based materials, the light towers as the only lights at night, real
shadows and occlusion, a park full of people and the city beyond it. Nothing is made deliberately
crude.

**The presentation around it is a 1990s arcade cabinet.** Four parts:

- *The graphics package*:
  - slanted panels with chrome rims;
  - names and numbers in chunky lettering with an extruded edge, chrome for names and flame for runs
    and big moments;
  - the count as lamps (three green for balls, two amber for strikes, two red for outs) and lit
    bases;
  - the pitch speed in big digits;
  - a matchup card with a VS badge on a starburst for each plate appearance;
  - the strike zone drawn over the plate with the last pitch marked.

  All of it is original and drawn at the screen's own resolution, in faces the client already ships:
  Bungee and Bungee Inline for the big words, Big Shoulders Display for names and numbers, Audiowide
  for small labels.
- *Splash words* on the plays that earn them: Strike Three, Home Run, Grand Slam, Double Play, Triple
  Play, Walk-off, Safe, Out. They punch in, hold and clear, with the distance under a home run.
  `tv.js` already names these events in `_applySportsFx` (home run, grand slam, walk-off, extras,
  game win, double play, the final, champion), and the 3-D view draws its own version of each.
- *The camera grammar*:
  - every pitch from the batting view, behind and above the plate, as the cabinets did; the
    long-lens centre-field camera stays for replays and as a setting;
  - balls in play cut to high home and follow the ball;
  - home runs get a side-on angle that shows the arc, then a slow replay.
- *Spectacle*: a comet trail on fly balls, a flash at contact, fireworks over the outfield and the
  city on home runs, crowd camera flashes at night, and the scoreboard answering the play. Reduced
  motion turns all of it into still cards.

**The picture is the arcade board's, not broadcast video's.** It has full saturation, deep blacks, a
contrast curve with warm highlights over cool shadows, light sharpening and a soft vignette. An
optional "cabinet glass" setting adds scanlines, an aperture grille, a gently curved tube and rounded
corners, and moves the graphics inside a title-safe area. The second draft's broadcast picture
(lifted blacks, soft colour, the CCD smear) stays as a preset.

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
  glance, the Curtain's band separates the park from the city, and the blue hour at first pitch is
  the strongest frame of the set.
- **Arcade at high definition works.** The chrome-and-flame lettering, lamps and splash words sit
  over a fully lit scene without fighting it, and the client's own faces carry the period.
- **A home run reads side-on.** From behind home the trail foreshortens into a short streak. From
  the first-base side the whole arc shows, falling toward the Spire under the fireworks.
- **Cabinet glass needs a title-safe area.** The curved tube crops the corners, so the graphics move
  in by a tenth when it's on.
- **A sellout costs triangles.** With every seat filled the look-dev crowd reached about 6 million
  triangles. The real crowd needs its far level and cards for the distant rows (see Performance).

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
| CRT overlays and bezels | `minigame-common.js` | Cabinet glass. |
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
| `gl/ballpark.js` | GLASS | The renderer: passes, lights, materials. Returns null without WebGL2. |
| `gl/ballpark-mesh.js` | GLASS | Pure builders for the park from venue data and for equipment. Node-runnable. |
| `gl/skin.js` | GLASS | GPU skinning: bone palettes in a float texture, four weights a vertex, dual-quaternion option. New to GLASS. |
| `gl/spotshadow.js` | GLASS | Perspective shadow maps for several lights, PCF lookup as a GLSL chunk. New. |
| `gl/crowd.js` | GLASS | The instanced crowd on `actors.js`'s vertex-animation approach. |
| `gl/broadcast.js` | GLASS | Depth of field, the arcade grade and the cabinet glass, and the broadcast preset (chroma, fringing, smear). |
| `gl/cityscape.js` | GLASS | A city drawn far: buildings from the baked shapes, facades, lights, the Curtain. Names no region. New. |
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
- **Faces.** The street-figure heads at their highest level with the face atlas, plus eye black,
  stubble and beards from the name. Under a cap brim at broadcast distance a face is mostly shadow,
  so the close cameras are where faces have to hold up.
- **Uniforms.** Separate meshes for jersey, undershirt, pants, belt, stirrup socks and cleats, cut
  the way the period wore them: pants to below the knee with stirrups showing, or full length by
  player. Jerseys carry pinstripes or flannel weave, piping, a chest wordmark and tackle-twill
  numbers with a stitched edge in a normal map.
- **Wear over a game.** A per-player dirt mask on knees, seat and chest, raised by slides, dives and
  the catcher's crouch, so a uniform in the ninth shows the game.

### Equipment

Caps with a curved bill, a crown in panels, a button and an embroidered crest. Batting helmets in
glossy shell with an ear flap on the pitcher's side and a decal. Fielders' gloves with laced webbing,
a first baseman's mitt and the catcher's round mitt. The catcher's helmet, mask, chest protector and
shin guards; the plate umpire's mask and protector under his shirt. Bats with grain, a darker handle
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

Authored clips, about 120 to start:

- *Pitching*: windup and stretch per arm slot (over the top, three-quarter, sidearm), pickoff throws,
  the follow-through, fielding position after the pitch, warm-up tosses.
- *Batting*: stances, the load, swing paths for each contact height and direction, takes, check
  swings, fouls off, the bunt, the follow-through and bat drop, stepping out.
- *Catching and umpiring*: the catcher's setups, receiving and framing, the throw back, blocking; the
  plate umpire's stance, his calls and the punch-out (a few styles, one per umpire).
- *Fielding*: ready steps timed to the pitch, grounders forehand, backhand and charging, fly balls
  drifting and camping, diving and leaping catches, the double-play pivot, throws by distance.
- *Running*: leads, the first step, turning a base, slides feet-first and head-first, the trot after a
  home run, the walk-off mob.
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
are three booleans, so runners carry no names. Base coaches, an on-deck hitter and base umpires dress
the field.

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

### Running the bases and keeping in step with the sim

Runners advance from `basesBefore` to `basesAfter`, and the number crossing home is the change in
the batting side's score, not `rbi` (a run scores on a double play with no RBI). The booth doesn't
call every at-bat, so the field the picture is showing and the next payload often disagree. When
they do, the director cuts to a crowd shot or the wide camera, places everyone, and cuts back.
Rinkside's rule applies: anything that moves a man farther than he could run happens on a cut. The
half-inning payload changes sides: one team jogs off, the other takes the field, the new pitcher
throws warm-up pitches.

### Home runs and the fence

The fence comes from the venue data. A home run's landing spot is chosen beyond it, and the gate
checks it lands there. The distance graphic is computed from that spot. A walk-off gets the mob at
home plate.

### Cameras

| Shot | When |
|---|---|
| Batting view | Every pitch, as the cabinets did: behind and above the plate, the pitcher and the city beyond. |
| Centre field, long lens | Replays and close plays, and every pitch when the batting view is off. About 445 ft out and 62 ft up, offset to left-centre. |
| High home | Balls in play: follows the ball, then frames the fielder and the base. |
| Fly-ball follow | Long flies, from behind the fielder as the ball comes down. |
| First- and third-base cameras | Close-ups of the batter and the pitcher; plays at first and double plays. |
| Low home | Walk-ups, plays at the plate, the walk-off mob. |
| Cutaways | Crowd, dugout, scoreboard, the light towers, the haze. Dead time and reconciling cuts. |
| Skyline | Back from a break and between innings: high behind home with the city beyond, or the long lens on the towers over left-centre. |
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
   sharpening, the vignette. Then the cabinet glass, if it's on. The broadcast preset swaps in the
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

The park can't go inside the walls. A storey is 3.5 m, so a tile is about 17.9 m (58.6 ft, as
[glass-notes.md](../reference/glass-notes.md) has it), and the walled city is about 37 by 22 tiles,
660 by 390 m. A park with a 400 ft centre field and its stands needs about 11 by 12 tiles, a sixth
of everything inside the walls.

So it stands on the flats outside the South Gate, east of the road south: home plate at tile
(921, 936), centre field on a compass bearing of 335°. The park covers about x 914 to 927 and y 928
to 940, all red rock with nothing built on it. It fits the booth's chatter: a park built on a
landfill, wind off the flats, and haze rolling in over the left-field wall from the lake to the
west.

From home plate the whole walled city fills the outfield:

- **Past the centre-field bleachers**, about 1,000 ft out, the Curtain's south wall: a band of blue
  light along the foot of the city.
- **Over left-centre**, 1,600 to 2,400 ft away, the Glasshouse and Halcyon Fields, with the Spire
  (about 1,180 ft tall as GLASS draws it) and Halcyon Towers (about 860 ft).
- **Over centre**, KSAB's mast, Solenne Residences and the Beacon at the shoreline; **over
  right-centre**, the Meridian's crown and the Yards' cooling towers. The bay is behind the city.

The scoreboard stands over the right-field bleachers so centre field stays open to the city. The
site is content (`sports_pools.venue.site`: `{ x, y, bearing }`); the renderer draws whatever city
is around whatever site it's given.

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
- It builds one static vertex buffer when the venue loads. Each frame sets uniforms and nothing else.
- In the look-dev all 224 buildings resolved: 1,705 segments, about 66,000 triangles including the
  ground and the lights.

**Facades are drawn by one shader** from bay and storey coordinates:

- Each building has a style: glass, concrete, brick, works, grow light, Ascendant stone, or unlit for
  Old Coldwater. West is glass and money and east is brick and work, as
  [building-styles.md](../reference/building-styles.md) has it.
- A share of windows is lit. Offices light a floor zone at a time; homes light window by window.
- Once a window is smaller than a pixel, the pattern is averaged to its mean colour, so far towers
  don't shimmer.

**Lights.**

- Aircraft beacons go on the tall roofs.
- GLASS's models give the city a night signature: the Spire's blue corner runners, Halcyon Towers'
  cyan and magenta edges, KSAB's mast lights, the Beacon's beam, the sky beams over the Glasshouse,
  steam from the Yards' cooling towers and smoke from Ash Management's chimney.
- The baked shapes carry no lights. Phase 4 extends `scripts/shapes/bake.mjs` to record each model's
  lights beside its geometry into a generated `client/shared/building-lights.js`: a position as
  affine triples, a colour, and a kind (steady, blinking, beam, neon). The cold open and any far
  view then get the same lights without the windshield.

**The Curtain** uses [gl/curtain.js](../../client/game/js/panels/gl/curtain.js)'s shader on the
Curtain's tiles, at `CURTAIN_H`.

**Ground and sea.** The region's tiles are flat ground coloured by biome, with the mesas raised. The
bay is dark water, and sodium lamps line the roads.

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
  and 4 KB gzipped. It goes with the venue once per client per content revision, inside the venue's
  64 KB budget. The server helper that builds it takes a site and a radius and names no region; the
  prologue's function becomes one of its callers.
- **Code.** `building-shapes.js` is 284 KB (31 KB gzipped). It loads with the ballpark's modules on
  first mount, and the browser caches it.
- **GPU.** One static buffer of about 70,000 triangles in three draws: facades, lights, and the glow
  of the Curtain and beams. The facade shader is the only real per-pixel cost, and the city covers a
  third of the frame at most.
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
- **Around it:** no recap reel and no standings flash, as now. The Penny Drops cabinet's attract
  loop shows the champion until the next season opens.

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

`phase` (regular or final), both seeds and the season number, once a game. A series would add the
game number and the series score.

## A place in the world

### The park on the map

Today the park exists only on television. Putting it on the map:

- **The site.**
  - Its 182 tiles are irradiated red rock, radiation 30 to 38, which makes them high danger.
  - There are twelve spawn points for ferric striders and rust bulls, and glass ticks along y 924.
  - Home plate's tile is already named the Ironpan, which would make a good name for the park.
  - The footprint loses its spawns and most of its radiation (the landfill was capped). The forward
    picket to the north stays as it is.
- **Getting there.** A player can already walk out of the South Gate and across: through the lock
  from 911,919 to 922, then down the road south. The park's gate faces that road from three tiles
  east, with a short spur.
- **The tiles.**
  - A new `ballpark` building type gets its `TYPE_FLOORS` row.
  - The gate and turnstiles form the entrance tile, with its connections. The concourse, the seating
    sections and the press box are interior zones.
  - The tiles keep `district: 'wilds'`. A district of their own would need a connection file for
    every boundary edge, because content lint treats each one as a Curtain crossing.
  - `sitecheck.mjs` has to be given the coordinates, because its sweep stops at y 921.
- **The model.** No GLASS model draws across tiles; each arm gets only its own tile.
  - The closest precedent is the South Lock: the server flood-fills up to 64 `gate_lock` tiles into
    one hall and tells each tile which slice to draw.
  - The park takes the same route with a `ballpark` fill, either with a higher cap or filled in
    quadrants. Each tile draws its slice of the bowl, the field, the stands and the towers.
  - The shapes bake records it, so the cold open, collision and the skyline see it too.
- **Game nights.** A cell bit derived from `broadcast.getNextOnAir` switches the light towers on.
  - It follows the lockdown's red lamps and the anti-aircraft batteries' state, which both work this
    way.
  - Only lights can change per tile, not geometry, and open freelook views need the bit pushed to
    them.
  - From the city, the park glows on the flats past the Curtain.

### Watching in person

A seat can't be a vantage, because a vantage always opens the city view over its own tile. The TV
route can open a different scene. So a seat is a `broadcast_receiver`-style fixture, as Reel
Estate's cinema screen is.

- It opens the 3-D view from that section's camera, with no broadcast graphics.
- The public address and the crowd are heard live.
- Tickets are bought at the turnstile, and a foul ball into your section could become an item.

This is the largest piece of the place-in-the-world work and comes last.

### The cabinet at the Penny Drops

The Penny Drops (910,915) is already an arcade, and its "four upright cabinets with violet-edged
screens" only take `examine`. A fifth, a Deadball cabinet, is furniture that opens the 3-D view in
cabinet mode.

- **While Deadball airs:** the game, live.
- **Otherwise:** the attract loop, with the league's leaders as a high-score table, the next game
  and the last game's highlights.
- **Later, perhaps:** a playable home-run derby on the same renderer. That's a separate design,
  covering input, scoring and rewards.

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
| Season phase and seeds | missing | add `phase`, both seeds and the season number, once a game |

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
| Everything else | about 70 KB | about 70 KB |
| Total | about 115 KB | about 83 KB |
| Club set and venue, with the skyline manifest | none | once per client per revision, held under 64 KB (the manifest is about 15 KB) |

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
| `gl/cityscape.js`, the light bake, `sky-keys.js` | GLASS and THOMAS (engine) | Any city around any site, from shapes and a manifest. A second game's city works the same way. |
| The skyline manifest helper | THOMAS (engine) | Builds the buildings around a site and radius from the in-memory world; names no region. |
| The park's site and bearing | Architect (content) | `sports_pools.venue.site`. |
| The arcade graphics package and the particles | THOMAS and GLASS (engine) | `diamond/hud.js` draws panels, lamps, cards and splash words from a theme, and `gl/spectacle.js` draws particles. Neither names Deadball. |
| The package's theme: words, colours, faces, the final's gold | Architect (content) | With the venue and club data. |
| The postseason format | broadcast plugin | The sport module and `plugins/sportsleague`. |
| SIREN and ORACLE changes | THOMAS (engine) | Ducking, the announcer channel, better noise, pan and sends help every view. |
| The bank, the call words, the announcer's voice | Architect (content) | `deadball-sfx.js`, the words, a Voice Lab preset. |
| The park on the map, the seats, the cabinet | Architect (content) | Zones, connections, furniture and a model arm in the region's file. The game-night cell bit is engine. |
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
| Effects: bat, leather, ball, running, the cabinet's stings | -9 dB | ducked a further 6 dB |
| Music: the organ and the jingles | -12 dB | ducked a further 6 dB |
| The crowd bed and the park's ambience | -14 dB | ducked a further 4 dB |

The duck uses the start time and `{duration}` that `speak()` already knows: 60 ms down, held, then
350 ms back up. The levels are defaults to set by ear in the sandbox. The player's TV slider still
scales everything, and Sound Detail still decides what plays.

### Engine work in SIREN and ORACLE

Split off into its own plan, [siren-fidelity.md](siren-fidelity.md), so it can go ahead on its own
and every view gains from it: a master limiter, ducking per bus, speech channels that typing doesn't
cancel, a voice and effects pair under the tv bus, stereo noise in three colours with random
offsets, working shelf and peaking filters, per-layer pan, per-cue reverb sends, an open-air
ballpark room, and Voice Lab presets that save. The bank below assumes that work has landed.

### The bank

`client/shared/deadball-sfx.js` follows the `hockey-sfx.js` pattern (`def`, `variant`, group
`deadball`) and loads before `sfx-catalog.js`. It holds about 50 cues, each built from several
layers and seeded per event, so no two cracks are the same:

- **Contact:** the barrel's crack, the end of the bat, a jam off the handle, a foul tip, a bunt, a
  broken bat. The wood's body modes come from `formants`, the crack from shaped noise and the ring
  from FM.
- **Leather:** the catcher's mitt pop, a fielder's glove, the first baseman's stretch, the tag.
- **The ball:** a short hop on the dirt, a roll on the grass, the padded wall, the foul pole's ring,
  the backstop net, a clatter in the seats.
- **Running:** cleats on dirt, a slide, a collision at the plate.
- **The park:** the Curtain's hum past the outfield, the towers' buzz and a dead lamp's flicker, the
  Beacon's foghorn across the flats, wind off the flats, acid drizzle on the roof.
- **The crowd:** a stereo bed that follows the game, a swell on contact, a roar, a groan, boos, a
  gasp, the "ooh" of a near miss, rhythmic claps, the towel wave in the final.
- **The cabinet:** splash stings in FM brass, the count lamps' click, the speed readout's beep, the
  trail's whoosh, the replay's rewind, the inning sweep, the attract loop's coin drop.
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
| `scripts/shapes/ballpark-smoke.mjs` | shapes | Pure, no GPU: meshes finite and inside each level's budget, the park from venue data, GL matrices against the pure projection, skin weights summing to one, texture budgets. |
| `scripts/shapes/anim-smoke.mjs` | shapes | Every clip: joint limits, no velocity spikes at blend points, planted feet sliding under 0.1 ft, hands on the bat within 0.05 ft, the glove at the ball within 0.1 ft on the catch frame, release at the release frame. |
| `scripts/shapes/diamond-smoke.mjs <slot>` | shapes, one game per gate | Real games through the world and director over the DOM stub: pitch count, each pitch at its spot, the terminal pitch matches the kind, captions held until `onLand`, fielders as the play names them, outs at the right base, runners end on `basesAfter`, runs equal the score change, home runs land past the fence, no runner faster than he could run outside a cut, ball and fielder in frame, replays start and hand back, sounds played. |
| `scripts/content/build-deadball-clubs.mjs --check` | content | The row matches the script, sizes inside budget, colours hex. |
| `scripts/audio/deadball-bank-smoke.mjs` | audio | Every cue builds from known layer fields, its summed peak gain stays under its group's ceiling, and every call fits ORACLE's shout length. |
| `plugins/broadcast/regress.js`, the postseason | regress | `phase` and the seeds on payloads, the final scheduled on an air day, the #1 seed at home. |
| `scripts/shapes/smoke.mjs` and `sitecheck.mjs`, the park | shapes, content | Phase 6: every slice of the park draws without throwing, and its gate passes the site checks. |
| `scripts/shapes/cityscape-smoke.mjs` | shapes | Pure: every building in the venue's manifest resolves to a shape, sizes match the windshield's, nothing built stands inside the park, the Curtain's segments are where its tiles are, the light bake is fresh. |
| `plugins/broadcast/regress.js` | regress | `sport`, `bats`, `throws`, `hold` present; `play` consistent with the kind; standings once a game; bare pools direction-free; a recorded hash of a hundred seeded games unchanged. |

`client:smoke` and `imports:smoke` cover new files without being asked. Each gate stays inside the 60
s CPU budget. A triple play comes up in about one game in 540, so the diamond gate also feeds one
synthesised triple-play payload. No gate draws a real frame (the DOM stub has no WebGL), so a sandbox
page, `tools/sandbox/deadball-park-test.html`, runs the real sim and assembler into the real view for
screenshots and tuning by hand, as `hockey-rink-test.html` does.

## Phases

Each phase ends with its gates green and the sandbox showing it.

**Phase 0: groundwork.** No visible change.
- Standings once a game; `sport`, `bats`, `throws`, `hold`, `phase`, the seeds and the park's weather
  on payloads.
- The audio engine's duck nodes, limiter and announcer channel; the bank moved out of gameday.js;
  `gameday-smoke.mjs`; the sandbox page.
- Tested by: broadcast regress, the new gates, egress re-measured.

**Phase 1: the park, the light and the look.** Behind a flag (a localStorage key).
- `gl/ballpark.js` on `hdr.js`, `fog.js` and a matrix-based `ssao.js`; `gl/spotshadow.js`; sRGB,
  normal and roughness maps; the park from venue defaults; the dirt canvas; the arcade grade and the
  cabinet glass; the cameras, starting with the batting view.
- The arcade graphics package, still: panels, lamps, cards, the zone marker.
- Players as static, posed meshes at final quality, so lighting and materials are judged on the
  real models.
- The park's site and the skyline manifest; `gl/cityscape.js` with the facades and the Curtain, at a
  fixed hour.
- Tested by: `ballpark-smoke`, `cityscape-smoke`, sandbox screenshots, GPU timings on two machines.

**Phase 2: skinned players and the pitch.** Behind the flag.
- `gl/skin.js`, the rig, `diamond/anim.js`, the Pose Lab, the pitching, batting, catching and
  umpiring clips; every pitch result staged; strikeouts and walks in full, with their calls and
  splash words.
- Tested by: `anim-smoke`, `diamond-smoke` (pitches, counts, captions).

**Phase 3: balls in play.** Behind the flag.
- `synthPlay` and the suffixed pools; fielding, throwing, running and sliding clips; ball flight with
  spin; reconciling cuts; the half-inning changeover; the play cameras.
- `gl/spectacle.js`: trails, contact sparks and fireworks; the side-on home-run camera; splash words
  for every play that earns one.
- Tested by: `diamond-smoke` in full, regress for the play and the season hash.

**Phase 4: the broadcast.** On by default wherever WebGL2 and float targets work.
- `gl/crowd.js` with seated and reaction clips; replays in slow motion; dead-time rituals; the grounds
  crew in the fifth; reduced motion; the tiers and the governor.
- The full bank and the mix; the umpire, the public address and the vendor.
- The sky on Coldwater's clock and the park's own weather; the light bake and the city's lights,
  beams and steam; birds.
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
- The park on the map: the type, the tiles, the fill, the model, the game-night lights, the site
  cleaned up.
- The Penny Drops cabinet with its attract loop.
- Seats in person, last.
- Tested by: `shapes:smoke`, `sitecheck.mjs`, `content:lint`, a walk out of the gate in regress.

**Phase 7: optional.** A longer postseason; a playable home-run derby on the cabinet; a pitch-by-pitch
booth; a park per club; the batter's season line; the throwback presets; the same lighting for
Rinkside; the skyline dimming with the power grid.

## Risks

- **The art and animation are the work.** A rig, a Pose Lab and about 120 keyed clips is more effort
  than all the code around them, with no motion capture to start from. Phase 2 stages only pitches so
  the pipeline is proved on the motion viewers see most.
- **Faces in close-ups.** The street-figure heads have never been drawn in the game. If they don't
  hold up at the first-base camera's distance, close shots stay on the uniform and the action.
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
- **The announcer cut off.** Today every typed command cancels speech and each `speak()` cancels the
  last. An announcer needs its own channel before Phase 2's calls.
- **Loudness.** The master has no limiter. Fireworks, a roaring crowd and a shout together can clip
  until Phase 0's limiter lands.
- **Spectacle and comfort.** Fireworks, flashes and splash words can get to be too much. Reduced
  motion turns them into stills, nothing flashes more than three times a second, and the crowd's
  camera flashes stay small.
- **Scope.** Seats in person and a playable derby are each a feature of their own. Both come last or
  as options.
- **The park isn't on the map.** Until Phase 6 puts it there, a player who flies or drives south of
  the gate finds red rock where the broadcast shows a ballpark. Putting it there means clearing the
  site's radiation and spawns and raising the 64-tile fill cap.
- **The Curtain's height.** GLASS draws it 0.9 tiles tall, about 53 ft, though its comment in
  `windshield.js` and the zones' prose call it taller than anything in the city. The broadcast draws
  what GLASS draws, so the two agree, until someone decides otherwise for both.

## Questions for you

1. **Cabinet glass by default?** Off, with a clean high-definition arcade picture (recommended), or
   on, with scanlines and the curved tube?
2. **Animation authoring.** Keyed clips in a new Pose Lab (recommended), or procedural motion like the
   rink's, which is quicker to build and looks less natural?
3. **Size.** Should the TV get a full-window cabinet mode? At 400×300 the arcade graphics and the
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
13. **Name:** "Grandstand" is a working name for the view, as "Rinkside" is the rink's.
14. **The site and its name.** The flats outside the South Gate (recommended), named for the tile
    already there, the Ironpan?
15. **A place in the world.** The park on the map in Phase 6 (recommended), the Penny Drops cabinet
    (recommended), seats in person (later), a playable home-run derby (optional)?
16. **The Curtain.** Draw it as GLASS does, about 53 ft (recommended, so the TV and the windshield
    agree), or floor to sky as the prose describes it, which means changing `CURTAIN_H` for the
    windshield too?
