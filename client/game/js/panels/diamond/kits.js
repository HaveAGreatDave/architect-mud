/**
 * DEADBALL — the kits, painted.
 *
 * The textures the players wear (gl/ballplayer-mesh.js maps them):
 *
 *   kitAtlas   2048², a jersey in each of 28 slots of 512×256 (the cast's slots, diamond/cast.js)
 *              with the club's wordmark or nickname across the chest and the man's number on the
 *              back, and in the last row each side's trousers and socks;
 *   logoAtlas  512×256, each side's badge for the cap and the helmet, on clear: its crest's small
 *              drawing, or the house kit's monogram;
 *   leather, wood, mask: the gloves, the bat, the masks' bars.
 *
 * A side whose club has an identity (sports_pools.clubs) wears its own kit, home at home and road
 * away, with its wordmark across the chest and its crest's small drawing on the cap and helmet
 * (sideKit in gl/ballplayer-mesh.js). Any other side wears the house kit: cream with navy
 * pinstripes at home, grey with black and rust away, its nickname on the chest.
 *
 * DOM only for the canvases: nothing here reads the page.
 */

import { KITS, sideKit, kitCell, KIT_PANTS, KIT_SOCKS } from '../gl/ballplayer-mesh.js';
import { paintCrest } from '../club-crest.js';

const SERIF = '"FreeSerif", Georgia, "Times New Roman", serif';
const SANS = '"FreeSans", "Arial Narrow", Arial, sans-serif';
export const KIT_SIZE = 2048;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const canvasOf = (doc, w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
// A club's nickname, the last word of its name: "Precinct 9 Enforcers" wears ENFORCERS.
export const nicknameOf = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).pop() || '';

const kitOf = (kit) => (typeof kit === 'string' ? KITS[kit] || KITS.home : kit || KITS.home);
// Flannel at a distance: a light and dark speckle over the cloth.
function flannel(g, W, H, seed) {
  const r = rng(seed);
  for (let i = 0; i < 2200; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1, 1); }
}
// A club's own jersey: its wordmark arched across the chest (serif at home, block on the road),
// the placket piped in its trim, its number on the back in its two number colours.
function paintClubJersey(g, K, num, W, H, seed) {
  if (K.fabric === 'flannel') flannel(g, W, H, seed);
  g.fillStyle = K.ink; g.fillRect(126, 0, 4, H); g.fillStyle = K.trim; g.fillRect(130, 0, 1.5, H); g.fillRect(124.5, 0, 1.5, H);
  // the arch keeps to the front of the shirt, 63 texels either side of the placket (wider wraps
  // round the ribs), so a long word sets its letters closer and smaller
  const word = K.wordmark.toUpperCase().slice(0, 10), road = K.sig.startsWith('away:'), n = word.length;
  const half = 63 * Math.min(1, (n - 1) / 4), gap = n > 1 ? (2 * half) / (n - 1) : 0, px = Math.round(Math.min(34, gap ? gap * 1.6 : 34));
  g.font = road ? `bold ${px}px ${SANS}` : `bold ${px + 2}px ${SERIF}`; g.textAlign = 'center'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? (i - (n - 1) / 2) * gap / 190 : 0, cx = 128 + t * 190, cy = 102 - Math.cos(t * 2.2) * 13;
    g.save(); g.translate(cx, cy); g.rotate(t * 0.55);
    g.lineWidth = Math.max(2.5, px * 0.15); g.strokeStyle = K.trim; g.strokeText(word[i], 0, 0); g.fillStyle = K.ink; g.fillText(word[i], 0, 0);
    g.restore();
  }
  const [fill, edge] = K.number;
  g.font = `bold 95px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
  g.lineWidth = 8; g.strokeStyle = edge || K.trim; g.strokeText(num, 384, 165); g.fillStyle = fill || K.ink; g.fillText(num, 384, 165);
}

// A man's surname across his back over the number, arched a little and set smaller to fit:
// the period's road shirts had them, and the arcade puts them on every shirt.
export const surnameOf = (id) => (typeof id === 'string' && id && !id.includes(':') ? id.trim().split(/\s+/).pop().toUpperCase().slice(0, 12) : '');
function paintBackName(g, name, fill, edge) {
  if (!name) return;
  const n = name.length, px = n > 9 ? 20 : n > 7 ? 23 : 26, span = Math.min(150, n * px * 0.62);
  g.font = `bold ${px}px ${'"FreeSans", "Arial Narrow", Arial, sans-serif'}`; g.textAlign = 'center'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0, cx = 384 + t * span, cy = 64 - Math.cos(t * 2) * 6 + 6;
    g.save(); g.translate(cx, cy); g.rotate(t * 0.22);
    g.lineWidth = 3; g.strokeStyle = edge; g.strokeText(name[i], 0, 0); g.fillStyle = fill; g.fillText(name[i], 0, 0);
    g.restore();
  }
}

// One jersey into a 512×256 rect at (x, y): the chest a quarter of the way across, the back
// three quarters, the collar at the top. `kit` is sideKit's, or a side for its house kit. `name`
// is the man's surname for his back (surnameOf), or nothing.
export function paintJersey(g, x, y, kit, nickname, number, name = '') {
  const K = kitOf(kit), W = 512, H = 256;
  g.save();
  g.beginPath(); g.rect(x, y, W, H); g.clip();
  g.translate(x, y);
  g.fillStyle = K.base; g.fillRect(0, 0, W, H);
  const num = String(number ?? '');
  if (!K.house) paintClubJersey(g, K, num, W, H, (Number(number) || 0) * 7 + 3);
  else if (K === KITS.home) {
    g.fillStyle = 'rgba(22,38,74,0.85)';
    for (let px = 1.5; px < W; px += 7.5) g.fillRect(px, 0, 1, H);
    g.fillStyle = K.ink; g.fillRect(127, 0, 3, H);
    // the nickname in script across the chest, the tail swooping under it
    g.save(); g.translate(128, 98); g.rotate(-0.12);
    g.font = `italic bold 39px ${SERIF}`; g.textAlign = 'center'; g.lineJoin = 'round';
    g.lineWidth = 4.5; g.strokeStyle = K.ink; g.strokeText(nickname, 0, 0, 230); g.fillStyle = K.trim; g.fillText(nickname, 0, 0, 230);
    g.lineWidth = 3.5; g.beginPath(); g.moveTo(-75, 11); g.quadraticCurveTo(5, 23, 85, 4); g.stroke();
    g.restore();
    g.font = `bold 95px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
    g.lineWidth = 8; g.strokeStyle = K.trim; g.strokeText(num, 384, 165); g.fillStyle = K.ink; g.fillText(num, 384, 165);
    g.font = `bold 27px ${SANS}`; g.lineWidth = 3; g.strokeText(num, 165, 145); g.fillText(num, 165, 145);
  } else {
    const r = rng((Number(number) || 0) * 7 + 3);
    for (let i = 0; i < 2200; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect(r() * W, r() * H, 1, 1); }
    g.fillStyle = K.ink; g.fillRect(126, 0, 4, H); g.fillStyle = K.trim; g.fillRect(130, 0, 1.5, H); g.fillRect(124.5, 0, 1.5, H);
    // the nickname in arched block letters
    const word = nickname.toUpperCase().slice(0, 10);
    g.font = `bold ${word.length > 8 ? 26 : 32}px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
    for (let i = 0; i < word.length; i++) {
      const t = (i - (word.length - 1) / 2) / Math.max(word.length, 6), px = 128 + t * 190, py = 102 - Math.cos(t * 2.2) * 13;
      g.save(); g.translate(px, py); g.rotate(t * 0.55);
      g.lineWidth = 4.5; g.strokeStyle = K.ink; g.strokeText(word[i], 0, 0); g.fillStyle = K.trim; g.fillText(word[i], 0, 0);
      g.restore();
    }
    g.font = `bold 95px ${SANS}`; g.textAlign = 'center'; g.lineJoin = 'round';
    g.lineWidth = 8; g.strokeStyle = K.ink; g.strokeText(num, 384, 165); g.fillStyle = K.trim; g.fillText(num, 384, 165);
  }
  // his name over his number, in the number's colours
  {
    const [fill, edge] = !K.house ? [K.number[0] || K.ink, K.number[1] || K.trim] : K === KITS.home ? [K.ink, K.trim] : [K.trim, K.ink];
    paintBackName(g, name, fill, edge);
  }
  // the collar and the hem, a touch darker
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(0,0,0,0.10)'); grd.addColorStop(0.15, 'rgba(0,0,0,0)'); grd.addColorStop(0.9, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.restore();
}
function paintPants(g, x, y, kit) {
  const K = kitOf(kit);
  g.save(); g.beginPath(); g.rect(x, y, 512, 256); g.clip(); g.translate(x, y);
  g.fillStyle = K.house ? K.base : K.pants; g.fillRect(0, 0, 512, 256);
  if (!K.house && K.fabric === 'flannel') flannel(g, 512, 256, 11);
  if (K === KITS.home) { g.fillStyle = 'rgba(22,38,74,0.8)'; for (let px = 2; px < 512; px += 7.5) g.fillRect(px, 0, 1, 256); }
  else { g.fillStyle = K.ink; g.fillRect(122, 0, 10, 256); g.fillRect(378, 0, 10, 256); g.fillStyle = K.trim; g.fillRect(132, 0, 4, 256); g.fillRect(388, 0, 4, 256); }
  g.restore();
}
function paintSocks(g, x, y, kit) {
  const K = kitOf(kit);
  g.save(); g.beginPath(); g.rect(x, y, 512, 256); g.clip(); g.translate(x, y);
  g.fillStyle = K.house ? K.ink : K.stirrups; g.fillRect(0, 0, 512, 256);
  g.fillStyle = K.trim; g.fillRect(0, 70, 512, 22); g.fillStyle = '#f0efe8'; g.fillRect(0, 96, 512, 10); g.fillStyle = K.trim; g.fillRect(0, 110, 512, 12);
  // the stirrup cut: the white sanitary sock showing through near the foot
  g.fillStyle = '#ecebe4';
  for (const c of [64, 192, 320, 448]) { g.beginPath(); g.moveTo(c - 24, 256); g.quadraticCurveTo(c, 170, c + 24, 256); g.fill(); }
  g.restore();
}
const cellRect = (c) => [Math.round(c[0] * KIT_SIZE), Math.round(c[1] * KIT_SIZE)];

// The kits the two sides wear tonight, for `teams` ({ home, away } names).
export const kitsFor = (teams) => ({ home: sideKit('home', teams?.home), away: sideKit('away', teams?.away) });

// The whole kit atlas for a cast: `teams` is { home, away } names; `cast` is diamond/cast.js's.
// Returns the canvas and a key per slot, so a later cast repaints only the slots that changed,
// and a side's trousers and socks only when its kit does.
export function paintKitAtlas(doc, cast, teams, into = null) {
  const c = into || canvasOf(doc, KIT_SIZE, KIT_SIZE), g = c.getContext('2d');
  const keys = into && into.__keys ? into.__keys : new Array(28).fill(null);
  const legs = into && into.__legs ? into.__legs : {};
  const dirty = [], wear = kitsFor(teams);
  if (!into) { g.fillStyle = '#808080'; g.fillRect(0, 0, KIT_SIZE, KIT_SIZE); }
  for (const side of ['home', 'away']) {
    if (legs[side] === wear[side].sig) continue;
    legs[side] = wear[side].sig;
    const p = cellRect(KIT_PANTS[side]), s = cellRect(KIT_SOCKS[side]);
    paintPants(g, ...p, wear[side]);
    paintSocks(g, ...s, wear[side]);
    dirty.push([...p, 512, 256], [...s, 512, 256]);
  }
  for (const m of cast || []) {
    const side = m.look.side, slot = m.look.slot;
    if ((side !== 'home' && side !== 'away') || m.look.role === 'crew') continue;
    const nick = nicknameOf(teams?.[side]), name = m.look.role === 'ump' ? '' : surnameOf(m.id), key = `${wear[side].sig}|${nick}|${m.look.number}|${name}`;
    if (keys[slot] === key) continue;
    keys[slot] = key;
    const [x, y] = cellRect(kitCell(slot));
    paintJersey(g, x, y, wear[side], nick, m.look.number, name);
    dirty.push([x, y, 512, 256]);
  }
  c.__keys = keys;
  c.__legs = legs;
  return { canvas: c, dirty };
}

// What each side wears on its cap and helmet, on clear: a club's crest in its small drawing, or
// the house kit's monogram, the first letter of the nickname (script at home, block away).
export function paintLogos(doc, teams) {
  const c = canvasOf(doc, 512, 256), g = c.getContext('2d'), wear = kitsFor(teams);
  g.clearRect(0, 0, 512, 256);
  for (const [i, side] of [[0, 'home'], [1, 'away']]) {
    const K = wear[side];
    if (!K.house && paintCrest(g, K.club, 128 + i * 256, 128, 232, { small: true })) continue;
    const t = (nicknameOf(teams?.[side])[0] || (side === 'home' ? 'H' : 'A')).toUpperCase();
    g.font = side === 'home' ? `italic bold 200px ${SERIF}` : `bold 190px ${SANS}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 14; g.strokeStyle = '#f2f0e8'; g.strokeText(t, 128 + i * 256, 136);
    g.fillStyle = K.trim; g.fillText(t, 128 + i * 256, 136);
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
// each 9 wide. The crossbars miss the eye line (ballpark-smoke.mjs holds them to it).
export const MASK_BARS = Object.freeze({ size: 256, width: 9, cols: [40, 44], rows: [60, 60] });
export function paintMask(doc) {
  const B = MASK_BARS, c = canvasOf(doc, B.size, B.size), g = c.getContext('2d');
  g.clearRect(0, 0, B.size, B.size); g.strokeStyle = '#111'; g.lineWidth = B.width;
  for (let x = B.cols[0]; x < B.size; x += B.cols[1]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, B.size); g.stroke(); }
  for (let y = B.rows[0]; y < B.size; y += B.rows[1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(B.size, y); g.stroke(); }
  return c;
}
