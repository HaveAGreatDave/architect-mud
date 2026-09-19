// IS THE AIRFIELD ACTUALLY THERE?
//
//   node scripts/shapes/airfield.mjs            # gate
//   node scripts/shapes/airfield.mjs --report   # the tallies
//
// Three claims, all of which failed silently before and none of which any other gate can see.
//
// ⚠ 1. THE GROUND PASS CANNOT REACH A DEPTH-BUFFER SINK, AND EVERYTHING IT STANDS UP DIED THERE.
// `drawGroundSurfaces` runs BEFORE drawWorldObjects, which is where SPRITE_SINK, STROKE_SINK and
// DECAL_SINK are armed — so for the whole of the ground pass all three are null, every airfield
// drawer took its canvas path, and the GL composite then painted over the lot. Measured on the tile
// this scene is built from: 72 of 72 runway edge-light ops and 4 of 4 windsock fabric ops issued
// BEFORE the blit. A night airport with no lights on it and no windsocks, which is how it was
// reported. `emitGroundLate` is the fix and this is what holds it.
//
// ⚠ 2. A WINDSOCK WAS A RIBBON ON THE GLASS. Two projected points and a width in PIXELS: not 3-D at
// any range, and the same shape from every side because there was no other side. The tell is depth —
// a screen-space quad has all FOUR corners at one camera depth, by construction, and a quad on a real
// cone has four different ones. That is the assertion below, and it is the one a picture is worst at
// settling.
//
// ⚠ 3. A HELIPAD DREW AS A ONE-TILE RUNWAY. `pad` has been on the cell since the landing capture
// needed it and nothing in the renderer read it, so Threshold, the Gantry and the Ascension each got
// a dashed centreline, piano keys and TWO PAPI arrays.
//
// ⚠ AND THE CONTROL IS NOT OPTIONAL. "Nothing left on the canvas" is also exactly what comes back
// when the scene contains no airfield at all — which happened twice while this was written, once
// with `kind: 'land'` where the pass reads `kind: 'field'`, and once with the strip under the camera
// where the near clip drops it. So the GLASS 1 frame has to DRAW all of it, or this fails for its own
// reason instead of passing for the renderer's.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { eyePos } from '../../client/game/js/panels/gl/camera.js';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
const el = stubCanvas('__af', W, H);

// Colours the airfield drawers use and nothing else in the frame does — the only way to attribute a
// canvas op to a painter once it is a `fill` on a context everything shares.
const IS = { sock: '242,116,32', edge: '255,246,214', green: '120,255,150' };

const log = [];
let glCanvas = null, sinks = null, lastCam = null;
const gradient = { addColorStop() {} };
function instrCtx() {
  const t = { fillStyle: '', strokeStyle: '' };
  return new Proxy(t, {
    get(o, k) {
      if (k === 'canvas') return { width: W, height: H };
      if (k === 'measureText') return (s) => ({ width: String(s == null ? '' : s).length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => gradient;
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData' || k === 'createImageData') return (...a) => {
        const [w, h] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
        const ww = Math.max(1, w | 0), hh = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh };
      };
      if (k === 'drawImage') return (img) => { if (glCanvas && img === glCanvas) log.push({ op: 'BLIT' }); };
      if (k === 'fill' || k === 'stroke' || k === 'arc' || k === 'fillRect')
        return () => log.push({ op: k, s: String(o.fillStyle) + '|' + String(o.strokeStyle) });
      if (k in o) return o[k];
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
el.getContext = () => instrCtx();

// A north–south strip AHEAD of the camera. ⚠ `kind: 'field'` is what the pass reads; the cell's `pad`
// is what deriveSurfaceCell sets from the airfield's own vtol_only.
const N = 41, R = 20;
function scene(pad) {
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    if (x === R && y >= R - 11 && y <= R - 5) return (pad && y === R - 8) ? { kind: 'field', pad: 1, flr: 0 } : { kind: 'field', flr: 0 };
    return { kind: 'land', biome: 'city', flr: 0 };
  }));
}
const view = (map, heading = 0) => ({
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 22, weather: 'clear', speed: 0, map, heading,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
  wind: 16, windVec: { dir: 250 }, landGuide: { alt: 400 },
});

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor;

function frame(glOn, VIEW) {
  ws.RENDER_TUNE.gl = glOn ? 1 : 0;
  ws.RENDER_TUNE.glFloor = glOn ? 1 : 0;
  sinks = null; lastCam = null;
  if (glOn) {
    // ⚠ THE HOOK HAS TO HAND BACK A CANVAS. Anything else is the no-WebGL2 path, which puts the flag
    // to 0 and finishes in 2-D — and the census then reports the OTHER renderer working.
    const c = globalThis.document.createElement('canvas'); c.width = W; c.height = H;
    glCanvas = c;
    ws.installGLWorld((cells, cam, o) => {
      lastCam = cam;
      sinks = { strokes: (o.strokes || []).slice(), sprites: (o.sprites || []).slice(), decals: (o.decals || []).slice() };
      return { faces: 1, canvas: c };
    });
  } else { glCanvas = null; ws.installGLWorld(null); }
  ws.paintWindshield('__af', VIEW);   // settle every lazy bake
  log.length = 0;
  ws.paintWindshield('__af', VIEW);
  const blit = log.findIndex((e) => e.op === 'BLIT');
  // ⚠ COUNTED NOW, NOT HANDED BACK AS A CLOSURE. `log` is one array every frame reuses, so a
  // closure over it answers for whichever frame ran LAST — which is how the report came to print
  // zeroes for a control that had passed its own assertions a moment earlier.
  const canvasOps = {};
  for (const [k, needle] of Object.entries(IS)) {
    canvasOps[k] = log.reduce((n, e, i) =>
      n + (e.op !== 'BLIT' && e.s.includes(needle) && (blit < 0 || i < blit) ? 1 : 0), 0);
  }
  return { blit, canvasOps, sinks, cam: lastCam };
}

const problems = [];
const say = (ok, msg) => { if (!ok) problems.push(msg); };

// ── the control ─────────────────────────────────────────────────────────────
const one = frame(false, view(scene(false)));
for (const k of Object.keys(IS)) {
  say(one.canvasOps[k] > 0,
    `the GLASS 1 control painted no ${k} — the scene does not contain an airfield, so an empty GLASS 2 tally would mean nothing`);
}

// ── 1. nothing the airfield stands up is left on the canvas ─────────────────
const two = frame(true, view(scene(false)));
say(two.blit >= 0, 'the GL composite never ran — the hook did not hand back a canvas');
for (const k of Object.keys(IS)) {
  const n = two.canvasOps[k];
  say(n === 0, `${n} ${k} op(s) painted before the GL composite — drawn and then wiped, which is the bug this exists for`);
}
say(two.sinks.sprites.length > 0, 'not one airfield light reached the sprite sink');
say(two.sinks.decals.length > 0, 'not one airfield decal reached the decal sink');
say(two.sinks.strokes.length > 0, 'no windsock mast reached the stroke sink');

// ── 2. the sock is geometry, not a card ─────────────────────────────────────
const sockOf = (fr) => (fr.sinks ? fr.sinks.decals.filter((d) => String(d.key).startsWith('sock|')) : []);
const socks = sockOf(two);
say(socks.length > 0, 'the windsock pushed no fabric — the cone is not being built at all');
// ⚠ THE TELL IS THE DEPTH SPREAD. `quadBox` gives every corner of a screen-space billboard the SAME
// `f` by construction, so a ribbon scores exactly 0 here however it is drawn; a quad lying on a cone
// in the world has four different camera depths. Restoring the old drawer takes this to 0 of N.
let flat = 0;
for (const d of socks) {
  const fs = d.p.map((q) => two.cam.proj(q[0], q[1], q[2]).f);
  if (Math.max(...fs) - Math.min(...fs) < 1e-6) flat++;
}
say(socks.length > 0 && flat === 0,
  `${flat} of ${socks.length} windsock quads have all four corners at one camera depth — that is a billboard, not a cone`);

// ⚠ AND IT HAS A FAR SIDE, WHICH IS ASKED OF EVERY QUAD RATHER THAN OF TWO HEADINGS. The obvious
// version renders the sock from the opposite bearing and compares — and at heading 180 the strip is
// BEHIND the camera, so nothing is drawn, both centroids are null and the check passes or fails for
// a reason that has nothing to do with culling. A tube is convex, so the real claim is local: every
// facet that reaches the GPU faces the eye. With the cull removed roughly half of them would not,
// and the SIGN of that dot product would stop being unanimous — which is the assertion, and it does
// not need to know which way round the winding runs.
const EYE = two.cam ? eyePos(two.cam) : null;
let away = 0, edgeOn = 0;
for (const d of socks) {
  const [a, b, c] = d.p;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nL = Math.hypot(nx, ny, nz) || 1;
  const cx = (d.p[0][0] + d.p[2][0]) / 2, cy = (d.p[0][1] + d.p[2][1]) / 2, cz = (d.p[0][2] + d.p[2][2]) / 2;
  const ex = EYE[0] - cx, ey = EYE[1] - cy, ez = EYE[2] - cz;
  const eL = Math.hypot(ex, ey, ez) || 1;
  // ⚠ NORMALISED, AND WITH AN EDGE-ON BAND. The cull in sockCone asks the RADIAL direction at the
  // quad's leading edge and this asks the finished quad's own normal, so the two can disagree by a
  // hair on the facets lying along the silhouette — measured at |cos| under 0.05, one of them at
  // -0.0007. Reading those as failures made a working cull look broken.
  const dot = (nx * ex + ny * ey + nz * ez) / (nL * eL);
  if (Math.abs(dot) < 0.05) edgeOn++; else if (dot < 0) away++;
}
say(socks.length >= 6 && away === 0,
  `${away} of ${socks.length} windsock facets face AWAY from the eye — the far side of the tube is being uploaded, so the cull is not reaching it`);

// ── 3. a pad is a pad ───────────────────────────────────────────────────────
const three = frame(true, view(scene(true)));
const greenLamps = (fr) => fr.sinks.sprites.filter((s) => {
  const [r, g, b] = s.rgb || []; return g > 200 && r < 200 && b > 120 && b < 200;
}).length;
say(greenLamps(three) > greenLamps(two),
  'a pad tile pushed no TLOF ring — `c.pad` is still being drawn as a runway');
say(three.sinks.decals.some((d) => String(d.key).startsWith('helideck|')),
  'a pad tile pushed no deck markings — the H and the aiming circles are missing');

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas;
globalThis.performance = clock;

if (REPORT) {
  console.log('\n  GLASS 1 — on the canvas: ' + Object.keys(IS).map((k) => `${k} ${one.canvasOps[k]}`).join(', '));
  console.log('  GLASS 2 — on the canvas: ' + Object.keys(IS).map((k) => `${k} ${two.canvasOps[k]}`).join(', '));
  console.log(`  GLASS 2 — in the sinks : ${two.sinks.strokes.length} strokes, ${two.sinks.sprites.length} sprites, ${two.sinks.decals.length} decals (${socks.length} of them windsock fabric)`);
  console.log(`  windsock facets        : ${socks.length} pushed, ${away} facing away, ${edgeOn} edge-on`);
  console.log(`  with a pad tile        : ${three.sinks.strokes.length} strokes, ${three.sinks.sprites.length} sprites, ${three.sinks.decals.length} decals, ${greenLamps(three)} green lamps against ${greenLamps(two)} without\n`);
}

if (problems.length) {
  console.error(`\n✗ airfield — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log(`✓ airfield: the runway's lights, its PAPI and its windsocks all reach the depth buffer (${two.sinks.sprites.length} lamps, ${socks.length} fabric quads, ${two.sinks.strokes.length} masts) and leave nothing on the canvas; the sock is a cone with a far side; a pad draws a pad.`);
