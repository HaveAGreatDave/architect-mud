// ROOM · A STADIUM'S ROOMS: what the Room Stage adds to a room that has a stadium's pieces in it (gl/room-stadium.js
// draws their shapes). Three things, all painted over the room and deciding nothing:
//
// - THE LAST CHAMPION. A `champion` board carries `champ` (plugins/stands champions.js, through room.pieceState):
//   the club's crest and colour bands painted on a canvas laid over the board's face as light (setDecals `glow`),
//   and the room lit in the club's first colour (setGlows). With nobody crowned it's the dark board the mesh drew.
// - THE ICE. A room that stands at the rink (`spec.rink`) is drawn over the live game itself, its openings onto the
//   ice holes in the room's picture (room-rink.js). Never a picture of the game on a pane: the ice is the ice.
// - THE RESURFACER, which room-machine.js stands on its piece and drives out at the break, through the gate.
//
// ⚠ NOTHING HERE NAMES A BUILDING. A second game on THOMAS authors its own rooms and gets these as they are.
import { paintCrest } from './club-crest.js';
import { facing } from '../../../shared/room-layout.js';
import { createRoomMachine } from './room-machine.js';
import { createRoomRink } from './room-rink.js';
import { styleOf, facesOf, loadFace, paintSign } from './stadium-signs.js';
import { roomMarks } from './room-marks.js';
import { trophyCup, bannerCloth } from './gl/room-stadium.js';
import { CUP_FACE } from './gl/room-cup.js';

const hexRgb = (h) => { const n = parseInt(String(h || '#808080').slice(1, 7), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// a piece's front face as a decal quad in the world: [tl, tr, br, bl] as you face it, and its normal
function faceQuad(L, p, x0, x1, y0, y1, z) {
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu, base = p.y0 || 0;
  const P = (x, y) => L.world(p.u + su * x + fu * z, p.v + sv * x + fv * z, base + y);
  const o = L.world(p.u, p.v, 0), f = L.world(p.u + fu, p.v + fv, 0);
  // the piece's +x is your left as you face its front
  return { quad: [P(x1, y1), P(x0, y1), P(x0, y0), P(x1, y0)], n: [f[0] - o[0], f[1] - o[1], f[2] - o[2]] };
}

// The board's picture: the club's colours as bands, its crest in the middle, CHAMPIONS over it and the club under it
function paintChampion(c, st = styleOf(null)) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 640;
  const g = cv.getContext('2d'), cols = (c.colours || []).filter((x) => /^#[0-9a-f]{6}$/i.test(x));
  const a = cols[0] || '#c9a24a', b = cols[1] || '#1a1a1a';
  g.fillStyle = b; g.fillRect(0, 0, 512, 640);
  // the bands: the colours down the sides and across the foot
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(18 + i * 22, 0, 16, 640); g.fillRect(512 - 34 - i * 22, 0, 16, 640); g.fillRect(0, 560 + i * 18, 512, 12); });
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(90, 70, 332, 470);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f4e4b0'; g.font = `50px "${st.font}", Georgia, serif`; g.fillText('CHAMPIONS', 256, 118);
  if (!paintCrest(g, { crest: c.crest, colours: cols }, 256, 300, 250)) { g.fillStyle = a; g.beginPath(); g.arc(256, 300, 110, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffffff'; g.font = `36px "${st.font}", Georgia, serif`;
  const name = String(c.name || '').toUpperCase(), words = name.split(' ');
  if (g.measureText(name).width > 320 && words.length > 1) { const h = Math.ceil(words.length / 2); g.fillText(words.slice(0, h).join(' '), 256, 470); g.fillText(words.slice(h).join(' '), 256, 508); } else g.fillText(name, 256, 485);
  if (c.season) { g.fillStyle = '#f4e4b0'; g.font = `26px "${st.sub}", Georgia, serif`; g.fillText(`SEASON ${c.season}`, 256, 540); }
  return { cv, glow: hexRgb(a) };
}

// A club's banner (gl/room-stadium.js 'banner'): its first colour, a stripe of each of the others under the rod,
// the crest, and the club's name stacked down the cloth. Paint, not light: it's lit like the wall it hangs on.
function paintBanner(c, st = styleOf(null)) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 512;
  const g = cv.getContext('2d'), cols = (c.colours || []).filter((x) => /^#[0-9a-f]{6}$/i.test(x));
  const a = cols[0] || '#3a2c1e', b = cols[1] || '#c49a52', ink = inkOn(a, cols);
  g.fillStyle = a; g.fillRect(0, 0, 256, 512);
  cols.slice(1).forEach((col, i) => { g.fillStyle = col; g.fillRect(0, 40 + i * 16, 256, 10); });
  if (!paintCrest(g, { crest: c.crest, colours: cols }, 128, 190, 170)) { g.fillStyle = b; g.beginPath(); g.arc(128, 190, 70, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
  // the place first, smaller; the nickname under it in the venue's face, as big as the cloth allows
  const words = String(c.name || '').toUpperCase().split(' ').filter(Boolean);
  // the nickname is the last word, or the last two when a colour leads it (Blue Birds, Red Sox)
  const two = words.length > 2 && /^(BLUE|RED|WHITE|BLACK|GREEN|GOLD|GOLDEN|SILVER|GREY|GRAY|BROWN|ORANGE)$/.test(words[words.length - 2]);
  const nick = words.length > 1 ? words.slice(two ? -2 : -1) : words, place = words.slice(0, words.length - nick.length).join(' ');
  g.font = `26px "${st.sub}", Georgia, serif`;
  if (place) g.fillText(place, 128, 315);
  nick.forEach((wd, i) => {
    let px = 48;
    const set = () => { g.font = `${px}px "${st.font}", Georgia, serif`; };
    set();
    while (px > 20 && g.measureText(wd).width > 220) { px -= 2; set(); }
    g.fillText(wd, 128, 365 + i * 52);
  });
  return cv;
}
// the club colour that reads best on its first: whichever of the rest differs most from it, else white or black
function inkOn(bg, cols) {
  const lum = (h) => { const [r, g, b] = hexRgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, L0 = lum(bg);
  const best = cols.slice(1).sort((x, y) => Math.abs(lum(y) - L0) - Math.abs(lum(x) - L0))[0];
  return best && Math.abs(lum(best) - L0) > 0.35 ? best : L0 > 0.5 ? '#111111' : '#ffffff';
}

/** The stadium's things for one open Stage. `R` is the room's renderer and `host` the element its canvas is in. */
export function createRoomStadium({ R, host }) {
  const machine = createRoomMachine();
  let L = null, msg = null, decals = [], champGlows = [], dirty = false;
  const champCache = new Map();
  // the ice under the room: one view, kept while the rooms you walk through stand at the rink
  const rink = createRoomRink(host);
  // THE RINK'S LIGHT through a room's openings onto it (`spec.rink`): the arena is lit for television, and the room by
  // its own lamps, so without this a room at the boards is a dark box round a bright hole. A cool white glow two metres
  // out past each opening every RINK_GLOW_EVERY metres, as many as setGlows takes with the champion's
  const RINK_GLOW_EVERY = 4.5, RINK_GLOW = [0.55, 0.6, 0.68], RINK_GLOW_R = 11;
  function rinkLight() {
    if (!L?.spec?.rink) return [];
    const out = [], W = L.spec.w, D = L.spec.d;
    for (const q of L.spec.windows || []) {
      const len = q.b - q.a, n = Math.max(1, Math.min(4, Math.ceil(len / RINK_GLOW_EVERY))), y = ((q.y0 ?? 0) + (q.y1 ?? 2.6)) / 2;
      for (let i = 0; i < n; i++) {
        const m = q.a + (i + 0.5) * len / n;
        const [u, v] = q.wall === 'front' ? [m, -2] : q.wall === 'back' ? [m, D + 2] : q.wall === 'left' ? [-W / 2 - 2, m] : [W / 2 + 2, m];
        out.push({ p: L.world(u, v, y), c: RINK_GLOW, r: RINK_GLOW_R });
      }
    }
    return out.slice(0, 6);
  }

  // THE SIGNS (stadium-signs.js), in the venue's own faces once they've loaded: each piece's, and the room's own
  // `stadium.signs` on its walls. Lit ones (a lightbox, neon) are light; the rest are paint, lit like the wall
  let signGen = 0;
  async function signs() {
    const gen = ++signGen, st = styleOf(L?.spec);
    await Promise.all(facesOf(st).map(loadFace));
    if (gen !== signGen || !L) return;
    const lit = L.spec?.lampOn !== false, out = [];
    const put = (key, p, x0, x1, y0, y1, z, sign) => {
      const src = paintSign({ ...sign, w: x1 - x0, h: y1 - y0, style: st, lit });
      out.push({ key, src, ...faceQuad(L, p, x0, x1, y0, y1, z), ...(sign.kind === 'lightbox' || sign.kind === 'neon' ? { glow: lit ? 0.9 : 0.25 } : {}) });
    };
    for (const p of L.placed || []) {
      const hw = p.w / 2, hd = p.d / 2, h = p.h;
      if (p.form === 'seatdoor') { const ow = Math.max(0.9, p.w - 0.5), oh = h - 0.55; put(`sign:${p.id}`, p, -ow / 2, ow / 2, oh + 0.07, h - 0.07, hd + 0.053, { kind: 'lightbox', text: p.label || 'Seats', sub: p.sub || '' }); }
      else if (p.form === 'boxoffice') { const top = h - 0.42; put(`sign:${p.id}`, p, -hw + 0.04, hw - 0.04, top + 0.12, h - 0.04, hd + 0.003, { kind: 'lightbox', text: p.label || 'Tickets', sub: p.sub || '' }); }
      else if (p.form === 'smokebooth') put(`sign:${p.id}`, p, -hw + 0.04, hw - 0.04, h - 0.4, h - 0.12, hd + 0.012, { kind: 'lightbox', text: p.label || 'Tobacco', sub: p.sub || '' });
      else if (p.form === 'packs') put(`sign:${p.id}`, p, -hw + 0.04, hw - 0.04, h - 0.27, h - 0.05, hd + 0.003, { kind: 'neon', text: p.label || 'Cards' });
      else if (p.form === 'trophy') { const { ph } = trophyCup(p); put(`sign:${p.id}`, p, -0.3, 0.3, ph * 0.5, ph * 0.5 + 0.16, hd - 0.035, { kind: 'gilt', text: p.label || 'The Cup', sub: p.sub || '' }); }
      else if (p.form === 'champion') put(`sign:${p.id}`, p, -0.3, 0.3, 0.12, 0.26, hd + 0.002, { kind: 'gilt', text: p.champ?.name ? 'Champions' : 'Awaiting a champion', sub: p.champ?.season ? `Season ${p.champ.season}` : '' });
    }
    // the room's own: { wall, at, y, w, h, text, sub, kind, tint }
    const W = L.spec.w, D = L.spec.d;
    for (const [i, s0] of (Array.isArray(st.signs) ? st.signs : (L.spec.stadium?.signs || [])).entries()) {
      if (!s0?.text || !['front', 'back', 'left', 'right'].includes(s0.wall)) continue;
      const turn = s0.wall === 'front' ? 180 : s0.wall === 'back' ? 0 : s0.wall === 'left' ? 90 : -90;
      const u = s0.wall === 'left' ? -W / 2 : s0.wall === 'right' ? W / 2 : Number(s0.at) || 0, v = s0.wall === 'front' ? 0 : s0.wall === 'back' ? D : Number(s0.at) || 0;
      const w = Number(s0.w) || 1.4, hh = Number(s0.h) || 0.4, y = Number(s0.y) || 2.2;
      put(`wsign:${i}`, { u, v, turn, y0: 0 }, -w / 2, w / 2, y - hh / 2, y + hh / 2, 0.02, { kind: s0.kind || 'gilt', text: s0.text, sub: s0.sub || '', tint: s0.tint || null });
    }
    // and the room's own marks (room-marks.js: labels, stencils, placards, tags, readouts, stains, flat on the floor too)
    const marks = await roomMarks(L).catch((e) => { console.warn('[room] marks:', e?.message); return []; });
    if (gen !== signGen || !L) return;
    decals = [...decals.filter((d) => !d.key.startsWith('sign:') && !d.key.startsWith('wsign:') && !d.key.startsWith('mark:')), ...out, ...marks];
    dirty = true;
  }

  function champions() {
    decals = decals.filter((d) => !d.key.startsWith('champ:') && !d.key.startsWith('banner:'));
    champGlows = rinkLight();
    for (const p of L?.placed || []) {
      if (p.form === 'banner' && p.club?.name) {
        const key = `banner:${p.id}:${p.club.name}`;
        let pic = champCache.get(key);
        if (!pic) { pic = { cv: paintBanner(p.club, styleOf(L.spec)) }; champCache.set(key, pic); }
        // the cloth from the top of its point to under the rod (gl/room-stadium.js), a hair proud of it
        const { top, foot } = bannerCloth(p), cw = p.w / 2 - 0.06, q = faceQuad(L, p, -cw, cw, foot, top - 0.02, 0.031);
        decals.push({ key, src: pic.cv, ...q });
        continue;
      }
      if (p.form !== 'champion' || !p.champ?.name) continue;
      const key = `champ:${p.id}:${p.champ.name}:${p.champ.season || ''}`;
      let pic = champCache.get(key);
      if (!pic) { pic = paintChampion(p.champ, styleOf(L.spec)); champCache.set(key, pic); }
      const hw = p.w / 2, q = faceQuad(L, p, -hw + 0.06, hw - 0.06, 0.41, p.h - 0.06, p.d / 2 + 0.006);
      decals.push({ key, src: pic.cv, ...q, glow: 1.15 });
      const [fu, fv] = facing(p.turn), at = L.world(p.u + fu * 1.2, p.v + fv * 1.2, 1.6);
      champGlows.push({ p: at, c: pic.glow.map((x) => x * 1.4), r: 5 });
    }
    try { R.setGlows(champGlows); } catch { /* an old renderer */ }
    dirty = true;
  }

  /** The room's payload (a new room, or a crossing into one). */
  function setMsg(m) {
    msg = m;
    machine.load(null, m?.vehicles || null);
  }
  /** A layout (the room built or rebuilt). */
  function load(Lnew) {
    L = Lnew;
    machine.load(L);
    // the Cup's engraving face, so its atlas is painted in it (gl/room-cup.js paintCupRoll; room-stage.js paints
    // it again if it was drawn first)
    if ((L?.placed || []).some((p) => p.form === 'trophy')) loadFace(CUP_FACE);
    champions();
    signs().catch((e) => console.warn('[room] signs:', e?.message));
    // the ice, drawn from the room's own camera as the room is drawn (gl/room.js setUnder)
    rink.load(L, msg?.building?.neighbours, msg?.rink || null);
    try { R.setUnder(rink.on ? (cam, w, h) => rink.tick(performance.now(), cam, L, w, h) : null); } catch { /* an old renderer */ }
  }
  /** Each frame. True when the decals changed. */
  function frame() {
    const was = dirty;
    dirty = false;
    return was;
  }
  return {
    machine, setMsg, load, frame,
    vehicles(v) { machine.load(null, v || null); },
    decals: () => decals,
    // a fresh texture is uploaded once
    settled() { for (const d of decals) d.fresh = false; },
    dispose() { rink.dispose(); try { R.setGlows([]); R.setUnder(null); } catch { /* gone */ } },
  };
}
