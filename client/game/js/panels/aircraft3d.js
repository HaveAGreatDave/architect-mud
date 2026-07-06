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
  return { base, trim, fmul: FINISH_MUL[lv.finish] ?? 1.0, pat };
}
function faceIsTrim(role, pat) {
  if (role === 'fin' || role === 'nacelle' || role === 'rotor') return true;
  if (pat === 'twotone' && (role === 'wing' || role === 'stab')) return true;
  if (pat === 'stripes' && role === 'stab') return true;
  return false;
}
// Raw (pre-shade) rgb for a face. Glass reads as dark canopy regardless of livery.
export function faceBaseRgb(role, pal) {
  if (role === 'glass') return [14, 26, 36];
  return faceIsTrim(role, pal.pat) ? pal.trim : pal.base;
}

// ── Geometry ────────────────────────────────────────────────────────────────────
const V = (f, g, h) => [f, g, h];

// A parametric fixed-wing: a lozenge fuselage (nose tip → mid ring → tail tip),
// swept wings with dihedral, tailplane, one or two vertical fins, engine nacelles,
// and a canopy. Every knob mirrors the old top-down silhouette proportions.
function buildFixedWing(p) {
  const faces = [];
  const T = V(0, 0, p.fv), R = V(0, p.fr, 0), B = V(0, 0, -p.fv), L = V(0, -p.fr, 0);
  const N = V(p.noseF, 0, 0.02), X = V(p.tailF, 0, 0.05);
  const bodyRing = [
    { p: [N, T, R], sh: 0.98 }, { p: [N, R, B], sh: 0.82 }, { p: [N, B, L], sh: 0.62 }, { p: [N, L, T], sh: 0.82 },
    { p: [X, R, T], sh: 0.98 }, { p: [X, B, R], sh: 0.82 }, { p: [X, L, B], sh: 0.62 }, { p: [X, T, L], sh: 0.82 },
  ];
  for (const f of bodyRing) faces.push({ p: f.p, role: 'body', sh: f.sh });
  // Wings (+ optional dihedral), swept.
  for (const s of [1, -1]) {
    faces.push({ role: 'wing', sh: 0.82, p: [
      V(p.wRootF, s * p.fr * 0.7, -0.01), V(p.wTipF, s * p.span, p.dih),
      V(p.wTipB, s * p.span, p.dih), V(p.wRootB, s * p.fr * 0.7, -0.01)] });
  }
  // Horizontal stabiliser.
  for (const s of [1, -1]) {
    faces.push({ role: 'stab', sh: 0.72, p: [
      V(p.hF, s * p.fr * 0.5, 0.04), V(p.hTipF, s * p.hSpan, 0.05),
      V(p.hTipB, s * p.hSpan, 0.05), V(p.hB, s * p.fr * 0.5, 0.04)] });
  }
  // Vertical fin(s).
  for (const fg of (p.fins || [0])) {
    faces.push({ role: 'fin', sh: 0.9, p: [V(p.finF0, fg, 0.05), V(p.finF1, fg, p.finH), V(p.finF2, fg, 0.06)] });
  }
  // Engine nacelles (short tubes) under/at each engine station.
  for (const g of (p.engines || [])) {
    const nf = p.nacF, nr = 0.05, hc = p.nacH;
    const rT = V(nf, g, hc + nr), rR = V(nf, g + nr, hc), rB = V(nf, g, hc - nr), rL = V(nf, g - nr, hc);
    const fr = V(nf + 0.15, g, hc), bk = V(nf - 0.16, g, hc);
    for (const [a, b] of [[rT, rR], [rR, rB], [rB, rL], [rL, rT]]) {
      faces.push({ role: 'nacelle', sh: 0.8, p: [fr, a, b] });
      faces.push({ role: 'nacelle', sh: 0.7, p: [bk, b, a] });
    }
  }
  // Canopy glass just aft of the nose.
  faces.push({ role: 'glass', sh: 0.9, p: [
    V(p.noseF - 0.15, 0.06, p.fv * 0.6), V(p.noseF - 0.45, 0.09, p.fv * 0.95),
    V(p.noseF - 0.45, -0.09, p.fv * 0.95), V(p.noseF - 0.15, -0.06, p.fv * 0.6)] });
  return faces;
}

// A light rotorcraft: fat stubby cabin, tapering tail boom, tail fin + rotor, skids,
// and a translucent main-rotor disc with a hub.
function buildHeli() {
  const faces = [];
  const T = V(0.15, 0, 0.2), R = V(0.15, 0.22, 0), B = V(0.15, 0, -0.2), L = V(0.15, -0.22, 0);
  const N = V(0.62, 0, 0.0), M = V(-0.15, 0, 0.05);
  for (const [tri, sh] of [
    [[N, T, R], 0.98], [[N, R, B], 0.82], [[N, B, L], 0.62], [[N, L, T], 0.82],
    [[M, R, T], 0.95], [[M, B, R], 0.82], [[M, L, B], 0.62], [[M, T, L], 0.82]]) {
    faces.push({ role: 'body', sh, p: tri });
  }
  // Tail boom (thin taper) → tail tip.
  const bT = V(-0.15, 0, 0.11), bR = V(-0.15, 0.05, 0.06), bB = V(-0.15, 0, 0.01), bL = V(-0.15, -0.05, 0.06);
  const bTip = V(-1.0, 0, 0.12);
  for (const [a, b] of [[bT, bR], [bR, bB], [bB, bL], [bL, bT]]) faces.push({ role: 'body', sh: 0.78, p: [bTip, a, b] });
  // Tail fin + tail rotor.
  faces.push({ role: 'fin', sh: 0.9, p: [V(-0.9, 0, 0.10), V(-1.0, 0, 0.36), V(-1.06, 0, 0.10)] });
  faces.push({ role: 'rotor', sh: 0.7, p: [V(-0.98, 0.06, 0.12), V(-1.06, 0.06, 0.30), V(-1.1, 0.06, 0.12), V(-1.02, 0.06, -0.06)] });
  // Skids.
  for (const s of [1, -1]) {
    faces.push({ role: 'body', sh: 0.5, p: [V(0.36, s * 0.2, -0.28), V(-0.05, s * 0.2, -0.28), V(-0.05, s * 0.2, -0.24), V(0.36, s * 0.2, -0.24)] });
  }
  // Main-rotor disc (octagon) + hub.
  const disc = [], cf = 0.1, cz = 0.5, rad = 1.05;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc.push(V(cf + Math.cos(a) * rad, Math.sin(a) * rad, cz)); }
  faces.push({ role: 'rotor', sh: 0.65, p: disc });
  const hb = 0.08;
  faces.push({ role: 'nacelle', sh: 0.9, p: [V(cf + hb, 0, cz + hb), V(cf, hb, cz), V(cf - hb, 0, cz + hb)] });
  return faces;
}

// Per-class fixed-wing parameters (normalised units).
const FW_DEFAULT = {
  noseF: 1.05, tailF: -1.05, fr: 0.12, fv: 0.12, span: 0.95,
  wRootF: 0.30, wRootB: -0.05, wTipF: 0.14, wTipB: -0.02, dih: 0.05,
  hF: -0.80, hB: -1.02, hTipF: -0.86, hTipB: -1.04, hSpan: 0.40,
  finF0: -0.74, finF1: -0.98, finF2: -1.06, finH: 0.50, fins: [0],
  engines: [-0.24, 0.24], nacF: -0.02, nacH: -0.02,
};
const FW_PARAMS = {
  prop: FW_DEFAULT,
  ultralight: { ...FW_DEFAULT, fr: 0.08, fv: 0.085, span: 1.05, noseF: 0.92, tailF: -0.92, dih: 0.09, finH: 0.42, engines: [] },
  gunship: { ...FW_DEFAULT, fr: 0.15, fv: 0.14, span: 0.82, noseF: 0.98, tailF: -1.0, hSpan: 0.34,
    engines: [-0.30, 0.30], nacF: -0.55, nacH: 0.11, fins: [-0.22, 0.22], finF0: -0.80, finF1: -1.0, finF2: -1.08, finH: 0.40 },
  heavy: { ...FW_DEFAULT, fr: 0.18, fv: 0.16, span: 1.02, noseF: 1.15, tailF: -1.15, hSpan: 0.46, finH: 0.62,
    engines: [-0.36, -0.19, 0.19, 0.36], nacF: 0.05, nacH: -0.08 },
};

// Faces for a class (memoised — geometry is static).
const _cache = {};
export function aircraftFaces(cls) {
  if (_cache[cls]) return _cache[cls];
  const faces = cls === 'heli' ? buildHeli() : buildFixedWing(FW_PARAMS[cls] || FW_PARAMS.prop);
  _cache[cls] = faces;
  return faces;
}
// A wreck: the prop hull minus its right wing, both fins, and canopy — a stripped carcass.
function buildWreck() {
  if (_cache.wreck) return _cache.wreck;
  const faces = buildFixedWing(FW_PARAMS.prop).filter(f =>
    f.role !== 'glass' && f.role !== 'fin' && !(f.role === 'wing' && f.p.some(v => v[1] < 0)));
  _cache.wreck = faces;
  return faces;
}

// ── Turntable renderer (hangar hero view) ─────────────────────────────────────
// Draws the model into a 2D canvas on a fixed ¾ perspective camera (elevated, looking
// down the nose), spun about the vertical axis by `yaw`. Faces are depth-sorted
// (painter's), lit by a soft key light, and painted in the livery. A wreck slumps into
// a static bank and desaturates.
export function drawTurntable(ctx, { cls, livery, yaw = 0, w, h, wreck = false }) {
  ctx.clearRect(0, 0, w, h);
  const faces = wreck ? buildWreck() : aircraftFaces(cls);
  const pal = liveryPalette(livery || {});
  const E = 0.42, cosE = Math.cos(E), sinE = Math.sin(E);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const roll = wreck ? -0.26 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
  const camDist = 3.5, focal = Math.min(w, h) * 1.75, ox = w / 2, oy = h * 0.52;
  const Ln = Math.hypot(-0.25, -0.45, 0.86), lx = -0.25 / Ln, ly = -0.45 / Ln, lz = 0.86 / Ln;
  const proj = (f, g, hh) => {
    const g1 = g * cro - hh * sro, h1 = g * sro + hh * cro;              // static wreck roll
    const fx = f * cy - g1 * sy, gy = f * sy + g1 * cy, hz = h1;         // yaw about up
    const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;    // ¾ camera tilt
    const z = camDist - camZ;
    return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z, wx: fx, wy: gy, wz: hz };
  };
  const drawn = [];
  for (const face of faces) {
    const P = face.p.map(v => proj(v[0], v[1], v[2]));
    if (P.some(q => q.z <= 0.15)) continue;
    const a = [P[1].wx - P[0].wx, P[1].wy - P[0].wy, P[1].wz - P[0].wz];
    const b = [P[2].wx - P[0].wx, P[2].wy - P[0].wy, P[2].wz - P[0].wz];
    let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    const light = 0.52 + 0.48 * Math.abs((nx * lx + ny * ly + nz * lz) / nl);
    let rgb = faceBaseRgb(face.role, pal);
    if (wreck) rgb = mix3(rgb, [74, 72, 66], 0.55);
    let z = 0; for (const q of P) z += q.z;
    drawn.push({ P, role: face.role, avgZ: z / P.length, col: shadeRgb(rgb, face.sh * pal.fmul * light * (wreck ? 0.8 : 1)) });
  }
  drawn.sort((a, b) => b.avgZ - a.avgZ);
  ctx.lineJoin = 'round';
  for (const fc of drawn) {
    ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy);
    for (let i = 1; i < fc.P.length; i++) ctx.lineTo(fc.P[i].sx, fc.P[i].sy);
    ctx.closePath();
    if (fc.role === 'rotor') {
      ctx.globalAlpha = 0.26; ctx.fillStyle = fc.col; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(180,200,220,0.25)'; ctx.lineWidth = 1; ctx.stroke(); continue;
    }
    ctx.fillStyle = fc.col; ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,14,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    if (!wreck && livery?.finish === 'gloss' && fc.role === 'body') {
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fc.P[0].sx, fc.P[0].sy); ctx.lineTo(fc.P[1].sx, fc.P[1].sy); ctx.stroke(); ctx.restore();
    }
  }
}
