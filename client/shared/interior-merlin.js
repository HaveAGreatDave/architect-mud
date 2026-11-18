// THE CORVANE MERLIN'S COCKPIT: the inside of the wedge, as geometry.
//
// The Merlin is Corvane's two-seat mini VTOL built like a supercar (docs/proposals/road-vtol.md), and
// the cockpit is a supercar's: a low carbon tub, two deep buckets with harnesses, the windscreen raked so
// far forward that its foot is a long way off over the dash, the door glass wrapping round to eye height,
// and the gull-wing doors' cards beside you with the pull at their front edge. You fly it, and later
// drive it, with a race car wheel: a flat-bottomed rim with a screen in its hub, two shift paddles
// behind it and the switches on its face.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S BODY ───────────────────────────────────────
//
// client/shared/cabin-merlin.js states the body's stations, where its glass is and where the doors
// are, and the exterior generator builds the shell and glazes it from the same file. Everything here
// is read off it: the wall is the body's own section walked at its own stations and pushed in by a
// wall's thickness, the windows are the absence of wall where the layout says glass, and the floor
// stops where it meets the hull. Nothing about the shape of the cabin is typed here.
//
// ── ⚠ ONE SCALE: THE MERLIN'S LENGTH OVER THE MODEL'S ───────────────────────
//
// 4.6 m over the compiled exterior's nose-to-tail length, so the room and the airframe agree about
// what a metre is. Anything about a PERSON (seat width, reach, the wheel's size) is honest metres.
//
// ── ⚠ EVERY CONTROL DRAWN WORKS ─────────────────────────────────────────────
//
// The rim rolls and pitches the aircraft (the 'yoke' hotspot, dragged), the paddles step the
// collective (ck:padUp, ck:padDn in cockpit.js), the four keys on the wheel's face are the four
// circuits the sim has, and the map is the GPS. The HOVER, LOCK, BOOST and PIT buttons in the design
// come with the road mode and the pad lock (road-vtol.md phases 2 and 3); until those exist they are
// not drawn, because a button that does nothing reads as broken.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { nightAt } from './sky-keys.js';
import { brandTrim } from './interior-brands.js';
import { makeKit, C, clamp, lerp, SHINY, TEXTURE, xfTurn } from './interior-kit.js';
import { memoPart } from './interior-memo.js';
import { contactShadow, hotspotHalo, panelGps, gpsHotspot, lensLamp, eased, pressPulse, HALO,
  bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand, windscreenHud, hudTint, HUD_WHEEL, wallSec } from './interior-cockpit-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';
import { compileMesh } from './vehicle-mesh.js';
import { glyphRuns } from './glyph-runs.js';
import { legendWidth } from './legend-font.js';
import { menuRows, menuTitle, menuPanel } from './merlin-menu.js';
import { MERLIN_STATIONS, MERLIN_DOOR, MERLIN_INSIDE, MERLIN_LENGTH_M, MERLIN_DUCTS, merlinSection, merlinPoint, merlinPanes } from './cabin-merlin.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── THE STYLE ────────────────────────────────────────────────────────────────
// Corvane's flat dark cabin and violet line, with oxblood leather and red stitching on the buckets
// and the wheel: the one thing in here that isn't black is the thing you sit in.
export const MERLIN_TRIM = {
  lining: [58, 60, 62], liningDk: [42, 44, 46], headliner: [50, 52, 54],
  carbon: [28, 29, 30], carbonLt: [46, 47, 48], tub: [20, 21, 22],
  leather: [104, 22, 26], leatherDk: [66, 14, 18], bolster: [34, 34, 36], stitch: [214, 48, 44],
  alcantara: [40, 40, 42],
  glow: [186, 176, 255], glowDim: [70, 64, 110],
  floor: [30, 30, 32], floorEdge: [20, 20, 22], metal: [150, 156, 164], brushed: [120, 126, 134],
  screen: [8, 8, 13], bezel: [18, 18, 20], harness: [150, 26, 30], buckle: [176, 182, 190],
  red: [235, 60, 48], amber: [255, 176, 64], marker: [255, 196, 40],
  // The jewellery: polished chrome on the bezels and vent rims, brushed aluminium on the spar, the
  // knobs and the plates, piano black behind the clock's hands.
  chrome: [196, 202, 212], alu: [168, 172, 178], piano: [12, 12, 14], engrave: [44, 44, 48],
};
const T = MERLIN_TRIM;
for (const k of ['lining', 'liningDk', 'headliner', 'alcantara']) TEXTURE.set(T[k], 'fabric');
for (const k of ['carbon', 'carbonLt', 'tub', 'bezel']) TEXTURE.set(T[k], 'plastic');
for (const k of ['leather', 'leatherDk', 'bolster']) TEXTURE.set(T[k], 'leather');
for (const k of ['floor', 'floorEdge']) TEXTURE.set(T[k], 'carpet');
for (const k of ['metal', 'brushed', 'buckle', 'chrome', 'alu']) TEXTURE.set(T[k], 'brushed');
TEXTURE.set(T.engrave, 'cast');
TEXTURE.set(T.harness, 'fabric');
SHINY.set(T.leather, { spec: 0.32, pow: 22 });
SHINY.set(T.screen, { spec: 0.6, pow: 60 });
SHINY.set(T.buckle, { spec: 0.8, pow: 40 });
brandTrim(T, 'merlin', TEXTURE, SHINY);
// After the maker's finish, the Merlin's own: Corvane's cabins are matte, but this one's carbon is
// clear-lacquered, its metal polished, and the clock sits in piano black. These are what make it
// read as expensive: hard, deep highlights on the dark surfaces.
SHINY.set(T.carbon, { spec: 0.55, pow: 46 });
SHINY.set(T.carbonLt, { spec: 0.5, pow: 40 });
SHINY.set(T.chrome, { spec: 0.95, pow: 90 });
SHINY.set(T.alu, { spec: 0.62, pow: 34 });
SHINY.set(T.piano, { spec: 0.9, pow: 80 });
SHINY.set(T.leather, { spec: 0.3, pow: 18 });

// ── THE DASH'S TYPE ─────────────────────────────────────────────────────────
// Corvane letters the Merlin in wide supercar faces: Orbitron for the big readouts, Michroma for the
// titles and units, Syncopate for the nameplate (glyph-runs.js sets them as geometry). Small switch
// labels stay in the legend face, which is what reads at a centimetre. Where no font can be set (the
// gates, the first frames) each falls back to the kit's own lettering at the same place and size.
const F_TITLE = 'michroma', F_NUM = 'orbitron', F_BADGE = 'syncopate';
// A line of type in a box. ⚠ EVERY CALL GIVES ITS BOX: `maxW` is the room it has across, and the
// type shrinks to it, never past it, so nothing runs over a key's ring or a page's edge. `align` says
// what `x` is: 'c' the middle, 'l' the left edge, 'r' the right edge. `h` is the cap height.
function fancyText(Pn, str, x, cb, h, rgb, emis, lift, face, maxW, align = 'c') {
  const g = glyphRuns(face, str);
  const w = g ? g.w * h : legendWidth(str, h), k = w > maxW ? h * maxW / w : h, ww = w * k / h;
  const x0 = align === 'l' ? x : align === 'r' ? x - ww : x - ww / 2;
  if (!g) return Pn.text(str, x0 + ww / 2, cb, k, rgb, emis, lift);
  const y0 = cb - k / 2;
  for (const [a0, b0, a1, b1] of g.rects) Pn.rect(x0 + a0 * k, y0 + b0 * k, x0 + a1 * k, y0 + b1 * k, rgb, emis, lift);
}
// A number in the box the kit's seven-segment `digits` would fill (left and baseline at (a, b), cap
// height h, `n` characters wide), right-aligned in it as a padded readout is.
function fancyDigits(Pn, a, b, h, str, rgb, emis = 0.95, right = null) {
  const sTrim = String(str).trim(), n = String(str).length, g = glyphRuns(F_NUM, sTrim);
  if (!g) return Pn.digits(a, b, h, str, rgb, false);
  // Orbitron is wider than a segment digit: past the box, the number shrinks to fit it, from the right.
  // `right`, when given, is the screen's own edge: the box ends there whatever the padding.
  const box = right != null ? right - a : n * h * 0.7 - h * 0.18, k = g.w * h > box ? box / g.w : h, x0 = a + box - g.w * k;
  for (const [a0, b0, a1, b1] of g.rects) Pn.rect(x0 + a0 * k, b + b0 * k, x0 + a1 * k, b + b1 * k, rgb, emis, 0.006);
}

// ── THE EXTERIOR, MEASURED ──────────────────────────────────────────────────
function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor') continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return fMax - fMin;
}

// Where the pilot's eye is in the model: over the right-hand bucket, a reclined sports seat's eye
// height (0.80 m) over the tub floor, under the roof's peak.
const EYE = { f: -0.04, g: MERLIN_INSIDE.seatG, overFloorM: 0.80 };
const WALL_M = 0.03;

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function merlinProfile(doc = MESH_ROWS.merlin) {
  if (!doc) return null;
  const m = MERLIN_LENGTH_M / modelLength(doc);
  const fE = EYE.f, gE = EYE.g, hE = MERLIN_INSIDE.floorH + EYE.overFloorM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m;
  const fB = MERLIN_INSIDE.bulkheadF, zF = Z(MERLIN_INSIDE.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF };
  const room = buildRoom(G);
  const glassSet = buildGlass(G);
  const allGlass = [...glassSet.panes, ...glassSet.doorPanes[1], ...glassSet.doorPanes[-1]];
  // The door glass goes with its door: shut, the panes as built; open, turned on the hinge.
  let glassAt = -1, glassMemo = allGlass;
  const glass = (live) => {
    const th = doorAngle(live);
    if (!th) return allGlass;
    if (th !== glassAt) {
      glassAt = th;
      glassMemo = [...glassSet.panes];
      for (const s of [1, -1]) { const h = room.hinge[s]; for (const pn of glassSet.doorPanes[s]) glassMemo.push(pn.map((q) => turnAbout(q, h.pivot, h.axis, th * h.sign))); }
    }
    return glassMemo;
  };

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const see = (q) => {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  };
  for (const f of [...room.faces, ...room.doorFaces[1], ...room.doorFaces[-1]]) f.p.forEach(see);
  for (const pn of allGlass) pn.forEach(see);
  const xCentre = X(0);
  const halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;
  const P = {
    label: 'Corvane Merlin',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m,
    // The side rays go out through the middle of the door glass.
    winY: [Y(0.0), Y(0.2)], winZ: [Z(0.10), Z(0.2)],
    dashY: DASH.yMid - 0.06, dashZ: DASH.z0 + 0.1, headerZ: Z(0.26), pillarW: 0.03,
    seatZ: zF + 0.17, seatHalf: 0.25, seatY: [-0.24, 0.22], backZ: 0.02,
    seats: 2, centrePost: 0,
    normalLit: true,
    floods: [{ p: [xCentre * 0.5, 0.6, -0.34], r: 0.5 }, { p: [xCentre, -0.05, 0.16], r: 0.6 }],
    floodGain: 1.5, glare: 0.22,
    room: merlinShell,
    glass,
    mr: { ...G, faces: room.faces, doorFaces: room.doorFaces, hinge: room.hinge, pulls: room.pulls },
    hotspots(live) { return merlinHotspots(this, live); },
    glows(live) { return merlinGlows(this, live); },
  };
  return P;
}

// ── THE GLOWS: what the cabin's own lit parts spill onto the carbon round them (windshield.js
// draws them, scaled by the dark). The three dash pages in the band's violet, the centre one in the
// HUD's colour while the setup menu is up on the touch screen, and the HUD knob's ring in the HUD's colour. Off until
// each page has booted, so the cabin lights up page by page as the screens do.
function merlinGlows(P, live) {
  const R = readings(live);
  if (!R.powered) return [];
  const K = makeKit(() => {}), boot = bootAge(live), tint = hudTint(R.L.hudTint).line, out = [];
  const menu = menuOpen(R);
  for (const sc of menu ? [SCREENS[0], TOUCH] : SCREENS) {
    const up = reveal(boot, sc.boot);
    if (up <= 0) continue;
    const lit = sc === TOUCH;
    out.push({ p: screenPanel(K, P, sc).pt(0, 0, 0.04), r: 0.16 + sc.w * 0.6, rgb: lit ? tint : T.glow, k: up * (lit ? 1 : 0.7) });
  }
  const kn = hudKnobAt(P);
  out.push({ p: add(kn.c, mul(kn.n, 0.05)), r: 0.09, rgb: tint, k: 0.9 });
  return out;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: lining, door cards, headliner, firewall, floor, sills, window reveals and the
// light that runs round the room. Nothing here moves.
function buildRoom(G) {
  const { toShell, inset, fB, zF, m } = G;
  const faces = [];
  // The doors' own faces (the card, its trim and the reveal round its glass) are kept apart, per side
  // (1 right, -1 left), because they swing: merlinFit draws them on the hinge every frame.
  const doorFaces = { 1: [], [-1]: [] };
  // Where each door's pull is: the 3D control that opens and shuts the doors on the ground.
  const pulls = {};
  let sink = faces;
  const put = (p, n, tone, k, rgb, emis) => sink.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(merlinPoint(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, merlinSection(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const PANES = merlinPanes();
  const W = PANES[0];

  // ── THE SHELL: headliner over the crown, alcantara above the waist, carbon tub below, door cards ──
  // Walked in the body's own (f, angle), from the firewall to the windscreen's foot and on into the
  // footwells, with every pane of glass cut out of it exactly.
  const fN = 0.56;
  const FS = [fB, -0.16, -0.10, -0.04, 0.02, 0.08, 0.13, 0.18, 0.23, 0.28, 0.33, 0.38, 0.43, 0.48, fN];
  const NA = 80;
  const holes = PANES.map((p) => [[p.f[0], p.a[0]], [p.f[1] + (p.id === 'windscreen' ? 0.01 : 0), p.a[0]], [p.f[1] + (p.id === 'windscreen' ? 0.01 : 0), p.a[1]], [p.f[0], p.a[1]]]);
  const D = MERLIN_DOOR;
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      const side = Math.abs(Math.cos(am * DEG)) > 0.25;
      const aSide = am > 90 ? 180 - am : am;
      const inDoor = side && fm > D.f[0] && fm < D.f[1] && aSide > D.aLo && aSide < 9;
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.85) put(poly, n, 'hdr', -0.28, T.headliner);
        else if (inDoor) { sink = doorFaces[Math.cos(am * DEG) > 0 ? 1 : -1]; put(poly, n, 'pil', -0.06, aSide > 2 ? T.alcantara : T.leatherDk); sink = faces; }
        else if (sn < -0.15) put(poly, n, 'pil', -0.18, T.tub);
        else put(poly, n, 'pil', -0.12, sn > 0.3 ? T.alcantara : T.liningDk);
      }
    }
  }

  // ── THE REVEALS: a carbon return round every pane, and a violet seal along its inner edge ──
  const reveal = (pts, cF, cA) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(merlinPoint(fa, aa, -0.004 / m)), o1 = toShell(merlinPoint(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(merlinPoint(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.carbon);
      if (i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.003, 'pil', 0.1, T.glowDim, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  for (const p of PANES) {
    const cF = (p.f[0] + p.f[1]) / 2, cA = (p.a[0] + p.a[1]) / 2;
    sink = p.id === 'side' ? doorFaces[Math.cos(cA * DEG) > 0 ? 1 : -1] : faces;
    reveal([...edge(p.f[0], p.a[0], p.f[1], p.a[0], 8), ...edge(p.f[1], p.a[0], p.f[1], p.a[1], 8).slice(1), ...edge(p.f[1], p.a[1], p.f[0], p.a[1], 8).slice(1), ...edge(p.f[0], p.a[1], p.f[0], p.a[0], 8).slice(1)], cF, cA);
  }

  // ── THE DOORS: the gull-wing door's seam round each card, the pull at its FRONT edge (the hinge is on
  // the roof rail), an armrest, a speaker, and the red stitch line along the sill ──
  sink = faces;
  for (const s of [1, -1]) {
    sink = doorFaces[s];
    const A = (a) => (s > 0 ? a : 180 - a);
    const seam = [...edge(D.f[1] - 0.01, D.aLo + 10, D.f[1] - 0.01, 8, 8), ...edge(D.f[1] - 0.01, 8, D.f[0] + 0.012, 8, 12).slice(1), ...edge(D.f[0] + 0.012, 8, D.f[0] + 0.012, D.aLo + 10, 8).slice(1)];
    const pts = seam.map(([f, a]) => S(f, A(a), 0.006)).filter((q) => q[2] > zF + 0.02);
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.0045, 'pil', -0.3, T.carbon, 0, 4, false);
    // The hinges, low and high on the back edge, a brushed knuckle each, so you can see which way it opens.
    for (const a of [-14, 4]) K.rod(S(D.f[0] + 0.004, A(a), 0.004), S(D.f[0] + 0.004, A(a), 0.03), 0.012, 'pil', 0.25, T.metal, 0, 8);
    // The armrest: a leather blade along the card, red stitch along its top.
    const aArm = A(-8);
    const ar0 = S(-0.12, aArm, 0.06), ar1 = S(0.16, aArm, 0.06);
    const along = norm(sub(ar1, ar0));
    const aUp = norm(cross(cross(along, [0, 0, 1]), along));
    K.obox(mul(add(ar0, ar1), 0.5), along, aUp, norm(cross(along, aUp)), Math.hypot(...sub(ar1, ar0)) / 2, 0.022, 0.045, 'pil', 0.05, T.leather);
    K.rod(add(ar0, [0, 0, 0.023]), add(ar1, [0, 0, 0.023]), 0.0022, 'pil', 0.2, T.stitch, 0.3, 4);
    // The pull: a leather strap in the front edge of the card, where the latch is.
    const p0 = S(D.f[1] - 0.05, A(2), 0.035), p1 = S(D.f[1] - 0.05, A(-14), 0.035);
    K.rod(p0, p1, 0.01, 'pil', 0.2, T.leather, 0, 6);
    pulls[s] = mul(add(p0, p1), 0.5);
    for (const q of [p0, p1]) K.rod(q, add(q, mul(inward(D.f[1] - 0.05, A(-6)), -0.03)), 0.008, 'pil', 0.3, T.metal, 0, 6);
    K.rod(S(D.f[1] - 0.02, A(-5), 0.006), S(D.f[1] - 0.02, A(-1), 0.006), 0.004, 'pil', 0.2, T.glow, 0.7, 5);
    // The speaker, low on the card: a ring of holes in a carbon disc.
    const sc = S(0.06, A(-26), 0.004), sn2 = inward(0.06, A(-26)), sr = norm(cross([0, 0, 1], sn2)), su = cross(sn2, sr);
    const Sp = K.panel(add(sc, mul(sn2, 0.002)), sr, su, 'pil', 0.1);
    Sp.disc(0, 0, 0.06, T.carbon, 0, 0.001, 24);
    Sp.annulus(0, 0, 0.061, 0.066, T.glowDim, 0.5, 0.002, 24);
    for (let ring = 1; ring <= 3; ring++) for (let h = 0; h < ring * 8; h++) {
      const t = (h / (ring * 8)) * TAU, r = ring * 0.015;
      Sp.disc(Math.cos(t) * r, Math.sin(t) * r, 0.003, T.tub, 0, 0.002, 6);
    }
  }
  sink = faces;

  // ── THE FIREWALL: carbon, quilted leather behind each bucket, the engine's glass port between them ──
  const NS = 80, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.carbon);
  const yB = G.Y(fB), xC = G.X(0);
  for (const cx of [0, 2 * xC]) {
    K.box(cx - 0.18, yB, zF + 0.30, cx + 0.18, yB + 0.03, zF + 0.70, 'post', -0.05, T.leatherDk);
    for (let r = 1; r < 5; r++) K.box(cx - 0.18, yB + 0.03, zF + 0.30 + r * 0.08, cx + 0.18, yB + 0.034, zF + 0.302 + r * 0.08, 'post', 0.1, T.stitch, 0.15);
  }
  // The port: a small window into the engine bay, the pusher's motor glowing behind it.
  K.box(xC - 0.07, yB, zF + 0.50, xC + 0.07, yB + 0.012, zF + 0.64, 'post', 0.05, T.metal);
  K.box(xC - 0.058, yB + 0.012, zF + 0.512, xC + 0.058, yB + 0.016, zF + 0.628, 'post', 0.2, [40, 28, 60], 0.6);
  K.box(xC - 0.14, yB + 0.005, zF + 0.72, xC + 0.14, yB + 0.02, zF + 0.735, 'post', 0.2, T.glow, 0.9);

  // ── THE FLOOR: carbon tub, mats, and a raised tunnel between the seats ──
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = merlinPoint(f, a, -inset);
      if (prev && prev[2] < MERLIN_INSIDE.floorH && q[2] >= MERLIN_INSIDE.floorH) {
        const t = (MERLIN_INSIDE.floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const FF = [];
  for (let f = fB; f < fN; f += 0.025) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[xC - w0, G.Y(f0), zF], [xC + w0, G.Y(f0), zF], [xC + w1, G.Y(f1), zF], [xC - w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 6 === 5 ? T.floorEdge : T.floor);
    for (const s of [-1, 1]) K.box(xC + s * (w0 - 0.04) - 0.005, G.Y(f0), zF + 0.001, xC + s * (w0 - 0.04) + 0.005, G.Y(f1), zF + 0.004, 'floor', 0.2, T.glow, 0.8);
  }
  // The sills: the tub's wide carbon sides you step over, under the door cards, with a lit maker's line.
  for (const s of [-1, 1]) {
    const yA = G.Y(D.f[0] + 0.02), yZ = G.Y(D.f[1] - 0.04), wx = floorHalf((D.f[0] + D.f[1]) / 2);
    K.box(xC + s * wx - (s > 0 ? 0.09 : 0), yA, zF, xC + s * wx + (s < 0 ? 0.09 : 0), yZ, zF + 0.12, 'floor', 0.0, T.carbon);
    K.box(xC + s * (wx - 0.045) - 0.004, yA + 0.05, zF + 0.121, xC + s * (wx - 0.045) + 0.004, yZ - 0.05, zF + 0.124, 'floor', 0.2, T.glow, 0.9);
  }

  // Each door's hinge in the shell: the roof rail along its top edge, back to front (a gull wing), and
  // the sign that lifts it outward (the shell's axes are the body's turned, so it is worked out here).
  const hinge = {};
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    const pivot = S(D.f[0], A(D.aHi)), axis = norm(sub(S(D.f[1], A(D.aHi)), pivot));
    const front = S(D.f[1], A(0)), out = sub(toShell(merlinPoint(D.f[1], A(0), 0)), front);
    const sign = dot(sub(turnAbout(front, pivot, axis, 0.3), front), out) > 0 ? 1 : -1;
    hinge[s] = { pivot, axis, sign };
  }
  return { faces, doorFaces, hinge, pulls };
}

// A point turned `th` radians about the line through `pivot` along unit `axis` (Rodrigues).
function turnAbout(q, pivot, axis, th) {
  const v = sub(q, pivot), c = Math.cos(th), s = Math.sin(th);
  const kxv = cross(axis, v), kv = dot(axis, v);
  return add(pivot, add(add(mul(v, c), mul(kxv, s)), mul(axis, kv * (1 - c))));
}
// How far the doors stand open, in radians, from the cockpit's `door` (0 shut, 1 open).
const DOOR_SWING = 68 * DEG;
const doorAngle = (live) => Math.max(0, Math.min(1, Number(live && live.door) || 0)) * DOOR_SWING;

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film: each window in the layout, faceted along the
// body in (f, angle) small enough to be flat, 5 mm inside the skin and outboard of every reveal.
function buildGlass(G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [], doorPanes = { 1: [], [-1]: [] };
  for (const p of merlinPanes()) {
    const into = p.id === 'side' ? doorPanes[Math.cos(((p.a[0] + p.a[1]) / 2) * DEG) > 0 ? 1 : -1] : panes;
    const nf = p.id === 'windscreen' ? 8 : 6, na = p.id === 'windscreen' ? 16 : 6;
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(p.f[0], p.f[1], i / nf), fb = lerp(p.f[0], p.f[1], (i + 1) / nf), aa = lerp(p.a[0], p.a[1], j / na), ab = lerp(p.a[0], p.a[1], (j + 1) / na);
      into.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(merlinPoint(f, a, -d))));
    }
  }
  return { panes, doorPanes };
}

// A convex cell minus a convex hole, as disjoint convex pieces (interior-drake.js's own method).
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
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
const bbOf = (P) => [Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))];
const bbOverlap = (A, B) => { const a = bbOf(A), b = bbOf(B); return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; };
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

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function merlinShell(P, live, push, rich) {
  const D = P.mr;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  // The doors: as built while they're shut, turned on their hinges while they open.
  const th = doorAngle(live);
  for (const s of [1, -1]) {
    const h = D.hinge[s];
    for (const f of D.doorFaces[s]) {
      if (!th) { push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0); continue; }
      const a = th * h.sign;
      push([{ p: f.p.map((q) => turnAbout(q, h.pivot, h.axis, a)), n: sub(turnAbout(add(h.pivot, f.n), h.pivot, h.axis, a), h.pivot) }], f.tone, f.k, false, f.rgb, f.emis || 0);
    }
  }
  // The seats never move: built once (interior-memo.js memoPart).
  memoPart(push, 'mr:seats', {}, (S, rec) => seats(P, rec), null);
  if (rich) merlinFit(P, live, push);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    temp: clamp(num(L.oilTemp, 0.4), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
    mr: L.mr || null,
    owner: String(L.owner || '').toUpperCase(), reg: String(L.reg || '').toUpperCase(),
    phase: num(L.phase), stall: !!L.stall,
  };
};
const night = (R) => nightAt(R.hour);
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── THE TOUCH SCREEN: the setup menu (merlin-menu.js) across the FANS and CHG pages while it's open ──
// One pane of glass over both pages: the menu's rows down its left, a key each, and on its right the
// Merlin's status (a turning wireframe with its damage and its charge, and the registered owner) or,
// on the HUD page, a colour wheel. A tap on either page while it's shut opens it, as the knob does.
const menuOpen = (R) => !!(R.L.mrMenu && R.L.mrMenu.open);
const MENU_ROW_Y = (i) => 0.028 - i * 0.019;
const ROW_W = 0.105;                       // the rows' column, from the screen's left edge
const PANEL_X = 0.058;                     // the right half's centre
const WHEEL_UI = { x: 0.03, y: -0.004, r0: 0.02, r1: 0.05, rMid: 0.035 };
const glowHex = (R) => (/^#[0-9a-fA-F]{6}$/.test(R.L.underglow || '') ? R.L.underglow : null);
const menuCtx = (R) => ({ hudName: hudTint(R.L.hudTint).name, glowName: glowHex(R) ? hudTint(glowHex(R)).name : 'OFF' });
function touchPage(Pn, R, live, sc) {
  const M = R.L.mrMenu, rows = menuRows(M, menuCtx(R)), tint = hudTint(R.L.hudTint).line;
  const xL = -sc.w + 0.006, xR = xL + ROW_W;
  Pn.rect(-sc.w + 0.004, -SCREEN_H + 0.004, sc.w - 0.004, SCREEN_H - 0.006, [10, 8, 18], 0.4, 0.002);
  fancyText(Pn, menuTitle(M), xL + 0.002, 0.05, 0.0085, [190, 184, 240], 0.6, 0.009, F_TITLE, ROW_W, 'l');
  rows.forEach((r, i) => {
    const y = MENU_ROW_Y(i), on = i === M.sel, hov = !!live && (live.hover === 'ck:mnu:' + i || live.press === 'ck:mnu:' + i);
    // A key: a rounded slab under each row, lit when the cursor's on it or a finger is.
    Pn.rect(xL, y - 0.0085, xR, y + 0.0085, on ? tint : hov ? [90, 84, 130] : [26, 24, 40], on ? 0.35 : hov ? 0.25 : 0.12, 0.004);
    const rgb = r.off ? [96, 92, 120] : on ? [250, 248, 255] : [214, 210, 232];
    fancyText(Pn, r.label, xL + 0.005, y, 0.0078, rgb, r.off ? 0.3 : 0.85, 0.006, F_TITLE, ROW_W * 0.6, 'l');
    if (r.value) fancyText(Pn, r.value, xR - 0.004, y, 0.0068, r.off ? [96, 92, 120] : r.id === 'hud.colour' ? tint : [214, 210, 232], r.off ? 0.3 : 0.9, 0.006, F_TITLE, ROW_W * 0.3, 'r');
  });
  // The rule between the halves.
  Pn.rect(xR + 0.006, -SCREEN_H + 0.01, xR + 0.0075, SCREEN_H - 0.012, [70, 64, 110], 0.5, 0.003);
  if (menuPanel(M) === 'wheel') wheelPanel(Pn, R, live);
  else statusPanel(Pn, R, sc);
}

// The colour wheel: twelve hues round a ring, a tap each, and in the middle the HUD's own green (HUD
// page) or OFF (LIGHTS page, the underglow). The colour in use now is ringed.
function wheelPanel(Pn, R, live) {
  const glow = R.L.mrMenu && R.L.mrMenu.page === 'lights';
  const W = WHEEL_UI, cur = glow ? (glowHex(R) || 'off') : (R.L.hudTint || 'green');
  HUD_WHEEL.forEach((hex, i) => {
    const t = hudTint(hex), a0 = Math.PI / 2 - i * TAU / 12 + TAU / 24, a1 = a0 - TAU / 12;
    const hov = !!live && live.hover === 'ck:hue:' + i, on = cur === hex;
    Pn.annulus(W.x, W.y, W.r0 - (on ? 0.003 : 0), W.r1 + (on || hov ? 0.004 : 0), t.line, on ? 1 : hov ? 0.95 : 0.75, on ? 0.006 : 0.004, 4, a0 - 0.02, a1 + 0.02);
  });
  const mid = glow ? 'off' : 'green', g = glow ? [40, 38, 52] : hudTint('green').line, gOn = cur === mid;
  Pn.disc(W.x, W.y, W.r0 - 0.006, g, gOn ? 1 : 0.7, 0.005, 18);
  if (gOn) Pn.annulus(W.x, W.y, W.r0 - 0.005, W.r0 - 0.003, [250, 248, 255], 1, 0.006, 18);
  if (glow) fancyText(Pn, 'OFF', W.x, W.y, 0.0058, [200, 196, 220], 0.8, 0.006, F_TITLE, 0.02, 'c');
  // The swatch and its name, to the right of the wheel.
  const t = cur === 'off' ? { line: [40, 38, 52], name: 'OFF' } : hudTint(cur);
  Pn.rect(0.095, 0.006, 0.145, 0.026, t.line, 1, 0.005);
  fancyText(Pn, (glow ? 'UNDERGLOW ' : '') + t.name, 0.12, -0.008, 0.0072, [226, 222, 236], 0.85, 0.006, F_TITLE, 0.05, 'c');
  fancyText(Pn, 'TAP A COLOUR', 0.12, -0.028, 0.0052, [150, 144, 200], 0.6, 0.006, F_TITLE, 0.055, 'c');
}

// The Merlin as a wireframe: section rings and longerons off the loft (cabin-merlin.js), the four
// ducts and the battery under the tub. Made once in model units (f fore, g right, h up); turned and
// projected each frame.
const WIRE = (() => {
  const segs = [], ring = (f, out = 0) => Array.from({ length: 16 }, (_, k) => merlinPoint(f, k * 22.5, out));
  const st = MERLIN_STATIONS.map((s) => s.f);
  for (const i of [1, 3, 5, 7, 9, 11, 13, 15]) { const r = ring(st[i]); r.forEach((q, k) => segs.push([q, r[(k + 1) % 16], 'hull'])); }
  for (const a of [0, 45, 90, 135, 180, 225, 270, 315]) {
    for (let i = 1; i < st.length; i += 2) segs.push([merlinPoint(st[i - 1], a), merlinPoint(st[Math.min(i + 1, st.length - 1)], a), 'hull']);
  }
  for (const [f, g0] of MERLIN_DUCTS.at) for (const g of [g0, -g0]) {
    for (let k = 0; k < 12; k++) {
      const a = k * TAU / 12, b = (k + 1) * TAU / 12, r = MERLIN_DUCTS.rOut;
      segs.push([[f + Math.cos(a) * r, g + Math.sin(a) * r, MERLIN_DUCTS.h1], [f + Math.cos(b) * r, g + Math.sin(b) * r, MERLIN_DUCTS.h1], 'duct']);
    }
  }
  // The battery: a long box in the tub.
  const B = { f0: -0.5, f1: 0.26, g: 0.12, h0: -0.12, h1: -0.08 }, c = [];
  for (const f of [B.f0, B.f1]) for (const g of [-B.g, B.g]) for (const h of [B.h0, B.h1]) c.push([f, g, h]);
  for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) segs.push([c[i], c[j], 'cell']);
  // Each hull segment's own number, for which of them show damage first.
  segs.forEach((s, i) => { s[3] = ((i * 2654435761) >>> 0) / 4294967296; });
  return { segs, B };
})();
function statusPanel(Pn, R, sc) {
  const yaw = wallSec() * 0.45, pitch = 0.42, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const S = 0.115, ox = PANEL_X + 0.008, oy = 0.006;
  const proj = ([f, g, h]) => {
    const u = f * cy - g * sy, d = f * sy + g * cy;
    return [ox + u * S, oy + (h * cp + d * sp) * S];
  };
  const seg = (a, b, w, rgb, k) => {
    const A = proj(a), B = proj(b), dx = B[0] - A[0], dy = B[1] - A[1];
    Pn.spoke(A[0], A[1], Math.atan2(dy, dx), 0, Math.hypot(dx, dy), w, rgb, k, 0.004);
  };
  // Damage: the hull's lost fraction shows as that share of its members gone red, flickering.
  const lost = 1 - R.hull, flick = 0.6 + 0.4 * Math.sin(wallSec() * 9);
  const base = R.hull < 0.3 ? T.amber : [150, 140, 236];
  for (const [a, b, kind, hash] of WIRE.segs) {
    if (kind === 'cell') { seg(a, b, 0.0006, [120, 200, 255], 0.8); continue; }
    const hurt = kind === 'hull' && hash < lost * 1.1;
    seg(a, b, hurt ? 0.0009 : 0.0006, hurt ? T.red : kind === 'duct' ? [190, 184, 240] : base, hurt ? flick : 0.75);
  }
  // The charge: slats across the battery, filled from the back to the charge left.
  const B = WIRE.B, n = 10, chg = R.fuel, col = chg < 0.15 ? T.red : chg < 0.3 ? T.amber : [120, 220, 255];
  for (let i = 0; i < n; i++) {
    if (chg * n < i + 0.5) break;
    const f = lerp(B.f0, B.f1, (i + 0.5) / n);
    seg([f, -B.g, B.h1], [f, B.g, B.h1], 0.0011, col, 0.95);
    seg([f, -B.g, B.h0], [f, B.g, B.h1], 0.0006, col, 0.7);
  }
  // The numbers: hull and charge up top, the registration and the registered owner along the foot.
  const hullRgb = R.hull < 0.3 ? T.red : R.hull < 0.6 ? T.amber : [150, 230, 170];
  fancyText(Pn, 'HULL ' + Math.round(R.hull * 100), sc.w - 0.008, 0.05, 0.0068, hullRgb, 0.9, 0.006, F_TITLE, 0.05, 'r');
  fancyText(Pn, 'CHG ' + Math.round(chg * 100), sc.w - 0.065, 0.05, 0.0068, col, 0.9, 0.006, F_TITLE, 0.045, 'r');
  const x0 = -sc.w + 0.006 + ROW_W + 0.014;
  fancyText(Pn, 'OWNER', x0, -0.043, 0.0048, [150, 144, 200], 0.6, 0.006, F_TITLE, 0.03, 'l');
  fancyText(Pn, R.owner || 'UNREGISTERED', x0 + 0.033, -0.043, 0.0062, [236, 232, 255], 0.9, 0.006, F_TITLE, sc.w - 0.01 - x0 - 0.033, 'l');
  fancyText(Pn, 'REG', x0, -0.056, 0.0048, [150, 144, 200], 0.6, 0.006, F_TITLE, 0.03, 'l');
  fancyText(Pn, R.reg || '-', x0 + 0.033, -0.056, 0.0062, [236, 232, 255], 0.9, 0.006, F_NUM, sc.w - 0.01 - x0 - 0.033, 'l');
}

// ── THE YOKE ─────────────────────────────────────────────────────────────────
// A cut yoke: two horns off a flat bottom, open over the top. One place says where it is and how it's
// turned; the drawing and the hotspots both read it. The column comes out of the dash toward the
// pilot; the yoke faces the eye. Turning it rolls it up to 90 degrees each way. In the air pushing and
// pulling slide it 5 cm along the column (a pull comes toward you, as the stick rule says); on the road
// (merlin-modes.js HOVER) that travel is locked and it only turns, as a car's wheel does.
// 33 cm across the horns, for room on the hub for eight keys a person can read. The code keeps the
// names it had as a wheel (WHEEL, wheelAt, RIM).
const WHEEL = { c: [0, 0.44, -0.25], r: 0.165, tube: 0.016, grip: 0.021, turn: 1.55, slide: 0.05 };
const WHEEL_AXIS = norm([0, -0.86, 0.5]);    // toward the pilot and a little up
function wheelAt(R) {
  const road = R.mr && (R.mr.mode === 'road' || R.mr.mode === 'down');
  const a = WHEEL_AXIS, slide = road ? 0 : R.elev * WHEEL.slide;
  const c = add(WHEEL.c, mul(a, slide));
  const u0 = [1, 0, 0], v0 = norm(cross(a, u0));
  const th = R.ail * WHEEL.turn, ct = Math.cos(th), st = Math.sin(th);
  // Turning right takes the top of the rim to the right, as seen from the seat.
  const u = norm(sub(mul(u0, ct), mul(v0, st))), v = norm(add(mul(v0, ct), mul(u0, st)));
  const P = (x, y, z = 0) => add(add(add(c, mul(u, x)), mul(v, y)), mul(a, z));
  return { c, a, u, v, P, th };
}
// The wheel at rest (stick centred), where every piece of it is built before it is moved.
const WHEEL_REST = wheelAt({ ail: 0, elev: 0 });
// The yoke's outline in its own plane, one open run: up the left horn from its tip, across the flat
// bottom, and up the right horn to its tip. The third number is the angle round the hub, which the
// drawing reads to tell the grips from the bottom (270 marks the bottom).
const HORN = 62;   // degrees above the hub's middle each horn rises to
const RIM = (() => {
  const pts = [], r = WHEEL.r, low = -32, yb = Math.sin(low * DEG) * r;
  for (let i = 0; i <= 10; i++) { const t = (180 - HORN + (HORN + 32) * i / 10) * DEG; pts.push([Math.cos(t) * r, Math.sin(t) * r, t / DEG]); }
  for (let i = 1; i < 6; i++) { const x = lerp(Math.cos((180 + 32) * DEG) * r, Math.cos(low * DEG) * r, i / 6); pts.push([x, yb, 270]); }
  for (let i = 0; i <= 10; i++) { const t = (low + (HORN - low) * i / 10) * DEG; pts.push([Math.cos(t) * r, Math.sin(t) * r, t / DEG]); }
  return pts;
})();
// The keys on the wheel's face, either side of the hub screen: the four circuits the sim has.
const BTN = { ids: ['master', 'land', 'panel', 'dome'], names: { master: 'START', land: 'LIGHTS', panel: 'PANEL', dome: 'CABIN' } };
// The hub's layout, centre out: the screen (±0.05 by ±0.034), the circuit keys either side of it,
// BOOST and PIT outboard under the thumbs (inside the grips' inner edge at 0.143), HOVER and LOCK under
// the screen (above the flat bottom's inner edge at -0.071). Every gap is at least 4 mm.
const BTN_AT = (i) => ({ x: [-0.079, 0.079][i % 2], y: [0.021, -0.021][i >> 1] });
// The drive keys (merlin-modes.js): HOVER and LOCK on the lower spoke, BOOST under the right thumb and
// PIT under the left, each smaller than the circuit keys and ringed in its own colour: HOVER in the
// marker's yellow, LOCK green, BOOST red with its heat round it, PIT blue.
const DRIVE = [
  { id: 'hover', name: 'HOVER', x: -0.03, y: -0.0525, r: 0.0165 },
  { id: 'lock', name: 'LOCK', x: 0.03, y: -0.0525, r: 0.0165 },
  { id: 'boost', name: 'BOOST', x: 0.12, y: 0, r: 0.0165 },
  { id: 'pit', name: 'PIT', x: -0.12, y: 0, r: 0.0165 },
];
function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  return R.powered;
}
// The paddles behind the rim, turning with it: right is collective up, left is collective down.
const PADDLES = [{ id: 'ck:padUp', x: 0.13, name: '+' }, { id: 'ck:padDn', x: -0.13, name: '-' }];

// ── THE DASH: a low carbon shelf across the cabin under the windscreen's long foot, and on its face
// one band of glass with the pages on it ──
const DASH = { xL: -0.74, xR: 0.27, yMid: 0.84, sag: 0.12, w: 0.62, z0: -0.52, h: 0.17, lean: 0.55 };
function dashCurve(P) {
  const xC = P.xCentre;
  return (s) => {
    const x = lerp(DASH.xL, DASH.xR, s), q = (x - xC) / DASH.w;
    const y = DASH.yMid - DASH.sag * q * q, dy = -2 * DASH.sag * q / DASH.w;
    return { p: [x, y, DASH.z0], f: norm([-dy, 1, 0]) };
  };
}
const sOf = (x) => (x - DASH.xL) / (DASH.xR - DASH.xL);
const bandPanel = (K, P, x, v, lift = 0.005) => bandFrame(dashCurve(P), DASH.lean).at(K, sOf(x), v, lift);
// The pages on the band: the map (the screen you click) in the centre stack, the fans and the
// energy toward the passenger. The pilot's numbers are on the wheel and the windscreen HUD.
const SCREENS = [
  { id: 'map', x: -0.29, w: 0.12, boot: 0.15 },
  { id: 'fans', x: -0.52, w: 0.10, boot: 0.3 },
  { id: 'energy', x: -0.68, w: 0.055, boot: 0.45 },
];
// The touch screen: the FANS and CHG pages as one pane while the setup menu is open.
const TOUCH = { id: 'touch', x: (SCREENS[1].x + SCREENS[1].w + SCREENS[2].x - SCREENS[2].w) / 2, w: (SCREENS[1].x + SCREENS[1].w - SCREENS[2].x + SCREENS[2].w) / 2, boot: 0.3 };
const SCREEN_H = 0.065, PAGE_V = 0.095;
const screenPanel = (K, P, sc) => bandPanel(K, P, sc.x, PAGE_V, 0.014);
const LAMP_X = [-0.18, -0.06, 0.06, 0.18];

export function merlinHotspots(P, live) {
  const R = readings(live), K = makeKit(() => {}), out = [];
  const Wh = wheelAt(R);
  const face = K.panel(Wh.P(0, 0, 0.012), Wh.u, Wh.v, 'dash', 0);
  BTN.ids.forEach((id, i) => { const b = BTN_AT(i); out.push({ id: 'ck:' + id, p: face.pt(b.x, b.y, 0.012), r: 0.018, kind: 'click' }); });
  for (const d of DRIVE) out.push({ id: 'ck:' + d.id, p: face.pt(d.x, d.y, 0.012), r: d.r + 0.002, kind: 'click' });
  // The rim: grab it at the right-hand grip and drag.
  out.push({ id: 'yoke', p: Wh.P(WHEEL.r * 0.94, WHEEL.r * 0.2, 0.01), r: 0.05, kind: 'yoke' });
  for (const pd of PADDLES) out.push({ id: pd.id, p: Wh.P(pd.x, 0.03, -0.035), r: 0.03, kind: 'click' });
  // The centre page is the map, the screen you click for the GPS.
  out.push(gpsHotspot(screenPanel(K, P, SCREENS[0]), 0, 0, 0.055));
  // The touch screen: shut, a tap on the FANS or CHG page opens it; open, every row is a key, and
  // on the HUD page every hue on the wheel.
  const menu = R.L.mrMenu;
  if (menu && menu.open) {
    const Pm = screenPanel(K, P, TOUCH), x = -TOUCH.w + 0.006 + ROW_W / 2;
    menuRows(menu, menuCtx(R)).forEach((r, i) => out.push({ id: 'ck:mnu:' + i, p: Pm.pt(x, MENU_ROW_Y(i), 0.006), r: 0.0095, kind: 'click' }));
    if (menuPanel(menu) === 'wheel') {
      const W = WHEEL_UI;
      HUD_WHEEL.forEach((hex, i) => { const a = Math.PI / 2 - i * TAU / 12; out.push({ id: 'ck:hue:' + i, p: Pm.pt(W.x + Math.cos(a) * W.rMid, W.y + Math.sin(a) * W.rMid, 0.006), r: 0.0085, kind: 'click' }); });
      out.push({ id: 'ck:hue:green', p: Pm.pt(W.x, W.y, 0.006), r: 0.012, kind: 'click' });
    }
  } else if (menu) {
    for (const sc of [SCREENS[1], SCREENS[2]]) out.push({ id: 'ck:touch', p: screenPanel(K, P, sc).pt(0, 0, 0.006), r: Math.min(sc.w, SCREEN_H) * 0.9, kind: 'click' });
  }
  const kn = hudKnobAt(P);
  out.push({ id: 'ck:hud', p: add(kn.c, mul(kn.n, 0.03)), r: 0.03, kind: 'click' });
  // The door pulls open and shut both doors on the ground; each rides its door round the hinge.
  // With the doors open, the OUT hologram beside each one climbs you out.
  for (const s of [1, -1]) {
    const q = pullAt(P, live, s);
    if (q) out.push({ id: 'ck:door', p: q, r: 0.05, kind: 'click' });
    const H = outHolo(P, live, s);
    if (H) out.push({ id: 'ck:out', p: H.c, r: 0.05, kind: 'click' });
  }
  return out;
}

// A door's pull where it stands now, turned with its door.
function pullAt(P, live, s) {
  const D = P.mr, q = D && D.pulls && D.pulls[s];
  if (!q) return null;
  const th = doorAngle(live), h = D.hinge[s];
  return th ? turnAbout(q, h.pivot, h.axis, th * h.sign) : q;
}
// The OUT hologram: once a door is most of the way open, a ring of light 10 cm in from its pull and
// a little above it, standing up and facing into the cabin.
const OUT_AT = 0.85;
function outHolo(P, live, s) {
  if (!(Number(live && live.door) > OUT_AT)) return null;
  const D = P.mr, q = D && D.pulls && D.pulls[s];
  if (!q) return null;
  const inw = norm([P.xCentre - q[0], 0, 0].map((v, i) => (i === 0 ? (v || 1) : v)));
  const c = add(add(q, mul(inw, 0.1)), [0, 0, 0.08]);
  return { c, r: [0, 1, 0], u: [0, 0, 1] };
}
function outHoloDraw(K, P, live) {
  const t = bootAge(live), flick = 0.8 + 0.2 * Math.sin(t * 11) * Math.sin(t * 3.7);
  for (const s of [1, -1]) {
    const H = outHolo(P, live, s);
    if (!H) continue;
    const hov = !!live && (live.hover === 'ck:out' || live.press === 'ck:out');
    const Pn = K.panel(H.c, H.r, H.u, 'dash', 0);
    const rgb = hov ? [190, 255, 235] : [90, 230, 210], k = (hov ? 1 : 0.75) * flick;
    Pn.annulus(0, 0, 0.034, 0.038, rgb, k, 0.001, 28);
    Pn.annulus(0, 0, 0.041, 0.042, rgb, k * 0.5, 0.001, 28, t * 2, t * 2 + TAU * 0.7);
    fancyText(Pn, 'OUT', 0, -0.009, 0.016, rgb, k, 0.002, F_TITLE, 0.05);
    // An arrow over the word, pointing out through the door.
    Pn.rect(-0.012, 0.012, 0.008, 0.016, rgb, k, 0.002);
    Pn.plate([[0.008, 0.007], [0.02, 0.014], [0.008, 0.021]], rgb, k, 0.002);
  }
}

// ── WHERE THE DASH'S FITTINGS ARE ────────────────────────────────────────────
// The dash's section tapers toward the doors (dashCurve's `tap`); everything mounted on its faces
// is placed through the same taper, so it sits on the surface wherever along the dash it goes.
const dashTap = (s) => 1 - 0.55 * Math.abs(2 * s - 1) ** 3;
// A panel on the lower fascia facing the cabin, at x, `dz` below the band's foot.
function fasciaFrame(P, x, dz) {
  const s = sOf(x), c = dashCurve(P)(s), tap = dashTap(s);
  const o = add(add(c.p, mul(c.f, -0.072 * tap)), [0, 0, dz]);
  return { o, right: [c.f[1], -c.f[0], 0], up: [0, 0, 1], n: mul(c.f, -1), c };
}
// The centre spine: a carbon blade from under the dash down to the tunnel's nose, faced up and back,
// with the HUD knob on it.
function spineAt(P) {
  const xC = P.xCentre, c = dashCurve(P)(sOf(xC));
  const top = add(add(c.p, mul(c.f, -0.03)), [0, 0, -0.1]);
  const bot = [xC, 0.56, P.mr.zF + 0.29];
  const along = norm(sub(bot, top)), right = [1, 0, 0], n = norm(cross(right, along));
  return { top, bot, along, right, n: n[2] > 0 ? n : mul(n, -1), len: Math.hypot(...sub(bot, top)) };
}
// The HUD knob: on the fascia left of the yoke, under the map and beside the touch screen it
// drives, where the eye sees it past the left horn. (It was on the spine, behind the hub.)
function hudKnobAt(P) {
  const V = fasciaFrame(P, -0.355, -0.058), c = add(V.o, mul(V.n, 0.004));
  return { c, n: V.n, u: V.right, v: V.up };
}
// Two families of diagonal stitches over a rectangle: diamond quilting. `o` the centre, U and V the
// panel's axes, N its normal, half-sizes hw and hh, `step` the diamond's pitch.
function quilt(K, o, U, V, N, hw, hh, step, rgb, tone = 'seat') {
  const at = (u, v) => add(add(add(o, mul(U, u)), mul(V, v)), mul(N, 0.0016));
  for (let c = -(hw + hh) + step / 2; c < hw + hh; c += step) {
    const a0 = Math.max(-hw, -hh + c), a1 = Math.min(hw, hh + c);
    if (a1 - a0 > 0.01) K.rod(at(a0, a0 - c), at(a1, a1 - c), 0.0016, tone, 0.2, rgb, 0.2, 4, false);
    const b0 = Math.max(-hw, c - hh), b1 = Math.min(hw, c + hh);
    if (b1 - b0 > 0.01) K.rod(at(b0, c - b0), at(b1, c - b1), 0.0016, tone, 0.2, rgb, 0.2, 4, false);
  }
}

// ── THE SEATS: deep carbon buckets in oxblood leather, red stitching, a red six-point harness ──
function seats(P, push) {
  const K = makeKit(push, false);
  for (const cx of [0, 2 * P.xCentre]) bucket(K, P, cx);
}
function bucket(K, P, cx) {
  const h = P.seatHalf, [y0, y1] = P.seatY, sz = P.seatZ, zF = P.mr.zF;
  // The pan, low on its rails, tilted back: knees above hips, as in a car that sits this low.
  K.box(cx - 0.16, y0 + 0.06, zF, cx + 0.16, y1 - 0.1, sz - 0.1, 'seat', -0.25, T.carbon);
  for (const s of [-1, 1]) K.box(cx + s * 0.12 - 0.012, y0 - 0.02, zF, cx + s * 0.12 + 0.012, y1, zF + 0.02, 'seat', 0.2, T.metal);
  K.box(cx - h, y0, sz - 0.1, cx + h, y1, sz - 0.05, 'seat', 0.0, T.carbon);
  K.box(cx - h + 0.06, y0 + 0.02, sz - 0.05, cx + h - 0.06, y1 - 0.02, sz, 'seat', 0.08, T.leather);
  // The thigh bolsters, high, and their stitching.
  for (const s of [-1, 1]) {
    K.box(cx + s * h - s * 0.06, y0, sz - 0.05, cx + s * h, y1, sz + 0.09, 'seat', 0.05, T.leather);
    K.box(cx + s * (h - 0.06) - 0.002, y0 + 0.02, sz + 0.06, cx + s * (h - 0.06) + 0.002, y1 - 0.02, sz + 0.064, 'seat', 0.2, T.stitch, 0.25);
  }
  // Diamond quilting across the cushion's insert, in red thread.
  quilt(K, [cx, (y0 + y1) / 2, sz], [1, 0, 0], [0, 1, 0], [0, 0, 1], h - 0.07, (y1 - y0) / 2 - 0.03, 0.075, T.stitch);
  // The back: a carbon shell leaning 10 degrees, the leather insert quilted, wings at the shoulders,
  // and a fixed headrest with the harness slots through it.
  const lean = 0.17, bb = [cx, y0 - 0.01, sz], up = [0, -Math.sin(lean), Math.cos(lean)], fw = [0, Math.cos(lean), Math.sin(lean)];
  const bH = 0.56, bc = add(bb, mul(up, bH / 2));
  K.obox(add(bc, mul(fw, -0.06)), [1, 0, 0], up, fw, h, bH / 2, 0.04, 'seat', -0.06, T.carbon);
  K.obox(add(bc, mul(fw, -0.015)), [1, 0, 0], up, fw, h - 0.07, bH / 2 - 0.04, 0.012, 'seat', 0.0, T.leather);
  quilt(K, add(bc, mul(fw, -0.003)), [1, 0, 0], up, fw, h - 0.08, bH / 2 - 0.05, 0.075, T.stitch);
  for (const s of [-1, 1]) {
    K.obox(add(add(bc, mul(fw, 0.0)), [s * (h - 0.03), 0, 0]), [1, 0, 0], up, fw, 0.035, bH / 2, 0.06, 'seat', 0.0, T.leather);
    K.obox(add(add(bb, mul(up, bH * 0.7)), [s * (h - 0.01), 0, 0]), [1, 0, 0], up, fw, 0.025, 0.07, 0.06, 'seat', 0.0, T.carbon);
  }
  const hc = add(bb, mul(up, bH + 0.06));
  K.obox(add(hc, mul(fw, -0.04)), [1, 0, 0], up, fw, 0.1, 0.08, 0.05, 'seat', 0.0, T.carbon);
  K.obox(add(hc, mul(fw, 0.012)), [1, 0, 0], up, fw, 0.08, 0.06, 0.008, 'seat', 0.0, T.leather);
  for (const s of [-1, 1]) K.obox(add(add(bb, mul(up, bH - 0.01)), [s * 0.06, 0, 0]), [1, 0, 0], up, fw, 0.035, 0.012, 0.045, 'seat', -0.3, T.tub);
  // The six-point harness in red: two shoulder straps, two laps, two crotch straps, a cam-lock buckle.
  const top = add(bb, mul(up, bH - 0.01)), buck = [cx, y1 - 0.18, sz + 0.13];
  for (const s of [-1, 1]) {
    K.rod(add(add(top, mul(fw, 0.03)), [s * 0.06, 0, 0]), add(buck, [s * 0.03, 0, 0.03]), 0.013, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * (h - 0.05), y0 + 0.07, sz + 0.03], add(buck, [s * 0.03, 0, -0.01]), 0.013, 'seat', 0.05, T.harness, 0, 4);
    K.rod([cx + s * 0.05, y1 - 0.06, sz + 0.005], add(buck, [s * 0.012, 0, -0.025]), 0.01, 'seat', 0.05, T.harness, 0, 4);
  }
  K.rod(add(buck, [0, -0.008, 0]), add(buck, [0, 0.012, 0]), 0.036, 'seat', 0.3, T.buckle, 0, 14);
  K.rod(add(buck, [0, 0.012, 0]), add(buck, [0, 0.015, 0]), 0.014, 'seat', 0.3, T.red, 0.3, 10);
}

// ── THE FIT-OUT ──────────────────────────────────────────────────────────────
export function merlinFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live);
  const zF = P.mr.zF, xC = P.xCentre;
  const lit = R.powered, panel = panelOn(R);
  const amb = lit ? (night(R) ? 1 : 0.55) * (R.dome ? 1.2 : 1) : 0.05;
  const boot = bootAge(live);
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn, T.line), lineK = (k) => (lit ? k * al.k : 0.05);

  // ── THE DASH: a low wing swept along the band's curve, the passenger's half a grab rail ──
  const curve = dashCurve(P);
  const gt = [DASH.h * DASH.lean / Math.hypot(1, DASH.lean), DASH.h / Math.hypot(1, DASH.lean)];
  // ⚠ THE PARTS THAT DON'T MOVE ARE BUILT ONCE (interior-memo.js memoPart), as the truck cab's are.
  // Each reads the light only through `S`, so it is rebuilt when the power or the alert colour
  // changes and reused on every other frame: about 4,500 faces that cost ~3 ms a frame rebuilt.
  // Anything that reads a live value (a needle, a key, the wheel, the pedals) stays outside.
  const part = (id, S, fn) => memoPart(push, 'mr:' + id, S, (S2, rec) => fn(makeKit(rec), S2), null);
  part('dash', { line: al.rgb, k: lineK(0.8), panel }, (K, S) => {
  const SEC =[[0, 0], gt, [0.16, 0.15], [0.26, 0.12], [0.29, 0.07], [0.22, -0.06], [0.06, -0.12], [-0.06, -0.08], [-0.07, -0.03], [0, 0]];
  const N = 30, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, tap = 1 - 0.55 * e;
    rings.push(SEC.map(([f, z]) => {
      const ff = f > gt[0] ? gt[0] + (f - gt[0]) * tap : f < 0 ? f * tap : f;
      return [c.p[0] + c.f[0] * ff, c.p[1] + c.f[1] * ff, c.p[2] + (z > gt[1] ? gt[1] + (z - gt[1]) * tap : z) - (z > 0.05 ? 0.04 * e : 0)];
    }));
  }
  // Two materials on one section: the shelf wrapped in oxblood leather, the fascia under the band in
  // clear-lacquered carbon. The ends are capped in brushed aluminium.
  sweep(K, rings.map((r) => r.slice(1, 6)), 'dash', 0.12, T.leather);
  sweep(K, rings.map((r) => r.slice(5, 10)), 'dash', 0.1, T.carbon);
  for (const r of [rings[0], rings[N]]) {
    const n = norm(cross(sub(r[3], r[1]), sub(r[6], r[1])));
    K.face(r.slice(0, -1), n, 'dash', 0.15, T.alu);
    K.face(r.slice(0, -1).reverse(), mul(n, -1), 'dash', 0.15, T.alu);
  }
  // Double red stitching down the leather, a hand back from the shelf's edge.
  for (const t of [0.22, 0.32]) lightLine(K, rings.slice(1, -1).map((r) => add(add(r[1], mul(sub(r[2], r[1]), t)), [0, 0, 0.0025])), 0.0013, T.stitch, 0.2);
  // The spar: one brushed aluminium bar the full width of the dash along the band's foot, polished
  // chrome caps at its ends, and the violet line tucked under it.
  {
    const spar = rings.slice(1, -1).map((r, i) => add(r[0], [0, 0, -0.008]));
    for (let i = 1; i < spar.length; i++) K.rod(spar[i - 1], spar[i], 0.0055, 'dash', 0.3, T.alu, 0, 10);
    for (const q of [spar[0], spar[spar.length - 1]]) K.rod(add(q, [-0.006, 0, 0]), add(q, [0.006, 0, 0]), 0.0075, 'dash', 0.4, T.chrome, 0, 12);
  }
  lightLine(K, rings.map((r) => r[7]), 0.003, S.line, S.k);

  // The vents: four machined rounds in the fascia, a polished rim, a dark throat, eight turbine vanes
  // and a chrome hub, two either side of the pilot and two on the passenger's side.
  for (const x of [0.19, -0.13, -0.43, -0.70]) {
    const V = fasciaFrame(P, x, -0.055);
    const Pn = K.panel(V.o, V.right, V.up, 'dash', 0.1);
    Pn.disc(0, 0, 0.022, [6, 6, 8], 0, 0.0005, 20);
    for (let i = 0; i < 8; i++) Pn.spoke(0, 0, i * TAU / 8 + 0.3, 0.007, 0.02, 0.0022, T.bezel, 0, 0.003);
    Pn.disc(0, 0, 0.0065, T.piano, 0, 0.005, 12);
    Pn.annulus(0, 0, 0.0055, 0.0068, T.chrome, 0.05, 0.0055, 12);
    K.torus(add(V.o, mul(V.n, 0.004)), V.right, V.up, 0.025, 0.0042, 22, 'dash', 0.4, T.chrome);
  }
  // The plaque on the passenger's fascia: brushed aluminium, the name engraved.
  {
    const V = fasciaFrame(P, -0.565, -0.052), Pn = K.panel(V.o, V.right, V.up, 'dash', 0.1);
    Pn.rect(-0.068, -0.014, 0.068, 0.014, T.alu, 0.04, 0.002);
    Pn.rect(-0.07, -0.016, 0.07, -0.014, T.chrome, 0.1, 0.0025);
    fancyText(Pn, 'MERLIN', 0, 0, 0.011, T.engrave, 0, 0.003, F_BADGE, 0.112);
  }

  // The clock: a round analogue clock on the shelf in the middle of the dash, piano black under a
  // chrome bezel, its hands on the hour. Nothing in the cabin says money like a clock you don't need.
  {
    const c = curve(sOf(xC)), base = add(add(c.p, mul(c.f, 0.07)), [0, 0, gt[1] + 0.03]);
    const up = norm([0, 0.55, 0.84]), right = [1, 0, 0];
    K.obox(add(base, [0, 0.01, -0.02]), right, up, norm(cross(right, up)), 0.05, 0.03, 0.02, 'dash', 0.1, T.leather);
    const Pn = K.panel(base, right, up, 'dash', 0.1);
    Pn.disc(0, 0, 0.038, T.piano, 0, 0.001, 28);
    for (let i = 0; i < 12; i++) Pn.spoke(0, 0, Math.PI / 2 - i * TAU / 12, i % 3 === 0 ? 0.026 : 0.03, 0.035, i % 3 === 0 ? 0.0024 : 0.0012, T.chrome, S.panel ? 0.4 : 0.15, 0.002);
    for (const [num, a] of [['12', 90], ['3', 0], ['6', -90], ['9', 180]]) fancyText(Pn, num, Math.cos(a * DEG) * 0.0235, Math.sin(a * DEG) * 0.0235, 0.0072, T.chrome, S.panel ? 0.45 : 0.2, 0.0025, F_NUM, 0.0115);
    K.torus(add(base, mul(norm(cross(right, up)), 0.003)), right, up, 0.04, 0.004, 28, 'dash', 0.45, T.chrome);
  }
  });
  // The clock's hands, on the hour: live, so outside the cached dash.
  {
    const c = curve(sOf(xC)), base = add(add(c.p, mul(c.f, 0.07)), [0, 0, gt[1] + 0.03]);
    const Pn = K.panel(base, [1, 0, 0], norm([0, 0.55, 0.84]), 'dash', 0.1);
    const hr = ((R.hour % 12) + 12) % 12, mn = (R.hour * 60) % 60;
    Pn.spoke(0, 0, Math.PI / 2 - hr / 12 * TAU, -0.004, 0.02, 0.0022, T.chrome, panel ? 0.5 : 0.2, 0.004);
    Pn.spoke(0, 0, Math.PI / 2 - mn / 60 * TAU, -0.005, 0.03, 0.0015, T.chrome, panel ? 0.5 : 0.2, 0.005);
    Pn.disc(0, 0, 0.003, T.stitch, 0.4, 0.006, 10);
  }

  // The shift lights: a leather-hooded strip on the shelf behind the wheel, seen through the top of
  // the rim, lighting from the left with the fans' speed: violet, then amber, then red at the limit.
  {
    const c = curve(sOf(0)), base = add(add(c.p, mul(c.f, 0.1)), [0, 0, gt[1] + 0.022]);
    const up = norm([0, 0.35, 0.94]), right = [1, 0, 0], n = norm(cross(right, up));
    K.obox(add(base, mul(n, -0.01)), right, up, n, 0.075, 0.016, 0.012, 'dash', 0.05, T.carbon);
    K.obox(add(add(base, mul(up, 0.016)), mul(n, -0.002)), right, norm([0, -0.2, 1]), n, 0.08, 0.004, 0.022, 'dash', 0.1, T.leather);
    const Pn = K.panel(base, right, up, 'dash', 0.1), fan = lit ? clamp(R.rpm / 1.05, 0, 1) : 0;
    for (let i = 0; i < 11; i++) {
      const on = fan * 11 > i + 0.5, rgb = i < 6 ? T.glow : i < 9 ? T.amber : T.red;
      Pn.disc(-0.065 + i * 0.013, 0, 0.0045, on ? rgb : [26, 24, 34], on ? 1 : 0, 0.002, 10);
    }
  }

  // The spine: a carbon blade from under the dash to the tunnel's nose, edged in aluminium.
  part('spine', {}, (K) => {
  {
    const S = spineAt(P);
    K.obox(mul(add(S.top, S.bot), 0.5), S.right, S.along, S.n, 0.045, S.len / 2, 0.012, 'dash', 0.1, T.carbon);
    for (const sx of [-1, 1]) K.rod(add(S.top, [sx * 0.046, 0, 0]), add(S.bot, [sx * 0.046, 0, 0]), 0.0028, 'dash', 0.3, T.alu, 0, 6);
  }
  // The struts the dash hangs off, down to the floor.
  for (const x of [xC, xC - 0.45, 0.22]) {
    const c = curve(sOf(x)), top = add(add(c.p, mul(c.f, 0.15)), [0, 0, -0.1]);
    K.rod(top, [top[0], top[1] - 0.05, zF + 0.03], 0.02, 'dash', 0.1, T.carbon, 0, 8);
  }
  });
  // The HUD knob on the fascia: knurled aluminium, its ring lit in the HUD's colour, a click for the menu.
  {
    const kn = hudKnobAt(P), tint = hudTint(R.L.hudTint).line;
    const pressed = !!live && live.press === 'ck:hud', hov = !!live && live.hover === 'ck:hud';
    const dip = eased('mr:dip:hud', pressed ? 0.004 : 0, 30), near = eased('mr:near:hud', hov ? 1 : 0, 14);
    const Pk = K.panel(kn.c, kn.u, kn.v, 'dash', 0.1);
    Pk.annulus(0, 0, 0.024, 0.028, tint, lit ? 0.7 + 0.3 * near : 0.05, 0.001, 24);
    K.rod(add(kn.c, mul(kn.n, 0.002)), add(kn.c, mul(kn.n, 0.024 - dip)), 0.018, 'dash', 0.3, T.alu, 0, 24);
    for (let i = 0; i < 24; i++) {
      const a = i * TAU / 24, d = add(mul(kn.u, Math.cos(a) * 0.0185), mul(kn.v, Math.sin(a) * 0.0185));
      K.rod(add(add(kn.c, d), mul(kn.n, 0.005)), add(add(kn.c, d), mul(kn.n, 0.021 - dip)), 0.0012, 'dash', 0.1, T.brushed, 0, 4, false);
    }
    const Pt = K.panel(add(kn.c, mul(kn.n, 0.0245 - dip)), kn.u, kn.v, 'dash', 0.1);
    Pt.disc(0, 0, 0.015, T.chrome, 0.05, 0.0005, 18);
    Pt.rect(-0.0015, 0.004, 0.0015, 0.013, tint, lit ? 0.9 : 0.1, 0.001);
    Pk.fitText('HUD', 0.05, 0, 0.032, 0.014, [226, 222, 236], panel ? 0.6 : 0.3, 0.002);
    const flash = pressPulse('mr:hud:' + (R.L.hudTint || 'green'), true);
    if (flash > 0.02) Pk.annulus(0, 0, 0.03, 0.034, HALO, flash, 0.004, 24);
  }
  // ── THE BAND and its pages, booting in turn ──
  part('band', { lit, line: al.rgb, k: lineK(1) }, (K, S) => glassBand(K, curve, { h: DASH.h, lean: DASH.lean, segs: 30, lit: S.lit, light: S.line, lightK: S.k, substrate: T.screen }));
  const touch = menuOpen(R);
  for (const sc of touch ? [SCREENS[0], TOUCH] : SCREENS) {
    const Pn = screenPanel(K, P, sc), up = reveal(boot, sc.boot);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-SCREEN_H, SCREEN_H, up);
      Pn.rect(-sc.w, -SCREEN_H, sc.w, y, T.screen, 0.3 * up, 0.001);
      Pn.rect(-sc.w, y - 0.002, sc.w, y + 0.002, T.glow, 1, 0.0025);
      continue;
    }
    Pn.rect(-sc.w + 0.004, SCREEN_H - 0.0035, sc.w - 0.004, SCREEN_H - 0.0015, T.glow, 0.85, 0.0018);
    if (sc.id === 'fans') fanPage(Pn, R, sc);
    else if (sc.id === 'energy') energyPage(Pn, R, sc);
    else if (sc.id === 'touch') touchPage(Pn, R, live, sc);
    else if (sc.id === 'map') mapPage(Pn, R, live, sc);
  }
  // The status lamps along the band's foot, behind the wheel.
  {
    const lamps = [['FANS 4/4', lit && R.rpm > 0.2, C.green], ['LOW CHG', caution, T.red], ['HULL', lit && R.hull < 0.3, T.red], ['STALL', lit && R.stall, T.amber]];
    lamps.forEach(([name, on, rgb], i) => lensLamp(bandPanel(K, P, LAMP_X[i], 0.02, 0.012), 0, 0, 0.1, 0.026, on && reveal(boot, 0.6) >= 1, rgb, name));
  }

  // ── THE WINDSCREEN HUD: projected, conformal, the hands and feet mirrored in its corners ──
  // ⚠ HALF A METRE OUT, NOT THE DRAGONFLY'S 0.62: the screen is raked so far forward that at 0.75 m
  // the combiner would stand outside the glass.
  if (lit) windscreenHud(K, R, { dist: 0.5, z: -0.07, hw: 0.12, hh: 0.06, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE WHEEL ──
  // Its own kit, so its cached pieces keep their places whatever the screens above drew this frame.
  wheel(makeKit(push), R, live, lit, panel, al);

  // ── THE TUNNEL between the seats: carbon, a start cover, a cup and a phone pocket ──
  const cy0 = -0.36, cy1 = 0.52, ct = zF + 0.30;
  part('tunnel', { line: al.rgb, k: lineK(0.8) }, (K, S) => {
  {
    const crings = [];
    for (let i = 0; i <= 8; i++) {
      const y = lerp(cy0, cy1, i / 8), hw = 0.1 * (0.85 + 0.15 * i / 8);
      const sec = [];
      for (let j = 0; j <= 10; j++) {
        const a = Math.PI * j / 10, x = xC - Math.cos(a) * hw, z = j === 0 || j === 10 ? zF : ct - (1 - Math.sin(a)) * 0.05 + Math.sin(a) * 0.004;
        sec.push([x, y, j === 0 || j === 10 ? zF : Math.max(zF + 0.02, z)]);
      }
      crings.push(sec);
    }
    sweep(K, crings, 'dash', 0.1, T.carbon);
    K.face(crings[8].slice(), [0, 1, 0], 'dash', 0.05, T.carbonLt);
    for (const s of [-1, 1]) lightLine(K, crings.map((r) => add(r[s < 0 ? 1 : 9], [0, 0, 0.004])), 0.0022, S.line, S.k);
    lightLine(K, crings.map((r) => add(r[5], [0, 0, 0.003])), 0.0018, T.stitch, 0.2);
  }
  K.rod([xC, -0.18, ct - 0.08], [xC, -0.18, ct + 0.001], 0.04, 'dash', -0.2, T.tub, 0, 14);
  K.box(xC - 0.05, 0.24, ct - 0.03, xC + 0.05, 0.40, ct + 0.001, 'dash', -0.25, T.tub);
  // The engine bay's air vents in the tunnel's face, round and turned to the seats.
  for (const s of [-1, 1]) {
    const c = [xC + s * 0.035, cy1 + 0.003, ct - 0.08];
    K.rod(c, add(c, [0, 0.012, 0]), 0.03, 'dash', 0.2, T.metal, 0, 14);
    K.rod(add(c, [0, 0.012, 0]), add(c, [0, 0.016, 0]), 0.024, 'dash', -0.3, T.tub, 0, 14);
  }
  // The passenger's foot rest.
  K.obox([2 * xC, 0.80, zF + 0.09], [1, 0, 0], norm([0, -0.6, 0.8]), norm([0, 0.8, 0.6]), 0.14, 0.09, 0.008, 'dash', 0.05, T.carbon);
  {
    const fu = norm([0, -0.6, 0.8]), fn = norm([0, -0.8, 0.6]), Pf = K.panel(add([2 * xC, 0.80, zF + 0.09], mul(fn, 0.009)), [1, 0, 0], mul(fu, -1), 'dash', 0.2);
    Pf.rect(-0.12, -0.075, 0.12, 0.075, T.alu, 0.03, 0.001);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) Pf.disc(-0.1 + c * 0.025, -0.055 + r * 0.0275, 0.0055, T.tub, 0, 0.002, 8);
  }
  });

  // ── THE PEDALS: the yaw pedals, drilled alloy, sliding on rails ──
  const pz = zF + 0.12, py = 0.86;
  for (const [dx, sgn] of [[-0.09, -1], [0.09, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
    K.box(dx - 0.012, py - 0.12, zF, dx + 0.012, py + 0.12, zF + 0.02, 'dash', 0.1, T.metal);
    const c = [dx, py + slide, pz], pu = norm([0, -0.45, 0.89]), pn = norm([0, 0.89, 0.45]);
    K.obox(c, [1, 0, 0], pu, pn, 0.04, 0.09, 0.008, 'dash', 0.2, T.brushed);
    const Pd = K.panel(add(c, mul(pn, -0.009)), [1, 0, 0], pu, 'dash', 0.2);
    for (let r = 0; r < 4; r++) for (const xx of [-0.02, 0, 0.02]) Pd.disc(xx, -0.06 + r * 0.04, 0.006, T.tub, 0, 0.001, 8);
    K.rod(add(c, [0, 0, -0.06]), [dx, py + slide, zF + 0.02], 0.012, 'dash', 0.2, T.metal, 0, 6);
    contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
  }

  // ── OVERHEAD: a dome lamp in the roof over the tunnel, and the violet line along each roof rail ──
  {
    const D = P.mr;
    for (const s of [1, -1]) {
      const A = (a) => (s > 0 ? a : 180 - a), pts = [];
      for (const f of [-0.16, -0.08, 0.0, 0.08]) pts.push(D.toShell(merlinPoint(f, A(58), -(D.inset + 0.01 / D.m))));
      lightLine(K, pts, 0.004, al.rgb, (R.dome && lit ? 1 : 0.4) * Math.max(amb, 0.2) * (lit ? al.k : 1), 'hdr');
    }
    const dome = [xC, -0.05, P.roof - 0.05];
    K.rod(add(dome, [0, 0, -0.01]), add(dome, [0, 0, 0.03]), 0.04, 'hdr', 0.1, R.dome && lit ? [240, 236, 255] : [70, 70, 76], R.dome && lit ? 1 : 0, 14);
  }

  outHoloDraw(K, P, live);
  hotspotHalo(K, merlinHotspots(P, live), live);
}

// ── THE WHEEL, drawn ─────────────────────────────────────────────────────────
function wheel(K, R, live, lit, panel, al) {
  // ⚠ BUILT AT REST AND MOVED (K.posed, interior-memo.js memoPosed), as the Mule's wheel is. The yoke
  // turns about its axis with the stick and slides along it with the elevator, a rigid move, so every
  // piece is laid on the wheel at rest (W0) and carried to where it stands by one matrix. Rebuilt where
  // it stood, it was about half the cockpit's cost every frame the stick moved. Each piece is cached on
  // its own arguments, so a key that isn't changing isn't rebuilt; the eased values are rounded so a
  // fade that never quite lands still settles into the cache.
  const Wh = wheelAt(R), W0 = WHEEL_REST;
  const B = (fn) => (...args) => fn(K, W0, ...args);
  const X = xfTurn(W0.c, W0.a, -Wh.th, Wh.c);
  const q = (x) => Math.round(x * 40) / 40;
  const near = eased('mr:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
  K.posed('mrYoke', X, B(wheelBody), lit, q(near), al.rgb);

  // The screen: speed, height, the drive mode and the collective, the pilot's own numbers.
  const M = R.mr;
  const word = !M ? '' : M.locking ? 'LOCK' : M.mode === 'road' ? (M.pit ? 'PIT' : 'ROAD') : M.mode === 'down' || M.mode === 'up' ? 'HOVER' : 'FLIGHT';
  const on = lit && reveal(bootAge(live), 0.1) >= 1;
  K.posed('mrWheelScreen', X, B(wheelScreen), on,
    String(Math.min(999, Math.round(R.ias))).padStart(3, ' '),
    String(Math.min(99999, Math.round(R.alt))).padStart(5, ' ').slice(-5),
    word, Math.round(R.thr * 10 - 0.5));

  // The keys: round, sunk while pressed, lit with their circuit, a ring flashing on a change.
  const key = (id, name, x, y, rad, rgb, isOn, glowK = 1) => {
    const pressed = !!live && live.press === 'ck:' + id, hov = !!live && live.hover === 'ck:' + id;
    const glow = eased('mr:glow:' + id, isOn ? glowK : 0, 10), depth = eased('mr:dip:' + id, pressed ? 0.002 : 0.006, 30), hand = eased('mr:near:' + id, hov ? 1 : 0, 14);
    const flash = pressPulse('mr:key:' + id, isOn);
    K.posed('mrKey:' + id, X, B(wheelKey), name, x, y, rad, rgb, lit, panel, q(glow), Math.round(depth * 4000) / 4000, q(hand), flash > 0.02 ? q(flash) : 0);
  };
  BTN.ids.forEach((id, i) => { const b = BTN_AT(i); key(id, BTN.names[id], b.x, b.y, 0.0205, id === 'master' ? T.red : T.glow, switchOn(id, R)); });
  // The drive keys, lit by what the Merlin is doing (merlin-modes.js through live.mr).
  {
    const Md = R.mr || {}, pulse = 0.55 + 0.45 * Math.sin(bootAge(live) * 7);
    const hoverOn = Md.mode === 'road' ? 1 : Md.mode === 'down' || Md.mode === 'up' ? pulse : 0;
    const lockOn = Md.locking ? 1 : Md.lockReady ? pulse : Md.near ? 0.35 : 0;
    const boostOn = Md.over > 0 ? pulse * 0.6 : Md.boost ? 1 : 0;
    key('hover', 'HOVER', DRIVE[0].x, DRIVE[0].y, DRIVE[0].r, T.marker, hoverOn > 0, hoverOn);
    key('lock', 'LOCK', DRIVE[1].x, DRIVE[1].y, DRIVE[1].r, C.green, lockOn > 0, lockOn);
    key('boost', 'BOOST', DRIVE[2].x, DRIVE[2].y, DRIVE[2].r, T.red, boostOn > 0, boostOn);
    key('pit', 'PIT', DRIVE[3].x, DRIVE[3].y, DRIVE[3].r, C.blue, !!Md.pit);
    // BOOST's heat: an arc round its bezel from the bottom, amber, then red past three quarters.
    const heat = clamp(num(Md.heat), 0, 1);
    K.posed('mrHeat', X, B(wheelHeat), Math.round(heat * 24) / 24, heat > 0.75 || Md.over > 0, lit);
  }
  // The paddles: carbon blades behind the grips, turning with the rim, each lettered on its face.
  PADDLES.forEach((pd, i) => {
    const pressed = !!live && live.press === pd.id, hov = !!live && live.hover === pd.id;
    const pull = eased('mr:pad:' + pd.id, pressed ? 1 : 0, 26);
    const flash = pressPulse('mr:padf:' + pd.id, pressed);
    K.posed('mrPaddle:' + pd.id, X, B(wheelPaddle), i, q(pull), hov, flash > 0.02 ? q(flash) : 0, lit, panel, al.rgb);
  });
}
// The yoke at rest: the column, the rim, the thumb rests, the spokes and the hub with its screen glass.
function wheelBody(K, W, lit, near, line) {
  const { c, a, u, v, P } = W;
  const back = add(c, mul(a, -0.36));
  K.rod(back, add(c, mul(a, -0.06)), 0.04, 'dash', 0.05, T.carbon, 0, 14);
  K.rod(add(c, mul(a, -0.06)), add(c, mul(a, -0.02)), 0.026, 'dash', 0.2, T.metal, 0, 14);
  K.torus(add(c, mul(a, -0.04)), u, v, 0.03, 0.003, 18, 'dash', 0.2, line, lit ? 0.5 + 0.5 * near : 0);
  // The yoke: alcantara on the horns, carbon across the flat bottom, and a yellow tab on each horn's
  // tip, level when it's straight.
  for (let i = 1; i < RIM.length; i++) {
    const [x0, y0, d0] = RIM[i - 1], [x1, y1] = RIM[i];
    const grip = d0 !== 270;
    const top = (d0 > HORN - 10 && d0 <= HORN) || (d0 >= 180 - HORN && d0 < 180 - HORN + 9);
    K.rod(P(x0, y0), P(x1, y1), grip ? WHEEL.grip : WHEEL.tube, 'dash', grip ? 0.05 : 0.15, top ? T.marker : grip ? T.alcantara : T.carbon, top && lit ? 0.3 : 0, 12);
  }
  // Thumb rests where the spokes meet the grips, and the red stitch line round the grips.
  for (const s of [-1, 1]) {
    K.rod(P(s * WHEEL.r * 0.92, WHEEL.r * 0.18), P(s * WHEEL.r * 0.8, WHEEL.r * 0.28), 0.019, 'dash', 0.05, T.alcantara, 0, 8);
    K.rod(P(s * WHEEL.r, -WHEEL.r * 0.3, 0.017), P(s * WHEEL.r, WHEEL.r * 0.3, 0.017), 0.002, 'dash', 0.2, T.stitch, 0.2, 4);
  }
  // The spokes: two carbon plates out to the grips and one down to the flat bottom.
  for (const s of [-1, 1]) K.obox(P(s * 0.112, 0.0, -0.004), u, v, a, 0.045, 0.024, 0.008, 'dash', 0.05, T.carbon);
  K.obox(P(0, -0.0525, -0.004), u, v, a, 0.056, 0.02, 0.008, 'dash', 0.05, T.carbon);
  K.obox(P(0, -0.0525, -0.0005), u, v, a, 0.057, 0.0205, 0.0006, 'dash', 0.3, T.alu);
  // The hub: a carbon plate carrying the screen and the four keys.
  K.obox(P(0, 0, 0.0), u, v, a, 0.14, 0.046, 0.012, 'dash', 0.05, T.carbonLt);
  K.panel(P(0, 0, 0.012), u, v, 'dash', 0.1).rect(-0.05, -0.034, 0.05, 0.034, T.screen, 0, 0.0008);
}
const hubPanel = (K, W) => K.panel(W.P(0, 0, 0.012), W.u, W.v, 'dash', 0.1);
function wheelScreen(K, W, on, ias, alt, word, steps) {
  if (!on) return;
  const Pn = hubPanel(K, W);
  Pn.rect(-0.048, 0.029, 0.048, 0.031, T.glow, 0.8, 0.0015);
  fancyDigits(Pn, -0.046, 0.002, 0.022, ias, T.glow, 0.95, -0.006);
  fancyText(Pn, 'KT', -0.025, -0.013, 0.0075, [190, 184, 240], 0.6, 0.0016, F_TITLE, 0.016);
  fancyDigits(Pn, 0.004, 0.006, 0.016, alt, [236, 232, 255], 0.95, 0.045);
  fancyText(Pn, 'FT', 0.026, -0.013, 0.0075, [190, 184, 240], 0.6, 0.0016, F_TITLE, 0.016);
  if (word) {
    const col = word === 'PIT' ? C.blue : word === 'ROAD' ? T.marker : word === 'LOCK' ? C.green : [190, 184, 240];
    fancyText(Pn, word, 0.0005, -0.013, 0.0052, col, 0.85, 0.0016, F_TITLE, 0.02);
  }
  // The collective as ten steps across the bottom, lit to the lever.
  for (let i = 0; i < 10; i++) {
    const lit = i <= steps, x = -0.044 + i * 0.0098;
    Pn.rect(x, -0.03, x + 0.008, -0.022, lit ? (i > 7 ? T.red : i > 5 ? T.amber : T.glow) : [30, 28, 44], lit ? 0.95 : 0.3, 0.0016);
  }
}
// A round key: a dark well, a polished chrome bezel, and a piano-black cap standing out of it that
// sinks when pressed. The ring round the cap's face lights in the key's colour; the hand coming over
// it brightens the bezel. Every size is a fraction of its radius, so the small keys are the big ones
// scaled, and the label is held inside the ring with a margin.
function wheelKey(K, W, name, x, y, rad, rgb, lit, panel, glow, depth, hand, flash) {
  const Pn = hubPanel(K, W), q = rad / 0.0205;
  Pn.disc(x, y, rad, [6, 6, 8], 0, 0.0005, 24);
  Pn.annulus(x, y, 0.0172 * q, rad, T.chrome, 0.06 + hand * 0.5, 0.0012, 24);
  K.rod(Pn.pt(x, y, 0.001), Pn.pt(x, y, depth), 0.0158 * q, 'dash', 0.35, T.piano, 0, 24);
  const Kc = K.panel(Pn.pt(x, y, depth), W.u, W.v, 'dash', 0.3);
  Kc.annulus(0, 0, 0.0118 * q, 0.0146 * q, glow > 0.02 ? rgb : rgb.map((cc) => cc * 0.18), lit ? glow * 0.95 + 0.05 : 0, 0.0006, 24);
  // In Orbitron, the readouts' face: bold and geometric, so it holds its shape at a few millimetres.
  fancyText(Kc, name, 0, 0, Math.max(0.0042, 0.0052 * q), [236, 232, 244], panel ? 0.7 : 0.4, 0.0009, F_NUM, 0.0196 * q);
  if (flash > 0.02) Pn.annulus(x, y, rad * 1.05, rad * 1.22, HALO, flash, 0.004, 24);
}
function wheelHeat(K, W, heat, hot, lit) {
  const Pn = hubPanel(K, W), bx = DRIVE[2].x, by = DRIVE[2].y, br = DRIVE[2].r;
  Pn.annulus(bx, by, br * 1.08, br * 1.24, [30, 26, 34], 0.05, 0.0013, 24);
  if (heat > 0.01) Pn.annulus(bx, by, br * 1.08, br * 1.24, hot ? T.red : T.amber, lit ? 0.9 : 0.2, 0.0016, Math.max(2, Math.round(24 * heat)), -Math.PI / 2, -Math.PI / 2 - heat * TAU);
}
function wheelPaddle(K, W, i, pull, hov, flash, lit, panel, line) {
  const pd = PADDLES[i], { a, u, v, P } = W;
  const cP = P(pd.x, 0.03, -0.035 + pull * 0.008);
  K.obox(cP, u, v, a, 0.026, 0.055, 0.005, 'dash', 0.1, T.carbon);
  K.obox(add(cP, mul(a, 0.0055)), u, v, a, 0.003, 0.045, 0.0008, 'dash', 0.2, line, lit ? 0.35 + 0.65 * Math.max(pull, hov ? 0.6 : 0) : 0);
  const Pp = K.panel(add(cP, mul(a, 0.006)), u, v, 'dash', 0.1);
  Pp.fitText(pd.name, pd.x > 0 ? -0.012 : 0.012, 0.03, 0.014, 0.014, [226, 222, 236], panel ? 0.6 : 0.3, 0.001);
  if (flash > 0.02) K.obox(add(cP, mul(a, 0.007)), u, v, a, 0.028, 0.057, 0.0006, 'dash', 0.2, HALO, flash);
}

// ── THE FAN PAGE: the Merlin from above, its four ducts and the pusher turning, each ringed at its speed ──
function fanPage(Pn, R, sc) {
  const s = 0.075, P2 = (f, g) => [g * s, -0.004 + f * s];
  // The body, in outline: a wedge.
  const outline = [[0.8, 0], [0.6, 0.21], [-0.3, 0.24], [-0.8, 0.18], [-0.8, -0.18], [-0.3, -0.24], [0.6, -0.21]];
  for (let i = 0; i < outline.length; i++) {
    const [fa, ga] = outline[i], [fb, gb] = outline[(i + 1) % outline.length], A = P2(fa, ga), B = P2(fb, gb);
    const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    Pn.spoke(A[0], A[1], ang, 0, Math.hypot(B[0] - A[0], B[1] - A[1]), 0.0015, [120, 112, 180], 0.6, 0.003);
  }
  const on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  const ducts = [...MERLIN_DUCTS.at, ...MERLIN_DUCTS.at.map(([f, g]) => [f, -g])];
  ducts.forEach(([f, g], i) => {
    const [cu, cv] = P2(f, g), rr = MERLIN_DUCTS.rOut * s;
    Pn.annulus(cu, cv, rr - 0.002, rr + 0.001, [40, 36, 60], 0.3, 0.003, 20);
    if (frac > 0.01) Pn.annulus(cu, cv, rr - 0.002, rr + 0.001, frac > 0.85 ? T.glow : T.amber, 0.95, 0.0035, Math.max(2, Math.round(20 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
    for (let b = 0; b < 3; b++) {
      const t = (on ? R.phase * 2.6 * (i % 2 ? -1 : 1) : 0) + b * TAU / 3 + i;
      Pn.spoke(cu, cv, t, 0.001, rr - 0.003, 0.0012, [220, 214, 255], 0.9, 0.004);
    }
  });
  fancyText(Pn, 'FANS', -sc.w + 0.008, 0.05, 0.0095, [190, 184, 240], 0.6, 0.003, F_TITLE, sc.w * 0.7, 'l');
  fancyText(Pn, String(Math.round(R.rpm * 100)) + ' PCT', sc.w - 0.008, -0.054, 0.0095, [226, 222, 236], 0.7, 0.003, F_NUM, sc.w * 0.8, 'r');
}

// ── THE ENERGY PAGE: the charge left, and the draw ──
function energyPage(Pn, R, sc) {
  const soc = R.fuel;
  fancyText(Pn, 'CHG', -sc.w + 0.007, 0.05, 0.0095, [190, 184, 240], 0.6, 0.003, F_TITLE, sc.w * 0.9, 'l');
  fancyDigits(Pn, -0.03, 0.022, 0.02, String(Math.round(soc * 100)).padStart(3, ' '), soc < 0.15 ? T.red : T.glow);
  for (let i = 0; i < 8; i++) {
    const u = -0.075 + i * 0.019, f = clamp(soc * 8 - i, 0, 1);
    Pn.rect(u, -0.015, u + 0.015, 0.012, [24, 22, 34], 0.3, 0.002);
    if (f > 0.02) Pn.rect(u + 0.002, -0.013, u + 0.013, -0.013 + 0.023 * f, soc < 0.15 ? T.red : soc < 0.3 ? T.amber : T.glow, 0.95, 0.003);
  }
  const kw = R.powered ? Math.round(lerp(6, 320, clamp(R.thr * R.rpm, 0, 1))) : 0;
  fancyText(Pn, 'KW', -sc.w + 0.007, -0.04, 0.0095, [190, 184, 240], 0.6, 0.003, F_TITLE, sc.w * 0.6, 'l');
  fancyDigits(Pn, 0.0, -0.052, 0.016, String(kw).padStart(3, ' '), kw > 260 ? T.amber : T.glow);
}

// ── THE MAP: the kit's moving map, the screen you click for the GPS ──
function mapPage(Pn, R, live, sc) {
  panelGps(Pn, 0, 0, sc.w - 0.005, SCREEN_H - 0.006, live, { label: false, bezel: [10, 8, 18] });
  fancyText(Pn, 'NAV', -sc.w + 0.008, 0.05, 0.0095, [190, 184, 240], 0.6, 0.009, F_TITLE, sc.w * 0.5, 'l');
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) fancyDigits(Pn, 0.05, 0.042, 0.013, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), T.glow);
  fancyDigits(Pn, -0.02, -0.06, 0.011, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), [226, 222, 236]);
}
