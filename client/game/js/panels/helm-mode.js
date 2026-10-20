// Echelon Helm mode — the in-game console. Takes over the AREA PANE like the flight sim (the
// sidebar, top bar and log stay put; the ⛶ chip toggles true OS fullscreen), with the chase view
// filling the pane under a glass brass dash: the ship's wheel
// (course), an engine telegraph you drag to engage (the throttle), read-only instruments, and live
// WX/time chips synced from the world exactly like the flight sim. Time and weather are NOT
// settable here — they're the real sim's, streamed in. Dependency-free: the game passes callbacks
// (onSail/onExit) so this module never imports net/dispatch, and the standalone rig can drive it.
//
// openHelm({ mount, gx, gy, heading, sky, transitMs, accent, onSail(dir), onExit() }) → controller
// isHelmActive() — dispatch guards room look/move renders on this (mirrors isFlightSimActive()).
// helmSetSky(sky) / helmEndTransit(gx,gy) — the server streams the live sky + confirms arrivals.

import { openHelmChase } from './helm-view.js';
import { createHelmWheel } from './helm-wheel.js';
import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { bindTouchGestures } from './touch-gestures.js';
import { loadCss } from '../../../shared/dom.js';

// helm-mode.css ships beside this file and is fetched when the module loads, so ensureHelmStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const HELM_CSS = await loadCss(new URL('./helm-mode.css', import.meta.url));

// The passage length is now the server's authoritative `ms` (distance × the throttle bell), streamed
// on helm_underway; the telegraph derives a local placeholder timer from the same bell math and the
// server's helm_arrived releases the lock precisely.
let _helm = null;
export function isHelmActive() { return !!_helm; }
// The server streams the live sim sky (real weather field) while the helm is open, and confirms an
// arrival at the end of a passage — both routed here by dispatch.
export function helmSetSky(sky) { _helm?.ctrl?.setSky(sky); }
export function helmSetWorld(rows, cx, cy) { _helm?.ctrl?.setWorld(rows, cx, cy); }
export function helmSetContacts(list) { _helm?.ctrl?.setContacts(list); }
// What a helm is sent beside the window: the towers and the highway past it, the region's grade and
// the people on the quay. Any key absent keeps what it had.
export function helmSetFar(msg) { _helm?.ctrl?.setFar(msg); }
export function helmEndTransit(gx, gy) { _helm?.ctrl?.endTransit(gx, gy); }
// The server confirms a passage's true vector (direction + tile count) so the chase view glides her
// the whole distance — fired for the telegraph AND a typed `sail`, so either path animates the helm.
export function helmBeginTransit(dir, tiles, ms, cruise, path) { _helm?.ctrl?.beginTransit(dir, ms, ms, tiles, cruise, path); }

export function ensureHelmStyles() {
  // Reuse the tag if present, but ALWAYS rewrite its content — never early-return. A stale style
  // block (e.g. left by an older build, or a tag that outlived a close) would otherwise pin the old
  // layout while this module's JS runs fresh, producing a half-old/half-new "mixed" helm.
  const s = document.getElementById('helm-mode-styles') || document.createElement('style');
  s.id = 'helm-mode-styles';
  s.textContent = HELM_CSS;
  document.head.appendChild(s);
}

const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const HDG_TO_DIR = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
// Tile delta → rhumb letter (for the first leg of a charted course), used to seed the local glide.
const DELTA_LETTER = { '0,-1': 'N', '1,-1': 'NE', '1,0': 'E', '1,1': 'SE', '0,1': 'S', '-1,1': 'SW', '-1,0': 'W', '-1,-1': 'NW' };
const dirLetter = (dx, dy) => DELTA_LETTER[Math.sign(dx) + ',' + Math.sign(dy)] || 'N';
const fmtETA = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function openHelm(opts = {}) {
  const mount = opts.mount || document.getElementById('area-content');
  if (!mount) return null;
  closeHelm();
  ensureHelmStyles();
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told; an app that mounts there has to say so
  // Accent — follows the player's global theme (the wheel LEDs, needle, radar rings/sweep/blip and
  // charted course all take this), so the helm reads in the same colour family as the rest of the UI.
  // The theme vars live on <html>; read the effective --accent/--green (both #rrggbb in themes.css).
  const _hex = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : fb; };
  const accent = opts.accent || _hex('--accent', '#5ccfe0');
  const accentGreen = _hex('--green', '#35d07a');
  // rgba/lightened helpers for the canvas instruments (radar scope, heading strip, chart) so their
  // hairlines/glows tint to the theme accent instead of the old pinned cyan.
  const _rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return [92, 207, 224]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const [AR, AG, AB] = _rgb(accent), [GR, GG, GB] = _rgb(accentGreen);
  const acc = (a) => `rgba(${AR},${AG},${AB},${a})`;
  const grn = (a) => `rgba(${GR},${GG},${GB},${a})`;
  const accLite = `rgb(${Math.min(255, AR + 90)},${Math.min(255, AG + 90)},${Math.min(255, AB + 90)})`;
  const onSail = opts.onSail || (() => {});
  const onSailTo = opts.onSailTo || (() => {});   // fires the real `sailto <x> <y> <bell%>` when a charted course is engaged
  const onStop = opts.onStop || (() => {});       // fires the real `stop` — cut the throttle to halt her mid-passage
  const onExit = opts.onExit || (() => {});

  mount.innerHTML = `
    <div class="helm-root">
      <div class="helm-chase"></div>
      <div class="helm-placard"><span class="m"></span><span class="n">ECHELON&nbsp; <small>HELM</small></span></div>
      <div class="helm-chips">
        <span class="helm-chip"><b data-wx>CLEAR</b></span>
        <span class="helm-chip"><b data-time>--:--</b></span>
        <button class="helm-icon" data-chart title="chart a course">🗺</button>
        <button class="helm-icon" data-seat title="the bridge, stand at the wheel and ride her">⌖</button>
        <button class="helm-icon" data-hide title="collapse the panel, hide the log">⊟</button>
        <button class="helm-icon" data-fs title="fullscreen, hide the log + command bar">⛶</button>
        <button class="helm-icon" data-big title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>
        <button class="helm-icon exit" data-exit title="leave the helm">✕</button>
      </div>
      <div class="helm-dash">
        <div class="helm-console">
          <div class="helm-console-face">
            <!-- Left instrument cluster: NAV scope + position + the digital gauge stack. -->
            <div class="helm-left">
              <!-- NAV chart: live top-down basin chart with the Echelon's blip. Tap to open the
                   full chart popup and plot a course. -->
              <div class="helm-nav">
                <div class="helm-nav-bezel" data-chart title="open the chart, plot a course">
                  <div class="helm-nav-scope"><canvas data-nav></canvas><span class="helm-nav-tag">NAV · BASIN</span><span class="helm-nav-hint">TAP TO CHART</span></div>
                </div>
                <div class="helm-readout wide"><span class="rk">Position</span><span class="rv" data-pos>— · —</span></div>
              </div>
              <!-- Digital instrument stack — heading + speed live on the LEFT wing, beside the nav
                   scope; ETA + status are on the RIGHT wing (by the telegraph) so the readouts fill
                   both ends of the console and flank the wheel instead of piling up on one side. -->
              <div class="helm-gauges">
                <div class="helm-readout hdg"><span class="rk">Heading</span><span class="rv big" data-hdg>N</span></div>
                <div class="helm-readout"><span class="rk">Speed</span><span class="rv"><span data-kn>0.0</span><i>kn</i></span></div>
              </div>
            </div>
            <!-- Ship's wheel — the centred centrepiece, docked INSIDE the console so it never rises
                 into the water/ship view above the bar. -->
            <div class="helm-col">
              <!-- Heading strip: the eight rhumbs on a sliding tape. The notch the wheel is seated in
                   lights up, and the centre lubber goes green when she's actually ready to make way. -->
              <canvas class="helm-strip" data-strip></canvas>
              <canvas class="helm-wheel"></canvas>
              <div class="cap">Course</div>
            </div>
            <!-- Right wing: ETA + status readouts sit beside the engine telegraph, so the right half
                 of the console carries real instruments instead of dead space. -->
            <div class="helm-right">
              <div class="helm-gauges rt">
                <div class="helm-readout eta idle"><span class="rk">ETA</span><span class="rv" data-eta>—</span></div>
                <div class="helm-readout st"><span class="rk">Status</span><span class="rv sm" data-status>MOORED</span></div>
              </div>
              <!-- Engine telegraph -->
              <div class="helm-tele" data-tele>
                <div class="helm-tele-track">
                  <span class="helm-tele-mark ahead">AHEAD</span>
                  <span class="helm-tele-mark stop">STOP</span>
                  <div class="helm-tele-knob" data-knob></div>
                </div>
                <div class="helm-tele-label" data-telelabel>Engine Telegraph</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Chart popup — a tablet-styled basin map. Tap a water tile to plot a course around the
           shoreline; GET UNDERWAY (or the engine telegraph) engages it. -->
      <div class="helm-map" data-map>
        <div class="helm-map-win">
          <div class="helm-map-head">
            <span class="t">NAVIGATION CHART<small>COLDWATER BASIN · tap open water to plot a course</small></span>
            <button class="helm-map-close" data-mapclose title="close">✕</button>
          </div>
          <div class="helm-map-body"><canvas class="helm-map-canvas" data-mapc></canvas></div>
          <div class="helm-map-foot">
            <span class="helm-map-info" data-mapinfo>Tap a water tile to chart a course.</span>
            <button class="helm-map-btn ghost" data-mapclear>CLEAR</button>
            <button class="helm-map-btn" data-mapgo disabled>GET UNDERWAY</button>
          </div>
        </div>
      </div>
    </div>`;

  const root = mount.querySelector('.helm-root');
  const q = (s) => root.querySelector(s);
  const sea = q('.helm-chase');

  const ctrl = openHelmChase(sea, {
    gx: opts.gx ?? 0, gy: opts.gy ?? 0, heading: opts.heading ?? 0, sky: opts.sky,
    onArrive: (gx, gy) => { q('[data-pos]').textContent = gx + ' · ' + gy; },
  });

  // Fixed layout — the helm is desktop-only and size-agnostic. The console is a PHYSICAL object at ONE
  // fixed size (--hs) that never morphs with the pane; it reads correctly at any panel size and in
  // fullscreen because the windowed dash is fully TRANSPARENT (only the frosted instrument wings +
  // telegraph carry their own glass), so it never buries the Echelon no matter how short the pane.
  // The chase view always fills the whole pane (full render height, so the hull keeps its true 3D
  // proportions), with the dash floating over its bottom edge. The camera pitch is a FIXED elevated
  // chase angle — the eye rides up-and-over her stern looking DOWN onto the deck, so the hull sits in
  // the water band off the horizon, clear of both the dash and the centred wheel; azimuth-only orbit,
  // no vertical tilt, so she frames the same in every panel state. (Mobile gets its own interface.)
  root.style.setProperty('--hs', '0.92');
  ctrl.setRestPitch(0.58);

  // Keep the Echelon framed at any pane size. The renderer pins her near a fixed screen fraction just
  // off the horizon; the transparent console rises from the bottom over the water. When the pane is short
  // (the console riding high in the frame, little clear water above it) the hull gets crowded down behind
  // the dash — so pull the chase camera proportionally FARTHER BACK, shrinking her to keep the whole ship
  // inside the water band above the console. A roomy/fullscreen pane eases back to the resting frame.
  // Keeping her a constant fraction of the visible water band means zoom ∝ 1/band; calibrated so the
  // resting distance (BASE_ZOOM, = REST.zoom in helm-view) frames her well at a comfortable ~REF-tall band.
  const BASE_ZOOM = 1.7, REF_BAND = 340;   // px — the water-band height at which the resting distance is right
  function fitCamera() {
    const paneH = root.clientHeight, consoleEl = q('.helm-console');
    if (!paneH || !consoleEl) return;
    const band = Math.max(40, paneH - consoleEl.offsetHeight);   // clear water above the console lip
    const z = Math.max(BASE_ZOOM, Math.min(2.4, BASE_ZOOM * REF_BAND / band));   // only ever pull BACK from the resting frame
    ctrl.setRestZoom(z);
    // Seat the Echelon's visual centre at the MIDDLE of that clear band (as a fraction of the whole
    // pane), so she's framed with water above and below her and never dips behind the console — no
    // matter the pane size or fullscreen state. Clamped so she's always comfortably clear of the dash
    // and never floated up into empty sky. The renderer holds her there through zoom/orbit (frameY pin).
    ctrl.setFrameY(Math.max(0.30, Math.min(0.46, (band * 0.5) / paneH)));
  }
  const fitRO = new ResizeObserver(() => fitCamera());
  fitRO.observe(root);
  fitCamera();
  // Dev tuning handle: from the browser console you can dial the resting chase framing live —
  //   __helmCtrl.setPose({ yaw: 34, pitch: 0.16, zoom: 1.7 })   // then read __helmCtrl.pose()
  // Find the framing you like, tell me the numbers, and I bake them into REST (helm-view.js).
  window.__helmCtrl = ctrl;
  if (opts.sky) ctrl.setSky(opts.sky);   // seed the real sim weather field immediately
  if (opts.map) ctrl.setWorld(opts.map, opts.gx, opts.gy);   // frame her against the REAL basin, not blank ocean
  ctrl.setFar(opts);

  // The wheel is a DIRECTION control: its spin steers the demanded course by that much (clockwise =
  // right, counter-clockwise = left) and she swings slowly toward it; the hub needle reads her actual
  // heading as she comes round.
  // Grabbing the wheel to steer by hand overrides any course armed from the chart — so the telegraph
  // then does a plain direction-sail on the wheel's heading, not the stale plotted course.
  const wheel = createHelmWheel(q('.helm-wheel'), { accent, gear: 8, onSteer: (deg) => { if (plannedTarget) clearCourse(); ctrl.steerBy(deg); }, getHeading: () => ctrl.heading() });

  // ── NAV chart — a live top-down basin scope drawn from the chase view's own world window
  // (ctrl.mapSnapshot): land/piers slate, water the dark teal ground, the Echelon a cyan chevron
  // held at centre (the chart slides under her as she makes way) with range rings + a radar sweep.
  const navCanvas = q('[data-nav]'), navCtx = navCanvas.getContext('2d');
  let navAlive = true, navRaf = 0;
  function drawNav(now) {
    if (!navAlive) return;
    navRaf = requestAnimationFrame(drawNav);
    const snap = ctrl.mapSnapshot?.(); if (!snap || !navCtx) return;
    const box = navCanvas.getBoundingClientRect(); if (!box.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr));
    if (navCanvas.width !== W || navCanvas.height !== H) { navCanvas.width = W; navCanvas.height = H; }
    navCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = box.width, h = box.height, cx = w / 2, cy = h / 2;
    navCtx.clearRect(0, 0, w, h);
    const rows = snap.rows || [], N = rows.length || 1;
    const cw = w / N, ch = h / N;
    // Sub-tile glide: shift the whole chart against the direction of travel so the blip stays put.
    const sx = (snap.sub ? -snap.sub.x : 0) * cw, sy = (snap.sub ? -snap.sub.y : 0) * ch;
    for (let ry = 0; ry < N; ry++) {
      const row = rows[ry] || [];
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx]; if (!c || c.mark === 'yacht') continue;
        if (c.biome === 'water' || !c.biome) continue;   // water = the scope's own teal bed
        navCtx.fillStyle = c.bt ? '#3a4650' : (c.road ? '#2b343d' : '#232b33');   // buildings > roads > land
        navCtx.fillRect(rx * cw + sx - 0.5, ry * ch + sy - 0.5, cw + 1, ch + 1);
      }
    }
    // Range rings + centre cross.
    navCtx.strokeStyle = acc(0.16); navCtx.lineWidth = 1;
    for (const r of [h * 0.22, h * 0.42]) { navCtx.beginPath(); navCtx.arc(cx, cy, r, 0, 7); navCtx.stroke(); }
    navCtx.beginPath(); navCtx.moveTo(cx - 5, cy); navCtx.lineTo(cx + 5, cy); navCtx.moveTo(cx, cy - 5); navCtx.lineTo(cx, cy + 5); navCtx.stroke();
    // Radar sweep — a fading wedge rotating clockwise.
    const sweep = ((now || 0) * 0.0011) % (Math.PI * 2);
    navCtx.save(); navCtx.translate(cx, cy); navCtx.rotate(sweep);
    const grad = navCtx.createLinearGradient(0, 0, h * 0.5, 0);
    grad.addColorStop(0, acc(0.26)); grad.addColorStop(1, acc(0));
    navCtx.fillStyle = grad; navCtx.beginPath(); navCtx.moveTo(0, 0); navCtx.arc(0, 0, h * 0.5, -0.32, 0); navCtx.closePath(); navCtx.fill();
    navCtx.restore();
    // Charted (planned, dashed cyan) or active (solid green) course, mirroring the popup chart.
    const navLine = snap.path || snap.plannedPath;
    if (navLine && navLine.length >= 2) {
      navCtx.strokeStyle = snap.path ? grn(0.9) : acc(0.85);
      navCtx.lineWidth = 1.4; navCtx.setLineDash(snap.path ? [] : [3, 3]); navCtx.lineJoin = 'round';
      navCtx.beginPath(); navLine.forEach(([ax, ay], i) => { const x = cx + (ax - snap.gx) * cw + sx, y = cy + (ay - snap.gy) * ch + sy; i ? navCtx.lineTo(x, y) : navCtx.moveTo(x, y); }); navCtx.stroke();
      navCtx.setLineDash([]);
    }
    // Own-ship blip — a glowing cyan chevron pointing along her heading.
    navCtx.save(); navCtx.translate(cx, cy); navCtx.rotate((snap.heading || 0) * Math.PI / 180);
    navCtx.fillStyle = accLite; navCtx.shadowColor = accent; navCtx.shadowBlur = snap.sailing ? 10 : 6;
    navCtx.beginPath(); navCtx.moveTo(0, -6.5); navCtx.lineTo(4.5, 5.5); navCtx.lineTo(0, 2.5); navCtx.lineTo(-4.5, 5.5); navCtx.closePath(); navCtx.fill();
    navCtx.restore();
  }
  navRaf = requestAnimationFrame(drawNav);

  // ── Heading strip — a compass tape under the lubber showing all eight rhumbs. It rides the boat's
  // actual heading (marks slide as she comes about); the notch the wheel is locked into lights up so
  // you can see when you're "in the notch", and the fixed centre lubber turns green the instant she's
  // settled on it and free to make way (readyDir) — the "you can go now" cue.
  const stripCanvas = q('[data-strip]'), stripCtx = stripCanvas.getContext('2d');
  const STRIP_MARKS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
  let stripAlive = true, stripRaf = 0;
  function drawStrip() {
    if (!stripAlive) return;
    stripRaf = requestAnimationFrame(drawStrip);
    const box = stripCanvas.getBoundingClientRect(); if (!box.width || !stripCtx) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr));
    if (stripCanvas.width !== W || stripCanvas.height !== H) { stripCanvas.width = W; stripCanvas.height = H; }
    stripCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = box.width, h = box.height, cx = w / 2;
    stripCtx.clearRect(0, 0, w, h);
    // Glass bed + hairline frame.
    stripCtx.fillStyle = 'rgba(8,13,18,0.62)'; stripCtx.fillRect(0, 0, w, h);
    stripCtx.strokeStyle = acc(0.22); stripCtx.lineWidth = 1; stripCtx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const heading = ((ctrl.heading() % 360) + 360) % 360;
    const locked = ctrl.lockedDir?.() || null;   // notch the wheel is seated in (lit mark)
    const ready = ctrl.readyDir?.() || null;      // seated AND come round → green lubber
    const WIN = 70, pxDeg = (w / 2) / WIN;        // ±70° of tape visible across the strip
    stripCtx.textAlign = 'center'; stripCtx.textBaseline = 'middle';
    for (const [lab, deg] of STRIP_MARKS) {
      const off = ((deg - heading + 540) % 360) - 180;   // signed angle from the centred heading
      if (Math.abs(off) > WIN) continue;
      // x = cx − off·px (NOT +): as she turns to starboard (heading climbing, the wheel spun right)
      // the marks slide RIGHT, and to port they slide LEFT — the tape tracks the wheel's own hand.
      const x = cx - off * pxDeg, lit = locked === lab;
      stripCtx.strokeStyle = lit ? accLite : 'rgba(150,170,185,0.5)'; stripCtx.lineWidth = lit ? 2 : 1;
      stripCtx.beginPath(); stripCtx.moveTo(x, h * 0.14); stripCtx.lineTo(x, h * 0.42); stripCtx.stroke();
      stripCtx.font = `700 ${Math.round(h * 0.34)}px 'DejaVu Sans Mono',monospace`;
      if (lit) { stripCtx.fillStyle = accLite; stripCtx.shadowColor = accent; stripCtx.shadowBlur = 10; }
      else { stripCtx.fillStyle = 'rgba(150,170,185,0.6)'; stripCtx.shadowBlur = 0; }
      stripCtx.fillText(lab, x, h * 0.72); stripCtx.shadowBlur = 0;
    }
    // Fixed centre lubber — green (go) when she's ready, accent otherwise.
    stripCtx.fillStyle = ready ? accentGreen : accent;
    stripCtx.beginPath(); stripCtx.moveTo(cx, 2); stripCtx.lineTo(cx - 4, h * 0.2); stripCtx.lineTo(cx + 4, h * 0.2); stripCtx.closePath(); stripCtx.fill();
  }
  stripRaf = requestAnimationFrame(drawStrip);

  // ── Engine telegraph (a real variable throttle) ───────────────────────────────
  // The knob's HEIGHT is the bell: push it up to get underway, and the higher you push the harder she
  // steams — a bigger boiling wake AND a shorter passage (the server scales trip time by the bell, so
  // Full Ahead reaches the same tile in a fraction of a Dead-Slow passage). It holds where you set it
  // while under way and springs to STOP the moment she arrives.
  const tele = q('[data-tele]'), knob = q('[data-knob]'), track = q('.helm-tele-track'), teleLabel = q('[data-telelabel]');
  const KNOBH = 44, PAD = 8;
  const MS_PER_TILE = () => 2500;   // single speed (slow == fast), mirrors the server (local placeholder timing only)
  const cruiseFor = (t) => 0.35 + 0.65 * t;                // mirrors the server's visual bell (wake/water/knots)
  const throttleFor = (c) => Math.max(0, Math.min(1, (c - 0.35) / 0.65));   // invert: cruise → knob position
  const bellName = (p) => p < 0.34 ? 'Dead Slow' : p < 0.67 ? 'Half Ahead' : 'Full Ahead';
  let knobP = 0, teleDrag = false, engaged = false, dragStartP = 0;
  // An armed charted course from the chart popup: { gx, gy } absolute destination. While armed, pushing
  // the telegraph steams the whole pathfound course (sailto) instead of the wheel's locked direction.
  let plannedTarget = null;
  const setKnob = (p) => { knobP = Math.max(0, Math.min(1, p)); const rng = track.clientHeight - KNOBH - PAD * 2; knob.style.top = (PAD + (1 - knobP) * rng) + 'px'; };
  function setUnderway(on) {
    engaged = on; tele.classList.toggle('engaged', on); wheel.setEnabled(!on);
    teleLabel.textContent = on ? ('Ahead: ' + bellName(knobP)) : 'Engine Telegraph';
    if (!on) setKnob(0);   // arrived / moored / stopped → lever springs back to STOP (engaging leaves it where set)
  }
  // Cut the throttle mid-passage: fire the real `stop` (the server halts her at the tile she's coasted
  // to and confirms via helm_arrived) and freeze the local glide at once so the boat responds instantly.
  function cutThrottle() {
    ctrl.stopHere?.();      // freeze the local glide now; the server's helm_arrived re-centres authoritatively
    setUnderway(false);     // lever springs back to STOP, wheel unlocks
    onStop();               // fire the real `stop` in game
  }
  // Steam an armed charted course: fire the real `sailto`, and optimistically begin the local glide
  // along the previewed path so the chase view moves at once (the server's helm_underway corrects it).
  function engageCourse(bellFrac) {
    if (!plannedTarget) return;
    const t = Math.max(0.15, Math.min(1, bellFrac));
    const target = plannedTarget, plan = ctrl.plannedCourse();
    // Optimistic UI FIRST, then the network send — so the throttle/boat respond instantly and a hiccup
    // in the send can't leave them frozen (the server's helm_underway just corrects the local glide).
    setKnob(t);
    if (plan && plan.length >= 2) {
      const dir = dirLetter(plan[1][0] - plan[0][0], plan[1][1] - plan[0][1]);
      const estMs = (plan.length - 1) * 5000;   // course pace (5 s/leg); server confirms exact ms via helm_underway
      ctrl.beginTransit(dir, estMs, estMs, plan.length - 1, cruiseFor(t), plan);
    }
    plannedTarget = null; tele.classList.remove('course');
    setUnderway(true);
    closeChart();
    onSailTo(target.gx, target.gy, Math.round(t * 100));
  }
  function tryEngage() {
    // A charted course wins: the map has already picked the heading, so steam it regardless of the wheel.
    if (plannedTarget) { engageCourse(Math.max(0.15, knobP)); return; }
    const dir = ctrl.readyDir();
    if (!dir) { setKnob(0); tele.classList.add('warn'); teleLabel.textContent = 'Steady the helm'; setTimeout(() => { tele.classList.remove('warn'); if (!engaged) teleLabel.textContent = 'Engine Telegraph'; }, 1400); return; }
    const t = Math.max(0, Math.min(1, knobP));
    const estMs = MS_PER_TILE(t);   // one-tile manual nudge; the server's helm_underway confirms real ms/cruise, or helm_hold cancels if land is immediately ahead
    ctrl.beginTransit(dir, estMs, estMs, 1, cruiseFor(t));   // local placeholder (1 tile) matching the server's direct-sail; a hold is fixed at once by helm_hold
    onSail(dir, Math.round(t * 100));                        // fire the real `sail <dir> <bell%>` in game
    setUnderway(true);
  }
  // The lever is now grabbable even while underway — but the ONLY thing you can do mid-passage is haul
  // it back to STOP to cut the throttle. You can't re-bell a running passage (the server's pace is
  // fixed), so a drag that doesn't reach the STOP band just snaps the lever back where it was.
  const teleDown = (e) => { teleDrag = true; dragStartP = knobP; knob.setPointerCapture?.(e.pointerId); e.preventDefault(); };
  const teleMove = (e) => { if (!teleDrag) return; const r = track.getBoundingClientRect(); setKnob(1 - (e.clientY - r.top - KNOBH / 2) / (r.height - KNOBH));
    teleLabel.textContent = engaged ? (knobP <= 0.2 ? 'Cut throttle: All Stop' : 'Ahead: ' + bellName(knobP)) : (knobP > 0.2 ? bellName(knobP) : 'Engine Telegraph'); };
  const teleUp = () => {
    if (!teleDrag) return; teleDrag = false;
    if (engaged) { if (knobP <= 0.2) cutThrottle(); else setKnob(dragStartP); return; }   // underway: down-to-STOP cuts the throttle; anything else restores the lever
    if (knobP > 0.2) tryEngage(); else setKnob(0);
  };
  knob.addEventListener('pointerdown', teleDown);
  addEventListener('pointermove', teleMove); addEventListener('pointerup', teleUp);
  setKnob(0);

  // ── Chart popup — a tablet-styled basin map you tap to plot a course around the shoreline ──
  // Client-side A* over the visible world window gives an instant course preview; engaging it fires
  // the real `sailto`, and the server re-charts authoritatively (its path corrects the local glide).
  const mapOverlay = q('[data-map]'), mapCanvas = q('[data-mapc]'), mapCtx = mapCanvas.getContext('2d');
  const mapInfo = q('[data-mapinfo]'), mapGoBtn = q('[data-mapgo]'), mapClearBtn = q('[data-mapclear]');
  let mapOpen = false, mapRaf = 0, mapHover = null;
  const NB8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  // STRICT navigable water: only a real water-biome cell counts. The old test also accepted a cell
  // with NO biome (`|| !c.biome`), which let the course A* route the hull across off-map "air" edge
  // cells and any untagged land — that's what put her sailing through the city. She may only make way
  // over genuine open water (never a building tile), so the course can never leave the basin.
  const cellWater = (rows, rx, ry) => { const c = rows[ry] && rows[ry][rx]; return !!(c && c.biome === 'water' && !c.bt); };
  function previewCourse(rows, sx, sy, tx, ty) {
    const N = rows.length;
    if (tx < 0 || ty < 0 || tx >= N || ty >= N || !cellWater(rows, tx, ty) || (sx === tx && sy === ty)) return null;
    const key = (x, y) => x * N + y;
    const heur = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const start = { x: sx, y: sy, g: 0, parent: null }; start.f = heur(sx, sy);
    const open = new Map([[key(sx, sy), start]]), closed = new Set(); let count = 0;
    while (open.size) {
      let cur = null; for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
      open.delete(key(cur.x, cur.y));
      if (cur.x === tx && cur.y === ty) { const p = []; for (let n = cur; n; n = n.parent) p.push([n.x, n.y]); return p.reverse(); }
      closed.add(key(cur.x, cur.y));
      if (++count > 8000) return null;   // node cap sized to the full basin window (radius 36) so a far pick still previews; the server re-charts authoritatively regardless
      for (const [dx, dy] of NB8) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || closed.has(key(nx, ny)) || !cellWater(rows, nx, ny)) continue;
        if (dx && dy && (!cellWater(rows, cur.x + dx, cur.y) || !cellWater(rows, cur.x, cur.y + dy))) continue;
        const g = cur.g + (dx && dy ? Math.SQRT2 : 1);
        const ex = open.get(key(nx, ny)); if (ex && ex.g <= g) continue;
        const node = { x: nx, y: ny, g, parent: cur }; node.f = g + heur(nx, ny);
        open.set(key(nx, ny), node);
      }
    }
    return null;
  }
  function openChart() { if (ctrl.isBusy() || ctrl.isSailing()) return; mapOpen = true; mapOverlay.classList.add('open'); if (!mapRaf) mapRaf = requestAnimationFrame(drawChart); }
  function closeChart() { mapOpen = false; mapOverlay.classList.remove('open'); cancelAnimationFrame(mapRaf); mapRaf = 0; }
  function armCourse(abs) {
    const dest = abs[abs.length - 1];
    plannedTarget = { gx: dest[0], gy: dest[1] };
    ctrl.setPlannedCourse(abs); tele.classList.add('course'); mapGoBtn.disabled = false;
    mapInfo.innerHTML = `Course charted: <b>${abs.length - 1}</b> legs to <b>${dest[0]} · ${dest[1]}</b>. Get underway, or push the telegraph.`;
  }
  function clearCourse() {
    plannedTarget = null; ctrl.setPlannedCourse(null); tele.classList.remove('course');
    mapGoBtn.disabled = true; mapInfo.textContent = 'Tap a water tile to chart a course.';
  }
  const cellFromEvent = (e) => {
    const snap = ctrl.mapSnapshot?.(); if (!snap) return null;
    const rows = snap.rows || [], N = rows.length || 1, r = mapCanvas.getBoundingClientRect();
    const rx = Math.floor((e.clientX - r.left) / (r.width / N)), ry = Math.floor((e.clientY - r.top) / (r.height / N));
    if (rx < 0 || ry < 0 || rx >= N || ry >= N) return null;
    return { rx, ry, rows, N, c: (N - 1) / 2, gx: snap.gx, gy: snap.gy };
  };
  function drawChart(now) {
    if (mapOpen) mapRaf = requestAnimationFrame(drawChart);
    const snap = ctrl.mapSnapshot?.(); if (!snap || !mapCtx) return;
    const box = mapCanvas.parentElement.getBoundingClientRect(); if (!box.width) return;
    const side = Math.min(box.width - 32, 440), dpr = Math.min(2, devicePixelRatio || 1), W = Math.max(2, Math.round(side * dpr));
    if (mapCanvas.width !== W || mapCanvas.height !== W) { mapCanvas.width = W; mapCanvas.height = W; mapCanvas.style.height = side + 'px'; }
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = side, h = side, rows = snap.rows || [], N = rows.length || 1, cen = (N - 1) / 2, cw = w / N, ch = h / N;
    mapCtx.clearRect(0, 0, w, h);
    for (let ry = 0; ry < N; ry++) { const row = rows[ry] || []; for (let rx = 0; rx < row.length; rx++) {
      const cell = row[rx];
      // Navigable water is the bright teal bed you may plot into; land/shore/off-map are drawn dark
      // and then scrimmed so the water region reads as the ONLY live area — the "boundary" is the
      // coastline itself. An absent (off-map) cell falls through to the scrim over bare black.
      const water = cellWater(rows, rx, ry);
      if (water) { mapCtx.fillStyle = '#06222b'; }
      else if (cell) { mapCtx.fillStyle = cell.bt ? '#2c343d' : (cell.road ? '#232b33' : '#1b222a'); }
      else { mapCtx.fillStyle = '#0a0d11'; }
      mapCtx.fillRect(rx * cw, ry * ch, cw + 0.6, ch + 0.6);
      if (!water) { mapCtx.fillStyle = 'rgba(2,5,8,0.5)'; mapCtx.fillRect(rx * cw, ry * ch, cw + 0.6, ch + 0.6); }   // out-of-bounds scrim
    } }
    const toXY = (ax, ay) => [(cen + (ax - snap.gx) + 0.5) * cw, (cen + (ay - snap.gy) + 0.5) * ch];
    // Hover highlight (only on navigable water).
    if (mapHover && cellWater(rows, mapHover.rx, mapHover.ry)) {
      mapCtx.strokeStyle = acc(0.7); mapCtx.lineWidth = 1.5;
      mapCtx.strokeRect(mapHover.rx * cw + 0.5, mapHover.ry * ch + 0.5, cw - 1, ch - 1);
    }
    // Charted (planned) or active course polyline.
    const line = snap.path || snap.plannedPath;
    if (line && line.length >= 2) {
      mapCtx.strokeStyle = snap.path ? grn(0.95) : acc(0.9);
      mapCtx.lineWidth = 2; mapCtx.setLineDash(snap.path ? [] : [5, 4]); mapCtx.lineJoin = 'round';
      mapCtx.beginPath(); line.forEach(([ax, ay], i) => { const [x, y] = toXY(ax, ay); i ? mapCtx.lineTo(x, y) : mapCtx.moveTo(x, y); }); mapCtx.stroke();
      mapCtx.setLineDash([]);
      const [dx, dy] = toXY(line[line.length - 1][0], line[line.length - 1][1]);
      mapCtx.fillStyle = snap.path ? accentGreen : accLite; mapCtx.beginPath(); mapCtx.arc(dx, dy, 4, 0, 7); mapCtx.fill();
    }
    // Own-ship chevron at centre, along heading.
    const [ox, oy] = toXY(snap.gx + (snap.sub ? snap.sub.x : 0), snap.gy + (snap.sub ? snap.sub.y : 0));
    mapCtx.save(); mapCtx.translate(ox, oy); mapCtx.rotate((snap.heading || 0) * Math.PI / 180);
    mapCtx.fillStyle = accLite; mapCtx.shadowColor = accent; mapCtx.shadowBlur = 8;
    mapCtx.beginPath(); mapCtx.moveTo(0, -8); mapCtx.lineTo(5.5, 7); mapCtx.lineTo(0, 3.5); mapCtx.lineTo(-5.5, 7); mapCtx.closePath(); mapCtx.fill();
    mapCtx.restore();
  }
  mapCanvas.addEventListener('pointermove', (e) => { const cell = cellFromEvent(e); mapHover = cell ? { rx: cell.rx, ry: cell.ry } : null; });
  mapCanvas.addEventListener('pointerleave', () => { mapHover = null; });
  mapCanvas.addEventListener('click', (e) => {
    // The chart is water-only: a pick off the map or on land/shore can't be a destination. Reject it
    // with a specific reason instead of silently doing nothing, so it's clear you must choose water.
    const cell = cellFromEvent(e);
    if (!cell) { clearCourse(); mapInfo.textContent = 'Off the chart: tap open water inside the basin.'; return; }
    if (!cellWater(cell.rows, cell.rx, cell.ry)) { clearCourse(); mapInfo.textContent = "That's dry land: the Echelon can only make way over open water."; return; }
    const path = previewCourse(cell.rows, cell.c, cell.c, cell.rx, cell.ry);
    if (!path) { clearCourse(); mapInfo.textContent = 'No navigable channel to that tile, pick open water clear of the shore.'; return; }
    armCourse(path.map(([rx, ry]) => [cell.gx + (rx - cell.c), cell.gy + (ry - cell.c)]));
  });
  q('[data-mapclose]').addEventListener('click', closeChart);
  mapOverlay.addEventListener('pointerdown', (e) => { if (e.target === mapOverlay) closeChart(); });
  mapClearBtn.addEventListener('click', clearCourse);
  mapGoBtn.addEventListener('click', () => engageCourse(Math.max(knobP, 0.6)));
  root.querySelectorAll('[data-chart]').forEach(el => el.addEventListener('click', openChart));
  // ── THE SEAT ────────────────────────────────────────────────────────────────────────────────
  //
  // Chase or bridge. The chase is the right view for admiring a boat and the wrong one for being in
  // a sea: from behind and above, a wave is a texture on the water and the horizon is nailed to the
  // frame. On the bridge the eye is ON her, so the horizon goes up and down the window — which is
  // the whole reason the ride exists and the one thing the chase can never show.
  //
  // ⚠ IT REFLECTS THE CONTROLLER RATHER THAN KEEPING ITS OWN FLAG. `ctrl.toggleBridge()` returns
  // the seat it landed on, so the button cannot get out of step with the view even if something
  // else moves it.
  root.querySelectorAll('[data-seat]').forEach((el) => el.addEventListener('click', () => {
    const on = ctrl && ctrl.toggleBridge ? ctrl.toggleBridge() : false;
    el.classList.toggle('on', on);
    el.textContent = on ? '⎈' : '⌖';
    el.title = on ? 'the bridge: back to the chase camera' : 'the bridge: stand at the wheel and ride her';
  }));

  // Orbit / zoom on the sea — the chase cam stays fixed on the boat and arcs around it.
  let drag = false, lx = 0, ly = 0;
  // A finger goes through bindTouchGestures below, so two of them pinch instead of the orbit jumping between them.
  sea.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; drag = true; lx = e.clientX; ly = e.clientY; sea.setPointerCapture?.(e.pointerId); });
  sea.addEventListener('pointermove', (e) => { if (!drag) return; ctrl.orbit((e.clientX - lx) * 0.4); lx = e.clientX; ly = e.clientY; });   // azimuth-only dome orbit (no vertical tilt)
  const upH = () => { drag = false; }; addEventListener('pointerup', upH);
  sea.addEventListener('wheel', (e) => { e.preventDefault(); ctrl.zoom(e.deltaY > 0 ? 0.08 : -0.08); }, { passive: false });
  bindTouchGestures(sea, { drag: (dx) => ctrl.orbit(dx * 0.4), pinch: (f) => ctrl.zoom(-Math.log(f) * 0.9) });

  // Fullscreen + collapse-panel — the SAME body-class mechanism the flight sim uses (styles.css),
  // instead of an OS-fullscreen overlay; both are cleared on close.
  //   ⊟ collapse (helm-hidepanel): folds away just the scrollback log — the command bar stays.
  //   ⛶ fullscreen (helm-fullscreen): folds the log AND the command bar for the fully immersive view.
  // They're mutually exclusive (engaging one drops the other), mirroring the flight sim's ⊟ / ⛶ chrome.
  const fsBtn = q('[data-fs]'), hideBtn = q('[data-hide]');
  fsBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('helm-fullscreen'); fsBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('helm-hidepanel'); hideBtn.classList.remove('on'); }   // fullscreen supersedes collapse
    fitCamera();
  });
  hideBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('helm-hidepanel'); hideBtn.classList.toggle('on', on);
    if (on) { document.body.classList.remove('helm-fullscreen'); fsBtn.classList.remove('on'); }   // collapse supersedes fullscreen
    fitCamera();
  });
  // ⤢ big screen — the rung above ⛶, and a different layer rather than a third mutually-exclusive
  // one: it takes the PAGE (header, sidebar, log, command bar) and the wheelhouse's own chrome with
  // it, and leaves whatever ⛶/⊟ were set to for when Esc brings you back. bigscreen.js keeps the
  // lit state, since Esc can leave the mode without this button being touched.
  bindBigScreenButton(q('[data-big]'));
  // ⌨ …and the keyboard, which this seat has never taken. Esc leaves the helm and O takes the
  // camera off its mount, and both of them are read off the WINDOW and dropped the moment a text
  // field has focus — so a player who had clicked the command bar once was standing at a wheel
  // whose two keys did nothing, with nothing on screen saying why. See seat-keys.js.
  claimSeatKeyboard(root, { label: 'HELM' });
  q('[data-exit]').addEventListener('click', () => { closeHelm(); onExit(); });

  // Default to the hide-panel view: fold the scrollback log so the helm fills the whole column
  // (the windowed pane is too short to see the ship with the log up), keeping the command bar so you
  // can still type. ⊟ toggles back to windowed, ⛶ goes fully immersive; closeHelm() clears the class.
  document.body.classList.add('helm-hidepanel'); hideBtn.classList.add('on');
  fitCamera();

  // Keyboard: Esc exits. (Course is the wheel; the throttle is the telegraph — both are grab-and-drag.)
  const keyH = (e) => { if (e.key === 'Escape') { closeHelm(); onExit(); } };
  addEventListener('keydown', keyH);

  // Restore an in-progress passage (helm opened mid-transit): lock + run out the remaining time,
  // seeding true progress from the full passage length so the world resumes part-slid (not from 0).
  if (opts.transitMs > 0) { if (opts.cruise > 0) setKnob(throttleFor(opts.cruise)); ctrl.beginTransit(HDG_TO_DIR[((Math.round(opts.heading || 0) % 360) + 360) % 360] || 'N', opts.transitMs, opts.transitTotal || opts.transitMs, opts.transitTiles || 1, opts.cruise); setUnderway(true); }

  // Live readouts (heading eases + the passage runs on a timer, so poll). The telegraph/wheel lock
  // tracks her actual under-way state, so a server-driven begin/arrive keeps the console in sync.
  let wasSailing = engaged;
  const poll = setInterval(() => {
    const h = ((Math.round(ctrl.heading()) % 360) + 360) % 360;
    q('[data-hdg]').textContent = CARD[h] ?? (h + '°');
    q('[data-kn]').textContent = (ctrl.speed() * 20).toFixed(1);
    const snap = ctrl.mapSnapshot?.();
    if (snap) {
      // Her committed tile (snap.gx/gy) stays on the DEPARTURE tile until she arrives, so add the live
      // sub-tile glide (snap.sub) to it — POSITION then counts toward the destination as she crosses,
      // instead of sitting frozen on the departure tile for the whole passage (read as "not moving").
      const px = Math.round(snap.gx + (snap.sub ? snap.sub.x : 0));
      const py = Math.round(snap.gy + (snap.sub ? snap.sub.y : 0));
      q('[data-pos]').textContent = px + ' · ' + py;
    }
    const sailing = ctrl.isSailing();
    if (sailing !== wasSailing) { if (sailing) setKnob(throttleFor(ctrl.cruise())); setUnderway(sailing); wasSailing = sailing; }
    const left = ctrl.transitLeft();
    q('[data-eta]').textContent = left > 0 ? fmtETA(left) : '—';
    q('.helm-readout.eta').classList.toggle('idle', left <= 0);
    const busy = ctrl.isBusy();
    q('[data-status]').textContent = sailing ? 'MAKING WAY' : (busy ? 'COMING ABOUT' : 'MOORED');
    q('.helm-readout.st').classList.toggle('busy', busy);
    const env = ctrl.env?.();   // live world time/weather for the chips
    if (env) { q('[data-time]').textContent = env.time; q('[data-wx]').textContent = (env.weather || 'clear').toUpperCase(); }
  }, 100);

  _helm = { mount, root, ctrl, wheel, poll, upH, keyH, teleMove, teleUp, fitRO, stopChart: closeChart, stopNav: () => { navAlive = false; cancelAnimationFrame(navRaf); stripAlive = false; cancelAnimationFrame(stripRaf); } };
  return { ctrl, wheel, close: () => { closeHelm(); onExit(); }, setPosition: (gx, gy) => ctrl.setPosition(gx, gy), setHeading: (h) => ctrl.setHeading(h), setSky: (sky) => ctrl.setSky(sky) };
}

export function closeHelm() {
  if (!_helm) return;
  const h = _helm; _helm = null;
  window.dispatchEvent(new Event('pane:released'));  // hand the collapsed pane back to the phone layout
  clearInterval(h.poll);
  removeEventListener('pointerup', h.upH);
  removeEventListener('keydown', h.keyH);
  removeEventListener('pointermove', h.teleMove);
  removeEventListener('pointerup', h.teleUp);
  try { h.fitRO?.disconnect(); } catch {}
  try { h.stopNav?.(); } catch {}
  try { h.stopChart?.(); } catch {}
  document.body.classList.remove('helm-fullscreen', 'helm-hidepanel');
  exitBigScreen();   // …and the rung above them, which owns the page rather than the pane
  endSeatKeyboard(h.root);   // the keyboard goes back to the command bar with the wheelhouse
  try { h.wheel?.destroy(); } catch {}
  try { h.ctrl?.destroy(); } catch {}
  try { if (window.__helmCtrl === h.ctrl) delete window.__helmCtrl; } catch {}
  if (h.mount) h.mount.innerHTML = '';
}
