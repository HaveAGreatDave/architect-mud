// A building's front door, to the Clone Facility's standard, for an arm that draws its own.
//
// The clone's door (the `clone` arm in models/downtown.js) is the bar every small building is held
// to (building-styles.md §4.5): a portal, a canopy, the leaves, a lobby lit behind the glass, a
// transom, a step and a mat. An authored model gets most of that from one `windowBay` with `door`
// set. An arm whose mass is drums, rings or yawed wings has no flat wall for that part to stand on,
// and the small-building grade (docs/audits/findings-2026-10-small-buildings.md) found 21 Coldwater
// arms with no door at all. This is the door those arms call.
//
// Everything is in the model's own frame, the same frame `F` and `W3` are: local +y is the entrance
// side and `y` is the plane the door is set in. `porch` stands a vestibule out from that plane and
// sets the door in the porch's face instead, which is how a door gets onto a drum or a ring.
//
// ⚠ THE LEAVES ARE STILL. The clone's slide because the clone is the first building a player sees,
// and §4.5 makes movement the exception. A still door is flats and lines, so it is mesh.
//
// ⚠ AND THE SURROUND STOPS AT THE THRESHOLD, for the windowBay `door` reason: `z0` is the pavement,
// and a frame drawn past it all round puts a lip under the ground.
import {
  DETAIL_LIFT, FACE_EPS, SHAPE_SINK, bakeSignText, draw3DBoxAt, emitFlat, emitSurfaceText,
  emitWire, faceYaw, glowPool, rgb,
} from '../windshield.js';

// Turn a quad to face `out`, the way downtown.js `facing` does, so a cull normal means what it says.
function wind(q, out) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * out[0] + ny * out[1] + nz * out[2] < 0 ? q.slice().reverse() : q;
}

const css = (c) => (typeof c === 'string' ? c : rgb(c.map((v) => Math.round(Math.min(255, v)))));

// o: {
//   x = 0, y          centre along the face, and the plane the door is set in
//   w                 half-width of the opening
//   z0 = 0, top       threshold and head
//   leaves = 2        1 or 2
//   frame             [r,g,b] of the surround, jambs and stiles
//   lobby             { day, night } fill behind the glass
//   solid             { fill, planks, handle, crack }: an opaque leaf instead of glass; `crack`
//                     'r,g,b' is a lit line down the closing edge after dark
//   depth = 0.012     how far the surround stands proud of `y`
//   porch             { depth, half, top, pal }: a vestibule box; the door goes on its face
//   canopy            { out, half, hh, pal, strip }: a slab over the head; `strip` lights its edge
//   transom           { hh, day, night, label, ink, font }: a lit panel over the head
//   plate             { side, w, hh, z, fill, night }: a keypad or a brass plate beside the door
//   lamp              'r,g,b': a light over the door; `lampDay` is the share that shows by day
//   mat = true, step = true
//   frontVis          the arm's own front test, for the lettering
// }
export function drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, o) {
  const x = o.x || 0, w = o.w, z0 = o.z0 || 0, top = o.top, n = o.leaves === 1 ? 1 : 2;
  const yaw = faceYaw(E);
  let y = o.y;
  // ── THE MASS: the porch and the canopy. These are real boxes, so they go through draw3DBoxAt
  //    before the SHAPE_SINK return, and the collision and the shadows know about them.
  if (o.porch) {
    const p = o.porch, half = p.half || w * 1.7, ptop = p.top || top * 1.2;
    const [px, py] = F(x, y + p.depth / 2);
    draw3DBoxAt(ctx, cam, px, py, half, z0, ptop, p.pal, seed + 71, night, alpha, true, yaw, p.depth / 2);
    y += p.depth;
  }
  const fr = o.frameW || Math.max(w * 0.14, 0.006);
  const tr = o.transom ? o.transom.hh : 0;
  const head = top + (tr ? tr * 2 + fr : 0);   // where the canopy and the lamp go
  if (o.canopy) {
    const c = o.canopy, ch = c.hh || 0.006;
    const [cx, cy] = F(x, y + c.out / 2);
    draw3DBoxAt(ctx, cam, cx, cy, c.half || w * 1.9, head + fr, head + fr + ch * 2, c.pal, seed + 72, night, alpha, true, yaw, c.out / 2);
  }
  if (SHAPE_SINK) return;   // the rest is adornment
  const O = W3(0, 0, 0);
  const dir = (v) => { const D = W3(v[0], v[1], v[2]); return [D[0] - O[0], D[1] - O[1], D[2] - O[2]]; };
  const OUT = dir([0, 1, 0]), UP = [0, 0, 1], DOWN = [0, 0, -1];
  const Q = (pts, out, fill, lift, cull) => emitFlat(ctx, cam, wind(pts.map((p) => W3(p[0], p[1], p[2])), out), css(fill), alpha,
    { lift: DETAIL_LIFT * lift, cullN: cull ? [out[0], out[1]] : undefined });
  const frame = o.frame || [120, 132, 138];
  const dusk = night ? 0.62 : 1;
  const fc = frame.map((v) => Math.round(v * dusk));
  const dep = o.depth ?? 0.012, yo = y + dep;
  const x0 = x - w, x1 = x + w;
  // 1) The surround: one plate round the opening and the transom, flush on the wall plane.
  Q([[x0 - fr, y + FACE_EPS, head + fr], [x1 + fr, y + FACE_EPS, head + fr], [x1 + fr, y + FACE_EPS, z0], [x0 - fr, y + FACE_EPS, z0]], OUT, fc, 1, true);
  // 2) Its returns, standing proud: the head faces down and is the darkest, the jambs between.
  Q([[x0, y, head], [x1, y, head], [x1, yo, head], [x0, yo, head]], DOWN, fc.map((v) => v * 0.45), 1.6, false);
  for (const s of [-1, 1]) {
    const jx = s < 0 ? x0 : x1, nrm = dir([-s, 0, 0]);
    Q([[jx, y, head], [jx, yo, head], [jx, yo, z0], [jx, y, z0]], nrm, fc.map((v) => v * 0.7), 1.6, true);
  }
  // 3) The lobby, behind the glass: dim by day, lit after dark, and the reason the door reads as a
  //    way IN rather than as a dark panel.
  const lob = o.lobby || { day: [44, 54, 60], night: [236, 214, 170] };
  const yg = y + FACE_EPS * 2;
  const yl = yg + FACE_EPS;
  const stile = `rgba(${fc[0]},${fc[1]},${fc[2]},0.95)`;
  if (o.solid) {
    // ⚠ A SOLID LEAF IS NOT A DARK LOBBY. Planks, a steel plate, a door painted the wall's colour:
    //   there is nothing behind it to light, so it takes its own fill and its own lines, and after
    //   dark the only light is a crack down the closing edge if somebody is in.
    const s = o.solid, fill = night ? (s.fill.map((v) => v * 0.55)) : s.fill;
    Q([[x0, yg, top], [x1, yg, top], [x1, yg, z0], [x0, yg, z0]], OUT, fill, 1.3, true);
    const line = `rgba(${Math.round(fill[0] * 0.55)},${Math.round(fill[1] * 0.55)},${Math.round(fill[2] * 0.55)},0.9)`;
    const np = s.planks || 0;
    for (let i = 1; i < np; i++) { const px = x0 + 2 * w * i / np; emitWire(ctx, cam, W3(px, yl, z0), W3(px, yl, top), 1, line, alpha, { pull: 0.02 }); }
    if (n === 2) emitWire(ctx, cam, W3(x, yl + 0.001, z0), W3(x, yl + 0.001, top), 1.4, stile, alpha, { pull: 0.02 });
    // The handle or latch, on the closing edge at hand height.
    const hx = n === 2 ? x + w * 0.12 : x1 - w * 0.22, hz = z0 + (top - z0) * 0.47, hs = Math.max(w * 0.06, 0.0025);
    Q([[hx - hs, yl, hz + hs * 1.6], [hx + hs, yl, hz + hs * 1.6], [hx + hs, yl, hz - hs * 1.6], [hx - hs, yl, hz - hs * 1.6]], OUT, s.handle || [150, 146, 132], 1.45, true);
    if (night && s.crack) {
      const cx = n === 2 ? x : x1 - 0.0015;
      emitWire(ctx, cam, W3(cx, yl + 0.0015, z0 + 0.002), W3(cx, yl + 0.0015, top - 0.002), 1.6, `rgba(${s.crack},0.9)`, alpha,
        { pull: 0.02, glow: 4, glowCss: `rgb(${s.crack})` });
    }
  } else Q([[x0, yg, top], [x1, yg, top], [x1, yg, z0], [x0, yg, z0]], OUT, night ? lob.night : lob.day, 1.3, true);
  // 4) The leaves: a kick plate low, a push bar at hand height, a stile between and at each edge.
  for (let k = 0; k < (o.solid ? 0 : n); k++) {
    const l0 = x0 + 2 * w * (k / n), l1 = x0 + 2 * w * ((k + 1) / n), ins = (l1 - l0) * 0.14;
    const kz = z0 + (top - z0) * 0.13, bz = z0 + (top - z0) * 0.46, bt = Math.max((top - z0) * 0.012, 0.0025);
    Q([[l0, yl, kz], [l1, yl, kz], [l1, yl, z0], [l0, yl, z0]], OUT, fc.map((v) => v * 0.55), 1.45, true);
    Q([[l0 + ins, yl, bz + bt], [l1 - ins, yl, bz + bt], [l1 - ins, yl, bz - bt], [l0 + ins, yl, bz - bt]], OUT, fc.map((v) => Math.min(255, v * 1.3)), 1.45, true);
    if (k > 0) emitWire(ctx, cam, W3(l0, yl + 0.001, z0), W3(l0, yl + 0.001, top), 1.4, stile, alpha, { pull: 0.02 });
  }
  // 5) The transom over the head, lit after dark, with what the door is for on it if the arm says.
  if (tr) {
    const t = o.transom, tz0 = top + fr, tz1 = top + fr + tr * 2;
    Q([[x0, yg, top + fr], [x1, yg, top + fr], [x1, yg, top], [x0, yg, top]], OUT, fc, 1.45, true);   // the transom bar
    Q([[x0, yg, tz1], [x1, yg, tz1], [x1, yg, tz0], [x0, yg, tz0]], OUT, night ? (t.night || [214, 236, 230]) : (t.day || [70, 84, 90]), 1.3, true);
    if (t.label && o.frontVis) {
      const tex = bakeSignText(t.label, t.ink || '#e8f4f0', night ? 1 : 0, false, true, true, { font: t.font || 'condensed' });
      if (tex) {
        const q = [[x0 + w * 0.08, tz1 - tr * 0.2], [x1 - w * 0.08, tz1 - tr * 0.2], [x1 - w * 0.08, tz0 + tr * 0.2], [x0 + w * 0.08, tz0 + tr * 0.2]]
          .map(([u, z]) => { const [wx, wy] = F(u, yl + 0.001); return cam.proj(wx, wy, z); });
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.4);
      }
    }
  }
  // 6) The plate beside the door: a keypad, a bell, an engraved plate. Small, at chest height.
  if (o.plate) {
    const p = o.plate, px = x + (p.side || 1) * (w + fr + p.w * 1.6), pz = p.z ?? z0 + (top - z0) * 0.55;
    Q([[px - p.w, yg, pz + p.hh], [px + p.w, yg, pz + p.hh], [px + p.w, yg, pz - p.hh], [px - p.w, yg, pz - p.hh]], OUT,
      night && p.night ? p.night : p.fill, 1.45, true);
  }
  // 7) The step, out past the surround, and a mat at its foot.
  const sOut = o.stepOut || Math.max(w * 0.5, 0.018), tread = z0 + Math.max((top - z0) * 0.03, 0.004);
  if (o.step !== false) {
    const sx0 = x0 - fr, sx1 = x1 + fr, ys = yo + sOut;
    Q([[sx0, yo, tread], [sx1, yo, tread], [sx1, ys, tread], [sx0, ys, tread]], UP, fc.map((v) => Math.min(255, v * 1.15)), 1.2, false);
    Q([[sx0, ys, tread], [sx1, ys, tread], [sx1, ys, z0], [sx0, ys, z0]], OUT, fc.map((v) => v * 0.6), 1.2, true);
  }
  if (o.mat !== false) {
    const ym = yo + (o.step !== false ? sOut : 0);
    Q([[x0, ym, z0 + 0.002], [x1, ym, z0 + 0.002], [x1, ym + w * 0.9, z0 + 0.002], [x0, ym + w * 0.9, z0 + 0.002]], UP, [30, 33, 35], 1.1, false);
  }
  // 8) The light over the door, and its spill on the pavement after dark.
  if (o.canopy && o.canopy.strip) {
    const c = o.canopy, cz = head + fr, cy = y + c.out, hw = c.half || w * 1.9;
    emitWire(ctx, cam, W3(x - hw, cy + 0.002, cz), W3(x + hw, cy + 0.002, cz), 2, night ? `rgba(${c.strip},0.95)` : 'rgba(150,170,170,0.6)', alpha,
      { pull: 0.02, glow: night ? 6 : 0, glowCss: `rgb(${c.strip})` });
  }
  if (o.lamp) {
    const [gx, gy] = F(x, y + 0.03);
    glowPool(ctx, cam, gx, gy, head + fr * 0.5, o.lamp, o.lampS || 9, alpha * (night ? 0.5 : (o.lampDay ?? 0.15)));
  }
  if (night) { const [gx, gy] = F(x, yo + sOut + 0.05); glowPool(ctx, cam, gx, gy, z0 + 0.01, o.spill || '255,214,160', 7, alpha * 0.22); }
}
