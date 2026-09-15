// THE TONE CURVE AND THE BRIGHT-PASS KNEE, AS FAR AS THEY CAN BE PROVED WITHOUT A GPU.
//
// Almost all of the HDR feature is framebuffers and full-screen passes, and there is no rasteriser
// here. What can be held is the arithmetic the whole thing rests on, and two claims in particular
// that are load-bearing enough to be worth a push gate:
//
//   1. AT TONEMAP 0 THE COMPOSITE IS EXACTLY A CLAMP. This is the entire safety argument for
//      shipping a float target over a renderer whose palettes, three occlusion terms, material
//      response and wall-wash gain were all tuned by eye against a linear 8-bit output. If the
//      lerp at 0 is off by even a little, every one of those is silently re-graded.
//
//   2. THE CURVE IS MONOTONIC. A tone curve that is not monotonic inverts contrast somewhere in its
//      range — two different input brightnesses mapping so the darker one comes out lighter — which
//      on a wall reads as a band of wrongness that moves as the light does, and looks like anything
//      except a bad fit.
//
// ⚠ THESE ARE A TRANSCRIPTION PAIR WITH THE GLSL AND MUST BE EDITED TOGETHER. The shader in hdr.js
// is the copy that runs; this is the copy that is tested. The same deliberate duplication as
// RECONSTRUCT in ssao.js and the tangent frame shared by faceEdges and the mass shader.
import { readFileSync } from 'node:fs';

const problems = [];

// Narkowicz's ACES fit, exactly as the composite spells it.
const aces = (x) => {
  const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return v < 0 ? 0 : v > 1 ? 1 : v;
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const graded = (x, tonemap) => clamp01(x) + (aces(x) - clamp01(x)) * clamp01(tonemap);

// ── 1. AT 0 IT IS THE CLAMP, EXACTLY ──────────────────────────────────────────
{
  let worst = 0;
  for (let i = 0; i <= 400; i++) {
    const x = i / 100;                        // 0..4, well past what the buffer holds
    const d = Math.abs(graded(x, 0) - clamp01(x));
    if (d > worst) worst = d;
  }
  // Not a tolerance: a lerp by exactly 0 must return exactly its first argument.
  if (worst !== 0) problems.push(`at tonemap 0 the composite differs from a clamp by ${worst} — the float path is re-grading the city`);
  console.log(`  · tonemap 0 against a plain clamp: worst difference ${worst}`);
}

// ── 2. MONOTONIC, AT EVERY STRENGTH ───────────────────────────────────────────
{
  let bad = 0, worstAt = null;
  for (const t of [0, 0.15, 0.25, 0.4, 0.6, 0.8, 1]) {
    let prev = -1;
    for (let i = 0; i <= 2000; i++) {
      const y = graded(i / 500, t);
      if (y < prev - 1e-9) { bad++; if (!worstAt) worstAt = `strength ${t} at x=${(i / 500).toFixed(3)}`; }
      prev = y;
    }
  }
  if (bad) problems.push(`the tone curve is not monotonic (${bad} inversions, first at ${worstAt})`);
  console.log(`  · monotonic at 7 strengths over 0..4: ${bad} inversions`);
  // Black has to stay black, or every night scene lifts off its own background.
  for (const t of [0, 0.25, 0.6, 1]) {
    if (graded(0, t) !== 0) problems.push(`at strength ${t} the curve maps 0 to ${graded(0, t)} — black is not black`);
  }
}

// ── 3. THE BRIGHT-PASS KNEE IS CONTINUOUS ─────────────────────────────────────
//
// ⚠ A DISCONTINUITY HERE IS A POP, NOT A SEAM. The soft knee exists so a surface drifting across the
// threshold as you drive past eases into bloom; a jump at either join makes it appear between two
// frames, which is the same class of problem the light fade was built to remove one layer along.
{
  const w = (l, T, K) => (l <= T ? 0
    : l < T + K ? (l - T) * (l - T) / (2 * K)
    : l - T - K * 0.5);
  const T = 1.0, K = 0.4;
  let worst = 0;
  for (const at of [T, T + K]) {
    const lo = w(at - 1e-6, T, K), hi = w(at + 1e-6, T, K);
    worst = Math.max(worst, Math.abs(hi - lo));
  }
  if (worst > 1e-5) problems.push(`the bright-pass knee jumps by ${worst} at a join`);
  // And it never subtracts light.
  for (let i = 0; i <= 400; i++) { if (w(i / 100, T, K) < 0) { problems.push('the bright-pass knee goes negative'); break; } }
  console.log(`  · bright-pass knee: continuous at both joins (worst jump ${worst.toExponential(1)})`);
}

// ── 4. AND THE TWO COPIES STILL LOOK LIKE EACH OTHER ──────────────────────────
//
// ⚠ THE WEAKEST CHECK HERE AND STILL WORTH HAVING. It cannot execute GLSL, so it confirms the
// shader carries the same coefficients this file tests rather than that it computes the same thing.
// A retune that edited one copy and not the other is the realistic failure, and this catches it.
{
  const src = readFileSync('client/game/js/panels/gl/hdr.js', 'utf8');
  for (const c of ['2.51', '0.03', '2.43', '0.59', '0.14']) {
    if (!src.includes(c)) problems.push(`hdr.js no longer contains the ACES coefficient ${c} — the curve here and the curve that runs have drifted`);
  }
  if (!/mix\(clamp\(c, 0\.0, 1\.0\), aces\(c\)/.test(src)) {
    problems.push('hdr.js no longer lerps from a clamp toward the curve — the "0 is exactly the old renderer" claim is not what the shader does');
  }
  console.log('  · the shader still carries the same five coefficients and the same lerp');
}

if (problems.length) {
  console.error(`\n✗ glhdr — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ glhdr: the tone curve is a no-op at 0, monotonic at every strength, keeps black black, and the bright-pass knee is continuous.');
