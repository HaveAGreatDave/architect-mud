// ── A DEPTH BUFFER, FOR ONE MODEL ────────────────────────────────────────────
//
// Every ordering bug this codebase has had on a truck comes from the same place: painter's
// algorithm draws whole PARTS in some order, and a pile of small boxes has no correct order. A big
// panel can be behind a small one over here and in front of it over there, and no single number per
// part can say so. Mean depth, nearest vertex, ground-plane depth, distance-to-box — four keys,
// each of which fixed the case in front of it and left the class alone, because the algorithm is
// what is wrong rather than the key.
//
// So this stops sorting and starts asking per PIXEL. For each pixel the model covers, whichever
// face is genuinely nearest wins. That is exact from every angle, including straight down, and
// there is nothing left to flicker: depth is continuous, so a camera nudge moves an edge by a
// pixel rather than swapping which of two parts is visible.
//
// ⚠ THIS IS FOR ONE MODEL, NOT THE WORLD. A depth buffer over the whole frame — thousands of
// buildings, full screen, every frame — is exactly the cost that made canvas the right choice here
// in the first place. A truck is one object a few hundred pixels across with a few hundred faces
// after culling, which is a thing 1996 hardware did with room to spare. Keep it that way: if this
// is ever pointed at the city, the sim stops being 60fps.
//
// ── …AND THE HALF OF THAT RULE THAT IS ABOUT WHAT THE MODEL IS STANDING BEHIND ─
//
// `rasterDepth` below is the second half of the same idea and obeys the same limit. A truck sorted
// perfectly against ITSELF still painted straight through the shed it was parked in, because the
// world it stands in was never in any depth buffer: buildings are canvas fills, the model is
// painted after them, and paint order is the only answer there has ever been. What the world pass
// DOES have is a handful of conservative solid boxes per building, and those are cheap enough to
// rasterise — depth only, no colour, no shading — into a window the size of the model.
//
// So the rule stands and gets sharper: never rasterise the CITY, only ever rasterise the few solids
// that overlap ONE model's own screen box. Standing in the open that is zero boxes and costs
// nothing; standing in a doorway it is one, and one is what the whole complaint was about.

// Depth-only targets are owned by the CALLER, not by this module. Two live at once in the
// windshield — the frame-wide coarse field and the per-model window — and a single shared scratch
// would have the second overwrite the first halfway through the frame.
export function depthTarget() { return { w: 0, h: 0, d: null }; }

// The same window `rasterFaces` produces, with no colour in it. `quads` are `{ pts: [{x,y,z}] }` in
// the caller's screen units; the result is sampled by `maskRaster` and `depthWinAt`.
//
// ⚠ ONE INTERPOLATOR, SHARED WITH THE COLOUR PATH. The 1/z rule below is the whole correctness of
// this file and a second copy of it here would be a second chance to write it in z.
//
// ⚠ `accumulate` IS NOT AN OPTIMISATION. The occlusion pre-pass walks buildings NEAR→FAR and asks,
// for each one, whether everything already in the buffer hides it — so the buffer has to be filled
// a building at a time with the answers read between calls. Gathering every quad and rasterising
// once would have each building tested against a field that already contains ITSELF, and every
// building in the world would report as hidden behind itself.
//
// ⚠ AND `scale` IS OPTIONAL IN FRONT OF IT, WHICH IS A TRAP WORTH DISARMING. `(…, w, h, true)`
// reads perfectly and means `scale = true` — which coerces to 1, so the buffer comes out the right
// size and the accumulate flag is silently lost. The failure that produces is a field cleared
// between every building, which is not a crash and not visibly wrong in any one frame. A boolean in
// the scale slot can only ever be that mistake, so it is taken as what it obviously means.
export function rasterDepth(target, quads, x0, y0, w, h, scale = 1, accumulate = false) {
  if (typeof scale === 'boolean') { accumulate = scale; scale = 1; }
  w = Math.ceil(w * scale); h = Math.ceil(h * scale);
  if (w <= 0 || h <= 0 || w * h > 4_000_000) return null;
  if (!target.d || target.w < w || target.h < h) {
    target.w = Math.max(w, target.w); target.h = Math.max(h, target.h);
    target.d = new Float32Array(target.w * target.h);
    accumulate = false;                                  // a fresh (or regrown) buffer holds nothing
  }
  const { d } = target, stride = target.w;
  if (!accumulate) for (let y = 0; y < h; y++) { const row = y * stride; d.fill(Infinity, row, row + w); }
  let drew = 0;
  for (const q of quads) {
    const p = q.pts || q;
    if (!p || p.length < 3) continue;
    for (let t = 1; t + 1 < p.length; t++) {
      tri(d, null, stride, w, h,
        (p[0].x - x0) * scale, (p[0].y - y0) * scale, p[0].z,
        (p[t].x - x0) * scale, (p[t].y - y0) * scale, p[t].z,
        (p[t + 1].x - x0) * scale, (p[t + 1].y - y0) * scale, p[t + 1].z,
        0, 0, 0, 0);
    }
    drew++;
  }
  return (drew || !accumulate) ? { buf: target, w, h, scale, x0, y0 } : null;
}

// The depth at one cell of a depth window — Infinity where nothing was drawn, which is "open sky"
// and never occludes anything.
export function depthWinAt(win, x, y) {
  if (!win || x < 0 || y < 0 || x >= win.w || y >= win.h) return Infinity;
  return win.buf.d[y * win.buf.w + x];
}

// ── THE TWO BUFFERS MEET HERE ────────────────────────────────────────────────
// `res` is a model straight out of `rasterFaces`; `win` is the world's solids rasterised over the
// SAME pixel box at the SAME scale. Any model pixel the world is genuinely in front of has its
// alpha cleared, so the blit that follows lands a model with a building-shaped bite out of it —
// per pixel, from every angle, with no ordering left to get wrong.
//
// `bias` is in the caller's depth units and exists for one case only: a model resting against a
// wall it is not behind. Without it the two surfaces trade pixels along the contact and the truck
// dissolves into the shed it is parked in.
export function maskRaster(res, win, bias = 0) {
  if (!res || !win) return 0;
  const { buf, w, h } = res;
  const stride = buf.w, { depth, rgba } = buf;
  let cut = 0;
  for (let y = 0; y < h; y++) {
    const row = y * stride, wrow = y * win.buf.w;
    for (let x = 0; x < w; x++) {
      const di = row + x;
      if (rgba[di * 4 + 3] === 0) continue;
      const wz = win.buf.d[wrow + x];
      if (wz + bias < depth[di]) { rgba[di * 4 + 3] = 0; cut++; }
    }
  }
  return cut;
}
//
// The buffer is allocated to the model's own screen box, not the canvas, so cost tracks how big the
// truck actually is. Distant contacts are a few pixels wide and are deliberately left on the sort —
// they are too small for anybody to see an ordering mistake in, and too numerous to pay for.

// Reused across frames so a steady camera allocates nothing. Grown, never shrunk: a buffer that
// re-allocates when the truck gets one pixel bigger is a buffer that re-allocates every frame you
// are moving, which is the whole cost this is trying to avoid.
let _buf = null;
// The G-buffer is 16 bytes a pixel on top of the 8 the colour/depth pair already costs, so the
// lighting gives way well before `rasterFaces`' own 4M-pixel ceiling. See the ⚠ at the assignment
// for why losing it is graceful rather than a black model.
const LIT_MAX_PX = 1_600_000;

// ── HOW MANY MODELS WENT THROUGH THE DEPTH TEST ──────────────────────────────
// Not instrumentation: a test seam, and it exists because of the specific way this bug keeps
// coming back. The truck mesh has four renderers, and three separate times a fix for it was
// written, verified in ONE of them, and left the other three on the old path — most recently this
// very file, which landed in the depot walkaround while the chase camera the rig is actually
// driven from went on sorting. Nothing failed; the work simply had no effect where it was wanted.
// A counter makes "this renderer is on the depth path" a thing a smoke can assert rather than a
// thing somebody has to remember, so the next renderer that quietly falls off it says so.
let _rasterCount = 0;
export const rasterCount = () => _rasterCount;
// …and the same seam for the light pass, for exactly the same reason. The lighting can only ever
// darken or add, so a renderer that quietly stops calling it renders a picture that is still
// correct, still lit and simply has no shadow in it — the failure is INVISIBLE unless somebody
// happens to be looking at a truck in sunlight beside a wall. A counter makes "this renderer is
// still on the light path" a thing a smoke can assert.
let _shadeCount = 0;
export const shadeCount = () => _shadeCount;

// ── AND THE TWO EXTRA CHANNELS THE LIGHTING NEEDS ────────────────────────────
// `wp` is the world position of whatever won each pixel and `fi` is which face it was. Together
// they are a G-buffer, and they are here rather than in a shading step inside `tri` for one
// reason: a truck is a pile of boxes, so the same pixel is written several times over and only the
// last write survives. Shading inside the triangle loop pays for every one of those losers. Filling
// two cheap channels and shading the WINNERS in a straight linear walk afterwards pays once.
//
// ⚠ ALLOCATED ONLY WHEN SOMETHING ASKS TO BE LIT, AND NEVER GIVEN BACK. 16 bytes a pixel on top of
// the 8 already here is real memory at the top of the budget, so an unlit caller (a thumbnail, a
// contact across a yard) allocates none of it — but once one caller has asked, the arrays stay,
// because a buffer that frees them the moment a small model goes through is a buffer that
// re-allocates twenty megabytes on alternating frames.
function ensure(w, h, lit = false) {
  const old = _buf;
  const grow = !old || old.w < w || old.h < h;
  const wantG = lit || !!(old && old.wp);
  if (!grow && (!wantG || old.wp)) return old;
  const W = grow ? Math.max(w, old ? old.w : 0) : old.w;
  const H = grow ? Math.max(h, old ? old.h : 0) : old.h;
  _buf = {
    w: W, h: H,
    depth: grow ? new Float32Array(W * H) : old.depth,
    rgba: grow ? new Uint8ClampedArray(W * H * 4) : old.rgba,
    wp: wantG ? new Float32Array(W * H * 3) : null,
    fi: wantG ? new Int32Array(W * H) : null,
  };
  return _buf;
}

// `faces` are draw records: { pts: [{x, y, z}], r, g, b, a }. Screen coordinates in DEVICE pixels
// relative to (x0, y0); `z` is any monotonic camera distance where SMALLER IS NEARER.
//
// Returns null when there is nothing to draw or the box is degenerate, so the caller can fall
// through to whatever it did before rather than blitting an empty rectangle over the scene.
export function rasterFaces(faces, x0, y0, w, h, scale = 1, lit = false) {
  w = Math.ceil(w * scale); h = Math.ceil(h * scale);
  if (!faces.length || w <= 0 || h <= 0 || w * h > 4_000_000) return null;
  // ⚠ THE LIGHTING HAS ITS OWN, LOWER CEILING, AND LOSING IT IS GRACEFUL RATHER THAN A DARK MODEL.
  // `shadeRaster` can only ever darken (shadow) or add (lamps) — the flat shade already in `rgba`
  // is the correct, complete, unshadowed picture — so a model dollied until it blows this budget
  // simply loses its shadow and its lamp spill, exactly the way it loses its supersample at the
  // caller's own pixel budget. Nothing has to be recomputed by the caller and nothing goes black.
  lit = lit && w * h <= LIT_MAX_PX && faces.every(f => f.w && f.n);
  const buf = ensure(w, h, lit);
  const { depth, rgba } = buf;
  const G = lit ? buf : null;
  const stride = buf.w;
  // Clear only the window we are about to use. Clearing the whole grown buffer would make a big
  // truck earlier in the session cost a small one later.
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    depth.fill(Infinity, row, row + w);
    rgba.fill(0, (row) * 4, (row + w) * 4);
  }

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const p = f.pts;
    if (p.length < 3) continue;
    // ⚠ THE WORLD VERTICES ARE FANNED WITH THE SCREEN ONES, INDEX FOR INDEX. `f.w` is the same
    // polygon in world 3-space, and the whole G-buffer is wrong by a face if the two ever get out
    // of step — which is why the `lit` test above demands `f.w` on EVERY face rather than checking
    // per face here: a mesh half of which carried world coords would light half a truck.
    const FW = G ? f.w : null;
    // Fan the convex polygon into triangles. Every face in these meshes is a convex quad or a
    // triangle, so a fan is exact — no ear clipping and no winding to keep track of.
    for (let t = 1; t + 1 < p.length; t++) {
      tri(depth, rgba, stride, w, h,
        (p[0].x - x0) * scale, (p[0].y - y0) * scale, p[0].z,
        (p[t].x - x0) * scale, (p[t].y - y0) * scale, p[t].z,
        (p[t + 1].x - x0) * scale, (p[t + 1].y - y0) * scale, p[t + 1].z,
        f.r, f.g, f.b, f.a === undefined ? 255 : f.a,
        G, fi, FW && FW[0], FW && FW[t], FW && FW[t + 1]);
    }
  }
  // ⚠ `scale` RIDES HOME WITH THE RESULT, because the blit is the only thing that can undo it. The
  // buffer is `scale`× the caller's coordinate box, so drawing it back at w×h would paint a truck
  // twice the size in the wrong place. `blitRaster` divides it out; `depthAt` and `readPixels` work
  // in buffer pixels and are unaffected. A caller that passes no scale gets exactly what it got.
  _rasterCount++;
  return { buf, w, h, scale, lit };
}

// One triangle, depth-tested per pixel.
//
// ⚠ DEPTH IS INTERPOLATED AS 1/z, NOT z. Screen space is a perspective projection, so z is not
// linear across a triangle and 1/z is — interpolating z directly bows every surface toward the
// camera in the middle of a face, which on two nearly-coplanar panels is exactly enough to make the
// far one win a strip through the middle of the near one. That is the same see-through artefact
// this file exists to end, reintroduced one level down.
// ⚠ AND THE PARAMETER LIST IS FLAT SCALARS ON PURPOSE. Grouping these into three vertex objects
// reads far better and allocates three objects per TRIANGLE — and `rasterDepth` runs this over
// every solid in the city on the occlusion pre-pass, thousands of times a frame. The arrays that
// ARE passed (`wa`/`wb`/`wc`) are the caller's own existing world vertices, never new ones.
//
// ⚠ `linear` INTERPOLATES z DIRECTLY, AND IT IS NOT A RELAXATION OF THE RULE ABOVE — it is that
// rule applied to a different projection. The 1/z law holds because SCREEN space is a perspective
// projection. The shadow pass is ORTHOGRAPHIC (the sun is directional; its rays are parallel), and
// under an orthographic projection z genuinely is linear across a triangle — so interpolating 1/z
// there is the mistake rather than the fix, and it bows every caster toward the light through the
// middle of each face, which is shadow acne in a stripe. Use it for the sun and for nothing else.
function tri(depth, rgba, stride, W, H, ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b, a,
             G = null, fidx = 0, wa = null, wb = null, wc = null, linear = false) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minX > maxX || minY > maxY) return;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;                 // edge-on: no pixels, and a divide by zero
  const inv = 1 / area;
  // 1/z at each vertex. A vertex behind or at the eye cannot be interpolated; the caller clips
  // those away, and this is the belt to that pair of braces. (An orthographic pass has no eye to be
  // behind, and its depths are signed distances along the light ray, so it skips the guard.)
  if (!linear && (!(az > 0) || !(bz > 0) || !(cz > 0))) return;
  const ia = linear ? az : 1 / az, ib = linear ? bz : 1 / bz, ic = linear ? cz : 1 / cz;
  const gwp = G && G.wp, gfi = G && G.fi;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    const rowOff = y * stride;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      // Barycentrics by edge functions. The sign test covers both windings, so a mesh authored
      // back-to-front rasterises identically rather than vanishing.
      let w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv;
      let w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * inv;
      let w2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * inv;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      // w1 is opposite a, w2 opposite b, w0 opposite c.
      const iz = ia * w1 + ib * w2 + ic * w0;
      if (!linear && iz <= 0) continue;
      const z = linear ? iz : 1 / iz;
      const di = rowOff + x;
      if (z >= depth[di]) continue;                  // something nearer already owns this pixel
      depth[di] = z;
      // The G-buffer, written by the SAME test that just won the pixel — so world position, face
      // and colour can never end up describing three different surfaces. World position follows the
      // 1/z law like everything else: interpolate w/z linearly, then multiply back through by z.
      if (gwp) {
        const gi = di * 3, k0 = ia * w1, k1 = ib * w2, k2 = ic * w0;
        gwp[gi]     = (wa[0] * k0 + wb[0] * k1 + wc[0] * k2) * z;
        gwp[gi + 1] = (wa[1] * k0 + wb[1] * k1 + wc[1] * k2) * z;
        gwp[gi + 2] = (wa[2] * k0 + wb[2] * k1 + wc[2] * k2) * z;
        gfi[di] = fidx;
      }
      if (!rgba) continue;                           // a depth-only target (rasterDepth) — nothing to shade
      const ci = di * 4;
      rgba[ci] = r; rgba[ci + 1] = g; rgba[ci + 2] = b; rgba[ci + 3] = a;
    }
  }
}

// Copy the finished window out as ImageData the caller can put on a canvas. Kept separate from the
// raster so a test can read pixels without a DOM.
export function readPixels(res) {
  const { buf, w, h } = res;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = y * buf.w * 4;
    out.set(buf.rgba.subarray(src, src + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

// The depth at one pixel — for tests, and for anything that needs to know what won.
export function depthAt(res, x, y) {
  return res.buf.depth[y * res.buf.w + x];
}

export const _resetRasterBuffer = () => { _buf = null; };

// ── ASKING FOR THE FALLBACK ON PURPOSE ───────────────────────────────────────
// ⚠ A TEST SEAM, and it lives here rather than in the harness because of a detail that is easy to
// get wrong twice: the DOM stub is permissive enough that `blitRaster` SUCCEEDS in node. So the
// moment a renderer moves onto the depth path, any gate that reads the DRAW ORDER — the headlamp
// smoke, which replays the polygons the canvas was given — is handed an empty canvas and reports a
// truck with no headlamps at all.
//
// The sort is not dead code: every caller falls back to it when the blit cannot land, and a lamp
// being eaten by it is exactly the bug that shipped twice. So it still has to be gated, and this is
// how a harness asks to be shown it. Never call it from the client.
let _blitOff = false;
export const _setBlitEnabled = (on) => { _blitOff = !on; };

// Put the finished window onto a canvas.
//
// ⚠ THROUGH A SCRATCH CANVAS, NOT `putImageData`. putImageData ignores the current transform and
// REPLACES pixels rather than compositing — so it would punch a hard rectangle of model-and-
// transparency straight through the scene behind it, at the wrong place on any canvas with a DPR
// transform set (which is all of them). drawImage composites and respects the transform.
let _scratch = null;
export function blitRaster(ctx, res, x0, y0) {
  const { buf, w, h } = res;
  // Back into the caller's own units. Supersampling is the reason a caller passes a scale at all —
  // it rasterises at device resolution and lands the result on a ctx that is measured in CSS pixels.
  const ss = res.scale || 1;
  if (_blitOff) return false;                                                   // a harness asked for the sort — see _setBlitEnabled
  if (typeof document === 'undefined' || !document.createElement) return false;
  if (!_scratch || _scratch.width < w || _scratch.height < h) {
    _scratch = document.createElement('canvas');
    _scratch.width = Math.max(w, 1); _scratch.height = Math.max(h, 1);
  }
  const sc = _scratch.getContext && _scratch.getContext('2d');
  if (!sc || !sc.createImageData || !sc.putImageData) return false;
  const img = sc.createImageData(w, h);
  if (!img || !img.data) return false;
  for (let y = 0; y < h; y++) {
    const src = y * buf.w * 4;
    img.data.set(buf.rgba.subarray(src, src + w * 4), y * w * 4);
  }
  sc.clearRect(0, 0, w, h);
  sc.putImageData(img, 0, 0);
  ctx.drawImage(_scratch, 0, 0, w, h, x0, y0, w / ss, h / ss);
  return true;
}

// ── THE SUN, AS A SECOND DEPTH BUFFER ────────────────────────────────────────
//
// Everything above settles WHICH SURFACE a pixel is. Given that, a shadow is one more question of
// exactly the same shape asked from somewhere else: is anything between this surface and the light?
// So the shadow pass is not new machinery — it is `tri` again, run from the sun's point of view,
// depth only, into a small square buffer. What comes back is a depth map, and a pixel is in shadow
// when the map says something was nearer to the sun along the same ray.
//
// ⚠ AND IT OBEYS THE SAME LIMIT AS EVERYTHING ELSE IN THIS FILE. The map is sized to ONE model's
// own bounding sphere, not to the world, so its cost is a fixed few hundred faces into a fixed
// 256² whatever the camera is doing — it does not grow when you dolly in, which is the one thing
// the screen-space passes here cannot promise. Point this at the city and the sim stops being
// 60fps, for exactly the reasons at the top of this file.
//
// ── WHY THE PROJECTION IS ORTHOGRAPHIC ───────────────────────────────────────
// The sun is a directional light: its rays are parallel, so there is no eye and no perspective
// divide. That is also why `tri` grew a `linear` mode rather than reusing the 1/z path — see the ⚠
// there. The frame is built around the model: u and v span its bounding sphere and nothing else,
// because a caster outside those bounds cannot cast onto anything inside them. Depth is the signed
// distance ALONG the ray, increasing away from the sun, and it is deliberately allowed to go
// negative — a wall standing between the model and the sun is at negative depth, and clamping it
// away would delete the only occluder anybody cares about.
export function lightBasis(cx, cy, cz, toSun, radius, size) {
  // Any axis not parallel to the ray, so the cross product below never degenerates. A sun near the
  // zenith is the case that picks the second one.
  let ax = 0, ay = 0, az = 1;
  if (Math.abs(toSun[2]) > 0.9) { ax = 1; az = 0; }
  let rx = toSun[1] * az - toSun[2] * ay, ry = toSun[2] * ax - toSun[0] * az, rz = toSun[0] * ay - toSun[1] * ax;
  const rm = Math.hypot(rx, ry, rz) || 1; rx /= rm; ry /= rm; rz /= rm;
  const ux = toSun[1] * rz - toSun[2] * ry, uy = toSun[2] * rx - toSun[0] * rz, uz = toSun[0] * ry - toSun[1] * rx;
  return {
    cx, cy, cz, rx, ry, rz, ux, uy, uz,
    sx: toSun[0], sy: toSun[1], sz: toSun[2],
    k: size / (2 * Math.max(1e-6, radius)), half: size / 2, size, radius,
  };
}

// One world point into the light's frame. Exported for the smoke — the shading loop below inlines
// the same three dot products rather than calling this a million times.
export function lightProject(B, x, y, z) {
  const dx = x - B.cx, dy = y - B.cy, dz = z - B.cz;
  return {
    x: B.half + (dx * B.rx + dy * B.ry + dz * B.rz) * B.k,
    y: B.half + (dx * B.ux + dy * B.uy + dz * B.uz) * B.k,
    z: -(dx * B.sx + dy * B.sy + dz * B.sz),
  };
}

// Casters into a depth map. Each caster is a polygon in WORLD 3-space — either a bare array of
// [x, y, z] or an object carrying one as `w`.
//
// ⚠ A SCREEN-SPACE QUAD IS NOT A CASTER, and the occlusion pre-pass is full of them: `OCC_SOLIDS`
// entries carry `pts` already through the camera, which describe where a building is on the
// MONITOR and say nothing about where it is relative to the sun. Feeding those here would build a
// shadow map of the camera's own projection — so anything with only `pts` is skipped rather than
// coerced, and a caller that wants a building to cast has to hand over its world corners.
//
// `accumulate` works exactly as it does in `rasterDepth`: the model goes in, then the world's
// solids on top of it, without clearing between.
const _lpts = [];
export function rasterShadow(target, casters, B, accumulate = false) {
  const size = B && B.size | 0;
  if (!size || size <= 0) return null;
  if (!target.d || target.w < size || target.h < size) {
    target.w = Math.max(size, target.w); target.h = Math.max(size, target.h);
    target.d = new Float32Array(target.w * target.h);
    accumulate = false;                                  // a fresh (or regrown) buffer holds nothing
  }
  const { d } = target, stride = target.w;
  if (!accumulate) for (let y = 0; y < size; y++) { const row = y * stride; d.fill(Infinity, row, row + size); }
  let drew = 0;
  for (const c of casters) {
    const p = Array.isArray(c) ? c : c.w;
    if (!p || p.length < 3) continue;
    _lpts.length = 0;
    for (const v of p) {
      const dx = v[0] - B.cx, dy = v[1] - B.cy, dz = v[2] - B.cz;
      _lpts.push(B.half + (dx * B.rx + dy * B.ry + dz * B.rz) * B.k,
                 B.half + (dx * B.ux + dy * B.uy + dz * B.uz) * B.k,
                 -(dx * B.sx + dy * B.sy + dz * B.sz));
    }
    for (let t = 1; t + 1 < p.length; t++) {
      tri(d, null, stride, size, size,
        _lpts[0], _lpts[1], _lpts[2],
        _lpts[t * 3], _lpts[t * 3 + 1], _lpts[t * 3 + 2],
        _lpts[t * 3 + 3], _lpts[t * 3 + 4], _lpts[t * 3 + 5],
        0, 0, 0, 0, null, 0, null, null, null, true);
    }
    drew++;
  }
  return (drew || accumulate) ? { buf: target, size, B } : null;
}

// ── THE LIGHT PASS ───────────────────────────────────────────────────────────
//
// ⚠ THIS CAN ONLY DARKEN OR ADD, AND THAT IS THE WHOLE SAFETY ARGUMENT FOR IT. The colour already
// in the buffer is the finished flat shade — the same number the canvas fallback paints, computed
// once by the caller and kept both ways so the two can never drift (see the ⚠ where `rv` is built).
// If this pass re-derived that shade it would be a SECOND lighting model, agreeing with the first
// until somebody edited one of them, and every path that falls back to canvas — a thumbnail, a
// failed blit, a headless harness — would render a differently-lit truck.
//
// So it never computes a colour. Shadow scales the sun's CONTRIBUTION to a colour that already
// contains it, back down toward the ambient the same face would have had facing away; lamps are
// added on top. With no shadow map and no lamps the result is byte-identical to not calling this at
// all, which is a thing the smoke asserts rather than a thing anybody has to believe.
//
// The rig:
//   faces      the same array handed to `rasterFaces` — read for `.n`, the face's world normal
//   ambient    the constant term in the caller's own light equation (…the 0.82 in 0.82 + 0.5·n·l)
//   sunGain    the coefficient on the sun term (…the 0.5)
//   sunStr     the caller's sun strength, already faded for elevation and night
//   sun        unit vector toward the sun, in world 3-space
//   shadow     { map, strength, bias, slope } — `map` straight out of `rasterShadow`
//   lights     [{ p, c, rad, str, dir, cone }] — point/spot lamps in world 3-space
let _sunT = new Float32Array(0), _den = new Float32Array(0), _nlf = new Float32Array(0);
export function shadeRaster(res, rig) {
  if (!res || !res.lit || !rig) return 0;
  const sh = (rig.shadow && rig.shadow.map) ? rig.shadow : null;
  let LS = null;
  if (rig.lights) {
    for (const L of rig.lights) {
      const rad = L && L.rad;
      if (!(rad > 0) || !L.p) continue;
      (LS ||= []).push({
        p: L.p, c: L.c || [255, 255, 255], str: L.str == null ? 1 : L.str,
        r2: rad * rad, invRad: 1 / rad,
        dir: L.dir || null, cos: L.cone == null ? -1 : Math.cos(L.cone),
      });
    }
  }
  if (!sh && !LS) return 0;                        // nothing to say — leave the flat shade exactly as it is
  _shadeCount++;
  const { buf, w, h } = res;
  const { rgba, wp, fi } = buf, stride = buf.w;
  const faces = rig.faces || [];
  const amb = rig.ambient == null ? 1 : rig.ambient;
  const gain = rig.sunGain == null ? 0 : rig.sunGain, sstr = rig.sunStr == null ? 0 : rig.sunStr, S = rig.sun;
  // PER FACE, NOT PER PIXEL. A face's normal is constant across it, so its sun term and the
  // denominator that term is normalised against are two multiplies each per FACE — a few hundred —
  // rather than per pixel, of which there are a few hundred thousand.
  const n = faces.length;
  if (_sunT.length < n) { _sunT = new Float32Array(n); _den = new Float32Array(n); _nlf = new Float32Array(n); }
  for (let i = 0; i < n; i++) {
    const nv = faces[i] && faces[i].n;
    const nl = (S && nv) ? Math.max(0, nv[0] * S[0] + nv[1] * S[1] + nv[2] * S[2]) : 0;
    _nlf[i] = nl; _sunT[i] = gain * nl * sstr; _den[i] = (amb + _sunT[i]) || 1;
  }
  const B = sh && sh.map.B, D = sh && sh.map.buf.d, SW = sh && sh.map.buf.w, SS = sh ? sh.map.size : 0;
  const strength = sh ? (sh.strength == null ? 1 : sh.strength) : 0;
  // ⚠ THE BIAS HAS A SLOPE TERM AND NEEDS ONE. A flat constant that stops a surface facing the sun
  // from shadowing itself is far too small for one raking across it, where a single map texel spans
  // a long run of depth — that face then stripes itself with its own shadow (acne). Scaling the
  // margin by how side-on the face is costs one multiply per face and covers both ends.
  const bias0 = sh ? (sh.bias == null ? 0.0015 : sh.bias) : 0;
  const slope = sh ? (sh.slope == null ? 0.02 : sh.slope) : 0;
  let touched = 0;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const di = row + x, ci = di * 4;
      if (rgba[ci + 3] === 0) continue;            // never drawn, or cut away by `maskRaster`
      const f = fi[di], gi = di * 3;
      const px = wp[gi], py = wp[gi + 1], pz = wp[gi + 2];
      let mul = 1;
      // ⚠ A FACE WITH NO SUN ON IT CANNOT BE SHADOWED, and skipping those is most of what makes
      // this pass affordable — on a boxy model it is about half the pixels, and they are skipped
      // before the three dot products rather than after them.
      const sunT = _sunT[f];
      if (sh && sunT > 0.0005) {
        const dx = px - B.cx, dy = py - B.cy, dz = pz - B.cz;
        const u = B.half + (dx * B.rx + dy * B.ry + dz * B.rz) * B.k;
        const v = B.half + (dx * B.ux + dy * B.uy + dz * B.uz) * B.k;
        const d = -(dx * B.sx + dy * B.sy + dz * B.sz) - (bias0 + slope * (1 - _nlf[f]));
        // Four taps rather than one. A hard 256²-texel edge across a truck reads as a jagged stripe
        // of paint; four taps cost three extra array reads and turn it into a one-texel gradient,
        // which at this map size is the difference between a shadow and an artefact.
        const u0 = Math.floor(u), v0 = Math.floor(v);
        let open = 0;
        for (let j = 0; j < 4; j++) {
          const sx = u0 + (j & 1), sy = v0 + (j >> 1);
          // Off the map is OPEN SKY, never shadow. The frame is fitted to the model, so a pixel
          // landing outside it is a rounding case at the very rim — and the conservative direction
          // there is lit, matching every other margin in this file.
          if (sx < 0 || sy < 0 || sx >= SS || sy >= SS || !(D[sy * SW + sx] < d)) open++;
        }
        if (open < 4) mul = (amb + sunT * (1 - strength * (1 - open * 0.25))) / _den[f];
      }
      let r = rgba[ci], g = rgba[ci + 1], b = rgba[ci + 2];
      let hit = mul !== 1;
      if (mul !== 1) { r *= mul; g *= mul; b *= mul; }
      if (LS) {
        const nv = faces[f] && faces[f].n;
        if (nv) for (let li = 0; li < LS.length; li++) {
          const L = LS[li];
          const dx = L.p[0] - px, dy = L.p[1] - py, dz = L.p[2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= L.r2) continue;                              // outside the lamp's reach
          const inv = 1 / Math.sqrt(d2 || 1e-12);
          const nd = (nv[0] * dx + nv[1] * dy + nv[2] * dz) * inv;
          if (nd <= 0) continue;                                 // the surface is turned away from it
          // Linear falloff, squared. Physical inverse-square has no finite reach, so it can never be
          // culled by a radius — and a lamp that has to be evaluated for every pixel of every model
          // in the frame is the version of this that cannot ship.
          let k = 1 - (d2 * inv) * L.invRad;
          k = k * k * nd * L.str;
          if (L.dir) {
            const cd = -(dx * L.dir[0] + dy * L.dir[1] + dz * L.dir[2]) * inv;
            if (cd <= L.cos) continue;                           // outside the cone
            k *= (cd - L.cos) / (1 - L.cos);
          }
          if (k <= 0.0005) continue;
          r += L.c[0] * k; g += L.c[1] * k; b += L.c[2] * k; hit = true;
        }
      }
      if (!hit) continue;
      rgba[ci] = r; rgba[ci + 1] = g; rgba[ci + 2] = b;          // Uint8Clamped does the clamping
      touched++;
    }
  }
  return touched;
}

// The depth one cell into a shadow map — for tests, and for anything that wants to ask directly.
export function shadowDepthAt(map, x, y) {
  if (!map || x < 0 || y < 0 || x >= map.size || y >= map.size) return Infinity;
  return map.buf.d[y * map.buf.w + x];
}
