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
import { buildAtlas, faceUVs } from '/client/game/js/panels/gl/atlas.js';
import { captureModelMesh, wallPaletteInfo, wallTexMixed, roofTex, glLightState } from '/client/game/js/panels/windshield.js';

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

// The surface a face would be painted with. GLASS derives colour AND material from one palette
// key — `wallTexMixed` for a wall, `roofTex` for a roof, both already baked and cached — so the
// GL path asks for exactly those canvases and packs them into one atlas. Nothing here draws a
// texture; it collects the ones the renderer has already made.
//
// ⚠ ROOFS COME FROM A DIFFERENT GENERATOR, and asking only for the wall gives every roof in the
// city the generic gravel tile — which is the face a flight sim spends the whole flight looking
// down at. Both are keyed here, and the key carries which one it is.
function surfaced(faces, night) {
  const pal = paletteMap();
  const NB = Math.max(0, Math.min(1, (night - 0.30) / 0.20));
  const tiles = new Map();
  const keyed = faces.map((f) => {
    const roof = f.kind === 'roof';
    const key = (roof ? 'r:' : 'w:') + f.pal;
    if (f.pal && !tiles.has(key)) {
      const canvas = roof ? roofTex(f.pal, night) : wallTexMixed(f.pal, NB);
      if (canvas && canvas.width) tiles.set(key, { key, canvas });
    }
    return { ...f, texKey: f.pal ? key : null, rgb: f.rgbOverride || pal.get(f.pal) || [120, 126, 134], uv: faceUVs(f) };
  });
  const atlas = buildAtlas([...tiles.values()]);
  for (const f of keyed) f.rect = atlas && f.texKey ? atlas.rect.get(f.texKey) : null;
  return { faces: keyed, atlas };
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
  const built = surfaced(captureModelMesh(m, opts.mesh || {}), (opts.mesh && opts.mesh.night) || 0);
  const mesh = built.faces.map((f) => ({ ...f, p: f.p.map((p) => [p[0] + ox, p[1] + oy, p[2]]) }));
  if (built.atlas) view.setAtlas(built.atlas.canvas);
  view.upload(mesh);
  // ⚠ The camera arrives sized for the 2-D canvas. Its focal lengths are in PIXELS of that canvas,
  // so a GL canvas at a different backing scale needs them scaled to match or the two pictures are
  // the same view at two zooms — which would look exactly like a camera bug.
  const k = cv.width / Math.max(1, cam.W);
  const scaled = { ...cam, W: cv.width, FL: cam.FL * k, depth: cam.depth * k, horizonY: cam.horizonY * k };
  // The light the sim would arm, asked for rather than guessed at — see glLightState.
  const L = glLightState((opts.mesh && opts.mesh.night) || 0);
  const u = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
  const tris = view.draw(scaled, {
    key: u(L.key), shadow: u(L.shadow), skyTint: u(L.sky), str: L.str,
    keyDir: [L.dir[0], L.dir[1], 0.35],
    ...(opts.draw || {}),
  });
  return { faces: mesh.length, triangles: tris / 3, tiles: built.atlas ? built.atlas.count : 0,
    atlas: built.atlas ? built.atlas.size.join("x") : null };
}

export function glHide() { if (canvas) canvas.hidden = true; }
export function glShown() { return !!canvas && !canvas.hidden; }
