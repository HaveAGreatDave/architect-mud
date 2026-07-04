// COCKPIT — the flight HUD + the two signature flight minigames.
//
// Three surfaces, all display-only / server-authoritative (the flight plugin
// decides everything; this panel renders state and reports minigame outcomes),
// dressed in the same physical-hardware idiom as the other decks (Vault Crack,
// Circuit Breach, Hololock, the reel) via the shared chassis helpers:
//
//  1. updateCockpit(state) — swaps the top area-pane into a live avionics cluster
//     while you're aboard: a graphical artificial horizon, a rotating compass
//     card, a 5×5 moving-map nav display, colour-graded fuel/throttle/hull/temp
//     gauges, and a flashing warning strip. Pushed each tick as `cockpit_update`.
//  2. openTakeoff(opts)    — the departure-roll deck: build airspeed on a
//     perspective runway and rotate before the strip runs out.
//  3. openGlideslope(opts) — the approach deck: an ILS/attitude instrument — hold
//     the glidepath diamond centred while wind shoves it, then FLARE at touchdown.
//
// Both minigames report { won } via opts.onResult; dispatch.js fires the real
// server resolve command (takeoffresolve / landresolve), which is authoritative.
// Skill vs. difficulty tunes the board (band width, shove strength, accel/strip)
// — an outclassed or dead-stick pilot faces a genuinely brutal board.

import { setAreaPane } from '../render.js';
import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';

// Cues resolve through window.SFXCatalog by id ('flight-roll', 'flight-touchdown',
// …); defs live in client/shared/sfx-catalog.js (group 'flight'), editable in the
// dev panel's Sounds tab. Guarded — silent if audio isn't up; falls back to a
// generic cue if a flight cue isn't catalogued.
function csfx(id, fallback) {
  const cat = window.SFXCatalog;
  if (cat && typeof cat.get === 'function' && cat.get(id)) sfx(id);
  else if (fallback) sfx(fallback);
}

const HDG_DEG = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
const HDG_GLYPH = { n: '▲', ne: '◥', e: '▶', se: '◢', s: '▼', sw: '◣', w: '◀', nw: '◤' };

// ══ 1. THE AREA-PANE AVIONICS HUD ═════════════════════════════════════════════

function fuelClass(pct) { return pct <= 20 ? 'ck-red' : pct <= 40 ? 'ck-amber' : 'ck-green'; }
function hullClass(pct) { return pct <= 25 ? 'ck-red' : pct <= 55 ? 'ck-amber' : 'ck-green'; }
function tempClass(pct) { return pct >= 85 ? 'ck-red' : pct >= 65 ? 'ck-amber' : 'ck-green'; }

// Colour-graded block bar. width 10 glyphs.
function gauge(label, pct, cls, valueText) {
  const filled = Math.round(clampNum(pct, 0, 100) / 10);
  return `<div class="ck-g"><span class="ck-g-lbl">${label}</span>` +
    `<span class="ck-g-bar ${cls}">${'█'.repeat(filled)}<span class="ck-g-empty">${'░'.repeat(10 - filled)}</span></span>` +
    `<span class="ck-g-val ${cls}">${valueText}</span></div>`;
}

// Artificial horizon — sky/ground split pitched by altitude band (higher = nose
// up), a pitch ladder, and a fixed aircraft reference. Pure SVG.
function horizonSVG(bandIndex, ceiling) {
  const pitch = (bandIndex - 0.5) * 13;            // px the horizon drops as you climb
  const ladder = [-2, -1, 1, 2].map(n =>
    `<line x1="${52 - Math.abs(n) * 6}" y1="${60 + pitch + n * 15}" x2="${68 + Math.abs(n) * 6}" y2="${60 + pitch + n * 15}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`).join('');
  return `<svg class="ck-adi" viewBox="0 0 120 120" aria-hidden="true">
    <defs><clipPath id="ck-adi-clip"><circle cx="60" cy="60" r="46"/></clipPath></defs>
    <circle cx="60" cy="60" r="49" fill="#05101a" stroke="#22465a" stroke-width="2"/>
    <g clip-path="url(#ck-adi-clip)">
      <rect x="0" y="${-40 + pitch}" width="120" height="${100}" fill="url(#ck-sky)"/>
      <rect x="0" y="${60 + pitch}" width="120" height="${120}" fill="url(#ck-gnd)"/>
      <line x1="6" y1="${60 + pitch}" x2="114" y2="${60 + pitch}" stroke="#d6f0ff" stroke-width="1.5"/>
      ${ladder}
    </g>
    <defs>
      <linearGradient id="ck-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d3a5c"/><stop offset="1" stop-color="#134f78"/></linearGradient>
      <linearGradient id="ck-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a12"/><stop offset="1" stop-color="#241a0c"/></linearGradient>
    </defs>
    <path d="M34 60 L52 60 M68 60 L86 60 M60 60 l0 0" stroke="#ffcf3e" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="2.4" fill="#ffcf3e"/>
    <polygon points="60,12 55,22 65,22" fill="#ffcf3e"/>
    <circle cx="60" cy="60" r="49" fill="none" stroke="#0a1a24" stroke-width="6"/>
  </svg>`;
}

// Heading card — a compass rose rotated so the current heading sits under the
// fixed lubber line at the top.
function compassSVG(heading) {
  const deg = HDG_DEG[heading] ?? 0;
  const ticks = [];
  for (let a = 0; a < 360; a += 45) {
    const major = a % 90 === 0;
    const rad = (a - 90) * Math.PI / 180;
    const r1 = major ? 30 : 34, r2 = 40;
    ticks.push(`<line x1="${50 + Math.cos(rad) * r1}" y1="${50 + Math.sin(rad) * r1}" x2="${50 + Math.cos(rad) * r2}" y2="${50 + Math.sin(rad) * r2}" stroke="${major ? '#8fd0ff' : '#3f6d8c'}" stroke-width="${major ? 2 : 1}"/>`);
    if (major) {
      const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a];
      ticks.push(`<text x="${50 + Math.cos(rad) * 22}" y="${50 + Math.sin(rad) * 22 + 3}" fill="${lab === 'N' ? '#ff5b5b' : '#8fd0ff'}" font-size="9" text-anchor="middle" font-family="monospace">${lab}</text>`);
    }
  }
  return `<svg class="ck-hsi" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="#05101a" stroke="#22465a" stroke-width="2"/>
    <g transform="rotate(${-deg} 50 50)">${ticks.join('')}</g>
    <polygon points="50,6 46,15 54,15" fill="#ffcf3e"/>
    <text x="50" y="56" fill="#d6f0ff" font-size="15" text-anchor="middle" font-family="monospace" font-weight="bold">${(heading || 'n').toUpperCase()}</text>
  </svg>`;
}

// 5×5 scrolling nav display. `map` is the server's window (north-up); the craft
// cell shows the heading glyph, land cells are shaded, open air a faint dot.
function mapGrid(map, heading) {
  if (!Array.isArray(map)) return '';
  const rows = map.map(row => `<div class="ck-map-row">` + row.map(cell => {
    if (cell.kind === 'craft') return `<span class="ck-map-c ck-map-craft">${HDG_GLYPH[heading] || '▲'}</span>`;
    if (cell.kind === 'nofly') return `<span class="ck-map-c ck-map-nofly">▚</span>`;
    if (cell.kind === 'land') return `<span class="ck-map-c ck-map-land">▓</span>`;
    return `<span class="ck-map-c ck-map-air">·</span>`;
  }).join('') + `</div>`).join('');
  return `<div class="ck-map"><div class="ck-map-sweep"></div>${rows}</div>`;
}

export function updateCockpit(state) {
  ensureHudStyles();
  const s = state || {};
  const passenger = s.seat === 'passenger';

  const warn = s.warn === 'STARVATION'
    ? '<div class="ck-warn ck-red">⚠ ENGINE OUT — DEAD STICK — LAND NOW</div>'
    : s.warn === 'BINGO'
      ? '<div class="ck-warn ck-amber">⚠ BINGO FUEL — divert to a field</div>'
      : '';

  // Parked / cold view — a pre-flight checklist strip instead of live gauges.
  if (!s.airborne) {
    const step = s.engineOn
      ? 'engine running · set a <b>throttle</b> · <b>takeoff</b> when ready'
      : 'engine cold · <b>startup</b> to spin up';
    const html = `<div class="ck-hud ck-parked">
      <div class="ck-title"><span class="ck-title-mark">⏻</span> COCKPIT — <b>${esc(s.tail || 'craft')}</b> <span class="ck-title-sub">${esc((s.class || '').toUpperCase())} · PARKED</span></div>
      <div class="ck-park-body">
        ${gauge('FUEL', s.fuelPct, fuelClass(s.fuelPct), `${s.fuelPct ?? 0}%`)}
        ${gauge('HULL', s.hullPct, hullClass(s.hullPct), `${s.hullPct ?? 100}%`)}
        <div class="ck-check">${s.engineOn ? '<span class="ck-green">●</span> ENGINE LIVE' : '<span class="ck-dim">○</span> ENGINE COLD'} — ${step}</div>
      </div>
    </div>`;
    setAreaPane(html);
    return;
  }

  const instruments = `<div class="ck-instruments">
    ${horizonSVG(s.bandIndex ?? 1, s.ceiling ?? 2)}
    ${compassSVG(s.heading || 'n')}
    ${mapGrid(s.map, s.heading || 'n')}
  </div>`;

  const gauges = passenger ? '' : `<div class="ck-gauges">
    ${gauge('FUEL', s.fuelPct, fuelClass(s.fuelPct), `${s.fuelPct ?? 0}%`)}
    ${gauge('THR ', s.throttle, 'ck-cyan', `${s.throttle ?? 0}%`)}
    ${gauge('HULL', s.hullPct, hullClass(s.hullPct), `${s.hullPct ?? 100}%`)}
    ${gauge('ENG ', Math.round(((s.temp ?? 0) / (s.tempMax || 160)) * 100), tempClass(Math.round(((s.temp ?? 0) / (s.tempMax || 160)) * 100)), `${s.temp ?? 0}°C`)}
  </div>`;

  const armTag = s.hardpoints > 0
    ? `<span class="${s.armed ? 'ck-red' : 'ck-dim'}">${s.armed ? '● ARMED' : '○ SAFE'}</span>` : '';
  const readout = `<div class="ck-readout">
    <span>ALT <b>${esc(s.bandLabel || '—')}</b></span>
    <span>SPD <b>${s.spd ?? 0}</b>kt</span>
    <span>HDG <b>${(s.heading || 'n').toUpperCase()}</b></span>
    ${armTag ? `<span>${armTag}</span>` : ''}
    <span class="ck-below">⌖ <b>${esc(s.surface || 'open air')}</b></span>
  </div>`;

  const passNote = passenger ? '<div class="ck-seat">PASSENGER · window view — no controls, just the nerve to watch.</div>' : '';

  const html = `<div class="ck-hud">
    <div class="ck-title"><span class="ck-title-mark">✈</span> ${passenger ? 'CABIN' : 'COCKPIT'} — <b>${esc(s.tail || 'craft')}</b> <span class="ck-title-sub">${esc((s.class || '').toUpperCase())} · AIRBORNE</span></div>
    ${instruments}
    ${readout}
    ${gauges}
    ${warn}
    ${passNote}
  </div>`;
  setAreaPane(html);

  if (s.warn) csfx('flight-warn');   // audible BINGO/STALL nag on each tick it persists
}

function ensureHudStyles() {
  if (document.getElementById('cockpit-hud-styles')) return;
  const st = document.createElement('style');
  st.id = 'cockpit-hud-styles';
  st.textContent = `
    .ck-hud { font-family:'Courier New',monospace; color:#8fd0ff; font-size:13px; line-height:1.5;
      background:radial-gradient(120% 120% at 50% 0%, rgba(20,50,74,0.28), transparent 70%); }
    .ck-title { display:flex; align-items:center; gap:8px; padding:2px 2px 8px; letter-spacing:2px; font-size:12px; color:#5f8299; border-bottom:1px solid #16303f; }
    .ck-title b { color:#d6f0ff; letter-spacing:1px; }
    .ck-title-mark { color:#4fb8e0; text-shadow:0 0 9px rgba(79,184,224,0.7); animation:ck-breathe 3.2s ease-in-out infinite; }
    @keyframes ck-breathe { 0%,100%{text-shadow:0 0 8px rgba(79,184,224,0.55)} 50%{text-shadow:0 0 16px rgba(79,184,224,0.95)} }
    .ck-title-sub { margin-left:auto; font-size:10px; letter-spacing:2px; opacity:0.6; }
    .ck-instruments { display:flex; align-items:center; gap:10px; padding:10px 2px 6px; flex-wrap:wrap; }
    .ck-adi { width:96px; height:96px; flex:0 0 auto; filter:drop-shadow(0 0 6px rgba(0,0,0,0.6)); }
    .ck-hsi { width:80px; height:80px; flex:0 0 auto; filter:drop-shadow(0 0 6px rgba(0,0,0,0.6)); }
    .ck-map { flex:1 1 120px; position:relative; padding:6px; background:#04121c; border:1px solid #22465a; border-radius:6px;
      box-shadow:inset 0 0 18px rgba(0,0,0,0.7); overflow:hidden; min-width:110px; }
    .ck-map-row { display:flex; justify-content:center; }
    .ck-map-c { width:20px; text-align:center; font-size:15px; line-height:1.25; }
    .ck-map-craft { color:#ffcf3e; text-shadow:0 0 8px rgba(255,207,62,0.8); }
    .ck-map-land { color:#2f6d4a; }
    .ck-map-nofly { color:#ff5b5b; opacity:0.7; }
    .ck-map-air { color:#1c3a4a; }
    .ck-map-sweep { position:absolute; top:50%; left:50%; width:140%; height:2px; transform-origin:left center;
      background:linear-gradient(90deg, rgba(79,184,224,0.55), transparent); animation:ck-radar 3.6s linear infinite; pointer-events:none; }
    @keyframes ck-radar { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
    .ck-readout { display:flex; gap:16px; flex-wrap:wrap; padding:6px; background:#08151f; border:1px solid #16303f; border-radius:5px; margin:2px 0; letter-spacing:1px; }
    .ck-readout b { color:#d6f0ff; }
    .ck-readout .ck-below { margin-left:auto; color:#7fae99; }
    .ck-readout .ck-below b { color:#a9e6c6; }
    .ck-gauges { padding:4px 2px; }
    .ck-g { display:flex; align-items:center; gap:8px; padding:1px 4px; }
    .ck-g-lbl { width:34px; color:#5f8299; letter-spacing:1px; white-space:pre; }
    .ck-g-bar { letter-spacing:-1px; font-size:14px; }
    .ck-g-empty { color:#193040; }
    .ck-g-val { width:48px; text-align:right; }
    .ck-green { color:#46e05a; } .ck-amber { color:#ffb23e; } .ck-red { color:#ff5b5b; } .ck-cyan { color:#4fb8e0; }
    .ck-warn { padding:3px 6px; margin-top:4px; font-weight:bold; letter-spacing:1px; text-align:center; border-radius:4px;
      background:rgba(255,91,91,0.08); animation:ck-flash 1s steps(2) infinite; }
    @keyframes ck-flash { 50% { opacity:0.4; } }
    .ck-seat { padding:4px 6px; color:#6b8aa0; font-style:italic; }
    .ck-parked .ck-park-body { padding:10px 2px; }
    .ck-check { padding:8px 4px 2px; color:#7fae99; letter-spacing:1px; }
    .ck-check b { color:#d6f0ff; }
    .ck-dim { color:#5f8299; }
  `;
  document.head.appendChild(st);
}

// ══ MINIGAME CHASSIS (blue avionics accent) — game-specific screen dressing on
//    top of the shared .mg-* chassis helpers. ═══════════════════════════════════
function ensureMgStyles() {
  if (document.getElementById('cockpit-mg-styles')) return;
  const s = document.createElement('style');
  s.id = 'cockpit-mg-styles';
  s.textContent = `
    #cockpit-overlay { --mg-accent:#4fb8e0; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,4,7,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    /* Moulded avionics-bay chassis — top-lit multi-stop steel-blue body (ATM #atm-box). */
    #cockpit-overlay .ck-panel { width:min(540px,94vw); color:#8fd0ff;
      background:linear-gradient(180deg,#2b3a48 0%,#1c2833 7%,#111c26 12%,#070f16 100%); padding:14px 16px 16px; animation:ck-boot .3s ease-out; }
    @keyframes ck-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #cockpit-overlay .ck-hud2 { display:flex; gap:16px; align-items:center; padding:8px 2px; font-size:12px; color:#7f93a4; letter-spacing:1px; flex-wrap:wrap; }
    #cockpit-overlay .ck-hud2 b { color:#4fb8e0; font-weight:bold; }
    #cockpit-overlay .ck-asi-wrap { display:inline-flex; align-items:center; gap:6px; margin-left:auto; }
    #cockpit-overlay .ck-asi-bar { position:relative; display:inline-block; width:130px; height:9px; background:#0a1620; border:1px solid #2b4a60; border-radius:3px; overflow:hidden; }
    #cockpit-overlay .ck-asi-fill { display:block; height:100%; width:0%; background:linear-gradient(90deg,#2a7fa8,#4fb8e0); transition:width .08s linear; }
    #cockpit-overlay .ck-asi-vr { position:absolute; top:-2px; bottom:-2px; width:2px; background:#46e05a; box-shadow:0 0 6px #46e05a; }
    #cockpit-overlay .ck-scr { background:radial-gradient(130% 130% at 50% 40%, rgba(79,184,224,0.08) 55%, #01060a 100%); }
    #cockpit-overlay .ck-scr svg { display:block; width:100%; height:auto; }
    #cockpit-overlay .ck-status2 { min-height:22px; padding:8px 2px 2px; font-size:13px; letter-spacing:1px; font-weight:bold; }
    #cockpit-overlay .ck-win { color:#46e05a; } #cockpit-overlay .ck-lose { color:#ff5b5b; } #cockpit-overlay .ck-hint { color:#7fae99; font-weight:normal; }
    #cockpit-overlay .ck-actions { display:flex; gap:8px; margin-top:8px; }
    #cockpit-overlay .ck-btn { flex:1; padding:11px 6px; background:#0f1c28; color:#8fc4e0; border:1px solid #2b4a60; border-radius:2px;
      cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase;
      box-shadow:inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; user-select:none; -webkit-user-select:none; touch-action:none; }
    #cockpit-overlay .ck-btn:hover { color:#4fb8e0; border-color:#4fb8e0; }
    #cockpit-overlay .ck-btn.ck-down { color:#04101a; background:#4fb8e0; border-color:#4fb8e0; box-shadow:inset 0 2px 4px rgba(0,0,0,0.4); }
    #cockpit-overlay .ck-btn-abort:hover { color:#ff5b5b; border-color:#ff5b5b; }
    #cockpit-overlay .ck-btn-flare { flex:1.3; background:#2a1a06; color:#ffb23e; border-color:#7a5310; }
    #cockpit-overlay .ck-btn-flare.ck-armed { animation:ck-flare-pulse 0.5s steps(2) infinite; color:#04101a; background:#ffb23e; border-color:#ffcf3e; }
    @keyframes ck-flare-pulse { 50% { opacity:0.55; } }
  `;
  document.head.appendChild(s);
}

// ══ 2. TAKEOFF — departure-roll deck ══════════════════════════════════════════
export function openTakeoff(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 5, deviceName: 'CRAFT', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const accel = clampNum(0.42 + edge * 0.03, 0.24, 0.8);        // airspeed gain/sec while holding
  const rollRate = clampNum(0.052 - edge * 0.003, 0.028, 0.075); // strip consumed/sec × speed
  const vr = 0.8;                                               // rotation airspeed (fraction)

  let hold = false, speed = 0, dist = 0, over = false, raf = 0, last = 0, clOffset = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  // Perspective runway: near-wide → far-narrow, dashed centreline, a green Vr gate,
  // the craft advancing up-strip, a red overrun zone eating from the far end.
  const runway = `<svg viewBox="0 0 200 210" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="ck-rw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1a12"/><stop offset="1" stop-color="#15281a"/></linearGradient>
    </defs>
    <polygon points="70,14 130,14 176,196 24,196" fill="url(#ck-rw)" stroke="#2f6d4a" stroke-width="1.5"/>
    <line id="ck-rw-line" x1="100" y1="20" x2="100" y2="196" stroke="#cfe8d6" stroke-width="2" stroke-dasharray="10 12"/>
    <line id="ck-vr-line" x1="60" y1="70" x2="140" y2="70" stroke="#46e05a" stroke-width="2" stroke-dasharray="4 4"/>
    <text x="146" y="72" fill="#46e05a" font-size="9" font-family="monospace">Vr</text>
    <g id="ck-rw-plane" transform="translate(100 186)">
      <path d="M0,-11 L4,-3 L12,3 L4,4 L2,11 L-2,11 L-4,4 L-12,3 L-4,-3 Z" fill="#d6f0ff" stroke="#4fb8e0" stroke-width="0.7"/>
    </g>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#9992;', 'TAKEOFF', 'DEPARTURE ROLL &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-hud2">
      <span>RWY <b id="ck-rwy">FULL</b></span>
      <span class="ck-asi-wrap">ASI <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-asi"></span><span class="ck-asi-vr" style="left:${vr * 100}%"></span></span></span>
    </div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr mg-screen" style="--mg-sweep-h:220px">
      ${runway}
      ${crtOverlays()}
    </div></div>
    ${deckStrip('THROTTLE BUS', 'RWY USED')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">HOLD to run up the engine — reach the green Vr gate before you run out of strip.</span></div>
    <div class="ck-actions">
      <button class="ck-btn ck-btn-hold">Throttle Up &#9251;</button>
      <button class="ck-btn ck-btn-abort">Abort</button>
    </div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay;
  const $ = (sel) => overlay.querySelector(sel);
  const setStatus = (h) => { const el = $('#ck-status'); if (el) el.innerHTML = h; };
  const setHold = (on) => { hold = on; $('.ck-btn-hold')?.classList.toggle('ck-down', on); };

  const finish = (won) => {
    if (over) return; over = true;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-rotate' : 'flight-abort', won ? 'hololock-win' : 'hololock-lose');
    if (won) { const pl = $('#ck-rw-plane'); if (pl) pl.setAttribute('transform', 'translate(100 40) scale(1.5)'); }
    setStatus(won ? '<span class="ck-win">◇ ROTATE — positive rate, you\'re flying.</span>' : '<span class="ck-lose">✕ OUT OF STRIP — reject, reject.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1050);
  };

  const tick = (t) => {
    if (over) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    speed = clampNum(speed + (hold ? accel : -0.16) * dt, 0, 1);
    dist = clampNum(dist + speed * rollRate * dt * 12, 0, 1);
    // Craft slides up the strip (186 near → 40 far); centreline scrolls with speed.
    const pl = $('#ck-rw-plane'); if (pl) pl.setAttribute('transform', `translate(100 ${186 - dist * 146})`);
    clOffset = (clOffset + speed * 180 * dt) % 22;
    const cl = $('#ck-rw-line'); if (cl) cl.setAttribute('stroke-dashoffset', `${clOffset}`);
    $('#ck-asi').style.width = `${Math.round(speed * 100)}%`;
    $('#ck-rwy').textContent = dist > 0.8 ? 'SHORT' : dist > 0.4 ? `${Math.round((1 - dist) * 100)}%` : 'FULL';
    if (dist > 0.8) $('#ck-rwy').style.color = '#ff5b5b';
    setDeckLevel(overlay, dist);
    if (speed >= vr) { finish(true); return; }
    if (dist >= 1) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  };

  $('.mg-close').addEventListener('click', () => finish(false));
  $('.ck-btn-abort').addEventListener('click', () => finish(false));
  const holdBtn = $('.ck-btn-hold');
  const down = (e) => { e.preventDefault(); setHold(true); };
  const up = () => setHold(false);
  add(holdBtn, 'pointerdown', down); add(window, 'pointerup', up); add(window, 'pointercancel', up);
  add(window, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) { e.preventDefault(); setHold(true); } });
  add(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setHold(false); } });
  window.AudioEngine?.init?.();
  csfx('flight-roll', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══ 3. GLIDESLOPE — approach deck (ILS + attitude) ════════════════════════════
export function openGlideslope(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 5, emergency: false, deviceName: 'FIELD', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const bandH = clampNum(0.30 + edge * 0.025, 0.14, 0.5);        // glidepath capture height (skill widens)
  const force = clampNum(0.5 + o.difficulty * 0.05 - o.skill * 0.02 + (o.emergency ? 0.35 : 0), 0.3, 1.5);
  const descentRate = o.emergency ? 0.11 : 0.075;

  const LIFT = 1.7, GRAV = 1.15, DAMP = 0.86;
  let hold = false, pos = 0.5, vel = 0, bandC = 0.5, driftDir = 1;
  const bandDrift = edge < 0 ? 0.12 : 0.06;
  let descent = 0, inBandTime = 0, flareArmed = false, flareHit = false, over = false, raf = 0, last = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  // The screen is an attitude/ILS instrument: a pitching+banking horizon backdrop,
  // a fixed aircraft reference, a growing runway at the far end, and a right-hand
  // glidepath scale whose diamond you keep centred.
  const scr = `<svg viewBox="0 0 220 250" preserveAspectRatio="xMidYMid meet">
    <defs>
      <clipPath id="ck-hz-clip"><rect x="8" y="8" width="176" height="234" rx="10"/></clipPath>
      <linearGradient id="ck-hz-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d3a5c"/><stop offset="1" stop-color="#134f78"/></linearGradient>
      <linearGradient id="ck-hz-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a12"/><stop offset="1" stop-color="#1a1206"/></linearGradient>
    </defs>
    <g clip-path="url(#ck-hz-clip)">
      <g id="ck-hz">
        <rect x="-120" y="-180" width="440" height="320" fill="url(#ck-hz-sky)"/>
        <rect x="-120" y="125" width="440" height="320" fill="url(#ck-hz-gnd)"/>
        <line x1="-120" y1="125" x2="320" y2="125" stroke="#d6f0ff" stroke-width="1.5"/>
      </g>
      <polygon id="ck-runway" points="86,240 110,240 108,240 88,240" fill="#0c1a12" stroke="#3f8a5c" stroke-width="1"/>
      <line id="ck-rw-cl" x1="98" y1="240" x2="98" y2="240" stroke="#cfe8d6" stroke-width="1.5" stroke-dasharray="4 5"/>
    </g>
    <!-- fixed aircraft reference -->
    <path d="M64,125 L88,125 M108,125 L132,125" stroke="#ffcf3e" stroke-width="3" stroke-linecap="round"/>
    <rect x="94" y="120" width="8" height="10" fill="none" stroke="#ffcf3e" stroke-width="2"/>
    <!-- glidepath scale (right) -->
    <line x1="200" y1="40" x2="200" y2="210" stroke="#2b4a60" stroke-width="1.5"/>
    ${[40, 82, 124, 166, 208].map(y => `<circle cx="200" cy="${y}" r="3" fill="none" stroke="#5f8fa8" stroke-width="1"/>`).join('')}
    <polygon id="ck-gp-diamond" points="200,118 206,125 200,132 194,125" fill="#4fb8e0"/>
    <rect x="188" y="8" width="24" height="234" fill="none"/>
    <text x="200" y="26" fill="#5f8fa8" font-size="8" text-anchor="middle" font-family="monospace">G/S</text>
    <rect x="8" y="8" width="204" height="234" rx="10" fill="none" stroke="#22465a" stroke-width="2"/>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#128758;', o.emergency ? 'DEAD STICK' : 'GLIDESLOPE', 'APPROACH &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-hud2">
      <span>ALT <b id="ck-alt">—</b></span>
      <span>G/S <b id="ck-gs">CAPTURE</b></span>
      <span class="ck-asi-wrap">${o.emergency ? '<span style="color:#ff5b5b">NO ENGINE</span>' : 'ILS'}</span>
    </div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr mg-screen" style="--mg-sweep-h:250px">
      ${scr}
      ${crtOverlays()}
    </div></div>
    ${deckStrip('CONTROL BUS', 'DEVIATION')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">HOLD to arrest your sink. Keep the diamond centred on the glidepath. FLARE at touchdown.</span></div>
    <div class="ck-actions">
      <button class="ck-btn ck-btn-hold">Pull Up &#9251;</button>
      <button class="ck-btn ck-btn-flare">Flare</button>
    </div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay;
  const $ = (sel) => overlay.querySelector(sel);
  const setStatus = (h) => { const el = $('#ck-status'); if (el) el.innerHTML = h; };
  const setHold = (on) => { hold = on; $('.ck-btn-hold')?.classList.toggle('ck-down', on); };
  const bracketed = () => Math.abs(pos - bandC) <= bandH / 2;

  const finish = (won) => {
    if (over) return; over = true;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-touchdown' : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ TOUCHDOWN — mains, then nose. Down and safe.</span>' : '<span class="ck-lose">✕ You lose the glidepath — hard arrival.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1100);
  };

  const render = () => {
    // Horizon pitches with your vertical position (below glidepath = nose-up view)
    // and banks slightly with your vertical rate — reads like a real ADI.
    const pitch = (pos - 0.5) * 120;
    const roll = clampNum(vel * 26, -14, 14);
    const hz = $('#ck-hz'); if (hz) hz.setAttribute('transform', `translate(0 ${pitch}) rotate(${roll} 100 125)`);
    // Glidepath diamond: deviation from band centre maps onto the right scale.
    const dev = (pos - bandC);
    const gy = clampNum(125 + dev * 250, 42, 208);
    const dia = $('#ck-gp-diamond');
    if (dia) { dia.setAttribute('points', `200,${gy - 7} 206,${gy} 200,${gy + 7} 194,${gy}`); dia.setAttribute('fill', bracketed() ? '#46e05a' : '#ff8a3e'); }
    // Runway grows out of the far end as you descend.
    const g = Math.min(1, descent);
    const half = 3 + g * 34, topY = 240 - g * 150, cx = 98;
    const rw = $('#ck-runway');
    if (rw) rw.setAttribute('points', `${cx - 3},240 ${cx + 3},240 ${cx + half},${topY} ${cx - half},${topY}`);
    const cl = $('#ck-rw-cl'); if (cl) { cl.setAttribute('y1', '240'); cl.setAttribute('y2', `${topY}`); }
    $('#ck-alt').textContent = `${Math.max(0, Math.round((1 - descent) * (o.emergency ? 300 : 500)))}ft`;
    $('#ck-gs').textContent = bracketed() ? 'ON G/S' : (pos < bandC ? 'HIGH' : 'LOW');
    setDeckLevel(overlay, Math.min(1, Math.abs(dev) / (bandH * 1.4)));
  };

  const tick = (t) => {
    if (over) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    vel = (vel + (hold ? -LIFT : GRAV) * dt) * DAMP;
    pos = clampNum(pos + vel * dt, 0.04, 0.96);
    if (pos <= 0.04 || pos >= 0.96) vel = 0;
    pos = clampNum(pos + (Math.random() - 0.5) * force * dt * 0.6, 0.04, 0.96);
    bandC += bandDrift * driftDir * dt;
    if (bandC < 0.2 + bandH / 2) { bandC = 0.2 + bandH / 2; driftDir = 1; }
    if (bandC > 0.8 - bandH / 2) { bandC = 0.8 - bandH / 2; driftDir = -1; }
    if (bracketed()) inBandTime += dt;
    descent = clampNum(descent + descentRate * dt, 0, 1);
    if (descent >= 0.86 && !flareArmed) {
      flareArmed = true;
      $('.ck-btn-flare')?.classList.add('ck-armed');
      csfx('flight-flare');
      setStatus('<span style="color:#ffb23e">FLARE NOW — ease it on.</span>');
    }
    render();
    if (descent >= 1) { finish(bracketed() && flareHit && inBandTime > descent * 0.9); return; }
    raf = requestAnimationFrame(tick);
  };

  const doFlare = () => {
    if (over || flareHit) return;
    if (!flareArmed) { finish(false); return; }     // flared too early = botch
    flareHit = true;
    $('.ck-btn-flare')?.classList.remove('ck-armed');
    setStatus('<span style="color:#8fd0ff">Flared — hold it off the deck…</span>');
  };

  $('.mg-close').addEventListener('click', () => finish(false));
  const holdBtn = $('.ck-btn-hold');
  const flareBtn = $('.ck-btn-flare');
  const down = (e) => { e.preventDefault(); setHold(true); };
  const up = () => setHold(false);
  add(holdBtn, 'pointerdown', down); add(window, 'pointerup', up); add(window, 'pointercancel', up);
  add(flareBtn, 'click', doFlare);
  add(window, 'keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) { e.preventDefault(); setHold(true); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); doFlare(); }
  });
  add(window, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); setHold(false); } });
  window.AudioEngine?.init?.();
  csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══ 4. TARGETING — the gun-pass reticle deck ══════════════════════════════════
// Steer the pipper onto a jinking ground target (move the pointer, or WASD/arrows),
// hold it there to build LOCK, then FIRE. Skill widens the lock gate + slows the
// target's jink; the AA's accuracy tightens it. Reports { won } → `strafresolve`.
export function openTargeting(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 6, deviceName: 'TARGET', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const lockRadius = clampNum(0.16 + edge * 0.014, 0.08, 0.28);   // how close counts as on-target
  const jink = clampNum(0.5 + o.difficulty * 0.06 - o.skill * 0.02, 0.3, 1.4);
  const lockRate = clampNum(0.55 + edge * 0.04, 0.3, 1.0);
  const TIME = 8;

  let ret = { x: 0.5, y: 0.5 }, tgt = { x: 0.5, y: 0.28 }, tgtT = 0, lock = 0, locked = false;
  let t0 = 0, over = false, raf = 0, last = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 220 220" preserveAspectRatio="xMidYMid meet" id="ck-tgt-svg">
    <defs><radialGradient id="ck-tgt-bg" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#06202a"/><stop offset="1" stop-color="#01080c"/></radialGradient></defs>
    <rect x="8" y="8" width="204" height="204" rx="10" fill="url(#ck-tgt-bg)" stroke="#22465a" stroke-width="2"/>
    ${[40, 70, 100].map(r => `<circle cx="110" cy="110" r="${r}" fill="none" stroke="#1c3a4a" stroke-width="1"/>`).join('')}
    <line x1="110" y1="14" x2="110" y2="206" stroke="#153040" stroke-width="1"/>
    <line x1="14" y1="110" x2="206" y2="110" stroke="#153040" stroke-width="1"/>
    <!-- target -->
    <g id="ck-tgt"><rect x="-9" y="-9" width="18" height="18" fill="none" stroke="#ff8a3e" stroke-width="2"/><circle cx="0" cy="0" r="2.5" fill="#ff8a3e"/></g>
    <!-- reticle -->
    <g id="ck-ret"><circle cx="0" cy="0" r="16" fill="none" stroke="#4fb8e0" stroke-width="1.5"/>
      <line x1="-22" y1="0" x2="-8" y2="0" stroke="#4fb8e0" stroke-width="2"/><line x1="8" y1="0" x2="22" y2="0" stroke="#4fb8e0" stroke-width="2"/>
      <line x1="0" y1="-22" x2="0" y2="-8" stroke="#4fb8e0" stroke-width="2"/><line x1="0" y1="8" x2="0" y2="22" stroke="#4fb8e0" stroke-width="2"/></g>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#127919;', 'TARGETING', 'GUN PASS &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-hud2"><span>TGT <b>${esc(o.deviceName)}</b></span><span class="ck-asi-wrap">LOCK <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-lock" style="background:linear-gradient(90deg,#7a5310,#ffb23e)"></span></span></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr mg-screen" style="--mg-sweep-h:220px">${scr}${crtOverlays()}</div></div>
    ${deckStrip('GUN BUS', 'LOCK')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">Move the pipper onto the target and hold it to LOCK — then FIRE (space / click).</span></div>
    <div class="ck-actions"><button class="ck-btn ck-btn-fire">Fire &#9251;</button><button class="ck-btn ck-btn-abort">Break Off</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay;
  const svg = overlay.querySelector('#ck-tgt-svg');
  const setStatus = (h) => { const el = overlay.querySelector('#ck-status'); if (el) el.innerHTML = h; };

  const finish = (won) => {
    if (over) return; over = true;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-guns' : 'flight-abort', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ SPLASH — target destroyed.</span>' : '<span class="ck-lose">✕ No hits — you overfly the target.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 950);
  };
  const fire = () => { if (over) return; if (locked) finish(true); else finish(false); };

  const svgXY = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: clampNum((e.clientX - r.left) / r.width, 0, 1), y: clampNum((e.clientY - r.top) / r.height, 0, 1) };
  };
  add(svg, 'pointermove', (e) => { ret = svgXY(e); });
  add(window, 'keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') ret.x = clampNum(ret.x - 0.05, 0, 1);
    else if (k === 'arrowright' || k === 'd') ret.x = clampNum(ret.x + 0.05, 0, 1);
    else if (k === 'arrowup' || k === 'w') ret.y = clampNum(ret.y - 0.05, 0, 1);
    else if (k === 'arrowdown' || k === 's') ret.y = clampNum(ret.y + 0.05, 0, 1);
    else if (k === ' ' || k === 'spacebar') { e.preventDefault(); fire(); }
  });
  overlay.querySelector('.ck-btn-fire').addEventListener('click', fire);
  overlay.querySelector('.ck-btn-abort').addEventListener('click', () => finish(false));
  overlay.querySelector('.mg-close').addEventListener('click', () => finish(false));

  const tick = (t) => {
    if (over) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    if (!t0) t0 = t;
    // Target jinks toward wandering waypoints.
    tgtT -= dt;
    if (tgtT <= 0) { tgt.tx = 0.2 + Math.random() * 0.6; tgt.ty = 0.15 + Math.random() * 0.5; tgtT = 0.4 + Math.random() / jink; }
    tgt.x += ((tgt.tx ?? 0.5) - tgt.x) * Math.min(1, jink * dt * 2);
    tgt.y += ((tgt.ty ?? 0.3) - tgt.y) * Math.min(1, jink * dt * 2);
    const d = Math.hypot(ret.x - tgt.x, ret.y - tgt.y);
    const on = d <= lockRadius;
    lock = clampNum(lock + (on ? lockRate : -lockRate * 1.3) * dt, 0, 1);
    const wasLocked = locked;
    locked = lock >= 1;
    if (locked && !wasLocked) csfx('flight-lock');
    // Render (viewBox 0..220 with 8px inset → map 0..1 onto 14..206).
    const px = (v) => 14 + v * 192;
    overlay.querySelector('#ck-ret').setAttribute('transform', `translate(${px(ret.x)} ${px(ret.y)})`);
    overlay.querySelector('#ck-tgt').setAttribute('transform', `translate(${px(tgt.x)} ${px(tgt.y)})`);
    overlay.querySelector('#ck-ret').style.stroke = locked ? '#46e05a' : on ? '#ffb23e' : '#4fb8e0';
    overlay.querySelector('#ck-lock').style.width = `${Math.round(lock * 100)}%`;
    setDeckLevel(overlay, lock);
    if (locked) { setStatus('<span style="color:#46e05a">LOCK — FIRE!</span>'); if (!over) csfx('flight-lock'); }
    if ((t - t0) / 1000 >= TIME) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.();
  csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}
