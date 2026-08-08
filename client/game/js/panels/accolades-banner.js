import { prefersReducedMotion } from '/shared/settings.js';
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
 *     reading never gets pulled mid-sentence; leaving gives you 2.2s more. That
 *     grace is tuned to reading speed, not to the hold, so it stays useful if the
 *     hold is retuned again.
 *   • Max 3 stacked — a fourth unlock retires the oldest early.
 *
 * ── PERFORMANCE: why sparks are a pre-rendered sprite ────────────────────────
 * The first version drew each spark with `ctx.shadowBlur = 15` and two stroke()
 * calls under it, onto a canvas sized to the whole viewport at DPR 2. Canvas
 * shadowBlur allocates a temporary surface and runs a gaussian PER DRAW CALL, so
 * three simultaneous cards (34 sparks each = 102 live) meant ~204 blur passes per
 * frame over a ~15-megapixel surface. That locked the game up.
 *
 * Now: one glint is rendered ONCE into a small offscreen canvas and every spark is
 * a drawImage blit — no per-frame blur anywhere. The canvas is also sized to the
 * stack's own corner rather than the viewport, DPR is capped at 1.5 (these are
 * decorative glints; nobody can tell), and a global cap bounds the worst case no
 * matter how many cards fire. Keep all four of those if you touch this.
 */

const MAX_CARDS = 3;
const HOLD_MS = 5000;
const GRACE_MS = 2200;      // after the pointer leaves a card you paused
const FADE_MS = 520;        // must match the .accolade-card.leaving animation
const ACCOLADE_SFX_GAIN = 0.7;

const BURST = 18;           // sparks on card entry
const TRICKLE_MS = 300;     // the cue's shimmer partials are timed to this — see sfx-catalog
const MAX_SPARKS = 70;      // global ceiling; oldest dropped first
const FX_W = 420, FX_H = 560;   // canvas box, anchored over the stack's corner
const SPRITE_R = 16;        // half-size of the pre-rendered glint, in px

let stackEl = null;
let canvas = null;
let ctx2d = null;
let sprite = null;
let spriteKey = '';         // accent the sprite was baked with; rebuilt on theme change
let raf = null;
let sparks = [];
let accent = [255, 46, 196];
const live = [];
// A function, not a const: read at module load this only ever saw the state the
// page happened to boot in, so toggling Motion did nothing until a refresh.
const reduceMotion = () => prefersReducedMotion();

function ensureDom() {
  if (stackEl) return;
  stackEl = document.createElement('div');
  stackEl.id = 'accolade-stack';
  canvas = document.createElement('canvas');
  canvas.id = 'accolade-fx';
  document.body.appendChild(canvas);
  document.body.appendChild(stackEl);
  ctx2d = canvas.getContext('2d');
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
}

function sizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(FX_W * dpr);
  canvas.height = Math.round(FX_H * dpr);
  canvas.style.width = FX_W + 'px';
  canvas.style.height = FX_H + 'px';
}

/** Resolve the live --accent so sparks follow whatever theme is active. */
function readAccent() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (!raw) return;
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = raw;
  const hex = probe.fillStyle;
  if (hex.charAt(0) === '#') {
    if (hex.length === 4) {
      accent = [parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16)];
    } else {
      accent = [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
    }
  } else {
    const m = hex.match(/\d+/g);
    if (m) accent = [+m[0], +m[1], +m[2]];
  }
}

/**
 * Bake one glint: a soft accent halo, an accent cross, a brighter white cross and
 * a white core — everything the old per-spark draw did, done once. Rebuilt only
 * when the theme accent actually changes.
 */
function ensureSprite() {
  const rgb = accent.join(',');
  if (sprite && spriteKey === rgb) return;
  spriteKey = rgb;
  const s = document.createElement('canvas');
  s.width = s.height = SPRITE_R * 2;
  const g = s.getContext('2d');
  g.translate(SPRITE_R, SPRITE_R);

  const halo = g.createRadialGradient(0, 0, 0, 0, 0, SPRITE_R);
  halo.addColorStop(0, `rgba(${rgb},0.80)`);
  halo.addColorStop(0.32, `rgba(${rgb},0.22)`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = halo;
  g.beginPath(); g.arc(0, 0, SPRITE_R, 0, 6.2832); g.fill();

  g.lineCap = 'round';
  g.strokeStyle = `rgba(${rgb},0.95)`;
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-SPRITE_R * 0.82, 0); g.lineTo(SPRITE_R * 0.82, 0);
  g.moveTo(0, -SPRITE_R * 0.82); g.lineTo(0, SPRITE_R * 0.82);
  g.stroke();

  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-SPRITE_R * 0.5, 0); g.lineTo(SPRITE_R * 0.5, 0);
  g.moveTo(0, -SPRITE_R * 0.5); g.lineTo(0, SPRITE_R * 0.5);
  g.stroke();

  g.fillStyle = '#fff';
  g.beginPath(); g.arc(0, 0, 1.9, 0, 6.2832); g.fill();
  sprite = s;
}

/**
 * A spark is struck where it sits: it flares, barely drifts, and dies. Alpha
 * HOLDS near full before falling off a cliff (min(1, life*1.6)) rather than
 * decaying from frame one — a linear fade reads as dust, not as a glint.
 */
function addSpark(x, y, big) {
  if (sparks.length >= MAX_SPARKS) sparks.shift();
  sparks.push({
    x, y,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3 - 0.06,
    r: (big ? 3.6 : 2.4) + Math.random() * (big ? 2.0 : 1.4),
    life: 1,
    decay: 0.01 + Math.random() * 0.016,
    rot: Math.random() * 1.57,
  });
}

/** Card rect → canvas-local coords (the canvas is its own fixed corner box). */
function strikeAcross(el, n) {
  if (reduceMotion() || !el || !canvas) return;
  const c = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    addSpark(
      (r.left - c.left) + Math.random() * r.width,
      (r.top - c.top) + Math.random() * r.height,
      Math.random() < 0.28
    );
  }
}

function tick() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, FX_W, FX_H);
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    const a = Math.min(1, p.life * 1.6);
    const size = p.r * (0.65 + 0.35 * p.life) * 2.4;
    ctx2d.globalAlpha = a;
    ctx2d.save();
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate(p.rot);
    ctx2d.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx2d.restore();
  }
  ctx2d.globalAlpha = 1;
  // Stop the loop dead when there is nothing left to draw AND no card is alive —
  // an idle rAF on every client for a once-in-a-while banner is not free.
  raf = (sparks.length || live.length) ? requestAnimationFrame(tick) : null;
}
function ensureLoop() { if (!raf) raf = requestAnimationFrame(tick); }

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
  readAccent();
  ensureSprite();

  while (live.length >= MAX_CARDS) dismiss(live[0]);

  const el = document.createElement('div');
  el.className = 'accolade-card';
  // Single source of truth for the hold: the life bar's CSS animation reads this,
  // so retuning HOLD_MS can never leave the bar emptying at a different rate.
  el.style.setProperty('--accolade-hold', `${HOLD_MS}ms`);
  el.innerHTML =
    '<div class="accolade-scan"></div>' +
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
  // textContent, not innerHTML — entry copy is authored, but it is still content
  // flowing into markup and there is no reason for it to be able to carry any.
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

  if (!reduceMotion()) {
    // The cue's shimmer partials fire at 300/600/900ms to land with these.
    rec.trickle = setInterval(() => { if (!rec.gone) { strikeAcross(el, 2); ensureLoop(); } }, TRICKLE_MS);
    requestAnimationFrame(() => { strikeAcross(el, BURST); ensureLoop(); });
  }

  const def = window.SFXCatalog?.get('accolade-unlock');
  if (def) window.AudioEngine?.playSfx(def, ACCOLADE_SFX_GAIN);
}
