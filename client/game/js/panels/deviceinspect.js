// Device inspection overlay — grungy industrial cyberpunk readout that pops
// when you `examine` a generator or junction box. Driven by a
// `device_inspect_panel` message from the server (state = live). The generator
// is a roaring turbine face; the junction box is a smaller, tidier breaker
// cabinet. Both carry a (currently inert) locked hacking port.

let _overlay = null;
let _keyHandler = null;

function ensureStyles() {
  if (document.getElementById('device-inspect-styles')) return;
  const s = document.createElement('style');
  s.id = 'device-inspect-styles';
  s.textContent = `
    #device-inspect-overlay { position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.72); backdrop-filter:blur(2px); font-family:'Courier New',monospace; }
    #device-inspect-overlay .di-panel { position:relative; width:min(720px,94vw); }
    #device-inspect-overlay .di-close { position:absolute; top:8px; right:8px; z-index:2; width:26px; height:26px;
      background:#12171b; color:#8fb0bb; border:1px solid #3a464e; border-radius:2px; cursor:pointer; font-size:13px; }
    #device-inspect-overlay .di-close:hover { color:#ff4a5b; border-color:#ff4a5b; }
    @keyframes di-blinkA { 0%,100%{opacity:1} 45%{opacity:.15} }
    @keyframes di-blinkB { 0%{opacity:.3} 50%{opacity:1} 100%{opacity:.3} }
    @keyframes di-blinkC { 0%,100%{opacity:.2} 20%{opacity:1} 60%{opacity:.4} }
    @keyframes di-flick  { 0%,100%{opacity:1} 92%{opacity:1} 94%{opacity:.35} 96%{opacity:1} }
    @keyframes di-scan   { 0%{transform:translateY(0)} 100%{transform:translateY(430px)} }
    #device-inspect-overlay .led-a{animation:di-blinkA 1.3s infinite}
    #device-inspect-overlay .led-b{animation:di-blinkB .9s infinite}
    #device-inspect-overlay .led-c{animation:di-blinkC 2.1s infinite}
    #device-inspect-overlay .di-flick{animation:di-flick 3s infinite}
    #device-inspect-overlay .di-scanbar{animation:di-scan 5.5s linear infinite}
  `;
  document.head.appendChild(s);
}

function close() {
  if (_keyHandler) { window.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

export function openDeviceInspectPanel(msg) {
  ensureStyles();
  close();
  const overlay = document.createElement('div');
  overlay.id = 'device-inspect-overlay';
  const svg = (msg.deviceType === 'junction_box') ? junctionSvg(msg) : generatorSvg(msg);
  overlay.innerHTML = `<div class="di-panel"><button class="di-close" title="Close">✕</button>${svg}</div>`;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.di-close').addEventListener('click', close);
  _keyHandler = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', _keyHandler);
  document.body.appendChild(overlay);
  _overlay = overlay;
}

// Palette helpers by state.
function stateBits(msg) {
  const dead = !!msg.destroyed;
  const offline = dead || !msg.online;
  const pct = dead ? 0 : Math.max(0, Math.min(100, Math.round(msg.integrityPct ?? 0)));
  const barColor = pct > 60 ? '#46e05a' : pct > 25 ? '#ffb23e' : '#ff4a5b';
  const statusText = dead ? 'OFFLINE — WRECKED' : offline ? 'NO POWER' : 'ONLINE';
  const statusColor = dead ? '#ff4a5b' : offline ? '#ffb23e' : '#46e05a';
  return { dead, offline, pct, barColor, statusText, statusColor };
}
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const kw = (v) => (v == null ? '—' : `${Math.round(v)} kW`);

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

function generatorSvg(msg) {
  const { dead, offline, pct, barColor, statusText, statusColor } = stateBits(msg);
  const led = (x, cls, color) => `<circle cx="${x}" cy="8" r="6" fill="${dead ? '#2b353c' : color}" ${dead ? '' : `class="${cls}"`}/>`;
  const scope = dead
    ? `<polyline points="268,100 380,100" fill="none" stroke="#5c6f79" stroke-width="1.6"/>`
    : `<polyline points="268,100 282,72 296,120 310,60 324,110 338,84 352,132 366,70 380,100" fill="none" stroke="#37f5db" stroke-width="1.6">
        <animate attributeName="points" dur="1.1s" repeatCount="indefinite"
          values="268,100 282,72 296,120 310,60 324,110 338,84 352,132 366,70 380,100;268,92 282,128 296,64 310,116 324,80 338,124 352,70 366,118 380,92;268,100 282,72 296,120 310,60 324,110 338,84 352,132 366,70 380,100"/></polyline>`;
  const coreFill = dead ? '#1a1010' : 'url(#di-core)';
  const rpm  = offline ? '0'   : '3600';
  const temp = dead ? '—' : offline ? '120 °C' : '642 °C';
  return `<svg viewBox="0 0 720 470" xmlns="http://www.w3.org/2000/svg" role="img" font-family="'Courier New',monospace">
    <title>${esc(msg.name)} inspection</title>
    <defs>
      <pattern id="di-haz" width="28" height="16" patternUnits="userSpaceOnUse"><rect width="28" height="16" fill="#0e0f0c"/><path d="M-8,16 L8,0 M6,16 L22,0 M20,16 L36,0" stroke="#ffb23e" stroke-width="7" opacity="0.85"/></pattern>
      <radialGradient id="di-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#8ffbec"/><stop offset="45%" stop-color="#23e0c8"/><stop offset="100%" stop-color="#0b3f39"/></radialGradient>
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
      <circle r="88" fill="#0a0d0f" stroke="#2b353c" stroke-width="2"/>
      ${dead ? '' : `<g stroke="#23e0c8" fill="none" opacity="0.5" stroke-dasharray="10 12"><circle r="74"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="9s" repeatCount="indefinite"/></circle></g>
      <g stroke="#ffb23e" fill="none" opacity="0.35" stroke-dasharray="4 20"><circle r="60"><animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="6s" repeatCount="indefinite"/></circle></g>`}
      <circle r="42" fill="${coreFill}" filter="url(#di-soft)">${dead ? '' : '<animate attributeName="opacity" values="0.72;1;0.8;1;0.72" dur="2.6s" repeatCount="indefinite"/>'}</circle>
      <circle r="42" fill="none" stroke="#0d1013" stroke-width="6"/>
      <text y="5" text-anchor="middle" fill="${dead ? '#5c6f79' : '#04110f'}" font-size="15" font-weight="bold">CORE</text>
      <text y="120" text-anchor="middle" fill="#6f8792" font-size="10">TURBINE ASSEMBLY</text>
    </g>
    <g transform="translate(40,340)">
      <text x="0" y="0" fill="#6f8792" font-size="11" letter-spacing="2">INTEGRITY</text>
      <text x="200" y="2" fill="${barColor}" font-size="22" font-weight="bold" text-anchor="end">${pct}%</text>
      <rect x="0" y="10" width="200" height="14" fill="#0a0d0f" stroke="#2b353c"/>
      <rect x="2" y="12" width="${Math.round(196*pct/100)}" height="10" fill="${barColor}" opacity="0.85"/>
      <text x="0" y="44" fill="${stateBits(msg).statusColor}" font-size="12" font-weight="bold">◉ ${statusText}</text>
    </g>
    <g transform="translate(300,86)" font-size="13">
      <rect x="0" y="0" width="392" height="196" fill="#0c1114" stroke="#2b353c"/>
      <rect x="0" y="0" width="392" height="20" fill="#161d22"/><text x="10" y="14" fill="#37f5db" font-size="11" letter-spacing="2">◢ TELEMETRY</text>
      <g fill="#8fb0bb"><text x="14" y="48">OUTPUT</text><text x="14" y="76">CAPACITY</text><text x="14" y="104">CORE TEMP</text><text x="14" y="132">RPM</text></g>
      <g font-weight="bold" text-anchor="end">
        <text x="250" y="48" fill="${offline ? '#5c6f79' : '#37f5db'}" ${offline ? '' : 'class="di-flick"'}>${offline ? '0 kW' : kw(msg.outputKw)}</text>
        <text x="250" y="76" fill="#e8f6f3">${kw(msg.capacityKw)}</text>
        <text x="250" y="104" fill="${dead ? '#5c6f79' : '#ffb23e'}">${temp}</text>
        <text x="250" y="132" fill="#e8f6f3">${rpm}</text>
      </g>
      <rect x="266" y="30" width="116" height="140" fill="#06100e" stroke="#123"/>${scope}
    </g>
    <g transform="translate(300,300)">
      <text x="0" y="-6" fill="#6f8792" font-size="10" letter-spacing="2">SUBSYSTEM STATUS</text>
      ${led(8,'led-a','#46e05a')}${led(34,'led-b','#46e05a')}${led(60,'led-c','#ffb23e')}${led(86,'led-a','#46e05a')}${led(112,'led-b','#37f5db')}${led(138,'led-c','#46e05a')}${led(164,'led-a','#37f5db')}
    </g>
    ${hackPort(508,300)}
    ${scanlinesAndFrame(720,470)}
  </svg>`;
}

function junctionSvg(msg) {
  const { dead, offline, pct, barColor, statusText, statusColor } = stateBits(msg);
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
    <g transform="translate(30,70)"><text x="0" y="-6" fill="#6f8792" font-size="10" letter-spacing="2">BREAKERS</text>${breakers.join('')}</g>
    <!-- integrity -->
    <g transform="translate(30,180)">
      <text x="0" y="0" fill="#6f8792" font-size="10" letter-spacing="2">INTEGRITY</text>
      <text x="180" y="2" fill="${barColor}" font-size="18" font-weight="bold" text-anchor="end">${pct}%</text>
      <rect x="0" y="10" width="180" height="12" fill="#0a0d0f" stroke="#2b353c"/>
      <rect x="2" y="12" width="${Math.round(176*pct/100)}" height="8" fill="${barColor}" opacity="0.85"/>
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
  </svg>`;
}
