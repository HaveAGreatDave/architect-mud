// Does the free camera leave every existing view EXACTLY where it was?
//
// `makeCam` grew a world-space offset (fx/fy) and an absolute eye height (ez) so a detached camera
// can sit somewhere the craft's own heading has no word for. Nine callers project through that
// function and not one of them has a pixel test, so the only thing making the change safe is that
// the new terms are arithmetic identities when unused — `x - 0`, not `x - epsilon`.
//
// That is a property worth asserting rather than believing. The general way to write the same
// feature is to resolve the camera to a world point and derive `back` back out of it, which drags
// in `sin²+cos²` — a value that is not exactly 1 in floating point — and moves every frame in the
// game by a hair that nobody would ever trace back to here.
//
// So: same inputs, with and without the new fields present, compared with Object.is.
import { makeCam, viewFocal } from '../../client/game/js/panels/windshield.js';

const HEADINGS = [0, 17, 45, 90, 128.5, 180, 233.75, 270, 359.9];
const BACKS = [0, 0.4, 1.6, 3.2];
const UPS = [-0.3, 0, 0.22, 1.1];
const PTS = [[0, 0, 0], [1, 0, 0.2], [-2.5, 3.75, -0.4], [0.03, -0.07, 1.9], [12, 12, 0]];
const FLS = [[0.5, 0, 0], [4, -1.25, 0.3], [0.06, 2, -0.1]];

let checks = 0, bad = 0;
const same = (a, b, what) => {
  checks++;
  if (!Object.is(a, b)) { bad++; if (bad <= 8) console.log(`  ✗ ${what}: ${a} !== ${b}`); }
};
// Same, but tolerating +0 vs -0 — see the ⚠ at its callsite.
const sameNum = (a, b, what) => {
  checks++;
  if (a !== b) { bad++; if (bad <= 8) console.log(`  ✗ ${what}: ${a} !== ${b}`); }
};

for (const heading of HEADINGS) {
  const v = { heading, height: 0.3, map: null };
  for (const back of BACKS) for (const up of UPS) {
    const base = makeCam(900, 240, 520, v, { back, up });
    // The same chase, written the way a free camera writes it — the fields present and zero.
    const withZero = makeCam(900, 240, 520, v, { back, up, fx: 0, fy: 0, ez: null });
    for (const [dx, dy, wz] of PTS) {
      const a = base.proj(dx, dy, wz), b = withZero.proj(dx, dy, wz);
      same(a.sx, b.sx, `proj.sx h=${heading} back=${back} up=${up}`);
      same(a.sy, b.sy, `proj.sy h=${heading} back=${back} up=${up}`);
      same(a.f, b.f, `proj.f h=${heading} back=${back} up=${up}`);
    }
    for (const [aa, s, wz] of FLS) {
      const a = base.projFL(aa, s, wz), b = withZero.projFL(aa, s, wz);
      same(a.sx, b.sx, `projFL.sx h=${heading} back=${back}`);
      same(a.sy, b.sy, `projFL.sy h=${heading} back=${back}`);
      same(a.f, b.f, `projFL.f h=${heading} back=${back}`);
    }
    same(base.EH, withZero.EH, `EH h=${heading} up=${up}`);
    // The eye position the depth sorts and backface culls now read instead of rebuilding it.
    same(base.ex, withZero.ex, `ex h=${heading} back=${back}`);
    same(base.ey, withZero.ey, `ey h=${heading} back=${back}`);
    // …and it must equal what those fourteen sites used to compute for themselves.
    // ⚠ Compared with === rather than Object.is, and that is the whole subtlety: adding the free
    // offset NORMALISES A SIGNED ZERO. At heading 0 sinh is 0, so the old expression produced -0
    // and `-0 + 0` is +0. Object.is separates those two and nothing else in JavaScript does —
    // `x - -0` and `x - +0` are both x. Asserting identity here would fail on a difference that
    // cannot reach a pixel, and the projections above (which DO use Object.is) already prove the
    // part that can.
    sameNum(base.ex, -back * Math.sin(heading * Math.PI / 180), `ex matches -back*sinh h=${heading}`);
    sameNum(base.ey, back * Math.cos(heading * Math.PI / 180), `ey matches back*cosh h=${heading}`);
  }
}

// …and it has to actually DO something, or an identity test passes on a feature that was never
// wired. A free offset down the heading is the one case the old vocabulary could also express, so
// the two must agree — near-equality here, deliberately, because they are different arithmetic.
let drift = 0, moved = 0;
for (const heading of HEADINGS) {
  const v = { heading, height: 0.3, map: null };
  const sinh = Math.sin(heading * Math.PI / 180), cosh = Math.cos(heading * Math.PI / 180);
  const B = 1.6;
  const viaBack = makeCam(900, 240, 520, v, { back: B, up: 0 });
  const viaFree = makeCam(900, 240, 520, v, { back: 0, up: 0, fx: -B * sinh, fy: B * cosh });
  for (const [dx, dy, wz] of PTS) {
    const a = viaBack.proj(dx, dy, wz), b = viaFree.proj(dx, dy, wz);
    drift = Math.max(drift, Math.abs(a.sx - b.sx), Math.abs(a.sy - b.sy));
  }
  // A LATERAL offset is the thing that was previously unsayable: it must move the picture.
  const side = makeCam(900, 240, 520, v, { back: B, up: 0, fx: cosh * 2, fy: sinh * 2 });
  const p0 = viaBack.proj(0, 0, 0), p1 = side.proj(0, 0, 0);
  if (Math.abs(p0.sx - p1.sx) > 1) moved++;
}

console.log(`  ${bad ? '✗' : '✓'} freecam — ${checks} projections bit-identical with the offset unused`);
console.log(`  ${drift < 1e-9 ? '✓' : '✗'} a free offset down the heading matches the old scalar (max drift ${drift.toExponential(2)})`);
console.log(`  ${moved === HEADINGS.length ? '✓' : '✗'} a lateral offset moves the camera (${moved}/${HEADINGS.length} headings)`);
if (bad || drift >= 1e-9 || moved !== HEADINGS.length) process.exit(1);

// ── The controller itself ───────────────────────────────────────────────────
// Pure logic, no DOM, so it is worth asserting rather than eyeballing in a cab.
import { createFreeCam, ORBIT_PIVOT_Z } from '../../client/game/js/panels/freecam.js';

let cbad = 0;
const ck = (ok, what) => { if (!ok) { cbad++; console.log(`  ✗ ${what}`); } };

const fc = createFreeCam();
// ⚠ THE ONE THAT MATTERS. Every key it owns is a driving control somewhere — W/S is the cab's
// throttle, A/D the wheel — so an INACTIVE camera must consume nothing at all. If this ever
// returns true while closed, pressing W in a truck moves a camera instead of opening the rack.
ck(fc.onKey('w', true) === false, 'a closed camera consumes no keys');
ck(fc.view() === null, 'a closed camera contributes no view');

fc.open({ yaw: 90, z: 1 });
ck(fc.active, 'it opens');
ck(fc.onKey('w', true) === true, 'an open camera takes its own keys');
ck(fc.onKey('k', true) === false, '…and leaves everything else alone');

// Forward is (sin, −cos) in the frame makeCam reads — the same two expressions the projection is
// built from. At yaw 90 that is +x and no y, which is the cheapest possible statement of it.
// ⚠ Stepped in real frames rather than one big dt: `step` clamps dt to 0.1s so a hitched frame
// cannot teleport the camera across the map, which means a single step(1) moves a tenth of what
// the arithmetic suggests. Ten frames of it is the honest way to ask this question.
const before = { ...fc.view() };
for (let i = 0; i < 10; i++) fc.step(0.1);
const after = fc.view();
ck(after.x > before.x + 0.5 && Math.abs(after.y - before.y) < 1e-6, 'W at yaw 90 drives +x and only +x');

fc.onKey('w', false);
fc.onKey('arrowright', true);
const yaw0 = fc.view().yaw; fc.step(0.5);
ck(fc.view().yaw > yaw0, 'the look keys turn it');

// A stuck key is the failure that has no way out from inside the cab: the camera drifts and nothing
// the player presses stops it. Closing must drop the whole set.
fc.close(); fc.open({});
const p0 = { ...fc.view() }; fc.step(1);
ck(Math.abs(fc.view().x - p0.x) < 1e-9 && Math.abs(fc.view().yaw - p0.yaw) < 1e-9, 'reopening does not inherit held keys');

fc.onKey('r', true); fc.step(1);
ck(fc.view().z > p0.z, 'E/R lifts it');
fc.close();
ck(!fc.active && fc.view() === null, 'it closes');

console.log(`  ${cbad ? '✗' : '✓'} freecam controller — ${cbad} problem(s)`);
if (cbad) process.exit(1);

// ── Mouse, roll and dolly ───────────────────────────────────────────────────
const fm = createFreeCam();
// Same rule as the keys, and for the same reason: a closed camera must not eat a mouse gesture, or
// the cockpit's yoke and the cab's own drags stop working the moment this file is imported.
ck(fm.look(10, 10) === false, 'a closed camera refuses the mouse');
ck(fm.orbit(10, 10) === false, '…and will not orbit');
ck(fm.setButton('up', true) === false, '…and takes no buttons');
ck(fm.dolly(-1) === false, '…and ignores the wheel');

fm.open({ yaw: 0, z: 1 });
const y0 = fm.view().yaw, mp0 = fm.view().pitch;
fm.look(60, 0);
ck(fm.view().yaw > y0, 'moving the mouse right turns it right');
fm.look(0, -60);
ck(fm.view().pitch > mp0, 'moving the mouse up looks up');
// ⚠ Yaw is normalised on the way in, which a `+=` alone would not do — a player who spins the same
// way for long enough under a pointer lock has no screen edge to stop them, so the number grows
// without bound and every `% 360` downstream is doing the work this should have done.
fm.open({ yaw: 350, z: 1 });
fm.look(200, 0);
ck(fm.view().yaw >= 0 && fm.view().yaw < 360, 'freelook keeps yaw inside one turn');

// ── THE BUTTONS ─────────────────────────────────────────────────────────────
// Left lifts, right drops — and they are spent through `step`, so they must move the camera by
// exactly what R and F move it by. Two controls, one integrator.
fm.open({ yaw: 0, z: 1 });
const bz0 = fm.view().z;
fm.setButton('up', true); for (let i = 0; i < 5; i++) fm.step(0.1);
const bz1 = fm.view().z;
ck(bz1 > bz0, 'the left button lifts it');
fm.setButton('up', false); fm.setButton('down', true); for (let i = 0; i < 5; i++) fm.step(0.1);
ck(Math.abs(fm.view().z - bz0) < 1e-9, 'the right button drops it back by exactly as much');
// Both at once is a standoff, not a race: the two adds cancel in `go` and nothing needs to rule on it.
fm.setButton('up', true); for (let i = 0; i < 5; i++) fm.step(0.1);
ck(Math.abs(fm.view().z - bz0) < 1e-9, 'both buttons together move it nowhere');
// ⚠ THE STUCK BUTTON. A pointer lock can go (Esc, a tab switch) with a button still down, and no
// pointerup ever arrives — so the camera climbs for ever with nothing the player can press to stop
// it. `releaseButtons` is the valve, and it must NOT also drop the keys: a lock change is not a
// blur, and W is very likely still genuinely held.
fm.setButton('down', false); fm.onKey('w', true);
fm.releaseButtons();
const sz0 = { ...fm.view() };
fm.step(0.1);
ck(Math.abs(fm.view().z - sz0.z) < 1e-9, 'releasing the buttons stops the climb');
ck(fm.view().y < sz0.y, '…and leaves a held key alone');
fm.onKey('w', false);
// Closing drops them too, or reopening inherits a button nobody is pressing.
fm.setButton('up', true); fm.close(); fm.open({ yaw: 0, z: 1 });
const cz0 = fm.view().z; fm.step(0.1);
ck(Math.abs(fm.view().z - cz0) < 1e-9, 'reopening does not inherit a held button');

// The wheel dollies along the view axis rather than changing the focal length — at yaw 0 that is
// −y, and it must be the SAME axis W drives along or the two controls disagree about "forward".
fm.open({ yaw: 0, z: 1 });
const d0 = { ...fm.view() };
fm.dolly(-1);
ck(fm.view().y < d0.y && Math.abs(fm.view().x - d0.x) < 1e-9, 'the wheel dollies down the view axis');

// Roll is the rotation a chase camera cannot have: it pins the horizon level by definition.
fm.open({});
ck(fm.view().roll === 0, 'it opens level');
fm.onKey('x', true); for (let i = 0; i < 5; i++) fm.step(0.1);
ck(fm.view().roll > 0, 'X rolls it');
const r1 = fm.view().roll;
fm.onKey('x', false); fm.onKey('z', true); for (let i = 0; i < 10; i++) fm.step(0.1);
ck(fm.view().roll < r1, 'Z rolls it back the other way');
// ⚠ Reopening must level it. A camera that remembered a dutch angle from a previous session would
// have the player wondering why the horizon is bent with nothing on screen to explain it.
fm.close(); fm.open({});
ck(fm.view().roll === 0, 'reopening levels the horizon');

console.log(`  ${cbad ? '✗' : '✓'} freecam mouse + roll — ${cbad} problem(s) total`);
if (cbad) process.exit(1);

// ── THE ORBIT ───────────────────────────────────────────────────────────────
// A middle-drag swings the camera round the vehicle. What makes that an orbit rather than a strafe
// is that the subject STAYS CENTRED, so the invariant under test is the aim: after any swing, the
// yaw and pitch the camera reports must point at the thing it is going round.
const fo = createFreeCam();
// The camera's own forward axis, in the frame makeCam reads — the same two expressions the
// projection is built from, so "where it is looking" here cannot drift from where it looks there.
const aimError = (v) => {
  const yr = v.yaw * Math.PI / 180, cp = Math.cos(v.pitch);
  const fx = Math.sin(yr) * cp, fy = -Math.cos(yr) * cp, fz = Math.sin(v.pitch);
  const tx = -v.x, ty = -v.y, tz = ORBIT_PIVOT_Z - v.z;
  const L = Math.hypot(tx, ty, tz) || 1;
  return Math.abs(1 - (fx * tx + fy * ty + fz * tz) / L);   // 0 when it is dead on the subject
};
const radius = (v) => Math.hypot(v.x, v.y, v.z - ORBIT_PIVOT_Z);

// ⚠ THE ONE THAT MATTERS. All three panels seed the camera at x=0, y=0 — the vehicle's own tile —
// so the FIRST orbit of every session is a swing round a subject the camera is standing inside.
// Done naively that is a rotation with no radius: the arithmetic is degenerate, the picture does
// not move, and the control reads as broken on the only press anybody makes first.
fo.open({ yaw: 0, z: 0.5 });
fo.orbit(1, 0);
ck(radius(fo.view()) > 1, 'orbiting from the vehicle backs the camera off to a radius it can use');
ck(aimError(fo.view()) < 1e-9, '…and it comes out looking at the vehicle');

// The turntable proper: swing it a long way round and the subject is still in the middle of frame.
fo.open({ yaw: 0, z: 0.6, x: 0, y: 2 });
const r0 = radius(fo.view());
for (const [dx, dy] of [[120, 0], [0, -90], [-40, 30], [300, -200], [-500, 400]]) {
  fo.orbit(dx, dy);
  ck(aimError(fo.view()) < 1e-9, `the subject stays centred through a ${dx},${dy} swing`);
  ck(Math.abs(radius(fo.view()) - r0) < 1e-9, `…at the radius it started on (${dx},${dy})`);
  // ⚠ And the aim it hands back stays inside PITCH_LIM, which every other control in that file
  // promises and the renderer's own horizon solve clamps to. An orbit is derived rather than
  // accumulated, so it is the one control that could quietly hand out a steeper one.
  ck(Math.abs(fo.view().pitch) <= 1.35 + 1e-9, `…and inside PITCH_LIM (${dx},${dy})`);
}

// ⚠ AND THE SIGNS ARE THE CHASE CAMERA'S, not this file's own taste. A player reaching for the
// middle button has already learnt the gesture on the view they detached FROM, and a turntable that
// went the other way round would be a second instrument wearing the first one's clothes.
fo.open({ yaw: 0, z: 0.6, x: 0, y: 2 });
const o0 = { ...fo.view() };
fo.orbit(0, -80);
ck(fo.view().z > o0.z, 'dragging up cranes the camera up and over');
ck(fo.view().pitch < o0.pitch, '…which is to say it ends up looking further down');
fo.orbit(0, 80);
ck(Math.abs(fo.view().z - o0.z) < 1e-6 && Math.abs(fo.view().x - o0.x) < 1e-6,
  'and the swing is reversible — back the same distance is back to the same shot');

// ⚠ AND THE UPPER LIMIT HOLDS THE ORBIT WITHOUT YANKING A CAMERA THAT IS ALREADY PAST IT. R flies
// the eye straight up over the subject, which is further over than the swing may ever go — so a
// flat clamp would drop the shot to 66° on the first press, before the gesture moved it at all.
fo.open({ yaw: 0, z: 2.5 });
const hz0 = fo.view().z;
// Where a flat clamp at ORBIT_LIM would have put it: the drop the player would have seen.
const snapped = ORBIT_PIVOT_Z + (hz0 - ORBIT_PIVOT_Z) * Math.sin(1.15);
fo.orbit(40, 0);
ck(fo.view().z > snapped + 0.1, 'orbiting from overhead does not snap the camera down to the arc limit');
ck(hz0 - fo.view().z < 0.1, '…it gives up only the hair PITCH_LIM asks for');
// ⚠ AND IT DOES GIVE THAT HAIR UP. This is the one entry state from which the derived aim could
// exceed PITCH_LIM — the soft bound above deliberately lets the arc stay where it was found, so
// only the hard wall stops a straight-down pitch that `horizonY` would then clamp behind its back,
// leaving the horizon disagreeing with where the camera says it is.
ck(Math.abs(fo.view().pitch) <= 1.35 + 1e-9, '…and the aim stays inside PITCH_LIM even from there');
fo.orbit(0, 300);
ck(fo.view().z < hz0 - 0.5, '…and it still comes down when you ask it to');

// The ground is the lower bound, and it is solved at the radius rather than set as an angle: push
// the orbit all the way under and the eye stops at the floor the dolly and the keys stop at.
fo.open({ yaw: 0, z: 0.6, x: 0, y: 2 });
for (let i = 0; i < 20; i++) fo.orbit(0, 400);
ck(fo.view().z >= -0.6 - 1e-9, 'swinging under the subject never sinks the eye through the floor');
ck(aimError(fo.view()) < 1e-9, '…and it is still looking at it down there');

console.log(`  ${cbad ? '✗' : '✓'} freecam orbit — ${cbad} problem(s) total`);
if (cbad) process.exit(1);

// ── Turning in place ────────────────────────────────────────────────────────
// The control that was missing: A/D strafe, so the camera could be MOVED sideways and, without
// reaching for the arrows, never TURNED. Q/E now yaw — and must do it WITHOUT moving the camera,
// which is the whole difference between turning and strafing.
const ft = createFreeCam();
ft.open({ yaw: 0, z: 1 });
const t0 = { ...ft.view() };
ft.onKey('e', true); for (let i = 0; i < 5; i++) ft.step(0.1);
const t1 = ft.view();
ck(t1.yaw > t0.yaw, 'E turns right');
ck(Math.abs(t1.x - t0.x) < 1e-9 && Math.abs(t1.y - t0.y) < 1e-9 && Math.abs(t1.z - t0.z) < 1e-9,
  '…in place, without moving the camera an inch');
ft.onKey('e', false);
ft.onKey('q', true); for (let i = 0; i < 10; i++) ft.step(0.1);
// ⚠ Compared as a WRAPPED difference, not with `<`. Yaw is normalised into [0,360), so turning
// left past zero lands at 329 and reads as "greater than" the 31 it started from. A test that got
// this wrong would demand the code stop normalising, which is the wrong end to fix it at.
const dq = ((ft.view().yaw - t1.yaw + 540) % 360) - 180;
ck(dq < 0, 'Q turns left');
// R/F keep up-down on their own now that Q/E have been reassigned off it.
ft.onKey('q', false);
const u0 = ft.view().z;
ft.onKey('r', true); for (let i = 0; i < 5; i++) ft.step(0.1);
ck(ft.view().z > u0, 'R still lifts');
ft.onKey('r', false); ft.onKey('f', true); for (let i = 0; i < 10; i++) ft.step(0.1);
ck(ft.view().z < u0, 'F still drops');

console.log(`  ${cbad ? '✗' : '✓'} freecam turn-in-place — ${cbad} problem(s) total`);
if (cbad) process.exit(1);

// ── THE PITCH TERM ──────────────────────────────────────────────────────────
// GLASS grew an optical axis that can tilt. Two things have to be true about it, and the first is
// the one this file exists for.
//
// 1. AN UNPITCHED CAMERA IS BIT-IDENTICAL. cos 0 is exactly 1 and sin 0 exactly 0, so a single
//    pitched closure would reduce algebraically — but `f·1 + u·0` is not the same floating-point
//    expression as `f`, and every view in the game goes through this function. So the default is a
//    separate closure, and that is asserted with Object.is rather than believed.
//
// 2. PITCH ACTUALLY TILTS THE VIEW, in the direction the sign says, about the eye. A point level
//    with the eye and dead ahead sits on the horizon at pitch 0; tipping the view DOWN must move
//    it UP the screen, and a point directly below the camera must come into frame at all, which it
//    never could before.
let pbad = 0;
const pck = (ok, what) => { if (!ok) { pbad++; console.log(`  ✗ ${what}`); } };

for (const heading of HEADINGS) {
  // ⚠ AND AN AIRCRAFT'S OWN PITCH MUST NOT REACH THE CAMERA. `v.pitch` in this renderer is the
  // CRAFT'S ATTITUDE IN DEGREES — four readers divide it by 26 or multiply it by π/180 — and the
  // camera tilt is radians. For one afternoon `makeCam` read that field, so every degree of climb
  // tipped the view fifty-seven degrees: the city hung upside down and the runway swung round like
  // a billboard. The camera answers to `camPitch` and nothing else, and this is what says so.
  const flying = makeCam(900, 240, 520, { heading, height: 0.3, map: null, pitch: 12, bank: 4 });
  const level = makeCam(900, 240, 520, { heading, height: 0.3, map: null });
  for (const [x, y, z] of [[0, -6, 0], [2, -9, 1.2], [-3, -4, 0.4]]) {
    const a = flying.proj(x, y, z), b = level.proj(x, y, z);
    same(a.sx, b.sx, `an aircraft pitch of 12° must not move sx @${heading}`);
    same(a.sy, b.sy, `an aircraft pitch of 12° must not move sy @${heading}`);
  }

  const base = makeCam(900, 240, 520, { heading, height: 0.3, map: null });
  const zero = makeCam(900, 240, 520, { heading, height: 0.3, map: null, camPitch: 0 });
  for (const [dx, dy, wz] of PTS) {
    const a = base.proj(dx, dy, wz), b = zero.proj(dx, dy, wz);
    same(a.sx, b.sx, `pitch 0 proj.sx @${heading}`);
    same(a.sy, b.sy, `pitch 0 proj.sy @${heading}`);
    same(a.f, b.f, `pitch 0 proj.f @${heading}`);
  }
  for (const [aa, sd, wz] of FLS) {
    const a = base.projFL(aa, sd, wz), b = zero.projFL(aa, sd, wz);
    same(a.sx, b.sx, `pitch 0 projFL.sx @${heading}`);
    same(a.sy, b.sy, `pitch 0 projFL.sy @${heading}`);
  }
}

{
  const flat = makeCam(900, 240, 520, { heading: 0, height: 0, eyeH: 2, map: null });
  const down = makeCam(900, 240, 520, { heading: 0, height: 0, eyeH: 2, map: null, camPitch: 0.4 });
  const up = makeCam(900, 240, 520, { heading: 0, height: 0, eyeH: 2, map: null, camPitch: -0.4 });
  // Dead ahead, level with the eye: on the horizon when the view is level.
  const ahead = [0, -6, 2];
  pck(Math.abs(flat.proj(...ahead).sy - 240) < 1e-9, "level: a point at eye height sits on the horizon");
  pck(down.proj(...ahead).sy < 240, "pitch down moves the view forward UP the screen");
  pck(up.proj(...ahead).sy > 240, "pitch up moves it down");
  // Lateral is untouched by pitch for a point on the view axis — a tilt is not a yaw.
  pck(Math.abs(down.proj(...ahead).sx - flat.proj(...ahead).sx) < 1e-9, "…and does not slide it sideways");
  // THE THING THE OLD PROJECTION COULD NOT DO AT ALL: see the ground below the camera. At pitch 0
  // a point under the eye has f→0 and is clamped to the near plane; tipped down it has real depth.
  const below = [0, -0.4, 0];
  pck(down.proj(...below).f > flat.proj(...below).f, "looking down gives the ground under the camera real depth");
  // A plan view: straight down, and a square on the ground stays square about the centre.
  const plan = makeCam(900, 240, 520, { heading: 0, height: 0, eyeH: 6, map: null, camPitch: Math.PI / 2 });
  const n = plan.proj(0, -4, 0), fpt = plan.proj(0, -8, 0);
  pck(n.sy > fpt.sy, "straight down: nearer ground is lower on the screen");
  const l = plan.proj(-2, -6, 0), r = plan.proj(2, -6, 0);
  pck(Math.abs((l.sx + r.sx) / 2 - 450) < 1e-6, "…and the view is still centred on the axis");
}

console.log(`  ${pbad || bad ? "✗" : "✓"} pitch — unpitched cameras are bit-identical, and a pitched one tilts`);
if (pbad) process.exit(1);

// ── THE PANE'S SHAPE MUST NOT BE THE WORLD'S SHAPE ──────────────────────────
//
// `makeCam` takes the LATERAL focal length off the width — `FL = (W/2)/1.15` — and paintWindshield
// supplies the VERTICAL one separately. While that second number came off the height alone, the
// two scales were independent and the picture was stretched to whatever aspect the canvas happened
// to be. Nothing catches that: no throw, no gap, no missing surface — the city is simply the wrong
// shape, which is how a phone in the external view shipped at 4.6x the tuned stretch.
//
// The tuned pane is 1200x560. These hold `viewFocal` to it.
{
  let bad = 0;
  const ck = (c, m) => { if (!c) { console.error(`  ✗ aspect: ${m}`); bad++; } };
  // The lateral scale, as makeCam derives it — asked of the real camera rather than restated here,
  // so this cannot pass while the two halves disagree.
  const fl = (W) => makeCam(W, 100, 100, { heading: 0, map: null }).FL;
  const ratio = (W, H) => viewFocal(W, H) / fl(W);
  const REF = ratio(1200, 560);

  // 1. At the pane it was tuned in, the answer is the one that shipped — exactly, not nearly.
  ck(Object.is(viewFocal(1200, 560), 560 * 0.55), 'the reference pane is not bit-identical to H*0.55');
  // 2. EVERY pane shape holds the tuned ratio, wide ones included.
  //
  // ⚠ THIS USED TO SAY THE OPPOSITE FOR WIDE PANES — `viewFocal` kept `H * 0.55` above the reference
  // aspect, on the reasoning that the correction may only ever REMOVE stretch and never add it.
  // That was the safe way to land it and it left the bug standing on exactly the pane shape the
  // flight sim uses: a windscreen is wider than 1200x560 and gets wider on full screen, so the
  // vertical scale followed the height while the lateral one followed the width and the world was
  // stretched by however much wider the pane happened to be. Reported from the game as the aspect
  // changing between windowed and full screen.
  for (let W = 240; W <= 2400; W += 37) for (let H = 200; H <= 1600; H += 53) {
    ck(Math.abs(ratio(W, H) - REF) < 1e-12, `${W}x${H} does not hold the tuned ratio`);
  }
  // 3. And a SEAT cannot change the proportions either, whatever field of view it asks for.
  //
  // ⚠ `fovMul` MULTIPLIED THE LATERAL FOCAL LENGTH AND NOTHING ELSE, so the cab's interior-only
  // 1.22 made the world 22% wider through the windscreen than it is over the bonnet — a stretch
  // rather than a field of view. makeCam scales the vertical focal length by the same number now,
  // which is what makes the two axes a focal length instead of two independent scales.
  {
    const shape = (fovMul) => {
      const c = makeCam(1200, 235, viewFocal(1200, 560), { heading: 0, map: null, fovMul });
      return (1200 * (2 * c.FL / 1200)) / (560 * (2 * c.depth / 560));   // lateral px per unit ÷ vertical px per unit
    };
    const ext = shape(undefined);
    for (const mul of [1.22, 0.7, 1, 2.5]) {
      ck(Math.abs(shape(mul) - ext) < 1e-12, `fovMul ${mul} changes the world's proportions — a seat may change its field of view, not its shape`);
    }
  }
  console.log(`  ${bad ? '✗' : '✓'} aspect — the world keeps its tuned proportions on every pane shape and at every seat`);
  if (bad) process.exit(1);
}

// ── DOES THE GROUND AGREE WITH THE CAMERA ABOUT WHERE THE EYE IS? ───────────────────────────────
//
// The chase lift is spent as `up` rather than as an absolute height for one stated reason: four
// readers sum it independently, and expressing the answer as a lift lands all four on the same
// height by construction. windshield.js says so at the chase object, and names the one that would
// break if anybody handed over an absolute height instead — "the GROUND, which is how you get a
// floor rastered for a camera that is somewhere else."
//
// The detached camera is exactly that case. It has no lift to spend, so it passes `ez` with `up` at
// 0 — and `drawMode7Floor` read `up` and never `ez`, so the floor stayed at the vehicle's own seat
// however high the camera flew: 0.120 against a camera at 16.0, a factor of 133. On screen the
// ground compressed into a band under the horizon while the buildings standing on it projected far
// below the canvas — reported as "going up erases everything below you, increasingly".
//
// ⚠ THIS IS READ FROM `lastFloorState()`, NOT RECOMPUTED. The bug was a second copy of an
// expression drifting from the first, so a gate that writes the expression a THIRD time would pass
// against either of them. It asks the floor what it used.
{
  const ws = await import('../../client/game/js/panels/windshield.js');
  const { stubCanvas } = await import('./dom-stub.mjs');
  stubCanvas('__fcfloor', 640, 360);
  ws.installGLWorld(() => null);          // a hook that draws nothing still records the floor state
  const gl0 = ws.RENDER_TUNE.gl, gf0 = ws.RENDER_TUNE.glFloor;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  const R = 14, N = R * 2 + 1;
  const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
    { kind: 'land', biome: (x + y) % 5 === 0 ? 'redrock' : 'parkland', flr: 0 })));
  const shot = (freeCam, extra = {}) => {
    ws.paintWindshield('__fcfloor', { cls: 'truck', phase: 'cruise', external: true, worldBlend: 1,
      height: 0, eyeH: 0.12, hour: 13, weather: 'clear', speed: 0, map, heading: 0,
      mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 }, resFloor: 1,
      tune: { gl: 1, perfDS: 0 }, freeCam, ...extra });
    return ws.lastFloorState();
  };
  for (const z of [0.45, 1, 2, 4, 8, 16]) {
    const f = shot({ x: 0, y: 0, z, yaw: 0, pitch: 0, roll: 0 });
    ck(f && Math.abs(f.EH - z) < 1e-9,
      `a detached camera at z ${z} rasters its floor at EH ${f ? f.EH.toFixed(3) : '(no floor)'} — the ground is drawn for a camera that is somewhere else`);
  }
  for (const [x, y] of [[0, 0], [3, 0], [0, -5], [-4, 6], [11.5, -2.25]]) {
    const f = shot({ x, y, z: 2, yaw: 0, pitch: 0, roll: 0 });
    ck(f && Math.abs(f.ax - x) < 1e-9 && Math.abs(f.ay - y) < 1e-9,
      `a detached camera at (${x}, ${y}) samples its floor at (${f ? f.ax.toFixed(2) : '?'}, ${f ? f.ay.toFixed(2) : '?'}) — the ground is sampled where the vehicle is, not where the camera is`);
  }
  // ⚠ AND THE IDENTITY, which is what makes the change safe under every seat that passes no
  // detached camera at all: with no `freeCam` the floor must read exactly the seat's own eye height.
  // An INTERIOR seat, deliberately: with `external` set and no detached camera the CHASE rig is
  // live, so a lift and a dolly are correctly in play and there is no bare identity to assert. Inside
  // a cab there is no chase at all, so the floor must read the seat's own eye height and nothing else.
  { const f = shot(null, { external: false });
    ck(f && Math.abs(f.EH - 0.12) < 1e-12, `an ordinary seat's floor moved: EH ${f ? f.EH : '(none)'} rather than its own eyeH 0.12`);
    ck(f && f.ax === 0 && f.ay === 0, 'an ordinary seat\'s floor sample centre moved off the map offset'); }
  ws.installGLWorld(null); ws.RENDER_TUNE.gl = gl0; ws.RENDER_TUNE.glFloor = gf0;
  console.log(`  ${cbad ? '✗' : '✓'} floor — the ground is rastered for the camera that is actually looking at it, at every height and offset`);
}
if (cbad) process.exit(1);


// ── THE SURFACE: WHICH BUTTON REACHES WHICH CONTROL ─────────────────────────
// Everything above tests the camera. This tests the WIRING, which is where a control scheme
// actually goes wrong — a button routed to the wrong verb, a menu popping up on the button that
// is supposed to drop the camera, a lock lost with a button still held. None of it needs a
// renderer or a GPU: it is event routing, and a fake surface can ask every question a real one can.
//
// ⚠ It runs LAST and puts the globals back, because `dom-stub` has already installed its own
// `document`/`window` for the sections above and this one needs a surface that can hold a lock.
{
  const realDoc = globalThis.document, realWin = globalThis.window;
  const target = () => {
    const l = {};
    return {
      _l: l,
      addEventListener(t, fn) { (l[t] ||= []).push(fn); },
      removeEventListener(t, fn) { l[t] = (l[t] || []).filter((f) => f !== fn); },
      fire(t, ev) { for (const fn of (l[t] || []).slice()) fn(ev); return ev; },
      count() { return Object.values(l).reduce((n, a) => n + a.length, 0); },
    };
  };
  const ev = (o = {}) => ({
    button: 0, movementX: 0, movementY: 0, deltaY: 0, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...o,
  });

  const doc = target(), win = target(), el = target();
  doc.pointerLockElement = null;
  // A real browser fires pointerlockchange on both edges, and the binder's release valve hangs off
  // it — so a fake that only flips the field would pass a test the browser would fail.
  el.requestPointerLock = () => { doc.pointerLockElement = el; doc.fire('pointerlockchange', ev()); };
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange', ev()); };
  globalThis.document = doc; globalThis.window = win;

  let sbad = 0;
  // ⚠ Prints EVERY failure, not just the first. A first cut reported one line and a count, which is
  // exactly the wrong half to hide: the count says something is wrong and the lines say what, and
  // a control-scheme bug usually breaks three bindings at once because they share a code path.
  const sk = (ok, what) => { if (!ok) { sbad++; console.log(`  ✗ ${what}`); } };
  const { bindFreeCamPointer } = await import('../../client/game/js/panels/freecam.js');
  const fs = createFreeCam();
  const unbind = bindFreeCamPointer(el, fs);

  // ⚠ THE ONE THAT MATTERS, and it is the mouse's version of the closed-camera key rule above. The
  // cockpit's yoke is a left drag and the cab's steering is a left drag; if a stowed camera eats
  // either, the aircraft cannot be flown and the truck cannot be driven.
  sk(fs.active === false, 'it binds without opening anything');
  sk(el.fire('pointerdown', ev({ button: 0 })).prevented === false, 'a stowed camera does not eat a left click');
  sk(doc.pointerLockElement === null, '…and does not grab the pointer behind the panel’s back');
  sk(el.fire('contextmenu', ev()).prevented === false, '…and leaves the context menu alone');

  // Coming off the mount takes the pointer, because `O` is a keypress and carries the activation
  // the lock needs — a camera that made you click first would waste the gesture you just made.
  fs.open({ yaw: 0, z: 0.6, x: 0, y: 2 });
  sk(doc.pointerLockElement === el, 'opening the camera takes the pointer');

  // Freelook: the mouse moves, the camera looks, and no button was involved in saying so.
  const ly0 = fs.view().yaw;
  const lm = win.fire('pointermove', ev({ movementX: 40 }));
  sk(fs.view().yaw > ly0, 'a bare mouse move looks around');
  sk(lm.prevented && lm.stopped, '…and is taken off the panel underneath');

  // MIDDLE ORBITS. The same movement event, read as a swing rather than an aim — which is the whole
  // of what the button changes, and the reason `orbiting` is asked here rather than guessed.
  const or0 = Math.hypot(fs.view().x, fs.view().y, fs.view().z - ORBIT_PIVOT_Z);
  el.fire('pointerdown', ev({ button: 1 }));
  sk(fs.orbiting === true, 'the middle button arms the orbit');
  win.fire('pointermove', ev({ movementX: 40 }));
  sk(Math.abs(Math.hypot(fs.view().x, fs.view().y, fs.view().z - ORBIT_PIVOT_Z) - or0) < 1e-9,
    '…and the move swings the camera instead of turning it on the spot');
  win.fire('pointerup', ev({ button: 1 }));
  sk(fs.orbiting === false, 'releasing it disarms the orbit');

  // LEFT LIFTS, RIGHT DROPS, and the right one must not also open a menu over the shot.
  const bz = fs.view().z;
  el.fire('pointerdown', ev({ button: 0 }));
  for (let i = 0; i < 5; i++) fs.step(0.1);
  sk(fs.view().z > bz, 'holding the left button lifts the camera');
  win.fire('pointerup', ev({ button: 0 }));
  el.fire('pointerdown', ev({ button: 2 }));
  for (let i = 0; i < 5; i++) fs.step(0.1);
  sk(fs.view().z < bz + 1e-9, 'holding the right button drops it');
  sk(el.fire('contextmenu', ev()).prevented === true, '…without the context menu opening on top of it');

  // ⚠ ESC HANDS THE MOUSE BACK WITHOUT STOWING THE CAMERA, and whatever was held at that moment
  // never gets a pointerup. Without the valve the camera falls for ever with nothing to press.
  doc.exitPointerLock();
  const ez0 = fs.view().z;
  for (let i = 0; i < 5; i++) fs.step(0.1);
  sk(Math.abs(fs.view().z - ez0) < 1e-9, 'losing the lock releases a held button');

  // ── UNLOCKED, THE MOUSE STILL LOOKS ──────────────────────────────────────
  // ⚠ NOT A HYPOTHETICAL. The Claude desktop app's browser pane refuses pointer lock outright —
  // `featurePolicy.allowsFeature('pointer-lock')` is false at the top level, measured — so this
  // branch is the one the game is most often LOOKED at through. It aims off the cursor's own travel
  // instead of `movementX`, which costs only the edge of the screen.
  const uy0 = fs.view().yaw;
  sk(win.fire('pointermove', ev({ clientX: 400, clientY: 300 })).prevented === false,
    'the first unlocked move only takes a bearing');
  sk(fs.view().yaw === uy0, '…and aims nothing, so coming back from elsewhere cannot snap the shot round');
  const um = win.fire('pointermove', ev({ clientX: 460, clientY: 300 }));
  sk(fs.view().yaw > uy0, 'the next one turns the camera');
  sk(um.prevented && um.stopped, '…and is taken off the panel underneath, same as a locked one');
  // ⚠ A stow and a re-open must drop the remembered cursor, or a camera put away with the pointer at
  // one edge of the screen and brought out at the other swings by the whole width on the first twitch.
  fs.close(); fs.open({ yaw: 0, z: 0.6, x: 0, y: 2 });
  const ry0 = fs.view().yaw;
  win.fire('pointermove', ev({ clientX: 900, clientY: 300 }));
  sk(fs.view().yaw === ry0, 'reopening forgets where the cursor was');

  // The click that takes the pointer back moves nothing either — see the ⚠ on `down`. ⚠ Reopening
  // above re-grabbed the lock, so it has to go again first: locked, that same click IS the lift, and
  // a test that skipped this step would be asserting the opposite of what it says.
  doc.exitPointerLock();
  const cz0 = fs.view().z;
  el.fire('pointerdown', ev({ button: 0 }));
  sk(doc.pointerLockElement === el, 'clicking the glass takes the pointer back');
  for (let i = 0; i < 5; i++) fs.step(0.1);
  sk(Math.abs(fs.view().z - cz0) < 1e-9, '…and that click does not also lift the camera');
  win.fire('pointerup', ev({ button: 0 }));

  fs.close();
  sk(doc.pointerLockElement === null, 'stowing the camera gives the pointer back');
  unbind();
  sk(el.count() === 0 && win.count() === 0 && doc.count() === 0, 'unbinding leaves no listener behind');
  // ⚠ And the cab rebinds on every panel open, so a teardown must not unhook the LIVE surface.
  const live = bindFreeCamPointer(el, fs);
  unbind();
  fs.open({ yaw: 0, z: 0.6 });
  sk(doc.pointerLockElement === el, 'a stale unbind does not unhook the surface that replaced it');
  fs.close(); live();

  // ── ⚠ AND A SURFACE THAT REFUSES THE LOCK, WHICH IS A REAL ONE ─────────────
  // Everything above runs on a fake element that grants the lock on request, and that fake is what
  // let a genuinely broken build pass: with the lock refused, `down` took its "take the pointer"
  // early return on EVERY click, so not one of the three buttons ever armed. Freelook still worked,
  // which is what made it look fine. The Claude desktop app's pane refuses the lock by
  // Permissions-Policy, so this is the environment the game is most often looked at through — and
  // it took a real browser to find it, because no fake here could refuse.
  {
    const d2 = target(), w2 = target(), e2 = target();
    d2.pointerLockElement = null;
    // Refused the way a browser refuses: an error event, asynchronously in real life and inline
    // here, and `pointerLockElement` never set.
    e2.requestPointerLock = () => { d2.fire('pointerlockerror', ev()); };
    d2.exitPointerLock = () => {};
    // The other source: a document that says no before anything is even asked.
    d2.featurePolicy = { allowsFeature: (f) => f !== 'pointer-lock' };
    globalThis.document = d2; globalThis.window = w2;

    const f2 = createFreeCam();
    const un2 = bindFreeCamPointer(e2, f2);
    f2.open({ yaw: 0, z: 0.6, x: 0, y: 2 });
    sk(d2.pointerLockElement === null, 'a refusing surface stays unlocked');
    // THE BUG. The buttons must arm anyway, because there is no lock coming to wait for.
    const rz0 = f2.view().z;
    e2.fire('pointerdown', ev({ button: 0 }));
    for (let i = 0; i < 5; i++) f2.step(0.1);
    sk(f2.view().z > rz0, 'the left button still lifts where the lock is refused');
    w2.fire('pointerup', ev({ button: 0 }));
    e2.fire('pointerdown', ev({ button: 1 }));
    sk(f2.orbiting === true, '…and the middle button still orbits');
    w2.fire('pointerup', ev({ button: 1 }));
    // …and the mouse still aims, off the cursor's own travel.
    const ry = f2.view().yaw;
    w2.fire('pointermove', ev({ clientX: 100, clientY: 100 }));
    w2.fire('pointermove', ev({ clientX: 180, clientY: 100 }));
    sk(f2.view().yaw > ry, '…and the mouse still looks');
    f2.close(); un2();
  }

  globalThis.document = realDoc; globalThis.window = realWin;
  console.log(`  ${sbad ? '✗' : '✓'} freecam surface — which button reaches which control (${sbad} problem(s))`);
  if (sbad) process.exit(1);
}
