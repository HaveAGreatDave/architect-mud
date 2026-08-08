import { prefersReducedMotion } from '/shared/settings.js';
// Shared particle flame — the renderer behind the wanted-HUD stars, extracted so
// other surfaces can burn with the same fire instead of growing a second one.
//
// Two call sites today: the wanted HUD (a standing flame driven by heat 0–100)
// and the hero-poster mural word (a one-shot burn on reveal). The dials were
// tuned in tools/sandbox/heat-flame-lab.html and are passed in per call site, so each
// surface keeps its own feel while the physics and colour ramp stay in one place.
//
// The ramp is derived from the live theme --accent: dark ember -> hot core ->
// near-white tip, so the fire re-tints with the player's theme.

const MAX_PARTS = 260;      // default hard cap — the particle array can never run
                            // away. Raise per call site with the `max` dial when
                            // the fire is built from many small particles.

const hx = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export function accentRamp(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  // t<0 darkens toward black (embers), t>0 lightens toward white (hot tip).
  const mix = t => t < 0
    ? '#' + hx(r * (1 + t)) + hx(g * (1 + t)) + hx(b * (1 + t))
    : '#' + hx(r + (255 - r) * t) + hx(g + (255 - g) * t) + hx(b + (255 - b) * t);
  return [-0.78, -0.6, -0.4, -0.2, 0, 0.15, 0.3, 0.5, 0.7, 0.9].map(mix);
}

// Classic orange fire — used until/unless the theme --accent can be read.
const FALLBACK = ['#4a1204', '#6e1a06', '#9a2408', '#c8380d', '#f25311', '#ff7a1e', '#ff9c2c', '#ffc247', '#ffe38c', '#fff6d0'];
let RAMP = FALLBACK, rampKey = '';

export function refreshRamp() {
  try {
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (!acc || acc === rampKey) return RAMP;
    const ramp = accentRamp(acc);
    if (ramp) { RAMP = ramp; rampKey = acc; }
  } catch { /* keep current ramp */ }
  return RAMP;
}

const SPR = {};   // one soft sprite per ramp colour
function sprite(hex) {
  if (SPR[hex]) return SPR[hex];
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, hex); rg.addColorStop(0.55, hex + '88'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 32, 32); SPR[hex] = c; return c;
}

export const flick = (now, speed) =>
  0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 0.02 * speed) + 0.4 * Math.sin(now * 0.05 * speed + 1));

// A flame bound to one canvas. `dials` mirrors the wanted-HUD tuning:
//   density height flick spread psize   plus `wide` — emit evenly across the
// full width (a burning line of text) instead of a plume at the centre.
export class Flame {
  constructor(canvas, w, h, dials) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = w; this.h = h; this.dials = dials;
    this.parts = []; this.dpr = 0;
  }

  // `t` is 0–1 burn intensity. Returns true while anything is still alight.
  step(now, t) {
    const ctx = this.ctx, { w, h, dials } = this;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (d !== this.dpr || !this.canvas.width) {
      this.dpr = d;
      this.canvas.width = Math.round(w * d);
      this.canvas.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    let n = Math.round(t * t * 8 * dials.density * (0.72 + 0.28 * flick(now, dials.flick)));
    if (this.parts.length > (dials.max || MAX_PARTS)) n = 0;
    for (let i = 0; i < n; i++) {
      const x = dials.wide
        ? Math.random() * w
        : w / 2 + (Math.random() + Math.random() - 1) * w * dials.spread;
      this.parts.push({
        // `jitter` scatters the spawn line so a wide emitter reads as fire
        // rather than a lit bar. 0 (the wanted HUD) keeps the original plume.
        x, y: h - 2 - Math.random() * (dials.jitter || 0), vx: (Math.random() - 0.5) * 0.35,
        vy: (-(0.35 + Math.random() * 0.5) - (t * 1.3)) * dials.height, life: 1,
        dc: 0.020 + Math.random() * 0.016,
        sz: (3 + Math.random() * 3.5) * dials.psize, sw: Math.random() * 6.28, ss: 0.03 + Math.random() * 0.05,
      });
    }
    ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= q.dc; if (q.life <= 0) { this.parts.splice(i, 1); continue; }
      q.sw += q.ss; q.vy -= 0.028; q.x += q.vx + Math.sin(q.sw) * 0.4; q.y += q.vy;
      const age = 1 - q.life, ci = age < 0.32 ? 8 : age < 0.66 ? 5 : 2, s = q.sz * (0.5 + q.life * 0.8);
      ctx.globalAlpha = Math.min(1, q.life * 0.9) * (0.5 + 0.5 * t);
      ctx.drawImage(sprite(RAMP[ci]), q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    return t > 0 || this.parts.length > 0;
  }
}

// One-shot burn behind an inline element: ignite, roar, die back, self-remove.
// Used by the hero-poster mural reveal — the fire goes up FIRST and the glyphs
// come up out of it as it dies back (see .mural-word / @keyframes mural-ignite
// in styles.css, whose timings are matched to the envelope below).
const BURN = { density: 2.1, height: 0.9, flick: 1.1, spread: 0.3, psize: 0.85, wide: true, jitter: 14, max: 700 };

// The glyph run, not the line box. .mural-word shrink-wraps (width:fit-content)
// so offsetWidth is already right, but a Range over the contents measures the
// text directly — take the smaller of the two, which is always the lettering
// even if a caller hands us a full-width block.
function textWidth(el) {
  let range = Infinity;
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const w = r.getBoundingClientRect().width;
    if (w > 8) range = w;
  } catch { /* fall back to the box */ }
  const w = Math.min(el.offsetWidth || Infinity, range);
  return Number.isFinite(w) ? w : 200;
}

export function burnBehind(el, { rise = 250, hold = 2400, fade = 1400 } = {}) {
  if (!el || typeof document === 'undefined') return;
  if (prefersReducedMotion()) return;
  const w = Math.max(40, Math.round(textWidth(el))), h = Math.max(40, Math.round(el.offsetHeight * 2.2));
  if (!w) return;
  refreshRamp();

  // The canvas lives INSIDE the word and is centred on it, so the fire occupies
  // the letters' own space rather than hovering above the line. Measured before
  // insertion, since the Range above would otherwise include the canvas itself.
  const canvas = document.createElement('canvas');
  canvas.className = 'mural-flame';
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  el.appendChild(canvas);

  const flame = new Flame(canvas, w, h, BURN);
  const t0 = performance.now();
  const tick = (now) => {
    const ms = now - t0;
    const t = ms < rise ? ms / rise
      : ms < rise + hold ? 1
      : Math.max(0, 1 - (ms - rise - hold) / fade);
    if (flame.step(now, t)) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}
