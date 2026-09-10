// modeldiff — does this model draw the same picture as that one?
//
//   node scripts/shapes/modeldiff.mjs type:foundry named:thefoundry     # compare any two
//   node scripts/shapes/modeldiff.mjs --ported                          # every ported model
//   node scripts/shapes/modeldiff.mjs --determinism                     # every model, twice
//
// THE QUESTION THIS ANSWERS, and why the port depends on it. ~145 building models are hand-written
// `case` arms. Moving one to authored data is only safe if you can show the replacement draws what
// the arm drew — and 145 arms cannot be reviewed by eye 145 times. "It looked right when I checked"
// is exactly how a subtle downgrade ships.
//
// ⚠ IT IS NOT NAMED pixdiff, AND THAT IS NOT A DETAIL. The design note called for a pixel
// comparison; this compares the DRAWING OPERATIONS instead. A real pixel diff in node needs a
// native canvas dependency and a build toolchain in CI, for a codebase whose whole premise is no
// build step. So a model is drawn against a recording context (captureModelTrace in windshield.js)
// and the recordings are compared: dependency-free, exact rather than thresholded, and sensitive to
// things a low-resolution pixel diff would miss.
//
// The cost, stated once: it OVER-reports. Two paths drawn in a different order make the same picture
// and different traces. That is the safe direction for a port gate — a false alarm costs a look, a
// false pass ships a worse building — but it means a non-zero distance is a QUESTION, not a verdict.
// The Modelshop's difference view answers it in real pixels, which is where a human should look.
import { loadWindshield } from './dom-stub.mjs';

// One camera is not a comparison. A model that matches head-on can be wrong from behind, wrong at
// night, wrong at another footprint, or wrong on a seed it never saw — so the matrix sweeps the
// five things a model is actually allowed to vary with. 48 cameras, about a second per pair.
export const MATRIX = [];
for (const night of [0, 0.85]) {
  for (const E of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (const [fh, h] of [[0.4, 1], [0.8, 1], [0.4, 2]]) {
      for (const seed of [1, 4]) {
        MATRIX.push({ night, E, fh, h, seed, heading: 35, dist: 6 + 5 * h, eyeH: 0.6 + 1.6 * h });
      }
    }
  }
}

const label = (o) => `night=${o.night} E=[${o.E}] fh=${o.fh} h=${o.h} seed=${o.seed}`;

// Compare two traces. Returns the op counts, the number of differing positions, and the FIRST
// divergence with both sides — which is the only part anybody reads when a port goes wrong.
export function diffTrace(a, b) {
  const n = Math.max(a.length, b.length);
  let differing = 0, first = -1;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) { differing++; if (first < 0) first = i; }
  }
  return {
    ops: a.length, otherOps: b.length, differing, first,
    distance: n ? differing / n : 0,
    aOp: first >= 0 ? a[first] : null,
    bOp: first >= 0 ? b[first] : null,
  };
}

// Sweep the matrix over one pair. Stops collecting detail after a few failures — a mismatched model
// differs at every camera, and forty copies of the same finding is not more information.
export function compareModels(ws, mA, mB, opts = {}) {
  const { matrix = MATRIX, name = '' } = opts;
  const failures = [];
  let worst = 0, cameras = 0;
  for (const cam of matrix) {
    const a = ws.captureModelTrace(mA, { ...cam, name });
    const b = ws.captureModelTrace(mB, { ...cam, name });
    const d = diffTrace(a, b);
    cameras++;
    if (d.distance > worst) worst = d.distance;
    if (d.differing && failures.length < 4) failures.push({ cam: label(cam), ...d });
  }
  return { cameras, worst, failures, same: worst === 0 };
}

// ── The determinism gate ────────────────────────────────────────────────────
// Rendering the same model twice at the same camera must produce the same trace. It is the
// precondition for every comparison above — a model that is not deterministic cannot be diffed at
// all, and the differ would report it as a failed port for ever.
//
// It is also worth having on its own. `Math.random` in an arm, or a read of the real clock, would
// silently make that building different on every frame, and nothing else here would notice: the
// capture harness already probes seeds, but it holds `now` fixed and never runs the same model
// twice at one camera.
export function determinismSweep(ws, matrix = MATRIX.slice(0, 6)) {
  const bad = [];
  for (const { key, m } of ws.shapeModelRegistry()) {
    for (const cam of matrix) {
      const a = ws.captureModelTrace(m, { ...cam, name: key });
      const b = ws.captureModelTrace(m, { ...cam, name: key });
      const d = diffTrace(a, b);
      if (d.differing) {
        bad.push(`${key} (${label(cam)}) draws differently on a second identical render — `
          + `first divergence at op ${d.first}: ${d.aOp} vs ${d.bOp}. Something in the arm reads the `
          + 'real clock or Math.random, which also means it cannot be diffed or ported.');
        break;
      }
    }
  }
  return bad;
}

// ── The ported-model gate ───────────────────────────────────────────────────
// An authored model carrying `portedFrom` claims to replace a hand-written arm. windshield keeps
// that arm reachable (LEGACY_MODELS), so the claim is checkable — and it is checked here, on every
// push, for as long as the arm exists.
export function portedSweep(ws, opts = {}) {
  const out = [];
  const legacy = ws.LEGACY_MODELS || {};
  for (const { key, m } of ws.shapeModelRegistry()) {
    if (m.type !== 'authored' || !m.portedFrom) continue;
    const old = legacy[key];
    if (!old) {
      out.push(`${key}: claims portedFrom '${m.portedFrom}' but no legacy arm is registered under that key`);
      continue;
    }
    if (old.type !== m.portedFrom) {
      out.push(`${key}: portedFrom says '${m.portedFrom}' but the arm it replaced is '${old.type}'`);
    }
    const r = compareModels(ws, old, m, { ...opts, name: key });
    // The threshold is per model and lives in the model's own file, so a port that is deliberately
    // "close enough" records HOW close and a later regression is a diff on a number.
    const allow = Number(m.pixdiff ?? 0);
    if (r.worst > allow) {
      const f = r.failures[0];
      out.push(`${key}: differs from the '${m.portedFrom}' arm on ${r.failures.length}+ of ${r.cameras} cameras `
        + `(worst ${(r.worst * 100).toFixed(1)}% of ops, allowed ${(allow * 100).toFixed(1)}%). `
        + `First at ${f.cam}, op ${f.first}: arm drew ${f.aOp}, authored drew ${f.bOp}`);
    }
  }
  return out;
}

async function main() {
  const ws = await loadWindshield();
  const argv = process.argv.slice(2);

  if (argv.includes('--determinism')) {
    const bad = determinismSweep(ws);
    for (const b of bad) console.error('  ✗ ' + b);
    console.log(bad.length ? `✗ modeldiff — ${bad.length} non-deterministic model(s).`
      : `✓ modeldiff — all ${ws.shapeModelRegistry().length} models render identically twice.`);
    process.exit(bad.length ? 1 : 0);
  }

  if (argv.includes('--ported')) {
    const bad = portedSweep(ws);
    for (const b of bad) console.error('  ✗ ' + b);
    const n = ws.shapeModelRegistry().filter((r) => r.m.type === 'authored' && r.m.portedFrom).length;
    console.log(bad.length ? `✗ modeldiff — ${bad.length} ported model(s) do not match the arm they replaced.`
      : `✓ modeldiff — ${n} ported model(s) match the arms they replaced, across ${MATRIX.length} cameras.`);
    process.exit(bad.length ? 1 : 0);
  }

  const [ka, kb] = argv;
  if (!ka || !kb) {
    console.error('usage: node scripts/shapes/modeldiff.mjs <keyA> <keyB> | --ported | --determinism');
    console.error('  keys look like `type:foundry` or `named:halcyontowers` (shapeModelRegistry)');
    process.exit(2);
  }
  const reg = ws.shapeModelRegistry();
  const find = (k) => reg.find((r) => r.key === k)?.m;
  const mA = find(ka), mB = find(kb);
  for (const [k, m] of [[ka, mA], [kb, mB]]) if (!m) { console.error(`no such model: ${k}`); process.exit(2); }

  const r = compareModels(ws, mA, mB, { name: ka });
  console.log(`${ka}  vs  ${kb}`);
  console.log(`  ${r.cameras} cameras · worst divergence ${(r.worst * 100).toFixed(1)}% of operations`);
  if (r.same) { console.log('  ✓ identical everywhere'); return; }
  for (const f of r.failures) {
    console.log(`  ✗ ${f.cam} — ${f.differing}/${Math.max(f.ops, f.otherOps)} ops differ (${f.ops} vs ${f.otherOps})`);
    console.log(`      first at ${f.first}: ${f.aOp}`);
    console.log(`                    ${' '.repeat(String(f.first).length)}  ${f.bOp}`);
  }
  console.log('\n  Remember this over-reports: a different draw ORDER is a different trace and the same');
  console.log('  picture. Open both in the Modelshop and use the difference view to judge it.');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
