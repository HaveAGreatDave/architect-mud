// LAMPPOOL — does a street lamp light the road, and has the ball stopped being a ball?
//
//   node scripts/shapes/lamppool.mjs
//   node scripts/shapes/lamppool.mjs --report
//
// Reported from the game as street lights being "a bit harsh, almost a ball of bright light instead
// of spreading out a more gradual cone around their area". Both halves of that turned out to be
// arithmetic rather than taste:
//
//   · THE ROAD TOOK NOTHING FROM A LAMP. Every other thing a light does to the ground here is
//     SPECULAR — the wet streak, the glint, the mirror — and all three are gated on water, so on a
//     dry night a street lamp lit nothing at all and the only expression of it was its own disc.
//     `uPool` in gl/ground.js is the diffuse half: what LANDS on the surface rather than what the
//     surface bounces back at you.
//   · AND THE DISC WAS OVER-BRIGHT AT RANGE. `glowPool` floors a glow's radius at three pixels and
//     never floored its alpha, so past four tiles a lamp is drawn at up to sixteen times the area it
//     should cover, at full strength. A street lamp is the only light in the city that appears in a
//     RECEDING ROW, so a dozen of them land on each other at the end of a street. See LAMP_HALO_S0.
//
// ⚠ NO HEADLESS GATE IN THIS REPO CAN SEE THE PICTURE. Every harness here installs a GL hook that
// hands back a bare canvas and never reaches a draw call, so nothing below asserts that the street
// LOOKS right — `__street({ x: 905, y: 909, heading: 90, hour: 23 })` in the Modelshop is the
// picture and `__glPool()` beside it is the measurement. What this asserts is the four things that
// are silent when wrong.
import fs from 'node:fs';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { createGroundLayer } from '../../client/game/js/panels/gl/ground.js';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__pool', W, H);

const problems = [];
const notes = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// A GL that records its uniform writes instead of drawing — snow.mjs's, and the only reason any of
// section 1 can be asked without a GPU. `createGroundLayer` asks a real `gl` for its own locations,
// so this gets a genuine answer to "does the layer write this, and does it write it every frame".
function recordingGL() {
  const seen = new Map(), wrote = new Map();
  const real = {
    getUniformLocation: (_p, n) => { const t = { n }; seen.set(t, n); return t; },
    getAttribLocation: () => 0,
    getShaderParameter: () => true, getProgramParameter: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    createShader: () => ({}), createProgram: () => ({}), createVertexArray: () => ({}),
    createTexture: () => ({}), createBuffer: () => ({}), isContextLost: () => false,
  };
  const setU = (loc, ...v) => { if (loc && seen.has(loc)) wrote.set(seen.get(loc), v.length === 1 ? v[0] : v); };
  const gl = new Proxy({}, { get(_t, k) {
    if (typeof k !== 'string') return undefined;
    if (k in real) return real[k];
    if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k.length;
    if (k.startsWith('uniform')) return setU;
    return () => {};
  } });
  return { gl, wrote, asked: () => [...seen.values()] };
}

// ── 1. THE UNIFORMS REACH THE GROUND SHADER, AND REACH IT EVERY FRAME ─────────
//
// `gl:opts` guards the install hop and `gl:glsl` guards the names; neither can see whether the
// layer WRITES what it was handed. A uniform holds its last value, so a layer that sets `uPool`
// only when it has a pool leaves every lamp lighting the road for the rest of the session after
// somebody turns the knob to 0 — the exact shape of the bug `uSnow` had.
const LIGHT = { p: [0.2, -1, 0.33], rgb: [0, 0, 0], rgbRaw: [0.24, 0.31, 0.37], r: 3.6, wash: false };
const CAM = { proj: () => ({ sx: 0, sy: 0, f: 1 }), sinh: 0, cosh: 1, ox: 0, oy: 0, ex: 0, ey: 0,
  EH: 0.2, W, H, FL: 300, depth: 300, cx: W / 2, horizonY: H / 2, LAT: 1 };
const QUAD = [{ p: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], rgb: [60, 60, 60], a: 1, road: 1, lat: 0, kerb: 0.5 }];
{
  const g = recordingGL();
  const ground = createGroundLayer(g.gl);
  for (const u of ['uPool', 'uNight']) {
    ok(g.asked().includes(u), 'ground.js never asks for a ' + u + ' location — the shader declares it and the JS does not read it, so the pool is a uniform at 0 for ever.');
  }
  ground.upload(QUAD);
  ground.draw(CAM, H, { pool: 1.2, night: 1, wetLights: [LIGHT] });
  ok(g.wrote.get('uPool') === 1.2, 'ground.js did not write the pool gain it was handed (got ' + g.wrote.get('uPool') + ').');
  ok(g.wrote.get('uNight') === 1, 'ground.js did not write the night it was handed (got ' + g.wrote.get('uNight') + ').');
  ground.draw(CAM, H, { wetLights: [LIGHT] });
  ok(g.wrote.get('uPool') === 0, 'ground.js skipped uPool on a frame with no pool — a uniform holds its last value, so the road stays lit after the knob goes to 0.');
  ok(g.wrote.get('uNight') === 0, 'ground.js skipped uNight on a daylight frame — same trap, and this one puts a lamp on sunlit tarmac.');
}

// ── 2. AND THE LIGHT LIST ARRIVES ON A DRY NIGHT, WHICH IT NEVER USED TO ──────
//
// This is the regression for the fix that made the pool possible at all. The list was handed over
// on `opts.wet > 0` alone — the ONLY hand-off it has — so a clear night uploaded `uNWet` 0 and
// every loop in that shader broke on its first iteration. The reflections did not care (they are
// gated on `refl`, which is `uWet` times a coverage and is exactly 0 on a dry road), but two terms
// that are NOT about water were dying with them: the pool, and the volumetric light shaft, which is
// gated on HAZE and so was silently absent in every fog that came without rain.
{
  const g = recordingGL();
  const ground = createGroundLayer(g.gl);
  ground.upload(QUAD);
  ground.draw(CAM, H, { pool: 1.2, night: 1, wet: 0, wetLights: [LIGHT] });
  ok(g.wrote.get('uNWet') === 1, 'the ground pass got no lights on a DRY night with the pool on — uNWet is ' + g.wrote.get('uNWet') + ', so the pool loop breaks on its first iteration and a lamp lights nothing.');

  const f = recordingGL();
  const fog = createGroundLayer(f.gl);
  fog.upload(QUAD);
  fog.draw(CAM, H, { pool: 0, night: 1, wet: 0, scatter: 0.02, wetLights: [LIGHT] });
  ok(f.wrote.get('uNWet') === 1, 'the ground pass got no lights in DRY FOG — uNWet is ' + f.wrote.get('uNWet') + ', so the volumetric shaft has nothing to scatter and a foggy night has no cones in it.');

  const d = recordingGL();
  const dry = createGroundLayer(d.gl);
  dry.upload(QUAD);
  dry.draw(CAM, H, { pool: 0, night: 1, wet: 0, scatter: 0, wetLights: [LIGHT] });
  ok(d.wrote.get('uNWet') === 0, 'the ground pass uploaded lights on a frame that wants none — the hand-off has stopped being conditional at all, which costs six uniform writes a frame for nothing.');
}

// ── 3. THE POOL IS GATED ON THE THREE THINGS THAT MAKE IT SAFE ────────────────
//
// A source check, deliberately, because each of these is a branch inside a fragment shader and no
// harness in this repo reaches one. They are the three ways this term goes from "a lamp lighting a
// road" to a defect somebody reports:
//
//   uNight   — the light list carries NO night term by design (`rgbRaw` is unweighted so a wet
//              road reflects neon at four in the afternoon), so this is the only thing between the
//              pool and a pink cast on sunlit tarmac. That is the bug the wall wash had.
//   uSurface — the additive range through this shader is a HEADLIGHT POOL rather than a road, and
//              laying a lamp's irradiance over a beam of light is the same category error as
//              darkening one for being wet.
//   uPool    — the off switch.
{
  const src = fs.readFileSync(new URL('../../client/game/js/panels/gl/ground.js', import.meta.url), 'utf8');
  const i = src.indexOf('if (uPool > 0.001');
  ok(i > 0, 'the pool block has gone from ground.js, or its gate has been rewritten — this check cannot find "if (uPool > 0.001".');
  if (i > 0) {
    const gate = src.slice(i, src.indexOf(')', i) + 1);
    const wants = [
      ['uNWet > 0', 'without it the loop runs over an empty list on every fragment'],
      ['uNight', 'without it a lamp lays its pool on sunlit tarmac at noon — the bug the wall wash had'],
      ['uSurface > 0.5', 'without it the irradiance is laid over a headlight beam as though the beam were a road'],
    ];
    for (const [name, why] of wants) {
      ok(gate.includes(name), 'the pool is no longer gated on ' + name + ' — ' + why + '. The gate now reads: ' + gate);
    }
    const body = src.slice(i, i + 1800);
    // ⚠ AND IT ADDS INTO THE HEADROOM. `c + k` saturates a painted line to white long before it
    // saturates the tarmac beside it, so a pool crossing a road marking blows the line out and
    // leaves a hard white bar across the middle of it — the one place a marking is most needed.
    ok(/c \+= pool \* \([^;]*\) \* max\(vec3\(0\.0\), 1\.0 - c\)/.test(body),
      'the pool is added straight onto the road rather than into the headroom left on it — a painted line under a lamp goes to white.');
    // The shape is the irradiance of a point source on a plane, normalised to 1 beneath it. A
    // Gaussian somebody fitted would have an edge; this does not, which is the whole complaint.
    ok(body.includes('(h * h * h) / (r2 * sqrt(r2))'),
      'the falloff is no longer h^3 / (d^2 + h^2)^1.5 — that shape is what makes this read as a lamp rather than as a bigger disc, and it is why no cut-off is needed to hide an edge.');
    // ⚠ AND IT RECEDES INTO THE HAZE. The fog is folded into `c` on the first line of main, so
    // everything added after it is added OVER the haze — which the wet streak gets away with
    // because its geometry is anchored to the eye and falls off with distance on its own. This
    // falloff is measured from the LIGHT, so without this a pool thirty tiles away under its own
    // lamp is at full strength and punches through a fog the road has already dissolved into.
    ok(body.includes('(1.0 - gfog)'),
      'the pool no longer fades into the fog — its falloff is measured from the light rather than from the eye, so a distant pool draws at full strength over a road that has receded into the haze.');
    // And the floor under the height, without which a light sitting ON the ground is a singularity.
    ok(/float h = max\(0\.1[0-9]?, uWetP\[i\]\.z\)/.test(body),
      'the lamp height has lost its floor — h^3/r^3 as d goes to 0 is a white pinhole on the tarmac, which is a worse ball than the one this replaced.');
  }
}

// ── 4. AND THE LAMP'S OWN DISC FADES WITH DISTANCE ────────────────────────────
//
// The observable claim, through the sprite list the renderer really pushes: a lamp near the camera
// is untouched, and one far enough away for `glowPool`'s three-pixel floor to have taken over is
// dimmer. Without this a receding row composites into one saturated blob — which is the report.
//
// ⚠ AND IT IS PUSHED, NOT PAINTED, so this needs no rasteriser. Same seam lamptone.mjs reads.
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
globalThis.window.devicePixelRatio = 1;

// One lamp, on one road tile, at a chosen distance up the map window. Everything else is bare
// ground: a building brings its own neon and window bloom and the census would be measuring those.
function lampAt(tilesAhead, pool) {
  const N = 41, R = 20;
  const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
    x === R
      ? { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1, sl: (y === R - tilesAhead) ? 1 : undefined }
      : { kind: 'land', biome: 'citycore', flr: 0 }
  )));
  let sprites = null;
  const was = ws.RENDER_TUNE.glPool;
  ws.RENDER_TUNE.glPool = pool;
  // ⚠ PUT THE FLAG BACK EVERY TIME — lamptone.mjs's note: a hook that answers null is the
  // no-WebGL2 path and the pass replies by setting RENDER_TUNE.gl to 0, so without this only the
  // first call in the sweep ever opens a sprite sink.
  ws.RENDER_TUNE.gl = 1;
  ws.installGLWorld((cells, cam, o) => { sprites = (o.sprites || []).slice(); return null; });
  ws.paintWindshield('__pool', { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1,
    height: 0, eyeH: 0.12, hour: 23, weather: 'clear', speed: 0, heading: 0, resFloor: 1,
    map, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 } });
  ws.installGLWorld(null);
  ws.RENDER_TUNE.glPool = was;
  return sprites || [];
}

{
  const near = lampAt(2, 1.2), far = lampAt(14, 1.2);
  ok(near.length > 0, 'the near lamp pushed no sprite at all — the scene lights nothing and every check below is vacuous.');
  ok(far.length > 0, 'the far lamp pushed no sprite at all — the scene lights nothing and every check below is vacuous.');
  if (near.length && far.length) {
    const aNear = Math.max(...near.map((s) => s.a || 0));
    const aFar = Math.max(...far.map((s) => s.a || 0));
    notes.push('a lamp two tiles out pushes alpha ' + aNear.toFixed(3) + '; fourteen tiles out, ' + aFar.toFixed(3));
    ok(aFar < aNear * 0.9,
      'a lamp fourteen tiles away is as bright as one two tiles away (' + aFar.toFixed(3) + ' against ' + aNear.toFixed(3)
      + ') — glowPool floors the RADIUS at three pixels, so without a matching fade on the alpha a receding row of lamps stacks into one saturated ball.');
    // …and not to nothing. A street light at the far end of a road is a thing you can see.
    ok(aFar > aNear * 0.2,
      'a lamp fourteen tiles away is down to ' + (100 * aFar / aNear).toFixed(0) + '% of a near one — strict energy conservation takes a far lamp to nearly nothing, and a lit street has to read from the far end.');
  }
}

// ── 4b. AND WITH THE POOL ON, THE LAMP STOPS FAKING ONE ──────────────────────
//
// A lamp used to push TWO glows: the halo at the fitting and a second disc at z 0.01, on the
// tarmac, standing in for light lying on a plane seen almost edge-on. That second one is what the
// ground shader now does properly, and keeping both would be two owners of one pool — worse than
// either, because the fake one also enters the light list at GROUND height, where the irradiance
// term's own floor is all that stands between it and a white pinhole on the road.
{
  const on = lampAt(2, 1.2), off = lampAt(2, 0);
  const atGround = (list) => list.filter((s) => (s.z ?? 1) < 0.1).length;
  ok(atGround(off) > 0,
    'with glPool 0 the lamp no longer pushes its ground-level wash — that flag\'s 0 is meant to be the street as it shipped, and the 2-D fallback has no shader pool to replace it with.');
  ok(atGround(on) === 0,
    'with the pool on the lamp still pushes ' + atGround(on) + ' ground-level glow(s) — two owners of one pool, and this one sits at z 0.01 where the irradiance term is at its sharpest.');
}

globalThis.performance = clock;

if (REPORT) { console.log(''); for (const n of notes) console.log('  · ' + n); console.log(''); }

if (problems.length) {
  console.error('\n✗ lamppool — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  See `uPool` in gl/ground.js and LAMP_HALO_S0 in windshield.js.');
  process.exit(1);
}
console.log('✓ lamppool: the ground pass writes uPool and uNight every frame, the light list reaches a dry night and a dry fog, the pool is gated on night/surface/gain and adds into the headroom, and a distant lamp fades rather than stacking.');
