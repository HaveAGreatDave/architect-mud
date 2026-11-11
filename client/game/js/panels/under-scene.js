// UNDER SCENE: the CPU half of the Under fly-through (plugins/freelook, `freelook under`).
//
// The server sends the Under as a list of tiles (map_world, grid_z -1, terrain sewer), each with its
// name and the directions it has exits in. This turns that graph into geometry: a brick tunnel with
// ledges and a water channel along every connection, a domed chamber or a manhole hub on every
// tile, and the dressing a tile's name asks for. No GL here, so a headless harness can run it.
//
// Coordinates are tiles relative to the tile the view opened on, the frame freecam.js flies in:
// x east, y south, z up, the Under's walkway at z = 0. One tile is about 18 m, so a tunnel 0.22
// tiles wide is a 4 m sewer.
//
// ⚠ THE GRAPH IS THE CONTENT. Nothing here knows where a tunnel goes; it draws the exits the zones
// have, so a tile added to the Under in the Studio shows up here with no change to this file. The
// name words below only pick dressing (a pump, a shrine, a flood); a name they don't know gets a
// plain hub or chamber.

export const W = 0.11;        // tunnel half-width
export const CH = 0.042;      // channel half-width
export const CD = -0.04;      // channel bed
export const WATER = CD + 0.017;
export const SPR = 0.075;     // springline: where the wall turns into the arch
export const WALL_H = 0.2;    // a chamber's straight wall
export const SHAFT_TOP = 1.6;

const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

// Name words → dressing. First match wins.
const ROOM_WORDS = /station|hall|concourse|cistern|confluence|vault|chamber|gallery|pump|sump|junction|crossing|landing|warren|threshold|throat|reach|sublevel|turbine|machine|sluice|wall/i;
const GRAND = /station|hall|concourse/i;
const MACHINE = /pump|machine|turbine/i;
// ⚠ NOT 'threshold': the Watch Threshold is the Long Watch's door, and they avoid the shrines.
const SHRINE = /throat|deep reach|weeping|confluence|warren|silt/i;
const FLOOD = /flooded|cistern|overflow|storm drain/i;
const COLLAPSE = /collapsed/i;
const SLUICE = /sluice/i;
const CABLE = /cabling|conduit|utility/i;

// Materials (read by the shader in under-view.js).
export const MAT = { BRICK: 0, CONCRETE: 1, CHANNEL: 2, WATER: 3, METAL: 4, RUST: 5, LAMP: 6, ROCK: 7, TILE: 8, FLAME: 9, DAYLIGHT: 10, BONE: 11, CABLE: 12, WOOD: 13, LINO: 14, BUNKER: 15, PAPER: 16, SCREEN: 17, CLOTH: 18 };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Interleaved: pos3 normal3 uv2 mat aux = 10 floats.
export const STRIDE = 10;
class Mesh {
  constructor() { this.a = []; }
  tri(p, q, r, mat, aux = 0) {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [p, q, r]) this.a.push(v[0], v[1], v[2], nx, ny, nz, v[3] || 0, v[4] || 0, mat, aux);
  }
  quad(p, q, r, s, mat, aux) { this.tri(p, q, r, mat, aux); this.tri(p, r, s, mat, aux); }
  // An axis-aligned-ish box given a centre, half sizes and a yaw.
  box(cx, cy, cz, hx, hy, hz, yaw, mat, aux = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * c - y * s, cy + x * s + y * c, cz + z, (x + y) * 2, z * 2];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const f = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const [a, b, d, e] of f) this.quad(v[a], v[b], v[d], v[e], mat, aux);
  }
  // A cylinder between two points.
  cyl(a, b, r, n, mat, aux = 0, caps = true) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1;
    const t = d.map((x) => x / L);
    const h = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [t[1] * h[2] - t[2] * h[1], t[2] * h[0] - t[0] * h[2], t[0] * h[1] - t[1] * h[0]];
    const ul = Math.hypot(...u); u = u.map((x) => x / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const ring = (o, k, s) => { const an = (k / n) * Math.PI * 2, cs = Math.cos(an) * r, sn = Math.sin(an) * r; return [o[0] + u[0] * cs + w[0] * sn, o[1] + u[1] * cs + w[1] * sn, o[2] + u[2] * cs + w[2] * sn, k / n * r * 6.28, s]; };
    for (let k = 0; k < n; k++) {
      this.quad(ring(a, k, 0), ring(b, k, L), ring(b, k + 1, L), ring(a, k + 1, 0), mat, aux);
      if (caps) { this.tri([...a, 0, 0], ring(a, k + 1, 0), ring(a, k, 0), mat, aux); this.tri([...b, 0, 0], ring(b, k, L), ring(b, k + 1, L), mat, aux); }
    }
  }
}

// The tunnel's cross-section: [lateral, z, material of the run to the next point].
function tunnelProfile(flood) {
  const p = [[-CH, 0, MAT.CONCRETE], [-W, 0, MAT.BRICK], [-W, SPR, MAT.BRICK]];
  const n = 14;
  for (let i = 1; i < n; i++) { const a = Math.PI - (i / n) * Math.PI; p.push([Math.cos(a) * W, SPR + Math.sin(a) * W, MAT.BRICK]); }
  p.push([W, SPR, MAT.BRICK], [W, 0, MAT.CONCRETE], [CH, 0, MAT.CHANNEL], [CH, CD, MAT.CHANNEL], [-CH, CD, MAT.CHANNEL], [-CH, 0, MAT.CHANNEL]);
  void flood;
  return p;
}
const ARCH = (() => { const a = []; const n = 14; for (let i = 0; i <= n; i++) { const t = Math.PI - (i / n) * Math.PI; a.push([Math.cos(t) * W, SPR + Math.sin(t) * W]); } return a; })();

export function ceilingInTunnel(lat) { const l = Math.min(Math.abs(lat), W); return SPR + Math.sqrt(Math.max(0, W * W - l * l)); }

// ── THE GRAPH ────────────────────────────────────────────────────────────────
export function buildGraph(tiles, gx, gy) {
  const at = new Map();
  for (const t of tiles || []) at.set(t.x + ',' + t.y, t);
  const nodes = [], byKey = new Map();
  for (const t of tiles || []) {
    const name = String(t.n || '');
    const exits = String(t.e || '');
    const grand = GRAND.test(name), room = ROOM_WORDS.test(name);
    const node = {
      key: t.x + ',' + t.y, tx: t.x, ty: t.y, x: t.x - gx, y: t.y - gy, name,
      up: exits.includes('U'), dirs: [],
      R: grand ? 0.34 : room ? 0.25 : W * 1.45,
      kind: grand ? 'grand' : room ? 'room' : 'hub',
      flood: FLOOD.test(name), machine: MACHINE.test(name), shrine: SHRINE.test(name),
      collapse: COLLAPSE.test(name), sluice: SLUICE.test(name), cable: CABLE.test(name),
      seed: (t.x * 73856093) ^ (t.y * 19349663),
    };
    nodes.push(node); byKey.set(node.key, node);
  }
  const edges = [];
  for (const n of nodes) {
    for (const [d, [dx, dy]] of Object.entries(DIRS)) {
      const t = at.get(n.key)?.e || '';
      const m = byKey.get((n.tx + dx) + ',' + (n.ty + dy));
      if (!m) continue;
      const back = { N: 'S', S: 'N', E: 'W', W: 'E' }[d];
      if (!t.includes(d) && !(at.get(m.key)?.e || '').includes(back)) continue;
      n.dirs.push([dx, dy]);
      if (d === 'E' || d === 'S') edges.push({ a: n, b: m, dx, dy, flood: n.flood && m.flood });
    }
  }
  return { nodes, edges, byKey };
}

// ── THE SCENE ────────────────────────────────────────────────────────────────
export function buildUnder(tiles, gx, gy, annexes = []) {
  const g = buildGraph(tiles, gx, gy);
  const solid = new Mesh(), water = new Mesh();
  const lights = [], drips = [];
  g.rooms = []; g.halls = []; g.stairs = [];
  for (const a of annexes || []) buildAnnex(a, g, gx, gy, solid, lights);

  for (const e of g.edges) buildTunnel(e, solid, water, lights, drips);
  for (const n of g.nodes) buildNode(n, solid, water, lights, drips);

  return { graph: g, solid: new Float32Array(solid.a), water: new Float32Array(water.a), lights, drips: new Float32Array(drips) };
}

function gapHalf(R) { return Math.asin(Math.min(0.999, W / R)); }

function buildTunnel(e, M, Wm, lights, drips) {
  const { a, b, dx, dy } = e;
  const sA = a.R * Math.cos(gapHalf(a.R)), sB = 1 - b.R * Math.cos(gapHalf(b.R));
  const L = (s, lat, z, v) => [a.x + dx * s - dy * lat, a.y + dy * s + dx * lat, z, s, v];
  const rnd = rng(a.seed ^ 0x9e37);
  const paint = (a.shrine || b.shrine) ? 0.35 : rnd() < 0.3 ? 0.12 : 0.02;
  const prof = tunnelProfile();
  // Segment the run so the ribs have somewhere to sit and long faces stay short.
  const segs = Math.max(2, Math.round((sB - sA) / 0.12));
  for (let k = 0; k < segs; k++) {
    const s0 = sA + (sB - sA) * k / segs, s1 = sA + (sB - sA) * (k + 1) / segs;
    let v = 0;
    for (let i = 0; i < prof.length - 1; i++) {
      const [l0, z0, mat] = prof[i], [l1, z1] = prof[i + 1];
      const dv = Math.hypot(l1 - l0, z1 - z0);
      M.quad(L(s0, l0, z0, v), L(s1, l0, z0, v), L(s1, l1, z1, v + dv), L(s0, l1, z1, v + dv), mat, mat === MAT.BRICK ? paint : 0);
      v += dv;
    }
    // A concrete rib round the arch every segment.
    if (k > 0) {
      const s = s0, r0 = 0.985, r1 = 0.92;
      for (let i = 0; i < ARCH.length - 1; i++) {
        const [l0, z0] = ARCH[i], [l1, z1] = ARCH[i + 1];
        const sh = (l, z, k2) => [l * k2, SPR + (z - SPR) * k2];
        const A0 = sh(l0, z0, r0), A1 = sh(l1, z1, r0), B0 = sh(l0, z0, r1), B1 = sh(l1, z1, r1);
        M.quad(L(s - 0.008, A0[0], A0[1]), L(s - 0.008, A1[0], A1[1]), L(s - 0.008, B1[0], B1[1]), L(s - 0.008, B0[0], B0[1]), MAT.CONCRETE);
        M.quad(L(s + 0.008, B0[0], B0[1]), L(s + 0.008, B1[0], B1[1]), L(s + 0.008, A1[0], A1[1]), L(s + 0.008, A0[0], A0[1]), MAT.CONCRETE);
        M.quad(L(s - 0.008, B0[0], B0[1]), L(s - 0.008, B1[0], B1[1]), L(s + 0.008, B1[0], B1[1]), L(s + 0.008, B0[0], B0[1]), MAT.CONCRETE);
      }
      for (const side of [-1, 1]) M.box(...L(s, side * (W - 0.012), SPR * 0.5).slice(0, 3), 0.008, 0.012, SPR * 0.5, Math.atan2(dy, dx), MAT.CONCRETE);
    }
  }
  // Water in the channel, or over the ledges where it floods.
  const wl = e.flood ? 0.035 : WATER, ww = e.flood ? W : CH;
  Wm.quad(L(sA, -ww, wl, 0), L(sB, -ww, wl, sB - sA), L(sB, ww, wl, sB - sA), L(sA, ww, wl, 0), MAT.WATER);
  // Channel caps where it meets a chamber floor.
  for (const s of [sA, sB]) M.quad(L(s, -CH, CD), L(s, CH, CD), L(s, CH, 0), L(s, -CH, 0), MAT.CHANNEL);

  // Pipes along the upper walls.
  const side = rnd() < 0.5 ? -1 : 1;
  const np = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < np; i++) {
    const lat = side * (W - 0.016 - i * 0.004), z = SPR + 0.015 + i * 0.019;
    const r = 0.006 + rnd() * 0.006;
    M.cyl(L(sA, lat, z).slice(0, 3), L(sB, lat, z).slice(0, 3), r, 7, rnd() < 0.5 ? MAT.RUST : MAT.METAL, 0, false);
    for (let s = sA + 0.1; s < sB - 0.05; s += 0.22) M.box(...L(s, lat, z).slice(0, 3), 0.004, r + 0.004, r + 0.004, Math.atan2(dy, dx), MAT.METAL);
  }
  if (a.cable || b.cable || rnd() < 0.25) {
    for (let i = 0; i < 4; i++) M.cyl(L(sA, -side * (W - 0.008), SPR + 0.002 + i * 0.006).slice(0, 3), L(sB, -side * (W - 0.008), SPR + 0.002 + i * 0.006).slice(0, 3), 0.0028, 5, MAT.CABLE, 0, false);
  }
  // A caged lamp on the wall, or none: most of the Under is dark.
  if (rnd() < 0.5) {
    const s = 0.5, ls = rnd() < 0.5 ? -1 : 1;
    const p = L(s, ls * (W - 0.02), SPR + 0.03);
    M.box(...L(s, ls * (W - 0.004), SPR + 0.03).slice(0, 3), 0.012, 0.004, 0.016, Math.atan2(dy, dx), MAT.METAL);
    M.box(p[0], p[1], p[2], 0.007, 0.007, 0.009, Math.atan2(dy, dx), MAT.LAMP);
    const dead = rnd() < 0.15;
    const sick = rnd() < 0.25;
    lights.push({ x: p[0], y: p[1], z: p[2], c: sick ? [0.55, 1.0, 0.6] : [1.0, 0.58, 0.24], i: dead ? 0.0 : 1.0, range: 0.75, flick: rnd() < 0.3 ? 1 : 0.1, seed: rnd() });
  }
  // Drips off the crown.
  for (let s = sA; s < sB; s += 0.06) if (rnd() < 0.35) drips.push(...L(s, (rnd() - 0.5) * W, SPR + W - 0.004).slice(0, 3), rnd());
}

function buildNode(n, M, Wm, lights, drips) {
  const rnd = rng(n.seed);
  const { x, y, R } = n;
  const ga = gapHalf(R);
  const gaps = n.dirs.map(([dx, dy]) => Math.atan2(dy, dx));
  const inGap = (t) => gaps.some((g0) => Math.abs(((t - g0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < ga);
  const P = (t, r, z, v) => [x + Math.cos(t) * r, y + Math.sin(t) * r, z, t * R, v ?? z];
  const paint = n.shrine ? 0.5 : n.kind === 'hub' ? 0.05 : 0.15;
  const domeH = n.kind === 'hub' ? 0.05 : R * 0.6;
  const wallMat = n.kind === 'grand' ? MAT.TILE : MAT.BRICK;

  // The wall in arcs between the gaps, so each arc ends exactly on a tunnel's side.
  const bounds = [];
  for (const g0 of gaps) bounds.push(g0 - ga, g0 + ga);
  const N = Math.max(24, Math.round(R * 160));
  const ts = [];
  for (let k = 0; k <= N; k++) ts.push(-Math.PI + (k / N) * Math.PI * 2);
  for (const b0 of bounds) ts.push(((b0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  ts.sort((p, q) => p - q);
  for (let k = 0; k < ts.length - 1; k++) {
    const t0 = ts[k], t1 = ts[k + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    if (!inGap(mid)) M.quad(P(t0, R, 0), P(t1, R, 0), P(t1, R, WALL_H), P(t0, R, WALL_H), wallMat, paint);
    // Dome, full circle.
    const rings = 6;
    for (let j = 0; j < rings; j++) {
      const a0 = (j / rings) * Math.PI / 2, a1 = ((j + 1) / rings) * Math.PI / 2;
      const r0 = R * Math.cos(a0), r1 = R * Math.cos(a1);
      const top = n.up ? 0.06 : 0;
      const rr0 = Math.max(top, r0), rr1 = Math.max(top, r1);
      if (rr0 - rr1 < 1e-6) continue;
      M.quad(P(t0, rr0, WALL_H + domeH * Math.sin(a0)), P(t1, rr0, WALL_H + domeH * Math.sin(a0)), P(t1, rr1, WALL_H + domeH * Math.sin(a1)), P(t0, rr1, WALL_H + domeH * Math.sin(a1)), n.kind === 'grand' ? MAT.CONCRETE : MAT.BRICK, paint * 0.5);
    }
    // Floor ring and the sump.
    const Rp = n.kind === 'hub' ? CH * 1.5 : R * 0.42;
    M.quad(P(t0, Rp, 0), P(t1, Rp, 0), P(t1, R, 0), P(t0, R, 0), n.kind === 'grand' ? MAT.TILE : MAT.CONCRETE);
    M.quad(P(t0, Rp, CD), P(t1, Rp, CD), P(t1, Rp, 0), P(t0, Rp, 0), MAT.CHANNEL);
    M.tri([x, y, CD, 0, 0], P(t1, Rp, CD), P(t0, Rp, CD), MAT.CHANNEL);
    const wl = n.flood ? 0.035 : WATER, wr = n.flood ? R : Rp;
    Wm.tri([x, y, wl, 0, 0], P(t0, wr, wl), P(t1, wr, wl), MAT.WATER);
  }

  // Each gap: the portal face above the tunnel's arch, and the lintel up to the dome.
  for (const g0 of gaps) {
    const c = Math.cos(g0), s = Math.sin(g0);
    const d = R * Math.cos(ga);
    const Q = (lat, z) => [x + c * d - s * lat, y + s * d + c * lat, z, lat, z];
    for (let i = 0; i < ARCH.length - 1; i++) {
      const [l0, z0] = ARCH[i], [l1, z1] = ARCH[i + 1];
      M.quad(Q(l0, z0), Q(l1, z1), Q(l1, WALL_H), Q(l0, WALL_H), wallMat, paint);
    }
    // Lintel: the sliver between the chord and the arc at WALL_H.
    const n2 = 8;
    for (let i = 0; i < n2; i++) {
      const t0 = g0 - ga + (2 * ga) * i / n2, t1 = g0 - ga + (2 * ga) * (i + 1) / n2;
      const lat0 = Math.sin(t0 - g0) * R, lat1 = Math.sin(t1 - g0) * R;
      M.quad(Q(lat0, WALL_H), Q(lat1, WALL_H), P(t1, R, WALL_H), P(t0, R, WALL_H), MAT.CONCRETE);
    }
  }

  // Grand rooms: columns and strip lights.
  if (n.kind === 'grand') {
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI * 2 + 0.3;
      const px = x + Math.cos(t) * R * 0.68, py = y + Math.sin(t) * R * 0.68;
      M.cyl([px, py, 0], [px, py, WALL_H + domeH * 0.55], 0.018, 10, MAT.CONCRETE, 0, false);
      M.box(px, py, 0.01, 0.026, 0.026, 0.01, t, MAT.CONCRETE);
    }
    for (let k = 0; k < 3; k++) {
      const t = (k / 3) * Math.PI * 2;
      const lx = x + Math.cos(t) * R * 0.4, ly = y + Math.sin(t) * R * 0.4, lz = WALL_H + domeH * 0.7;
      M.box(lx, ly, lz, 0.05, 0.006, 0.003, t + 1.57, MAT.LAMP);
      lights.push({ x: lx, y: ly, z: lz - 0.01, c: [0.6, 0.95, 0.75], i: rnd() < 0.2 ? 0 : 0.9, range: 0.9, flick: rnd() < 0.5 ? 1 : 0.05, seed: rnd() });
    }
    // Old benches and a fallen sign board.
    for (let k = 0; k < 3; k++) { const t = rnd() * 6.28; M.box(x + Math.cos(t) * R * 0.85, y + Math.sin(t) * R * 0.85, 0.02, 0.05, 0.012, 0.02, t + 1.57, MAT.RUST); }
  } else if (n.kind === 'room' && rnd() < 0.8) {
    const t = rnd() * 6.28, lz = WALL_H + domeH * 0.5;
    const lx = x + Math.cos(t) * R * 0.5, ly = y + Math.sin(t) * R * 0.5;
    M.cyl([lx, ly, lz + 0.05], [lx, ly, lz], 0.0015, 4, MAT.CABLE, 0, false);
    M.box(lx, ly, lz, 0.008, 0.008, 0.008, 0, MAT.LAMP);
    lights.push({ x: lx, y: ly, z: lz - 0.01, c: [1.0, 0.6, 0.28], i: 1, range: 0.85, flick: 0.15, seed: rnd() });
  }

  // A ladder shaft up to a grate, with the street's light coming down it.
  if (n.up) {
    const top = WALL_H + domeH;
    const r = 0.06;
    const segs = 12;
    for (let k = 0; k < segs; k++) {
      const t0 = (k / segs) * 6.283, t1 = ((k + 1) / segs) * 6.283;
      const Pa = (t, z) => [x + Math.cos(t) * r, y + Math.sin(t) * r, z, t * r, z];
      M.quad(Pa(t0, top - 0.02), Pa(t1, top - 0.02), Pa(t1, SHAFT_TOP), Pa(t0, SHAFT_TOP), MAT.CONCRETE);
    }
    for (let z = 0.03; z < SHAFT_TOP - 0.02; z += 0.025) M.cyl([x - 0.018, y + r - 0.008, z], [x + 0.018, y + r - 0.008, z], 0.0018, 4, MAT.RUST, 0, false);
    M.cyl([x - 0.018, y + r - 0.008, 0], [x - 0.018, y + r - 0.008, SHAFT_TOP], 0.002, 4, MAT.RUST, 0, false);
    M.cyl([x + 0.018, y + r - 0.008, 0], [x + 0.018, y + r - 0.008, SHAFT_TOP], 0.002, 4, MAT.RUST, 0, false);
    // The grate: daylight between bars.
    for (let k = 0; k < segs; k++) {
      const t0 = (k / segs) * 6.283, t1 = ((k + 1) / segs) * 6.283;
      M.tri([x, y, SHAFT_TOP, 0, 0], [x + Math.cos(t1) * r, y + Math.sin(t1) * r, SHAFT_TOP, 0, 0], [x + Math.cos(t0) * r, y + Math.sin(t0) * r, SHAFT_TOP, 0, 0], MAT.DAYLIGHT);
    }
    for (let i = -2; i <= 2; i++) M.box(x + i * 0.022, y, SHAFT_TOP - 0.004, 0.003, r, 0.003, 0, MAT.METAL);
    lights.push({ x, y, z: top + 0.05, c: [0.75, 0.82, 0.95], i: 0.8, range: 0.7, flick: 0, seed: 0, sky: 1 });
    lights.push({ x, y, z: SHAFT_TOP - 0.2, c: [0.75, 0.82, 0.95], i: 0.8, range: 0.9, flick: 0, seed: 0, sky: 1 });
  }

  // Machinery.
  if (n.machine) {
    const t = rnd() * 6.28, mx = x + Math.cos(t) * R * 0.62, my = y + Math.sin(t) * R * 0.62;
    M.cyl([mx, my, 0], [mx, my, 0.12], 0.05, 16, MAT.RUST);
    M.cyl([mx, my, 0.12], [mx, my, 0.14], 0.035, 12, MAT.METAL);
    M.box(mx, my, 0.03, 0.075, 0.075, 0.03, t, MAT.CONCRETE);
    M.cyl([mx, my, 0.09], [x + Math.cos(t + 0.4) * R, y + Math.sin(t + 0.4) * R, 0.09], 0.016, 10, MAT.RUST, 0, false);
    M.cyl([mx, my, 0.05], [x + Math.cos(t - 0.5) * R, y + Math.sin(t - 0.5) * R, 0.05], 0.022, 10, MAT.METAL, 0, false);
    // A big valve wheel.
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * 6.283, a1 = ((k + 1) / 10) * 6.283;
      M.cyl([mx + Math.cos(a0) * 0.03, my + Math.sin(a0) * 0.03, 0.17], [mx + Math.cos(a1) * 0.03, my + Math.sin(a1) * 0.03, 0.17], 0.003, 4, MAT.METAL, 0, false);
    }
    M.cyl([mx, my, 0.14], [mx, my, 0.17], 0.004, 5, MAT.METAL);
    lights.push({ x: mx, y: my, z: 0.16, c: [1.0, 0.2, 0.1], i: 0.35, range: 0.35, flick: 0.6, seed: rnd() });
  }
  if (n.sluice) {
    const g0 = gaps[0] ?? 0, c = Math.cos(g0), s = Math.sin(g0);
    const d = R * 0.7;
    M.box(x + c * d, y + s * d, 0.06, 0.008, CH + 0.02, 0.1, g0, MAT.RUST);
    M.box(x + c * d - s * (CH + 0.03), y + s * d + c * (CH + 0.03), 0.12, 0.012, 0.012, 0.12, g0, MAT.METAL);
    M.box(x + c * d + s * (CH + 0.03), y + s * d - c * (CH + 0.03), 0.12, 0.012, 0.012, 0.12, g0, MAT.METAL);
    M.box(x + c * d, y + s * d, 0.245, 0.012, CH + 0.045, 0.01, g0, MAT.METAL);
  }
  if (n.collapse) {
    for (let k = 0; k < 40; k++) {
      const t = rnd() * 6.28, r = Math.sqrt(rnd()) * R * 0.9;
      const s = 0.012 + rnd() * 0.04;
      M.box(x + Math.cos(t) * r + 0.04, y + Math.sin(t) * r, s * 0.6 + (1 - r / R) * 0.08, s, s * (0.6 + rnd()), s * 0.7, rnd() * 6.28, rnd() < 0.6 ? MAT.ROCK : MAT.BRICK);
    }
    M.cyl([x - R * 0.6, y - R * 0.3, 0.02], [x + R * 0.5, y + R * 0.4, 0.15], 0.01, 6, MAT.RUST, 0, true);
  }

  // Wildblood: offerings, candles, teeth, bones. Some hubs get a little of it too.
  if (n.shrine || (n.kind !== 'hub' && rnd() < 0.3) || rnd() < 0.08) {
    const t = rnd() * 6.28, d = R - 0.04;
    const sx = x + Math.cos(t) * d, sy = y + Math.sin(t) * d;
    M.box(sx, sy, 0.025, 0.035, 0.018, 0.025, t + 1.57, MAT.ROCK);
    const nc = 3 + Math.floor(rnd() * 6);
    for (let k = 0; k < nc; k++) {
      const cx = sx + (rnd() - 0.5) * 0.06, cy = sy + (rnd() - 0.5) * 0.03, h = 0.006 + rnd() * 0.014;
      M.cyl([cx, cy, 0.05], [cx, cy, 0.05 + h], 0.0025, 5, MAT.BONE);
      M.box(cx, cy, 0.05 + h + 0.003, 0.0012, 0.0012, 0.003, 0, MAT.FLAME);
    }
    lights.push({ x: sx - Math.cos(t) * 0.02, y: sy - Math.sin(t) * 0.02, z: 0.08, c: [1.0, 0.55, 0.2], i: 0.9, range: 0.45, flick: 1, seed: rnd(), candle: 1 });
    // Teeth in a heap, bones by the wall.
    for (let k = 0; k < 30; k++) M.box(sx + (rnd() - 0.5) * 0.05, sy + (rnd() - 0.5) * 0.05, 0.002, 0.0018, 0.0012, 0.002, rnd() * 6, MAT.BONE);
    for (let k = 0; k < 6; k++) {
      const a = t + (rnd() - 0.5) * 1.2, rr = R - 0.02 - rnd() * 0.04;
      const bx = x + Math.cos(a) * rr, by = y + Math.sin(a) * rr, ang = rnd() * 6.28, l = 0.012 + rnd() * 0.02;
      M.cyl([bx, by, 0.004], [bx + Math.cos(ang) * l, by + Math.sin(ang) * l, 0.004], 0.0025, 5, MAT.BONE);
    }
  }
  // Junk in the sump.
  if (rnd() < 0.5) { const t = rnd() * 6.28; M.box(x + Math.cos(t) * R * 0.75, y + Math.sin(t) * R * 0.75, 0.012, 0.02, 0.015, 0.012, rnd() * 6, rnd() < 0.5 ? MAT.RUST : MAT.ROCK); }
  for (let k = 0; k < 6; k++) if (rnd() < 0.5) { const t = rnd() * 6.28, r = rnd() * R * 0.7; drips.push(x + Math.cos(t) * r, y + Math.sin(t) * r, WALL_H + domeH * (1 - (r / R) ** 2) * 0.9, rnd()); }
}

// ── WHERE THE CAMERA MAY BE ──────────────────────────────────────────────────
// Inside the network, or pulled back into it: the nearest point that is in a tunnel or a chamber,
// and the floor and the roof over it.
// ⚠ BY LEVEL AS WELL AS PLACE. The Long Watch's rooms stand over the sewer, so two spaces can
// share a spot on the map; the one whose floor-to-roof band holds the camera's height wins.
export function confine(g, x, y, z = 0.08) {
  let best = null;
  const take = (px, py, floor, ceil) => {
    const dz = z < floor ? floor - z : z > ceil ? z - ceil : 0;
    const d = Math.hypot(px - x, py - y), sc = Math.hypot(d, dz * 1.5);
    if (!best || sc < best.sc) best = { x: px, y: py, d, floor, ceil, sc };
  };
  confineAnnex(g, x, y, take);
  for (const n of g.nodes) {
    const dx = x - n.x, dy = y - n.y, d = Math.hypot(dx, dy);
    if (d > 1.2) continue;
    const lim = n.R - 0.02, k = d > lim ? lim / d : 1;
    const r = Math.min(d, lim);
    const dome = n.kind === 'hub' ? 0.05 : n.R * 0.6;
    let ceil = WALL_H + dome * Math.sqrt(Math.max(0, 1 - (r / n.R) ** 2)) - 0.02;
    if (n.up && r < 0.045) ceil = SHAFT_TOP - 0.03;
    take(n.x + dx * k, n.y + dy * k, (n.flood ? 0.035 : 0) + 0.02, ceil);
  }
  for (const e of g.edges) {
    const s = (x - e.a.x) * e.dx + (y - e.a.y) * e.dy;
    if (s < 0 || s > 1) continue;
    const lat = -(x - e.a.x) * e.dy + (y - e.a.y) * e.dx;
    const lim = W - 0.018, l = Math.max(-lim, Math.min(lim, lat));
    take(e.a.x + e.dx * s - e.dy * l, e.a.y + e.dy * s + e.dx * l, (e.flood ? 0.035 : 0) + 0.02, ceilingInTunnel(l) - 0.015);
  }
  return best;
}

export function nearestNode(g, x, y, z = 0) {
  let best = null, bd = Infinity;
  for (const n of g.nodes) { const d = Math.hypot(n.x - x, n.y - y, Math.max(0, z - 0.3) * 2); if (d < bd) { bd = d; best = n; } }
  for (const r of g.rooms || []) { const d = Math.hypot(r.x - x, r.y - y, Math.min(0, z - ANNEX_Z + 0.05) * 2); if (d < bd) { bd = d; best = r; } }
  return best;
}

// ── THE ANNEXES: THE LONG WATCH'S BASE ───────────────────────────────────────
// An interior map the server found joined to the sewer (plugins/freelook underAnnexes), placed on
// the Under's grid. It is built one level up: dug in above the sewer rather than in it, which keeps
// it off the Drain Sump that shares the Dogleg's square and matches the Deadfall's hatch going
// DOWN into the Under. A stair climbs to it from the tile it opens off.
//
// Square concrete rooms, board-formed, with a panelled dado and steel beams; 2 m corridors with a
// blast door at one end; the floors are the rooms' own `flags.floor`. Furniture comes from words
// in the room's name, the same way the sewer's dressing does.
export const ANNEX_Z = 0.4;
const RS = 0.27, RH = 0.2, CW = 0.055, CHH = 0.13, LINK_H = SPR + W;
const u = 1 / 18;   // a metre, in tiles
const LETTER = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const FLOOR_MAT = { boards: MAT.WOOD, tile: MAT.TILE, linoleum: MAT.LINO, concrete: MAT.CONCRETE, dirt: MAT.ROCK };

function buildAnnex(a, g, gx, gy, M, lights) {
  const at = new Map();
  const rooms = (a.rooms || []).map((r) => {
    const room = { name: String(r.n || ''), tx: r.x, ty: r.y, x: r.x - gx, y: r.y - gy, e: String(r.e || ''), f: r.f, annex: true, seed: (r.x * 92821) ^ (r.y * 68917) ^ 0x5bd1, gaps: {} };
    at.set(r.x + ',' + r.y, room);
    return room;
  });
  for (const r of rooms) for (const d of 'NSEW') {
    const [dx, dy] = LETTER[d];
    if (r.e.includes(d) && at.get((r.tx + dx) + ',' + (r.ty + dy))) r.gaps[d] = { hw: CW, oh: CHH };
  }
  const node = g.byKey.get(a.link?.x + ',' + a.link?.y);
  const [ldx, ldy] = LETTER[a.link?.d] || [0, 0];
  const first = at.get((a.link?.x + ldx) + ',' + (a.link?.y + ldy));
  if (node && first) {
    node.dirs.push([ldx, ldy]);
    first.gaps[{ N: 'S', S: 'N', E: 'W', W: 'E' }[a.link.d]] = { hw: W, oh: LINK_H };
    buildStair(node, ldx, ldy, M, lights, g);
  }
  for (const r of rooms) buildRoom(r, M, lights);
  for (const r of rooms) for (const d of 'ES') {
    if (r.gaps[d]?.hw !== CW) continue;
    const [dx, dy] = LETTER[d];
    buildHall(r, dx, dy, M, lights, g);
  }
  g.rooms.push(...rooms);
}

function stairGeom(node) {
  const s0 = node.R * Math.cos(gapHalf(node.R)), s1 = 1 - RS, n = 16;
  return { s0, s1, n, ls: (s1 - s0) / n };
}
function stairFloor(st, s) {
  if (s <= st.s0) return 0;
  if (s >= st.s1) return ANNEX_Z;
  return ANNEX_Z * Math.ceil((s - st.s0) / st.ls) / st.n;
}
function stairCeil(st, s) { return LINK_H + ANNEX_Z * Math.max(0, Math.min(1, (s - st.s0) / (st.s1 - st.s0))); }

function buildStair(node, dx, dy, M, lights, g) {
  const st = stairGeom(node);
  const L = (s, lat, z) => [node.x + dx * s - dy * lat, node.y + dy * s + dx * lat, z, s, z];
  for (let k = 0; k < st.n; k++) {
    const sa = st.s0 + k * st.ls, sb = sa + st.ls;
    const h0 = ANNEX_Z * k / st.n, h1 = ANNEX_Z * (k + 1) / st.n;
    M.quad(L(sa, -W, h1), L(sb, -W, h1), L(sb, W, h1), L(sa, W, h1), MAT.CONCRETE);
    M.quad(L(sa, -W, h0), L(sa, W, h0), L(sa, W, h1), L(sa, -W, h1), MAT.CONCRETE);
    M.box(...L(sa + 0.004, 0, h1 - 0.002).slice(0, 3), 0.004, W, 0.002, Math.atan2(dy, dx), MAT.METAL);   // nosing
    for (const side of [-1, 1]) M.quad(L(sa, side * W, h0), L(sb, side * W, h0), L(sb, side * W, stairCeil(st, sb)), L(sa, side * W, stairCeil(st, sa)), MAT.BUNKER);
    M.quad(L(sa, -W, stairCeil(st, sa)), L(sa, W, stairCeil(st, sa)), L(sb, W, stairCeil(st, sb)), L(sb, -W, stairCeil(st, sb)), MAT.BUNKER);
  }
  for (const side of [-1, 1]) M.cyl(L(st.s0, side * (W - 0.01), 0.05).slice(0, 3), L(st.s1, side * (W - 0.01), ANNEX_Z + 0.05).slice(0, 3), 0.0025, 6, MAT.METAL, 0, false);
  const m = L((st.s0 + st.s1) / 2, W - 0.01, ANNEX_Z * 0.5 + 0.13);
  M.box(m[0], m[1], m[2], 0.007, 0.007, 0.009, Math.atan2(dy, dx), MAT.LAMP);
  lights.push({ x: m[0], y: m[1], z: m[2], c: [1.0, 0.75, 0.45], i: 0.9, range: 0.6, flick: 0.05, seed: 0.3 });
  g.stairs.push({ node, dx, dy, ...st });
}

function buildRoom(r, M, lights) {
  const z0 = ANNEX_Z, rnd = rng(r.seed);
  const { x: cx, y: cy } = r;
  const fm = FLOOR_MAT[r.f] ?? MAT.CONCRETE;
  M.quad([cx - RS, cy - RS, z0, cx - RS, cy - RS], [cx + RS, cy - RS, z0, cx + RS, cy - RS], [cx + RS, cy + RS, z0, cx + RS, cy + RS], [cx - RS, cy + RS, z0, cx - RS, cy + RS], fm);
  M.quad([cx - RS, cy - RS, z0 + RH, 0, 0], [cx - RS, cy + RS, z0 + RH, 0, 0.5], [cx + RS, cy + RS, z0 + RH, 0.5, 0.5], [cx + RS, cy - RS, z0 + RH, 0.5, 0], MAT.BUNKER);
  const DADO = 0.06;
  for (const d of 'NESW') {
    const [nx, ny] = LETTER[d], tx = -ny, ty = nx;
    const P = (s, z) => [cx + nx * RS + tx * s, cy + ny * RS + ty * s, z, s + RS, z - z0];
    const strip = (s0, s1, za, zb) => {
      if (s1 - s0 < 1e-6 || zb - za < 1e-6) return;
      const zm = Math.min(Math.max(za, z0 + DADO), zb);
      if (zm > za) M.quad(P(s0, za), P(s1, za), P(s1, zm), P(s0, zm), MAT.WOOD);
      if (zb > zm) M.quad(P(s0, zm), P(s1, zm), P(s1, zb), P(s0, zb), MAT.BUNKER);
    };
    const gp = r.gaps[d];
    if (!gp) { strip(-RS, RS, z0, z0 + RH); continue; }
    strip(-RS, -gp.hw, z0, z0 + RH); strip(gp.hw, RS, z0, z0 + RH); strip(-gp.hw, gp.hw, z0 + gp.oh, z0 + RH);
    // A steel door frame.
    const yaw = Math.atan2(ny, nx);
    for (const s of [-gp.hw - 0.006, gp.hw + 0.006]) { const p = P(s, z0 + gp.oh / 2); M.box(p[0] - nx * 0.004, p[1] - ny * 0.004, p[2], 0.008, 0.006, gp.oh / 2, yaw, MAT.METAL); }
    const hp = P(0, z0 + gp.oh + 0.006); M.box(hp[0] - nx * 0.004, hp[1] - ny * 0.004, hp[2], 0.008, gp.hw + 0.012, 0.006, yaw, MAT.METAL);
  }
  for (const k of [-1, 0, 1]) M.box(cx, cy + k * RS * 0.6, z0 + RH - 0.012, RS, 0.007, 0.012, 0, MAT.METAL);
  // Lit: the Watch keeps its lights on.
  M.box(cx, cy, z0 + RH - 0.03, 0.03, 0.006, 0.004, 0, MAT.LAMP);
  lights.push({ x: cx, y: cy, z: z0 + RH - 0.045, c: [1.0, 0.86, 0.62], i: 1.0, range: 0.75, flick: rnd() < 0.15 ? 1 : 0.04, seed: rnd() });
  dressRoom(r, M, lights, rnd);
}

function buildHall(a, dx, dy, M, lights, g) {
  const z0 = ANNEX_Z, s0 = RS, s1 = 1 - RS;
  const L = (s, lat, z) => [a.x + dx * s - dy * lat, a.y + dy * s + dx * lat, z, s, z - z0];
  const yaw = Math.atan2(dy, dx);
  M.quad(L(s0, -CW, z0), L(s1, -CW, z0), L(s1, CW, z0), L(s0, CW, z0), MAT.CONCRETE);
  M.quad(L(s0, -CW, z0 + CHH), L(s0, CW, z0 + CHH), L(s1, CW, z0 + CHH), L(s1, -CW, z0 + CHH), MAT.BUNKER);
  for (const side of [-1, 1]) M.quad(L(s0, side * CW, z0), L(s1, side * CW, z0), L(s1, side * CW, z0 + CHH), L(s0, side * CW, z0 + CHH), MAT.BUNKER);
  // The blast door, swung back against the wall.
  M.box(...L(s0 + 0.012 + CW, CW - 0.007, z0 + CHH / 2 - 0.004).slice(0, 3), CW, 0.006, CHH / 2 - 0.006, yaw, MAT.METAL);
  M.box(...L(s0 + 0.012 + CW * 1.6, CW - 0.016, z0 + CHH / 2).slice(0, 3), 0.004, 0.004, 0.018, yaw, MAT.RUST);   // the wheel's spindle
  M.cyl(L(s0, CW - 0.012, z0 + CHH - 0.012).slice(0, 3), L(s1, CW - 0.012, z0 + CHH - 0.012).slice(0, 3), 0.005, 6, MAT.METAL, 0, false);
  M.cyl(L(s0, -CW + 0.01, z0 + CHH - 0.008).slice(0, 3), L(s1, -CW + 0.01, z0 + CHH - 0.008).slice(0, 3), 0.0025, 5, MAT.CABLE, 0, false);
  const m = L((s0 + s1) / 2, 0, z0 + CHH - 0.006);
  M.box(m[0], m[1], m[2], 0.008, 0.008, 0.004, yaw, MAT.LAMP);
  lights.push({ x: m[0], y: m[1], z: m[2] - 0.01, c: [1.0, 0.8, 0.5], i: 0.85, range: 0.5, flick: 0.05, seed: (a.seed % 97) / 97 });
  g.halls.push({ a, dx, dy });
}

// ── FURNITURE, IN METRES ─────────────────────────────────────────────────────
function kit(M, r) {
  const z0 = ANNEX_Z;
  // Room-local metres to tiles: (lx, ly) from the room's centre, z up from its floor.
  const at = (lx, ly, z = 0) => [r.x + lx * u, r.y + ly * u, z0 + z * u];
  const box = (lx, ly, z, hx, hy, hz, yaw, mat) => { const p = at(lx, ly, z); M.box(p[0], p[1], p[2], hx * u, hy * u, hz * u, yaw, mat); };
  const cyl = (a, b, rad, n, mat, caps = true) => M.cyl(at(...a), at(...b), rad * u, n, mat, 0, caps);
  const K = {
    box, cyl,
    table(lx, ly, yaw = 0, Lh = 1, Dh = 0.45, H = 0.75, top = MAT.WOOD) {
      box(lx, ly, H - 0.03, Lh, Dh, 0.03, yaw, top);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const [p, q] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const a = p * (Lh - 0.06), b = q * (Dh - 0.06); box(lx + a * c - b * s, ly + a * s + b * c, (H - 0.06) / 2, 0.03, 0.03, (H - 0.06) / 2, yaw, MAT.WOOD); }
    },
    bench(lx, ly, yaw, Lh = 1) { box(lx, ly, 0.42, Lh, 0.15, 0.03, yaw, MAT.WOOD); box(lx - Math.cos(yaw) * (Lh - 0.1), ly - Math.sin(yaw) * (Lh - 0.1), 0.2, 0.03, 0.14, 0.2, yaw, MAT.WOOD); box(lx + Math.cos(yaw) * (Lh - 0.1), ly + Math.sin(yaw) * (Lh - 0.1), 0.2, 0.03, 0.14, 0.2, yaw, MAT.WOOD); },
    chair(lx, ly, yaw) { box(lx, ly, 0.45, 0.22, 0.22, 0.025, yaw, MAT.WOOD); box(lx - Math.cos(yaw) * 0.2, ly - Math.sin(yaw) * 0.2, 0.7, 0.025, 0.22, 0.25, yaw, MAT.WOOD); for (const [p, q] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(lx + p * 0.18, ly + q * 0.18, 0.21, 0.02, 0.02, 0.21, 0, MAT.METAL); },
    crate(lx, ly, yaw, s = 0.35, z = 0) { box(lx, ly, z + s, s, s, s, yaw, MAT.WOOD); box(lx, ly, z + s, s + 0.01, 0.04, s + 0.01, yaw, MAT.RUST); },
    shelf(lx, ly, yaw, Lh = 1, H = 2.1, rnd = Math.random) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const e of [-Lh, Lh]) box(lx + e * c, ly + e * s, H / 2, 0.03, 0.22, H / 2, yaw, MAT.METAL);
      for (let k = 0; k < 5; k++) {
        const z = 0.1 + k * (H - 0.2) / 4;
        box(lx, ly, z, Lh, 0.22, 0.015, yaw, MAT.METAL);
        if (k < 4) for (let b = -Lh + 0.15; b < Lh - 0.1; b += 0.3) if (rnd() < 0.75) { const hb = 0.12 + rnd() * 0.1; box(lx + b * c, ly + b * s, z + 0.015 + hb, 0.12, 0.17, hb, yaw, rnd() < 0.6 ? MAT.PAPER : MAT.CLOTH); }
      }
    },
    bunk(lx, ly, yaw) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const [p, q] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(lx + p * 0.95 * c - q * 0.42 * s, ly + p * 0.95 * s + q * 0.42 * c, 0.85, 0.025, 0.025, 0.85, yaw, MAT.METAL);
      for (const z of [0.4, 1.35]) { box(lx, ly, z, 0.95, 0.42, 0.03, yaw, MAT.METAL); box(lx, ly, z + 0.09, 0.92, 0.4, 0.06, yaw, MAT.CLOTH); box(lx + 0.75 * c, ly + 0.75 * s, z + 0.18, 0.15, 0.3, 0.04, yaw, MAT.BONE); }
    },
    cot(lx, ly, yaw, sheet = MAT.CLOTH) { box(lx, ly, 0.4, 0.95, 0.4, 0.04, yaw, sheet); for (const p of [-1, 1]) box(lx + p * 0.85 * Math.cos(yaw), ly + p * 0.85 * Math.sin(yaw), 0.18, 0.03, 0.38, 0.18, yaw, MAT.METAL); },
    locker(lx, ly, yaw) { box(lx, ly, 0.95, 0.2, 0.25, 0.95, yaw, MAT.METAL); box(lx + Math.cos(yaw) * 0.26, ly + Math.sin(yaw) * 0.26, 1.5, 0.01, 0.12, 0.06, yaw, MAT.RUST); },
    barrel(lx, ly, mat = MAT.RUST) { cyl([lx, ly, 0], [lx, ly, 0.9], 0.3, 12, mat); for (const z of [0.2, 0.7]) cyl([lx, ly, z], [lx, ly, z + 0.04], 0.31, 12, MAT.METAL, false); },
    sandbags(lx, ly, yaw, Lh = 1.5, rows = 4) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (let k = 0; k < rows; k++) for (let b = -Lh + 0.3 + (k % 2) * 0.3; b <= Lh - 0.3; b += 0.6) box(lx + b * c, ly + b * s, 0.13 + k * 0.24, 0.3, 0.22, 0.12, yaw + ((b * 7) % 0.1), MAT.CLOTH);
    },
    board(lx, ly, z, yaw, hw, hh, mat = MAT.PAPER) { box(lx, ly, z, 0.02, hw, hh, yaw, mat); box(lx - Math.cos(yaw) * 0.025, ly - Math.sin(yaw) * 0.025, z, 0.01, hw + 0.05, hh + 0.05, yaw, MAT.WOOD); },
  };
  return K;
}

const ROOM_KIT = [
  [/galley|kitchen|mess/i, (K, rnd) => { K.table(0, 0, 0, 1.6, 0.45); K.bench(0, -0.85, 0, 1.5); K.bench(0, 0.85, 0, 1.5); K.box(-3.6, -3.6, 0.45, 0.7, 0.4, 0.45, 0, MAT.METAL); K.cyl([-3.6, -3.6, 0.9], [-3.6, -3.6, 3.4], 0.1, 8, MAT.RUST, false); K.shelf(-2.2, -4.4, 0, 1.2, 1.8, rnd); K.barrel(3.6, -3.6, MAT.WOOD); }],
  [/common/i, (K) => { for (const [x, y] of [[-2.2, 2.2], [2.2, 2.2], [-2.2, -2.2]]) { K.table(x, y, 0, 0.6, 0.6); K.chair(x - 0.9, y, 0); K.chair(x + 0.9, y, Math.PI); } K.box(3, -3.5, 0.3, 1.2, 0.4, 0.3, 0, MAT.CLOTH); K.board(-4.8, 0, 1.6, 0, 1, 0.6); }],
  [/bunk|dorm|runner/i, (K) => { for (const [x, y] of [[-3.2, -3.1], [3.2, -3.1], [-3.2, 3.1], [3.2, 3.1]]) K.bunk(x, y, 0); K.box(-1.4, -4.2, 0.25, 0.3, 0.2, 0.25, 0, MAT.CLOTH); K.box(1.6, 4.1, 0.2, 0.35, 0.25, 0.2, 0.4, MAT.CLOTH); }],
  [/archive|records/i, (K, rnd) => { for (const y of [-3.2, -1.6, 1.6, 3.2]) { K.shelf(-2.3, y, 0, 1.6, 2.1, rnd); K.shelf(2.3, y, 0, 1.6, 2.1, rnd); } K.table(0, 0, Math.PI / 2, 0.6, 0.4); }],
  [/operation|ops\b/i, (K) => { K.table(0, 0, 0, 1.6, 0.9, 0.85, MAT.PAPER); for (let k = 0; k < 4; k++) K.chair(-1.2 + k * 0.8, 1.4, -Math.PI / 2); K.board(-4.8, -2, 1.7, 0, 1.6, 0.8); K.board(-4.8, 2.2, 1.7, 0, 1.4, 0.8); K.table(2.5, -4.1, 0, 1.6, 0.45, 0.8, MAT.METAL); for (let k = 0; k < 3; k++) { K.box(1.5 + k, -4.2, 0.98, 0.25, 0.2, 0.18, 0, MAT.METAL); K.box(1.5 + k, -4.0, 1.0, 0.18, 0.01, 0.1, 0, MAT.SCREEN); } }],
  [/plot/i, (K) => { K.table(0, 0, 0, 1.4, 1.0, 0.9, MAT.PAPER); for (let k = 0; k < 9; k++) K.box(-1 + (k % 3) * 0.9, -0.6 + Math.floor(k / 3) * 0.6, 0.93, 0.03, 0.03, 0.04, 0, MAT.LAMP); K.board(4.8, 0, 1.6, Math.PI, 2, 0.9); K.board(0, 4.8, 1.6, -Math.PI / 2, 2, 0.9); }],
  [/generator/i, (K) => { K.box(-2.2, 2.2, 0.15, 1.6, 0.8, 0.15, 0, MAT.CONCRETE); K.cyl([-3.4, 2.2, 1.0], [-0.8, 2.2, 1.0], 0.65, 14, MAT.METAL); K.box(-2.6, 2.2, 1.75, 0.5, 0.4, 0.25, 0, MAT.RUST); K.cyl([-0.9, 2.2, 1.2], [-0.4, 2.2, 3.6], 0.12, 8, MAT.RUST, false); for (const [x, y] of [[3.3, 3.3], [3.3, 2.5], [2.5, 3.3]]) K.barrel(x, y); K.box(3.8, -3.5, 1.0, 0.2, 0.6, 0.8, 0, MAT.METAL); K.box(3.75, -3.5, 1.2, 0.01, 0.15, 0.1, 0, MAT.SCREEN); }],
  [/air/i, (K) => { for (const y of [-2.2, 2.2]) { K.cyl([-4.8, y, 1.6], [-4.2, y, 1.6], 1.1, 16, MAT.METAL); K.cyl([-4.2, y, 1.6], [-4.1, y, 1.6], 0.9, 16, MAT.CABLE); K.box(-2, y, 3.1, 2, 0.4, 0.3, 0, MAT.METAL); } }],
  [/infirmary|mending/i, (K) => { for (const x of [-3, -0.6, 1.8]) K.cot(x, -3.4, Math.PI / 2, MAT.BONE); K.box(3.9, 3.6, 0.9, 0.25, 0.7, 0.9, 0, MAT.METAL); K.table(0, 2.5, 0, 0.8, 0.4, 0.85, MAT.METAL); K.box(0, 2.5, 0.9, 0.15, 0.1, 0.05, 0, MAT.BONE); }],
  [/locker/i, (K) => { for (let x = -4; x <= 4; x += 0.5) if (Math.abs(x) > 1.2) { K.locker(x, -4.55, Math.PI / 2); K.locker(x, 4.55, -Math.PI / 2); } K.bench(0, 2, 0, 1.6); }],
  [/cage/i, (K) => { for (let x = -4.8; x <= 4.8; x += 0.18) K.cyl([x, 1, 0], [x, 1, 3.6], 0.02, 4, MAT.METAL, false); K.cyl([-4.8, 1, 2.2], [4.8, 1, 2.2], 0.03, 4, MAT.METAL, false); K.cot(-2.5, 3.5, 0); K.box(2.5, 3.8, 0.2, 0.2, 0.2, 0.2, 0, MAT.RUST); }],
  [/press/i, (K, rnd) => { K.box(0, 1.5, 0.7, 1.2, 0.8, 0.7, 0, MAT.METAL); K.cyl([-1.3, 1.5, 1.0], [1.3, 1.5, 1.0], 0.35, 12, MAT.RUST); for (let k = 0; k < 6; k++) K.box(-3.5 + k * 0.5, -3.6, 0.15 + rnd() * 0.2, 0.2, 0.15, 0.15 + rnd() * 0.2, 0, MAT.PAPER); K.table(3, -3, 0, 1, 0.45); }],
  [/vice|bench|workshop/i, (K) => { K.table(0, -4.1, 0, 2.2, 0.45, 0.9); K.box(-1, -4.0, 1.0, 0.12, 0.1, 0.1, 0, MAT.METAL); K.board(0, -4.85, 1.7, Math.PI / 2, 2, 0.6, MAT.WOOD); for (let k = 0; k < 7; k++) K.box(-1.6 + k * 0.5, -4.8, 1.6, 0.02, 0.04, 0.2, 0, MAT.METAL); K.crate(3, 3, 0.2); }],
  [/cache|surplus|sorrow|quarter|store/i, (K, rnd) => { for (let k = 0; k < 10; k++) K.crate(-4 + (k % 4) * 0.8, 3.2 + Math.floor(k / 4) * 0.7, rnd(), 0.3, k > 7 ? 0.6 : 0); K.shelf(3.2, -4.4, 0, 1.4, 2, rnd); K.table(0, -1.5, 0, 1.6, 0.35, 1.0); }],
  [/quiet/i, (K) => { K.table(0, 0, 0, 0.4, 0.4, 0.45); for (let k = 0; k < 3; k++) { const a = k * 2.1; K.chair(Math.cos(a) * 1.2, Math.sin(a) * 1.2, a + Math.PI); } }],
  [/tap|bar\b/i, (K) => { K.table(-1, -3.6, 0, 2.4, 0.35, 1.05); for (let x = -3; x <= 1; x += 0.8) K.barrel(x, -4.5, MAT.WOOD); K.crate(3.5, 3.5, 0.3); K.chair(1, 2, 0); K.chair(2, 2.4, 2); }],
  [/blind/i, (K) => { K.sandbags(0, -3.4, 0, 2, 5); K.sandbags(0, 3.4, 0, 2, 5); K.cyl([0, -4, 0.8], [0, -4, 3.6], 0.08, 8, MAT.METAL, false); K.box(0, -3.92, 1.5, 0.08, 0.15, 0.08, 0, MAT.METAL); K.chair(0, -3.2, Math.PI / 2); }],
  [/threshold|gate/i, (K) => { K.sandbags(-2.6, -2, Math.PI / 2, 1.8, 4); K.sandbags(-2.6, 2, Math.PI / 2, 1.8, 4); K.table(3, -3.8, 0, 0.8, 0.4); K.chair(3, -3.1, -Math.PI / 2); K.board(4.8, 0, 1.7, Math.PI, 0.8, 0.5); }],
  [/dogleg|sally/i, (K) => { K.sandbags(-1.5, -2.4, 0, 1.8, 5); K.sandbags(1.5, 2.4, 0, 1.8, 5); K.crate(3.8, -3.8, 0.3); }],
  [/drift|spine/i, (K, rnd) => { for (let k = 0; k < 6; k++) K.crate(-4 + k * 1.6, (k % 2 ? 4 : -4), rnd()); }],
  [/deadfall/i, (K, rnd) => { for (let k = 0; k < 14; k++) K.box(-3 + rnd() * 2, -3 + rnd() * 2, 0.15, 0.2 + rnd() * 0.3, 0.2 + rnd() * 0.3, 0.15 + rnd() * 0.2, rnd() * 6, MAT.ROCK); }],
];

function dressRoom(r, M, lights, rnd) {
  const K = kit(M, r);
  const hit = ROOM_KIT.find(([re]) => re.test(r.name));
  if (hit) hit[1](K, rnd); else { K.crate(-3.5, -3.5, rnd()); K.crate(3.5, 3.4, rnd()); }
  const at = (lx, ly, z) => [r.x + lx * u, r.y + ly * u, ANNEX_Z + z * u];
  if (/generator/i.test(r.name)) { const p = at(-2.2, 2.2, 2.4); lights.push({ x: p[0], y: p[1], z: p[2], c: [1.0, 0.25, 0.08], i: 0.8, range: 0.5, flick: 0.4, seed: rnd() }); }
  if (/operation|ops\b/i.test(r.name)) { const p = at(2.5, -3.8, 1.2); lights.push({ x: p[0], y: p[1], z: p[2], c: [0.3, 1.0, 0.45], i: 0.5, range: 0.3, flick: 0.2, seed: rnd() }); }
  // A hatch for a way down or up out of the room.
  if (r.e.includes('D') || r.e.includes('U')) {
    K.box(2.6, 2.6, 0.02, 0.55, 0.55, 0.02, 0, MAT.METAL);
    K.box(2.6, 2.6, 0.045, 0.45, 0.45, 0.005, 0, MAT.CABLE);
    K.box(2.6, 2.05, 0.5, 0.45, 0.03, 0.45, 0, MAT.RUST);   // the lid, thrown open
  }
}

function confineAnnex(g, x, y, take) {
  for (const r of g.rooms || []) {
    if (Math.abs(x - r.x) > 1.2 || Math.abs(y - r.y) > 1.2) continue;
    const lim = RS - 0.02;
    take(r.x + Math.max(-lim, Math.min(lim, x - r.x)), r.y + Math.max(-lim, Math.min(lim, y - r.y)), ANNEX_Z + 0.05, ANNEX_Z + RH - 0.02);
  }
  for (const h of g.halls || []) {
    const s = (x - h.a.x) * h.dx + (y - h.a.y) * h.dy;
    if (s < 0 || s > 1) continue;
    const lat = -(x - h.a.x) * h.dy + (y - h.a.y) * h.dx, lim = CW - 0.012, l = Math.max(-lim, Math.min(lim, lat));
    take(h.a.x + h.dx * s - h.dy * l, h.a.y + h.dy * s + h.dx * l, ANNEX_Z + 0.05, ANNEX_Z + CHH - 0.015);
  }
  for (const st of g.stairs || []) {
    const n = st.node, s = (x - n.x) * st.dx + (y - n.y) * st.dy;
    if (s < st.s0 - 0.02 || s > 1) continue;
    const lat = -(x - n.x) * st.dy + (y - n.y) * st.dx, lim = W - 0.018, l = Math.max(-lim, Math.min(lim, lat));
    take(n.x + st.dx * s - st.dy * l, n.y + st.dy * s + st.dx * l, stairFloor(st, s) + 0.05, stairCeil(st, s) - 0.015);
  }
}
