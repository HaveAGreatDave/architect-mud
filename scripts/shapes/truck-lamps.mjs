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

// A lamp smaller than this on screen is a smudge, not a headlight. Sized off what the four
// currently produce (the weakest is ~250 px² at this camera) with room to spare underneath.
export const LAMP_MIN_AREA = 60;

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
