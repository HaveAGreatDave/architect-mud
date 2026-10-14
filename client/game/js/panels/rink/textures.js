// Rinkside · the painted surfaces: the ice sheet, the dasherboard advertising and the crowd.
//
// The ice is ONE canvas per view, top row = the far boards, and everything that happens to
// it is painted straight in: blade cuts as men skate, snow where they stop, black where the
// puck hits the wall, blood where it lands, a smear where a body slid. That is why the marks
// stay for the period, and why they cost nothing to draw: the renderer maps the whole sheet
// in one pass whatever is on it.
//
// A clean copy of the sheet is kept beside it. The Zamboni paints that copy back over the
// strip it covers, so fresh ice keeps its lines and logos, and it leaves a wet mask the
// renderer turns into a shine that dries off. `wear` climbs as the sheet gets cut up and is
// what dulls the reflections over a period; resurfacing takes it back down.
//
// Boards and crowd never change and are shared by every view on the page.

import { TAU, rng } from './util.js';
import { RL, RW, RC, BOARD_H, GOAL_X, BLUE_X, DOT_FT, MID_Y } from './geo.js';

export const TPX = 10;                       // ice texels per foot
export const BPX = 12;                       // board texels per foot
export const CPX = 6, CX0 = -30, CX1 = 230;  // crowd texels per foot, and its extent in x
export const CROWS = 18, ROWH = 20;          // crowd rows, texels per row
const FACE = '"Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';

const mk = (doc, w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

// The arena's own sponsors are real Coldwater businesses: the building advertises the city
// you can walk around in. Content would own this list in a second game.
export const HOARDINGS = [
  ['BATTERY ACID COFFEE', '#2a1a12', '#f2c04a'], ['GREASE EXPECTATIONS', '#b8141c', '#ffffff'], ['CASH & CARRION', '#13261a', '#7fe08a'],
  ['CO-PAY & PRAY', '#ffffff', '#1f4fbf'], ['PERCUSSIVE MAINTENANCE', '#1d2733', '#ff8a3d'], ['SHELF LIFE', '#3a0f3f', '#ff7ad9'],
  ['SECOND SKIN', '#0f2a3a', '#9fe4ff'], ['LATHER & LYE', '#f2e9d8', '#5a3a1a'],
];

export const WPX = 2;                        // wet-mask texels per foot
export const ICE_TILE = 125;                 // texels a side of one upload tile

export function createIce(doc) {
  const canvas = mk(doc, RL * TPX, RW * TPX);
  const c = canvas.getContext('2d');
  const base = mk(doc, RL * TPX, RW * TPX), bc = base.getContext('2d');
  const wetCv = mk(doc, RL * WPX, RW * WPX), wc = wetCv.getContext('2d');
  const ice = { canvas, wet: wetCv, wear: 0, wetness: 0 };
  const IX = (x) => x * TPX, IY = (y) => (RW - y) * TPX;
  // WHAT CHANGED, IN TILES. The 2-D renderer reads the canvas whole every frame and ignores
  // this; GLASS 2 keeps the sheet as a texture and re-uploads only the tiles a paint touched
  // (`dirty`), or all of it after a reset (`dirtyAll`). Marked when a mark is queued, so a
  // tile is listed before `flush()` paints it.
  const TX = Math.ceil(canvas.width / ICE_TILE), TY = Math.ceil(canvas.height / ICE_TILE);
  Object.assign(ice, { tiles: { TX, TY, size: ICE_TILE }, dirty: new Uint8Array(TX * TY), dirtyAll: true, wetDirty: false });
  function touch(x0, y0, x1, y1) {
    const a = Math.max(0, Math.floor(Math.min(x0, x1) / ICE_TILE)), b = Math.min(TX - 1, Math.floor(Math.max(x0, x1) / ICE_TILE));
    const c0 = Math.max(0, Math.floor(Math.min(y0, y1) / ICE_TILE)), d = Math.min(TY - 1, Math.floor(Math.max(y0, y1) / ICE_TILE));
    for (let j = c0; j <= d; j++) for (let i = a; i <= b; i++) ice.dirty[j * TX + i] = 1;
  }
  // a mark round a point in feet, `r` feet of margin
  const touchFt = (x, y, r) => touch(IX(x - r), IY(y + r), IX(x + r), IY(y - r));
  const clip = () => { rr(c, 0, 0, RL * TPX, RW * TPX, RC * TPX); c.clip(); };
  function reset(seed = 7) {
    const S = TPX;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save(); clip();
    const g = c.createLinearGradient(0, 0, 0, RW * S);
    g.addColorStop(0, '#dbe5ec'); g.addColorStop(0.5, '#e9f0f4'); g.addColorStop(1, '#f2f6f8');
    c.fillStyle = g; c.fillRect(0, 0, RL * S, RW * S);
    const r = rng(seed);
    for (let i = 0; i < 1100; i++) {
      c.fillStyle = r() < 0.55 ? `rgba(255,255,255,${0.05 + r() * 0.08})` : `rgba(160,182,200,${0.03 + r() * 0.05})`;
      c.beginPath(); c.ellipse(r() * RL * S, r() * RW * S, 4 + r() * 34, 2 + r() * 9, r() * 3, 0, TAU); c.fill();
    }
    // under-ice paint: the league mark at centre and two sponsors, faded by the ice over them
    c.save(); c.translate(IX(RL / 2), IY(MID_Y)); c.globalAlpha = 0.22; c.strokeStyle = '#1f4fbf'; c.lineWidth = 0.7 * S;
    c.beginPath(); c.arc(0, 0, 9 * S, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(-6.4 * S, 6.4 * S); c.lineTo(6.4 * S, -6.4 * S); c.stroke();
    c.fillStyle = '#1f4fbf'; c.font = `800 ${3.6 * S}px ${FACE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('CPhL', 0, 0.2 * S);
    c.restore();
    c.save(); c.globalAlpha = 0.13; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `800 ${3 * S}px ${FACE}`;
    c.fillStyle = '#b8141c'; c.fillText(HOARDINGS[0][0], IX(RL / 2), IY(71), 44 * S);
    c.fillStyle = '#1f4fbf'; c.fillText(HOARDINGS[1][0], IX(RL / 2), IY(14), 44 * S);
    c.restore();
    // lines: red centre with its white checks, two blue lines, two thin goal lines
    c.fillStyle = '#c4222b'; c.fillRect(IX(RL / 2) - 0.5 * S, 0, S, RW * S);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (let y = 0; y < RW; y += 2.2) c.fillRect(IX(RL / 2) - 0.12 * S, IY(y) - 0.5 * S, 0.24 * S, S);
    c.fillStyle = '#1e4fbd'; for (const bx of BLUE_X) c.fillRect(IX(bx) - 0.5 * S, 0, S, RW * S);
    c.fillStyle = '#c4222b'; for (const gx of GOAL_X) c.fillRect(IX(gx) - 0.1 * S, 0, 0.2 * S, RW * S);
    const ring = (x, y, rad, col) => { c.strokeStyle = col; c.lineWidth = 0.2 * S; c.beginPath(); c.arc(IX(x), IY(y), rad * S, 0, TAU); c.stroke(); };
    for (const k of ['aZL', 'aZR', 'hZL', 'hZR']) {
      const [x, y] = DOT_FT[k];
      ring(x, y, 15, '#c4222b');
      c.fillStyle = '#c4222b'; c.beginPath(); c.arc(IX(x), IY(y), S, 0, TAU); c.fill();
      for (const sx of [-3, 3]) for (const sy of [17, -15]) c.fillRect(IX(x + sx) - 0.1 * S, IY(y + sy), 0.2 * S, 2 * S);
    }
    for (const k of ['aNL', 'aNR', 'hNL', 'hNR']) { const [x, y] = DOT_FT[k]; c.fillStyle = '#c4222b'; c.beginPath(); c.arc(IX(x), IY(y), S, 0, TAU); c.fill(); }
    ring(RL / 2, MID_Y, 15, '#1e4fbd');
    c.fillStyle = '#1e4fbd'; c.beginPath(); c.arc(IX(RL / 2), IY(MID_Y), 0.5 * S, 0, TAU); c.fill();
    for (const [gx, dir] of [[GOAL_X[0], 1], [GOAL_X[1], -1]]) {
      c.beginPath(); c.moveTo(IX(gx), IY(MID_Y + 6));
      c.arc(IX(gx), IY(MID_Y), 6 * S, -Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5, dir < 0);
      c.closePath(); c.fillStyle = 'rgba(126,182,232,0.85)'; c.fill(); c.strokeStyle = '#c4222b'; c.lineWidth = 0.2 * S; c.stroke();
      c.beginPath(); c.moveTo(IX(gx), IY(31.5)); c.lineTo(IX(gx - dir * 11), IY(28.5)); c.moveTo(IX(gx), IY(53.5)); c.lineTo(IX(gx - dir * 11), IY(56.5)); c.stroke();
    }
    c.restore();
    q.blood.clear(); q.cut.clear(); q.n = 0;
    bc.clearRect(0, 0, base.width, base.height); bc.drawImage(canvas, 0, 0);
    wc.clearRect(0, 0, wetCv.width, wetCv.height);
    ice.wear = 0; ice.wetness = 0;
    ice.dirtyAll = true; ice.wetDirty = true;
  }
  // MARKS ARE QUEUED AND PAINTED IN ONE BATCH, the renderer calling `flush()` once a frame.
  // A hit throws a few hundred drops and every man's skates cut the sheet forty times a
  // second; painted one at a time, each was its own path and its own save/clip/restore on a
  // canvas the size of the rink, and on a GPU canvas that state churn is what dropped frames
  // on a big hit. Batched, a frame of marks is a handful of fills and strokes. There is no
  // clip: everything that marks the ice is kept inside the boards by the sim already.
  const BLOOD = ['rgba(118,8,14,', 'rgba(132,10,16,', 'rgba(104,4,12,'];
  const q = { blood: new Map(), cut: new Map(), n: 0 };
  const bucket = (m, k) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } return a; };
  function blood(x, y, rad, alpha, seed) {
    const r = rng(seed || ((x * 73 + y * 151) | 0));
    const shade = () => (r() * 3) | 0;
    bucket(q.blood, shade() + '|' + alpha).push(IX(x), IY(y), rad * TPX, rad * TPX * (0.6 + r() * 0.4), r() * 3);
    touchFt(x, y, rad * 3 + 0.5);
    const n = 2 + (r() * 4) | 0;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = rad * (0.9 + r() * 1.8), sz = rad * (0.15 + r() * 0.35) * TPX;
      bucket(q.blood, shade() + '|' + alpha).push(IX(x + Math.cos(a) * d), IY(y + Math.sin(a) * d), sz, sz, 0);
    }
    if (++q.n > 3000) flush();
  }
  // A blade cut: a pale groove with a darker edge, the two-tone line a skate leaves.
  // Thousands of them over a period grey the sheet out, which is the point.
  function cut(x0, y0, x1, y1, a) {
    bucket(q.cut, a).push(IX(x0), IY(y0), IX(x1), IY(y1));
    touch(IX(x0) - 2, IY(y0) - 2, IX(x1) + 2, IY(y1) + 2);
    ice.wear = Math.min(1, ice.wear + a * 0.00045);
    if (++q.n > 3000) flush();
  }
  function flush() {
    if (!q.n) return;
    q.n = 0;
    for (const [k, v] of q.blood) {
      const [sh, al] = k.split('|');
      c.fillStyle = BLOOD[sh] + al + ')'; c.beginPath();
      for (let i = 0; i < v.length; i += 5) { c.moveTo(v[i] + v[i + 2], v[i + 1]); c.ellipse(v[i], v[i + 1], v[i + 2], v[i + 3], v[i + 4], 0, TAU); }
      c.fill();
    }
    q.blood.clear();
    c.lineCap = 'round';
    for (const [a, v] of q.cut) {
      c.strokeStyle = `rgba(118,140,160,${a * 1.1})`; c.lineWidth = 1.8; c.beginPath();
      for (let i = 0; i < v.length; i += 4) { c.moveTo(v[i], v[i + 1] + 0.5); c.lineTo(v[i + 2], v[i + 3] + 0.5); }
      c.stroke();
      c.strokeStyle = `rgba(255,255,255,${a * 2.2})`; c.lineWidth = 1.2; c.beginPath();
      for (let i = 0; i < v.length; i += 4) { c.moveTo(v[i], v[i + 1] - 0.4); c.lineTo(v[i + 2], v[i + 3] - 0.4); }
      c.stroke();
    }
    q.cut.clear();
  }
  // A hockey stop: the edge skids sideways and shaves a fan of snow off the sheet. Drawn as
  // a short curved swathe across his line of travel, heavy at the end where the snow piles.
  function scrape(x, y, dx, dy, len, seed) {
    const r = rng(seed || ((x * 31 + y * 17) | 0));
    const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    touchFt(x, y, 1.2); touchFt(x + ux * len, y + uy * len, 1.6);
    c.save(); c.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      const off = (k - 3) * 0.16, bend = (r() - 0.5) * 0.5, L = len * (0.65 + r() * 0.35);
      const ax = x + nx * off, ay = y + ny * off;
      c.strokeStyle = `rgba(255,255,255,${0.16 + r() * 0.14})`; c.lineWidth = (0.25 + r() * 0.3) * TPX;
      c.beginPath(); c.moveTo(IX(ax), IY(ay));
      c.quadraticCurveTo(IX(ax + ux * L * 0.5 + nx * bend), IY(ay + uy * L * 0.5 + ny * bend), IX(ax + ux * L), IY(ay + uy * L));
      c.stroke();
    }
    // the pile of shavings where the skid ended
    const ex = x + ux * len, ey = y + uy * len;
    for (let k = 0; k < 6; k++) {
      c.fillStyle = `rgba(250,253,255,${0.2 + r() * 0.2})`;
      c.beginPath(); c.ellipse(IX(ex + (r() - 0.5) * 1.2), IY(ey + (r() - 0.5) * 1.2), (0.2 + r() * 0.35) * TPX, (0.12 + r() * 0.2) * TPX, Math.atan2(-uy, ux), 0, TAU); c.fill();
    }
    c.restore();
    ice.wear = Math.min(1, ice.wear + 0.004);
  }
  // A puck that hits the wall hard leaves rubber on the ice at its foot.
  function puckMark(x, y, dx, dy) {
    const l = Math.hypot(dx, dy) || 1;
    touchFt(x, y, 1.2);
    c.save(); c.lineCap = 'round';
    c.strokeStyle = 'rgba(30,34,40,0.32)'; c.lineWidth = 0.22 * TPX;
    c.beginPath(); c.moveTo(IX(x - dx / l * 0.9), IY(y - dy / l * 0.9)); c.lineTo(IX(x), IY(y)); c.stroke();
    c.restore();
  }
  // a smear: a body or a limb sliding through something wet
  function smear(x0, y0, x1, y1, w, alpha) {
    touch(IX(Math.min(x0, x1) - w), IY(Math.max(y0, y1) + w), IX(Math.max(x0, x1) + w), IY(Math.min(y0, y1) - w));
    c.save();
    c.strokeStyle = `rgba(120,10,14,${alpha})`; c.lineWidth = w * TPX; c.lineCap = 'round';
    c.beginPath(); c.moveTo(IX(x0), IY(y0)); c.lineTo(IX(x1), IY(y1)); c.stroke();
    c.restore();
  }
  // The Zamboni's pass: the clean sheet painted back over a strip `w` feet either side of
  // the conditioner, at heading `h`, and the strip marked wet. Marks, blood and all go.
  function resurface(x, y, w, h = 0) {
    flush();
    const ux = Math.cos(h), uy = Math.sin(h), nx = -uy * w, ny = ux * w;
    touchFt(x, y, w + 1);
    // ⚠ ONE CLIP, NOT TWO. Inside the rink's rounded clip, this strip's clip made Chromium
    // erase the whole sheet (seen headless on SwiftShader, on the 2-D and GL paths alike).
    // The rink clip isn't needed: the clean copy is already transparent outside the
    // boards, and drawing transparent pixels over the ice changes nothing.
    c.save();
    c.beginPath();
    c.moveTo(IX(x + nx - ux * 0.8), IY(y + ny - uy * 0.8)); c.lineTo(IX(x + nx + ux * 0.8), IY(y + ny + uy * 0.8));
    c.lineTo(IX(x - nx + ux * 0.8), IY(y - ny + uy * 0.8)); c.lineTo(IX(x - nx - ux * 0.8), IY(y - ny - uy * 0.8));
    c.closePath(); c.clip();
    c.drawImage(base, 0, 0);
    c.restore();
    wc.fillStyle = 'rgba(255,255,255,0.9)';
    wc.beginPath(); wc.arc(x * WPX, (RW - y) * WPX, w * WPX, 0, TAU); wc.fill();
    ice.wear = Math.max(0, ice.wear - 0.0016);
    ice.wetness = 1; ice.wetDirty = true;
  }
  // The water freezes off: the wet mask fades over about half a minute.
  function dry(dt) {
    if (ice.wetness <= 0) return;
    ice.wetness = Math.max(0, ice.wetness - dt / 40); ice.wetDirty = true;
    wc.save(); wc.globalCompositeOperation = 'destination-out'; wc.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 0.06)})`;
    wc.fillRect(0, 0, wetCv.width, wetCv.height); wc.restore();
    if (ice.wetness === 0) wc.clearRect(0, 0, wetCv.width, wetCv.height);
  }
  reset();
  return Object.assign(ice, { reset, blood, cut, scrape, puckMark, smear, resurface, dry, flush });
}

let shared = null;
export function sharedTextures(doc) {
  if (shared) return shared;
  const boards = mk(doc, (RL - 2 * RC) * BPX, BOARD_H * BPX);
  {
    const c = boards.getContext('2d'), S = BPX, Hh = boards.height;
    c.fillStyle = '#eef1f3'; c.fillRect(0, 0, boards.width, Hh);
    let x = 1.5, i = 0;
    const len = RL - 2 * RC - 2;
    while (x < len) {
      const [txt, bg, fg] = HOARDINGS[i++ % HOARDINGS.length]; const w = Math.min(17, len - x);
      c.fillStyle = bg; c.fillRect(x * S, 0.75 * S, w * S, 2.35 * S);
      c.fillStyle = fg; c.font = `800 ${1.75 * S}px ${FACE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(txt, (x + w / 2) * S, 1.98 * S, (w - 1.2) * S);
      x += w + 1.2;
    }
    c.fillStyle = '#d9b032'; c.fillRect(0, Hh - 0.55 * S, boards.width, 0.55 * S);
    c.fillStyle = '#c9ced3'; c.fillRect(0, 0, boards.width, 0.28 * S);
  }
  const crowd = (cheer) => {
    const cv = mk(doc, (CX1 - CX0) * CPX, CROWS * ROWH);
    const c = cv.getContext('2d'); const r = rng(991);
    const shirts = ['#c8382f', '#a52c25', '#2f6fd0', '#24508f', '#30343a', '#3b3f46', '#59606a', '#6d5a3f', '#2e4a3a', '#8a8f96', '#d9d2c4', '#1f2329', '#7a2fd0', '#1f8a5a', '#d08a1f'];
    const skins = ['#e2b896', '#c99671', '#9a6a4a', '#6e4a33', '#f0cdb2'];
    for (let row = 0; row < CROWS; row++) {
      const y0 = row * ROWH;
      c.fillStyle = row % 2 ? '#141a21' : '#11161c'; c.fillRect(0, y0, cv.width, ROWH);
      c.fillStyle = '#0c1015'; c.fillRect(0, y0 + ROWH - 4, cv.width, 4);
      for (let x = 2; x < cv.width - 8; x += 8) {
        if ((x % 270) < 18) { c.fillStyle = '#1c232c'; c.fillRect(x, y0, 8, ROWH); continue; }
        if (r() < 0.07) continue;
        const up = cheer && r() < 0.5;
        const sh = shirts[(r() * shirts.length) | 0], sk = skins[(r() * skins.length) | 0];
        const lift = up ? 3 : 0;
        c.fillStyle = sh; c.fillRect(x + 1, y0 + ROWH - 12 - lift, 6, 10 + lift);
        if (up) { c.fillRect(x, y0 + ROWH - 19, 2, 8); c.fillRect(x + 6, y0 + ROWH - 19, 2, 8); }
        c.fillStyle = sk; c.beginPath(); c.arc(x + 4, y0 + ROWH - 14 - lift, 2.7, 0, TAU); c.fill();
        // four thousand people, a good few of them filming it instead of watching it
        if (r() < 0.06) { c.fillStyle = 'rgba(190,230,255,0.9)'; c.fillRect(x + 3, y0 + ROWH - 9, 2, 2); }
      }
      c.fillStyle = `rgba(0,0,0,${0.08 + row / CROWS * 0.5})`; c.fillRect(0, y0, cv.width, ROWH);
    }
    return cv;
  };
  shared = { boards, crowdSit: crowd(false), crowdUp: crowd(true) };
  return shared;
}
