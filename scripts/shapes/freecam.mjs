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
