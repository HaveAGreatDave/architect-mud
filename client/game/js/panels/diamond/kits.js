/**
 * DEADBALL — the kits, painted.
 *
 * The textures the players wear (gl/ballplayer-mesh.js maps them):
 *
 *   kitAtlas   2048², a jersey in each of 28 slots of 512×256 (the cast's slots, diamond/cast.js)
 *              with the club's wordmark or nickname across the chest and the man's number on the
 *              back, and in the last row each side's trousers, and its socks over its sleeves
 *              (512×128 each: the sleeves have their own cloth, so the weave is the body's size);
 *   logoAtlas  2048×512, four 512² cells on clear (LOGO_CELLS): each side's cap mark for the cap
 *              and the helmet (its crest's `cap` drawing, else its small one, else the house
 *              kit's monogram), then each side's sleeve patch (its whole crest), all embroidered;
 *   leather, wood, mask: the gloves, the bat, the masks' bars.
 *
 * A side whose club has an identity (sports_pools.clubs) wears its own kit, home at home and road
 * away, with its wordmark across the chest and its crest's small drawing on the cap and helmet
 * (sideKit in gl/ballplayer-mesh.js). Any other side wears the house kit: cream with navy
 * pinstripes at home, grey with black and rust away, its nickname on the chest.
 *
 * With `ink` (the comic look, docs/proposals/comic-ink.md) each piece is painted the same and then
 * inked over, as a comic artist would: the numbers and lettering outlined, the seams and the
 * placket ruled by hand, fold strokes where the cloth gathers, a quarter-strength painted shadow
 * under the arms and at the tuck, and dirt on the trouser knees.
 *
 * DOM only for the canvases: nothing here reads the page.
 */

import { KITS, sideKit, kitCell, KIT_PANTS, KIT_SOCKS, KIT_SLEEVES, LOGO_CELLS } from '../gl/ballplayer-mesh.js';
import { paintCrest, paintLayers } from '../club-crest.js';
import { PAINTED, DIRT, inkLine, fold, patch, inkText } from '../comic-pen.js';

const SERIF = '"FreeSerif", Georgia, "Times New Roman", serif';
const SANS = '"FreeSans", "Arial Narrow", Arial, sans-serif';
export const KIT_SIZE = 2048;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const canvasOf = (doc, w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
// Over a jersey cell (512 x 256, chest at 128, back at 384, the sides at 0 and 256, collar on top).
function inkJersey(g, W, H, seed) {
  const r = rng(seed * 13 + 7);
  // painted shadow: under the arms, and where it tucks in at the belt
  for (const x of [0, 256, 512]) patch(g, x, 40, 70, 46, PAINTED);
  g.fillStyle = PAINTED + '0.22)'; g.fillRect(0, H - 16, W, 16);
  // the seams and the placket's edges, ruled by hand
  for (const x of [2, 256, W - 2]) inkLine(g, r, x, 0, x + (r() - 0.5) * 2, H, 2.6);
  inkLine(g, r, 123.5, 6, 123, H, 2); inkLine(g, r, 132.5, 6, 133, H, 2);
  // the collar's edge
  inkLine(g, r, 0, 2, W, 2, 2.4, 0.8);
  // folds pulling up off the tuck, and a few across the chest and back
  for (let i = 0; i < 22; i++) fold(g, r, r() * W, H * (0.72 + r() * 0.24), 18 + r() * 24, -Math.PI / 2 + (r() - 0.5) * 0.9, 1.6 + r() * 1.2);
  for (let i = 0; i < 8; i++) fold(g, r, (r() < 0.5 ? 40 : 296) + r() * 140, H * (0.25 + r() * 0.3), 22 + r() * 20, (r() < 0.5 ? 0.45 : -0.45) + (r() - 0.5) * 0.3, 1.4);
  // under the arms, gathered
  for (const x of [8, 248, 264, 504]) for (let i = 0; i < 3; i++) fold(g, r, x + (r() - 0.5) * 10, 18 + r() * 30, 14 + r() * 10, Math.PI / 2 + (r() - 0.5), 1.4);
}
// Over a trouser cell (512 x 256, the hip at the top, the knee about 190 down, the blouse at the foot).
function inkPants(g, seed) {
  const r = rng(seed);
  for (const x of [128, 384]) inkLine(g, r, x, 0, x + (r() - 0.5) * 2, 256, 2.2);
  g.fillStyle = PAINTED + '0.2)'; g.fillRect(0, 0, 512, 10);
  // the knees: dirt and a little grass
  for (const x of [0, 256, 512]) for (let i = 0; i < 6; i++) patch(g, x + (r() - 0.5) * 120, 188 + (r() - 0.5) * 34, 10 + r() * 24, 6 + r() * 10, DIRT);
  for (const x of [20, 276]) patch(g, x, 200, 26, 9, 'rgba(70,110,40,');
  // creases at the hip, behind the knee, and the blouse bunching over the stirrups
  for (let i = 0; i < 12; i++) fold(g, r, r() * 512, 4 + r() * 36, 20 + r() * 26, Math.PI / 2 + (r() - 0.5) * 0.5, 1.5);
  for (let i = 0; i < 10; i++) fold(g, r, (r() < 0.5 ? 128 : 384) + (r() - 0.5) * 120, 176 + r() * 30, 12 + r() * 12, (r() - 0.5) * 0.8, 1.4);
  for (let i = 0; i < 26; i++) fold(g, r, r() * 512, 222 + r() * 30, 12 + r() * 16, (r() < 0.5 ? 0.3 : -0.3) + Math.PI * (r() < 0.5 ? 0 : 1), 1.8 + r());
}
// Over a sock cell: the folds where the stirrup sags at the top.
function inkSocks(g, seed) {
  const r = rng(seed);
  for (let i = 0; i < 14; i++) fold(g, r, r() * 512, 4 + r() * 50, 12 + r() * 14, (r() - 0.5) * 0.5, 1.5);
  inkLine(g, r, 0, 70, 512, 70, 2); inkLine(g, r, 0, 122, 512, 122, 2);
}

// A club's nickname, the last word of its name: "Precinct 9 Enforcers" wears ENFORCERS.
export const nicknameOf = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).pop() || '';

const kitOf = (kit) => (typeof kit === 'string' ? KITS[kit] || KITS.home : kit || KITS.home);
// Flannel at a distance: a light and dark speckle over the cloth.
function flannel(g, W, H, seed) {
  const r = rng(seed);
  // heathered: soft streaks of lighter and darker yarn under the speckle
  for (let i = 0; i < 140; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)'; g.fillRect(r() * W, r() * H, 6 + r() * 18, 2 + r() * 4); }
  for (let i = 0; i < 2200; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1, 1); }
}

// The weave: a 2/1 twill on a 6-texel tile, the diagonal wale catching the light, laid over every
// shirt and pair of trousers so the cloth reads as cloth up close. One tile per document.
const WEAVES = new WeakMap();
function weaveTile(doc) {
  if (WEAVES.has(doc)) return WEAVES.get(doc);
  const c = canvasOf(doc, 6, 6), g = c.getContext('2d');
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    g.fillStyle = (x + y) % 3 !== 0 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)'; g.fillRect(x, y, 1, 1);
  }
  WEAVES.set(doc, c);
  return c;
}
function weave(g, W, H) {
  const doc = g.canvas && g.canvas.ownerDocument;
  const pat = doc && typeof g.createPattern === 'function' ? g.createPattern(weaveTile(doc), 'repeat') : null;
  if (!pat) return;
  g.save(); g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
}
// A soft crease painted without ink: a broad faint shadow, a fainter core, and the lit ridge beside
// it, so a fold has a side to it under any light. Faint on purpose: at full strength each one read
// as a pen stroke on the cloth, a row of eyebrows across the chest.
function crease(g, r, x, y, len, ang, w = 1) {
  const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len, bend = (r() - 0.5) * len * 0.4, nx = -Math.sin(ang), ny = Math.cos(ang);
  const path = (o) => { g.beginPath(); g.moveTo(x + nx * o, y + ny * o); g.quadraticCurveTo(x + dx / 2 + nx * (bend + o), y + dy / 2 + ny * (bend + o), x + dx + nx * o, y + dy + ny * o); };
  g.save(); g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.03)'; g.lineWidth = 12 * w; path(0); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.035)'; g.lineWidth = 5 * w; path(0); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.03)'; g.lineWidth = 6 * w; path(6 * w); g.stroke();
  g.restore();
}
const seamShade = (g, x, half, H, a) => {
  const sd = g.createLinearGradient(x - half, 0, x + half, 0);
  sd.addColorStop(0, 'rgba(0,0,0,0)'); sd.addColorStop(0.5, `rgba(0,0,0,${a})`); sd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sd; g.fillRect(x - half, 0, half * 2, H);
};
// The shirt's drape, painted: the pull from the shoulders down to the chest, the bunching under
// the arms and over the belt, and a little shade at the side seams where it turns away.
function drapeJersey(g, W, H, seed) {
  const r = rng(seed * 31 + 5);
  for (const x of [0, 256, 512]) seamShade(g, x, 40, H, 0.10);
  // the blouse over the belt, all the way round, and the gathering under each arm
  for (let i = 0; i < 12; i++) crease(g, r, r() * W, H * (0.82 + r() * 0.16), 14 + r() * 18, -Math.PI / 2 + (r() - 0.5) * 0.7, 0.9);
  for (const x of [10, 246, 266, 502]) for (let i = 0; i < 2; i++) crease(g, r, x + (r() - 0.5) * 10, 34 + r() * 26, 12 + r() * 10, Math.PI / 2 + (r() - 0.5) * 0.8, 0.8);
}
// The trousers' drape: shade at the side seams, a lit band over the knee, creases at the hip,
// behind the knee and where the blouse bunches over the stirrups.
function drapePants(g, seed) {
  const r = rng(seed * 17 + 3);
  for (const x of [128, 384]) seamShade(g, x, 36, 256, 0.09);
  const kn = g.createLinearGradient(0, 160, 0, 220);
  kn.addColorStop(0, 'rgba(255,255,255,0)'); kn.addColorStop(0.5, 'rgba(255,255,255,0.06)'); kn.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = kn; g.fillRect(0, 160, 512, 60);
  for (let i = 0; i < 5; i++) crease(g, r, r() * 512, 26 + r() * 30, 18 + r() * 22, Math.PI / 2 + (r() - 0.5) * 0.5, 0.9);
  // behind the knee (the back, a half) more than over it
  for (let i = 0; i < 5; i++) crease(g, r, 256 + (r() - 0.5) * 140, 176 + r() * 28, 12 + r() * 12, (r() - 0.5) * 0.8, 0.8);
  for (let i = 0; i < 12; i++) crease(g, r, r() * 512, 224 + r() * 28, 12 + r() * 14, (r() < 0.5 ? 0.3 : -0.3) + Math.PI * (r() < 0.5 ? 0 : 1), 1);
  const bs = g.createLinearGradient(0, 0, 0, 10);
  bs.addColorStop(0, 'rgba(0,0,0,0.2)'); bs.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bs; g.fillRect(0, 0, 512, 10);
}
// Tackle twill: the letter cut from cloth and sewn on. A shadow where it stands off the shirt, its
// edge colour, its face, a lit bevel on top, and the stitch just inside the edge.
function twill(g, text, x, y, fill, edge, edgeW, maxW) {
  g.save(); g.lineJoin = 'round';
  g.lineWidth = edgeW + 2; g.strokeStyle = 'rgba(0,0,0,0.28)'; g.strokeText(text, x + 1.5, y + 2, maxW);
  g.lineWidth = edgeW; g.strokeStyle = edge; g.strokeText(text, x, y, maxW);
  g.fillStyle = fill; g.fillText(text, x, y, maxW);
  g.globalAlpha = 0.35; g.lineWidth = Math.max(1, edgeW * 0.12); g.strokeStyle = '#ffffff'; g.strokeText(text, x - 0.6, y - 0.8, maxW);
  if (g.setLineDash) g.setLineDash([2, 2.5]);
  g.globalAlpha = 0.55; g.lineWidth = Math.max(0.8, edgeW * 0.1); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(text, x, y, maxW);
  g.restore();
}
// A word arched as a jersey's lettering is: each letter stood upright on a circle whose top runs
// through (cx, y) and whose centre is `R` below, the letters spaced by their own widths (an even
// step put a W on top of its neighbours). It's at most `px` tall and `span` wide: a long word is
// condensed to 0.8 of its width first, as a letterer would, and only then set smaller. `font(size)`
// is the CSS font; `each(ch, size)` draws one letter at the origin.
function archWord(g, word, cx, y, span, px, font, R, each) {
  const n = word.length, track = 0.07;
  if (!n) return;
  g.font = font(px); g.textAlign = 'center'; g.lineJoin = 'round';
  const widths = [...word].map((ch) => g.measureText(ch).width || px * 0.62);
  const raw = widths.reduce((a, b) => a + b, 0) + track * px * (n - 1);
  const squeeze = Math.max(0.8, Math.min(1, span / raw)), size = px * Math.min(1, span / (raw * squeeze));
  const k = size / px, total = raw * k * squeeze;
  g.font = font(size);
  let s = -total / 2;
  for (let i = 0; i < n; i++) {
    const w = widths[i] * k * squeeze, th = (s + w / 2) / R;
    g.save(); g.translate(cx + R * Math.sin(th), y + R * (1 - Math.cos(th))); g.rotate(th); g.scale(squeeze, 1);
    each(word[i], size);
    g.restore();
    s += w + track * size * squeeze;
  }
}
// A club's own jersey: its wordmark arched across the chest (serif at home, block on the road),
// the placket piped in its trim, its number on the back in its two number colours.
// Pinstripes, a hairline every 7.5 texels as the house home kit has them, in the kit's `stripe`
// (its ink if it gives none).
function pinstripes(g, K, W, H, a = 0.85) {
  g.save(); g.globalAlpha = a; g.fillStyle = K.stripe || K.ink;
  for (let px = 1.5; px < W; px += 7.5) g.fillRect(px, 0, 1, H);
  g.restore();
}
function paintClubJersey(g, K, num, W, H, seed, ink = false) {
  if (K.fabric === 'flannel') flannel(g, W, H, seed);
  if (K.fabric === 'pinstripe') pinstripes(g, K, W, H);
  g.fillStyle = K.ink; g.fillRect(126, 0, 4, H); g.fillStyle = K.trim; g.fillRect(130, 0, 1.5, H); g.fillRect(124.5, 0, 1.5, H);
  // The arch keeps to the front of the shirt: the cell's front half is the chest from one side seam
  // round to the other, and what shows from in front is about 170 texels of it either side of the
  // placket, so a word wider than that wraps round the ribs. A lone letter (the Bombers' B) is set
  // larger, on the left breast where a lone letter goes.
  const word = K.wordmark.toUpperCase().slice(0, 10), road = K.sig.startsWith('away:'), n = word.length;
  const face = road ? (sz) => `bold ${sz}px ${SANS}` : (sz) => `bold ${sz}px ${SERIF}`;
  const lone = n === 1, edgeOf = (sz) => Math.max(2.5, sz * 0.13);
  archWord(g, word, lone ? 172 : 128, lone ? 112 : 104, lone ? 70 : 168, lone ? 70 : road ? 42 : 46, face, lone ? 1e6 : 240, (ch, sz) => {
    if (ink) inkText(g, ch, 0, 0, edgeOf(sz) + 4);
    twill(g, ch, 0, 0, K.ink, K.trim, edgeOf(sz));
  });
  const [fill, edge] = K.number;
  g.font = `bold 95px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
  if (ink) inkText(g, num, 384, 165, 13);
  twill(g, num, 384, 165, fill || K.ink, edge || K.trim, 8);
  // the small number on the front, under the wordmark on the far side of the placket
  g.font = `bold 27px ${SANS}`;
  if (ink) inkText(g, num, 165, 150, 6);
  twill(g, num, 165, 150, fill || K.ink, edge || K.trim, 3);
}

// A man's surname across his back over the number, arched a little and set smaller to fit:
// the period's road shirts had them, and the arcade puts them on every shirt.
export const surnameOf = (id) => (typeof id === 'string' && id && !id.includes(':') ? id.trim().split(/\s+/).pop().toUpperCase().slice(0, 12) : '');
function paintBackName(g, name, fill, edge) {
  if (!name) return;
  archWord(g, name, 384, 68, 150, 26, (sz) => `bold ${sz}px ${SANS}`, 420, (ch) => twill(g, ch, 0, 0, fill, edge, 3));
}

// One jersey into a 512×256 rect at (x, y): the chest a quarter of the way across, the back
// three quarters, the collar at the top. `kit` is sideKit's, or a side for its house kit. `name`
// is the man's surname for his back (surnameOf), or nothing. `ink` inks it for the comic look.
export function paintJersey(g, x, y, kit, nickname, number, name = '', ink = false) {
  const K = kitOf(kit), W = 512, H = 256;
  g.save();
  g.beginPath(); g.rect(x, y, W, H); g.clip();
  g.translate(x, y);
  g.fillStyle = K.base; g.fillRect(0, 0, W, H);
  const num = String(number ?? '');
  if (!K.house) paintClubJersey(g, K, num, W, H, (Number(number) || 0) * 7 + 3, ink);
  else if (K === KITS.home) {
    g.fillStyle = 'rgba(22,38,74,0.85)';
    for (let px = 1.5; px < W; px += 7.5) g.fillRect(px, 0, 1, H);
    g.fillStyle = K.ink; g.fillRect(127, 0, 3, H);
    // the nickname in script across the chest, the tail swooping under it
    g.save(); g.translate(128, 98); g.rotate(-0.12);
    g.font = `italic bold 39px ${SERIF}`; g.textAlign = 'center'; g.lineJoin = 'round';
    twill(g, nickname, 0, 0, K.trim, K.ink, 4.5, 230);
    g.lineWidth = 3.5; g.strokeStyle = K.ink; g.beginPath(); g.moveTo(-75, 11); g.quadraticCurveTo(5, 23, 85, 4); g.stroke();
    g.restore();
    g.font = `bold 95px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
    if (ink) inkText(g, num, 384, 165, 13);
    twill(g, num, 384, 165, K.ink, K.trim, 8);
    g.font = `bold 27px ${SANS}`; twill(g, num, 165, 145, K.ink, K.trim, 3);
  } else {
    const r = rng((Number(number) || 0) * 7 + 3);
    for (let i = 0; i < 2200; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1, 1); }
    g.fillStyle = K.ink; g.fillRect(126, 0, 4, H); g.fillStyle = K.trim; g.fillRect(130, 0, 1.5, H); g.fillRect(124.5, 0, 1.5, H);
    // the nickname in arched block letters
    const word = nickname.toUpperCase().slice(0, 10);
    archWord(g, word, 128, 104, 168, 40, (sz) => `bold ${sz}px ${SANS}`, 240, (ch, sz) => twill(g, ch, 0, 0, K.trim, K.ink, Math.max(3, sz * 0.12)));
    g.font = `bold 95px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
    if (ink) inkText(g, num, 384, 165, 13);
    twill(g, num, 384, 165, K.trim, K.ink, 8);
    g.font = `bold 27px ${SANS}`; twill(g, num, 165, 145, K.trim, K.ink, 3);
  }
  // his name over his number, in the number's colours
  {
    const [fill, edge] = !K.house ? [K.number[0] || K.ink, K.number[1] || K.trim] : K === KITS.home ? [K.ink, K.trim] : [K.trim, K.ink];
    paintBackName(g, name, fill, edge);
  }
  weave(g, W, H);
  drapeJersey(g, W, H, Number(number) || 0);
  // the collar and the hem, a touch darker
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(0,0,0,0.10)'); grd.addColorStop(0.15, 'rgba(0,0,0,0)'); grd.addColorStop(0.9, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (ink) inkJersey(g, W, H, Number(number) || 0);
  g.restore();
}
function paintPants(g, x, y, kit, ink = false) {
  const K = kitOf(kit);
  g.save(); g.beginPath(); g.rect(x, y, 512, 256); g.clip(); g.translate(x, y);
  g.fillStyle = K.house ? K.base : K.pants; g.fillRect(0, 0, 512, 256);
  if (!K.house && K.fabric === 'flannel') flannel(g, 512, 256, 11);
  if (!K.house && K.fabric === 'pinstripe') pinstripes(g, K, 512, 256, 0.8);
  else if (K === KITS.home) { g.fillStyle = 'rgba(22,38,74,0.8)'; for (let px = 2; px < 512; px += 7.5) g.fillRect(px, 0, 1, 256); }
  // the stripe down the outside seam only: the cell is one leg opened from the front, the outside
  // seam a quarter across (gl/ballplayer-mesh.js buildPlayer), and it ran down the inside leg too
  else { g.fillStyle = K.ink; g.fillRect(121, 0, 10, 256); g.fillStyle = K.trim; g.fillRect(131, 0, 4, 256); }
  // the fly's stitching at the front, and a welt pocket each side of the seat at the back
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(9, 0, 1.5, 18);
  g.beginPath(); g.moveTo(9.75, 18); g.quadraticCurveTo(9.75, 24, 2, 24); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,0.16)'; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(186, 7, 46, 2); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(186, 9, 46, 1);
  g.fillStyle = K.house ? K.ink : K.pants === K.base ? K.ink : K.base; g.fillRect(207, 11, 4, 4);
  weave(g, 512, 256);
  drapePants(g, 11);
  if (ink) inkPants(g, 11);
  g.restore();
}
// Socks into a 512×128 rect: painted as a 512×256 one and squeezed, the stirrup's bands down the
// shin the same as they were.
function paintSocks(g, x, y, kit, ink = false) {
  const K = kitOf(kit);
  g.save(); g.beginPath(); g.rect(x, y, 512, 128); g.clip(); g.translate(x, y); g.scale(1, 0.5);
  g.fillStyle = K.house ? K.ink : K.stirrups; g.fillRect(0, 0, 512, 256);
  g.fillStyle = K.trim; g.fillRect(0, 70, 512, 22); g.fillStyle = '#f0efe8'; g.fillRect(0, 96, 512, 10); g.fillStyle = K.trim; g.fillRect(0, 110, 512, 12);
  // the stirrup cut: the white sanitary sock showing through near the foot
  g.fillStyle = '#ecebe4';
  for (const c of [64, 192, 320, 448]) { g.beginPath(); g.moveTo(c - 24, 256); g.quadraticCurveTo(c, 170, c + 24, 256); g.fill(); }
  // the knit's ribs
  g.fillStyle = 'rgba(0,0,0,0.07)'; for (let px = 0; px < 512; px += 4) g.fillRect(px, 0, 1.5, 256);
  if (ink) inkSocks(g, 17);
  g.restore();
}
// Both sleeves into a 512×128 rect, the right arm in the left half and the left arm in the right,
// each from the back of the arm round its outside (a quarter of the half in on the left arm, three
// quarters on the right) and its inside: the shoulder's cap in the top 0.4, the sleeve below to its
// hem. The jersey's cloth at the jersey's size: its fabric, the weave, a shade along the seam under
// each arm, the gathering at the armpit and a touch of shadow at the hem, where it turns.
function paintSleeves(g, x, y, kit, ink = false) {
  const K = kitOf(kit), W = 512, H = 128;
  g.save(); g.beginPath(); g.rect(x, y, W, H); g.clip(); g.translate(x, y);
  g.fillStyle = K.base; g.fillRect(0, 0, W, H);
  if (!K.house) {
    if (K.fabric === 'flannel') flannel(g, W, H, 23);
    if (K.fabric === 'pinstripe') pinstripes(g, K, W, H);
  } else if (K === KITS.home) { g.fillStyle = 'rgba(22,38,74,0.85)'; for (let px = 1.5; px < W; px += 7.5) g.fillRect(px, 0, 1, H); }
  else { const r = rng(29); for (let i = 0; i < 600; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1, 1); } }
  weave(g, W, H);
  const r = rng(41);
  for (const sx of [64, 448]) {
    seamShade(g, sx, 34, H, 0.12);
    for (let i = 0; i < 3; i++) crease(g, r, sx + (r() - 0.5) * 50, 54 + r() * 20, 12 + r() * 10, Math.PI / 2 + (r() - 0.5) * 1.2, 0.7);
  }
  const hem = g.createLinearGradient(0, H - 14, 0, H);
  hem.addColorStop(0, 'rgba(0,0,0,0)'); hem.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = hem; g.fillRect(0, H - 14, W, 14);
  if (ink) {
    const ri = rng(43);
    for (const sx of [64, 448]) { inkLine(g, ri, sx, 51, sx + (ri() - 0.5) * 2, H, 2.2); for (let i = 0; i < 3; i++) fold(g, ri, sx + (ri() - 0.5) * 40, 56 + ri() * 30, 12 + ri() * 10, Math.PI / 2 + (ri() - 0.5), 1.4); }
    inkLine(g, ri, 0, H - 2, W, H - 2, 2, 0.8);
  }
  g.restore();
}
const cellRect = (c) => [Math.round(c[0] * KIT_SIZE), Math.round(c[1] * KIT_SIZE)];

// The kits the two sides wear tonight, for `teams` ({ home, away } names).
export const kitsFor = (teams) => ({ home: sideKit('home', teams?.home), away: sideKit('away', teams?.away) });

// The whole kit atlas for a cast: `teams` is { home, away } names; `cast` is diamond/cast.js's.
// Returns the canvas and a key per slot, so a later cast repaints only the slots that changed,
// and a side's trousers and socks only when its kit does. `ink` is the comic look; it's in every
// key, so flipping it repaints the lot.
export function paintKitAtlas(doc, cast, teams, into = null, { ink = false } = {}) {
  const c = into || canvasOf(doc, KIT_SIZE, KIT_SIZE), g = c.getContext('2d');
  const keys = into && into.__keys ? into.__keys : new Array(28).fill(null);
  const legs = into && into.__legs ? into.__legs : {};
  const dirty = [], wear = kitsFor(teams);
  if (!into) { g.fillStyle = '#808080'; g.fillRect(0, 0, KIT_SIZE, KIT_SIZE); }
  for (const side of ['home', 'away']) {
    const lk = `${wear[side].sig}|${ink ? 1 : 0}`;
    if (legs[side] === lk) continue;
    legs[side] = lk;
    const p = cellRect(KIT_PANTS[side]), s = cellRect(KIT_SOCKS[side]), sl = cellRect(KIT_SLEEVES[side]);
    paintPants(g, ...p, wear[side], ink);
    paintSocks(g, ...s, wear[side], ink);
    paintSleeves(g, ...sl, wear[side], ink);
    dirty.push([...p, 512, 256], [...s, 512, 128], [...sl, 512, 128]);
  }
  for (const m of cast || []) {
    const side = m.look.side, slot = m.look.slot;
    if ((side !== 'home' && side !== 'away') || m.look.role === 'crew') continue;
    const nick = nicknameOf(teams?.[side]), name = m.look.role === 'ump' ? '' : surnameOf(m.id), key = `${wear[side].sig}|${nick}|${m.look.number}|${name}|${ink ? 1 : 0}`;
    if (keys[slot] === key) continue;
    keys[slot] = key;
    const [x, y] = cellRect(kitCell(slot));
    paintJersey(g, x, y, wear[side], nick, m.look.number, name, ink);
    dirty.push([x, y, 512, 256]);
  }
  c.__keys = keys;
  c.__legs = legs;
  return { canvas: c, dirty };
}

// Embroidery over a mark painted on clear, into the S² square at (x, y): `paint(m)` draws the mark
// on its own canvas; then the thread's sheen goes over the mark only (fine satin lines on the
// bias, lit from above and shaded under), and under it the mark's outline in `edge`, `e` texels out
// all round, the dark stitching that stands it off the cloth. The atlas is alpha tested (the park's
// ALPHA_TEST), so the edge is opaque: a soft shadow would only be cut off.
function embroider(doc, g, x, y, S, paint, edge, e = 4) {
  const m = canvasOf(doc, S, S), mg = m.getContext('2d');
  mg.save(); paint(mg); mg.restore();
  mg.save(); mg.globalCompositeOperation = 'source-atop';
  mg.translate(S / 2, S / 2); mg.rotate(-Math.PI / 4);
  for (let k = -S; k < S; k += 4) { mg.fillStyle = 'rgba(255,255,255,0.1)'; mg.fillRect(-S, k, 2 * S, 1.4); mg.fillStyle = 'rgba(0,0,0,0.09)'; mg.fillRect(-S, k + 2, 2 * S, 1.2); }
  mg.setTransform?.(1, 0, 0, 1, 0, 0);
  const lit = mg.createLinearGradient(0, 0, 0, S);
  lit.addColorStop(0, 'rgba(255,255,255,0.14)'); lit.addColorStop(0.5, 'rgba(255,255,255,0)'); lit.addColorStop(1, 'rgba(0,0,0,0.18)');
  mg.fillStyle = lit; mg.fillRect(0, 0, S, S);
  mg.restore();
  if (edge) {
    const ec = canvasOf(doc, S, S), eg = ec.getContext('2d');
    eg.drawImage(m, 0, 0); eg.globalCompositeOperation = 'source-in'; eg.fillStyle = edge; eg.fillRect(0, 0, S, S);
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.drawImage(ec, x + Math.cos(a) * e, y + Math.sin(a) * e + e * 0.4); }
  }
  g.drawImage(m, x, y);
}
const darken = (col, k) => {
  const n = parseInt(String(col || '#000000').slice(1, 7), 16) || 0;
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
};
export const LOGO_SIZE = 512;
// What each side wears, on clear, in the four cells of LOGO_CELLS. On the cap and the helmet: a
// club's cap mark (`crest.cap`, else its small drawing), or the house kit's monogram, the first
// letter of the nickname (script at home, block away). On the left sleeve: a club's whole crest as a
// patch; the house kits wear none. All of it embroidered, its edge in the cap's colour, darker.
export function paintLogos(doc, teams) {
  const S = LOGO_SIZE, c = canvasOf(doc, S * LOGO_CELLS.count, S), g = c.getContext('2d'), wear = kitsFor(teams);
  g.clearRect(0, 0, S * LOGO_CELLS.count, S);
  for (const side of ['home', 'away']) {
    const K = wear[side], cx = LOGO_CELLS.cap[side] * S, px = LOGO_CELLS.patch[side] * S, crest = !K.house && K.club?.crest;
    const capEdge = darken(K.cap, 0.4);
    if (crest && Array.isArray(crest.layers)) {
      const marks = Array.isArray(crest.cap) && crest.cap.length ? crest.cap : null, box = crest.box || 100;
      embroider(doc, g, cx, 0, S, (m) => {
        if (marks) { m.translate(S * 0.04, S * 0.04); m.scale((S * 0.92) / box, (S * 0.92) / box); paintLayers(m, marks, K.club, crest.settUnit || 0.12); }
        else paintCrest(m, K.club, S / 2, S / 2, S * 0.9, { small: true });
      }, capEdge, 5);
      embroider(doc, g, px, 0, S, (m) => paintCrest(m, K.club, S / 2, S / 2, S * 0.9, { small: false }), '#141414', 4);
      continue;
    }
    const t = (nicknameOf(teams?.[side])[0] || (side === 'home' ? 'H' : 'A')).toUpperCase();
    embroider(doc, g, cx, 0, S, (m) => {
      m.font = side === 'home' ? `italic bold 400px ${SERIF}` : `bold 380px ${SANS}`;
      m.textAlign = 'center'; m.textBaseline = 'middle'; m.lineJoin = 'round';
      m.lineWidth = 28; m.strokeStyle = '#f2f0e8'; m.strokeText(t, S / 2, S / 2 + 16);
      m.fillStyle = K.trim; m.fillText(t, S / 2, S / 2 + 16);
    }, capEdge, 5);
  }
  return c;
}
export function paintLeather(doc) {
  const c = canvasOf(doc, 512, 512), g = c.getContext('2d'), r = rng(31);
  g.fillStyle = '#6b4526'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = v < 0.5 ? 'rgba(255,220,170,0.05)' : 'rgba(30,14,4,0.08)'; g.fillRect(r() * 512, r() * 512, 2, 2); }
  g.strokeStyle = 'rgba(40,22,10,0.9)'; g.lineWidth = 5;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(40 + i * 52, 0); g.lineTo(40 + i * 52, 512); g.stroke(); }
  g.strokeStyle = 'rgba(214,170,110,0.9)'; g.lineWidth = 3; g.setLineDash([8, 9]);
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(46 + i * 52, 0); g.lineTo(46 + i * 52, 512); g.stroke(); }
  return c;
}
export function paintWood(doc) {
  const c = canvasOf(doc, 1024, 128), g = c.getContext('2d'), r = rng(5);
  const grd = g.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0, '#4a3018'); grd.addColorStop(0.28, '#5a3a1e'); grd.addColorStop(0.3, '#d8b07c'); grd.addColorStop(1, '#e2bd88');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 128);
  for (let y = 0; y < 128; y += 3) { g.fillStyle = `rgba(120,80,40,${0.08 + r() * 0.08})`; g.fillRect(300, y + Math.sin(y) * 1.5, 724, 1); }
  // pine tar and tape on the handle
  for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(20,12,4,0.25)'; g.fillRect(r() * 300, r() * 128, 6, 2); }
  g.fillStyle = 'rgba(20,20,20,0.85)'; g.font = `italic bold 30px ${SANS}`; g.fillText('PRO MODEL', 720, 74);
  return c;
}
// The mask's bars on a 256² tile: uprights every 44 texels from 40, crossbars every 60 from 60,
// each 6 wide, inside a heavier frame. The crossbars miss the eye line (ballpark-smoke.mjs holds them to it).
export const MASK_BARS = Object.freeze({ size: 256, width: 6, cols: [40, 44], rows: [60, 60] });
export function paintMask(doc) {
  const B = MASK_BARS, c = canvasOf(doc, B.size, B.size), g = c.getContext('2d');
  g.clearRect(0, 0, B.size, B.size); g.strokeStyle = '#111'; g.lineWidth = B.width;
  for (let x = B.cols[0]; x < B.size; x += B.cols[1]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, B.size); g.stroke(); }
  for (let y = B.rows[0]; y < B.size; y += B.rows[1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(B.size, y); g.stroke(); }
  g.lineWidth = 16; g.strokeRect(0, 0, B.size, B.size);
  return c;
}
