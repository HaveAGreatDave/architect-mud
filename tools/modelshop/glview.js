// THE GL SPIKE, SEEN SIDE BY SIDE WITH THE RENDERER IT WOULD REPLACE.
//
// The Modelshop is the honest place to look at it: the same page already holds GLASS's own picture
// of the same model at the same camera, so "does it draw the same building" is a question you answer
// by pressing a key rather than by remembering what the other one looked like.
//
// What it proves and what it does not. It proves the camera (already gated numerically by
// glparity), the mesh (gated by glmesh), the depth buffer, and that the whole path runs on a real
// GPU. It proves nothing about cost at city scale — one building is not a skyline — and nothing
// about textures, adornments, ground or weather, none of which the spike draws.
//
// ⚠ THE GL CANVAS IS A SIBLING, NOT A REPLACEMENT. It sits over the 2-D one and is hidden unless
// asked for. A canvas can hold one context for its whole life, so the two renderers can never share
// an element — which is exactly the shape a real port would take: GL underneath for the world, 2-D
// on top for the HUD.
import { createGLView } from '/client/game/js/panels/gl/context.js';
import { captureModelMesh, wallPaletteInfo } from '/client/game/js/panels/windshield.js';

let view = null, canvas = null, palette = null;

function paletteMap() {
  if (palette) return palette;
  palette = new Map();
  for (const p of wallPaletteInfo()) palette.set(p.key, p.rgb);
  return palette;
}

function ensureCanvas(host) {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.id = 'glview';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.hidden = true;
  host.append(canvas);
  return canvas;
}

// The colour a face would be painted. GLASS derives colour AND material from one palette key; the
// spike takes the colour and leaves the material for later, which is why a GL building reads as the
// right building in the wrong finish — flat where the 2-D one is brick.
function colourise(faces) {
  const pal = paletteMap();
  return faces.map((f) => ({ ...f, rgb: pal.get(f.pal) || [120, 126, 134] }));
}

export function glAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

// Draw `m` at the same camera the 2-D viewport is using. `cam` is the object renderModelPreview
// returned, so the two pictures cannot be at different cameras by construction.
// ⚠ WHAT ARRIVES IS THE PREVIEW RESULT, NOT THE CAMERA. renderModelPreview returns
// { cam, dx, dy, horizonY } — a wrapper — and reading FL off that gives undefined, which makes a
// matrix of NaN, which draws nothing and reports no error at all. The GL canvas cleared to sky and
// stayed empty, which looks exactly like a shader problem and is not one.
export function glDraw(host, m, res, opts = {}) {
  const cam = res && res.cam ? res.cam : res;
  const cv = ensureCanvas(host);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; view = null; }
  cv.hidden = false;
  if (!view) view = createGLView(cv);
  if (!view) return { error: 'no webgl2 context' };
  // ⚠ AND THE MESH IS MODEL-LOCAL. captureModelMesh centres the building on the origin, which is
  // where the camera is standing — so an untranslated mesh is drawn from inside itself and the
  // frame comes back empty. `dx`/`dy` off the preview result are where the 2-D pass put it, and
  // using those is what keeps the two pictures at one place as well as at one camera.
  const ox = res && res.dx || 0, oy = res && res.dy || 0;
  const mesh = colourise(captureModelMesh(m, opts.mesh || {}))
    .map((f) => ({ ...f, p: f.p.map((p) => [p[0] + ox, p[1] + oy, p[2]]) }));
  view.upload(mesh);
  // ⚠ The camera arrives sized for the 2-D canvas. Its focal lengths are in PIXELS of that canvas,
  // so a GL canvas at a different backing scale needs them scaled to match or the two pictures are
  // the same view at two zooms — which would look exactly like a camera bug.
  const k = cv.width / Math.max(1, cam.W);
  const scaled = { ...cam, W: cv.width, FL: cam.FL * k, depth: cam.depth * k, horizonY: cam.horizonY * k };
  const tris = view.draw(scaled, opts.draw || {});
  return { faces: mesh.length, triangles: tris / 3 };
}

export function glHide() { if (canvas) canvas.hidden = true; }
export function glShown() { return !!canvas && !canvas.hidden; }
