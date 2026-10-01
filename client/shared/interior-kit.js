// THE FITTINGS INSIDE A SEAT, AS GEOMETRY.
//
// `interior-shell.js` builds the ROOM — floor, roof, bulkhead, doors, pillars, the dash slab. This
// file builds what is IN it: the dials, the wheel, the levers, the pedals, the mirrors, the switch
// banks and the clutter. It exists because the room alone left every seat but the boat half 3-D:
// the walls were geometry and the dashboard was still a painting laid over the front of them, so a
// turned head saw a room and a forward head saw a picture of a different room, and the two met
// with gaps between them.
//
// ── ⚠ ONE VOCABULARY, EVERY SEAT ─────────────────────────────────────────────
//
// A truck, a light twin, a helicopter and a race boat are built out of the SAME primitives here —
// a panel you can put a dial on, a rod, an oriented box — and that is the whole of what "parity in
// detail" means mechanically. A dial on the plane's panel and a dial in the truck's binnacle are
// one function with different numbers, so neither seat can quietly end up with the better gauge.
//
// ── ⚠ METRES ABOUT THE EYE, EXACTLY LIKE THE ROOM ────────────────────────────
//
// +x right, +y forward, +z up, origin at the eye. See the top of interior-shell.js for why an
// interior is authored in metres from the eye and never in tiles.
//
// ── ⚠ EVERY FACE STATES ITS NORMAL ───────────────────────────────────────────
//
// `gl/solids.js` draws both sides and the mirror pass flips windings, so a normal recovered from
// the corner order is a normal that lies in the reflection. Every primitive below knows which way
// each of its faces points and says so.
//
// ── ⚠ PURE ──────────────────────────────────────────────────────────────────
//
// No clock, no camera, no DOM. `live` values arrive as arguments and become vertex positions (a
// needle's angle IS where its tip is), so the gate can drive a control to both stops headlessly.

// ── VECTORS ──────────────────────────────────────────────────────────────────
import { kitMemo, memoCall, setKeyedColourTest } from './interior-memo.js';
import { legend, legendWidth } from './legend-font.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const neg = (a) => [-a[0], -a[1], -a[2]];
// ── WHAT SHINES ──────────────────────────────────────────────────────────────
// A face's colour array, by identity, to how it answers the sun: { spec, pow }. The cabin is flat
// shaded on the CPU, so a metal is a colour that knows it is a metal. A fit-out registers its own
// (the Drake's gold, chrome and crystal); everything else stays matte, exactly as it shipped.
export const SHINY = new Map();
// A face's colour array, by identity, to an alpha: glass you look THROUGH (a night-vision filter,
// a head-up readout's backing). Drawn in its own colour, unshaded, blended over the world.
export const PANE = new Map();
// ── WHAT A SURFACE IS MADE OF ────────────────────────────────────────────────
// A face's colour array, by identity, to a surface texture the GL solids pass draws per pixel in
// the cockpit's own frame (gl/solids.js): the grain of moulded plastic, the weave of a seat, the
// streaks of brushed steel. One of TEX_KINDS. A face may also say it outright (`mat.tex`), and a
// face that says nothing takes its tone's default (TONE_TEX) — so every cockpit gets a textured
// dash and headliner with nothing registered, and a fit-out only has to name its exceptions.
// ⚠ THE INDEX IS WHAT THE SHADER READS, so the list is APPENDED to, never reordered.
export const TEX_KINDS = ['none', 'plastic', 'fabric', 'leather', 'rubber', 'brushed', 'cast', 'paint', 'wood', 'carpet', 'glass'];
export const TEXTURE = new Map();
setKeyedColourTest((a) => SHINY.has(a) || PANE.has(a) || TEXTURE.has(a));
export const TONE_TEX = { floor: 'carpet', hdr: 'fabric', seat: 'fabric', dash: 'plastic', pil: 'plastic', post: 'plastic' };
export const texIndex = (name) => { const i = TEX_KINDS.indexOf(name); return i < 0 ? 0 : i; };
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

// ── COLOURS ──────────────────────────────────────────────────────────────────
//
// ⚠ ONLY THE THINGS A COLOURWAY HAS NO WORD FOR. A panel, a pillar and a seat take the colourway's
// own keys through `tone` (see the NO COLOUR IS AUTHORED note in interior-shell.js); these are the
// objects that are the same colour in every truck ever built — a lit segment, a red redline, a
// yellow park-brake knob, black rubber, brushed steel, the white of a dial's numerals.
export const C = {
  lampOn: [232, 246, 255], red: [255, 86, 72], amber: [255, 176, 64], green: [110, 236, 160],
  blue: [90, 150, 255], lampOff: [26, 30, 36],
  face: [14, 16, 20], bezel: [70, 76, 86], chrome: [150, 158, 170], tick: [206, 212, 220],
  rubber: [20, 21, 24], black: [12, 13, 15], steel: [104, 110, 120], grip: [30, 32, 37],
  yellow: [236, 196, 40], white: [226, 228, 224], paper: [214, 206, 180], sky: [92, 126, 170],
  ground: [120, 78, 44], screen: [8, 14, 12], lcd: [120, 236, 200], mirror: [118, 138, 160],
  tan: [150, 116, 78], fireRed: [178, 30, 26], wood: [96, 62, 36], brass: [176, 142, 72],
  cloth: [46, 50, 58], leaf: [60, 170, 90],
};
// The kit's own colours that are always one material, whoever uses them.
for (const [k, t] of [['rubber', 'rubber'], ['grip', 'rubber'], ['steel', 'brushed'], ['chrome', 'brushed'], ['bezel', 'cast'], ['cloth', 'fabric'], ['wood', 'wood'], ['tan', 'leather'], ['brass', 'brushed']]) TEXTURE.set(C[k], t);

// ── THE SEVEN-SEGMENT DIGIT ──────────────────────────────────────────────────
const SEG7 = {
  0: [1, 1, 1, 1, 1, 1, 0], 1: [0, 1, 1, 0, 0, 0, 0], 2: [1, 1, 0, 1, 1, 0, 1],
  3: [1, 1, 1, 1, 0, 0, 1], 4: [0, 1, 1, 0, 0, 1, 1], 5: [1, 0, 1, 1, 0, 1, 1],
  6: [1, 0, 1, 1, 1, 1, 1], 7: [1, 1, 1, 0, 0, 0, 0], 8: [1, 1, 1, 1, 1, 1, 1],
  9: [1, 1, 1, 1, 0, 1, 1], '-': [0, 0, 0, 0, 0, 0, 1], N: [0, 0, 1, 0, 1, 0, 1],
  R: [0, 0, 0, 0, 1, 0, 1], ' ': [0, 0, 0, 0, 0, 0, 0],
};
function seg7(x, z, w, h) {
  const t = h * 0.11, mz = z + h / 2, tz2 = z + h, i = t * 0.62;
  const H = (x0, x1, zc) => [[x0, zc - t / 2], [x1, zc - t / 2], [x1 - i, zc + t / 2], [x0 + i, zc + t / 2]];
  const V = (xc, z0, z1) => [[xc - t / 2, z0], [xc + t / 2, z0], [xc + t / 2, z1 - i], [xc - t / 2, z1 - i]];
  return [
    H(x + i, x + w - i, tz2 - t / 2), V(x + w - t / 2, mz + i, tz2 - i), V(x + w - t / 2, z + i, mz - i),
    H(x + i, x + w - i, z + t / 2), V(x + t / 2, z + i, mz - i), V(x + t / 2, mz + i, tz2 - i),
    H(x + i, x + w - i, mz),
  ];
}

// ── THE KIT ──────────────────────────────────────────────────────────────────
//
// `push(faces, tone, k, fwd, rgb, emis)` is interior-shell's own collector. `fwd` marks every
// fitting as part of the forward interior — see that file — so a renderer that still has a painted
// dash up drops these with the aperture rather than drawing two dashboards.
export function makeKit(push, fwd = true) {
  // `cur` is where faces go. It is swapped for a recorder while a cached primitive is being built
  // (interior-memo.js memoCall), which is how a bezel inside a part that rebuilds is still built once.
  let cur = push;
  const face = (p, n, tone, k, rgb, emis) => cur([{ p, n }], tone || 'dash', k ?? 0.2, fwd, rgb, emis);
  const mk = kitMemo(push);
  // Wrap a pure primitive so it is cached on its arguments plus `frame` (whatever else it reads).
  // Inside a group (below) the wrappers go straight through: the group is the cached unit, and a
  // nested call taking an ordinal only on a miss would shift every ordinal after it.
  const cached = (name, fn, frame) => (mk ? (...args) => (mk.depth ? fn(...args) : memoCall(mk, name, frame, args, (rec) => {
    const was = cur; cur = rec;
    try { fn(...args); } finally { cur = was; }
  })) : fn);
  // A composite helper cached as ONE call on its own arguments: `fn(self, ...args)` must be pure in
  // them and in `frame`. For helpers made of dozens of one-face plates (wood grain, engraving), where
  // checking each plate costs as much as drawing it.
  const group = (self, frame) => (name, fn, ...args) => {
    if (!mk || mk.depth) { fn(self, ...args); return; }
    memoCall(mk, name, frame, args, (rec) => {
      const was = cur; cur = rec; mk.depth = (mk.depth || 0) + 1;
      try { fn(self, ...args); } finally { cur = was; mk.depth--; }
    });
  };

  // An oriented box: centre, three orthonormal axes, three half-extents.
  function obox(c, R, U, N, hr, hu, hn, tone, k, rgb, emis) {
    const P = (a, b, d) => add(add(add(c, mul(R, a * hr)), mul(U, b * hu)), mul(N, d * hn));
    const q = (pts, n) => face(pts, n, tone, k, rgb, emis);
    q([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], N);
    q([P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1)], neg(N));
    q([P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)], U);
    q([P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), P(-1, -1, -1)], neg(U));
    q([P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)], R);
    q([P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1)], neg(R));
  }
  // An axis-aligned box from two corners.
  function box(x0, y0, z0, x1, y1, z1, tone, k, rgb, emis) {
    obox([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1], [0, 1, 0],
      Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2, Math.abs(y1 - y0) / 2, tone, k, rgb, emis);
  }
  // A prism between two points — a column, a shaft, a stalk, a lever arm. ⚠ SIX SIDES BY DEFAULT:
  // at the size these are seen a hexagon reads as round, and every extra side is two triangles on
  // an object that is mostly a line.
  function rod(a, b, rad, tone, k, rgb, emis, sides = 6, caps = true) {
    const d = sub(b, a);
    const L = Math.hypot(d[0], d[1], d[2]);
    if (!(L > 1e-6)) return;
    const D = mul(d, 1 / L);
    const ref = Math.abs(D[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(cross(D, ref)), e2 = cross(D, e1);
    const ring = (c) => Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * TAU;
      return add(c, add(mul(e1, Math.cos(t) * rad), mul(e2, Math.sin(t) * rad)));
    });
    const A = ring(a), B = ring(b);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, t = ((i + 0.5) / sides) * TAU;
      face([A[i], A[j], B[j], B[i]], norm(add(mul(e1, Math.cos(t)), mul(e2, Math.sin(t)))), tone, k, rgb, emis);
    }
    if (caps) { face(B.slice(), D, tone, k, rgb, emis); face(A.slice().reverse(), neg(D), tone, k, rgb, emis); }
  }
  // A ring of short rods — a steering-wheel rim, a hoop, a grab handle bent round.
  function torus(c, R, U, rad, tube, n, tone, k, rgb, emis, a0 = 0, a1 = TAU) {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = a0 + (a1 - a0) * (i / n);
      const p = add(c, add(mul(R, Math.cos(t) * rad), mul(U, Math.sin(t) * rad)));
      if (prev) rod(prev, p, tube, tone, k, rgb, emis, 5, false);
      prev = p;
    }
  }

  // ── A PANEL ────────────────────────────────────────────────────────────────
  //
  // A plane in the cabin with 2-D coordinates on it: `o` its centre, `r` one metre across, `u` one
  // metre up it. Its normal is turned to face the eye, so `lift` always stands a part proud of the
  // panel TOWARD the person looking at it — which is how a needle sits in front of its dial without
  // fighting it for the depth test.
  function panel(o, r0, u0, tone = 'dash', k = 0.3) {
    const r = norm(r0), u = norm(u0);
    let n = norm(cross(r, u));
    if (dot(n, o) > 0) n = neg(n);
    const pt = (a, b, l = 0) => add(add(add(o, mul(r, a)), mul(u, b)), mul(n, l));
    const plate = (pts, rgb, emis, l = 0, tn = tone, kk = k) => face(pts.map(([a, b]) => pt(a, b, l)), n, tn, kk, rgb, emis);
    const rect = (a0, b0, a1, b1, rgb, emis, l = 0, tn, kk) => plate([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], rgb, emis, l, tn, kk);
    const disc = (ca, cb, rad, rgb, emis, l = 0, n2 = 18) =>
      plate(Array.from({ length: n2 }, (_, i) => { const t = (i / n2) * TAU; return [ca + Math.cos(t) * rad, cb + Math.sin(t) * rad]; }), rgb, emis, l);
    const annulus = (ca, cb, r0a, r1a, rgb, emis, l = 0, n2 = 20, t0 = 0, t1 = TAU) => {
      for (let i = 0; i < n2; i++) {
        const a0 = t0 + (t1 - t0) * (i / n2), a1 = t0 + (t1 - t0) * ((i + 1) / n2);
        plate([[ca + Math.cos(a0) * r0a, cb + Math.sin(a0) * r0a], [ca + Math.cos(a1) * r0a, cb + Math.sin(a1) * r0a],
          [ca + Math.cos(a1) * r1a, cb + Math.sin(a1) * r1a], [ca + Math.cos(a0) * r1a, cb + Math.sin(a0) * r1a]], rgb, emis, l);
      }
    };
    // A radial bar from r0 to r1 at angle t, `w` wide.
    const spoke = (ca, cb, t, r0a, r1a, w, rgb, emis, l = 0, w1 = w) => {
      const c = Math.cos(t), s = Math.sin(t), px = -s, pz = c;
      plate([[ca + c * r0a - px * w, cb + s * r0a - pz * w], [ca + c * r0a + px * w, cb + s * r0a + pz * w],
        [ca + c * r1a + px * w1, cb + s * r1a + pz * w1], [ca + c * r1a - px * w1, cb + s * r1a - pz * w1]], rgb, emis, l);
    };
    // A box standing proud of the panel — a switch, a knob, a bezel lip.
    const stud = (ca, cb, ha, hb, depth, rgb, emis, l = 0, tn = tone) =>
      obox(pt(ca, cb, l + depth / 2), r, u, n, ha, hb, depth / 2, tn, k, rgb, emis);
    // A knob: a short cylinder standing out of the panel.
    const knob = (ca, cb, rad, depth, rgb, emis) => rod(pt(ca, cb, 0), pt(ca, cb, depth), rad, tone, k, rgb, emis, 8);

    // ── A DIAL ───────────────────────────────────────────────────────────────
    //
    // Bezel, face, ticks, an optional coloured arc, the needle, the boss. `frac` 0..1 is where the
    // needle sits across the sweep; the sweep runs clockwise from `a0` like every real gauge.
    // ⚠ A SECOND NEEDLE IS A REAL THING (`frac2`): an air-pressure gauge carries the primary and
    // secondary tanks on one face, and an altimeter carries a hundreds and a thousands hand.
    function dial(ca, cb, R, frac, o2 = {}) {
      const a0 = o2.a0 ?? Math.PI * 1.25, sweep = o2.sweep ?? Math.PI * 1.5;
      // The face does not move with the needle, so it is its own (cached) call; the needles and the
      // boss drawn over them follow, in the order they always were.
      dialFaceC(ca, cb, R, o2.a0, o2.sweep, o2.ticks, o2.major, o2.bezel, o2.face, o2.arcs, o2.red, o2.tick, o2.label, o2.name);
      const needle = (fr, len, rgb, w) => {
        const t = a0 - clamp(fr, 0, 1) * sweep;
        spoke(ca, cb, t, -R * 0.18, R * len, R * w, rgb, 0.9, 0.007, R * w * 0.3);
      };
      if (frac2Of(o2) != null) needle(o2.frac2, 0.62, o2.needle2 || C.amber, 0.07);
      needle(frac, 0.88, o2.needle || (o2.red != null && frac >= o2.red ? C.red : C.lampOn), 0.06);
      disc(ca, cb, R * 0.10, C.steel, 0.1, 0.009, 8);
    }
    function dialFace(ca, cb, R, a0_, sweep_, ticks_, major_, bezel, faceRgb, arcs, redF, tick, label, name) {
      const o2 = { bezel, face: faceRgb, arcs, red: redF, tick, label };
      const a0 = a0_ ?? Math.PI * 1.25, sweep = sweep_ ?? Math.PI * 1.5;
      const ticks = ticks_ ?? 10, major = major_ ?? 2;
      annulus(ca, cb, R, R * 1.16, o2.bezel || C.bezel, 0.04, 0.004, 22);
      disc(ca, cb, R, o2.face || C.face, 0, 0.001, 22);
      if (o2.arcs) for (const [f0, f1, rgb] of o2.arcs) {
        annulus(ca, cb, R * 0.80, R * 0.90, rgb, 0.55, 0.003, 8, a0 - f0 * sweep, a0 - f1 * sweep);
      }
      for (let i = 0; i <= ticks; i++) {
        const f = i / ticks, t = a0 - f * sweep, big = i % major === 0;
        const red = o2.red != null && f >= o2.red;
        spoke(ca, cb, t, R * (big ? 0.66 : 0.78), R * 0.93, R * (big ? 0.045 : 0.024),
          red ? C.red : (o2.tick || C.tick), red ? 0.6 : 0.35, 0.004);
      }
      // The dial's name, lettered on its face under the pivot (in `label`'s colour if one is given).
      // A `label` with no `name` is the old blank stripe, kept only so nothing unnamed changes shape.
      if (name) fitText(name, ca, cb - R * 0.46, R * 1.15, R * 0.2, o2.label || o2.tick || C.tick, 0.45, 0.0045);
      else if (o2.label) rect(ca - R * 0.22, cb - R * 0.52, ca + R * 0.22, cb - R * 0.40, o2.label, 0.3, 0.004);
      // The glass is not drawn, and must not be: see "THE WINDSCREEN IS THE ABSENCE OF GEOMETRY".
    }
    const frac2Of = (o2) => (o2.frac2 == null ? null : o2.frac2);

    // ── THE ATTITUDE INDICATOR ───────────────────────────────────────────────
    //
    // A sky half and a ground half split by a horizon that ROLLS with the bank and SLIDES with the
    // pitch, a fixed aeroplane symbol over it, and a bank scale round the top. ⚠ THE HALVES ARE
    // CHORDS OF ONE CIRCLE, built by projecting the points on the wrong side of the horizon onto
    // it, so each half is one convex polygon and fans cleanly.
    function attitude(ca, cb, R, pitchDeg, bankDeg) {
      annulus(ca, cb, R, R * 1.16, C.bezel, 0.04, 0.004, 22);
      const b = (bankDeg || 0) * Math.PI / 180;
      const off = clamp((pitchDeg || 0) / 30, -0.85, 0.85) * R;       // 30° of pitch reaches the rim
      const nx = -Math.sin(b), nz = Math.cos(b);                        // the horizon's "up"
      const n2 = 28, sky = [], gnd = [];
      for (let i = 0; i < n2; i++) {
        const t = (i / n2) * TAU, px = Math.cos(t) * R, pz = Math.sin(t) * R;
        const s = px * nx + pz * nz + off;
        if (s >= 0) { sky.push([ca + px, cb + pz]); gnd.push([ca + px - nx * s, cb + pz - nz * s]); }
        else { gnd.push([ca + px, cb + pz]); sky.push([ca + px - nx * s, cb + pz - nz * s]); }
      }
      plate(sky, C.sky, 0.45, 0.0028);
      plate(gnd, C.ground, 0.40, 0.0028);
      // The horizon bar itself, and two pitch ladder rungs either side of it.
      for (const [dv, w] of [[0, 0.95], [R * 0.33, 0.35], [-R * 0.33, 0.35]]) {
        const cx = ca - nx * (off - dv), cz = cb - nz * (off - dv);
        const hx = Math.cos(b) * R * w, hz = Math.sin(b) * R * w;
        if (Math.hypot(cx - ca, cz - cb) > R * 0.92) continue;
        plate([[cx - hx - nx * 0.0012, cz - hz - nz * 0.0012], [cx + hx - nx * 0.0012, cz + hz - nz * 0.0012],
          [cx + hx + nx * 0.0012, cz + hz + nz * 0.0012], [cx - hx + nx * 0.0012, cz - hz + nz * 0.0012]], C.white, 0.6, 0.004);
      }
      // The bank scale: ticks round the top that turn with the card.
      for (const d of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
        const t = Math.PI / 2 + b + d * Math.PI / 180;
        spoke(ca, cb, t, R * (d % 30 === 0 ? 0.80 : 0.87), R * 0.97, R * 0.03, d === 0 ? C.amber : C.white, 0.6, 0.004);
      }
      // The fixed aeroplane: two wings and a dot, in amber, standing proud of the moving card.
      rect(ca - R * 0.55, cb - R * 0.035, ca - R * 0.18, cb + R * 0.035, C.amber, 0.9, 0.008);
      rect(ca + R * 0.18, cb - R * 0.035, ca + R * 0.55, cb + R * 0.035, C.amber, 0.9, 0.008);
      disc(ca, cb, R * 0.06, C.amber, 0.9, 0.008, 8);
    }

    // ── THE COMPASS CARD ─────────────────────────────────────────────────────
    // A rose that turns under a fixed lubber line, north in red. Heading-up, like the real one.
    function compass(ca, cb, R, hdgDeg) {
      annulus(ca, cb, R, R * 1.16, C.bezel, 0.04, 0.004, 22);
      disc(ca, cb, R, C.face, 0, 0.0025, 22);   // 2.5 mm: at 1 mm it z-fought the Drake pod plate under it
      const h = (hdgDeg || 0) * Math.PI / 180;
      for (let i = 0; i < 36; i++) {
        const t = Math.PI / 2 + h - (i / 36) * TAU, big = i % 9 === 0;
        spoke(ca, cb, t, R * (big ? 0.58 : (i % 3 === 0 ? 0.72 : 0.80)), R * 0.94, R * (big ? 0.05 : 0.022),
          i === 0 ? C.red : C.tick, i === 0 ? 0.8 : 0.35, 0.004);
      }
      // The lubber line and a small aeroplane in the middle.
      spoke(ca, cb, Math.PI / 2, R * 0.95, R * 1.14, R * 0.05, C.amber, 0.9, 0.007);
      rect(ca - R * 0.30, cb - R * 0.03, ca + R * 0.30, cb + R * 0.03, C.amber, 0.8, 0.007);
      rect(ca - R * 0.03, cb - R * 0.30, ca + R * 0.03, cb + R * 0.25, C.amber, 0.8, 0.007);
    }

    // A seven-segment readout of a string. ⚠ UNLIT SEGMENTS ARE DRAWN, or a 1 is a stray mark.
    function digits(a, b, h, str, rgb = C.green, back = true) {
      const s = String(str), w = h * 0.52, gap = h * 0.18;
      if (back) rect(a - h * 0.16, b - h * 0.16, a + s.length * (w + gap) - gap + h * 0.16, b + h * 1.16, C.screen, 0, 0.003);
      [...s].forEach((ch, i) => {
        const on = SEG7[ch] || SEG7[' '];
        seg7(a + i * (w + gap), b, w, h).forEach((pts, j) => plate(pts, on[j] ? rgb : C.lampOff, on[j] ? 0.95 : 0, 0.006));
      });
    }
    // ── LETTERING ─────────────────────────────────────────────────────────────
    // ⚠ THE COCKPIT STANDARD: every label in every seat is real lettering in the legend face
    // (legend-font.js), never a blank stripe standing in for one. `text` is the one way to letter a
    // panel; the named forms of dial / lamp / rocker / toggle / bar below all go through it, and the
    // Drake's small engraved, plated and HUD text reaches the same face. See
    // docs/reference/cockpit-lettering.md.
    function text(str, ca, cb, h, rgb = C.tick, emis = 0.35, l = 0.0045, shadow = null) {
      return legend({ plate }, str, ca, cb, h, rgb, emis, l, shadow);
    }
    // The same, shrunk only as far as it must be to fit `maxW` across.
    function fitText(str, ca, cb, maxW, h, rgb, emis, l) {
      const w = legendWidth(str, h);
      return text(str, ca, cb, w > maxW ? h * (maxW / w) : h, rgb, emis, l);
    }
    // A switch's name, under it.
    const NAME_H = 0.0085;
    // `maxW` is the room the part has: a lamp in a row of lamps gets no wider than its own bezel plus a
    // gap, or a row of tell-tales runs its names together into one word.
    const nameUnder = (name, ca, b, rgb, maxW = 0.07) => { if (name) fitText(name, ca, b - NAME_H * 0.75, maxW, NAME_H, rgb || C.tick, 0.35, 0.004); };

    // A lamp: a lens in a bezel, lit or not, and its name under it.
    function lamp(ca, cb, ha, hb, on, rgb, name) {
      rect(ca - ha * 1.3, cb - hb * 1.3, ca + ha * 1.3, cb + hb * 1.3, C.black, 0, 0.003);
      rect(ca - ha, cb - hb, ca + ha, cb + hb, on ? rgb : rgb.map((c) => c * 0.16), on ? 1 : 0, 0.006);
      nameUnder(name, ca, cb - hb * 1.3 - 0.002);
    }
    // A rocker switch, tilted one way or the other.
    function rocker(ca, cb, on, rgb = C.black, name) {
      nameUnder(name, ca, cb - 0.019);
      rect(ca - 0.011, cb - 0.017, ca + 0.011, cb + 0.017, C.black, 0, 0.003);
      stud(ca, cb + (on ? 0.005 : -0.005), 0.008, 0.009, on ? 0.012 : 0.007, rgb, 0, 0.003);
      if (on) rect(ca - 0.004, cb + 0.010, ca + 0.004, cb + 0.013, C.green, 1, 0.008);
    }
    // A toggle: a boss and a bat that points up or down.
    function toggle(ca, cb, on, name) {
      nameUnder(name, ca, cb - 0.015);
      disc(ca, cb, 0.007, C.chrome, 0.15, 0.003, 8);
      rod(pt(ca, cb, 0.004), pt(ca, cb + (on ? 0.012 : -0.012), 0.020), 0.0025, tone, k, C.chrome, 0.1, 5);
    }
    // A vertical bar gauge — a channel that is always there with a fill that may not be.
    function bar(ca, b0, b1, w, frac, rgb, name) {
      if (name) fitText(name, ca, b0 - 0.008, Math.max(w * 4, 0.03), 0.008, C.tick, 0.35, 0.004);
      rect(ca - w, b0, ca + w, b1, C.black, 0, 0.003);
      const f = clamp(frac, 0, 1);
      if (f > 0.001) rect(ca - w * 0.7, b0 + w * 0.3, ca + w * 0.7, b0 + w * 0.3 + (b1 - b0 - w * 0.6) * f, rgb, 0.85, 0.006);
    }
    // A grille: horizontal slats — a speaker, a vent.
    function grille(a0, b0, a1, b1, n, rgb = C.black) {
      rect(a0, b0, a1, b1, [30, 32, 36], 0, 0.002);
      for (let i = 0; i < n; i++) {
        const b = b0 + (b1 - b0) * ((i + 0.5) / n);
        rect(a0 + 0.004, b - (b1 - b0) / n * 0.22, a1 - 0.004, b + (b1 - b0) / n * 0.22, rgb, 0, 0.004);
      }
    }
    // A rounded ring standing off the panel: a half-round profile swept round a circle, each facet
    // with its own normal, so a polished bezel catches the light on its inner slope, its crown and
    // its outer slope differently instead of being one flat colour. Base at lift `l`.
    const torus = (ca, cb, rIn, rOut, rgb, emis, l = 0, n2 = 28, rings = 4, hk = 0.8) => {
      const rc = (rIn + rOut) / 2, w = (rOut - rIn) / 2, h = w * hk;
      const P = (ph, th) => { const rr = rc - w * Math.cos(ph); return pt(ca + Math.cos(th) * rr, cb + Math.sin(th) * rr, l + h * Math.sin(ph)); };
      for (let i = 0; i < rings; i++) {
        const p0 = (i / rings) * Math.PI, p1 = ((i + 1) / rings) * Math.PI, pm = (p0 + p1) / 2;
        for (let j = 0; j < n2; j++) {
          const t0 = (j / n2) * TAU, t1 = ((j + 1) / n2) * TAU, tm = (t0 + t1) / 2;
          const rad = add(mul(r, Math.cos(tm)), mul(u, Math.sin(tm)));
          const nn = norm(add(mul(rad, -Math.cos(pm) * h / w), mul(n, Math.sin(pm))));
          face([P(p0, t0), P(p0, t1), P(p1, t1), P(p1, t0)], nn, tone, k, rgb, emis);
        }
      }
    };
    // Every drawing method is pure in its arguments and this panel's frame, so each is cached (a
    // no-op outside a memoised part). Internal calls between them use the raw closures.
    const PF = [o, r0, u0, tone, k, fwd];
    const dialFaceC = cached('dialFace', dialFace, PF);
    const W = (name, fn) => cached(name, fn, PF);
    const Pobj = { pt, n, r, u, plate: W('plate', plate), rect: W('rect', rect), disc: W('disc', disc), annulus: W('annulus', annulus),
      torus: W('ptorus', torus), spoke: W('spoke', spoke), stud: W('stud', stud), knob: W('knob', knob), dial,
      attitude: W('attitude', attitude), compass: W('compass', compass), digits: W('digits', digits), lamp: W('lamp', lamp),
      rocker: W('rocker', rocker), toggle: W('toggle', toggle), bar: W('bar', bar), grille: W('grille', grille),
      text: W('text', text), fitText: W('fitText', fitText) };
    Pobj.group = group(Pobj, PF);
    return Pobj;
  }

  const KF = [fwd];
  const Kobj = { face, obox: cached('obox', obox, KF), box: cached('box', box, KF), rod: cached('rod', rod, KF), torus: cached('torus', torus, KF), panel };
  Kobj.group = group(Kobj, KF);
  return Kobj;
}

// ── SHARED PARTS ─────────────────────────────────────────────────────────────

// A round steering wheel: rim, three spokes, a boss, turned by `steer` (-1..1) times `lockDeg`.
// ⚠ THE RIM IS A TORUS OF RODS, NOT A FLAT RING. A flat annulus is invisible edge-on, and edge-on
// is how you see the bottom of a wheel from the seat for the whole drive.
// ⚠ `style` IS A BOUGHT WHEEL (cab-trinkets.js, slot 'wheel'): its palette's rim, rimAlt, spoke and
// boss colours, with a chain or segmented rim alternating the two rim tones link by link.
export function roundWheel(K, c, rake, R, steer, lockDeg, rgbRim = C.grip, spokes = [-90, 0, 180], hornRgb = null, style = null) {
  // The wheel's own plane: `right` across, `up` tilted by the rake, normal toward the driver.
  const up = norm([0, Math.sin(rake), Math.cos(rake)]);
  const right = [1, 0, 0];
  const a = (steer || 0) * (lockDeg * Math.PI / 180);
  const Rr = add(mul(right, Math.cos(a)), mul(up, Math.sin(a)));
  const Ur = add(mul(right, -Math.sin(a)), mul(up, Math.cos(a)));
  const pal = style && style.pal;
  const rimCol = pal ? pal.rim : rgbRim;
  const alt = pal && (style.rim === 'chain' || style.rim === 'segment') ? pal.rimAlt : null;
  const tube = R * (style && style.rim === 'chain' ? 0.10 : 0.085);
  const N = 26;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const p = add(c, add(mul(Rr, Math.cos(t) * R), mul(Ur, Math.sin(t) * R)));
    if (prev) K.rod(prev, p, tube, 'dash', 0.1, alt && i % 2 ? alt : rimCol, 0, 5, false);
    prev = p;
  }
  for (const d of spokes) {
    const t = d * Math.PI / 180;
    const tip = add(c, add(mul(Rr, Math.cos(t) * R * 0.92), mul(Ur, Math.sin(t) * R * 0.92)));
    K.rod(c, tip, R * (style && style.spoke === 'bone' ? 0.075 : 0.06), 'dash', 0.1, pal ? pal.spoke : C.steel, 0, 4);
  }
  if (pal) hornRgb = pal.boss;
  const n = norm(cross(Rr, Ur));
  const toward = dot(n, c) > 0 ? neg(n) : n;
  K.obox(add(c, mul(toward, R * 0.05)), Rr, Ur, toward, R * 0.30, R * 0.26, R * 0.06, 'dash', 0.1, hornRgb || C.grip, 0);
  // A skull boss looks back at you off the hub, as the Skull Wheel and the Bone Rim promise.
  if (style && style.boss === 'skull' && pal) {
    const face = add(c, mul(toward, R * 0.13));
    K.obox(face, Rr, Ur, toward, R * 0.20, R * 0.22, R * 0.05, 'dash', 0.15, pal.cap, 0.05);
    for (const s of [-1, 1]) K.obox(add(add(face, mul(Rr, s * R * 0.08)), add(mul(Ur, R * 0.04), mul(toward, R * 0.05))), Rr, Ur, toward, R * 0.05, R * 0.05, R * 0.005, 'dash', 0, [20, 18, 16], 0);
  } else if (style && style.boss === 'star' && pal) {
    for (let i = 0; i < 5; i++) {
      const t = Math.PI / 2 + i * Math.PI * 2 / 5;
      const tip = add(add(c, mul(toward, R * 0.12)), add(mul(Rr, Math.cos(t) * R * 0.2), mul(Ur, Math.sin(t) * R * 0.2)));
      K.rod(add(c, mul(toward, R * 0.12)), tip, R * 0.03, 'dash', 0.3, pal.cap, 0.1, 4);
    }
  }
  // A marker at twelve o'clock on the rim, so the lock on is readable at a glance.
  const top = add(c, mul(Ur, R));
  K.obox(add(top, mul(toward, R * 0.02)), Rr, Ur, toward, R * 0.07, R * 0.09, R * 0.09, 'dash', 0.1, C.amber, 0.3);
  return { toward, Rr, Ur };
}

// A pedal: a pad on an arm hinged at `pivot`, pushed forward by `press` 0..1.
// The arm HANGS from the pivot and swings forward (+y) as it is pressed.
export function pedal(K, pivot, w, h, press, rgb = C.rubber) {
  const t = 0.30 + clamp(press || 0, 0, 1) * 0.45;          // radians off straight down
  const dir = [0, Math.sin(t), -Math.cos(t)];
  const pad = add(pivot, mul(dir, h));
  K.rod(pivot, pad, 0.008, 'dash', 0, C.steel, 0, 4);
  const up = neg(dir), right = [1, 0, 0];
  let n = norm(cross(right, up));
  if (n[1] > 0) n = neg(n);
  K.obox(pad, right, up, n, w, h * 0.32, 0.010, 'dash', 0, rgb, 0);
}

// A seat in the round: cushion, backrest, headrest, and a bolster each side — the three things a
// seat is read by from the next seat along.
export function richSeat(K, cx, P, rgb, belt = true) {
  const x0 = cx - P.seatHalf, x1 = cx + P.seatHalf;
  const y0 = P.seatY[0], y1 = P.seatY[1], sz = P.seatZ;
  // Bolsters on the cushion.
  K.box(x0, y0, sz, x0 + 0.05, y1, sz + 0.05, 'seat', 0.08);
  K.box(x1 - 0.05, y0, sz, x1, y1, sz + 0.05, 'seat', 0.08);
  // Backrest bolsters.
  K.box(x0, y0 - 0.12, sz, x0 + 0.06, y0 - 0.02, P.backZ - 0.10, 'seat', -0.02);
  K.box(x1 - 0.06, y0 - 0.12, sz, x1, y0 - 0.02, P.backZ - 0.10, 'seat', -0.02);
  // The headrest, on two steel posts. ⚠ IT STANDS BEHIND THE EYE, never at it — an eye inside a
  // headrest is a black screen, and the gate's first rule.
  const hy0 = y0 - 0.15, hy1 = y0 - 0.05;
  if (P.backZ + 0.22 < (P.roof ?? 1) - 0.02) {
    for (const s of [-0.07, 0.07]) K.rod([cx + s, (hy0 + hy1) / 2, P.backZ], [cx + s, (hy0 + hy1) / 2, P.backZ + 0.06], 0.006, 'dash', 0, C.chrome, 0.1, 4);
    K.box(cx - 0.13, hy0, P.backZ + 0.06, cx + 0.13, hy1, P.backZ + 0.20, 'seat', -0.04, rgb);
  }
  // The belt, across the backrest from the outboard shoulder to the inboard hip.
  if (belt) K.rod([x0 + 0.03, y0 - 0.005, P.backZ - 0.06], [x1 - 0.02, y1 - 0.2, sz + 0.06], 0.012, 'dash', 0, C.cloth, 0, 4);
}
