// WIREFRAME PLANE — CRT/terminal-style renders of an aircraft (dealer buy/rent,
// insurance) that want a schematic read rather than the realistic shaded 3D
// model those screens deliberately don't use (see aircraft3d.js — the hangar
// floor/bench's "real" turntable render, left untouched by this file on purpose).
import { aircraftFaces, groundPitchFor, visorHidden } from './aircraft3d.js';

// Canvas fillStyle/strokeStyle can't resolve CSS custom properties itself (var()
// is a CSSOM-cascade feature, not something the 2D context parses) — so any CRT
// canvas that wants to follow the player's chosen theme has to read the resolved
// value out of the DOM once per draw and hand the concrete color string to canvas.
export function themeColor(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

// ── True 3D wireframe — the actual aircraft3d.js face geometry, projected
// through the same ¾ turntable camera the real hangar model uses, but stroked
// as hollow edges instead of shaded/filled faces. Farther edges fade (a cheap
// x-ray depth cue) rather than being hidden, so the whole airframe reads through
// itself like a real technical drawing. `yaw` (radians) spins it in place —
// callers animate this every frame for the "alive" showroom feel.
export function drawWireframe3D(ctx, { cls, armed = false, w, h, accent = '#39ff9e', yaw = 0, glow = true }) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const faces = aircraftFaces(cls, 1, armed);
  // Taildraggers render nose-high (their 3-point sit) on the schematic too.
  const gp = groundPitchFor(cls, armed) * Math.PI / 180, cgp = Math.cos(gp), sgp = Math.sin(gp);
  const E = 0.42, cosE = Math.cos(E), sinE = Math.sin(E);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const camDist = 3.5, focal = Math.min(w, h) * 1.5, ox = w / 2, oy = h * 0.54;
  const proj = (f0, g, h0) => {
    const f = gp ? f0 * cgp - h0 * sgp : f0, hh = gp ? f0 * sgp + h0 * cgp : h0;   // nose-up ground tilt
    const fx = f * cy - g * sy, gy = f * sy + g * cy, hz = hh;
    const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;
    const z = camDist - camZ;
    return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z };
  };
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  if (glow) { ctx.shadowColor = accent; ctx.shadowBlur = 5; }

  const edges = [];
  let zMin = Infinity, zMax = -Infinity;
  for (const face of faces) {
    if (visorHidden(face)) continue;   // the dealer schematic draws her buttoned up: no cargo hold, no dangling ramp
    const P = face.p.map(v => proj(v[0], v[1], v[2]));
    if (P.some(q => q.z <= 0.15)) continue;
    let avgZ = 0; for (const q of P) avgZ += q.z;
    avgZ /= P.length;
    if (avgZ < zMin) zMin = avgZ; if (avgZ > zMax) zMax = avgZ;
    edges.push({ P, avgZ });
  }
  if (!edges.length) { ctx.restore(); return; }
  const zRange = Math.max(0.01, zMax - zMin);
  // Batch the edges into a few depth bands and stroke each band as ONE path with a
  // single alpha (and a single glow pass) — instead of a stroke + shadow-blur per
  // face. Same x-ray fade (far→near = dim→bright), a fraction of the draw cost.
  const BANDS = 5;
  for (let b = 0; b < BANDS; b++) {                      // far band first, so nearer edges paint on top
    ctx.globalAlpha = 0.32 + ((b + 0.5) / BANDS) * 0.58;
    ctx.beginPath();
    for (const { P, avgZ } of edges) {
      const t = 1 - (avgZ - zMin) / zRange;              // 0 far … 1 near
      if (Math.min(BANDS - 1, (t * BANDS) | 0) !== b) continue;
      ctx.moveTo(P[0].sx, P[0].sy);
      for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy);
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
}

// TUNING KNOB — a rotary dial for one tune curve. The value sweeps a 270° arc
// (bottom-left → top → bottom-right); centre (0, straight up) is stock. The filled
// arc grows from centre in the direction you've turned it, so at a glance you read
// both how far and which way. `range` is the reachable ± (skill + kits); a faint tick
// past the fill marks the current cap. Drag handling lives in hangar-bay.js.
const KNOB_A0 = Math.PI * 0.75, KNOB_A1 = Math.PI * 2.25;   // 135° … 405°, i.e. a 270° sweep with the gap at the bottom
// Canvas can't read CSS vars, so the instruments take resolved theme colours and
// mix their own shades. These helpers parse a hex and derive tints so the dials and
// radar follow the active theme (a pale machined dial on a light theme, dark on a
// dark one) instead of being a hardcoded black island.
function _rgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return [120, 150, 170];
  let s = m[1]; if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// hex → rgba() at a given alpha, so canvas gradients can fade a colour per-stop
// (globalAlpha only fades a whole draw).
function hexA(hex, a) { const [r, g, b] = _rgb(hex); return `rgba(${r},${g},${b},${a})`; }
// "r,g,b" triplet for building rgba() strings with a variable alpha inline.
export function rgbTriplet(hex) { return _rgb(hex).join(','); }
// Shift a colour toward white (amt>0) or black (amt<0), amt in 0..1 — used to cut
// the top-sheen / edge-shadow of the machined metal out of one base surface colour.
function shade(hex, amt) {
  const [r, g, b] = _rgb(hex), mix = amt >= 0 ? 255 : 0, t = Math.abs(amt);
  return `rgb(${Math.round(r + (mix - r) * t)},${Math.round(g + (mix - g) * t)},${Math.round(b + (mix - b) * t)})`;
}
export function drawKnob(ctx, { w, h, value = 0, range = 1, accent = '#5fd6ff', face = '#20262c', ink = '255,255,255' }) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.40, mid = (KNOB_A0 + KNOB_A1) / 2;
  const frac = Math.max(-1, Math.min(1, range ? value / range : 0));
  const ang = mid + frac * (KNOB_A1 - KNOB_A0) / 2;
  const br = R * 0.70;   // machined cap radius

  // Graduation ticks around the sweep — the three cardinals (both ends + straight-up
  // stock centre) drawn longer and brighter so the scale reads at a glance. Ink is the
  // theme's contrast colour, so ticks stay legible on a light or a dark bench.
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const a = KNOB_A0 + (i / N) * (KNOB_A1 - KNOB_A0), card = (i === 0 || i === N || i === N / 2);
    ctx.strokeStyle = `rgba(${ink},${card ? 0.55 : 0.22})`;
    ctx.lineWidth = card ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (R + 1.5), cy + Math.sin(a) * (R + 1.5));
    ctx.lineTo(cx + Math.cos(a) * (R + (card ? 5 : 3)), cy + Math.sin(a) * (R + (card ? 5 : 3)));
    ctx.stroke();
  }

  // Sunken track groove (dark cut + faint top-lit lip), then the lit value arc.
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(cx, cy, R, KNOB_A0, KNOB_A1); ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc(cx, cy, R, KNOB_A0, KNOB_A1); ctx.stroke();
  ctx.lineWidth = 4; ctx.strokeStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.min(mid, ang), Math.max(mid, ang)); ctx.stroke();
  ctx.shadowBlur = 0;

  // Machined metal cap — a radial sheen cut from the theme surface, lit top-left.
  const g = ctx.createRadialGradient(cx - br * 0.4, cy - br * 0.45, br * 0.12, cx, cy, br);
  g.addColorStop(0, shade(face, 0.30)); g.addColorStop(0.55, shade(face, -0.05)); g.addColorStop(1, shade(face, -0.42));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, br, 0, Math.PI * 2); ctx.fill();
  // Knurled edge — fine spokes cut into the rim.
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * br, cy + Math.sin(a) * br);
    ctx.lineTo(cx + Math.cos(a) * (br - 2.5), cy + Math.sin(a) * (br - 2.5));
    ctx.stroke();
  }
  // Bevel: bright top arc, dark bottom arc, so the cap reads as raised.
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.arc(cx, cy, br, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath(); ctx.arc(cx, cy, br, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();

  // Pointer + glowing LED tip.
  const px = cx + Math.cos(ang) * br * 0.82, py = cy + Math.sin(ang) * br * 0.82;
  ctx.strokeStyle = accent; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * br * 0.24, cy + Math.sin(ang) * br * 0.24); ctx.lineTo(px, py); ctx.stroke();
  ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Hub.
  ctx.fillStyle = shade(face, -0.5);
  ctx.beginPath(); ctx.arc(cx, cy, br * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'butt';
}

// PERFORMANCE RADAR — the 5-axis "shape" of a tune. Draws a faint concentric grid,
// a stock ghost polygon (all axes at 50), and the current tune polygon filled in the
// theme accent, so a change morphs the shape live as the dials turn. `axes`/`stock`
// are { id: 0..100 }; `labels` is [{ id, label }] in ring order.
export function drawPerfRadar(ctx, { w, h, axes, stock, labels, accent = '#5fd6ff', ink = '255,255,255' }) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.52, R = Math.min(w, h) * 0.34, n = labels.length;
  const angOf = i => -Math.PI / 2 + i / n * Math.PI * 2;
  const pt = (i, val) => { const a = angOf(i), rr = R * (val / 100); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; };
  // A faint phosphor glow pooled at the scope's centre.
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.15);
  bg.addColorStop(0, hexA(accent, 0.12)); bg.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2); ctx.fill();
  // Grid rings — brighter as they go out. Ink is the theme contrast colour.
  for (let ring = 1; ring <= 3; ring++) {
    ctx.strokeStyle = `rgba(${ink},${0.08 + ring * 0.04})`; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const a = angOf(i), rr = R * ring / 3, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.stroke();
  }
  // Spokes + accent-tinted axis labels.
  ctx.font = '9px monospace'; ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const a = angOf(i), x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    ctx.strokeStyle = `rgba(${ink},0.12)`;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = hexA(accent, 0.82);
    ctx.fillText(labels[i].label, cx + Math.cos(a) * (R + 15), cy + Math.sin(a) * (R + 15) + 3);
  }
  const trace = (vals, stroke, fill, dash, glow) => {
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const [x, y] = pt(i, vals[labels[i].id]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (glow) { ctx.shadowColor = accent; ctx.shadowBlur = 9; }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.shadowBlur = 0; ctx.setLineDash([]);
  };
  trace(stock, `rgba(${ink},0.42)`, null, [3, 3], false);       // stock ghost, dashed
  const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  fg.addColorStop(0, hexA(accent, 0.32)); fg.addColorStop(1, hexA(accent, 0.05));
  trace(axes, accent, fg, null, true);                            // current tune, filled + glowing
  // Vertex nodes on the live trace.
  ctx.shadowColor = accent; ctx.shadowBlur = 6; ctx.fillStyle = accent;
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, axes[labels[i].id]); ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.shadowBlur = 0;
}
