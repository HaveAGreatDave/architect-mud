// Rinkside · shared maths. Small and dependency-free: vectors as plain [x, y, z] arrays,
// a seeded PRNG, two-bone IK and a colour shader. Every rink module imports from here so
// there is one definition of each.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const angWrap = (d) => { d = (d + Math.PI) % TAU; if (d < 0) d += TAU; return d - Math.PI; };
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIO = (t) => t * t * (3 - 2 * t);

// mulberry32. Seeded so a beat looks the same on every screen watching it.
export function rng(seed) {
  let a = seed | 0;
  return function () {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function hash(str) {
  let x = 0x811c9dc5 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
  return x >>> 0;
}

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  // a + u*a1 + v*a2 + w*a3, the one expression every surface point is built from
  frame: (o, u, a1, v, a2, w, a3) => [
    o[0] + u[0] * a1 + v[0] * a2 + (w ? w[0] * a3 : 0),
    o[1] + u[1] * a1 + v[1] * a2 + (w ? w[1] * a3 : 0),
    o[2] + u[2] * a1 + v[2] * a2 + (w ? w[2] * a3 : 0),
  ],
};
export const rotZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };

// Two-bone IK. Returns [middle joint, end]; the end is pulled in if the target is out of reach.
export function ik(A, T, l1, l2, pole) {
  let d = V.sub(T, A), dist = V.len(d);
  const dn = V.mul(d, 1 / (dist || 1));
  const reach = l1 + l2 - 0.001;
  if (dist > reach) { dist = reach; T = V.add(A, V.mul(dn, reach)); }
  dist = Math.max(dist, Math.abs(l1 - l2) + 0.01);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pp = V.norm(V.sub(pole, V.mul(dn, V.dot(pole, dn))));
  return [V.add(A, V.add(V.mul(dn, a), V.mul(pp, h))), T];
}

const _shade = new Map();
// f > 0 mixes toward white, f < 0 toward black. Cached: the figure asks for the same few
// dozen shades every frame.
export function shade(hex, f) {
  const k = hex + f;
  let v = _shade.get(k);
  if (v) return v;
  const n = parseInt(String(hex).slice(1, 7), 16);
  let r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  v = `rgb(${r | 0},${g | 0},${b | 0})`;
  _shade.set(k, v);
  return v;
}

// Andrew's monotone chain over screen points {x, y}.
export function hull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
