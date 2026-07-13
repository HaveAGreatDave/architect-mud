// Echelon Helm mode — the in-game console. Takes over the whole client on launch (a maximized
// overlay, like a bridge console), with the chase view under a glass brass dash: the ship's wheel
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

// One tile is a ten-minute passage (mirrors SAIL_TRANSIT_MS server-side). The console locks for the
// full passage; the server's helm_arrived releases it precisely, this is the local fallback timer.
const HELM_TRANSIT_MS = 10 * 60_000;

let _helm = null;
export function isHelmActive() { return !!_helm; }
// The server streams the live sim sky (real weather field) while the helm is open, and confirms an
// arrival at the end of a passage — both routed here by dispatch.
export function helmSetSky(sky) { _helm?.ctrl?.setSky(sky); }
export function helmSetWorld(rows, cx, cy) { _helm?.ctrl?.setWorld(rows, cx, cy); }
export function helmEndTransit(gx, gy) { _helm?.ctrl?.endTransit(gx, gy); }

export function ensureHelmStyles() {
  if (document.getElementById('helm-mode-styles')) return;
  const s = document.createElement('style'); s.id = 'helm-mode-styles';
  s.textContent = `
    .helm-root{ position:relative; width:100%; height:clamp(440px,78vh,940px); overflow:hidden;
      --accent:#c8a24e; --accent-hi:#ecd48f; --accent-lo:#8c6f34; --chart:#4fd0e0;
      --hpanel:#0e141b; --hink:#e2edf3; --hdim:#8ba0ae; --stbd:#35d07a; --brass:#b9923f;
      --hmono:'DejaVu Sans Mono','Consolas','Courier New',monospace; --hsans:'Helvetica Neue',Arial,system-ui,sans-serif;
      --hcarbon:repeating-linear-gradient(45deg,#12161b 0 3px,#0d1116 3px 6px),repeating-linear-gradient(-45deg,rgba(44,52,61,.5) 0 3px,transparent 3px 6px);
      font-family:var(--hsans); color:var(--hink); border-radius:8px; background:#04070c; }
    /* Full-screen on launch: a maximized overlay taking over the whole client (reliable, no OS
       fullscreen gesture needed). The ⛶ chip still toggles true OS fullscreen on top of this. */
    .helm-root.max{ position:fixed; inset:0; width:100vw; height:100vh; border-radius:0; z-index:1400; }
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
    /* The console: a brass-railed glass dash across the bottom, wheel centred, instruments left,
       engine telegraph right — a bridge helm station, not just a floating wheel. */
    .helm-dash{ position:absolute; left:0; right:0; bottom:0; z-index:5; display:grid; grid-template-columns:1fr auto 1fr; align-items:end; gap:18px;
      padding:20px 22px calc(16px + env(safe-area-inset-bottom));
      background:linear-gradient(180deg,rgba(6,10,14,0) 0%,rgba(6,10,14,.74) 30%,rgba(3,6,9,.95) 100%);
      border-top:2px solid transparent;
      border-image:linear-gradient(90deg,transparent,var(--brass) 18%,var(--accent-hi) 50%,var(--brass) 82%,transparent) 1;
      box-shadow:inset 0 2px 0 rgba(0,0,0,.6); }
    .helm-tel{ display:flex; gap:10px; flex-wrap:wrap; }
    .helm-cell{ min-width:76px; padding:7px 12px; border-radius:9px; background:var(--hcarbon),var(--hpanel);
      border:1px solid color-mix(in srgb,var(--accent) 20%,transparent); box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -3px 6px rgba(0,0,0,.5); }
    .helm-cell .k{ font-family:var(--hmono); font-size:9px; letter-spacing:2px; color:var(--hdim); text-transform:uppercase; }
    .helm-cell .v{ font-family:var(--hmono); font-size:17px; font-weight:700; letter-spacing:.5px; color:var(--hink); font-variant-numeric:tabular-nums; }
    .helm-cell .v small{ font-size:10px; color:var(--hdim); font-weight:400; }
    .helm-cell.st .v{ color:var(--hdim); } .helm-cell.st.busy .v{ color:var(--stbd); }
    .helm-cell.eta .v{ color:var(--accent-hi); } .helm-cell.eta.idle .v{ color:var(--hdim); }
    .helm-col{ display:flex; flex-direction:column; align-items:center; gap:6px; }
    .helm-wheel{ width:248px; height:248px; filter:drop-shadow(0 10px 24px rgba(0,0,0,.7)); }
    .helm-col .cap{ font-family:var(--hmono); font-size:9px; letter-spacing:3px; color:var(--hdim); text-transform:uppercase; }
    /* Engine telegraph — a brass-housed lever in a slot. Drag the handle up to AHEAD to engage;
       it pins there for the passage and springs back to STOP on arrival. */
    .helm-right{ display:flex; flex-direction:column; align-items:flex-end; }
    .helm-tele{ display:flex; flex-direction:column; align-items:center; gap:7px; user-select:none; }
    .helm-tele-track{ position:relative; width:64px; height:150px; border-radius:12px;
      background:linear-gradient(180deg,#161b22,#080b10); border:1px solid color-mix(in srgb,var(--brass) 55%,#000);
      box-shadow:inset 0 2px 8px rgba(0,0,0,.7),0 1px 0 rgba(255,255,255,.06); overflow:hidden; }
    .helm-tele-track::before{ content:''; position:absolute; left:50%; top:14px; bottom:14px; width:6px; transform:translateX(-50%);
      border-radius:4px; background:linear-gradient(180deg,#05070a,#12161c); box-shadow:inset 0 0 4px rgba(0,0,0,.9); }
    .helm-tele-mark{ position:absolute; left:0; right:0; text-align:center; font-family:var(--hmono); font-size:9px; letter-spacing:2px; color:var(--hdim); pointer-events:none; }
    .helm-tele-mark.ahead{ top:7px; color:var(--stbd); } .helm-tele-mark.stop{ bottom:7px; }
    .helm-tele-knob{ position:absolute; left:8px; right:8px; height:34px; top:92px; border-radius:8px; cursor:grab; touch-action:none;
      background:linear-gradient(180deg,var(--accent-hi),var(--accent),var(--accent-lo));
      border:1px solid #2a1f08; box-shadow:0 3px 7px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.55); }
    .helm-tele-knob::after{ content:''; position:absolute; left:6px; right:6px; top:50%; height:6px; transform:translateY(-50%);
      background:repeating-linear-gradient(90deg,rgba(0,0,0,.35) 0 2px,transparent 2px 4px); border-radius:2px; }
    .helm-tele-knob:active{ cursor:grabbing; }
    .helm-tele.engaged .helm-tele-knob{ cursor:not-allowed; box-shadow:0 0 12px var(--stbd),0 3px 7px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.55); }
    .helm-tele.engaged .helm-tele-track{ border-color:var(--stbd); }
    .helm-tele-label{ font-family:var(--hmono); font-size:9px; letter-spacing:3px; color:var(--hdim); text-transform:uppercase; }
    .helm-tele.warn .helm-tele-label{ color:#ff8a7a; }
    @media (max-width:760px){ .helm-dash{ grid-template-columns:1fr auto; grid-template-rows:auto auto; gap:12px; align-items:center; }
      .helm-tel{ order:3; grid-column:1 / -1; justify-content:center; } .helm-col{ order:1; } .helm-right{ order:2; align-items:center; }
      .helm-wheel{ width:184px; height:184px; } .helm-tele-track{ height:120px; } .helm-tele-knob{ top:70px; } }`;
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
  const accent = opts.accent || (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c8a24e');
  const onSail = opts.onSail || (() => {});
  const onExit = opts.onExit || (() => {});

  mount.innerHTML = `
    <div class="helm-root max">
      <div class="helm-chase"></div>
      <div class="helm-placard"><span class="m"></span><span class="n">ECHELON&nbsp; <small>HELM</small></span></div>
      <div class="helm-chips">
        <span class="helm-chip"><b data-wx>CLEAR</b></span>
        <span class="helm-chip"><b data-time>--:--</b></span>
        <button class="helm-icon" data-fs title="fullscreen">⛶</button>
        <button class="helm-icon exit" data-exit title="leave the helm">✕</button>
      </div>
      <div class="helm-dash">
        <div class="helm-tel">
          <div class="helm-cell"><span class="k">Heading</span><span class="v" data-hdg>N</span></div>
          <div class="helm-cell"><span class="k">Position</span><span class="v" data-pos style="font-size:14px">—</span></div>
          <div class="helm-cell"><span class="k">Speed</span><span class="v"><span data-kn>0.0</span><small> kn</small></span></div>
          <div class="helm-cell eta idle"><span class="k">ETA</span><span class="v" data-eta>—</span></div>
          <div class="helm-cell st"><span class="k">Status</span><span class="v" data-status>MOORED</span></div>
        </div>
        <div class="helm-col">
          <canvas class="helm-wheel"></canvas>
          <div class="cap">Course</div>
        </div>
        <div class="helm-right">
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
    </div>`;

  const root = mount.querySelector('.helm-root');
  const q = (s) => root.querySelector(s);

  const ctrl = openHelmChase(q('.helm-chase'), {
    gx: opts.gx ?? 0, gy: opts.gy ?? 0, heading: opts.heading ?? 0, sky: opts.sky,
    onArrive: (gx, gy) => { q('[data-pos]').textContent = gx + ',' + gy; },
  });
  if (opts.sky) ctrl.setSky(opts.sky);   // seed the real sim weather field immediately
  if (opts.map) ctrl.setWorld(opts.map, opts.gx, opts.gy);   // frame her against the REAL basin, not blank ocean

  // The wheel is a DIRECT course selector: its (heavily geared) rotation demands a course and she
  // swings slowly toward it; the hub needle reads her actual heading as she comes round.
  const wheel = createHelmWheel(q('.helm-wheel'), { accent, gear: 8, onCourse: (deg) => ctrl.setCourse(deg), getHeading: () => ctrl.heading() });

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

  q('[data-fs]').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen?.().catch(() => {}); });
  q('[data-exit]').addEventListener('click', () => { closeHelm(); onExit(); });

  // Keyboard: Esc exits. (Course is the wheel; the throttle is the telegraph — both are grab-and-drag.)
  const keyH = (e) => { if (e.key === 'Escape') { closeHelm(); onExit(); } };
  addEventListener('keydown', keyH);

  // Restore an in-progress passage (helm opened mid-transit): lock + run out the remaining time.
  if (opts.transitMs > 0) { ctrl.beginTransit(HDG_TO_DIR[((Math.round(opts.heading || 0) % 360) + 360) % 360] || 'N', opts.transitMs); setUnderway(true); }

  // Live readouts (heading eases + the passage runs on a timer, so poll). The telegraph/wheel lock
  // tracks her actual under-way state, so a server-driven begin/arrive keeps the console in sync.
  let wasSailing = engaged;
  const poll = setInterval(() => {
    const h = ((Math.round(ctrl.heading()) % 360) + 360) % 360;
    q('[data-hdg]').textContent = CARD[h] ?? (h + '°');
    q('[data-kn]').textContent = (ctrl.speed() * 20).toFixed(1);
    const sailing = ctrl.isSailing();
    if (sailing !== wasSailing) { setUnderway(sailing); wasSailing = sailing; }
    const left = ctrl.transitLeft();
    q('[data-eta]').textContent = left > 0 ? fmtETA(left) : '—';
    q('.helm-cell.eta').classList.toggle('idle', left <= 0);
    const busy = ctrl.isBusy();
    q('[data-status]').textContent = sailing ? 'MAKING WAY' : (busy ? 'COMING ABOUT' : 'MOORED');
    q('.helm-cell.st').classList.toggle('busy', busy);
    const env = ctrl.env?.();   // live world time/weather for the chips
    if (env) { q('[data-time]').textContent = env.time; q('[data-wx]').textContent = (env.weather || 'clear').toUpperCase(); }
  }, 100);

  _helm = { mount, ctrl, wheel, poll, upH, keyH, teleMove, teleUp };
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
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  try { h.wheel?.destroy(); } catch {}
  try { h.ctrl?.destroy(); } catch {}
  if (h.mount) h.mount.innerHTML = '';
}
