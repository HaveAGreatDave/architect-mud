// SPECTER firmware flasher — the install animation for the SPECTER Firmware Drive
// (item tagged `specter_program`). `use` it and the server sets the install flag +
// burns the item, then pushes a `specter_install` message; this overlay plays the
// cosmetic flash: a cyberpunk USB drive slides into the tablet's data port, the
// screen boots into a hackery firmware flasher, blocks are erased/written/verified
// on a scrolling log + progress bar, and SPECTER lands. Purely client-side — the
// install already happened server-side, so closing early (Esc / click) is harmless.
import { mountOverlay } from './minigame-common.js';

let _live = null;   // { close } while an install is playing — guards against double-open

// Self-contained WebAudio blips (like datachipreplay.js's thunk) so the flasher has
// texture without depending on the SFX catalog.
let _ac = null;
function blip(freq = 220, dur = 0.09, type = 'square', gain = 0.05) {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(), g = _ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g); g.connect(_ac.destination);
    const t = _ac.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch { /* no audio — the flash still plays */ }
}

function ensureStyles() {
  if (document.getElementById('specter-install-styles')) return;
  const s = document.createElement('style');
  s.id = 'specter-install-styles';
  s.textContent = `
    #specter-install-overlay { position:fixed; inset:0; z-index:9400; display:flex; align-items:center; justify-content:center;
      background:radial-gradient(120% 120% at 50% 40%, rgba(6,20,14,0.86), rgba(0,0,0,0.94)); backdrop-filter:blur(2px); font-family:'Courier New', monospace; }
    #specter-install-overlay .si-tablet { position:relative; width:min(88vw, 560px); border-radius:20px; padding:16px;
      background:linear-gradient(160deg,#0b0f0d,#05070a); border:1px solid #04120c;
      box-shadow:inset 0 1px 0 rgba(120,255,190,0.08), 0 22px 60px rgba(0,0,0,0.75), 0 0 44px rgba(57,255,158,0.14); }
    /* Data port on the tablet's right edge; the drive docks into it. */
    #specter-install-overlay .si-port { position:absolute; right:-11px; top:50%; transform:translateY(-50%); width:16px; height:44px; border-radius:3px;
      background:linear-gradient(180deg,#05070a,#0d1013); box-shadow:inset 0 1px 3px rgba(0,0,0,0.85), 0 0 0 1px #020403; transition:box-shadow .3s; }
    #specter-install-overlay.docked .si-port { box-shadow:inset 0 1px 3px rgba(0,0,0,0.85), 0 0 0 1px #020403, 0 0 14px 2px #39ff9e; }
    /* Cyberpunk USB flash drive — starts off-screen right, slides into the port. */
    #specter-install-overlay .si-drive { position:absolute; right:-230px; top:50%; transform:translateY(-50%); display:flex; align-items:center;
      transition:right .9s cubic-bezier(.7,-0.2,.3,1.4); filter:drop-shadow(0 6px 12px rgba(0,0,0,0.6)); }
    #specter-install-overlay.docked .si-drive { right:-4px; }
    #specter-install-overlay .si-usb-conn { width:26px; height:15px; border-radius:2px; background:linear-gradient(180deg,#c9d4dc,#7d8892 60%,#4a525a);
      box-shadow:inset 0 1px 0 #eef3f7, inset 0 -2px 3px rgba(0,0,0,0.5); position:relative; }
    #specter-install-overlay .si-usb-conn::before { content:''; position:absolute; inset:3px 5px; border-radius:1px; background:repeating-linear-gradient(90deg,#2a2f34 0 3px, #454c53 3px 6px); }
    #specter-install-overlay .si-usb-body { width:78px; height:34px; border-radius:6px 8px 8px 6px; margin-left:-2px; position:relative;
      background:linear-gradient(155deg,#10201a,#0a1512 60%,#071009); border:1px solid #39ff9e;
      box-shadow:inset 0 0 12px rgba(57,255,158,0.35), 0 0 12px rgba(57,255,158,0.4); }
    #specter-install-overlay .si-usb-body::after { content:'SPECTER'; position:absolute; left:9px; top:50%; transform:translateY(-50%);
      font-size:8px; letter-spacing:1.5px; color:#8affc9; text-shadow:0 0 6px rgba(57,255,158,0.8); }
    /* Neon side stripe + a blinking activity LED. */
    #specter-install-overlay .si-usb-body .si-stripe { position:absolute; right:8px; top:5px; bottom:5px; width:3px; border-radius:2px;
      background:linear-gradient(180deg,#39ff9e,#12ffd6); box-shadow:0 0 8px #39ff9e; }
    #specter-install-overlay .si-usb-led { position:absolute; right:15px; top:50%; transform:translateY(-50%); width:5px; height:5px; border-radius:50%; background:#0a3; }
    #specter-install-overlay.docked .si-usb-led { background:#8affc9; box-shadow:0 0 8px #39ff9e; animation:si-led 0.5s steps(1) infinite; }
    @keyframes si-led { 0%,50%{opacity:1} 51%,100%{opacity:.25} }

    /* The tablet screen — dark until the drive docks, then the flasher boots. */
    #specter-install-overlay .si-screen { position:relative; height:300px; border-radius:12px; overflow:hidden; padding:14px 15px;
      background:#03070a; box-shadow:inset 0 0 34px rgba(0,0,0,0.9), inset 0 0 8px rgba(57,255,158,0.14);
      color:#39ff9e; text-shadow:0 0 5px rgba(57,255,158,0.45); opacity:0.12; transition:opacity .35s; }
    #specter-install-overlay.booted .si-screen { opacity:1; }
    #specter-install-overlay .si-screen::after { content:''; position:absolute; inset:0; pointer-events:none;
      background:repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.22) 2px 3px); }
    #specter-install-overlay .si-boot-glitch { animation:si-glitch .18s steps(2) 3; }
    @keyframes si-glitch { 0%{transform:translate(0,0)} 25%{transform:translate(-2px,1px)} 50%{transform:translate(2px,-1px)} 75%{transform:translate(-1px,0)} 100%{transform:translate(0,0)} }
    #specter-install-overlay .si-hdr { display:flex; justify-content:space-between; align-items:baseline; font-size:11px; letter-spacing:2px; text-transform:uppercase;
      border-bottom:1px solid rgba(57,255,158,0.28); padding-bottom:6px; margin-bottom:8px; }
    #specter-install-overlay .si-hdr b { font-size:13px; }
    #specter-install-overlay .si-hdr .si-ver { color:#8affc9; opacity:0.75; letter-spacing:1px; }
    #specter-install-overlay .si-log { height:150px; overflow:hidden; font-size:11px; line-height:1.42; white-space:pre-wrap; }
    #specter-install-overlay .si-log .warn { color:#ffd85a; text-shadow:0 0 5px rgba(255,216,90,0.4); }
    #specter-install-overlay .si-log .crit { color:#ff6b7a; text-shadow:0 0 5px rgba(255,107,122,0.4); }
    #specter-install-overlay .si-log .ok { color:#8affc9; }
    #specter-install-overlay .si-stage { margin-top:10px; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#8affc9; min-height:13px; }
    #specter-install-overlay .si-barwrap { margin-top:6px; height:14px; border:1px solid rgba(57,255,158,0.4); border-radius:3px; background:#02110b; overflow:hidden; }
    #specter-install-overlay .si-bar { height:100%; width:0%; background:linear-gradient(90deg,#12ffd6,#39ff9e); box-shadow:0 0 12px rgba(57,255,158,0.7);
      transition:width .18s linear; background-size:22px 100%; background-image:linear-gradient(90deg,#12ffd6,#39ff9e), repeating-linear-gradient(90deg, rgba(0,0,0,0.18) 0 6px, transparent 6px 12px); }
    #specter-install-overlay .si-pct { text-align:right; font-size:10px; margin-top:3px; letter-spacing:1px; color:#8affc9; }
    /* Completion stamp + open-tablet hint. */
    #specter-install-overlay .si-done { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
      background:radial-gradient(80% 80% at 50% 45%, rgba(4,26,18,0.92), rgba(2,8,6,0.97)); opacity:0; pointer-events:none; transition:opacity .4s; }
    #specter-install-overlay.done .si-done { opacity:1; pointer-events:auto; }
    #specter-install-overlay .si-done .si-check { font-size:40px; color:#39ff9e; text-shadow:0 0 18px rgba(57,255,158,0.8); animation:si-pop .5s cubic-bezier(.2,1.4,.4,1); }
    @keyframes si-pop { 0%{transform:scale(0.3);opacity:0} 100%{transform:scale(1);opacity:1} }
    #specter-install-overlay .si-done .si-title { font-size:16px; letter-spacing:3px; color:#8affc9; text-shadow:0 0 10px rgba(57,255,158,0.6); }
    #specter-install-overlay .si-done .si-sub { font-size:11px; letter-spacing:1px; color:#7fbfa2; }
    #specter-install-overlay .si-done .si-close { margin-top:6px; cursor:pointer; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#03110b;
      background:#39ff9e; border:none; border-radius:4px; padding:8px 18px; box-shadow:0 0 14px rgba(57,255,158,0.6); }
    #specter-install-overlay .si-done .si-close:hover { filter:brightness(1.12); }
    #specter-install-overlay .si-skip { position:absolute; bottom:9px; right:14px; font-size:9px; letter-spacing:1px; color:#3c5a4c; }
  `;
  document.head.appendChild(s);
}

// Boot/flash log lines, streamed in as the bar fills. A little fake-scary flavour
// (bypassing the tablet's signature check) keeps it hackery without real stakes.
const LOG_LINES = [
  { t: '> mounting /dev/usb0 … SPECTER FIRMWARE DRIVE', c: '' },
  { t: '> handshake … vendor:GHOST  sig:0x9F3A-BADC0DE', c: '' },
  { t: '> bypassing tablet signature check', c: 'warn' },
  { t: '  [OK] bootloader unlocked', c: 'ok' },
  { t: '> erasing partition tos.specter …', c: '' },
  { t: '  wiping blocks 0x0000 … 0x7FFF', c: '' },
  { t: '> writing firmware image (SPECTER-6.rom)', c: '' },
  { t: '  ####################  hash verify … PASS', c: 'ok' },
  { t: '> patching Tablet OS app registry', c: '' },
  { t: '  + specter.app  + hooks:surveillance', c: '' },
  { t: '> injecting counter-forensics stub', c: 'warn' },
  { t: '  scrubbing install trace …', c: '' },
  { t: '> sealing firmware … reboot daemon', c: '' },
  { t: '  [OK] SPECTER online', c: 'ok' },
];

const STAGES = ['ERASING', 'WRITING BLOCKS', 'VERIFYING', 'PATCHING TABLET OS', 'FINALIZING'];

export function openSpecterInstall(msg) {
  if (_live) return;            // already flashing
  ensureStyles();

  const html = `
    <div class="si-tablet">
      <div class="si-port"></div>
      <div class="si-drive">
        <div class="si-usb-body"><span class="si-stripe"></span><span class="si-usb-led"></span></div>
        <div class="si-usb-conn"></div>
      </div>
      <div class="si-screen">
        <div class="si-hdr"><b>SPECTER FLASHER</b><span class="si-ver">fw 6.0 · ${(msg && msg.item) ? String(msg.item).replace(/[<>&]/g, '') : 'FIRMWARE DRIVE'}</span></div>
        <div class="si-log" id="si-log"></div>
        <div class="si-stage" id="si-stage">AWAITING MEDIA…</div>
        <div class="si-barwrap"><div class="si-bar" id="si-bar"></div></div>
        <div class="si-pct" id="si-pct">0%</div>
        <div class="si-skip">esc / click to skip</div>
        <div class="si-done">
          <div class="si-check">✓</div>
          <div class="si-title">SPECTER INSTALLED</div>
          <div class="si-sub">Open your tablet → Surveillance</div>
          <button class="si-close">Done</button>
        </div>
      </div>
    </div>`;

  const timers = [];
  const after = (ms, fn) => timers.push(setTimeout(fn, ms));

  const { overlay, close } = mountOverlay({
    id: 'specter-install-overlay',
    html,
    onClose: () => { timers.forEach(clearTimeout); _live = null; },
  });
  _live = { close };

  const logEl = overlay.querySelector('#si-log');
  const barEl = overlay.querySelector('#si-bar');
  const pctEl = overlay.querySelector('#si-pct');
  const stageEl = overlay.querySelector('#si-stage');
  overlay.querySelector('.si-close')?.addEventListener('click', close);

  // 1) Drive slides into the port.
  after(60, () => { overlay.classList.add('docked'); blip(120, 0.05, 'sawtooth'); });
  after(950, () => { blip(70, 0.16, 'square', 0.08); });               // dock CLUNK

  // 2) Screen boots (flicker + glitch).
  after(1150, () => {
    overlay.classList.add('booted');
    overlay.querySelector('.si-screen')?.classList.add('si-boot-glitch');
    blip(880, 0.06); after(90, () => blip(1320, 0.05));
  });

  // 3) Stream the flash log + fill the bar over ~3.4s.
  const flashStart = 1500;
  const flashDur = 3400;
  LOG_LINES.forEach((ln, i) => {
    after(flashStart + Math.round((i / LOG_LINES.length) * flashDur), () => {
      const div = document.createElement('div');
      if (ln.c) div.className = ln.c;
      div.textContent = ln.t;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
      blip(260 + i * 24, 0.03, 'square', 0.03);
    });
  });

  const steps = 46;
  for (let i = 0; i <= steps; i++) {
    after(flashStart + Math.round((i / steps) * flashDur), () => {
      const pct = Math.round((i / steps) * 100);
      barEl.style.width = pct + '%';
      pctEl.textContent = pct + '%';
      stageEl.textContent = STAGES[Math.min(STAGES.length - 1, Math.floor((i / steps) * STAGES.length))];
    });
  }

  // 4) Done stamp + a longer auto-close backstop (the player can also hit Done/Esc).
  after(flashStart + flashDur + 250, () => {
    overlay.classList.add('done');
    blip(520, 0.09); after(80, () => blip(780, 0.11)); after(200, () => blip(1040, 0.14));
  });
  after(flashStart + flashDur + 6000, () => close());
}
