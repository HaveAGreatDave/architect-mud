// VEHICLE MESH — the authored format for a vehicle that is drawn by hand, and the one compiler for it.
//
// A vehicle in GLASS is a face list in its own frame (f = fore+, g = right+, h = up+), each face
// `{ role, sh, p: [[f,g,h], …] }` plus a few optional fields. Most classes are GENERATED from a row
// of numbers (`fw_*`, `truck_*`, `boat_*` in content/vehicle_models/). The rest were drawn in code,
// which meant nobody could change one without writing JavaScript. This file is what lets them be
// authored as data instead: a mesh file is a list of PARTS, each part is a primitive with plain
// parameters, and `compileMesh` turns the list into faces.
//
// Four processes read it, which is why it is in client/shared/: aircraft3d.js (the renderer), the
// bake and the `mesh` CLI, the shape gates, and the Modelshop editor in the browser. One compiler,
// so the editor's preview IS the bake rather than an approximation of it.
//
// ⚠ THE PRIMITIVES ARE THE OLD HELPERS, MOVED, NOT REWRITTEN. `addTube`, `pushWheel` and the rest
// used to live in aircraft3d.js; they live here now and that file imports them, so there is one copy.
// The hand-drawn builders were converted by replaying them through these primitives, and the gate
// holds each converted file to the builder's exact output: same faces, same order, every number
// `Object.is`-equal (which catches −0). That only works because the primitive a file names is the
// same function the builder called. Change a helper and you change every mesh that uses it.
//
// ⚠ A MIRROR RE-RUNS ITS CHILDREN WITH THE LATERAL COORDINATE NEGATED. It never flips the finished
// faces. That is a correctness rule, not a style one: `addTube` builds its cross-section frame from
// the direction of the tube, so a tube built from mirrored end points starts its ring at a different
// vertex than the mirror image of the right-hand tube. The legacy builders all did `for (const s of
// [1, -1])`, and re-running is the only way to reproduce what they drew.
//
// ⚠ A ZERO STAYS WHERE IT IS UNDER A MIRROR. A builder writing `V(0.30, 0, 0.230)` inside a
// two-sided loop drew +0 on both sides; negating it would give −0 on the left. `ng` below leaves
// both zeros alone, so a point on the centreline stays exactly on it.

export const V = (f, g, h) => [f, g, h];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Canopy texture space: U 0→CP_TW runs windscreen→rear canopy, V 0→CP_TH runs right sill→roof→left
// sill. The canopy art in aircraft3d.js paints into a canvas this size, and a glazed facet's `uv` is
// in these units.
export const CP_TW = 512, CP_TH = 256;

// ── The primitives ────────────────────────────────────────────────────────────
// A round n-gon tube between two 3D points — skid rails, cross-tubes, tow bars.
export function addTube(faces, a, b, r, role = 'gear', sh = 0.55, sides = 6, caps = false) {
  const d = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const u = norm3(cross3(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross3(d, u);
  const ring = (c) => { const o = []; for (let i = 0; i < sides; i++) { const t = i / sides * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r; o.push(V(c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn)); } return o; };
  const A = ring(a), B = ring(b);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; faces.push({ role, sh, p: [A[i], A[j], B[j], B[i]] }); }
  // An open tube shows its hollow inside wherever a thinner one joins it (the Drake's toe knuckles
  // read as black bands). `caps` closes both ends; B winds outward along d, so A is reversed.
  if (caps) { faces.push({ role, sh, p: B }); faces.push({ role, sh, p: A.slice().reverse() }); }
}

// A vertical oleo strut: an n-gon leg from zTop down to zBot, dull cylinder over a bright piston.
export function addStrut(faces, f, g, zTop, zBot, r, sides = 6) {
  const ring = (z, s) => { const o = []; for (let i = 0; i < sides; i++) { const a = (i + 0.5) / sides * Math.PI * 2; o.push(V(f + Math.cos(a) * r * s, g + Math.sin(a) * r * s, z)); } return o; };
  const a = ring(zTop, 1), b = ring((zTop + zBot) / 2, 0.85), c = ring(zBot, 0.85);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; faces.push({ role: 'gear', sh: 0.58, p: [a[i], a[j], b[j], b[i]] }); faces.push({ role: 'gear', sh: 0.9, p: [b[i], b[j], c[j], c[i]] }); }
}

// A detailed tyre rolling fore-aft, centred at (wf,g,wz): blocky tread band, two sidewalls,
// bright metal hubcaps. Radius wr, half-width hw, N tread segments.
export function pushWheel(faces, wf, g, wz, wr, hw, N = 12) {
  const hr = wr * 0.4, g0 = g - hw, g1 = g + hw;
  const ring = (gg, rad) => { const r = []; for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; r.push(V(wf + Math.cos(a) * rad, gg, wz + Math.sin(a) * rad)); } return r; };
  const outO = ring(g1, wr), outI = ring(g0, wr), hubO = ring(g1, hr), hubI = ring(g0, hr);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    faces.push({ role: 'gear', sh: 0.34 + 0.06 * (i % 2), p: [outI[i], outI[j], outO[j], outO[i]] });   // tread
    faces.push({ role: 'gear', sh: 0.5, p: [outO[i], outO[j], hubO[j], hubO[i]] });                     // outboard sidewall
    faces.push({ role: 'gear', sh: 0.4, p: [hubI[i], hubI[j], outI[j], outI[i]] });                     // inboard sidewall
  }
  faces.push({ role: 'gear', sh: 0.92, p: hubO });
  faces.push({ role: 'gear', sh: 0.55, p: hubI.slice().reverse() });
}

// A streamlined teardrop wheel fairing (Cessna 'spat'), body-coloured, open underneath so the
// tyre pokes out below. `s` stretches its fore-aft length (smaller on the nose wheel).
// `s` also scales its girth and how high it stands, so a fairing over a big ag tyre actually
// covers the tyre instead of sitting on it like a cap.
export function addSpat(faces, f, g, wz, s = 1) {
  const F = V(f + 0.08 * s, g, wz + 0.03 * s), B = V(f - 0.06 * s, g, wz + 0.035 * s), T = V(f + 0.005, g, wz + 0.075 * s),
    L = V(f + 0.005, g - 0.024 * s, wz + 0.03 * s), R = V(f + 0.005, g + 0.024 * s, wz + 0.03 * s);
  faces.push({ role: 'nacelle', sh: 0.86, p: [F, R, T] });
  faces.push({ role: 'nacelle', sh: 0.8, p: [F, T, L] });
  faces.push({ role: 'nacelle', sh: 0.62, p: [B, T, R] });
  faces.push({ role: 'nacelle', sh: 0.58, p: [B, L, T] });
}

// A STREAMLINED member swept between two points: a lens cross-section (rounded nose, tapering
// tail) carried along a→b with its chord held fore-aft. This is what a lift strut and a gear-leg
// fairing actually are, and it's why they catch light down one edge instead of reading as pipe.
export function addFaired(faces, a, b, chord, th, role = 'strut', sh = 0.64) {
  const d = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  // u = fore-aft, made perpendicular to the member's own axis (a strut lying along f falls back
  // to lateral, so the section can never collapse to a line).
  let u = [1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2]];
  if (Math.hypot(u[0], u[1], u[2]) < 0.15) u = [0, 1 - d[1] * d[1], -d[1] * d[2]];
  u = norm3(u);
  const v = norm3(cross3(d, u));
  const PROF = [[0.50, 0], [0.18, 0.9], [-0.20, 0.62], [-0.50, 0], [-0.20, -0.62], [0.18, -0.9]];
  const ring = (c) => PROF.map(([cu, cv]) => V(
    c[0] + u[0] * cu * chord + v[0] * cv * th,
    c[1] + u[1] * cu * chord + v[1] * cv * th,
    c[2] + u[2] * cu * chord + v[2] * cv * th));
  const A = ring(a), B = ring(b), n = PROF.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ role, sh: sh * (0.8 + 0.3 * Math.abs(PROF[i][1])), p: [A[i], A[j], B[j], B[i]] });
  }
  // Both ends closed. Open, the member is a sleeve, and wherever an end stands clear of what it
  // joins you look straight down a hole in it (the Drake's minigun stub).
  faces.push({ role, sh: sh * 0.85, p: A.slice().reverse() });
  faces.push({ role, sh: sh * 0.85, p: B.slice() });
}

// A flat lifting panel (wing / stabiliser) given by 4 corners in order
// [rootLE, tipLE, tipTE, rootTE]. detail 0 (or no thickness) → the original single quad;
// detail 1 → a thin box: top + bottom skins (split ±th/2 in z) plus leading-edge, tip and
// trailing-edge strips (the root edge is buried in the fuselage, so no face). Gives the
// wing real thickness at the cost of +4 faces, only in the full-detail mesh.
export function pushPanel(faces, role, sh, c, th, detail) {
  if (!detail || !th) { faces.push({ role, sh, p: c }); return; }
  const up = th / 2;
  const T = c.map(v => V(v[0], v[1], v[2] + up)), B = c.map(v => V(v[0], v[1], v[2] - up));
  faces.push({ role, sh: Math.min(1, sh * 1.06), p: T });                 // top skin (brighter)
  faces.push({ role, sh: sh * 0.7, p: [B[3], B[2], B[1], B[0]] });        // bottom skin (darker, wound the other way)
  for (const [i, j] of [[0, 1], [1, 2], [2, 3]]) faces.push({ role, sh: sh * 0.85, p: [T[i], T[j], B[j], B[i]] });   // LE · tip · TE
}

// One hinged trailing-edge panel. le0/le1 = the parent panel's leading-edge-side points at
// the surface's inboard/outboard ends; te0/te1 = the trailing-edge points there; `cf` = the
// surface's chord fraction (how far forward of the TE the hinge sits). Hinge corners sit ON
// the axis (unmoved by the rotation); the TE corners swing.
// `axis` is which way the parent panel is thin — 'z' for a wing/tailplane, 'g' for a vertical fin —
// and `half` is the parent's half-thickness. The surface is emitted as a two-sided plate standing
// just PROUD of the parent on both faces, never in its plane.
//
// This is a z-fighting fix, not decoration. The old single quad floated 0.006 off the panel's MID
// plane, which buries it inside a wing 0.028 thick and puts it exactly coplanar with a flat fin. Two
// overlapping faces at the same depth have no stable painter's-algorithm order, so the sort flipped
// with the camera and the wing tops and fins strobed. Separating them by the real skin thickness
// gives the sort something to be right about.
export function pushCtrlSurface(faces, role, side, sh, le0, le1, te0, te1, cf, axis = 'z', half = 0.014) {
  const off = half + 0.004;
  const bump = (v, s) => axis === 'g' ? [v[0], v[1] + s * off, v[2]] : [v[0], v[1], v[2] + s * off];
  const h0 = lerp3(te0, le0, cf), h1 = lerp3(te1, le1, cf);
  for (const s of [1, -1]) {
    const T0 = bump(te0, s), T1 = bump(te1, s), H0 = bump(h0, s), H1 = bump(h1, s);
    faces.push({ role, defl: role, side, sh: s > 0 ? sh : sh * 0.72,
      hinge: [H0, H1], p: s > 0 ? [H0, H1, T1, T0] : [T0, T1, H1, H0] });
  }
}

// A slim exposed MISSILE lying under a wingtip: a body tube, a pointed seeker nose (triangle fan to
// an apex ahead), and four little tail fins. Reads unmistakably as ordnance on the rail.
export function addMissileBody(faces, fB, fF, g, z) {
  const r = 0.018;
  addTube(faces, V(fB, g, z), V(fF, g, z), r, 'nacelle', 0.7, 6);
  const apex = V(fF + 0.09, g, z);
  const bs = 6, ringF = [];
  for (let i = 0; i < bs; i++) { const a = i / bs * Math.PI * 2; ringF.push(V(fF, g + Math.cos(a) * r, z + Math.sin(a) * r)); }
  for (let i = 0; i < bs; i++) { const j = (i + 1) % bs; faces.push({ role: 'nacelle', sh: 0.82, p: [apex, ringF[i], ringF[j]] }); }   // seeker cone
  for (const [dg, dh] of [[1, 0], [-1, 0], [0, 1], [0, -1]])   // tail fins
    faces.push({ role: 'fin', sh: 0.6, p: [V(fB, g + dg * r, z + dh * r), V(fB - 0.03, g + dg * r * 2.1, z + dh * r * 2.1), V(fB + 0.02, g + dg * r * 2.1, z + dh * r * 2.1)] });
}

// ── Aerofoils ─────────────────────────────────────────────────────────────────
// NACA-2412-ish: standard 4-digit thickness distribution at t = 12% over a 2% camber line at 40%
// chord. Returns [upper, lower] as fractions of chord. x = 0 at the leading edge, 1 at the trailing.
export function ceFoil(x) {
  const yt = 0.6 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const m = 0.02, pc = 0.4;
  const yc = x < pc ? m / (pc * pc) * (2 * pc * x - x * x)
    : m / ((1 - pc) * (1 - pc)) * ((1 - 2 * pc) + 2 * pc * x - x * x);
  return [yc + yt, yc - yt];
}
// USA-35B-ish: the same foil with the underside flattened almost to a plank and a touch more
// camber up top. Flat-bottomed is the whole look of a Cub wing from below.
export function cubFoil(x) {
  const [u, l] = ceFoil(x);
  return [u * 1.06, Math.min(0, l * 0.30)];
}
// ⚠ AN ENUM, NEVER A FREE THICKNESS. `0.12 / 0.2` is not guaranteed to equal the `0.6` inside
// ceFoil, so a foil parameterised by thickness would stop reproducing the Mayfly bit for bit.
export const FOILS = { naca2412: ceFoil, usa35b: cubFoil };

// A point on a `wing` part's surface: lateral station g, chord fraction x, upper (1), lower (0) or
// mean line (0.5). The same arithmetic the Mayfly's cePt and the Cub's cuPt did — a Cub is a wing
// whose taper starts at the tip (taper0 1), so both are one formula.
export function wingPoint(w, g, x, sec) {
  const a = Math.min(1, Math.abs(g) / w.span);
  const t = a <= w.taper0 ? 0 : (a - w.taper0) / (1 - w.taper0);
  const le = w.leR + (w.leT - w.leR) * t, te = w.teR + (w.teT - w.teR) * t;
  const c = le - te, [u, l] = FOILS[w.foil](x);
  const z = w.wh + w.dih * a + (sec === 0.5 ? (u + l) / 2 : sec ? u : l) * c;
  return V(le - x * c, g, z);
}
// Where a wing's starboard nav lamp goes: mid-chord at the tip rib.
export function wingTipStation(w) {
  return [(wingPoint(w, w.span, 0, 0.5)[0] + wingPoint(w, w.span, 1, 0.5)[0]) / 2, w.span, wingPoint(w, w.span, 0.5, 0.5)[2]];
}

// ── The part schema ───────────────────────────────────────────────────────────
// Every kind, its fields, and a sentence about it. The validator, the Modelshop's forms and its
// tool palette all read this, so a kind added here gets a form and a button with nothing else
// edited. `t` is the field type the form draws; `g` marks a lateral coordinate the mirror negates.
export const KNOWN_ROLES = ['body', 'glass', 'window', 'wing', 'aileron', 'flap', 'stab', 'elevator', 'fin', 'rudder',
  'nacelle', 'rotor', 'gear', 'strut', 'gun', 'deck', 'interior', 'ramp'];
const COMMON_FIELDS = {
  kind: { t: 'str' }, name: { t: 'str' }, note: { t: 'str' },
  minDetail: { t: 'int', hint: 'drawn only at this detail or finer (1 = near LOD only)' },
  maxDetail: { t: 'int', hint: 'drawn only at this detail or coarser' },
  lod0: { t: 'obj', hint: 'fields swapped in at detail 0' },
  left: { t: 'obj', hint: 'inside a mirror: what differs on the left side' },
  paint: { t: 'str', hint: 'paint slot (params.paints) this part wears' },
  when: { t: 'str', hint: 'drawn only while this channel is above zero: a room seen through a door' },
  whenNot: { t: 'str', hint: 'drawn UNLESS this channel is above zero: a part that can break off' },
  scheme: { t: 'str', hint: 'drawn only under this paint scheme (params.schemes): a special edition\'s own skin' },
  schemeNot: { t: 'str', hint: 'drawn under every scheme but this one: the skin a scheme part replaces' },
  anim: { t: 'obj', hint: 'a moving part: { ch, pivot: [f,g,h], axis: [f,g,h], ang: [at 0, at 1] degrees, slide: [f,g,h] at 1, span: [a, b] of the channel, back: [c, d] where it returns, def }; ch "gear" is the landing gear' },
};
export const PART_KINDS = {
  loft: { label: 'Loft', blurb: 'A hull skinned through cross-section stations, nose to tail.', fields: {
    sides: { t: 'int', req: true, hint: 'facets around each station' },
    section: { t: 'enum', of: ['ellipse', 'super'], hint: 'ellipse = round; super = flanks, crown and belly shaped separately' },
    role: { t: 'role' },
    exp: { t: 'vec3', hint: 'super-ellipse exponents [flank, crown, belly]; under 1 is boxier' },
    upper: { t: 'vec2list', hint: 'a greenhouse profile [gFrac, hFrac] for stations marked upper' },
    shade: { t: 'obj', hint: '{ base, amp, mul }: crown-bright to belly-dark' },
    stations: { t: 'stations', req: true },
    regions: { t: 'list', hint: 'bays that are glass or another paint, or a hole: { at: [f…], k: [..]|"all", omit, role, tint, art, uvDiv, paint }' },
    capFore: { t: 'obj', hint: '{ kind: "apex", at } or { kind: "flat", sh }' },
    capAft: { t: 'obj', hint: '{ kind: "apex", at } or { kind: "flat", sh, reverse }' },
  } },
  tube: { label: 'Tube', blurb: 'A round tube along a polyline: skids, rails, masts, exhausts.', fields: {
    pts: { t: 'pts', req: true, g: true }, r: { t: 'num', req: true }, sides: { t: 'int' }, role: { t: 'role' }, sh: { t: 'num' },
    caps: { t: 'int', hint: '1 closes both ends of each segment' },
  } },
  strut: { label: 'Strut', blurb: 'A vertical oleo leg: dull cylinder over a bright piston.', fields: {
    at: { t: 'vec2', req: true, g: true, hint: '[f, g]' }, top: { t: 'num', req: true }, bot: { t: 'num', req: true },
    r: { t: 'num', req: true }, sides: { t: 'int' },
  } },
  wheel: { label: 'Wheel', blurb: 'A tyre with tread, sidewalls and hubcaps, rolling fore-aft.', fields: {
    at: { t: 'vec3', req: true, g: true }, r: { t: 'num', req: true }, hw: { t: 'num', req: true, hint: 'half-width' }, n: { t: 'int' },
  } },
  spat: { label: 'Spat', blurb: 'A teardrop wheel fairing.', fields: {
    at: { t: 'vec3', req: true, g: true }, s: { t: 'num', hint: 'size' },
  } },
  faired: { label: 'Faired strut', blurb: 'A streamlined member along a polyline: lift struts, gear legs.', fields: {
    pts: { t: 'pts', req: true, g: true }, chord: { t: 'num', req: true }, th: { t: 'num', req: true }, role: { t: 'role' }, sh: { t: 'num' },
  } },
  panel: { label: 'Panel', blurb: 'A flat lifting surface [rootLE, tipLE, tipTE, rootTE], boxed at full detail.', fields: {
    c: { t: 'pts', req: true, g: true }, th: { t: 'num' }, role: { t: 'role' }, sh: { t: 'num', req: true },
  } },
  ctrl: { label: 'Control surface', blurb: 'A hinged flap, aileron, elevator or rudder panel.', fields: {
    role: { t: 'role', req: true }, side: { t: 'num', req: true, g: true }, sh: { t: 'num', req: true },
    le: { t: 'pts', req: true, g: true }, te: { t: 'pts', req: true, g: true }, cf: { t: 'num', req: true },
    axis: { t: 'enum', of: ['z', 'g'] }, half: { t: 'num' },
  } },
  missile: { label: 'Missile', blurb: 'A body tube, a seeker cone and four tail fins.', fields: {
    f: { t: 'vec2', req: true, hint: '[tail f, nose f]' }, g: { t: 'num', req: true, g: true }, z: { t: 'num', req: true },
  } },
  drum: { label: 'Drum', blurb: 'An upright n-gon barrel: hubs, swashplates, ducts.', fields: {
    f: { t: 'num', req: true }, g: { t: 'num', g: true }, r: { t: 'num', req: true }, z: { t: 'vec2', req: true, hint: '[bottom, top]' },
    n: { t: 'int' }, role: { t: 'role' }, sh: { t: 'obj', hint: '{ base, alt, phase }: alternating side shade' },
    top: { t: 'obj', hint: '{ sh }' }, bottom: { t: 'obj', hint: '{ sh }' },
  } },
  ngon: { label: 'Disc', blurb: 'A single flat horizontal n-gon: rotor discs, lids.', fields: {
    f: { t: 'num', req: true }, g: { t: 'num', g: true }, h: { t: 'num', req: true }, r: { t: 'num', req: true },
    n: { t: 'int' }, role: { t: 'role' }, sh: { t: 'num' },
  } },
  cone: { label: 'Cone', blurb: 'A fan of facets from a ring (square to f) to an apex: spinners, noses.', fields: {
    f: { t: 'num', req: true }, g: { t: 'num', g: true }, h: { t: 'num', req: true }, r: { t: 'num', req: true },
    n: { t: 'int' }, apex: { t: 'vec3', req: true, g: true }, role: { t: 'role' }, shade: { t: 'obj' },
  } },
  blade: { label: 'Blade', blurb: 'A flat outline in the f-h plane given a thickness: fins, sails.', fields: {
    outline: { t: 'vec2list', req: true, hint: '[f, h] corners' }, t: { t: 'num', req: true, hint: 'half-thickness' },
    role: { t: 'role' }, sh: { t: 'vec2', req: true, hint: '[right face, left face]' },
    split: { t: 'list', hint: 'split the side into facets: [{ k: [..], mul }]' },
    edges: { t: 'list', hint: 'edge strips: [{ a, b, sh }]' },
  } },
  wing: { label: 'Wing', blurb: 'A tip-to-tip wing skinned from real ribs over an aerofoil.', fields: {
    foil: { t: 'enum', of: Object.keys(FOILS), req: true }, span: { t: 'num', req: true },
    taper0: { t: 'num', req: true, hint: 'fraction of the semi-span where the taper starts (1 = none)' },
    wh: { t: 'num', req: true, hint: 'height' }, dih: { t: 'num', req: true, hint: 'dihedral rise at the tip' },
    leR: { t: 'num', req: true }, teR: { t: 'num', req: true }, leT: { t: 'num', req: true }, teT: { t: 'num', req: true },
    ribs: { t: 'list', req: true }, nx: { t: 'int', req: true, hint: 'chordwise samples' },
    role: { t: 'role' }, lower: { t: 'num', req: true, hint: 'underside shade' }, tipSh: { t: 'num' },
    tipFairing: { t: 'obj' }, lens: { t: 'obj' },
  } },
  poly: { label: 'Faces', blurb: 'Literal faces, for the shapes no primitive expresses.', fields: {
    faces: { t: 'faces', req: true, g: true },
  } },
  mirror: { label: 'Mirror', blurb: 'Its parts, then the same parts again on the other side.', fields: {
    parts: { t: 'parts', req: true },
  } },
  group: { label: 'Group', blurb: 'A named set of parts, optionally moved as one.', fields: {
    parts: { t: 'parts', req: true }, xf: { t: 'obj', hint: '{ t: [f,g,h], r: [roll, pitch, yaw] degrees, s }' },
  } },
};
// Face fields a `poly` may carry, beyond role/sh/p. Anything else is a typo that would reach the
// renderer as a field nothing reads.
const FACE_FIELDS = new Set(['role', 'sh', 'p', 'tint', 'art', 'uv', 'defl', 'side', 'hinge', 'visor', 'deck', 'pk', 'two', 'mat', 'cen', 'part', 'paint', 'anim', 'when', 'whenNot']);

// ── The compiler ──────────────────────────────────────────────────────────────
const ng = (x) => (x === 0 ? x : -x);
const mv = (v) => [v[0], ng(v[1]), v[2]];
const _src = new WeakMap();
// For a compiled face list, the part path each face came from ('parts[3]', 'parts[5].parts[1]~L').
// Kept beside the faces rather than on them, so no field the renderer never reads rides every face.
export function meshSource(faces) { return _src.get(faces) || null; }

const shadeK = (S, k, n) => {
  let v = S.base + S.amp * (0.5 + 0.5 * Math.sin((k + 0.5) / n * Math.PI * 2));
  if (S.mul != null) v = v * S.mul;
  return v;
};
const LOFT_SHADE = { base: 0.6, amp: 0.36 };

function emitLoft(p, faces, detail = 1) {
  const n = p.sides, role = p.role || 'body', S = p.shade || LOFT_SHADE;
  // A station can drop out of the far LOD; regions are keyed by f, so the glass stays on its bay.
  const sts = p.stations.filter((s) => s.minDetail == null || detail >= s.minDetail);
  const ellipse = (p.section || 'ellipse') === 'ellipse';
  const E = p.exp || [1, 1, 1], UP = p.upper;
  const ring = (s) => {
    const o = [];
    if (ellipse) {
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; o.push(V(s.f, Math.cos(a) * s.rg, s.cz + Math.sin(a) * s.rv)); }
      return o;
    }
    let eg = E[0], et = E[1], eb = E[2];
    if (s.boxy != null) { const e = 1 - s.boxy * 0.55; eg = e; et = e; eb = e; }
    const bot = s.keel == null ? s.rvB : s.rvB + s.keel;
    for (let k = 0; k < n; k++) {
      if (s.upper && UP && k < UP.length) { o.push(V(s.f, UP[k][0] * s.rg, s.cz + UP[k][1] * s.rvT)); continue; }
      const a = k / n * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      const g = Math.sign(cs) * Math.pow(Math.abs(cs), eg) * s.rg;
      const h = sn >= 0 ? Math.pow(sn, et) * s.rvT : -Math.pow(-sn, eb) * bot;
      o.push(V(s.f, g, s.cz + h));
    }
    return o;
  };
  const R = sts.map(ring);
  const regionAt = (f, k) => {
    for (const rg of p.regions || []) {
      if (!rg.at.includes(f)) continue;
      if (rg.k === 'all' || rg.k == null || rg.k.includes(k)) return rg;
    }
    return null;
  };
  for (let i = 0; i < R.length - 1; i++) {
    const A = sts[i], B = sts[i + 1];
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const rg = regionAt(A.f, k);
      // A region that is `omit` is a HOLE: a door the hull has cut in it, filled by a part of its own.
      if (rg && rg.omit) continue;
      const fc = { role, sh: shadeK(S, k, n), p: [R[i][k], R[i][j], R[i + 1][j], R[i + 1][k]] };
      if (rg) {
        if (rg.role) fc.role = rg.role;
        if (rg.tint) fc.tint = rg.tint;
        if (rg.art) {
          const uA = (A.u ?? 0) * CP_TW, uB = (B.u ?? 0) * CP_TW, d = rg.uvDiv;
          fc.art = rg.art;
          fc.uv = [[uA, k / d * CP_TH], [uA, j / d * CP_TH], [uB, j / d * CP_TH], [uB, k / d * CP_TH]];
        }
        if (rg.paint) fc.paint = rg.paint;
      }
      faces.push(fc);
    }
  }
  const cap = (c, fore) => {
    if (!c) return;
    const r = fore ? R[0] : R[R.length - 1];
    if (c.kind === 'apex') {
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const fc = { role: c.role || role, sh: c.sh ?? shadeK(S, k, n), p: fore ? [c.at, r[k], r[j]] : [c.at, r[j], r[k]] };
        if (c.tint) fc.tint = c.tint;
        if (c.paint) fc.paint = c.paint;
        faces.push(fc);
      }
    } else {
      const fc = { role: c.role || role, sh: c.sh, p: c.reverse ? r.slice().reverse() : r };
      if (c.paint) fc.paint = c.paint;
      faces.push(fc);
    }
  };
  cap(p.capFore, true);
  cap(p.capAft, false);
}

function emitDrum(p, faces) {
  const n = p.n ?? 8, role = p.role || 'nacelle', S = p.sh || { base: 0.7 };
  const lo = [], hi = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, cx = p.f + Math.cos(a) * p.r, cy = p.g == null ? Math.sin(a) * p.r : p.g + Math.sin(a) * p.r;
    lo.push(V(cx, cy, p.z[0])); hi.push(V(cx, cy, p.z[1]));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ role, sh: S.alt ? S.base + S.alt * ((i + (S.phase || 0)) % 2) : S.base, p: [lo[i], lo[j], hi[j], hi[i]] });
  }
  if (p.top) faces.push({ role, sh: p.top.sh, p: hi });
  if (p.bottom) faces.push({ role, sh: p.bottom.sh, p: lo.slice().reverse() });
}

function emitNgon(p, faces) {
  const n = p.n ?? 8, o = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    o.push(V(p.f + Math.cos(a) * p.r, p.g == null ? Math.sin(a) * p.r : p.g + Math.sin(a) * p.r, p.h));
  }
  faces.push({ role: p.role || 'rotor', sh: p.sh ?? 0.65, p: o });
}

function emitCone(p, faces) {
  const n = p.n ?? 10, role = p.role || 'nacelle', S = p.shade || { base: 0.72, amp: 0.26 };
  const ring = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    ring.push(V(p.f, p.g == null ? Math.cos(a) * p.r : p.g + Math.cos(a) * p.r, p.h + Math.sin(a) * p.r));
  }
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    faces.push({ role, sh: shadeK(S, k, n), p: [V(p.apex[0], p.apex[1], p.apex[2]), ring[k], ring[j]] });
  }
}

function emitBlade(p, faces) {
  const role = p.role || 'fin', t = p.t;
  for (const s of [1, -1]) {
    const P = p.outline.map(([f, h]) => V(f, s * t, h)), sh = s > 0 ? p.sh[0] : p.sh[1];
    if (p.split) for (const sp of p.split) faces.push({ role, sh: sp.mul == null ? sh : sh * sp.mul, p: sp.k.map((i) => P[i]) });
    else faces.push({ role, sh, p: P });
  }
  for (const e of p.edges || []) {
    const A = p.outline[e.a], B = p.outline[e.b];
    faces.push({ role: e.role || role, sh: e.sh, p: [V(A[0], t, A[1]), V(B[0], t, B[1]), V(B[0], -t, B[1]), V(A[0], -t, A[1])] });
  }
}

function emitWing(p, faces, detail) {
  const role = p.role || 'wing', P = (g, x, sec) => wingPoint(p, g, x, sec);
  const NX = p.nx, XS = [];
  for (let i = 0; i < NX; i++) XS.push(0.5 * (1 - Math.cos(Math.PI * i / (NX - 1))));
  const q = (sh, a, b, c, d) => faces.push({ role, sh, p: [a, b, c, d] });
  for (let r = 0; r < p.ribs.length - 1; r++) {
    const gA = p.ribs[r], gB = p.ribs[r + 1];
    for (let i = 0; i < NX - 1; i++) {
      const x0 = XS[i], x1 = XS[i + 1];
      const lit = 0.80 + 0.18 * Math.sin(Math.PI * Math.min(1, (x0 + x1) / 2 * 1.6));
      q(lit, P(gA, x0, 1), P(gB, x0, 1), P(gB, x1, 1), P(gA, x1, 1));
      q(p.lower, P(gA, x1, 0), P(gB, x1, 0), P(gB, x0, 0), P(gA, x0, 0));
    }
  }
  const tipSh = p.tipSh ?? 0.66, SPAN = p.span;
  for (const s of [1, -1]) {
    for (let i = 0; i < NX - 1; i++)
      q(tipSh, P(s * SPAN, XS[i], 1), P(s * SPAN, XS[i + 1], 1), P(s * SPAN, XS[i + 1], 0), P(s * SPAN, XS[i], 0));
    const tf = p.tipFairing;
    if (tf && !(tf.minDetail != null && detail < tf.minDetail)) {
      faces.push({ role: tf.role || 'nacelle', sh: tf.sh, p: [P(s * SPAN, tf.x0, 1), P(s * SPAN, tf.x1, 1),
        V(P(s * SPAN, tf.x1, 0)[0], s * (SPAN + tf.out), P(s * SPAN, tf.x1, 0)[2] + tf.drop),
        V(P(s * SPAN, tf.x0, 0)[0], s * (SPAN + tf.out), P(s * SPAN, tf.x0, 0)[2] + tf.drop)] });
    }
    const ln = p.lens;
    if (ln && !(ln.minDetail != null && detail < ln.minDetail)) {
      const lp = P(s * SPAN, ln.x, 0.5);
      faces.push({ role: 'window', sh: ln.sh ?? 0.95, tint: s > 0 ? ln.tints[0] : ln.tints[1],
        p: [V(lp[0] - ln.hw, s * (SPAN + ln.out), lp[2] + ln.hh), V(lp[0] + ln.hw, s * (SPAN + ln.out), lp[2] + ln.hh),
            V(lp[0] + ln.hw, s * (SPAN + ln.out), lp[2] - ln.hh), V(lp[0] - ln.hw, s * (SPAN + ln.out), lp[2] - ln.hh)] });
    }
  }
}

const cpV = (v) => [v[0], v[1], v[2]];
function emitPoly(p, faces) {
  for (const f of p.faces) {
    const fc = {};
    for (const k of Object.keys(f)) {
      const v = f[k];
      if (k === 'p' || k === 'hinge') fc[k] = v.map(cpV);
      else if (k === 'uv') fc[k] = v.map((u) => [u[0], u[1]]);
      else fc[k] = Array.isArray(v) ? v.slice() : v;
    }
    if (fc.sh == null) fc.sh = derivedShade(fc.p);
    faces.push(fc);
  }
}
const mixRgb = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
// How far a facet has turned from the first colour of a sheen to the second: 0..1 off its normal.
function sheenT(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz) || 1;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * (-0.62 * nx + 0.28 * Math.abs(ny) + 0.73 * nz) / L));
}
// A face with no authored shade takes one from which way it points: crown-bright, belly-dark, the
// same falloff every loft uses. New models need no hand shades; ported ones keep theirs.
export function derivedShade(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz) || 1;
  return 0.62 + 0.34 * (nz / L);
}

// What a part looks like on the other side of the aircraft.
function mirrorSpec(p) {
  const q = { ...p };
  switch (p.kind) {
    case 'tube': case 'faired': q.pts = p.pts.map(mv); break;
    case 'strut': q.at = [p.at[0], ng(p.at[1])]; break;
    case 'wheel': case 'spat': q.at = mv(p.at); break;
    case 'panel': q.c = p.c.map(mv); break;
    case 'ctrl': q.le = p.le.map(mv); q.te = p.te.map(mv); q.side = -p.side; break;
    case 'missile': q.g = ng(p.g); break;
    case 'drum': case 'ngon': if (p.g != null) q.g = ng(p.g); break;
    case 'cone': if (p.g != null) q.g = ng(p.g); q.apex = mv(p.apex); break;
    case 'poly': q.faces = p.faces.map((f) => ({ ...f, p: f.p.map(mv), ...(f.hinge ? { hinge: f.hinge.map(mv) } : {}) })); break;
    case 'group': q.parts = p.parts.map(mirrorSpec); if (p.xf) q.xf = mirrorXf(p.xf); break;
    default: break;   // loft, wing, blade and ngon on the centreline are their own mirror image
  }
  delete q.left;
  // A hinge mirrors as a reflection: the pivot and the axis reflect, and the angle changes sign,
  // because a reflection reverses which way round a rotation goes. A wing that sweeps back on the
  // right sweeps back on the left too.
  // A slide reflects like any other vector.
  if (p.anim) {
    const a = p.anim;
    q.anim = { ...a };
    if (a.ang) Object.assign(q.anim, { pivot: mv(a.pivot), axis: mv(a.axis), ang: a.ang.map((d) => -d) });
    if (a.slide) q.anim.slide = mv(a.slide);
  }
  const L = p.left;
  if (!L) return q;
  if (L.replace) return L.replace;
  // The left side on its own channel (`left: { ch }`): two feet that paddle out of step.
  if (L.ch && q.anim) q.anim = { ...q.anim, ch: L.ch };
  if (p.kind === 'poly' && (L.faces || L.sh != null || L.winding)) {
    q.faces = q.faces.map((f, i) => {
      const o = { ...(L.faces?.[i] || {}) };
      if (L.sh != null && o.sh == null) o.sh = L.sh;
      if (L.winding && o.winding == null) o.winding = L.winding;
      const g = { ...f };
      if (o.sh != null) g.sh = o.sh;
      if (o.winding === 'reverse') g.p = g.p.slice().reverse();
      else if (o.winding === 'reverseKeepFirst') g.p = [g.p[0], ...g.p.slice(1).reverse()];
      return g;
    });
    return q;
  }
  for (const k of Object.keys(L)) if (k !== 'faces' && k !== 'replace' && k !== 'winding') q[k] = L[k];
  return q;
}
function mirrorXf(xf) {
  const o = { ...xf };
  if (xf.t) o.t = mv(xf.t);
  if (xf.r) o.r = [-xf.r[0], xf.r[1], -xf.r[2]];
  return o;
}

// A group's transform, applied to the faces its parts emitted: scale, then roll (about f), pitch
// (about g, nose up positive) and yaw (about h, nose right positive), then translate.
function applyXf(faces, from, xf) {
  const s = xf.s == null ? [1, 1, 1] : Array.isArray(xf.s) ? xf.s : [xf.s, xf.s, xf.s];
  const [rr, rp, ry] = (xf.r || [0, 0, 0]).map((d) => d * Math.PI / 180);
  const t = xf.t || [0, 0, 0];
  const cr = Math.cos(rr), sr = Math.sin(rr), cp = Math.cos(rp), sp = Math.sin(rp), cy = Math.cos(ry), sy = Math.sin(ry);
  const X = (v) => {
    let f = v[0] * s[0], g = v[1] * s[1], h = v[2] * s[2];
    [g, h] = [g * cr - h * sr, g * sr + h * cr];
    [f, h] = [f * cp - h * sp, f * sp + h * cp];
    [f, g] = [f * cy - g * sy, f * sy + g * cy];
    return [f + t[0], g + t[1], h + t[2]];
  };
  for (let i = from; i < faces.length; i++) {
    faces[i].p = faces[i].p.map(X);
    if (faces[i].hinge) faces[i].hinge = faces[i].hinge.map(X);
  }
}

function emitPart(p, faces, cx, path, srcs) {
  if (p.minDetail != null && cx.detail < p.minDetail) return;
  if (p.maxDetail != null && cx.detail > p.maxDetail) return;
  // A scheme's own geometry. A pair (`scheme` on the new skin, `schemeNot` on the one it replaces)
  // swaps a surface rather than laying one over another, which the painter's sort would fight.
  if (p.scheme != null && p.scheme !== cx.scheme) return;
  if (p.schemeNot != null && p.schemeNot === cx.scheme) return;
  if (cx.detail === 0 && p.lod0) p = { ...p, ...p.lod0 };
  const from = faces.length;
  switch (p.kind) {
    case 'loft': emitLoft(p, faces, cx.detail); break;
    case 'tube': for (let i = 0; i < p.pts.length - 1; i++) addTube(faces, p.pts[i], p.pts[i + 1], p.r, p.role ?? 'gear', p.sh ?? 0.55, p.sides ?? 6, !!p.caps); break;
    case 'strut': addStrut(faces, p.at[0], p.at[1], p.top, p.bot, p.r, p.sides ?? 6); break;
    case 'wheel': pushWheel(faces, p.at[0], p.at[1], p.at[2], p.r, p.hw, p.n ?? 12); break;
    case 'spat': addSpat(faces, p.at[0], p.at[1], p.at[2], p.s ?? 1); break;
    case 'faired': for (let i = 0; i < p.pts.length - 1; i++) addFaired(faces, p.pts[i], p.pts[i + 1], p.chord, p.th, p.role ?? 'strut', p.sh ?? 0.64); break;
    case 'panel': pushPanel(faces, p.role ?? 'wing', p.sh, p.c, p.th ?? 0, cx.detail); break;
    case 'ctrl': pushCtrlSurface(faces, p.role, p.side, p.sh, p.le[0], p.le[1], p.te[0], p.te[1], p.cf, p.axis ?? 'z', p.half ?? 0.014); break;
    case 'missile': addMissileBody(faces, p.f[0], p.f[1], p.g, p.z); break;
    case 'drum': emitDrum(p, faces); break;
    case 'ngon': emitNgon(p, faces); break;
    case 'cone': emitCone(p, faces); break;
    case 'blade': emitBlade(p, faces); break;
    case 'wing': emitWing(p, faces, cx.detail); break;
    case 'poly': emitPoly(p, faces); break;
    case 'group': {
      p.parts.forEach((c, i) => emitPart(c, faces, cx, path + '.parts[' + i + ']', srcs));
      if (p.xf) applyXf(faces, from, p.xf);
      break;
    }
    case 'mirror': {
      p.parts.forEach((c, i) => emitPart(c, faces, cx, path + '.parts[' + i + ']', srcs));
      p.parts.forEach((c, i) => emitPart(mirrorSpec(c), faces, cx, path + '.parts[' + i + ']~L', srcs));
      break;
    }
    default: throw new Error('unknown part kind ' + JSON.stringify(p.kind) + ' at ' + path);
  }
  // A moving part: every face it emitted carries the hinge, and the renderer swings it by the
  // channel's value at draw time (see animFacePoints). An inner part's own hinge wins.
  // ⚠ AND A PART INSIDE ANOTHER MOVING PART MOVES WITH IT: the inner motion is applied first and the
  // outer one after it (`then`), so a foot can swing forward as a ski on its own hip and still ride
  // its leg up into the bay. It used to be one or the other, the inner one winning.
  if (p.anim) for (let i = from; i < faces.length; i++) faces[i].anim = faces[i].anim ? chainAnim(faces[i].anim, p.anim) : p.anim;
  // A part that exists only while a channel is open (`when`): a room seen through a door.
  if (p.when) for (let i = from; i < faces.length; i++) if (!faces[i].when) faces[i].when = p.when;
  // And the opposite (`whenNot`): a part that is there UNLESS a channel is set, so it still draws in
  // every renderer that passes no channels at all (the hangar, a card). A foot that has snapped off.
  if (p.whenNot) for (let i = from; i < faces.length; i++) if (!faces[i].whenNot) faces[i].whenNot = p.whenNot;
  if (p.paint && cx.paints) {
    const slot = cx.paints[p.paint];
    if (slot) for (let i = from; i < faces.length; i++) if (faces[i].paint == null) faces[i].paint = p.paint;
  }
  for (let i = from; i < faces.length; i++) if (srcs[i] == null) srcs[i] = path;
}

// params → { faces, warnings }. `detail` 1 is the near mesh, 0 the far LOD.
//
// ⚠ A PAINT IS STAMPED AS A SLOT NAME AND RESOLVED ON THE WAY OUT. The face carries the slot's
// resolved object (colour and livery mapping), shared by every face of that slot, so faceBaseRgb
// needs no mesh lookup to colour it.
// `scheme` picks a paint job from `params.schemes`: a map of slot -> { rgb, alt } that overrides
// those slots' colours and leaves the rest alone. Unknown or absent: the paints as authored. It
// also picks the parts marked `scheme` / `schemeNot` (see emitPart).
// ⚠ A SCHEME ENTRY IS THE WHOLE COLOUR. An entry without an `alt` is a flat colour, not the new rgb
// sheened toward the stock slot's alt: that is how a white Quackhawk ruff grew orange quills.
export function compileMesh(params, { detail = 1, scheme = null } = {}) {
  const faces = [], srcs = [], warnings = [];
  const cx = { detail, scheme, paints: params.paints || null };
  (params.parts || []).forEach((p, i) => emitPart(p, faces, cx, 'parts[' + i + ']', srcs));
  if (params.paints) {
    const slots = {};
    const sch = (scheme && params.schemes && params.schemes[scheme]) || {};
    for (const [k, s0] of Object.entries(params.paints)) {
      const s = sch[k] ? { ...s0, alt: undefined, ...sch[k] } : s0;
      slots[k] = { name: k, rgb: s.rgb, livery: s.livery || 'base', ...(s.alt ? { alt: s.alt } : {}) };
    }
    for (const f of faces) if (typeof f.paint === 'string') {
      const slot = slots[f.paint];
      if (!slot) { warnings.push('no paint slot ' + JSON.stringify(f.paint)); delete f.paint; continue; }
      // An `alt` colour is a sheen that turns with the surface — iridescent feathers, a pearl coat.
      // The blend is taken from which way the facet FACES, at compile time, so it is identical in
      // every frame and every view: a colour that moved with the camera would shimmer, which the
      // renderer forbids by name (see camoHash in aircraft3d.js).
      f.paint = slot.alt ? { ...slot, rgb: mixRgb(slot.rgb, slot.alt, sheenT(f.p)) } : slot;
    }
  }
  if (params.scale != null && params.scale !== 1) {
    const S = params.scale, X = (v) => [v[0] * S, v[1] * S, v[2] * S];
    const scaledAnim = new Map();
    for (const fc of faces) {
      fc.p = fc.p.map(X); if (fc.hinge) fc.hinge = fc.hinge.map(X);
      if (fc.anim) {
        if (!scaledAnim.has(fc.anim)) {
          const a = { ...fc.anim };
          if (a.pivot) a.pivot = X(a.pivot);
          if (a.slide) a.slide = X(a.slide);
          if (a.then) { const sc = (t) => (t ? { ...t, pivot: t.pivot && X(t.pivot), slide: t.slide && X(t.slide), then: sc(t.then) } : t); a.then = sc(a.then); }
          scaledAnim.set(fc.anim, a);
        }
        fc.anim = scaledAnim.get(fc.anim);
      }
    }
  }
  _src.set(faces, srcs);
  return { faces, warnings };
}

// ── Moving parts ─────────────────────────────────────────────────────────────
// An inner motion followed by an outer one. Memoised on the pair so every face of a part shares one
// object (the scale pass below and the renderer both key on identity).
const _chain = new WeakMap();
function chainAnim(inner, outer) {
  let m = _chain.get(inner);
  if (!m) _chain.set(inner, (m = new WeakMap()));
  let c = m.get(outer);
  if (!c) m.set(outer, (c = { ...inner, then: inner.then ? chainAnim(inner.then, outer) : outer }));
  return c;
}
// A face stamped with `anim` swings about a hinge as its channel runs from 0 to 1: `ang[0]` degrees
// at 0 and `ang[1]` at 1, about `axis` through `pivot`. The authored geometry is the pose at angle 0,
// and `def` is the channel's value when nobody says otherwise (a contact, a hangar floor).
//
// ⚠ APPLIED AT DRAW TIME TO A COPY, never baked. The face list is memoised per class, so a pose baked
// into it would be the pose of whichever aircraft was drawn first — the gear tuck and the control
// surfaces work this way for the same reason.
// A slide (`slide`, the offset at 1) moves it instead, or as well: a mast that telescopes down into
// the back is a slide, and a door that swings and drops is both, the swing applied first.
// `span: [a, b]` is the stretch of the channel this part moves over, so parts on one channel can
// take turns: gear doors open over [0, 0.35] and the legs come down over [0.35, 1], which is a
// sequence out of one number. A reversed span runs the other way (a leg authored DOWN that slides UP
// as the gear channel falls). Outside the span the part rests at the nearer end.
// `back: [c, d]` brings it home again over a later stretch: a gear door opens over [0, 0.35], holds
// while the leg travels, and shuts behind it over [0.85, 1], so it is open only while the gear moves.
export function animFacePoints(face, anim) {
  const a = face.anim;
  if (a.then) return animFacePoints({ p: animFacePoints({ p: face.p, anim: { ...a, then: undefined } }, anim), anim: a.then }, anim);
  const raw = Math.max(0, Math.min(1, anim?.[a.ch] ?? a.def ?? 0));
  const ramp = (s) => Math.max(0, Math.min(1, (raw - s[0]) / ((s[1] - s[0]) || 1)));
  const t = (a.span ? ramp(a.span) : raw) * (a.back ? 1 - ramp(a.back) : 1);
  const sl = a.slide && t ? a.slide : null;
  const slid = (pts) => (sl ? pts.map((v) => [v[0] + sl[0] * t, v[1] + sl[1] * t, v[2] + sl[2] * t]) : pts);
  if (!a.ang) return slid(face.p);
  const deg = a.ang[0] + (a.ang[1] - a.ang[0]) * t;
  if (!deg) return slid(face.p);
  const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  const [x, y, z] = norm3(a.axis), P = a.pivot;
  const R = [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  return slid(face.p.map((v) => {
    const d0 = v[0] - P[0], d1 = v[1] - P[1], d2 = v[2] - P[2];
    return [P[0] + R[0] * d0 + R[1] * d1 + R[2] * d2, P[1] + R[3] * d0 + R[4] * d1 + R[5] * d2, P[2] + R[6] * d0 + R[7] * d1 + R[8] * d2];
  }));
}
// The channels a mesh moves, with their defaults: what the Modelshop draws a slider for.
export function meshChannels(params) {
  const out = {};
  // `gear` is the renderer's own channel (the landing gear), so it never gets a slider of its own.
  const walk = (parts) => { for (const p of parts || []) { if (p.anim && p.anim.ch !== 'gear') out[p.anim.ch] ??= p.anim.def ?? 0; walk(p.parts); if (p.left?.ch && p.anim) out[p.left.ch] ??= p.anim.def ?? 0; } };
  walk(params?.parts);
  for (const r of params?.rotors || []) {
    if (r.fold) out[r.fold.ch] ??= 0;
    if (r.run) out[r.run] ??= 0;
    if (r.slide) out[r.slide.ch] ??= 0;
  }
  return out;
}

// ── Rotors ───────────────────────────────────────────────────────────────────
// A rotor spec is data in the mesh file; this resolves it for drawRotorFX, with the mesh's own
// scale applied to position and radius exactly as the vertices get it.
//   plane 'h'    a horizontal main rotor           (U fore, V right)
//   plane 'side' a tail rotor on the boom's flank  (U fore, V up)
//   plane 'fore' a prop or pusher facing along f   (U up,   V right)
// `dir` −1 spins it the other way by negating V, not the phase, so the motion ghosts still trail.
// Three optional motions, each on a channel the mesh's moving parts can share:
//   fold  { ch, aft, spread, tuck }  stops the blades and swings them aft together; `tuck` moves the hub
//   run   '<channel>'                 stopped at `phase` at 0 on the channel, turning normally at 1
//   slide { ch, by: [f,g,h] }         moves the disc by `by` at 1, like a part's `anim.slide`
const PLANE_AXES = { h: [[1, 0, 0], [0, 1, 0]], side: [[1, 0, 0], [0, 0, 1]], fore: [[0, 0, 1], [0, 1, 0]] };
export function resolveRotors(params) {
  const rs = params?.rotors;
  if (!rs || !rs.length) return null;
  const S = params.scale ?? 1;
  return rs.map((r) => {
    const [U, V0] = PLANE_AXES[r.plane || 'h'];
    const Vx = r.dir === -1 ? [-V0[0], -V0[1], -V0[2]] : V0;
    return {
      at: S === 1 ? r.at : [r.at[0] * S, r.at[1] * S, r.at[2] * S],
      U, V: Vx, r: S === 1 ? r.r : r.r * S,
      blades: r.blades ?? 2, lead: r.lead ?? 0.85,
      spinMul: r.spinMul, phase: r.phase, hub: r.hub,
      fold: !r.fold ? null : (S === 1 || !r.fold.tuck) ? r.fold : { ...r.fold, tuck: r.fold.tuck.map((v) => v * S) },
      run: r.run || null,
      slide: !r.slide ? null : S === 1 ? r.slide : { ...r.slide, by: r.slide.by.map((v) => v * S) },
    };
  });
}

// ── Checking a file ───────────────────────────────────────────────────────────
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const PARAM_KEYS = new Set(['name', 'note', 'portedFrom', 'armedMesh', 'scale', 'classFacts', 'groundPitch', 'navLamps', 'lamps', 'hull', 'cabin', 'rotors', 'paints', 'schemes', 'parts']);

function checkPart(p, path, errors, warnings, inMirror) {
  if (!isPlain(p)) { errors.push(path + ' is not an object'); return; }
  const K = PART_KINDS[p.kind];
  if (!K) { errors.push(path + ': unknown kind ' + JSON.stringify(p.kind) + ' (one of ' + Object.keys(PART_KINDS).join(', ') + ')'); return; }
  for (const k of Object.keys(p)) if (!(k in K.fields) && !(k in COMMON_FIELDS)) errors.push(path + ' (' + p.kind + '): unknown field ' + JSON.stringify(k));
  for (const [k, d] of Object.entries(K.fields)) if (d.req && p[k] == null) errors.push(path + ' (' + p.kind + '): needs ' + k);
  for (const [k, d] of Object.entries(K.fields)) {
    const v = p[k];
    if (v == null) continue;
    if (d.t === 'num' && !isNum(v)) errors.push(path + '.' + k + ' must be a finite number');
    if (d.t === 'int' && !(Number.isInteger(v))) errors.push(path + '.' + k + ' must be a whole number');
    if (d.t === 'vec3' && !isVec(v, 3)) errors.push(path + '.' + k + ' must be [f, g, h]');
    if (d.t === 'vec2' && !isVec(v, 2)) errors.push(path + '.' + k + ' must be a pair of numbers');
    if (d.t === 'pts' && !(Array.isArray(v) && v.length >= 2 && v.every((x) => isVec(x, 3)))) errors.push(path + '.' + k + ' must be two or more [f, g, h] points');
    if (d.t === 'vec2list' && !(Array.isArray(v) && v.every((x) => isVec(x, 2)))) errors.push(path + '.' + k + ' must be a list of [a, b] pairs');
    if (d.t === 'enum' && !d.of.includes(v)) errors.push(path + '.' + k + ' must be one of ' + d.of.join(', '));
    if (d.t === 'role' && !KNOWN_ROLES.includes(v)) warnings.push(path + '.' + k + ': role ' + JSON.stringify(v) + ' is not one the renderer colours specially');
  }
  if (p.kind === 'loft') {
    if (!Array.isArray(p.stations) || p.stations.length < 2) errors.push(path + ': a loft needs two or more stations');
    else p.stations.forEach((s, i) => {
      const sp = path + '.stations[' + i + ']';
      if (!isPlain(s) || !isNum(s.f) || !isNum(s.rg) || !isNum(s.cz)) { errors.push(sp + ' needs f, rg and cz'); return; }
      if ((p.section || 'ellipse') === 'ellipse' && !isNum(s.rv)) errors.push(sp + ' needs rv (an ellipse station)');
      if (p.section === 'super' && (!isNum(s.rvT) || !isNum(s.rvB))) errors.push(sp + ' needs rvT and rvB (a super station)');
    });
  }
  if (p.kind === 'poly') {
    if (!Array.isArray(p.faces) || !p.faces.length) errors.push(path + ': a poly needs faces');
    else p.faces.forEach((f, i) => {
      const fp = path + '.faces[' + i + ']';
      if (!isPlain(f) || !Array.isArray(f.p) || f.p.length < 3 || !f.p.every((x) => isVec(x, 3))) { errors.push(fp + ' needs p: three or more [f, g, h] points'); return; }
      if (!f.role) errors.push(fp + ' needs a role');
      for (const k of Object.keys(f)) if (!FACE_FIELDS.has(k)) errors.push(fp + ': unknown face field ' + JSON.stringify(k));
    });
  }
  if (p.kind === 'mirror' && inMirror) errors.push(path + ': a mirror inside a mirror would draw four copies');
  if (inMirror && ['loft', 'wing', 'blade'].includes(p.kind)) warnings.push(path + ': a ' + p.kind + ' is symmetric already, so a mirror draws it twice');
  if (p.kind === 'mirror' || p.kind === 'group') {
    if (!Array.isArray(p.parts)) errors.push(path + ': needs parts');
    // A group that moves its parts (xf) takes them off the centreline, so a symmetric part inside it
    // is no longer its own mirror image and mirroring it is the point rather than a double draw.
    else p.parts.forEach((c, i) => checkPart(c, path + '.parts[' + i + ']', errors, warnings, p.kind === 'mirror' || (inMirror && !(p.kind === 'group' && p.xf))));
  }
}

// The whole check a file must pass before the bake or the Modelshop will write it: the shape of
// every part, then an actual compile at both details, because a structurally valid file can still
// build a NaN (a string where a number belongs reaches the arithmetic as NaN and throws nothing).
export function validateMesh(params, file = '<mesh>') {
  const errors = [], warnings = [];
  const at = (m) => file + ': ' + m;
  if (!isPlain(params)) return { errors: [at('params must be an object')], warnings };
  for (const k of Object.keys(params)) if (!PARAM_KEYS.has(k)) errors.push(at('unknown mesh field ' + JSON.stringify(k)));
  if (!Array.isArray(params.parts) || !params.parts.length) errors.push(at('a mesh needs parts'));
  else {
    const e = [], w = [];
    params.parts.forEach((p, i) => checkPart(p, 'parts[' + i + ']', e, w, false));
    errors.push(...e.map(at)); warnings.push(...w.map(at));
  }
  if (params.scale != null && !(isNum(params.scale) && params.scale > 0)) errors.push(at('scale must be a positive number'));
  // The cabin: what the interior (client/shared/interior-drake.js) is the inside of. It NAMES parts
  // rather than restating their numbers, so the room is lofted off the head the exterior draws and
  // its windows are the exterior's own eye glass: one statement, read by both.
  if (params.cabin != null) {
    const c = params.cabin;
    const has = (nm) => (params.parts || []).some(function walk(p) { return !!p && (p.name === nm || (p.parts || []).some(walk)); });
    if (!isPlain(c)) errors.push(at('cabin must be an object'));
    else {
      if (!(isNum(c.mPerUnit) && c.mPerUnit > 0)) errors.push(at('cabin.mPerUnit must be a positive number (metres per model unit)'));
      if (!isVec(c.pilotEye, 3)) errors.push(at('cabin.pilotEye must be [f, g, h]: where the pilot\'s eye is, in model units'));
      for (const k of ['head', 'eye']) if (typeof c[k] !== 'string' || !has(c[k])) errors.push(at('cabin.' + k + ' must name a part in this mesh'));
      for (const k of ['floor', 'back', 'wall']) if (c[k] != null && !isNum(c[k])) errors.push(at('cabin.' + k + ' must be a number'));
    }
  }
  if (params.rotors != null) {
    if (!Array.isArray(params.rotors)) errors.push(at('rotors must be a list'));
    else params.rotors.forEach((r, i) => {
      if (!isPlain(r) || !isVec(r.at, 3) || !isNum(r.r)) errors.push(at('rotors[' + i + '] needs at [f, g, h] and r'));
      else if (r.plane != null && !PLANE_AXES[r.plane]) errors.push(at('rotors[' + i + '].plane must be h, side or fore'));
      // A channel named wrong is a rotor that silently never moves, so both are checked for shape.
      if (isPlain(r) && r.run != null && (typeof r.run !== 'string' || !r.run)) errors.push(at('rotors[' + i + '].run must name a channel'));
      if (isPlain(r) && r.slide != null && !(isPlain(r.slide) && typeof r.slide.ch === 'string' && r.slide.ch && isVec(r.slide.by, 3))) errors.push(at('rotors[' + i + '].slide must be { ch, by: [f, g, h] }'));
      if (isPlain(r) && r.run != null && r.fold != null) errors.push(at('rotors[' + i + ']: run and fold both decide where a stopped blade rests; use one'));
    });
  }
  if (params.paints != null) {
    if (!isPlain(params.paints)) errors.push(at('paints must be an object of slots'));
    else for (const [k, s] of Object.entries(params.paints)) {
      if (!isPlain(s) || !isVec(s.rgb, 3)) errors.push(at('paints.' + k + ' needs rgb [r, g, b]'));
      if (s && s.livery != null && !['base', 'trim', 'fixed'].includes(s.livery)) errors.push(at('paints.' + k + '.livery must be base, trim or fixed'));
    }
  }
  // A part gated on a scheme nobody has is a part that silently never draws (or always does).
  (function walk(list, path) {
    (list || []).forEach((p, i) => {
      if (!isPlain(p)) return;
      for (const k of ['scheme', 'schemeNot']) if (p[k] != null && !(params.schemes && isPlain(params.schemes[p[k]])))
        errors.push(at(path + '[' + i + '].' + k + ' names no scheme in params.schemes: ' + JSON.stringify(p[k])));
      if (p.parts) walk(p.parts, path + '[' + i + '].parts');
    });
  })(params.parts, 'parts');
  if (errors.length) return { errors, warnings };
  for (const detail of [0, 1]) {
    let faces;
    try { faces = compileMesh(params, { detail }).faces; } catch (e) { errors.push(at('does not compile at detail ' + detail + ': ' + e.message)); continue; }
    const st = meshStats(faces);
    if (st.nonFinite) errors.push(at(st.nonFinite + ' non-finite vertex coordinates at detail ' + detail + ' (a string where a number belongs?)'));
    if (st.degenerate) warnings.push(at(st.degenerate + ' faces with fewer than 3 points at detail ' + detail));
  }
  return { errors, warnings };
}

// ── Measuring a mesh ──────────────────────────────────────────────────────────
// Counts, extent, what it is made of, and how symmetric it is. `symmetry` is the fraction of
// vertices whose mirror image (f, −g, h) is also a vertex, to a hair: 1.0 for a mesh that is the
// same on both sides.
export function meshStats(faces) {
  let verts = 0, nonFinite = 0, degenerate = 0, ngons = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const roles = {}, paints = {};
  const key = (f, g, h) => Math.round(f * 1e4) + ',' + Math.round(g * 1e4) + ',' + Math.round(h * 1e4);
  const seen = new Set(), all = [];
  for (const fc of faces) {
    roles[fc.role] = (roles[fc.role] || 0) + 1;
    if (fc.paint) { const n = typeof fc.paint === 'string' ? fc.paint : (fc.paint.name || 'slot'); paints[n] = (paints[n] || 0) + 1; }
    if (!fc.p || fc.p.length < 3) { degenerate++; continue; }
    if (fc.p.length > 4) ngons++;
    for (const v of fc.p) {
      verts++;
      if (!(Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]))) { nonFinite++; continue; }
      for (let i = 0; i < 3; i++) { if (v[i] < lo[i]) lo[i] = v[i]; if (v[i] > hi[i]) hi[i] = v[i]; }
      const k = key(v[0], v[1], v[2]);
      if (!seen.has(k)) { seen.add(k); all.push(v); }
    }
  }
  let mirrored = 0;
  for (const v of all) if (seen.has(key(v[0], -v[1], v[2]))) mirrored++;
  return { faces: faces.length, verts, unique: all.length, nonFinite, degenerate, ngons,
    bounds: { lo, hi }, roles, paints, symmetry: all.length ? mirrored / all.length : 1 };
}

// ── Writing a file ────────────────────────────────────────────────────────────
// A mesh file is edited by hand, by Claude and by the Modelshop, so all three have to write the
// SAME bytes or every save becomes a whole-file diff. This is that one format: a part's `kind` and
// `name` first and then its fields in schema order, a point on one line, a short object on one
// line, and everything else two-space indented. The order is fixed rather than sorted because
// `canonicalJson` would put `kind` after `faces`, which is the first thing you look for.
const KEY_ORDER = {
  doc: ['id', 'kind', 'params'],
  params: ['name', 'note', 'portedFrom', 'armedMesh', 'scale', 'classFacts', 'groundPitch', 'navLamps', 'lamps', 'hull', 'cabin', 'rotors', 'paints', 'schemes', 'parts'],
  cabin: ['note', 'mPerUnit', 'head', 'eye', 'pilotEye', 'floor', 'back', 'wall'],
  station: ['f', 'rg', 'rv', 'rvT', 'rvB', 'cz', 'keel', 'boxy', 'upper', 'u', 'minDetail', 'note'],
  face: ['role', 'sh', 'p'],
  rotor: ['at', 'plane', 'r', 'blades', 'lead', 'dir', 'spinMul', 'phase', 'hub', 'fold', 'run', 'slide'],
  region: ['at', 'k', 'omit', 'role', 'tint', 'art', 'uvDiv', 'paint'],
  cap: ['kind', 'at', 'sh', 'role', 'tint', 'reverse', 'paint'],
  shade: ['base', 'amp', 'mul', 'alt', 'phase'],
  paint: ['rgb', 'alt', 'livery', 'note'],
};
const ARRAY_OF = { parts: 'part', stations: 'station', faces: 'face', rotors: 'rotor', regions: 'region' };
const OBJ_CTX = { params: 'params', cabin: 'cabin', capFore: 'cap', capAft: 'cap', shade: 'shade', sh: 'shade' };
function orderedKeys(o, ctx) {
  let pref;
  if (ctx === 'part' && o.kind && PART_KINDS[o.kind]) pref = ['kind', 'name', 'note', ...Object.keys(PART_KINDS[o.kind].fields), 'paint', 'minDetail', 'maxDetail', 'lod0', 'left'];
  else pref = KEY_ORDER[ctx] || [];
  const ks = Object.keys(o);
  return [...pref.filter((k) => ks.includes(k)), ...ks.filter((k) => !pref.includes(k)).sort()];
}
const childCtx = (ctx, k) => (ctx === 'paints' ? 'paint' : k === 'paints' ? 'paints' : ARRAY_OF[k] ? 'list:' + ARRAY_OF[k] : OBJ_CTX[k] || 'obj');
function fmt(v, ctx, ind) {
  // ⚠ −0 IS WRITTEN AS -0. JSON.stringify writes it as 0 and JSON.parse reads '-0' back as −0, so the
  // sign survives a round trip only if the writer keeps it — and a frozen builder does emit −0.
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : JSON.stringify(v);
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const pad = '  '.repeat(ind), pad1 = '  '.repeat(ind + 1);
  if (Array.isArray(v)) {
    const ec = ctx.startsWith('list:') ? ctx.slice(5) : 'obj';
    const items = v.map((x) => fmt(x, ec, ind + 1));
    const one = '[' + items.join(', ') + ']';
    if (!items.some((s) => s.includes('\n')) && (one.length <= 110 || v.every((x) => typeof x !== 'object' || x === null))) return one;
    return '[\n' + items.map((s) => pad1 + s).join(',\n') + '\n' + pad + ']';
  }
  const keys = orderedKeys(v, ctx);
  const items = keys.map((k) => JSON.stringify(k) + ': ' + fmt(v[k], childCtx(ctx, k), ind + 1));
  const one = '{ ' + items.join(', ') + ' }';
  if (ctx !== 'doc' && ctx !== 'params' && ctx !== 'part' && !items.some((s) => s.includes('\n')) && one.length <= 150) return one;
  if (ctx === 'part' && !items.some((s) => s.includes('\n')) && one.length <= 150) return one;
  return '{\n' + items.map((s) => pad1 + s).join(',\n') + '\n' + pad + '}';
}
export function formatMesh(doc) { return fmt(doc, 'doc', 0) + '\n'; }

// ── Holding two meshes against each other ─────────────────────────────────────
// Every number by its exact value, −0 kept; keys sorted, so key ORDER is not identity but the key
// SET is. `JSON.stringify` will not do: it writes −0 as 0.
export function canon(v) {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return v === undefined ? 'u' : JSON.stringify(v);
}
// The first place two face lists differ, or null if they are the same mesh.
export function meshDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const A = a[i], B = b[i];
    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
    for (const k of [...keys].sort()) {
      const ca = canon(A[k]), cb = canon(B[k]);
      if (ca !== cb) return { index: i, field: k, a: A[k], b: B[k] };
    }
  }
  if (a.length !== b.length) return { index: n, field: 'length', a: a.length, b: b.length };
  return null;
}
