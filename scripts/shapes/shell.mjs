// THE GATE FOR THE ROOM YOU ARE SITTING IN.
//
// `client/shared/interior-shell.js` is a pure function returning polygons, so almost everything that
// can go wrong with it is SILENT: a wall on the wrong side of the eye is a black screen, a missing
// floor is the renderer as it shipped, and a pane across the windscreen is a city you cannot see
// with no error anywhere. None of those throws, and no existing gate can see any of them —
// `shapes:smoke` runs building arms, `gl:mesh` compares captured geometry, `client:smoke` parses.
//
// ⚠ THE INSTRUMENT IS A RAY FROM THE EYE, which is the user's own question asked as arithmetic: if
// you look that way, is there something there? It is the only test that cannot be satisfied by a
// shell that is merely well-formed — a floor authored above the roof passes every count, every
// normal check and every bounds check, and fails the one ray that matters.
//
// ⚠ AND IT ASSERTS BOTH DIRECTIONS. Half of these say a ray MUST hit (there is a floor under you)
// and half say a ray MUST NOT (you can see out of the windscreen). A gate with only the first half
// passes a solid block of concrete; a gate with only the second passes an empty room, which is the
// renderer before any of this. Deleting either list has to fail.
import { shellFaces, shellProfileFor, shellBounds, SHELL_PROFILES, EYE_M } from '../../client/shared/interior-shell.js';
// The exterior's own curves. ⚠ IMPORTED SEPARATELY AND ON PURPOSE: the point of the last
// section is to hold the interior against something it did not come from, and reaching for it
// through the profile would be asking the answer to check itself.
import { boatGeom } from '../../client/shared/boat-house.js';
import { BOAT_ROWS } from '../../client/shared/vehicle-models.js';
import { readFileSync } from 'node:fs';
// ⚠ THE SOURCE IS BLANKED BEFORE IT IS SCANNED, and that is a fix rather than a nicety: the first
// cut of this asserted the call site with a plain `includes`, and commenting the call out left the
// string sitting in the comment and the gate green. Same scanner `imports:smoke` and `gl:opts` use,
// and for the same reason — this repo's comments are mostly prose ABOUT the code beside them, so a
// regex over raw source finds the thing it is looking for in the sentence explaining it.
import { blank } from '../lib/blank-scanner.mjs';

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL  ' + msg); } };

// ── RAY / CONVEX POLYGON ─────────────────────────────────────────────────────
//
// ⚠ GENERAL, NOT AXIS-ALIGNED, and that is not over-engineering: the backrest leans and a profile
// is free to rake a screen or a bulkhead later. A test that only understands boxes would quietly
// stop seeing the parts somebody adds next, which is a gate that gets weaker as the thing it
// guards gets richer.
function rayHitsPoly(o, d, p) {
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const den = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(den) < 1e-12) return 0;                       // parallel: a grazing hit is not a hit
  const w = [p[0][0] - o[0], p[0][1] - o[1], p[0][2] - o[2]];
  const t = (n[0] * w[0] + n[1] * w[1] + n[2] * w[2]) / den;
  if (t <= 1e-6) return 0;                                   // behind the eye, or at it
  const q = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  // Inside the convex polygon: the cross of each edge with the corner-to-point vector must keep
  // one sign against the face normal, all the way round.
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ed = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const vp = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const c = [ed[1] * vp[2] - ed[2] * vp[1], ed[2] * vp[0] - ed[0] * vp[2], ed[0] * vp[1] - ed[1] * vp[0]];
    const s = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
    if (Math.abs(s) < 1e-9) continue;                        // exactly on an edge
    const g = s > 0 ? 1 : -1;
    if (sign === 0) sign = g; else if (g !== sign) return 0;
  }
  return t;
}

// The nearest thing a ray from the eye runs into, or 0 for open air.
const castFrom = (faces, o, d) => {
  let best = 0;
  for (const f of faces) { const t = rayHitsPoly(o, d, f.p); if (t && (!best || t < best)) best = t; }
  return best;
};
const cast = (faces, d) => castFrom(faces, [0, 0, 0], d);

// ── THE PROFILES ─────────────────────────────────────────────────────────────
for (const [key, P] of Object.entries(SHELL_PROFILES)) {
  console.log('\n' + key + ' — ' + P.label);
  const faces = shellFaces(P);
  const B = shellBounds(P);
  ok(faces.length > 0, key + ': builds no geometry at all');

  // 1. THE EYE IS IN A ROOM. Strictly inside, with a real margin rather than a tolerance: a shell
  //    whose wall grazes the origin is one edit away from closing over it.
  const inside = B[0] < -0.05 && B[1] < -0.05 && B[2] < -0.05 && B[3] > 0.05 && B[4] > 0.05 && B[5] > 0.05;
  ok(inside, key + ': the eye is not strictly inside the shell — bounds ' + B.map((n) => n.toFixed(2)).join(' '));

  // 2. YOU CAN SEE OUT OF THE WINDSCREEN. The one ray that decides whether this is a vehicle or a
  //    blindfold, and the reason interior-shell.js has no front face.
  ok(!cast(faces, [0, 1, 0]), key + ': something is across the windscreen — you cannot see out');

  // 3. AND OUT OF THE SIDE WINDOWS, which are holes rather than panes. Aimed at the middle of the
  //    authored aperture on each side, so a window that moves takes its own test with it.
  const wy = (P.winY[0] + P.winY[1]) / 2, wz = (P.winZ[0] + P.winZ[1]) / 2;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  ok(!castFrom(faces, [0, 0, 0], [xL, wy, wz]), key + ': the left side window is not a hole');
  ok(!castFrom(faces, [0, 0, 0], [xR, wy, wz]), key + ': the right side window is not a hole');

  // 4. AND THE FOUR SURFACES THAT DID NOT EXIST BEFORE ANY OF THIS. Straight down, straight up,
  //    straight back, and out through each door card below the glass — which is the whole of what
  //    was reported missing.
  // ⚠ NEITHER OF THESE IS CAST FROM THE EYE, AND BOTH WERE BEFORE. Straight down from the eye hits
  //    the cushion you are sitting on and straight back hits your own backrest, so deleting the
  //    floor and deleting the bulkhead both left this gate green. A test aimed at the one thing in
  //    front of the thing it is testing is a test of the wrong surface.
  const footwell = [2 * P.xCentre, (P.seatY[1] + P.dashY) / 2, 0];       // over the passenger's feet: clear of both seat and dash
  const overHead  = [0, 0, (P.backZ + P.roof) / 2];                      // above the backrest, below the lining
  ok(castFrom(faces, footwell, [0, 0, -1]), key + ': NO FLOOR — a ray down the passenger footwell leaves the vehicle');
  ok(cast(faces, [0, 0, 1]), key + ': NO ROOF — a ray straight up leaves the vehicle');
  ok(castFrom(faces, overHead, [0, -1, 0]), key + ': NO REAR BULKHEAD — a ray back over the seat leaves the vehicle');
  const low = P.winZ[0] - 0.2;   // under the sill: the door card, not the glass
  ok(castFrom(faces, [0, 0, 0], [xL, 0, low]), key + ': NO LEFT DOOR CARD below the window line');
  ok(castFrom(faces, [0, 0, 0], [xR, 0, low]), key + ': NO RIGHT DOOR CARD below the window line');

  // 5. THERE IS A SEAT UNDER YOU, and it is nearer than the floor. ⚠ THE COMPARISON IS THE CHECK,
  //    not the hit: a floor alone answers a downward ray perfectly well, so the only way to say
  //    "you are sitting on something" is that the first thing under you is not the floor.
  const down = cast(faces, [0, 0, -1]);
  ok(down > 0 && down < Math.abs(P.floor) - 1e-6,
     key + ': the first thing under the eye is the floor — there is nothing to sit on');

  // 6. EVERY FACE STATES WHICH WAY IT FACES. gl/solids.js disables culling, so a normal recovered
  //    from the winding flips in the mirrored pass — see the ⚠ over `quad`.
  let badN = 0, badP = 0;
  for (const f of faces) {
    if (!f.n || f.n.length !== 3 || !Number.isFinite(f.n[0] + f.n[1] + f.n[2])) badN++;
    const L = Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (Math.abs(L - 1) > 1e-6) badN++;
    if (!f.p || f.p.length < 3) badP++;
    for (const q of f.p || []) if (!Number.isFinite(q[0] + q[1] + q[2])) badP++;
  }
  ok(badN === 0, key + ': ' + badN + ' faces with a missing or non-unit normal');
  ok(badP === 0, key + ': ' + badP + ' degenerate or non-finite polygons');

  // 7. NOTHING IS OUTSIDE THE ROOM IT IS IN. A part authored past the wall is a chair sticking out
  //    through the door — invisible from the seat, and the first thing anybody sees from outside.
  let out = 0;
  for (const f of faces) for (const q of f.p) {
    if (q[0] < B[0] - 1e-6 || q[0] > B[3] + 1e-6 || q[1] < B[1] - 1e-6 || q[1] > B[4] + 1e-6
      || q[2] < B[2] - 1e-6 || q[2] > B[5] + 1e-6) out++;
  }
  ok(out === 0, key + ': ' + out + ' vertices outside the shell bounds');

  console.log('    ' + faces.length + ' faces · ' + (down).toFixed(2) + 'm to the seat · '
    + (B[4] - B[1]).toFixed(2) + 'm long, ' + (B[3] - B[0]).toFixed(2) + ' wide, ' + (B[5] - B[2]).toFixed(2) + ' tall');
}

// ── WHO GETS ONE ─────────────────────────────────────────────────────────────
//
// ⚠ THE OMISSIONS ARE THE CHECK. A default would give every class a tractor cab and this file would
// still be green, so the named refusals are asserted by name — an open ultralight, a helicopter's
// glass bubble and a wreck are each a shape this profile cannot express, and a wrong room is worse
// than the renderer as it shipped.
console.log('\nclass map');
ok(!!shellProfileFor('truck'), 'a truck gets no interior');
ok(!!shellProfileFor('prop'), 'a light twin gets no interior');
for (const cls of ['ultralight', 'heli', 'wreck']) {
  ok(!shellProfileFor(cls), cls + ' was given an enclosed cabin it does not have');
}
ok(!shellProfileFor(null) && !shellProfileFor(undefined) && !shellProfileFor('nonesuch'),
   'an unknown class was given an interior');
ok(EYE_M > 1 && EYE_M < 4, 'EYE_M is not a plausible human eye height: ' + EYE_M);

// ── THE WIRING ───────────────────────────────────────────────────────────────
//
// ⚠ EVERY CLAIM BELOW IS ONE A PERFECT SHELL STILL FAILS. The geometry above can be flawless while
// the renderer anchors it to the camera's heading (a cab that turns with your head, which you can
// never look away from), collects it with the sinks still null (nothing drawn, nothing said), or
// leaves the painted dash over a side window. None of those is visible to a pure-module test, and
// all three are silent in the frame.
console.log('\nwiring');
const ws = blank(readFileSync('client/game/js/panels/windshield.js', 'utf8'));
const cv = blank(readFileSync('client/game/js/panels/cab-view.js', 'utf8'));

ok(/ownHdg != null \? v\.ownHdg : v\.heading[\s\S]{0,400}?pushInteriorShell|pushInteriorShell[\s\S]{0,1200}?ownHdg/.test(ws),
   'the shell is built on the CAMERA heading — it will turn with your head and never leave your view');
ok(ws.includes('RENDER_TUNE.interior'), 'the shell is not behind a tune flag, so there is no A/B and no way off');
ok(ws.includes('pushInteriorShell(cam, v);'), 'nothing calls pushInteriorShell — the shell is never collected');
// The call has to sit AFTER the sinks are armed. Collected before, OWNSHIP_SINK is the null left by
// last frame's finally and every face is silently discarded — the flush-timing trap the Curtain and
// the scatter each hit once.
ok(ws.indexOf('OWNSHIP_SINK = glOn ? [] : null;') < ws.indexOf('pushInteriorShell(cam, v);'),
   'pushInteriorShell runs before OWNSHIP_SINK is armed — every face goes in the bin');
ok(/const lookOff = /.test(ws) && /cabForward[\s\S]{0,120}!lookOff/.test(ws),
   'the painted forward dash is not dropped when the head turns — it will sit over the side window');
ok(/if \(!ext && !fcam && v\.lookPitch\)/.test(ws), 'nothing moves the horizon, so the head cannot tip');
ok(/lookPitch[\s\S]{0,300}fovMul/.test(ws),
   "the horizon shift leaves out the seat's own lens — the sky/ground split will not agree with the world");
ok(ws.includes('RENDER_TUNE.lookPitchLim'), 'the look pitch is unclamped — past 90 degrees the shift is infinite');
ok(cv.includes('CAB_LOOK_YAW') && cv.includes('CAB_LOOK_PITCH'), 'the cab has no free-look range');
// ⚠ AND IT DOES NOT TAKE A LETTER. Every letter a–z is bound in the cab — the note over N says so
// in as many words — and the first cut of this shipped free look on L, which is the HEADLIGHTS.
// The handler parsed, the mode worked, and a driver who turned their head at night lost the road.
// Nothing in the repo noticed; this line is what noticing looks like.
ok(/k === 'l' && down\) setHeads/.test(cv), 'L is no longer the headlights — a mode has taken a bound key');
ok(/!st\.looking && !st\.freeLook/.test(cv), 'free look still springs back to the windscreen');
ok(/e\.shiftKey[\s\S]{0,80}?st\.freeLook = true/.test(cv), 'nothing latches free look');
// ⚠ AND THERE IS A WAY OUT. A mode with no exit is the trap O's own note is written about, and
// here it is worse than a trap: the head HOLDS where you left it, so a driver who cannot unlatch
// is driving a truck they are not looking through.
ok(/st\.freeLook && !e\.shiftKey/.test(cv), 'free look cannot be unlatched');


// ── AND IT HAS TO ACTUALLY ARRIVE ─────────────────────────────────
//
// Everything above this line is a pure module and a source scan, and both can be perfect while the
// frame collects nothing. That is the Curtain's own trap — it filled its sink from inside a queued
// closure, so it reached the GPU never, drew nothing and said nothing — and `ownship.mjs` was
// written about the same failure one object over.
//
// ⚠ AND THERE IS A SECOND REASON IT IS HERE NOW. Adding the shell put 72 faces into a buffer two
// other gates census, so both had to learn to filter them out by tag. A filter is the one change
// that can turn a real failure green: with nothing collected at all, `ownship` and `yacht` pass
// perfectly and this feature is simply gone. So the filter and this check ship together — they
// answer the two halves of the same question, and neither is sound alone.
console.log('\nthe frame');
const { loadWindshield, stubCanvas } = await import('./dom-stub.mjs');
const sim = await loadWindshield();
// The built hull, for the sole check in the last section — the one claim that has to ask the mesh
// rather than the geometry module, because both sides of every other one read that module.
const A3 = await import('../../client/game/js/panels/aircraft3d.js');
const W = 640, H = 360;
stubCanvas('__shell', W, H);
const N = 41;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  { kind: 'land', biome: 'parkland', flr: 0, surf: (x === 20 || y === 20) ? 'road' : null })));
const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0.3, map, heading: 30, ownHdg: 30,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
  livery: { base: '#8a2b2b', trim: '#d8d8d8' }, gearAnim: 1,
};
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

function frame(view, tune) {
  let seen = null;
  sim.RENDER_TUNE.gl = 1;
  sim.RENDER_TUNE.interior = tune;
  sim.installGLWorld((cells, cam, opts) => { seen = opts.ship ? opts.ship.slice() : []; return null; });
  sim.paintWindshield('__shell', view);
  sim.installGLWorld(null);
  return (seen || []).filter((f) => f.interior);
}

// ── THE TWO STATES, AND THE SPLIT BETWEEN THEM ────────────────────────
//
// Looking forward, the painted cab owns the aperture and the shell must NOT draw a second header,
// a second pair of pillars or a second dash a few pixels off the painted ones — which is worse
// than either alone and is not something a screenshot makes obvious. Turned, there is no painted
// anything, and a windscreen with no header round it is a hole rather than a cab.
//
// ⚠ BOTH COUNTS ARE ASSERTED, AND NEITHER ALONE IS WORTH ANYTHING. Checking only the forward
// number passes a shell that has lost its aperture permanently; checking only the turned one
// passes a shell that draws two of everything at the windscreen. It is the DIFFERENCE that is the
// feature, so the difference is what is named.
const ALL = shellFaces(SHELL_PROFILES.truck);
const APERTURE = ALL.filter((f) => f.fwd).length;
const inSeat = frame({ ...BASE, external: false }, 1);
ok(inSeat.length > 0, 'the seat collected NO interior at all — the shell reaches the GPU never');
ok(inSeat.length === ALL.length - APERTURE,
   'looking forward the seat collected ' + inSeat.length + ', expected ' + (ALL.length - APERTURE)
   + ' — the shell and the painted cab are both drawing the windscreen surround');
ok(!inSeat.some((f) => f.fwd), 'a forward-aperture face was collected while the painted cab is up');

// And with the head turned, where the painted cab is gone and the shell is the whole interior.
const turned = frame({ ...BASE, external: false, lookYaw: 90 }, 1);
ok(turned.length === ALL.length,
   'with the head turned the seat collected ' + turned.length + ' of ' + ALL.length
   + ' — the aperture did not come back, so you are looking out of a hole with no cab round it');
ok(APERTURE > 0 && APERTURE < ALL.length,
   'the aperture is ' + APERTURE + ' of ' + ALL.length + ' faces — the split is all-or-nothing');

// ⚠ EVERY VERTEX FINITE. A NaN in this buffer rasterises nothing and throws nothing, which is the
// failure the authored vehicles are already watched for — and a scale term off an eye height is
// exactly where one gets in.
let nan = 0;
for (const f of inSeat) for (const q of f.p) if (!Number.isFinite(q[0] + q[1] + q[2])) nan++;
ok(nan === 0, nan + ' interior vertices are non-finite — that buffer draws nothing and says nothing');

// ⚠ AND IT IS AT THE CAMERA, WHICH IS THE ONE THING THE PURE MODULE CANNOT CHECK. The shell is
// authored about the eye and placed in map-window tiles; get the offset wrong and it is a perfect
// cab sitting in a field a few tiles away, which looks exactly like no cab at all.
let far = 0;
for (const f of inSeat) for (const q of f.p) {
  if (Math.hypot(q[0] - (BASE.mapOffset.x), q[1] - (BASE.mapOffset.y)) > 0.25) far++;
}
ok(far === 0, far + ' interior vertices are more than a quarter tile from the camera — the cab is not where you are');

// The external view has no interior: you are looking AT the truck, not out of it.
ok(frame({ ...BASE, external: true, extPitch: 0.3, extZoom: 1 }, 1).length === 0,
   'the chase camera collected an interior — the cab is drawn around a camera that is outside it');
// And the switch is a switch.
ok(frame({ ...BASE, external: false }, 0).length === 0,
   'RENDER_TUNE.interior 0 still collected an interior — there is no way back to the frame that shipped');
globalThis.performance = clock;
console.log('    ' + inSeat.length + ' faces at the windscreen + ' + APERTURE + ' more once the head turns = '
  + turned.length + ' reaching the depth buffer; 0 from the chase, 0 with the flag off');


// ── THE INSIDE IS THE INSIDE OF THE OUTSIDE ──────────────────────────────────
//
// ⚠ EVERY CLAIM ABOVE PASSES ON A CABIN THAT IS THE WRONG SIZE FOR ITS OWN BOAT. The eye is in a
// room, the room has a floor, you can see out of the holes — all true of a cabin three times too
// tall, which is what shipped, and none of it says a word about the hull the room is inside. This
// section is the one that does, and it exists because the two were authored independently and
// drifted the whole way apart with nothing able to notice.
//
// The comparison runs in MODEL UNITS: every interior vertex is taken back through the scale bridge
// and held against the exterior's own curves. That direction matters — converting the house into
// metres instead would re-derive the exterior through the interior's arithmetic, and a claim that
// restates one of its sides in terms of the other cannot fail.
console.log('\nthe room is the inside of the house');
{
  const row = BOAT_ROWS.hydro;
  const G = boatGeom(row);
  const P = SHELL_PROFILES.boat;
  const faces = shellFaces(P);
  const m = G.helm.mPerUnit, E = G.helm;
  // Metres about the eye -> model units. The inverse of what `boatProfile` does, stated once.
  const toF = (y) => y / m + E.f;
  const toG = (x) => x / m + E.g;
  const toZ = (z) => z / m + E.z;

  // 1. THE SCALE BRIDGE. `mPerUnit = eyeM / eyeZ` is the whole of why the two are the same size,
  //    and it is one line in boat-house.js — so it is worth one line here. Exact, not near: it is
  //    a definition rather than a measurement.
  ok(Math.abs(G.helm.mPerUnit * E.z - G.helm.eyeM) < 1e-12,
     'the scale bridge does not hold: mPerUnit * eyeZ is ' + (G.helm.mPerUnit * E.z).toFixed(6)
     + ' and eyeM is ' + G.helm.eyeM);

  // 2. THE DRIVER IS IN THE HOUSE. Not in the room — in the HOUSE, which is the exterior's own
  //    envelope. An eye outside it is a camera floating beside a boat with a cabin drawn round it.
  const roofAtHelm = G.roof.rz(E.f);
  ok(E.f > G.hF0 && E.f < G.hF1, 'the helm is not between the bulkhead and the screen');
  ok(E.z > G.soleZ && E.z < roofAtHelm, 'the helm eye is not between the sole and the headlining');
  ok(Math.abs(E.g) < G.hw(E.f, (E.z - G.hz(E.f, 0)) / G.hH),
     'the helm eye is outside the house wall at its own height');

  // 3. THE SURFACES ARE THE SAME SURFACES. Each of these was a separate authored number on each
  //    side, and each pair is now one expression read twice.
  const near = (a, b, tol, what) => ok(Math.abs(a - b) < tol,
    what + ': interior ' + a.toFixed(4) + ' vs exterior ' + b.toFixed(4) + ' (model units)');
  near(toF(P.back), G.roof.rf0, 1e-9, 'the aft face of the room is not the aft edge of the hardtop');
  near(toF(P.front), G.hF1, 1e-9, 'the forward face of the room is not the foot of the screen');
  // ⚠ THE SOLE IS CHECKED AGAINST THE BUILT MESH AND NOT AGAINST `G.soleZ`, and that is the
  // difference between a claim and a tautology. Both sides read `G.soleZ` now, so comparing them
  // to each other passes however wrong the number is — mutation-tested: moving the sole half a
  // deck left this green when it was written the obvious way. What can still go wrong is somebody
  // putting the literal back in `buildBoat`, so the thing to ask is the FACE the exterior emits:
  // the flat floor in the well, which the door in the bulkhead opens onto.
  {
    const ext = A3.aircraftFaces('hydro', 1, false, '');
    const cpF0 = row.cockpitF0 ?? -0.88;
    let wellSole = null;
    for (const f of ext) {
      if (f.p.length < 4) continue;
      const z = f.p[0][2];
      if (!f.p.every((q) => Math.abs(q[2] - z) < 1e-9)) continue;          // horizontal
      if (!f.p.every((q) => q[0] <= G.hF0 + 1e-9 && q[0] >= cpF0 - 1e-9)) continue;  // in the well
      if (!wellSole || z < wellSole) wellSole = z;
    }
    ok(wellSole != null, 'the exterior draws no floor in the well to compare the cabin sole with');
    if (wellSole != null) near(toZ(P.floor), wellSole, 1e-9, 'the cabin sole is not the well sole');
  }
  near(toZ(P.roof), G.roof.rz(G.rF) + G.roof.crownH, 1e-9, 'the top of the room is not the hardtop');
  near(toZ(P.dashZ), G.hz(G.fw, G.sillAt(G.fw)), 1e-9, 'the dash top is not the window sill line');

  // 4. THE DOOR IS ONE DOOR. ⚠ THE OPENING, NOT THE PANEL — the interior's is set inboard by the
  //    lining, so the two are the same door only up to that inset, and asserting they are equal
  //    would be asserting the lining does not exist.
  const dwIn = toG(P.xCentre + P.door.halfW) - toG(P.xCentre);
  ok(dwIn <= G.door.halfW + 1e-9 && dwIn > G.door.halfW * 0.9,
     'the door you walk through is not the door on the back of the house: ' + dwIn.toFixed(4)
     + ' against ' + G.door.halfW.toFixed(4));
  near(toZ(P.door.top), G.hz(G.hF0, G.door.topT), 1e-9, 'the door head is not the exterior door head');

  // 5. AND THE WHOLE ROOM FITS IN THE BOAT. The strongest one, and the one that would have caught
  //    the original on its own: every vertex of every interior face, back in model units, held
  //    against the house's own envelope at its own height. ⚠ THE WALL IS ALLOWED TO BE INBOARD AND
  //    NEVER OUTBOARD — a lining inside the glass is correct and a lining outside it is a cabin
  //    poking through the topside — so the test is one-sided.
  let outside = 0, worst = 0, worstWhy = '';
  for (const f of faces) for (const q of f.p) {
    const ff = toF(q[1]), gg = toG(q[0]), zz = toZ(q[2]);
    const t = Math.max(0, Math.min(1, (zz - G.hz(ff, 0)) / G.hH));
    const lim = G.hw(Math.max(G.hF0, Math.min(G.hF1, ff)), t);
    const over = Math.max(
      Math.abs(gg) - lim,                                    // through the side
      zz - (G.roof.rz(Math.min(ff, G.rF)) + G.roof.crownH),  // through the top
      G.soleZ - zz,                                          // through the bottom
      G.roof.rf0 - ff,                                       // out the back
      ff - G.hF1);                                           // out the front
    if (over > 1e-6) { outside++; if (over > worst) { worst = over; worstWhy = f.tone; } }
  }
  ok(outside === 0, outside + ' interior vertices are outside the house they are inside — worst '
     + (worst * m).toFixed(3) + ' m on a ' + worstWhy + ' face');

  // 6. THE SIDE WINDOW IS THE SIDE WINDOW. Aimed along the exterior's own aperture: at each of
  //    these stations a ray from the eye through the middle of the hole has to leave the cabin,
  //    and one aimed a hand's breadth BELOW the sill has to hit the wall under it. ⚠ BOTH HALVES,
  //    because a room with no side wall at all passes the first on its own.
  // ⚠ AND IT IS CAST AT THE SHELL, NOT AT THE FURNITURE. The driver sits to starboard, so a ray
  // aimed aft and outboard through the back of the starboard window goes through their own
  // HEADREST — which is not the aperture failing, it is a seat being where a seat goes, and the
  // first cut of this reported 7 of 8 and meant nothing by it. Same trap as the footwell note
  // above, one surface along: a test aimed through the thing in front of the thing it is testing
  // is a test of the wrong object.
  const walls = faces.filter((f) => f.tone !== 'seat');
  let holes = 0, cards = 0;
  const STN = [0.30, 0.45, 0.60, 0.75];
  for (const u of STN) {
    const ff = G.gAft + (G.sideF1 - G.gAft) * u;
    const mid = (G.sillAt(ff) + Math.min(1, G.headAt(ff))) / 2;
    for (const s of [-1, 1]) {
      const aim = [(s * G.hw(ff, mid) - E.g) * m, (ff - E.f) * m, (G.hz(ff, mid) - E.z) * m];
      if (!castFrom(walls, [0, 0, 0], aim)) holes++;
      const low = [(s * G.hw(ff, 0) - E.g) * m, (ff - E.f) * m, (G.hz(ff, G.sillAt(ff) * 0.4) - E.z) * m];
      if (castFrom(walls, [0, 0, 0], low)) cards++;
    }
  }

  // ── 7. AND EVERY DIRECTION AT ONCE ─────────────────────────────────────────
  //
  // The sampled rays above ask about eight places somebody chose. This asks about all of them: a
  // fan over the whole sphere, and for every direction that LEAVES the room, march on through the
  // exterior house and name what it came out of. It has to be the side aperture, the wrapped
  // screen or the windscreen — and nothing may come out through the roof, the sole, the bulkhead,
  // the topside under the sill or the shoulder over the glass.
  //
  // ⚠ IT IS THE ONLY CHECK HERE THAT WOULD FIND A HOLE NOBODY THOUGHT OF, which is the whole
  // category the original was in: the room and the house were not near each other, and every
  // sampled ray anybody would have written was aimed at somewhere they agreed.
  //
  // ⚠ AND THE MARCH CROSSES THE LINING, NOT THE WALL. The room's surfaces stand INBOARD of the
  // exterior's glass by design, so a ray grazing the edge of the aperture crosses the outer wall
  // a little further along, where the head line has moved — the first cut of this measured against
  // the wall and reported three holes that were all the inset being counted twice.
  const LIN = G.INSET - 0.014;
  const openings = new Map();
  let rays = 0;
  for (let pi = -70; pi <= 70; pi += 5) {
    for (let ya = -180; ya < 180; ya += 5) {
      const a = ya * Math.PI / 180, e = pi * Math.PI / 180;
      const d = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
      if (castFrom(walls, [0, 0, 0], d)) continue;
      rays++;
      const u = [d[0] / m, d[1] / m, d[2] / m];
      const L = Math.hypot(...u) || 1;
      let via = 'never left the house';
      // ⚠ THE SEAM TOLERANCE IS THE MARCH STEP, and that is a statement about the instrument rather
      // than a fudge: a marcher can only say where a ray crossed to within one step, so at the join
      // between the screen's head and the hardtop it will land on either side of `rF` by up to
      // `STEP`. Written as a bare 1e-3 it reported one ray in two thousand as a hole through the
      // roof, 1 mm short of the screen it actually went out of.
      const STEP = 0.001;
      for (let s = STEP; s < 3; s += STEP) {
        const gg = E.g + (u[0] / L) * s, ff = E.f + (u[1] / L) * s, zz = E.z + (u[2] / L) * s;
        const t = Math.max(0, Math.min(1, (zz - G.hz(ff, 0)) / G.hH));
        if (ff > G.hF1) { via = 'the windscreen'; break; }
        if (ff < G.hF0) { via = 'THE AFT BULKHEAD'; break; }
        // ⚠ FORWARD OF `rF` THE TOP OF THE HOUSE IS GLASS, NOT ROOF. The screen is raked, so the
        // wedge between its head and the hardtop's leading edge is windscreen — called roof, it
        // reported forty-two perfectly good rays out of the top of the screen as holes.
        if (zz > G.roof.rz(Math.min(ff, G.rF)) + 1e-6) { via = ff > G.rF - STEP * 1.5 ? 'the windscreen' : 'THE ROOF'; break; }
        if (zz < G.soleZ - 1e-6) { via = 'THE SOLE'; break; }
        if (Math.abs(gg) > G.hw(ff, t) * LIN) {
          if (ff > G.sideF1) { via = 'the wrapped screen'; break; }
          const sill = G.sillAt(ff), head = Math.min(1, G.headAt(ff));
          via = (t >= sill - 2e-3 && t <= head + 2e-3) ? 'the side aperture'
            : t < sill ? 'THE TOPSIDE UNDER THE SILL' : 'THE SHOULDER OVER THE GLASS';
          break;
        }
      }
      openings.set(via, (openings.get(via) || 0) + 1);
    }
  }
  const leaks = [...openings].filter(([k]) => k === k.toUpperCase());
  ok(leaks.length === 0, 'rays leave the cabin through solid house: '
     + leaks.map(([k, n]) => n + ' via ' + k).join(', '));
  ok(rays > 200, 'only ' + rays + ' rays leave the cabin at all — the sweep is not exercising it');

  // ── 8. AND THE SEAM THE SWEEP CANNOT SEE ───────────────────────────────────
  //
  // ⚠ THE SWEEP FORGIVES A HAIRLINE BETWEEN THE WALL AND THE HEADLINING, and that is not a bug in
  // it — a ray through that slot is inside the roof SLAB, which the exterior draws, so it never
  // leaves the house and the sweep is right to pass it. It is still a gap in the room: this layer
  // is depth-buffered, so from the seat it is a bright line along the top of both walls. Two
  // mutations proved the point by surviving everything above, which is why these two are here.
  const modelZ = (z) => z / m + E.z, modelF = (y) => y / m + E.f;
  let high = 0, reach = Infinity;
  for (const f of faces) {
    if (f.tone !== 'pil') continue;
    for (const q of f.p) {
      const ff = modelF(q[1]), zz = modelZ(q[2]);
      const lining = G.roof.rz(Math.min(Math.max(ff, G.hF0), G.rF)) - G.roof.THK;
      if (zz > lining + 1e-9) high++;
      reach = Math.min(reach, lining - zz);
    }
  }
  ok(high === 0, high + ' wall vertices stand above the headlining — the wall runs past the panel '
     + 'hung under it and leaves a slot the length of the cabin');
  ok(Math.abs(reach) < 1e-9, 'the wall never reaches the headlining — nearest approach '
     + (reach * m).toFixed(4) + ' m');
  // And the lip that closes the same seam at the FRONT, where the lining's leading edge meets the
  // top of the screen. Asked at the outboard corner, because the crown carries the centreline up
  // past the roofline on its own and a check there passes with no lip at all.
  let lipAt = -Infinity;
  for (const f of faces) {
    if (f.tone !== 'hdr') continue;
    for (const q of f.p) {
      if (Math.abs(modelF(q[1]) - G.rF) > 1e-6) continue;
      if (Math.abs(q[0] - P.xCentre) < (P.halfW * 0.8)) continue;      // outboard corners only
      lipAt = Math.max(lipAt, modelZ(q[2]));
    }
  }
  ok(lipAt >= G.roof.rz(G.rF) - 1e-9, 'nothing closes the slot between the headlining and the top '
     + 'of the screen at the outboard corner: ' + (lipAt === -Infinity ? 'no geometry there' : lipAt.toFixed(5))
     + ' against ' + G.roof.rz(G.rF).toFixed(5));
  ok(holes === STN.length * 2, holes + ' of ' + (STN.length * 2)
     + ' rays through the exterior aperture got out — the hole inside is not the hole outside');
  ok(cards === STN.length * 2, cards + ' of ' + (STN.length * 2)
     + ' rays under the sill hit a wall — there is daylight where the house has topside');

  // ⚠ AND ABOVE THE HEAD LINE TOO, which is the half that is easy to leave out — mutation-tested:
  // deleting the whole band of wall over the glass left every check above green, because a bigger
  // hole passes a test that only asks whether you can see out of it. Aft stations only: the
  // aperture runs out at the roof forward, so up there the wall correctly does not exist.
  let shoulders = 0;
  const HIGH = [0.20, 0.35, 0.50];
  for (const u of HIGH) {
    const ff = G.gAft + (G.sideF1 - G.gAft) * u;
    const hi = Math.min(1, G.headAt(ff));
    const t = hi + (1 - hi) * 0.5;
    for (const s of [-1, 1]) {
      const aim = [(s * G.hw(ff, t) - E.g) * m, (ff - E.f) * m, (G.hz(ff, t) - E.z) * m];
      if (castFrom(walls, [0, 0, 0], aim)) shoulders++;
    }
  }
  ok(shoulders === HIGH.length * 2, shoulders + ' of ' + (HIGH.length * 2)
     + ' rays over the head line hit a wall — there is daylight where the house has shoulder');

  console.log('    a ' + (2 * G.LEN * m).toFixed(1) + ' m hull: ' + ((G.hF1 - G.hF0) * m).toFixed(2)
    + ' m of pilothouse, ' + ((G.roof.rz(E.f) - G.soleZ) * m).toFixed(2) + ' m sole to headlining, eye '
    + ((E.z - G.soleZ) * m).toFixed(2) + ' m up with ' + ((roofAtHelm - E.z) * m).toFixed(2) + ' m over it');
}

console.log('\n' + (checks - fails) + '/' + checks + ' passed');
if (fails) { console.log('\nINTERIOR SHELL GATE FAILED'); process.exit(1); }
