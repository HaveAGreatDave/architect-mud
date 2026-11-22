// WHAT EVERY HOVER CAR'S COCKPIT SHARES: the room, read off the car's own body.
//
// A hover car's cockpit (interior-<id>.js, docs/proposals/hover-cars.md) is the inside of its
// exterior: client/shared/cabin-<id>.js states the body's stations, the glass and the doors once, and
// the exterior script builds the shell from the same file. This builds the room from it: the wall is
// the body's own section walked at its own angles and pushed in by a wall's thickness, the windows are
// the absence of wall where the cabin says glass, the floor stops where it meets the hull, and each
// door's card swings on the hinge the cabin names. Nothing about the shape of a cabin is typed in a
// cockpit's own file.
//
// What a cockpit's own file adds is everything you'd call the car: its trim, its dash, its wheel, its
// instruments, its seats. The Merlin's (interior-merlin.js) is older than this file and keeps its own
// copy of the room.
//
// ONE SCALE: the car's length over the compiled exterior's, so the room and the airframe agree about
// what a metre is. Anything about a person (seat width, reach, the wheel's size) is honest metres.
//
// Pure: no clock, no camera, no DOM. `live` arrives as an argument.
import { nightAt } from './sky-keys.js';
import { makeKit, clamp, lerp } from './interior-kit.js';
import { memoPart } from './interior-memo.js';
import { contactShadow, bootAge, lightLine } from './interior-cockpit-kit.js';
import { compileMesh } from './vehicle-mesh.js';
import { glyphRuns } from './glyph-runs.js';
import { legendWidth } from './legend-font.js';

export const TAU = Math.PI * 2, DEG = Math.PI / 180;
export const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── TYPE ─────────────────────────────────────────────────────────────────────
// A line of type in a box, set in one of the self-hosted faces (glyph-runs.js) where a browser can
// set it and in the legend face where it can't (the gates, the first frames). ⚠ EVERY CALL GIVES ITS
// BOX: `maxW` is the room it has across, and the type shrinks to it, never past it. `align` says what
// `x` is: 'c' the middle, 'l' the left edge, 'r' the right edge. `h` is the cap height.
export function fancyText(Pn, str, x, cb, h, rgb, emis, lift, face, maxW, align = 'c') {
  const g = glyphRuns(face, str);
  const w = g ? g.w * h : legendWidth(str, h), k = w > maxW ? h * maxW / w : h, ww = w * k / h;
  const x0 = align === 'l' ? x : align === 'r' ? x - ww : x - ww / 2;
  if (!g) return Pn.text(str, x0 + ww / 2, cb, k, rgb, emis, lift);
  const y0 = cb - k / 2;
  for (const [a0, b0, a1, b1] of g.rects) Pn.rect(x0 + a0 * k, y0 + b0 * k, x0 + a1 * k, y0 + b1 * k, rgb, emis, lift);
}
// A number right-aligned in the box [a, right] with its baseline at b, cap height h, in `face`.
export function fancyDigits(Pn, a, b, h, str, rgb, emis, right, face) {
  const sTrim = String(str).trim(), g = glyphRuns(face, sTrim);
  if (!g) return Pn.digits(a, b, h, str, rgb, false);
  const box = right - a, k = g.w * h > box ? box / g.w : h, x0 = a + box - g.w * k;
  for (const [a0, b0, a1, b1] of g.rects) Pn.rect(x0 + a0 * k, b + b0 * k, x0 + a1 * k, b + b1 * k, rgb, emis, 0.006);
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
export const readings = (live) => {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.1), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12),
    mr: L.mr || null,
    phase: num(L.phase), stall: !!L.stall,
  };
};
export const night = (R) => nightAt(R.hour);
export const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));
// On the road (merlin-modes.js HOVER) the wheel's push and pull lock and it only turns.
export const onRoad = (R) => !!(R.mr && (R.mr.mode === 'road' || R.mr.mode === 'down'));
// The word the driver's display shows for what the car is doing.
export const driveWord = (R) => { const M = R.mr; return !M ? '' : M.locking ? 'LOCK' : M.mode === 'road' ? (M.pit ? 'PIT' : 'ROAD') : M.mode === 'down' || M.mode === 'up' ? 'HOVER' : 'FLIGHT'; };
// How lit each of the four drive keys is, 0 to 1 (merlin-modes.js through live.mr).
export function driveLights(R, live) {
  const Md = R.mr || {}, pulse = 0.55 + 0.45 * Math.sin(bootAge(live) * 7);
  return {
    hover: Md.mode === 'road' ? 1 : Md.mode === 'down' || Md.mode === 'up' ? pulse : 0,
    lock: Md.locking ? 1 : Md.lockReady ? pulse : Md.near ? 0.35 : 0,
    boost: Md.over > 0 ? pulse * 0.6 : Md.boost ? 1 : 0,
    pit: Md.pit ? 1 : 0,
    heat: clamp(num(Md.heat), 0, 1), hot: num(Md.heat) > 0.75 || Md.over > 0,
  };
}
// Whether a circuit's key is on.
export function switchOn(id, R) {
  if (id === 'master') return R.powered;
  if (id === 'land') return R.land;
  if (id === 'panel') return panelOn(R);
  if (id === 'dome') return R.dome && R.powered;
  return R.powered;
}

// ── GEOMETRY ─────────────────────────────────────────────────────────────────
// A point turned `th` radians about the line through `pivot` along unit `axis` (Rodrigues).
export function turnAbout(q, pivot, axis, th) {
  const v = sub(q, pivot), c = Math.cos(th), s = Math.sin(th);
  const kxv = cross(axis, v), kv = dot(axis, v);
  return add(pivot, add(add(mul(v, c), mul(kxv, s)), mul(axis, kv * (1 - c))));
}
// A convex cell minus a convex hole, as disjoint convex pieces (interior-drake.js's own method).
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
export function clipHalf(poly, s) {
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

function modelLength(doc) {
  let fMax = -Infinity, fMin = Infinity;
  for (const f of compileMesh(doc, { detail: 1 }).faces) {
    if (f.role === 'rotor') continue;
    for (const q of f.p) { if (q[0] > fMax) fMax = q[0]; if (q[0] < fMin) fMin = q[0]; }
  }
  return fMax - fMin;
}

const WALL_M = 0.03;
// How far the doors stand open, in radians, from the cockpit's `door` (0 shut, 1 open).
export const doorAngle = (C, live) => Math.max(0, Math.min(1, Number(live && live.door) || 0)) * C.door.swing * DEG;

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile: the lining walked round the body with every pane cut out of it, a return
// and a lit seal round each pane, the firewall, the floor and the sills, and each door's hinge. Nothing
// here moves. `tones` are the trim colours for each part; `fit(ctx)` adds the car's own fixed
// fittings (door cards, the firewall's dressing) with the same tools.
//
//   tones: headliner, upper, mid, lower, doorUpper, doorLower, reveal, seal, firewall, floor,
//          floorEdge, floorLine (or null), sill, sillLine (or null), seam, hinge
function buildRoom(C, G, cfg) {
  const { toShell, inset, fB, zF, m } = G, T = cfg.tones;
  const faces = [];
  // The doors' own faces are kept apart, per side (1 right, -1 left), because they swing.
  const doorFaces = { 1: [], [-1]: [] };
  const pulls = {};
  let sink = faces;
  const put = (p, n, tone, k, rgb, emis) => sink.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) put(f.p, f.n, tone, k, rgb, emis); }, false);
  const S = (f, aDeg, inM = 0) => toShell(C.point(f, aDeg, -(inset + inM / m)));
  const inward = (f, a) => {
    const d = 1e-4;
    let n = norm(cross(sub(S(f + d, a), S(f - d, a)), sub(S(f, a + d * 50), S(f, a - d * 50))));
    const c = toShell([f, 0, C.section(f).cz]);
    if (dot(n, sub(c, S(f, a))) < 0) n = mul(n, -1);
    return n;
  };
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const D = C.door, SG = C.glass.side;
  // The rear window, if the car has one, is behind the firewall: the room never sees it.
  const PANES = C.panes().filter((p) => p.id !== 'rear');

  // ── THE SHELL ──
  const fN = cfg.fN, FS = [];
  for (let i = 0, n = Math.ceil((fN - fB) / 0.055); i <= n; i++) FS.push(lerp(fB, fN, i / n));
  const NA = 80;
  const holes = PANES.map((p) => { const fe = p.f[1] + (p.id === 'windscreen' ? 0.01 : 0); return [[p.f[0], p.a[0]], [fe, p.a[0]], [fe, p.a[1]], [p.f[0], p.a[1]]]; });
  for (let i = 0; i < FS.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const f0 = FS[i], f1 = FS[i + 1], a0 = -90 + (j / NA) * 360, a1 = -90 + ((j + 1) / NA) * 360;
      let cells = [[[f0, a0], [f1, a0], [f1, a1], [f0, a1]]];
      for (const h of holes) cells = cells.flatMap((c) => (bbOverlap(c, h) ? subtractConvex(c, h) : [c]));
      const fm = (f0 + f1) / 2, am = (a0 + a1) / 2, sn = Math.sin(am * DEG);
      const n = inward(fm, am);
      const side = Math.abs(Math.cos(am * DEG)) > 0.25;
      const aSide = am > 90 ? 180 - am : am;
      const inDoor = side && fm > D.f[0] && fm < D.f[1] && aSide > D.aLo && aSide < SG.a[0];
      for (const c of cells) {
        const poly = aboveFloor(c.map(([f, a]) => S(f, a)));
        if (poly.length < 3) continue;
        if (sn > 0.85) put(poly, n, 'hdr', -0.28, T.headliner);
        else if (inDoor) { sink = doorFaces[Math.cos(am * DEG) > 0 ? 1 : -1]; put(poly, n, 'pil', -0.06, aSide > SG.a[0] - 8 ? T.doorUpper : T.doorLower); sink = faces; }
        else if (sn < -0.15) put(poly, n, 'pil', -0.18, T.lower);
        else put(poly, n, 'pil', -0.12, sn > 0.3 ? T.upper : T.mid);
      }
    }
  }

  // ── THE REVEALS: a return round every pane, and a lit seal along its inner edge ──
  const reveal = (pts, cF, cA) => {
    for (let t = 1; t < pts.length; t++) {
      const [fa, aa] = pts[t - 1], [fb, ab] = pts[t];
      const i0 = S(fa, aa), i1 = S(fb, ab), o0 = toShell(C.point(fa, aa, -0.004 / m)), o1 = toShell(C.point(fb, ab, -0.004 / m));
      const fm = (fa + fb) / 2, am = (aa + ab) / 2;
      const toC = sub(S(cF, cA), S(fm, am));
      const out = norm(sub(toShell(C.point(fm, am, 0)), S(fm, am)));
      const rn = norm(sub(toC, mul(out, dot(toC, out))));
      if (i0[2] > zF && i1[2] > zF) put([i0, i1, o1, o0], rn, 'pil', 0.05, T.reveal);
      if (T.seal && i0[2] > zF + 0.01 && i1[2] > zF + 0.01) K.rod(S(fa, aa, 0.006), S(fb, ab, 0.006), 0.003, 'pil', 0.1, T.seal, 0.35, 5, false);
    }
  };
  const edge = (f0, a0, f1, a1, n) => Array.from({ length: n + 1 }, (_, i) => [lerp(f0, f1, i / n), lerp(a0, a1, i / n)]);
  for (const p of PANES) {
    const cF = (p.f[0] + p.f[1]) / 2, cA = (p.a[0] + p.a[1]) / 2;
    sink = p.id === 'side' ? doorFaces[Math.cos(cA * DEG) > 0 ? 1 : -1] : faces;
    reveal([...edge(p.f[0], p.a[0], p.f[1], p.a[0], 8), ...edge(p.f[1], p.a[0], p.f[1], p.a[1], 8).slice(1), ...edge(p.f[1], p.a[1], p.f[0], p.a[1], 8).slice(1), ...edge(p.f[0], p.a[1], p.f[0], p.a[0], 8).slice(1)], cF, cA);
  }
  sink = faces;

  // ── THE DOORS: the seam round each card and the hinge knuckles, then the car's own card ──
  // Each door's hinge in the shell, and the sign that opens it outward (the shell's axes are the
  // body's turned, so it is worked out here): a gull wing and a scissor door go up, the others out.
  const hinge = {};
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a);
    let pivot, axis, probe;
    if (D.hinge === 'roof') { pivot = S(D.f[0], A(D.aHi)); axis = norm(sub(S(D.f[1], A(D.aHi)), pivot)); probe = S(D.f[1], A(0)); }
    else if (D.hinge === 'scissor') { pivot = S(D.f[1] - 0.01, A(D.aLo + 14)); axis = [s, 0, 0]; probe = S(D.f[0], A(0)); }
    else { const fH = D.hinge === 'rear' ? D.f[0] : D.f[1]; pivot = S(fH, A(D.aLo + 8)); axis = norm(sub(S(fH, A(SG.a[0])), pivot)); probe = S(D.hinge === 'rear' ? D.f[1] : D.f[0], A(0)); }
    const moved = sub(turnAbout(probe, pivot, axis, 0.3), probe);
    const good = D.hinge === 'roof' || D.hinge === 'scissor' ? moved[2] > 0 : moved[0] * s > 0;
    hinge[s] = { pivot, axis, sign: good ? 1 : -1 };
  }
  for (const s of [1, -1]) {
    sink = doorFaces[s];
    const A = (a) => (s > 0 ? a : 180 - a), top = SG.a[0] - 1;
    const seam = [...edge(D.f[1] - 0.01, D.aLo + 10, D.f[1] - 0.01, top, 8), ...edge(D.f[1] - 0.01, top, D.f[0] + 0.012, top, 12).slice(1), ...edge(D.f[0] + 0.012, top, D.f[0] + 0.012, D.aLo + 10, 8).slice(1)];
    const pts = seam.map(([f, a]) => S(f, A(a), 0.006)).filter((q) => q[2] > zF + 0.02);
    for (let k = 1; k < pts.length; k++) K.rod(pts[k - 1], pts[k], 0.0045, 'pil', -0.3, T.seam, 0, 4, false);
    cfg.doorCard?.({ K, S, A, s, inward, D, zF, m, pull: (q) => { pulls[s] = q; } });
  }
  sink = faces;

  // ── THE FIREWALL: the wall behind the seats ──
  const NS = 80, bpts = [];
  for (let k = 0; k <= NS; k++) bpts.push(S(fB, -90 + (k / NS) * 360));
  const bulk = aboveFloor(bpts);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.12, T.firewall);

  // ── THE FLOOR ──
  const floorH = C.inside.floorH;
  const floorHalf = (f) => {
    let prev = null;
    for (let a = -90; a <= 0; a += 1) {
      const q = C.point(f, a, -inset);
      if (prev && prev[2] < floorH && q[2] >= floorH) {
        const t = (floorH - prev[2]) / (q[2] - prev[2]);
        return (prev[1] + (q[1] - prev[1]) * t) * m;
      }
      prev = q;
    }
    return 0;
  };
  const xC = G.X(0), FF = [];
  for (let f = fB; f < fN; f += 0.025) FF.push(f);
  for (let i = 0; i < FF.length - 1; i++) {
    const f0 = FF[i], f1 = FF[i + 1], w0 = floorHalf(f0), w1 = floorHalf(f1);
    if (w0 <= 0.01 || w1 <= 0.01) continue;
    put([[xC - w0, G.Y(f0), zF], [xC + w0, G.Y(f0), zF], [xC + w1, G.Y(f1), zF], [xC - w1, G.Y(f1), zF]], [0, 0, 1], 'floor', -0.2, i % 6 === 5 ? T.floorEdge : T.floor);
    if (T.floorLine) for (const s of [-1, 1]) K.box(xC + s * (w0 - 0.04) - 0.005, G.Y(f0), zF + 0.001, xC + s * (w0 - 0.04) + 0.005, G.Y(f1), zF + 0.004, 'floor', 0.2, T.floorLine, 0.8);
  }
  // The sills you step over, under the door cards, with the maker's line along them.
  for (const s of [-1, 1]) {
    const yA = G.Y(D.f[0] + 0.02), yZ = G.Y(Math.min(D.f[1] - 0.04, fN - 0.02)), wx = floorHalf((D.f[0] + D.f[1]) / 2), sw = cfg.sillW ?? 0.09, sh = cfg.sillH ?? 0.12;
    K.box(xC + s * wx - (s > 0 ? sw : 0), yA, zF, xC + s * wx + (s < 0 ? sw : 0), yZ, zF + sh, 'floor', 0.0, T.sill);
    if (T.sillLine) K.box(xC + s * (wx - sw / 2) - 0.004, yA + 0.05, zF + sh + 0.001, xC + s * (wx - sw / 2) + 0.004, yZ - 0.05, zF + sh + 0.004, 'floor', 0.2, T.sillLine, 0.9);
  }
  cfg.roomFit?.({ K, S, inward, G, xC, zF, yB: G.Y(fB), m, floorHalf });
  return { faces, doorFaces, hinge, pulls };
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// The panes the renderer lays over the room as film: each window in the layout, faceted along the
// body in (f, angle) small enough to be flat, 5 mm inside the skin and outboard of every reveal.
function buildGlass(C, G) {
  const { toShell, m } = G;
  const d = 0.005 / m;
  const panes = [], doorPanes = { 1: [], [-1]: [] };
  for (const p of C.panes()) {
    if (p.id === 'rear') continue;
    const into = p.id === 'side' ? doorPanes[Math.cos(((p.a[0] + p.a[1]) / 2) * DEG) > 0 ? 1 : -1] : panes;
    const nf = p.id === 'windscreen' ? 8 : 6, na = p.id === 'windscreen' ? 12 : 5;
    for (let i = 0; i < nf; i++) for (let j = 0; j < na; j++) {
      const fa = lerp(p.f[0], p.f[1], i / nf), fb = lerp(p.f[0], p.f[1], (i + 1) / nf), aa = lerp(p.a[0], p.a[1], j / na), ab = lerp(p.a[0], p.a[1], (j + 1) / na);
      into.push([[fa, aa], [fb, aa], [fb, ab], [fa, ab]].map(([f, a]) => toShell(C.point(f, a, -d))));
    }
  }
  return { panes, doorPanes };
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
// What interior-shell.js asks a seat for. `cfg` is the car's own:
//   label, tag (a short prefix for its cached parts), fN (how far forward the footwell runs),
//   tones (the room's colours, above), doorCard(ctx), roomFit(ctx), sillW, sillH,
//   dashY, dashZ, seatZ (over the floor), seatHalf, seatY, floods, floodGain, glare,
//   seats(P, push), fit(P, live, push), hotspots(P, live), glows(P, live)
export function hoverCarProfile(C, doc, cfg) {
  if (!doc) return null;
  const I = C.inside;
  const m = C.lengthM / modelLength(doc);
  const fE = I.eyeF, gE = I.seatG, hE = I.floorH + I.eyeM / m;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const inset = WALL_M / m, fB = I.bulkheadF, zF = Z(I.floorH);
  const G = { m, X, Y, Z, toShell, inset, fB, zF };
  const room = buildRoom(C, G, cfg);
  const glassSet = buildGlass(C, G);
  const allGlass = [...glassSet.panes, ...glassSet.doorPanes[1], ...glassSet.doorPanes[-1]];
  // The door glass goes with its door: shut, the panes as built; open, turned on the hinge.
  let glassAt = -1, glassMemo = allGlass;
  const glass = (live) => {
    const th = doorAngle(C, live);
    if (!th) return allGlass;
    if (th !== glassAt) {
      glassAt = th;
      glassMemo = [...glassSet.panes];
      for (const s of [1, -1]) { const h = room.hinge[s]; for (const pn of glassSet.doorPanes[s]) glassMemo.push(pn.map((q) => turnAbout(q, h.pivot, h.axis, th * h.sign))); }
    }
    return glassMemo;
  };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const see = (q) => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); };
  for (const f of [...room.faces, ...room.doorFaces[1], ...room.doorFaces[-1]]) f.p.forEach(see);
  for (const pn of allGlass) pn.forEach(see);
  const xCentre = X(0), halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;
  // The side rays go out through the door glass a hand above its sill, so a ray a little lower meets
  // the door card however deep the glass is.
  const SG = C.glass.side, wq = toShell(C.point((SG.f[0] + SG.f[1]) / 2, (SG.a[0] + SG.a[1]) / 2, 0)), sillZ = toShell(C.point(I.eyeF, SG.a[0], 0))[2];
  const P = {
    label: cfg.label,
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    mPerUnit: m,
    winY: [wq[1] - 0.08, wq[1] + 0.08], winZ: [sillZ + 0.03, sillZ + 0.11],
    dashY: cfg.dashY, dashZ: cfg.dashZ, headerZ: z1 - 0.06, pillarW: 0.03,
    seatZ: zF + cfg.seatZ, seatHalf: cfg.seatHalf, seatY: cfg.seatY, backZ: 0.02,
    seats: 2, centrePost: 0,
    normalLit: true,
    floods: cfg.floods(xCentre), floodGain: cfg.floodGain ?? 1.5, glare: cfg.glare ?? 0.22,
    room: (Pp, live, push, rich) => hoverShell(Pp, live, push, rich),
    glass,
    // The room, for the cockpit's own drawing and for its gate.
    hc: { ...G, C, cfg, faces: room.faces, doorFaces: room.doorFaces, hinge: room.hinge, pulls: room.pulls },
    hotspots(live) { return cfg.hotspots(this, live); },
    glows(live) { return cfg.glows ? cfg.glows(this, live) : []; },
  };
  return P;
}

// The shell, as interior-shell.js calls it: the room, the doors where they stand, the seats, the fit-out.
function hoverShell(P, live, push, rich) {
  const D = P.hc, cfg = D.cfg;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  const th = doorAngle(D.C, live);
  for (const s of [1, -1]) {
    const h = D.hinge[s];
    for (const f of D.doorFaces[s]) {
      if (!th) { push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0); continue; }
      const a = th * h.sign;
      push([{ p: f.p.map((q) => turnAbout(q, h.pivot, h.axis, a)), n: sub(turnAbout(add(h.pivot, f.n), h.pivot, h.axis, a), h.pivot) }], f.tone, f.k, false, f.rgb, f.emis || 0);
    }
  }
  // The seats never move: built once (interior-memo.js memoPart).
  memoPart(push, cfg.tag + ':seats', {}, (S, rec) => cfg.seats(P, rec), null);
  if (rich) cfg.fit(P, live, push);
}

// ── THE DOORS FROM THE SEAT ──────────────────────────────────────────────────
// A door's pull where it stands now, turned with its door.
export function pullAt(P, live, s) {
  const D = P.hc, q = D && D.pulls && D.pulls[s];
  if (!q) return null;
  const th = doorAngle(D.C, live), h = D.hinge[s];
  return th ? turnAbout(q, h.pivot, h.axis, th * h.sign) : q;
}
// The OUT hologram: once a door is most of the way open, a ring of light in the doorway beside the
// seat, standing up and facing into the cabin. A click on it climbs you out.
const OUT_AT = 0.85;
export function outHolo(P, live, s) {
  if (!(Number(live && live.door) > OUT_AT)) return null;
  const q = P.hc.pulls[s];
  if (!q) return null;
  const c = [P.xCentre + s * (P.halfW - 0.16), 0.12, -0.12];
  return { c, r: [0, 1, 0], u: [0, 0, 1] };
}
export function outHoloDraw(K, P, live, face) {
  const t = bootAge(live), flick = 0.8 + 0.2 * Math.sin(t * 11) * Math.sin(t * 3.7);
  for (const s of [1, -1]) {
    const H = outHolo(P, live, s);
    if (!H) continue;
    const hov = !!live && (live.hover === 'ck:out' || live.press === 'ck:out');
    const Pn = K.panel(H.c, H.r, H.u, 'dash', 0);
    const rgb = hov ? [190, 255, 235] : [90, 230, 210], k = (hov ? 1 : 0.75) * flick;
    Pn.annulus(0, 0, 0.034, 0.038, rgb, k, 0.001, 28);
    Pn.annulus(0, 0, 0.041, 0.042, rgb, k * 0.5, 0.001, 28, t * 2, t * 2 + TAU * 0.7);
    fancyText(Pn, 'OUT', 0, -0.009, 0.016, rgb, k, 0.002, face, 0.05);
    Pn.rect(-0.012, 0.012, 0.008, 0.016, rgb, k, 0.002);
    Pn.plate([[0.008, 0.007], [0.02, 0.014], [0.008, 0.021]], rgb, k, 0.002);
  }
}
// The doors' hotspots: each pull opens and shuts both doors on the ground, and each OUT climbs you out.
export function doorHotspots(P, live) {
  const out = [];
  for (const s of [1, -1]) {
    const q = pullAt(P, live, s);
    if (q) out.push({ id: 'ck:door', p: q, r: 0.05, kind: 'click' });
    const H = outHolo(P, live, s);
    if (H) out.push({ id: 'ck:out', p: H.c, r: 0.05, kind: 'click' });
  }
  return out;
}

// ── FITTINGS EVERY CAR HAS, IN ITS OWN TONES ─────────────────────────────────
// The yaw pedals: two plates sliding on rails in the driver's footwell, one forward as the other
// comes back. `o`: { y, z (over the floor), half (their spacing), plate, rail, hole }.
export function yawPedals(K, R, zF, o) {
  const pz = zF + (o.z ?? 0.12), py = o.y;
  for (const [dx, sgn] of [[-o.half, -1], [o.half, 1]]) {
    const slide = clamp(R.rud * sgn, -1, 1) * 0.05;
    K.box(dx - 0.012, py - 0.12, zF, dx + 0.012, py + 0.12, zF + 0.02, 'dash', 0.1, o.rail);
    const c = [dx, py + slide, pz], pu = norm([0, -0.45, 0.89]), pn = norm([0, 0.89, 0.45]);
    K.obox(c, [1, 0, 0], pu, pn, o.w ?? 0.04, o.h ?? 0.09, 0.008, 'dash', 0.2, o.plate);
    if (o.hole) {
      const Pd = K.panel(add(c, mul(pn, -0.009)), [1, 0, 0], pu, 'dash', 0.2);
      for (let r = 0; r < 4; r++) for (const xx of [-0.02, 0, 0.02]) Pd.disc(xx, -0.06 + r * 0.04, 0.006, o.hole, 0, 0.001, 8);
    }
    K.rod(add(c, [0, 0, -0.06]), [dx, py + slide, zF + 0.02], 0.012, 'dash', 0.2, o.rail, 0, 6);
    contactShadow(K, [dx, py + slide, zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.11);
  }
}
// The maker's line along each roof rail over the door glass, and a dome lamp in the roof.
export function overhead(K, P, R, line, lineK, o = {}) {
  const D = P.hc, C = D.C, SG = C.glass.side, lit = R.powered;
  for (const s of [1, -1]) {
    const A = (a) => (s > 0 ? a : 180 - a), pts = [];
    for (let i = 0; i <= 3; i++) pts.push(D.toShell(C.point(lerp(SG.f[0], Math.min(SG.f[1], C.glass.windscreen.f[0]), i / 3), A(SG.a[1] + 4), -(D.inset + 0.01 / D.m))));
    lightLine(K, pts, 0.004, line, lineK, 'hdr');
  }
  const dome = [P.xCentre, o.domeY ?? -0.05, P.roof - 0.05], on = R.dome && lit;
  K.rod(add(dome, [0, 0, -0.01]), add(dome, [0, 0, 0.03]), o.domeR ?? 0.04, 'hdr', 0.1, on ? (o.domeOn || [255, 244, 226]) : [70, 70, 76], on ? 1 : 0, 14);
}
// Half the room's width about its centre line at (y, z) in the shell, less `margin`: how wide a
// fitting can be there and stay inside the body.
export function roomHalfW(P, y, z, margin = 0.02) {
  const D = P.hc, C = D.C, f = y / D.m + C.inside.eyeF, h = z / D.m + (C.inside.floorH + C.inside.eyeM / D.m);
  const s = C.section(f), e = 1 - s.boxy * 0.55, dh = h - s.cz, rv = (dh >= 0 ? s.rvT : s.rvB) - D.inset, rg = s.rg - D.inset;
  const t = 1 - Math.pow(Math.min(1, Math.abs(dh) / rv), 2 / e);
  return t <= 0 ? 0 : Math.max(0, Math.pow(t, e / 2) * rg * D.m - margin);
}
// The height of the inside of the roof (or the screen) over the centre line at y, in the shell.
export function roomCrownZ(P, y) {
  const D = P.hc, C = D.C, s = C.section(y / D.m + C.inside.eyeF);
  return (s.cz + s.rvT - D.inset - (C.inside.floorH + C.inside.eyeM / D.m)) * D.m;
}
