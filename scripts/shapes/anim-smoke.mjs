// Anim smoke: Deadball's rig and its skinned players, checked without a GPU.
//
// The players in the 3-D park (docs/proposals/deadball-glass2.md, Phase 2) are built once in the
// rig's bind pose and skinned on the GPU into every pose after (diamond/rig.js, gl/skin.js,
// gl/ballplayer-mesh.js buildBody). Node has no GPU, so this skins them on the CPU with the same
// sum the shader does (skinPoint) and holds the result to the stills the 1c builder lofts:
//
//   1. THE RIG. Twenty bones; every pose in the table solves to finite frames, each one a turn
//      (orthonormal and right-handed) or folded to nothing; the bind frames skin to the identity.
//   2. THE BODIES. A fielder, a catcher, an umpire and a hitter built for skinning: every vertex on
//      up to four bones with weights summing to one; the bind pose skins every vertex to itself;
//      in every pose the skinned body lies on the posed build's surface within 0.25 ft, and the
//      head, which rides the neck and the skull, lands vertex for vertex.
//   3. THE HANDS ON THE BAT. In every pose with a bat, either hand's fist and the bat within
//      0.05 ft of where the posed build puts them, and the open hands folded away.
//   4. THE PALETTE. Three texels a bone, and the shader's chunk reading the rows the rig writes.
//
// Run:  node scripts/shapes/anim-smoke.mjs

import { performance as clock } from 'node:perf_hooks';

const P = '../../client/game/js/panels/';
const RIG = await import(P + 'diamond/rig.js');
const PM = await import(P + 'gl/ballplayer-mesh.js');
const SK = await import(P + 'gl/skin.js');
const { STRIDE } = await import(P + 'gl/ballpark-mesh.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};
const t0 = clock.now();
const S = PM.SKIN_STRIDE, NB = RIG.BONES.length;
const solved = (name, mirror = false, scale = 1) => {
  const pose = mirror ? PM.mirrorPose(PM.POSES[name]()) : PM.POSES[name]();
  return RIG.solvePose(Object.assign(pose, { at: [0, 0, 0], yaw: 0, scale }));
};
const rowsFor = (name, mirror = false, scale = 1) => RIG.skinRows(RIG.boneFrames(solved(name, mirror, scale)), RIG.bindFrames(scale));

// ── 1. the rig ───────────────────────────────────────────────────────────────
check('rig: twenty bones, each named once', NB === 20 && new Set(RIG.BONES).size === NB && RIG.BONES.every((n, i) => RIG.BONE[n] === i));
{
  let bad = [], folded = 0;
  for (const name of Object.keys(PM.POSES)) for (const mirror of [false, true]) {
    const f = RIG.boneFrames(solved(name, mirror));
    for (let b = 0; b < NB; b++) {
      const o = b * RIG.FRAME_FLOATS, X = [...f.subarray(o, o + 3)], Y = [...f.subarray(o + 3, o + 6)], Z = [...f.subarray(o + 6, o + 9)];
      if ([...f.subarray(o, o + 12)].some((v) => !Number.isFinite(v))) { bad.push(`${name}:${RIG.BONES[b]} not finite`); continue; }
      const len = (v) => Math.hypot(...v), dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      if (len(X) + len(Y) + len(Z) < 1e-9) { folded++; continue; }
      const cr = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
      const err = Math.max(Math.abs(len(X) - 1), Math.abs(len(Y) - 1), Math.abs(len(Z) - 1), Math.abs(dot(X, Y)), Math.abs(dot(Y, Z)), Math.abs(dot(Z, X)), len([cr[0] - Z[0], cr[1] - Z[1], cr[2] - Z[2]]));
      if (err > 1e-4) bad.push(`${name}${mirror ? '/m' : ''}:${RIG.BONES[b]} ${err.toExponential(1)}`);
    }
  }
  check('rig: every pose solves to turns, or bones folded away', bad.length === 0, bad.slice(0, 4).join('; '));
  check('rig: the fists and bat fold away when the hands are free, the open hands when they grip', folded > 0);
}
{
  let worst = 0;
  for (const scale of [1, 1.03]) {
    const b = RIG.bindFrames(scale), rows = RIG.skinRows(b, b);
    for (let i = 0; i < NB; i++) { const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; for (let k = 0; k < 12; k++) worst = Math.max(worst, Math.abs(rows[i * 12 + k] - I[k])); }
  }
  check('rig: the bind frames skin to the identity', worst < 1e-5, worst.toExponential(2));
}

// ── 2. the bodies ────────────────────────────────────────────────────────────
const LOOKS = {
  fielder: { id: 'Rats:SS', side: 'home', role: 'fielder', slot: 4, glove: 'L' },
  catcher: { id: 'Rats:C', side: 'home', role: 'catcher', slot: 1, glove: 'L' },
  umpire: { id: 'ump:plate', side: 'ump', role: 'ump', slot: 24, mask: true, girth: 0.06 },
  hitter: { id: 'Voss', side: 'away', role: 'batter', slot: 12, helmet: true, flapSide: 1, battingGloves: '#c9c4b8' },
};
const skinnedOf = (look) => { const G = PM.createPlayerSet({ skin: true }); PM.buildBody(G, PM.lookOf(look)); return G; };
const posedOf = (look, name, mirror = false) => {
  const G = PM.createPlayerSet(), pose = mirror ? PM.mirrorPose(PM.POSES[name]()) : PM.POSES[name]();
  PM.buildPlayer(G, Object.assign(pose, { at: [0, 0, 0], yaw: 0 }), PM.lookOf(look));
  return G;
};
const vert = (b, v) => {
  const o = v * S, q = (o + STRIDE) * 4;
  return { p: [b.data[o], b.data[o + 1], b.data[o + 2]], ids: [b.u8[q], b.u8[q + 1], b.u8[q + 2], b.u8[q + 3]], ws: [b.u8[q + 4], b.u8[q + 5], b.u8[q + 6], b.u8[q + 7]] };
};
// A grid over a posed build's vertices, for nearest-point lookups. The cells are a quarter foot, so
// the 27 round a point hold every vertex nearer than that; past it the answer is only "too far".
function gridOf(b, stride = STRIDE) {
  const cell = 0.25, grid = new Map(), d = b.data;
  const key = (x, y, z) => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  for (let v = 0; v < b.n; v++) {
    const r = v * stride, k = key(Math.floor(d[r] / cell), Math.floor(d[r + 1] / cell), Math.floor(d[r + 2] / cell));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(r);
  }
  return (p) => {
    let best = Infinity;
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!a) continue;
      for (const r of a) { const ex = p[0] - d[r], ey = p[1] - d[r + 1], ez = p[2] - d[r + 2], q = ex * ex + ey * ey + ez * ez; if (q < best) best = q; }
    }
    return Math.sqrt(best);
  };
}
// What each vertex of a body hangs from, worked out once: its bones and weights, and its kind
// (0 the body, 1 the head and neck alone, 2 a fist or the bat, 3 an open hand).
function rigOf(b) {
  const ids = new Uint8Array(b.n * 4), ws = new Uint8Array(b.n * 4), kind = new Uint8Array(b.n);
  for (let v = 0; v < b.n; v++) {
    const q = (v * S + STRIDE) * 4;
    let head = true, fist = false, open = false;
    for (let k = 0; k < 4; k++) {
      ids[v * 4 + k] = b.u8[q + k]; ws[v * 4 + k] = b.u8[q + 4 + k];
      if (!ws[v * 4 + k]) continue;
      const n = RIG.BONES[ids[v * 4 + k]];
      if (n !== 'neck' && n !== 'head') head = false;
      if (/^fist|^bat$/.test(n)) fist = true;
      if (n === 'handL' || n === 'handR') open = true;
    }
    kind[v] = fist ? 2 : open ? 3 : head ? 1 : 0;
  }
  return { ids, ws, kind };
}
const skinAt = (rows, R, b, v) => SK.skinPoint(rows, R.ids.subarray(v * 4, v * 4 + 4), R.ws.subarray(v * 4, v * 4 + 4), [b.data[v * S], b.data[v * S + 1], b.data[v * S + 2]]);
const BAT_POSES = Object.keys(PM.POSES).filter((n) => PM.POSES[n]().bat);
const tb = clock.now();
const bodies = Object.fromEntries(Object.entries(LOOKS).map(([k, look]) => [k, skinnedOf(look)]));
const buildMs = (clock.now() - tb) / 4;
for (const [kind, G] of Object.entries(bodies)) {
  let n = 0, badW = 0, badI = 0, moved = 0;
  const ident = RIG.skinRows(RIG.bindFrames(1), RIG.bindFrames(1));
  for (const b of G.batches.values()) {
    check(`${kind}: every batch skinned`, b.skin === true);
    for (let v = 0; v < b.n; v++) {
      const { p, ids, ws } = vert(b, v); n++;
      if (ws[0] + ws[1] + ws[2] + ws[3] !== 255) badW++;
      if (ids.some((i) => i >= NB)) badI++;
      const q = SK.skinPoint(ident, ids, ws, p);
      if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 1e-4) moved++;
    }
  }
  check(`${kind}: weights sum to one on every vertex`, n > 30000 && badW === 0, `${badW} of ${n}`);
  check(`${kind}: every index a bone`, badI === 0, `${badI}`);
  check(`${kind}: the bind pose skins every vertex to itself`, moved === 0, `${moved} moved`);
}
// every pose, skinned, against the posed build's surface; the head vertex for vertex
// every pose for the fielder; for the rest, their own and the deepest bends
const POSES_FOR = {
  fielder: Object.keys(PM.POSES).filter((n) => !BAT_POSES.includes(n)),
  catcher: ['catcher', 'stand', 'tag', 'pFollow'], umpire: ['umpire', 'stand', 'safe', 'outfield'], hitter: [...BAT_POSES, 'runner', 'slide'],
};
const rigs = new Map();
for (const G of Object.values(bodies)) for (const b of G.batches.values()) rigs.set(b, rigOf(b));
for (const kind of ['fielder', 'catcher', 'umpire', 'hitter']) {
  const G = bodies[kind], look = LOOKS[kind];
  let worst = { d: 0 }, headWorst = { d: 0 };
  for (const name of POSES_FOR[kind]) {
    const rows = rowsFor(name), posed = posedOf(look, name), gripping = BAT_POSES.includes(name);
    for (const [key, b] of G.batches) {
      const pb = posed.batches.get(key), R = rigs.get(b);
      if (!pb) continue;
      const near = gridOf(pb), same = pb.n <= b.n;
      for (let v = 0; v < b.n; v++) {
        // a hitter's fists and bat are the next section's; open hands folded away aren't anywhere
        const k = R.kind[v];
        if (k === 2 || (k === 3 && gripping)) continue;
        if (k === 1 && same && v < pb.n && key === 'plain') {
          const q = skinAt(rows, R, b, v), r = v * STRIDE, d = Math.hypot(q[0] - pb.data[r], q[1] - pb.data[r + 1], q[2] - pb.data[r + 2]);
          if (d > headWorst.d) headWorst = { d, name };
        }
        if (v % 5) continue;
        const d = near(skinAt(rows, R, b, v));
        if (d > worst.d) worst = { d, name, bone: [...R.ids.subarray(v * 4, v * 4 + 4)].filter((_, i) => R.ws[v * 4 + i]).map((i) => RIG.BONES[i]).join('+') };
      }
    }
  }
  check(`${kind}: every pose's skinned body on the posed build's surface`, worst.d < 0.25, `${worst.d.toFixed(3)} ft in ${worst.name} at ${worst.bone}`);
  check(`${kind}: the head where the posed build puts it, vertex for vertex`, headWorst.d < 0.01, `${headWorst.d.toFixed(4)} ft in ${headWorst.name}`);
}

// ── 3. the hands on the bat ──────────────────────────────────────────────────
{
  const G = bodies.hitter;
  let worst = { d: 0 }, grip = { d: 0 }, unfolded = 0;
  for (const name of BAT_POSES) for (const mirror of [false, true]) {
    const sol = solved(name, mirror), f = RIG.boneFrames(sol), rows = RIG.skinRows(f, RIG.bindFrames(1)), posed = posedOf(LOOKS.hitter, name, mirror);
    // each fist's grip on the bat's axis, between the knob and the label
    const bo = RIG.BONE.bat * 12, knob = [f[bo + 9], f[bo + 10], f[bo + 11]], ax = [f[bo + 3], f[bo + 4], f[bo + 5]];
    for (const S of ['L', 'R']) {
      const o = RIG.BONE['fist' + S] * 12, c = [f[o + 9] - knob[0], f[o + 10] - knob[1], f[o + 11] - knob[2]];
      const t = c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2], off = Math.hypot(c[0] - ax[0] * t, c[1] - ax[1] * t, c[2] - ax[2] * t);
      if (off > grip.d || t < 0 || t > 0.6) grip = { d: t < 0 || t > 0.6 ? 9 : off, name: name + (mirror ? ' mirrored' : '') + ' ' + S };
    }
    for (const [key, b] of G.batches) {
      const pb = posed.batches.get(key), near = pb ? gridOf(pb) : null, R = rigs.get(b);
      for (let v = 0; v < b.n; v++) {
        if (R.kind[v] === 3) {
          const o = R.ids[v * 4] * 12, q = skinAt(rows, R, b, v);
          if (Math.hypot(q[0] - rows[o + 3], q[1] - rows[o + 7], q[2] - rows[o + 11]) > 1e-6) unfolded++;
          continue;
        }
        if (R.kind[v] !== 2 || !near) continue;
        const d = near(skinAt(rows, R, b, v));
        if (d > worst.d) worst = { d, name: name + (mirror ? ' mirrored' : ''), bone: RIG.BONES[R.ids[v * 4]] };
      }
    }
  }
  check('hands: both grips on the bat within 0.05 ft of its axis, on the handle, in every pose with a bat', BAT_POSES.length >= 3 && grip.d < 0.05, `${grip.d.toFixed(3)} ft, ${grip.name}`);
  // the fist's strap hangs off the wrist in the posed build, and the fist's own bone here
  check('hands: the skinned fists and bat where the posed build puts them, within 0.1 ft', worst.d < 0.1, `${worst.d.toFixed(3)} ft, ${worst.bone} in ${worst.name}`);
  check('hands: the open hands folded away while they grip', unfolded === 0, `${unfolded} vertices`);
  // and free again: in a pose without a bat the fists and the bat fold away
  const rows = rowsFor('runner');
  let shown = 0;
  for (const b of G.batches.values()) {
    const R = rigs.get(b);
    for (let v = 0; v < b.n; v++) {
      if (R.kind[v] !== 2) continue;
      const o = R.ids[v * 4] * 12, q = skinAt(rows, R, b, v);
      if (Math.hypot(q[0] - rows[o + 3], q[1] - rows[o + 7], q[2] - rows[o + 11]) > 1e-6) shown++;
    }
  }
  check('hands: a runner\'s fists and bat folded away', shown === 0, `${shown} vertices`);
}

// ── 4. the palette ───────────────────────────────────────────────────────────
check('palette: three texels a bone, a row a player', SK.SKIN_TEXELS === 3 && SK.PALETTE_W === NB * 3);
check('palette: the shader reads three rows of four a bone', /mat3x4\(texelFetch[^;]*x \+ 1[^;]*x \+ 2/.test(SK.SKIN_GLSL.replace(/\s+/g, ' ')) && /int\(b \+ 0\.5\) \* 3/.test(SK.SKIN_GLSL));
{
  // a turn and a move, by the CPU's sum: a point on bone 2 rides it whole, and halfway between two
  // bones it lands halfway
  const rows = new Float32Array(NB * 12);
  for (let b = 0; b < NB; b++) rows.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], b * 12);
  rows.set([0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3], 2 * 12);
  const a = SK.skinPoint(rows, [2, 0, 0, 0], [255, 0, 0, 0], [1, 0, 0]), h = SK.skinPoint(rows, [2, 0, 0, 0], [128, 127, 0, 0], [1, 0, 0]);
  check('palette: the sum turns, moves and blends', Math.hypot(a[0] - 1, a[1] - 3, a[2] - 3) < 1e-9 && Math.abs(h[0] - (128 * 1 + 127 * 1) / 255) < 1e-9 && Math.abs(h[1] - 128 * 3 / 255) < 1e-9);
}

console.log(`anim-smoke: ${passes}/${passes + failures} passed · a skinned body built in ${buildMs.toFixed(0)} ms on average · ${((clock.now() - t0) / 1000).toFixed(1)} s in all`);
process.exit(failures ? 1 : 0);
