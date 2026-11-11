// Hologram adverts: what a holo screen on a building is showing right now, and the picture of it.
//
// A screen runs spots back to back like an ad break. A spot is three cards (the name, the line, the
// name over its small print), each held CARD_MS. Two kinds of spot share the screens:
//
//   authored   a `media_graphics` row of type 'holo_ad', baked into holo-ad-spots.js by
//              `npm run holoads:bake`. The brands the TV adverts already sell.
//   shop       made here from a named building near the screen: its name, its trade word and how
//              to walk there. The renderer hands the candidates in; nothing here knows the map.
//
// The schedule is a pure function of the screen's seed and the clock, so every client sees the
// same advert on the same screen and nothing is sent or stored for it.
//
// A card is a small canvas baked once per (spot, card) and kept in an LRU. Motion is the cut
// between cards plus whatever the renderer does to the pane (flicker, scan bars); a card is never
// repainted per frame, because a texture upload per screen per frame is what that would cost.
import { HOLO_SPOTS } from './holo-ad-spots.js';

export const CARD_MS = 3200;
export const CARDS = 3;
export const SPOT_MS = CARD_MS * CARDS;
export const CARD_W = 320, CARD_H = 180;
const CACHE_MAX = 48;

const FACES = {
  block: "900 %px 'Arial Black', Impact, 'Segoe UI', sans-serif",
  serif: "700 %px Georgia, 'Times New Roman', serif",
  script: "italic 700 %px Georgia, 'Times New Roman', serif",
  mono: "700 %px 'Courier New', Consolas, monospace",
};
// Every hologram screen in the city is cyan, whatever the advert's own colour.
export const HOLO_CYAN = '#5ac8ff';
const SHOP_COLS = ['#5ac8ff', '#ff5aa0', '#78ff8c', '#ffc850', '#b478ff'];

// A small integer hash, so a schedule doesn't depend on float sin() agreeing across machines.
function hash(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul(b | 0, 0x85EBCA6B)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12;
  return h >>> 0;
}
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

const AUTHORED = [];
for (const s of HOLO_SPOTS) for (let i = 0; i < Math.max(1, Math.min(4, s.weight | 0 || 1)); i++) AUTHORED.push(s);

// "3 NORTH 2 EAST": the walk from a screen to a shop, in the words a player types.
export function walkWords(dx, dy) {
  const parts = [];
  if (dy) parts.push(Math.abs(dy) + (dy < 0 ? ' NORTH' : ' SOUTH'));
  if (dx) parts.push(Math.abs(dx) + (dx > 0 ? ' EAST' : ' WEST'));
  return parts.join(' ');
}

// A shop's spot. `dx`/`dy` are tiles from the screen to the shop, +x east and +y south.
export function shopSpot(name, trade, dx, dy) {
  const brand = String(name || '').toUpperCase();
  const walk = walkWords(dx, dy);
  return {
    id: 'shop:' + brand + '|' + trade + '|' + walk, shop: true,
    brand, line: String(trade || '').toUpperCase(), small: walk,
    color: SHOP_COLS[strHash(brand) % SHOP_COLS.length], accent: '#ffffff', face: 'block', motif: 'bars',
  };
}

// What a screen shows at `now` (ms). `shops` is the renderer's list of nearby `{ name, trade, dx, dy }`
// (may be empty). Returns `{ spot, card }`, or null when there's nothing to show.
export function holoNow(seed, now, shops) {
  const t = now + (hash(seed, 7) % SPOT_MS);          // screens are out of step with each other
  const slot = Math.floor(t / SPOT_MS);
  const card = Math.floor((t - slot * SPOT_MS) / CARD_MS);
  const r = hash(seed, slot);
  const n = shops ? shops.length : 0;
  if (n && (!AUTHORED.length || (r & 0xff) < 115)) {
    const s = shops[(r >>> 8) % n];
    return { spot: shopSpot(s.name, s.trade, s.dx, s.dy), card };
  }
  if (!AUTHORED.length) return null;
  return { spot: AUTHORED[(r >>> 8) % AUTHORED.length], card };
}

// ── The picture ──────────────────────────────────────────────────────────────────────────────
const _cards = new Map();   // key → canvas, least recently used first

function setFont(g, face, px) { g.font = (FACES[face] || FACES.block).replace('%', String(Math.round(px))); }
function widthOf(g, s, px) { const m = g.measureText ? g.measureText(s) : null; return (m && m.width > 0) ? m.width : s.length * px * 0.6; }

// Break `text` into at most `maxLines` lines and return the largest size that fits the box.
function fitLines(g, text, face, boxW, boxH, maxLines, maxPx) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let best = null;
  for (let lines = 1; lines <= Math.min(maxLines, words.length); lines++) {
    // Greedy split into `lines` rows of roughly equal length.
    const total = words.join(' ').length, rows = [];
    let cur = '';
    for (const w of words) {
      const want = total / lines;
      if (cur && rows.length < lines - 1 && (cur + ' ' + w).length > want + 2) { rows.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    }
    rows.push(cur);
    let px = Math.min(maxPx, boxH / (rows.length * 1.12));
    setFont(g, face, px);
    const wide = Math.max(...rows.map((r) => widthOf(g, r, px)));
    if (wide > boxW) px *= boxW / wide;
    if (!best || px > best.px) best = { rows, px };
  }
  return best || { rows: [String(text)], px: maxPx };
}

function drawLines(g, fit, face, cx, cy, fill, glow) {
  setFont(g, face, fit.px);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = fit.px * 1.12, y0 = cy - (fit.rows.length - 1) * lh / 2;
  g.shadowColor = glow; g.shadowBlur = Math.max(4, fit.px * 0.35);
  g.fillStyle = fill;
  fit.rows.forEach((r, i) => g.fillText(r, cx, y0 + i * lh));
  g.shadowBlur = 0;
}

function motif(g, kind, col, seed) {
  g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
  const cx = CARD_W / 2, cy = CARD_H / 2;
  if (kind === 'burst') {
    g.globalAlpha = 0.16;
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2 + (seed % 7) * 0.1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 240, cy + Math.sin(a) * 240); g.stroke(); }
  } else if (kind === 'rings') {
    g.globalAlpha = 0.22;
    for (let r = 28; r < 190; r += 26) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  } else if (kind === 'grid') {
    g.globalAlpha = 0.14;
    for (let x = 16; x < CARD_W; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CARD_H); g.stroke(); }
    for (let y = 18; y < CARD_H; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(CARD_W, y); g.stroke(); }
  } else if (kind === 'bars') {
    g.globalAlpha = 0.2;
    g.fillRect(0, 14, CARD_W, 5); g.fillRect(0, CARD_H - 19, CARD_W, 5);
  }
  g.restore();
}

function paintCard(g, spot, card) {
  const col = HOLO_CYAN, acc = spot.accent || '#ffffff', face = spot.face || 'block';
  g.clearRect(0, 0, CARD_W, CARD_H);
  // The pane's own light: a wash, brighter in the middle, so the card reads without a wall behind it.
  const bg = g.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, col + '30'); bg.addColorStop(0.5, col + '5a'); bg.addColorStop(1, col + '30');
  g.fillStyle = bg; g.fillRect(0, 0, CARD_W, CARD_H);
  motif(g, spot.motif, col, strHash(spot.id || spot.brand));
  // Corner ticks, so the edge of the image is drawn and not just where the light stops.
  g.strokeStyle = acc; g.globalAlpha = 0.7; g.lineWidth = 2;
  for (const [x, y, sx, sy] of [[6, 6, 1, 1], [CARD_W - 6, 6, -1, 1], [6, CARD_H - 6, 1, -1], [CARD_W - 6, CARD_H - 6, -1, -1]]) {
    g.beginPath(); g.moveTo(x + sx * 18, y); g.lineTo(x, y); g.lineTo(x, y + sy * 18); g.stroke();
  }
  g.globalAlpha = 1;
  const boxW = CARD_W - 40;
  if (card === 0 || !spot.line) {
    drawLines(g, fitLines(g, spot.brand, face, boxW, CARD_H - 56, 2, 76), face, CARD_W / 2, CARD_H / 2, acc, col);
  } else if (card === 1) {
    drawLines(g, fitLines(g, spot.line, spot.shop ? face : 'serif', boxW, CARD_H - 60, 3, 54), spot.shop ? face : 'serif', CARD_W / 2, CARD_H / 2, acc, col);
  } else {
    const small = spot.small || '';
    drawLines(g, fitLines(g, spot.brand, face, boxW, small ? 70 : CARD_H - 56, 2, 58), face, CARD_W / 2, small ? 62 : CARD_H / 2, acc, col);
    if (small) drawLines(g, fitLines(g, small, 'mono', boxW, 62, 3, spot.shop ? 34 : 21), 'mono', CARD_W / 2, 128, col, col);
  }
  // Scan lines, in the artwork: every screen has them and they cost nothing here.
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 0; y < CARD_H; y += 4) g.fillRect(0, y, CARD_W, 1);
  g.globalCompositeOperation = 'source-over';
}

// The baked card for `spot` at `card`, or null where there's no canvas to bake on.
export function holoCard(spot, card) {
  if (!spot || typeof document === 'undefined') return null;
  const key = (spot.id || spot.brand) + '#' + card;
  let cv = _cards.get(key);
  if (cv) { _cards.delete(key); _cards.set(key, cv); return cv; }
  try {
    cv = document.createElement('canvas'); cv.width = CARD_W; cv.height = CARD_H;
    const g = cv.getContext('2d');
    if (!g) return null;
    paintCard(g, spot, card);
  } catch { return null; }
  cv._lit = 1;   // a hologram is light: the decal layer treats the card as emissive
  _cards.set(key, cv);
  if (_cards.size > CACHE_MAX) _cards.delete(_cards.keys().next().value);
  return cv;
}

export const holoSpotCount = () => HOLO_SPOTS.length;
