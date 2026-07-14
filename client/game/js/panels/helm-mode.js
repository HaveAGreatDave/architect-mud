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

// One tile is a 90-second passage (mirrors SAIL_TRANSIT_MS server-side). The console locks for the
// full passage; the server's helm_arrived releases it precisely, this is the local fallback timer.
const HELM_TRANSIT_MS = 90_000;

let _helm = null;
export function isHelmActive() { return !!_helm; }
// The server streams the live sim sky (real weather field) while the helm is open, and confirms an
// arrival at the end of a passage — both routed here by dispatch.
export function helmSetSky(sky) { _helm?.ctrl?.setSky(sky); }
export function helmSetWorld(rows, cx, cy) { _helm?.ctrl?.setWorld(rows, cx, cy); }
export function helmSetContacts(list) { _helm?.ctrl?.setContacts(list); }
export function helmEndTransit(gx, gy) { _helm?.ctrl?.endTransit(gx, gy); }

export function ensureHelmStyles() {
  if (document.getElementById('helm-mode-styles')) return;
  const s = document.createElement('style'); s.id = 'helm-mode-styles';
  s.textContent = `
    /* Takes over the area pane like the flight sim — the sidebar, top bar and log stay put. Fills
       the pane's height the way the glass cockpit does; the ⛶ chip toggles true OS fullscreen. */
    #area-content:has(.helm-root){ height:100%; }
    .helm-root{ position:relative; width:100%; height:100%; min-height:420px; overflow:hidden;
      --hs:1;   /* console scale — driven down by a ResizeObserver on short panes so the ship stays clear */
      --accent:#5ccfe0; --accent-hi:#bdf1f8; --accent-lo:#2b8b99; --chart:#4fd0e0;
      --hpanel:#0e141b; --hink:#e2edf3; --hdim:#8ba0ae; --stbd:#35d07a;
      --steel:#c3cdd6; --steel-hi:#eff4f8; --steel-lo:#5c6670;
      --hmono:'DejaVu Sans Mono','Consolas','Courier New',monospace; --hsans:'Helvetica Neue',Arial,system-ui,sans-serif;
      --hcarbon:repeating-linear-gradient(45deg,#12161b 0 3px,#0d1116 3px 6px),repeating-linear-gradient(-45deg,rgba(44,52,61,.5) 0 3px,transparent 3px 6px);
      font-family:var(--hsans); color:var(--hink); border-radius:8px; background:#04070c; }
    .helm-root:fullscreen{ height:100vh; border-radius:0; }
    .helm-chase{ position:absolute; inset:0; z-index:0; }
    .helm-chase canvas{ cursor:grab; } .helm-chase canvas:active{ cursor:grabbing; }
    .helm-placard{ position:absolute; top:12px; left:14px; z-index:6; display:flex; align-items:center; gap:9px; pointer-events:none; }
    .helm-placard .m{ width:20px; height:20px; border-radius:50%; border:1.5px solid var(--accent);
      background:radial-gradient(circle at 50% 35%,var(--accent-hi),var(--accent-lo)); box-shadow:0 0 12px color-mix(in srgb,var(--accent) 55%,transparent); }
    .helm-placard .n{ font-family:var(--hmono); letter-spacing:5px; color:var(--accent); font-size:13px; font-weight:700; }
    .helm-placard .n small{ color:var(--hdim); letter-spacing:2px; }
    .helm-chips{ position:absolute; top:12px; right:14px; z-index:6; display:flex; gap:8px; align-items:center; font-family:var(--hmono); }
    .helm-chip{ background:rgba(8,13,18,.6); border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-radius:8px;
      padding:5px 10px; font-size:12px; letter-spacing:1px; backdrop-filter:blur(3px); color:var(--hink); }
    .helm-chip b{ color:var(--accent-hi); }
    .helm-icon{ background:rgba(8,13,18,.6); border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-radius:8px;
      color:var(--accent); font-size:15px; width:34px; height:32px; cursor:pointer; backdrop-filter:blur(3px); line-height:1; }
    .helm-icon:hover{ filter:brightness(1.25); } .helm-icon.on{ background:var(--accent); color:#05141f; }
    .helm-icon.exit{ color:#ff8a7a; border-color:color-mix(in srgb,#ff8a7a 40%,transparent); font-weight:700; }
    /* ── The console ──────────────────────────────────────────────────────────────
       A single machined brushed-metal helm station laid across the bottom of the view.
       The ship's wheel rises out of a binnacle at its centre so its lower half tucks
       behind the console lip; the NAV chart + digital instruments + engine telegraph
       are milled into the face. Cool cyan HUD glass on brushed steel + carbon fibre. */
    .helm-dash{ position:absolute; left:0; right:0; bottom:0; z-index:5; }
    .helm-console{ position:relative; padding-bottom:env(safe-area-inset-bottom);
      /* brushed titanium: fine vertical grain over a top-lit gunmetal body */
      background:
        linear-gradient(180deg,rgba(255,255,255,.10) 0,rgba(255,255,255,0) 3px),
        repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 1px,rgba(0,0,0,.05) 1px 2px,transparent 2px 4px),
        radial-gradient(140% 120% at 50% -10%,#3a4149 0,#242a31 32%,#161a20 66%,#0c0f14 100%);
      border-top:1px solid rgba(0,0,0,.7);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 -14px 34px rgba(0,0,0,.55); }
    /* a thin machined steel seam catches light on the lip — a polished filet, not a glowing bar */
    .helm-console::before{ content:''; position:absolute; left:0; right:0; top:1px; height:1px; pointer-events:none;
      background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--steel) 40%,transparent) 22%,color-mix(in srgb,var(--steel-hi) 75%,transparent) 50%,color-mix(in srgb,var(--steel) 40%,transparent) 78%,transparent 96%);
      opacity:.7; }
    .helm-console-face{ position:relative; display:grid; grid-template-columns:minmax(calc(190px*var(--hs)),1fr) minmax(calc(220px*var(--hs)),320px) 1fr; align-items:center; gap:calc(22px*var(--hs));
      padding:calc(14px*var(--hs)) calc(26px*var(--hs)) calc(15px*var(--hs)); max-width:1180px; margin:0 auto; }
    /* faint carbon-fibre weave milled into the console face, under the brushed grain */
    .helm-console-face::before{ content:''; position:absolute; inset:0; pointer-events:none; opacity:.14;
      background:var(--hcarbon); background-size:6px 6px,6px 6px; mix-blend-mode:overlay; }

    /* NAV chart — top-down basin scope with the Echelon blip */
    .helm-nav{ display:flex; align-items:center; gap:12px; }
    .helm-nav-scope{ position:relative; width:calc(132px*var(--hs)); height:calc(104px*var(--hs)); border-radius:9px; flex:0 0 auto;
      background:linear-gradient(180deg,#03151b,#010a0e); overflow:hidden;
      border:1px solid color-mix(in srgb,var(--chart) 32%,#000);
      box-shadow:inset 0 0 22px rgba(0,0,0,.85), inset 0 0 8px color-mix(in srgb,var(--chart) 16%,transparent), 0 1px 0 rgba(255,255,255,.06); }
    .helm-nav-scope canvas{ display:block; width:100%; height:100%; }
    /* faint horizontal scanlines over the scope for a CRT feel */
    .helm-nav-scope::after{ content:''; position:absolute; inset:0; pointer-events:none;
      background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px); mix-blend-mode:multiply; }
    .helm-nav-tag{ position:absolute; left:7px; top:6px; font-family:var(--hmono); font-size:8px; letter-spacing:2px;
      color:color-mix(in srgb,var(--chart) 82%,#fff); text-shadow:0 0 6px color-mix(in srgb,var(--chart) 70%,transparent); z-index:2; }

    /* Digital instrument readouts — recessed HUD glass, cyan phosphor */
    .helm-gauges{ display:grid; grid-template-columns:repeat(2,1fr); gap:9px; }
    .helm-readout{ position:relative; padding:6px 11px 7px; border-radius:8px; overflow:hidden;
      background:linear-gradient(180deg,#05171d 0,#020a0e 100%);
      border:1px solid color-mix(in srgb,var(--chart) 26%,#000);
      box-shadow:inset 0 0 14px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.05); }
    .helm-readout.wide{ flex:1; min-width:0; }
    .helm-readout .rk{ display:block; font-family:var(--hmono); font-size:8px; letter-spacing:2.5px; text-transform:uppercase;
      color:color-mix(in srgb,var(--chart) 55%,var(--hdim)); }
    .helm-readout .rv{ display:block; margin-top:2px; font-family:var(--hmono); font-weight:700; font-size:17px; letter-spacing:1px;
      font-variant-numeric:tabular-nums; color:color-mix(in srgb,var(--chart) 85%,#fff);
      text-shadow:0 0 7px color-mix(in srgb,var(--chart) 55%,transparent); }
    .helm-readout .rv.big{ font-size:22px; letter-spacing:2px; }
    .helm-readout .rv.sm{ font-size:13px; letter-spacing:1.5px; }
    .helm-readout .rv i{ font-style:normal; font-size:9px; margin-left:3px; opacity:.6; letter-spacing:.5px; }
    .helm-readout.eta .rv{ color:color-mix(in srgb,var(--accent-hi) 88%,#fff); text-shadow:0 0 7px color-mix(in srgb,var(--accent) 55%,transparent); }
    .helm-readout.eta.idle .rv{ color:var(--hdim); text-shadow:none; }
    .helm-readout.st .rv{ color:var(--hdim); text-shadow:none; }
    .helm-readout.st.busy .rv{ color:var(--stbd); text-shadow:0 0 7px color-mix(in srgb,var(--stbd) 55%,transparent); }

    /* Wheel binnacle — the wheel straddles the console top edge, lower half behind the lip */
    .helm-col{ position:absolute; left:50%; bottom:100%; transform:translate(-50%,52%); z-index:6;
      display:flex; flex-direction:column; align-items:center; gap:3px; pointer-events:none; }
    .helm-col canvas{ pointer-events:auto; }
    .helm-wheel{ width:calc(178px*var(--hs)); height:calc(178px*var(--hs)); filter:drop-shadow(0 10px 22px rgba(0,0,0,.8)); }
    .helm-col .cap{ font-family:var(--hmono); font-size:8px; letter-spacing:4px; color:color-mix(in srgb,var(--accent) 70%,var(--hdim)); text-transform:uppercase;
      background:rgba(4,7,11,.6); padding:1px 8px; border-radius:4px; }

    /* Engine telegraph — a milled steel lever in a carbon slot, right of the console */
    .helm-tele{ display:flex; flex-direction:column; align-items:center; gap:6px; user-select:none; justify-self:end; }
    .helm-tele-track{ position:relative; width:calc(60px*var(--hs)); height:calc(128px*var(--hs)); border-radius:11px;
      background:var(--hcarbon),linear-gradient(180deg,#0f1319,#05080c); background-size:6px 6px,6px 6px,auto;
      border:1px solid color-mix(in srgb,var(--steel) 32%,#000);
      box-shadow:inset 0 2px 10px rgba(0,0,0,.85),0 1px 0 rgba(255,255,255,.08); overflow:hidden; }
    .helm-tele-track::before{ content:''; position:absolute; left:50%; top:14px; bottom:14px; width:6px; transform:translateX(-50%);
      border-radius:4px; background:linear-gradient(180deg,#04060a,#141922); box-shadow:inset 0 0 5px rgba(0,0,0,.95); }
    .helm-tele-mark{ position:absolute; left:0; right:0; text-align:center; font-family:var(--hmono); font-size:8px; letter-spacing:2px; color:var(--hdim); pointer-events:none; z-index:2; }
    .helm-tele-mark.ahead{ top:7px; color:var(--stbd); } .helm-tele-mark.stop{ bottom:7px; }
    /* brushed-steel knob: fine vertical grain + machined grip ridges */
    .helm-tele-knob{ position:absolute; left:7px; right:7px; height:32px; top:78px; border-radius:7px; cursor:grab; touch-action:none; z-index:3;
      background:repeating-linear-gradient(90deg,rgba(255,255,255,.14) 0 1px,rgba(0,0,0,.10) 1px 2px,transparent 2px 3px),linear-gradient(180deg,var(--steel-hi),var(--steel) 52%,var(--steel-lo));
      border:1px solid #20262c; box-shadow:0 3px 8px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.7),inset 0 -2px 4px rgba(0,0,0,.4); }
    .helm-tele-knob::after{ content:''; position:absolute; left:6px; right:6px; top:50%; height:7px; transform:translateY(-50%);
      background:repeating-linear-gradient(90deg,rgba(0,0,0,.42) 0 2px,rgba(255,255,255,.12) 2px 3px,transparent 3px 4px); border-radius:2px; }
    .helm-tele-knob:active{ cursor:grabbing; }
    .helm-tele.engaged .helm-tele-knob{ cursor:not-allowed; box-shadow:0 0 14px var(--stbd),0 3px 8px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.7); }
    .helm-tele.engaged .helm-tele-track{ border-color:var(--stbd); box-shadow:inset 0 2px 10px rgba(0,0,0,.85),0 0 12px color-mix(in srgb,var(--stbd) 40%,transparent); }
    .helm-tele-label{ font-family:var(--hmono); font-size:8px; letter-spacing:2.5px; color:var(--hdim); text-transform:uppercase; }
    .helm-tele.warn .helm-tele-label{ color:#ff8a7a; }

    @media (max-width:760px){
      .helm-console-face{ grid-template-columns:1fr auto; grid-template-rows:auto auto; gap:12px 18px; padding:12px 16px 13px; }
      .helm-nav{ order:1; } .helm-gauges{ order:3; grid-column:1 / -1; grid-template-columns:repeat(4,1fr); } .helm-tele{ order:2; }
      .helm-wheel{ width:150px; height:150px; } .helm-col{ transform:translate(-50%,46%); }
      .helm-nav-scope{ width:112px; height:88px; } }`;
  document.head.appendChild(s);
}

const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const HDG_TO_DIR = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
const fmtETA = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function openHelm(opts = {}) {
  const mount = opts.mount || document.getElementById('area-content');
  if (!mount) return null;
  closeHelm();
  ensureHelmStyles();
  // Steel-cyan wheel accent (carbon rim, cyan LED grooves + needle) — pinned so it stays brushed-
  // metal/cyan regardless of the player's global theme accent, which may be gold.
  const accent = opts.accent || '#5ccfe0';
  const onSail = opts.onSail || (() => {});
  const onExit = opts.onExit || (() => {});

  mount.innerHTML = `
    <div class="helm-root">
      <div class="helm-chase"></div>
      <div class="helm-placard"><span class="m"></span><span class="n">ECHELON&nbsp; <small>HELM</small></span></div>
      <div class="helm-chips">
        <span class="helm-chip"><b data-wx>CLEAR</b></span>
        <span class="helm-chip"><b data-time>--:--</b></span>
        <button class="helm-icon" data-hide title="hide the log — more view">⊟</button>
        <button class="helm-icon" data-fs title="fullscreen">⛶</button>
        <button class="helm-icon exit" data-exit title="leave the helm">✕</button>
      </div>
      <div class="helm-dash">
        <div class="helm-console">
          <div class="helm-console-face">
            <!-- NAV chart: live top-down basin chart with the Echelon's blip. -->
            <div class="helm-nav">
              <div class="helm-nav-scope"><canvas data-nav></canvas><span class="helm-nav-tag">NAV · BASIN</span></div>
              <div class="helm-readout wide"><span class="rk">Position</span><span class="rv" data-pos>— · —</span></div>
            </div>
            <!-- Digital instrument stack -->
            <div class="helm-gauges">
              <div class="helm-readout hdg"><span class="rk">Heading</span><span class="rv big" data-hdg>N</span></div>
              <div class="helm-readout"><span class="rk">Speed</span><span class="rv"><span data-kn>0.0</span><i>kn</i></span></div>
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
        <!-- Wheel sits in a binnacle straddling the console lip — its lower half tucks behind. -->
        <div class="helm-col">
          <canvas class="helm-wheel"></canvas>
          <div class="cap">Course</div>
        </div>
      </div>
    </div>`;

  const root = mount.querySelector('.helm-root');
  const q = (s) => root.querySelector(s);

  // Dynamic console scale — the shorter the view pane, the smaller the whole helm station (console
  // bar + wheel + telegraph shrink together via --hs) so the Echelon is never buried behind it.
  // At a comfortable height the station is full-size; it eases down to ~0.6 on a squat pane.
  const rescale = () => {
    const h = root.clientHeight || 0;
    root.style.setProperty('--hs', String(Math.max(0.6, Math.min(1, (h - 150) / 560)).toFixed(3)));
  };
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(rescale) : null;
  ro ? ro.observe(root) : addEventListener('resize', rescale);
  rescale();

  const ctrl = openHelmChase(q('.helm-chase'), {
    gx: opts.gx ?? 0, gy: opts.gy ?? 0, heading: opts.heading ?? 0, sky: opts.sky,
    onArrive: (gx, gy) => { q('[data-pos]').textContent = gx + ' · ' + gy; },
  });
  if (opts.sky) ctrl.setSky(opts.sky);   // seed the real sim weather field immediately
  if (opts.map) ctrl.setWorld(opts.map, opts.gx, opts.gy);   // frame her against the REAL basin, not blank ocean

  // The wheel is a DIRECT course selector: its (heavily geared) rotation demands a course and she
  // swings slowly toward it; the hub needle reads her actual heading as she comes round.
  const wheel = createHelmWheel(q('.helm-wheel'), { accent, gear: 8, onCourse: (deg) => ctrl.setCourse(deg), getHeading: () => ctrl.heading() });

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
    navCtx.strokeStyle = 'rgba(79,208,224,0.16)'; navCtx.lineWidth = 1;
    for (const r of [h * 0.22, h * 0.42]) { navCtx.beginPath(); navCtx.arc(cx, cy, r, 0, 7); navCtx.stroke(); }
    navCtx.beginPath(); navCtx.moveTo(cx - 5, cy); navCtx.lineTo(cx + 5, cy); navCtx.moveTo(cx, cy - 5); navCtx.lineTo(cx, cy + 5); navCtx.stroke();
    // Radar sweep — a fading wedge rotating clockwise.
    const sweep = ((now || 0) * 0.0011) % (Math.PI * 2);
    navCtx.save(); navCtx.translate(cx, cy); navCtx.rotate(sweep);
    const grad = navCtx.createLinearGradient(0, 0, h * 0.5, 0);
    grad.addColorStop(0, 'rgba(79,208,224,0.26)'); grad.addColorStop(1, 'rgba(79,208,224,0)');
    navCtx.fillStyle = grad; navCtx.beginPath(); navCtx.moveTo(0, 0); navCtx.arc(0, 0, h * 0.5, -0.32, 0); navCtx.closePath(); navCtx.fill();
    navCtx.restore();
    // Own-ship blip — a glowing cyan chevron pointing along her heading.
    navCtx.save(); navCtx.translate(cx, cy); navCtx.rotate((snap.heading || 0) * Math.PI / 180);
    navCtx.fillStyle = '#c7f3fa'; navCtx.shadowColor = '#5ccfe0'; navCtx.shadowBlur = snap.sailing ? 10 : 6;
    navCtx.beginPath(); navCtx.moveTo(0, -6.5); navCtx.lineTo(4.5, 5.5); navCtx.lineTo(0, 2.5); navCtx.lineTo(-4.5, 5.5); navCtx.closePath(); navCtx.fill();
    navCtx.restore();
  }
  navRaf = requestAnimationFrame(drawNav);

  // ── Engine telegraph (the throttle) ──────────────────────────────────────────
  // Drag the handle up to AHEAD to engage: she gets underway and the console pins for the whole
  // ten-minute passage (wheel + telegraph locked). It springs back to STOP the moment she arrives.
  const tele = q('[data-tele]'), knob = q('[data-knob]'), track = q('.helm-tele-track'), teleLabel = q('[data-telelabel]');
  const KNOBH = 34, PAD = 8;
  let knobP = 0, teleDrag = false, engaged = false;
  const setKnob = (p) => { knobP = Math.max(0, Math.min(1, p)); const rng = track.clientHeight - KNOBH - PAD * 2; knob.style.top = (PAD + (1 - knobP) * rng) + 'px'; };
  function setUnderway(on) {
    engaged = on; tele.classList.toggle('engaged', on); wheel.setEnabled(!on);
    teleLabel.textContent = on ? 'Ahead — Underway' : 'Engine Telegraph';
    setKnob(on ? 1 : 0);
  }
  function tryEngage() {
    const dir = ctrl.readyDir();
    if (!dir) { setKnob(0); tele.classList.add('warn'); teleLabel.textContent = 'Steady the helm'; setTimeout(() => { tele.classList.remove('warn'); if (!engaged) teleLabel.textContent = 'Engine Telegraph'; }, 1400); return; }
    ctrl.beginTransit(dir, HELM_TRANSIT_MS);   // local passage timer (server confirms arrival)
    onSail(dir);                               // fire the real `sail` command in game
    setUnderway(true);
  }
  const teleDown = (e) => { if (engaged) return; teleDrag = true; knob.setPointerCapture?.(e.pointerId); e.preventDefault(); };
  const teleMove = (e) => { if (!teleDrag) return; const r = track.getBoundingClientRect(); setKnob(1 - (e.clientY - r.top - KNOBH / 2) / (r.height - KNOBH)); };
  const teleUp = () => { if (!teleDrag) return; teleDrag = false; if (knobP > 0.85) tryEngage(); else if (!engaged) setKnob(0); };
  knob.addEventListener('pointerdown', teleDown);
  addEventListener('pointermove', teleMove); addEventListener('pointerup', teleUp);
  setKnob(0);

  // Orbit / zoom on the sea — the chase cam stays fixed on the boat and arcs around it.
  const sea = q('.helm-chase'); let drag = false, lx = 0, ly = 0;
  sea.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; sea.setPointerCapture?.(e.pointerId); });
  sea.addEventListener('pointermove', (e) => { if (!drag) return; ctrl.orbit((e.clientX - lx) * 0.4, -(e.clientY - ly) * 0.006); lx = e.clientX; ly = e.clientY; });
  const upH = () => { drag = false; }; addEventListener('pointerup', upH);
  sea.addEventListener('wheel', (e) => { e.preventDefault(); ctrl.zoom(e.deltaY > 0 ? 0.08 : -0.08); }, { passive: false });

  // Fullscreen / hide-panel — the SAME body-class mechanism the flight sim uses (styles.css):
  // the helm grows to fill the output column (⛶ also folds the command box, ⊟ keeps it) instead
  // of an OS-fullscreen overlay. Cleared on close.
  const fsBtn = q('[data-fs]'), hideBtn = q('[data-hide]');
  fsBtn.addEventListener('click', () => { const on = document.body.classList.toggle('helm-fullscreen'); fsBtn.classList.toggle('on', on); if (on) { document.body.classList.remove('helm-hidepanel'); hideBtn.classList.remove('on'); } });
  hideBtn.addEventListener('click', () => { const on = document.body.classList.toggle('helm-hidepanel'); hideBtn.classList.toggle('on', on); if (on) { document.body.classList.remove('helm-fullscreen'); fsBtn.classList.remove('on'); } });
  q('[data-exit]').addEventListener('click', () => { closeHelm(); onExit(); });

  // Keyboard: Esc exits. (Course is the wheel; the throttle is the telegraph — both are grab-and-drag.)
  const keyH = (e) => { if (e.key === 'Escape') { closeHelm(); onExit(); } };
  addEventListener('keydown', keyH);

  // Restore an in-progress passage (helm opened mid-transit): lock + run out the remaining time,
  // seeding true progress from the full passage length so the world resumes part-slid (not from 0).
  if (opts.transitMs > 0) { ctrl.beginTransit(HDG_TO_DIR[((Math.round(opts.heading || 0) % 360) + 360) % 360] || 'N', opts.transitMs, opts.transitTotal || opts.transitMs); setUnderway(true); }

  // Live readouts (heading eases + the passage runs on a timer, so poll). The telegraph/wheel lock
  // tracks her actual under-way state, so a server-driven begin/arrive keeps the console in sync.
  let wasSailing = engaged;
  const poll = setInterval(() => {
    const h = ((Math.round(ctrl.heading()) % 360) + 360) % 360;
    q('[data-hdg]').textContent = CARD[h] ?? (h + '°');
    q('[data-kn]').textContent = (ctrl.speed() * 20).toFixed(1);
    const snap = ctrl.mapSnapshot?.();
    if (snap) q('[data-pos]').textContent = snap.gx + ' · ' + snap.gy;
    const sailing = ctrl.isSailing();
    if (sailing !== wasSailing) { setUnderway(sailing); wasSailing = sailing; }
    const left = ctrl.transitLeft();
    q('[data-eta]').textContent = left > 0 ? fmtETA(left) : '—';
    q('.helm-readout.eta').classList.toggle('idle', left <= 0);
    const busy = ctrl.isBusy();
    q('[data-status]').textContent = sailing ? 'MAKING WAY' : (busy ? 'COMING ABOUT' : 'MOORED');
    q('.helm-readout.st').classList.toggle('busy', busy);
    const env = ctrl.env?.();   // live world time/weather for the chips
    if (env) { q('[data-time]').textContent = env.time; q('[data-wx]').textContent = (env.weather || 'clear').toUpperCase(); }
  }, 100);

  _helm = { mount, ctrl, wheel, poll, upH, keyH, teleMove, teleUp, ro, rescale, stopNav: () => { navAlive = false; cancelAnimationFrame(navRaf); } };
  return { ctrl, wheel, close: () => { closeHelm(); onExit(); }, setPosition: (gx, gy) => ctrl.setPosition(gx, gy), setHeading: (h) => ctrl.setHeading(h), setSky: (sky) => ctrl.setSky(sky) };
}

export function closeHelm() {
  if (!_helm) return;
  const h = _helm; _helm = null;
  clearInterval(h.poll);
  removeEventListener('pointerup', h.upH);
  removeEventListener('keydown', h.keyH);
  removeEventListener('pointermove', h.teleMove);
  removeEventListener('pointerup', h.teleUp);
  try { h.ro ? h.ro.disconnect() : removeEventListener('resize', h.rescale); } catch {}
  try { h.stopNav?.(); } catch {}
  document.body.classList.remove('helm-fullscreen', 'helm-hidepanel');
  try { h.wheel?.destroy(); } catch {}
  try { h.ctrl?.destroy(); } catch {}
  if (h.mount) h.mount.innerHTML = '';
}
