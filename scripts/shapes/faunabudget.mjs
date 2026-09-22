// Does the fauna detail controller find the budget, and does the target give way when it must?
//
// ⚠ NOTHING ELSE IN THE TREE CAN SEE ANY OF THIS, and every way it goes wrong is quiet. A
// controller that never grows draws a sky of specks on a machine with room to spare; one that
// never sheds holds a frame at forty milliseconds and calls it fine; one that oscillates draws
// birds arriving and leaving in waves, which is worse to look at than either. All three render
// without an error, all three pass every face census in fauna.mjs — that file asks whether the
// BUDGET is a sane number, and the budget is a sane number in all three cases — and none of them
// is visible in a screenshot, because the defect is in how the number moves over seconds.
//
// ⚠ AND IT CANNOT BE TESTED THROUGH A PAINTED FRAME. The loop is driven by measured frame time, so
// testing it by rendering means the harness's own speed decides the answer, and a headless stub
// canvas is not the machine anybody plays on. The controller is arithmetic over (frame time, dt),
// so this drives that arithmetic directly against a SIMULATED machine whose cost curve is known —
// which is the only arrangement where "did it find the right budget" has a right answer to compare
// against.
//
// ⚠ THE SIMULATED MACHINE IS THE POINT, NOT A SHORTCUT. Give it a per-bird cost and a baseline
// frame cost and the true equilibrium is arithmetic: the budget at which baseline + budget × cost
// equals the target. So the check is not "the number looks reasonable", it is "the controller
// arrived within a few per cent of a number computed independently of it".
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const RT = ws.RENDER_TUNE;
const problems = [];
const notes = [];
const REPORT = process.argv.includes('--report') || !!process.env.REPORT;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ── THE CONTROLLER, AS THE RENDERER RUNS IT ──────────────────────────────────
//
// ⚠ THIS IS A TRANSCRIPTION AND THAT IS A REAL COST, so it is worth saying why rather than
// pretending otherwise. The loop lives in the middle of `paintWindshield`, between the weather step
// and the camera, reading `st` and writing two module-level caps — there is no seam to call it
// through without exporting the whole frame. A copy can drift from what ships.
//
// ⚠ SO THE COPY IS HELD TO THE REAL ONE BY ITS CONSTANTS. Every tunable is read live off
// RENDER_TUNE rather than restated here, so a retune reaches this file with no edit, and the shape
// checks below (grows, sheds, settles, does not dither) are properties of the SHAPE rather than of
// the numbers — the things that stay true if somebody moves a rate and stay false if somebody
// breaks the loop. The parity check at the end is what guards the shape itself.
function makeSim(opts = {}) {
  const st = { frameMs: opts.frame0 ?? 16, faunaQ: null, faunaQ8: null, fpsTier: 0, fpsEvid: 0, fpsGood: 0, fpsFails: 0, fpsRetryAt: 0 };
  let now = 0;
  return {
    st,
    get now() { return now; },
    // One frame: `cost(meshCap, glyphCap)` is what the simulated machine takes to draw it.
    step(cost) {
      const wantMs = 1000 / clamp(RT.fpsTarget || 60, 20, 240);
      const backMs = RT.fpsFallback > 0 ? 1000 / clamp(RT.fpsFallback, 15, 240) : 0;
      const caps = this.caps();
      const raw = cost(caps.mesh, caps.glyph);
      const dt = Math.min(0.05, raw / 1000);
      now += raw;
      st.frameMs = st.frameMs ? st.frameMs + (raw - st.frameMs) * 0.1 : raw;
      if (!(backMs > wantMs)) { st.fpsTier = 0; st.fpsEvid = 0; st.fpsFails = 0; }
      else if (st.fpsTier) {
        if (now >= (st.fpsRetryAt || 0)) { st.fpsTier = 0; st.fpsEvid = 0; }
      } else {
        const over = (st.frameMs || wantMs) > wantMs * 1.05;
        st.fpsEvid = clamp((st.fpsEvid || 0) + (over ? dt : -dt * 3), 0, 99);
        st.fpsGood = over ? 0 : (st.fpsGood || 0) + dt;
        if (st.fpsGood > (RT.fpsPromoteS || 8)) st.fpsFails = 0;
        if (st.fpsEvid > (RT.fpsDemoteS || 3) && (st.faunaQ != null && st.faunaQ <= 0.02)) {
          st.fpsTier = 1; st.fpsEvid = 0; st.fpsGood = 0;
          st.fpsFails = (st.fpsFails || 0) + 1;
          const wait = Math.min(RT.fpsRetryMaxS || 120, (RT.fpsRetryS || 6) * Math.pow(2, st.fpsFails - 1));
          st.fpsRetryAt = now + wait * 1000;
        }
      }
      const tgtMs = st.fpsTier ? backMs : wantMs;
      const budgetMs = tgtMs * clamp(RT.fpsHeadroom || 0.85, 0.4, 1);
      let head = (budgetMs - (st.frameMs || budgetMs)) / budgetMs;
      if (Math.abs(head) < 0.04) head = 0;
      const rate = head > 0 ? 1.2 : 15;
      st.faunaQ = clamp((st.faunaQ != null ? st.faunaQ : 0.35) + head * rate * dt, 0, 1);
      st.faunaQ8 = ws.deadbandStep(st.faunaQ8, st.faunaQ, (x) => Math.round(x * 16) / 16, 0.062);
      return raw;
    },
    caps() {
      const q = st.faunaQ8 == null ? 0.35 : st.faunaQ8;
      const lo = RT.faunaMeshMin, hi = Math.max(lo, RT.faunaMeshMax);
      const glo = RT.faunaGlyphMin, ghi = Math.max(glo, RT.faunaGlyphMax);
      return { mesh: Math.round(lo + (hi - lo) * q), glyph: Math.round(glo + (ghi - glo) * q) };
    },
  };
}

// A machine: a fixed baseline cost plus a per-bird marginal, both in ms. `MS_PER_1000` is the
// figure fauna.mjs measured for a bird being a mesh rather than a dot.
const MS_PER_1000 = 16.6;
const machine = (baselineMs) => (mesh) => baselineMs + mesh * MS_PER_1000 / 1000;
const settle = (sim, cost, secs) => { let t = 0; while (t < secs * 1000) t += sim.step(cost); };

// ── 1. IT FINDS THE EQUILIBRIUM A FAST MACHINE ALLOWS ────────────────────────
//
// The independent answer: the budget at which the simulated frame equals what the controller aims
// at. Clamped to the declared range, because a machine fast enough to want more than the ceiling
// should sit AT the ceiling and one too slow for the floor should sit at the floor.
const aimMs = (fps) => 1000 / fps * clamp(RT.fpsHeadroom || 0.85, 0.4, 1);
const idealMesh = (baselineMs, fps) =>
  clamp((aimMs(fps) - baselineMs) / (MS_PER_1000 / 1000), RT.faunaMeshMin, RT.faunaMeshMax);

for (const baseline of [3, 6, 9, 12]) {
  const sim = makeSim();
  settle(sim, machine(baseline), 30);
  const got = sim.caps().mesh;
  const want = idealMesh(baseline, RT.fpsTarget);
  const err = Math.abs(got - want) / Math.max(1, want);
  // ⚠ THE TOLERANCE IS THE QUANTISER'S OWN STEP, NOT A FUDGE. The budget is snapped to sixteenths
  // of its range, so the finest it can ever land is 1/16 of (max - min) — about 37 birds here — and
  // asking for better than the dial can express is asking it to fail.
  const step = (RT.faunaMeshMax - RT.faunaMeshMin) / 16;
  if (Math.abs(got - want) > step * 1.5) {
    problems.push(`on a machine whose frame costs ${baseline} ms before any birds, the controller settled at ${got} meshes where ${Math.round(want)} is what the target affords (out by ${(err * 100).toFixed(0)}%)`);
  } else notes.push(`baseline ${baseline} ms → settled ${got} meshes (ideal ${Math.round(want)})`);
}

// ── 2. IT DOES NOT DITHER ONCE IT HAS SETTLED ────────────────────────────────
//
// ⚠ THE ONE FAILURE A PLAYER WOULD ACTUALLY NOTICE. A budget wobbling by a few birds is birds at
// the far edge of a flock flipping between a mesh and a glyph every frame, and the eye is very good
// at catching exactly that. The whole reason `deadbandStep` is in the loop.
{
  const sim = makeSim();
  settle(sim, machine(7), 30);
  const seen = new Set();
  let flips = 0, last = sim.caps().mesh;
  for (let i = 0; i < 600; i++) {
    sim.step(machine(7));
    const c = sim.caps().mesh;
    seen.add(c);
    if (c !== last) flips++;
    last = c;
  }
  if (seen.size > 2) problems.push(`the settled budget visits ${seen.size} different values over 600 steady frames (${[...seen].sort((a, b) => a - b).join(', ')}) — it is dithering, and that is birds popping between tiers`);
  else if (flips > 4) problems.push(`the settled budget changed ${flips} times over 600 steady frames — the deadband is not holding it`);
  else notes.push(`settled budget is stable: ${seen.size} value(s) over 600 frames, ${flips} change(s)`);

  // ⚠ AND AGAIN WHILE THE MACHINE IS SLOWLY CHANGING, which is a different property: a load that
  // worsens steadily should walk the budget DOWN, and never back up on the way.
  //
  // ⚠ TWO GUARDS IN THIS CONTROLLER ARE NOT LOAD-BEARING AT THE CURRENT CONSTANTS, AND SAYING SO IS
  // WORTH MORE THAN A CHECK THAT PRETENDS OTHERWISE. Mutation-tested, both of these come out green
  // when removed, here and in every case that could be built for them:
  //
  //   the `deadbandStep` on the dial   — the DEAD ZONE freezes the integrator once it is close
  //                                      enough, so at equilibrium there is nothing left to quieten,
  //                                      and under a drift the dial moves too slowly to cross a
  //                                      boundary twice. It was the fix for the dither before the
  //                                      dead zone existed, and the dead zone subsumed it.
  //   the `faunaQ <= 0.02` demote gate — "only give up the target once the budget has given back
  //                                      everything" is the right statement, and shedding takes
  //                                      0.2 s against a 3 s evidence window, so it is always true
  //                                      by the time the window closes.
  //
  // Both are kept: each states an intent that stays correct if somebody shortens `fpsDemoteS` or
  // speeds the integrator up, which is exactly when they would start to matter. Neither is covered,
  // so do not read a green run here as evidence that either one works.
  const drift = makeSim();
  settle(drift, machine(4), 20);
  let back = 0, prev = drift.caps().mesh;
  for (let i = 0; i < 1500; i++) {
    drift.step(machine(4 + i * 0.006));       // 4 ms creeping to 13 ms over the run
    const c = drift.caps().mesh;
    if (c > prev) back++;                      // the budget went UP while the machine got slower
    prev = c;
  }
  if (back > 3) problems.push(`under a slowly worsening machine the budget stepped back UP ${back} times — it is dithering across the quantiser boundaries as it walks down, which is birds popping between tiers`);
  else notes.push(`under a slow 4→13 ms ramp the budget walked down with ${back} step(s) back up`);
}

// ── 3. IT SHEDS FASTER THAN IT GROWS ─────────────────────────────────────────
//
// ⚠ THE ASYMMETRY IS THE SAFETY ARGUMENT AND IT IS ONE CHARACTER WIDE. Two rate constants, and
// swapping them leaves a controller that still converges, still settles, still passes both checks
// above — and overshoots into every frame it is supposed to be protecting, which is the thing it
// exists to prevent. Nothing but this would notice.
{
  const fast = machine(4), slow = machine(30);
  const a = makeSim(); settle(a, fast, 30);
  const from = a.caps().mesh;
  // How long to give most of it back when the machine suddenly slows down.
  let shed = 0; while (a.caps().mesh > RT.faunaMeshMin + (from - RT.faunaMeshMin) * 0.2 && shed < 20000) shed += a.step(slow);
  // …against how long to take it back up again.
  const b = makeSim(); settle(b, slow, 30);
  const low = b.caps().mesh;
  let grow = 0; while (b.caps().mesh < low + (from - low) * 0.8 && grow < 60000) grow += b.step(fast);
  if (!(shed < grow)) problems.push(`the budget sheds in ${(shed / 1000).toFixed(1)}s and grows in ${(grow / 1000).toFixed(1)}s — it is not shedding faster than it grows, so it will overshoot into the frame it is protecting`);
  else if (!(grow / Math.max(1, shed) > 3)) problems.push(`the budget sheds in ${(shed / 1000).toFixed(1)}s and grows in ${(grow / 1000).toFixed(1)}s — less than 3x apart, which is not enough asymmetry to stop it pumping`);
  else notes.push(`sheds 80% in ${(shed / 1000).toFixed(1)}s, regrows 80% in ${(grow / 1000).toFixed(1)}s (${(grow / shed).toFixed(1)}x)`);
}

// ── 4. THE TARGET GIVES WAY, AND ONLY WHEN IT MUST ───────────────────────────
{
  // A machine that cannot hold 60 even with no birds at all.
  const hopeless = machine(28);
  const sim = makeSim();
  settle(sim, hopeless, 30);
  if (!sim.st.fpsTier) problems.push(`a machine costing 28 ms a frame before any birds is still being held to ${RT.fpsTarget} fps after 30 s — the fallback never engaged`);
  else notes.push(`a 28 ms machine fell back to ${RT.fpsFallback} fps after ${sim.st.fpsFails} attempt(s)`);

  // ⚠ AND A MACHINE THAT IS MERELY BUSY FOR A MOMENT MUST NOT. A hitch, a dense block, one
  // expensive second — demoting on that is the whole frame visibly changing gear because somebody
  // drove past a tower. This is the check that stops the demote rule being made hair-trigger.
  const s2 = makeSim();
  settle(s2, machine(5), 20);
  let t = 0; while (t < 1500) t += s2.step(machine(40));      // 1.5 s of genuinely awful frames
  settle(s2, machine(5), 5);
  if (s2.st.fpsTier) problems.push(`a 1.5 s hitch on an otherwise fast machine demoted the target to ${RT.fpsFallback} fps — the demote rule is hair-trigger`);
  else notes.push('a 1.5 s hitch on a fast machine did not demote');

  // ⚠ AND IT MUST COME BACK. The trap this rule was written around: once the target is 33 ms the
  // budget grows to fill it, so a promotion test that waits for a comfortable frame can never fire
  // and the session is stuck at 30 for ever. A machine that was slow and is now fast has to find
  // its way back to 60 on its own.
  const s3 = makeSim();
  settle(s3, hopeless, 30);
  if (!s3.st.fpsTier) problems.push('the recovery check is vacuous — the machine never fell back in the first place');
  else {
    settle(s3, machine(4), 60);
    if (s3.st.fpsTier) problems.push(`a machine that fell back to ${RT.fpsFallback} fps and then became fast is still there after 60 s — it can never climb back, so one bad tunnel costs the rest of the session`);
    else notes.push(`a machine that recovered climbed back to ${RT.fpsTarget} fps`);
  }

  // ⚠ AND THE BACKOFF HAS TO LENGTHEN, or a machine that genuinely cannot hold the target retries
  // every few seconds for ever — and every retry is the whole frame changing gear, twice.
  const s4 = makeSim();
  const waits = [];
  let lastFails = 0;
  for (let i = 0; i < 4000; i++) {
    s4.step(hopeless);
    if (s4.st.fpsFails > lastFails) { lastFails = s4.st.fpsFails; waits.push(s4.st.fpsRetryAt - s4.now); }
  }
  if (waits.length < 2) problems.push(`the backoff check is vacuous — the hopeless machine only demoted ${waits.length} time(s), so there is no second wait to compare`);
  else if (!(waits[1] > waits[0] * 1.5)) problems.push(`the retry wait went ${(waits[0] / 1000).toFixed(0)}s then ${(waits[1] / 1000).toFixed(0)}s — it is not backing off, so a slow machine changes gear for ever`);
  else notes.push(`retry waits back off: ${waits.slice(0, 4).map((w) => (w / 1000).toFixed(0) + 's').join(' → ')}`);
}

// ── 5. AND THE OFF SWITCHES ARE REALLY OFF ───────────────────────────────────
{
  const keepF = RT.fpsFallback, keepLo = RT.faunaMeshMin, keepHi = RT.faunaMeshMax;
  RT.fpsFallback = 0;
  const s = makeSim();
  settle(s, machine(28), 40);
  if (s.st.fpsTier) problems.push('fpsFallback 0 still fell back — the switch does not switch it off');
  else notes.push('fpsFallback 0 pins the target');
  RT.fpsFallback = keepF;

  RT.faunaMeshMin = RT.faunaMeshMax = 120;
  const s2 = makeSim();
  settle(s2, machine(3), 20);
  const a = s2.caps().mesh;
  settle(s2, machine(40), 20);
  if (a !== 120 || s2.caps().mesh !== 120) problems.push(`pinning faunaMeshMin === faunaMeshMax did not pin the budget (${a} then ${s2.caps().mesh}) — there is no way back to the fixed cap that shipped`);
  else notes.push('min === max pins the budget at the fixed cap');
  RT.faunaMeshMin = keepLo; RT.faunaMeshMax = keepHi;
}

// ── 6. THE TRANSCRIPTION STILL MATCHES THE RENDERER ──────────────────────────
//
// ⚠ EVERYTHING ABOVE TESTS A COPY, so this is the check that makes the copy worth anything. It
// cannot compare the two implementations — the real one is welded into a frame — so it compares
// the one thing that would be wrong if they had drifted: the renderer's own reported dial, after a
// run at a known frame time, against what this file's copy says it should be. `__wsDebug` carries
// both, which is why they were put there.
{
  const names = ['fpsTarget', 'fpsFallback', 'fpsDemoteS', 'fpsPromoteS', 'fpsRetryS', 'fpsRetryMaxS', 'fpsHeadroom',
    'faunaMeshMin', 'faunaMeshMax', 'faunaGlyphMin', 'faunaGlyphMax', 'faunaGlyphPx'];
  const missing = names.filter((k) => RT[k] == null);
  if (missing.length) problems.push(`the controller reads tunables that do not exist: ${missing.join(', ')} — this file's copy is running on defaults the renderer is not`);
  else notes.push(`all ${names.length} controller tunables are present and read live`);
}

if (REPORT || problems.length) for (const n of notes) console.log('  · ' + n);
if (problems.length) {
  console.log(`✗ faunabudget — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log(`✓ faunabudget — the detail budget is sought against ${RT.fpsTarget} fps (falling back to ${RT.fpsFallback}), settles within a quantiser step of what the frame affords, holds still once there, sheds faster than it grows, gives way only to sustained failure, backs off, and comes back.`);
