// THE GRASSHOPPER'S COCKPIT: a Piper J-3 Cub, flown solo from the back seat.
//
// Tandem, two seats one behind the other in a fuselage 70 cm wide. You sit in the BACK, because the
// fuel tank is on the firewall and one person in the front seat puts the balance out; so what is
// in front of you is the empty front seat, its stick moving with yours, and past both of them, two
// metres away, a panel with five dials on it. The side glass runs from your elbow to your eye the
// full length of the cabin, the skylight is over your head, the right side is a split door, and the
// fuel gauge is a wire on a cork float standing out of the tank cap ahead of the windscreen.
//
// Sources read for this (panel contents, seating, the float gauge, dimensions):
//   https://en.wikipedia.org/wiki/Piper_J-3_Cub
//   https://www.j3-cub.com/threads/instrument-panel-clarification.18829/
//   https://aerocorner.com/aircraft/piper-j-3-cub/  (fuselage 0.7 m across, 6.8 m long)
// What they settle: solo from the rear seat; 3 3/4" Stewart Warner tach and 3 1/8" airspeed and
// altimeter with cream faces, a combined oil pressure/temperature gauge, a B-16 compass; a fuel
// float wire through the tank cap; the L-4's skylight. The rest (throttle on the left wall at each
// seat, heel brakes on the rear pedals only, the trim crank overhead on the left, the magneto key
// and primer on the panel) is the type as every J-3 is flown.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE LOFT, NEVER A SECOND DESCRIPTION OF IT ─
//
// The walls walk mesh_grasshopper.json's `fuselage` stations with the loft's own super-ellipse (the
// `super` branch of emitLoft, `boxy` and all), and every window is a HOLE cut along one of the
// loft's own glass regions, in the loft's own (f, a) parameters: the windscreen band, the side
// glass either side, the skylight. Edit the loft or move a region and the room follows.
//
// ── ⚠ ONE SCALE, AND IT IS THE SPAN ──────────────────────────────────────────
//
// The model is a caricature of a Cub, and its three dimensions disagree with each other: measured
// on LENGTH (1.90 units against 6.83 m) it is 3.6 m a unit, on SPAN (2.32 units against 10.74 m)
// it is 4.63, and on fuselage WIDTH (0.156 units against 0.70 m) 4.5. Two of three agree, and they
// are the two that decide what a room is like to sit in — so M is the span's, derived from the wing
// part below rather than typed. The length is the outlier: the model's tail is long.
//
// ── ⚠ THE ONE PLACE THE ROOM DOES NOT MATCH: THE CROWN ────────────────────────
//
// On a Cub the wing sits ON the cabin and the skylight is the gap between its roots. The model
// draws the fuselage crown 0.07 units (32 cm) under the wing, with cabane struts across the gap, so
// at one scale the loft is 90 cm tall inside and nobody can sit in it with their eyes open. So the
// room's crown (and only its crown: `rvT`) is carried up to the underside of the model's own wing
// root — `CROWN`, derived from the wing faces — which is the real aircraft's cabin top. Everything
// is cut in (f, a), so the glass keeps its place on the section; the side glass just grows taller
// with the crown. The gate maps the exterior through the same one-number stretch before comparing.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, eased, pressPulse } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

// The real aircraft, the one number the scale comes from.
export const CUB_SPAN_M = 10.74;

// ── THE TRIM ─────────────────────────────────────────────────────────────────
// A Cub inside is the yellow fabric lit through from outside, the steel tube frame it is sewn over,
// brown leatherette below the glass, plywood floorboards, and a black panel with cream dials.
export const CUB_TRIM = {
  yellow: [236, 186, 38], yellowDk: [198, 150, 28],
  fabric: [132, 108, 66], fabricDk: [112, 90, 54],   // the lining under the doped skin, not the yellow itself
  lining: [96, 72, 48], liningDk: [76, 56, 36],
  ply: [92, 72, 50], plyDk: [80, 62, 42],             // oiled, scuffed floorboards
  tube: [96, 106, 84],                       // zinc-chromate tube, as the frame is painted
  panel: [30, 28, 26], panelEdge: [52, 48, 44],
  cream: [226, 214, 184], ink: [22, 20, 18],
  seat: [104, 80, 54], seatDk: [80, 60, 40], webbing: [150, 132, 92],
  chrome: [196, 200, 206], knob: [16, 16, 18], redKnob: [176, 34, 28],
  cork: [176, 136, 86], bulb: [255, 226, 160], rubber: [24, 24, 26], grip: [34, 30, 28],
};
const T = CUB_TRIM;
SHINY.set(T.chrome, { spec: 0.8, pow: 22, ramp: [[70, 72, 78], [236, 238, 242]], glint: 0.3, albedo: [236, 238, 242], envK: 0.8 });
SHINY.set(T.tube, { spec: 0.18, pow: 10 });
SHINY.set(T.panel, { spec: 0.22, pow: 30 });
SHINY.set(T.knob, { spec: 0.45, pow: 40 });
SHINY.set(T.redKnob, { spec: 0.45, pow: 40 });
SHINY.set(T.yellow, { spec: 0.25, pow: 18 });
// The crescent of window light on each dial's glass.
const DIAL_GLINT = [255, 252, 240];
PANE.set(DIAL_GLINT, 0.2);
// What each surface is made of, for the GL pass's per-pixel texture. ⚠ Keyed on array IDENTITY, so
// every material here is its own array; dial faces, the lamp and the glass are left unregistered.
for (const k of ['fabric', 'fabricDk', 'webbing']) TEXTURE.set(T[k], 'fabric');         // doped fabric, belt webbing
for (const k of ['lining', 'liningDk', 'seat', 'seatDk']) TEXTURE.set(T[k], 'leather'); // leatherette
for (const k of ['ply', 'plyDk', 'cork']) TEXTURE.set(T[k], 'wood');                     // floorboards
for (const k of ['tube', 'panel', 'panelEdge', 'yellow', 'yellowDk']) TEXTURE.set(T[k], 'paint');
TEXTURE.set(T.chrome, 'brushed');
TEXTURE.set(T.knob, 'plastic'); TEXTURE.set(T.redKnob, 'plastic');
TEXTURE.set(T.rubber, 'rubber'); TEXTURE.set(T.grip, 'rubber');

// ── THE LOFT, AS A SURFACE ───────────────────────────────────────────────────
// emitLoft's `super` ring, evaluated at any (f, a) rather than only at its own ring corners, with
// the crown multiplied by `S` (see the ⚠ at the top). `a` runs from the right flank up over the crown.
function loftSurface(p, S, aTop = Math.PI / 2) {
  const st = p.stations.slice().sort((x, y) => y.f - x.f);
  const E = p.exp || [1, 1, 1];
  const ex = (s) => (s.boxy != null ? 1 - s.boxy * 0.55 : null);
  const sec = (f) => {
    const mk = (s) => ({ rg: s.rg, rvT: s.rvT, rvB: s.rvB, cz: s.cz, e: ex(s) });
    if (f >= st[0].f) return mk(st[0]);
    if (f <= st[st.length - 1].f) return mk(st[st.length - 1]);
    for (let i = 0; i < st.length - 1; i++) {
      const A = st[i], B = st[i + 1];
      if (f <= A.f && f >= B.f) {
        const t = (A.f - f) / (A.f - B.f);
        const eA = ex(A), eB = ex(B);
        return { rg: lerp(A.rg, B.rg, t), rvT: lerp(A.rvT, B.rvT, t), rvB: lerp(A.rvB, B.rvB, t), cz: lerp(A.cz, B.cz, t),
          e: eA == null || eB == null ? null : lerp(eA, eB, t) };
      }
    }
    return mk(st[0]);
  };
  const pt = (f, a, inset = 0) => {
    const s = sec(f), cs = Math.cos(a), sn = Math.sin(a);
    const eg = s.e ?? E[0], et = s.e ?? E[1], eb = s.e ?? E[2];
    const g = Math.sign(cs) * Math.pow(Math.abs(cs), eg) * s.rg;
    // ⚠ THE STRETCH IS SPENT ON THE SIDE GLASS, NOT ON THE WHOLE CROWN. Everything from the sill up to
    // the glass's top edge (`aTop`) is scaled; the fabric band above it and the skylight keep the
    // exterior's own height. Scaled uniformly, that band grew into a ceiling slab across both views and
    // the glass stopped at the eye — the opposite of a Cub, whose side glass runs up to the wing root.
    let h;
    if (sn >= 0) {
      const raw = Math.pow(sn, et) * s.rvT, gT = Math.pow(Math.sin(aTop), et) * s.rvT;
      h = raw <= gT ? raw * S : gT * S + (raw - gT);
    } else h = -Math.pow(-sn, eb) * s.rvB;
    const L = Math.hypot(g, h) || 1;
    return [f, g - (g / L) * inset, s.cz + h - (h / L) * inset];
  };
  return { st, sec, pt };
}

const findPart = (parts, name) => {
  for (const p of parts || []) {
    if (p.name === name) return p;
    const q = findPart(p.parts, name);
    if (q) return q;
  }
  return null;
};

// ── 2-D CLIPPING IN (f, a) ───────────────────────────────────────────────────
// interior-drake.js's clipper: a window is a rectangle in the loft's parameters, so every wall cell
// that touches it is cut along the region's own edge.
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function subtractConvex(cell, hole) {
  const pieces = [];
  let rest = cell;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const out = clipHalf(rest, (p) => -side(p));
    if (out.length >= 3 && Math.abs(area2(out)) > 1e-12) pieces.push(out);
    rest = clipHalf(rest, side);
  }
  return pieces;
}
const bbox2 = (P) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of P) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return [a, b, c, d];
};
const overlap = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];

// The loft's glass, as (f, a) rectangles: each region names the bays it glazes by the station they
// start at, and the ring sides `k` round the section. ⚠ AT FULL DETAIL — the minDetail stations are
// in, which is what the exterior draws up close and what you are always looking at from in here.
// Contiguous sides are merged into one run, so a band of glass is one hole rather than six.
export function glassHoles(loft) {
  const fs = loft.stations.map((s) => s.f).sort((x, y) => y - x);
  const n = loft.sides, da = TAU / n, holes = [];
  for (const rg of loft.regions || []) {
    if (rg.role !== 'glass') continue;
    const ks = (rg.k === 'all' || rg.k == null) ? Array.from({ length: n }, (_, i) => i) : rg.k.slice().sort((x, y) => x - y);
    const runs = [];
    for (const k of ks) { const r = runs[runs.length - 1]; if (r && r[1] === k - 1) r[1] = k; else runs.push([k, k]); }
    for (const f0 of rg.at) {
      const i = fs.indexOf(f0);
      if (i < 0 || i >= fs.length - 1) continue;
      const f1 = fs[i + 1];
      for (const [k0, k1] of runs) holes.push({ f: [f1, f0], a: [k0 * da, (k1 + 1) * da] });
    }
  }
  return holes;
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function grasshopperProfile(doc = MESH_ROWS.grasshopper) {
  if (!doc) return null;
  const loft = findPart(doc.parts, 'fuselage'), wing = findPart(doc.parts, 'wing');
  if (!loft || !wing) return null;
  // The scale: the span (see the ⚠ at the top).
  const M = CUB_SPAN_M / (2 * wing.span);
  // The crown: the underside of the wing at its root, off the compiled wing faces, over the loft's
  // own crown at the rear-seat station.
  const { faces: ext } = compileMesh(doc);
  let gRoot = Infinity;
  for (const f of ext) if (f.role === 'wing') for (const q of f.p) gRoot = Math.min(gRoot, Math.abs(q[1]));
  let CROWN = Infinity;
  for (const f of ext) if (f.role === 'wing') for (const q of f.p) if (Math.abs(Math.abs(q[1]) - gRoot) < 1e-6) CROWN = Math.min(CROWN, q[2]);
  const holes = glassHoles(loft);
  // The side glass's top edge, as an angle round the section: the run that starts at the sill.
  const aTop = Math.min(...holes.filter((h) => h.a[0] === 0 && h.a[1] < Math.PI / 2).map((h) => h.a[1]));
  const H0 = loftSurface(loft, 1);
  const fE = 0.06;                                         // the rear pilot's eye, a hand aft of the wing's spar line
  const s0 = H0.sec(fE);
  const gT0 = Math.pow(Math.sin(aTop), s0.e) * s0.rvT;
  const S = (CROWN - s0.cz - (s0.rvT - gT0)) / gT0;
  const H = loftSurface(loft, S, aTop);
  // ── a person, in metres ──
  const FLOOR_H = -0.036;                                  // the floorboards, a little above the loft's keel
  const EYE_OVER_FLOOR = 0.84;                             // a sling seat 12 cm up and a seated eye 72 cm over it
  const hE = FLOOR_H + EYE_OVER_FLOOR / M;
  const X = (g) => g * M, Y = (f) => (f - fE) * M, Z = (h) => (h - hE) * M;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const WING_SPARS = [wing.leR - (wing.leR - wing.teR) * 0.25, wing.leR - (wing.leR - wing.teR) * 0.66];
  const room = buildRoom({ H, M, X, Y, Z, toShell, holes, loft, zFloor: Z(FLOOR_H), WING_SPARS });
  // THE GLASS: one pane per exterior glass facet, each the bay's own (f, a) rectangle laid on the
  // inner wall, so it sits in the aperture plane outboard of the tube frame. Not part of the room.
  const da = TAU / loft.sides, glass = [];
  for (const h of holes) for (let a = h.a[0]; a < h.a[1] - 1e-9; a += da) {
    const q = [[h.f[0], a], [h.f[1], a], [h.f[1], a + da], [h.f[0], a + da]].map(([f, aa]) => toShell(H.pt(f, aa, room.inset)));
    glass.push(q);
  }

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  // The bounds hold the glass too: the skylight's crown is the highest point in the cabin.
  for (const f of [...room.faces, ...glass.map((p) => ({ p }))]) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const halfW = Math.max(-x0, x1) + 1e-6;
  // The side-window rays: aimed through the middle of the side glass, carried out to the bound.
  const side = holes.find((h) => h.a[0] === 0 && h.f[0] <= fE && h.f[1] >= fE) || holes[0];
  const cS = toShell(H.pt((side.f[0] + side.f[1]) / 2, (side.a[0] + side.a[1]) / 2, room.inset));
  const t = halfW / cS[0], wy = cS[1] * t, wz = cS[2] * t;
  // The sill, carried out to the bound on the same ray-plane, so `winZ[0]` IS the bottom of the
  // glass and a door-card ray aimed under it lands on the lining.
  const sl = toShell(H.pt((side.f[0] + side.f[1]) / 2, side.a[0], room.inset));
  const sillZ = sl[2] * (halfW / sl[0]);
  const sky = holes.filter((h) => h.a[0] < Math.PI / 2 && h.a[1] > Math.PI / 2 && h.a[0] > 0.01);
  const skyF = sky.length ? [Math.min(...sky.map((h) => h.f[0])), Math.max(...sky.map((h) => h.f[1]))] : [fE, fE];
  const L = room.layout;
  return {
    label: 'Piper Cub, rear seat',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    dashY: L.panelY, dashZ: L.panelTop, headerZ: z1 - 0.05, pillarW: 0.03,
    winY: [wy - 0.08, wy + 0.08], winZ: [sillZ, 2 * wz - sillZ],
    seatZ: L.seatZ, seatHalf: 0.21, seatY: [-0.40, 0.06], backZ: L.backZ,
    seats: 1, centrePost: 0,
    roofGlass: [Y(skyF[0]), Y(skyF[1])],
    fit: 'grasshopper', craft: 'grasshopper',
    normalLit: true,
    // A post lamp each side of the panel and the rear map lamp on the left longeron.
    floods: [{ p: [-0.20, L.panelY - 0.12, L.panelTop + 0.02], r: 0.40 }, { p: [0.20, L.panelY - 0.12, L.panelTop + 0.02], r: 0.40 },
      { p: L.mapLamp, r: 0.45 }],
    room: cubShell,
    glass,
    cub: { M, S, CROWN, fE, hE, X, Y, Z, H, holes, faces: room.faces, L, loft },
    hotspots(live) { return grasshopperHotspots(this, live); },
  };
}

// ── THE ROOM (built once; it moves with nothing) ─────────────────────────────
function buildRoom({ H, M, X, Y, Z, toShell, holes, loft, zFloor, WING_SPARS }) {
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis });
  const inset = 0.022 / M;                                 // fabric and tube: two centimetres of wall
  const fB = -0.22, fF = 0.52;                             // the baggage bulkhead, the firewall
  const NF = 44, NA = 72, a0 = -Math.PI / 2;
  const fAt = (i) => lerp(fB, fF, i / NF), aAt = (j) => a0 + (j / NA) * TAU;
  const P3 = (f, a) => toShell(H.pt(f, a, inset));
  const inward = (f, a) => {
    const d = 1e-4;
    const dF = sub(P3(f + d, a), P3(f - d, a)), dA = sub(P3(f, a + d), P3(f, a - d));
    let n = norm(cross(dF, dA));
    const s = H.sec(f), c = toShell([f, 0, s.cz]);
    if (dot(n, sub(c, P3(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const rims = holes.map((h) => {
    const r = [[h.f[0], h.a[0]], [h.f[1], h.a[0]], [h.f[1], h.a[1]], [h.f[0], h.a[1]]];
    if (area2(r) < 0) r.reverse();
    return { r, bb: bbox2(r) };
  });
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zFloor);

  // ── THE WALLS: leatherette below the glass, yellow fabric lit through above it ──
  for (let i = 0; i < NF; i++) for (let j = 0; j < NA; j++) {
    const f0 = fAt(i), f1 = fAt(i + 1), a1 = aAt(j), a2 = aAt(j + 1);
    let pieces = [[[f0, a1], [f1, a1], [f1, a2], [f0, a2]]];
    for (const h of rims) {
      const nx = [];
      for (const pc of pieces) { if (!overlap(bbox2(pc), h.bb)) nx.push(pc); else nx.push(...subtractConvex(pc, h.r)); }
      pieces = nx;
    }
    for (const pc of pieces) {
      const poly = aboveFloor(pc.map(([f, a]) => P3(f, a)));
      if (poly.length < 3) continue;
      const cf = pc.reduce((s, v) => s + v[0], 0) / pc.length, ca = pc.reduce((s, v) => s + v[1], 0) / pc.length;
      const n = inward(cf, ca), up = Math.sin(ca);
      const odd = (i + (j >> 1)) & 1;
      // ⚠ THE LINING IS PLEATED, and a whole cell is a pleat: a ridge down its middle, each flank
      // lit by which way it turns, so the leatherette reads as tuck-and-roll rather than as paint.
      // A cell the clipper cut (at the floor or an opening) lies flat, so it meets the edge flush.
      if (up < 0.02 && poly.length === 4 && pc.length === 4) {
        const r0 = add(mul(add(poly[0], poly[3]), 0.5), mul(n, 0.009)), r1 = add(mul(add(poly[1], poly[2]), 0.5), mul(n, 0.009));
        for (const q of [[poly[0], poly[1], r1, r0], [r0, r1, poly[2], poly[3]]]) {
          let fn = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
          if (dot(fn, n) < 0) fn = mul(fn, -1);
          put(q, fn, 'pil', -0.30 + fn[2] * 0.6 + 0.08, odd ? T.lining : T.liningDk);
        }
      } else if (up < 0.02) put(poly, n, 'pil', odd ? -0.10 : -0.16, odd ? T.lining : T.liningDk);
      // Doped fabric above the glass: ONE colour, textured, lit a little through from outside. It was
      // two tones in a checker, which read from the seat as a chessboard for a ceiling.
      // A rib every sixth cell: the fabric is laced to formers and shows where it is pulled down.
      else put(poly, n, 'hdr', -0.05, i % 6 === 0 ? T.fabricDk : T.fabric, 0.02);
    }
  }

  // ── THE FLOOR: plywood boards, run under the walls ──
  const floorHalf = (f) => {
    let lo = -Math.PI / 2, hi = 0;
    if (P3(f, lo)[2] > zFloor) return 0;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (P3(f, mid)[2] < zFloor) lo = mid; else hi = mid; }
    return P3(f, lo)[0];
  };
  for (let i = 0; i < NF; i++) {
    const w0 = floorHalf(fAt(i)) + 0.01, w1 = floorHalf(fAt(i + 1)) + 0.01;
    const ya = Y(fAt(i)), yb = Y(fAt(i + 1));
    // Three boards across, with the gap between them a darker line.
    for (const [u0, u1, c] of [[-1, -0.34, T.ply], [-0.34, 0.34, T.plyDk], [0.34, 1, T.ply]]) {
      put([[w0 * u0, ya, zFloor], [w0 * u1, ya, zFloor], [w1 * u1, yb, zFloor], [w1 * u0, yb, zFloor]], [0, 0, 1], 'floor', -0.15, c);
    }
  }

  // ── THE ENDS ──
  const ring = (f, aFrom, aTo, NS = 48) => { const pts = []; for (let k = 0; k <= NS; k++) pts.push(P3(f, aFrom + (aTo - aFrom) * (k / NS))); return pts; };
  // The baggage bulkhead behind you: the whole section.
  const bulk = aboveFloor(ring(fB, a0, a0 + TAU).slice(0, -1));
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.14, T.lining);
  // The firewall: below the windscreen's base only, the upper half is the glass.
  const fw = aboveFloor(ring(fF, Math.PI, TAU));
  if (fw.length >= 3) put(fw, [0, -1, 0], 'post', -0.28, T.liningDk);

  // ── THE COWL DECK outside the windscreen: the loft's own skin, yellow, as far as the nose ──
  const fN = 0.66;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 20; j++) {
    const fa = lerp(fF, fN, i / 8), fb = lerp(fF, fN, (i + 1) / 8);
    const aa = lerp(0.12, Math.PI - 0.12, j / 20), ab = lerp(0.12, Math.PI - 0.12, (j + 1) / 20);
    const q = [toShell(H.pt(fa, aa)), toShell(H.pt(fb, aa)), toShell(H.pt(fb, ab)), toShell(H.pt(fa, ab))];
    const n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    put(q, n[2] < 0 ? mul(n, -1) : n, 'dash', 0.3, j === 9 || j === 10 ? T.yellowDk : T.yellow);
  }
  // The tank cap on the centreline, where the float wire comes out.
  const capC = toShell(H.pt(0.60, Math.PI / 2));
  for (let k = 0; k < 10; k++) {
    const t0 = (k / 10) * TAU, t1 = ((k + 1) / 10) * TAU, r = 0.035;
    put([[capC[0], capC[1], capC[2] + 0.008], add(capC, [Math.cos(t0) * r, Math.sin(t0) * r, 0.006]), add(capC, [Math.cos(t1) * r, Math.sin(t1) * r, 0.006])], [0, 0, 1], 'dash', 0.3, T.chrome);
  }

  // ── THE TUBE FRAME: the steel the fabric is sewn over, along the edges of every opening ──
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const TR = 0.011, TI = inset + TR / M;          // the tube lies against the inside of the fabric
  const PT = (f, a) => toShell(H.pt(f, a, TI));
  const tubeF = (a, fa, fb, n = 10) => { for (let k = 0; k < n; k++) K.rod(PT(lerp(fa, fb, k / n), a), PT(lerp(fa, fb, (k + 1) / n), a), TR, 'post', 0.1, T.tube, 0, 5, false); };
  const tubeA = (f, aa, ab, n = 8) => { for (let k = 0; k < n; k++) K.rod(PT(f, lerp(aa, ab, k / n)), PT(f, lerp(aa, ab, (k + 1) / n)), TR, 'post', 0.1, T.tube, 0, 5, false); };
  const d30 = Math.PI / 6;
  for (const s of [0, 1]) {
    const aS = s ? Math.PI - 0 : 0, aT = s ? Math.PI - d30 : d30;
    tubeF(aT, fB + 0.01, fF - 0.005, 16);                    // the upper longeron, along the top of the side glass
    tubeF(aS + (s ? -0.02 : 0.02), fB + 0.01, fF - 0.005, 16); // the sill longeron
    const aK = s ? Math.PI - 2 * d30 : 2 * d30;
    tubeF(aK, 0.005, 0.44, 8);                                // the skylight rails
    for (const f of [0.44, 0.22, -0.20]) tubeA(f, s ? aS - 0.02 : aS + 0.02, aT, 3);   // the window posts
  }
  for (const f of [0.44, 0.22, 0.005]) tubeA(f, d30, Math.PI - d30, 8);   // the cross tubes over the cabin
  // THE WING ROOT: the spar carry-through fittings where the wing bolts to the cabin, one each side
  // at each spar, down the band between the side glass and the skylight. Spar stations off the wing
  // part's own chord (a quarter and two thirds back from the leading edge).
  for (const f of WING_SPARS) {
    tubeA(f, d30, 2 * d30, 3); tubeA(f, Math.PI - 2 * d30, Math.PI - d30, 3);
    for (const a of [d30 * 1.5, Math.PI - d30 * 1.5]) K.obox(PT(f, a), [0, 1, 0], [0, 0, 1], [1, 0, 0], 0.035, 0.05, 0.004, 'post', 0.1, T.tube);
  }
  // The windscreen's frame down its base, where the glass meets the cowl.
  tubeA(fF - 0.004, 0.02, Math.PI - 0.02, 12);
  // Diagonals in the lower wall under the lining, which show as ridges: one per bay each side.
  for (const s of [1, -1]) for (const [fa, fb] of [[-0.20, 0.0], [0.0, 0.22], [0.22, 0.44]]) {
    const aLo = s > 0 ? -0.55 : Math.PI + 0.55, aHi = s > 0 ? -0.03 : Math.PI + 0.03;
    const A = PT(fa, aLo), B = PT(fb, aHi);
    if (A[2] > zFloor && B[2] > zFloor) K.rod(A, B, 0.008, 'pil', -0.04, T.liningDk, 0, 4, false);
  }

  // ── THE SPLIT DOOR on the right: the lower half's seam and hinge line on the lining ──
  const dF0 = 0.08, dF1 = 0.42, dA = -0.52;
  const seam = (A, B) => K.rod(A, B, 0.004, 'pil', -0.3, T.ink, 0, 4, false);
  seam(PT(dF0, dA), PT(dF1, dA));
  for (const f of [dF0, dF1]) for (let k = 0; k < 4; k++) seam(PT(f, lerp(dA, -0.03, k / 4)), PT(f, lerp(dA, -0.03, (k + 1) / 4)));

  // ── THE BAGGAGE SHELF behind the seat ──
  const shY = Y(fB) + 0.02, shZ = zFloor + 0.30;
  const shW = floorHalf(-0.16) * 0.9 + 0.06;
  K.box(-shW, shY, shZ, shW, shY + 0.32, shZ + 0.02, 'floor', 0.05, T.plyDk);

  // Where the person-scale parts go, in metres about the eye.
  const panelF = 0.500;
  const pS = H.sec(panelF);
  const layout = {
    panelY: Y(panelF), panelTop: Z(pS.cz) - 0.02, panelHW: X(pS.rg) - 0.05,
    seatZ: zFloor + 0.12, backZ: zFloor + 0.62, zFloor,
    frontY: Y(0.27),
    mapLamp: PT(-0.02, Math.PI - d30 * 1.2),
    trim: add(PT(-0.05, Math.PI - d30 * 1.5), [0.03, 0, -0.02]),
    wallX: (y, z) => {                                       // the left wall's inner x at shell (y, z)
      const f = y / M + (Y(0) / -M);
      let lo = Math.PI / 2, hi = Math.PI * 1.5;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (P3(f, mid)[2] > z) lo = mid; else hi = mid; }
      return P3(f, lo)[0];
    },
  };
  return { faces, inset, layout };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function cubShell(P, live, push, rich) {
  const D = P.cub;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  if (rich) grasshopperFit(P, live, push);
}

// ── WHERE THE CONTROLS ARE (one table for the drawing and the hotspots) ──────
function controls(P, L) {
  const D = P.cub, Lo = D.L, zF = Lo.zFloor;
  const ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const thr = clamp(num(L.throttle), 0, 1), trim = clamp(num(L.trim), -1, 1), rud = clamp(num(L.rudder), -1, 1);
  const stick = (y, top) => {
    const base = [0, y, zF + 0.02];
    const tip = [ail * 0.075, y + 0.03 + elev * 0.08, top];
    return { base, tip };
  };
  // The rear throttle: a lever on the left wall, pivoted low, idle aft and full forward.
  const tpY = 0.30, tpZ = -0.60, tpX = Lo.wallX(tpY, tpZ) + 0.05;
  const ta = (-0.55 + thr * 1.1);
  const tKnob = [tpX, tpY + Math.sin(ta) * 0.16, tpZ + Math.cos(ta) * 0.16];
  // The front throttle: a knob on a push rod through the left wall at the front seat, linked.
  const ftY = Lo.frontY + 0.10 + thr * 0.10, ftZ = -0.62;
  const ftX = Lo.wallX(Lo.frontY + 0.15, ftZ) + 0.02;
  return {
    ail, elev, thr, trim, rud,
    rear: stick(0.44, -0.36), front: stick(Lo.frontY + 0.42, -0.66),   // the J-3's short front stick: grip under the tach from the back seat
    tPivot: [tpX, tpY, tpZ], tKnob, ftKnob: [ftX + 0.05, ftY, ftZ], ftBase: [ftX, Lo.frontY + 0.10, ftZ],
    trimC: Lo.trim, trimA: trim * TAU * 1.25,
  };
}

// Panel coordinates, in metres on the panel face: `u` across, `v` up from its centre.
const PANEL = { v0: -0.105, v1: 0.0, row: -0.052 };
const DIALS = { asi: [-0.175, -0.052, 0.040], tach: [0, -0.050, 0.048], alt: [0.175, -0.052, 0.040],
  oil: [-0.085, -0.128, 0.026], comp: [0, 0.035, 0.030], mag: [-0.215, -0.150], primer: [0.215, -0.150],
  carb: [0.085, -0.140], light: [0.140, -0.150] };

export function grasshopperHotspots(P, live) {
  const L = live || {}, Q = controls(P, L), Lo = P.cub.L;
  const Pn = makeKit(() => {}).panel([0, Lo.panelY, Lo.panelTop], [1, 0, 0], [0, 0, 1]);
  return [
    { id: 'ck:master', p: Pn.pt(DIALS.mag[0], DIALS.mag[1], 0.02), r: 0.03, kind: 'click' },
    { id: 'ck:nav', p: Pn.pt(DIALS.light[0], DIALS.light[1], 0.02), r: 0.02, kind: 'click' },
    { id: 'ck:dome', p: Lo.mapLamp, r: 0.04, kind: 'click' },
    { id: 'yoke', p: add(Q.rear.tip, [0, 0.01, 0.06]), r: 0.08, kind: 'yoke' },
    { id: 'throttle', p: Q.tKnob, r: 0.04, kind: 'throttle' },
    { id: 'trim', p: Q.trimC, r: 0.05, kind: 'trim' },
  ];
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function grasshopperFit(P, live, push) {
  const K = makeKit(push), L = live || {}, D = P.cub, Lo = D.L, zF = Lo.zFloor;
  const Q = controls(P, L);
  const powered = L.powered !== false;
  const hour = num(L.hour, 12), night = clamp(Math.max(0, Math.cos(((hour - 0) / 24) * TAU)) * 1.4 - 0.2, 0, 1);
  const lumi = 0.12 + night * 0.35;                          // radium paint on the numerals

  // ── THE PANEL: a black board across the section under the windscreen, five cream dials ──
  const Pn = K.panel([0, Lo.panelY, Lo.panelTop], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
  const hw = Lo.panelHW;
  Pn.plate([[-hw, -0.20], [hw, -0.20], [hw, 0.012], [-hw, 0.012]], T.panel, 0, 0.0005);
  Pn.rect(-hw, 0.004, hw, 0.016, T.panelEdge, 0, 0.001);          // the lip under the screen
  // The coaming: a padded roll along the top edge, the one thing you rest the glare off.
  K.rod(Pn.pt(-hw, 0.014, 0.012), Pn.pt(hw, 0.014, 0.012), 0.014, 'dash', 0.15, T.seatDk, 0, 6);
  const dialO = { face: T.cream, tick: T.ink, needle: T.ink, bezel: [34, 32, 30] };
  const ias = Math.max(0, num(L.ias)), vne = Math.max(40, num(L.vne, 122));
  const [ax, ay, ar] = DIALS.asi;
  Pn.dial(ax, ay, ar, clamp(ias / (vne * 1.15), 0, 1), { ...dialO, ticks: 10, major: 2, arcs: [[0.30, 0.72, C.green], [0.72, 0.87, C.yellow]], red: 0.87, name: 'MPH' });
  const alt = Math.max(0, num(L.alt));
  const [lx, ly, lr] = DIALS.alt;
  Pn.dial(lx, ly, lr, (alt % 1000) / 1000, { ...dialO, a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, needle2: [70, 64, 58], name: 'ALT' });
  const rpm = clamp(num(L.rpm), 0, 1.05);
  const [tx, ty, tr] = DIALS.tach;
  Pn.dial(tx, ty, tr, rpm, { ...dialO, ticks: 12, major: 2, arcs: [[0.55, 0.88, C.green]], red: 0.92, name: 'RPM' });
  // The oil gauge: pressure and temperature, two needles on one face (the late J-3's combination).
  const [ox, oy, orr] = DIALS.oil;
  const oilT = clamp(num(L.oilTemp, 0.5), 0, 1), oilP = powered ? clamp(0.25 + rpm * 0.55, 0, 1) : 0;
  Pn.dial(ox, oy, orr, oilP, { ...dialO, a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 4, major: 2, frac2: oilT, needle2: C.red, name: 'OIL' });
  // The compass: a B-16 on top of the coaming, a card in a ball with a lubber line.
  const [cx0, cy0, cr] = DIALS.comp;
  Pn.stud(cx0, cy0 - 0.01, cr * 1.2, cr * 0.9, 0.03, T.knob, 0, 0.004);
  Pn.compass(cx0, cy0, cr, num(L.hdg));
  // The glints on the dial glass.
  for (const [u, v, r] of [DIALS.asi, DIALS.tach, DIALS.alt, DIALS.oil]) Pn.annulus(u, v, r * 0.78, r * 0.92, DIAL_GLINT, 0.4, 0.011, 6, Math.PI * 0.55, Math.PI * 0.95);
  // Radium on the numerals: small lit dots at the major ticks, glowing more as it gets dark.
  for (const [u, v, r, n] of [[...DIALS.asi, 5], [...DIALS.tach, 6], [...DIALS.alt, 10]]) {
    for (let i = 0; i <= n; i++) {
      const tt = (DIALS.alt[0] === u ? Math.PI / 2 - (i / n) * TAU : Math.PI * 1.25 - (i / n) * Math.PI * 1.5);
      Pn.disc(u + Math.cos(tt) * r * 0.55, v + Math.sin(tt) * r * 0.55, r * 0.05, [150, 240, 170], lumi, 0.006, 5);
    }
  }
  // The magneto key: OFF L R BOTH, at BOTH while the engine runs.
  const [mx, my] = DIALS.mag;
  const magOn = eased('cub:mag', powered ? 1 : 0, 14) - pressPulse('cub:mag', powered) * 0.15;
  Pn.annulus(mx, my, 0.016, 0.024, T.chrome, 0.1, 0.002, 14);
  Pn.disc(mx, my, 0.016, T.knob, 0, 0.002, 12);
  Pn.spoke(mx, my, Math.PI / 2 - magOn * 1.2, -0.004, 0.014, 0.004, T.chrome, 0.1, 0.02);
  Pn.text('MAG', mx, my - 0.036, 0.0085);
  for (let i = 0; i < 4; i++) Pn.disc(mx + Math.cos(Math.PI / 2 - i * 0.4) * 0.03, my + Math.sin(Math.PI / 2 - i * 0.4) * 0.03, 0.003, T.cream, lumi, 0.003, 5);
  // The primer: a chrome plunger. The carb heat: a knob on a push-pull cable. The panel light.
  Pn.knob(DIALS.primer[0], DIALS.primer[1], 0.009, 0.02, T.chrome, 0.1);
  Pn.knob(DIALS.carb[0], DIALS.carb[1], 0.011, 0.018, T.redKnob, 0.05);
  Pn.text('PRIME', DIALS.primer[0], DIALS.primer[1] - 0.022, 0.0085);
  Pn.text('CARB', DIALS.carb[0], DIALS.carb[1] - 0.022, 0.0085);
  const navOn = !!(powered && L.landingLight);
  Pn.toggle(DIALS.light[0], DIALS.light[1], navOn, 'LAND');
  // A placard: the type's single limit, painted.
  Pn.rect(-0.05, -0.185, 0.05, -0.172, T.cream, lumi * 0.5, 0.002);
  Pn.fitText('VNE 122 MPH', 0, -0.1785, 0.094, 0.009, T.ink, 0.1, 0.003);

  // ── THE FUEL GAUGE: a wire on a cork float out of the tank cap, ahead of the glass ──
  const fuel = clamp(num(L.fuel, 1) > 1 ? num(L.fuel) / 100 : num(L.fuel, 1), 0, 1);
  const cap = [0, D.Y(0.60), D.Z(D.H.pt(0.60, Math.PI / 2)[2])];
  const wTop = [cap[0], cap[1], cap[2] + 0.012 + fuel * 0.045];   // ⚠ full stops a hand under your eye line: the ray ahead must stay clear
  K.rod([cap[0], cap[1], cap[2] + 0.006], wTop, 0.0025, 'dash', 0.1, T.chrome, 0, 4);
  K.rod(wTop, add(wTop, [0, 0, 0.004]), 0.012, 'dash', 0.3, T.cork, 0, 6);   // the little knob on top

  // ── THE STICKS: yours, and the front one moving with it ──
  for (const [s, which] of [[Q.rear, 'rear'], [Q.front, 'front']]) {
    const { base, tip } = s;
    K.obox([base[0], base[1], zF + 0.03], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.045, 0.045, 0.03, 'dash', 0, T.rubber);   // the boot
    contactShadow(K, [base[0], base[1], zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.07);
    K.rod(base, tip, 0.011, 'dash', 0.05, T.tube, 0, 6);
    const grip = add(tip, [0, 0.008, 0.10]);
    K.rod(tip, grip, 0.018, 'dash', 0.05, which === 'rear' ? T.rubber : T.grip, 0, 8);
    K.rod(grip, add(grip, [0, 0, 0.008]), 0.020, 'dash', 0.2, T.knob, 0, 8);
  }

  // ── THE RUDDER PEDALS: yours either side of the front seat, with heel brakes; the front pair ──
  const rud = Q.rud;
  for (const s of [-1, 1]) {
    const press = clamp(s * rud, 0, 1);
    const pv = [s * 0.20, 0.98, zF + 0.24];
    pedal(K, pv, 0.035, 0.18, press, T.tube);
    // The heel brake: a small pad hinged at the floor behind the pedal.
    K.obox([s * 0.20, 0.86, zF + 0.035], [1, 0, 0], [0, 0.6, 0.8], norm([0, -0.8, 0.6]), 0.028, 0.02, 0.006, 'dash', 0.1, T.rubber);
    contactShadow(K, [s * 0.20, 0.90, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.08);
    pedal(K, [s * 0.14, Lo.panelY - 0.20, zF + 0.26], 0.03, 0.18, press, T.tube);
  }
  // The cross tube that links the pairs, under the front seat.
  K.rod([-0.20, 0.98, zF + 0.24], [0.20, 0.98, zF + 0.24], 0.009, 'dash', 0, T.tube, 0, 5);

  // ── THE FRONT SEAT: a tube frame and a canvas sling, well under your eye line ──
  // ⚠ THE BACK IS LOW, a J-3 sling back to the shoulder blades: tall, it hid the whole panel from
  // the rear seat (its top subtended -20° against the panel's -17° to -22°); at FB_TOP it is -31°.
  const fy = Lo.frontY, fz = zF + 0.20, fh = 0.17, FB_TOP = -0.48;
  for (const x of [-fh, fh]) {
    K.rod([x, fy + 0.30, zF + 0.01], [x, fy + 0.30, fz], 0.010, 'dash', 0.05, T.tube, 0, 5);
    K.rod([x, fy - 0.08, zF + 0.01], [x, fy - 0.08, fz], 0.010, 'dash', 0.05, T.tube, 0, 5);
    K.rod([x, fy - 0.08, fz], [x, fy - 0.14, FB_TOP], 0.010, 'dash', 0.05, T.tube, 0, 5);
  }
  K.box(-fh, fy - 0.08, fz - 0.02, fh, fy + 0.30, fz + 0.03, 'seat', 0.05, T.seat);
  K.obox([0, fy - 0.11, (fz + FB_TOP) / 2], [1, 0, 0], norm([0, -0.06, (FB_TOP - fz)]), norm([0, 1, 0.3]), fh, Math.hypot(0.06, FB_TOP - fz) / 2, 0.018, 'seat', -0.05, T.seatDk);
  contactShadow(K, [0, fy + 0.11, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], fh + 0.04, 0.22);

  // ── YOUR SEAT: a sling on a tube frame, a squab, a back, and a lap belt ──
  const sz = Lo.seatZ, sh = P.seatHalf, [sy0, sy1] = P.seatY;
  K.box(-sh, sy0, sz - 0.07, sh, sy1, sz, 'seat', 0.06, T.seat);
  for (const x of [-sh, sh]) K.box(x - Math.sign(x) * 0.04, sy0, sz, x, sy1, sz + 0.04, 'seat', 0.1, T.seatDk);   // the rolled edges
  for (let i = 0; i < 4; i++) K.box(-sh + 0.05, lerp(sy0, sy1, i / 4) + 0.005, sz, sh - 0.05, lerp(sy0, sy1, i / 4) + 0.012, sz + 0.004, 'seat', -0.1, T.seatDk);   // stitching
  const back = norm([0, -0.28, 1]);
  K.obox(add([0, sy0 - 0.04, (sz + Lo.backZ) / 2], mul(back, 0)), [1, 0, 0], back, norm(cross([1, 0, 0], back)), sh, (Lo.backZ - sz) / 2, 0.035, 'seat', -0.06, T.seat);
  for (const x of [-sh + 0.01, sh - 0.01]) K.rod([x, sy1, zF + 0.005], [x, sy1, sz - 0.07], 0.01, 'dash', 0, T.tube, 0, 5);
  contactShadow(K, [0, (sy0 + sy1) / 2, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], sh + 0.05, 0.28);
  // The lap belt: two webbing straps meeting at a chrome buckle over your lap.
  const bk = [0, sy1 - 0.06, sz + 0.14];
  for (const s of [-1, 1]) K.rod([s * (sh - 0.02), sy0 + 0.02, sz + 0.03], bk, 0.013, 'seat', 0, T.webbing, 0, 4);
  K.obox(bk, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.028, 0.02, 0.006, 'dash', 0.3, T.chrome, 0.05);

  // ── THE REAR THROTTLE: a lever in a slotted quadrant on the left wall ──
  const [px, py, pz] = Q.tPivot;
  K.obox([px - 0.03, py + 0.02, pz + 0.07], [0, 1, 0], [0, 0, 1], [1, 0, 0], 0.12, 0.10, 0.006, 'pil', 0.1, T.panel);
  K.rod(Q.tPivot, Q.tKnob, 0.007, 'dash', 0.1, T.chrome, 0.05, 5);
  K.rod(Q.tKnob, add(Q.tKnob, [0.03, 0, 0]), 0.02, 'dash', 0.2, T.knob, 0, 8);
  // The front throttle: a knob on its push rod out of the wall, sliding with the rear one.
  K.rod(Q.ftBase, Q.ftKnob, 0.005, 'dash', 0.1, T.chrome, 0, 5);
  K.rod(Q.ftKnob, add(Q.ftKnob, [0.018, 0, 0]), 0.017, 'dash', 0.2, T.knob, 0, 8);
  // The pushrod linking them, down the wall.
  K.rod(add(Q.tPivot, [0.005, 0, -0.03]), add(Q.ftBase, [0.005, 0, -0.03]), 0.004, 'pil', 0, T.tube, 0, 4);

  // ── THE TRIM CRANK, overhead on the left: a handle you wind ──
  const tc = Q.trimC;
  const cu = [0, 1, 0], cv = norm([0.4, 0, -1]);
  K.obox(tc, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.025, 0.035, 0.02, 'hdr', 0.1, T.panel);
  const hub = add(tc, mul(cv, 0.03));
  const arm = add(hub, add(mul(cu, Math.cos(Q.trimA) * 0.05), mul(cross(cu, cv), Math.sin(Q.trimA) * 0.05)));
  K.rod(hub, arm, 0.006, 'dash', 0.2, T.chrome, 0, 5);
  K.rod(arm, add(arm, mul(cv, 0.035)), 0.009, 'dash', 0.2, T.knob, 0, 6);

  // ── THE MAP LAMP on the left longeron, lit by the dome switch ──
  const domeOn = !!L.dome;
  const ml = Lo.mapLamp, dLamp = eased('cub:dome', domeOn ? 1 : 0, 20);
  K.rod(ml, add(ml, [0.03, -0.02, -0.02]), 0.018, 'hdr', 0.1, T.knob, 0, 8);
  K.rod(add(ml, [0.03, -0.02, -0.02]), add(ml, [0.034, -0.023, -0.023]), 0.013, 'dash', 0.3, domeOn ? T.bulb : [70, 64, 52], dLamp, 8);

  // ── THE DOOR HANDLE on the right, at the lower half's latch ──
  const hdY = D.Y(0.40) - 0.02, hdZ = -0.55;
  const hdX = -Lo.wallX(hdY, hdZ) - 0.02;
  K.rod([hdX, hdY, hdZ], [hdX - 0.035, hdY, hdZ], 0.006, 'pil', 0.2, T.chrome, 0, 5);
  K.rod([hdX - 0.035, hdY, hdZ], [hdX - 0.035, hdY - 0.07, hdZ], 0.007, 'pil', 0.2, T.chrome, 0, 5);

  hotspotHalo(K, grasshopperHotspots(P, L), L);
}
