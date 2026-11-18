// ROOM · THE CLONE HALL'S MONITORS. A monitoring tower (gl/room-decor.js 'vatrack') has three screens; this paints
// what's on them, live, as decals over their glass: a trace that scrolls (a heartbeat, or a breath), a bar chart of
// the vats' levels that drifts, and a column of vitals that tick over, each in the tower's greens, blues and amber,
// with a scan-line raster, a phosphor glow and the glass's vignette. Ten frames a second; nothing here is read back.
import { facing } from '../../../shared/room-layout.js';

const SCREENS = [[1.55, 2.1], [1.0, 1.5], [0.55, 0.95]];
const TINTS = ['#38e8a0', '#5ad8ff', '#ffb43a'];
const PX = 300;
// the seeded random room-decor.js uses for the tower, so each screen keeps the tint the tower was built with
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function createVitals(L) {
  const towers = (L.placed || []).filter((p) => p.form === 'vatrack');
  if (!towers.length) return { tick: () => false, decals: () => [] };
  const list = [];
  towers.forEach((p, ti) => {
    const [fu, fv] = facing(p.turn), ru = -fv, rv = fu, hw = p.w / 2, hd = p.d / 2, y0 = p.y0 || 0;
    const W = (x, y, z) => L.world(p.u + ru * x + fu * z, p.v + rv * x + fv * z, y + y0);
    const o = W(0, 0, 0), f = W(0, 0, 1), n = [f[0] - o[0], f[1] - o[1], f[2] - o[2]];
    const r = rng(p.seed || 3);
    SCREENS.forEach(([a, b], i) => {
      const x0 = hw - 0.065, z = hd - 0.044, w = (hw - 0.065) * 2, h = b - a;
      const c = document.createElement('canvas'); c.width = Math.round(w * PX); c.height = Math.round(h * PX);
      list.push({ key: `vitals:${ti}:${i}`, kind: (i + ti) % 3, tint: TINTS[(i + Math.floor(r() * 3)) % 3], src: c, n, seed: ti * 7 + i,
        quad: [W(x0, b - 0.005, z), W(-x0, b - 0.005, z), W(-x0, a + 0.005, z), W(x0, a + 0.005, z)], glow: 1.4, fresh: false, hist: [] });
    });
  });
  let last = 0;
  function tick(now) {
    if (now - last < 100) return false;
    last = now;
    const t = now / 1000;
    for (const d of list) { paint(d, t); d.fresh = true; }
    return true;
  }
  function decals() {
    const out = list.map((d) => ({ key: d.key, src: d.src, quad: d.quad, n: d.n, glow: d.glow, fresh: d.fresh }));
    for (const d of list) d.fresh = false;
    return out;
  }
  return { tick, decals };
}

// one screen's frame
function paint(d, t) {
  const c = d.src, g = c.getContext('2d'), W = c.width, H = c.height, col = d.tint, s = d.seed;
  // the glass: near black with a faint cast of its colour, and a grid
  g.fillStyle = '#020605'; g.fillRect(0, 0, W, H);
  g.strokeStyle = hexA(col, 0.09); g.lineWidth = 1;
  for (let x = 0; x < W; x += W / 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += H / 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.save(); g.shadowColor = col; g.shadowBlur = 6; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
  g.font = `600 ${Math.round(H * 0.11)}px "Share Tech Mono", "Geist Mono", monospace`;
  if (d.kind === 0) {
    // a heartbeat, sweeping left to right with a gap ahead of the pen, and the rate in the corner
    const bpm = 58 + 6 * Math.sin(t * 0.1 + s), per = 60 / bpm, sweep = (t / 4) % 1, N = 120;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N; if (Math.abs(u - sweep) < 0.04) { g.stroke(); g.beginPath(); continue; }
      const age = (u <= sweep ? sweep - u : sweep + 1 - u) * 4, ph = (((t - age) / per) % 1 + 1) % 1;
      const y = ph < 0.04 ? -0.1 : ph < 0.07 ? 0.85 : ph < 0.1 ? -0.35 : ph > 0.3 && ph < 0.42 ? 0.18 * Math.sin((ph - 0.3) / 0.12 * Math.PI) : 0;
      g.lineTo(u * W, H * (0.58 - y * 0.38));
    }
    g.stroke();
    g.textAlign = 'right'; g.fillText(`HR ${Math.round(bpm)}`, W - 6, H * 0.16);
    g.textAlign = 'left'; g.fillText(`VAT ${String.fromCharCode(65 + (s % 4))}-${(s * 37) % 90 + 10}`, 6, H * 0.16);
  } else if (d.kind === 1) {
    // the vats' levels as bars, drifting, one flagged amber when it's low
    const n = 8, bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = 0.55 + 0.3 * Math.sin(t * 0.37 + i * 1.3 + s) + 0.08 * Math.sin(t * 2.1 + i * 3.7), low = v < 0.4;
      g.fillStyle = low ? '#ffb43a' : col; g.shadowColor = g.fillStyle;
      g.fillRect(i * bw + bw * 0.18, H * (0.92 - 0.72 * v), bw * 0.64, H * 0.72 * v);
    }
    g.fillStyle = col; g.textAlign = 'left'; g.fillText('GROWTH MEDIUM', 6, H * 0.14);
  } else {
    // a column of vitals ticking over, a breath trace under them
    const rows = [['O2', 96 + Math.round(2 * Math.sin(t * 0.3 + s)), '%'], ['TEMP', (37 + 0.15 * Math.sin(t * 0.2 + s)).toFixed(1), 'C'], ['NEURAL', Math.round(71 + 9 * Math.sin(t * 0.7 + s)), '%'], ['PRINT', Math.floor((t * 3 + s * 11) % 100), '%']];
    g.textAlign = 'left';
    rows.forEach(([k, v, u], i) => { const y = H * (0.17 + i * 0.15); g.fillText(k, 6, y); g.textAlign = 'right'; g.fillText(`${v}${u}`, W - 6, y); g.textAlign = 'left'; });
    g.beginPath();
    for (let i = 0; i <= 80; i++) { const u = i / 80; g.lineTo(u * W, H * (0.86 - 0.08 * Math.sin(u * 9 - t * 1.3 + s))); }
    g.stroke();
  }
  g.restore();
  // the raster, and the glass darker toward its edges
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
}
const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
