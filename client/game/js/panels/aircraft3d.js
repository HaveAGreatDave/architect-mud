// AIRCRAFT-3D: the one source for what an aircraft looks like in 3D.
// One low-poly model per flight class, as faces in the craft frame (f = nose+, g = right+, h = up+),
// each with a role and a baked shade. windshield.js (PvP contacts) and hangar.js (turntable) both draw
// it through the livery helpers below, so the two views can't drift. Models are normalised to |f|<=1.15,
// wing tips at g=+-1, so windshield's per-class CONTACT_SIZE still fits.

const clampN = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const hex2rgb = (h) => { if (typeof h !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(h)) return null; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
import { FW_ROWS, TRUCK_ROWS, BOAT_ROWS } from '../../../shared/vehicle-models.js';
// Shared with interior-shell.js: a retuned beam, sill or roofline moves the room you sit in too. Never redeclare these here.
import { boatGeom } from '../../../shared/boat-house.js';
import { rasterFaces, blitRaster, depthAt, maskRaster, depthWinAt } from './model-raster.js';
import { boltBright } from '../../../shared/lightning.js';
import { paintBolt } from '../../../shared/lightning-draw.js';
// The same primitives compile the authored meshes (content/vehicle_models/mesh_*.json).
import {
  cross3, norm3, lerp3 as _lerp3, addTube, addStrut, pushWheel, addSpat, addFaired, pushPanel,
  pushCtrlSurface, addMissileBody, ceFoil, cubFoil, CP_TW as _CP_TW, CP_TH as _CP_TH,
  compileMesh, resolveRotors, wingTipStation, animFacePoints,
} from '../../../shared/vehicle-mesh.js';
import { MESH_ROWS } from '../../../shared/vehicle-meshes.js';
import { defaultLivery, aircraftLiveryModel } from '../../../shared/livery-sets.js';
// How far down the doorway a strike falls before it's behind the apron (drawInspectDoor's bolt reader).
const DOOR_BOLT_DROP = 0.66;
export const shadeRgb = (c, m) => `rgb(${clampN(c[0] * m, 0, 255) | 0},${clampN(c[1] * m, 0, 255) | 0},${clampN(c[2] * m, 0, 255) | 0})`;
const FINISH_MUL = { gloss: 1.06, satin: 1.0, matte: 0.88, weathered: 0.82 };

// ── Livery → colour ────────────────────────────────────────────────────────────
// Resolve a livery into a working palette (splinter camo drags the base toward drab),
// then answer per-face whether it wears the trim colour and what raw rgb it takes.
export function liveryPalette(lv, cls = null, armed = false) {
  const noLivery = !lv;
  lv = lv || {};
  // ⚠ An empty livery wears the model's default set, never grey.
  if (cls && (noLivery || (!lv.base && !lv.trim && !lv.pattern))) {
    const d = defaultLivery('aircraft', aircraftLiveryModel(cls, armed ? 1 : 0));
    if (d) lv = { ...d.exterior, ...lv };
  }
  // ⚠ An unpainted boat wears its row's paintBase/paintTrim. Only when nothing was chosen.
  if (cls && (noLivery || (!lv.base && !lv.trim && !lv.pattern))) {
    const bs = boatShape(cls);
    if (bs && bs.paintBase) lv = { base: bs.paintBase, trim: bs.paintTrim, glow: bs.paintGlow, finish: bs.paintFinish || 'gloss' };
  }
  let base = hex2rgb(lv.base) || [90, 95, 102];
  const trim = hex2rgb(lv.trim) || [138, 144, 153];
  const pat = lv.pattern || 'bare';
  if (pat === 'splinter') base = mix3(base, [60, 64, 44], 0.35);
  const ground = hex2rgb(lv.ground) || JAZZ_GROUND;   // jazz undercoat (the "cup paper" the splatter pops against)
  // A truck's colours are undefined on an aircraft so airframes take their old path (see faceBaseRgb on why not `accent`).
  const hw = hex2rgb(lv.hw) || null, deck = hex2rgb(lv.deck) || null;
  // Same footing: absent on aircraft. `chrome` 0 sends brightwork to the hardware colour (blacked-out rig).
  const bright = hex2rgb(lv.bright) || null, glow = hex2rgb(lv.glow) || null, glass = hex2rgb(lv.glass) || null;
  // `factory`: an authored mesh wears its own slot colours; anything else is a player's paint job.
  // ⚠ An empty object and the server's untouched LIVERY_DEFAULT (grey/grey/bare) both count as no livery.
  const stockGrey = (lv.base || '').toLowerCase() === '#5a5f66' && (lv.trim || '').toLowerCase() === '#8a9099'
    && (!lv.pattern || lv.pattern === 'bare');
  // ⚠ The Drake's 'bare' is her authored paint, so it leaves her slots alone.
  const drakeBare = cls === 'drake' && (!lv.pattern || lv.pattern === 'bare');
  const factory = noLivery || lv.pattern === 'factory' || (!lv.base && !lv.trim && !lv.pattern) || stockGrey || drakeBare;
  // `parts` maps a mesh paint slot name to a colour; a slot the mesh lacks is never read.
  let parts = null;
  if (lv.parts && typeof lv.parts === 'object') for (const [k, v] of Object.entries(lv.parts)) { const c = hex2rgb(v); if (c) (parts ||= {})[k] = c; }
  return { parts, base, trim, ground, hw, deck, bright, glow, glass, chrome: lv.chrome == null ? 1 : (lv.chrome ? 1 : 0),
    finish: lv.finish || 'satin', fmul: FINISH_MUL[lv.finish] ?? 1.0, pat, factory };
}
// A stored truck paint becomes a livery here (`flash` -> `truck:` pattern). Shared with the server, which needs it for contacts.
export { truckLivery } from '../../../shared/truck-livery.js';

// Structural accents that ALWAYS wear the trim colour, whatever the pattern.
// 'deck' is the boat's two-tone deck, on trim so the booth decides it.
const TRIM_ROLE = new Set(['fin', 'rudder', 'nacelle', 'rotor', 'deck']);
// Hull roles the exterior pattern paints across.
const PATTERN_ROLE = new Set(['body', 'wing', 'aileron', 'flap', 'stab', 'elevator']);
const STAB_ROLE = new Set(['stab', 'elevator']);
// Closed-hull roles safe to backface-cull. Thin or off-axis parts stay out: an outward-from-origin test fails on them.
const CULL_ROLE = new Set(['body', 'glass', 'window']);
// Near plane for models and decals: a decal and its panel must vanish together, so painters take it from the caller.
// windshield.js passes its own (different units).
export const MODEL_NEAR_Z = 0.15;
// Solid appendages that can stand IN FRONT of the fuselage flank and so should occlude nose art.
export const OCCLUDE_ROLE = new Set(['wing', 'aileron', 'flap', 'stab', 'elevator', 'fin', 'rudder', 'nacelle', 'gear', 'strut', 'gun']);
// Centroid of a facet in the craft frame [f = fore+, g = right+, h = up+].
function faceCentroid(pts) {
  let f = 0, g = 0, h = 0; for (const v of pts) { f += v[0]; g += v[1]; h += v[2]; }
  const n = pts.length || 1; return [f / n, g / n, h / n];
}
// Frame-stable hash for camo blotches. Never Math.random: the paint would shimmer.
function camoHash(a, b, c) { const x = Math.sin(a * 12.9898 + b * 4.1414 + c * 78.233) * 43758.5453; return x - Math.floor(x); }
// Procedural pattern: pick base or trim per facet from its position in the craft frame.
function faceWearsTrim(face, pat) {
  if (TRIM_ROLE.has(face.role)) return true;
  if (!PATTERN_ROLE.has(face.role)) return false;
  const [f, g, h] = faceCentroid(face.p);
  const top = h / (Math.hypot(g, h) || 1);            // +1 = dorsal spine, 0 = flank, -1 = belly
  // Truck flashes: aircraft patterns read `top` as a sign, but a truck stands on the ground (h in [0, 0.28]),
  // so trucks get their own branch under a `truck:` prefix (fleet `stripe` vs airframe `stripes`).
  if (pat.startsWith('truck:')) {
    if (!PATTERN_ROLE.has(face.role)) return false;
    const BELT = 0.135;                    // mid-height on a cab, where a signwriter would run it
    switch (pat.slice(6)) {
      case 'stripe': return Math.abs(h - BELT) < 0.026;                                  // one band, straight down the side
      case 'wave':   return Math.abs(h - (BELT + 0.045 * Math.sin(f * 15))) < 0.024;     // the same band, and it swims
      case 'fade':   return h < 0.10 + camoHash(Math.round(f * 22), 0, Math.round(h * 40)) * 0.075;   // trim low, dithering out as it climbs
      case 'candy':  return ((Math.floor(f * 11 - h * 3) % 2) + 2) % 2 === 0;            // raked bands, the whole length of it
      // ⚠ All in the truck frame, where h = 0 is the road. Anything reading `top` paints the rig one colour.
      // Scallop: two out-of-phase arches.
      case 'scallop': {
        const a = 0.5 + 0.5 * Math.sin(f * 9.5), b = 0.5 + 0.5 * Math.sin(f * 9.5 + 2.1);
        return h < 0.055 + a * 0.075 || (h > 0.175 && h < 0.185 + b * 0.05);
      }
      // Flames, frayed by the camo hash.
      case 'flame': {
        const t = Math.sin(f * 13 + h * 6) * 0.5 + 0.5;
        const lick = 0.045 + t * 0.10 + camoHash(Math.round(f * 16), 0, Math.round(h * 18)) * 0.035;
        return h < lick;
      }
      case 'split':  return h < BELT;                                                    // clean beltline: trim below, base above
      case 'pinstripe': return Math.abs(h - BELT) < 0.007 || Math.abs(h - (BELT - 0.026)) < 0.006;   // two thin lines, coachpainted
      case 'chevron': { const band = Math.floor((f * 7 - Math.abs(h - BELT) * 9)); return ((band % 2) + 2) % 2 === 0; }   // hazard arrows down the flank
      case 'checker': return (Math.floor(f * 12) + Math.floor(h * 12)) % 2 === 0;         // racing squares
      case 'roof':   return h > 0.205;                                                    // painted roof and fairing, cab left plain
      case 'lower':  return h < 0.075;                                                    // skirts, tanks and valance — the truck sits lower
      // Panel van: flank middle in a second colour.
      case 'panel':  return h > 0.070 && h < 0.190 && Math.abs(Math.sin(f * 3.1)) > 0.22;
      // Patina: hash only, because rust has no geometry.
      case 'rust':   return camoHash(Math.round(f * 13), Math.round(g * 9), Math.round(h * 15)) > 0.62;
      default:       return false;                                                        // 'none' — one colour, and that is a choice too
    }
  }
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
    // Warbird: camo top, pale belly, yellow cowl, rudder and outer-wing bands. Fin and rudder are already trim (TRIM_ROLE).
    case 'warbird': {
      if (face.role === 'body') return f > 0.66;                       // the cowl, forward of the windscreen
      if (face.role === 'wing' || face.role === 'aileron') return Math.abs(g) > 0.84;   // outboard identification band
      return false;
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
  // `pk` is a paint key buildTruck stamps by identity against its CHROME/GLOW consts. Absent on aircraft.
  if (face.pk === 'bright') return pal.chrome === 0 ? (pal.hw || [44, 48, 54]) : (pal.bright || face.tint || [226, 232, 240]);
  if (face.pk === 'glow') return pal.glow || face.tint || [96, 196, 214];
  // A hull bottom wears trim (stamped by buildBoat).
  if (face.pk === 'trim') return finishCoat(pal.trim, pal, face);
  // A fixed boat part keeps its literal colour; no livery or finish.
  if (face.fixed && face.tint) return face.tint;
  // Glass is scaled by GLASS_REF, so panes keep their relative darkness and the default is the identity.
  if (role === 'glass' && pal.glass) return tintPane(face.tint || GLASS_REF, pal.glass);
  if (role === 'glass' || role === 'window') return face.tint || [14, 26, 36];   // per-face tint override (e.g. the heli's clear fishbowl bubble)
  // Mesh-file paint slot. Factory shows the slot's colour; under a livery base/trim slots follow it and fixed keeps its own.
  // Above the hardware colours on purpose: a painted landing leg is painted.
  if (face.paint && typeof face.paint === 'object') {
    const s = face.paint;
    // A part painted by name beats everything.
    const own = pal.parts && pal.parts[s.name];
    if (own) return finishCoat(own, pal, face);
    if (pal.factory || s.livery === 'fixed') return finishCoat(s.rgb, pal, face);
    return finishCoat(s.livery === 'trim' ? pal.trim : pal.base, pal, face);
  }
  // Truck hardware (`hw`) and box (`deck`). ⚠ Not `pal.accent`: the jazz scheme owns that, and it would turn every undercarriage magenta.
  if (role === 'strut' || role === 'gear' || role === 'gun') return pal.hw || [44, 48, 54];
  if (role === 'interior') return [26, 28, 33];   // dark cargo-hold walls, livery-independent
  if (role === 'ramp') return [58, 61, 68];        // bare metal cargo ramp
  if (pal.pat === 'jazz' && JAZZ_ROLE.has(role)) return pal.ground || JAZZ_GROUND;   // chosen undercoat; overlayJazz paints the splatter on top
  // The flash runs over the box too.
  if (faceWearsTrim(face, pal.pat)) return finishCoat(pal.trim, pal, face);
  if (face.deck && pal.deck) return finishCoat(pal.deck, pal, face);
  // Warbird's belly and camo are derived from base, so the scheme needs no extra stored colours.
  if (pal.pat === 'warbird' && PATTERN_ROLE.has(role)) {
    const [f, g, h] = faceCentroid(face.p);
    if (h / (Math.hypot(g, h) || 1) < -0.15) return mix3(pal.base, [206, 214, 222], 0.68);   // the pale belly
    return camoHash(Math.round(f * 3.6), Math.round(g * 3.2), Math.round(h * 5)) > 0.52
      ? mix3(pal.base, [22, 30, 22], 0.45) : pal.base;                                       // the splinter break up top
  }
  return finishCoat(pal.base, pal, face);
}

// The pane every pane is authored as a shade of (the truck's door glass).
const GLASS_REF = [50, 74, 92];
const tintPane = (tint, glass) => [
  clampN(glass[0] * (tint[0] / GLASS_REF[0]), 0, 255),
  clampN(glass[1] * (tint[1] / GLASS_REF[1]), 0, 255),
  clampN(glass[2] * (tint[2] / GLASS_REF[2]), 0, 255),
];

// Finish coat. Lives in faceBaseRgb so all four renderers agree. Geometry-driven, never camera-driven:
// a per-frame colour would shimmer. Satin and unset return the colour untouched.
const finishSat = (c, k) => { const m = (c[0] + c[1] + c[2]) / 3; return [c[0] + (c[0] - m) * k, c[1] + (c[1] - m) * k, c[2] + (c[2] - m) * k]; };
function finishCoat(rgb, pal, face) {
  const fin = pal.finish;
  // Gloss is a highlight the renderers add, so it's untouched here.
  if (!fin || fin === 'satin' || fin === 'gloss') return rgb;
  const c = [rgb[0], rgb[1], rgb[2]];
  const [f, g, h] = faceCentroid(face.p || [[0, 0, 0]]);
  const up = h / (Math.hypot(g, h) || 1);            // +1 = pointing at the sky, 0 = a flank
  switch (fin) {
    // Flake: wider spread by facing plus a fine stable grain.
    case 'metallic': {
      const k = 1 + (up - 0.25) * 0.5 + (camoHash(Math.round(f * 40), Math.round(g * 40), Math.round(h * 40)) - 0.5) * 0.10;
      return finishSat([c[0] * k, c[1] * k, c[2] * k], 0.10);
    }
    // Pearl: shifts hue toward trim as the face turns away.
    case 'pearl':    return mix3(c, pal.trim || [230, 232, 238], 0.34 * (1 - Math.max(0, up)));
    // Candy: deep colour over a bright base. Saturated hard and darkened in the shadows, which is
    // Candy: saturated, darker in shadow.
    case 'candy':    return finishSat(c.map(v => v * (0.80 + Math.max(0, up) * 0.34)), 0.45);
    case 'matte':    return finishSat(c, -0.10);
    // Weathered: uneven on purpose.
    case 'weathered': {
      const w = 0.18 + camoHash(Math.round(f * 7), Math.round(g * 6), Math.round(h * 7)) * 0.22;
      return finishSat(mix3(c, [178, 176, 168], w), -0.28);
    }
    // Primer: flat and chalky.
    case 'primer':   return finishSat(mix3(c, [122, 124, 128], 0.62), -0.55);
    default:         return rgb;
  }
}

// ── Geometry ────────────────────────────────────────────────────────────────────
const V = (f, g, h) => [f, g, h];

// Parametric fixed-wing: fuselage, swept wings with dihedral, tail, fins, nacelles, canopy, plus
// class parts (struts, gear, spinners, nose gun, pylons) for each silhouette.
function buildFixedWing(p, detail = 1) {
  const faces = [];
  // Fuselage: N-gon rings at stations nose to tail, skinned with quads. detail 0 is a 4-sided bipyramid for LOD.
  // `p.sides` raises ring resolution for round hulls.
  const sides = detail ? (p.sides || 12) : 4;
  // `p.extraF` adds stations so glazing (p.glaze) starts and stops on a real seam. Near-duplicates are dropped.
  let stations = detail
    ? [p.noseF, p.noseF * 0.66, p.noseF * 0.33, 0, p.tailF * 0.35, p.tailF * 0.7, p.tailF]
    : [p.noseF, 0, p.tailF];
  if (detail && p.extraF) {
    // An inserted ring evicts a nearby default one, except the tips: they set the length.
    const keep = stations.filter(f => f === p.noseF || f === p.tailF || !p.extraF.some(e => Math.abs(e - f) < 0.03));
    stations = [...keep, ...p.extraF].sort((a, b) => b - a);
  }
  // Radius profile 1 (mid) to 0 (tips). `bodyTube` holds full width across the middle; the nose rounds as a superellipse.
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0;
  // Centreline height. The nose droop is spent over the tapering snout only, so the cabin roof stays level.
  // `noseDroopK` < 1 puts most of the drop at the break (a windscreen rake).
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
    // p.noseCowl floors the nose radius so it ends in a blunt (capped) face.
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  // p.noseVTaper shrinks height faster than width through the nose (Twin Otter wedge) while keeping the keel up.
  // `noseVFloor` stops it short of zero for a round radome (An-124).
  const vFloor = p.noseVFloor || 0;
  const radVAt = (f) => {
    const rH = radAt(f);
    if (!(detail && p.noseVTaper && f > 0)) return rH;
    const u = Math.min(1, f / p.noseF);
    const t = u <= tube ? 0 : (u - tube) / (1 - tube);
    return rH * (vFloor + (1 - vFloor) * Math.pow(1 - t, p.noseVTaper));
  };
  // p.boxy morphs the ellipse toward a rounded rectangle. A 4-sided LOD ring is unaffected.
  const shapeExp = 1 - (p.boxy || 0) * 0.55;
  // p.hump: raised-cosine crown swelling (flight-deck bulge). Part of `ring` because the flight-deck glass rides it.
  const humpAt = (f) => {
    const Hp = p.hump;
    if (!detail || !Hp || f <= Hp.f0 || f >= Hp.f1) return 0;
    return Hp.h * 0.5 * (1 - Math.cos(2 * Math.PI * (f - Hp.f0) / (Hp.f1 - Hp.f0)));
  };
  // p.bellyFlat: blends the lower section toward a flat pan with a hard chine. Needs ~24 sides to read.
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
  // p.glaze: listed upper facets between f0 (windscreen) and f1 (bulkhead) are the glass, flush with the hull.
  // UV: U runs f0 to f1, V runs starboard over the crown to port, in the shared canopy texture space.
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
      // The windscreen bay (forward of wsF) wraps higher than the side windows.
      const gks = (GZ && GZ.wsKs && fA >= GZ.wsF - 1e-6) ? GZ.wsKs : (GZ ? GZ.ks : null);
      if (inGlaze && gks.includes(k)) {
        faces.push({ role: 'glass', sh, art: GZ.art, p: [A[k], A[k2], B[k2], B[k]],
          uv: [[gzU(fA), gzV(k)], [gzU(fA), gzV(k2)], [gzU(fB), gzV(k2)], [gzU(fB), gzV(k)]] });
        continue;
      }
      faces.push({ role: 'body', sh, p: [A[k], A[k2], B[k2], B[k]] });
    }
  }
  // Cap the blunt cowl.
  if (detail && (p.noseCowl || 0) > 0.01) faces.push({ role: 'body', sh: 0.9, p: ring(stations[0]) });
  const wH = p.wingH || 0;   // wing vertical set: high (+) rides the fuselage top, low (−) the belly
  // Wings, with real thickness at full detail.
  for (const s of [1, -1]) {
    // A gull wing is two panels meeting at the knee.
    const segs = p.gull ? [[0, p.gull.at], [p.gull.at, 1]] : [[0, 1]];
    for (const [u0, u1] of segs) {
      pushPanel(faces, 'wing', 0.82, [
        wingPt(p, wH, s, u0, 'le'), wingPt(p, wH, s, u1, 'le'),
        wingPt(p, wH, s, u1, 'te'), wingPt(p, wH, s, u0, 'te')], 0.028, detail);
    }
    if (detail) addWingSurfaces(faces, p, s, wH);   // hinged flap + aileron on the trailing edge (full mesh only)
  }
  // Dive brakes ride the flap channel (`defl: 'flap'`), so they need no new input.
  if (detail && p.diveBrakes) {
    const db = p.diveBrakes;
    for (const s of [1, -1]) {
      const A = wingPt(p, wH, s, db.u0, 'le'), B = wingPt(p, wH, s, db.u1, 'le');
      const drop = db.drop || 0.05, aft = db.aft || 0.06;
      const H0 = [A[0] - aft, A[1], A[2] - 0.012], H1 = [B[0] - aft, B[1], B[2] - 0.012];
      const T0 = [H0[0] - drop, H0[1], H0[2]], T1 = [H1[0] - drop, H1[1], H1[2]];
      faces.push({ role: 'strut', defl: 'flap', side: s, sh: s > 0 ? 0.58 : 0.44,
        hinge: [H0, H1], p: s > 0 ? [H0, H1, T1, T0] : [T0, T1, H1, H0] });
    }
  }
  // Lift strut: one slim member from the lower longeron to mid-span.
  if (p.struts) {
    const sw = 0.022;                         // strut half-chord (fore-aft) — a slim member
    for (const s of [1, -1]) {
      const bx = 0.05, tx = 0.09;             // f at the fuselage / wing attach (slight forward rake)
      faces.push({ role: 'strut', sh: 0.62, p: [
        V(bx + sw, s * p.fr * 0.95, -p.fv * 0.55), V(tx + sw, s * p.span * 0.5, wH - 0.02),
        V(tx - sw, s * p.span * 0.5, wH - 0.02), V(bx - sw, s * p.fr * 0.95, -p.fv * 0.55)] });
    }
  }
  // Chin scoop: a shallow box under the nose, tapering aft.
  if (detail && p.chinScoop) {
    const C = p.chinScoop, zTop = -p.fv * 0.72, zBot = zTop - C.h;
    const w0 = C.w, w1 = C.w * 0.72;
    const A = [V(C.f0, w0, zTop), V(C.f0, -w0, zTop), V(C.f1, -w1, zTop), V(C.f1, w1, zTop)];
    const B = [V(C.f0, w0, zBot), V(C.f0, -w0, zBot), V(C.f1, -w1, zBot), V(C.f1, w1, zBot)];
    faces.push({ role: 'nacelle', sh: 0.5, p: B });                                        // underside
    faces.push({ role: 'gun', sh: 0.3, p: [A[0], A[1], B[1], B[0]] });                      // the dark intake mouth
    for (const [i, j] of [[1, 2], [2, 3], [3, 0]]) faces.push({ role: 'nacelle', sh: i === 2 ? 0.44 : 0.62, p: [A[i], A[j], B[j], B[i]] });
  }
  for (const s of [1, -1]) {
    pushPanel(faces, 'stab', 0.72, [
      V(p.hF, s * p.fr * 0.5, 0.04), V(p.hTipF, s * p.hSpan, 0.05),
      V(p.hTipB, s * p.hSpan, 0.05), V(p.hB, s * p.fr * 0.5, 0.04)], 0.02, detail);
    if (detail) addStabSurface(faces, p, s);   // hinged elevator on the tailplane (full mesh only)
  }
  // Braced tailplane: a strut each side from the stab to the fin.
  if (detail && p.stabStruts) {
    const sw = 0.016, mid = p.hSpan * 0.62;
    const fMid = p.hF + (p.hTipF - p.hF) * 0.62;
    for (const s of [1, -1]) {
      faces.push({ role: 'strut', sh: 0.6, p: [
        V(fMid + sw, s * mid, 0.05), V(p.finF0 - 0.06 + sw, s * 0.012, p.finH * 0.52),
        V(p.finF0 - 0.06 - sw, s * 0.012, p.finH * 0.52), V(fMid - sw, s * mid, 0.05)] });
    }
  }
  for (const fg of (p.fins || [0])) {
    faces.push({ role: 'fin', sh: 0.9, p: [V(p.finF0, fg, 0.05), V(p.finF1, fg, p.finH), V(p.finF2, fg, 0.06)] });
    if (detail) addFinSurface(faces, p, fg);   // hinged rudder on the fin trailing edge (full mesh only)
  }
  // Dorsal fillet along the spine into the fin, following the real crown line.
  if (detail && p.dorsal != null) {
    const crownAt = (f) => czAt(f) + p.fv * radAt(f);
    const kneeH = 0.05 + (p.finH - 0.05) * 0.34;                       // where it merges into the fin LE
    const kneeF = p.finF0 + (p.finF1 - p.finF0) * 0.34;
    faces.push({ role: 'fin', sh: 0.84, p: [
      V(p.dorsal, 0, crownAt(p.dorsal)), V(kneeF, 0, kneeH), V(p.finF0, 0, crownAt(p.finF0))] });
  }
  // Nacelles: underwing tubes from `engines`, or rear pods from `podEngines` [f,g,h].
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
  // Nose prop. `p.spinner` sizes it. ⚠ It sits at noseZ, where the drooped nose actually ends.
  if (p.prop === 'nose') addSpinner(faces, p.noseF, 0, p.noseZ ?? 0.02, p.spinner ?? 0.5);
  if (p.stores) addStores(faces, p);   // what she is carrying, on the racks she carries it on
  // Exhaust stacks out of the cowl flanks.
  if (detail && p.exhaust) {
    const E = p.exhaust;
    for (const s of [1, -1]) for (const df of (E.at || [0])) {
      const f = E.f + df, g = s * (p.fr * (E.g ?? 0.86)), z = E.z ?? -0.01;
      addTube(faces, V(f, g, z), V(f - 0.06, g + s * 0.022, z - 0.012), E.r ?? 0.013, 'gun', 0.34, 6);
    }
  }
  // Spray rig: boom on drop struts under the trailing edge, nozzles, tip vortex fairings.
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
      // Wingtip vortex fairing.
      faces.push({ role: 'nacelle', sh: 0.7, p: [
        V(p.wTipF, s * p.span, wH + p.dih), V(p.wTipF - 0.02, s * p.span, wH + p.dih - 0.075),
        V(bf, s * p.span, wH + p.dih - 0.075), V(p.wTipB, s * p.span, wH + p.dih)] });
    }
  }
  // Under-wing cannon pods on short pylons.
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
  // Landing gear.
  if (p.heavyGear) addHeavyGear(faces, p);
  else if (p.gearPods) {
    // A-10 gear pods plus a stout nose leg.
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
  // Canopy: upper-half elliptical rings fore to aft, sunk a touch into the hull. Skipped on coarse LOD.
  if (detail && p.canopy) {
    const cp = p.canopy, segs = cp.segs || 5, arc = cp.arc || 3;
    const crown = (f) => czAt(f) + p.fv * radAt(f) - (cp.sink ?? 0.015);   // fuselage top at station f, sunk a touch
    // Height profile: raked windscreen (cp.front), full middle, faired tail (cp.tail).
    const prof = (t) => Math.sin(Math.PI * ((cp.front ?? 0.12) + (1 - (cp.front ?? 0.12) - (cp.tail ?? 0.04)) * t));
    const ringAt = (t) => {
      const f = cp.f0 + (cp.f1 - cp.f0) * t, s = prof(t), z0 = crown(f), out = [];
      for (let k = 0; k <= arc; k++) { const a = Math.PI * k / arc; out.push(V(f, Math.cos(a) * cp.w * s, z0 + Math.sin(a) * cp.h * s)); }
      return out;   // k: 0 = starboard base → over the crown → arc = port base
    };
    // cp.art: segment index runs U, arc index runs V, on the shared canopy texture.
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
    // Cap the fore and aft rings. A cap gets a narrow slab of the texture edge. drawCanopyGlass takes only 3 or 4
    // points, so a finer arc fans from the centre into triangles.
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
  // ── Cargo visor group (Leviathan) ──
  // Faces forward of the cut swing up about a crown line. Rings don't share vertices, so the seam opens cleanly.
  // The main gear stays planted.
  if (detail && p.visor) {
    // ⚠ Snap the cut to a real station: an authored fraction lands a hair off and the inequality drops the seam bay.
    const rawCut = p.noseF * (p.visor.hingeAt ?? 0.33);
    const cut = stations.reduce((b, s) => Math.abs(s - rawCut) < Math.abs(b - rawCut) ? s : b, stations[0]);
    // radVAt, or the hinge floats above a nose that sheds height.
    const crownZ = czAt(cut) + p.fv * radVAt(cut) + humpAt(cut);   // top of the fuselage at the cut station — hump included, or the hinge floats above a crown that's risen out from under it
    const A = V(cut, p.fr, crownZ), B = V(cut, -p.fr, crownZ); // hinge axis: a lateral line across the crown
    const LIFT = new Set(['body', 'glass', 'window']);         // skin + flight-deck glass lift with the nose
    // Hinge knuckle: two brackets on the body so the nose visibly pivots on something.
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
      // The nose leg lifts only if it's mounted forward of the cut, or it pivots off into mid-air.
      const gearF = f.role === 'gear' ? f.p.reduce((a, v) => a + v[0], 0) / f.p.length : -Infinity;
      const isNoseGear = gearF > noseGearF && gearF >= cut - 1e-6;
      if ((LIFT.has(f.role) && fwd) || isNoseGear) { f.visor = true; f.visorHinge = [A, B]; f.visorMax = p.visor.maxAng ?? 0.9; }
    }
    // Cargo hold seen through the raised visor.
    const bF0 = cut, bF1 = -0.06;                              // opening plane → rear bulkhead
    const bw = p.fr * 0.66, bt = p.fv * 0.60, bb = -p.fv * 0.55;   // half-width, ceiling z, floor z (inset from the skin)
    faces.push({ role: 'interior', sh: 0.30, p: [V(bF1, -bw, bb), V(bF1, bw, bb), V(bF0, bw, bb), V(bF0, -bw, bb)] });   // floor
    faces.push({ role: 'interior', sh: 0.20, p: [V(bF0, -bw, bt), V(bF0, bw, bt), V(bF1, bw, bt), V(bF1, -bw, bt)] });   // ceiling
    faces.push({ role: 'interior', sh: 0.26, p: [V(bF1, bw, bb), V(bF1, bw, bt), V(bF0, bw, bt), V(bF0, bw, bb)] });     // starboard wall
    faces.push({ role: 'interior', sh: 0.26, p: [V(bF0, -bw, bb), V(bF0, -bw, bt), V(bF1, -bw, bt), V(bF1, -bw, bb)] }); // port wall
    faces.push({ role: 'interior', sh: 0.36, p: [V(bF1, -bw, bb), V(bF1, -bw, bt), V(bF1, bw, bt), V(bF1, bw, bb)] });   // rear bulkhead
    // Cargo ramp hinged at the lower lip: authored deployed, pre-rotated up into the hold; the visor swing lowers it.
    const lipZ = czAt(cut) - p.fv * radVAt(cut);              // fuselage bottom at the cut station
    const rw = bw * 0.94, rampAng = 2.9;
    const hA = V(cut, rw, lipZ), hB = V(cut, -rw, lipZ);
    // The toe sits on the gear's ground plane. Parts are fractions of the lip-to-toe axis so the slide can't overshoot.
    const footF = cut + (p.visor.ramp ?? 0.62), footZ = -(p.fv + 0.07);
    // Deployed frame: `d` down the ramp, `n` its normal. Details are placed in it, then stowed, so they stay on the plate.
    const dF = footF - cut, dZ = footZ - lipZ, dL = Math.hypot(dF, dZ) || 1;
    const d = [dF / dL, 0, dZ / dL], n = [-dZ / dL, 0, dF / dL];
    const at = (u, gg, lift = 0) => V(cut + d[0] * dL * u + n[0] * lift, gg, lipZ + d[2] * dL * u + n[2] * lift);
    const stow = (pts) => rotAboutAxis(pts, hA, hB, rampAng);
    const push = (sh, pts, slide) => {
      const f = { role: 'ramp', sh, p: stow(pts), visor: true, visorHinge: [hA, hB], visorMax: -rampAng };
      if (slide) f.slide = slide;
      faces.push(f);
    };
    // Fixed plate, lip to MID; the slide carries the rest to the toe.
    const MID = 0.58;
    push(0.72, [at(0, -rw), at(0, rw), at(MID, rw), at(MID, -rw)]);
    push(0.44, [at(MID, -rw, -0.012), at(MID, rw, -0.012), at(0, rw, -0.012), at(0, -rw, -0.012)]);
    // Side rails.
    for (const s of [1, -1]) {
      const gg = s * rw;
      push(0.60, [at(0, gg), at(MID, gg), at(MID, gg, 0.022), at(0, gg, 0.022)]);
      push(0.84, [at(0, gg, 0.022), at(MID, gg, 0.022), at(MID, gg - s * 0.014, 0.022), at(0, gg - s * 0.014, 0.022)]);   // rail top
    }
    // Traction ribs.
    for (let i = 1; i <= 4; i++) {
      const u = MID * (i / 5), w = 0.012;
      push(0.90, [at(u - w, -rw * 0.93, 0.005), at(u - w, rw * 0.93, 0.005), at(u + w, rw * 0.93, 0.005), at(u + w, -rw * 0.93, 0.005)]);
    }
    // Telescoping extension, nested under the plate and slid out by `slide` on a delayed curve (see slideEase).
    // It's authored EXT + LAP long so it stays lapped at full extension; shorter opens a hole mid-ramp.
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

// pushPanel and pushCtrlSurface live in client/shared/vehicle-mesh.js.
// ── Control surfaces ──
// Surfaces carry a hinge line, `defl` and `side`; the cached geometry stays neutral and renderers deflect
// a copy per frame with deflectSurface(). Only the pilot's own chase view passes input.

// A point on one wing at span fraction u and edge 'le'/'te'. Everything that needs the wing's shape goes through here.
// `p.gull` = { at, drop, rise } cranks it: inner panel falls by `drop`, outer rises by `rise` (inverted gull).
function wingPt(p, wH, s, u, edge) {
  const g0 = p.fr * 0.7, g1 = p.span;
  const f = edge === 'le' ? p.wRootF + (p.wTipF - p.wRootF) * u : p.wRootB + (p.wTipB - p.wRootB) * u;
  const z0 = wH - 0.01;
  let z;
  if (!p.gull) z = z0 + ((wH + p.dih) - z0) * u;
  else {
    const k = p.gull.at, zk = z0 + p.gull.drop;
    z = u <= k ? z0 + (zk - z0) * (u / k) : zk + p.gull.rise * ((u - k) / (1 - k));
  }
  return V(f, s * (g0 + (g1 - g0) * u), z);
}

// Flap (inboard) and aileron (outboard). On a cranked wing they meet at the knee: a surface across the crank would tear out.
function addWingSurfaces(faces, p, s, wH) {
  const le = (u) => wingPt(p, wH, s, u, 'le'), te = (u) => wingPt(p, wH, s, u, 'te');
  const k = p.gull ? p.gull.at : 0.50;
  const fl0 = 0.06, fl1 = k - 0.04, ai0 = k + 0.04, ai1 = 0.95;
  pushCtrlSurface(faces, 'flap', s, 0.8, le(fl0), le(fl1), te(fl0), te(fl1), 0.28);      // inboard flap
  pushCtrlSurface(faces, 'aileron', s, 0.82, le(ai0), le(ai1), te(ai0), te(ai1), 0.28);  // outboard aileron
}

// Elevator on one tailplane half.
function addStabSurface(faces, p, s) {
  const rootLE = V(p.hF, s * p.fr * 0.5, 0.04), tipLE = V(p.hTipF, s * p.hSpan, 0.05);
  const tipTE = V(p.hTipB, s * p.hSpan, 0.05), rootTE = V(p.hB, s * p.fr * 0.5, 0.04);
  const le = (u) => _lerp3(rootLE, tipLE, u), te = (u) => _lerp3(rootTE, tipTE, u);
  pushCtrlSurface(faces, 'elevator', s, 0.72, le(0.06), le(0.95), te(0.06), te(0.95), 0.34, 'z', 0.010);   // tailplane is thinner than the wing (0.02) — match it or the elevator floats off the surface
}

// Rudder: the fin's aft strip, hinged forward of the trailing edge by `cf` of the base chord; swings in g.
function addFinSurface(faces, p, fg) {
  const cf = 0.4, df = cf * (p.finF0 - p.finF2);                        // forward hinge offset from the TE
  // Two-sided, straddling the fin: a coplanar rudder made the depth sort strobe.
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

// Deflect a control surface for live input, returning a fresh copy. `ctrl` values in -1..1 (flaps 0..1).
// Hinge axes point outboard, so ailerons share a sign (roll), flaps use -side, elevators +side.
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

// Rodrigues rotation about A to B. Returns a fresh array.
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

export function visorSpecFor(cls) { return (fwParams(cls) || {}).visor || null; }

// Faces seen only through an open cargo mouth (hold, ramp, `visorOnly` brackets). Shut, they're skipped:
// the centroid depth sort would let the long hold floor punch through the skin.
// A renderer with no visor passes t=0 and gets the craft buttoned up. A mesh face can name its own channel
// with `when`/`whenNot` (the Drake's saloon), read from `ch`.
export function visorHidden(face, t = 0, ch = null) {
  if (face.whenNot && (ch?.[face.whenNot] ?? 0) > 0.001) return true;
  if (face.when) return !((ch?.[face.when] ?? 0) > 0.001);
  return (face.visorOnly || face.role === 'interior' || face.role === 'ramp') && !(t > 0.001);
}

// Swing a visor face up by `t` (0 closed, 1 raised). Telescoping parts wait for SLIDE_T0 then ease out,
// so the nose finishes before the ramp extends.
const SLIDE_T0 = 0.58;
export function slideEase(t) {
  const u = t <= SLIDE_T0 ? 0 : Math.min(1, (t - SLIDE_T0) / (1 - SLIDE_T0));
  return u * u * (3 - 2 * u);
}
export function hingeVisorFace(face, t) {
  if (!face.visorHinge || !t) return face.p;
  const pts = rotAboutAxis(face.p, face.visorHinge[0], face.visorHinge[1], (face.visorMax || 0.9) * t);
  if (!face.slide) return pts;
  // Translate after the rotation, along the ramp's deployed axis.
  const e = slideEase(t);
  if (!e) return pts;
  return pts.map(q => [q[0] + face.slide[0] * e, q[1] + face.slide[1] * e, q[2] + face.slide[2] * e]);
}

// Spinner cone and hub. The spinning disc is drawn by each renderer's FX layer from PROP_STATIONS.
function addSpinner(faces, f, g, h, scale = 1) {
  const apex = V(f + 0.14 * scale, g, h), r = 0.045 * scale;
  const ring = [V(f, g + r, h + r), V(f, g - r, h + r), V(f, g - r, h - r), V(f, g + r, h - r)];
  for (let i = 0; i < 4; i++) faces.push({ role: 'nacelle', sh: 0.95 - i * 0.06, p: [apex, ring[i], ring[(i + 1) % 4]] });
}

// An-124 centipede gear: tandem bogies down each side, low to the belly, plus a twin nose unit.
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
  // Nose unit. `noseGearAt` puts it forward of the visor cut so it rides with the nose.
  // Its smaller wheels' axle is set so their bottoms land on the mains' ground line.
  const nf = p.noseF * (p.noseGearAt ?? 0.55), nWr = wr * 0.85, nz = (wz - wr) + nWr;
  addStrut(faces, nf, 0, nz + 0.10, nz + 0.045, 0.018, 6);
  pushWheel(faces, nf + 0.045, 0, nz, nWr, 0.018, 8);   // twin nose unit
  pushWheel(faces, nf - 0.045, 0, nz, nWr, 0.018, 8);
}

// One fixed gear leg and a wheel rolling fore-aft, with hub caps. `scale` fattens it.
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

// A-10 main gear: livery-coloured fairing pod ('nacelle'), oleo strut, scissor link, fork and tyre (dark 'gear').
function addGearPod(faces, f, g, wz) {
  const podTop = 0.02, podBot = wz + 0.08;
  const cz = (podTop + podBot) / 2, hh = (podBot - podTop) / 2, pw = 0.055;   // vertical centre + half-height + half-width
  const rear = f - 0.13, midF = f + 0.10, nose = f + 0.17;
  const RN = 8;   // octagonal cross-section — 8 side facets read as a rounded fairing
  const ring = (x, s) => {
    const r = [];
    for (let i = 0; i < RN; i++) { const a = (i + 0.5) / RN * Math.PI * 2; r.push(V(x, g + Math.cos(a) * pw * s, cz + Math.sin(a) * hh * s)); }
    return r;
  };
  const rRear = ring(rear, 1), rMid = ring(midF, 1), rNose = ring(nose, 0.32);
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
  // Scissor / torque link, a shallow forward 'V' off the front of the strut.
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

// Shared gear primitives (addTube, addStrut, pushWheel, addSpat) live in client/shared/vehicle-mesh.js.

// ── Ordnance on the racks ──
// ⚠ This mesh is memoised per (class, detail, armed, variant), so it always draws the full rack; the pips
// show the live count. `p.stores` = [[f, g, h, length, radius], ...]; centreline stores get a crutch.
function addStores(faces, p) {
  for (const [sf, sg, sh, len, rad] of p.stores) {
    const nose = V(sf + len * 0.52, sg, sh), tail = V(sf - len * 0.48, sg, sh);
    addTube(faces, V(sf + len * 0.30, sg, sh), V(sf - len * 0.30, sg, sh), rad, 'gun', 0.62, 8);
    for (const [end, at, shd] of [[nose, sf + len * 0.30, 0.78], [tail, sf - len * 0.30, 0.5]]) {
      for (let i = 0; i < 8; i++) {
        const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2, r = end === tail ? rad * 0.62 : rad;
        faces.push({ role: 'gun', sh: shd, p: [end,
          V(at, sg + Math.cos(a0) * r, sh + Math.sin(a0) * r), V(at, sg + Math.cos(a1) * r, sh + Math.sin(a1) * r)] });
      }
    }
    const fin = rad * 2.1, f0 = sf - len * 0.20, f1 = sf - len * 0.46;
    for (const [dg, dh] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      faces.push({ role: 'gun', sh: 0.7, p: [
        V(f0, sg + dg * rad * 0.4, sh + dh * rad * 0.4), V(f0, sg + dg * fin, sh + dh * fin),
        V(f1, sg + dg * fin, sh + dh * fin), V(f1, sg + dg * rad * 0.4, sh + dh * rad * 0.4)] });
    }
    if (Math.abs(sg) < 0.02) for (const df of [len * 0.22, -len * 0.16]) {   // the crutch, centreline only
      addTube(faces, V(sf + df, 0, sh + rad), V(sf + df * 0.6, 0, -p.fv * 0.92), 0.008, 'strut', 0.6, 4);
    }
  }
}

// Cessna 172 gear: splayed leaf-spring mains and a spatted nose oleo.
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

// Taildragger gear. `p.tundra` gives fat bare bush tyres. The tailwheel is coplanar with the mains at
// `groundPitch`, so she sits nose-high and the tail lifts on the roll.
function addTaildraggerGear(faces, p, wz) {
  const tundra = !!p.tundra, ag = !!p.gearAg;
  // Three sizes: bush (tundra), ag (wide track, big spats) and the plain leaf spring.
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
  const tf = p.tailF * 0.82;
  const gp = (p.groundPitch || 0) * Math.PI / 180;
  const tz = wz - rMain + rTail + (mf - tf) * Math.sin(gp);
  addStrut(faces, tf, 0, Math.max(0.0, tz + rTail + 0.06), tz + rTail, 0.011, 5);
  pushWheel(faces, tf, 0, tz, rTail, 0.010, 8);
}

// Twin Otter gear: stout oleo legs, fat tyres, chunky nose oleo.
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

// Light helicopter (Mini 500). FX anchors are fixed: main rotor at (0.1, 0, 0.34), tail rotor at
// (-1.04, 0.07, 0.12); see drawRotorFX.
function buildHeli() {
  const faces = [];
  const sides = 14;   // ring resolution (was 8) — smooth bubble & boom
  const ring = (f, rg, rv, cz) => { const o = []; for (let k = 0; k < sides; k++) { const a = k / sides * Math.PI * 2; o.push(V(f, Math.cos(a) * rg, cz + Math.sin(a) * rv)); } return o; };
  const shFor = (k) => 0.6 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright → bottom dark
  const GLASS_TINT = [64, 90, 112];   // clear fishbowl bubble — lighter than the default near-black canopy so it reads as glass over a bright cockpit, not a dark orb
  const skin = (A, B, role = 'body', m = 1) => { for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; const f = { role, sh: shFor(k) * m, p: [A[k], A[k2], B[k2], B[k]] }; if (role === 'glass') f.tint = GLASS_TINT; faces.push(f); } };
  // Egg cabin, glass bubble front, tapering to the boom.
  const cabin = [
    ring(0.60, 0.105, 0.115, 0.02),   // front of the bubble (nose dome caps it below)
    ring(0.46, 0.165, 0.180, 0.015),  // bubble swelling out
    ring(0.30, 0.205, 0.215, 0.015),  // widest — canopy/seats
    ring(0.10, 0.210, 0.215, 0.025),  // cabin waist
    ring(-0.06, 0.170, 0.185, 0.045), // engine bay shoulders
    ring(-0.16, 0.110, 0.120, 0.050),
    ring(-0.24, 0.062, 0.070, 0.052), // boom junction
  ];
  for (let i = 0; i < cabin.length - 1; i++) skin(cabin[i], cabin[i + 1], i < 2 ? 'glass' : 'body', i < 2 ? 1 : 1);
  // Nose dome: a glass fan to an apex.
  const noseApex = V(0.70, 0, 0.03);
  for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; faces.push({ role: 'glass', tint: GLASS_TINT, sh: shFor(k), p: [noseApex, cabin[0][k], cabin[0][k2]] }); }
  // Canopy framing so the bubble reads as a framed cockpit: centre post, door arches, sill hoops.
  const post = [noseApex, V(0.60, 0, 0.135), V(0.46, 0, 0.195), V(0.30, 0, 0.230)];   // centre spine over the top
  for (let i = 0; i < post.length - 1; i++) addTube(faces, post[i], post[i + 1], 0.010, 'nacelle', 0.9, 5);
  for (const s of [1, -1]) {   // a door-frame arch each side, over the top and down to the sill
    const arch = [V(0.30, s * 0.185, 0.020), V(0.34, s * 0.150, 0.150), V(0.32, s * 0.075, 0.220), V(0.30, 0, 0.230)];
    for (let i = 0; i < arch.length - 1; i++) addTube(faces, arch[i], arch[i + 1], 0.009, 'nacelle', 0.85, 5);
    addTube(faces, V(0.58, s * 0.100, 0.010), V(0.44, s * 0.160, 0.010), 0.009, 'nacelle', 0.7, 5);
    addTube(faces, V(0.44, s * 0.160, 0.010), V(0.30, s * 0.190, 0.015), 0.009, 'nacelle', 0.7, 5);
  }
  const boom = [ring(-0.24, 0.058, 0.066, 0.052), ring(-0.50, 0.044, 0.048, 0.078), ring(-0.76, 0.034, 0.036, 0.100), ring(-1.00, 0.026, 0.028, 0.118)];
  for (let i = 0; i < boom.length - 1; i++) skin(boom[i], boom[i + 1], 'body', 0.92);
  const finT = 0.014, fin = [V(-0.86, 0, 0.13), V(-0.99, 0, 0.30), V(-1.10, 0, 0.40), V(-1.10, 0, 0.11)];
  for (const s of [1, -1]) { const p = fin.map(v => V(v[0], s * finT, v[2])); faces.push({ role: 'fin', sh: s > 0 ? 0.92 : 0.72, p }); }
  faces.push({ role: 'fin', sh: 0.8, p: [V(-0.99, finT, 0.30), V(-1.10, finT, 0.40), V(-1.10, -finT, 0.40), V(-0.99, -finT, 0.30)] });   // top edge
  faces.push({ role: 'fin', sh: 0.85, p: [V(-0.82, 0.02, 0.115), V(-0.82, 0.16, 0.120), V(-0.94, 0.16, 0.125), V(-0.94, 0.02, 0.120)] });
  faces.push({ role: 'fin', sh: 0.7, p: [V(-0.82, -0.02, 0.115), V(-0.94, -0.02, 0.120), V(-0.94, -0.16, 0.125), V(-0.82, -0.16, 0.120)] });
  // Tail-rotor gearbox and disc face (schematic renderer only).
  addTube(faces, V(-0.96, 0.02, 0.12), V(-1.06, 0.07, 0.12), 0.022, 'nacelle', 0.75, 6);
  faces.push({ role: 'rotor', sh: 0.7, p: [V(-1.0, 0.07, 0.02), V(-1.0, 0.07, 0.30), V(-1.1, 0.07, 0.30), V(-1.1, 0.07, 0.02)] });
  // Tubular skids on cross-tube legs.
  const skidZ = -0.30, skidG = 0.22;
  for (const s of [1, -1]) {
    addTube(faces, V(0.34, s * skidG, skidZ + 0.02), V(-0.14, s * skidG, skidZ), 0.016, 'gear', 0.5);          // skid rail
    addTube(faces, V(0.34, s * skidG, skidZ + 0.02), V(0.42, s * skidG, skidZ + 0.09), 0.015, 'gear', 0.56);   // upturned front toe
    for (const cf of [0.24, -0.06]) addTube(faces, V(cf, s * skidG, skidZ + 0.02), V(cf, s * 0.05, -0.14), 0.012, 'strut', 0.55);   // cross-tube leg
  }
  // Rotor mast and head as real geometry, so the hub foreshortens with the airframe (a screen-space dot can't).
  const cf = 0.1, cz = 0.34, rad = 1.05;   // hub top height — the FX blade plane (drawRotorFX) matches this
  addTube(faces, V(cf, 0, 0.18), V(cf, 0, cz - 0.045), 0.017, 'nacelle', 0.82, 8);   // slender exposed mast
  // Swashplate and pitch links.
  const swashZ = cz - 0.075, swR = 0.058;
  const swashLo = [], swashHi = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, cx = cf + Math.cos(a) * swR, cy = Math.sin(a) * swR; swashLo.push(V(cx, cy, swashZ - 0.012)); swashHi.push(V(cx, cy, swashZ + 0.012)); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push({ role: 'nacelle', sh: 0.55 + 0.12 * (i % 2), p: [swashLo[i], swashLo[j], swashHi[j], swashHi[i]] }); }
  faces.push({ role: 'nacelle', sh: 0.7, p: swashHi });   // swashplate top face
  for (const s of [1, -1]) addTube(faces, V(cf + s * swR * 0.7, s * swR * 0.2, swashZ), V(cf + s * 0.012, 0, cz - 0.05), 0.006, 'gear', 0.5, 4);   // pitch links
  // Hub drum.
  const hubR = 0.05, hubB = cz - 0.05, hubT = cz + 0.008;
  const drumB = [], drumT = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, cx = cf + Math.cos(a) * hubR, cy = Math.sin(a) * hubR; drumB.push(V(cx, cy, hubB)); drumT.push(V(cx, cy, hubT)); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; faces.push({ role: 'nacelle', sh: 0.7 + 0.2 * ((i + 1) % 2), p: [drumB[i], drumB[j], drumT[j], drumT[i]] }); }
  faces.push({ role: 'nacelle', sh: 0.95, p: drumT });   // hub top cap
  // Blade grips.
  for (const s of [1, -1]) {
    const gz = cz - 0.02, gw = 0.014;
    faces.push({ role: 'nacelle', sh: s > 0 ? 0.9 : 0.66, p: [V(cf + s * hubR, gw, gz + gw), V(cf + s * 0.17, gw, gz + gw * 0.6), V(cf + s * 0.17, -gw, gz + gw * 0.6), V(cf + s * hubR, -gw, gz + gw)] });
    faces.push({ role: 'nacelle', sh: 0.8, p: [V(cf + s * hubR, gw, gz + gw), V(cf + s * 0.17, gw, gz + gw * 0.6), V(cf + s * 0.17, gw, gz - gw * 0.6), V(cf + s * hubR, gw, gz - gw)] });
  }
  // Main-rotor disc: schematic renderer only; painted renderers draw blades.
  const disc = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc.push(V(cf + Math.cos(a) * rad, Math.sin(a) * rad, cz)); }
  faces.push({ role: 'rotor', sh: 0.65, p: disc });
  return faces;
}

// ── VIPER: attack helicopter (armed 'heli'; the unarmed Dragonfly keeps the bubble) ──
// Authored at unit scale and level, then run through viperXf(). The nose-high sit is an attitude
// (VIPER_GROUND_PITCH), never baked in. Rotor anchors are pre-transform stations and windshield.js
// measures ground contact per cls+armed; see docs/reference/glass-notes.md#viper-scale-and-ground-stance
function buildAttackHeli() {
  const faces = [];
  const q = (role, sh, a, b, c, d) => faces.push({ role, sh, p: d ? [a, b, c, d] : [a, b, c] });
  const GLASS = [46, 68, 92];   // sleek dark-cyan canopy glass (a shade cooler/darker than the Dragonfly fishbowl)

  // Fuselage: chined 10-gon rings with a keeled belly.
  const sides = 10;
  const ring = (f, rg, rv, cz, keel = 0) => {
    const o = [];
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      const gg = Math.sign(cs) * Math.pow(Math.abs(cs), 0.82) * rg;
      const hh = sn >= 0 ? Math.pow(sn, 0.9) * rv : -Math.pow(-sn, 0.72) * (rv + keel);   // deeper, keeled belly
      o.push(V(f, gg, cz + hh));
    }
    return o;
  };
  const shFor = (k) => 0.60 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / sides * Math.PI * 2));   // top bright → belly dark

  // The canopy is the hull: greenhouse rings whose upper facets are glazed, with mullions and crew painted
  // by canopyTex() through the UVs. gring() replaces only k=0..5 so it welds to plain rings; rvT is
  // decoupled from rvB so a tall canopy doesn't drag the keel.
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
  // Glazed facets per bay (bay i spans station i to i+1) and texture U per station. V runs sill to roof to sill (k/5).
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
  const noseApex = V(0.80, 0, 0.052);
  for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; q('body', shFor(k), noseApex, body[0][k], body[0][j]); }

  // Chin gun turret and barrel.
  addTube(faces, V(0.50, 0, -0.010), V(0.50, 0, 0.030), 0.045, 'gun', 0.5, 8);   // turret ball
  addTube(faces, V(0.50, 0, -0.010), V(0.78, 0, -0.028), 0.016, 'gun', 0.62, 6); // cannon barrel
  addTube(faces, V(0.50, -0.028, -0.006), V(0.71, -0.028, -0.020), 0.007, 'gun', 0.6, 5);  // twin muzzle detail
  addTube(faces, V(0.50, 0.028, -0.006), V(0.71, 0.028, -0.020), 0.007, 'gun', 0.6, 5);
  // Nose sensor turret.
  addTube(faces, V(0.74, 0, 0.055), V(0.83, 0, 0.055), 0.038, 'nacelle', 0.7, 8);
  q('glass', 0.95, V(0.83, -0.024, 0.075), V(0.83, 0.024, 0.075), V(0.83, 0.024, 0.035), V(0.83, -0.024, 0.035));   // sensor face (glass)

  // Stub wings: swept anhedral weapon rails.
  const wingLE = 0.14, wingTErt = -0.24, tipDrop = -0.055;
  for (const s of [1, -1]) {
    const rG = 0.12, tG = 0.60;
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
    // Inboard rocket pod with four tube mouths.
    const pf = -0.02, pg = s * 0.33;
    addTube(faces, V(pf + 0.14, pg, wz - 0.03), V(pf - 0.16, pg, wz - 0.03), 0.05, 'nacelle', 0.66, 8);
    for (const [dg, dh] of [[-0.022, 0.022], [0.022, 0.022], [-0.022, -0.022], [0.022, -0.022]])
      addTube(faces, V(pf + 0.145, pg + dg, wz - 0.03 + dh), V(pf + 0.11, pg + dg, wz - 0.03 + dh), 0.014, 'gun', 0.4, 5);   // recessed tube mouths (dark)
    // Tip missiles.
    for (const off of [0.028, -0.028]) addMissileBody(faces, -0.14, 0.16, s * 0.55, wz - 0.02 + off);
  }

  // Tailboom rising to the FX tail-rotor anchor height.
  const bs = 8;
  const bring = (f, r, cz) => { const o = []; for (let k = 0; k < bs; k++) { const a = k / bs * Math.PI * 2; o.push(V(f, Math.cos(a) * r, cz + Math.sin(a) * r)); } return o; };
  const boom = [bring(-0.34, 0.050, 0.095), bring(-0.58, 0.038, 0.104), bring(-0.82, 0.030, 0.112), bring(-1.02, 0.024, 0.120)];
  const bsh = (k) => 0.6 + 0.3 * (0.5 + 0.5 * Math.sin((k + 0.5) / bs * Math.PI * 2));
  for (let i = 0; i < boom.length - 1; i++) for (let k = 0; k < bs; k++) { const j = (k + 1) % bs; faces.push({ role: 'body', sh: bsh(k) * 0.94, p: [boom[i][k], boom[i][j], boom[i + 1][j], boom[i + 1][k]] }); }

  const finT = 0.013, fin = [V(-0.84, 0, 0.14), V(-0.98, 0, 0.34), V(-1.10, 0, 0.44), V(-1.08, 0, 0.13)];
  for (const s of [1, -1]) { const p = fin.map(v => V(v[0], s * finT, v[2])); faces.push({ role: 'fin', sh: s > 0 ? 0.92 : 0.7, p }); }
  faces.push({ role: 'fin', sh: 0.82, p: [V(-0.98, finT, 0.34), V(-1.10, finT, 0.44), V(-1.10, -finT, 0.44), V(-0.98, -finT, 0.34)] });
  for (const s of [1, -1]) {
    q('stab', s > 0 ? 0.9 : 0.66,
      V(-0.72, s * 0.02, 0.116), V(-0.72, s * 0.26, 0.120), V(-0.86, s * 0.26, 0.124), V(-0.86, s * 0.02, 0.120));
  }
  // Tail-rotor gearbox and schematic disc at the FX anchor (-1.04, 0.07, 0.12).
  addTube(faces, V(-0.98, 0.02, 0.12), V(-1.06, 0.07, 0.12), 0.026, 'nacelle', 0.72, 7);
  faces.push({ role: 'rotor', sh: 0.7, p: [V(-1.04, 0.07, -0.05), V(-1.04, 0.07, 0.29), V(-1.14, 0.07, 0.29), V(-1.14, 0.07, -0.05)] });

  // Twin cheek engines with exhausts.
  for (const s of [1, -1]) {
    const ef = 0.02, eg = s * 0.135, ez = 0.135;
    addTube(faces, V(ef + 0.14, eg, ez), V(ef - 0.16, eg, ez), 0.062, 'nacelle', 0.72, 8);   // nacelle barrel
    addTube(faces, V(ef - 0.14, eg, ez), V(ef - 0.20, eg * 1.15, ez + 0.01), 0.05, 'gun', 0.34, 8);   // exhaust (dark, canted out)
  }

  // Main rotor mast and hub at (0.1, 0, 0.34), the FX blade plane.
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
  // Main-rotor disc (schematic renderer only).
  const disc = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc.push(V(cf + Math.cos(a) * 1.02, Math.sin(a) * 1.02, cz)); }
  faces.push({ role: 'rotor', sh: 0.65, p: disc });

  // Taildragger gear. Wheel bottoms are offset by GEAR_DROP so all three land flat at VIPER_GROUND_PITCH.
  const mainF = 0.06, tailF = -1.00;                      // fore-aft stations
  const GEAR_DROP = (tailF - mainF) * Math.tan(VIPER_GROUND_PITCH * Math.PI / 180);  // how much lower the mains hang
  const tailBot = -0.16, mainBot = tailBot + GEAR_DROP;   // wheel BOTTOMS in build space
  for (const s of [1, -1]) {
    const wr = 0.058;                                     // fat main tyre
    // Trailing-arm leg plus an aft drag brace.
    addStrut(faces, mainF, s * 0.155, -0.020, mainBot + wr, 0.016);
    addStrut(faces, mainF - 0.13, s * 0.175, -0.010, mainBot + wr, 0.011);
    pushWheel(faces, mainF, s * 0.225, mainBot + wr, wr, 0.030, 10);
  }
  const twr = 0.034;
  addStrut(faces, tailF + 0.02, 0, 0.095, tailBot + twr, 0.011);
  pushWheel(faces, tailF, 0, tailBot + twr, twr, 0.021, 8);

  // One transform over every vertex, shared with drawRotorFX's anchors.
  for (const fc of faces) fc.p = fc.p.map(viperXf);
  return faces;
}

// Exported so drawRotorFX places the rotor discs through the same transform.
export const VIPER_SCALE = 2;                   // "double the size"
// Nose-high 3-point sit (deg). Applied as an attitude by groundPitchFor; never baked into the mesh.
export const VIPER_GROUND_PITCH = 7;
export function viperXf(v) {
  return [v[0] * VIPER_SCALE, v[1] * VIPER_SCALE, v[2] * VIPER_SCALE];
}

// addMissileBody is in client/shared/vehicle-mesh.js.

// ── MAYFLY: a hand-authored Cessna ──
// Glass is glazed hull facets, the wing is skinned from cambered ribs, and the fuselage is a station table.
// Normalised: nose +0.90, tail -1.03, tips g = +-1.12, so MODEL_SCALE and CONTACT_SIZE still fit.

// Fuselage cross-sections: [f, half-width, half-height above, below, centreline height, boxiness].
// Top and bottom split for a domed roof over a flat floor; `boxy` matches buildFixedWing's shapeExp.
const CESSNA_STATIONS = [
  //  f      rg     rvT    rvB    cz     boxy
  [ 0.72, 0.056, 0.050, 0.042, 0.028, 0.10],   //  0 cowl face — the spinner sits on this ring, nearly filling it
  [ 0.65, 0.082, 0.068, 0.056, 0.022, 0.26],   //  1 cowl — a light single's cowl is a fat rounded bowl, not a snout
  [ 0.55, 0.090, 0.072, 0.062, 0.014, 0.45],   //  2 cowl aft
  [ 0.46, 0.094, 0.074, 0.068, 0.008, 0.52],   //  3 firewall / windscreen BASE  ── the next bay is the screen
  [ 0.40, 0.100, 0.140, 0.072, 0.004, 0.60],   //  4 windscreen TOP — the step up to the cabin roof
  [ 0.24, 0.106, 0.146, 0.076, 0.002, 0.62],   //  5 front seats / door front
  [ 0.06, 0.106, 0.144, 0.076, 0.004, 0.62],   //  6 door aft — the door window STOPS here
  [ 0.00, 0.104, 0.141, 0.075, 0.007, 0.61],   //  7 the painted post BETWEEN the door window and the rear one
  [-0.12, 0.100, 0.134, 0.072, 0.012, 0.58],   //  8 rear seats
  [-0.28, 0.084, 0.108, 0.062, 0.028, 0.46],   //  9 cabin aft — the glass stops here
  [-0.46, 0.060, 0.074, 0.048, 0.048, 0.32],   // 10 tailcone
  [-0.66, 0.044, 0.052, 0.038, 0.064, 0.22],   // 11
  [-0.86, 0.032, 0.038, 0.030, 0.078, 0.16],   // 12
  [-1.00, 0.022, 0.026, 0.022, 0.088, 0.10],   // 13 tail end
];
// Hull section at any station. Exported so drawNoseArt wraps decals onto the real flank (no FW_PARAMS row here).
export function cessnaSection(f) {
  const h = meshHull('ultralight');
  if (h) return h.CS(f);
  const S = CESSNA_STATIONS;
  if (f >= S[0][0]) return { rg: S[0][1], rvT: S[0][2], rvB: S[0][3], cz: S[0][4], boxy: S[0][5] };
  const last = S[S.length - 1];
  if (f <= last[0]) return { rg: last[1], rvT: last[2], rvB: last[3], cz: last[4], boxy: last[5] };
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    if (f <= a[0] && f >= b[0]) {
      const t = (a[0] - f) / (a[0] - b[0] || 1), L = (x, y) => x + (y - x) * t;
      return { rg: L(a[1], b[1]), rvT: L(a[2], b[2]), rvB: L(a[3], b[3]), cz: L(a[4], b[4]), boxy: L(a[5], b[5]) };
    }
  }
  return { rg: last[1], rvT: last[2], rvB: last[3], cz: last[4], boxy: last[5] };
}

// Wing geometry: constant chord to CE_TAPER0 of the semi-span, then a straight taper to a square tip.
const CE_SPAN = 1.12, CE_TAPER0 = 0.55, CE_WH = 0.152, CE_DIH = 0.038;
const CE_LE_R = 0.26, CE_TE_R = -0.10, CE_LE_T = 0.215, CE_TE_T = -0.035;
// ceFoil is in client/shared/vehicle-mesh.js. cePt: a wing surface point; `sec` 0.5 is the mean line.
function cePt(g, x, sec) {
  const a = Math.min(1, Math.abs(g) / CE_SPAN);
  const t = a <= CE_TAPER0 ? 0 : (a - CE_TAPER0) / (1 - CE_TAPER0);
  const le = CE_LE_R + (CE_LE_T - CE_LE_R) * t, te = CE_TE_R + (CE_TE_T - CE_TE_R) * t;
  const c = le - te, [u, l] = ceFoil(x);
  const z = CE_WH + CE_DIH * a + (sec === 0.5 ? (u + l) / 2 : sec ? u : l) * c;
  return V(le - x * c, g, z);
}


function buildCessna(detail = 1) {
  const faces = [];
  const q = (role, sh, a, b, c, d) => faces.push({ role, sh, p: d ? [a, b, c, d] : [a, b, c] });
  const GLASS = [92, 128, 156];   // bright cabin plexiglass — you can see straight through a light single
  const SIDES = 12;               // upper half = k 0…5 (starboard sill → crown at k3 → port sill)

  const ring = (row) => {
    const [f, rg, rvT, rvB, cz, boxy] = row, e = 1 - boxy * 0.55, o = [];
    for (let k = 0; k < SIDES; k++) {
      const a = k / SIDES * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const g = Math.sign(ca) * Math.pow(Math.abs(ca), e) * rg;
      const h = sa >= 0 ? Math.pow(sa, e) * rvT : -Math.pow(-sa, e) * rvB;
      o.push(V(f, g, cz + h));
    }
    return o;
  };
  const shFor = (k) => 0.62 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / SIDES * Math.PI * 2));   // crown bright → belly dark
  // Coarse LOD keeps the stations the glass starts and stops on; the tables below are keyed by f, not index.
  const KEEP = new Set([0.72, 0.55, 0.46, 0.40, 0.06, 0.00, -0.28, -0.66, -1.00]);
  const rows = detail ? CESSNA_STATIONS : CESSNA_STATIONS.filter(r => KEEP.has(r[0]));
  const body = rows.map(ring);
  // Glazed facets by bay's forward station. The windscreen bay glazes the whole upper half; behind it only k0/k5.
  // The 0.06 bay is left out on purpose: it's the painted post between the two side windows.
  const GLAZE = { 0.46: [0, 1, 2, 3, 4, 5], 0.40: [0, 5], 0.24: [0, 5], 0: [0, 5], '-0.12': [0, 5] };
  // Texture U per glazed station; the canopy art's frame posts sit on these numbers.
  const STATION_U = { 0.46: 0.00, 0.40: 0.18, 0.24: 0.42, 0.06: 0.66, 0: 0.74, '-0.12': 0.86, '-0.28': 1.00 };
  for (let i = 0; i < body.length - 1; i++) {
    const glz = GLAZE[rows[i][0]], uA = (STATION_U[rows[i][0]] ?? 0) * CP_TW, uB = (STATION_U[rows[i + 1][0]] ?? 0) * CP_TW;
    for (let k = 0; k < SIDES; k++) {
      const j = (k + 1) % SIDES;
      const fc = { role: 'body', sh: shFor(k), p: [body[i][k], body[i][j], body[i + 1][j], body[i + 1][k]] };
      if (glz && glz.includes(k)) {
        fc.role = 'glass'; fc.tint = GLASS; fc.art = 'mayfly';
        fc.uv = [[uA, k / 6 * CP_TH], [uA, j / 6 * CP_TH], [uB, j / 6 * CP_TH], [uB, k / 6 * CP_TH]];
      }
      faces.push(fc);
    }
  }
  faces.push({ role: 'body', sh: 0.92, p: body[0] });                        // cowl front face (the spinner sits on it)
  faces.push({ role: 'body', sh: 0.5, p: body[body.length - 1].slice().reverse() });   // tailcone end cap

  // ── Cowl: intakes, spinner, exhaust ──
  const SPIN_F = 0.795, SPIN_R = 0.048, spinBase = [];
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; spinBase.push(V(0.72, Math.cos(a) * SPIN_R, 0.028 + Math.sin(a) * SPIN_R)); }
  for (let k = 0; k < 10; k++) {   // a pointed 10-facet spinner, not the generic four-sided pyramid
    const j = (k + 1) % 10;
    q('nacelle', 0.72 + 0.26 * (0.5 + 0.5 * Math.sin((k + 0.5) / 10 * Math.PI * 2)), V(SPIN_F, 0, 0.028), spinBase[k], spinBase[j]);
  }
  if (detail) {
    for (const s of [1, -1]) {   // cooling intakes: dark recessed mouths flanking the spinner
      addTube(faces, V(0.722, s * 0.031, 0.012), V(0.680, s * 0.031, 0.012), 0.016, 'gun', 0.36, 7);
    }
    addTube(faces, V(0.58, 0.032, -0.032), V(0.47, 0.038, -0.048), 0.010, 'gun', 0.34, 6);
  }

  // ── Wing: real ribs, continuous over the cabin roof ──
  const NX = detail ? 11 : 4;
  const XS = []; for (let i = 0; i < NX; i++) XS.push(0.5 * (1 - Math.cos(Math.PI * i / (NX - 1))));   // cosine spacing: dense at the LE
  const RIBS = detail ? [-CE_SPAN, -0.88, -0.62, 0, 0.62, 0.88, CE_SPAN] : [-CE_SPAN, 0, CE_SPAN];
  for (let r = 0; r < RIBS.length - 1; r++) {
    const gA = RIBS[r], gB = RIBS[r + 1];
    for (let i = 0; i < NX - 1; i++) {
      const x0 = XS[i], x1 = XS[i + 1];
      // Upper skin brightens over the crest of the camber.
      const lit = 0.80 + 0.18 * Math.sin(Math.PI * Math.min(1, (x0 + x1) / 2 * 1.6));
      q('wing', lit, cePt(gA, x0, 1), cePt(gB, x0, 1), cePt(gB, x1, 1), cePt(gA, x1, 1));
      q('wing', 0.46, cePt(gA, x1, 0), cePt(gB, x1, 0), cePt(gB, x0, 0), cePt(gA, x0, 0));
    }
  }
  for (const s of [1, -1]) {   // square-cut tip: close the section off, then the drooped tip fairing
    for (let i = 0; i < NX - 1; i++)
      q('wing', 0.66, cePt(s * CE_SPAN, XS[i], 1), cePt(s * CE_SPAN, XS[i + 1], 1), cePt(s * CE_SPAN, XS[i + 1], 0), cePt(s * CE_SPAN, XS[i], 0));
    if (detail) {
      const tipDrop = -0.030;
      q('nacelle', 0.70, cePt(s * CE_SPAN, 0.06, 1), cePt(s * CE_SPAN, 0.9, 1),
        V(cePt(s * CE_SPAN, 0.9, 0)[0], s * (CE_SPAN + 0.012), cePt(s * CE_SPAN, 0.9, 0)[2] + tipDrop),
        V(cePt(s * CE_SPAN, 0.06, 0)[0], s * (CE_SPAN + 0.012), cePt(s * CE_SPAN, 0.06, 0)[2] + tipDrop));
      // Nav-light lens via the per-face `tint` override.
      const lp = cePt(s * CE_SPAN, 0.10, 0.5);
      faces.push({ role: 'window', sh: 0.95, tint: s > 0 ? [46, 190, 78] : [200, 52, 48],
        p: [V(lp[0] - 0.02, s * (CE_SPAN + 0.014), lp[2] + 0.012), V(lp[0] + 0.02, s * (CE_SPAN + 0.014), lp[2] + 0.012),
            V(lp[0] + 0.02, s * (CE_SPAN + 0.014), lp[2] - 0.012), V(lp[0] - 0.02, s * (CE_SPAN + 0.014), lp[2] - 0.012)] });
    }
  }
  if (detail) for (const s of [1, -1]) {   // big inboard flap + outboard aileron, on the real trailing edge
    const le = (g) => cePt(s * g, 0.62, 0.5), te = (g) => cePt(s * g, 1, 0.5);
    pushCtrlSurface(faces, 'flap', s, 0.80, le(0.17), le(0.60), te(0.17), te(0.60), 0.30, 'z', 0.012);
    pushCtrlSurface(faces, 'aileron', s, 0.82, le(0.66), le(1.06), te(0.66), te(1.06), 0.30, 'z', 0.010);
  }
  // Wing-root fairing.
  if (detail) for (const s of [1, -1]) {
    const rf = cePt(s * 0.12, 0.02, 0), rb = cePt(s * 0.12, 0.98, 0);
    q('body', 0.80, rf, rb, V(-0.20, s * 0.084, 0.126), V(0.34, s * 0.088, 0.128));
  }

  // ── Lift struts ──
  for (const s of [1, -1]) {
    const wA = cePt(s * 0.62, 0.42, 0);
    addFaired(faces, V(0.22, s * 0.086, -0.048), V(wA[0], s * 0.62, wA[2] - 0.004), 0.038, 0.010, 'strut', 0.66);
    if (detail) {   // the cuff where the strut meets the wing — a real Cessna wears a fairing there
      q('nacelle', 0.72, V(wA[0] + 0.035, s * 0.58, wA[2] - 0.012), V(wA[0] - 0.035, s * 0.58, wA[2] - 0.012),
        V(wA[0] - 0.030, s * 0.66, wA[2] - 0.002), V(wA[0] + 0.030, s * 0.66, wA[2] - 0.002));
    }
  }

  // ── Tail ──
  const FT = 0.012;   // fin half-thickness
  const finPlan = [V(-0.56, 0, 0.118), V(-0.84, 0, 0.40), V(-0.94, 0, 0.44), V(-1.00, 0, 0.145), V(-0.94, 0, 0.108)];
  for (const s of [1, -1]) {
    // A quad and a triangle: the panel texture and jazz splatter only map 3- and 4-point faces.
    const P = finPlan.map(v => V(v[0], s * FT, v[2])), sh = s > 0 ? 0.92 : 0.68;
    q('fin', sh, P[0], P[1], P[2], P[4]);
    q('fin', sh * 0.97, P[2], P[3], P[4]);
  }
  for (let i = 0; i < finPlan.length - 1; i++) {   // the fin's own edges — it has thickness, so it catches light
    const a = finPlan[i], b = finPlan[i + 1];
    q('fin', i === 0 ? 0.88 : 0.74, V(a[0], FT, a[2]), V(b[0], FT, b[2]), V(b[0], -FT, b[2]), V(a[0], -FT, a[2]));
  }
  if (detail) {   // dorsal fillet: the long shallow blade up the spine into the fin leading edge
    q('fin', 0.84, V(-0.24, 0, 0.138), V(-0.70, 0, 0.205), V(-0.56, 0, 0.118));
  }
  // Rudder: a two-sided plate, never coplanar with the fin.
  for (const s of [1, -1]) {
    const gg = s * (FT + 0.006);
    const Htop = V(-0.905, gg, 0.415), Hbot = V(-0.938, gg, 0.115);
    const Ttop = V(-0.962, gg, 0.430), Tbot = V(-1.000, gg, 0.145);
    faces.push({ role: 'rudder', defl: 'rudder', side: 1, sh: s > 0 ? 0.88 : 0.66,
      hinge: [Htop, Hbot], p: s > 0 ? [Htop, Hbot, Tbot, Ttop] : [Ttop, Tbot, Hbot, Htop] });
  }
  const HZ = 0.076, HSPAN = 0.37;   // tailplane, mounted low on the tailcone (real ratio to the span — the parametric row's was a quarter too big)
  for (const s of [1, -1]) {
    pushPanel(faces, 'stab', 0.74, [
      V(-0.64, s * 0.028, HZ), V(-0.70, s * HSPAN, HZ + 0.006),
      V(-0.88, s * HSPAN, HZ + 0.006), V(-0.86, s * 0.028, HZ)], 0.018, detail);
    if (detail) {
      const le = (u) => _lerp3(V(-0.64, s * 0.028, HZ), V(-0.70, s * HSPAN, HZ + 0.006), u);
      const te = (u) => _lerp3(V(-0.86, s * 0.028, HZ), V(-0.88, s * HSPAN, HZ + 0.006), u);
      pushCtrlSurface(faces, 'elevator', s, 0.74, le(0.05), le(0.96), te(0.05), te(0.96), 0.36, 'z', 0.009);
    }
  }
  if (detail) {   // beacon lens on the fin tip
    faces.push({ role: 'window', sh: 0.95, tint: [205, 58, 50],
      p: [V(-0.90, 0.010, 0.452), V(-0.94, 0.010, 0.452), V(-0.94, -0.010, 0.452), V(-0.90, -0.010, 0.452)] });
  }

  // ── Fixed tricycle gear ──
  // Spring-steel mains bow out and aft to the wheels; three faired segments approximate the curve.
  const MF = 0.10, MG = 0.30, MZ = -0.200, MR = 0.055;
  const NF = 0.52, NR = 0.046, NZ = (MZ - MR) + NR;   // nose wheel bottom lands on the mains' ground line
  for (const s of [1, -1]) {
    const leg = [V(MF, s * 0.030, -0.062), V(MF, s * 0.130, -0.120), V(MF, s * 0.228, -0.170), V(MF, s * MG, MZ)];
    for (let i = 0; i < leg.length - 1; i++) addFaired(faces, leg[i], leg[i + 1], 0.030, 0.009, 'gear', 0.62);
    pushWheel(faces, MF, s * MG, MZ, MR, 0.018, detail ? 12 : 8);
    if (detail) addSpat(faces, MF, s * MG, MZ, 1.05);
  }
  addStrut(faces, NF, 0, -0.010, NZ + 0.030, 0.016, 6);
  pushWheel(faces, NF, 0, NZ, NR, 0.016, detail ? 10 : 8);
  if (detail) {
    addSpat(faces, NF, 0, NZ, 0.85);
    // Scissor link on the nose oleo.
    const lw = 0.007, kf = NF + 0.028, kz = NZ + 0.062;
    q('gear', 0.80, V(NF + 0.014, -lw, NZ + 0.100), V(NF + 0.014, lw, NZ + 0.100), V(kf, lw, kz), V(kf, -lw, kz));
    q('gear', 0.66, V(kf, -lw, kz), V(kf, lw, kz), V(NF + 0.014, lw, NZ + 0.026), V(NF + 0.014, -lw, NZ + 0.026));
  }

  // ── Small details ──
  if (detail) {
    // Cabin door seams, just proud of the flank.
    for (const s of [1, -1]) {
      const gg = s * 0.109, sw = 0.004;
      const seam = (f0, z0, f1, z1) => q('strut', 0.42, V(f0, gg, z0 + sw), V(f1, gg, z1 + sw), V(f1, gg, z1 - sw), V(f0, gg, z0 - sw));
      seam(0.30, 0.132, 0.30, -0.052);    // front post
      seam(0.02, 0.128, 0.02, -0.056);    // rear post
      q('strut', 0.42, V(0.30, gg, -0.050), V(0.02, gg, -0.054), V(0.02, gg, -0.062), V(0.30, gg, -0.058));   // sill
      q('gear', 0.58, V(0.20, s * 0.088, -0.090), V(0.20, s * 0.150, -0.096), V(0.13, s * 0.150, -0.096), V(0.13, s * 0.088, -0.090));
    }
    // Roof and belly antennas.
    for (const s of [1, -1]) q('fin', s > 0 ? 0.86 : 0.66, V(-0.04, s * 0.004, 0.146), V(-0.13, s * 0.004, 0.146), V(-0.13, s * 0.004, 0.205), V(-0.07, s * 0.004, 0.205));
    addTube(faces, V(-0.20, 0, -0.062), V(-0.20, 0, -0.100), 0.006, 'gear', 0.5, 4);
    // Pitot tube under the left wing.
    const pv = cePt(-0.52, 0.30, 0);
    addTube(faces, V(pv[0], -0.52, pv[2] - 0.004), V(pv[0] + 0.055, -0.52, pv[2] - 0.012), 0.005, 'gear', 0.55, 4);
  }
  return faces;
}

// ── GRASSHOPPER: a hand-authored Piper Cub ──
// The wing sits above the fuselage on the cabin frame; the gap is the greenhouse.
// ⚠ Glazing differs from the Mayfly on purpose: continuous side glass plus a roof skylight. Don't merge them.
// cubFoil is the Mayfly foil with a flat underside. Normalised: nose +0.87, tail -1.03, tips g = +-1.16.
// Stations use CESSNA_STATIONS' columns: narrower (tandem seats), and `cz` climbs for the high fin.
const CUB_STATIONS = [
  //  f      rg     rvT    rvB    cz     boxy
  [ 0.80, 0.048, 0.046, 0.038, 0.030, 0.16],   //  0 cowl face — the spinner sits on this ring
  [ 0.72, 0.064, 0.060, 0.048, 0.026, 0.30],   //  1 cowl — narrow, and the cylinder heads stick out of it
  [ 0.60, 0.072, 0.068, 0.056, 0.020, 0.54],   //  2 firewall
  [ 0.52, 0.074, 0.072, 0.060, 0.016, 0.62],   //  3 windscreen BASE ── the next bay is the screen
  [ 0.44, 0.076, 0.126, 0.062, 0.012, 0.70],   //  4 windscreen TOP — the step up to the cabin frame
  [ 0.22, 0.078, 0.130, 0.064, 0.010, 0.72],   //  5 front seat / door front
  [ 0.00, 0.078, 0.128, 0.064, 0.010, 0.72],   //  6 rear seat / door aft
  [-0.20, 0.070, 0.114, 0.058, 0.016, 0.66],   //  7 cabin aft — the glass stops here
  [-0.42, 0.052, 0.082, 0.046, 0.030, 0.50],   //  8 tailcone
  [-0.64, 0.036, 0.056, 0.032, 0.048, 0.36],   //  9
  [-0.86, 0.024, 0.038, 0.022, 0.066, 0.24],   // 10
  [-1.03, 0.014, 0.024, 0.014, 0.080, 0.16],   // 11 tail end
];
// Exported for the nose-art wrap, as cessnaSection is.
export function cubSection(f) {
  const h = meshHull('grasshopper');
  if (h) return h.CS(f);
  const S = CUB_STATIONS;
  if (f >= S[0][0]) return { rg: S[0][1], rvT: S[0][2], rvB: S[0][3], cz: S[0][4], boxy: S[0][5] };
  const last = S[S.length - 1];
  if (f <= last[0]) return { rg: last[1], rvT: last[2], rvB: last[3], cz: last[4], boxy: last[5] };
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    if (f <= a[0] && f >= b[0]) {
      const t = (a[0] - f) / (a[0] - b[0] || 1), L = (x, y) => x + (y - x) * t;
      return { rg: L(a[1], b[1]), rvT: L(a[2], b[2]), rvB: L(a[3], b[3]), cz: L(a[4], b[4]), boxy: L(a[5], b[5]) };
    }
  }
  return { rg: last[1], rvT: last[2], rvB: last[3], cz: last[4], boxy: last[5] };
}

// Wing: constant chord, square tips, carried clear of the crown by CU_WH.
const CU_SPAN = 1.16, CU_WH = 0.212, CU_DIH = 0.022, CU_LE = 0.30, CU_TE = -0.18;
// cubFoil is in client/shared/vehicle-mesh.js.
function cuPt(g, x, sec) {
  const a = Math.min(1, Math.abs(g) / CU_SPAN), c = CU_LE - CU_TE, [u, l] = cubFoil(x);
  const z = CU_WH + CU_DIH * a + (sec === 0.5 ? (u + l) / 2 : sec ? u : l) * c;
  return V(CU_LE - x * c, g, z);
}

// Nose-high three-point sit (deg), applied as an attitude, never baked into the mesh.
export const CUB_GROUND_PITCH = 11;

function buildCub(detail = 1) {
  const faces = [];
  const q = (role, sh, a, b, c, d) => faces.push({ role, sh, p: d ? [a, b, c, d] : [a, b, c] });
  const GLASS = [96, 132, 158];
  const SIDES = 12;

  const ring = (row) => {
    const [f, rg, rvT, rvB, cz, boxy] = row, e = 1 - boxy * 0.55, o = [];
    for (let k = 0; k < SIDES; k++) {
      const a = k / SIDES * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const g = Math.sign(ca) * Math.pow(Math.abs(ca), e) * rg;
      const h = sa >= 0 ? Math.pow(sa, e) * rvT : -Math.pow(-sa, e) * rvB;
      o.push(V(f, g, cz + h));
    }
    return o;
  };
  const shFor = (k) => 0.62 + 0.36 * (0.5 + 0.5 * Math.sin((k + 0.5) / SIDES * Math.PI * 2));
  // Keyed by f, not index, so subsampling can never slide the greenhouse onto the wrong bay.
  const KEEP = new Set([0.80, 0.60, 0.52, 0.44, 0.00, -0.20, -0.64, -1.03]);
  const rows = detail ? CUB_STATIONS : CUB_STATIONS.filter(r => KEEP.has(r[0]));
  const body = rows.map(ring);
  // Greenhouse: windscreen bay glazes the whole upper half; behind it side glass k0/k5 and skylight k2/k3.
  // k1/k4 stay painted (the frame's longeron).
  const GLAZE = { 0.52: [0, 1, 2, 3, 4, 5], 0.44: [0, 2, 3, 5], 0.22: [0, 2, 3, 5], 0: [0, 5] };
  // Texture U per glazed station. The 'xcub' art's frame posts and sills line up with these and the crown facets.
  const STATION_U = { 0.52: 0.00, 0.44: 0.18, 0.22: 0.48, 0: 0.78, '-0.20': 1.00 };
  for (let i = 0; i < body.length - 1; i++) {
    const glz = GLAZE[rows[i][0]], uA = (STATION_U[rows[i][0]] ?? 0) * CP_TW, uB = (STATION_U[rows[i + 1][0]] ?? 0) * CP_TW;
    for (let k = 0; k < SIDES; k++) {
      const j = (k + 1) % SIDES;
      const fc = { role: 'body', sh: shFor(k), p: [body[i][k], body[i][j], body[i + 1][j], body[i + 1][k]] };
      if (glz && glz.includes(k)) {
        fc.role = 'glass'; fc.tint = GLASS; fc.art = 'xcub';
        fc.uv = [[uA, k / 6 * CP_TH], [uA, j / 6 * CP_TH], [uB, j / 6 * CP_TH], [uB, k / 6 * CP_TH]];
      }
      faces.push(fc);
    }
  }
  faces.push({ role: 'body', sh: 0.92, p: body[0] });
  faces.push({ role: 'body', sh: 0.5, p: body[body.length - 1].slice().reverse() });

  // ── Cowl: exposed cylinder heads, spinner, exhaust ──
  const SPIN_F = 0.865, SPIN_R = 0.036, spinBase = [];
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; spinBase.push(V(0.80, Math.cos(a) * SPIN_R, 0.030 + Math.sin(a) * SPIN_R)); }
  for (let k = 0; k < 10; k++) {
    const j = (k + 1) % 10;
    q('nacelle', 0.72 + 0.26 * (0.5 + 0.5 * Math.sin((k + 0.5) / 10 * Math.PI * 2)), V(SPIN_F, 0, 0.030), spinBase[k], spinBase[j]);
  }
  if (detail) {
    for (const s of [1, -1]) {   // two cylinder heads a side, out through the cowl cheek
      for (const ff of [0.735, 0.665]) addTube(faces, V(ff, s * 0.052, 0.014), V(ff, s * 0.084, 0.008), 0.017, 'nacelle', 0.58, 6);
    }
    addTube(faces, V(0.68, -0.030, -0.026), V(0.50, -0.036, -0.048), 0.010, 'gun', 0.34, 6);
  }

  // ── Wing ──
  const NX = detail ? 11 : 4;
  const XS = []; for (let i = 0; i < NX; i++) XS.push(0.5 * (1 - Math.cos(Math.PI * i / (NX - 1))));
  const RIBS = detail ? [-CU_SPAN, -0.86, -0.58, -0.20, 0.20, 0.58, 0.86, CU_SPAN] : [-CU_SPAN, 0, CU_SPAN];
  for (let r = 0; r < RIBS.length - 1; r++) {
    const gA = RIBS[r], gB = RIBS[r + 1];
    for (let i = 0; i < NX - 1; i++) {
      const x0 = XS[i], x1 = XS[i + 1];
      const lit = 0.80 + 0.18 * Math.sin(Math.PI * Math.min(1, (x0 + x1) / 2 * 1.6));
      q('wing', lit, cuPt(gA, x0, 1), cuPt(gB, x0, 1), cuPt(gB, x1, 1), cuPt(gA, x1, 1));
      q('wing', 0.44, cuPt(gA, x1, 0), cuPt(gB, x1, 0), cuPt(gB, x0, 0), cuPt(gA, x0, 0));   // flat underside, and it stays dark
    }
  }
  for (const s of [1, -1]) {
    for (let i = 0; i < NX - 1; i++)
      q('wing', 0.66, cuPt(s * CU_SPAN, XS[i], 1), cuPt(s * CU_SPAN, XS[i + 1], 1), cuPt(s * CU_SPAN, XS[i + 1], 0), cuPt(s * CU_SPAN, XS[i], 0));
    if (detail) {
      const lp = cuPt(s * CU_SPAN, 0.10, 0.5);
      faces.push({ role: 'window', sh: 0.95, tint: s > 0 ? [46, 190, 78] : [200, 52, 48],
        p: [V(lp[0] - 0.02, s * (CU_SPAN + 0.012), lp[2] + 0.010), V(lp[0] + 0.02, s * (CU_SPAN + 0.012), lp[2] + 0.010),
            V(lp[0] + 0.02, s * (CU_SPAN + 0.012), lp[2] - 0.010), V(lp[0] - 0.02, s * (CU_SPAN + 0.012), lp[2] - 0.010)] });
    }
  }
  // No flaps, a J-3 has none. Ailerons only, outboard, on the real trailing edge.
  if (detail) for (const s of [1, -1]) {
    const le = (g) => cuPt(s * g, 0.66, 0.5), te = (g) => cuPt(s * g, 1, 0.5);
    pushCtrlSurface(faces, 'aileron', s, 0.82, le(0.60), le(1.12), te(0.60), te(1.12), 0.28, 'z', 0.010);
  }

  // ── Cabane and lift struts ── The wing sits on four short cabane struts off the cabin corners.
  for (const s of [1, -1]) {
    for (const [f0, x] of [[0.44, 0.10], [0.06, 0.86]]) {   // front cabane → wing LE, rear → the aft spar
      const top = cuPt(s * 0.10, x, 0);
      addFaired(faces, V(f0, s * 0.066, 0.118), V(top[0], s * 0.096, top[2] - 0.004), 0.024, 0.008, 'strut', 0.60);
    }
    // One lift strut a side plus the jury strut halfway up.
    const wA = cuPt(s * 0.62, 0.34, 0);
    addFaired(faces, V(0.20, s * 0.070, -0.052), V(wA[0], s * 0.62, wA[2] - 0.004), 0.034, 0.009, 'strut', 0.66);
    if (detail) {
      const mid = [(0.20 + wA[0]) / 2, s * 0.345, (-0.052 + wA[2]) / 2];
      const jw = cuPt(s * 0.34, 0.80, 0);
      addTube(faces, V(mid[0], mid[1], mid[2]), V(jw[0], s * 0.34, jw[2] - 0.004), 0.006, 'strut', 0.58, 4);
    }
  }

  // ── Tail: rounded outlines, rudder hanging below the cone ──
  const FT = 0.010;
  const finPlan = [V(-0.62, 0, 0.098), V(-0.84, 0, 0.34), V(-0.92, 0, 0.36), V(-0.94, 0, 0.100)];
  for (const s of [1, -1]) {
    const P = finPlan.map(v => V(v[0], s * FT, v[2])), sh = s > 0 ? 0.92 : 0.68;
    q('fin', sh, P[0], P[1], P[2], P[3]);
  }
  for (let i = 0; i < finPlan.length - 1; i++) {
    const a = finPlan[i], b = finPlan[i + 1];
    q('fin', i === 0 ? 0.88 : 0.74, V(a[0], FT, a[2]), V(b[0], FT, b[2]), V(b[0], -FT, b[2]), V(a[0], -FT, a[2]));
  }
  // Rudder runs down past the tailcone. Two panels a side because the panel texture maps only 3- and 4-point faces.
  for (const s of [1, -1]) {
    const gg = s * (FT + 0.005);
    const Htop = V(-0.925, gg, 0.352), Hmid = V(-0.945, gg, 0.100), Hbot = V(-0.950, gg, -0.020);
    const Ttop = V(-0.995, gg, 0.320), Tmid = V(-1.030, gg, 0.110), Tbot = V(-1.010, gg, -0.010);
    const F = (a, b, c, d, sh) => faces.push({ role: 'rudder', defl: 'rudder', side: 1, sh,
      hinge: [Htop, Hbot], p: s > 0 ? [a, b, c, d] : [d, c, b, a] });
    F(Htop, Hmid, Tmid, Ttop, s > 0 ? 0.88 : 0.66);
    F(Hmid, Hbot, Tbot, Tmid, s > 0 ? 0.84 : 0.63);
  }
  // Braced tailplane: struts below, wires above.
  const HZ = 0.070, HSPAN = 0.40;
  for (const s of [1, -1]) {
    pushPanel(faces, 'stab', 0.74, [
      V(-0.66, s * 0.024, HZ), V(-0.72, s * HSPAN, HZ + 0.008),
      V(-0.86, s * HSPAN, HZ + 0.008), V(-0.88, s * 0.024, HZ)], 0.014, detail);
    if (detail) {
      const le = (u) => _lerp3(V(-0.66, s * 0.024, HZ), V(-0.72, s * HSPAN, HZ + 0.008), u);
      const te = (u) => _lerp3(V(-0.88, s * 0.024, HZ), V(-0.86, s * HSPAN, HZ + 0.008), u);
      pushCtrlSurface(faces, 'elevator', s, 0.74, le(0.05), le(0.96), te(0.05), te(0.96), 0.38, 'z', 0.008);
      addTube(faces, V(-0.80, s * 0.020, 0.020), V(-0.78, s * 0.30, HZ), 0.005, 'strut', 0.56, 4);      // brace strut, below
      addTube(faces, V(-0.86, s * 0.006, 0.245), V(-0.76, s * 0.30, HZ + 0.010), 0.004, 'strut', 0.62, 4);   // bracing wire, above
    }
  }

  // ── Bungee taildragger gear ── A tube V to a cross-axle, wheels forward of the wing.
  const AXF = 0.34, AXG = 0.215, AXZ = -0.235, TYRE = 0.082;
  for (const s of [1, -1]) {
    addTube(faces, V(0.46, s * 0.036, -0.052), V(AXF, s * AXG, AXZ), 0.011, 'gear', 0.62, 5);   // front leg
    addTube(faces, V(0.16, s * 0.036, -0.054), V(AXF, s * AXG, AXZ), 0.010, 'gear', 0.56, 5);   // rear leg
    addTube(faces, V(AXF, s * 0.030, -0.062), V(AXF, s * AXG, AXZ), 0.008, 'gear', 0.50, 5);    // the shock strut down to the axle
    pushWheel(faces, AXF, s * AXG, AXZ, TYRE, 0.034, detail ? 12 : 8);
  }
  if (detail) addTube(faces, V(AXF, -AXG, AXZ), V(AXF, AXG, AXZ), 0.007, 'gear', 0.48, 5);      // the cross-axle itself
  addFaired(faces, V(-0.90, 0, -0.006), V(-1.000, 0, -0.052), 0.026, 0.006, 'gear', 0.58);
  pushWheel(faces, -1.005, 0, -0.072, 0.026, 0.012, detail ? 8 : 6);

  // ── Small details ──
  if (detail) {
    // Split door, starboard only: seams and the horizontal split line.
    const gg = 0.0805, sw = 0.0035;
    const seam = (f0, z0, f1, z1) => q('strut', 0.42, V(f0, gg, z0 + sw), V(f1, gg, z1 + sw), V(f1, gg, z1 - sw), V(f0, gg, z0 - sw));
    seam(0.24, 0.118, 0.24, -0.048);    // front post
    seam(-0.02, 0.112, -0.02, -0.050);  // rear post
    seam(0.24, 0.036, -0.02, 0.034);    // THE SPLIT: the horizontal line the two halves part on
    q('strut', 0.42, V(0.24, gg, -0.046), V(-0.02, gg, -0.048), V(-0.02, gg, -0.056), V(0.24, gg, -0.054));   // sill
    // Boarding step, and the pitot on the left lift strut.
    q('gear', 0.58, V(0.16, 0.070, -0.086), V(0.16, 0.128, -0.092), V(0.09, 0.128, -0.092), V(0.09, 0.070, -0.086));
    addTube(faces, V(0.12, -0.34, 0.028), V(0.19, -0.34, 0.022), 0.005, 'gear', 0.55, 4);
    // Wire aerial, roof to fin.
    addTube(faces, V(-0.16, 0, 0.132), V(-0.86, 0, 0.330), 0.003, 'strut', 0.66, 3);
  }
  return faces;
}

// Where each class's prop discs spin, for the renderers' engine-effect layers.
export const PROP_STATIONS = {
  ultralight: [[0.775, 0, 0.028]],                      // Cessna: one nose prop, at the spinner (drawRotorFX walks it back 0.06 to the cone root)
  prop: [[0.47, 0.42, 0.11], [0.47, -0.42, 0.11]],     // Twin Otter: two wing props
  grasshopper: [[0.865, 0, 0.030]],                    // Cub: one nose prop, at her own spinner apex (CUB_STATIONS' cowl face + SPIN_R)
  locust: [[1.13, 0, 0.02]],                           // ag turbine: one big nose prop (spinner apex = noseF 1.00 + 0.14·0.9)
  divebomber: [[1.19, 0, -0.035]],                     // Shrike: one big slow nose prop (spinner apex = noseF 1.06 + 0.14·0.82, on her DROOPED centreline — noseZ, same as addSpinner)
};

// Relative size (Twin Otter = 1) where craft are shown together (the hangar fleet scene). The An-124 is
// compressed to 2.0 and the heli bumped to .42 for readability. Contacts use windshield.js CONTACT_SIZE.
// Unlisted classes default to 1.
export const MODEL_SCALE = { ultralight: 0.52, prop: 1.0, gunship: 1.05, heavy: 1.7, heli: 0.42, wreck: 0.85, grasshopper: 0.42, locust: 0.40, divebomber: 0.72, truck: 1.15, hydro: 1.0 };
// A mesh-file-only class carries its scale in `classFacts.modelScale`. `??=` so a file can't resize a listed class.
for (const [id, row] of Object.entries(MESH_ROWS)) if (row.classFacts?.modelScale != null) MODEL_SCALE[id] ??= row.classFacts.modelScale;

// ── Animated prop and rotor blades ──
// An effect layer each renderer draws through its own camera: `projFn([f,g,h])` gives {sx, sy} or null.
// Blades are model-space polygons, so the static face list stays memoisable (painted renderers skip 'rotor').
// `spin` is a shared phase each disc gears to its RPM. `disc` is blur opacity, `spool` the smear; both
// fall back to `power`. `parked` draws crisp stopped blades.
// ⚠ `sink` takes the whole rotor off the canvas (then `ctx` may be null): `{ poly(pts, rgba), line(pts, rgba, widthPx) }`
// in model space, so the caller can depth-test blades against the hull. All translucent: depth-test, never write depth.
let FX_SINK = null;
export function drawRotorFX(ctx, cls, projFn, opts = {}) {
  FX_SINK = opts.sink || null;
  try { drawRotorFXInner(ctx, cls, projFn, opts); } finally { FX_SINK = null; }
}
// Parked blades as near-opaque depth-buffer faces for the hangar renderers. `projM` is model space to screen.
export function pushParkedRotorFaces(drawn, cls, armed, spin, projM, near) {
  const polys = [];
  drawRotorFX(null, cls, (v) => { const q = projM(v); return q.z <= near ? null : q; },
    { parked: true, spin, armed, sink: { poly: (pts, rgba) => polys.push([pts, rgba]), line() {} } });
  for (const [pts, rgba] of polys) {
    const P = pts.map(projM);
    if (P.some((q) => q.z <= near)) continue;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgba);
    const rv = m ? [+m[1], +m[2], +m[3]] : [38, 43, 49];
    let z = 0, nf = Infinity, xf = -Infinity;
    for (const q of P) { z += q.z; if (q.z < nf) nf = q.z; if (q.z > xf) xf = q.z; }
    const avgZ = z / P.length;
    drawn.push({ P, role: 'rotor', avgZ, alpha: 1, nf, xf, hf: null, af: avgZ, i: drawn.length, rv, col: `rgb(${rv[0]},${rv[1]},${rv[2]})` });
  }
}
const RUN_EASE = (k) => k * k * (3 - 2 * k);
// A folding rotor's held stop angle, and how far its blades stand up while they swing aft.
const FOLD_STOP = new Map();
const FOLD_TILT = 80 * Math.PI / 180;
function drawRotorFXInner(ctx, cls, projFn, { spin = 0, power = 0.7, parked = false, disc = null, spool = null, bladeFade = 0, armed = false, anim = null } = {}) {
  const dsc = disc != null ? disc : power;      // blur-disc opacity
  const spl = spool != null ? spool : 1;        // blade motion amount
  // A mesh-file class carries its rotors (`rotors`): position, plane, direction, speed.
  const rs = rotorsFor(cls, armed);
  if (rs) {
    for (const r of rs) {
      const sp = r.spinMul == null && r.phase == null ? spin : spin * (r.spinMul ?? 1) + (r.phase ?? 0);
      // Sliding rotor (`slide: { ch, by }`): moves by `by` at 1, matching the part's `anim.slide`.
      const sl = r.slide ? clampN(anim?.[r.slide.ch] ?? 0, 0, 1) : 0;
      const at = sl ? [r.at[0] + r.slide.by[0] * sl, r.at[1] + r.slide.by[1] * sl, r.at[2] + r.slide.by[2] * sl] : r.at;
      // Rotor on a channel (`run`): stopped at `phase` at 0, full speed at 1. The offset is eased modulo one blade
      // step so it never jumps a turn. Stateless, so a fast spool-up aliases (reads as a blur).
      if (r.run) {
        const e = RUN_EASE(clampN(anim?.[r.run] ?? 0, 0, 1));
        const n = r.blades, step = Math.PI * 2 / n, a0 = r.phase ?? 0;
        const d = (((sp - a0) % step) + step * 1.5) % step - step / 2;
        spinDisc(ctx, projFn, at, r.U, r.V, r.r, a0 + d * e, dsc * e, spl * e, parked, n, 0.95 + (r.lead - 0.95) * e, bladeFade);
        continue;
      }
      // Folding rotor: past zero the blades stop and swing aft together, `spread` degrees apart.
      const ft = r.fold ? clampN(anim?.[r.fold.ch] ?? 0, 0, 1) : 0;
      if (!(ft > 0)) FOLD_STOP.delete(r);
      if (ft > 0) {
        // ⚠ The blades hold the angle they had when the fold began (`spin` keeps running for the pusher).
        if (!FOLD_STOP.has(r)) FOLD_STOP.set(r, sp);
        const s0 = FOLD_STOP.get(r);
        // ⚠ Never sweep flat through the tail: fold up (0-0.2), swing aft (0.2-0.5), ride down (to 0.75), then lie flat.
        const seg = (a, b) => RUN_EASE(clampN((ft - a) / (b - a), 0, 1));
        const tilt = FOLD_TILT * (seg(0, 0.2) - seg(0.75, 1)), swing = seg(0.2, 0.5);
        const n = r.blades, step = Math.PI * 2 / n, aft = (r.fold.aft ?? 180) * Math.PI / 180, spr = (r.fold.spread ?? 10) * Math.PI / 180;
        // ⚠ `fold.tuck` moves the hub with the telescoping mast, linearly, matching the mast part's slide.
        const tk = r.fold.tuck;
        const hub = tk ? [at[0] + tk[0] * ft, at[1] + tk[1] * ft, at[2] + tk[2] * ft] : at;
        // Disc normal, turned skyward.
        let N = [r.U[1] * r.V[2] - r.U[2] * r.V[1], r.U[2] * r.V[0] - r.U[0] * r.V[2], r.U[0] * r.V[1] - r.U[1] * r.V[0]];
        if (N[2] < 0) N = N.map((v) => -v);
        const ct = Math.cos(tilt), st = Math.sin(tilt);
        for (let i = 0; i < n; i++) {
          const a0 = s0 + i * step, a1 = aft + (i - (n - 1) / 2) * spr;
          const d = ((a1 - a0) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
          const a = a0 + d * swing, ca = Math.cos(a), sa = Math.sin(a);
          const D = [0, 1, 2].map((k) => (r.U[k] * ca + r.V[k] * sa) * ct + N[k] * st);
          const W = [0, 1, 2].map((k) => r.V[k] * ca - r.U[k] * sa);
          spinDisc(ctx, projFn, hub, D, W, r.r, 0, 0, 0, true, 1, r.lead, bladeFade, [0]);
        }
        continue;
      }
      spinDisc(ctx, projFn, at, r.U, r.V, r.r, sp, dsc, spl, parked, r.blades, r.lead, bladeFade);
    }
  } else if (cls === 'heli') {
    legacyHeliRotorFX(ctx, projFn, armed, spin, dsc, spl, parked, bladeFade);
  } else {
    // Nose and wing props.
    const blades = (cls === 'ultralight' || cls === 'grasshopper') ? 2 : 3;
    // A station at the spinner apex is walked back to the cone root (`off`); `rad` is the disc size.
    const off = { ultralight: -0.06, grasshopper: -0.075, locust: -0.095, divebomber: -0.115 }[cls] ?? 0.03;
    const rad = { locust: 0.26, divebomber: 0.30 }[cls] ?? 0.21;
    for (const st of (PROP_STATIONS[cls] || [])) {
      spinDisc(ctx, projFn, [st[0] + off, st[1], st[2]], [0, 0, 1], [0, 1, 0],
        rad, spin * 2.2 + st[1] * 3, dsc, spl, parked, blades, 0.5, bladeFade);
    }
  }
}

// A class's mesh-file rotors, resolved, or null. Memoised on the row because this runs per contact per frame.
const _rotorMemo = new WeakMap();
export function rotorsFor(cls, armed = false) {
  const id = meshIdFor(cls, armed);
  if (!id) return null;
  const row = meshRow(id);
  if (!_rotorMemo.has(row)) _rotorMemo.set(row, resolveRotors(row));
  return _rotorMemo.get(row);
}
// Whether the class hangs under a horizontal rotor (the ground shadow asks).
export function hasMainRotor(cls) {
  const rs = rotorsFor(cls, false);
  if (rs) return rs.some((r) => r.U[0] === 1 && r.V[2] === 0 && r.V[0] === 0);
  return cls === 'heli';
}
// The rotor layer's draw calls as one string, for the mesh gate's rotor-vs-legacy comparison.
function rotorTraceCtx() {
  let log = '';
  const rec = (name) => (...a) => { log += name + '(' + a.map((x) => typeof x === 'number' ? x.toPrecision(12) : String(x)).join(',') + ');'; };
  const ctx = { beginPath: rec('b'), moveTo: rec('m'), lineTo: rec('l'), closePath: rec('c'), fill: rec('f'), stroke: rec('s'), arc: rec('a') };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth']) Object.defineProperty(ctx, k, { set: (v) => { log += k + '=' + v + ';'; } });
  return { ctx, out: () => log };
}
const traceProj = ([f, g, h]) => ({ sx: 200 + f * 90 + g * 60, sy: 150 - h * 90 + g * 20 + f * 10 });
export function rotorTrace(cls, st = {}) {
  const t = rotorTraceCtx();
  drawRotorFX(t.ctx, cls, traceProj, { power: 0.7, ...st });
  return t.out();
}
export function rotorTraceLegacy(cls, st = {}) {
  const t = rotorTraceCtx();
  const was = _legacyMeshes;
  _legacyMeshes = true;
  try { drawRotorFX(t.ctx, cls, traceProj, { power: 0.7, ...st }); } finally { _legacyMeshes = was; }
  return t.out();
}

// The heli rotors before they moved into mesh files. Kept for setLegacyMeshes(true) and the gate's trace.
function legacyHeliRotorFX(ctx, projFn, armed, spin, dsc, spl, parked, bladeFade) {
  {
    // Main rotor (f-g plane) and tail rotor (f-h plane), geared ~5x. The armed Viper's anchors and radii go
    // through viperXf; the axes don't need it.
    const P  = armed ? viperXf : (v) => v;      // positions: scale
    const R  = armed ? VIPER_SCALE : 1;         // radii: scale
    spinDisc(ctx, projFn, P([0.1, 0, 0.34]), [1, 0, 0], [0, 1, 0], 1.02 * R, spin, dsc, spl, parked, 2, 0.85, bladeFade);
    spinDisc(ctx, projFn, P([-1.04, 0.07, 0.12]), [1, 0, 0], [0, 0, 1], 0.19 * R, spin * 4.7 + 1.1, dsc, spl, parked, 2, 0.7, bladeFade);
  }
}

// The prop seen from the pilot's seat, head-on in the windscreen. Single centred nose props only.
// `cx`/`cy` is the disc centre and `rad` its screen radius; projFn maps g to x and h to y.
export function drawCockpitProp(ctx, cls, { cx, cy, rad, spin = 0, disc = 0, spool = 0 }) {
  const st = PROP_STATIONS[cls];
  if (!st || cls === 'prop' || st.length !== 1 || st[0][1] !== 0) return;   // one centred nose prop only
  const S = rad / 0.21;                                       // model disc r (0.21) → screen px
  // bladeFade: past half throttle the blades melt into the disc instead of strobing.
  drawRotorFX(ctx, cls, ([, g, h]) => ({ sx: cx + g * S, sy: cy - h * S }), { spin, disc, spool, bladeFade: 0.9 });
}

// One spinning disc: centre C, unit axes U/V, radius r. `lead` is the front blade's opacity.
function spinDisc(ctx, projFn, C, U, V, r, spin, disc, spool, parked, blades, lead, bladeFade = 0, angs = null) {
  const at = (a, rad, wPerp) => {   // point at polar (a, rad) offset wPerp across the blade
    const ca = Math.cos(a), sa = Math.sin(a);
    return projFn([
      C[0] + (U[0] * ca + V[0] * sa) * rad + (V[0] * ca - U[0] * sa) * wPerp,
      C[1] + (U[1] * ca + V[1] * sa) * rad + (V[1] * ca - U[1] * sa) * wPerp,
      C[2] + (U[2] * ca + V[2] * sa) * rad + (V[2] * ca - U[2] * sa) * wPerp]);
  };
  if (FX_SINK) {
    const mdl = (a, rad, wPerp) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      return [0, 1, 2].map((k) => C[k] + (U[k] * ca + V[k] * sa) * rad + (V[k] * ca - U[k] * sa) * wPerp);
    };
    sinkDisc(at, mdl, r, spin, disc, spool, parked, blades, lead, bladeFade, angs);
    return;
  }
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
    for (let i = 0; i < blades; i++) blade(angs ? angs[i] : spin + i * step, 'rgba(38,43,49,0.95)');
    // A tiny hub cap capped in px, so it never balloons into a floating sphere edge-on.
    ctx.fillStyle = 'rgba(30,34,40,0.95)';
    ctx.beginPath(); ctx.arc(hub.sx, hub.sy, Math.max(1, Math.min(rpx * 0.03, 4)), 0, 7); ctx.fill();
    return;
  }
  // Blur disc and tip ring fade in with `disc`.
  const dFade = clampN(disc * 3.5, 0, 1);
  if (dFade > 0.01) {
    // ⚠ Segment count is solved for screen size: keep the sagitta r(1 - cos(pi/N)) under 0.4 px, N >= pi*sqrt(r/0.8).
    // A fixed 16 showed as a faceted pale shape over the windscreen.
    const NS = Math.max(16, Math.min(96, Math.ceil(Math.PI * Math.sqrt(Math.max(1, rpx) / 0.8))));
    const rim = [];
    for (let i = 0; i < NS; i++) { const q = at(i / NS * Math.PI * 2, r, 0); if (!q) return; rim.push(q); }
    ctx.beginPath(); ctx.moveTo(rim[0].sx, rim[0].sy);
    for (let i = 1; i < NS; i++) ctx.lineTo(rim[i].sx, rim[i].sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(205,216,226,${dFade * (0.06 + disc * 0.09)})`; ctx.fill();
    ctx.strokeStyle = `rgba(228,238,246,${dFade * (0.14 + disc * 0.16)})`; ctx.lineWidth = 1; ctx.stroke();
  }
  // Blades drag more fading ghosts as `spool` climbs. `bladeFade` (cockpit only) dissolves them into the disc.
  const bladeVis = 1 - bladeFade * clampN((disc - 0.5) / 0.45, 0, 1);
  const ghosts = spool > 0.55 ? 3 : spool > 0.18 ? 2 : 1;
  if (bladeVis > 0.02) for (let i = 0; i < blades; i++) {
    for (let k = 0; k < ghosts; k++) blade(spin + i * step - k * 0.17 * spool, `rgba(36,41,47,${lead * bladeVis * Math.pow(0.42, k)})`);
  }
  ctx.fillStyle = 'rgba(30,34,40,0.9)';
  ctx.beginPath(); ctx.arc(hub.sx, hub.sy, Math.max(1, Math.min(rpx * 0.045, 6)), 0, 7); ctx.fill();
  // Tip glint, only while the disc shows.
  if (dFade > 0.05) {
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) { const q = at(spin * 1.3 + i * 0.14, r * 0.99, 0); if (!q) return; i === 0 ? ctx.moveTo(q.sx, q.sy) : ctx.lineTo(q.sx, q.sy); }
    ctx.strokeStyle = `rgba(240,248,255,${dFade * (0.2 + disc * 0.25)})`; ctx.lineWidth = 1.4; ctx.stroke();
  }
}
// spinDisc's picture handed to FX_SINK in model space, with the same sizes, colours and order.
// `at` still gives the screen radius for the segment count and hub cap.
function sinkDisc(at, mdl, r, spin, disc, spool, parked, blades, lead, bladeFade, angs) {
  const hub = at(0, 0, 0), tip = at(0, r, 0);
  const rpx = hub && tip ? Math.hypot(tip.sx - hub.sx, tip.sy - hub.sy) : 0;
  const step = Math.PI * 2 / blades;
  const blade = (a, fill) => FX_SINK.poly([mdl(a, r * 0.12, r * 0.085), mdl(a, r, r * 0.045), mdl(a, r, -r * 0.045), mdl(a, r * 0.12, -r * 0.085)], fill);
  const ring = (n, rad) => { const out = []; for (let i = 0; i < n; i++) out.push(mdl(i / n * Math.PI * 2, rad, 0)); return out; };
  const cap = (frac, maxPx, fill) => {
    const px = rpx > 0 ? Math.max(1, Math.min(rpx * frac, maxPx)) : r * frac;
    FX_SINK.poly(ring(8, rpx > 0 ? r * px / rpx : px), fill);
  };
  if (parked) {
    for (let i = 0; i < blades; i++) blade(angs ? angs[i] : spin + i * step, 'rgba(38,43,49,0.95)');
    cap(0.03, 4, 'rgba(30,34,40,0.95)');
    return;
  }
  const dFade = clampN(disc * 3.5, 0, 1);
  if (dFade > 0.01) {
    const NS = Math.max(16, Math.min(96, Math.ceil(Math.PI * Math.sqrt(Math.max(1, rpx) / 0.8))));
    const rim = ring(NS, r);
    FX_SINK.poly(rim, `rgba(205,216,226,${dFade * (0.06 + disc * 0.09)})`);
    FX_SINK.line([...rim, rim[0]], `rgba(228,238,246,${dFade * (0.14 + disc * 0.16)})`, 1);
  }
  const bladeVis = 1 - bladeFade * clampN((disc - 0.5) / 0.45, 0, 1);
  const ghosts = spool > 0.55 ? 3 : spool > 0.18 ? 2 : 1;
  if (bladeVis > 0.02) for (let i = 0; i < blades; i++) {
    for (let k = 0; k < ghosts; k++) blade(spin + i * step - k * 0.17 * spool, `rgba(36,41,47,${lead * bladeVis * Math.pow(0.42, k)})`);
  }
  cap(0.045, 6, 'rgba(30,34,40,0.9)');
  if (dFade > 0.05) {
    const g = [];
    for (let i = 0; i <= 4; i++) g.push(mdl(spin * 1.3 + i * 0.14, r * 0.99, 0));
    FX_SINK.line(g, `rgba(240,248,255,${dFade * (0.2 + disc * 0.25)})`, 1.4);
  }
}

// ── Tuning the parameter tables from outside ──
// The Modelshop overrides a row with setVehicleParams() and gets the real builder back.
// Every read goes through fwParams()/truckShape()/boatShape(), or a slider moves half the vehicle.
// ⚠ A change must bust the mesh cache: aircraftFaces' memo key doesn't include the params.
// Design-time only: an override lives in one tab until cleared or reloaded.
const _vehOverride = { fw: new Map(), truck: new Map(), boat: new Map() };
function overrideTable(kind) {
  const t = _vehOverride[kind];
  if (!t) throw new Error('unknown vehicle parameter table: ' + kind);
  return t;
}
// The one place that names the tables.
const KIND_TABLE = () => ({ fw: FW_PARAMS, truck: TRUCK_SHAPES, boat: BOAT_SHAPES });
function baseRow(kind, id) { return (KIND_TABLE()[kind] || {})[id] || null; }
function fwParams(cls) { return _vehOverride.fw.get(cls) || FW_PARAMS[cls] || null; }
function truckShape(id) { return _vehOverride.truck.get(id) || TRUCK_SHAPES[id] || null; }
function boatShape(id) { return _vehOverride.boat.get(id) || BOAT_SHAPES[id] || null; }
// A copy, so an editor can't edit the table it overrides.
export function vehicleParamBase(kind, id) {
  const row = baseRow(kind, id);
  return row ? { ...row } : null;
}
export function vehicleParamIds(kind) { return Object.keys(KIND_TABLE()[kind] || {}); }
// `patch` merges onto the shipping row; `null` drops the override.
export function setVehicleParams(kind, id, patch) {
  const t = overrideTable(kind);
  const row = baseRow(kind, id);
  if (!row) throw new Error('no such vehicle row: ' + kind + '/' + id);
  if (patch === null) t.delete(id); else t.set(id, { ...row, ...patch });
  clearVehicleFacesCache();
}
export function clearVehicleParams() {
  for (const t of Object.values(_vehOverride)) t.clear();
  clearVehicleFacesCache();
}

// Per-class fixed-wing parameters (normalised units).
const FW_DEFAULT = {
  noseF: 1.05, tailF: -1.05, fr: 0.12, fv: 0.12, span: 0.95, wingH: 0,
  wRootF: 0.30, wRootB: -0.05, wTipF: 0.14, wTipB: -0.02, dih: 0.05,
  hF: -0.80, hB: -1.02, hTipF: -0.86, hTipB: -1.04, hSpan: 0.40,
  finF0: -0.74, finF1: -0.98, finF2: -1.06, finH: 0.50, fins: [0],
  engines: [-0.24, 0.24], nacF: -0.02, nacH: -0.02,
};
// ── The fixed-wing rows ──
// Rows live in content/vehicle_models/fw_*.json via `npm run vehicles:bake`. A row is the resolved set,
// not a patch over FW_DEFAULT. No `ultralight` or `grasshopper` row: they're hand-built (buildCessna, buildCub).
// Per-class notes: see docs/systems-flight.md#fixed-wing-parameter-rows
const FW_PARAMS = FW_ROWS;

// Starboard wingtip station [f, g, h], mid-chord, for nav lights. Mirror g for port. No wings gives null.
export function wingtipStation(cls) {
  const ml = meshNavLamp(cls);
  if (ml !== undefined) return ml;
  if (cls === 'heli') return null;
  // ⚠ Trucks and boats have no wings; the fall-through would hang lamps on a Twin Otter's tips.
  if (cls === 'truck') return null;
  if (boatShape(cls)) return null;
  // The Cessna and Cub tips come off their own wing constants.
  if (cls === 'ultralight') return [(cePt(CE_SPAN, 0, 0.5)[0] + cePt(CE_SPAN, 1, 0.5)[0]) / 2, CE_SPAN, cePt(CE_SPAN, 0.5, 0.5)[2]];
  if (cls === 'grasshopper') return [(cuPt(CU_SPAN, 0, 0.5)[0] + cuPt(CU_SPAN, 1, 0.5)[0]) / 2, CU_SPAN, cuPt(CU_SPAN, 0.5, 0.5)[2]];
  const p = fwParams(cls) || fwParams('prop');
  // A gull wing's tip isn't wingH+dih; ask the wing.
  const tip = wingPt(p, p.wingH || 0, 1, 1, 'le'), tipB = wingPt(p, p.wingH || 0, 1, 1, 'te');
  return [(tip[0] + tipB[0]) / 2, p.span, tip[2]];
}

// A road vehicle's lamp stations, in mesh space. ⚠ Every number comes from truckLampGeom, which buildTruck
// builds the lenses from: a second opinion about where a lamp is will drift off it.
export function vehicleLamps(cls, variant = '') {
  if (cls !== 'truck') return null;
  // Same variant strip as the mesh, so a fitted rig doesn't read as another type.
  const typeId = String(variant).replace(/[~^].*$/, '').split('+')[0];
  const FITS = new Set(String(variant).match(/\^([a-z.]+)/)?.[1].split('.') || []);
  const S = truckShape(typeId) || truckShape('hauler');
  const L = truckLampGeom(S);
  // Into the mesh's drawn frame: build (or hit the cache for) the variant so its shift and settle are known.
  aircraftFaces('truck', 1, false, variant || 'hauler');
  const meta = TRUCK_META.get(String(variant || 'hauler') + ':1') || { shift: 0, drop: 0, pods: [] };
  const at = (f, g, h) => [f - meta.shift, g, h - meta.drop];
  return {
    head: [at(L.lampF + 0.004, -L.lampG, L.lampMidZ), at(L.lampF + 0.004, L.lampG, L.lampMidZ)],
    // Tail lamps move to the box's rear face when a trailer is on (`+t`), or a loaded rig shows none.
    // `tailDeck` tells the renderer to swing them about the kingpin with the trailer.
    tail: /\+t/.test(String(variant))
      ? [at(L.frame0 + 0.06 - S.deck - 0.004, -S.w * 0.86, 0.105),
         at(L.frame0 + 0.06 - S.deck - 0.004, S.w * 0.86, 0.105)]
      : [at(L.frame0 + 0.004, -S.w * 0.66, 0.085), at(L.frame0 + 0.004, S.w * 0.66, 0.085)],
    tailDeck: /\+t/.test(String(variant)),
    // Roof markers, only on trucks that build them.
    marker: S.lamps > 0.2
      ? [-2, -1, 0, 1, 2].map((i) => at(L.markF, i * S.w * 0.34, L.markZ))
      : [],
    // Lifter light: one station per pod on the ground, with its half-length (pool size) and half-width `hw` (the snow's track width).
    podGlow: (meta.pods || []).map(([f, g, halfLen, deck, halfW]) => ({ p: at(f, g, 0.002), r: halfLen, hw: halfW || 0.024, deck: !!deck })),
    // Underglow as light on the ground under the centreline, only while the engine runs.
    under: [0.18, 0.02, -0.14, -0.30].map((f) => at(L.nose0 + f, 0, 0.004)),
    // The bought underglow fitting, in the livery's `glow` colour (the same value paints the tube).
    // ⚠ Stations, never faces: a lit patch drawn as geometry reads as a box on the road.
    neon: FITS.has('ug')
      ? [0.20, 0.06, -0.10, -0.26, -0.42].flatMap((f) => [at(L.nose0 + f, -S.w * 0.86, 0.004), at(L.nose0 + f, S.w * 0.86, 0.004)])
      : [],
    // The beacon: a station and no cone.
    beacon: FITS.has('bc') ? at(L.cab0 - 0.006, 0, S.hi + S.sleeper + 0.034) : null,
  };
}

// ── Fifth-wheel gap ──
// Derived from the box's swing so its nose corner clears the cab at every angle (reach = noseHalf * sin phi
// peaks at 90 degrees). ⚠ Bought with a tapered nose (NOSE_TAPER), not length: a longer frame makes the
// depot's painter's sort lose a headlamp (shapes:smoke catches it).
const NOSE_TAPER = 0.70;                  // the box's front face, as a fraction of its body width

const PLATE_BACK = 0.06;                  // the plate's centre, aft of the frame's front end
// The margin is what gives the smoke check something to measure.
const SWING_MARGIN = 1.15;
const boxNoseHalf = (S) => S.w * 1.02 * NOSE_TAPER;
const frameBack = (S) => PLATE_BACK + boxNoseHalf(S) * SWING_MARGIN;

// Lamp stations from a truck's shape; buildTruck and vehicleLamps both read this.
function truckLampGeom(S) {
  const nose1 = 0.40, nose0 = nose1 - S.nose, cab1 = nose0, cab0 = cab1 - S.cab;
  const BUMP_TOP = 0.058, BUMP_F = nose1 + 0.012;
  const lampF = BUMP_F + 0.004, lampZ = BUMP_TOP + 0.010;
  const scrF1 = nose0 + 0.038, scrHi = S.hi * 0.985;
  return {
    nose1, nose0, cab1, cab0, frame0: cab0 - frameBack(S),
    BUMP_TOP, BUMP_F, lampF, lampZ, lampG: S.w * 0.86,
    // One glow between the two stacked lenses.
    lampMidZ: lampZ + 0.019,
    markF: scrF1 + 0.026, markZ: scrHi + 0.005,
  };
}

// Static ground attitude (deg nose-up) for renderers that draw the craft parked. Keep in step with
// `groundPitch` in flight-model.js. `armed` picks out the Viper (a taildragger) from the heli class.
export function groundPitchFor(cls, armed = false) {
  const mid = meshIdFor(cls, armed);
  if (mid && meshRow(mid).groundPitch != null) return meshRow(mid).groundPitch;
  if (cls === 'heli') return armed ? VIPER_GROUND_PITCH : 0;
  if (cls === 'grasshopper') return CUB_GROUND_PITCH;
  return fwParams(cls)?.groundPitch || 0;
}

// ── Truck draw order ──
// Sorted by part, keyed on the nearest vertex on the ground plane, with hysteresis. Lives here so all four
// truck renderers share it; see docs/reference/glass-notes.md#truck-part-sort
const _truckOrder = new Map();     // model id -> last frame's part order, for the hysteresis pass
export const _resetTruckOrder = () => _truckOrder.clear();   // smoke only: start a sweep cold
// `faces` are draw records: `nf` (nearest depth), `af` (mean), `i` (mesh order), optional `hf` and `xf`.
// Depth can be any monotonic camera distance.
export function sortTruckFaces(faces, c, SIZE) {
  // A face with no part id is its own part, which degrades to the per-face sort.
  const parts = new Map();
  for (const f of faces) {
    const k = f.part == null ? `f${f.i}` : f.part;
    let g = parts.get(k);
    if (!g) parts.set(k, g = { k, near: Infinity, far: -Infinity, i: f.i, fs: [] });
    g.fs.push(f);
    // ⚠ Key on `hf` (ground-plane depth) so a tall part can't beat a low one further forward. Without `hf`, `nf`.
    const key = f.hf != null ? f.hf : f.nf;
    if (key < g.near) g.near = key;
    // Far extent, for the disjoint test. ⚠ Falls back to mean depth, or every pair reads disjoint and hysteresis turns off.
    if (f.xf != null) { if (f.xf > g.far) g.far = f.xf; }
    else if (f.pts && f.pts.length) { for (const q of f.pts) if (q.f > g.far) g.far = q.f; }
    else if (f.af > g.far) g.far = f.af;
    if (f.i < g.i) g.i = f.i;                       // mesh order: emitted inside-out, chassis first
  }
  const order = [...parts.values()].sort((a, b) => (b.near - a.near) || (a.i - b.i));
  // ── Hysteresis ──
  // Within EPS, last frame's order wins. Adjacent swaps, because a comparator that reads the old order
  // isn't transitive. ⚠ Never hold a pair whose depth ranges don't overlap.
  const key = c.id || 'own';
  const rank = _truckOrder.get(key);
  if (rank) {
    const EPS = Math.max(1e-5, SIZE * 0.045);
    const disjoint = (a, b) => a.far < b.near || b.far < a.near;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < order.length - 1; i++) {
        const a = order[i], b = order[i + 1];
        const ra = rank.get(a.k), rb = rank.get(b.k);
        if (ra == null || rb == null) continue;     // new part this frame — let depth decide
        if (disjoint(a, b)) continue;               // unambiguous — never hold a stale order over it
        if (Math.abs(a.near - b.near) < EPS && ra > rb) { order[i] = b; order[i + 1] = a; }
      }
    }
  }
  // Capped, not swept.
  if (_truckOrder.size > 48) _truckOrder.clear();
  _truckOrder.set(key, new Map(order.map((g, idx) => [g.k, idx])));
  faces.length = 0;
  for (const g of order) {
    g.fs.sort((a, b) => b.af - a.af);
    for (const f of g.fs) faces.push(f);
  }
}

// Faces for a class (memoised; geometry is static). detail 1 is the full mesh, 0 the coarse LOD.
const _cache = {};
// `variant` is an optional fourth channel: for trucks `<typeId>[+t][~p]` (type, trailer, parked).
export function aircraftFaces(cls, detail = 1, armed = false, variant = '') {
  const key = cls + ':' + detail + (armed ? ':a' : '') + (variant ? ':' + variant : '');
  if (_cache[key]) return _cache[key];
  // ⚠ The last arm is a silent fallback: an unknown class builds as a Twin Otter. Add a new class's arm here first.
  // An authored mesh answers first. A variant named in the mesh's `variants` is a different model; any other is a paint scheme.
  const vmid = variantMeshFor(cls, variant);
  const mid = vmid || meshIdFor(cls, armed);
  const faces = mid ? compileMesh(meshRow(mid), { detail, scheme: vmid ? null : (variant || null) }).faces
    : cls === 'truck' ? buildTruck(variant || 'hauler', detail)
    : cls === 'heli' ? (armed ? buildAttackHeli() : buildHeli())
    : cls === 'ultralight' ? buildCessna(detail)
    : cls === 'grasshopper' ? buildCub(detail)
    : boatShape(cls) ? buildBoat(cls, detail)
    : buildFixedWing(fwParams(cls) || fwParams('prop'), detail);
  _cache[key] = faces;
  // ⚠ Truck keys are bounded: a key includes fittings, so a busy yard would leak. Past the cap the oldest goes.
  // The cap is a runaway guard, well above any scene.
  if (cls === 'truck') {
    _truckKeys.push(key);
    while (_truckKeys.length > TRUCK_CACHE_MAX) {
      const old = _truckKeys.shift();
      // ⚠ The meta goes with the faces. Its key is `<variant>:<detail>`, so derive it from the evicted key.
      if (old !== key) {
        delete _cache[old];
        const [, det, ...rest] = old.split(':');
        TRUCK_META.delete(rest.join(':') + ':' + det);
      }
    }
  }
  return faces;
}
// ── Authored meshes ──
// Mesh files (content/vehicle_models/mesh_*.json, baked to vehicle-meshes.js). `armedMesh` names the
// armed airframe; if it isn't authored yet the class stays on its builder.
// ⚠ The Modelshop override replaces the whole file (a merge would bring back deleted parts). Design-time only.
const _meshOverride = new Map();
let _legacyMeshes = false;
function meshRow(id) { return _meshOverride.get(id) || MESH_ROWS[id] || null; }
export function meshIdFor(cls, armed = false) {
  if (_legacyMeshes) return null;
  const base = meshRow(cls);
  if (!base) return null;
  if (armed && base.armedMesh) return meshRow(base.armedMesh) ? base.armedMesh : null;
  return cls;
}
// A variant listed in the file's `variants` is a different model (the podracer's types).
export function variantMeshFor(cls, variant) {
  if (_legacyMeshes || !variant) return null;
  const id = meshRow(cls)?.variants?.[variant];
  return id && meshRow(id) ? id : null;
}
export function meshParams(id) { return meshRow(id); }
export function meshIds() { return [...new Set([...Object.keys(MESH_ROWS), ..._meshOverride.keys()])]; }
export function setMeshOverride(id, params) {
  if (params == null) _meshOverride.delete(id); else _meshOverride.set(id, params);
  clearVehicleFacesCache();
}
// Draw meshed classes from their old builders: the A/B, and the way back. Rotor FX follow it.
export function setLegacyMeshes(on) { _legacyMeshes = !!on; clearVehicleFacesCache(); }
export function legacyMeshesOn() { return _legacyMeshes; }
function findPart(parts, pred) {
  for (const p of parts || []) {
    if (pred(p)) return p;
    const q = p.parts && findPart(p.parts, pred);
    if (q) return q;
  }
  return null;
}
// ── The hull the nose art wraps onto ── A mesh file names its fuselage loft (`hull`).
const _hullMemo = new WeakMap();
function sectionFnOf(loft) {
  const S = loft.stations.map((s) => [s.f, s.rg, s.rvT ?? s.rv, s.rvB ?? s.rv, s.cz,
    s.boxy ?? (loft.exp ? (1 - loft.exp[0]) / 0.55 : 0)]);
  return (f) => {
    if (f >= S[0][0]) return { rg: S[0][1], rvT: S[0][2], rvB: S[0][3], cz: S[0][4], boxy: S[0][5] };
    const last = S[S.length - 1];
    if (f <= last[0]) return { rg: last[1], rvT: last[2], rvB: last[3], cz: last[4], boxy: last[5] };
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1];
      if (f <= a[0] && f >= b[0]) {
        const t = (a[0] - f) / (a[0] - b[0] || 1), L = (x, y) => x + (y - x) * t;
        return { rg: L(a[1], b[1]), rvT: L(a[2], b[2]), rvB: L(a[3], b[3]), cz: L(a[4], b[4]), boxy: L(a[5], b[5]) };
      }
    }
    return { rg: last[1], rvT: last[2], rvB: last[3], cz: last[4], boxy: last[5] };
  };
}
export function meshHull(cls) {
  const id = meshIdFor(cls, false);
  const row = id && meshRow(id);
  if (!row || !row.hull) return null;
  if (_hullMemo.has(row)) return _hullMemo.get(row);
  const loft = findPart(row.parts, (p) => p.kind === 'loft' && p.name === row.hull);
  const h = loft ? { noseF: loft.stations[0].f, CS: sectionFnOf(loft) } : null;
  _hullMemo.set(row, h);
  return h;
}
// Starboard nav lamp from the file: null for none, `{ wing }` for that wing's tip, or [f, g, h]. undefined means unset.
function meshNavLamp(cls) {
  const id = meshIdFor(cls, false);
  const row = id && meshRow(id);
  if (!row || row.navLamps === undefined) return undefined;
  const nl = row.navLamps;
  if (nl === null) return null;
  if (Array.isArray(nl)) return nl;
  const w = nl.wing && findPart(row.parts, (p) => p.kind === 'wing' && p.name === nl.wing);
  return w ? wingTipStation(w) : undefined;
}
// Lamps a mesh file mounts on its skin: `{ at, n, rgb, kind }`, kind 'steady' | 'strobe' | 'beacon'. `n` lets the renderer hide far-side lamps.
export function meshLamps(cls) {
  // A boat publishes its lamps as it's built (BOAT_META); build only as a fallback.
  if (boatShape(cls)) {
    const m = BOAT_META.get(cls + ':1') || BOAT_META.get(cls + ':0');
    if (m) return m.lamps && m.lamps.length ? m.lamps : null;
    aircraftFaces(cls, 0);
    const m0 = BOAT_META.get(cls + ':0');
    return m0 && m0.lamps && m0.lamps.length ? m0.lamps : null;
  }
  const id = meshIdFor(cls, false);
  const row = id && meshRow(id);
  return (row && Array.isArray(row.lamps) && row.lamps.length) ? row.lamps : null;
}
// A moving part at its default pose for renderers with no channel values.
const poseAtRest = (f) => (f.anim ? { ...f, p: animFacePoints(f, null) } : f);
function wreckFaces() { return !_legacyMeshes && meshRow('wreck') ? meshFacesById('wreck', 1) : buildWreck(); }

// A mesh by id, for the Modelshop and the gates. Memoised on the row.
const _byId = new WeakMap();
export function meshFacesById(id, detail = 1) {
  const row = meshRow(id);
  if (!row) return null;
  let m = _byId.get(row);
  if (!m) { m = {}; _byId.set(row, m); }
  return m[detail] || (m[detail] = compileMesh(row, { detail }).faces);
}

// ── The five builders the mesh files replaced ──
// Reachable for the mesh gate and the Modelshop A/B only. Nothing that renders calls this.
export function legacyMeshFaces(id, detail = 1) {
  switch (id) {
    case 'heli': return buildHeli();
    case 'heli_armed': return buildAttackHeli();
    case 'ultralight': return buildCessna(detail);
    case 'grasshopper': return buildCub(detail);
    case 'wreck': return buildWreck();
    default: return null;
  }
}

// Drop every memoised mesh (parameter overrides only).
export function clearVehicleFacesCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
  _truckKeys.length = 0;
  TRUCK_META.clear();
}
const TRUCK_CACHE_MAX = 96;
const _truckKeys = [];

// ── Trucks (THE LONG HAUL) ──
// Ground vehicles in the same normalised [fore, right, up] box, so CONTACT_SIZE scales them.
// Each row is a proportion set: the same builder runs per type, so a new truck is a row, never a function.
//  cab     , how far forward the cab box runs (a cab-over has almost no nose; a conventional does)
//  nose    , bonnet length; 0 makes it a cab-over, which is what the little ones are
//  hi      , cab roof height, the single strongest read of size at distance
//  sleeper , 0 for a day cab; the long-haul rigs get a hump you can see from a mile off
//  axles   , rear axle groups under the tractor
//  stacks  , vertical exhaust behind the cab: nothing says heavy truck faster
//  w       , half-width
//  aero    , 0..1 how much roof fairing the cab wears (0 is a bare flat-top, 1 a full wind kit)
//  skirt   , 1 if the tractor has side fairings between the steps and the drives
//  lamps   , 0..1 how much LIGHT the thing wears: marker rows, a bar on the bumper, beltline strip
//  rig     , what a BOBTAIL carries on its bare deck ('cage' scrap hauler, 'rack' strapped load,
//             null for the long-haul tractors, which run clean because they are built to pull)
// ⚠ `hi` against `2w` sets how tall a rig reads; trailers read against `deck` (length), and `tTop` derives from `hi`.
// ⚠ Collision is unaffected: the CFIT sweep probes its own `clearZ` (windshield.js), so this table stays a visual dial.
// ⚠ `trim` (money spent, identity) gates brightwork; `fine` (distance, LOD) gates structure every rig has.
// Rows are authored in content/vehicle_models/truck_*.json.
const TRUCK_SHAPES = TRUCK_ROWS;

// ── Race boats (THE BASIN) ──
// Rows in content/vehicle_models/boat_*.json, built from boxes and lofted stations.
// ⚠ Box-built, so part-sorted: every piece stamps `part` and `cen`, and the draw path uses sortTruckFaces.
// ⚠ Authored keel-down with z = 0 at the waterline, which every consumer (ride, wake, spray, reflection) asks for.
const BOAT_SHAPES = BOAT_ROWS;
// What a built hull publishes, keyed `<id>:<detail>` (stations for drawBoatHullArt, ports, lamps). A Map so a retuned row replaces its entry.
const BOAT_META = new Map();

// Exhaust mouths, directions and flanks per zoomie, for drawBoatExhaust. ⚠ Empty until the mesh is built;
// callers tolerate that rather than force a build from an FX pass.
export function boatExhaustPorts(cls, detail = 1) {
  const m = BOAT_META.get(cls + ':' + (detail >= 1 ? 1 : 0)) || BOAT_META.get(cls + ':1');
  return (m && m.ports) || [];
}

// Header colour, published so the port gate finds the pipes without its own copy of the tint.
export function boatPipeTint(cls, detail = 1) {
  const m = BOAT_META.get(cls + ':' + (detail >= 1 ? 1 : 0)) || BOAT_META.get(cls + ':1');
  return (m && m.pipeTint) || null;
}

function buildBoat(id = 'hydro', detail = 1) {
  const S = boatShape(id) || boatShape('hydro') || {};
  const fine = detail >= 1;
  const TRIM = S.trim ?? 0.8;
  const rich = (n) => fine && TRIM >= n;
  const faces = [];
  let partSeq = 0;
  const V = (f, g, h) => [f, g, h];

  const CHROME = [228, 233, 241];
  const ACCENT = [96, 196, 214];
  const DARK = [22, 24, 28];
  // ⚠ Machinery isn't paint-keyed: as brightwork the engine took the livery's `bright` and vanished into the deck.
  const BLOCK = [38, 40, 46];        // cast iron, near black but not flat
  const POLISH = [212, 218, 226];    // a polished case — brighter than any hull
  // ⚠ Its own array: PKB keys tints by identity, so sharing CHROME would paint-key the headers.
  const PIPE = [224, 231, 240];      // zoomies, chromed
  const RUBBER = [30, 32, 36];
  // Well coaming, a shade off the house. A literal, like the machinery.
  const HOUSE_TONE_WELL = [58, 62, 70];
  const VINYL = [226, 220, 204];
  // Bottom paint: keyed to trim, so the hull is two-tone at the chine.
  const BOTTOM = [70, 74, 82];
  const PKB = (t) => (t === CHROME ? 'bright' : t === ACCENT ? 'glow' : t === BOTTOM ? 'trim' : null);
  // Material for the reflection pass (`mk`, read by windshield.js metalKOf): positive metal, negative clear coat.
  const MKB = (t, role) => (t === CHROME || t === POLISH || t === PIPE ? 0.92 : t === BLOCK ? 0.38
    : t === RUBBER || t === DARK ? -0.08 : t === ACCENT ? 0 : role === 'body' || role === 'deck' ? -0.34 : undefined);
  // ⚠ A literal tint is marked `fixed`, or faceBaseRgb paints it the livery base (an orange V8). Paint-keyed tints keep their key.
  const tag = (q, role, tint) => {
    const m = MKB(tint, role); if (m !== undefined) q.mk = m;
    if (tint && !PKB(tint) && role !== 'glass') q.fixed = 1;
    return q;
  };

  // A quad with its part id and culling centre. ⚠ For hull panels `cen` sits on the centreline, inside the hull.
  const face = (p, sh, cen, role = 'body', tint = null) => {
    const q = { role, sh, p: p.map((v) => V(v[0], v[1], v[2])), part: ++partSeq, cen };
    if (tint) { q.tint = tint; const k = PKB(tint); if (k) q.pk = k; }
    faces.push(tag(q, role, tint));
  };
  // A lofted panel shares one part id, or the hull flashes as the camera orbits.
  const strip = (quads, sh, cen, role = 'body', tint = null) => {
    const part = ++partSeq;
    for (const p of quads) {
      const q = { role, sh, p: p.map((v) => V(v[0], v[1], v[2])), part, cen };
      if (tint) { q.tint = tint; const k = PKB(tint); if (k) q.pk = k; }
      faces.push(tag(q, role, tint));
    }
  };
  const box = (f0, f1, w, z0, z1, role = 'body', tint = null, gc = 0) => {
    const gl = gc - w, gr = gc + w;
    const A = [V(f0, gl, z0), V(f0, gr, z0), V(f0, gr, z1), V(f0, gl, z1)];
    const B = [V(f1, gl, z0), V(f1, gr, z0), V(f1, gr, z1), V(f1, gl, z1)];
    const part = ++partSeq;
    const cen = [(f0 + f1) / 2, gc, (z0 + z1) / 2];
    const quad = (p, sh) => { const q = { role, sh, p, part, cen }; if (tint) { q.tint = tint; const k = PKB(tint); if (k) q.pk = k; } faces.push(tag(q, role, tint)); };
    quad([A[3], A[2], B[2], B[3]], 1.00);
    quad([A[0], B[0], B[1], A[1]], 0.42);
    quad([A[0], A[3], B[3], B[0]], 0.72);
    quad([A[1], B[1], B[2], A[2]], 0.62);
    quad([B[0], B[3], B[2], B[1]], 0.80);
    quad([A[0], A[1], A[2], A[3]], 0.55);
  };
  const tube = (from, to, r, role = 'body', tint = null, n = 6) => {
    const ax = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const L = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const u = [ax[0] / L, ax[1] / L, ax[2] / L];
    const seed = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1n = [u[1] * seed[2] - u[2] * seed[1], u[2] * seed[0] - u[0] * seed[2], u[0] * seed[1] - u[1] * seed[0]];
    const m1 = Math.hypot(e1n[0], e1n[1], e1n[2]) || 1;
    const e1 = [e1n[0] / m1, e1n[1] / m1, e1n[2] / m1];
    const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const part = ++partSeq;
    const cen = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    const ring = (p) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      return V(p[0] + e1[0] * c + e2[0] * s, p[1] + e1[1] * c + e2[1] * s, p[2] + e1[2] * c + e2[2] * s);
    });
    const A = ring(from), B = ring(to);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const sh = 0.52 + 0.46 * Math.max(0, Math.cos((i / n) * Math.PI * 2 - Math.PI / 2));
      const q = { role, sh, p: [A[i], A[j], B[j], B[i]], part, cen };
      if (tint) { q.tint = tint; const k = PKB(tint); if (k) q.pk = k; }
      faces.push(tag(q, role, tint));
    }
  };

  // ── The hull, as stations ──
  // ⚠ A deep-V is lofted from transverse stations, not boxed. The table lives in client/shared/boat-house.js,
  // shared with the interior; nothing here re-derives a station.
  const G = boatGeom(S);
  const { LEN, DECK: DK, STATIONS, atF } = G;
  // ⚠ One META object filled as the hull is built: a second `set` would wipe the stations. Lamps are published
  // for meshLamps (boats need sidelights, stern and masthead, not the aircraft default under the keel).
  const META = { stations: STATIONS, ports: [], pipeTint: PIPE, lamps: [] };
  BOAT_META.set(id + ':' + (fine ? 1 : 0), META);
  const RED_LENS = [214, 44, 40], GREEN_LENS = [44, 196, 92], WHITE_LENS = [236, 238, 232];

  // ── The bottom, as a polyline per station ──
  // One loft for deep-V, stepped vee and cat. Steps let the keel up by STEP_H each; the riser is its own dark face.
  const NSTEP = G.CAT ? 0 : Math.max(0, Math.min(3, Math.round(S.steps ?? 0)));
  const STEP_F = ({ 1: [-0.18], 2: [0.10, -0.34], 3: [0.18, -0.12, -0.42] }[NSTEP] || []).map((x) => x * LEN);
  const STEP_H = 0.007;
  const notches = (f) => STEP_F.filter((x) => x > f + 1e-9).length;
  const BOT = [];
  for (let i = 0; i < STATIONS.length; i++) {
    const a = STATIONS[i];
    BOT.push({ ...a, k: a.k + STEP_H * notches(a.f) });
    const b = STATIONS[i + 1];
    if (!b) break;
    for (const x of STEP_F) {
      if (!(x < a.f && x > b.f)) continue;
      const m = atF(x), n = notches(x);
      BOT.push({ ...m, k: m.k + STEP_H * n }, { ...m, k: m.k + STEP_H * (n + 1), riser: true });
    }
  }
  const botLine = (st) => (st.tw != null
    ? [[0, st.tz], [st.tw, st.tz], [st.tw, st.iz], [st.kg, st.k], [st.cw, st.cz]]
    : [[0, st.k], [st.cw, st.cz]]);
  // Per segment: shade and culling centre. On a cat the tunnel wall's centre is the sponson's, not the boat's.
  const segShade = G.CAT ? [0.30, 0.56, 0.40, 0.46] : [0.46];
  for (let i = 0; i < BOT.length - 1; i++) {
    const a = BOT[i], b = BOT[i + 1];
    const la = botLine(a), lb = botLine(b), fm = (a.f + b.f) / 2;
    for (const s of [-1, 1]) {
      // ⚠ Quads, not triangles: near-planar hull panels split in two came out quilted.
      if (b.riser) {
        face([[a.f, 0, a.k], [b.f, 0, b.k], [b.f, s * b.cw, b.cz]], 0.24, [fm + 0.05, 0, a.k], 'body', BOTTOM);
        continue;
      }
      for (let j = 0; j < la.length - 1; j++) {
        const cen = !G.CAT ? [fm, 0, (a.k + b.sz) / 2]
          : j === 0 ? [fm, 0, (a.sz + b.sz) / 2 + 0.02]
          : [fm, s * (a.tw + a.cw) / 2, (a.iz + a.sz) / 2];
        const sh = G.CAT ? (j === 3 ? (s < 0 ? 0.46 : 0.40) : segShade[j]) : (s < 0 ? 0.46 : 0.40);
        strip([[
          [a.f, s * la[j][0], la[j][1]], [b.f, s * lb[j][0], lb[j][1]],
          [b.f, s * lb[j + 1][0], lb[j + 1][1]], [a.f, s * la[j + 1][0], la[j + 1][1]],
        // The tunnel roof and walls are bare laminate.
        ]], sh, cen, 'body', G.CAT && j < 2 ? DARK : BOTTOM);
      }
    }
  }
  // Topside, chine to sheer, off the plain stations (steps are only in the bottom).
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i], b = STATIONS[i + 1];
    const cen = [(a.f + b.f) / 2, 0, (a.k + b.sz) / 2];
    for (const s of [-1, 1]) {
      strip([[
        [a.f, s * a.cw, a.cz], [b.f, s * b.cw, b.cz], [b.f, s * b.sw, b.sz], [a.f, s * a.sw, a.sz],
      ]], s < 0 ? 0.80 : 0.68, cen);
    }
  }

  // Transom, off the bottom's last station so a stepped keel or a cat's open tunnel closes correctly.
  const TR = BOT[BOT.length - 1];
  {
    const t = TR;
    const cen = [t.f + 0.05, 0, (t.k + t.sz) / 2];
    if (t.tw != null) {
      face([[t.f, -t.tw, t.tz], [t.f, t.tw, t.tz], [t.f, t.tw, t.sz], [t.f, -t.tw, t.sz]], 0.50, cen);
      for (const s of [-1, 1]) {
        const sc = [t.f + 0.05, s * (t.tw + t.cw) / 2, (t.k + t.sz) / 2];
        face([[t.f, s * t.tw, t.sz], [t.f, s * t.sw, t.sz], [t.f, s * t.cw, t.cz], [t.f, s * t.tw, t.iz]], 0.55, sc);
        face([[t.f, s * t.tw, t.iz], [t.f, s * t.cw, t.cz], [t.f, s * t.kg, t.k]], 0.48, sc, 'body', BOTTOM);
      }
    } else {
      face([[t.f, -t.cw, t.cz], [t.f, t.cw, t.cz], [t.f, t.sw, t.sz], [t.f, -t.sw, t.sz]], 0.55, cen);
      face([[t.f, -t.cw, t.cz], [t.f, 0, t.k], [t.f, t.cw, t.cz]], 0.48, cen, 'body', BOTTOM);
    }
  }

  // ── Strakes ── Fine detail only.
  const NSTRK = G.CAT ? 0 : Math.max(0, Math.min(3, Math.round(S.strakes ?? 0)));
  if (fine && NSTRK) {
    const us = { 1: [0.5], 2: [0.36, 0.68], 3: [0.28, 0.52, 0.76] }[NSTRK];
    us.forEach((u, j) => {
      const fMax = LEN * (0.80 - j * 0.12);
      for (const s of [-1, 1]) {
        const quads = [];
        for (let i = 0; i < BOT.length - 1; i++) {
          const a = BOT[i], b = BOT[i + 1];
          if (b.riser || a.f > fMax + 1e-9) continue;
          const on = (st) => [st.f, s * st.cw * u, st.k + (st.cz - st.k) * u];
          const lip = (st) => { const p = on(st); return [p[0], p[1] + s * 0.007, p[2] - 0.0035]; };
          quads.push([on(a), on(b), lip(b), lip(a)]);
        }
        if (quads.length) strip(quads, 0.74, [0, 0, 0.06], 'body', BOTTOM);
      }
    });
  }

  // ── The chine ── The line the two-tone split follows.
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i], b = STATIONS[i + 1];
    const cen = [(a.f + b.f) / 2, 0, (a.cz + b.cz) / 2];
    for (const s of [-1, 1]) {
      strip([[
        [a.f, s * a.cw, a.cz], [b.f, s * b.cw, b.cz],
        [b.f, s * (b.cw + 0.012), b.cz - 0.006], [a.f, s * (a.cw + 0.012), a.cz - 0.006],
      ]], 0.92, cen, 'body', rich(0.5) ? CHROME : null);
    }
  }

  // ── The deck ──
  // ⚠ The well starts where the house ends (houseF0), derived so the two can't disagree.
  const cpF1 = S.cockpitF1 ?? (S.houseF0 ?? -0.54), cpF0 = S.cockpitF0 ?? -0.88;
  const crown = S.crown ?? 0.012;
  // ⚠ The well is cut at its own two ends (added as deck stations), not at whichever stations fall in it.
  const DECK_ST = [...STATIONS.map((x) => x.f), cpF1, cpF0].filter((f, i, a) => a.indexOf(f) === i)
    .sort((x, y) => y - x).map((f) => ({ ...atF(f), f }));
  for (let i = 0; i < DECK_ST.length - 1; i++) {
    const a = DECK_ST[i], b = DECK_ST[i + 1];
    if (a.f <= cpF1 + 1e-9 && b.f >= cpF0 - 1e-9) continue;
    const cen = [(a.f + b.f) / 2, 0, (a.sz + b.sz) / 2 - 0.05];
    for (const s of [-1, 1]) {
      strip([[
        [a.f, s * a.sw, a.sz], [b.f, s * b.sw, b.sz],
        [b.f, 0, b.sz + crown], [a.f, 0, a.sz + crown],
      ]], 1.00, cen, 'deck');
    }
  }
  // The gunwale cap round the cockpit well, so the opening has an edge.
  {
    const gz = (f) => {
      for (let i = 0; i < STATIONS.length - 1; i++) {
        const a = STATIONS[i], b = STATIONS[i + 1];
        if (f <= a.f && f >= b.f) { const t = (a.f - f) / (a.f - b.f || 1); return [a.sw + (b.sw - a.sw) * t, a.sz + (b.sz - a.sz) * t]; }
      }
      return [STATIONS[STATIONS.length - 1].sw, STATIONS[STATIONS.length - 1].sz];
    };
    const N = 6;
    for (let i = 0; i < N; i++) {
      const f0 = cpF1 + (cpF0 - cpF1) * (i / N), f1 = cpF1 + (cpF0 - cpF1) * ((i + 1) / N);
      const [w0, z0] = gz(f0), [w1, z1] = gz(f1);
      const cen = [(f0 + f1) / 2, 0, (z0 + z1) / 2 - 0.04];
      for (const s of [-1, 1]) {
        strip([[
          [f0, s * w0, z0], [f1, s * w1, z1],
          [f1, s * w1 * 0.80, z1 - 0.030], [f0, s * w0 * 0.80, z0 - 0.030],
        ]], 0.58, cen);
      }
    }
    // The sole. ⚠ It's also the cabin floor (`G.soleZ`), or a step shows through the doorway.
    const [wa, za] = gz(cpF1), [wb, zb] = gz(cpF0);
    face([[cpF1, -wa * 0.78, G.soleZ], [cpF1, wa * 0.78, G.soleZ],
          [cpF0, wb * 0.78, G.soleZ], [cpF0, -wb * 0.78, G.soleZ]], 0.66, [(cpF0 + cpF1) / 2, 0, 0]);
    // ⚠ The well needs walls: the hull is a shell of outward faces, so without them the sea shows through.
    // The forward bulkhead leaves the doorway open.
    const wall = [];
    for (let i = 0; i < N; i++) {
      const f0 = cpF1 + (cpF0 - cpF1) * (i / N), f1 = cpF1 + (cpF0 - cpF1) * ((i + 1) / N);
      const [w0, z0] = gz(f0), [w1, z1] = gz(f1);
      for (const s of [-1, 1]) {
        wall.push({ s, q: [[f0, s * w0 * 0.80, z0 - 0.030], [f1, s * w1 * 0.80, z1 - 0.030],
          [f1, s * w1 * 0.78, G.soleZ], [f0, s * w0 * 0.78, G.soleZ]] });
      }
    }
    for (const s of [-1, 1]) {
      strip(wall.filter((w) => w.s === s).map((w) => w.q), 0.50, [(cpF0 + cpF1) / 2, s * wa * 1.6, G.soleZ], 'body', HOUSE_TONE_WELL);
    }
    face([[cpF0, -wb * 0.78, G.soleZ], [cpF0, wb * 0.78, G.soleZ], [cpF0, wb * 0.80, zb - 0.030], [cpF0, -wb * 0.80, zb - 0.030]],
      0.62, [cpF0 - 0.05, 0, G.soleZ], 'body', HOUSE_TONE_WELL);
    const dW = G.door.halfW;
    for (const s of [-1, 1]) {
      face([[cpF1, s * dW, G.soleZ], [cpF1, s * wa * 0.78, G.soleZ], [cpF1, s * wa * 0.80, za - 0.030], [cpF1, s * dW, za]],
        0.44, [cpF1 + 0.05, s * wa * 0.5, G.soleZ], 'body', HOUSE_TONE_WELL);
    }
  }

  // ── The pilothouse ── Enclosed, because no crew is rendered. Design notes:
  // see docs/reference/glass-notes.md#boat-pilothouse
  const GLASS = [58, 78, 98];
  const HOUSE = [26, 28, 33];
  {
    // ⚠ Every number comes from boat-house.js (shared with the interior). Destructure here, before any read (TDZ).
    const { hF1, hF0, hH, rake, TUM, WRAP, NOSE, fw, fwT, rF, hw, hz, cen } = G;

    // ── The sides ──
    // Side aperture: a teardrop parameterised from its aft point (`u` 0 there, 1 at the screen).
    const { sillF, uOf } = G;
    // Rounded aft end (elliptical `half`); the sill is a near-flat beltline and the head carries the shape.
    const { sillAt, headAt } = G;
    // ⚠ One part per surface, and few large planes: the renderer is flat-shaded, so subdividing makes sawteeth.
    // ⚠ A flat inset pane behind a finely cut shell aperture: the edge wants many stations, the glass few.
    // The side runs forward to the wrap's foot so the pillar's raked edge trims it.
    const { sideF1 } = G;
    const NS = Math.max(2, Math.round(S.houseSegs ?? 4));    // panes — few, for the sheen
    // The shell's edge sheds stations at range.
    const NT = Math.max(5, Math.round((S.trimSegs ?? 14) * (fine ? 1 : 0.4)));
    const { INSET } = G;                                     // how far the pane sits behind the wall
    // The painted band round the aperture, thin over the glass and broad at the aft pillar.
    const { bandAt, gLo } = G;    // the painted band, and the pane's foot under the widest part of it
    for (const s of [-1, 1]) {
      const shade = s < 0 ? 0.76 : 0.64;
      // ⚠ Triangles: a lofted panel is bilinear, and the culler drops half of a twisted quad.
      const t = (a, b, c) => [a, b, c];
      const P = (f, tt) => [f, s * hw(f, tt), hz(f, tt)];                    // the wall
      const G = (f, tt) => [f, s * hw(f, tt) * INSET, hz(f, tt)];            // the pane, set in

      // The pane.
      const glazed = [];
      for (let i = 0; i < NS; i++) {
        const fa = hF0 + (sideF1 - hF0) * (i / NS), fb = hF0 + (sideF1 - hF0) * ((i + 1) / NS);
        glazed.push(t(G(fa, gLo), G(fb, gLo), G(fb, 1)), t(G(fa, gLo), G(fb, 1), G(fa, 1)));
      }
      strip(glazed, shade + 0.16, cen, 'glass', GLASS);

      // The shell with the teardrop cut out; the bands tile exactly so the pane shows only through the hole.
      const frame = [], dark = [], solid = [], capped = [];
      for (let i = 0; i < NT; i++) {
        const fa = hF0 + (sideF1 - hF0) * (i / NT), fb = hF0 + (sideF1 - hF0) * ((i + 1) / NT);
        const ta = sillAt(fa), tb = sillAt(fb), ha = headAt(fa), hb = headAt(fb);
        const ba = bandAt(fa), bb = bandAt(fb);
        const uA = Math.min(1, ha + ba), uB = Math.min(1, hb + bb);          // top of the upper band
        const lA = Math.max(gLo, ta - ba), lB = Math.max(gLo, tb - bb);      // foot of the lower band
        const band = (z0a, z0b, z1a, z1b, into) => {
          if (Math.min(z1a - z0a, z1b - z0b) <= 0.004) return;               // degenerate — see below
          into.push(t(P(fa, z0a), P(fb, z0b), P(fb, z1b)), t(P(fa, z0a), P(fb, z1b), P(fa, z1a)));
        };
        // ⚠ Skip zero-height bands: no area means no normal, and the culler flickers on it.
        band(ha, hb, uA, uB, frame);        // the painted band over the glass
        band(uA, uB, 1, 1, dark);           // and the house's own dark above it
        band(lA, lB, ta, tb, frame);        // the painted band under the glass
        band(gLo, gLo, lA, lB, dark);       // and the house's own dark below it
        band(0, 0, gLo, gLo, solid);        // the topside, under the whole aperture
        // Bright line along the bottom of the glass.
        if ((hb - tb) > 0.004 || (ha - ta) > 0.004) {
          const lo = (f, tt) => [f, s * hw(f, tt), hz(f, tt) - 0.006];
          capped.push(t(P(fa, ta), P(fb, tb), lo(fb, tb)), t(P(fa, ta), lo(fb, tb), lo(fa, ta)));
        }
      }
      if (solid.length) strip(solid, shade, cen, 'body', HOUSE);
      if (dark.length) strip(dark, shade + 0.06, cen, 'body', HOUSE);
      if (frame.length) strip(frame, shade + 0.10, cen);                     // no tint: the livery
      if (capped.length) strip(capped, 0.94, cen, 'body', rich(0.5) ? CHROME : HOUSE);
    }

    // ── The screen ── Lofted across the beam, pulled aft as `u^BEND`, so the outer third does the turning.
    const wBot = hw(hF1, 0), wTop = hw(rF, 1);
    const BEND = S.screenBend ?? 2.1;       // how late in the sweep the corner turns
    const NW = Math.max(3, Math.round((S.screenSegs ?? 6) * (fine ? 1 : 0.5)));
    {
      const tSill = sillAt(fw);
      // ⚠ `u` is a lateral fraction with y = 0 at u = 0, or the middle of the windscreen goes missing.
      const botAt = (u) => { const w = Math.pow(u, BEND);
        const f = hF1 + (fw - hF1) * w;
        return [f, hw(fw, tSill) * u, hz(hF1, 0) + (hz(fw, tSill) - hz(hF1, 0)) * w]; };
      // The top edge lands further aft (`screenRakeSide`) so the corner keeps its rake.
      const topAt = (u) => { const w = Math.pow(u, BEND);
        const f = rF + (fwT - rF) * w;
        return [f, hw(fw, 1) * u, hz(rF, 1) + (hz(fwT, 1) - hz(rF, 1)) * w]; };
      for (const s of [-1, 1]) {
        const pane = [], sill = [];
        for (let i = 0; i < NW; i++) {
          const ua = i / NW, ub = (i + 1) / NW;
          const ba = botAt(ua), bb = botAt(ub), ta = topAt(ua), tb = topAt(ub);
          const S3 = (p) => [p[0], s * p[1], p[2]];
          pane.push([S3(ba), S3(bb), S3(tb)], [S3(ba), S3(tb), S3(ta)]);
          const drop = (p) => [p[0], s * p[1], p[2] - 0.012];
          sill.push([S3(ba), S3(bb), drop(bb)], [S3(ba), drop(bb), drop(ba)]);
        }
        // One part for the whole side, one shade across the wrap.
        strip(pane, s < 0 ? 0.94 : 0.86, cen, 'glass', GLASS);
        strip(sill, 0.70, cen, 'body', HOUSE);
      }
    }
    // ── The pillar ── A broad swept blade in the livery (no tint), carrying the hardtop.
    const apW = S.pillarW ?? 0.040;
    for (const s of [-1, 1]) {
      // On the wrap's outboard edge, constant width, foot and head following the screen's rake.
      const fb0 = fw + 0.006, fb1 = fw - apW;         // foot, and a pillar's width aft of it
      const ft0 = fwT + 0.006, ft1 = fwT - apW;       // head, the same two, further aft
      const s0 = sillAt(fw), s1 = sillAt(fb1);
      const b0 = [fb0, s * hw(fw, s0) * 1.04, hz(fw, s0)];
      const b1 = [fb1, s * hw(fb1, s1) * 1.04, hz(fb1, s1)];
      const t0 = [ft0, s * hw(fwT, 1) * 1.04, hz(fwT, 1)];
      const t1 = [ft1, s * hw(ft1, 1) * 1.04, hz(ft1, 1)];
      const sh = s < 0 ? 0.82 : 0.68;
      strip([[b0, b1, t1, t0]], sh, cen);                                   // the outboard face
      // Inboard return so the blade has thickness edge-on.
      const inb = (p) => [p[0], p[1] - s * apW * 0.5, p[2]];
      strip([[inb(b0), inb(b1), inb(t1), inb(t0)]], sh - 0.22, cen);
      strip([[b0, inb(b0), inb(t0), t0]], sh + 0.14, cen);
    }

    // ── The cowl ── A fairing off the screen's foot into the foredeck, riding the sheer (the deck rises forward).
    if ((S.cowlL ?? 0) > 0.01) {
      const cL = S.cowlL, cR = S.cowlRise ?? 0.020, NC = 4;
      const cap = [], flank = [];
      const cw = (q) => hw(hF1, 0) * (0.72 - 0.46 * q * q);   // narrowing toward the bow
      const cz = (f, q) => atF(f).sz + cR * (1 - q) * (1 - q);  // and settling onto the deck
      for (let i = 0; i < NC; i++) {
        const qa = i / NC, qb = (i + 1) / NC;
        const fa = hF1 + cL * qa, fb = hF1 + cL * qb;
        const wa = cw(qa), wb = cw(qb), za = cz(fa, qa), zb = cz(fb, qb);
        cap.push([[fa, -wa, za], [fb, -wb, zb], [fb, wb, zb], [fa, wa, za]]);
        for (const s of [-1, 1]) {
          flank.push([[fa, s * wa, za], [fb, s * wb, zb], [fb, s * wb, atF(fb).sz], [fa, s * wa, atF(fa).sz]]);
        }
      }
      // Culling centre inside the fairing.
      const ccen = [hF1 + cL * 0.4, 0, atF(hF1).sz + cR * 0.4];
      strip(cap, 0.98, ccen);
      strip(flank, 0.74, ccen);
    }

    // ── The back wall and door ── A recess, not a shade change.
    {
      const wb = hw(hF0, 0), wt = hw(hF0, 1);
      const zb = hz(hF0, 0), zt = hz(hF0, 1);
      // ⚠ The same door the interior cuts (`G.door`).
      const dW = G.door.halfW, dH = G.door.topT;
      const at = (x, t) => [hF0, x * (t ? wt / wb : 1), zb + (zt - zb) * t];
      face([at(-wb, 0), at(-dW, 0), at(-dW, 1), at(-wb, 1)], 0.50, cen, 'body', HOUSE);
      face([at(dW, 0), at(wb, 0), at(wb, 1), at(dW, 1)], 0.50, cen, 'body', HOUSE);
      face([at(-dW, dH), at(dW, dH), at(dW, 1), at(-dW, 1)], 0.50, cen, 'body', HOUSE);
      // Set in from inside. ⚠ Down to the sole when the well opens onto the house.
      const dz0 = Math.abs(cpF1 - hF0) < 1e-6 ? G.soleZ : zb;
      box(hF0 + 0.004, hF0 + 0.020, dW * 0.94, dz0, zb + (zt - zb) * dH, 'body', HOUSE);
      if (rich(0.5)) box(hF0 + 0.000, hF0 + 0.006, dW * 0.14, zb + (zt - zb) * 0.42,
        zb + (zt - zb) * 0.54, 'body', CHROME, dW * 0.58);
    }

    // ── The hardtop ── Crowned, tapered, overhanging; spanwise segments so the edge curves.
    {
      const NR = 4;
      // Shared with the headlining inside.
      const { crownH, over, THK, rf0, rf1, rw, rz, cr } = G.roof;
      // The swept leading edge: the centreline reaches furthest forward.
      const { frontAt } = G.roof;
      const p = (f, u, dz = 0) => [f, u * rw(f), rz(f) + cr(u) + dz];
      const pf = (u, dz = 0) => p(frontAt(u), u, dz);    // a point ON the swept leading edge
      // One surface, and the lining is the same quad dropped by THK. One part each.
      const top = [], lining = [];
      for (let i = 0; i < NR; i++) {
        const u0 = -1 + 2 * (i / NR), u1 = -1 + 2 * ((i + 1) / NR);
        top.push([p(rf0, u0), pf(u0), pf(u1)], [p(rf0, u0), pf(u1), p(rf0, u1)]);
        lining.push([pf(u0, -THK), p(rf0, u0, -THK), p(rf0, u1, -THK)],
                    [pf(u0, -THK), p(rf0, u1, -THK), pf(u1, -THK)]);
      }
      strip(top, 0.98, cen, 'body', HOUSE);
      strip(lining, 0.38, cen, 'body', HOUSE);
      // The rim.
      for (const s of [-1, 1]) {
        strip([[p(rf0, s), pf(s), pf(s, -THK), p(rf0, s, -THK)]], s < 0 ? 0.66 : 0.58, cen, 'body', HOUSE);
      }
      for (let i = 0; i < NR; i++) {
        const u0 = -1 + 2 * (i / NR), u1 = -1 + 2 * ((i + 1) / NR);
        strip([[pf(u0), pf(u1), pf(u1, -THK), pf(u0, -THK)]], 0.84, cen, 'body', HOUSE);
        strip([[p(rf0, u1), p(rf0, u0), p(rf0, u0, -THK), p(rf0, u1, -THK)]], 0.44, cen, 'body', HOUSE);
      }
      // A light bar let into the leading edge.
      if (rich(0.5)) box(rf1 - 0.026, rf1 - 0.004, rw(rF) * 0.56, rz(rF) + 0.004, rz(rF) + 0.014, 'body', ACCENT);
      // ── Struts ── The hardtop stands on raked legs at the back, with daylight under it.
      const sw2 = hw(hF0, 1) * 0.92;
      for (const s of [-1, 1]) {
        tube([hF0 + 0.010, s * sw2, hz(hF0, 0.52)], [hF0 - over * 0.6, s * sw2 * 1.02, rz(hF0)], 0.011, 'body', null, 5);
      }
      if (fine) box(hF0 + 0.05, hF0 + 0.12, rw(hF0) * 0.20, rz(hF0) + crownH, rz(hF0) + crownH + 0.026, 'body', HOUSE);
    }
  }


  // ── The mast ── Radome, whips, masthead and stern lights.
  if ((S.mast ?? 0) > 0) {
    const { rf0, crownH } = G.roof;
    const fb = rf0 + (G.rF - rf0) * 0.22, zb = G.roof.rz(fb) + crownH;
    const top = [fb - 0.030, 0, zb + 0.072];
    tube([fb, 0, zb - 0.002], top, 0.0055, 'body', HOUSE, 6);
    tube([fb - 0.014, 0, zb + 0.030], [fb - 0.016, 0, zb + 0.044], 0.024, 'body', [222, 226, 228], 10);
    box(top[0] - 0.006, top[0] + 0.006, 0.005, top[2], top[2] + 0.008, 'body', WHITE_LENS);
    if (fine) for (const s of [-1, 1]) tube([fb - 0.004, s * G.roof.rw(fb) * 0.62, zb], [fb - 0.020, s * G.roof.rw(fb) * 0.66, zb + 0.110], 0.0018, 'body', DARK, 4);
    META.lamps.push({ at: [top[0] + 0.007, 0, top[2] + 0.004], n: [1, 0, 0.25], rgb: '255,250,236' });
    META.lamps.push({ at: [top[0] - 0.007, 0, top[2] + 0.004], n: [-1, 0, 0.25], rgb: '255,250,236' });
  }


  // ── Outboards ── The count is authored.
  // ── A propeller ── Blades emitted both ways because a blade is a sheet and the culler would hide one side.
  const prop = (f, g, z, r, n = 3) => {
    tube([f + 0.010, g, z], [f - 0.008, g, z], r * 0.26, 'body', POLISH, 6);
    if (!fine) return;
    for (const dir of [1, -1]) {
      const bl = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4, b = a + 0.62;
        const P = (ang, rr, df) => [f + df, g + Math.cos(ang) * rr, z + Math.sin(ang) * rr];
        bl.push([P(a, r * 0.24, 0.002), P(a, r, -0.002), P(b, r * 0.86, -0.004), P(b, r * 0.28, 0)]);
      }
      strip(bl, 0.86, [f + dir * 0.05, g, z], 'body', POLISH);
    }
  };
  const TS = STATIONS[STATIONS.length - 1];      // the transom's own station (no steps in the topside)
  // Swim platform.
  const PLAT = Math.max(0, S.platform ?? 0);
  const platZ = TS.cz + 0.030;

  const mot = Math.max(0, Math.round(S.motors ?? 4));
  if (mot > 0) {
    const t = TS;
    // ⚠ Sized against the hull (low and tight to the transom). With a platform they sit on a bracket aft of it.
    const off = PLAT > 0 ? PLAT + 0.014 : 0;
    const span = t.sw * 1.44, step = mot > 1 ? span / (mot - 1) : 0;
    if (off) box(t.f - off - 0.004, t.f + 0.002, span / 2 + 0.026, t.cz - 0.006, t.cz + 0.018, 'body', DARK);
    for (let i = 0; i < mot; i++) {
      const g = mot > 1 ? -span / 2 + i * step : 0;
      const f0 = t.f - 0.088 - off, f1 = t.f + 0.006 - off;
      box(f0, f1, 0.021, t.cz + 0.004, t.cz + 0.050, 'body', DARK, g);                  // the lower cowl
      box(f0 + 0.004, f1 - 0.003, 0.019, t.cz + 0.050, t.cz + 0.074, 'body', [50, 54, 62], g);
      box(f0 + 0.022, f1 - 0.014, 0.010, t.cz - 0.034, t.cz + 0.008, 'body', null, g);  // the leg
      if (fine) {
        box(f0 + 0.012, f1 - 0.006, 0.017, t.cz - 0.019, t.cz - 0.016, 'body', DARK, g);   // anti-ventilation plate
        box(f0 + 0.014, f0 + 0.038, 0.004, t.cz - 0.050, t.cz - 0.030, 'body', null, g);   // the skeg
        prop(f0 + 0.010, g, t.cz - 0.031, 0.020);
      }
      if (rich(0.5)) box(f0 + 0.003, f0 + 0.011, 0.019, t.cz + 0.054, t.cz + 0.068, 'body', ACCENT, g);
    }
  }
  if (PLAT > 0) {
    const w = TS.sw * 0.90;
    box(TS.f - PLAT, TS.f + 0.004, w, platZ - 0.010, platZ, 'deck', null);
    // Boarding ladder and grab rail.
    if (fine) {
      for (const dz of [0.000, -0.010, -0.020]) box(TS.f - PLAT + 0.006, TS.f - PLAT + 0.030, 0.004, platZ - 0.014 + dz, platZ - 0.012 + dz, 'body', CHROME, w * 0.62);
      tube([TS.f - 0.004, w * 0.70, platZ + 0.002], [TS.f - 0.004, w * 0.70, TS.sz + 0.016], 0.0035, 'body', CHROME, 5);
    }
  }
  // ── The drive ── A surface drive with a trim ram (what `[` and `]` do).
  if ((S.drives ?? 0) > 0 && (S.v8 ?? 1) !== 0) {
    const t = TR, z = t.k + 0.026, tip = TS.f - Math.max(PLAT, 0.04) - 0.050;
    tube([TS.f + 0.006, 0, z + 0.004], [tip, 0, z], 0.010, 'body', DARK, 6);
    box(tip + 0.012, TS.f - 0.004, 0.003, z - 0.030, z - 0.004, 'body', DARK);   // the skeg under it
    if (fine) tube([TS.f - 0.002, 0, TS.cz + 0.012], [tip + 0.030, 0, z + 0.010], 0.004, 'body', POLISH, 5);
    prop(tip - 0.004, 0, z, 0.026, 4);
  }
  // ── Trim tabs ──
  if ((S.tabs ?? 0) > 0 && fine) {
    for (const s of [-1, 1]) {
      const g = s * TS.cw * 0.62;
      box(TS.f - 0.034, TS.f + 0.001, 0.032, TS.cz - 0.006, TS.cz - 0.002, 'body', DARK, g);
      tube([TS.f - 0.003, g, TS.cz + 0.020], [TS.f - 0.022, g, TS.cz - 0.002], 0.003, 'body', POLISH, 5);
    }
  }

  // ── The cat's stern ── Two inboards under hatches with scoops, transom exhausts, props, rudders, and a wing.
  const twin = Math.max(0, Math.round(S.twin ?? 0));
  if (twin > 0 && G.CAT) {
    const t = TR;
    const hf1 = cpF0 - 0.024, hf0 = -0.80 * LEN;
    for (const s of [-1, 1]) {
      const a = atF((hf0 + hf1) / 2);
      const g = s * (a.tw + a.cw) / 2, hwid = (a.cw - a.tw) * 0.40;
      const zt = Math.max(atF(hf0).sz, atF(hf1).sz) + 0.014;
      box(hf0, hf1, hwid, a.sz - 0.004, zt, 'body', null, g);                                 // the hatch
      if (fine) {
        box(hf0 + 0.010, hf1 - 0.010, hwid * 0.72, zt, zt + 0.002, 'body', HOUSE_TONE_WELL, g);   // the louvred top
        for (let i = 0; i < 4; i++) {
          const fz = hf0 + 0.04 + i * 0.022;
          box(fz, fz + 0.008, hwid * 0.6, zt + 0.002, zt + 0.004, 'body', DARK, g);
        }
      }
      box(hf1 - 0.062, hf1 - 0.004, hwid * 0.52, zt, zt + 0.026, 'body', null, g);
      face([[hf1 - 0.003, g - hwid * 0.44, zt + 0.004], [hf1 - 0.003, g + hwid * 0.44, zt + 0.004],
            [hf1 - 0.003, g + hwid * 0.44, zt + 0.022], [hf1 - 0.003, g - hwid * 0.44, zt + 0.022]],
        0.20, [hf1 - 0.03, g, zt + 0.013], 'body', DARK);
      // Exhaust: two chromed tips per sponson, published as ports.
      for (const k of [-1, 1]) {
        const ge = s * (t.kg + k * 0.022), ze = t.iz + 0.020;
        const base = [t.f + 0.024, ge, ze], tip = [t.f - 0.020, ge, ze + 0.004];
        if (fine) tube(base, tip, 0.008, 'body', PIPE, 6);
        const d = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]], m = Math.hypot(...d) || 1;
        META.ports.push({ p: tip, d: [d[0] / m, d[1] / m, d[2] / m], side: s, bore: 0.010 });
      }
      const zd = t.k + 0.018, gd = s * t.kg, tipF = t.f - 0.075;
      tube([t.f + 0.006, gd, zd + 0.004], [tipF, gd, zd], 0.008, 'body', DARK, 6);
      prop(tipF - 0.004, gd, zd, 0.024, 4);
      if ((S.rudders ?? 0) > 0) {
        const gr = s * (t.kg + (t.cw - t.kg) * 0.55);
        const blade = [[t.f - 0.010, gr, t.cz + 0.012], [t.f - 0.050, gr, t.cz + 0.010],
                       [t.f - 0.064, gr, t.k - 0.006], [t.f - 0.026, gr, t.k - 0.004]];
        face(blade, 0.62, [t.f - 0.04, gr - s * 0.05, t.cz], 'body', DARK);
        face(blade.slice().reverse(), 0.70, [t.f - 0.04, gr + s * 0.05, t.cz], 'body', DARK);
        if (fine) tube([t.f + 0.004, gr, t.cz + 0.016], [t.f - 0.020, gr, t.cz + 0.016], 0.004, 'body', POLISH, 5);
      }
    }
    // The wing: a wedge, so it reads as an aerofoil.
    if ((S.wing ?? 0) > 0) {
      const wf1 = -0.86 * LEN, wf0 = -0.955 * LEN;
      const ws = atF(wf0).sw * 0.86, wz = atF(wf0).sz + 0.074;
      for (const s of [-1, 1]) {
        const gf = s * atF(wf0).sw * 0.80, zDeck = atF((wf0 + wf1) / 2).sz;
        const fin = [[wf1 + 0.020, gf, zDeck], [wf0 + 0.010, gf, zDeck], [wf0 + 0.014, gf, wz - 0.004], [wf1 - 0.010, gf, wz - 0.004]];
        face(fin, 0.66, [(wf0 + wf1) / 2, gf - s * 0.05, zDeck + 0.03], 'body', DARK);
        face(fin.slice().reverse(), 0.74, [(wf0 + wf1) / 2, gf + s * 0.05, zDeck + 0.03], 'body', DARK);
      }
      const le = wf1, te = wf0, th = 0.008;
      const wcen = [(le + te) / 2, 0, wz];
      // Carbon, never the livery.
      strip([[[le, -ws, wz + th * 0.5], [le, ws, wz + th * 0.5], [te, ws, wz + 0.002], [te, -ws, wz + 0.002]]], 1.00, wcen, 'body', DARK);   // the top
      strip([[[te, -ws, wz], [te, ws, wz], [le, ws, wz - th * 0.5], [le, -ws, wz - th * 0.5]]], 0.40, wcen, 'body', DARK);                // the underside
      face([[le, -ws, wz - th * 0.5], [le, ws, wz - th * 0.5], [le, ws, wz + th * 0.5], [le, -ws, wz + th * 0.5]], 0.84, wcen, 'body', DARK);
      for (const s of [-1, 1]) face([[le, s * ws, wz - th * 0.5], [te, s * ws, wz], [te, s * ws, wz + 0.002], [le, s * ws, wz + th * 0.5]], 0.60, wcen, 'body', DARK);
      if (rich(0.5)) box(le - 0.010, le + 0.001, ws * 0.96, wz + th * 0.5 - 0.0015, wz + th * 0.5 + 0.0005, 'body', ACCENT);
      // Stern light on the wing.
      box(te - 0.002, te + 0.008, 0.006, wz + 0.002, wz + 0.008, 'body', WHITE_LENS);
      META.lamps.push({ at: [te - 0.003, 0, wz + 0.005], n: [-1, 0, 0.15], rgb: '255,250,236' });
    }
  }

  // ── The bench ── Cream vinyl across the aft well.
  if ((S.seatsAft ?? 0) > 0) {
    const a = atF(cpF0 + 0.05);
    const w = a.sw * 0.74, z0 = G.soleZ;
    box(cpF0 + 0.004, cpF0 + 0.080, w, z0, z0 + 0.032, 'body', VINYL);
    box(cpF0 + 0.002, cpF0 + 0.020, w, z0 + 0.032, Math.min(a.sz - 0.004, z0 + 0.072), 'body', VINYL);
    if (fine) box(cpF0 + 0.020, cpF0 + 0.078, w * 0.98, z0 + 0.032, z0 + 0.034, 'body', [196, 190, 174]);   // the welt
  }

  // ── The rub rail ── With a chrome insert on rich trims.
  if (fine) {
    const rail = [], insert = [];
    for (let i = 1; i < STATIONS.length; i++) {
      const a = STATIONS[i - 1], b = STATIONS[i];
      if (a.f > LEN * 0.90) continue;
      const P = (st, o, dz) => [st.f, st.sw + o, st.sz + dz];
      rail.push([P(a, 0.006, -0.001), P(b, 0.006, -0.001), P(b, 0.006, -0.010), P(a, 0.006, -0.010)]);
      insert.push([P(a, 0.0068, -0.003), P(b, 0.0068, -0.003), P(b, 0.0068, -0.006), P(a, 0.0068, -0.006)]);
    }
    for (const s of [-1, 1]) {
      const m = (q) => q.map((p) => [p[0], s * p[1], p[2]]);
      strip(rail.map(m), 0.60, [0, 0, 0.05], 'body', RUBBER);
      if (rich(0.5)) strip(insert.map(m), 0.96, [0, 0, 0.05], 'body', CHROME);
    }
  }

  // ── Sidelights ── Red port, green starboard, lit through meshLamps, aimed forward of the beam.
  {
    const fS = LEN * 0.58, a = atF(fS);
    for (const s of [-1, 1]) {
      const g = s * (a.sw + 0.0015), z = a.sz - 0.016;
      box(fS - 0.018, fS + 0.004, 0.0025, z - 0.006, z + 0.003, 'body', s < 0 ? RED_LENS : GREEN_LENS, g);
      META.lamps.push({ at: [fS - 0.007, g + s * 0.004, z - 0.0015], n: [0.34, s * 0.94, 0], rgb: s < 0 ? '255,55,55' : '60,255,95' });
    }
  }

  // ── The foredeck ── A hatch, a knuckle crease and stem fittings break up the blank deck.
  {
    // ⚠ Read from the row: HOUSE and the house stations are scoped to the pilothouse block.
    const HOUSE_TONE = [26, 28, 33];
    const hF0Ref = S.houseF0 ?? -0.54;
    const dk = (f) => atF(f).sz + crown * 0.6;
    const h0 = (S.hatchF ?? 0.62), h1 = h0 + (S.hatchL ?? 0.20);
    const hwid = atF((h0 + h1) / 2).sw * 0.34;
    face([[h1, -hwid, dk(h1) + 0.002], [h1, hwid, dk(h1) + 0.002],
          [h0, hwid, dk(h0) + 0.002], [h0, -hwid, dk(h0) + 0.002]],
      0.72, [(h0 + h1) / 2, 0, dk(h0)], 'body', HOUSE_TONE);
    // A shallow knuckle catches light on one side, which a painted line can't.
    const kA = hF0Ref, kB = LEN * 0.88;
    const KN = 3;
    for (const s of [-1, 1]) {
      const quads = [];
      for (let i = 0; i < KN; i++) {
        const fa = kA + (kB - kA) * (i / KN), fb = kA + (kB - kA) * ((i + 1) / KN);
        const wa = atF(fa).sw * 0.56, wb = atF(fb).sw * 0.56;
        quads.push([[fa, s * wa, dk(fa) + 0.004], [fb, s * wb, dk(fb) + 0.004],
                    [fb, s * wb * 0.78, dk(fb)], [fa, s * wa * 0.78, dk(fa)]]);
      }
      strip(quads, s < 0 ? 1.06 : 0.90, [(kA + kB) / 2, 0, dk(kA)], 'deck');
    }
    // Cleats and bow eye.
    if (rich(0.5)) {
      for (const s of [-1, 1]) box(LEN * 0.80, LEN * 0.845, atF(LEN * 0.82).sw * 0.16,
        dk(LEN * 0.82), dk(LEN * 0.82) + 0.010, 'body', CHROME, s * atF(LEN * 0.82).sw * 0.52);
      box(LEN * 0.955, LEN * 0.985, 0.012, dk(LEN * 0.97) - 0.004, dk(LEN * 0.97) + 0.012, 'body', CHROME);
    }
  }

  // ── The motor ── A blown V8 open in the aft well, its hat clearing the sheer.
  // Exclusive with the outboards by authoring: set `motors` and clear `v8` for the outboard version.
  if ((S.v8 ?? 1) !== 0) {
    const t = STATIONS[STATIONS.length - 1];
    const eF1 = S.v8F ?? -0.60, eF0 = eF1 - (S.v8L ?? 0.22);
    // On stringers, raised off the sole so it shows from the beam.
    const sole = G.soleZ + (S.v8Rise ?? 0.022);
    const hw = atF((eF0 + eF1) / 2).sw * 0.46;
    const blk = sole + (S.v8H ?? 0.072);
    box(eF0, eF1, hw, sole, blk, 'body', BLOCK);                              // the block
    // Engine rails and polished valve covers.
    if (fine) {
      for (const s of [-1, 1]) {
        box(eF0 - 0.030, eF1 + 0.020, 0.008, G.soleZ, sole + 0.004, 'body', DARK, s * hw * 0.80);
        box(eF0 + 0.010, eF1 - 0.010, hw * 0.20, blk - 0.006, blk + 0.010, 'body', POLISH, s * hw * 0.70);
      }
      // Blower drive: pulleys and belt.
      tube([eF1, 0, sole + 0.020], [eF1 + 0.012, 0, sole + 0.020], 0.014, 'body', POLISH, 8);
      tube([eF1, 0, blk + 0.018], [eF1 + 0.012, 0, blk + 0.018], 0.011, 'body', POLISH, 8);
      box(eF1 + 0.002, eF1 + 0.010, 0.010, sole + 0.010, blk + 0.026, 'body', RUBBER);
    }
    const caseTop = blk + 0.030;
    box(eF0 + 0.020, eF1 - 0.020, hw * 0.82, blk, caseTop, 'body', POLISH);    // the blower case
    face([[eF1 - 0.020, -hw * 0.66, caseTop + 0.034], [eF1 - 0.020, hw * 0.66, caseTop + 0.034],
          [eF0 + 0.034, hw * 0.72, caseTop], [eF0 + 0.034, -hw * 0.72, caseTop]],
      1.00, [(eF0 + eF1) / 2, 0, caseTop], 'body', POLISH);
    box(eF1 - 0.030, eF1 - 0.020, hw * 0.66, caseTop, caseTop + 0.034, 'body', POLISH);
    if (rich(0.6)) tube([eF1 - 0.014, 0, caseTop + 0.018], [eF1 + 0.040, 0, caseTop + 0.012], 0.010, 'body', POLISH, 6);
    // Zoomies: the count per side is the cylinders per side. ⚠ Each mouth and direction is published as a port
    // (windshield.js draws the flame from it, never re-derives it), at both detail levels because fire is a light.
    const zoom = Math.max(0, Math.round(S.zoom ?? 4));
    for (const s of [-1, 1]) for (let i = 0; i < zoom; i++) {
      const u = zoom === 1 ? 0.5 : i / (zoom - 1);
      const f = eF0 + (eF1 - eF0) * (0.16 + 0.68 * u);
      const z = sole + (S.v8H ?? 0.072) * 0.42;
      const tip = [f - 0.028, s * (hw + 0.060), z + 0.044];
      if (fine) tube([f, s * hw, z], tip, 0.012, 'body', PIPE, 5);
      const d = [tip[0] - f, tip[1] - s * hw, tip[2] - z];
      const m = Math.hypot(d[0], d[1], d[2]) || 1;
      META.ports.push({ p: tip, d: [d[0] / m, d[1] / m, d[2] / m], side: s, bore: 0.012 });
    }
  }

  // ── Boot stripe ──
  if (rich(0.5)) {
    for (let i = 0; i < STATIONS.length - 1; i++) {
      const a = STATIONS[i], b = STATIONS[i + 1];
      const cen = [(a.f + b.f) / 2, 0, (a.sz + b.sz) / 2];
      for (const s of [-1, 1]) {
        strip([[
          [a.f, s * (a.sw + 0.002), a.sz - 0.014], [b.f, s * (b.sw + 0.002), b.sz - 0.014],
          [b.f, s * (b.sw + 0.002), b.sz - 0.026], [a.f, s * (a.sw + 0.002), a.sz - 0.026],
        ]], 0.86, cen, 'body', ACCENT);
      }
    }
  }
  return faces;
}
// `variant` is `<typeId>[+t]` (trailer); `~p` parked, `~s` solo trailer, `^...` fittings.
// `fine` (detail 1) adds detail; the silhouette is the same at detail 0.
function buildTruck(variant = 'hauler', detail = 1) {
  const str = String(variant);
  // Parked: the rig settles onto its lifters and the emitters go out.
  const parked = str.includes('~p');
  // Solo: a dropped trailer, built as the whole rig with the tractor spliced off so it can't drift from the towed one.
  const solo = str.includes('~s');
  // ⚠ Strip the fitting suffix before reading the type, or every fitted rig renders bobtail.
  const [typeId, tail] = str.replace(/[~^].*$/, '').split('+');
  const S = truckShape(typeId) || truckShape('hauler');
  const hitched = tail === 't' || solo;   // solo IS a trailer: the box gets built, the tractor is spliced off after
  const fine = detail >= 1;
  // Trim ladder: rich(n) asks whether money went on this truck.
  const TRIM = S.trim ?? 0.5;
  const rich = (n) => fine && TRIM >= n;
  const faces = [];
  const podAt = [];                        // filled by pod(); published through TRUCK_META below
  let partSeq = 0;                         // see the ⚠ in `box` — one id per convex sub-object
  const V = (f, g, h) => [f, g, h];
  // A box as six quads with baked top-lit shades. `gc` is its lateral centre.
  const box = (f0, f1, w, z0, z1, role = 'body', tint = null, gc = 0) => {
    const gl = gc - w, gr = gc + w;
    const A = [V(f0, gl, z0), V(f0, gr, z0), V(f0, gr, z1), V(f0, gl, z1)];
    const B = [V(f1, gl, z0), V(f1, gr, z0), V(f1, gr, z1), V(f1, gl, z1)];
    // ⚠ Every box is one part, assigned here at emission; the renderer sorts parts (see sortTruckFaces).
    const part = ++partSeq;
    // ⚠ And each face carries its box's centre `cen`, for backface culling and the sun normal. Measured from the
    // model origin instead, boxes forward of the axle were lit backwards. A box is convex, so away from `cen` is outward.
    const cen = [(f0 + f1) / 2, gc, (z0 + z1) / 2];
    const quad = (p, sh) => { const q = { role, sh, p, part, cen }; if (tint) { q.tint = tint; const k = PK(tint); if (k) q.pk = k; } faces.push(q); };
    quad([A[3], A[2], B[2], B[3]], 1.00);                    // roof
    quad([A[0], B[0], B[1], A[1]], 0.42);                    // underside
    quad([A[0], A[3], B[3], B[0]], 0.72);                    // left flank
    quad([A[1], B[1], B[2], A[2]], 0.62);                    // right flank
    quad([B[0], B[3], B[2], B[1]], 0.80);                    // front face
    quad([A[0], A[1], A[2], A[3]], 0.55);                    // back face
  };
  // A free polygon (screen, fairing wedge, chin spoiler), its own part. `uv`/`art` feed drawCanopyGlass.
  const poly = (role, sh, pts, tint = null, uv = null, art = null) => {
    const q = { role, sh, p: pts.map(p => V(p[0], p[1], p[2])), part: ++partSeq };
    if (tint) { q.tint = tint; const k = PK(tint); if (k) q.pk = k; }
    if (uv) { q.uv = uv; q.art = art || 'truckcab'; }
    faces.push(q);
  };
  const UV_FULL = [[0, 1], [1, 1], [1, 0], [0, 0]];
  // ── The lifters ── Hover pods, not wheels: chamfered housing, a lit emitter band, hung off an arm.
  // `len` stretches a pod fore-aft. GLOW matches the road wash the lamp layer paints.
  const GLOW = [128, 226, 255];
  const CHROME = [226, 232, 240];        // bright plate — `window` role so it takes the specular pass
  // CHROME and ACCENT are paint-keyed by identity (PK), so the booth can recolour brightwork and the running
  // light. The lifter emitter keeps GLOW: it's propulsion, and the road wash shares its colour.
  const ACCENT = [96, 196, 214];         // the decorative running light — beltline strip, roof scanner
  const PK = (t) => (t === CHROME ? 'bright' : t === ACCENT ? 'glow' : null);
  const HOVER = 0.014;                   // the ride height a running lifter holds, and a parked one gives up
  // Lifter half-width, published for the snow tracks (`trackGauge` in windshield.js).
  const PW = 0.024;
  const pod = (f, g, r = 0.048, len = 1, deck = false) => {
    const s = Math.sign(g || 1), L = r * len;
    podAt.push([f, g, r * len, deck, PW]);  // where a lifter ended up, how wide it is, and on WHICH body — the lamp layer pools light under each one and has to swing the trailer's with the trailer
    const z0 = 0.016, z1 = z0 + r * 1.24;                                                       // the pod floats clear of the road
    box(f - L * 0.20, f + L * 0.20, 0.009, z1 - 0.006, 0.066, 'strut', null, g - s * 0.013);    // swing arm up into the frame
    box(f - L, f + L, PW, z0 + r * 0.34, z1, 'gear', null, g);                                  // housing
    box(f - L * 0.88, f + L * 0.88, 0.018, z0, z0 + r * 0.36, 'gear', null, g);                 // shroud, drawn in under it
    if (!fine) return;
    // Chrome hubcap band.
    box(f - L * 0.86, f + L * 0.86, 0.0255, z0 + r * 0.72, z0 + r * 0.92, 'window', CHROME, g);
    if (!parked) box(f - L * 0.80, f + L * 0.80, 0.025, z0 + r * 0.26, z0 + r * 0.38, 'window', GLOW, g);   // the emitter band
    box(f - L * 0.62, f + L * 0.62, 0.026, z0 + r * 0.50, z0 + r * 0.64, 'strut', null, g);     // intake louvre on the flank
    // ⚠ No ground patch here: geometry under a pod reads as a slab on the road. Light goes through `podGlow` in vehicleLamps.
  };
  // ── Retro-future ornament ── A chrome bullet: three shrinking boxes.
  const bullet = (f0, len, g, r, z) => {
    for (let i = 0; i < 3; i++) {
      const t0 = f0 + (len * i) / 3, k = 1 - i * 0.3;
      box(t0, t0 + len / 3, r * k, z - r * k, z + r * k, 'window', CHROME, g);
    }
  };
  // A raked fin with a lens.
  const fin = (f0, f1, g, z0, z1, lens) => {
    poly('body', 0.94, [[f0, g, z0], [f1, g, z0], [f1, g, z0 + (z1 - z0) * 0.25], [f0, g, z1]]);
    if (lens) box(f0 + 0.004, f0 + 0.016, 0.006, z1 - 0.020, z1 - 0.006, 'window', lens, g);
  };

  // Laid out backwards from the nose, so a bigger truck grows from one anchor.
  const nose1 = 0.40, nose0 = nose1 - S.nose;              // bonnet
  const cab1 = nose0, cab0 = cab1 - S.cab;                 // cab box
  const frame0 = cab0 - frameBack(S);                      // frame rails behind the cab — see frameBack
  const deckTop = 0.115;

  // ── Chassis ── Two rails with daylight between.
  for (const g of [-1, 1]) box(frame0 - 0.01, cab1 - 0.02, 0.016, 0.028, 0.072, 'strut', null, g * S.w * 0.62);
  box(frame0, cab0 + 0.02, S.w * 0.80, 0.050, 0.070, 'body');                 // deck plate over the rails
  // Fifth wheel. ⚠ It reaches under the box: the articulation pivots on this plate's middle.
  const PIN_F0 = frame0 - 0.01, PIN_F1 = frame0 + 0.13;
  box(PIN_F0, PIN_F1, S.w * 0.62, 0.070, 0.082, 'strut');

  // ── Cab ────────────────────────────────────────────────────────────────────
  box(cab0, cab1, S.w, 0.02, S.hi, 'body');                // cab
  if (S.sleeper) {
    box(cab0 + 0.005, cab1 - 0.055, S.w * 0.95, S.hi, S.hi + S.sleeper, 'body');
    for (const g of [-1, 1]) box(cab0 + 0.045, cab0 + 0.075, 0.003, S.hi + 0.012, S.hi + S.sleeper - 0.008, 'glass', [44, 66, 84], g * S.w * 0.95);
  }
  // The screen is a raked quad with a UV ('truckcab' canopy art).
  const scrLo = S.hi * 0.52, scrHi = S.hi * 0.985;
  const scrF0 = nose0 - 0.004, scrF1 = nose0 + 0.038;       // bottom station, top station
  const scrW = S.w * 0.94;
  poly('glass', 0.92, [[scrF0, -scrW, scrLo], [scrF0, scrW, scrLo], [scrF1, scrW, scrHi], [scrF1, -scrW, scrHi]],
    [58, 84, 104], UV_FULL, 'truckcab');
  for (const g of [-1, 1]) poly('strut', 0.78, [[scrF0, g * scrW, scrLo], [scrF0, g * S.w, scrLo], [scrF1, g * S.w, scrHi], [scrF1, g * scrW, scrHi]]);
  // ⚠ The raked screen leans past the cab, so three quads close the wedge behind it. No `cen`: two-sided sheets.
  const scrT = (cab1 - scrF0) / (scrF1 - scrF0), scrZc = scrLo + (scrHi - scrLo) * scrT;
  poly('body', 0.90, [[scrF1, -S.w, scrHi], [scrF1, S.w, scrHi], [cab1, S.w, S.hi], [cab1, -S.w, S.hi]]);   // the header roof, glass top back to the roof lip
  for (const g of [-1, 1]) poly('body', 0.70, [[scrF1, g * S.w, scrHi], [cab1, g * S.w, S.hi], [cab1, g * S.w, scrZc]]);   // and the gusset that shuts each end of it
  // Sun visor.
  poly('body', 0.96, [[scrF1, -S.w, scrHi], [scrF1, S.w, scrHi], [scrF1 + 0.030, S.w * 0.94, scrHi + 0.004], [scrF1 + 0.030, -S.w * 0.94, scrHi + 0.004]]);
  // Marker lamps, `window` role so they read lit after dark.
  if (fine && S.lamps > 0.2) {
    for (let i = -2; i <= 2; i++) {
      box(scrF1 + 0.022, scrF1 + 0.030, 0.008, scrHi + 0.001, scrHi + 0.009, 'window', [236, 176, 96], i * S.w * 0.34);
    }
  }
  // Side glass: door window plus quarter light.
  for (const g of [-1, 1]) {
    box(cab1 - 0.105, cab1 - 0.048, 0.004, S.hi * 0.54, S.hi * 0.88, 'glass', [50, 74, 92], g * S.w);
    box(cab1 - 0.040, cab1 - 0.014, 0.004, S.hi * 0.54, S.hi * 0.84, 'glass', [46, 68, 86], g * S.w);
    if (!fine) continue;
    box(cab1 - 0.048, cab1 - 0.040, 0.006, S.hi * 0.50, S.hi * 0.90, 'strut', null, g * S.w);   // the B-post between them
    // Grab handle and steps.
    box(cab1 - 0.048, cab1 - 0.042, 0.005, S.hi * 0.16, S.hi * 0.48, 'strut', null, g * (S.w + 0.006));
    box(cab1 - 0.100, cab1 - 0.030, 0.014, 0.030, 0.044, 'strut', null, g * (S.w * 0.92));
  }
  // Beltline running-light strip.
  if (fine && S.lamps > 0.5) {
    for (const g of [-1, 1]) box(cab0 + 0.02, cab1 - 0.02, 0.003, S.hi * 0.47, S.hi * 0.505, 'window', ACCENT, g * S.w);
  }
  // ── Roof fairing ──
  if (S.aero > 0.05) {
    const rTop = S.hi + S.sleeper, fh = rTop + 0.030 * S.aero;
    poly('body', 1.00, [[cab0 - 0.055 * S.aero, -S.w * 0.92, fh], [cab0 - 0.055 * S.aero, S.w * 0.92, fh],
                        [cab1 - 0.06, S.w * 0.9, rTop], [cab1 - 0.06, -S.w * 0.9, rTop]]);
    const aeroBack = cab0 - 0.055 * S.aero, aeroLow = 0.02 + rTop * 0.4;
    for (const g of [-1, 1]) poly('body', 0.66, [[aeroBack, g * S.w * 0.92, fh], [cab1 - 0.06, g * S.w * 0.9, rTop],
                        [cab1 - 0.06, g * S.w * 0.9, rTop - 0.02], [aeroBack, g * S.w * 0.92, aeroLow]]);
    // ⚠ The fairing's back is closed, or you see into the hollow from behind the cab.
    poly('body', 0.52, [[aeroBack, -S.w * 0.92, fh], [aeroBack, S.w * 0.92, fh],
                        [aeroBack, S.w * 0.92, aeroLow], [aeroBack, -S.w * 0.92, aeroLow]]);
    // Road-scanner pod.
    box(cab1 - 0.10, cab1 - 0.07, 0.016, rTop, rTop + 0.012, 'strut');
    box(cab1 - 0.095, cab1 - 0.078, 0.010, rTop + 0.012, rTop + 0.018, 'window', ACCENT);
  }
  // ── Nose ───────────────────────────────────────────────────────────────────
  if (S.nose > 0.001) {
    box(nose0, nose1 - 0.012, S.w * 0.93, 0.045, 0.135, 'body');    // bonnet
    // Chamfered bonnet top.
    poly('body', 1.00, [[nose0, -S.w * 0.93, 0.135], [nose0, S.w * 0.93, 0.135],
                        [nose1 - 0.012, S.w * 0.88, 0.126], [nose1 - 0.012, -S.w * 0.88, 0.126]]);
    box(nose1 - 0.014, nose1, S.w * 0.84, 0.050, 0.124, 'strut');   // the grille surround
    // Vertical chrome teeth. ⚠ Nothing on the face may share a fore-aft slice with the panel behind it: the
    // painter's sort gives each face one depth, so the panel lands among them.
    for (let i = -3; fine && i <= 3; i++) {
      box(nose1 + 0.001, nose1 + 0.006, 0.006, 0.060, 0.118, 'window', CHROME, i * S.w * 0.20);
    }
    if (fine) bullet(nose1 + 0.001, 0.030, 0, 0.030, 0.090);        // the nose cone in the grille's mouth, ahead of it for the same reason
  }
  // Cab-over face: recessed radiator, chrome surround and teeth standing clear of it (same rule), and a bullet.
  if (S.nose <= 0.001) {
    const gz0 = 0.070, gz1 = scrLo - 0.012;             // the aperture, floor to the screen's sill
    box(nose1 - 0.002, nose1 + 0.004, S.w * 0.80, gz0, gz1, 'strut');            // the recess, dark and behind everything
    if (fine) {
      for (const g of [-1, 1]) box(nose1 + 0.005, nose1 + 0.010, 0.007, gz0, gz1, 'window', CHROME, g * S.w * 0.80);
      box(nose1 + 0.005, nose1 + 0.010, S.w * 0.81, gz1 - 0.008, gz1, 'window', CHROME);
      box(nose1 + 0.005, nose1 + 0.010, S.w * 0.81, gz0, gz0 + 0.007, 'window', CHROME);
    }
    for (let i = -3; fine && i <= 3; i++) {
      box(nose1 + 0.006, nose1 + 0.011, 0.006, gz0 + 0.008, gz1 - 0.009, 'window', CHROME, i * S.w * 0.19);
    }
    if (fine) bullet(nose1 + 0.006, 0.026, 0, 0.026, (gz0 + gz1) / 2);
  }
  box(nose1 - 0.006, nose1 + 0.012, S.w * 1.02, 0.030, 0.058, 'strut');
  // The chin's lower lip sits above parked ride height, or the nose goes through the shed floor.
  poly('body', 0.5, [[nose1 + 0.012, -S.w, 0.030], [nose1 + 0.012, S.w, 0.030],
                     [nose1 - 0.010, S.w, 0.019], [nose1 - 0.010, -S.w, 0.019]]);
  // Headlamps: a stacked pair in a chromed pod. ⚠ A lens must clear the bumper in z and stand ahead of it in f on
  // every variant; shapes:smoke checks all four. Positions are shared with vehicleLamps (truckLampGeom).
  const LG = truckLampGeom(S);
  const BUMP_TOP = LG.BUMP_TOP, BUMP_F = LG.BUMP_F;
  const lampG = LG.lampG, lampF = LG.lampF, lampZ = LG.lampZ;
  for (const g of [-1, 1]) {
    box(lampF - 0.016, lampF, 0.030, lampZ - 0.006, lampZ + 0.042, 'strut', null, g * lampG);           // the pod
    // Brow starts at the pod's front plane (same rule as the teeth).
    box(lampF, lampF + 0.009, 0.032, lampZ + 0.040, lampZ + 0.048, 'window', CHROME, g * lampG); // its chrome brow
    box(lampF, lampF + 0.007, 0.026, lampZ + 0.020, lampZ + 0.038, 'window', [242, 234, 196], g * lampG); // upper lens
    box(lampF, lampF + 0.007, 0.026, lampZ, lampZ + 0.017, 'window', [238, 228, 182], g * lampG);        // lower lens
    // ⚠ ACCENT, not GLOW: this strip is decoration, so it takes the livery's `glow`.
    if (fine && S.lamps > 0.4) box(lampF + 0.002, lampF + 0.008, 0.028, lampZ - 0.008, lampZ - 0.002, 'window', ACCENT, g * lampG);
  }
  // Dagmars, on trucks somebody paid for.
  if (rich(0.4)) for (const g of [-1, 1]) bullet(BUMP_F - 0.004, 0.026, g * S.w * 0.44, 0.013, 0.044);
  // Tow hooks, on every truck.
  if (fine) for (const g of [-1, 1]) {
    box(BUMP_F - 0.002, BUMP_F + 0.008, 0.010, 0.034, 0.040, 'strut', null, g * S.w * 0.62);
    box(BUMP_F + 0.006, BUMP_F + 0.010, 0.004, 0.030, 0.044, 'strut', null, g * S.w * 0.62);
  }
  // The plate. ⚠ Not an off-white: truckLampSmoke finds lenses by colour.
  if (fine) box(BUMP_F + 0.001, BUMP_F + 0.004, 0.024, 0.036, 0.052, 'window', [158, 168, 152], -S.w * 0.16);
  if (fine && S.lamps > 0.7) {
    for (let i = -1; i <= 1; i++) box(nose1 + 0.006, nose1 + 0.013, 0.013, 0.030, 0.042, 'window', [220, 226, 236], i * S.w * 0.20);
  }
  // ── Stacks, tanks, mirrors ──
  for (let i = 0; i < S.stacks; i++) {
    const g = (S.stacks === 1 ? 0 : (i ? 1 : -1)) * S.w * 0.94;
    const top = S.hi + S.sleeper + 0.062;
    box(cab0 - 0.013, cab0 + 0.013, 0.012, 0.055, top, 'strut', null, g);
    box(cab0 - 0.016, cab0 + 0.016, 0.015, 0.085, 0.135, 'strut', null, g);      // the perforated heat shield
    // A flared chrome mouth with three fins.
    box(cab0 - 0.018, cab0 + 0.018, 0.017, top - 0.014, top, 'window', CHROME, g);
    if (fine) for (const s of [-1, 1]) {
      poly('strut', 0.7, [[cab0 + s * 0.013, g - 0.012, top - 0.052], [cab0 + s * 0.013, g + 0.012, top - 0.052],
                          [cab0 + s * 0.024, g + 0.012, top - 0.030], [cab0 + s * 0.024, g - 0.012, top - 0.030]]);
    }
  }
  for (const g of [-1, 1]) {
    box(cab0 - 0.082, cab0 - 0.012, 0.021, 0.034, 0.088, 'strut', null, g * S.w * 0.88);      // saddle tank
    box(cab0 - 0.082, cab0 - 0.012, 0.023, 0.056, 0.064, 'strut', null, g * S.w * 0.88);      // its chrome strap
    if (S.skirt) box(frame0 + 0.02, cab0 - 0.085, 0.010, 0.032, 0.078, 'body', null, g * S.w * 0.9);   // side fairing
  }
  // Mirrors with glass.
  for (const g of [-1, 1]) {
    box(cab1 - 0.034, cab1 - 0.012, 0.005, S.hi * 0.54, S.hi * 0.90, 'strut', null, g * (S.w + 0.024));
    box(cab1 - 0.032, cab1 - 0.016, 0.002, S.hi * 0.58, S.hi * 0.86, 'glass', [70, 92, 108], g * (S.w + 0.028));
    box(cab1 - 0.030, cab1 - 0.024, 0.024, S.hi * 0.70, S.hi * 0.74, 'strut', null, g * (S.w + 0.012));   // the arm itself
  }

  // Air horns: three boxes of growing radius (a bell), lying fore-aft.
  if (fine && S.stacks > 0) {
    const hz = S.hi + S.sleeper + 0.010, hF = cab1 - 0.150;
    for (const g of [-1, 1]) {
      const gg = g * S.w * 0.34;
      for (let i = 0; i < 3; i++) {
        const r = 0.008 + i * 0.005, f0 = hF + i * 0.026;
        box(f0, f0 + 0.026, r, hz - r, hz + r, 'window', CHROME, gg);
      }
      box(hF - 0.006, hF + 0.014, 0.005, hz - 0.014, hz - 0.004, 'strut', null, gg);   // the mount it sits in
    }
  }
  // Cab steps.
  if (fine) {
    for (const g of [-1, 1]) {
      const gg = g * (S.w * 0.92);
      for (let i = 0; i < 2; i++) {
        const z = 0.030 + i * 0.026;
        // Chromed on a rich rig, bare steel otherwise.
        box(cab1 - 0.070, cab1 - 0.022, 0.014, z, z + 0.005, rich(0.7) ? 'window' : 'strut', rich(0.7) ? CHROME : null, gg);
        box(cab1 - 0.068, cab1 - 0.064, 0.003, z + 0.005, z + 0.028, 'strut', null, gg);   // the hanger up to the sill
      }
    }
  }
  // Lifters: a steering pod, then one long or two shorter drive pods.
  const gOut = S.w * 1.02, driveLen = S.axles > 1 ? 0.95 : 1.5;
  for (const g of [-gOut, gOut]) {
    pod(nose0 + 0.035, g, 0.046, 1.05);
    for (let a = 0; a < S.axles; a++) pod(frame0 + 0.055 + a * 0.105, g, 0.052, driveLen);
  }
  // ── The chrome ── Spear, tail fins, whip aerial. ⚠ `rich`, not `fine`: it's the money on the truck.
  if (rich(0.4)) {
    for (const g of [-1, 1]) {
      // The spear tapers aft.
      box(cab1 - 0.020, cab0 + 0.010, 0.004, S.hi * 0.36, S.hi * 0.40, 'window', CHROME, g * (S.w + 0.002));
      box(cab0 + 0.010, frame0 + 0.02, 0.004, S.hi * 0.33, S.hi * 0.355, 'window', CHROME, g * (S.w * 0.92));
    }
  }
  if (rich(0.7)) {
    for (const g of [-1, 1]) {
      const fTop = S.hi + S.sleeper;
      fin(cab0 - 0.014, cab0 + 0.030, g * S.w * 0.99, fTop * 0.62, fTop * 0.62 + 0.052 + S.sleeper, [214, 74, 58]);
    }
    const aTop = S.hi + S.sleeper + 0.085;
    box(cab1 - 0.030, cab1 - 0.026, 0.003, S.hi * 0.9, aTop, 'strut', null, -(S.w + 0.020));
    bullet(cab1 - 0.032, 0.012, -(S.w + 0.020), 0.006, aTop);
  }

  // ── Hardware every truck has ── On `fine`, not `rich`: hinges, hoses, mudflaps.
  if (fine) {
    for (const g of [-1, 1]) {
      const gw = g * S.w;
      // Door shut lines, hinges, handle.
      for (const f of [cab1 - 0.112, cab1 - 0.008]) box(f - 0.002, f + 0.002, 0.003, S.hi * 0.14, S.hi * 0.90, 'strut', null, gw + g * 0.001);
      for (const z of [S.hi * 0.28, S.hi * 0.74]) box(cab1 - 0.116, cab1 - 0.106, 0.004, z, z + 0.014, 'strut', null, gw + g * 0.003);   // hinges
      box(cab1 - 0.030, cab1 - 0.014, 0.004, S.hi * 0.44, S.hi * 0.48, 'strut', null, gw + g * 0.004);                                    // handle
      const flapF = frame0 + 0.055 + (S.axles - 1) * 0.105 + 0.075;
      // Mudflap. ⚠ Its bottom clears the lifters when parked (shapes:smoke checks).
      box(flapF, flapF + 0.004, 0.030, 0.018, 0.052, 'strut', null, g * (S.w * 1.02));
      box(cab0 - 0.040, cab0 - 0.030, 0.008, 0.088, 0.093, 'strut', null, g * S.w * 0.88);
    }
    // Wipers.
    for (const g of [-1, 1]) {
      const wg = g * S.w * 0.40;
      poly('strut', 0.62, [[scrF0 + 0.004, wg - 0.030, scrLo + 0.006], [scrF0 + 0.004, wg + 0.030, scrLo + 0.006],
                           [scrF0 + 0.010, wg + 0.030, scrLo + 0.020], [scrF0 + 0.010, wg - 0.030, scrLo + 0.020]]);
    }
    // Air and electrical lines off the back of the cab, three segments.
    for (const g of [-1, 1]) {
      const gg = g * S.w * 0.30;
      for (let i = 0; i < 3; i++) {
        const f0 = frame0 + 0.004 + i * 0.016;
        box(f0, f0 + 0.016, 0.004, 0.086 - i * 0.010, 0.092 - i * 0.010, 'strut', null, gg);
      }
    }
    // Catwalk grating.
    for (let i = 0; i < 4; i++) {
      const f = frame0 + 0.016 + i * 0.018;
      box(f, f + 0.006, S.w * 0.74, 0.070, 0.073, 'strut');
    }
    // Deck-corner markers.
    for (const g of [-1, 1]) box(frame0 + 0.004, frame0 + 0.012, 0.006, 0.072, 0.078, 'window', [236, 176, 96], g * S.w * 0.78);
  }
  // ── Hardware only the expensive ones have ──
  if (rich(0.7)) {
    for (const g of [-1, 1]) {
      const gw = g * S.w;
      box(cab0 - 0.082, cab0 - 0.012, 0.024, 0.072, 0.078, 'window', CHROME, g * S.w * 0.88);
      box(cab0 - 0.041, cab0 - 0.029, 0.009, 0.093, 0.096, 'window', CHROME, g * S.w * 0.88);
      box(cab1 - 0.030, cab1 - 0.022, 0.020, S.hi * 0.58, S.hi * 0.60, 'window', CHROME, g * (S.w + 0.012));
      // Window visor over the door glass.
      poly('body', 0.90, [[cab1 - 0.108, gw, S.hi * 0.90], [cab1 - 0.012, gw, S.hi * 0.90],
                          [cab1 - 0.016, gw + g * 0.016, S.hi * 0.93], [cab1 - 0.104, gw + g * 0.016, S.hi * 0.93]]);
    }
    for (let i = 0; i < S.stacks; i++) {
      const g = (S.stacks === 1 ? 0 : (i ? 1 : -1)) * S.w * 0.94;
      box(cab0 - 0.017, cab0 + 0.017, 0.016, 0.138, 0.146, 'window', CHROME, g);
    }
  }

  // Back of the tractor.
  for (const g of [-1, 1]) box(frame0 - 0.012, frame0 - 0.004, 0.016, 0.052, 0.070, 'window', [196, 66, 54], g * S.w * 0.66);
  if (fine) box(frame0 - 0.011, frame0 - 0.004, S.w * 0.30, 0.074, 0.080, 'window', [230, 210, 140]);
  // ⚠ No underglow geometry: a box reads as a slab. It's a glow pool at the lamp layer (`vehicleLamps().under`).
  // Roof beacon on rigs without a wind kit.
  if (fine && S.aero < 0.5) {
    const bTop = S.hi + S.sleeper;
    box(cab1 - 0.078, cab1 - 0.056, 0.014, bTop, bTop + 0.006, 'strut');
    box(cab1 - 0.075, cab1 - 0.059, 0.011, bTop + 0.006, bTop + 0.017, 'window', [244, 168, 64]);
  }
  // What a bobtail carries on its bare deck.
  if (!hitched && S.rig === 'cage') {
    for (const g of [-1, 1]) {
      for (const f of [frame0 + 0.014, cab0 - 0.014]) box(f - 0.004, f + 0.004, 0.005, 0.070, 0.150, 'strut', null, g * S.w * 0.74);
      for (const z of [0.106, 0.146]) box(frame0 + 0.010, cab0 - 0.010, 0.004, z, z + 0.005, 'strut', null, g * S.w * 0.74);
    }
    if (fine) box(frame0 + 0.024, cab0 - 0.024, S.w * 0.56, 0.084, 0.118, 'body');            // the load in it
  } else if (!hitched && S.rig === 'rack') {
    box(frame0 + 0.030, cab0 - 0.020, S.w * 0.66, 0.084, 0.112, 'body');
    if (fine) for (const f of [frame0 + 0.052, frame0 + 0.088]) box(f - 0.003, f + 0.003, S.w * 0.68, 0.112, 0.116, 'strut');   // ratchet straps
  }

  // ── Fittings ── (plugins/trucking/fittings.js), as a `^ab.cd` suffix on the variant.
  // ⚠ Built inside buildTruck, before the centring and settle transforms, and before `tractorFaces` so a
  // dropped trailer doesn't keep them. Colours only via CHROME/ACCENT/strut/body, so the livery reaches them.
  // A fitting is faces only: it never moves a pod, lamp, decal or the kingpin.
  const FITS = new Set(String(str).match(/\^([a-z.]+)/)?.[1].split('.') || []);
  const fitStart = faces.length;
  if (FITS.size) {
    const roofZ = S.hi + S.sleeper;
    const barF = nose1 + 0.014;                 // just ahead of the bumper, where a bar bolts on
    // ── FRONT BAR ──
    if (FITS.has('rp')) {                        // Ram Plate — a ploughed wedge across the whole nose
      box(barF - 0.006, barF + 0.028, S.w * 1.02, 0.030, 0.150, 'strut');
      poly('strut', 0.86, [[barF + 0.028, -S.w * 1.02, 0.150], [barF + 0.028, S.w * 1.02, 0.150],
                           [barF + 0.062, S.w * 0.42, 0.104], [barF + 0.062, -S.w * 0.42, 0.104]]);
      for (const g of [-1, 1]) box(barF - 0.030, barF + 0.004, 0.008, 0.052, 0.070, 'strut', null, g * S.w * 0.7);   // braces back to the frame
    }
    if (FITS.has('tu')) {                        // Tusk Bar — four lengths of pipe, sharpened
      box(barF - 0.004, barF + 0.010, S.w * 0.96, 0.058, 0.074, 'strut');
      for (const g of [-0.72, -0.24, 0.24, 0.72]) {
        for (let i = 0; i < 3; i++) {
          const k = 1 - i * 0.3;
          box(barF + 0.010 + i * 0.020, barF + 0.030 + i * 0.020, 0.011 * k, 0.066 - 0.011 * k, 0.066 + 0.011 * k, 'strut', null, g * S.w);
        }
      }
    }
    if (FITS.has('pb')) {                        // Chrome Push Bar — a hoop with two lamps in it
      for (const g of [-1, 1]) box(barF - 0.002, barF + 0.010, 0.007, 0.048, 0.132, 'window', CHROME, g * S.w * 0.72);
      box(barF - 0.002, barF + 0.010, S.w * 0.74, 0.124, 0.136, 'window', CHROME);
      box(barF - 0.002, barF + 0.010, S.w * 0.74, 0.070, 0.080, 'window', CHROME);
      for (const g of [-1, 1]) box(barF + 0.008, barF + 0.016, 0.014, 0.096, 0.122, 'glass', [212, 208, 176], g * S.w * 0.34);
    }
    if (FITS.has('wn')) {                        // Recovery Winch — drum, fairlead, and cable on it
      box(barF - 0.004, barF + 0.026, 0.030, 0.052, 0.086, 'strut');
      box(barF + 0.002, barF + 0.020, 0.034, 0.060, 0.078, 'gear');                       // the drum, wider than its cradle
      box(barF + 0.024, barF + 0.030, 0.016, 0.058, 0.076, 'window', CHROME);             // the fairlead plate
    }
    if (FITS.has('sx')) {                        // Spike Rack — rebar, cut, sharpened, stood up in a row
      box(barF - 0.004, barF + 0.008, S.w * 0.98, 0.050, 0.060, 'strut');
      for (const g of [-0.84, -0.50, -0.17, 0.17, 0.50, 0.84]) {
        for (let i = 0; i < 3; i++) {
          const k = 1 - i * 0.3;
          box(barF - 0.003, barF + 0.007, 0.005 * k, 0.060 + i * 0.016, 0.076 + i * 0.016, 'strut', null, g * S.w);
        }
      }
    }
    if (FITS.has('gb')) {                        // Grader Blade — a mouldboard on an angle, so what it catches goes SIDEWAYS
      // A raked blade: the two long edges at different heights.
      poly('strut', 0.80, [[barF + 0.004, -S.w * 1.10, 0.024], [barF + 0.004, S.w * 1.10, 0.050],
                           [barF + 0.036, S.w * 1.06, 0.106], [barF + 0.036, -S.w * 1.06, 0.080]]);
      poly('gear', 0.52, [[barF + 0.004, -S.w * 1.10, 0.024], [barF + 0.004, S.w * 1.10, 0.050],
                          [barF - 0.006, S.w * 1.06, 0.058], [barF - 0.006, -S.w * 1.06, 0.032]]);   // the mouth, under the lip
      box(barF + 0.030, barF + 0.040, S.w * 1.05, 0.098, 0.108, 'window', CHROME);        // the top edge, polished by use and nothing else
      for (const g of [-1, 1]) box(barF - 0.028, barF + 0.006, 0.008, 0.044, 0.068, 'strut', null, g * S.w * 0.66);   // the rams back to the frame
    }

    // ── Screen ── ⚠ Quads in the windscreen's raked plane, pushed ahead by `SD`: nothing may share the glass's fore-aft slice.
    if (FITS.has('zm') || FITS.has('zp') || FITS.has('zb')) {
      const SD = 0.010;
      const scrP = (t, g) => [scrF0 + (scrF1 - scrF0) * t + SD, g, scrLo + (scrHi - scrLo) * t];
      const scrQ = (role, sh, t0, t1, g0, g1, tint) =>
        poly(role, sh, [scrP(t0, g0), scrP(t0, g1), scrP(t1, g1), scrP(t1, g0)], tint);
      if (FITS.has('zm')) {                      // Screen Mesh — rebar bent to the rake, welded at every crossing
        for (let i = -3; i <= 3; i++) scrQ('strut', 0.86, 0.03, 0.97, (i - 0.10) * scrW * 0.27, (i + 0.10) * scrW * 0.27);
        for (const t of [0.26, 0.54, 0.82]) scrQ('strut', 0.92, t - 0.030, t + 0.030, -scrW, scrW);
        for (const t of [0.03, 0.97]) scrQ('strut', 0.74, t - 0.026, t + 0.026, -scrW * 1.02, scrW * 1.02);   // the frame it is hung on
      }
      if (FITS.has('zp')) {                      // Slit Plate — boiler plate, and a hand's width of daylight
        scrQ('gear', 0.88, 0.02, 0.44, -scrW * 1.02, scrW * 1.02);
        scrQ('gear', 0.88, 0.60, 0.98, -scrW * 1.02, scrW * 1.02);
        for (const g of [-1, 1]) scrQ('gear', 0.78, 0.44, 0.60, g * scrW * 0.58, g * scrW * 1.02);   // the cheeks either side of the slot
        if (fine) for (const t of [0.09, 0.93]) for (let i = -2; i <= 2; i++)                        // the weld line
          scrQ('strut', 1.00, t - 0.018, t + 0.018, i * scrW * 0.40 - scrW * 0.05, i * scrW * 0.40 + scrW * 0.05);
      }
      if (FITS.has('zb')) scrQ('window', 0.94, 0.80, 0.98, -scrW, scrW, [122, 70, 42]);   // Sun Strip — a band of dark tint, and the oldest thing a driver does
    }

    // ── ROOF ──
    if (FITS.has('rc')) {                        // Roof Cage — bar, cans, a rolled tarp
      const f0 = cab1 - 0.150, f1 = cab0 + 0.010;
      for (const g of [-1, 1]) box(f0, f1, 0.005, roofZ + 0.004, roofZ + 0.040, 'strut', null, g * S.w * 0.92);
      for (const f of [f0, (f0 + f1) / 2, f1]) box(f - 0.004, f + 0.004, S.w * 0.94, roofZ + 0.034, roofZ + 0.040, 'strut');
      if (fine) {
        for (const g of [-0.5, 0.5]) box(f0 + 0.014, f0 + 0.048, 0.018, roofZ + 0.006, roofZ + 0.036, 'body', null, g * S.w);   // cans
        box(f1 - 0.052, f1 - 0.006, S.w * 0.5, roofZ + 0.008, roofZ + 0.032, 'gear');                                           // the rolled tarp
      }
    }
    if (FITS.has('lb')) {                        // Halogen Light Bar — eight lamps on a chrome rail
      const f = cab1 - 0.062;
      box(f - 0.008, f + 0.008, S.w * 0.92, roofZ + 0.004, roofZ + 0.012, 'window', CHROME);
      for (let i = -3; i <= 3; i += 2) {
        box(f - 0.010, f + 0.010, 0.017, roofZ + 0.012, roofZ + 0.044, 'window', CHROME, i * S.w * 0.24);
        box(f + 0.008, f + 0.013, 0.014, roofZ + 0.016, roofZ + 0.040, 'glass', [216, 210, 178], i * S.w * 0.24);
      }
    }
    if (FITS.has('bc')) {                        // Amber Beacon — one lamp on a stalk
      const f = cab0 - 0.006;
      box(f - 0.004, f + 0.004, 0.005, roofZ, roofZ + 0.022, 'strut');
      box(f - 0.012, f + 0.012, 0.013, roofZ + 0.022, roofZ + 0.046, 'glass', [236, 158, 48]);
      box(f - 0.013, f + 0.013, 0.014, roofZ + 0.018, roofZ + 0.024, 'window', CHROME);
    }
    if (FITS.has('tm')) {                        // Totem Rack — everything on it was taken off something
      const f = cab0 - 0.004;
      box(f - 0.003, f + 0.003, S.w * 0.86, roofZ + 0.002, roofZ + 0.008, 'strut');
      // Irregular on purpose: evenly spaced reads as bought.
      for (const [g, h, w] of [[-0.78, 0.030, 0.010], [-0.30, 0.046, 0.007], [0.16, 0.024, 0.012], [0.66, 0.038, 0.008]]) {
        box(f - 0.004, f + 0.004, w, roofZ + 0.008, roofZ + 0.008 + h, 'gear', null, g * S.w);
      }
    }
    if (FITS.has('np')) {                        // Roof Parapet — plate up round the sleeper, CUT LOW at the front
      // The low front wall is what makes it a firing position.
      const f0 = cab1 - 0.150, f1 = cab0 + 0.008;
      for (const g of [-1, 1]) box(f0, f1, 0.005, roofZ + 0.002, roofZ + 0.032, 'gear', null, g * S.w * 0.90);
      box(f0, f0 + 0.007, S.w * 0.90, roofZ + 0.002, roofZ + 0.017, 'gear');
      box(f1 - 0.007, f1, S.w * 0.90, roofZ + 0.002, roofZ + 0.032, 'gear');
      if (fine) {
        box(f0 + 0.026, f0 + 0.034, 0.008, roofZ + 0.017, roofZ + 0.050, 'strut', null, -S.w * 0.34);   // a stanchion
        box(f0 + 0.024, f0 + 0.074, 0.010, roofZ + 0.006, roofZ + 0.020, 'gear', null, S.w * 0.36);     // and something rolled up against the wall
      }
    }
    if (FITS.has('af')) {                        // Aerial Farm — five whips, none of them the same length
      const f = cab0 + 0.006;
      box(f - 0.004, f + 0.004, S.w * 0.82, roofZ, roofZ + 0.007, 'strut');
      for (const [g, h] of [[-0.86, 0.086], [-0.42, 0.052], [0.04, 0.106], [0.50, 0.066], [0.88, 0.040]]) {
        box(f - 0.002, f + 0.002, 0.002, roofZ + 0.007, roofZ + 0.007 + h, 'strut', null, g * S.w);
        if (fine) box(f - 0.003, f + 0.003, 0.004, roofZ + 0.005 + h, roofZ + 0.009 + h, 'window', CHROME, g * S.w);   // the tip
      }
    }

    // ── Stacks ── Only on trucks that have them.
    if (S.stacks > 0) {
      const stackTop = roofZ + 0.062;
      for (let i = 0; i < S.stacks; i++) {
        const g = (S.stacks === 1 ? 0 : (i ? 1 : -1)) * S.w * 0.94;
        if (FITS.has('cs')) {                    // Straight Cut — the flare gone, the pipe cut square
          box(cab0 - 0.019, cab0 + 0.019, 0.018, stackTop, stackTop + 0.030, 'gear', null, g);
        }
        if (FITS.has('ft')) {                    // Flame Tips — split, flared, heat-blued
          for (let k = 0; k < 3; k++) box(cab0 - 0.018 - k * 0.003, cab0 + 0.018 + k * 0.003, 0.017 + k * 0.004,
            stackTop - 0.004 + k * 0.010, stackTop + 0.006 + k * 0.010, 'glass', [84, 96, 150], g);
        }
        if (FITS.has('sn')) {                    // Stack Sleeves — lit tubing wound up the pipe
          for (let k = 0; k < 4; k++) box(cab0 - 0.020, cab0 + 0.020, 0.019, 0.090 + k * 0.038, 0.100 + k * 0.038, 'window', ACCENT, g);
        }
        if (FITS.has('so')) {                    // Soot Pipes — tarred to the shield, and a rain flap sitting crooked
          box(cab0 - 0.021, cab0 + 0.021, 0.020, stackTop - 0.034, stackTop + 0.004, 'gear', null, g);
          box(cab0 - 0.026, cab0 + 0.010, 0.022, stackTop + 0.004, stackTop + 0.010, 'gear', null, g);
        }
      }
    }

    // ── FLANKS ──
    for (const g of [-1, 1]) {
      const gw = g * S.w;
      if (FITS.has('ap')) {                      // Riveted Plate — mismatched sheet over the doors
        box(cab1 - 0.118, cab1 - 0.040, 0.006, S.hi * 0.16, S.hi * 0.56, 'gear', null, gw + g * 0.005);
        box(cab1 - 0.046, cab1 - 0.004, 0.006, S.hi * 0.24, S.hi * 0.50, 'gear', null, gw + g * 0.005);
        if (fine) for (const z of [S.hi * 0.20, S.hi * 0.52]) for (let i = 0; i < 4; i++)   // the rivet line
          box(cab1 - 0.112 + i * 0.024, cab1 - 0.108 + i * 0.024, 0.003, z, z + 0.004, 'strut', null, gw + g * 0.010);
      }
      if (FITS.has('jc')) {                      // Jerry Rack — range you can see
        box(cab0 - 0.078, cab0 - 0.020, 0.020, 0.086, 0.094, 'strut', null, gw + g * 0.016);
        for (let i = 0; i < 3; i++) box(cab0 - 0.074 + i * 0.020, cab0 - 0.058 + i * 0.020, 0.018, 0.094, 0.126, 'body', null, gw + g * 0.016);
      }
      if (FITS.has('sw')) {                      // Saw-Blade Skirt — teeth outward
        box(cab1 - 0.120, cab0 - 0.010, 0.004, 0.028, 0.036, 'strut', null, gw + g * 0.010);
        for (let i = 0; i < 5; i++) {
          const f = cab1 - 0.112 + i * 0.026;
          box(f - 0.014, f + 0.014, 0.003, 0.024, 0.030, 'window', CHROME, gw + g * 0.014);
          box(f - 0.004, f + 0.004, 0.003, 0.014, 0.040, 'window', CHROME, gw + g * 0.014);
        }
      }
      if (FITS.has('sr')) {                      // Chrome Runner — the show-truck answer
        box(cab1 - 0.108, cab0 - 0.006, 0.012, 0.040, 0.047, 'window', CHROME, gw + g * 0.018);
        box(cab1 - 0.104, cab0 - 0.010, 0.010, 0.036, 0.040, 'window', ACCENT, gw + g * 0.018);   // lit underneath
        for (const f of [cab1 - 0.100, cab0 - 0.020]) box(f - 0.003, f + 0.003, 0.010, 0.047, 0.062, 'strut', null, gw + g * 0.014);
      }
      if (FITS.has('xr')) {                      // Spear Rack — pipe racked where a ladder would go
        for (const f of [cab1 - 0.096, cab0 + 0.024]) box(f - 0.004, f + 0.004, 0.013, S.hi * 0.28, S.hi * 0.42, 'strut', null, gw + g * 0.013);
        // Two ground to a point, two plain pipe.
        for (let i = 0; i < 4; i++) {
          const z = S.hi * 0.29 + i * 0.009, gg = gw + g * (0.009 + i * 0.0025);
          box(cab1 - 0.104, cab0 + 0.030, 0.004, z, z + 0.005, 'gear', null, gg);
          if (fine && i < 2) for (let k = 0; k < 3; k++) {
            const kk = 1 - k * 0.3;
            box(cab1 - 0.104 - (k + 1) * 0.009, cab1 - 0.104 - k * 0.009, 0.004 * kk, z + 0.0025 - 0.0025 * kk, z + 0.0025 + 0.0025 * kk, 'strut', null, gg);
          }
        }
      }
      if (FITS.has('hd')) {                      // Hide Drape — skins on a rail, weighted at the hem
        box(cab1 - 0.118, cab1 - 0.022, 0.004, S.hi * 0.60, S.hi * 0.645, 'strut', null, gw + g * 0.008);        // the rail
        box(cab1 - 0.112, cab1 - 0.028, 0.005, S.hi * 0.20, S.hi * 0.61, 'body', [98, 76, 56], gw + g * 0.006);  // the skins
        if (fine) for (let i = 0; i < 4; i++)                                                                    // the weights, one per panel
          box(cab1 - 0.108 + i * 0.022, cab1 - 0.100 + i * 0.022, 0.004, S.hi * 0.165, S.hi * 0.205, 'gear', null, gw + g * 0.008);
      }
    }

    // ── Underlights ── `ug` light is drawn at the lamp layer; only the fixture is geometry here.
    if (FITS.has('ug')) for (const g of [-1, 1]) box(nose0 + 0.020, frame0 + 0.06, 0.006, 0.022, 0.028, 'window', ACCENT, g * S.w * 0.86);
    if (FITS.has('hl')) for (const [f, g] of podAt.filter(([, , , deck]) => !deck).map(([f, g]) => [f, g])) {
      box(f - 0.030, f + 0.030, 0.027, 0.030, 0.034, 'window', ACCENT, g);
      box(f - 0.032, f - 0.026, 0.026, 0.030, 0.052, 'window', ACCENT, g);
      box(f + 0.026, f + 0.032, 0.026, 0.030, 0.052, 'window', ACCENT, g);
    }
    if (FITS.has('bn')) for (const g of [-1, 1]) box(cab0 + 0.014, cab1 - 0.014, 0.004, S.hi * 0.425, S.hi * 0.455, 'window', ACCENT, g * S.w);
    if (FITS.has('dc')) for (const g of [-1, 1]) {   // Drag Chains — hung off both rails, sweeping
      box(frame0 + 0.020, cab1 - 0.060, 0.004, 0.026, 0.030, 'strut', null, g * S.w * 0.64);
      const span = (cab1 - 0.060) - (frame0 + 0.020);
      for (let i = 0; i < 5; i++) {
        // Uneven lengths so they read as separate chains.
        const drop = [0.020, 0.006, 0.017, 0.009, 0.014][i];
        box(frame0 + 0.028 + i * (span - 0.016) / 4 - 0.003, frame0 + 0.028 + i * (span - 0.016) / 4 + 0.003,
          0.003, 0.026 - drop, 0.028, 'gear', null, g * S.w * 0.64);
      }
    }

    // ── BACK END ──
    if (FITS.has('ch')) {                        // Chain Rack — loops of load chain, swinging
      for (const g of [-1, 1]) for (let i = 0; i < 3; i++) {
        const gg = g * S.w * (0.42 + i * 0.22);
        box(cab0 - 0.012, cab0 - 0.006, 0.006, 0.070, 0.090, 'strut', null, gg);
        box(cab0 - 0.011, cab0 - 0.007, 0.010, 0.058, 0.072, 'gear', null, gg);
      }
    }
    if (FITS.has('sp')) {                        // Spare Pod Cradle — a whole lifter, stood on end
      box(cab0 - 0.030, cab0 - 0.008, 0.048, 0.076, 0.086, 'strut');
      box(cab0 - 0.028, cab0 - 0.010, 0.044, 0.086, 0.150, 'gear');
      box(cab0 - 0.029, cab0 - 0.009, 0.046, 0.104, 0.118, 'window', CHROME);   // its hubcap band, the tell that it is a pod
    }
    if (FITS.has('bp')) {                        // Banner Pole — a whip with a rag on it
      const g = S.w * 0.9;
      box(cab0 - 0.006, cab0 - 0.002, 0.003, 0.070, roofZ + 0.070, 'strut', null, g);
      box(cab0 - 0.006, cab0 + 0.022, 0.002, roofZ + 0.020, roofZ + 0.062, 'body', null, g);
    }
    if (FITS.has('ct')) {                        // Scrap Hopper — a bin on the headboard, and a chute out the back of it
      box(cab0 - 0.046, cab0 - 0.012, 0.052, 0.076, 0.124, 'gear');
      box(cab0 - 0.050, cab0 - 0.008, 0.056, 0.124, 0.131, 'strut');                       // the lip round the mouth
      box(cab0 - 0.056, cab0 - 0.036, 0.028, 0.054, 0.078, 'strut');                       // the chute, and where it is aimed is the joke
      if (fine) {
        for (const g of [-1, 1]) box(cab0 - 0.042, cab0 - 0.016, 0.005, 0.131, 0.146, 'gear', null, g * 0.038);   // what is standing proud of the load
        box(cab0 - 0.034, cab0 - 0.022, 0.020, 0.131, 0.140, 'gear');
      }
    }
    if (FITS.has('wb')) {                        // Water Bowser — four hundred litres, and a tap at the bottom
      box(cab0 - 0.062, cab0 - 0.010, 0.058, 0.076, 0.126, 'body');
      for (const z of [0.086, 0.114]) box(cab0 - 0.064, cab0 - 0.008, 0.060, z, z + 0.005, 'strut');   // the straps holding it upright
      box(cab0 - 0.038, cab0 - 0.028, 0.011, 0.126, 0.136, 'strut');                                   // the filler
      if (fine) box(cab0 - 0.070, cab0 - 0.060, 0.006, 0.062, 0.080, 'window', CHROME);
    }

    // ── Mascot ── On the bonnet, or the cowl on a cab-over.
    if (FITS.has('sk') || FITS.has('cb') || FITS.has('dh') || FITS.has('wi')) {
      const mF = S.nose > 0.02 ? nose1 - 0.030 : cab1 - 0.020;
      const mZ = S.nose > 0.02 ? 0.128 : S.hi * 0.96;
      if (FITS.has('sk')) {                      // Bleached Skull
        box(mF - 0.010, mF + 0.010, 0.011, mZ, mZ + 0.016, 'body', [216, 208, 186]);
        box(mF + 0.008, mF + 0.020, 0.007, mZ + 0.001, mZ + 0.010, 'body', [216, 208, 186]);   // the muzzle
        for (const g of [-1, 1]) box(mF + 0.004, mF + 0.009, 0.003, mZ + 0.008, mZ + 0.012, 'glass', [18, 16, 14], g * 0.005);
      }
      if (FITS.has('cb')) bullet(mF - 0.014, 0.034, 0, 0.009, mZ + 0.010);   // Chrome Bird, at this scale a chromed dart
      if (FITS.has('dh')) {                      // Doll Head
        box(mF - 0.008, mF + 0.008, 0.009, mZ, mZ + 0.016, 'body', [222, 196, 176]);
        for (const g of [-1, 1]) box(mF + 0.006, mF + 0.009, 0.002, mZ + 0.008, mZ + 0.011, 'glass', [30, 40, 60], g * 0.004);
      }
      if (FITS.has('wi')) {                      // Wheel Idol — a steering wheel stood upright, FACING THE ROAD
        // Stands across the truck, facing the road.
        box(mF - 0.005, mF + 0.005, 0.007, mZ, mZ + 0.009, 'strut');                                  // the plinth
        for (const z of [mZ + 0.009, mZ + 0.045]) box(mF - 0.002, mF + 0.002, 0.021, z, z + 0.004, 'window', CHROME);
        for (const g of [-1, 1]) box(mF - 0.002, mF + 0.002, 0.003, mZ + 0.009, mZ + 0.049, 'window', CHROME, g * 0.019);
        box(mF - 0.003, mF + 0.003, 0.005, mZ + 0.025, mZ + 0.033, 'window', CHROME);                 // the boss
        if (fine) for (const g of [-1, 1]) box(mF - 0.002, mF + 0.002, 0.010, mZ + 0.027, mZ + 0.031, 'strut', null, g * 0.010);   // and its spokes
      }
    }
  }

  // ⚠ Fitting faces are marked so the bounds scan skips them: a bolt-on must never shift the centring
  // (lamps, decal and kingpin are placed through it).
  for (let i = fitStart; i < faces.length; i++) faces[i].fit = 1;
  const tractorFaces = faces.length;   // the split point: everything before here is the tractor
  if (hitched) {
    // The trailer, a separate body behind the tractor (the articulation seam). ⚠ Its nose is the fifth wheel's
    // centre: further aft reads as a drawbar, further forward runs into the cab.
    const t1 = frame0 + 0.06, t0 = t1 - S.deck;
    const tTop = deckTop + S.hi * 0.95;
    // The box, with stepped (radiused) front corners for swing clearance (NOSE_TAPER). Height derives from `hi`.
    const tBev = t1 - 0.030;
    box(t0, tBev, S.w * 1.02, 0.075, tTop, 'body');                 // the box
    box(tBev, tBev + 0.016, S.w * 1.02 * ((1 + NOSE_TAPER) / 2), 0.075, tTop, 'body');   // first step in
    box(tBev + 0.016, t1, boxNoseHalf(S), 0.075, tTop, 'body');     // the nose face itself
    box(t0 + 0.01, tBev, S.w * 0.99, tTop, tTop + 0.010, 'body');   // roof cap, stopping at the taper
    // Ribs on the flank.
    for (let i = 0; fine && i < 6; i++) {
      const f = t0 + 0.03 + i * (S.deck - 0.06) / 5;
      for (const g of [-1, 1]) box(f - 0.004, f + 0.004, 0.004, 0.085, tTop - 0.008, 'strut', null, g * S.w * 1.03);
    }
    // Conspicuity tape low on the flank, and the rear doors with their lock bars.
    for (const g of [-1, 1]) box(t0 + 0.02, t1 - 0.02, 0.003, 0.086, 0.098, 'window', [216, 168, 72], g * S.w * 1.04);
    box(t0, t0 + 0.006, S.w * 1.0, 0.075, tTop - 0.005, 'strut');     // the doors, at the back
    for (const g of [-1, 1]) box(t0 - 0.001, t0 + 0.002, 0.004, 0.080, tTop - 0.010, 'strut', null, g * S.w * 0.5);   // lock bars
    for (const g of [-1, 1]) box(t0 - 0.002, t0 + 0.004, 0.014, 0.088, 0.104, 'window', [186, 62, 52], g * S.w * 0.78);   // tail lamps
    // Landing legs.
    for (const g of [-1, 1]) box(t1 - 0.09, t1 - 0.075, 0.010, 0.005, 0.078, 'strut', null, g * S.w * 0.72);
    for (const g of [-gOut, gOut]) {                                   // lifter bogie under the tail
      pod(t0 + 0.075, g, 0.050, 1.0, true); pod(t0 + 0.185, g, 0.050, 1.0, true);
    }
    if (S.skirt) for (const g of [-1, 1]) box(t0 + 0.20, t1 - 0.03, 0.008, 0.040, 0.078, 'body', null, g * S.w * 0.98);   // trailer skirt
    for (const g of [-1, 1]) box(t0 - 0.012, t0 - 0.004, 0.026, 0.01, 0.06, 'strut', null, g * S.w * 0.7);  // mudflaps
    // Back of the box: structural detail on `fine`, so every trailer gets it.
    if (fine) {
      for (const g of [-1, 1]) for (let i = 0; i < 3; i++) {
        const z = 0.092 + i * (tTop - 0.115) / 2;
        box(t0 - 0.003, t0 + 0.004, 0.010, z, z + 0.012, 'strut', null, g * S.w * 0.92);
      }
      // DOT underrun bar.
      box(t0 - 0.010, t0 - 0.002, S.w * 0.92, 0.048, 0.058, 'strut');
      for (const g of [-1, 1]) box(t0 - 0.008, t0 - 0.004, 0.006, 0.058, 0.075, 'strut', null, g * S.w * 0.60);
      box(t0 - 0.001, t0 + 0.002, 0.020, tTop * 0.62, tTop * 0.62 + 0.026, 'window', [210, 198, 160], S.w * 0.42);
      box(t0 - 0.002, t0 + 0.001, S.w * 0.86, 0.078, 0.086, 'window', [222, 154, 62]);
      box(t0 + 0.002, t0 + 0.006, 0.004, 0.086, tTop * 0.55, 'strut', null, -S.w * 0.86);
      box(t0 + 0.004, t0 + 0.020, 0.012, 0.046, 0.051, 'strut', null, -S.w * 0.78);
      for (let i = 0; i < 5; i++) {
        const f = t0 + 0.05 + i * (S.deck - 0.10) / 4;
        box(f - 0.003, f + 0.003, S.w * 0.98, tTop + 0.010, tTop + 0.013, 'body');
      }
      // Air and electrical couplings on the box's nose.
      for (const g of [-1, 1]) box(t1 - 0.004, t1 + 0.004, 0.007, 0.088, 0.098, 'strut', null, g * S.w * 0.28);
    }
  }

  // Mark the trailer's faces (`deck`, its own livery colour). ⚠ Before the solo splice, or there's no boundary left.
  for (let i = tractorFaces; i < faces.length; i++) faces[i].deck = 1;

  // Solo: throw the tractor away, so a dropped box is the same geometry you tow. Before centring.
  if (solo) faces.splice(0, tractorFaces);
  // Centre it: consumers place the mesh by its origin. Derived per variant, never typed.
  let lo = Infinity, hi = -Infinity;
  for (const f of faces) { if (f.fit) continue; for (const p of f.p) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0]; } }
  // ⚠ A solo box is anchored on its pin (its front station): the server stores the coupling point.
  const shift = solo ? hi : (lo + hi) / 2;
  // Through a Set, because box() shares corner vertices between faces. Parked rigs settle by HOVER;
  // a solo box is ground-fitted from its own lowest point instead.
  const settle = parked;
  // ⚠ Box centres (`cen`) move with the vertices, through the same Set (six faces share one centre),
  // or the cull and sun normal measure from the wrong point and parts flicker or show through.
  if (shift || settle) {
    const seen = new Set();
    for (const f of faces) {
      if (!f.cen || seen.has(f.cen)) continue;
      seen.add(f.cen);
      f.cen[0] -= shift;
      if (settle) f.cen[2] -= HOVER;
    }
    for (const f of faces) for (const p of f.p) {
      if (seen.has(p)) continue;
      seen.add(p);
      p[0] -= shift;
      // A parked rig settles as one rigid body.
      if (settle) p[2] -= HOVER;
    }
  }
  // ⚠ Publish the centring (TRUCK_META) so lamps and decals follow the mesh. Ground-fit a solo box.
  let drop = settle ? HOVER : 0;
  if (solo) {
    let zmin = Infinity;
    for (const f of faces) for (const p of f.p) if (p[2] < zmin) zmin = p[2];
    if (zmin !== 0 && Number.isFinite(zmin)) {
      const seen = new Set();
      for (const f of faces) for (const p of f.p) { if (seen.has(p)) continue; seen.add(p); p[2] -= zmin; }
      drop = zmin;
    }
  }
  // ── The door panel ── Where door art goes (drawTruckDoorArt), from here so it fits each rig.
  // ⚠ It's the clear panel aft of the B-post and under the chrome spear and beltline strip. If you move the spear, move this.
  // `g` is the flank half-width.
  const doorF1 = cab1 - 0.052 - shift, doorF0 = cab1 - 0.104 - shift;
  const doorZ0 = S.hi * 0.185 - drop, doorZ1 = S.hi * 0.345 - drop;
  // ── The kingpin ── Middle of the fifth wheel in the centred frame; the articulation turns about it.
  // Null on a solo box, which is already anchored on its pin.
  TRUCK_META.set(str + ':' + detail, {
    shift, drop, pods: podAt,
    pin: solo ? null : (PIN_F0 + PIN_F1) / 2 - shift,
    // The clearance check's inputs, published so a test can catch the frameBack relation breaking.
    cabBack: solo ? null : cab0 - shift,
    boxHalf: boxNoseHalf(S),   // the corner that swings is the NOSE corner — see NOSE_TAPER
    door: solo ? null : { f0: doorF0, f1: doorF1, z0: doorZ0, z1: doorZ1, g: S.w },
  });
  return faces;
}
// variant+detail → { shift, drop, pods, pin, cabBack, boxHalf, door }. See the ⚠ at the end of buildTruck.
const TRUCK_META = new Map();
// Read-only, for the regress suite.
export const truckMeta = (key) => TRUCK_META.get(key) || null;
// A wreck: a stripped default hull.
function buildWreck() {
  if (_cache.wreck) return _cache.wreck;
  const stripped = new Set(['glass', 'window', 'fin', 'rudder', 'aileron', 'flap', 'elevator']);   // a carcass keeps no tidy control surfaces
  const faces = buildFixedWing(FW_DEFAULT).filter(f =>
    !stripped.has(f.role) && !(f.role === 'wing' && f.p.some(v => v[1] < 0)));
  _cache.wreck = faces;
  return faces;
}

// ── Procedural hull texture ── A memoised grey panel texture overlaid on hull faces, so it adds detail without
// shifting the livery. Used by the single-craft turntable only.
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

// ── Jazz livery ── Memphis dry-brush splatter, baked once per colour set and mapped in body space (jazzUV),
// so it's continuous across facets and both flanks mirror. Seeded off the colours so it never shimmers.
export const JAZZ_ROLE = new Set(['body', 'wing', 'aileron', 'flap', 'stab', 'elevator', 'fin', 'rudder', 'nacelle']);
const JAZZ_GROUND = [238, 231, 214];   // bone undercoat (the "cup paper" the colours pop against)
const JZ_TW = 256, JZ_TH = 140;
// Supersampled bake for crisper close-ups; jazzUV scales to match.
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
// Body coords to texture pixels. Fore drives U; V is up (or right on wings). g's sign is dropped so flanks mirror.
export function jazzUV(v, role) {
  const along = 0.5 + v[0] * 0.42;
  const across = 0.5 - ((role === 'wing' || role === 'aileron' || role === 'flap') ? v[1] * 0.30 : v[2] * 0.55);
  return [jzClamp(along) * JZ_TW * JZ_SS, jzClamp(across) * JZ_TH * JZ_SS];
}
// Multiply over the facet's shaded fill, so its lighting carries through.
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

// Glass sheen: a sky wash, a specular streak and a darker lower edge on each pane. Shared by every renderer.
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

// ── Canopy art ── One transparent canvas per airframe style, mapped through the facet UVs. Glazed areas stay
// translucent so the facet's shading shows; frames and crew are opaque. U runs windscreen to rear, V sill to
// roof to sill (symmetric). Frame posts sit on the mesh's STATION_U seams. Units are in client/shared/vehicle-mesh.js.
export const CP_TW = _CP_TW, CP_TH = _CP_TH;

// Per-airframe specs: wash (sill-roof-sill gradient), crew, glow, spec (sun streaks in a V band) and frame.
const CANOPY_ART = {
  // Viper, a gunship's smoked armoured glass: dark, tight, heavily framed, two helmets inside.
  viper: {
    wash: [[0.00, 'rgba(6,11,16,0.90)'], [0.16, 'rgba(9,16,23,0.82)'], [0.34, 'rgba(34,60,80,0.40)'],
           [0.46, 'rgba(150,196,222,0.32)'], [0.54, 'rgba(150,196,222,0.32)'], [0.66, 'rgba(34,60,80,0.40)'],
           [0.84, 'rgba(9,16,23,0.82)'], [1.00, 'rgba(6,11,16,0.90)']],
    // Crew sit mid-cheek-pane so a mullion never bisects a head.
    crew: [{ u: 0.29, v: 0.30, sc: 0.9, visor: 'rgba(96,190,150,0.55)' }, { u: 0.29, v: 0.70, sc: 0.9, visor: 'rgba(96,190,150,0.55)' },
           { u: 0.71, v: 0.30, sc: 1.0, visor: 'rgba(96,190,150,0.55)' }, { u: 0.71, v: 0.70, sc: 1.0, visor: 'rgba(96,190,150,0.55)' }],
    glow: { u: [0.06, 0.50], col: '70,150,190', a: 0.22, r: 70 },
    spec: { band: [0.26, 0.74], streaks: [[0.18, 30, 0.15], [0.62, 18, 0.10]] },
    frame: { col: 'rgba(26,30,36,0.95)', lit: 'rgba(84,92,102,0.55)',
      posts: [[0.00, 8], [0.14, 8], [0.44, 13], [0.56, 13], [0.86, 8], [1.00, 8]],   // the tandem step is the beefiest frame on the aircraft
      sills: [[0.20, 10], [0.80, 10]], hairs: [0.40, 0.60], mid: 5, edge: 16 },
  },
  // Mayfly: a bright clear greenhouse, two seats abreast. Only the windscreen bay (U 0 to 0.18) shows all of V;
  // behind it only V 0 to 1/6 and 5/6 to 1 are glass, so a detail on the crown aft of the screen never draws.
  mayfly: {
    wash: [[0.00, 'rgba(22,34,44,0.62)'], [0.14, 'rgba(38,62,80,0.44)'], [0.32, 'rgba(120,168,196,0.26)'],
           [0.46, 'rgba(196,226,244,0.30)'], [0.54, 'rgba(196,226,244,0.30)'], [0.68, 'rgba(120,168,196,0.26)'],
           [0.86, 'rgba(38,62,80,0.44)'], [1.00, 'rgba(22,34,44,0.62)']],
    // Two heads abreast at the front seats, at eye level in the glazed flank band.
    crew: [{ u: 0.30, v: 0.08, sc: 0.85, hair: 'rgba(58,44,36,0.9)' }, { u: 0.30, v: 0.92, sc: 0.85, hair: 'rgba(30,32,38,0.9)' }],
    glow: { u: [0.05, 0.12], col: '120,190,150', a: 0.16, r: 56 },
    spec: { band: [0.0, 1.0], streaks: [[0.06, 30, 0.20], [0.13, 20, 0.13]] },   // sun rake across the windscreen U
    frame: { col: 'rgba(34,38,44,0.9)', lit: 'rgba(140,150,160,0.25)',   // dark rubber window seals: white edging read as a drawn outline round every pane
      // Posts on the mesh's STATION_U seams. Between 0.66 and 0.74 the hull is an unglazed painted post.
      posts: [[0.00, 7], [0.26, 11], [0.66, 6], [0.74, 6], [0.86, 7]],   // 0.26: the A-pillar, where the screen ends at f 0.35; 0.86: the rear window ends at the f 0 → -0.12 bay
      sills: [[2 / 6, 6], [4 / 6, 6]],   // the TOP of the side glass (it runs k 0-1 and k 4-5); a line at k=1 cut every window in half
      mid: 0, edge: 11 },   // mid 0: a 172's windscreen is one pane, no centre post
  },
  // Mule: a Twin Otter flight deck, green-tinted, chunky frames, two pilots, panel glow, wipers.
  mule: {
    wash: [[0.00, 'rgba(12,20,26,0.80)'], [0.16, 'rgba(20,36,46,0.66)'], [0.34, 'rgba(58,102,116,0.34)'],
           [0.47, 'rgba(150,198,208,0.30)'], [0.53, 'rgba(150,198,208,0.30)'], [0.66, 'rgba(58,102,116,0.34)'],
           [0.84, 'rgba(20,36,46,0.66)'], [1.00, 'rgba(12,20,26,0.80)']],
    // Glazed hull: windscreen bays (U 0 to 0.20) show all of V; side bays only V 0 to 1/6 and 5/6 to 1.
    crew: [{ u: 0.32, v: 0.09, sc: 0.95, cap: true, hair: 'rgba(24,26,32,0.92)' },
           { u: 0.32, v: 0.91, sc: 0.95, cap: true, hair: 'rgba(24,26,32,0.92)' }],
    glow: { u: [0.05, 0.12], col: '90,170,200', a: 0.26, r: 66 },   // panel glow up the windscreen
    spec: { band: [0.0, 1.0], streaks: [[0.09, 22, 0.18], [0.15, 14, 0.11]] },   // sun rake clipped to the windscreen U
    frame: { col: 'rgba(38,42,48,0.95)', lit: 'rgba(96,104,114,0.5)',
      // U posts on the real ring seams (glaze f 0.70 to 0.30).
      posts: [[0.00, 8], [0.10, 6], [0.20, 12], [0.55, 8], [0.90, 8], [1.00, 8]],
      sills: [[1 / 6, 8], [5 / 6, 8]],   // window line — the side-band/cheek seam; the base of the windscreen wrap
      hairs: [], mid: 7, edge: 14, extra: 'wipers' },   // mid = the windscreen CENTRE POST between the two panes (V=0.5; only the windscreen glazes the crown, so it shows there alone)
  },
  // Reaper: an A-10 bubble, gold-flashed, near-frameless over the crown, heavy bow frame. arc 5 gives V bands of 0.2.
  reaper: {
    wash: [[0.00, 'rgba(8,12,14,0.86)'], [0.15, 'rgba(14,22,24,0.74)'], [0.32, 'rgba(58,74,54,0.38)'],
           [0.44, 'rgba(196,196,150,0.26)'], [0.56, 'rgba(196,196,150,0.26)'], [0.68, 'rgba(58,74,54,0.38)'],
           [0.85, 'rgba(14,22,24,0.74)'], [1.00, 'rgba(8,12,14,0.86)']],
    crew: [{ u: 0.30, v: 0.28, sc: 1.0, visor: 'rgba(120,200,160,0.5)', hair: 'rgba(24,28,26,0.94)' },
           { u: 0.30, v: 0.72, sc: 1.0, visor: 'rgba(120,200,160,0.5)', hair: 'rgba(24,28,26,0.94)' }],
    glow: { u: [0.05, 0.14], col: '110,220,140', a: 0.24, r: 62 },   // HUD + panel light up the bow
    spec: { band: [0.24, 0.76], streaks: [[0.22, 30, 0.19], [0.66, 18, 0.11]] },
    frame: { col: 'rgba(30,34,32,0.95)', lit: 'rgba(96,104,96,0.5)',
      posts: [[0.00, 16], [0.13, 11], [0.98, 9], [1.00, 12]],   // the bow frame is the heaviest thing on the canopy; the rear arch closes it
      sills: [[0.20, 9], [0.80, 9]],   // the canopy rails the clamshell seals onto — a real facet seam at arc 5
      hairs: [0.40, 0.60], mid: 0, edge: 13 },
  },
  // Leviathan: an An-124 flight deck glazed into the hull, with a four-person crew. The crown (V 0.375 to 0.625)
  // is never drawn; the windscreen bay glazes V 0.125-0.375 and 0.625-0.875, side glass only 0.25-0.375 / 0.625-0.75.
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
      // Undivided: perimeter and sill rails only. On a strip this narrow, posts, blinds and wipers each became a line across it.
      posts: [], hairs: [], mid: 0,
      sills: [[0.25, 7], [0.75, 7]],   // the window line — the only structure left
      edge: 11, extra: ['glareshield'],
      // The glareshield inside each sill, so the strip reads as a window with a cockpit behind it.
      shieldV: [[0.25, 0.315], [0.75, 0.685]], deckU: 0.5 },
  },
  // Grasshopper: an XCub greenhouse with a skylight, black cage with white frames, tandem crew.
  // Unlike the Mayfly the crown band (V 1/3 to 2/3) is glass, so `sills` sit on the real seams either side.
  xcub: {
    wash: [[0.00, 'rgba(18,28,36,0.66)'], [0.13, 'rgba(30,50,64,0.46)'], [0.30, 'rgba(108,158,186,0.26)'],
           [0.44, 'rgba(206,234,248,0.34)'], [0.56, 'rgba(206,234,248,0.34)'], [0.70, 'rgba(108,158,186,0.26)'],
           [0.87, 'rgba(30,50,64,0.46)'], [1.00, 'rgba(18,28,36,0.66)']],
    crew: [{ u: 0.30, v: 0.08, sc: 0.9, shades: true, jacket: '206,74,34' }, { u: 0.30, v: 0.92, sc: 0.9, shades: true, jacket: '206,74,34' },
           { u: 0.62, v: 0.08, sc: 0.9, shades: true, jacket: '32,36,44' }, { u: 0.62, v: 0.92, sc: 0.9, shades: true, jacket: '32,36,44' }],
    glow: { u: [0.06], col: '110,180,210', a: 0.18, r: 52 },
    spec: { band: [0.20, 0.80], streaks: [[0.30, 38, 0.22], [0.74, 20, 0.12]] },
    frame: { col: 'rgba(22,24,28,0.95)', lit: 'rgba(238,240,244,0.75)',   // black cage, white-painted highlight
      // On buildCub's STATION_U seams.
      posts: [[0.00, 8], [0.18, 9], [0.48, 6], [0.78, 6], [1.00, 8]],
      sills: [[1 / 3, 6], [2 / 3, 6]],   // the skylight's edge rails — and exactly the V-band edges of the crown facets (k2/k3)
      mid: 3, edge: 12, extra: 'skylight' },
  },
  // Locust: a deep caged greenhouse on the hopper, yellow-primed frames, amber glass, tandem crew. arc 5.
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
  // Shrike: a long tandem glasshouse with many posts; the gunner sits at 0.80, facing aft.
  shrike: {
    wash: [[0.00, 'rgba(12,16,20,0.84)'], [0.14, 'rgba(20,30,36,0.68)'], [0.32, 'rgba(70,98,110,0.36)'],
           [0.46, 'rgba(168,200,214,0.30)'], [0.56, 'rgba(168,200,214,0.30)'], [0.70, 'rgba(70,98,110,0.36)'],
           [0.86, 'rgba(20,30,36,0.68)'], [1.00, 'rgba(12,16,20,0.84)']],
    crew: [{ u: 0.26, v: 0.34, sc: 0.94, helmet: true, hair: 'rgba(30,32,36,0.92)' },
           { u: 0.26, v: 0.66, sc: 0.94, helmet: true, hair: 'rgba(30,32,36,0.92)' },
           { u: 0.80, v: 0.34, sc: 0.88, cap: true, hair: 'rgba(44,38,32,0.92)' },
           { u: 0.80, v: 0.66, sc: 0.88, cap: true, hair: 'rgba(44,38,32,0.92)' }],
    glow: { u: [0.09], col: '120,230,190', a: 0.20, r: 46 },   // the sight head, lit, down in the nose
    spec: { band: [0.18, 0.82], streaks: [[0.22, 34, 0.19], [0.62, 22, 0.12]] },
    frame: { col: 'rgba(28,34,32,0.96)', lit: 'rgba(150,220,196,0.42)',
      posts: [[0.00, 13], [0.13, 8], [0.28, 8], [0.42, 7], [0.56, 7], [0.70, 7], [0.86, 8], [1.00, 11]],
      sills: [[0.22, 8], [0.78, 8]], hairs: [0.34, 0.66], mid: 6, edge: 13 },
  },
  // Truck cab: one big raked pane, sky over the dark cab, with wipers, a dash glareshield and one driver off-centre.
  // V runs across the screen and U up it, the opposite of the canopies above.
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
  // Drake: the eyes are screens, opaque from outside: a dark lens with an iris and a sheen.
  drakeeye: {
    wash: [[0.00, 'rgb(14,11,8)'], [0.26, 'rgb(30,24,18)'], [0.50, 'rgb(52,44,34)'],
           [0.74, 'rgb(30,24,18)'], [1.00, 'rgb(14,11,8)']],
    spec: { band: [0.0, 0.42], streaks: [[0.42, 26, 0.18], [0.58, 14, 0.1]] },
    frame: { col: 'rgba(0,0,0,0)', lit: 'rgba(0,0,0,0)', posts: [], sills: [], hairs: [], mid: 0, edge: 1 },
    iris: { u: 0.35, v: 0.6, r: 32 },
  },
};

const _canopyTex = {};
export function canopyTex(art = 'viper') {
  if (_canopyTex[art]) return _canopyTex[art];
  const S = CANOPY_ART[art] || CANOPY_ART.viper;
  const cv = document.createElement('canvas'); cv.width = CP_TW; cv.height = CP_TH;
  const g = cv.getContext('2d'), W = CP_TW, H = CP_TH;

  // 1) The glass: a sill-roof-sill wash.
  const gl = g.createLinearGradient(0, 0, 0, H);
  for (const [st, col] of S.wash) gl.addColorStop(st, col);
  g.fillStyle = gl; g.fillRect(0, 0, W, H);

  // `extra` is a name or a list; each is an independent painter.
  const EX = (n) => [].concat(S.frame.extra || []).includes(n);

  // 1b) Extras under the crew and frames.
  if (EX('glareshield')) {
    // Glareshield: the dark shelf under the screen, with panel light leaking up.
    const dU = S.frame.deckU ?? 1;
    for (const [vS, vI] of (S.frame.shieldV || [])) {
      const y0 = Math.min(vS, vI) * H, y1 = Math.max(vS, vI) * H;
      const cg = g.createLinearGradient(0, vS * H, 0, vI * H);
      cg.addColorStop(0, 'rgba(6,8,10,0.92)'); cg.addColorStop(0.55, 'rgba(10,14,18,0.62)'); cg.addColorStop(1, 'rgba(10,14,18,0)');
      g.fillStyle = cg; g.fillRect(0, y0, W * dU, y1 - y0);
      const lg = g.createLinearGradient(0, vI * H, 0, vS * H);
      lg.addColorStop(0, 'rgba(70,190,170,0)'); lg.addColorStop(1, 'rgba(70,190,170,0.20)');
      g.fillStyle = lg; g.fillRect(0, y0, W * dU * 0.9, y1 - y0);
    }
  }
  if (EX('brow')) {
    // Brow: shade under the roofline so the deck reads recessed.
    for (const [vRail, vIn] of (S.frame.browV || [])) {
      const bg = g.createLinearGradient(0, vRail * H, 0, vIn * H);
      bg.addColorStop(0, 'rgba(4,7,10,0.78)'); bg.addColorStop(0.6, 'rgba(6,10,14,0.30)'); bg.addColorStop(1, 'rgba(6,10,14,0)');
      // Only aft of the screen: a wraparound has open sky over it.
      const bU = S.frame.deckU ?? 0;
      g.fillStyle = bg;
      g.fillRect(bU * W, Math.min(vRail, vIn) * H, (1 - bU) * W, Math.abs(vIn - vRail) * H);
    }
  }
  if (S.panes) {
    // Per-pane tint step, so faceted glass doesn't read as one sticker.
    S.panes.forEach(([u0, u1], i) => {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,10,16,0.07)';
      g.fillRect(u0 * W, 0, (u1 - u0) * W, H);
    });
  }
  if (EX('blinds')) {
    // Sun blinds, never level with each other.
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
    // Cub skylight down the crown.
    const sk = g.createLinearGradient(0, H * 0.38, 0, H * 0.62);
    sk.addColorStop(0, 'rgba(150,206,240,0)'); sk.addColorStop(0.5, 'rgba(186,226,252,0.34)'); sk.addColorStop(1, 'rgba(150,206,240,0)');
    g.fillStyle = sk; g.fillRect(W * 0.16, H * 0.38, W * 0.62, H * 0.24);
  }

  // 2) Crew: soft silhouettes (a hard shape reads as a decal).
  for (const c of (S.crew || [])) {
    const cx = c.u * W, cy = c.v * H, sc = c.sc || 1;
    const jk = c.jacket || '5,8,12';
    const sh = g.createRadialGradient(cx, cy, 2, cx, cy, 30 * sc);
    sh.addColorStop(0, `rgba(${jk},${c.jacket ? 0.8 : 0.94})`); sh.addColorStop(1, `rgba(${jk},0)`);
    g.fillStyle = sh; g.beginPath(); g.ellipse(cx, cy, 24 * sc, 26 * sc, 0, 0, 7); g.fill();
    g.fillStyle = c.hair || 'rgba(3,5,8,0.92)';
    g.beginPath(); g.ellipse(cx, cy, 12 * sc, 10 * sc, 0, 0, 7); g.fill();
    if (c.cap) { g.fillStyle = 'rgba(14,16,20,0.95)'; g.beginPath(); g.ellipse(cx - 6 * sc, cy - 3 * sc, 9 * sc, 4 * sc, 0, 0, 7); g.fill(); }   // peaked cap, brim toward the nose
    // Visor or shades on the -u side, so they look forward.
    if (c.visor) { g.fillStyle = c.visor; g.beginPath(); g.ellipse(cx - 7 * sc, cy + 1.5 * sc, 4.5 * sc, 2.6 * sc, 0, 0, 7); g.fill(); }
    else if (c.shades) {
      g.fillStyle = 'rgba(8,10,14,0.9)'; g.beginPath(); g.ellipse(cx - 7 * sc, cy + 1 * sc, 4.2 * sc, 2.2 * sc, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(60,68,78,0.9)'; g.beginPath(); g.ellipse(cx + 4 * sc, cy - 1 * sc, 3.4 * sc, 5 * sc, 0, 0, 7); g.fill();   // headset cup on the ear behind
    }
  }
  // Instrument glow.
  if (S.glow) for (const u of S.glow.u) {
    const cx = u * W, r = S.glow.r || 70, hg = g.createRadialGradient(cx, H / 2, 4, cx, H / 2, r);
    hg.addColorStop(0, `rgba(${S.glow.col},${S.glow.a})`); hg.addColorStop(1, `rgba(${S.glow.col},0)`);
    g.fillStyle = hg; g.fillRect(cx - r, 0, r * 2, H);
  }

  // The Drake's iris: a gauge seen through the glass. Before the specular.
  if (S.iris) {
    const { u, v, r } = S.iris, ix = u * W, iy = v * H;
    const rim = g.createLinearGradient(ix - r, iy - r, ix + r, iy + r);
    rim.addColorStop(0, 'rgba(236,196,110,0.95)'); rim.addColorStop(1, 'rgba(120,84,36,0.95)');
    g.fillStyle = rim; g.beginPath(); g.arc(ix, iy, r, 0, 7); g.fill();
    const face = g.createRadialGradient(ix, iy, 1, ix, iy, r * 0.8);
    face.addColorStop(0, 'rgba(34,70,52,0.97)'); face.addColorStop(1, 'rgba(10,20,16,0.97)');
    g.fillStyle = face; g.beginPath(); g.arc(ix, iy, r * 0.8, 0, 7); g.fill();
    g.strokeStyle = 'rgba(140,255,190,0.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) { const a = -2.3 + i * 0.66; g.beginPath(); g.moveTo(ix + Math.cos(a) * r * 0.62, iy + Math.sin(a) * r * 0.62); g.lineTo(ix + Math.cos(a) * r * 0.74, iy + Math.sin(a) * r * 0.74); g.stroke(); }
    g.strokeStyle = 'rgba(255,236,190,0.95)'; g.lineWidth = 2; g.beginPath(); g.moveTo(ix, iy); g.lineTo(ix + Math.cos(-0.7) * r * 0.62, iy + Math.sin(-0.7) * r * 0.62); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(ix - r * 0.32, iy - r * 0.34, r * 0.16, 0, 7); g.fill();
  }

  // 3) Specular streaks, clipped to the roof band.
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

  // 4) Mullions: opaque frame bars.
  g.lineCap = 'butt';
  const F = S.frame;
  const bar = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  for (const [u, hv] of F.posts) {
    const x = u * W;
    bar(x, 0, x, H, hv, F.col); bar(x - hv * 0.34, 0, x - hv * 0.34, H, 1.6, F.lit);   // a lit highlight down one edge
  }
  // Only the sill rails get bars; the roof seams get a hairline, or it reads as a bus window grid.
  for (const [v, hv] of F.sills) {
    const y = v * H;
    bar(0, y, W, y, hv, F.col); bar(0, y - hv * 0.34, W, y - hv * 0.34, 1.6, F.lit);
  }
  for (const v of (F.hairs || [])) bar(0, v * H, W, v * H, 1.4, F.lit);
  if (F.mid) { bar(0, H / 2, W, H / 2, F.mid, F.col); bar(0, H / 2 - F.mid * 0.34, W, H / 2 - F.mid * 0.34, 1.4, F.lit); }
  // 4b) Extras on top of the frame.
  if (EX('wipers')) {
    // Wipers parked on the sill (`frame.wiperV`), in glass the class glazes.
    g.strokeStyle = 'rgba(18,20,24,0.85)'; g.lineWidth = 3; g.lineCap = 'round';
    for (const v of (F.wiperV || [0.06, 0.94])) { g.beginPath(); g.moveTo(W * 0.02, v * H); g.lineTo(W * 0.20, (v > 0.5 ? v - 0.13 : v + 0.13) * H); g.stroke(); }
    g.lineCap = 'butt';
  }
  if (EX('skylight')) {
    // The XCub's diagonal door brace.
    g.strokeStyle = F.col; g.lineWidth = 4;
    for (const [v0, v1] of [[0.42, 0.15], [0.58, 0.85]]) { g.beginPath(); g.moveTo(W * 0.46, v0 * H); g.lineTo(W * 0.70, v1 * H); g.stroke(); }
  }
  // Perimeter.
  g.strokeStyle = F.col; g.lineWidth = F.edge; g.strokeRect(0, 0, W, H);

  _canopyTex[art] = cv; return cv;
}
// Canopy art onto one facet, source-over so frames sit on the glass.
export function drawCanopyGlass(ctx, P, uv, art) {
  const n = P.length; if (n < 3 || n > 4) return;
  const img = canopyTex(art), d = P.map(q => [q.sx, q.sy]);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(d[0][0], d[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(d[i][0], d[i][1]); ctx.closePath(); ctx.clip();
  if (n === 4) { acTexTri(ctx, img, uv[0], uv[1], uv[2], d[0], d[1], d[2]); acTexTri(ctx, img, uv[0], uv[2], uv[3], d[0], d[2], d[3]); }
  else acTexTri(ctx, img, uv[0], uv[1], uv[2], d[0], d[1], d[2]);
  ctx.restore();
}

// ── Nose art ── Small canvases painted once and mapped onto the forward fuselage, near side only. Front of the art is the nose.
const _decalCache = {};
function decalTex(id) {
  if (id in _decalCache) return _decalCache[id];
  const W = 72, H = 44, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (id === 'sharkmouth') {
    // ⚠ U = 0 is the nose: draw the head facing left. Gapes at the tip, eye aft of the hinge.
    const gape = H * 0.46, hinge = H * 0.10, jawX = W * 0.66;   // half-heights at the tip and at the hinge
    g.fillStyle = '#9c1717';                                    // the red maw
    g.beginPath();
    g.moveTo(1, H * 0.50 - gape); g.lineTo(jawX, H * 0.50 - hinge);
    g.lineTo(jawX, H * 0.50 + hinge); g.lineTo(1, H * 0.50 + gape);
    g.closePath(); g.fill();
    // Teeth shrink along the closing jaw.
    g.fillStyle = '#f2f2ea';
    for (let i = 0; i < 7; i++) {
      const t = i / 7, x = 3 + t * (jawX - 10), half = gape + (hinge - gape) * t, w = 6.5 - t * 3;
      g.beginPath(); g.moveTo(x, H * 0.50 - half); g.lineTo(x + w, H * 0.50 - half); g.lineTo(x + w * 0.5, H * 0.50 - half * 0.42); g.closePath(); g.fill();
      const x2 = x + 4.5, half2 = gape + (hinge - gape) * (t + 0.06), w2 = w * 0.92;
      g.beginPath(); g.moveTo(x2, H * 0.50 + half2); g.lineTo(x2 + w2, H * 0.50 + half2); g.lineTo(x2 + w2 * 0.5, H * 0.50 + half2 * 0.42); g.closePath(); g.fill();
    }
    g.fillStyle = '#f2f2ea'; g.beginPath(); g.arc(W * 0.80, H * 0.20, 5.4, 0, 7); g.fill();
    g.fillStyle = '#101010'; g.beginPath(); g.arc(W * 0.775, H * 0.20, 2.5, 0, 7); g.fill();   // pupil forward in the socket — it is looking where it is going
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
// Even-odd point-in-polygon, to skip decal cells behind a nearer appendage.
function ptInScreenPoly(x, y, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i].sx, yi = P[i].sy, xj = P[j].sx, yj = P[j].sy;
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function drawNoseArt(ctx, proj, cls, lv, occluders = null, near = MODEL_NEAR_Z) {
  const id = lv?.decal; if (!id || id === 'none') return;
  const img = decalTex(id); if (!img) return;
  const p = fwParams(cls) || fwParams('prop');
  // Wrap the decal onto the real fuselage section (pushed out to the hull at each grid point), centred on the
  // drooping centreline. Sharkmouth and flames reach onto the nose cone; emblems stay mid-flank.
  // Tabled hulls (Cessna, Cub) and mesh `hull` lofts serve their own section; the rest reconstruct buildFixedWing's.
  const hull = meshHull(cls);
  const CS = hull ? hull.CS : cls === 'ultralight' ? cessnaSection : cls === 'grasshopper' ? cubSection : null;
  const noseF = hull ? hull.noseF : cls === 'ultralight' ? 0.72 : cls === 'grasshopper' ? 0.80 : p.noseF;
  const reach = id === 'sharkmouth' || id === 'flames';
  const fF = reach ? noseF * 0.9 : 0.64, fR = reach ? 0.06 : 0.18;   // forward-fuselage extent (front = nose)
  const fr = p.fr, fv = p.fv, shapeExp = 1 - (p.boxy || 0) * 0.55;
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0, OUT = 1.03;
  const radAt = (f) => { let u = Math.min(1, Math.abs(f / p.noseF)); u = u <= tube ? 0 : (u - tube) / (1 - tube); return cowl + (1 - cowl) * Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); };
  // Height profile, mirroring buildFixedWing's radVAt.
  const radVAt = (f) => {
    if (!(p.noseVTaper && f > 0)) return radAt(f);
    let u = Math.min(1, f / p.noseF); u = u <= tube ? 0 : (u - tube) / (1 - tube);
    const vf = p.noseVFloor || 0;
    return radAt(f) * (vf + (1 - vf) * Math.pow(1 - u, p.noseVTaper));
  };
  const czAt = (f) => CS ? CS(f).cz : (p.noseZ ?? 0.02) * (f / p.noseF);   // centreline height (drooped nose pulls it down)
  const surf = (f, h, sign) => {                                     // near-flank hull point at (f, h) — sign picks the flank
    if (CS) {   // tabled hull: the same superellipse maths, run off the interpolated station
      const s = CS(f), e = 1 - s.boxy * 0.55, rv = h >= s.cz ? s.rvT : s.rvB;
      const sv = clampN((h - s.cz) / (rv || 1e-6), -0.999, 0.999);
      const cm = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(sv), 2 / e)));
      return [f, sign * Math.pow(cm, e) * s.rg * OUT, h];
    }
    const r = radAt(f), sv = clampN((h - czAt(f)) / (fv * radVAt(f) || 1e-6), -0.999, 0.999);
    const cosMag = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(sv), 2 / shapeExp)));
    return [f, sign * Math.pow(cosMag, shapeExp) * fr * r * OUT, h];
  };
  const mid = (fF + fR) / 2, cM = czAt(mid);
  const sign = proj(...surf(mid, cM, 1)).z <= proj(...surf(mid, cM, -1)).z ? 1 : -1;   // the flank facing you
  // Fills the flank; taller art curls over the shoulder.
  const hHalf = (CS ? CS(mid).rvB * 0.92 : fv * 0.72);
  const Nc = 6, Nr = 3, W = img.width, H = img.height, grid = [];
  let anyNear = false;
  for (let j = 0; j <= Nr; j++) {
    const row = [];
    for (let i = 0; i <= Nc; i++) {
      const f = fF + (fR - fF) * (i / Nc);
      // Reach decals taper with the cone.
      const hh = reach ? hHalf * (0.30 + 0.70 * (CS ? CS(f).rg / CS(0).rg : radVAt(f))) : hHalf;
      const h = czAt(f) + hh - 2 * hh * (j / Nr);   // top(j=0) → bottom
      const P = proj(...surf(f, h, sign)); row.push(P); if (P.z > near) anyNear = true;
    }
    grid.push(row);
  }
  if (!anyNear) return;
  // Un-mirror emblems on a flipped flank, keyed off the projected winding. Reach decals never flip: they're nose-anchored.
  const n0 = grid[0][0], nT = grid[0][Nc], bL = grid[Nr][0];
  const cross = (nT.sx - n0.sx) * (bL.sy - n0.sy) - (nT.sy - n0.sy) * (bL.sx - n0.sx);
  const flip = !reach && cross > 0;   // un-mirror emblems onto the visible flank (winding sign corrected — was reading backwards)
  const uOf = (col) => (flip ? (Nc - col) : col) / Nc * W;
  const occ = occluders || [];
  for (let j = 0; j < Nr; j++) for (let i = 0; i < Nc; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
    if (a.z <= near || b.z <= near || c.z <= near || d.z <= near) continue;             // skip cells crossing behind the eye
    // Skip cells behind a nearer appendage.
    const mx = (a.sx + b.sx + c.sx + d.sx) / 4, my = (a.sy + b.sy + c.sy + d.sy) / 4;
    const mz = (a.z + b.z + c.z + d.z) / 4;
    if (occ.some(o => o.z < mz && ptInScreenPoly(mx, my, o.P))) continue;
    const s0 = [uOf(i), j / Nr * H], s1 = [uOf(i + 1), j / Nr * H];
    const s2 = [uOf(i + 1), (j + 1) / Nr * H], s3 = [uOf(i), (j + 1) / Nr * H];
    acTexTri(ctx, img, s0, s1, s2, [a.sx, a.sy], [b.sx, b.sy], [c.sx, c.sy]);
    acTexTri(ctx, img, s0, s2, s3, [a.sx, a.sy], [c.sx, c.sy], [d.sx, d.sy]);
  }
}

// ── Hull art ── On the topside between chine and sheer, amidships.
// ⚠ Not drawNoseArt: that reconstructs a fixed-wing fuselage and falls back to a Twin Otter. A hull uses its stations.
// ⚠ The band is inset from the chine lip and the boot stripe.
export function drawBoatHullArt(ctx, proj, cls, detail, lv, occluders = null, near = MODEL_NEAR_Z) {
  const id = lv?.decal; if (!id || id === 'none') return;
  // The signwriting family (doorArtTex), not the nose-art one.
  const img = doorArtTex(id); if (!img) return;
  const meta = BOAT_META.get(cls + ':' + (detail >= 1 ? 1 : 0)) || BOAT_META.get(cls + ':1');
  const ST = meta && meta.stations; if (!ST || ST.length < 2) return;

  const at = (f) => {
    for (let i = 0; i < ST.length - 1; i++) {
      const a = ST[i], b = ST[i + 1];
      if (f <= a.f && f >= b.f) {
        const t = (a.f - f) / ((a.f - b.f) || 1);
        return { cw: a.cw + (b.cw - a.cw) * t, cz: a.cz + (b.cz - a.cz) * t,
                 sw: a.sw + (b.sw - a.sw) * t, sz: a.sz + (b.sz - a.sz) * t };
      }
    }
    const e = f > ST[0].f ? ST[0] : ST[ST.length - 1];
    return { cw: e.cw, cz: e.cz, sw: e.sw, sz: e.sz };
  };
  // The signwritable panel, as fractions of the hull.
  const pF = ST[0].f * 0.34, pR = ST[ST.length - 1].f * 0.62;
  const INSET = 0.22;                                  // how far in from chine and sheer
  // ⚠ The art keeps its aspect: the band's height is set by the hull and the length solved from the texture,
  // clamped to the run (shrinking height to keep aspect).
  const mid0 = (pF + pR) / 2;
  const sMid = at(mid0);
  let bandH = (sMid.sz - sMid.cz) * (1 - 2 * INSET);   // the band's height in hull units
  let bandL = bandH * (img.width / (img.height || 1));
  const runL = Math.abs(pF - pR);
  if (bandL > runL) { bandH *= runL / bandL; bandL = runL; }
  const fF = mid0 + bandL / 2, fR = mid0 - bandL / 2;
  const vMid = 0.5;
  const halfV = () => {
    const s = at(mid0);
    return bandH / (2 * ((s.sz - s.cz) || 1e-6));       // as a fraction of chine-to-sheer
  };
  // t: 0 at the bottom of the art band, 1 at the top.
  const hV = halfV();
  const surf = (f, t, sign) => {
    const s = at(f);
    const u = vMid + (t - 0.5) * 2 * hV;
    return [f, sign * (s.cw + (s.sw - s.cw) * u), s.cz + (s.sz - s.cz) * u];
  };
  // The near flank.
  const mid = (fF + fR) / 2;
  const sign = proj(...surf(mid, 0.5, 1)).z <= proj(...surf(mid, 0.5, -1)).z ? 1 : -1;

  const Nc = 6, Nr = 2, W = img.width, H = img.height, grid = [];
  let anyNear = false;
  for (let j = 0; j <= Nr; j++) {
    const row = [];
    for (let i = 0; i <= Nc; i++) {
      const P = proj(...surf(fF + (fR - fF) * (i / Nc), 1 - j / Nr, sign));
      row.push(P); if (P.z > near) anyNear = true;
    }
    grid.push(row);
  }
  if (!anyNear) return;
  // ⚠ Un-mirror on the far flank: a boat's name is lettering.
  const n0 = grid[0][0], nT = grid[0][Nc], bL = grid[Nr][0];
  const cross = (nT.sx - n0.sx) * (bL.sy - n0.sy) - (nT.sy - n0.sy) * (bL.sx - n0.sx);
  const flip = cross > 0;
  const uOf = (col) => (flip ? (Nc - col) : col) / Nc * W;
  const occ = occluders || [];
  for (let j = 0; j < Nr; j++) for (let i = 0; i < Nc; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
    if (a.z <= near || b.z <= near || c.z <= near || d.z <= near) continue;
    const mx = (a.sx + b.sx + c.sx + d.sx) / 4, my = (a.sy + b.sy + c.sy + d.sy) / 4;
    const mz = (a.z + b.z + c.z + d.z) / 4;
    if (occ.some((o) => o.z < mz && ptInScreenPoly(mx, my, o.P))) continue;
    const s0 = [uOf(i), j / Nr * H], s1 = [uOf(i + 1), j / Nr * H];
    const s2 = [uOf(i + 1), (j + 1) / Nr * H], s3 = [uOf(i), (j + 1) / Nr * H];
    acTexTri(ctx, img, s0, s1, s2, [a.sx, a.sy], [b.sx, b.sy], [c.sx, c.sy]);
    acTexTri(ctx, img, s0, s2, s3, [a.sx, a.sy], [c.sx, c.sy], [d.sx, d.sy]);
  }
}

// ── Door art ── On the flat panel under the door glass.
// ⚠ Not drawNoseArt (it wraps a fixed-wing hull from FW_PARAMS). The rectangle comes from TRUCK_META, never a constant.
const _doorCache = {};
function doorArtTex(id) {
  if (id in _doorCache) return _doorCache[id];
  const S = 56, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const M = S / 2;
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (id === 'crest') {
    g.fillStyle = '#1b2b3c'; g.strokeStyle = '#d9c07a'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(M, 4); g.lineTo(S - 8, 13); g.lineTo(S - 8, S * 0.58);
    g.quadraticCurveTo(S - 10, S - 8, M, S - 4); g.quadraticCurveTo(10, S - 8, 8, S * 0.58);
    g.lineTo(8, 13); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#d9c07a';                                     // the road, narrowing away
    g.beginPath(); g.moveTo(M - 11, S - 13); g.lineTo(M + 11, S - 13); g.lineTo(M + 2.5, S * 0.42); g.lineTo(M - 2.5, S * 0.42); g.closePath(); g.fill();
    g.strokeStyle = '#1b2b3c'; g.lineWidth = 1.6;                // the centre line on it
    g.beginPath(); g.moveTo(M, S - 15); g.lineTo(M, S * 0.46); g.stroke();
    g.fillStyle = '#e8ecf2'; g.beginPath(); g.arc(M, S * 0.31, 4.2, 0, 7); g.fill();   // a sun, or a headlamp, depending who you ask
  } else if (id === 'eagle') {
    g.fillStyle = '#e6e8ec';
    g.beginPath();                                               // one spread bird, wingtip to wingtip
    g.moveTo(M, 14); g.quadraticCurveTo(M - 12, 8, 4, 20); g.quadraticCurveTo(M - 16, 20, M - 6, 30);
    g.lineTo(M - 4, 44); g.lineTo(M, 50); g.lineTo(M + 4, 44); g.lineTo(M + 6, 30);
    g.quadraticCurveTo(M + 16, 20, S - 4, 20); g.quadraticCurveTo(M + 12, 8, M, 14);
    g.closePath(); g.fill();
    g.fillStyle = '#c8a23a'; g.beginPath(); g.arc(M, 12, 4.6, 0, 7); g.fill();        // head
    g.fillStyle = '#141719'; g.beginPath(); g.arc(M + 1.6, 11, 1.3, 0, 7); g.fill();  // eye
  } else if (id === 'skull') {
    g.strokeStyle = '#c9ccd2'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(11, S - 9); g.lineTo(S - 11, 20); g.moveTo(S - 11, S - 9); g.lineTo(11, 20); g.stroke();
    g.fillStyle = '#8f949c';
    for (const xy of [[11, S - 9], [S - 11, S - 9]]) { g.beginPath(); g.arc(xy[0], xy[1], 5, 0, 7); g.fill(); }
    g.fillStyle = '#eceef2';
    g.beginPath(); g.arc(M, M - 5, 14, 0, 7); g.fill();
    g.beginPath(); g.ellipse(M, M + 8, 8.5, 7, 0, 0, 7); g.fill();                    // jaw
    g.fillStyle = '#0c0e11';
    g.beginPath(); g.ellipse(M - 5.5, M - 6, 3.8, 4.4, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(M + 5.5, M - 6, 3.8, 4.4, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(M, M - 1); g.lineTo(M - 2.4, M + 4); g.lineTo(M + 2.4, M + 4); g.closePath(); g.fill();
    g.lineWidth = 1.2; g.strokeStyle = '#0c0e11';
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(M + i * 3.2, M + 8); g.lineTo(M + i * 3.2, M + 14); g.stroke(); }
  } else if (id === 'pinup') {
    // A mudflap silhouette, kept to an outline.
    g.fillStyle = '#e2c04a';
    g.beginPath(); g.arc(M + 3, 13, 5.5, 0, 7); g.fill();                              // head
    g.beginPath();                                                                     // the reclining line
    g.moveTo(M + 8, 18); g.quadraticCurveTo(M + 2, 24, M - 2, 30);
    g.quadraticCurveTo(M - 10, 38, M - 18, 40); g.lineTo(M - 18, 45);
    g.quadraticCurveTo(M - 4, 45, M + 6, 36); g.quadraticCurveTo(M + 15, 28, M + 12, 18);
    g.closePath(); g.fill();
    g.lineWidth = 2.4; g.strokeStyle = '#e2c04a';
    g.beginPath(); g.moveTo(M + 8, 21); g.quadraticCurveTo(M + 17, 15, M + 19, 8); g.stroke();   // the raised arm
  } else if (id === 'wolf') {
    g.fillStyle = '#dfe3e8';
    g.beginPath();                                                                     // head, ears, muzzle
    g.moveTo(M - 15, 16); g.lineTo(M - 11, 5); g.lineTo(M - 4, 14);
    g.lineTo(M + 4, 14); g.lineTo(M + 11, 5); g.lineTo(M + 15, 16);
    g.quadraticCurveTo(M + 16, 33, M + 6, 40); g.lineTo(M + 3, 50);
    g.lineTo(M - 3, 50); g.lineTo(M - 6, 40); g.quadraticCurveTo(M - 16, 33, M - 15, 16);
    g.closePath(); g.fill();
    g.fillStyle = '#b8422c';
    g.beginPath(); g.moveTo(M - 11, 22); g.lineTo(M - 3, 25); g.lineTo(M - 11, 27); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(M + 11, 22); g.lineTo(M + 3, 25); g.lineTo(M + 11, 27); g.closePath(); g.fill();
    g.fillStyle = '#14171a'; g.beginPath(); g.ellipse(M, 41, 3.4, 2.6, 0, 0, 7); g.fill();       // nose
  } else if (id === 'flames') {
    const lick = (col, k) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(2, S - 2);
      g.quadraticCurveTo(S * 0.22 * k, S * 0.60, S * 0.30 * k, S * 0.72);
      g.quadraticCurveTo(S * 0.30 * k, S * 0.40, S * 0.56 * k, S * 0.44);
      g.quadraticCurveTo(S * 0.44 * k, S * 0.24, S * 0.80 * k, S * 0.26);
      g.quadraticCurveTo(S * 0.52 * k, S * 0.16, S * 0.66 * k, 3);
      g.lineTo(2, 3);
      g.closePath(); g.fill();
    };
    lick('#b81717', 1.25); lick('#ef7a18', 0.98); lick('#f6cf3b', 0.66);
  } else if (id === 'eye') {
    g.strokeStyle = '#6fd6ff'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(M, 6); g.lineTo(S - 6, S - 8); g.lineTo(6, S - 8); g.closePath(); g.stroke();
    g.fillStyle = '#eef6fb'; g.beginPath(); g.ellipse(M, M + 5, 15, 8.5, 0, 0, 7); g.fill();
    g.fillStyle = '#1c7ba8'; g.beginPath(); g.arc(M, M + 5, 6.4, 0, 7); g.fill();
    g.fillStyle = '#0a0d10'; g.beginPath(); g.arc(M, M + 5, 2.8, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(M - 2.4, M + 2.4, 1.4, 0, 7); g.fill();
  } else if (id === 'route') {
    // A route shield: route 1, the one road out of Coldwater.
    g.fillStyle = '#f0f1f3'; g.strokeStyle = '#15181c'; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(10, 12); g.lineTo(S - 10, 12); g.lineTo(S - 10, S * 0.60);
    g.quadraticCurveTo(S - 12, S - 8, M, S - 5); g.quadraticCurveTo(12, S - 8, 10, S * 0.60);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#15181c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 9px sans-serif'; g.fillText('BASIN', M, 20);
    g.font = 'bold 20px sans-serif'; g.fillText('1', M, 36);
  } else if (id === 'saint') {
    g.fillStyle = '#c8a23a'; g.beginPath(); g.arc(M - 2, 14, 9, 0, 7); g.fill();       // halo
    g.fillStyle = '#20303f'; g.beginPath(); g.arc(M - 2, 14, 6, 0, 7); g.fill();
    g.fillStyle = '#dfe4ea';
    g.beginPath();                                                                     // robe
    g.moveTo(M - 2, 20); g.lineTo(M + 8, 34); g.lineTo(M + 5, S - 6); g.lineTo(M - 11, S - 6);
    g.lineTo(M - 9, 30); g.closePath(); g.fill();
    g.strokeStyle = '#8a6a2a'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(M + 12, 10); g.lineTo(M + 6, S - 6); g.stroke();           // the staff
    g.fillStyle = '#c8a23a'; g.beginPath(); g.arc(M - 8, 26, 4.4, 0, 7); g.fill();     // the child on the shoulder
  } else if (id === 'dice') {
    const die = (x, y, r, pips) => {
      g.save(); g.translate(x, y); g.rotate(r);
      g.fillStyle = '#f2f3f5'; g.strokeStyle = '#15181c'; g.lineWidth = 1.6;
      g.beginPath(); g.rect(-11, -11, 22, 22);
      g.fill(); g.stroke();
      g.fillStyle = '#b8222a';
      for (const pp of pips) { g.beginPath(); g.arc(pp[0] * 6.5, pp[1] * 6.5, 2.3, 0, 7); g.fill(); }
      g.restore();
    };
    die(M - 11, M - 6, -0.22, [[-1, -1], [1, 1], [0, 0], [1, -1], [-1, 1]]);
    die(M + 12, M + 8, 0.3, [[-1, -1], [1, 1]]);
  } else { _doorCache[id] = null; return null; }
  _doorCache[id] = c; return c;
}

// Paint the door art on the near flank. `proj` maps [f, g, h] to {sx, sy, z}.
export function drawTruckDoorArt(ctx, proj, variant, detail, lv, occluders = null, near = MODEL_NEAR_Z) {
  const id = lv && lv.art; if (!id || id === 'none') return;
  const meta = TRUCK_META.get(String(variant || 'hauler') + ':' + (detail ? 1 : 0));
  const d = meta && meta.door; if (!d) return;                       // a dropped box has no cab
  const img = doorArtTex(id); if (!img) return;
  // Only the near door. ⚠ OUT is only 0.4%: a door is flat, and standing the decal proud makes it cross the
  // near plane before its panel does.
  const mf = (d.f0 + d.f1) / 2, mz = (d.z0 + d.z1) / 2, OUT = 1.004;
  const sign = proj(mf, d.g * OUT, mz).z <= proj(mf, -d.g * OUT, mz).z ? 1 : -1;
  const Nc = 3, Nr = 3, grid = [];
  let anyNear = false;
  for (let j = 0; j <= Nr; j++) {
    const row = [];
    for (let i = 0; i <= Nc; i++) {
      const f = d.f0 + (d.f1 - d.f0) * (i / Nc);
      const z = d.z1 + (d.z0 - d.z1) * (j / Nr);                     // top (j=0) then down
      const P = proj(f, sign * d.g * OUT, z); row.push(P); if (P.z > near) anyNear = true;
    }
    grid.push(row);
  }
  if (!anyNear) return;
  // ⚠ Un-mirror, keyed off the projected winding.
  const n0 = grid[0][0], nT = grid[0][Nc], bL = grid[Nr][0];
  const cross = (nT.sx - n0.sx) * (bL.sy - n0.sy) - (nT.sy - n0.sy) * (bL.sx - n0.sx);
  const flip = cross > 0;
  const W = img.width, H = img.height;
  const uOf = (col) => (flip ? (Nc - col) : col) / Nc * W;
  const occ = occluders || [];
  // Collect surviving cells first; the occlusion pass needs the panel's screen bounds.
  const quads = [];
  for (let j = 0; j < Nr; j++) for (let i = 0; i < Nc; i++) {
    const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], e = grid[j + 1][i];
    if (a.z <= near || b.z <= near || c.z <= near || e.z <= near) continue;
    quads.push({ i, j, a, b, c, e, mzz: (a.z + b.z + c.z + e.z) / 4 });
  }
  if (!quads.length) return;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, maxZ = -Infinity;
  for (const q of quads) {
    if (q.mzz > maxZ) maxZ = q.mzz;
    for (const P of [q.a, q.b, q.c, q.e]) {
      if (P.sx < bx0) bx0 = P.sx; if (P.sx > bx1) bx1 = P.sx;
      if (P.sy < by0) by0 = P.sy; if (P.sy > by1) by1 = P.sy;
    }
  }
  // ⚠ Pre-select occluders by bounding box, not centroid: an arm across a cell's edge must still clip it.
  const hits = occ.filter((o) => {
    if (!(o.z < maxZ) || !o.P || o.P.length < 3) return false;
    let ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
    for (const p of o.P) {
      if (p.sx < ax0) ax0 = p.sx; if (p.sx > ax1) ax1 = p.sx;
      if (p.sy < ay0) ay0 = p.sy; if (p.sy > ay1) ay1 = p.sy;
    }
    return ax1 >= bx0 && ax0 <= bx1 && ay1 >= by0 && ay0 <= by1;
  });
  // Coverage is per pixel and depth per cell: the cell and the occluders in front of it share one 'evenodd' clip,
  // so an occluder's outline becomes the art's edge. ⚠ Not an offscreen buffer: scripts/shapes/truck-doorart.mjs
  // watches the door texture land triangle by triangle, and buffering blinds it.
  for (const q of quads) {
    const front = hits.filter(o => o.z < q.mzz);
    const s0 = [uOf(q.i), q.j / Nr * H], s1 = [uOf(q.i + 1), q.j / Nr * H];
    const s2 = [uOf(q.i + 1), (q.j + 1) / Nr * H], s3 = [uOf(q.i), (q.j + 1) / Nr * H];
    const A = [q.a.sx, q.a.sy], B = [q.b.sx, q.b.sy], C = [q.c.sx, q.c.sy], E = [q.e.sx, q.e.sy];
    if (front.length) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(E[0], E[1]);
      ctx.closePath();
      for (const o of front) {
        ctx.moveTo(o.P[0].sx, o.P[0].sy);
        for (let k = 1; k < o.P.length; k++) ctx.lineTo(o.P[k].sx, o.P[k].sy);
        ctx.closePath();
      }
      ctx.clip('evenodd');
    }
    acTexTri(ctx, img, s0, s1, s2, A, B, C);
    acTexTri(ctx, img, s0, s2, s3, A, C, E);
    if (front.length) ctx.restore();
  }
}


// ── True-3D inspect environment ── A floor drawn through the model's camera, so it parallaxes.
const FLOOR_Z = -0.27;   // ground plane, just under the wheels
function drawInspectBackdrop(ctx, w, h, venue = null, sky = null) {
  if (venue === 'helipad' || venue === 'ramp') {
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

// ── Walk-inspect hangar room ── Walls, ceiling and an open bay door onto the live sky, through the same `proj`.
const ROOM_R = 6.6, ROOM_CEIL = 2.7, ROOM_NEAR = 0.2;
// Sutherland-Hodgman near-plane clip in model space, so a wall partly behind the eye is trimmed, not dropped.
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
  const poly = (modelPts, styleFn) => {
    const cl = clipNear(modelPts, proj); if (cl.length < 3) return false;
    const P = cl.map(p => proj(p[0], p[1], p[2]));
    ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath();
    ctx.fillStyle = styleFn(P); ctx.fill(); return true;
  };
  poly([[-R, -R, C0], [R, -R, C0], [R, R, C0], [-R, R, C0]], () => '#10161c');   // ceiling
  // Overhead strip lights with a soft bloom.
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
// The open bay door: a real 3D apron, ATC tower and lit buildings beyond it, clipped to the opening and tinted
// by the live sky, with weather and lightning over the top.
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
  // 1) Sky.
  const sg = ctx.createLinearGradient(0, yTop - dh, 0, yBot);
  sg.addColorStop(0, rgbStr(pal.top)); sg.addColorStop(1, rgbStr(pal.hor));
  ctx.fillStyle = sg; ctx.fillRect(x0 - 6, yTop - dh, dw + 12, dh * 2 + 6);
  // Stars on a clear night: most faint, a few bright, each tinted.
  if (night > 0.55 && /clear/.test(wx)) {
    for (let i = 0; i < 110; i++) {
      const m = 0.12 + Math.pow(hash01(i * 3.3), 3) * 0.88;
      const c = hash01(i * 7.7), sx = x0 + hash01(i * 5.1) * dw, sy = yTop - dh * 0.4 + hash01(i * 9.7) * dh * 0.9;
      ctx.fillStyle = `rgba(${c < 0.3 ? '200,214,255' : c < 0.72 ? '244,246,252' : '255,226,190'},${(m * 0.85).toFixed(2)})`;
      const sz = m > 0.66 ? 2 : m > 0.36 ? 1.5 : 1;
      ctx.fillRect(sx, sy, sz, sz);
    }
  }
  // 2) Sun or moon, before the ground so a low sun sets behind it.
  if (/^(clear|dust)$/.test(wx)) {
    const sx = x0 + dw * (night > 0.4 ? 0.28 : 0.68), sy = yTop + dh * 0.26, disc = night > 0.4 ? [220, 224, 236] : [255, 246, 214];
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, dw * 0.14);
    rg.addColorStop(0, rgbStr(disc, 0.92)); rg.addColorStop(1, rgbStr(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, dw * 0.14, 0, 7); ctx.fill();
  }
  // 3) Tarmac apron with a dashed taxi line.
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
  // 4) Buildings in three depth bands, far to near, seeded so nothing jitters.
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
  // 5) The ATC tower.
  drawATCTower(ctx, proj, fillModel, pal, night);
  // 6) Live weather (precip only with fx.motion).
  if (fx.motion && /rain|storm/.test(wx)) {
    const slant = 3 + Math.min(8, (sky?.wind || 0) / 6);
    ctx.strokeStyle = rgbStr([192, 212, 236], wx === 'storm' ? 0.55 : 0.42); ctx.lineWidth = 1.2;
    for (let i = 0; i < 30; i++) {
      const px = x0 + (hash01(i * 1.3) * dw + now * 90) % dw;
      const py = yTop + (hash01(i * 2.7) * dh + now * 560) % dh;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - slant, py + 12); ctx.stroke();
    }
  } else if (fx.motion && wx === 'snow') {
    // Snow intensity from wind: the server sends only 'snow'.
    const bliz = Math.min(1, (sky?.wind || 0) / 45);
    ctx.fillStyle = rgbStr([236, 242, 250], 0.08 + bliz * 0.42);
    ctx.fillRect(x0, yTop, dw, dh);
    // Snow falls on a normalised time track mapped into the door, so walking only parallax-scales it.
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
  // 7) Lightning: the flash, then the bolt.
  if (fx.flash > 0.01) { ctx.fillStyle = `rgba(222,232,255,${Math.min(0.72, fx.flash * 0.72)})`; ctx.fillRect(x0 - 6, yTop - dh, dw + 12, dh * 2 + 6); }
  // The door's bolt reader (client/shared/lightning-draw.js): offsets scale by the drop span, not the width.
  // Uses the shared `boltBright` envelope, as the canopy does.
  if (fx.bolt && fx.bolt.branches) {
    const { ch, br } = boltBright(fx.bolt, performance.now() - fx.bolt.born);
    if (ch > 0.02) {
      const span = dh * DOOR_BOLT_DROP, bx = x0 + (fx.bolt.x ?? 0.5) * dw;
      paintBolt(ctx, fx.bolt, (p) => [bx + p.ox * span, yTop + (1 - p.f) * span], { ch, br, w: 0.9 });
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(36,44,52,0.95)'; ctx.lineWidth = 4;                  // heavy door frame
  ctx.beginPath(); ctx.moveTo(DP[0].sx, DP[0].sy); for (let i = 1; i < DP.length; i++) ctx.lineTo(DP[i].sx, DP[i].sy); ctx.closePath(); ctx.stroke();
}
// ── Walk-inspect: the open ramp ── Apron, tie-down box, runway with edge lights, horizon line.
function drawRampRoom(ctx, proj, sky) {
  const F0 = FLOOR_Z, pal = skyPalette(sky), night = pal.night;
  const poly = (pts, style) => {
    const cl = clipNear(pts, proj); if (cl.length < 3) return;
    const P = cl.map(p => proj(p[0], p[1], p[2]));
    ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath();
    ctx.fillStyle = typeof style === 'function' ? style(P) : style; ctx.fill();
  };
  const flat = (f0, g0, f1, g1, style, dz = 0) => poly([[f0, g0, F0 + dz], [f1, g0, F0 + dz], [f1, g1, F0 + dz], [f0, g1, F0 + dz]], style);
  flat(-60, -60, 60, 60, (P) => {
    const ys = P.map(q => q.sy), g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    g.addColorStop(0, rgbStr(mix3(pal.hor, [40, 52, 36], 0.6))); g.addColorStop(1, rgbStr(mix3([46, 60, 38], [10, 14, 12], night * 0.8)));
    return g;
  });
  const conc = mix3([112, 114, 110], [26, 28, 32], night * 0.75);
  flat(-9, -5, 9, 5, rgbStr(conc));
  const asph = mix3([58, 60, 62], [16, 17, 20], night * 0.75);
  flat(-40, -11, 40, -6.5, rgbStr(asph), 0.001);
  for (let f = -38; f < 38; f += 3) flat(f, -8.84, f + 1.6, -8.66, 'rgba(236,236,230,0.8)', 0.002);
  const lit = night > 0.35;
  for (let f = -36; f <= 36; f += 4) for (const g of [-11.1, -6.4]) {
    const c = proj(f, g, F0 + 0.03); if (c.z <= ROOM_NEAR) continue;
    const r = Math.max(1, Math.min(6, 10 / c.z));
    ctx.fillStyle = lit ? 'rgba(255,238,190,0.95)' : 'rgba(210,210,200,0.7)';
    ctx.beginPath(); ctx.arc(c.sx, c.sy, r, 0, 7); ctx.fill();
  }
  const box = 'rgba(232,196,70,0.85)';
  flat(-2.2, -1.9, 2.2, -1.82, box, 0.002); flat(-2.2, 1.82, 2.2, 1.9, box, 0.002);
  flat(-2.2, -1.9, -2.12, 1.9, box, 0.002); flat(2.12, -1.9, 2.2, 1.9, box, 0.002);
  flat(2.2, -0.04, 7, 0.04, box, 0.002); flat(6.96, -6.5, 7.04, 0.04, box, 0.002);
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, R = 34 + hash01(i * 4.1) * 6;
    const cf = Math.cos(a) * R, cg = Math.sin(a) * R, tf = -Math.sin(a), tg = Math.cos(a);
    const hw = 1.6 + hash01(i * 2.3) * 2.4, top = F0 + 0.8 + hash01(i * 6.7) * 1.8;
    const P = [[cf - tf * hw, cg - tg * hw, F0], [cf + tf * hw, cg + tg * hw, F0], [cf + tf * hw, cg + tg * hw, top], [cf - tf * hw, cg - tg * hw, top]].map(p => proj(p[0], p[1], p[2]));
    if (P.some(q => q.z <= ROOM_NEAR)) continue;
    ctx.fillStyle = rgbStr(mix3(pal.hor, [30, 38, 32], 0.45));
    ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let k = 1; k < 4; k++) ctx.lineTo(P[k].sx, P[k].sy); ctx.closePath(); ctx.fill();
  }
  const o = proj(0, 0, F0);
  if (o.z > ROOM_NEAR) {
    const rr = Math.max(30, Math.min(220, 260 / o.z));
    const rg = ctx.createRadialGradient(o.sx, o.sy, 1, o.sx, o.sy, rr);
    rg.addColorStop(0, 'rgba(0,0,0,0.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(o.sx, o.sy); ctx.scale(1, 0.35); ctx.translate(-o.sx, -o.sy);
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(o.sx, o.sy, rr, 0, 7); ctx.fill(); ctx.restore();
  }
}

// ── Walk-inspect: the Echelon's boat helipad ── Open deck, rail, deckhouse forward, water and skyline round it.
const DECK_R = 2.55;
function drawHelipadRoom(ctx, proj, sky, w, h) {
  const F0 = FLOOR_Z, pal = skyPalette(sky), night = pal.night, wx = pal.weather;
  const poly = (modelPts, style) => {
    const cl = clipNear(modelPts, proj); if (cl.length < 3) return;
    const P = cl.map(p => proj(p[0], p[1], p[2]));
    ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath();
    ctx.fillStyle = typeof style === 'function' ? style(P) : style; ctx.fill();
  };
  // Unclipped projected quad for structures that never straddle the near plane.
  const fillModel = (pts, style) => {
    const P = pts.map(p => proj(p[0], p[1], p[2])); if (P.some(q => q.z <= ROOM_NEAR)) return;
    ctx.fillStyle = style; ctx.beginPath(); ctx.moveTo(P[0].sx, P[0].sy); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy); ctx.closePath(); ctx.fill();
  };
  // 1) The Basin.
  poly([[-46, -46, F0], [46, -46, F0], [46, 46, F0], [-46, 46, F0]], (P) => {
    const ys = P.map(q => q.sy), g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    g.addColorStop(0, rgbStr(mix3(pal.hor, [16, 26, 40], 0.55))); g.addColorStop(1, rgbStr(mix3([10, 16, 24], [4, 8, 14], night)));
    return g;
  });
  // 2) Skyline ring of tangential billboards.
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
  // 3) The deck.
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
  // 5) Red pad lights.
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, p = proj(Math.cos(a) * (DECK_R - 0.14), Math.sin(a) * (DECK_R - 0.14), F0 + 0.02);
    if (p.z <= ROOM_NEAR) continue;
    const r = clampN(20 / p.z, 2, 9);
    const rg = ctx.createRadialGradient(p.sx, p.sy, 1, p.sx, p.sy, r * 1.7);
    rg.addColorStop(0, 'rgba(255,84,66,0.55)'); rg.addColorStop(1, 'rgba(255,84,66,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 1.7, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,96,74,0.95)'; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.42, 0, 7); ctx.fill();
  }
  // 5b) Deck floodlights after dark.
  if (night > 0.04) {
    const pc = proj(0, 0, F0 + 0.01);
    if (pc.z > ROOM_NEAR) {
      const fr = clampN(240 / pc.z, 60, 320);
      const fg = ctx.createRadialGradient(pc.sx, pc.sy, 1, pc.sx, pc.sy, fr);
      fg.addColorStop(0, `rgba(216,232,250,${0.34 * night})`); fg.addColorStop(1, 'rgba(216,232,250,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(pc.sx, pc.sy, fr, 0, 7); ctx.fill();
    }
  }
  // 6) Guard rail round the open edge.
  const railZ = F0 + 0.34, open = (a) => Math.cos(a) < 0.5;
  ctx.strokeStyle = 'rgba(150,168,184,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); started = false;
  for (let k = 0; k <= 44; k++) { const a = k / 44 * Math.PI * 2; if (!open(a)) { started = false; continue; } const p = proj(Math.cos(a) * (DECK_R + 0.04), Math.sin(a) * (DECK_R + 0.04), railZ); if (p.z <= ROOM_NEAR) { started = false; continue; } started ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy); started = true; }
  ctx.stroke();
  for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2; if (!open(a)) continue; const bx = Math.cos(a) * (DECK_R + 0.04), bg = Math.sin(a) * (DECK_R + 0.04), p0 = proj(bx, bg, F0), p1 = proj(bx, bg, railZ); if (p0.z <= ROOM_NEAR || p1.z <= ROOM_NEAR) continue; ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke(); }
  // 7) The deckhouse.
  const hf0 = DECK_R - 0.15, hf1 = DECK_R + 3.2, hg = 1.95, hz1 = F0 + 1.35, hz2 = F0 + 2.15;
  const glass = (P) => { const ys = P.map(q => q.sy), g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys)); g.addColorStop(0, 'rgba(58,80,104,0.9)'); g.addColorStop(1, 'rgba(24,34,46,0.95)'); return g; };
  for (const s of [1, -1]) fillModel([[hf0, s * hg, F0], [hf1, s * hg, F0], [hf1, s * hg, hz2], [hf0, s * hg, hz1]], 'rgb(12,13,17)');
  fillModel([[hf0, -hg, hz2 - 0.005], [hf0, hg, hz2 - 0.005], [hf1, hg, hz2], [hf1, -hg, hz2]], 'rgb(20,22,28)');   // roof
  fillModel([[hf0, -hg, F0], [hf0, hg, F0], [hf0, hg, hz1], [hf0, -hg, hz1]], 'rgb(16,17,22)');                     // lower hull front (mirror-black)
  poly([[hf0, -hg, hz1 - 0.02], [hf0, hg, hz1 - 0.02], [hf0, hg, hz2], [hf0, -hg, hz2]], glass);                    // smoked-glass band
  ctx.strokeStyle = 'rgba(120,150,178,0.35)'; ctx.lineWidth = 1;
  for (let gg = -hg + 0.4; gg < hg; gg += 0.5) { const a = proj(hf0, gg, hz1 - 0.02), b = proj(hf0, gg, hz2); if (a.z <= ROOM_NEAR || b.z <= ROOM_NEAR) continue; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
  const bc = proj(hf0 + 1.2, 0, hz2 + 0.9);
  if (bc.z > ROOM_NEAR) {
    const r = clampN(24 / bc.z, 3, 12), rg = ctx.createRadialGradient(bc.sx, bc.sy, 1, bc.sx, bc.sy, r * 2);
    rg.addColorStop(0, 'rgba(255,238,200,0.8)'); rg.addColorStop(1, 'rgba(255,238,200,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(bc.sx, bc.sy, r * 2, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,214,0.95)'; ctx.beginPath(); ctx.arc(bc.sx, bc.sy, r * 0.4, 0, 7); ctx.fill();
  }
  // 8) Live precip (only with fx.motion).
  const fx = sky?.fx || {};
  if (fx.motion && /rain|storm/.test(wx)) {
    const now = performance.now() / 1000, slant = 3 + Math.min(8, (sky?.wind || 0) / 6);
    ctx.strokeStyle = rgbStr([192, 212, 236], wx === 'storm' ? 0.5 : 0.36); ctx.lineWidth = 1.1;
    for (let i = 0; i < 34; i++) { const px = (hash01(i * 1.3) * w + now * 90) % w, py = (hash01(i * 2.7) * h + now * 560) % h; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - slant, py + 12); ctx.stroke(); }
  }
}

// Stable per-index hash, so windows, billboards and stars don't jitter.
const hash01 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// Lit and dark windows on a building's front face, in model space.
function bayWindows(fillModel, f, g0, g1, zBase, zTop, seed, litRGB, litProb) {
  const cols = 3, rows = Math.max(2, Math.min(6, Math.round((zTop - zBase) / 0.34)));
  const cw = (g1 - g0) / cols, rh = (zTop - zBase) / rows, mx = cw * 0.26, mz = rh * 0.28;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = hash01(seed + r * 7.3 + c * 13.1) < litProb;
    const a = g0 + c * cw + mx, bb = g0 + (c + 1) * cw - mx, zb = zBase + r * rh + mz, zt = zBase + (r + 1) * rh - mz;
    fillModel([[f, a, zb], [f, bb, zb], [f, bb, zt], [f, a, zt]], lit ? rgbStr(litRGB, 0.92) : 'rgba(12,15,20,0.5)');
  }
}
// A lit rooftop billboard with a bloom.
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
// The ATC tower, many small faces. ⚠ fillModel has no z-buffer: emit faces back (side) to front, bottom to top.
// Only the +f front and +g side ever face the camera.
function drawATCTower(ctx, proj, fillModel, pal, night) {
  const g = 8.4, f = -20, base = FLOOR_Z, fB = f - 0.9, t = performance.now() / 1000;
  // Concrete tones keyed to the sky.
  const p = (rgb, k = 0.62) => rgbStr(mix3(pal.hor, rgb, k));
  const shaftF = p([54, 60, 68]), shaftS = p([34, 38, 44]);
  const trimF = p([74, 82, 92]), trimS = p([48, 54, 62]);
  const steelF = 'rgb(38,42,48)', steelS = 'rgb(24,27,32)';
  // A tapered segment: +g side, then front.
  const tier = (zb, zt, wb, wt, cF, cS) => {
    fillModel([[f, g + wb, zb], [fB, g + wb * 0.9, zb], [fB, g + wt * 0.9, zt], [f, g + wt, zt]], cS);   // +g side
    fillModel([[f, g - wb, zb], [f, g + wb, zb], [f, g + wt, zt], [f, g - wt, zt]], cF);                  // front
  };
  // A thin proud ledge: underside and fascia.
  const band = (z, w, h, cF, cS) => {
    fillModel([[f - 0.02, g - w, z], [f - 0.02, g + w, z], [fB, g + w * 0.9, z], [fB, g - w * 0.9, z]], cS);   // underside
    fillModel([[f - 0.02, g - w, z], [f - 0.02, g + w, z], [f - 0.02, g + w, z + h], [f - 0.02, g - w, z + h]], cF);   // fascia
  };

  // 1) Plinth with doorway.
  const plZ = base + 0.5;
  tier(base, plZ, 0.9, 0.66, p([46, 52, 60]), p([30, 34, 40]));
  fillModel([[f - 0.02, g - 0.16, base + 0.04], [f - 0.02, g + 0.16, base + 0.04], [f - 0.02, g + 0.13, base + 0.34], [f - 0.02, g - 0.13, base + 0.34]], 'rgb(14,16,20)');   // doorway

  // 2) Banded tapered shaft.
  const shaftTop = base + 3.4;
  const lifts = [[plZ, 0.62], [plZ + 0.95, 0.55], [plZ + 1.9, 0.48], [shaftTop, 0.4]];
  for (let i = 0; i < lifts.length - 1; i++) {
    tier(lifts[i][0], lifts[i + 1][0], lifts[i][1], lifts[i + 1][1], shaftF, shaftS);
    band(lifts[i + 1][0] - 0.03, lifts[i + 1][1] + 0.05, 0.08, trimF, trimS);
  }
  // Service ladder.
  for (const rg of [-0.06, 0.06]) fillModel([[f - 0.03, g + rg - 0.012, plZ], [f - 0.03, g + rg + 0.012, plZ], [f - 0.03, g + rg + 0.012, shaftTop], [f - 0.03, g + rg - 0.012, shaftTop]], 'rgba(16,18,22,0.85)');
  for (let z = plZ + 0.14; z < shaftTop - 0.1; z += 0.26) fillModel([[f - 0.03, g - 0.07, z], [f - 0.03, g + 0.07, z], [f - 0.03, g + 0.07, z + 0.03], [f - 0.03, g - 0.07, z + 0.03]], 'rgba(16,18,22,0.8)');

  // 3) Catwalk gallery with railing.
  const galZ = shaftTop, gW = 1.0, galF = -0.06;   // galF: front deck edge pulled toward camera
  fillModel([[f + galF, g - gW, galZ], [f + galF, g + gW, galZ], [fB - 0.1, g + gW * 0.9, galZ], [fB - 0.1, g - gW * 0.9, galZ]], steelS);   // deck underside
  band(galZ, gW, 0.1, steelF, steelS);   // deck fascia lip
  const railZ = galZ + 0.24;
  fillModel([[f + galF, g - gW, railZ - 0.03], [f + galF, g + gW, railZ - 0.03], [f + galF, g + gW, railZ], [f + galF, g - gW, railZ]], 'rgba(150,160,172,0.8)');   // front top rail
  fillModel([[f + galF, g + gW, railZ - 0.03], [fB - 0.1, g + gW * 0.9, railZ - 0.03], [fB - 0.1, g + gW * 0.9, railZ], [f + galF, g + gW, railZ]], 'rgba(120,130,142,0.7)');   // side top rail
  for (let gg = -gW + 0.12; gg <= gW - 0.06; gg += 0.32) fillModel([[f + galF, g + gg - 0.015, galZ], [f + galF, g + gg + 0.015, galZ], [f + galF, g + gg + 0.015, railZ], [f + galF, g + gg - 0.015, railZ]], 'rgba(140,150,162,0.55)');   // front railing posts

  // 4) Control cab, front raked outward.
  const cabZb = galZ + 0.06, cabZt = cabZb + 0.82, cw = 0.88, lean = 0.2;
  fillModel([[f, g + cw, cabZb], [fB, g + cw * 0.92, cabZb], [fB, g + cw * 0.92, cabZt], [f - lean, g + cw, cabZt]], p([26, 30, 36], 0.6));   // cab +g side wall
  const glass = night > 0.4 ? [150, 210, 184] : [96, 138, 156];
  fillModel([[f, g - cw, cabZb + 0.05], [f, g + cw, cabZb + 0.05], [f - lean, g + cw, cabZt], [f - lean, g - cw, cabZt]], rgbStr(glass, 0.94));   // raked glass band
  if (night > 0.4) for (const gg of [-cw * 0.6, -cw * 0.15, cw * 0.35]) fillModel([[f - lean * 0.35, g + gg - 0.05, cabZb + 0.12], [f - lean * 0.35, g + gg + 0.05, cabZb + 0.12], [f - lean * 0.4, g + gg + 0.05, cabZb + 0.24], [f - lean * 0.4, g + gg - 0.05, cabZb + 0.24]], 'rgba(255,206,150,0.8)');
  // Mullions and transom.
  for (const gg of [-cw * 0.66, -cw * 0.33, 0, cw * 0.33, cw * 0.66]) fillModel([[f - lean * 0.5, g + gg - 0.02, cabZb + 0.06], [f - lean * 0.5, g + gg + 0.02, cabZb + 0.06], [f - lean, g + gg + 0.02, cabZt], [f - lean, g + gg - 0.02, cabZt]], 'rgba(16,20,26,0.78)');
  fillModel([[f - lean * 0.62, g - cw, cabZb + 0.5], [f - lean * 0.62, g + cw, cabZb + 0.5], [f - lean * 0.66, g + cw, cabZb + 0.55], [f - lean * 0.66, g - cw, cabZb + 0.55]], 'rgba(16,20,26,0.7)');   // transom
  // Parapet roof.
  const roofZ = cabZt, roofZt = roofZ + 0.16;
  fillModel([[f - lean, g + cw, roofZ], [fB, g + cw * 0.92, roofZ], [fB, g + cw * 0.92, roofZt], [f - lean, g + cw, roofZt]], 'rgb(30,34,40)');   // roof +g fascia (side)
  fillModel([[f - lean, g - cw, roofZ], [f - lean, g + cw, roofZ], [f - lean, g + cw, roofZt], [f - lean, g - cw, roofZt]], 'rgb(38,43,50)');   // roof front fascia
  fillModel([[f - lean, g - cw, roofZt], [f - lean, g + cw, roofZt], [fB, g + cw * 0.92, roofZt], [fB, g - cw * 0.92, roofZt]], 'rgb(24,28,34)');   // roof top

  // 5) Roof equipment and mast.
  const rf = f - lean * 0.5;
  fillModel([[rf, g - cw * 0.55 - 0.04, roofZt], [rf, g - cw * 0.55 + 0.04, roofZt], [rf, g - cw * 0.55 + 0.04, roofZt + 0.16], [rf, g - cw * 0.55 - 0.04, roofZt + 0.16]], 'rgb(20,23,28)');   // dish pedestal
  fillModel([[rf - 0.02, g - cw * 0.55 - 0.18, roofZt + 0.1], [rf - 0.02, g - cw * 0.55 + 0.18, roofZt + 0.1], [rf - 0.06, g - cw * 0.55 + 0.14, roofZt + 0.34], [rf - 0.06, g - cw * 0.55 - 0.14, roofZt + 0.34]], 'rgba(180,190,202,0.85)');   // dish face
  for (const gg of [cw * 0.2, cw * 0.5]) fillModel([[rf, g + gg - 0.015, roofZt], [rf, g + gg + 0.015, roofZt], [rf, g + gg + 0.015, roofZt + 0.4 + gg], [rf, g + gg - 0.015, roofZt + 0.4 + gg]], 'rgba(30,34,40,0.9)');   // whip antennas
  const mastTop = roofZt + 0.8;
  fillModel([[rf - 0.08, g - 0.04, roofZt], [rf - 0.08, g + 0.04, roofZt], [rf - 0.08, g + 0.04, mastTop], [rf - 0.08, g - 0.04, mastTop]], 'rgba(20,22,26,0.9)');
  const mast = proj(rf - 0.08, g, mastTop);
  if (mast.z > ROOM_NEAR) {
    const blink = t % 1.3 < 0.13 ? 1 : 0.12;   // red obstruction light — a slow steady blink
    let rg = ctx.createRadialGradient(mast.sx, mast.sy, 1, mast.sx, mast.sy, 11);
    rg.addColorStop(0, `rgba(255,60,50,${0.35 + blink * 0.55})`); rg.addColorStop(1, 'rgba(255,60,50,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(mast.sx, mast.sy, 11, 0, 7); ctx.fill();
    // Sweeping radar bar.
    const rc = proj(f - lean, g, roofZt + 0.12);
    if (rc.z > ROOM_NEAR) {
      const len = Math.max(7, Math.min(34, 30 / rc.z)), a = t * 1.7, dx = Math.cos(a) * len, dy = Math.sin(a) * len * 0.36;
      ctx.strokeStyle = 'rgba(150,200,172,0.75)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(rc.sx - dx, rc.sy - dy); ctx.lineTo(rc.sx + dx, rc.sy + dy); ctx.stroke(); ctx.lineCap = 'butt';
    }
    // Airport beacon, white/green.
    const beacon = proj(f - lean, g + cw * 0.6, roofZt + 0.18);
    if (beacon.z > ROOM_NEAR) {
      const green = (t % 2) < 1, col = green ? '80,255,150' : '245,250,255', ph = 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI));
      rg = ctx.createRadialGradient(beacon.sx, beacon.sy, 1, beacon.sx, beacon.sy, 13);
      rg.addColorStop(0, `rgba(${col},${ph * 0.7})`); rg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(beacon.sx, beacon.sy, 13, 0, 7); ctx.fill();
    }
  }
}

// ── The shared depth pass ── One copy for every vehicle renderer; see docs/reference/glass-notes.md#model-depth-pass
// A face record needs `P` ({sx, sy, z}, smaller z nearer), `rv` and optional `alpha`; each comes back with `seen`,
// which gates the canvas detail passes. A false return means fall back to sortTruckFaces.
const RASTER_MIN_PX = 46;           // below this on screen a rig keeps the sort: too small to see a mistake in
// ⚠ A frame-time budget (~30 ns per buffer pixel): under load the supersampling gives way, never the pass.
const RASTER_BUDGET_PX = 200_000;
// The canvas transform's scale (the device ratio), read off the context.
function canvasScale(ctx) {
  try {
    const m = ctx.getTransform ? ctx.getTransform() : null;
    return m ? clampN(Math.hypot(m.a || 1, m.b || 0) || 1, 1, 2) : 1;
  } catch { return 1; }
}
// Split into build and commit so the windscreen can paint ground light between them. Face records are read
// through `ptsKey`/`zKey` (panels: P/z, windscreen: pts/f).
const RASTER_PAD = 1;

// Test seam: models through the shared pass. The smoke asserts it moves in lockstep with model-raster's rasterCount.
let _depthPassCount = 0;
export const depthPassCount = () => _depthPassCount;

// Build half: a pass handle, or null (nothing to do, too small, all translucent) so the caller falls back to its sort.
export function depthPassBuild(ctx, drawn, {
  min = 0, budget = RASTER_BUDGET_PX, scale = null, pad = RASTER_PAD,
  ptsKey = 'P', zKey = 'z', box = null,
  lit = false, occlude = null, occBias = 0, light = null,
} = {}) {
  if (!drawn.length) return null;
  let x0, y0, x1, y1;
  if (box) {
    x0 = box.minx; y0 = box.miny; x1 = box.maxx; y1 = box.maxy;
  } else {
    x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
    for (const fc of drawn) for (const q of fc[ptsKey]) {
      if (q.sx < x0) x0 = q.sx; if (q.sx > x1) x1 = q.sx;
      if (q.sy < y0) y0 = q.sy; if (q.sy > y1) y1 = q.sy;
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  if (min && (x1 - x0 < min || y1 - y0 < min)) return null;   // a thumbnail keeps the sort — see the ⚠ in model-raster.js
  x0 = Math.floor(x0) - pad; y0 = Math.floor(y0) - pad;
  x1 = Math.ceil(x1) + pad; y1 = Math.ceil(y1) + pad;
  const bw = x1 - x0, bh = y1 - y0;
  // Supersampled to the canvas scale, capped by the budget.
  const base = scale == null ? canvasScale(ctx) : clampN(scale || 1, 1, 2);
  const sc = Math.max(1, Math.min(base, Math.sqrt(budget / Math.max(1, bw * bh))));
  // ⚠ Only opaque faces go in the buffer: the depth test replaces pixels, so a translucent face would punch a hole.
  // They're painted after the blit. The box is still measured off every face.
  const solid = drawn.filter(fc => (fc.alpha ?? 1) >= 0.999);
  if (!solid.length) return null;
  // ⚠ The light hook gets this exact array: shadeRaster reads normals by stored face index.
  const rf = solid.map(fc => ({
    pts: fc[ptsKey].map(q => ({ x: q.sx, y: q.sy, z: q[zKey] })),
    r: fc.rv[0], g: fc.rv[1], b: fc.rv[2], a: 255,
    w: fc.wv || null, n: fc.nrm || null,
  }));
  const res = rasterFaces(rf, x0, y0, bw, bh, sc, lit);
  if (!res) return null;
  // ⚠ Counted here, on success, to stay in lockstep with rasterCount.
  _depthPassCount++;
  // World occlusion: the hook rasterises nearby solids over this box, or returns null.
  const occWin = occlude ? occlude(x0, y0, bw, bh, sc) : null;
  if (occWin) maskRaster(res, occWin, occBias);
  // Light after the mask, so masked pixels aren't shaded.
  if (res.lit && light) light(res, rf);
  return { res, occWin, occBias, x0, y0, sc, ptsKey, zKey };
}

// Commit half: blit, then stamp each face's `seen`. False if the blit couldn't land (fall back to the sort).
// `skipBlit` keeps the verdict without drawing, for a body already on the GL depth buffer.
export function depthPassCommit(ctx, pass, drawn, opts = {}) {
  if (!pass) return false;
  const { res, occWin, occBias, x0, y0, sc, ptsKey, zKey } = pass;
  if (!opts.skipBlit && !blitRaster(ctx, res, x0, y0)) return false;
  for (const fc of drawn) {
    const P = fc[ptsKey];
    let cx = 0, cy = 0, cz = 0;
    for (const q of P) { cx += q.sx; cy += q.sy; cz += q[zKey]; }
    const n = P.length, zc = cz / n;
    const bx = Math.round((cx / n - x0) * sc), by = Math.round((cy / n - y0) * sc);
    const on = bx >= 0 && by >= 0 && bx < res.w && by < res.h;
    // In the buffer: did it win its centre. Out of it: is anything opaque in front.
    fc.offBuf = !((fc.alpha ?? 1) >= 0.999);
    fc.seen = on
      && (fc.offBuf ? depthAt(res, bx, by) > zc
                    : Math.abs(depthAt(res, bx, by) - zc) < Math.max(1e-4, zc * 0.02))
      // ⚠ And it must beat the world occlusion window too.
      && (!occWin || !(depthWinAt(occWin, bx, by) + occBias < zc));
  }
  return true;
}

// Build and commit in one, for panels.
function modelDepthPass(ctx, drawn, opts = {}) {
  const pass = depthPassBuild(ctx, drawn, opts);
  return pass ? depthPassCommit(ctx, pass, drawn) : false;
}

// ── Turntable renderer ── Perspective camera, spun by `yaw` at `elev` (or a free `cam`), lit by a key light.
export function drawTurntable(ctx, opts) {
  ctx.clearRect(0, 0, opts.w, opts.h);
  paintTurntable(ctx, opts);
}

// The paint step with no clear, for callers that already drew a backdrop.
function paintTurntable(ctx, { cls, armed = false, variant = '', livery, yaw = 0, w, h, wreck = false, zoom = 1, elev = 0.42, cam = null, floor = false, sky = null, venue = null, fit = 0, lift = 0, idleRoll = 0, budget = RASTER_BUDGET_PX }) {
  // `variant` is the ground-vehicle channel.
  const faces = (wreck ? wreckFaces() : aircraftFaces(cls, 1, armed, variant)).map(poseAtRest);
  // Taildraggers sit nose-high: tilt the model (not the floor).
  const _gp = groundPitchFor(cls, armed) * Math.PI / 180;
  const _cg = Math.cos(_gp), _sg = Math.sin(_gp);
  const tiltV = _gp ? (v) => [v[0] * _cg - v[2] * _sg, v[1], v[0] * _sg + v[2] * _cg] : null;
  // `fit`: scale the model so its longest ground span reads `fit` (the room is sized in aircraft units), then drop
  // it onto the floor. No `fit` is the identity, so aircraft views are unchanged.
  let mScale = 1, mDrop = 0;
  if (fit) {
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const f of faces) for (const v0 of f.p) {
      const v = tiltV ? tiltV(v0) : v0;
      for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
    }
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
    if (span > 1e-4) { mScale = fit / span; mDrop = FLOOR_Z - lo[2] * mScale; }
  }
  // `lift` raises the body as one rigid thing (the depot start-up).
  mDrop += lift;
  // The one model-to-world transform. `idleRoll` is a small rotation about the model's own long axis.
  const cIR = Math.cos(idleRoll), sIR = Math.sin(idleRoll);
  const modelV = (v0) => {
    const v = tiltV ? tiltV(v0) : v0;
    let g = v[1] * mScale, z = v[2] * mScale;
    if (idleRoll) { const g1 = g * cIR - z * sIR; z = g * sIR + z * cIR; g = g1; }
    return [v[0] * mScale, g, z + mDrop];
  };
  const pal = liveryPalette(livery || {}, cls, armed);
  const jazzImg = (!wreck && pal.pat === 'jazz') ? jazzTex(livery?.base, livery?.trim, livery?.accent, livery?.ground) : null;
  const texStr = wreck ? 0.62 : (TEX_STRENGTH[livery?.finish] ?? 0.46);
  const roll = wreck ? -0.26 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
  const ox = w / 2, oy = h * 0.52;
  const Ln = Math.hypot(-0.25, -0.45, 0.86), lx = -0.25 / Ln, ly = -0.45 / Ln, lz = 0.86 / Ln;
  let proj, eyeW;   // eyeW = the camera position in the SAME space the face normals live in (P.wx/wy/wz), for backface culling
  if (cam) {
    // Free walk camera in the craft frame. World coords are returned raw so the key light stays fixed in the room.
    const focal = Math.min(w, h) * 0.92 * (cam.fov || 1);
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cpi = Math.cos(cam.pitch), spi = Math.sin(cam.pitch);
    proj = (f, g, hh) => {
      const g1 = g * cro - hh * sro, h1 = g * sro + hh * cro;            // static wreck roll (world)
      const dF = f - cam.x, dG = g1 - cam.y, dU = h1 - cam.z;
      const xf = dF * cyw + dG * syw, xr = -dF * syw + dG * cyw;         // along look / to the right
      const depth = xf * cpi + dU * spi, up = -xf * spi + dU * cpi;      // into screen / screen-up
      return { sx: ox + xr * focal / depth, sy: oy - up * focal / depth, z: depth, gz: xf * cpi, wx: f, wy: g1, wz: h1 };
    };
    eyeW = [cam.x, cam.y, cam.z];   // the free-walk eye, already in model/world (f,g1,h1) space
  } else {
    // Orbit turntable.
    const E = clampN(elev, 0.04, 1.35), cosE = Math.cos(E), sinE = Math.sin(E);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const camDist = 3.5, focal = Math.min(w, h) * 1.75 * zoom;
    proj = (f, g, hh) => {
      const g1 = g * cro - hh * sro, h1 = g * sro + hh * cro;            // static wreck roll
      const fx = f * cy - g1 * sy, gy = f * sy + g1 * cy, hz = h1;       // yaw about up
      const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;  // ¾ camera tilt
      const z = camDist - camZ;
      return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z, gz: camDist - fx * cosE, wx: fx, wy: gy, wz: hz };
    };
    eyeW = [camDist * cosE, 0, camDist * sinE];   // orbit eye in (fx,gy,hz) space: solves camZ = camDist, camY = 0
  }
  const helipad = venue === 'helipad';
  const ramp = venue === 'ramp';
  if (floor && cam && helipad) drawHelipadRoom(ctx, proj, sky, w, h);   // walk view: an open boat helipad (deck draws its own ground)
  else if (floor && cam && ramp) drawRampRoom(ctx, proj, sky);         // parked outside: open apron under the live sky
  else if (floor && cam) drawInspectRoom(ctx, proj, sky);              // walk view: a real 3D hangar around you, live sky through the bay door
  if (floor && !(cam && (helipad || ramp))) drawFloorGrid(ctx, proj);   // 3D ground under the plane (the pad and the apron draw their own)
  const drawn = [];
  for (const face of faces) {
    if (face.role === 'rotor') continue;   // spinning surfaces drawn by drawRotorFX below
    if (visorHidden(face)) continue;       // parked on the turntable she sits nose-CLOSED, so the hold isn't there to punch through her belly
    const P = face.p.map(v => { const t = modelV(v); return proj(t[0], t[1], t[2]); });
    if (P.some(q => q.z <= MODEL_NEAR_Z)) continue;
    // Newell's method for the normal, so a face with one collapsed edge (a cone tip) still has one.
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < P.length; i++) {
      const c = P[i], d = P[(i + 1) % P.length];
      nx += (c.wy - d.wy) * (c.wz + d.wz); ny += (c.wz - d.wz) * (c.wx + d.wx); nz += (c.wx - d.wx) * (c.wy + d.wy);
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    // Backface-cull closed-hull roles against the model centre. ⚠ A face with `cen` is culled against its own box's
    // centre instead; measured from the origin, half a truck painted inside out.
    let culled = false;
    if (face.cen) {
      const t = modelV(face.cen);
      let cx = 0, cy = 0, cz = 0; for (const q of P) { cx += q.wx; cy += q.wy; cz += q.wz; }
      const n = P.length; cx /= n; cy /= n; cz /= n;
      const tp = proj(t[0], t[1], t[2]);
      const dx = cx - tp.wx, dy = cy - tp.wy, dz = cz - tp.wz;
      // ⚠ No confident outward along the normal, no cull: a flat box (lens, band, plate) or a `cen` offset sideways
      // to the face gives a zero dot product and a coin-flip cull. Divided by Newell's length so it's a world distance.
      if (Math.abs(nx * dx + ny * dy + nz * dz) / nl > 1e-4) {
        const out = (nx * dx + ny * dy + nz * dz) < 0 ? -1 : 1;
        if (out * (nx * (eyeW[0] - cx) + ny * (eyeW[1] - cy) + nz * (eyeW[2] - cz)) <= 0) culled = true;
      }
    } else if (CULL_ROLE.has(face.role)) {
      let cx = 0, cy = 0, cz = 0; for (const q of P) { cx += q.wx; cy += q.wy; cz += q.wz; }
      const n = P.length; cx /= n; cy /= n; cz /= n;
      const out = (nx * cx + ny * cy + nz * cz) < 0 ? -1 : 1;   // flip normal to point away from the model centre
      if (out * (nx * (eyeW[0] - cx) + ny * (eyeW[1] - cy) + nz * (eyeW[2] - cz)) <= 0) continue;   // faces away from the eye → hidden back
    }
    if (culled) continue;
    const light = 0.52 + 0.48 * Math.abs((nx * lx + ny * ly + nz * lz) / nl);
    let rgb = faceBaseRgb(face, pal);
    if (wreck) rgb = mix3(rgb, [74, 72, 66], 0.55);
    let z = 0; for (const q of P) z += q.z;
    const avgZ = z / P.length;
    // Walk view: faces fade as the eye gets close, so you can see the BOARD prompt.
    const alpha = cam ? clampN((avgZ - 0.25) / 0.9, 0.08, 1) : 1;
    // The part sort's keys (see sortTruckFaces); `z` here is the same quantity the windscreen calls `f`.
    let nf = Infinity, xf = -Infinity, hf = Infinity;
    for (const q of P) { if (q.z < nf) nf = q.z; if (q.z > xf) xf = q.z; if (q.gz != null && q.gz < hf) hf = q.gz; }
    // ⚠ The shade is computed once and kept as both a CSS string (`col`) and numbers (`rv`) for the rasteriser.
    const shk = face.sh * pal.fmul * light * (wreck ? 0.8 : 1);
    const rv = [clampN(rgb[0] * shk, 0, 255) | 0, clampN(rgb[1] * shk, 0, 255) | 0, clampN(rgb[2] * shk, 0, 255) | 0];
    const rec = { P, role: face.role, avgZ, alpha, part: face.part, nf, xf, hf: hf === Infinity ? null : hf, af: avgZ, i: drawn.length, rv, col: shadeRgb(rgb, shk) };
    if (jazzImg && JAZZ_ROLE.has(face.role)) rec.uv = face.p.map(v => jazzUV(v, face.role));
    if (face.uv) { rec.cuv = face.uv; rec.cart = face.art; }        // canopy art: UVs + style authored on the mesh, not derived
    drawn.push(rec);
  }
  // Every model goes through the shared depth pass (see modelDepthPass). Detail passes stay on canvas, gated on
  // `seen`. The hero shot takes the pass at any size. Falls back to the sorts if the pass declines.
  if (!wreck) pushParkedRotorFaces(drawn, cls, armed, 2.3, (v) => { const t = modelV(v); return proj(t[0], t[1], t[2]); }, 0.2);
  const rasterOK = modelDepthPass(ctx, drawn, { budget });
  if (!rasterOK) {
    if (cls === 'truck') sortTruckFaces(drawn, { id: `bay:${cls}:${variant || ''}` }, 1);
    else drawn.sort((a, b) => b.avgZ - a.avgZ);
  }
  ctx.lineJoin = 'round';
  for (const fc of drawn) {
    if (rasterOK && !fc.seen) continue;                 // hidden: its detail would paint over the winner
    if (fc.alpha < 1) ctx.globalAlpha = fc.alpha;
    ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
    for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
    ctx.closePath();
    if (!rasterOK || fc.offBuf) { ctx.fillStyle = fc.col; ctx.fill(); }   // the depth pass laid the colour down for everything except the translucent faces it refused
    if (fc.uv) overlayJazz(ctx, fc.P, fc.uv, jazzImg);           // Memphis splatter, mapped in body space
    else if (TEXTURED.has(fc.role)) overlayHull(ctx, fc.P, texStr);   // procedural panel/rivet detail
    if (fc.cuv) drawCanopyGlass(ctx, fc.P, fc.cuv, fc.cart);          // greenhouse: mullions, sky reflection, the crew behind the glass
    if (!wreck && (fc.role === 'glass' || fc.role === 'window')) glassSheen(ctx, fc.P);   // glassy specular on canopy/windows
    // ⚠ No outline over a depth-buffered model: the stroke would draw the hidden half of every box.
    if (!rasterOK || fc.offBuf) { ctx.strokeStyle = 'rgba(8,10,14,0.55)'; ctx.lineWidth = 1; ctx.stroke(); }
    if (!wreck && livery?.finish === 'gloss' && fc.role === 'body') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy); ctx.lineTo(fc.P[1].sx, fc.P[1].sy); ctx.stroke(); ctx.restore();
    }
    if (fc.alpha < 1) ctx.globalAlpha = 1;
  }
  // Decals: truck art on the door, aircraft art on the nose. Appendages occlude them.
  if (!wreck) {
    const occD = drawn.filter(fc => OCCLUDE_ROLE.has(fc.role)).map(fc => ({ P: fc.P, z: fc.avgZ }));
    // ⚠ The decal goes through `modelV` like every vertex: with the raw `proj`, a fitted truck's door art landed in the chassis.
    const projM = (f, g, hh) => { const t = modelV([f, g, hh]); return proj(t[0], t[1], t[2]); };
    if (cls === 'truck') drawTruckDoorArt(ctx, projM, variant || 'hauler', 1, livery, occD, MODEL_NEAR_Z);
    else drawNoseArt(ctx, projM, cls, livery, occD, MODEL_NEAR_Z);
  }
  // Rotors are already in `drawn`. Return the contact patch on screen (`ppu` = pixels per world unit) for ground effects.
  const gp = proj(0, 0, FLOOR_Z);
  const gpx = proj(0, 1, FLOOR_Z);
  return { ground: gp, ppu: Math.abs(gpx.sx - gp.sx) || Math.min(w, h) * 0.4, front: proj(mScale ? 0.5 * fit : 0.5, 0, FLOOR_Z) };
}

// ── Outside world through the bay door ── `sky = { hour, weather, wind }` (plugins/flight/state.js skyState()).
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
  ctx.fillStyle = rgbStr(mix3(pal.hor, [20, 24, 30], 0.55), 0.6);
  const bw = (x1 - x0) / 7;
  for (let i = 0; i < 7; i++) {
    const bh = (groundY - yTop) * (0.08 + ((i * 37) % 5) / 22);
    ctx.fillRect(x0 + i * bw, groundY - bh, bw * 0.8, bh);
  }
  const gg = ctx.createLinearGradient(0, groundY, 0, yBot);
  gg.addColorStop(0, rgbStr(mix3(pal.hor, [30, 34, 38], 0.4))); gg.addColorStop(1, 'rgba(20,24,28,0.9)');
  ctx.fillStyle = gg; ctx.fillRect(x0, groundY, x1 - x0, yBot - groundY);
  if (/^(clear|dust)$/.test(pal.weather)) {
    const sx = cx + (pal.night > 0.4 ? -1 : 1) * (x1 - x0) * 0.22, sy = yTop + (groundY - yTop) * 0.32;
    const disc = pal.night > 0.4 ? [220, 224, 236] : [255, 246, 214];
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, (x1 - x0) * 0.12);
    rg.addColorStop(0, rgbStr(disc, 0.9)); rg.addColorStop(1, rgbStr(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, (x1 - x0) * 0.12, 0, 7); ctx.fill();
    ctx.fillStyle = rgbStr(disc, 0.9); ctx.beginPath(); ctx.arc(sx, sy, (x1 - x0) * 0.03, 0, 7); ctx.fill();
  }
  // Weather. Rain animates per streak from a stable index plus the clock; the pane's own weather overlay is off
  // while a panel owns the pane. ⚠ Rain only if it's falling on this field (`sky.here`, hangars.js), not just today.
  const here = sky?.here;
  const raining = here ? (here.precipRate > 0 && here.precipType !== 'snow')
    : (pal.weather === 'rain' || pal.weather === 'storm');
  if (raining) {
    const heavy = pal.weather === 'storm' || (here?.precipRate || 0) > 0.6;
    const t = performance.now() / 1000, spanY = groundY - yTop, spanX = x1 - x0;
    ctx.lineWidth = 1;
    for (let i = 0; i < (heavy ? 46 : 30); i++) {
      const rx = x0 + ((i * 53) % 100) / 100 * spanX;
      const speed = 0.9 + ((i * 29) % 100) / 140;                    // fall rates differ, or it reads as a curtain
      const ry = yTop + ((t * speed + ((i * 71) % 100) / 100) % 1) * spanY;
      const len = (heavy ? 13 : 10) * speed;
      ctx.strokeStyle = rgbStr([190, 210, 230], 0.16 + 0.26 * ((i * 17) % 10) / 10);
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - len * 0.3, ry + len); ctx.stroke();
    }
    // Splash rings.
    ctx.strokeStyle = rgbStr([200, 218, 236], 0.22);
    for (let i = 0; i < (heavy ? 9 : 6); i++) {
      const px = x0 + ((i * 37) % 100) / 100 * spanX;
      const py = groundY + ((i * 61) % 100) / 100 * (yBot - groundY) * 0.8;
      const k = (t * 1.7 + i * 0.37) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.ellipse(px, py, 1 + k * 5, (1 + k * 5) * 0.34, 0, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
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

// ── Helipad backdrop ── The floor scene for a yacht field (the Echelon): sky, Basin, skyline, deck and deckhouse.
function drawHelipadBackdrop(ctx, w, h, { sky } = {}) {
  const pal = skyPalette(sky), horizon = h * 0.44, cx = w / 2;
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, rgbStr(pal.top)); g.addColorStop(1, rgbStr(pal.hor));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, horizon);
  if (/^(clear|dust)$/.test(pal.weather)) {
    const sx = cx + (pal.night > 0.4 ? -1 : 1) * w * 0.24, sy = horizon * 0.42, disc = pal.night > 0.4 ? [220, 224, 236] : [255, 246, 214];
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, w * 0.09);
    rg.addColorStop(0, rgbStr(disc, 0.9)); rg.addColorStop(1, rgbStr(disc, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sx, sy, w * 0.09, 0, 7); ctx.fill();
  }
  ctx.fillStyle = rgbStr(mix3(pal.hor, [20, 26, 34], 0.5), 0.72);
  const bw = w / 11;
  for (let i = 0; i < 11; i++) { const bh = horizon * (0.12 + hash01(i * 4.2) * 0.42); ctx.fillRect(i * bw, horizon - bh, bw * 0.84, bh); }
  g = ctx.createLinearGradient(0, horizon, 0, h);
  g.addColorStop(0, rgbStr(mix3(pal.hor, [14, 24, 38], 0.55))); g.addColorStop(1, 'rgb(9,14,20)');
  ctx.fillStyle = g; ctx.fillRect(0, horizon, w, h - horizon);
  // A long low tiered deckhouse, left of centre so the craft stay clear.
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
  const mx = ssL + w * 0.25, mtop = t3 - h * 0.05;
  ctx.strokeStyle = 'rgba(120,140,160,0.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(mx, t3); ctx.lineTo(mx, mtop); ctx.stroke();
  const mbg = ctx.createRadialGradient(mx, mtop, 1, mx, mtop, 8); mbg.addColorStop(0, 'rgba(255,238,200,0.8)'); mbg.addColorStop(1, 'rgba(255,238,200,0)');
  ctx.fillStyle = mbg; ctx.beginPath(); ctx.arc(mx, mtop, 8, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,244,214,0.95)'; ctx.beginPath(); ctx.arc(mx, mtop, 1.8, 0, 7); ctx.fill();
  const dTopY = horizon + h * 0.04, dTopHalf = w * 0.2, dBotHalf = w * 0.66;
  ctx.beginPath(); ctx.moveTo(cx - dTopHalf, dTopY); ctx.lineTo(cx + dTopHalf, dTopY); ctx.lineTo(cx + dBotHalf, h); ctx.lineTo(cx - dBotHalf, h); ctx.closePath();
  g = ctx.createLinearGradient(0, dTopY, 0, h); g.addColorStop(0, '#1f252c'); g.addColorStop(1, '#0f1318');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();   // keep the markings + lights on the deck
  const px = cx, py = h * 0.72, rx = w * 0.2, ry = h * 0.12;
  ctx.strokeStyle = 'rgba(208,222,236,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(px, py, rx, ry, 0, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(224,232,240,0.5)';
  const hw = rx * 0.42, hh = ry * 0.9, barW = rx * 0.12;
  ctx.fillRect(px - hw - barW / 2, py - hh, barW, hh * 2);
  ctx.fillRect(px + hw - barW / 2, py - hh, barW, hh * 2);
  ctx.fillRect(px - hw, py - hh * 0.16, hw * 2, hh * 0.32);
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2, lx = px + Math.cos(a) * rx * 1.06, ly = py + Math.sin(a) * ry * 1.06;
    const rg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 9);
    rg.addColorStop(0, 'rgba(255,84,66,0.5)'); rg.addColorStop(1, 'rgba(255,84,66,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(lx, ly, 9, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,96,74,0.9)'; ctx.beginPath(); ctx.arc(lx, ly, 2.4, 0, 7); ctx.fill();
  }
  ctx.restore();
  // A pool of deck floodlight, stronger after dark.
  const floodA = 0.16 + pal.night * 0.26;
  const pool = ctx.createRadialGradient(cx, h * 0.82, 4, cx, h * 0.82, w * 0.5);
  pool.addColorStop(0, `rgba(222,234,248,${floodA})`); pool.addColorStop(1, 'rgba(222,234,248,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, dTopY, w, h - dTopY);
  const vg = ctx.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.45, cx, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

// ── The covered dock ── A roof on columns over a slot of open water, a gantry hoist, and one open end onto the Basin.
// ⚠ The water is lit from under, or it reads as a boat on a black floor.
function drawDockBackdrop(ctx, w, h, { doorFrac = 0.5, sky } = {}) {
  const pal = skyPalette(sky), night = pal.night ?? 0;
  const horizon = h * 0.44, cx = w / 2;

  // The open end, sized off the hull count.
  const mouthW = w * (0.3 + doorFrac * 0.26), mouthT = h * 0.12, mouthB = horizon + h * 0.02;
  ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, w, horizon);
  let g = ctx.createLinearGradient(0, mouthT, 0, mouthB);
  g.addColorStop(0, rgbStr(pal.top)); g.addColorStop(1, rgbStr(pal.hor));
  ctx.fillStyle = g; ctx.fillRect(cx - mouthW / 2, mouthT, mouthW, mouthB - mouthT);
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - mouthW / 2, mouthT, mouthW, mouthB - mouthT); ctx.clip();
  ctx.fillStyle = rgbStr(mix3(pal.hor, [18, 24, 32], 0.55), 0.8);
  const bw = mouthW / 9;
  for (let i = 0; i < 9; i++) {
    const bh = (mouthB - mouthT) * (0.08 + hash01(i * 5.1) * 0.3);
    ctx.fillRect(cx - mouthW / 2 + i * bw, mouthB - bh - (mouthB - mouthT) * 0.12, bw * 0.86, bh);
  }
  ctx.restore();

  // Roof and columns (the room's scale reference).
  const eave = h * 0.1;
  ctx.fillStyle = '#10151b'; ctx.fillRect(0, 0, w, eave);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, eave - 5, w, 5);
  for (const t of [0.09, 0.26, 0.74, 0.91]) {
    const x = t * w, top = eave, bot = horizon + h * (0.02 + Math.abs(t - 0.5) * 0.1);
    const cw = w * (0.022 + Math.abs(t - 0.5) * 0.02);
    const cg = ctx.createLinearGradient(x - cw, 0, x + cw, 0);
    cg.addColorStop(0, '#0d1116'); cg.addColorStop(0.45, '#242c34'); cg.addColorStop(1, '#0b0e12');
    ctx.fillStyle = cg; ctx.fillRect(x - cw, top, cw * 2, bot - top);
  }
  // Gantry rails and the parked crab.
  ctx.strokeStyle = 'rgba(120,136,152,0.45)'; ctx.lineWidth = 3;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sgn * mouthW * 0.36, eave + h * 0.02);
    ctx.lineTo(cx + sgn * w * 0.46, eave + h * 0.055);
    ctx.stroke();
  }
  ctx.fillStyle = '#2a323b'; ctx.fillRect(cx - w * 0.05, eave + h * 0.015, w * 0.1, h * 0.028);
  // Slings hang from it.
  ctx.strokeStyle = 'rgba(150,164,178,0.5)'; ctx.lineWidth = 1.4;
  for (const off of [-w * 0.032, w * 0.032]) {
    ctx.beginPath(); ctx.moveTo(cx + off, eave + h * 0.043); ctx.lineTo(cx + off, eave + h * 0.105); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(196,186,150,0.45)'; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.032, eave + h * 0.105);
  ctx.quadraticCurveTo(cx, eave + h * 0.135, cx + w * 0.032, eave + h * 0.105);
  ctx.stroke();

  // ⚠ The slot fills most of the frame: the camera fits the hull row to the canvas width.
  const deckTop = horizon + h * 0.02, slotTop = w * 0.26, slotBot = w * 1.02;

  // The slot, before the decks so their fittings overhang it.
  ctx.beginPath();
  ctx.moveTo(cx - slotTop, deckTop); ctx.lineTo(cx + slotTop, deckTop);
  ctx.lineTo(cx + slotBot, h); ctx.lineTo(cx - slotBot, h); ctx.closePath();
  g = ctx.createLinearGradient(0, deckTop, 0, h);
  g.addColorStop(0, '#0a1a24'); g.addColorStop(1, '#06121a');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  const underA = 0.2 + night * 0.3;
  const pool = ctx.createRadialGradient(cx, h * 0.86, 4, cx, h * 0.86, w * 0.55);
  pool.addColorStop(0, 'rgba(120,200,206,' + underA.toFixed(3) + ')'); pool.addColorStop(1, 'rgba(120,200,206,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, deckTop, w, h - deckTop);
  // The open end throws daylight down the slot; at night the under-deck pool carries the room.
  const mouthLight = ctx.createLinearGradient(0, deckTop, 0, h);
  const mLA = 0.17 * (1 - night);
  mouthLight.addColorStop(0, rgbStr(pal.hor, mLA));
  mouthLight.addColorStop(0.45, rgbStr(pal.hor, mLA * 0.35));
  mouthLight.addColorStop(1, rgbStr(pal.hor, 0));
  ctx.fillStyle = mouthLight;
  ctx.beginPath();
  ctx.moveTo(cx - mouthW * 0.4, deckTop); ctx.lineTo(cx + mouthW * 0.4, deckTop);
  ctx.lineTo(cx + w * 0.30, h); ctx.lineTo(cx - w * 0.30, h); ctx.closePath(); ctx.fill();
  // Static ripple bands, widening toward the camera.
  ctx.strokeStyle = 'rgba(160,214,220,0.16)';
  for (let k = 1; k < 16; k++) {
    const f = Math.pow(k / 16, 1.7), y = deckTop + (h - deckTop) * f;
    ctx.lineWidth = 0.6 + f * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - (slotTop + (slotBot - slotTop) * f) * (0.6 + hash01(k) * 0.4), y);
    ctx.lineTo(cx + (slotTop + (slotBot - slotTop) * f) * (0.6 + hash01(k * 2.7) * 0.4), y);
    ctx.stroke();
  }
  ctx.restore();

  // ── The decks, either side of the slot ─────────────────────────────────────
  const deckQuad = (sgn) => {
    ctx.beginPath();
    ctx.moveTo(cx + sgn * slotTop, deckTop);
    ctx.lineTo(cx + sgn * w * 0.6, deckTop);
    ctx.lineTo(cx + sgn * w * 1.2, h);
    ctx.lineTo(cx + sgn * slotBot, h);
    ctx.closePath();
    const dg = ctx.createLinearGradient(0, deckTop, 0, h);
    dg.addColorStop(0, '#1a2026'); dg.addColorStop(1, '#0d1116');
    ctx.fillStyle = dg; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
    for (let k = 1; k < 9; k++) {
      const f = k / 9;
      ctx.beginPath();
      ctx.moveTo(cx + sgn * (slotTop + (w * 0.6 - slotTop) * f), deckTop);
      ctx.lineTo(cx + sgn * (slotBot + (w * 1.2 - slotBot) * f), h);
      ctx.stroke();
    }
    ctx.restore();
    // Rubbing strake, cleats and fenders on the slot edge.
    ctx.strokeStyle = 'rgba(70,84,96,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + sgn * slotTop, deckTop); ctx.lineTo(cx + sgn * slotBot, h); ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const f = (k + 0.5) / 6;
      const x = cx + sgn * (slotTop + (slotBot - slotTop) * f), y = deckTop + (h - deckTop) * f;
      ctx.fillStyle = 'rgba(148,162,176,0.55)';
      ctx.fillRect(x + sgn * 4, y - 2 - f * 4, 4 + f * 6, 2 + f * 4);
      const fr = 2 + f * 7;
      ctx.fillStyle = 'rgba(28,34,40,0.85)';
      ctx.beginPath(); ctx.ellipse(x - sgn * fr * 0.6, y + fr * 0.5, fr * 0.45, fr, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(120,136,152,0.35)'; ctx.lineWidth = Math.max(0.6, f * 1.2);
      ctx.beginPath(); ctx.moveTo(x + sgn * 2, y - f * 3); ctx.lineTo(x - sgn * fr * 0.6, y - fr * 0.4); ctx.stroke();
    }
    // Ladder into the water.
    {
      const f = 0.82;
      const x = cx + sgn * (slotTop + (slotBot - slotTop) * f), y = deckTop + (h - deckTop) * f;
      ctx.strokeStyle = 'rgba(160,176,190,0.5)'; ctx.lineWidth = 2;
      for (const off of [-7, 7]) {
        ctx.beginPath(); ctx.moveTo(x - sgn * 14 + off, y); ctx.lineTo(x - sgn * 26 + off, y + 26); ctx.stroke();
      }
      ctx.lineWidth = 1.6;
      for (let r = 0; r < 3; r++) {
        const t2 = r / 3;
        ctx.beginPath();
        ctx.moveTo(x - sgn * (14 + 12 * t2) - 7, y + 26 * t2);
        ctx.lineTo(x - sgn * (14 + 12 * t2) + 7, y + 26 * t2);
        ctx.stroke();
      }
    }
  };
  deckQuad(-1); deckQuad(1);

  // Cradles on the dry side.
  ctx.fillStyle = 'rgba(58,44,30,0.8)';
  for (let k = 0; k < 3; k++) {
    const f = 0.15 + k * 0.28, y = deckTop + (h - deckTop) * f;
    const x = cx - (slotTop + (slotBot - slotTop) * f) - w * (0.07 + f * 0.1);
    ctx.fillRect(x, y, w * (0.03 + f * 0.04), h * (0.02 + f * 0.03));
  }

  // Strip lights high under the roof.
  for (const t of [0.34, 0.5, 0.66]) {
    const lx = t * w, ly = eave + h * 0.008;
    const lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, w * 0.13);
    lg.addColorStop(0, 'rgba(198,222,236,' + (0.1 + night * 0.16).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(198,222,236,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = 'rgba(222,238,248,0.7)'; ctx.fillRect(lx - w * 0.035, ly, w * 0.07, 2.5);
  }
  const vg = ctx.createRadialGradient(cx, h * 0.55, Math.min(w, h) * 0.42, cx, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

// ── The truck depot ── Sodium wall floods (nothing hangs from the roof), an inspection pit, painted bays,
// lifter pods and drums. Shares drawOutsideWorld and the hazard stripe with the hangar.
function drawDepotBackdrop(ctx, w, h, { doorFrac = 0.5, sky } = {}) {
  const horizon = h * 0.46, floorTop = horizon, cx = w / 2;
  const night = sky?.night ?? 0;
  // A working depot is lit: the pit, gantry and hoist must be visible.
  // Back wall: block course under corrugated upper.
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#3a3836'); g.addColorStop(1, '#55544e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, horizon);
  ctx.strokeStyle = 'rgba(206,196,180,0.10)'; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, horizon * 0.62); ctx.stroke(); }
  ctx.fillStyle = 'rgba(24,24,26,0.22)'; ctx.fillRect(0, horizon * 0.62, w, horizon * 0.38);      // block course
  ctx.strokeStyle = 'rgba(180,176,168,0.10)';
  for (let y = horizon * 0.62; y < horizon; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Stencilled bay numbers.
  ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232,206,140,0.30)';
  ctx.fillText('02', w * 0.16, horizon * 0.52); ctx.fillText('03', w * 0.84, horizon * 0.52);
  ctx.textAlign = 'left';
  drawNoticeBoard(ctx, w * 0.06, horizon * 0.62, 34, 24);
  drawExtinguisher(ctx, w * 0.95, horizon * 0.74);

  // A roller shutter rolled up over a wide, short door.
  const doorW = w * doorFrac, doorH = horizon * 0.66, doorY = horizon - doorH;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - doorW * 0.44, horizon); ctx.lineTo(cx - doorW * 0.5, doorY);
  ctx.lineTo(cx + doorW * 0.5, doorY); ctx.lineTo(cx + doorW * 0.44, horizon);
  ctx.closePath(); ctx.clip();
  drawOutsideWorld(ctx, cx - doorW * 0.5, doorY, cx + doorW * 0.5, horizon, sky);
  ctx.restore();
  ctx.fillStyle = '#31363a'; ctx.fillRect(cx - doorW * 0.54, doorY - 13, doorW * 1.08, 13);        // shutter box
  ctx.strokeStyle = 'rgba(150,150,142,0.35)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = doorY - 13 + i * 3.2; ctx.beginPath(); ctx.moveTo(cx - doorW * 0.54, y); ctx.lineTo(cx + doorW * 0.54, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(28,30,32,0.8)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx - doorW * 0.5, doorY); ctx.lineTo(cx - doorW * 0.5, horizon);
  ctx.moveTo(cx + doorW * 0.5, doorY); ctx.lineTo(cx + doorW * 0.5, horizon); ctx.stroke();

  // Sodium wall floods throwing down the wall.
  for (const fx of [w * 0.12, w * 0.38, w * 0.62, w * 0.88]) {
    ctx.strokeStyle = 'rgba(120,120,112,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, horizon * 0.10); ctx.lineTo(fx, horizon * 0.20); ctx.stroke();
    ctx.fillStyle = '#4a4a44'; ctx.fillRect(fx - 9, horizon * 0.20, 18, 6);
    const R = w * 0.20 + night * 22;
    const lg = ctx.createRadialGradient(fx, horizon * 0.26, 2, fx, horizon * 0.26, R);
    lg.addColorStop(0, `rgba(255,214,146,${0.52 + night * 0.16})`); lg.addColorStop(0.55, 'rgba(255,206,124,0.16)'); lg.addColorStop(1, 'rgba(255,206,124,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(fx, horizon * 0.26, R, 0, 7); ctx.fill();
  }
  // Gantry beam and chain hoist.
  ctx.strokeStyle = 'rgba(96,94,88,0.9)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, horizon * 0.34); ctx.lineTo(w, horizon * 0.34); ctx.stroke();
  ctx.strokeStyle = 'rgba(70,70,66,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w * 0.34, horizon * 0.34); ctx.lineTo(w * 0.34, horizon * 0.52); ctx.stroke();
  ctx.fillStyle = '#5a4a2a'; ctx.fillRect(w * 0.34 - 5, horizon * 0.52, 10, 8);

  // Oil-dark floor with painted bays and spills.
  g = ctx.createLinearGradient(0, floorTop, 0, h);
  g.addColorStop(0, '#55504a'); g.addColorStop(1, '#332f2c');
  ctx.fillStyle = g; ctx.fillRect(0, floorTop, w, h - floorTop);
  ctx.strokeStyle = 'rgba(226,204,132,0.30)'; ctx.lineWidth = 2;
  for (const i of [-3, -1, 1, 3]) { ctx.beginPath(); ctx.moveTo(cx + i * w * 0.052, floorTop); ctx.lineTo(cx + i * w * 0.30, h); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(226,204,132,0.14)'; ctx.lineWidth = 1;
  for (const f of [0.3, 0.66]) { const y = floorTop + (h - floorTop) * f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  for (const [sx, sy, sr] of [[0.30, 0.80, 0.075], [0.62, 0.70, 0.05], [0.46, 0.92, 0.09]]) {
    const st = ctx.createRadialGradient(w * sx, h * sy, 1, w * sx, h * sy, w * sr);
    st.addColorStop(0, 'rgba(12,10,10,0.5)'); st.addColorStop(1, 'rgba(12,10,10,0)');
    ctx.fillStyle = st; ctx.beginPath(); ctx.ellipse(w * sx, h * sy, w * sr, w * sr * 0.42, 0, 0, 7); ctx.fill();
  }
  // The pit, off the parking bays, with a rail.
  const pitY = floorTop + (h - floorTop) * 0.34, pitH = (h - floorTop) * 0.26;
  ctx.beginPath();
  ctx.moveTo(w * 0.055, pitY + pitH); ctx.lineTo(w * 0.145, pitY); ctx.lineTo(w * 0.27, pitY); ctx.lineTo(w * 0.235, pitY + pitH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,10,11,0.92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(226,204,132,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  for (const px of [0.075, 0.255]) {   // the handrail stanchions down the near lip
    ctx.strokeStyle = 'rgba(150,150,142,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w * px, pitY + pitH); ctx.lineTo(w * px, pitY + pitH - 16); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(w * 0.075, pitY + pitH - 16); ctx.lineTo(w * 0.255, pitY + pitH - 16); ctx.stroke();

  drawHazardStripe(ctx, 0, h - (h - floorTop) * 0.08, w, (h - floorTop) * 0.05);
  // Yard clutter: spare lifter pods, drums, a charge post.
  drawPodStack(ctx, w * 0.055, h * 0.70);
  drawDrum(ctx, w * 0.16, h * 0.735, 9, '#6a5a24');
  drawDrum(ctx, w * 0.20, h * 0.75, 8, '#5a2a22');
  drawChargePost(ctx, w * 0.90, h * 0.72, night);
  const pool = ctx.createRadialGradient(cx, h * 0.88, 4, cx, h * 0.88, w * 0.55);
  pool.addColorStop(0, `rgba(255,216,156,${0.26 + night * 0.10})`); pool.addColorStop(0.5, 'rgba(255,214,150,0.10)'); pool.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, floorTop, w, h - floorTop);
  const vg = ctx.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.42, cx, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.20)');   // frames the bay; it used to close it in
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}
// Spare lifter pods on a pallet.
function drawPodStack(ctx, x, y) {
  ctx.fillStyle = '#4a4038'; ctx.fillRect(x - 4, y + 12, 46, 5);                       // pallet
  for (let i = 0; i < 3; i++) {
    const py = y + 8 - i * 9, pw = 38 - i * 3;
    ctx.fillStyle = i % 2 ? '#2e3338' : '#343a40';
    ctx.beginPath(); ctx.ellipse(x + 19, py, pw / 2, 5.5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(104,214,232,0.35)';                                        // the emitter band, still faintly live
    ctx.beginPath(); ctx.ellipse(x + 19, py + 2, pw / 2 - 3, 3.4, 0, 0.2, 2.94); ctx.stroke();
  }
}
// A charge post with its cable and a live indicator.
function drawChargePost(ctx, x, y, night = 0) {
  ctx.fillStyle = '#3c4248'; ctx.fillRect(x, y - 34, 14, 34);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 34, 14, 34);
  ctx.fillStyle = `rgba(120,226,240,${0.55 + night * 0.35})`; ctx.fillRect(x + 3, y - 30, 8, 5);
  ctx.strokeStyle = 'rgba(30,34,38,0.8)'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(x + 2, y - 20); ctx.quadraticCurveTo(x - 14, y - 12, x - 6, y - 2); ctx.stroke();
}

function drawHangarBackdrop(ctx, w, h, { tint, doorFrac = 0.34, sky } = {}) {
  const horizon = h * 0.46, floorTop = horizon, cx = w / 2;
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#2a343e'); g.addColorStop(1, '#3a4650');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, horizon);
  ctx.strokeStyle = 'rgba(200,216,230,0.16)'; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, horizon); ctx.stroke(); }
  drawNoticeBoard(ctx, w * 0.07, horizon * 0.28, 34, 24);
  drawExtinguisher(ctx, w * 0.93, horizon * 0.7);

  // Open bay door onto the live sky, edge-tinted by the pilot colour when given.
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
  // Overhead truss and hanging lamps.
  ctx.strokeStyle = 'rgba(150,168,184,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, horizon * 0.12); ctx.lineTo(w, horizon * 0.12); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const lx = w * (0.1 + i * 0.2);
    ctx.strokeStyle = 'rgba(150,168,184,0.4)'; ctx.beginPath(); ctx.moveTo(lx, horizon * 0.12); ctx.lineTo(lx, horizon * 0.3); ctx.stroke();
    const lg = ctx.createRadialGradient(lx, horizon * 0.3, 1, lx, horizon * 0.3, 22);
    lg.addColorStop(0, 'rgba(255,250,230,0.8)'); lg.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, horizon * 0.3, 22, 0, 7); ctx.fill();
  }
  // Floor grid converging on the door.
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
  // Hazard-striped inspection lane.
  drawHazardStripe(ctx, 0, h - (h - floorTop) * 0.1, w, (h - floorTop) * 0.045);
  drawClutterLeft(ctx, w, h, floorTop);
  drawClutterRight(ctx, w, h, floorTop);
  const pool = ctx.createRadialGradient(cx, h * 0.86, 4, cx, h * 0.86, w * 0.5);
  pool.addColorStop(0, 'rgba(230,238,246,0.28)'); pool.addColorStop(1, 'rgba(230,238,246,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, floorTop, w, h - floorTop);
  const vg = ctx.createRadialGradient(cx, h * 0.5, Math.min(w, h) * 0.45, cx, h * 0.5, Math.max(w, h) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

// ── Lived-in props (screen-space 2D, like the rest of the backdrop) ──
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
// Hazard stripe, sheared to sit flush with the floor grid.
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
  ctx.fillStyle = '#3a4a58'; ctx.fillRect(bx, by, 40, 22);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, 40, 22);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; for (const dy of [7, 14]) { ctx.beginPath(); ctx.moveTo(bx, by + dy); ctx.lineTo(bx + 40, by + dy); ctx.stroke(); }
  ctx.fillStyle = '#1a2026'; ctx.beginPath(); ctx.arc(bx + 7, by + 26, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(bx + 33, by + 26, 4, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(200,80,50,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(bx + 20, by - 24, 12, 0.2, 5.8); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx + 20, by - 24, 8, 0.2, 5.8); ctx.stroke();
}

// One hangar-floor bay: backdrop plus turntable, for the hangar cards and the bench hero shot.
export function drawHangarFloorBay(ctx, opts) {
  ctx.clearRect(0, 0, opts.w, opts.h);
  // `flat` skips the backdrop and leaves the canvas transparent.
  if (opts.floor3d) drawInspectBackdrop(ctx, opts.w, opts.h, opts.venue, opts.sky);   // walkaround inspect — a 3D floor, not the 2D room
  // The bench hero stands in the venue's own building.
  else if (opts.venue === 'garage' && !opts.flat) drawDepotBackdrop(ctx, opts.w, opts.h, { sky: opts.sky });
  else if (!opts.flat) drawHangarBackdrop(ctx, opts.w, opts.h, { tint: opts.tint, sky: opts.sky });
  // Returns the turntable's ground anchor for the caller's effects.
  return opts.cls ? paintTurntable(ctx, opts) : null;
}

// ── The paint booth ── A night garage stage: neon tubes, a wet reflective floor, a chrome turntable with a
// chasing ring and underglow. The platform sits on last frame's ground anchor. Any drawable class can stand on it.
const _boothAnchor = new WeakMap();
const BOOTH_NEON = ['64,220,255', '196,72,255', '255,60,170'];
function boothGlow(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return BOOTH_NEON[0];
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  // A dark or grey accent falls back to the house cyan.
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  if (hi < 90 || hi - lo < 40) return BOOTH_NEON[0];
  const k = 255 / hi;
  return `${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)}`;
}
const BOOTH_BUDGET_PX = 90_000;
export function drawPaintBooth(ctx, opts) {
  const { w, h } = opts, t = opts.time || 0;
  ctx.clearRect(0, 0, w, h);
  const hor = h * 0.56;
  // The back wall: near-black, bluing toward the floor.
  let g = ctx.createLinearGradient(0, 0, 0, hor);
  g.addColorStop(0, '#05060c'); g.addColorStop(0.7, '#0d1020'); g.addColorStop(1, '#171a30');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, hor);
  ctx.strokeStyle = 'rgba(120,140,200,0.07)'; ctx.lineWidth = 1;
  for (let y = hor * 0.18; y < hor; y += 7) { ctx.beginPath(); ctx.moveTo(w * 0.24, y); ctx.lineTo(w * 0.76, y); ctx.stroke(); }
  // Neon tubes with a slow buzz.
  const tube = (x0, y0, x1, y1, rgb, a) => {
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${rgb},${0.16 * a})`; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = `rgba(${rgb},${0.5 * a})`; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * a})`; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  };
  const buzz = (k) => 0.82 + 0.18 * Math.sin(t * (2.1 + k) + k * 1.7);
  const tubes = [
    [w * 0.1, hor * 0.2, w * 0.1, hor * 0.92, BOOTH_NEON[1], buzz(0)],
    [w * 0.9, hor * 0.2, w * 0.9, hor * 0.92, BOOTH_NEON[1], buzz(1)],
    [w * 0.26, hor * 0.12, w * 0.74, hor * 0.12, BOOTH_NEON[0], buzz(2)],
  ];
  for (const tb of tubes) tube(...tb);
  g = ctx.createLinearGradient(0, hor, 0, h);
  g.addColorStop(0, '#12142a'); g.addColorStop(1, '#040408');
  ctx.fillStyle = g; ctx.fillRect(0, hor, w, h - hor);
  ctx.strokeStyle = 'rgba(140,160,255,0.08)'; ctx.lineWidth = 1;
  for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.02, hor); ctx.lineTo(w / 2 + i * w * 0.16, h); ctx.stroke(); }
  for (let k = 1; k < 7; k++) { const y = hor + (h - hor) * (k / 7) ** 1.7; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [x0, , , , rgb, a] of tubes.slice(0, 2)) {
    const rg = ctx.createLinearGradient(0, hor, 0, h);
    rg.addColorStop(0, `rgba(${rgb},${0.3 * a})`); rg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = rg; ctx.fillRect(x0 - 5, hor, 10, h - hor);
  }
  ctx.restore();
  // The platform, on last frame's ground anchor.
  const an = _boothAnchor.get(ctx.canvas) || { sx: w / 2, sy: h * 0.66 };
  const R = Math.min(w * 0.4, h * 0.62), ry = R * 0.2;
  const glow = boothGlow(opts.livery?.accent || opts.livery?.trim);
  const disc = (r, fill) => { ctx.beginPath(); ctx.ellipse(an.sx, an.sy, r, r * ry / R, 0, 0, 7); ctx.fillStyle = fill; ctx.fill(); };
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.translate(an.sx, an.sy); ctx.scale(1, ry / R);
  const ug = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.6);
  const pulse = 0.85 + 0.15 * Math.sin(t * 1.6);
  ug.addColorStop(0, `rgba(${glow},${0.9 * pulse})`); ug.addColorStop(0.5, `rgba(${glow},${0.4 * pulse})`); ug.addColorStop(1, `rgba(${glow},0)`);
  ctx.fillStyle = ug; ctx.beginPath(); ctx.arc(0, 0, R * 1.6, 0, 7); ctx.fill();
  ctx.restore();
  disc(R * 1.04, 'rgba(0,0,0,0.55)');
  const dg = ctx.createLinearGradient(an.sx - R, 0, an.sx + R, 0);
  dg.addColorStop(0, '#15171f'); dg.addColorStop(0.5, '#3b3f4c'); dg.addColorStop(1, '#15171f');
  disc(R, dg);
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(220,228,246,0.9)';
  ctx.beginPath(); ctx.ellipse(an.sx, an.sy, R, ry, 0, 0, 7); ctx.stroke();
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * Math.PI * 2 + t * 0.6, x = an.sx + Math.cos(a) * R * 0.95, y = an.sy + Math.sin(a) * ry * 0.95;
    const on = (i + Math.floor(t * 10)) % 8 < 2;
    ctx.fillStyle = on ? `rgba(${glow},1)` : `rgba(${glow},0.25)`;
    ctx.beginPath(); ctx.arc(x, y, on ? 2.6 : 1.5, 0, 7); ctx.fill();
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [lw, a] of [[14, 0.14], [7, 0.3], [2.5, 0.7]]) {
    ctx.lineWidth = lw; ctx.strokeStyle = `rgba(${glow},${a * pulse})`;
    ctx.beginPath(); ctx.ellipse(an.sx, an.sy + 2, R * 1.02, ry * 1.02, 0, 0, Math.PI); ctx.stroke();
  }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.14; disc(R * 0.7, 'rgba(200,210,255,0.4)'); ctx.restore();
  // The vehicle, on a tighter raster budget: a spinning model never shows the lost supersampling.
  const res = drawHangarFloorBayOnto(ctx, { ...opts, flat: true, yaw: (opts.spin ?? t * 0.35) + (opts.yaw || 0), elev: opts.elev ?? 0.28, zoom: opts.zoom ?? 1.2, budget: opts.budget ?? BOOTH_BUDGET_PX });
  if (res?.ground) _boothAnchor.set(ctx.canvas, { sx: res.ground.sx, sy: res.ground.sy });
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [fx, rgb] of [[0.06, BOOTH_NEON[2]], [0.94, BOOTH_NEON[0]]]) {
    const sx = w * fx, cg = ctx.createLinearGradient(sx, 0, an.sx, an.sy);
    cg.addColorStop(0, `rgba(${rgb},0.2)`); cg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(sx - 10, 0); ctx.lineTo(sx + 10, 0); ctx.lineTo(an.sx + R * 0.5, an.sy); ctx.lineTo(an.sx - R * 0.5, an.sy); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  const vg = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}
// Like drawHangarFloorBay without the clear.
function drawHangarFloorBayOnto(ctx, opts) { return opts.cls ? paintTurntable(ctx, opts) : null; }

// ── The hangar floor ── One shared camera over a row of craft in the same room.
// `entries = [{ id, cls, livery, wreck, tint, label }]`; returns hit records for click-to-select.
// pickSceneHit: the nearest silhouette box wins; footprint circles are the fallback.
export function pickSceneHit(hits, x, y) {
  let best = null, bestZ = Infinity;
  for (const h of hits) {
    if (h.x0 === undefined) continue;
    if (x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1) continue;
    const z = h.z ?? 0;
    if (z < bestZ) { bestZ = z; best = h; }
  }
  if (best) return best;
  let bd = Infinity;
  for (const h of hits) {
    const d = Math.hypot(x - h.sx, y - h.sy);
    if (d <= (h.r || 40) && d < bd) { bd = d; best = h; }
  }
  return best;
}

export function drawHangarScene(ctx, { w, h, entries, selId, sky, venue = null }) {
  ctx.clearRect(0, 0, w, h);
  const n = entries.length;
  if (venue === 'helipad') drawHelipadBackdrop(ctx, w, h, { sky });
  else if (venue === 'dock') drawDockBackdrop(ctx, w, h, { doorFrac: Math.min(0.9, 0.4 + n * 0.12), sky });
  else if (venue === 'garage') drawDepotBackdrop(ctx, w, h, { doorFrac: Math.min(0.9, 0.5 + n * 0.05), sky });
  else drawHangarBackdrop(ctx, w, h, { doorFrac: Math.min(0.86, 0.34 + n * 0.05), sky });
  if (!n) return [];

  const E = 0.34, cosE = Math.cos(E), sinE = Math.sin(E);
  const camYaw = 0.5, cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  // Real per-craft size, then fit the camera to the row.
  const scales = entries.map(e => MODEL_SCALE[e.cls] || 1);
  const maxSc = Math.max(...scales);
  // Build each model once and fit to its real bounds (a truck is a fifth of an airframe).
  const models = entries.map(e => (e.wreck ? wreckFaces() : aircraftFaces(e.cls, 1, !!e.armed, e.variant || '')).map(poseAtRest));
  const bounds = models.map((faces, i) => {
    const s = scales[i];
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const f of faces) for (const v of f.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k] * s); hi[k] = Math.max(hi[k], v[k] * s); }
    if (lo[0] > hi[0]) { lo = [-1.2 * s, -1.1 * s, -0.35 * s]; hi = [1.2 * s, 1.1 * s, 0.62 * s]; }
    return { lo, hi };
  });
  // Lane pitch is fixed within a floor but measured off the widest thing there (aircraft keep 2.6).
  const maxW = Math.max(...bounds.map(b => b.hi[1] - b.lo[1]));
  const spacing = Math.min(2.6, Math.max(0.6, maxW * 1.9));
  const laneOf = (i) => (i - (n - 1) / 2) * spacing;
  const spread = (n - 1) / 2 * spacing;
  // Stand-back distance scales with size too, or a small truck is shot on a long lens. Aircraft keep their distance.
  const maxSpan = Math.max(...bounds.map(b => Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1])));
  const fitK = clampN(maxSpan / 2.2, 0.4, 1);
  const camDist = (3.1 + maxSc * 0.85) * fitK + spread * 0.32;
  const ox = w / 2, oy = h * 0.6;
  // Fit the focal to every craft's projected bounding box.
  const rel = (F, G, H) => { const fx = F * cy - G * sy, gy = F * sy + G * cy; const camY = H * cosE - fx * sinE, camZ = fx * cosE + H * sinE; const z = Math.max(0.3, camDist - camZ); return { x: gy / z, y: camY / z }; };
  let exX = 1e-3, exTop = 1e-3, exBot = 1e-3;
  entries.forEach((e, i) => {
    const g0 = laneOf(i), { lo, hi } = bounds[i];
    for (const F of [lo[0], hi[0]]) for (const G of [g0 + lo[1], g0 + hi[1]]) for (const H of [lo[2], hi[2]]) {
      const r = rel(F, G, H);
      exX = Math.max(exX, Math.abs(r.x));
      if (r.y > 0) exTop = Math.max(exTop, r.y); else exBot = Math.max(exBot, -r.y);
    }
  });
  const focal = clampN(Math.min((0.46 * w) / exX, (oy - 0.06 * h) / exTop, (0.94 * h - oy) / exBot),
    0.45 * Math.min(w, h), 2.6 * Math.min(w, h));
  const Ln = Math.hypot(-0.25, -0.45, 0.86), lx = -0.25 / Ln, ly = -0.45 / Ln, lz = 0.86 / Ln;
  // Project a room-space point; G carries the lane offset.
  const proj = (F, G, H) => {
    const fx = F * cy - G * sy, gy = F * sy + G * cy, hz = H;
    const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;
    const z = camDist - camZ;
    // `gz` is depth without the camera elevation, the ground-plane key sortTruckFaces uses.
    return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z, gz: camDist - fx * cosE, wx: fx, wy: gy, wz: hz };
  };
  const eyeW = [camDist * cosE, 0, camDist * sinE];   // the shared camera in (fx,gy,hz) space, for backface culling

  const hits = [];
  const groups = entries.map((e, i) => {
    const laneG = (i - (n - 1) / 2) * spacing;
    const sc = scales[i];   // real relative size — a Cessna parks much smaller than a Twin Otter
    const faces = models[i];
    // Taildraggers park nose-high, as on the turntable.
    const gpr = e.wreck ? 0 : groundPitchFor(e.cls, !!e.armed) * Math.PI / 180;
    const cgp = Math.cos(gpr), sgp = Math.sin(gpr);
    const tilt = gpr ? (v) => [v[0] * cgp - v[2] * sgp, v[1], v[0] * sgp + v[2] * cgp] : null;
    const pal = liveryPalette(e.livery || {}, e.cls, !!e.armed);
    const jazzImg = (!e.wreck && pal.pat === 'jazz') ? jazzTex(e.livery?.base, e.livery?.trim, e.livery?.accent, e.livery?.ground) : null;
    const roll = e.wreck ? -0.22 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
    const selected = e.id === selId;
    const cen = proj(0, laneG, 0);   // this plane's own centre in normal-space (its lane, not the origin) — for backface culling
    // A model point through exactly its vertices' transform.
    const projModelPoint = (v0) => {
      const v = tilt ? tilt(v0) : v0;
      const vy = v[1] * sc, vz = v[2] * sc;
      return proj(v[0] * sc, laneG + vy * cro - vz * sro, vy * sro + vz * cro);
    };
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
      // Newell's method (see paintTurntable).
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < P.length; i++) {
        const c = P[i], d = P[(i + 1) % P.length];
        nx += (c.wy - d.wy) * (c.wz + d.wz); ny += (c.wz - d.wz) * (c.wx + d.wx); nz += (c.wx - d.wx) * (c.wy + d.wy);
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      // Backface cull against the plane's own lane centre, or ⚠ a box's own `cen` (see paintTurntable).
      const solidCen = face.cen ? projModelPoint(face.cen) : null;
      if (solidCen || CULL_ROLE.has(face.role)) {
        let cx = 0, cy2 = 0, cz2 = 0; for (const q of P) { cx += q.wx; cy2 += q.wy; cz2 += q.wz; }
        const m = P.length; cx /= m; cy2 /= m; cz2 /= m;
        const ref = solidCen || cen;
        const dx = cx - ref.wx, dy = cy2 - ref.wy, dz = cz2 - ref.wz;
        // ⚠ No confident outward along the normal, no cull (see paintTurntable).
        if (solidCen && Math.abs(nx * dx + ny * dy + nz * dz) / nl <= 1e-4) { /* two-sided: no confident outward */ }
        else {
          const out = (nx * dx + ny * dy + nz * dz) < 0 ? -1 : 1;   // flip normal to point away from that centre
          if (out * (nx * (eyeW[0] - cx) + ny * (eyeW[1] - cy2) + nz * (eyeW[2] - cz2)) <= 0) continue;
        }
      }
      const light = 0.62 + 0.5 * Math.abs((nx * lx + ny * ly + nz * lz) / nl);
      let rgb = faceBaseRgb(face, pal);
      if (e.wreck) rgb = mix3(rgb, [74, 72, 66], 0.55);
      let z = 0; for (const q of P) z += q.z;
      let nf = Infinity, xf = -Infinity, hf = Infinity;
      for (const q of P) { if (q.z < nf) nf = q.z; if (q.z > xf) xf = q.z; if (q.gz != null && q.gz < hf) hf = q.gz; }
      const avgZf = z / P.length;
      // ⚠ Shade kept both ways, as in paintTurntable.
      const shk = face.sh * pal.fmul * light * (selected ? 1.12 : 1) * (e.wreck ? 0.8 : 1);
      const rv = [clampN(rgb[0] * shk, 0, 255) | 0, clampN(rgb[1] * shk, 0, 255) | 0, clampN(rgb[2] * shk, 0, 255) | 0];
      const rec = { P, role: face.role, avgZ: avgZf, part: face.part, nf, xf, hf: hf === Infinity ? null : hf, af: avgZf, i: drawn.length, rv, col: shadeRgb(rgb, shk) };
      if (jazzImg && JAZZ_ROLE.has(face.role)) rec.uv = face.p.map(v => jazzUV(v, face.role));
      if (face.uv) { rec.cuv = face.uv; rec.cart = face.art; }      // canopy art: UVs + style authored on the mesh
      drawn.push(rec);
    }
    const origin = proj(0.2, laneG, 0);
    // Click circle sized to the machine.
    const bb = bounds[i], half = Math.max(bb.hi[0] - bb.lo[0], bb.hi[1] - bb.lo[1]) * 0.25;
    // Real target: the silhouette's screen box, plus a footprint circle sized to the machine as a fallback.
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const rec of drawn) for (const q of rec.P) {
      if (q.sx < bx0) bx0 = q.sx; if (q.sx > bx1) bx1 = q.sx;
      if (q.sy < by0) by0 = q.sy; if (q.sy > by1) by1 = q.sy;
    }
    const hit = { id: e.id, sx: origin.sx, sy: origin.sy, z: origin.z, r: Math.max(26, focal / origin.z * half) };
    if (bx0 < bx1) { hit.x0 = bx0; hit.y0 = by0; hit.x1 = bx1; hit.y1 = by1; }
    hits.push(hit);
    return { entry: e, faces: drawn.filter(Boolean), avgZ: proj(0, laneG, 0).z, laneG, origin, selected, sc, jazzImg, tilt };
  });

  // Sort whole craft far to near, then faces within each.
  groups.sort((a, b) => b.avgZ - a.avgZ);
  ctx.lineJoin = 'round';
  for (const grp of groups) {
    // Spotlight under the selected craft (or the CHARTER Mule's tint).
    if (grp.selected || grp.entry.tint) {
      const col = grp.entry.tint ? (hex2rgb(grp.entry.tint) || [79, 184, 224]) : [143, 208, 255];
      const spotR = Math.max(50, Math.min(140, (focal / grp.origin.z) * 0.5));
      const ring = ctx.createRadialGradient(grp.origin.sx, grp.origin.sy + 8, 2, grp.origin.sx, grp.origin.sy + 8, spotR);
      ring.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.4)`); ring.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(grp.origin.sx, grp.origin.sy + 8, spotR, 0, 7); ctx.fill();
    }
    // Each machine goes through the shared depth pass on its own (lanes never interpenetrate); the row stays far to near.
    // The sort is the fallback (the lamp smoke forces it via model-raster's `_setBlitEnabled`). Hysteresis is keyed per
    // entry and per mesh, because part ids repeat across variants.
    const faces = grp.faces;
    if (!grp.entry.wreck) pushParkedRotorFaces(faces, grp.entry.cls, !!grp.entry.armed, 1.9 + grp.laneG * 0.6,
      (v0) => { const v = grp.tilt ? grp.tilt(v0) : v0; return proj(v[0] * grp.sc, grp.laneG + v[1] * grp.sc, v[2] * grp.sc); }, 0.15);
    // The raster budget is shared across the row.
    const rasterOK = modelDepthPass(ctx, faces, { min: RASTER_MIN_PX, budget: RASTER_BUDGET_PX / Math.max(1, n) });
    if (!rasterOK) {
      if (grp.entry.cls === 'truck') sortTruckFaces(faces, { id: `lot:${grp.entry.id}:${grp.entry.variant || ''}` }, 1);
      else faces.sort((a, b) => b.avgZ - a.avgZ);
    }
    for (const fc of faces) {
      if (rasterOK && !fc.seen) continue;                 // hidden: its detail would paint over the winner
      ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
      for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
      ctx.closePath();
      if (!rasterOK || fc.offBuf) { ctx.fillStyle = fc.col; ctx.fill(); }   // …except the translucent faces the buffer refused — see modelDepthPass
      if (fc.uv) overlayJazz(ctx, fc.P, fc.uv, grp.jazzImg);   // Memphis splatter (same body-space map as the turntable)
      if (fc.cuv) drawCanopyGlass(ctx, fc.P, fc.cuv, fc.cart);  // greenhouse art (same authored map as the turntable)
      if (!grp.entry.wreck && (fc.role === 'glass' || fc.role === 'window')) glassSheen(ctx, fc.P);   // glassy specular on canopy/windows
      // ⚠ No outline over a depth-buffered model (see paintTurntable).
      if (!rasterOK) { ctx.strokeStyle = 'rgba(8,10,14,0.5)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // Outline the selected craft, only when there's more than one.
    if (grp.selected && n > 1) {
      for (const fc of faces) {
        if (rasterOK && !fc.seen) continue;   // a highlight on a face that lost the depth test is a line through the bodywork
        if (fc.role === 'body' || fc.role === 'wing') {
          ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
          for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
          ctx.closePath();
          ctx.strokeStyle = 'rgba(143,208,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
    }
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
