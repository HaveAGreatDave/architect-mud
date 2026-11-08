// GLASS 2 · THE VEHICLE INK: the comic look's lines on the vehicle you're in (V2 of
// docs/proposals/vehicle-comic.md).
//
// A figure gets its line from an inverted hull (gl/ink.js): the body drawn again in ink, pushed out
// along its normals. That needs normals shared across a smooth surface, and a vehicle is a
// flat-shaded face soup whose faces each carry their own, so a hull pushed out along them splits
// open at every crease. So a vehicle's line is drawn from its EDGES instead, the classic GPU
// silhouette-edge method:
//
//   · Once per mesh, every edge is found with the two faces either side of it, and filed as a
//     crease (the faces meet at more than about 39°), a part line (two parts meet: a wing on the
//     body, a door in a cab, authored `part` ids or else the role), a seam (one face only: a hinge
//     line, a panel's open edge) or smooth.
//   · Each frame the vertex shader draws an edge if it's a silhouette (one face toward the eye and
//     one away), at the house outline width, up to HOUSE.weigh times as wide on the side away from
//     the sun; or, at half that width, if it's a crease, a part line or a seam.
//   · Each edge is a quad widened in screen pixels, pulled a little toward the eye along its own
//     ray so it wins against its own faces and loses to anything nearer.
//
// ⚠ ONLY THE OWN SHIP, IN ITS OWN FRAME. Its records carry local points (`mp`) and the mesh face
// they came from (`src`, windshield.js), and one matrix places them. A record is the same object
// frame to frame unless its face moved (a hinged surface, the gear), so only the edges of moved
// faces are rewritten. The edge list itself is rebuilt only when the SET of faces changes (the gear
// stowing, another class), never because a face moved: a deflected aileron keeps the topology its
// rest pose had, and its hinge, filed then as two faces' shared edge, is drawn on the wing's side.
//
// ⚠ OFF IS OFF. Nothing is uploaded or drawn unless the comic look is on (gl/house-style.js
// vehicleInkOf) and the toon switch with it; the mirror and the film draws never get it.
//
// ⚠ THIN PARTS GET THEIR SILHOUETTE ONLY: gear, struts, guns and two-sided sheets. A crease line on
// each side of a strut a few pixels wide fills it in black (the city's balcony rails, glass-notes.md).
// Glass never takes a crease inside itself, only its frame. The cabin (`interior`) takes none.

import { viewProjMatrix, eyePos } from './camera.js';
import { declareProgram, layerProgram } from './programs.js';
import { linearOut, applyLinOut } from './colour.js';
import { vehicleInkOf, cabinInkOf } from './house-style.js';

export const VINK = {
  crease: 0.78,    // cos of the angle past which two faces' edge is a crease (about 39°)
  flat: 0.9995,    // two faces this close to one plane, of one part, share no line and can't be a silhouette
  q: 1e4,          // a local point is matched to another at 1/q of a model unit (the model is two units long)
  pull: 0.004,     // how far an edge is pulled toward the eye, as a share of its distance
  minLen: 4,       // a panel line shorter on screen than this many of its own widths isn't drawn
};
export const EDGE = { smooth: 0, crease: 1, part: 2, seam: 4 };
const THIN_ROLE = new Set(['gear', 'strut', 'gun', 'rotor']);
const GLASS_ROLE = new Set(['glass', 'window']);
const SKIP_ROLE = new Set(['interior']);

const partOf = (s) => (s && (s.part ?? s.role)) || '';
const roleOf = (s) => (s && s.role) || '';

/**
 * A record's local normal, turned away from its face's `cen` as windshield.js turns it, so the
 * silhouette test agrees with the shading. `mp` is the record's local points.
 */
export function faceNormal(mp, cen) {
  const p0 = mp[0], p1 = mp[1], p2 = mp[2];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2], bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
  const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
  const c = cen || [0, 0, 0];
  const qx = (p0[0] + p1[0] + p2[0]) / 3 - c[0], qy = (p0[1] + p1[1] + p2[1]) / 3 - c[1], qz = (p0[2] + p1[2] + p2[2]) / 3 - c[2];
  return x * qx + y * qy + z * qz < 0 ? [-x, -y, -z] : [x, y, z];
}

/**
 * The edge list for a list of records ({ mp, src }), pure. Each edge is { fa, j, fb, kind, thin }:
 * its owner face `fa` draws it from its own points j and j+1, `fb` is the face across it or -1.
 * Edges come grouped by owner, so a moved face's edges are one run.
 */
export function buildEdges(recs) {
  const key = (p) => Math.round(p[0] * VINK.q) + ',' + Math.round(p[1] * VINK.q) + ',' + Math.round(p[2] * VINK.q);
  const N = recs.map((r) => faceNormal(r.mp, r.src && r.src.cen));
  const map = new Map();
  for (let f = 0; f < recs.length; f++) {
    const r = recs[f];
    if (SKIP_ROLE.has(roleOf(r.src))) continue;
    const P = r.mp, n = P.length;
    for (let j = 0; j < n; j++) {
      const a = key(P[j]), b = key(P[(j + 1) % n]);
      if (a === b) continue;
      const k = a < b ? a + '|' + b : b + '|' + a;
      const e = map.get(k);
      if (!e) map.set(k, { fa: f, j, fb: -1, more: null });
      else if (e.fb < 0 && e.fa !== f) e.fb = f;
      else if (e.fa !== f && e.fb !== f) (e.more || (e.more = [])).push(f);
    }
  }
  const edges = [];
  for (const e of map.values()) {
    // Past two faces on one edge, the one turned furthest from the owner is the one that decides.
    if (e.more) for (const f of e.more) {
      const d = N[e.fa][0] * N[f][0] + N[e.fa][1] * N[f][1] + N[e.fa][2] * N[f][2];
      const d0 = N[e.fa][0] * N[e.fb][0] + N[e.fa][1] * N[e.fb][1] + N[e.fa][2] * N[e.fb][2];
      if (d < d0) e.fb = f;
    }
    const A = recs[e.fa].src, B = e.fb >= 0 ? recs[e.fb].src : null;
    const thin = THIN_ROLE.has(roleOf(A)) || (A && A.two) || (B && (THIN_ROLE.has(roleOf(B)) || B.two)) ? 1 : 0;
    let kind;
    if (e.fb < 0) kind = EDGE.seam;
    else {
      const na = N[e.fa], nb = N[e.fb], d = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
      const glass = GLASS_ROLE.has(roleOf(A)) && GLASS_ROLE.has(roleOf(B));
      if (d < VINK.crease) kind = glass ? EDGE.smooth : EDGE.crease;
      else if (partOf(A) !== partOf(B)) kind = EDGE.part;
      else if (d > VINK.flat) continue;
      else kind = EDGE.smooth;
    }
    edges.push({ fa: e.fa, j: e.j, fb: e.fb, kind, thin });
  }
  edges.sort((a, b) => a.fa - b.fa);
  return edges;
}

// ── THE LAYER ─────────────────────────────────────────────────────────────────────────────────────
// Four vertices an edge: its two ends, both faces' normals, its kind and flags, and which corner.
const STRIDE = 16;   // A3 B3 N1 3 N2 3 E2 (kind, flags: 1 thin, 2 open; -1 kind hides it) Q2 (end, side)
const CORNER = [[0, -1], [0, 1], [1, 1], [1, -1]];

const VERT = `#version 300 es
layout(location = 0) in vec3 aA;
layout(location = 1) in vec3 aB;
layout(location = 2) in vec3 aN1;
layout(location = 3) in vec3 aN2;
layout(location = 4) in vec2 aE;
layout(location = 5) in vec2 aQ;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uEyeL;      // the eye in the ship's own frame
uniform vec3 uSunL;      // the way to the sun in the ship's own frame
uniform vec2 uRes;       // the target, in device pixels
uniform vec3 uW;         // outline width, detail width, the weight on the side away from the sun
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
// The cockpit's attitude (solids.js seatAtt, the same function): its points are cab-local, the eye at
// the origin, and the seat's look, roll and shear are applied before the model matrix.
uniform vec4 uAttA; uniform vec4 uAttB; uniform float uAttOn;
vec3 seatAtt(vec3 q) {
  if (uAttOn < 0.5) return q;
  float cy = uAttA.x, sy = uAttA.y, cb = uAttA.z, sb = uAttA.w;
  float f = q.y * cy + q.x * sy, r = q.x * cy - q.y * sy, u = q.z;
  float r2 = r * cb + uAttB.x * u * sb, u2 = u * cb - uAttB.y * r * sb;
  if (f > 0.0) { r2 += uAttB.z * f; u2 -= uAttB.w * f; }
  return vec3(r2 * cy + f * sy, f * cy - r2 * sy, u2);
}
out float vFog;
const vec4 GONE = vec4(2.0, 2.0, 2.0, 1.0);
void main() {
  vFog = 0.0;
  int kind = int(aE.x + 0.5);
  if (aE.x < -0.5) { gl_Position = GONE; return; }
  float flags = aE.y;
  bool thin = mod(flags, 2.0) > 0.5, open = flags > 1.5;
  vec3 mid = 0.5 * (aA + aB), V = uEyeL - mid;
  float f1 = dot(aN1, V), f2 = dot(aN2, V);
  bool sil = !open && ((f1 > 0.0) != (f2 > 0.0));
  bool front = f1 > 0.0 || (!open && f2 > 0.0);
  float w = 0.0;
  if (front) {
    if (sil) w = uW.x * mix(uW.z, 1.0, smoothstep(-0.5, 0.7, dot(normalize(aN1 + aN2 + vec3(1e-5)), uSunL)));
    else if (!thin && (kind == 1 || kind == 2 || kind == 4)) w = uW.y;
  }
  if (w <= 0.0) { gl_Position = GONE; return; }
  vec4 pa = uViewProj * (uModel * vec4(seatAtt(mix(aA, uEyeL, ${VINK.pull})), 1.0));
  vec4 pb = uViewProj * (uModel * vec4(seatAtt(mix(aB, uEyeL, ${VINK.pull})), 1.0));
  const float E = 0.002;
  if (pa.w < E && pb.w < E) { gl_Position = GONE; return; }
  if (pa.w < E) pa = mix(pa, pb, (E - pa.w) / (pb.w - pa.w));
  if (pb.w < E) pb = mix(pb, pa, (E - pb.w) / (pa.w - pb.w));
  vec2 sa = pa.xy / pa.w * uRes * 0.5, sb = pb.xy / pb.w * uRes * 0.5;
  vec2 dir = sb - sa;
  float L = length(dir);
  // A panel line shorter on screen than a few of its own widths is dropped: far off, every edge is
  // that short and the lines pile into a black blob (the Drake's ruff at range). The outline keeps
  // every edge, short or not, or a curve's silhouette would break up.
  if (!sil && L < ${VINK.minLen.toFixed(1)} * w) { gl_Position = GONE; return; }
  dir = L > 1e-4 ? dir / L : vec2(1.0, 0.0);
  vec2 nr = vec2(-dir.y, dir.x);
  bool atA = aQ.x < 0.5;
  vec4 p = atA ? pa : pb;
  vec2 s = (atA ? sa : sb) + nr * aQ.y * w * 0.5 + dir * (atA ? -0.5 : 0.5) * w;
  gl_Position = vec4(s / (uRes * 0.5) * p.w, p.z, p.w);
  float ff = clamp((p.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;
const FRAG = linearOut(`#version 300 es
precision highp float;
in float vFog;
uniform vec3 uInkCol;
uniform vec3 uFog;
out vec4 outColor;
void main() { outColor = vec4(mix(uInkCol, uFog, vFog), 1.0); }`, 'outColor');
declareProgram(VERT, FRAG);

// `cabin`: the cockpit's lines (V5). Its records are cab-local (`mp`) with no mesh face; a face
// with no material (lettering, a gauge face, a lamp) and glass take no line, its own colour stands in
// for a part, and every normal is turned toward the eye at the origin, so only creases, part lines
// and open edges draw, all at the thin cabin width (cabinInkOf).
export function createVehicleInkLayer(gl, { cabin = false } = {}) {
  let prog = null, loc = null, vao = null, vbo = null, ibo = null;
  let edges = [], sig = '', data = null, cap = 0, last = [], model = null, ship = null;
  const normals = new WeakMap();
  const normalOf = (r) => { let n = normals.get(r); if (!n) { n = faceNormal(r.mp, r.src && r.src.cen); normals.set(r, n); } return n; };
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => { let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };

  function build() {
    prog = layerProgram(gl, VERT, FRAG, 'vehicle ink');
    const u = (n) => gl.getUniformLocation(prog, n);
    loc = { attA: u('uAttA'), attB: u('uAttB'), attOn: u('uAttOn'), vp: u('uViewProj'), model: u('uModel'), eye: u('uEyeL'), sun: u('uSunL'), res: u('uRes'), w: u('uW'),
      fogNear: u('uFogNear'), fogFar: u('uFogFar'), fogAmt: u('uFogAmt'), ink: u('uInkCol'), fog: u('uFog') };
    vao = gl.createVertexArray();
    vbo = gl.createBuffer(); ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 3, 36], [4, 2, 48], [5, 2, 56]].forEach(([i, n, o]) => {
      gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, STRIDE * 4, o);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
  }

  // One edge's four vertices into `data`.
  function writeEdge(k, recs) {
    const e = edges[k], ra = recs[e.fa], P = ra.mp, A = P[e.j], B = P[(e.j + 1) % P.length];
    const n1 = normalOf(ra), n2 = e.fb >= 0 ? normalOf(recs[e.fb]) : n1;
    const hide = !(ra.a == null || ra.a >= 0.5);
    const kind = hide ? -1 : e.kind, flags = e.thin + (e.fb < 0 ? 2 : 0);
    let o = k * 4 * STRIDE;
    for (const q of CORNER) {
      data[o] = A[0]; data[o + 1] = A[1]; data[o + 2] = A[2];
      data[o + 3] = B[0]; data[o + 4] = B[1]; data[o + 5] = B[2];
      data[o + 6] = n1[0]; data[o + 7] = n1[1]; data[o + 8] = n1[2];
      data[o + 9] = n2[0]; data[o + 10] = n2[1]; data[o + 11] = n2[2];
      data[o + 12] = kind; data[o + 13] = flags; data[o + 14] = q[0]; data[o + 15] = q[1];
      o += STRIDE;
    }
  }

  // `list` is the own ship's GL records (those with `mp`), `M` its model matrix, `S` its shipState.
  // Returns the edges it holds. Costs a pass over the list when nothing moved.
  // A cockpit record, as the builder wants it: its colour as its part, its normal toward the eye.
  const cabRecs = new WeakMap();
  const cabRec = (r) => {
    let w = cabRecs.get(r);
    if (!w || w.mp !== r.mp) {
      const P = r.mp, n = P.length;
      let x = 0, y = 0, z = 0;
      for (const p of P) { x += p[0]; y += p[1]; z += p[2]; }
      // The MATERIAL is the part, never the colour: the Drake's veneer is bands of walnut tones laid as
      // strips (interior-drake.js woodGrain), and keyed on colour every band took an ink line, so the
      // grain came out as black scribble. Wood on plastic is a line; two tones of wood aren't.
      const key = 't' + r.tex;
      w = { mp: P, a: r.a, rec: r, src: (w && w.src && w.src.part === key) ? w.src : { part: key, role: '', cen: [2 * x / n, 2 * y / n, 2 * z / n] } };
      cabRecs.set(r, w);
    }
    return w;
  };
  let att = null;
  function upload(list, M, S, A) {
    model = M; ship = S; att = A || null;
    const recs = !list || !M ? [] : cabin
      ? list.filter((r) => r.mp && r.tex > 0 && r.tex !== 10 && !r.film && r.mp.length >= 3).map(cabRec)
      : list.filter((r) => r.mp && r.src);
    if (!recs.length) { edges = []; sig = ''; last = []; return 0; }
    if (!prog) build();
    let h = recs.length + ':';
    for (let i = 0; i < recs.length; i++) h += idOf(recs[i].src).toString(36) + ',';
    const fresh = h !== sig;
    if (fresh) {
      sig = h;
      edges = buildEdges(recs);
      // A cockpit lays trim on its panels as flat strips (the Drake's slats), every one of them all
      // open edges, so in the cabin an open edge draws nothing: only folds and changes of material.
      if (cabin) edges = edges.filter((e) => e.kind !== EDGE.seam);
      if (edges.length * 4 * STRIDE > cap) { cap = edges.length * 4 * STRIDE; data = new Float32Array(cap); }
      const idx = new Uint32Array(edges.length * 6);
      for (let k = 0; k < edges.length; k++) idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      for (let k = 0; k < edges.length; k++) writeEdge(k, recs);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, edges.length * 4 * STRIDE), gl.DYNAMIC_DRAW);
      last = recs.slice();
      return edges.length;
    }
    // The same faces: rewrite only the edges of a face whose record changed (it moved, or faded).
    const moved = new Uint8Array(recs.length);
    let any = false;
    for (let i = 0; i < recs.length; i++) if (recs[i] !== last[i]) { moved[i] = 1; any = true; }
    if (!any) return edges.length;
    const spans = [];
    let s0 = -1, s1 = -1;
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k];
      if (!moved[e.fa] && !(e.fb >= 0 && moved[e.fb])) continue;
      writeEdge(k, recs);
      if (k === s1) s1 = k + 1; else { if (s0 >= 0) spans.push([s0, s1]); s0 = k; s1 = k + 1; }
    }
    if (s0 >= 0) spans.push([s0, s1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    if (spans.length > 48) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, edges.length * 4 * STRIDE);
    else for (const [a, b] of spans) gl.bufferSubData(gl.ARRAY_BUFFER, a * 4 * STRIDE * 4, data, a * 4 * STRIDE, (b - a) * 4 * STRIDE);
    last = recs.slice();
    return edges.length;
  }

  function draw(cam, cssH, opts = {}) {
    const K = cabin ? cabinInkOf(gl.drawingBufferWidth) : vehicleInkOf(gl.drawingBufferWidth);
    if (!K || !edges.length || !model || (!cabin && (!ship || !ship.nmat))) return 0;
    gl.useProgram(prog); applyLinOut(gl, prog);
    gl.uniform1f(loc.attOn, cabin && att ? 1 : 0);
    if (cabin && att) { gl.uniform4f(loc.attA, att.cy, att.sy, att.cb, att.sb); gl.uniform4f(loc.attB, att.kr, att.ku, att.hr, att.hu); }
    gl.uniformMatrix4fv(loc.vp, false, opts.vp || viewProjMatrix(cam, cssH, opts.near, opts.far));
    gl.uniformMatrix4fv(loc.model, false, model);
    // The eye and the sun in the ship's frame: nmat is the inverse-transpose of the model's 3x3, so
    // its transpose is the inverse, and n·d is the same number in both frames.
    if (cabin) { gl.uniform3f(loc.eye, 0, 0, 0); gl.uniform3f(loc.sun, 0, 0, 1); }
    else {
      const N = ship.nmat, e = eyePos(cam), d = [e[0] - model[12], e[1] - model[13], e[2] - model[14]];
      const tr = (v) => [N[0] * v[0] + N[1] * v[1] + N[2] * v[2], N[3] * v[0] + N[4] * v[1] + N[5] * v[2], N[6] * v[0] + N[7] * v[1] + N[8] * v[2]];
      const el = tr(d);
      gl.uniform3f(loc.eye, el[0], el[1], el[2]);
      const sw = ship.sun || [0, 0, 1], sl = tr(sw), slen = Math.hypot(sl[0], sl[1], sl[2]) || 1;
      gl.uniform3f(loc.sun, sl[0] / slen, sl[1] / slen, sl[2] / slen);
    }
    gl.uniform2f(loc.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform3f(loc.w, K.sil, K.detail, K.weigh);
    gl.uniform3f(loc.ink, K.col[0], K.col[1], K.col[2]);
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    // Opaque ink, and it WRITES DEPTH like the solid it is: the floor and the sea are drawn after the
    // solids (world.js), so a line that wrote none was painted over wherever it stood off the hull,
    // which is the whole outside half of every silhouette.
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, edges.length * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    return edges.length;
  }

  return { upload, draw, edges: () => edges.length };
}
