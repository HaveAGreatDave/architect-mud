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

// ENGINE WIREFRAME — the tuning tab's schematic: a radial cowling + cylinders
// (avionics-style, not the real hangar model) with four small gauge dials — one
// per tune curve (mixture/pitch/boost/cg) — needle angle live off its -2..2 value.
// `spin` (radians) rotates the prop-hub spokes for a subtle running-engine feel.
const TUNE_GAUGES = [['mixture', 'MIX'], ['pitch', 'PITCH'], ['boost', 'BOOST'], ['cg', 'CG']];
export function drawEngineWireframe(ctx, { w, h, accent = '#5fd6ff', tune = {}, spin = 0 }) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.42, R = Math.min(w, h) * 0.30;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 6;

  // Cowl ring + crank hub.
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.35, 0, Math.PI * 2); ctx.stroke();

  // Radial cylinders around the ring.
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + Math.cos(a) * R, y0 = cy + Math.sin(a) * R;
    const x1 = cx + Math.cos(a) * (R * 1.3), y1 = cy + Math.sin(a) * (R * 1.3);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(x1, y1, R * 0.09, 0, Math.PI * 2); ctx.stroke();
  }
  // Spinning prop-hub spokes.
  for (let i = 0; i < 3; i++) {
    const a = spin + (i / 3) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 0.33, cy + Math.sin(a) * R * 0.33); ctx.stroke();
  }

  // Four gauges in a row beneath — needle position IS the tune curve.
  const gy = h * 0.83, gr = Math.min(w, h) * 0.075, gap = w / (TUNE_GAUGES.length + 1);
  ctx.font = `${Math.round(gr * 0.85)}px monospace`;
  ctx.textAlign = 'center';
  TUNE_GAUGES.forEach(([key, label], i) => {
    const gx = gap * (i + 1);
    ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.stroke();
    const v = tune[key] ?? 0;
    const na = -Math.PI * 1.25 + ((v + 2) / 4) * Math.PI * 1.5;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(na) * gr * 0.8, gy + Math.sin(na) * gr * 0.8); ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(label, gx, gy + gr * 2.1);
  });
  ctx.restore();
}
