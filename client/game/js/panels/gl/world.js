// GLASS 2, STAGE ONE: THE MASS, ON THE GPU.
//
// The city's solid geometry drawn in WebGL2 under the 2-D canvas, with everything else — lights,
// signage, ground, weather, contacts, the HUD — still painted on top exactly as it is today. That
// split is not a compromise reached for want of time; it is the shape the port takes, and it works
// because the seam already existed: `MASS_OFF` has always let an arm run with its mass suppressed
// and its lights intact, which is how distance LOD draws a far building's neon without its walls.
//
// ⚠ IT IS OFF BY DEFAULT AND OFF IS BYTE-IDENTICAL. `RENDER_TUNE.gl` at 0 means this module is never
// called, no canvas is created, no context is asked for. The renderer that ships is the renderer
// that shipped, and the only way to see any of this is to turn it on.
//
// ⚠ AND THE MESH IS CACHED ON THE WINDOW, NOT REBUILT PER FRAME. A city is static geometry; the
// entire argument for a vertex buffer is that it is uploaded before the first frame rather than
// during it. The cache key is the map window's own contents, so it rebuilds when the world scrolls
// to a new tile and at no other time.
import { createGLView } from './context.js';
import { buildAtlas, faceUVs } from './atlas.js';

const scenes = new Map();

function sceneGL(id, host, w, h) {
  let g = scenes.get(id);
  if (!g) { g = { canvas: null, view: null, key: '', atlasKey: '' }; scenes.set(id, g); }
  // ⚠ A CACHED CANVAS THAT LEFT THE DOCUMENT IS NOT A CACHED CANVAS. The store is keyed on the
  // scene id, and a panel that is torn down and rebuilt — which is every time a view closes and
  // reopens — leaves a detached element behind that draws into nothing anybody can see. It reads
  // exactly like the GL pass silently doing nothing, which is how it was found.
  if (g.canvas && !g.canvas.isConnected) { g.canvas = null; g.view = null; g.key = ''; }
  if (!g.canvas) {
    const cv = document.createElement('canvas');
    cv.className = 'ws-gl';
    // Underneath the 2-D canvas, exactly filling it. A canvas holds one context for its whole life,
    // so the two renderers can never share an element — which is the same arrangement a finished
    // port would have anyway: GL for the world, 2-D over the top for the HUD.
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    if (host && host.parentNode) host.parentNode.insertBefore(cv, host);
    g.canvas = cv;
  }
  if (g.canvas.width !== w || g.canvas.height !== h) {
    g.canvas.width = w; g.canvas.height = h;
    g.view = null;                    // a resized canvas loses its context state; rebuild it
    g.key = '';
  }
  if (!g.view) { g.view = createGLView(g.canvas); g.atlasKey = ''; }
  return g;
}

// What the buildings in this window are, as a string. Cheap to build and exact: if two frames agree
// on it they are looking at the same city and the same buffer is correct.
function windowKey(cells) {
  let k = '';
  for (const it of cells) k += it.dx + ',' + it.dy + ':' + (it.c.bt || '') + ':' + (it.c.bn || '') + ':' + (it.c.flr || 0) + ';';
  return k;
}

// `cells` is [{ dx, dy, c, fh, h, seed, E }] — what drawWorldObjects already resolved for each
// building tile, handed over rather than recomputed, so the two renderers cannot disagree about
// which building stands where.
export function glWorldPass(id, host, cells, cam, deps, opts = {}) {
  const W = host.width, H = host.height;
  if (!W || !H) return null;
  const g = sceneGL(id, host, W, H);
  if (!g.view) return null;

  const key = windowKey(cells);
  if (key !== g.key) {
    const { captureModelMesh, wallTexMixed, roofTex, palette } = deps;
    const faces = [];
    const tiles = new Map();
    for (const it of cells) {
      let mesh;
      try { mesh = captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E }); } catch { continue; }
      for (const f of mesh) {
        const roof = f.kind === 'roof';
        const tk = f.pal ? (roof ? 'r:' : 'w:') + f.pal : null;
        if (tk && !tiles.has(tk)) {
          const canvas = roof ? roofTex(f.pal, opts.night || 0) : wallTexMixed(f.pal, opts.nb || 0);
          if (canvas && canvas.width) tiles.set(tk, { key: tk, canvas });
        }
        faces.push({
          ...f,
          rgb: f.rgbOverride || palette.get(f.pal) || [120, 126, 134],
          uv: faceUVs(f),
          texKey: tk,
          p: f.p.map((p) => [p[0] + it.dx, p[1] + it.dy, p[2]]),
        });
      }
    }
    const atlas = buildAtlas([...tiles.values()]);
    for (const f of faces) f.rect = atlas && f.texKey ? atlas.rect.get(f.texKey) : null;
    if (atlas) g.view.setAtlas(atlas.canvas);
    g.view.upload(faces);
    g.key = key;
    g.faces = faces.length;
  }

  g.view.draw(cam, opts.draw || {});
  return { faces: g.faces || 0, canvas: g.canvas };
}

export function glWorldHide(id) {
  const g = scenes.get(id);
  if (g && g.canvas) g.canvas.style.display = 'none';
}
export function glWorldShow(id) {
  const g = scenes.get(id);
  if (g && g.canvas) g.canvas.style.display = '';
}
