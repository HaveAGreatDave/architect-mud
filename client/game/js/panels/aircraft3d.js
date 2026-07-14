// AIRCRAFT-3D — the single source of truth for what an aircraft looks like in 3D.
//
// One low-poly, class-distinct model per flight class (prop/ultralight/gunship/
// heavy/heli + wreck), expressed as a list of faces in the craft's own frame
// (f = forward/nose+, g = right+, h = up+), each tagged with a role (body/wing/
// stab/fin/nacelle/glass/rotor) and a baked shade. TWO renderers consume it:
//
//   • windshield.js — projects the faces through the Mode-7 cockpit camera to draw
//     air-to-air PvP contacts out the front window (oriented by their heading/bank/
//     pitch).
//   • hangar.js     — spins the same model on a fixed ¾ "hero" turntable so your
//     parked aircraft read as the very craft you fly.
//
// Both paint the faces in the craft's LIVERY (base/trim + finish sheen + pattern
// accents) via the shared palette helpers below, so the two views can never drift
// apart. Models are normalised to ~|f|≤1.15, wing tips at g≈±1 so the windshield's
// per-class CONTACT_SIZE scale keeps working unchanged.

const clampN = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const hex2rgb = (h) => { if (typeof h !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(h)) return null; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const shadeRgb = (c, m) => `rgb(${clampN(c[0] * m, 0, 255) | 0},${clampN(c[1] * m, 0, 255) | 0},${clampN(c[2] * m, 0, 255) | 0})`;
const FINISH_MUL = { gloss: 1.06, satin: 1.0, matte: 0.88, weathered: 0.82 };

// ── Livery → colour ────────────────────────────────────────────────────────────
// Resolve a livery into a working palette (splinter camo drags the base toward drab),
// then answer per-face whether it wears the trim colour and what raw rgb it takes.
export function liveryPalette(lv) {
  lv = lv || {};
  let base = hex2rgb(lv.base) || [90, 95, 102];
  const trim = hex2rgb(lv.trim) || [138, 144, 153];
  const pat = lv.pattern || 'bare';
  if (pat === 'splinter') base = mix3(base, [60, 64, 44], 0.35);
  const ground = hex2rgb(lv.ground) || JAZZ_GROUND;   // jazz undercoat (the "cup paper" the splatter pops against)
  return { base, trim, ground, fmul: FINISH_MUL[lv.finish] ?? 1.0, pat };
}
// Structural accents that ALWAYS wear the trim colour, whatever the pattern.
const TRIM_ROLE = new Set(['fin', 'rudder', 'nacelle', 'rotor']);
// Hull roles the exterior pattern paints across (fuselage, flying surfaces + their
// control surfaces, which inherit their parent panel's colour by sitting in its space).
const PATTERN_ROLE = new Set(['body', 'wing', 'aileron', 'flap', 'stab', 'elevator']);
const STAB_ROLE = new Set(['stab', 'elevator']);
// Closed-hull roles that wrap the fuselage/canopy centred on the model origin: safe to
// backface-cull (their far side is genuinely hidden). Kept OUT: wings/stabs/fins/struts/
// nacelles/gear — thin or off-axis surfaces where an outward-from-origin test is unreliable.
const CULL_ROLE = new Set(['body', 'glass', 'window']);
// Centroid of a facet in the craft frame [f = fore+, g = right+, h = up+].
function faceCentroid(pts) {
  let f = 0, g = 0, h = 0; for (const v of pts) { f += v[0]; g += v[1]; h += v[2]; }
  const n = pts.length || 1; return [f / n, g / n, h / n];
}
// Deterministic 0..1 hash of a (coarsely-quantised) point: clusters adjacent facets into
// camo blotches, and stays frame-stable (no Math.random, so the paint never shimmers).
function camoHash(a, b, c) { const x = Math.sin(a * 12.9898 + b * 4.1414 + c * 78.233) * 43758.5453; return x - Math.floor(x); }
// The exterior PATTERN is rendered procedurally: for each hull facet we pick base vs trim
// from that facet's position in the craft frame, so the model's own faceting resolves into a
// real dorsal racing stripe, two-tone splinter blotches, raked hazard bands, or a clean
// beltline split. Because every renderer colours through faceBaseRgb, the pattern can never
// drift between the hangar and the sky.
function faceWearsTrim(face, pat) {
  if (TRIM_ROLE.has(face.role)) return true;
  if (!PATTERN_ROLE.has(face.role)) return false;
  const [f, g, h] = faceCentroid(face.p);
  const top = h / (Math.hypot(g, h) || 1);            // +1 = dorsal spine, 0 = flank, -1 = belly
  switch (pat) {
    case 'twotone':  return top < -0.15;               // clean top(base)/bottom(trim) beltline split
    case 'stripes':  return STAB_ROLE.has(face.role) || top > 0.6;   // painted tailplane + a spine racing stripe nose->tail
    case 'hazard': { const band = Math.floor((f - Math.abs(g) * 0.8) * 5); return ((band % 2) + 2) % 2 === 0; }   // raked warning bands
    case 'splinter': return camoHash(Math.round(f * 4.5), Math.round(g * 6), Math.round(h * 6)) > 0.55;   // two-tone blotch camo (g/h run finer: the fuselage is narrow)
    default:         return false;                     // bare / solid: one hull colour
  }
}
// Raw (pre-shade) rgb for a facet. Glass/windows read as dark panes; gear/struts/gun/
// intakes as dark structural metal, all independent of the livery colour.
export function faceBaseRgb(face, pal) {
  const role = face.role;
  if (role === 'glass' || role === 'window') return [14, 26, 36];
  if (role === 'strut' || role === 'gear' || role === 'gun') return [44, 48, 54];
  if (pal.pat === 'jazz' && JAZZ_ROLE.has(role)) return pal.ground || JAZZ_GROUND;   // chosen undercoat; overlayJazz paints the splatter on top
  return faceWearsTrim(face, pal.pat) ? pal.trim : pal.base;
}

// ── Geometry ────────────────────────────────────────────────────────────────────
const V = (f, g, h) => [f, g, h];

// A parametric fixed-wing: a lozenge fuselage (nose tip → mid ring → tail tip), high-
// or low-set swept wings with dihedral, tailplane, one or two vertical fins, engine
// nacelles (underwing tubes OR rear pods), and a canopy. Optional class-signature parts
// — strut braces, fixed gear, prop spinners, nose gun, cabin windows, engine pylons —
// give each class its real-world silhouette (Cessna / Twin Otter / An-124 / A-10).
function buildFixedWing(p, detail = 1) {
  const faces = [];
  // Parametric fuselage: cross-section rings (an N-gon in the g-h plane, scaled by the
  // craft's fr/fv half-widths) sampled at several stations nose→tail and skinned with
  // quads. detail 1 = an 8-sided, rounded-ogive body (~4× the triangles — noticeably
  // rounder both across and along); detail 0 = the original 4-sided bipyramid (two cones
  // off a diamond mid-ring), used for distant/LOD renders where the extra facets are
  // sub-pixel. The tips collapse to the axis (rad→0), so the end quads fold into cap fans.
  const sides = detail ? 12 : 4;
  const stations = detail
    ? [p.noseF, p.noseF * 0.66, p.noseF * 0.33, 0, p.tailF * 0.35, p.tailF * 0.7, p.tailF]
    : [p.noseF, 0, p.tailF];
  const czAt = (f) => f >= 0 ? (p.noseZ ?? 0.02) * (f / p.noseF) : (p.tailUp ?? 0.05) * (f / p.tailF);   // centreline: 0 at mid, noseZ at the nose tip (negative = a drooped 'anteater' nose like the Twin Otter), tailUp at the tail (a cargo boat-tail upsweeps more)
  // Radius profile 1 (mid) → 0 (tips). A `bodyTube` plateau holds NEAR-FULL width across the
  // central span before tapering (a transport is a long constant-section tube; a light single
  // tapers straight from the cabin). The NOSE then rounds off as a blunt superellipse cowl
  // (p.noseBlunt), the TAIL as a clean taper. detail 0 stays a straight cone → coarse LOD unchanged.
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0;
  const radAt = (f) => {
    let u = Math.min(1, Math.abs(f >= 0 ? f / p.noseF : f / p.tailF));
    if (!detail) return 1 - u;
    u = u <= tube ? 0 : (u - tube) / (1 - tube);   // hold full width through the tube, then taper over the rest
    // Nose: the superellipse rounds it, and p.noseCowl floors the front radius so it does NOT
    // collapse to a point — the fuselage ends in a blunt cowl face (capped below). Tail tapers to 0.
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  // Cross-section: an ellipse (fr wide × fv tall) morphed toward a rounded RECTANGLE by p.boxy
  // (0 = round, →1 = slab-sided) — a Twin Otter is a flat-sided box, an An-124 near circular.
  // At the 4 cardinal points |cos|/|sin| are 0 or 1, so a 4-sided coarse ring is unaffected →
  // the LOD-0 silhouette is identical regardless of boxy.
  const shapeExp = 1 - (p.boxy || 0) * 0.55;
  const ring = (f) => {
    const r = radAt(f), cz = czAt(f), out = [];
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const g = Math.sign(ca) * Math.pow(Math.abs(ca), shapeExp) * p.fr * r;
      const h = Math.sign(sa) * Math.pow(Math.abs(sa), shapeExp) * p.fv * r;
      out.push(V(f, g, cz + h));
    }
    return out;
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const A = ring(stations[i]), B = ring(stations[i + 1]);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const sh = 0.62 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright (~0.98) → sides mid → bottom dark (~0.62)
      faces.push({ role: 'body', sh, p: [A[k], A[k2], B[k2], B[k]] });
    }
  }
  // Blunt cowl: cap the nose ring with a flat rounded front face (it no longer collapses to a
  // point when p.noseCowl is set) — a Cessna's cowl is a rounded box with the spinner poking out.
  if (detail && (p.noseCowl || 0) > 0.01) faces.push({ role: 'body', sh: 0.9, p: ring(stations[0]) });
  const wH = p.wingH || 0;   // wing vertical set: high (+) rides the fuselage top, low (−) the belly
  // Wings (high/low set + optional dihedral), swept. At full detail they get real
  // thickness (top/bottom skins + leading/trailing/tip edges) instead of a paper quad.
  for (const s of [1, -1]) {
    pushPanel(faces, 'wing', 0.82, [
      V(p.wRootF, s * p.fr * 0.7, wH - 0.01), V(p.wTipF, s * p.span, wH + p.dih),
      V(p.wTipB, s * p.span, wH + p.dih), V(p.wRootB, s * p.fr * 0.7, wH - 0.01)], 0.028, detail);
    if (detail) addWingSurfaces(faces, p, s, wH);   // hinged flap + aileron on the trailing edge (full mesh only)
  }
  // Wing LIFT STRUT (Cessna / Twin Otter): a single SLIM streamlined member from the lower
  // fuselage longeron out to ~mid-span under the wing — a thin diagonal, not a wide strap.
  if (p.struts) {
    const sw = 0.022;                         // strut half-chord (fore-aft) — a slim member
    for (const s of [1, -1]) {
      const bx = 0.05, tx = 0.09;             // f at the fuselage / wing attach (slight forward rake)
      faces.push({ role: 'strut', sh: 0.62, p: [
        V(bx + sw, s * p.fr * 0.95, -p.fv * 0.55), V(tx + sw, s * p.span * 0.5, wH - 0.02),
        V(tx - sw, s * p.span * 0.5, wH - 0.02), V(bx - sw, s * p.fr * 0.95, -p.fv * 0.55)] });
    }
  }
  // Horizontal stabiliser (also thickened at full detail).
  for (const s of [1, -1]) {
    pushPanel(faces, 'stab', 0.72, [
      V(p.hF, s * p.fr * 0.5, 0.04), V(p.hTipF, s * p.hSpan, 0.05),
      V(p.hTipB, s * p.hSpan, 0.05), V(p.hB, s * p.fr * 0.5, 0.04)], 0.02, detail);
    if (detail) addStabSurface(faces, p, s);   // hinged elevator on the tailplane (full mesh only)
  }
  // Vertical fin(s).
  for (const fg of (p.fins || [0])) {
    faces.push({ role: 'fin', sh: 0.9, p: [V(p.finF0, fg, 0.05), V(p.finF1, fg, p.finH), V(p.finF2, fg, 0.06)] });
    if (detail) addFinSurface(faces, p, fg);   // hinged rudder on the fin trailing edge (full mesh only)
  }
  // Engine nacelles — underwing tubes (from `engines` lateral stations) or fatter rear
  // pods (from `podEngines` full [f,g,h] stations, e.g. the A-10's high tail-mounts).
  const nacStations = p.podEngines || (p.engines || []).map(g => [p.nacF, g, p.nacH]);
  for (const [nf, g, hc] of nacStations) {
    const nr = p.nacR || (p.podEngines ? 0.085 : 0.05);   // fat rear pods (A-10's TF34s); p.nacR sizes big underwing turbofans (An-124 D-18T)
    const half = 0.17 + (nr - 0.05) * 1.3;                // fatter engines run longer too, so the tube stays proportioned
    const rT = V(nf, g, hc + nr), rR = V(nf, g + nr, hc), rB = V(nf, g, hc - nr), rL = V(nf, g - nr, hc);
    const fr = V(nf + half, g, hc), bk = V(nf - half - 0.01, g, hc);
    for (const [a, b] of [[rT, rR], [rR, rB], [rB, rL], [rL, rT]]) {
      faces.push({ role: 'nacelle', sh: 0.8, p: [fr, a, b] });
      faces.push({ role: 'nacelle', sh: 0.7, p: [bk, b, a] });
    }
    faces.push({ role: 'window', sh: 0.9, p: [rT, rR, rB, rL] });   // dark engine intake
    if (p.pylons) faces.push({ role: 'strut', sh: 0.7, p: [        // pylon slung under the high wing
      V(nf + 0.02, g + 0.015, hc + nr), V(nf + 0.02, g + 0.015, wH),
      V(nf - 0.02, g - 0.015, wH), V(nf - 0.02, g - 0.015, hc + nr)] });
    if (p.podPylon) { const gi = Math.sign(g) * 0.06; faces.push({ role: 'strut', sh: 0.72, p: [   // A-10: rear pod on a stub pylon inboard to the fuselage
      V(nf + 0.09, g, hc - nr * 0.6), V(nf + 0.09, gi, hc - nr - 0.04),
      V(nf - 0.09, gi, hc - nr - 0.04), V(nf - 0.09, g, hc - nr * 0.6)] }); }
    if (p.prop === 'wing') addSpinner(faces, nf + 0.17, g, hc);   // Twin Otter wing turboprops
  }
  if (p.prop === 'nose') addSpinner(faces, p.noseF, 0, 0.02, 0.5);   // Cessna single nose prop — a SMALL GA spinner
  // Under-wing cannon (gunship): a small forward-firing gun pod slung beneath each
  // wing on a short pylon, its barrel poking ahead of the leading edge. A thin
  // square-section tube — physically joined to the wing, not floating.
  if (p.wingGuns) {
    const gauge = 0.40, r = 0.018, gz = wH - 0.075, gf = 0.34, gk = 0.00;
    for (const s of [1, -1]) {
      const g = s * gauge;
      const ring = (f) => [V(f, g + r, gz + r), V(f, g + r, gz - r), V(f, g - r, gz - r), V(f, g - r, gz + r)];
      const Fr = ring(gf), Bk = ring(gk);
      for (let i = 0; i < 4; i++) faces.push({ role: 'gun', sh: 0.66 + i * 0.07, p: [Fr[i], Fr[(i + 1) % 4], Bk[(i + 1) % 4], Bk[i]] });
      faces.push({ role: 'gun', sh: 0.95, p: Fr });   // muzzle face
      faces.push({ role: 'strut', sh: 0.6, p: [       // pylon up to the wing underside
        V(0.06, g + 0.012, gz + r), V(0.06, g + 0.012, wH - 0.01),
        V(-0.02, g - 0.012, wH - 0.01), V(-0.02, g - 0.012, gz + r)] });
    }
  }
  // Landing gear: An-124 multi-wheel bogies for a heavy, else a fixed tricycle (Cessna / Twin
  // Otter): two mains + a nose leg, each a strut + wheel.
  if (p.heavyGear) addHeavyGear(faces, p);
  else if (p.gearPods) {
    // A-10: bulky body-coloured main-gear fairing pods (the Warthog's signature heavy
    // gear) under the wings + a stout nose leg — never the thin tricycle sticks.
    const wz = -p.fv - 0.10;
    addGearPod(faces, 0.08, p.fr + 0.10, wz);
    addGearPod(faces, 0.08, -(p.fr + 0.10), wz);
    addGear(faces, p.noseF * 0.55, 0, wz + 0.04, 0.68);
  }
  else if (p.gear) {
    const wz = -p.fv - 0.08;
    if (p.gearStyle === 'spring') addCessnaGear(faces, p, wz);        // Cessna leaf-spring + spats
    else if (p.gearStyle === 'oleo') addOtterGear(faces, p, wz);      // Twin Otter stout oleo + fat tyres
    else { addGear(faces, 0.10, p.fr + 0.06, wz); addGear(faces, 0.10, -(p.fr + 0.06), wz); addGear(faces, p.noseF * 0.55, 0, wz + 0.02); }
  }
  // Cabin window row along the upper fuselage sides (transports: Twin Otter / An-124).
  if (p.windows) {
    for (const s of [1, -1]) {
      for (let i = 0; i < p.windows; i++) {
        const wf = 0.42 - i * (0.95 / p.windows), wy = s * p.fr * 1.02, wq = 0.045, wc = p.fv * 0.34;
        faces.push({ role: 'window', sh: 0.86, p: [
          V(wf + wq, wy, wc + wq), V(wf + wq, wy, wc - wq), V(wf - wq, wy, wc - wq), V(wf - wq, wy, wc + wq)] });
      }
    }
  }
  // Cockpit canopy — a faceted transparent bubble mounted on the fuselage crown. Built from
  // upper-half elliptical rings sampled fore→aft and skinned into quads; the lateral facets give
  // the windscreen its real angled panes (more triangles = more accurate curved glass). The base
  // is sunk a touch into the hull so it reads as mounted, not floating. Per-class `canopy` params
  // shape it: a tall narrow fighter bubble (Reaper), a wide forward flight-deck hump (Leviathan),
  // a greenhouse cabin (Mayfly), a low wide windscreen (Mule). Skipped on the coarse LOD.
  if (detail && p.canopy) {
    const cp = p.canopy, segs = cp.segs || 5, arc = cp.arc || 3;
    const crown = (f) => czAt(f) + p.fv * radAt(f) - (cp.sink ?? 0.015);   // fuselage top at station f, sunk a touch
    // Fore→aft height profile: a windowed sine — a raked windscreen at the front (cp.front),
    // full through the middle, tapering to a faired tail (cp.tail). t: 0 = front, 1 = rear.
    const prof = (t) => Math.sin(Math.PI * ((cp.front ?? 0.12) + (1 - (cp.front ?? 0.12) - (cp.tail ?? 0.04)) * t));
    const ringAt = (t) => {
      const f = cp.f0 + (cp.f1 - cp.f0) * t, s = prof(t), z0 = crown(f), out = [];
      for (let k = 0; k <= arc; k++) { const a = Math.PI * k / arc; out.push(V(f, Math.cos(a) * cp.w * s, z0 + Math.sin(a) * cp.h * s)); }
      return out;   // k: 0 = starboard base → over the crown → arc = port base
    };
    let A = ringAt(0);
    for (let i = 1; i <= segs; i++) {
      const B = ringAt(i / segs);
      for (let k = 0; k < arc; k++) {
        const sh = 0.66 + 0.30 * Math.sin(Math.PI * (k + 0.5) / arc);   // crown pane brightest, side panes darker
        faces.push({ role: 'glass', sh, p: [A[k], A[k + 1], B[k + 1], B[k]] });
      }
      A = B;
    }
    // Cap the fore + aft rings so the greenhouse reads as a CLOSED bubble — a raked windscreen up
    // front and a faired rear window — instead of an open-ended tube. The backface cull auto-orients
    // each cap's normal from the model centre, so the flat end faces don't need a fixed winding.
    faces.push({ role: 'glass', sh: 0.72, p: ringAt(0) });   // front windscreen
    faces.push({ role: 'glass', sh: 0.50, p: ringAt(1) });   // rear window
  }
  return faces;
}

// A flat lifting panel (wing / stabiliser) given by 4 corners in order
// [rootLE, tipLE, tipTE, rootTE]. detail 0 (or no thickness) → the original single quad;
// detail 1 → a thin box: top + bottom skins (split ±th/2 in z) plus leading-edge, tip and
// trailing-edge strips (the root edge is buried in the fuselage, so no face). Gives the
// wing real thickness at the cost of +4 faces, only in the full-detail mesh.
function pushPanel(faces, role, sh, c, th, detail) {
  if (!detail || !th) { faces.push({ role, sh, p: c }); return; }
  const up = th / 2;
  const T = c.map(v => V(v[0], v[1], v[2] + up)), B = c.map(v => V(v[0], v[1], v[2] - up));
  faces.push({ role, sh: Math.min(1, sh * 1.06), p: T });                 // top skin (brighter)
  faces.push({ role, sh: sh * 0.7, p: [B[3], B[2], B[1], B[0]] });        // bottom skin (darker, wound the other way)
  for (const [i, j] of [[0, 1], [1, 2], [2, 3]]) faces.push({ role, sh: sh * 0.85, p: [T[i], T[j], B[j], B[i]] });   // LE · tip · TE
}

// ── Control surfaces ─────────────────────────────────────────────────────────────
// Ailerons + flaps (on the wing trailing edge) and elevators (on the tailplane) are
// added as thin quads HINGED along a spanwise line just forward of the trailing edge.
// The static face carries its hinge line + a `defl` key + which `side` it's on; the
// geometry stays neutral in the cache (memoised), and each renderer deflects a COPY of
// the points per-frame from live pilot input via deflectSurface() below. Only the pilot's
// own external-chase ship passes input, so contacts/hangar/turntable draw them at rest.
const _lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// One hinged trailing-edge panel. le0/le1 = the parent panel's leading-edge-side points at
// the surface's inboard/outboard ends; te0/te1 = the trailing-edge points there; `cf` = the
// surface's chord fraction (how far forward of the TE the hinge sits). Hinge corners sit ON
// the axis (unmoved by the rotation); the TE corners swing.
function pushCtrlSurface(faces, role, side, sh, le0, le1, te0, te1, cf) {
  const lift = 0.006;                                     // float a hair above the wing skin so it reads as a separate panel
  const h0 = _lerp3(te0, le0, cf), h1 = _lerp3(te1, le1, cf);
  const T0 = [te0[0], te0[1], te0[2] + lift], T1 = [te1[0], te1[1], te1[2] + lift];
  const H0 = [h0[0], h0[1], h0[2] + lift], H1 = [h1[0], h1[1], h1[2] + lift];
  faces.push({ role, defl: role, side, sh, hinge: [H0, H1], p: [H0, H1, T1, T0] });
}

// Build the flap (inboard) + aileron (outboard) for one wing (`s` = +1 right, −1 left).
function addWingSurfaces(faces, p, s, wH) {
  const rootLE = V(p.wRootF, s * p.fr * 0.7, wH - 0.01), tipLE = V(p.wTipF, s * p.span, wH + p.dih);
  const tipTE = V(p.wTipB, s * p.span, wH + p.dih), rootTE = V(p.wRootB, s * p.fr * 0.7, wH - 0.01);
  const le = (u) => _lerp3(rootLE, tipLE, u), te = (u) => _lerp3(rootTE, tipTE, u);
  pushCtrlSurface(faces, 'flap', s, 0.8, le(0.06), le(0.46), te(0.06), te(0.46), 0.28);      // inboard flap
  pushCtrlSurface(faces, 'aileron', s, 0.82, le(0.54), le(0.95), te(0.54), te(0.95), 0.28);  // outboard aileron
}

// Build the elevator on one tailplane half (both halves move together — a symmetric elevator).
function addStabSurface(faces, p, s) {
  const rootLE = V(p.hF, s * p.fr * 0.5, 0.04), tipLE = V(p.hTipF, s * p.hSpan, 0.05);
  const tipTE = V(p.hTipB, s * p.hSpan, 0.05), rootTE = V(p.hB, s * p.fr * 0.5, 0.04);
  const le = (u) => _lerp3(rootLE, tipLE, u), te = (u) => _lerp3(rootTE, tipTE, u);
  pushCtrlSurface(faces, 'elevator', s, 0.72, le(0.06), le(0.95), te(0.06), te(0.95), 0.34);
}

// Build the rudder on one vertical fin at lateral station `fg`. The fin is a flat triangle in the
// g=fg plane (apex finF1/finH, base finF0→finF2 at z≈0.06); the rudder is its aft strip, hinged on
// a near-vertical line shifted FORWARD of the trailing edge by `cf` of the base chord, so it swings
// in ±g (yaw). Coplanar with the fin at rest → invisible seam; visible only once it kicks over.
function addFinSurface(faces, p, fg) {
  const cf = 0.4, df = cf * (p.finF0 - p.finF2);                        // forward hinge offset from the TE
  const P1 = V(p.finF1, fg, p.finH), P2 = V(p.finF2, fg, 0.06);        // trailing edge: apex → base-rear
  const Htop = V(p.finF1 + df, fg, p.finH), Hbot = V(p.finF2 + df, fg, 0.06);
  faces.push({ role: 'rudder', defl: 'rudder', side: Math.sign(fg) || 1, sh: 0.88, hinge: [Htop, Hbot], p: [Htop, Hbot, P2, P1] });
}

// Peak deflection (radians) for each surface at full input.
const SURF_MAX = { aileron: 0.36, flap: 0.55, elevator: 0.40, rudder: 0.38 };

// Deflect a control-surface face for the live control input, returning a fresh copy of its
// points (never mutates the memoised face). `ctrl` = { aileron, elevator, flaps } in −1..1
// (flaps 0..1). Signs are derived from the hinge axis pointing OUTBOARD on each side:
//   aileron — same angle both sides ⇒ they move OPPOSITELY (roll): +aileron rolls right;
//   flap    — −side ⇒ both trailing edges drop together;
//   elevator— +side ⇒ both trailing edges move together (pitch): +elevator (pull) = up.
export function deflectSurface(face, ctrl) {
  if (!ctrl || !face.hinge) return face.p;
  let ang = 0;
  if (face.defl === 'aileron') ang = SURF_MAX.aileron * (ctrl.aileron || 0);
  else if (face.defl === 'flap') ang = -face.side * SURF_MAX.flap * (ctrl.flaps || 0);
  else if (face.defl === 'elevator') ang = face.side * SURF_MAX.elevator * (ctrl.elevator || 0);
  else if (face.defl === 'rudder') ang = SURF_MAX.rudder * (ctrl.rudder || 0);   // both fins swing together (yaw): +rudder = right
  if (!ang) return face.p;
  const A = face.hinge[0], B = face.hinge[1];
  let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
  const ct = Math.cos(ang), st = Math.sin(ang);
  return face.p.map(pt => {                                // Rodrigues rotation about the hinge axis (A, dir d)
    const vx = pt[0] - A[0], vy = pt[1] - A[1], vz = pt[2] - A[2];
    const dv = dx * vx + dy * vy + dz * vz;
    const cx = dy * vz - dz * vy, cy = dz * vx - dx * vz, cz = dx * vy - dy * vx;   // d × v
    return [
      A[0] + vx * ct + cx * st + dx * dv * (1 - ct),
      A[1] + vy * ct + cy * st + dy * dv * (1 - ct),
      A[2] + vz * ct + cz * st + dz * dv * (1 - ct)];
  });
}

// A small forward-pointing spinner cone + hub (prop hub). `scale` sizes it: a big turboprop
// spinner (1) vs a little GA nose spinner like the Cessna's (~0.5). The spinning disc itself
// is drawn by each renderer's effect layer, keyed off PROP_STATIONS (below).
function addSpinner(faces, f, g, h, scale = 1) {
  const apex = V(f + 0.14 * scale, g, h), r = 0.045 * scale;
  const ring = [V(f, g + r, h + r), V(f, g - r, h + r), V(f, g - r, h - r), V(f, g + r, h - r)];
  for (let i = 0; i < 4; i++) faces.push({ role: 'nacelle', sh: 0.95 - i * 0.06, p: [apex, ring[i], ring[(i + 1) % 4]] });
}

// An-124-style heavy gear: the type's signature multi-wheel 'centipede' — a fore-aft ROW of
// TANDEM bogies down each side of the lower fuselage (each a short leg tucked to the belly, a
// bogie beam, and two fat wheels) plus a twin nose unit. A cantilever heavy sits LOW, not on
// tall spindly struts. (Shared primitives addStrut/pushWheel defined below the gear builders.)
function addHeavyGear(faces, p) {
  const wz = -p.fv - 0.02, gside = p.fr * 0.72, wr = 0.05;   // wheels hang just below the belly
  for (const s of [1, -1]) {
    for (const f of [0.30, 0.11, -0.08, -0.27]) {
      addStrut(faces, f, s * gside, wz + 0.11, wz + 0.05, 0.02, 6);   // short leg into the belly
      faces.push({ role: 'gear', sh: 0.62, p: [V(f + 0.085, s * gside, wz + 0.055), V(f + 0.085, s * gside, wz + 0.028), V(f - 0.085, s * gside, wz + 0.028), V(f - 0.085, s * gside, wz + 0.055)] });   // bogie beam
      pushWheel(faces, f + 0.055, s * gside, wz, wr, 0.02, 8);   // tandem pair
      pushWheel(faces, f - 0.055, s * gside, wz, wr, 0.02, 8);
    }
  }
  const nf = p.noseF * 0.55, nz = wz + 0.015;
  addStrut(faces, nf, 0, nz + 0.10, nz + 0.045, 0.018, 6);
  pushWheel(faces, nf + 0.045, 0, nz, wr * 0.85, 0.018, 8);   // twin nose unit
  pushWheel(faces, nf - 0.045, 0, nz, wr * 0.85, 0.018, 8);
}

// One fixed gear leg (short, stout strut) + a wheel, in side profile. The leg tops out
// ABOVE the belly (+z) so it disappears partly into the fuselage. The wheel ROLLS fore-aft
// (its round face along ±g), extruded across its width with hub end-caps so it reads as a
// tyre, not an edge-on disc. `scale` fattens the whole leg + wheel (>1 for a heavy strut).
function addGear(faces, f, g, wz, scale = 1) {
  const top = 0.04, lw = 0.022 * scale;   // reach up inside the model; fore-aft strut plate
  faces.push({ role: 'gear', sh: 0.7, p: [V(f + lw, g, top), V(f + lw, g, wz), V(f - lw, g, wz), V(f - lw, g, top)] });
  const wr = 0.06 * scale, ww = 0.022 * scale, N = 8;   // radius + half-width
  const ring = (gg) => { const r = []; for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; r.push(V(f + Math.cos(a) * wr, gg, wz + Math.sin(a) * wr)); } return r; };
  const oL = ring(g - ww), oR = ring(g + ww);
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; faces.push({ role: 'gear', sh: 0.4 + 0.06 * (i % 2), p: [oL[i], oL[j], oR[j], oR[i]] }); }   // tread band
  faces.push({ role: 'gear', sh: 0.6, p: oR });                 // outboard hub face
  faces.push({ role: 'gear', sh: 0.48, p: oL.slice().reverse() }); // inboard hub face
}

// A-10-style main gear: the Warthog's unmistakable heavy gear, built up out of many
// facets so it reads as REAL landing gear, not a box on a stick — a rounded body-coloured
// fairing pod (octagonal barrel tapering to a snout), a segmented oleo shock strut
// (dark upper cylinder + polished lower piston), a forward scissor/torque link, a two-plate
// axle fork, and a fat multi-facet tyre with sidewalls + a bright metal hubcap.
// The fairing skins take the livery (role 'nacelle'); every metal part stays dark ('gear').
function addGearPod(faces, f, g, wz) {
  const podTop = 0.02, podBot = wz + 0.08;
  const cz = (podTop + podBot) / 2, hh = (podBot - podTop) / 2, pw = 0.055;   // vertical centre + half-height + half-width
  const rear = f - 0.13, midF = f + 0.10, nose = f + 0.17;
  const RN = 8;   // octagonal cross-section — 8 side facets read as a rounded fairing
  // A cross-section ring in the g-h (lateral-vertical) plane at fore-aft x, scaled by s.
  const ring = (x, s) => {
    const r = [];
    for (let i = 0; i < RN; i++) { const a = (i + 0.5) / RN * Math.PI * 2; r.push(V(x, g + Math.cos(a) * pw * s, cz + Math.sin(a) * hh * s)); }
    return r;
  };
  const rRear = ring(rear, 1), rMid = ring(midF, 1), rNose = ring(nose, 0.32);
  // Skin: rear→mid barrel, then mid→nose taper to a rounded snout (8 quads each band).
  for (let i = 0; i < RN; i++) {
    const j = (i + 1) % RN, up = Math.sin((i + 1) / RN * Math.PI * 2), sh = 0.62 + 0.24 * up;
    faces.push({ role: 'nacelle', sh, p: [rRear[i], rRear[j], rMid[j], rMid[i]] });
    faces.push({ role: 'nacelle', sh: sh * 1.02, p: [rMid[i], rMid[j], rNose[j], rNose[i]] });
  }
  faces.push({ role: 'nacelle', sh: 0.44, p: rRear.slice().reverse() });   // rear cap
  faces.push({ role: 'nacelle', sh: 0.9, p: rNose });                      // nose cap
  // ── Oleo shock strut: a hexagonal-section leg, upper cylinder over a bright piston ──
  const legTop = podBot - 0.005, sBot = wz + 0.03, midZ = (legTop + sBot) / 2;
  const SN = 6, sr = 0.02;
  const strutRing = (z, s) => {
    const r = [];
    for (let i = 0; i < SN; i++) { const a = (i + 0.5) / SN * Math.PI * 2; r.push(V(f - 0.02 + Math.cos(a) * sr * s, g + Math.sin(a) * sr * s, z)); }
    return r;
  };
  const sTop = strutRing(legTop, 1), sMid = strutRing(midZ, 0.82), sLow = strutRing(sBot, 0.82);
  for (let i = 0; i < SN; i++) {
    const j = (i + 1) % SN;
    faces.push({ role: 'gear', sh: 0.58, p: [sTop[i], sTop[j], sMid[j], sMid[i]] });   // upper cylinder (dull)
    faces.push({ role: 'gear', sh: 0.9, p: [sMid[i], sMid[j], sLow[j], sLow[i]] });    // lower piston (polished)
  }
  // Scissor / torque link — a shallow forward 'V' off the front of the strut.
  const flF = f - 0.02 + sr, lw = 0.008, kneeF = flF + 0.04, kneeZ = midZ + 0.015;
  faces.push({ role: 'gear', sh: 0.8, p: [V(flF, g - lw, legTop + 0.005), V(flF, g + lw, legTop + 0.005), V(kneeF, g + lw, kneeZ), V(kneeF, g - lw, kneeZ)] });
  faces.push({ role: 'gear', sh: 0.68, p: [V(kneeF, g - lw, kneeZ), V(kneeF, g + lw, kneeZ), V(flF, g + lw, sBot + 0.01), V(flF, g - lw, sBot + 0.01)] });
  // ── Wheel: fat tyre rolling fore-aft (circle in the f-h plane, extruded across g) ──
  const ts = 0.5;   // tyre scale
  const wr = 0.078 * ts, hr = 0.03 * ts, wf = f - 0.015, wg0 = g - 0.03 * ts, wg1 = g + 0.03 * ts;
  const WN = 12;
  const wRing = (gg, rad) => { const r = []; for (let i = 0; i < WN; i++) { const a = i / WN * Math.PI * 2; r.push(V(wf + Math.cos(a) * rad, gg, wz + Math.sin(a) * rad)); } return r; };
  const outO = wRing(wg1, wr), outI = wRing(wg0, wr), hubO = wRing(wg1, hr), hubI = wRing(wg0, hr);
  for (let i = 0; i < WN; i++) {
    const j = (i + 1) % WN;
    faces.push({ role: 'gear', sh: 0.34 + 0.06 * (i % 2), p: [outI[i], outI[j], outO[j], outO[i]] });   // tread band (blocky rubber)
    faces.push({ role: 'gear', sh: 0.5, p: [outO[i], outO[j], hubO[j], hubO[i]] });                     // outboard sidewall
    faces.push({ role: 'gear', sh: 0.4, p: [hubI[i], hubI[j], outI[j], outI[i]] });                     // inboard sidewall
  }
  faces.push({ role: 'gear', sh: 0.92, p: hubO });                    // outboard hubcap (bright)
  faces.push({ role: 'gear', sh: 0.55, p: hubI.slice().reverse() });  // inboard hubcap
  // Two-plate axle fork bridging strut bottom to the hub on each side of the tyre.
  faces.push({ role: 'gear', sh: 0.7, p: [V(f - 0.035, wg1, sBot), V(f - 0.005, wg1, sBot), V(wf + 0.012, wg1, wz), V(wf - 0.02, wg1, wz)] });
  faces.push({ role: 'gear', sh: 0.56, p: [V(f - 0.005, wg0, sBot), V(f - 0.035, wg0, sBot), V(wf - 0.02, wg0, wz), V(wf + 0.012, wg0, wz)] });
}

// ── Shared gear primitives ───────────────────────────────────────────────────────
// Reused by the per-class gear builders so every craft's gear reads at the same fidelity
// (detailed rolling tyres, oleo struts, round tubes) while each keeps its own leg style.
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

// A round n-gon tube between two 3D points — skid rails, cross-tubes, tow bars.
function addTube(faces, a, b, r, role = 'gear', sh = 0.55, sides = 6) {
  const d = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const u = norm3(cross3(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross3(d, u);
  const ring = (c) => { const o = []; for (let i = 0; i < sides; i++) { const t = i / sides * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r; o.push(V(c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn)); } return o; };
  const A = ring(a), B = ring(b);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; faces.push({ role, sh, p: [A[i], A[j], B[j], B[i]] }); }
}

// A vertical oleo strut: an n-gon leg from zTop down to zBot, dull cylinder over a bright piston.
function addStrut(faces, f, g, zTop, zBot, r, sides = 6) {
  const ring = (z, s) => { const o = []; for (let i = 0; i < sides; i++) { const a = (i + 0.5) / sides * Math.PI * 2; o.push(V(f + Math.cos(a) * r * s, g + Math.sin(a) * r * s, z)); } return o; };
  const a = ring(zTop, 1), b = ring((zTop + zBot) / 2, 0.85), c = ring(zBot, 0.85);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; faces.push({ role: 'gear', sh: 0.58, p: [a[i], a[j], b[j], b[i]] }); faces.push({ role: 'gear', sh: 0.9, p: [b[i], b[j], c[j], c[i]] }); }
}

// A detailed tyre rolling fore-aft, centred at (wf,g,wz): blocky tread band, two sidewalls,
// bright metal hubcaps. Radius wr, half-width hw, N tread segments.
function pushWheel(faces, wf, g, wz, wr, hw, N = 12) {
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
function addSpat(faces, f, g, wz, s = 1) {
  const F = V(f + 0.08 * s, g, wz + 0.03), B = V(f - 0.06 * s, g, wz + 0.035), T = V(f + 0.005, g, wz + 0.075),
    L = V(f + 0.005, g - 0.024, wz + 0.03), R = V(f + 0.005, g + 0.024, wz + 0.03);
  faces.push({ role: 'nacelle', sh: 0.86, p: [F, R, T] });
  faces.push({ role: 'nacelle', sh: 0.8, p: [F, T, L] });
  faces.push({ role: 'nacelle', sh: 0.62, p: [B, T, R] });
  faces.push({ role: 'nacelle', sh: 0.58, p: [B, L, T] });
}

// Cessna 172 gear — two splayed leaf-spring main legs (flat bowed blades) with spatted wheels
// sitting wide of the slim fuselage, plus a slim spatted nose oleo. The classic light-plane look.
function addCessnaGear(faces, p, wz) {
  const gw = p.fr + 0.11, hc = 0.032;
  for (const side of [1, -1]) {
    pushPanel(faces, 'gear', 0.6, [
      V(0.06 + hc, side * 0.05, 0.03), V(0.06 + hc * 0.7, side * gw, wz + 0.02),
      V(0.06 - hc * 0.7, side * gw, wz + 0.02), V(0.06 - hc, side * 0.05, 0.03)], 0.014, 1);   // leaf-spring blade
    pushWheel(faces, 0.06, side * gw, wz, 0.05, 0.016, 8);
    addSpat(faces, 0.06, side * gw, wz);
  }
  const nf = p.noseF * 0.55, nz = wz + 0.03;
  addStrut(faces, nf, 0, 0.03, nz + 0.02, 0.016, 6);
  pushWheel(faces, nf, 0, nz, 0.042, 0.014, 8);
  addSpat(faces, nf, 0, nz, 0.8);
}

// Twin Otter gear — two stout faired oleo legs on a wide track carrying big low-pressure tyres,
// plus a chunky nose oleo. The STOL-hauler look (fat tyres, heavy legs), distinct from the Cessna.
function addOtterGear(faces, p, wz) {
  const gw = p.fr + 0.05;
  for (const side of [1, -1]) {
    addStrut(faces, 0.08, side * gw, 0.02, wz + 0.055, 0.026, 6);
    pushWheel(faces, 0.08, side * gw, wz, 0.07, 0.028, 12);
    faces.push({ role: 'gear', sh: 0.66, p: [V(0.05, side * (gw + 0.032), wz + 0.055), V(0.11, side * (gw + 0.032), wz + 0.055), V(0.095, side * (gw + 0.032), wz), V(0.065, side * (gw + 0.032), wz)] });   // outer fork plate
  }
  const nf = p.noseF * 0.55, nz = wz + 0.02;
  addStrut(faces, nf, 0, 0.02, nz + 0.04, 0.022, 6);
  pushWheel(faces, nf, 0, nz, 0.055, 0.022, 10);
}

// A light rotorcraft (Mini 500): a rounded egg/bubble CABIN, a slender straight tail boom, a
// small tail fin + rotor, tubular skids on cross-tubes, and a translucent main-rotor disc on a
// short head. Cabin + boom are skinned from finely-subdivided cross-section rings so they read
// as one smooth teardrop, not a faceted egg. Anchors held fixed for the FX layer: main mast at
// (0.1, 0, 0.28), tail rotor at (-1.04, 0.07, 0.12) — see drawRotorFX.
function buildHeli() {
  const faces = [];
  const sides = 14;   // ring resolution (was 8) — smooth bubble & boom
  const ring = (f, rg, rv, cz) => { const o = []; for (let k = 0; k < sides; k++) { const a = k / sides * Math.PI * 2; o.push(V(f, Math.cos(a) * rg, cz + Math.sin(a) * rv)); } return o; };
  const shFor = (k) => 0.6 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright → bottom dark
  const skin = (A, B, role = 'body', m = 1) => { for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; faces.push({ role, sh: shFor(k) * m, p: [A[k], A[k2], B[k2], B[k]] }); } };
  // Rounded egg CABIN: a big glass bubble front, widest at the seats, an engine hump, tapering
  // down to the boom. More stations (7 vs 3) so the profile curves instead of creasing.
  const cabin = [
    ring(0.60, 0.105, 0.115, 0.02),   // front of the bubble (nose dome caps it below)
    ring(0.46, 0.165, 0.180, 0.015),  // bubble swelling out
    ring(0.30, 0.205, 0.215, 0.015),  // widest — canopy/seats
    ring(0.10, 0.210, 0.215, 0.025),  // cabin waist
    ring(-0.06, 0.170, 0.185, 0.045), // engine bay shoulders
    ring(-0.16, 0.110, 0.120, 0.050),
    ring(-0.24, 0.062, 0.070, 0.052), // boom junction
  ];
  // Front three sections are the wrap-around glass canopy; the rest is painted shell.
  for (let i = 0; i < cabin.length - 1; i++) skin(cabin[i], cabin[i + 1], i < 2 ? 'glass' : 'body', i < 2 ? 1 : 1);
  // Rounded NOSE DOME closing the bubble — a fan of glass triangles to an apex ahead of the
  // front ring, so the canopy reads as a smooth blister rather than a flat octagon cap.
  const noseApex = V(0.70, 0, 0.03);
  for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; faces.push({ role: 'glass', sh: shFor(k), p: [noseApex, cabin[0][k], cabin[0][k2]] }); }
  // Thin, near-straight tail BOOM (a slender tapering tube) rising slightly toward the tail rotor.
  const boom = [ring(-0.24, 0.058, 0.066, 0.052), ring(-0.50, 0.044, 0.048, 0.078), ring(-0.76, 0.034, 0.036, 0.100), ring(-1.00, 0.026, 0.028, 0.118)];
  for (let i = 0; i < boom.length - 1; i++) skin(boom[i], boom[i + 1], 'body', 0.92);
  // Vertical tail FIN — a thin extruded blade (two faces + a swept leading/trailing edge).
  const finT = 0.014, fin = [V(-0.86, 0, 0.13), V(-0.99, 0, 0.30), V(-1.10, 0, 0.40), V(-1.10, 0, 0.11)];
  for (const s of [1, -1]) { const p = fin.map(v => V(v[0], s * finT, v[2])); faces.push({ role: 'fin', sh: s > 0 ? 0.92 : 0.72, p }); }
  faces.push({ role: 'fin', sh: 0.8, p: [V(-0.99, finT, 0.30), V(-1.10, finT, 0.40), V(-1.10, -finT, 0.40), V(-0.99, -finT, 0.30)] });   // top edge
  // Small horizontal STABILISER across the boom (a thin flat plate each side).
  faces.push({ role: 'fin', sh: 0.85, p: [V(-0.82, 0.02, 0.115), V(-0.82, 0.16, 0.120), V(-0.94, 0.16, 0.125), V(-0.94, 0.02, 0.120)] });
  faces.push({ role: 'fin', sh: 0.7, p: [V(-0.82, -0.02, 0.115), V(-0.94, -0.02, 0.120), V(-0.94, -0.16, 0.125), V(-0.82, -0.16, 0.120)] });
  // Tail-rotor gearbox fairing + the disc face (schematic renderer only; painted layers draw blades).
  addTube(faces, V(-0.96, 0.02, 0.12), V(-1.06, 0.07, 0.12), 0.022, 'nacelle', 0.75, 6);
  faces.push({ role: 'rotor', sh: 0.7, p: [V(-1.0, 0.07, 0.02), V(-1.0, 0.07, 0.30), V(-1.1, 0.07, 0.30), V(-1.1, 0.07, 0.02)] });
  // Tubular SKIDS: a round rail each side (with an upturned front toe) on two cross-tube legs.
  const skidZ = -0.30, skidG = 0.22;
  for (const s of [1, -1]) {
    addTube(faces, V(0.34, s * skidG, skidZ + 0.02), V(-0.14, s * skidG, skidZ), 0.016, 'gear', 0.5);          // skid rail
    addTube(faces, V(0.34, s * skidG, skidZ + 0.02), V(0.42, s * skidG, skidZ + 0.09), 0.015, 'gear', 0.56);   // upturned front toe
    for (const cf of [0.24, -0.06]) addTube(faces, V(cf, s * skidG, skidZ + 0.02), V(cf, s * 0.05, -0.14), 0.012, 'strut', 0.55);   // cross-tube leg
  }
  // ── Rotor MAST + HEAD ── short pylon just above the cabin, a hub block, and a swashplate ring.
  const cf = 0.1, cz = 0.28, rad = 1.05;   // rotor sits LOW on a short head just above the cabin
  addTube(faces, V(cf, 0, 0.19), V(cf, 0, cz - 0.01), 0.026, 'nacelle', 0.8, 8);   // tapered mast pylon
  const hb = 0.045;   // hub block above the mast
  for (const [du, dv] of [[hb, 0], [0, hb], [-hb, 0], [0, -hb]]) faces.push({ role: 'nacelle', sh: 0.85, p: [V(cf + du * 0.4, dv * 0.4, cz - 0.02), V(cf + du, dv, cz), V(cf + du, dv, cz + 0.02), V(cf + du * 0.4, dv * 0.4, cz)] });
  faces.push({ role: 'nacelle', sh: 0.95, p: [V(cf + hb, 0, cz + 0.02), V(cf, hb, cz + 0.02), V(cf - hb, 0, cz + 0.02), V(cf, -hb, cz + 0.02)] });   // hub top cap
  const swash = [];   // swashplate ring under the head
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; swash.push(V(cf + Math.cos(a) * 0.07, Math.sin(a) * 0.07, cz - 0.03)); }
  faces.push({ role: 'nacelle', sh: 0.6, p: swash });
  // Main-rotor disc (octagon) — schematic wireframe renderer only; painted renderers draw blades.
  const disc = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc.push(V(cf + Math.cos(a) * rad, Math.sin(a) * rad, cz)); }
  faces.push({ role: 'rotor', sh: 0.65, p: disc });
  return faces;
}

// Where each class's prop discs spin — read by both renderers' engine-effect layers so
// the translucent blur sits on the actual spinner(s), not a hardcoded nose position.
export const PROP_STATIONS = {
  ultralight: [[0.79, 0, 0.02]],                       // Cessna: one nose prop (small spinner apex = noseF 0.72 + 0.14·0.5)
  prop: [[0.47, 0.42, 0.11], [0.47, -0.42, 0.11]],     // Twin Otter: two wing props
};

// Real-world RELATIVE size (Twin Otter = 1). The meshes are all normalised to a similar extent,
// so this scales the geometry where craft are shown TOGETHER (the hangar fleet scene) to convey
// true size. Roughly the real length ratios vs the DHC-6 (15.8 m): Cessna .53, A-10 1.03, and
// the An-124 is really ~4.4× — COMPRESSED to 2.0 so the fleet row stays readable — the Mini-500
// heli ~.25, bumped to .42 so it isn't a speck. Air-to-air contacts get the equivalent through
// windshield.js CONTACT_SIZE. Unlisted classes default to 1.
export const MODEL_SCALE = { ultralight: 0.52, prop: 1.0, gunship: 1.05, heavy: 1.7, heli: 0.42, wreck: 0.85 };

// ── Animated prop & rotor blades ────────────────────────────────────────────────
// The spinning surfaces are an EFFECT LAYER every renderer draws through its OWN
// camera: `projFn([f,g,h])` → {sx, sy} screen point, or null when it's behind the
// lens. Blades are true model-space polygons, so they bank and foreshorten with the
// craft in any view while the static face list stays memoisable (painted renderers
// skip role 'rotor'; the wireframe keeps its schematic disc). `spin` is a shared
// time-phase in radians — each disc gears it to its own RPM. `power` 0..1 breathes
// the blur; `parked: true` draws crisp stopped blades (hangar floor, turntable).
// `disc` (0..1) is the translucent blur-disc opacity; `spool` (0..1) is how fast the blades
// are actually turning → how smeared they read (0 = a stopped/crisp prop, 1 = full motion smear).
// Split so the own-ship can spin the BLADES up first (spool) and fade the DISC in after (disc),
// and reverse on shutdown. Contacts pass neither → both fall back to `power` / full smear (old look).
export function drawRotorFX(ctx, cls, projFn, { spin = 0, power = 0.7, parked = false, disc = null, spool = null } = {}) {
  const dsc = disc != null ? disc : power;      // blur-disc opacity
  const spl = spool != null ? spool : 1;        // blade motion amount
  if (cls === 'heli') {
    // Main rotor (f-g plane; matches buildHeli's cf 0.1 / cz 0.28) + tail rotor
    // (f-h plane on the boom's right side), geared ~5× the main.
    spinDisc(ctx, projFn, [0.1, 0, 0.28], [1, 0, 0], [0, 1, 0], 1.02, spin, dsc, spl, parked, 2, 0.85);
    spinDisc(ctx, projFn, [-1.04, 0.07, 0.12], [1, 0, 0], [0, 0, 1], 0.19, spin * 4.7 + 1.1, dsc, spl, parked, 2, 0.7);
  } else {
    // Cessna two-blade nose prop / Twin Otter three-blade wing turboprops. The
    // stations record the spinner apex (ultralight) vs base (prop) — nudge the
    // blade plane back to the cone root either way.
    const blades = cls === 'ultralight' ? 2 : 3, off = cls === 'ultralight' ? -0.06 : 0.03;
    for (const st of (PROP_STATIONS[cls] || [])) {
      spinDisc(ctx, projFn, [st[0] + off, st[1], st[2]], [0, 0, 1], [0, 1, 0],
        cls === 'ultralight' ? 0.21 : 0.21, spin * 2.2 + st[1] * 3, dsc, spl, parked, blades, 0.5);
    }
  }
}

// One spinning disc: centre C, two unit axes U/V spanning its plane (model space), radius r.
// `disc` = blur-disc opacity, `spool` = blade motion amount (see drawRotorFX). `lead` is the
// front blade's opacity (helis read solid, props smear).
function spinDisc(ctx, projFn, C, U, V, r, spin, disc, spool, parked, blades, lead) {
  const at = (a, rad, wPerp) => {   // point at polar (a, rad) offset wPerp across the blade
    const ca = Math.cos(a), sa = Math.sin(a);
    return projFn([
      C[0] + (U[0] * ca + V[0] * sa) * rad + (V[0] * ca - U[0] * sa) * wPerp,
      C[1] + (U[1] * ca + V[1] * sa) * rad + (V[1] * ca - U[1] * sa) * wPerp,
      C[2] + (U[2] * ca + V[2] * sa) * rad + (V[2] * ca - U[2] * sa) * wPerp]);
  };
  const blade = (a, fill) => {   // tapered quad, root → tip
    const q = [at(a, r * 0.12, r * 0.085), at(a, r, r * 0.045), at(a, r, -r * 0.045), at(a, r * 0.12, -r * 0.085)];
    if (q.some(p => !p)) return;
    ctx.beginPath(); ctx.moveTo(q[0].sx, q[0].sy);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].sx, q[i].sy);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  const hub = at(0, 0, 0), tip = at(0, r, 0);
  if (!hub || !tip) return;
  const rpx = Math.hypot(tip.sx - hub.sx, tip.sy - hub.sy);   // screen radius → hub dot size
  const step = Math.PI * 2 / blades;
  if (parked) {   // engines off: crisp dark stopped blades on a hub dot
    for (let i = 0; i < blades; i++) blade(spin + i * step, 'rgba(38,43,49,0.95)');
    ctx.fillStyle = 'rgba(30,34,40,0.95)';
    ctx.beginPath(); ctx.arc(hub.sx, hub.sy, Math.max(1, rpx * 0.08), 0, 7); ctx.fill();
    return;
  }
  // Blur disc + tip ring — opacity rides `disc`, so it's INVISIBLE until the prop is spun up
  // (fades in on throttle, fades out first on shutdown). A soft fade near zero avoids a hard pop.
  const dFade = clampN(disc * 3.5, 0, 1);
  if (dFade > 0.01) {
    const rim = [];
    for (let i = 0; i < 16; i++) { const q = at(i / 16 * Math.PI * 2, r, 0); if (!q) return; rim.push(q); }
    ctx.beginPath(); ctx.moveTo(rim[0].sx, rim[0].sy);
    for (let i = 1; i < 16; i++) ctx.lineTo(rim[i].sx, rim[i].sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(205,216,226,${dFade * (0.06 + disc * 0.09)})`; ctx.fill();
    ctx.strokeStyle = `rgba(228,238,246,${dFade * (0.14 + disc * 0.16)})`; ctx.lineWidth = 1; ctx.stroke();
  }
  // The blades: crisp and stopped at spool 0 (a single dark blade per position, no smear),
  // dragging more fading ghosts and spreading them wider as `spool` climbs — so the prop reads
  // as speeding up / slowing down, not just present/absent. Ghost count grows with spool.
  const ghosts = spool > 0.55 ? 3 : spool > 0.18 ? 2 : 1;
  for (let i = 0; i < blades; i++) {
    for (let k = 0; k < ghosts; k++) blade(spin + i * step - k * 0.17 * spool, `rgba(36,41,47,${lead * Math.pow(0.42, k)})`);
  }
  ctx.fillStyle = 'rgba(30,34,40,0.9)';
  ctx.beginPath(); ctx.arc(hub.sx, hub.sy, Math.max(1, rpx * 0.07), 0, 7); ctx.fill();
  // A bright glint sweeping the tip ring — light catching the blur; only while the disc shows.
  if (dFade > 0.05) {
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) { const q = at(spin * 1.3 + i * 0.14, r * 0.99, 0); if (!q) return; i === 0 ? ctx.moveTo(q.sx, q.sy) : ctx.lineTo(q.sx, q.sy); }
    ctx.strokeStyle = `rgba(240,248,255,${dFade * (0.2 + disc * 0.25)})`; ctx.lineWidth = 1.4; ctx.stroke();
  }
}

// Per-class fixed-wing parameters (normalised units).
const FW_DEFAULT = {
  noseF: 1.05, tailF: -1.05, fr: 0.12, fv: 0.12, span: 0.95, wingH: 0,
  wRootF: 0.30, wRootB: -0.05, wTipF: 0.14, wTipB: -0.02, dih: 0.05,
  hF: -0.80, hB: -1.02, hTipF: -0.86, hTipB: -1.04, hSpan: 0.40,
  finF0: -0.74, finF1: -0.98, finF2: -1.06, finH: 0.50, fins: [0],
  engines: [-0.24, 0.24], nacF: -0.02, nacH: -0.02,
};
const FW_PARAMS = {
  // Mayfly — a Cessna (per ref photo): high-wing, strut-braced, fixed-gear single. Signatures:
  // a SHORT nose that tapers smoothly to a small cone spinner (noseCowl floors the cowl front so
  // it's rounded, not a spike), a LONG slim tailcone, a straight squared-off constant-chord wing
  // on the cabin roof, and a tall swept fin. Short-nose / long-tail, slightly boxy cabin.
  ultralight: { ...FW_DEFAULT, fr: 0.085, fv: 0.10, span: 1.12, noseF: 0.72, tailF: -0.92,
    wingH: 0.12, dih: 0.03, wRootF: 0.26, wRootB: -0.14, wTipF: 0.24, wTipB: -0.14,
    hF: -0.68, hB: -0.88, hTipF: -0.72, hTipB: -0.90, hSpan: 0.42,
    finF0: -0.62, finF1: -0.86, finF2: -0.92, finH: 0.46, fins: [0],
    engines: [], prop: 'nose', struts: true, gear: true, gearStyle: 'spring',
    noseBlunt: 3.0, noseCowl: 0.48, boxy: 0.4, bodyTube: 0.10, tailUp: 0.05,   // full, rounded cowl tapering to the small spinner
    canopy: { f0: 0.50, f1: 0.30, w: 0.072, h: 0.05, front: 0.4, tail: 0.28, segs: 4, arc: 3, sink: 0.02 } },   // windscreen/front-cabin kept entirely AHEAD of the high wing LE (0.26) so it never pokes through the wing
  // Mule — a high-wing, twin-turboprop, fixed-gear STOL hauler: a DHC-6 Twin Otter (per ref). A
  // deep, flat-sided BOX of a fuselage held near-constant most of its length, with the signature
  // DROOPED, POINTED "anteater" nose (noseZ pulls the radome down below the fuselage line to a
  // point). Shortened from the original (empennage pulled in to match) so it reads less stretched.
  prop: { ...FW_DEFAULT, fr: 0.13, fv: 0.135, span: 1.02, noseF: 0.86, tailF: -0.92,
    wingH: 0.13, dih: 0.01, wRootF: 0.36, wRootB: -0.10, wTipF: 0.26, wTipB: -0.06,
    hF: -0.70, hB: -0.89, hTipF: -0.75, hTipB: -0.91, hSpan: 0.40,
    finH: 0.60, finF0: -0.63, finF1: -0.88, finF2: -0.94,
    engines: [-0.42, 0.42], nacF: 0.30, nacH: 0.11, prop: 'wing',
    struts: true, gear: true, gearStyle: 'oleo', windows: 4, noseBlunt: 1.9, noseZ: -0.055, boxy: 0.82, bodyTube: 0.42, tailUp: 0.075,
    canopy: { f0: 0.58, f1: 0.28, w: 0.12, h: 0.075, front: 0.5, tail: 0.22, segs: 4, arc: 4, sink: 0.02 } },   // low wide flight-deck windscreen over the drooped nose
  // Reaper — an A-10 Warthog (per ref): a straight-wing, twin-tail gun platform with two fat
  // turbofans mounted HIGH on stub pylons off the rear fuselage. A SLIM fuselage (thin fr) that's
  // still deep, a slightly pointed nose, and the twin fins out at the tailplane tips.
  gunship: { ...FW_DEFAULT, fr: 0.115, fv: 0.14, span: 0.86, noseF: 1.0, tailF: -1.0,
    wingH: -0.03, dih: 0.02, wRootF: 0.22, wRootB: -0.30, wTipF: 0.16, wTipB: -0.26, hSpan: 0.36,
    engines: [], podEngines: [[-0.40, 0.27, 0.15], [-0.40, -0.27, 0.15]], podPylon: true,
    fins: [-0.34, 0.34], finF0: -0.82, finF1: -1.02, finF2: -1.08, finH: 0.44, wingGuns: true, gear: true, gearPods: true,
    noseBlunt: 2.5, boxy: 0.22, bodyTube: 0.15, tailUp: 0.04,   // slim roundish central body — the bulk reads from the wings/nacelles
    canopy: { f0: 0.60, f1: 0.16, w: 0.075, h: 0.11, front: 0.16, tail: 0.06, segs: 5, arc: 3, sink: 0.01 } },   // tall narrow fighter bubble set on the nose
  // Leviathan — an Antonov An-124 (per ref): a huge four-engine wide-body heavy freighter. A
  // long near-circular constant tube with an upswept cargo boat-tail; a swept HIGH wing set with
  // ANHEDRAL (drooping tips) carrying four big podded turbofans on underwing pylons; a tall swept
  // fin; a blunt rounded radome nose; and its signature multi-wheel 'centipede' belly gear. It's
  // a cantilever wing — NO lift struts (unlike the strut-braced Otter).
  heavy: { ...FW_DEFAULT, fr: 0.20, fv: 0.18, span: 1.05, noseF: 1.15, tailF: -1.12, hSpan: 0.46, finH: 0.66,
    wingH: 0.17, dih: -0.05, wRootF: 0.34, wRootB: -0.14, wTipF: 0.20, wTipB: -0.10,
    engines: [-0.60, -0.34, 0.34, 0.60], nacF: 0.26, nacH: 0.0, nacR: 0.095, pylons: true, windows: 6, heavyGear: true,
    noseBlunt: 3.3, noseCowl: 0.16, boxy: 0.12, bodyTube: 0.5, tailUp: 0.10,   // noseCowl floors the radome so it's a blunt An-124 nose, not a point
    canopy: { f0: 0.80, f1: 0.38, w: 0.115, h: 0.085, front: 0.30, tail: 0.10, segs: 6, arc: 5, sink: 0.025 } },   // smooth raised forward flight-deck hump behind the radome   // An-124 raised forward flight-deck hump behind the radome
};

// The starboard (right) wingtip station [f, g, h] in normalised model space — the outboard
// mid-chord point of the wing, so nav lights anchor exactly ON the wingtips instead of
// floating beside them. Mirror g for the port tip. Uses the same param fallback as the mesh
// (unknown → prop). Helis have no fixed wings → null.
export function wingtipStation(cls) {
  if (cls === 'heli') return null;
  const p = FW_PARAMS[cls] || FW_PARAMS.prop;
  return [(p.wTipF + p.wTipB) / 2, p.span, (p.wingH || 0) + (p.dih || 0)];
}

// Faces for a class at a detail level (memoised per cls+detail — geometry is static).
// detail 1 = the full-resolution mesh (hero/turntable/chase/near contacts); detail 0 = the
// coarse LOD for distant contacts, where the extra facets would be sub-pixel anyway. The
// heli mesh doesn't subdivide (its cabin is already fat/rounded), so it ignores detail.
const _cache = {};
export function aircraftFaces(cls, detail = 1) {
  const key = cls + ':' + detail;
  if (_cache[key]) return _cache[key];
  const faces = cls === 'heli' ? buildHeli() : buildFixedWing(FW_PARAMS[cls] || FW_PARAMS.prop, detail);
  _cache[key] = faces;
  return faces;
}
// A wreck: a generic hull minus its right wing, both fins, canopy, and windows — a
// stripped carcass. Built off the plain default (no gear/struts/prop) so it stays neutral.
function buildWreck() {
  if (_cache.wreck) return _cache.wreck;
  const stripped = new Set(['glass', 'window', 'fin', 'rudder', 'aileron', 'flap', 'elevator']);   // a carcass keeps no tidy control surfaces
  const faces = buildFixedWing(FW_DEFAULT).filter(f =>
    !stripped.has(f.role) && !(f.role === 'wing' && f.p.some(v => v[1] < 0)));
  _cache.wreck = faces;
  return faces;
}

// ── Procedural hull texture ───────────────────────────────────────────────────
// A single memoised grayscale panel texture (seams + rivet rows + faint noise + a
// weathering streak), mapped over each hull face in 'overlay' blend so it adds real
// surface detail WITHOUT shifting the livery colour — the same procedural-canvas trick
// the windshield's wallTex uses for buildings, so the planes gain detail with zero art
// assets. Only the flat hull panels take it; glass/gear/gun/wheels stay clean. Applied in
// the single-craft turntable (bench hero + walkaround inspect), not the tiny floor row.
const TEXTURED = new Set(['body', 'wing', 'stab', 'fin', 'nacelle', 'aileron', 'flap', 'elevator', 'rudder']);
const TEX_STRENGTH = { gloss: 0.32, satin: 0.46, matte: 0.56, weathered: 0.7 };
let _hullTex = null;
function hullTex() {
  if (_hullTex) return _hullTex;
  const S = 48, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, S, S);                          // neutral base (overlay no-op)
  for (let i = 0; i < 300; i++) {                                                    // faint noise grain
    const x = (Math.random() * S) | 0, y = (Math.random() * S) | 0, v = 128 + ((Math.random() - 0.5) * 26 | 0);
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1);
  }
  g.strokeStyle = 'rgba(74,74,74,0.85)'; g.lineWidth = 1;                            // panel seams (darker grid)
  for (const x of [0.5, 16.5, 32.5]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  for (const y of [11.5, 29.5]) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  g.fillStyle = 'rgba(186,186,186,0.8)';                                            // rivet rows along the seams
  for (const x of [16, 32]) for (let y = 4; y < S; y += 6) g.fillRect(x, y, 1, 1);
  for (const y of [11, 29]) for (let x = 4; x < S; x += 6) g.fillRect(x, y, 1, 1);
  g.fillStyle = 'rgba(98,98,98,0.22)'; g.fillRect(0, 20, S, 3);                     // a soft weathering streak
  _hullTex = c; return c;
}
// Affine texture-mapped triangle: maps texture-space (s0,s1,s2) onto screen (d0,d1,d2).
function acTexTri(ctx, img, s0, s1, s2, d0, d1, d2) {
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const det = sx1 * sy2 - sx2 * sy1; if (Math.abs(det) < 1e-6) return;
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const a = (dx1 * sy2 - dx2 * sy1) / det, b = (dy1 * sy2 - dy2 * sy1) / det;
  const cc = (dx2 * sx1 - dx1 * sx2) / det, d = (dy2 * sx1 - dy1 * sx2) / det;
  const e = d0[0] - a * s0[0] - cc * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, cc, d, e, f); ctx.drawImage(img, 0, 0);
  ctx.restore();
}
// Overlay the panel texture onto ONE projected hull face (3- or 4-point).
function overlayHull(ctx, P, strength) {
  const n = P.length; if (n < 3 || n > 4) return;
  const img = hullTex(), W = img.width, H = img.height, p = P.map(q => [q.sx, q.sy]);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath(); ctx.clip();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = strength;
  if (n === 4) { acTexTri(ctx, img, [0, 0], [W, 0], [W, H], p[0], p[1], p[2]); acTexTri(ctx, img, [0, 0], [W, H], [0, H], p[0], p[2], p[3]); }
  else acTexTri(ctx, img, [0, 0], [W, 0], [W, H], p[0], p[1], p[2]);
  ctx.restore();
}

// ── Jazz livery (procedural Memphis dry-brush splatter) ───────────────────────
// The one pattern the per-facet base/trim picker can't express: a fine squiggle over
// dry-brush zigzag bands. Baked ONCE per colour-set into an opaque bone-ground texture,
// then affine-mapped across the hull facets in BODY space (jazzUV) so the pattern is
// continuous across facets — and both flanks mirror (V keys off up/right, not the sign of
// g), exactly like a real painted livery. Seeded off the colours: same scheme → same
// splatter, so the paint never shimmers between the hangar and the sky.
export const JAZZ_ROLE = new Set(['body', 'wing', 'aileron', 'flap', 'stab', 'elevator', 'fin', 'rudder', 'nacelle']);
const JAZZ_GROUND = [238, 231, 214];   // bone undercoat (the "cup paper" the colours pop against)
const JZ_TW = 256, JZ_TH = 140;
// Supersample the baked texture: the artwork is authored in the 256×140 design space below, but
// rendered into a canvas JZ_SS× larger (via ctx.scale) so the affine hull mapping has finer texels
// to sample — crisper paint on a large close-up hull, same pattern. jazzUV scales to match. One-time
// bake per colour-set (cached), so the extra cost is paid once.
const JZ_SS = 3;
const _jazzCache = new Map();
function jzRng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function jzHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function jzResample(spine, step) {
  const out = [];
  for (let s = 0; s < spine.length - 1; s++) {
    const a = spine[s], b = spine[s + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i < n; i++) { const t = i / n; out.push([a[0] + dx * t, a[1] + dy * t, nx, ny]); }
  }
  return out;
}
function jzBrush(g, spine, color, width, rng, grain) {
  const pts = jzResample(spine, Math.max(1.5, width * 0.22)); g.fillStyle = color;
  for (const p of pts) {
    const dabs = Math.max(3, Math.round(width / 2.4));
    for (let k = 0; k < dabs; k++) {
      if (rng() < grain) continue;   // dry-brush gap
      const off = (rng() * 2 - 1) * width * 0.5, r = width * 0.12 + rng() * width * 0.14;
      g.globalAlpha = 0.55 + rng() * 0.45;
      g.beginPath(); g.ellipse(p[0] + p[2] * off, p[1] + p[3] * off, r, r * (0.65 + rng() * 0.6), 0, 0, 7); g.fill();
    }
  }
  g.globalAlpha = 1;
}
function jzZig(cx, cy, ang, axis, seg, amp, rng) {
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux, sp = [], n = Math.ceil(axis / seg), sx = cx - ux * axis / 2, sy = cy - uy * axis / 2;
  for (let i = 0; i <= n; i++) { const d = i * seg, side = i % 2 === 0 ? 1 : -1, j = (rng() * 2 - 1) * amp * 0.25; sp.push([sx + ux * d + px * (side * amp + j), sy + uy * d + py * (side * amp + j)]); }
  return sp;
}
function jzSquig(cx, cy, ang, axis, humps, amp, rng) {
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux, sp = [], steps = 64, sx = cx - ux * axis / 2, sy = cy - uy * axis / 2, ph = rng() * 6.28;
  for (let i = 0; i <= steps; i++) { const t = i / steps, d = t * axis, off = Math.sin(ph + t * humps * 6.28) * amp + Math.sin(ph * 1.7 + t * humps * 2.3 * 6.28) * amp * 0.3; sp.push([sx + ux * d + px * off, sy + uy * d + py * off]); }
  return sp;
}
export function jazzTex(c0, c1, c2, ground) {
  c0 = c0 || '#18b8c2'; c1 = c1 || '#5a2c9c'; c2 = c2 || '#c22b8c'; ground = ground || rgbStr(JAZZ_GROUND);
  const key = c0 + c1 + c2 + ground, hit = _jazzCache.get(key); if (hit) return hit;
  const cv = document.createElement('canvas'); cv.width = JZ_TW * JZ_SS; cv.height = JZ_TH * JZ_SS;
  const g = cv.getContext('2d'), W = JZ_TW, H = JZ_TH, rng = jzRng(jzHash(key) || 1);
  g.scale(JZ_SS, JZ_SS);   // draw in 256×140 design space; the canvas is JZ_SS× denser
  g.fillStyle = ground; g.fillRect(0, 0, W, H);
  const diag = Math.hypot(W, H), ang = -(22 + rng() * 10) * Math.PI / 180, cx = W / 2, cy = H / 2;
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux, gap = H * 0.17;
  for (let b = 0; b < 3; b++) {   // stacked teal zigzag bands
    const o = (b - 1) * gap + (rng() * 2 - 1) * H * 0.02;
    jzBrush(g, jzZig(cx + px * o, cy + py * o, ang, diag * 1.15, Math.max(24, W * 0.09) * (0.9 + rng() * 0.3), H * 0.12 * (0.9 + rng() * 0.4), rng), c0, H * 0.12 * (0.85 + rng() * 0.3), rng, 0.3);
  }
  jzBrush(g, jzSquig(cx, cy, ang, diag * 1.05, 3 + Math.floor(rng() * 2), H * 0.18, rng), c1, H * 0.055, rng, 0.24);          // squiggle
  jzBrush(g, jzSquig(cx + px * gap * 0.6, cy + py * gap * 0.6, ang, diag * 0.95, 4, H * 0.13, rng), c2, H * 0.04, rng, 0.3);   // accent squiggle
  const pal = [c0, c1, c2], dots = Math.round(W * H / 260);
  for (let i = 0; i < dots; i++) { g.globalAlpha = 0.5 + rng() * 0.5; g.fillStyle = pal[(rng() * 3) | 0]; g.beginPath(); g.arc(rng() * W, rng() * H, 1 + rng() * 2, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  if (_jazzCache.size > 24) _jazzCache.clear();
  _jazzCache.set(key, cv); return cv;
}
const jzClamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Body coords [f=fore, g=right, h=up] → jazz texture pixel. Fore drives U along the length;
// across drives V (up for the fuselage/tail, right for the flat wings). g's sign is dropped so
// port and starboard wear the same side-profile paint. Clamped so the hull stays on-texture.
export function jazzUV(v, role) {
  const along = 0.5 + v[0] * 0.42;
  const across = 0.5 - ((role === 'wing' || role === 'aileron' || role === 'flap') ? v[1] * 0.30 : v[2] * 0.55);
  return [jzClamp(along) * JZ_TW * JZ_SS, jzClamp(across) * JZ_TH * JZ_SS];
}
// Paint the baked jazz texture into ONE projected facet, MULTIPLY over its already-shaded bone
// fill — so the facet's own light/finish shading carries through onto the colours (the plane
// still reads 3D). `uv` are the per-vertex texture coords from jazzUV.
export function overlayJazz(ctx, P, uv, img) {
  const n = P.length; if (n < 3 || n > 4) return;
  const d = P.map(q => [q.sx, q.sy]);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d[0][0], d[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(d[i][0], d[i][1]); ctx.closePath(); ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  if (n === 4) { acTexTri(ctx, img, uv[0], uv[1], uv[2], d[0], d[1], d[2]); acTexTri(ctx, img, uv[0], uv[2], uv[3], d[0], d[2], d[3]); }
  else acTexTri(ctx, img, uv[0], uv[1], uv[2], d[0], d[1], d[2]);
  ctx.restore();
}

// Glass sheen — overlay a soft procedural highlight on a filled canopy/window pane so it
// reads as curved glass rather than a flat dark polygon: a bright top-left wash, a hot
// diagonal specular streak down the middle, and a darker lower edge. Cheap (one clipped
// gradient rect per pane), shared by every renderer (turntable + fleet + in-flight). `pts`
// are projected points with .sx/.sy.
export function glassSheen(ctx, pts) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of pts) { if (q.sx < x0) x0 = q.sx; if (q.sx > x1) x1 = q.sx; if (q.sy < y0) y0 = q.sy; if (q.sy > y1) y1 = q.sy; }
  if (x1 - x0 < 1.5 || y1 - y0 < 1.5) return;   // sub-pixel pane — not worth it
  ctx.save();
  ctx.beginPath(); ctx.moveTo(pts[0].sx, pts[0].sy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
  ctx.closePath(); ctx.clip();
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, 'rgba(196,222,238,0.34)');    // sky reflection, top-left
  g.addColorStop(0.42, 'rgba(120,150,170,0.04)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.26)');   // specular streak
  g.addColorStop(0.6, 'rgba(120,150,170,0.04)');
  g.addColorStop(1, 'rgba(34,52,66,0.22)');        // darker lower edge
  ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// ── Nose art (real, procedural decals) ────────────────────────────────────────
// Each decal is a small transparent canvas painted once, then mapped onto a panel on the
// forward fuselage side — the VISIBLE (nearer) side only, so it never bleeds through from
// behind. Front of the art = nose. Opaque art over the paint (source-over, not overlay).
const _decalCache = {};
function decalTex(id) {
  if (id in _decalCache) return _decalCache[id];
  const W = 72, H = 44, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (id === 'sharkmouth') {
    g.fillStyle = '#9c1717';                                    // red maw, opening toward the nose (left)
    g.beginPath(); g.moveTo(1, H * 0.36); g.lineTo(W * 0.62, H * 0.30); g.lineTo(W * 0.62, H * 0.70); g.lineTo(1, H * 0.68); g.closePath(); g.fill();
    g.fillStyle = '#f2f2ea';
    for (let i = 0; i < 6; i++) { const x = 4 + i * 9.5; g.beginPath(); g.moveTo(x, H * 0.35); g.lineTo(x + 6, H * 0.35); g.lineTo(x + 3, H * 0.52); g.closePath(); g.fill(); }   // upper teeth
    for (let i = 0; i < 6; i++) { const x = 8 + i * 9.5; g.beginPath(); g.moveTo(x, H * 0.69); g.lineTo(x + 6, H * 0.69); g.lineTo(x + 3, H * 0.53); g.closePath(); g.fill(); }   // lower teeth
    g.fillStyle = '#f2f2ea'; g.beginPath(); g.arc(W * 0.14, H * 0.17, 5.2, 0, 7); g.fill();
    g.fillStyle = '#101010'; g.beginPath(); g.arc(W * 0.15, H * 0.17, 2.4, 0, 7); g.fill();   // angry eye
  } else if (id === 'killmarks') {
    for (let i = 0; i < 6; i++) { const x = 10 + i * 10, y = 13;                              // a tally of enemy roundels
      g.strokeStyle = '#d33'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.stroke();
      g.fillStyle = '#d33'; g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(230,230,220,0.7)'; g.font = 'bold 8px monospace'; g.fillText('ACES', 12, 32);
  } else if (id === 'sigil') {
    g.strokeStyle = '#e8c84a'; g.lineWidth = 2.6; g.lineJoin = 'round';                       // a faction delta in a ring
    g.beginPath(); g.arc(W * 0.5, H * 0.5, 15, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(W * 0.5 - 9, H * 0.5 + 7); g.lineTo(W * 0.5, H * 0.5 - 9); g.lineTo(W * 0.5 + 9, H * 0.5 + 7); g.closePath(); g.stroke();
  } else { _decalCache[id] = null; return null; }
  _decalCache[id] = c; return c;
}
export function drawNoseArt(ctx, proj, cls, lv) {
  const id = lv?.decal; if (!id || id === 'none') return;
  const img = decalTex(id); if (!img) return;
  const p = FW_PARAMS[cls] || FW_PARAMS.prop;
  // The decal is mapped onto the ACTUAL fuselage surface, front(nose)→rear, rather than as a flat
  // billboard at the widest half-width. A billboard overshoots the rounded/boxy hull and hangs the
  // art off the edge; instead each grid vertex is pushed out to the hull's cross-section at its
  // (f, h), so the art WRAPS around the curve. It's centred on the fuselage centreline — which
  // droops with the nose — so it sits LOW on the flank (accommodating it flat first), and only curls
  // onto the shoulder/belly where it's too tall to lie flat. Reconstructs the same cross-section
  // buildFixedWing skins (radius taper + boxy superellipse) so the decal tracks the real hull.
  const fF = 0.64, fR = 0.18;                                        // forward-fuselage extent (front = nose)
  const fr = p.fr, fv = p.fv, shapeExp = 1 - (p.boxy || 0) * 0.55;
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0, OUT = 1.03;
  const radAt = (f) => { let u = Math.min(1, Math.abs(f / p.noseF)); u = u <= tube ? 0 : (u - tube) / (1 - tube); return cowl + (1 - cowl) * Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); };
  const czAt = (f) => (p.noseZ ?? 0.02) * (f / p.noseF);            // centreline height (drooped nose pulls it down)
  const surf = (f, h, sign) => {                                     // near-flank hull point at (f, h) — sign picks the flank
    const r = radAt(f), sv = clampN((h - czAt(f)) / (fv * r || 1e-6), -0.999, 0.999);
    const cosMag = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(sv), 2 / shapeExp)));
    return [f, sign * Math.pow(cosMag, shapeExp) * fr * r * OUT, h];
  };
  const mid = (fF + fR) / 2, cM = czAt(mid);
  const sign = proj(...surf(mid, cM, 1)).z <= proj(...surf(mid, cM, -1)).z ? 1 : -1;   // the flank facing you
  const hHalf = fv * 0.72;                                          // fills the flank; taller art curls over the shoulder
  const Nc = 6, Nr = 3, W = img.width, H = img.height, grid = [];
  let anyNear = false;
  for (let j = 0; j <= Nr; j++) {
    const row = [];
    for (let i = 0; i <= Nc; i++) {
      const f = fF + (fR - fF) * (i / Nc), h = czAt(f) + hHalf - 2 * hHalf * (j / Nr);   // top(j=0) → bottom
      const P = proj(...surf(f, h, sign)); row.push(P); if (P.z > 0.18) anyNear = true;
    }
    grid.push(row);
  }
  if (!anyNear) return;
  // The single decal image is UV-mapped nose→tail in WORLD space, so viewing the far (starboard/right,
  // sign=+1) flank projects it MIRRORED — the art reads backwards on that side. Flip U there only, so
  // both flanks read forward-facing (port keeps the authored orientation; starboard is un-mirrored).
  const flip = sign === 1;
  const uOf = (col) => (flip ? (Nc - col) : col) / Nc * W;
  for (let j = 0; j < Nr; j++) for (let i = 0; i < Nc; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
    if (a.z <= 0.18 || b.z <= 0.18 || c.z <= 0.18 || d.z <= 0.18) continue;             // skip cells crossing behind the eye
    const s0 = [uOf(i), j / Nr * H], s1 = [uOf(i + 1), j / Nr * H];
    const s2 = [uOf(i + 1), (j + 1) / Nr * H], s3 = [uOf(i), (j + 1) / Nr * H];
    acTexTri(ctx, img, s0, s1, s2, [a.sx, a.sy], [b.sx, b.sy], [c.sx, c.sy]);
    acTexTri(ctx, img, s0, s2, s3, [a.sx, a.sy], [c.sx, c.sy], [d.sx, d.sy]);
  }
}

// ── True-3D inspect environment ───────────────────────────────────────────────
// A ground plane drawn THROUGH the same camera as the model (so it slides + parallaxes
// correctly as you walk/orbit), instead of the fixed 2D hangar backdrop. A dark ambient
// wash + a receding grid + a soft contact pool under the craft — enough of a floor to feel
// grounded in a real space.
const FLOOR_Z = -0.27;   // ground plane, just under the wheels
function drawInspectBackdrop(ctx, w, h, venue = null, sky = null) {
  if (venue === 'helipad') {
    // Open sky over the pad — the live sky/weather palette, sea-dark toward the deck.
    const pal = skyPalette(sky), g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgbStr(pal.top)); g.addColorStop(0.5, rgbStr(pal.hor)); g.addColorStop(1, rgbStr(mix3(pal.hor, [8, 12, 18], 0.7)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0b1218'); g.addColorStop(0.55, '#0e1621'); g.addColorStop(1, '#05090d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function drawFloorGrid(ctx, proj) {
  const N = 7, NEAR = 0.2;
  const seg = (f0, g0, f1, g1) => {   // one grid line, near-plane clipped so it reaches under your feet
    let a = proj(f0, g0, FLOOR_Z), b = proj(f1, g1, FLOOR_Z);
    if (a.z <= NEAR && b.z <= NEAR) return;
    if (a.z <= NEAR) { const t = (NEAR - a.z) / (b.z - a.z); a = proj(f0 + (f1 - f0) * t, g0 + (g1 - g0) * t, FLOOR_Z); }
    else if (b.z <= NEAR) { const t = (NEAR - b.z) / (a.z - b.z); b = proj(f1 + (f0 - f1) * t, g1 + (g0 - g1) * t, FLOOR_Z); }
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  };
  const c = [proj(-N, -N, FLOOR_Z), proj(N, -N, FLOOR_Z), proj(N, N, FLOOR_Z), proj(-N, N, FLOOR_Z)];
  if (c.every(q => q.z > NEAR)) {   // floor fill (skip if a corner is behind — the grid still reads)
    ctx.fillStyle = 'rgba(16,22,28,0.92)';
    ctx.beginPath(); ctx.moveTo(c[0].sx, c[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].sx, c[i].sy); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120,150,175,0.16)'; ctx.lineWidth = 1;
  for (let i = -N; i <= N; i++) { seg(i, -N, i, N); seg(-N, i, N, i); }
  const o = proj(0, 0, FLOOR_Z);   // a soft contact pool under the craft
  if (o.z > NEAR) {
    const rg = ctx.createRadialGradient(o.sx, o.sy, 1, o.sx, o.sy, 66);
    rg.addColorStop(0, 'rgba(143,208,255,0.12)'); rg.addColorStop(1, 'rgba(143,208,255,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(o.sx, o.sy, 66, 0, 7); ctx.fill();
  }
}

// ── Walk-inspect hangar room ──────────────────────────────────────────────────
// A 3D-projected industrial bay wrapped around the plane for the first-person WALK camera —
// drawn through the SAME free `proj` as the floor grid + model, so it holds still in world
// space as you walk. Four dark walls + a dark ceiling, and — on the wall the nose points at —
// an OPEN BAY DOOR onto the real outside sky/weather (skyPalette: the same read the floor
// scene and the flight windshield use). Painted before the floor grid + plane so both sit in it.
const ROOM_R = 6.6, ROOM_CEIL = 2.7, ROOM_NEAR = 0.2;
// Sutherland–Hodgman clip of a MODEL-space polygon against the camera near plane (keep proj
// depth > near), interpolating model points along crossing edges. So a wall/ceiling that swings
// partway behind the eye is TRIMMED to the visible slice, not dropped whole — which is what made
// the walls flash to black at grazing angles. Returns the clipped model polygon (may be empty).
function clipNear(modelPts, proj) {
  const zc = modelPts.map(p => ({ m: p, z: proj(p[0], p[1], p[2]).z })), out = [];
  for (let i = 0; i < zc.length; i++) {
    const a = zc[i], b = zc[(i + 1) % zc.length], ain = a.z > ROOM_NEAR, bin = b.z > ROOM_NEAR;
    if (ain) out.push(a.m);
    if (ain !== bin) { const t = (ROOM_NEAR - a.z) / (b.z - a.z); out.push([a.m[0] + (b.m[0] - a.m[0]) * t, a.m[1] + (b.m[1] - a.m[1]) * t, a.m[2] + (b.m[2] - a.m[2]) * t]); }
  }
  return out;
}
function drawInspectRoom(ctx, proj, sky) {
  const R = ROOM_R, F0 = FLOOR_Z, C0 = ROOM_CEIL;
  // Near-clip a model polygon, project it, fill it (style may depend on the projected pts).
  const poly = (modelPts, styleFn) => {
    const cl = clipNear(modelPts, proj); if (cl.length < 3) return false;
    const P = cl.map(p => proj(p[0], p[1], p[2]));
    ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath();
    ctx.fillStyle = styleFn(P); ctx.fill(); return true;
  };
  poly([[-R, -R, C0], [R, -R, C0], [R, R, C0], [-R, R, C0]], () => '#10161c');   // ceiling
  // A bank of overhead work-lights: four parallel strip fixtures hung just under the ceiling —
  // a dark housing + a bright emissive tube, each with a soft screen-space bloom so the bay
  // reads as actively lit from above. Drawn after the ceiling, before the walls/plane.
  const zL = C0 - 0.05, gHalf = 3.6;
  for (const f of [-3.4, -1.1, 1.2, 3.5]) {
    poly([[f - 0.22, -gHalf, zL], [f + 0.22, -gHalf, zL], [f + 0.22, gHalf, zL], [f - 0.22, gHalf, zL]], () => 'rgb(24,28,34)');   // housing
    poly([[f - 0.1, -gHalf + 0.15, zL - 0.01], [f + 0.1, -gHalf + 0.15, zL - 0.01], [f + 0.1, gHalf - 0.15, zL - 0.01], [f - 0.1, gHalf - 0.15, zL - 0.01]], () => 'rgb(230,238,250)');   // emissive tube
    for (let gg = -gHalf + 0.4; gg <= gHalf - 0.4; gg += 0.9) {   // soft bloom down the tube
      const c = proj(f, gg, zL - 0.02); if (c.z <= ROOM_NEAR) continue;
      const rad = Math.max(10, Math.min(72, 150 / c.z));
      const rg = ctx.createRadialGradient(c.sx, c.sy, 1, c.sx, c.sy, rad);
      rg.addColorStop(0, 'rgba(214,228,246,0.28)'); rg.addColorStop(1, 'rgba(214,228,246,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(c.sx, c.sy, rad, 0, 7); ctx.fill();
    }
  }
  const wallGrad = (P) => { const ys = P.map(q => q.sy), g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys)); g.addColorStop(0, '#2b343d'); g.addColorStop(1, '#151c23'); return g; };
  const walls = [
    [[R, -R, F0], [R, R, F0], [R, R, C0], [R, -R, C0]],       // +f (nose)
    [[-R, R, F0], [-R, -R, F0], [-R, -R, C0], [-R, R, C0]],   // -f (tail) → bay door BEHIND the plane (matches the floor view)
    [[-R, R, F0], [R, R, F0], [R, R, C0], [-R, R, C0]],       // +g
    [[R, -R, F0], [-R, -R, F0], [-R, -R, C0], [R, -R, C0]],   // -g
  ];
  walls.forEach((c, i) => { if (poly(c, wallGrad) && i === 1) drawInspectBayDoor(ctx, proj, sky, -R, F0); });
}
// The open bay door in the -f (tail) wall. The world BEYOND it is REAL 3D geometry drawn through
// the same camera — a tarmac apron receding to the horizon, a nearby AIR-TRAFFIC-CONTROL TOWER,
// and rows of lit-up buildings + rooftop billboards at staggered depths — so it gains true
// parallax as you walk, instead of a flat billboard. Sky + ground + structures are clipped to the
// door opening and tinted by the live sky/weather palette; the live weather (rain/snow/haze) and
// its lightning (sky.fx from hangar-ambience) animate over the top. The whole diorama sells that
// the hangar sits in the same world/weather the player is actually in.
function drawInspectBayDoor(ctx, proj, sky, fWall, F0) {
  const dH = 2.6, dTop = 2.0;
  const door = clipNear([[fWall, -dH, F0], [fWall, dH, F0], [fWall, dH, dTop], [fWall, -dH, dTop]], proj);
  if (door.length < 3) return;
  const DP = door.map(p => proj(p[0], p[1], p[2]));
  const pal = skyPalette(sky);
  const fx = sky?.fx || {};
  const night = pal.night, wx = pal.weather;
  const xs = DP.map(q => q.sx), ys = DP.map(q => q.sy);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yTop = Math.min(...ys), yBot = Math.max(...ys), dw = x1 - x0, dh = yBot - yTop;
  const now = performance.now() / 1000;
  const fillModel = (pts, style) => {   // project + fill a model polygon out beyond the door
    const P = pts.map(p => proj(p[0], p[1], p[2])); if (P.some(q => q.z <= ROOM_NEAR)) return;
    ctx.fillStyle = style; ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath(); ctx.fill();
  };
  ctx.save();
  ctx.beginPath(); ctx.moveTo(DP[0].sx, DP[0].sy); for (let i = 1; i < DP.length; i++) ctx.lineTo(DP[i].sx, DP[i].sy); ctx.closePath(); ctx.clip();
  // 1) Sky — the far backdrop, filling the whole opening (ground + structures paint over the lower half).
  const sg = ctx.createLinearGradient(0, yTop - dh, 0, yBot);
  sg.addColorStop(0, rgbStr(pal.top)); sg.addColorStop(1, rgbStr(pal.hor));
  ctx.fillStyle = sg; ctx.fillRect(x0 - 6, yTop - dh, dw + 12, dh * 2 + 6);
  // Stars in a clear night sky (deterministic, upper half only).
  if (night > 0.55 && /clear/.test(wx)) {
    ctx.fillStyle = 'rgba(228,236,255,0.8)';
    for (let i = 0; i < 44; i++) ctx.fillRect(x0 + hash01(i * 5.1) * dw, yTop - dh * 0.4 + hash01(i * 9.7) * dh * 0.9, 1, 1);
  }
  // 2) Sun / moon (clear skies) — a soft disc up in the sky, before the ground/blocks so a low sun
  //    sets behind them.
  if (/^(clear|dust)$/.test(wx)) {
    const sx = x0 + dw * (night > 0.4 ? 0.28 : 0.68), sy = yTop + dh * 0.26, disc = night > 0.4 ? [220, 224, 236] : [255, 246, 214];
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, dw * 0.14);
    rg.addColorStop(0, rgbStr(disc, 0.92)); rg.addColorStop(1, rgbStr(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, dw * 0.14, 0, 7); ctx.fill();
  }
  // 3) Tarmac apron — one big ground quad from just outside the sill running to the far distance,
  //    laid down before the structures so each base sits on it. A dashed centreline hints a taxiway.
  const out = fWall - 0.15;
  const gp = [[out, -16, F0], [out, 16, F0], [-46, 16, F0], [-46, -16, F0]].map(p => proj(p[0], p[1], p[2]));
  if (!gp.some(q => q.z <= ROOM_NEAR)) {
    const gy = gp.map(q => q.sy), gg = ctx.createLinearGradient(0, Math.min(...gy), 0, Math.max(...gy));
    gg.addColorStop(0, rgbStr(mix3(pal.hor, [42, 46, 52], 0.35))); gg.addColorStop(1, 'rgb(24,28,33)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(gp[0].sx, gp[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(gp[i].sx, gp[i].sy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(196,180,90,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([8, 10]);
    ctx.beginPath();
    for (let ff = out - 0.5; ff > -30; ff -= 1.4) { const p = proj(ff, 0, F0 + 0.005); if (p.z <= ROOM_NEAR) break; ff === out - 0.5 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // 4) Distant buildings — three depth bands (far → near so nearer blocks occlude). Far ones are
  //    hazed toward the horizon colour + shorter; near ones darker + taller, with a receding side
  //    face (so they read as massed BLOCKS, not flat cutouts), lit window grids, and the odd
  //    rooftop billboard. Deterministic layout (seeded off k+band) so nothing jitters frame to frame.
  const litRGB = night > 0.4 ? [255, 216, 150] : [150, 170, 188];
  const litProb = night > 0.4 ? 0.5 : 0.16;
  const bands = [
    { f: -32, haze: 0.34, tint: [24, 28, 34], step: 2.7, hw: 1.05, hmin: 0.45, hmax: 1.35, win: false, sign: false },
    { f: -22, haze: 0.52, tint: [32, 37, 44], step: 3.1, hw: 1.25, hmin: 0.7, hmax: 2.0, win: true, sign: false },
    { f: -14, haze: 0.7, tint: [42, 48, 56], step: 3.7, hw: 1.5, hmin: 0.95, hmax: 2.7, win: true, sign: true },
  ];
  for (const b of bands) {
    const front = rgbStr(mix3(pal.hor, b.tint, b.haze));
    const side = rgbStr(mix3(pal.hor, b.tint.map(v => v * 0.72), b.haze));
    for (let k = -3; k <= 3; k++) {
      const s = Math.abs(k * 31 + Math.round(b.f) * 17);
      const gc = k * b.step + ((s % 7) - 3) * 0.18, top = F0 + b.hmin + ((s % 11) / 11) * (b.hmax - b.hmin), f = b.f + ((s % 4) - 1.5) * 0.8;
      const sgn = gc >= 0 ? 1 : -1, fBack = f - Math.min(2.2, b.hw * 1.5);
      fillModel([[f, gc + sgn * b.hw, F0], [fBack, gc + sgn * b.hw, F0], [fBack, gc + sgn * b.hw, top - 0.05], [f, gc + sgn * b.hw, top]], side);   // receding side wall → real massing
      fillModel([[f, gc - b.hw, F0], [f, gc + b.hw, F0], [f, gc + b.hw, top], [f, gc - b.hw, top]], front);                                        // lit front face
      if (b.win) bayWindows(fillModel, f, gc - b.hw, gc + b.hw, F0, top, s, litRGB, litProb);
      if (b.sign && (s % 3 === 0)) bayBillboard(ctx, proj, fillModel, f, gc, top, s);
    }
  }
  // 5) The ATC tower — a nearby, unmistakable landmark: a tapered shaft, a slant-glass control cab,
  //    a mast with a red obstruction blink, and an alternating white/green airport beacon.
  drawATCTower(ctx, proj, fillModel, pal, night);
  // 6) Live weather over the diorama — precip animates only when Motion/WeatherFX is on (fx.motion).
  if (fx.motion && /rain|storm/.test(wx)) {
    const slant = 3 + Math.min(8, (sky?.wind || 0) / 6);
    ctx.strokeStyle = rgbStr([192, 212, 236], wx === 'storm' ? 0.55 : 0.42); ctx.lineWidth = 1.2;
    for (let i = 0; i < 30; i++) {
      const px = x0 + (hash01(i * 1.3) * dw + now * 90) % dw;
      const py = yTop + (hash01(i * 2.7) * dh + now * 560) % dh;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - slant, py + 12); ctx.stroke();
    }
  } else if (fx.motion && wx === 'snow') {
    // Blizzard proxy: snow collapses to one 'snow' string server-side, so wind is the only
    // "how hard is it coming down" signal we get — calm flurry ⇒ 0, wind-blown whiteout ⇒ 1.
    const bliz = Math.min(1, (sky?.wind || 0) / 45);
    // Whiteout haze over the diorama — a thin milky wash in calm snow, a dense veil in a blizzard.
    ctx.fillStyle = rgbStr([236, 242, 250], 0.08 + bliz * 0.42);
    ctx.fillRect(x0, yTop, dw, dh);
    // Driving snow: a straight, purposeful fall (no lazy flutter), raked by the wind. Motion is
    // time-driven in a normalized [0,1] track then mapped into the door box, so walking only
    // parallax-scales the flakes — it never jumps or speeds up their fall.
    const slant = 2 + bliz * 16, fall = 0.5 + bliz * 0.8;
    ctx.fillStyle = rgbStr([240, 246, 253], 0.85);
    const count = 26 + Math.round(bliz * 34);
    for (let i = 0; i < count; i++) {
      const ny = (hash01(i * 3.1) + now * fall) % 1;
      const px = x0 + (hash01(i * 1.7) * dw + ny * slant) % dw;
      const py = yTop + ny * dh;
      ctx.beginPath(); ctx.arc(px, py, 1.3, 0, 7); ctx.fill();
    }
  }
  if (wx === 'fog' || wx === 'cloudy') {   // low haze rolling across the apron (static, always)
    const fH = dh * 0.42, fg = ctx.createLinearGradient(0, yBot - fH, 0, yBot);
    fg.addColorStop(0, 'rgba(198,204,212,0)'); fg.addColorStop(1, `rgba(198,204,212,${wx === 'fog' ? 0.4 : 0.22})`);
    ctx.fillStyle = fg; ctx.fillRect(x0 - 6, yBot - fH, dw + 12, fH);
  }
  // 7) Lightning — the full-door flash (lights the whole scene) then the bolt on top of it.
  if (fx.flash > 0.01) { ctx.fillStyle = `rgba(222,232,255,${Math.min(0.72, fx.flash * 0.72)})`; ctx.fillRect(x0 - 6, yTop - dh, dw + 12, dh * 2 + 6); }
  if (fx.bolt && fx.bolt.seg?.length > 1) {
    const a = Math.max(0, 1 - (performance.now() - fx.bolt.born) / fx.bolt.dur);
    ctx.save(); ctx.strokeStyle = `rgba(232,242,255,${a})`; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(180,210,255,0.9)'; ctx.shadowBlur = 12;
    ctx.beginPath();
    fx.bolt.seg.forEach((p, i) => { const sx = x0 + p[0] * dw, sy = yTop + p[1] * dh; i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(36,44,52,0.95)'; ctx.lineWidth = 4;                  // heavy door frame
  ctx.beginPath(); ctx.moveTo(DP[0].sx, DP[0].sy); for (let i = 1; i < DP.length; i++) ctx.lineTo(DP[i].sx, DP[i].sy); ctx.closePath(); ctx.stroke();
}
// ── Walk-inspect: the Echelon's open boat helipad ─────────────────────────────
// The yacht variant of drawInspectRoom — no roof, no walls. An open non-slip deck
// disc (painted 'H' + ring of breathing red pad lights), a low guard rail around the
// water's edge, the smoked-glass deckhouse rising forward of the pad, and the Basin
// lapping out to a distant lit skyline on every open side. Same free `proj` as the
// grid + model, so it holds in world space as you walk; skyPalette ties the water +
// sky to the live weather. Drawn before the model so the craft sits ON the pad.
const DECK_R = 2.55;
function drawHelipadRoom(ctx, proj, sky, w, h) {
  const F0 = FLOOR_Z, pal = skyPalette(sky), night = pal.night, wx = pal.weather;
  // Near-clipped projected fill (walls/water span the camera near plane).
  const poly = (modelPts, style) => {
    const cl = clipNear(modelPts, proj); if (cl.length < 3) return;
    const P = cl.map(p => proj(p[0], p[1], p[2]));
    ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath();
    ctx.fillStyle = typeof style === 'function' ? style(P) : style; ctx.fill();
  };
  // A projected model quad with NO clipping (structures out past the near plane) — skip if any
  // corner is behind the eye. Used for the deckhouse + skyline blocks that never straddle it.
  const fillModel = (pts, style) => {
    const P = pts.map(p => proj(p[0], p[1], p[2])); if (P.some(q => q.z <= ROOM_NEAR)) return;
    ctx.fillStyle = style; ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath(); ctx.fill();
  };
  // 1) The Basin — one big water plane at deck level out to the far distance; the deck +
  //    structures paint over its middle. Gradient: hazed horizon far, dark water near.
  poly([[-46, -46, F0], [46, -46, F0], [46, 46, F0], [-46, 46, F0]], (P) => {
    const ys = P.map(q => q.sy), g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    g.addColorStop(0, rgbStr(mix3(pal.hor, [16, 26, 40], 0.55))); g.addColorStop(1, rgbStr(mix3([10, 16, 24], [4, 8, 14], night)));
    return g;
  });
  // 2) Distant skyline ringing the Basin — a circle of hazed slabs, each a tangential
  //    billboard so the city wraps the horizon as you turn. Lit windows at night.
  const litRGB = night > 0.4 ? [255, 214, 150] : [150, 170, 188];
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2, R = 30 + hash01(i * 3.3) * 5;
    const cf = Math.cos(a) * R, cg = Math.sin(a) * R, tf = -Math.sin(a), tg = Math.cos(a);
    const hw = 1.1 + hash01(i * 7.1) * 1.5, top = F0 + 0.9 + hash01(i * 5.7) * 2.4;
    const haze = clampN(0.34 + (R - 30) * 0.06, 0.3, 0.6);
    const front = rgbStr(mix3(pal.hor, [26, 31, 38], haze));
    fillModel([[cf - tf * hw, cg - tg * hw, F0], [cf + tf * hw, cg + tg * hw, F0], [cf + tf * hw, cg + tg * hw, top], [cf - tf * hw, cg - tg * hw, top]], front);
    if (night > 0.4 && hash01(i * 2.1) < 0.6) {   // a couple of lit windows
      for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c++) {
        if (hash01(i * 9.1 + r * 3.7 + c * 1.9) < 0.45) continue;
        const wf = cf + tf * c * hw * 0.5, wg = cg + tg * c * hw * 0.5, z = F0 + 0.4 + r * (top - F0 - 0.4) / 3;
        fillModel([[wf - tf * 0.14, wg - tg * 0.14, z], [wf + tf * 0.14, wg + tg * 0.14, z], [wf + tf * 0.14, wg + tg * 0.14, z + 0.2], [wf - tf * 0.14, wg - tg * 0.14, z + 0.2]], rgbStr(litRGB, 0.9));
      }
    }
  }
  // 3) The deck — a dark non-slip disc, its rim caught by a thin light line.
  const deckPts = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; deckPts.push([Math.cos(a) * DECK_R, Math.sin(a) * DECK_R, F0]); }
  poly(deckPts, 'rgb(19,22,27)');
  // 4) The painted landing circle + 'H'.
  ctx.strokeStyle = 'rgba(208,222,236,0.5)'; ctx.lineWidth = 3; ctx.beginPath();
  let started = false;
  for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2, p = proj(Math.cos(a) * 1.85, Math.sin(a) * 1.85, F0 + 0.002); if (p.z <= ROOM_NEAR) { started = false; continue; } started ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); started = true; }
  ctx.stroke();
  const Hcol = 'rgba(224,232,240,0.6)', z2 = F0 + 0.003;
  const bar = (f0, f1, g0, g1) => poly([[f0, g0, z2], [f1, g0, z2], [f1, g1, z2], [f0, g1, z2]], Hcol);
  bar(-0.7, 0.7, -0.55, -0.39); bar(-0.7, 0.7, 0.39, 0.55); bar(-0.1, 0.1, -0.39, 0.39);
  // 5) Recessed pad lights around the rim — a slow, patient red, each with a soft bloom.
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, p = proj(Math.cos(a) * (DECK_R - 0.14), Math.sin(a) * (DECK_R - 0.14), F0 + 0.02);
    if (p.z <= ROOM_NEAR) continue;
    const r = clampN(20 / p.z, 2, 9);
    const rg = ctx.createRadialGradient(p.sx, p.sy, 1, p.sx, p.sy, r * 1.7);
    rg.addColorStop(0, 'rgba(255,84,66,0.55)'); rg.addColorStop(1, 'rgba(255,84,66,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 1.7, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,96,74,0.95)'; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.42, 0, 7); ctx.fill();
  }
  // 6) Low guard rail around the OPEN edge (skip the forward wedge where the deckhouse is).
  const railZ = F0 + 0.34, open = (a) => Math.cos(a) < 0.5;
  ctx.strokeStyle = 'rgba(150,168,184,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); started = false;
  for (let k = 0; k <= 44; k++) { const a = k / 44 * Math.PI * 2; if (!open(a)) { started = false; continue; } const p = proj(Math.cos(a) * (DECK_R + 0.04), Math.sin(a) * (DECK_R + 0.04), railZ); if (p.z <= ROOM_NEAR) { started = false; continue; } started ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); started = true; }
  ctx.stroke();
  for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2; if (!open(a)) continue; const bx = Math.cos(a) * (DECK_R + 0.04), bg = Math.sin(a) * (DECK_R + 0.04), p0 = proj(bx, bg, F0), p1 = proj(bx, bg, railZ); if (p0.z <= ROOM_NEAR || p1.z <= ROOM_NEAR) continue; ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke(); }
  // 7) The deckhouse — a stepped mirror-black superstructure forward of the pad, a smoked-
  //    glass band, and a masthead beacon. Fixed shades (no cull): front lit, sides darker.
  const hf0 = DECK_R - 0.15, hf1 = DECK_R + 3.2, hg = 1.95, hz1 = F0 + 1.35, hz2 = F0 + 2.15;
  const glass = (P) => { const ys = P.map(q => q.sy), g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys)); g.addColorStop(0, 'rgba(58,80,104,0.9)'); g.addColorStop(1, 'rgba(24,34,46,0.95)'); return g; };
  // sides (recede to +f) — drawn first so the front face overlaps them
  for (const s of [1, -1]) fillModel([[hf0, s * hg, F0], [hf1, s * hg, F0], [hf1, s * hg, hz2], [hf0, s * hg, hz1]], 'rgb(12,13,17)');
  fillModel([[hf0, -hg, hz2 - 0.005], [hf0, hg, hz2 - 0.005], [hf1, hg, hz2], [hf1, -hg, hz2]], 'rgb(20,22,28)');   // roof
  fillModel([[hf0, -hg, F0], [hf0, hg, F0], [hf0, hg, hz1], [hf0, -hg, hz1]], 'rgb(16,17,22)');                     // lower hull front (mirror-black)
  poly([[hf0, -hg, hz1 - 0.02], [hf0, hg, hz1 - 0.02], [hf0, hg, hz2], [hf0, -hg, hz2]], glass);                    // smoked-glass band
  // Glass mullions.
  ctx.strokeStyle = 'rgba(120,150,178,0.35)'; ctx.lineWidth = 1;
  for (let gg = -hg + 0.4; gg < hg; gg += 0.5) { const a = proj(hf0, gg, hz1 - 0.02), b = proj(hf0, gg, hz2); if (a.z <= ROOM_NEAR || b.z <= ROOM_NEAR) continue; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
  // Masthead beacon — a small warm light atop the deckhouse.
  const bc = proj(hf0 + 1.2, 0, hz2 + 0.9);
  if (bc.z > ROOM_NEAR) {
    const r = clampN(24 / bc.z, 3, 12), rg = ctx.createRadialGradient(bc.sx, bc.sy, 1, bc.sx, bc.sy, r * 2);
    rg.addColorStop(0, 'rgba(255,238,200,0.8)'); rg.addColorStop(1, 'rgba(255,238,200,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(bc.sx, bc.sy, r * 2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,214,0.95)'; ctx.beginPath(); ctx.arc(bc.sx, bc.sy, r * 0.4, 0, 7); ctx.fill();
  }
  // 8) Live precip over the open deck (only with Motion/WeatherFX on).
  const fx = sky?.fx || {};
  if (fx.motion && /rain|storm/.test(wx)) {
    const now = performance.now() / 1000, slant = 3 + Math.min(8, (sky?.wind || 0) / 6);
    ctx.strokeStyle = rgbStr([192, 212, 236], wx === 'storm' ? 0.5 : 0.36); ctx.lineWidth = 1.1;
    for (let i = 0; i < 34; i++) { const px = (hash01(i * 1.3) * w + now * 90) % w, py = (hash01(i * 2.7) * h + now * 560) % h; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - slant, py + 12); ctx.stroke(); }
  }
}

// Deterministic 0..1 hash — a stable per-index value so windows/billboards/stars don't jitter.
const hash01 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// A grid of lit/dark windows on a building's camera-facing front face (constant f), in MODEL space
// so it parallaxes with the block. Warm-lit at night, dark glass by day; seeded per pane.
function bayWindows(fillModel, f, g0, g1, zBase, zTop, seed, litRGB, litProb) {
  const cols = 3, rows = Math.max(2, Math.min(6, Math.round((zTop - zBase) / 0.34)));
  const cw = (g1 - g0) / cols, rh = (zTop - zBase) / rows, mx = cw * 0.26, mz = rh * 0.28;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = hash01(seed + r * 7.3 + c * 13.1) < litProb;
    const a = g0 + c * cw + mx, bb = g0 + (c + 1) * cw - mx, zb = zBase + r * rh + mz, zt = zBase + (r + 1) * rh - mz;
    fillModel([[f, a, zb], [f, bb, zb], [f, bb, zt], [f, a, zt]], lit ? rgbStr(litRGB, 0.92) : 'rgba(12,15,20,0.5)');
  }
}
// A glowing rooftop billboard on a near building — a support strut + a saturated emissive panel,
// plus a soft screen-space bloom so it reads as a lit sign in the skyline.
function bayBillboard(ctx, proj, fillModel, f, gc, zTop, seed) {
  const hue = Math.floor(hash01(seed * 3.13) * 360), bw = 0.85, zb = zTop + 0.12, zt = zb + 0.5;
  fillModel([[f, gc - 0.03, zTop], [f, gc + 0.03, zTop], [f, gc + 0.03, zb], [f, gc - 0.03, zb]], 'rgba(18,20,24,0.85)');   // support
  fillModel([[f, gc - bw, zb], [f, gc + bw, zb], [f, gc + bw, zt], [f, gc - bw, zt]], `hsl(${hue},82%,58%)`);              // panel
  const c0 = proj(f, gc, (zb + zt) / 2);
  if (c0.z > ROOM_NEAR) {
    const rad = Math.max(12, Math.min(64, 320 / c0.z));
    const rg = ctx.createRadialGradient(c0.sx, c0.sy, 1, c0.sx, c0.sy, rad);
    rg.addColorStop(0, `hsla(${hue},82%,60%,0.45)`); rg.addColorStop(1, `hsla(${hue},82%,60%,0)`);
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(c0.sx, c0.sy, rad, 0, 7); ctx.fill();
  }
}
// The air-traffic-control tower off to one side of the apron — the apron's hero landmark, so it's
// built up from a lot of small faces rather than a few big ones: a splayed plinth base, a banded
// tapered shaft with a service ladder, an outrigger catwalk gallery with a railing, a wider control
// cab with outward-leaning mullioned glass and a parapet roof, and a roof equipment cluster (a
// sweeping surveillance-radar bar, whip antennas, a dish) topped by a mast carrying a red
// obstruction blink and an alternating white/green rotating airport beacon. Everything is model-space
// so it parallaxes as you walk; faces are emitted strictly back(side)→front, bottom→top for painter's
// depth (fillModel has no z-buffer). Only the +f (front) and +g (side) faces ever face the camera.
function drawATCTower(ctx, proj, fillModel, pal, night) {
  const g = 8.4, f = -20, base = FLOOR_Z, fB = f - 0.9, t = performance.now() / 1000;
  // Concrete tones keyed to the sky so the tower sits in the same light as the diorama; the receding
  // +g side is a shade darker than the camera-facing front. `p` = palette-mix helper.
  const p = (rgb, k = 0.62) => rgbStr(mix3(pal.hor, rgb, k));
  const shaftF = p([54, 60, 68]), shaftS = p([34, 38, 44]);
  const trimF = p([74, 82, 92]), trimS = p([48, 54, 62]);
  const steelF = 'rgb(38,42,48)', steelS = 'rgb(24,27,32)';
  // A tapered vertical segment centred on g: receding +g side first, then the camera-facing front.
  const tier = (zb, zt, wb, wt, cF, cS) => {
    fillModel([[f, g + wb, zb], [fB, g + wb * 0.9, zb], [fB, g + wt * 0.9, zt], [f, g + wt, zt]], cS);   // +g side
    fillModel([[f, g - wb, zb], [f, g + wb, zb], [f, g + wt, zt], [f, g - wt, zt]], cF);                  // front
  };
  // A thin horizontal band/ledge (slightly proud of the shaft) — its underside + front fascia.
  const band = (z, w, h, cF, cS) => {
    fillModel([[f - 0.02, g - w, z], [f - 0.02, g + w, z], [fB, g + w * 0.9, z], [fB, g - w * 0.9, z]], cS);   // underside
    fillModel([[f - 0.02, g - w, z], [f - 0.02, g + w, z], [f - 0.02, g + w, z + h], [f - 0.02, g - w, z + h]], cF);   // fascia
  };

  // 1) Splayed plinth base — a wide short block flaring to the ground, with a dark service doorway.
  const plZ = base + 0.5;
  tier(base, plZ, 0.9, 0.66, p([46, 52, 60]), p([30, 34, 40]));
  fillModel([[f - 0.02, g - 0.16, base + 0.04], [f - 0.02, g + 0.16, base + 0.04], [f - 0.02, g + 0.13, base + 0.34], [f - 0.02, g - 0.13, base + 0.34]], 'rgb(14,16,20)');   // doorway

  // 2) Banded, tapered shaft — split into stacked segments with proud trim ledges between them, so
  //    the column reads as poured concrete lifts rather than one smooth cone.
  const shaftTop = base + 3.4;
  const lifts = [[plZ, 0.62], [plZ + 0.95, 0.55], [plZ + 1.9, 0.48], [shaftTop, 0.4]];
  for (let i = 0; i < lifts.length - 1; i++) {
    tier(lifts[i][0], lifts[i + 1][0], lifts[i][1], lifts[i + 1][1], shaftF, shaftS);
    band(lifts[i + 1][0] - 0.03, lifts[i + 1][1] + 0.05, 0.08, trimF, trimS);
  }
  // Service ladder up the front — two dark rails + evenly-spaced rungs.
  for (const rg of [-0.06, 0.06]) fillModel([[f - 0.03, g + rg - 0.012, plZ], [f - 0.03, g + rg + 0.012, plZ], [f - 0.03, g + rg + 0.012, shaftTop], [f - 0.03, g + rg - 0.012, shaftTop]], 'rgba(16,18,22,0.85)');
  for (let z = plZ + 0.14; z < shaftTop - 0.1; z += 0.26) fillModel([[f - 0.03, g - 0.07, z], [f - 0.03, g + 0.07, z], [f - 0.03, g + 0.07, z + 0.03], [f - 0.03, g - 0.07, z + 0.03]], 'rgba(16,18,22,0.8)');

  // 3) Outrigger catwalk gallery — a deck wider than the cab wrapping the top of the shaft, with an
  //    underside, a fascia, and a railing (posts + top rail) around the front and +g side.
  const galZ = shaftTop, gW = 1.0, galF = -0.06;   // galF: front deck edge pulled toward camera
  fillModel([[f + galF, g - gW, galZ], [f + galF, g + gW, galZ], [fB - 0.1, g + gW * 0.9, galZ], [fB - 0.1, g - gW * 0.9, galZ]], steelS);   // deck underside
  band(galZ, gW, 0.1, steelF, steelS);   // deck fascia lip
  const railZ = galZ + 0.24;
  fillModel([[f + galF, g - gW, railZ - 0.03], [f + galF, g + gW, railZ - 0.03], [f + galF, g + gW, railZ], [f + galF, g - gW, railZ]], 'rgba(150,160,172,0.8)');   // front top rail
  fillModel([[f + galF, g + gW, railZ - 0.03], [fB - 0.1, g + gW * 0.9, railZ - 0.03], [fB - 0.1, g + gW * 0.9, railZ], [f + galF, g + gW, railZ]], 'rgba(120,130,142,0.7)');   // side top rail
  for (let gg = -gW + 0.12; gg <= gW - 0.06; gg += 0.32) fillModel([[f + galF, g + gg - 0.015, galZ], [f + galF, g + gg + 0.015, galZ], [f + galF, g + gg + 0.015, railZ], [f + galF, g + gg - 0.015, railZ]], 'rgba(140,150,162,0.55)');   // front railing posts

  // 4) Control cab — the wider glass box, its front leaning OUT over the gallery (classic tower rake).
  const cabZb = galZ + 0.06, cabZt = cabZb + 0.82, cw = 0.88, lean = 0.2;
  fillModel([[f, g + cw, cabZb], [fB, g + cw * 0.92, cabZb], [fB, g + cw * 0.92, cabZt], [f - lean, g + cw, cabZt]], p([26, 30, 36], 0.6));   // cab +g side wall
  const glass = night > 0.4 ? [150, 210, 184] : [96, 138, 156];
  fillModel([[f, g - cw, cabZb + 0.05], [f, g + cw, cabZb + 0.05], [f - lean, g + cw, cabZt], [f - lean, g - cw, cabZt]], rgbStr(glass, 0.94));   // raked glass band
  // Lit consoles glimpsed behind the glass at night — a few warm specks low in the pane.
  if (night > 0.4) for (const gg of [-cw * 0.6, -cw * 0.15, cw * 0.35]) fillModel([[f - lean * 0.35, g + gg - 0.05, cabZb + 0.12], [f - lean * 0.35, g + gg + 0.05, cabZb + 0.12], [f - lean * 0.4, g + gg + 0.05, cabZb + 0.24], [f - lean * 0.4, g + gg - 0.05, cabZb + 0.24]], 'rgba(255,206,150,0.8)');
  // Mullions — dark verticals over the glass, plus a horizontal transom, so it reads as a window band.
  for (const gg of [-cw * 0.66, -cw * 0.33, 0, cw * 0.33, cw * 0.66]) fillModel([[f - lean * 0.5, g + gg - 0.02, cabZb + 0.06], [f - lean * 0.5, g + gg + 0.02, cabZb + 0.06], [f - lean, g + gg + 0.02, cabZt], [f - lean, g + gg - 0.02, cabZt]], 'rgba(16,20,26,0.78)');
  fillModel([[f - lean * 0.62, g - cw, cabZb + 0.5], [f - lean * 0.62, g + cw, cabZb + 0.5], [f - lean * 0.66, g + cw, cabZb + 0.55], [f - lean * 0.66, g - cw, cabZb + 0.55]], 'rgba(16,20,26,0.7)');   // transom
  // Parapet roof — a shallow slab overhanging the glass, with a thin fascia edge.
  const roofZ = cabZt, roofZt = roofZ + 0.16;
  fillModel([[f - lean, g + cw, roofZ], [fB, g + cw * 0.92, roofZ], [fB, g + cw * 0.92, roofZt], [f - lean, g + cw, roofZt]], 'rgb(30,34,40)');   // roof +g fascia (side)
  fillModel([[f - lean, g - cw, roofZ], [f - lean, g + cw, roofZ], [f - lean, g + cw, roofZt], [f - lean, g - cw, roofZt]], 'rgb(38,43,50)');   // roof front fascia
  fillModel([[f - lean, g - cw, roofZt], [f - lean, g + cw, roofZt], [fB, g + cw * 0.92, roofZt], [fB, g - cw * 0.92, roofZt]], 'rgb(24,28,34)');   // roof top

  // 5) Roof equipment cluster — antennas + a dish rise off the parapet, and the mast tops it out.
  const rf = f - lean * 0.5;
  fillModel([[rf, g - cw * 0.55 - 0.04, roofZt], [rf, g - cw * 0.55 + 0.04, roofZt], [rf, g - cw * 0.55 + 0.04, roofZt + 0.16], [rf, g - cw * 0.55 - 0.04, roofZt + 0.16]], 'rgb(20,23,28)');   // dish pedestal
  fillModel([[rf - 0.02, g - cw * 0.55 - 0.18, roofZt + 0.1], [rf - 0.02, g - cw * 0.55 + 0.18, roofZt + 0.1], [rf - 0.06, g - cw * 0.55 + 0.14, roofZt + 0.34], [rf - 0.06, g - cw * 0.55 - 0.14, roofZt + 0.34]], 'rgba(180,190,202,0.85)');   // dish face
  for (const gg of [cw * 0.2, cw * 0.5]) fillModel([[rf, g + gg - 0.015, roofZt], [rf, g + gg + 0.015, roofZt], [rf, g + gg + 0.015, roofZt + 0.4 + gg], [rf, g + gg - 0.015, roofZt + 0.4 + gg]], 'rgba(30,34,40,0.9)');   // whip antennas
  // Mast + lights.
  const mastTop = roofZt + 0.8;
  fillModel([[rf - 0.08, g - 0.04, roofZt], [rf - 0.08, g + 0.04, roofZt], [rf - 0.08, g + 0.04, mastTop], [rf - 0.08, g - 0.04, mastTop]], 'rgba(20,22,26,0.9)');
  const mast = proj(rf - 0.08, g, mastTop);
  if (mast.z > ROOM_NEAR) {
    const blink = t % 1.3 < 0.13 ? 1 : 0.12;   // red obstruction light — a slow steady blink
    let rg = ctx.createRadialGradient(mast.sx, mast.sy, 1, mast.sx, mast.sy, 11);
    rg.addColorStop(0, `rgba(255,60,50,${0.35 + blink * 0.55})`); rg.addColorStop(1, 'rgba(255,60,50,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(mast.sx, mast.sy, 11, 0, 7); ctx.fill();
    // Surveillance-radar bar sweeping over the roof — a thin foreshortened line rotating about the
    // roof centre, so the tower reads as an active, staffed facility.
    const rc = proj(f - lean, g, roofZt + 0.12);
    if (rc.z > ROOM_NEAR) {
      const len = Math.max(7, Math.min(34, 30 / rc.z)), a = t * 1.7, dx = Math.cos(a) * len, dy = Math.sin(a) * len * 0.36;
      ctx.strokeStyle = 'rgba(150,200,172,0.75)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(rc.sx - dx, rc.sy - dy); ctx.lineTo(rc.sx + dx, rc.sy + dy); ctx.stroke(); ctx.lineCap = 'butt';
    }
    // Airport beacon on the cab roof — alternating white/green sweep.
    const beacon = proj(f - lean, g + cw * 0.6, roofZt + 0.18);
    if (beacon.z > ROOM_NEAR) {
      const green = (t % 2) < 1, col = green ? '80,255,150' : '245,250,255', ph = 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI));
      rg = ctx.createRadialGradient(beacon.sx, beacon.sy, 1, beacon.sx, beacon.sy, 13);
      rg.addColorStop(0, `rgba(${col},${ph * 0.7})`); rg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(beacon.sx, beacon.sy, 13, 0, 7); ctx.fill();
    }
  }
}

// ── Turntable renderer (hangar hero view) ─────────────────────────────────────
// Draws the model into a 2D canvas on a perspective camera (elevated, looking down the
// nose), spun about the vertical axis by `yaw`, at camera elevation `elev` (the walkaround
// inspect mode drives yaw/elev/zoom from pointer input, or a free `cam`). Faces are depth-
// sorted (painter's), lit by a soft key light, painted in the livery + hull texture + nose
// art. `floor` adds the 3D ground grid. A wreck slumps + desaturates.
export function drawTurntable(ctx, opts) {
  ctx.clearRect(0, 0, opts.w, opts.h);
  paintTurntable(ctx, opts);
}

// The turntable's paint step alone, with NO clear — so a caller that's already
// painted a backdrop into the canvas (drawHangarFloorBay below) can draw the plane
// on top of it in the same pass instead of the model wiping the scene behind it.
function paintTurntable(ctx, { cls, livery, yaw = 0, w, h, wreck = false, zoom = 1, elev = 0.42, cam = null, floor = false, sky = null, venue = null }) {
  const faces = wreck ? buildWreck() : aircraftFaces(cls);
  const pal = liveryPalette(livery || {});
  const jazzImg = (!wreck && pal.pat === 'jazz') ? jazzTex(livery?.base, livery?.trim, livery?.accent, livery?.ground) : null;
  const texStr = wreck ? 0.62 : (TEX_STRENGTH[livery?.finish] ?? 0.46);
  const roll = wreck ? -0.26 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
  const ox = w / 2, oy = h * 0.52;
  const Ln = Math.hypot(-0.25, -0.45, 0.86), lx = -0.25 / Ln, ly = -0.45 / Ln, lz = 0.86 / Ln;
  let proj, eyeW;   // eyeW = the camera position in the SAME space the face normals live in (P.wx/wy/wz), for backface culling
  if (cam) {
    // FREE WALK CAMERA: eye at (x forward, y right, z up) in the craft's own frame, looking
    // along yaw (azimuth in the ground plane) + pitch. WASD moves the eye, drag turns the head.
    // World coords are returned raw so the key light stays fixed in the room (the lit side is
    // consistent as you walk around, unlike the turntable where the light rides the camera).
    const focal = Math.min(w, h) * 0.92 * (cam.fov || 1);
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cpi = Math.cos(cam.pitch), spi = Math.sin(cam.pitch);
    proj = (f, g, hh) => {
      const g1 = g * cro - hh * sro, h1 = g * sro + hh * cro;            // static wreck roll (world)
      const dF = f - cam.x, dG = g1 - cam.y, dU = h1 - cam.z;
      const xf = dF * cyw + dG * syw, xr = -dF * syw + dG * cyw;         // along look / to the right
      const depth = xf * cpi + dU * spi, up = -xf * spi + dU * cpi;      // into screen / screen-up
      return { sx: ox + xr * focal / depth, sy: oy - up * focal / depth, z: depth, wx: f, wy: g1, wz: h1 };
    };
    eyeW = [cam.x, cam.y, cam.z];   // the free-walk eye, already in model/world (f,g1,h1) space
  } else {
    // ORBIT TURNTABLE: fixed distance, yaw about up + a ¾ elevation tilt, zoom via focal.
    const E = clampN(elev, 0.04, 1.35), cosE = Math.cos(E), sinE = Math.sin(E);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const camDist = 3.5, focal = Math.min(w, h) * 1.75 * zoom;
    proj = (f, g, hh) => {
      const g1 = g * cro - hh * sro, h1 = g * sro + hh * cro;            // static wreck roll
      const fx = f * cy - g1 * sy, gy = f * sy + g1 * cy, hz = h1;       // yaw about up
      const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;  // ¾ camera tilt
      const z = camDist - camZ;
      return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z, wx: fx, wy: gy, wz: hz };
    };
    eyeW = [camDist * cosE, 0, camDist * sinE];   // orbit eye in (fx,gy,hz) space: solves camZ = camDist, camY = 0
  }
  const helipad = venue === 'helipad';
  if (floor && cam && helipad) drawHelipadRoom(ctx, proj, sky, w, h);   // walk view: an open boat helipad (deck draws its own ground)
  else if (floor && cam) drawInspectRoom(ctx, proj, sky);              // walk view: a real 3D hangar around you, live sky through the bay door
  if (floor && !(cam && helipad)) drawFloorGrid(ctx, proj);   // 3D ground under the plane (the helipad draws its own deck instead)
  const drawn = [];
  for (const face of faces) {
    if (face.role === 'rotor') continue;   // spinning surfaces drawn by drawRotorFX below
    const P = face.p.map(v => proj(v[0], v[1], v[2]));
    if (P.some(q => q.z <= 0.15)) continue;
    // Newell's method for the face normal (sum over all edges) — stays valid even when ONE
    // edge of the polygon collapses to zero length, which happens at the nose/tail cone tips
    // where a whole cross-section ring degenerates to a point. The old two-edge cross product
    // used P[0]→P[1] as its first edge, so a collapsed front ring (P[0]===P[1]) gave a zero
    // normal → the body cull dropped the entire nose cone (the "missing nose" bug).
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < P.length; i++) {
      const c = P[i], d = P[(i + 1) % P.length];
      nx += (c.wy - d.wy) * (c.wz + d.wz); ny += (c.wz - d.wz) * (c.wx + d.wx); nz += (c.wx - d.wx) * (c.wy + d.wy);
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    // Backface cull the CLOSED-HULL roles (fuselage skin, canopy, windows). Painter's
    // sort alone lets a far-side hull facet win the depth test in places and bleed through
    // the near side; these surfaces wrap a body centred on the origin, so a normal oriented
    // outward-from-origin that faces AWAY from the eye is the hidden back and can be dropped.
    // Appendages (wings/stabs/fins/nacelles/gear) are thin or off-axis, so they stay two-sided.
    if (CULL_ROLE.has(face.role)) {
      let cx = 0, cy = 0, cz = 0; for (const q of P) { cx += q.wx; cy += q.wy; cz += q.wz; }
      const n = P.length; cx /= n; cy /= n; cz /= n;
      const out = (nx * cx + ny * cy + nz * cz) < 0 ? -1 : 1;   // flip normal to point away from the model centre
      if (out * (nx * (eyeW[0] - cx) + ny * (eyeW[1] - cy) + nz * (eyeW[2] - cz)) <= 0) continue;   // faces away from the eye → hidden back
    }
    const light = 0.52 + 0.48 * Math.abs((nx * lx + ny * ly + nz * lz) / nl);
    let rgb = faceBaseRgb(face, pal);
    if (wreck) rgb = mix3(rgb, [74, 72, 66], 0.55);
    let z = 0; for (const q of P) z += q.z;
    const rec = { P, role: face.role, avgZ: z / P.length, col: shadeRgb(rgb, face.sh * pal.fmul * light * (wreck ? 0.8 : 1)) };
    if (jazzImg && JAZZ_ROLE.has(face.role)) rec.uv = face.p.map(v => jazzUV(v, face.role));
    drawn.push(rec);
  }
  drawn.sort((a, b) => b.avgZ - a.avgZ);
  ctx.lineJoin = 'round';
  for (const fc of drawn) {
    ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
    for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
    ctx.closePath();
    ctx.fillStyle = fc.col; ctx.fill();
    if (fc.uv) overlayJazz(ctx, fc.P, fc.uv, jazzImg);           // Memphis splatter, mapped in body space
    else if (TEXTURED.has(fc.role)) overlayHull(ctx, fc.P, texStr);   // procedural panel/rivet detail
    if (!wreck && (fc.role === 'glass' || fc.role === 'window')) glassSheen(ctx, fc.P);   // glassy specular on canopy/windows
    ctx.strokeStyle = 'rgba(8,10,14,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    if (!wreck && livery?.finish === 'gloss' && fc.role === 'body') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy); ctx.lineTo(fc.P[1].sx, fc.P[1].sy); ctx.stroke(); ctx.restore();
    }
  }
  if (!wreck) drawNoseArt(ctx, proj, cls, livery);   // real nose art on the visible fuselage side
  // Props/rotors — engines off in here, so crisp STOPPED blades (not a blur),
  // projected through this same camera so they spin with the turntable.
  if (!wreck) drawRotorFX(ctx, cls, (v) => { const q = proj(v[0], v[1], v[2]); return q.z <= 0.2 ? null : q; }, { parked: true, spin: 2.3 });
}

// ── Outside world glimpse (through the open bay door) ─────────────────────────
// A tiny sky + weather read, keyed off the same environment state the flight
// windshield uses — clipped to the door's trapezoid so the hangar always feels
// like it's sitting in the same world/weather the player is actually in, not a
// timeless box. `sky = { hour, weather, wind }` (plugins/flight/state.js skyState()).
const WEATHER_SKY = {
  clear:   { top: [70, 140, 196], hor: [196, 220, 232] },
  cloudy:  { top: [104, 116, 128], hor: [172, 180, 188] },
  rain:    { top: [64, 74, 88],   hor: [126, 134, 144] },
  storm:   { top: [40, 44, 54],   hor: [82, 88, 100] },
  snow:    { top: [148, 160, 174], hor: [214, 220, 226] },
  fog:     { top: [150, 156, 162], hor: [182, 186, 190] },
  ash:     { top: [86, 70, 60],   hor: [132, 110, 92] },
  dust:    { top: [128, 102, 70], hor: [172, 142, 98] },
};
function skyPalette(sky) {
  const wx = WEATHER_SKY[sky?.weather] || WEATHER_SKY.clear;
  const hour = ((sky?.hour ?? 12) % 24 + 24) % 24;
  const night = clampN(hour < 6 ? (6 - hour) / 3 : hour > 19 ? (hour - 19) / 3 : 0, 0, 1);
  const nightTint = [10, 14, 28];
  return {
    top: mix3(wx.top, nightTint, night * 0.82),
    hor: mix3(wx.hor, nightTint, night * 0.7),
    night, weather: sky?.weather || 'clear',
  };
}
function drawOutsideWorld(ctx, x0, yTop, x1, yBot, sky) {
  const pal = skyPalette(sky);
  const cx = (x0 + x1) / 2, groundY = yBot - (yBot - yTop) * 0.18;
  let g = ctx.createLinearGradient(0, yTop, 0, groundY);
  g.addColorStop(0, rgbStr(pal.top)); g.addColorStop(1, rgbStr(pal.hor));
  ctx.fillStyle = g; ctx.fillRect(x0, yTop, x1 - x0, groundY - yTop);
  // A hazy distant skyline silhouette — reads as "the field beyond the door", not a void.
  ctx.fillStyle = rgbStr(mix3(pal.hor, [20, 24, 30], 0.55), 0.6);
  const bw = (x1 - x0) / 7;
  for (let i = 0; i < 7; i++) {
    const bh = (groundY - yTop) * (0.08 + ((i * 37) % 5) / 22);
    ctx.fillRect(x0 + i * bw, groundY - bh, bw * 0.8, bh);
  }
  // Ground strip (tarmac, not the hangar's own floor — this is OUTSIDE the door).
  const gg = ctx.createLinearGradient(0, groundY, 0, yBot);
  gg.addColorStop(0, rgbStr(mix3(pal.hor, [30, 34, 38], 0.4))); gg.addColorStop(1, 'rgba(20,24,28,0.9)');
  ctx.fillStyle = gg; ctx.fillRect(x0, groundY, x1 - x0, yBot - groundY);
  // Sun/moon — only reads clearly when the sky isn't overcast/precipitating.
  if (/^(clear|dust)$/.test(pal.weather)) {
    const sx = cx + (pal.night > 0.4 ? -1 : 1) * (x1 - x0) * 0.22, sy = yTop + (groundY - yTop) * 0.32;
    const disc = pal.night > 0.4 ? [220, 224, 236] : [255, 246, 214];
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, (x1 - x0) * 0.12);
    rg.addColorStop(0, rgbStr(disc, 0.9)); rg.addColorStop(1, rgbStr(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, (x1 - x0) * 0.12, 0, 7); ctx.fill();
    ctx.fillStyle = rgbStr(disc, 0.9); ctx.beginPath(); ctx.arc(sx, sy, (x1 - x0) * 0.03, 0, 7); ctx.fill();
  }
  // Weather flourishes.
  if (pal.weather === 'rain' || pal.weather === 'storm') {
    ctx.strokeStyle = rgbStr([190, 210, 230], 0.4); ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const rx = x0 + ((i * 53) % 100) / 100 * (x1 - x0), ry = yTop + ((i * 71) % 100) / 100 * (groundY - yTop);
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 3, ry + 10); ctx.stroke();
    }
  } else if (pal.weather === 'snow') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 16; i++) {
      const sx2 = x0 + ((i * 47) % 100) / 100 * (x1 - x0), sy2 = yTop + ((i * 83) % 100) / 100 * (groundY - yTop);
      ctx.beginPath(); ctx.arc(sx2, sy2, 1.2, 0, 7); ctx.fill();
    }
  } else if (pal.weather === 'fog' || pal.weather === 'cloudy') {
    const fg = ctx.createLinearGradient(0, groundY - (groundY - yTop) * 0.3, 0, groundY);
    fg.addColorStop(0, 'rgba(200,206,212,0)'); fg.addColorStop(1, 'rgba(200,206,212,0.35)');
    ctx.fillStyle = fg; ctx.fillRect(x0, groundY - (groundY - yTop) * 0.3, x1 - x0, (groundY - yTop) * 0.3);
  }
}
const rgbStr = (c, a) => a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ── Hangar interior backdrop ────────────────────────────────────────────────
// A stylized bay behind the turntable: a converging-line floor, corrugated side
// walls, overhead truss + hanging work-lights, floor clutter (crates, drums,
// a tool cart, a hazard-striped inspection lane, a hose reel), and an open bay
// door at the back showing the actual outside sky/weather. Pure background —
// painted first, no clearRect of its own (the caller clears once for the whole
// composed scene). `tint` washes the door-light strip a pilot's signature colour
// (the CHARTER Mule bay); `sky` drives the world glimpse through the door.
// The floor-scene backdrop for a YACHT field (the Echelon): an open-air aft helipad
// instead of the industrial bay — sky + Basin + a distant skyline over the horizon, a
// compact non-slip deck (painted 'H' + ring + red pad lights) reading much smaller than
// a hangar floor, and the mirror-black deckhouse to one side. No roof, no truss.
function drawHelipadBackdrop(ctx, w, h, { sky } = {}) {
  const pal = skyPalette(sky), horizon = h * 0.44, cx = w / 2;
  // Sky.
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, rgbStr(pal.top)); g.addColorStop(1, rgbStr(pal.hor));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, horizon);
  if (/^(clear|dust)$/.test(pal.weather)) {
    const sx = cx + (pal.night > 0.4 ? -1 : 1) * w * 0.24, sy = horizon * 0.42, disc = pal.night > 0.4 ? [220, 224, 236] : [255, 246, 214];
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, w * 0.09);
    rg.addColorStop(0, rgbStr(disc, 0.9)); rg.addColorStop(1, rgbStr(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, w * 0.09, 0, 7); ctx.fill();
  }
  // Distant skyline across the water.
  ctx.fillStyle = rgbStr(mix3(pal.hor, [20, 26, 34], 0.5), 0.72);
  const bw = w / 11;
  for (let i = 0; i < 11; i++) { const bh = horizon * (0.12 + hash01(i * 4.2) * 0.42); ctx.fillRect(i * bw, horizon - bh, bw * 0.84, bh); }
  // Sea from the horizon down to the deck.
  g = ctx.createLinearGradient(0, horizon, 0, h);
  g.addColorStop(0, rgbStr(mix3(pal.hor, [14, 24, 38], 0.55))); g.addColorStop(1, 'rgb(9,14,20)');
  ctx.fillStyle = g; ctx.fillRect(0, horizon, w, h - horizon);
  // The deckhouse — a mirror-black block with a smoked-glass band, set to the left, rising
  // off the far deck edge so the scene reads as sitting on a superyacht.
  const dhx = w * 0.04, dhy = horizon - h * 0.09, dhw = w * 0.3, dhh = h * 0.2;
  ctx.fillStyle = '#13151b'; ctx.fillRect(dhx, dhy, dhw, dhh);
  const gl = ctx.createLinearGradient(0, dhy, 0, dhy + dhh * 0.55);
  gl.addColorStop(0, 'rgba(58,80,104,0.9)'); gl.addColorStop(1, 'rgba(22,32,44,0.95)');
  ctx.fillStyle = gl; ctx.fillRect(dhx + 4, dhy + 5, dhw - 8, dhh * 0.5);
  ctx.strokeStyle = 'rgba(120,150,178,0.3)'; ctx.lineWidth = 1;
  for (let x = dhx + 10; x < dhx + dhw - 6; x += 12) { ctx.beginPath(); ctx.moveTo(x, dhy + 5); ctx.lineTo(x, dhy + 5 + dhh * 0.5); ctx.stroke(); }
  // The deck — a compact non-slip pad, a perspective trapezoid narrower at the far edge.
  const dTopY = horizon + h * 0.04, dTopHalf = w * 0.2, dBotHalf = w * 0.66;
  ctx.beginPath(); ctx.moveTo(cx - dTopHalf, dTopY); ctx.lineTo(cx + dTopHalf, dTopY); ctx.lineTo(cx + dBotHalf, h); ctx.lineTo(cx - dBotHalf, h); ctx.closePath();
  g = ctx.createLinearGradient(0, dTopY, 0, h); g.addColorStop(0, '#1f252c'); g.addColorStop(1, '#0f1318');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();   // keep the markings + lights on the deck
  // Painted landing circle + 'H'.
  const px = cx, py = h * 0.72, rx = w * 0.2, ry = h * 0.12;
  ctx.strokeStyle = 'rgba(208,222,236,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py, rx, ry, 0, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(224,232,240,0.5)';
  const hw = rx * 0.42, hh = ry * 0.9, barW = rx * 0.12;
  ctx.fillRect(px - hw - barW / 2, py - hh, barW, hh * 2);
  ctx.fillRect(px + hw - barW / 2, py - hh, barW, hh * 2);
  ctx.fillRect(px - hw, py - hh * 0.16, hw * 2, hh * 0.32);
  // Recessed red pad lights around the rim.
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2, lx = px + Math.cos(a) * rx * 1.06, ly = py + Math.sin(a) * ry * 1.06;
    const rg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 9);
    rg.addColorStop(0, 'rgba(255,84,66,0.5)'); rg.addColorStop(1, 'rgba(255,84,66,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(lx, ly, 9, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,96,74,0.9)'; ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, 7); ctx.fill();
  }
  ctx.restore();
  // A soft pool of light where the craft sit, plus a light vignette.
  const pool = ctx.createRadialGradient(cx, h * 0.82, 4, cx, h * 0.82, w * 0.5);
  pool.addColorStop(0, 'rgba(220,232,246,0.16)'); pool.addColorStop(1, 'rgba(220,232,246,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, dTopY, w, h - dTopY);
  const vg = ctx.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.45, cx, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

function drawHangarBackdrop(ctx, w, h, { tint, doorFrac = 0.34, sky } = {}) {
  const horizon = h * 0.46, floorTop = horizon, cx = w / 2;
  // Back wall + ceiling above the horizon — a lit industrial grey, not a black void.
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#2a343e'); g.addColorStop(1, '#3a4650');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, horizon);
  // Corrugated wall panels (vertical ribs, fainter toward the edges).
  ctx.strokeStyle = 'rgba(200,216,230,0.16)'; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, horizon); ctx.stroke(); }
  // A pinned-up notice board + a wall-mounted extinguisher — small human touches
  // off to one side, clear of the door and the planes.
  drawNoticeBoard(ctx, w * 0.07, horizon * 0.28, 34, 24);
  drawExtinguisher(ctx, w * 0.93, horizon * 0.7);

  // Open bay door: the real world beyond it (sky/weather), tinted by the pilot
  // colour at the edges when given. Wide enough to read as a real open bay, not
  // a slit — the room feels lit from beyond it, not just lamp-lit.
  const doorW = w * doorFrac, doorH = horizon * 0.78, doorY = horizon - doorH;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - doorW * 0.42, horizon); ctx.lineTo(cx - doorW * 0.5, doorY);
  ctx.lineTo(cx + doorW * 0.5, doorY); ctx.lineTo(cx + doorW * 0.42, horizon);
  ctx.closePath(); ctx.clip();
  drawOutsideWorld(ctx, cx - doorW * 0.5, doorY, cx + doorW * 0.5, horizon, sky);
  if (tint) {
    const tc = hex2rgb(tint) || [235, 240, 246];
    const edge = ctx.createLinearGradient(cx - doorW * 0.5, 0, cx + doorW * 0.5, 0);
    edge.addColorStop(0, rgbStr(tc, 0.28)); edge.addColorStop(0.5, rgbStr(tc, 0)); edge.addColorStop(1, rgbStr(tc, 0.28));
    ctx.fillStyle = edge; ctx.fillRect(cx - doorW * 0.5, doorY, doorW, doorH);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(cx - doorW * 0.42, horizon); ctx.lineTo(cx - doorW * 0.5, doorY);
  ctx.lineTo(cx + doorW * 0.5, doorY); ctx.lineTo(cx + doorW * 0.42, horizon);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(40,48,56,0.7)'; ctx.lineWidth = 3; ctx.stroke();
  // Overhead truss + hanging lamps, brighter pools of light on the ceiling.
  ctx.strokeStyle = 'rgba(150,168,184,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, horizon * 0.12); ctx.lineTo(w, horizon * 0.12); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const lx = w * (0.1 + i * 0.2);
    ctx.strokeStyle = 'rgba(150,168,184,0.4)'; ctx.beginPath(); ctx.moveTo(lx, horizon * 0.12); ctx.lineTo(lx, horizon * 0.3); ctx.stroke();
    const lg = ctx.createRadialGradient(lx, horizon * 0.3, 1, lx, horizon * 0.3, 22);
    lg.addColorStop(0, 'rgba(255,250,230,0.8)'); lg.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, horizon * 0.3, 22, 0, 7); ctx.fill();
  }
  // Floor: perspective grid converging on the door, bright polished-concrete gradient.
  g = ctx.createLinearGradient(0, floorTop, 0, h);
  g.addColorStop(0, '#454f58'); g.addColorStop(1, '#262e35');
  ctx.fillStyle = g; ctx.fillRect(0, floorTop, w, h - floorTop);
  ctx.strokeStyle = 'rgba(210,224,236,0.22)'; ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(cx, floorTop); ctx.lineTo(cx + i * w * 0.16, h); ctx.stroke();
  }
  for (const f of [0.15, 0.35, 0.62, 1]) {
    const y = floorTop + (h - floorTop) * f;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // A yellow hazard-striped inspection lane running along the near edge — the
  // kind of floor marking every real hangar has, and an easy "lived-in" tell.
  drawHazardStripe(ctx, 0, h - (h - floorTop) * 0.1, w, (h - floorTop) * 0.045);
  // Floor clutter flanking the room, clear of the door and the plane lane: a
  // stack of crates + oil drums on the left, a mechanic's tool cart + a coiled
  // hose reel on the right.
  drawClutterLeft(ctx, w, h, floorTop);
  drawClutterRight(ctx, w, h, floorTop);
  // A bright pool of light under where the plane(s) sit.
  const pool = ctx.createRadialGradient(cx, h * 0.86, 4, cx, h * 0.86, w * 0.5);
  pool.addColorStop(0, 'rgba(230,238,246,0.28)'); pool.addColorStop(1, 'rgba(230,238,246,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, floorTop, w, h - floorTop);
  // A light vignette — enough to frame the scene without darkening it.
  const vg = ctx.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.45, cx, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

// ── Lived-in detail props (pure 2D flourishes, screen-space — this is the flat
// backdrop layer behind the 3D-projected planes, so they're drawn the same way
// the wall/floor/door already are) ─────────────────────────────────────────────
function drawNoticeBoard(ctx, x, y, w, h) {
  ctx.fillStyle = '#5a4630'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x + 3, y + 3, 11, 8);
  ctx.fillStyle = 'rgba(240,200,80,0.7)'; ctx.fillRect(x + 16, y + 4, 9, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x + 4, y + 15, 14, 6);
}
function drawExtinguisher(ctx, x, y) {
  ctx.fillStyle = 'rgba(30,36,42,0.5)'; ctx.fillRect(x - 1, y - 10, 10, 3);   // wall bracket
  ctx.fillStyle = '#a01e1e'; ctx.beginPath();
  ctx.moveTo(x, y - 7); ctx.lineTo(x + 8, y - 7); ctx.lineTo(x + 7, y + 12); ctx.lineTo(x + 1, y + 12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a2f34'; ctx.fillRect(x + 1, y - 11, 6, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
}
// A yellow/black hazard-striped strip along the floor's near edge (perspective-
// sheared to sit flush with the converging floor grid).
function drawHazardStripe(ctx, x0, y, w, thick) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y, w, thick); ctx.clip();
  const n = 22, sw = w / n * 1.6;
  for (let i = -2; i < n + 2; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(232,196,40,0.55)' : 'rgba(20,20,20,0.55)';
    ctx.save(); ctx.translate(x0 + i * (w / n), y); ctx.transform(1, 0, -0.6, 1, 0, 0);
    ctx.fillRect(0, 0, sw, thick); ctx.restore();
  }
  ctx.restore();
}
function drawCrate(ctx, x, y, s, seed) {
  ctx.fillStyle = shadeRgb([120, 92, 58], 1); ctx.fillRect(x, y, s, s * 0.8);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, s, s * 0.8);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y + s * 0.8); ctx.moveTo(x + s, y); ctx.lineTo(x, y + s * 0.8); ctx.stroke();
  if (seed % 2 === 0) { ctx.fillStyle = 'rgba(230,220,180,0.5)'; ctx.font = '7px monospace'; ctx.fillText('AVN', x + s * 0.22, y + s * 0.5); }
}
function drawDrum(ctx, x, y, r, col) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.5, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y - r * 0.5, r, r * 0.4, 0, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.5, r, r * 0.4, 0, 0, 7); ctx.stroke();
}
function drawClutterLeft(ctx, w, h, floorTop) {
  const bx = w * 0.05, by = h * 0.78;
  drawCrate(ctx, bx, by - 26, 26, 1);
  drawCrate(ctx, bx + 20, by - 14, 22, 0);
  drawDrum(ctx, bx + 46, by, 9, '#2a5f42');
  drawDrum(ctx, bx + 64, by + 4, 8, '#7a4a1e');
}
function drawClutterRight(ctx, w, h, floorTop) {
  const bx = w * 0.86, by = h * 0.76;
  // Mechanic's tool cart — a squat box on wheels with a couple of drawers.
  ctx.fillStyle = '#3a4a58'; ctx.fillRect(bx, by, 40, 22);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, 40, 22);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; for (const dy of [7, 14]) { ctx.beginPath(); ctx.moveTo(bx, by + dy); ctx.lineTo(bx + 40, by + dy); ctx.stroke(); }
  ctx.fillStyle = '#1a2026'; ctx.beginPath(); ctx.arc(bx + 7, by + 26, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(bx + 33, by + 26, 4, 0, 7); ctx.fill();
  // A coiled hose/cable reel mounted on the wall just above.
  ctx.strokeStyle = 'rgba(200,80,50,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(bx + 20, by - 24, 12, 0.2, 5.8); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx + 20, by - 24, 8, 0.2, 5.8); ctx.stroke();
}

// One "bay" on the hangar floor: the backdrop + a plane's turntable composed into
// a single canvas — the hangar-bay app's per-craft cards and the mechanics-bench
// hero shot both draw through this instead of a bare (background-less) turntable.
export function drawHangarFloorBay(ctx, opts) {
  ctx.clearRect(0, 0, opts.w, opts.h);
  // flat: true skips the hangar-room backdrop and leaves the canvas transparent —
  // used by the mechanics-bench hero shot, which sits over the panel's own themed
  // background instead of a hangar interior.
  if (opts.floor3d) drawInspectBackdrop(ctx, opts.w, opts.h, opts.venue, opts.sky);   // walkaround inspect — a 3D floor, not the 2D room
  else if (!opts.flat) drawHangarBackdrop(ctx, opts.w, opts.h, { tint: opts.tint, sky: opts.sky });
  if (opts.cls) paintTurntable(ctx, opts);
}

// ── The hangar FLOOR: one continuous 3D room, every craft parked in it ────────
// A single shared camera (not one camera per plane) looks across a raked showroom
// row: each entry sits at its own lateral offset in the SAME world space, so
// they're genuinely side-by-side in one hangar rather than a strip of independent
// thumbnails. `entries = [{ id, cls, livery, wreck, tint, label }]`. Returns the
// screen-space hit circle for each entry so the caller can do click-to-select on
// the one canvas (there's no per-plane DOM element to attach a listener to).
export function drawHangarScene(ctx, { w, h, entries, selId, sky, venue = null }) {
  ctx.clearRect(0, 0, w, h);
  const n = entries.length;
  if (venue === 'helipad') drawHelipadBackdrop(ctx, w, h, { sky });
  else drawHangarBackdrop(ctx, w, h, { doorFrac: Math.min(0.8, 0.34 + n * 0.05), sky });
  if (!n) return [];

  const E = 0.34, cosE = Math.cos(E), sinE = Math.sin(E);
  const camYaw = 0.5, cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  // Real per-craft size + a FIXED lane pitch (size-independent) so a big craft doesn't shove its
  // neighbours. The camera then FITS the scene: stand back far enough to clear the row's depth +
  // the biggest craft, then pick the focal that fills the frame — so it zooms IN for a few small
  // craft and OUT when there are many, or a Leviathan's on the floor.
  const scales = entries.map(e => MODEL_SCALE[e.cls] || 1);
  const maxSc = Math.max(...scales);
  const spacing = 2.6;
  const laneOf = (i) => (i - (n - 1) / 2) * spacing;
  const spread = (n - 1) / 2 * spacing;
  const camDist = 3.1 + spread * 0.32 + maxSc * 0.85;
  const ox = w / 2, oy = h * 0.6;
  // Focal-independent screen offset (per unit focal) — project each craft's rough bounding box
  // and take the focal that fits the widest/tallest extent within the frame, with a little air.
  const rel = (F, G, H) => { const fx = F * cy - G * sy, gy = F * sy + G * cy; const camY = H * cosE - fx * sinE, camZ = fx * cosE + H * sinE; const z = Math.max(0.3, camDist - camZ); return { x: gy / z, y: camY / z }; };
  let exX = 1e-3, exTop = 1e-3, exBot = 1e-3;
  entries.forEach((e, i) => {
    const g0 = laneOf(i), s = scales[i];
    for (const F of [-1.2 * s, 1.2 * s]) for (const G of [g0 - 1.1 * s, g0 + 1.1 * s]) for (const H of [-0.35 * s, 0.62 * s]) {
      const r = rel(F, G, H);
      exX = Math.max(exX, Math.abs(r.x));
      if (r.y > 0) exTop = Math.max(exTop, r.y); else exBot = Math.max(exBot, -r.y);
    }
  });
  const focal = clampN(Math.min((0.46 * w) / exX, (oy - 0.06 * h) / exTop, (0.94 * h - oy) / exBot),
    0.45 * Math.min(w, h), 2.6 * Math.min(w, h));
  const Ln = Math.hypot(-0.25, -0.45, 0.86), lx = -0.25 / Ln, ly = -0.45 / Ln, lz = 0.86 / Ln;
  // Project a point in ROOM space (F,G,H) — G carries the row's lateral spread.
  const proj = (F, G, H) => {
    const fx = F * cy - G * sy, gy = F * sy + G * cy, hz = H;
    const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;
    const z = camDist - camZ;
    return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z, wx: fx, wy: gy, wz: hz };
  };
  const eyeW = [camDist * cosE, 0, camDist * sinE];   // the shared camera in (fx,gy,hz) space, for backface culling

  const hits = [];
  const groups = entries.map((e, i) => {
    const laneG = (i - (n - 1) / 2) * spacing;
    const sc = scales[i];   // real relative size — a Cessna parks much smaller than a Twin Otter
    const faces = e.wreck ? buildWreck() : aircraftFaces(e.cls);
    const pal = liveryPalette(e.livery || {});
    const jazzImg = (!e.wreck && pal.pat === 'jazz') ? jazzTex(e.livery?.base, e.livery?.trim, e.livery?.accent, e.livery?.ground) : null;
    const roll = e.wreck ? -0.22 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
    const selected = e.id === selId;
    const cen = proj(0, laneG, 0);   // this plane's own centre in normal-space (its lane, not the origin) — for backface culling
    const drawn = [];
    for (const face of faces) {
      if (face.role === 'rotor') continue;   // spinning surfaces drawn by drawRotorFX below
      const P = face.p.map(v => {
        const vy = v[1] * sc, vz = v[2] * sc;
        const g1 = vy * cro - vz * sro, h1 = vy * sro + vz * cro;   // static wreck roll (scaled to real size)
        return proj(v[0] * sc, laneG + g1, h1);
      });
      if (P.some(q => q.z <= 0.15)) continue;   // skip just this FACE, not the whole plane
      // Newell's method for the face normal — stays valid when one edge collapses to zero length
      // (the nose/tail cone rings degenerate to a point), so the body cull no longer drops the
      // whole nose cone off a zero normal (the "missing nose" bug).
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < P.length; i++) {
        const c = P[i], d = P[(i + 1) % P.length];
        nx += (c.wy - d.wy) * (c.wz + d.wz); ny += (c.wz - d.wz) * (c.wx + d.wx); nz += (c.wx - d.wx) * (c.wy + d.wy);
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      // Backface cull the closed-hull roles so a far-side facet can't bleed through the near side
      // (painter's sort alone lets it win in places). Outward is measured from THIS plane's centre.
      if (CULL_ROLE.has(face.role)) {
        let cx = 0, cy2 = 0, cz2 = 0; for (const q of P) { cx += q.wx; cy2 += q.wy; cz2 += q.wz; }
        const m = P.length; cx /= m; cy2 /= m; cz2 /= m;
        const dx = cx - cen.wx, dy = cy2 - cen.wy, dz = cz2 - cen.wz;
        const out = (nx * dx + ny * dy + nz * dz) < 0 ? -1 : 1;   // flip normal to point away from the plane centre
        if (out * (nx * (eyeW[0] - cx) + ny * (eyeW[1] - cy2) + nz * (eyeW[2] - cz2)) <= 0) continue;
      }
      const light = 0.62 + 0.5 * Math.abs((nx * lx + ny * ly + nz * lz) / nl);
      let rgb = faceBaseRgb(face, pal);
      if (e.wreck) rgb = mix3(rgb, [74, 72, 66], 0.55);
      let z = 0; for (const q of P) z += q.z;
      const rec = { P, role: face.role, avgZ: z / P.length, col: shadeRgb(rgb, face.sh * pal.fmul * light * (selected ? 1.12 : 1) * (e.wreck ? 0.8 : 1)) };
      if (jazzImg && JAZZ_ROLE.has(face.role)) rec.uv = face.p.map(v => jazzUV(v, face.role));
      drawn.push(rec);
    }
    const origin = proj(0.2, laneG, 0);
    hits.push({ id: e.id, sx: origin.sx, sy: origin.sy, r: Math.max(26, focal / origin.z * 0.55) });
    return { entry: e, faces: drawn.filter(Boolean), avgZ: proj(0, laneG, 0).z, laneG, origin, selected, sc, jazzImg };
  });

  // Depth-sort WHOLE PLANES first (far to near), then faces within each — so one
  // plane never bleeds through the fuselage of the one behind it.
  groups.sort((a, b) => b.avgZ - a.avgZ);
  ctx.lineJoin = 'round';
  for (const grp of groups) {
    // A bright ground spotlight under the selected craft (or the pilot-tinted glow
    // under the CHARTER Mule) — read before the model so it sits under the wheels.
    if (grp.selected || grp.entry.tint) {
      const col = grp.entry.tint ? (hex2rgb(grp.entry.tint) || [79, 184, 224]) : [143, 208, 255];
      const spotR = Math.max(50, Math.min(140, (focal / grp.origin.z) * 0.5));
      const ring = ctx.createRadialGradient(grp.origin.sx, grp.origin.sy + 8, 2, grp.origin.sx, grp.origin.sy + 8, spotR);
      ring.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.4)`); ring.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(grp.origin.sx, grp.origin.sy + 8, spotR, 0, 7); ctx.fill();
    }
    const faces = grp.faces.sort((a, b) => b.avgZ - a.avgZ);
    for (const fc of faces) {
      ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
      for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
      ctx.closePath();
      ctx.fillStyle = fc.col; ctx.fill();
      if (fc.uv) overlayJazz(ctx, fc.P, fc.uv, grp.jazzImg);   // Memphis splatter (same body-space map as the turntable)
      if (!grp.entry.wreck && (fc.role === 'glass' || fc.role === 'window')) glassSheen(ctx, fc.P);   // glassy specular on canopy/windows
      ctx.strokeStyle = 'rgba(8,10,14,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Parked craft: crisp stopped blades, angled differently lane to lane so the
    // row doesn't read as clones.
    if (!grp.entry.wreck) drawRotorFX(ctx, grp.entry.cls,
      (v) => { const q = proj(v[0] * grp.sc, grp.laneG + v[1] * grp.sc, v[2] * grp.sc); return q.z <= 0.15 ? null : q; },
      { parked: true, spin: 1.9 + grp.laneG * 0.6 });
    // A thin bright outline on the SELECTED craft — reads at a glance in a room
    // full of other planes, where a colour cue alone would be too subtle.
    if (grp.selected) {
      for (const fc of faces) {
        if (fc.role === 'body' || fc.role === 'wing') {
          ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
          for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
          ctx.closePath();
          ctx.strokeStyle = 'rgba(143,208,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
    }
    // Floating tail label — always legible regardless of paint colour.
    if (grp.entry.label) {
      const ly = grp.origin.sy + 20;
      ctx.font = `${grp.selected ? 'bold ' : ''}11px monospace`; ctx.textAlign = 'center';
      ctx.fillStyle = grp.selected ? '#eaf6ff' : 'rgba(210,224,236,0.75)';
      ctx.fillText(grp.entry.label, grp.origin.sx, ly);
      ctx.textAlign = 'start';
    }
  }
  return hits;
}
