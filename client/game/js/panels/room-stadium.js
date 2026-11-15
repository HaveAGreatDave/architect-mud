// ROOM · A STADIUM'S ROOMS: what the Room Stage adds to a room that has a stadium's pieces in it (gl/room-stadium.js
// draws their shapes). Three things, all painted over the room and deciding nothing:
//
// - THE LAST CHAMPION. A `champion` board carries `champ` (plugins/stands champions.js, through room.pieceState):
//   the club's crest and colour bands painted on a canvas laid over the board's face as light (setDecals `glow`),
//   and the room lit in the club's first colour (setGlows). With nobody crowned it's the dark board the mesh drew.
// - THE ICE THROUGH A WINDOW. A `rinkwindow` piece shows the live game on the other side of the glass: a rink view
//   (gameday-rink.js) stood at the window's eye (`look.view`, the rink's own feet), kept off screen, a few frames a
//   second, and only while the window is in front of you, its picture laid on the glass. It's a receiver like a seat
//   in the stands: the server tunes you to the game's channel while you're in the room (`rink` on `room_view`).
// - THE RESURFACER, which room-machine.js stands on its piece and drives out at the break.
//
// ⚠ NOTHING HERE NAMES A BUILDING. A second game on THOMAS authors its own rooms and gets these as they are.
import { paintCrest, wantClubs } from './club-crest.js';
import { addTvView } from './tv.js';
import { sendRaw } from '../net.js';
import { facing } from '../../../shared/room-layout.js';
import { rinkWindowGlass } from './gl/room-stadium.js';
import { createRoomMachine } from './room-machine.js';
import { styleOf, facesOf, loadFace, paintSign } from './stadium-signs.js';

const RINK_W = 640, RINK_H = 360;
// how often the window's picture is taken (fps), and how far round you can look before it stops being painted
const RINK_FPS = 8;
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

/** The stadium's things for one open Stage. `R` is the room's renderer. */
export function createRoomStadium({ R }) {
  const machine = createRoomMachine();
  let L = null, msg = null, decals = [], champGlows = [], dirty = false;
  const champCache = new Map();
  // the window's rink: one view, made the first time a room has a window and kept while it does
  let rink = null;

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
      else if (p.form === 'packs') put(`sign:${p.id}`, p, -hw + 0.04, hw - 0.04, h - 0.27, h - 0.05, hd + 0.003, { kind: 'neon', text: p.label || 'Cards' });
      else if (p.form === 'trophy') { const ph = Math.min(1.0, h * 0.45); put(`sign:${p.id}`, p, -0.3, 0.3, ph * 0.5, ph * 0.5 + 0.16, hd - 0.035, { kind: 'gilt', text: p.label || 'The Cup', sub: p.sub || '' }); }
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
    decals = [...decals.filter((d) => !d.key.startsWith('sign:') && !d.key.startsWith('wsign:')), ...out];
    dirty = true;
  }

  function champions() {
    decals = decals.filter((d) => !d.key.startsWith('champ:'));
    champGlows = [];
    for (const p of L?.placed || []) {
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

  async function startRink(p) {
    if (rink) return;
    const ch = msg?.rink?.channelId || null;
    if (!msg?.rink) return;
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:-10000px;top:0;width:${RINK_W}px;height:${RINK_H}px;pointer-events:none;display:flex;flex-direction:column`;
    box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    const out = document.createElement('canvas');
    out.width = RINK_W; out.height = RINK_H;
    const g = out.getContext('2d');
    const r = { box, out, channelId: ch, piece: p.id, fresh: false, view: null, unview: null, awake: true };
    rink = r;
    const copy = () => {
      g.fillStyle = '#000'; g.fillRect(0, 0, RINK_W, RINK_H);
      for (const c of box.querySelectorAll('canvas')) if (c.width > 1 && c.height > 1) { try { g.drawImage(c, 0, 0, RINK_W, RINK_H); } catch { /* not yet */ } }
      r.fresh = true;
    };
    const eye = Array.isArray(p.view) && p.view.length === 3 ? p.view : [-12, 42.5, 7];
    try { r.view = (await import('./gameday-rink.js')).createRinkView(box, { seat: { eye, mode: 'follow', fov: 62, yaw: null, pitch: null }, fly: false, fps: RINK_FPS, quiet: true, onFrame: copy }); } catch (err) { console.warn('[room] the rink through the window would not load:', err?.message); box.remove(); rink = null; return; }
    if (rink !== r) { r.view.clear(); box.remove(); return; }
    r.view.showIdle?.();
    // no channel (the Room Lab): the ice as it is between plays, with nobody's game on it
    if (!ch) return;
    r.unview = addTvView({
      isOpen: () => true,
      activeChannelId: () => r.channelId,
      applyOverlay(ov) {
        if (!ov) return;
        if (ov.clubsRev && wantClubs(ov.sport || 'hockey', ov.clubsRev)) sendRaw({ type: 'tv_clubs', sport: ov.sport || 'hockey' });
        if (ov.overlayType === 'gameday') r.view.apply(ov);
      },
      appendMessage() {}, showOffAir() {}, showOnAir() {}, updateTicker() {}, speak() {}, setProgramName() {}, renderSchedule() {}, renderStandings() {},
    });
    sendRaw({ type: 'tv_catchup' });
  }
  function stopRink() {
    if (!rink) return;
    const r = rink;
    rink = null;
    r.unview?.();
    try { r.view?.clear(); } catch { /* gone */ }
    r.box.remove();
    decals = decals.filter((d) => !d.key.startsWith('rinkwin:'));
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
    champions();
    signs().catch((e) => console.warn('[room] signs:', e?.message));
    const win = L?.placed?.find((p) => p.form === 'rinkwindow');
    if (win && msg?.rink) { if (rink && (rink.piece !== win.id || rink.channelId !== (msg.rink.channelId || null))) stopRink(); startRink(win); } else stopRink();
  }
  /** Each frame: the window's picture while it's in front of you. True when the decals changed. */
  function frame(now, eye, yaw) {
    if (rink && L) {
      const p = L.placed.find((q) => q.id === rink.piece);
      if (p && eye) {
        const g = rinkWindowGlass(p), q = faceQuad(L, p, g.x0, g.x1, g.y0, g.y1, g.z + 0.004);
        const mid = [0, 1, 2].map((i) => (q.quad[0][i] + q.quad[2][i]) / 2);
        const seen = (mid[0] - eye[0]) * Math.sin(yaw) + (mid[2] - eye[2]) * Math.cos(yaw) > -0.5;
        if (seen !== rink.awake) { rink.awake = seen; try { if (seen) rink.view?.wake(); else rink.view?.rest(); } catch { /* not mounted */ } }
        if (rink.fresh) {
          rink.fresh = false;
          decals = decals.filter((d) => !d.key.startsWith('rinkwin:'));
          decals.push({ key: `rinkwin:${p.id}`, src: rink.out, ...q, glow: 1, fresh: true });
          dirty = true;
        }
      }
    }
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
    dispose() { stopRink(); try { R.setGlows([]); } catch { /* gone */ } },
  };
}
