// The Ostrek Courier 2076: writes content/vehicle_models/mesh_truck_hauler_2076.json, and names it as
// the 2076 edition in mesh_truck_hauler.json's `variants`.
//
//   node scripts/shapes/concepts/courier-2076.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:truck/hauler~e2076, or any variant with ~e2076 after +t
//
// The Courier fifty years after the chrome one, after the Aria GT in the Hover Rig Expo concept
// (docs/proposals/hover-rigs.md): a pearl lower body under a swept glass cabin with a trim band at the
// waist, tail fins over the deck, a winged badge on the nose, LED bars for lamps, a light line at the
// rocker, three lift pads a side tucked under the floor, and twin thrusters at the back of the frame.
// The bobtail carries a streamlined pod on its deck where the old one carried a strapped rack.
//
// ⚠ THIS STARTS FROM mesh_truck_hauler.json AND KEEPS ITS FRAME. The cab stays inside the old cab's
// box (cab0 to the nose, the old roof height and width), so the fittings still bolt where they did,
// and nothing goes aft of cab0, which is the trailer's swing clearance. The chassis, the fifth wheel,
// the tail lamps and the lamp stations are the old Courier's numbers. The trailer is the old trailer.
// What the gate holds (scripts/shapes/meshes.mjs): the same pin, cab back and box nose as the stock
// file, and a truck that builds in every state.
//
// The fittings come from scripts/shapes/truck-fittings.mjs, off this body's anchors: the stock
// Courier's, with the screen, mascot, roof kit and stack top moved where this body puts them. The
// lifter halos are drawn here, on the new pads.
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
// The stock Courier's proportion row: the fittings' anchors start from it.
const ROW = TRUCK_ROWS.hauler;

const BASE_URL = new URL('../../../content/vehicle_models/mesh_truck_hauler.json', import.meta.url);
const BASE_DOC = JSON.parse(readFileSync(BASE_URL, 'utf8'));
const BASE = BASE_DOC.params;
const T = BASE.truck, L = T.geom;
const W = T.w, HI = T.hi;
const CAB0 = L.cab0, CAB1 = L.cab1, NOSE1 = L.nose1, FRAME0 = L.frame0;
const [PIN0, PIN1] = T.pin;

// ── Colours ──
// pk 'bright': the booth's brightwork, drawn as chrome (vehicle-materials.js metalKOf). The gold is not
// brightwork: chrome is a mirror tinted by its colour, and gold over a blue sky came out olive, so the
// pinstripes, fin edges, waist band and badge are the `gilt` slot, painted the booth's trim colour.
const CHROME = [226, 232, 240];
const ACCENT = [96, 196, 214];           // pk 'glow': the running light
const GLOW = [128, 226, 255];            // the lifter emitters, as the road wash
const GLASS = [58, 84, 104];
const RED = [196, 66, 54];
const AMBER = [236, 176, 96];
const LED = [242, 236, 206];
const UV_FULL = [[0, 1], [1, 1], [1, 0], [0, 0]];

// ── Primitives ──
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
// A single two-sided sheet (no `cen`), as the old builder's polys were.
const sheet = (name, pts, o = {}) => {
  const f = { role: o.role || 'body', sh: o.sh ?? 0.9, p: pts.map((v) => P(v[0], v[1], v[2])) };
  if (o.tint) { f.tint = o.tint; if (o.pk) f.pk = o.pk; }
  if (o.paint) f.paint = o.paint;
  return { kind: 'poly', name, faces: [f], ...tags(o) };
};
const LR = [-1, 1];
const fine = { minDetail: 1 };

// ── The cab ── Two convex solids meeting at the waist (h BELT): a lower body nose to cab back, and a
// glass cabin with a raked screen. The waist is where a fitting expects the old bonnet top.
const FLOOR = 0.030, CHAMF = 0.046, BELT = 0.128;
// The booth's flashes test each face's centre (faceWearsTrim), so the flank is cut in two at BAND and
// sliced along its length: one face per side would take a stripe whole or not at all.
const BAND = 0.109;
const SEC = (f, top, w, wb) => { const b = Math.min(BAND, top - 0.004); return [[f, -wb, FLOOR], [f, wb, FLOOR], [f, w, CHAMF], [f, w, b], [f, w, top], [f, -w, top], [f, -w, b], [f, -w, CHAMF]]; };
// The waist runs flat to the screen's foot, then the nose drops away, steeper at every station.
const NOSE = [[0.180, BELT, W, 0.130], [0.240, BELT, W, 0.130], [0.300, BELT, W, 0.130], [0.350, BELT, W, 0.130], [0.384, BELT, W, 0.130],
  [0.404, 0.112, W, 0.130], [0.414, 0.100, 0.146, 0.124], [0.418, 0.090, 0.136, 0.108]];
// The chamfers along the bottom (edges 1 and 7 of each section) are the carbon rocker, so the pearl
// sits on something; the rest is pearl.
const lower = loft('lower body', [SEC(CAB0, BELT, W, 0.130), ...NOSE.map(([f, top, w, wb]) => SEC(f, top, w, wb))],
  { paint: 'pearl', face: (i) => (i < NOSE.length * 8 && (i % 8 === 1 || i % 8 === 7) ? { role: 'strut', paint: 'carbon' } : null) });
// The bonnet's height at f, for what sits on it.
const bonnetAt = (f) => {
  for (let i = 0; i < NOSE.length - 1; i++) {
    const [fa, ha] = NOSE[i], [fb, hb] = NOSE[i + 1];
    if (f >= fa && f <= fb) return ha + (hb - ha) * (f - fa) / (fb - fa);
  }
  return BELT;
};
const SILL = 0.146;                                        // the side glass's bottom edge
// The cabin: its flanks lean in from the waist (WS) to the roof (WT), so a side is one plane.
const WS = 0.146, WT = 0.116, ROOF = HI;
const gAt = (h) => WS - (WS - WT) * (h - BELT) / (ROOF - BELT);
const SCR0 = 0.384, SCR1 = 0.262;                          // the screen's foot and head, fore-aft: about 45 degrees
const RBACK = CAB0 + 0.002, RTOP = 0.224, RLIP = CAB0 + 0.030;   // the roof falls away aft to the back
const cabV = {
  bR: (s) => [RBACK, s * WS, BELT], bF: (s) => [SCR0, s * WS, BELT],
  tF: (s) => [SCR1, s * WT, ROOF], tB: (s) => [RLIP, s * WT, ROOF], rT: (s) => [RBACK, s * gAt(RTOP), RTOP],
  // Where the sill meets the back and the screen, so the strip under the glass is its own face.
  sR: (s) => [RBACK, s * gAt(SILL), SILL], sF: (s) => [SCR0 - (SCR0 - SCR1) * (SILL - BELT) / (ROOF - BELT), s * gAt(SILL), SILL],
};
const cabin = solid('cabin', [
  [cabV.bR(-1), cabV.bR(1), cabV.bF(1), cabV.bF(-1)],                         // floor (hidden)
  [cabV.bF(-1), cabV.bF(1), cabV.tF(1), cabV.tF(-1)],                         // the screen
  [cabV.tF(-1), cabV.tF(1), cabV.tB(1), cabV.tB(-1)],                         // roof
  [cabV.tB(-1), cabV.tB(1), cabV.rT(1), cabV.rT(-1)],                         // the lip down to the back
  [cabV.rT(-1), cabV.rT(1), cabV.bR(1), cabV.bR(-1)],                         // back
  ...LR.flatMap((s) => [
    [cabV.bR(s), cabV.bF(s), cabV.sF(s), cabV.sR(s)],                         // flank, the strip under the glass
    [cabV.sR(s), cabV.sF(s), cabV.tF(s), cabV.tB(s), cabV.rT(s)],             // flank, the glass line up
  ]),
], { paint: 'pearl', face: (i) => (i === 1 ? { role: 'glass', tint: GLASS, uv: UV_FULL, paint: 'none' } : null) });

// Side glass: two panes a side, proud of the flank by a hair, in the flank's own plane.
function pane(name, s, fA, fB, h0, h1) {
  // The flank's outward normal is (0, s*cos, sin)-ish; push the pane out along g only, which keeps it
  // in a plane parallel to the flank because the flank's lean depends on h alone.
  const out = (f, h, d) => [f, s * (gAt(h) + d), h];
  const scrF = (h) => SCR0 - (SCR0 - SCR1) * (h - BELT) / (ROOF - BELT);
  const fa = (f, h) => Math.min(f, scrF(h) - 0.012);
  const ring = (d) => [out(fA, h0, d), out(fa(fB, h0), h0, d), out(fa(fB, h1), h1, d), out(fA, h1, d)];
  return loft(name, [ring(0.0006), ring(0.0034)], { role: 'glass', tint: [50, 74, 92], ...fine });
}
const glassSide = LR.flatMap((s) => [pane('door glass', s, 0.228, 0.40, 0.146, 0.232), pane('quarter glass', s, 0.150, 0.214, 0.146, 0.222)]);

// The waist band (one strip a side, so its top doesn't plate the bonnet), the rocker light line and
// the nose bar.
const trim = [
  ...LR.map((s) => box('waist band', CAB0 + 0.004, 0.398, 0.0025, BELT - 0.010, BELT + 0.002, { role: 'body', paint: 'gilt', g: s * (W + 0.0005) })),
  box('rocker light', CAB0 + 0.010, 0.404, W + 0.001, 0.040, 0.044, { role: 'window', tint: ACCENT, pk: 'glow', ...fine }),
  box('nose light bar', 0.414, 0.420, 0.105, 0.084, 0.088, { role: 'window', tint: [220, 226, 236], ...fine }),
  // Roof edge pinstripe over the screen head, and the marker lamps along it (truck.geom.markF/markZ).
  box('roof pinstripe', SCR1 - 0.010, SCR1 + 0.002, WT, ROOF - 0.003, ROOF + 0.002, { role: 'body', paint: 'gilt', ...fine }),
  ...[-2, -1, 0, 1, 2].map((i) => box('marker lamp', SCR1 - 0.008, SCR1, 0.008, ROOF + 0.002, ROOF + 0.007, { role: 'window', tint: AMBER, g: i * W * 0.34, ...fine })),
];
const MARK_F = SCR1 - 0.004, MARK_Z = ROOF + 0.0045;

// Lamps at the old stations (truck.geom): an LED bar a side where the stacked pair was.
const lamps = LR.flatMap((s) => [
  box('headlamp', L.lampF - 0.003, L.lampF + 0.005, 0.020, L.lampMidZ - 0.007, L.lampMidZ + 0.007, { role: 'window', tint: LED, g: s * L.lampG }),
  box('lamp brow', L.lampF - 0.004, L.lampF + 0.004, 0.022, L.lampMidZ + 0.007, L.lampMidZ + 0.010, { role: 'window', tint: CHROME, pk: 'bright', g: s * L.lampG, ...fine }),
]);

// The winged badge on the nose tip, ahead of where a mascot stands: a chrome ball with swept wings.
const badge = [
  box('badge', 0.411, 0.417, 0.006, 0.094, 0.104, { role: 'body', paint: 'gilt', ...fine }),
  ...LR.map((s) => sheet('badge wing', [[0.416, s * 0.005, 0.101], [0.408, s * 0.032, 0.108], [0.412, s * 0.010, 0.097]], { role: 'body', paint: 'gilt', ...fine })),
];

// Tail fins on the roof's back corners, rising aft, with a red lens at the top and a trim edge;
// nothing aft of CAB0. The foot of each runs down into the cabin, so it meets the falling roof.
const FIN_G = 0.106, FIN_T = 0.004, FIN_F = 0.205, FIN_TOP = 0.288;
const fins = LR.flatMap((s) => {
  const tri = (d) => [[RBACK + 0.002, s * FIN_G + d, RTOP + 0.002], [FIN_F, s * FIN_G + d, ROOF - 0.004], [RBACK + 0.002, s * FIN_G + d, FIN_TOP]];
  const edge = (d) => [[FIN_F, s * FIN_G + d, ROOF - 0.0035], [RBACK + 0.004, s * FIN_G + d, FIN_TOP + 0.0005], [RBACK + 0.004, s * FIN_G + d, FIN_TOP - 0.005], [FIN_F - 0.007, s * FIN_G + d, ROOF - 0.004]];
  return [
    loft('tail fin', [tri(-FIN_T), tri(FIN_T)], { paint: 'pearl' }),
    box('fin lens', RBACK + 0.002, RBACK + 0.012, FIN_T + 0.001, FIN_TOP - 0.016, FIN_TOP - 0.004, { role: 'window', tint: [214, 74, 58], g: s * FIN_G, ...fine }),
    loft('fin edge', [edge(-FIN_T - 0.001), edge(FIN_T + 0.001)], { role: 'body', paint: 'gilt', ...fine }),
  ];
});

// The heat mast where the stack stood (the stack fittings wrap it at CAB0), capped in chrome.
const mast = [
  loft('heat mast', [CAB0 - 0.010, CAB0 + 0.012].map((f) => [[f, -0.009, BELT], [f, 0.009, BELT], [f, 0.009, 0.286], [f, -0.009, 0.286]]), { role: 'strut', paint: 'titanium' }),
  box('mast cap', CAB0 - 0.012, CAB0 + 0.014, 0.011, 0.286, 0.292, { role: 'window', tint: CHROME, pk: 'bright' }),
  box('mast vent', CAB0 - 0.011, CAB0 - 0.009, 0.006, 0.200, 0.270, { role: 'gear', ...fine }),
];

// Camera stalks for mirrors.
const stalks = LR.flatMap((s) => [
  box('camera arm', CAB1 - 0.026, CAB1 - 0.018, 0.010, 0.154, 0.158, { role: 'strut', g: s * (W + 0.008), ...fine }),
  loft('camera pod', [CAB1 - 0.034, CAB1 - 0.008].map((f) => [[f, s * (W + 0.014), 0.150], [f, s * (W + 0.026), 0.150], [f, s * (W + 0.026), 0.166], [f, s * (W + 0.014), 0.166]]), { role: 'strut', paint: 'carbon' }),
  box('camera lens', CAB1 - 0.036, CAB1 - 0.033, 0.004, 0.154, 0.162, { role: 'glass', tint: [30, 40, 60], g: s * (W + 0.020), ...fine }),
]);

// Door shut lines either side of the door art panel (drawTruckDoorArt: CAB1-0.104 to CAB1-0.052).
// They stop under the waist band (BELT - 0.010): a flat face inside the band's fore-aft span gets
// one depth in the painter's sort and eats one side of it (truckNoseSliceSmoke).
const seams = LR.flatMap((s) => [CAB1 - 0.112, CAB1 - 0.008].map((f) =>
  box('door shut line', f - 0.0015, f + 0.0015, 0.0015, CHAMF, BELT - 0.011, { role: 'strut', g: s * (W + 0.0005), ...fine })));

// ── The lift pads ── Three a side under the floor: a puck, a lit emitter ring (out when parked), a
// trim band, and an arm up into the frame for the aft pair. truck.pods gets one row each.
const PAD_R = 0.040, PAD_G = 0.112, PAD_Z0 = 0.016, PAD_Z1 = 0.034;
const PADS = [0.372, 0.215, -0.010];
const pads = [], padRows = [];
for (const s of LR) for (const f of PADS) {
  const g = s * PAD_G;
  padRows.push([f, g, PAD_R, false, 0.024]);
  pads.push(puck('lift pad', f, g, PAD_R * 0.92, PAD_Z0 + 0.004, PAD_Z1, { role: 'gear', paint: 'gunmetal' }));
  pads.push(puck('emitter ring', f, g, PAD_R, PAD_Z0, PAD_Z0 + 0.006, { role: 'window', tint: GLOW, whenNot: 'parked', ...fine }, 12));
  pads.push(puck('pad trim', f, g, PAD_R * 0.95, PAD_Z1 - 0.004, PAD_Z1 - 0.001, { role: 'window', tint: CHROME, pk: 'bright', ...fine }, 12));
  if (f < CAB0) pads.push(box('pad arm', f - 0.010, f + 0.010, 0.008, PAD_Z1, 0.050, { role: 'strut', g: g * 0.85 }));
}

// ── The chassis ── The old Courier's numbers: rails, deck plate, fifth wheel (the pin), tail lamps.
const chassis = [
  ...LR.map((s) => box('frame rail', FRAME0 - 0.01, CAB1 - 0.02, 0.016, 0.028, 0.072, { role: 'strut', g: s * W * 0.62 })),
  box('deck plate', FRAME0, CAB0 + 0.02, W * 0.80, 0.050, 0.070),
  box('fifth wheel', PIN0, PIN1, W * 0.62, 0.070, 0.082, { role: 'strut' }),
  // A lit ring on the bare fifth wheel; a hitched box sits down over it.
  box('coupling ring', (PIN0 + PIN1) / 2 - 0.022, (PIN0 + PIN1) / 2 + 0.022, 0.022, 0.082, 0.085, { role: 'window', tint: ACCENT, pk: 'glow', whenNot: 'trailer', ...fine }),
  ...LR.map((s) => box('tail lamp', FRAME0 - 0.012, FRAME0 - 0.004, 0.016, 0.052, 0.070, { role: 'window', tint: RED, g: s * W * 0.66 })),
  box('plate light', FRAME0 - 0.011, FRAME0 - 0.004, W * 0.30, 0.074, 0.080, { role: 'window', tint: [230, 210, 140], ...fine }),
  // Twin thrusters under the fifth wheel, below the trailer's floor, nozzle aft.
  ...LR.flatMap((s) => [
    tubeF('thruster', FRAME0 - 0.008, FRAME0 + 0.030, s * 0.055, 0.044, 0.016, { role: 'gear', paint: 'titanium', ...fine }),
    tubeF('thruster nozzle', FRAME0 - 0.010, FRAME0 - 0.007, s * 0.055, 0.044, 0.012, { role: 'window', tint: [140, 160, 255], ...fine }),
  ]),
];

// ── What a bobtail carries ── A streamlined pod on the bare deck, where the old one had a strapped rack.
const POD_SEC = (f, w, z1) => [[f, -w * 0.86, 0.072], [f, w * 0.86, 0.072], [f, w, 0.084], [f, w, z1 - 0.012], [f, w * 0.82, z1], [f, -w * 0.82, z1], [f, -w, z1 - 0.012], [f, -w, 0.084]];
const cargo = [
  loft('cargo pod', [POD_SEC(-0.052, 0.070, 0.128), POD_SEC(-0.036, 0.100, 0.150), POD_SEC(0.086, 0.100, 0.150), POD_SEC(0.104, 0.084, 0.140)], { paint: 'pearl', whenNot: 'trailer' }),
  box('pod band', -0.034, 0.084, 0.102, 0.104, 0.110, { role: 'body', paint: 'gilt', whenNot: 'trailer', ...fine }),
  box('pod scan line', -0.020, 0.070, 0.101, 0.132, 0.135, { role: 'window', tint: ACCENT, pk: 'glow', whenNot: 'trailer', ...fine }),
];

// ── Adornments ── What makes it an expensive truck rather than a clean one.
const SOLAR = [22, 36, 84];
const LOUVRE_H = [0.094, 0.102, 0.110];   // under the waist band (truckNoseSliceSmoke)
const adorn = [
  // A solar panel let into the roof, glassy and nearly black-blue, with a trim line round it.
  box('roof solar panel', RLIP + 0.006, SCR1 - 0.016, WT - 0.014, ROOF - 0.001, ROOF + 0.0015, { role: 'window', tint: SOLAR, ...fine }),
  // A carbon intake low on the nose with chrome slats standing proud of it.
  box('nose intake', 0.4175, 0.4195, 0.086, 0.046, 0.070, { role: 'strut', paint: 'carbon' }),
  ...[-2, -1, 0, 1, 2].map((i) => box('intake slat', 0.4195, 0.4210, 0.0022, 0.047, 0.069, { role: 'window', tint: CHROME, pk: 'bright', g: i * 0.034, ...fine })),
  box('intake lip', 0.4190, 0.4215, 0.088, 0.070, 0.0725, { role: 'window', tint: CHROME, pk: 'bright', ...fine }),
  // Louvres on the flank behind the door, and a flush door handle.
  ...LR.flatMap((s) => [
    ...LOUVRE_H.map((h) => box('flank louvre', CAB0 + 0.018, CAB0 + 0.076, 0.0015, h, h + 0.0045, { role: 'strut', paint: 'carbon', g: s * (W + 0.0005), ...fine })),
    box('door handle', CAB1 - 0.030, CAB1 - 0.014, 0.0012, 0.112, 0.116, { role: 'window', tint: CHROME, pk: 'bright', g: s * (W + 0.0004), ...fine }),
    // A carbon A-pillar along the screen's edge, proud of the flank.
    sheet('a-pillar', [
      [SCR0, s * (WS + 0.0008), BELT], [SCR0 - 0.016, s * (WS + 0.0008), BELT],
      [SCR1 - 0.012, s * (WT + 0.0008), ROOF - 0.002], [SCR1, s * (WT + 0.0008), ROOF - 0.002]], { role: 'strut', sh: 0.66, paint: 'carbon', ...fine }),
  ]),
  // A red light line across the cab's back; a hitched box hides it, a bobtail shows it.
  box('tail light line', RBACK - 0.002, RBACK + 0.001, gAt(0.205) * 0.92, 0.200, 0.206, { role: 'window', tint: [214, 60, 48], ...fine }),
  // The lift pads' fairings: a shallow carbon skirt either side of each, under the rocker.
  ...LR.flatMap((s) => [PADS[0], PADS[1]].map((f) => box('pad fairing', f - 0.050, f + 0.050, 0.008, 0.026, FLOOR + 0.004, { role: 'strut', paint: 'carbon', g: s * 0.138, ...fine }))),
  // A glowing ring inside each thruster's nozzle.
  ...LR.map((s) => tubeF('thruster core', FRAME0 - 0.0115, FRAME0 - 0.0098, s * 0.055, 0.044, 0.007, { role: 'window', tint: GLOW, ...fine })),
];

// ── Fittings ── From scripts/shapes/truck-fittings.mjs, off this body's anchors. The stock Courier's,
// moved where this body differs: the screen guards onto the swept screen, the mascot onto the bonnet
// ahead of it, the roof kit forward of the fins (one roof fitting at a time, so they only have to
// clear the body), the stack kit onto the heat mast. The halos are this file's own, on the pads.
const SN = (() => { const df = SCR1 - SCR0, dh = ROOF - BELT, l = Math.hypot(df, dh); return [dh / l, -df / l]; })();   // the screen's outward normal in (f, h)
const SD = 0.010;
const scrHW = (t) => WS - (WS - WT) * t;
const BEACON_F = 0.236, MASCOT_F = 0.392;
const A = {
  ...vintageAnchors(ROW, []),
  scrW: 1,
  scrP: (t, gf) => [SCR0 + (SCR1 - SCR0) * t + SN[0] * SD, gf * scrHW(t), BELT + (ROOF - BELT) * t + SN[1] * SD],
  mascot: [MASCOT_F, bonnetAt(MASCOT_F)],
  lightBarF: SCR1 - 0.012, beaconF: BEACON_F, totemF: FIN_F + 0.009, aerialF: FIN_F + 0.009,
  cage: [SCR1 - 0.012, FIN_F + 0.001], parapet: [SCR1 - 0.012, FIN_F + 0.001],
  stackTop: 0.292,
};
// Six places are plenty in a file someone may read; the sums leave sixteen.
const tidy = (v, k) => (typeof v === 'number' ? (k === 'tint' ? v : r6(v)) : Array.isArray(v) ? v.map((x) => tidy(x, k))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, tidy(x, kk === 'tint' ? 'tint' : k)])) : v);
const kit = truckFittingParts(A).filter((p) => p.when !== 'fit_hl').map((p) => tidy(p));
// Lifter halos: a lit plate on each tractor pad.
const halos = padRows.map(([f, g]) => box('Lifter Halos', f - PAD_R - 0.004, f + PAD_R + 0.004, PAD_R + 0.004, PAD_Z1, PAD_Z1 + 0.003, { role: 'window', tint: ACCENT, pk: 'glow', g, when: 'fit_hl' }));

const tractor = [lower, cabin, ...glassSide, ...trim, ...lamps, ...badge, ...fins, ...mast, ...stalks, ...seams, ...pads, ...chassis, ...adorn, ...cargo];
const trailer = BASE.parts.find((p) => p.name === 'trailer');
const doc = {
  id: 'truck_hauler_2076',
  kind: 'mesh',
  params: {
    name: 'Ostrek Courier 2076',
    note: 'The Courier after the Aria GT (docs/proposals/hover-rigs.md). Written by scripts/shapes/concepts/courier-2076.mjs from mesh_truck_hauler.json; edit that, not this. '
      + 'Same channels as the stock file: trailer (+t), parked (~p), fit_<code> (^code).',
    // Surfaces (gl/solids.js `tex`). Pearl follows the booth's base colour and flash, gilt its trim colour;
    // the rest are fixed.
    paints: {
      pearl: { rgb: [236, 230, 218], livery: 'base', tex: 'flake', note: 'the body: the booth colour over a metal flake' },
      gilt: { rgb: [201, 162, 58], livery: 'trim', tex: 'paint', note: 'pinstripes, fin edges, waist band, badge: the booth trim colour (gold at the factory)' },
      carbon: { rgb: [30, 32, 36], livery: 'fixed', mat: 'satin', tex: 'carbon', note: 'rocker, intake, pillars, louvres, camera pods' },
      titanium: { rgb: [166, 170, 178], livery: 'fixed', mat: 'bare', tex: 'brushed', note: 'heat mast and thrusters' },
      gunmetal: { rgb: [58, 62, 70], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'the lift pads' },
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
writeFileSync(new URL('../../../content/vehicle_models/mesh_truck_hauler_2076.json', import.meta.url), formatMesh(doc));
// The stock file names its edition.
if (BASE.variants?.['2076'] !== 'truck_hauler_2076') {
  BASE_DOC.params = { ...BASE, variants: { ...(BASE.variants || {}), 2076: 'truck_hauler_2076' } };
  writeFileSync(BASE_URL, formatMesh(BASE_DOC));
}
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
console.log('mesh_truck_hauler_2076.json:', n1, 'faces near,', n0, 'far (every state)');
