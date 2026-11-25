import { prefersReducedMotion } from '/shared/settings.js';
import { createAccoladeFx } from './gl/accolade-fx.js';
/**
 * Accolades — unlock banner.
 *
 * The server (plugins/accolades) decides *when* an entry is logged and pushes an
 * `accolade_unlocked` message; this module owns how it looks and how long it
 * lingers. Deliberately a corner stack rather than a centre-stage interrupt:
 * entries are private and land often enough early on that they must never sit in
 * the player's reading path.
 *
 * Behaviour that was specified and should survive refactors:
 *   • 5s life, with a bar along the bottom edge showing it run out, then a slow
 *     opacity fade where it stands — a card that slides away reads as dismissed,
 *     one that fades reads as finished.
 *   • Click anywhere to dismiss.
 *   • Hovering PAUSES the life bar (and the timer) so a card you are actually
 *     reading never gets pulled mid-sentence; leaving gives you 2.2s more.
 *   • Max 3 stacked — a fourth unlock retires the oldest early.
 *
 * The card is frosted glass in CSS (styles.css, "Accolades"). The sparkles are
 * 3-D points drawn on the GPU by gl/accolade-fx.js: glints struck on the pane,
 * embers thrown off the rim toward you, and comets running round the edge. The
 * sim is here and tiny; the renderer is one additive draw call. Keep the canvas
 * sized to the stack's corner, DPR capped at 1.5, the global particle cap, and
 * the loop stopping when nothing is alive: the first 2-D version, with a
 * shadowBlur per spark on a viewport-sized canvas, locked the game up.
 */

const MAX_CARDS = 3;
const HOLD_MS = 5000;
const GRACE_MS = 2200;      // after the pointer leaves a card you paused
const FADE_MS = 520;        // must match the .accolade-card.leaving animation
const ACCOLADE_SFX_GAIN = 0.33;  // puts the cue near the old bells' level

const BURST = 18;           // glints on card entry
const EMBERS = 34;          // embers thrown off the rim on entry
const COMETS = 2;           // sparks that run round the rim
const TRICKLE_MS = 300;     // the cue's shimmer partials are timed to this — see sfx-catalog
const MAX_SPARKS = 220;     // global ceiling; oldest dropped first
const FX_W = 460, FX_H = 600;   // canvas box, anchored over the stack's corner

let stackEl = null;
let canvas = null;
let fx = null;
let raf = null;
let sparks = [];
let palette = [[1, 0.18, 0.77]];
const live = [];
const reduceMotion = () => prefersReducedMotion();
const dprNow = () => Math.min(window.devicePixelRatio || 1, 1.5);

function ensureDom() {
  if (stackEl) return;
  stackEl = document.createElement('div');
  stackEl.id = 'accolade-stack';
  canvas = document.createElement('canvas');
  canvas.id = 'accolade-fx';
  document.body.appendChild(canvas);
  document.body.appendChild(stackEl);
  sizeCanvas();
  try { fx = createAccoladeFx(canvas, MAX_SPARKS); } catch { fx = null; }
  window.addEventListener('resize', sizeCanvas);
}

function sizeCanvas() {
  if (!canvas) return;
  const dpr = dprNow();
  canvas.width = Math.round(FX_W * dpr);
  canvas.height = Math.round(FX_H * dpr);
  canvas.style.width = FX_W + 'px';
  canvas.style.height = FX_H + 'px';
}

function parseColour(raw) {
  if (!raw) return null;
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000';
  probe.fillStyle = raw;
  const hex = probe.fillStyle;
  let c = null;
  if (hex.charAt(0) === '#') {
    c = hex.length === 4
      ? [parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16)]
      : [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
  } else {
    const m = hex.match(/\d+/g);
    if (m) c = [+m[0], +m[1], +m[2]];
  }
  return c && c.map(v => v / 255);
}

/** The live theme colours, so the sparks follow whatever theme is active. */
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const out = [];
  for (const v of ['--accent', '--accent2', '--cyan']) {
    const c = parseColour(cs.getPropertyValue(v).trim());
    if (c && !out.some(o => o.join() === c.join())) out.push(c);
  }
  if (out.length) palette = out;
}

function addSpark(p) {
  if (sparks.length >= MAX_SPARKS) sparks.shift();
  p.life = 1;
  // The accent carries most of the sparks; the other theme colours accent them.
  p.col = p.col ?? palette[Math.random() < 0.6 ? 0 : (Math.random() * palette.length) | 0];
  p.rot = p.rot ?? Math.random() * 1.57;
  p.spin = p.spin ?? (Math.random() - 0.5) * 0.04;
  p.tw = Math.random() * 6.28;
  p.z = p.z ?? 0; p.vz = p.vz ?? 0;
  sparks.push(p);
}

function localRect(el) {
  const c = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
}

/** Glints: struck on the pane, they flare, barely drift, and die. */
function glintsAcross(el, n) {
  if (!el || !canvas) return;
  const r = localRect(el);
  for (let i = 0; i < n; i++) {
    const big = Math.random() < 0.25;
    addSpark({
      kind: 'glint',
      x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h, z: -Math.random() * 40,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3 - 0.06,
      size: big ? 34 + Math.random() * 16 : 16 + Math.random() * 10,
      decay: 0.01 + Math.random() * 0.016,
    });
  }
}

/** Embers: thrown off the rim, outward and toward you, slowing and falling. */
function burstFrom(el, n) {
  if (!el || !canvas) return;
  const r = localRect(el);
  const cx = r.x + r.w * 0.5, cy = r.y + r.h * 0.5;
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    const side = (Math.random() * 4) | 0;
    const x = side === 0 ? r.x + t * r.w : side === 1 ? r.x + r.w : side === 2 ? r.x + t * r.w : r.x;
    const y = side === 0 ? r.y : side === 1 ? r.y + t * r.h : side === 2 ? r.y + r.h : r.y + t * r.h;
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    const sp = 1.4 + Math.random() * 3.0;
    addSpark({
      kind: 'ember', x, y, z: 0,
      vx: dx / d * sp + (Math.random() - 0.5), vy: dy / d * sp * 0.7 - 1.4 * Math.random(),
      vz: -(2 + Math.random() * 7),
      size: 10 + Math.random() * 14,
      decay: 0.014 + Math.random() * 0.018,
      spin: (Math.random() - 0.5) * 0.2,
    });
  }
}

/** Comets ride the card's edge, re-reading its rect so they follow it. */
function launchComets(rec, n) {
  for (let i = 0; i < n; i++) {
    addSpark({ kind: 'comet', rec, u: i / n, du: 0.008 + i * 0.0016, x: 0, y: 0, vx: 0, vy: 0, z: -6,
      size: 40, decay: 0.0072, col: palette[i % palette.length], spin: 0.09 });
  }
}
function perimeterPoint(r, u) {
  const P = 2 * (r.w + r.h);
  let s = (((u % 1) + 1) % 1) * P;
  if (s < r.w) return [r.x + s, r.y];
  s -= r.w; if (s < r.h) return [r.x + r.w, r.y + s];
  s -= r.h; if (s < r.w) return [r.x + r.w - s, r.y + r.h];
  s -= r.w; return [r.x, r.y + r.h - s];
}

const drawList = [];
function tick(now) {
  const trail = [];
  drawList.length = 0;
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.life -= p.decay;
    if (p.life <= 0 || (p.kind === 'comet' && p.rec.gone)) { sparks.splice(i, 1); continue; }
    let a, size;
    if (p.kind === 'comet') {
      p.u += p.du;
      [p.x, p.y] = perimeterPoint(localRect(p.rec.el), p.u);
      if (Math.random() < 0.7) trail.push(p);
      a = Math.min(1, p.life * 2.5);
      size = p.size;
    } else if (p.kind === 'ember') {
      p.vx *= 0.95; p.vy = p.vy * 0.95 + 0.07; p.vz *= 0.96;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      a = Math.min(1, p.life * 1.5);
      size = p.size * (0.35 + 0.65 * p.life);
    } else {
      p.x += p.vx; p.y += p.vy;
      a = Math.min(1, p.life * 1.6);
      size = p.size * (0.65 + 0.35 * p.life);
    }
    p.rot += p.spin;
    drawList.push({ x: p.x, y: p.y, z: p.z, size, r: p.col[0], g: p.col[1], b: p.col[2], a, rot: p.rot, tw: p.tw });
  }
  for (const c of trail) {
    addSpark({ kind: 'ember', x: c.x, y: c.y, z: c.z, col: c.col,
      vx: (Math.random() - 0.5) * 0.7, vy: (Math.random() - 0.5) * 0.7, vz: -Math.random() * 1.5,
      size: 7 + Math.random() * 7, decay: 0.035 + Math.random() * 0.03 });
  }
  fx.draw(drawList, FX_W, FX_H, dprNow(), now / 1000);
  // Stop the loop dead when there is nothing left to draw AND no card is alive —
  // an idle rAF on every client for a once-in-a-while banner is not free.
  raf = (sparks.length || live.length) ? requestAnimationFrame(tick) : null;
}
function ensureLoop() { if (fx && !raf) raf = requestAnimationFrame(tick); }

function dismiss(rec) {
  if (rec.gone) return;
  rec.gone = true;
  clearTimeout(rec.timer);
  clearInterval(rec.trickle);
  rec.el.classList.add('leaving');
  setTimeout(() => {
    rec.el.remove();
    const i = live.indexOf(rec);
    if (i >= 0) live.splice(i, 1);
  }, FADE_MS);
}

export function showAccoladeUnlock(msg) {
  if (!msg?.title) return;
  ensureDom();
  readPalette();

  while (live.length >= MAX_CARDS) dismiss(live[0]);

  const el = document.createElement('div');
  el.className = 'accolade-card';
  // Single source of truth for the hold: the life bar's CSS animation reads this.
  el.style.setProperty('--accolade-hold', `${HOLD_MS}ms`);
  el.innerHTML =
    '<div class="accolade-scan"></div>' +
    '<div class="accolade-sweep"></div>' +
    '<div class="accolade-rim"></div>' +
    '<div class="accolade-body">' +
      '<div class="accolade-kicker"><i>&#9679;</i><span>Accolade logged</span></div>' +
      '<div class="accolade-title"></div>' +
      '<div class="accolade-line"></div>' +
      '<div class="accolade-foot">' +
        '<span class="accolade-dismiss">click to dismiss</span>' +
        '<span class="accolade-xp"></span>' +
      '</div>' +
    '</div>' +
    '<div class="accolade-life"></div>';
  // textContent, not innerHTML: entry copy is content flowing into markup.
  el.querySelector('.accolade-title').textContent = msg.title;
  el.querySelector('.accolade-line').textContent = msg.line || '';
  el.querySelector('.accolade-xp').textContent = `+${msg.xp ?? 1} XP`;
  stackEl.appendChild(el);

  const rec = { el, gone: false, timer: null, trickle: null };
  live.push(rec);

  el.addEventListener('click', () => dismiss(rec));
  el.addEventListener('mouseenter', () => clearTimeout(rec.timer));
  el.addEventListener('mouseleave', () => { rec.timer = setTimeout(() => dismiss(rec), GRACE_MS); });
  rec.timer = setTimeout(() => dismiss(rec), HOLD_MS);

  if (!reduceMotion() && fx) {
    // The cue's shimmer partials fire at 300/600/900ms to land with these.
    rec.trickle = setInterval(() => { if (!rec.gone) { glintsAcross(el, 2); ensureLoop(); } }, TRICKLE_MS);
    requestAnimationFrame(() => { glintsAcross(el, BURST); burstFrom(el, EMBERS); launchComets(rec, COMETS); ensureLoop(); });
  }

  const def = window.SFXCatalog?.get('accolade-unlock');
  if (def) window.AudioEngine?.playSfx(def, ACCOLADE_SFX_GAIN);
}
