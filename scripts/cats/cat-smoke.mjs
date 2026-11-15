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
// Each cat's bake of each pose, carved once: the coat check and the clips below read the same bakes (nothing here
// writes to a bake), and carving them again was a third of this gate's CPU.
const baked = new Map();
for (const id of cats) {
  const look = K.catLook(CATS[id].look), rig = K.catRig(look);
  for (const pose of Object.keys(K.CAT_POSES)) {
    const tag = `${id}/${pose}`;
    let b;
    try { b = K.bakeCat(look, pose, { h: H, rig }); baked.set(tag, b); } catch (e) { check(false, `${tag} carves (${e.message})`); continue; }
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
    // nothing on the body rides the head or an ear: a piece whose field goes flat far from it claims distant vertices
    // (an ear once took the top of the thigh, coat and all, and would have swung it about with every flick)
    {
      const R = b.rig, Xh = b.X[R.index.head], hc = [0, 1, 2].map((k) => Xh.R[k * 3] * R.HC[0] + Xh.R[k * 3 + 1] * R.HC[1] + Xh.R[k * 3 + 2] * R.HC[2] + Xh.t[k]);
      let stray = 0;
      for (let v = 0; v < b.verts; v++) for (let k = 0; k < 4; k++) {
        if (b.Ww[v * 4 + k] < 0.05) continue;
        const g = R.bones[b.Wb[v * 4 + k]].group;
        if ((g === 'ear' || g === 'head') && Math.hypot(b.P[v * 3] - hc[0], b.P[v * 3 + 1] - hc[1], b.P[v * 3 + 2] - hc[2]) > 0.25 * R.HS) { stray++; break; }
      }
      check(stray === 0, `${tag} no body vertex rides the head or an ear (${stray})`);
    }
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
    // the carved body only: the eyes, lids and whiskers come after it, and a blink adds lid quads, which shifts every
    // index past them, so comparing those compares different vertices
    const n = Math.min(b.quads * 6 * 3, M0.P.length, M1.P.length);
    for (let i = 0; i < n; i += 3) {
      if (!Number.isFinite(M1.P[i]) || !Number.isFinite(M1.P[i + 1]) || !Number.isFinite(M1.P[i + 2])) { nan1++; continue; }
      far = Math.max(far, Math.hypot(M1.P[i] - M0.P[i], M1.P[i + 1] - M0.P[i + 1], M1.P[i + 2] - M0.P[i + 2]));
    }
    check(nan1 === 0 && far < 0.15, `${tag} idle moves without tearing (furthest ${far.toFixed(3)} m)`);
  }
  // a coat with marks or white shows both colours
  const co = look.coat;
  if (co.white > 0 || co.marks?.length) {
    const b = baked.get(`${id}/sit`) || K.bakeCat(look, 'sit', { h: H, rig });
    const lum = new Set();
    for (let i = 0; i < b.verts; i += 7) lum.add(b.C[i * 3] > 0.25 ? 'light' : b.C[i * 3] < 0.05 ? 'dark' : 'mid');
    check(lum.has('light') && lum.has('dark'), `${id} shows its two colours`);
  }
}

// ── the breeds and the coats past white and tabby (gl/cat-breeds.js) ────────────────────────────────────────────
// Every breed builds a rig with finite joints; and one coarse carve each of a colourpoint, a calico and a ticked coat
// shows what the gene is for: dark points on a pale cat, the red and the black, and a speckle in the ground colour.
{
  const { BREEDS } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/cat-breeds.js')).href);
  for (const breed of Object.keys(BREEDS)) {
    const R = K.catRig(K.catLook({ breed }));
    check(R.bones.every((b) => b.j.every(Number.isFinite)) && R.ears.every((e) => e.E.lynxTip().every((s) => s.every((p) => p.every(Number.isFinite)))), `breed ${breed} builds a rig`);
  }
  const hues = (b) => {
    const out = { dark: 0, pale: 0, red: 0, black: 0, spread: 0 }, lum = [];
    for (let i = 0; i < b.verts; i += 3) {
      const [r, g, bl] = [b.C[i * 3], b.C[i * 3 + 1], b.C[i * 3 + 2]], l = (r + g + bl) / 3;
      if (!Number.isFinite(l)) return null;
      if (l < 0.04) out.dark++; else if (l > 0.4) out.pale++;
      if (r > 0.18 && r > 2.2 * bl) out.red++;
      if (l < 0.02) out.black++;
      lum.push(l);
    }
    const m = lum.reduce((s, x) => s + x, 0) / lum.length;
    out.spread = Math.sqrt(lum.reduce((s, x) => s + (x - m) ** 2, 0) / lum.length) / m;
    return out;
  };
  const point = hues(K.bakeCat(K.catLook({ breed: 'siamese' }), 'sit', { h: 0.016 }));
  check(point && point.dark > 50 && point.pale > 200, `a colourpoint has dark points on a pale cat (${JSON.stringify(point)})`);
  const calico = hues(K.bakeCat(K.catLook({ coat: { colour: 'calico', seed: 21 } }), 'sit', { h: 0.016 }));
  check(calico && calico.red > 50 && calico.black > 50 && calico.pale > 50, `a calico shows red, black and white (${JSON.stringify(calico)})`);
  const plain = hues(K.bakeCat(K.catLook({ coat: { base: '#94552e' } }), 'sit', { h: 0.016 }));
  const ticked = hues(K.bakeCat(K.catLook({ breed: 'abyssinian' }), 'sit', { h: 0.016 }));
  check(ticked && plain && ticked.spread > plain.spread * 1.5, `a ticked coat is speckled (spread ${ticked?.spread.toFixed(2)} against ${plain?.spread.toFixed(2)})`);
}

// ── the clips on the GPU's path (gl/cat-clips.js, gl/cat-gpu.js), for the first cat ──────────────────────────────
// The GPU buffer skinned still is the carve; every clip at a few moments gives finite bones, keeps the cat in one
// piece (nothing further than 60 cm from where it was carved, a gallop's reach) and nothing more than 3 cm under the
// floor; and the room's shaders take the skin.
{
  const G = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/cat-gpu.js')).href);
  const C = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/cat-clips.js')).href);
  const look = K.catLook(CATS[cats[0]].look), rig = K.catRig(look), bakes = {};
  for (const p of ['stand', 'sit', 'loaf', 'curl']) bakes[p] = baked.get(`${cats[0]}/${p}`) || K.bakeCat(look, p, { h: H, rig });
  const place = { O: [0, 0, 0], F: [0, 0, 1] };
  for (const [p, b] of Object.entries(bakes)) {
    const m = G.catBodyMesh(b);
    check(m.index.every((v) => v < m.verts) && m.fur.every((f) => f.index.every((v) => v < m.verts) && f.layers >= 2 && f.layers <= 8), `gpu/${p} indices in range, ${m.fur.map((f) => f.layers).join('+')} fur layers`);
    const still = G.skinOnCpu(m, K.catBoneRows(b, K.solveRig(b.rig, b.pose, K.STILL), place));
    let drift = 0;
    for (let i = 0; i < Math.min(2000, m.index.length); i++) {
      const v = m.index[i];
      drift = Math.max(drift, Math.hypot(still.data[i * 12] - b.P[v * 3] * look.scale, still.data[i * 12 + 1] - b.P[v * 3 + 1] * look.scale, still.data[i * 12 + 2] - b.P[v * 3 + 2] * look.scale));
    }
    check(drift < 1e-5, `gpu/${p} skinned still is the carve (drift ${drift.toExponential(1)})`);
    for (const part of G.BIT_PARTS) check(G.catBitsMesh(b, K.STILL, part).verts > 0 || part === 'lids', `gpu/${p} ${part} built`);
  }
  // one fur-less body and its rest skin per base pose, shared by the clips carved off it
  const bodies = new Map();
  const bodyOf = (base) => {
    if (!bodies.has(base)) {
      const b = bakes[base], m = G.catBodyMesh(b, { fur: false });
      bodies.set(base, { m, rest: G.skinOnCpu(m, K.catBoneRows(b, K.solveRig(b.rig, b.pose, K.STILL), place)) });
    }
    return bodies.get(base);
  };
  for (const name of C.CLIP_NAMES) {
    const c = C.CAT_CLIPS[name], b = bakes[c.base], { m, rest } = bodyOf(c.base);
    let bad = 0, far = 0, low = Infinity;
    for (const t of [0.6, 1.6, 3.9]) {
      const f = C.clipFrame(b.rig, name, t, { seed: 1 }), rows = K.catBoneRows(b, K.solveRig(b.rig, f.pose, f.mo), place);
      if (rows.some((v) => !Number.isFinite(v))) { bad++; continue; }
      const s = G.skinOnCpu(m, rows);
      for (let i = 0; i < s.n; i += 11) {
        far = Math.max(far, Math.hypot(s.data[i * 12] - rest.data[i * 12], s.data[i * 12 + 1] - rest.data[i * 12 + 1], s.data[i * 12 + 2] - rest.data[i * 12 + 2]));
        low = Math.min(low, s.data[i * 12 + 1]);
      }
    }
    check(bad === 0, `clip ${name} gives finite bones`);
    check(far < 0.6, `clip ${name} keeps the cat in one piece (furthest ${far.toFixed(2)} m)`);
    check(low > -0.03, `clip ${name} stays out of the floor (lowest ${low.toFixed(3)} m)`);
  }
  // every sound a clip names is a field recording of the right kind: a bed loops, a call has its slices
  const { FIELD } = await import(pathToFileURL(resolve(ROOT, 'client/shared/field-recordings.js')).href);
  for (const [name, c] of Object.entries(C.CAT_CLIPS)) {
    if (c.sound?.bed) check(!!FIELD[c.sound.bed]?.loop, `clip ${name}'s bed ${c.sound.bed} is a loop`);
    for (const s of c.sound?.calls || []) for (const k of s.keys) check(!!FIELD[k]?.slices?.length, `clip ${name}'s call ${k} has its calls`);
  }
  const { INK_VS } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/ink.js')).href);
  const { BEAST_VS } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/beast-light.js')).href);
  for (const [k, vs] of [['ink', INK_VS], ['beast', BEAST_VS]]) {
    const s = G.skinVariant(vs);
    check(s.includes('catSkin();') && !/in vec3 aPos;/.test(s) && /in vec3 aPos0;/.test(s) && /in float \w+0;/.test(s), `the ${k} shader takes the skin`);
  }
}
console.log(`cat smoke: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
