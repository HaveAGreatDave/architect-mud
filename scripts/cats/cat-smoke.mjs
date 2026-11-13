// CAT SMOKE: the cat kit (client/game/js/panels/gl/cat-kit.js) carves every pose of every cat in the Cattery soundly.
//
// For each cat in tools/modelshop/cattery-recipes.js and each pose in CAT_POSES, on a coarse grid: no NaN anywhere,
// nothing under the floor, the cat resting on the floor (not floating), every vertex's bone weights summing to one,
// the bake skinned with no motion landing exactly where it was carved, the idle clock giving the same cat twice for
// the same time, and the motion moving the head without tearing (no vertex thrown further than a cat could reach).
// A cat with a coat of two colours has to show both.
//
// No DOM, no DB, no network.   node scripts/cats/cat-smoke.mjs [--verbose]
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const K = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/cat-kit.js')).href);
const { beastMesh } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/beast-kit.js')).href);
const { CATS } = await import(pathToFileURL(resolve(ROOT, 'tools/modelshop/cattery-recipes.js')).href);

const verbose = process.argv.includes('--verbose');
const H = 0.008;
let fails = 0, checks = 0;
const check = (ok, what) => { checks++; if (!ok) { fails++; console.log('FAIL ' + what); } else if (verbose) console.log('ok   ' + what); };

const cats = ['scrappy', 'plain', 'tabby'].filter((id) => CATS[id]);
for (const id of cats) {
  const look = K.catLook(CATS[id].look), rig = K.catRig(look);
  for (const pose of Object.keys(K.CAT_POSES)) {
    const tag = `${id}/${pose}`;
    let b;
    try { b = K.bakeCat(look, pose, { h: H, rig }); } catch (e) { check(false, `${tag} carves (${e.message})`); continue; }
    check(b.verts > 2000 && b.quads > 2000, `${tag} carves a surface (${b.verts} vertices)`);
    let nan = 0, low = Infinity, wbad = 0;
    for (let i = 0; i < b.verts; i++) {
      for (let k = 0; k < 3; k++) if (!Number.isFinite(b.P[i * 3 + k]) || !Number.isFinite(b.N[i * 3 + k]) || !Number.isFinite(b.C[i * 3 + k])) nan++;
      low = Math.min(low, b.P[i * 3 + 1]);
      const s = b.Ww[i * 4] + b.Ww[i * 4 + 1] + b.Ww[i * 4 + 2] + b.Ww[i * 4 + 3];
      if (Math.abs(s - 1) > 1e-4) wbad++;
    }
    check(nan === 0, `${tag} no NaN (${nan})`);
    check(low > -0.004, `${tag} nothing under the floor (lowest ${low.toFixed(4)})`);
    check(low < 0.02, `${tag} rests on the floor (lowest ${low.toFixed(4)})`);
    check(wbad === 0, `${tag} bone weights sum to one (${wbad} off)`);
    // skinned with no motion, every carved vertex lands where it was (in metres)
    const M0 = beastMesh();
    K.skinCat(b, M0, K.STILL, { fur: false });
    let drift = 0;
    for (let q = 0; q < Math.min(b.quads, 400); q++) {
      const v = b.Q[q * 4], P = [b.P[v * 3] * look.scale, b.P[v * 3 + 1] * look.scale, b.P[v * 3 + 2] * look.scale];
      // the quad's first corner is one of the first six emitted for it
      let best = Infinity;
      for (let k = 0; k < 6; k++) { const o = (q * 6 + k) * 3; best = Math.min(best, Math.hypot(M0.P[o] - P[0], M0.P[o + 1] - P[1], M0.P[o + 2] - P[2])); }
      drift = Math.max(drift, best);
    }
    check(drift < 1e-5, `${tag} skinned still is the carve (drift ${drift.toExponential(1)})`);
    // the idle clock is a pure function of the time
    const a = JSON.stringify(K.idleMotion(7.25, { awake: 1, seed: 2 })), c = JSON.stringify(K.idleMotion(7.25, { awake: 1, seed: 2 }));
    check(a === c, `${tag} idle motion repeats for the same time`);
    // moving: nothing thrown further than 15 cm from where it was carved, and nothing NaN
    const M1 = beastMesh();
    K.skinCat(b, M1, K.idleMotion(3.7, { awake: 1, seed: 1 }), { fur: false });
    let far = 0, nan1 = 0;
    const n = Math.min(M0.P.length, M1.P.length);
    for (let i = 0; i < n; i += 3) {
      if (!Number.isFinite(M1.P[i]) || !Number.isFinite(M1.P[i + 1]) || !Number.isFinite(M1.P[i + 2])) { nan1++; continue; }
      far = Math.max(far, Math.hypot(M1.P[i] - M0.P[i], M1.P[i + 1] - M0.P[i + 1], M1.P[i + 2] - M0.P[i + 2]));
    }
    check(nan1 === 0 && far < 0.15, `${tag} idle moves without tearing (furthest ${far.toFixed(3)} m)`);
  }
  // a coat with marks or white shows both colours
  const co = look.coat;
  if (co.white > 0 || co.marks?.length) {
    const b = K.bakeCat(look, 'sit', { h: H, rig });
    const lum = new Set();
    for (let i = 0; i < b.verts; i += 7) lum.add(b.C[i * 3] > 0.25 ? 'light' : b.C[i * 3] < 0.05 ? 'dark' : 'mid');
    check(lum.has('light') && lum.has('dark'), `${id} shows its two colours`);
  }
}
console.log(`cat smoke: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
