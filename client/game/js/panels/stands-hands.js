// Stands hands: what you do with what you took in a box's suite (stands.js, plugins/stands).
//
// Taking something off the bar, the buffet or the cigarette box puts it in front of you, in first
// person, as a lit 3-D model over the suite's view (stands-hands-gl.js). Each is a little ritual
// that ends in the ordinary verb, so the server does what it always does and nothing here can
// change a stat:
//
//   smoke  the cigarette comes out of the box turning in the light and goes to your mouth. Click
//          once to flip the zippo's lid, again to strike it, then hold Space with the flame on the
//          end to draw it alight (`smoke <it>`). After that, hold Space to take a drag and let go
//          in the green. Hold it too long and your head swims and you hear your heart.
//          A cigar is the same with a cutter first: click to clip its cap, then light and puff it.
//   drink  crack the cap, hold Space to tip it back, until it's gone (`drink <it>`).
//   eat    Space or click takes a bite, until it's gone (`eat <it>`).
//   glass  a glass from the bar stays with you, bottom left. Take a spirit or a mixer and you pour
//          it in, holding Space (`mix <it> into <glass>`); click the glass to stir it
//          (`mix <glass>`), then hold Space to sip (`drink <glass>`).
//
// The models go on a WebGL canvas and the flame, glows, smoke and sparks on a 2-D one above it,
// so the suite's renderer knows nothing about any of it. The dizziness is the only thing that
// touches the view: a sway and a blur on the host. With no WebGL, taking a thing just takes it.

import { createGl, lathe, rprism, tube, sphere, cylinder, capsule, M, T, S as S3, RX, RY, RZ, alignY, apply } from './stands-hands-gl.js';

import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./stands-hands.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('stands-hands-css')) return;
  const s = document.createElement('style');
  s.id = 'stands-hands-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const backOut = (t) => { t = clamp(t, 0, 1) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; };

// ── sound ─────────────────────────────────────────────────────────────────────
// Patches in SIREN's layer schema (client/shared/audio-engine.js), played as one-shots.
const TONE = (o) => ({
  waveform: o.wave || 'sine', freq: o.hz, gain: o.gain ?? 0.2,
  adsr: { a: o.a ?? 0.001, d: o.d ?? 0.05, s: 0, r: o.r ?? 0.03, curve: 'exp' },
  ...(o.mod ? { fm: { ratio: o.mod, index: o.index ?? 1, time: o.slide ?? 0.03, ...(o.indexEnd != null ? { indexEnd: o.indexEnd } : {}) } } : {}),
  ...(o.to ? { pitchBend: { to: o.to, time: o.bend ?? 0.05 } } : {}),
  ...(o.delay ? { delay: o.delay } : {}),
});
const NOISE = (o) => ({
  waveform: 'noise', noiseMix: 1, gain: o.gain ?? 0.08,
  filter: { type: o.type || 'bandpass', freq: o.hz ?? 2000, q: o.q ?? 0.8, ...(o.to ? { to: o.to, time: o.sweep ?? o.d ?? 0.05 } : {}) },
  adsr: { a: o.a ?? 0.001, d: o.d ?? 0.03, s: 0, r: o.r ?? 0.02, curve: 'exp' },
  ...(o.delay ? { delay: o.delay } : {}),
});
let seed = 0;
function sfx(layers, gain = 1) {
  const A = window.AudioEngine;
  if (!A?.playSfx) return;
  layers.forEach((l) => { if (l.noiseMix > 0) l.noiseSeed = 211 + (seed++ % 40) * 41; });
  const reach = Math.max(...layers.map((l) => (l.delay ?? 0) + l.adsr.a + l.adsr.d));
  try { A.playSfx({ category: 'sfx', priority: 6, config: { duration: reach * 0.3, layers } }, gain); } catch { /* no audio */ }
}
const SND = {
  // the zippo's ring when the lid flips: two bright inharmonic partials and a tick
  open: () => sfx([TONE({ hz: 2350, mod: 1.41, index: 2.5, indexEnd: 0.2, slide: 0.08, d: 0.35, gain: 0.12 }), TONE({ hz: 3720, d: 0.22, gain: 0.07 }), NOISE({ hz: 5200, q: 1.5, d: 0.012, gain: 0.1 })]),
  close: () => sfx([TONE({ hz: 1100, mod: 1.41, index: 3, indexEnd: 0, slide: 0.02, d: 0.07, gain: 0.14 }), NOISE({ hz: 2600, q: 1.2, d: 0.02, gain: 0.12 })]),
  strike: () => sfx([NOISE({ hz: 3400, to: 1500, q: 1.4, d: 0.13, gain: 0.14 }), NOISE({ hz: 7000, q: 2, d: 0.02, gain: 0.08, delay: 0.05 })]),
  whoomp: () => sfx([NOISE({ type: 'lowpass', hz: 500, to: 260, q: 0.7, a: 0.012, d: 0.45, gain: 0.16 })]),
  crackle: () => sfx([NOISE({ type: 'highpass', hz: 3800 + Math.random() * 2500, q: 0.7, d: 0.008 + Math.random() * 0.01, gain: 0.05 + Math.random() * 0.05 })]),
  inhale: () => sfx([NOISE({ hz: 1300, q: 0.6, a: 0.12, d: 0.5, gain: 0.03 })]),
  exhale: (k = 1) => sfx([NOISE({ hz: 850, q: 0.5, a: 0.06, d: 0.6 + 0.6 * k, gain: 0.05 * (0.5 + k) })]),
  cough: () => sfx([0, 0.22, 0.47].flatMap((d) => [NOISE({ hz: 620, q: 0.9, a: 0.005, d: 0.13, gain: 0.16, delay: d }), TONE({ hz: 190, to: 140, d: 0.1, gain: 0.08, delay: d })])),
  beat: (k = 1) => sfx([TONE({ hz: 62, to: 40, bend: 0.08, d: 0.12, gain: 0.32 * k }), TONE({ hz: 54, to: 36, bend: 0.08, d: 0.1, gain: 0.22 * k, delay: 0.16 })]),
  cap: () => sfx([TONE({ hz: 700, to: 300, bend: 0.03, d: 0.05, gain: 0.14 }), NOISE({ type: 'highpass', hz: 4500, a: 0.004, d: 0.55, gain: 0.07, delay: 0.01 }), TONE({ hz: 4200, mod: 1.41, index: 1.5, d: 0.08, gain: 0.04, delay: 0.32 })]),
  glug: () => sfx([TONE({ hz: 190 + Math.random() * 40, to: 120, bend: 0.06, d: 0.08, gain: 0.12 }), NOISE({ type: 'lowpass', hz: 420, d: 0.07, gain: 0.05 })]),
  pour: () => sfx([NOISE({ hz: 1600 + Math.random() * 800, q: 1.2, d: 0.06, gain: 0.04 })]),
  clink: () => sfx([TONE({ hz: 3100 + Math.random() * 600, mod: 2.41, index: 0.8, d: 0.25, gain: 0.05 })]),
  bite: () => sfx([NOISE({ hz: 2300, q: 1.1, d: 0.05, gain: 0.12 }), NOISE({ hz: 1500, q: 1, d: 0.06, gain: 0.09, delay: 0.07 }), NOISE({ type: 'lowpass', hz: 500, d: 0.09, gain: 0.08, delay: 0.25 })]),
  shimmer: () => sfx([1, 1.25, 1.5, 2].map((m, i) => TONE({ hz: 1320 * m, d: 0.3, gain: 0.025, delay: i * 0.06 }))),
};

// ── what a thing looks like ───────────────────────────────────────────────────
// Read off the name, with a plain fallback for anything it doesn't know.
function tintOf(name) {
  const n = String(name || '').toLowerCase();
  if (/cola/.test(n)) return '#3b1a0c';
  if (/rum/.test(n)) return '#7a3510';
  if (/whisk|bourbon|brandy/.test(n)) return '#b5701f';
  if (/lime/.test(n)) return '#b9d46c';
  if (/lemon/.test(n)) return '#e9e17c';
  if (/ginger/.test(n)) return '#e2bf6f';
  if (/orange/.test(n)) return '#f0962a';
  if (/champagne|wine|prosecco/.test(n)) return '#edd58e';
  if (/lager|beer|ale|stout/.test(n)) return '#d39220';
  if (/gin|vodka|soda|water|tonic/.test(n)) return '#dde9ee';
  return '#c98a3a';
}
const clearLiquid = (c) => c === '#dde9ee';
const vesselOf = (name) => (/^(flute|glass|cup|mug) of/i.test(String(name || '')) ? 'flute' : 'bottle');
function foodOf(name) {
  const n = String(name || '').toLowerCase();
  if (/frank|dog|sausage|brat/.test(n)) return 'hotdog';
  if (/shrimp|prawn|cocktail/.test(n)) return 'cocktail';
  return 'burger';
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
function blend(layers) {
  let t = 0, r = 0, g = 0, b = 0;
  for (const l of layers) { const [R, G, B] = hexRgb(l.color); r += R * l.amt; g += G * l.amt; b += B * l.amt; t += l.amt; }
  if (!t) return '#c98a3a';
  return '#' + [r, g, b].map((v) => Math.round(v / t).toString(16).padStart(2, '0')).join('');
}

// a soft white puff, drawn once and stamped for every bit of smoke
const PUFF = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(235,235,238,0.55)'); g.addColorStop(0.5, 'rgba(220,222,226,0.22)'); g.addColorStop(1, 'rgba(210,212,216,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
})();
const LID_OPEN = 1.95;

// ── models ────────────────────────────────────────────────────────────────────
// Every model is a list of [mesh, matrix, material] parts in its own centimetres.
// what you smoke, in cm: length, radius, the filter's length (a cigar has none), a cigar's band
const SMOKES = { cigarette: { L: 8.4, R: 0.4, F: 2.6 }, cigar: { L: 14, R: 0.85, F: 0, band: [1.7, 2.6], cigar: true } };
const BOTTLES = {
  // a long-neck: heel, straight body, shoulder, neck, the lip a crown cap sits on
  lager: { top: 23, outer: [[0, 0], [2.7, 0], [3.05, 0.35], [3.1, 1], [3.1, 13], [2.95, 14.6], [2.2, 16.4], [1.5, 17.8], [1.25, 19], [1.25, 22.2], [1.45, 22.4], [1.45, 23], [0, 23]], fill: 19.2, cap: true, label: [5.5, 11.5], r: 3.1 },
  spirit: { top: 23, outer: [[0, 0], [3.4, 0], [3.8, 0.35], [3.85, 1], [3.85, 14], [3.6, 15.6], [2.4, 17.2], [1.4, 18.4], [1.3, 19.4], [1.3, 22.4], [1.5, 22.6], [1.5, 23], [0, 23]], fill: 15.8, cap: false, label: [4.5, 11], r: 3.85 },
  // a flute: foot, stem, a tall bowl; the inside comes back down so the glass has a wall
  flute: { top: 19.5, outer: [[0, 0], [3.3, 0], [3.3, 0.18], [0.4, 0.55], [0.26, 8.5], [0.55, 9.3], [1.9, 11], [2.4, 14], [2.45, 19.5], [2.36, 19.5], [2.31, 14], [1.82, 11.15], [0, 10.25]], fill: 18, liquid: [[0, 10.4], [1.74, 11.25], [2.24, 14], [2.3, 18.2], [0, 18.2]], flute: true },
};
const HIGHBALL = { outer: [[0, 0], [2.85, 0], [3.0, 0.2], [3.15, 12.5], [3.02, 12.5], [2.82, 0.9], [0, 0.9]], liquid: [[0, 0.9], [2.8, 0.9], [2.99, 12.2], [0, 12.2]], lo: 0.9, hi: 12.1 };
const liquidOf = (b) => b.liquid || b.outer.filter(([, y]) => y <= b.fill + 0.01).map(([r, y]) => [Math.max(0, r - 0.18), Math.max(0.25, y)]).concat([[0, b.fill]]);

// The flame: a blue root, a white core and a tall yellow body, drawn over the 3-D view.
function drawFlame(ctx, bx, by, h, sway, now, k = 1) {
  if (k <= 0) return;
  h *= (1 + Math.sin(now * 0.021) * 0.05 + Math.sin(now * 0.053) * 0.04) * k;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(bx, by - h * 0.45, 0, bx, by - h * 0.45, h * 2.4);
  glow.addColorStop(0, `rgba(255,170,70,${0.3 * k})`); glow.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(bx, by - h * 0.45, h * 2.4, 0, 6.283); ctx.fill();
  const tear = (w, hh, tx) => {
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.bezierCurveTo(bx - w, by - hh * 0.1, bx - w * 0.9, by - hh * 0.55, bx + tx, by - hh);
    ctx.bezierCurveTo(bx + w * 0.9, by - hh * 0.55, bx + w, by - hh * 0.1, bx, by);
  };
  const g = ctx.createLinearGradient(bx, by, bx, by - h);
  g.addColorStop(0, 'rgba(255,150,40,0.2)'); g.addColorStop(0.25, 'rgba(255,170,50,0.85)'); g.addColorStop(0.7, 'rgba(255,120,30,0.6)'); g.addColorStop(1, 'rgba(255,80,20,0)');
  tear(h * 0.24, h, sway); ctx.fillStyle = g; ctx.fill();
  tear(h * 0.13, h * 0.62, sway * 0.6); ctx.fillStyle = 'rgba(255,236,170,0.75)'; ctx.fill();
  tear(h * 0.06, h * 0.32, sway * 0.3); ctx.fillStyle = 'rgba(255,255,240,0.8)'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx, by - h * 0.04, h * 0.1, h * 0.07, 0, 0, 6.283); ctx.fillStyle = 'rgba(80,120,255,0.65)'; ctx.fill();
  ctx.restore();
}
function glowAt(ctx, x, y, r, col, a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); ctx.restore();
}
// four-pointed glints round a thing as it arrives
function sparkle(ctx, cx, cy, R, t, S) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const ph = (t * 1.6 + i * 0.37) % 1, ang = i * 0.7 + t * 0.8, r = R * (0.6 + (i % 4) * 0.18);
    const sx = cx + Math.cos(ang) * r, sy = cy + Math.sin(ang) * r * 0.6, sz = Math.sin(ph * Math.PI) * 9 * S;
    ctx.fillStyle = `rgba(255,225,150,${Math.sin(ph * Math.PI) * 0.9})`;
    ctx.beginPath(); ctx.moveTo(sx, sy - sz); ctx.lineTo(sx + sz * 0.22, sy - sz * 0.22); ctx.lineTo(sx + sz, sy); ctx.lineTo(sx + sz * 0.22, sy + sz * 0.22);
    ctx.lineTo(sx, sy + sz); ctx.lineTo(sx - sz * 0.22, sy + sz * 0.22); ctx.lineTo(sx - sz, sy); ctx.lineTo(sx - sz * 0.22, sy - sz * 0.22); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ── the hands ─────────────────────────────────────────────────────────────────
export function createHands(root, host, { send }) {
  ensureStyles();
  const cg = document.createElement('canvas');
  cg.className = 'sh-canvas sh-gl';
  let g3 = null;
  try { g3 = createGl(cg); } catch (err) { console.warn('[stands] no 3-D for the hands:', err); }
  const cv = document.createElement('canvas');
  cv.className = 'sh-canvas';
  const ctx = cv.getContext('2d');
  const prompt = document.createElement('div');
  prompt.className = 'sh-prompt'; prompt.hidden = true;
  const glassBtn = document.createElement('button');
  glassBtn.type = 'button'; glassBtn.className = 'sh-glass'; glassBtn.hidden = true;
  glassBtn.setAttribute('aria-label', 'Your glass');
  root.append(cg, cv, prompt, glassBtn);
  const tip = root.querySelector('.st-tip');

  let W = 0, H = 0, S = 1, raf = 0, last = 0, act = null, space = false, stopped = false;
  let mouse = null;
  const smoke = [], sparks = [], bits = [];
  let dizzy = 0, beatAt = 0, glass = null;

  const fit = () => {
    const w = host.offsetWidth, h = host.offsetHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [cv, cg]) { c.style.top = `${host.offsetTop}px`; c.style.height = `${h}px`; c.style.width = `${w}px`; }
    if (w !== W || h !== H || cv.width !== Math.round(w * dpr)) {
      W = w; H = h;
      for (const c of [cv, cg]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    }
    S = Math.max(0.6, Math.min(W, H) / 700);
    ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  };
  const say = (text) => {
    prompt.hidden = !text; prompt.textContent = text || '';
    if (tip) tip.hidden = !!(act || text);
  };
  const wantMouse = (on, cursor = '') => { cv.style.pointerEvents = on ? 'auto' : 'none'; cv.style.cursor = cursor; };
  const kick = () => { if (!raf && !stopped) { last = 0; raf = requestAnimationFrame(frame); } };

  cv.addEventListener('pointermove', (e) => { const b = cv.getBoundingClientRect(); mouse = [e.clientX - b.left, e.clientY - b.top]; });
  cv.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); act?.click?.(); });
  glassBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  glassBtn.addEventListener('click', () => { if (!act && glass) start(glassActivity()); });

  const puff = (x, y, vx, vy, r, life, a = 0.8, grow = 26) => { if (smoke.length < 260) smoke.push({ x, y, vx, vy, r, life, a, grow, age: 0, spin: Math.random() * 6 }); };
  const at = (v) => g3.project(v);

  // ── the meshes, built once ──────────────────────────────────────────────
  const mesh = {
    cyl: () => g3.mesh('cyl', () => cylinder(36)),
    sph: () => g3.mesh('sph', () => sphere(1, 18)),
    body: () => g3.mesh('zbody', () => rprism(3.8, 1.3, -3.7, 0, 0.36, 7)),
    lid: () => g3.mesh('zlid', () => rprism(3.8, 1.3, 0, 1.55, 0.36, 7)),
    chim: () => g3.mesh('zchim', () => rprism(3.15, 1.02, 0, 1.38, 0.1, 3)),
    box: () => g3.mesh('box', () => rprism(1, 1, -0.5, 0.5, 0.06, 2)),
    lathe: (key, prof, o) => g3.mesh(key, () => lathe(prof, 44, o)),
    tube: (key, path) => g3.mesh(key, () => tube(path, 12)),
    capsule: (key, r, len) => g3.mesh(key, () => capsule(r, len)),
  };
  const CHROME = { color: '#d9dde2', metal: 0.92, spec: 90, brush: 0.12 };
  const CHROME_DARK = { color: '#8b9096', metal: 0.8, spec: 60 };

  // ── a cigarette (filter, gold band, paper) or a cigar (wrapper leaf, gold band, the cap
  // clipped off its head), then the ash and the coal; c as in smokeActivity, K from SMOKES ──
  function drawCig(CM, c, K) {
    const seg = (y0, y1, r, o) => g3.draw(mesh.cyl(), M(CM, T(0, y0, 0), S3(r, Math.max(0.001, y1 - y0), r)), o);
    const burn = Math.max(K.F + 0.08, c.len * K.L);
    if (K.cigar) {
      seg(0, burn, K.R, { color: '#6e4527', noise: 0.28, spec: 18 });
      seg(K.band[0], K.band[1], K.R * 1.012, { color: '#d9b44e', metal: 0.8, spec: 80 });
      seg(K.band[0] + 0.3, K.band[1] - 0.3, K.R * 1.016, { color: '#7a1420', spec: 30 });
      if (!c.cut) g3.draw(mesh.sph(), M(CM, S3(K.R, K.R * 0.8, K.R)), { color: '#6a4224', noise: 0.28, spec: 18 });
      else seg(-0.01, 0.01, K.R * 0.98, { color: '#8a6038', noise: 0.6, spec: 4 });
    } else {
      seg(0, K.F, K.R, { color: '#d79a58', noise: 0.35, spec: 6 });
      seg(K.F - 0.05, K.F + 0.07, K.R * 1.006, { color: '#e2c060', metal: 0.75, spec: 70 });
      seg(K.F + 0.07, burn, K.R, { color: '#f6f3ec', spec: 10, noise: 0.03 });
    }
    if (c.lit) {
      seg(burn - 0.08, burn, K.R * 0.995, { color: '#5a3a1c', noise: 0.4, spec: 4, emit: [0.25 * c.ember, 0.06 * c.ember, 0] });
      if (c.ash > 0.004) seg(burn, burn + c.ash * K.L, K.R * 0.97, { color: '#a7a39d', noise: 0.6, spec: 3 });
      seg(burn - 0.02, burn + 0.05, K.R * 0.9, { color: '#401808', emit: [1.0 * c.ember + 0.2, 0.32 * c.ember + 0.05, 0.05], spec: 2 });
    } else {
      seg(K.L - 0.02, K.L, K.R * 0.96, { color: '#6b4220', noise: 0.55, spec: 3, emit: [0.9 * c.glow, 0.28 * c.glow, 0.02] });
    }
    const end = c.lit ? burn + c.ash * K.L : K.L;
    return { tip: apply(CM, [0, end, 0]), burn: apply(CM, [0, burn, 0]) };
  }

  // ── the zippo: brushed chrome case, the lid on a five-knuckle hinge, the chimney with its
  // sixteen holes, a knurled flint wheel, the cam and the wick. Origin is the top of the case.
  const WICK = [0.55, 1.9, 0];
  function drawZippo(ZM, z) {
    g3.draw(mesh.body(), ZM, CHROME);
    // the bottom's soft roll and the seam where the lid meets the case
    g3.draw(mesh.box(), M(ZM, T(0, -0.02, 0), S3(3.82, 0.04, 1.32)), { color: '#3a3d42', metal: 0.5, spec: 30 });
    if (z.lid > 0.03) {
      g3.draw(mesh.chim(), ZM, { color: '#c4c8cd', metal: 0.85, spec: 70, brush: 0.08 });
      for (const side of [-1, 1]) for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
        g3.draw(mesh.cyl(), M(ZM, T(-1.05 + k * 0.7, 0.42 + r * 0.55, side * 0.5), RX(Math.PI / 2), S3(0.15, 0.06, 0.15), T(0, -0.5, 0)), { color: '#121314', spec: 4 });
      }
      // the wheel's side plates and the wheel between them, knurled, on an axle front to back
      for (const side of [-1, 1]) g3.draw(mesh.box(), M(ZM, T(-0.62, 1.45, side * 0.36), S3(0.95, 0.75, 0.06)), CHROME_DARK);
      g3.draw(mesh.cyl(), M(ZM, T(-0.62, 1.62, 0), RX(Math.PI / 2), RY(z.wheel), S3(0.44, 0.6, 0.44), T(0, -0.5, 0)), { color: '#5d6268', metal: 0.7, spec: 40, stripe: 40 });
      g3.draw(mesh.cyl(), M(ZM, T(1.2, 1.25, 0), S3(0.1, 0.5, 0.1)), CHROME_DARK);   // the cam's post
      g3.draw(mesh.box(), M(ZM, T(1.2, 1.6, 0), RZ(0.3), S3(0.5, 0.18, 0.3)), CHROME_DARK);
      g3.draw(mesh.cyl(), M(ZM, T(WICK[0], 1.25, 0), S3(0.17, 0.5, 0.17)), { color: '#efe8d6', noise: 0.25, spec: 4 });
      g3.draw(mesh.cyl(), M(ZM, T(WICK[0], 1.74, 0), S3(0.18, 0.17, 0.18)), { color: '#2a2420', noise: 0.4, spec: 4, emit: z.flame ? [0.5, 0.15, 0] : [0, 0, 0] });
    }
    g3.draw(mesh.lid(), M(ZM, T(1.9, 0, 0), RZ(-z.lid), T(-1.9, 0, 0)), CHROME);
    for (let k = 0; k < 5; k++) g3.draw(mesh.cyl(), M(ZM, T(1.94, -0.72 + k * 0.29, 0.5), S3(0.14, 0.27, 0.14)), k % 2 ? CHROME_DARK : CHROME);
    return { wick: apply(ZM, WICK), hot: apply(ZM, [WICK[0], WICK[1] + 1.5, 0]), wheel: apply(ZM, [-0.62, 1.62, 0.5]) };
  }

  // ── a bottle or a flute, about its own foot; level 0..1 and the liquid kept level in the world
  function drawBottle(BM, b) {
    const B = BOTTLES[b.shape];
    const outer = mesh.lathe(`b-${b.shape}`, B.outer), liq = mesh.lathe(`bl-${b.shape}`, liquidOf(B));
    if (b.level > 0.005) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < liq.pts.length; i += 27) { const y = apply(BM, [liq.pts[i], liq.pts[i + 1], liq.pts[i + 2]])[1]; if (y < lo) lo = y; if (y > hi) hi = y; }
      g3.draw(liq, BM, { color: b.tint, alpha: clearLiquid(b.tint) ? 0.4 : 0.92, spec: 40, clipY: lo + (hi - lo) * Math.pow(b.level, 0.9) });
    }
    if (B.label) {
      g3.draw(mesh.lathe(`lab-${b.shape}`, [[B.r + 0.02, B.label[0]], [B.r + 0.02, B.label[1]]], { smooth: false }), BM, { color: '#efe8d8', spec: 8 });
      for (const y of [B.label[0] + 0.4, B.label[1] - 0.6]) g3.draw(mesh.lathe(`labg-${b.shape}-${y}`, [[B.r + 0.03, y], [B.r + 0.03, y + 0.25]], { smooth: false }), BM, { color: '#d4ac4a', metal: 0.8, spec: 60 });
    }
    if (b.cap) g3.draw(mesh.cyl(), M(BM, T(0, B.top - 0.25, 0), S3(1.6, 0.7, 1.6)), { color: '#c9b46a', metal: 0.85, spec: 70, stripe: 21 });
    g3.draw(outer, BM, { color: b.glass, alpha: B.flute ? 0.12 : 0.45, glass: 1, spec: 120 });
  }

  // ── the tall glass about its foot: layers by height, or one mixed colour clipped level
  function drawGlass(GM, gs) {
    const liq = mesh.lathe('hb-l', HIGHBALL.liquid), span = HIGHBALL.hi - HIGHBALL.lo;
    let y = HIGHBALL.lo, top = y;
    if (gs.mixed) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < liq.pts.length; i += 27) { const wy = apply(GM, [liq.pts[i], liq.pts[i + 1], liq.pts[i + 2]])[1]; if (wy < lo) lo = wy; if (wy > hi) hi = wy; }
      if (gs.level > 0.005) g3.draw(liq, GM, { color: gs.mixed, alpha: clearLiquid(gs.mixed) ? 0.45 : 0.9, spec: 40, clipY: lo + (hi - lo) * gs.level });
      top = HIGHBALL.lo + span * gs.level;
    } else {
      for (const l of gs.layers) {
        const h2 = span * l.amt;
        g3.draw(liq, GM, { color: l.color, alpha: clearLiquid(l.color) ? 0.45 : 0.9, spec: 40, band: [y, y + h2] });
        y += h2;
      }
      top = y;
    }
    if (top > HIGHBALL.lo + 0.5) for (let k = 0; k < 2; k++) {
      g3.draw(mesh.box(), M(GM, T(-0.8 + k * 1.5, Math.max(HIGHBALL.lo + 1, top - 0.8 - k * 1.2), k * 0.4), RY(0.4 + k), RX(0.3 * k), S3(1.6)), { color: '#eaf4fb', alpha: 0.3, glass: 1, spec: 120 });
    }
    g3.draw(mesh.lathe('hb', HIGHBALL.outer), GM, { color: '#dfeaf0', alpha: 0.12, glass: 1, spec: 140 });
    return { surface: apply(GM, [0, top, 0]) };
  }

  // ── food ────────────────────────────────────────────────────────────────
  // A slider (bun, lettuce, beef, sesame top, toothpick), a frank in a bun with mustard, or a
  // shrimp cocktail in a coupe. o: { cutX (world x past which it's been eaten), shrimp (left) }
  const DOME = Array.from({ length: 12 }, (_, k) => { const a = (k / 11) * Math.PI / 2; return [Math.cos(a) * 4.7, 2.5 + Math.sin(a) * 3.3]; });
  const SEEDS = Array.from({ length: 22 }, (_, k) => { const a = k * 2.39, rr = 4.2 * Math.sqrt((k + 0.5) / 22); const y = 2.5 + 3.3 * Math.sqrt(Math.max(0, 1 - (rr / 4.7) ** 2)); return [Math.cos(a) * rr, y, Math.sin(a) * rr, a]; });
  function drawFood(FM, kind, o) {
    const cut = { cutX: o.cutX };
    if (kind === 'hotdog') {
      g3.draw(mesh.capsule('hd-bun', 2.1, 11), M(FM, T(0, -0.6, 0), RZ(Math.PI / 2), S3(1, 1, 1.25)), { color: '#d9a05c', spec: 10, noise: 0.08, ...cut });
      g3.draw(mesh.capsule('hd-frank', 1.15, 13.5), M(FM, T(0, 1.2, 0), RZ(Math.PI / 2)), { color: '#9a3c1c', spec: 50, ...cut });
      const path = Array.from({ length: 41 }, (_, k) => [-7 + k * 0.35, 2.25 + Math.sin(k * 0.9) * 0.05, Math.sin(k * 0.95) * 0.65, 0.17]);
      g3.draw(mesh.tube('hd-mustard', path), FM, { color: '#e8c22a', spec: 40, ...cut });
      return;
    }
    if (kind === 'cocktail') {
      g3.draw(mesh.lathe('ck-sauce', [[0, 5.2], [3.6, 7.3], [4.5, 8.4], [0, 8.4]]), FM, { color: '#b5241a', spec: 60 });
      for (let k = 0; k < 4; k++) g3.draw(mesh.box(), M(FM, T(-2 + k * 1.3, 8.5, (k % 2) * 1.2 - 0.6), RY(k), RX(k * 0.7), S3(0.9)), { color: '#eef6fb', alpha: 0.5, glass: 1, spec: 120 });
      for (let k = 0; k < 6; k++) {
        if (k >= o.shrimp) continue;
        const a = (k / 6) * Math.PI * 2 + 0.3;
        // a shrimp: a tapering C hooked over the rim, its tail a fan of red
        const path = Array.from({ length: 13 }, (_, i) => { const t = i / 12, ang = -0.4 + t * 3.4; return [Math.cos(ang) * 1.5, Math.sin(ang) * 1.5, 0, 0.62 * (1 - t * 0.7) + 0.08]; });
        const SM = M(FM, RY(-a), T(5.4, 9.5, 0), RY(Math.PI / 2), RZ(0.2));
        g3.draw(mesh.tube('ck-shrimp', path), SM, { color: '#f28e5e', spec: 60, noise: 0.12 });
        g3.draw(mesh.box(), M(SM, T(1.3, -0.9, 0), RZ(0.6), S3(0.5, 0.25, 0.7)), { color: '#d4402a', spec: 40 });
      }
      g3.draw(mesh.lathe('ck-glass', [[0, 0], [3.4, 0], [3.4, 0.2], [0.4, 0.6], [0.3, 4.6], [0.6, 5.1], [3.8, 7.2], [5.2, 9.2], [5.05, 9.2], [3.7, 7.35], [0.5, 5.3], [0, 5.25]]), FM, { color: '#e6f0f5', alpha: 0.14, glass: 1, spec: 140 });
      return;
    }
    g3.draw(mesh.lathe('sl-bot', [[0, 0], [4.2, 0], [4.6, 0.4], [4.7, 1.0], [4.5, 1.3], [0, 1.4]]), FM, { color: '#d9a060', spec: 10, noise: 0.06, ...cut });
    g3.draw(mesh.lathe('sl-let', [[0, 1.25], [5.1, 1.2], [5.1, 1.45], [0, 1.55]], { wave: { amp: 0.07, n: 9 } }), FM, { color: '#6e9a34', spec: 20, noise: 0.15, ...cut });
    g3.draw(mesh.lathe('sl-beef', [[0, 1.45], [4.75, 1.45], [4.9, 1.9], [4.75, 2.45], [0, 2.5]], { wave: { amp: 0.03, n: 7 } }), FM, { color: '#7c3a2c', spec: 14, noise: 0.35, ...cut });
    g3.draw(mesh.lathe('sl-top', [[0, 2.4], ...DOME]), FM, { color: '#c98a3e', spec: 30, noise: 0.05, ...cut });
    for (const [x, y, zz, a] of SEEDS) g3.draw(mesh.sph(), M(FM, T(x, y, zz), RY(a), S3(0.22, 0.09, 0.12)), { color: '#f3e3bd', spec: 20, ...cut });
    g3.draw(mesh.cyl(), M(FM, T(0.6, 0.2, 0.3), S3(0.08, 8.6, 0.08)), { color: '#d8c08a', spec: 10, ...cut });
    g3.draw(mesh.box(), M(FM, T(1.4, 8.3, 0.3), S3(1.5, 1.0, 0.04)), { color: '#c9302c', spec: 10, ...cut });
  }

  // ── smoking ───────────────────────────────────────────────────────────────
  function smokeActivity(item) {
    const K = /cigar(?!ette)/i.test(item.name) ? SMOKES.cigar : SMOKES.cigarette, cigar = !!K.cigar;
    const c = { len: 1, lit: false, ember: 0, ash: 0, glow: 0, cut: !cigar };
    let cutT = 0, capBit = null, CMnow = null;
    const z = { lid: 0, lidTo: 0, wheel: 0, flame: 0, spin: 0 };
    let phase = 'appear', t = 0, light = 0, fill = 0, drawing = false, crackleAt = 0, exhaleAt = 0, exhaleK = 0, away = 0, gone = 0;
    let aim = null, zp = null, cigTip = [0, 0, -14], cigBurn = cigTip;
    // the end is in the same place whatever you smoke; a longer one reaches further back to your mouth
    const MT = cigar ? [1.2, -3.7, -22] : [0.8, -2.45, -14.2], DIRL = Math.hypot(0.65, 1.45, -8.2), mdir = [0.65, 1.45, -8.2].map((v) => (v / DIRL) * K.L);
    const MB = MT.map((v, i) => v - mdir[i]);
    const DRAG = cigar ? 'puff' : 'drag';
    SND.shimmer(); say('');
    return {
      smoke: true,
      click() {
        if (phase === 'cut' && cutT === 0) { cutT = 0.001; SND.close(); return; }
        if (phase === 'lid') { z.lidTo = LID_OPEN; SND.open(); phase = 'strike'; say('Click again to strike it.'); }
        else if (phase === 'strike' && z.lid > LID_OPEN * 0.8) {
          z.spin = 1; SND.strike();
          for (let k = 0; k < 16; k++) { const q = at(zp.wheel); sparks.push({ x: q[0], y: q[1], vx: (Math.random() - 0.3) * 260, vy: -Math.random() * 220, life: 0.25 + Math.random() * 0.3, age: 0 }); }
          setTimeout(() => {
            if (act?.smoke !== true || phase !== 'strike') return;
            z.flame = 1; SND.whoomp(); phase = 'light';
            say('Hold Space and put the flame to the end.');
          }, 70);
        }
      },
      key(down) {
        if (phase === 'drag' && down && !drawing && fill <= 0 && exhaleAt <= 0) { drawing = true; SND.inhale(); }
        if (phase === 'drag' && !down && drawing) release();
      },
      update(dt, now) {
        t += dt;
        z.lid = lerp(z.lid, z.lidTo, 1 - Math.exp(-dt * 24));
        if (z.spin > 0) { z.wheel += dt * 50 * z.spin; z.spin = Math.max(0, z.spin - dt * 4); }
        if (phase === 'appear' && t > 1.3) { phase = cigar ? 'cut' : 'tomouth'; t = 0; if (cigar) { say('Click to clip the end.'); wantMouse(true, 'pointer'); } }
        if (phase === 'cut' && cutT > 0) {
          // the blade goes through, the cap drops, and it goes to your mouth
          if (cutT < 1) { cutT = Math.min(1, cutT + dt / 0.12); if (cutT >= 1) { c.cut = true; capBit = { p: apply(CMnow, [0, -0.25, 0]), v: [-2, 3, 0], a: 0 }; t = 0; } }
          else if (t > 0.6) { phase = 'tomouth'; t = 0; wantMouse(false); say(''); }
        }
        if (capBit) { capBit.v[1] -= 50 * dt; for (let i = 0; i < 3; i++) capBit.p[i] += capBit.v[i] * dt; capBit.a += dt * 9; if (capBit.p[1] < -30) capBit = null; }
        else if (phase === 'tomouth' && t > 0.7) { phase = 'lid'; t = 0; say('Click to flip the lighter open.'); wantMouse(true, 'none'); }
        // the lighter goes where the mouse is, at the cigarette's distance, eased so it has weight
        const want = g3.unproject(...(mouse || [W * 0.72, H * 0.72]), -MT[2]);
        if (!aim) aim = want.slice();
        for (let i = 0; i < 3; i++) aim[i] = lerp(aim[i], want[i], 1 - Math.exp(-dt * 16));
        if (phase === 'light' && zp) {
          const near = Math.hypot(zp.hot[0] - cigTip[0], zp.hot[1] - cigTip[1], zp.hot[2] - cigTip[2]) < (cigar ? 1.4 : 0.9);
          const q = at(cigTip);
          if (space && near) {
            light += dt / (cigar ? 3.2 : 1.6); c.glow = Math.min(1, light * 1.4);
            if (now > crackleAt) { SND.crackle(); crackleAt = now + 90 + Math.random() * 120; }
            if (Math.random() < dt * 12) puff(q[0], q[1], (Math.random() - 0.5) * 8, -20 * S, 3 * S, 1.4, 0.3, 14);
          } else { light = Math.max(0, light - dt * 0.25); c.glow = Math.max(0, c.glow - dt * 0.6); }
          say(near ? (space ? (cigar ? 'Keep puffing and turning it in the flame...' : 'Keep drawing...') : 'Hold Space.') : 'Hold Space and put the flame to the end.');
          if (light >= 1) { c.lit = true; c.ember = 1; phase = 'lit'; t = 0; send(`smoke ${item.name}`); say(''); wantMouse(false); }
        }
        if (phase === 'lit') {
          if (t > 0.5 && z.lidTo) { z.lidTo = 0; z.flame = 0; setTimeout(() => SND.close(), 60); }
          away = ease((t - 0.8) / 0.6);
          if (t > 1.4) { phase = 'drag'; exhaleAt = now + 500; exhaleK = 0.8; say(`Hold Space to take a ${DRAG}. Let go in the green.`); }
        }
        if (phase === 'drag') {
          if (drawing) {
            fill += dt / 2.4;
            c.ember = lerp(c.ember, 1, 1 - Math.exp(-dt * 8));
            c.len -= dt * (cigar ? 0.014 : 0.045); c.ash += dt * (cigar ? 0.012 : 0.04);
            if (now > crackleAt) { SND.crackle(); crackleAt = now + 60 + Math.random() * 90; }
            if (fill >= 1) { SND.cough(); dizzy = Math.min(1.4, dizzy + 0.9); release(true); }
          } else {
            c.ember = lerp(c.ember, 0.25, 1 - Math.exp(-dt * 1.5));
            c.len -= dt * (cigar ? 0.0015 : 0.004); c.ash += dt * (cigar ? 0.0013 : 0.0035);
            if (fill > 0 && exhaleAt <= 0) fill = Math.max(0, fill - dt * 1.5);
          }
          if (exhaleAt > 0 && now > exhaleAt) {
            const n = Math.round(10 + exhaleK * 26);
            for (let k = 0; k < n; k++) puff(W * 0.5 + (Math.random() - 0.5) * 30 * S, H + 10 * S, (Math.random() - 0.5) * 70 * S + 20 * S, -(120 + Math.random() * 140) * S * (0.6 + exhaleK), (14 + Math.random() * 18) * S, 2.4 + Math.random() * 1.6, 0.55, 34);
            SND.exhale(exhaleK); exhaleAt = 0; fill = 0;
          }
          if (c.ash > (cigar ? 0.07 : 0.1) && !drawing && Math.random() < dt * 0.6) { const q = at(cigTip); bits.push({ x: q[0], y: q[1], vx: (Math.random() - 0.5) * 30, vy: 20, r: 4 * S, col: '#8d8a86', life: 1.5, age: 0 }); c.ash = 0.01; }
          if (c.len <= (cigar ? 0.3 : 0.34)) { phase = 'done'; t = 0; say(cigar ? 'You let it go out in the ashtray.' : 'Down to the filter.'); }
        }
        if (phase === 'done') { gone = ease(t / 1.2); if (t > 1.6) return false; }
        if (c.lit && Math.random() < dt * 14) { const q = at(cigTip); puff(q[0], q[1], (Math.random() - 0.5) * 6 * S, -(22 + Math.random() * 14) * S, 2 * S, 3.4, 0.22, 9); }
        return true;
      },
      draw(now) {
        let base = MB, dir = mdir;
        if (phase === 'appear' || phase === 'tomouth' || phase === 'cut') {
          // out of the box: turning end over end in the middle of the view, catching the light
          const k = phase === 'appear' ? backOut(t / 0.9) : 1, spin = phase === 'appear' ? (1 - ease(t / 1.3)) * Math.PI * 3 : 0;
          const P = [0, 0.4 + (1 - k) * -3, cigar ? -24 : -17], d0 = [Math.cos(spin - 0.2), Math.sin(spin * 0.5) * 0.3 + 0.12, Math.sin(spin - 0.2) * 0.6];
          let b0 = [P[0] - d0[0] * K.L / 2, P[1] - d0[1] * K.L / 2, P[2] - d0[2] * K.L / 2];
          if (phase === 'tomouth') { const e = ease(t / 0.7); b0 = b0.map((v, i) => lerp(v, MB[i], e)); dir = d0.map((v, i) => lerp(v, mdir[i] / K.L, e)); } else dir = d0;
          base = b0;
          if (phase === 'appear') { const q = at(P); sparkle(ctx, q[0], q[1], 130 * S, t, S); glowAt(ctx, q[0], q[1], 120 * S, '#ffd28a', 0.22 * (1 - t / 1.3)); }
        }
        if (gone) base = [base[0], base[1] - gone * 4, base[2] + gone * 2];
        CMnow = M(T(...base), alignY(dir));
        const r = drawCig(CMnow, c, K);
        if (phase === 'cut') {
          // a chrome cutter over the head: its body with the hole through it, and the blade across
          const CC = M(CMnow, T(0, 0.25, 0));
          g3.draw(g3.mesh('cutter', () => rprism(3.6, 2.4, -0.3, 0.3, 0.55, 6)), M(CC, T(1.0, 0, 0)), CHROME);
          for (const y of [-0.31, 0.31]) g3.draw(mesh.cyl(), M(CC, T(0, y - 0.01, 0), S3(K.R * 1.15, 0.02, K.R * 1.15)), { color: '#111214', spec: 4 });
          g3.draw(g3.mesh('cutblade', () => rprism(2.2, 2.0, -0.06, 0.06, 0.2, 3)), M(CC, T(lerp(2.4, 0.2, ease(cutT)), 0, 0)), { color: '#eef1f4', metal: 1, spec: 140 });
        }
        if (capBit) g3.draw(mesh.sph(), M(T(...capBit.p), RZ(capBit.a), S3(K.R, K.R * 0.45, K.R)), { color: '#6a4224', noise: 0.3, spec: 14 });
        cigTip = r.tip; cigBurn = r.burn;
        if (c.lit) { const q = at(cigBurn); glowAt(ctx, q[0], q[1], q[2] * (0.9 + c.ember * 1.3), '#ff6a1e', 0.25 + c.ember * 0.45); }
        else if (c.glow > 0) { const q = at(cigTip); glowAt(ctx, q[0], q[1], q[2] * 1.2, '#ff7a2a', c.glow * 0.6); }
        if (['lid', 'strike', 'light', 'lit'].includes(phase) && aim) {
          const in0 = phase === 'lid' ? ease(t / 0.4) : 1;
          const pos = [aim[0] + away * 3, lerp(aim[1] - 9, aim[1], in0) - away * 9, aim[2]];
          const ZM = M(T(...pos), RY(-0.5 + (mouse ? (mouse[0] / W - 0.5) * 0.4 : 0)), RX(0.15), S3(0.72), T(-WICK[0], -WICK[1], -WICK[2]));
          zp = drawZippo(ZM, z);
          if (z.flame > 0) { const q = at(zp.wick); drawFlame(ctx, q[0], q[1], q[2] * 2.6, Math.sin(now * 0.004) * 4 * S, now, z.flame); }
        }
        if (phase === 'drag' || (phase === 'lit' && t > 1)) drawMeter(fill, drawing, cigar ? 'PUFF' : 'DRAG');
      },
      cancel() { wantMouse(false); },
    };
    function release(forced) {
      drawing = false;
      const k = fill;
      // in the green it goes down smooth; over it, the head swims
      if (!forced && k > 0.85) { dizzy = Math.min(1.4, dizzy + (k - 0.85) * 4); say(cigar ? 'You inhaled it. Your head spins.' : 'That one went to your head.'); }
      else if (!forced && k >= 0.55) say('Smooth.');
      else if (forced) say('Too much. You cough it up.');
      else say(`Hold Space to take a ${DRAG}. Let go in the green.`);
      exhaleAt = performance.now() + (forced ? 150 : 700); exhaleK = forced ? 1.2 : k;
    }
  }
  function drawMeter(fill, drawing, label) {
    const x = W - 46 * S, h = 170 * S, y = H * 0.5 - h / 2, w = 14 * S;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, x - 5 * S, y - 22 * S, w + 10 * S, h + 30 * S, 6 * S); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(70,190,110,0.45)'; ctx.fillRect(x, y + h * 0.15, w, h * 0.3);
    ctx.fillStyle = 'rgba(210,70,50,0.45)'; ctx.fillRect(x, y, w, h * 0.15);
    const fy = y + h * (1 - Math.min(1, fill));
    ctx.fillStyle = fill > 0.85 ? '#ff7a50' : fill >= 0.55 ? '#7ce39a' : '#e9dcc6';
    ctx.fillRect(x, fy, w, y + h - fy);
    if (drawing) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x - 3 * S, fy - 1, w + 6 * S, 2); }
    ctx.fillStyle = '#cfd6de'; ctx.font = `${Math.round(10 * S)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y - 8 * S);
    ctx.restore();
  }

  // ── a bottle (or a flute) ─────────────────────────────────────────────────
  function drinkActivity(item) {
    const shape = vesselOf(item.name) === 'flute' ? 'flute' : 'lager';
    const b = { shape, tint: tintOf(item.name), glass: /lager|beer|ale|stout/i.test(item.name) ? '#5a3410' : '#a9cbbd', level: shape === 'flute' ? 0.85 : 0.94, cap: shape === 'lager' };
    let phase = 'appear', t = 0, tilt = 0, glugAt = 0, held = 0, cap = null, BM = null;
    SND.shimmer();
    const top = BOTTLES[shape].top;
    return {
      click() { if (phase === 'cap') crack(); },
      key(down) { if (down && phase === 'cap') crack(); },
      update(dt, now) {
        t += dt;
        if (phase === 'appear' && t > 0.7) { phase = b.cap ? 'cap' : 'ready'; t = 0; say(b.cap ? 'Click to crack it open.' : 'Hold Space to drink.'); wantMouse(b.cap, 'pointer'); }
        if (phase === 'ready' || phase === 'cap') {
          const drinking = phase === 'ready' && space;
          tilt = lerp(tilt, drinking ? 1 : 0, 1 - Math.exp(-dt * 6));
          if (drinking) {
            held += dt;
            if (tilt > 0.8) { b.level = Math.max(0, b.level - dt * 0.2); if (now > glugAt) { SND.glug(); glugAt = now + 330 + Math.random() * 80; } }
            if (held > 3.4) { SND.cough(); held = 0; space = false; say('Too fast. You splutter and come up for air.'); }
          } else held = Math.max(0, held - dt * 2);
          if (b.level <= 0.01) { phase = 'done'; t = 0; send(`drink ${item.name}`); say(''); }
        }
        if (cap) { cap.v[1] -= 60 * dt; for (let i = 0; i < 3; i++) cap.p[i] += cap.v[i] * dt; cap.a += dt * 20; if (cap.p[1] < -40) cap = null; }
        if (phase === 'done') { tilt = lerp(tilt, 0, 1 - Math.exp(-dt * 6)); if (t > 1) return false; }
        return true;
      },
      draw() {
        const rise = phase === 'appear' ? backOut(t / 0.7) : phase === 'done' ? 1 - ease(t / 0.9) : 1;
        const spin = phase === 'appear' ? (1 - ease(t / 0.7)) * 2.5 : 0;
        // upright low on the right; tipped back, the neck comes to your mouth and the base rises away
        const e = ease(tilt);
        const pivot = [lerp(8.5, 0, e), lerp(2.5 - (1 - rise) * 26, -4.6, e), lerp(-40, -13, e)];
        BM = M(T(...pivot), RX(lerp(-0.06, 2.3, e)), RZ(lerp(-0.05, 0, e)), RY(spin + 0.4), T(0, -top, 0));
        drawBottle(BM, b);
        if (phase === 'appear') { const q = at(pivot); sparkle(ctx, q[0], q[1] + 60 * S, 110 * S, t, S); }
        if (cap) g3.draw(mesh.cyl(), M(T(...cap.p), RX(cap.a), RZ(cap.a * 0.6), S3(1.6, 0.7, 1.6)), { color: '#c9b46a', metal: 0.85, spec: 70, stripe: 21 });
      },
      cancel() { wantMouse(false); },
    };
    function crack() {
      b.cap = false; SND.cap(); phase = 'ready'; t = 0; wantMouse(false);
      const p = apply(BM, [0, top, 0]);
      cap = { p, v: [6 + Math.random() * 4, 28, 3], a: 0 };
      const q = at(p);
      for (let k = 0; k < 10; k++) puff(q[0], q[1], (Math.random() - 0.5) * 30 * S, -(40 + Math.random() * 40) * S, 4 * S, 1, 0.5, 20);
      say('Hold Space to drink.');
    }
  }

  // ── food ──────────────────────────────────────────────────────────────────
  function eatActivity(item) {
    const kind = foodOf(item.name), N = kind === 'cocktail' ? 6 : kind === 'hotdog' ? 6 : 4;
    const half = kind === 'hotdog' ? 8.6 : 5.4;
    let phase = 'appear', t = 0, chomp = 0, eaten = 0, cut = half + 1, FM = null;
    SND.shimmer();
    const bite = () => {
      if (phase !== 'ready' || chomp > 0) return;
      chomp = 0.001;
      setTimeout(() => {
        if (act?.eat !== true) return;
        SND.bite(); eaten++;
        const q = at(apply(FM, [cut - 1, 3, 0]));
        for (let k = 0; k < 8; k++) bits.push({ x: q[0], y: q[1], vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 60, r: (2 + Math.random() * 3) * S, col: kind === 'cocktail' ? '#f08a5c' : '#d9a868', life: 1.2, age: 0 });
        if (eaten >= N) { phase = 'done'; t = 0; send(`eat ${item.name}`); say(''); }
      }, 140);
    };
    return {
      eat: true,
      click: bite,
      key(down) { if (down) bite(); },
      update(dt) {
        t += dt;
        if (phase === 'appear' && t > 0.7) { phase = 'ready'; t = 0; say('Space or click to take a bite.'); wantMouse(true, 'pointer'); }
        if (chomp > 0) { chomp += dt / 0.32; if (chomp >= 1) chomp = 0; }
        // each mouthful takes the next stretch off the right-hand end, the edge eased in
        const want = half + 1 - (eaten / N) * (2 * half + 2.5);
        cut = lerp(cut, want, 1 - Math.exp(-dt * 18));
        if (phase === 'done' && t > 0.6) return false;
        return true;
      },
      draw() {
        const rise = phase === 'appear' ? backOut(t / 0.7) : 1;
        const lift = chomp > 0 ? Math.sin(chomp * Math.PI) : 0;
        const spin = phase === 'appear' ? (1 - ease(t / 0.7)) * 3 : 0;
        const pos = [0, -4.2 - (1 - rise) * 16 + lift * 2, -38 + lift * 8];
        FM = M(T(...pos), RX(0.42), RY(-0.35 + spin), T(0, kind === 'cocktail' ? -4 : 0, 0));
        const cutX = phase === 'done' ? -1e6 : apply(T(...pos), [cut, 0, 0])[0];
        drawFood(FM, kind, { cutX, shrimp: N - eaten });
        if (phase === 'appear') { const q = at(pos); sparkle(ctx, q[0], q[1], 120 * S, t, S); }
      },
      cancel() { wantMouse(false); },
    };
  }

  // ── the glass ─────────────────────────────────────────────────────────────
  const glassFill = () => (glass.mixed ? glass.level : glass.layers.reduce((a, l) => a + l.amt, 0));
  const glassHome = () => g3.unproject(70 * S, H - 14 * S, 40);
  function glassIntro(item) {
    let t = 0;
    SND.clink();
    return {
      update(dt) { t += dt; if (t > 1.2) { glass = { name: item.name, layers: [], mixed: null, level: 0, sipAt: 0 }; showGlass(); return false; } return true; },
      draw() {
        const e = ease((t - 0.55) / 0.6), k = backOut(t / 0.5), home = glassHome();
        const pos = [lerp(0, home[0], e), lerp(-6 - (1 - k) * 10, home[1], e), lerp(-24, home[2], e)];
        drawGlass(M(T(...pos), RY(t * 3)), { layers: [], mixed: null, level: 0 });
        if (t < 0.6) { const q = at(pos); sparkle(ctx, q[0], q[1] - 60 * S, 100 * S, t, S); }
      },
    };
  }
  function pourActivity(item) {
    const tint = tintOf(item.name), b = { shape: 'spirit', tint, glass: /rum|whisk/i.test(item.name) ? '#6a3a16' : '#a9cbbd', level: 0.9, cap: false };
    const target = Math.min(1, glassFill() + 0.28);
    let phase = 'appear', t = 0, tilt = 0, poured = 0, pourAt = 0, spilt = 0;
    const GM = M(T(0, -9.5, -30));
    say('');
    return {
      key() {},
      update(dt, now) {
        t += dt;
        if (phase === 'appear' && t > 0.5) { phase = 'ready'; say('Hold Space to pour. Stop at the line.'); }
        if (phase === 'ready') {
          tilt = lerp(tilt, space ? 1 : 0, 1 - Math.exp(-dt * 7));
          if (tilt > 0.75) {
            const room = 1 - glassFill(), d = dt * 0.22;
            if (room > 0) { const top = glass.layers[glass.layers.length - 1]; if (top?.color === tint) top.amt += Math.min(d, room); else glass.layers.push({ color: tint, amt: Math.min(d, room) }); }
            else { spilt += dt; const q = at([3, 3, -30]); if (Math.random() < dt * 20) bits.push({ x: q[0] + (Math.random() - 0.5) * 50 * S, y: q[1], vx: (Math.random() - 0.5) * 80, vy: 30, r: 2.5 * S, col: tint, life: 1, age: 0 }); }
            poured += d;
            if (now > pourAt) { SND.pour(); pourAt = now + 50; }
          }
          if (poured > 0.02 && !space && tilt < 0.3) {
            const f = glassFill();
            say(spilt > 0.1 ? 'Over the top. It runs down the glass.' : Math.abs(f - target) < 0.05 ? 'A good measure.' : f > target ? 'Generous.' : 'A short one.');
            send(`mix ${item.name} into ${glass.name}`);
            phase = 'done'; t = 0;
          }
        }
        if (phase === 'done') { tilt = 0; if (t > 0.9) { showGlass(); return false; } }
        return true;
      },
      draw(now) {
        const gm = drawGlass(GM, glass);
        // the line to pour to, round the glass
        const lp = apply(GM, [0, HIGHBALL.lo + (HIGHBALL.hi - HIGHBALL.lo) * target, 3.2]), lq = at(lp);
        ctx.strokeStyle = 'rgba(255,230,140,0.85)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(lq[0] - 3.6 * lq[2], lq[1]); ctx.lineTo(lq[0] + 3.6 * lq[2], lq[1]); ctx.stroke(); ctx.setLineDash([]);
        const rise = phase === 'appear' ? backOut(t / 0.5) : phase === 'done' ? 1 - ease(t / 0.6) : 1;
        const e = ease(tilt);
        const lip = [lerp(9, 2.6, e), lerp(9 + (1 - rise) * 16, 6.2, e), -30];
        const BM = M(T(...lip), RZ(lerp(0.3, 2.15, e)), RY(0.5), T(0, -23, 0));
        drawBottle(BM, b);
        if (tilt > 0.75 && phase === 'ready') {
          // the stream from the lip to the surface, wavering
          const a = at(lip), s2 = at(gm.surface);
          ctx.strokeStyle = rgba(tint, clearLiquid(tint) ? 0.5 : 0.85); ctx.lineWidth = Math.max(2, 0.5 * a[2]); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(a[0], a[1]);
          ctx.quadraticCurveTo(lerp(a[0], s2[0], 0.75) + Math.sin(now * 0.03) * 2 * S, lerp(a[1], s2[1], 0.3), s2[0] + Math.sin(now * 0.05) * 2 * S, s2[1]);
          ctx.stroke();
        }
      },
    };
  }
  function glassActivity() {
    const gs = glass;
    let phase = gs.mixed ? 'ready' : gs.layers.length ? 'stir' : 'empty', t = 0, tilt = 0, stirAt = 0, sip = 0;
    if (phase === 'empty') { say('Your glass is empty. Take something from the bar to pour in it.'); setTimeout(() => { if (!act) say(''); }, 2600); return null; }
    say(phase === 'stir' ? 'Stirring...' : 'Hold Space to sip.');
    return {
      key() {},
      update(dt, now) {
        t += dt;
        if (phase === 'stir') {
          if (now > stirAt) { SND.clink(); stirAt = now + 260; }
          if (t > 1.6) { gs.mixed = blend(gs.layers); gs.level = glassFill(); gs.layers = []; send(`mix ${gs.name}`); phase = 'ready'; t = 0; say('Hold Space to sip.'); }
        } else if (phase === 'ready') {
          tilt = lerp(tilt, space ? 1 : 0, 1 - Math.exp(-dt * 6));
          if (space && tilt > 0.8 && now > gs.sipAt) {
            sip += dt;
            gs.level -= Math.min(dt * 0.25, gs.level);
            if (Math.random() < dt * 3) SND.glug();
            if (sip > 1.2 || gs.level <= 0.005) {
              send(`drink ${gs.name}`); sip = 0; gs.sipAt = now + 12000;
              say(gs.level <= 0.01 ? 'That\'s the glass done.' : 'Give it a minute to go down.');
              if (gs.level <= 0.01) { gs.mixed = null; gs.level = 0; phase = 'done'; t = 0; }
            }
          }
          if (!space && tilt < 0.05 && t > 0.4) { showGlass(); return false; }
        } else if (phase === 'done' && t > 1) { showGlass(); return false; }
        return true;
      },
      draw(now) {
        const e = ease(tilt), up = ease(t / 0.3);
        const pos = [lerp(-4, 0, e), lerp(-11 - (1 - up) * 6, -6, e), lerp(-26, -9, e)];
        const GM = M(T(...pos), RX(e * 1.35));
        drawGlass(GM, gs);
        if (phase === 'stir') {
          const a = now * 0.012;
          g3.draw(mesh.cyl(), M(GM, T(Math.cos(a) * 1.2, 1.2, Math.sin(a) * 1.2), RZ(-0.18), S3(0.12, 15, 0.12)), CHROME);
        }
      },
    };
  }
  function showGlass() {
    glassBtn.hidden = !glass || !!act;
    if (glass) glassBtn.title = glass.mixed ? 'Sip from your glass' : glass.layers.length ? 'Stir your glass' : 'Your glass is empty';
  }

  // ── the loop ──────────────────────────────────────────────────────────────
  function start(a) {
    if (!a) return;
    act = a; glassBtn.hidden = true; kick();
  }
  function end() { act?.cancel?.(); act = null; wantMouse(false); say(''); showGlass(); }
  function frame(now) {
    raf = 0;
    if (stopped) return;
    fit();
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    ctx.clearRect(0, 0, W, H);
    g3.begin(W, H);
    if (act && act.update(dt, now) === false) { const keep = prompt.textContent; end(); if (keep) { say(keep); setTimeout(() => { if (!act && prompt.textContent === keep) say(''); }, 2200); } }
    act?.draw(now);
    if (!act && glass) drawGlass(M(T(...glassHome()), RY(0.3)), glass);
    g3.end();
    // smoke and sparks over what you hold, then anything falling
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i]; p.age += dt;
      if (p.age > p.life) { smoke.splice(i, 1); continue; }
      p.x += p.vx * dt + Math.sin(p.age * 2 + p.spin) * 8 * S * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 0.9; p.vy *= 1 - dt * 0.7; p.r += dt * p.grow * S;
      ctx.globalAlpha = Math.min(1, p.age * 6) * (1 - p.age / p.life) * p.a;
      ctx.drawImage(PUFF, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]; p.age += dt;
      if (p.age > p.life) { sparks.splice(i, 1); continue; }
      p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.strokeStyle = `rgba(255,${200 + Math.random() * 55},120,${1 - p.age / p.life})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
    }
    ctx.restore();
    for (let i = bits.length - 1; i >= 0; i--) {
      const p = bits[i]; p.age += dt;
      if (p.age > p.life) { bits.splice(i, 1); continue; }
      p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.age / p.life; ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // a drag too long: the room sways and blurs and the edges go dark on your heartbeat
    if (dizzy > 0.01) {
      dizzy = Math.max(0, dizzy - dt * 0.11);
      const bpm = 70 + dizzy * 55, k = Math.min(1, dizzy);
      if (now > beatAt) { SND.beat(0.5 + k * 0.6); beatAt = now + 60000 / bpm; }
      const ph = 1 - Math.min(1, (beatAt - now) / (60000 / bpm)), thump = Math.exp(-ph * 9) + (ph > 0.27 ? 0.6 * Math.exp(-(ph - 0.27) * 9) : 0);
      const tt = now / 1000;
      host.style.filter = `blur(${(k * 2.2 + thump * k).toFixed(2)}px) saturate(${(1 - k * 0.35).toFixed(2)})`;
      host.style.transform = `rotate(${(Math.sin(tt * 0.9) * k * 2.2).toFixed(2)}deg) translate(${(Math.sin(tt * 0.7) * k * 9).toFixed(1)}px, ${(Math.cos(tt * 1.1) * k * 6).toFixed(1)}px) scale(${(1.02 + k * 0.03 + thump * 0.01 * k).toFixed(3)})`;
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(20,0,0,${(0.35 + thump * 0.3) * k})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    } else if (host.style.filter) { host.style.filter = ''; host.style.transform = ''; }
    if (act || smoke.length || sparks.length || bits.length || dizzy > 0.01 || glass) raf = requestAnimationFrame(frame);
  }

  return {
    busy: () => !!act,
    // what came off the menu: { id, name, kind, drinkable }
    take(item) {
      if (act || !item?.kind || !g3) return false;
      if (item.kind === 'smoke') start(smokeActivity(item));
      else if (item.kind === 'eat') start(eatActivity(item));
      else if (item.kind === 'glass') { if (!glass) start(glassIntro(item)); else return false; }
      else if (item.kind === 'pour' && glass && !glass.mixed && glassFill() < 0.98) start(pourActivity(item));
      else if (item.kind === 'drink' || (item.kind === 'pour' && item.drinkable)) start(drinkActivity(item));
      else return false;
      return true;
    },
    // Space drives every ritual and Escape puts it down; true when the key was ours
    key(e, down) {
      if (!act) return false;
      if (e.key === ' ' || e.code === 'Space') {
        if (e.repeat && down) return true;
        space = down; act.key?.(down); return true;
      }
      if (down && e.key === 'Escape') { end(); return true; }
      return false;
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      host.style.filter = ''; host.style.transform = '';
      cv.remove(); cg.remove(); prompt.remove(); glassBtn.remove();
    },
  };
}
