// The Orlov Continental 2076: writes content/vehicle_models/mesh_truck_continental_2076.json, and names
// it as the 2076 edition in mesh_truck_continental.json's `variants`.
//
//   node scripts/shapes/concepts/continental-2076.mjs
//   then: npm run vehicles:bake
//   see it: the Modelshop subject vehicle:truck/continental~e2076, or any variant with ~e2076 after +t
//
// The Continental fifty years after the chrome one, after the Bulwark HX in the Hover Rig Expo concept
// (docs/proposals/hover-rigs.md): a tall slab cab with the sleeper inside it, a flat face of grille
// slats in a hazard surround, a steel bumper with chevrons, an orange sun visor with the marker lamps
// on it, a roof light bar, twin air horns and twin stacks, mirrors on arms, grab rails and steps, four
// heavy lift pads a side under a deep skirt, saddle tanks behind the cab and mud flaps at the tail.
//
// ⚠ THIS STARTS FROM mesh_truck_continental.json AND KEEPS ITS FRAME. The old Continental's sleeper
// stood aft of its cab, in the box's swing, so this one is a longer cab with the bunk inside it: the
// back wall sits on cab0 and nothing of the tractor above the trailer floor goes aft of it, bar the
// stacks on the back corners (the gate's STACK_REACH). The chassis, the fifth wheel, the tail lamps,
// the lamp stations and the trailer are the old Continental's numbers, and the whole body stays inside
// the old one's length, width and height, because the depot sizes every card off the biggest truck.
// What the gate holds (scripts/shapes/meshes.mjs): the same pin, cab back and box nose as the stock
// file, and a truck that builds in every state.
//
// The fittings come from scripts/shapes/truck-fittings.mjs, off this body's anchors: the stock
// Continental's, with the screen, mascot, roof kit and stacks moved where this body puts them. The
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
// The stock Continental's proportion row: the fittings' anchors start from it.
const ROW = TRUCK_ROWS.continental;

const BASE_URL = new URL('../../../content/vehicle_models/mesh_truck_continental.json', import.meta.url);
const BASE_DOC = JSON.parse(readFileSync(BASE_URL, 'utf8'));
const BASE = BASE_DOC.params;
const T = BASE.truck, L = T.geom;
const W = T.w;
const CAB0 = L.cab0, FRAME0 = L.frame0;
const [PIN0, PIN1] = T.pin;

// ── Colours ──
const CHROME = [226, 232, 240];          // pk 'bright': the booth's trim colour (hazard orange on the factory paint)
const ACCENT = [96, 196, 214];           // pk 'glow': the running light
const GLOW = [128, 226, 255];            // the lifter emitters, as the road wash
const GLASS = [58, 84, 104];
const RED = [196, 66, 54];
const AMBER = [236, 176, 96];
const LED = [236, 240, 244];
const LENS_HI = [242, 234, 196], LENS_LO = [238, 228, 182];   // the headlamp lenses truck-lamps.mjs looks for
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
// An upright n-gon puck, an n-gon tube along f, and one stood up along h.
const ngon = (n, fn) => Array.from({ length: n }, (_, k) => fn(Math.cos((k + 0.5) / n * Math.PI * 2), Math.sin((k + 0.5) / n * Math.PI * 2)));
const puck = (name, f, g, r, z0, z1, o = {}, n = 10) =>
  loft(name, [z0, z1].map((z) => ngon(n, (c, s) => [f + c * r, g + s * r, z])), o);
const tubeF = (name, f0, f1, g, h, r, o = {}, n = 8) =>
  loft(name, [f0, f1].map((f) => ngon(n, (c, s) => [f, g + c * r, h + s * r])), o);
// A cone along f: radius r0 at f0 to r1 at f1.
const coneF = (name, f0, f1, g, h, r0, r1, o = {}, n = 8) =>
  loft(name, [[f0, r0], [f1, r1]].map(([f, r]) => ngon(n, (c, s) => [f, g + c * r, h + s * r])), o);
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

// ── The lower body ── Back wall to face in one convex solid, flat on top at the belt. The flank is
// cut at BAND and sliced along its length, because the booth's flashes test each face's centre
// (faceWearsTrim) and one face a side would take a stripe whole or not at all. The bottom chamfers are
// the carbon rocker. The door art (drawTruckDoorArt) lands on the flat flank between CHAMF and BAND.
const FLOOR = 0.030, CHAMF = 0.048, BAND = 0.112, BELT = 0.170;
const RBACK = CAB0 + 0.002, FACE = 0.402;
const WB = W - 0.018;                                      // the floor's half-width inside the rocker
const SEC = (f, top, w, wb, bot) => [[f, -wb, bot], [f, wb, bot], [f, w, CHAMF], [f, w, BAND], [f, w, top], [f, -w, top], [f, -w, BAND], [f, -w, CHAMF]];
const STATIONS = [RBACK, 0.090, 0.140, 0.190, 0.240, 0.290, 0.340, 0.388];
// The face's corners are cut back at 45 degrees, so the lamp pods stand on a shoulder.
const CORNER = 0.014;
const lowerRings = [...STATIONS.map((f) => SEC(f, BELT, W, WB, FLOOR)), SEC(FACE, BELT - 0.008, W - CORNER, WB - CORNER, FLOOR + 0.006)];
const lower = loft('lower body', lowerRings,
  { paint: 'body', face: (i) => (i < (lowerRings.length - 1) * 8 && (i % 8 === 1 || i % 8 === 7) ? { role: 'strut', paint: 'carbon' } : null) });
// The cowl's height at f, for what sits on it.
const cowlAt = (f) => (f <= 0.388 ? BELT : BELT - 0.008 * (f - 0.388) / (FACE - 0.388));

// ── The cabin ── On the belt, its flanks leaning in from WS to WT, so a side is one plane. A nearly
// upright screen with its corners cut back at 45 degrees, a flat roof the length of the cab (the bunk is
// under the back half of it), and a chamfer down to the back wall. The glass is one band at the same
// height all round, SG0 to SG1, with body colour under it and a header over it.
const WS = W - 0.002, WT = W - 0.014, ROOF = 0.374;
const gAt = (h) => WS - (WS - WT) * (h - BELT) / (ROOF - BELT);
const SCR0 = 0.386, SCR1 = 0.358;                          // the screen's foot and head, fore-aft: about 8 degrees
const scrF = (h) => SCR0 - (SCR0 - SCR1) * (h - BELT) / (ROOF - BELT);
const CC = 0.030;                                          // the corner cut
const SG0 = 0.198, SG1 = 0.338, SILL = SG0;
const RTOP = 0.360, RLIP = RBACK + 0.016;
// A point on the screen's edge (k 0) or the flank's front edge (k 1) at height h; and on the back wall.
const edge = (s, h, k) => [scrF(h) - CC * k, s * (gAt(h) - CC * (1 - k)), h];
const cbk = (s, h) => [RBACK, s * gAt(h), h];
const cabPolys = [], cabFaces = [];
const cabAdd = (poly, fo = null) => { cabPolys.push(poly); cabFaces.push(fo); };
const PANE_FACE = { role: 'glass', tint: GLASS, paint: 'none' };
cabAdd([cbk(-1, BELT), cbk(1, BELT), edge(1, BELT, 1), edge(1, BELT, 0), edge(-1, BELT, 0), edge(-1, BELT, 1)]);   // floor (hidden)
// The front: body under the glass, the screen, and the header.
cabAdd([edge(-1, BELT, 0), edge(1, BELT, 0), edge(1, SG0, 0), edge(-1, SG0, 0)]);
cabAdd([edge(-1, SG0, 0), edge(1, SG0, 0), edge(1, SG1, 0), edge(-1, SG1, 0)], { ...PANE_FACE, uv: UV_FULL });
cabAdd([edge(-1, SG1, 0), edge(1, SG1, 0), edge(1, ROOF, 0), edge(-1, ROOF, 0)]);
// The cut corners, the same three bands.
for (const s of LR) {
  cabAdd([edge(s, BELT, 0), edge(s, BELT, 1), edge(s, SG0, 1), edge(s, SG0, 0)]);
  cabAdd([edge(s, SG0, 0), edge(s, SG0, 1), edge(s, SG1, 1), edge(s, SG1, 0)], PANE_FACE);
  cabAdd([edge(s, SG1, 0), edge(s, SG1, 1), edge(s, ROOF, 1), edge(s, ROOF, 0)]);
}
cabAdd([[RLIP, -WT, ROOF], [RLIP, WT, ROOF], edge(1, ROOF, 1), edge(1, ROOF, 0), edge(-1, ROOF, 0), edge(-1, ROOF, 1)]);   // roof
cabAdd([[RLIP, -WT, ROOF], [RLIP, WT, ROOF], cbk(1, RTOP), cbk(-1, RTOP)]);       // the lip down to the back
cabAdd([cbk(-1, RTOP), cbk(1, RTOP), cbk(1, BELT), cbk(-1, BELT)]);               // back
for (const s of LR) {
  cabAdd([cbk(s, BELT), edge(s, BELT, 1), edge(s, SILL, 1), cbk(s, SILL)]);       // flank, the strip under the glass
  cabAdd([cbk(s, SILL), edge(s, SILL, 1), edge(s, ROOF, 1), [RLIP, s * WT, ROOF], cbk(s, RTOP)]);   // flank, the glass line up
}
const cabin = solid('cabin', cabPolys, { paint: 'body', face: (i) => cabFaces[i] });

// The screen's frame: a carbon post down the middle, rails along its foot and head, and pillars on
// both edges of each cut corner, all proud of the glass by a hair in its own plane. The visor covers
// the header.
const SN = (() => { const df = SCR1 - SCR0, dh = ROOF - BELT, l = Math.hypot(df, dh); return [dh / l, -df / l]; })();   // the screen's outward normal in (f, h)
const onScr = (h, gf, d) => { const e = edge(1, h, 0); return [e[0] + SN[0] * d, gf * e[1], h + SN[1] * d]; };
const scrQuad = (name, h0, h1, g0, g1, o) => sheet(name, [onScr(h0, g0, 0.0012), onScr(h0, g1, 0.0012), onScr(h1, g1, 0.0012), onScr(h1, g0, 0.0012)], o);
// A strip on a cut corner from k0 to k1 across it, proud of it by a hair.
const cornerN = (s) => {
  const a = edge(s, SG0, 0), b = edge(s, SG0, 1), c = edge(s, SG1, 0);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n); n = n.map((x) => x / l);
  return n[0] < 0 ? n.map((x) => -x) : n;
};
const onCorner = (s, h, k, d = 0.0012) => { const e0 = edge(s, h, 0), e1 = edge(s, h, 1), n = cornerN(s); return [0, 1, 2].map((i) => e0[i] + (e1[i] - e0[i]) * k + n[i] * d); };
const cornerStrip = (name, s, k0, k1, o) => sheet(name, [onCorner(s, SG0, k0), onCorner(s, SG0, k1), onCorner(s, SG1, k1), onCorner(s, SG1, k0)], o);
const screenFrame = [
  scrQuad('screen post', SG0, SG1, -0.022, 0.022, { role: 'strut', sh: 0.8, paint: 'carbon', ...fine }),
  scrQuad('screen rail', SG0 - 0.003, SG0 + 0.005, -1.0, 1.0, { role: 'strut', sh: 0.8, paint: 'carbon' }),
  scrQuad('screen head rail', SG1 - 0.005, SG1 + 0.003, -1.0, 1.0, { role: 'strut', sh: 0.8, paint: 'carbon', ...fine }),
  ...LR.flatMap((s) => [
    scrQuad('a-pillar', SG0, SG1, s * 0.965, s * 1.0, { role: 'strut', sh: 0.66, paint: 'carbon', ...fine }),
    cornerStrip('corner pillar', s, 0.80, 1.0, { role: 'strut', sh: 0.66, paint: 'carbon', ...fine }),
  ]),
  // Wipers parked along the foot of each pane.
  ...LR.map((s) => scrQuad('wiper', SG0 + 0.008, SG0 + 0.011, s * 0.08, s * 0.80, { role: 'strut', sh: 0.5, ...fine })),
];

// Side glass: the door glass and the bunk window aft, proud of the flank by a hair in the flank's own
// plane, with a carbon frame along the head of the door.
function pane(name, s, fA, fB, h0, h1, o = {}) {
  const out = (f, h, d) => [f, s * (gAt(h) + d), h];
  const fa = (f, h) => Math.min(f, scrF(h) - CC - 0.008);
  const ring = (d) => [out(fA, h0, d), out(fa(fB, h0), h0, d), out(fa(fB, h1), h1, d), out(fA, h1, d)];
  return loft(name, [ring(0.0006), ring(0.0034)], { role: 'glass', tint: [50, 74, 92], ...fine, ...o });
}
const glassSide = LR.flatMap((s) => [
  pane('door glass', s, 0.198, 0.40, SG0 + 0.002, SG1 - 0.002),
  pane('bunk window', s, 0.084, 0.152, 0.262, 0.318),
  pane('door frame', s, 0.192, 0.40, SG1 - 0.002, SG1 + 0.006, { role: 'strut', tint: null, paint: 'carbon' }),
]);

// ── The face ── A dark recess with upright slats in it, a hazard surround, the maker's plate on top,
// LED lamps in steel pods at the old lamp stations, and a steel bumper with chevrons across it.
const GR_G = 0.112, GR_Z0 = 0.064, GR_Z1 = 0.150;
const grille = [
  box('grille recess', FACE - 0.002, FACE + 0.001, GR_G + 0.008, GR_Z0 - 0.004, GR_Z1 + 0.004, { role: 'strut', paint: 'carbon' }),
  ...Array.from({ length: 11 }, (_, i) => box('grille slat', FACE + 0.001, FACE + 0.008, 0.0035, GR_Z0, GR_Z1, { role: 'strut', paint: 'steel', g: -GR_G + 0.010 + i * (2 * GR_G - 0.020) / 10 })),
  // The surround: two rails and two posts in the hazard colour.
  box('grille surround', FACE, FACE + 0.010, GR_G + 0.012, GR_Z1 + 0.002, GR_Z1 + 0.010, { role: 'strut', paint: 'hazard' }),
  box('grille surround', FACE, FACE + 0.010, GR_G + 0.012, GR_Z0 - 0.010, GR_Z0 - 0.002, { role: 'strut', paint: 'hazard' }),
  ...LR.map((s) => box('grille surround', FACE, FACE + 0.010, 0.005, GR_Z0 - 0.010, GR_Z1 + 0.010, { role: 'strut', paint: 'hazard', g: s * (GR_G + 0.007) })),
  // The maker's plate on the top rail.
  box('maker plate', FACE + 0.010, FACE + 0.012, 0.030, GR_Z1 + 0.002, GR_Z1 + 0.010, { role: 'strut', paint: 'steel', ...fine }),
];
const LAMP_G = L.lampG, LAMP_Z = L.lampMidZ;
const lamps = LR.flatMap((s) => [
  box('lamp pod', 0.388, L.lampF - 0.002, 0.024, LAMP_Z - 0.020, LAMP_Z + 0.018, { role: 'strut', paint: 'steel', g: s * LAMP_G }),
  box('headlamp', L.lampF - 0.002, L.lampF + 0.001, 0.019, LAMP_Z + 0.002, LAMP_Z + 0.013, { role: 'window', tint: LENS_HI, g: s * LAMP_G }),
  box('headlamp', L.lampF - 0.002, L.lampF + 0.001, 0.019, LAMP_Z - 0.013, LAMP_Z - 0.002, { role: 'window', tint: LENS_LO, g: s * LAMP_G }),
  // The running light under each pod, and the indicator outboard of it.
  box('running light', L.lampF - 0.002, L.lampF + 0.0005, 0.020, LAMP_Z - 0.019, LAMP_Z - 0.016, { role: 'window', tint: ACCENT, pk: 'glow', g: s * LAMP_G, ...fine }),
  box('indicator', 0.388, 0.396, 0.004, LAMP_Z - 0.012, LAMP_Z + 0.012, { role: 'window', tint: AMBER, g: s * (W - 0.006), ...fine }),
]);
// The bumper, and a chevron of hazard stripes across its face, sloping out and down from the middle.
const BUMP_F0 = FACE - 0.002, BUMP_F1 = 0.420, BUMP_W = W + 0.002, BUMP_Z0 = 0.024, BUMP_Z1 = 0.058;
const chevrons = [];
for (const s of LR) for (let i = 0; i < 5; i++) {
  const g0 = s * (0.044 + i * 0.026), g1 = g0 + s * 0.013, k = s * 0.012;
  chevrons.push(sheet('bumper chevron', [[BUMP_F1 + 0.0006, g0, BUMP_Z1 - 0.004], [BUMP_F1 + 0.0006, g1, BUMP_Z1 - 0.004], [BUMP_F1 + 0.0006, g1 + k, BUMP_Z0 + 0.004], [BUMP_F1 + 0.0006, g0 + k, BUMP_Z0 + 0.004]],
    { role: 'body', sh: 0.8, paint: 'hazard', ...fine }));
}
const bumper = [
  box('bumper', BUMP_F0, BUMP_F1, BUMP_W, BUMP_Z0, BUMP_Z1, { role: 'strut', paint: 'steel' }),
  box('bumper top rail', BUMP_F0, BUMP_F1 + 0.002, BUMP_W, BUMP_Z1, BUMP_Z1 + 0.003, { role: 'strut', paint: 'rubber', ...fine }),
  ...chevrons,
  ...LR.map((s) => box('tow eye', BUMP_F1 - 0.004, BUMP_F1 + 0.008, 0.006, BUMP_Z0 - 0.006, BUMP_Z0 + 0.004, { role: 'gear', g: s * 0.026, ...fine })),
  box('plate', BUMP_F1, BUMP_F1 + 0.002, 0.020, BUMP_Z0 + 0.008, BUMP_Z1 - 0.008, { role: 'window', tint: [214, 210, 196], ...fine }),
];

// ── The flanks ── The belt line, door shut lines, the bunk locker, grab rails, steps, the deep skirt
// with its light line, marker lamps and the mirrors on their arms.
const DOOR0 = 0.188, DOOR1 = 0.350;
const flank = LR.flatMap((s) => {
  const out = s * (W + 0.0005);
  return [
    box('belt line', RBACK + 0.004, FACE - 0.012, 0.0025, BELT - 0.009, BELT + 0.001, { role: 'strut', paint: 'steel', g: out }),
    // A broad hazard band under it, the length of the cab: the Bulwark's one stripe.
    box('hazard band', RBACK + 0.004, FACE - 0.012, 0.0022, BELT - 0.027, BELT - 0.013, { role: 'body', paint: 'hazard', g: s * (W + 0.0004) }),
    ...[DOOR0, DOOR1].map((f) => box('door shut line', f - 0.0015, f + 0.0015, 0.0015, CHAMF + 0.004, BELT - 0.010, { role: 'strut', g: out, ...fine })),
    // The bunk locker on the sleeper's flank: four seams and a latch.
    box('locker seam', 0.072, 0.158, 0.0012, 0.150, 0.153, { role: 'strut', g: out, ...fine }),
    box('locker seam', 0.072, 0.158, 0.0012, 0.060, 0.063, { role: 'strut', g: out, ...fine }),
    ...[0.072, 0.155].map((f) => box('locker seam', f, f + 0.003, 0.0012, 0.060, 0.153, { role: 'strut', g: out, ...fine })),
    box('locker latch', 0.140, 0.152, 0.0016, 0.100, 0.108, { role: 'strut', tint: CHROME, pk: 'bright', g: out, ...fine }),
    box('door handle', DOOR0 + 0.012, DOOR0 + 0.028, 0.0016, 0.144, 0.150, { role: 'strut', tint: CHROME, pk: 'bright', g: out, ...fine }),
    // Grab rails either side of the door, stood off the flank.
    ...[DOOR0 - 0.010, DOOR1 + 0.008].flatMap((f) => [
      box('grab rail', f - 0.003, f + 0.003, 0.003, 0.070, 0.164, { role: 'strut', paint: 'hazard', g: s * (W + 0.009) }),
      ...[0.074, 0.160].map((h) => box('grab standoff', f - 0.002, f + 0.002, 0.004, h - 0.003, h + 0.003, { role: 'strut', g: s * (W + 0.004), ...fine })),
    ]),
    // Two steps under the door, in the gap in the skirt.
    ...[0.026, 0.044].map((h) => box('step', 0.206, 0.274, 0.008, h, h + 0.004, { role: 'strut', paint: 'steel', g: s * (W + 0.010) })),
    box('step hanger', 0.206, 0.210, 0.006, 0.026, 0.050, { role: 'strut', g: s * (W + 0.008), ...fine }),
    box('step hanger', 0.270, 0.274, 0.006, 0.026, 0.050, { role: 'strut', g: s * (W + 0.008), ...fine }),
    // The skirt, deep and either side of the steps, with a light line along its top.
    box('skirt', 0.060, 0.204, 0.002, 0.018, 0.052, { role: 'strut', paint: 'steel', g: s * (W + 0.004) }),
    box('skirt', 0.276, 0.384, 0.002, 0.018, 0.052, { role: 'strut', paint: 'steel', g: s * (W + 0.004) }),
    box('skirt band', 0.060, 0.204, 0.0025, 0.018, 0.024, { role: 'body', paint: 'hazard', g: s * (W + 0.0045), ...fine }),
    box('skirt band', 0.276, 0.384, 0.0025, 0.018, 0.024, { role: 'body', paint: 'hazard', g: s * (W + 0.0045), ...fine }),
    box('skirt light', 0.064, 0.200, 0.0012, 0.047, 0.050, { role: 'window', tint: ACCENT, pk: 'glow', g: s * (W + 0.0065), ...fine }),
    box('skirt light', 0.280, 0.380, 0.0012, 0.047, 0.050, { role: 'window', tint: ACCENT, pk: 'glow', g: s * (W + 0.0065), ...fine }),
    // Side marker lamps, fore and aft.
    box('side marker', 0.372, 0.382, 0.0016, 0.124, 0.130, { role: 'window', tint: AMBER, g: out, ...fine }),
    box('side marker', 0.046, 0.056, 0.0016, 0.124, 0.130, { role: 'window', tint: AMBER, g: out, ...fine }),
    // The mirror: two arms off the door's front edge, a tall steel head, its glass facing aft, and a
    // spot mirror under it.
    ...[0.226, 0.298].map((h) => box('mirror arm', 0.334, 0.340, (0.026) / 2, h, h + 0.004, { role: 'strut', g: s * (gAt(h) + 0.013) })),
    box('mirror head', 0.326, 0.342, 0.006, 0.236, 0.296, { role: 'strut', paint: 'hazard', g: s * (W + 0.022) }),
    box('mirror glass', 0.324, 0.326, 0.0045, 0.240, 0.292, { role: 'glass', tint: [120, 140, 158], g: s * (W + 0.022), ...fine }),
    box('spot mirror', 0.328, 0.340, 0.005, 0.208, 0.228, { role: 'strut', paint: 'carbon', g: s * (W + 0.020), ...fine }),
    box('spot glass', 0.326, 0.328, 0.004, 0.211, 0.225, { role: 'glass', tint: [120, 140, 158], g: s * (W + 0.020), ...fine }),
  ];
});
// The back of the cab: a red light line across it (a hitched box hides it) and a hazard stripe at the foot.
const BACK_F = RBACK - 0.008;          // proud of the back wall, and still forward of the swing line
const back = [
  // A ladder up the middle to the roof, glad-hand posts either side of it, ribs across the wall and a
  // red lamp at each top corner.
  ...LR.map((s) => box('ladder rail', BACK_F, BACK_F + 0.006, 0.003, 0.096, RTOP - 0.004, { role: 'strut', g: s * 0.030 })),
  ...[0.120, 0.160, 0.200, 0.240, 0.280, 0.320].map((h) => box('ladder rung', BACK_F + 0.001, BACK_F + 0.005, 0.030, h, h + 0.004, { role: 'strut', paint: 'steel', ...fine })),
  ...LR.flatMap((s) => [
    box('glad-hand post', BACK_F + 0.002, RBACK, 0.008, 0.140, 0.170, { role: 'strut', paint: 'steel', g: s * 0.090, ...fine }),
    box('glad hand', BACK_F, BACK_F + 0.004, 0.006, 0.150, 0.160, { role: 'strut', tint: s < 0 ? [52, 92, 196] : [196, 52, 44], g: s * 0.090, ...fine }),
    box('back marker', RBACK - 0.003, RBACK, 0.008, RTOP - 0.016, RTOP - 0.008, { role: 'window', tint: RED, g: s * (gAt(RTOP) - 0.016), ...fine }),
  ]),
  ...[0.200, 0.250].map((h) => box('back rib', RBACK - 0.003, RBACK, W - 0.026, h, h + 0.004, { role: 'strut', ...fine })),

  box('tail light line', RBACK - 0.002, RBACK + 0.001, gAt(0.300) * 0.90, 0.296, 0.302, { role: 'window', tint: [214, 60, 48], ...fine }),
  box('back kick plate', RBACK - 0.002, RBACK + 0.001, W - 0.020, 0.052, 0.068, { role: 'body', paint: 'hazard', ...fine }),
];

// ── The roof ── An orange visor over the screen with the marker lamps along its lip, a light bar on
// two stalks behind it, a sleeper vent, twin air horns at the back corners and drip rails.
const VIS_F0 = SCR1 - CC - 0.006, VIS_F1 = SCR1 + 0.030;
const visT = (f) => ROOF + 0.002 - 0.008 * (f - VIS_F0) / (VIS_F1 - VIS_F0), visB = (f) => ROOF - 0.008 - 0.004 * (f - VIS_F0) / (VIS_F1 - VIS_F0);
const VIS_PLAN = [[VIS_F0, -(WT + 0.004)], [VIS_F1 - CC - 0.004, -(WT + 0.004)], [VIS_F1, -(WT - CC)], [VIS_F1, WT - CC], [VIS_F1 - CC - 0.004, WT + 0.004], [VIS_F0, WT + 0.004]];
const visor = solid('sun visor', [
  VIS_PLAN.map(([f, g]) => [f, g, visT(f)]), VIS_PLAN.map(([f, g]) => [f, g, visB(f)]),
  ...VIS_PLAN.map(([f, g], i) => { const [f2, g2] = VIS_PLAN[(i + 1) % VIS_PLAN.length]; return [[f, g, visT(f)], [f2, g2, visT(f2)], [f2, g2, visB(f2)], [f, g, visB(f)]]; }),
], { paint: 'hazard' });
const MARK_F = VIS_F1 - 0.006, MARK_Z = visT(MARK_F) + 0.0015;
const roof = [
  visor,
  box('visor lip light', VIS_F1, VIS_F1 + 0.002, (WT - CC) * 0.94, visB(VIS_F1) + 0.001, visT(VIS_F1) - 0.001, { role: 'window', tint: AMBER, ...fine }),
  ...[-2, -1, 0, 1, 2].map((i) => box('marker lamp', MARK_F - 0.004, MARK_F + 0.004, 0.008, visT(MARK_F) - 0.001, visT(MARK_F) + 0.004, { role: 'window', tint: AMBER, g: i * 0.058, ...fine })),
  // The light bar: a steel beam on two stalks, six LED pods in it, amber at the ends.
  ...LR.map((s) => box('light bar stalk', 0.330, 0.338, 0.004, ROOF, ROOF + 0.014, { role: 'strut', g: s * 0.110 })),
  box('light bar', 0.326, 0.344, WT * 0.84, ROOF + 0.014, ROOF + 0.028, { role: 'strut', paint: 'carbon' }),
  ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => box('light bar lamp', 0.344, 0.346, 0.0085, ROOF + 0.016, ROOF + 0.026, { role: 'window', tint: LED, g: i * 0.042, ...fine })),
  ...LR.map((s) => box('light bar end', 0.328, 0.346, 0.004, ROOF + 0.015, ROOF + 0.027, { role: 'window', tint: AMBER, g: s * (WT * 0.84 - 0.002), ...fine })),
  // The sleeper's vent and the hatch over the bunk.
  box('sleeper vent', 0.120, 0.190, 0.050, ROOF, ROOF + 0.012, { role: 'strut', paint: 'steel' }),
  ...[0.130, 0.145, 0.160, 0.175].map((f) => box('vent slat', f, f + 0.004, 0.044, ROOF + 0.012, ROOF + 0.014, { role: 'gear', ...fine })),
  box('roof hatch', 0.220, 0.270, 0.040, ROOF, ROOF + 0.004, { role: 'strut', paint: 'carbon', ...fine }),
  ...LR.map((s) => box('drip rail', RLIP + 0.004, SCR1 - CC - 0.004, 0.0016, ROOF - 0.006, ROOF - 0.002, { role: 'strut', g: s * (WT + 0.0015), ...fine })),
];
// Twin air horns on the back corners of the roof, bells forward.
const HORN_G = 0.118, HORN_H = ROOF + 0.016;
const horns = LR.flatMap((s) => [
  box('horn bracket', 0.060, 0.090, 0.008, ROOF, HORN_H - 0.004, { role: 'strut', g: s * HORN_G }),
  tubeF('air horn', 0.050, 0.088, s * HORN_G, HORN_H, 0.0055, { role: 'strut', paint: 'chrome' }),
  coneF('horn bell', 0.088, 0.106, s * HORN_G, HORN_H, 0.0055, 0.0125, { role: 'strut', paint: 'chrome' }),
  tubeF('horn mouth', 0.1055, 0.1065, s * HORN_G, HORN_H, 0.010, { role: 'gear', ...fine }),
  // The second, shorter horn of each pair, outboard.
  tubeF('air horn', 0.050, 0.074, s * (HORN_G + 0.022), HORN_H - 0.002, 0.0045, { role: 'strut', paint: 'chrome', ...fine }),
  coneF('horn bell', 0.074, 0.088, s * (HORN_G + 0.022), HORN_H - 0.002, 0.0045, 0.010, { role: 'strut', paint: 'chrome', ...fine }),
]);

// ── The stacks ── Twin titanium stacks on the back corners, a heat shield on each, a glowing tip.
const STACK_G = 0.164, STACK_F = CAB0 + 0.001, STACK_R = 0.011, STACK_TOP = 0.414;
const stacks = LR.flatMap((s) => [
  puck('exhaust stack', STACK_F, s * STACK_G, STACK_R, 0.078, STACK_TOP, { role: 'strut', paint: 'titanium' }, 10),
  puck('heat shield', STACK_F, s * STACK_G, STACK_R + 0.0025, 0.210, 0.330, { role: 'strut', paint: 'steel', ...fine }, 10),
  puck('stack cap', STACK_F, s * STACK_G, STACK_R + 0.0015, STACK_TOP - 0.008, STACK_TOP - 0.002, { role: 'strut', tint: CHROME, pk: 'bright', ...fine }, 10),
  puck('stack tip', STACK_F, s * STACK_G, STACK_R - 0.003, STACK_TOP - 0.001, STACK_TOP, { role: 'window', tint: [255, 150, 70], whenNot: 'parked', ...fine }, 10),
  ...[0.150, 0.360].map((h) => box('stack clamp', CAB0 - 0.002, CAB0 + 0.006, 0.004, h, h + 0.006, { role: 'strut', g: s * (STACK_G - 0.006), ...fine })),
]);

// ── The lift pads ── Four a side under the floor and the deck, heavy: a cast housing, a lit emitter
// ring (out when parked), a ring in the hazard colour, a hub, and an arm up into the frame for the
// pads aft of the cab. truck.pods gets one row each.
const PAD_R = 0.048, PAD_G = 0.098, PAD_Z0 = 0.012, PAD_Z1 = 0.034;
const PADS = [0.330, 0.200, -0.006, -0.112];
const pads = [], padRows = [];
for (const s of LR) for (const f of PADS) {
  const g = s * PAD_G;
  padRows.push([f, g, PAD_R, false, 0.024]);
  pads.push(puck('lift pad', f, g, PAD_R * 0.94, PAD_Z0 + 0.006, PAD_Z1, { role: 'gear', paint: 'gunmetal' }, 12));
  pads.push(puck('emitter ring', f, g, PAD_R, PAD_Z0, PAD_Z0 + 0.006, { role: 'window', tint: GLOW, whenNot: 'parked', ...fine }, 14));
  pads.push(puck('pad hub', f, g, PAD_R * 0.36, PAD_Z0 - 0.002, PAD_Z0 + 0.002, { role: 'gear', ...fine }, 8));
  pads.push(puck('pad ring', f, g, PAD_R * 0.97, PAD_Z1 - 0.006, PAD_Z1 - 0.002, { role: 'strut', tint: CHROME, pk: 'bright', ...fine }, 14));
  if (f < CAB0) pads.push(box('pad arm', f - 0.012, f + 0.012, 0.009, PAD_Z1, 0.050, { role: 'strut', g: g * 0.9 }));
}

// ── The chassis ── The old Continental's numbers: rails, deck plate, fifth wheel (the pin), tail lamps.
const chassis = [
  ...LR.map((s) => box('frame rail', FRAME0 - 0.01, 0.280, 0.016, 0.028, 0.072, { role: 'strut', g: s * 0.110 })),
  box('deck plate', FRAME0, CAB0 + 0.020, W * 0.80, 0.050, 0.070),
  // Grip strips across the bare deck aft of the fifth wheel.
  ...[-0.150, -0.140, -0.130].map((f) => box('deck grip', f - 0.002, f + 0.002, W * 0.74, 0.070, 0.072, { role: 'strut', ...fine })),
  box('fifth wheel', PIN0, PIN1, 0.110, 0.070, 0.082, { role: 'strut' }),
  box('coupling ring', (PIN0 + PIN1) / 2 - 0.022, (PIN0 + PIN1) / 2 + 0.022, 0.022, 0.082, 0.085, { role: 'window', tint: ACCENT, pk: 'glow', whenNot: 'trailer', ...fine }),
  // The air lines, coiled flat on the deck ahead of the fifth wheel: red supply, blue service.
  ...[[0.012, [196, 52, 44]], [-0.002, [52, 92, 196]]].map(([f, c]) => box('air line', f - 0.005, f + 0.005, 0.050, 0.070, 0.076, { role: 'window', tint: c, ...fine })),
  ...LR.map((s) => box('tail lamp', FRAME0 - 0.012, FRAME0 - 0.004, 0.016, 0.052, 0.070, { role: 'window', tint: RED, g: s * W * 0.66 })),
  box('plate light', FRAME0 - 0.011, FRAME0 - 0.004, W * 0.30, 0.074, 0.080, { role: 'window', tint: [230, 210, 140], ...fine }),
  box('tail stripe', FRAME0 - 0.002, FRAME0 + 0.000, W * 0.78, 0.054, 0.068, { role: 'body', paint: 'hazard', ...fine }),
  // Saddle tanks behind the cab, low enough for the box to swing over them.
  ...LR.flatMap((s) => [
    box('saddle tank', -0.052, 0.032, 0.026, 0.038, 0.080, { role: 'strut', paint: 'titanium', g: s * 0.146 }),
    ...[-0.040, 0.018].map((f) => box('tank strap', f - 0.003, f + 0.003, 0.027, 0.037, 0.081, { role: 'strut', paint: 'carbon', ...fine, g: s * 0.146 })),
    box('filler cap', 0.000, 0.010, 0.006, 0.080, 0.084, { role: 'strut', tint: CHROME, pk: 'bright', g: s * 0.160, ...fine }),
    // A mud flap behind the rear pads, with the hazard colour across its foot.
    box('mud flap', FRAME0 + 0.001, FRAME0 + 0.004, 0.040, 0.010, 0.066, { role: 'strut', paint: 'rubber', g: s * 0.110 }),
    box('flap band', FRAME0 - 0.0005, FRAME0 + 0.001, 0.040, 0.014, 0.024, { role: 'body', paint: 'hazard', g: s * 0.110, ...fine }),
  ]),
];

// ── Fittings ── From scripts/shapes/truck-fittings.mjs, off this body's anchors. The stock
// Continental's, moved where this body differs: the screen guards onto the upright screen, the mascot
// onto the cowl ahead of it, the roof kit between the horns and the light bar (one roof fitting at a
// time, so they only have to clear the body), the stack kit onto these stacks. The halos are this
// file's own, on the pads.
const SD = 0.010;
const BEACON_F = 0.236, MASCOT_F = 0.398;
const A = {
  ...vintageAnchors(ROW, []),
  roofZ: ROOF,
  scrW: 1,
  scrP: (t, gf) => { const h = SG0 + 0.004 + (SG1 - SG0 - 0.008) * t, e = edge(1, h, 0); return [e[0] + SN[0] * SD, gf * e[1] * 0.96, h + SN[1] * SD]; },
  mascot: [MASCOT_F, cowlAt(MASCOT_F)],
  lightBarF: 0.290, beaconF: BEACON_F, totemF: 0.122, aerialF: 0.126,
  cage: [0.310, 0.114], parapet: [0.310, 0.114],
  stacks: [-STACK_G, STACK_G], stackF: STACK_F, stackTop: STACK_TOP,
};
// Six places are plenty in a file someone may read; the sums leave sixteen.
const tidy = (v, k) => (typeof v === 'number' ? (k === 'tint' ? v : r6(v)) : Array.isArray(v) ? v.map((x) => tidy(x, k))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, tidy(x, kk === 'tint' ? 'tint' : k)])) : v);
const kit = truckFittingParts(A).filter((p) => p.when !== 'fit_hl').map((p) => tidy(p));
// Lifter halos: a lit plate on each tractor pad.
const halos = padRows.map(([f, g]) => box('Lifter Halos', f - PAD_R - 0.004, f + PAD_R + 0.004, PAD_R + 0.004, PAD_Z1, PAD_Z1 + 0.003, { role: 'window', tint: ACCENT, pk: 'glow', g, when: 'fit_hl' }));

const tractor = [lower, cabin, ...glassSide, ...screenFrame, ...grille, ...lamps, ...bumper, ...flank, ...back, ...roof, ...horns, ...stacks, ...pads, ...chassis];
const trailer = BASE.parts.find((p) => p.name === 'trailer');
const doc = {
  id: 'truck_continental_2076',
  kind: 'mesh',
  params: {
    name: 'Orlov Continental 2076',
    note: 'The Continental after the Bulwark HX (docs/proposals/hover-rigs.md). Written by scripts/shapes/concepts/continental-2076.mjs from mesh_truck_continental.json; edit that, not this. '
      + 'Same channels as the stock file: trailer (+t), parked (~p), fit_<code> (^code).',
    // Surfaces (gl/solids.js `tex`). The body follows the booth's base colour and flash, the hazard
    // panels its trim colour; the rest are fixed.
    paints: {
      body: { rgb: [74, 79, 87], livery: 'base', tex: 'paint', note: 'the cab: the booth colour (gunmetal at the factory)' },
      hazard: { rgb: [232, 115, 28], livery: 'trim', tex: 'paint', note: 'visor, chevrons, skirt band, kick plate: the booth trim colour (hazard orange at the factory)' },
      carbon: { rgb: [30, 32, 36], livery: 'fixed', mat: 'satin', tex: 'carbon', note: 'rocker, grille recess, screen frame, light bar, mirror heads' },
      steel: { rgb: [96, 101, 110], livery: 'fixed', mat: 'steel', tex: 'cast', note: 'bumper, slats, lamp pods, skirt, steps, vent, heat shields' },
      titanium: { rgb: [166, 170, 178], livery: 'fixed', mat: 'bare', tex: 'brushed', note: 'stacks and saddle tanks' },
      chrome: { rgb: [214, 220, 228], livery: 'fixed', mat: 'bare', tex: 'brushed', note: 'the air horns' },
      rubber: { rgb: [28, 29, 31], livery: 'fixed', mat: 'satin', tex: 'rubber', note: 'mud flaps and the bumper rail' },
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
writeFileSync(new URL('../../../content/vehicle_models/mesh_truck_continental_2076.json', import.meta.url), formatMesh(doc));
// The stock file names its edition.
if (BASE.variants?.['2076'] !== 'truck_continental_2076') {
  BASE_DOC.params = { ...BASE, variants: { ...(BASE.variants || {}), 2076: 'truck_continental_2076' } };
  writeFileSync(BASE_URL, formatMesh(BASE_DOC));
}
const n1 = compileMesh(doc.params, { detail: 1 }).faces.length, n0 = compileMesh(doc.params, { detail: 0 }).faces.length;
console.log('mesh_truck_continental_2076.json:', n1, 'faces near,', n0, 'far (every state)');
