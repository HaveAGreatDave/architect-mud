// The Krell Barrow 2076: writes content/vehicle_models/mesh_truck_scrapper_2076.json, and names it as
// the 2076 edition in mesh_truck_scrapper.json's `variants`.
//
//   node scripts/shapes/concepts/barrow-2076.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:truck/scrapper~e2076, or any variant with ~e2076 after +t
//
// The Barrow fifty years after the cage cab, after the Mule in the Hover Rig Expo concept
// (docs/proposals/hover-rigs.md). It's the Courier 2076's body (concepts/courier-2076.mjs) cut down to
// a cab-over on the Barrow's shorter frame, the way the Carcass 2076 is a whole airframe that has been
// crashed and flown again: the same waist, raked screen, lift pads and rocker, then three owners of
// wear. The port door is a pearl one off a Courier, the starboard quarter and the roof are in primer,
// one headlamp is an old round one taped in, one mirror is a mirror, one pad is a vintage spare, one
// thruster is blanked off, and the screen is taped across a crack. Two stacks stand at the cab's back
// corners where the Courier's fins were, a spare pod is strapped flat on the roof, the fleet number
// 4471 is stencilled on both quarters, and a sun-ring badge is screwed to the nose. A bobtail carries
// odd crates chained to a stake bed.
//
// ⚠ THIS STARTS FROM mesh_truck_scrapper.json AND KEEPS ITS FRAME. The cab stays inside the old cab's
// box (cab0 to just past the nose, the old roof height and width), so the fittings still bolt where
// they did, and nothing taller than the trailer's floor goes aft of cab0 less the stack's reach, which
// is the trailer's swing clearance (scripts/shapes/meshes.mjs section 7). The chassis, the fifth wheel,
// the tail lamps and the lamp stations are the old Barrow's numbers. The trailer is the old trailer.
//
// The fittings come from scripts/shapes/truck-fittings.mjs, off this body's anchors: the stock
// Barrow's, with the screen, mascot, roof kit and stacks moved where this body puts them. The roof kit
// sits forward of the spare pod, and the cage's middle bar passes over it. The lifter halos are drawn
// here, on the new pads.
//
// ⚠ THIS OVERWRITES THE JSON. Edit this file, not the mesh in the Modelshop.
//
// Frame: f fore, g right, h up, in the truck's own units, laid out from the nose anchor at f 0.40
// (aircraft3d.js centres it per variant). Every solid here is convex and carries its own centre
// (`cen`), which the truck renderers cull and light by.
import { readFileSync, writeFileSync } from 'node:fs';
import { truckFittingParts, vintageAnchors } from '../truck-fittings.mjs';
import { TRUCK_ROWS } from '../../../client/shared/vehicle-models.js';
const { formatMesh, validateMesh, compileMesh } = await import('../../../client/shared/vehicle-mesh.js');
// The stock Barrow's proportion row: the fittings' anchors start from it.
const ROW = TRUCK_ROWS.scrapper;

const BASE_URL = new URL('../../../content/vehicle_models/mesh_truck_scrapper.json', import.meta.url);
const BASE_DOC = JSON.parse(readFileSync(BASE_URL, 'utf8'));
const BASE = BASE_DOC.params;
const T = BASE.truck, L = T.geom;
const W = T.w, HI = T.hi;
const CAB0 = L.cab0, CAB1 = L.cab1, FRAME0 = L.frame0;
const [PIN0, PIN1] = T.pin;

// ── Colours ──
const CHROME = [226, 232, 240];          // pk 'bright': the booth's trim colour (brass on the factory paint)
const ACCENT = [96, 196, 214];           // pk 'glow': the running light (amber on the factory paint)
const GLOW = [128, 226, 255];            // the lifter emitters, as the road wash
const OLD_GLOW = [236, 186, 116];        // the vintage spare pad's emitter, an older tube
const GLASS = [58, 84, 104];
const RED = [196, 66, 54];
const AMBER = [236, 176, 96];
const LED = [242, 236, 206];
const SEALED = [236, 226, 176];          // the round headlamp's old sealed beam
const UV_FULL = [[0, 1], [1, 1], [1, 0], [0, 0]];

// ── Primitives ── As courier-2076.mjs.
const r6 = (x) => (Math.round(x * 1e6) / 1e6) || 0;
const P = (f, g, h) => [r6(f), r6(g), r6(h)];
const mean = (vs) => { const s = [0, 0, 0]; for (const v of vs) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; } return s.map((x) => x / vs.length); };
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
// The box's six shades, blended by which way a face points: roof 1.00, underside 0.42, left 0.72,
// right 0.62, front 0.80, back 0.55. An axis-aligned face gets exactly the box's number.
const shadeOf = ([x, y, z]) => r6(x * x * (x > 0 ? 0.80 : 0.55) + y * y * (y > 0 ? 0.62 : 0.72) + z * z * (z > 0 ? 1.00 : 0.42));
const tags = (o) => {
  const t = {};
  for (const k of ['minDetail', 'when', 'whenNot']) if (o[k] != null) t[k] = o[k];
  return t;
};
// A convex solid from its faces: each face wound outward from the solid's centre, shaded by its normal.
// `o.face(i)` may override a face's role, tint, pk, uv and paint.
function solid(name, polys, o = {}) {
  const uniq = new Map();
  for (const p of polys) for (const v of p) uniq.set(v.join(','), v);
  const cen = mean([...uniq.values()]).map(r6);
  const faces = polys.map((p, i) => {
    const fo = (o.face && o.face(i)) || {};
    let pts = p.map((v) => P(v[0], v[1], v[2]));
    let uv = fo.uv || null;
    let n = newell(pts);
    const c = mean(pts);
    if (n[0] * (c[0] - cen[0]) + n[1] * (c[1] - cen[1]) + n[2] * (c[2] - cen[2]) < 0) {
      pts = pts.slice().reverse(); if (uv) uv = uv.slice().reverse(); n = n.map((x) => -x);
    }
    const f = { role: fo.role || o.role || 'body', sh: shadeOf(n), p: pts, cen };
    const tint = fo.tint || o.tint, pk = fo.pk || o.pk;
    if (tint) { f.tint = tint; if (pk) f.pk = pk; }
    if (uv) { f.uv = uv; f.art = fo.art || 'truckcab'; }
    // A paint slot (params.paints) for its surface; `none` keeps a face out of its solid's slot.
    const paint = fo.paint || o.paint;
    if (paint && paint !== 'none') f.paint = paint;
    return f;
  });
  return { kind: 'poly', name, faces, ...tags(o) };
}
// Rings of equal length, skinned in order and capped at both ends.
function loft(name, rings, o = {}) {
  const polys = [], n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    polys.push([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]]);
  }
  polys.push(rings[0].slice(), rings[rings.length - 1].slice());
  return solid(name, polys, o);
}
// An upright n-gon puck, and an n-gon tube along f.
const ngon = (n, fn) => Array.from({ length: n }, (_, k) => fn(Math.cos((k + 0.5) / n * Math.PI * 2), Math.sin((k + 0.5) / n * Math.PI * 2)));
const puck = (name, f, g, r, z0, z1, o = {}, n = 10) =>
  loft(name, [z0, z1].map((z) => ngon(n, (c, s) => [f + c * r, g + s * r, z])), o);
const tubeF = (name, f0, f1, g, h, r, o = {}, n = 8) =>
  loft(name, [f0, f1].map((f) => ngon(n, (c, s) => [f, g + c * r, h + s * r])), o);
// A plain box, the native part the old builder's boxes ported to.
const box = (name, f0, f1, w, z0, z1, o = {}) => {
  const b = { kind: 'box', name, f: [r6(f0), r6(f1)], w: r6(w), z: [r6(z0), r6(z1)] };
  if (o.g) b.g = r6(o.g);
  if (o.role && o.role !== 'body') b.role = o.role;
  if (o.tint) { b.tint = o.tint; if (o.pk) b.pk = o.pk; }
  if (o.paint) b.paint = o.paint;
  return { ...b, ...tags(o) };
};
// Single two-sided sheets (no `cen`) in one part, as the old builder's polys were.
const sheets = (name, list, o = {}) => ({ kind: 'poly', name, faces: list.map((pts) => {
  const f = { role: o.role || 'body', sh: o.sh ?? 0.9, p: pts.map((v) => P(v[0], v[1], v[2])) };
  if (o.tint) { f.tint = o.tint; if (o.pk) f.pk = o.pk; }
  if (o.paint) f.paint = o.paint;
  return f;
}), ...tags(o) });
const sheet = (name, pts, o = {}) => sheets(name, [pts], o);
const LR = [-1, 1];
const fine = { minDetail: 1 };

// ── The cab ── The Courier 2076's two solids, cut down to a cab-over: a lower body from the cab back to
// a short nose, and a glass cabin whose screen stands steeper than the Courier's because there is no
// bonnet in front of it. The waist is where a fitting expects the old cab's beltline.
const FLOOR = 0.030, CHAMF = 0.044, BELT = 0.116;
// The booth's flashes test each face's centre (faceWearsTrim), so the flank is cut in two at BAND and
// sliced along its length: one face per side would take a stripe whole or not at all.
const BAND = 0.099;
const SEC = (f, top, w, wb) => { const b = Math.min(BAND, top - 0.004); return [[f, -wb, FLOOR], [f, wb, FLOOR], [f, w, CHAMF], [f, w, b], [f, w, top], [f, -w, top], [f, -w, b], [f, -w, CHAMF]]; };
// The stations: the rear quarter, the door's back edge (CAB1 - 0.112, the door art's panel is just
// forward of it), the door's middle, the screen's foot, then the nose drops away.
const DOOR_B = CAB1 - 0.112, DOOR_F = CAB1 - 0.012;
const NOSE = [[0.236, BELT, W, 0.124], [DOOR_B, BELT, W, 0.124], [0.340, BELT, W, 0.124], [DOOR_F, BELT, W, 0.124],
  [0.403, 0.110, W, 0.124], [0.412, 0.101, W - 0.004, 0.120], [0.418, 0.093, W - 0.014, 0.106]];
// Faces by ring pair and edge (see SEC): edge 2, 3 the right flank, 5, 6 the left, 1 and 7 the
// chamfers. Ring pair 0 is the rear quarter, 2 and 3 the door.
const RINGS = NOSE.length;               // ring pairs: CAB0 to NOSE[0], then along NOSE
const lowerPaint = (i) => {
  if (i >= RINGS * 8) return null;                                // the caps
  const pair = (i / 8) | 0, e = i % 8;
  if (e === 1 || e === 7) return { role: 'strut', paint: 'carbon' };   // the rocker
  if ((pair === 2 || pair === 3) && (e === 5 || e === 6)) return { paint: 'donor' };   // the port door, off a Courier
  if ((pair === 0 || pair === 1) && (e === 2 || e === 3)) return { paint: 'primer' };  // the starboard quarter, never finished
  if (pair >= 4 && e === 4) return { paint: 'primer' };           // the nose top, filled and sanded
  return null;
};
const lower = loft('lower body', [SEC(CAB0, BELT, W, 0.124), ...NOSE.map(([f, top, w, wb]) => SEC(f, top, w, wb))],
  { paint: 'body', face: lowerPaint });
// The nose's height at f, for what sits on it.
const bonnetAt = (f) => {
  for (let i = 0; i < NOSE.length - 1; i++) {
    const [fa, ha] = NOSE[i], [fb, hb] = NOSE[i + 1];
    if (f >= fa && f <= fb) return ha + (hb - ha) * (f - fa) / (fb - fa);
  }
  return BELT;
};
const SILL = 0.134;                                        // the side glass's bottom edge
// The cabin: its flanks lean in from the waist (WS) to the roof (WT), so a side is one plane.
const WS = 0.134, WT = 0.106, ROOF = HI;
const gAt = (h) => WS - (WS - WT) * (h - BELT) / (ROOF - BELT);
const SCR0 = 0.390, SCR1 = 0.318;                          // the screen's foot and head, fore-aft: about 56 degrees
const HDR = ROOF - 0.020;                                  // the top of the glass
const RBACK = CAB0 + 0.002, RTOP = 0.204, RLIP = CAB0 + 0.026;   // the roof falls away aft to the back
const scrF = (h) => SCR0 - (SCR0 - SCR1) * (h - BELT) / (ROOF - BELT);
const cabV = {
  bR: (s) => [RBACK, s * WS, BELT], bF: (s) => [SCR0, s * WS, BELT],
  tF: (s) => [SCR1, s * WT, ROOF], tB: (s) => [RLIP, s * WT, ROOF], rT: (s) => [RBACK, s * gAt(RTOP), RTOP],
  sR: (s) => [RBACK, s * gAt(SILL), SILL], sF: (s) => [scrF(SILL), s * gAt(SILL), SILL],
  // The screen's head: a cab-over's screen is most of its face, so a band of body runs across above it.
  hF: (s) => [scrF(HDR), s * gAt(HDR), HDR],
};
// Face 1 is the glass, 2 the header over it, and 3 and 4 the roof and the lip down to the back, both
// primer: the roof was the first panel to go.
const cabin = solid('cabin', [
  [cabV.bR(-1), cabV.bR(1), cabV.bF(1), cabV.bF(-1)],                         // floor (hidden)
  [cabV.bF(-1), cabV.bF(1), cabV.hF(1), cabV.hF(-1)],                         // the screen
  [cabV.hF(-1), cabV.hF(1), cabV.tF(1), cabV.tF(-1)],                         // the header
  [cabV.tF(-1), cabV.tF(1), cabV.tB(1), cabV.tB(-1)],                         // roof
  [cabV.tB(-1), cabV.tB(1), cabV.rT(1), cabV.rT(-1)],                         // the lip down to the back
  [cabV.rT(-1), cabV.rT(1), cabV.bR(1), cabV.bR(-1)],                         // back
  ...LR.flatMap((s) => [
    [cabV.bR(s), cabV.bF(s), cabV.sF(s), cabV.sR(s)],                         // flank, the strip under the glass
    [cabV.sR(s), cabV.sF(s), cabV.hF(s), cabV.tF(s), cabV.tB(s), cabV.rT(s)], // flank, the glass line up
  ]),
], { paint: 'body', face: (i) => (i === 1 ? { role: 'glass', tint: GLASS, uv: UV_FULL, paint: 'none' } : i === 3 || i === 4 ? { paint: 'primer' } : null) });

// Side glass: two panes a side, proud of the flank by a hair, in the flank's own plane.
const out = (s, f, h, d) => [f, s * (gAt(h) + d), h];
function pane(name, s, fA, fB, h0, h1, tint = [50, 74, 92]) {
  const fa = (f, h) => Math.min(f, scrF(h) - 0.012);
  const ring = (d) => [out(s, fA, h0, d), out(s, fa(fB, h0), h0, d), out(s, fa(fB, h1), h1, d), out(s, fA, h1, d)];
  return loft(name, [ring(0.0006), ring(0.0034)], { role: 'glass', tint, ...fine });
}
const glassSide = LR.flatMap((s) => [pane('door glass', s, DOOR_B + 0.006, 0.40, SILL, HDR - 0.004),
  // The port quarter light is a sheet of something that isn't glass, a shade lighter and duller.
  pane('quarter glass', s, 0.194, 0.274, SILL, HDR - 0.008, s < 0 ? [92, 104, 108] : [50, 74, 92])]);

// ── Tape ── Strips laid on a surface: `at(u, v)` is a point on it, and a strip runs from (u0, v0) to
// (u1, v1) with half-width `hw`. Tape is a fixed paint, so it never takes the booth's colour.
function strip(at, u0, v0, u1, v1, hw) {
  const du = u1 - u0, dv = v1 - v0, l = Math.hypot(du, dv) || 1, nu = -dv / l * hw, nv = du / l * hw;
  return [at(u0 + nu, v0 + nv), at(u1 + nu, v1 + nv), at(u1 - nu, v1 - nv), at(u0 - nu, v0 - nv)];
}
// The screen's outward normal in (f, h), and a point on it at fraction t up and g across.
const SN = (() => { const df = SCR1 - SCR0, dh = ROOF - BELT, l = Math.hypot(df, dh); return [dh / l, -df / l]; })();
const scrHW = (t) => WS - (WS - WT) * t;
const onScreen = (d) => (g, t) => [SCR0 + (SCR1 - SCR0) * t + SN[0] * d, g, BELT + (ROOF - BELT) * t + SN[1] * d];
const onQuarter = (s, d) => (f, h) => out(s, f, h, d);
// The screen was replaced as two flat panes, so a carbon mullion runs up the middle of it.
const tHdr = (HDR - BELT) / (ROOF - BELT);
const mullion = sheets('screen mullion', [[onScreen(0.0012)(-0.0028, 0), onScreen(0.0012)(0.0028, 0), onScreen(0.0012)(0.0028, tHdr), onScreen(0.0012)(-0.0028, tHdr)]], { role: 'strut', paint: 'carbon', sh: 0.7 });
const tape = [
  // Across a crack low in the screen's passenger half: one long strip and a short one over it.
  sheets('screen tape', [strip(onScreen(0.0016), 0.020, 0.10, 0.098, 0.34, 0.0045), strip(onScreen(0.0018), 0.052, 0.30, 0.090, 0.16, 0.0042)], { paint: 'tape', sh: 0.92, ...fine }),
  // An X over the starboard quarter light, and a strip along the port door glass's back edge.
  sheets('quarter tape', [strip(onQuarter(1, 0.0040), 0.200, 0.140, 0.268, 0.198, 0.0045), strip(onQuarter(1, 0.0042), 0.200, 0.198, 0.268, 0.140, 0.0045)], { paint: 'tape', sh: 0.62, ...fine }),
  sheets('door tape', [strip(onQuarter(-1, 0.0040), DOOR_B + 0.010, SILL + 0.004, DOOR_B + 0.010, 0.206, 0.0042)], { paint: 'tape', sh: 0.72, ...fine }),
];

// The waist band (one strip a side, so its top doesn't plate the nose), the rocker light line (out
// for its forward third, where a dead strip is) and the nose bar.
const trim = [
  ...LR.map((s) => box('waist band', CAB0 + 0.004, 0.398, 0.0025, BELT - 0.010, BELT + 0.002, { role: 'window', tint: CHROME, pk: 'bright', g: s * (W + 0.0005) })),
  box('rocker light', CAB0 + 0.010, 0.330, W + 0.001, 0.040, 0.044, { role: 'window', tint: ACCENT, pk: 'glow', ...fine }),
  box('dead rocker light', 0.330, 0.404, W + 0.001, 0.040, 0.044, { role: 'strut', paint: 'carbon', ...fine }),
  // Roof edge pinstripe over the screen head, and the marker lamps along it (truck.geom.markF/markZ).
  // Two of the five are out.
  box('roof pinstripe', SCR1 - 0.010, SCR1 + 0.002, WT, ROOF - 0.003, ROOF + 0.002, { role: 'window', tint: CHROME, pk: 'bright', ...fine }),
  ...[-2, -1, 0, 1, 2].map((i) => box('marker lamp', SCR1 - 0.008, SCR1, 0.008, ROOF + 0.002, ROOF + 0.007,
    i === -1 || i === 2 ? { role: 'strut', paint: 'rust', g: i * W * 0.34, ...fine } : { role: 'window', tint: AMBER, g: i * W * 0.34, ...fine })),
];
const MARK_F = SCR1 - 0.004, MARK_Z = ROOF + 0.0045;

// Lamps at the old stations (truck.geom): an LED bar on the port side as the Courier has, and on the
// starboard side a round sealed beam in a chrome bezel, taped in.
const NOSE_FACE = NOSE[NOSE.length - 1][0];
const lamps = [
  box('headlamp', L.lampF - 0.003, L.lampF + 0.005, 0.020, L.lampMidZ - 0.007, L.lampMidZ + 0.007, { role: 'window', tint: LED, g: -L.lampG }),
  box('lamp brow', L.lampF - 0.004, L.lampF + 0.004, 0.022, L.lampMidZ + 0.007, L.lampMidZ + 0.010, { role: 'window', tint: CHROME, pk: 'bright', g: -L.lampG, ...fine }),
  // Standing on the nose face (f 0.418) rather than through it: a chrome ring cut by a body panel is
  // what the painter's sort gets wrong (truckNoseSliceSmoke).
  tubeF('round headlamp bezel', NOSE_FACE + 0.0004, NOSE_FACE + 0.0054, L.lampG - 0.004, L.lampMidZ, 0.0115, { role: 'window', tint: CHROME, pk: 'bright' }, 10),
  tubeF('round headlamp', NOSE_FACE + 0.0054, NOSE_FACE + 0.0070, L.lampG - 0.004, L.lampMidZ, 0.0088, { role: 'window', tint: SEALED }, 10),
  sheets('lamp tape', [strip((g, h) => [NOSE_FACE + 0.0074, g, h], L.lampG - 0.020, L.lampMidZ + 0.012, L.lampG + 0.010, L.lampMidZ - 0.012, 0.0035)], { paint: 'tape', sh: 0.8, ...fine }),
];

// ── The sun-ring badge on the nose face ── A disc in a ring with eight rays, in the booth's bright
// (brass on the factory paint). Screwed on below the lamps, where a ram plate would cover it.
const BADGE_F = 0.4186, BADGE_H = 0.062;
const ringPt = (r, a) => [BADGE_F, r * Math.cos(a), BADGE_H + r * Math.sin(a)];
const RN = 16, step = (k) => (k / RN) * Math.PI * 2;
const badge = [
  sheets('sun ring', Array.from({ length: RN }, (_, k) => [ringPt(0.0150, step(k)), ringPt(0.0150, step(k + 1)), ringPt(0.0112, step(k + 1)), ringPt(0.0112, step(k))]),
    { role: 'window', tint: CHROME, pk: 'bright', sh: 0.82 }),
  sheets('sun disc', [Array.from({ length: 10 }, (_, k) => ringPt(0.0068, (k / 10) * Math.PI * 2))], { role: 'window', tint: CHROME, pk: 'bright', sh: 0.88, ...fine }),
  sheets('sun rays', Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, d = 0.0018;
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (r, w) => [BADGE_F, r * ca - w * sa, BADGE_H + r * sa + w * ca];
    return [at(0.0166, -d), at(0.0166, d), at(0.0218, 0)];
  }), { role: 'window', tint: CHROME, pk: 'bright', sh: 0.82, ...fine }),
];

// ── The stacks ── Two, at the cab's back corners where the Courier's fins were, clamped to the corner.
// Their foot is the frame and their tip glows in the booth's glow (amber on the factory paint). The
// stack fittings wrap them at STACK_F, up to STACK_TOP.
const STACK_F = CAB0 - 0.001, STACK_G = 0.132, STACK_R = 0.0095, STACK_TOP = ROOF + 0.060;
const stacks = LR.flatMap((s) => [
  puck('stack', STACK_F, s * STACK_G, STACK_R, 0.064, STACK_TOP - 0.008, { role: 'gear', paint: 'exhaust' }, 8),
  puck('stack tip', STACK_F, s * STACK_G, STACK_R * 1.05, STACK_TOP - 0.008, STACK_TOP, { role: 'window', tint: ACCENT, pk: 'glow' }, 8),
  // A slotted heat shield over the hot middle, and the two clamps to the cab corner.
  puck('heat shield', STACK_F, s * STACK_G, STACK_R * 1.15, 0.150, 0.214, { role: 'strut', paint: 'rust', ...fine }, 8),
  ...[0.136, 0.226].map((h) => box('stack clamp', STACK_F, CAB0 + 0.008, 0.004, h, h + 0.006, { role: 'strut', g: s * (STACK_G - 0.004), ...fine })),
]);

// Mirrors: a camera pod on the port side, as the Courier has; on the starboard side an old flat
// mirror on a bent arm.
const mirrors = [
  box('camera arm', CAB1 - 0.026, CAB1 - 0.018, 0.010, 0.144, 0.148, { role: 'strut', g: -(W + 0.008), ...fine }),
  loft('camera pod', [CAB1 - 0.034, CAB1 - 0.008].map((f) => [[f, -(W + 0.014), 0.140], [f, -(W + 0.026), 0.140], [f, -(W + 0.026), 0.156], [f, -(W + 0.014), 0.156]]), { role: 'strut', paint: 'carbon' }),
  box('camera lens', CAB1 - 0.036, CAB1 - 0.033, 0.004, 0.144, 0.152, { role: 'glass', tint: [30, 40, 60], g: -(W + 0.020), ...fine }),
  box('mirror arm', CAB1 - 0.030, CAB1 - 0.024, 0.012, 0.150, 0.154, { role: 'strut', g: W + 0.010, ...fine }),
  box('mirror stay', CAB1 - 0.030, CAB1 - 0.024, 0.0025, 0.118, 0.152, { role: 'strut', g: W + 0.020, ...fine }),
  box('mirror back', CAB1 - 0.034, CAB1 - 0.026, 0.008, 0.140, 0.182, { role: 'strut', paint: 'rust', g: W + 0.026 }),
  box('mirror', CAB1 - 0.036, CAB1 - 0.034, 0.0065, 0.142, 0.180, { role: 'glass', tint: [120, 140, 150], g: W + 0.026, ...fine }),
];

// Door shut lines either side of each door, and a row of rivets either side of the port door, which
// was hung by somebody with a rivet gun rather than hinges that fit.
const seams = LR.flatMap((s) => [DOOR_B, DOOR_F].map((f) =>
  // Stopping under the waist band, which a panel's plane mustn't cut (truckNoseSliceSmoke).
  box('door shut line', f - 0.0015, f + 0.0015, 0.0015, CHAMF, BELT - 0.011, { role: 'strut', g: s * (W + 0.0005), ...fine })));
const rivets = [DOOR_B + 0.004, DOOR_F - 0.004].flatMap((f) => [0.054, 0.068, 0.082, 0.096, 0.108].map((h) =>
  box('rivet', f - 0.0012, f + 0.0012, 0.0008, h, h + 0.0024, { role: 'window', tint: CHROME, pk: 'bright', g: -(W + 0.0008), ...fine })));
const handles = LR.map((s) => box('door handle', CAB1 - 0.030, CAB1 - 0.014, 0.0012, 0.104, 0.108, { role: 'window', tint: CHROME, pk: 'bright', g: s * (W + 0.0004), ...fine }));

// Patch plates riveted over rot: low on the nose's corners and under the starboard quarter.
const patches = [
  box('patch plate', 0.392, 0.410, 0.0012, 0.046, 0.068, { paint: 'rust', g: W + 0.0010 }),
  box('patch plate', 0.200, 0.236, 0.0012, 0.046, 0.062, { paint: 'rust', g: W + 0.0010 }),
  box('patch plate', 0.248, 0.276, 0.0012, 0.050, 0.070, { paint: 'primer', g: -(W + 0.0010) }),
  ...[[0.394, 0.050], [0.408, 0.050], [0.394, 0.064], [0.408, 0.064], [0.203, 0.049], [0.233, 0.049], [0.203, 0.059], [0.233, 0.059]].map(([f, h]) =>
    box('patch rivet', f - 0.0012, f + 0.0012, 0.0008, h - 0.0012, h + 0.0012, { role: 'window', tint: CHROME, pk: 'bright', g: W + 0.0020, ...fine })),
];

// ── The fleet number, 4471 ── Stencilled high on both quarters in seven-segment strokes, read left to
// right from either side: standing at the starboard flank the nose is on your right, so the digits run
// forward; on the port flank they run aft.
const SEG = { 4: 'bcfg', 7: 'abc', 1: 'bc' };
const DIG_W = 0.0130, DIG_H = 0.0240, DIG_T = 0.0030, DIG_GAP = 0.0058, DIG_Z = 0.078;   // the top stroke clears the waist band
function digit(name, s, u0, ch) {
  // u runs along the flank in reading order, v up; a stroke is a box a hair proud of the flank.
  const parts = [];
  const along = (u) => (s > 0 ? u : -u);
  const seg = (ua, ub, va, vb) => {
    const f0 = along(ua), f1 = along(ub);
    parts.push(box(name, Math.min(f0, f1), Math.max(f0, f1), 0.0007, DIG_Z + va, DIG_Z + vb, { paint: 'stencil', g: s * (W + 0.0007), ...fine }));
  };
  const w = DIG_W, h = DIG_H, t = DIG_T, m = h / 2;
  for (const c of SEG[ch]) {
    if (c === 'a') seg(u0, u0 + w, h - t, h);
    if (c === 'b') seg(u0 + w - t, u0 + w, m, h);
    if (c === 'c') seg(u0 + w - t, u0 + w, 0, m);
    if (c === 'f') seg(u0, u0 + t, m, h);
    if (c === 'g') seg(u0, u0 + w, m - t / 2, m + t / 2);
  }
  return parts;
}
const NUM = '4471';
const numberParts = LR.flatMap((s) => {
  // Starboard: u is f, from the aft end. Port: u is -f, from the forward end.
  const f0 = 0.198, len = NUM.length * DIG_W + (NUM.length - 1) * DIG_GAP;
  const u0 = s > 0 ? f0 : -(f0 + len);
  return [...NUM].flatMap((ch, i) => digit('fleet number', s, u0 + i * (DIG_W + DIG_GAP), ch));
});

// ── The lift pads ── Three a side under the floor: a puck, a lit emitter ring (out when parked), a
// trim band, and an arm up into the frame for the aft pair. They don't match: the port middle pad is a
// vintage spare in primer with an older tube in it, and the starboard front one hangs low on a bent
// arm. truck.pods gets one row each.
const PAD_G = 0.104, PAD_Z0 = 0.016, PAD_Z1 = 0.034;
const PADS = [[0.366, 0.036], [0.226, 0.034], [0.062, 0.040]];
const pads = [], padRows = [];
for (const s of LR) for (const [i, [f, r]] of PADS.entries()) {
  const g = s * PAD_G, spare = s < 0 && i === 1, sag = s > 0 && i === 0 ? 0.004 : 0;
  const rr = spare ? r * 0.88 : r;
  padRows.push([f, g, rr, false, 0.024]);
  pads.push(puck('lift pad', f, g, rr * 0.92, PAD_Z0 + 0.004 - sag, PAD_Z1 - sag, { role: 'gear', paint: spare ? 'primer' : 'gunmetal' }, spare ? 8 : 10));
  pads.push(puck('emitter ring', f, g, rr, PAD_Z0 - sag, PAD_Z0 + 0.006 - sag, { role: 'window', tint: spare ? OLD_GLOW : GLOW, whenNot: 'parked', ...fine }, spare ? 8 : 12));
  if (!spare) pads.push(puck('pad trim', f, g, rr * 0.95, PAD_Z1 - 0.004 - sag, PAD_Z1 - 0.001 - sag, { role: 'window', tint: CHROME, pk: 'bright', ...fine }, 12));
  if (f < CAB0 || sag) pads.push(box('pad arm', f - 0.010, f + 0.010, 0.008, PAD_Z1 - sag, 0.050, { role: 'strut', g: g * 0.85 }));
}

// ── The chassis ── The old Barrow's numbers: rails, deck plate, fifth wheel (the pin), tail lamps.
const chassis = [
  ...LR.map((s) => box('frame rail', FRAME0 - 0.01, CAB1 - 0.02, 0.016, 0.028, 0.072, { role: 'strut', g: s * W * 0.62 })),
  box('deck plate', FRAME0, CAB0 + 0.02, W * 0.80, 0.050, 0.070),
  box('fifth wheel', PIN0, PIN1, W * 0.62, 0.070, 0.082, { role: 'strut' }),
  // A lit ring on the bare fifth wheel; a hitched box sits down over it.
  box('coupling ring', (PIN0 + PIN1) / 2 - 0.022, (PIN0 + PIN1) / 2 + 0.022, 0.022, 0.082, 0.085, { role: 'window', tint: ACCENT, pk: 'glow', whenNot: 'trailer', ...fine }),
  // The tail lamps: a bar on the port side, and an old round one on the starboard side.
  box('tail lamp', FRAME0 - 0.012, FRAME0 - 0.004, 0.016, 0.052, 0.070, { role: 'window', tint: RED, g: -W * 0.66 }),
  tubeF('round tail lamp', FRAME0 - 0.010, FRAME0 - 0.003, W * 0.66, 0.061, 0.0085, { role: 'window', tint: [214, 74, 52] }, 8),
  box('plate light', FRAME0 - 0.011, FRAME0 - 0.004, W * 0.30, 0.074, 0.080, { role: 'window', tint: [230, 210, 140], ...fine }),
  // Twin thrusters under the fifth wheel, nozzle aft. The starboard one is blanked with a plate.
  ...LR.map((s) => tubeF('thruster', FRAME0 - 0.008, FRAME0 + 0.030, s * 0.050, 0.044, 0.015, { role: 'gear', paint: 'exhaust', ...fine })),
  tubeF('thruster nozzle', FRAME0 - 0.010, FRAME0 - 0.007, -0.050, 0.044, 0.0115, { role: 'window', tint: [140, 160, 255], ...fine }),
  tubeF('thruster core', FRAME0 - 0.0115, FRAME0 - 0.0098, -0.050, 0.044, 0.0065, { role: 'window', tint: GLOW, ...fine }),
  box('thruster blank', FRAME0 - 0.0115, FRAME0 - 0.0080, 0.014, 0.030, 0.058, { paint: 'primer', g: 0.050, ...fine }),
];

// ── What a bobtail carries ── A stake bed on the bare deck with odd crates on it, chained down.
const BED0 = FRAME0 + 0.006, BED1 = CAB0 - 0.006, BED_Z = 0.082, BED_W = W * 0.80;
const STAKE_F = [BED0 + 0.004, 0.064, 0.118, BED1 - 0.004];
const cargoParts = [
  ...LR.flatMap((s) => STAKE_F.map((f) => box('bed stake', f - 0.003, f + 0.003, 0.003, 0.070, 0.112, { role: 'strut', g: s * (BED_W - 0.003) }))),
  ...LR.map((s) => box('bed rail', BED0, BED1, 0.003, 0.104, 0.110, { role: 'strut', g: s * (BED_W - 0.003), ...fine })),
  // A wooden crate, a green ammunition box with a small crate on it, and a drum stood on end.
  box('crate', 0.016, 0.074, 0.040, BED_Z, 0.130, { paint: 'crate', g: -0.044 }),
  ...[0.030, 0.060].map((f) => box('crate batten', f - 0.003, f + 0.003, 0.0405, BED_Z + 0.004, 0.126, { paint: 'crate', g: -0.044, ...fine })),
  box('ammo box', 0.086, 0.160, 0.052, BED_Z, 0.118, { paint: 'ammo', g: 0.018 }),
  box('ammo box lid', 0.084, 0.162, 0.054, 0.114, 0.120, { paint: 'ammo', g: 0.018, ...fine }),
  box('small crate', 0.100, 0.140, 0.026, 0.120, 0.146, { paint: 'crate', g: -0.002 }),
  puck('drum', 0.040, 0.058, 0.022, BED_Z, 0.136, { paint: 'drum' }, 10),
  puck('drum hoop', 0.040, 0.058, 0.0226, 0.108, 0.112, { role: 'strut', ...fine }, 10),
  // The chains: over each load and down to the bed's edges.
  ...[[0.046, 0.131, 0.084], [0.124, 0.147, 0.072], [0.040, 0.137, 0.022]].map(([f, h, w]) =>
    box('chain', f - 0.002, f + 0.002, w, h, h + 0.003, { role: 'strut', g: f === 0.040 ? 0.058 : f === 0.124 ? 0.006 : -0.020 })),
  ...LR.flatMap((s) => [0.046, 0.124].map((f) => box('chain drop', f - 0.0015, f + 0.0015, 0.0015, BED_Z, 0.128, { role: 'strut', g: s * (BED_W - 0.006), ...fine }))),
].map((p) => ({ ...p, whenNot: 'trailer' }));

// ── The spare pod on the roof ── A whole lifter, laid flat and strapped into a low cradle on the
// roof's back half, behind where the roof kit bolts. Its ring is dead. The cage's middle bar clears it.
const POD_F = 0.250, POD_G = 0, POD_R = 0.026;
const roofPod = [
  ...[POD_F - 0.022, POD_F + 0.022].map((f) => box('pod cradle', f - 0.003, f + 0.003, 0.040, ROOF, ROOF + 0.009, { role: 'strut' })),
  ...LR.map((s) => box('cradle rail', POD_F - 0.030, POD_F + 0.030, 0.003, ROOF, ROOF + 0.005, { role: 'strut', g: s * 0.037, ...fine })),
  puck('spare pod', POD_F, POD_G, POD_R, ROOF + 0.007, ROOF + 0.022, { role: 'gear', paint: 'gunmetal' }, 10),
  puck('spare pod ring', POD_F, POD_G, POD_R * 1.03, ROOF + 0.008, ROOF + 0.012, { role: 'strut', paint: 'rust', ...fine }, 12),
  ...[POD_F - 0.010, POD_F + 0.010].map((f) => box('pod strap', f - 0.003, f + 0.003, POD_R + 0.004, ROOF + 0.022, ROOF + 0.025, { paint: 'strap' })),
  ...LR.flatMap((s) => [POD_F - 0.010, POD_F + 0.010].map((f) => box('strap end', f - 0.003, f + 0.003, 0.0012, ROOF + 0.004, ROOF + 0.023, { paint: 'strap', g: s * (POD_R + 0.004), ...fine }))),
];

// ── Adornments ── What makes it a truck somebody kept running rather than one somebody bought.
const adorn = [
  // A carbon intake low on the nose with slats standing proud of it; one is missing and one is bent.
  box('nose intake', 0.4175, 0.4195, 0.074, 0.034, 0.050, { role: 'strut', paint: 'carbon' }),
  ...[-2, -1, 1, 2].map((i) => box('intake slat', 0.4195, 0.4210, 0.0022, 0.035, 0.049, { role: 'window', tint: CHROME, pk: 'bright', g: i * 0.029, ...fine })),
  sheet('bent slat', [[0.4210, 0.0065, 0.035], [0.4210, 0.0105, 0.035], [0.4225, -0.0045, 0.049], [0.4225, -0.0085, 0.049]], { role: 'window', tint: CHROME, pk: 'bright', sh: 0.8, ...fine }),
  // A carbon A-pillar along each side of the screen, proud of the flank.
  ...LR.map((s) => sheet('a-pillar', [
    [SCR0, s * (WS + 0.0008), BELT], [SCR0 - 0.014, s * (WS + 0.0008), BELT],
    [SCR1 - 0.012, s * (WT + 0.0008), ROOF - 0.002], [SCR1, s * (WT + 0.0008), ROOF - 0.002]], { role: 'strut', sh: 0.66, paint: 'carbon', ...fine })),
  // Half a red light line across the cab's back: the starboard half is dead. A hitched box hides it.
  box('tail light line', RBACK - 0.002, RBACK + 0.001, gAt(0.190) * 0.46, 0.186, 0.192, { role: 'window', tint: [214, 60, 48], g: -gAt(0.190) * 0.46, ...fine }),
  box('dead light line', RBACK - 0.002, RBACK + 0.001, gAt(0.190) * 0.46, 0.186, 0.192, { role: 'strut', paint: 'carbon', g: gAt(0.190) * 0.46, ...fine }),
  // A pad fairing a side, under the rocker; the port one is gone, so its bolts show.
  box('pad fairing', PADS[0][0] - 0.046, PADS[0][0] + 0.046, 0.008, 0.026, FLOOR + 0.004, { role: 'strut', paint: 'carbon', g: 0.128, ...fine }),
  ...[-0.030, 0, 0.030].map((d) => box('fairing bolt', PADS[0][0] + d - 0.002, PADS[0][0] + d + 0.002, 0.002, FLOOR, FLOOR + 0.003, { role: 'strut', g: -0.124, ...fine })),
  // A grab handle beside each door, for climbing into a cab-over.
  ...LR.map((s) => box('grab handle', DOOR_B - 0.010, DOOR_B - 0.006, 0.002, 0.118, 0.196, { role: 'window', tint: CHROME, pk: 'bright', g: s * (gAt(0.150) + 0.004), ...fine })),
  // A step under each door.
  ...LR.map((s) => box('step', 0.330, 0.372, 0.008, 0.030, 0.034, { role: 'strut', g: s * (W - 0.004), ...fine })),
];

// ── Fittings ── From scripts/shapes/truck-fittings.mjs, off this body's anchors. The stock Barrow's,
// moved where this body differs: the screen guards onto the raked screen, the mascot onto the nose
// ledge ahead of it, the roof kit forward of the spare pod (one roof fitting at a time, so they only
// have to clear the body), the stack kit onto the two stacks. The halos are this file's own, on the pads.
const SD = 0.010;
const BEACON_F = 0.290, MASCOT_F = 0.405;
const A = {
  ...vintageAnchors(ROW, []),
  scrW: 1,
  scrP: (t, gf) => [SCR0 + (SCR1 - SCR0) * t + SN[0] * SD, gf * scrHW(t), BELT + (ROOF - BELT) * t + SN[1] * SD],
  mascot: [MASCOT_F, bonnetAt(MASCOT_F)],
  roofZ: ROOF,
  lightBarF: SCR1 - 0.012, beaconF: BEACON_F, totemF: BEACON_F + 0.002, aerialF: BEACON_F + 0.004,
  // The cage and the parapet: front first, as vintageAnchors gives them. The cans stand ahead of the
  // front bar and the tarp aft of the back bar, so the pod lies between them under the middle bar.
  cage: [0.278, 0.220], parapet: [0.278, 0.220],
  stacks: LR.map((s) => s * STACK_G), stackF: STACK_F, stackTop: STACK_TOP,
};
// Six places are plenty in a file someone may read; the sums leave sixteen.
const tidy = (v, k) => (typeof v === 'number' ? (k === 'tint' ? v : r6(v)) : Array.isArray(v) ? v.map((x) => tidy(x, k))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, tidy(x, kk === 'tint' ? 'tint' : k)])) : v);
const kit = truckFittingParts(A).filter((p) => p.when !== 'fit_hl').map((p) => tidy(p));
// Lifter halos: a lit plate on each tractor pad.
const halos = padRows.map(([f, g, r]) => box('Lifter Halos', f - r - 0.004, f + r + 0.004, r + 0.004, PAD_Z1, PAD_Z1 + 0.003, { role: 'window', tint: ACCENT, pk: 'glow', g, when: 'fit_hl' }));

const tractor = [lower, cabin, ...glassSide, mullion, ...tape, ...trim, ...lamps, ...badge, ...stacks, ...mirrors, ...seams, ...rivets, ...handles,
  ...patches, ...numberParts, ...pads, ...chassis, ...roofPod, ...adorn, ...cargoParts];
const trailer = BASE.parts.find((p) => p.name === 'trailer');
const doc = {
  id: 'truck_scrapper_2076',
  kind: 'mesh',
  params: {
    name: 'Krell Barrow 2076',
    note: 'The Barrow after the Mule (docs/proposals/hover-rigs.md): the Courier 2076 cut down to a cab-over and worn. Written by scripts/shapes/concepts/barrow-2076.mjs from mesh_truck_scrapper.json; edit that, not this. '
      + 'Same channels as the stock file: trailer (+t), parked (~p), fit_<code> (^code).',
    // Surfaces (gl/solids.js `tex`). The body follows the booth's base colour and flash; the rest are
    // the panels and parts that came off other trucks, and stay what they are.
    paints: {
      body: { rgb: [138, 74, 42], livery: 'base', tex: 'paint', note: 'the body: the booth colour' },
      primer: { rgb: [118, 118, 110], livery: 'fixed', mat: 'matte', tex: 'paint', note: 'the roof, the starboard quarter, the nose top, the spare pad' },
      donor: { rgb: [226, 220, 206], livery: 'fixed', mat: 'pearl', tex: 'flake', note: 'the port door, off a Courier 2076' },
      carbon: { rgb: [30, 32, 36], livery: 'fixed', mat: 'satin', tex: 'carbon', note: 'rocker, intake, pillars, camera pod, dead lights' },
      gunmetal: { rgb: [58, 62, 70], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'the lift pads and the spare' },
      exhaust: { rgb: [92, 84, 76], livery: 'fixed', mat: 'exhaust', tex: 'brushed', note: 'the stacks and thrusters' },
      rust: { rgb: [112, 64, 40], livery: 'fixed', mat: 'matte', tex: 'cast', note: 'patch plates, heat shields, the mirror, dead lamps' },
      tape: { rgb: [170, 172, 166], livery: 'fixed', mat: 'satin', tex: 'fabric', note: 'tape' },
      stencil: { rgb: [228, 222, 204], livery: 'fixed', mat: 'matte', tex: 'paint', note: 'the fleet number' },
      strap: { rgb: [206, 122, 40], livery: 'fixed', mat: 'matte', tex: 'fabric', note: 'the spare pod\'s straps' },
      crate: { rgb: [128, 96, 60], livery: 'fixed', mat: 'matte', tex: 'wood', note: 'crates' },
      ammo: { rgb: [74, 88, 60], livery: 'fixed', mat: 'satin', tex: 'paint', note: 'the green box' },
      drum: { rgb: [46, 72, 112], livery: 'fixed', mat: 'satin', tex: 'paint', note: 'the drum' },
    },
    partIds: true,
    truck: { ...T, geom: { ...L, markF: MARK_F, markZ: MARK_Z }, beacon: [BEACON_F, ROOF + 0.034],
      pods: [...padRows, ...T.pods.filter((q) => q[3])] },
    parts: [
      { kind: 'group', name: 'tractor', parts: tractor },
      { kind: 'group', name: 'fittings', parts: [...kit, ...halos] },
      trailer,
    ],
  },
};
const v = validateMesh(doc.params, doc.id);
if (v.errors.length) { console.log('ERRORS', v.errors.slice(0, 12)); process.exit(1); }
writeFileSync(new URL('../../../content/vehicle_models/mesh_truck_scrapper_2076.json', import.meta.url), formatMesh(doc));
// The stock file names its edition.
if (BASE.variants?.['2076'] !== 'truck_scrapper_2076') {
  BASE_DOC.params = { ...BASE, variants: { ...(BASE.variants || {}), 2076: 'truck_scrapper_2076' } };
  writeFileSync(BASE_URL, formatMesh(BASE_DOC));
}
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
console.log('mesh_truck_scrapper_2076.json:', n1, 'faces near,', n0, 'far (every state)');
