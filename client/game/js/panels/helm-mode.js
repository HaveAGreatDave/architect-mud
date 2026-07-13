// Echelon Helm mode — the in-game console. Takes over the area pane exactly like the flight sim
// (openFlightSim): a full chase view with a glass dash (wheel + telemetry) floated over it, a
// fullscreen toggle, and a clean EXIT that hands the pane back to the room. Dependency-free —
// the game passes callbacks (onSail/onExit) so this module never imports net/dispatch, and the
// standalone rig can drive it too.
//
// openHelm({ mount, gx, gy, heading, accent, onSail(dir), onExit() }) → controller
// isHelmActive() — dispatch guards room `look`/`move` renders on this so descriptions never
//   clobber the console (mirrors isFlightSimActive()).

import { openHelmChase } from './helm-view.js';
import { createHelmWheel } from './helm-wheel.js';

let _helm = null;
export function isHelmActive() { return !!_helm; }

export function ensureHelmStyles() {
  if (document.getElementById('helm-mode-styles')) return;
  const s = document.createElement('style'); s.id = 'helm-mode-styles';
  s.textContent = `
    .helm-root{ position:relative; width:100%; height:clamp(440px,78vh,940px); overflow:hidden;
      --accent:#c8a24e; --accent-hi:#ecd48f; --accent-lo:#8c6f34; --chart:#4fd0e0;
      --hpanel:#0e141b; --hink:#e2edf3; --hdim:#8ba0ae; --stbd:#35d07a;
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
    .helm-dash{ position:absolute; left:0; right:0; bottom:0; z-index:5; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:18px;
      padding:14px 22px calc(14px + env(safe-area-inset-bottom));
      background:linear-gradient(180deg,rgba(6,10,14,0) 0%,rgba(6,10,14,.72) 32%,rgba(4,7,10,.92) 100%); }
    .helm-tel{ display:flex; gap:10px; flex-wrap:wrap; }
    .helm-cell{ min-width:76px; padding:7px 12px; border-radius:9px; background:var(--hcarbon),var(--hpanel);
      border:1px solid color-mix(in srgb,var(--accent) 20%,transparent); box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -3px 6px rgba(0,0,0,.5); }
    .helm-cell .k{ font-family:var(--hmono); font-size:9px; letter-spacing:2px; color:var(--hdim); text-transform:uppercase; }
    .helm-cell .v{ font-family:var(--hmono); font-size:17px; font-weight:700; letter-spacing:.5px; color:var(--hink); font-variant-numeric:tabular-nums; }
    .helm-cell .v small{ font-size:10px; color:var(--hdim); font-weight:400; }
    .helm-cell.st .v{ color:var(--hdim); } .helm-cell.st.busy .v{ color:var(--stbd); }
    .helm-col{ display:flex; flex-direction:column; align-items:center; gap:8px; }
    .helm-wheel{ width:248px; height:248px; filter:drop-shadow(0 10px 24px rgba(0,0,0,.7)); }
    .helm-ahead{ font-family:var(--hmono); letter-spacing:3px; font-weight:700; font-size:13px; color:#062018; padding:9px 26px; border-radius:9px; cursor:pointer;
      border:1px solid var(--stbd); background:linear-gradient(180deg,#6bf0b0,#2fae74); box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 3px 8px rgba(0,0,0,.5); }
    .helm-ahead:hover{ filter:brightness(1.08); } .helm-ahead:active{ transform:translateY(1px); }
    .helm-ahead:disabled{ opacity:.4; cursor:not-allowed; filter:grayscale(.5); }
    .helm-right{ display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
    .helm-row{ display:flex; gap:8px; align-items:center; font-family:var(--hmono); font-size:11px; color:var(--hdim); letter-spacing:1px; }
    .helm-row select{ background:var(--hpanel); border:1px solid color-mix(in srgb,var(--accent) 26%,transparent); color:var(--chart); border-radius:7px; padding:6px 8px; font-family:var(--hmono); font-size:11px; }
    .helm-row input[type=range]{ width:104px; accent-color:var(--accent); }
    @media (max-width:760px){ .helm-dash{ grid-template-columns:1fr; justify-items:center; gap:10px; } .helm-tel{ order:2; justify-content:center; } .helm-col{ order:1; } .helm-right{ order:3; align-items:center; } .helm-wheel{ width:184px; height:184px; } }`;
  document.head.appendChild(s);
}

const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export function openHelm(opts = {}) {
  const mount = opts.mount || document.getElementById('area-content');
  if (!mount) return null;
  closeHelm();
  ensureHelmStyles();
  const accent = opts.accent || (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c8a24e');
  const onSail = opts.onSail || (() => {});
  const onExit = opts.onExit || (() => {});

  mount.innerHTML = `
    <div class="helm-root">
      <div class="helm-chase"></div>
      <div class="helm-placard"><span class="m"></span><span class="n">ECHELON&nbsp; <small>HELM</small></span></div>
      <div class="helm-chips">
        <span class="helm-chip"><b data-wx>CLEAR</b></span>
        <span class="helm-chip"><b data-time>--:--</b></span>
        <button class="helm-icon" data-dn title="day / night">☾</button>
        <button class="helm-icon" data-fs title="fullscreen">⛶</button>
        <button class="helm-icon exit" data-exit title="leave the helm">✕</button>
      </div>
      <div class="helm-dash">
        <div class="helm-tel">
          <div class="helm-cell"><span class="k">Heading</span><span class="v" data-hdg>N</span></div>
          <div class="helm-cell"><span class="k">Position</span><span class="v" data-pos style="font-size:14px">—</span></div>
          <div class="helm-cell"><span class="k">Speed</span><span class="v"><span data-kn>0.0</span><small> kn</small></span></div>
          <div class="helm-cell st"><span class="k">Status</span><span class="v" data-status>MOORED</span></div>
        </div>
        <div class="helm-col">
          <canvas class="helm-wheel"></canvas>
          <button class="helm-ahead" data-ahead title="make way one tile (space)">AHEAD</button>
        </div>
        <div class="helm-right">
          <div class="helm-row"><span>WX</span>
            <select data-wxsel>
              <option value="clear">clear</option><option value="cloudy">cloudy</option><option value="overcast">overcast</option>
              <option value="rain">rain</option><option value="storm">storm</option><option value="fog">fog</option><option value="snow">snow</option>
            </select>
          </div>
          <label class="helm-row">Pitch <input data-pitch type="range" min="0.05" max="0.9" step="0.01" value="0.34"></label>
          <label class="helm-row">Zoom <input data-zoom type="range" min="0.6" max="2.4" step="0.05" value="1.7"></label>
        </div>
      </div>
    </div>`;

  const root = mount.querySelector('.helm-root');
  const q = (s) => root.querySelector(s);

  const ctrl = openHelmChase(q('.helm-chase'), {
    gx: opts.gx ?? 0, gy: opts.gy ?? 0, heading: opts.heading ?? 0, hour: opts.hour, weather: opts.weather,
    onArrive: (gx, gy) => { q('[data-pos]').textContent = gx + ',' + gy; },
  });
  // The wheel is a DIRECT course selector: its (heavily geared) rotation demands a course and she
  // swings slowly toward it; the hub needle reads her actual heading as she comes round.
  const wheel = createHelmWheel(q('.helm-wheel'), { accent, gear: 8, onCourse: (deg) => ctrl.setCourse(deg), getHeading: () => ctrl.heading() });

  // AHEAD → local surge + fire the real sail command in game.
  q('[data-ahead]').addEventListener('click', () => { const dir = ctrl.ahead(); if (dir) onSail(dir); });
  // Orbit / zoom on the sea — the chase cam stays fixed on the boat and arcs around it.
  const sea = q('.helm-chase'); let drag = false, lx = 0, ly = 0;
  sea.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; sea.setPointerCapture?.(e.pointerId); });
  sea.addEventListener('pointermove', (e) => { if (!drag) return; ctrl.orbit((e.clientX - lx) * 0.4, -(e.clientY - ly) * 0.006); lx = e.clientX; ly = e.clientY; });
  const upH = () => { drag = false; }; addEventListener('pointerup', upH);
  sea.addEventListener('wheel', (e) => { e.preventDefault(); ctrl.zoom(e.deltaY > 0 ? 0.08 : -0.08); }, { passive: false });

  q('[data-wxsel]').addEventListener('change', (e) => { ctrl.setWeather(e.target.value); q('[data-wx]').textContent = e.target.value.toUpperCase(); });
  let night = false;
  q('[data-dn]').addEventListener('click', (e) => { night = !night; e.target.classList.toggle('on', night); e.target.textContent = night ? '☀' : '☾'; ctrl.setHour(night ? 1 : 14); });
  q('[data-fs]').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen?.(); });
  q('[data-pitch]').addEventListener('input', () => ctrl.setTrim(+q('[data-pitch]').value, +q('[data-zoom]').value));
  q('[data-zoom]').addEventListener('input', () => ctrl.setTrim(+q('[data-pitch]').value, +q('[data-zoom]').value));
  q('[data-exit]').addEventListener('click', () => { closeHelm(); onExit(); });

  // Keyboard: space AHEAD, Esc exits. (Course is the wheel's job — grab and spin it.)
  const keyH = (e) => {
    if (e.key === ' ') { e.preventDefault(); const d = ctrl.ahead(); if (d) onSail(d); }
    else if (e.key === 'Escape') { closeHelm(); onExit(); }
  };
  addEventListener('keydown', keyH);

  // Live readouts (heading eases, so poll).
  const poll = setInterval(() => {
    const h = ((Math.round(ctrl.heading()) % 360) + 360) % 360;
    q('[data-hdg]').textContent = CARD[h] ?? (h + '°');
    const busy = ctrl.isBusy();
    q('[data-status]').textContent = ctrl.isSailing() ? 'MAKING WAY' : (busy ? 'COMING ABOUT' : 'MOORED');
    q('.helm-cell.st').classList.toggle('busy', busy);
    q('[data-ahead]').disabled = busy;   // make way only once she's settled on a heading
    const env = ctrl.env?.();   // optional live env for the chips
    if (env) { q('[data-time]').textContent = env.time; q('[data-wx]').textContent = (env.weather || 'clear').toUpperCase(); }
  }, 100);

  _helm = { mount, ctrl, wheel, poll, upH, keyH };
  return { ctrl, wheel, close: () => { closeHelm(); onExit(); }, setPosition: (gx, gy) => ctrl.setPosition(gx, gy), setHeading: (h) => ctrl.setHeading(h) };
}

export function closeHelm() {
  if (!_helm) return;
  const h = _helm; _helm = null;
  clearInterval(h.poll);
  removeEventListener('pointerup', h.upH);
  removeEventListener('keydown', h.keyH);
  try { h.wheel?.destroy(); } catch {}
  try { h.ctrl?.destroy(); } catch {}
  if (h.mount) h.mount.innerHTML = '';
}
