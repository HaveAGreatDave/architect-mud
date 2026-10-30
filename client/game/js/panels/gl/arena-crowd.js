// GLASS 2 · THE RINK'S CROWD, AND THE BOWL THEY SIT IN.
//
// A bowl of seats round the whole sheet, row on row behind the glass and following its rounded
// corners, and a fan in as many of them as the night draws: Deadball's fan (gl/ballpark-mesh.js
// crowdMorph), one figure in three poses, instanced once a seat, so a full house is one draw call.
// The vertex shader is gl/crowd.js's turned onto the rink's axes (z up, not y): each fan sits until
// the roar passes his own threshold, then stands and cheers on his own beat.
//
//   · HOW FULL. The narrator puts `gate` on every payload, the share of the seats sold (a Cup
//     final sells out, a grudge match or two of the best fill most of it, two of the worst about
//     half). The fans fill the best seats first: low, near centre ice, with some give, so a thin
//     house leaves the upper corners and the ends empty, the way a real one does. The renderer's
//     quality rungs thin that again (`crowd`), evenly, for a device that can't keep up.
//   · WHOSE. Most wear the home club's colour or its trim, or their own clothes; the visitors'
//     fans wear theirs, a few scattered and the rest in one corner. Each side stands up for its
//     own goals.
//   · TWO TIERS. `LOWER` rows, a walkway and a fascia, then the upper tier to the back wall,
//     which runs up to a roof over the stands (none over the ice, so a high camera sees down).
//   · WHAT EACH VIEW SHOWS. The broadcast cameras sit in the near stands, so the near side isn't
//     drawn for them (it would stand between the lens and the ice). The vertical camera looks
//     down the sheet from above the left end (rink/camera.js keeps its eye clear of the bowl),
//     and a seat in the stands (stands.js) is in the bowl, so both draw the whole ring and drop
//     only the fans within `nearR` of the eye. `HIDE` is the plane each view drops, and the
//     bowl's static seats are built in four layers by `layerOf`.
//
// Pure apart from the shaders' source: no DOM, no GL. arena.js owns the buffers and the draw.

import { RL, RW, RC } from '../rink/geo.js';

export const LOWER = 16, ROWS = 30, ROW_D = 3, ROW_Z = 2.2, D0 = 4, Z0 = 4.2, SEAT_W = 2.2;
// the walkway between the tiers, out and up
export const GAP_D = 7, GAP_Z = 9;
// how high the roof over the stands is
export const ROOF_Z = 190;
// the vault over it all, as on the outside (glass/models/ashway.js rinkHall): its rise over the
// wall's top, the truss every VAULT_BAY ft down the length, and the great window's end (+x)
export const VAULT_RISE = 85, VAULT_BAY = 25;
// a row's distance out from the boards and its tread's height
export const rowD = (i) => D0 + ROW_D * i + (i >= LOWER ? GAP_D : 0), rowZ = (i) => Z0 + ROW_Z * i + (i >= LOWER ? GAP_Z : 0);
// The plane a view drops: [a, b, c, d], a point with a·x + b·y + c·z + d > 0 isn't drawn.
export const HIDE = { near: [0, -1, 0, -1], none: [0, 0, 0, -1] };
// the views whose camera is inside the ring, which draw all of it
export const seesRing = (view) => view === 'vertical' || view === 'seat';
export const hideFor = (view) => (seesRing(view) ? HIDE.none : HIDE.near);
// how close to the eye a fan may sit before he's dropped, ft: the man beside you stays
export const nearR = (view) => (view === 'vertical' ? 14 : view === 'seat' ? 1.6 : 0);
// how far a seated fan's eye is above his tread, ft: a seat's eye sits this high in its row, and
// the fan dropped is the one on that tread, so the men either side are at your shoulder
export const SEAT_EYE = 3.8;
export const nearDrop = (view) => (view === 'seat' ? SEAT_EYE : 0);
// which of the bowl's four layers a point is in: 1 on the near side, 2 at the left end
export const layerOf = (x, y) => (y < -1 ? 1 : 0) + (x < -1 ? 2 : 0);

// The boards' outline pushed out by `d`: points every `step` ft or less round it, each with its
// outward normal. Straights along the sides and ends, quarter circles round the corners.
export function bowlPath(d, step) {
  const R = RC + d, out = [];
  const corners = [[RL - RC, RC, -Math.PI / 2], [RL - RC, RW - RC, 0], [RC, RW - RC, Math.PI / 2], [RC, RC, Math.PI]];
  const straights = [[[RC, -d], [RL - RC, -d], [0, -1]], [[RL + d, RC], [RL + d, RW - RC], [1, 0]], [[RL - RC, RW + d], [RC, RW + d], [0, 1]], [[-d, RW - RC], [-d, RC], [-1, 0]]];
  for (let k = 0; k < 4; k++) {
    const [a, b, n] = straights[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < m; i++) { const t = i / m; out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, nx: n[0], ny: n[1] }); }
    const [cx, cy, a0] = corners[k], m2 = Math.max(2, Math.ceil(R * Math.PI / 2 / step));
    for (let i = 0; i < m2; i++) { const th = a0 + (i / m2) * Math.PI / 2; out.push({ x: cx + Math.cos(th) * R, y: cy + Math.sin(th) * R, nx: Math.cos(th), ny: Math.sin(th) }); }
  }
  return out;
}

const hash = (k, s) => {
  let h = Math.imul((k | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

// Every seat in the bowl, in the order they sell: [{ x, y, z, yaw }]. A seat's place in the queue
// is how far up it is, how far from centre ice, the ends a little worse than the corners, and a
// good deal of chance, so a half house is patchy rather than a clean line.
let _seats = null;
export function rinkSeats() {
  if (_seats) return _seats;
  const out = [];
  for (let i = 0; i < ROWS; i++) {
    const d = rowD(i) + 2.0, z = rowZ(i);
    const P = bowlPath(d, 0.5);
    // the row's length, then a seat every SEAT_W along it
    let L = 0; const cum = [0];
    for (let k = 1; k <= P.length; k++) { const a = P[k - 1], b = P[k % P.length]; L += Math.hypot(b.x - a.x, b.y - a.y); cum.push(L); }
    const n = Math.floor(L / SEAT_W);
    let k = 0;
    for (let s = 0; s < n; s++) {
      const at = (s + 0.5) * (L / n);
      while (cum[k + 1] < at) k++;
      const a = P[k], b = P[(k + 1) % P.length], t = (at - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
      const id = i * 4096 + s;
      const centre = Math.abs(x - RL / 2) / (RL / 2), end = x < 0 || x > RL ? 0.6 : 0;
      out.push({ x, y, z, yaw: Math.atan2(-ny, -nx), id, rank: i / ROWS * 1.1 + centre * 0.55 + end + hash(id, 7) * 0.9 });
    }
  }
  out.sort((a, b) => a.rank - b.rank);
  _seats = out;
  return out;
}

// The fans, as instances, 11 floats each: where (x, y, z) and which way (yaw); his shirt and his
// size, the size negative for a visitors' fan; his skin. `kits` is the two sides' kits ({ a, h },
// hex colours), whose colours the fans wear. Grouped by `layerOf`, each group in the order its
// seats sell (`start` and `count` a group), so a view draws only the groups it shows, each
// filled to the gate, and a stand it hides costs nothing.
export const INST = 11;
const SKINS = [[0.89, 0.71, 0.58], [0.8, 0.6, 0.45], [0.66, 0.47, 0.33], [0.48, 0.33, 0.22], [0.33, 0.22, 0.15], [0.93, 0.78, 0.66]];
const OWN = [[0.08, 0.08, 0.09], [0.36, 0.37, 0.4], [0.82, 0.82, 0.8], [0.12, 0.16, 0.3], [0.24, 0.32, 0.46], [0.42, 0.13, 0.12], [0.2, 0.3, 0.2], [0.55, 0.47, 0.36]];
const rgb01 = (hex) => { const n = parseInt(String(hex || '#808080').slice(1, 7), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
export function crowdInstances(kits) {
  const seats = rinkSeats(), out = new Float32Array(seats.length * INST);
  const count = [0, 0, 0, 0];
  for (const s of seats) count[layerOf(s.x, s.y)]++;
  const start = [0, count[0], count[0] + count[1], count[0] + count[1] + count[2]], at = start.slice();
  const home = rgb01(kits?.h?.jersey), homeT = rgb01(kits?.h?.trim), away = rgb01(kits?.a?.jersey), awayT = rgb01(kits?.a?.trim);
  seats.forEach((s) => {
    const r = hash(s.id, 11), r2 = hash(s.id, 13);
    // the visitors' corner: far right, where their bench is; a few anywhere else
    const awayCorner = s.x > RL - 50 && s.y > RW - 10;
    const isAway = awayCorner ? r < 0.6 : r < 0.05;
    // (the road club wears white with its colour as trim, so its fans mostly wear the trim)
    const shirt = isAway ? (r2 < 0.5 ? awayT : r2 < 0.7 ? away : OWN[Math.floor(r2 * 97) % OWN.length])
      : (r2 < 0.38 ? home : r2 < 0.5 ? homeT : OWN[Math.floor(r2 * 131) % OWN.length]);
    const skin = SKINS[Math.floor(hash(s.id, 17) * SKINS.length)], size = 0.92 + 0.16 * hash(s.id, 19);
    out.set([s.x, s.y, s.z, s.yaw, shirt[0], shirt[1], shirt[2], isAway ? -size : size, skin[0], skin[1], skin[2]], at[layerOf(s.x, s.y)]++ * INST);
  });
  return { data: out, start, count };
}

// THE BOWL ITSELF, into four batches by `layerOf` (arena.js's `M`, and a batch maker): for each
// row the riser up from the row below, the tread, and a seat a place (its back and its pan), so
// an empty seat shows as one. Between the tiers a walkway, its fascia a red band; behind the last
// row the back wall up to the roof, and the roof back in to the boards' line.
export function buildBowl(M, batches) {
  const tread = M.rgb('#0d1116'), riser = M.rgb('#161c24'), back = M.rgb('#4a161b'), pan = M.rgb('#3a1115'), wall = M.rgb('#0a0d11');
  const walk = M.rgb('#14181e'), fascia = M.rgb('#5a1a20'), roof = M.rgb('#07090c');
  const up = [0, 0, 1];
  // a ring of quads between two outlines, (d0, z0) to (d1, z1)
  const ring = (d0, z0, d1, z1, col, n) => {
    const P = bowlPath(d0, 6);
    for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length], bl = batches[layerOf((a.x + b.x) / 2, (a.y + b.y) / 2)];
      const o = (p, dd, zz) => [p.x + p.nx * dd, p.y + p.ny * dd, zz];
      M.quad(bl, o(a, 0, z0), o(b, 0, z0), o(b, d1 - d0, z1), o(a, d1 - d0, z1), col, null, n || [-(a.nx + b.nx) / 2, -(a.ny + b.ny) / 2, 0]);
    }
  };
  for (let i = 0; i < ROWS; i++) {
    const d = rowD(i), z = rowZ(i), zb = i ? rowZ(i - 1) : 0;
    if (i === LOWER) {
      // the walkway out from the last lower row, then the fascia up to the upper tier
      const dw = rowD(i - 1) + ROW_D;
      ring(dw, zb, d, zb, walk, up);
      ring(d, zb, d, zb + 1.2, riser);
      ring(d, zb + 1.2, d, z - 1.2, fascia);
      ring(d, z - 1.2, d, z, riser);
    } else ring(d, zb, d, z, riser);
    ring(d, z, d + ROW_D, z, tread, up);
    if (i === ROWS - 1) {
      ring(d + ROW_D, z, d + ROW_D, ROOF_Z, wall);
      // a ledge out from the wall's top to the vault's feet, under the corners the vault squares off
      ring(d + ROW_D, ROOF_Z, d + ROW_D + 60, ROOF_Z, roof, [0, 0, -1]);
      buildVault(M, batches, d + ROW_D);
    }
  }
  // the seats: a back and a pan a place, facing the ice
  for (const s of rinkSeats()) {
    const fx = Math.cos(s.yaw), fy = Math.sin(s.yaw), rx = -fy, ry = fx, hw = SEAT_W * 0.42;
    const bl = batches[layerOf(s.x, s.y)];
    const P = (f, r, zz) => [s.x + fx * f + rx * r, s.y + fy * f + ry * r, s.z + zz];
    M.quad(bl, P(-0.55, -hw, 1.25), P(-0.55, hw, 1.25), P(-0.75, hw, 2.85), P(-0.75, -hw, 2.85), back, null, [fx, fy, 0.25]);
    M.quad(bl, P(-0.5, -hw, 1.25), P(-0.5, hw, 1.25), P(0.75, hw, 1.4), P(0.75, -hw, 1.4), pan, null, up);
  }
}

// The fans' vertex shader: gl/crowd.js's, on the rink's axes. The figure is built facing +z with
// y up (ballpark-mesh.js); here it faces `yaw` across the rink with z up. A fan past the view's
// `uHide` plane, or within uNear.w of the eye (uNear.xyz), is put outside the picture.
export const RINK_CROWD_VS = `#version 300 es
layout(location = 0) in vec3 aSit;
layout(location = 1) in vec3 aSitN;
layout(location = 2) in vec3 aStand;
layout(location = 6) in vec3 aStandN;
layout(location = 7) in vec3 aCheer;
layout(location = 8) in vec3 aCheerN;
layout(location = 9) in float aPart;
layout(location = 3) in vec4 iA;
layout(location = 4) in vec4 iB;
layout(location = 5) in vec3 iC;
uniform mat4 uVP;
uniform vec2 uShake;
uniform vec2 uRoar;
uniform float uT;
uniform float uMove;
uniform vec4 uHide;
uniform vec4 uNear;
out vec3 vPos; out vec3 vN; out vec3 vAlb;
float hash(vec2 p, vec2 k, float m) { return fract(sin(dot(p, k)) * m); }
void main() {
  if (dot(uHide.xyz, iA.xyz) + uHide.w > 0.0 || distance(iA.xyz, uNear.xyz) < uNear.w) { vPos = vec3(0.0); vN = vec3(0.0, 0.0, 1.0); vAlb = vec3(0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float h = hash(iA.xy, vec2(12.99, 78.23), 43758.5), h2 = hash(iA.xy, vec2(39.35, 11.13), 24634.6);
  float roar = iB.w < 0.0 ? uRoar.y : uRoar.x;
  float thr = 0.12 + 0.75 * h2, up = smoothstep(thr, thr + 0.18, roar);
  vec3 p = up < 0.5 ? mix(aSit, aStand, up * 2.0) : mix(aStand, aCheer, up * 2.0 - 1.0);
  vec3 n = up < 0.5 ? mix(aSitN, aStandN, up * 2.0) : mix(aStandN, aCheerN, up * 2.0 - 1.0);
  float joy = up * uMove;
  p.y += joy * 0.22 * max(0.0, sin(uT * 7.0 + h * 6.283));
  p.x += joy * max(0.0, p.y - 3.0) * 0.06 * sin(uT * 4.3 + h2 * 6.283);
  // seated, now and then he shifts in his seat
  p.x += (1.0 - up) * max(0.0, p.y - 2.0) * 0.05 * sin(uT * 0.7 + h * 40.0);
  p *= abs(iB.w);
  float c = cos(iA.w), s = sin(iA.w);
  vec3 w = iA.xyz + vec3(-s * p.x + c * p.z, c * p.x + s * p.z, p.y);
  vN = vec3(-s * n.x + c * n.z, c * n.x + s * n.z, n.y);
  vec3 pants = mix(vec3(0.05, 0.06, 0.09), vec3(0.16, 0.14, 0.11), h);
  vAlb = aPart < 0.5 ? iC : (aPart < 1.5 ? iB.rgb : (aPart < 2.5 ? pants : vec3(0.04, 0.03, 0.025) + 0.06 * h));
  vPos = w;
  vec4 q = uVP * vec4(w, 1.0);
  q.xy += uShake * q.w;
  gl_Position = q;
}`;
// Lit as arena.js lights the bodies, from the same key, but the stands are dimmer than the sheet
// (uDim), and a death takes the colour out of them too.
export const RINK_CROWD_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec3 vAlb;
uniform float uDim;
uniform float uMourn;
out vec4 outColor;
const vec3 L = vec3(0.2453, -0.4416, 0.8635);
void main() {
  vec3 n = normalize(vN);
  float diff = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.z;
  vec3 rgb = vAlb * (0.3 + 0.24 * hemi + 0.6 * diff) * uDim;
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75) * (1.0 - 0.22 * uMourn);
  outColor = vec4(rgb, 1.0);
}`;

// How loud each side's fans are from the world: the building's roar (W.crowd, 0.15 when quiet,
// 1 on a goal) for both, except while the lamp is on, when the side that scored is on its feet
// and the other side sits in silence. [home, away].
export function roarOf(W) {
  const k = Math.min(1, Math.max(0, ((W.crowd || 0) - 0.25) / 0.75)) * (1 - (W.mourning || 0));
  if (W.lamp > 0 && W.lampSide) { const homeScored = W.lampSide === 'a'; return homeScored ? [k, 0.05] : [0.05, k]; }
  return [k, k * 0.8];
}

// THE VAULT, as the outside has it (glass/models/ashway.js): one barrel the length of the hall,
// springing from the top of the stands' back wall either side, over the ice too. Steel trusses
// every VAULT_BAY ft with purlins between and a lamp under each, a glazed lantern along the crown,
// clerestory lights low down either side, a brick gable at the left end and the great window in
// the right one, an arched head in a steel grid. `D` is how far out the back wall stands.
// ⚠ ABOVE ROOF_Z ONLY: every camera sits below it, so the vault never stands between a lens and the ice.
function buildVault(M, batches, D) {
  const skin = M.rgb('#10151b'), steel = M.rgb('#4a5560'), purlin = M.rgb('#2a323b'), brick = M.rgb('#2e1517');
  const pane = [0.42, 0.55, 0.64, 1], lamp = [1, 0.95, 0.82, 1], bar = M.rgb('#161b21');
  const x0 = -D, x1 = RL + D, y0 = -D, y1 = RW + D, cy = (y0 + y1) / 2, hw = (y1 - y0) / 2, N = 24;
  // the arch across, node i: where it is and which way is in
  const A = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N * Math.PI, c = Math.cos(t), s = Math.sin(t), nl = Math.hypot(c / hw, s / VAULT_RISE);
    A.push({ y: cy - hw * c, z: ROOF_Z + VAULT_RISE * s, ny: c / hw / nl, nz: -s / VAULT_RISE / nl });
  }
  // a point on the arch at node i, `x` along and `inn` ft in from the skin
  const at = (i, x, inn = 0) => [x, A[i].y + A[i].ny * inn, A[i].z + A[i].nz * inn];
  const put = (p0, p1, p2, p3, c, n) => M.quad(batches[layerOf((p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2)], p0, p1, p2, p3, c, null, n);
  const bays = Math.ceil((x1 - x0) / VAULT_BAY), bx = (k) => x0 + (x1 - x0) * k / bays;
  for (let k = 0; k < bays; k++) {
    const xa = bx(k), xb = bx(k + 1), m0 = xa + 3, m1 = xb - 3;
    for (let i = 0; i < N; i++) {
      const n = [0, (A[i].ny + A[i + 1].ny) / 2, (A[i].nz + A[i + 1].nz) / 2];
      put(at(i, xa), at(i, xb), at(i + 1, xb), at(i + 1, xa), skin, n);
      // the lantern along the crown and the clerestory low down either side, glass between the trusses
      if (i === N / 2 - 1 || i === N / 2 || i === 1 || i === N - 2) put(at(i, m0, 0.4), at(i, m1, 0.4), at(i + 1, m1, 0.4), at(i + 1, m0, 0.4), pane, null);
      // a purlin along every third node
      if (i % 3 === 0 && i) put(at(i, xa, 0.6), at(i, xb, 0.6), at(i, xb, 1.6), at(i, xa, 1.6), purlin, null);
    }
  }
  // the trusses: an outer chord on the skin, an inner one 7 ft in, and a web zigzag between, a
  // lamp hung under the inner chord either side of the crown
  for (let k = 0; k <= bays; k++) {
    const x = Math.min(x1 - 0.8, Math.max(x0 + 0.8, bx(k))), w = 0.7, T = 7;
    for (let i = 0; i < N; i++) {
      const n = [0, (A[i].ny + A[i + 1].ny) / 2, (A[i].nz + A[i + 1].nz) / 2];
      put(at(i, x - w, 0.5), at(i, x + w, 0.5), at(i + 1, x + w, 0.5), at(i + 1, x - w, 0.5), steel, n);
      put(at(i, x - w, T), at(i, x + w, T), at(i + 1, x + w, T), at(i + 1, x - w, T), steel, n);
      const [a, b] = i % 2 ? [at(i, x, 0.5), at(i + 1, x, T)] : [at(i, x, T), at(i + 1, x, 0.5)];
      put([x - 0.3, a[1], a[2]], [x + 0.3, a[1], a[2]], [x + 0.3, b[1], b[2]], [x - 0.3, b[1], b[2]], steel, null);
    }
    if (k > 0 && k < bays) for (const i of [N / 2 - 4, N / 2 + 4]) {
      const p = at(i, x, T + 2.5);
      put([x - 2, p[1] - 2, p[2]], [x + 2, p[1] - 2, p[2]], [x + 2, p[1] + 2, p[2]], [x - 2, p[1] + 2, p[2]], lamp, null);
    }
  }
  // the gables, the left one brick and the right one brick round the great window
  const GW = hw * 0.62, head = (dy) => ROOF_Z + 4 + (VAULT_RISE - 14) * Math.sqrt(Math.max(0, 1 - (dy / GW) ** 2));
  for (const [x, glazed] of [[x0, false], [x1, true]]) {
    for (let i = 0; i < N; i++) put([x, A[i].y, ROOF_Z], [x, A[i + 1].y, ROOF_Z], [x, A[i + 1].y, A[i + 1].z], [x, A[i].y, A[i].z], brick, [x === x0 ? 1 : -1, 0, 0]);
    if (!glazed) continue;
    const gx = x - 0.4, bx2 = x - 0.8, C = 16;
    for (let c = 0; c < C; c++) {
      const ya = cy - GW + 2 * GW * c / C, yb = cy - GW + 2 * GW * (c + 1) / C;
      put([gx, ya, ROOF_Z + 4], [gx, yb, ROOF_Z + 4], [gx, yb, head(yb - cy)], [gx, ya, head(ya - cy)], pane, null);
      // the grid: a mullion at every column's edge, and transoms where the head allows
      put([bx2, ya - 0.5, ROOF_Z + 4], [bx2, ya + 0.5, ROOF_Z + 4], [bx2, ya + 0.5, head(ya - cy)], [bx2, ya - 0.5, head(ya - cy)], bar, null);
      for (const zt of [ROOF_Z + 22, ROOF_Z + 42, ROOF_Z + 60]) {
        const top = Math.min(head(ya - cy), head(yb - cy));
        if (zt < top) put([bx2, ya, zt - 0.5], [bx2, yb, zt - 0.5], [bx2, yb, zt + 0.5], [bx2, ya, zt + 0.5], bar, null);
      }
    }
    // the arched head's own frame
    for (let c = 0; c < C; c++) {
      const ya = cy - GW + 2 * GW * c / C, yb = cy - GW + 2 * GW * (c + 1) / C;
      put([bx2, ya, head(ya - cy) - 1], [bx2, yb, head(yb - cy) - 1], [bx2, yb, head(yb - cy) + 1], [bx2, ya, head(ya - cy) + 1], bar, null);
    }
  }
}
