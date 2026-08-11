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
// Solid appendages that can stand IN FRONT of the fuselage flank and so should occlude nose art.
export const OCCLUDE_ROLE = new Set(['wing', 'aileron', 'flap', 'stab', 'elevator', 'fin', 'rudder', 'nacelle', 'gear', 'strut', 'gun']);
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
    case 'tiger': {   // ragged vertical stripes wrapping the hull down its length (a wandered sine + camo grain frays each edge)
      const ang = Math.atan2(h, g);   // wrap position around the cross-section (both flanks mirror)
      const s = Math.sin(f * 8.5 + ang * 0.9) + camoHash(Math.round(f * 9), 0, Math.round(ang * 3)) * 0.6 - 0.3;
      return s > 0.35;
    }
    case 'digital': return camoHash(Math.round(f * 9), Math.round(g * 13), Math.round(h * 13)) > 0.5;   // fine pixel-block camo (denser grid than splinter)
    case 'checker': { const ang = Math.atan2(h, g); return (Math.floor(f * 6.5) + Math.floor(ang / Math.PI * 4)) % 2 === 0; }   // wrapping racing checkerboard
    default:         return false;                     // bare / solid: one hull colour
  }
}
// Raw (pre-shade) rgb for a facet. Glass/windows read as dark panes; gear/struts/gun/
// intakes as dark structural metal, all independent of the livery colour.
export function faceBaseRgb(face, pal) {
  const role = face.role;
  if (role === 'glass' || role === 'window') return face.tint || [14, 26, 36];   // per-face tint override (e.g. the heli's clear fishbowl bubble)
  if (role === 'strut' || role === 'gear' || role === 'gun') return [44, 48, 54];
  if (role === 'interior') return [26, 28, 33];   // dark cargo-hold walls, livery-independent
  if (role === 'ramp') return [58, 61, 68];        // bare metal cargo ramp
  if (pal.pat === 'jazz' && JAZZ_ROLE.has(role)) return pal.ground || JAZZ_GROUND;   // chosen undercoat; overlayJazz paints the splatter on top
  return faceWearsTrim(face, pal.pat) ? pal.trim : pal.base;
}

// ── Geometry ────────────────────────────────────────────────────────────────────
const V = (f, g, h) => [f, g, h];

// A parametric fixed-wing: a lozenge fuselage (nose tip → mid ring → tail tip), high-
// or low-set swept wings with dihedral, tailplane, one or two vertical fins, engine
// nacelles (underwing tubes OR rear pods), and a canopy. Optional class-signature parts
// — strut braces, fixed gear, prop spinners, nose gun, engine pylons —
// give each class its real-world silhouette (Cessna / Twin Otter / An-124 / A-10).
function buildFixedWing(p, detail = 1) {
  const faces = [];
  // Parametric fuselage: cross-section rings (an N-gon in the g-h plane, scaled by the
  // craft's fr/fv half-widths) sampled at several stations nose→tail and skinned with
  // quads. detail 1 = an 8-sided, rounded-ogive body (~4× the triangles — noticeably
  // rounder both across and along); detail 0 = the original 4-sided bipyramid (two cones
  // off a diamond mid-ring), used for distant/LOD renders where the extra facets are
  // sub-pixel. The tips collapse to the axis (rad→0), so the end quads fold into cap fans.
  // `p.sides` raises the ring resolution for a class whose whole read is roundness (the
  // Leviathan's near-circular wide-body tube) — more facets across, nothing else changes.
  const sides = detail ? (p.sides || 12) : 4;
  // `p.extraF` inserts additional fuselage stations (fore→aft, descending f). A class that GLAZES
  // its hull (p.glaze, below) needs real rings at the windscreen and cockpit bulkhead so the glass
  // starts and stops on a structural seam instead of halfway across a bay — the coarse 3-station
  // nose can't do that. Near-duplicate stations are dropped so an inserted ring can't leave a
  // sliver quad next to a default one. Coarse LOD is untouched.
  let stations = detail
    ? [p.noseF, p.noseF * 0.66, p.noseF * 0.33, 0, p.tailF * 0.35, p.tailF * 0.7, p.tailF]
    : [p.noseF, 0, p.tailF];
  if (detail && p.extraF) {
    // An inserted ring wins over a default one right next to it — EXCEPT the two tip stations, which
    // define the model's length. Evicting those doesn't tidy the mesh, it shortens the aeroplane, so
    // a ring placed close to the tip to round a blunt radome would silently chop the snout off.
    const keep = stations.filter(f => f === p.noseF || f === p.tailF || !p.extraF.some(e => Math.abs(e - f) < 0.03));
    stations = [...keep, ...p.extraF].sort((a, b) => b - a);
  }
  // Radius profile 1 (mid) → 0 (tips). A `bodyTube` plateau holds NEAR-FULL width across the
  // central span before tapering (a transport is a long constant-section tube; a light single
  // tapers straight from the cabin). The NOSE then rounds off as a blunt superellipse cowl
  // (p.noseBlunt), the TAIL as a clean taper. detail 0 stays a straight cone → coarse LOD unchanged.
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0;
  // Centreline: 0 at mid, noseZ at the nose tip (negative = a drooped 'anteater' snout like the
  // Twin Otter), tailUp at the tail. The droop is spent over the TAPERING SNOUT ONLY, not linearly
  // from mid-fuselage — otherwise a drooped nose tips the whole forward cabin down with it and the
  // roof can never stay level. `noseDroopK` < 1 dumps most of the drop right at the break, which is
  // what turns those first facets into a windscreen rake instead of a gently sloping roof.
  const czAt = (f) => {
    if (f < 0) return (p.tailUp ?? 0.05) * (f / p.tailF);
    const u = Math.min(1, f / p.noseF);
    const t = (detail && tube) ? Math.max(0, (u - tube) / (1 - tube)) : u;
    return (p.noseZ ?? 0.02) * Math.pow(t, p.noseDroopK ?? 1);
  };
  const radAt = (f) => {
    let u = Math.min(1, Math.abs(f >= 0 ? f / p.noseF : f / p.tailF));
    if (!detail) return 1 - u;
    u = u <= tube ? 0 : (u - tube) / (1 - tube);   // hold full width through the tube, then taper over the rest
    // Nose: the superellipse rounds it, and p.noseCowl floors the front radius so it does NOT
    // collapse to a point — the fuselage ends in a blunt cowl face (capped below). Tail tapers to 0.
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  // VERTICAL nose taper (p.noseVTaper): shrink the fuselage HEIGHT faster than its width through
  // the nose. This is what a Twin Otter's front end actually does — the flat-topped cabin box holds
  // full height back to the windscreen, then the ROOF comes down hard (a steep, forward-raked
  // windscreen) while the sides stay wide, and the nose tapers to a low drooped point with the
  // belly rising gently to meet it (a wedge, not a sagging tube). Doing it with czAt droop alone
  // dropped the whole ring, sinking the belly below the nose tip; a height-only taper keeps the
  // keel up. Only active where set (the Mule, the Leviathan) — every other craft's ring is unchanged.
  // `noseVFloor` stops the taper short of zero: the Otter's snout really does come to a low POINT
  // (floor 0, the default), but the An-124's roof drops away over the cargo visor to a still-blunt
  // ROUND radome, so its height bottoms out at a fraction of full rather than collapsing to a slit.
  const vFloor = p.noseVFloor || 0;
  const radVAt = (f) => {
    const rH = radAt(f);
    if (!(detail && p.noseVTaper && f > 0)) return rH;
    const u = Math.min(1, f / p.noseF);
    const t = u <= tube ? 0 : (u - tube) / (1 - tube);
    return rH * (vFloor + (1 - vFloor) * Math.pow(1 - t, p.noseVTaper));
  };
  // Cross-section: an ellipse (fr wide × fv tall) morphed toward a rounded RECTANGLE by p.boxy
  // (0 = round, →1 = slab-sided) — a Twin Otter is a flat-sided box, an An-124 near circular.
  // At the 4 cardinal points |cos|/|sin| are 0 or 1, so a 4-sided coarse ring is unaffected →
  // the LOD-0 silhouette is identical regardless of boxy.
  const shapeExp = 1 - (p.boxy || 0) * 0.55;
  // UPPER-DECK HUMP (p.hump = {f0, f1, h}): a local swelling of the CROWN over a stretch of the
  // fuselage — the An-124's flight-deck bulge, and a 747's for that matter. A raised cosine over
  // [f0,f1] so it grows out of the skin and blends back in with no crease at either end, and it's
  // scaled by max(0, sin) around the ring so it lifts the top and dies to nothing at the shoulders
  // rather than inflating the whole section. This has to be part of `ring`, not a bolted-on blister:
  // the flight-deck glass IS the skin here, so the windows have to ride the bump with it.
  const humpAt = (f) => {
    const Hp = p.hump;
    if (!detail || !Hp || f <= Hp.f0 || f >= Hp.f1) return 0;
    return Hp.h * 0.5 * (1 - Math.cos(2 * Math.PI * (f - Hp.f0) / (Hp.f1 - Hp.f0)));
  };
  // FLAT-BOTTOM HULL (p.bellyFlat, 0…1). A freighter's cargo floor is a low flat deck, and the hull
  // under it is a shallow pan with a hard chine, not a barrel — it's a big part of why an An-124
  // looks like it's squatting. This needs facets to read: on a 12- or 16-gon the lower half is so
  // coarse that flattening it just moves two vertices, so it was never worth having. At 24 it is.
  // Blends the round section toward a constant depth that turns up sharply at the chine.
  const flatK = p.bellyFlat || 0;
  const ring = (f) => {
    const rW = radAt(f), rH = radVAt(f), cz = czAt(f), hb = humpAt(f), out = [];
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const g = Math.sign(ca) * Math.pow(Math.abs(ca), shapeExp) * p.fr * rW;   // width uses the plan taper
      let h = Math.sign(sa) * Math.pow(Math.abs(sa), shapeExp) * p.fv * rH;     // height can taper faster in the nose (radVAt)
      if (flatK && sa < 0) {
        const flat = -p.fv * rH * Math.min(1, Math.abs(sa) * 3);   // full depth across the middle, rising fast at the corners
        h = h * (1 - flatK) + flat * flatK;
      }
      out.push(V(f, g, cz + h + hb * Math.max(0, sa)));
    }
    return out;
  };
  // ── GLAZED HULL (p.glaze) — the Twin Otter way, and the same idea as the Viper's greenhouse:
  // the cockpit glass is not a blister bolted to the crown, it IS the fuselage. Between stations
  // f0 (windscreen) and f1 (cockpit bulkhead) the listed upper facets are simply glazed, so the
  // flight-deck windows are flush with the flat sides and rake forward with the drooped nose
  // exactly like the real aeroplane. The roof facets stay body-coloured (an Otter's roof is
  // painted, not glass). Frames/reflections/crew are painted by the canopy texture through the
  // UVs below: U runs f0→f1 (windscreen→bulkhead), V runs starboard→crown→port over the upper
  // half of the ring (k 0…sides/2), matching the shared canopy texture space.
  const GZ = detail && p.glaze ? p.glaze : null;
  const gzU = (f) => (GZ.f0 - f) / (GZ.f0 - GZ.f1) * CP_TW;
  const gzV = (k) => k / (sides / 2) * CP_TH;
  for (let i = 0; i < stations.length - 1; i++) {
    const A = ring(stations[i]), B = ring(stations[i + 1]);
    const fA = stations[i], fB = stations[i + 1];
    const inGlaze = GZ && fB > GZ.f1 - 1e-6 && fA < GZ.f0 + 1e-6;
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const sh = 0.62 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright (~0.98) → sides mid → bottom dark (~0.62)
      // The WINDSCREEN bay wraps higher than the side windows do (GZ.wsKs forward of GZ.wsF) —
      // the Otter's screen carries up onto the cheek, its side glass stops at the window line.
      const gks = (GZ && GZ.wsKs && fA >= GZ.wsF - 1e-6) ? GZ.wsKs : (GZ ? GZ.ks : null);
      if (inGlaze && gks.includes(k)) {
        faces.push({ role: 'glass', sh, art: GZ.art, p: [A[k], A[k2], B[k2], B[k]],
          uv: [[gzU(fA), gzV(k)], [gzU(fA), gzV(k2)], [gzU(fB), gzV(k2)], [gzU(fB), gzV(k)]] });
        continue;
      }
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
  // DORSAL FIN FILLET (Twin Otter): a long shallow blade running forward off the fin leading edge
  // along the spine. It's most of what makes an Otter's tail read as an Otter's, and it sits on the
  // fuselage crown, so it follows the real tailcone line rather than a straight fudge.
  if (detail && p.dorsal != null) {
    const crownAt = (f) => czAt(f) + p.fv * radAt(f);
    const kneeH = 0.05 + (p.finH - 0.05) * 0.34;                       // where it merges into the fin LE
    const kneeF = p.finF0 + (p.finF1 - p.finF0) * 0.34;
    faces.push({ role: 'fin', sh: 0.84, p: [
      V(p.dorsal, 0, crownAt(p.dorsal)), V(kneeF, 0, kneeH), V(p.finF0, 0, crownAt(p.finF0))] });
  }
  // Engine nacelles — underwing tubes (from `engines` lateral stations) or fatter rear
  // pods (from `podEngines` full [f,g,h] stations, e.g. the A-10's high tail-mounts).
  const nacStations = p.podEngines || (p.engines || []).map(g => [p.nacF, g, p.nacH]);
  for (const [nf, g, hc] of nacStations) {
    const nr = p.nacR || (p.podEngines ? 0.085 : 0.05);   // fat rear pods (A-10's TF34s); p.nacR sizes big underwing turbofans (An-124 D-18T)
    const half = p.nacHalf ?? (0.17 + (nr - 0.05) * 1.3);   // fatter engines run longer too, so the tube stays proportioned; nacHalf overrides for a long slung nacelle
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
    if (p.prop === 'wing') addSpinner(faces, nf + half, g, hc);   // Twin Otter wing turboprops — on the nacelle's own nose, however long it is
  }
  // Nose prop. `p.spinner` sizes it — the default 0.5 is a light single's little GA spinner
  // (Cessna, Cub); an ag-plane hangs a 1000-shp turbine off the firewall and its spinner is a
  // BIG blunt cone almost as wide as the cowl, which is most of why the type reads heavy.
  if (p.prop === 'nose') addSpinner(faces, p.noseF, 0, 0.02, p.spinner ?? 0.5);
  // Cowl EXHAUST STACKS (p.exhaust) — the short dark pipes elbowing out of the cowl flanks just
  // ahead of the windscreen and canting aft. Tiny, but they're the difference between a smooth
  // moulded snout and an engine that's actually bolted in there.
  if (detail && p.exhaust) {
    const E = p.exhaust;
    for (const s of [1, -1]) for (const df of (E.at || [0])) {
      const f = E.f + df, g = s * (p.fr * (E.g ?? 0.86)), z = E.z ?? -0.01;
      addTube(faces, V(f, g, z), V(f - 0.06, g + s * 0.022, z - 0.012), E.r ?? 0.013, 'gun', 0.34, 6);
    }
  }
  // SPRAY RIG (p.sprayBoom) — the ag-plane's working end: a boom slung on drop struts under the
  // wing trailing edge, studded with nozzles, capped by the wingtip vortex fairings. This is the
  // honest counterpart to a gunship's stores line — same visual mass out along the span, and it's
  // the hardware the SPRAY verb is actually operating.
  if (detail && p.sprayBoom) {
    const B = p.sprayBoom, bf = B.f, bz = wH - (B.drop ?? 0.055), span = p.span * (B.reach ?? 0.94);
    addTube(faces, V(bf, -span, bz), V(bf, span, bz), B.r ?? 0.010, 'nacelle', 0.66, 6);   // the boom itself, tip to tip
    const N = B.nozzles ?? 9;
    for (let i = 0; i <= N; i++) {
      const g = -span + (2 * span) * (i / N);
      if (Math.abs(g) < p.fr * 1.2) continue;                                   // no nozzles through the fuselage
      addTube(faces, V(bf, g, bz), V(bf - 0.012, g, bz - 0.026), 0.005, 'gear', 0.42, 4);   // nozzle body + slipstream fan
      faces.push({ role: 'gear', sh: 0.5, p: [V(bf - 0.012, g - 0.012, bz - 0.030), V(bf - 0.012, g + 0.012, bz - 0.030), V(bf - 0.030, g, bz - 0.034)] });
    }
    for (const s of [1, -1]) {   // drop struts carrying the boom off the wing underside
      for (const t of [0.34, 0.70]) {
        const g = s * span * t;
        addTube(faces, V(bf, g, bz), V(bf + 0.01, g, wH - 0.012), 0.007, 'strut', 0.6, 4);
      }
      // Wingtip vortex fairing — the flat blade hung off each tip that keeps the swath off the wake.
      faces.push({ role: 'nacelle', sh: 0.7, p: [
        V(p.wTipF, s * p.span, wH + p.dih), V(p.wTipF - 0.02, s * p.span, wH + p.dih - 0.075),
        V(bf, s * p.span, wH + p.dih - 0.075), V(p.wTipB, s * p.span, wH + p.dih)] });
    }
  }
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
    else if (p.gearStyle === 'taildragger') addTaildraggerGear(faces, p, wz);   // conventional gear: two forward mains + a tailwheel
    else { addGear(faces, 0.10, p.fr + 0.06, wz); addGear(faces, 0.10, -(p.fr + 0.06), wz); addGear(faces, p.noseF * 0.55, 0, wz + 0.02); }
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
    // Canopy ART (cp.art): the bubble unwraps onto the shared canopy texture exactly the way the
    // Viper's greenhouse does — the SEGMENT index runs U (windscreen → rear), the ARC index runs
    // V (starboard sill → crown → port sill) — so one painted sheet of mullions, sky reflection
    // and the people inside wraps the whole cabin. Without `art` the bubble is plain tinted glass.
    const art = cp.art;
    let A = ringAt(0);
    for (let i = 1; i <= segs; i++) {
      const B = ringAt(i / segs);
      const uA = (i - 1) / segs * CP_TW, uB = i / segs * CP_TW;
      for (let k = 0; k < arc; k++) {
        const sh = 0.66 + 0.30 * Math.sin(Math.PI * (k + 0.5) / arc);   // crown pane brightest, side panes darker
        const fc = { role: 'glass', sh, p: [A[k], A[k + 1], B[k + 1], B[k]] };
        if (art) {
          fc.art = art;
          fc.uv = [[uA, k / arc * CP_TH], [uA, (k + 1) / arc * CP_TH], [uB, (k + 1) / arc * CP_TH], [uB, k / arc * CP_TH]];
        }
        faces.push(fc);
      }
      A = B;
    }
    // Cap the fore + aft rings so the greenhouse reads as a CLOSED bubble — a raked windscreen up
    // front and a faired rear window — instead of an open-ended tube. The backface cull auto-orients
    // each cap's normal from the model centre, so the flat end faces don't need a fixed winding.
    // A cap is a flat ring at ONE station, so it has no extent in U: give it a narrow slab of the
    // texture's leading (or trailing) edge, fanned across V, so the windscreen still carries its
    // frame and glass wash rather than dropping back to bare tint. drawCanopyGlass only takes 3–4
    // points, so an arc-3 ring caps as one textured quad; a FINER arc (the rounder bubbles) fans
    // from the ring's centre into arc textured triangles instead of dropping back to bare tint.
    const front = ringAt(0), rear = ringAt(1);
    const capUV = (uEdge, uIn) => [[uEdge, 0], [uIn, CP_TH / 3], [uIn, CP_TH * 2 / 3], [uEdge, CP_TH]];
    const pushCap = (ring, sh, uEdge, uIn) => {
      if (ring.length === 4) {
        const fc = { role: 'glass', sh, p: ring };
        if (art) { fc.art = art; fc.uv = capUV(uEdge, uIn); }
        faces.push(fc);
        return;
      }
      const C = ring.reduce((a, v) => [a[0] + v[0] / ring.length, a[1] + v[1] / ring.length, a[2] + v[2] / ring.length], [0, 0, 0]);
      for (let k = 0; k < ring.length - 1; k++) {
        const fc = { role: 'glass', sh, p: [C, ring[k], ring[k + 1]] };
        if (art) { fc.art = art; fc.uv = [[uIn, CP_TH / 2], [uEdge, k / arc * CP_TH], [uEdge, (k + 1) / arc * CP_TH]]; }
        faces.push(fc);
      }
    };
    pushCap(front, 0.72, 0, CP_TW * 0.07);
    pushCap(rear, 0.50, CP_TW, CP_TW * 0.93);
  }
  // ── Cargo visor group (Leviathan) ───────────────────────────────────────────────
  // Tag every skin/glass face forward of the cut ring as one hinged unit that swings UP
  // about a transverse line at the fuselage crown. `ring()` builds fresh vertices per
  // station, so the fore and aft quads that meet at the cut don't share points — at rest
  // the seam is invisible; opening yawns a clean cargo mouth instead of stretching the hull.
  // The nose gear (role 'gear') is deliberately left out so it stays planted on the ramp.
  if (detail && p.visor) {
    // SNAP THE CUT TO A REAL RING. `hingeAt` is authored as a fraction, so noseF × hingeAt lands a
    // few 1e-5 off the station it was meant to name — and since the "is this face forward of the
    // break" test is an inequality against that number, being 4.5e-5 on the wrong side excluded the
    // entire bay at the seam. The visor group then started one ring FURTHER FORWARD than the hinge
    // it pivots on, so the nose swung about an axis it wasn't attached to and tore open a gap the
    // width of a whole fuselage bay. Snapping to the nearest actual station makes the comment above
    // true instead of merely intended, and no authored fraction can drift off a ring again.
    const rawCut = p.noseF * (p.visor.hingeAt ?? 0.33);
    const cut = stations.reduce((b, s) => Math.abs(s - rawCut) < Math.abs(b - rawCut) ? s : b, stations[0]);
    // radVAt, not radAt: on a class whose nose sheds HEIGHT faster than width the crown at the cut
    // sits lower than the plan taper alone says, and a hinge axis floating above the skin tears the
    // nose off its own roof the moment it swings.
    const crownZ = czAt(cut) + p.fv * radVAt(cut) + humpAt(cut);   // top of the fuselage at the cut station — hump included, or the hinge floats above a crown that's risen out from under it
    const A = V(cut, p.fr, crownZ), B = V(cut, -p.fr, crownZ); // hinge axis: a lateral line across the crown
    const LIFT = new Set(['body', 'glass', 'window']);         // skin + flight-deck glass lift with the nose
    // HINGE KNUCKLE. A 70–90° swing about a line on the crown is geometrically correct but reads as
    // a severed nose, because the only thing joining the two halves is a mathematical axis with no
    // structure on it — nothing for the eye to accept as a JOINT. Real visor noses carry big external
    // hinge brackets up there, so give her a pair: two plates straddling the crown at the cut, left
    // on the BODY (untagged) so the nose visibly pivots on something that stays put.
    {
      const hf = 0.07, hb = 0.05, hh = 0.030, hg = p.fr * 0.34;   // fore reach · aft reach · height · lateral offset
      for (const s of [1, -1]) {
        const gg = s * hg;
        faces.push({ role: 'strut', sh: 0.52, visorOnly: true, p: [
          V(cut - hb, gg, crownZ - 0.01), V(cut + hf, gg, crownZ - 0.01),
          V(cut + hf * 0.35, gg, crownZ + hh), V(cut - hb * 0.5, gg, crownZ + hh)] });
      }
      faces.push({ role: 'strut', sh: 0.66, visorOnly: true, p: [   // the pin itself, capping the two brackets
        V(cut - hb * 0.5, hg, crownZ + hh), V(cut + hf * 0.35, hg, crownZ + hh),
        V(cut + hf * 0.35, -hg, crownZ + hh), V(cut - hb * 0.5, -hg, crownZ + hh)] });
    }
    const noseGearF = p.noseF * 0.45;                          // fore of this centroid = the NOSE leg; the main centipede bogies sit well aft and stay planted
    for (const f of faces) {
      const fwd = f.p.every(v => v[0] >= cut - 1e-6);
      // The nose leg is part of the swinging assembly and comes up with it, but ONLY if it really is
      // mounted on that section (centroid forward of the cut — see `noseGearAt`). Tagging a leg that
      // stands AFT of the break made it pivot about a hinge it isn't attached to, and it swung off
      // the belly into mid-air. Both halves of this test matter: the first picks the nose leg out of
      // the centipede, the second refuses to move anything the nose doesn't actually carry.
      const gearF = f.role === 'gear' ? f.p.reduce((a, v) => a + v[0], 0) / f.p.length : -Infinity;
      const isNoseGear = gearF > noseGearF && gearF >= cut - 1e-6;
      if ((LIFT.has(f.role) && fwd) || isNoseGear) { f.visor = true; f.visorHinge = [A, B]; f.visorMax = p.visor.maxAng ?? 0.9; }
    }
    // Cargo hold revealed when the visor stands up: a boxy inner bay (floor, ceiling, side walls,
    // rear bulkhead) recessed inside the main fuselage — static geometry the closed outer skin
    // occludes, seen only through the raised opening.
    const bF0 = cut, bF1 = -0.06;                              // opening plane → rear bulkhead
    const bw = p.fr * 0.66, bt = p.fv * 0.60, bb = -p.fv * 0.55;   // half-width, ceiling z, floor z (inset from the skin)
    faces.push({ role: 'interior', sh: 0.30, p: [V(bF1, -bw, bb), V(bF1, bw, bb), V(bF0, bw, bb), V(bF0, -bw, bb)] });   // floor
    faces.push({ role: 'interior', sh: 0.20, p: [V(bF0, -bw, bt), V(bF0, bw, bt), V(bF1, bw, bt), V(bF1, -bw, bt)] });   // ceiling
    faces.push({ role: 'interior', sh: 0.26, p: [V(bF1, bw, bb), V(bF1, bw, bt), V(bF0, bw, bt), V(bF0, bw, bb)] });     // starboard wall
    faces.push({ role: 'interior', sh: 0.26, p: [V(bF0, -bw, bb), V(bF0, -bw, bt), V(bF1, -bw, bt), V(bF1, -bw, bb)] }); // port wall
    faces.push({ role: 'interior', sh: 0.36, p: [V(bF1, -bw, bb), V(bF1, -bw, bt), V(bF1, bw, bt), V(bF1, bw, bb)] });   // rear bulkhead
    // Fold-down cargo ramp, hinged at the lower front lip. Authored DEPLOYED (lip → ground), then
    // pre-rotated UP into its stowed pose (tucked flat inside the hold, hidden behind the closed
    // nose); as part of the visor group, hingeVisorFace swings it back down as noseVisor → 1.
    const lipZ = czAt(cut) - p.fv * radVAt(cut);              // fuselage bottom at the cut station
    const rw = bw * 0.94, rampAng = 2.9;
    const hA = V(cut, rw, lipZ), hB = V(cut, -rw, lipZ);
    // The foot is the FULLY EXTENDED toe, and it is placed on the same ground plane the gear defines
    // (mains: belly − wheel radius) so a deployed ramp meets the tarmac instead of hovering over it
    // or sinking through. Everything below is a fraction of that lip→toe axis, so the slide can't
    // overshoot: fixed plate 0→MID, extension slides exactly the remaining MID→1.
    const footF = cut + (p.visor.ramp ?? 0.62), footZ = -(p.fv + 0.07);
    // Deployed frame: `d` runs down the ramp lip→foot, `n` is its surface normal. Every detail below
    // is placed in this frame and then stowed, so the ribs and rails sit ON the plate at any angle
    // instead of being hand-placed in world space and drifting off it as the ramp swings.
    const dF = footF - cut, dZ = footZ - lipZ, dL = Math.hypot(dF, dZ) || 1;
    const d = [dF / dL, 0, dZ / dL], n = [-dZ / dL, 0, dF / dL];
    const at = (u, gg, lift = 0) => V(cut + d[0] * dL * u + n[0] * lift, gg, lipZ + d[2] * dL * u + n[2] * lift);
    const stow = (pts) => rotAboutAxis(pts, hA, hB, rampAng);
    const push = (sh, pts, slide) => {
      const f = { role: 'ramp', sh, p: stow(pts), visor: true, visorHinge: [hA, hB], visorMax: -rampAng };
      if (slide) f.slide = slide;
      faces.push(f);
    };
    // Main plate — the fixed half, lip to mid-span. The sliding section carries the rest: MID + the
    // slide fraction sum to exactly 1, i.e. the toe.
    const MID = 0.58;
    push(0.72, [at(0, -rw), at(0, rw), at(MID, rw), at(MID, -rw)]);
    push(0.44, [at(MID, -rw, -0.012), at(MID, rw, -0.012), at(0, rw, -0.012), at(0, -rw, -0.012)]);
    // Side rails — raised kerbs down both edges, the thing that stops a pallet walking off the side.
    for (const s of [1, -1]) {
      const gg = s * rw;
      push(0.60, [at(0, gg), at(MID, gg), at(MID, gg, 0.022), at(0, gg, 0.022)]);
      push(0.84, [at(0, gg, 0.022), at(MID, gg, 0.022), at(MID, gg - s * 0.014, 0.022), at(0, gg - s * 0.014, 0.022)]);   // rail top
    }
    // Traction ribs across the deck — the cross-hatching every cargo ramp has, and the detail that
    // reads as "load-bearing steel" rather than a plank.
    for (let i = 1; i <= 4; i++) {
      const u = MID * (i / 5), w = 0.012;
      push(0.90, [at(u - w, -rw * 0.93, 0.005), at(u - w, rw * 0.93, 0.005), at(u + w, rw * 0.93, 0.005), at(u + w, -rw * 0.93, 0.005)]);
    }
    // TELESCOPING EXTENSION. Authored nested under the fixed plate (so a shut ramp is one slab) and
    // slid out along the ramp's own axis by `slide`. hingeVisorFace runs it on a DELAYED curve — it
    // stays home until the nose is most of the way up, then eases out — because a ramp that
    // telescopes while it's still swinging reads as two unrelated things moving at once.
    // The extension must be authored at least EXT long, or sliding it out by EXT drags its rear edge
    // past the fixed plate's end and opens a hole in the middle of the ramp — the gap being exactly
    // EXT minus the overlap. Start it a further LAP back so the two stay lapped at full extension
    // instead of meeting on a hairline.
    const EXT = 1 - MID, LAP = 0.05, U0 = Math.max(0.02, MID - EXT - LAP);
    const ext = dL * EXT, erw = rw * 0.88, sl = [d[0] * ext, 0, d[2] * ext];
    push(0.78, [at(U0, -erw, 0.006), at(U0, erw, 0.006), at(MID, erw, 0.006), at(MID, -erw, 0.006)], sl);
    push(0.40, [at(MID, -erw, -0.006), at(MID, erw, -0.006), at(U0, erw, -0.006), at(U0, -erw, -0.006)], sl);
    for (const s of [1, -1]) {   // the slide's own rails, so the extended section still has edges
      const gg = s * erw;
      push(0.56, [at(U0, gg, 0.006), at(MID, gg, 0.006), at(MID, gg, 0.024), at(U0, gg, 0.024)], sl);
    }
    push(0.94, [at(MID - 0.03, -erw, 0.006), at(MID - 0.03, erw, 0.006), at(MID, erw, -0.002), at(MID, -erw, -0.002)], sl);   // the toe: a bevelled lip that meets the tarmac
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
// `axis` is which way the parent panel is thin — 'z' for a wing/tailplane, 'g' for a vertical fin —
// and `half` is the parent's half-thickness. The surface is emitted as a two-sided plate standing
// just PROUD of the parent on both faces, never in its plane.
//
// This is a z-fighting fix, not decoration. The old single quad floated 0.006 off the panel's MID
// plane, which buries it inside a wing 0.028 thick and puts it exactly coplanar with a flat fin. Two
// overlapping faces at the same depth have no stable painter's-algorithm order, so the sort flipped
// with the camera and the wing tops and fins strobed. Separating them by the real skin thickness
// gives the sort something to be right about.
function pushCtrlSurface(faces, role, side, sh, le0, le1, te0, te1, cf, axis = 'z', half = 0.014) {
  const off = half + 0.004;
  const bump = (v, s) => axis === 'g' ? [v[0], v[1] + s * off, v[2]] : [v[0], v[1], v[2] + s * off];
  const h0 = _lerp3(te0, le0, cf), h1 = _lerp3(te1, le1, cf);
  for (const s of [1, -1]) {
    const T0 = bump(te0, s), T1 = bump(te1, s), H0 = bump(h0, s), H1 = bump(h1, s);
    faces.push({ role, defl: role, side, sh: s > 0 ? sh : sh * 0.72,
      hinge: [H0, H1], p: s > 0 ? [H0, H1, T1, T0] : [T0, T1, H1, H0] });
  }
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
  pushCtrlSurface(faces, 'elevator', s, 0.72, le(0.06), le(0.95), te(0.06), te(0.95), 0.34, 'z', 0.010);   // tailplane is thinner than the wing (0.02) — match it or the elevator floats off the surface
}

// Build the rudder on one vertical fin at lateral station `fg`. The fin is a flat triangle in the
// g=fg plane (apex finF1/finH, base finF0→finF2 at z≈0.06); the rudder is its aft strip, hinged on
// a near-vertical line shifted FORWARD of the trailing edge by `cf` of the base chord, so it swings
// in ±g (yaw). Coplanar with the fin at rest → invisible seam; visible only once it kicks over.
function addFinSurface(faces, p, fg) {
  const cf = 0.4, df = cf * (p.finF0 - p.finF2);                        // forward hinge offset from the TE
  // Two-sided, straddling the fin. The fin is a flat triangle and the rudder used to be authored in
  // exactly its plane — "coplanar at rest → invisible seam" was true right up until the depth sort
  // had to choose between two faces at identical depth, at which point the fin strobed. A plate with
  // a side to it can't be coplanar with anything.
  const off = 0.007;
  for (const s of [1, -1]) {
    const gg = fg + s * off;
    const P1 = V(p.finF1, gg, p.finH), P2 = V(p.finF2, gg, 0.06);      // trailing edge: apex → base-rear
    const Htop = V(p.finF1 + df, gg, p.finH), Hbot = V(p.finF2 + df, gg, 0.06);
    faces.push({ role: 'rudder', defl: 'rudder', side: Math.sign(fg) || 1, sh: s > 0 ? 0.88 : 0.66,
      hinge: [Htop, Hbot], p: s > 0 ? [Htop, Hbot, P2, P1] : [P1, P2, Hbot, Htop] });
  }
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
  return rotAboutAxis(face.p, face.hinge[0], face.hinge[1], ang);
}

// Rodrigues rotation of a point list about the axis A→B by `ang` (rad). Returns a fresh array;
// never mutates the input. Shared by the control-surface deflection and the Leviathan visor nose.
function rotAboutAxis(pts, A, B, ang) {
  let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
  const ct = Math.cos(ang), st = Math.sin(ang);
  return pts.map(pt => {
    const vx = pt[0] - A[0], vy = pt[1] - A[1], vz = pt[2] - A[2];
    const dv = dx * vx + dy * vy + dz * vz;
    const cx = dy * vz - dz * vy, cy = dz * vx - dx * vz, cz = dx * vy - dy * vx;   // d × v
    return [
      A[0] + vx * ct + cx * st + dx * dv * (1 - ct),
      A[1] + vy * ct + cy * st + dy * dv * (1 - ct),
      A[2] + vz * ct + cz * st + dz * dv * (1 - ct)];
  });
}

// Visor-nose group: does this class HAVE one (→ null if not), for the driver to gate the animation.
export function visorSpecFor(cls) { return (FW_PARAMS[cls] || {}).visor || null; }

// Geometry that exists ONLY to be seen through an open cargo mouth — the hold's inner box and the
// fold-down ramp stowed inside it. With the nose shut it's sealed inside the fuselage, where it is
// not merely redundant but actively wrong: the painter's sort every renderer uses orders faces by
// centroid depth, and the hold's floor is one long face whose centroid can sort AHEAD of the small
// belly quads actually in front of it. So it punches through the skin and reads as loose panels
// floating around the aeroplane. Skipping it when the visor is home is both cheaper and correct.
//
// A renderer that has no concept of a visor (the hangar turntable, the dealer wireframe, the
// showroom scene) passes nothing and gets t=0 — which is exactly right for those views: a parked
// aeroplane on display sits buttoned up, not gaping.
// `visorOnly` extends this to anything else that must not exist with the nose home — notably the
// hinge brackets, which are external structure you only ever see once the joint is broken open. Left
// drawn on a shut aeroplane they'd be two lumps sitting proud of an otherwise clean crown.
export function visorHidden(face, t = 0) {
  return (face.visorOnly || face.role === 'interior' || face.role === 'ramp') && !(t > 0.001);
}

// Swing a tagged visor face UP by `t` (0 = closed/home, 1 = fully raised). Untagged faces and t≈0
// pass through untouched, so a craft with no visor (or a closed one) costs nothing.
// A telescoping part starts moving only once `t` passes SLIDE_T0, then eases out on a smoothstep.
// The delay is the whole trick: run the slide on the same clock as the swing and the eye reads two
// unrelated motions at once, instead of one machine finishing its cycle — nose up, THEN ramp out.
const SLIDE_T0 = 0.58;
export function slideEase(t) {
  const u = t <= SLIDE_T0 ? 0 : Math.min(1, (t - SLIDE_T0) / (1 - SLIDE_T0));
  return u * u * (3 - 2 * u);
}
export function hingeVisorFace(face, t) {
  if (!face.visorHinge || !t) return face.p;
  const pts = rotAboutAxis(face.p, face.visorHinge[0], face.visorHinge[1], (face.visorMax || 0.9) * t);
  if (!face.slide) return pts;
  // Translate AFTER the rotation, in world space: `slide` was authored along the deployed ramp's own
  // axis, and by the time the ease is non-zero the plate is nearly deployed, so the extension runs
  // true down the ramp rather than skewing off it.
  const e = slideEase(t);
  if (!e) return pts;
  return pts.map(q => [q[0] + face.slide[0] * e, q[1] + face.slide[1] * e, q[2] + face.slide[2] * e]);
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
  // Nose unit. `noseGearAt` puts it FORWARD of the visor cut on a class with a hinged cargo nose,
  // so the leg is bolted to the section that swings and rides up with it as one assembly — rather
  // than standing under the hinge unattached to either half, which is what read as a landing leg
  // floating loose beside the aeroplane.
  // The nose wheels are SMALLER than the mains (wr*0.85), so sharing the mains' axle height hung
  // them 0.0225 clear of the ground — a front wheel visibly floating above the tarmac while the
  // aeroplane rested on its bogies. Put the axle where the smaller tyre's BOTTOM lands on the same
  // ground line the mains define, and the whole undercarriage sits on one plane.
  const nf = p.noseF * (p.noseGearAt ?? 0.55), nWr = wr * 0.85, nz = (wz - wr) + nWr;
  addStrut(faces, nf, 0, nz + 0.10, nz + 0.045, 0.018, 6);
  pushWheel(faces, nf + 0.045, 0, nz, nWr, 0.018, 8);   // twin nose unit
  pushWheel(faces, nf - 0.045, 0, nz, nWr, 0.018, 8);
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
// `s` also scales its girth and how high it stands, so a fairing over a big ag tyre actually
// covers the tyre instead of sitting on it like a cap.
function addSpat(faces, f, g, wz, s = 1) {
  const F = V(f + 0.08 * s, g, wz + 0.03 * s), B = V(f - 0.06 * s, g, wz + 0.035 * s), T = V(f + 0.005, g, wz + 0.075 * s),
    L = V(f + 0.005, g - 0.024 * s, wz + 0.03 * s), R = V(f + 0.005, g + 0.024 * s, wz + 0.03 * s);
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

// Conventional (taildragger) gear — two main legs set well FORWARD of the CG plus a small
// tailwheel aft. `p.tundra` swaps the slim spatted wheels for FAT BARE bush tyres on beefier
// legs (the Super-Cub look). The tailwheel is placed so the mains + tailwheel are COPLANAR at
// the craft's `groundPitch` 3-point attitude, so she renders planted nose-high on the ground and
// the tail lifts clean as pitch comes down on the takeoff roll. Shared by the Grasshopper (bush)
// & Locust (sleek).
function addTaildraggerGear(faces, p, wz) {
  const tundra = !!p.tundra, ag = !!p.gearAg;
  // Three sizes off one builder: bush (fat bare tundra tyres), AG (a heavy machine carrying a
  // ton and a half of chemical — a wide track on long faired legs and big spatted wheels), and
  // the plain light-plane leaf spring.
  const gw = p.fr + (tundra ? 0.13 : ag ? 0.16 : 0.10);
  const mf = tundra ? 0.17 : ag ? 0.22 : 0.20, hc = tundra ? 0.036 : ag ? 0.040 : 0.030;
  const rMain = tundra ? 0.085 : ag ? 0.068 : 0.048, hwMain = tundra ? 0.040 : ag ? 0.026 : 0.015;
  const rTail = tundra ? 0.034 : ag ? 0.032 : 0.026;
  for (const side of [1, -1]) {
    pushPanel(faces, 'gear', 0.6, [
      V(mf + hc, side * 0.05, -p.fv * 0.6), V(mf + hc * 0.7, side * gw, wz + 0.02),
      V(mf - hc * 0.7, side * gw, wz + 0.02), V(mf - hc, side * 0.05, -p.fv * 0.6)], tundra ? 0.022 : ag ? 0.020 : 0.014, 1);   // beefier bush/ag leg / slim leaf-spring
    pushWheel(faces, mf, side * gw, wz, rMain, hwMain, tundra ? 14 : ag ? 12 : 8);
    if (!tundra) addSpat(faces, mf, side * gw, wz, ag ? 1.35 : 1);   // bush planes run bare tundra tyres — no wheel pants; an ag-plane's pants are long and deep
  }
  // Tailwheel coplanar with the mains at the 3-point (groundPitch) sit — see the header note.
  const tf = p.tailF * 0.82;
  const gp = (p.groundPitch || 0) * Math.PI / 180;
  const tz = wz - rMain + rTail + (mf - tf) * Math.sin(gp);
  addStrut(faces, tf, 0, Math.max(0.0, tz + rTail + 0.06), tz + rTail, 0.011, 5);
  pushWheel(faces, tf, 0, tz, rTail, 0.010, 8);
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
// tall exposed mast. Cabin + boom are skinned from finely-subdivided cross-section rings so they
// read as one smooth teardrop, not a faceted egg. Anchors held fixed for the FX layer: main rotor
// plane at (0.1, 0, 0.34), tail rotor at (-1.04, 0.07, 0.12) — see drawRotorFX.
function buildHeli() {
  const faces = [];
  const sides = 14;   // ring resolution (was 8) — smooth bubble & boom
  const ring = (f, rg, rv, cz) => { const o = []; for (let k = 0; k < sides; k++) { const a = k / sides * Math.PI * 2; o.push(V(f, Math.cos(a) * rg, cz + Math.sin(a) * rv)); } return o; };
  const shFor = (k) => 0.6 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright → bottom dark
  const GLASS_TINT = [64, 90, 112];   // clear fishbowl bubble — lighter than the default near-black canopy so it reads as glass over a bright cockpit, not a dark orb
  const skin = (A, B, role = 'body', m = 1) => { for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; const f = { role, sh: shFor(k) * m, p: [A[k], A[k2], B[k2], B[k]] }; if (role === 'glass') f.tint = GLASS_TINT; faces.push(f); } };
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
  for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; faces.push({ role: 'glass', tint: GLASS_TINT, sh: shFor(k), p: [noseApex, cabin[0][k], cabin[0][k2]] }); }
  // Canopy FRAMING — the Mini-500's signature: thin trim mullions over the clear fishbowl so it
  // reads as a framed cockpit, not one dark glossy sphere. A windshield centre post up the nose,
  // a door-frame arch at the canopy's rear edge, and a sill hoop where glass meets the shell.
  const post = [noseApex, V(0.60, 0, 0.135), V(0.46, 0, 0.195), V(0.30, 0, 0.230)];   // centre spine over the top
  for (let i = 0; i < post.length - 1; i++) addTube(faces, post[i], post[i + 1], 0.010, 'nacelle', 0.9, 5);
  for (const s of [1, -1]) {   // a door-frame arch each side, over the top and down to the sill
    const arch = [V(0.30, s * 0.185, 0.020), V(0.34, s * 0.150, 0.150), V(0.32, s * 0.075, 0.220), V(0.30, 0, 0.230)];
    for (let i = 0; i < arch.length - 1; i++) addTube(faces, arch[i], arch[i + 1], 0.009, 'nacelle', 0.85, 5);
    // Sill hoop: a rail along the glass/shell seam from the nose to the door arch.
    addTube(faces, V(0.58, s * 0.100, 0.010), V(0.44, s * 0.160, 0.010), 0.009, 'nacelle', 0.7, 5);
    addTube(faces, V(0.44, s * 0.160, 0.010), V(0.30, s * 0.190, 0.015), 0.009, 'nacelle', 0.7, 5);
  }
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
  // ── Rotor MAST + HEAD ── a Mini-500 has a tall EXPOSED mast standing well clear of the
  // engine deck, capped by a compact drum hub over a swashplate. Built as real 3D geometry so
  // it foreshortens with the airframe — the flat 2D hub dot the FX layer used to stamp here read
  // as a floating sphere because a screen-space circle can't flatten when the disc goes edge-on.
  const cf = 0.1, cz = 0.34, rad = 1.05;   // hub top height — the FX blade plane (drawRotorFX) matches this
  addTube(faces, V(cf, 0, 0.18), V(cf, 0, cz - 0.045), 0.017, 'nacelle', 0.82, 8);   // slender exposed mast
  // Swashplate: a wider ring low on the mast, with a thin scissor link up to the head.
  const swashZ = cz - 0.075, swR = 0.058;
  const swashLo = [], swashHi = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, cx = cf + Math.cos(a) * swR, cy = Math.sin(a) * swR; swashLo.push(V(cx, cy, swashZ - 0.012)); swashHi.push(V(cx, cy, swashZ + 0.012)); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push({ role: 'nacelle', sh: 0.55 + 0.12 * (i % 2), p: [swashLo[i], swashLo[j], swashHi[j], swashHi[i]] }); }
  faces.push({ role: 'nacelle', sh: 0.7, p: swashHi });   // swashplate top face
  for (const s of [1, -1]) addTube(faces, V(cf + s * swR * 0.7, s * swR * 0.2, swashZ), V(cf + s * 0.012, 0, cz - 0.05), 0.006, 'gear', 0.5, 4);   // pitch links
  // Hub DRUM: a short octagonal barrel capped top and bottom — the mechanical mass the blades bolt to.
  const hubR = 0.05, hubB = cz - 0.05, hubT = cz + 0.008;
  const drumB = [], drumT = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, cx = cf + Math.cos(a) * hubR, cy = Math.sin(a) * hubR; drumB.push(V(cx, cy, hubB)); drumT.push(V(cx, cy, hubT)); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push({ role: 'nacelle', sh: 0.7 + 0.2 * ((i + 1) % 2), p: [drumB[i], drumB[j], drumT[j], drumT[i]] }); }
  faces.push({ role: 'nacelle', sh: 0.95, p: drumT });   // hub top cap
  // Two stubby blade GRIPS reaching out from the drum — where the parked blades bolt on.
  for (const s of [1, -1]) {
    const gz = cz - 0.02, gw = 0.014;
    faces.push({ role: 'nacelle', sh: s > 0 ? 0.9 : 0.66, p: [V(cf + s * hubR, gw, gz + gw), V(cf + s * 0.17, gw, gz + gw * 0.6), V(cf + s * 0.17, -gw, gz + gw * 0.6), V(cf + s * hubR, -gw, gz + gw)] });
    faces.push({ role: 'nacelle', sh: 0.8, p: [V(cf + s * hubR, gw, gz + gw), V(cf + s * 0.17, gw, gz + gw * 0.6), V(cf + s * 0.17, gw, gz - gw * 0.6), V(cf + s * hubR, gw, gz - gw)] });
  }
  // Main-rotor disc (octagon) — schematic wireframe renderer only; painted renderers draw blades.
  const disc = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc.push(V(cf + Math.cos(a) * rad, Math.sin(a) * rad, cz)); }
  faces.push({ role: 'rotor', sh: 0.65, p: disc });
  return faces;
}

// ── VIPER — a sleek futuristic ATTACK HELICOPTER (an Apache reimagined) ──────────────
// An armed heli (class 'heli' with hardpoints → this mesh; the unarmed Dragonfly keeps the
// bubble). Signatures vs the Mini-500: a slender, chined, tapering gunship fuselage; a TANDEM
// STEPPED canopy cut straight INTO the hull (see the greenhouse section below); a chin GUN turret
// + a nose sensor ball under the nose; short anhedral STUB-WINGS carrying rocket PODS inboard and
// exposed MISSILES on the tips (the swarm made visible); twin "cheek" engine nacelles with exhausts
// flanking the mast; a slim tailboom to a swept fin + stabilator + tail rotor; and fixed TAILDRAGGER
// gear. Built to the same station-ring + explicit-facet fidelity as the fixed-wing set.
//
// STANCE + SIZE: everything below is authored at unit scale and LEVEL, then the whole mesh is run
// through viperXf() on the way out — double-size, and nothing else. The nose-high 3-point squat is
// NOT baked in: like the fixed-wing taildraggers she carries a `groundPitch` (VIPER_GROUND_PITCH,
// see groundPitchFor) that the renderers apply as an ATTITUDE, so the tail can fly first on the
// lift-off and be walked back down on the landing instead of being welded nose-up forever.
// Consequences to respect if you touch this:
//   • the rotor mast (0.1,0,0.34) and tail rotor (-1.04,0.07,0.12) are PRE-transform stations;
//     drawRotorFX runs its heli anchors through the same viperXf when `armed`, so the discs scale
//     with the airframe. Change one, you get the other for free — don't hardcode.
//   • windshield.js measures ground contact per cls+armed (modelLowestH/modelGroundDrop/modelMidH),
//     because this mesh hangs far lower than the unarmed Dragonfly it shares a class with.
function buildAttackHeli() {
  const faces = [];
  const q = (role, sh, a, b, c, d) => faces.push({ role, sh, p: d ? [a, b, c, d] : [a, b, c] });
  const GLASS = [46, 68, 92];   // sleek dark-cyan canopy glass (a shade cooler/darker than the Dragonfly fishbowl)

  // ── Fuselage: an angular, slender gunship body. Cross-sections are 10-gons squashed toward a
  // chined profile (taller than wide up front, a keeled belly) sampled nose→boom and skinned smooth.
  const sides = 10;
  const ring = (f, rg, rv, cz, keel = 0) => {
    const o = [];
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      // superellipse-ish chine: push the flanks out and flatten the top for a faceted, purposeful read
      const gg = Math.sign(cs) * Math.pow(Math.abs(cs), 0.82) * rg;
      const hh = sn >= 0 ? Math.pow(sn, 0.9) * rv : -Math.pow(-sn, 0.72) * (rv + keel);   // deeper, keeled belly
      o.push(V(f, gg, cz + hh));
    }
    return o;
  };
  const shFor = (k) => 0.60 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright → belly dark

  // ── The CANOPY IS THE HULL. There is no glass blister bolted to the crown: the gunner and
  // pilot stations are built as an angular GREENHOUSE cross-section — a flat roof between two
  // canted cheek panes and near-vertical side glass down to a sill chine — and those fuselage
  // facets are simply glazed. Everything that makes it read as an Apache canopy (heavy mullions,
  // sky reflection, the dark cockpit behind the glass, crew silhouettes) is PAINTED by canopyTex()
  // through the authored UVs below, not modelled.
  //   gring() re-places only the upper 6 vertices (k=0..5); the lower half reuses ring()'s exact
  //   formula so a greenhouse station welds seamlessly to the plain stations fore and aft. Roof
  //   height (rvT) is decoupled from belly depth (rvB) so a tall canopy doesn't drag the keel down.
  const GH = [[1.00, 0.00], [0.94, 0.62], [0.44, 1.00], [-0.44, 1.00], [-0.94, 0.62], [-1.00, 0.00]];   // k=0..5 upper profile, as fractions of (rg, rvT)
  const gring = (f, rg, rvT, rvB, cz, keel = 0) => {
    const o = [];
    for (let k = 0; k < sides; k++) {
      if (k <= 5) { o.push(V(f, GH[k][0] * rg, cz + GH[k][1] * rvT)); continue; }
      const a = k / sides * Math.PI * 2, cs = Math.cos(a);
      o.push(V(f, Math.sign(cs) * Math.pow(Math.abs(cs), 0.82) * rg, cz - Math.pow(-Math.sin(a), 0.72) * (rvB + keel)));
    }
    return o;
  };
  const body = [
    ring(0.70, 0.052, 0.072, 0.055, 0.01),            // 0 pointed nose
    ring(0.60, 0.078, 0.092, 0.050, 0.02),            // 1 nose barrel — the canopy sill line starts here
    gring(0.52, 0.100, 0.130, 0.108, 0.048, 0.03),    // 2 gunner windscreen top (bay 1 is the raked screen)
    gring(0.36, 0.114, 0.146, 0.126, 0.048, 0.035),   // 3 gunner aft — level roof runs 2→3
    gring(0.29, 0.118, 0.194, 0.130, 0.050, 0.035),   // 4 pilot windscreen top — THE STEP
    gring(0.14, 0.126, 0.198, 0.142, 0.054, 0.035),   // 5 pilot aft
    ring(0.04, 0.126, 0.150, 0.058, 0.035),           // 6 engine deck — the canopy closes back down
    ring(-0.14, 0.112, 0.128, 0.072, 0.028),          // 7 engine-bay shoulders
    ring(-0.26, 0.074, 0.086, 0.084, 0.015),          // 8 boom taper
    ring(-0.34, 0.050, 0.058, 0.095, 0.008),          // 9 boom junction
  ];
  // Which of the 5 upper facets each bay glazes (bay i spans station i→i+1), and the texture-U at
  // each station. The unwrap is U 0→1 windscreen→rear canopy, V 0→1 right sill→roof→left sill
  // (k/5) — so the whole greenhouse is one continuous painted sheet, symmetric about the centreline.
  const GLAZE = { 1: [0, 1, 2, 3, 4], 2: [0, 1, 2, 3, 4], 3: [1, 2, 3], 4: [0, 1, 2, 3, 4], 5: [1, 2, 3] };
  const STATION_U = [0, 0.00, 0.14, 0.44, 0.56, 0.86, 1.00];
  for (let i = 0; i < body.length - 1; i++) {
    const glz = GLAZE[i], uA = STATION_U[i] * CP_TW, uB = STATION_U[i + 1] * CP_TW;
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      const fc = { role: 'body', sh: shFor(k), p: [body[i][k], body[i][j], body[i + 1][j], body[i + 1][k]] };
      if (glz && glz.includes(k)) {
        fc.role = 'glass'; fc.tint = GLASS; fc.art = 'viper';
        fc.uv = [[uA, k / 5 * CP_TH], [uA, j / 5 * CP_TH], [uB, j / 5 * CP_TH], [uB, k / 5 * CP_TH]];
      }
      faces.push(fc);
    }
  }
  // Faceted nose cap — a blunt chisel point ahead of the front ring (the chin turret hangs below it).
  const noseApex = V(0.80, 0, 0.052);
  for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; q('body', shFor(k), noseApex, body[0][k], body[0][j]); }

  // ── Chin GUN turret + barrel (the under-nose cannon) — a small faceted turret ball slung below
  // the gunner, with a stubby cannon that points forward and slightly down.
  addTube(faces, V(0.50, 0, -0.010), V(0.50, 0, 0.030), 0.045, 'gun', 0.5, 8);   // turret ball
  addTube(faces, V(0.50, 0, -0.010), V(0.78, 0, -0.028), 0.016, 'gun', 0.62, 6); // cannon barrel
  addTube(faces, V(0.50, -0.028, -0.006), V(0.71, -0.028, -0.020), 0.007, 'gun', 0.6, 5);  // twin muzzle detail
  addTube(faces, V(0.50, 0.028, -0.006), V(0.71, 0.028, -0.020), 0.007, 'gun', 0.6, 5);
  // Nose SENSOR turret (TADS/PNVS) — a stacked faceted sight above the gun at the very nose.
  addTube(faces, V(0.74, 0, 0.055), V(0.83, 0, 0.055), 0.038, 'nacelle', 0.7, 8);
  q('glass', 0.95, V(0.83, -0.024, 0.075), V(0.83, 0.024, 0.075), V(0.83, 0.024, 0.035), V(0.83, -0.024, 0.035));   // sensor face (glass)

  // ── STUB-WINGS: short, thick, swept, ANHEDRAL slabs off the engine-deck flanks — the weapon rails.
  const wingLE = 0.14, wingTErt = -0.24, tipDrop = -0.055;
  for (const s of [1, -1]) {
    const rG = 0.12, tG = 0.60;
    // planform corners (root then tip, swept back + drooped)
    const rlF = V(wingLE, s * rG, 0.055), rtF = V(wingTErt, s * rG, 0.050);      // root LE / TE
    const tlF = V(wingLE - 0.05, s * tG, 0.055 + tipDrop), ttF = V(wingTErt + 0.02, s * tG, 0.050 + tipDrop); // tip LE / TE
    const th = 0.024;   // half-thickness
    const up = (v) => V(v[0], v[1], v[2] + th), dn = (v) => V(v[0], v[1], v[2] - th);
    q('wing', 0.92, up(rlF), up(rtF), up(ttF), up(tlF));   // top skin
    q('wing', 0.5, dn(rlF), dn(tlF), dn(ttF), dn(rtF));    // bottom skin
    q('wing', 0.82, up(rlF), up(tlF), dn(tlF), dn(rlF));   // leading edge
    q('wing', 0.44, up(rtF), dn(rtF), dn(ttF), up(ttF));   // trailing edge
    q('nacelle', 0.7, up(tlF), up(ttF), dn(ttF), dn(tlF)); // tip cap
    const wz = 0.050 + tipDrop * 0.55 - th;   // pylon underside height along the wing
    // Inboard ROCKET POD (multi-tube launcher): a faceted cylinder with 4 tube mouths in the front face.
    const pf = -0.02, pg = s * 0.33;
    addTube(faces, V(pf + 0.14, pg, wz - 0.03), V(pf - 0.16, pg, wz - 0.03), 0.05, 'nacelle', 0.66, 8);
    for (const [dg, dh] of [[-0.022, 0.022], [0.022, 0.022], [-0.022, -0.022], [0.022, -0.022]])
      addTube(faces, V(pf + 0.145, pg + dg, wz - 0.03 + dh), V(pf + 0.11, pg + dg, wz - 0.03 + dh), 0.014, 'gun', 0.4, 5);   // recessed tube mouths (dark)
    // Outboard TIP MISSILES — two exposed seekers stacked on the tip rail, pointed noses forward
    // (the swarm, made visible).
    for (const off of [0.028, -0.028]) addMissileBody(faces, -0.14, 0.16, s * 0.55, wz - 0.02 + off);
  }

  // ── Slim TAILBOOM: a tapering 8-gon tube from the boom junction back to the tail rotor gearbox,
  // rising to meet the FX tail-rotor anchor height.
  const bs = 8;
  const bring = (f, r, cz) => { const o = []; for (let k = 0; k < bs; k++) { const a = k / bs * Math.PI * 2; o.push(V(f, Math.cos(a) * r, cz + Math.sin(a) * r)); } return o; };
  const boom = [bring(-0.34, 0.050, 0.095), bring(-0.58, 0.038, 0.104), bring(-0.82, 0.030, 0.112), bring(-1.02, 0.024, 0.120)];
  const bsh = (k) => 0.6 + 0.3 * (0.5 + 0.5 * Math.sin((k + 0.5) / bs * Math.PI * 2));
  for (let i = 0; i < boom.length - 1; i++) for (let k = 0; k < bs; k++) { const j = (k + 1) % bs; faces.push({ role: 'body', sh: bsh(k) * 0.94, p: [boom[i][k], boom[i][j], boom[i + 1][j], boom[i + 1][k]] }); }

  // Swept vertical FIN (a thin extruded blade) at the boom end.
  const finT = 0.013, fin = [V(-0.84, 0, 0.14), V(-0.98, 0, 0.34), V(-1.10, 0, 0.44), V(-1.08, 0, 0.13)];
  for (const s of [1, -1]) { const p = fin.map(v => V(v[0], s * finT, v[2])); faces.push({ role: 'fin', sh: s > 0 ? 0.92 : 0.7, p }); }
  faces.push({ role: 'fin', sh: 0.82, p: [V(-0.98, finT, 0.34), V(-1.10, finT, 0.44), V(-1.10, -finT, 0.44), V(-0.98, -finT, 0.34)] });
  // STABILATOR — a swept horizontal tailplane across the boom (a thin slab each side).
  for (const s of [1, -1]) {
    q('stab', s > 0 ? 0.9 : 0.66,
      V(-0.72, s * 0.02, 0.116), V(-0.72, s * 0.26, 0.120), V(-0.86, s * 0.26, 0.124), V(-0.86, s * 0.02, 0.120));
  }
  // Tail-rotor GEARBOX fairing + a schematic disc face at the FX anchor (-1.04,0.07,0.12).
  addTube(faces, V(-0.98, 0.02, 0.12), V(-1.06, 0.07, 0.12), 0.026, 'nacelle', 0.72, 7);
  faces.push({ role: 'rotor', sh: 0.7, p: [V(-1.04, 0.07, -0.05), V(-1.04, 0.07, 0.29), V(-1.14, 0.07, 0.29), V(-1.14, 0.07, -0.05)] });

  // ── Twin CHEEK ENGINE nacelles flanking the mast base, each with a dark rear exhaust.
  for (const s of [1, -1]) {
    const ef = 0.02, eg = s * 0.135, ez = 0.135;
    addTube(faces, V(ef + 0.14, eg, ez), V(ef - 0.16, eg, ez), 0.062, 'nacelle', 0.72, 8);   // nacelle barrel
    addTube(faces, V(ef - 0.14, eg, ez), V(ef - 0.20, eg * 1.15, ez + 0.01), 0.05, 'gun', 0.34, 8);   // exhaust (dark, canted out)
  }

  // ── Main ROTOR mast + hub at (0.1,0,0.34) — the FX blade plane. A stout mast off the engine deck,
  // a swashplate ring, and an octagonal hub drum with two parked blade grips.
  const cf = 0.1, cz = 0.34;
  addTube(faces, V(cf, 0, 0.16), V(cf, 0, cz - 0.045), 0.020, 'nacelle', 0.82, 8);   // mast
  const swZ = cz - 0.07, swR = 0.060, swLo = [], swHi = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, cx = cf + Math.cos(a) * swR, cy = Math.sin(a) * swR; swLo.push(V(cx, cy, swZ - 0.012)); swHi.push(V(cx, cy, swZ + 0.012)); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push({ role: 'nacelle', sh: 0.55 + 0.12 * (i % 2), p: [swLo[i], swLo[j], swHi[j], swHi[i]] }); }
  faces.push({ role: 'nacelle', sh: 0.7, p: swHi });
  const hubR = 0.052, hubB = cz - 0.05, hubT = cz + 0.01, dB = [], dT = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, cx = cf + Math.cos(a) * hubR, cy = Math.sin(a) * hubR; dB.push(V(cx, cy, hubB)); dT.push(V(cx, cy, hubT)); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push({ role: 'nacelle', sh: 0.7 + 0.2 * ((i + 1) % 2), p: [dB[i], dB[j], dT[j], dT[i]] }); }
  faces.push({ role: 'nacelle', sh: 0.95, p: dT });
  for (const s of [1, -1]) {   // parked blade grips
    const gz = cz - 0.015, gw = 0.014;
    faces.push({ role: 'nacelle', sh: s > 0 ? 0.9 : 0.66, p: [V(cf + s * hubR, gw, gz + gw), V(cf + s * 0.19, gw, gz + gw * 0.6), V(cf + s * 0.19, -gw, gz + gw * 0.6), V(cf + s * hubR, -gw, gz + gw)] });
  }
  // Main-rotor disc (schematic wireframe renderer only; painted renderers draw blades via FX).
  const disc = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc.push(V(cf + Math.cos(a) * 1.02, Math.sin(a) * 1.02, cz)); }
  faces.push({ role: 'rotor', sh: 0.65, p: disc });

  // ── TAILDRAGGER GEAR — three points of contact, squatting back on its haunches.
  // The real Apache is a taildragger: two tall trailing-arm mains carried well FORWARD
  // (under the stub wings) and one small wheel right at the end of the boom. Because the
  // mains are long and the tailwheel is short, the airframe sits markedly NOSE-HIGH — the
  // ramp stance. That attitude is the VIPER_GROUND_PITCH the renderers pitch her to on the
  // ground, so these three wheel bottoms are deliberately NOT level in build space: they're
  // offset by exactly (Δf · tan pitch) so that AT the 3-point sit all three land on one flat
  // floor (and airborne, at 0°, the mains hang below the tailwheel — as they should).
  // Change the pitch and these follow automatically — GEAR_DROP does the arithmetic.
  const mainF = 0.06, tailF = -1.00;                      // fore-aft stations
  const GEAR_DROP = (tailF - mainF) * Math.tan(VIPER_GROUND_PITCH * Math.PI / 180);  // how much lower the mains hang
  const tailBot = -0.16, mainBot = tailBot + GEAR_DROP;   // wheel BOTTOMS in build space
  for (const s of [1, -1]) {
    const wr = 0.058;                                     // fat main tyre
    // Trailing-arm leg: a canted strut from the fuselage flank down and OUT to the hub,
    // plus a shorter drag brace running aft — the splayed twin-leg read from the front.
    addStrut(faces, mainF, s * 0.155, -0.020, mainBot + wr, 0.016);
    addStrut(faces, mainF - 0.13, s * 0.175, -0.010, mainBot + wr, 0.011);
    pushWheel(faces, mainF, s * 0.225, mainBot + wr, wr, 0.030, 10);
  }
  const twr = 0.034;
  addStrut(faces, tailF + 0.02, 0, 0.095, tailBot + twr, 0.011);
  pushWheel(faces, tailF, 0, tailBot + twr, twr, 0.021, 8);

  // ── Ship it double-size. Applied as ONE transform over every vertex so the mesh and
  // drawRotorFX's anchors (which run the same viperXf) can never drift apart.
  for (const fc of faces) fc.p = fc.p.map(viperXf);
  return faces;
}

// The Viper is authored at unit scale and level, then shipped DOUBLE-SIZE. Exported because
// drawRotorFX has to place the rotor discs through the identical transform — one source of
// truth, no drift.
export const VIPER_SCALE = 2;                   // "double the size"
// Her nose-high 3-point sit (deg), the taildragger stance the gear above is cut for. Applied
// as an attitude by groundPitchFor/the flight model — never baked into the mesh.
export const VIPER_GROUND_PITCH = 7;
export function viperXf(v) {
  return [v[0] * VIPER_SCALE, v[1] * VIPER_SCALE, v[2] * VIPER_SCALE];
}

// A slim exposed MISSILE lying under a wingtip: a body tube, a pointed seeker nose (triangle fan to
// an apex ahead), and four little tail fins. Reads unmistakably as ordnance on the rail.
function addMissileBody(faces, fB, fF, g, z) {
  const r = 0.018;
  addTube(faces, V(fB, g, z), V(fF, g, z), r, 'nacelle', 0.7, 6);
  const apex = V(fF + 0.09, g, z);
  const bs = 6, ringF = [];
  for (let i = 0; i < bs; i++) { const a = i / bs * Math.PI * 2; ringF.push(V(fF, g + Math.cos(a) * r, z + Math.sin(a) * r)); }
  for (let i = 0; i < bs; i++) { const j = (i + 1) % bs; faces.push({ role: 'nacelle', sh: 0.82, p: [apex, ringF[i], ringF[j]] }); }   // seeker cone
  for (const [dg, dh] of [[1, 0], [-1, 0], [0, 1], [0, -1]])   // tail fins
    faces.push({ role: 'fin', sh: 0.6, p: [V(fB, g + dg * r, z + dh * r), V(fB - 0.03, g + dg * r * 2.1, z + dh * r * 2.1), V(fB + 0.02, g + dg * r * 2.1, z + dh * r * 2.1)] });
}

// Where each class's prop discs spin — read by both renderers' engine-effect layers so
// the translucent blur sits on the actual spinner(s), not a hardcoded nose position.
export const PROP_STATIONS = {
  ultralight: [[0.79, 0, 0.02]],                       // Cessna: one nose prop (small spinner apex = noseF 0.72 + 0.14·0.5)
  prop: [[0.47, 0.42, 0.11], [0.47, -0.42, 0.11]],     // Twin Otter: two wing props
  grasshopper: [[0.87, 0, 0.02]],                      // L-4: one nose prop (spinner apex = noseF 0.80 + 0.07)
  locust: [[1.13, 0, 0.02]],                           // ag turbine: one big nose prop (spinner apex = noseF 1.00 + 0.14·0.9)
};

// Real-world RELATIVE size (Twin Otter = 1). The meshes are all normalised to a similar extent,
// so this scales the geometry where craft are shown TOGETHER (the hangar fleet scene) to convey
// true size. Roughly the real length ratios vs the DHC-6 (15.8 m): Cessna .53, A-10 1.03, and
// the An-124 is really ~4.4× — COMPRESSED to 2.0 so the fleet row stays readable — the Mini-500
// heli ~.25, bumped to .42 so it isn't a speck. Air-to-air contacts get the equivalent through
// windshield.js CONTACT_SIZE. Unlisted classes default to 1.
// `truck` sits between the light singles and a Twin Otter: a rig with a box on it is a big animal
// on a garage floor, and the shared-camera fit in drawHangarScene reads this to stand back far
// enough that four of them park in one shot without shoving each other.
export const MODEL_SCALE = { ultralight: 0.52, prop: 1.0, gunship: 1.05, heavy: 1.7, heli: 0.42, wreck: 0.85, grasshopper: 0.42, locust: 0.40, truck: 1.15 };

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
export function drawRotorFX(ctx, cls, projFn, { spin = 0, power = 0.7, parked = false, disc = null, spool = null, bladeFade = 0, armed = false } = {}) {
  const dsc = disc != null ? disc : power;      // blur-disc opacity
  const spl = spool != null ? spool : 1;        // blade motion amount
  if (cls === 'heli') {
    // Main rotor (f-g plane; matches buildHeli's cf 0.1 / cz 0.34) + tail rotor
    // (f-h plane on the boom's right side), geared ~5× the main.
    //
    // The ARMED heli (Viper) ships double-size, so its anchors and disc radii go through the
    // SAME viperXf the mesh used — otherwise the discs sit inside a bigger airframe. The disc
    // AXES need no transform: the mesh is authored level, and any ground/flight attitude is
    // applied by the caller's projection to mesh and discs alike. Dragonfly is untouched.
    const P  = armed ? viperXf : (v) => v;      // positions: scale
    const R  = armed ? VIPER_SCALE : 1;         // radii: scale
    spinDisc(ctx, projFn, P([0.1, 0, 0.34]), [1, 0, 0], [0, 1, 0], 1.02 * R, spin, dsc, spl, parked, 2, 0.85, bladeFade);
    spinDisc(ctx, projFn, P([-1.04, 0.07, 0.12]), [1, 0, 0], [0, 0, 1], 0.19 * R, spin * 4.7 + 1.1, dsc, spl, parked, 2, 0.7, bladeFade);
  } else {
    // Cessna two-blade nose prop / Twin Otter three-blade wing turboprops. The
    // stations record the spinner apex (ultralight) vs base (prop) — nudge the
    // blade plane back to the cone root either way.
    const blades = (cls === 'ultralight' || cls === 'grasshopper') ? 2 : 3, off = cls === 'ultralight' ? -0.06 : 0.03;
    for (const st of (PROP_STATIONS[cls] || [])) {
      spinDisc(ctx, projFn, [st[0] + off, st[1], st[2]], [0, 0, 1], [0, 1, 0],
        cls === 'ultralight' ? 0.21 : 0.21, spin * 2.2 + st[1] * 3, dsc, spl, parked, blades, 0.5, bladeFade);
    }
  }
}

// The prop seen from the PILOT'S SEAT: the same rpm-driven disc drawRotorFX paints on the
// external chase model, projected HEAD-ON into the forward windscreen so it shimmers ahead of
// the nose. Single centred nose-prop classes only — the Mule's props are out on the wings
// (off the forward frame) and the heli's rotor is overhead. `spin`/`disc`/`spool` come straight
// from the flight model's prop choreography, so it fades in with throttle exactly like the chase
// view (blades tick over at idle → smear into a blur disc under power). `cx`/`cy` = disc centre
// on the canvas; `rad` = its screen radius. The projFn maps the prop plane's model axes — lateral
// (g) → screen x, up (h) → screen y — onto the screen; the fore station (f) is depth, ignored.
export function drawCockpitProp(ctx, cls, { cx, cy, rad, spin = 0, disc = 0, spool = 0 }) {
  const st = PROP_STATIONS[cls];
  if (!st || cls === 'prop' || st.length !== 1 || st[0][1] !== 0) return;   // one centred nose prop only
  const S = rad / 0.21;                                       // model disc r (0.21) → screen px
  // bladeFade: from the pilot's seat you look straight THROUGH the disc, so past ~half throttle
  // let the individual blades melt into the blur disc — at high rpm you see only the spinning
  // disc, never strobing blades over it (a real head-on GA prop). Chase view passes no fade.
  drawRotorFX(ctx, cls, ([, g, h]) => ({ sx: cx + g * S, sy: cy - h * S }), { spin, disc, spool, bladeFade: 0.9 });
}

// One spinning disc: centre C, two unit axes U/V spanning its plane (model space), radius r.
// `disc` = blur-disc opacity, `spool` = blade motion amount (see drawRotorFX). `lead` is the
// front blade's opacity (helis read solid, props smear).
function spinDisc(ctx, projFn, C, U, V, r, spin, disc, spool, parked, blades, lead, bladeFade = 0) {
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
  if (parked) {   // engines off: crisp dark stopped blades on a small hub cap
    for (let i = 0; i < blades; i++) blade(spin + i * step, 'rgba(38,43,49,0.95)');
    // A tiny centre cap only — sized off the BLADE, not the whole rotor span, and capped in px,
    // so it never balloons into a flat screen-space "ball" that reads as a floating sphere when
    // the disc foreshortens edge-on. The real rotor head is 3D geometry on the mesh below.
    ctx.fillStyle = 'rgba(30,34,40,0.95)';
    ctx.beginPath(); ctx.arc(hub.sx, hub.sy, Math.max(1, Math.min(rpx * 0.03, 4)), 0, 7); ctx.fill();
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
  // `bladeFade` (>0, cockpit prop only) dissolves the discrete blades into the blur disc as it
  // fills in past ~half opacity, so at high throttle the head-on view reads as a pure spinning
  // disc with no individual blades — they melt into it rather than strobing under it.
  const bladeVis = 1 - bladeFade * clampN((disc - 0.5) / 0.45, 0, 1);
  const ghosts = spool > 0.55 ? 3 : spool > 0.18 ? 2 : 1;
  if (bladeVis > 0.02) for (let i = 0; i < blades; i++) {
    for (let k = 0; k < ghosts; k++) blade(spin + i * step - k * 0.17 * spool, `rgba(36,41,47,${lead * bladeVis * Math.pow(0.42, k)})`);
  }
  ctx.fillStyle = 'rgba(30,34,40,0.9)';
  ctx.beginPath(); ctx.arc(hub.sx, hub.sy, Math.max(1, Math.min(rpx * 0.045, 6)), 0, 7); ctx.fill();
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
    // The wing sits ON THE CABIN ROOF, not ahead of it (see the canopy note below): raised a
    // touch off the fuselage crown so the glazed cabin band fills the gap underneath it.
    wingH: 0.145, dih: 0.03, wRootF: 0.26, wRootB: -0.14, wTipF: 0.24, wTipB: -0.14,
    hF: -0.68, hB: -0.88, hTipF: -0.72, hTipB: -0.90, hSpan: 0.42,
    finF0: -0.62, finF1: -0.86, finF2: -0.92, finH: 0.46, fins: [0],
    engines: [], prop: 'nose', struts: true, gear: true, gearStyle: 'spring',
    noseBlunt: 3.0, noseCowl: 0.48, boxy: 0.4, bodyTube: 0.10, tailUp: 0.05,   // full, rounded cowl tapering to the small spinner
    // CABIN UNDER THE WING (per ref: a 152). The glass is not a blister parked ahead of the wing —
    // it's the cabin itself: a raked windscreen up off the firewall (f0), then the side glass runs
    // aft UNDERNEATH the wing root (LE 0.26 → TE −0.14) and finishes in a rear quarter-window just
    // behind the trailing edge. `h` is sized so the roof tops out level with the wing underside
    // (wingH − 0.01), so the wing reads as sitting ON the cabin instead of floating over it.
    canopy: { f0: 0.36, f1: -0.17, w: 0.076, h: 0.038, front: 0.30, tail: 0.24, segs: 6, arc: 3, sink: 0.02, art: 'mayfly' } },
  // Mule — a high-wing, twin-turboprop, fixed-gear STOL hauler: a DHC-6 Twin Otter (per ref). A
  // deep, flat-sided BOX of a fuselage held near-constant most of its length, with the signature
  // DROOPED, POINTED "anteater" nose (noseZ pulls the radome down below the fuselage line to a
  // point). Shortened from the original (empennage pulled in to match) so it reads less stretched.
  prop: { ...FW_DEFAULT, fr: 0.13, fv: 0.135, span: 1.02, noseF: 1.00, tailF: -0.92,
    // The wing sits flat ON the cabin roof (crown 0.135), not half-buried in it.
    wingH: 0.161, dih: 0.01, wRootF: 0.36, wRootB: -0.10, wTipF: 0.26, wTipB: -0.06,
    hF: -0.70, hB: -0.89, hTipF: -0.75, hTipB: -0.91, hSpan: 0.40,
    finH: 0.60, finF0: -0.63, finF1: -0.88, finF2: -0.94,
    // Long nacelles that run from ahead of the wing to well BEHIND its trailing edge — the Otter's
    // engines are slung along the wing, not bolted to the front of it (nacHalf sets the length).
    engines: [-0.42, 0.42], nacF: 0.06, nacHalf: 0.28, nacH: 0.11, prop: 'wing',
    dorsal: -0.24,   // the long dorsal fin fillet running forward off the fin along the spine
    struts: true, gear: true, gearStyle: 'oleo', boxy: 0.86,
    // THE TWIN OTTER NOSE (per ref photos). The flat-topped slab box holds FULL width AND height
    // back to the windscreen (bodyTube 0.62), then two things happen at once ahead of it:
    //  • the ROOF drops hard (noseVTaper shrinks height ~1.6× faster than width) → a steep,
    //    forward-raked 2-pane windscreen and, past it, a nose that tapers to a LOW point;
    //  • the centreline eases down a touch (noseZ −0.05) so that low point sits just below the
    //    fuselage line — the gentle droop — while the belly keeps rising to meet it (a wedge, not
    //    the old sagging tube). Longer nose (noseF 0.92→1.00) for the anteater reach.
    noseBlunt: 2.2, noseZ: -0.05, noseDroopK: 0.7, noseVTaper: 1.6, bodyTube: 0.62, tailUp: 0.075,
    // FLIGHT DECK CUT INTO THE HULL (per ref photo), not a hump on the roof. Rings at the
    // windscreen top/base + side-window divisions give each pane its own bay; `glaze` turns the
    // upper facets between them to glass. On a 12-gon the upper half is k 0…5 (starboard sill →
    // crown → port sill). The WINDSCREEN bay (fore of wsF) glazes the FULL upper half — k0…5 — so
    // the two panes wrap up and over the crown and around the corners into the side glass, split
    // only by the painted centre post; the side-window bays glaze the side band (k0/k5) alone, so
    // the cabin ROOF behind the windscreen stays solid.
    extraF: [0.84, 0.70, 0.62, 0.48, 0.34],
    glaze: { f0: 0.70, f1: 0.30, ks: [0, 5], wsKs: [0, 1, 2, 3, 4, 5], wsF: 0.63, art: 'mule' } },
  // Reaper — an A-10 Warthog (per ref): a straight-wing, twin-tail gun platform with two fat
  // turbofans mounted HIGH on stub pylons off the rear fuselage. A SLIM fuselage (thin fr) that's
  // still deep, a slightly pointed nose, and the twin fins out at the tailplane tips.
  gunship: { ...FW_DEFAULT, fr: 0.115, fv: 0.14, span: 0.86, noseF: 1.0, tailF: -1.0,
    wingH: -0.03, dih: 0.02, wRootF: 0.22, wRootB: -0.30, wTipF: 0.16, wTipB: -0.26, hSpan: 0.36,
    engines: [], podEngines: [[-0.40, 0.27, 0.15], [-0.40, -0.27, 0.15]], podPylon: true,
    fins: [-0.34, 0.34], finF0: -0.82, finF1: -1.02, finF2: -1.08, finH: 0.44, wingGuns: true, gear: true, gearPods: true,
    noseBlunt: 2.5, boxy: 0.22, bodyTube: 0.15, tailUp: 0.04,   // slim roundish central body — the bulk reads from the wings/nacelles
    // THE WARTHOG BUBBLE (per ref): a single-seat clamshell canopy sitting proud of the nose, with
    // a heavy windscreen bow ahead of it and near-frameless glass over the crown. arc 5 + segs 8
    // round the bubble properly (it's a hemisphere in section, not a three-facet tent), and the
    // 'reaper' canopy art paints the bow frame, the gold-flashed armoured panes, the HUD glow and
    // the one pilot in there — the same treatment the Viper's greenhouse gets.
    canopy: { f0: 0.60, f1: 0.16, w: 0.078, h: 0.112, front: 0.16, tail: 0.06, segs: 8, arc: 5, sink: 0.01, art: 'reaper' } },
  // Leviathan — an Antonov An-124 (per ref): a huge four-engine wide-body heavy freighter. A
  // long near-circular constant tube with an upswept cargo boat-tail; a swept HIGH wing set with
  // ANHEDRAL (drooping tips) carrying four big podded turbofans on underwing pylons; a tall swept
  // fin; a blunt rounded radome nose; and its signature multi-wheel 'centipede' belly gear. It's
  // a cantilever wing — NO lift struts (unlike the strut-braced Otter).
  heavy: { ...FW_DEFAULT, fr: 0.205, fv: 0.215, span: 1.05, noseF: 1.15, tailF: -1.12, hSpan: 0.46, finH: 0.66,
    wingH: 0.20, dih: -0.05, wRootF: 0.34, wRootB: -0.14, wTipF: 0.20, wTipB: -0.10,
    engines: [-0.60, -0.34, 0.34, 0.60], nacF: 0.26, nacH: -0.03, nacR: 0.095, pylons: true, heavyGear: true,
    // Nose leg forward of the visor cut (0.78) so it hangs off the swinging nose and hinges with it
    // as one piece — see `noseGearAt` in addHeavyGear and the visor tagging in buildFixedWing.
    // …and at the fore-aft MIDDLE of that nose section (0.78 → 1.15), rather than hard up against
    // the hinge where it read as hanging off the seam instead of being carried by the nose.
    noseGearAt: 0.839,
    // BODY (per ref photo): the An-124 is a DEEP near-circular tube — taller than it is wide (the
    // upper flight deck sits over a full-height cargo bay) — held at constant section over most of
    // its length, closed by a bluntly rounded radome up front and an UPSWEPT cargo boat-tail aft.
    // sides 16 rounds the section properly (12 facets read as a barrel on something this fat).
    //
    // THE NOSE IS THE WHOLE POINT OF THE TYPE, and it is not a cone. Ahead of the flight deck the
    // ROOF falls away hard while the body stays wide (noseVTaper) — that shed IS the cargo visor,
    // and it's why the aeroplane looks like it's frowning — but it bottoms out at noseVFloor rather
    // than tapering to a slit, because what it ends in is a fat ROUND radome (noseCowl), not a
    // point. The centreline droops with it (noseZ), spent early (noseDroopK < 1) so the drop lands
    // on the visor and never tips the flight deck down with it. Result: a level cockpit sitting up
    // behind a long sloping snout, exactly the profile in the reference.
    // (noseVFloor is what keeps the tip ROUND: the vertical taper multiplies a width profile that is
    // itself collapsing into the cowl, so the two compound — floor it too low and the radome comes
    // out a letterbox slab rather than a snout. 0.60 against a 0.34 cowl lands it near circular.)
    // AN AIRLINER NOSE, not a chopped cylinder. The lever here is noseBlunt: a HIGH exponent holds
    // full width and then falls off a cliff, which is why the snout kept ending in a flat disc no
    // matter what the cowl floor was set to. 2.2 rounds it down continuously instead — sampled at
    // the extraF stations below the half-width runs 0.98 · 0.92 · 0.81 · 0.66 · 0.50 · 0.32 · 0.10,
    // a smooth curve into a tip that is very nearly a point. The cowl floor drops to 0.10 to match:
    // with the taper doing the work there's no cliff left to hide, so the end cap is a few pixels
    // rather than a dinner plate.
    // sides 24, not 16, and the reason is the COCKPIT. Glazing works in whole facets, so the ring
    // resolution sets the smallest window you can cut: at 16 sides each facet is a 22.5° slice of the
    // section, and the narrowest possible band was still 45° tall — a greenhouse. At 24 a facet is
    // 15°, so the flight deck can be a tight strip near the crown the way the real one is. The extra
    // rings cost ~100 faces on the whole airframe and buy the one detail you actually look at.
    sides: 24, noseBlunt: 2.2, noseCowl: 0.10, boxy: 0.06, bodyTube: 0.56, tailUp: 0.145,
    noseZ: -0.03, noseDroopK: 0.60, noseVTaper: 1.1, noseVFloor: 0.60,
    // Cargo VISOR NOSE (C-5 Galaxy / An-124): parked with the engines shut down the whole forward
    // section hinges fully UP (~90°), exposing the cargo hold + ramp; powering on lowers it home.
    // THE CUT IS AHEAD OF THE FLIGHT DECK, not behind it — on the real aeroplane the visor swings up
    // in FRONT of the windows and the crew's office stays bolted to the fuselage. Cutting it aft of
    // the glass (as this did) took the entire cockpit up with the nose, which is the single weirdest
    // thing the model did. hingeAt is a fraction of noseF and lands on the 0.78 ring, so the break
    // is a clean structural seam at the windscreen base. Shorter ramp to match the forward lip.
    // maxAng 1.20 (69°), not a full 90°. The lower lip of the cut ring swings forward by
    // sin(angle) × the fuselage's own depth, so at 90° it ends up a third of the airframe ahead of
    // the hinge and the nose stops reading as attached to anything. Backing off to ~70° still yawns
    // the mouth wide open for the ramp but keeps the section leaning on its hinge.
    // THE FLIGHT DECK RIDES THE NOSE. The cut is aft of the glass (snapped to the 0.56 ring), so the
    // cockpit is part of the swinging section — which is what the first-person view already assumes:
    // `cockpitTilt` pitches the pilot's camera up with `noseVisor` and rotates back down as the
    // visor closes. Leave the glass on the fixed fuselage and the camera swings while the windows
    // it's looking through don't, which is the one arrangement that can't be right.
    visor: { hingeAt: 0.4870, maxAng: 1.20, ramp: 0.50 },
    // FLIGHT DECK CUT INTO THE HULL, not a hump bolted on the roof (the Mule's treatment, and what
    // the real aeroplane does): the An-124's cockpit windows are set into the upper forward fuselage
    // above the cargo deck, so the glass IS the skin there. On a 16-gon the upper half is k 0…7
    // (starboard mid-height → crown at 4 → port). The WINDSCREEN wraps STRAIGHT ACROSS — k1…k6, the
    // crown included — because that's what the real flight deck does: one continuous band of glass
    // over the nose, split only by a painted centre post. Leaving k3/k4 as metal put a spine down the
    // middle of the screen and the band read as two separate side windows with a wall between them.
    // The bays BEHIND the screen still glaze only the high strip k2/k5 — the side window running aft
    // under a roofline that, aft of the screen, genuinely is solid.
    // The glass band is SHORT (0.78 → 0.56, under a fifth of the airframe): on the real thing it's a
    // small bright patch high on a very long fuselage, and stretching it aft was what made the deck
    // read as an airliner cabin.
    // 1.11/1.02 are the RADOME rings: the blunt superellipse only shows up if the mesh actually
    // samples it, and the default nose has no station between the windscreen and the tip — without
    // these the whole nose is one straight wedge from full section to the cowl face. (1.11, not
    // 1.13: an extraF within 0.03 of a default station EVICTS it, and 1.13 would have swallowed the
    // nose tip at 1.15 and left the aeroplane snubbed.)
    // 24 facets AROUND wants matching resolution ALONG, or the hull is smooth in section and creased
    // in profile. The tailcone was the worst of it — three rings carrying the whole 1.1-long upswept
    // boat-tail — so −0.18/−0.55/−0.95 go in to let the upsweep actually curve.
    extraF: [1.14, 1.11, 1.06, 0.98, 0.88, 0.78, 0.70, 0.62, 0.56, 0.40, -0.18, -0.55, -0.95],
    bellyFlat: 0.55,   // flat cargo-deck underside with a chine, not a barrel — see ring()
    // wsF is tested against a bay's FORWARD station, so 0.74 makes the single bay 0.78→0.70 the
    // windscreen and everything aft of it side glass.
    // On a 24-gon the upper half is k 0…11 with the CROWN AT 6. The windscreen is k3…k8 — 45°→135°,
    // symmetric about the crown, a tight strip across the top rather than a band down the cheeks —
    // and the side glass aft is k3/k8 alone, the lowest facet of that strip carried backwards. The
    // fore-aft run is short too (0.78→0.62, one bay of screen and one of side glass): the deck used
    // to reach back to 0.56 and that length was half of why it read as too much glass.
    glaze: { f0: 0.78, f1: 0.62, ks: [3, 8], wsKs: [3, 4, 5, 6, 7, 8], wsF: 0.74, art: 'leviathan' },
    // The flight-deck HUMP. Peaks at f=0.70, dead centre of the glass band (0.78→0.56), and blends
    // out to nothing well clear of the wing root at 0.34 so it can't crease the wing fairing.
    hump: { f0: 0.42, f1: 0.98, h: 0.055 } },
  // Grasshopper — a Piper L-4 (per ref): a high-wing, strut-braced TANDEM two-seat TAILDRAGGER
  // liaison/observation plane. Signatures vs the Cessna: a deeper, SLAB-SIDED slim fuselage; a
  // long GLAZED "greenhouse" cabin (a row of big observation windows + a raked windscreen); a
  // near-constant-chord high wing on lift struts; a tall light fin; and conventional (tailwheel)
  // gear that sits it nose-high. Short-nose / long slim tailcone.
  grasshopper: { ...FW_DEFAULT, fr: 0.080, fv: 0.115, span: 1.16, noseF: 0.80, tailF: -1.04,
    // Cub cabin: the wing is carried clear of the fuselage crown on the cabin frame, and the gap
    // between them IS the greenhouse (side glass + the skylight in the wing root).
    wingH: 0.168, dih: 0.02, wRootF: 0.30, wRootB: -0.17, wTipF: 0.28, wTipB: -0.17, hSpan: 0.44,
    hF: -0.74, hB: -0.96, hTipF: -0.78, hTipB: -0.98,
    finF0: -0.66, finF1: -0.96, finF2: -1.02, finH: 0.52, fins: [0],
    engines: [], prop: 'nose', struts: true, gear: true, gearStyle: 'taildragger', tundra: true, groundPitch: 11,
    noseBlunt: 2.2, noseCowl: 0.26, boxy: 0.42, bodyTube: 0.16, tailUp: 0.06,   // slim deep slab-sided fabric fuselage
    // CABIN UNDER THE WING (per ref: a Carbon Cub). Windscreen up off the cowl, then the long
    // glazed cabin runs aft beneath the whole wing root (LE 0.30 → TE −0.17) — that band under the
    // wing is the Cub's defining feature, and the skylight painted on its crown (canopy art 'xcub')
    // only makes sense once the glass is actually up there against the wing.
    canopy: { f0: 0.44, f1: -0.14, w: 0.074, h: 0.046, front: 0.30, tail: 0.22, segs: 6, arc: 3, sink: 0.02, art: 'xcub' } },
  // Locust — a low-wing crop-duster / ag-plane (per ref: Air Tractor / Grumman Ag Cat): a big,
  // BROAD constant-chord SQUARE wing (rectangular planform — no taper, no sweep, square-cut tips);
  // a chunky slab-sided fuselage with a blunt radial cowl; a raised bubble cockpit set high for
  // visibility over the nose; nose-high spatted TAILDRAGGER gear. Reads heavy and workmanlike.
  locust: { ...FW_DEFAULT, fr: 0.100, fv: 0.105, span: 1.14, noseF: 1.00, tailF: -0.98,
    wingH: -0.09, dih: 0.03, wRootF: 0.30, wRootB: -0.22, wTipF: 0.30, wTipB: -0.22, hSpan: 0.40,
    hF: -0.70, hB: -0.90, hTipF: -0.74, hTipB: -0.92,
    finF0: -0.64, finF1: -0.92, finF2: -0.98, finH: 0.52, fins: [0],
    engines: [], prop: 'nose', gear: true, gearStyle: 'taildragger', gearAg: true, groundPitch: 10,
    // A turbine ag-plane's nose is a FAT round cowl carrying a big blunt spinner, not a snout that
    // tapers to a spike — noseCowl floors the cowl face wide (0.34) and `spinner` 0.9 fills most of
    // it, which is the single biggest reason the type reads as heavy machinery rather than a toy.
    noseBlunt: 2.6, noseCowl: 0.34, boxy: 0.5, bodyTube: 0.12, tailUp: 0.04, spinner: 0.9,
    // THE HOPPER. Everything between the firewall and the windscreen on an Air Tractor is the
    // chemical tank, and it is the type's actual silhouette: a fat swelling of the spine that
    // steps DOWN to the cockpit, which is why the pilot sits so high and so far back. Peaks at
    // f 0.70 and blends out at 0.46, clear of the canopy base so the two never crease into
    // each other (the canopy rides the plain crown, not the hump).
    hump: { f0: 0.46, f1: 0.94, h: 0.048 },
    // Rings through the cowl / hopper / windscreen step — without them the whole forward half is
    // one straight wedge and the hump has nothing to curve over.
    extraF: [0.90, 0.78, 0.70, 0.58, 0.50, 0.20],
    dorsal: -0.30,   // the long shallow fin fillet up the spine — the tail of a working aeroplane
    exhaust: { f: 0.74, g: 0.86, z: -0.005, at: [0, -0.05] },   // stub stacks out of the cowl flanks
    // The spray rig, hung off the trailing edge and reaching almost tip to tip.
    sprayBoom: { f: -0.26, drop: 0.055, reach: 0.94, nozzles: 11 },
    canopy: { f0: 0.52, f1: 0.16, w: 0.082, h: 0.112, front: 0.22, tail: 0.20, segs: 6, arc: 5, sink: 0.015, art: 'locust' } },   // raised ag cockpit, set high and stepped down off the hopper
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

// A class's static ground attitude (deg nose-up) — taildraggers rest nose-high on the tailwheel.
// Read by every renderer that draws the craft PARKED (turntable, wireframe) so the sit is
// consistent with how she flies off the deck. 0 = tricycle/level. `armed` picks the Viper out of
// the heli class: she's a taildragger too (mains forward, tailwheel on the boom), the Dragonfly
// sits flat on its skids. Keep this in step with the `groundPitch` in flight-model.js — the sim
// flies the same stance, and these are the parked renderers' version of it.
export function groundPitchFor(cls, armed = false) {
  if (cls === 'heli') return armed ? VIPER_GROUND_PITCH : 0;
  return FW_PARAMS[cls]?.groundPitch || 0;
}

// Faces for a class at a detail level (memoised per cls+detail — geometry is static).
// detail 1 = the full-resolution mesh (hero/turntable/chase/near contacts); detail 0 = the
// coarse LOD for distant contacts, where the extra facets would be sub-pixel anyway. The
// heli mesh doesn't subdivide (its cabin is already fat/rounded), so it ignores detail.
const _cache = {};
// `variant` is a fourth, OPTIONAL channel — a ground vehicle needs to say which of four trucks it
// is and whether a trailer is on the back, and neither fact fits `cls` (which the whole renderer
// switches on) or `armed` (which means something else). Every existing caller passes nothing and
// gets exactly what it got before; only the truck path reads it.
export function aircraftFaces(cls, detail = 1, armed = false, variant = '') {
  const key = cls + ':' + detail + (armed ? ':a' : '') + (variant ? ':' + variant : '');
  if (_cache[key]) return _cache[key];
  const faces = cls === 'truck' ? buildTruck(variant || 'hauler', detail)
    : cls === 'heli' ? (armed ? buildAttackHeli() : buildHeli())
    : buildFixedWing(FW_PARAMS[cls] || FW_PARAMS.prop, detail);
  _cache[key] = faces;
  return faces;
}

// ── A truck, seen from somewhere else (THE LONG HAUL) ────────────────────────
// The first GROUND vehicle in this file, and the reason it has to exist: `drawAircraftModel` is
// per-class and every class here has wings, so a truck relayed as a contact would have rendered as
// an aeroplane sliding along the road. This is deliberately a simple box set — a cab, a sleeper
// hump, a long flat deck, six wheels — because it is only ever seen from a passing aircraft or
// across a yard, where a silhouette is the whole of the information.
//
// Local axes match the rest of the file: [fore, right, up], roughly ±0.5 fore and ±0.2 lateral, so
// it sits in the same normalised box the airframes do and CONTACT_SIZE scales it like anything else.
// FOUR TRUCKS, NOT ONE PAINTED FOUR WAYS. The first cut built a single box set and handed it to
// every type, so the 1,300₵ Krell Barrow and the 31,000₵ Orlov Continental had the same silhouette
// — which quietly undid the fleet ladder, since the whole reason to want the next truck up is that
// it is visibly a bigger animal. Each row is a PROPORTION set, not a model: the same builder runs
// four times with different numbers, so a fifth truck is a row and never a function.
//
//  cab      — how far forward the cab box runs (a cab-over has almost no nose; a conventional does)
//  nose     — bonnet length; 0 makes it a cab-over, which is what the little ones are
//  hi       — cab roof height, the single strongest read of size at distance
//  sleeper  — 0 for a day cab; the long-haul rigs get a hump you can see from a mile off
//  axles    — rear axle groups under the tractor
//  stacks   — vertical exhaust behind the cab: nothing says heavy truck faster
//  w        — half-width
//  aero     — 0..1 how much roof fairing the cab wears (0 is a bare flat-top, 1 a full wind kit)
//  skirt    — 1 if the tractor has side fairings between the steps and the drives
//  lamps    — 0..1 how much LIGHT the thing wears: marker rows, a bar on the bumper, beltline strip
const TRUCK_SHAPES = {
  scrapper:    { cab: 0.22, nose: 0.00, hi: 0.185, sleeper: 0,     axles: 1, stacks: 0, w: 0.140, deck: 0.30, aero: 0,    skirt: 0, lamps: 0.25 },
  hauler:      { cab: 0.24, nose: 0.04, hi: 0.200, sleeper: 0,     axles: 1, stacks: 1, w: 0.150, deck: 0.34, aero: 0.35, skirt: 0, lamps: 0.55 },
  drayman:     { cab: 0.24, nose: 0.06, hi: 0.215, sleeper: 0.040, axles: 2, stacks: 2, w: 0.165, deck: 0.46, aero: 0.75, skirt: 1, lamps: 0.8 },
  continental: { cab: 0.26, nose: 0.10, hi: 0.240, sleeper: 0.055, axles: 2, stacks: 2, w: 0.178, deck: 0.60, aero: 1,    skirt: 1, lamps: 1 },
};
// `variant` is `<typeId>` or `<typeId>+t` for a rig with a trailer on the back. BOBTAIL IS A REAL
// SILHOUETTE and has to look like one — a tractor with nothing behind it is short, stubby and
// obviously unloaded, which is most of what makes running empty feel different from the outside.
// `detail` is the SAME LOD channel the airframes use, and the truck has to honour it for the same
// reason they do: the yard draws one rig the size of the screen and wants every rib on it, while
// the road draws a contact a few pixels wide that would pay for all of them anyway. `fine` is off
// at detail 0 (distant contacts) and the silhouette — cab, box, wheels, glass — is untouched.
function buildTruck(variant = 'hauler', detail = 1) {
  const [typeId, tail] = String(variant).split('+');
  const S = TRUCK_SHAPES[typeId] || TRUCK_SHAPES.hauler;
  const hitched = tail === 't';
  const fine = detail >= 1;
  const faces = [];
  const V = (f, g, h) => [f, g, h];
  // A box between two fore stations, as six quads. `sh` is the baked flat shade: top brightest,
  // sides mid, underside dark — the same top-lit convention the airframe skins use.
  // `gc` is the LATERAL CENTRE — without it every box straddles the centreline and the six wheels
  // all pile up inside the chassis instead of sitting under it, one row a side.
  const box = (f0, f1, w, z0, z1, role = 'body', tint = null, gc = 0) => {
    const gl = gc - w, gr = gc + w;
    const A = [V(f0, gl, z0), V(f0, gr, z0), V(f0, gr, z1), V(f0, gl, z1)];
    const B = [V(f1, gl, z0), V(f1, gr, z0), V(f1, gr, z1), V(f1, gl, z1)];
    const quad = (p, sh) => { const q = { role, sh, p }; if (tint) q.tint = tint; faces.push(q); };
    quad([A[3], A[2], B[2], B[3]], 1.00);                    // roof
    quad([A[0], B[0], B[1], A[1]], 0.42);                    // underside
    quad([A[0], A[3], B[3], B[0]], 0.72);                    // left flank
    quad([A[1], B[1], B[2], A[2]], 0.62);                    // right flank
    quad([B[0], B[3], B[2], B[1]], 0.80);                    // front face
    quad([A[0], A[1], A[2], A[3]], 0.55);                    // back face
  };
  // A free polygon, for every surface a box cannot be: the raked screen, the roof fairing's wedge,
  // the chin spoiler. `uv`/`art` ride through to drawCanopyGlass, which is how the windscreen gets
  // a real painted sheet (wipers, dash glow, a driver behind it) instead of a flat blue rectangle.
  const poly = (role, sh, pts, tint = null, uv = null, art = null) => {
    const q = { role, sh, p: pts.map(p => V(p[0], p[1], p[2])) };
    if (tint) q.tint = tint;
    if (uv) { q.uv = uv; q.art = art || 'truckcab'; }
    faces.push(q);
  };
  const UV_FULL = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const wheel = (f, g, r = 0.048) => {
    box(f - r, f + r, 0.022, -0.005, r * 1.15, 'gear', null, g);
    if (!fine) return;
    // A hub with a face on it. Two thin plates inboard of the tyre wall, bright enough to catch the
    // key light — at any distance this is what separates a wheel from a black brick.
    box(f - r * 0.42, f + r * 0.42, 0.008, r * 0.22, r * 0.86, 'strut', null, g - Math.sign(g || 1) * 0.021);
  };

  // The tractor is laid out BACKWARDS from the nose, so every proportion is relative and a bigger
  // truck grows forward and upward from one anchor rather than needing four hand-placed boxes.
  const nose1 = 0.40, nose0 = nose1 - S.nose;              // bonnet
  const cab1 = nose0, cab0 = cab1 - S.cab;                 // cab box
  const frame0 = cab0 - 0.10;                              // frame rails behind the cab
  const deckTop = 0.115;

  // ── Chassis ────────────────────────────────────────────────────────────────
  // TWO RAILS, NOT ONE SLAB. A truck's frame is a pair of C-sections you can see daylight between,
  // and the gap is most of what makes the underside read as a chassis carrying a body rather than
  // as a solid billet with wheels stuck to it.
  for (const g of [-1, 1]) box(frame0 - 0.01, cab1 - 0.02, 0.016, 0.028, 0.072, 'strut', null, g * S.w * 0.62);
  box(frame0, cab0 + 0.02, S.w * 0.80, 0.050, 0.070, 'body');                 // deck plate over the rails
  // The fifth wheel: the greased steel plate the kingpin drops into. Visible on a bobtail, and the
  // single detail that says this tractor is MISSING something rather than simply being short.
  box(frame0 + 0.03, frame0 + 0.10, S.w * 0.62, 0.070, 0.082, 'strut');

  // ── Cab ────────────────────────────────────────────────────────────────────
  box(cab0, cab1, S.w, 0.02, S.hi, 'body');                // cab
  if (S.sleeper) {
    box(cab0 + 0.005, cab1 - 0.055, S.w * 0.95, S.hi, S.hi + S.sleeper, 'body');
    // A porthole in the bunk, one a side. Nobody needs it and every sleeper cab has one.
    for (const g of [-1, 1]) box(cab0 + 0.045, cab0 + 0.075, 0.003, S.hi + 0.012, S.hi + S.sleeper - 0.008, 'glass', [44, 66, 84], g * S.w * 0.95);
  }
  // THE SCREEN IS A RAKED PLANE, not a thin upright box. The top edge stands further FORWARD than
  // the bottom, which is the whole difference between a truck and a shoebox at any distance you can
  // see one from — and being a genuine quad it takes a UV, so the sheet painted in CANOPY_ART
  // ('truckcab': wipers, a dash glow, a driver's shoulders) maps across it properly.
  const scrLo = S.hi * 0.52, scrHi = S.hi * 0.985;
  const scrF0 = nose0 - 0.004, scrF1 = nose0 + 0.038;       // bottom station, top station
  const scrW = S.w * 0.94;
  poly('glass', 0.92, [[scrF0, -scrW, scrLo], [scrF0, scrW, scrLo], [scrF1, scrW, scrHi], [scrF1, -scrW, scrHi]],
    [58, 84, 104], UV_FULL, 'truckcab');
  // A-pillars down each side of it, and the header rail across the top — dark structure against
  // bright glass is what makes a windscreen look set into something.
  for (const g of [-1, 1]) poly('strut', 0.78, [[scrF0, g * scrW, scrLo], [scrF0, g * S.w, scrLo], [scrF1, g * S.w, scrHi], [scrF1, g * scrW, scrHi]]);
  // The sun visor, cantilevered forward off the header. Half of a truck's face is this shadow.
  poly('body', 0.96, [[scrF1, -S.w, scrHi], [scrF1, S.w, scrHi], [scrF1 + 0.030, S.w * 0.94, scrHi + 0.004], [scrF1 + 0.030, -S.w * 0.94, scrHi + 0.004]]);
  // Marker lamps in a row along the visor's leading edge. Five of them, `window` role so they take
  // the glass path and read as LIT after dark rather than as five more grey squares.
  if (fine && S.lamps > 0.2) {
    for (let i = -2; i <= 2; i++) {
      box(scrF1 + 0.022, scrF1 + 0.030, 0.008, scrHi + 0.001, scrHi + 0.009, 'window', [236, 176, 96], i * S.w * 0.34);
    }
  }
  // Side glass: door window plus a quarter light forward of it, split by the door frame. Two panes
  // rather than one long slot is the flank read that says CAB.
  for (const g of [-1, 1]) {
    box(cab1 - 0.105, cab1 - 0.048, 0.004, S.hi * 0.54, S.hi * 0.88, 'glass', [50, 74, 92], g * S.w);
    box(cab1 - 0.040, cab1 - 0.014, 0.004, S.hi * 0.54, S.hi * 0.84, 'glass', [46, 68, 86], g * S.w);
    if (!fine) continue;
    box(cab1 - 0.048, cab1 - 0.040, 0.006, S.hi * 0.50, S.hi * 0.90, 'strut', null, g * S.w);   // the B-post between them
    // Grab handle and the step boxes under the door — the way a driver actually gets up there.
    box(cab1 - 0.048, cab1 - 0.042, 0.005, S.hi * 0.16, S.hi * 0.48, 'strut', null, g * (S.w + 0.006));
    box(cab1 - 0.100, cab1 - 0.030, 0.014, 0.030, 0.044, 'strut', null, g * (S.w * 0.92));
  }
  // THE BELTLINE STRIP. One thin lit line down each flank at the base of the glass — the only
  // openly futuristic thing on the truck, and it does the whole job: everything else here is a
  // 20th-century semi, and one strip of running light drags the date forward without arguing.
  if (fine && S.lamps > 0.5) {
    for (const g of [-1, 1]) box(cab0 + 0.02, cab1 - 0.02, 0.003, S.hi * 0.47, S.hi * 0.505, 'window', [96, 196, 214], g * S.w);
  }
  // ── Roof fairing ───────────────────────────────────────────────────────────
  // The wind kit: a wedge off the back of the roof that closes the gap to the box. It is what makes
  // a modern long-hauler look like one animal instead of a cab towing a wall.
  if (S.aero > 0.05) {
    const rTop = S.hi + S.sleeper, fh = rTop + 0.030 * S.aero;
    poly('body', 1.00, [[cab0 - 0.055 * S.aero, -S.w * 0.92, fh], [cab0 - 0.055 * S.aero, S.w * 0.92, fh],
                        [cab1 - 0.06, S.w * 0.9, rTop], [cab1 - 0.06, -S.w * 0.9, rTop]]);
    for (const g of [-1, 1]) poly('body', 0.66, [[cab0 - 0.055 * S.aero, g * S.w * 0.92, fh], [cab1 - 0.06, g * S.w * 0.9, rTop],
                        [cab1 - 0.06, g * S.w * 0.9, rTop - 0.02], [cab0 - 0.055 * S.aero, g * S.w * 0.92, 0.02 + rTop * 0.4]]);
    // A sensor pod on the crown — the road-scanner. Small, and the second and last future tell.
    box(cab1 - 0.10, cab1 - 0.07, 0.016, rTop, rTop + 0.012, 'strut');
    box(cab1 - 0.095, cab1 - 0.078, 0.010, rTop + 0.012, rTop + 0.018, 'window', [120, 210, 220]);
  }
  // ── Nose ───────────────────────────────────────────────────────────────────
  if (S.nose > 0.001) {
    box(nose0, nose1 - 0.012, S.w * 0.93, 0.045, 0.135, 'body');    // bonnet
    // The bonnet's top is CHAMFERED down toward the grille — a flat lid reads as a crate.
    poly('body', 1.00, [[nose0, -S.w * 0.93, 0.135], [nose0, S.w * 0.93, 0.135],
                        [nose1 - 0.012, S.w * 0.88, 0.126], [nose1 - 0.012, -S.w * 0.88, 0.126]]);
    box(nose1 - 0.014, nose1, S.w * 0.84, 0.050, 0.124, 'strut');   // the grille surround
    for (let i = 0; fine && i < 4; i++) {                            // and its slats, which catch the light
      const z = 0.058 + i * 0.017;
      box(nose1 - 0.002, nose1 + 0.002, S.w * 0.80, z, z + 0.008, 'strut');
    }
  }
  // Bumper, wider than the cab, with a chin spoiler raked under it.
  box(nose1 - 0.006, nose1 + 0.012, S.w * 1.02, 0.030, 0.058, 'strut');
  poly('body', 0.5, [[nose1 + 0.012, -S.w, 0.030], [nose1 + 0.012, S.w, 0.030],
                     [nose1 - 0.010, S.w, 0.010], [nose1 - 0.010, -S.w, 0.010]]);
  // Headlamps, and a bar of driving lights across the bumper on the rigs that wear one.
  for (const g of [-1, 1]) box(nose1 - 0.004, nose1 + 0.006, 0.022, 0.062, 0.096, 'window', [214, 202, 156], g * S.w * 0.68);
  if (fine && S.lamps > 0.7) {
    for (let i = -1; i <= 1; i++) box(nose1 + 0.006, nose1 + 0.013, 0.013, 0.036, 0.052, 'window', [220, 226, 236], i * S.w * 0.42);
  }
  // ── Stacks, tanks, mirrors ─────────────────────────────────────────────────
  // The pieces that are neither body nor wheel, and between them they do most of the work of
  // "this is heavy machinery, not a van".
  for (let i = 0; i < S.stacks; i++) {
    const g = (S.stacks === 1 ? 0 : (i ? 1 : -1)) * S.w * 0.94;
    const top = S.hi + S.sleeper + 0.062;
    box(cab0 - 0.013, cab0 + 0.013, 0.012, 0.055, top, 'strut', null, g);
    box(cab0 - 0.016, cab0 + 0.016, 0.015, 0.085, 0.135, 'strut', null, g);      // the perforated heat shield
    box(cab0 - 0.015, cab0 + 0.015, 0.014, top - 0.012, top, 'strut', null, g);  // the chrome rain cap
  }
  for (const g of [-1, 1]) {
    box(cab0 - 0.082, cab0 - 0.012, 0.021, 0.034, 0.088, 'strut', null, g * S.w * 0.88);      // saddle tank
    box(cab0 - 0.082, cab0 - 0.012, 0.023, 0.056, 0.064, 'strut', null, g * S.w * 0.88);      // its chrome strap
    if (S.skirt) box(frame0 + 0.02, cab0 - 0.085, 0.010, 0.032, 0.078, 'body', null, g * S.w * 0.9);   // side fairing
  }
  // Mirrors on arms — a rig without them is the one detail that looks wrong without anybody being
  // able to say why — and this pair has GLASS in them, angled back at the driver.
  for (const g of [-1, 1]) {
    box(cab1 - 0.034, cab1 - 0.012, 0.005, S.hi * 0.54, S.hi * 0.90, 'strut', null, g * (S.w + 0.024));
    box(cab1 - 0.032, cab1 - 0.016, 0.002, S.hi * 0.58, S.hi * 0.86, 'glass', [70, 92, 108], g * (S.w + 0.028));
    box(cab1 - 0.030, cab1 - 0.024, 0.024, S.hi * 0.70, S.hi * 0.74, 'strut', null, g * (S.w + 0.012));   // the arm itself
  }

  // Wheels. Steer axle under the nose, then one or two drive groups — and the drive groups are
  // DOUBLED (two rims a side), which is the give-away that something is rated to pull.
  const gOut = S.w * 1.02;
  for (const g of [-gOut, gOut]) {
    wheel(nose0 + 0.035, g, 0.046);
    for (let a = 0; a < S.axles; a++) {
      const f = frame0 + 0.055 + a * 0.105;
      wheel(f, g, 0.052);
      wheel(f, g - Math.sign(g) * 0.042, 0.052);            // the inner of the dual
    }
  }

  if (hitched) {
    // The trailer. It is a SEPARATE body drawn straight behind the tractor, which is honest for
    // every view this mesh is used in (a passing aircraft, a contact in the window, the yard) —
    // and it is also the seam where a future articulated draw hangs its angle, since the two
    // halves are already two groups of faces rather than one welded box.
    const t1 = frame0 - 0.02, t0 = t1 - S.deck;
    const tTop = deckTop + 0.135;
    box(t0, t1, S.w * 1.02, 0.075, tTop, 'body');                  // the box
    box(t0 + 0.01, t1 - 0.01, S.w * 0.99, tTop, tTop + 0.010, 'body');  // roof cap
    // RIBS. A trailer flank is a corrugated wall, and a bare quad is the flattest surface in the
    // whole model — six shallow ribs a side cost nothing and give the biggest panel on the rig
    // something for the light to break on.
    for (let i = 0; fine && i < 6; i++) {
      const f = t0 + 0.03 + i * (S.deck - 0.06) / 5;
      for (const g of [-1, 1]) box(f - 0.004, f + 0.004, 0.004, 0.085, tTop - 0.008, 'strut', null, g * S.w * 1.03);
    }
    // Conspicuity tape low on the flank, and the rear doors with their lock bars.
    for (const g of [-1, 1]) box(t0 + 0.02, t1 - 0.02, 0.003, 0.086, 0.098, 'window', [216, 168, 72], g * S.w * 1.04);
    box(t0, t0 + 0.006, S.w * 1.0, 0.075, tTop - 0.005, 'strut');     // the doors, at the back
    for (const g of [-1, 1]) box(t0 - 0.001, t0 + 0.002, 0.004, 0.080, tTop - 0.010, 'strut', null, g * S.w * 0.5);   // lock bars
    for (const g of [-1, 1]) box(t0 - 0.002, t0 + 0.004, 0.014, 0.088, 0.104, 'window', [186, 62, 52], g * S.w * 0.78);   // tail lamps
    // Landing legs: the two cranked struts a dropped trailer stands on. They are the reason a box
    // parked in a yard doesn't fall on its nose, and the yard is exactly where this mesh is seen.
    for (const g of [-1, 1]) box(t1 - 0.09, t1 - 0.075, 0.010, 0.005, 0.078, 'strut', null, g * S.w * 0.72);
    for (const g of [-gOut, gOut]) {                                   // bogie under the tail
      wheel(t0 + 0.075, g, 0.050); wheel(t0 + 0.075, g - Math.sign(g) * 0.040, 0.050);
      wheel(t0 + 0.165, g, 0.050); wheel(t0 + 0.165, g - Math.sign(g) * 0.040, 0.050);
    }
    if (S.skirt) for (const g of [-1, 1]) box(t0 + 0.20, t1 - 0.03, 0.008, 0.040, 0.078, 'body', null, g * S.w * 0.98);   // trailer skirt
    for (const g of [-1, 1]) box(t0 - 0.012, t0 - 0.004, 0.026, 0.01, 0.06, 'strut', null, g * S.w * 0.7);  // mudflaps
  }

  // CENTRE IT. The tractor is laid out forward from a nose anchor, so a bobtail Barrow ended up
  // sitting entirely in the front half of the normalised box — and every consumer of this mesh
  // (contacts in the window, the schematic, the wireframe) places it by its ORIGIN, so it would
  // have drawn visibly ahead of where the truck actually is, and spun about its own bumper in the
  // dealer's turntable. Eight variants, eight different lengths; centring is derived, never typed.
  let lo = Infinity, hi = -Infinity;
  for (const f of faces) for (const p of f.p) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0]; }
  const shift = (lo + hi) / 2;
  // Through a SET, because `box()` shares each corner vertex between the three quads that meet at
  // it — walking `faces` and subtracting per reference moves the same corner up to three times and
  // shears the model apart. (It did: the first cut put every truck further off-centre than it
  // started, and the regress case caught it.)
  if (shift) {
    const seen = new Set();
    for (const f of faces) for (const p of f.p) if (!seen.has(p)) { seen.add(p); p[0] -= shift; }
  }
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

// ── Canopy art (procedural, painted onto the glass) ───────────────────────────
// Everything that makes a cockpit read as a CANOPY rather than a blue-tinted blister — heavy
// mullions, the sky reflection, the dark interior, people in there — is baked into ONE
// transparent canvas per airframe style and mapped through the authored per-facet UVs. Alpha
// matters: the glazed areas stay translucent so each facet's own lit/shaded fill carries through
// (the canopy still bends with the light), while frames and crew silhouettes paint opaque.
//
// Texture space (shared by every style): U 0→CP_TW runs windscreen→rear canopy, V 0→CP_TH runs
// right sill→roof→left sill. Symmetric about V=0.5 so port and starboard wear the same glass.
// The Viper's frame stations mirror its mesh's STATION_U/GLAZE so a mullion always lands on a
// real facet seam; the fixed-wing bubbles unwrap the same way (segment → U, arc → V), so the
// same spec shape drives both.
export const CP_TW = 512, CP_TH = 256;

// Per-airframe canopy specs. Each is the same five things — the glass wash, who's inside, the
// panel glow, the specular rake, and the frame — so a new airframe is a data entry, not code.
//   wash    sill→roof→sill gradient stops (this is what sets the whole character: a gunship's
//           near-opaque smoked glass vs a light aircraft's big bright greenhouse)
//   crew    silhouettes behind the glass: u/v placement, scale, and what they're wearing
//   glow    instrument light spilling up onto the inside of the windscreen, per station
//   spec    hard diagonal sun streaks, clipped to a band of V (the roof panes)
//   frame   posts (U bars), sills/hairs (V bars), the centreline beam, and the perimeter
const CANOPY_ART = {
  // Viper — a gunship's smoked armoured glass: dark, tight, heavily framed, two helmets inside.
  viper: {
    wash: [[0.00, 'rgba(6,11,16,0.90)'], [0.16, 'rgba(9,16,23,0.82)'], [0.34, 'rgba(34,60,80,0.40)'],
           [0.46, 'rgba(150,196,222,0.32)'], [0.54, 'rgba(150,196,222,0.32)'], [0.66, 'rgba(34,60,80,0.40)'],
           [0.84, 'rgba(9,16,23,0.82)'], [1.00, 'rgba(6,11,16,0.90)']],
    // V=0.30/0.70 puts them mid-CHEEK-pane rather than on a sill rail, so a mullion never bisects
    // a head; one per side means a crewman shows whichever cheek is turned to you.
    crew: [{ u: 0.29, v: 0.30, sc: 0.9, visor: 'rgba(96,190,150,0.55)' }, { u: 0.29, v: 0.70, sc: 0.9, visor: 'rgba(96,190,150,0.55)' },
           { u: 0.71, v: 0.30, sc: 1.0, visor: 'rgba(96,190,150,0.55)' }, { u: 0.71, v: 0.70, sc: 1.0, visor: 'rgba(96,190,150,0.55)' }],
    glow: { u: [0.06, 0.50], col: '70,150,190', a: 0.22, r: 70 },
    spec: { band: [0.26, 0.74], streaks: [[0.18, 30, 0.15], [0.62, 18, 0.10]] },
    frame: { col: 'rgba(26,30,36,0.95)', lit: 'rgba(84,92,102,0.55)',
      posts: [[0.00, 8], [0.14, 8], [0.44, 13], [0.56, 13], [0.86, 8], [1.00, 8]],   // the tandem step is the beefiest frame on the aircraft
      sills: [[0.20, 10], [0.80, 10]], hairs: [0.40, 0.60], mid: 5, edge: 16 },
  },
  // Mayfly — a Cessna cabin: a big, bright, almost clear greenhouse with slim white frames and
  // two people sitting SIDE BY SIDE up front. The opposite read to the Viper on purpose — you can
  // see straight through a light single, and that legibility is the whole charm of the airframe.
  mayfly: {
    wash: [[0.00, 'rgba(22,34,44,0.62)'], [0.14, 'rgba(38,62,80,0.44)'], [0.32, 'rgba(120,168,196,0.26)'],
           [0.46, 'rgba(196,226,244,0.30)'], [0.54, 'rgba(196,226,244,0.30)'], [0.68, 'rgba(120,168,196,0.26)'],
           [0.86, 'rgba(38,62,80,0.44)'], [1.00, 'rgba(22,34,44,0.62)']],
    // Two heads abreast at the SAME station (u), one at each side window — a side-by-side cabin.
    // V≈0.18/0.82 is eye level just above the sill, in the middle of the side glass (the bubble's
    // arc=3 unwrap puts the side panes at V 0–⅓ and ⅔–1, the crown pane between them).
    crew: [{ u: 0.34, v: 0.18, sc: 0.85, hair: 'rgba(58,44,36,0.9)' }, { u: 0.34, v: 0.82, sc: 0.85, hair: 'rgba(30,32,38,0.9)' }],
    glow: { u: [0.08], col: '120,190,150', a: 0.16, r: 56 },
    spec: { band: [0.22, 0.78], streaks: [[0.26, 34, 0.20], [0.70, 22, 0.13]] },
    frame: { col: 'rgba(224,226,230,0.92)', lit: 'rgba(255,255,255,0.5)',   // painted white cabin frames, not gunmetal
      posts: [[0.00, 7], [0.30, 5], [0.62, 5], [1.00, 7]],
      sills: [[1 / 3, 5], [2 / 3, 5]],   // the side-glass/roof chine — a real facet seam on an arc-3 bubble
      mid: 4, edge: 11 },
  },
  // Mule — a Twin Otter FLIGHT DECK: a working commercial cockpit. Darker green-tinted glass than
  // the Mayfly, chunky dark frames, two pilots abreast, panel glow up the windscreen, and wipers
  // parked across the screen (the detail that says airliner rather than plaything).
  mule: {
    wash: [[0.00, 'rgba(12,20,26,0.80)'], [0.16, 'rgba(20,36,46,0.66)'], [0.34, 'rgba(58,102,116,0.34)'],
           [0.47, 'rgba(150,198,208,0.30)'], [0.53, 'rgba(150,198,208,0.30)'], [0.66, 'rgba(58,102,116,0.34)'],
           [0.84, 'rgba(20,36,46,0.66)'], [1.00, 'rgba(12,20,26,0.80)']],
    // The Mule glazes its HULL (FW_PARAMS.prop.glaze), so which of this sheet shows depends on the
    // facet. The WINDSCREEN bays (U 0–0.20) glaze the full upper half → all of V 0–1 is glass, a
    // two-pane wraparound split by the centre post at V=0.5. The SIDE-WINDOW bays (U 0.20–0.90)
    // glaze only the side band → just V 0–⅙ and ⅚–1 show; the middle of the sheet there is cabin
    // roof (painted, never drawn). So crew/glow sit low in V (the side glass) or forward in U (the
    // windscreen); the centre post + window-line frames are the only things crossing the crown.
    crew: [{ u: 0.32, v: 0.09, sc: 0.95, cap: true, hair: 'rgba(24,26,32,0.92)' },
           { u: 0.32, v: 0.91, sc: 0.95, cap: true, hair: 'rgba(24,26,32,0.92)' }],
    glow: { u: [0.05, 0.12], col: '90,170,200', a: 0.26, r: 66 },   // panel glow up the windscreen
    spec: { band: [0.0, 1.0], streaks: [[0.09, 22, 0.18], [0.15, 14, 0.11]] },   // sun rake clipped to the windscreen U
    frame: { col: 'rgba(38,42,48,0.95)', lit: 'rgba(96,104,114,0.5)',
      // U posts on the real ring seams (glaze f 0.70→0.30 ⇒ U 0→1): windscreen front (0), its
      // inter-bay divider (0.10), the beefy A-pillar where the screen meets the cabin (0.20),
      // the side-window divider (0.55), and the aft edge of the side glass (0.90).
      posts: [[0.00, 8], [0.10, 6], [0.20, 12], [0.55, 8], [0.90, 8], [1.00, 8]],
      sills: [[1 / 6, 8], [5 / 6, 8]],   // window line — the side-band/cheek seam; the base of the windscreen wrap
      hairs: [], mid: 7, edge: 14, extra: 'wipers' },   // mid = the windscreen CENTRE POST between the two panes (V=0.5; only the windscreen glazes the crown, so it shows there alone)
  },
  // Reaper — an A-10's canopy: a single-seat bubble of thick armoured glass with the faint GOLD
  // flash of its lamination, near-frameless over the crown (that's the Warthog's whole visibility
  // pitch) but shut off up front by a heavy bow frame carrying the HUD. One pilot, helmeted, visor
  // down, green HUD light on the inside of the screen. arc 5 ⇒ V bands of 0.2: side panes at the
  // sills, the crown pane across V 0.4–0.6.
  reaper: {
    wash: [[0.00, 'rgba(8,12,14,0.86)'], [0.15, 'rgba(14,22,24,0.74)'], [0.32, 'rgba(58,74,54,0.38)'],
           [0.44, 'rgba(196,196,150,0.26)'], [0.56, 'rgba(196,196,150,0.26)'], [0.68, 'rgba(58,74,54,0.38)'],
           [0.85, 'rgba(14,22,24,0.74)'], [1.00, 'rgba(8,12,14,0.86)']],
    // Single seat: ONE station, a head showing at each side pane (whichever cheek is turned to you).
    crew: [{ u: 0.30, v: 0.28, sc: 1.0, visor: 'rgba(120,200,160,0.5)', hair: 'rgba(24,28,26,0.94)' },
           { u: 0.30, v: 0.72, sc: 1.0, visor: 'rgba(120,200,160,0.5)', hair: 'rgba(24,28,26,0.94)' }],
    glow: { u: [0.05, 0.14], col: '110,220,140', a: 0.24, r: 62 },   // HUD + panel light up the bow
    spec: { band: [0.24, 0.76], streaks: [[0.22, 30, 0.19], [0.66, 18, 0.11]] },
    frame: { col: 'rgba(30,34,32,0.95)', lit: 'rgba(96,104,96,0.5)',
      posts: [[0.00, 16], [0.13, 11], [0.98, 9], [1.00, 12]],   // the bow frame is the heaviest thing on the canopy; the rear arch closes it
      sills: [[0.20, 9], [0.80, 9]],   // the canopy rails the clamshell seals onto — a real facet seam at arc 5
      hairs: [0.40, 0.60], mid: 0, edge: 13 },
  },
  // Leviathan — an An-124 FLIGHT DECK glazed into the hull (FW_PARAMS.heavy.glaze). A working heavy
  // freighter's office, and the read to chase is a WORKPLACE seen from outside: a small bright patch
  // of green-tinted glass high on a very long grey fuselage, chunky painted frames, sun blinds half
  // down, a black glareshield coaming under the screen, wipers parked on the sill, and a full Antonov
  // crew — two pilots at the screen, engineer and navigator at the side glass behind them.
  //
  // Which of this sheet shows depends on the facet, and the important thing is what NEVER shows: the
  // crown is unglazed, so the middle band of the sheet (V 0.375–0.625) is painted spine and is never
  // drawn. The WINDSCREEN bay (U 0–0.364) glazes the upper cheeks — V 0.125–0.375 and 0.625–0.875,
  // a pane pair either side of the spine — and the side-glass bays behind it glaze only the high
  // strip V 0.25–0.375 / 0.625–0.75. Everything painted here is authored to those bands: put a
  // detail on the crown and it simply doesn't exist.
  leviathan: {
    wash: [[0.00, 'rgba(10,18,22,0.82)'], [0.12, 'rgba(16,30,36,0.72)'], [0.26, 'rgba(46,88,98,0.40)'],
           [0.34, 'rgba(132,184,192,0.30)'], [0.42, 'rgba(150,200,206,0.26)'], [0.50, 'rgba(52,96,104,0.42)'],
           [0.58, 'rgba(150,200,206,0.26)'], [0.66, 'rgba(132,184,192,0.30)'], [0.74, 'rgba(46,88,98,0.40)'],
           [0.88, 'rgba(16,30,36,0.72)'], [1.00, 'rgba(10,18,22,0.82)']],   // brightest at the two glazed cheeks, darkening back toward both sills
    crew: [{ u: 0.24, v: 0.37, sc: 0.62, cap: true, hair: 'rgba(22,24,30,0.92)' },   // captain + first officer at the screen
           { u: 0.24, v: 0.63, sc: 0.62, cap: true, hair: 'rgba(22,24,30,0.92)' },
           { u: 0.74, v: 0.29, sc: 0.55, hair: 'rgba(30,28,26,0.92)' },              // engineer / navigator back in the side glass
           { u: 0.74, v: 0.71, sc: 0.55, hair: 'rgba(30,28,26,0.92)' }],
    glow: { u: [0.06, 0.20], col: '90,180,190', a: 0.24, r: 44 },
    spec: { band: [0.0, 1.0], streaks: [[0.14, 16, 0.16], [0.26, 10, 0.10]] },   // sun rake clipped to the windscreen U
    frame: { col: 'rgba(40,44,50,0.95)', lit: 'rgba(104,112,122,0.5)',
      // UNDIVIDED. One unbroken strip of glass: no centre post, no pane hairlines, no inter-bay
      // pillars — only the perimeter and the sill rails top and bottom of the band. The blinds and
      // wipers went with them: on a strip this narrow each of those was a line straight across the
      // window, and a few lines across a small band is all you would have seen of it.
      posts: [], hairs: [], mid: 0,
      sills: [[0.25, 7], [0.75, 7]],   // the window line — the only structure left
      edge: 11, extra: ['glareshield'],
      // The glareshield sits just inside each sill, clipped to the windscreen U — the one bit of
      // interior structure worth keeping, because it's what stops a small dark strip reading as a
      // painted-on slot rather than a window with a cockpit behind it.
      shieldV: [[0.25, 0.315], [0.75, 0.685]], deckU: 0.5 },
  },
  // Grasshopper — an XCub (per ref photo): the big wraparound backcountry greenhouse. A SKYLIGHT
  // over the crown (you look up through the wing root), deep curved side glass, a black steel cage
  // with white-painted frames, and TANDEM seating — one behind the other, headsets and shades on,
  // in the high-vis jackets everybody wears out in the bush.
  xcub: {
    wash: [[0.00, 'rgba(18,28,36,0.66)'], [0.13, 'rgba(30,50,64,0.46)'], [0.30, 'rgba(108,158,186,0.26)'],
           [0.44, 'rgba(206,234,248,0.34)'], [0.56, 'rgba(206,234,248,0.34)'], [0.70, 'rgba(108,158,186,0.26)'],
           [0.87, 'rgba(30,50,64,0.46)'], [1.00, 'rgba(18,28,36,0.66)']],
    // TANDEM: two stations at different U (fore/aft), each showing a head at both side windows.
    crew: [{ u: 0.26, v: 0.17, sc: 0.9, shades: true, jacket: '206,74,34' }, { u: 0.26, v: 0.83, sc: 0.9, shades: true, jacket: '206,74,34' },
           { u: 0.56, v: 0.17, sc: 0.9, shades: true, jacket: '32,36,44' }, { u: 0.56, v: 0.83, sc: 0.9, shades: true, jacket: '32,36,44' }],
    glow: { u: [0.06], col: '110,180,210', a: 0.18, r: 52 },
    spec: { band: [0.20, 0.80], streaks: [[0.30, 38, 0.22], [0.74, 20, 0.12]] },
    frame: { col: 'rgba(22,24,28,0.95)', lit: 'rgba(238,240,244,0.75)',   // black cage, white-painted highlight
      posts: [[0.00, 8], [0.20, 6], [0.44, 9], [0.72, 6], [1.00, 8]],
      sills: [[1 / 3, 6], [2 / 3, 6]],   // the skylight's edge rails — the arc-3 seam either side of the crown
      mid: 3, edge: 12, extra: 'skylight' },
  },
  // Locust — an ag-plane's office: a small, deep, HEAVILY caged greenhouse sat up on top of the
  // hopper. The read is armoured farm equipment, not a light plane — thick roll-cage frames in
  // yellow-primed steel (the same #ffd24a the flightdeck skin is keyed to), amber-tinted glass
  // against the glare of flying at fifteen feet all day, and the chunky bow frame carrying the
  // wire cutter. Tandem seats, both crew in ear defenders. arc 5 ⇒ sills at V 0.2/0.8.
  locust: {
    wash: [[0.00, 'rgba(16,20,22,0.78)'], [0.15, 'rgba(28,34,32,0.62)'], [0.32, 'rgba(92,112,96,0.34)'],
           [0.45, 'rgba(214,206,158,0.30)'], [0.55, 'rgba(214,206,158,0.30)'], [0.68, 'rgba(92,112,96,0.34)'],
           [0.85, 'rgba(28,34,32,0.62)'], [1.00, 'rgba(16,20,22,0.78)']],
    crew: [{ u: 0.30, v: 0.19, sc: 0.92, cap: true, hair: 'rgba(40,34,28,0.92)' }, { u: 0.30, v: 0.81, sc: 0.92, cap: true, hair: 'rgba(40,34,28,0.92)' },
           { u: 0.62, v: 0.19, sc: 0.86, shades: true, hair: 'rgba(26,28,32,0.92)' }, { u: 0.62, v: 0.81, sc: 0.86, shades: true, hair: 'rgba(26,28,32,0.92)' }],
    glow: { u: [0.07], col: '255,210,74', a: 0.20, r: 50 },   // the amber flightdeck lighting, seen from outside
    spec: { band: [0.20, 0.80], streaks: [[0.24, 32, 0.20], [0.68, 18, 0.11]] },
    frame: { col: 'rgba(34,30,18,0.96)', lit: 'rgba(255,210,74,0.55)',   // yellow-primed steel cage
      posts: [[0.00, 14], [0.16, 9], [0.46, 10], [0.78, 8], [1.00, 10]],   // the bow frame is the heaviest — it's a wire cutter's anchor
      sills: [[0.20, 9], [0.80, 9]], hairs: [0.32, 0.62], mid: 6, edge: 14 },
  },
  // THE CAB (THE LONG HAUL). A truck windscreen is not a canopy and should not read as one: it is
  // one enormous flat pane, deeply raked, with sky across the top two-thirds and the dark of the
  // cab underneath — plus the three things every one of them has and no aircraft does. WIPERS
  // parked across the bottom (two great arms, the give-away at any distance). A GLARESHIELD, which
  // here is the dash: a black shelf along the sill with instrument light coming off it. And a
  // DRIVER sitting to one side of the centreline rather than crew abreast on it, because a cab has
  // one seat that matters and the asymmetry is instantly legible as a road vehicle.
  //
  // V is ACROSS the screen and U is UP it (the mesh maps the quad corner-for-corner), so the sill
  // furniture lives at low U and the sky wash runs the U axis — the opposite of the arc-unwrapped
  // canopies above, and the reason the numbers here look nothing like theirs.
  truckcab: {
    wash: [[0.00, 'rgba(10,13,16,0.88)'], [0.22, 'rgba(18,28,36,0.70)'], [0.44, 'rgba(64,104,126,0.34)'],
           [0.62, 'rgba(150,196,220,0.30)'], [0.82, 'rgba(178,214,232,0.26)'], [1.00, 'rgba(120,164,192,0.34)']],
    crew: [{ u: 0.30, v: 0.28, sc: 1.05, hair: 'rgba(38,32,28,0.92)' }],
    glow: { u: [0.10, 0.16], col: '255,176,74', a: 0.26, r: 74 },   // the dash, amber, coming up off the shelf
    spec: { band: [0.0, 1.0], streaks: [[0.58, 40, 0.20], [0.74, 26, 0.13]] },
    frame: { col: 'rgba(30,32,36,0.95)', lit: 'rgba(104,112,122,0.5)',
      posts: [[0.00, 12], [1.00, 10]],      // sill rail and header — the A-pillars are real geometry, not painted
      sills: [[0.50, 6]],                   // the centre divider a big two-piece screen carries
      hairs: [], mid: 0, edge: 12,
      shieldV: [[0.00, 0.20]], deckU: 1, browV: [[1.00, 0.86]],
      extra: ['glareshield', 'wipers', 'brow'] },
  },
};

const _canopyTex = {};
export function canopyTex(art = 'viper') {
  if (_canopyTex[art]) return _canopyTex[art];
  const S = CANOPY_ART[art] || CANOPY_ART.viper;
  const cv = document.createElement('canvas'); cv.width = CP_TW; cv.height = CP_TH;
  const g = cv.getContext('2d'), W = CP_TW, H = CP_TH;

  // 1) The glass itself — a sill→roof→sill wash. Bright sky reflection across the roof band,
  //    falling away to a darker interior read down at the sills where you're looking through the
  //    side glass into the cockpit rather than at the sky.
  const gl = g.createLinearGradient(0, 0, 0, H);
  for (const [st, col] of S.wash) gl.addColorStop(st, col);
  g.fillStyle = gl; g.fillRect(0, 0, W, H);

  // Style extras. `extra` is one name or a LIST of them — a flight deck wants blinds AND a
  // glareshield AND wipers, and each is an independent little painter rather than a mode.
  const EX = (n) => [].concat(S.frame.extra || []).includes(n);

  // 1b) Style extras that belong UNDER the crew and frames.
  if (EX('glareshield')) {
    // The coaming: the black anti-glare shelf under the windscreen, seen from outside as a hard dark
    // band hugging the sill with the instrument panel's own light leaking up off it. This is the
    // detail that stops a big pane reading as an empty hole — there's an INSTRUMENT PANEL in there.
    const dU = S.frame.deckU ?? 1;
    for (const [vS, vI] of (S.frame.shieldV || [])) {
      const y0 = Math.min(vS, vI) * H, y1 = Math.max(vS, vI) * H;
      const cg = g.createLinearGradient(0, vS * H, 0, vI * H);
      cg.addColorStop(0, 'rgba(6,8,10,0.92)'); cg.addColorStop(0.55, 'rgba(10,14,18,0.62)'); cg.addColorStop(1, 'rgba(10,14,18,0)');
      g.fillStyle = cg; g.fillRect(0, y0, W * dU, y1 - y0);
      // Panel light spilling off the shelf onto the glass just above it.
      const lg = g.createLinearGradient(0, vI * H, 0, vS * H);
      lg.addColorStop(0, 'rgba(70,190,170,0)'); lg.addColorStop(1, 'rgba(70,190,170,0.20)');
      g.fillStyle = lg; g.fillRect(0, y0, W * dU * 0.9, y1 - y0);
    }
  }
  if (EX('brow')) {
    // The BROW. On the real aeroplane the flight deck is recessed into a fuselage that overhangs it,
    // so the top of every pane sits in the shadow of its own roofline — and the eye reads that band
    // of shade as depth. Without it the glass is a decal lying flat on the skin; with it the cockpit
    // is set INTO the nose, which is the single biggest fidelity win available here.
    for (const [vRail, vIn] of (S.frame.browV || [])) {
      const bg = g.createLinearGradient(0, vRail * H, 0, vIn * H);
      bg.addColorStop(0, 'rgba(4,7,10,0.78)'); bg.addColorStop(0.6, 'rgba(6,10,14,0.30)'); bg.addColorStop(1, 'rgba(6,10,14,0)');
      // Clipped to the U band AFT of the screen: a wraparound windscreen has open sky over it, so a
      // brow there would be shading the pane from a roofline that isn't there.
      const bU = S.frame.deckU ?? 0;
      g.fillStyle = bg;
      g.fillRect(bU * W, Math.min(vRail, vIn) * H, (1 - bU) * W, Math.abs(vIn - vRail) * H);
    }
  }
  if (S.panes) {
    // Per-pane tint step. Flat panes at different angles never catch the sky identically, and a
    // uniform wash across the whole sheet is what makes faceted glass read as one printed sticker.
    // Alternating a hair of light and dark per bay costs nothing and breaks that up.
    S.panes.forEach(([u0, u1], i) => {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,10,16,0.07)';
      g.fillRect(u0 * W, 0, (u1 - u0) * W, H);
    });
  }
  if (EX('blinds')) {
    // Sun blinds pulled part-way down from the roofline — never level with each other, because no
    // two crew ever set them the same, and that asymmetry is most of what sells them as blinds.
    const dU = S.frame.deckU ?? 1;
    (S.frame.blindV || []).forEach(([vTop, vBot], i) => {
      const y0 = Math.min(vTop, vBot) * H, y1 = Math.max(vTop, vBot) * H, drop = i ? 0.82 : 1;
      const yb = y0 + (y1 - y0) * drop;
      g.fillStyle = 'rgba(148,132,104,0.62)'; g.fillRect(0, Math.min(y0, yb), W * dU, Math.abs(yb - y0));
      g.strokeStyle = 'rgba(60,52,38,0.7)'; g.lineWidth = 2;   // the weighted bottom rail
      g.beginPath(); g.moveTo(0, yb); g.lineTo(W * dU, yb); g.stroke();
    });
  }
  if (EX('skylight')) {
    // The Cub skylight: an overhead pane running the length of the crown, so the roof band reads
    // as open sky rather than fabric. Brighter than the wash and squared off at the door station.
    const sk = g.createLinearGradient(0, H * 0.38, 0, H * 0.62);
    sk.addColorStop(0, 'rgba(150,206,240,0)'); sk.addColorStop(0.5, 'rgba(186,226,252,0.34)'); sk.addColorStop(1, 'rgba(150,206,240,0)');
    g.fillStyle = sk; g.fillRect(W * 0.16, H * 0.38, W * 0.62, H * 0.24);
  }

  // 2) Interior: the crew. Silhouettes sitting low in the frame (V near the sills is eye level
  //    through the side glass). Vague on purpose — a hard shape at this size reads as a decal, a
  //    soft one reads as somebody in there.
  for (const c of (S.crew || [])) {
    const cx = c.u * W, cy = c.v * H, sc = c.sc || 1;
    // Torso haze — tinted by the jacket where the airframe's people wear one.
    const jk = c.jacket || '5,8,12';
    const sh = g.createRadialGradient(cx, cy, 2, cx, cy, 30 * sc);
    sh.addColorStop(0, `rgba(${jk},${c.jacket ? 0.8 : 0.94})`); sh.addColorStop(1, `rgba(${jk},0)`);
    g.fillStyle = sh; g.beginPath(); g.ellipse(cx, cy, 24 * sc, 26 * sc, 0, 0, 7); g.fill();
    // Head — a helmet, a cap, or hair.
    g.fillStyle = c.hair || 'rgba(3,5,8,0.92)';
    g.beginPath(); g.ellipse(cx, cy, 12 * sc, 10 * sc, 0, 0, 7); g.fill();
    if (c.cap) { g.fillStyle = 'rgba(14,16,20,0.95)'; g.beginPath(); g.ellipse(cx - 6 * sc, cy - 3 * sc, 9 * sc, 4 * sc, 0, 0, 7); g.fill(); }   // peaked cap, brim toward the nose
    // Eyewear — a visor glow (gunship) or dark shades (everyone else). U falls toward the nose,
    // so putting it on the -u side of the head makes them look FORWARD.
    if (c.visor) { g.fillStyle = c.visor; g.beginPath(); g.ellipse(cx - 7 * sc, cy + 1.5 * sc, 4.5 * sc, 2.6 * sc, 0, 0, 7); g.fill(); }
    else if (c.shades) {
      g.fillStyle = 'rgba(8,10,14,0.9)'; g.beginPath(); g.ellipse(cx - 7 * sc, cy + 1 * sc, 4.2 * sc, 2.2 * sc, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(60,68,78,0.9)'; g.beginPath(); g.ellipse(cx + 4 * sc, cy - 1 * sc, 3.4 * sc, 5 * sc, 0, 0, 7); g.fill();   // headset cup on the ear behind
    }
  }
  // Instrument glow spilling up onto the inside of the windscreen at each station.
  if (S.glow) for (const u of S.glow.u) {
    const cx = u * W, r = S.glow.r || 70, hg = g.createRadialGradient(cx, H / 2, 4, cx, H / 2, r);
    hg.addColorStop(0, `rgba(${S.glow.col},${S.glow.a})`); hg.addColorStop(1, `rgba(${S.glow.col},0)`);
    g.fillStyle = hg; g.fillRect(cx - r, 0, r * 2, H);
  }

  // 3) Specular: hard diagonal streaks raking across the greenhouse, the way a low sun catches
  //    flat panes. Clipped to the roof band so the side glass stays dark.
  g.save();
  g.beginPath(); g.rect(0, H * S.spec.band[0], W, H * (S.spec.band[1] - S.spec.band[0])); g.clip();
  for (const [uu, wd, a] of S.spec.streaks) {
    const x = uu * W;
    const sg = g.createLinearGradient(x - wd, 0, x + wd, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, `rgba(255,255,255,${a})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.save(); g.translate(x, H / 2); g.rotate(-0.38); g.translate(-x, -H / 2);
    g.fillRect(x - wd, -H, wd * 2, H * 3); g.restore();
  }
  g.restore();

  // 4) Mullions — the structural frame. Bars along the station seams (U) and the sill chines (V),
  //    plus a centreline beam up the windscreen. Opaque: this is airframe, not glass.
  g.lineCap = 'butt';
  const F = S.frame;
  const bar = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  for (const [u, hv] of F.posts) {
    const x = u * W;
    bar(x, 0, x, H, hv, F.col); bar(x - hv * 0.34, 0, x - hv * 0.34, H, 1.6, F.lit);   // a lit highlight down one edge
  }
  // Longitudinal chines: only the SILL rails are structure worth painting. The roof/cheek seams
  // are real facet edges the renderers already stroke — bar them too and the greenhouse reads as
  // a bus window grid, so they get a hairline glint and nothing more.
  for (const [v, hv] of F.sills) {
    const y = v * H;
    bar(0, y, W, y, hv, F.col); bar(0, y - hv * 0.34, W, y - hv * 0.34, 1.6, F.lit);
  }
  for (const v of (F.hairs || [])) bar(0, v * H, W, v * H, 1.4, F.lit);
  if (F.mid) { bar(0, H / 2, W, H / 2, F.mid, F.col); bar(0, H / 2 - F.mid * 0.34, W, H / 2 - F.mid * 0.34, 1.4, F.lit); }
  // 4b) Style extras that belong ON TOP of the frame.
  if (EX('wipers')) {
    // Two wiper arms parked low across the windscreen — the flight-deck tell. Parked ON the sill
    // (frame.wiperV) so they lie in glass a class actually glazes rather than out on painted metal.
    g.strokeStyle = 'rgba(18,20,24,0.85)'; g.lineWidth = 3; g.lineCap = 'round';
    for (const v of (F.wiperV || [0.06, 0.94])) { g.beginPath(); g.moveTo(W * 0.02, v * H); g.lineTo(W * 0.20, (v > 0.5 ? v - 0.13 : v + 0.13) * H); g.stroke(); }
    g.lineCap = 'butt';
  }
  if (EX('skylight')) {
    // The cage: a diagonal door brace running down from the roof to the sill on each side — the
    // steel triangle you see through the XCub's side glass.
    g.strokeStyle = F.col; g.lineWidth = 4;
    for (const [v0, v1] of [[0.42, 0.15], [0.58, 0.85]]) { g.beginPath(); g.moveTo(W * 0.46, v0 * H); g.lineTo(W * 0.70, v1 * H); g.stroke(); }
  }
  // Perimeter: the canopy sill and the front/rear frames close the greenhouse off from the paint.
  g.strokeStyle = F.col; g.lineWidth = F.edge; g.strokeRect(0, 0, W, H);

  _canopyTex[art] = cv; return cv;
}
// Paint the baked canopy art into ONE projected facet over its already-shaded fill. Unlike
// overlayJazz this composites source-over, not multiply — the frames have to sit ON the glass
// as solid structure, while the texture's own alpha lets the lit fill read through the panes.
export function drawCanopyGlass(ctx, P, uv, art) {
  const n = P.length; if (n < 3 || n > 4) return;
  const img = canopyTex(art), d = P.map(q => [q.sx, q.sy]);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d[0][0], d[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(d[i][0], d[i][1]); ctx.closePath(); ctx.clip();
  if (n === 4) { acTexTri(ctx, img, uv[0], uv[1], uv[2], d[0], d[1], d[2]); acTexTri(ctx, img, uv[0], uv[2], uv[3], d[0], d[2], d[3]); }
  else acTexTri(ctx, img, uv[0], uv[1], uv[2], d[0], d[1], d[2]);
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
  } else if (id === 'eye') {
    const cx = W * 0.5, cy = H * 0.56;
    g.strokeStyle = '#6fd6ff'; g.lineWidth = 2; g.lineJoin = 'round';                          // the Architect's eye inside a delta
    g.beginPath(); g.moveTo(cx, 4); g.lineTo(W - 5, H - 5); g.lineTo(5, H - 5); g.closePath(); g.stroke();
    g.fillStyle = '#eef6fb'; g.beginPath(); g.ellipse(cx, cy, 15, 8, 0, 0, 7); g.fill();       // almond sclera
    g.fillStyle = '#1c7ba8'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();                  // iris
    g.fillStyle = '#0a0d10'; g.beginPath(); g.arc(cx, cy, 2.6, 0, 7); g.fill();                // pupil
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(cx - 2, cy - 2, 1.2, 0, 7); g.fill();   // glint
  } else if (id === 'ace') {
    const cx = W * 0.5, cy = H * 0.5;
    g.fillStyle = '#f2f2ea'; g.fillRect(W * 0.31, 4, W * 0.38, H - 8);                          // the card
    g.strokeStyle = '#20242a'; g.lineWidth = 1; g.strokeRect(W * 0.31, 4, W * 0.38, H - 8);
    g.fillStyle = '#141414';                                                                   // spade: two lobes + a triangular crown, on a stem
    g.beginPath(); g.arc(cx - 4, cy + 1, 5, 0, 7); g.arc(cx + 4, cy + 1, 5, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx + 7, cy + 2); g.lineTo(cx - 7, cy + 2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx - 4, cy + 10); g.lineTo(cx + 4, cy + 10); g.lineTo(cx, cy + 3); g.closePath(); g.fill();   // stem
    g.font = 'bold 9px serif'; g.fillText('A', W * 0.33, 14); g.save(); g.translate(W * 0.67, H - 6); g.rotate(Math.PI); g.fillText('A', 0, 0); g.restore();
  } else if (id === 'reaper') {
    const cx = W * 0.5;
    g.fillStyle = '#e8e6dc';
    g.beginPath(); g.arc(cx, H * 0.42, 13, 0, 7); g.fill();                                     // cranium
    g.beginPath(); g.arc(cx - 6, H * 0.62, 6, 0, 7); g.arc(cx + 6, H * 0.62, 6, 0, 7); g.fill();   // cheekbones
    g.fillStyle = '#0a0a0a';
    g.beginPath(); g.arc(cx - 5, H * 0.42, 3.6, 0, 7); g.fill(); g.beginPath(); g.arc(cx + 5, H * 0.42, 3.6, 0, 7); g.fill();   // eye sockets
    g.beginPath(); g.moveTo(cx, H * 0.46); g.lineTo(cx - 2.5, H * 0.58); g.lineTo(cx + 2.5, H * 0.58); g.closePath(); g.fill();   // nasal cavity
    g.strokeStyle = '#0a0a0a'; g.lineWidth = 1;                                                 // teeth
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx + i * 3, H * 0.66); g.lineTo(cx + i * 3, H * 0.76); g.stroke(); }
    g.beginPath(); g.moveTo(cx - 7, H * 0.71); g.lineTo(cx + 7, H * 0.71); g.stroke();
  } else if (id === 'flames') {
    const tongues = (col, ext) => {   // layered licks sweeping back from the nose (left edge)
      g.fillStyle = col; g.beginPath(); g.moveTo(0, 3);
      g.quadraticCurveTo(W * 0.34 * ext, 1, W * 0.30 * ext, H * 0.32);
      g.quadraticCurveTo(W * 0.30 * ext, 8, W * 0.58 * ext, H * 0.22);
      g.quadraticCurveTo(W * 0.50 * ext, H * 0.38, W * 0.80 * ext, H * 0.46);
      g.quadraticCurveTo(W * 0.55 * ext, H * 0.56, W * 0.92 * ext, H * 0.66);
      g.quadraticCurveTo(W * 0.55 * ext, H * 0.72, W * 0.40 * ext, H * 0.92);
      g.quadraticCurveTo(W * 0.28 * ext, H * 0.80, 0, H - 3);
      g.closePath(); g.fill();
    };
    tongues('#b81717', 1.0); tongues('#ef7a18', 0.78); tongues('#f6cf3b', 0.5);
  } else { _decalCache[id] = null; return null; }
  _decalCache[id] = c; return c;
}
// Even–odd point-in-polygon over a projected {sx,sy} ring — used to cull decal cells hidden
// behind a nearer appendage (wing/nacelle/gear/…) that paints in front of the fuselage flank.
function ptInScreenPoly(x, y, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i].sx, yi = P[i].sy, xj = P[j].sx, yj = P[j].sy;
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function drawNoseArt(ctx, proj, cls, lv, occluders = null) {
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
  // The mouth/flame decals READ better wrapped onto the nose cone itself (that's where a real
  // sharkmouth belongs), so they reach forward toward the tip; the centred emblems stay flat on
  // the mid-flank where the cone taper won't pinch them.
  const reach = id === 'sharkmouth' || id === 'flames';
  const fF = reach ? p.noseF * 0.9 : 0.64, fR = reach ? 0.06 : 0.18;   // forward-fuselage extent (front = nose)
  const fr = p.fr, fv = p.fv, shapeExp = 1 - (p.boxy || 0) * 0.55;
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0, OUT = 1.03;
  const radAt = (f) => { let u = Math.min(1, Math.abs(f / p.noseF)); u = u <= tube ? 0 : (u - tube) / (1 - tube); return cowl + (1 - cowl) * Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); };
  // Height profile, mirroring buildFixedWing's radVAt: on a class whose nose sheds height faster
  // than width the flank is SHORTER up front, and wrapping the decal on the plan taper alone hangs
  // it off the top of the snout.
  const radVAt = (f) => {
    if (!(p.noseVTaper && f > 0)) return radAt(f);
    let u = Math.min(1, f / p.noseF); u = u <= tube ? 0 : (u - tube) / (1 - tube);
    const vf = p.noseVFloor || 0;
    return radAt(f) * (vf + (1 - vf) * Math.pow(1 - u, p.noseVTaper));
  };
  const czAt = (f) => (p.noseZ ?? 0.02) * (f / p.noseF);            // centreline height (drooped nose pulls it down)
  const surf = (f, h, sign) => {                                     // near-flank hull point at (f, h) — sign picks the flank
    const r = radAt(f), sv = clampN((h - czAt(f)) / (fv * radVAt(f) || 1e-6), -0.999, 0.999);
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
      const f = fF + (fR - fF) * (i / Nc);
      // Reach decals ride the nose cone, so the vertical band tapers with the shrinking radius —
      // it hugs the cone to the tip instead of overshooting the thin front as a fixed-height slab.
      const hh = reach ? hHalf * (0.30 + 0.70 * radVAt(f)) : hHalf;
      const h = czAt(f) + hh - 2 * hh * (j / Nr);   // top(j=0) → bottom
      const P = proj(...surf(f, h, sign)); row.push(P); if (P.z > 0.18) anyNear = true;
    }
    grid.push(row);
  }
  if (!anyNear) return;
  // Texture-mapping the decal onto a handedness-flipped flank reads it BACKWARDS, so key the U flip
  // off the projected screen winding of the decal grid (nose→tail top edge × nose top→bottom left
  // edge). The authored source winding is positive; when the visible flank projects to a negative
  // winding we flip U to un-mirror it. This is only right for the flat mid-flank EMBLEMS (a mirrored
  // emblem/text reads backwards). The directional reach decals (sharkmouth/flames) are physically
  // nose-anchored — the grid already tracks the real fore-aft axis, so texture-nose sits at the
  // plane's nose on BOTH flanks. Flipping those would sweep the flames off the tip the wrong way,
  // so reach decals never flip.
  const n0 = grid[0][0], nT = grid[0][Nc], bL = grid[Nr][0];
  const cross = (nT.sx - n0.sx) * (bL.sy - n0.sy) - (nT.sy - n0.sy) * (bL.sx - n0.sx);
  const flip = !reach && cross > 0;   // un-mirror emblems onto the visible flank (winding sign corrected — was reading backwards)
  const uOf = (col) => (flip ? (Nc - col) : col) / Nc * W;
  const occ = occluders || [];
  for (let j = 0; j < Nr; j++) for (let i = 0; i < Nc; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
    if (a.z <= 0.18 || b.z <= 0.18 || c.z <= 0.18 || d.z <= 0.18) continue;             // skip cells crossing behind the eye
    // Occlusion: skip a cell whose centre sits behind a NEARER appendage face (wing/nacelle/gear/…),
    // so the decal no longer paints through parts of the airframe standing in front of the flank.
    const mx = (a.sx + b.sx + c.sx + d.sx) / 4, my = (a.sy + b.sy + c.sy + d.sy) / 4;
    const mz = (a.z + b.z + c.z + d.z) / 4;
    if (occ.some(o => o.z < mz && ptInScreenPoly(mx, my, o.P))) continue;
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
  // 5b) Deck floodlights — the Echelon is a powered vessel, so her pad stays lit
  //     after dark instead of going black; the wash tracks how dark the sky's gone.
  //     Drawn before the rails/deckhouse so those still read crisply on top.
  if (night > 0.04) {
    const pc = proj(0, 0, F0 + 0.01);
    if (pc.z > ROOM_NEAR) {
      const fr = clampN(240 / pc.z, 60, 320);
      const fg = ctx.createRadialGradient(pc.sx, pc.sy, 1, pc.sx, pc.sy, fr);
      fg.addColorStop(0, `rgba(216,232,250,${0.34 * night})`); fg.addColorStop(1, 'rgba(216,232,250,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(pc.sx, pc.sy, fr, 0, 7); ctx.fill();
    }
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
function paintTurntable(ctx, { cls, armed = false, variant = '', livery, yaw = 0, w, h, wreck = false, zoom = 1, elev = 0.42, cam = null, floor = false, sky = null, venue = null }) {
  // `variant` is the ground-vehicle channel (THE LONG HAUL) — which of the four trucks, and
  // whether a box is on the back. Every aircraft caller passes nothing and is unaffected; the
  // depot's turntable, walkaround and bench hero shot all ride this one argument.
  const faces = wreck ? buildWreck() : aircraftFaces(cls, 1, armed, variant);
  // Taildraggers (the Grasshopper, and the Viper) rest NOSE-HIGH on the ground — tilt the static
  // model to its 3-point sit here too (the floor/room proj below is left untilted). Nose-up: f' = f·c − h·s.
  const _gp = groundPitchFor(cls, armed) * Math.PI / 180;
  const _cg = Math.cos(_gp), _sg = Math.sin(_gp);
  const tiltV = _gp ? (v) => [v[0] * _cg - v[2] * _sg, v[1], v[0] * _sg + v[2] * _cg] : null;
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
    if (visorHidden(face)) continue;       // parked on the turntable she sits nose-CLOSED, so the hold isn't there to punch through her belly
    const P = face.p.map(v => { const t = tiltV ? tiltV(v) : v; return proj(t[0], t[1], t[2]); });
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
    const avgZ = z / P.length;
    // WALK view: fade a face toward transparent as the eye gets right up against it, so the
    // hull goes see-through when you walk under/into her (otherwise the near fuselage fills the
    // frame and hides the BOARD prompt). Ghost floor keeps a faint outline rather than nothing.
    const alpha = cam ? clampN((avgZ - 0.25) / 0.9, 0.08, 1) : 1;
    const rec = { P, role: face.role, avgZ, alpha, col: shadeRgb(rgb, face.sh * pal.fmul * light * (wreck ? 0.8 : 1)) };
    if (jazzImg && JAZZ_ROLE.has(face.role)) rec.uv = face.p.map(v => jazzUV(v, face.role));
    if (face.uv) { rec.cuv = face.uv; rec.cart = face.art; }        // canopy art: UVs + style authored on the mesh, not derived
    drawn.push(rec);
  }
  drawn.sort((a, b) => b.avgZ - a.avgZ);
  ctx.lineJoin = 'round';
  for (const fc of drawn) {
    if (fc.alpha < 1) ctx.globalAlpha = fc.alpha;
    ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
    for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
    ctx.closePath();
    ctx.fillStyle = fc.col; ctx.fill();
    if (fc.uv) overlayJazz(ctx, fc.P, fc.uv, jazzImg);           // Memphis splatter, mapped in body space
    else if (TEXTURED.has(fc.role)) overlayHull(ctx, fc.P, texStr);   // procedural panel/rivet detail
    if (fc.cuv) drawCanopyGlass(ctx, fc.P, fc.cuv, fc.cart);          // greenhouse: mullions, sky reflection, the crew behind the glass
    if (!wreck && (fc.role === 'glass' || fc.role === 'window')) glassSheen(ctx, fc.P);   // glassy specular on canopy/windows
    ctx.strokeStyle = 'rgba(8,10,14,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    if (!wreck && livery?.finish === 'gloss' && fc.role === 'body') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy); ctx.lineTo(fc.P[1].sx, fc.P[1].sy); ctx.stroke(); ctx.restore();
    }
    if (fc.alpha < 1) ctx.globalAlpha = 1;
  }
  // Appendage faces (wings/nacelles/gear/…) become nose-art occluders so the decal is culled where
  // a nearer part of the airframe stands in front of the flank, instead of painting straight over it.
  if (!wreck) drawNoseArt(ctx, proj, cls, livery, drawn.filter(fc => OCCLUDE_ROLE.has(fc.role)).map(fc => ({ P: fc.P, z: fc.avgZ })));
  // Props/rotors — engines off in here, so crisp STOPPED blades (not a blur),
  // projected through this same camera so they spin with the turntable.
  if (!wreck) drawRotorFX(ctx, cls, (v) => { const t = tiltV ? tiltV(v) : v; const q = proj(t[0], t[1], t[2]); return q.z <= 0.2 ? null : q; }, { parked: true, spin: 2.3, armed });
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
  // The superstructure — a LONG, LOW, mirror-black deckhouse stepping up in set-back tiers across the
  // far deck edge, so the scene reads as sitting on a big beamy megayacht (her flight-sim profile), not
  // a single billboard block. Weighted left of centre so the parked craft stay clear of it.
  const ssL = w * 0.02, baseY = horizon + h * 0.015;
  const tierBox = (x0, x1, yTop, yBot) => {
    ctx.fillStyle = '#0f1116'; ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);                              // mirror-black body
    const band = (yBot - yTop) * 0.5;
    const gl = ctx.createLinearGradient(0, yTop + 2, 0, yTop + 2 + band);
    gl.addColorStop(0, 'rgba(60,84,110,0.85)'); gl.addColorStop(1, 'rgba(18,28,40,0.92)');
    ctx.fillStyle = gl; ctx.fillRect(x0 + 3, yTop + 2, (x1 - x0) - 6, band);                              // smoked-glass band
    ctx.strokeStyle = 'rgba(122,152,180,0.26)'; ctx.lineWidth = 1;
    for (let x = x0 + 9; x < x1 - 5; x += 12) { ctx.beginPath(); ctx.moveTo(x, yTop + 2); ctx.lineTo(x, yTop + 2 + band); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, yTop + 0.5, x1 - x0 - 1, yBot - yTop - 1);
  };
  const t1 = baseY - h * 0.10, t2 = t1 - h * 0.055, t3 = t2 - h * 0.05;
  tierBox(ssL,               w * 0.60, t1, baseY);   // main deck house — long & low base
  tierBox(ssL + w * 0.07,    w * 0.50, t2, t1);      // upper saloon, set back + in
  tierBox(ssL + w * 0.14,    w * 0.40, t3, t2);      // bridge deck, set back again
  // Short mast + warm masthead beacon off the bridge.
  const mx = ssL + w * 0.25, mtop = t3 - h * 0.05;
  ctx.strokeStyle = 'rgba(120,140,160,0.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(mx, t3); ctx.lineTo(mx, mtop); ctx.stroke();
  const mbg = ctx.createRadialGradient(mx, mtop, 1, mx, mtop, 8); mbg.addColorStop(0, 'rgba(255,238,200,0.8)'); mbg.addColorStop(1, 'rgba(255,238,200,0)');
  ctx.fillStyle = mbg; ctx.beginPath(); ctx.arc(mx, mtop, 8, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,244,214,0.95)'; ctx.beginPath(); ctx.arc(mx, mtop, 1.8, 0, 7); ctx.fill();
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
  // A soft pool of light where the craft sit — the Echelon's deck floods, so it
  // stays lit after dark rather than going black; the wash strengthens as the sky darkens.
  const floodA = 0.16 + pal.night * 0.26;
  const pool = ctx.createRadialGradient(cx, h * 0.82, 4, cx, h * 0.82, w * 0.5);
  pool.addColorStop(0, `rgba(222,234,248,${floodA})`); pool.addColorStop(1, 'rgba(222,234,248,0)');
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
  // A truck depot is a hangar with an oil stain on it: the same shed, lit sodium rather than
  // fluorescent, with the roller door open wider because the thing that lives in it drives out
  // rather than being towed. One tint and one door fraction, not a second backdrop painter.
  else drawHangarBackdrop(ctx, w, h, { doorFrac: Math.min(0.86, (venue === 'garage' ? 0.44 : 0.34) + n * 0.05),
    tint: venue === 'garage' ? 'rgba(58,40,20,0.30)' : undefined, sky });
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
    const faces = e.wreck ? buildWreck() : aircraftFaces(e.cls, 1, !!e.armed, e.variant || '');
    // Taildraggers (Grasshopper/Locust, and the Viper) park nose-high on the tailwheel — same
    // 3-point sit the turntable applies, so a craft looks identical on the floor and on the bench.
    const gpr = e.wreck ? 0 : groundPitchFor(e.cls, !!e.armed) * Math.PI / 180;
    const cgp = Math.cos(gpr), sgp = Math.sin(gpr);
    const tilt = gpr ? (v) => [v[0] * cgp - v[2] * sgp, v[1], v[0] * sgp + v[2] * cgp] : null;
    const pal = liveryPalette(e.livery || {});
    const jazzImg = (!e.wreck && pal.pat === 'jazz') ? jazzTex(e.livery?.base, e.livery?.trim, e.livery?.accent, e.livery?.ground) : null;
    const roll = e.wreck ? -0.22 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
    const selected = e.id === selId;
    const cen = proj(0, laneG, 0);   // this plane's own centre in normal-space (its lane, not the origin) — for backface culling
    const drawn = [];
    for (const face of faces) {
      if (face.role === 'rotor') continue;   // spinning surfaces drawn by drawRotorFX below
      if (visorHidden(face)) continue;       // showroom aeroplanes are buttoned up (see visorHidden)
      const P = face.p.map(v0 => {
        const v = tilt ? tilt(v0) : v0;
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
      if (face.uv) { rec.cuv = face.uv; rec.cart = face.art; }      // canopy art: UVs + style authored on the mesh
      drawn.push(rec);
    }
    const origin = proj(0.2, laneG, 0);
    hits.push({ id: e.id, sx: origin.sx, sy: origin.sy, r: Math.max(26, focal / origin.z * 0.55) });
    return { entry: e, faces: drawn.filter(Boolean), avgZ: proj(0, laneG, 0).z, laneG, origin, selected, sc, jazzImg, tilt };
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
      if (fc.cuv) drawCanopyGlass(ctx, fc.P, fc.cuv, fc.cart);  // greenhouse art (same authored map as the turntable)
      if (!grp.entry.wreck && (fc.role === 'glass' || fc.role === 'window')) glassSheen(ctx, fc.P);   // glassy specular on canopy/windows
      ctx.strokeStyle = 'rgba(8,10,14,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Parked craft: crisp stopped blades, angled differently lane to lane so the
    // row doesn't read as clones.
    if (!grp.entry.wreck) drawRotorFX(ctx, grp.entry.cls,
      (v0) => { const v = grp.tilt ? grp.tilt(v0) : v0; const q = proj(v[0] * grp.sc, grp.laneG + v[1] * grp.sc, v[2] * grp.sc); return q.z <= 0.15 ? null : q; },
      { parked: true, spin: 1.9 + grp.laneG * 0.6, armed: !!grp.entry.armed });
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
