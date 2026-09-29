// THE SHRIKE'S COCKPIT: a Junkers Ju 87 glasshouse, the pilot up front, the gunner behind him
// facing the other way.
//
// Built to the Drake's standard: the ROOM is measured off the exterior (FW_ROWS.divebomber, the
// `canopy` block and the fuselage ring buildFixedWing lofts), the glass is the exterior's own
// glass cut open, and every control that has a live value moves with it.
//
// ── WHAT MAKES IT A STUKA ────────────────────────────────────────────────────
//   · one long framed canopy, every frame on a real seam of the exterior glass (seven bays, six
//     rails), so from the seat the cage you look through is the cage the outside draws;
//   · red dive lines on the starboard quarter pane, a protractor fan at 60, 75 and 80 degrees: you
//     hold the dive by laying the horizon along one of them;
//   · a Revi reflector sight on the coaming, lit when the master is on;
//   · the contact altimeter's lamp (Kontakthöhenmesser) on the panel: it lights at the release
//     height in a steep dive, which is when you press the bomb button on the stick;
//   · a window in the floor between your feet (Bombenzielfenster) so you can find the target
//     before you roll in; it was usually filmed with oil, and here it is merely tinted;
//   · the dive brake lever, red, on the left of the panel, beside the throttle quadrant;
//   · a head armour plate behind you, and beyond it the gunner, facing aft on a strap seat, with
//     the twin MG 81Z in the lens mount at the back of the glasshouse and his radio on the wall.
//
// Sources read (2026-09-24):
//   https://en.wikipedia.org/wiki/Junkers_Ju_87 — dive lines at 60/75/80°, Revi C/12, contact
//     altimeter lamp at the ~450 m release point, automatic dive brakes, floor window, rear gunner
//   https://warhistory.org/article/stuka-in-flight — red lines on the side canopy panels, gunner
//     on a flexible rear mount
//   https://simpleflying.com/stuka-dive-bomber-incredible-features-list/ (search digest) — the
//     floor window between the pilot's feet; the angle lines in the right-hand side glazing
//   https://asisbiz.com/il2/Ju-87/Ju-87D/pages/Junkers-Ju-87D-Stuka-cockpit-section-center-instrument-panel-01.html
//     — panel photograph (the page text names nothing; the layout below is from the picture:
//     flight group left, horizon centre, engine group right, lamps and switches along the foot)
//
// ── ⚠ ONE SCALE, STATED ONCE ─────────────────────────────────────────────────
//
// A Ju 87 B is 11.0 m long. The exterior runs from noseF to tailF (1.06 to −1.00, 2.06 units), so
// M_PER_UNIT = 11.0 / 2.06 = 5.34 m a unit. Everything about the AEROPLANE (where the canopy is,
// how wide the sill is, where the floor meets the wall) goes through it; everything about a PERSON
// (a seat, a stick, a dial) is authored in honest metres. Checks: the canopy comes out 0.81 m wide
// at its widest and 3.8 m long, the fuselage 1.05 m wide — all within a few per cent of the type.
//
// ── ⚠ THE EXTERIOR IS COARSE, AND THIS SAYS WHERE ────────────────────────────
//
// The canopy is five facets round and seven bays long, and it sits ON the crown with its base a
// little wider than the fuselage at that height (the model's own overhang). So the sill here is a
// ledge from the inner skin out to the canopy base, which is the honest inside of that shape. The
// panel, the seats and the controls have nothing on the outside to measure and are metres.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, facingPanel } from './interior-cockpit-kit.js';
import { readings } from './interior-fit-craft.js';
import { FW_ROWS } from './vehicle-models.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

// ── THE SCALE AND THE SEAT ───────────────────────────────────────────────────
export const SHRIKE_LEN_M = 11.0;        // Ju 87 B overall length
// Where the pilot is along the canopy, as the canopy art's own crew table puts him (u 0.26 of the
// glass, windscreen to rear), so the helmet painted on the outside is the head you are in.
const PILOT_U = 0.26, GUNNER_U = 0.80;
// How far the eye is over the canopy sill. A person: a Ju 87 pilot sat with his eyes a hand's
// breadth over the cockpit rim, low enough that the windscreen's top rail is just above the line.
const EYE_OVER_SILL = 0.20;
const WALL = 0.035;                       // skin, stringers and lining, in metres

// ── THE STYLE ────────────────────────────────────────────────────────────────
// RLM 66 Schwarzgrau for everything the pilot sees, RLM 02 in the gunner's end, black for the panel.
const T = {
  rlm66: [56, 58, 60], rlm66Dk: [42, 44, 46], rlm66Lt: [74, 77, 80],
  rlm02: [104, 106, 88], rlm02Dk: [82, 84, 70],
  panel: [46, 48, 51], panelEdge: [62, 65, 68], placard: [210, 204, 184],
  leather: [70, 48, 32], leatherDk: [50, 34, 22], webbing: [150, 136, 96], buckle: [168, 170, 172],
  armour: [66, 70, 66], canopyFrame: [72, 76, 74], rubber: [22, 22, 24],
  redHandle: [190, 32, 26], yellow: [214, 176, 36], lumin: [206, 236, 196],
  gun: [34, 36, 38], brass: [168, 132, 64], radio: [84, 88, 80],
};
// Surface texture, by colour identity (interior-kit.js TEXTURE). Painted metal everywhere the RLM
// paint is, cast for the bare armour and gun steel, leather and canvas where a body touches, rubber
// on the grips. Nothing lit, glass or a dial face is registered.
for (const k of ['rlm66', 'rlm66Dk', 'rlm66Lt', 'rlm02', 'rlm02Dk', 'panel', 'panelEdge', 'canopyFrame', 'radio', 'redHandle', 'yellow']) TEXTURE.set(T[k], 'paint');
for (const k of ['armour', 'gun']) TEXTURE.set(T[k], 'cast');
TEXTURE.set(T.leather, 'leather'); TEXTURE.set(T.leatherDk, 'leather');
TEXTURE.set(T.webbing, 'fabric'); TEXTURE.set(T.rubber, 'rubber'); TEXTURE.set(T.buckle, 'brushed');
SHINY.set(T.gun, { spec: 0.5, pow: 30 });
SHINY.set(T.buckle, { spec: 0.8, pow: 26 });
SHINY.set(T.armour, { spec: 0.25, pow: 14 });
// Glass you look through: the floor window (oil-tinted), the Revi's reflector, the lens mount's ring.
const FLOOR_GLASS = [60, 70, 56];
const REVI_GLASS = [150, 200, 190];
PANE.set(FLOOR_GLASS, 0.42); PANE.set(REVI_GLASS, 0.22);
// Contact shadows, see-through black.
const SHADE = [0, 0, 2]; PANE.set(SHADE, 0.2);
// The dive lines are paint on the glass: opaque red, thin.
const DIVE_RED = [210, 30, 24];

// ── THE EXTERIOR, READ BACK ──────────────────────────────────────────────────
//
// These are buildFixedWing's own section formulas (aircraft3d.js: czAt, radAt, ring, the canopy's
// crown/prof/ringAt), evaluated at any station rather than only at the mesh's rings. ⚠ They are the
// SAME expressions, not a second opinion: scripts/shapes/cockpit-shrike.mjs builds the real mesh
// and checks that the exterior's glass vertices land on this room's frames.
function exterior(p) {
  const tube = p.bodyTube || 0, noseK = p.noseBlunt || 2.4, cowl = p.noseCowl || 0;
  const czAt = (f) => {
    if (f < 0) return (p.tailUp ?? 0.05) * (f / p.tailF);
    const u = Math.min(1, f / p.noseF), t = tube ? Math.max(0, (u - tube) / (1 - tube)) : u;
    return (p.noseZ ?? 0.02) * Math.pow(t, p.noseDroopK ?? 1);
  };
  const radAt = (f) => {
    let u = Math.min(1, Math.abs(f >= 0 ? f / p.noseF : f / p.tailF));
    u = u <= tube ? 0 : (u - tube) / (1 - tube);
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  const e = 1 - (p.boxy || 0) * 0.55;
  // A point on the fuselage ring at station f and angle a (0 starboard, π/2 crown).
  const ring = (f, a) => {
    const ca = Math.cos(a), sa = Math.sin(a), rW = radAt(f);
    return [f, Math.sign(ca) * Math.pow(Math.abs(ca), e) * p.fr * rW, czAt(f) + Math.sign(sa) * Math.pow(Math.abs(sa), e) * p.fv * rW];
  };
  const cp = p.canopy, segs = cp.segs || 5, arc = cp.arc || 3;
  const crown = (f) => czAt(f) + p.fv * radAt(f) - (cp.sink ?? 0.015);
  const prof = (t) => Math.sin(Math.PI * ((cp.front ?? 0.12) + (1 - (cp.front ?? 0.12) - (cp.tail ?? 0.04)) * t));
  const fOf = (t) => cp.f0 + (cp.f1 - cp.f0) * t;
  // The exterior canopy's own vertex (bay i of segs, facet corner k of arc).
  const glassV = (i, k) => {
    const t = i / segs, f = fOf(t), s = prof(t), a = Math.PI * k / arc;
    return [f, Math.cos(a) * cp.w * s, crown(f) + Math.sin(a) * cp.h * s];
  };
  // Any point on the faceted glass: u in [0, segs], v in [0, arc], bilinear on the facet it is in.
  const glassAt = (u, v) => {
    const i = Math.min(segs - 1, Math.floor(u)), k = Math.min(arc - 1, Math.floor(v)), du = u - i, dv = v - k;
    const A = glassV(i, k), B = glassV(i + 1, k), Cc = glassV(i + 1, k + 1), D = glassV(i, k + 1);
    const lo = A.map((x, j) => lerp(x, B[j], du)), hi = D.map((x, j) => lerp(x, Cc[j], du));
    return lo.map((x, j) => lerp(x, hi[j], dv));
  };
  return { czAt, radAt, ring, crown, prof, fOf, glassV, glassAt, segs, arc, cp };
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function shrikeProfile(row = FW_ROWS.divebomber) {
  const p = row && (row.params || row);
  if (!p || !p.canopy) return null;
  const E = exterior(p);
  const m = SHRIKE_LEN_M / (p.noseF - p.tailF);
  const fE = E.fOf(PILOT_U), gE = 0, hE = E.crown(fE) + EYE_OVER_SILL / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const S = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const Finv = (y) => fE + y / m, Hinv = (z) => hE + z / m;
  const G = { E, m, fE, hE, X, Y, Z, S, Finv, Hinv };

  const room = buildRoom(G);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  // ⚠ THE BOUNDS ARE THE ROOM AND THE GLASS OVER IT: the canopy is holes, so the faces alone stop at
  // the sill and would put the eye above its own roof. The exterior glass is the true lid.
  const glassPts = [];
  for (let i = 0; i <= E.segs; i++) for (let k = 0; k <= E.arc; k++) glassPts.push(S(E.glassV(i, k)));
  for (const q of [...room.faces.flatMap((f) => f.p), ...glassPts]) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const halfW = Math.max(-x0, x1) + 1e-6;
  const P = {
    label: 'dive bomber glasshouse (Ju 87)',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    // ── measured off the exterior ──
    // The side-window aim: the bay just forward of the eye, under the lower rail — see the gate.
    winY: [0.10, 0.30], winZ: [-0.14, -0.04],
    sillZ: room.sillZ, floorZ: room.floorZ,
    // ── a person, in metres ──
    dashY: 0.60, dashZ: -0.24, headerZ: room.headerZ, pillarW: 0.02,
    seatZ: -0.72, seatHalf: 0.20, seatY: [-0.36, 0.06], backZ: -0.06,
    seats: 1, centrePost: 0,
    roofGlass: [room.back, room.front],
    normalLit: true,
    // Two UV lamps each side of the panel hood and one on the right console, like the real set.
    floods: [{ p: [-0.19, 0.50, -0.27], r: 0.36 }, { p: [0.19, 0.50, -0.27], r: 0.36 }, { p: [0.36, 0.05, -0.36], r: 0.26 }],
    room: shrikeShell,
    shrike: { ...G, faces: room.faces, room },
    hotspots(live) { return shrikeHotspots(this, live); },
  };
  P.shrike.static = buildStatic(P);
  P.glass = buildGlass(G);
  return P;
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
//
// One pane per exterior glass facet: 7 bays x 5 facets of the greenhouse, and the two end caps
// fanned from their middles exactly as buildFixedWing caps them (5 triangles each; the front fan is
// the armoured windscreen). Each pane sits 3 mm inside the exterior skin, which is outboard of every
// frame (those are set in by their radius plus 3 mm), so the cage reads in front of the glass.
// ⚠ NOT IN shellFaces: the renderer draws these as film after the room, and every sight-line gate
// keeps casting through open apertures.
function buildGlass(G) {
  const { E, m, S } = G;
  const IN = 0.003 / m;
  const inTo = (q) => { const c = [q[0], 0, E.crown(q[0])]; return add(q, mul(norm(sub(c, q)), IN)); };
  const endIn = (q, i) => (i === 0 ? [q[0] - IN, q[1], q[2]] : i === E.segs ? [q[0] + IN, q[1], q[2]] : q);
  const V = (i, k) => S(endIn(inTo(E.glassV(i, k)), i));
  const panes = [];
  for (let i = 0; i < E.segs; i++) for (let k = 0; k < E.arc; k++) panes.push([V(i, k), V(i, k + 1), V(i + 1, k + 1), V(i + 1, k)]);
  for (const i of [0, E.segs]) {
    const ring = Array.from({ length: E.arc + 1 }, (_, k) => V(i, k));
    const c = mul(ring.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / ring.length);
    for (let k = 0; k < E.arc; k++) panes.push([c, ring[k], ring[k + 1]]);
  }
  return panes;
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
//
// Lower walls (the fuselage skin, inset), the sill ledge out to the canopy base, the coaming, the
// floor with its window, both end caps below the glass, and the canopy's frames on every seam.
// Everything above the sill is glass and so is NOTHING: see "THE WINDSCREEN IS THE ABSENCE OF
// GEOMETRY" in interior-shell.js.
function buildRoom(G) {
  const { E, m, S, Y, Z, Finv, Hinv } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n: norm(n), tone, k, rgb, emis });
  const tri = (a, b, c, inside, tone, k, rgb) => {
    let n = norm(cross(sub(b, a), sub(c, a)));
    const cen = mul(add(add(a, b), c), 1 / 3);
    if (dot(n, sub(inside, cen)) < 0) n = mul(n, -1);
    put([a, b, c], n, tone, k, rgb);
  };
  const fF = E.cp.f0, fB = E.cp.f1;
  const wallU = WALL / m;
  const floorZ = -1.08;
  const hFloor = Hinv(floorZ);
  // The inner skin at (f, a): pushed WALL in toward the section's middle.
  const inner = (f, a) => {
    const q = E.ring(f, a), c = [f, 0, E.czAt(f)];
    const d = norm(sub(c, q));
    return add(q, mul(d, wallU));
  };
  // The ring angle (starboard half) at which the inner skin reaches height h — a bisection.
  const angAt = (f, h) => {
    let lo = -Math.PI / 2, hi = Math.PI / 2;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (inner(f, mid)[2] < h) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  G.wallAt = (y, z) => S(inner(Finv(y), angAt(Finv(y), Hinv(z))))[0];   // starboard wall x at (y, z)

  const NF = 28, NV = 6;
  const fAt = (i) => lerp(fF, fB, i / NF);
  const sec = (f) => {
    // One section's starboard wall from the floor to the sill, then the canopy base.
    const aF = angAt(f, hFloor), sillH = E.crown(f), aS = angAt(f, sillH);
    const pts = [];
    for (let j = 0; j <= NV; j++) pts.push(inner(f, lerp(aF, aS, j / NV)));
    const t = (f - E.cp.f0) / (E.cp.f1 - E.cp.f0), base = [f, E.cp.w * E.prof(t), sillH];
    return { pts, base };
  };
  const sections = Array.from({ length: NF + 1 }, (_, i) => sec(fAt(i)));
  const mirror = (q) => [q[0], -q[1], q[2]];
  // Walls, both sides; the aft third (the gunner's end) in RLM 02.
  for (let i = 0; i < NF; i++) {
    const A = sections[i], B = sections[i + 1], aft = fAt(i) < E.fOf(0.62);
    for (const s of [1, -1]) {
      const M = s > 0 ? (q) => q : mirror;
      for (let j = 0; j < NV; j++) {
        const q = [A.pts[j], B.pts[j], B.pts[j + 1], A.pts[j + 1]].map((v) => S(M(v)));
        const c = S([(A.pts[j][0] + B.pts[j][0]) / 2, 0, E.czAt(A.pts[j][0])]);
        let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
        const cen = mul(q.reduce((a, b) => add(a, b), [0, 0, 0]), 0.25);
        if (dot(n, sub(c, cen)) < 0) n = mul(n, -1);
        const even = (i + j) & 1;
        put(q, n, 'pil', even ? -0.08 : -0.14, aft ? (even ? T.rlm02 : T.rlm02Dk) : (even ? T.rlm66 : T.rlm66Dk));
      }
      // The sill ledge: from the top of the wall out to the canopy base, facing up.
      const q = [A.pts[NV], B.pts[NV], B.base, A.base].map((v) => S(M(v)));
      put(q, [0, 0, 1], 'pil', 0.12, T.rlm66Lt);
    }
  }
  // Fuselage frames: a rib round the inner wall at each canopy seam, the aeroplane's own frames.
  const ribs = [];
  for (let i = 1; i < E.segs; i++) {
    const f = E.fOf(i / E.segs), sc = sec(f);
    ribs.push(sc.pts.map((q) => S(add(q, [0, 0, 0]))));
  }

  // The floor: flat, between the walls, with the bomb-aiming window cut out between the feet.
  const WIN = { x: 0.13, y0: 0.36, y1: 0.62 };
  for (let i = 0; i < NF; i++) {
    const a = S(sections[i].pts[0]), b = S(sections[i + 1].pts[0]);
    const ya = a[1], yb = b[1], xa = a[0] + 0.01, xb = b[0] + 0.01;
    const strip = (xl0, xr0, xl1, xr1, y0, y1) => put([[xl0, y0, floorZ], [xr0, y0, floorZ], [xr1, y1, floorZ], [xl1, y1, floorZ]],
      [0, 0, 1], 'floor', -0.25, i & 1 ? T.rlm66Dk : [48, 50, 52]);
    // y decreases with i (front to back); the window is inside one or two strips.
    const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
    if (hi <= WIN.y0 || lo >= WIN.y1) { strip(-xa, xa, -xb, xb, ya, yb); continue; }
    // Split the strip at the window's fore and aft edges, and around it where it overlaps.
    const xAt = (y) => lerp(xa, xb, (y - ya) / (yb - ya));
    const cuts = [ya, ...[WIN.y1, WIN.y0].filter((y) => y < hi && y > lo), yb];
    for (let c = 0; c < cuts.length - 1; c++) {
      const u0 = cuts[c], u1 = cuts[c + 1], mid = (u0 + u1) / 2;
      if (mid > WIN.y0 && mid < WIN.y1) {
        strip(-xAt(u0), -WIN.x, -xAt(u1), -WIN.x, u0, u1);
        strip(WIN.x, xAt(u0), WIN.x, xAt(u1), u0, u1);
      } else strip(-xAt(u0), xAt(u0), -xAt(u1), xAt(u1), u0, u1);
    }
  }
  // The window itself: a frame and a pane of glass you can see the ground through.
  const wz = floorZ - 0.02;
  put([[-WIN.x, WIN.y0, wz], [WIN.x, WIN.y0, wz], [WIN.x, WIN.y1, wz], [-WIN.x, WIN.y1, wz]], [0, 0, 1], 'floor', 0, FLOOR_GLASS, 0);
  for (const [x0, y0, x1, y1] of [[-WIN.x, WIN.y0, WIN.x, WIN.y0], [WIN.x, WIN.y0, WIN.x, WIN.y1], [WIN.x, WIN.y1, -WIN.x, WIN.y1], [-WIN.x, WIN.y1, -WIN.x, WIN.y0]]) {
    const d = norm([x1 - x0, y1 - y0, 0]), nIn = [-d[1], d[0], 0];
    put([[x0, y0, floorZ], [x1, y1, floorZ], [x1, y1, wz], [x0, y0, wz]], nIn, 'floor', -0.3, T.rlm66Dk);
  }

  // The coaming: from the panel forward to the windscreen, across at the canopy base.
  const fPanel = Finv(0.60);
  for (let i = 0; i < 3; i++) {
    const f0 = lerp(fF, fPanel, i / 3), f1 = lerp(fF, fPanel, (i + 1) / 3);
    const b0 = sec(f0).base, b1 = sec(f1).base;
    put([S(b0), S(mirror(b0)), S(mirror(b1)), S(b1)], [0, 0, 1], 'dash', 0.05, [34, 36, 38]);
  }

  // The end caps below the glass: a fan from the section's middle, so the concave corner where the
  // ledge meets the wall is triangulated honestly.
  const cap = (f, sc, rgb, k) => {
    const rim = [...sc.pts, sc.base, mirror(sc.base), ...sc.pts.slice().reverse().map(mirror)].map(S);
    const c = mul(rim.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / rim.length);
    const inside = add(c, [0, f === fF ? -1 : 1, 0]);
    for (let j = 0; j < rim.length - 1; j++) tri(c, rim[j], rim[j + 1], inside, 'post', k, rgb);
    tri(c, rim[rim.length - 1], rim[0], inside, 'post', k, rgb);
  };
  cap(fF, sections[0], T.rlm66Dk, -0.2);
  cap(fB, sections[NF], T.rlm02Dk, -0.15);

  // The canopy frames, on every seam of the exterior glass, set in by their own radius.
  const frames = [];
  const inTo = (q, d) => {
    const f = q[0], c = [f, 0, E.crown(f)];
    return add(q, mul(norm(sub(c, q)), d / m));
  };
  // The end hoops stand in from the end planes by their own radius, so no rod pokes out of the room.
  const endIn = (q, i, r) => (i === 0 ? [q[0] - (r + 0.002) / m, q[1], q[2]] : i === E.segs ? [q[0] + (r + 0.002) / m, q[1], q[2]] : q);
  for (let i = 0; i <= E.segs; i++) {
    // ⚠ HEAVY, LIKE THE REAL CAGE (Ju 87 frames are 4-6 cm bars) — except the windscreen's own top
    // rail, which the straight-ahead sight line passes a hand's breadth under and must not touch.
    const r = i === 0 ? 0.017 : i === E.segs ? 0.026 : 0.021;
    const pts = [];
    for (let k = 0; k <= E.arc; k++) pts.push(S(endIn(inTo(E.glassV(i, k), r + 0.003), i, r)));
    frames.push({ pts, r, kind: 'hoop' });
  }
  for (let k = 0; k <= E.arc; k++) {
    const r = (k === 0 || k === E.arc) ? 0.020 : (k === 1 || k === E.arc - 1) ? 0.015 : 0.010;
    const pts = [];
    for (let i = 0; i <= E.segs; i++) pts.push(S(endIn(inTo(E.glassV(i, k), r + 0.003), i, 0.016)));
    frames.push({ pts, r, kind: 'rail' });
  }
  // The dive lines: a protractor fan on the starboard quarter pane (bay 0-1, facet 0-1), painted on
  // the glass. Origin at the pane's aft-lower corner; the lines rise FORWARD at 60, 75 and 80°
  // against the sill, which is the horizon when the nose is down by that much.
  const pane = (u, v) => S(inTo(E.glassAt(u, v), 0.006));
  const o = pane(0.95, 0.08), fwdE = norm(sub(pane(0.05, 0.08), o)), upE0 = sub(pane(0.95, 0.92), o);
  const upE = norm(sub(upE0, mul(fwdE, dot(upE0, fwdE))));
  const len = Math.hypot(...upE0) * 0.95;
  const diveLines = [60, 75, 80].map((deg) => {
    const t = deg * Math.PI / 180;
    return [o, add(o, mul(add(mul(fwdE, Math.cos(t)), mul(upE, Math.sin(t))), len))];
  });

  const sillZ = S(sec(E.fOf(PILOT_U)).base)[2];
  const headerZ = S(E.glassV(0, 2))[2];
  return { faces, frames, ribs, diveLines, sections: sections.map((sc) => sc.pts.map(S)), sillZ, floorZ, headerZ, WIN, back: S(sections[NF].base)[1], front: S(sections[0].base)[1] };
}

// ── THE STATIC FIT-OUT, BUILT ONCE ───────────────────────────────────────────
//
// Anything that never moves — frames, ribs, seats, armour, the gunner's end, consoles, the panel's
// board and bezels — is built here into a list and replayed each frame. Only the needles, levers,
// the stick, the pedals, the wheels and the lamps are rebuilt.
function buildStatic(P) {
  const list = [];
  const push = (fs, tone, k, fwd, rgb, emis, mat) => list.push([fs, tone, k, fwd, rgb, emis, mat]);
  const K = makeKit(push);
  const R = P.shrike.room, G = P.shrike;

  // Frames and ribs.
  for (const fr of R.frames) for (let j = 0; j < fr.pts.length - 1; j++) K.rod(fr.pts[j], fr.pts[j + 1], fr.r, 'pil', 0.22, T.canopyFrame, 0, 6, false);
  for (const rb of R.ribs) for (let j = 0; j < rb.length - 1; j++) {
    for (const s of [1, -1]) {
      const a = [s * (rb[j][0] - 0.016), rb[j][1], rb[j][2]], b = [s * (rb[j + 1][0] - 0.016), rb[j + 1][1], rb[j + 1][2]];
      K.rod(a, b, 0.012, 'pil', 0.02, T.rlm66Lt, 0, 4, false);
    }
  }
  for (const [a, b] of R.diveLines) K.rod(a, b, 0.0022, 'pil', 0, DIVE_RED, 0.25, 4, false);
  // Stringers: the longitudinal members the skin is riveted to, standing off the lining.
  for (let j = 1; j < R.sections[0].length - 1; j++) {
    for (let i = 0; i < R.sections.length - 1; i++) {
      for (const s of [1, -1]) {
        const a = R.sections[i][j], b = R.sections[i + 1][j];
        const ya = i === 0 ? a[1] - 0.012 : a[1], yb = i === R.sections.length - 2 ? b[1] + 0.012 : b[1];
        K.rod([s * (a[0] - 0.012), ya, a[2]], [s * (b[0] - 0.012), yb, b[2]], 0.007, 'pil', 0.05, T.rlm66Lt, 0, 4, false);
      }
    }
  }
  // Floor ribs across the pan, fore and aft of the window.
  for (let y = R.front - 0.30; y > R.back + 0.1; y -= 0.22) {
    if (y > R.WIN.y0 - 0.03 && y < R.WIN.y1 + 0.03) continue;
    const w = G.wallAt(y, R.floorZ + 0.01) - 0.02;
    K.box(-w, y - 0.012, R.floorZ, w, y + 0.012, R.floorZ + 0.018, 'floor', -0.1, T.rlm66Lt);
  }
  // The left wall's plumbing: oxygen, hydraulic and fuel-pressure lines, clipped to the stringers.
  for (const [dz, rr, rgb] of [[-0.52, 0.009, [60, 90, 150]], [-0.56, 0.007, [40, 42, 44]], [-0.60, 0.007, [150, 110, 40]]]) {
    const pts = [];
    for (let y = 0.56; y >= -0.40; y -= 0.12) pts.push([-G.wallAt(y, dz) + 0.03, y, dz]);
    for (let i = 0; i < pts.length - 1; i++) K.rod(pts[i], pts[i + 1], rr, 'pil', 0.05, rgb, 0, 5, false);
    for (const q of pts) K.box(q[0] - 0.012, q[1] - 0.006, q[2] - 0.014, q[0] + 0.01, q[1] + 0.006, q[2] + 0.014, 'pil', 0.1, T.rlm66Lt);
  }
  // The flare cartridge rack on the right wall, and the map case under it.
  {
    const xw = G.wallAt(-0.10, -0.60) - 0.05;
    K.box(xw - 0.02, -0.25, -0.66, xw + 0.03, 0.05, -0.62, 'pil', 0.0, T.rlm66Dk);
    for (let i = 0; i < 8; i++) K.rod([xw, -0.22 + i * 0.036, -0.62], [xw, -0.22 + i * 0.036, -0.56], 0.013, 'pil', 0.15, i % 3 ? [150, 110, 50] : [180, 40, 36], 0, 8);
    const xm = G.wallAt(-0.10, -0.80) - 0.04;
    K.box(xm - 0.01, -0.30, -0.92, xm + 0.035, 0.10, -0.72, 'pil', -0.05, T.leatherDk);
    K.box(xm - 0.012, -0.28, -0.76, xm, 0.08, -0.74, 'pil', 0.05, T.leather);
  }
  // The canopy's hood rails along the sills, and the opening crank on the starboard one.
  for (const s of [1, -1]) {
    const y0 = 0.40, y1 = -1.00, z = R.sillZ + 0.012;
    K.rod([s * (G.wallAt(y0, R.sillZ - 0.02) + 0.01), y0, z], [s * (G.wallAt(y1, R.sillZ - 0.02) + 0.01), y1, z], 0.010, 'pil', 0.2, C.steel, 0, 6);
  }
  {
    const c = [G.wallAt(-0.15, R.sillZ - 0.02) - 0.02, -0.15, R.sillZ - 0.02];
    K.rod(c, add(c, [-0.03, 0, 0]), 0.010, 'pil', 0.1, C.steel, 0, 6);
    K.rod(add(c, [-0.03, 0, 0]), add(c, [-0.03, 0.06, -0.03]), 0.006, 'pil', 0.1, C.steel, 0, 5);
    K.rod(add(c, [-0.03, 0.06, -0.03]), add(c, [-0.06, 0.06, -0.03]), 0.010, 'pil', 0.1, C.black, 0, 6);
  }

  // The glareshield lip over the panel and the panel board.
  const pz = -0.43, py = P.dashY;
  K.box(-0.20, py - 0.035, P.dashZ - 0.02, 0.20, py + 0.06, P.dashZ + 0.012, 'dash', 0.1, T.rlm66Dk);
  const Pn = K.panel([0, py, pz], [1, 0, 0], [0, -0.22, 1], 'dash', 0.25);
  // ⚠ THE BOARD IS CUT TO THE FUSELAGE, never a rectangle: the section narrows fast toward the crown
  // (0.47 m half-width at the foot of the panel, 0.28 at its top), so a square board puts its top
  // corners through the skin. Strips, each as wide as the wall allows at its own height.
  const halfAt = (b) => { const q = Pn.pt(0, b, 0); return Math.min(0.40, G.wallAt(q[1], q[2]) - 0.015); };
  const NB = 10;
  for (let i = 0; i < NB; i++) {
    const b0 = -0.19 + (0.37 * i) / NB, b1 = -0.19 + (0.37 * (i + 1)) / NB, h0 = halfAt(b0), h1 = halfAt(b1);
    Pn.plate([[-h0, b0], [h0, b0], [h1, b1], [-h1, b1]], T.panel, 0, 0);
  }
  Pn.rect(-halfAt(-0.19), -0.195, halfAt(-0.19), -0.185, T.panelEdge, 0, 0.001);
  for (const b of [0.16, -0.17]) for (const s of [-1, 1]) Pn.disc(s * (halfAt(b) - 0.015), b, 0.006, C.chrome, 0.05, 0.003, 6);
  // Placards under the gauges.
  // A rounded, blacked bezel round every gauge, standing proud of the board.
  for (const g of GAUGES) Pn.torus(g.x, g.z, g.R * 1.10, g.R * 1.30, [34, 35, 37], 0, 0.002, 24, 4);
  for (const g of GAUGES) Pn.rect(g.x - g.R * 0.6, g.z - g.R * 1.42, g.x + g.R * 0.6, g.z - g.R * 1.28, T.placard, 0.08, 0.002);
  // The panel's sub-boards under it: magnetos left, fuel cocks right.
  K.box(-0.40, py - 0.10, -0.66, -0.16, py - 0.02, -0.62, 'dash', 0.05, T.panel);
  K.box(0.16, py - 0.10, -0.66, 0.40, py - 0.02, -0.62, 'dash', 0.05, T.panel);

  // The Revi on the coaming: a body, a lamp housing, a sun filter, the reflector glass.
  const rv = [0.0, 0.74, P.dashZ + 0.01];
  K.box(rv[0] - 0.035, rv[1] - 0.06, rv[2], rv[0] + 0.035, rv[1] + 0.05, rv[2] + 0.075, 'dash', 0.1, [40, 42, 44]);
  K.rod([rv[0], rv[1] - 0.06, rv[2] + 0.04], [rv[0], rv[1] - 0.10, rv[2] + 0.04], 0.02, 'dash', 0.1, [30, 30, 32], 0, 8);
  K.rod([rv[0] + 0.035, rv[1], rv[2] + 0.05], [rv[0] + 0.055, rv[1], rv[2] + 0.05], 0.012, 'dash', 0.1, C.steel, 0, 6);
  contactShadow(K, [rv[0], rv[1], rv[2] + 0.001], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.08);

  // ── THE PILOT'S SEAT, in the round ──
  pilotSeat(K, P);
  // Head armour behind him: a curved plate on the canopy's fixed frame, up past the eye.
  const ay = -0.32;
  for (let i = 0; i < 6; i++) {
    const a0 = -0.24 + i * 0.08, a1 = a0 + 0.08;
    const bow = (x) => 0.03 * (1 - (x / 0.24) ** 2);
    K.face([[a0, ay - bow(a0), -0.34], [a1, ay - bow(a1), -0.34], [a1, ay - bow(a1), 0.19], [a0, ay - bow(a0), 0.19]], [0, 1, 0], 'post', 0.05, T.armour);
    K.face([[a1, ay - 0.012 - bow(a1), -0.34], [a0, ay - 0.012 - bow(a0), -0.34], [a0, ay - 0.012 - bow(a0), 0.19], [a1, ay - 0.012 - bow(a1), 0.19]], [0, -1, 0], 'post', -0.1, T.armour);
  }
  K.box(-0.24, ay - 0.012, 0.19, 0.24, ay, 0.205, 'post', 0.2, T.armour);
  // A padded head rest on its face.
  K.box(-0.09, ay + 0.001, -0.02, 0.09, ay + 0.045, 0.10, 'seat', -0.05, T.leather);

  // ── THE RIGHT CONSOLE: electrics, the FuG 16's remote, the oxygen regulator ──
  const xr = G.wallAt(0.05, -0.40) - 0.10;
  K.box(xr, -0.30, -0.46, xr + 0.10, 0.30, -0.40, 'dash', 0.05, T.rlm66Dk);
  const oxy = facingPanel(K, [xr + 0.04, -0.20, -0.37], 'dash', 0.2);
  oxy.disc(0, 0, 0.035, [40, 42, 38], 0, 0.002, 16);
  oxy.dial(0, 0.004, 0.022, 0.8, { ticks: 6, major: 2, name: 'O2' });
  oxy.rect(-0.03, -0.045, 0.03, -0.03, T.placard, 0.05, 0.002);
  oxy.fitText('OXYGEN', 0, -0.0375, 0.054, 0.009, [30, 28, 24], 0, 0.004);
  // FuG remote box further aft on the wall.
  K.box(xr + 0.01, -0.62, -0.40, xr + 0.10, -0.40, -0.30, 'post', 0.0, T.radio);

  // ── THE LEFT CONSOLE: the throttle quadrant's box, the trim wheel's cheeks ──
  const xl = -G.wallAt(0.0, -0.40) + 0.02;
  K.box(xl, -0.28, -0.48, xl + 0.09, 0.26, -0.41, 'dash', 0.0, T.rlm66Dk);
  // Slot plates for the levers.
  K.box(xl + 0.02, -0.20, -0.409, xl + 0.07, 0.18, -0.405, 'dash', 0.1, [22, 22, 24]);
  // Trim wheel cheek plates.
  K.box(xl + 0.005, -0.52, -0.60, xl + 0.012, -0.30, -0.38, 'dash', 0.0, T.rlm66Lt);

  // ── THE GUNNER'S END ──
  gunnerEnd(K, P);

  // Rudder pedal mounts, the floor channel for the stick.
  K.box(-0.18, 0.66, R.floorZ, 0.18, 0.74, R.floorZ + 0.05, 'floor', -0.1, T.rlm66Dk);
  contactShadow(K, [-0.30, -0.12, R.floorZ + 0.0005], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.30);
  contactShadow(K, [0.30, -0.12, R.floorZ + 0.0005], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.30);
  return list;
}

// The pilot's seat: a pressed-steel bucket with a parachute pack in it, the back up to the
// shoulders, and the four-point harness laid over it. In the round: back, sides, lip.
function pilotSeat(K, P) {
  const y0 = P.seatY[0], y1 = P.seatY[1], sz = P.seatZ, hw = P.seatHalf, fl = P.shrike.room.floorZ;
  const shell = T.rlm66Lt;
  // Bucket: bottom pan, two sides, a front lip, the back.
  K.box(-hw, y0, sz - 0.10, hw, y1, sz - 0.085, 'seat', -0.05, shell);
  for (const s of [-1, 1]) {
    K.face([[s * hw, y0 - 0.02, sz - 0.10], [s * hw, y1, sz - 0.10], [s * hw, y1, sz + 0.02], [s * hw, y0 - 0.02, sz + 0.20]], [-s, 0, 0], 'seat', -0.02, shell);
    K.face([[s * (hw + 0.004), y1, sz - 0.10], [s * (hw + 0.004), y0 - 0.02, sz - 0.10], [s * (hw + 0.004), y0 - 0.02, sz + 0.20], [s * (hw + 0.004), y1, sz + 0.02]], [s, 0, 0], 'seat', -0.18, shell);
  }
  K.rod([-hw, y1, sz + 0.02], [hw, y1, sz + 0.02], 0.008, 'seat', 0.1, shell, 0, 5);
  // Back, raked, with lightening holes' worth of darker ribs.
  const bk0 = [0, y0 - 0.02, sz - 0.08], bk1 = [0, y0 - 0.09, P.backZ];
  const up = norm(sub(bk1, bk0)), right = [1, 0, 0], fwd = norm(cross(up, right));
  const bc = mul(add(bk0, bk1), 0.5), bh = Math.hypot(...sub(bk1, bk0)) / 2;
  K.obox(bc, right, up, fwd, hw, bh, 0.008, 'seat', -0.06, shell);
  for (const x of [-0.1, 0, 0.1]) K.obox(add(bc, mul(fwd, 0.01)), right, up, fwd, 0.006, bh * 0.8, 0.003, 'seat', -0.12, T.rlm66);
  // Legs to the floor, and a contact shadow.
  for (const [x, y] of [[-hw + 0.03, y0 + 0.03], [hw - 0.03, y0 + 0.03], [-hw + 0.03, y1 - 0.03], [hw - 0.03, y1 - 0.03]]) K.rod([x, y, fl], [x, y, sz - 0.10], 0.012, 'seat', -0.1, T.rlm66Dk, 0, 5);
  contactShadow(K, [0, (y0 + y1) / 2, fl + 0.001], [1, 0, 0], [0, 1, 0], [0, 0, 1], hw + 0.05, 0.28);
  // The parachute pack as the cushion, the back cushion, in canvas and leather.
  K.box(-hw + 0.02, y0 + 0.02, sz - 0.085, hw - 0.02, y1 - 0.02, sz, 'seat', 0.05, T.webbing);
  K.box(-hw + 0.03, y0 + 0.04, sz - 0.001, hw - 0.03, y1 - 0.06, sz + 0.004, 'seat', 0.1, T.leatherDk);
  K.obox(add(bc, mul(fwd, 0.035)), right, up, fwd, hw - 0.04, bh * 0.75, 0.025, 'seat', 0.02, T.leather);
  // The harness: two shoulder straps over the top of the back, two lap straps, the buckle.
  const buckle = [0, y1 - 0.14, sz + 0.07];
  for (const s of [-1, 1]) {
    const top = add(bk1, [s * 0.08, 0.015, -0.01]);
    const mid = add(bc, add(mul(fwd, 0.065), [s * 0.07, 0, 0.06]));
    K.rod(top, mid, 0.011, 'seat', 0.05, T.webbing, 0, 4);
    K.rod(mid, add(buckle, [s * 0.02, 0, 0.01]), 0.011, 'seat', 0.05, T.webbing, 0, 4);
    K.rod([s * (hw - 0.01), y0 + 0.03, sz + 0.02], add(buckle, [s * 0.02, 0, 0]), 0.012, 'seat', 0.05, T.webbing, 0, 4);
    K.box(s * 0.07 - 0.012, mid[1] - 0.006, mid[2] - 0.012, s * 0.07 + 0.012, mid[1] + 0.006, mid[2] + 0.012, 'seat', 0.2, T.buckle);
  }
  K.obox(buckle, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.03, 0.03, 0.006, 'seat', 0.25, T.buckle);
}

// The gunner's end: a strap seat facing aft, the lens mount at the back of the glass with the
// twin MG 81Z through it, ammunition, the radio stack on the wall, and his own harness.
function gunnerEnd(K, P) {
  const G = P.shrike, R = G.room, fl = R.floorZ;
  const gy = G.Y(G.E.fOf(GUNNER_U));              // where the canopy art puts his head
  const sz = -0.70, back = P.back;
  // Strap seat: a tube frame and a canvas sling, facing aft (his back to you).
  const sy0 = gy + 0.05, sy1 = gy + 0.35;
  for (const s of [-1, 1]) {
    K.rod([s * 0.18, sy0, fl], [s * 0.18, sy0, sz], 0.012, 'seat', 0, T.rlm02Dk, 0, 5);
    K.rod([s * 0.18, sy1, fl], [s * 0.18, sy1, sz + 0.40], 0.012, 'seat', 0, T.rlm02Dk, 0, 5);
    K.rod([s * 0.18, sy0, sz], [s * 0.18, sy1, sz], 0.012, 'seat', 0, T.rlm02Dk, 0, 5);
  }
  K.box(-0.17, sy0, sz - 0.01, 0.17, sy1, sz + 0.03, 'seat', 0.05, T.webbing);
  K.box(-0.17, sy1 - 0.02, sz + 0.03, 0.17, sy1, sz + 0.38, 'seat', -0.05, T.webbing);
  for (const s of [-1, 1]) K.rod([s * 0.10, sy1 - 0.02, sz + 0.37], [s * 0.08, sy0 + 0.04, sz + 0.04], 0.01, 'seat', 0, T.leatherDk, 0, 4);
  contactShadow(K, [0, (sy0 + sy1) / 2, fl + 0.001], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.22, 0.20);
  // The lens mount (Linsenlafette GSL-K 81): an armoured disc in the rear glazing on a pivot.
  const mc = [0, back + 0.03, 0.0], mr = 0.12;
  const Mn = K.panel(mc, [1, 0, 0], [0, 0, 1], 'post', 0.1);
  Mn.disc(0, 0, mr, T.armour, 0, 0, 20);
  Mn.torus(0, 0, mr * 0.9, mr * 1.05, T.gun, 0, 0.002, 20, 3);
  // The twin MG 81Z: two receivers side by side, the barrels through the mount, a spade grip.
  const gc = [0, back + 0.35, -0.03];
  for (const s of [-1, 1]) {
    K.box(s * 0.03 - 0.018, gc[1] - 0.15, gc[2] - 0.03, s * 0.03 + 0.018, gc[1] + 0.10, gc[2] + 0.03, 'dash', 0.1, T.gun);
    K.rod([s * 0.03, gc[1] - 0.15, gc[2]], [s * 0.03, back + 0.012, mc[2] + 0.004], 0.009, 'dash', 0.15, T.gun, 0, 6);
  }
  K.rod([0, gc[1] + 0.10, gc[2] - 0.02], [0, gc[1] + 0.20, gc[2] - 0.08], 0.012, 'dash', 0.1, T.gun, 0, 6);
  K.box(-0.07, gc[1] + 0.19, gc[2] - 0.10, 0.07, gc[1] + 0.21, gc[2] - 0.07, 'dash', 0.1, T.leatherDk);
  // Ammunition: saddle drums on the gun and spare belt boxes on the floor.
  K.box(-0.12, gc[1] - 0.05, gc[2] - 0.08, -0.05, gc[1] + 0.05, gc[2] + 0.01, 'dash', 0.05, [70, 72, 60]);
  K.box(0.05, gc[1] - 0.05, gc[2] - 0.08, 0.12, gc[1] + 0.05, gc[2] + 0.01, 'dash', 0.05, [70, 72, 60]);
  for (const x of [-0.30, 0.18]) K.box(x, sy1 + 0.10, fl, x + 0.12, sy1 + 0.30, fl + 0.14, 'floor', 0.0, [86, 88, 66]);
  // The radio stack (FuG VII) on the port wall beside him, dials lit when powered (see fit).
  const xw = -G.wallAt(gy + 0.3, -0.40) + 0.02;
  K.box(xw, gy + 0.15, -0.58, xw + 0.16, gy + 0.55, -0.26, 'post', 0.0, T.radio);
  const Rn = K.panel([xw + 0.161, gy + 0.35, -0.42], [0, -1, 0], [0, 0, 1], 'post', 0.05);
  Rn.rect(-0.18, -0.14, 0.18, 0.14, [70, 74, 66], 0, 0.001);
  for (const [a, b, nm] of [[-0.09, 0.06, 'SEND'], [0.09, 0.06, 'RECV']]) Rn.dial(a, b, 0.04, 0.4, { ticks: 8, major: 2, face: [30, 28, 24], name: nm });
  for (let i = 0; i < 4; i++) Rn.knob(-0.12 + i * 0.08, -0.08, 0.012, 0.015, [30, 30, 32]);
  // The rear glasshouse's armour and his ring of spare drums on the starboard wall.
  const xs = G.wallAt(gy + 0.2, -0.40) - 0.12;
  for (let i = 0; i < 3; i++) K.rod([xs + 0.05, gy + 0.05 + i * 0.12, -0.46], [xs + 0.05, gy + 0.05 + i * 0.12, -0.36], 0.05, 'post', 0.05, [70, 72, 60], 0, 10);
}

// ── THE PANEL ────────────────────────────────────────────────────────────────
// In panel coordinates (x across, z up the board). From the photograph: flight group on the left,
// the horizon in the middle, engine group on the right, the dive and bomb group along the foot.
const GAUGES = [
  { id: 'asi', x: -0.27, z: 0.08, R: 0.042 },
  { id: 'alt', x: -0.15, z: 0.08, R: 0.042 },
  { id: 'hor', x: 0.00, z: 0.07, R: 0.052 },
  { id: 'cmp', x: 0.15, z: 0.08, R: 0.042 },
  { id: 'rpm', x: 0.27, z: 0.08, R: 0.042 },
  { id: 'clk', x: -0.33, z: -0.06, R: 0.030 },
  { id: 'trn', x: -0.21, z: -0.05, R: 0.036 },
  { id: 'vsi', x: -0.09, z: -0.06, R: 0.036 },
  { id: 'ata', x: 0.09, z: -0.06, R: 0.036 },
  { id: 'cool', x: 0.21, z: -0.05, R: 0.030 },
  { id: 'oil', x: 0.32, z: -0.05, R: 0.030 },
];
const PANEL_O = [0, 0.60, -0.43], PANEL_R = [1, 0, 0], PANEL_U = [0, -0.22, 1];
// The switch row on the right of the foot: master, landing lamp, nav, dome. Same ids as cockpit.js.
const SWITCHES = [['master', 0.12], ['land', 0.16], ['nav', 0.20], ['dome', 0.24]];
const SW_Z = -0.155;

// Where the levers are — one table read by the drawing and by the hotspots.
function levers(P, live) {
  const G = P.shrike, L = live || {};
  const xl = -G.wallAt(0.0, -0.40) + 0.02;
  const qz = -0.41, piv = (y) => [xl + 0.045, y, qz - 0.05];
  const thr = clamp(num(L.throttle), 0, 1);
  const ang = (v) => (-40 + 80 * clamp(v, 0, 1)) * Math.PI / 180;       // aft 40°, forward 40°
  const tip = (pv, v, len) => add(pv, [0, Math.sin(ang(v)) * len, Math.cos(ang(v)) * len]);
  return {
    xl, piv,
    throttle: { pv: piv(0.05), v: thr, tip: tip(piv(0.05), thr, 0.16) },
    pitch: { pv: piv(-0.08), v: clamp(num(L.rpm, 0.8), 0, 1), tip: tip(piv(-0.08), clamp(num(L.rpm, 0.8), 0, 1), 0.13) },
    trimC: [xl + 0.012, -0.41, -0.49], trimR: 0.085,
    flap: { v: clamp(num(L.flapNotch) / 3, 0, 1) },
    brake: { v: clamp(num(L.diveBrake), 0, 1) },
    stickBase: [0, 0.16, G.room.floorZ + 0.02],
  };
}

// ── EVERYTHING THAT MOVES ────────────────────────────────────────────────────
function shrikeShell(P, live, push, rich) {
  const D = P.shrike;
  for (const f of D.faces) push([{ p: f.p, n: f.n }], f.tone, f.k, false, f.rgb, f.emis || 0);
  if (!rich) return;
  for (const s of D.static) push(...s);
  shrikeFit(P, live, push);
}

export function shrikeFit(P, live, push) {
  const K = makeKit(push);
  const R = readings(live), L = R.L;
  const on = R.powered;
  const hour = num(L.hour, 12);
  const night = hour < 6.5 || hour > 19.5;
  // Luminous paint on every numeral, glowing under the UV floods after dark.
  const tick = night && on ? T.lumin : C.tick;
  const lv = levers(P, live);

  // ── THE PANEL'S INSTRUMENTS ──
  const Pn = K.panel(PANEL_O, PANEL_R, PANEL_U, 'dash', 0.25);
  const g = Object.fromEntries(GAUGES.map((x) => [x.id, x]));
  const dial = (id, frac, o = {}) => Pn.dial(g[id].x, g[id].z, g[id].R, frac, { tick, ...o });
  dial('asi', clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 16, major: 4, arcs: [[0.25, 0.8, C.green], [0.8, 0.9, C.amber]], red: 0.9, name: 'KMH' });
  dial('alt', (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (R.alt % 10000) / 10000, name: 'ALT' });
  Pn.attitude(g.hor.x, g.hor.z, g.hor.R, R.pitch, R.bank);
  Pn.compass(g.cmp.x, g.cmp.z, g.cmp.R, R.hdg);
  dial('rpm', clamp(R.rpm, 0, 1), { ticks: 12, major: 3, arcs: [[0.55, 0.85, C.green]], red: 0.93, name: 'RPM' });
  // The clock, off the game's own hour.
  {
    const c = g.clk, hr = ((hour % 12) + 12) % 12;
    Pn.dial(c.x, c.z, c.R, (hr % 1), { a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, tick, frac2: hr / 12, needle2: C.white, name: 'CLOCK' });
  }
  dial('trn', clamp(0.5 + R.bank / 60, 0, 1), { a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 4, major: 2, needle: C.white, name: 'TURN' });
  dial('vsi', clamp(0.5 + R.vsi / 6000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' });
  // Boost (ATA): the throttle, sagging a little with altitude.
  dial('ata', clamp(0.15 + R.thr * 0.85 - R.alt / 60000, 0, 1), { ticks: 10, major: 2, arcs: [[0.6, 0.85, C.green]], red: 0.92, name: 'ATA' });
  dial('cool', clamp(0.3 + R.rpm * 0.5, 0, 1), { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'COOL' });
  dial('oil', clamp(num(L.oilTemp, 0.5), 0, 1), { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0.3, 0.8, C.green]], name: 'OIL' });
  // The foot row: fuel contents (two tanks), flap and trim position, the dive group.
  Pn.bar(-0.34, -0.17, -0.10, 0.010, R.fuel, R.fuel < 0.15 ? C.red : C.green);
  Pn.bar(-0.31, -0.17, -0.10, 0.010, R.fuel * 0.96, R.fuel < 0.15 ? C.red : C.green);
  // The foot row is too tight for a name under each part, so each group gets one line under it.
  Pn.text('FUEL', -0.325, -0.179, 0.007, tick, 0.35, 0.004);
  Pn.text('FLAP', -0.23, -0.179, 0.007, tick, 0.35, 0.004);
  Pn.text('TRIM', -0.155, -0.179, 0.007, tick, 0.35, 0.004);
  Pn.rect(-0.26, -0.17, -0.20, -0.105, C.face, 0, 0.002);
  Pn.spoke(-0.23, -0.16, Math.PI / 2 - lv.flap.v * 1.2, 0, 0.05, 0.0025, C.lampOn, 0.8, 0.005);
  Pn.rect(-0.18, -0.17, -0.13, -0.105, C.face, 0, 0.002);
  Pn.rect(-0.1575, -0.138 + clamp(num(L.trim), -1, 1) * 0.025, -0.1525, -0.132 + clamp(num(L.trim), -1, 1) * 0.025, C.amber, 0.8, 0.005);
  // The contact altimeter's lamp: lit at the release height in a steep dive.
  const release = on && R.vsi < -2500 && R.alt < 2000;
  Pn.lamp(-0.06, -0.14, 0.014, 0.014, release, C.red, 'REL');
  // Bombs on the racks, one lamp each (live.bombs; four when nothing says otherwise).
  const bombs = clamp(Math.round(num(L.bombs, 4)), 0, 4);
  for (let i = 0; i < 4; i++) Pn.lamp(-0.02 + i * 0.026, -0.14, 0.009, 0.009, on && i < bombs, C.amber);
  Pn.fitText('BOMBS', 0.019, -0.158, 0.04, 0.006, tick, 0.35, 0.004);
  // Weapons armed (live.weaponsArmed): the Zünder-Schalter lamp beside the bomb row.
  Pn.lamp(0.085, -0.165, 0.007, 0.007, on && !!L.weaponsArmed, C.green, 'ARM');
  // STALL and BINGO are stacked, so their names go to the left.
  Pn.lamp(0.10, -0.12, 0.008, 0.008, on && !!L.stall, C.red);
  Pn.fitText('STALL', 0.078, -0.12, 0.024, 0.006, tick, 0.35, 0.004);
  Pn.lamp(0.10, -0.15, 0.008, 0.008, on && !!L.bingo, C.amber);
  Pn.fitText('BINGO', 0.078, -0.15, 0.024, 0.006, tick, 0.35, 0.004);
  // The siren switch, guarded, and the switch row.
  Pn.toggle(0.06, -0.165, !!L.siren);
  Pn.fitText('SIREN', 0.06, -0.186, 0.024, 0.0075, tick, 0.35, 0.004);
  const st = { master: on, land: !!L.landingLight, nav: on, dome: !!(L.dome && on) };
  for (const [id, x] of SWITCHES) {
    Pn.rect(x - 0.01, SW_Z + 0.017, x + 0.01, SW_Z + 0.023, T.placard, 0.08, 0.002);
    Pn.fitText(id.toUpperCase(), x, SW_Z + 0.020, 0.018, 0.0045, [24, 24, 26], 0, 0.003);
    Pn.rect(x - 0.009, SW_Z - 0.014, x + 0.009, SW_Z + 0.014, [14, 14, 16], 0, 0.003);
    Pn.stud(x, SW_Z + (st[id] ? 0.005 : -0.005), 0.007, 0.008, st[id] ? 0.010 : 0.006, id === 'master' ? [200, 40, 34] : [226, 224, 216], 0, 0.003);
  }
  // The UV lamps on the panel hood: lit after dark.
  for (const x of [-0.19, 0.19]) K.obox([x, 0.53, -0.265], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.03, 0.012, 0.02, 'dash', 0.1, night && on ? [150, 120, 255] : [40, 40, 46], night && on ? 0.9 : 0);

  // The Revi's reticle: a ring and a cross on the reflector, lit with the master.
  {
    const rc = [0, 0.73, -0.12];
    const Rv = K.panel(rc, [1, 0, 0], [0, -0.45, 1], 'dash', 0);
    Rv.rect(-0.04, -0.035, 0.04, 0.035, REVI_GLASS, 0, 0);
    if (on) {
      Rv.annulus(0, 0, 0.018, 0.020, [255, 150, 80], 1, 0.001, 16);
      Rv.rect(-0.012, -0.0006, 0.012, 0.0006, [255, 150, 80], 1, 0.001);
      Rv.rect(-0.0006, -0.012, 0.0006, 0.012, [255, 150, 80], 1, 0.001);
    }
    K.box(-0.042, 0.72, -0.165, 0.042, 0.75, -0.155, 'dash', 0.1, [30, 30, 32]);
  }

  // ── THE STICK: a KG 12 grip, the bomb button on its head, the trigger ──
  {
    const b = lv.stickBase;
    K.obox([b[0], b[1], b[2] + 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.06, 0.025, 'floor', 0, T.rubber);
    // A leather boot, in three rings that lean with the stick.
    const tip = [R.ail * 0.10, b[1] + 0.03 + R.elev * 0.10, -0.40];
    const dir = norm(sub(tip, b));
    for (let i = 0; i < 3; i++) {
      const c = add(b, mul(dir, 0.04 + i * 0.03));
      K.rod(c, add(c, mul(dir, 0.028)), 0.045 - i * 0.01, 'floor', -0.05, T.leatherDk, 0, 8);
    }
    K.rod(b, tip, 0.012, 'dash', 0.05, T.rlm66Lt, 0, 6);
    const grip = add(tip, mul(dir, 0.12));
    K.rod(tip, grip, 0.022, 'dash', 0.05, T.rubber, 0, 8);
    K.obox(add(grip, mul(dir, 0.012)), [1, 0, 0], [0, 1, 0], dir, 0.026, 0.030, 0.012, 'dash', 0.1, T.rubber);
    // Bomb release (red, on the head) and the gun trigger (forward face).
    K.rod(add(grip, mul(dir, 0.024)), add(grip, mul(dir, 0.032)), 0.009, 'dash', 0.3, [210, 40, 30], on ? 0.15 : 0, 8);
    K.obox(add(tip, add(mul(dir, 0.06), [0, 0.024, 0])), [1, 0, 0], dir, [0, 1, 0], 0.008, 0.016, 0.006, 'dash', 0.2, C.steel);
  }
  // ── THE PEDALS: stirrup pedals with straps, on the rudder ──
  for (const s of [-1, 1]) {
    const press = Math.max(0, s * R.rud);
    pedal(K, [s * 0.14, 0.72, P.shrike.room.floorZ + 0.34], 0.045, 0.24, press, T.rlm66Lt);
  }
  // ── THE LEFT CONSOLE: throttle and pitch levers, the trim wheel, the dive brake, the flaps ──
  for (const [lvr, rgb, r] of [[lv.throttle, [22, 22, 24], 0.018], [lv.pitch, [120, 80, 40], 0.014]]) {
    K.rod(lvr.pv, lvr.tip, 0.006, 'dash', 0.1, C.steel, 0, 5);
    K.rod(lvr.tip, add(lvr.tip, [0.03, 0, 0]), r, 'dash', 0.1, rgb, 0, 8);
  }
  {
    // The elevator trim hand-wheel: turns with the trim, a white index on its rim.
    const c = lv.trimC, a = clamp(num(L.trim), -1, 1) * Math.PI * 1.5;
    K.torus(c, [0, 1, 0], [0, 0, 1], lv.trimR, 0.009, 16, 'dash', 0.1, [30, 30, 32], 0);
    for (let i = 0; i < 3; i++) {
      const t = a + i * TAU / 3;
      K.rod(c, add(c, [0, Math.cos(t) * lv.trimR, Math.sin(t) * lv.trimR]), 0.005, 'dash', 0.1, [30, 30, 32], 0, 4);
    }
    K.obox(add(c, [0.012, Math.cos(a) * lv.trimR, Math.sin(a) * lv.trimR]), [0, 1, 0], [0, 0, 1], [1, 0, 0], 0.008, 0.008, 0.004, 'dash', 0.3, C.white, 0.2);
    K.rod(add(c, [0.0, Math.cos(a + 0.5) * lv.trimR, Math.sin(a + 0.5) * lv.trimR]), add(c, [0.035, Math.cos(a + 0.5) * lv.trimR, Math.sin(a + 0.5) * lv.trimR]), 0.007, 'dash', 0.1, C.black, 0, 5);
  }
  {
    // The dive brake lever: red, on the panel's left edge, up for IN, down for OUT.
    const pv = [-0.39, 0.52, -0.52], a = (-30 + 70 * lv.brake.v) * Math.PI / 180;
    const tip = add(pv, [0, -Math.sin(a) * 0.02 - 0.03, -Math.cos(a) * 0.10 + 0.10 - 0.10 * lv.brake.v]);
    K.rod(pv, tip, 0.006, 'dash', 0.1, C.steel, 0, 5);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.02, 0.012, 0.012, 'dash', 0.15, T.redHandle, 0);
    // The flap selector: a black lever in a three-notch gate beside it.
    const fv = [-0.33, 0.52, -0.60], fa = lv.flap.v;
    const ft = add(fv, [0, -0.03, -0.02 - 0.06 * fa]);
    K.rod(fv, ft, 0.005, 'dash', 0.1, C.steel, 0, 5);
    K.obox(ft, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, 0.010, 0.010, 'dash', 0.1, C.black, 0);
    // The jettison handle: yellow and black, under the panel.
    K.rod([0.18, 0.54, -0.66], [0.18, 0.50, -0.66], 0.006, 'dash', 0.1, C.steel, 0, 5);
    K.rod([0.15, 0.50, -0.66], [0.21, 0.50, -0.66], 0.010, 'dash', 0.15, T.yellow, 0, 6);
  }
  // The radio's dial lamps behind the gunner.
  if (on) {
    const G2 = P.shrike, gy = G2.Y(G2.E.fOf(GUNNER_U));
    const xw = -G2.wallAt(gy + 0.3, -0.40) + 0.02;
    K.box(xw + 0.161, gy + 0.43, -0.39, xw + 0.164, gy + 0.46, -0.36, 'post', 0, [255, 200, 120], 0.8);
  }
  hotspotHalo(K, shrikeHotspots(P, live), live);
}

// ── THE CONTROLS YOU CAN TOUCH ───────────────────────────────────────────────
export function shrikeHotspots(P, live) {
  const R = readings(live), lv = levers(P, live);
  const Pn = makeKit(() => {}).panel(PANEL_O, PANEL_R, PANEL_U);
  const out = SWITCHES.map(([id, x]) => ({ id: 'ck:' + id, p: Pn.pt(x, SW_Z, 0.01), r: 0.013, kind: 'click' }));
  const tip = [R.ail * 0.10, lv.stickBase[1] + 0.03 + R.elev * 0.10, -0.40];
  out.push({ id: 'yoke', p: add(tip, [0, 0.01, 0.08]), r: 0.07, kind: 'yoke' });
  out.push({ id: 'throttle', p: add(lv.throttle.tip, [0.015, 0, 0]), r: 0.035, kind: 'throttle' });
  out.push({ id: 'trim', p: lv.trimC, r: 0.07, kind: 'trim' });
  out.push({ id: 'ck:flaps', p: [-0.33, 0.49, -0.64 - 0.06 * lv.flap.v], r: 0.02, kind: 'click' });
  return out;
}

// Exposed for the gate: the exterior read-back and the scale, so it can say what it measured.
export const SHRIKE_EXTERIOR = exterior;

// The palette, for the livery cabin retint (interior-shell.js CABIN_WALLS).
export { T as SHRIKE_TRIM };
