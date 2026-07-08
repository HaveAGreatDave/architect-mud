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
export function drawTurntable(ctx, opts) {
  ctx.clearRect(0, 0, opts.w, opts.h);
  paintTurntable(ctx, opts);
}

// The turntable's paint step alone, with NO clear — so a caller that's already
// painted a backdrop into the canvas (drawHangarFloorBay below) can draw the plane
// on top of it in the same pass instead of the model wiping the scene behind it.
function paintTurntable(ctx, { cls, livery, yaw = 0, w, h, wreck = false, zoom = 1 }) {
  const faces = wreck ? buildWreck() : aircraftFaces(cls);
  const pal = liveryPalette(livery || {});
  const E = 0.42, cosE = Math.cos(E), sinE = Math.sin(E);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const roll = wreck ? -0.26 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
  const camDist = 3.5, focal = Math.min(w, h) * 1.75 * zoom, ox = w / 2, oy = h * 0.52;
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
  drawHangarBackdrop(ctx, opts.w, opts.h, { tint: opts.tint, sky: opts.sky });
  if (opts.cls) paintTurntable(ctx, opts);
}

// ── The hangar FLOOR: one continuous 3D room, every craft parked in it ────────
// A single shared camera (not one camera per plane) looks across a raked showroom
// row: each entry sits at its own lateral offset in the SAME world space, so
// they're genuinely side-by-side in one hangar rather than a strip of independent
// thumbnails. `entries = [{ id, cls, livery, wreck, tint, label }]`. Returns the
// screen-space hit circle for each entry so the caller can do click-to-select on
// the one canvas (there's no per-plane DOM element to attach a listener to).
export function drawHangarScene(ctx, { w, h, entries, selId, sky }) {
  ctx.clearRect(0, 0, w, h);
  const n = entries.length;
  drawHangarBackdrop(ctx, w, h, { doorFrac: Math.min(0.8, 0.34 + n * 0.05), sky });
  if (!n) return [];

  const E = 0.34, cosE = Math.cos(E), sinE = Math.sin(E);
  const camYaw = 0.5, cy = Math.cos(camYaw), sy = Math.sin(camYaw);
  const spacing = 2.05;
  const camDist = 3.4 + n * 0.62;
  const focal = Math.min(w, h) * Math.max(0.85, 1.55 - n * 0.045);
  const ox = w / 2, oy = h * 0.6;
  const Ln = Math.hypot(-0.25, -0.45, 0.86), lx = -0.25 / Ln, ly = -0.45 / Ln, lz = 0.86 / Ln;
  // Project a point in ROOM space (F,G,H) — G carries the row's lateral spread.
  const proj = (F, G, H) => {
    const fx = F * cy - G * sy, gy = F * sy + G * cy, hz = H;
    const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;
    const z = camDist - camZ;
    return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z, wx: fx, wy: gy, wz: hz };
  };

  const hits = [];
  const groups = entries.map((e, i) => {
    const laneG = (i - (n - 1) / 2) * spacing;
    const faces = e.wreck ? buildWreck() : aircraftFaces(e.cls);
    const pal = liveryPalette(e.livery || {});
    const roll = e.wreck ? -0.22 : 0, cro = Math.cos(roll), sro = Math.sin(roll);
    const selected = e.id === selId;
    const drawn = [];
    for (const face of faces) {
      const P = face.p.map(v => {
        const g1 = v[1] * cro - v[2] * sro, h1 = v[1] * sro + v[2] * cro;   // static wreck roll
        return proj(v[0], laneG + g1, h1);
      });
      if (P.some(q => q.z <= 0.15)) continue;   // skip just this FACE, not the whole plane
      const a = [P[1].wx - P[0].wx, P[1].wy - P[0].wy, P[1].wz - P[0].wz];
      const b = [P[2].wx - P[0].wx, P[2].wy - P[0].wy, P[2].wz - P[0].wz];
      let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      const light = 0.62 + 0.5 * Math.abs((nx * lx + ny * ly + nz * lz) / nl);
      let rgb = faceBaseRgb(face.role, pal);
      if (e.wreck) rgb = mix3(rgb, [74, 72, 66], 0.55);
      let z = 0; for (const q of P) z += q.z;
      drawn.push({ P, role: face.role, avgZ: z / P.length, col: shadeRgb(rgb, face.sh * pal.fmul * light * (selected ? 1.12 : 1) * (e.wreck ? 0.8 : 1)) });
    }
    const origin = proj(0.2, laneG, 0);
    hits.push({ id: e.id, sx: origin.sx, sy: origin.sy, r: Math.max(26, focal / origin.z * 0.55) });
    return { entry: e, faces: drawn.filter(Boolean), avgZ: proj(0, laneG, 0).z, laneG, origin, selected };
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
      if (fc.role === 'rotor') {
        ctx.globalAlpha = 0.26; ctx.fillStyle = fc.col; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(180,200,220,0.25)'; ctx.lineWidth = 1; ctx.stroke(); continue;
      }
      ctx.fillStyle = fc.col; ctx.fill();
      ctx.strokeStyle = 'rgba(8,10,14,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
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
