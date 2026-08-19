// Does the rig actually bend at the pin?
//
// A semi is not a long vehicle. It is a tractor and a box that share one point, and the only free
// variable between them is the angle about that point — which the physics has modelled since phase 1
// (`s.phi`) and the mirrors have drawn at its true value all along, while the view out of the window
// welded the two together and swung them as one. A jackknife could be happening on the gauge,
// visible in the mirror, and invisible in front of you.
//
// Splitting one mesh into two drawn models has one failure that matters and it is silent: the JOINT.
// Get the pin station wrong and the box is drawn a hand's width off its coupling — which at φ=0
// reads as a slightly odd-looking rig rather than as a bug, and only becomes obviously broken once
// it starts turning. So the gate is a comparison, not a look:
//
//   lag     a positive `phi` is a trailer BEHIND the tractor, and the two directions must not draw
//           the same — a box that swings the wrong way is a trailer steering the truck, which is
//           what the first cut did by reassembling the angle with the wrong sign.
//   φ = 0   the two-body rig must occupy the SAME silhouette as the welded one. That is the whole
//           correctness statement: at no angle, an articulated rig IS the rigid rig.
//   φ ≠ 0   it must not. A joint that never moves is a weld with extra steps, and this is the half
//           that catches the angle being dropped on the way through.
//
// ⚠ AND THE GATE HAS TWO HALVES, BECAUSE ONE OBSERVABLE CANNOT SEE BOTH FAILURES.
//
// The GEOMETRY (joint, swing, lag) is read with the depth blit OFF, as every other truck smoke in
// here does — with it on, the model reaches the canvas as one blitted rectangle and there are no
// polygons left to measure.
//
// But the blit is exactly what broke the first cut. That version drew the rig as TWO models, and
// two model draws each run their own depth pass and blit their own rectangle, so the second painted
// over the first and half the rig simply vanished — in the game, and nowhere in this file, because
// with the blit off both halves reached the canvas and the gate went green on a rig that was
// invisible to the player. So the second half counts RASTERS with the blit on: an articulated rig
// is one model with a hinge in it, and one model is one raster. Two is the bug, and it is a bug
// whatever the geometry says.
import { rasterCount, _setBlitEnabled } from '../../client/game/js/panels/model-raster.js';
import { truckMeta } from '../../client/game/js/panels/aircraft3d.js';

const SWING_MIN = 2;    // px of box movement below which two angles are indistinguishable
export const CLEAR_DEG = 90;   // articulation the box must clear the cab at — see frameBack in aircraft3d

function recorder() {
  const polys = []; let cur = null;
  const grad = { addColorStop() {} }, sink = () => {};
  return { polys, ctx: {
    canvas: { width: 900, height: 400 }, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    beginPath() { cur = []; }, moveTo(x, y) { cur = [[x, y]]; }, lineTo(x, y) { if (cur) cur.push([x, y]); },
    closePath: sink, fill() { if (cur && cur.length > 2) polys.push({ p: cur.slice(), col: String(this.fillStyle) }); },
    rect(x, y, w, h) { cur = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; },
    roundRect(x, y, w, h) { cur = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; },
    arc() { cur = null; }, ellipse() { cur = null; }, quadraticCurveTo() { cur = null; },
    bezierCurveTo() { cur = null; }, arcTo() { cur = null; },
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad,
    createPattern: () => null, measureText: () => ({ width: 0 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4), width: w, height: h }),
    stroke: sink, fillRect: sink, strokeRect: sink, clearRect: sink, clip: sink, save: sink, restore: sink,
    translate: sink, rotate: sink, scale: sink, transform: sink, setTransform: sink, fillText: sink,
    drawImage: sink, putImageData: sink, setLineDash: sink,
    globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '', font: '', textAlign: '',
    textBaseline: '', lineJoin: '', lineCap: '', filter: '',
  } };
}

// ⚠ AND IT MEASURES THE BOX, NOT THE RIG. The obvious observable is the silhouette's bounding box,
// and it is too blunt by half: swung one way the trailer stays inside the tractor's own outline and
// the box moves several feet for a tenth of a pixel of bbox. So the rig is painted with a trailer
// in a colour nothing else on it wears, and the measurement is that colour's own extent.
//
// Matched by channel RATIO rather than by hex, because the shading scales all three together —
// the same trick the headlamp smoke uses to find a lens through the lighting.
const BOX_TINT = [240, 0, 240];
const rgbOf = (v) => { const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v); return m ? [+m[1], +m[2], +m[3]] : null; };
const isBox = (col) => {
  const v = rgbOf(col);
  if (!v || v[0] < 20) return false;
  const k = v[0] / BOX_TINT[0];
  return v[1] < 12 && Math.abs(v[2] / BOX_TINT[2] - k) < 0.06;
};
const boxOnly = (polys) => polys.filter((q) => isBox(q.col)).map((q) => q.p);
const bbox = (polys) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, x1, y0, y1];
};
const drift = (a, b) => bbox(a).reduce((m, v, i) => Math.max(m, Math.abs(v - bbox(b)[i])), 0);
// Returns one row per rig: { variant, joint, swing }.
//   joint — px between the welded silhouette and the articulated one at φ=0 (want ~0)
//   swing — px between φ=0 and φ=40 (want clearly non-zero)
export function truckArticSmoke(paintWindshield, stubCanvas, ID, variants = ['scrapper', 'hauler', 'drayman', 'continental']) {
  _setBlitEnabled(false);
  try {
    const el = stubCanvas(ID, 900, 400);
    const R = 8, N = R * 2 + 1;
    const plain = () => Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'freight', flr: 0 })));
    const out = [];
    for (const t of variants) {
      const base = { heading: 0, speed: 10, hour: 13, weather: 'clear', cls: 'truck', phase: 'ground',
        worldBlend: 1, height: 0, resFloor: 1, variant: `${t}+t`, external: true, extYaw: 0.2, extPitch: 0.3,
        extZoom: 1.1, map: plain(), mapCenter: { x: 0, y: 0 }, acX: 0, acY: 0, mapOffset: { x: 0, y: 0 },
        livery: { base: '#f2b01e', deck: '#f000f0', trim: '#f2b01e', hw: '#23262b', pattern: 'truck:none', finish: 'satin' } };
      const run = (o) => { const r = recorder(); el.getContext = () => r.ctx; paintWindshield(ID, { ...base, ...o }); return boxOnly(r.polys); };
      // `hitched: false` keeps the +t variant and skips the split — i.e. the rig as it was welded.
      const welded = run({ hitched: false });
      // …and the one-model rule, measured on the path a player actually gets.
      _setBlitEnabled(true);
      const before = rasterCount();
      run({ hitched: true, phi: 40, trailerHeading: -40 });
      const rasters = rasterCount() - before;
      _setBlitEnabled(false);
      const straight = run({ hitched: true, phi: 0, trailerHeading: 0 });
      // ⚠ AND THE BOX MUST LAG, NOT LEAD. `phi` is `heading - trailerHeading`, so a POSITIVE phi is a
      // trailer whose own heading is BEHIND the tractor's — and a renderer that reassembles that with
      // the wrong sign swings it the other way, which is a trailer steering the truck. Handing the
      // absolute heading over is what makes the sign unguessable; this is the case that proves it,
      // by driving the two apart and asking which way the box went.
      const bent = run({ hitched: true, phi: 40, trailerHeading: -40 });
      const wrongWay = run({ hitched: true, phi: 40, trailerHeading: 40 });
      // ⚠ AND THE BOX HAS ROOM TO TURN IN. Its nose is on the pin, so the front corners sweep
      // FORWARD by (half-width x sin φ) — with the plate a flat 0.10 behind the cab that reached the
      // sleeper at about twelve degrees, which is ordinary steering, and the trailer went through
      // the back of the cab. The clearance is derived from the swing now (`frameBack`), so this
      // asserts the relation rather than a number.
      const m = truckMeta(`${t}+t:1`);
      const reach = m ? m.pin + m.boxHalf * Math.sin(CLEAR_DEG * Math.PI / 180) : Infinity;
      out.push({ variant: t, clears: m ? reach <= m.cabBack : false, margin: m ? m.cabBack - reach : 0,
        joint: drift(welded, straight), swing: drift(straight, bent),
        lags: drift(bent, wrongWay) > SWING_MIN, faces: straight.length, rasters });
    }
    return out;
  } finally { _setBlitEnabled(true); }
}
