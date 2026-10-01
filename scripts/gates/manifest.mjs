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
    // Every client file parses, and the client state machines behave headless.
    gates: [
      'scripts/client/parse-smoke.mjs',
      'scripts/client/automation-smoke.mjs',
      'scripts/client/bootscreen-smoke.mjs',
      'scripts/client/freelook-smoke.mjs',
      'scripts/client/bigscreen-smoke.mjs',
      'scripts/client/seatkeys-smoke.mjs',
      'scripts/client/boatseat-smoke.mjs',
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
      'scripts/shapes/liveries.mjs',
      'scripts/shapes/actors.mjs',
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
      'scripts/shapes/signtext.mjs',
      'scripts/shapes/signfit.mjs',
      'scripts/shapes/signswim.mjs',
      'scripts/shapes/sea.mjs',
      'scripts/shapes/seabed.mjs',
      'scripts/shapes/exhaust.mjs',
      'scripts/shapes/hftint.mjs',
      'scripts/shapes/envstrip.mjs',
      'scripts/shapes/signstand.mjs',
      'scripts/shapes/signband.mjs',
      'scripts/shapes/signsize.mjs',
      'scripts/shapes/signhand.mjs',
      'scripts/shapes/signfloor.mjs',
      'scripts/shapes/signrange.mjs',
      'scripts/shapes/glao.mjs',
      'scripts/shapes/glfade.mjs',
      'scripts/shapes/anchored.mjs',
      'scripts/shapes/lidless.mjs',
      'scripts/shapes/tilefit.mjs',
      'scripts/shapes/airfield.mjs',
      'scripts/shapes/glresidue.mjs',
      'scripts/shapes/power.mjs',
      'scripts/shapes/worldresidue.mjs',
      'scripts/shapes/fauna.mjs',
      'scripts/shapes/faunabudget.mjs',
      'scripts/shapes/faunabake.mjs',
      'scripts/shapes/murmurgpu.mjs',
      'scripts/shapes/birdseason.mjs',
      'scripts/shapes/perch.mjs',
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
      'scripts/shapes/cabin-light.mjs',
      'scripts/shapes/cockpit-carcass.mjs',
      'scripts/shapes/bay.mjs',
      'scripts/shapes/hangar.mjs',
      'scripts/shapes/dockscene.mjs',
      'scripts/shapes/statue.mjs',
      'scripts/shapes/groundcontact.mjs',
      'scripts/shapes/yacht.mjs',
      'scripts/shapes/chess3d-smoke.mjs',
      'scripts/shapes/rink-smoke.mjs',
      'scripts/shapes/bolt.mjs',
      'scripts/shapes/weatherfx-smoke.mjs',
      'scripts/shapes/drugfx-smoke.mjs',
      'scripts/shapes/clouds.mjs',
      'scripts/shapes/rainceiling.mjs',
      'scripts/shapes/moving.mjs',
      'scripts/shapes/cfitheight.mjs',
      'scripts/shapes/padcatch.mjs',
      'scripts/shapes/curtain.mjs',
      'scripts/shapes/curtainend.mjs',
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
    ],
  },
  {
    name: 'voice',
    // ORACLE.
    gates: [
      'scripts/voice/smoke.mjs',
      'scripts/voice/fm-smoke.mjs',
    ],
  },
  {
    name: 'audio',
    // SIREN scenes: the sea, the boat, the murmuration.
    gates: [
      'scripts/audio/sea-smoke.mjs',
      'scripts/audio/boat-smoke.mjs',
      'scripts/audio/murmur-smoke.mjs',
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
