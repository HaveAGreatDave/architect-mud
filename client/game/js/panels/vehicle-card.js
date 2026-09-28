// A VEHICLE AS A CARD — the first screen at the truck depot and at the marina.
//
// The yard used to open on a 3-D showroom that was not the yard: a painted garage with every rig
// you own parked side by side in it, a second picture of a building the cab was about to put you
// inside for real. Now the real shed IS the showroom (you are seated in it the moment you pick a
// vehicle), so what the first screen has to do is much smaller — say which vehicles are yours, which
// are hired, and let you pick one. That is a hand of cards, and this file draws one.
//
// ── ⚠ NOT A SECOND RENDERER ──────────────────────────────────────────────────
// The vehicle on the card is `drawHangarFloorBay` with `flat: true`, which is the turntable the bench
// hero shot has always used: the same `aircraftFaces` mesh the windscreen, the depot floor and a
// stranger's contact draw, in the same livery conversion. What this file adds is only the
// cardboard — three backdrops, a shadow, the laminate — so there is nothing here that can disagree
// with the road about what the truck looks like.
//
// ── ⚠ THE BACKDROP IS A PROPERTY OF THE VEHICLE, NOT OF ITS POSITION IN THE HAND ─────────────
// `cardStyleFor` hashes the id, so a rig keeps its card through a re-push, a purchase that reorders
// the list, and the next session. Keyed on the index, buying a second truck would reshuffle the
// backdrop under the first one, which reads as the card being a different card.
//
// ── ⚠ DRAWN ONCE, NOT IN A LOOP ──────────────────────────────────────────────
// A card is a still life. The panels paint on open, on re-push and on resize and never from a rAF
// loop — a hand of eight cards redrawn sixty times a second is eight turntable renders a frame for a
// picture that does not move.
import { drawHangarFloorBay } from './aircraft3d.js';

export const CARD_STYLES = ['floodlit', 'sunburst', 'showroom'];
export const CARD_STYLE_NAMES = { floodlit: 'Under the floodlights', sunburst: 'Sunburst', showroom: 'Showroom' };

// FNV-1a over the id. Stable across sessions and machines, which Math.random is not.
export function cardSeed(id) {
  let h = 2166136261 >>> 0;
  for (const ch of String(id ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function cardStyleFor(id) { return CARD_STYLES[cardSeed(id) % CARD_STYLES.length]; }

// A small deterministic stream off the seed, for the variation inside one style (which pennant
// colour, which way the stripes run). Seeded per card so two cards with one style still differ.
function rngFrom(seed) {
  let h = (seed >>> 0) || 1;
  return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── The three backdrops ──────────────────────────────────────────────────────
// `hy` is the horizon as a fraction of the height. It is the same number the vehicle is stood on
// (see paintVehicleCard), so the ground in the picture and the ground under the wheels agree.
const HORIZON = 0.6;

function floodlit(ctx, w, h, rnd) {
  const hy = h * HORIZON;
  // A dusk sky, because a floodlit ground in daylight is just a ground.
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#10183a'); sky.addColorStop(0.55, '#3b2d63'); sky.addColorStop(0.86, '#c75a3a'); sky.addColorStop(1, '#f0a55a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hy + 1);
  // A far stand: a dark band with a row of lit windows along its top edge.
  ctx.fillStyle = '#1b1830'; ctx.fillRect(0, hy - h * 0.07, w, h * 0.07 + 1);
  for (let x = 4; x < w; x += 7) {
    ctx.fillStyle = rnd() < 0.55 ? 'rgba(255,214,140,0.8)' : 'rgba(255,214,140,0.25)';
    ctx.fillRect(x, hy - h * 0.065, 3, 2);
  }
  // Two light towers, one in each top corner, each a pole, a head of lamps and a bloom.
  for (const side of [-1, 1]) {
    const cx = w / 2 + side * w * 0.36, top = h * 0.07;
    ctx.strokeStyle = '#0b0d18'; ctx.lineWidth = Math.max(1.5, w * 0.012);
    ctx.beginPath(); ctx.moveTo(cx, top + h * 0.05); ctx.lineTo(cx + side * w * 0.02, hy - h * 0.06); ctx.stroke();
    const bloom = ctx.createRadialGradient(cx, top + h * 0.025, 0, cx, top + h * 0.025, w * 0.34);
    bloom.addColorStop(0, 'rgba(255,250,225,0.85)'); bloom.addColorStop(0.2, 'rgba(255,240,200,0.32)'); bloom.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = bloom; ctx.fillRect(0, 0, w, hy);
    const hw = w * 0.13, hh = h * 0.05;
    ctx.fillStyle = '#12131c'; ctx.fillRect(cx - hw / 2, top, hw, hh);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      ctx.fillStyle = '#fffbe8';
      ctx.fillRect(cx - hw / 2 + 2 + c * (hw - 4) / 4, top + 2 + r * (hh - 4) / 2, (hw - 4) / 4 - 1.5, (hh - 4) / 2 - 1.5);
    }
  }
  // The pitch: mown stripes in perspective, converging on the middle of the horizon.
  const gr = ctx.createLinearGradient(0, hy, 0, h);
  gr.addColorStop(0, '#2c5a2a'); gr.addColorStop(1, '#173a18');
  ctx.fillStyle = gr; ctx.fillRect(0, hy, w, h - hy);
  const n = 9, vx = w / 2;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a = (i - n / 2) / n, b = (i + 1 - n / 2) / n;
    ctx.fillStyle = 'rgba(120,190,90,0.13)';
    ctx.beginPath(); ctx.moveTo(vx + a * w * 0.5, hy); ctx.lineTo(vx + b * w * 0.5, hy);
    ctx.lineTo(vx + b * w * 4, h); ctx.lineTo(vx + a * w * 4, h); ctx.closePath(); ctx.fill();
  }
  // A chalk line across the foreground, bowed to read as lying on the ground.
  ctx.strokeStyle = 'rgba(240,240,225,0.55)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(w / 2, h * 1.02, w * 0.9, h * 0.2, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
}

// The three palettes the sunburst rotates through, so two sunburst cards in one hand are not twins.
const BURST = [
  ['#f4c44a', '#ec8a2c', '#7b3514'],
  ['#5fd0c8', '#2d8fa0', '#16384a'],
  ['#f07aa6', '#c84374', '#4a1734'],
];
function sunburst(ctx, w, h, rnd, seed) {
  const [a, b, dark] = BURST[seed % BURST.length];
  const cx = w / 2, cy = h * (HORIZON - 0.06), R = Math.hypot(w, h);
  ctx.fillStyle = b; ctx.fillRect(0, 0, w, h);
  const rays = 22, spin = rnd() * Math.PI;
  ctx.fillStyle = a;
  for (let i = 0; i < rays; i += 2) {
    const t0 = spin + (i / rays) * Math.PI * 2, t1 = spin + ((i + 1) / rays) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(t0) * R, cy + Math.sin(t0) * R); ctx.lineTo(cx + Math.cos(t1) * R, cy + Math.sin(t1) * R);
    ctx.closePath(); ctx.fill();
  }
  // A soft centre so the rays do not converge into a point behind the windscreen.
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.45);
  glow.addColorStop(0, 'rgba(255,248,225,0.75)'); glow.addColorStop(1, 'rgba(255,248,225,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  // Halftone in the lower corner: printed card stock, not a screen.
  ctx.fillStyle = dark;
  const step = Math.max(5, w * 0.035);
  for (let y = h * 0.62; y < h; y += step) for (let x = 0; x < w * 0.55; x += step) {
    const d = Math.hypot(x / (w * 0.55), (h - y) / (h * 0.38));
    const r = Math.max(0, (1 - d)) * step * 0.42;
    if (r > 0.3) { ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(x + ((y / step) % 2 ? step / 2 : 0), y, r, 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  // A plinth for the vehicle to stand on, so it is not floating in a pattern.
  const hy = h * HORIZON;
  const pl = ctx.createLinearGradient(0, hy, 0, h);
  pl.addColorStop(0, dark); pl.addColorStop(1, '#000');
  ctx.globalAlpha = 0.72; ctx.fillStyle = pl;
  ctx.beginPath(); ctx.ellipse(w / 2, hy + h * 0.08, w * 0.62, h * 0.11, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
}

function showroom(ctx, w, h, rnd) {
  const hy = h * HORIZON;
  const wall = ctx.createLinearGradient(0, 0, 0, hy);
  wall.addColorStop(0, '#0d1418'); wall.addColorStop(1, '#1f2e33');
  ctx.fillStyle = wall; ctx.fillRect(0, 0, w, hy + 1);
  // Wall panels: a row of tall recessed bays, faintly lit from below.
  const bays = 5;
  for (let i = 0; i < bays; i++) {
    const x0 = (i / bays) * w + 3, x1 = ((i + 1) / bays) * w - 3;
    const g = ctx.createLinearGradient(0, h * 0.1, 0, hy);
    g.addColorStop(0, 'rgba(90,150,160,0.03)'); g.addColorStop(1, 'rgba(90,150,160,0.16)');
    ctx.fillStyle = g; ctx.fillRect(x0, h * 0.1, x1 - x0, hy - h * 0.1 - 4);
  }
  // A checker floor in perspective. Each row is a band whose depth is solved rather than spaced,
  // so the tiles shrink toward the horizon the way a floor does.
  const floorG = ctx.createLinearGradient(0, hy, 0, h);
  floorG.addColorStop(0, '#2a3336'); floorG.addColorStop(1, '#0c1113');
  ctx.fillStyle = floorG; ctx.fillRect(0, hy, w, h - hy);
  const vx = w / 2, rows = 7, cols = 10;
  const yAt = (k) => hy + (h - hy) * Math.pow(k / rows, 1.7);
  const xAt = (c, y) => vx + (c - cols / 2) * (w / cols) * 2.2 * ((y - hy) / (h - hy) + 0.12);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if ((r + c) % 2) continue;
    const y0 = yAt(r), y1 = yAt(r + 1);
    ctx.fillStyle = 'rgba(210,225,228,0.08)';
    ctx.beginPath(); ctx.moveTo(xAt(c, y0), y0); ctx.lineTo(xAt(c + 1, y0), y0); ctx.lineTo(xAt(c + 1, y1), y1); ctx.lineTo(xAt(c, y1), y1); ctx.closePath(); ctx.fill();
  }
  // The spotlight: a cone from the ceiling and the pool it makes on the floor.
  const cone = ctx.createLinearGradient(0, 0, 0, hy + h * 0.1);
  cone.addColorStop(0, 'rgba(210,245,255,0.34)'); cone.addColorStop(1, 'rgba(210,245,255,0.03)');
  ctx.fillStyle = cone;
  ctx.beginPath(); ctx.moveTo(w * 0.44, 0); ctx.lineTo(w * 0.56, 0); ctx.lineTo(w * 0.98, hy + h * 0.12); ctx.lineTo(w * 0.02, hy + h * 0.12); ctx.closePath(); ctx.fill();
  const pool = ctx.createRadialGradient(w / 2, hy + h * 0.1, 0, w / 2, hy + h * 0.1, w * 0.55);
  pool.addColorStop(0, 'rgba(220,245,255,0.26)'); pool.addColorStop(1, 'rgba(220,245,255,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, hy, w, h - hy);
  // The lamp itself, and a thin lighting truss across the top.
  ctx.fillStyle = '#05080a'; ctx.fillRect(0, h * 0.03, w, 3);
  ctx.fillStyle = '#eef9ff'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.045, w * 0.06, 3, 0, 0, 7); ctx.fill();
  if (rnd() < 0.5) { ctx.fillStyle = 'rgba(255,120,60,0.5)'; ctx.fillRect(w * 0.08, h * 0.2, 2, hy - h * 0.25); }
}

/** Paint one of the three backdrops into `ctx` over a w×h box. */
export function paintCardBackdrop(ctx, w, h, style, seed = 0) {
  const rnd = rngFrom(seed);
  if (style === 'sunburst') sunburst(ctx, w, h, rnd, seed);
  else if (style === 'showroom') showroom(ctx, w, h, rnd);
  else floodlit(ctx, w, h, rnd);
}

// A canvas sized to its CSS box at the device ratio, and a context already carrying the transform,
// so everything below is written in CSS pixels. Returns null while the card is not laid out yet.
function sized(cv) {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height, dpr };
}

// One scratch canvas for every vehicle on every card, because the turntable clears whatever it is
// handed and so cannot be pointed straight at a card with a backdrop already on it.
let scratch = null;

/**
 * Paint a whole card: backdrop, the vehicle's shadow, the vehicle, the laminate.
 * `v` is `{ cls, variant, livery, yaw, fit, elev }` — exactly what drawHangarFloorBay takes.
 * `style` is one of CARD_STYLES; `seed` varies the details inside it.
 */
export function paintVehicleCard(cv, { style, seed = 0, v = null, dim = false } = {}) {
  const s = sized(cv);
  if (!s) return false;
  const { ctx, w, h, dpr } = s;
  ctx.clearRect(0, 0, w, h);
  paintCardBackdrop(ctx, w, h, style, seed);

  if (v && v.cls) {
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== cv.width || scratch.height !== cv.height) { scratch.width = cv.width; scratch.height = cv.height; }
    const sc = scratch.getContext('2d');
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    let anchor = null;
    try {
      anchor = drawHangarFloorBay(sc, {
        w, h, flat: true, cls: v.cls, variant: v.variant || '', armed: !!v.armed, livery: v.livery || {},
        yaw: v.yaw ?? 0.62, elev: v.elev ?? 0.3, zoom: v.zoom ?? 1, fit: v.fit ?? 1.7,
      });
    } catch { anchor = null; }
    // The shadow goes on the BACKDROP, under the machine, where the turntable says its ground is.
    // A card without one reads as a sticker of a truck on a picture of a field.
    const gx = anchor?.ground?.sx ?? w / 2, gy = anchor?.ground?.sy ?? h * HORIZON;
    const sh = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.46);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(gx, gy); ctx.scale(1, 0.24); ctx.translate(-gx, -gy);
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(gx, gy, w * 0.46, 0, 7); ctx.fill(); ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // The laminate: one diagonal sheen across the face, which is what makes a picture a card.
  const gl = ctx.createLinearGradient(0, 0, w, h);
  gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.38, 'rgba(255,255,255,0)');
  gl.addColorStop(0.46, 'rgba(255,255,255,0.13)'); gl.addColorStop(0.56, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
  // A card for something you cannot take out right now (at another yard, impounded) is shown
  // faded rather than hidden — the hand says what you own, and hiding one says you do not.
  if (dim) { ctx.fillStyle = 'rgba(8,10,14,0.55)'; ctx.fillRect(0, 0, w, h); }
  return true;
}

/** A card with no vehicle on it: the Buy and Rent slots at the end of the hand. */
export function paintSlotCard(cv, { style = 'showroom', seed = 0, glyph = '+' } = {}) {
  const s = sized(cv);
  if (!s) return false;
  const { ctx, w, h } = s;
  ctx.clearRect(0, 0, w, h);
  paintCardBackdrop(ctx, w, h, style, seed);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `700 ${Math.round(Math.min(w, h) * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, w / 2, h * 0.46);
  return true;
}

// ── THE CARD'S OWN STYLES ────────────────────────────────────────────────────
// One block, shared by the depot's hand and the marina's, so a card is one object in both places.
// The picture is the canvas; the name, the badge and the bar are HTML over it, so they read aloud and
// follow the theme. ⚠ THE CARD STOCK DOES NOT FOLLOW THE THEME, on purpose — a printed card is the
// colour it was printed, the same exception the depot carves out for its screens.
export function ensureCardStyles() {
  if (document.getElementById('vc-styles')) return;
  const s = document.createElement('style');
  s.id = 'vc-styles';
  s.textContent = `
  .vc-hand{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;align-content:start}
  .vc-wrap{display:flex;flex-direction:column;gap:5px;min-width:0}
  .vc-card{position:relative;display:block;width:100%;aspect-ratio:5/7;padding:0;cursor:pointer;overflow:hidden;
    border-radius:10px;border:3px solid #e9e1cf;background:#0b0e12;font-family:inherit;color:#fff;text-align:left;
    box-shadow:0 0 0 1px rgba(0,0,0,.55),0 6px 14px rgba(0,0,0,.45);transition:transform .12s,box-shadow .12s}
  .vc-card.floodlit{border-color:#e9e1cf}
  .vc-card.sunburst{border-color:#f3d27a}
  .vc-card.showroom{border-color:#b9c9cf}
  .vc-card.slot{border-style:dashed;border-color:color-mix(in srgb, var(--accent,#d8892e) 70%, #fff)}
  .vc-card:hover:not(:disabled):not(.static){transform:translateY(-3px) rotate(-.4deg);
    box-shadow:0 0 0 1px rgba(0,0,0,.55),0 12px 22px rgba(0,0,0,.5),0 0 14px color-mix(in srgb, var(--accent,#d8892e) 40%, transparent)}
  .vc-card:focus-visible{outline:2px solid var(--accent,#d8892e);outline-offset:2px}
  .vc-card:disabled{cursor:default}
  .vc-wrap.away .vc-card{filter:saturate(.55)}
  .vc-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
  .vc-badge{position:absolute;top:7px;right:7px;z-index:2;padding:2px 7px;border-radius:4px;font:700 10px/1.4 'Courier New',monospace;
    letter-spacing:1px;text-transform:uppercase;box-shadow:0 1px 3px rgba(0,0,0,.6);max-width:calc(100% - 14px);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vc-badge.owned{background:linear-gradient(170deg,#f2d27c,#b8892c);color:#2a1b04}
  .vc-badge.hired{background:linear-gradient(170deg,#bfe9d9,#5aa58c);color:#07261c}
  .vc-plate{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;flex-direction:column;gap:2px;padding:7px 8px 8px;
    background:linear-gradient(180deg,rgba(8,10,14,0),rgba(8,10,14,.82) 32%,rgba(8,10,14,.94));white-space:normal}
  .vc-plate b{font-size:13px;letter-spacing:1px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    text-shadow:0 1px 2px #000;color:#fff}
  .vc-sub{font-size:10.5px;color:#cfd8dd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .vc-bar{display:block;height:5px;margin-top:3px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden}
  .vc-bar i{display:block;height:100%;background:#5c8f6a}
  .vc-bar i.warn{background:#e8c07a}.vc-bar i.bad{background:#d2685c}
  .vc-acts{display:flex;flex-wrap:wrap;gap:4px}
  .vc-mini{flex:1 1 auto;font-family:inherit;font-size:11px;cursor:pointer;padding:4px 6px;border-radius:5px;color:inherit;opacity:.85;
    background:rgba(127,127,127,.12);border:1px solid color-mix(in srgb, var(--accent,#d8892e) 30%, transparent)}
  .vc-mini:hover{opacity:1;border-color:var(--accent,#d8892e)}
  .vc-mini:disabled{opacity:.4;cursor:default}
  @media (max-width:720px){ .vc-hand{grid-template-columns:repeat(auto-fill,minmax(128px,1fr))} }
  @media (prefers-reduced-motion:reduce){ .vc-card{transition:none} .vc-card:hover:not(:disabled):not(.static){transform:none} }
  `;
  document.head.appendChild(s);
}

/** A condition bar's tone, off the same three cut-offs both panels use. */
export const barTone = (v) => (v < 0.3 ? 'bad' : v < 0.6 ? 'warn' : 'ok');
