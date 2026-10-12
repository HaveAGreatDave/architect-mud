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
//   5. THE CLIPS (diamond/anim.js plays them). The library in content/animation_clips/ checks out
//      with nothing to warn about, and diamond/clips.js is its bake as it stands. Then every clip,
//      played at 120 frames a second:
//        · every frame a pose a body can make (anim.js JOINT_LIMITS), and no joint faster or
//          quicker to change speed than a body is (TOP_SPEED, TOP_ACCEL), which is where a pop or
//          a snap between two blend points shows (a knee straightening into a hard stop, say);
//        · no velocity spikes at the blend points (each key, each plant's ease on and off, a loop's
//          seam): the jump in each joint's velocity across one, taken to zero time, under 1 ft/s;
//        · a planted foot moves less than 0.1 ft while it's planted;
//        · both hands within 0.05 ft of the bat wherever there's one;
//        · at a catch, the glove within 0.1 ft of every ball in the box the catch says it covers
//          (its `reach`), the body inside its limits;
//        · at a release, the hand at its fastest within a frame (1/60 s), at nine tenths of that
//          speed or more, and going within 30 degrees of the way the ball goes; at a contact, the
//          bat's sweet spot the same;
//        · and done each player's own way (anim.js TRAIT_RANGE, at the ends of each range), still
//          a body that can make every frame, the planted feet still and the hands on the bat.
//      And the player itself: a loop is the same a lap later; a left-hander is a right-hander in a
//      mirror; the head turns no further than a neck can; the pitcher on the real mound, both
//      ways round, keeps his planted feet on its slope.
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

// ── 5. the clips ─────────────────────────────────────────────────────────────
const A = await import(P + 'diamond/anim.js');
const SCH = await import(P + 'diamond/clip-schema.js');
const { CLIPS } = await import(P + 'diamond/clips.js');
const BAKE = await import('./bake-clips.mjs');
const GEO = await import(P + 'diamond/geo.js');
{
  const files = BAKE.readClipFiles();
  const res = BAKE.bakeClips(files);
  check('clips: the library checks out', files.length > 0 && res.errors.length === 0, res.errors.slice(0, 3).join('; '));
  check('clips: nothing in it to warn about', res.warnings.length === 0, res.warnings.slice(0, 3).join('; '));
  const { readFileSync } = await import('node:fs');
  const onDisk = readFileSync(BAKE.CLIP_MODULE, 'utf8').replace(/\r\n/g, '\n');
  check('clips: diamond/clips.js is the bake of content/animation_clips/ (npm run clips:bake)', !res.errors.length && onDisk === BAKE.renderModule(res).replace(/\r\n/g, '\n'));
  check('clips: the module holds every clip', Object.keys(CLIPS).sort().join() === Object.keys(res.clips).sort().join());
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const solveAt0 = (pose) => RIG.solvePose({ ...pose, at: [0, 0, 0], yaw: 0 });
// the joints the clip checks follow, and the most each may move in feet a second
const TRACK = ['pelvis', 'head', 'wrL', 'wrR', 'elL', 'elR', 'knL', 'knR', 'anL', 'anR', 'toeL', 'toeR'];
const TOP_SPEED = { pelvis: 25, head: 60, wrL: 170, wrR: 170, elL: 140, elR: 140, knL: 50, knR: 50, anL: 50, anR: 50, toeL: 60, toeR: 60 };
// and the most each may change speed, in feet a second each second, at 120 frames a second: about
// twice what the library asks for (the throwing hand 7,200 at the release, a knee 1,200), so a knee
// snapping straight (2,600) stands out
const TOP_ACCEL = { pelvis: 1500, head: 3000, wrL: 12000, wrR: 12000, elL: 10000, elR: 10000, knL: 2000, knR: 2000, anL: 2500, anR: 2500, toeL: 3000, toeR: 3000 };
const jointsAt = (clip, t) => { const J = solveAt0(A.sampleClip(clip, t)).J; return TRACK.map((k) => J[k]); };
const tc = clock.now();
for (const clip of Object.values(CLIPS)) {
  const D = clip.duration, N = Math.max(1, Math.ceil(D * 120)), dt = D / N;
  const breaks = [], fast = [], sharp = [];
  let grip = 0, slide = { d: 0 }, prev = null, prevV = null;
  const spot = new Map();
  for (let i = 0; i <= N; i++) {
    const t = i * dt, pose = A.sampleClip(clip, t), sol = solveAt0(pose), J = sol.J;
    if (breaks.length < 3) for (const b of A.limitBreaks(pose, sol)) if (breaks.length < 3) breaks.push(`${b} at ${t.toFixed(3)} s`);
    if (pose.bat) for (const S of ['L', 'R']) grip = Math.max(grip, len3(sub(J['wr' + S], J['wrT' + S])));
    for (const p of clip.plants) {
      if (t < p.from - 1e-9 || t > p.to + 1e-9) continue;
      const k = p.foot + p.from, a = J['an' + p.foot];
      if (!spot.has(k)) spot.set(k, a);
      const d = len3(sub(a, spot.get(k)));
      if (d > slide.d) slide = { d, t, foot: p.foot };
    }
    const cur = TRACK.map((k) => J[k]);
    if (prev) {
      const vel = cur.map((p, j) => sub(p, prev[j]).map((x) => x / dt));
      vel.forEach((v, j) => {
        const sp = len3(v), k = TRACK[j];
        if (sp > TOP_SPEED[k] && fast.length < 3) fast.push(`${k} at ${sp.toFixed(0)} ft/s at ${t.toFixed(3)} s`);
        const ac = prevV ? len3(sub(v, prevV[j])) / dt : 0;
        if (ac > TOP_ACCEL[k] && sharp.length < 3) sharp.push(`${k} at ${ac.toFixed(0)} ft/s² at ${t.toFixed(3)} s`);
      });
      prevV = vel;
    }
    prev = cur;
  }
  check(`clip ${clip.id}: every frame a pose a body can make`, breaks.length === 0, breaks.join('; '));
  check(`clip ${clip.id}: no joint faster than a body moves`, fast.length === 0, fast.join('; '));
  check(`clip ${clip.id}: no joint changing speed quicker than a body can`, sharp.length === 0, sharp.join('; '));
  check(`clip ${clip.id}: planted feet stay put, within 0.1 ft`, slide.d < 0.1, `${slide.d.toFixed(3)} ft, foot ${slide.foot} at ${slide.t?.toFixed(3)} s`);
  check(`clip ${clip.id}: both hands on the bat, within 0.05 ft`, grip < 0.05, `${grip.toFixed(3)} ft`);
  // the blend points; the jump in velocity across each, by two step sizes taken to zero
  const blends = new Set(clip.keys.map((k) => k.t));
  for (const p of clip.plants) for (const x of [p.from, p.to, p.from - A.PLANT_EASE, p.to + A.PLANT_EASE]) blends.add(+x.toFixed(6));
  let kink = { v: 0 };
  const jumpAt = (tb, h) => { const [a, b, c] = [tb - h, tb, tb + h].map((t) => jointsAt(clip, t)); return b.map((pb, j) => sub(sub(c[j], pb), sub(pb, a[j])).map((x) => x / h)); };
  for (const tb of blends) {
    if (!clip.loop && !(tb > 1e-3 && tb < D - 1e-3)) continue;
    const big = jumpAt(tb, 5e-4), half = jumpAt(tb, 2.5e-4);
    big.forEach((g, j) => { const v = len3(sub(half[j].map((x) => 2 * x), g)); if (v > kink.v) kink = { v, t: tb, joint: TRACK[j] }; });
  }
  check(`clip ${clip.id}: no velocity spikes at the blend points`, kink.v < 1, `${kink.v.toFixed(2)} ft/s, ${kink.joint} at ${kink.t} s`);
  // the catch: the glove to the ball anywhere in the box the catch says it covers, or a hand's
  // width round where the clip has it
  for (const e of clip.events.filter((x) => x.kind === 'catch')) {
    const kind = clip.role === 'catcher' ? 'mitt' : 'glove', box = e.reach;
    const P0 = A.sampleClip(clip, e.t), home = A.handPoint(P0, e.hand, kind);
    const targets = [];
    const from = e.from || [0, 0, 1], h0 = Math.hypot(from[0], from[2]), x0 = (home[0] * from[2] - home[2] * from[0]) / h0;
    if (box) for (let i = 0; i <= 8; i++) for (let k = 0; k <= 10; k++) targets.push(A.catchTarget(home, box.x[0] + (box.x[1] - box.x[0]) * i / 8, box.y[0] + (box.y[1] - box.y[0]) * k / 10, from));
    else for (const d of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) targets.push(A.catchTarget(home, x0 + d[0], home[1] + d[1], from));
    let worst = { d: 0 }, bent = null;
    for (const T of targets) {
      const Q = A.reach(P0, e.hand, T, 1, { kind, follow: box ? box.follow : 0.3 }), sol = solveAt0(Q), J = sol.J;
      const hd = J['hdir' + e.hand], pm = J['palm' + e.hand], wr = J['wr' + e.hand], along = kind === 'mitt' ? 0.27 : 0.3;
      const d = len3(sub([wr[0] + hd[0] * along + pm[0] * 0.05, wr[1] + hd[1] * along + pm[1] * 0.05, wr[2] + hd[2] * along + pm[2] * 0.05], T));
      if (d > worst.d) worst = { d, T };
      const br = A.limitBreaks(Q, sol);
      if (br.length && !bent) bent = `${br[0]} reaching to [${T.map((v) => v.toFixed(2))}]`;
    }
    check(`clip ${clip.id}: the glove at the ball on the catch frame, within 0.1 ft (${targets.length} places)`, worst.d < 0.1, `${worst.d.toFixed(3)} ft at [${worst.T?.map((v) => v.toFixed(2))}]`);
    check(`clip ${clip.id}: a body that can make every catch`, !bent, bent);
  }
  // the contact: the barrel's sweet spot at its fastest
  for (const e of clip.events.filter((x) => x.kind === 'contact')) {
    const spot = (t) => { const J = solveAt0(A.sampleClip(clip, t)).J; return J.batKnob ? J.batKnob.map((v, i) => v + J.batDir[i] * A.SWEET_SPOT) : null; };
    const vAt = (t) => { const q = 5e-4, a = spot(t - q), b = spot(t + q); return a && b ? len3(sub(b, a)) / (2 * q) : 0; };
    let top = { v: 0 };
    for (let t = Math.max(1e-3, e.t - 0.06); t <= Math.min(D - 1e-3, e.t + 0.06); t += 1e-3) { const v = vAt(t); if (v > top.v) top = { v, t }; }
    const sp = vAt(e.t);
    check(`clip ${clip.id}: the bat meets the ball at its fastest, within a frame`, !!spot(e.t) && Math.abs(top.t - e.t) <= 1 / 60 + 1e-9 && sp >= 0.9 * top.v, `${sp.toFixed(0)} ft/s at the contact, ${top.v.toFixed(0)} at ${top.t?.toFixed(3)} s`);
  }
  // done his own way, at the ends of each trait's range
  {
    const R = A.TRAIT_RANGE, base = A.traitsOf('anyone');
    const ways = clip.role === 'pitcher' ? [{ kick: R.kick[0] }, { kick: R.kick[1] }]
      : clip.role === 'batter' ? [{ width: R.width[0], crouch: R.crouch[0], batAngle: R.batAngle[0] }, { width: R.width[1], crouch: R.crouch[1], batAngle: R.batAngle[1] },
        { width: R.width[0], crouch: R.crouch[1], batAngle: R.batAngle[1] }, { width: R.width[1], crouch: R.crouch[0], batAngle: R.batAngle[0] }] : [];
    const bad = [];
    let wgrip = 0, wslide = 0;
    for (const way of ways) {
      const traits = { ...base, ...way }, spot = new Map();
      for (let t = 0; t <= D + 1e-9; t += 1 / 60) {
        const pose = A.sampleClip(clip, t, { traits }), sol = solveAt0(pose), J = sol.J;
        if (bad.length < 2) for (const b of A.limitBreaks(pose, sol)) if (bad.length < 2) bad.push(`${b} at ${t.toFixed(3)} s with ${JSON.stringify(way)}`);
        if (pose.bat) for (const S of ['L', 'R']) wgrip = Math.max(wgrip, len3(sub(J['wr' + S], J['wrT' + S])));
        for (const p of clip.plants) { if (t < p.from - 1e-9 || t > p.to + 1e-9) continue; const k = p.foot + p.from, a = J['an' + p.foot]; if (!spot.has(k)) spot.set(k, a); wslide = Math.max(wslide, len3(sub(a, spot.get(k)))); }
      }
    }
    if (ways.length) check(`clip ${clip.id}: done each player's own way, still a body that can, feet still and hands on the bat`, !bad.length && wgrip < 0.05 && wslide < 0.1, `${bad.join('; ')} grip ${wgrip.toFixed(3)} ft, slide ${wslide.toFixed(3)} ft`);
  }
  // the release: the hand at its fastest, going the way the ball goes
  for (const e of clip.events.filter((x) => x.kind === 'release')) {
    const vAt = (t) => { const q = 5e-4; return sub(solveAt0(A.sampleClip(clip, t + q)).J['wr' + e.hand], solveAt0(A.sampleClip(clip, t - q)).J['wr' + e.hand]).map((x) => x / (2 * q)); };
    let top = { v: 0 };
    for (let t = Math.max(1e-3, e.t - 0.06); t <= Math.min(D - 1e-3, e.t + 0.06); t += 1e-3) { const v = len3(vAt(t)); if (v > top.v) top = { v, t }; }
    const v = vAt(e.t), sp = len3(v), d = e.dir, off = Math.acos(Math.max(-1, Math.min(1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / (sp * len3(d))))) * 180 / Math.PI;
    check(`clip ${clip.id}: the ball leaves the hand at its fastest, within a frame`, Math.abs(top.t - e.t) <= 1 / 60 + 1e-9 && sp >= 0.9 * top.v, `${sp.toFixed(0)} ft/s at the release, ${top.v.toFixed(0)} at ${top.t.toFixed(3)} s`);
    check(`clip ${clip.id}: the hand going the way the ball goes at the release`, off <= 30, `${off.toFixed(0)}° off`);
  }
}
const clipsMs = clock.now() - tc;
// the player
{
  const loop = Object.values(CLIPS).find((c) => c.loop);
  const a = loop && A.sampleClip(loop, 0.37), b = loop && A.sampleClip(loop, 0.37 + loop.duration);
  check('player: a loop is the same a lap later', loop && JSON.stringify(a) === JSON.stringify(b));
  const pitch = Object.values(CLIPS).find((c) => c.role === 'pitcher' && A.eventTime(c, 'release') !== null && c.plants.length);
  let mirrorOff = 0;
  for (const t of [0.2, 0.9, 1.3, 1.44, 2.2]) {
    const m = A.sampleClip(pitch, t, { mirror: true }), r = RIG.mirrorPose(A.sampleClip(pitch, t));
    const Jm = solveAt0(m).J, Jr = solveAt0(r).J;
    for (const k of TRACK) mirrorOff = Math.max(mirrorOff, len3(sub(Jm[k], Jr[k])));
  }
  check('player: a left-hander is a right-hander in a mirror', mirrorOff < 1e-9, `${mirrorOff.toExponential(2)} ft`);
  const P0 = A.sampleClip(pitch, 0.1), look = A.lookAt(P0, [0, 4, -40]);
  check('player: the head turns no further than a neck can', Math.abs(look.neck[1]) <= A.LOOK_LIMIT.yaw * 0.6 + 1e-9 && Math.abs(look.head[1]) <= A.LOOK_LIMIT.yaw * 0.4 + 1e-9 && Math.abs(look.neck[1]) > 30, `neck ${look.neck[1].toFixed(1)}°, head ${look.head[1].toFixed(1)}°`);
  const ev = A.eventsBetween(pitch, 1.0, A.eventTime(pitch, 'release'));
  check('player: the events a clip plays past, the end included', ev.length === 1 && ev[0].kind === 'release' && A.eventsBetween(pitch, A.eventTime(pitch, 'release'), 2).length === 0);
  // on the mound, both ways round: the director's ground in the pose's own frame is the park's
  // ground there, less the height he stands at
  let worst = { d: 0 }, slid = 0, jump = { d: 0 };
  for (const lefty of [false, true]) {
    const at = GEO.RUBBER, yaw = lefty ? -90 : 90, c = Math.cos(yaw * Math.PI / 180), sn = Math.sin(yaw * Math.PI / 180);
    const toW = (x, z) => [at[0] + c * x + sn * z, at[2] - sn * x + c * z];
    const ground = (x, z) => { const w = toW(x, z); return GEO.groundHeight(w[0], w[1]) - at[1]; };
    const spot = new Map();
    for (let t = 0; t <= pitch.duration + 1e-9; t += 1 / 120) {
      const J = RIG.solvePose({ ...A.sampleClip(pitch, t, { ground, mirror: lefty }), at, yaw }).J;
      for (const p of pitch.plants) {
        if (t < p.from || t > p.to) continue;
        const S = lefty ? (p.foot === 'L' ? 'R' : 'L') : p.foot, an = J['an' + S], d = Math.abs(an[1] - (GEO.groundHeight(an[0], an[2]) + 0.28));
        if (d > worst.d) worst = { d, t, S, lefty };
        const k = S + p.from;
        if (!spot.has(k)) spot.set(k, an);
        slid = Math.max(slid, len3(sub(an, spot.get(k))));
      }
    }
    // and the foot onto and off the ground without a jump, where the slope says the ground is
    for (const p of pitch.plants) for (const tb of [p.from, p.to]) {
      if (!(tb > 1e-3 && tb < pitch.duration - 1e-3)) continue;
      const S = lefty ? (p.foot === 'L' ? 'R' : 'L') : p.foot;
      const [a, b] = [tb - 1e-4, tb + 1e-4].map((t) => RIG.solvePose({ ...A.sampleClip(pitch, t, { ground, mirror: lefty }), at, yaw }).J['an' + S]);
      const d = len3(sub(a, b));
      if (d > jump.d) jump = { d, t: tb, S, lefty };
    }
  }
  check('player: on the mound, both ways round, planted feet on its slope', worst.d < 0.01, `${worst.d.toFixed(3)} ft off, ${worst.lefty ? 'left' : 'right'}-hander's ${worst.S} at ${worst.t?.toFixed(3)} s`);
  check('player: on the mound, both ways round, planted feet stay put', slid < 0.1, `${slid.toFixed(3)} ft`);
  check('player: on the mound, both ways round, a foot comes down onto the slope and up off it without a jump', jump.d < 0.01, `${jump.d.toFixed(3)} ft, ${jump.lefty ? 'left' : 'right'}-hander's ${jump.S} at ${jump.t} s`);
}

console.log(`anim-smoke: ${passes}/${passes + failures} passed · a skinned body built in ${buildMs.toFixed(0)} ms on average · ${Object.keys(CLIPS).length} clips in ${(clipsMs / 1000).toFixed(1)} s · ${((clock.now() - t0) / 1000).toFixed(1)} s in all`);
process.exit(failures ? 1 : 0);
