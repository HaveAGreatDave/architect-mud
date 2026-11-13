// THE SET ON THE WALL: a television in the Room Stage showing what's actually on.
//
// A broadcast is a page, not a picture: text, cards, tickers, a scorebug, Gameday. tv.js already draws
// all of it, for the CRT popup and the tablet, through `createTvView`. So this is a third surface for
// that same renderer, and nothing about what's on is drawn twice. The page is laid out off the side of
// the window and page-paint.js paints it to a canvas thirty times a second, which gl/room.js puts on the
// set's screen as a texture. It's part of the picture: a person walks in front of it, the room's
// depth hides it, and nothing lies over the room.
//
// ⚠ IT CLAIMS THE PANEL. While a flat with a set is open, `setWallTv` makes this the surface tv.js's
// panel calls go to, so a `tv_panel` from `watch` or `tune` comes up on the wall and never as a popup
// over the room. Letting go hands them back.

import { createTvView, setWallTv } from './tv.js';
import { sendCmdSilent } from '../net.js';
import { createPagePaint } from './page-paint.js';
import { paintScreen } from './gl/room-mesh.js';
import { tvLine } from './npc-bubbles.js';

// the size the page is laid out at, and the texture it's painted to: a 16:9 screen
const PAGE_W = 800, PAGE_H = 450, TEX_W = 1024, TEX_H = 576;
// how often the picture is repainted, and the Gameday's picture kept for it. A page that takes long to
// paint waits PAINT_SHARE times what it took, so it never has more than a quarter of the frame time.
const PAINT_MS = 33, GRAB_MS = 33, PAINT_SHARE = 4;
// A set that looks small (`size`, its width over its distance) is painted less often: at SMALL_SIZE or
// under, SMALL_SLOW times as seldom. A grab is only taken within WANT_MS of the room asking for a paint.
const SMALL_SIZE = 0.35, SMALL_SLOW = 3, WANT_MS = 250;
// how near a click on the picture has to land to take a button, in the page's pixels: a set across the
// room is a small target
const BUTTON_REACH = 14;

// A SET THAT SAYS ITS NAME AS IT COMES ON (a piece's `boot`, from flags.look.boot): black, a line of light
// across the middle that opens into a dark field with two slow glows, the wordmark closing up as it fades in
// and a glint across it, a ring filling under it, then the picture opening out from the middle.
export const BOOT_S = 3.2;
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function paintBoot(dst, src, t, mark) {
  const g = dst.getContext('2d'), W = dst.width, H = dst.height, cx = W / 2, cy = H / 2;
  g.save();
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  // the line, then the field opening from it
  const line = ease((t - 0.3) / 0.35), open = ease((t - 0.65) / 0.35);
  if (t >= 0.3) {
    const hh = Math.max(1.5, open * H / 2);
    g.beginPath(); g.rect(0, cy - hh, W, hh * 2); g.clip();
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05070d'); bg.addColorStop(1, '#0b0a12');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // two glows drifting, gold and teal
    for (const [hue, ox, oy, sp] of [['255,190,110', -0.22, -0.1, 0.35], ['70,200,220', 0.24, 0.14, -0.28]]) {
      const x = cx + W * (ox + 0.08 * Math.sin(t * sp * 2)), y = cy + H * (oy + 0.06 * Math.cos(t * sp * 3)), r = W * 0.42;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${hue},${0.32 * open})`); rg.addColorStop(1, `rgba(${hue},0)`);
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
    if (open < 1) {
      const lw = W * line * (1 - open * 0.6), lg = g.createLinearGradient(cx - lw / 2, 0, cx + lw / 2, 0);
      lg.addColorStop(0, 'rgba(255,236,200,0)'); lg.addColorStop(0.5, `rgba(255,246,228,${1 - open})`); lg.addColorStop(1, 'rgba(255,236,200,0)');
      g.fillStyle = lg; g.fillRect(cx - lw / 2, cy - 2 - open * 6, lw, 4 + open * 12);
    }
    // the wordmark, its letters closing up as it fades in, and a glint going across it
    const mIn = ease((t - 0.9) / 0.7), mOut = 1 - ease((t - 2.5) / 0.45);
    if (mIn > 0 && mOut > 0) {
      const size = Math.round(H * 0.11), track = size * (0.9 - 0.6 * mIn);
      g.font = `300 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      g.textBaseline = 'middle';
      const chars = [...mark.toUpperCase()], widths = chars.map((c) => g.measureText(c).width);
      const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
      let x = cx - total / 2;
      g.fillStyle = `rgba(244,232,210,${mIn * mOut})`;
      chars.forEach((c, i) => { g.fillText(c, x, cy - H * 0.02); x += widths[i] + track; });
      const gt = (t - 1.5) / 0.6;
      if (gt > 0 && gt < 1) {
        const gx = cx - total / 2 - 60 + (total + 120) * gt, gl = g.createLinearGradient(gx - 50, 0, gx + 50, 0);
        gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, `rgba(255,250,235,${0.85 * mOut})`); gl.addColorStop(1, 'rgba(255,255,255,0)');
        // the letters again in the glint's light, so only they catch it
        g.fillStyle = gl; x = cx - total / 2;
        chars.forEach((c, i) => { g.fillText(c, x, cy - H * 0.02); x += widths[i] + track; });
      }
      // the ring under it
      const ring = ease((t - 1.4) / 1.0), ry = cy + H * 0.12, rr = H * 0.022;
      g.lineWidth = 2; g.strokeStyle = `rgba(244,232,210,${0.18 * mIn * mOut})`;
      g.beginPath(); g.arc(cx, ry, rr, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = `rgba(255,206,120,${0.9 * mIn * mOut})`;
      g.beginPath(); g.arc(cx, ry, rr, -Math.PI / 2, -Math.PI / 2 + ring * Math.PI * 2); g.stroke();
    }
    // the picture, opening out from the middle in a soft ellipse
    const pic = ease((t - 2.45) / 0.7);
    if (pic > 0 && src) {
      g.save();
      g.beginPath(); g.ellipse(cx, cy, W * 0.75 * pic, H * 0.75 * pic, 0, 0, Math.PI * 2); g.clip();
      g.globalAlpha = Math.min(1, pic * 1.4);
      g.drawImage(src, 0, 0, W, H);
      g.restore();
    }
  }
  g.restore();
}

// `onChange(info)` hears the channel change: { on, number, station, list }.
export function createWallTv(host, { onChange }) {
  const el = document.createElement('div');
  el.className = 'rs-tv';
  el.dataset.tv = 'window';
  el.style.width = PAGE_W + 'px'; el.style.height = PAGE_H + 'px';
  el.innerHTML = `<div class="rs-tv-screen">
      <div data-tv="content"><div data-tv="messages"></div></div>
      <div data-tv="static"></div>
      <div data-tv="overlay-container"></div>
      <div data-tv="schedule"></div>
      <div data-tv="standings-panel"></div>
      <div data-tv="gameday"></div>
      <div data-tv="scorebug"></div>
      <div data-tv="standings"></div>
      <div class="tv-fx-host" data-tv="fx"></div>
    </div>
    <div class="rs-tv-strip">
      <span data-tv="station-name">——</span><span data-tv="channel-num">——</span><span class="rs-tv-prog" data-tv="program-name"></span>
      <span class="rs-tv-live" data-tv="live-badge">● LIVE</span>
    </div>
    <div class="rs-tv-ticker" data-tv="ticker-track"><span data-tv="ticker-inner"></span></div>`;
  host.appendChild(el);

  const canvas = document.createElement('canvas');
  canvas.width = TEX_W; canvas.height = TEX_H;
  // the snow between channels: its background is a repeating gradient, so it's drawn here
  const snow = document.createElement('canvas');
  snow.width = 256; snow.height = 144;
  const painter = createPagePaint(el, canvas, {
    special(node, cs, g, { x, y, w, h }) {
      if (node.dataset?.tv !== 'static') return false;
      paintScreen(snow, true, performance.now() / 1000, 7);
      g.drawImage(snow, x, y, w, h);
      return true;
    },
  });
  const gameday = el.querySelector('[data-tv="gameday"]');
  let grabAt = 0, paintAt = 0, paintGap = PAINT_MS, askedAt = -1e9;

  const info = { on: false, number: 0, station: '', list: [] };
  // ⚠ A GAMEDAY PICTURE IS WEBGL, gone when the task that drew it ends. The ballpark keeps its buffer
  // (`preserve`) and the rink says when it's drawn (`onFrame`), so either can be painted from here.
  // A set you can see in a room plays its show in 3-D by default, the desk and the stage alike, and
  // each of their frames is kept for the paint as the Gameday's is.
  let stageAt = 0;
  // What's said on it, along the bottom of the screen with the room's own bubbles: under the speaker's name,
  // or the station's for a line nobody on it says.
  const onLine = (text) => {
    const m = /^(.+?) says, "([\s\S]*)"$/.exec(text);
    tvLine(m ? m[1] : info.station || 'TV', m ? m[2] : text);
  };
  // ⚠ A GRAB IS A COPY OFF THE GPU, so it's taken only while a paint wants one: the room asked for a paint
  // lately (the set's in view) and no faster than the paints come. Grabbing every 33 ms with the set behind
  // you cost the room frames for a picture nobody saw.
  const wanted = (now, at) => now - askedAt < WANT_MS && now - at >= Math.max(GRAB_MS, paintGap);
  const view = createTvView(el, { key: 'wall', chassis: 'wall', onLine, gameday: { preserve: true, onFrame() {
    const now = performance.now();
    if (wanted(now, grabAt)) { grabAt = now; painter.grab(gameday); }
  } }, stage: { always: true, onFrame(stageHost) {
    const now = performance.now();
    if (wanted(now, stageAt)) { stageAt = now; painter.grab(stageHost); }
  } } });
  view.init();
  const say = () => onChange?.(info);
  // whether the dial has been touched since the set came on, by you or by it finding something to show
  let dialled = false;
  const went = () => { info.on = false; dialled = false; say(); };
  // what tv.js's panel calls reach while this is the set in the room
  const surface = {
    ...view,
    open(data) {
      view.open(data);
      info.on = !!data.channelId; info.number = data.channelNumber || 0; info.station = data.stationName || data.channelName || '';
      if (Array.isArray(data.channelList)) info.list = data.channelList;
      if (info.on) { try { localStorage.setItem('roomTvChannel', String(info.number)); } catch { /* private window */ } }
      say();
      // ⚠ A SET NOBODY HAS TUNED OPENS OFF, and a wall set has no dial or power button to turn it on with,
      // so it would sit there black. Using it turns it on: the channel you last had, or the first.
      // ⚠ NOR DOES A SET LEFT ON A STATION THAT'S OFF THE AIR SHOW ANYTHING but its off-air card, and the first
      // thing you see of it shouldn't be that. Only on coming on: a channel you dialled yourself stays dialled.
      const dark = info.on && !dialled && info.list.some((c) => c.number === info.number && c.onAir === false);
      if ((!info.on || dark) && info.list.length) {
        dialled = true;
        let last = NaN;
        try { last = Number(localStorage.getItem('roomTvChannel')); } catch { /* private window */ }
        const live = info.list.filter((c) => c.onAir && c.number > 0);
        const pick = live.find((c) => c.number === last) || live[0] || (dark ? null : info.list.find((c) => c.number === last) || info.list.find((c) => c.number > 0) || info.list[0]);
        if (pick) sendCmdSilent(`tune ${pick.number}`);
      }
    },
    close() { view.close(); went(); },
    shutdown() { view.shutdown(); went(); },
  };
  setWallTv(surface);

  return {
    info,
    canvas,
    get on() { return view.isOpen(); },
    open: surface.open,
    view,
    tune(n) { dialled = true; sendCmdSilent(`tune ${n}`); },
    // the next station up or down the dial, round the end of it: which, for the room to say
    step(dir) {
      const { list, number } = info;
      if (!list.length) return null;
      dialled = true;
      const at = list.findIndex((c) => c.number === number), next = list[((at < 0 ? 0 : at + dir) + list.length) % list.length];
      sendCmdSilent(`tune ${next.number}`);
      return next;
    },
    off() { surface.close(); },
    // The page is off the side of the window, so a click on the picture never reaches it. `u` and `v` run
    // 0 to 1 across the screen from its top left: what's under them, a button or null.
    buttonAt(u, v) {
      const o = el.getBoundingClientRect(), x = o.left + u * o.width, y = o.top + v * o.height;
      let best = null, bd = BUTTON_REACH;
      for (const b of el.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        if (!r.width || b.disabled) continue;
        const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    },
    // the set's own buttons show while the pointer's on the picture, as they do on any other screen
    touching(on) { el.classList.toggle('tv-touch', !!on); },
    // Called every frame: true when `canvas` has a new picture on it.
    paint(now, size = 1) {
      askedAt = now;
      const slow = size >= 1 ? 1 : 1 + (SMALL_SLOW - 1) * Math.min(1, (1 - size) / (1 - SMALL_SIZE));
      if (now - paintAt < paintGap * slow) return false;
      // (gone full screen: the picture is the whole window, and nobody's looking at the wall)
      if (document.fullscreenElement === gameday) return false;
      paintAt = now;
      const t0 = performance.now(), drawn = painter.paint();
      paintGap = Math.max(PAINT_MS, (performance.now() - t0) * PAINT_SHARE);
      return drawn;
    },
    stop() {
      setWallTv(null);
      view.destroy();
      el.remove();
    },
  };
}
