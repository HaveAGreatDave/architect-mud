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
// The buffer is allocated to the model's own screen box, not the canvas, so cost tracks how big the
// truck actually is. Distant contacts are a few pixels wide and are deliberately left on the sort —
// they are too small for anybody to see an ordering mistake in, and too numerous to pay for.

// Reused across frames so a steady camera allocates nothing. Grown, never shrunk: a buffer that
// re-allocates when the truck gets one pixel bigger is a buffer that re-allocates every frame you
// are moving, which is the whole cost this is trying to avoid.
let _buf = null;

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

function ensure(w, h) {
  if (_buf && _buf.w >= w && _buf.h >= h) return _buf;
  const W = Math.max(w, _buf ? _buf.w : 0), H = Math.max(h, _buf ? _buf.h : 0);
  _buf = { w: W, h: H, depth: new Float32Array(W * H), rgba: new Uint8ClampedArray(W * H * 4) };
  return _buf;
}

// `faces` are draw records: { pts: [{x, y, z}], r, g, b, a }. Screen coordinates in DEVICE pixels
// relative to (x0, y0); `z` is any monotonic camera distance where SMALLER IS NEARER.
//
// Returns null when there is nothing to draw or the box is degenerate, so the caller can fall
// through to whatever it did before rather than blitting an empty rectangle over the scene.
export function rasterFaces(faces, x0, y0, w, h, scale = 1) {
  w = Math.ceil(w * scale); h = Math.ceil(h * scale);
  if (!faces.length || w <= 0 || h <= 0 || w * h > 4_000_000) return null;
  const buf = ensure(w, h);
  const { depth, rgba } = buf;
  const stride = buf.w;
  // Clear only the window we are about to use. Clearing the whole grown buffer would make a big
  // truck earlier in the session cost a small one later.
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    depth.fill(Infinity, row, row + w);
    rgba.fill(0, (row) * 4, (row + w) * 4);
  }

  for (const f of faces) {
    const p = f.pts;
    if (p.length < 3) continue;
    // Fan the convex polygon into triangles. Every face in these meshes is a convex quad or a
    // triangle, so a fan is exact — no ear clipping and no winding to keep track of.
    for (let t = 1; t + 1 < p.length; t++) {
      tri(depth, rgba, stride, w, h,
        (p[0].x - x0) * scale, (p[0].y - y0) * scale, p[0].z,
        (p[t].x - x0) * scale, (p[t].y - y0) * scale, p[t].z,
        (p[t + 1].x - x0) * scale, (p[t + 1].y - y0) * scale, p[t + 1].z,
        f.r, f.g, f.b, f.a === undefined ? 255 : f.a);
    }
  }
  // ⚠ `scale` RIDES HOME WITH THE RESULT, because the blit is the only thing that can undo it. The
  // buffer is `scale`× the caller's coordinate box, so drawing it back at w×h would paint a truck
  // twice the size in the wrong place. `blitRaster` divides it out; `depthAt` and `readPixels` work
  // in buffer pixels and are unaffected. A caller that passes no scale gets exactly what it got.
  _rasterCount++;
  return { buf, w, h, scale };
}

// One triangle, depth-tested per pixel.
//
// ⚠ DEPTH IS INTERPOLATED AS 1/z, NOT z. Screen space is a perspective projection, so z is not
// linear across a triangle and 1/z is — interpolating z directly bows every surface toward the
// camera in the middle of a face, which on two nearly-coplanar panels is exactly enough to make the
// far one win a strip through the middle of the near one. That is the same see-through artefact
// this file exists to end, reintroduced one level down.
function tri(depth, rgba, stride, W, H, ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b, a) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minX > maxX || minY > maxY) return;
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;                 // edge-on: no pixels, and a divide by zero
  const inv = 1 / area;
  // 1/z at each vertex. A vertex behind or at the eye cannot be interpolated; the caller clips
  // those away, and this is the belt to that pair of braces.
  if (!(az > 0) || !(bz > 0) || !(cz > 0)) return;
  const ia = 1 / az, ib = 1 / bz, ic = 1 / cz;
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
      if (iz <= 0) continue;
      const z = 1 / iz;
      const di = rowOff + x;
      if (z >= depth[di]) continue;                  // something nearer already owns this pixel
      depth[di] = z;
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
