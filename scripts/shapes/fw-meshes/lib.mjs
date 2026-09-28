// Shared authoring helpers for the fixed-wing mesh files. Everything here emits PARTS (mesh-file
// data), never faces, except the aerofoil surfaces, which have no primitive that can bend them.
import { ceFoil } from '../../../client/shared/vehicle-mesh.js';

export const R = (x, n = 4) => { const k = 10 ** n; const v = Math.round(x * k) / k; return Object.is(v, -0) ? 0 : v; };
export const P3 = (a) => [R(a[0]), R(a[1]), R(a[2])];

// ── Fuselage sections ─────────────────────────────────────────────────────────
// Same arithmetic as emitLoft's super-ellipse ring, so a detail placed on the skin sits on it.
export function secPt(s, a) {
  const e = s.boxy != null ? 1 - s.boxy * 0.55 : 1;
  const cs = Math.cos(a), sn = Math.sin(a);
  const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * s.rg;
  const h = sn >= 0 ? Math.pow(sn, e) * s.rvT : -Math.pow(-sn, e) * s.rvB;
  return [s.f, g, s.cz + h];
}
export function stationAt(sts, f) {
  if (f >= sts[0].f) return { ...sts[0], f };
  for (let i = 0; i < sts.length - 1; i++) {
    const a = sts[i], b = sts[i + 1];
    if (f <= a.f && f >= b.f) {
      const t = (a.f - f) / (a.f - b.f || 1), L = (k) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
      return { f, rg: L('rg'), rvT: L('rvT'), rvB: L('rvB'), cz: L('cz'), boxy: L('boxy') };
    }
  }
  return { ...sts[sts.length - 1], f };
}
export const skin = (sts, f, a, out = 0) => {
  const s = stationAt(sts, f);
  const p = secPt({ ...s, rg: s.rg + out, rvT: s.rvT + out, rvB: s.rvB + out }, a);
  return p;
};

export function loft(name, sides, stations, extra = {}) {
  return {
    kind: 'loft', name, sides, section: 'super', role: 'body',
    stations: stations.map((s) => {
      const o = { f: R(s.f), rg: R(s.rg), rvT: R(s.rvT), rvB: R(s.rvB), cz: R(s.cz), boxy: R(s.boxy ?? 0) };
      if (s.u != null) o.u = R(s.u);
      if (s.minDetail != null) o.minDetail = s.minDetail;
      return o;
    }),
    ...extra,
  };
}
// An ellipse-section loft of revolution along f at (g, h): nacelles, pods, spinners, drop tanks.
// stations: [f, r] or [f, r, dh]. Built at g = 0 and moved by the group's translate.
export function pod(name, g, h, stations, { sides = 12, paint, role = 'nacelle', capFore, capAft, regions, shade } = {}) {
  const lo = {
    kind: 'loft', name, sides, section: 'ellipse', role,
    stations: stations.map(([f, r, dh = 0, ry]) => ({ f: R(f), rg: R(ry ?? r), rv: R(r), rvT: R(r), rvB: R(r), cz: R(h + dh) })),
  };
  if (capFore) lo.capFore = capFore;
  if (capAft) lo.capAft = capAft;
  if (regions) lo.regions = regions;
  if (shade) lo.shade = shade;
  if (paint) lo.paint = paint;
  return g ? { kind: 'group', name, parts: [lo], xf: { t: [0, R(g), 0] } } : lo;
}

// ── Aerofoil surfaces ─────────────────────────────────────────────────────────
// stations (starboard): [{ g, le, te, h, t }] — t is the thickness against a 12% section.
// Returns a poly part holding both sides. `bands` paints chordwise strips: [{ x0, x1, paint }].
const XS = (n) => { const o = []; for (let i = 0; i < n; i++) o.push(0.5 * (1 - Math.cos(Math.PI * i / (n - 1)))); return o; };
export function foilPt(s, x, upper) {
  const c = s.le - s.te, [u, l] = ceFoil(x);
  const y = (upper ? u : l) * c * (s.t ?? 1);
  return [s.le - x * c, s.g, s.h + y];
}
export function foilFaces(stations, { nx = 9, role = 'wing', paint, bands = [], tip = true, root = false, lowerSh = 0.5, axis = 'z', sides = 2 } = {}) {
  const xs = XS(nx), faces = [];
  // axis 'g' is a fin: the section lies in the f-g plane and the span runs up h. Swap g<->h.
  const tr = axis === 'g' ? (p) => [p[0], p[2], p[1]] : (p) => p;
  const paintAt = (x0, x1) => { const xm = (x0 + x1) / 2; for (const b of bands) if (xm >= b.x0 && xm < b.x1) return b.paint; return paint; };
  const put = (pts, sh, pt, mirror) => {
    let q = pts.map(tr);
    if (mirror) q = q.map((v) => [v[0], v[1] === 0 ? 0 : -v[1], v[2]]).reverse();
    const f = { role, sh: R(sh, 3), p: q.map(P3) };
    if (pt) f.paint = pt;
    faces.push(f);
  };
  for (const mirror of sides === 2 ? [false, true] : [false]) {
    for (let i = 0; i < stations.length - 1; i++) {
      const A = stations[i], B = stations[i + 1];
      for (let j = 0; j < nx - 1; j++) {
        const x0 = xs[j], x1 = xs[j + 1], pt = paintAt(x0, x1);
        const lit = 0.8 + 0.18 * Math.sin(Math.PI * Math.min(1, (x0 + x1) / 2 * 1.6));
        put([foilPt(A, x0, 1), foilPt(B, x0, 1), foilPt(B, x1, 1), foilPt(A, x1, 1)], lit, pt, mirror);
        put([foilPt(A, x1, 0), foilPt(B, x1, 0), foilPt(B, x0, 0), foilPt(A, x0, 0)], lowerSh, pt, mirror);
      }
    }
    const capAt = (S, rev) => {
      for (let j = 0; j < nx - 1; j++) {
        const q = [foilPt(S, xs[j], 1), foilPt(S, xs[j + 1], 1), foilPt(S, xs[j + 1], 0), foilPt(S, xs[j], 0)];
        put(rev ? q.reverse() : q, 0.66, paintAt(xs[j], xs[j + 1]), mirror);
      }
    };
    if (tip) capAt(stations[stations.length - 1], false);
    if (root) capAt(stations[0], true);
  }
  return faces;
}
export function foil(name, stations, opts = {}) {
  if (opts.axis === 'g' && opts.sides == null) opts = { lowerSh: 0.72, ...opts, sides: 1 };
  const { nx = 9, lodNx = 4 } = opts;
  return {
    kind: 'group', name, parts: [
      { kind: 'poly', name: name + ' (near)', minDetail: 1, faces: foilFaces(stations, { ...opts, nx }) },
      { kind: 'poly', name: name + ' (far)', maxDetail: 0, faces: foilFaces(stations, { ...opts, nx: lodNx, bands: [] }) },
    ],
  };
}
// A point on a surface's mean line at spanwise position along two stations.
export const lerpSt = (A, B, t) => ({ g: A.g + (B.g - A.g) * t, le: A.le + (B.le - A.le) * t, te: A.te + (B.te - A.te) * t, h: A.h + (B.h - A.h) * t, t: (A.t ?? 1) + ((B.t ?? 1) - (A.t ?? 1)) * t });
// A hinged trailing-edge surface between spanwise t0..t1 on the stations A→B, starboard, mirrored.
export function ctrlOn(role, A, B, t0, t1, cf, { axis = 'z', sh = 0.78, half } = {}) {
  const s0 = lerpSt(A, B, t0), s1 = lerpSt(A, B, t1);
  const tr = axis === 'g' ? (p) => [p[0], p[2], p[1]] : (p) => p;
  const mean = (s, x) => { const u = foilPt(s, x, 1), l = foilPt(s, x, 0); return [u[0], u[1], (u[2] + l[2]) / 2]; };
  const hh = half ?? Math.max(0.004, (foilPt(s0, 1 - cf, 1)[2] - foilPt(s0, 1 - cf, 0)[2]) / 2);
  const c = {
    kind: 'ctrl', name: role, role, side: 1, sh,
    le: [P3(tr(mean(s0, 0))), P3(tr(mean(s1, 0)))], te: [P3(tr(mean(s0, 1))), P3(tr(mean(s1, 1)))], cf, axis, half: R(hh),
  };
  return axis === 'g' ? c : { kind: 'mirror', name: role + 's', parts: [c] };
}

// ── Small things ──────────────────────────────────────────────────────────────
export const tube = (name, pts, r, extra = {}) => ({ kind: 'tube', name, pts: pts.map(P3), r: R(r), ...extra });
export const mirror = (name, parts) => ({ kind: 'mirror', name, parts });
export const group = (name, parts, extra = {}) => ({ kind: 'group', name, parts, ...extra });
export const poly = (name, faces, extra = {}) => { const { exact, ...rest } = extra; return { kind: 'poly', name, faces: faces.map((f) => ({ ...f, p: exact ? f.p : f.p.map(P3) })), ...rest }; };
export const quad = (a, b, c, d, extra = {}) => ({ p: [a, b, c, d], ...extra });
export const cone = (name, f, g, h, r, apex, extra = {}) => ({ kind: 'cone', name, f: R(f), ...(g ? { g: R(g) } : {}), h: R(h), r: R(r), apex: P3(apex), ...extra });
export const wheel = (name, at, r, hw, n = 12) => ({ kind: 'wheel', name, at: P3(at), r: R(r), hw: R(hw), n });
export const strut = (name, f, g, top, bot, r) => ({ kind: 'strut', name, at: [R(f), R(g)], top: R(top), bot: R(bot), r: R(r) });
export const faired = (name, pts, chord, th, extra = {}) => ({ kind: 'faired', name, pts: pts.map(P3), chord: R(chord), th: R(th), ...extra });

// A rectangular window set into a fuselage skin at (f, angle), `w` long and `hh` tall in angle,
// standing a hair proud so it never shares a plane with the skin under it.
export function skinWindow(sts, f0, f1, a0, a1, extra = {}) {
  const o = 0.0025;
  return { p: [skin(sts, f1, a0, o), skin(sts, f0, a0, o), skin(sts, f0, a1, o), skin(sts, f1, a1, o)].map(P3), ...extra };
}
// A strip of skin panel (paint band) proud of the hull: stripes, anti-glare, walkway.
export function skinBand(sts, fs, a0, a1, extra = {}, o = 0.0018) {
  const out = [];
  for (let i = 0; i < fs.length - 1; i++) {
    out.push({ p: [skin(sts, fs[i + 1], a0, o), skin(sts, fs[i], a0, o), skin(sts, fs[i], a1, o), skin(sts, fs[i + 1], a1, o)].map(P3), ...extra });
  }
  return out;
}
// Angle (radians) on a section, 0 = starboard waterline, +90 = crown, -90 = keel.
export const DEG = Math.PI / 180;
// A band all the way round a fuselage between two stations: a painted ring, a seam.
export function ringBand(sts, f0, f1, n, extra = {}, o = 0.0018) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
    out.push({ p: [skin(sts, f0, a0, o), skin(sts, f0, a1, o), skin(sts, f1, a1, o), skin(sts, f1, a0, o)].map(P3), ...extra });
  }
  return out;
}

// ── The flight deck, kept from the fw row ─────────────────────────────────────
// Every fixed-wing interior (client/shared/interior-*.js) is built from its fw row's hull and
// glass, and its gate holds the room against the exterior's glass. So the stretch of hull that
// carries the glass is lifted from the old builder face for face, and the new fuselage is bridged
// onto it at both ends. Everything outside that stretch is new.
const A3 = '../../../client/game/js/panels/aircraft3d.js';
export async function legacyFaces(cls, detail = 1) {
  const m = await import(A3);
  m.setLegacyMeshes(true);
  const faces = m.aircraftFaces(cls, detail).map((f) => ({ ...f, p: f.p.map((v) => v.slice()) }));
  m.setLegacyMeshes(false);
  return faces;
}
export function oldStations(p) {
  let st = [p.noseF, p.noseF * 0.66, p.noseF * 0.33, 0, p.tailF * 0.35, p.tailF * 0.7, p.tailF];
  if (p.extraF) {
    const keep = st.filter((f) => f === p.noseF || f === p.tailF || !p.extraF.some((e) => Math.abs(e - f) < 0.03));
    st = [...keep, ...p.extraF].sort((a, b) => b - a);
  }
  return st;
}
// The old hull ring at station f, in loft order (k 0 at starboard mid-side, round over the crown).
export function oldRing(faces, f) {
  const pts = new Map();
  for (const fc of faces) if (fc.role === 'body' || fc.role === 'glass') for (const v of fc.p) if (Math.abs(v[0] - f) < 1e-9) pts.set(v.map((x) => x.toFixed(9)).join(','), v);
  const all = [...pts.values()];
  const hc = all.reduce((a, v) => a + v[2], 0) / all.length;
  const ang = (v) => { let a = Math.atan2(v[2] - hc, v[1]); if (a < -1e-9) a += Math.PI * 2; return a; };
  return all.sort((a, b) => ang(a) - ang(b));
}
// Faces of the old mesh lying wholly inside [lo, hi] along f, with the given roles.
export function oldZone(faces, lo, hi, roles = ['body', 'glass']) {
  return faces.filter((fc) => roles.includes(fc.role) && fc.p.every((v) => v[0] >= lo - 1e-9 && v[0] <= hi + 1e-9));
}
// Skin a ring of `n = m * no` points onto a ring of `no` points (m a whole number).
export function bridge(mine, old, extra = {}, reverse = false) {
  const n = mine.length, no = old.length, m = n / no, out = [];
  if (m !== Math.round(m)) throw new Error('bridge: ' + n + ' onto ' + no + ' is not a whole multiple');
  for (let k = 0; k < no; k++) {
    const A = old[k], B = old[(k + 1) % no];
    const mid = k * m + m / 2;
    for (let j = k * m; j < (k + 1) * m; j++) {
      const P = mine[j % n], Q = mine[(j + 1) % n];
      const t = [(j < mid ? A : B), P, Q].map(P3);
      out.push({ ...extra, p: reverse ? t.reverse() : t });
    }
    const t = [A, mine[Math.round(mid) % n], B].map(P3);
    out.push({ ...extra, p: reverse ? t.reverse() : t });
  }
  return out;
}
export const loftRing = (s, n) => { const o = []; for (let k = 0; k < n; k++) o.push(secPt(s, k / n * Math.PI * 2)); return o; };
// The whole transplant: returns parts for detail 1 (two lofts + bridges + the old stretch) and the
// full loft for the far LOD. `S` is the new station list (fore→aft); stations inside [lo, hi] are
// dropped at detail 1. `paintOf(face)` picks a paint slot for a lifted hull face.
export function flightDeck({ name = 'fuselage', S, n, old, lo, hi, loftExtra = {}, foreExtra = {}, aftExtra = {}, paintOf = () => 'hull', keepRoles = ['body', 'glass'] }) {
  const fore = S.filter((s) => s.f > hi + 1e-9), aft = S.filter((s) => s.f < lo - 1e-9);
  const zone = oldZone(old, lo, hi, keepRoles).map((fc) => {
    // Full precision: the cockpit gates match these vertices to 1e-6.
    const o = { role: fc.role, p: fc.p.map((v) => v.slice()) };
    // Glass keeps its authored shade; hull faces take theirs from their normal, as a loft's do, so
    // the lifted stretch does not read as a collar of a different tone.
    // The builder winds its hull the other way round to a loft, so a derived shade would read the
    // outside as the inside and come out belly-dark: turn the hull faces round.
    if (fc.role !== 'body') o.sh = R(fc.sh ?? 0.7, 3); else o.p.reverse();
    for (const k of ['tint', 'art', 'uv', 'visor', 'visorHinge']) if (fc[k] != null && k !== 'visor' && k !== 'visorHinge') o[k] = k === 'uv' ? fc.uv.map((u) => [R(u[0], 2), R(u[1], 2)]) : fc[k];
    if (fc.role === 'body') o.paint = paintOf(fc);
    return o;
  });
  const rHi = oldRing(old, hi), rLo = oldRing(old, lo);
  const parts = [
    { kind: 'group', name: name + ' (near)', minDetail: 1, parts: [
      loft(name + ' fore', n, fore, { ...loftExtra, ...foreExtra }),
      poly('flight deck (from the fw row)', zone, { exact: true }),
      poly('fore bridge', bridge(loftRing(fore[fore.length - 1], n), rHi, { role: 'body', paint: loftExtra.paint || 'hull' })),
      poly('aft bridge', bridge(loftRing(aft[0], n), rLo, { role: 'body', paint: loftExtra.paint || 'hull' }, true)),
      loft(name + ' aft', n, aft, { ...loftExtra, ...aftExtra }),
    ] },
    loft(name, n, S, { ...loftExtra, ...foreExtra, ...aftExtra, maxDetail: 0, regions: [...(foreExtra.regions || []), ...(aftExtra.regions || []), ...(loftExtra.regions || [])] }),
  ];
  return { parts, rHi, rLo, zone };
}
// A new-loft station that reproduces the old hull ring at f exactly (plain super-ellipse rows only).
export function oldStation(old, f, boxy) {
  const r = oldRing(old, f), hs = r.map((v) => v[2]), gs = r.map((v) => v[1]);
  const top = Math.max(...hs), bot = Math.min(...hs), w = Math.max(...gs);
  return { f, rg: w, rvT: (top - bot) / 2, rvB: (top - bot) / 2, cz: (top + bot) / 2, boxy };
}
// The old canopy, face for face, with its art.
export function oldGlass(old) {
  return old.filter((fc) => fc.role === 'glass').map((fc) => {
    const o = { role: 'glass', sh: R(fc.sh ?? 0.7, 3), p: fc.p.map((v) => v.slice()) };
    if (fc.tint) o.tint = fc.tint;
    if (fc.art) { o.art = fc.art; o.uv = fc.uv.map((u) => [R(u[0], 2), R(u[1], 2)]); }
    return o;
  });
}
