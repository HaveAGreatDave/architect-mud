// Are both headlamps actually on the screen?
//
// This gate exists because the same bug shipped twice. A truck's headlamps are two small boxes on
// the front of a mesh built entirely from other boxes, and whether you can SEE one is not a fact
// about where it is — it is a fact about what the painter's algorithm draws after it. Version one
// put the lamps inside the grille surround's fore-aft slice, so the sort showed one and ate the
// other. Version two moved them outboard but kept a fixed height, which cleared a bonneted truck's
// bumper and sat exactly behind a cab-over's — so the two cheapest rigs in the fleet had no
// visible headlamps at all, and the only way anybody found out was looking at a screenshot.
//
// Neither is catchable by asserting on geometry: the lamp was always where the code said. So this
// RENDERS the depot scene through a recording context, replays the polygons in draw order, and
// asks the only question that matters — after everything in front of it has been painted, is any
// of this lens still visible? It needs no browser and no pixels, just the draw order the real
// canvas would have had.
//
// It runs the PARKED pose because that is what the depot shows, and the parked pose is the one a
// player looks at longest.
import { aircraftFaces } from '../../client/game/js/panels/aircraft3d.js';

// The lens tints, straight off the mesh (`buildTruck`'s headlamp block). Matching by colour rather
// than by walking the face list is deliberate: it tests what reached the CANVAS, which is the
// thing that was wrong both times.
const LENS_TINTS = [[242, 234, 196], [238, 228, 182]];
const TOL = 0.05;

function recorder() {
  const polys = [];
  let cur = null;
  const grad = { addColorStop() {} };
  const sink = () => {};
  return {
    polys,
    ctx: {
      canvas: { width: 900, height: 520 },
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      beginPath() { cur = []; },
      moveTo(x, y) { cur = [[x, y]]; },
      lineTo(x, y) { if (cur) cur.push([x, y]); },
      closePath: sink,
      fill() { if (cur && cur.length > 2) polys.push({ p: cur.slice(), col: String(this.fillStyle) }); },
      rect(x, y, w, h) { cur = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; },
      roundRect(x, y, w, h) { cur = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; },
      arc() { cur = null; }, ellipse() { cur = null; },
      quadraticCurveTo() { cur = null; }, bezierCurveTo() { cur = null; }, arcTo() { cur = null; },
      createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad,
      createPattern: () => null, measureText: () => ({ width: 0 }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4), width: w, height: h }),
      stroke: sink, fillRect: sink, strokeRect: sink, clearRect: sink, clip: sink, save: sink, restore: sink,
      translate: sink, rotate: sink, scale: sink, transform: sink, setTransform: sink, fillText: sink,
      drawImage: sink, putImageData: sink, setLineDash: sink,
      globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '', font: '', textAlign: '', textBaseline: '', lineJoin: '', lineCap: '', filter: '',
    },
  };
}

const rgbOf = (s) => { const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };
// shadeRgb scales all three channels, so the RATIO between them survives lighting — which is what
// lets a shaded lens be recognised without re-deriving the lighting maths here.
const isLens = (col) => {
  const v = rgbOf(col);
  if (!v || v[0] < 30) return false;
  return LENS_TINTS.some((t) => {
    const k = v[0] / t[0];
    return Math.abs(v[1] / t[1] - k) < TOL && Math.abs(v[2] / t[2] - k) < TOL;
  });
};
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// Returns { variant, left, right } — visible lens area each side of the model's centreline.
export function truckLampSmoke(drawHangarScene, variants = ['scrapper', 'hauler', 'drayman', 'continental']) {
  const out = [];
  for (const variant of variants) {
    const { ctx, polys } = recorder();
    drawHangarScene(ctx, { w: 900, h: 520, venue: 'garage', sky: { night: 0 },
      entries: [{ id: 'lamp', cls: 'truck', variant: `${variant}~p`, livery: { base: '#7d3f2a', trim: '#d8cfc0' }, label: variant }] });
    const lenses = polys.map((p, i) => ({ ...p, i })).filter((p) => isLens(p.col));
    // The model's own screen centre, so "left lamp" and "right lamp" mean the two sides of the
    // truck rather than two halves of the canvas.
    const allX = polys.flatMap((p) => p.p.map((v) => v[0]));
    const mid = (Math.min(...allX) + Math.max(...allX)) / 2;
    let left = 0, right = 0;
    for (const L of lenses) {
      if (L.p.length < 4) continue;
      let vis = 0, n = 0;
      for (let a = 0.15; a <= 0.86; a += 0.175) for (let b = 0.15; b <= 0.86; b += 0.175) {
        const pt = [L.p[0][0] + (L.p[1][0] - L.p[0][0]) * a + (L.p[3][0] - L.p[0][0]) * b,
                    L.p[0][1] + (L.p[1][1] - L.p[0][1]) * a + (L.p[3][1] - L.p[0][1]) * b];
        n++;
        if (!polys.slice(L.i + 1).some((q) => inside(pt, q.p))) vis++;
      }
      const area = Math.abs(L.p.reduce((s, v, k) => {
        const w = L.p[(k + 1) % L.p.length]; return s + (v[0] * w[1] - w[0] * v[1]);
      }, 0) / 2) * (vis / n);
      const cx = L.p.reduce((s, v) => s + v[0], 0) / L.p.length;
      if (cx < mid) left += area; else right += area;
    }
    out.push({ variant, left, right, lenses: lenses.length });
  }
  return out;
}

// A lamp smaller than this on screen is a smudge, not a headlight.
//
// ⚠ THIS NUMBER WAS CALIBRATED AGAINST A BUG, AND THAT IS WHY IT MOVED. It was 60, sized off "what
// the four currently produce" at a time when the depot sorted the mesh PER FACE — so a lens was
// painted over the bumper standing in front of it, and the areas it was measuring were areas no
// correct renderer would ever produce. When the depot was given the part sort the windscreen had
// always used (aircraft3d's sortTruckFaces), the bumper started correctly covering the bottom of
// each lens, the far one lost more than the near one because it is smaller on screen, and three of
// the four rigs "failed" a gate for finally drawing them right.
//
// So the gate now tests what it was always FOR — a lamp being EATEN, which is what shipped twice —
// rather than a lamp being partly behind the bumper it is mounted beside, which is what a truck
// looks like. Two assertions, and the second is the one with the teeth:
//   · a floor, well above nothing, that says a lens is on screen at all;
//   · and SYMMETRY. A mesh symmetric about its centreline that draws asymmetrically is exactly the
//     signature of a sort error (it is why the reports were always "one lamp" and never "no
//     lamps"), and unlike a fixed area it cannot be invalidated by a camera, a zoom or an honest
//     occlusion — both sides get the same treatment from any angle, so their RATIO is the invariant.
export const LAMP_MIN_AREA = 18;
// How far apart the two sides may be before it is a sort error rather than perspective. The far
// lamp at this camera is legitimately about half the near one; 4× is comfortably past anything
// foreshortening can do and comfortably short of one lamp being gone.
export const LAMP_MAX_RATIO = 4;

// ── The rule the front of a truck keeps breaking ──────────────────────────────
// NOTHING ON THE FACE MAY SHARE A FORE-AFT SLICE WITH THE PANEL BEHIND IT.
//
// This has now cost three bugs on one square foot of geometry: two headlamp versions, and then the
// grille comb, which started 0.002 behind the surround's own front face. A face gets ONE depth in
// the painter's sort, so a panel whose plane falls INSIDE a detail's f-span is nearer than half of
// those details and farther than the other half — under any yaw it is drawn over one side and not
// the other. That is why the reports are always "one lamp" or "half the grille" and never "the
// grille is gone": a symmetric mesh, drawn asymmetrically, which is exactly the shape of bug that
// looking at a screenshot is worst at attributing.
//
// So this asserts the rule directly on the mesh instead of trying to recognise a comb of chrome
// teeth in a recorded canvas. For every chrome detail standing on the nose, no flat panel may have
// its plane strictly inside that detail's fore-aft span while covering the same patch of g and z.
// Cheap, exact, and it cannot be fooled by a camera angle that happens to flatter the model.
const CHROME_TINT = [226, 232, 240];
const spanOf = (f, k) => { const v = f.p.map((p) => p[k]); return [Math.min(...v), Math.max(...v)]; };
const overlaps = (a, b) => a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6;

export function truckNoseSliceSmoke(variants = ['scrapper', 'hauler', 'drayman', 'continental']) {
  const bad = [];
  for (const variant of variants) {
    const faces = aircraftFaces('truck', 1, false, `${variant}~p`);
    const noseF = Math.max(...faces.flatMap((f) => f.p.map((p) => p[0])));
    // The chrome standing proud of the nose: the grille comb and the bullet in its mouth.
    const details = faces.filter((f) => {
      if (!f.tint || f.tint[0] !== CHROME_TINT[0] || f.tint[1] !== CHROME_TINT[1]) return false;
      const [f0, f1] = spanOf(f, 0), [z0, z1] = spanOf(f, 2);
      return f1 > noseF - 0.05 && z0 > 0.05 && z1 < 0.13;
    });
    for (const d of details) {
      const df = spanOf(d, 0);
      if (df[1] - df[0] < 1e-6) continue;            // a detail's own flat faces are not the problem
      const dg = spanOf(d, 1), dz = spanOf(d, 2);
      for (const p of faces) {
        if (p === d || p.tint) continue;              // panels are untinted body/strut work
        const pf = spanOf(p, 0);
        if (pf[1] - pf[0] > 1e-6) continue;           // only a FLAT panel has a single plane to cut with
        if (pf[0] <= df[0] + 1e-6 || pf[0] >= df[1] - 1e-6) continue;   // its plane is clear of the span
        if (overlaps(spanOf(p, 1), dg) && overlaps(spanOf(p, 2), dz)) {
          bad.push({ variant, role: p.role, plane: pf[0], detail: df });
          break;
        }
      }
    }
    // No assertion that chrome EXISTS here: a cab-over (the Barrow) has no bonnet, so it has no
    // grille comb and no bullet to put in one — it wears a radiator panel instead, and that is the
    // shape it is meant to be rather than a missing detail.
  }
  return bad;
}

// The parked pose has to actually be a different pose, or `~p` is a no-op nobody would notice.
export function parkedStanceSmoke() {
  const out = [];
  for (const variant of ['scrapper', 'hauler', 'drayman', 'continental']) {
    // THE LIFTERS DECIDE, not the whole mesh. A rolling rig's lowest point is the glow it throws on
    // the road, which is not part of the vehicle — measuring that instead said a parked truck rose.
    // `gear` is the pod housing and its shroud, which is what a settled truck rests on.
    const podLow = (v) => aircraftFaces('truck', 1, false, v)
      .filter((f) => f.role === 'gear').reduce((m, f) => Math.min(m, ...f.p.map((p) => p[2])), Infinity);
    const anyLow = (v) => aircraftFaces('truck', 1, false, v)
      .reduce((m, f) => Math.min(m, ...f.p.map((p) => p[2])), Infinity);
    const rolling = podLow(variant), sat = podLow(`${variant}~p`);
    out.push({ variant, rolling, sat, drop: rolling - sat, through: anyLow(`${variant}~p`) });
  }
  return out;
}

// ── IS ANYTHING PAINTED OVER A PART THAT IS ENTIRELY IN FRONT OF IT? ─────────
// The stability sweep below asks whether the order HOLDS; this asks whether it is RIGHT, and they
// are different failures with different symptoms. A wrong order that holds perfectly still does not
// flicker — it reads as the truck being see-through, with a rail or a lamp pod showing through the
// panel that ought to be hiding it, and it stays that way for as long as you sit at that angle.
//
// The test is the one painter's-order question with no judgement in it: part A was painted BEFORE
// part B, they overlap on screen, and every vertex of A is nearer than every vertex of B. There is
// no depth ambiguity to argue about there — A is simply in front, and painting it first means B is
// covering something that is closer to the camera than it is.
//
// It found the bug it was written for: the hysteresis pass compared two parts' NEAREST vertices, so
// a chassis rail (whose near end sits alongside everything bolted down the length of it) counted as
// "within EPS" of parts it was nowhere near in depth, and the stale order was held over a genuine
// crossing. Hence the disjoint test in sortTruckFaces.
export function truckOcclusionSmoke(sortTruckFaces, resetOrder, opts = {}) {
  const STEPS = opts.steps || 72;
  const MIN_OVERLAP = opts.minOverlap || 0.25;   // of the smaller part's screen box — ignore grazes
  const SIZE = 0.11, EL = 0.35;                  // a chase camera's own elevation, roughly
  const out = [];
  for (const variant of ['scrapper', 'hauler', 'drayman', 'continental', 'continental+t']) {
    const faces = aircraftFaces('truck', 1, false, variant);
    resetOrder();
    let bad = 0, worstView = null;
    for (let v = 0; v < STEPS; v++) {
      const th = (v / STEPS) * Math.PI * 2, ct = Math.cos(th), sn = Math.sin(th);
      const proj = faces.map((f, i) => {
        let af = 0, nf = Infinity;
        const pts = [];
        for (const q of f.p) {
          const d = 2 + (q[0] * ct + q[1] * sn) * SIZE;
          const sx = (-q[0] * sn + q[1] * ct) * SIZE * 500;
          const sy = -q[2] * SIZE * 500 * Math.cos(EL) + (q[0] * ct + q[1] * sn) * SIZE * 500 * Math.sin(EL);
          pts.push({ sx, sy, f: d });
          af += d; if (d < nf) nf = d;
        }
        return { pts, af: af / f.p.length, nf, part: f.part, i, role: f.role };
      });
      sortTruckFaces(proj, { id: `occlusion:${variant}` }, SIZE);
      // Collapse to parts IN PAINT ORDER, with a screen box and a depth range each.
      const order = [], seen = new Map();
      for (const f of proj) {
        let g = seen.get(f.part);
        if (!g) { seen.set(f.part, g = { role: f.role, part: f.part, dmin: Infinity, dmax: -Infinity, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }); order.push(g); }
        for (const q of f.pts) {
          if (q.f < g.dmin) g.dmin = q.f; if (q.f > g.dmax) g.dmax = q.f;
          if (q.sx < g.x0) g.x0 = q.sx; if (q.sx > g.x1) g.x1 = q.sx;
          if (q.sy < g.y0) g.y0 = q.sy; if (q.sy > g.y1) g.y1 = q.sy;
        }
      }
      for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
        const A = order[a], B = order[b];              // A painted first
        if (A.dmax >= B.dmin) continue;                // ranges touch — ambiguous, not this test's business
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox <= 0 || oy <= 0) continue;
        const small = Math.min((A.x1 - A.x0) * (A.y1 - A.y0), (B.x1 - B.x0) * (B.y1 - B.y0));
        if (small <= 0 || (ox * oy) / small < MIN_OVERLAP) continue;
        bad++;
        if (!worstView) worstView = `${A.role}#${A.part} painted under ${B.role}#${B.part}`;
      }
    }
    out.push({ variant, bad, worstView, views: STEPS });
  }
  return out;
}

// ── DOES THE DRAW ORDER HOLD STILL WHILE THE CAMERA GOES ROUND? ──────────────
// The complaint this exists for is "parts pop in and out when you rotate around the truck", and it
// is the one failure in this file that geometry cannot see: every box is exactly where it should
// be, and the bug is entirely in WHICH ORDER they are painted, frame to frame. The nose-slice check
// above asks whether a detail is buried from four fixed angles; this asks the temporal question
// instead — sweep the camera the whole way round and count how often each pair of parts trades
// places.
//
// A rigid body rotating 360° has a legitimate number of swaps: two parts genuinely change which is
// in front as the view direction crosses the plane containing both, and for a convex-ish pile that
// is a handful of times at most. Chatter is a pair swapping over and over across a few degrees,
// which is what the eye reads as flashing. So the assertion is a CEILING on swaps per pair, not
// zero — demanding zero would forbid the sort from ever being right.
//
// No camera and no canvas: depth along a view direction is a dot product, which is all the sort
// consumes. That keeps this a test of the ORDERING rather than of the projection.
export function truckSortStabilitySmoke(sortTruckFaces, resetOrder, opts = {}) {
  const STEPS = opts.steps || 180;              // 2° per step through a full turn
  const MAX_SWAPS = opts.maxSwaps || 6;         // per pair, over the whole sweep
  const out = [];
  for (const variant of ['scrapper', 'hauler', 'drayman', 'continental', 'continental+t']) {
    const faces = aircraftFaces('truck', 1, false, variant);
    const SIZE = 0.11;
    resetOrder();
    let prevRank = null;
    const swaps = new Map();                    // "a|b" -> how many times that pair changed places
    let worst = { pair: null, n: 0 };
    for (let s = 0; s < STEPS; s++) {
      const th = (s / STEPS) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
      // Project to depth only. +2 keeps every f positive, as a real camera's would be.
      const proj = faces.map((f, i) => {
        let af = 0, nf = Infinity;
        // ⚠ THE POINTS ARE REAL DEPTHS, not an empty array. `sortTruckFaces` reads each face's
        // projected vertices to find the part's FAR extent, which is how it decides whether two
        // parts overlap in depth at all (the disjoint test that stops hysteresis holding a wrong
        // order). Handing it `pts: []` made every pair look disjoint here and nowhere else, so this
        // sweep would have been measuring a sorter the game does not run. Only `f` is used; the
        // screen coordinates are irrelevant to a depth-order question.
        const pts = [];
        for (const p of f.p) {
          const d = 2 + (p[0] * ct + p[1] * st) * SIZE;
          pts.push({ sx: 0, sy: 0, f: d });
          af += d; if (d < nf) nf = d;
        }
        return { pts, af: af / f.p.length, nf, part: f.part, i, role: f.role };
      });
      sortTruckFaces(proj, { id: `stability:${variant}` }, SIZE);
      // Rank each PART by where its first face landed.
      const rank = new Map();
      proj.forEach((f, idx) => { if (!rank.has(f.part)) rank.set(f.part, idx); });
      if (prevRank) {
        const keys = [...rank.keys()];
        for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
          const ka = keys[a], kb = keys[b];
          if (!prevRank.has(ka) || !prevRank.has(kb)) continue;
          const was = prevRank.get(ka) < prevRank.get(kb);
          const now = rank.get(ka) < rank.get(kb);
          if (was === now) continue;
          const id = `${ka}|${kb}`;
          const n = (swaps.get(id) || 0) + 1;
          swaps.set(id, n);
          if (n > worst.n) worst = { pair: id, n };
        }
      }
      prevRank = rank;
    }
    const chattering = [...swaps.values()].filter((n) => n > MAX_SWAPS).length;
    out.push({ variant, parts: prevRank.size, chattering, worst: worst.n, max: MAX_SWAPS });
  }
  return out;
}
