// glfade — the light fade, as arithmetic.
//
// ⚠ THIS EXISTS BECAUSE A THROW IN THE GL WORLD PASS IS INVISIBLE TO EVERY OTHER GATE. The pass is
// wrapped in a catch that hands the world back to the 2-D renderer and puts `RENDER_TUNE.gl` to 0 —
// which is exactly right for a machine with no WebGL2, and exactly wrong as a way to find out the
// code is broken. `fadeLights` shipped for one iteration with `wanted.has(...)` called on an ARRAY:
// it threw on the first frame, every frame, and the city silently rendered on the fallback. Nothing
// noticed. `parse-smoke`, `imports:smoke`, `shapes:smoke`, `glmesh`, `glparity`, `glsl-smoke`,
// `floorfallback` and `framecost` were all green throughout, because none of them runs the pass —
// headless node has no WebGL2 context to run it with.
//
// The fade is the one part of that pass that is PURE: a list in, a Map of weights mutated, a list
// out, no GL and no canvas. So it is testable here, and this catches the whole class — a typo, a
// wrong collection type, a weight that never reaches 1, a Map that grows without bound.
//
//   node scripts/shapes/glfade.mjs
import { fadeLights, LIGHT_TUNE } from '../../client/game/js/panels/gl/world.js';
import { MAX_LIGHTS } from '../../client/game/js/panels/gl/context.js';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

// A ranked list the way pickLights hands it over: best first, each with a stable key.
const mk = (n, from = 0) => Array.from({ length: n }, (_, i) => ({
  key: from + i, p: [i, 0, 1], rgb: [1, 1, 1], r: 2, score: 1000 - (from + i),
}));
const bright = (list, key) => { const e = list && list.find((x) => x.key === key); return e ? e.rgb[0] : 0; };

const rise = LIGHT_TUNE.rise, fall = LIGHT_TUNE.fall;
check(rise > 0 && fall > 0, `the shipped fade times must be positive — rise ${rise}, fall ${fall}`);

// 1. A light rises to full and stops there, in about `rise` seconds.
{
  const st = new Map(), ranked = mk(1);
  let out = fadeLights(ranked, st, 0.016);
  check(bright(out, 0) > 0 && bright(out, 0) < 1, 'a light must not arrive at full brightness on its first frame');
  for (let t = 0; t < rise + 0.1; t += 0.016) out = fadeLights(ranked, st, 0.016);
  check(Math.abs(bright(out, 0) - 1) < 1e-9, `a held light must reach exactly full brightness — got ${bright(out, 0)}`);
  out = fadeLights(ranked, st, 0.016);
  check(Math.abs(bright(out, 0) - 1) < 1e-9, 'a light at full must stay at full rather than overshooting');
}

// 2. A light EVICTED FROM THE SLOTS — still in frame, just outscored — fades out and is then
//    forgotten. This is the case the whole thing exists for: flying past a lit street, the twelve
//    best lights turn over constantly and every eviction used to take a wall's wash with it.
{
  const st = new Map();
  const held = mk(MAX_LIGHTS);                        // keys 0..11, key 0 the best
  for (let t = 0; t < rise + 0.1; t += 0.016) fadeLights(held, st, 0.016);
  // Now key 0 is outscored by a newcomer and drops below the cut — but is still a candidate.
  const pushed = [...mk(MAX_LIGHTS, 100), { ...held[0], score: -1 }];
  let out = null, seen = 0;
  for (let t = 0; t < fall + 0.2; t += 0.016) { out = fadeLights(pushed, st, 0.016); if (bright(out, 0) > 0) seen++; }
  check(seen > 1, 'a light evicted from the slots must FADE, not vanish in one frame');
  check(bright(out, 0) === 0, 'a faded-out light must stop being drawn');
  check(!st.has(0), 'a faded-out light must be dropped from the weight map rather than leaking');
}

// 2b. A light that leaves the CANDIDATE list entirely — behind the eye, or out of the frame — is
//     dropped rather than faded, and that is deliberate: `pickLights` has already culled it, so
//     there is no position or colour left to draw it with. What must not happen is its weight
//     lingering, because then it would snap back to full the moment it reappeared.
{
  const st = new Map(), a = mk(1);
  for (let t = 0; t < rise + 0.1; t += 0.016) fadeLights(a, st, 0.016);
  check(st.get(0) === 1, 'precondition: the light is at full weight');
  for (let t = 0; t < fall + 0.2; t += 0.016) fadeLights(mk(1, 99), st, 0.016);
  check(!st.has(0), 'a light that left the frame must not keep a stale weight to snap back to');
}

// 3. The slot budget is never exceeded, however many lights are fading.
{
  const st = new Map();
  for (let t = 0; t < rise + 0.1; t += 0.016) fadeLights(mk(MAX_LIGHTS), st, 0.016);
  const out = fadeLights(mk(MAX_LIGHTS, 500), st, 0.016);   // a whole new set, all the old ones falling
  check(out.length <= MAX_LIGHTS, `the list handed to the shader must never exceed ${MAX_LIGHTS} — got ${out.length}`);
  check(out.some((e) => e.key >= 500), 'the newly wanted lights must get slots even while the old set is fading');
}

// 4. It survives the shapes the caller can actually produce, rather than throwing.
{
  const st = new Map();
  check(fadeLights([], st, 0.016) === null, 'an empty ranked list must answer null, not throw');
  check(fadeLights(mk(3), st, 0) !== undefined, 'a zero delta must be handled (two passes in one frame)');
  fadeLights(mk(300), st, 0.016);            // far more candidates than slots
  check(st.size <= 300, 'the weight map must not grow past the candidates it was given');
}

// 5. Rise 0 restores the instant swap exactly — the off switch the A/B measures against.
{
  const st = new Map(), saved = [LIGHT_TUNE.rise, LIGHT_TUNE.fall];
  LIGHT_TUNE.rise = 0; LIGHT_TUNE.fall = 0;
  const out = fadeLights(mk(2), st, 0.016);
  check(bright(out, 0) === 1, 'with rise 0 a light must be at full brightness on its first frame');
  [LIGHT_TUNE.rise, LIGHT_TUNE.fall] = saved;
}

if (problems.length) {
  console.error(`✗ glfade — ${problems.length} problem(s):`);
  for (const p of problems) console.error('    ' + p);
  console.error('\n  A throw here would otherwise show up as the whole city silently rendering on the 2-D fallback.');
  process.exit(1);
}
console.log(`✓ glfade: the light ramp rises to exactly full, fades out and forgets, never exceeds ${MAX_LIGHTS} slots, and restores the instant swap at rise 0.`);
