// ── DOES THE DEPTH BUFFER ACTUALLY DECIDE PER PIXEL? ─────────────────────────
// The case every sort in this codebase got wrong, reduced to its bones: a big panel and a small one
// standing in front of PART of it. No ordering of the two can be right — draw the panel last and it
// covers the small one, draw it first and it is missing wherever the small one is not. The only
// correct picture has the small part's pixels showing the small part and everything around them
// showing the panel, and that is a per-pixel answer.
//
// So the assertions are pixels, not order. And the faces are handed over in the WORST order (near
// first), because a rasteriser that only works when the input is already sorted is a sort.
import { rasterFaces, readPixels, depthAt, _resetRasterBuffer } from '../../client/game/js/panels/model-raster.js';

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
  return out;
}
