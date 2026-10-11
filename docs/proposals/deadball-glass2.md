# Deadball in GLASS 2: a 90s ballpark

**Status: design, 2026-10-11.** A plan for giving Deadball a 3-D sub-screen the way Cluster Puck
got Rinkside, drawn to look like a mid-to-late-1990s baseball game on a television of the time.
No code for it exists yet. The questions that need an answer before Phase 1 are at the end.

Read with [systems-broadcast.md](../systems-broadcast.md#sports--two-codes-one-pipeline) (the sports
pipeline, Rinkside and the CPhL's clubs), [bsm-format.md](../bsm-format.md) (how the booth's lines
are authored), [glass-notes.md](../reference/glass-notes.md) (GLASS 2's traps) and
[engine-plugin-boundary.md](engine-plugin-boundary.md).

**It depends on the Cluster Puck branch.** Rinkside's GLASS 2 renderer
([gl/arena.js](../../client/game/js/panels/gl/arena.js)), the club seam
([club-crest.js](../../client/game/js/panels/club-crest.js)), the CPhL build script and the
hockey pacing are on `cphl-club-identities` and `ccr-91a64fd1-pbqpbt`, not on `main`. Main has
the older 2-D-only `gameday-rink.js`. That work has to reach `main` before Phase 1 starts.

## The short version

- **The look:** recommend the 32-bit console look (look A below): a 320×240 picture with wobbling
  textures, jittering vertices, 15-bit colour with ordered dithering, Gouraud lighting and the
  ballpark's own radioactive haze as the fog. Scale it up with sharp bilinear, keep the period's
  broadcast graphics, and draw text at the screen's own resolution so it stays readable.
- **The shape:** the same as Rinkside. A view shell with the same five methods, a world, a
  director that stages one payload, a camera, replays, a frame governor and smoke gates that
  play real games headlessly. The renderer is new (`gl/ballpark.js`) and the 90s pipeline is a
  separate GLASS piece any view can use (`gl/retro.js`).
- **The fallback:** today's 2-D Gameday view. It already works, so it becomes the no-WebGL2 path
  and keeps its place as a player option if you want one.
- **The server:** the sim stays as it is. The payload gains a small cosmetic play description
  (where the ball goes, who fields it) chosen on the server, so the booth's line and the picture
  can't disagree, plus a handful of small fields. Sending the standings once a game instead of on
  every at-bat cuts about 40% of the bytes the sub-screen costs, which more than pays for
  everything added.
- **The clubs:** yes, Deadball should use the club seam: caps, home whites, road greys and a
  crest each, built by a script the way the CPhL's are. At 320×240 a uniform is the only way to
  tell the two sides apart.
- **Five phases**, the first two behind a flag. Each ends with a gate that plays real games.

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
- `rig.js` is a 21-joint skeleton with strides, shots, punches and ragdolls.
- `figure.js` and `render.js` are the 2-D canvas renderer used when there's no WebGL2.

GLASS 2 draws it through [gl/arena.js](../../client/game/js/panels/gl/arena.js) and
[gl/arena-mesh.js](../../client/game/js/panels/gl/arena-mesh.js) (bodies rebuilt from the joints
every frame, a 1024² jersey atlas), with [gl/mirror.js](../../client/game/js/panels/gl/mirror.js)
for the ice, [gl/stream.js](../../client/game/js/panels/gl/stream.js) for vertex streams and
[gl/programs.js](../../client/game/js/panels/gl/programs.js) for shader prewarming. The frame
governor steps down resolution, then mirror size, then bodies in the reflection, on a smoothed
frame time (over 24 ms for 1.2 s steps down; under 15 ms for 8 s steps up).

Two gates cover it. [rink-smoke.mjs](../../scripts/shapes/rink-smoke.mjs) plays two real games
(the real sim and narrator) through the view over a DOM stub with no WebGL, so it drives the 2-D
renderer, and checks that the picture agrees with the sim. [arena-smoke.mjs](../../scripts/shapes/arena-smoke.mjs)
checks what GLASS 2 stands on without a GPU: the GL matrices match the 2-D projection to a
hundredth of a pixel, every body builds finite and inside its triangle budget, and the renderer
returns null when there's no WebGL2.

Things Rinkside doesn't do, which this plan does and could hand back: it never calls
`loseContext()` when it's closed (the browser caps a page at 16 contexts; see
[glass-notes.md](../reference/glass-notes.md#releasing-gl-scenes-2026-09-17)), it keeps drawing
while the tab is hidden, and it doesn't read `prefersReducedMotion()`.

### Deadball's Gameday view

[gameday.js](../../client/game/js/panels/gameday.js) is a top-down, 2-D field in HTML and SVG,
beside a 176 px rail (count, pitch plot, matchup, play card, standings). Per payload it:

- plays the server's pitches one every 2.6 s at most, 13 s in all, each a 340 ms ball from mound to
  plate, with the count from each pitch;
- derives where the ball goes on the client, from a hash of the batter, inning and pitch
  (`_hitTrajectory`): an angle, a depth from the kind, and a fielder picked by angle;
- runs the bases one at a time, peels scoring runners off to the dugout, and lights the bases to
  match `basesAfter` once it settles;
- holds the caption and any card until the play lands, then idles (pitcher jitter, fielders
  shifting) until the next payload;
- plays nine inline SIREN layers (`mitt`, `crack`, `whiff`, `glove`, `base`, `run`, `homer`,
  `strikeout`, `out`) on the `tv` category.

It has no gate. `client:smoke` parses it, and nothing runs it.

The sim, [baseball.js](../../plugins/broadcast/sports/baseball.js), resolves plate appearances
only: thirteen kinds (strikeout, groundout, flyout, popout, single, walk, double, triple, home
run, double play, triple play, sac fly, productive out), base advances, extra innings and
walk-offs. It has no pitches, hit direction, fielders, errors, steals or substitutions.
`synthPitches` makes the pitches afterwards, as cosmetic keyframes seeded from the game, ending on
the pitch the kind needs. The assembler, `assembleSportsGraph` in
[index.js](../../plugins/broadcast/index.js), puts a `gameday` payload (`beatGameday`) on the
lead line of each called at-bat and a `phase: 'half'` payload on each half-inning's framing line.
Baseball has no `narrate`, no `paceCalls` and no cues: every game line holds the same time.

### The club seam

`sports_pools.clubs` on a broadcast row holds each club's identity: colours, a vector crest,
`kit.home` and `kit.road`, and optionally a tartan sett. [build-cphl-clubs.mjs](../../scripts/content/build-cphl-clubs.mjs)
writes the CPhL's and fails `--check` when the row is stale. Payloads carry a `clubsRev` stamp,
the client asks once with `tv_clubs` and keeps the set in localStorage per sport. Only hockey
uses it: `clubsRevOf` lives in `hockey.js`, and `sendTvClubs` assumes hockey when no sport is
given. Deadball's row has teams and no clubs.

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

So a game is about 87 payloads, not 300, and about 115 KB per viewer with the sub-screen open.
The standings in every payload are the same rows all game (`gdStandings` is computed once when the
graph is assembled), about 0.5 KB each time.

A line holds `slot × 0.85 ÷ lines`, between 10 and 90 seconds. At `timeScale` 1 (a three-hour
slot) that's about 66 s a line; at `timeScale` 3 (one hour) about 22 s. The 3-D view has that long
for each at-bat and then waits for the next one.

## The look

### What "90s" means here

The parts of mid-to-late-1990s 3-D baseball games, and of the TV they imitated, worth having:

- low-poly players built from rigid segments (a box or prism per limb, 200 to 400 triangles);
- flat or Gouraud (per-vertex) shading, lights that pool on vertices;
- small textures (16 to 64 px) with nearest-neighbour sampling, and on 32-bit consoles, affine
  texture mapping (textures swim across big polygons) and vertices snapped to whole pixels
  (geometry jitters as the camera moves);
- 15-bit colour with ordered dithering;
- fog and a short draw distance;
- a low internal resolution (320×240) scaled up into big pixels;
- a 4:3 picture, and a CRT's scanlines and soft glow;
- the broadcast graphics of the time: a bevelled score box, pitch speed, the count, the batter's
  lower third, a REPLAY bug, and the centre-field camera behind the pitcher.

What we don't copy: any real game's interface, any real league, team, player, wordmark or network
graphics package. The score box is a generic bevelled panel; the clubs are Deadball's.

### Three looks

A throwaway mockup (one HTML file, kept out of the repo) drew the same park and eleven figures
(pitcher, batter, catcher, umpire and seven fielders) three ways in headless Chromium. The frames
are on the review page.

| | A. 32-bit console | B. 64-bit console | C. Arcade cabinet |
|---|---|---|---|
| Period | PlayStation era, mid-90s | N64 era, late-90s | arcade boards, mid-90s |
| Internal picture | 320×240 | 320×240 | 512×384 |
| Textures | nearest, no mips, affine (they swim) | bilinear, mipmapped, perspective-correct | nearest, perspective-correct |
| Vertices | snapped to whole pixels (jitter) | smooth | smooth |
| Shading | Gouraud | Gouraud | flat, per face |
| Colour | 15-bit, 4×4 ordered dither | 15-bit, light dither | 24-bit, saturated |
| Fog | the haze, from about 260 ft | thick, from about 110 ft | thin, far |
| Scaling up | sharp bilinear | bilinear (soft) | sharp bilinear |
| Graphics | bevelled box top left, speed bottom right | a strip along the bottom | big chunky digits |
| What it's good at | the most recognisably 90s; the haze reads as the park's | calm, soft, easy on the eye | the crispest; the ball is easiest to see |
| What's against it | wobble and jitter can bother people; dither is noisy at small sizes | soft at the TV's size; looks low-res more than retro | the least lo-fi; at the TV's size it barely looks blocky |

**Recommendation: A, tempered.** It's the one people will recognise, and two of its features fit
what the booth already says: Chip's chatter has the haze rolling in over the left-field wall and
the lights working "maybe sixty percent of the time", so the fog and the dead light banks are the
park's own. Tempered means: affine mapping on, kept in check by subdividing big polygons (the
period's own fix); vertex snapping at half strength by default, with full strength as an option;
dithering on; no CRT at the TV's normal size. The three looks are one set of knobs (resolution,
snap, affine, filter, colour bits, dither, fog, shading), so B and C stay one preset away.

### Readable at the TV's size

The TV window is at most 760×520 CSS px, and the sub-screen's picture area beside the rail comes to
about 400×300 for a 4:3 picture. The mockup was rendered at that size too. What it showed:

- **Scale by a whole number, then smooth the rest.** 320×240 into 400×300 is 1.25×. Nearest
  neighbour makes every fourth row and column double width, which reads as a fault. Sharp bilinear
  (nearest to the largest whole multiple that fits, then bilinear for the remainder) keeps the
  pixels square and even. At 1× it's plain bilinear; on a 2× display it's 2× nearest plus a little.
- **Scanlines need room.** At 1.25 device pixels per line they beat against the screen grid into
  moiré bands. Draw them only at 3 or more device pixels per line (big screen, a large window on a
  high-density display), and use a faint vignette and mask otherwise.
- **The ball is one or two pixels.** Draw it two to three times its real size, with a blob shadow on
  the grass the whole way, as the period's games did. The shadow is how a viewer judges a fly ball.
- **A real centre-field camera can't work here.** Television puts it 400 ft out on a long lens;
  with a short draw distance it would be looking through 400 ft of haze. About 120 ft back and
  15 ft up with a 19° lens frames pitcher, batter, catcher and umpire, and keeps the plate clear of
  the pitcher's body. The period's games did the same.
- **Text is drawn at the screen's resolution, never in the 320×240 picture.** The score box, pitch
  speed and lower thirds go on a 2-D canvas over the GL one (as Rinkside's `.gdr-hud` does), in a
  bitmap font scaled by whole numbers, no smaller than 10 CSS px. The rail and the header stay HTML
  and stay the source a screen reader reads.

## Architecture

### What carries over from Rinkside

| Piece | Carry over? | Notes |
|---|---|---|
| View shell and its five methods | yes | `gameday-grandstand.js` (working name Grandstand). tv.js changes one line: baseball mounts it, and it falls back to the 2-D view on its own. |
| Lazy loading | yes | Heavy modules load on first mount, as Rinkside's do, so tv.js stays cheap. |
| World stepped on a fixed clock | adapted | 60 Hz is enough: the fastest thing is a pitch at about 140 ft/s, 2.3 ft a step, and contact is scripted. |
| Director: one payload in, `onLand` out | yes | The core of it. Stagers per kind instead of per hockey beat. |
| "Nothing on the field decides anything" | yes | Between beats nobody throws a pitch, since a pitch changes the count. |
| Names on bodies, numbers from names | yes | Batter and pitcher numbers come from their names, so every viewer sees the same back. |
| Cosmetic randomness seeded from the payload | yes | Same rule, same trap: a `rand()` added to the sim replays the season. |
| Camera that never rolls, framing solved from points | yes | Points to frame: ball, fielder, target base. Long moves cut. |
| Camera written out as GL matrices, checked against a pure projection | yes | The arena-smoke pattern. |
| Replay buffer, 30 Hz, half speed, own camera | yes | Different triggers: home runs, double plays, triples, walk-offs. |
| Frame governor with renderer-supplied rungs | yes | Different rungs (below). |
| Vertex streams, programs prewarm | yes | `stream.js`, `programs.js` unchanged. |
| Mirror pass | no | Grass doesn't reflect. |
| Ice canvas with dirty tiles | no | A park's dirt could take marks (slides, spikes) later; not needed. |
| 21-joint procedural rig, IK, ragdolls | no | A smaller rig with keyframed poses suits the period. |
| 2-D renderer of the same world | no | The fallback is the existing Gameday view. |
| HUD canvas over the GL canvas | yes | Same layering, period graphics. |
| Smoke gates over a DOM stub | yes | Two new gates on the same pattern, plus one for the 2-D view. |

### Files

| File | Side | What it holds |
|---|---|---|
| `client/game/js/panels/gameday-grandstand.js` | THOMAS | The shell: same interface, frame loop, governor, fallback, caption and cards. |
| `client/game/js/panels/diamond/geo.js` | THOMAS | The field in feet: plate at the origin, bases, mound, foul lines, a fence profile read from the venue data. |
| `diamond/world.js` | THOMAS | Bodies, the ball, the bases' occupancy, events. Between beats: rituals, never a pitch. |
| `diamond/director.js` | THOMAS | Stages a payload: walk-up, pitches, the play, running, landing, reconciling. |
| `diamond/rig.js` | THOMAS | About 15 joints and a pose library: stance, set, windup, stretch, delivery, swing, take, crouch, run, throw, catch, dive, slide. |
| `diamond/camera.js` | THOMAS | Shots and cuts (below), and `matrices()`. |
| `diamond/replay.js` | THOMAS | The replay buffer and its stand-in world. |
| `diamond/hud.js` | THOMAS | The period graphics on the HUD canvas, drawn from data. |
| `gl/retro.js` | GLASS | The 90s pipeline as a reusable piece: low-res target, shader snippets for snapping and affine mapping, colour quantising and dither, sharp-bilinear upscale, CRT pass. |
| `gl/ballpark.js` | GLASS | The renderer: park, crowd, bodies, ball, shadows, through `retro.js`. Returns null without WebGL2. |
| `gl/ballpark-mesh.js` | GLASS | Pure builders (no WebGL), so the gate runs them in node: park from venue data, bodies from joints, ball, bat, shadows. |
| `client/shared/deadball-sfx.js` | Architect | The Deadball sound bank, moved out of gameday.js (see Audio). |

### The 2-D fallback

With no WebGL2, a shader that won't build or a lost context, the Grandstand mounts the existing
`createGamedayView` in its own host and re-applies the last payload. A play in progress restarts in
2-D; nothing is lost but the half-second it was showing. The 2-D view stays maintained, and Phase 0
gives it the gate it never had.

## What baseball needs that hockey didn't

### A pitch

The payload already carries everything a pitch needs: type, speed, where it crosses the plate (`x`,
`y`), the result (ball, called strike, swinging strike, foul, in play) and the count after it.

- **Location is exact.** The pitch is a curve from the release point (about 54 ft from the plate,
  6 ft up, on the pitcher's throwing side) to the payload's `x`, `y` mapped onto the plate and the
  batter's zone. The curve's middle bends by pitch type (a slider sweeps, a curve drops, a sinker
  runs), and its end doesn't move. The gate checks every pitch crosses within 0.05 ft of its spot.
- **Speed is real.** 54 ft at 95 mph is 0.39 s; at 75 mph, 0.49 s. Never slow the ball down to fit
  a hold; cut rituals instead.
- **Each result has its own picture.** Ball: no swing, the catcher takes it. Called strike: no swing,
  the umpire calls it, with the period's punch-out on strike three. Swinging strike: swing and miss,
  the ball in the mitt. Foul: contact, the ball back into the screen or over a dugout into the
  stands, chosen from the pitch's seed. In play: the play.
- **The plot and the picture mirror each other.** The rail's pitch plot is the catcher's view; the
  centre-field camera looks the other way, so a pitch on the plot's left crosses on the screen's
  right. That's how television does it. Don't flip either one to make them agree.
- **Handedness comes from the name.** The sim doesn't say who bats left. A hash of the name gives
  bats and throws, the same all season. It decides the batter's box, the pitcher's arm, which way a
  breaking ball breaks, and the batter's pull side. The server works it out once and puts `bats`
  and `throws` on the payload, so client and server can't disagree.

### Pacing an at-bat

A pitch with its rituals (the set, the delivery, the reaction, the throw back) is about 4 s. Four
pitches with their rituals and an outcome fit easily in a 66 s hold; in 13 s the rituals have to
go, as they do in the 2-D view today. The director gets a budget of 0.45 × `hold`, kept between
13 s (today's figure, and the budget when a payload carries no `hold`) and 26 s, and spends it in
this order: pitches at real speed first, then reactions, then the set, then the throw back. Late joiners
(a catch-up payload) get the short version. The play lands, `onLand` fires, the caption and the
card go up, and the rest of the hold is replays and dead time.

The booth keeps one line per at-bat: no new lines, no new egress. The rail shows each pitch as it's
thrown ("88 SLIDER, swinging, 1-2"), generated from the payload the picture uses, so a viewer who
can't see the picture still gets every pitch. A pitch-by-pitch booth (Chip calling "the 1-2
pitch... swung on and missed", timed by cues the way Cluster Puck's touches are) is Phase 5 and a
question for you: it's the more authentic broadcast and about three times the lines in the log.

### The people

- **Pitcher, catcher, batter and plate umpire** are always in shot from centre field, so they get the
  most detail: the close tier (about 700 triangles) on the low cameras, 400 elsewhere.
- **The seven other fielders** play straight-up positions by default, shaded toward the batter's
  pull side. Their numbers come from team and position, stable for the game. Lineups aren't in the payload and
  the picture doesn't need them.
- **Runners** take leads, run on contact and slide. The sim's bases are three booleans, so runners
  carry no names. Base coaches and an on-deck batter are optional dressing.
- **Base umpires** (one at first and one at third is enough at this resolution) make the out and
  safe calls.

The rig is about 15 joints with each limb a rigid segment, and poses come from a small library of
keyframes. A look knob samples poses at 15 Hz while positions and the camera stay smooth: the
period's games animated on twos, and it reads as theirs immediately.

### Balls in play

The server chooses the cosmetic play (see Server changes) and the director stages it:

| Kind | What the picture does |
|---|---|
| Groundout | Grounder to the named infielder, fielded, thrown to first ahead of the runner. A first baseman's ball is unassisted. |
| Flyout, sac fly | Fly to the named outfielder at the named depth; he drifts under it and catches it. On a sac fly the runner on third tags and scores. |
| Popout | Pop-up to an infielder or the catcher, fair or foul. A foul pop near the stands is the drama. |
| Single | Grounder through a hole, a liner or a bloop. The outfielder fields it and throws to the cutoff. |
| Double | To a gap or down a line, off the wall or rolling to it. Throw to second, the batter in standing or sliding. |
| Triple | Into a corner or splitting the outfielders, a carom, a slide into third. |
| Home run | Over the fence at the chosen spot and depth into the stands. The outfielder goes back to the wall and watches it go. |
| Double play | 6-4-3, 4-6-3 or 5-4-3 as chosen, with a pivot at second. A runner on third scores when the sim says so. |
| Triple play | Always 5-4-3, around the horn. Two of the script's four triple-play lines say so (a ground ball to the left side; third, second, first) and the other two don't say where. |
| Productive out | A grounder that moves the runners up. One of the three lines puts it on the right side, so that line airs only when the play goes there. |
| Walk | The batter drops the bat and jogs to first; forced runners move up. |
| Strikeout | The punch-out or the swing. With nobody on, the infield throws it around the horn. |

Ball flight is a parabola with drag shaping, bounces with energy loss, and caroms off the wall from
the fence profile, all from the play's seed. The ball goes where the play says because the play
fixes where it lands; physics only shapes the path between.

### Running the bases and keeping in step with the sim

Runners advance from `basesBefore` to `basesAfter`, and the number crossing home is the change in
the batting side's score, not `rbi` (a run scores on a double play with no RBI). The 2-D view's
rules for who goes where already work and carry over.

The booth doesn't call every at-bat, so the field the picture is showing and the next payload's
`basesBefore`, outs and batter often disagree. When they do, the director cuts (to a crowd shot or
the wide camera), places everyone, and cuts back. Rinkside's rule applies: anything that moves a
man farther than he could run happens on a cut.

The half-inning payload clears the field: the side that was in the field jogs off, the other side
takes the field, the new pitcher throws warm-up pitches (which decide nothing) and the camera shows the scoreboard and
the crowd. The 2-D view's half card stays as the rail's card.

### Home runs and the fence

The fence comes from the venue data: distances at the lines, the alleys and centre, and wall
heights. A home run's landing spot is chosen beyond it, and the gate checks it lands there. The
period's graphics can show an estimated distance; it's computed from the landing spot, so it
agrees with the picture. A walk-off gets the mob at home plate.

### Cameras

The period's broadcast grammar, kept small:

| Shot | When |
|---|---|
| Centre field, behind the pitcher | Every pitch. Offset to left-centre so the pitcher doesn't hide the plate. |
| High home | Balls in play: follows the ball, then frames the fielder and the base the throw goes to. |
| Fly-ball follow | Long flies: from behind the fielder as the ball comes down to him, shadow first. |
| First-base side | Plays at first and double plays. |
| Low home | Walk-ups, plays at the plate, the walk-off mob. |
| Cutaways | Crowd, dugout, scoreboard, the light towers, the haze over the left-field wall. Dead time and reconciling cuts. |
| Replay | Reverse angles at half speed. |

The camera never rolls. A big move is a cut. Framing is solved from the points that must be seen,
as Rinkside's is, and the gate fails if the ball and the fielder aren't both in frame at contact and
at the catch.

### Between beats

A hold is mostly dead time, which is real baseball. The world fills it with things that decide
nothing: the batter steps out and adjusts his gloves, the catcher sets up, the pitcher shakes off a
sign, a throw over to first that the runner beats back, a mound visit, the next batter in the
on-deck circle, cutaways. No pitch is thrown and no runner moves up between payloads.

### Replays

Home runs, double and triple plays, triples and walk-offs get a replay from a second angle at half
speed after the play lands, with the REPLAY bug. The buffer keeps poses, ball and kit like Rinkside's,
and the world plays on underneath it.

## The 90s look in GLASS 2

Everything here is a knob in a look preset, so the three looks above are three presets.

- **Low-res target.** Draw into an RGBA8 texture and a DEPTH16 renderbuffer at the preset's size
  (320×240), with no antialiasing. Fill is tiny: 77k pixels.
- **Vertex snapping.** In the vertex shader, round clip-space `xy / w` to the target's pixel grid and
  multiply back by `w`. Strength 0 is off, 1 is whole pixels, 0.5 half pixels. Camera-locked things
  (the HUD) never snap.
- **Affine textures.** GLSL ES 3.00 has no `noperspective`. Pass `uv × w` and `w` as ordinary
  varyings and divide in the fragment shader; the perspective terms cancel and leave screen-linear
  coordinates. Subdivide the ground (a 40 ft grid) and the walls so the swim stays at period size.
- **Gouraud or flat.** Light per vertex in the vertex shader: ambient, the sky, and the light towers
  as a few point lights, so light pools on vertices. `flat` varyings give the cabinet look.
- **Fog.** Per vertex, linear in distance, coloured as the haze. The far plane sits just past the
  outfield stands.
- **Colour.** Quantise to 5 bits a channel in the fragment shader, with a 4×4 Bayer offset taken
  from the target's own pixel coordinates, so the dither scales up as blocks the way the hardware's
  did. An optional palette lookup (a 32³ texture) gives a stronger limited palette.
- **Textures.** Painted on small canvases (16 to 64 px) into two 256² atlases, one for the park
  (grass, dirt, wall pads, signs, the crowd's two frames, the scoreboard) and one for kits (64 slots
  of 32×32, LRU like Rinkside's). Nearest filtering with no mipmaps for look A, bilinear with mipmaps
  for B. Never `UNPACK_SKIP_PIXELS` (Rinkside's SwiftShader trap).
- **Ground in painter's order.** Grass, dirt, lines and bases draw first with no depth test, then
  everything else with it. At 16-bit depth, layered decals would fight.
- **Shadows.** A dark blob under each player and the ball, blended. No shadow maps.
- **Crowd.** Textured tiers with two frames that swap when the crowd reacts, and a few sprite
  figures in the front rows.
- **Upscale.** Sharp bilinear into the canvas's backing store, letterboxed to 4:3.
- **CRT pass (optional).** Scanlines only at 3 or more device pixels per line, a faint aperture mask
  and vignette. No curvature (it crops the graphics) and no flicker.
- **HUD.** A 2-D canvas at device resolution over the GL canvas, period bevels, a bitmap font at
  whole-number scales.

The order of a frame: world into the low-res target, then quantise and dither (in the same pass),
upscale into the canvas, CRT if on, then the HUD canvas on top.

GLASS 2's traps all apply: fall back on any GL failure, save GL state before building a framebuffer
(a feedback loop drops draws without an error), call `loseContext()` on `clear()`, and keep any
texture under 2048 px. Check [glass-notes.md](../reference/glass-notes.md) before writing the renderer.

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
| Club identity stamp | missing | add `clubsRev` once Deadball has clubs (Phase 4) |
| Standings | the same 8 rows on every payload | send once a game (first payload and catch-up) |

### The play, and lines that agree with it

The booth's lines name directions: "rolls out to the right side", "laces one to the wall", "splits
the outfielders", "around the horn: third, second, first". The 2-D view's hashed trajectory ignores
them, so today the picture and the line can disagree. Hockey solved the same problem by having the
narrator decide cosmetic facts (a shattered pane, a helmet off) so the line and the picture agree.

- **`synthPlay(seed, kind, bases, bats)`** in baseball.js returns the cosmetic play: the zone
  (pull, centre or opposite field; which hole or gap), the trajectory (grounder, liner, fly, pop),
  the depth, the fielders in order (`[6, 4, 3]`), a landing spot for a home run. It's seeded from
  `sportsHash` with its own salt, like the pitches, and never touches the sim's random stream, so
  no game in the season changes.
- **Pools gain optional direction suffixes.** `atbat.groundout.right`, `atbat.double.wall`,
  `atbat.single.gap` and so on, falling back to the bare pool. The assembler picks the play first,
  then a line from the matching suffixed pool if it has any, else from the bare pool. No `.bsm`
  syntax changes; only pool keys.
- **The bare pools must be direction-free.** A regress check reads every bare pool for direction
  words (left, right, centre, gap, wall, line, deep, shallow, short, around the horn) and fails on
  one, so a new line can't quietly contradict the picture. The current lines that name a direction
  move into suffixed pools in Phase 2.

This adds about 60 to 80 bytes to an at-bat payload.

### Egress and read tiers

Nothing here touches a hot path or adds a query. The graph is assembled once per slot and cached
(`getSportsGraph`); `synthPlay`, handedness and the hold are computed during assembly from data
already in memory. The club set and the venue come from the broadcast row the script is already
loaded from.

Per viewer with the sub-screen open, per game, at today's sizes:

| | Today | After |
|---|---|---|
| Standings | about 87 × 0.5 KB = 43 KB | about 0.5 KB |
| Play, handedness, hold, sport | none | about 87 × 0.1 KB = 9 KB |
| Everything else | about 70 KB | about 70 KB |
| Total | about 115 KB | about 80 KB |
| Club set and venue | none | once per client per revision, held under 48 KB |

The CPhL's eight clubs are 57 KB, mostly crest path data. Sixteen Deadball clubs drawn the same way
would be about 110 KB, so the build script gets a size budget and simpler crests: a monogram and a
shape, which is what a 1990s cap carried anyway.

Log-rung viewers get none of the payloads today and get none after.

## Engine and content

Applying [the litmus tests](engine-plugin-boundary.md#litmus-tests-apply-in-order): would a second
game built on THOMAS keep it byte-for-byte?

| Piece | Side | Why |
|---|---|---|
| `gl/retro.js` | GLASS (engine) | A low-res, dithered, snapped pipeline knows nothing about baseball. Any view could use it. |
| `gl/ballpark.js`, `gl/ballpark-mesh.js` | GLASS (engine) | Draw a baseball park and players from data. They mustn't name Deadball, Coldwater or a club. |
| `panels/diamond/`, `gameday-grandstand.js` | THOMAS (engine) | Baseball, not Deadball: a second game with a baseball broadcast keeps them. |
| `baseball.js` including `synthPlay` | broadcast plugin | The sport module, as now. |
| The look preset's values | Architect (content) | Deadball's art direction. Defaults live in code; Deadball's values live in its venue data. |
| The venue: fence profile, wall colours, signs, scoreboard, light towers and dead banks, the haze | Architect (content) | `sports_pools.venue` on the Deadball row, written by the build script and served with the club set under the same revision. |
| Clubs: colours, caps, uniforms, crests | Architect (content) | `sports_pools.clubs`, through the existing seam. |
| Lines and pools | Architect (content) | `baseball.bsm`, as now. |
| The sound bank's presets | Architect (content) | `deadball-sfx.js`, editable in the dev panel and overridable by `interface_sfx`. |

Two existing leaks not to copy: Rinkside's sponsor names (`HOARDINGS` in `rink/textures.js`) and the
2-D view's "DEADBALL · GAMEDAY" and "◆ Chip Vega" strings are content inside engine files. The
Grandstand takes its brand, announcer and signage from the payload or the venue data.

### Should Deadball's clubs use the seam?

Yes, in Phase 4.

- In 3-D at 320×240 a uniform is the only way to tell the sides apart. The 2-D view labels its
  tokens; the 3-D view can't.
- The seam is already sport-neutral on the client (`club-crest.js` keeps a store per sport), and
  Rinkside proved the whole round trip.
- Baseball's convention fits the existing shape: `kit.home` is whites with club trim, `kit.road`
  is greys, and the cap and batting helmet carry the club colour and a small crest.
- Without it the Grandstand uses hashed two-colour kits from the team names, the same fallback
  `kitFor` uses. That's fine for Phases 1 to 3.

What it takes: `scripts/content/build-deadball-clubs.mjs` for sixteen clubs with a `--check` gate
and a size budget; `clubsRevOf` moved out of hockey.js to a shared module and exported by both
sports; `sendTvClubs` told the sport instead of assuming hockey; `clubsRev` on Deadball's payloads.
Baseball kit fields: jersey, trim, pants, cap, bill, helmet, undershirt, stirrups, number, number
edge, and a chest wordmark (text and colour).

Deadball's teams are named for districts, as several CPhL clubs are (Ashway, Yards, Docklands,
Coldwater). Taking a club's colours from its district's palette in
[building-styles.md](../reference/building-styles.md) would make the city consistent; it would also
make two clubs from one district look alike across the two leagues. That's a question for you.

## Text parity and accessibility

- **The line and the picture agree**, by construction (the play is chosen first, the line matches it)
  and by test (the bare-pool word check and the smoke gate). Baseball gets the parity rule hockey
  has.
- **Every pitch is text.** The rail's ticker is generated from the same pitch data the picture
  draws, in a polite `aria-live` region that a player can switch off.
- **Read Aloud speaks on landing**, as both views do now: the `speak` thunk from tv.js fires on
  `onLand`.
- **Reduced motion.** When `prefersReducedMotion()` is true: no vertex snapping or affine swim, no
  camera pans (hard cuts between still shots), no shake, no cut flashes, no fireworks, replays as
  still frames with the play described. Read it each time, never cached.
- **No flashing.** The light towers' dead banks go out and stay out; any flicker stays under three
  flashes a second. The CRT pass has no flicker at all.
- **The canvases are labelled.** The GL canvas gets an `aria-label`; the HUD canvas is
  `aria-hidden`, since everything on it is also in the rail or the header.
- **Colour isn't the only signal.** Abbreviations sit beside every colour chip; home whites and road
  greys differ in lightness, not only hue.

## Audio

- **Move the nine inline SIREN layers** out of gameday.js into `client/shared/deadball-sfx.js`, a
  bank like `hockey-sfx.js` (group `deadball`), so the dev panel can edit them. The bank's
  `<script>` has to come before `sfx-catalog.js` in both index.html files. Both views play from it.
- **Add:** a crowd bed that swells on a deep fly, roars on a home run and groans when the home side
  hits into a double play; bat-crack variants by contact quality; the fence thud; glove pops; slides;
  an organ sting or two (original riffs through the tracker); the umpire's calls and a public-address
  voice ("Now batting, number twenty-seven...") through ORACLE with the hall reverb; a vendor in the
  stands now and then.
- **Sound Detail decides how much:** `off` plays none of it, `limited` plays the events (crack, mitt,
  roar), `full` adds the bed, the organ and the PA.
- **Chip stays on top.** The bed ducks while Read Aloud speaks.
- **Rate limits** per sound, as Rinkside's `SFX_GAP` does, on the `tv` category.
- A period touch that needs no engine change: low-pass the bank's presets around 9 kHz, the sound of
  1990s sample memory.

## Performance budgets

| | Budget |
|---|---|
| Internal picture | 320×240 (77k pixels) |
| Triangles per frame | 16k (park 6k, up to 22 bodies at 400, the close tier at 700) |
| Draw calls per frame | 25 |
| Textures and targets | two 256² atlases (512 KB) and the 320×240 target with its depth (450 KB), plus the canvas |
| Frame rate | 30 fps by default (the period's own rate), 60 as an option |
| JavaScript per frame | 4 ms on a mid-range laptop |
| Hidden | no frames while the tab is hidden or the sub-screen is closed |
| Closed | `loseContext()` on `clear()` |
| Download | the Grandstand's modules load on first mount, after the 2-D view's |

The mockup's park and eleven figures came to 2,771 triangles. The governor's rungs, in order:
CRT pass off, 60 to 30 fps, crowd animation off, shadows off. Resolution is the look, so it isn't a
rung.

## Gates and tests

| Gate | Group | What it checks |
|---|---|---|
| `scripts/shapes/gameday-smoke.mjs` (Phase 0) | shapes | Real Deadball games through the 2-D view: every payload resolves, runners end on `basesAfter`, nothing throws. It's the fallback, so it needs a gate. |
| `scripts/shapes/ballpark-smoke.mjs` (Phase 1) | shapes | Pure, no GPU: meshes finite and inside budget for every pose and the park, GL matrices match the pure projection to 0.01 px for every shot, the snapping, dither and upscale maths, kit UVs inside their slots, null without WebGL2. |
| `scripts/shapes/diamond-smoke.mjs <slot>` (Phase 1, grows in 2 and 3) | shapes, one game per gate | Real games through the world and director over the DOM stub: pitch count, each pitch at its spot, the terminal pitch matches the kind, the count shown, caption held until `onLand`, fielders as the play names them, outs at the right base, runners end on `basesAfter`, runs equal the score change, home runs land past the fence, no runner moves faster than he could run outside a cut, ball and fielder in frame, replays start and hand back, sounds played. |
| `scripts/content/build-deadball-clubs.mjs --check` (Phase 4) | content | The row matches the script, sizes inside budget, colours hex. |
| `plugins/broadcast/regress.js` | regress | `sport`, `bats`, `throws`, `hold` present; `play` consistent with the kind; standings once a game; bare pools direction-free; a recorded hash of a hundred seeded games unchanged, so `synthPlay` can't have shifted the season. |

`client:smoke` and `imports:smoke` cover the new files without being asked. Each gate stays inside
the 60 s CPU budget: the smoke drives the director to idle and then applies the next payload without
waiting out the hold. Two slots that between them produce every kind go in the manifest (a triple
play comes up in about one game in 540, so the gate also feeds one synthesised triple-play payload).

The headless DOM stub has no WebGL, so no gate draws a real frame. A sandbox page,
`tools/sandbox/deadball-park-test.html`, runs the real sim and assembler into the real view with
`?slot=&i=&look=` and knobs for the look, for screenshots and tuning by hand, as
`hockey-rink-test.html` does.

## Phases

Each phase ends with its gates green and the sandbox showing it.

**Phase 0: groundwork.** No visible change.
- Standings once a game; `sport`, `bats`, `throws` and `hold` on payloads.
- The sound bank moved out of gameday.js.
- `gameday-smoke.mjs` for the 2-D view.
- The sandbox page.
- Tested by: broadcast regress, the new gate, the egress figures re-measured.

**Phase 1: the park and the pitch.** Behind a flag (a localStorage key), off by default.
- `gl/retro.js`, `gl/ballpark.js`, `gl/ballpark-mesh.js`, the shell, geo, world, rig, director and
  camera, with the venue's defaults in code.
- Walk-ups and every pitch result; strikeouts and walks staged in full; a ball in play cuts to the
  wide camera with the runners placed.
- The centre-field camera, the score box, pitch speed and count, blob shadows, the haze, the light
  towers.
- Fallback to the 2-D view, `loseContext()`, the hidden-tab pause, the frame cap.
- Tested by: `ballpark-smoke`, `diamond-smoke` (pitches, counts, captions), sandbox screenshots of
  the chosen look.

**Phase 2: balls in play.** Still behind the flag.
- `synthPlay`, suffixed pools, the direction-word check, and the lines that name a direction moved.
- Fielders, ball flight, bounces and caroms, fielding, throws, pivots, running, slides, home runs
  over the fence, the walk-off mob, reconciling cuts, the half-inning changeover.
- High home, fly-ball follow and first-base cameras.
- Tested by: `diamond-smoke` in full, regress for the play and the season hash.

**Phase 3: the broadcast.** On by default wherever WebGL2 works.
- Replays, dead-time rituals and cutaways.
- The crowd bed, PA, organ and umpire.
- Reduced motion, the CRT option and the governor's rungs.
- A performance pass on a low-end laptop and a phone, with the numbers written into
  systems-broadcast.md as the Grandstand's as-built section.
- Tested by: `diamond-smoke` (replays, sounds, the reduced-motion path through the stub), measured
  frame times.

**Phase 4: the clubs.** Sixteen identities through the seam.
- The build script and its gate, the shared `clubsRevOf`, the `tv_clubs` sport fix.
- Caps, uniforms, wordmarks and crests in the kit atlas, crests in the header and score box.
- The 2-D view picks up club colours too.
- Tested by: `--check`, `ballpark-smoke` (atlas), regress (`clubsRev` on payloads).

**Phase 5: optional.** A pitch-by-pitch booth with cues; a park per club; the batter's season line in
a lower third; the same look as an option for Rinkside.

## Risks

- **The director is the big piece.** Rinkside's is 1,379 lines. Baseball's plays are discrete, which
  helps, but thirteen kinds times the camera grammar is a lot of cases. Phase 1 stages only pitches
  for that reason.
- **The line and the picture disagreeing** is the bug a viewer notices first. The suffixed pools and
  the word check exist for it; the first Phase 2 job is moving the lines that name a direction.
- **A blurry, tiny ball.** The oversized ball, its shadow and the follow camera are the answer;
  check them in the sandbox at 400×300 before Phase 2's cameras are final.
- **Wobble and jitter can make people queasy.** Half-strength snapping by default, and none under
  reduced motion.
- **Two looks on one channel.** KSAB-TV airs both sports at 18:00 on alternate days; a modern rink
  next to a 1990s ballpark is either a joke that works or an inconsistency. Your call.
- **Two Deadball views to maintain.** The 2-D view stays as the fallback, so it needs its gate
  (Phase 0) and the payload changes have to keep it working.
- **Trademarks.** Original clubs, marks and graphics only. The bevelled score box is generic; don't
  model it on any network's package.
- **Determinism.** `synthPlay` and handedness must not draw from the sim's random stream. The season
  hash in regress catches it.

## Questions for you

1. **Which look?** A (recommended), B or C. And how much jitter: none, half (recommended) or the full
   period effect?
2. **CRT effect:** off at the TV's normal size and on in bigger views (recommended), always on, or
   never?
3. **Layout:** a 4:3 picture beside the existing stats rail (recommended), or the picture across the
   full width with the stats inside it?
4. **The booth:** keep one line per at-bat with a pitch ticker in the rail (recommended for now), or
   plan for Chip calling every pitch?
5. **Clubs:** author all sixteen in Phase 4? Should a club's colours follow its district, even where
   that makes it look like the CPhL club from the same district?
6. **Parks:** one league ballpark (recommended), or a park per club later?
7. **Frame rate:** 30 fps like the period (recommended) or 60?
8. **The 2-D Gameday:** keep it as a "classic" option players can pick, or only as the fallback?
9. **Name:** "Grandstand" is a working name for the view, as "Rinkside" is the rink's. Keep it or
   pick another.
