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
import { makeCam } from '../../client/game/js/panels/windshield.js';

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
import { createFreeCam } from '../../client/game/js/panels/freecam.js';

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
// Same rule as the keys, and for the same reason: a closed camera must not eat a drag, or the
// cockpit's yoke and the cab's own gestures stop working the moment this file is imported.
ck(fm.beginDrag(10, 10) === false, 'a closed camera refuses a drag');
ck(fm.moveDrag(20, 20) === false, '…and tracks nothing');
ck(fm.dolly(-1) === false, '…and ignores the wheel');

fm.open({ yaw: 0, z: 1 });
ck(fm.beginDrag(100, 100) === true, 'an open camera takes the drag');
ck(fm.dragging === true, '…and says so');
const y0 = fm.view().yaw, mp0 = fm.view().pitch;
fm.moveDrag(160, 100);
ck(fm.view().yaw > y0, 'dragging right turns it right');
fm.moveDrag(160, 40);
ck(fm.view().pitch > mp0, 'dragging up looks up');
fm.endDrag();
ck(fm.dragging === false, 'releasing ends the drag');

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
