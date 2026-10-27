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
// Budget. A gate may spend DEFAULT_BUDGET_S seconds of its own CPU. The runner fails anything over,
// by name: before this, one gate took 11 minutes of a 30-minute chain and nothing said so. A gate
// that genuinely needs more is written as { run: 'scripts/…', budget: 90, why: '…' }, and the
// reason has to survive review.
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
      'scripts/client/console-escape-smoke.mjs',   // player text in the pirate/emergency consoles renders inert
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
      'scripts/shapes/wildlands.mjs',
      'scripts/shapes/meshes.mjs',
      'scripts/shapes/vehicle-materials.mjs',
      'scripts/shapes/liveries.mjs',
      'scripts/shapes/actors.mjs',
      'scripts/shapes/actor-head.mjs',
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
      'scripts/shapes/perch.mjs',
      'scripts/shapes/skyline.mjs',
      'scripts/shapes/falcondive.mjs',
      'scripts/shapes/boarddepth.mjs',
      'scripts/shapes/puddle.mjs',
      'scripts/shapes/roadpaint.mjs',
      'scripts/shapes/lamptone.mjs',
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
      'scripts/shapes/rink-smoke.mjs 37',    // one game each, side by side (see the file)
      'scripts/shapes/rink-smoke.mjs 914',
      'scripts/shapes/arena-smoke.mjs',      // GLASS 2 rink: matrices match the 2-D camera, meshes and heads sound, ice tiles listed
      'scripts/shapes/gameday-smoke.mjs',    // Deadball's 2-D Gameday: real games, every play lands, the runners end where the sim left them
      'scripts/shapes/ballpark-smoke.mjs',   // Deadball's 3-D park: the park from venue data, the shots' matrices against the pinhole, the board, the 2-D fallback
      'scripts/shapes/kitchen-smoke.mjs',    // the Kitchen Stage: the matter table whole, the knife's pieces and evenness, every food, vessel and hob mesh sound
      'scripts/shapes/cityscape-smoke.mjs',  // the city round it: the set composed from the content tree's skyline, every building placed and shaped, the streets from their arms
      'scripts/shapes/anim-smoke.mjs',       // Deadball's players skinned: the rig's frames, four weights a vertex, every pose on the posed build's surface, the hands on the bat
      // Deadball staged in 3-D: each pitch at its spot, every clip on the ball, every ball in play's gloves, throws and call at first, the line held to the landing (one game each, side by side)
      { run: 'scripts/shapes/diamond-smoke.mjs 16', budget: 90, why: '31 s of CPU alone, 61 to 64 s beside seven other gates (2026-10-25), after the smoother-motion build took it from 445,786 checks to 475,200. The same animation solver cost as seed 41' },
      { run: 'scripts/shapes/diamond-smoke.mjs 41', budget: 90, why: '36 s of CPU alone, 65 s beside seven other gates (2026-10-19). The time is the animation solver (diamond/anim.js, rig.js) posing every body at every check, not the smoke; dropping the long-hold pass to every fourth at-bat saved 8%' },
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
