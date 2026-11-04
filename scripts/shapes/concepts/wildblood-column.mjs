// The Wildblood column: writes content/vehicle_models/mesh_column.json, mesh_column_runner.json and
// mesh_column_cart.json.
//
//   node scripts/shapes/concepts/wildblood-column.mjs
//   then: npm run vehicles:bake
//
// Three rigs from the 2 November concept (the "Wildblood Cel Concepts" artifact and the "Wildblood
// Concept Art" canvas), drawn by plugins/column as contacts of class `column`:
//
// - THE HOWL (`column`), the lead rig. A five-axle truck chassis under a scavenged cab, with a Mule
//   freighter's fuselage strapped to the bed. The Halcyon stripe is left on and crossed out in ash.
//   Sawn-off wing roots and struts, the tail fin kept for the skull chain, two open rotgas stacks fed
//   from fungal bladders on the cab roof, a spiked bull bar and plough, and a drone staked on a pole.
// - THE HOUND-RUNNER (`column_runner`). A V-twin with one upswept stack and a skull over the lamp,
//   towing Bracken's dog cage. The cage is empty until the hounds are built (a fauna kind of their own).
// - THE SLAKE CART (`column_cart`). The water tanker, up-armoured: a riveted skirt, crown spikes along
//   the tank, a catwalk, hose reels, a ladder, and the rack of glass tubes they test the water with.
//
// ⚠ NO WORDS ANYWHERE. The region carries no lettering (building-styles.md §3.3), and that holds on
// the rigs: the tank gets hood tallies and ash handprints, never the concept's stencil. A tally counts
// changes, not kills: a stroke is a Gift, a ring is a Lesson. The headlamps are the one exception to
// the region's fire-only light, and §3.3 says so.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the meshes in the Modelshop.
//
// Frame: f fore, g right, h up. Everything is authored in METRES with the tyres on h = 0, and one
// group at the top scales it to mesh units at 7.2 m a unit, the podracer's (the ground seats' metre),
// so `classFacts` matches hers. All three keep their tyre bottoms on h = 0 because the renderer rests
// a ground contact by its CLASS mesh's lowest point (contactBaseWz), which is the Howl's.
//
// Faces are wound outward by `orient`, so a face with no authored shade takes the right one from
// derivedShade (crown-bright, belly-dark). Both sides are built explicitly rather than through a
// `mirror` part, which would re-run a poly with g negated and flip its winding.
//
// Small things (riders, tallies, rivets, skulls, chains, bars) are `minDetail: 1`, so the far LOD is
// the vehicle's mass alone.
import { writeFileSync } from 'node:fs';
import { R, pod, poly, wheel, tube, group } from '../fw-meshes/lib.mjs';
const { formatMesh, validateMesh } = await import('../../../client/shared/vehicle-mesh.js');
// A flat outline in the f-h plane given a half-thickness: the tail fin.
const blade = (name, outline, t, sh) => ({ kind: 'blade', name, outline: outline.map(([f, h]) => [R(f), R(h)]), t: R(t), role: 'fin', sh });

const M_PER_UNIT = 7.2;
const S = 1 / M_PER_UNIT;
const DEG = Math.PI / 180;

// ── Paint ─────────────────────────────────────────────────────────────────────
// The canvas palette: ink, bone, dust, rust, redrock, rotgas and Halcyon blue, plus the working
// colours of a scrapyard rig. All `fixed`: a livery booth never repaints a Wildblood rig.
const slot = (rgb, mat = 'matte', tex = 'paint') => ({ rgb, livery: 'fixed', mat, tex });
const PAINTS = {
  rust: slot([196, 80, 30]),
  rust2: slot([156, 63, 26], 'matte', 'cast'),
  grey: slot([185, 179, 163]),
  tank: slot([142, 134, 118], 'satin'),
  blue: slot([62, 143, 176], 'satin'),
  bone: slot([239, 230, 210], 'matte', 'plastic'),
  bone2: slot([217, 205, 178], 'matte', 'plastic'),
  ink: slot([42, 36, 34]),
  ash: slot([42, 34, 32]),
  metal: slot([59, 52, 49], 'steel', 'cast'),
  steel: slot([109, 103, 95], 'steel', 'brushed'),
  exhaust: slot([80, 70, 62], 'exhaust', 'cast'),
  olive: slot([111, 116, 79]),
  rotgas: slot([138, 143, 106], 'matte', 'leather'),
  wood: slot([122, 82, 54], 'matte', 'wood'),
  leather: slot([138, 96, 70], 'matte', 'leather'),
  trouser: slot([58, 46, 42], 'matte', 'fabric'),
  quilt: slot([168, 112, 90], 'matte', 'fabric'),
  skin: slot([217, 162, 122], 'matte', 'leather'),
  tyre: slot([43, 38, 38], 'rubber', 'rubber'),
  glass: slot([30, 42, 49], 'glass', 'plastic'),
  vial: slot([150, 190, 196], 'glass', 'plastic'),
  lamp: slot([255, 214, 150], 'chrome', 'plastic'),
};

// ── Geometry helpers, all in metres ───────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const centroid = (pts) => mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
// Newell's normal, the one derivedShade reads.
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}
// Wind a face so its normal points along `out`.
const orient = (pts, out) => (dot(newell(pts), out) < 0 ? pts.slice().reverse() : pts);
// Roll about f, pitch about g, yaw about h (applyXf's order), about a centre.
function rotor(rot, c) {
  const [rr, rp, ry] = (rot || [0, 0, 0]).map((d) => d * DEG);
  const cr = Math.cos(rr), sr = Math.sin(rr), cp = Math.cos(rp), sp = Math.sin(rp), cy = Math.cos(ry), sy = Math.sin(ry);
  return (v) => {
    let f = v[0] - c[0], g = v[1] - c[1], h = v[2] - c[2];
    [g, h] = [g * cr - h * sr, g * sr + h * cr];
    [f, h] = [f * cp - h * sp, f * sp + h * cp];
    [f, g] = [f * cy - g * sy, f * sy + g * cy];
    return [f + c[0], g + c[1], h + c[2]];
  };
}
const extra = (o) => {
  const e = {};
  if (o.paint) e.paint = o.paint;
  if (o.md != null) e.minDetail = o.md;
  return e;
};
// A closed solid from faces given in local space: each face wound away from the solid's centre.
// Coordinates are kept to the millimetre: a fourth decimal is a tenth of a millimetre on a truck, and
// bytes in a module every seat downloads.
const mm = (x) => R(x, 3);
function solid(name, faces, o = {}) {
  const role = o.role || 'body';
  const all = faces.flat(), c = o.centre || centroid(all);
  const out = faces.map((pts) => ({ role, p: orient(pts, sub(centroid(pts), c)).map((v) => v.map(mm)) }));
  return poly(name, out, extra(o));
}
// A box at centre c with size [length f, width g, height h], optionally rotated about its centre.
function box(name, c, sz, o = {}) {
  const [L, W, H] = sz.map((v) => v / 2), X = rotor(o.rot, c);
  const v = (a, b, d) => X([c[0] + a * L, c[1] + b * W, c[2] + d * H]);
  const F = [
    [v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), v(-1, -1, 1)],
    [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)],
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)],
    [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)],
    [v(1, 1, -1), v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1)],
    [v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), v(-1, -1, -1)],
  ];
  return solid(name, o.open ? F.filter((_, i) => !o.open.includes(i)) : F, { ...o, centre: c });
}
// Flat marks on a surface, one face each, all in one part: rivets, tally strokes, handprints. `n` is
// the way the surface faces ('+g', '-g', '+h', '+f', '-f'); `w` runs along f (along g on an f face),
// `t` across it, and `tilt` turns the mark in its own plane, degrees.
function marks(name, items, o = {}) {
  const faces = items.map(({ c, n, w, t, tilt = 0 }) => {
    const s = n[0] === '-' ? -1 : 1, ax = n[1];
    const out = ax === 'g' ? [0, s, 0] : ax === 'h' ? [0, 0, s] : [s, 0, 0];
    const u0 = ax === 'f' ? [0, 1, 0] : [1, 0, 0], v0 = ax === 'h' ? [0, 1, 0] : [0, 0, 1];
    const ca = Math.cos(tilt * DEG), sa = Math.sin(tilt * DEG);
    const u = add(mul(u0, ca), mul(v0, sa)), v = add(mul(u0, -sa), mul(v0, ca));
    const P = (a, b) => add(c, add(mul(u, a * w / 2), mul(v, b * t / 2)));
    return { role: 'body', p: orient([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)], out).map((q) => q.map(mm)) };
  });
  return poly(name, faces, extra(o));
}
// A prism: a CONVEX profile of [f, h] corners swept across g0..g1.
function prism(name, prof, g0, g1, o = {}) {
  const A = prof.map(([f, h]) => [f, g0, h]), B = prof.map(([f, h]) => [f, g1, h]);
  const faces = [A, B];
  for (let i = 0; i < prof.length; i++) { const j = (i + 1) % prof.length; faces.push([A[i], A[j], B[j], B[i]]); }
  return solid(name, faces, o);
}
// A round solid between two points: the mesh's own `tube` primitive, closed at both ends unless
// `open`. ⚠ A PRIMITIVE, NOT FACES: written out as faces the three rigs added 915 KB to
// vehicle-meshes.js, which every 3-D seat downloads; a tube is one short part.
function cyl(name, a, b, r, o = {}) {
  const t = tube(name, [a, b].map((p) => p.map(mm)), mm(r), { sides: o.n || 10, role: o.role || 'body', sh: o.sh ?? 0.7 });
  if (!o.open) t.caps = 1;
  return { ...t, ...extra(o) };
}
// A four-sided spike from a base centre along `dir`.
function spike(name, base, dir, r, len, o = {}) {
  const d = unit(dir), u = unit(cross(d, Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])), w = cross(d, u);
  const B = [0, 1, 2, 3].map((i) => { const t = (i + 0.5) / 4 * Math.PI * 2; return add(base, add(mul(u, Math.cos(t) * r), mul(w, Math.sin(t) * r))); });
  const apex = add(base, mul(d, len));
  const faces = [B.slice().reverse()];
  for (let i = 0; i < 4; i++) faces.push([B[i], B[(i + 1) % 4], apex]);
  return solid(name, faces, { ...o, centre: add(base, mul(d, len * 0.25)) });
}
// A ring painted on a side face (the hood tally's Lesson): a tube round a circle in the f-h plane.
function ringMark(name, f, g, h, rad, o = {}) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14 * Math.PI * 2; pts.push([f + Math.cos(t) * rad, g, h + Math.sin(t) * rad]); }
  return { ...tube(name, pts.map((p) => p.map((x) => R(x))), o.r || 0.03, { sides: 4, role: 'body', sh: 0.85 }), ...extra(o) };
}
// A catenary chain between two points, as a thin tube.
function chain(name, a, b, sag, o = {}) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)]); }
  return { ...tube(name, pts, o.r || 0.035, { sides: 4, role: 'gear', sh: 0.5 }), paint: o.paint || 'metal', minDetail: 1 };
}

// ── Shared props ──────────────────────────────────────────────────────────────
// A skull facing +f (or along `yaw` degrees), centred at c, s metres tall.
function skull(name, c, s = 0.22, yaw = 0) {
  const k = s / 0.22, X = rotor([0, 0, yaw], c);
  const P = (f, g, h) => X([c[0] + f * k, c[1] + g * k, c[2] + h * k]);
  const at = (f, g, h) => P(f, g, h);
  const cranium = (() => {
    const n = 8, rings = [[-0.1, 0.05], [-0.06, 0.1], [0.0, 0.11], [0.06, 0.1], [0.1, 0.05]];
    const faces = [], R0 = rings.map(([f, r]) => { const q = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; q.push(at(f, Math.cos(t) * r, 0.02 + Math.sin(t) * r * 0.95)); } return q; });
    for (let r = 0; r < R0.length - 1; r++) for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([R0[r][i], R0[r][j], R0[r + 1][j], R0[r + 1][i]]); }
    faces.push(R0[0]); faces.push(R0[R0.length - 1]);
    return solid(name + '_cranium', faces, { paint: 'bone', md: 1, centre: at(0, 0, 0.02) });
  })();
  const parts = [cranium,
    box(name + '_jaw', at(0.05, 0, -0.07), [0.09 * k, 0.11 * k, 0.05 * k], { paint: 'bone2', md: 1, rot: [0, 0, yaw] }),
    box(name + '_eyeL', at(0.1, -0.035, 0.03), [0.02 * k, 0.04 * k, 0.04 * k], { paint: 'ash', md: 1, rot: [0, 0, yaw] }),
    box(name + '_eyeR', at(0.1, 0.035, 0.03), [0.02 * k, 0.04 * k, 0.04 * k], { paint: 'ash', md: 1, rot: [0, 0, yaw] }),
    box(name + '_nose', at(0.105, 0, -0.015), [0.015 * k, 0.02 * k, 0.03 * k], { paint: 'ash', md: 1, rot: [0, 0, yaw] }),
    box(name + '_teeth', at(0.098, 0, -0.05), [0.012 * k, 0.07 * k, 0.018 * k], { paint: 'bone', md: 1, rot: [0, 0, yaw] }),
  ];
  return group(name, parts);
}
// An ash handprint on a face pointing along ±g (side = +1 right, -1 left), fingers up.
// The items are flat marks, so a handprint is six faces rather than six boxes.
function handprint(name, f, g, h, side, s = 1, tilt = 0) {
  const n = side > 0 ? '+g' : '-g', items = [];
  const ca = Math.cos(tilt * DEG), sa = Math.sin(tilt * DEG);
  const at = (df, dh) => [f + (df * ca - dh * sa) * s, g, h + (df * sa + dh * ca) * s];
  items.push({ c: at(0, 0), n, w: 0.11 * s, t: 0.11 * s, tilt });
  [-0.042, -0.014, 0.014, 0.042].forEach((df, i) => items.push({ c: at(df, 0.1 + (i === 1 || i === 2 ? 0.012 : 0)), n, w: 0.024 * s, t: 0.085 * s, tilt }));
  items.push({ c: at(side * 0.07, 0.01), n, w: 0.024 * s, t: 0.07 * s, tilt: tilt + side * 50 });
  return marks(name, items, { paint: 'ash', md: 1 });
}
// The hood tally on a face pointing along ±g: strokes for Gifts, rings for Lessons, rings bigger.
function tally(name, f0, g, h, seq) {
  const parts = [], strokes = [], n = g > 0 ? '+g' : '-g';
  let f = f0;
  seq.forEach((m, i) => {
    if (m === '|') { strokes.push({ c: [f, g, h], n, w: 0.05, t: 0.3 }); f -= 0.13; }
    else { const r = m === 'O' ? 0.17 : 0.12; f -= r - 0.03; parts.push(ringMark(name + '_r' + i, f, g, h, r, { paint: 'bone', md: 1 })); f -= r + 0.1; }
  });
  if (strokes.length) parts.push(marks(name + '_strokes', strokes, { paint: 'bone', md: 1 }));
  return group(name, parts);
}
function jerrycan(name, c, o = {}) {
  return group(name, [
    box(name + '_body', c, [0.34, 0.18, 0.46], { paint: o.paint || 'olive', rot: o.rot }),
    box(name + '_spout', add(c, [0.1, 0, 0.26]), [0.06, 0.06, 0.06], { paint: 'metal', md: 1 }),
  ]);
}
// A masked rider, seated, facing +f. `seat` is the hip point; `hands` the two hand points.
// The mask is bone lined with quilted rag; the goggles are salvaged Halcyon blue.
function rider(name, seat, hands, o = {}) {
  const lean = o.lean ?? 15, parts = [];
  const [sf, sg, sh] = seat;
  const T = rotor([0, lean, 0], seat);   // the torso leans forward about the hip
  const torsoC = T([sf, sg, sh + 0.34]);
  parts.push(box(name + '_hips', [sf, sg, sh + 0.06], [0.28, 0.36, 0.16], { paint: 'trouser' }));
  parts.push(box(name + '_torso', torsoC, [0.26, 0.42, 0.5], { paint: o.jacket || 'leather', rot: [0, lean, 0] }));
  const neck = T([sf, sg, sh + 0.64]);
  const head = T([sf + 0.01, sg, sh + 0.8]);
  parts.push(cyl(name + '_neck', neck, add(neck, [0, 0, 0.08]), 0.06, { paint: 'skin', n: 6, md: 1 }));
  parts.push(group(name + '_head', [pod(name + '_skull', 0, 0, [[0.12, 0.03], [0.08, 0.1], [0, 0.115], [-0.09, 0.1], [-0.12, 0.03]], { sides: 8, paint: 'quilt', role: 'body' })], { xf: { t: [R(head[0]), R(head[1]), R(head[2])] } }));
  parts.push(box(name + '_mask', add(head, [0.115, 0, -0.01]), [0.04, 0.2, 0.22], { paint: 'bone', rot: [0, lean * 0.4, 0] }));
  for (const s of [-1, 1]) {
    parts.push(box(name + '_eye' + s, add(head, [0.14, s * 0.045, 0.02]), [0.012, 0.04, 0.03], { paint: 'ash', md: 1 }));
    parts.push(cyl(name + '_gog' + s, add(head, [0.11, s * 0.045, 0.085]), add(head, [0.15, s * 0.045, 0.085]), 0.035, { paint: 'blue', n: 8, md: 1 }));
  }
  parts.push(box(name + '_strap', add(head, [0, 0, 0.085]), [0.24, 0.235, 0.03], { paint: 'ink', md: 1 }));
  for (let i = 0; i < 5; i++) parts.push(box(name + '_tooth' + i, add(head, [0.14, -0.04 + i * 0.02, -0.09]), [0.01, 0.012, 0.03], { paint: 'bone2', md: 1 }));
  // Shoulders, the tyre-tread pauldron on the right, arms to the hands.
  const shL = T([sf, sg - 0.22, sh + 0.56]), shR = T([sf, sg + 0.22, sh + 0.56]);
  parts.push(box(name + '_pauldron', add(shR, [0, 0.03, 0.05]), [0.22, 0.14, 0.08], { paint: 'tyre', rot: [-20, lean, 0], md: 1 }));
  const elbow = (a, b) => add(mul(add(a, b), 0.5), [0, 0, -0.08]);
  for (const [sh0, hand, s] of [[shL, hands[0], -1], [shR, hands[1], 1]]) {
    const e = elbow(sh0, hand);
    const thorn = o.thorn && s === 1;
    parts.push(cyl(name + '_upper' + s, sh0, e, thorn ? 0.075 : 0.055, { paint: thorn ? 'skin' : (o.jacket || 'leather'), n: 6 }));
    parts.push(cyl(name + '_fore' + s, e, hand, thorn ? 0.07 : 0.05, { paint: thorn ? 'skin' : (o.jacket || 'leather'), n: 6 }));
    parts.push(box(name + '_hand' + s, hand, [0.08, 0.07, 0.07], { paint: 'ink', md: 1 }));
    // A Gift: thornhide plates grown in down the arm, filed to points.
    if (thorn) for (let i = 1; i <= 3; i++) {
      const p = add(sh0, mul(sub(e, sh0), i / 4)), q = add(e, mul(sub(hand, e), i / 4));
      parts.push(spike(name + '_thornU' + i, p, [0, 1, 0.3], 0.025, 0.1, { paint: 'bone', md: 1 }));
      parts.push(spike(name + '_thornF' + i, q, [0, 1, 0.3], 0.025, 0.11, { paint: 'bone', md: 1 }));
    }
  }
  // Legs: thighs forward from the hips, shins down to the feet.
  for (const s of [-1, 1]) {
    const hip = [sf, sg + s * 0.11, sh + 0.04];
    const knee = add(hip, o.knee || [0.42, s * 0.04, 0.02]);
    const foot = add(knee, o.shin || [0.05, 0, -0.42]);
    parts.push(cyl(name + '_thigh' + s, hip, knee, 0.075, { paint: 'trouser', n: 6 }));
    parts.push(cyl(name + '_shin' + s, knee, foot, 0.06, { paint: 'trouser', n: 6 }));
    parts.push(box(name + '_boot' + s, add(foot, [0.05, 0, -0.03]), [0.26, 0.12, 0.12], { paint: 'ink', md: 1 }));
  }
  // The ash handprint on the chest is the rider's own.
  parts.push(box(name + '_print', T([sf + 0.135, sg - 0.06, sh + 0.42]), [0.012, 0.1, 0.1], { paint: 'ash', md: 1, rot: [0, lean, 0] }));
  return { ...group(name, parts), minDetail: 1 };
}

// ── A truck front: chassis, hood, cab, bull bar, plough ──────────────────────
// `f0` is the bumper's f. Returns the parts and the cab's back f.
function truckFront(pre, f0, o = {}) {
  const parts = [];
  const hoodF = f0 - 1.35, backF = hoodF - 1.85, W = 1.15;
  parts.push(prism(pre + '_hood', [[f0, 1.35], [f0, 2.55], [f0 - 0.15, 2.7], [hoodF, 2.76], [hoodF, 1.35]], -W, W, { paint: o.cab || 'rust' }));
  parts.push(prism(pre + '_cab', [[hoodF, 1.35], [hoodF, 2.76], [hoodF - 0.3, 3.95], [hoodF - 0.4, 4.05], [backF, 4.1], [backF, 1.35]], -W, W, { paint: o.cab || 'rust' }));
  // Bonnet louvres and a grille of flat bars.
  for (let i = 0; i < 4; i++) parts.push(box(pre + '_louvre' + i, [f0 - 0.45 - (i % 2) * 0.4, -0.6 + i * 0.4, 2.79], [0.32, 0.06, 0.04], { paint: 'metal', md: 1 }));
  for (let i = 0; i < 7; i++) parts.push(box(pre + '_grille' + i, [f0 + 0.02, -0.75 + i * 0.25, 1.95], [0.04, 0.06, 0.95], { paint: 'metal' }));
  // The windscreen, slanted, behind welded bars.
  const slant = Math.atan2(0.3, 1.19) / DEG;
  const wsC = [hoodF - 0.15, 0, 3.36];
  parts.push(box(pre + '_screen', wsC, [0.03, 2.04, 1.12], { paint: 'glass', role: 'window', rot: [0, -slant, 0] }));
  for (let i = 0; i < 8; i++) parts.push(cyl(pre + '_bar' + i, [hoodF + 0.02 - 0.0, -0.95 + i * 0.27, 2.82], [hoodF - 0.3 - 0.0, -0.95 + i * 0.27, 3.98], 0.026, { paint: 'metal', n: 5, md: 1 }));
  for (const s of [-1, 1]) {
    const g = s * (W + 0.012);
    parts.push(box(pre + '_win' + s, [hoodF - 0.95, g, 3.4], [1.1, 0.02, 0.72], { paint: 'glass', role: 'window' }));
    for (let i = 0; i < 3; i++) parts.push(box(pre + '_wbar' + s + i, [hoodF - 0.6 - i * 0.35, g + s * 0.02, 3.4], [0.04, 0.03, 0.78], { paint: 'metal', md: 1 }));
    // The door's seams, and the hood tally on it.
    parts.push(box(pre + '_doorseam' + s, [hoodF - 0.08, g, 2.5], [0.03, 0.022, 2.2], { paint: 'rust2', md: 1 }));
    parts.push(tally(pre + '_tally' + s, hoodF - 0.25, g + s * 0.012, 2.2, o.tally || ['|', '|', '|', 'o', '|', 'O']));
    // Step, mirror arm and mirror.
    parts.push(box(pre + '_step' + s, [hoodF - 0.95, s * 1.28, 1.15], [0.5, 0.3, 0.06], { paint: 'steel' }));
    parts.push(cyl(pre + '_marm' + s, [hoodF - 0.1, s * W, 3.4], [hoodF + 0.15, s * 1.62, 3.62], 0.03, { paint: 'metal', n: 5, md: 1 }));
    parts.push(box(pre + '_mirror' + s, [hoodF + 0.15, s * 1.66, 3.62], [0.06, 0.24, 0.42], { paint: 'ink', md: 1 }));
    // The front wheel arch.
    parts.push(box(pre + '_arch' + s, [f0 - 1.0, s * 1.3, 1.82], [1.9, 0.62, 0.08], { paint: o.cab || 'rust', rot: [0, 0, 0] }));
    // Rivets down the cab side.
    const rv = [];
    for (let f = f0 - 0.2; f > backF; f -= 0.4) rv.push({ c: [f, g + s * 0.008, 1.45], n: s > 0 ? '+g' : '-g', w: 0.05, t: 0.05 });
    parts.push(marks(pre + '_rivets' + s, rv, { paint: 'rust2', md: 1 }));
  }
  // The bull bar: posts, rails and a row of bone spikes along the top rail.
  const bf = f0 + 0.32;
  for (const g of [-1.0, -0.35, 0.35, 1.0]) parts.push(cyl(pre + '_post' + R(g, 2), [bf, g, 0.55], [bf, g, 2.35], 0.05, { paint: 'metal', n: 6 }));
  for (const h of [1.0, 1.7, 2.35]) parts.push(cyl(pre + '_rail' + h, [bf, -1.1, h], [bf, 1.1, h], 0.045, { paint: 'metal', n: 6 }));
  for (const s of [-1, 1]) parts.push(cyl(pre + '_brace' + s, [bf, s * 1.0, 2.35], [f0, s * 0.9, 2.55], 0.04, { paint: 'metal', n: 5 }));
  for (let i = 0; i < 7; i++) parts.push(spike(pre + '_barspike' + i, [bf + 0.04, -0.9 + i * 0.3, 2.35], [1, 0, 0.35], 0.04, 0.32, { paint: 'bone' }));
  // The plough: a row of wedge teeth below the bar.
  for (let i = 0; i < 5; i++) {
    const h = 0.32 + i * 0.16;
    parts.push(prism(pre + '_plough' + i, [[bf, h], [bf + 0.55 - i * 0.04, h + 0.08], [bf, h + 0.16]], -1.25, 1.25, { paint: i % 2 ? 'steel' : 'bone' }));
  }
  // Salvaged headlamps, caged, on the bar.
  for (const s of [-1, 1]) {
    parts.push(cyl(pre + '_lamp' + s, [bf - 0.05, s * 0.68, 1.95], [bf + 0.08, s * 0.68, 1.95], 0.13, { paint: 'metal', n: 10 }));
    parts.push(cyl(pre + '_lens' + s, [bf + 0.08, s * 0.68, 1.95], [bf + 0.095, s * 0.68, 1.95], 0.11, { paint: 'lamp', role: 'window', n: 10 }));
  }
  return { parts, backF, lamps: [[bf + 0.1, -0.68, 1.95], [bf + 0.1, 0.68, 1.95]] };
}
// Chassis rails and cross members from f0 back to f1, at deck height.
function chassis(pre, f0, f1) {
  const parts = [], L = f0 - f1, c = (f0 + f1) / 2;
  for (const g of [-0.78, 0.78]) parts.push(box(pre + '_rail' + g, [c, g, 1.2], [L, 0.22, 0.32], { paint: 'metal' }));
  for (let f = f0 - 0.3; f > f1; f -= 1.0) parts.push(box(pre + '_cross' + R(f, 2), [f, 0, 1.2], [0.16, 1.56, 0.22], { paint: 'metal', md: 1 }));
  return parts;
}
// An axle: two wheels on a beam, with a bone hub spike on the outside when `spiked`.
function axle(pre, f, r, hw, track, spiked = false) {
  const parts = [cyl(pre + '_beam', [f, -track, r], [f, track, r], 0.09, { paint: 'metal', n: 6 })];
  for (const s of [-1, 1]) {
    parts.push({ ...wheel(pre + '_w' + s, [f, s * track, r], r, hw, 16), paint: 'tyre' });
    parts.push(cyl(pre + '_hub' + s, [f, s * (track + hw), r], [f, s * (track + hw + 0.08), r], r * 0.22, { paint: 'rust', n: 8 }));
    if (spiked) parts.push(spike(pre + '_spike' + s, [f, s * (track + hw + 0.08), r], [0, s, 0], r * 0.1, r * 0.55, { paint: 'bone' }));
    // Leaf springs over the axle.
    for (let k = 0; k < 3; k++) parts.push(box(pre + '_leaf' + s + k, [f, s * 0.78, r + 0.16 + k * 0.05], [1.4 - k * 0.3, 0.18, 0.04], { paint: 'steel', md: 1 }));
  }
  return parts;
}
// An open rotgas stack: no muffler, on purpose. Heat-dulled pipe with a wider lip at the top.
function stack(pre, foot, top, r = 0.12) {
  return [
    cyl(pre + '_pipe', foot, top, r, { paint: 'exhaust', n: 10, open: true }),
    cyl(pre + '_lip', sub(top, [0, 0, 0.18]), top, r * 1.25, { paint: 'metal', n: 10, open: true }),
    cyl(pre + '_clamp', sub(top, [0, 0, 0.9]), sub(top, [0, 0, 0.82]), r * 1.18, { paint: 'metal', n: 10, md: 1 }),
  ];
}
// A fungal fuel bladder: a sagging skin bag, rotgas green, on a strap.
function bladder(pre, c, len, r) {
  return group(pre, [
    pod(pre + '_bag', 0, 0, [[len / 2, r * 0.25], [len * 0.35, r * 0.85], [0, r], [-len * 0.35, r * 0.9], [-len / 2, r * 0.3]], { sides: 10, paint: 'rotgas', role: 'body' }),
    { ...box(pre + '_strap', [0, 0, 0], [0.06, r * 2.15, r * 2.1]), minDetail: 1, paint: 'ink' },
  ], { xf: { t: [R(c[0]), R(c[1]), R(c[2])], s: [1, 1, 0.82] } });
}
// A drone staked on a pole, a skull wired to its back. Halcyon blue: salvage, never theirs.
function stakedDrone(pre, base, height) {
  const top = add(base, [0, 0, height]), parts = [];
  parts.push(cyl(pre + '_pole', base, add(top, [0, 0, -0.05]), 0.05, { paint: 'wood', n: 6 }));
  parts.push(box(pre + '_body', add(top, [0, 0, 0.07]), [0.52, 0.52, 0.16], { paint: 'blue', rot: [0, 0, 12] }));
  for (let i = 0; i < 4; i++) {
    const a = (45 + 12 + i * 90) * DEG, e = add(top, [Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.08]);
    parts.push(cyl(pre + '_arm' + i, add(top, [0, 0, 0.08]), e, 0.025, { paint: 'metal', n: 5 }));
    parts.push(cyl(pre + '_motor' + i, e, add(e, [0, 0, 0.1]), 0.06, { paint: 'metal', n: 8, md: 1 }));
    // Three props hang on; the fourth is a stub.
    parts.push(box(pre + '_prop' + i, add(e, [0, 0, 0.12]), i === 2 ? [0.18, 0.04, 0.012] : [0.46, 0.05, 0.012], { paint: 'grey', md: 1, rot: [0, 0, i * 37] }));
  }
  parts.push(skull(pre + '_skull', add(top, [0, 0, 0.27]), 0.26, 0));
  for (const s of [-1, 1]) parts.push(box(pre + '_wire' + s, add(top, [0, s * 0.08, 0.2]), [0.02, 0.012, 0.16], { paint: 'grey', md: 1 }));
  return parts;
}

// ── THE HOWL ──────────────────────────────────────────────────────────────────
function buildHowl() {
  const parts = [];
  const front = truckFront('howl', 6.7, { tally: ['|', '|', '|', 'O', '|', '|', 'o'] });
  parts.push(...front.parts);
  parts.push(...chassis('howl', 6.4, -6.6));
  // The bed.
  parts.push(box('howl_deck', [-1.1, 0, 1.43], [8.6, 2.5, 0.16], { paint: 'metal' }));
  const bedRivets = [];
  for (let f = -5.2; f < 3.2; f += 0.5) for (const s of [-1, 1]) bedRivets.push({ c: [f, s * 1.2, 1.513], n: '+h', w: 0.05, t: 0.05 });
  parts.push(marks('howl_bedrivets', bedRivets, { paint: 'steel', md: 1 }));
  // Five axles; the front and the last are spiked.
  [[5.4, true], [1.6, false], [0.4, false], [-3.0, false], [-4.2, true]].forEach(([f, sp], i) => parts.push(...axle('howl_ax' + i, f, 0.85, 0.3, 1.3, sp)));
  // Rear mudguards over the tandems.
  for (const s of [-1, 1]) {
    parts.push(box('howl_guardA' + s, [1.0, s * 1.3, 1.86], [2.5, 0.78, 0.08], { paint: 'metal' }));
    parts.push(box('howl_guardB' + s, [-3.6, s * 1.3, 1.86], [2.5, 0.78, 0.08], { paint: 'metal' }));
  }
  // Saddle tanks under the bed, where no wheel is.
  for (const s of [-1, 1]) {
    parts.push(cyl('howl_tank' + s, [-0.5, s * 1.04, 0.98], [-2.5, s * 1.04, 0.98], 0.36, { paint: 'steel', n: 12 }));
    for (const f of [-0.85, -2.15]) parts.push(cyl('howl_tankband' + s + f, [f + 0.03, s * 1.04, 0.98], [f - 0.03, s * 1.04, 0.98], 0.375, { paint: 'metal', n: 12, md: 1 }));
  }
  // The Mule's fuselage, strapped to the bed: a boxy freighter hull, nose forward, tail cone up.
  const cz = 2.55;
  const sts = [
    { f: 3.15, rg: 0.35, rvT: 0.32, rvB: 0.3, cz: 2.45, boxy: 0.3 },
    { f: 2.8, rg: 0.72, rvT: 0.72, rvB: 0.62, cz: 2.5, boxy: 0.45 },
    { f: 2.2, rg: 0.95, rvT: 0.98, rvB: 0.95, cz, boxy: 0.55 },
    { f: -2.8, rg: 0.95, rvT: 0.98, rvB: 0.95, cz, boxy: 0.55 },
    { f: -4.2, rg: 0.68, rvT: 0.7, rvB: 0.5, cz: 2.85, boxy: 0.45 },
    { f: -5.3, rg: 0.32, rvT: 0.3, rvB: 0.22, cz: 3.2, boxy: 0.3 },
    { f: -5.75, rg: 0.12, rvT: 0.1, rvB: 0.08, cz: 3.32, boxy: 0.2 },
  ];
  parts.push({ kind: 'loft', name: 'howl_fuselage', sides: 16, section: 'super', role: 'body', stations: sts.map((s) => ({ ...s })), paint: 'grey' });
  // The Halcyon stripe, left on, and the ash crosses through it.
  for (const s of [-1, 1]) {
    parts.push(box('howl_stripe' + s, [-0.3, s * 0.93, cz - 0.38], [5.6, 0.02, 0.13], { paint: 'blue' }));
    const n = s > 0 ? '+g' : '-g', crosses = [], ports = [];
    for (const f of [1.3, -1.9]) for (const k of [-1, 1]) crosses.push({ c: [f, s * 0.95, cz - 0.38], n, w: 0.7, t: 0.09, tilt: k * 38 });
    parts.push(marks('howl_cross' + s, crosses, { paint: 'ash' }));
    // The cabin windows, blanked from inside.
    for (let i = 0; i < 6; i++) ports.push({ c: [1.6 - i * 0.62 - (i > 2 ? 0.9 : 0), s * 0.94, cz + 0.28], n, w: 0.3, t: 0.22 });
    parts.push(marks('howl_ports' + s, ports, { paint: 'ink', md: 1 }));
    // A fist-sized smear of rust where the door was cut away.
    parts.push(box('howl_cut' + s, [-3.2, s * 0.9, cz + 0.05], [0.9, 0.02, 1.0], { paint: 'rust2', md: 1 }));
    // The ratchet straps over the hull to the bed rails.
    for (const f of [1.5, -0.6, -2.6]) parts.push(cyl('howl_strap' + s + f, [f, s * 1.0, cz + 0.2], [f, s * 1.24, 1.52], 0.025, { paint: 'olive', n: 4, md: 1 }));
    // Sawn-off wing roots, struts still on.
    parts.push(box('howl_wing' + s, [0.4, s * 1.45, cz + 0.98], [1.5, 1.0, 0.12], { paint: 'grey', rot: [s * -4, 0, 0] }));
    parts.push(box('howl_sawn' + s, [0.4, s * 1.955, cz + 0.98], [1.5, 0.02, 0.13], { paint: 'rust', md: 1 }));
    parts.push(cyl('howl_strut' + s, [0.4, s * 1.85, cz + 0.92], [0.4, s * 1.1, 1.55], 0.04, { paint: 'metal', n: 6 }));
  }
  parts.push(box('howl_wingbox', [0.4, 0, cz + 0.98], [1.5, 1.95, 0.16], { paint: 'grey' }));
  // The tail fin, kept for the skull chain.
  parts.push({ ...blade('howl_fin', [[-4.0, 3.35], [-5.5, 3.25], [-5.75, 4.75], [-5.15, 4.78]], 0.05, [0.72, 0.6]), paint: 'grey' });
  parts.push(box('howl_finstripe', [-5.0, 0, 4.4], [0.9, 0.11, 0.1], { paint: 'blue', rot: [0, -20, 0], md: 1 }));
  parts.push(chain('howl_skullchain', [-5.6, 0, 4.6], [-6.4, 0, 1.6], 0.35));
  [[-5.9, 3.65], [-6.15, 2.75], [-6.35, 1.95]].forEach(([f, h], i) => parts.push(skull('howl_chainskull' + i, [f, 0, h], 0.2, 180)));
  // The drone on its pole, mid-hull.
  parts.push(...stakedDrone('howl_drone', [-1.4, 0, cz + 0.95], 1.6));
  // Stacks behind the cab, fed from the bladders on the roof.
  const bf = front.backF;
  for (const s of [-1, 1]) parts.push(...stack('howl_stack' + s, [bf - 0.18, s * 0.98, 1.9], [bf - 0.18, s * 0.98, 5.25], 0.13));
  // The roof rack: rails, three bladders, jerrycans.
  for (const s of [-1, 1]) parts.push(cyl('howl_rack' + s, [bf + 1.45, s * 1.02, 4.32], [bf + 0.05, s * 1.02, 4.32], 0.03, { paint: 'metal', n: 5 }));
  for (const f of [bf + 1.35, bf + 0.75, bf + 0.15]) for (const s of [-1, 1]) parts.push(cyl('howl_rackpost' + s + R(f, 2), [f, s * 1.02, 4.1], [f, s * 1.02, 4.32], 0.025, { paint: 'metal', n: 4, md: 1 }));
  [[bf + 1.1, -0.42], [bf + 0.5, -0.38], [bf + 0.8, 0.36]].forEach(([f, g], i) => parts.push(bladder('howl_bladder' + i, [f, g, 4.38], 0.62, 0.27)));
  for (const s of [-1, 1]) parts.push(cyl('howl_feed' + s, [bf + 0.5, s * 0.4, 4.2], [bf - 0.18, s * 0.98, 3.0], 0.035, { paint: 'rotgas', n: 5, md: 1 }));
  parts.push(jerrycan('howl_can0', [bf + 0.3, 0.75, 4.33], { rot: [0, 0, 90] }));
  parts.push(jerrycan('howl_can1', [bf + 1.25, 0.82, 4.33], { rot: [0, 0, 90] }));
  // Spare tyres stood at the back corners of the bed, and a barrel lashed beside each.
  for (const s of [-1, 1]) {
    parts.push({ ...wheel('howl_spare' + s, [-5.15, s * 0.95, 2.1], 0.58, 0.2, 14), paint: 'tyre' });
    parts.push({ kind: 'drum', name: 'howl_barrel' + s, f: -4.3, g: s * 1.0, r: 0.29, z: [1.51, 2.37], n: 12, top: { sh: 0.9 }, paint: 'rust2' });
    parts.push(chain('howl_sidechain' + s, [2.8, s * 1.24, 1.5], [-5.6, s * 1.24, 1.5], 0.32));
  }
  // The rear: a tail lamp and a tow hitch.
  parts.push(box('howl_rearbar', [-6.62, 0, 1.0], [0.12, 2.3, 0.2], { paint: 'metal' }));
  parts.push(cyl('howl_hitch', [-6.6, 0, 0.95], [-7.0, 0, 0.95], 0.06, { paint: 'metal', n: 6 }));
  // The driver, and a rider up on the hull with the wing roots for handholds.
  parts.push(rider('howl_driver', [bf + 0.9, -0.5, 2.55], [[bf + 1.45, -0.72, 3.05], [bf + 1.45, -0.28, 3.05]], { lean: 8 }));
  parts.push(rider('howl_rider', [1.9, 0.2, cz + 0.98], [[1.15, -0.6, cz + 1.06], [1.15, 0.95, cz + 1.06]], { lean: 20, thorn: true, knee: [0.38, 0.12, -0.12], shin: [0.08, 0.05, -0.36] }));
  const lamps = [
    ...front.lamps.map((p) => ({ at: p.map((x) => R(x * S)), n: [1, 0, 0], rgb: '255,214,150', kind: 'steady' })),
    { at: [R(-6.68 * S), 0, R(1.1 * S)], n: [-1, 0, 0], rgb: '255,60,40', kind: 'steady' },
  ];
  return { parts, lamps };
}

// ── THE SLAKE CART ────────────────────────────────────────────────────────────
function buildCart() {
  const parts = [];
  const front = truckFront('cart', 5.4, { cab: 'rust', tally: ['|', '|', 'o', '|', '|', '|', '|'] });
  parts.push(...front.parts);
  parts.push(...chassis('cart', 5.1, -5.7));
  [[4.1, true], [-0.3, false], [-1.5, false], [-3.6, false], [-4.8, true]].forEach(([f, sp], i) => parts.push(...axle('cart_ax' + i, f, 0.8, 0.28, 1.28, sp)));
  // The tank on its cradles.
  const cz = 2.42, r = 1.05, fT = 2.3, fA = -5.35;
  parts.push(pod('cart_tank', 0, cz, [[fT, 0.55], [fT - 0.12, 0.94], [fT - 0.35, r], [fA + 0.35, r], [fA + 0.12, 0.94], [fA, 0.55]], { sides: 18, paint: 'tank', role: 'body', capFore: { kind: 'flat', sh: 0.66 }, capAft: { kind: 'flat', sh: 0.58 } }));
  for (const f of [1.6, -0.6, -2.8, -4.7]) parts.push(box('cart_cradle' + f, [f, 0, 1.52], [0.24, 1.9, 0.3], { paint: 'metal' }));
  // Hoops round the tank at three stations: one tube each, round a circle in the g-h plane.
  for (const f of [1.0, -1.7, -4.0]) {
    const pts = [];
    for (let k = 0; k <= 18; k++) { const a = k / 18 * Math.PI * 2; pts.push([f, mm(Math.cos(a) * (r + 0.02)), mm(cz + Math.sin(a) * (r + 0.02))]); }
    parts.push({ ...tube('cart_hoop' + f, pts, 0.03, { sides: 4, role: 'body', sh: 0.6 }), paint: 'metal', minDetail: 1 });
  }
  // The riveted armour skirt over the wheels.
  for (const s of [-1, 1]) {
    for (const [c, L] of [[0.55, 3.3], [-3.1, 3.6]]) {
      parts.push(box('cart_skirt' + s + c, [c, s * 1.62, 0.95], [L, 0.06, 1.0], { paint: 'rust2' }));
      const rv = [];
      for (let f = c - L / 2 + 0.2; f < c + L / 2; f += 0.35) for (const h of [0.55, 1.35]) rv.push({ c: [f, s * 1.655, h], n: s > 0 ? '+g' : '-g', w: 0.05, t: 0.05 });
      parts.push(marks('cart_srivets' + s + c, rv, { paint: 'steel', md: 1 }));
    }
    // Tallies and the handprints, painted on the tank at its widest. No words.
    parts.push(tally('cart_tankmarks' + s, 0.6, s * (r + 0.015), cz + 0.05, ['|', '|', '|', 'O', '|', 'o', '|', '|', 'O']));
    // Daubed big, a whole palm's worth of ash, so they read from the road.
    [[-1.8, 0.0, -10], [-2.5, 0.22, 14], [-3.2, -0.1, -4]].forEach(([f, dh, t], i) => parts.push(handprint('cart_hand' + s + i, f, s * (r + 0.015), cz + dh, s, 2.6, t)));
    // Crown spikes either side of the catwalk, filed before every run.
    for (let f = 1.7; f > -4.9; f -= 0.6) {
      const g = s * 0.55, h = cz + Math.sqrt(r * r - 0.55 * 0.55);
      parts.push(spike('cart_crown' + s + R(f, 2), [f, g, h], [0, s * 0.5, 0.86], 0.05, 0.42, { paint: 'bone' }));
    }
    // Catwalk rail.
    parts.push(cyl('cart_crail' + s, [1.6, s * 0.28, cz + r + 0.58], [-4.7, s * 0.28, cz + r + 0.58], 0.025, { paint: 'metal', n: 5, md: 1 }));
    for (let f = 1.6; f >= -4.7; f -= 1.05) parts.push(cyl('cart_cpost' + s + R(f, 2), [f, s * 0.28, cz + r + 0.05], [f, s * 0.28, cz + r + 0.58], 0.022, { paint: 'metal', n: 4, md: 1 }));
    // Hose reels and taps at the back.
    parts.push(cyl('cart_reel' + s, [-5.55, s * 0.35, 1.25], [-5.55, s * 0.85, 1.25], 0.3, { paint: 'rust', n: 12 }));
    parts.push(cyl('cart_hose' + s, [-5.55, s * 0.4, 1.25], [-5.55, s * 0.8, 1.25], 0.33, { paint: 'ink', n: 12, md: 1 }));
    parts.push(cyl('cart_tap' + s, [-5.35, s * 0.45, 1.8], [-5.6, s * 0.45, 1.8], 0.06, { paint: 'steel', n: 6, md: 1 }));
  }
  parts.push(box('cart_catwalk', [-1.55, 0, cz + r + 0.04], [6.4, 0.5, 0.05], { paint: 'wood' }));
  parts.push(box('cart_hatch', [-1.5, 0, cz + r + 0.1], [0.55, 0.55, 0.1], { paint: 'steel' }));
  // The rack of glass tubes on the near side: how they keep the rule.
  parts.push(box('cart_rack', [3.0 - 0.6, -1.66, 1.68], [0.62, 0.1, 0.06], { paint: 'wood' }));
  parts.push(box('cart_rackbase', [3.0 - 0.6, -1.66, 1.42], [0.62, 0.1, 0.05], { paint: 'wood' }));
  for (let i = 0; i < 6; i++) parts.push(cyl('cart_vial' + i, [2.17 + i * 0.09, -1.66, 1.45], [2.17 + i * 0.09, -1.66, 1.82], 0.025, { paint: 'vial', role: 'window', n: 6, md: 1 }));
  // The ladder to the hatch.
  for (const s of [-1, 1]) parts.push(cyl('cart_ladder' + s, [-5.5, s * 0.22, 0.6], [-5.32, s * 0.22, cz + r + 0.05], 0.025, { paint: 'metal', n: 5 }));
  for (let i = 0; i < 8; i++) { const t = i / 7; parts.push(cyl('cart_rung' + i, [-5.5 + 0.18 * t, -0.22, 0.75 + t * 2.6], [-5.5 + 0.18 * t, 0.22, 0.75 + t * 2.6], 0.02, { paint: 'metal', n: 4, md: 1 })); }
  parts.push(box('cart_rearbar', [-5.74, 0, 0.95], [0.12, 2.3, 0.2], { paint: 'metal' }));
  // One stack, on the right, and a single bladder on the cab roof.
  const bf = front.backF;
  parts.push(...stack('cart_stack', [bf - 0.18, 1.0, 1.9], [bf - 0.18, 1.0, 4.85], 0.12));
  parts.push(bladder('cart_bladder', [bf + 0.8, -0.2, 4.35], 0.7, 0.3));
  parts.push(jerrycan('cart_can', [bf + 0.3, 0.6, 4.33], { rot: [0, 0, 90], paint: 'olive' }));
  // The driver, and a rider sat on the catwalk with the dogs' water.
  parts.push(rider('cart_driver', [bf + 0.9, -0.5, 2.55], [[bf + 1.45, -0.72, 3.05], [bf + 1.45, -0.28, 3.05]], { lean: 8, jacket: 'quilt' }));
  parts.push(rider('cart_rider', [0.9, 0.05, cz + r + 0.1], [[1.25, -0.25, cz + r + 0.42], [1.25, 0.3, cz + r + 0.42]], { lean: 10, knee: [0.4, 0.1, -0.05], shin: [0.1, 0.05, -0.38] }));
  const lamps = [
    ...front.lamps.map((p) => ({ at: p.map((x) => R(x * S)), n: [1, 0, 0], rgb: '255,214,150', kind: 'steady' })),
    { at: [R(-5.8 * S), 0, R(1.1 * S)], n: [-1, 0, 0], rgb: '255,60,40', kind: 'steady' },
  ];
  return { parts, lamps };
}

// ── THE HOUND-RUNNER ──────────────────────────────────────────────────────────
function buildRunner() {
  const parts = [];
  // Wheels: a fat front and a fatter rear, tyres on h = 0.
  parts.push({ ...wheel('run_front', [1.05, 0, 0.46], 0.46, 0.1, 16), paint: 'tyre' });
  parts.push({ ...wheel('run_rear', [-0.6, 0, 0.48], 0.48, 0.14, 16), paint: 'tyre' });
  // Forks, the steering head and the frame.
  for (const s of [-1, 1]) parts.push(cyl('run_fork' + s, [0.72, s * 0.1, 1.12], [1.05, s * 0.1, 0.46], 0.035, { paint: 'steel', n: 6 }));
  parts.push(cyl('run_head', [0.68, 0, 1.2], [0.78, 0, 0.98], 0.05, { paint: 'metal', n: 6 }));
  parts.push(cyl('run_down', [0.72, 0, 1.05], [0.15, 0, 0.36], 0.045, { paint: 'metal', n: 6 }));
  parts.push(cyl('run_spine', [0.7, 0, 1.12], [-0.45, 0, 0.92], 0.045, { paint: 'metal', n: 6 }));
  for (const s of [-1, 1]) {
    parts.push(cyl('run_swing' + s, [-0.05, s * 0.12, 0.42], [-0.6, s * 0.12, 0.48], 0.035, { paint: 'metal', n: 6 }));
    parts.push(cyl('run_shock' + s, [-0.45, s * 0.12, 0.92], [-0.55, s * 0.12, 0.52], 0.03, { paint: 'rust', n: 6, md: 1 }));
  }
  // The V-twin: a crankcase and two jugs, finned.
  parts.push(box('run_case', [0.12, 0, 0.42], [0.42, 0.26, 0.24], { paint: 'metal' }));
  for (const [k, a] of [[0, 32], [1, -32]]) {
    const base = [0.12 + (k ? -0.05 : 0.05), 0, 0.52], X = rotor([0, -a, 0], base);
    const top = X([base[0], 0, base[2] + 0.36]);
    parts.push(cyl('run_jug' + k, base, top, 0.1, { paint: 'steel', n: 8 }));
    for (let i = 1; i <= 3; i++) { const p = add(base, mul(sub(top, base), i / 4)); parts.push(cyl('run_fin' + k + i, sub(p, mul(unit(sub(top, base)), 0.012)), add(p, mul(unit(sub(top, base)), 0.012)), 0.13, { paint: 'metal', n: 8, md: 1 })); }
  }
  // The tank with an ash handprint, the seat, the bars.
  parts.push(box('run_tank', [0.38, 0, 1.12], [0.55, 0.32, 0.22], { paint: 'rust', rot: [0, 8, 0] }));
  parts.push(box('run_tankprint', [0.38, 0, 1.235], [0.13, 0.12, 0.012], { paint: 'ash', md: 1, rot: [0, 8, 0] }));
  parts.push(box('run_seat', [-0.25, 0, 0.98], [0.62, 0.3, 0.1], { paint: 'leather' }));
  parts.push(cyl('run_bars', [0.62, -0.4, 1.32], [0.62, 0.4, 1.32], 0.025, { paint: 'metal', n: 5 }));
  for (const s of [-1, 1]) parts.push(cyl('run_riser' + s, [0.7, s * 0.08, 1.2], [0.62, s * 0.18, 1.32], 0.025, { paint: 'metal', n: 5, md: 1 }));
  // The front fender with teeth, the lamp and the skull over it.
  parts.push(box('run_fender', [1.05, 0, 0.98], [0.62, 0.22, 0.05], { paint: 'rust2', rot: [0, -6, 0] }));
  for (let i = 0; i < 5; i++) parts.push(spike('run_tooth' + i, [1.33, -0.08 + i * 0.04, 0.95], [0.3, 0, -1], 0.012, 0.07, { paint: 'bone', md: 1 }));
  parts.push(cyl('run_lamp', [0.8, 0, 1.08], [0.92, 0, 1.08], 0.1, { paint: 'metal', n: 10 }));
  parts.push(cyl('run_lens', [0.92, 0, 1.08], [0.935, 0, 1.08], 0.085, { paint: 'lamp', role: 'window', n: 10 }));
  parts.push(skull('run_skull', [0.86, 0, 1.28], 0.2, 0));
  // One upswept stack over the rider's shoulder.
  const st = [[0.1, 0.16, 0.52], [-0.2, 0.22, 0.62], [-0.48, 0.26, 1.1], [-0.6, 0.27, 1.95]];
  for (let i = 0; i < st.length - 1; i++) parts.push(cyl('run_stack' + i, st[i], st[i + 1], 0.05, { paint: 'exhaust', n: 8, open: i === st.length - 2 }));
  parts.push(cyl('run_stacklip', [-0.59, 0.27, 1.85], [-0.6, 0.27, 1.97], 0.065, { paint: 'metal', n: 8, open: true }));
  // The rear fender, the hitch and the cage trailer.
  parts.push(box('run_rfender', [-0.68, 0, 1.02], [0.58, 0.3, 0.05], { paint: 'rust2', rot: [0, 10, 0] }));
  parts.push(cyl('run_hitch', [-0.85, 0, 0.5], [-1.45, 0, 0.5], 0.035, { paint: 'metal', n: 6 }));
  const c0 = -1.45, c1 = -3.35, W = 0.58, h0 = 0.42, h1 = 1.32;
  parts.push(box('cage_floor', [(c0 + c1) / 2, 0, h0], [c0 - c1, W * 2, 0.06], { paint: 'wood' }));
  parts.push(box('cage_axle', [-2.4, 0, 0.33], [0.08, W * 2 + 0.25, 0.08], { paint: 'metal' }));
  for (const s of [-1, 1]) parts.push({ ...wheel('cage_w' + s, [-2.4, s * (W + 0.1), 0.33], 0.33, 0.08, 14), paint: 'tyre' });
  for (const [f, g] of [[c0, -W], [c0, W], [c1, -W], [c1, W]]) parts.push(cyl('cage_post' + f + g, [f, g, h0], [f, g, h1], 0.03, { paint: 'metal', n: 5 }));
  for (const g of [-W, W]) for (const h of [h0 + 0.03, h1]) parts.push(cyl('cage_lrail' + g + h, [c0, g, h], [c1, g, h], 0.025, { paint: 'metal', n: 5 }));
  for (const f of [c0, c1]) for (const h of [h0 + 0.03, h1]) parts.push(cyl('cage_crail' + f + h, [f, -W, h], [f, W, h], 0.025, { paint: 'metal', n: 5 }));
  for (let f = c0 - 0.2; f > c1 + 0.05; f -= 0.2) for (const g of [-W, W]) parts.push(cyl('cage_bar' + R(f, 2) + g, [f, g, h0], [f, g, h1], 0.014, { paint: 'metal', n: 4, md: 1 }));
  for (let g = -W + 0.19; g < W; g += 0.19) {
    parts.push(cyl('cage_back' + R(g, 2), [c1, g, h0], [c1, g, h1], 0.014, { paint: 'metal', n: 4, md: 1 }));
    parts.push(cyl('cage_roof' + R(g, 2), [c0, g, h1], [c1, g, h1], 0.014, { paint: 'metal', n: 4, md: 1 }));
  }
  // The cage door at the front, latched on a rope back to the saddle.
  for (let g = -W + 0.15; g < W; g += 0.15) parts.push(cyl('cage_door' + R(g, 2), [c0 - 0.02, g, h0 + 0.05], [c0 - 0.02, g, h1 - 0.05], 0.014, { paint: 'rust', n: 4, md: 1 }));
  parts.push(chain('cage_rope', [c0 - 0.02, 0.3, h1 - 0.1], [-0.45, 0.2, 0.95], 0.18, { paint: 'wood', r: 0.015 }));
  parts.push(box('cage_tarp', [(c0 + c1) / 2 - 0.4, 0, h1 + 0.03], [1.0, W * 2 + 0.04, 0.03], { paint: 'quilt', md: 1 }));
  // The rider.
  parts.push(rider('run_rider', [-0.22, 0, 1.0], [[0.6, -0.36, 1.33], [0.6, 0.36, 1.33]], { lean: 28, knee: [0.4, 0.13, -0.08], shin: [0.04, 0.03, -0.5] }));
  const lamps = [
    { at: [R(0.95 * S), 0, R(1.08 * S)], n: [1, 0, 0], rgb: '255,214,150', kind: 'steady' },
    { at: [R(-3.38 * S), 0, R(0.5 * S)], n: [-1, 0, 0], rgb: '255,60,40', kind: 'steady' },
  ];
  return { parts, lamps };
}

// ── The files ─────────────────────────────────────────────────────────────────
const classFacts = { contactSize: 0.3333, modelScale: 1, metres: M_PER_UNIT, light: [0.4, 1.15, 0.3] };
function doc(id, name, note, built, extraParams = {}) {
  return {
    id, kind: 'mesh',
    params: {
      name, note, classFacts, navLamps: null, lamps: built.lamps, finish: 'matte', paints: PAINTS,
      parts: [group(id + '_metres', built.parts, { xf: { s: R(S, 6) } })],
      ...extraParams,
    },
  };
}
const NOTE = 'A Wildblood column rig, drawn by plugins/column as a ground contact of class column. Authored in metres in scripts/shapes/concepts/wildblood-column.mjs and scaled to 7.2 m a unit, the podracer\'s. Tyres on h = 0. No words anywhere on it.';
const files = [
  doc('column', 'The Howl', 'The lead rig: a Mule fuselage strapped to a five-axle chassis. ' + NOTE, buildHowl(), { variants: { runner: 'column_runner', cart: 'column_cart' } }),
  doc('column_runner', 'The hound-runner', 'A V-twin towing the dogs\' cage. ' + NOTE, buildRunner()),
  doc('column_cart', 'The Slake cart', 'The water tanker, up-armoured. ' + NOTE, buildCart()),
];
let bad = false;
for (const d of files) {
  const file = 'mesh_' + d.id + '.json';
  const v = validateMesh(d.params, file);
  for (const w of v.warnings) console.warn('warn', w);
  if (v.errors.length) { bad = true; for (const e of v.errors) console.error(e); continue; }
  writeFileSync(new URL('../../../content/vehicle_models/' + file, import.meta.url), formatMesh(d));
  console.log('wrote content/vehicle_models/' + file);
}
if (bad) process.exit(1);
