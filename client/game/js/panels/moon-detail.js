// THE MOON UP CLOSE, for a telescope (star-chart.js draws it over the view at an observatory vantage). GLASS's moon is
// a small sprite baked for a disc of a few dozen pixels; through a telescope you zoom in on it, so here it's painted
// once at 1024 px with its seas, its highlands, a field of craters with lit and shadowed rims, and the ray systems of
// Tycho and Copernicus, then lit for the phase and turned so its bright limb faces the sun (windshield.js limbTilt).
//
// The seas are placed as on the near side of the real moon, in the disc's own frame (x right, y down, radius 1), so it
// reads as our moon: Imbrium upper left, Serenitatis and Tranquillitatis to the right of middle, Crisium on the right
// limb, Procellarum down the left, Nubium and Humorum below, Tycho bright in the southern highlands.

const SIZE = 1024;
let face = null;

// a seeded random, so the same moon every time
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// [x, y, rx, ry, darkness] in the disc's frame
const MARIA = [
  [-0.30, -0.42, 0.30, 0.24, 0.30],   // Imbrium
  [0.14, -0.34, 0.16, 0.14, 0.32],    // Serenitatis
  [0.30, -0.06, 0.20, 0.17, 0.30],    // Tranquillitatis
  [0.64, -0.26, 0.11, 0.10, 0.34],    // Crisium
  [0.50, 0.18, 0.12, 0.17, 0.26],     // Fecunditatis
  [0.36, 0.30, 0.09, 0.08, 0.22],     // Nectaris
  [-0.56, -0.06, 0.24, 0.40, 0.26],   // Procellarum
  [-0.18, 0.28, 0.16, 0.11, 0.24],    // Nubium
  [-0.48, 0.38, 0.08, 0.08, 0.26],    // Humorum
  [0.02, -0.66, 0.30, 0.06, 0.20],    // Frigoris
  [-0.02, 0.02, 0.08, 0.08, 0.20],    // Vaporum and the middle bays
];
const TYCHO = [-0.12, 0.66], COPERNICUS = [-0.26, -0.12], KEPLER = [-0.50, -0.10];

function paintFace() {
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const g = c.getContext('2d'), R = SIZE / 2, X = (x) => R + x * R, rnd = rng(1969);
  g.save();
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  // the highlands: pale grey, lighter toward the middle and darker to the limb (limb darkening)
  const base = g.createRadialGradient(R * 0.96, R * 0.94, R * 0.05, R, R, R);
  base.addColorStop(0, '#e8e5dc'); base.addColorStop(0.7, '#d3cfc5'); base.addColorStop(1, '#a8a49b');
  g.fillStyle = base; g.fillRect(0, 0, SIZE, SIZE);
  // a fine mottle over all of it
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE, r = 0.6 + rnd() * 2.6, v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(90,86,78,${0.05 + rnd() * 0.07})` : `rgba(255,252,244,${0.04 + rnd() * 0.06})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // the seas, soft-edged, each a cluster of blobs so its shore isn't an ellipse
  for (const [x, y, rx, ry, k] of MARIA) {
    for (let j = 0; j < 22; j++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.75, bx = X(x + Math.cos(a) * rx * d), by = X(y + Math.sin(a) * ry * d);
      const br = R * Math.min(rx, ry) * (0.35 + rnd() * 0.45), gr = g.createRadialGradient(bx, by, 0, bx, by, br);
      gr.addColorStop(0, `rgba(62,64,66,${k})`); gr.addColorStop(0.65, `rgba(70,72,74,${k * 0.7})`); gr.addColorStop(1, 'rgba(70,72,74,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
    }
  }
  // the rays: thin bright streaks out of Tycho and Copernicus, and a few from Kepler
  const rays = ([x, y], n, len, a0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.3, L = R * len * (0.5 + rnd() * 0.8);
      const x0 = X(x), y0 = X(y), gr = g.createLinearGradient(x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L);
      gr.addColorStop(0, `rgba(255,253,246,${a0})`); gr.addColorStop(1, 'rgba(255,253,246,0)');
      g.strokeStyle = gr; g.lineWidth = 1.5 + rnd() * 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * L, y0 + Math.sin(a) * L); g.stroke();
    }
  };
  rays(TYCHO, 26, 0.9, 0.32); rays(COPERNICUS, 18, 0.45, 0.24); rays(KEPLER, 10, 0.25, 0.2);
  // the craters: a dark floor, a shadowed rim on the side away from the light (the upper left here; the face is
  // turned to the sun as it's drawn, so a fixed light is near enough), a bright rim toward it, and a bright fleck
  // of central peak in the big ones
  const crater = (x, y, r) => {
    const fl = g.createRadialGradient(x, y, 0, x, y, r);
    fl.addColorStop(0, 'rgba(120,116,108,0.35)'); fl.addColorStop(0.8, 'rgba(110,106,98,0.25)'); fl.addColorStop(1, 'rgba(110,106,98,0)');
    g.fillStyle = fl; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = Math.max(0.8, r * 0.18);
    g.strokeStyle = 'rgba(48,46,42,0.45)'; g.beginPath(); g.arc(x, y, r * 0.92, Math.PI * 0.85, Math.PI * 1.85); g.stroke();
    g.strokeStyle = 'rgba(255,252,242,0.55)'; g.beginPath(); g.arc(x, y, r * 0.95, Math.PI * 1.9, Math.PI * 2.8); g.stroke();
    if (r > 14) { g.fillStyle = 'rgba(255,252,242,0.5)'; g.beginPath(); g.arc(x + r * 0.08, y + r * 0.06, r * 0.12, 0, Math.PI * 2); g.fill(); }
  };
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.97, x = X(Math.cos(a) * d), y = X(Math.sin(a) * d);
    // small ones everywhere, the bigger ones mostly in the highlands; foreshortened toward the limb
    const big = rnd() < 0.08, r = big ? 10 + rnd() * 26 : 1.5 + rnd() * rnd() * 9;
    g.save(); g.translate(x, y); g.rotate(a); g.scale(Math.sqrt(1 - Math.min(0.95, d * d)) * 0.7 + 0.3, 1); crater(0, 0, r); g.restore();
  }
  for (const [p, r] of [[TYCHO, 30], [COPERNICUS, 34], [KEPLER, 16]]) crater(X(p[0]), X(p[1]), r);
  g.restore();
  return c;
}

// the moon at (x, y), radius R in pixels, `phase` 0..1 (0 new, 0.5 full), its bright limb turned to `tilt` radians
export function drawMoonDetail(g, x, y, R, phase, tilt) {
  if (!(R > 1)) return;
  face ||= paintFace();
  const lit = (1 - Math.cos(phase * Math.PI * 2)) / 2, cosPh = 2 * lit - 1;
  if (lit < 0.02) return;
  g.save();
  g.translate(x, y);
  // a soft glow round it, brighter the fuller it is
  const halo = g.createRadialGradient(0, 0, R * 0.95, 0, 0, R * (1.6 + lit));
  halo.addColorStop(0, `rgba(220,226,240,${0.18 * lit})`); halo.addColorStop(1, 'rgba(220,226,240,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(0, 0, R * (1.6 + lit), 0, Math.PI * 2); g.fill();
  g.rotate(tilt);
  g.drawImage(face, -R, -R, 2 * R, 2 * R);
  // the night side: +x is the bright limb; the shadow is the far half, less (gibbous) or more (crescent) the
  // terminator's ellipse, faintly lit by the earth
  const rx = R * Math.abs(cosPh);
  g.beginPath();
  g.moveTo(0, -R);
  g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, true);
  if (cosPh >= 0) g.ellipse(0, 0, rx, R, 0, Math.PI / 2, Math.PI * 1.5, false);
  else g.ellipse(0, 0, rx, R, 0, Math.PI / 2, -Math.PI / 2, true);
  g.closePath();
  g.fillStyle = 'rgba(6,8,14,0.92)';
  g.fill();
  g.restore();
}
