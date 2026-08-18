// Is the door art on the DOOR?
//
// A truck's door art is placed from the mesh's own published rectangle (TRUCK_META.door), which is
// stated in MODEL coordinates — the same coordinates every face in the mesh is stated in. The
// depot then draws the rig through a fit transform (`modelV` inside paintTurntable): scale the mesh
// until it fills the room, then drop it onto the floor. Every vertex of the model goes through it.
//
// The decal did not. It was handed the WORLD projector, one transform short, so the art was painted
// at the unfitted size and the unfitted height while the truck around it was four times bigger and
// standing somewhere else. It painted every frame and never once landed on the door — which is
// invisible to every check in this directory, because nothing here has ever asked WHERE a decal
// went, only whether the model ran.
//
// So this asks the one question that catches it, and asks it without re-deriving a single line of
// the transform (a test that reimplemented `modelV` would agree with a bug in `modelV`):
//
//   DRAW THE SAME TRUCK TWICE, once fitted to the room and once unfitted, from the same camera.
//   Whatever the fit does to the SILHOUETTE it must do to the DECAL. If the model quadruples and
//   the art stays the size it was, the art is not riding the model.
//
// The door tex is 56×56 and the hull-detail tex is 48×48, which is how a decal triangle is told
// apart from the panel grain going through the same texture-mapper.
import { _setBlitEnabled } from '../../client/game/js/panels/model-raster.js';
import { aircraftFaces, truckMeta } from '../../client/game/js/panels/aircraft3d.js';

const DOOR_TEX = 56;   // doorArtTex's canvas — see aircraft3d.js

function recorder() {
  const model = [], art = [];
  let cur = null;
  const grad = { addColorStop() {} };
  const sink = () => {};
  return {
    model, art,
    ctx: {
      canvas: { width: 900, height: 520 },
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      beginPath() { cur = []; },
      moveTo(x, y) { cur = [[x, y]]; },
      lineTo(x, y) { if (cur) cur.push([x, y]); },
      closePath: sink,
      fill() { if (cur && cur.length > 2) model.push(cur.slice()); },
      rect(x, y, w, h) { cur = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; },
      roundRect(x, y, w, h) { cur = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; },
      arc() { cur = null; }, ellipse() { cur = null; },
      quadraticCurveTo() { cur = null; }, bezierCurveTo() { cur = null; }, arcTo() { cur = null; },
      createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad,
      createPattern: () => null, measureText: () => ({ width: 0 }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4), width: w, height: h }),
      // acTexTri clips to the destination triangle and then blits — so the path standing when the
      // image lands IS where that piece of the decal went.
      drawImage(img) { if (img && img.width === DOOR_TEX && img.height === DOOR_TEX && cur && cur.length > 2) art.push(cur.slice()); },
      stroke: sink, fillRect: sink, strokeRect: sink, clearRect: sink, clip: sink, save: sink, restore: sink,
      translate: sink, rotate: sink, scale: sink, transform: sink, setTransform: sink, fillText: sink,
      putImageData: sink, setLineDash: sink,
      globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '', font: '', textAlign: '', textBaseline: '', lineJoin: '', lineCap: '', filter: '',
    },
  };
}

const span = (polys) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < x0 ? 0 : Math.max(x1 - x0, y1 - y0);
};
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// Returns one row per variant: { variant, cells, ratio, onSkin }.
//   cells  — decal triangles that reached the canvas (0 means the art is not being drawn at all)
//   ratio  — how the decal scaled with the fit, over how the model scaled. 1 is riding the model.
//   onSkin — every decal cell's centre landed inside some painted face of the model, i.e. the art
//            is on the truck rather than beside it.
export function truckDoorArtSmoke(drawHangarFloorBay, variants = ['scrapper', 'hauler', 'drayman', 'continental']) {
  _setBlitEnabled(false);
  try { return doorArtRun(drawHangarFloorBay, variants); }
  finally { _setBlitEnabled(true); }
}

function doorArtRun(drawHangarFloorBay, variants) {
  const out = [];
  for (const variant of variants) {
    const shot = (fit) => {
      const r = recorder();
      drawHangarFloorBay(r.ctx, {
        w: 900, h: 520, cls: 'truck', variant: `${variant}~p`, flat: true, venue: 'garage',
        // `eye` is the door art: the one design with a face in it, so a human looking at a
        // screenshot of this can see immediately whether the test is measuring the right thing.
        livery: { base: '#7d3f2a', trim: '#d8cfc0', art: 'eye', finish: 'satin' },
        yaw: 0.9, elev: 0.42, zoom: 1, fit,
      });
      return r;
    };
    const fitted = shot(2.2), plain = shot(0);
    const mR = span(plain.model) > 0 ? span(fitted.model) / span(plain.model) : 0;
    const aR = span(plain.art) > 0 ? span(fitted.art) / span(plain.art) : 0;
    const onSkin = fitted.art.length > 0 && fitted.art.every((tri) => {
      const c = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
      return fitted.model.some((poly) => inside(c, poly));
    });
    out.push({ variant, cells: fitted.art.length, ratio: mR > 0 && aR > 0 ? aR / mR : 0, onSkin });
  }
  return out;
}

// ── …AND IT MUST NOT SWITCH ITSELF OFF AS YOU WALK UP TO IT ──────────────────
// The second failure, and the one a still frame cannot show: the decal painters carried a near
// plane of their own (0.18) that was stricter than the one the model is culled at (0.15 here, 0.07
// on the road). So the last stretch of walking up to a door took the picture off it and left the
// door standing there — the artwork switching off exactly as you got close enough to read it.
//
// This walks the camera in along the door's own normal and asserts the one relationship that
// matters: THERE IS NO STANDOFF AT WHICH THE TRUCK IS STILL BEING PAINTED IN QUANTITY AND THE
// DECAL IS NOT. The face count is the yardstick rather than a distance, so if the fit transform
// this camera is aimed with ever moves, the threshold moves with it instead of going quietly
// green. `FLOOR_Z` and the fit are paintTurntable's own three lines, used only to POINT A CAMERA
// — nothing here asserts on them.
const SOLID_FACES = 300;   // 'the model is plainly still there', measured on a healthy hauler
export function doorArtCloseUpSmoke(drawHangarFloorBay, variant = 'hauler') {
  _setBlitEnabled(false);
  try {
    const V = `${variant}~p`, FIT = 2.2, FLOOR_Z = -0.27;
    const faces = aircraftFaces('truck', 1, false, V);
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const f of faces) for (const v of f.p) for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
    const mScale = FIT / Math.max(hi[0] - lo[0], hi[1] - lo[1]), mDrop = FLOOR_Z - lo[2] * mScale;
    const d = truckMeta(`${V}:1`)?.door;
    if (!d) return [{ standoff: null, faces: 0, cells: 0, bad: true }];
    const door = { f: ((d.f0 + d.f1) / 2) * mScale, g: d.g * mScale, z: ((d.z0 + d.z1) / 2) * mScale + mDrop };
    const out = [];
    for (const off of [2, 1, 0.5, 0.35, 0.25, 0.18, 0.16]) {
      const r = recorder();
      drawHangarFloorBay(r.ctx, {
        w: 900, h: 520, cls: 'truck', variant: V, flat: true, venue: 'garage', fit: FIT,
        livery: { base: '#7d3f2a', trim: '#d8cfc0', art: 'eye', finish: 'satin' },
        cam: { x: door.f, y: door.g + off, z: door.z, yaw: -Math.PI / 2, pitch: 0, fov: 1 },
      });
      out.push({ standoff: off, faces: r.model.length, cells: r.art.length, bad: r.model.length >= SOLID_FACES && !r.art.length });
    }
    return out;
  } finally { _setBlitEnabled(true); }
}
