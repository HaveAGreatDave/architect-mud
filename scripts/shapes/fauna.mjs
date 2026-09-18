// THE GEESE — do they draw, do they stay put, and do they stay inside their budget?
//
//   node scripts/shapes/fauna.mjs            # gate
//   node scripts/shapes/fauna.mjs --report   # the tallies behind it
//
// `shapes:smoke` asks whether the MESH is sound — the row bakes, the poses build, nothing
// non-finite reaches a canvas. That is the model. This asks about the PASS: whether a flock ever
// reaches the billboard sink at all, whether it is in the same place after the map window moves,
// and whether the texture budget it claims is the one it was designed to claim.
//
// ⚠ FOUR OF THE FIVE CHECKS HERE CAN ONLY FAIL SILENTLY IN THE GAME. A flock that draws nothing
// draws nothing; a flock that shifts half a tile on a recentre looks like a bird walking; a key
// space that has quietly doubled evicts somebody else's textures and turns the scatter pink three
// systems away. None of them throws, and none of them is visible in a screenshot of one frame.
//
// ⚠ AND THE SCENE LOCATES ITSELF. The flock lattice is in ABSOLUTE world tiles, so whether a field
// holds geese depends on two hashes rather than on where a test happens to point its camera. A
// hand-picked mapCenter is a coin flip that passes today and goes vacuous the first time anybody
// touches a constant — the same way worldresidue's own header records it claiming for months to
// measure pedestrians it never ran. So the camera is placed ON a real anchor, found by asking.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { flocksNear, flockState, flockClearance, flockOnSegment, flockEdgeHeading, FLOCK_AREA, GOOSE_PERIOD, GOOSE_SETTLE_MS, U_GROUND, GOOSE_SPAN, SKEIN_ACROSS, skeinSlot, skeinForm } from '../../client/shared/goose.js';
import { faunaPaintCount, FAUNA_BEAT_STEPS, FAUNA_TILE, faunaParamBase } from '../../client/game/js/panels/fauna3d.js';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__fa', W, H);

// ⚠ A FRAME BUDGET, NOT A TEXTURE ONE. A goose was a baked card, so what had to stay bounded
// was how many TEXTURES a flock claimed out of a 256-entry cache shared with every tree and
// landmark. A mesh claims none - it is transformed and uploaded per frame - so the thing to bound
// is FACES. Ten flocks of nine birds at forty-seven faces, with room for the model to gain a part.
const FACE_MAX = 4600;
// How far inside a built tile the outermost bird of a skein may stray. A quarter of a tile is about
// one wingspan and a half: a bird brushing the corner of a roof, never one over the middle of it.
const BLOCK_GRAZE = 0.25;
const problems = [];
const notes = [];

// ── A FIELD, CENTRED ON A FLOCK ───────────────────────────────────────────────
// Ask the lattice where the geese are and put the camera there, rather than picking a tile and
// hoping. `SEED` is arbitrary; what matters is that the anchor comes back from the same function
// the renderer reads.
const SEED = { x: 900, y: 900 };
const near = flocksNear(SEED.x, SEED.y, 30);
if (!near.length) {
  console.error('✗ fauna — no flock anchor within 30 tiles of the seed tile. The lattice cannot be swept from here.');
  process.exit(1);
}
// A couple of tiles back from the anchor, so the flock is AHEAD of the camera: the near clip drops
// a tile at the camera's own feet, exactly as worldresidue records for its junction.
const ANCHOR = near[0];
const CENTRE = { x: ANCHOR.ax, y: ANCHOR.ay + 6 };     // forward is -y at heading 0

const N = 41, R = 20;
// ⚠ A PARK IN A CITY, NOT A WORLD OF TURF. A flock is rolled per habitat tile, so a window that is
// turf from edge to edge holds far more than the per-frame cap of ten — and the cap is NEAREST
// FIRST, which is camera-relative by design. Move the window five tiles and a different ten are
// nearest, so the recentre check below fails on correct code for a reason that is not about geese.
// A patch a few tiles across is what the world actually looks like and keeps the frame under the
// cap, which is what lets that check mean what it says.
const PARK = 4;   // half-width of the turf patch, in tiles
//
// ⚠ THE MAP IS DERIVED FROM ABSOLUTE WORLD TILES, NEVER HANDED OVER AS A FIXED ARRAY. A view's
// `map` is WINDOW-relative: cell [ry][rx] is whatever world tile the window currently has there.
// Reuse one array across two mapCenters and the terrain slides with the camera, so the park is
// under a different part of the world in each paint — and a recentre check built on that is
// comparing two different worlds. It passed anyway while the map was uniform turf, which is
// exactly the kind of green that means nothing.
const mapFor = (centre, groundAt) => Array.from({ length: N }, (_, ry) => Array.from({ length: N }, (_, rx) => (
  groundAt(centre.x - R + rx, centre.y - R + ry)
)));

// ⚠ THE SUB-TILE OFFSET IS NEVER ZERO, AND IT DIFFERS BETWEEN THE TWO RECENTRE PAINTS. `cam.ox`
// and `cam.oy` come from `mapOffset`, and they are the camera-relative quantities a bug of this
// class would leak into a world position. At an offset of zero they are zero, so the whole
// recentre check goes blind to exactly what it exists to catch: it was written that way first, and
// a deliberately camera-relative goose passed it.
// A park in a city: turf around the anchor, blocks everywhere else. That is what the world looks
// like, and it keeps the frame under the per-frame flock cap — which matters, because the cap is
// NEAREST FIRST and therefore camera-relative by design. A window of turf edge to edge holds far
// more flocks than the cap allows, so moving the camera five tiles changes which ten draw, and the
// recentre check below would fail on correct code for a reason that has nothing to do with geese.
const park = (wx, wy) => (Math.abs(wx - ANCHOR.ax) <= PARK && Math.abs(wy - ANCHOR.ay) <= PARK
  ? { kind: 'land', biome: 'parkland', flr: 0 }
  : { kind: 'land', biome: 'citycore', flr: 0 });
const turf = () => ({ kind: 'land', biome: 'parkland', flr: 0 });

// ⚠ `resFloor: 1` PINS THE ADAPTIVE RESOLUTION DIAL, and without it the dpr sweep below measures
// the dial rather than the geese. The ratio those GL layers divide by is `baseDpr × st.resStep`,
// and `resStep` is the frame-time dial — so a quad's pushed size moves for a reason that has
// nothing to do with the display. It reported a 1.14× non-linearity as a renderer bug; a clean
// harness with the dial pinned has the same quads scaling exactly. Same line dprsize carries, for
// the same reason.
const viewAt = (centre, height, hour, off = { x: 0.31, y: -0.17 }, heading = 0, groundAt = park) => ({
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height, eyeH: 0.12, fovMul: 1.22,
  hour, weather: 'clear', speed: 0, map: mapFor(centre, groundAt), heading, resFloor: 1,
  mapCenter: { ...centre }, mapOffset: { ...off },
});

// ── THE HARNESS ───────────────────────────────────────────────────────────────
// ⚠ BOTH CLOCKS. The frame animations run on performance.now(), but the FLOCK CYCLE runs on wall
// time — see the ⚠ on drawGeese — so pinning only one leaves the half this file is about free to
// move, and every comparison between two paints becomes a race.
const clock = globalThis.performance;
let T = 1e6;
globalThis.performance = { ...clock, now: () => T };
const realDateNow = Date.now;
Date.now = () => T;
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, geeseWas = ws.RENDER_TUNE.geese;

// ⚠ THE HOOK HAS TO HAND BACK A CANVAS. `if (out && out.canvas)` is what counts as having drawn;
// anything else is the no-WebGL2 path, which puts RENDER_TUNE.gl back to 0 and paints the next
// frame in 2-D — so the sink comes back empty and reads as the pass being broken.
function paint(view) {
  let got = null;
  const c = globalThis.document.createElement('canvas');
  c.width = W; c.height = H;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld((cells, cam, o) => {
    const mesh = o.fauna || [];
    got = {
      // ⚠ THE CAMERA, because one check asks where the GROUND is under a bird and there is no
      // other way to ask it. Held only for the life of the call that returns it.
      cam,
      // ⚠ ONE RECORD PER BIRD, FROM THE MARKER ON ITS FIRST FACE. A goose is forty-odd faces in the
      // solids list and nothing about a face says which animal it belongs to — see the ⚠ on
      // pushFauna. Inferring it from run lengths would break the first time the model gains a part.
      quads: mesh.filter((f) => f.bird).map((f) => ({
        state: f.bird.state,
        // Back to ABSOLUTE world tiles. The mesh is in MAP-WINDOW tiles, and comparing those across
        // a recentre compares the window rather than the geese.
        wx: f.bird.x + view.mapCenter.x,
        wy: f.bird.y + view.mapCenter.y,
        z: f.bird.z, heading: f.bird.heading, beat: f.bird.beat, flare: f.bird.flare, alpha: f.a,
      })),
      faces: mesh.length,
      // ⚠ AND THE LOWEST VERTEX IN THE WHOLE FLOCK, which is the mesh's answer to a question the
      // card version asked with trigonometry: does any part of a bird reach under the turf.
      lowest: mesh.reduce((lo, f) => { for (const v of f.p) if (v[2] < lo) lo = v[2]; return lo; }, Infinity),
      scatter: (o.scatter || []).length,
      gooseCards: (o.scatter || []).filter((q) => typeof q.key === 'string' && q.key.startsWith('goose|')).length,
      // Every billboard in the frame — trees, bushes, rocks, actors — and whether any of them asked
      // to write depth. See check 12.
      otherDepth: (o.scatter || []).filter((q) => q.depth).length,
    };
    return { faces: 1, canvas: c };
  });
  ws.paintWindshield('__fa', view);   // settle every lazy bake
  ws.paintWindshield('__fa', view);   // …and measure the settled frame
  ws.installGLWorld(null);
  return got || { quads: [], scatter: 0, otherDepth: 0 };
}

const airborne = (r) => r.quads.filter((q) => q.state === 'air');
const grounded = (r) => r.quads.filter((q) => q.state !== 'air');

// Find a moment when the nearest flock is on the ground, and one when it is in the air. Searched
// rather than assumed: every flock has its own period and phase, so no fixed clock is guaranteed
// to catch either state.
//
// ⚠ AND THE GROUND MOMENT MUST BE A SETTLED ONE. The FIRST ground frame is the one immediately
// after touchdown, where the flock is still standing in the skein it landed in and easing out of
// it — so the startle below had nothing to move and reported a working feature as broken. Ask for
// a moment clear of both edges by the settle window, which is why that window is a constant in
// goose.js rather than a number in the renderer.
const findT = (want) => {
  for (let i = 0; i < 4000; i++) {
    const t = 1e6 + i * (GOOSE_PERIOD / 400);
    const st = flockState(ANCHOR, t);
    if (st.airborne !== want) continue;
    if (!want) {
      const edge = Math.min(st.u, U_GROUND - st.u) * st.period;
      if (edge < GOOSE_SETTLE_MS * 1.5) continue;
    }
    return t;
  }
  return null;
};
const T_GROUND = findT(false), T_AIR = findT(true);
if (T_GROUND == null || T_AIR == null) problems.push('the nearest flock never reaches one of its two states — the cycle is broken, or U_GROUND is 0 or 1');

// ── 1. IT DRAWS AT ALL, AND INSIDE ITS BUDGET ─────────────────────────────────
T = T_GROUND ?? 1e6;
const ground = paint(viewAt(CENTRE, 0, 12));
T = T_AIR ?? 1e6;
const air = paint(viewAt(CENTRE, 0, 12));

if (!ground.quads.length) problems.push('no goose reached the billboard sink over a field of parkland — the pass drew nothing');
if (!airborne(air).length) problems.push('no airborne goose reached the sink at a moment the flock is flying');
if (!grounded(ground).length) problems.push('no walking goose reached the sink at a moment the flock is on the ground');

// ⚠ AND NOT ONE OF THEM REACHES THE BILLBOARD LAYER. That layer caps at 256 textures shared with
// every tree, rock, actor and landmark, and a flock used to claim up to 46 of them. A mesh claims
// none, so what has to stay bounded is FACES — and the thing that bounds them is GOOSE_MAX_FLOCKS.
const faceHigh = Math.max(ground.faces, air.faces);
if (faceHigh > FACE_MAX) problems.push(`a frame pushed ${faceHigh} fauna faces, over the ${FACE_MAX} this budget allows — see GOOSE_MAX_FLOCKS`);
if (ground.gooseCards || air.gooseCards) problems.push(`${ground.gooseCards + air.gooseCards} goose billboard(s) reached the scatter layer — a drawer has gone back to a card, and the texture cache is not this feature’s to spend`);
notes.push(`drew ${ground.quads.length} walking and ${airborne(air).length} airborne birds; ${faceHigh} faces of a ${FACE_MAX} budget`);

// ── 1b. THE SPACING IS WRITTEN AGAINST THE DRAWN BIRD ─────────────────────────
// `GOOSE_SPAN` is stated in goose.js rather than imported, because that file is shared with the
// server and has no renderer to reach into. This is the other half of that: the two must agree, or
// a model that has since been resized leaves the skein spaced for a bird that no longer exists —
// and the failure is the one this whole change was about, a flock packed tight enough to read as a
// single moving lump.
{
  const row = faunaParamBase('bird', 'goose');
  const drawn = 2 * (row?.span ?? 0) * FAUNA_TILE;
  if (!(Math.abs(GOOSE_SPAN - drawn) < 0.01)) {
    problems.push(`GOOSE_SPAN is ${GOOSE_SPAN} against a drawn wingspan of ${drawn.toFixed(3)} tiles — the skein is spaced for a bird of the wrong size`);
  }
  // …and the birds must not be packed inside each other. The measured wing-tip gap is about a ninth
  // of a span; anything under zero is two geese sharing the same air.
  const gap = SKEIN_ACROSS - drawn;
  if (!(gap > 0)) problems.push(`neighbouring slots are ${SKEIN_ACROSS.toFixed(3)} apart against a ${drawn.toFixed(3)} wingspan — their wings overlap`);
  else notes.push(`slots sit ${gap.toFixed(3)} tiles of daylight apart (${(gap / drawn).toFixed(2)} of a span)`);
}

// ── 2. STATELESS ACROSS A RECENTRE ────────────────────────────────────────────
// The single property the whole design rests on, and the one nothing else in the tree checks: the
// same world at the same instant, seen from a window centred somewhere else, must put the same
// flocks on the same absolute tiles.
//
// ⚠ IT ASKS A DIFFERENT QUESTION OF EACH HALF, AND THAT IS THE DESIGN RATHER THAN A CLIMBDOWN.
// An AIRBORNE bird's position is pure — flock state plus its place in the skein — so it is compared
// exactly. A WALKING bird's is not: it fans out from its flock as something comes near, which is a
// deliberate camera-dependence, so demanding it hold still across a moved camera fails on correct
// code. It did, twice, on four birds of a neighbouring flock that were alarmed in one paint and
// calm in the other. What must hold for the walking half is WHICH FIELDS HAVE GEESE IN THEM, and
// that is what is compared.
//
// ⚠ AND THE TWO PAINTS DELIBERATELY FACE DIFFERENT WAYS. A skein laid out in the CAMERA's frame
// instead of its own flock's is a real bug, and on one shared heading it lands the birds in the
// same absolute places and passes. It took a differing heading to catch it.
//
// ⚠ POSITION AND STATE, NEVER THE BEARING BUCKET. The bucket is camera-relative on purpose — it is
// which way a bird faces relative to where you are looking — so two paints looking different ways
// legitimately disagree about it.
const VIEW_A = { x: ANCHOR.ax, y: ANCHOR.ay + 6 };
const VIEW_B = { x: ANCHOR.ax + 4, y: ANCHOR.ay + 9 };
const OFF_A = { x: 0.31, y: -0.17 }, OFF_B = { x: -0.42, y: 0.28 };
const near6 = (q) => Math.abs(q.wx - ANCHOR.ax) < 6 && Math.abs(q.wy - ANCHOR.ay) < 6;
// Which fields hold geese — a bird attributed to the flock it belongs to, which is the nearest
// anchor. Invariant under the camera for both halves.
const fieldsIn = (r, anchors) => [...new Set(r.quads.filter(near6).map((q) => {
  let best = '?', bd = Infinity;
  for (const a of anchors) { const d = Math.hypot(q.wx - a.ax, q.wy - a.ay); if (d < bd) { bd = d; best = a.ax + ',' + a.ay; } }
  return best;
}))].sort().join(' ');
// Exact bird positions, for the half where they are camera-independent.
const birdsIn = (r) => r.quads.filter(near6)
  .map((q) => q.state + '@' + q.wx.toFixed(3) + ',' + q.wy.toFixed(3))
  .sort().join(' ');

T = T_GROUND ?? 1e6;
const a1 = paint(viewAt(VIEW_A, 0, 12, OFF_A));
const a2 = paint(viewAt(VIEW_B, 0, 12, OFF_B, 14));
const localAnchors = flocksNear(ANCHOR.ax, ANCHOR.ay, 10, 1, (x, y) => !!park(x, y) && park(x, y).biome === 'parkland');
const f1 = fieldsIn(a1, localAnchors), f2 = fieldsIn(a2, localAnchors);
if (!f1) problems.push('the recentre check found no goose near the anchor to compare — it is vacuous');
else if (f1 !== f2) {
  problems.push('a FIELD gained or lost its geese when the map window recentred — the lattice is reading something camera-relative');
  if (REPORT) { console.log('  fields A: ' + f1); console.log('  fields B: ' + f2); }
}

// ⚠ AND AGAIN IN THE AIR, BECAUSE THE TWO HALVES SHARE NO CODE. The skein is laid out only while a
// flock is flying, so a recentre check run at a moment it is on the grass never executes it at all
// — which is how a skein built in the camera's frame passed this twice.
T = T_AIR ?? 1e6;
const b1 = paint(viewAt(VIEW_A, 0, 12, OFF_A));
const b2 = paint(viewAt(VIEW_B, 0, 12, OFF_B, 14));
const air1 = birdsIn(b1), air2 = birdsIn(b2);
if (!air1) problems.push('the airborne recentre check found no goose near the anchor — it is vacuous');
else if (air1 !== air2) {
  problems.push('an AIRBORNE goose moved when the map window recentred — the skein is being laid out in the camera\'s frame rather than its own flock\'s');
  if (REPORT) {
    const A = air1.split(' '), B = air2.split(' ');
    console.log('  only in A: ' + A.filter((x) => !B.includes(x)).join(' '));
    console.log('  only in B: ' + B.filter((x) => !A.includes(x)).join(' '));
  }
}
T = T_GROUND ?? 1e6;

// ── 2b. AND THE STARTLE IS REAL ───────────────────────────────────────────────
// The reason the walking half above is compared by field rather than by bird. Same flock, same
// instant, camera close against camera far: the birds must measurably fan out. Without this the
// camera-dependence is only an excuse for a weaker check rather than a feature anybody tested.
// ⚠ THE ANCHOR'S OWN FLOCK, NOT EVERY BIRD NEAR IT. A flock is rolled per tile, so two can sit
// within a couple of tiles of each other — and the spread of two flocks read as one is the gap
// BETWEEN them, which swamps the effect entirely: it measured 1.67 calm against 1.53 alarmed,
// the wrong way round, from a working startle.
const ownFlock = (q) => {
  let bd = Infinity, best = null;
  for (const fl of localAnchors) { const d = Math.hypot(q.wx - fl.ax, q.wy - fl.ay); if (d < bd) { bd = d; best = fl; } }
  return best && best.ax === ANCHOR.ax && best.ay === ANCHOR.ay;
};
const spreadOf = (r) => {
  const g = r.quads.filter((q) => q.state !== 'air' && ownFlock(q));
  if (g.length < 2) return null;
  const cx = g.reduce((a, q) => a + q.wx, 0) / g.length, cy = g.reduce((a, q) => a + q.wy, 0) / g.length;
  return g.reduce((a, q) => a + Math.hypot(q.wx - cx, q.wy - cy), 0) / g.length;
};
const calm = spreadOf(paint(viewAt({ x: ANCHOR.ax, y: ANCHOR.ay + 14 }, 0, 12)));
const spooked = spreadOf(paint(viewAt({ x: ANCHOR.ax, y: ANCHOR.ay + 2 }, 0, 12)));
if (calm == null || spooked == null) problems.push('the startle check could not see the anchor flock from both distances — it is vacuous');
else if (!(spooked > calm * 1.15)) problems.push(`geese did not fan out when approached: spread ${calm.toFixed(3)} calm vs ${spooked.toFixed(3)} at two tiles`);
else notes.push(`startle spreads the flock ${(spooked / calm).toFixed(2)}×`);

// ── 3. DETERMINISTIC AT A FIXED CLOCK ─────────────────────────────────────────
const d1 = paint(viewAt(CENTRE, 0, 12));
const d2 = paint(viewAt(CENTRE, 0, 12));
if (JSON.stringify(d1.quads) !== JSON.stringify(d2.quads)) {
  problems.push('two paints of the same frame at the same instant produced different geese — something in the pass is rolling dice');
}

// ── 4. THE OFF SWITCH IS THE ABSENCE OF THE PASS ──────────────────────────────
// RENDER_TUNE's standing rule: 0 restores exactly the renderer that shipped.
//
// ⚠ THIS ASSERTS THE OUTCOME, AND THE OUTCOME HAS TWO INDEPENDENT ENFORCERS: the early return in
// `drawGeese`, and `density` reaching `flocksNear`, where a threshold of zero rejects every cell.
// Deleting either one alone leaves this green. That is the right bar for "is the switch off" and it
// must not be read as covering either guard on its own — the same caveat applies to the night check
// below, where the early return and the `dayFade` alpha each take the frame to nothing.
ws.RENDER_TUNE.geese = 0;
const off = paint(viewAt(CENTRE, 0, 12));
ws.RENDER_TUNE.geese = geeseWas;
if (off.quads.length) problems.push(`RENDER_TUNE.geese = 0 still pushed ${off.quads.length} bird(s)`);
if (off.faces) problems.push(`RENDER_TUNE.geese = 0 still pushed ${off.faces} fauna face(s)`);
// …and the scatter must be untouched by the switch, or "0" is deleting somebody else's work. The
// flock contributes nothing to that layer now, so this is an equality rather than a subtraction.
if (off.scatter !== ground.scatter) {
  problems.push(`geese = 0 changed the scatter layer too (${off.scatter} against ${ground.scatter}) — the flock is not meant to be in it at all`);
}

// ── 5. THE HEIGHT SPLIT ───────────────────────────────────────────────────────
// A walking bird is knee-high and stops being worth projecting from anything but a low pass; a
// flying one has to stay visible from a cockpit. The gate is a property of the STATE, so one
// height must keep the air half and drop the ground half.
T = T_GROUND ?? 1e6;
const highGround = paint(viewAt(CENTRE, 0.3, 12));
if (grounded(highGround).length) problems.push('walking geese still drew from above the street-figure height');
T = T_AIR ?? 1e6;
const highAir = paint(viewAt(CENTRE, 0.3, 12));
if (!airborne(highAir).length) problems.push('airborne geese vanished at a height a cockpit actually flies at');
const tooHigh = paint(viewAt(CENTRE, 0.9, 12));
if (tooHigh.quads.length) problems.push('geese still drew above GOOSE_AIR_MAX_H, where a bird is sub-pixel');

// ── 6. GROUND THAT IS NOT THEIRS ──────────────────────────────────────────────
// ⚠ A TEST MAP MADE ENTIRELY OF HABITAT CANNOT SEE THE HABITAT CHECK. Every assertion above runs
// over open turf, so deleting the check outright changes not one of them. The same field paved
// over, with the same anchors under it, must draw nothing at all.
T = T_GROUND ?? 1e6;
const sweep = (cell, label) => {
  const r = paint(viewAt(CENTRE, 0, 12, undefined, 0, () => ({ ...cell })));
  if (r.quads.length) problems.push(`${r.quads.length} goose quad(s) drew on ${label}`);
};
// Ground that is not turf at all — the habitat table's own job.
sweep({ kind: 'land', biome: 'redrock', flr: 0 }, 'bare redrock');
sweep({ kind: 'land', biome: 'citycore', flr: 0 }, 'a city block');
// ⚠ AND TURF THAT IS STILL NOT STANDING ROOM. A path through a park and a shed on a lawn are both
// habitat by biome, so the `bt`/`road` guard is the only thing refusing them — and a sweep made
// only of non-habitat ground lets that guard be deleted with every check still green.
sweep({ kind: 'land', biome: 'parkland', flr: 0, road: 1, rd: 'ns' }, 'a road through a park');
sweep({ kind: 'land', biome: 'park', flr: 0, bt: 'shop', is_building: 1, floors: 3 }, 'a building on a lawn');

// ── 7. THE CAP HOLDS AT THE TOP OF THE SLIDER ─────────────────────────────────
// ⚠ A SCENE WITH THREE FLOCKS IN IT CANNOT SEE A CAP OF TEN. The nearest-first cap is a frame
// budget — the thing that stops a park district owning the frame — and every check above runs in a
// field sparse enough that it is never reached.
//
// ⚠ AND COUNTING QUADS IS NOT COUNTING FLOCKS. A ceiling of "the cap times the biggest a flock
// gets" is arithmetically correct and useless in practice: wound up to the slider's maximum this
// scene draws 55 uncapped against a ceiling of 60, so deleting the cap outright leaves it green.
// Each bird is instead attributed to its NEAREST ANCHOR — which is what a flock is — and the
// distinct count is the thing the cap actually bounds.
const GOOSE_MAX_FLOCKS = 10;
const nearestAnchor = (q, anchors) => {
  let best = null, bd = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(q.wx - a.ax, q.wy - a.ay);
    if (d < bd) { bd = d; best = a; }
  }
  return best ? best.ax + ',' + best.ay : '?';
};
ws.RENDER_TUNE.geese = 3;
const dense = paint(viewAt(CENTRE, 0, 12, undefined, 0, turf));
ws.RENDER_TUNE.geese = geeseWas;
const denseAnchors = flocksNear(CENTRE.x, CENTRE.y, 40, 3, () => true);
const denseFlocks = new Set(dense.quads.map((q) => nearestAnchor(q, denseAnchors))).size;
if (denseFlocks > GOOSE_MAX_FLOCKS) {
  problems.push(`at the slider's maximum ${denseFlocks} flocks drew in one frame, past the cap of ${GOOSE_MAX_FLOCKS}`);
}
if (denseAnchors.length <= GOOSE_MAX_FLOCKS) {
  problems.push(`the dense scene only has ${denseAnchors.length} candidate flocks, so the cap of ${GOOSE_MAX_FLOCKS} is never reached and this check is vacuous`);
}
notes.push(`${denseFlocks} flocks drew of ${denseAnchors.length} candidates at density 3 (cap ${GOOSE_MAX_FLOCKS})`);

// ── 8. NIGHT ──────────────────────────────────────────────────────────────────
T = T_GROUND ?? 1e6;
const night = paint(viewAt(CENTRE, 0, 2));
if (night.quads.length) problems.push('geese drew after dark — the pass is meant to be day-gated, as drawBirds is');

// ── 9. NOTHING IS LEFT PAINTING ON THE CANVAS ─────────────────────────────────
// `worldresidue` asks this of every other world painter and cannot ask it of the geese: it runs at
// hour 22 because the lamps and the lit scatter are night-gated, and a goose stops drawing after
// dark. Same question, same instrument, in the one scene that can answer it.
//
// ⚠ THE FAILURE IT IS FOR IS `emitFace`. That defers its closure to `flushFaces()`, which runs
// AFTER the GL composite has already read the sink — so a goose queued there reaches the GPU never
// and paints over the finished city instead, with an all-or-nothing probe at its feet as the only
// thing between it and a tower. It draws nothing on the depth buffer and reports nothing, which is
// the hard failure to see. `emitScatterFace` is the seam that avoids it.
//
// ⚠ AND THE CONTROL IS NOT OPTIONAL. An empty tally is also what comes back from a scene with no
// geese in it, which is how a census comes to carry a claim about a painter it never ran.
T = T_GROUND ?? 1e6;
const censusView = viewAt(CENTRE, 0, 12);
function census(glOn) {
  const c = globalThis.document.createElement('canvas');
  c.width = W; c.height = H;
  ws.RENDER_TUNE.gl = glOn ? 1 : 0; ws.RENDER_TUNE.glFloor = glOn ? 1 : 0;
  ws.installGLWorld(glOn ? (() => ({ faces: 1, canvas: c })) : null);
  ws.paintWindshield('__fa', censusView);
  globalThis.window.__emitWhoStart();
  ws.paintWindshield('__fa', censusView);
  const rows = globalThis.window.__emitWho();
  ws.installGLWorld(null);
  if (typeof rows === 'string') return [];
  return rows.map((l) => { const m = l.match(/^(\d+)\s+(.*)$/); return m ? { faces: +m[1], tag: m[2] } : null; }).filter(Boolean);
}
// ⚠ AND THE CONTROL MUST ACTUALLY PAINT A BIRD, not merely queue one. With GLASS 2 off the sink
// is closed, so a drawer that only pushes a billboard draws NOTHING — and 
// still queues its closure, so the tally below counts 28 faces either way. That is exactly how
// the geese shipped invisible on the 2-D path with every headless gate green; it took looking at
// a frame in a browser to see it. Counting the PAINTER is what tells the two apart.
const paintBefore = faunaPaintCount();
const ctrlRows = census(false);
const after = faunaPaintCount();
const walkedC = after.walk - paintBefore.walk, airC = after.air - paintBefore.air;
// ⚠ BOTH HALVES, SEPARATELY. The walking and flying drawers are different code, so a total lets
// one of them lose its canvas path with the other keeping the count above zero.
if (!walkedC) problems.push('GLASS 1 queued geese but painted no WALKING bird — drawGooseGround only pushes a billboard, so with GLASS 2 off the flock on the grass is invisible');
if (!airC) problems.push('GLASS 1 queued geese but painted no FLYING bird — drawGooseAir only pushes a billboard, so with GLASS 2 off the skein is invisible');
if (walkedC && airC) notes.push(`GLASS 1 painted ${walkedC} walking and ${airC} flying`);
const glRows = census(true);
const gooseIn = (rows) => rows.filter((r) => /drawGeese/.test(r.tag));
if (!gooseIn(ctrlRows).length) {
  problems.push('the GLASS 1 control drew no drawGeese — the scene does not contain what this measures, so an empty GLASS 2 tally would mean nothing');
} else {
  const left = gooseIn(glRows);
  if (left.length) problems.push(`drawGeese left ${left.reduce((a, r) => a + r.faces, 0)} face(s) on the canvas over the composited city — it is queueing through emitFace rather than emitScatterFace`);
}
if (REPORT) {
  console.log('  control goose rows: ' + (gooseIn(ctrlRows).map((r) => r.faces + ' ' + r.tag).join(' | ') || 'none'));
  console.log('  residue goose rows: ' + (gooseIn(glRows).map((r) => r.faces + ' ' + r.tag).join(' | ') || 'none'));
}

// ── 10. THE DISPLAY RATIO CANNOT REACH IT ─────────────────────────────
// `dprsize` sweeps every billboard producer for a size handed over in CSS pixels where device ones
// belong — an error that is exactly zero at dpr 1, which is what every other harness here runs at,
// and a moving 1.67× in the game because the ratio carries the adaptive resolution dial. A goose
// used to be one of those producers and pushed DIRECTLY rather than through `scatterBillboard`,
// which made it the one that could forget the funnel.
//
// ⚠ A MESH CANNOT HAVE THAT BUG, AND THAT IS WORTH ASSERTING RATHER THAN ASSUMING. Its vertices
// are world tiles; nothing about a display converts them. So the sweep stays and the claim gets
// stronger: the geometry must be IDENTICAL at every ratio, not merely proportional to one.
const RATIOS = [0.6, 1, 1.5, 2];
const byRatio = new Map();
for (const dpr of RATIOS) {
  globalThis.window.devicePixelRatio = dpr;
  // ⚠ RE-STUB THE CANVAS AT EACH RATIO, as dprsize does. `stubCanvas` sets the CSS box and the
  // backing store to the same numbers; the renderer then writes the backing store to
  // clientWidth × dpr and leaves it there. Reuse one element across ratios and the next paint
  // starts from the PREVIOUS ratio’s backing store, which moves the focal length — and a gate that
  // reports a bug in the renderer that is really a bug in the harness is worse than no gate.
  stubCanvas('__fa', W, H);
  T = T_AIR ?? 1e6;
  byRatio.set(dpr, paint(viewAt(CENTRE, 0, 12)));
}
stubCanvas('__fa', W, H);
globalThis.window.devicePixelRatio = 1;
const oneAt = byRatio.get(1);
if (!oneAt.quads.length) problems.push('the dpr sweep reached no goose — it is vacuous');
else {
  let said = false;
  for (const dpr of RATIOS) {
    if (said) break;
    const r = byRatio.get(dpr);
    if (r.quads.length !== oneAt.quads.length || r.faces !== oneAt.faces) {
      problems.push(`the scene drew ${r.quads.length} birds in ${r.faces} faces at dpr ${dpr} against ${oneAt.quads.length} in ${oneAt.faces} at 1 — the ratio changed the scene, so nothing here can be compared`);
      said = true; break;
    }
    for (let i = 0; i < r.quads.length && !said; i++) {
      for (const f of ['wx', 'wy', 'z']) {
        if (Math.abs(r.quads[i][f] - oneAt.quads[i][f]) > 1e-9) {
          problems.push(`a goose’s ${f} moved with the display ratio (${r.quads[i][f]} at dpr ${dpr} against ${oneAt.quads[i][f]} at 1) — a world position is being derived from a screen size`);
          said = true; break;
        }
      }
    }
  }
  if (!said) notes.push(`the mesh is identical across dpr ${RATIOS.join(', ')}`);
}
T = T_GROUND ?? 1e6;

// ── 11. FLYING THROUGH THEM IS WHAT CAUSES A BIRD STRIKE ──────────────────────
// `plugins/flight/hazards.js` used to roll `Math.random() < 0.05` per tick. It asks
// `flockOnSegment` now, so a strike is a flock that was in front of you — which means the strike
// and the picture are the same arithmetic and cannot disagree about whether a bird was there.
//
// ⚠ THE SWEPT TEST IS THE WHOLE POINT, so it gets the check. The flight tick is 3 s and an
// aircraft crosses several tiles in that time; a "am I near a flock now" test misses the one you
// went straight through between two samples, and misses it silently — the pilot sees the flock,
// flies into it, and nothing happens. The road signs in the trucking model record the same trap.
{
  const anyGround = () => true;
  // A moment the anchor flock is flying, and the leg that goes through where it is.
  const tAir = T_AIR ?? 1e6;
  const st = flockState(ANCHOR, tAir);
  if (!st.airborne) problems.push('the strike check could not find the anchor flock airborne — it is vacuous');
  else {
    // Straight through the middle of it.
    const through = flockOnSegment(st.cx - 3, st.cy, st.cx + 3, st.cy, tAir, anyGround);
    if (!through) problems.push('a leg passing straight through an airborne flock did not register a strike');

    // ⚠ THE SAME LEG AS A POINT TEST AT EACH END. Both endpoints are three tiles clear of the
    // flock, so a check that only asked "is one near a flock" would find nothing — which is
    // precisely the miss. If this ever passes, the test has stopped being swept.
    const atStart = flockOnSegment(st.cx - 3, st.cy, st.cx - 3, st.cy, tAir, anyGround);
    const atEnd = flockOnSegment(st.cx + 3, st.cy, st.cx + 3, st.cy, tAir, anyGround);
    if (atStart || atEnd) problems.push('an endpoint three tiles from the flock registered a strike on its own — the radius is far too wide to mean anything');

    // Well clear, and nothing happens however far you fly.
    const clear = flockOnSegment(st.cx - 3, st.cy + 40, st.cx + 3, st.cy + 40, tAir, anyGround);
    if (clear) problems.push('a leg forty tiles from any flock still registered a strike');

    // Ground that is not theirs holds no flock, so there is nothing to hit.
    const noHabitat = flockOnSegment(st.cx - 3, st.cy, st.cx + 3, st.cy, tAir, () => false);
    if (noHabitat) problems.push('a strike registered over ground the habitat test refused');

    // ⚠ AND A GOOSE ON THE GRASS IS NOT IN ANYBODY'S WAY. At a moment the flock is down, the same
    // leg over the same tiles must find nothing — otherwise the hazard fires at a bird that is
    // standing on a lawn, which the pilot can see it is.
    const tGround = T_GROUND ?? 1e6;
    const down = flockState(ANCHOR, tGround);
    const overGrazing = flockOnSegment(down.cx - 3, down.cy, down.cx + 3, down.cy, tGround, anyGround);
    if (overGrazing) problems.push('a flock ON THE GROUND registered a bird strike');
    notes.push('a leg through an airborne flock strikes, its own endpoints do not, and a grazing flock never does');
  }
}

// ── 12. WHAT FLIES IS SOLID, AND NOTHING ELSE ASKS TO BE ──────────────────
// Reported as the clouds appearing in front of the geese, and it was one property of one quad: a
// billboard writes no depth, so the cloud deck — which runs after the world and tests against the
// depth the world left — found the ground four hundred tiles behind the flock and painted over it.
// `glAirDepth` bought the silhouette back by laying the card into the depth buffer in a prepass.
//
// ⚠ A MESH WRITES ITS OWN DEPTH AND THE PROBLEM IS GONE RATHER THAN FIXED, which is a different
// thing to check: the flock must be in the SOLIDS list and not in the billboard one, and the flag
// must no longer reach it. The flag still governs the air CONTACTS, which are still cards.
//
// ⚠ NO HEADLESS GATE CAN SEE THE PICTURE. Every harness here installs a GL hook that returns a bare
// canvas, so not one of them reaches a draw call, let alone a depth test; `__glGooseSky()` in the
// Modelshop is the instrument that measures the pixels. What IS checkable here is the DATA.
{
  const airDepthWas = ws.RENDER_TUNE.glAirDepth;
  T = T_AIR ?? 1e6;
  const flying = paint(viewAt(CENTRE, 0, 12));
  const air12 = airborne(flying), ground12 = grounded(flying);
  if (!air12.length) problems.push('no airborne goose in the depth check — it is vacuous');
  if (flying.gooseCards) problems.push(`${flying.gooseCards} goose billboard(s) reached the scatter layer — a flying bird on a card has no depth of its own and the cloud deck paints over the flock`);
  if (flying.otherDepth) problems.push(`${flying.otherDepth} billboards asked to write depth in a scene with no air contacts in it`);

  ws.RENDER_TUNE.glAirDepth = 0;
  const flat = paint(viewAt(CENTRE, 0, 12));
  ws.RENDER_TUNE.glAirDepth = airDepthWas;
  // ⚠ THE FLAG MAY NOT TOUCH THE FLOCK AT ALL NOW. It was the geese’s own switch; leaving them
  // wired to it would be a knob that quietly half-removes a feature it no longer owns.
  if (flat.faces !== flying.faces || airborne(flat).length !== air12.length) {
    problems.push('glAirDepth changed the flock — it governs the air contacts, and a bird is geometry now');
  }
  notes.push(`${air12.length} airborne and ${ground12.length} walking birds, all of them solid, none on a card`);
}

// ── 13. THE TOUCHDOWN DOES NOT POP ────────────────────────────────────────────
// The flock itself has always landed correctly — the circuit's radius rides the same ramp as its
// height, so both collapse onto the anchor together and the centre crosses the boundary having
// moved nothing. What the birds did was jump: the skein and the milling patch are unrelated
// arithmetic, so at the instant the state flipped every bird went from its slot in the formation to
// a milling position whose phase comes off the wall clock. Measured through this same sink before
// the blend: 0.37 tiles mean, 0.45 worst, in ONE frame, on birds that mill inside a 0.34-tile
// radius. Nothing throws, nothing is missing, and it reads as the flock respawning on landing.
{
  let land = null;
  for (let i = 1; i < 12000; i++) {
    const t0 = 1e6 + (i - 1) * 25, t1 = 1e6 + i * 25;
    if (flockState(ANCHOR, t0).airborne && !flockState(ANCHOR, t1).airborne) { land = [t0, t1]; break; }
  }
  if (!land) problems.push('the nearest flock never touches down in the search window — the cycle is broken');
  else {
    // ⚠ THE ANCHOR'S OWN FLOCK, for the reason the startle check records: a neighbouring flock
    // read as part of this one measures the gap between two flocks rather than the jump. At both
    // boundary frames this flock's centre IS the anchor tile, so a tile's radius isolates it and
    // keeps drawGeese's own emission order.
    const mine = (r) => r.quads.filter((q) => Math.hypot(q.wx - ANCHOR.ax, q.wy - ANCHOR.ay) < 1.2);
    T = land[0]; const lastAir = mine(paint(viewAt(CENTRE, 0, 12)));
    T = land[1]; const firstGnd = mine(paint(viewAt(CENTRE, 0, 12)));
    const st0 = flockState(ANCHOR, land[0]), st1 = flockState(ANCHOR, land[1]);
    const centre = Math.hypot(st0.cx - st1.cx, st0.cy - st1.cy);

    if (!lastAir.length || !firstGnd.length) problems.push('the touchdown check saw no birds at the boundary — it is vacuous');
    else if (lastAir.length !== firstGnd.length) problems.push(`the flock changed size across its own touchdown: ${lastAir.length} → ${firstGnd.length}`);
    else if (!(st0.z < 0.01)) problems.push(`the flock's last airborne frame is ${st0.z.toFixed(2)} tiles up — it stops flying before it reaches the ground`);
    // ⚠ NOT ZERO, BECAUSE THE BOUNDARY IS SAMPLED ON A 25 ms GRID. The last airborne frame is a
    // hair short of the end of the ramp, so the radius there is ~7e-6 tiles rather than 0, and a
    // check for exact equality fails on a circuit that closes perfectly.
    else if (centre > 1e-3) problems.push(`the flock centre moved ${centre.toExponential(1)} tiles across the touchdown — the circuit does not close on the anchor`);
    else {
      let worst = 0;
      for (let i = 0; i < lastAir.length; i++) {
        worst = Math.max(worst, Math.hypot(lastAir[i].wx - firstGnd[i].wx, lastAir[i].wy - firstGnd[i].wy));
      }
      // A tenth of a tile is twice a goose's own length and a fifth of a bird's mill radius — well
      // under the 0.45 that was there, and loose enough that the settle blend may be retuned.
      if (worst > 0.1) problems.push(`a bird jumped ${worst.toFixed(2)} tiles in the single frame it landed — the ground layout does not start from the skein`);
      else {
        // ⚠ AND IT MUST NOT SIMPLY BE STUCK THERE. A blend that never releases passes the check
        // above perfectly and leaves a flock frozen in formation on the grass for ever.
        const settled = findT(false);
        const free = settled == null ? null : (T = settled, mine(paint(viewAt(CENTRE, 0, 12))));
        let moved = 0;
        if (free && free.length === firstGnd.length) {
          for (let i = 0; i < free.length; i++) moved = Math.max(moved, Math.hypot(free[i].wx - firstGnd[i].wx, free[i].wy - firstGnd[i].wy));
        }
        if (!(moved > 0.05)) problems.push('the flock never left the formation it landed in — the settle blend releases nothing');
        else notes.push(`touchdown moves a bird ${worst.toFixed(3)} tiles and it is ${moved.toFixed(2)} clear of the skein once settled`);
      }
    }
  }
}

// ── 13b. AND IT DOES NOT SINK INTO THE FIELD IT IS LANDING IN ─────────────
// The other half of the touchdown, and the half nothing was measuring: the birds arrived in the
// right PLACE at the wrong HEIGHT, and the depth-tested ground cut off everything under them.
// Reported twice — "the geese almost disappear below the ground on landing, just the top of the
// heads visible" — and the second time it was the whole card rather than the wings.
//
// ⚠ THE MESH ANSWERS IT DIRECTLY, WHICH IS WHY THIS CHECK GOT SHORTER. The card version had to
// recover pixels-per-model-unit from the pushed quad and solve for how far the picture hung below
// its own anchor; a solid bird simply has vertices, and the question is whether any of them is
// under z = 0 while the flock is within a breath of the ground.
//
// ⚠ AND IT IS NOT A CHECK ON THE FLARE. Holding the wings out of the full downstroke near the
// ground is one way to satisfy this and not the only one, so what is asserted is the OUTCOME —
// nothing sinks — which stays true if that is ever retuned and goes red if it is removed.
{
  // Every airborne frame within a breath of the ground, at both ends: a flock takes off through the
  // same turf it lands in, and a fix applied to one end only is a fix nobody would notice.
  const edges = [];
  for (let i = 1; i < 12000; i++) {
    const a2 = flockState(ANCHOR, 1e6 + (i - 1) * 25), b2 = flockState(ANCHOR, 1e6 + i * 25);
    if (a2.airborne !== b2.airborne) edges.push([1e6 + (i - 1) * 25, a2.airborne]);
    if (edges.length === 2) break;
  }
  const times = [];
  for (const [t, wasAir] of edges) {
    // wasAir: this is the last airborne frame before touchdown, so walk BACK from it. Otherwise it
    // is the last ground frame before take-off, so walk forward.
    for (let k = 0; k < 10; k++) times.push(t + (wasAir ? -k * 40 : 25 + k * 40));
  }
  // A standing goose’s own feet are at z = 0 and its toes spread a hair either side, so the bar is
  // a hair rather than zero. The un-lifted air pose measured 0.37 model units under, level, and
  // 0.79 wings-down; this is 0.02 of a tile, which is a quarter of one bird’s height.
  const SINK = 0.02;
  let worst = 0, seen = 0, lowestZ = Infinity;
  for (const t of times) {
    if (!flockState(ANCHOR, t).airborne) continue;
    T = t;
    const r = paint(viewAt(CENTRE, 0, 12));
    if (!airborne(r).length) continue;
    seen++;
    lowestZ = Math.min(lowestZ, ...airborne(r).map((q) => q.z));
    if (r.lowest < -worst) worst = -r.lowest;
  }
  if (!seen) problems.push('no airborne goose drew within a breath of the ground at either end of the flight — the sink check is vacuous');
  else if (lowestZ > 0.02) problems.push(`the lowest airborne goose the sink check saw was ${lowestZ.toFixed(3)} tiles up — it never gets near the turf, so it is measuring nothing`);
  else if (worst > SINK) problems.push(`a landing goose reaches ${worst.toFixed(3)} tiles under the ground over ${seen} frames — the depth-tested turf cuts that much off the bird`);
  else notes.push(`a landing bird reaches at most ${worst.toFixed(4)} tiles under the turf over ${seen} frames at both ends of the flight`);
}

// ── 14. A FLOCK POINTS THE WAY IT IS GOING ────────────────────────────────────
// The circuit has TWO moving terms — the angle round it and the radius, which rides the ramp — so
// the course is tangential plus radial, and through the climb and the descent the radial part is
// the bigger one. The heading shipped as the bare tangent, which is 90° out at both ends where the
// radius is zero: the flock flew sideways for 40% of every flight. Differenced from the POSITION
// this function reports, so it owes nothing to the field it is checking.
{
  let worst = 0, sum = 0, n = 0;
  for (const fl of localAnchors) {
    const period = flockState(fl, 1e6).period;
    for (let k = 0; k <= 120; k++) {
      const now = 1e6 + (k / 120) * period;
      const s = flockState(fl, now);
      if (!s.airborne) continue;
      const a = flockState(fl, now - 12), b = flockState(fl, now + 12);
      if (!a.airborne || !b.airborne) continue;
      const vx = b.cx - a.cx, vy = b.cy - a.cy;
      if (!vx && !vy) continue;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(vy, vx) - s.heading), Math.cos(Math.atan2(vy, vx) - s.heading))) * 180 / Math.PI;
      sum += off; n++; if (off > worst) worst = off;
    }
  }
  if (!n) problems.push('the heading check found no airborne sample — it is vacuous');
  // ⚠ The bound is generous against the finite difference, not against the bug: the tangent was
  // 18.3° mean and a full 90° worst, so anything near a right angle is the old behaviour back.
  else if (worst > 15) problems.push(`a flock is drawn ${worst.toFixed(0)}° off the course it is actually flying (mean ${(sum / n).toFixed(1)}°)`);
  else notes.push(`heading tracks the course to ${worst.toFixed(0)}° worst over ${n} airborne samples`);
}

// ── 15. THE CIRCUIT GOES ROUND THE BUILDINGS ──────────────────────────────────
// A circle of GOOSE_R drawn round a park tile is three and a half tiles across, and a park in a
// city has something standing within three and a half tiles of most of its tiles. Reported exactly
// that way: the flock flies through the buildings.
//
// ⚠ THE CONTROL IS THE WHOLE CHECK. "No sample landed on a built tile" is also what comes back
// when the buildings are not in the flock's way in the first place — so the same circuit is swept
// with no clearance profile at all, and if THAT one is clean the scene is proving nothing and this
// says so rather than passing.
{
  // A terrace down one side of the anchor and a block across the other, both well inside GOOSE_R.
  const WALL = new Set(['2,-1', '2,0', '2,1', '2,2', '3,0', '3,1', '-1,-2', '0,-2', '1,-2', '0,-3']);
  const blocked = (wx, wy) => WALL.has((wx - ANCHOR.ax) + ',' + (wy - ANCHOR.ay));
  const onBuilding = (clear) => {
    let hits = 0, samples = 0;
    const period = flockState(ANCHOR, 1e6).period;
    for (let k = 0; k <= 600; k++) {
      const s = flockState(ANCHOR, 1e6 + (k / 600) * period, clear);
      if (!s.airborne) continue;
      samples++;
      if (blocked(Math.round(s.cx), Math.round(s.cy))) hits++;
    }
    return { hits, samples };
  };
  const bent = onBuilding(flockClearance(ANCHOR, blocked));
  const straight = onBuilding(null);
  if (!straight.hits) {
    problems.push('the avoidance control is vacuous — the plain circle misses this scene\'s buildings, so nothing is being avoided');
  } else if (bent.hits) {
    problems.push(`a flock's circuit crosses a built tile at ${bent.hits} of ${bent.samples} samples (the plain circle crosses at ${straight.hits})`);
  } else {
    notes.push(`the circuit bends off ${straight.hits} built-tile crossings of ${straight.samples}`);
  }
  // ⚠ AND IT MUST NOT COLLAPSE. Fitting ONE radius to the clear space takes the minimum over the
  // compass, so a single shed pulls the whole circuit into a buzz over the anchor — which passes
  // the check above and is not what a flock does. The loop has to stay wide on the open side.
  const prof = flockClearance(ANCHOR, blocked);
  if (!prof) problems.push('flockClearance answered null for a scene with ten built tiles in it');
  else if (Math.max(...prof) < 2.6) problems.push(`the circuit collapsed to ${Math.max(...prof).toFixed(2)} tiles at its widest — a shed on one side must not shrink the open side`);
  else notes.push(`clearance ${Math.min(...prof).toFixed(2)}–${Math.max(...prof).toFixed(2)} tiles round the compass`);
  // …and open country is still the plain circle, allocating nothing.
  if (flockClearance(ANCHOR, () => false) !== null) problems.push('a flock over open ground built a clearance profile it does not need');
}

// ── 15c. AND THE BENT CIRCUIT IS STILL A FLIGHT PATH ──────────────────────────
// ⚠ THE POSITION BEING RIGHT IS NOT THE SAME AS THE PATH BEING FLYABLE, and this is the check that
// cost the most to learn. A radius sampled at twelve spokes and interpolated with SMOOTHSTEP is C1,
// cannot overshoot, and is the obvious safe choice — and its derivative is zero at every spoke, so
// the loop flattens at each one. On the position that is a 0.07-tile scallop nobody would ever see.
// But the renderer banks the birds off the TURN RATE, which is the derivative, and there the same
// artefact is a swing from +73°/s to -103°/s and back, seven times in one pass: a skein rolling
// hard left, hard right, hard left round the obstruction. Correct positions, and visibly broken.
//
// So the thing measured is what a viewer actually sees — the BANK ANGLE, at a realistic sampling
// interval — and not the radius, which looked perfect throughout.
{
  const WALL = new Set(['2,-1', '2,0', '2,1', '2,2', '3,0', '3,1', '-1,-2', '0,-2', '1,-2', '0,-3']);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // The renderer's own bank, in degrees — see GOOSE_BANK_MAX / GOOSE_BANK_PER_RAD in windshield.js.
  const bank = (turn) => clamp(turn * 1.9, -0.50, 0.50) * 180 / Math.PI;
  const STEP = 100;            // ms of wall clock, about six frames
  let worst = 0, worstAt = '';
  for (const fl of flocksNear(ANCHOR.ax, ANCHOR.ay, 14, 1, () => true)) {
    const blocked = (wx, wy) => WALL.has((wx - fl.ax) + ',' + (wy - fl.ay));
    const clear = flockClearance(fl, blocked);
    const period = flockState(fl, 1e6).period;
    let prev = null;
    for (let T = 1e6; T < 1e6 + period; T += STEP) {
      const s = flockState(fl, T, clear);
      // The two ends of the lap are excluded because the radius ramps through zero there and the
      // course genuinely does swing fast — a fact about the circuit, not about the interpolation.
      if (!s.airborne || s.t < 0.15 || s.t > 0.85) { prev = null; continue; }
      const b = bank(s.turn);
      if (prev != null && Math.abs(b - prev) > worst) { worst = Math.abs(b - prev); worstAt = `${fl.ax},${fl.ay} t=${s.t.toFixed(2)}`; }
      prev = b;
    }
  }
  // ⚠ THE BOUND IS AGAINST THE ARTEFACT AND IT IS THE OUTCOME THAT IS GATED, NOT A MECHANISM.
  // THREE things hold this number down — the slew limit on the profile, the matched-tangent spline
  // between spokes, and the wide window `turn` is differenced over — and they are deliberately
  // redundant, so mutating any ONE of them still passes. Measured on this sweep: 57° with all three
  // gone (which is where this shipped from), 22-23° with any one of them gone, 13° as it stands.
  // A check pinned to one mechanism would go quiet the day somebody replaced it with a better one;
  // this one only cares that the wings are not flapping between hard left and hard right bank.
  if (worst > 25) problems.push(`a flock's bank swings ${worst.toFixed(0)}° in ${STEP}ms at ${worstAt} — the circuit's radius is not C1 where it bends`);
  else notes.push(`the bank moves at most ${worst.toFixed(0)}° per ${STEP}ms round an obstruction`);
}

// ── 15b. AND THE PASS CARRIES IT, NOT JUST THE GEOMETRY ───────────────────────
// ⚠ A CORRECT `flockClearance` NOBODY CALLS IS THE SAME PICTURE AS NO `flockClearance` AT ALL. The
// check above is pure arithmetic out of goose.js; this one paints, and asks where the quads landed.
//
// ⚠ AND IT HAS TO SWEEP THE CLOCK, NOT PAINT ONE MOMENT. A lap takes most of a minute and the block
// occupies a few tiles of it, so a single frame catches the flock over the buildings only by luck —
// written that way first, it passed with the pass's clearance deleted outright. The control says
// which moments MATTER: the plain circle's own centre, at the same instants, on a built tile.
{
  const BLOCK = { kind: 'land', biome: 'citycore', flr: 4, bt: 'office', ent: 'west', is_building: 1, floors: 4 };
  const onBlock = (wx, wy) => {
    const rx = Math.round(wx - ANCHOR.ax), ry = Math.round(wy - ANCHOR.ay);
    return rx >= 2 && rx <= 3 && ry >= -2 && ry <= 2;
  };
  const builtAt = (wx, wy) => (onBlock(wx, wy) ? { ...BLOCK } : park(wx, wy));
  const view = viewAt({ x: ANCHOR.ax, y: ANCHOR.ay + 7 }, 0, 12, undefined, 0, builtAt);
  const period = flockState(ANCHOR, 1e6).period;
  // How far INSIDE the block a point is, in tiles — 0 anywhere outside it. The block is rx 2..3 and
  // ry -2..2 as whole tiles, so its edges are at 1.5/3.5 and ±2.5.
  const depthIn = (wx, wy) => {
    const rx = wx - ANCHOR.ax, ry = wy - ANCHOR.ay;
    return Math.max(0, Math.min(rx - 1.5, 3.5 - rx, ry + 2.5, 2.5 - ry));
  };
  let over = 0, flying = 0, wouldCross = 0, centreOver = 0, deepest = 0;
  const offenders = [];
  for (let k = 0; k < 40; k++) {
    T = 1e6 + (k / 40) * period;
    const st = flockState(ANCHOR, T);                 // the PLAIN circle — the control
    if (!st.airborne) continue;
    if (onBlock(st.cx, st.cy)) wouldCross++;
    const r = paint({ ...view, map: mapFor({ x: ANCHOR.ax, y: ANCHOR.ay + 7 }, builtAt) });
    const air = airborne(r);
    flying += air.length;
    const bad = air.filter((q) => onBlock(q.wx, q.wy));
    over += bad.length;
    for (const q of bad) deepest = Math.max(deepest, depthIn(q.wx, q.wy));
    // ⚠ AND THE CENTRE SEPARATELY, because that is the half of this the design promises absolutely:
    // flockClearance bends the CIRCUIT, and the birds are spread either side of wherever it goes.
    // ⚠ The BENT circuit, never `st` — that one is the plain circle this scene uses as its control,
    // so testing it here just re-counts `wouldCross` and fails every time the control works.
    const bent = flockState(ANCHOR, T, flockClearance(ANCHOR, onBlock));
    if (bent.airborne && onBlock(bent.cx, bent.cy)) centreOver++;
    // ⚠ NAMED, NOT JUST COUNTED. The flock that fails this is usually NOT the anchor the scene is
    // built around — the first failure was a second flock whose own anchor sits hard against the
    // block — and a bare tally sends you to read the wrong circuit.
    for (const q of bad) offenders.push(`(${(q.wx - ANCHOR.ax).toFixed(2)}, ${(q.wy - ANCHOR.ay).toFixed(2)}) at t=${st.t.toFixed(2)}`);
  }
  if (!flying) problems.push('no airborne quad drew in the built scene — the avoidance check cannot see anything');
  else if (!wouldCross) problems.push('the painted avoidance check is vacuous — the plain circle never puts this flock over the block, so nothing is being avoided');
  // ⚠ THE PROMISE IS THE CIRCUIT, AND A WINGTIP BIRD IS ALLOWED TO CLIP A CORNER. This asserted
  // "not one bird, ever" while a skein was a quarter of a tile wide, and a real formation is not:
  // the arms reach a tile either side of the centre, so a circuit that genuinely goes round a block
  // still puts its outermost bird over the edge of one for a moment, which is a thing geese do all
  // day. What must not happen is the FLOCK crossing — that is the "they fly through buildings" this
  // check was written for — and no bird may be deep over a roof rather than brushing its corner.
  else if (centreOver) problems.push(`the flock's own centre crossed the block ${centreOver} time(s) — the circuit is not reading flockClearance`);
  else if (deepest > BLOCK_GRAZE) problems.push(`a goose flew ${deepest.toFixed(2)} tiles inside the block, past the ${BLOCK_GRAZE} a wingtip bird is allowed to clip its corner by`);
  else notes.push(`${flying} airborne quads swept over a lap; the centre never crossed the block the plain circle crosses at ${wouldCross} of 40 moments, and the widest bird clipped its edge by ${deepest.toFixed(2)} tiles`);
  if (REPORT && offenders.length) console.log('  clipped the block: ' + offenders.slice(0, 8).join('; '));
}

// ── out ───────────────────────────────────────────────────────────────────────
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.geese = geeseWas;
globalThis.performance = clock;
Date.now = realDateNow;

if (REPORT) {
  console.log(`  anchor  ${ANCHOR.ax},${ANCHOR.ay}  (bias block ${FLOCK_AREA})   camera ${CENTRE.x},${CENTRE.y}`);
  console.log(`  ground t=${T_GROUND}  air t=${T_AIR}`);
  console.log('  faces: ' + ground.faces + ' walking, ' + air.faces + ' flying (budget ' + FACE_MAX + ')');
}

if (problems.length) {
  console.error('✗ fauna — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log('✓ fauna — ' + notes.join('; ') + '. Stateless across a recentre, deterministic, off at 0, day-only, and the height split holds.');
