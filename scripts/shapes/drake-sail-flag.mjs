// Rebuilds the Drake's "sail flag" decal from the sail fan it sits on.
//
// The flag fills the whole outboard face of each fan: every feather is clipped into thirteen
// horizontal stripes, with the canton in the top corner and fifty stars on it. The canton sits
// top LEFT as you look at the fan from either side, so it is forward on the right-hand fan and
// aft on the left-hand one (the left one comes from `left.replace`, not the plain mirror).
//
//   node scripts/shapes/drake-sail-flag.mjs && npm run vehicles:bake
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'content/vehicle_models/mesh_drake.json';
const mesh = JSON.parse(readFileSync(FILE, 'utf8'));

const find = (o, name) => {
  if (Array.isArray(o)) { for (const x of o) { const r = find(x, name); if (r) return r; } return null; }
  if (o && typeof o === 'object') {
    if (o.name === name) return o;
    for (const v of Object.values(o)) { const r = find(v, name); if (r) return r; }
  }
  return null;
};
const sail = find(mesh, 'sail'), decal = find(mesh, 'sail flag');

// The two skins: even feather quads face outboard, odd ones inboard (the rim strips at the end run
// along the tip). The flag goes on both, so no bare sail shows round it from any side.
const skin = sail.faces.filter((f, i) => i < 70 && i % 2 === 0);
const inner = sail.faces.filter((f, i) => i < 70 && i % 2 === 1);

const xs = skin.flatMap((f) => f.p.map((q) => q[0])), zs = skin.flatMap((f) => f.p.map((q) => q[2]));
const X0 = Math.min(...xs), X1 = Math.max(...xs), Z0 = Math.min(...zs), Z1 = Math.max(...zs);
const STRIPES = 13, SH = (Z1 - Z0) / STRIPES;
const CANTON_Z = Z1 - 7 * SH, CANTON_W = 0.42 * (X1 - X0);
const LIFT = 0.0016, STAR_LIFT = 0.0024;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Sutherland–Hodgman against the half-space s(p) >= 0.
function clip(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(a.map((v, k) => v + (b[k] - v) * t)); }
  }
  return out;
}
function normal(p, out = 1) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / L, ny / L, nz / L];
  return n[1] * out < 0 ? n.map((v) => -v) : n;   // outboard is +y on the right fan
}
const lift = (p, n, d) => p.map((q) => q.map((v, k) => r4(v + n[k] * d)));
const area2 = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const u = p[i], w = p[(i + 1) % p.length]; a += u[0] * w[2] - w[0] * u[2]; } return a; };

// cantonFwd: the canton on the +x (forward) edge; false puts it on the aft edge.
// out: 1 lifts off the outboard skin, -1 off the inboard one.
function build(cantonFwd, faceSet = skin, out = 1) {
  const inCanton = cantonFwd ? (x) => x - (X1 - CANTON_W) : (x) => (X0 + CANTON_W) - x;
  const faces = [], canton = [];
  for (const f of faceSet) {
    const n = normal(f.p, out), sign = Math.sign(area2(f.p));
    for (let s = 0; s < STRIPES; s++) {
      const lo = Z0 + s * SH, hi = lo + SH;
      let band = clip(clip(f.p, (q) => q[2] - lo), (q) => hi - q[2]);
      if (band.length < 3) continue;
      const stripe = s % 2 === 0 ? 'flagRed' : 'flagWhite';   // bottom and top stripes are red
      if (lo >= CANTON_Z - 1e-9) {
        const blue = clip(band, (q) => inCanton(q[0]));
        band = clip(band, (q) => -inCanton(q[0]));
        if (blue.length >= 3) { faces.push({ p: lift(blue, n, LIFT), paint: 'flagBlue', role: 'body', sh: 0.92 }); canton.push({ p: blue, n, sign }); }
      }
      if (band.length >= 3) faces.push({ p: lift(band, n, LIFT), paint: stripe, role: 'body', sh: 0.92 });
    }
  }
  // Fifty stars: nine rows alternating six and five, on the surface under each one.
  const cx0 = cantonFwd ? X1 - CANTON_W : X0, cw = CANTON_W, ch = Z1 - CANTON_Z;
  const R = Math.min(cw / 12, ch / 10) * 0.55;
  const inside = (p, x, z) => {   // point-in-polygon on the x/z projection
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, , zi] = p[i], [xj, , zj] = p[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (let r = 0; r < 9; r++) {
    const cols = r % 2 === 0 ? 6 : 5, z = Z1 - ch * (r + 1) / 10;
    for (let c = 0; c < cols; c++) {
      const x = cx0 + cw * ((r % 2 === 0 ? 2 * c + 1 : 2 * c + 2) / 12);
      const host = canton.find((h) => inside(h.p, x, z));
      if (!host) continue;   // off the fan's outline
      const [a, b, d] = host.p, n = host.n;
      // y on the host's plane at (x, z)
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const pn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const yAt = (px, pz) => a[1] - (pn[0] * (px - a[0]) + pn[2] * (pz - a[2])) / pn[1];
      let pts = [];
      for (let k = 0; k < 10; k++) {   // a five-point star as a ring: tip, notch, tip…
        const ang = Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.42 : R;
        const px = x + Math.cos(ang) * rr, pz = z + Math.sin(ang) * rr;
        pts.push([px, yAt(px, pz), pz]);
      }
      if (Math.sign(area2(pts)) !== host.sign) pts.reverse();
      // A star is concave, and a plate is drawn as one fan, so split it: the pentagon and five tips.
      const ring = pts;
      const inner = [1, 3, 5, 7, 9].map((i) => ring[i]);
      const pent = Math.sign(area2(inner)) === host.sign ? inner : inner.slice().reverse();
      faces.push({ p: lift(pent, n, STAR_LIFT), paint: 'flagStar', role: 'body', sh: 0.92 });
      for (let t = 0; t < 10; t += 2) {
        let tri = [ring[(t + 9) % 10], ring[t], ring[t + 1]];
        if (Math.sign(area2(tri)) !== host.sign) tri = tri.reverse();
        faces.push({ p: lift(tri, n, STAR_LIFT), paint: 'flagStar', role: 'body', sh: 0.92 });
      }
    }
  }
  return faces;
}

// Seen from inboard the fan is mirrored, so the canton goes to the other edge to stay top left.
const both = (fwd) => [...build(fwd), ...build(!fwd, inner, -1)];
decal.faces = both(false);
// The fan's own skin goes back to plain sail paint: its old per-vane stripes read as vertical bars
// wherever they showed round the decal.
for (const f of sail.faces) delete f.paint;
const left = both(true).map((f) => ({ ...f, p: f.p.map((q) => [q[0], q[1] === 0 ? 0 : -q[1], q[2]]) }));
decal.left = { replace: { kind: 'poly', name: 'sail flag', faces: left } };
decal.note = 'A flag over both faces of each sail fan, generated by scripts/shapes/drake-sail-flag.mjs: thirteen stripes across every feather, the canton top left as seen from either side (forward on the right fan, aft on the left). Its slots match the sail paint unless a scheme (Quackhawk Down) colours them.';
writeFileSync(FILE, JSON.stringify(mesh, null, 2) + '\n');
console.log('sail flag:', decal.faces.length, 'faces a side');
