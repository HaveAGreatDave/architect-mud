// THE CARCASS'S COCKPIT: the inside of the wreck you bought, as geometry.
//
// The Carcass is found in a field and rebuilt by whoever found it, so its cockpit is a single-seat
// open tub with somebody else's parts bolted into it. Most of the panel is holes. What's left works,
// and what doesn't work has been taped until it looks like it might. Every control still moves: the
// stick is scaffold pipe, the throttle is a doorknob, the flap lever is a car's handbrake, the rudder
// bar is a length of four-by-two with the straps off a pair of sandals, and the fuel gauge is a wine
// cork on a wire, which is how the aircraft it most resembles did it from the factory.
//
// ── THE REAL THING IT'S MODELLED ON ──────────────────────────────────────────
//
// There's no real Carcass, so the analogue is the aircraft its shape most nearly is: a Bowers Fly
// Baby, the single-seat open-cockpit homebuilt every rebuilder has half of in a barn. What was taken
// from it, and from people who have dragged long-stored homebuilts back into the air:
//   https://en.wikipedia.org/wiki/Bowers_Fly_Baby   — length 5.74 m, single seat, open cockpit
//   http://www.bowersflybaby.com/                    — inside width about 22.5 in (0.57 m); a square
//       military windscreen; panel: compass right, two mag switches and oil pressure left, oil temp
//       and tach below them, altimeter top centre with the ASI left and the VSI right, the slip
//       indicator under the panel; a cork-and-wire float fuel gauge through the decking
//   https://www.kitplanes.com/restoring-a-stored-homebuilt/ — what a long-stored homebuilt actually
//       comes out of storage with: perished fuel line, a fuel gauge that lies, dead mags, perished
//       panel mounts, chewed fabric, cracked terminals
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S BODY TUBE, NEVER A SECOND DESCRIPTION OF IT ──
//
// `MESH_ROWS.wreck` has one body part: a loft of seven twelve-sided rings from the nose point to the
// tail point. The room reads those rings straight off the faces, interpolates between them exactly
// as the exterior's own quads do, and insets them by one wall thickness. So the walls you sit between
// are the tube you can see from outside, facet for facet, and editing the mesh moves the room.
//
// ONE SCALE: the Fly Baby is 5.74 m long and the body loft is 2.10 units nose to tail, so
// `M_PER_UNIT = 5.74 / 2.10 = 2.733 m`. At that scale the tube is 0.656 m across outside; less a
// 40 mm wall (skin, stringer and lining), measured across the twelve-sided section, that's 0.566 m
// inside, against the real aircraft's 0.57.
// Nobody fitted that: the two numbers came out of different places and agreed.
//
// ⚠ THE EXTERIOR HAS NO GLASS AND NO HOLE. The mesh carries body, wing, stab and nacelle roles only
// (buildWreck strips `glass`/`window` on purpose), so there is no rim to cut the cockpit along, the
// way the Drake cuts its eyes along the eye glass. The opening here is therefore the one decision
// the exterior can't make: an open cockpit cut through the upper arc of the tube, fore and aft
// stations stated below in model units, the sill at a stated fraction of the section's own height.
// What it's cut OUT of is still the exterior tube. The windscreen is a person-scale fitting.
//
// What is NOT derived is anything about a PERSON (the boat file's split): how tall a sitting eye
// is, how wide a seat is, how long a lever is, how big a dial is. Those are honest metres.
//
// Pure, like the rest of the interior: no clock, no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { hotspotHalo, contactShadow } from './interior-cockpit-kit.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

// ── THE NUMBERS ──────────────────────────────────────────────────────────────
export const CARCASS = {
  realLengthM: 5.74,       // Bowers Fly Baby, nose to tail
  wallM: 0.040,            // skin + stringer + what's left of the lining
  // ── the exterior-side decisions, in model units along the body (f is +forward) ──
  eyeF: -0.02,             // the pilot's station: at the widest ring, as in the real aircraft
  open: [-0.20, 0.14],     // the cockpit opening, aft and forward edges
  sillFrac: 0.55,          // the sill, as a fraction of the way from the section centre to the crown
  back: -0.28,             // the plywood bulkhead behind the seat
  panelF: 0.17,            // the instrument panel, 0.52 m ahead of the eye
  glare: -0.11,            // the glareshield's back edge, below the eye (metres): 14° down
  cheekX: 0.27, cheekZ: -0.30,   // the cheek boards: just inside the sill, up to shoulder height
  fire: 0.46,              // the firewall
  skinAft: -0.60,          // how far aft the outside skin is drawn (what you see over your shoulder)
  // ── a person ──
  floorBoardM: 0.070,      // the floorboards sit on bearers across the round belly, this far up it: low
                           // enough to keep the eye over the sill, high enough for a floor two feet wide
  eyeOverFloorM: 0.89,     // seat cushion 0.10 + a seated eye 0.79 over it
};

// ── MATERIALS ────────────────────────────────────────────────────────────────
// Zinc chromate inside (every aircraft is this yellow-green on the inside, and this one mostly still
// is), bare aluminium where it's been sanded, and rust where the steel bits have been left out.
const M = {
  chromate: [132, 146, 72], chromateDk: [104, 116, 58], alu: [150, 154, 156], aluDk: [112, 116, 120],
  rust: [124, 64, 30], rustDk: [86, 42, 22], ply: [150, 118, 76], plyDk: [112, 86, 54], plyRot: [74, 60, 44],
  steel: [96, 100, 104], firewall: [120, 122, 118], soot: [34, 30, 28],
  // Three donor aircraft, three paint jobs, none of them finished.
  red: [142, 54, 42], grey: [118, 120, 116], blue: [58, 80, 112], cream: [196, 186, 160],
  vinyl: [44, 34, 30], vinylHi: [70, 56, 48], foam: [214, 190, 110], tape: [150, 152, 150], gaffer: [30, 30, 32],
  orange: [226, 108, 30], webbing: [40, 44, 52], rubberRed: [170, 40, 36], glove: [230, 196, 50],
  brass: [182, 146, 74], wood2x4: [176, 142, 94], cork: [176, 128, 80], leaf: [60, 168, 84],
  scaffold: [128, 132, 136], clamp: [80, 84, 88], panelGrey: [70, 72, 70], hole: [8, 8, 9],
  wireR: [180, 40, 32], wireY: [210, 180, 40], wireB: [30, 30, 34], wireW: [200, 200, 196],
  plyPaint: [96, 104, 86], vinylRoll: [52, 40, 34],
  paper: [214, 206, 180], plate: [220, 214, 170], shade: [0, 0, 2],
  bulbOn: [255, 226, 160], lamp: [255, 240, 200],
};
// See-through things are by colour identity: a shard of perspex, a contact shadow.
PANE.set(M.shade, 0.22);
SHINY.set(M.brass, { spec: 0.7, pow: 20, ramp: [[80, 58, 22], [240, 208, 130]], glint: 0.25, albedo: [240, 200, 130], envK: 0.5 });
SHINY.set(M.scaffold, { spec: 0.45, pow: 14, ramp: [[56, 60, 64], [200, 204, 208]], glint: 0.1, albedo: [220, 224, 228], envK: 0.4 });
SHINY.set(M.alu, { spec: 0.35, pow: 10 });
SHINY.set(M.tape, { spec: 0.4, pow: 8 });
// Marker ink for the hand-lettered labels: two pens, neither of them new.
const INK = { blue: [34, 40, 92], black: [26, 24, 24] };
// Surface texture, by the same colour identity (interior-kit.js TEXTURE). Lamps, dial faces, the
// perspex and the phone's screen are deliberately left out: they're light, not surface.
for (const [kind, keys] of Object.entries({
  paint: ['chromate', 'chromateDk', 'red', 'grey', 'blue', 'cream', 'panelGrey', 'plate'],
  brushed: ['alu', 'aluDk', 'brass', 'tape'],
  cast: ['rust', 'rustDk', 'steel', 'clamp', 'firewall', 'scaffold', 'soot'],
  wood: ['ply', 'plyDk', 'plyRot', 'plyPaint', 'wood2x4', 'cork'],
  leather: ['vinyl', 'vinylHi', 'vinylRoll'],
  fabric: ['foam', 'gaffer', 'orange', 'webbing'],
  rubber: ['rubberRed', 'glove'],
})) for (const k of keys) TEXTURE.set(M[k], kind);
const PATCH = { spec: 0.3, pow: 12 };
const GRAIN = { grain: 0.18 }, GRAIN_HI = { grain: 0.3 }, SHEEN = { spec: 0.25, pow: 10, grain: 0.1 };

// ── THE BODY TUBE, READ OFF THE EXTERIOR ─────────────────────────────────────
//
// Each face of the body loft joins two rings; the rings are recovered by grouping the vertices by
// station and sorting them round their own centre. ⚠ THE SEAM OF THE SORT IS 15° OFF THE BOTTOM:
// the ring's vertices sit at 30° steps from the flank, so a seam on the flank (atan2's own ±π) lands
// exactly on a vertex and flips it between stations on a rounding error.
export function bodyRings(doc = MESH_ROWS.wreck) {
  const body = doc && doc.parts && doc.parts.find((p) => p.faces && p.faces.some((f) => f.role === 'body'));
  if (!body) return null;
  const by = new Map();
  for (const fc of body.faces) for (const v of fc.p) {
    const k = v[0].toFixed(5);
    if (!by.has(k)) by.set(k, { f: v[0], pts: [] });
    const s = by.get(k);
    if (!s.pts.some((q) => Math.abs(q[0] - v[1]) < 1e-9 && Math.abs(q[1] - v[2]) < 1e-9)) s.pts.push([v[1] + 0, v[2]]);
  }
  const st = [...by.values()].sort((a, b) => a.f - b.f);
  const N = Math.max(...st.map((s) => s.pts.length));
  for (const s of st) {
    const c = s.pts.reduce((a, q) => [a[0] + q[0] / s.pts.length, a[1] + q[1] / s.pts.length], [0, 0]);
    s.c = c;
    const key = (q) => { const a = Math.atan2(q[1] - c[1], q[0] - c[0]) + Math.PI / 2 - Math.PI / 12; return ((a % TAU) + TAU) % TAU; };
    s.pts.sort((a, b) => key(a) - key(b));
    if (s.pts.length < N) s.pts = Array.from({ length: N }, () => s.pts[0].slice());
  }
  return { st, N, length: st[st.length - 1].f - st[0].f };
}

// The exterior ring at station f, as the loft's own quads would give it (linear between rings),
// subdivided once along each facet so the room reads smoother than 12 sides without leaving them.
function ringAt(T, f) {
  const st = T.st;
  let i = 0;
  while (i < st.length - 2 && st[i + 1].f < f) i++;
  const a = st[i], b = st[i + 1], t = clamp((f - a.f) / (b.f - a.f), 0, 1);
  const c = [lerp(a.c[0], b.c[0], t), lerp(a.c[1], b.c[1], t)];
  const raw = a.pts.map((p, j) => [lerp(p[0], b.pts[j][0], t), lerp(p[1], b.pts[j][1], t)]);
  const pts = [];
  for (let j = 0; j < raw.length; j++) { const p = raw[j], q = raw[(j + 1) % raw.length]; pts.push(p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); }
  return { c, pts };
}
// Pushed in by `w` toward the ring's centre: the inside of the skin.
const insetRing = (R, w) => R.pts.map((p) => {
  const dx = p[0] - R.c[0], dy = p[1] - R.c[1], l = Math.hypot(dx, dy) || 1;
  const s = Math.max(0, 1 - w / l);
  return [R.c[0] + dx * s, R.c[1] + dy * s];
});
// Where a closed ring crosses the horizontal h = k: every crossing, as g.
function crossings(pts, k) {
  const out = [];
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j], q = pts[(j + 1) % pts.length];
    if ((p[1] - k) * (q[1] - k) < 0) out.push(lerp(p[0], q[0], (k - p[1]) / (q[1] - p[1])));
  }
  return out.sort((a, b) => a - b);
}
// Keep the part of a polygon where s(q) >= 0.
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]); }
  }
  return out;
}
// Newell: a polygon's normal from all its corners, so a clipped sliver still answers (or says it has no area).
function newell(p) { let x = 0, y = 0, z = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]); } return [x, y, z]; }
const centroid = (pts) => mul(pts.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / pts.length);

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function carcassProfile(doc = MESH_ROWS.wreck) {
  const T = bodyRings(doc);
  if (!T) return null;
  const K0 = CARCASS;
  const m = K0.realLengthM / T.length;         // metres per model unit — see the header
  const w = K0.wallM / m;
  // The floor: the inside of the belly at the eye station, plus the boards.
  const eyeRing = insetRing(ringAt(T, K0.eyeF), w);
  const hBelly = Math.min(...eyeRing.map((p) => p[1]));
  const hFloor = hBelly + K0.floorBoardM / m;
  const hE = hFloor + K0.eyeOverFloorM / m;
  const X = (g) => g * m, Y = (f) => (f - K0.eyeF) * m, Z = (h) => (h - hE) * m;
  const eyeR = ringAt(T, K0.eyeF);
  const crown = Math.max(...eyeR.pts.map((p) => p[1]));
  const hSill = eyeR.c[1] + K0.sillFrac * (crown - eyeR.c[1]);
  const G = { T, m, w, X, Y, Z, hE, hFloor, hSill, floorZ: Z(hFloor), sillZ: Z(hSill) };
  const room = buildRoom(G);
  // ⚠ THE BOUNDS TAKE IN THE FIT-OUT AT REST AS WELL AS THE ROOM: the roll bar and the windscreen
  // stand above the tube, and an open cockpit's highest surface is a piece of scaffolding.
  const probe = { carcass: { ...G, faces: [], panel: room.panel, panelY: room.panelY, panelTop: room.panelTop, deckAt: room.deckAt, glareZ: room.glareZ, glareY: room.glareY }, seatZ: G.floorZ + 0.10, seatHalf: 0.18, seatY: [-0.40, 0.02] };
  const fitFaces = [];
  carcassFit(probe, {}, (fs2) => { for (const f of fs2) fitFaces.push(f); });

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of [...room.faces, ...fitFaces]) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const halfW = Math.max(-x0, x1) + 0.01;
  const winY = [Y(K0.open[0]), Y(K0.open[1])];
  const P = {
    label: 'Carcass open tub',
    xCentre: 0, halfW,
    floor: Math.min(z0, G.floorZ) - 1e-6, roof: z1 + 0.01, front: y1 + 0.01, back: y0 - 0.01,
    // ── measured off the tube ──
    dashY: room.panelY, dashZ: room.panelTop,
    winY, winZ: [CARCASS.cheekZ, 0.20],
    // ⚠ THE WHOLE OPENING IS SKY, so the roof check goes the other way: straight up must be clear.
    roofGlass: winY,
    // ── a person, in metres ──
    seatZ: G.floorZ + 0.10, seatHalf: 0.18, seatY: [-0.40, 0.02], backZ: -0.38,
    seats: 1, centrePost: 0, pillarW: 0.02, headerZ: -0.04,
    fit: 'carcass', craft: 'carcass',
    normalLit: true,
    // A bicycle lamp cable-tied under the coaming, and the bulb on a wire off the roll bar.
    floods: [{ p: [0, room.panelY - 0.10, room.panelTop - 0.03], r: 0.42 }, { p: [0.06, -0.44, 0.08], r: 0.35 }],
    room: carcassShell,
    carcass: { ...G, faces: room.faces, panel: room.panel, panelY: room.panelY, panelTop: room.panelTop, deckAt: room.deckAt, glareZ: room.glareZ, glareY: room.glareY, skinTopAt: room.skinTopAt, wallAt: room.wallAt },
    hotspots(live) { return carcassHotspots(this, live); },
  };
  // The glass: not in shellFaces, drawn by the renderer after the room. Static, so built once.
  P.glass = carcassGlass(P.carcass);
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
//
// Static: built once per profile and kept, so the per-frame cost is the fit-out alone.
function buildRoom(G) {
  const { T, w, X, Y, Z, floorZ, sillZ } = G;
  const K0 = CARCASS;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis, mat) => faces.push({ p, n, tone, k, rgb, emis: emis || 0, mat });
  const S = (f, q) => [X(q[0]), Y(f), Z(q[1])];
  const [fO0, fO1] = K0.open;
  // Grid stations: the opening's edges are grid lines, so no wall quad straddles one.
  const lin = (a, b, n) => Array.from({ length: n }, (_, i) => lerp(a, b, i / n));
  const fs = [...lin(K0.back, fO0, 5), ...lin(fO0, fO1, 18), ...lin(fO1, K0.fire, 14), K0.fire];
  const inOpen = (f0, f1) => f0 >= fO0 - 1e-9 && f1 <= fO1 + 1e-9;
  const inner = fs.map((f) => { const R = ringAt(T, f); return { f, c: R.c, pts: insetRing(R, w) }; });
  const NA = inner[0].pts.length;

  // ── THE WALLS: the inside of the tube, zinc chromate going to rust ──
  for (let i = 0; i < fs.length - 1; i++) {
    const A = inner[i], B = inner[i + 1], open = inOpen(A.f, B.f);
    for (let j = 0; j < NA; j++) {
      const jj = (j + 1) % NA;
      let poly = [S(A.f, A.pts[j]), S(B.f, B.pts[j]), S(B.f, B.pts[jj]), S(A.f, A.pts[jj])];
      poly = clipHalf(poly, (q) => q[2] - floorZ);
      if (open) poly = clipHalf(poly, (q) => sillZ - q[2]);
      if (poly.length < 3) continue;
      // A wall cell the floor clip has flattened into the floor's own plane is a second floor, and it
      // z-fights the boards; the boards are the floor.
      if (Math.max(...poly.map((q) => q[2])) < floorZ + 0.004) continue;
      const ctr = centroid(poly);
      const mid = S((A.f + B.f) / 2, [(A.c[0] + B.c[0]) / 2, (A.c[1] + B.c[1]) / 2]);
      const nw = newell(poly); if (Math.hypot(...nw) < 1e-8) continue;
      let n = norm(nw);
      if (dot(n, sub(mid, ctr)) < 0) n = mul(n, -1);
      // Chromate, a sanded patch of bare metal, and rust that blooms round the lower wall where the
      // water sat for however many years it sat there.
      const hs = hash(i, j), low = ctr[2] < floorZ + 0.22;
      const rgb = hs < (low ? 0.34 : 0.10) ? (hs < 0.08 ? M.rustDk : M.rust) : hs > 0.86 ? M.alu : ((i + j) & 1 ? M.chromate : M.chromateDk);
      put(poly, n, 'pil', -0.05, rgb, 0, GRAIN_HI);
    }
  }

  // ── THE FORMERS AND STRINGERS: the structure the lining used to hide ──
  const formers = [-0.24, -0.10, 0.02, 0.14, 0.26, 0.38];
  const Kr = makeKit((fs2, tone, k, fwd, rgb, emis) => { for (const f of fs2) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const ok = (q, f) => q[2] > floorZ + 0.01 && (!(f > fO0 && f < fO1) || q[2] < sillZ - 0.02);
  for (const f of formers) {
    const R = ringAt(T, f), pts = insetRing(R, w + 0.012 / G.m);
    for (let j = 0; j < pts.length; j++) {
      const a = S(f, pts[j]), b = S(f, pts[(j + 1) % pts.length]);
      if (!ok(a, f) || !ok(b, f)) continue;
      Kr.rod(a, b, 0.009, 'post', -0.1, j % 5 === 0 ? M.aluDk : M.alu, 0, 4, false);
      // A rivet at every other joint, where the skin is fastened to the former.
      if (j % 2 === 0) {
        const c2 = S(f, R.c), nIn = norm(sub(c2, a));
        const u = norm(cross(nIn, [0, 1, 0])), v2 = cross(u, nIn), r = 0.005, p0 = add(a, mul(nIn, 0.004));
        put([add(p0, mul(u, r)), add(p0, mul(v2, r)), add(p0, mul(u, -r)), add(p0, mul(v2, -r))], nIn, 'post', 0.2, M.alu);
      }
    }
  }
  for (const j of [2, 6, 10, 14, 18, 22]) {
    for (let i = 0; i < fs.length - 1; i++) {
      const A = inner[i], B = inner[i + 1];
      const cA = A.pts[j], cB = B.pts[j];
      const pull = (p, c) => { const d = [c[0] - p[0], c[1] - p[1]], l = Math.hypot(d[0], d[1]) || 1; return [p[0] + d[0] / l * (0.01 / G.m), p[1] + d[1] / l * (0.01 / G.m)]; };
      const a = S(A.f, pull(cA, A.c)), b = S(B.f, pull(cB, B.c));
      if (!ok(a, A.f) || !ok(b, B.f)) continue;
      Kr.rod(a, b, 0.006, 'post', -0.15, M.aluDk, 0, 4, false);
    }
  }

  // ── THE FLOOR: three plywood boards, one of them with a hole rusted through it ──
  // The hole is over the left footwell. Half of it is covered with a licence plate. The other half
  // is how you check the runway is still there.
  const floorHalf = (f) => { const xs = crossings(insetRing(ringAt(T, f), w), G.hFloor); return xs.length >= 2 ? [X(xs[0]), X(xs[xs.length - 1])] : [0, 0]; };
  const hole = { y0: 0.60, y1: 0.80, x0: -0.20, x1: -0.07 };
  const fl = [...lin(K0.back, K0.fire, 28), K0.fire];
  for (let i = 0; i < fl.length - 1; i++) {
    const [a0, b0] = floorHalf(fl[i]), [a1, b1] = floorHalf(fl[i + 1]);
    const y0 = Y(fl[i]), y1 = Y(fl[i + 1]);
    for (let k = 0; k < 3; k++) {
      const t0 = k / 3, t1 = (k + 1) / 3;
      const q = [[lerp(a0, b0, t0), y0], [lerp(a0, b0, t1), y0], [lerp(a1, b1, t1), y1], [lerp(a1, b1, t0), y1]];
      const cy = (y0 + y1) / 2, cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
      if (cy > hole.y0 && cy < hole.y1 && cx > hole.x0 && cx < hole.x1) continue;
      const rot = hash(i, k + 7) < 0.18;
      put(q.map(([x, y]) => [x, y, floorZ]), [0, 0, 1], 'floor', -0.2, rot ? M.plyRot : (k & 1 ? M.ply : M.plyDk), 0, GRAIN);
    }
  }

  // ── THE ENDS: the plywood bulkhead behind the seat, and the firewall ahead of your feet ──
  const cap = (f, nY, rgb, tone) => {
    let poly = insetRing(ringAt(T, f), w).map((q) => S(f, q));
    poly = clipHalf(poly, (q) => q[2] - floorZ);
    if (poly.length >= 3) put(poly, [0, nY, 0], tone, -0.1, rgb, 0, GRAIN);
    return poly;
  };
  cap(K0.back, 1, M.plyDk, 'post');
  cap(K0.fire, -1, M.firewall, 'post');
  // Oil on the firewall, from a leak nobody has found because nobody has looked.
  const yF = Y(K0.fire) - 0.004;
  for (const [x, z, r] of [[0.05, floorZ + 0.22, 0.09], [-0.08, floorZ + 0.12, 0.06], [0.12, floorZ + 0.35, 0.04]]) {
    const pts = Array.from({ length: 12 }, (_, i) => { const t = (i / 12) * TAU; return [x + Math.cos(t) * r, yF, z + Math.sin(t) * r * 1.4]; });
    put(pts, [0, -1, 0], 'post', -0.3, M.soot);
  }

  // ── THE OPENING: the cut edge of the skin, and a coaming roll round it ──
  // The rim path: the left sill forward, across the front arc, the right sill aft, across the back.
  const sillPts = (side) => fs.filter((f) => f >= fO0 - 1e-9 && f <= fO1 + 1e-9).map((f) => {
    const R = ringAt(T, f), xs = crossings(insetRing(R, w), G.hSill), xo = crossings(R.pts, G.hSill);
    return { f, i: side < 0 ? xs[0] : xs[xs.length - 1], o: side < 0 ? xo[0] : xo[xo.length - 1] };
  });
  const arc = (f) => {
    // The inner ring above the sill, from the right crossing over the crown to the left one.
    const R = ringAt(T, f), pts = insetRing(R, w), xs = crossings(pts, G.hSill);
    const top = pts.filter((p) => p[1] > G.hSill).sort((a, b) => b[0] - a[0]);
    return [[xs[xs.length - 1], G.hSill], ...top, [xs[0], G.hSill]].map((q) => S(f, q));
  };
  const L = sillPts(-1), Rt = sillPts(1);
  // The reveal: the skin's own thickness along the sill, faced up.
  for (const side of [L, Rt]) for (let k = 0; k < side.length - 1; k++) {
    const a = side[k], b = side[k + 1];
    put([[X(a.i), Y(a.f), sillZ], [X(b.i), Y(b.f), sillZ], [X(b.o), Y(b.f), sillZ], [X(a.o), Y(a.f), sillZ]], [0, 0, 1], 'pil', 0.2, M.alu);
  }
  const front = arc(fO1), rear = arc(fO0);
  const rim = [...L.map((s) => [X(s.i), Y(s.f), sillZ]), ...front.slice().reverse(), ...Rt.slice().reverse().map((s) => [X(s.i), Y(s.f), sillZ]), ...rear];
  // The coaming roll: leather, split in places and gaffer-taped where it split.
  for (let k = 0; k < rim.length; k++) {
    const a = rim[k], b = rim[(k + 1) % rim.length];
    if (Math.hypot(...sub(b, a)) < 1e-4) continue;
    const up = (q) => [q[0] * 0.985, q[1], q[2] + 0.012];
    const hs = hash(k, 3);
    Kr.rod(up(a), up(b), 0.016, 'pil', 0.05, hs < 0.14 ? M.gaffer : hs < 0.22 ? M.foam : M.vinyl, 0, 6, false);
  }

  // ── THE OUTSIDE: the top of the tube you look out over, in three donors' paint ──
  // The upper half of the exterior ring, drawn as the exterior draws it (no inset), from the nose
  // back to over your shoulder, minus the opening. What you see over the windscreen is the nose.
  const outF = [...lin(K0.skinAft, fO0, 6), ...lin(fO0, fO1, 12), ...lin(fO1, 0.693, 10), ...lin(0.693, T.st[T.st.length - 1].f, 3), T.st[T.st.length - 1].f];
  const outer = outF.map((f) => ({ f, R: ringAt(T, f) }));
  for (let i = 0; i < outF.length - 1; i++) {
    const A = outer[i], B = outer[i + 1], open = inOpen(A.f, B.f);
    const paint = A.f < fO0 ? M.blue : A.f < 0.30 ? M.red : M.grey;
    for (let j = 0; j < A.R.pts.length; j++) {
      const jj = (j + 1) % A.R.pts.length;
      let poly = [S(A.f, A.R.pts[j]), S(B.f, B.R.pts[j]), S(B.f, B.R.pts[jj]), S(A.f, A.R.pts[jj])];
      poly = clipHalf(poly, (q) => q[2] - Z(A.R.c[1]));
      if (open) poly = clipHalf(poly, (q) => sillZ - q[2]);
      if (poly.length < 3) continue;
      const ctr = centroid(poly), mid = S((A.f + B.f) / 2, [(A.R.c[0] + B.R.c[0]) / 2, (A.R.c[1] + B.R.c[1]) / 2]);
      const nw = newell(poly); if (Math.hypot(...nw) < 1e-8) continue;
      let n = norm(nw);
      if (dot(n, sub(ctr, mid)) < 0) n = mul(n, -1);
      const hs = hash(i + 40, j);
      put(poly, n, 'pil', 0.1, hs < 0.12 ? M.alu : hs < 0.18 ? M.cream : paint, 0, SHEEN);
      // A patch: a square of road sign riveted over whatever was there, three millimetres proud.
      if (hs > 0.93 && poly.length === 4) {
        const c = centroid(poly), pp = poly.map((q) => add(add(c, mul(sub(q, c), 0.8)), mul(n, 0.003)));
        put(pp, n, 'pil', 0.15, (i + j) & 1 ? C.yellow : M.plate, 0, PATCH);
        for (const q of pp) { const r = add(add(c, mul(sub(q, c), 0.86)), mul(n, 0.0045)), u = norm(sub(q, c)), v2 = norm(cross(n, u)), e = 0.004;
          put([add(r, mul(u, e)), add(r, mul(v2, e)), add(r, mul(u, -e)), add(r, mul(v2, -e))], n, 'pil', 0.3, M.alu); }
      }
    }
  }

  // ── THE INSTRUMENT PANEL: a board filling the section under the decking ──
  const fP = K0.panelF, yP = Y(fP);
  let pb = insetRing(ringAt(T, fP), w).map((q) => S(fP, q));
  pb = clipHalf(pb, (q) => q[2] - Math.max(floorZ, -0.74));
  pb = pb.map((q) => [q[0] * 0.985, yP, q[2] > 0 ? q[2] : q[2] - 0.004]);
  put(pb, [0, -1, 0], 'dash', 0.05, M.panelGrey, 0, GRAIN);
  // A plywood patch where the old panel was cut away for a radio that was never fitted.
  put([[-0.07, yP - 0.001, -0.405], [0.07, yP - 0.001, -0.405], [0.07, yP - 0.001, -0.335], [-0.07, yP - 0.001, -0.335]], [0, -1, 0], 'dash', 0, M.ply, 0, GRAIN);

  // Heights the fit-out needs, measured off the tube so it sits on the tube.
  const skinTopAt = (f) => Z(Math.max(...ringAt(T, f).pts.map((p) => p[1])));
  const wallAt = (f, z) => { const xs = crossings(insetRing(ringAt(T, f), w), z / G.m + G.hE); return xs.length >= 2 ? [X(xs[0]), X(xs[xs.length - 1])] : [0, 0]; };
  const deckAt = (f, x) => {
    // The outer skin height over (f, x): the top crossing of the ring with the vertical g = x.
    const R = ringAt(T, f); let best = -Infinity;
    for (let j = 0; j < R.pts.length; j++) {
      const p = R.pts[j], q = R.pts[(j + 1) % R.pts.length], gx = x / G.m;
      if ((p[0] - gx) * (q[0] - gx) <= 0 && p[0] !== q[0]) best = Math.max(best, lerp(p[1], q[1], (gx - p[0]) / (q[0] - p[0])));
    }
    return Z(best);
  };

  // ── THE RAISED DECK: a plywood glareshield and cheek boards, because the tube is too shallow ──
  // ⚠ THIS IS THE ONE PLACE THE ROOM STANDS PROUD OF THE EXTERIOR TUBE, AND IT'S A REBUILDER'S FIX.
  // The loft is 0.66 m deep; a Fly Baby's box fuselage is deeper, and a person sitting in this tube
  // with the real 0.89 m from floor to eye has the top of it at his ribs: from the seat you saw the
  // nose as a wedge and nothing of the cockpit. So the panel is carried up under a plywood hump and
  // the sides boarded up to shoulder height, which is exactly what people do to a shallow fuselage.
  // The glareshield's back edge is 0.44 m ahead and 0.11 m down: 14° below the horizon, the bottom of
  // the light-aircraft band (-8° to -15°), with the windscreen standing on it.
  const GS = { y0: Y(fO1), z0: K0.glare, y1: 1.05, half: 0.25 };
  const gz = (y) => lerp(GS.z0, deckAt(0.40, 0) + 0.01, clamp((y - GS.y0) / (GS.y1 - GS.y0), 0, 1));
  for (let k = 0; k < 6; k++) {
    const ya = lerp(GS.y0, GS.y1, k / 6), yb = lerp(GS.y0, GS.y1, (k + 1) / 6);
    const n = norm([0, GS.z0 - gz(GS.y1), GS.y1 - GS.y0]);
    put([[-GS.half, ya, gz(ya)], [GS.half, ya, gz(ya)], [GS.half, yb, gz(yb)], [-GS.half, yb, gz(yb)]], n, 'dash', 0.1, M.plyPaint, 0, GRAIN);
    for (const s of [-1, 1]) {
      const x = s * GS.half, dA = deckAt(ya / G.m + K0.eyeF, x), dB = deckAt(yb / G.m + K0.eyeF, x);
      put([[x, ya, Math.min(dA, gz(ya))], [x, yb, Math.min(dB, gz(yb))], [x, yb, gz(yb)], [x, ya, gz(ya)]], [s, 0, 0], 'dash', -0.05, M.plyPaint, 0, GRAIN);
    }
  }
  // The panel board carried up to meet it.
  const lo = Math.max(...pb.map((q) => q[2]));
  put([[-GS.half, yP, lo - 0.01], [GS.half, yP, lo - 0.01], [GS.half, yP, GS.z0 - 0.01], [-GS.half, yP, GS.z0 - 0.01]], [0, -1, 0], 'dash', 0.05, M.panelGrey, 0, GRAIN);
  // The underside of the lip, so the panel sits in shadow under it.
  put([[-GS.half, GS.y0, GS.z0 - 0.012], [GS.half, GS.y0, GS.z0 - 0.012], [GS.half, yP, GS.z0 - 0.012], [-GS.half, yP, GS.z0 - 0.012]], [0, 0, -1], 'dash', -0.4, M.plyDk, 0, GRAIN);
  put([[-GS.half, GS.y0, GS.z0 - 0.012], [GS.half, GS.y0, GS.z0 - 0.012], [GS.half, GS.y0, GS.z0], [-GS.half, GS.y0, GS.z0]], [0, -1, 0], 'dash', 0, M.plyDk, 0, GRAIN);
  // Cheek boards up the sides of the opening to shoulder height, with a padded roll along the top.
  for (const s of [-1, 1]) {
    const x = s * K0.cheekX, yA = Y(fO0), yB = GS.y0;
    put([[x, yA, sillZ - 0.01], [x, yB, sillZ - 0.01], [x, yB, K0.cheekZ], [x, yA, K0.cheekZ]], [-s, 0, 0], 'pil', 0, M.plyPaint, 0, GRAIN);
    put([[x + s * 0.012, yA, sillZ - 0.01], [x + s * 0.012, yB, sillZ - 0.01], [x + s * 0.012, yB, K0.cheekZ], [x + s * 0.012, yA, K0.cheekZ]], [s, 0, 0], 'pil', 0, M.red, 0, PATCH);
    for (let k = 0; k < 10; k++) {
      const a = [x + s * 0.006, lerp(yA, yB, k / 10), K0.cheekZ + 0.012], b = [x + s * 0.006, lerp(yA, yB, (k + 1) / 10), K0.cheekZ + 0.012];
      const hs = hash(k, s + 9);
      Kr.rod(a, b, 0.016, 'pil', 0.05, hs < 0.2 ? M.gaffer : hs < 0.3 ? M.foam : M.vinylRoll, 0, 6, false);
    }
    // The roll carried round the front, over the glareshield's back edge.
    Kr.rod([x + s * 0.006, yB, K0.cheekZ + 0.012], [s * GS.half * 0.98, yB, GS.z0 + 0.008], 0.016, 'pil', 0.05, M.vinylRoll, 0, 6, false);
  }
  for (let k = 0; k < 8; k++) {
    const a = [lerp(-GS.half, GS.half, k / 8) * 0.98, GS.y0 - 0.004, GS.z0 + 0.008], b = [lerp(-GS.half, GS.half, (k + 1) / 8) * 0.98, GS.y0 - 0.004, GS.z0 + 0.008];
    Kr.rod(a, b, 0.016, 'dash', 0.05, k === 5 ? M.gaffer : M.vinylRoll, 0, 6, false);
  }
  const panelTop = GS.z0 - 0.012;
  return { faces, panel: pb, panelY: yP, panelTop, skinTopAt, wallAt, deckAt, glareZ: GS.z0, glareY: GS.y0, gz };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function carcassShell(P, live, push, rich) {
  for (const f of P.carcass.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis, f.mat);
  if (rich) carcassFit(P, live, push);
}

// ── WHERE THE CONTROLS ARE ───────────────────────────────────────────────────
// One place, read by both the drawing and the hotspots, so nothing is drawn in one spot and clicked
// in another.
function layout(P, live) {
  const L = live || {};
  const D = P.carcass, fz = D.floorZ;
  const ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const thr = clamp(num(L.throttle), 0, 1), trim = clamp(num(L.trim), -1, 1);
  const flap = clamp(num(L.flapNotch), 0, 3) / 3;
  const ta = -0.75 + thr * 1.5;                       // throttle lever angle, forward is more
  const thrPivot = [-0.235, 0.14, -0.64];
  const fa = 0.12 + flap * 0.95;                      // handbrake: nearly flat to hauled up
  const flapPivot = [0.205, -0.06, fz + 0.07];
  return {
    L, ail, elev, thr, trim, flap,
    stickBase: [0, 0.24, fz + 0.01],
    stickTip: [ail * 0.085, 0.27 + elev * 0.085, -0.42],
    thrPivot, thrKnob: add(thrPivot, [0.012, Math.sin(ta) * 0.13, Math.cos(ta) * 0.13]),
    trimPivot: [-0.24, -0.16, -0.62], trimTip: add([-0.24, -0.16, -0.62], [0.01, Math.sin(trim * 0.7) * 0.10, Math.cos(trim * 0.7) * 0.10]),
    flapPivot, flapTip: add(flapPivot, [0, -Math.cos(fa) * 0.24, Math.sin(fa) * 0.24]),
    // Panel switch positions, in the panel's own (a, b) coordinates.
    sw: { master: [0.105, -0.075], land: [0.135, -0.075], dome: [0.165, -0.075], magL: [-0.205, 0.075], magR: [-0.175, 0.075] },
  };
}
// ── THE WINDSCREEN, AND WHAT'S LEFT OF ITS PERSPEX ──────────────────────────
// A square military screen standing on the glareshield's back edge, raked back 5 cm, top bar a hand
// above the eye. One description, read by the frame (the fit) and by the glass (the profile).
function screenOf(D) {
  const yW = D.glareY + 0.03, base = D.glareZ - 0.01, tz = 0.06;
  const onScreen = (x, t) => [x, yW - 0.05 * clamp(t, 0, 1), lerp(base, tz, t)];
  return { yW, base, tz, onScreen };
}
// ⚠ THE EXTERIOR HAS NO GLASS, so these panes answer to the windscreen FRAME, not to the mesh. The
// perspex that's left is two shards, each convex, in the frame's own (x, t) coordinates: a crazed
// piece in the lower left, and a sliver in the top right corner held in by tape. The middle of the
// frame is empty, which is why the forward view is open.
export const CARCASS_SHARDS = [
  [[-0.182, 0.03], [0.06, 0.03], [-0.02, 0.30], [-0.182, 0.62]],
  [[0.12, 0.96], [0.178, 0.96], [0.178, 0.70]],
];
export function carcassGlass(D) {
  const { onScreen } = screenOf(D);
  return CARCASS_SHARDS.map((sh) => sh.map(([x, t]) => onScreen(x, t)));
}
const panelOf = (K, P) => K.panel([0, P.carcass.panelY - 0.004, P.carcass.panelTop - 0.13], [1, 0, 0], [0, 0, 1], 'dash', 0.1);

export function carcassHotspots(P, live) {
  const Y = layout(P, live), Pn = panelOf(makeKit(() => {}), P), out = [];
  for (const id of ['master', 'land', 'dome']) out.push({ id: 'ck:' + id, p: Pn.pt(...Y.sw[id], 0.01), r: 0.014, kind: 'click' });
  out.push({ id: 'yoke', p: add(Y.stickTip, [0, 0.01, 0.06]), r: 0.07, kind: 'yoke' });
  out.push({ id: 'throttle', p: Y.thrKnob, r: 0.035, kind: 'throttle' });
  out.push({ id: 'trim', p: Y.trimTip, r: 0.04, kind: 'trim' });
  out.push({ id: 'ck:flaps', p: Y.flapTip, r: 0.035, kind: 'click' });
  return out;
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function carcassFit(P, live, push) {
  const K = makeKit(push);
  const Y = layout(P, live), L = Y.L, D = P.carcass, fz = D.floorZ;
  const powered = L.powered !== false;
  const ias = Math.max(0, num(L.ias)), vne = Math.max(40, num(L.vne, 140)), alt = Math.max(0, num(L.alt));
  const vsi = num(L.vsi), rpm = clamp(num(L.rpm), 0, 1.05), fuel = clamp(num(L.fuel, 1), 0, 1);
  const hull = clamp(num(L.hull, 1), 0, 1), bank = num(L.bank), pitch = num(L.pitch), hdg = num(L.hdg);
  const oil = clamp(num(L.oilTemp, 0.5), 0, 1), rud = clamp(num(L.rudder), -1, 1);
  const land = !!L.landingLight && powered, dome = !!L.dome && powered;
  const gearDown = L.gearDown !== false, stall = !!L.stall;

  // ── THE PANEL ──
  const Pn = panelOf(K, P);
  // The ASI. Cracked across, and the bezel held in with tape because the screws went with the
  // previous owner.
  Pn.dial(-0.095, 0.045, 0.034, clamp(ias / (vne * 1.1), 0, 1), { ticks: 16, major: 4, arcs: [[0.25, 0.78, C.green], [0.78, 0.9, C.amber]], red: 0.9, name: 'IAS' });
  Pn.spoke(-0.095, 0.045, 0.6, -0.034, 0.034, 0.0012, M.wireB, 0, 0.0085);
  Pn.rect(-0.14, 0.074, -0.05, 0.086, M.tape, 0.05, 0.010);
  Pn.rect(-0.14, 0.003, -0.05, 0.015, M.tape, 0.05, 0.010);
  // The altimeter, which works, and is the only thing on the board that has ever been calibrated.
  Pn.dial(0, 0.095, 0.034, (alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' });
  // The VSI, out of something else entirely, one size too small for its hole.
  Pn.disc(0.095, 0.045, 0.036, M.hole, 0, 0.0006, 18);
  Pn.dial(0.095, 0.045, 0.027, clamp(0.5 + vsi / 2000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, bezel: M.rust, name: 'VSI' });
  // The tach, with its redline, and the oil temp beside it.
  Pn.dial(-0.10, -0.06, 0.034, clamp(rpm / 1.05, 0, 1), { ticks: 12, major: 3, arcs: [[0.45, 0.85, C.green]], red: 0.9, name: 'RPM' });
  Pn.dial(-0.195, -0.07, 0.022, oil, { a0: Math.PI * 1.2, sweep: Math.PI * 1.4, ticks: 6, major: 3, arcs: [[0.3, 0.75, C.green]], red: 0.85, name: 'OIL T' });
  // Oil pressure: the gauge is gone, the hole isn't. A tyre-pressure gauge is cable-tied under it,
  // reading the same number it always reads.
  Pn.disc(-0.19, 0.012, 0.022, M.hole, 0, 0.0008, 16);
  Pn.dial(-0.19, -0.018, 0.012, 0.35, { ticks: 4, major: 2, bezel: M.brass, name: 'PSI' });
  Pn.rect(-0.205, -0.004, -0.175, -0.001, M.wireB, 0, 0.012);
  // Two mag switches, hand-labelled L and R on masking tape in two different pens.
  for (const id of ['magL', 'magR']) {
    const [a, b] = Y.sw[id]; Pn.toggle(a, b, powered); Pn.rect(a - 0.009, b + 0.012, a + 0.009, b + 0.020, M.paper, 0.05, 0.003);
    Pn.text(id === 'magL' ? 'L' : 'R', a, b + 0.016, 0.0065, id === 'magL' ? INK.blue : INK.black, 0, 0.004);
  }
  // A hiking compass, taped on at an angle nobody has corrected for.
  Pn.rect(0.165, 0.02, 0.215, 0.08, M.tape, 0.05, 0.002);
  Pn.compass(0.19, 0.05, 0.022, hdg + 7);
  // The switch row: master (the one red switch), landing light, dome.
  for (const id of ['master', 'land', 'dome']) {
    const [a, b] = Y.sw[id], on = id === 'master' ? powered : id === 'land' ? !!L.landingLight : !!L.dome;
    Pn.rect(a - 0.0095, b - 0.016, a + 0.0095, b + 0.016, [14, 14, 16], 0, 0.003);
    Pn.stud(a, b + (on ? 0.0045 : -0.0045), 0.0068, 0.0078, on ? 0.010 : 0.006, id === 'master' ? [210, 44, 38] : [232, 230, 222], 0, 0.003);
    Pn.rect(a - 0.009, b + 0.019, a + 0.009, b + 0.025, M.paper, 0.05, 0.003);
    Pn.fitText(id.toUpperCase(), a, b + 0.022, 0.016, 0.0045, INK.black, 0, 0.004);
  }
  // Warning lamps: GEAR (it's fixed, the lamp came with the panel and reads green out of habit), STALL,
  // and a bar gauge labelled BITS LEFT in marker, wired to the hull.
  // Their names go to the left: under GEAR is STALL.
  Pn.lamp(0.195, -0.06, 0.008, 0.006, powered && gearDown, C.green);
  Pn.fitText('GEAR', 0.170, -0.06, 0.024, 0.0065, C.tick, 0.35, 0.004);
  Pn.lamp(0.195, -0.085, 0.008, 0.006, powered && stall, C.red);
  Pn.fitText('STALL', 0.170, -0.085, 0.024, 0.0065, C.tick, 0.35, 0.004);
  Pn.bar(0.215, -0.14, -0.10, 0.007, hull, hull < 0.3 ? C.red : C.amber);
  Pn.rect(0.20, -0.097, 0.23, -0.091, M.paper, 0.05, 0.003);
  Pn.fitText('BITS LEFT', 0.215, -0.094, 0.028, 0.0045, INK.black, 0, 0.004);
  // The radio hole: a plywood patch, two wires and a connector that fits nothing.
  Pn.rect(-0.04, -0.145, 0.04, -0.095, M.hole, 0, 0.0015);
  const conn = Pn.pt(0.01, -0.13, 0.01);
  const sway = rpm * 0.006;
  for (const [a, b, rgb, dz] of [[-0.03, -0.11, M.wireR, 0.12], [0.0, -0.105, M.wireY, 0.16], [0.03, -0.115, M.wireB, 0.10], [0.02, -0.12, M.wireW, 0.14]]) {
    const s0 = Pn.pt(a, b, 0.002), s1 = [s0[0] + a * 0.4 + sway, s0[1] - 0.05, s0[2] - dz * 0.5], s2 = [s0[0] + a + sway * 2, s0[1] - 0.07, s0[2] - dz];
    K.rod(s0, s1, 0.0028, 'dash', 0, rgb, 0, 4); K.rod(s1, s2, 0.0028, 'dash', 0, rgb, 0, 4);
  }
  K.box(conn[0] - 0.012, conn[1] - 0.012, conn[2] - 0.035, conn[0] + 0.012, conn[1] + 0.004, conn[2] - 0.02, 'dash', 0.1, M.wireB);
  // An INSPECTED sticker, the date struck through twice.
  Pn.rect(0.09, 0.09, 0.15, 0.12, M.paper, 0.05, 0.002);
  Pn.rect(0.095, 0.10, 0.145, 0.104, C.red, 0.1, 0.003);
  Pn.fitText('INSPECTED', 0.12, 0.112, 0.054, 0.007, INK.black, 0, 0.004);
  // The slip ball is a builder's spirit level, cable-tied to the bottom of the panel. The bubble runs
  // uphill, so it reads the wrong way round, and everybody learns that on their first turn.
  const lvl = Pn.pt(0, -0.165, 0.015);
  K.box(lvl[0] - 0.09, lvl[1] - 0.012, lvl[2] - 0.011, lvl[0] + 0.09, lvl[1] + 0.012, lvl[2] + 0.011, 'dash', 0.2, C.yellow);
  const slip = clamp(-bank / 45 + rud * 0.3, -1, 1);
  K.box(lvl[0] - 0.035, lvl[1] - 0.0135, lvl[2] - 0.005, lvl[0] + 0.035, lvl[1] - 0.012, lvl[2] + 0.005, 'dash', 0.2, [170, 220, 90], 0.25);
  K.box(lvl[0] + slip * 0.028 - 0.006, lvl[1] - 0.0145, lvl[2] - 0.004, lvl[0] + slip * 0.028 + 0.006, lvl[1] - 0.0135, lvl[2] + 0.004, 'dash', 0.3, M.wireW, 0.3);
  // The bicycle lamp that lights all this, cable-tied under the coaming.
  const bl = [0, D.panelY - 0.04, D.panelTop - 0.02];
  K.box(bl[0] - 0.025, bl[1] - 0.02, bl[2] - 0.018, bl[0] + 0.025, bl[1] + 0.02, bl[2] + 0.004, 'dash', 0, M.gaffer);
  K.box(bl[0] - 0.018, bl[1] - 0.021, bl[2] - 0.016, bl[0] + 0.018, bl[1] - 0.019, bl[2] - 0.004, 'dash', 0, powered ? M.lamp : C.lampOff, powered ? 1 : 0);

  // ── THE DECKING, THE WINDSCREEN AND THE THINGS BOLTED TO IT ──
  // A square military windscreen on the glareshield's back edge, its top bar a hand above the eye line
  // like the real one's. It's a frame now: the perspex that's left is two shards in the corners, so
  // the view straight ahead is through the hole where the rest of it was.
  const { yW, base, tz, onScreen } = screenOf(D);
  const postL = [[-0.19, yW, base], [-0.185, yW - 0.05, tz]], postR = [[0.19, yW, base], [0.185, yW - 0.05, tz]];
  K.rod(...postL, 0.007, 'pil', 0.1, M.steel, 0, 4);
  K.rod(...postR, 0.007, 'pil', 0.1, M.steel, 0, 4);
  K.rod(postL[1], postR[1], 0.007, 'pil', 0.1, M.steel, 0, 4);
  K.rod([-0.19, yW, base], [0.19, yW, base], 0.006, 'pil', 0.1, M.steel, 0, 4);
  for (const [a, b] of [[[-0.182, 0.28], [-0.06, 0.36]], [[-0.06, 0.36], [0.01, 0.2]], [[-0.06, 0.36], [-0.10, 0.52]]]) {
    K.rod(onScreen(a[0], a[1]), onScreen(b[0], b[1]), 0.0015, 'pil', 0, [230, 234, 232], 0.1, 4);
  }
  for (const [x, t, h] of [[-0.10, 0.33, 0.012], [0.15, 0.94, 0.010], [0.16, 0.8, 0.012]]) {
    const c = onScreen(x, t); K.box(c[0] - 0.04, c[1] - 0.003, c[2] - h, c[0] + 0.04, c[1] + 0.002, c[2] + h, 'pil', 0.2, M.tape);
  }
  // The yaw string: a tuft of red wool taped to the top of the frame, streaming back at you. It shows
  // the slip, so it's the most honest instrument on the aeroplane.
  const ys = clamp(rud * -0.6 + bank / 60, -1, 1);
  K.rod([0, yW - 0.05, tz + 0.006], [ys * 0.025, yW - 0.10, tz - 0.004], 0.0022, 'pil', 0, C.red, 0.2, 4);
  K.rod([ys * 0.025, yW - 0.10, tz - 0.004], [ys * 0.06, yW - 0.15, tz - 0.014], 0.0022, 'pil', 0, C.red, 0.2, 4);
  // The landing light is a torch, gaffer-taped to the left post, lens forward.
  const tA = [-0.215, yW - 0.03, -0.03], tB = [-0.215, yW + 0.07, -0.03];
  K.rod(tA, tB, 0.018, 'pil', 0.1, M.gaffer, 0, 8);
  K.rod(tB, add(tB, [0, 0.004, 0]), 0.016, 'pil', 0.1, land ? M.lamp : [60, 62, 60], land ? 1 : 0, 10);
  for (const dy of [0.01, 0.05]) K.box(-0.235, tA[1] + dy - 0.008, -0.05, -0.195, tA[1] + dy + 0.008, -0.01, 'pil', 0.1, M.tape);
  // A pine-tree air freshener off the top rail. It swings with the turn and the pitch, it smells
  // of nothing, and it's the plumb bob.
  const hang = [0.12, yW - 0.05, tz];
  const sw = clamp(bank / 50, -0.9, 0.9), pw = clamp(-pitch / 40, -0.6, 0.6);
  const bob = add(hang, [Math.sin(sw) * 0.06, Math.sin(pw) * 0.03, -Math.cos(sw) * 0.06]);
  K.rod(hang, bob, 0.0009, 'pil', 0, M.wireW, 0, 3);
  {
    const d = norm(sub(bob, hang)), r = norm(cross(d, [0, 1, 0])), n = norm(cross(r, d));
    const nn = dot(n, bob) > 0 ? mul(n, -1) : n;
    const T = (u, v) => add(bob, add(mul(r, u), mul(d, v)));
    K.face([T(0, 0), T(0.018, 0.022), T(0.008, 0.02), T(0.022, 0.045), T(-0.022, 0.045), T(-0.008, 0.02), T(-0.018, 0.022)], nn, 'pil', 0, M.leaf, 0.1);
  }
  // The fuel gauge: a wire up through the decking in front of the windscreen, a cork on top, and a
  // float in the tank under it. Low cork, low fuel. Bingo is when you can't see it.
  const fx = 0, fy = D.Y(0.25), fb = D.deckAt(0.25, 0);
  const ftop = fb + 0.012 + fuel * 0.13;
  K.rod([fx, fy, fb], [fx, fy, ftop], 0.0016, 'pil', 0.1, M.steel, 0, 4);
  K.rod([fx, fy, fb], [fx, fy, fb + 0.012], 0.007, 'pil', 0.1, M.steel, 0, 6);
  K.rod([fx, fy, ftop], [fx, fy, ftop + 0.028], 0.009, 'pil', 0.2, M.cork, 0, 8);
  // A fuel cap that isn't the one it came with.
  K.rod([0, D.Y(0.33), D.deckAt(0.33, 0)], [0, D.Y(0.33), D.deckAt(0.33, 0) + 0.02], 0.03, 'pil', 0.2, C.red, 0, 10);

  // ── THE STICK: scaffold pipe, a bicycle grip, and a washing-up glove for a boot ──
  const { stickBase: sb, stickTip: st } = Y;
  K.rod(sb, st, 0.013, 'dash', 0.1, M.scaffold, 0, 8);
  K.rod(st, add(st, mul(norm(sub(st, sb)), 0.12)), 0.018, 'dash', 0.1, M.rubberRed, 0, 8);
  K.rod(sb, add(sb, mul(sub(st, sb), 0.18)), 0.034, 'dash', 0, M.glove, 0, 8);
  for (const s of [-1, 1]) {
    const f0 = add(sb, mul(sub(st, sb), 0.16)), dir = norm(sub(st, sb));
    K.rod(add(f0, [s * 0.02, 0, 0]), add(add(f0, [s * 0.04, 0.01, 0]), mul(dir, 0.05)), 0.007, 'dash', 0, M.glove, 0, 5);
  }
  K.rod(add(st, mul(norm(sub(st, sb)), 0.005)), add(st, mul(norm(sub(st, sb)), 0.02)), 0.021, 'dash', 0.3, M.steel, 0, 8);   // the hose clamp
  contactShadow(K, [0, sb[1], fz + 0.001], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.05);

  // ── THE RUDDER BAR: a length of four-by-two on a bolt, and a pair of sandal straps ──
  const pv = [0, 0.97, fz + 0.055], ra = rud * 0.32;
  const Rr = [Math.cos(ra), Math.sin(ra), 0], Uu = [0, 0, 1], Nn = [-Math.sin(ra), Math.cos(ra), 0];
  K.obox(pv, Rr, Uu, Nn, 0.17, 0.022, 0.045, 'dash', 0, M.wood2x4);
  K.rod([0, 0.97, fz], [0, 0.97, fz + 0.09], 0.008, 'dash', 0.2, M.steel, 0, 6);
  for (const s of [-1, 1]) {
    const e = add(pv, mul(Rr, s * 0.12));
    K.obox(add(e, [0, 0, 0.03]), Rr, Uu, Nn, 0.045, 0.008, 0.05, 'dash', 0, [98, 64, 40]);
    // The rudder cables, running aft along the floor to the tail. Visibly two different cables.
    const end = add(pv, mul(Rr, s * 0.165));
    K.rod(end, [s * 0.15, D.Y(CARCASS.back) + 0.02, fz + 0.03], 0.0022, 'floor', 0.2, s < 0 ? M.steel : M.rust, 0, 4);
  }

  // ── THE THROTTLE: a quadrant made of angle iron and a brass doorknob ──
  const tp = Y.thrPivot;
  K.box(tp[0] - 0.02, tp[1] - 0.10, tp[2] - 0.02, tp[0] + 0.004, tp[1] + 0.12, tp[2] + 0.005, 'dash', 0, M.rust);
  K.box(tp[0] + 0.004, tp[1] - 0.10, tp[2] - 0.02, tp[0] + 0.03, tp[1] + 0.12, tp[2] - 0.016, 'dash', 0, M.rust);
  K.rod(tp, Y.thrKnob, 0.005, 'dash', 0.2, M.steel, 0, 5);
  K.rod(Y.thrKnob, add(Y.thrKnob, [0.012, 0, 0]), 0.022, 'dash', 0.3, M.brass, 0, 10);
  K.rod(add(Y.thrKnob, [0.012, 0, 0]), add(Y.thrKnob, [0.016, 0, 0]), 0.012, 'dash', 0.3, M.brass, 0, 10);
  // The Bowden cable forward to the carb, cable-tied to the stringers.
  K.rod(add(tp, [0, 0.02, 0]), [-0.22, D.Y(CARCASS.fire) - 0.01, tp[2] + 0.05], 0.004, 'dash', 0, M.wireB, 0, 4);
  // A choke knob from a car, labelled CARB HEAT, on the wall behind the quadrant.
  K.rod([-0.25, 0.30, -0.56], [-0.21, 0.30, -0.56], 0.004, 'dash', 0.2, C.chrome, 0, 5);
  K.rod([-0.21, 0.30, -0.56], [-0.20, 0.30, -0.56], 0.013, 'dash', 0.2, C.black, 0, 8);
  const Ch = K.panel([-0.2495, 0.30, -0.535], [0, 1, 0], [0, 0, 1], 'dash', 0.1);
  Ch.rect(-0.03, -0.0065, 0.03, 0.0065, M.tape, 0.05, 0.002);
  Ch.fitText('CARB HEAT', 0, 0, 0.054, 0.0075, INK.blue, 0, 0.004);
  // The trim: a lever on a bungee, green knob, in a slot cut with a hacksaw that wandered.
  K.box(-0.265, -0.21, -0.66, -0.25, -0.11, -0.58, 'dash', 0, M.plyDk);
  K.rod(Y.trimPivot, Y.trimTip, 0.004, 'dash', 0.2, M.steel, 0, 5);
  K.rod(Y.trimTip, add(Y.trimTip, [0.012, 0, 0.02]), 0.012, 'dash', 0.2, [40, 130, 60], 0, 8);
  K.rod(Y.trimTip, [-0.25, -0.30, -0.70], 0.005, 'dash', 0, M.orange, 0, 4);

  // ── THE FLAP LEVER: a car's handbrake, on the right, bolted through the floor ──
  const hp = Y.flapPivot;
  K.box(hp[0] - 0.02, hp[1] - 0.05, fz, hp[0] + 0.02, hp[1] + 0.05, hp[2], 'dash', 0, M.steel);
  K.rod(hp, Y.flapTip, 0.012, 'dash', 0.1, M.steel, 0, 6);
  const hDir = norm(sub(Y.flapTip, hp));
  K.rod(add(hp, mul(hDir, 0.12)), Y.flapTip, 0.017, 'dash', 0.05, C.black, 0, 8);
  K.rod(Y.flapTip, add(Y.flapTip, mul(hDir, 0.012)), 0.008, 'dash', 0.3, C.red, 0, 8);
  // Ratchet teeth on the side, one tooth per notch actually wired to anything.
  for (let i = 0; i < 4; i++) K.box(hp[0] + 0.02, hp[1] - 0.03 + i * 0.012, hp[2] - 0.02, hp[0] + 0.024, hp[1] - 0.026 + i * 0.012, hp[2] + 0.004, 'dash', 0, M.clamp);

  // ── THE SEAT: out of a hatchback, bolted down with ratchet straps ──
  const sz = P.seatZ, [sy0, sy1] = P.seatY, sh = P.seatHalf;
  K.box(-sh + 0.04, sy0 + 0.02, fz, sh - 0.04, sy1 - 0.02, sz - 0.05, 'seat', -0.1, M.steel);         // the frame
  K.box(-sh + 0.03, sy0, sz - 0.05, sh - 0.03, sy1, sz, 'seat', 0.05, M.vinyl);                       // the cushion
  for (const s of [-1, 1]) K.box(s * sh, sy0, sz - 0.04, s * (sh - 0.035), sy1, sz + 0.04, 'seat', 0.02, M.vinylHi);
  // The foam coming out of a split in the cushion.
  K.box(-0.09, -0.20, sz, 0.02, -0.08, sz + 0.012, 'seat', 0.2, M.foam);
  // The backrest, leaning back 14°.
  const bt = 14 * Math.PI / 180, bU = [0, -Math.sin(bt), Math.cos(bt)], bN = [0, Math.cos(bt), Math.sin(bt)];
  const bc = [0, sy0 - 0.03 - Math.sin(bt) * 0.19, sz + 0.19];
  K.obox(bc, [1, 0, 0], bU, bN, sh - 0.03, 0.19, 0.035, 'seat', -0.02, M.vinyl);
  for (const s of [-1, 1]) K.obox(add(bc, [s * (sh - 0.035), 0, 0]), [1, 0, 0], bU, bN, 0.03, 0.18, 0.05, 'seat', 0.02, M.vinylHi);
  K.obox(add(bc, add(mul(bU, 0.04), mul(bN, 0.036))), [1, 0, 0], bU, bN, 0.05, 0.07, 0.004, 'seat', 0.2, M.foam);     // another split
  // The ratchet straps holding it to the floor.
  for (const s of [-1, 1]) K.rod([s * (sh - 0.02), sy1 - 0.05, sz - 0.02], [s * (sh + 0.02), sy1 + 0.04, fz + 0.002], 0.006, 'floor', 0, M.orange, 0, 4);
  contactShadow(K, [0, (sy0 + sy1) / 2, fz + 0.001], [1, 0, 0], [0, 1, 0], [0, 0, 1], sh + 0.03, (sy1 - sy0) / 2 + 0.05);
  // The harness: one proper shoulder strap, one orange cargo strap, and a lap belt with a ratchet
  // buckle that takes both hands and a knee to undo.
  const buckle = [0, -0.07, sz + 0.06];
  for (const s of [-1, 1]) K.rod([s * (sh - 0.02), sy0 + 0.08, sz + 0.02], buckle, 0.009, 'seat', 0, M.webbing, 0, 4);
  for (const s of [-1, 1]) {
    const top = [s * 0.08, bc[1] - 0.05, bc[2] + 0.18], sho = [s * 0.11, -0.22, -0.30];
    K.rod(top, sho, 0.01, 'seat', 0, s < 0 ? M.webbing : M.orange, 0, 4);
    K.rod(sho, buckle, 0.01, 'seat', 0, s < 0 ? M.webbing : M.orange, 0, 4);
  }
  K.box(buckle[0] - 0.03, buckle[1] - 0.015, buckle[2] - 0.012, buckle[0] + 0.03, buckle[1] + 0.015, buckle[2] + 0.012, 'seat', 0.3, M.steel);

  // ── THE ROLL BAR: scaffolding, with scaffold clamps, rated for scaffolding ──
  const rbY = -0.56, rbTop = 0.16;
  for (const s of [-1, 1]) {
    const x = s * 0.19, b0 = D.deckAt(-0.225, x);
    K.rod([x, rbY, b0], [x, rbY, rbTop], 0.021, 'pil', 0.1, M.scaffold, 0, 8);
    K.obox([x, rbY, rbTop - 0.02], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.03, 0.03, 0.03, 'pil', 0.1, M.clamp);
  }
  K.rod([-0.19, rbY, rbTop], [0.19, rbY, rbTop], 0.021, 'pil', 0.1, M.scaffold, 0, 8);
  // The headrest: a sofa cushion, strapped on.
  K.box(-0.13, rbY + 0.022, -0.26, 0.13, rbY + 0.10, 0.06, 'seat', 0.05, [120, 88, 60]);
  K.box(-0.14, rbY + 0.02, -0.08, 0.14, rbY + 0.104, -0.06, 'seat', 0, M.orange);
  // The dome light: a bare bulb on a wire off the top rail.
  const bulb = [0.06, -0.44, 0.08];
  K.rod([0.06, rbY, rbTop], bulb, 0.002, 'pil', 0, M.wireB, 0, 3);
  K.rod(bulb, add(bulb, [0, 0, -0.03]), 0.013, 'pil', 0.2, dome ? M.bulbOn : [180, 180, 170], dome ? 1 : 0, 8);

  // ── THE FLOOR: a licence plate over half the hole, and an extinguisher that's been used ──
  K.box(-0.20, 0.60, fz, -0.12, 0.72, fz + 0.004, 'floor', 0.2, M.plate);
  K.box(-0.19, 0.64, fz + 0.004, -0.13, 0.68, fz + 0.005, 'floor', 0.2, [40, 60, 120]);
  K.rod([0.15, 0.30, fz + 0.05], [0.15, 0.56, fz + 0.05], 0.042, 'floor', 0.1, C.fireRed, 0, 10);
  K.rod([0.15, 0.56, fz + 0.05], [0.15, 0.60, fz + 0.05], 0.014, 'floor', 0.2, C.black, 0, 8);

  // Tuck-and-roll pleats across the cushion, because the hatchback was a GTi.
  for (let i = 0; i < 7; i++) {
    const y = lerp(sy0 + 0.03, sy1 - 0.03, i / 6);
    K.rod([-sh + 0.045, y, sz + 0.004], [sh - 0.045, y, sz + 0.004], 0.006, 'seat', 0.1, i % 2 ? M.vinylHi : M.vinyl, 0, 5, false);
  }
  // A phone in a sandwich bag, bungeed to the left sill, running somebody's moving map. It's the
  // best instrument on board by a distance and it's on eleven per cent.
  const ph = [-0.215, 0.20, P.carcass.sillZ + 0.035];
  const phN = norm([0.55, -0.35, 0.76]), phR = norm(cross([0, 1, 0], phN)), phU = cross(phN, phR);
  K.obox(ph, phR, phU, phN, 0.036, 0.07, 0.006, 'dash', 0.1, C.black);
  const Sp = K.panel(add(ph, mul(phN, 0.0065)), phR, phU, 'dash', 0);
  Sp.rect(-0.031, -0.062, 0.031, 0.062, powered ? [26, 60, 44] : C.screen, powered ? 0.9 : 0, 0);
  if (powered) {
    const h = -hdg * Math.PI / 180;
    for (let k = -3; k <= 3; k++) Sp.spoke(0, -0.02, h + k * 0.5 + Math.PI / 2, 0.012, 0.05, 0.0012, [70, 120, 90], 0.9, 0.001);
    Sp.spoke(0, -0.02, Math.PI / 2, -0.008, 0.016, 0.006, C.amber, 1, 0.002, 0);
    Sp.bar(0.024, 0.045, 0.058, 0.003, 0.11, C.red);
  }
  Sp.rect(-0.04, -0.075, 0.04, 0.075, [210, 220, 224], 0.05, 0.0012);
  K.rod(add(ph, [-0.02, -0.02, -0.03]), add(ph, [0.02, 0.03, 0.02]), 0.004, 'dash', 0, M.orange, 0, 4);
  // A coil of rope on the floor behind the seat, for when it stops.
  for (let r = 0; r < 3; r++) K.torus([0.03, -0.60 + r * 0.004, fz + 0.012 + r * 0.012], [1, 0, 0], [0, 1, 0], 0.07 - r * 0.008, 0.009, 14, 'floor', 0, [170, 150, 100]);
  hotspotHalo(K, carcassHotspots(P, live), live);
}
