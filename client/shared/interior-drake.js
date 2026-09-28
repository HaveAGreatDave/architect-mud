// THE DRAKE'S COCKPIT: the inside of a duck's head, as geometry.
//
// The Drake is the one loud object in a quiet-money city, and its cockpit is the same joke from the
// inside: you fly it sitting in the eye. The room is the head, the two windows are the two eyes, the
// walls are quilted in the drake's own emerald, the floor is the violet of its breast, and the
// fittings are walnut, ivory and gold. A DRAKE nameplate is plated across the dash, and the seats
// are trimmed in ermine because nobody who buys one was ever going to say no to ermine.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S HEAD, NEVER A SECOND DESCRIPTION OF IT ──────
//
// The boat's pilothouse learned this the expensive way (see "THE BOAT'S ROOM IS NOT AUTHORED HERE
// AT ALL" in interior-shell.js): a hand-typed room and the hull it sits in came out three times
// apart. So the mesh file carries a `cabin` block that NAMES parts rather than restating numbers:
// `head` is the loft the room is the inside of, `eye` is the poly whose rim is the window. The room
// walks the head's own stations with the loft's own super-ellipse, and each window is cut along the
// exterior eye glass's own rim. Edit the head or the eye in the Modelshop and the room follows.
//
// What is NOT derived is anything about a PERSON (the boat file's own split): how wide a seat is,
// how far a hand reaches, how big a dial is. Those are honest metres.
//
// ── ⚠ THE PILOT SITS IN THE RIGHT EYE, AND THE FORWARD VIEW IS THROUGH IT ────
//
// Both eyes are on the sides of the head, so "straight ahead" only reaches the world because the
// head tapers toward the bill: from an eye 0.09 units right of the centreline the forward ray meets
// the wall just inside the front of the right eye's rim. `cabin.pilotEye` is placed so that is true
// and `scripts/shapes/shell.mjs` casts the ray to prove it. Move the eye inboard and the forward
// ray runs into the inside of the face; move it outboard and the seat goes through the wall.
//
// ── ⚠ BOTH MODES, ONE COCKPIT ────────────────────────────────────────────────
//
// It is a helicopter and it is an aeroplane, so it carries both sets of controls: a cyclic that is
// also the stick, a collective with the pusher's thumb-wheel on it, pedals, and between the seats
// the one control that is neither, the CONVERSION LEVER, a brass lever in a gated slot with a cut-
// crystal knob. Aft is ROTOR and forward is WING. The MODE dial on the panel is a plan of the Drake
// itself whose wings sweep and whose rotor folds with the same two channels the exterior animates.
//
// Pure, like the rest of the interior: no clock, no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { legend, LEGEND_MAX_H } from './legend-font.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
// A deterministic 0..1 hash, so the fur is the same fur every frame.
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

// ── THE STYLE ────────────────────────────────────────────────────────────────
//
// ⚠ AUTHORED HERE ON PURPOSE, which is the opposite of the rule in interior-shell.js, and the
// reason is the reason that rule exists. Colourways are a thing the truck bench SELLS; a stock
// colourway on a Drake would be the one interior in the game you can buy the aircraft for and not
// get. This is the aircraft's own trim, it is not for sale separately, and every colour in it is
// taken off the drake outside: the green head, the violet breast, the cream crescent, the orange ruff.
export const DRAKE_TRIM = {
  leather: [26, 84, 64], leatherDk: [20, 66, 52],        // the walls: the green of the head
  carpet: [78, 32, 60], carpetEdge: [58, 22, 44],         // the floor: the violet of the breast
  walnut: [112, 64, 32], walnutDk: [78, 44, 22], burl: [128, 78, 40],
  cream: [234, 222, 198], creamDk: [206, 192, 166],      // the seats: the crescent
  gold: [230, 186, 88], goldDk: [150, 110, 42],
  enamel: [18, 16, 22], ivory: [242, 234, 212], blued: [38, 60, 142],
  furW: [246, 243, 236], furG: [222, 216, 206], furK: [22, 20, 22],
  ruff: [232, 122, 40],                                   // piping: the orange ruff
  crystal: [206, 228, 244],
};
// DARKWING (id 'noir'): the factory's second trim (livery.variant 'noir', picked in the hangar paint bay). Carbon
// fibre where the stock trim has walnut, black leather for the green and the violet, black seats with
// gold piping; the gold, the enamel and the crystal are the stock arrays themselves, so everything
// registered on them (SHINY, TEXTURE) carries over.
export const DRAKE_TRIM_NOIR = {
  ...DRAKE_TRIM, noir: true,
  leather: [22, 22, 25], leatherDk: [14, 14, 17],
  carpet: [16, 16, 19], carpetEdge: [10, 10, 12],
  walnut: [40, 42, 48], walnutDk: [26, 27, 31], burl: [52, 55, 62],
  cream: [30, 30, 34], creamDk: [20, 20, 23],
  ruff: DRAKE_TRIM.gold, ivory: [236, 204, 120],
  // The mode selector: a black plate with gold chips and the names in black on them.
  plate: [14, 14, 16], chip: [214, 170, 76], chipInk: [16, 13, 10],
  // The centre console, darker than the carbon round it.
  console: [16, 16, 18],
  // The gauges: black faces, gold ink, ivory hands.
  dialFace: [24, 23, 22], dialInk: [214, 172, 82], dialHand: [236, 226, 200],
};
// QUACKHAWK DOWN, the special edition, and it is dressed like one: red, white and blue with the
// brightwork in CHROME. Every bezel, rim, rule and letter that is gold on the stock Drake is polished
// chrome here (its own `gold` array, registered below as chrome); the walnut becomes a deep navy
// candy lacquer with a hard clear coat; the seats are white hide piped in red on navy leather walls
// over a red carpet; the dials are white faces with navy numerals and red needles; and the nameplate
// is a navy enamel badge under a glass-thick coat, chrome letters on it and a red and white rule.
export const DRAKE_TRIM_QUACKHAWK = {
  ...DRAKE_TRIM, quackhawk: true,
  leather: [26, 38, 92], leatherDk: [18, 28, 70],
  carpet: [132, 20, 32], carpetEdge: [96, 14, 24],
  cream: [244, 243, 238], creamDk: [220, 219, 214],
  ruff: [190, 26, 40],
  gold: [214, 220, 228], goldDk: [132, 140, 152],                 // chrome, not gold
  walnut: [20, 34, 92], walnutDk: [12, 22, 64], burl: [30, 48, 124], // navy candy lacquer
  enamel: [10, 18, 56],                                            // the nameplate's navy enamel
  ivory: [248, 248, 244], blued: [196, 22, 38],
  plate: [236, 236, 232], chip: [26, 40, 100], chipInk: [244, 242, 236],
  console: [14, 22, 60],
  dialFace: [246, 246, 242], dialInk: [18, 28, 84], dialHand: [200, 22, 38],
  stripeRed: [200, 24, 40], stripeWhite: [246, 246, 242],
};
// ⚠ `T` IS SWAPPED, NOT PASSED: every part in this file reads it, so the profile builder and the
// fit-out set it for the trim of the profile they are building (drakeProfile's second argument).
// A profile is built once per trim, and interior-memo keys its caches on the profile, so the two
// trims never share a memoised part.
let T = DRAKE_TRIM;
const trimOf = (P) => (P && P.trim === 'noir' ? DRAKE_TRIM_NOIR : P && P.trim === 'quackhawk' ? DRAKE_TRIM_QUACKHAWK : DRAKE_TRIM);
// The eyes' readout glass: see-through, by alpha.
const HUD_GLASS = [6, 22, 18];
// The switch legends: warm ivory, self-lit, on an enamel chip (drakeFit, the switch strips).
const LABEL_INK = [244, 232, 204];
PANE.set(HUD_GLASS, 0.45);
// The glass over each dial catches a crescent of window light.
const DIAL_GLINT = [255, 252, 244];
PANE.set(DIAL_GLINT, 0.22);
// Contact shadows (drakeShadows): a soft outer ring and a darker core, both see-through black.
const SHADE_SOFT = [0, 0, 0], SHADE_CORE = [1, 0, 0];
PANE.set(SHADE_SOFT, 0.16); PANE.set(SHADE_CORE, 0.26);
// The hover halo and its press flash (drakeFit, end): see-through gold.
const HALO = [255, 214, 120], HALO_PRESS = [255, 244, 200];
const HALO_RIM = [255, 250, 225];
PANE.set(HALO, 0.6); PANE.set(HALO_PRESS, 0.9); PANE.set(HALO_RIM, 0.95);
// Gold glints hard and small; the goldDk depth of the lettering a little softer; crystal sparkles.
// `ramp` is the metal's own colour from grazing to facing the light, which is most of what makes gold
// read as metal rather than as yellow paint; `glint` a small shifting sparkle on the facets.
// albedo tints what the metal reflects (windshield.js, the environment term): gold keeps the red and
// green of the world and loses most of its blue; chrome keeps nearly all of it.
SHINY.set(T.gold, { spec: 1, pow: 24, ramp: [[120, 78, 22], [255, 226, 140]], glint: 0.5, albedo: [255, 204, 120], envK: 0.65 });
SHINY.set(T.goldDk, { spec: 0.6, pow: 16, ramp: [[90, 60, 18], [200, 150, 64]], glint: 0.25, albedo: [210, 150, 70], envK: 0.5 });
SHINY.set(T.crystal, { spec: 1, pow: 40 }); SHINY.set(C.chrome, { spec: 0.8, pow: 22, ramp: [[60, 64, 70], [232, 236, 240]], glint: 0.3, albedo: [236, 238, 242], envK: 0.85 });
// The lacquers and leathers: no `ramp`, so windshield.js gives them a window sheen and a thin clear
// coat that reflects the glass (`coat` is how much at grazing). Piano-lacquer walnut and enamel shine
// hard; hide is a soft broad sheen with next to no reflection.
SHINY.set(T.enamel, { spec: 0.55, pow: 60, coat: 0.45 });
SHINY.set(T.walnut, { spec: 0.45, pow: 30, coat: 0.38 }); SHINY.set(T.walnutDk, { spec: 0.4, pow: 30, coat: 0.34 });
SHINY.set(T.burl, { spec: 0.45, pow: 30, coat: 0.38 });
for (const c of [T.walnut, T.walnutDk, T.burl]) TEXTURE.set(c, 'wood');   // the GL pass grains a plain walnut panel too
{ // Noir: lacquered carbon weave (the GL pass's 'fabric' texture is a woven twill), satin black leather.
  const N = DRAKE_TRIM_NOIR;
  for (const c of [N.walnut, N.walnutDk, N.burl]) { SHINY.set(c, { spec: 0.6, pow: 46, coat: 0.55 }); TEXTURE.set(c, 'fabric'); }
  for (const c of [N.leather, N.leatherDk, N.cream, N.creamDk]) { SHINY.set(c, { spec: 0.28, pow: 14, coat: 0.12 }); TEXTURE.set(c, 'leather'); }
  TEXTURE.set(N.carpet, 'carpet'); TEXTURE.set(N.carpetEdge, 'carpet');
  SHINY.set(N.chip, { spec: 0.55, pow: 60, coat: 0.45 }); SHINY.set(N.plate, { spec: 0.5, pow: 40, coat: 0.5 });
  SHINY.set(N.console, { spec: 0.45, pow: 40, coat: 0.5 }); TEXTURE.set(N.console, 'fabric');
}{ // Quackhawk Down: mirror chrome for every stock-gold part, candy-lacquered navy where the walnut was,
  // a deep glass coat on the enamel badge, satin white and navy hide, and the red and white rule.
  const Q = DRAKE_TRIM_QUACKHAWK;
  SHINY.set(Q.gold, { spec: 1, pow: 48, ramp: [[70, 76, 88], [250, 252, 255]], glint: 0.7, albedo: [238, 242, 248], envK: 0.95 });
  SHINY.set(Q.goldDk, { spec: 0.8, pow: 30, ramp: [[40, 44, 52], [200, 206, 216]], glint: 0.4, albedo: [220, 226, 234], envK: 0.8 });
  for (const c of [Q.walnut, Q.walnutDk, Q.burl, Q.console]) SHINY.set(c, { spec: 0.85, pow: 80, coat: 0.75 });
  SHINY.set(Q.enamel, { spec: 1, pow: 110, coat: 0.9 });
  for (const c of [Q.stripeRed, Q.stripeWhite]) SHINY.set(c, { spec: 0.9, pow: 90, coat: 0.8 });
  for (const c of [Q.leather, Q.leatherDk, Q.cream, Q.creamDk]) { SHINY.set(c, { spec: 0.32, pow: 16, coat: 0.16 }); TEXTURE.set(c, 'leather'); }
  TEXTURE.set(Q.carpet, 'carpet'); TEXTURE.set(Q.carpetEdge, 'carpet');
}

{
  const Q = DRAKE_TRIM_QUACKHAWK, N = DRAKE_TRIM_NOIR;   // N: the noir lines that follow share this block
  for (const c of [Q.leather, Q.leatherDk, Q.cream, Q.creamDk]) { SHINY.set(c, { spec: 0.28, pow: 14, coat: 0.12 }); TEXTURE.set(c, 'leather'); }
  TEXTURE.set(Q.carpet, 'carpet'); TEXTURE.set(Q.carpetEdge, 'carpet');
  SHINY.set(Q.chip, { spec: 0.55, pow: 60, coat: 0.45 }); SHINY.set(Q.plate, { spec: 0.6, pow: 50, coat: 0.5 });
  SHINY.set(N.ivory, SHINY.get(DRAKE_TRIM.gold));
}
SHINY.set(T.leather, { spec: 0.22, pow: 10, coat: 0.08 }); SHINY.set(T.leatherDk, { spec: 0.18, pow: 10, coat: 0.06 });
SHINY.set(T.cream, { spec: 0.2, pow: 10, coat: 0.06 }); SHINY.set(T.creamDk, { spec: 0.16, pow: 10, coat: 0.05 });
// Carbon fibre: two tones of a 2x2 twill, lacquered, so the weave catches the light a little.
const CARBON_A = [22, 24, 28], CARBON_B = [48, 52, 60];
SHINY.set(CARBON_A, { spec: 0.4, pow: 40 }); SHINY.set(CARBON_B, { spec: 0.55, pow: 40 });
// Where the light on the padding comes from: overhead and a little forward.
const PAD_LIGHT = (() => { const v = [0.15, 0.35, 0.92], l = Math.hypot(...v); return v.map((x) => x / l); })();

// ── THE HEAD, AS A SURFACE ───────────────────────────────────────────────────
//
// The loft's own cross-section (vehicle-mesh.js `emitLoft`, the `super` branch), evaluated at any
// station and any angle rather than only at the loft's own rings. `a` is measured from the right
// flank toward the crown, which is how the exterior's eye was placed on it.
function headSurface(p) {
  const st = p.stations.slice().sort((x, y) => y.f - x.f);
  const [eg, et, eb] = p.exp || [1, 1, 1];
  const sec = (f) => {
    if (f >= st[0].f) return st[0];
    if (f <= st[st.length - 1].f) return st[st.length - 1];
    for (let i = 0; i < st.length - 1; i++) {
      const A = st[i], B = st[i + 1];
      if (f <= A.f && f >= B.f) {
        const t = (A.f - f) / (A.f - B.f);
        return { f, rg: lerp(A.rg, B.rg, t), rvT: lerp(A.rvT, B.rvT, t), rvB: lerp(A.rvB, B.rvB, t), cz: lerp(A.cz, B.cz, t) };
      }
    }
    return st[0];
  };
  // A point on the skin, pushed `inset` model units in toward the section's middle.
  const pt = (f, a, inset = 0) => {
    const s = sec(f), cs = Math.cos(a), sn = Math.sin(a);
    const g = Math.sign(cs) * Math.pow(Math.abs(cs), eg) * s.rg;
    const h = sn >= 0 ? Math.pow(sn, et) * s.rvT : -Math.pow(-sn, eb) * s.rvB;
    const L = Math.hypot(g, h) || 1;
    return [f, g - (g / L) * inset, s.cz + h - (h / L) * inset];
  };
  // The (f, a) a point on the skin was placed at: the inverse of `pt` at inset 0.
  const param = (q) => {
    const s = sec(q[0]), dh = q[2] - s.cz;
    const cs = Math.pow(clamp(Math.abs(q[1]) / s.rg, 0, 1), 1 / eg);
    const sn = Math.pow(clamp(Math.abs(dh) / (dh >= 0 ? s.rvT : s.rvB), 0, 1), 1 / (dh >= 0 ? et : eb));
    return [q[0], Math.atan2(Math.sign(dh) * sn, Math.sign(q[1] || 1) * cs)];
  };
  return { sec, pt, param, eb };
}

const findPart = (parts, name) => {
  for (const p of parts || []) {
    if (p.name === name) return p;
    const q = findPart(p.parts, name);
    if (q) return q;
  }
  return null;
};

// ── 2-D CLIPPING, IN THE HEAD'S OWN (f, a) PARAMETERS ────────────────────────
//
// A window is a hexagon on a curved wall, and the wall is a grid. Clipping in the parameters rather
// than in space is what makes the cut exact: the rim IS a polygon in (f, a), so every wall face
// that touches it is trimmed along the rim's own edge and nothing is left over as a sliver of wall
// across the glass, or as a sliver of sky between the frame and the wall.
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
// A convex cell minus a convex hole, as disjoint convex pieces: for each edge of the hole, what is
// outside that edge and inside every earlier one.
function subtractConvex(cell, hole) {
  const pieces = [];
  let rest = cell;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const out = clipHalf(rest, (p) => -side(p));
    if (out.length >= 3 && Math.abs(area2(out)) > 1e-12) pieces.push(out);
    rest = clipHalf(rest, side);
  }
  return pieces;
}
const bbox2 = (P) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of P) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return [a, b, c, d];
};
const overlap = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];

// ── THE PROFILE ──────────────────────────────────────────────────────────────
//
// Everything a shell profile states, measured off the room this builds, plus the room itself.
// ⚠ THE BOUNDS ARE THE ROOM'S OWN EXTENT, sampled from the faces it emits, for the reason the boat's
// `maxHW` note gives: a bound sampled on its own grid comes out a rounding error inside the thing it
// bounds, and the gate refuses the wall for being outside its own room.
export function drakeProfile(doc = MESH_ROWS.drake, trim = 'stock') {
  T = trimOf({ trim });
  const cab = doc && doc.cabin;
  if (!cab) return null;
  const head = findPart(doc.parts, cab.head), eyeP = findPart(doc.parts, cab.eye);
  if (!head || !eyeP || !eyeP.faces) return null;
  const m = cab.mPerUnit;
  const [fE, gE, hE] = cab.pilotEye;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const H = headSurface(head);
  const inset = (cab.wall ?? 0.07) / m;

  // The right eye's rim, off the exterior glass: each face is [centre, A, B] and the A's go round.
  const rimR = eyeP.faces.map((fc) => H.param(fc.p[1]));
  if (area2(rimR) < 0) rimR.reverse();
  // ⚠ THE LEFT EYE IS π − a, NOT −a: mirroring g flips the COSINE, and a mirror reverses the
  // polygon's winding, so it is reversed back to keep the clipper's inside on the inside.
  const rimL = rimR.map(([f, a]) => [f, Math.PI - a]).reverse();
  const rims = [rimR, rimL];

  const room = buildRoom({ H, m, X, Y, Z, toShell, inset, rims, cab, head });

  // Measure what was built.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of room.faces) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const xCentre = X(0);
  const halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;

  // The side-window rays the gate casts go to (xL|xR, mid winY, mid winZ). Aimed through the middle
  // of each eye, so a window that moves takes its own test with it. The eye is off the centreline,
  // so the two rays want slightly different targets and the average is taken; both still land well
  // inside a rim a metre across.
  const centreOf = (rim) => {
    const pts = rim.map(([f, a]) => toShell(H.pt(f, a, inset)));
    return pts.reduce((s, q) => add(s, mul(q, 1 / pts.length)), [0, 0, 0]);
  };
  // ⚠ AIMED A QUARTER-METRE ABOVE EACH EYE'S MIDDLE, the half a seated person looks through. The
  // middle itself is below the eye line, and a ray to the far eye's middle runs down across the top
  // of the pilot's own instrument pod, which is where a pod should be.
  const up = [0, 0, 0.25];
  const cR = add(centreOf(rimR), up), cL = add(centreOf(rimL), up);
  const xR = xCentre + halfW, xL = xCentre - halfW;
  const tR = xR / cR[0], tL = xL / cL[0];
  // ⚠ ONE TARGET FOR BOTH RAYS, AND IT IS THE FAR EYE'S. The gate reads one (winY, winZ) for both
  // sides, and the near eye is nearly straight ahead of the pilot, so a target solved for it lies
  // metres forward; averaged with the far one it sent that ray into the face. The near eye is a
  // metre across and a hand's breadth away, so the far eye's aim passes through it as well.
  void tR;
  const wy = cL[1] * tL, wz = cL[2] * tL;

  return {
    label: 'Drake cockpit (the head)', trim,
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    // ── measured off the head ──
    dashY: 0.46,
    winY: [wy - 0.08, wy + 0.08], winZ: [wz - 0.08, wz + 0.08],
    eyeCentres: [cR, cL],
    // ── a person, in metres ──
    seatZ: -0.72, seatHalf: 0.21, seatY: [-0.40, 0.06], backZ: -0.12,
    seats: 1, centrePost: 0, pillarW: 0.05, headerZ: 0.4, dashZ: -0.40,
    fit: 'drake',
    normalLit: true,        // lit by which way each face points, like the truck cab (windshield.js)
    // Panel floods: small lamps under the eyebrow of the pod and over each switch strip that light
    // the dash at night. Their colour comes from the live state in windshield.js — warm, or NVIS
    // green with night vision on, because an intensifier tube is blinded by red and white light.
    floods: [{ p: [0, 0.40, -0.14], r: 0.45 }, { p: [-0.22, 0.36, -0.22], r: 0.30 }, { p: [0.22, 0.36, -0.22], r: 0.30 },
      // The cabin light: a warm cove in the headliner over the pilot, and a pool on the throttle hand.
      { p: [0, 0.05, 0.30], r: 0.75 }, { p: [0.42, 0.34, -0.18], r: 0.22 }],
    // The Drake's floods never go fully out by day: a trace of warm cabin light stays on the wood.
    floodFloor: 0.22,
    // The room is its own; interior-shell.js hands `room` the collector and stands back.
    room: drakeShell,
    drake: { m, X, Y, Z, H, inset, rims, faces: room.faces, floorZ: room.floorZ, well: room.well, screenRim: room.screenRim, screen: room.screen },
  };
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
//
// Returns `{ faces }`, each `{ p, n, tone, k, rgb }` in metres about the eye. Built once per profile
// (it moves with nothing), so the per-frame cost is the fit-out alone.
function buildRoom({ H, m, X, Y, Z, toShell, inset, rims, cab, head }) {
  const faces = [];
  const put = (p, n, tone, k, rgb) => faces.push({ p, n, tone, k, rgb });
  const fB = cab.back ?? 0.46;
  const st = head.stations.map((s) => s.f);
  const fF = Math.min(Math.max(...st) - 0.02, 0.80);
  const zFm = Z(cab.floor ?? 0.262);        // the floor, in metres about the eye
  const NF = 16, NA = 40, a0 = -Math.PI / 2;
  const fAt = (i) => lerp(fB, fF, i / NF);
  const aAt = (j) => a0 + (j / NA) * TAU;
  const P3 = (f, a) => toShell(H.pt(f, a, inset));
  // The inward normal at (f, a): the surface's own tangents, turned toward the middle of the section.
  const inward = (f, a) => {
    const d = 1e-4;
    const dF = sub(P3(f + d, a), P3(f - d, a)), dA = sub(P3(f, a + d), P3(f, a - d));
    let n = norm(cross(dF, dA));
    const s = H.sec(f), c = toShell([f, 0, s.cz]);
    if (dot(n, sub(c, P3(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  // ── THE CENTRE SCREEN: the front of the head between the eyes, cut open ──
  // A curved window the width of the face, from a little above the eyes' tops to the crown, facing
  // forward over the bill: what is in front of you, which the eyes (on the sides) only half show.
  // ⚠ 52°–128°: the eyes' rims reach 45° up the head, so a wider arc overlapped them and left a sliver
  // of eye frame inside the screen. It runs back over the pilot to f 0.66, three quilting rows deep.
  // ⚠ ITS BACK EDGE IS DERIVED, NOT WRITTEN: it was a fixed f 0.66, which went stale the moment the
  // head moved and left a strip of screen a few centimetres deep. It now starts just ahead of the pilot's
  // eye, so the screen is one uninterrupted panel from overhead to the face whatever the head does.
  const SA0 = 52 * Math.PI / 180, SA1 = 128 * Math.PI / 180, SF1 = fF + 0.01;
  const SF0 = Math.min(fF - 0.04, (cab.pilotEye?.[0] ?? 0.6) + 0.015);
  const screen = [[SF0, SA0], [SF1, SA0], [SF1, SA1], [SF0, SA1]];
  const holes = [...rims, screen].map((r) => ({ r, bb: bbox2(r) }));
  // The floor clip: everything below the carpet is under it.
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zFm);

  // ── THE WALLS: quilted, a checker of two tones, which is what diamond tufting reads as ──
  for (let i = 0; i < NF; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = fAt(i), f1 = fAt(i + 1), a1 = aAt(j), a2 = aAt(j + 1);
      let pieces = [[[f0, a1], [f1, a1], [f1, a2], [f0, a2]]];
      for (const h of holes) {
        const nx = [];
        for (const pc of pieces) {
          if (!overlap(bbox2(pc), h.bb)) { nx.push(pc); continue; }
          nx.push(...subtractConvex(pc, h.r));
        }
        pieces = nx;
      }
      const q = (i + j) & 1;
      for (const pc of pieces) {
        const poly = aboveFloor(pc.map(([f, a]) => P3(f, a)));
        if (poly.length < 3) continue;
        const cf = pc.reduce((s, v) => s + v[0], 0) / pc.length, ca = pc.reduce((s, v) => s + v[1], 0) / pc.length;
        const n0 = inward(cf, ca);
        // ⚠ A WHOLE CELL IS A PAD, NOT A PANEL. The quilting only reads as plush if each diamond
        // bulges between its buttons, lit on the face turned to the light and in shadow on the one
        // turned away. The cabin shades by `k`, not by normal, so each facet's k is taken from how
        // squarely it faces the light (from above and a little ahead, as a dome lamp and the eyes are).
        // ⚠ …EXCEPT BESIDE AN OPENING, WHERE IT LIES FLAT. A pad bulges 5.5 cm into the room and a
        // cell cut by the opening cannot, so the ring round each eye went pad, flat, pad in steps and
        // stood proud of the gold frame. Flat within a cell of any hole, so the wall meets the gold flush.
        const nearHole = holes.some((h) => f1 > h.bb[0] - (f1 - f0) && f0 < h.bb[2] + (f1 - f0) && a2 > h.bb[1] - (a2 - a1) && a1 < h.bb[3] + (a2 - a1));
        if (poly.length === 4 && pc.length === 4 && !nearHole) {
          const c = mul(poly.reduce((s2, v) => add(s2, v), [0, 0, 0]), 0.25);
          const top = add(c, mul(n0, 0.055));
          for (let e = 0; e < 4; e++) {
            const A = poly[e], B = poly[(e + 1) % 4];
            let n = norm(cross(sub(B, A), sub(top, A)));
            if (dot(n, n0) < 0) n = mul(n, -1);
            const lit = dot(n, PAD_LIGHT);
            put([A, B, top], n, 'pil', -0.62 + lit * 0.95, T.leather);
          }
          continue;
        }
        put(poly, n0, 'pil', q ? -0.02 : -0.12, q ? T.leather : T.leatherDk);
      }
    }
  }

  // ── THE GOLD BUTTONS at the corners of the quilting, on the upper wall and the headlining ──
  for (let i = 1; i < NF; i++) {
    for (let j = 0; j < NA; j++) {
      const f = fAt(i), a = aAt(j);
      if (Math.sin(a) < 0.05) continue;                                  // the lower wall is plain
      if (holes.some((h) => f > h.bb[0] - 0.02 && f < h.bb[2] + 0.02 && a > h.bb[1] - 0.12 && a < h.bb[3] + 0.12)) continue;
      const n = inward(f, a), c = add(P3(f, a), mul(n, 0.004));
      const du = norm(sub(P3(f + 0.004, a), P3(f - 0.004, a))), dv = norm(cross(n, du)), r = 0.012;
      put([add(c, mul(du, r)), add(c, mul(dv, r)), add(c, mul(du, -r)), add(c, mul(dv, -r))], n, 'pil', 0.3, T.gold);
    }
  }

  // ── THE FLOOR: carpet, run a couple of centimetres under the walls so no seam shows ──
  const floorHalf = (f) => {
    // The right wall's g at the carpet: `a` up from the bottom until the inner surface reaches it.
    let lo = -Math.PI / 2, hi = Math.PI / 2;
    if (P3(f, lo)[2] > zFm) return 0;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (P3(f, mid)[2] < zFm) lo = mid; else hi = mid; }
    return P3(f, lo)[0];
  };
  const xC = X(0);
  // ── THE LADDER WELL: the way up from the saloon, aft between the seats ──
  // A hole in the carpet with walnut walls going down the neck and the saloon's light at the bottom.
  // A person, so metres: a hatch a man fits through, against the bulkhead, clear of both seats.
  const yB = Y(fB);
  // Aft and to the right of the seat, clear of its back: the seat is on the centreline now.
  const well = { rect: [xC + 0.26, yB + 0.07, xC + 0.62, yB + 0.50], bottom: zFm - 0.95 };
  const [wx0, wy0, wx1, wy1] = well.rect, wzb = well.bottom;
  const hole = [[wx0, wy0], [wx1, wy0], [wx1, wy1], [wx0, wy1]];
  for (let i = 0; i < NF; i++) {
    const f0 = fAt(i), f1 = fAt(i + 1);
    const w0 = floorHalf(f0) - xC + 0.02, w1 = floorHalf(f1) - xC + 0.02;
    if (w0 <= 0.02 && w1 <= 0.02) continue;
    const strip = [[xC - w0, Y(f0)], [xC + w0, Y(f0)], [xC + w1, Y(f1)], [xC - w1, Y(f1)]];
    const pcs = overlap(bbox2(strip), bbox2(hole)) ? subtractConvex(strip, hole) : [strip];
    for (const pc of pcs) put(pc.map(([x, y]) => [x, y, zFm]), [0, 0, 1], 'floor', -0.2, T.carpet);
  }
  put([[wx0, wy0, wzb], [wx0, wy1, wzb], [wx0, wy1, zFm], [wx0, wy0, zFm]], [1, 0, 0], 'post', -0.1, T.walnut);
  put([[wx1, wy1, wzb], [wx1, wy0, wzb], [wx1, wy0, zFm], [wx1, wy1, zFm]], [-1, 0, 0], 'post', -0.25, T.walnut);
  put([[wx1, wy0, wzb], [wx0, wy0, wzb], [wx0, wy0, zFm], [wx1, wy0, zFm]], [0, 1, 0], 'post', -0.15, T.walnutDk);
  put([[wx0, wy1, wzb], [wx1, wy1, wzb], [wx1, wy1, zFm], [wx0, wy1, zFm]], [0, -1, 0], 'post', -0.3, T.walnutDk);
  // The saloon's own carpet at the bottom, lit from down there.
  faces.push({ p: [[wx0, wy0, wzb], [wx1, wy0, wzb], [wx1, wy1, wzb], [wx0, wy1, wzb]], n: [0, 0, 1], tone: 'floor', k: 0, rgb: [150, 96, 70], emis: 0.45 });

  // ── THE ENDS: the bulkhead behind you and the inside of the face ahead ──
  const endCap = (f, nY) => {
    const pts = [];
    const NS = 48;
    for (let k = 0; k <= NS; k++) pts.push(P3(f, a0 + (k / NS) * TAU));
    const poly = aboveFloor(pts);
    if (poly.length < 3) return null;
    return poly;
  };
  const bulk = endCap(fB, 1), face0 = endCap(fF, -1);
  if (bulk) put(bulk, [0, 1, 0], 'post', -0.1, T.walnut);
  // The inside of the face stops where the screen starts: everything above it is the window.
  const zScr = P3(fF, SA0)[2];
  const face = face0 && clipHalf(face0, (q) => zScr - q[2]);
  if (face && face.length >= 3) put(face, [0, -1, 0], 'post', -0.2, T.leatherDk);

  // ── THE EYES: the reveal through the skin, and a gold frame round each ──
  // The reveal is the wall's own thickness, from the lining out to the glass, in the cream of the
  // crescent that runs back from the eye outside. ⚠ IT IS PART OF THE ROOM, so the bounds include
  // it: it is the one surface in here that reaches the skin.
  for (const rim of rims) {
    const n = rim.length;
    for (let k = 0; k < n; k++) {
      const [fa, aa] = rim[k], [fb, ab] = rim[(k + 1) % n];
      const i0 = P3(fa, aa), i1 = P3(fb, ab);
      const o0 = toShell(H.pt(fa, aa, 0)), o1 = toShell(H.pt(fb, ab, 0));
      const mid = [(fa + fb) / 2, (aa + ab) / 2];
      const edgeIn = norm(sub(toShell(H.pt(...mid, inset)), toShell(H.pt(...mid, 0))));
      // The reveal faces into the opening: across the edge, toward the rim's own middle.
      const cF = rim.reduce((s, v) => s + v[0], 0) / n, cA = rim.reduce((s, v) => s + v[1], 0) / n;
      let rn = norm(sub(toShell(H.pt(cF, cA, inset)), toShell(H.pt(...mid, inset))));
      rn = norm(sub(rn, mul(edgeIn, dot(rn, edgeIn))));
      put([i0, i1, o1, o0], rn, 'pil', 0.1, T.cream);
    }
  }
  // The frame sits a little in from the lining, as the eyes' frames do, so its rods stay in the room.
  const PF = (f, a) => toShell(H.pt(f, a, inset * 1.25));
  const screenRim = [];
  // Round the arch at the back, then forward down each side to the face, and across the face.
  for (let k = 0; k <= 12; k++) screenRim.push(PF(SF0, SA0 + (SA1 - SA0) * (k / 12)));
  for (let k = 1; k <= 4; k++) screenRim.push(PF(SF0 + (fF - 0.01 - SF0) * (k / 4), SA1));
  for (let k = 4; k >= 1; k--) screenRim.push(PF(SF0 + (fF - 0.01 - SF0) * (k / 4), SA0));
  return { faces, floorZ: zFm, well, screenRim, screen: { a0: SA0, a1: SA1, f0: SF0, f1: fF } };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function drakeShell(P, live, push, rich) {
  T = trimOf(P);
  const D = P.drake;
  for (const f of D.faces) push([{ p: f.p, n: f.n }], f.tone, f.k, false, f.rgb, f.emis || 0);
  eyeFrames(P, push);
  screenFrame(P, live, push);
  if (rich) { drakeFit(P, live, push); eyeHuds(P, live, push); }
}

// The centre screen: a gold frame round its arch and the HUD projected on it. Night vision is applied
// to what shows through it by windshield.js.
// ⚠ THE FILTER IS ON THE SCREEN ONLY: the eyes are plain glass, so you keep your own night sight out
// of the sides while the middle shows the amplified picture.
function screenFrame(P, live, push) {
  const K = makeKit(push, false);
  const R = P.drake.screenRim;
  for (let i = 0; i < R.length; i++) K.rod(R[i], R[(i + 1) % R.length], 0.026, 'pil', 0.3, T.gold, 0.05, 6);
  // THE HUD, PROJECTED ON THE GLASS: every mark lies ON the screen's own curved surface (the head's
  // skin, a hair inside the glass), so it bends with the screen the way a projected image does and
  // reads as a display even with night vision off. (u, v) is across and up the screen, −1..1.
  const L = live || {}, D = P.drake, S = D.screen;
  const am = (S.a0 + S.a1) / 2, ah = (S.a1 - S.a0) / 2, fm = (S.f0 + S.f1) / 2, fh = (S.f1 - S.f0) / 2;
  const at = (u, v) => { const q = D.H.pt(fm - v * fh, am - u * ah, D.inset * 1.1); return [D.X(q[1]), D.Y(q[0]), D.Z(q[2])]; };
  const G = [110, 255, 170];
  const seg = (u0, v0, u1, v1, w = 0.012) => {
    const du = u1 - u0, dv = v1 - v0, l = Math.hypot(du, dv) || 1, nu = -dv / l * w, nv = du / l * w;
    const q = [at(u0 - nu, v0 - nv), at(u1 - nu, v1 - nv), at(u1 + nu, v1 + nv), at(u0 + nu, v0 + nv)];
    let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    if (dot(n, q[0]) > 0) n = mul(n, -1);
    K.face(q, n, 'pil', 0, G, 1);
  };
  // The reticle.
  seg(-0.06, 0, -0.015, 0); seg(0.015, 0, 0.06, 0); seg(0, -0.08, 0, -0.02); seg(0, 0.02, 0, 0.08);
  // The horizon and a pitch ladder, rolled by the bank and slid by the pitch.
  const b = num(L.bank) * Math.PI / 180, pv = clamp(num(L.pitch) / 30, -1, 1) * 0.45, cb = Math.cos(b), sb = Math.sin(b);
  const rot = (u, v) => [u * cb - v * sb, u * sb + v * cb];
  for (const [d, w] of [[0, 0.55], [0.25, 0.18], [-0.25, 0.18], [0.5, 0.12], [-0.5, 0.12]]) {
    const A = rot(-w, d - pv), B = rot(w, d - pv);
    if (Math.max(Math.abs(A[0]), Math.abs(A[1]), Math.abs(B[0]), Math.abs(B[1])) > 0.95) continue;
    seg(A[0], A[1], B[0], B[1], d ? 0.008 : 0.011);
  }
  // A heading tape across the top, and the caret it reads against.
  const hdg = num(L.hdg);
  for (let i = -8; i <= 8; i++) {
    const deg = Math.round(hdg / 10) * 10 + i * 10, u = (deg - hdg) / 90;
    if (Math.abs(u) > 0.7) continue;
    seg(u, 0.78, u, deg % 30 === 0 ? 0.9 : 0.84, 0.006);
  }
  seg(-0.03, 0.70, 0, 0.75, 0.006); seg(0, 0.75, 0.03, 0.70, 0.006);
  // Night vision is NOT drawn here: it is an image intensifier over the finished frame, clipped to
  // this screen's outline (applyNightVision in windshield.js). A tinted pane only turned the view green.
}

// ── THE EYES' READOUTS ───────────────────────────────────────────────────────
// A strip of smoked glass low in each eye with lit readouts on it: fuel, rounds left, the ramp, the
// gear and the mode. Glass you see the world through, figures that glow over it.
function eyeHuds(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const fuel = clamp(num(L.fuel, 1), 0, 1), ammo = Math.max(0, Math.round(num(L.ammo, 3000))), ammoCap = Math.max(1, num(L.ammoCap, 3000));
  const ramp = clamp(num(L.ramp), 0, 1), gear = clamp(num(L.gear, 1), 0, 1), wings = clamp(num(L.wings), 0, 1);
  const G = [90, 255, 170], DIM = [30, 90, 60];
  // ⚠ SQUARE TO THE EYE AND INSIDE THE FORWARD VIEW. A readout laid on the eye's curved glass was
  // too distorted to read, so each is a flat pane of smoked glass turned square to the pilot, pulled
  // in from its eye toward the centre and dropped low, where the ordinary forward view shows it
  // whole. A green edge round it says it is a display.
  P.eyeCentres.forEach((c0, side) => {
    const o = [c0[0] * 0.56, c0[1] * 0.78, c0[2] + 0.04];
    const Pn = facingPanel(K, o, 'dash', 0);
    const W = 0.11, H = 0.065;
    Pn.plate(roundRect(-W, -H, W, H, 0.012), HUD_GLASS, 1, 0);
    for (const [x0, y0, x1, y1] of [[-W, H - 0.003, W, H], [-W, -H, W, -H + 0.003], [-W, -H, -W + 0.003, H], [W - 0.003, -H, W, H]]) Pn.rect(x0, y0, x1, y1, G, 1, 0.0015);
    const bar = (y, frac, col, label) => {
      hudText(Pn, label, -0.06, y + 0.018, 0.013, G, 0.003);
      Pn.rect(-0.09, y - 0.005, 0.09, y + 0.005, DIM, 1, 0.002);
      if (frac > 0.001) Pn.rect(-0.09, y - 0.005, -0.09 + 0.18 * frac, y + 0.005, col, 1, 0.003);
    };
    if (side === 0) {
      bar(0.025, fuel, fuel < 0.15 ? C.red : G, 'FUEL');
      bar(-0.02, ammo / ammoCap, ammo / ammoCap < 0.2 ? C.red : C.amber, 'AMMO');
      const conv = clamp(num(L.convert, wings), 0, 1), moving = conv > 0.01 && conv < 0.99;
      const word = moving ? (L.wingTarget ? 'WINGS' : 'ROTOR') : conv >= 0.99 ? 'WINGS' : 'ROTOR';
      hudText(Pn, word, 0, -0.048, 0.014, moving ? C.amber : conv >= 0.99 ? [120, 180, 255] : G, 0.003);
    } else {
      const rows = [['RAMP', ramp > 0.02, C.amber], ['GEAR', gear > 0.02, C.green], ['WING', wings > 0.5, C.blue], ['GUNS', !!L.gunsArmed, C.red], ['NV', !!L.nv, [90, 255, 120]]];
      rows.forEach(([name, on, col], i) => {
        const y = 0.044 - i * 0.022;
        hudText(Pn, name, -0.025, y, 0.012, on ? G : [70, 170, 120], 0.003);
        Pn.rect(0.03, y - 0.006, 0.05, y + 0.006, on ? col : DIM, 1, 0.003);
      });
    }
  });
}

// A gold frame round each eye, lying on the lining along the rim.
function eyeFrames(P, push) {
  const K = makeKit(push, false);
  const D = P.drake;
  for (const rim of D.rims) {
    for (let k = 0; k < rim.length; k++) {
      const a = rim[k], b = rim[(k + 1) % rim.length];
      const pa = D.H.pt(a[0], a[1], D.inset * 1.25), pb = D.H.pt(b[0], b[1], D.inset * 1.25);
      K.rod([D.X(pa[1]), D.Y(pa[0]), D.Z(pa[2])], [D.X(pb[1]), D.Y(pb[0]), D.Z(pb[2])], 0.022, 'pil', 0.3, T.gold, 0.05, 6);
    }
  }
}

// ── THE LETTERS ──────────────────────────────────────────────────────────────
//
// D, R, A, K, E: a high-contrast display face (heavy stems, hairline bars, bracketless serifs),
// each letter a set of CONVEX plates in a one-em box, because a plate is drawn as one fan. Overlaps
// are fine and deliberate: two plates of one colour at one depth are the same pixel either way.
const Rq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function bowl(cx, cy, ax, ay, bx, by, n = 8, ta = -Math.PI / 2, tb = Math.PI / 2) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = ta + (i / n) * (tb - ta), t1 = ta + ((i + 1) / n) * (tb - ta);
    out.push([[cx + Math.cos(t0) * bx, cy + Math.sin(t0) * by], [cx + Math.cos(t0) * ax, cy + Math.sin(t0) * ay],
      [cx + Math.cos(t1) * ax, cy + Math.sin(t1) * ay], [cx + Math.cos(t1) * bx, cy + Math.sin(t1) * by]]);
  }
  return out;
}
const GLYPH = {
  D: { w: 0.82, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.44, 1), Rq(0, 0, 0.44, 0.07), ...bowl(0.44, 0.5, 0.38, 0.5, 0.18, 0.43)] },
  R: { w: 0.86, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.44, 1), Rq(0, 0, 0.40, 0.07), Rq(0.30, 0.47, 0.44, 0.53),
    ...bowl(0.44, 0.735, 0.28, 0.265, 0.11, 0.205), [[0.40, 0.50], [0.56, 0.50], [0.80, 0], [0.62, 0]], Rq(0.54, 0, 0.86, 0.07)] },
  A: { w: 0.98, p: [[[0.04, 0], [0.12, 0], [0.50, 1], [0.43, 1]], [[0.43, 1], [0.58, 1], [0.92, 0], [0.72, 0]],
    Rq(0.20, 0.28, 0.74, 0.34), Rq(0, 0, 0.22, 0.07), Rq(0.62, 0, 0.98, 0.07)] },
  K: { w: 0.94, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.40, 1), Rq(0, 0, 0.40, 0.07),
    [[0.28, 0.42], [0.37, 0.42], [0.80, 0.97], [0.71, 0.97]], Rq(0.60, 0.93, 0.92, 1),
    [[0.36, 0.60], [0.53, 0.60], [0.88, 0.03], [0.68, 0.03]], Rq(0.58, 0, 0.94, 0.07)] },
  E: { w: 0.74, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.70, 1), Rq(0, 0, 0.74, 0.07), Rq(0.30, 0.47, 0.56, 0.53),
    Rq(0.64, 0.78, 0.70, 1), Rq(0.68, 0, 0.74, 0.22), Rq(0.51, 0.40, 0.56, 0.60)] },
  // The round letters are one elliptical ring, heavy at the sides and hairline at the top and foot.
  C: { w: 0.84, p: [...bowl(0.44, 0.5, 0.40, 0.5, 0.21, 0.43, 14, 0.75, TAU - 0.75), Rq(0.72, 0.66, 0.79, 0.96)] },
  O: { w: 0.88, p: bowl(0.44, 0.5, 0.42, 0.5, 0.23, 0.43, 18, 0, TAU) },
  Q: { w: 0.92, p: [...bowl(0.44, 0.5, 0.42, 0.5, 0.23, 0.43, 18, 0, TAU), [[0.44, 0.12], [0.58, 0.14], [0.94, -0.14], [0.80, -0.16]]] },
  P: { w: 0.78, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.44, 1), Rq(0, 0, 0.40, 0.07), Rq(0.30, 0.40, 0.44, 0.46),
    ...bowl(0.44, 0.695, 0.30, 0.305, 0.11, 0.245)] },
  M: { w: 1.08, p: [Rq(0.10, 0, 0.17, 1), Rq(0.78, 0, 0.98, 1), [[0.10, 1], [0.28, 1], [0.58, 0.12], [0.50, 0]],
    [[0.50, 0], [0.56, 0], [0.84, 1], [0.78, 1]], Rq(0, 0, 0.26, 0.07), Rq(0.68, 0, 1.08, 0.07), Rq(0, 0.93, 0.14, 1), Rq(0.84, 0.93, 1.08, 1)] },
  G: { w: 0.86, p: [...bowl(0.44, 0.5, 0.40, 0.5, 0.21, 0.43, 14, 0.75, TAU - 0.1), Rq(0.72, 0.66, 0.79, 0.96), Rq(0.50, 0.40, 0.86, 0.47), Rq(0.74, 0.08, 0.82, 0.47)] },
  N: { w: 0.92, p: [Rq(0.10, 0, 0.17, 1), Rq(0.73, 0, 0.80, 1), [[0.10, 1], [0.28, 1], [0.80, 0], [0.62, 0]], Rq(0, 0, 0.27, 0.07), Rq(0, 0.93, 0.24, 1), Rq(0.62, 0.93, 0.92, 1)] },
  V: { w: 0.94, p: [[[0.02, 1], [0.22, 1], [0.52, 0.06], [0.42, 0]], [[0.42, 0], [0.50, 0], [0.90, 1], [0.83, 1]], Rq(0, 0.93, 0.32, 1), Rq(0.70, 0.93, 0.94, 1)] },
  T: { w: 0.90, p: [Rq(0, 0.93, 0.90, 1), Rq(0.35, 0, 0.55, 1), Rq(0.25, 0, 0.65, 0.07), Rq(0, 0.76, 0.06, 1), Rq(0.84, 0.76, 0.90, 1)] },
  H: { w: 0.92, p: [Rq(0.10, 0, 0.30, 1), Rq(0.62, 0, 0.82, 1), Rq(0.30, 0.47, 0.62, 0.53), Rq(0, 0.93, 0.40, 1), Rq(0.52, 0.93, 0.92, 1), Rq(0, 0, 0.40, 0.07), Rq(0.52, 0, 0.92, 0.07)] },
  I: { w: 0.40, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.40, 1), Rq(0, 0, 0.40, 0.07)] },
  F: { w: 0.70, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.70, 1), Rq(0.30, 0.47, 0.56, 0.53), Rq(0.64, 0.78, 0.70, 1), Rq(0, 0, 0.40, 0.07), Rq(0.51, 0.40, 0.56, 0.60)] },
  L: { w: 0.74, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0, 0.74, 0.07), Rq(0, 0.93, 0.40, 1), Rq(0.68, 0, 0.74, 0.22)] },
  S: { w: 0.78, p: [...bowl(0.40, 0.735, 0.30, 0.265, 0.12, 0.205, 10, 0.3, Math.PI * 1.5), ...bowl(0.40, 0.265, 0.30, 0.265, 0.12, 0.205, 10, -Math.PI + 0.3, Math.PI * 0.5)] },
  W: { w: 0.96, p: [[[0, 1], [0.12, 1], [0.30, 0], [0.22, 0]], [[0.22, 0], [0.30, 0], [0.52, 1], [0.44, 1]], [[0.44, 1], [0.52, 1], [0.74, 0], [0.66, 0]], [[0.66, 0], [0.74, 0], [0.96, 1], [0.84, 1]]] },
  U: { w: 0.86, p: [Rq(0.10, 0.34, 0.30, 1), Rq(0.66, 0.34, 0.73, 1), Rq(0, 0.93, 0.40, 1), Rq(0.54, 0.93, 0.86, 1),
    ...bowl(0.415, 0.34, 0.315, 0.34, 0.12, 0.27, 10, Math.PI, TAU)] },
};
// The switch labels' letters, in the same face: heavy stems, hairline bars, flat serifs.
Object.assign(GLYPH, {
  I: { w: 0.44, p: [Rq(0.12, 0, 0.32, 1), Rq(0, 0.93, 0.44, 1), Rq(0, 0, 0.44, 0.07)] },
  L: { w: 0.72, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.40, 1), Rq(0, 0, 0.72, 0.07), Rq(0.66, 0, 0.72, 0.24)] },
  T: { w: 0.80, p: [Rq(0.30, 0, 0.50, 1), Rq(0, 0.93, 0.80, 1), Rq(0, 0.72, 0.06, 1), Rq(0.74, 0.72, 0.80, 1), Rq(0.20, 0, 0.60, 0.07)] },
  H: { w: 0.96, p: [Rq(0.10, 0, 0.30, 1), Rq(0.66, 0, 0.86, 1), Rq(0.30, 0.47, 0.66, 0.53),
    Rq(0, 0.93, 0.40, 1), Rq(0.56, 0.93, 0.96, 1), Rq(0, 0, 0.40, 0.07), Rq(0.56, 0, 0.96, 0.07)] },
  W: { w: 1.24, p: [[[0.02, 1], [0.22, 1], [0.40, 0.06], [0.32, 0]], [[0.32, 0], [0.40, 0], [0.62, 0.80], [0.56, 0.86]],
    [[0.56, 0.86], [0.66, 0.86], [0.92, 0.06], [0.84, 0]], [[0.84, 0], [0.92, 0], [1.20, 1], [1.13, 1]],
    Rq(0, 0.93, 0.32, 1), Rq(1.00, 0.93, 1.24, 1)] },
  S: { w: 0.78, p: [...bowl(0.39, 0.75, 0.33, 0.25, 0.14, 0.19, 8, Math.PI * 0.5, Math.PI * 1.5),
    ...bowl(0.39, 0.25, 0.33, 0.25, 0.14, 0.19, 8, -Math.PI * 0.5, Math.PI * 0.5),
    Rq(0.39, 0.93, 0.72, 1), Rq(0.06, 0, 0.39, 0.07), Rq(0.66, 0.74, 0.72, 1), Rq(0.06, 0, 0.12, 0.26)] },
  B: { w: 0.82, p: [Rq(0.10, 0, 0.30, 1), Rq(0, 0.93, 0.44, 1), Rq(0, 0, 0.44, 0.07), Rq(0.30, 0.47, 0.44, 0.53),
    ...bowl(0.44, 0.735, 0.30, 0.265, 0.12, 0.205), ...bowl(0.44, 0.265, 0.36, 0.265, 0.16, 0.205)] },
});
const TRACK = 0.28;
export const textWidth = (str) => [...str].reduce((s, ch, i) => s + (GLYPH[ch] ? GLYPH[ch].w : 0.5) + (i ? TRACK : 0), 0);
// Plated lettering: each glyph twice, a dark gold "depth" a hair behind and offset down-right, and
// the bright face over it. Centred on (ca, cb), `h` metres tall.
function plated_(Pn, str, ca, cb, h, face = T.gold, depth = T.goldDk, lift = 0.004) {
  // Small text takes the legend face (legend-font.js): this serif's hairlines vanish below ~15 mm.
  if (h < LEGEND_MAX_H) return legend(Pn, str, ca, cb, h, face, 0.25, lift, depth);
  const W = textWidth(str) * h;
  let x = ca - W / 2;
  const b0 = cb - h / 2;
  for (const ch of str) {
    const G = GLYPH[ch];
    if (!G) { x += (0.5 + TRACK) * h; continue; }
    for (const poly of G.p) {
      Pn.plate(poly.map(([u, v]) => [x + (u + 0.035) * h, b0 + (v - 0.035) * h]), depth, 0.1, lift);
      Pn.plate(poly.map(([u, v]) => [x + u * h, b0 + v * h]), face, 0.25, lift + 0.0015);
    }
    x += (G.w + TRACK) * h;
  }
  return W;
}
// ⚠ ENGRAVED LETTERING IS CUT INTO A SURFACE, NOT STOOD OFF IT. Plated lettering stands 4-5 mm proud,
// which is right for a badge and wrong for a label: seen at an angle the letters slide off the part
// they name, which is how the switch labels ended up across the strip's own gold rim. These lie on the
// surface: a shadow where the upper wall of the cut is out of the light, and the gilt floor over it,
// at the kit's smallest safe step (1.5 mm; closer than that and two layers z-fight).
const ENGRAVE_SHADOW = [34, 18, 8];
function engraved_(Pn, str, ca, cb, h, fill = T.goldDk, lift = 0.0015) {
  return engraveText(Pn, str, ca, cb, h, fill, ENGRAVE_SHADOW, lift);
}
// The same cut lettering for another seat's trim: the shadow colour is the surface's own dark,
// since a cut in carbon is not shadowed in walnut brown. The hydro's helm uses it (interior-hydro.js).
export function engraveText(Pn, str, ca, cb, h, fill, shadow = ENGRAVE_SHADOW, lift = 0.0015, glow = 0.12) {
  if (h < LEGEND_MAX_H) return legend(Pn, str, ca, cb, h, fill, glow, lift, shadow);
  const W = textWidth(str) * h, e = 0.05;
  let x = ca - W / 2;
  const b0 = cb - h / 2;
  for (const ch of str) {
    const G = GLYPH[ch];
    if (!G) { x += (0.5 + TRACK) * h; continue; }
    for (const poly of G.p) {
      Pn.plate(poly.map(([u, v]) => [x + (u - e) * h, b0 + (v + e) * h]), shadow, 0, lift);
      Pn.plate(poly.map(([u, v]) => [x + u * h, b0 + v * h]), fill, glow, lift + 0.0015);
    }
    x += (G.w + TRACK) * h;
  }
  return W;
}
// Lettering that glows: a readout projected on glass, one layer, fully lit.
function hudText_(Pn, str, ca, cb, h, rgb, lift = 0.004) {
  if (h < LEGEND_MAX_H) return legend(Pn, str, ca, cb, h, rgb, 1, lift);
  const W = textWidth(str) * h;
  let x = ca - W / 2;
  const b0 = cb - h / 2;
  for (const ch of str) {
    const G = GLYPH[ch];
    if (!G) { x += (0.5 + TRACK) * h; continue; }
    for (const poly of G.p) Pn.plate(poly.map(([u, v]) => [x + u * h, b0 + v * h]), rgb, 1, lift);
    x += (G.w + TRACK) * h;
  }
  return W;
}
// A rounded rectangle, as one convex plate.
const roundRect = (a0, b0, a1, b1, r, n = 4) => {
  const pts = [];
  const corner = (cx, cy, t0) => { for (let i = 0; i <= n; i++) { const t = t0 + (i / n) * (Math.PI / 2); pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } };
  corner(a1 - r, b0 + r, -Math.PI / 2); corner(a1 - r, b1 - r, 0); corner(a0 + r, b1 - r, Math.PI / 2); corner(a0 + r, b0 + r, Math.PI);
  return pts;
};

// ── THE NAMEPLATE ────────────────────────────────────────────────────────────
// The plate grows with the name, and the letters come down in size only if the plate would then run
// past `maxW` (the pod's own width): 'QUACKHAWK DOWN' is three times as long as 'DRAKE'.
function nameplate_(Pn, ca, cb, h, name = 'DRAKE', maxW = Infinity) {
  h = Math.min(h, maxW / (textWidth(name) + 2.8));   // the plate is W + 2·pad + h wide = (text + 2.8)·h
  const W = textWidth(name) * h, pad = h * 0.9;
  Pn.plate(roundRect(ca - W / 2 - pad - h * 0.5, cb - h * 1.05, ca + W / 2 + pad + h * 0.5, cb + h * 1.05, h * 0.35), T.gold, 0.1, 0.002);
  Pn.plate(roundRect(ca - W / 2 - pad - h * 0.36, cb - h * 0.9, ca + W / 2 + pad + h * 0.36, cb + h * 0.9, h * 0.28), T.enamel, 0, 0.003);
  // A hairline gold rule inside the border, which is what makes it read as a badge and not a sign.
  const i0 = ca - W / 2 - pad - h * 0.16, i1 = ca + W / 2 + pad + h * 0.16, j0 = cb - h * 0.72, j1 = cb + h * 0.72, t = h * 0.05;
  Pn.rect(i0, j0, i1, j0 + t, T.gold, 0.2, 0.0035); Pn.rect(i0, j1 - t, i1, j1, T.gold, 0.2, 0.0035);
  Pn.rect(i0, j0, i0 + t, j1, T.gold, 0.2, 0.0035); Pn.rect(i1 - t, j0, i1, j1, T.gold, 0.2, 0.0035);
  plated(Pn, name, ca, cb, h);
  // The special edition's badge carries a red and white rule under the letters, inside the chrome.
  if (T.stripeRed) {
    const r0 = ca - W / 2 - pad * 0.2, r1 = ca + W / 2 + pad * 0.2, y = cb - h * 0.62, th = h * 0.07;
    Pn.rect(r0, y - th * 1.5, r1, y - th * 0.5, T.stripeRed, 0.15, 0.0034);
    Pn.rect(r0, y - th * 0.5, r1, y + th * 0.5, T.stripeWhite, 0.15, 0.0034);
    Pn.rect(r0, y + th * 0.5, r1, y + th * 1.5, T.stripeRed, 0.15, 0.0034);
  }
  // A lozenge either side of the name.
  for (const s of [-1, 1]) {
    const x = ca + s * (W / 2 + pad * 0.55);
    Pn.plate([[x - h * 0.22, cb], [x, cb - h * 0.3], [x + h * 0.22, cb], [x, cb + h * 0.3]], T.gold, 0.25, 0.0045);
  }
}

// ── THE GAUGES ───────────────────────────────────────────────────────────────
//
// A jeweller's dial: a knurled gold bezel, an enamel chapter ring, an ivory face lit softly from
// behind, diamond majors, and a blued-steel leaf hand. `frac` 0..1 across the sweep, clockwise from
// `a0`, like `dial` in interior-kit.js and every real gauge.
function luxDial_(Pn, ca, cb, R, frac, o = {}) {
  const a0 = o.a0 ?? Math.PI * 1.25, sweep = o.sweep ?? Math.PI * 1.5;
  const ticks = o.ticks ?? 10, major = o.major ?? 2;
  const faceRgb = o.face || T.dialFace || T.ivory, ink = o.ink || T.dialInk || [52, 38, 26];
  // ⚠ EVERY LAYER STANDS AT LEAST 1.5 mm OFF THE PANEL, which is itself a plate at 1 mm: a dial face
  // at the panel's own depth z-fought with it and drew as brown wedges through the ivory.
  // Segment counts are set for a dial a hand's breadth from the eye: 20 round a bezel is still a
  // circle at that size, and each dial was ~240 faces lit on the CPU every frame.
  Pn.torus(ca, cb, R * 1.08, R * 1.28, T.gold, 0.06, 0.0045, 20, 3);
  Pn.annulus(ca, cb, R * 1.0, R * 1.08, T.enamel, 0, 0.005, 18);
  Pn.disc(ca, cb, R, faceRgb, o.glow ?? 0.22, 0.0028, 20);
  // A shadow ring inside the bezel: the face is recessed, so its rim is darker than its middle.
  Pn.annulus(ca, cb, R * 0.86, R, mix(faceRgb, [30, 22, 16], 0.32), o.glow ?? 0.22, 0.0032, 18);
  // Guilloché: two faint rings on the face, the finish that says somebody cared.
  Pn.annulus(ca, cb, R * 0.40, R * 0.43, mix(faceRgb, ink, 0.18), o.glow ?? 0.22, 0.0038, 14);
  Pn.annulus(ca, cb, R * 0.55, R * 0.57, mix(faceRgb, ink, 0.12), o.glow ?? 0.22, 0.0038, 14);
  if (o.arcs) for (const [f0, f1, rgb] of o.arcs) Pn.annulus(ca, cb, R * 0.82, R * 0.90, rgb, 0.5, 0.0042, 8, a0 - f0 * sweep, a0 - f1 * sweep);
  for (let i = 0; i <= ticks; i++) {
    if (sweep >= TAU - 1e-6 && i === ticks) break;
    const f = i / ticks, t = a0 - f * sweep, big = i % major === 0;
    const red = o.red != null && f >= o.red, col = red ? C.red : ink;
    if (big) {
      const r0 = R * 0.72, r1 = R * 0.93, w = R * 0.07, c = Math.cos(t), s = Math.sin(t), rm = (r0 + r1) / 2;
      Pn.plate([[ca + c * r0, cb + s * r0], [ca + c * rm - s * w, cb + s * rm + c * w], [ca + c * r1, cb + s * r1], [ca + c * rm + s * w, cb + s * rm - c * w]], col, red ? 0.6 : 0.2, 0.0048);
    } else Pn.spoke(ca, cb, t, R * 0.82, R * 0.93, R * 0.02, col, red ? 0.6 : 0.2, 0.0048);
  }
  if (frac != null) luxHands(Pn, ca, cb, R, frac, o);
  Pn.disc(ca, cb, R * 0.09, T.gold, 0.2, 0.0088, 10);
  // The glass: a soft crescent of reflected light across the top-left, over everything.
  Pn.annulus(ca, cb, R * 0.55, R * 0.94, DIAL_GLINT, 1, 0.0098, 8, Math.PI * 0.55, Math.PI * 0.95);
}
// A dial's needles, alone: drawn every frame while the rest of the dial stays cached (luxDial).
function luxHands(Pn, ca, cb, R, frac, o = {}) {
  const a0 = o.a0 ?? Math.PI * 1.25, sweep = o.sweep ?? Math.PI * 1.5;
  const hand = (fr, len, w, rgb, l) => {
    const t = a0 - clamp(fr, 0, 1) * sweep, c = Math.cos(t), s = Math.sin(t);
    const back = -R * 0.2, mid = R * len * 0.34, tip = R * len;
    Pn.plate([[ca + c * back, cb + s * back], [ca + c * mid - s * R * w, cb + s * mid + c * R * w],
      [ca + c * tip, cb + s * tip], [ca + c * mid + s * R * w, cb + s * mid - c * R * w]], rgb, 0.35, l);
  };
  if (o.frac2 != null) hand(o.frac2, 0.6, 0.075, o.hand2 || T.goldDk, 0.0065);
  hand(frac, 0.9, 0.06, o.hand || T.dialHand || T.blued, 0.0078);
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// A gold bezel laid over one of the kit's own instruments, so an attitude card or a compass wears
// the same jewellery as the dials round it.
function goldRim_(Pn, ca, cb, R) {
  // A rounded gold ring rather than a flat washer: it reflects the room, and a flat one could only
  // ever reflect one thing (windshield.js, the metals' environment term).
  Pn.torus(ca, cb, R * 1.02, R * 1.28, T.gold, 0.06, 0.0045, 28, 4);
}

// ── WALNUT, FIGURED ──────────────────────────────────────────────────────────
// Grain as geometry, because the cabin has no textures: bands of walnut tones running along the
// piece, each edge a wave that drifts from band to band, a dark streak down some of the edges, and a
// knot or two, which is what book-matched veneer reads as from the seat.
// ⚠ THE TONES ARE FAR ENOUGH APART TO SEE. The first set sat within about 20 of each other and read as
// one flat brown from the seat. The band count follows the piece's size, so a small quadrant gets
// the same figure per centimetre as the dash.
// Walked in ORDER, a slow swell from dark to light and back, so neighbouring bands blend like figured
// veneer rather than alternating like stripes (the old jumbled set, 68 apart, read as a barcode).
const GRAIN = [[104, 58, 28], [112, 64, 31], [121, 70, 35], [128, 75, 38], [121, 70, 35], [112, 64, 31], [100, 55, 26], [108, 61, 29]];
const STREAK = [78, 42, 18];
// ⚠ THE GRAIN IS COARSE GEOMETRY UNDER A FINE TEXTURE. It was half the cockpit — 9,388 of 18,513
// faces, each a streak 5.5 mm tall and 2 cm long, every one lit on the CPU every frame. The bands
// are now three times taller and the segments three times longer, which keeps the figure of the
// wood (the colour bands, the wave, the rings) and hands the fine grain to the GL solids pass,
// which draws the 'wood' texture per pixel on every colour registered below. That needs the colours
// to be the SAME ARRAYS every build (TEXTURE is keyed by identity), so the darkened tones are
// cached per darkness rather than minted per call.
const GRAIN_BAND_M = 0.011, GRAIN_SEG_M = 0.06;
const WOOD_TONES = new Map();
function woodTone(c, dk) {
  if (dk === 1) return c;
  const key = c.join(',') + '|' + dk;
  let t = WOOD_TONES.get(key);
  if (!t) { t = [c[0] * dk, c[1] * dk, c[2] * dk]; TEXTURE.set(t, 'wood'); WOOD_TONES.set(key, t); }
  return t;
}
for (const c of [...GRAIN, STREAK]) TEXTURE.set(c, 'wood');
function woodGrain_(Pn, a0, b0, a1, b1, lift, o = {}) {
  // Darkwing's carbon and Quackhawk's navy lacquer are one flat coat with a fine inlay line, not a grain.
  if (T.noir || T.quackhawk) {
    const dk = o.dark ?? 1;
    Pn.plate([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], dk < 0.8 ? T.walnutDk : T.walnut, 0, lift);
    const w = T.stripeRed ? 0.0016 : 0.0008, e = 0.004;
    if (a1 - a0 > 0.03 && b1 - b0 > 0.02) for (const q of [[a0 + e, b0 + e, a1 - e, b0 + e + w], [a0 + e, b1 - e - w, a1 - e, b1 - e], [a0 + e, b0 + e, a0 + e + w, b1 - e], [a1 - e - w, b0 + e, a1 - e, b1 - e]])
      Pn.plate([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]], T.stripeRed || T.goldDk, 0.05, lift + 0.0004);
    return;
  }
  const NB = Math.max(3, Math.min(20, Math.round((b1 - b0) / GRAIN_BAND_M)));
  const NX = Math.max(2, Math.min(6, Math.round((a1 - a0) / GRAIN_SEG_M)));
  const bh = (b1 - b0) / NB, dk = o.dark ?? 1;
  const tone = (c) => woodTone(c, dk);
  // ⚠ THE WAVE IS CAPPED IN METRES, NOT ONLY AS A SHARE OF THE BAND: on a tall fascia panel a band
  // is over a centimetre deep, and a wave that large crossed the next band and drew as a saw-tooth.
  const w1 = Math.min(bh * 0.45, 0.0022), w2 = Math.min(bh * 0.7, 0.0035);
  const edge = (i, x) => b0 + bh * i + Math.sin(x * 38 + i * 1.7) * w1 + Math.sin(x * 11 - i * 0.6) * w2 * Math.sin(i * 0.9);
  for (let i = 0; i < NB; i++) {
    const col = tone(GRAIN[i % GRAIN.length]);
    for (let j = 0; j < NX; j++) {
      const x0 = a0 + (a1 - a0) * (j / NX), x1 = a0 + (a1 - a0) * ((j + 1) / NX);
      const lo0 = Math.max(b0, edge(i, x0)), lo1 = Math.max(b0, edge(i, x1));
      const hi0 = Math.min(b1, edge(i + 1, x0)), hi1 = Math.min(b1, edge(i + 1, x1));
      if (hi0 <= lo0 && hi1 <= lo1) continue;
      Pn.plate([[x0, lo0], [x1, lo1], [x1, Math.max(lo1, hi1)], [x0, Math.max(lo0, hi0)]], col, 0, lift);
      // the dark line of a growth ring down every third edge
      if (i % 4 === 1) {
        const w = Math.min(bh * 0.12, 0.0004);
        if (lo0 > b0 && lo1 > b0 && lo0 + w < b1 && lo1 + w < b1) Pn.plate([[x0, lo0], [x1, lo1], [x1, lo1 + w], [x0, lo0 + w]], tone(STREAK), 0, lift);
      }
    }
  }
  const ks = Math.min(1, Math.min(a1 - a0, b1 - b0) / 0.08);
  if (ks > 0.2 && o.knots) for (const [ka, kb, kr] of [[a0 + (a1 - a0) * 0.18, b0 + (b1 - b0) * 0.3, 0.008 * ks], [a0 + (a1 - a0) * 0.77, b0 + (b1 - b0) * 0.72, 0.006 * ks]]) {
    Pn.plate(Array.from({ length: 10 }, (_, k) => [ka + Math.cos(k / 10 * TAU) * kr * 1.6, kb + Math.sin(k / 10 * TAU) * kr]), tone([60, 32, 14]), 0, lift);
  }
}
// ── A LEVER, TURNED IN WALNUT AND GOLD ────────────────────────────────────────
// A gold shaft from `a` to `b`, then a gold collar, a turned walnut grip with two gold bands round
// it, and a gold cap. `top` optionally crowns it (a gem, an ivory button); `g` scales the grip.
function luxLever(K, a, b, g = 1, top = null) {
  const d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]) || 1, D = mul(d, 1 / L);
  const at = (t) => add(b, mul(D, t));
  K.rod(a, b, 0.0055 * g, 'dash', 0.2, T.gold, 0.08, 8);
  K.rod(at(-0.004 * g), at(0.004 * g), 0.010 * g, 'dash', 0.3, T.gold, 0.1, 10);            // collar
  K.rod(at(0.004 * g), at(0.030 * g), 0.013 * g, 'dash', 0.15, T.walnut, 0, 10);          // grip
  K.rod(at(0.012 * g), at(0.015 * g), 0.0138 * g, 'dash', 0.3, T.gold, 0.1, 10);          // band
  K.rod(at(0.022 * g), at(0.025 * g), 0.0138 * g, 'dash', 0.3, T.gold, 0.1, 10);          // band
  K.rod(at(0.030 * g), at(0.036 * g), 0.011 * g, 'dash', 0.3, T.gold, 0.1, 10);           // cap
  if (top) top(at(0.036 * g), D);
}
// Veneer on one face of a box: a panel lying in that face, grain running along its longer side.
// `c` is the face's centre, `r` and `u` its two in-plane axes, `hr`/`hu` its half-sizes.
function veneer_(K, c, r, u, hr, hu, o) {
  const along = hr >= hu;
  const Pn = K.panel(c, along ? r : u, along ? u : r, 'dash', 0.2);
  const A = along ? hr : hu, B = along ? hu : hr;
  woodGrain(Pn, -A, -B, A, B, 0.0012, o);
  return Pn;
}
// A raised gold bead round the panel: four strips standing off it at an angle, each facing a
// different way, so one edge or another flashes as the aircraft turns against the sun.
function goldBead(K, Pn, hw, hh, hdr, ftr = 0) {
  const pts = [[-hw, -hh - ftr], [hw, -hh - ftr], [hw, hh + hdr], [-hw, hh + hdr]];
  for (let i = 0; i < 4; i++) {
    const A = pts[i], B = pts[(i + 1) % 4];
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, L = Math.hypot(mx, my) || 1;
    const inA = [A[0] - A[0] / Math.abs(A[0]) * 0.006, A[1] - Math.sign(A[1] - (hh + hdr - hh) / 2) * 0.006];
    const inB = [B[0] - B[0] / Math.abs(B[0]) * 0.006, B[1] - Math.sign(B[1] - (hh + hdr - hh) / 2) * 0.006];
    void mx; void my; void L;
    const q = [Pn.pt(A[0], A[1], 0.002), Pn.pt(B[0], B[1], 0.002), Pn.pt(inB[0], inB[1], 0.007), Pn.pt(inA[0], inA[1], 0.007)];
    let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    if (dot(n, q[0]) > 0) n = mul(n, -1);
    K.face(q, n, 'dash', 0.35, T.gold, 0.05);
  }
}

// ── THE MODE DIAL: the Drake in plan, doing what the Drake is doing ─────────
//
// Wings swept back along the flanks (0) or spread (1), rotor turning (0) or folded aft (1): the same
// two channels, `wings` and `rotorFold`, the exterior mesh animates. A glance at it answers the one
// question a convertible aircraft makes you ask, which is WHAT AM I RIGHT NOW.
function modeDial_(Pn, ca, cb, R, wings, fold) {
  Pn.annulus(ca, cb, R * 1.02, R * 1.28, T.gold, 0.06, 0.0045, 26);
  Pn.disc(ca, cb, R * 1.02, T.enamel, 0, 0.0025, 24);
  const s = R * 0.9;
  // The body, nose up the dial.
  const body = [];
  for (let i = 0; i < 12; i++) { const t = (i / 12) * TAU; body.push([ca + Math.cos(t) * s * 0.16, cb + Math.sin(t) * s * 0.55 - s * 0.05]); }
  Pn.plate(body, T.cream, 0.5, 0.003);
  const headC = [ca, cb + s * 0.55];
  const hd = []; for (let i = 0; i < 10; i++) { const t = (i / 10) * TAU; hd.push([headC[0] + Math.cos(t) * s * 0.13, headC[1] + Math.sin(t) * s * 0.13]); }
  Pn.plate(hd, [40, 150, 110], 0.6, 0.004);
  Pn.plate([[ca - s * 0.05, cb + s * 0.66], [ca + s * 0.05, cb + s * 0.66], [ca, cb + s * 0.84]], C.red, 0.7, 0.004);
  // The wings: a panel each side, hinged at the shoulder and swept from 80° to 0 by `wings`.
  const sw = (1 - clamp(wings, 0, 1)) * (80 * Math.PI / 180);
  for (const side of [-1, 1]) {
    const piv = [ca + side * s * 0.13, cb + s * 0.12];
    const span = s * 0.78, ch = s * 0.22;
    const dir = [side * Math.cos(sw), -Math.sin(sw)], back = [side * Math.sin(sw) * -1 * -1, -Math.cos(sw)];
    const bk = [-dir[1] * side * -1, dir[0] * side * -1];
    const q = (u, v) => [piv[0] + dir[0] * u + bk[0] * v, piv[1] + dir[1] * u + bk[1] * v];
    void back;
    Pn.plate([q(0, 0), q(span, 0), q(span * 0.96, ch * 0.7), q(0, ch)], wings > 0.5 ? C.amber : [150, 110, 60], wings > 0.5 ? 0.9 : 0.3, 0.005);
  }
  // The rotor: a ring when it turns, three blades lying aft together when it is folded.
  const turning = fold < 0.5;
  if (turning) Pn.annulus(ca, cb + s * 0.1, s * 0.86, s * 0.92, C.green, 0.9, 0.006, 28);
  for (let i = 0; i < 3; i++) {
    const t = turning ? Math.PI / 2 + (i / 3) * TAU : -Math.PI / 2 + (i - 1) * 0.12;
    Pn.spoke(ca, cb + s * 0.1, t, 0, s * 0.88, s * 0.03, turning ? C.green : [120, 130, 140], turning ? 0.9 : 0.4, 0.0065);
  }
  Pn.disc(ca, cb + s * 0.1, s * 0.06, T.gold, 0.3, 0.007, 8);
}

// ── FUR ──────────────────────────────────────────────────────────────────────
//
// Ermine: white, with a black tail tip every so often, which is what makes it ermine rather than a
// bath mat. Each tuft is two crossed triangles leaning out from a core, lit by the direction it
// points, so the roll has a ragged silhouette from any seat and a soft light side.
function furRoll_(K, a, b, rad, seed = 0) {
  const d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]);
  if (!(L > 1e-6)) return;
  const D = mul(d, 1 / L);
  const ref = Math.abs(D[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(D, ref)), e2 = cross(D, e1);
  K.rod(a, b, rad * 0.78, 'seat', 0.1, T.furW, 0, 8, true);
  const N = Math.max(2, Math.round(L / 0.015));
  for (let i = 0; i <= N; i++) {
    const c = add(a, mul(D, (i / N) * L));
    const tail = i % 5 === 2;
    for (let j = 0; j < 7; j++) {
      const h1 = hash(i + seed * 31, j), h2 = hash(j + 7, i + seed * 17);
      const th = (j / 7) * TAU + (h1 - 0.5) * 0.9;
      let out = norm(add(add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th))), mul(D, (h2 - 0.5) * 0.6)));
      let len = rad * (0.95 + h1 * 0.35), col = h2 > 0.75 ? T.furG : T.furW;
      // The tail: long, black, and hanging down the way an ermine tail does.
      if (tail && j === 0) { out = norm([out[0] * 0.3, out[1] * 0.3 - 0.2, -1]); len = rad * 1.9; col = T.furK; }
      const tip = add(c, mul(out, len));
      const side = norm(cross(D, out)), w = rad * 0.62;
      K.face([add(c, mul(D, w)), add(c, mul(D, -w)), tip], out, 'seat', 0.15, col, 0);
      K.face([add(c, mul(side, w)), add(c, mul(side, -w)), tip], out, 'seat', 0.15, col, 0);
    }
  }
}

// ── THE CAPTAIN'S CHAIR ──────────────────────────────────────────────────────
// The seat is the one thing in here that is the pilot's alone, so it is dressed up from the seat
// the rest of the fit shares: a gold swivel pedestal, walnut armrests capped in gold with ivory
// grips, tall padded wings that come forward past your shoulders (the part of your own chair you
// can actually see), and a padded headrest.
// ⚠ EVERYTHING STAYS BEHIND OR BESIDE THE EYE, never at it. The wings stand outboard of the
// shoulders and the crest over the headrest, which is behind the head.
function captainChair_(K, P) {
  const fl = P.drake.floorZ, sz = P.seatZ, x0 = -P.seatHalf, x1 = P.seatHalf, y0 = P.seatY[0], y1 = P.seatY[1];
  // The pedestal: a gold column on a round foot, which is what makes it a captain's chair.
  K.rod([0, (y0 + y1) / 2, fl], [0, (y0 + y1) / 2, fl + 0.02], 0.20, 'seat', 0.3, T.gold, 0.05, 16);
  K.rod([0, (y0 + y1) / 2, fl + 0.02], [0, (y0 + y1) / 2, sz - 0.14], 0.055, 'seat', 0.35, T.gold, 0.05, 12);
  // The armrests: walnut, gold-capped at the front, an ivory grip pad on each.
  for (const s of [-1, 1]) {
    const ax = s * (P.seatHalf + 0.05);
    K.box(ax - 0.035, y0 - 0.05, sz + 0.10, ax + 0.035, y1 + 0.04, sz + 0.15, 'seat', 0.2, T.walnut);
    K.box(ax - 0.03, y0 - 0.02, sz - 0.04, ax + 0.03, y0 + 0.02, sz + 0.10, 'seat', 0.0, T.walnutDk);
    K.box(ax - 0.03, y1 + 0.02, sz - 0.04, ax + 0.03, y1 + 0.05, sz + 0.10, 'seat', 0.0, T.walnutDk);
    K.box(ax - 0.038, y1 + 0.02, sz + 0.095, ax + 0.038, y1 + 0.06, sz + 0.155, 'seat', 0.4, T.gold, 0.05);
    K.box(ax - 0.025, (y0 + y1) / 2 - 0.08, sz + 0.15, ax + 0.025, (y0 + y1) / 2 + 0.06, sz + 0.165, 'seat', 0.3, T.ivory);
  }
  // The wings: padded panels standing forward either side of your shoulders, piped in the ruff's orange.
  const wy0 = y0 - 0.15, wy1 = y0 + 0.14, wz0 = sz + 0.25, wz1 = P.backZ + 0.18;
  for (const s of [-1, 1]) {
    const wx = s * (P.seatHalf + 0.03);
    padGrid(K, [wx, wy0, wz0], [0, wy1 - wy0, 0], [0, 0, wz1 - wz0], [-s, 0, 0], 2, 3, 0.022, T.cream);
    K.rod([wx, wy1, wz0], [wx, wy1, wz1], 0.008, 'seat', 0.2, T.ruff, 0.05, 5);
    K.rod([wx, wy0, wz1], [wx, wy1, wz1], 0.008, 'seat', 0.2, T.gold, 0.05, 5);
  }
}

// ── PADDING ──────────────────────────────────────────────────────────────────
// A rectangle (corner `o`, edges `u` and `v`) quilted into nu × nv pads, each a low pyramid bulging
// `h` metres along `n`, its four facets shaded by how squarely they face the light, and a gold
// button at every corner the pads meet at.
function padGrid_(K, o, u, v, n, nu, nv, h, rgb) {
  const P = (a, b) => add(add(o, mul(u, a)), mul(v, b));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const c = [P(i / nu, j / nv), P((i + 1) / nu, j / nv), P((i + 1) / nu, (j + 1) / nv), P(i / nu, (j + 1) / nv)];
    const top = add(P((i + 0.5) / nu, (j + 0.5) / nv), mul(n, h));
    for (let e = 0; e < 4; e++) {
      const A = c[e], B = c[(e + 1) % 4];
      let fn = norm(cross(sub(B, A), sub(top, A)));
      if (dot(fn, n) < 0) fn = mul(fn, -1);
      K.face([A, B, top], fn, 'seat', -0.45 + dot(fn, PAD_LIGHT) * 0.75, rgb, 0);
    }
  }
  const bu = norm(u), bv = norm(v), r = 0.008;
  for (let i = 1; i < nu; i++) for (let j = 1; j < nv; j++) {
    const c = add(P(i / nu, j / nv), mul(n, 0.004));
    K.face([add(c, mul(bu, r)), add(c, mul(bv, r)), add(c, mul(bu, -r)), add(c, mul(bv, -r))], n, 'seat', 0.4, T.gold, 0.1);
  }
}

// ── A SEAT ───────────────────────────────────────────────────────────────────
//
// Tuck-and-roll cream leather on a walnut plinth, orange piping, a winged back, and ermine along the
// top of the back and the front of the cushion. ⚠ THE HEADREST STANDS BEHIND THE EYE and the fur
// rides the back's top edge well clear of it: an eye inside a tuft is the black screen the gate's
// first rule is about.
function luxSeat_(K, cx, P, seed) {
  const x0 = cx - P.seatHalf, x1 = cx + P.seatHalf, y0 = P.seatY[0], y1 = P.seatY[1], sz = P.seatZ;
  const fl = P.drake.floorZ;
  K.box(x0 + 0.04, y0 - 0.08, fl, x1 - 0.04, y1 - 0.08, sz - 0.14, 'seat', -0.15, T.walnut);
  K.box(x0 + 0.03, y1 - 0.09, fl, x1 - 0.03, y1 - 0.08, fl + 0.03, 'seat', 0.2, T.gold);            // the kick strip
  K.box(x0, y0, sz - 0.14, x1, y1, sz - 0.05, 'seat', 0.02, T.creamDk);
  // Diamond-padded, like the walls: pads that bulge between gold buttons.
  padGrid(K, [x0, y0, sz - 0.05], [x1 - x0, 0, 0], [0, y1 - y0, 0], [0, 0, 1], 4, 4, 0.03, T.cream);
  // The back, and its rolls standing out of it toward you.
  const by0 = y0 - 0.15, by1 = y0 - 0.03;
  K.box(x0, by0, sz - 0.05, x1, by1, P.backZ, 'seat', -0.04, T.creamDk);
  padGrid(K, [x0, by1, sz - 0.03], [x1 - x0, 0, 0], [0, 0, P.backZ - sz + 0.02], [0, 1, 0], 4, 5, 0.03, T.cream);
  // Wings either side of the back.
  K.box(x0 - 0.035, by0, sz - 0.02, x0 + 0.02, by1 + 0.07, P.backZ - 0.02, 'seat', -0.02, T.cream);
  K.box(x1 - 0.02, by0, sz - 0.02, x1 + 0.035, by1 + 0.07, P.backZ - 0.02, 'seat', -0.02, T.cream);
  // Orange piping on the cushion's front edge and round the back's face.
  K.rod([x0, y1 + 0.004, sz - 0.05], [x1, y1 + 0.004, sz - 0.05], 0.007, 'seat', 0.2, T.ruff, 0.05, 5);
  K.rod([x0 + 0.02, by1 + 0.035, sz], [x0 + 0.02, by1 + 0.035, P.backZ - 0.03], 0.006, 'seat', 0.2, T.ruff, 0.05, 5);
  K.rod([x1 - 0.02, by1 + 0.035, sz], [x1 - 0.02, by1 + 0.035, P.backZ - 0.03], 0.006, 'seat', 0.2, T.ruff, 0.05, 5);
  // The headrest: part of the back, a padded panel carried straight on up behind the head.
  // ⚠ IT STANDS BEHIND THE EYE, never at it: an eye inside a headrest is the black screen the
  // gate's first rule is about.
  const hz1 = P.backZ + 0.20;
  K.box(cx - 0.14, by0, P.backZ - 0.02, cx + 0.14, by1, hz1, 'seat', -0.04, T.creamDk);
  padGrid(K, [cx - 0.14, by1, P.backZ - 0.02], [0.28, 0, 0], [0, 0, hz1 - P.backZ + 0.02], [0, 1, 0], 2, 2, 0.025, T.cream);
  // Ermine along the front of the cushion.
  furRoll(K, [x0 - 0.01, y1 + 0.02, sz - 0.075], [x1 + 0.01, y1 + 0.02, sz - 0.075], 0.03, seed + 3);
}

// ── A PANEL THAT FACES YOU ───────────────────────────────────────────────────
// A panel at `o` turned square to the eye, level across. The kit's own `panel` turns the normal
// toward the origin; this also turns the PLANE to it, so a dial is round and not an ellipse.
// ⚠ THE RIGHT-HAND AXIS IS cross(toward the panel, up) = (−n₁, n₀, 0), with n the normal toward
// the eye. The other sign is a panel that reads correctly from BEHIND, which is to say lettering
// that comes out mirrored from the seat.
function facingPanel(K, o, tone = 'dash', k = 0.25) {
  const n = norm(mul(o, -1));
  const r = norm([-n[1], n[0], 0]);
  const u = cross(n, r);
  return K.panel(o, r, u[2] < 0 ? mul(u, -1) : u, tone, k);
}
// The corners of a panel of half-size (hw, hh) at `o` facing the eye, in shell space, pushed `back`
// metres away from the eye: what a housing behind a panel is built out of.
function panelCorners(o, hw, hh, back = 0) {
  const n = norm(mul(o, -1));
  const r = norm([-n[1], n[0], 0]);
  let u = cross(n, r); if (u[2] < 0) u = mul(u, -1);
  const c = add(o, mul(n, -back));
  return [add(add(c, mul(r, -hw)), mul(u, -hh)), add(add(c, mul(r, hw)), mul(u, -hh)), add(add(c, mul(r, hw)), mul(u, hh)), add(add(c, mul(r, -hw)), mul(u, hh))];
}

// ── WHERE THE CONTROLS ARE, ONCE ─────────────────────────────────────────────
// drakeFit draws from these and drakeHotspots hands the same points to the renderer for clicking.
// Two strips facing the pilot, either side of the yoke; each control's u along its strip.
const DRAKE_STRIPS = {
  // Spread outboard and apart, clear of the yoke's horns and of each other's labels.
  left: { o: [-0.285, 0.42, -0.345], hw: 0.115, at: { power: -0.080, lights: -0.027, cabin: 0.026, gear: 0.084 } },
  right: { o: [0.26, 0.42, -0.345], hw: 0.115, at: { quack: -0.070, guns: 0, nv: 0.070 } },
};
// ⚠ Outboard of the right switch strip (which ends at x 0.383): at 0.33 the lever swung up
// straight through the strip's plate.
const DRAKE_THROTTLE = { pivot: [0.43, 0.39, -0.40], len: 0.105, k: 1.45 };
// Where drakeFit put the console's levers this build, for drakeHotspots (the console's y comes off the dash).
const DRAKE_LEVER_AT = { conv: null, modes: [] };
// The mode selector's four gates, aft to fore, in the console panel's own v (metres).
const DRAKE_MODE_GATES = [0.0, 0.095, 0.19, 0.285];
const MODE_CHIP = [16, 74, 52];   // the drake's head green, in enamel
SHINY.set(MODE_CHIP, { spec: 0.55, pow: 60, coat: 0.45 });
const DRAKE_MODE_NAMES = ['HELI', 'PLANE', 'BOAT', 'SUB'];
const DRAKE_MODE_LAMP = [[110, 255, 170], [110, 170, 255], [90, 220, 200], [255, 176, 60]];
function drakeThrottleKnob(thr) {
  const a = (-40 + clamp(thr, 0, 1) * 80) * Math.PI / 180, [x, y, z] = DRAKE_THROTTLE.pivot, L = DRAKE_THROTTLE.len;
  return [x, y + Math.sin(a) * L, z + Math.cos(a) * L];
}
// The trim wheel: a drum on its side in the console right of the throttle, turned by the trim.
const DRAKE_TRIM_WHEEL = { c: [0.49, 0.36, -0.32], r: 0.044, w: 0.018 };
// The gun convergence knob (CONV), just right of the trim wheel: where the two toed-in guns meet.
const DRAKE_CONV_KNOB = { c: [0.58, 0.36, -0.32], r: 0.016, min: 0.5, max: 2.2 };
// The yoke stands off the dash on its column, nearer the pilot and lower than the pod, so the pod
// reads over its top and the pedal well (DRAKE_WELL) reads between the two.
function drakeYokeHub(elev) { return [0, 0.30 - clamp(elev, -1, 1) * 0.02, -0.29]; }
// The yoke's face turned toward the eye: its "up" is perpendicular to the line from the eye to the hub.
const DRAKE_YOKE_UP = norm([0, 0.67, 0.74]);
const smooth01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
// The front of the dash below the panels. It is carved rather than flat: a footwell with the floor
// pedals in it straight ahead of the pilot, the PANTRY to the left (a door that folds down and a
// cold-lit gantry screen that rises behind it), the LOCKER to the right (two drawers that roll
// out), a brass grille over each, and a kick plate along the carpet. The server side of both is
// plugins/flight/drake-stores.js; clicking either sends its verb (drakeHotspots → cockpit DK_ACT).
//
// ⚠ THE SHADING IS LAYERED GLASS, NOT A DARKER COLOUR: every shadow is SHADE_SOFT laid over what is
// already drawn, stacked where it should be deepest, so the gradient follows the geometry and the
// wood under it keeps its grain.
const PANTRY_GLASS = [40, 120, 150], PANTRY_LIGHT = [150, 220, 255];
PANE.set(PANTRY_GLASS, 0.32);
// The pantry's breath: three shades of mist, fading as a puff ages (PANE alpha is per colour).
const STEAM = [[236, 244, 250], [237, 244, 250], [238, 244, 250]];
PANE.set(STEAM[0], 0.16); PANE.set(STEAM[1], 0.10); PANE.set(STEAM[2], 0.05);
// Where the two compartment handles are, in shell metres, for the hotspots. Filled in the first time
// the fascia is built, since it depends on the room's floor height.
const DRAKE_STORE_AT = { pantry: null, locker: null };
function drakeFascia(K, L, { dxL, dxR, dY0, fl, zTop, rud, cons }) {
  const N = [0, -1, 0], y = dY0;
  const hw = 0.17, zH = fl + Math.min(0.42, (zTop - fl) * 0.72), D = 0.22;
  const WELL_DK = [30, 18, 11], CARPET = [52, 30, 24], CAVITY = [22, 30, 36];
  const pantry = clamp(num(L.pantry), 0, 1), locker = clamp(num(L.locker), 0, 1);
  const shade = (pts, n, layers = 1) => { for (let i = 0; i < layers; i++) K.face(pts, n, 'dash', 0, SHADE_SOFT, 1); };
  // A vertical shadow band on the fascia plane, darkest at `zDark`, fading over `len` toward zFade.
  const band = (a, b, zDark, len, steps = 4, yy = y - 0.0015, n = N) => {
    for (let i = 1; i <= steps; i++) {
      const z1 = zDark + (len * i) / steps;
      const [lo, hi] = z1 < zDark ? [z1, zDark] : [zDark, z1];
      shade([[a, yy, lo], [b, yy, lo], [b, yy, hi], [a, yy, hi]], n);
    }
  };
  const pane = (a, b, z0, z1, rgb, dark) => {
    if (b - a < 0.005 || z1 - z0 < 0.005) return;
    K.face([[a, y, z0], [b, y, z0], [b, y, z1], [a, y, z1]], N, 'dash', -0.2, rgb, 0);
    veneer(K, [(a + b) / 2, y, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1], (b - a) / 2 - 0.008, (z1 - z0) / 2 - 0.008, { dark });
  };
  const gz = zTop - 0.05, lo = fl + 0.08, hi = gz - 0.05;
  const pa = dxL + 0.06, pb = -hw - 0.06;                  // the pantry's opening, left
  const la = hw + 0.06, lb = dxR - 0.06;                   // the locker's, right

  // ── The face, in pieces round the footwell and the pantry's opening ──
  pane(dxL, pa, fl, zTop, T.walnutDk, 0.72);
  pane(pb, -hw, fl, zTop, T.walnutDk, 0.72);
  pane(pa, pb, fl, lo, T.walnutDk, 0.72);
  pane(pa, pb, hi, zTop, T.walnutDk, 0.72);
  pane(hw, dxR, fl, zTop, T.walnutDk, 0.72);
  pane(-hw, hw, zH, zTop, T.burl, 0.95);
  // The lip of the dash top throws a shadow down the whole face.
  band(dxL, dxR, zTop, -0.12, 4);

  // ── The footwell: dark walls, carpet, and a gold bead round the opening ──
  const yb = y + D;
  K.face([[-hw, yb, fl], [hw, yb, fl], [hw, yb, zH], [-hw, yb, zH]], N, 'dash', -0.5, WELL_DK, 0);
  K.face([[-hw, y, fl], [-hw, yb, fl], [-hw, yb, zH], [-hw, y, zH]], [1, 0, 0], 'dash', -0.35, T.walnutDk, 0);
  K.face([[hw, yb, fl], [hw, y, fl], [hw, y, zH], [hw, yb, zH]], [-1, 0, 0], 'dash', -0.35, T.walnutDk, 0);
  K.face([[-hw, y, zH], [-hw, yb, zH], [hw, yb, zH], [hw, y, zH]], [0, 0, -1], 'dash', -0.6, WELL_DK, 0);
  K.face([[-hw, y, fl + 0.002], [hw, y, fl + 0.002], [hw, yb, fl + 0.002], [-hw, yb, fl + 0.002]], [0, 0, 1], 'floor', -0.3, CARPET, 0);
  // Darker the deeper in and the higher up, where the light from the cabin never reaches.
  band(-hw, hw, zH, -0.18, 5, yb - 0.0015);
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.0015), n = [-s, 0, 0];
    for (let i = 1; i <= 4; i++) { const yy = yb - (D * i) / 5; shade([[x, yy, fl], [x, yb, fl], [x, yb, zH], [x, yy, zH]], n); }
  }
  for (let i = 1; i <= 4; i++) { const yy = yb - (D * i) / 5; shade([[-hw, yy, fl + 0.003], [hw, yy, fl + 0.003], [hw, yb, fl + 0.003], [-hw, yb, fl + 0.003]], [0, 0, 1]); }
  const e = y - 0.006;
  K.rod([-hw, e, fl], [-hw, e, zH], 0.008, 'dash', 0.3, T.gold, 0.1, 6);
  K.rod([hw, e, fl], [hw, e, zH], 0.008, 'dash', 0.3, T.gold, 0.1, 6);
  K.rod([-hw, e, zH], [hw, e, zH], 0.008, 'dash', 0.3, T.gold, 0.1, 6);
  K.obox([0, y - 0.01, zH + 0.018], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.028, 0.022, 0.008, 'dash', 0.3, T.gold, 0.1);

  // The floor pedals: a pair on a heel bar, the pressed one tipping away from you.
  K.box(-0.12, yb - 0.07, fl, 0.12, yb - 0.04, fl + 0.03, 'dash', 0.1, [60, 44, 30]);
  for (const s of [-1, 1]) {
    const press = clamp(s < 0 ? -rud : rud, 0, 1), tilt = 0.35 + press * 0.3;
    const U = [0, Math.sin(tilt), Math.cos(tilt)], Nn = [0, -Math.cos(tilt), Math.sin(tilt)];
    const c = [s * 0.075, yb - 0.1 + U[1] * 0.07, fl + 0.03 + U[2] * 0.07];
    K.obox(c, [1, 0, 0], U, Nn, 0.035, 0.07, 0.008, 'dash', 0.3, press > 0.05 ? [226, 176, 90] : T.gold, press * 0.3);
    for (let i = -2; i <= 2; i++) K.obox(add(c, add(mul(U, i * 0.025), mul(Nn, 0.009))), [1, 0, 0], U, Nn, 0.028, 0.004, 0.002, 'dash', 0.1, [40, 26, 16]);
    // Each pedal's own shadow on the carpet, behind it.
    shade([[c[0] - 0.035, yb - 0.1, fl + 0.004], [c[0] + 0.035, yb - 0.1, fl + 0.004], [c[0] + 0.035, yb - 0.02, fl + 0.004], [c[0] - 0.035, yb - 0.02, fl + 0.004]], [0, 0, 1], 2);
  }

  // ── Brass grilles, and the shadow each throws ──
  const grille = (a, b, z) => {
    K.obox([(a + b) / 2, y - 0.004, z], [1, 0, 0], [0, 0, 1], [0, 1, 0], (b - a) / 2, 0.022, 0.004, 'dash', 0.2, T.gold, 0.05);
    for (let x = a + 0.02; x < b - 0.01; x += 0.022) K.obox([x, y - 0.009, z], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.005, 0.017, 0.002, 'dash', -0.4, WELL_DK);
    band(a + 0.01, b + 0.01, z - 0.022, -0.03, 2);
  };
  grille(pa, pb, gz);
  grille(la, lb, gz);
  const goldEdge = (c, R, U, hr, hu) => {
    const p = (sr, su) => add(c, add(mul(R, sr * hr), mul(U, su * hu)));
    const q = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
    for (let i = 0; i < 4; i++) K.rod(q[i], q[(i + 1) % 4], 0.004, 'dash', 0.3, T.gold, 0.1, 4);
  };

  // ── THE PANTRY: a cold-lit cavity behind a door that folds down toward you ──
  const pmx = (pa + pb) / 2, pD = 0.16;
  // The cavity: always there, hidden by the door when it is shut.
  const glow = pantry * 0.6;
  K.face([[pa, y + pD, lo], [pb, y + pD, lo], [pb, y + pD, hi], [pa, y + pD, hi]], N, 'dash', -0.3, mix(CAVITY, PANTRY_LIGHT, pantry * 0.35), glow * 0.5);
  K.face([[pa, y, lo], [pb, y, lo], [pb, y + pD, lo], [pa, y + pD, lo]], [0, 0, 1], 'dash', -0.1, [190, 205, 215], glow * 0.3);
  K.face([[pa, y + pD, hi], [pb, y + pD, hi], [pb, y, hi], [pa, y, hi]], [0, 0, -1], 'dash', -0.5, CAVITY, 0);
  K.face([[pa, y, lo], [pa, y + pD, lo], [pa, y + pD, hi], [pa, y, hi]], [1, 0, 0], 'dash', -0.4, CAVITY, glow * 0.2);
  K.face([[pb, y + pD, lo], [pb, y, lo], [pb, y, hi], [pb, y + pD, hi]], [-1, 0, 0], 'dash', -0.4, CAVITY, glow * 0.2);
  if (pantry > 0.02) {
    // A glass shelf across the middle and whatever is on it, lit from a strip at the top.
    const sz = (lo + hi) / 2;
    K.box(pa + 0.005, y + 0.01, sz - 0.004, pb - 0.005, y + pD - 0.005, sz, 'dash', 0.3, [170, 215, 235], glow * 0.4);
    K.rod([pa + 0.01, y + 0.02, hi - 0.01], [pb - 0.01, y + 0.02, hi - 0.01], 0.005, 'dash', 0.4, PANTRY_LIGHT, 1, 4);
    const n = Math.max(0, Math.min(8, Math.round(num(L.pantryItems, 3))));
    const JARS = [[196, 82, 60], [226, 190, 90], [120, 170, 90], [230, 230, 220], [150, 60, 90]];
    for (let i = 0; i < n; i++) {
      const top = i % 2 === 0, x = pa + 0.03 + ((pb - pa - 0.06) * (Math.floor(i / 2) + 0.5)) / Math.max(1, Math.ceil(n / 2));
      const z0 = top ? sz : lo + 0.004, h = 0.03 + (i % 3) * 0.008;
      K.box(x - 0.016, y + 0.05, z0, x + 0.016, y + 0.09, z0 + h, 'dash', 0.2, JARS[i % JARS.length], glow * 0.15);
    }
    // The gantry screen: a pane of cold glass that rises out of the bottom of the opening as the door
    // drops, with a gold frame and a lit status line along its foot.
    const top = lo + (hi - lo) * smooth01(pantry), gy = y + 0.012;
    K.face([[pa + 0.01, gy, lo], [pb - 0.01, gy, lo], [pb - 0.01, gy, top], [pa + 0.01, gy, top]], N, 'dash', 0, PANTRY_GLASS, 1);
    K.rod([pa + 0.01, gy - 0.002, top], [pb - 0.01, gy - 0.002, top], 0.005, 'dash', 0.3, T.gold, 0.1, 4);
    K.rod([pa + 0.02, gy - 0.003, lo + 0.012], [pa + 0.02 + (pb - pa - 0.04) * pantry, gy - 0.003, lo + 0.012], 0.003, 'dash', 0.3, PANTRY_LIGHT, 1, 4);
    // Cold air spilling out: cold sinks, so the mist rolls over the sill and falls toward the carpet,
    // swelling and thinning as it goes. Arithmetic on the wall clock, so nothing is stored.
    const now = Date.now() / 1000, NP = 9;
    for (let i = 0; i < NP; i++) {
      const seed = Math.sin(i * 12.9898) * 43758.5453, r0 = seed - Math.floor(seed);
      const t = (now / (2.4 + r0 * 1.2) + i / NP) % 1;
      const x = pa + 0.02 + (pb - pa - 0.04) * ((i + 0.5) / NP) + Math.sin(now * 0.7 + i) * 0.01;
      const yy = y - 0.01 - t * 0.07, zz = lo + 0.01 - t * t * 0.09 + Math.sin(t * 3.1) * 0.012;
      const rad = (0.014 + t * 0.03) * pantry, col = STEAM[Math.min(2, Math.floor(t * 3))];
      // Two layers crossed, upright and lying flat, so a puff has body from the seat and from above.
      const up = [], flat = [];
      for (let k = 0; k < 10; k++) {
        const q = (k / 10) * TAU, c = Math.cos(q), sn = Math.sin(q);
        up.push([x + c * rad * 1.4, yy, zz + sn * rad]);
        flat.push([x + c * rad * 1.5, yy - sn * rad * 1.2, zz]);
      }
      K.face(up, [0, -1, 0], 'dash', 0, col, 1);
      K.face(flat, [0, 0, 1], 'dash', 0, col, 1);
    }
  }
  // The door is a ROLL-TOP: burl slats that roll up into the dash behind the grille, so the opening
  // clears from the bottom up. ⚠ It cannot hinge or slide: it is ~0.57 m tall against a cavity
  // 0.16 m deep, so folded down it stood out of the dash as a slab, and slid up it came out of the
  // dash top over the GPS.
  {
    const a = smooth01(pantry), zb = lo + a * (hi - lo);
    if (hi - zb > 0.004) {
      K.box(pa, y - 0.014, zb, pb, y, hi, 'dash', 0.2, T.burl);
      if (a < 0.01) veneer(K, [pmx, y - 0.014, (lo + hi) / 2], [1, 0, 0], [0, 0, 1], (pb - pa) / 2 - 0.012, (hi - lo) / 2 - 0.012, { dark: 0.95 });
      const pitch = 0.038;
      for (let k = 1; ; k++) {
        const z = zb + k * pitch;
        if (z > hi - 0.004) break;
        K.box(pa + 0.004, y - 0.0165, z - 0.0015, pb - 0.004, y - 0.014, z + 0.0015, 'dash', -0.3, [58, 32, 16]);
      }
      K.rod([pa, y - 0.017, zb], [pb, y - 0.017, zb], 0.005, 'dash', 0.3, T.gold, 0.1, 4);
    }
    const hp = [pmx, y - 0.03, Math.min(hi - 0.01, zb + 0.03)];
    if (hi - zb > 0.04) K.rod(add(hp, [-0.05, 0, 0]), add(hp, [0.05, 0, 0]), 0.007, 'dash', 0.4, T.gold, 0.1, 6);
    DRAKE_STORE_AT.pantry = a > 0.9 ? [pmx, y - 0.01, hi - 0.02] : hp;
    // Shut, it throws a shadow down its right and bottom edges.
    if (a < 0.01) { band(pa, pb, lo, -0.025, 2); shade([[pb, y - 0.0015, lo - 0.02], [pb + 0.02, y - 0.0015, lo - 0.02], [pb + 0.02, y - 0.0015, hi - 0.01], [pb, y - 0.0015, hi - 0.01]], N); }
  }

  // ── THE LOCKER: two drawers on runners, rolling out toward you ──
  // ⚠ It lives in the SIDE of the centre console, facing the pilot, not in the fascia: the console
  // stands in front of the fascia's right half, so drawers there slid out through the lever quadrant.
  // The drawer code below is written in the fascia's frame (front at y, depth +y, width along x) and
  // KL turns that frame a quarter round onto the console's inner face: (x, y, z) → (cx + y − y0, −x, z).
  const cs = cons ?? { x: la, y0: y, y1: y, top: hi };
  const LM = (p) => [cs.x + (p[1] - y), -p[0], p[2]];
  const LV = (v) => [v[1], -v[0], v[2]];
  const KL = {
    ...K,
    box: (x0, y0, z0, x1, y1, z1, ...r) => {
      const a = LM([x0, y0, z0]), b = LM([x1, y1, z1]);
      return K.box(Math.min(a[0], b[0]), Math.min(a[1], b[1]), z0, Math.max(a[0], b[0]), Math.max(a[1], b[1]), z1, ...r);
    },
    face: (pts, n, ...r) => K.face(pts.map(LM), LV(n), ...r),
    rod: (a, b, ...r) => K.rod(LM(a), LM(b), ...r),
    obox: (c, R, U, Nn, ...r) => K.obox(LM(c), LV(R), LV(U), LV(Nn), ...r),
    panel: (c, R, U, ...r) => K.panel(LM(c), LV(R), LV(U), ...r),
  };
  const lshade = (pts, n, layers = 1) => { for (let i = 0; i < layers; i++) KL.face(pts, n, 'dash', 0, SHADE_SOFT, 1); };
  const lEdge = (c, R, U, hr, hu) => {
    const p = (sr, su) => add(c, add(mul(R, sr * hr), mul(U, su * hu)));
    const q = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
    for (let i = 0; i < 4; i++) KL.rod(q[i], q[(i + 1) % 4], 0.004, 'dash', 0.3, T.gold, 0.1, 4);
  };
  {
    const la = -cs.y1, lb = -cs.y0, lo = fl + 0.06, hi = Math.min(cs.top - 0.04, fl + 0.40);
  const mid = (lo + hi) / 2, lmx = (la + lb) / 2, slide = smooth01(locker) * 0.14, lD = 0.14;
  const K = KL, shade = lshade, goldEdge = lEdge;
  const drawer = (z0, z1, stagger, isTop) => {
    const s = slide * stagger, yf = y - 0.014 - s;
    // The box: front, sides and floor, running back into the dash.
    K.box(la, yf, z0, lb, yf + 0.014, z1, 'dash', 0.2, T.burl);
    if (s > 0.002) {
      K.face([[la, yf + 0.014, z0], [la, yf + 0.014 + lD, z0], [la, yf + 0.014 + lD, z1], [la, yf + 0.014, z1]], [-1, 0, 0], 'dash', -0.2, T.walnutDk, 0);
      K.face([[lb, yf + 0.014 + lD, z0], [lb, yf + 0.014, z0], [lb, yf + 0.014, z1], [lb, yf + 0.014 + lD, z1]], [1, 0, 0], 'dash', -0.2, T.walnutDk, 0);
      // Inside: a dark felt floor and what is kept on it, rounds and a boxed side arm.
      const fz = z0 + 0.008;
      K.face([[la + 0.004, yf + 0.014, fz], [lb - 0.004, yf + 0.014, fz], [lb - 0.004, yf + 0.014 + lD, fz], [la + 0.004, yf + 0.014 + lD, fz]], [0, 0, 1], 'dash', -0.3, [60, 20, 26], 0);
      if (isTop) {
        for (let i = 0; i < 6; i++) K.rod([la + 0.03 + i * 0.022, yf + 0.03, fz], [la + 0.03 + i * 0.022, yf + 0.03, fz + 0.03], 0.006, 'dash', 0.4, [200, 160, 80], 0.05, 6);
      } else {
        K.box(la + 0.02, yf + 0.025, fz, lb - 0.05, yf + 0.11, fz + 0.022, 'dash', 0.3, [36, 36, 40]);
        K.box(lb - 0.045, yf + 0.03, fz, lb - 0.015, yf + 0.1, fz + 0.03, 'dash', 0.3, [90, 90, 96]);
      }
      // The opening it came out of goes dark behind it.
      shade([[la, y - 0.002, z0], [lb, y - 0.002, z0], [lb, y - 0.002, z1], [la, y - 0.002, z1]], N, 3);
    }
    const fy = yf - 0.0015;
    if (s < 0.002) veneer(K, [lmx, yf, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1], (lb - la) / 2 - 0.012, (z1 - z0) / 2 - 0.012, { dark: 0.95 });
    goldEdge([lmx, fy - 0.002, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1], (lb - la) / 2, (z1 - z0) / 2);
    const kp = [lmx, fy - 0.012, (z0 + z1) / 2];
    K.obox(kp, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, 0.012, 0.01, 'dash', 0.4, T.gold, 0.1);
    // Shadow under each drawer's front, longer the further it is out.
    const sl = 0.02 + s * 0.3;
    shade([[la, fy - 0.001, z0 - Math.min(sl, 0.05)], [lb, fy - 0.001, z0 - Math.min(sl, 0.05)], [lb, fy - 0.001, z0], [la, fy - 0.001, z0]], N, 2);
    return kp;
  };
  const kTop = drawer(mid + 0.01, hi, 1, true);
  drawer(lo, mid - 0.01, 0.8, false);
  DRAKE_STORE_AT.locker = LM(kTop);
  }

  // The kick plate: brass along the carpet, where a shoe would scuff the wood.
  for (const [a, b] of [[dxL, -hw], [hw, dxR]]) K.box(a, y - 0.006, fl, b, y, fl + 0.05, 'dash', 0.3, T.quackhawk ? T.gold : [176, 132, 70]);
  // And the carpet in front of the whole dash is in its shadow.
  shade([[dxL, y - 0.12, fl + 0.003], [dxR, y - 0.12, fl + 0.003], [dxR, y, fl + 0.003], [dxL, y, fl + 0.003]], [0, 0, 1], 2);
}

// A pocket cut in the dash top between the yoke and the pod, with the rudder pedals in it: the pedals
// themselves are down on the floor where no forward view reaches, so this is where you see them work.
const DRAKE_WELL = { x: 0.085, y0: 0.54, y1: 0.70, floor: -0.47 };
// A rudder pedal's hinge and swing, shared by the drawing and the click target.
function drakePedal(s, rud) {
  const Wl = DRAKE_WELL, press = clamp(s < 0 ? -rud : rud, 0, 1);
  const a = -0.5 + press * 1.05;                        // radians off upright; + is forward
  const dir = [0, Math.sin(a), Math.cos(a)];
  const piv = [s * 0.042, Wl.y1 - 0.06, Wl.floor + 0.006], len = 0.09;
  return { press, dir, piv, len, pad: add(piv, mul(dir, len * 0.62)) };
}

// ── THE WHEEL, AS DATA ───────────────────────────────────────────────────────
// An F1-style wheel: a wide carbon body with shoulders, a screen under a row of shift lights, a
// few coloured buttons, two rotaries along the bottom and a rubber grip hanging off each side.
// Metres at full size, x right and y up about the hub. ⚠ ONE TABLE, TWO DRAWERS: the 3-D yoke
// below and the external view's canvas in cockpit.js both draw it, so the wheel you see from
// outside is the wheel in the cockpit. Every polygon is convex, because a face is fanned.
export const DRAKE_WHEEL = {
  body: [
    [[-0.125, 0.045], [-0.095, 0.06], [0.095, 0.06], [0.125, 0.045], [0.135, 0.02], [-0.135, 0.02]],
    [[-0.10, 0.02], [0.10, 0.02], [0.085, -0.045], [0.07, -0.068], [-0.07, -0.068], [-0.085, -0.045]],
  ],
  // The right grip; the left is its mirror.
  grip: [[0.098, 0.018], [0.134, 0.022], [0.146, -0.02], [0.146, -0.105], [0.132, -0.118], [0.116, -0.114], [0.104, -0.06]],
  leds: { y: 0.05, x0: -0.065, dx: 0.013, n: 11 },
  screen: [-0.046, -0.024, 0.046, 0.036],
  // A handful of the real wheel's buttons: two on each shoulder, two either side of the screen.
  buttons: [
    // Dressed as the Drake is: ivory buttons in gold, the one red one the gun trigger, and a
    // green jewel for the quack, the colour of the head.
    { x: -0.108, y: 0.037, r: 0.009, rgb: [236, 226, 200] },
    { x: -0.084, y: 0.042, r: 0.008, rgb: [230, 186, 88] },
    { x: 0.084, y: 0.042, r: 0.008, rgb: [230, 186, 88] },
    { x: 0.108, y: 0.037, r: 0.009, rgb: [236, 226, 200] },
    { x: -0.066, y: -0.012, r: 0.008, rgb: [200, 36, 30] },
    { x: 0.066, y: -0.012, r: 0.008, rgb: [40, 150, 110] },
  ],
  knobs: [{ x: -0.036, y: -0.048, r: 0.012, rgb: [230, 186, 88] }, { x: 0.036, y: -0.048, r: 0.012, rgb: [236, 226, 200] }],
  // The thumb rotaries at the top of each grip: gold.
  wheels: [{ x: -0.112, y: 0.01, rgb: [230, 186, 88] }, { x: 0.112, y: 0.01, rgb: [230, 186, 88] }],
  // Burl walnut for the body, its figure in a darker walnut, and grips in the walls' green leather.
  carbon: [124, 74, 38], weave: [112, 66, 33], rubber: [30, 92, 70], bead: [230, 186, 88],
};
const DW = DRAKE_WHEEL;
// Noir: black carbon for the body, a charcoal weave in it, black leather grips; the gold stays.
const DW_NOIR = { carbon: [22, 22, 25], weave: [34, 34, 38], rubber: [16, 16, 18] };
TEXTURE.set(DW_NOIR.carbon, 'fabric'); TEXTURE.set(DW_NOIR.rubber, 'leather');
SHINY.set(DW_NOIR.carbon, { spec: 0.55, pow: 46, coat: 0.55 });
// Quackhawk Down: a navy candy-lacquer body, white hide grips with a red bead, and chrome where the gold was.
const QH_CHROME = DRAKE_TRIM_QUACKHAWK.gold;
const DW_QH = { carbon: DRAKE_TRIM_QUACKHAWK.walnut, weave: DRAKE_TRIM_QUACKHAWK.burl, rubber: DRAKE_TRIM_QUACKHAWK.cream, bead: QH_CHROME,
  buttons: DW.buttons.map(b => ({ ...b, rgb: b.rgb[0] === 230 ? QH_CHROME : b.rgb[1] === 150 ? [26, 40, 110] : b.rgb })),
  knobs: DW.knobs.map((k, i) => ({ ...k, rgb: i ? [200, 24, 40] : QH_CHROME })), wheels: DW.wheels.map(w => ({ ...w, rgb: QH_CHROME })) };
const dwOf = () => (T.noir ? { ...DW, ...DW_NOIR } : T.quackhawk ? { ...DW, ...DW_QH } : DW);
// The yoke's figure and the grips' perforation are drawn per pixel by the GL solids pass rather than as
// geometry (see the weave and the grips in drakeFit): the yoke is rebuilt every frame it moves.
TEXTURE.set(DW.carbon, 'wood'); TEXTURE.set(DW.rubber, 'leather');
// Drawn at this fraction of full size: small enough to clear the switch strips either side.
const DRAKE_WHEEL_SC = 0.72;
// ── THE GPS ──────────────────────────────────────────────────────────────────
// A screen on a walnut stand on the dash, left of the pod, leaning back like the clock opposite.
// Its MODE button, bottom right of the bezel, is a control like any other (drakeHotspots).
// Square to the pilot's eye (facingPanel), so it reads without leaning.
const GPS_O = [-0.43, 0.47, -0.24];
const gpsPanel = (K) => facingPanel(K, GPS_O, 'dash', 0.3);
// The four mode tabs along the bezel's foot, one per mode, each clicked directly (ids gps0..gps3).
// ⚠ They replaced one unlabelled MODE button in the corner that cycled, which nobody could find.
const GPS_TAB_W = 0.047, GPS_TAB_Y = -0.083;
const gpsTabX = (i) => -0.0735 + i * 0.049;
const GPS_TAB_NAMES = ['MAP', 'RADAR', 'DMG', 'AMMO'];
const GPS_MODES = ['MAP', 'RADAR', 'DAMAGE', 'AMMO'];
// The clickable controls, in shell metres: { id, p, r, kind }. 'click' toggles; 'yoke' drags both
// axes; 'throttle' drags up and down.
export function drakeHotspots(live) {
  const L = live || {};
  const out = [];
  for (const strip of Object.values(DRAKE_STRIPS)) {
    const Sp = facingPanel(makeKit(() => {}), strip.o);
    for (const [id, u] of Object.entries(strip.at)) out.push({ id, p: Sp.pt(u, 0, 0.01), r: 0.019, kind: 'click' });
  }
  { const Gk = gpsPanel(makeKit(() => {})); for (let i = 0; i < 4; i++) out.push({ id: 'gps' + i, p: Gk.pt(gpsTabX(i), GPS_TAB_Y, 0.006), r: 0.02, kind: 'click' }); }
  out.push({ id: 'throttle', p: add(drakeThrottleKnob(clamp(num(L.throttle), 0, 1)), [0, 0, 0.015]), r: 0.035, kind: 'throttle' });
  DRAKE_LEVER_AT.modes.forEach((p, k) => { if (p) out.push({ id: 'mode' + k, p, r: 0.022, kind: 'click' }); });
  if (DRAKE_LEVER_AT.conv) out.push({ id: 'modelever', p: DRAKE_LEVER_AT.conv, r: 0.03, kind: 'click' });
  out.push({ id: 'trim', p: add(DRAKE_TRIM_WHEEL.c, [0, 0, DRAKE_TRIM_WHEEL.r]), r: 0.045, kind: 'trim' });
  // A click steps the convergence; the mouse wheel over it fine-tunes it (cockpit.js).
  out.push({ id: 'conv', p: add(DRAKE_CONV_KNOB.c, [0, 0, 0.02]), r: 0.02, kind: 'click' });
  // The two compartments under the dash, at their handles (drakeFascia records where those are).
  for (const id of ['pantry', 'locker']) if (DRAKE_STORE_AT[id]) out.push({ id, p: DRAKE_STORE_AT[id], r: 0.05, kind: 'click' });
  // The RAMP button on the console, where drakeFit draws it (Cn.pt(0.085, -0.13) turned onto its side
  // panel, 0.014 proud). Usually below the forward view; clickable whenever the head is turned to it.
  out.push({ id: 'ramp', p: [0.535, -0.12, -0.603], r: 0.022, kind: 'click' });
  // The yoke is roll and pitch only; the pedals are the rudder, held like the ,/. keys. ⚠ THE RADII
  // KEEP CLEAR OF EACH OTHER: the hit test takes the nearest centre inside a radius, and a yoke
  // target as big as the wheel would reach the pedals behind it and the switch strips beside it.
  out.push({ id: 'yoke', p: drakeYokeHub(clamp(num(L.stickY), -1, 1)), r: 0.065, kind: 'yoke' });
  const rud = clamp(num(L.rudder), -1, 1);
  for (const s of [-1, 1]) out.push({ id: s < 0 ? 'rudderL' : 'rudderR', p: drakePedal(s, rud).pad, r: 0.026, kind: 'rudder' });
  return out;
}

// The GPS, drawn. Four modes off one screen: a heading-up MAP with the nearest fields, a RADAR with
// the traffic (aircraft amber with a heading tick, vehicles blue), a DAMAGE plan of the Drake, and
// AMMO. Everything arrives in `live.gps` relative to the aircraft in tiles (cockpit.js drakeGps).
function drakeGpsScreen(K, L) {
  const G = L.gps || { mode: 0, contacts: [], fields: [], hull: 100, ammo: 0, ammoCap: 1, msl: 0, hdg: 0 };
  const Gp = gpsPanel(K);
  // The stand, behind and under the screen.
  const b0 = Gp.pt(-0.1, -0.09, -0.04), b1 = Gp.pt(0.1, -0.09, -0.04);
  K.box(Math.min(b0[0], b1[0]), GPS_O[1] + 0.02, -0.40, Math.max(b0[0], b1[0]), GPS_O[1] + 0.09, b0[2], 'dash', 0.1, T.walnutDk);
  Gp.plate(roundRect(-0.128, -0.098, 0.128, 0.098, 0.02), T.gold, 0.05, -0.001);
  Gp.plate(roundRect(-0.118, -0.088, 0.118, 0.088, 0.016), T.walnutDk, 0, 0.0005);
  Gp.plate(roundRect(-0.100, -0.070, 0.100, 0.068, 0.008), [6, 20, 16], 0.9, 0.0015);
  plated(Gp, GPS_MODES[G.mode] || 'MAP', 0, 0.078, 0.011);
  // The mode tabs: raised gold keys, the live one lit green and pressed in a little.
  for (let i = 0; i < 4; i++) {
    const x = gpsTabX(i), on = (G.mode || 0) === i, hw = GPS_TAB_W / 2, hh = 0.0105;
    const press = L.press === 'gps' + i, top = on || press ? 0.0035 : 0.0055;
    Gp.plate(roundRect(x - hw + 0.001, GPS_TAB_Y - hh - 0.0025, x + hw + 0.001, GPS_TAB_Y + hh - 0.0025, 0.004), SHADE_SOFT, 1, 0.0018);
    Gp.plate(roundRect(x - hw, GPS_TAB_Y - hh, x + hw, GPS_TAB_Y + hh, 0.004), on ? [40, 120, 80] : T.goldDk, on ? 0.6 : 0, top - 0.001);
    Gp.plate(roundRect(x - hw + 0.0015, GPS_TAB_Y - hh + 0.0025, x + hw - 0.0015, GPS_TAB_Y + hh - 0.0005, 0.003), on ? [70, 200, 130] : T.gold, on ? 0.8 : 0.05, top);
    hudText(Gp, GPS_TAB_NAMES[i], x, GPS_TAB_Y, 0.0068, on ? [220, 255, 230] : [60, 38, 18], top + 0.0006);
  }
  const GR = [110, 255, 170], AM = [255, 190, 70], BL = [90, 190, 255], RD = [255, 80, 60], DIM = [30, 90, 60];
  const cy = -0.002, R = 0.06, L0 = 0.0035;
  const h = (G.hdg || 0) * Math.PI / 180, ch = Math.cos(h), sh = Math.sin(h);
  // World (dx, dy tiles; +y south) to screen, heading up.
  const toS = (dx, dy, range) => {
    const sx = dx * ch + dy * sh, fw = dx * sh - dy * ch;
    return [sx / range * R, cy + fw / range * R];
  };
  const inScreen = ([x, y]) => Math.abs(x) < 0.095 && Math.abs(y - cy) < 0.064;
  const ship = () => Gp.plate([[0, cy + 0.009], [-0.006, cy - 0.006], [0, cy - 0.003], [0.006, cy - 0.006]], GR, 1, L0 + 0.001);
  const mode = G.mode || 0;
  if (mode === 0) {
    // MAP: a faint grid, north, the fields as gold squares, 40 tiles to the edge.
    for (const d of [-0.04, 0, 0.04]) { Gp.rect(d - 0.0006, cy - 0.064, d + 0.0006, cy + 0.064, DIM, 1, L0); Gp.rect(-0.095, cy + d - 0.0006, 0.095, cy + d + 0.0006, DIM, 1, L0); }
    for (const f of G.fields || []) {
      const q = toS(f.dx, f.dy, 40);
      if (!inScreen(q)) continue;
      Gp.rect(q[0] - 0.004, q[1] - 0.004, q[0] + 0.004, q[1] + 0.004, T.gold, 1, L0 + 0.0005);
    }
    const n = toS(0, -30, 40), nl = Math.hypot(n[0], n[1] - cy) || 1, nx = n[0] / nl * 0.055, ny = cy + (n[1] - cy) / nl * 0.055;
    Gp.disc(nx, ny, 0.005, RD, 1, L0 + 0.0005, 8);
    ship();
  } else if (mode === 1) {
    // RADAR: three range rings, a sweep, and the traffic within 12 tiles.
    for (const k of [1, 0.66, 0.33]) Gp.annulus(0, cy, R * k - 0.0006, R * k + 0.0006, DIM, 1, L0, 32);
    const sw = (typeof performance !== 'undefined' ? performance.now() : 0) / 700;
    Gp.spoke(0, cy, Math.PI / 2 - sw, 0, R, 0.0012, GR, 1, L0 + 0.0003);
    for (const c of G.contacts || []) {
      const q = toS(c.dx, c.dy, 12);
      if (Math.hypot(q[0], q[1] - cy) > R) continue;
      const col = c.ground ? BL : AM;
      Gp.disc(q[0], q[1], 0.0038, col, 1, L0 + 0.001, 8);
      if (!c.ground) { const a = Math.PI / 2 - ((c.hdg || 0) - (G.hdg || 0)) * Math.PI / 180; Gp.spoke(q[0], q[1], a, 0.004, 0.011, 0.0008, col, 1, L0 + 0.001); }
    }
    ship();
  } else if (mode === 2) {
    // DAMAGE: the Drake in plan, each part the colour of its state, and the hull as a bar.
    const hull = clamp((G.hull ?? 100) / 100, 0, 1), sf = G.surf || {};
    const hc = (v) => (v <= 0 ? RD : v < 0.5 ? AM : GR);
    const body = []; for (let i = 0; i < 14; i++) { const t = (i / 14) * TAU; body.push([Math.cos(t) * 0.012, cy + 0.005 + Math.sin(t) * 0.042]); }
    Gp.plate(body, hc(hull), 1, L0);
    Gp.disc(0, cy + 0.052, 0.009, hc(hull), 1, L0, 10);
    Gp.plate([[-0.012, cy + 0.01], [-0.07, cy - 0.002], [-0.07, cy - 0.014], [-0.012, cy - 0.006]], hc(sf.leftWing ?? 1), 1, L0);
    Gp.plate([[0.012, cy + 0.01], [0.07, cy - 0.002], [0.07, cy - 0.014], [0.012, cy - 0.006]], hc(sf.rightWing ?? 1), 1, L0);
    Gp.plate([[-0.004, cy - 0.036], [0.004, cy - 0.036], [0.004, cy - 0.058], [-0.004, cy - 0.058]], hc(sf.tail ?? 1), 1, L0);
    Gp.plate([[-0.018, cy - 0.052], [0.018, cy - 0.052], [0.018, cy - 0.058], [-0.018, cy - 0.058]], hc(sf.rudder ?? 1), 1, L0);
    Gp.bar(0.085, cy - 0.055, cy + 0.055, 0.006, hull, hc(hull));
  } else {
    // AMMO: rounds left in lit figures with a bar under them, and a pip per missile.
    Gp.digits(-0.07, cy - 0.005, 0.03, String(Math.round(G.ammo || 0)).padStart(4, ' '), AM, true);
    const f = clamp((G.ammo || 0) / (G.ammoCap || 1), 0, 1);
    Gp.rect(-0.07, cy - 0.03, 0.07, cy - 0.022, DIM, 1, L0);
    if (f > 0.001) Gp.rect(-0.07, cy - 0.03, -0.07 + 0.14 * f, cy - 0.022, f < 0.2 ? RD : AM, 1, L0 + 0.0005);
    for (let i = 0; i < Math.min(8, G.msl || 0); i++) Gp.rect(-0.07 + i * 0.018, cy - 0.052, -0.058 + i * 0.018, cy - 0.04, GR, 1, L0);
  }
}

// ── CONTACT SHADOWS ──────────────────────────────────────────────────────────
// The cabin renderer casts no shadows, so each thing that stands out lays a soft one on what is under
// it: two translucent ellipses, a wide faint one and a tighter dark core, flat on the receiving surface
// and pushed away from the light, which comes in through the screen ahead and above. Cheap, and it is
// most of what makes an object sit ON a surface instead of hovering in front of it.
function drakeShadows(K, P, L) {
  const dTop = P.dashZ, dY0 = P.dashY, fl = P.drake.floorZ, xC = P.xCentre;
  // An ellipse on the plane through c spanned by u (half-width a) and v (half-depth b), facing n.
  const blob = (c, u, v, n, a, b) => {
    for (const [k, rgb] of [[1, SHADE_SOFT], [0.62, SHADE_CORE]]) {
      const pts = [];
      for (let i = 0; i < 18; i++) { const t = (i / 18) * TAU; pts.push(add(add(add(c, mul(n, 0.0015 + (1 - k) * 0.0006)), mul(u, Math.cos(t) * a * k)), mul(v, Math.sin(t) * b * k))); }
      K.face(pts, n, 'dash', 0, rgb, 1);
    }
  };
  const up = [0, 0, 1], X = [1, 0, 0], Yv = [0, 1, 0], Zv = [0, 0, 1];
  // The instrument pod on the dash top, falling back toward the pilot.
  blob([0, dY0 + 0.02, dTop], X, Yv, up, 0.36, 0.05);
  // The yoke on the fascia behind it, a little below its hub.
  const hub = drakeYokeHub(clamp(num(L.stickY), -1, 1));
  blob([hub[0], dY0 - 0.001, hub[2] - 0.06], X, Zv, [0, -1, 0], 0.13, 0.07);
  // The GPS and the clock on the dash top.
  blob([GPS_O[0], GPS_O[1] + 0.04, dTop], X, Yv, up, 0.14, 0.05);
  blob([xC + 0.64, dY0 + 0.16, dTop], X, Yv, up, 0.1, 0.05);
  // The throttle quadrant.
  const [tx, ty, tz] = DRAKE_THROTTLE.pivot;
  blob([tx, ty + 0.01, tz - 0.05], X, Yv, up, 0.05, 0.1);
  // The captain's chair on the carpet.
  blob([0, (P.seatY[0] + P.seatY[1]) / 2 - 0.05, fl], X, Yv, up, 0.32, 0.36);
}

// ── CACHED HELPERS ───────────────────────────────────────────────────────────
// Each helper above is pure in its arguments (no clock: the eased switches are below this line), so
// it is cached as ONE call through the kit's `group` (interior-memo.js) — which is what makes a
// hundred one-face grain lines cost one check. The profile is closed over rather than passed, since
// the cache already lives on the profile.
const plated = (Pn, ...a) => Pn.group('plated', plated_, ...a);
const engraved = (Pn, ...a) => Pn.group('engraved', engraved_, ...a);
const hudText = (Pn, ...a) => Pn.group('hudText', hudText_, ...a);
const nameplate = (Pn, ...a) => Pn.group('nameplate', nameplate_, ...a);
// ⚠ THE DIAL IS CACHED WITHOUT ITS NEEDLES. The needle angle is live, and with it among the group's
// arguments every moving dial rebuilt its bezel, chapter ring, ticks and glass every frame (~150 faces)
// to move two. The body is cached on everything but the needles; the needles are drawn fresh.
const luxDial = (Pn, ca, cb, R, frac, o = {}) => {
  const body = o.frac2 == null ? o : { ...o, frac2: undefined };
  Pn.group('luxDial', luxDial_, ca, cb, R, null, body);
  luxHands(Pn, ca, cb, R, frac, o);
};
const goldRim = (Pn, ...a) => Pn.group('goldRim', goldRim_, ...a);
const woodGrain = (Pn, ...a) => Pn.group('woodGrain', woodGrain_, ...a);
const modeDial = (Pn, ...a) => Pn.group('modeDial', modeDial_, ...a);
const veneer = veneer_;   // returns its panel, which a cached group cannot hand back
const padGrid = (K, ...a) => K.group('padGrid', padGrid_, ...a);
const furRoll = (K, ...a) => K.group('furRoll', furRoll_, ...a);
const luxSeat = (K, cx, P, seed) => K.group('luxSeat', (k, c2, s2) => luxSeat_(k, c2, P, s2), cx, seed);
const captainChair = (K, P) => K.group('captainChair', (k) => captainChair_(k, P));

// ── THE SWITCHES MOVE ────────────────────────────────────────────────────────
// A toggle swings between its stops and a push-button dips and springs back, instead of either
// snapping. The fit-out is a pure function of the live state, so the motion is kept here: one eased
// value per control, stepped by wall time, and a press pulse started whenever a control's state
// changes. Module state is fine because there is one Drake cockpit on screen at a time.
const SW_ANIM = new Map();
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function eased(id, target, rate = 16) {
  const t = nowMs();
  let a = SW_ANIM.get(id);
  if (!a) { a = { v: target, t }; SW_ANIM.set(id, a); return target; }
  const dt = Math.min(0.1, Math.max(0, (t - a.t) / 1000));
  a.t = t;
  a.v += (target - a.v) * (1 - Math.exp(-rate * dt));
  return a.v;
}
// 0 at rest, rising to 1 and back over PRESS_MS after the watched state changes.
const PRESS_MS = 240;
function pressPulse(id, state) {
  const t = nowMs(), key = 'p:' + id;
  let a = SW_ANIM.get(key);
  if (!a) { SW_ANIM.set(key, { last: state, at: -1e9 }); return 0; }
  if (a.last !== state) { a.last = state; a.at = t; }
  const p = (t - a.at) / PRESS_MS;
  return p >= 0 && p < 1 ? Math.sin(p * Math.PI) : 0;
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function drakeFit(P, live, push) {
  T = trimOf(P);
  const K = makeKit(push);
  const L = live || {};
  const pitch = num(L.pitch), bank = num(L.bank), hdg = num(L.hdg);
  const ias = Math.max(0, num(L.ias)), alt = Math.max(0, num(L.alt)), vsi = num(L.vsi);
  const rpm = clamp(num(L.rpm, 1), 0, 1.05), thr = clamp(num(L.throttle), 0, 1);
  const fuel = clamp(num(L.fuel, 1), 0, 1), powered = L.powered !== false;
  const wings = clamp(num(L.wings), 0, 1), fold = clamp(num(L.rotorFold), 0, 1);
  const convert = clamp(num(L.convert, Math.max(wings, fold)), 0, 1);
  const pusher = clamp(num(L.pusher, wings > 0.5 ? thr : 0.1), 0, 1);
  const hour = num(L.hour, 10.15);
  const ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1), rud = clamp(num(L.rudder), -1, 1);
  const xC = P.xCentre, fl = P.drake.floorZ;

  // ── THE DASH: walnut across the face, below the eye line ─────────────────
  const dTop = P.dashZ, dY0 = P.dashY, dY1 = dY0 + 0.26;
  const dxL = xC - 0.62, dxR = xC + 0.62;
  // In four pieces round the pedal well; each piece's inner face is one wall of it.
  const Wl0 = DRAKE_WELL, wx = 0;   // on the yoke's line, which is the pilot's
  for (const [a, b, c, d] of [
    [dxL, dY0, dxR, Wl0.y0], [dxL, Wl0.y1, dxR, dY1], [dxL, Wl0.y0, wx - Wl0.x, Wl0.y1], [wx + Wl0.x, Wl0.y0, dxR, Wl0.y1],
  ]) {
    K.box(a, b, dTop - 0.06, c, d, dTop, 'dash', 0.3, T.walnut);
    veneer(K, [(a + c) / 2, (b + d) / 2, dTop], [1, 0, 0], [0, 1, 0], (c - a) / 2, (d - b) / 2);
  }
  K.rod([dxL, dY0 - 0.004, dTop - 0.004], [dxR, dY0 - 0.004, dTop - 0.004], 0.012, 'dash', 0.3, T.gold, 0.1, 6);   // the gold roll on its edge
  // The fascia under it, down to the carpet, burl and walnut in alternating panels with a gold inlay.
  // The locker sits in the centre console's inner face (cX − cw, below; kept in step by hand).
  drakeFascia(K, L, { dxL, dxR, dY0, fl, zTop: dTop - 0.06, rud, cons: { x: xC + 0.30, y0: dY0 - 0.34, y1: dY0 - 0.03, top: -0.62 } });

  // ── THE PILOT'S PANEL: the flight instruments, in a walnut pod ───────────
  // ⚠ ITS TOP STAYS UNDER THE EYE LINE: the forward view is the right eye, just to the right of
  // this, and a pod whose header rose past z 0 would stand across it. The gate casts the ray.
  const po = [0, 0.49, -0.208];   // centred under the screen, straight ahead of the pilot
  // HDR: the header band over the gauges, the name's ALONE, so a long one ('QUACKHAWK DOWN') reads
  // the full width. FTR: the strip under the gauges, where the fuel bar and the jewel lamps live.
  const HW = 0.30, HH = 0.048, HDR = 0.07, FTR = 0.03;
  const mid = (HDR - FTR) / 2, half = HH + (HDR + FTR) / 2;   // the housing spans footer + gauges + header
  const back = panelCorners(add(po, [0, 0, mid]), HW + 0.02, half + 0.02, 0.06);
  const front = panelCorners(add(po, [0, 0, mid]), HW + 0.02, half + 0.02, -0.004);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, n = norm(cross(sub(front[j], front[i]), sub(back[i], front[i])));
    K.face([front[i], front[j], back[j], back[i]], dot(n, front[i]) > 0 ? mul(n, -1) : n, 'dash', 0.1, T.walnutDk, 0);
  }
  const Pn = facingPanel(K, po);
  Pn.plate(roundRect(-HW - 0.012, -HH - FTR - 0.012, HW + 0.012, HH + HDR + 0.012, 0.03), T.gold, 0.05, 0);
  Pn.plate(roundRect(-HW, -HH - FTR, HW, HH + HDR, 0.024), T.burl, 0, 0.001);
  woodGrain(Pn, -HW + 0.012, -HH - FTR + 0.012, HW - 0.012, HH + HDR - 0.012, 0.0014);
  goldBead(K, Pn, HW + 0.006, HH + 0.006, HDR, FTR);
  // The name across the top of the gauges: the one thing on the panel that is not an instrument.
  nameplate(Pn, 0, HH + HDR / 2 - 0.004, 0.026, (live && live.plate) || (T.quackhawk ? 'QUACKHAWK DOWN' : T.noir ? 'DARKWING' : 'DRAKE'), 2 * HW - 0.03);
  // ⚠ ONE ROW OF SEVEN, so the pod is short enough to leave the yoke room under it in the forward
  // view. It was two rows of four and reached the bottom of the frame on its own.
  const R = 0.036, gx = (i) => -0.255 + i * 0.085;
  luxDial(Pn, gx(0), 0, R, clamp(ias / 200, 0, 1), { ticks: 20, major: 4, arcs: [[0.08, 0.55, C.green], [0.55, 0.82, C.amber]], red: 0.9 });
  Pn.attitude(gx(1), 0, R, pitch, bank); goldRim(Pn, gx(1), 0, R);
  luxDial(Pn, gx(2), 0, R, (alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (alt % 10000) / 10000 });
  // The dual tacho: the rotor and the pusher, which in this aircraft are the two things you fly on.
  luxDial(Pn, gx(3), 0, R, clamp(rpm * (1 - fold), 0, 1), { ticks: 10, major: 2, frac2: pusher, hand2: C.amber, arcs: [[0.85, 0.95, C.green]], red: 0.97 });
  Pn.compass(gx(4), 0, R, hdg); goldRim(Pn, gx(4), 0, R);
  luxDial(Pn, gx(5), 0, R, clamp(0.5 + vsi / 3000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2 });
  modeDial(Pn, gx(6), 0, R, wings, fold);
  // Fuel along the left of the footer, and the jewel lamps along its right: off the header, so
  // nothing sits beside the name.
  const hv = -HH - FTR / 2 + 0.002, fz = fuel < 0.15 ? C.red : C.green;
  Pn.rect(-0.27, hv - 0.007, -0.13, hv + 0.007, C.black, 0, 0.003);
  Pn.rect(-0.268, hv - 0.005, -0.268 + 0.136 * fuel, hv + 0.005, fz, 0.85, 0.005);
  [[fuel < 0.15, C.amber], [rpm < 0.85 && powered && fold < 0.5, C.red], [!!L.stall, C.red], [!powered, C.amber]]
    .forEach(([lit, rgb], i) => {
      Pn.disc(0.165 + i * 0.03, hv, 0.011, T.gold, 0.1, 0.002, 10);
      Pn.disc(0.165 + i * 0.03, hv, 0.0075, lit ? rgb : rgb.map((c) => c * 0.2), lit ? 1 : 0, 0.0035, 8);
    });

  // ── THE MIDDLE OF THE DASH: the clock, on a walnut stand both seats can see ──
  const mo = [xC + 0.64, dY0 + 0.12, dTop + 0.075];
  // Square to the pilot's eye, like the GPS opposite: fixed to the dash it leaned away and read edge-on.
  const Mp = facingPanel(K, mo, 'dash', 0.3);
  Mp.plate(roundRect(-0.08, -0.08, 0.08, 0.08, 0.03), T.walnutDk, 0, -0.002);
  K.box(xC + 0.64 - 0.09, dY0 + 0.08, dTop, xC + 0.64 + 0.09, dY0 + 0.20, dTop + 0.02, 'dash', 0.2, T.walnutDk);
  // Black enamel, gold hands, the hour of the world outside.
  const hh = ((hour % 12) + 12) % 12;
  luxDial(Mp, 0, 0, 0.052, hh / 12, { a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, face: T.enamel, ink: T.gold, hand: T.gold, hand2: T.gold, frac2: (hour % 1), glow: 0.1 });

  // ── THE SWITCH STRIPS: every switch the pilot needs, either side of the yoke ──
  // ⚠ THEY FACE THE EYE AND SIT IN THE FORWARD VIEW. The switches used to lie flat on the dash top at
  // the left edge, half of them under the frame, and a control you have to look down for is one you
  // cannot click while flying. Where each one is lives in DRAKE_STRIPS, which drakeHotspots reads
  // too, so the thing drawn and the thing clicked cannot drift apart.
  const armed = !!L.gunsArmed, gearV = clamp(num(L.gear, 1), 0, 1);
  const lamp = (Sp, u, v, on, rgb) => Sp.disc(u, v, 0.005, on ? rgb : rgb.map((c) => c * 0.22), on ? 1 : 0, 0.0045, 8);
  // A push-button that BULGES: a short skirt out of a dark gap in its bezel, then a domed cap whose
  // facets each carry their own normal, so the light rolls over it instead of lying flat on a disc.
  // A soft shadow falls below-right of it on the bezel, and a glint sits up on the dome. `top` is the
  // height of the apex off the panel; pressing lowers it, and the shadow shrinks as it goes in.
  // ⚠ CACHED ON WHAT IT LOOKS LIKE, through the panel's own group: a button that is not moving is
  // built once, where every button was rebuilt every frame. The yoke's still miss while the stick
  // moves (their panel moves with it), which is right.
  const domeBtn = (Sp, u, v, top, r, rgb, emis, id) => {
    Sp.group('domeBtn', domeBtnBody, u, v, top - (L.press === id ? 0.004 : 0), r, rgb, emis);
  };
  const domeBtnBody = (Sp, u, v, t, r, rgb, emis) => {
    // A small button (the yoke's) is a few millimetres across: 8 sides and two rings is still round there.
    const small = r < 0.01, cap = r * 0.55, seg = small ? 8 : 12, rings = small ? 2 : 3;
    Sp.disc(u, v, r * 1.18, [18, 12, 8], 0, 0.0040, seg);                          // the gap round it
    const sOff = Math.max(0.001, t - 0.004) * 0.35;
    Sp.disc(u + sOff, v - sOff * 1.2, r * 1.12, SHADE_SOFT, 1, 0.0042, seg);          // its shadow
    Sp.disc(u + sOff * 0.5, v - sOff * 0.6, r * 1.02, SHADE_SOFT, 1, 0.0043, seg);
    K.rod(Sp.pt(u, v, 0.0045), Sp.pt(u, v, t - cap), r, 'dash', 0.25, rgb.map((c) => c * 0.8), emis * 0.7, seg, false);
    const P = (rad, a, z) => add(Sp.pt(u + Math.cos(a) * rad, v + Math.sin(a) * rad, z), [0, 0, 0]);
    for (let i = 0; i < rings; i++) {
      const f0 = (i / rings) * Math.PI / 2, f1 = ((i + 1) / rings) * Math.PI / 2, fm = (f0 + f1) / 2;
      const r0 = r * Math.cos(f0), r1 = r * Math.cos(f1), z0 = t - cap + cap * Math.sin(f0), z1 = t - cap + cap * Math.sin(f1);
      const shade = 0.82 + 0.28 * Math.sin(fm);                     // brighter toward the crown
      const col = rgb.map((c) => Math.min(255, c * shade));
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * TAU, a1 = ((j + 1) / seg) * TAU, am = (a0 + a1) / 2;
        const n = norm(add(mul(Sp.n, Math.sin(fm)), add(mul(Sp.r, Math.cos(fm) * Math.cos(am)), mul(Sp.u, Math.cos(fm) * Math.sin(am)))));
        const pts = i === rings - 1 ? [P(r0, a0, z0), P(r0, a1, z0), P(0, 0, z1)] : [P(r0, a0, z0), P(r0, a1, z0), P(r1, a1, z1), P(r1, a0, z1)];
        K.face(pts, n, 'dash', 0.35, col, emis);
      }
    }
    // The glint: up and to the left, where the cabin light catches the curve.
    Sp.disc(u - r * 0.32, v + r * 0.32, r * 0.22, mix(rgb, [255, 255, 255], 0.75), Math.max(emis, 0.4), t - cap * 0.25, 8);
  };
  for (const strip of Object.values(DRAKE_STRIPS)) {
    const Sp = facingPanel(K, strip.o);
    const hw = strip.hw;
    Sp.plate(roundRect(-hw - 0.008, -0.064, hw + 0.008, 0.058, 0.014), T.gold, 0.05, 0);
    Sp.plate(roundRect(-hw - 0.002, -0.058, hw + 0.002, 0.052, 0.011), T.walnutDk, 0, 0.001);
    woodGrain(Sp, -hw + 0.004, -0.054, hw - 0.004, 0.048, 0.0022, { dark: 0.62 });
    // The pod's shadow: each strip sits a step below the instrument pod, and the pod's overhang
    // shades its top edge — layered see-through black, darkest under the lip, strongest inboard.
    {
      const inb = strip.o[0] < 0 ? 1 : -1;
      for (let i = 0; i < 5; i++) {
        const d = 0.010 + i * 0.012;
        Sp.plate(roundRect(-hw - 0.002, 0.052 - d, hw + 0.002, 0.052, 0.006), SHADE_SOFT, 1, 0.0024 + i * 0.0001);
      }
      for (let i = 0; i < 3; i++) {
        const w = 0.02 + i * 0.02, e = inb * (hw + 0.002);
        Sp.plate(roundRect(Math.min(e, e - inb * w), -0.058, Math.max(e, e - inb * w), 0.052, 0.006), SHADE_SOFT, 1, 0.0030 + i * 0.0001);
      }
    }
    // ⚠ THE LABELS ARE UNDER THE SWITCHES, NOT OVER THEM. The top edge of a strip sits right under the
    // dash's overhang, and from the seat the labels there were hidden behind it; the strip now runs
    // further down and each label is on its own enamel chip below its switch. They are LIT lettering
    // (ivory, self-lit like a panel legend) rather than gilt engraved into walnut, which was dark gold
    // on dark wood and could not be read at the size the strip allows.
    const LABEL_H = 0.0082, LABEL_V = -0.045;
    // Abbreviated: the switches sit closer together than the full words are wide, so they ran together.
    const ABBR = { POWER: 'PWR', LIGHTS: 'LTS', CABIN: 'CAB', GEAR: 'GR', GUNS: 'GUN', WINGS: 'WNG' };
    const lab = (str, u) => {
      str = ABBR[str] ?? str;
      const w = textWidth(str) * LABEL_H;
      Sp.plate(roundRect(u - w / 2 - 0.004, LABEL_V - LABEL_H * 0.95, u + w / 2 + 0.004, LABEL_V + LABEL_H * 0.95, 0.003), T.enamel, 0, 0.0034);
      hudText(Sp, str, u, LABEL_V, LABEL_H, LABEL_INK, 0.0042);
    };
    for (const [id, u] of Object.entries(strip.at)) {
      const v = 0;
      if (id === 'power') {
        lab('POWER', u);
        Sp.disc(u, v, 0.019, T.gold, 0.1, 0.0037, 14);
        const h = eased('power', powered ? 0.010 : 0.016) - pressPulse('power', powered) * 0.005;
        domeBtn(Sp, u, v, h, 0.015, powered ? [230, 60, 50] : [120, 30, 26], powered ? 0.8 : 0.15, 'power');
      } else if (id === 'quack') {
        lab('QUACK', u);
        Sp.disc(u, v, 0.019, T.gold, 0.1, 0.0037, 14);
        domeBtn(Sp, u, v, eased('quack', L.quack ? 0.009 : 0.015, 30), 0.015, T.ruff, L.quack ? 0.9 : 0.25, 'quack');
      } else if (id === 'gear') {
        // Down is gear down, the knob a little gold webbed foot; amber while it travels, green when locked.
        lab('GEAR', u);
        Sp.plate(roundRect(u - 0.008, -0.030, u + 0.008, 0.006, 0.006), T.enamel, 0, 0.0045);
        const gy = 0.000 - 0.024 * gearV;
        const gt = Sp.pt(u, gy, 0.022);
        K.rod(Sp.pt(u, gy, 0.005), gt, 0.003, 'dash', 0.3, T.gold, 0.08, 6);
        K.obox(gt, Sp.r, Sp.u, Sp.n, 0.011, 0.007, 0.004, 'dash', 0.35, T.gold, 0.1);
        const moving = gearV > 0.02 && gearV < 0.98;
        lamp(Sp, u + 0.016, -0.026, moving || gearV >= 0.98, moving ? C.amber : C.green);
      } else if (id === 'wings') {
        // WINGS: a push-button like the quack's. Blue when the wings are out and locked, amber while
        // the aircraft converts either way, dark in rotor flight.
        lab('WINGS', u);
        const conv = clamp(num(L.convert, num(L.wings)), 0, 1), moving = conv > 0.01 && conv < 0.99;
        const col = moving ? C.amber : conv >= 0.99 ? [110, 170, 255] : [40, 60, 96];
        Sp.disc(u, v, 0.019, T.gold, 0.1, 0.0037, 14);
        const h = eased('wings', L.wingTarget ? 0.010 : 0.016) - pressPulse('wings', !!L.wingTarget) * 0.005;
        domeBtn(Sp, u, v, h, 0.015, col, moving || conv >= 0.99 ? 0.9 : 0.2, 'wings');
        lamp(Sp, u + 0.016, -0.026, moving || conv >= 0.99, moving ? C.amber : [110, 170, 255]);
      } else {
        const on = id === 'guns' ? armed : id === 'nv' ? !!L.nv : id === 'lights' ? !!L.landingLight : !!L.dome;
        lab(id === 'nv' ? 'NV' : id.toUpperCase(), u);
        Sp.disc(u, v, 0.012, id === 'guns' ? C.chrome : T.gold, 0.1, 0.0037, 12);
        // The bat swings through upright between its stops, with a ball on the end.
        const tf = eased('t:' + id, on ? 1 : 0, 18);
        const tv = v + (tf * 2 - 1) * 0.012 * (L.press === id ? 0.6 : 1), tip = Sp.pt(u, tv, 0.020);
        Sp.disc(u + 0.004, tv - 0.006, 0.0065, SHADE_SOFT, 1, 0.0046, 10);
        Sp.disc(u + 0.002, (v + tv) / 2 - 0.004, 0.005, SHADE_SOFT, 1, 0.0047, 10);
        // The bat: a dark collar at the root, the shaft, and a ball with a lit cap and a shaded underside,
        // so it reads as round chrome rather than a flat grey stick.
        K.rod(Sp.pt(u, v, 0.004), Sp.pt(u, v + (tv - v) * 0.2, 0.008), 0.0036, 'dash', 0.1, [96, 100, 110], 0.02, 6);
        K.rod(Sp.pt(u, v, 0.004), tip, 0.0025, 'dash', 0.35, C.chrome, 0.1, 5);
        K.rod(add(tip, mul(Sp.u, -0.0012)), add(tip, mul(Sp.n, 0.002)), 0.0040, 'dash', 0.05, mix(C.chrome, [30, 32, 38], 0.45), 0.02, 6);
        K.rod(add(tip, mul(Sp.n, 0.0015)), add(tip, mul(Sp.n, 0.0035)), 0.0032, 'dash', 0.5, mix(C.chrome, [255, 255, 255], 0.5), 0.3, 6);
        Sp.disc(u, v, 0.007, C.chrome, 0.15, 0.0052, 8);   // the toggle's own boss, back over the bezel
        // The guns' red guard: a hooded cover hinged along its top edge, standing clear of the bat's ball
        // (which reaches ~0.023 off the strip) and swinging up and out as they arm.
        if (id === 'guns') {
          const ga = eased('guard', on ? 1 : 0, 12) * 1.7, gl = 0.036, gh = 0.030, hx = 0.014;
          const top = 0.020, bv = top - gl * Math.cos(ga), bl = gh + gl * Math.sin(ga);
          const P = (x, vv, h) => Sp.pt(u + x, vv, h);
          const lid = [P(-hx, bv, bl), P(hx, bv, bl), P(hx, top, gh), P(-hx, top, gh)];
          const faceOut = (q, col, sh) => {
            let gn = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
            if (dot(gn, q[0]) > 0) gn = mul(gn, -1);   // face the eye, as the old guard did
            K.face(q, gn, 'dash', sh, col, 0.15);
          };
          faceOut(lid, C.red, 0.3);
          // Side flanges down from the lid to the hinge line, darker, so the cover has thickness.
          const dark = mix(C.red, [30, 6, 6], 0.45), dH = 0.012;
          for (const s of [-1, 1]) faceOut([P(s * hx, bv, bl), P(s * hx, bv, bl - dH), P(s * hx, top, gh - dH), P(s * hx, top, gh)], dark, -0.1);
          faceOut([P(-hx, bv, bl), P(hx, bv, bl), P(hx, bv, bl - dH), P(-hx, bv, bl - dH)], mix(C.red, [30, 6, 6], 0.25), 0);
          // Hinge barrel, and the shadow the shut cover throws on the strip.
          K.rod(P(-hx, top, gh), P(hx, top, gh), 0.003, 'dash', 0.3, C.chrome, 0.1, 6);
          if (ga < 0.3) Sp.disc(u + 0.004, v - 0.006, 0.02, SHADE_SOFT, 1, 0.0045, 12);
        }
        const col = id === 'guns' ? C.red : id === 'nv' ? [90, 255, 120] : [255, 236, 180];
        lamp(Sp, u + 0.016, -0.026, on && (id === 'guns' || id === 'nv' || powered), col);
      }
    }
  }

  // (The old flat glovebox that was here is now the pantry, carved into the fascia: drakeFascia.)

  // ── THE CENTRE CONSOLE, AND THE CONVERSION LEVER ON IT ───────────────────
  // The console runs down the pilot's RIGHT now the seat is on the centreline: lever, rams, bucket.
  const cX = xC + 0.45;
  const cy0 = -0.36, cy1 = dY0, cTop = -0.62, cw = 0.15;
  K.box(cX - cw, cy0, fl, cX + cw, cy1, cTop, 'dash', -0.05, T.console || T.walnut);
  if (T.console) K.box(cX - cw + 0.004, cy0 + 0.004, cTop - 0.002, cX + cw - 0.004, cy1 - 0.004, cTop + 0.0015, 'dash', 0.1, T.console);
  else veneer(K, [cX, (cy0 + cy1) / 2, cTop], [0, 1, 0], [1, 0, 0], (cy1 - cy0) / 2 - 0.01, cw - 0.01);
  for (const s of [-1, 1]) K.rod([cX + s * cw, cy0, cTop], [cX + s * cw, cy1, cTop], 0.008, 'dash', 0.3, T.gold, 0.1, 5);
  const Cn = K.panel([cX, (cy0 + cy1) / 2, cTop + 0.003], [1, 0, 0], [0, 1, 0], 'dash', 0.3);
  // THE RAMP: drop the rear, and a ramp runs down to the ground into the saloon. A gold-rimmed
  // button on the pilot's side of the console, its name plated beside it, amber when the ramp is down.
  const ramp = clamp(num(L.ramp), 0, 1);
  const Rp = K.panel(Cn.pt(0.085, -0.13, 0), [0, 1, 0], [-1, 0, 0], 'dash', 0.3);
  Rp.plate(roundRect(-0.075, -0.05, 0.075, 0.05, 0.012), T.enamel, 0, 0.0015);
  plated(Rp, 'RAMP', 0.025, 0.012, 0.016);
  Rp.disc(-0.040, 0, 0.024, T.gold, 0.1, 0.0025, 14);
  K.rod(Rp.pt(-0.040, 0, 0.002), Rp.pt(-0.040, 0, eased('ramp', L.rampButton ? 0.006 : 0.014, 30) - pressPulse('ramp', ramp > 0.5) * 0.004), 0.018, 'dash', 0.35, ramp > 0.5 ? C.amber : [120, 84, 30], ramp > 0.5 ? 0.9 : 0.15, 12);
  Rp.disc(0.025, -0.028, 0.007, ramp > 0.5 ? C.amber : [60, 40, 12], ramp > 0.5 ? 1 : 0, 0.003, 8);
  // ── THE MODE SELECTOR: one lever, four gates — HELI · PLANE · BOAT · SUB, aft to fore ─────
  // A chrome gate plate with a gold bead, the slot cut dark, and at each gate a notch stepped out of
  // both sides of the slot so the lever has somewhere to drop into: the metal indents it clunks into.
  // The lever stands where the aircraft actually is, so the selector is also the mode readout;
  // clicking a gate asks for that mode and cockpit.js walks her there (and plays the clunks).
  {
    const GV = DRAKE_MODE_GATES, g = clamp(num(L.mode), 0, 3);
    const pos = eased('mode', g, 9);
    Cn.plate(roundRect(-0.090, -0.04, 0.046, 0.325, 0.02), T.gold, 0.1, 0.001);
    Cn.plate(roundRect(-0.084, -0.034, 0.040, 0.319, 0.016), T.plate || C.chrome, 0.35, 0.0016);
    Cn.plate(roundRect(-0.009, -0.012, 0.009, 0.297, 0.008), [10, 11, 14], 0, 0.0024);
    GV.forEach((v, k) => {
      const on = Math.round(g) === k;
      // the indent: the slot widened both ways into a stepped pocket, its walls in shadowed chrome
      Cn.plate(roundRect(-0.021, v - 0.011, 0.021, v + 0.011, 0.004), mix(T.plate || C.chrome, [20, 22, 26], 0.55), 0, 0.0021);
      Cn.plate(roundRect(-0.017, v - 0.008, 0.017, v + 0.008, 0.003), [8, 9, 12], 0, 0.0024);
      Cn.rect(-0.021, v + 0.0095, 0.021, v + 0.011, T.plate ? T.goldDk : mix(C.chrome, [255, 255, 255], 0.5), 0.2, 0.0025);   // lit upper lip
      // the name in gold on the chrome, and a lamp that says which gate she is in
      // gold paint on a green enamel chip: gold straight on chrome could not be read
      Cn.plate(roundRect(-0.079, v - 0.0095, -0.026, v + 0.0095, 0.004), T.gold, 0.1, 0.0021);
      Cn.plate(roundRect(-0.0775, v - 0.008, -0.0275, v + 0.008, 0.0035), T.chip || MODE_CHIP, 0, 0.0025);
      // sized so the widest name (PLANE, 0.043 at this height) clears the chip by 3 mm each side
      engraved(Cn, DRAKE_MODE_NAMES[k], -0.0525, v, 0.0082, T.chipInk || T.gold, 0.0031);
      Cn.disc(0.030, v, 0.006, T.gold, 0.1, 0.0026, 10);
      // The gate she is in lights its own colour; every other gate says whether it can be taken NOW,
      // green or red (cockpit.js drakeModeReady). No readiness sent → the old dim lamp.
      const rd = Array.isArray(L.ready) ? L.ready[k] : null;
      const lamp = on ? DRAKE_MODE_LAMP[k] : rd === true ? [70, 255, 110] : rd === false ? [255, 60, 40] : DRAKE_MODE_LAMP[k].map((c) => c * 0.18);
      Cn.disc(0.030, v, 0.0042, lamp, on || rd != null ? (on ? 1 : 0.8) : 0, 0.0031, 8);
      DRAKE_LEVER_AT.modes[k] = Cn.pt(0, v, 0.02);
    });
    // The lever: out of a gold boot in the slot, a chrome shaft, a gold collar and a chrome ball.
    const vy = GV[0] + (GV[3] - GV[0]) * (pos / 3);
    const foot = Cn.pt(0, vy, 0.004), top = add(foot, [0, 0.022, 0.13]);
    K.rod(foot, add(foot, [0, 0, 0.01]), 0.014, 'dash', 0.35, T.gold, 0.1, 12);
    K.rod(foot, top, 0.0055, 'dash', 0.35, C.chrome, 0.1, 8);
    K.rod(add(top, [0, -0.002, -0.022]), add(top, [0, -0.001, -0.012]), 0.009, 'dash', 0.35, T.gold, 0.15, 10);
    for (let k = 0; k < 4; k++) { const t = k / 3, rr = 0.019 * Math.sin(Math.PI * (0.15 + t * 0.7)); K.rod(add(top, [0, 0, -0.012 + t * 0.028]), add(top, [0, 0, -0.012 + (k + 1) / 3 * 0.028]), rr, 'dash', 0.3, C.chrome, 0.15, 12); }
    DRAKE_LEVER_AT.conv = add(top, [0, 0, 0.004]);
  }
  // At the aft end, where the passenger can reach it: a gold ice bucket with a bottle in it.
  const bk = [cX + 0.02, cy0 + 0.13, cTop];
  K.rod(bk, add(bk, [0, 0, 0.13]), 0.07, 'dash', 0.35, T.gold, 0.1, 12);
  K.rod(add(bk, [-0.01, 0.01, 0.06]), add(bk, [-0.05, 0.05, 0.24]), 0.032, 'dash', 0.3, [26, 70, 42], 0.05, 8);
  K.rod(add(bk, [-0.046, 0.046, 0.225]), add(bk, [-0.062, 0.062, 0.29]), 0.014, 'dash', 0.3, T.gold, 0.1, 6);

  // ── THE THROTTLE: a brass lever in a walnut quadrant, right of the pod ────
  // Back toward you is idle, forward is full. In the forward view on purpose (see the switch panel).
  {
    const [tx, ty, tz] = DRAKE_THROTTLE.pivot, q = DRAKE_THROTTLE.k;
    K.box(tx - 0.035 * q, ty - 0.08, tz - 0.05, tx + 0.035 * q, ty + 0.08, tz + 0.012, 'dash', 0.2, T.walnut);
    for (const sx of [-1, 1]) veneer(K, [tx + sx * 0.0255 * q, ty, tz + 0.012], [0, 1, 0], [1, 0, 0], 0.078, 0.0085 * q);
    const thrFace = veneer(K, [tx, ty - 0.08, tz - 0.019], [1, 0, 0], [0, 0, 1], 0.033 * q, 0.029);
    K.box(tx - 0.012, ty - 0.075, tz + 0.012, tx + 0.012, ty + 0.075, tz + 0.016, 'dash', 0.3, T.enamel);
    for (const sx of [-1, 1]) K.rod([tx + sx * 0.016, ty - 0.075, tz + 0.016], [tx + sx * 0.016, ty + 0.075, tz + 0.016], 0.004, 'dash', 0.3, T.gold, 0.1, 5);
    const knob = drakeThrottleKnob(thr);
    luxLever(K, [tx, ty, tz], add(knob, [0, 0, 0.002]), 1.7, (c, D) => K.rod(c, add(c, mul(D, 0.012)), 0.013, 'dash', 0.2, T.ivory, 0.05, 12));
    engraved(thrFace, 'THR', 0, 0.002, 0.016, T.gold, 0.003);
  }

  // ── THE CONV KNOB: a walnut knob on a gold collar, its gold index turned by the gun convergence ──
  {
    const { c, r, min, max } = DRAKE_CONV_KNOB;
    const cv = clamp(num(L.conv, 1.2), min, max), a = (-135 + ((cv - min) / (max - min)) * 270) * Math.PI / 180;
    K.box(c[0] - 0.022, c[1] - 0.024, c[2] - 0.065, c[0] + 0.022, c[1] + 0.024, c[2] + 0.002, 'dash', 0.2, T.walnutDk);
    K.rod([c[0], c[1], c[2] + 0.002], [c[0], c[1], c[2] + 0.006], r * 1.25, 'dash', 0.35, T.gold, 0.1, 14);
    K.rod([c[0], c[1], c[2] + 0.006], [c[0], c[1], c[2] + 0.02], r, 'dash', 0.15, T.walnut, 0, 14);
    const tip = [c[0] + Math.sin(a) * r * 0.85, c[1] + Math.cos(a) * r * 0.85, c[2] + 0.0205];
    K.rod([c[0], c[1], c[2] + 0.0205], tip, 0.0022, 'dash', 0.3, T.gold, 0.15, 4);
    const convFace = veneer(K, [c[0], c[1] - 0.024, c[2] - 0.014], [1, 0, 0], [0, 0, 1], 0.02, 0.014, { dark: 0.8 });
    engraved(convFace, 'CONV', 0, 0.0, 0.0105, T.gold, 0.0025);
  }

  // ── THE TRIM WHEEL: a ridged walnut drum standing up through a gold-lipped slot ──
  // Nose-up rolls it toward you. Its ridges and the gold index turn with the trim, so a glance says
  // where it is set; the centre notch on the slot is neutral.
  {
    const { c, r, w } = DRAKE_TRIM_WHEEL, tr = clamp(num(L.trim), -0.6, 0.6);
    K.box(c[0] - w - 0.016, c[1] - r - 0.012, c[2] - 0.09, c[0] + w + 0.016, c[1] + r + 0.012, c[2] + 0.004, 'dash', 0.2, T.walnutDk);
    const trimFace = veneer(K, [c[0] + w + 0.016, c[1], c[2] - 0.02], [0, 1, 0], [0, 0, 1], r, 0.012, { dark: 0.8 });
    for (const sx of [-1, 1]) K.box(c[0] + sx * (w + 0.006) - 0.003, c[1] - r - 0.008, c[2] + 0.004, c[0] + sx * (w + 0.006) + 0.003, c[1] + r + 0.008, c[2] + 0.009, 'dash', 0.35, T.gold, 0.05);
    const turn = tr * 5, N = 16;
    K.rod([c[0] - w, c[1], c[2]], [c[0] + w, c[1], c[2]], r, 'dash', 0.15, T.walnut, 0, N);
    for (const sx of [-1, 1]) K.rod([c[0] + sx * w, c[1], c[2]], [c[0] + sx * (w + 0.003), c[1], c[2]], r * 0.92, 'dash', 0.3, T.gold, 0.1, N);
    for (let i = 0; i < N; i++) {
      const a = turn + (i / N) * TAU, y = c[1] + Math.cos(a) * r * 1.02, z = c[2] + Math.sin(a) * r * 1.02;
      if (z < c[2] - 0.005) continue;
      K.rod([c[0] - w, y, z], [c[0] + w, y, z], 0.0028, 'dash', 0.1, i === 0 ? T.gold : T.walnutDk, i === 0 ? 0.1 : 0, 4);
    }
    K.box(c[0] - w - 0.01, c[1] - 0.0015, c[2] + 0.009, c[0] + w + 0.01, c[1] + 0.0015, c[2] + 0.011, 'dash', 0.3, T.ivory);
    engraved(trimFace, 'TRIM', 0, 0, 0.011, T.gold, 0.003);
    // THE TRIM SCALE, ON THE WHEEL ITSELF: an enamel scale across the front of the wheel's housing,
    // under the drum, turned square to the pilot, with a pointer riding it. Top is nose down (a dive,
    // under the water), bottom nose up (a rise), the ivory bar is neutral. No second stand: the setting
    // is read on the thing you turn.
    {
      const GW = w + 0.012, GH = 0.026;
      const G = facingPanel(K, [c[0], c[1] - r - 0.016, c[2] - 0.036], 'dash', 0.3);
      G.plate(roundRect(-GW - 0.003, -GH - 0.003, GW + 0.003, GH + 0.003, 0.004), T.gold, 0.05, 0);
      G.plate(roundRect(-GW, -GH, GW, GH, 0.003), T.enamel, 0, 0.001);
      for (let i = -4; i <= 4; i++) { const y = i / 4 * GH * 0.8, ww = i === 0 ? GW * 0.8 : i % 2 ? GW * 0.25 : GW * 0.45; G.rect(-ww, y - 0.0008, ww * 0.1, y + 0.0008, i === 0 ? T.ivory : T.gold, 1, 0.0015); }
      engraved(G, 'DN', GW * 0.55, GH * 0.75, 0.007, T.gold, 0.0015);
      engraved(G, 'UP', GW * 0.55, -GH * 0.75, 0.007, T.gold, 0.0015);
      const py = -(tr / 0.6) * GH * 0.8;
      G.rect(-GW * 0.9, py - 0.003, GW * 0.15, py + 0.003, T.ivory, 1, 0.0025);
      G.rect(GW * 0.15, py - 0.0018, GW * 0.32, py + 0.0018, T.gold, 1, 0.0025);
      // AT A GLANCE: a lit + in green trimmed nose-up (rising), a lit − in red nose-down (diving), a dim
      // dot at neutral, beside the scale where the pointer rides. Readable without reading the scale.
      {
        const lx = GW * 0.62, a2 = 0.0065, b2 = 0.0016, up = tr > 0.02, dn = tr < -0.02;
        const col = up ? [90, 255, 120] : dn ? [255, 80, 70] : [70, 66, 58];
        G.rect(lx - a2 - 0.002, -a2 - 0.002, lx + a2 + 0.002, a2 + 0.002, [20, 18, 16], 1, 0.002);
        if (up || dn) G.rect(lx - a2, -b2, lx + a2, b2, col, 1, 0.003);
        if (up) G.rect(lx - b2, -a2, lx + b2, a2, col, 1, 0.003);
        if (!up && !dn) G.rect(lx - b2, -b2, lx + b2, b2, col, 1, 0.003);
      }
    }
  }

  // ── THE YOKE: a racing wheel on a column out of the dash ────────────────
  // Flat top and bottom and a waist, with the grips a shade LIGHTER than the carbon face so the
  // handles read at all, shift lights across the top off the rotor rpm, and a small lit screen.
  // It turns with the aileron and slides fore and aft with the elevator. ⚠ IT IS A SOLID, NOT A
  // PLATE: a back face, side walls round the whole outline and grips that stand proud of both
  // faces, so it reads as a thing you hold from any lean of the head. Roll and pitch only — the
  // rudder is the pedals in the well behind it.
  {
    const DWc = dwOf();   // noir: black carbon and black leather grips (DW_NOIR)
    const hub = drakeYokeHub(elev);
    const th = ail * 1.0;   // about ±57° at full lock; positive aileron turns the top of the wheel right
    const R0 = [1, 0, 0], U0 = DRAKE_YOKE_UP;
    const Rr = add(mul(R0, Math.cos(th)), mul(U0, -Math.sin(th)));
    const Ur = add(mul(R0, Math.sin(th)), mul(U0, Math.cos(th)));
    // Authored at a real wheel's size (DRAKE_WHEEL) and drawn at DRAKE_WHEEL_SC of it.
    const W0 = K.panel(hub, Rr, Ur, 'dash', 0.3), sc = DRAKE_WHEEL_SC;
    const N = W0.n, D = 0.022;          // the body's thickness, behind the face
    const Wp = {
      plate: (pts, ...a) => W0.plate(pts.map(([x, y]) => [x * sc, y * sc]), ...a),
      disc: (u, v, r, ...a) => W0.disc(u * sc, v * sc, r * sc, ...a),
      rect: (a0, b0, a1, b1, ...a) => W0.rect(a0 * sc, b0 * sc, a1 * sc, b1 * sc, ...a),
    };
    // A 2-D outline extruded back along -N: back face plus a wall per edge, each facing outward.
    const slab = (outline, rgb, d0, d1, k = 0.3) => {
      const pts = outline.map(([x, y]) => [x * sc, y * sc]);
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const [a, b] = pts[i], [c, e] = pts[(i + 1) % pts.length]; area += a * e - c * b; }
      const s = area > 0 ? 1 : -1;
      K.face(pts.map(([a, b]) => W0.pt(a, b, -d1)).reverse(), mul(N, -1), 'dash', k, rgb, 0);
      for (let i = 0; i < pts.length; i++) {
        const [a, b] = pts[i], [c, e] = pts[(i + 1) % pts.length];
        const on = norm(add(mul(W0.r, s * (e - b)), mul(W0.u, -s * (c - a))));
        K.face([W0.pt(a, b, -d0), W0.pt(c, e, -d0), W0.pt(c, e, -d1), W0.pt(a, b, -d1)], on, 'dash', k, rgb, 0);
      }
    };
    // The column: out of a gold boot on the dash lip, up to the back of the hub.
    const base = [0, dY0 + 0.03, dTop - 0.012];
    K.rod(add(base, [0, 0.03, -0.01]), add(base, [0, -0.02, 0.012]), 0.034, 'dash', 0.3, T.gold, 0.08, 10);
    K.rod(base, add(hub, mul(N, -D - 0.02)), 0.017, 'dash', 0.2, T.walnutDk, 0, 8);
    for (const t of [0.35, 0.7]) K.rod(add(base, mul(sub(hub, base), t - 0.03)), add(base, mul(sub(hub, base), t + 0.03)), 0.0195, 'dash', 0.3, T.gold, 0.08, 8);
    K.rod(add(hub, mul(N, -D - 0.024)), add(hub, mul(N, -D + 0.002)), 0.026, 'dash', 0.3, T.gold, 0.1, 10);   // the boss behind the wheel
    for (const piece of DW.body) { slab(piece, DWc.carbon, 0, D); Wp.plate(piece, DWc.carbon, 0, 0); }
    // A gold bead round the face, the dash's own edge detail. The two pieces meet along y 0.02, and
    // that seam is inside the wheel, so it gets none.
    for (const piece of DW.body) for (let i = 0; i < piece.length; i++) {
      const a = piece[i], b = piece[(i + 1) % piece.length];
      if (Math.abs(a[1] - 0.02) < 1e-6 && Math.abs(b[1] - 0.02) < 1e-6) continue;
      K.rod(W0.pt(a[0] * sc, a[1] * sc, 0.001), W0.pt(b[0] * sc, b[1] * sc, 0.001), 0.0022, 'dash', 0.35, T.gold, 0.08, 5);
    }
    // ⚠ CARBON IS A WEAVE, NOT A COLOUR: a 2x2 twill of tows, the light tone stepping one tow per
    // row so the pattern runs diagonally, which is the whole look. Clipped to the body's own pieces.
    const inPoly = (poly, x, y) => {
      let pos = 0, neg = 0;
      for (let i = 0; i < poly.length; i++) {
        const [a, b] = poly[i], [c, e] = poly[(i + 1) % poly.length];
        const k = (c - a) * (y - b) - (e - b) * (x - a);
        if (k > 0) pos++; else if (k < 0) neg++;
      }
      return !pos || !neg;
    };
    // ⚠ THE WEAVE IS A TEXTURE NOW, NOT 478 SQUARES. The yoke moves with the stick, so every face on it
    // is rebuilt and re-lit every frame, and the twill was the largest part of that. DWc.carbon carries
    // the GL solids pass's woven 'fabric' texture instead (registered with DW, below).
    // The grips: rubber, hanging off the shoulders, fatter than the body so they stand proud of it.
    for (const sx of [-1, 1]) {
      const g = DW.grip.map(([x, y]) => [x * sx, y]);
      if (sx < 0) g.reverse();
      slab(g, DWc.rubber, -0.006, D + 0.008, 0.05);
      Wp.plate(g, DWc.rubber, 0, 0.006);
      // PERFORATED LEATHER: a fine grid of darker holes, offset row by row, clipped to the grip, and a
      // stitched seam down its middle, which is what makes green read as hide rather than paint.
      // The perforation is the GL pass's 'leather' texture on DWc.rubber (registered with DW, below) —
      // 534 one-millimetre squares rebuilt every frame with the yoke, before. The seam stays geometry.
      const stitch = mix(DWc.rubber, [230, 220, 190], 0.55);
      for (let j = 0; j < 16; j++) {
        const x = sx * 0.123, y = 0.012 - j * 0.0075;
        if (!inPoly(g, x, y)) continue;
        Wp.plate([[x - 0.0006, y - 0.0022], [x + 0.0006, y - 0.0022], [x + 0.0006, y + 0.0022], [x - 0.0006, y + 0.0022]], stitch, 0, 0.0066);
      }
    }
    // The thumb rotaries at the top of each grip: drums across the wheel.
    for (const t of DW.wheels) {
      const c = W0.pt(t.x * sc, t.y * sc, 0.004);
      K.rod(add(c, mul(W0.r, -0.006)), add(c, mul(W0.r, 0.006)), 0.0075, 'dash', 0.3, t.rgb, 0.1, 10);
    }
    // Shift lights: green, then amber, then red, off the rotor rpm.
    const lit = clamp((rpm - 0.55) / 0.45, 0, 1) * DW.leds.n;
    for (let i = 0; i < DW.leds.n; i++) {
      const on = powered && i < lit, f = i / (DW.leds.n - 1);
      const col = f < 0.4 ? [70, 230, 110] : f < 0.75 ? [255, 190, 60] : [255, 70, 60];
      Wp.disc(DW.leds.x0 + i * DW.leds.dx, DW.leds.y, 0.0045, on ? col : col.map((c) => c * 0.18), on ? 1 : 0, 0.002, 8);
    }
    // The screen: speed in big figures, and a bar under it.
    const [s0, s1, s2, s3] = DW.screen;
    Wp.plate(roundRect(s0 - 0.004, s1 - 0.004, s2 + 0.004, s3 + 0.004, 0.005), [40, 42, 46], 0, 0.001);
    Wp.plate(roundRect(s0, s1, s2, s3, 0.003), powered ? [30, 70, 52] : [10, 16, 12], powered ? 0.6 : 0, 0.002);
    if (powered) {
      W0.digits(-0.03 * sc, 0.002 * sc, 0.024 * sc, String(Math.round(ias)).padStart(3, '0'), [170, 255, 200], false);
      Wp.rect(s0 + 0.006, s1 + 0.006, s0 + 0.006 + (s2 - s0 - 0.012) * clamp(ias / 200, 0.02, 1), s1 + 0.012, [140, 255, 170], 0.9, 0.004);
    }
    // The buttons: domed, each in its own gap with a shadow, the same as the switch strips'.
    DW.buttons.forEach((b, i) => domeBtn(W0, b.x * sc, b.y * sc, 0.0085, b.r * sc, b.rgb, 0.2, 'yoke' + i));
    // The two rotaries: a skirt, a knob on it, and a white pointer line.
    for (const k of DW.knobs) {
      K.rod(W0.pt(k.x * sc, k.y * sc, 0), W0.pt(k.x * sc, k.y * sc, 0.004), k.r * 1.25 * sc, 'dash', 0.2, [30, 32, 36], 0, 12);
      K.rod(W0.pt(k.x * sc, k.y * sc, 0.004), W0.pt(k.x * sc, k.y * sc, 0.014), k.r * sc, 'dash', 0.35, k.rgb, 0.15, 10);
      K.obox(W0.pt(k.x * sc, (k.y + k.r * 0.5) * sc, 0.0155), W0.r, W0.u, N, 0.0018, k.r * 0.5 * sc, 0.0015, 'dash', 0.3, [250, 250, 250], 0.3);
    }
  }

  // ── THE COLLECTIVE, AT YOUR LEFT HAND, WITH THE PUSHER'S THUMB-WHEEL ────
  const kx = -P.seatHalf - 0.07;
  const cp = [kx, P.seatY[0] + 0.02, P.seatZ - 0.08];
  // Pulled back and scaled down: it reached forward into the pantry's doorway.
  const ce = [kx, P.seatY[1] - 0.02, P.seatZ + 0.03 + (1 - fold) * thr * 0.12];
  K.box(kx - 0.035, P.seatY[0] - 0.04, fl, kx + 0.035, P.seatY[0] + 0.06, P.seatZ - 0.06, 'dash', -0.1, T.walnut);
  K.rod(cp, ce, 0.011, 'dash', 0.2, T.gold, 0.05, 8);
  {
    const g0 = ce, g1 = add(ce, [0, 0.08, 0.022]), gd = sub(g1, g0);
    K.rod(g0, add(g0, mul(gd, 0.08)), 0.019, 'dash', 0.3, T.gold, 0.1, 10);
    K.rod(add(g0, mul(gd, 0.08)), add(g0, mul(gd, 0.94)), 0.016, 'dash', 0.1, T.walnut, 0, 10);
    for (const t of [0.35, 0.65]) K.rod(add(g0, mul(gd, t)), add(g0, mul(gd, t + 0.04)), 0.017, 'dash', 0.3, T.gold, 0.1, 10);
    K.rod(add(g0, mul(gd, 0.94)), g1, 0.015, 'dash', 0.3, T.gold, 0.1, 10);
  }
  const tw = add(ce, [0.021, 0.045, 0.015]);
  K.rod(add(tw, [-0.005, 0, 0]), add(tw, [0.005, 0, 0]), 0.013, 'dash', 0.3, T.gold, 0.1, 10);

  // ── THE RUDDER PEDALS, IN THEIR WELL IN THE DASH TOP ─────────────────────
  // Two small walnut pads hinged at the floor of the pocket, standing up to the rim at rest. Pressed,
  // a pad tips forward and down into the well and lights amber, brighter the further it has gone —
  // so a glance past the top of the yoke says which way the tail is being pushed.
  {
    const Wl = DRAKE_WELL, z0 = dTop - 0.06;
    const dark = [16, 11, 8];
    K.face([[-Wl.x, Wl.y0, Wl.floor], [Wl.x, Wl.y0, Wl.floor], [Wl.x, Wl.y1, Wl.floor], [-Wl.x, Wl.y1, Wl.floor]], [0, 0, 1], 'dash', -0.3, dark, 0);
    // Walls below the dash box, down to the pocket floor.
    K.face([[-Wl.x, Wl.y1, Wl.floor], [Wl.x, Wl.y1, Wl.floor], [Wl.x, Wl.y1, z0], [-Wl.x, Wl.y1, z0]], [0, -1, 0], 'dash', -0.2, T.walnutDk, 0);
    K.face([[-Wl.x, Wl.y0, z0], [Wl.x, Wl.y0, z0], [Wl.x, Wl.y0, Wl.floor], [-Wl.x, Wl.y0, Wl.floor]], [0, 1, 0], 'dash', -0.2, T.walnutDk, 0);
    for (const s of [-1, 1]) K.face([[s * Wl.x, Wl.y0, Wl.floor], [s * Wl.x, Wl.y1, Wl.floor], [s * Wl.x, Wl.y1, z0], [s * Wl.x, Wl.y0, z0]], [-s, 0, 0], 'dash', -0.2, T.walnutDk, 0);
    // The gold lip round the opening.
    const rim = [[-Wl.x, Wl.y0, dTop + 0.002], [Wl.x, Wl.y0, dTop + 0.002], [Wl.x, Wl.y1, dTop + 0.002], [-Wl.x, Wl.y1, dTop + 0.002]];
    for (let i = 0; i < 4; i++) K.rod(rim[i], rim[(i + 1) % 4], 0.005, 'dash', 0.35, T.gold, 0.1, 5);
    // The hinge bar across the floor, and a pad either side of the centreline.
    const py = Wl.y1 - 0.06, pz = Wl.floor + 0.006;
    K.rod([-Wl.x + 0.006, py, pz], [Wl.x - 0.006, py, pz], 0.006, 'dash', 0.3, T.gold, 0.1, 6);
    for (const s of [-1, 1]) {
      const { press, dir, piv, len, pad } = drakePedal(s, rud);
      K.rod(piv, add(piv, mul(dir, len * 0.3)), 0.005, 'dash', 0.3, T.gold, 0.1, 5);
      let n = norm(cross([1, 0, 0], dir));
      if (n[1] > 0) n = mul(n, -1);                          // the tread faces the pilot
      const lit = press > 0.02;
      K.obox(pad, [1, 0, 0], dir, n, 0.030, len * 0.38, 0.005, 'dash', 0.3, T.gold, 0.1);
      K.obox(add(pad, mul(n, 0.0055)), [1, 0, 0], dir, n, 0.025, len * 0.34, 0.001, 'dash', 0.2,
        lit ? mix(T.walnut, [255, 176, 70], 0.35 + 0.65 * press) : T.walnut, lit ? 0.3 + 0.7 * press : 0);
      // Three gold treads across the pad.
      for (const k of [-0.55, 0, 0.55]) K.obox(add(add(pad, mul(dir, k * len * 0.3)), mul(n, 0.0075)), [1, 0, 0], dir, n, 0.020, 0.002, 0.001, 'dash', 0.35, T.gold, 0.1);
    }
  }
  // (The passenger's footrest went with the passenger: the saloon is behind the ladder.)

  // ── THE LADDER, UP THE NECK FROM THE SALOON ───────────────────────────────
  // The well itself is part of the room (buildRoom); this is the ladder in it: two gold rails that
  // rise out of the floor and curve over into grab handles, and walnut rungs going down into the dark.
  const Wl = P.drake.well;
  if (Wl) {
    const [wx0, wy0, wx1, wy1] = Wl.rect, wz = Wl.bottom;
    const ry = wy0 + 0.06;
    for (const x of [wx0 + 0.10, wx1 - 0.10]) {
      K.rod([x, ry, wz + 0.05], [x, ry, fl + 0.78], 0.016, 'post', 0.3, T.gold, 0.08, 6);
      K.rod([x, ry, fl + 0.78], [x, ry + 0.10, fl + 0.90], 0.016, 'post', 0.3, T.gold, 0.08, 6);
      K.rod([x, ry + 0.10, fl + 0.90], [x, ry + 0.20, fl + 0.86], 0.016, 'post', 0.3, T.gold, 0.08, 6);
    }
    for (let z = fl - 0.12; z > wz + 0.08; z -= 0.26) K.rod([wx0 + 0.10, ry, z], [wx1 - 0.10, ry, z], 0.014, 'post', 0.1, T.walnut, 0, 6);
    const rim = [[wx0, wy0, fl + 0.01], [wx1, wy0, fl + 0.01], [wx1, wy1, fl + 0.01], [wx0, wy1, fl + 0.01]];
    for (let i = 0; i < 4; i++) K.rod(rim[i], rim[(i + 1) % 4], 0.012, 'post', 0.3, T.gold, 0.08, 5);
  }

  // ── THE DOME LAMP, IN THE CROWN ───────────────────────────────────────────
  const lz = P.roof - 0.10;
  K.rod([xC, -0.30, lz], [xC, -0.30, lz - 0.03], 0.07, 'hdr', 0.3, T.gold, 0.1, 12);
  K.rod([xC, -0.30, lz - 0.03], [xC, -0.30, lz - 0.045], 0.055, 'hdr', 0.3, [255, 236, 190], L.dome ? 1 : 0.3, 12);

  // ── BOTH SEATS ────────────────────────────────────────────────────────────
  luxSeat(K, 0, P, 1);
  captainChair(K, P);

  drakeGpsScreen(K, L);
  drakeShadows(K, P, L);

  // ── WHAT YOUR HAND IS ON ─────────────────────────────────────────────────
  // A soft gold halo round the control under the pointer, and a brighter one for a moment after it
  // is pressed, sized to the control's own hit radius so the ring says exactly what a click reaches.
  const hot = L.press || L.hover;
  if (hot) {
    const h = drakeHotspots(L).find((x) => x.id === hot);
    // ⚠ CLICK CONTROLS ONLY. A drag control's hit radius is its whole grab area — the yoke's spans the
    // wheel — so a ring round it was a big hoop over the thing you were holding. Those get the grab
    // cursor, and the yoke and the levers move under your hand, which is feedback enough.
    if (h && h.kind === 'click') {
      const Hp = facingPanel(K, h.p, 'dash', 0);
      const col = L.press ? HALO_PRESS : HALO;
      Hp.annulus(0, 0, h.r * 1.0, h.r * 1.18, col, 1, 0.012, 24);
      Hp.annulus(0, 0, h.r * 1.18, h.r * 1.24, HALO_RIM, 1, 0.013, 24);
    }
  }
}

// A cut-crystal knob: an octahedron stretched upright, eight facets, faintly lit from inside.
function gem(K, c, r, rgb) {
  const top = add(c, [0, 0, r * 1.3]), bot = add(c, [0, 0, -r * 0.9]);
  const ring = [];
  for (let i = 0; i < 6; i++) { const t = (i / 6) * TAU; ring.push(add(c, [Math.cos(t) * r, Math.sin(t) * r, 0])); }
  for (let i = 0; i < 6; i++) {
    const a = ring[i], b = ring[(i + 1) % 6];
    const nu = norm(cross(sub(b, a), sub(top, a))), nd = norm(cross(sub(bot, a), sub(b, a)));
    K.face([a, b, top], dot(nu, sub(a, c)) < 0 ? mul(nu, -1) : nu, 'dash', 0.4, i % 2 ? rgb : mix(rgb, [255, 255, 255], 0.35), 0.35);
    K.face([a, bot, b], dot(nd, sub(a, c)) < 0 ? mul(nd, -1) : nd, 'dash', 0.1, mix(rgb, [90, 110, 130], 0.3), 0.2);
  }
}
