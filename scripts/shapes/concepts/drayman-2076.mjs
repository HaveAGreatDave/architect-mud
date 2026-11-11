// The Vachon Drayman 2076: writes content/vehicle_models/mesh_truck_drayman_2076.json, and names it
// as the 2076 edition in mesh_truck_drayman.json's `variants`.
//
//   node scripts/shapes/concepts/drayman-2076.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:truck/drayman~e2076, or any variant with ~e2076 after +t
//
// The Drayman fifty years on, after the Strand in the Hover Rig Expo concept (docs/proposals/
// hover-rigs.md): a dark, smooth cab-over with a lit visor band over a real windscreen, sensor domes
// on the roof, two masts with lit tips at the cab's back corners, its unit number on the sleeper, LED
// bars for lamps, a sensor face on the nose, and three lift pads a side tucked under the floor.
//
// ⚠ THIS STARTS FROM mesh_truck_drayman.json AND KEEPS ITS FRAME. The cab stays between cab0 and the
// nose and under the old roof line, so the fittings still bolt where they did, and nothing taller than
// the trailer's floor goes aft of cab0, which is the box's swing. The sleeper is inside the cab now,
// not behind it. The chassis, the fifth wheel, the tail lamps and the lamp stations are the old
// Drayman's numbers, and the trailer is the old trailer. What the gate holds (scripts/shapes/
// meshes.mjs): the same pin, cab back and box nose as the stock file, and a truck that builds in every
// state.
//
// The fittings come from scripts/shapes/truck-fittings.mjs, off this body's anchors: the stock
// Drayman's, with the screen, mascot, roof and roof kit moved where this body puts them. The stack
// fittings go on the masts, which stand where the stacks stood. The lifter halos are drawn here.
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
// The stock Drayman's proportion row: the fittings' anchors start from it.
const ROW = TRUCK_ROWS.drayman;

const BASE_URL = new URL('../../../content/vehicle_models/mesh_truck_drayman.json', import.meta.url);
const BASE_DOC = JSON.parse(readFileSync(BASE_URL, 'utf8'));
const BASE = BASE_DOC.params;
const T = BASE.truck, L = T.geom;
const W = T.w;
const CAB0 = L.cab0, FRAME0 = L.frame0;
const [PIN0, PIN1] = T.pin;

// ── Colours ──
const TEAL = [96, 214, 206];             // pk 'bright': the booth's trim colour (teal on the factory paint)
const GLOW = [70, 226, 214];             // pk 'glow': the visor and the running lines
const WASH = [128, 226, 255];            // the lifter emitters, as the road wash
const GLASS = [44, 66, 86];
const RED = [196, 66, 54];
const AMBER = [236, 176, 96];
const LED = [236, 244, 250];
const SENSOR = [14, 20, 28];
const UV_FULL = [[0, 1], [1, 1], [1, 0], [0, 0]];

// ── Primitives ── The Courier 2076's, unchanged (concepts/courier-2076.mjs).
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
// `o.face(i)` may override a face's role, tint, pk, uv and art.
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
const ngon = (n, fn) => Array.from({ length: n }, (_, k) => fn(Math.cos((k + 0.5) / n * Math.PI * 2), Math.sin((k + 0.5) / n * Math.PI * 2)));
const puck = (name, f, g, r, z0, z1, o = {}, n = 10) =>
  loft(name, [z0, z1].map((z) => ngon(n, (c, s) => [f + c * r, g + s * r, z])), o);
// A dome: rings shrinking up a quarter circle, closed by a small cap.
const dome = (name, f, g, r, z0, rise, o = {}, n = 12) =>
  loft(name, [0, 0.45, 0.78, 0.96].map((t) => { const a = t * Math.PI / 2, rr = r * Math.max(0.18, Math.cos(a)), z = z0 + rise * Math.sin(a);
    return ngon(n, (c, s) => [f + c * rr, g + s * rr, z]); }), o);
const box = (name, f0, f1, w, z0, z1, o = {}) => {
  const b = { kind: 'box', name, f: [r6(Math.min(f0, f1)), r6(Math.max(f0, f1))], w: r6(w), z: [r6(z0), r6(z1)] };
  if (o.g) b.g = r6(o.g);
  if (o.role && o.role !== 'body') b.role = o.role;
  if (o.tint) { b.tint = o.tint; if (o.pk) b.pk = o.pk; }
  if (o.paint) b.paint = o.paint;
  return { ...b, ...tags(o) };
};
const sheet = (name, pts, o = {}) => {
  const f = { role: o.role || 'body', sh: o.sh ?? 0.9, p: pts.map((v) => P(v[0], v[1], v[2])) };
  if (o.tint) { f.tint = o.tint; if (o.pk) f.pk = o.pk; }
  return { kind: 'poly', name, faces: [f], ...tags(o) };
};
const LR = [-1, 1];
const fine = { minDetail: 1 };

// ── The cab ── A cab-over in two convex solids meeting at the waist (h BELT): a lower body from the
// cab back to a flat nose, and the cabin above it, lofted up through four rings whose fronts are the
// screen, the visor band and the roof's front edge. A small cowl is left between the screen's foot and
// the nose, which is where a mascot stands.
const FLOOR = 0.030, CHAMF = 0.046, BELT = 0.150;
const BAND = 0.120;                                        // the flank's cut, for the booth's flashes
const NOSE_F = 0.416;                                      // the nose plate
const SEC = (f, top, w, wb, z0 = FLOOR) => { const b = Math.min(BAND, top - 0.004);
  return [[f, -wb, z0], [f, wb, z0], [f, w, CHAMF], [f, w, b], [f, w, top], [f, -w, top], [f, -w, b], [f, -w, CHAMF]]; };
const STATIONS = [[CAB0, BELT, W, 0.130], [0.150, BELT, W, 0.130], [0.200, BELT, W, 0.130], [0.250, BELT, W, 0.130],
  [0.300, BELT, W, 0.130], [0.350, BELT, W, 0.130], [0.400, BELT, W, 0.130], [0.410, 0.148, W - 0.004, 0.126], [NOSE_F, 0.144, W - 0.016, 0.116, 0.036]];
// The chamfers along the bottom are the carbon rocker, so the body sits on something.
const lower = loft('lower body', STATIONS.map(([f, top, w, wb, z0]) => SEC(f, top, w, wb, z0)),
  { paint: 'navy', face: (i) => (i < (STATIONS.length - 1) * 8 && (i % 8 === 1 || i % 8 === 7) ? { role: 'strut', paint: 'carbon' } : null) });

// The cabin's rings: [h, front f, back f, half-width]. The screen leans back about 18 degrees.
const C = 0.010;                                           // the corner chamfer, all the way up
const SCR0 = 0.400, RAKE = 0.33, SCR_TOP = 0.262, VIS_TOP = 0.284, ROOF = 0.300;
const scrF = (h) => SCR0 - (h - BELT) * RAKE;              // the screen's front at a height
const RINGS = [[BELT, SCR0, CAB0, W], [SCR_TOP, scrF(SCR_TOP), CAB0, W], [VIS_TOP, scrF(VIS_TOP), CAB0, W - 0.006], [ROOF, 0.340, CAB0 + 0.014, W - 0.024]];
const ring = ([h, ff, fb, gw]) => [[ff, -(gw - C), h], [ff, gw - C, h], [ff - C, gw, h], [fb + C, gw, h], [fb, gw - C, h], [fb, -(gw - C), h], [fb + C, -gw, h], [ff - C, -gw, h]];
// Face i*8+k: k 0 the front, 1 and 7 the front corners, 2 and 6 the flanks, 3 to 5 the back.
const cabin = loft('cabin', RINGS.map(ring), { paint: 'navy', face: (i) => {
  const seg = i >> 3, k = i & 7;
  if (i >= 24) return null;                                 // floor and roof
  if (seg === 0 && k === 0) return { role: 'glass', tint: GLASS, uv: UV_FULL, paint: 'none' };   // the screen
  if (seg === 0 && (k === 1 || k === 7)) return { role: 'strut', paint: 'carbon' };            // the A-pillars
  if (seg === 1 && (k === 0 || k === 1 || k === 7)) return { role: 'window', tint: GLOW, pk: 'glow', paint: 'none' };   // the visor band
  return null;
} });
const FLANK_TOP = SCR_TOP;                                 // the flank is upright from the waist to here

// Side glass: the door glass behind the A-pillar, raked at the front to follow the screen, a hair proud.
function pane(name, s, fA, h0, h1) {
  const fB = (h) => scrF(h) - C - 0.008;
  const ringAt = (d) => [[fA, s * (W + d), h0], [fB(h0), s * (W + d), h0], [fB(h1), s * (W + d), h1], [fA, s * (W + d), h1]];
  return loft(name, [ringAt(0.0006), ringAt(0.0034)], { role: 'glass', tint: [26, 38, 52], ...fine });
}
const GL0 = 0.168, GL1 = 0.250, GL_F = 0.292;
const glassSide = LR.flatMap((s) => [
  pane('door glass', s, GL_F, GL0, GL1),
  // The frame round it: a sill and a header, and the post behind it.
  box('glass sill', GL_F - 0.004, scrF(GL0) - C - 0.004, 0.0018, GL0 - 0.004, GL0, { role: 'strut', paint: 'carbon', g: s * (W + 0.0012), ...fine }),
  box('glass header', GL_F - 0.004, scrF(GL1) - C - 0.006, 0.0018, GL1, GL1 + 0.004, { role: 'strut', paint: 'carbon', g: s * (W + 0.0012), ...fine }),
  box('b-post', GL_F - 0.006, GL_F, 0.0018, GL0 - 0.004, GL1 + 0.004, { role: 'strut', paint: 'carbon', g: s * (W + 0.0012), ...fine }),
]);

// The waist stripe in the booth's bright, the rocker line in the glow, and the visor's lit edges.
const trim = [
  ...LR.map((s) => box('waist stripe', CAB0 + 0.006, 0.404, 0.0025, BELT - 0.010, BELT - 0.004, { role: 'window', tint: TEAL, pk: 'bright', g: s * (W + 0.0005) })),
  box('rocker light', CAB0 + 0.010, 0.404, W + 0.001, 0.040, 0.044, { role: 'window', tint: GLOW, pk: 'glow', ...fine }),
  // The visor carried back along each flank as a thin line, to the sleeper seam.
  ...LR.map((s) => box('visor line', CAB0 + 0.040, scrF(SCR_TOP + 0.010) - C, 0.0016, SCR_TOP + 0.006, SCR_TOP + 0.010, { role: 'window', tint: GLOW, pk: 'glow', g: s * (W + 0.0004), ...fine })),
  // A dark line between the screen and the visor, so the band reads as its own strip.
  box('visor rim', scrF(SCR_TOP) - 0.004, scrF(SCR_TOP) + 0.002, W - C - 0.002, SCR_TOP - 0.003, SCR_TOP + 0.001, { role: 'strut', paint: 'carbon', ...fine }),
  // The roof's front edge, and the marker lamps along it (truck.geom.markF/markZ).
  box('roof edge line', 0.330, 0.338, W - 0.030, ROOF - 0.002, ROOF + 0.001, { role: 'window', tint: GLOW, pk: 'glow', ...fine }),
  ...[-2, -1, 0, 1, 2].map((i) => box('marker lamp', 0.332, 0.340, 0.008, ROOF + 0.001, ROOF + 0.006, { role: 'window', tint: AMBER, g: i * W * 0.34, ...fine })),
];
const MARK_F = 0.336, MARK_Z = ROOF + 0.0035;

// The nose: an LED bar a side at the lamp stations, a dark sensor face between them with a lit line
// under it, a radar puck, and a carbon bumper with a lit lip.
const nose = [
  ...LR.flatMap((s) => [
    box('headlamp', NOSE_F - 0.002, NOSE_F + 0.004, 0.022, L.lampMidZ - 0.006, L.lampMidZ + 0.006, { role: 'window', tint: LED, g: s * L.lampG }),
    box('lamp line', NOSE_F - 0.001, NOSE_F + 0.003, 0.020, L.lampMidZ + 0.010, L.lampMidZ + 0.013, { role: 'window', tint: GLOW, pk: 'glow', g: s * (L.lampG - 0.002), ...fine }),
  ]),
  box('sensor face', NOSE_F - 0.001, NOSE_F + 0.0015, 0.098, 0.102, 0.136, { role: 'glass', tint: SENSOR }),
  box('sensor line', NOSE_F - 0.001, NOSE_F + 0.002, 0.096, 0.097, 0.100, { role: 'window', tint: GLOW, pk: 'glow', ...fine }),
  ...[-1, 0, 1].map((i) => box('sensor slat', NOSE_F + 0.0015, NOSE_F + 0.0025, 0.090, 0.110 + i * 0.008, 0.1115 + i * 0.008, { role: 'strut', paint: 'carbon', ...fine })),
  box('radar', NOSE_F - 0.002, NOSE_F + 0.004, 0.022, 0.064, 0.080, { role: 'strut', paint: 'carbon' }),
  box('radar lens', NOSE_F + 0.004, NOSE_F + 0.005, 0.016, 0.067, 0.077, { role: 'glass', tint: SENSOR, ...fine }),
  box('bumper', 0.402, NOSE_F + 0.006, W - 0.012, 0.030, 0.052, { role: 'strut', paint: 'carbon' }),
  box('bumper lip', NOSE_F + 0.006, NOSE_F + 0.008, W - 0.030, 0.046, 0.049, { role: 'window', tint: GLOW, pk: 'glow', ...fine }),
];

// ── The masts ── Where the stacks stood (the stack fittings wrap them): tapering posts up the cab's
// back corners and clear of the roof, each with a lit band and a red tip. Nothing goes aft of
// cab0 - 0.009, inside the swing's allowance for a stack.
const MAST_G = ROW.w * 0.94, MAST_Z0 = 0.090, MAST_TOP = 0.360;
const masts = LR.flatMap((s) => {
  const sq = (h, r) => [[CAB0 - r, s * MAST_G - r, h], [CAB0 + r, s * MAST_G - r, h], [CAB0 + r, s * MAST_G + r, h], [CAB0 - r, s * MAST_G + r, h]];
  return [
    loft('mast', [sq(MAST_Z0, 0.008), sq(ROOF, 0.0065), sq(MAST_TOP, 0.0045)], { role: 'strut', paint: 'titanium' }),
    box('mast band', CAB0 - 0.006, CAB0 + 0.006, 0.006, 0.322, 0.327, { role: 'window', tint: GLOW, pk: 'glow', g: s * MAST_G, ...fine }),
    box('mast tip', CAB0 - 0.004, CAB0 + 0.004, 0.004, MAST_TOP, MAST_TOP + 0.008, { role: 'window', tint: [236, 70, 58], g: s * MAST_G }),
  ];
});

// ── The roof's sensors ── A lidar dome on the centreline, a smaller dome either side of the front.
const roofKit = [
  puck('lidar base', 0.282, 0, 0.020, ROOF - 0.002, ROOF + 0.006, { role: 'strut', paint: 'carbon' }, 12),
  puck('lidar band', 0.282, 0, 0.0185, ROOF + 0.006, ROOF + 0.012, { role: 'glass', tint: SENSOR }, 12),
  dome('lidar dome', 0.282, 0, 0.017, ROOF + 0.012, 0.010, { role: 'glass', tint: [40, 58, 76] }),
  puck('lidar ring', 0.282, 0, 0.0188, ROOF + 0.0115, ROOF + 0.0128, { role: 'window', tint: GLOW, pk: 'glow', ...fine }, 12),
  ...LR.flatMap((s) => [
    puck('sensor base', 0.316, s * 0.100, 0.010, ROOF - 0.002, ROOF + 0.004, { role: 'strut', paint: 'carbon' }, 10),
    dome('sensor dome', 0.316, s * 0.100, 0.0085, ROOF + 0.004, 0.008, { role: 'glass', tint: [200, 210, 218] }, 10),
  ]),
];

// ── The flanks ── Camera pods for mirrors on the door's front edge, door shut lines either side of the
// door art panel (drawTruckDoorArt: cab1-0.104 to cab1-0.052), a flush handle, a step, the unit number.
const CAM_F = 0.358;
const flanks = LR.flatMap((s) => [
  box('camera arm', CAM_F - 0.004, CAM_F + 0.004, 0.006, 0.234, 0.238, { role: 'strut', g: s * (W + 0.006), ...fine }),
  loft('camera pod', [CAM_F - 0.012, CAM_F + 0.012].map((f) => [[f, s * (W + 0.012), 0.228], [f, s * (W + 0.024), 0.228], [f, s * (W + 0.024), 0.244], [f, s * (W + 0.012), 0.244]]), { role: 'strut', paint: 'carbon' }),
  box('camera lens', CAM_F - 0.0135, CAM_F - 0.011, 0.004, 0.232, 0.240, { role: 'glass', tint: SENSOR, g: s * (W + 0.018), ...fine }),
  box('door shut line', 0.2845, 0.2875, 0.0015, CHAMF, FLANK_TOP - 0.006, { role: 'strut', g: s * (W + 0.0005), ...fine }),
  box('door shut line', 0.3945, 0.3975, 0.0015, CHAMF, BELT - 0.012, { role: 'strut', g: s * (W + 0.0005), ...fine }),
  box('sleeper seam', CAB0 + 0.0395, CAB0 + 0.0425, 0.0015, CHAMF, FLANK_TOP - 0.006, { role: 'strut', g: s * (W + 0.0005), ...fine }),
  box('door handle', 0.300, 0.318, 0.0012, 0.128, 0.132, { role: 'window', tint: GLOW, pk: 'glow', g: s * (W + 0.0004), ...fine }),
  box('step', 0.300, 0.360, 0.010, 0.030, 0.038, { role: 'strut', paint: 'carbon', g: s * (W - 0.012) }),
  box('step light', 0.304, 0.356, 0.0012, 0.031, 0.034, { role: 'window', tint: AMBER, g: s * (W - 0.0015), ...fine }),
]);

// The unit number, UNIT 12, in strokes on the sleeper flank under the glass line. It runs tail-ward on
// the left flank and nose-ward on the right, so it reads forwards from either side (checked in the
// Modelshop: the other way round is mirror writing on both).
const CW = 0.014, CH = 0.022, ST = 0.0028, GAP = 0.0055, SPACE = 0.007;
const V = (x, y0, y1) => [x, y0, x + ST, y1];
const H = (x0, y, x1) => [x0, y, x1, y + ST];
const GLYPHS = {
  U: { r: [V(0, 0, CH), V(CW - ST, 0, CH), H(0, 0, CW)] },
  N: { r: [V(0, 0, CH), V(CW - ST, 0, CH)], d: [[ST, CH], [ST + 0.0042, CH], [CW - ST, 0], [CW - ST - 0.0042, 0]] },
  I: { r: [V(CW / 2 - ST / 2, 0, CH), H(CW * 0.18, CH - ST, CW * 0.82), H(CW * 0.18, 0, CW * 0.82)] },
  T: { r: [H(0, CH - ST, CW), V(CW / 2 - ST / 2, 0, CH - ST)] },
  1: { r: [V(CW / 2 - ST / 2, 0, CH), H(CW * 0.22, 0, CW * 0.78), H(CW * 0.22, CH - ST, CW / 2)] },
  2: { r: [H(0, CH - ST, CW), V(CW - ST, CH / 2, CH), H(0, CH / 2 - ST / 2, CW), V(0, 0, CH / 2), H(0, 0, CW)] },
};
const TEXT = 'UNIT 12', TEXT_F0 = 0.128, TEXT_H0 = 0.196;
const textW = [...TEXT].reduce((a, ch, i) => a + (ch === ' ' ? SPACE : CW) + (i < TEXT.length - 1 ? GAP : 0), 0);
const lettering = LR.flatMap((s) => {
  const out = [];
  const fOf = (x) => (s > 0 ? TEXT_F0 + x : TEXT_F0 + textW - x);
  let x = 0;
  for (const ch of TEXT) {
    if (ch === ' ') { x += SPACE + GAP; continue; }
    const gl = GLYPHS[ch];
    for (const [x0, y0, x1, y1] of gl.r) out.push(box('unit number', fOf(x + x0), fOf(x + x1), 0.0006, TEXT_H0 + y0, TEXT_H0 + y1,
      { role: 'window', tint: TEAL, pk: 'bright', g: s * (W + 0.0008), ...fine }));
    if (gl.d) out.push(sheet('unit number', gl.d.map(([dx, dy]) => [fOf(x + dx), s * (W + 0.0012), TEXT_H0 + dy]), { role: 'window', tint: TEAL, pk: 'bright', sh: 0.7, ...fine }));
    x += CW + GAP;
  }
  // A thin rule under it, the length of the number.
  out.push(box('unit rule', TEXT_F0, TEXT_F0 + textW, 0.0006, TEXT_H0 - 0.007, TEXT_H0 - 0.005, { role: 'window', tint: TEAL, pk: 'bright', g: s * (W + 0.0008), ...fine }));
  return out;
});

// ── The lift pads ── Three a side under the floor: a puck, a lit emitter ring (out when parked), a
// trim band, and an arm up into the frame for the aft one. truck.pods gets one row each.
const PAD_R = 0.040, PAD_G = 0.122, PAD_Z0 = 0.016, PAD_Z1 = 0.034;
const PADS = [0.360, 0.200, -0.030];
const pads = [], padRows = [];
for (const s of LR) for (const f of PADS) {
  const g = s * PAD_G;
  padRows.push([f, g, PAD_R, false, 0.024]);
  pads.push(puck('lift pad', f, g, PAD_R * 0.92, PAD_Z0 + 0.004, PAD_Z1, { role: 'gear', paint: 'gunmetal' }));
  pads.push(puck('emitter ring', f, g, PAD_R, PAD_Z0, PAD_Z0 + 0.006, { role: 'window', tint: WASH, whenNot: 'parked', ...fine }, 12));
  pads.push(puck('pad trim', f, g, PAD_R * 0.95, PAD_Z1 - 0.004, PAD_Z1 - 0.001, { role: 'window', tint: TEAL, pk: 'bright', ...fine }, 12));
  if (f < CAB0) pads.push(box('pad arm', f - 0.010, f + 0.010, 0.008, PAD_Z1, 0.050, { role: 'strut', g: g * 0.85 }));
}
// The pads' fairings: a shallow carbon skirt either side of the two under the cab.
const fairings = LR.flatMap((s) => [PADS[0], PADS[1]].map((f) => box('pad fairing', f - 0.050, f + 0.050, 0.008, 0.026, FLOOR + 0.004, { role: 'strut', paint: 'carbon', g: s * 0.150, ...fine })));

// ── The chassis ── The old Drayman's numbers: rails, deck plate, fifth wheel (the pin), tail lamps. A
// skirt hides the frame between the cab and the fifth wheel, kept under the trailer's floor.
const chassis = [
  ...LR.map((s) => box('frame rail', FRAME0 - 0.01, 0.320, 0.016, 0.028, 0.072, { role: 'strut', g: s * W * 0.62 })),
  box('deck plate', FRAME0, CAB0 + 0.02, W * 0.80, 0.050, 0.070),
  box('fifth wheel', PIN0, PIN1, W * 0.62, 0.070, 0.082, { role: 'strut' }),
  box('coupling ring', (PIN0 + PIN1) / 2 - 0.022, (PIN0 + PIN1) / 2 + 0.022, 0.022, 0.082, 0.085, { role: 'window', tint: GLOW, pk: 'glow', whenNot: 'trailer', ...fine }),
  ...LR.flatMap((s) => [
    box('chassis skirt', 0.042, CAB0 + 0.004, 0.006, 0.030, 0.076, { paint: 'navy', g: s * (W - 0.006) }),
    box('skirt line', 0.044, CAB0 + 0.002, 0.0012, 0.040, 0.044, { role: 'window', tint: GLOW, pk: 'glow', g: s * (W - 0.0004), ...fine }),
    box('tail lamp', FRAME0 - 0.012, FRAME0 - 0.004, 0.016, 0.052, 0.070, { role: 'window', tint: RED, g: s * W * 0.66 }),
  ]),
  box('plate light', FRAME0 - 0.011, FRAME0 - 0.004, W * 0.30, 0.074, 0.080, { role: 'window', tint: [230, 210, 140], ...fine }),
  // A sensor bar across the frame's tail, under the trailer floor.
  box('rear sensor', FRAME0 - 0.010, FRAME0 - 0.003, W * 0.24, 0.056, 0.068, { role: 'glass', tint: SENSOR }),
  box('rear sensor line', FRAME0 - 0.0105, FRAME0 - 0.009, W * 0.22, 0.061, 0.063, { role: 'window', tint: GLOW, pk: 'glow', ...fine }),
];

// ── The cab's back ── A red light line across it (a hitched box hides it, a bobtail shows it), and a
// lit line down the back of each mast's corner.
const back = [
  box('tail light line', CAB0 - 0.002, CAB0 + 0.001, W - C - 0.012, 0.236, 0.242, { role: 'window', tint: [214, 60, 48], ...fine }),
  box('back panel seam', CAB0 - 0.0015, CAB0 + 0.001, W - C - 0.012, 0.160, 0.162, { role: 'strut', ...fine }),
];

// ── What a bobtail carries ── A sealed pod on the bare deck, a short cousin of the Strand's train of
// them, with a lit line along it and a dark band where it would couple.
const POD_SEC = (f, w, z1) => [[f, -w * 0.86, 0.072], [f, w * 0.86, 0.072], [f, w, 0.084], [f, w, z1 - 0.014], [f, w * 0.80, z1], [f, -w * 0.80, z1], [f, -w, z1 - 0.014], [f, -w, 0.084]];
const cargo = [
  loft('cargo pod', [POD_SEC(-0.090, 0.074, 0.130), POD_SEC(-0.074, 0.104, 0.150), POD_SEC(0.062, 0.104, 0.150), POD_SEC(0.078, 0.086, 0.138)], { paint: 'navy', whenNot: 'trailer' }),
  box('pod line', -0.070, 0.058, 0.1055, 0.118, 0.122, { role: 'window', tint: GLOW, pk: 'glow', whenNot: 'trailer', ...fine }),
  box('pod band', -0.010, 0.000, 0.1056, 0.086, 0.148, { role: 'strut', paint: 'carbon', whenNot: 'trailer', ...fine }),
];

// ── Fittings ── From scripts/shapes/truck-fittings.mjs, off this body's anchors. The stock Drayman's,
// moved where this body differs: the screen guards onto the raked screen, the mascot onto the cowl,
// the roof kit onto the lower roof and clear of the lidar, the stack kit onto the masts. The halos
// are this file's own, on the pads.
const SN = (() => { const df = scrF(SCR_TOP) - SCR0, dh = SCR_TOP - BELT, l = Math.hypot(df, dh); return [dh / l, -df / l]; })();
const SD = 0.010;
const BEACON_F = 0.200;
const A = {
  ...vintageAnchors(ROW, []),
  roofZ: ROOF,
  scrW: 1,
  scrP: (t, gf) => [SCR0 + (scrF(SCR_TOP) - SCR0) * t + SN[0] * SD, gf * (W - C), BELT + (SCR_TOP - BELT) * t + SN[1] * SD],
  mascot: [0.409, BELT],
  lightBarF: 0.236, beaconF: BEACON_F, totemF: 0.205, aerialF: 0.190,
  cage: [0.250, 0.150], parapet: [0.250, 0.150],
  stackTop: MAST_TOP + 0.008,
};
const tidy = (v, k) => (typeof v === 'number' ? (k === 'tint' ? v : r6(v)) : Array.isArray(v) ? v.map((x) => tidy(x, k))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, tidy(x, kk === 'tint' ? 'tint' : k)])) : v);
const kit = truckFittingParts(A).filter((p) => p.when !== 'fit_hl').map((p) => tidy(p));
const halos = padRows.map(([f, g]) => box('Lifter Halos', f - PAD_R - 0.004, f + PAD_R + 0.004, PAD_R + 0.004, PAD_Z1, PAD_Z1 + 0.003, { role: 'window', tint: GLOW, pk: 'glow', g, when: 'fit_hl' }));

const tractor = [lower, cabin, ...glassSide, ...trim, ...nose, ...masts, ...roofKit, ...flanks, ...lettering, ...pads, ...fairings, ...chassis, ...back, ...cargo];
const trailer = BASE.parts.find((p) => p.name === 'trailer');
const doc = {
  id: 'truck_drayman_2076',
  kind: 'mesh',
  params: {
    name: 'Vachon Drayman 2076',
    note: 'The Drayman after the Strand (docs/proposals/hover-rigs.md). Written by scripts/shapes/concepts/drayman-2076.mjs from mesh_truck_drayman.json; edit that, not this. '
      + 'Same channels as the stock file: trailer (+t), parked (~p), fit_<code> (^code).',
    // Surfaces (gl/solids.js `tex`). Navy follows the booth's base colour and flash; the rest are fixed.
    paints: {
      navy: { rgb: [27, 42, 68], livery: 'base', tex: 'paint', note: 'the body: the booth colour, smooth' },
      carbon: { rgb: [24, 27, 32], livery: 'fixed', mat: 'satin', tex: 'carbon', note: 'rocker, pillars, bumper, sensor housings, glass frames' },
      titanium: { rgb: [150, 156, 166], livery: 'fixed', mat: 'bare', tex: 'brushed', note: 'the masts' },
      gunmetal: { rgb: [52, 58, 68], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'the lift pads' },
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
writeFileSync(new URL('../../../content/vehicle_models/mesh_truck_drayman_2076.json', import.meta.url), formatMesh(doc));
// The stock file names its edition.
if (BASE.variants?.['2076'] !== 'truck_drayman_2076') {
  BASE_DOC.params = { ...BASE, variants: { ...(BASE.variants || {}), 2076: 'truck_drayman_2076' } };
  writeFileSync(BASE_URL, formatMesh(BASE_DOC));
}
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
console.log('mesh_truck_drayman_2076.json:', n1, 'faces near,', n0, 'far (every state)');
