// THE STREET FIGURE'S HEAD: THE MESH AT EACH LEVEL, AND THE TWO BONES IT RIDES.
//
//   node scripts/shapes/actor-head.mjs            # gate
//   node scripts/shapes/actor-head.mjs --report   # the numbers behind it
//
// Phases 1 and 2 of docs/proposals/street-figure-heads.md. Nothing here is drawn in the game yet,
// so no picture would catch these going wrong.
//
// The mesh (client/game/js/panels/actor-head.js), at every level: within its vertex budget and
// indexable as UNSIGNED_SHORT; the skull and both ears closed and wound outward; the neck an open
// tube whose top is inside the skull; the ears attached; no sliver triangles; the nose standing
// off the face; and no hair below the hairline, where it would cover the brow or the painted face.
//
// The bones (actor3d.js bk.bones): every frame's head and neck matrices are rigid, and agree with
// the vertex bake, since the old head and the old neck's foot ride those bones alone; across every
// frame of every clip the new neck's foot stays inside the coat's collar, and the head stays out of
// the coat.
import { headMesh, hairMesh, hairlineAt, HEAD_LEVELS, HAIR_STYLES, HEAD_FEAT, headLevelFor, NECK_FOOT } from '../../client/game/js/panels/actor-head.js';
import { actorBake, actorBind, ACTOR_HEAD_BONES, ACTOR_MAT, ACTOR_BONE } from '../../client/game/js/panels/actor3d.js';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };

// Per level: [skin vertices, hair vertices for the worst style].
const BUDGET = [[1100, 450], [420, 180], [150, 70]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const P3 = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

// Triangles grouped by connected piece.
function pieces(nv, I) {
  const up = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (i) => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
  for (let t = 0; t < I.length; t += 3) { const a = find(I[t]); up[find(I[t + 1])] = a; up[find(I[t + 2])] = a; }
  const out = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const r = find(I[t]);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(I[t], I[t + 1], I[t + 2]);
  }
  return [...out.values()];
}
// Each directed edge once and its reverse once: closed and consistently wound. Returns the
// boundary edges (directed edges with no reverse) and how many edges are used wrongly.
function edges(tris) {
  const E = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k], b = tris[t + ((k + 1) % 3)], key = `${a},${b}`;
      E.set(key, (E.get(key) || 0) + 1);
    }
  }
  let bad = 0;
  const open = [];
  for (const [key, n] of E) {
    if (n > 1) bad++;
    const [a, b] = key.split(',');
    if (!E.has(`${b},${a}`)) open.push([+a, +b]);
  }
  return { open, bad };
}
const volume = (P, tris) => {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) v += dot(P3(P, tris[t]), cross(P3(P, tris[t + 1]), P3(P, tris[t + 2]))) / 6;
  return v;
};
// Möller–Trumbore: the distance along the ray to the triangle, or -1.
function hit(o, d, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return -1;
  const s = sub(o, a), u = dot(s, p) / det;
  if (u < 0 || u > 1) return -1;
  const q = cross(s, e1), v = dot(d, q) / det;
  if (v < 0 || u + v > 1) return -1;
  const t = dot(e2, q) / det;
  return t > 1e-7 ? t : -1;
}
// Inside a closed mesh: an odd number of crossings along a ray that's unlikely to graze an edge.
function inside(p, P, tris) {
  const d = [0.5773, 0.5774, 0.5772];
  let n = 0;
  for (let t = 0; t < tris.length; t += 3) if (hit(p, d, P3(P, tris[t]), P3(P, tris[t + 1]), P3(P, tris[t + 2])) > 0) n++;
  return n % 2 === 1;
}

// ── 1. The mesh ─────────────────────────────────────────────────────────────────────────────────────
if (HEAD_LEVELS.length !== 3) problems.push(`${HEAD_LEVELS.length} head levels; the design has three`);
for (let lv = 1; lv < HEAD_LEVELS.length; lv++) {
  if (!(HEAD_LEVELS[lv].px < HEAD_LEVELS[lv - 1].px)) problems.push(`${HEAD_LEVELS[lv].name} starts at ${HEAD_LEVELS[lv].px} px, not below ${HEAD_LEVELS[lv - 1].name}`);
}
for (const [px, want] of [[400, 0], [250, 0], [249, 1], [60, 1], [59, 2], [8, 2]]) {
  if (headLevelFor(px) !== want) problems.push(`a figure ${px} px tall gets head level ${headLevelFor(px)}, not ${want}`);
}
let lastV = Infinity;
for (let lv = 0; lv < HEAD_LEVELS.length; lv++) {
  const L = HEAD_LEVELS[lv], H = headMesh(lv), nv = H.P.length / 3, name = L.name;
  const hairV = Array.from({ length: HAIR_STYLES }, (_, s) => hairMesh(s, lv).P.length / 3);
  report(`${name}: ${nv} v / ${H.I.length / 3} t skin, hair ${hairV.join(' / ')} v, from ${L.px} px`);
  if (nv > BUDGET[lv][0]) problems.push(`${name}'s skin is ${nv} vertices, over its ${BUDGET[lv][0]}`);
  if (Math.max(...hairV) > BUDGET[lv][1]) problems.push(`${name}'s hair is up to ${Math.max(...hairV)} vertices, over its ${BUDGET[lv][1]}`);
  if (!(nv < lastV)) problems.push(`${name} has no fewer vertices than the level above it`);
  lastV = nv;
  for (const m of [H, ...Array.from({ length: HAIR_STYLES }, (_, s) => hairMesh(s, lv))]) {
    if (!(m.I instanceof Uint16Array) || m.P.length / 3 > 65535) problems.push(`${name}: a mesh doesn't index as UNSIGNED_SHORT`);
    if (m.P.some((v) => !Number.isFinite(v)) || m.N.some((v) => !Number.isFinite(v))) problems.push(`${name}: a mesh has a non-finite position or normal`);
  }

  // The pieces: one skull, two ears, one neck.
  const parts = pieces(nv, H.I).map((tris) => ({ tris, f: H.F[tris[0]] }));
  const of = (f) => parts.filter((p) => p.f === f);
  const skull = of(HEAD_FEAT.skin), ears = of(HEAD_FEAT.ear), necks = of(HEAD_FEAT.neck);
  if (skull.length !== 1 || ears.length !== 2 || necks.length !== 1) {
    problems.push(`${name}: ${skull.length} skulls, ${ears.length} ears and ${necks.length} necks; expected 1, 2 and 1`);
    continue;
  }
  for (const [what, p] of [['skull', skull[0]], ['left ear', ears[0]], ['right ear', ears[1]]]) {
    const { open, bad } = edges(p.tris);
    if (open.length || bad) problems.push(`${name}'s ${what} isn't closed and consistently wound (${open.length} open edges, ${bad} doubled)`);
    if (!(volume(H.P, p.tris) > 0)) problems.push(`${name}'s ${what} is wound inward`);
  }
  // The neck is open at both ends, an open edge for every point round it at each.
  const nn = L.neck[0], { open, bad } = edges(necks[0].tris);
  if (bad || open.length !== nn * 2) problems.push(`${name}'s neck has ${open.length} open edges and ${bad} doubled; expected a tube, ${nn * 2}`);
  const neckV = [...new Set(necks[0].tris)], top = Math.max(...neckV.map((v) => H.P[v * 3 + 1]));
  const foot = Math.min(...neckV.map((v) => H.P[v * 3 + 1]));
  if (Math.abs(foot - NECK_FOOT) > 1e-6) problems.push(`${name}'s neck ends at ${foot.toFixed(4)}, not ${NECK_FOOT}`);
  const outTop = neckV.filter((v) => H.P[v * 3 + 1] > top - 1e-6 && !inside(P3(H.P, v), H.P, skull[0].tris)).length;
  if (outTop) problems.push(`${name}: ${outTop} points of the neck's top ring are outside the skull, so it shows as an open ring`);
  for (const [what, e] of [['left', ears[0]], ['right', ears[1]]]) {
    const vs = [...new Set(e.tris)], inn = vs.filter((v) => inside(P3(H.P, v), H.P, skull[0].tris)).length;
    if (inn === 0) problems.push(`${name}'s ${what} ear doesn't touch the skull`);
    if (inn > vs.length / 2) problems.push(`${name}'s ${what} ear is mostly inside the skull (${inn} of ${vs.length})`);
  }
  // Slivers: at a few metres a triangle under a square millimetre is a flicker, not a shape.
  let sliver = 0;
  for (const p of parts) {
    for (let t = 0; t < p.tris.length; t += 3) {
      const a = P3(H.P, p.tris[t]), n = cross(sub(P3(H.P, p.tris[t + 1]), a), sub(P3(H.P, p.tris[t + 2]), a));
      if (Math.hypot(...n) / 2 < 1e-7) sliver++;
    }
  }
  if (sliver) problems.push(`${name} has ${sliver} triangles under 0.1 mm²`);
  // The profile: the nose stands off the face below the eyes, and the chin off the throat.
  const centre = [];
  for (let v = 0; v < nv; v++) if (H.F[v] === HEAD_FEAT.skin && Math.abs(H.P[v * 3]) < 1e-4 && H.P[v * 3 + 2] > 0) centre.push([H.P[v * 3 + 1], H.P[v * 3 + 2]]);
  const zIn = (y0, y1) => Math.max(...centre.filter(([y]) => y >= y0 && y <= y1).map(([, z]) => z));
  const nose = zIn(1.585, 1.61) - zIn(1.625, 1.645);
  report(`  nose ${(nose * 1000).toFixed(1)} mm off the face below the eyes`);
  if (!(nose > 0.008)) problems.push(`${name}'s nose stands ${(nose * 1000).toFixed(1)} mm off the face; under 8 it reads as a mask`);
  // The face texture covers the front.
  for (let v = 0; v < nv; v++) {
    if (H.F[v] !== HEAD_FEAT.skin || H.P[v * 3 + 2] < 0.04) continue;
    const u = H.UV[v * 2], w = H.UV[v * 2 + 1];
    if (u < 0 || u > 1 || w < 0 || w > 1) { problems.push(`${name}: the front of the face runs off the texture at ${P3(H.P, v).map((x) => x.toFixed(3))}`); break; }
  }
  // Hair. The long sheet hangs behind the nape on purpose, so only its front is held to the line.
  for (let s = 0; s < HAIR_STYLES; s++) {
    const m = hairMesh(s, lv);
    let worst = Infinity;
    for (let v = 0; v < m.P.length / 3; v++) {
      const [x, y, z] = P3(m.P, v);
      if (s === 3 && z < 0.03) continue;
      worst = Math.min(worst, y - hairlineAt(x, z));
    }
    if (worst < -0.001) problems.push(`${name}: hair style ${s} comes ${(-worst * 1000).toFixed(1)} mm below the hairline`);
    report(`  hair ${s}: ${(worst * 1000).toFixed(1)} mm clear of the hairline at its lowest`);
  }
}

// ── 2. The bones ────────────────────────────────────────────────────────────────────────────────────
const bk = actorBake(), bind = actorBind(), { nv, frames, preview, bones } = bk, T = ACTOR_HEAD_BONES.texels;
if (!(bones instanceof Float32Array) || bones.length !== frames * T * 4) problems.push(`bk.bones is ${bones?.length} floats; expected ${frames} frames × ${T} texels × 4`);
else {
  report(`bones: ${T} × ${frames} RGBA32F texels, ${(bones.byteLength / 1024).toFixed(1)} KB`);
  if (frames > 2048) problems.push(`${frames} frames of bones is past WebGL2's guaranteed 2048 rows`);
  if (bk.far.bones) problems.push('the far body carries bones; it keeps its own head');
  // A bone's matrix as rows, and a point through it.
  const row = (F, at, r, c) => bones[(F * T + at) * 4 + r * 4 + c];
  const ap = (F, at, p) => [0, 1, 2].map((r) => row(F, at, r, 0) * p[0] + row(F, at, r, 1) * p[1] + row(F, at, r, 2) * p[2] + row(F, at, r, 3));
  // The bake's own vertices that ride one bone alone: the old head on the head bone, and the old
  // neck's foot (and the coat's collar) on the neck bone.
  const alone = (b) => { const out = []; for (let v = 0; v < nv; v++) if (bind.b0[v] === b && bind.b1[v] === b && bind.w[v] === 1) out.push(v); return out; };
  const onHead = alone(ACTOR_BONE.head), onNeck = alone(ACTOR_BONE.neck);
  if (onHead.length < 50 || onNeck.length < 5) problems.push(`found ${onHead.length} vertices on the head bone alone and ${onNeck.length} on the neck's; the check below would prove nothing`);
  let miss = 0, rigid = 0;
  for (let F = 0; F < frames; F++) {
    for (const [at, vs] of [[ACTOR_HEAD_BONES.head, onHead], [ACTOR_HEAD_BONES.neck, onNeck]]) {
      for (let r = 0; r < 3; r++) {
        for (let r2 = 0; r2 < 3; r2++) {
          const d = row(F, at, 0, r) * row(F, at, 0, r2) + row(F, at, 1, r) * row(F, at, 1, r2) + row(F, at, 2, r) * row(F, at, 2, r2);
          rigid = Math.max(rigid, Math.abs(d - (r === r2 ? 1 : 0)));
        }
      }
      for (const v of vs) {
        const q = ap(F, at, P3(bind.p, v)), o = (F * nv + v) * 3;
        miss = Math.max(miss, Math.hypot(q[0] - preview[o], q[1] - preview[o + 1], q[2] - preview[o + 2]));
      }
    }
  }
  report(`bones agree with the bake to ${(miss * 1e6).toFixed(1)} µm, rigid to ${rigid.toExponential(1)}`);
  if (miss > 2e-5) problems.push(`a bone matrix puts the bake's own vertices ${(miss * 1000).toFixed(3)} mm from where the bake has them`);
  if (rigid > 1e-4) problems.push(`a bone matrix isn't a rotation (off by ${rigid.toExponential(1)})`);

  // The coat's torso, posed each frame: the biggest coat piece. Only its top matters here.
  const coat = pieces(nv, bind.idx).filter((t) => bind.mat[t[0]] === ACTOR_MAT.coat).sort((a, b) => b.length - a.length)[0];
  const yoke = [];
  for (let t = 0; t < coat.length; t += 3) if ([0, 1, 2].some((k) => bind.p[coat[t + k] * 3 + 1] > 1.3)) yoke.push(coat[t], coat[t + 1], coat[t + 2]);
  // The collar's lip is the torso's open edge at the top; its lowest point is how high the new
  // neck's foot has to stay hidden.
  const lipEdges = edges(coat).open.filter(([a]) => bind.p[a * 3 + 1] > 1.3), lip = [...new Set(lipEdges.flat())];
  const coatTop = Math.min(...lip.map((v) => bind.p[v * 3 + 1]));
  // Inside the coat: the yoke closed over by a fan across the lip, so a point is in it when it's
  // under the collar and within the coat's wall. Rays go upward, so they never reach the cut at
  // 1.3 m; three of them vote, in case one grazes an edge.
  const RAYS = [[0.57, 0.62, 0.54], [-0.63, 0.55, 0.55], [0.05, 0.6, -0.8]];
  const enclosed = (p, F) => {
    const at = (v) => P3(preview, F * nv + v), c = [0, 0, 0];
    for (const v of lip) { const q = at(v); c[0] += q[0] / lip.length; c[1] += q[1] / lip.length; c[2] += q[2] / lip.length; }
    let odd = 0;
    for (const d of RAYS) {
      let n = 0;
      for (let t = 0; t < yoke.length; t += 3) if (hit(p, d, at(yoke[t]), at(yoke[t + 1]), at(yoke[t + 2])) > 0) n++;
      for (const [a, b] of lipEdges) if (hit(p, d, c, at(a), at(b)) > 0) n++;
      odd += n % 2;
    }
    return odd >= 2;
  };
  // The neck's foot, below the coat's lowest collar point, at every level; it rides the neck bone.
  // The head, skull and ears, at L0; it rides the head bone. Checked on every other frame.
  const feet = HEAD_LEVELS.map((_, lv) => {
    const H = headMesh(lv), out = [];
    for (let v = 0; v < H.P.length / 3; v++) if (H.F[v] === HEAD_FEAT.neck && H.P[v * 3 + 1] < coatTop - 0.005 && H.W[v] === 0) out.push(P3(H.P, v));
    return out;
  });
  const H0 = headMesh(0), skin0 = [];
  for (let v = 0; v < H0.P.length / 3; v++) if ((H0.F[v] === HEAD_FEAT.skin || H0.F[v] === HEAD_FEAT.ear) && H0.P[v * 3 + 1] < 1.6) skin0.push(P3(H0.P, v));
  // The test itself: the neck joint, inside the collar, is enclosed; a point beside the shoulder isn't.
  for (const [p, want, what] of [[[0, 1.44, -0.01], true, 'the neck joint'], [[0.3, 1.44, -0.01], false, 'a point 0.3 m out'],
    [[0, 1.52, 0], false, 'a point above the collar']]) {
    if (enclosed(ap(0, ACTOR_HEAD_BONES.neck, p), 0) !== want) problems.push(`the inside test gets ${what} wrong; the collar check below proves nothing`);
  }
  let out = 0, inCoat = 0, where = '';
  const clipAt = (F) => Object.entries(bk.clips).find(([, c]) => F >= c.row0 && F < c.row0 + c.len)?.[0];
  for (let F = 0; F < frames; F += 2) {
    const at = (p) => `${clipAt(F)} frame ${F}, bind point ${p.map((x) => x.toFixed(3)).join(', ')}`;
    for (const lvFeet of feet) for (const p of lvFeet) if (!enclosed(ap(F, ACTOR_HEAD_BONES.neck, p), F)) { out++; where ||= at(p); }
    for (const p of skin0) if (enclosed(ap(F, ACTOR_HEAD_BONES.head, p), F)) { inCoat++; where ||= at(p); }
  }
  report(`collar: ${feet.map((f) => f.length).join(' / ')} foot points a level held under ${coatTop.toFixed(3)}; ${skin0.length} jaw and ear points kept out of the coat`);
  if (out) problems.push(`${out} points of the new neck's foot show outside the coat's collar (first in ${where})`);
  if (inCoat) problems.push(`${inCoat} points of the head go into the coat (first in ${where})`);
}

if (problems.length) {
  console.error('actor-head: FAIL');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
report('actor-head: ok');
