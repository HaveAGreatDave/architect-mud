// Device inspection overlay — grungy industrial cyberpunk readout that pops
// when you `examine` a generator or junction box. Driven by a
// `device_inspect_panel` message from the server (state = live). The generator
// is a roaring turbine face; the junction box is a smaller, tidier breaker
// cabinet. Both carry a (currently inert) locked hacking port.
//
// The panel is interactive: ATTACK / REPAIR act on the device without closing
// out to the command line, and RESCAN re-runs the examine so the readout tracks
// the device's live state (integrity, power) after you hit it.

import { sendCmd, sendCmdSilent } from '../net.js';

let _overlay = null;
let _keyHandler = null;
let _lastMsg = null;

function ensureStyles() {
  if (document.getElementById('device-inspect-styles')) return;
  const s = document.createElement('style');
  s.id = 'device-inspect-styles';
  s.textContent = `
    #device-inspect-overlay { position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.72); backdrop-filter:blur(2px); font-family:'Courier New',monospace; }
    #device-inspect-overlay .di-panel { position:relative; width:min(720px,94vw); }
    #device-inspect-overlay .di-frame { animation:di-boot .28s ease-out; }
    @keyframes di-boot { 0%{opacity:0; transform:scale(.985)} 100%{opacity:1; transform:scale(1)} }
    #device-inspect-overlay .di-close { position:absolute; top:8px; right:8px; z-index:3; width:26px; height:26px;
      background:#12171b; color:#8fb0bb; border:1px solid #3a464e; border-radius:2px; cursor:pointer; font-size:13px; }
    #device-inspect-overlay .di-close:hover { color:#ff4a5b; border-color:#ff4a5b; }
    @keyframes di-blinkA { 0%,100%{opacity:1} 45%{opacity:.15} }
    @keyframes di-blinkB { 0%{opacity:.3} 50%{opacity:1} 100%{opacity:.3} }
    @keyframes di-blinkC { 0%,100%{opacity:.2} 20%{opacity:1} 60%{opacity:.4} }
    @keyframes di-flick  { 0%,100%{opacity:1} 92%{opacity:1} 94%{opacity:.35} 96%{opacity:1} }
    @keyframes di-scan   { 0%{transform:translateY(0)} 100%{transform:translateY(430px)} }
    @keyframes di-danger { 0%,100%{opacity:0} 50%{opacity:.5} }
    #device-inspect-overlay .led-a{animation:di-blinkA 1.3s infinite}
    #device-inspect-overlay .led-b{animation:di-blinkB .9s infinite}
    #device-inspect-overlay .led-c{animation:di-blinkC 2.1s infinite}
    #device-inspect-overlay .di-flick{animation:di-flick 3s infinite}
    #device-inspect-overlay .di-scanbar{animation:di-scan 5.5s linear infinite}
    #device-inspect-overlay .di-danger{animation:di-danger 1s infinite}
    /* Action bar — grungy console keys, bolted under the readout. */
    #device-inspect-overlay .di-actions { display:flex; gap:8px; margin-top:8px; }
    #device-inspect-overlay .di-btn { flex:1; padding:9px 6px; background:#12171b; color:#8fb0bb;
      border:1px solid #3a464e; border-radius:2px; cursor:pointer; font-family:'Courier New',monospace;
      font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; transition:all .12s;
      box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); }
    #device-inspect-overlay .di-btn:hover { transform:translateY(1px); box-shadow:inset 0 -1px 0 rgba(0,0,0,0.5); }
    #device-inspect-overlay .di-btn-attack { color:#ff6a78; border-color:#5a2a30; }
    #device-inspect-overlay .di-btn-attack:hover { color:#fff; background:#3a0f14; border-color:#ff4a5b; box-shadow:inset 0 -1px 0 rgba(0,0,0,0.5),0 0 12px rgba(255,74,91,0.4); }
    #device-inspect-overlay .di-btn-repair { color:#46e05a; border-color:#245a2c; }
    #device-inspect-overlay .di-btn-repair:hover { color:#0b1a0d; background:#46e05a; border-color:#46e05a; box-shadow:inset 0 -1px 0 rgba(0,0,0,0.5),0 0 12px rgba(70,224,90,0.4); }
    #device-inspect-overlay .di-btn-rescan { color:#37f5db; border-color:#1d4a48; flex:0 0 auto; padding-left:14px; padding-right:14px; }
    #device-inspect-overlay .di-btn-rescan:hover { color:#04110f; background:#37f5db; border-color:#37f5db; }
  `;
  document.head.appendChild(s);
}

function close() {
  if (_keyHandler) { window.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _lastMsg = null;
}

function actionBar(msg) {
  const { dead } = stateBits(msg);
  const attack = `<button class="di-btn di-btn-attack" data-di-act="attack">⚔ Attack</button>`;
  const repair = dead ? `<button class="di-btn di-btn-repair" data-di-act="repair">⚙ Repair</button>` : '';
  const rescan = `<button class="di-btn di-btn-rescan" data-di-act="rescan" title="Re-scan device state">⟳</button>`;
  return `<div class="di-actions">${attack}${repair}${rescan}</div>`;
}

export function openDeviceInspectPanel(msg) {
  ensureStyles();
  const first = !_overlay;
  _lastMsg = msg;
  const svg = (msg.deviceType === 'junction_box') ? junctionSvg(msg) : generatorSvg(msg);
  const inner = `<div class="di-panel"><button class="di-close" title="Close">✕</button><div class="di-frame">${svg}</div>${actionBar(msg)}</div>`;

  // RESCAN re-runs `examine`, which re-sends this message — refresh in place
  // rather than tearing down and rebuilding the overlay (no flash, no scroll).
  if (!first && _overlay) {
    _overlay.innerHTML = inner;
    wireControls(_overlay, msg);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'device-inspect-overlay';
  overlay.innerHTML = inner;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  _keyHandler = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', _keyHandler);
  document.body.appendChild(overlay);
  _overlay = overlay;
  wireControls(overlay, msg);
}

function wireControls(overlay, msg) {
  overlay.querySelector('.di-close').addEventListener('click', close);
  overlay.querySelectorAll('[data-di-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-di-act');
      const name = String(msg.name || '').toLowerCase();
      if (act === 'rescan') { sendCmdSilent(`examine ${name}`); return; }
      if (act === 'attack') { sendCmd(`attack ${name}`); close(); return; }
      if (act === 'repair') { sendCmd(`repair ${name}`); close(); return; }
    });
  });
}

// Palette helpers by state.
function stateBits(msg) {
  const dead = !!msg.destroyed;
  const offline = dead || !msg.online;
  const pct = dead ? 0 : Math.max(0, Math.min(100, Math.round(msg.integrityPct ?? 0)));
  const barColor = pct > 60 ? '#46e05a' : pct > 25 ? '#ffb23e' : '#ff4a5b';
  const statusText = dead ? 'OFFLINE — WRECKED' : offline ? 'NO POWER' : 'ONLINE';
  const statusColor = dead ? '#ff4a5b' : offline ? '#ffb23e' : '#46e05a';
  const critical = !dead && pct <= 25;
  return { dead, offline, pct, barColor, statusText, statusColor, critical };
}
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const kw = (v) => (v == null ? '—' : `${Math.round(v)} kW`);

// Load meter (percentage of capacity actually drawn) — drives a bar + label.
function loadPct(msg) {
  const cap = msg.capacityKw, out = msg.outputKw;
  if (cap == null || out == null || cap <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - out / cap) * 100)));
}

function hackPort(x, y) {
  return `
  <g transform="translate(${x},${y})">
    <rect x="0" y="0" width="184" height="120" fill="#0a0d0f" stroke="#33403a" stroke-dasharray="6 4"/>
    <text x="12" y="22" fill="#5c6f79" font-size="12" letter-spacing="2">◄ HACK PORT ►</text>
    <g transform="translate(74,40)" stroke="#54666f" fill="#12171b" stroke-width="2">
      <path d="M8,18 v-8 a12,12 0 0 1 24,0 v8" fill="none"/><rect x="2" y="18" width="36" height="26" rx="3"/>
      <circle cx="20" cy="30" r="3.5" fill="#5c6f79" stroke="none"/><rect x="18.5" y="31" width="3" height="8" fill="#5c6f79" stroke="none"/>
    </g>
    <text x="92" y="102" fill="#ff4a5b" font-size="11" text-anchor="middle" opacity="0.8" class="di-flick">ACCESS DENIED</text>
    <text x="92" y="115" fill="#4a5a63" font-size="8" text-anchor="middle">PORT OFFLINE · NO INTERFACE</text>
  </g>`;
}

function scanlinesAndFrame(w, h) {
  return `
    <rect x="4" y="4" width="${w-8}" height="${h-8}" rx="7" fill="none" stroke="#000" stroke-width="1" opacity="0.6"/>
    <g class="di-scanbar"><rect x="4" width="${w-8}" height="24" fill="#37f5db" opacity="0.05"/></g>`;
}

// Reusable animated integrity bar that "boots" up to its value on open.
function integrityBar(x, y, w, pct, barColor) {
  const fill = Math.round((w - 4) * pct / 100);
  return `
    <rect x="${x}" y="${y+10}" width="${w}" height="14" fill="#0a0d0f" stroke="#2b353c"/>
    <rect x="${x+2}" y="${y+12}" height="10" fill="${barColor}" opacity="0.9">
      <animate attributeName="width" from="0" to="${fill}" dur="0.6s" fill="freeze"/>
    </rect>`;
}

function generatorSvg(msg) {
  const { dead, offline, pct, barColor, statusText, statusColor, critical } = stateBits(msg);
  const led = (x, cls, color) => `<circle cx="${x}" cy="8" r="6" fill="${dead ? '#2b353c' : color}" ${dead ? '' : `class="${cls}"`}/>`;
  const scope = dead
    ? `<polyline points="268,100 380,100" fill="none" stroke="#5c6f79" stroke-width="1.6"/>`
    : `<polyline points="268,100 282,72 296,120 310,60 324,110 338,84 352,132 366,70 380,100" fill="none" stroke="#37f5db" stroke-width="1.6">
        <animate attributeName="points" dur="1.1s" repeatCount="indefinite"
          values="268,100 282,72 296,120 310,60 324,110 338,84 352,132 366,70 380,100;268,92 282,128 296,64 310,116 324,80 338,124 352,70 366,118 380,92;268,100 282,72 296,120 310,60 324,110 338,84 352,132 366,70 380,100"/></polyline>`;
  const coreFill = dead ? '#1a1010' : 'url(#di-core)';
  const rpm  = offline ? '0'   : '3600';
  const temp = dead ? '—' : offline ? '120 °C' : '642 °C';
  const load = loadPct(msg);
  const loadColor = load == null ? '#5c6f79' : load > 85 ? '#ff4a5b' : load > 60 ? '#ffb23e' : '#46e05a';
  return `<svg viewBox="0 0 720 470" xmlns="http://www.w3.org/2000/svg" role="img" font-family="'Courier New',monospace">
    <title>${esc(msg.name)} inspection</title>
    <defs>
      <pattern id="di-haz" width="28" height="16" patternUnits="userSpaceOnUse"><rect width="28" height="16" fill="#0e0f0c"/><path d="M-8,16 L8,0 M6,16 L22,0 M20,16 L36,0" stroke="#ffb23e" stroke-width="7" opacity="0.85"/></pattern>
      <radialGradient id="di-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#8ffbec"/><stop offset="45%" stop-color="#23e0c8"/><stop offset="100%" stop-color="#0b3f39"/></radialGradient>
      <radialGradient id="di-glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#37f5db" stop-opacity="0.5"/><stop offset="100%" stop-color="#37f5db" stop-opacity="0"/></radialGradient>
      <linearGradient id="di-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#20272d"/><stop offset="100%" stop-color="#0d1013"/></linearGradient>
      <filter id="di-soft"><feGaussianBlur stdDeviation="2.4"/></filter>
    </defs>
    <rect x="4" y="4" width="712" height="462" rx="7" fill="url(#di-metal)" stroke="#3a464e" stroke-width="2"/>
    <ellipse cx="140" cy="420" rx="120" ry="34" fill="#000" opacity="0.28"/><ellipse cx="600" cy="70" rx="90" ry="26" fill="#000" opacity="0.22"/>
    <rect x="16" y="16" width="688" height="20" fill="url(#di-haz)" opacity="0.9"/>
    <rect x="16" y="40" width="688" height="30" fill="#12171b" stroke="#2b353c"/>
    <text x="28" y="61" fill="${dead ? '#ff4a5b' : '#37f5db'}" font-size="17" letter-spacing="2" font-weight="bold">${esc(msg.name).toUpperCase()}</text>
    <text x="690" y="60" fill="#6f8792" font-size="11" text-anchor="end">CLASS: CITY_PLANT</text>
    <g transform="translate(140,210)">
      ${dead ? '' : '<circle r="96" fill="url(#di-glow)"><animate attributeName="r" values="88;104;88" dur="2.6s" repeatCount="indefinite"/></circle>'}
      <circle r="88" fill="#0a0d0f" stroke="#2b353c" stroke-width="2"/>
      ${dead ? '' : `<g stroke="#23e0c8" fill="none" opacity="0.5" stroke-dasharray="10 12"><circle r="74"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${offline ? 26 : 9}s" repeatCount="indefinite"/></circle></g>
      <g stroke="#ffb23e" fill="none" opacity="0.35" stroke-dasharray="4 20"><circle r="60"><animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="${offline ? 18 : 6}s" repeatCount="indefinite"/></circle></g>`}
      <circle r="42" fill="${coreFill}" filter="url(#di-soft)">${dead ? '' : '<animate attributeName="opacity" values="0.72;1;0.8;1;0.72" dur="2.6s" repeatCount="indefinite"/>'}</circle>
      <circle r="42" fill="none" stroke="#0d1013" stroke-width="6"/>
      <text y="5" text-anchor="middle" fill="${dead ? '#5c6f79' : '#04110f'}" font-size="15" font-weight="bold">CORE</text>
      <text y="120" text-anchor="middle" fill="#6f8792" font-size="10">TURBINE ASSEMBLY</text>
    </g>
    <g transform="translate(40,336)">
      <text x="0" y="0" fill="#6f8792" font-size="11" letter-spacing="2">INTEGRITY</text>
      <text x="200" y="2" fill="${barColor}" font-size="22" font-weight="bold" text-anchor="end">${pct}%</text>
      ${integrityBar(0, 0, 200, pct, barColor)}
      <text x="0" y="44" fill="${statusColor}" font-size="12" font-weight="bold">◉ ${statusText}</text>
    </g>
    <g transform="translate(300,86)" font-size="13">
      <rect x="0" y="0" width="392" height="196" fill="#0c1114" stroke="#2b353c"/>
      <rect x="0" y="0" width="392" height="20" fill="#161d22"/><text x="10" y="14" fill="#37f5db" font-size="11" letter-spacing="2">◢ TELEMETRY</text>
      <g fill="#8fb0bb"><text x="14" y="46">OUTPUT</text><text x="14" y="72">CAPACITY</text><text x="14" y="98">CORE TEMP</text><text x="14" y="124">RPM</text><text x="14" y="150">LOAD</text></g>
      <g font-weight="bold" text-anchor="end">
        <text x="250" y="46" fill="${offline ? '#5c6f79' : '#37f5db'}" ${offline ? '' : 'class="di-flick"'}>${offline ? '0 kW' : kw(msg.outputKw)}</text>
        <text x="250" y="72" fill="#e8f6f3">${kw(msg.capacityKw)}</text>
        <text x="250" y="98" fill="${dead ? '#5c6f79' : '#ffb23e'}">${temp}</text>
        <text x="250" y="124" fill="#e8f6f3">${rpm}</text>
        <text x="250" y="150" fill="${loadColor}">${load == null ? '—' : load + '%'}</text>
      </g>
      <rect x="266" y="30" width="116" height="120" fill="#06100e" stroke="#123"/>${scope}
    </g>
    <g transform="translate(300,300)">
      <text x="0" y="-6" fill="#6f8792" font-size="10" letter-spacing="2">SUBSYSTEM STATUS</text>
      ${led(8,'led-a','#46e05a')}${led(34,'led-b','#46e05a')}${led(60,'led-c','#ffb23e')}${led(86,'led-a','#46e05a')}${led(112,'led-b','#37f5db')}${led(138,'led-c','#46e05a')}${led(164,'led-a','#37f5db')}
    </g>
    ${hackPort(508,300)}
    ${scanlinesAndFrame(720,470)}
    ${critical ? '<rect x="4" y="4" width="712" height="462" rx="7" fill="none" stroke="#ff4a5b" stroke-width="3" class="di-danger" pointer-events="none"/>' : ''}
  </svg>`;
}

function junctionSvg(msg) {
  const { dead, offline, pct, barColor, statusText, statusColor, critical } = stateBits(msg);
  const led = (x, cls, color) => `<circle cx="${x}" cy="8" r="5" fill="${dead ? '#2b353c' : color}" ${dead ? '' : `class="${cls}"`}/>`;
  const breaker = (x, y, on) => `<rect x="${x}" y="${y}" width="20" height="30" rx="2" fill="#12171b" stroke="#2b353c"/><rect x="${x+5}" y="${on ? y+4 : y+16}" width="10" height="10" rx="1" fill="${on ? '#46e05a' : '#5c6f79'}"/>`;
  const breakers = [];
  for (let i = 0; i < 6; i++) breakers.push(breaker(20 + i*30, 40, !offline));
  return `<svg viewBox="0 0 520 340" xmlns="http://www.w3.org/2000/svg" role="img" font-family="'Courier New',monospace">
    <title>${esc(msg.name)} inspection</title>
    <defs><linearGradient id="di-metal2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#232b31"/><stop offset="100%" stop-color="#10151a"/></linearGradient></defs>
    <rect x="4" y="4" width="512" height="332" rx="6" fill="url(#di-metal2)" stroke="#3a464e" stroke-width="2"/>
    <rect x="16" y="16" width="488" height="26" fill="#12171b" stroke="#2b353c"/>
    <text x="26" y="34" fill="${dead ? '#ff4a5b' : '#37f5db'}" font-size="14" letter-spacing="2" font-weight="bold">${esc(msg.name).toUpperCase()}</text>
    <text x="494" y="34" fill="#6f8792" font-size="10" text-anchor="end">JUNCTION_BOX</text>
    <!-- breaker bank -->
    <g transform="translate(30,70)"><text x="0" y="-6" fill="#6f8792" font-size="10" letter-spacing="2">BREAKERS</text>${breakers.join('')}
      ${offline ? '' : '<g><line x1="0" y1="18" x2="180" y2="18" stroke="#46e05a" stroke-width="1" opacity="0.25"/><circle r="2.5" fill="#8ffbec"><animateMotion path="M0,18 H180" dur="1.4s" repeatCount="indefinite"/></circle></g>'}
    </g>
    <!-- integrity -->
    <g transform="translate(30,180)">
      <text x="0" y="0" fill="#6f8792" font-size="10" letter-spacing="2">INTEGRITY</text>
      <text x="180" y="2" fill="${barColor}" font-size="18" font-weight="bold" text-anchor="end">${pct}%</text>
      <rect x="0" y="10" width="180" height="12" fill="#0a0d0f" stroke="#2b353c"/>
      <rect x="2" y="12" height="8" fill="${barColor}" opacity="0.9"><animate attributeName="width" from="0" to="${Math.round(176*pct/100)}" dur="0.6s" fill="freeze"/></rect>
      <text x="0" y="40" fill="${statusColor}" font-size="11" font-weight="bold">◉ ${statusText}</text>
    </g>
    <!-- readout -->
    <g transform="translate(30,250)" font-size="12">
      <text x="0" y="0" fill="#8fb0bb">THROUGHPUT</text>
      <text x="180" y="0" fill="${offline ? '#5c6f79' : '#37f5db'}" text-anchor="end" font-weight="bold" ${offline ? '' : 'class="di-flick"'}>${offline ? '0 kW' : kw(msg.capacityKw)}</text>
    </g>
    <!-- LEDs -->
    <g transform="translate(30,290)">${led(8,'led-a','#46e05a')}${led(30,'led-b','#46e05a')}${led(52,'led-c','#ffb23e')}</g>
    <!-- hack port (compact) -->
    <g transform="translate(320,70)">
      <rect x="0" y="0" width="170" height="110" fill="#0a0d0f" stroke="#33403a" stroke-dasharray="6 4"/>
      <text x="12" y="20" fill="#5c6f79" font-size="11" letter-spacing="1">◄ HACK PORT ►</text>
      <g transform="translate(66,36)" stroke="#54666f" fill="#12171b" stroke-width="2"><path d="M8,16 v-7 a11,11 0 0 1 22,0 v7" fill="none"/><rect x="2" y="16" width="34" height="24" rx="3"/></g>
      <text x="85" y="94" fill="#ff4a5b" font-size="10" text-anchor="middle" opacity="0.8" class="di-flick">ACCESS DENIED</text>
    </g>
    <g class="di-scanbar"><rect x="4" width="512" height="18" fill="#37f5db" opacity="0.05"/></g>
    ${critical ? '<rect x="4" y="4" width="512" height="332" rx="6" fill="none" stroke="#ff4a5b" stroke-width="3" class="di-danger" pointer-events="none"/>' : ''}
  </svg>`;
}
