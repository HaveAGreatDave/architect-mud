// The gates: every check `npm run test:regress` runs before the suite, in one list.
//
// `pretest:regress` runs all of them through scripts/gates/run.mjs, in parallel. The group scripts
// (`shapes:smoke`, `client:smoke`, `docs:lint`, `a11y:smoke`, `voice:smoke`, `audio:smoke`) run
// one group each from this same list, so a gate added here is in the push gate and in its group
// script at once. There used to be two hand-kept lists, and a gate added to one of them sat
// outside the other.
//
// To add a gate: add its path to the group it belongs to. That's all.
//
// A gate is a node script that exits non-zero on failure and is safe to run beside any other gate:
// no database, no fixed port, no files written. One that can't be goes in a `serial` group.
//
// Budget. A gate may spend DEFAULT_BUDGET_S seconds of CPU on its main thread, measured alone. The
// runner fails anything over, by name: before this, one gate took 11 minutes of a 30-minute chain
// and nothing said so. A gate that genuinely needs more is written as
// { run: 'scripts/…', budget: 90, why: '…' }, and the reason has to survive review.
//
// Why main thread, and why alone. The budget is there to catch a gate that got slower, so it has to
// hold still when the gate didn't. Whole-process CPU beside other gates doesn't: on 2026-11-05 it
// failed a deploy window on smoke and duskbuild with nothing wrong, and total gate CPU ran from 14 to
// 26 minutes between CI runs of near-identical code. Seconds on a Ryzen 3600, before the fix below,
// main thread / whole process:
//
//                  alone         4 at once on 4 logical CPUs   8 at once on 12
//   duskbuild      14.6 / 35.1   21 / 43                       26 / 54
//   smoke          23.9 / 35.6   31-37 / 46-52                 39-41 / 55-65
//   rink 37        17.9 / 29.4   29 / 44                       32 / 52
//   diamond 16     32.7 / 35.4   54 / 58                       52 / 56
//
// Three things move those numbers, and each needs its own answer:
//
//   1. V8's background threads, charged to the gate. In duskbuild 12 s of the 35 is concurrent
//      marking of a 300 MB heap (--no-concurrent-marking takes it to 23), and the marker runs one
//      worker per spare core, so it also grows with the machine. In rink the 11 s is the optimising
//      compiler. Neither is the gate's own work. So the charge is the main thread alone.
//   2. Sharing a core. CPU time counts a thread that's stalled behind its SMT sibling as running, so
//      the main thread itself reads up to 1.8 times high under load, with the same work done, and no
//      counter separates that out. So a gate over budget in the pool runs again alone at the end,
//      and that number is the verdict. Over budget alone is the gate; beside others, maybe not.
//   3. The runner. Every gate in a CI run moves together, by up to 1.75 times between runs, and
//      nothing measured on the runner removes that. So it's margin: a gate at 30 s alone on the Ryzen
//      still passes on the slowest runner seen, and one at 35 s or more has none left.
//
// Not everything was the measure. Smoke gave up its two model sweeps to their own gates, and
// duskbuild's control sweep samples every third minute. A failure here still means the gate got
// slower, so make the slow thing cheaper before raising a number. A gate passing only on the second
// run prints a line saying so, which is the warning that it's getting close.
export const DEFAULT_BUDGET_S = 60;

export const GROUPS = [
  {
    name: 'setup',
    serial: 'first',
    // Frees pool connections held by orphaned local processes. Runs alone, before anything else.
    gates: [
      'scripts/kill-orphans.js',
    ],
  },
  {
    name: 'client',
    // Every client file parses, the lazy facades match their modules, and the client state
    // machines behave headless.
    gates: [
      'scripts/client/parse-smoke.mjs',
      'scripts/client/bake-lazy-view.mjs --check',   // with --check it only reads files
      'scripts/client/automation-smoke.mjs',
      'scripts/client/bootscreen-smoke.mjs',
      'scripts/client/freelook-smoke.mjs',
      'scripts/client/helm-smoke.mjs',   // the helm seat mounts, paints the chase pose, steers and comes down
      'scripts/client/bigscreen-smoke.mjs',
      'scripts/client/seatkeys-smoke.mjs',
      'scripts/client/boatseat-smoke.mjs',
      'scripts/client/maintbay-smoke.mjs',   // the bay controller's rules, and all four depots' bays walked job by job
      'scripts/client/boatfish-smoke.mjs',   // the boat reel: cast, twitch, the take, the fight and the net, against boatfish-rules.js
      'scripts/client/console-escape-smoke.mjs',   // player text in the pirate/emergency consoles renders inert
      'scripts/bank-hold-tune.mjs --check',   // the ← → bank hold settles, holds height and lets go, on every airframe
    ],
  },
  {
    name: 'imports',
    // Every named import resolves.
    gates: [
      'scripts/imports/smoke.mjs',
    ],
  },
  {
    name: 'auth',
    // Passwords, tokens and rate limits.
    gates: [
      'scripts/auth/smoke.mjs',
    ],
  },
  {
    name: 'content',
    // Content files carry no runtime columns and no dangling references.
    gates: [
      'scripts/content/lint.mjs',
      'scripts/content/build-cphl-clubs.mjs --check',   // the CPhL clubs in the row match their authoring script
      'scripts/content/build-deadball-clubs.mjs --check',   // and Deadball's
      'scripts/content/build-final-opens.mjs --check',   // the finals' opens match their scores
      'scripts/content/build-tonight-theme.mjs --check',   // the Tonight Show's theme matches its score
      'scripts/content/build-tonight-theme-2.mjs --check',   // and its second take, the late-night band
      'scripts/content/build-tonight-card.mjs --check',   // and its title card is timed to it
      'scripts/content/build-tonight-band.mjs --check',   // and the house band's bits match their score
      'scripts/content/build-holo-ads.mjs --check',   // the hologram adverts baked for the client match their media_graphics rows
      'scripts/content/building-stage.mjs',   // every building whose entry has a Room Stage spec can be walked from its front door (docs/proposals/building-stage.md)
    ],
  },
  {
    name: 'db',
    // No query() in a hot path.
    gates: [
      'scripts/db/query-lint.mjs',
    ],
  },
  {
    name: 'scale',
    // No new copy of the world's scale numbers outside client/shared/world-scale.js
    // (docs/proposals/world-scale.md); the old ones are ratcheted in scripts/scale/baseline.json.
    gates: [
      'scripts/scale/lint.mjs',
      'scripts/scale/check.mjs',
    ],
  },
  {
    name: 'docs',
    // The six doc checks: status headers, verbs, links, READMEs, hooks, prose.
    gates: [
      'scripts/docs/lint.mjs',
      'scripts/docs/verbs.mjs',
      'scripts/docs/links.mjs',
      'scripts/docs/readmes.mjs',
      'scripts/docs/hooks.mjs',
      'scripts/docs/prose.mjs',
    ],
  },
  {
    name: 'shapes',
    // GLASS: every building model, seat, sign and effect, headless against the DOM stub.
    gates: [
      'scripts/shapes/smoke.mjs',
      // A model drawn twice draws the same thing: a Math.random or a clock read in an arm shows up
      // nowhere else, because the capture harness holds `now` and never repeats a camera.
      'scripts/shapes/modeldiff.mjs --determinism',
      'scripts/shapes/modeldiff.mjs --ported',   // every portedFrom claim, against the arm it replaced, on 48 cameras and the mesh
      'scripts/shapes/wildlands.mjs',
      'scripts/shapes/meshes.mjs',
      'scripts/shapes/vehicle-materials.mjs',
      'scripts/shapes/liveries.mjs',
      'scripts/shapes/actors.mjs',
      'scripts/shapes/actors-hd.mjs',    // the street cut down from the close-up figure (ACTOR_BAKE.hd, off until stage 6): four silhouettes on budget and on one ground
      'scripts/client/precip-look-smoke.mjs', // the shared rain/snow look: sizes, colour by light, the 2D painters
      'scripts/client/room-window-smoke.mjs', // flights and lightning are pure functions of the clock; the shot masks find sky, sea and open ground
      'scripts/client/interiors-smoke.mjs', // a room placed in GLASS where the window's eye says it is; near rooms whole, further ones boxes, far ones nothing
      'scripts/shapes/sequence.mjs',     // every set, sequence and show in media_graphics, built and checked
      'scripts/shapes/room-stage.mjs',   // the suite's layout as frozen, every room form builds, placeSpot never stacks pieces
      'scripts/shapes/chem-stage-smoke.mjs', // the Chem Stage: every stage scores a good hand well and a bad one badly; heap, slosh and each stage's pieces build
      'scripts/shapes/actor-head.mjs',
      'scripts/shapes/figure.mjs',   // the close-up figure: every cut and hair style sound, the crowd's coat its coat
      'scripts/shapes/gaits.mjs',    // ROOM's IK gaits: no NaN, a person's stride, the planted foot planted
      'scripts/cats/cat-smoke.mjs',  // the cat kit: every Cattery cat carved in every pose, on the floor, skinned without tearing
      'scripts/shapes/actor-faces.mjs',   // without --write it only reads files
      'scripts/shapes/cloth.mjs',
      'scripts/shapes/slumpaint.mjs',
      'scripts/shapes/tagspace.mjs',
      'scripts/shapes/freecam.mjs',
      'scripts/shapes/mousestick.mjs',
      'scripts/shapes/skypan.mjs',
      'scripts/shapes/frustum.mjs',
      'scripts/shapes/walltex.mjs',
      'scripts/shapes/pathreuse.mjs',
      'scripts/shapes/framecost.mjs',
      'scripts/perf/alloc.mjs',          // MB allocated a frame over real Coldwater, against scripts/perf/alloc.json
      'scripts/shapes/glparity.mjs',
      'scripts/shapes/glmirror.mjs',
      'scripts/shapes/atlasfit.mjs',
      'scripts/shapes/glmesh.mjs',
      'scripts/shapes/house-style.mjs',   // the comic look's one switch: off changes nothing, on is the house numbers
      'scripts/shapes/vehicle-ink.mjs',   // the own ship's comic lines: the edge classifier, and every vehicle builds a list
      'scripts/shapes/face-atlas-feed.mjs',   // the street, park and rink get the right face atlas when the comic look flips
      'scripts/shapes/comic-replay.mjs',   // the comic replay's length, camera, panels, words, page and painters
      'scripts/shapes/rink-comic.mjs',     // the rink's comic replays: words, the replay's held clock, and a real game's goals, saves, hits and fights
      'scripts/shapes/jumbo-smoke.mjs',    // the videoboard from a seat: its own replay, the comic freeze on it, the suite's screen
      'scripts/shapes/elevation.mjs',
      'scripts/shapes/cliffrelief.mjs',
      'scripts/shapes/glmat.mjs',
      'scripts/shapes/glbevel.mjs',
      'scripts/shapes/glssao.mjs',
      'scripts/shapes/glhdr.mjs',
      'scripts/shapes/glcolour.mjs',
      'scripts/shapes/signtext.mjs',
      'scripts/shapes/signfit.mjs',
      'scripts/shapes/signswim.mjs',
      'scripts/shapes/sea.mjs',
      // Every hull rides the drawn sea with the water off her deck, leaning the right way.
      'scripts/shapes/boatride.mjs',
      'scripts/shapes/seabed.mjs',
      'scripts/shapes/exhaust.mjs',
      'scripts/shapes/hftint.mjs',
      'scripts/shapes/armtables.mjs',
      'scripts/shapes/envstrip.mjs',
      'scripts/shapes/signstand.mjs',
      'scripts/shapes/signband.mjs',
      'scripts/shapes/signsize.mjs',
      'scripts/shapes/signhand.mjs',
      'scripts/shapes/signfloor.mjs',
      'scripts/shapes/signrange.mjs',
      'scripts/shapes/glao.mjs',
      'scripts/shapes/glfade.mjs',
      'scripts/shapes/glcluster.mjs',    // the light grid lists every light that reaches a point
      'scripts/shapes/gltaa.mjs',        // the TAA jitter and reprojection matrix, as arithmetic
      'scripts/shapes/gllampshadow.mjs', // which lamps get a shadow map, and where each looks
      'scripts/shapes/anchored.mjs',
      'scripts/shapes/lidless.mjs',
      'scripts/shapes/tilefit.mjs',
      'scripts/shapes/airfield.mjs',
      'scripts/shapes/glresidue.mjs',
      'scripts/shapes/power.mjs',
      'scripts/shapes/worldresidue.mjs',
      'scripts/shapes/campwall.mjs',     // no part of a camp on a Curtain tile stands in the field
      'scripts/shapes/campcache.mjs',    // a cached camp draws what a live one draws
      'scripts/shapes/fauna.mjs',
      'scripts/shapes/faunabudget.mjs',
      'scripts/shapes/faunabake.mjs',
      'scripts/shapes/murmurgpu.mjs',
      'scripts/shapes/birdseason.mjs',
      'scripts/fish/smoke.mjs',          // fish.js is pure, every catch is raw_fish, schools swim true and every marina has fish
      'scripts/fish/sonar-smoke.mjs',    // every mark on the sounder is a fish the server would bite on, and it never names one
      'scripts/fish/fight-sim.mjs',      // the reel's fight, played by a simulated angler: an easy fish is easy and a sturgeon isn't
      'scripts/shapes/perch.mjs',
      'scripts/shapes/skyline.mjs',
      'scripts/shapes/falcondive.mjs',
      'scripts/shapes/boarddepth.mjs',
      'scripts/shapes/puddle.mjs',
      'scripts/shapes/roadpaint.mjs',
      'scripts/shapes/lamptone.mjs',
      'scripts/shapes/street-kit.mjs',   // Coldwater Streets: the lane, walkways and bollards at the brief's numbers
      'scripts/shapes/street-systems.mjs',   // Coldwater Streets: the strip, the kiosk and the room text keep the doc's decisions
      'scripts/shapes/lamppool.mjs',
      'scripts/shapes/walltag.mjs',
      'scripts/shapes/tagfit.mjs',
      'scripts/shapes/glself.mjs',
      'scripts/shapes/glneighbour.mjs',
      'scripts/shapes/wind.mjs',
      'scripts/shapes/snow.mjs',
      'scripts/shapes/footfall.mjs',
      'scripts/shapes/rainbow.mjs',
      'scripts/shapes/trail.mjs',
      'scripts/shapes/glsl-smoke.mjs',
      'scripts/shapes/glopts.mjs',
      'scripts/shapes/glstream.mjs',
      'scripts/shapes/masscull.mjs',
      'scripts/shapes/duskbuild.mjs',
      'scripts/shapes/dprsize.mjs',
      'scripts/shapes/floorfallback.mjs',
      'scripts/shapes/floorcam.mjs',
      'scripts/shapes/nearfit.mjs',
      'scripts/shapes/ownship.mjs',
      'scripts/shapes/shell.mjs',
      'scripts/shapes/cockpit-mule.mjs',
      'scripts/shapes/cockpit-leviathan.mjs',
      'scripts/shapes/cockpit-reaper.mjs',
      'scripts/shapes/cockpit-shrike.mjs',
      'scripts/shapes/cockpit-locust.mjs',
      'scripts/shapes/cockpit-grasshopper.mjs',
      'scripts/shapes/cockpit-mayfly.mjs',
      'scripts/shapes/cockpit-dragonfly.mjs',
      'scripts/shapes/cockpit-dragonfly-2076.mjs',
      'scripts/shapes/cockpit-mule-2076.mjs',
      'scripts/shapes/cockpit-mayfly-2076.mjs',
      'scripts/shapes/cockpit-grasshopper-2076.mjs',
      'scripts/shapes/cockpit-locust-2076.mjs',
      'scripts/shapes/cockpit-leviathan-2076.mjs',
      'scripts/shapes/cockpit-shrike-2076.mjs',
      'scripts/shapes/cockpit-viper-2076.mjs',
      'scripts/shapes/cockpit-reaper-2076.mjs',
      'scripts/shapes/cockpit-carcass-2076.mjs',
      'scripts/shapes/cockpit-drake-2076.mjs',
      'scripts/shapes/cockpit-courier-2076.mjs',
      'scripts/shapes/cockpit-drayman-2076.mjs',
      'scripts/shapes/cockpit-barrow-2076.mjs',
      'scripts/shapes/cockpit-continental-2076.mjs',
      'scripts/shapes/landing-feel.mjs',       // ground effect from the deck, and the shadow height gauge
      'scripts/shapes/engine-split.mjs',       // a throttle per engine: the model and the cockpits
      'scripts/shapes/cockpit-viper.mjs',
      'scripts/shapes/cockpit-controls.mjs',   // every seat: each control does something, each label reads true
      'scripts/shapes/cabin-light.mjs',
      'scripts/shapes/cockpit-carcass.mjs',
      'scripts/shapes/bay.mjs',
      'scripts/shapes/hangar.mjs',
      'scripts/shapes/dockscene.mjs',
      'scripts/shapes/statue.mjs',
      'scripts/shapes/park.mjs',
      'scripts/shapes/groundcontact.mjs',
      'scripts/shapes/yacht.mjs',
      'scripts/shapes/chess3d-smoke.mjs',
      // one game each, side by side (see the file)
      'scripts/shapes/rink-smoke.mjs 37',
      'scripts/shapes/rink-smoke.mjs 289',
      'scripts/shapes/arena-smoke.mjs',      // GLASS 2 rink: matrices match the 2-D camera, meshes and heads sound, ice tiles listed
      'scripts/shapes/kitchen-smoke.mjs',    // the Kitchen Stage: the matter table whole, the knife's pieces and evenness, every food, vessel and hob mesh sound
      'scripts/client/microwave-smoke.mjs',  // the Stage's microwave: the keypad's arithmetic, the START sequence's beats (one jab, one command), the lettering
      'scripts/shapes/gameday-smoke.mjs',    // Deadball's 2-D Gameday: real games, every play lands, the runners end where the sim left them
      'scripts/shapes/parkclock-smoke.mjs',  // Deadball's park clock: four seasons as they air, every pitch timed in its line's hold, the fit measured on both pitch draws
      'scripts/shapes/ballpark-smoke.mjs',   // Deadball's 3-D park: the park from venue data, the shots' matrices against the pinhole, the board, the 2-D fallback
      'scripts/shapes/cityscape-smoke.mjs',  // the city round it: the set composed from the content tree's skyline, every building placed and shaped, the streets from their arms
      'scripts/lite/smoke.mjs',              // GLASS Lite: the baked city (client/game/assets/lite/) is what the arms draw now; re-run npm run lite:bake after editing an arm
      'scripts/perf/lite-retain.mjs',        // GLASS Lite's signs, lights and masts kept on the GPU draw what the same records draw sent plain, and keep emitTile's two promises
      'scripts/perf/retain-world-check.mjs', // a recentre leaves the solids' retained groups and the kept casters where their records are (retainWorld)
      'scripts/shapes/anim-smoke.mjs',       // Deadball's players skinned: the rig's frames, four weights a vertex, every pose on the posed build's surface, the hands on the bat
      // Deadball staged in 3-D: each pitch at its spot, every clip on the ball, every ball in play's gloves, throws and call at first, the line held to the landing (one game each, side by side)
      { run: 'scripts/shapes/diamond-smoke.mjs 16', budget: 90, why: '33 s of main-thread CPU alone (2026-11-05), past the 30 s that survives the slowest runner seen. The time is the animation solver (diamond/anim.js, rig.js) posing every body at each of 476,000 checks, which is what the gate tests, and the poses read world state that moves between checks, so they cannot be shared' },
      { run: 'scripts/shapes/diamond-smoke.mjs 41', budget: 90, why: 'The same animation solver cost as seed 16, a little more: 36 s of CPU alone (2026-10-19). Dropping the long-hold pass to every fourth at-bat saved 8%' },
      'scripts/shapes/final-smoke.mjs',      // Deadball's final: the champions' show, the searchlights, the dress, the gold graphics, the line-ups read and the pile
      'scripts/shapes/variety-smoke.mjs',    // Deadball's balls in play over a season: spray by handedness, every grade, every line pool reachable
      'scripts/shapes/bolt.mjs',
      'scripts/shapes/weatherfx-smoke.mjs',
      'scripts/shapes/drugfx-smoke.mjs',
      'scripts/shapes/clouds.mjs',
      'scripts/shapes/rainceiling.mjs',
      'scripts/shapes/raincolumns.mjs',
      'scripts/shapes/moving.mjs',
      'scripts/shapes/cfitheight.mjs',
      'scripts/shapes/padcatch.mjs',
      'scripts/shapes/medialot.mjs',
      'scripts/shapes/curtain.mjs',
      'scripts/shapes/curtainend.mjs',
      'scripts/shapes/curtainlockdown.mjs',
      'scripts/shapes/lockwall.mjs',
      'scripts/shapes/chaseclip.mjs',
      'scripts/shapes/dials.mjs',
      'scripts/shapes/cabtrinkets.mjs',
      'scripts/shapes/cabgps.mjs',
      'scripts/shapes/glshadow.mjs',
      'scripts/shapes/textui-smoke.mjs',
    ],
  },
  {
    name: 'net',
    // The reconnect state machine in client/shared/ws.js.
    gates: [
      'scripts/net/ws-smoke.mjs',
    ],
  },
  {
    name: 'a11y',
    // Accessibility options, voice input, tablet and focus handling, Read Aloud.
    gates: [
      'scripts/a11y/smoke.mjs',
      'scripts/a11y/verb-smoke.mjs',
      'scripts/a11y/tablet-smoke.mjs',
      'scripts/a11y/focus-smoke.mjs',
      'scripts/a11y/speech-smoke.mjs',
      'scripts/a11y/rung-sweep.mjs',      // every panel asks the Display Mode rung or says why not
      'scripts/a11y/hololock-odds.mjs',   // the log rung's hololock wins as often as the dice it replaced
    ],
  },
  {
    name: 'voice',
    // ORACLE.
    gates: [
      'scripts/voice/smoke.mjs',
      'scripts/voice/accent-smoke.mjs',    // where the accents go: nucleus, given/new, minor breaks, compounds
      'scripts/voice/contour-smoke.mjs',   // what the accents sound like: nuclear fall, downstep, minor-break reset
      'scripts/voice/timing-smoke.mjs',    // segment durations against Klatt's rules; estimateDuration matches the schedule
      'scripts/voice/fm-smoke.mjs',
      'scripts/voice/worklet-smoke.mjs',   // the worklet back end: track list, fallback, stability, formants; synthiness; tension and creak
    ],
  },
  {
    name: 'audio',
    // SIREN scenes (the sea, the boat, the murmuration), the CPhL and Deadball soundsets rendered,
    // and the mix and fidelity work in docs/proposals/siren-fidelity.md, one gate per step.
    gates: [
      'scripts/audio/sea-smoke.mjs',
      'scripts/audio/boat-smoke.mjs',
      'scripts/audio/murmur-smoke.mjs',
      'scripts/audio/hockey-smoke.mjs',
      'scripts/audio/deadball-smoke.mjs',
      'scripts/audio/limiter-smoke.mjs',   // 1: the master limiter, and nothing around it
      'scripts/audio/duck-smoke.mjs',      // 2: duck gains per bus, and duck()'s schedule
      'scripts/audio/speech-channels-smoke.mjs',  // 3: a typed command stops Read Aloud, not the TV
      'scripts/audio/tvmix-smoke.mjs',     // 4: the tv bus's voice and effects sub-gains
      'scripts/audio/noise-smoke.mjs',     // 5: stereo noise in three colours, offsets, width
      'scripts/audio/filter-smoke.mjs',    // 6: filter gain for peaking and shelf types
      'scripts/audio/space-smoke.mjs',     // 7: layer pan, cue send, named rooms, the ballpark
      'scripts/audio/distance-smoke.mjs',  // a cue from another room: distance, door vs open way, the source room's reverb
      'scripts/audio/spatial-smoke.mjs',   // a GLASS seat's 3D: a pass goes left to right and sharp to flat; the pose turns the panner
      'scripts/audio/tools-smoke.mjs',     // 8: the Audio tab round-trips a layer; Voice Lab saves a voice
      'scripts/audio/mods-smoke.mjs',      // layer.mods patches LFO/env/random sources into a layer's stages
      'scripts/audio/fx-smoke.mjs',        // the effect stages (sub, fold, ring, 24 dB, EQ, comp, phaser, chorus, two heads), mute, the seq mod, the probe
      'scripts/audio/rack-smoke.mjs',      // the Audio tab's Rack round-trips every row; its patches touch only mods
      'scripts/audio/tracker-smoke.mjs',   // a song's held notes, layered instruments and play-once; the KSAB-7 theme and its open
      'scripts/audio/loudness-smoke.mjs',  // every cue preset's LUFS and peak against its target; ratcheted by loudness-baseline.json
      'scripts/audio/modes-smoke.mjs',     // struck surfaces: metal rings longer than wood, peaks at the modes, as loud as the old path
      'scripts/audio/sfx-smoke.mjs',       // every preset and bed passes the critic; vary and rand density work
      'scripts/audio/room-sound-smoke.mjs',  // the view out of a room's cues pass the critic at their level; the bath is quieter than the balcony; stop stops
      'scripts/audio/field-smoke.mjs',     // the CC0 field recordings: rows, licences, seamless loops, slices; a sample layer plays the recording or its stand-ins
      'scripts/audio/kitchen-sound-smoke.mjs', // the Kitchen Stage's cues pass the critic; the hob's state follows the pan and dial, never a clock
      'scripts/audio/sound-match-smoke.mjs', // the matcher reads a bell's carrier and ratio and fits it; the composed loops pass the critic
    ],
  },
  {
    name: 'ops',
    // The free-tier usage report.
    gates: [
      'scripts/ops/smoke.mjs',
    ],
  },
  {
    name: 'stale',
    serial: 'last',
    // Imports content if the local DB is behind git. Writes the DB, so it runs alone, last.
    gates: [
      'scripts/content/check-stale.mjs --import',
    ],
  },
];
