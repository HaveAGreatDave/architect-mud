// ── DOES THE DEPTH BUFFER ACTUALLY DECIDE PER PIXEL? ─────────────────────────
// The case every sort in this codebase got wrong, reduced to its bones: a big panel and a small one
// standing in front of PART of it. No ordering of the two can be right — draw the panel last and it
// covers the small one, draw it first and it is missing wherever the small one is not. The only
// correct picture has the small part's pixels showing the small part and everything around them
// showing the panel, and that is a per-pixel answer.
//
// So the assertions are pixels, not order. And the faces are handed over in the WORST order (near
// first), because a rasteriser that only works when the input is already sorted is a sort.
import { rasterFaces, readPixels, depthAt, _resetRasterBuffer, rasterDepth, depthTarget, maskRaster, depthWinAt,
         lightBasis, lightProject, rasterShadow, shadeRaster, shadowDepthAt } from '../../client/game/js/panels/model-raster.js';

const quad = (x0, y0, x1, y1, z, r, g, b) => ({
  pts: [{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }],
  r, g, b, a: 255,
});
const pix = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

export function rasterSmoke() {
  const out = [];
  _resetRasterBuffer();

  // 1. THE CASE THE SORT CANNOT DO. A 40×40 panel at depth 10, a 10×10 chip at depth 5 sitting in
  //    the middle of it, handed over NEAR FIRST so any order-respecting renderer gets it wrong.
  {
    const faces = [quad(15, 15, 25, 25, 5, 255, 0, 0), quad(0, 0, 40, 40, 10, 0, 0, 255)];
    const res = rasterFaces(faces, 0, 0, 40, 40);
    if (!res) { out.push('the rasteriser refused a 40x40 model'); return out; }
    const img = readPixels(res);
    const centre = pix(img, 20, 20), corner = pix(img, 3, 3);
    if (centre[0] !== 255) out.push(`the near chip lost its own pixels (centre is ${centre.slice(0, 3)}) — this is the sort's failure, in a renderer that should not have it`);
    if (corner[2] !== 255) out.push(`the far panel is missing where nothing covers it (corner is ${corner.slice(0, 3)})`);
    if (Math.abs(depthAt(res, 20, 20) - 5) > 1e-6) out.push('the depth at the chip is not the chip');
    if (Math.abs(depthAt(res, 3, 3) - 10) > 1e-6) out.push('the depth in the open is not the panel');
  }

  // 2. ORDER MUST NOT MATTER AT ALL. The same two faces both ways round have to produce the same
  //    image, pixel for pixel. That is the whole promise: there is no order left to get wrong.
  {
    const near = quad(15, 15, 25, 25, 5, 255, 0, 0), far = quad(0, 0, 40, 40, 10, 0, 0, 255);
    const a = readPixels(rasterFaces([near, far], 0, 0, 40, 40));
    const b = readPixels(rasterFaces([far, near], 0, 0, 40, 40));
    let diff = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
    if (diff) out.push(`${diff} channel(s) differ when the same two faces are submitted in the other order`);
  }

  // 3. INTERPENETRATION, which is the case no ordering can express even in principle: two panels
  //    crossing through each other. Each must own the half where it is nearer.
  {
    const slope = (z0, z1, r, g, b) => ({
      pts: [{ x: 0, y: 0, z: z0 }, { x: 40, y: 0, z: z1 }, { x: 40, y: 40, z: z1 }, { x: 0, y: 40, z: z0 }],
      r, g, b, a: 255,
    });
    const res = rasterFaces([slope(4, 12, 255, 0, 0), slope(12, 4, 0, 255, 0)], 0, 0, 40, 40);
    const img = readPixels(res);
    const left = pix(img, 4, 20), right = pix(img, 36, 20);
    if (left[0] !== 255) out.push('the near-on-the-left panel does not own the left');
    if (right[1] !== 255) out.push('the near-on-the-right panel does not own the right');
  }

  // 4. PERSPECTIVE. Depth across a face is 1/z-linear, not z-linear. Two panels that meet at one
  //    edge and separate toward the other must not swap in the middle — interpolating z directly
  //    bows a surface toward the eye and hands the far one a stripe through the near one, which is
  //    the same see-through artefact one level down.
  {
    const a = { pts: [{ x: 0, y: 0, z: 2 }, { x: 40, y: 0, z: 40 }, { x: 40, y: 40, z: 40 }, { x: 0, y: 40, z: 2 }], r: 255, g: 0, b: 0, a: 255 };
    const b = { pts: [{ x: 0, y: 0, z: 2.1 }, { x: 40, y: 0, z: 44 }, { x: 40, y: 40, z: 44 }, { x: 0, y: 40, z: 2.1 }], r: 0, g: 0, b: 255, a: 255 };
    const img = readPixels(rasterFaces([b, a], 0, 0, 40, 40));
    let wrong = 0;
    for (let x = 1; x < 39; x++) if (pix(img, x, 20)[0] !== 255) wrong++;
    if (wrong) out.push(`the nearer of two receding panels loses ${wrong} column(s) — depth is being interpolated linearly in z`);
  }

  // 5. NOTHING OUTSIDE THE MODEL IS TOUCHED, so a caller can blit this over a finished scene.
  {
    const img = readPixels(rasterFaces([quad(10, 10, 20, 20, 5, 255, 0, 0)], 0, 0, 40, 40));
    if (pix(img, 2, 2)[3] !== 0) out.push('the buffer is opaque where the model is not — it would erase the scene behind it');
  }

  // ── 6. AND THE OTHER BUFFER: WHAT THE MODEL IS STANDING BEHIND ──────────────
  // The same question one level out. A model that sorts perfectly against itself still painted
  // straight through the building in front of it, because the world is canvas fills and paint order
  // put the model last. So the world's solids go into a depth-only window over the SAME box, and
  // the two buffers are compared per pixel.
  //
  // A wall down the left half at depth 3, a model panel across the whole box at depth 5: the left
  // must be bitten out and the right must survive untouched. A whole-object test cannot express
  // that — it either keeps the model or drops it — which is exactly the bug.
  {
    const res = rasterFaces([quad(0, 0, 40, 40, 5, 0, 255, 0)], 0, 0, 40, 40);
    const T = depthTarget();
    const win = rasterDepth(T, [{ pts: [{ x: 0, y: 0, z: 3 }, { x: 20, y: 0, z: 3 }, { x: 20, y: 40, z: 3 }, { x: 0, y: 40, z: 3 }] }], 0, 0, 40, 40);
    if (!win) { out.push('the depth-only rasteriser refused a wall'); return out; }
    if (depthWinAt(win, 5, 20) !== 3) out.push('the wall is not at its own depth in the occluder window');
    if (depthWinAt(win, 35, 20) !== Infinity) out.push('the occluder window claims depth where nothing was drawn — open sky would occlude');
    const cut = maskRaster(res, win, 0.02);
    if (!cut) out.push('nothing was masked — the model is still painted straight through the wall');
    const img = readPixels(res);
    if (pix(img, 5, 20)[3] !== 0) out.push('the model still owns pixels the wall is in front of');
    if (pix(img, 35, 20)[1] !== 255) out.push('the model lost pixels nothing was covering — a whole-object test wearing a mask’s clothes');
    // …and the depth it beat is still recorded, which is what the detail passes read. The alpha is
    // the mask; the depth is the model's own answer and must not be rewritten by it.
    if (Math.abs(depthAt(res, 5, 20) - 5) > 1e-6) out.push('masking rewrote the model depth — the detail passes read that');
  }

  // 7. A SOLID BEHIND THE MODEL HIDES NOTHING. The direction test, and the one that makes the
  //    difference between an occlusion pass and a delete: the same wall, further away.
  {
    const res = rasterFaces([quad(0, 0, 40, 40, 5, 0, 255, 0)], 0, 0, 40, 40);
    const T = depthTarget();
    const win = rasterDepth(T, [{ pts: [{ x: 0, y: 0, z: 9 }, { x: 20, y: 0, z: 9 }, { x: 20, y: 40, z: 9 }, { x: 0, y: 40, z: 9 }] }], 0, 0, 40, 40);
    if (maskRaster(res, win, 0.02)) out.push('a wall BEHIND the model masked it — every contact would vanish as it drove in front of a building');
  }

  // 8. ACCUMULATION. The occlusion pre-pass fills the field one building at a time and reads the
  //    answers between calls, so a second raster into the same target must ADD rather than clear.
  //    Get this wrong and every building is tested against a field holding only itself.
  {
    const T = depthTarget();
    const wall = (x0, x1, z) => ({ pts: [{ x: x0, y: 0, z }, { x: x1, y: 0, z }, { x: x1, y: 40, z }, { x: x0, y: 40, z }] });
    rasterDepth(T, [wall(0, 20, 3)], 0, 0, 40, 40);
    const win = rasterDepth(T, [wall(20, 40, 7)], 0, 0, 40, 40, true);
    if (depthWinAt(win, 5, 20) !== 3) out.push('the first solid was cleared by the second — the field cannot be built a building at a time');
    if (depthWinAt(win, 35, 20) !== 7) out.push('the second solid never landed');
    // …and without the flag it starts again, which is how the field is cleared each frame.
    const fresh = rasterDepth(T, [], 0, 0, 40, 40);
    if (depthWinAt(fresh, 5, 20) !== Infinity) out.push('a non-accumulating raster kept last frame’s occluders');
  }

  // ── THE LIGHT PASS ─────────────────────────────────────────────────────────
  // A 4x4 slab of ground at world z=0, drawn flat at a constant camera depth, with a 2x2 lid
  // floating over the middle of it and the sun straight overhead. Everything below is about that
  // one arrangement, because it is the smallest thing that has an inside and an outside.
  const slab = () => ({
    pts: [{ x: 0, y: 0, z: 10 }, { x: 40, y: 0, z: 10 }, { x: 40, y: 40, z: 10 }, { x: 0, y: 40, z: 10 }],
    w: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
    n: [0, 0, 1], r: 200, g: 200, b: 200, a: 255,
  });
  const LID = [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const SUN = [0, 0, 1];
  const rigOf = (f, extra) => Object.assign({ faces: [f], ambient: 0.82, sunGain: 0.5, sunStr: 1, sun: SUN }, extra);

  // 8. THE NO-OP INVARIANT, AND IT IS THE LOAD-BEARING ONE. The colour in the buffer is the finished
  //    flat shade the canvas fallback also paints. A light pass with nothing to say must therefore
  //    leave it BYTE-IDENTICAL — the moment it does not, there are two lighting models in the
  //    renderer and a truck changes appearance whenever the blit does not land.
  {
    const f = slab();
    const res = rasterFaces([f], 0, 0, 40, 40, 1, true);
    if (!res || !res.lit) out.push('a face carrying world verts and a normal was not lit — the G-buffer never allocated');
    else {
      const a = readPixels(res).data.slice();
      shadeRaster(res, rigOf(f));
      const b = readPixels(res).data;
      if (!a.every((v, i) => v === b[i])) out.push('a light pass with no shadow map and no lamps CHANGED the picture — the flat shade and the lit shade have drifted apart');
    }
  }

  // 9. THE SHADOW ITSELF. Under the lid is darker; outside it is untouched, to the byte.
  {
    const f = slab();
    const res = rasterFaces([f], 0, 0, 40, 40, 1, true);
    const B = lightBasis(0, 0, 0, SUN, 3, 64);
    const map = rasterShadow(depthTarget(), [LID], B);
    if (!map) out.push('the shadow pass drew nothing from four world corners');
    else {
      const before = readPixels(res);
      shadeRaster(res, rigOf(f, { shadow: { map, strength: 1 } }));
      const after = readPixels(res);
      const mid = pix(after, 20, 20), edge = pix(after, 3, 3), was = pix(before, 3, 3);
      if (!(mid[0] < 190)) out.push('the pixel directly under a lid between it and the sun was not darkened — the shadow map is not being sampled');
      if (edge[0] !== was[0] || edge[1] !== was[1] || edge[2] !== was[2]) out.push('a pixel in open sunlight was changed by the shadow pass — the map is leaking outside the caster');
    }
  }

  // 10. AND IT LANDS ON THE AMBIENT, NOT ON AN INVENTED NUMBER. At full strength a shadowed pixel
  //     must equal the value the SAME face would have had turned away from the sun — that identity
  //     is the whole reason this pass is allowed to touch a colour it did not compute.
  {
    const f = slab();
    const res = rasterFaces([f], 0, 0, 40, 40, 1, true);
    const B = lightBasis(0, 0, 0, SUN, 3, 64);
    const map = rasterShadow(depthTarget(), [LID], B);
    shadeRaster(res, rigOf(f, { shadow: { map, strength: 1 } }));
    const got = pix(readPixels(res), 20, 20)[0];
    const want = Math.round(200 * 0.82 / (0.82 + 0.5));   // ambient / (ambient + full sun)
    if (Math.abs(got - want) > 2) out.push(`a fully shadowed pixel came out ${got}, but the same face facing away from the sun is ${want} — the shadow is inventing its own darkness`);
  }

  // 11. THE ORTHOGRAPHIC DEPTH IS LINEAR. A caster tilted through the light's frame must record a
  //     depth halfway along at the halfway VALUE. Interpolating 1/z here — the rule that is right
  //     for the camera — bows it, and a bowed caster shadow-acnes a stripe through every big face.
  {
    const B = lightBasis(0, 0, 0, SUN, 4, 64);
    const map = rasterShadow(depthTarget(), [[[-2, -2, 0], [2, -2, 4], [2, 2, 4], [-2, 2, 0]]], B);
    const mid = shadowDepthAt(map, 32, 32);
    if (!(Math.abs(mid - -2) < 0.25)) out.push(`a caster ramping 0→4 through the light's frame reads ${mid.toFixed(3)} at its midpoint instead of -2 — the shadow pass is interpolating 1/z, not z`);
  }

  // 12. OFF THE MAP IS OPEN SKY. The frame is fitted to the model, so a pixel landing outside it is
  //     a rounding case at the rim — and the conservative answer there is LIT, matching every other
  //     margin in the file. Getting this backwards puts a black band around the whole model.
  {
    const f = slab();
    const res = rasterFaces([f], 0, 0, 40, 40, 1, true);
    const B = lightBasis(40, 40, 0, SUN, 1, 32);        // a frame nowhere near the slab
    const map = rasterShadow(depthTarget(), [LID], B);
    const before = readPixels(res).data.slice();
    shadeRaster(res, rigOf(f, { shadow: { map, strength: 1 } }));
    const after = readPixels(res).data;
    if (!before.every((v, i) => v === after[i])) out.push('a model outside the shadow map\'s own frame was darkened — off the map must read as open sky, not as shadow');
  }

  // 13. A LAMP ADDS, AND ONLY WITHIN ITS RADIUS.
  {
    const f = slab();
    const res = rasterFaces([f], 0, 0, 40, 40, 1, true);
    shadeRaster(res, rigOf(f, { sunStr: 0, lights: [{ p: [0, 0, 0.5], c: [0, 0, 255], rad: 1.5, str: 1 }] }));
    const img = readPixels(res);
    const near = pix(img, 20, 20), far = pix(img, 3, 3);
    if (!(near[2] > 210)) out.push('a lamp 0.5 above a surface inside its radius added no light to it');
    if (far[2] !== 200) out.push('a lamp added light to a pixel outside its own radius — the falloff has no reach limit');
  }

  // 14. AN UNLIT CALLER ALLOCATES AND CHANGES NOTHING. Every airframe, every thumbnail and every
  //     contact across a yard goes through this path, and it must be the code that shipped before.
  {
    const res = rasterFaces([quad(0, 0, 40, 40, 5, 0, 255, 0)], 0, 0, 40, 40);
    if (res.lit) out.push('a caller that never asked to be lit came back lit — the G-buffer is being allocated for everything');
    if (shadeRaster(res, rigOf(slab(), { lights: [{ p: [0, 0, 1], c: [255, 0, 0], rad: 9, str: 1 }] })))
      out.push('the light pass shaded an unlit buffer — it is reading a G-buffer that was never filled');
  }

  return out;
}
