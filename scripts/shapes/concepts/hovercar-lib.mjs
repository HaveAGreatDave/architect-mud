// What every hover car's exterior script shares (docs/proposals/hover-cars.md).
//
// A hover car is a body with four ducted fans at its corners, a pusher in the tail, four yaw jets and
// three feet. The body, the trim and the lamps are each car's own, in its own script; the fans, jets,
// feet, glass frame and doors are built here off the car's cabin (client/shared/cabin-<id>.js, made by
// cabin-hovercar.js), so they are the same machinery on every car and sit where that car says.
//
// The Merlin's script (merlin.mjs) is older than this file and keeps its own copies.
//
// Frame: f fore, g right, h up, in the cabin's model units.
import { writeFileSync } from 'node:fs';
import { R, P3, skin, loft, pod, tube, mirror, group, poly as rawPoly, quad, DEG } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh, compileMesh, animFacePoints } = await import('../../../client/shared/vehicle-mesh.js');
const { HOVER_EMBLEMS } = await import('../../../client/shared/hover-car-emblems.js');

export { R, P3, pod, tube, mirror, group, quad, DEG };
export const FINE = { minDetail: 1 }, COARSE = { maxDetail: 0 };
export const poly = (name, faces, extra) => rawPoly(name, faces.map((f) => ({ role: 'nacelle', ...f })), extra);
export const lerp = (a, b, t) => a + (b - a) * t;
export const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
export const P3s = (a) => a.map(P3);

// A face wound so its normal points along `out` (Newell's normal), so culling means what it says.
export function faceOut(pts, out, extra = {}) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const p = nx * out[0] + ny * out[1] + nz * out[2] < 0 ? pts.slice().reverse() : pts;
  return { p: p.map(P3), ...extra };
}
// A box as six outward faces, centred at c with size [f, g, h].
export function boxAt(c, [sf, sg, sh], extra = {}) {
  const f = sf / 2, g = sg / 2, h = sh / 2, P = (a, b, d) => [c[0] + a, c[1] + b, c[2] + d];
  return [
    faceOut([P(-f, -g, h), P(f, -g, h), P(f, g, h), P(-f, g, h)], [0, 0, 1], { sh: 0.86, ...extra }),
    faceOut([P(-f, -g, -h), P(f, -g, -h), P(f, g, -h), P(-f, g, -h)], [0, 0, -1], { sh: 0.4, ...extra }),
    faceOut([P(f, -g, -h), P(f, g, -h), P(f, g, h), P(f, -g, h)], [1, 0, 0], { sh: 0.74, ...extra }),
    faceOut([P(-f, -g, -h), P(-f, g, -h), P(-f, g, h), P(-f, -g, h)], [-1, 0, 0], { sh: 0.55, ...extra }),
    faceOut([P(-f, g, -h), P(f, g, -h), P(f, g, h), P(-f, g, h)], [0, 1, 0], { sh: 0.66, ...extra }),
    faceOut([P(-f, -g, -h), P(f, -g, -h), P(f, -g, h), P(-f, -g, h)], [0, -1, 0], { sh: 0.62, ...extra }),
  ];
}
// A flat disc facing `out`, as a fan of triangles' worth of one polygon.
export function discAt(c, r, out, n = 12, extra = {}) {
  const ax = Math.abs(out[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(out, ax)), v = cross(out, u);
  return faceOut(Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return [c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r]; }), out, extra);
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A maker's emblem (client/shared/hover-car-emblems.js) as faces looking forward: centred at
// (f, g, h), `s` half its size, its field and its mark each in the paint named. The mark stands a
// hair proud of the field.
export function emblem(maker, [f, g, h], s, paints) {
  return HOVER_EMBLEMS[maker].map((pc) => faceOut(pc.p.map(([x, y]) => [f + (pc.tone === 'mark' ? 0.0008 : 0), g + x * s, h + y * s]), [1, 0, 0], { paint: paints[pc.tone], sh: 1 }));
}

// The tint every hover car's glass takes unless its script says otherwise.
export const SMOKED = [12, 14, 18];

export function hoverCarKit(C, { glassTint = SMOKED } = {}) {
  const ST = C.stations, D = C.ducts, DR = C.door, W = C.glass.windscreen, SG = C.glass.side, RW = C.glass.rear;
  const at = (f, a, out = 0) => skin(ST, f, a * DEG, out);
  // The stations a run of faces starts at: a loft region's `at` names the band from that station aft.
  const bandsIn = (f0, f1) => ST.map((s) => s.f).filter((f) => f <= f1 + 1e-9 && f > f0 + 1e-9);
  // A curved patch of skin as a grid of quads, `o` proud of the hull.
  function patch(fs, as, extra, o = 0.0022) {
    const out = [];
    for (let i = 0; i < fs.length - 1; i++) for (let j = 0; j < as.length - 1; j++) {
      out.push(quad(at(fs[i + 1], as[j], o), at(fs[i], as[j], o), at(fs[i], as[j + 1], o), at(fs[i + 1], as[j + 1], o), extra));
    }
    return out;
  }
  const alongF = (fs, a, o = 0.004) => fs.map((f) => at(f, a, o));
  const roundF = (f, as, o = 0.004) => as.map((a) => at(f, a, o));
  // Both sides: fn(A, side, sg) with A mirroring an angle for the left.
  const LR = (fn) => [0, 1].flatMap((s) => fn((a) => (s ? 180 - a : a), s ? 'left' : 'right', s ? -1 : 1));
  const FR = (name, pts, r = 0.005, paint = 'frame') => tube(name, pts, r, { role: 'nacelle', paint, sh: 0.5, sides: 5, ...FINE });

  // ── The body: the loft, with the glass as its own faces ────────────────────────
  // `low` is the carbon band along the sills, as { f: [aft, fore], a: [low, high] } on the keel side;
  // `regions` are the car's own extra panels.
  function body({ low, regions = [], capFore, capAft, shade = { base: 0.6, amp: 0.38 }, note } = {}) {
    const reg = [];
    if (low) reg.push({ at: ST.map((s) => s.f).filter((f) => f < low.f[1] && f > low.f[0]), k: C.faceKs(low.a[0], low.a[1]), paint: 'carbon' });
    reg.push({ at: bandsIn(W.f[0], W.f[1]), k: C.faceKs(W.a[0], W.a[1]), role: 'glass', tint: glassTint });
    reg.push({ at: bandsIn(SG.f[0], SG.f[1]), k: [...C.faceKs(SG.a[0], SG.a[1]), ...C.faceKs(180 - SG.a[1], 180 - SG.a[0])], role: 'glass', tint: glassTint });
    if (RW) reg.push({ at: bandsIn(RW.f[0], RW.f[1]), k: C.faceKs(RW.a[0], RW.a[1]), role: 'glass', tint: glassTint });
    return loft('body', C.sides, ST, { ...FINE, paint: 'hull', note, capFore, capAft, regions: [...reg, ...regions], shade });
  }

  // ── The glasshouse frame: the screen's surround, the pillars, the waist line ───
  function glassFrame({ wiper = true, r = 0.0055 } = {}) {
    const out = [
      FR('screen header', roundF(W.f[0] - 0.003, range(W.a[0], W.a[1], 14)), r),
      FR('screen foot', roundF(W.f[1] + 0.003, range(W.a[0], W.a[1], 14)), r + 0.0005),
    ];
    if (wiper) out.push(FR('wiper', [at(W.f[1] - 0.006, 72, 0.004), at(lerp(W.f[1], W.f[0], 0.3), 96, 0.004)], 0.0028));
    out.push(...LR((A, side) => [
      FR('A-pillar (' + side + ')', alongF(range(W.f[0], W.f[1], 6), A(W.a[0]), 0.004), r + 0.001),
      FR('roof rail (' + side + ')', alongF(range(SG.f[0] - 0.006, Math.min(SG.f[1], W.f[0]), 5), A(SG.a[1]), 0.004), r),
      FR('waist line (' + side + ')', alongF(range(SG.f[0] - 0.006, SG.f[1] + 0.004, 10), A(SG.a[0]), 0.004), r - 0.0005),
      FR('B-pillar (' + side + ')', roundF(SG.f[0] - 0.005, range(A(SG.a[0]), A(SG.a[1]), 4)), r + 0.0015),
    ]));
    if (RW) out.push(FR('rear screen header', roundF(RW.f[1] - 0.003, range(RW.a[0], RW.a[1], 10)), r), FR('rear screen foot', roundF(RW.f[0] + 0.003, range(RW.a[0], RW.a[1], 10)), r),
      ...LR((A, side) => [FR('C-pillar (' + side + ')', alongF(range(RW.f[0], RW.f[1], 4), A(RW.a[0]), 0.004), r)]));
    return out;
  }
  // A door mirror: a blade on a stalk at (f, a), in the hull's colour with a glass face.
  const mirrors = (f, a = 10, paint = 'hull') => LR((A, side, sg) => {
    const c = at(f - 0.015, A(a), 0.05);
    return [
      tube('mirror stalk (' + side + ')', [at(f, A(a), 0.004), at(f - 0.015, A(a), 0.045)], 0.004, { role: 'nacelle', paint: 'carbon', sides: 5, ...FINE }),
      poly('mirror (' + side + ')', [
        ...boxAt([c[0], c[1] + sg * 0.012, c[2] + 0.004], [0.022, 0.05, 0.026], { paint }),
        faceOut([[c[0] - 0.0115, c[1] - 0.012, c[2] - 0.006], [c[0] - 0.0115, c[1] + 0.036 * sg, c[2] - 0.006], [c[0] - 0.0115, c[1] + 0.036 * sg, c[2] + 0.014], [c[0] - 0.0115, c[1] - 0.012, c[2] + 0.014]], [-1, 0, 0], { role: 'glass', tint: [150, 170, 190], sh: 0.9 }),
      ], FINE),
    ];
  });

  // ── The doors ──────────────────────────────────────────────────────────────────
  // Each door's seam round its edge, its hinge knuckles, a dark aperture behind it and the leaf itself
  // (skin below the waist, glass above), swung on the `door` channel about the hinge the cabin names.
  // `sign` is which way round the axis opens it outward; `finish` checks it and says to flip it.
  function doorHinge(A, sg) {
    const mid = (DR.f[0] + DR.f[1]) / 2;
    if (DR.hinge === 'roof') { const a = at(DR.f[0], A(DR.aHi)), b = at(DR.f[1], A(DR.aHi)); return { pivot: a, axis: [b[0] - a[0], b[1] - a[1], b[2] - a[2]], knuckles: [DR.f[0] + 0.08, DR.f[1] - 0.08].map((f) => [f, DR.aHi]) }; }
    if (DR.hinge === 'scissor') { const a = at(DR.f[1] - 0.01, A(DR.aLo + 14)); return { pivot: a, axis: [0, sg, 0], knuckles: [[DR.f[1] - 0.012, DR.aLo + 14]] }; }
    const fH = DR.hinge === 'rear' ? DR.f[0] : DR.f[1], a = at(fH, A(DR.aLo + 8)), b = at(fH, A(SG.a[0]));
    return { pivot: a, axis: [b[0] - a[0], b[1] - a[1], b[2] - a[2]], knuckles: [[fH, DR.aLo + 14], [fH, SG.a[0] - 5]], mid };
  }
  function doors({ sign = 1, handleF, extras } = {}) {
    return LR((A, side, sg) => {
      const seam = (name, pts) => tube(name + ' (' + side + ')', pts, 0.0026, { role: 'nacelle', paint: 'seam', sh: 0.4, sides: 4, ...FINE });
      const H = doorHinge(A, sg);
      // The pull: at the edge away from the hinge, where your hand finds it.
      const hf = handleF ?? (DR.hinge === 'rear' ? DR.f[1] - 0.05 : DR.hinge === 'roof' || DR.hinge === 'scissor' ? DR.f[1] - 0.045 : DR.f[0] + 0.05);
      const gTop = Math.min(SG.a[1], DR.aHi - 2);
      return [
        seam('door front seam', roundF(DR.f[1], range(A(DR.aLo), A(DR.aHi), 12), 0.0026)),
        seam('door rear seam', roundF(DR.f[0], range(A(DR.aLo), A(DR.aHi), 12), 0.0026)),
        seam('door sill seam', alongF(range(DR.f[0], DR.f[1], 10), A(DR.aLo), 0.0026)),
        ...H.knuckles.map(([f, a]) => tube('door hinge (' + side + ')', [at(f, A(a - 3), 0.003), at(f, A(a + 3), 0.006)], 0.007, { role: 'nacelle', paint: 'metal', sh: 0.8, sides: 6, ...FINE })),
        // The opening behind the door: parked inside the shell while the door is shut and brought out
        // flush as it starts to open, so the open door shows a hole and not more body.
        poly('door aperture (' + side + ')', patch(range(DR.f[0] + 0.004, DR.f[1] - 0.004, 6), range(A(DR.aLo + 3), A(DR.aHi - 3), 6), { paint: 'interior', sh: 0.12 }, 0.0028),
          { ...FINE, anim: { ch: 'door', slide: [0, R(-sg * 0.04), 0], span: [0.06, 0], def: 0 } }),
        poly('door leaf (' + side + ')', [
          ...patch(range(DR.f[0] + 0.003, DR.f[1] - 0.003, 6), range(A(DR.aLo + 2), A(SG.a[0]), 3), { paint: 'hull', sh: 0.62 }, 0.0034),
          ...patch(range(Math.max(DR.f[0] + 0.003, SG.f[0]), Math.min(DR.f[1] - 0.003, SG.f[1]), 6), range(A(SG.a[0]), A(gTop), 4), { role: 'glass', tint: glassTint, sh: 0.9 }, 0.0034),
          ...patch([hf - 0.02, hf + 0.02], range(A(SG.a[0] - 9), A(SG.a[0] - 5), 1), { paint: 'metal', sh: 0.9 }, 0.0052),
          ...(extras ? extras(A, side, sg) : []),
        ], { ...FINE, anim: { ch: 'door', pivot: P3(H.pivot), axis: P3(H.axis), ang: [0, R(sign * sg * DR.swing, 1)], def: 0 } }),
      ];
    });
  }

  // ── The ducts: the wheel arches ────────────────────────────────────────────────
  // Each duct is a ring: an outer wall in the body colour, a dark throat, lips top and bottom, four
  // stator vanes and a motor pod in the middle. The fan itself is a rotor the renderer spins.
  function ductRing(cf, cg, n = 24, wall = 'hull', lip = 'trim') {
    const faces = [];
    const P = (r, a, h) => [cf + Math.cos(a) * r, cg + Math.sin(a) * r, h];
    const lipH = 0.006;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      const out = [Math.cos(am), Math.sin(am), 0];
      faces.push(faceOut([P(D.rOut, a0, D.h0), P(D.rOut, a1, D.h0), P(D.rOut, a1, D.h1), P(D.rOut, a0, D.h1)], out, { paint: wall, sh: 0.62 + 0.3 * Math.max(0, out[0] * 0.5 + out[1] * 0.3) }));
      faces.push(faceOut([P(D.rIn, a0, D.h0), P(D.rIn, a1, D.h0), P(D.rIn, a1, D.h1), P(D.rIn, a0, D.h1)], [-out[0], -out[1], 0], { paint: 'duct', sh: 0.35 }));
      faces.push(faceOut([P(D.rIn, a0, D.h1), P(D.rIn, a1, D.h1), P(D.rOut, a1, D.h1 + lipH), P(D.rOut, a0, D.h1 + lipH)], [0, 0, 1], { paint: lip, sh: 0.9 }));
      faces.push(faceOut([P(D.rIn, a0, D.h0), P(D.rIn, a1, D.h0), P(D.rOut, a1, D.h0), P(D.rOut, a0, D.h0)], [0, 0, -1], { paint: 'carbon', sh: 0.3 }));
    }
    for (let k = 0; k < 4; k++) {
      const a = (k + 0.5) * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), hv = D.fanH - 0.022;
      const p0 = [cf + ca * 0.03, cg + sa * 0.03], p1 = [cf + ca * D.rIn, cg + sa * D.rIn];
      for (const s of [1, -1]) faces.push(faceOut([[p0[0], p0[1], hv - 0.012], [p1[0], p1[1], hv - 0.012], [p1[0], p1[1], hv + 0.004], [p0[0], p0[1], hv + 0.004]], [-sa * s, ca * s, 0], { paint: 'carbon', sh: 0.45 }));
    }
    return faces;
  }
  // `archLight`: the LED round each arch's outer edge. `arms`: the faired arm that carries each duct
  // off the body, from `armG` on the flank.
  function ducts({ wall = 'hull', lip = 'trim', archLight = true, arms = true, armG = 0.17, armChord = 0.17 } = {}) {
    return mirror('ducts', D.at.flatMap(([f, g], i) => {
      const nm = i ? 'rear' : 'front';
      const out = [
        poly(nm + ' duct', ductRing(f, g, 24, wall, lip), FINE),
        { kind: 'drum', name: nm + ' fan motor', f, g, r: 0.03, n: 14, z: [R(D.fanH - 0.03), R(D.fanH - 0.004)], role: 'nacelle', paint: 'metal', sh: { base: 0.6, alt: 0.12 }, bottom: { sh: 0.35 }, ...FINE },
        { kind: 'drum', name: nm + ' spinner', f, g, r: 0.018, n: 12, z: [R(D.fanH - 0.004), R(D.fanH + 0.008)], role: 'nacelle', paint: lip, sh: { base: 0.85 }, top: { sh: 1 }, ...FINE },
      ];
      if (archLight) out.push(tube(nm + ' arch light', range(-70, 70, 10).map((d) => [f + Math.cos((d + (i ? 180 : 0)) * DEG) * (D.rOut + 0.002), g + Math.sin((d + (i ? 180 : 0)) * DEG) * (D.rOut + 0.002), D.h1 - 0.012]), 0.004, { role: 'nacelle', paint: 'led', sh: 1, sides: 5, ...FINE }));
      if (arms) out.push({ kind: 'faired', name: nm + ' arch arm', pts: P3s([[f, armG, -0.07], [f, g - D.rIn + 0.004, -0.072]]), chord: armChord, th: 0.05, role: 'strut', sh: 0.72, paint: wall, ...FINE });
      return out;
    }));
  }
  // Four fans, diagonal pairs turning the same way, and the pusher on its own axis: it turns with
  // forward drive (the cockpit integrates `pushAng` and `push`), not with the lift fans.
  function rotors({ blades = 7, pusherBlades = 9 } = {}) {
    const out = [];
    for (const [f, g] of D.at) for (const s of [1, -1]) {
      const r = { at: [f, R(s * g), D.fanH], plane: 'h', r: D.fanR, blades, lead: 0.6, spinMul: 2.6, phase: R((f + s * g) * 3.1) };
      if (s * (f > 0 ? 1 : -1) < 0) r.dir = -1;
      out.push(r);
    }
    out.push({ at: [R(C.pusher.f - 0.02), 0, C.pusher.h], plane: 'fore', r: C.pusher.r, blades: pusherBlades, lead: 0.5, run: 'push', angle: 'pushAng' });
    return out;
  }
  // The pusher's ring, faced aft.
  function pusherDuct(paint = 'carbon') {
    const PU = C.pusher;
    return poly('pusher duct', range(0, 340, 17).flatMap((d) => {
      const a0 = d * DEG, a1 = (d + 20) * DEG, Pp = (r, a, f) => [f, Math.cos(a) * r, PU.h + Math.sin(a) * r];
      return [
        faceOut([Pp(PU.r + 0.012, a0, PU.f + 0.01), Pp(PU.r + 0.012, a1, PU.f + 0.01), Pp(PU.r + 0.012, a1, PU.f - 0.035), Pp(PU.r + 0.012, a0, PU.f - 0.035)], [0, Math.cos((d + 10) * DEG), Math.sin((d + 10) * DEG)], { paint, sh: 0.6 }),
        faceOut([Pp(PU.r, a0, PU.f - 0.035), Pp(PU.r, a1, PU.f - 0.035), Pp(PU.r + 0.012, a1, PU.f - 0.035), Pp(PU.r + 0.012, a0, PU.f - 0.035)], [-1, 0, 0], { paint: 'metal', sh: 0.7 }),
      ];
    }), FINE);
  }

  // ── The yaw thrusters ──────────────────────────────────────────────────────────
  // Four small jets on the flanks, a pair at the nose and a pair at the tail. Yawing left fires the
  // front-right and the rear-left (`yawL`), right the other two (`yawR`). A nozzle is a dark-throated
  // ring on the skin; its plume is a hot cone parked inside the body that slides out of the nozzle as
  // its channel rises (cockpit.js classAnim), so a still model shows none.
  const JET_R = 0.016, JET_L = 0.12, JET_N = 12;
  function jet(name, fj, side, ch) {
    const sg = side, sk = at(fj, side > 0 ? 0 : 180), g0 = sk[1], h0 = sk[2];
    const ringAt = (g, r) => Array.from({ length: JET_N }, (_, k) => { const a = k / JET_N * Math.PI * 2; return [fj + Math.cos(a) * r, g, h0 + Math.sin(a) * r]; });
    const out = [0, sg, 0];
    const inner = ringAt(g0 - sg * 0.004, JET_R * 1.15), outer = ringAt(g0 + sg * 0.008, JET_R * 1.15), lip = ringAt(g0 + sg * 0.008, JET_R * 0.75);
    const nozzle = [];
    for (let k = 0; k < JET_N; k++) {
      const j = (k + 1) % JET_N, mid = [Math.cos((k + 0.5) / JET_N * Math.PI * 2), 0, Math.sin((k + 0.5) / JET_N * Math.PI * 2)];
      nozzle.push(faceOut([inner[k], inner[j], outer[j], outer[k]], mid, { paint: 'metal', sh: 0.7 }));
      nozzle.push(faceOut([outer[k], outer[j], lip[j], lip[k]], out, { paint: 'carbon', sh: 0.3 }));
    }
    nozzle.push(faceOut(lip.slice(), out, { paint: 'duct', sh: 0.15 }));
    const travel = JET_L + 0.012, root = ringAt(g0 - sg * travel, JET_R * 0.85), tip = [fj, g0 - sg * travel + sg * JET_L, h0];
    const plume = [];
    for (let k = 0; k < JET_N; k++) {
      const j = (k + 1) % JET_N, mid = [Math.cos((k + 0.5) / JET_N * Math.PI * 2), sg * 0.2, Math.sin((k + 0.5) / JET_N * Math.PI * 2)];
      plume.push(faceOut([root[k], root[j], tip], mid, { paint: 'jet', sh: 1 }));
    }
    return [poly(name + ' nozzle', nozzle, FINE), poly(name + ' plume', plume, { ...FINE, anim: { ch, slide: [0, R(sg * travel), 0], def: 0 } })];
  }
  const jets = (fFront, fRear) => [
    ...jet('front right jet', fFront, 1, 'yawL'), ...jet('rear left jet', fRear, -1, 'yawL'),
    ...jet('front left jet', fFront, -1, 'yawR'), ...jet('rear right jet', fRear, 1, 'yawR'),
  ];

  // ── The feet: three legs with mag-lock pucks ───────────────────────────────────
  function feet() {
    const GZ = C.groundH;
    return C.feet.flatMap(([f, g], i) => [
      tube('foot leg ' + (i + 1), [[f, g, -0.08], [f, g, GZ + 0.016]], 0.009, { role: 'gear', paint: 'metal', sides: 6, ...FINE }),
      { kind: 'drum', name: 'mag-lock puck ' + (i + 1), f, g, r: 0.026, n: 14, z: [R(GZ), R(GZ + 0.016)], role: 'gear', paint: 'puck', sh: { base: 0.5, alt: 0.1 }, top: { sh: 0.75 }, bottom: { sh: 0.2 }, ...FINE },
      { kind: 'drum', name: 'puck ring ' + (i + 1), f, g, r: 0.028, n: 14, z: [R(GZ + 0.004), R(GZ + 0.008)], role: 'gear', paint: 'led', sh: { base: 1 }, ...FINE },
    ]);
  }

  // ── The cabin seen through the glass: two seats, a dash, the wheel, the tunnel ──
  function cabinInside({ dashF, dashH, wheelR = 0.05 } = {}) {
    const I = C.inside, out = [];
    for (const g of [I.seatG, -I.seatG]) out.push(poly('seat', [...boxAt([I.eyeF + 0.06, g, I.floorH + 0.05], [0.13, 0.11, 0.03], { paint: 'seat' }), ...boxAt([I.eyeF - 0.03, g, I.floorH + 0.14], [0.03, 0.11, 0.18], { paint: 'seat' })], FINE));
    out.push(poly('dash', boxAt([dashF, 0, dashH], [0.06, 0.38, 0.04], { paint: 'interior' }), FINE));
    out.push(poly('wheel', [discAt([dashF - 0.05, I.seatG, dashH + 0.025], wheelR, [-0.9, 0, 0.44], 12, { paint: 'carbon' })], FINE));
    out.push(poly('tunnel', boxAt([(dashF + I.eyeF) / 2, 0, I.floorH + 0.03], [dashF - I.eyeF + 0.1, 0.06, 0.06], { paint: 'interior' }), FINE));
    return out;
  }

  // ── The coarse body, for range ─────────────────────────────────────────────────
  function coarse({ idx, glassAt = [], glassK = [2, 3, 4], capFore, capAft = { kind: 'flat' } }) {
    return [
      { kind: 'loft', name: 'body (far)', role: 'body', section: 'super', sides: 14, paint: 'hull', ...COARSE,
        stations: idx.map((i) => ST[i]).map((s) => ({ f: s.f, rg: s.rg, rvT: s.rvT, rvB: s.rvB, cz: s.cz, boxy: s.boxy })),
        capFore, capAft, regions: glassAt.length ? [{ at: glassAt, k: glassK, role: 'glass', tint: glassTint }] : [] },
      mirror('ducts (far)', D.at.map(([f, g], i) => ({ kind: 'drum', name: (i ? 'rear' : 'front') + ' duct (far)', f, g, r: D.rOut, n: 10, z: [D.h0, D.h1], role: 'nacelle', paint: 'hull', sh: { base: 0.62, alt: 0.12 }, top: { sh: 0.3 }, ...COARSE }))),
    ];
  }

  // The nav lamps every car carries: red left, green right on the front arches, and a white strobe.
  const navLamps = (strobeAt) => [
    { at: [D.at[0][0] + D.rOut * 0.6, -(D.at[0][1] + D.rOut * 0.8), D.h1 - 0.01], n: [0, -1, 0], rgb: '255,55,55', kind: 'steady' },
    { at: [D.at[0][0] + D.rOut * 0.6, D.at[0][1] + D.rOut * 0.8, D.h1 - 0.01], n: [0, 1, 0], rgb: '60,255,95', kind: 'steady' },
    { at: strobeAt, n: [-1, 0, 0], rgb: '255,255,255', kind: 'strobe' },
  ];

  // Validate, check the doors open outward, write the file and say how big it is.
  function finish(doc) {
    const v = validateMesh(doc.params, doc.id);
    if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
    if (v.warnings?.length) console.log('warnings', v.warnings.slice(0, 8));
    const near = compileMesh(doc.params, { detail: 1 }).faces, far = compileMesh(doc.params, { detail: 0 }).faces;
    for (const sg of [1, -1]) {
      const leaf = near.filter((f) => f.anim && f.anim.ch === 'door' && f.anim.ang && f.p.every((q) => q[1] * sg > 0));
      let dg = 0, dh = 0, n = 0;
      for (const f of leaf) { const q = animFacePoints(f, { door: 1 }); f.p.forEach((p, i) => { dg += (q[i][1] - p[1]) * sg; dh += q[i][2] - p[2]; n++; }); }
      const good = DR.hinge === 'scissor' || DR.hinge === 'roof' ? dh > 0 : dg > 0;
      if (!n || !good) { console.log('ERROR: the ' + (sg > 0 ? 'right' : 'left') + ' door opens into the car (' + n + ' points, out ' + (dg / (n || 1)).toFixed(3) + ', up ' + (dh / (n || 1)).toFixed(3) + '): flip doors({ sign })'); process.exit(1); }
    }
    let f0 = Infinity, f1 = -Infinity, g1 = 0, h0 = Infinity, h1 = -Infinity;
    for (const f of near) { if (f.role === 'rotor') continue; for (const q of f.p) { f0 = Math.min(f0, q[0]); f1 = Math.max(f1, q[0]); g1 = Math.max(g1, Math.abs(q[1])); h0 = Math.min(h0, q[2]); h1 = Math.max(h1, q[2]); } }
    const m = C.lengthM / (f1 - f0);
    writeFileSync(new URL('../../../content/vehicle_models/mesh_' + doc.id + '.json', import.meta.url), formatMesh(doc));
    console.log('mesh_' + doc.id + '.json:', near.length, 'faces near,', far.length, 'far;', C.lengthM.toFixed(2) + ' m long, ' + (2 * g1 * m).toFixed(2) + ' wide, ' + ((h1 - h0) * m).toFixed(2) + ' tall');
  }

  return { at, bandsIn, patch, alongF, roundF, LR, FR, body, glassFrame, mirrors, doors, ductRing, ducts, rotors, pusherDuct, jets, feet, cabinInside, coarse, navLamps, finish };
}
