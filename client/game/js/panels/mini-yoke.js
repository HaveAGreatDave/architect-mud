// The outside view's stick: a small picture of the craft's own cockpit yoke, stick or cyclic.
//
// It's cut from the same faces the cockpit draws (shellFaces), so every airframe gets its own
// control with no second model to keep in step. The part kept is the faces round the profile's
// 'yoke' hotspot: those marked as moving (`mv`) when the profile marks any, else everything close.
// Drawn once per craft at the neutral pose, seen from just off the pilot's eye; the frame loop moves the
// canvas with the same CSS transform the old SVG took, so input feels exactly as before.
import { shellProfileFor, shellFaces } from '../../../shared/interior-shell.js';
import { isHoverCar } from '../../../shared/hover-cars.js';

const TONE = { dash: [46, 52, 60], pil: [62, 68, 76], hdr: [54, 60, 68], seat: [58, 62, 70], floor: [30, 33, 38] };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The faces that make up the control, or null when the profile has no yoke hotspot.
export function yokeFaces(cls, armed, variant) {
  const P = shellProfileFor(cls, armed, variant);
  if (!P || typeof P.hotspots !== 'function') return null;
  let hs;
  try { hs = P.hotspots({}) || []; } catch { return null; }
  const y = hs.find((h) => h && h.kind === 'yoke');
  if (!y) return null;
  const F = shellFaces(P, {}, { rich: true });
  const within = (f, R) => f.p.every((q) => Math.hypot(q[0] - y.p[0], q[1] - y.p[1], q[2] - y.p[2]) < R);
  const solid = (f) => !(f.emis > 0);  // lit needles and dial faces move too; they are not the stick
  let keep = F.filter((f) => f.mv != null && solid(f) && within(f, 0.35));
  if (keep.length < 8) keep = F.filter((f) => solid(f) && within(f, 0.2));
  return keep.length ? { faces: keep, at: y.p } : null;
}

// Paint the control into `cv` (sized in CSS pixels by its box). Returns false when there's nothing to draw.
export function paintMiniYoke(cv, cls, armed, variant, accent = '#5fd0ff') {
  // The Merlin's hotspot is on a grip, so the cut came out as a stray grip and keys; its own drawn
  // yoke (cockpit.js YOKE_MERLIN) shows instead.
  if (isHoverCar(cls)) return false;
  const got = yokeFaces(cls, armed, variant);
  if (!got) return false;
  // From a little right of and above the seat, so a stick reads as a solid rather than its top.
  const eye = [0.1, -0.16, 0.1], at = got.at;
  const d = norm(sub(at, eye)), r = norm(cross(d, [0, 0, 1])), u = cross(r, d);
  const L = norm([-0.4, -0.6, 0.7]);
  const polys = got.faces.map((f) => {
    const pts = f.p.map((q0) => { const q = sub(q0, eye), z = Math.max(0.02, dot(q, d)); return [dot(q, r) / z, -dot(q, u) / z, z]; });
    const zm = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    const n = f.n || norm(cross(sub(f.p[1], f.p[0]), sub(f.p[2], f.p[0])));
    const base = f.rgb || TONE[f.tone] || TONE.dash;
    const lit = f.rgb && f.emis ? 1 : 0.42 + 0.58 * Math.abs(dot(n, L));
    return { pts, zm, rgb: base.map((c) => Math.round(Math.min(255, c * lit + 10))) };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const q of p.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const W = Math.max(40, cv.clientWidth || 120), H = Math.max(30, cv.clientHeight || 90);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  if (!g) return false;
  const pad = 6, k = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  polys.sort((a, b) => b.zm - a.zm);
  g.lineJoin = 'round';
  for (const p of polys) {
    g.beginPath();
    p.pts.forEach((q, i) => (i ? g.lineTo : g.moveTo).call(g, q[0] * k + ox, q[1] * k + oy));
    g.closePath();
    const c = `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`;
    g.fillStyle = c; g.fill();
    g.strokeStyle = c; g.lineWidth = 0.6; g.stroke();   // closes hairline seams between faces
  }
  // A thin rim of the accent round the silhouette: the HUD's own hairline.
  g.globalCompositeOperation = 'destination-over';
  g.shadowColor = accent; g.shadowBlur = 5;
  g.drawImage(cv, 0, 0, W, H);
  g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;
  return true;
}
