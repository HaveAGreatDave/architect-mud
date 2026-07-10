// WIREFRAME PLANE — CRT/terminal-style renders of an aircraft (dealer buy/rent,
// insurance) that want a schematic read rather than the realistic shaded 3D
// model those screens deliberately don't use (see aircraft3d.js — the hangar
// floor/bench's "real" turntable render, left untouched by this file on purpose).
import { aircraftFaces } from './aircraft3d.js';

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
export function drawWireframe3D(ctx, { cls, w, h, accent = '#39ff9e', yaw = 0, glow = true }) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const faces = aircraftFaces(cls);
  const E = 0.42, cosE = Math.cos(E), sinE = Math.sin(E);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const camDist = 3.5, focal = Math.min(w, h) * 1.5, ox = w / 2, oy = h * 0.54;
  const proj = (f, g, hh) => {
    const fx = f * cy - g * sy, gy = f * sy + g * cy, hz = hh;
    const camY = hz * cosE - fx * sinE, camZ = fx * cosE + hz * sinE;
    const z = camDist - camZ;
    return { sx: ox + gy * focal / z, sy: oy - camY * focal / z, z };
  };
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  if (glow) { ctx.shadowColor = accent; ctx.shadowBlur = 5; }

  const edges = [];
  for (const face of faces) {
    const P = face.p.map(v => proj(v[0], v[1], v[2]));
    if (P.some(q => q.z <= 0.15)) continue;
    let avgZ = 0; for (const q of P) avgZ += q.z;
    edges.push({ P, avgZ: avgZ / P.length });
  }
  if (!edges.length) { ctx.restore(); return; }
  edges.sort((a, b) => b.avgZ - a.avgZ);
  const zMin = edges[edges.length - 1].avgZ, zMax = edges[0].avgZ, zRange = Math.max(0.01, zMax - zMin);
  for (const { P, avgZ } of edges) {
    ctx.globalAlpha = 0.32 + (1 - (avgZ - zMin) / zRange) * 0.58;   // nearer = brighter
    ctx.beginPath();
    ctx.moveTo(P[0].sx, P[0].sy);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].sx, P[i].sy);
    ctx.closePath();
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
export function drawKnob(ctx, { w, h, value = 0, range = 1, accent = '#5fd6ff' }) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38, mid = (KNOB_A0 + KNOB_A1) / 2;
  const frac = Math.max(-1, Math.min(1, range ? value / range : 0));
  const ang = mid + frac * (KNOB_A1 - KNOB_A0) / 2;
  // Track.
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.arc(cx, cy, R, KNOB_A0, KNOB_A1); ctx.stroke();
  // Value fill, growing out of centre.
  ctx.strokeStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.min(mid, ang), Math.max(mid, ang)); ctx.stroke();
  ctx.shadowBlur = 0;
  // Knob body.
  ctx.fillStyle = 'rgba(6,10,12,0.72)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.66, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.66, 0, Math.PI * 2); ctx.stroke();
  // Pointer.
  ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R * 0.58, cy + Math.sin(ang) * R * 0.58); ctx.stroke();
  // Centre (stock) tick, straight up.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy - R - 1); ctx.lineTo(cx, cy - R + 5); ctx.stroke();
  ctx.lineCap = 'butt';
}

// PERFORMANCE RADAR — the 5-axis "shape" of a tune. Draws a faint concentric grid,
// a stock ghost polygon (all axes at 50), and the current tune polygon filled in the
// theme accent, so a change morphs the shape live as the dials turn. `axes`/`stock`
// are { id: 0..100 }; `labels` is [{ id, label }] in ring order.
export function drawPerfRadar(ctx, { w, h, axes, stock, labels, accent = '#5fd6ff' }) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.52, R = Math.min(w, h) * 0.34, n = labels.length;
  const angOf = i => -Math.PI / 2 + i / n * Math.PI * 2;
  const pt = (i, val) => { const a = angOf(i), rr = R * (val / 100); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; };
  // Grid rings.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  for (let ring = 1; ring <= 3; ring++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const a = angOf(i), rr = R * ring / 3, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.stroke();
  }
  // Spokes + axis labels.
  ctx.fillStyle = 'rgba(200,220,235,0.75)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const a = angOf(i), x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillText(labels[i].label, cx + Math.cos(a) * (R + 15), cy + Math.sin(a) * (R + 15) + 3);
  }
  const poly = (vals, stroke, fill) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const [x, y] = pt(i, vals[labels[i].id]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
    if (fill != null) { ctx.globalAlpha = fill; ctx.fillStyle = accent; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.stroke();
  };
  poly(stock, 'rgba(160,180,200,0.55)', null);   // stock ghost
  poly(axes, accent, 0.18);                        // current tune, filled
}
