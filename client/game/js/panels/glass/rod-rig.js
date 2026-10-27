// ROD MODE ON THE WATER: the angler, the rod, the line, the lure, the landing ring and the splash.
//
// A boat seat in rod mode hands the frame `v.rod` (boat-view.js `rodView`), and this draws it in
// whichever view is up. Nothing here decides anything: which clip plays, where the lure is and how
// taut the line is all come from the seat, which reads them off the reel (boatfish.js).
//
//   · THE ANGLER is Deadball's ballplayer (angler.js), skinned on the CPU into the clip's pose and
//     handed to the depth buffer as solids. In the chase view he sits on the aft thwart of the hull
//     the frame draws, through the hull's own model-to-world map (windshield.js `ownHullFrame`, the
//     map drawAircraftModel's `Wp` builds), so he heaves and rolls with her, cel-shaded and inked to
//     gl/cel-figure.js like the ballpark's players. From the seat there's no body, only the rod,
//     posed by the same clip, so it moves as the one in the chase view does.
//   · THE ROD in the chase view is a stroke; from the seat it's a ribbon of solids in the cabin
//     pass, since the world pass clips anything nearer than about a metre.
//   · THE LINE, the lure, the ring and the splash are strokes on the water, in the world pass,
//     depth-tested against everything (berth-marks.js's arrangement).
//
// GLASS 1 has no solids sink, so it gets the strokes and no angler; GLASS 2 is the view this is for.
//
// Units: world tiles relative to the camera's ground point, the frame `emitWire` and drawAircraftModel's
// `Wp` both use. The seat's positions are absolute tiles in the boat's convention (a tile's centre on
// the integer), the same frame as `v.mapCenter + v.mapOffset`, so taking one off the other is all the
// conversion there is.
import { emitWire } from '../windshield.js';
import { boatGeom } from '../../../../shared/boat-house.js';
import { BOAT_ROWS } from '../../../../shared/vehicle-models.js';
import { CEL, CEL_TUNE, celLightJS, celToneJS, celRimJS } from '../gl/cel-figure.js';

let AN = null, anP = null;
const loadAngler = () => anP || (anP = import('../angler.js').then((m) => { AN = m; return m; }).catch(() => null));

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const LINE_RGB = 'rgba(226,232,236,1)';
const RING_RGB = '255,226,150';
const PULL = 0.05;             // strokes on the water are pulled toward the eye by about a crest's height
const KEY = (() => { const l = Math.hypot(0.32, -0.42, 0.85); return [0.32 / l, -0.42 / l, 0.85 / l]; })();

// Record pools: the same objects go into the sink every frame, their points rewritten in place.
const POOL = { body: [], ink: [], rod: [] };
const tri = () => ({ p: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rgb: [0, 0, 0], a: 1 });
const triFP = () => ({ p: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], mp: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rgb: [0, 0, 0], a: 1, interior: 1, mv: 0 });

/**
 * `env`: { sink: OWNSHIP_SINK or null, hull: { SIZE, VS, hdg, pitch, bank, baseWz } in the chase view }.
 */
export function drawRodRig(ctx, cam, v, now, env = {}) {
  const R = v.rod;
  if (!R || !v.mapCenter) return;
  if (!AN) loadAngler();
  const cx = v.mapCenter.x + ((v.mapOffset && v.mapOffset.x) || 0);
  const cy = v.mapCenter.y + ((v.mapOffset && v.mapOffset.y) || 0);
  const W = (x, y, z) => [x - cx, y - cy, z];
  const G = boatGeom(BOAT_ROWS[R.typeId] || BOAT_ROWS[v.cls] || BOAT_ROWS.skiff || BOAT_ROWS.hydro);
  const mpu = G.helm.mPerUnit;
  const b = (R.bearing || 0) * Math.PI / 180, cb = Math.cos(b), sb = Math.sin(b);
  const chase = !!(v.external && env.hull);
  const H = env.hull;

  // ── rig feet → this view's world ──────────────────────────────────────────────────────────────
  let toWorld, toLocal = null;
  if (chase) {
    const hr = (H.hdg || 0) * Math.PI / 180, roll = (H.bank || 0) * Math.PI / 180, pitch = (H.pitch || 0) * Math.PI / 180;
    const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwdX = Math.sin(hr), fwdY = -Math.cos(hr), rgtX = Math.cos(hr), rgtY = Math.sin(hr);
    const S = H.SIZE, VS = H.VS || 1, FT = AN ? AN.FT_M : 0.3048, SEAT = AN ? AN.SEAT_FT : 1.15;
    // The hull's height is drawn VS times its plan, and the man sits in it: below the seat he takes
    // the same stretch (his shins reach the sole), above it none (a stretched man reads as a giant).
    const h0 = G.thwartTop ? G.thwartTop(G.helm.f) : G.helm.z - 0.78 / mpu;
    toWorld = (p) => {
      const y = p[1] <= SEAT ? p[1] : SEAT + (p[1] - SEAT) / VS;
      const f = G.helm.f + (p[2] * cb + p[0] * sb) * FT / mpu;
      const g = G.helm.g + (p[2] * sb - p[0] * cb) * FT / mpu;
      const h = h0 + (y - SEAT) * FT / mpu;
      const f1 = f * cp - h * sp, h1 = f * sp + h * cp;
      const g2 = g * cr + h1 * sr, h2 = -g * sr + h1 * cr;
      return [S * (f1 * fwdX + g2 * rgtX), S * (f1 * fwdY + g2 * rgtY), H.baseWz + S * VS * h2];
    };
  } else {
    // From the seat: eye-relative metres (x right, y forward, z up), the cabin's own frame, with your
    // eye where the seated rig's eye is.
    const S = v.metreTiles > 0 ? v.metreTiles : 1 / 7;
    const hd = ((v.ownHdg != null ? v.ownHdg : v.heading) || 0) * Math.PI / 180, sh = Math.sin(hd), ch = Math.cos(hd), ez = cam.EH;
    const FT = AN ? AN.FT_M : 0.3048, E = AN ? AN.EYE_FT : [0, 3.62, -0.15];
    toLocal = (p, out) => {
      const x = p[0] - E[0], y = p[1] - E[1], z = p[2] - E[2];
      out[0] = (z * sb - x * cb) * FT; out[1] = (z * cb + x * sb) * FT; out[2] = y * FT;
      return out;
    };
    const L = [0, 0, 0];
    toWorld = (p, local) => {
      const q = local || toLocal(p, L);
      return [q[0] * S * ch + q[1] * S * sh, q[0] * S * sh - q[1] * S * ch, ez + q[2] * S];
    };
  }

  // ── the angler and his rod ───────────────────────────────────────────────────────────────────
  let tip = null, butt = null;
  if (AN && R.anim) {
    const P = AN.anglerPose(R.anim, now);
    let sol = null, B = null;
    // From the seat you see the rod and line and no body: David found the arms on their own weird
    // (2026-10-27). The pose still drives the rod, so it casts and bends as the chase view's man does.
    if (env.sink && chase) { B = AN.anglerBody(R.look || {}, 2); sol = AN.skinAngler(B, P, false); }
    else sol = AN.solveAngler(P);
    // The line pulls the rod toward the water out in front of him, and to the side the fish runs.
    const pull = [-(R.pull || 0) * 0.7, -0.45, 1];
    const rod = sol.J && AN.rodPoints(sol.J, pull, R.bend || 0, 10);
    if (rod) {
      butt = toWorld(rod[0]); tip = toWorld(rod[rod.length - 1]);
      if (chase) drawRodStrokes(ctx, cam, rod.map((p) => toWorld(p)), v);
      else if (env.sink) pushRodFP(env.sink, rod, toLocal, toWorld, now, cam);
    }
    if (B && env.sink && chase) pushBody(env.sink, B, chase, toWorld, toLocal, cam, v, now);
  }
  // Without the angler (still loading, or GLASS 1 from the seat): the line leaves from where his
  // rod tip would be, out in front of the seat.
  if (!tip) tip = chase ? toWorld([0, 6.2, 5.5]) : toWorld([0, 4.6, 6.4]);

  // ── the landing ring ─────────────────────────────────────────────────────────────────────────
  if (R.ring) {
    const g = R.ring, c = W(g.x, g.y, 0.01), n = 28;
    const a = clamp(g.a ?? 0.85, 0, 1);
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      emitWire(ctx, cam, [c[0] + Math.cos(a0) * g.r, c[1] + Math.sin(a0) * g.r, c[2]], [c[0] + Math.cos(a1) * g.r, c[1] + Math.sin(a1) * g.r, c[2]],
        2.2, `rgba(${RING_RGB},1)`, a, { pull: PULL, glow: 4, tag: 'rodring' });
    }
    const k = g.r * 0.3;
    emitWire(ctx, cam, [c[0] - k, c[1], c[2]], [c[0] + k, c[1], c[2]], 1.6, `rgba(${RING_RGB},1)`, a * 0.8, { pull: PULL, tag: 'rodring' });
    emitWire(ctx, cam, [c[0], c[1] - k, c[2]], [c[0], c[1] + k, c[2]], 1.6, `rgba(${RING_RGB},1)`, a * 0.8, { pull: PULL, tag: 'rodring' });
  }

  // ── the lure: in the air, or on the water ───────────────────────────────────────────────────
  let end = null;
  if (R.fly) {
    const f = R.fly, L = W(f.x, f.y, f.z), s = clamp(f.s, 0, 1);
    end = [tip[0] + (L[0] - tip[0]) * s, tip[1] + (L[1] - tip[1]) * s, tip[2] + (L[2] - tip[2]) * s + (f.apex || 0) * 4 * s * (1 - s)];
  } else if (R.lure) end = W(R.lure.x, R.lure.y, R.lure.z - (R.lure.dip || 0));
  if (R.fish) {
    // Landed: up out of the water on the line, then swung in over the gunwale into the box.
    const F = R.fish, s = clamp(F.s, 0, 1), from = W(F.x, F.y, F.z);
    const hang = [tip[0], tip[1], tip[2] - (chase ? 0.012 : 0.07)];
    const box = chase ? hullPoint(G, env.hull, (G.S.fishBox ? (G.S.fishBox[0] + G.S.fishBox[1]) / 2 : 0.2) * G.LEN, 0, G.soleZ + 0.02) : toWorld(null, [0.25, 0.9, -0.85]);
    const e = (u) => u * u * (3 - 2 * u);
    end = s < 0.55 ? lerp3(from, hang, e(s / 0.55)) : lerp3(hang, box, e((s - 0.55) / 0.45));
    if (s < 0.55) end[2] += 0.04 * Math.sin(Math.PI * s / 0.55) * (chase ? 0.3 : 1);
  }
  if (end) {
    drawLine(ctx, cam, tip, end, R);
    if (R.fish) drawFish(ctx, cam, end, R.fish, chase);
    else drawFloat(ctx, cam, end);
  }

  // ── the splash where it went in ─────────────────────────────────────────────────────────────
  if (R.splash) drawSplash(ctx, cam, W(R.splash.x, R.splash.y, R.splash.z || 0), R.splash.age || 0);
}

function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// A point on the hull, in the chase view (model units in, camera-relative tiles out).
function hullPoint(G, H, f, g, h) {
  const hr = (H.hdg || 0) * Math.PI / 180, roll = (H.bank || 0) * Math.PI / 180, pitch = (H.pitch || 0) * Math.PI / 180;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f1 = f * cp - h * sp, h1 = f * sp + h * cp, g2 = g * cr + h1 * sr, h2 = -g * sr + h1 * cr;
  return [H.SIZE * (f1 * Math.sin(hr) + g2 * Math.cos(hr)), H.SIZE * (-f1 * Math.cos(hr) + g2 * Math.sin(hr)), H.baseWz + H.SIZE * (H.VS || 1) * h2];
}

// ── the line ───────────────────────────────────────────────────────────────────────────────────
// Out in the air it trails in a curve; at rest it sags to the water; under tension it's straight.
function drawLine(ctx, cam, A, B, R) {
  const n = 16, d = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  const t = clamp(R.tension || 0, 0, 1);
  const sag = R.fly ? d * 0.10 * (1 - clamp(R.fly.s, 0, 1) * 0.6) : R.fish ? d * 0.02 : d * 0.16 * (1 - t) * (1 - t);
  const C = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2 - sag * 2];
  const floor = Math.min(A[2], B[2], 0.002);
  let p = A;
  const alpha = 0.55 + 0.35 * t;
  for (let i = 1; i <= n; i++) {
    const u = i / n, w = 1 - u;
    const q = [w * w * A[0] + 2 * w * u * C[0] + u * u * B[0], w * w * A[1] + 2 * w * u * C[1] + u * u * B[1], Math.max(floor, w * w * A[2] + 2 * w * u * C[2] + u * u * B[2])];
    emitWire(ctx, cam, p, q, 1, LINE_RGB, alpha, { pull: 0.01, tag: 'rodline' });
    p = q;
  }
}

// The float: red under white, a few pixels whatever the range, so you can find it.
function drawFloat(ctx, cam, P) {
  const f = cam.proj ? cam.proj(P[0], P[1], P[2]).f : 1;
  const w = clamp(0.012 * (cam.FL || 600) / Math.max(0.2, f), 3, 9);
  const h = 0.004 + 0.004 * clamp(f / 4, 0, 2);
  emitWire(ctx, cam, [P[0], P[1], P[2] - h * 0.3], [P[0], P[1], P[2] + h * 0.6], w, 'rgba(214,52,34,1)', 1, { pull: PULL, tag: 'rodfloat' });
  emitWire(ctx, cam, [P[0], P[1], P[2] + h * 0.6], [P[0], P[1], P[2] + h * 1.2], w * 0.8, 'rgba(244,240,230,1)', 1, { pull: PULL, glow: 2, tag: 'rodfloat' });
}

// The catch, hanging off the line by its mouth.
function drawFish(ctx, cam, P, F, chase) {
  const lenM = 0.12 + 0.24 * Math.cbrt(Math.max(0.05, F.kg || 1));
  const len = lenM / 7 * (chase ? 0.25 : 1);
  const f = cam.proj ? cam.proj(P[0], P[1], P[2]).f : 1;
  const w = clamp(len * 0.3 * (cam.FL || 600) / Math.max(0.15, f), 2, 40);
  const tail = [P[0], P[1], P[2] - len];
  emitWire(ctx, cam, P, tail, w, 'rgba(176,188,192,1)', 1, { pull: 0.02, tag: 'rodfish' });
  emitWire(ctx, cam, [P[0], P[1], P[2] - len * 0.15], [P[0], P[1], P[2] - len * 0.7], w * 0.45, 'rgba(70,82,88,1)', 0.8, { pull: 0.025, tag: 'rodfish' });
  emitWire(ctx, cam, tail, [tail[0], tail[1], tail[2] - len * 0.22], w * 1.3, 'rgba(120,132,138,1)', 1, { pull: 0.02, tag: 'rodfish' });
}

// Rings going out from where it went in, and a few drops thrown up and coming down.
function drawSplash(ctx, cam, P, age) {
  if (!(age >= 0) || age > 1.6) return;
  for (const [delay, k] of [[0, 1], [0.22, 0.7]]) {
    const a = age - delay;
    if (a <= 0) continue;
    const r = 0.012 + 0.11 * Math.sqrt(a), al = clamp(1 - a / 1.3, 0, 1) * k, n = 20;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      emitWire(ctx, cam, [P[0] + Math.cos(a0) * r, P[1] + Math.sin(a0) * r, P[2] + 0.004], [P[0] + Math.cos(a1) * r, P[1] + Math.sin(a1) * r, P[2] + 0.004],
        1.6, 'rgba(236,244,246,1)', al * 0.8, { pull: PULL, tag: 'rodsplash' });
    }
  }
  if (age < 0.6) {
    for (let i = 0; i < 7; i++) {
      const th = i * 2.4, sp = 0.05 + 0.02 * (i % 3), up = 0.10 + 0.03 * (i % 2);
      const at = (t) => [P[0] + Math.cos(th) * sp * t, P[1] + Math.sin(th) * sp * t, P[2] + up * t - 0.45 * t * t];
      const q0 = at(age), q1 = at(Math.max(0, age - 0.05));
      if (q0[2] < P[2]) continue;
      emitWire(ctx, cam, q1, q0, 2, 'rgba(244,250,252,1)', clamp(1 - age / 0.6, 0, 1), { pull: PULL, tag: 'rodsplash' });
    }
  }
}

// ── the rod, in the chase view: graphite past a cork handle ─────────────────────────────────────
function drawRodStrokes(ctx, cam, pts, v) {
  const handle = Math.max(1, Math.round((pts.length - 1) * ((AN ? AN.HANDLE_FT : 1.25) / (AN ? AN.ROD_FT : 7))));
  for (let i = 1; i < pts.length; i++) {
    const cork = i <= handle;
    // Wider than the rod is at this scale, and lighter than graphite: drawn true it's lost on dark water.
    emitWire(ctx, cam, pts[i - 1], pts[i], cork ? 3 : i > pts.length - 4 ? 1.6 : 2.2, cork ? 'rgba(178,136,90,1)' : 'rgba(70,76,86,1)', 1, { pull: 0.004, tag: 'rod' });
  }
}

// ── the rod from the seat: a ribbon facing the eye, in the cabin pass ───────────────────────────
function pushRodFP(sink, rod, toLocal, toWorld, now, cam) {
  const ox = cam.ox || 0, oy = cam.oy || 0;
  const L = rod.map((p) => toLocal(p, [0, 0, 0]));
  const handle = Math.round((L.length - 1) * ((AN ? AN.HANDLE_FT : 1.25) / (AN ? AN.ROD_FT : 7)));
  let k = 0;
  const quad = (a, b, c, d, rgb) => {
    for (const T of [[a, b, c], [a, c, d]]) {
      const r = POOL.rod[k] || (POOL.rod[k] = triFP());
      k++;
      for (let j = 0; j < 3; j++) {
        const m = T[j], w = toWorld(null, m);
        r.mp[j][0] = m[0]; r.mp[j][1] = m[1]; r.mp[j][2] = m[2];
        r.p[j][0] = w[0] + ox; r.p[j][1] = w[1] + oy; r.p[j][2] = w[2];
      }
      r.rgb[0] = rgb[0]; r.rgb[1] = rgb[1]; r.rgb[2] = rgb[2]; r.mv = now;
      sink.push(r);
    }
  };
  for (let i = 1; i < L.length; i++) {
    const A = L[i - 1], B = L[i];
    const s0 = (i - 1) / (L.length - 1), s1 = i / (L.length - 1);
    const cork = i <= handle;
    const r0 = cork ? 0.013 : 0.0055 * (1 - s0) + 0.0016, r1 = cork ? 0.013 : 0.0055 * (1 - s1) + 0.0016;
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    // across the segment and square to the eye, which is the origin of this frame
    let s = [d[1] * m[2] - d[2] * m[1], d[2] * m[0] - d[0] * m[2], d[0] * m[1] - d[1] * m[0]];
    const sl = Math.hypot(s[0], s[1], s[2]) || 1;
    s = [s[0] / sl, s[1] / sl, s[2] / sl];
    const P = (q, r, sg) => [q[0] + s[0] * r * sg, q[1] + s[1] * r * sg, q[2] + s[2] * r * sg];
    const col = cork ? [150, 112, 72] : [30, 33, 38];
    quad(P(A, r0, -1), P(A, r0, 1), P(B, r1, 1), P(B, r1, -1), col);
  }
  // The reel, under the rod a hand above the butt: a small drum and its foot.
  if (L.length > 3) {
    const A = L[1], B = L[2], d = norm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
    const down = norm(cross(cross(d, [0, 0, 1]), d));
    const c = [A[0] - down[0] * 0.05, A[1] - down[1] * 0.05, A[2] - down[2] * 0.05];
    const side = norm(cross(d, down)), r = 0.028;
    const P = (u, w) => [c[0] + d[0] * u + side[0] * w - down[0] * 0, c[1] + d[1] * u + side[1] * w, c[2] + d[2] * u + side[2] * w];
    const D = (u, w, h) => { const q = P(u, w); return [q[0] - down[0] * h, q[1] - down[1] * h, q[2] - down[2] * h]; };
    quad(D(-r, -r, 0), D(r, -r, 0), D(r, -r, r * 1.6), D(-r, -r, r * 1.6), [128, 134, 140]);
    quad(D(-r, r, 0), D(r, r, 0), D(r, r, r * 1.6), D(-r, r, r * 1.6), [128, 134, 140]);
    quad(D(-r, -r, r * 1.6), D(r, -r, r * 1.6), D(r, r, r * 1.6), D(-r, r, r * 1.6), [96, 100, 106]);
  }
}
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ── the body, as solids, cel-shaded and inked ─────────────────────────────────────────────────
//
// Only the chase view draws him: from the seat you see the rod and no body. He's cel-shaded to
// gl/cel-figure.js, the ballpark's players' look: each face's light rounded to CEL.bands steps, the
// cool shadow tone, the hard rim. Then the ink: every face again, each vertex pushed out along its
// skinned normal by a width held to CEL.inkPx on screen, and back along its own view ray. Moving a
// point along the ray doesn't move it on the screen, so the hull lies behind the body everywhere
// the body covers it and shows only past his edge, as the rink's clip-depth bias does on the GPU.
function pushBody(sink, B, chase, toWorld, toLocal, cam, v, now) {
  if (!chase) return;
  const ox = cam.ox || 0, oy = cam.oy || 0;
  const hr = v.hour == null ? 12 : v.hour;
  const night = hr < 5.5 || hr > 20 ? 1 : hr < 7 ? (7 - hr) / 1.5 : hr > 18.5 ? (hr - 18.5) / 1.5 : 0;
  const dim = 1 - 0.55 * clamp(night, 0, 1);
  const out = B.out, nout = B.nout, col = B.col;
  const ex = cam.ex || 0, ey = cam.ey || 0, ez = cam.EH || 0;
  const cel = !!CEL_TUNE.on;
  // How big a foot of him is on the screen, once, at his middle: the ink's width is held in pixels.
  let inkFt = 0, pushT = 0;
  if (cel && CEL_TUNE.ink && nout && cam.proj && cam.FL) {
    const m = B.n >> 1, P0 = toWorld([out[m * 3], out[m * 3 + 1], out[m * 3 + 2]]);
    const P1 = toWorld([out[m * 3] + 1, out[m * 3 + 1], out[m * 3 + 2]]);
    const tilesPerFt = Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]);
    const f = cam.proj(P0[0], P0[1], P0[2]).f;
    const pxPerFt = tilesPerFt * cam.FL / Math.max(f, 0.06);
    const u = (cam.W || 900) / 900;
    if (pxPerFt > 1e-6) {
      inkFt = clamp(CEL.inkFt, CEL.inkPx[0] * u / pxPerFt, CEL.inkPx[1] * u / pxPerFt);
      pushT = Math.max(inkFt * 4, 0.3) * tilesPerFt;
    }
  }
  const Wv = new Array(3);
  const inkRGB = CEL.ink.map((c) => Math.round(c * 255));
  let k = 0, ki = 0;
  for (let t = 0; t < B.tris; t++) {
    const v0 = t * 3;
    for (let j = 0; j < 3; j++) {
      const i = (v0 + j) * 3;
      Wv[j] = toWorld([out[i], out[i + 1], out[i + 2]]);
    }
    // A folded bone (an open hand while it grips, a fist while it doesn't) is a point: skip it.
    const a = Wv[0], b = Wv[1], c = Wv[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-12)) continue;
    nx /= nl; ny /= nl; nz /= nl;
    // Turned to face the eye: the winding isn't trusted to face out once the limbs are bent.
    const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
    let vx = ex - mx, vy = ey - my, vz = ez - mz;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const d = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
    const r = POOL.body[k] || (POOL.body[k] = tri());
    k++;
    for (let j = 0; j < 3; j++) { r.p[j][0] = Wv[j][0] + ox; r.p[j][1] = Wv[j][1] + oy; r.p[j][2] = Wv[j][2]; }
    const ci = v0 * 3;
    if (cel) {
      const lit = celLightJS(d), rim = celRimJS(1 - (nx * vx + ny * vy + nz * vz), lit);
      for (let ch = 0; ch < 3; ch++) {
        const base = (col[ci + ch] + col[ci + 3 + ch] + col[ci + 6 + ch]) / 3;
        r.rgb[ch] = clamp(celToneJS(base, ch, lit, rim) * dim, 0, 255) | 0;
      }
    } else {
      const sh = (0.58 + 0.42 * d + 0.06 * Math.abs(nz)) * dim;
      for (let ch = 0; ch < 3; ch++) r.rgb[ch] = clamp((col[ci + ch] + col[ci + 3 + ch] + col[ci + 6 + ch]) / 3 * sh, 0, 255) | 0;
    }
    sink.push(r);
    if (!inkFt) continue;
    const q = POOL.ink[ki] || (POOL.ink[ki] = tri());
    let ok = true;
    for (let j = 0; j < 3; j++) {
      const i = (v0 + j) * 3, n0 = nout[i], n1 = nout[i + 1], n2 = nout[i + 2];
      if (!(n0 || n1 || n2)) { ok = false; break; }   // a folded bone's vertex has no normal, and no ink
      const Q = toWorld([out[i] + n0 * inkFt, out[i + 1] + n1 * inkFt, out[i + 2] + n2 * inkFt]);
      let rx = Q[0] - ex, ry = Q[1] - ey, rz = Q[2] - ez;
      const rl = Math.hypot(rx, ry, rz) || 1;
      q.p[j][0] = Q[0] + rx / rl * pushT + ox; q.p[j][1] = Q[1] + ry / rl * pushT + oy; q.p[j][2] = Q[2] + rz / rl * pushT;
    }
    if (!ok) continue;
    ki++;
    q.rgb[0] = inkRGB[0]; q.rgb[1] = inkRGB[1]; q.rgb[2] = inkRGB[2];
    sink.push(q);
  }
}
