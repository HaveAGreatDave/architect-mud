// Rinkside · the body. Draws one skater or goalie from 21 world-space joints through any
// projection `P(x, y, z) → { x, y, s, d }` (screen point, pixels per foot, depth).
//
// EVERY PART IS A VOLUME, NOT A STICKER. The first cut drew each limb as a round-capped
// line, which reads fine at broadcast distance and like stickers on a fridge in the fight
// close-up. So each piece of kit is built as the thing it is:
//
//   · limbs are TAPERED (two radii joined by tangents) and shaded across their width, with
//     the ice bouncing a little light back into the underside
//   · the torso is the hull of five elliptical cross-sections (hem, waist, chest, padded
//     shoulders, collar) taken in a frame that twists from the hips to the shoulders, so
//     it has the same bulk from the front, the side and the back
//   · stripes, cuffs and pant hems are RINGS around the limb, drawn only where they face
//     the camera, so they wrap the arm instead of sitting across it
//   · the number, nameplate and crest are mapped onto the torso's own surface frame
//   · the helmet carries a 3D wire cage or a visor, the face has features in the head's
//     frame, and a lost helmet shows hair and ears
//   · skates are a boot, a tendon guard, a plastic holder and a steel runner
//
// Level of detail comes from pixels-per-foot at the chest, so the same code draws a 40px
// man on the broadcast camera and a 300px man in the fight close-up.

import { TAU, V, clamp, lerp, shade, hull, hash } from './util.js';

const INK = '#0b0e13';
const SL = [-0.52, -0.85];                     // screen-space direction toward the key light
const LW = V.norm([-0.35, -0.55, 0.76]);       // world-space direction toward the key light
const STEEL = '#cfd6dd', BOOT = '#16171b', HOLDER = '#e7eaed';
const NUM_FONT = '800 100px "Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
const NAME_FONT = '700 100px "Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';

// Torso cross-sections: [fraction pelvis→neck, half-width, half-depth, forward offset].
const SK_RINGS = [[-0.1, 0.72, 0.5, 0], [0.3, 0.66, 0.47, 0.02], [0.64, 0.86, 0.56, 0.05], [0.88, 1.2, 0.56, 0], [1.03, 0.62, 0.4, -0.02]];
const GK_RINGS = [[-0.1, 0.8, 0.58, 0.04], [0.3, 0.8, 0.62, 0.08], [0.64, 0.98, 0.7, 0.1], [0.88, 1.32, 0.64, 0.04], [1.04, 0.64, 0.46, 0]];

function taper(ctx, a, b, ra, rb) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  ctx.beginPath();
  if (L < Math.abs(ra - rb) + 0.01) { const r = Math.max(ra, rb), c = ra > rb ? a : b; ctx.arc(c.x, c.y, r, 0, TAU); return; }
  const phi = Math.atan2(dy, dx), al = Math.acos(clamp((ra - rb) / L, -1, 1));
  ctx.arc(a.x, a.y, ra, phi + al, phi + TAU - al);
  ctx.arc(b.x, b.y, rb, phi - al, phi + al);
  ctx.closePath();
}
function limbGrad(ctx, a, b, ra, rb, col) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  if (nx * SL[0] + ny * SL[1] < 0) { nx = -nx; ny = -ny; }
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = Math.max(1, (ra + rb) / 2);
  const g = ctx.createLinearGradient(mx + nx * r, my + ny * r, mx - nx * r, my - ny * r);
  g.addColorStop(0, shade(col, 0.3)); g.addColorStop(0.28, shade(col, 0.1)); g.addColorStop(0.6, col);
  g.addColorStop(0.88, shade(col, -0.42)); g.addColorStop(1, shade(col, -0.22));
  return g;
}
function ballGrad(ctx, c, r, col) {
  const g = ctx.createRadialGradient(c.x + SL[0] * r * 0.45, c.y + SL[1] * r * 0.45, r * 0.08, c.x, c.y, r * 1.05);
  g.addColorStop(0, shade(col, 0.42)); g.addColorStop(0.5, col); g.addColorStop(0.9, shade(col, -0.42)); g.addColorStop(1, shade(col, -0.25));
  return g;
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
// An orthonormal pair perpendicular to `u`.
function perp(u) {
  let p1 = V.cross(u, [0, 0, 1]);
  if (V.len(p1) < 0.2) p1 = V.cross(u, [1, 0, 0]);
  p1 = V.norm(p1);
  return [p1, V.cross(u, p1)];
}

// o: { kit, goalie, num, name, skin, hair, camPos, stick, gloves, helmet, jerseyUp, react,
//      blood (0..1 on the sweater), face: 'cage' | 'visor', style: 'full' | 'refl' }
export function drawBody(ctx, P, J, o) {
  const pr = J.map((j) => (j ? P(j[0], j[1], j[2]) : null));
  for (let i = 0; i < 18; i++) if (!pr[i]) return;
  const refl = o.style === 'refl';
  const s0 = pr[1].s;
  const lod = refl ? 0 : s0 < 5.5 ? 0 : s0 < 15 ? 1 : 2;
  const K = o.kit, gk = !!o.goalie;
  const cam = o.camPos;
  const toCam = (p) => V.norm(V.sub(cam, p));
  const W = (p) => (p ? P(p[0], p[1], p[2]) : null);
  const lw = refl ? 0 : Math.max(1.1, s0 * 0.045);
  const parts = [];
  const add = (d, path, paint) => parts.push({ d, path, paint });

  // ── the body frame ────────────────────────────────────────────────────────
  const U = V.norm(V.sub(J[2], J[0]));
  const ortho = (v) => V.norm(V.sub(v, V.mul(U, V.dot(v, U))));
  const Ss = ortho(V.sub(J[4], J[7])), Sh = ortho(V.sub(J[10], J[13]));
  const F = V.cross(Ss, U);                     // the way his chest faces
  const tl = V.len(V.sub(J[2], J[0]));

  // ── primitives ────────────────────────────────────────────────────────────
  const limb = (A, B, ra, rb, col, extra, dBias = 0) => {
    const a = W(A), b = W(B); if (!a || !b) return;
    const pa = Math.max(0.6, ra * a.s), pb = Math.max(0.6, rb * b.s);
    add((a.d + b.d) / 2 + dBias, () => taper(ctx, a, b, pa, pb), () => {
      taper(ctx, a, b, pa, pb);
      ctx.fillStyle = lod ? limbGrad(ctx, a, b, pa, pb, col) : col; ctx.fill();
      if (lod === 2) { ctx.strokeStyle = shade(col, -0.55); ctx.lineWidth = Math.max(0.5, lw * 0.45); ctx.stroke(); }
      if (extra && !refl) extra(a, b);
    });
  };
  const ball = (C, r, col, dBias = 0) => {
    const c = W(C); if (!c) return;
    const pr2 = Math.max(0.6, r * c.s);
    add(c.d + dBias, () => { ctx.beginPath(); ctx.arc(c.x, c.y, pr2, 0, TAU); }, () => {
      ctx.beginPath(); ctx.arc(c.x, c.y, pr2, 0, TAU);
      ctx.fillStyle = lod ? ballGrad(ctx, c, pr2, col) : col; ctx.fill();
    });
  };
  // A band around a limb at fraction t from A to B, drawn on the half that faces the camera.
  const ring = (A, B, t, r, col, w) => {
    if (lod === 0) return;
    const u = V.norm(V.sub(B, A)), [p1, p2] = perp(u), c = V.lerp(A, B, t);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.8, w * (W(c)?.s || 1)); ctx.lineCap = 'butt';
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * TAU, n = V.add(V.mul(p1, Math.cos(a)), V.mul(p2, Math.sin(a)));
      const q = V.add(c, V.mul(n, r));
      if (V.dot(n, toCam(q)) > -0.05) { const s = W(q); if (!s) { pen = false; continue; } if (pen) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); pen = true; }
      else pen = false;
    }
    ctx.stroke(); ctx.lineCap = 'round';
  };
  const ringAt = (A, B, ra, rb, t, col, w) => ring(A, B, t, lerp(ra, rb, t) * 1.03, col, w);

  // ── legs: skates, socks over shin pads, breezers ─────────────────────────
  const missing = o.missing || {};
  const stump = (C, r) => {
    const c = W(C); if (!c) return;
    add(c.d - 0.03, () => { ctx.beginPath(); ctx.arc(c.x, c.y, r * c.s, 0, TAU); }, () => {
      ctx.fillStyle = '#7a0a10'; ctx.beginPath(); ctx.arc(c.x, c.y, r * c.s, 0, TAU); ctx.fill();
      if (lod) { ctx.fillStyle = '#e9e1cf'; ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.35 * c.s, 0, TAU); ctx.fill(); }
    });
  };
  for (const [hip, kn, an, toe, side] of [[10, 11, 12, 16, 1], [13, 14, 15, 17, -1]]) {
    const A = J[an], T = J[toe];
    if (missing[side > 0 ? 'legL' : 'legR'] && !gk) {
      const thighEnd = V.lerp(J[hip], J[kn], 0.86);
      limb(J[hip], thighEnd, 0.6, 0.52, K.pants);
      limb(thighEnd, J[kn], 0.4, 0.34, K.sock);
      stump(J[kn], 0.24);
      continue;
    }
    const fw = V.norm([T[0] - A[0], T[1] - A[1], 0]);
    const heel = [A[0] - fw[0] * 0.3, A[1] - fw[1] * 0.3, 0.32];
    const toeC = [T[0] + fw[0] * 0.02, T[1] + fw[1] * 0.02, 0.2];
    // the holder and the steel come first, so the boot sits on them
    const h0 = W([heel[0], heel[1], 0.2]), h1 = W([toeC[0], toeC[1], 0.17]);
    const r0 = W([heel[0] - fw[0] * 0.08, heel[1] - fw[1] * 0.08, 0.03]), r1 = W([toeC[0] + fw[0] * 0.18, toeC[1] + fw[1] * 0.18, 0.03]);
    if (h0 && h1 && r0 && r1) {
      add((h0.d + h1.d) / 2 + 0.01, () => poly(ctx, [h0, h1, r1, r0]), () => {
        poly(ctx, [h0, h1, r1, r0]); ctx.fillStyle = refl ? '#9aa2aa' : HOLDER; ctx.fill();
        if (!refl) {
          ctx.strokeStyle = STEEL; ctx.lineWidth = Math.max(1, 0.06 * h0.s); ctx.beginPath(); ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.stroke();
          if (lod === 2) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(0.5, 0.02 * h0.s); ctx.beginPath(); ctx.moveTo(lerp(r0.x, r1.x, 0.2), lerp(r0.y, r1.y, 0.2) - 0.02 * h0.s); ctx.lineTo(lerp(r0.x, r1.x, 0.7), lerp(r0.y, r1.y, 0.7) - 0.02 * h0.s); ctx.stroke(); }
        }
      });
    }
    limb(heel, toeC, 0.25, 0.18, BOOT, (a, b) => {
      if (lod === 2) { ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.05 * a.s; ctx.beginPath(); ctx.moveTo(lerp(a.x, b.x, 0.25), lerp(a.y, b.y, 0.25) - 0.1 * a.s); ctx.lineTo(lerp(a.x, b.x, 0.85), lerp(a.y, b.y, 0.85) - 0.07 * a.s); ctx.stroke(); }
    });
    limb(V.add(A, [0, 0, 0.05]), [A[0] + fw[0] * 0.18, A[1] + fw[1] * 0.18, 0.38], 0.27, 0.24, BOOT);
    limb([heel[0] - fw[0] * 0.02, heel[1] - fw[1] * 0.02, 0.45], [A[0] - fw[0] * 0.24, A[1] - fw[1] * 0.24, 0.8], 0.075, 0.06, '#26272c');
    if (gk) {
      // pads: a big tapered block from above the knee to the boot, with knee rolls
      const top = V.add(J[kn], [0, 0, 0.35]), bot = V.add(A, [0, 0, -0.15]);
      limb(top, bot, 0.5, 0.46, '#eef0f2', (a, b) => {
        ringAt(top, bot, 0.5, 0.46, 0.14, K.jersey, 0.16); ringAt(top, bot, 0.5, 0.46, 0.27, K.jersey, 0.1);
        ringAt(top, bot, 0.5, 0.46, 0.62, K.trim, 0.06);
      }, -0.03);
      limb(J[hip], J[kn], 0.48, 0.44, '#e3e6e9', (a, b) => ringAt(J[hip], J[kn], 0.48, 0.44, 0.7, K.jersey, 0.12));
    } else {
      limb(J[kn], A, 0.4, 0.27, K.sock, () => {
        ringAt(J[kn], A, 0.4, 0.27, 0.3, K.trim, 0.13); ringAt(J[kn], A, 0.4, 0.27, 0.47, K.trim, 0.13);
      });
      ball(V.add(J[kn], V.mul(F, 0.1)), 0.39, K.sock, -0.02);
      // breezers: big through the hip and flared at the hem, the hockey silhouette
      const thighEnd = V.lerp(J[hip], J[kn], 0.86);
      limb(J[hip], thighEnd, 0.6, 0.52, K.pants, () => {
        ringAt(J[hip], thighEnd, 0.6, 0.52, 0.94, shade(K.pants, -0.4), 0.1);
        // the stripe down the outside of the breezers
        if (lod) {
          const out = V.mul(Sh, side);
          const a = V.add(J[hip], V.mul(out, 0.6)), b = V.add(thighEnd, V.mul(out, 0.52));
          if (V.dot(out, toCam(a)) > 0) { const pa = W(a), pb = W(b); if (pa && pb) { ctx.strokeStyle = K.trim; ctx.lineWidth = Math.max(1, 0.1 * pa.s); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); } }
        }
      });
    }
  }
  limb(J[10], J[13], gk ? 0.66 : 0.64, gk ? 0.66 : 0.64, K.pants, null, -0.01);

  // ── torso ────────────────────────────────────────────────────────────────
  const ju = o.jerseyUp || 0;
  const RINGS = (gk ? GK_RINGS : SK_RINGS).slice();
  const rings = RINGS.map(([f, rs, rf, off]) => {
    const S = V.norm(V.lerp(Sh, Ss, clamp(f, 0, 1))), Fr = V.cross(S, U);
    return { c: V.add(V.add(J[0], V.mul(U, f * tl)), V.mul(Fr, off)), S, F: Fr, rs, rf };
  });
  if (ju > 0.3) {
    // the sweater hauled up over his head: one more cross-section up where his head is
    const k = clamp((ju - 0.3) / 0.7, 0, 1);
    rings[4] = { ...rings[4], rs: lerp(0.5, 0.62, k), rf: lerp(0.34, 0.5, k) };
    rings.push({ c: V.add(J[3], [0, 0, 0.25 * k]), S: Ss, F, rs: 0.55 * k + 0.1, rf: 0.5 * k + 0.1 });
  }
  const ringPt = (r, a, scale = 1) => V.frame(r.c, r.S, Math.cos(a) * r.rs * scale, r.F, Math.sin(a) * r.rf * scale);
  const tpts = [];
  for (const r of rings) for (let i = 0; i < 12; i++) { const p = W(ringPt(r, (i / 12) * TAU)); if (p) tpts.push(p); }
  const th = hull(tpts);
  const chestP = W(rings[2].c);
  if (th.length > 2 && chestP) {
    add(chestP.d, () => poly(ctx, th), () => {
      poly(ctx, th);
      let fill = K.jersey;
      if (lod) {
        const Lp = V.norm(V.sub(LW, V.mul(U, V.dot(LW, U))));
        const a = W(V.add(rings[2].c, V.mul(Lp, 0.8))), b = W(V.sub(rings[2].c, V.mul(Lp, 0.8)));
        if (a && b) { const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, shade(K.jersey, 0.26)); g.addColorStop(0.42, K.jersey); g.addColorStop(1, shade(K.jersey, -0.45)); fill = g; }
      }
      ctx.fillStyle = fill; ctx.fill();
      if (refl) return;
      if (lod) {
        // top light falling off down the body, and the shoulder pads catching it
        const top = W(rings[3].c), bot = W(rings[0].c);
        if (top && bot) { const g = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)'); poly(ctx, th); ctx.fillStyle = g; ctx.fill(); }
        if (lod === 2) { poly(ctx, th); ctx.strokeStyle = shade(K.jersey, -0.55); ctx.lineWidth = Math.max(0.5, lw * 0.45); ctx.stroke(); }
      }
      torsoDetail();
    });
  }
  const torsoDetail = () => {
    if (lod === 0) return;
    if (K.stripes) {
      // an official's sweater: vertical stripes, clipped to the torso, following its frame
      ctx.save(); poly(ctx, th); ctx.clip();
      ctx.strokeStyle = '#141414'; ctx.lineWidth = Math.max(0.8, 0.14 * s0);
      const r2 = rings[2]; ctx.beginPath();
      for (let k = -5; k <= 5; k++) {
        const a = W(V.frame(r2.c, r2.S, k * 0.22, U, -1.6, r2.F, 0.5)), b = W(V.frame(r2.c, r2.S, k * 0.22, U, 1.4, r2.F, 0.5));
        if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke(); ctx.restore();
      return;
    }
    // hem stripes, wrapped round the body
    const hem = (f, col, w) => {
      const r0 = rings[0], r1 = rings[1], k = (f - RINGS[0][0]) / (RINGS[1][0] - RINGS[0][0]);
      const r = { c: V.lerp(r0.c, r1.c, k), S: V.norm(V.lerp(r0.S, r1.S, k)), F: V.norm(V.lerp(r0.F, r1.F, k)), rs: lerp(r0.rs, r1.rs, k) * 1.02, rf: lerp(r0.rf, r1.rf, k) * 1.02 };
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.8, w * s0); ctx.lineCap = 'butt'; ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * TAU, q = ringPt(r, a), n = V.norm(V.add(V.mul(r.S, Math.cos(a)), V.mul(r.F, Math.sin(a))));
        if (V.dot(n, toCam(q)) > -0.05) { const s = W(q); if (s) { if (pen) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); pen = true; continue; } }
        pen = false;
      }
      ctx.stroke(); ctx.lineCap = 'round';
    };
    hem(0.0, K.trim, 0.13); hem(0.1, K.trim, 0.06);
    // a surface frame at angle `a` round the chest ring: origin, reading direction, down
    const surf = (ri, a, lift) => {
      const r = rings[ri], n = V.norm(V.add(V.mul(r.S, Math.cos(a)), V.mul(r.F, Math.sin(a))));
      const o2 = V.add(ringPt(r, a, 1.01), V.mul(U, lift || 0));
      const x = V.norm(V.cross(U, n));       // tangent, reading left to right as you face it
      return { o: o2, n, x, y: V.mul(U, -1) };
    };
    const decal = (fr, wft, hft, draw) => {
      const facing = V.dot(fr.n, toCam(fr.o));
      if (facing < 0.12) return;
      const o2 = W(fr.o), ex = W(V.add(fr.o, fr.x)), ey = W(V.add(fr.o, fr.y));
      if (!o2 || !ex || !ey) return;
      ctx.save();
      ctx.globalAlpha = clamp((facing - 0.12) * 4, 0, 1);
      ctx.transform(ex.x - o2.x, ex.y - o2.y, ey.x - o2.x, ey.y - o2.y, o2.x, o2.y);
      draw(wft, hft);
      ctx.restore();
    };
    if (ju < 0.5) {
      // the number across the back, a nameplate over it
      decal(surf(2, -Math.PI / 2, -0.05), 0.62, 0.78, () => {
        ctx.font = NUM_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.scale(0.0072, 0.0082);
        ctx.lineJoin = 'round'; ctx.lineWidth = 22; ctx.strokeStyle = shade(K.jersey, -0.55); ctx.strokeText(String(o.num ?? ''), 0, 8);
        ctx.fillStyle = K.trim; ctx.fillText(String(o.num ?? ''), 0, 8);
        ctx.restore();
      });
      if (lod === 2 && o.name) decal(surf(3, -Math.PI / 2, -0.06), 0.8, 0.2, () => {
        ctx.font = NAME_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.scale(0.0022, 0.0024); ctx.fillStyle = K.trim; ctx.fillText(String(o.name).toUpperCase(), 0, 0, 380); ctx.restore();
      });
      // the crest on the chest
      decal(surf(2, Math.PI / 2, 0.02), 0.6, 0.6, () => {
        ctx.fillStyle = K.trim; ctx.beginPath(); ctx.arc(0, 0, 0.33, 0, TAU); ctx.fill();
        ctx.lineWidth = 0.05; ctx.strokeStyle = shade(K.jersey, -0.4); ctx.stroke();
        ctx.fillStyle = K.jersey; ctx.beginPath();
        if (K.crest === 'v') { ctx.moveTo(-0.21, -0.2); ctx.lineTo(0, 0.24); ctx.lineTo(0.21, -0.2); ctx.lineTo(0.1, -0.2); ctx.lineTo(0, 0.04); ctx.lineTo(-0.1, -0.2); }
        else if (K.crest === 'd') { ctx.moveTo(0, -0.26); ctx.lineTo(0.2, 0); ctx.lineTo(0, 0.26); ctx.lineTo(-0.2, 0); }
        else { ctx.arc(0, 0, 0.16, 0, TAU); }
        ctx.closePath(); ctx.fill();
      });
      // a laced V at the collar
      decal(surf(4, Math.PI / 2, -0.02), 0.3, 0.3, () => {
        ctx.fillStyle = K.trim; ctx.beginPath(); ctx.moveTo(-0.17, -0.02); ctx.lineTo(0, 0.32); ctx.lineTo(0.17, -0.02); ctx.lineTo(0.09, -0.02); ctx.lineTo(0, 0.18); ctx.lineTo(-0.09, -0.02); ctx.closePath(); ctx.fill();
        if (lod === 2) { ctx.strokeStyle = shade(K.trim, -0.4); ctx.lineWidth = 0.02; ctx.beginPath(); for (let i = 0; i < 3; i++) { const y = 0.05 + i * 0.07; ctx.moveTo(-0.05, y); ctx.lineTo(0.05, y + 0.03); } ctx.stroke(); }
      });
    }
    // somebody else's blood on the sweater, and his own
    if ((o.blood || 0) > 0.05) {
      const r = (() => { let s = hash(o.name || o.num || 'x'); return () => { s = Math.imul(s ^ s >>> 15, 2246822507) >>> 0; s ^= s >>> 13; return (s >>> 0) / 4294967296; }; })();
      const n = Math.round(2 + o.blood * 6);
      for (let i = 0; i < n; i++) {
        const fr = surf(r() < 0.6 ? 2 : 1, Math.PI / 2 + (r() - 0.5) * 2.2, (r() - 0.5) * 0.4);
        decal(fr, 0.2, 0.2, () => {
          ctx.fillStyle = 'rgba(110,8,12,0.85)'; const rr = 0.05 + r() * 0.1 * o.blood;
          ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 1.3, 0, 0, TAU); ctx.fill();
          ctx.fillRect(-rr * 0.2, 0, rr * 0.4, rr * (2 + r() * 3));
        });
      }
    }
  };

  // ── arms ─────────────────────────────────────────────────────────────────
  for (const [sh, el, hd, side] of [[4, 5, 6, 1], [7, 8, 9, -1]]) {
    const S = J[sh], E = J[el], H = J[hd];
    const dir = V.norm(V.sub(H, E));
    const wrist = V.sub(H, V.mul(dir, gk ? 0.15 : 0.32));
    const ar = gk ? 1.3 : 1;
    const sleeveLines = K.stripes ? (a, b) => {
      if (lod === 0) return;
      ctx.strokeStyle = '#141414'; ctx.lineWidth = Math.max(0.6, 0.07 * a.s);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, off = 0.12 * a.s;
      ctx.beginPath(); for (const k of [-1, 1]) { ctx.moveTo(a.x + nx * off * k, a.y + ny * off * k); ctx.lineTo(b.x + nx * off * k, b.y + ny * off * k); } ctx.stroke();
    } : null;
    ball(V.add(S, V.mul(U, 0.08)), 0.47 * ar, K.jersey, -0.01);
    limb(S, E, 0.41 * ar, 0.35 * ar, K.jersey, sleeveLines);
    ball(E, 0.34 * ar, K.jersey, -0.01);
    if (missing[side > 0 ? 'armL' : 'armR'] && !gk) { stump(V.add(E, V.mul(V.norm(V.sub(H, E)), 0.15)), 0.2); continue; }
    limb(E, wrist, 0.34 * ar, 0.36 * ar, K.jersey, K.stripes ? sleeveLines : () => { ringAt(E, wrist, 0.34 * ar, 0.36 * ar, 0.42, K.trim, 0.13); ringAt(E, wrist, 0.34 * ar, 0.36 * ar, 0.6, K.trim, 0.08); });
    if (gk && side > 0) {
      // the trapper: a disc in the plane facing the shooter, with a laced pocket
      const nrm = F, [a1, a2] = perp(nrm), c = V.add(H, V.mul(dir, 0.15));
      const pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; const p = W(V.frame(c, a1, Math.cos(a) * 0.62, a2, Math.sin(a) * 0.7)); if (p) pts.push(p); }
      const cc = W(c);
      if (pts.length > 3 && cc) add(cc.d - 0.06, () => poly(ctx, pts), () => {
        poly(ctx, pts); ctx.fillStyle = lod ? ballGrad(ctx, cc, 0.65 * cc.s, shade(K.trim, -0.05)) : K.trim; ctx.fill();
        if (!refl && lod) {
          ctx.strokeStyle = shade(K.jersey, -0.2); ctx.lineWidth = Math.max(1, 0.08 * cc.s); poly(ctx, pts); ctx.stroke();
          const t1 = W(V.add(c, V.mul(a2, 0.55))), t2 = W(V.sub(c, V.mul(a2, 0.1)));
          if (t1 && t2) { ctx.strokeStyle = shade(K.trim, -0.45); ctx.lineWidth = Math.max(0.8, 0.05 * cc.s); ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke(); }
        }
      });
    } else if (gk) {
      // the blocker: a board facing the shooter
      const nrm = F, up = V.norm(V.sub(V.mul(U, 1), V.mul(nrm, V.dot(U, nrm)))), sd = V.cross(nrm, up);
      const c = V.add(H, V.mul(nrm, 0.12));
      const q = [[-0.38, -0.55], [0.38, -0.55], [0.38, 0.6], [-0.38, 0.6]].map(([a, b]) => W(V.frame(c, sd, a, up, b)));
      const cc = W(c);
      if (q.every(Boolean) && cc) add(cc.d - 0.06, () => poly(ctx, q), () => {
        poly(ctx, q); ctx.fillStyle = '#eceef1'; ctx.fill();
        if (!refl && lod) {
          const b0 = W(V.frame(c, sd, -0.38, up, 0.05)), b1 = W(V.frame(c, sd, 0.38, up, 0.05)), b2 = W(V.frame(c, sd, 0.38, up, 0.25)), b3 = W(V.frame(c, sd, -0.38, up, 0.25));
          if (b0 && b1 && b2 && b3) { poly(ctx, [b0, b1, b2, b3]); ctx.fillStyle = K.jersey; ctx.fill(); }
          poly(ctx, q); ctx.strokeStyle = '#9aa3ab'; ctx.lineWidth = Math.max(0.6, 0.04 * cc.s); ctx.stroke();
        }
      });
    } else if (o.gloves !== false) {
      // a gauntlet: cuff, then the hand block, then the thumb
      const cuff0 = V.sub(wrist, V.mul(dir, 0.22)), palm = V.add(H, V.mul(dir, 0.16));
      limb(cuff0, wrist, 0.34, 0.38, K.glove, () => ringAt(cuff0, wrist, 0.34, 0.38, 0.55, K.trim, 0.12), -0.02);
      limb(wrist, palm, 0.34, 0.28, shade(K.glove, 0.08), null, -0.03);
      const [p1] = perp(dir);
      limb(V.add(V.lerp(wrist, palm, 0.4), V.mul(p1, 0.22 * side)), V.add(palm, V.mul(p1, 0.25 * side)), 0.12, 0.1, shade(K.glove, -0.1), null, -0.035);
    } else {
      // gloves off: a taped wrist and a bare fist
      limb(wrist, H, 0.19, 0.18, o.skin, null, -0.02);
      ball(V.add(H, V.mul(dir, 0.08)), 0.23, o.skin, -0.03);
      if (lod === 2 && !refl) {
        const k = W(V.add(H, V.mul(dir, 0.2)));
        if (k && (o.react > 0.2 || (o.blood || 0) > 0.3)) add(k.d - 0.04, () => { ctx.beginPath(); ctx.arc(k.x, k.y, 0.07 * k.s, 0, TAU); }, () => { ctx.fillStyle = 'rgba(140,10,16,0.8)'; ctx.beginPath(); ctx.arc(k.x, k.y, 0.07 * k.s, 0, TAU); ctx.fill(); });
      }
    }
  }

  // ── head ─────────────────────────────────────────────────────────────────
  const Hc = J[3];
  const hp = W(Hc);
  if (missing.head) stump(J[2], 0.24);
  else if (hp && ju <= 0.3) {
    limb(J[2], V.add(Hc, V.mul(U, -0.3)), 0.26, 0.24, o.helmet === false ? o.skin : '#202228', null, 0.02);
    add(hp.d - 0.01, () => { ctx.beginPath(); ctx.arc(hp.x, hp.y, (gk ? 0.58 : 0.53) * hp.s, 0, TAU); }, () => drawHead());
  }
  const drawHead = () => {
    const R = gk ? 0.58 : 0.53, r = R * hp.s;
    // the head's own frame: forward is the chest's, levelled a little
    const Fh = V.norm([F[0], F[1], F[2] * 0.4 - 0.05]), Sd = V.norm(V.cross([0, 0, 1], Fh)), Uh = V.cross(Fh, Sd);
    const tc = toCam(Hc), facing = V.dot(Fh, tc);
    const at = (f, sd, u) => W(V.frame(Hc, Fh, f, Sd, sd, Uh, u));
    const helmetCol = gk ? '#eef0f2' : K.helmet;
    const shell = () => {
      ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, TAU);
      ctx.fillStyle = lod ? ballGrad(ctx, hp, r, helmetCol) : helmetCol; ctx.fill();
      if (refl || lod === 0) return;
      // a ridge down the crown and the vents either side of it
      ctx.strokeStyle = shade(helmetCol, 0.35); ctx.lineWidth = Math.max(0.7, 0.05 * hp.s); ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= 12; i++) {
        const a = -0.2 + (i / 12) * 2.2, d = V.frame([0, 0, 0], Uh, Math.cos(a), Fh, Math.sin(a) - 0.0);
        const q = V.add(Hc, V.mul(V.norm([d[0] - Fh[0] * 0.0, d[1], d[2]]), R * 1.01)), qn = V.norm(V.sub(q, Hc));
        if (V.dot(qn, toCam(q)) > 0) { const s = W(q); if (s) { if (pen) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); pen = true; continue; } }
        pen = false;
      }
      ctx.stroke();
      // ear guards
      for (const sd of [1, -1]) {
        const c = V.frame(Hc, Sd, sd * R * 0.93, Uh, -R * 0.25, Fh, R * 0.05);
        if (V.dot(V.mul(Sd, sd), toCam(c)) > 0.15) { const p = W(c); if (p) { ctx.fillStyle = shade(helmetCol, -0.3); ctx.beginPath(); ctx.arc(p.x, p.y, 0.15 * p.s, 0, TAU); ctx.fill(); ctx.fillStyle = shade(helmetCol, -0.55); ctx.beginPath(); ctx.arc(p.x, p.y, 0.06 * p.s, 0, TAU); ctx.fill(); } }
      }
      // the brim over the face
      ctx.strokeStyle = shade(helmetCol, -0.45); ctx.lineWidth = Math.max(0.8, 0.07 * hp.s); ctx.beginPath(); pen = false;
      for (let i = 0; i <= 10; i++) {
        const a = -1.25 + (i / 10) * 2.5, q = V.frame(Hc, Fh, Math.cos(a) * R * 1.0, Sd, Math.sin(a) * R * 1.0, Uh, -R * 0.02);
        const qn = V.norm(V.sub(q, Hc));
        if (V.dot(qn, toCam(q)) > 0) { const s = W(q); if (s) { if (pen) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); pen = true; continue; } }
        pen = false;
      }
      ctx.stroke();
    };
    const face = () => {
      const pts = [[0.36, 0.25, -0.02], [0.36, -0.25, -0.02], [0.33, 0.31, -0.25], [0.33, -0.31, -0.25], [0.2, 0.27, -0.46], [0.2, -0.27, -0.46], [0.3, 0, -0.6], [0.36, 0.14, -0.55], [0.36, -0.14, -0.55]]
        .map(([f, sd, u]) => at(f, sd, u)).filter(Boolean);
      const fh = hull(pts);
      if (fh.length < 3) return;
      poly(ctx, fh);
      const fc = at(0.3, 0, -0.25);
      ctx.fillStyle = lod && fc ? ballGrad(ctx, fc, 0.42 * hp.s, o.skin) : o.skin; ctx.fill();
      if (refl || lod === 0) return;
      if (lod === 2) { poly(ctx, fh); ctx.strokeStyle = shade(o.skin, -0.5); ctx.lineWidth = Math.max(0.5, 0.025 * hp.s); ctx.stroke(); }
      const vis = (f, sd, u) => V.dot(V.norm([Fh[0] * f + Sd[0] * sd, Fh[1] * f + Sd[1] * sd, Fh[2] * f + Sd[2] * sd]), tc) > 0.1;
      // brow, eyes, nose, mouth, in the head's frame, each drawn only when it faces us
      for (const sd of [0.13, -0.13]) {
        if (!vis(1, sd * 2.2, 0)) continue;
        const e = at(0.41, sd, -0.15), b0 = at(0.43, sd - 0.07, -0.07), b1 = at(0.43, sd + 0.07, -0.08);
        if (e) {
          if (lod === 2) { ctx.fillStyle = '#efe9e0'; ctx.beginPath(); ctx.ellipse(e.x, e.y, 0.055 * hp.s, 0.03 * hp.s, 0, 0, TAU); ctx.fill(); }
          ctx.fillStyle = '#1b1012'; ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(0.6, 0.026 * hp.s), 0, TAU); ctx.fill();
          if ((o.react > 0.3 || (o.blood || 0) > 0.6) && sd > 0) { ctx.fillStyle = 'rgba(80,30,90,0.45)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 0.02 * hp.s, 0.09 * hp.s, 0.06 * hp.s, 0, 0, TAU); ctx.fill(); }
        }
        if (b0 && b1) { ctx.strokeStyle = shade(o.hair || '#2a1c14', -0.1); ctx.lineWidth = Math.max(0.6, 0.035 * hp.s); ctx.beginPath(); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.stroke(); }
      }
      const n0 = at(0.44, 0, -0.14), n1 = at(0.53, 0, -0.29), n2 = at(0.44, 0, -0.33);
      if (n0 && n1 && n2) { ctx.fillStyle = shade(o.skin, -0.15); ctx.beginPath(); ctx.moveTo(n0.x, n0.y); ctx.lineTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = shade(o.skin, -0.45); ctx.lineWidth = Math.max(0.5, 0.02 * hp.s); ctx.stroke(); }
      const m0 = at(0.4, 0.09, -0.44), m1 = at(0.41, -0.09, -0.44);
      if (m0 && m1) { ctx.strokeStyle = '#4a1f1c'; ctx.lineWidth = Math.max(0.6, 0.03 * hp.s); ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke(); }
      // a man who has been hit bleeds from the nose and the mouth
      if (o.react > 0.15 || (o.blood || 0) > 0.25) {
        const a = at(0.47, 0.02, -0.32), b = at(0.4, 0.03, -0.62), c2 = at(0.41, -0.05, -0.46), d2 = at(0.37, -0.06, -0.64);
        if (a && b) { ctx.strokeStyle = 'rgba(150,8,14,0.9)'; ctx.lineWidth = Math.max(0.8, 0.05 * hp.s); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        if (c2 && d2) { ctx.lineWidth = Math.max(0.6, 0.035 * hp.s); ctx.beginPath(); ctx.moveTo(c2.x, c2.y); ctx.lineTo(d2.x, d2.y); ctx.stroke(); }
      }
    };
    const ear = (sd) => {
      const c = V.frame(Hc, Sd, sd * R * 0.88, Uh, -R * 0.3, Fh, 0);
      if (V.dot(V.mul(Sd, sd), toCam(c)) < 0.15) return;
      const p = W(c); if (!p) return;
      ctx.fillStyle = shade(o.skin, -0.12); ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.08 * p.s, 0.13 * p.s, 0, 0, TAU); ctx.fill();
    };
    const cage = () => {
      if (refl || lod === 0) return;
      const bars = [];
      const R2 = R * 1.12;
      const pt = (ang, u) => { const rad = R2 * (1 - Math.max(0, -u - 0.2) * 0.35); return V.frame(Hc, Fh, Math.cos(ang) * rad, Sd, Math.sin(ang) * rad, Uh, u); };
      if (o.face === 'visor') {
        const top = [], bot = [];
        for (let i = 0; i <= 10; i++) { const a = -1.15 + (i / 10) * 2.3; top.push(W(pt(a, -0.04))); bot.push(W(pt(a, -0.3))); }
        if (top.every(Boolean) && bot.every(Boolean)) {
          poly(ctx, top.concat(bot.reverse()));
          ctx.fillStyle = 'rgba(190,225,250,0.22)'; ctx.fill();
          ctx.strokeStyle = 'rgba(235,248,255,0.6)'; ctx.lineWidth = Math.max(0.6, 0.025 * hp.s); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(0.6, 0.04 * hp.s); ctx.beginPath(); ctx.moveTo(lerp(top[2].x, bot[8].x, 0.3), lerp(top[2].y, bot[8].y, 0.3)); ctx.lineTo(lerp(top[4].x, bot[6].x, 0.25), lerp(top[4].y, bot[6].y, 0.25)); ctx.stroke();
        }
        return;
      }
      for (const a of [-0.95, -0.55, -0.18, 0.18, 0.55, 0.95]) { const l = []; for (let u = -0.05; u >= -0.66; u -= 0.1) l.push(pt(a, u)); bars.push(l); }
      for (const u of [-0.08, -0.3, -0.5, -0.64]) { const l = []; for (let a = -1.05; a <= 1.051; a += 0.15) l.push(pt(a, u)); bars.push(l); }
      const col = gk ? '#1b1e23' : '#c6ccd2';
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? col : 'rgba(10,12,16,0.55)'; ctx.lineWidth = Math.max(0.6, (pass ? 0.038 : 0.06) * hp.s); ctx.beginPath();
        for (const l of bars) { let pen = false; for (const q of l) { const s = W(q); if (!s) { pen = false; continue; } if (pen) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); pen = true; } }
        ctx.stroke();
      }
    };
    if (o.helmet === false) {
      // bare head: skull, hair over the crown and down the back, ears, the face
      ctx.beginPath(); ctx.arc(hp.x, hp.y, r * 0.88, 0, TAU); ctx.fillStyle = lod ? ballGrad(ctx, hp, r * 0.88, o.skin) : o.skin; ctx.fill();
      const hair = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; for (const u of [0.15, 0.32, 0.4]) { const q = W(V.frame(Hc, Fh, Math.cos(a) * R * 0.86 * (u > 0.35 ? 0.6 : 1) - 0.06, Sd, Math.sin(a) * R * 0.86 * (u > 0.35 ? 0.6 : 1), Uh, u)); if (q) hair.push(q); } }
      const back = W(V.frame(Hc, Fh, -R * 0.55, Uh, -R * 0.25)); if (back) hair.push(back);
      const hh = hull(hair); if (hh.length > 2) { poly(ctx, hh); ctx.fillStyle = o.hair || '#2a1c14'; ctx.fill(); }
      ear(1); ear(-1);
      if (facing > -0.35) face();
      return;
    }
    if (facing > -0.2) { shell(); face(); cage(); }
    else { cage(); shell(); if (lod) { const t = W(V.frame(Hc, Fh, -R * 0.75, Uh, -R * 0.55)); if (t) { ctx.fillStyle = o.hair || '#2a1c14'; ctx.beginPath(); ctx.arc(t.x, t.y, 0.13 * t.s, 0, TAU); ctx.fill(); } } }
    if (!refl && lod && gk) {
      // the keeper's mask carries his club's paint
      ctx.save(); ctx.beginPath(); ctx.arc(hp.x, hp.y, r, 0, TAU); ctx.clip();
      const a = at(-0.1, 0, 0.42), b = at(0.45, 0, 0.0);
      if (a && b) { ctx.strokeStyle = K.jersey; ctx.lineWidth = 0.16 * hp.s; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.restore();
    }
  };

  // ── stick ────────────────────────────────────────────────────────────────
  if (J[18] && J[19] && J[20]) {
    const bt = W(J[18]), hl = W(J[19]), tp = W(J[20]);
    if (bt && hl && tp) {
      const bladeUp = V.mul([0, 0, 1], 0.26);
      const tl2 = W(V.add(J[20], bladeUp)), hu = W(V.add(J[19], V.add(bladeUp, [0, 0, -0.05])));
      add((W(J[9])?.d ?? hl.d) * 0.5 + hl.d * 0.5, () => { taper(ctx, bt, hl, Math.max(0.8, 0.07 * bt.s), Math.max(0.8, 0.06 * hl.s)); }, () => {
        const sw0 = Math.max(0.8, 0.07 * bt.s), sw1 = Math.max(0.8, (gk ? 0.09 : 0.06) * hl.s);
        taper(ctx, bt, hl, sw0, sw1); ctx.fillStyle = refl ? '#3a3d44' : '#24262d'; ctx.fill();
        if (!refl) {
          if (lod) { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = Math.max(0.5, sw1 * 0.5); ctx.beginPath(); ctx.moveTo(lerp(bt.x, hl.x, 0.1), lerp(bt.y, hl.y, 0.1) - sw0 * 0.3); ctx.lineTo(lerp(bt.x, hl.x, 0.85), lerp(bt.y, hl.y, 0.85) - sw1 * 0.3); ctx.stroke(); }
          // knob tape
          const k1 = { x: lerp(bt.x, hl.x, 0.06), y: lerp(bt.y, hl.y, 0.06) };
          taper(ctx, bt, k1, sw0 * 1.15, sw0 * 1.1); ctx.fillStyle = '#e8e6df'; ctx.fill();
        }
        // the blade: a flat plane standing on the ice
        if (tl2 && hu) {
          poly(ctx, [hl, tp, tl2, hu]); ctx.fillStyle = refl ? '#3a3d44' : '#1d1e23'; ctx.fill();
          if (!refl) {
            const m = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
            poly(ctx, [m(hl, tp, 0.12), m(hl, tp, 0.82), m(hu, tl2, 0.82), m(hu, tl2, 0.12)]); ctx.fillStyle = '#f1f0ea'; ctx.fill();
            if (lod === 2) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6; for (let i = 1; i < 6; i++) { const a = m(m(hl, tp, 0.12), m(hl, tp, 0.82), i / 6), b = m(m(hu, tl2, 0.12), m(hu, tl2, 0.82), i / 6); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
          }
        }
      });
    }
  }

  // ── paint ────────────────────────────────────────────────────────────────
  parts.sort((a, b) => b.d - a.d);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (!refl) {
    // one outline under the whole man, so the kit reads as one body and never as stickers
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 2;
    for (const p of parts) { p.path(); ctx.stroke(); }
  }
  for (const p of parts) p.paint();
}

// A part that has come off, drawn from its own few points: a forearm and glove, a shin and
// skate, or a head still in its helmet. `pts` come from rig.makeLimb.
export function drawSevered(ctx, P, l, o) {
  const K = o.kit, pr = l.pts.map((p) => P(p.x, p.y, p.z));
  if (pr.some((p) => !p)) return;
  const s = pr[0].s, lw = Math.max(0.8, s * 0.04);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (a, b, ra, rb, col) => {
    taper(ctx, a, b, ra * a.s + lw, rb * b.s + lw); ctx.fillStyle = INK; ctx.fill();
    taper(ctx, a, b, ra * a.s, rb * b.s); ctx.fillStyle = limbGrad(ctx, a, b, ra * a.s, rb * b.s, col); ctx.fill();
  };
  const raw = (c, r) => { ctx.fillStyle = '#7a0a10'; ctx.beginPath(); ctx.arc(c.x, c.y, r * c.s, 0, TAU); ctx.fill(); ctx.fillStyle = '#e9e1cf'; ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.35 * c.s, 0, TAU); ctx.fill(); };
  if (l.part === 'head') {
    const c = pr[0], r = 0.47 * c.s;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(c.x, c.y, r + lw, 0, TAU); ctx.fill();
    ctx.fillStyle = ballGrad(ctx, c, r, o.helmet === false ? o.skin : K.helmet); ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill();
    // it rolls: the face goes round with it
    const fx = Math.cos(l.rot) * r * 0.55, fy = Math.sin(l.rot) * r * 0.3;
    ctx.fillStyle = o.skin; ctx.beginPath(); ctx.ellipse(c.x + fx, c.y + fy, r * 0.45, r * 0.5, 0, 0, TAU); ctx.fill();
    if (o.face !== 'visor') { ctx.strokeStyle = '#c6ccd2'; ctx.lineWidth = Math.max(0.6, 0.04 * c.s); ctx.beginPath(); for (let k = -2; k <= 2; k++) { ctx.moveTo(c.x + fx + k * r * 0.16, c.y + fy - r * 0.45); ctx.lineTo(c.x + fx + k * r * 0.14, c.y + fy + r * 0.45); } ctx.stroke(); }
    raw({ x: c.x - fx * 0.9, y: c.y - fy * 0.9 + r * 0.6, s: c.s }, 0.2);
    return;
  }
  if (l.part === 'armL' || l.part === 'armR') {
    const [e, h] = pr;
    seg(e, h, 0.28, 0.3, K.jersey);
    if (o.gloves !== false) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(h.x, h.y, 0.3 * h.s + lw, 0, TAU); ctx.fill(); ctx.fillStyle = ballGrad(ctx, h, 0.3 * h.s, K.glove); ctx.beginPath(); ctx.arc(h.x, h.y, 0.3 * h.s, 0, TAU); ctx.fill(); }
    else { ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(h.x, h.y, 0.19 * h.s, 0, TAU); ctx.fill(); }
    raw(e, 0.22);
    return;
  }
  const [k, a, t] = pr;
  seg(k, a, 0.3, 0.19, K.sock);
  seg(a, t, 0.22, 0.15, BOOT);
  ctx.strokeStyle = STEEL; ctx.lineWidth = Math.max(1, 0.06 * a.s); ctx.beginPath(); ctx.moveTo(a.x, a.y + 0.25 * a.s); ctx.lineTo(t.x, t.y + 0.15 * t.s); ctx.stroke();
  raw(k, 0.25);
}
