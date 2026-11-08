// WHAT A FISH LOOKS LIKE, for everything that draws one out of the water: the catch card and the net
// close-up (client/game/js/panels/fish-portrait.js, in 2-D) and the fish on the line (`fishMesh`, in
// 3-D, drawn by glass/rod-rig.js). One table, so the fish that jumps is the fish on the card.
//
// fish.js says what a fish does; this says what it looks like. Pure: no DOM, no clock.
//
// The body is one outline per `shape` in fish.js: half-heights above and below the midline, at
// fractions of the length from the nose to the root of the tail. The colours are the house's two
// flat tones and a pale belly, as gl/cel-figure.js paints a figure. Each species has a mark:
//   scales   rows of scale arcs            bars    dark vertical bars down the flank
//   spots    dark spots along the back     tiger   wavy stripes over the back
//   scutes   a row of bony plates          blotch  big soft patches
//   lamp     a line of pale lights         gill    a red slash behind the gill
//   none     plain

export const LOOKS = {
  sludge_carp:        { back: [66, 60, 36],   flank: [112, 100, 58],  belly: [172, 160, 114], fin: [84, 66, 40],   mark: 'scales' },
  carp:               { back: [92, 84, 40],   flank: [168, 138, 62],  belly: [222, 198, 128], fin: [138, 86, 44],  mark: 'scales' },
  razorgill:          { back: [40, 72, 84],   flank: [142, 170, 174], belly: [224, 232, 228], fin: [184, 62, 46],  mark: 'gill' },
  irontooth_bass:     { back: [44, 56, 50],   flank: [108, 126, 104], belly: [208, 212, 182], fin: [66, 74, 64],   mark: 'bars' },
  ashen_pike:         { back: [66, 72, 68],   flank: [144, 150, 140], belly: [216, 216, 200], fin: [94, 98, 86],   mark: 'spots' },
  glass_eel:          { back: [150, 178, 180], flank: [200, 218, 216], belly: [232, 238, 232], fin: [176, 196, 196], mark: 'none' },
  coldwater_sturgeon: { back: [54, 60, 66],   flank: [118, 124, 126], belly: [214, 210, 198], fin: [76, 80, 86],   mark: 'scutes' },
  lamp_herring:       { back: [52, 92, 118],  flank: [180, 202, 208], belly: [238, 240, 230], fin: [120, 150, 164], mark: 'lamp' },
  chrome_mackerel:    { back: [30, 68, 96],   flank: [188, 206, 214], belly: [242, 242, 238], fin: [70, 96, 112],  mark: 'tiger' },
  sand_skate:         { back: [152, 130, 94], flank: [176, 154, 114], belly: [226, 216, 196], fin: [132, 112, 82], mark: 'spots' },
  wreck_grouper:      { back: [80, 54, 44],   flank: [138, 100, 74],  belly: [198, 170, 138], fin: [100, 70, 54],  mark: 'blotch' },
  slate_cod:          { back: [60, 70, 76],   flank: [126, 134, 130], belly: [216, 214, 202], fin: [84, 92, 94],   mark: 'spots' },
};
const LOOK0 = LOOKS.carp;
export const lookOf = (id) => LOOKS[id] || LOOK0;

// Heights are fractions of the body length, tail root at u = 1.
//   top, bot   [u, half-height] control points from nose to tail root
//   tail       its height and how deep the fork is, as fractions of the length
//   dorsal     [from u, to u, height]; anal likewise; pelvic is one fin at u
const P = {
  round: { top: [[0, 0.02], [0.08, 0.1], [0.3, 0.19], [0.55, 0.16], [0.85, 0.07], [1, 0.05]], bot: [[0, 0.02], [0.1, 0.09], [0.35, 0.16], [0.6, 0.13], [0.85, 0.06], [1, 0.05]],
    tail: [0.17, 0.05], dorsal: [0.32, 0.72, 0.07], anal: [0.72, 0.86, 0.06], pelvic: 0.45 },
  slim: { top: [[0, 0.015], [0.1, 0.07], [0.3, 0.11], [0.6, 0.1], [0.88, 0.04], [1, 0.03]], bot: [[0, 0.015], [0.12, 0.07], [0.35, 0.1], [0.65, 0.08], [0.88, 0.04], [1, 0.03]],
    tail: [0.15, 0.1], dorsal: [0.38, 0.6, 0.06], anal: [0.68, 0.84, 0.05], pelvic: 0.5 },
  deep: { top: [[0, 0.03], [0.08, 0.13], [0.3, 0.24], [0.55, 0.21], [0.85, 0.09], [1, 0.07]], bot: [[0, 0.04], [0.1, 0.12], [0.35, 0.2], [0.6, 0.16], [0.85, 0.08], [1, 0.07]],
    tail: [0.17, 0.03], dorsal: [0.26, 0.78, 0.09], anal: [0.68, 0.86, 0.07], pelvic: 0.4 },
  long: { top: [[0, 0.012], [0.12, 0.05], [0.35, 0.075], [0.7, 0.075], [0.9, 0.05], [1, 0.035]], bot: [[0, 0.012], [0.14, 0.05], [0.4, 0.075], [0.7, 0.07], [0.9, 0.045], [1, 0.035]],
    tail: [0.1, 0.04], dorsal: [0.68, 0.86, 0.06], anal: [0.7, 0.86, 0.05], pelvic: 0.55 },
  eel: { top: [[0, 0.01], [0.06, 0.024], [0.5, 0.03], [0.9, 0.018], [1, 0.006]], bot: [[0, 0.01], [0.06, 0.024], [0.5, 0.03], [0.9, 0.018], [1, 0.006]],
    tail: [0.015, 0], dorsal: [0.3, 1, 0.012], anal: [0.45, 1, 0.012], pelvic: 0 },
  skate: { top: [[0, 0.02], [0.3, 0.06], [0.55, 0.05], [0.8, 0.02], [1, 0.012]], bot: [[0, 0.02], [0.3, 0.04], [0.55, 0.04], [0.8, 0.02], [1, 0.012]],
    tail: [0.02, 0], dorsal: [0, 0, 0], anal: [0, 0, 0], pelvic: 0 },
};
export const profileOf = (shape) => P[shape] || P.round;

// A control-point curve at u, smoothed so the outline has no corners.
export function curveAt(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [a, ha] = pts[i - 1], [b, hb] = pts[i], t = (u - a) / (b - a || 1), s = t * t * (3 - 2 * t);
      return ha + (hb - ha) * s;
    }
  }
  return pts[pts.length - 1][1];
}

// ── THE 3-D BODY ─────────────────────────────────────────────────────────────────────────────────
// Length 1 along +x with the nose at +0.5, y to starboard, z up. Rings of an ellipse down the body,
// coloured by where each face sits round the ring: back, flank, belly. A flat tail, and a dorsal fin
// standing on the back. A skate is a flat diamond with a whip of a tail. Kept per species.
const RINGS = 9, SIDES = 8;
const MESH = new Map();
const add3 = (o, a, b, c, rgb) => o.push({ a, b, c, rgb });

export function fishMesh(id, shape) {
  const key = id + ':' + shape;
  const hit = MESH.get(key);
  if (hit) return hit;
  const L = lookOf(id), Q = profileOf(shape), out = [];
  const X = (u) => 0.5 - u * 0.86;     // the body is 86% of the length; the tail is the rest
  if (shape === 'skate') {
    const body = L.back, under = L.belly;
    const rim = [[0.5, 0], [0.12, 0.48], [-0.22, 0.16], [-0.22, -0.16], [0.12, -0.48]];
    for (let i = 0; i < rim.length; i++) {
      const p = rim[i], q = rim[(i + 1) % rim.length];
      add3(out, [p[0], p[1], 0], [q[0], q[1], 0], [0.05, 0, 0.05], body);
      add3(out, [p[0], p[1], 0], [q[0], q[1], 0], [0.05, 0, -0.03], under);
    }
    add3(out, [-0.2, 0.012, 0], [-0.2, -0.012, 0], [-0.5, 0, 0], L.fin);
    MESH.set(key, out);
    return out;
  }
  const wide = shape === 'deep' ? 0.42 : shape === 'eel' ? 1 : 0.62;
  const rings = [];
  for (let i = 0; i <= RINGS; i++) {
    const u = i / RINGS, ht = curveAt(Q.top, u), hb = curveAt(Q.bot, u), w = (ht + hb) * 0.5 * wide, x = X(u), ring = [];
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2, s = Math.sin(a);
      ring.push([x, Math.cos(a) * w, s >= 0 ? s * ht : s * hb]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const k = (j + 1) % SIDES, a = rings[i][j], b = rings[i][k], c = rings[i + 1][k], d = rings[i + 1][j];
      const up = (a[2] + b[2] + c[2] + d[2]) / 4 / (curveAt(Q.top, (i + 0.5) / RINGS) || 1);
      const rgb = up > 0.45 ? L.back : up > -0.35 ? L.flank : L.belly;
      add3(out, a, b, c, rgb); add3(out, a, c, d, rgb);
    }
  }
  // The tail: a forked or square blade, in the plane of the body.
  const r = X(1), th = Q.tail[0], fork = Q.tail[1];
  if (th > 0.02) {
    add3(out, [r, 0, 0.02], [-0.5, 0, th], [-0.5 + fork, 0, 0], L.fin);
    add3(out, [r, 0, -0.02], [-0.5 + fork, 0, 0], [-0.5, 0, -th], L.fin);
  }
  // The dorsal fin.
  const [d0, d1, dh] = Q.dorsal;
  if (dh > 0.02) {
    const a = X(d0), b = X(d1), z0 = curveAt(Q.top, d0), z1 = curveAt(Q.top, d1);
    add3(out, [a, 0, z0], [b, 0, z1], [a - (a - b) * 0.25, 0, Math.max(z0, z1) + dh], L.fin);
  }
  MESH.set(key, out);
  return out;
}
