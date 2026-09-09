// GLASS 2, STAGE ONE: THE MASS, ON THE GPU.
//
// The city's solid geometry drawn in WebGL2 into a buffer the 2-D frame BLITS, with everything else
// — lights, signage, ground, weather, contacts, the HUD — still painted over it exactly as it is
// today. That split is not a compromise reached for want of time; it is the shape the port takes,
// and it works because the seam already existed: `MASS_OFF` has always let an arm run with its mass
// suppressed and its lights intact, which is how distance LOD draws a far building's neon without
// its walls. See sceneGL for why it is a blit and not a second element on the page.
//
// ⚠ IT IS OFF BY DEFAULT AND OFF IS BYTE-IDENTICAL. `RENDER_TUNE.gl` at 0 means this module is never
// called, no canvas is created, no context is asked for. The renderer that ships is the renderer
// that shipped, and the only way to see any of this is to turn it on.
//
// ⚠ AND THE MESH IS CACHED ON THE WINDOW, NOT REBUILT PER FRAME. A city is static geometry; the
// entire argument for a vertex buffer is that it is uploaded before the first frame rather than
// during it. The cache key is the map window's own contents, so it rebuilds when the world scrolls
// to a new tile and at no other time.
//
// ⚠ WHICH IS WORTH CHECKING RATHER THAN BELIEVING. A buffer rebuilt on every frame draws exactly
// the same picture as one uploaded once, so nothing about the frame says which is happening —
// three separate things made the key move every frame before `builds` existed to say so: an
// order-sensitive key, a mesh built at the camera-relative position, and a set taken from what
// survived the camera culls. `glLastFrame().builds` is the number, and over a turning camera it
// should be 1.
import { createGLView } from './context.js';
import { buildAtlas, faceUVs } from './atlas.js';

const scenes = new Map();
// How many times the vertex buffer has been rebuilt since the page loaded. The whole argument for
// GL here is that a city is uploaded once and drawn many times, and there is no way to see from
// outside whether that is what is happening — a buffer rebuilt every frame draws exactly the same
// picture as one rebuilt once. So the pass counts, and `glLastFrame().builds` is the number.
let builds = 0;

function sceneGL(id, w, h) {
  let g = scenes.get(id);
  if (!g) { g = { canvas: null, view: null, key: '', atlasKey: '', epoch: '', atlas: null }; scenes.set(id, g); }
  // ⚠ THE GL CANVAS IS A BUFFER, NOT AN ELEMENT ON THE PAGE. Stacking it under the 2-D one is the
  // obvious arrangement and it cannot work: the 2-D pass paints the sky and the ground, opaquely,
  // over the whole frame — so a GL city underneath is drawn perfectly and covered completely, and
  // the only way to notice is to look, which the face counters do not. Put it on TOP instead and
  // the mass covers every light, sign and marquee, which are painted before it and belong in front
  // of it. Neither order is the painter's order. So it never joins the document at all: the pass
  // draws into it and the caller blits it onto the 2-D canvas at exactly the point in the frame
  // where the mass used to be queued — after the ground, before the lights.
  if (!g.canvas) {
    const cv = document.createElement('canvas');
    cv.className = 'ws-gl';
    g.canvas = cv;
  }
  if (g.canvas.width !== w || g.canvas.height !== h) {
    g.canvas.width = w; g.canvas.height = h;
    g.view = null;                    // a resized canvas loses its context state; rebuild it
    g.key = '';
  }
  if (!g.view) { g.view = createGLView(g.canvas); g.atlasKey = ''; g.key = ''; }
  return g;
}

// What the buildings in this window are, as a string. Cheap to build and exact: if two frames agree
// on it they are looking at the same city and the same buffer is correct.
//
// ⚠ IT IS SORTED, AND THAT IS NOT TIDINESS. The cells arrive in the order the painter queued them,
// which is far-to-near — so the same city seen from a heading nine degrees round arrives as the
// same set in a different order, and an order-sensitive key calls it a different city. That is a
// full mesh rebuild on every frame of every turn, which is the whole cost the buffer exists to
// avoid, and it is invisible: the picture is correct throughout.
function windowKey(cells) {
  // ⚠ bt/bn decide WHICH model this is and meshParams decides what that model was BUILT AS.
  // Both halves are needed: the first cannot see a reseeded variant, the second cannot see a
  // different building that happens to share a footprint and a height.
  const parts = cells.map((it) => it.gx + ',' + it.gy + ':' + (it.c.bt || '') + ':' + (it.c.bn || '') + ':' + meshParams(it));
  parts.sort();
  return parts.join(';');
}

// ── WHAT A BUILDING IS, CACHED ON THE BUILDING ──────────────────────────────
//
// `captureModelMesh` RUNS THE MODEL'S OWN ARM to record its faces. That is precisely the work a
// vertex buffer exists to stop doing, so doing it inside the rebuild made the rebuild the most
// expensive thing in the frame — and the rebuild is not rare, because the set of buildings in the
// window changes every time the frustum cull or the occluder pass changes its mind, which is on
// every turn of the wheel. Cached here instead, a rebuild is a walk over faces that already exist.
//
// The key is everything the capture depends on and nothing else: the model, the footprint, the
// storey height, the seed and the entrance. The camera is deliberately absent — a capture that
// varied with where you stood would not be geometry.
//
// ⚠ KEYED ON THE MODEL OBJECT'S IDENTITY, the same rule `shapeForModel` follows: the Modelshop
// makes a NEW record for every edit rather than patching one, so a WeakMap sees the edit and a
// name-keyed cache would serve the pre-edit shape for ever.
const meshCache = new WeakMap();
// EVERYTHING A TILE’S MESH IS BUILT FROM, AS ONE STRING. Two things need to agree about this and
// they used to say it separately: the per-tile mesh cache below, and `windowKey`, which decides
// whether the whole vertex buffer is stale. The buffer’s half named the tile, its type, its name
// and its floors; the mesh is built from the FOOTPRINT, the HEIGHT, the SEED and the ENTRANCE.
// ⚠ Seed is the one that bites. Twenty-three of the 173 models are seed-variant — they build
// DIFFERENT GEOMETRY for a different seed — and seed also feeds `fh` and `floorHeight`. So a tile
// whose seed changed while its type, name and floor count did not left the GPU holding the old
// building: no rebuild, because nothing in the key had moved. It then popped to the new shape at
// whatever unrelated moment next changed the key, which reads as a building that changes size at
// random while you fly. `shapeForModel(m, seed)` is also where the ground shadow’s hull comes
// from, so the same staleness shows up as a shadow that changes with it.
// ── AND A WAY TO CATCH IT IN THE ACTUAL GAME ────────────────────────────────
//
// A building that changes size while you fly past it is invisible to every gate in this repo:
// each of them renders a scene somebody wrote down, and the scenes somebody writes down are
// never the one that breaks. Three synthetic cities in a row gave a confident wrong answer
// about this pass before anybody thought to record a real flight.
//
// __glChurnStart() in the console, fly for a while, then __glChurn(). It answers the only
// question that matters here: did any building in view change what its mesh is BUILT FROM —
// its footprint, its storey height, its seed or its facing — while you were watching it. A
// building should report one set of parameters for its whole life; two means the geometry was
// rebuilt as something else, and the value it prints says which of the four moved.
//
// ⚠ IT KEYS ON THE BUILDING’S NAME, which is exact in Coldwater (408 of the 416 building tiles
// carry one and they do not repeat) and WRONG in a synthetic city that puts the same model on
// forty tiles — there each tile has its own seed, so one name honestly reports forty builds. If
// you are reading this against a generated map rather than the world, that is what the number is.
//
// ⚠ Off by default and it costs nothing when off: the recording walk is behind a null check,
// and nothing allocates until somebody asks.
let CHURN = null;
if (typeof window !== 'undefined') {
  window.__glChurnStart = () => { CHURN = new Map(); return String.fromCharCode(114) + "ecording — fly for a bit, then call __glChurn()"; };
  window.__glChurn = () => {
    if (!CHURN) return "not recording — call __glChurnStart() first";
    const rows = [];
    for (const [name, set] of CHURN) if (set.size > 1) rows.push({ building: name, builtAs: set.size, saw: [...set] });
    rows.sort((a, b) => b.builtAs - a.builtAs);
    const seen = CHURN.size; CHURN = null;
    const note = "each row is one building that was built more than one way; in the real world a"
      + " name is one tile, so anything above 1 is the bug. On a generated map repeats are normal.";
    return rows.length ? { changed: rows.length, of: seen, note, rows }
      : { changed: 0, of: seen, note: "no building changed its footprint, height, seed or facing" };
  };
}
const meshParams = (it) => it.fh + ':' + it.h + ':' + it.seed + ':' + it.E[0] + ',' + it.E[1];

function tileMesh(deps, it) {
  let byParam = meshCache.get(it.m);
  if (!byParam) { byParam = new Map(); meshCache.set(it.m, byParam); }
  const k = meshParams(it);
  let faces = byParam.get(k);
  if (!faces) {
    let mesh;
    try { mesh = deps.captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E }); } catch { mesh = []; }
    faces = mesh.map((f) => ({
      ...f,
      rgb: f.rgbOverride || deps.palette.get(f.pal) || [120, 126, 134],
      uv: faceUVs(f),
      texKey: f.pal ? (f.kind === 'roof' ? 'r:' : 'w:') + f.pal : null,
    }));
    byParam.set(k, faces);
  }
  return faces;
}

// `cells` is [{ gx, gy, c, m, fh, h, seed, E }] — what drawWorldObjects already resolved for each
// building tile, handed over rather than recomputed, so the two renderers cannot disagree about
// which building stands where. `gx`/`gy` are the tile's place in the MAP WINDOW, which holds still
// while you drive across it; where the camera is standing inside that tile is a camera fact and is
// applied below.
export function glWorldPass(id, host, cells, cam, deps, opts = {}) {
  const W = host.width, H = host.height;
  // ⚠ THE CANVAS IS IN DEVICE PIXELS AND THE CAMERA IS IN CSS PIXELS, AND THE MATRIX NEEDS THE
  // CAMERA'S UNITS. `host.width/height` is the backing store; `cam.horizonY` and `cam.depth` come
  // from `makeCam`, which works in the CSS pixels the 2-D context is transformed into. In
  // `projMatrix` the x row is `2·FL / cam.W` — CSS over CSS, right by accident of both coming off
  // the camera — while the y row is `2·depth / H` and `1 − 2·horizonY / H`, CSS over DEVICE. So
  // the vertical axis was scaled by 1/dpr and the horizon put in the wrong place while the
  // horizontal stayed correct: the city squashed against a ground drawn from the real camera.
  // ⚠ AND IT IS EXACTLY INVISIBLE AT dpr 1, which is every synthetic canvas a test builds.
  // The VIEWPORT stays in device pixels — that mapping is resolution-independent and correct.
  const dpr = cam && cam.W ? W / cam.W : 1;
  // Handed over by the caller when it knows (the sim always does); derived only for a caller that
  // does not, where the rounding of a device-pixel canvas costs a fraction of a pixel.
  const cssH = opts.cssH || (dpr > 0 ? H / dpr : H);
  if (!W || !H) return null;
  const g = sceneGL(id, W, H);
  // No WebGL2 on this machine, or the driver took the context away. Either way the pass draws
  // nothing and must SAY so — the caller has already suppressed the 2-D mass on the strength of
  // this pass existing. The scene is dropped so a restored context rebuilds from scratch.
  if (!g.view) { scenes.delete(id); return null; }
  if (g.view.lost && g.view.lost()) { scenes.delete(id); return null; }

  const key = windowKey(cells);
  if (CHURN) for (const it of cells) {
    const n = it.c.bn || it.c.bt || '?';
    let set = CHURN.get(n); if (!set) CHURN.set(n, set = new Set());
    set.add(meshParams(it));
  }
  // The baked textures the atlas is a COPY of, as they stand this frame. Nothing about the city
  // has to change for them to: crossing a dusk step redraws every wall canvas in place.
  const epoch = deps.texEpoch ? deps.texEpoch(opts.nb || 0) : '';
  if (key !== g.key || epoch !== g.epoch) {
    // ⚠ THE PLACED MESH IS NEVER MATERIALISED. A tile is its shared face list plus where it stands,
    // handed over as a group; the offset is added on the way into the vertex data. Copying every
    // face to move it allocated an array per face and a point per vertex, per rebuild, for nothing.
    const groups = [];
    const need = new Set();
    let nFaces = 0;
    for (const it of cells) {
      const faces = tileMesh(deps, it);
      for (const f of faces) if (f.texKey) need.add(f.texKey);
      groups.push({ ox: it.gx, oy: it.gy, jit: it.jit || 0, faces });
      nFaces += faces.length;
    }
    // The atlas is rebuilt on the SET OF SURFACES, not on the set of buildings. Driving down a
    // street changes which buildings are in the window constantly and what they are MADE of almost
    // never, and repacking a texture page is the one part of this that touches the GPU.
    const akey = [...need].sort().join('|') + '@' + epoch;
    if (akey !== g.atlasKey) {
      const { wallTexMixed, roofTex } = deps;
      const tiles = [];
      for (const tk of need) {
        const roof = tk[0] === 'r';
        const canvas = roof ? roofTex(tk.slice(2), opts.night || 0) : wallTexMixed(tk.slice(2), opts.nb || 0);
        if (canvas && canvas.width) tiles.push({ key: tk, canvas });
      }
      g.atlas = buildAtlas(tiles, g.view.maxTexture || 2048);
      // A page the device cannot hold is refused rather than uploaded, and the fragment shader
      // already knows what to do without one: flat palette colours. Said once per scene, because a
      // per-frame warning about a permanent property of the machine is noise.
      if (!g.atlas && !g.warnedAtlas) { g.warnedAtlas = true; console.warn(`[glass2] the texture atlas for ${tiles.length} surfaces does not fit this device (max ${g.view.maxTexture}) — drawing flat colours`); }
      g.view.setAtlas(g.atlas ? g.atlas.canvas : null);
      g.atlasKey = akey;
    }
    // Resolved per face at fill time rather than written onto it: the face objects are SHARED between
    // every tile of that building and between scenes, and two scenes can hold two atlases.
    g.view.uploadGroups(groups, (f) => (g.atlas && f.texKey ? g.atlas.rect.get(f.texKey) : null));
    builds++;
    g.key = key;
    g.epoch = epoch;
    g.faces = nFaces;
  }

  // The sub-tile offset the mesh does not carry. `fx`/`fy` are already the "subtract this from the
  // world position" terms the chase camera uses, so the shift needs no new matrix and no new code in
  // camera.js — which matters, because that file is the one the parity gate holds still.
  const camAt = (cam.ox || cam.oy)
    ? { ...cam, fx: (cam.fx || 0) + cam.ox, fy: (cam.fy || 0) + cam.oy }
    : cam;
  g.view.draw(camAt, { ...(opts.draw || {}), cssH });
  // ⚠ AFTER THE MASS, AND THAT IS NOT AN ORDERING PREFERENCE. `draw()` OPENS with
  // gl.clear(COLOR | DEPTH) — so a floor drawn before it is drawn and then wiped, every frame.
  // It cost an afternoon: the result looked like a floor (the backstop wash showed through the
  // cleared canvas), it was smoothly graded and uniformly dark, and it ignored a debug uniform
  // wired straight into its own fragment output, which is what finally gave it away.
  //
  // Drawing it after costs nothing, because the floor WRITES depth and TESTS it: where a building
  // is nearer the floor loses the fragment, which is the same picture the other order would have
  // given if the clear had not been in the way.
  const floor = g.view.drawFloor(opts.floor);
  // ⚠ AFTER THE FLOOR AND IN THE WINDOW FRAME. The road quads are recorded at their map-window
  // tile exactly as the mesh is, so they take the SHIFTED camera; handing them the plain one
  // would slide the kerbs a fraction of a tile off the buildings standing on them. They also
  // stand ON the floor rather than being it — see the eps ladder in windshield.js.
  const ground = g.view.drawGround(camAt, opts.ground, cssH, {
    // No haze band: the per-quad alpha already carries drawGroundSurfaces own far fade, and
    // applying the window dissolve on top would fade the road twice.
    fog: opts.fogBand,
  });
  // ⚠ THE LIGHTS ARE IN THE CAMERA'S OWN FRAME, NOT THE WINDOW'S. The mesh is built at map-window
  // tiles so it can be cached; a light is collected fresh every frame from the arm that owns it,
  // in the camera-relative coordinates the arm works in. So it takes the plain camera, and the
  // shifted one exists only for the buffer that needed shifting.
  const lights = g.view.drawSprites(cam, opts.sprites, cssH);
  // ⚠ AFTER THE MASS, ALWAYS. It is depth-TESTED and writes none of its own, so the buildings
  // have to be in the buffer before it is asked what stands in front of it.
  const curtains = g.view.drawCurtain(cam, opts.curtain, cssH, opts.now);
  const decals = g.view.drawDecals(cam, opts.decals, cssH);
  // The scatter carries the renderer own fog curve, because the 2-D drawers tint by fogTint at
  // the anchor depth and a billboard that did not would be a different bush at every distance.
  const scatter = g.view.drawBillboards(cam, opts.scatter, cssH, opts.fogBand);
  return { faces: g.faces || 0, builds, lights, curtains, decals, scatter, ground, floor, canvas: g.canvas };
}

