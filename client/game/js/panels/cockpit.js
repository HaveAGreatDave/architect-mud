// COCKPIT — the flight instrument panel + the flight minigame decks.
//
// This is the showpiece surface of the game. While you're aboard, the top area
// pane becomes a live, animated glass cockpit: a brushed-metal-and-glass panel
// carrying an artificial horizon, an expanded heading-up RADAR, per-engine
// temperature gauges (run these up before you roll), a compass that spins to your
// heading, the real minimap, and digital dials — all eased every frame by a local
// requestAnimationFrame loop, not just snapped on each server tick. Engine drone,
// slipstream, and airframe creaks come from engine-audio.js.
//
// Decks (focused overlays, server-authoritative): openTakeoff / openGlideslope /
// openTargeting report { won } → the server resolve command decides the outcome.

import { setAreaPane } from '../render.js';
import { sfx, clampInt, clampNum, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { updateEngineAudio, stopEngineAudio, creak, spoolUp, spoolDown, groundFx, flapWhir, stallHorn } from './engine-audio.js';
import { ensureWindshieldStyles, windshieldHTML, paintWindshield, disposeWindshield, RENDER_TUNE } from './windshield.js';
import { createState, step, readout, TYPES } from './flight-model.js';
import { sendCmdSilent } from '../net.js';

// Theme accent for the canvas-drawn instruments (the CSS chrome uses var(--accent)
// directly; canvas can't, so we sample it once when the cockpit opens).
let ACCENT = '#8fd0ff', ACCENT_RGB = [143, 208, 255];
function refreshAccent() {
  try {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (c) { ACCENT = c; const m = c.match(/^#?([0-9a-fA-F]{6})$/); if (m) { const n = parseInt(m[1], 16); ACCENT_RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } }
  } catch {}
}
const accA = (a) => `rgba(${ACCENT_RGB[0]},${ACCENT_RGB[1]},${ACCENT_RGB[2]},${a})`;

function csfx(id, fallback) {
  const cat = window.SFXCatalog;
  if (cat && typeof cat.get === 'function' && cat.get(id)) sfx(id);
  else if (fallback) sfx(fallback);
}

const HDG_GLYPH = { n: '▲', ne: '◥', e: '▶', se: '◢', s: '▼', sw: '◣', w: '◀', nw: '◤' };
// Shortest signed angular delta a→b (deg), range −180..180.
function angDelta(a, b) { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

// Per-class cockpit theme — accent colour + chrome character. The LAYOUT itself
// is driven by capabilities (engines/hardpoints/cargo/VTOL/size); the theme sets
// the palette + a few flourishes so a gunship panel reads military-red while a
// heavy freighter reads industrial-amber and a wreck reads degraded.
const CLASS_THEME = {
  ultralight: { acc: '#7fd6ff', chrome: 'minimal',   radar: 'sm' },
  heli:       { acc: '#4fe0a0', chrome: 'rotor',      radar: 'md' },
  prop:       { acc: '#4fb8e0', chrome: 'analog',     radar: 'md' },
  heavy:      { acc: '#ffb23e', chrome: 'industrial', radar: 'lg' },
  gunship:    { acc: '#ff6b5b', chrome: 'military',    radar: 'lg' },
  wreck:      { acc: '#9bd06a', chrome: 'degraded',    radar: 'sm' },
};
const themeFor = (cls) => CLASS_THEME[cls] || CLASS_THEME.prop;

// ══════════════════════════════════════════════════════════════════════════════
// 1. THE GLASS COCKPIT (area-pane HUD)
// ══════════════════════════════════════════════════════════════════════════════

let _target = null;     // latest server state
let _prev = null;       // previous state (event detection)
let _anim = null;       // eased animation values
let _raf = 0;
let _sig = '';          // mounted layout signature (rebuild when capabilities change)
let _lastT = 0;

export function updateCockpit(state) {
  if (isFlightSimActive()) return;   // the continuous cockpit owns the pane — don't mount the glass HUD over it
  ensureHudStyles();
  _target = state || {};
  updateEngineAudio(_target);

  // Event-driven audio + creaks (compare to previous push).
  if (_prev) {
    if (_prev.bandIndex !== _target.bandIndex) creak('creak');
    if (Math.abs(angDelta(_prev.headingDeg || 0, _target.headingDeg || 0)) > 30) creak('creak');
    if (_target.warn === 'STALL' && _prev.warn !== 'STALL') creak('stress');
    if (_target.warn === 'WEATHER' && _prev.warn !== 'WEATHER') creak('gust');
    if (!_prev.runup && _target.runup) spoolUp(_target.class);           // start-up spool (per class)
    if (_prev.engineOn && !_target.engineOn) spoolDown(_target.class);   // shutdown spool-down
  } else if (_target.runup) spoolUp(_target.class);
  _prev = _target;

  // Rebuild the panel only when the aircraft's capability layout (or seat) changes.
  const sig = `${_target.seat}|${_target.class}|${_target.engines?.length || 1}|${(_target.hardpoints || 0) > 0}|${(_target.cargoCap || 0) > 0}|${!!_target.vtol}`;
  const root = document.getElementById('ck-hud-root');
  if (!root || _sig !== sig) { mountHud(_target); _sig = sig; }

  if (!_anim) _anim = { hdg: _target.headingDeg || 0, pitch: 0, roll: 0, sweep: 0, eng: _target.engines?.map(e => e.pct) || [0], fuel: _target.fuelPct || 0, thr: _target.throttle || 0, hull: _target.hullPct || 100, spd: _target.spd || 0 };
  if (!_raf) { _lastT = performance.now(); _raf = requestAnimationFrame(hudFrame); }
  applyText(_target);
}

export function closeCockpit() {
  closeFlightSim();       // the continuous cockpit, if it owns the pane
  if (_raf) cancelAnimationFrame(_raf); _raf = 0;
  _anim = null; _prev = null; _sig = '';
  stopEngineAudio();
}

// ── The per-frame animation loop ──────────────────────────────────────────────
function hudFrame(t) {
  const root = document.getElementById('ck-hud-root');
  if (!root || !_target) { _raf = 0; return; }
  const dt = Math.min(0.05, (t - _lastT) / 1000 || 0); _lastT = t;
  const s = _target, a = _anim;

  // Heading — ease along the shortest arc (the compass "spins" to the bearing).
  const hd = angDelta(a.hdg, s.headingDeg || 0);
  const turnRate = hd * Math.min(1, dt * 3.2);
  a.hdg = (a.hdg + turnRate + 360) % 360;
  // Bank into the turn; level out when settled.
  const targetRoll = clampNum(hd * 0.5, -22, 22);
  a.roll += (targetRoll - a.roll) * Math.min(1, dt * 4);
  // Pitch from altitude band (climb attitude higher up).
  const targetPitch = s.airborne ? ((s.bandIndex ?? 1) - 1) * 8 : 0;
  a.pitch += (targetPitch - a.pitch) * Math.min(1, dt * 3);
  a.sweep = (a.sweep + dt * 55) % 360;
  // Eased needles.
  a.fuel += ((s.fuelPct || 0) - a.fuel) * Math.min(1, dt * 4);
  a.thr += ((s.throttle || 0) - a.thr) * Math.min(1, dt * 6);
  a.hull += ((s.hullPct ?? 100) - a.hull) * Math.min(1, dt * 4);
  a.spd += ((s.spd || 0) - a.spd) * Math.min(1, dt * 4);
  const engs = s.engines || [{ pct: 0 }];
  for (let i = 0; i < engs.length; i++) { a.eng[i] = (a.eng[i] ?? 0) + ((engs[i].pct || 0) - (a.eng[i] ?? 0)) * Math.min(1, dt * 3); }

  paintADI(a, s);
  paintRadar(a, s);
  paintCompass(a, s);
  paintEngines(a, s);
  paintDials(a, s);
  paintWindow('ck-ws', a, s);
  _raf = requestAnimationFrame(hudFrame);
}

// The out-the-front-window view — driven from the same eased HUD state. The
// passenger looks out the SIDE through a window shaped to their aircraft.
function paintWindow(id, a, s) {
  if (!document.getElementById(id)) return;
  const heightFrac = s.airborne ? clampNum((s.bandIndex || 0) / 3, 0, 1) : 0;
  const speedFrac = clampNum((a.spd || 0) / 200, 0, 1);
  const pax = s.seat === 'passenger';
  paintWindshield(id, {
    pitch: a.pitch, bank: a.roll, height: heightFrac, speed: speedFrac,
    hour: s.sky?.hour, weather: s.sky?.weather, wind: s.sky?.wind, heading: a.hdg,
    map: s.map, phase: s.airborne ? 'cruise' : 'ground',
    airport: s.ground?.theme, biomeBelow: s.biomeBelow,
    side: pax, windowClass: pax ? (s.class || 'prop') : undefined,
  });
}

const $ = (id) => document.getElementById(id);

// ── Instruments ───────────────────────────────────────────────────────────────
function paintADI(a, s) {
  const g = $('ck-adi-h'); if (g) g.setAttribute('transform', `translate(0 ${a.pitch * 2.2}) rotate(${-a.roll} 100 100)`);
  const bank = $('ck-adi-bank'); if (bank) bank.setAttribute('transform', `rotate(${-a.roll} 100 100)`);
}
function paintRadar(a, s) {
  const world = $('ck-radar-world');
  if (world) world.setAttribute('transform', `rotate(${-a.hdg} 130 130)`);
  const sweep = $('ck-radar-sweep'); if (sweep) sweep.setAttribute('transform', `rotate(${a.sweep} 130 130)`);
  // Fuel guide arrow → bearing to nearest field, in the heading-up frame.
  const guide = $('ck-radar-guide');
  if (guide) {
    if (s.guide) { guide.style.display = ''; guide.setAttribute('transform', `rotate(${angDelta(a.hdg, s.guide.bearing)} 130 130)`); }
    else guide.style.display = 'none';
  }
}
function paintCompass(a, s) {
  const card = $('ck-compass-card'); if (card) card.setAttribute('transform', `rotate(${-a.hdg} 60 60)`);
}
function paintEngines(a, s) {
  const engs = s.engines || [];
  for (let i = 0; i < engs.length; i++) {
    const fill = $(`ck-eng-fill-${i}`); if (fill) { const h = (a.eng[i] ?? 0) / 100 * 96; fill.setAttribute('y', 118 - h); fill.setAttribute('height', h); fill.setAttribute('fill', engs[i].stable ? '#46e05a' : (a.eng[i] > 62 ? '#ff5b5b' : '#ffb23e')); }
    const nd = $(`ck-eng-need-${i}`); if (nd) nd.setAttribute('y', 118 - (a.eng[i] ?? 0) / 100 * 96);
  }
}
function paintDials(a, s) {
  setSeven('ck-d-fuel', Math.round(a.fuel), s.fuelPct <= 20 ? 'r' : s.fuelPct <= 40 ? 'a' : 'g');
  setSeven('ck-d-thr', Math.round(a.thr), 'c');
  setSeven('ck-d-hull', Math.round(a.hull), s.hullPct <= 25 ? 'r' : s.hullPct <= 55 ? 'a' : 'g');
  setSeven('ck-d-spd', Math.round(a.spd), 'c');
}
function setSeven(id, val, tone) {
  const el = $(id); if (!el) return;
  el.textContent = String(val).padStart(3, '0');
  el.className = `ck-seg ck-seg-${tone}`;
}

// ── Text/structural updates (only on server push, not per-frame) ──────────────
function applyText(s) {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const html = (id, v) => { const e = $(id); if (e) e.innerHTML = v; };
  // Passenger cabin strip (present only in the passenger layout).
  if ($('ck-pax-dest')) {
    set('ck-pax-dest', s.surface || (s.airborne ? 'in flight' : 'on the ramp'));
    set('ck-pax-alt', s.bandLabel || 'GND');
    set('ck-pax-spd', String(s.spd || 0));
    set('ck-pax-hdg', String(s.headingDeg ?? 0).padStart(3, '0') + '°');
  }
  set('ck-hdg-num', String(s.headingDeg ?? 0).padStart(3, '0') + '°');
  set('ck-hdg-card', (s.heading || 'n').toUpperCase());
  set('ck-alt-band', s.bandLabel || 'GND');
  set('ck-surface', s.surface || (s.airborne ? 'open air' : '—'));
  set('ck-tail', s.tail || 'CRAFT');
  set('ck-class', (s.class || '').toUpperCase());
  // Status line + phase.
  const phase = !s.airborne
    ? (s.runup ? '<span class="ck-amber">RUN-UP — warming engines</span>' : s.engineOn ? '<span class="ck-green">READY — throttle up &amp; takeoff</span>' : '<span class="ck-dim">COLD — startup to begin</span>')
    : s.enginesStable === false && s.warn === 'FIRE' ? '<span class="ck-red">ENGINE FIRE</span>'
    : `AIRBORNE · ${s.bandLabel}`;
  html('ck-phase', phase);
  // Guide label.
  html('ck-guide-label', s.guide ? `<span class="ck-amber">◈ ${esc(s.guide.name)} ${String(s.guide.bearing).padStart(3, '0')}° · ${s.guide.dist}mi</span>` : '');
  // Warning strip.
  const warnEl = $('ck-warn');
  if (warnEl) {
    const W = { STARVATION: ['ENGINE OUT — DEAD STICK — LAND NOW', 'r'], BINGO: ['BINGO FUEL — DIVERT', 'a'],
      STALL: ['STALL — RECOVER', 'r'], FIRE: ['ENGINE FIRE — EXTINGUISH', 'r'], WEATHER: ['SEVERE TURBULENCE', 'a'] };
    const w = W[s.warn];
    warnEl.style.display = w ? '' : 'none';
    if (w) { warnEl.textContent = '⚠ ' + w[0]; warnEl.className = `ck-warn ck-warn-${w[1]}`; }
  }
  // Armed pip.
  const arm = $('ck-arm'); if (arm) { arm.style.display = s.hardpoints > 0 ? '' : 'none'; arm.textContent = s.armed ? '● ARMED' : '○ SAFE'; arm.className = s.armed ? 'ck-pip ck-red' : 'ck-pip ck-dim'; }
  // Cargo pip.
  const cargo = $('ck-cargo'); if (cargo) { cargo.style.display = s.cargo > 0 ? '' : 'none'; cargo.textContent = `⬒ ${s.cargo}/${s.maxTOW}kg`; }
  // Capability panels (present only on craft that have them).
  const wa = $('ck-wpn-arm'); if (wa) { wa.textContent = s.armed ? '● ARMED' : '○ SAFE'; wa.className = s.armed ? 'ck-wpn-arm ck-red' : 'ck-wpn-arm ck-dim'; }
  const lf = $('ck-load-fill');
  if (lf) {
    const cap = s.cargoCap || 1, frac = (s.cargo || 0) / cap;
    lf.style.width = `${Math.min(100, frac * 100)}%`;
    lf.style.background = s.cargo > s.maxTOW ? '#ff5b5b' : frac > 1 ? '#ffb23e' : 'var(--acc)';
    const lt = $('ck-load-txt'); if (lt) lt.innerHTML = `${s.cargo || 0} / ${cap} kg${s.cargo > s.maxTOW ? ' <span class="ck-red">⚠ OVER</span>' : ''}`;
  }
  const hl = $('ck-hover-lamp'); if (hl) { hl.classList.toggle('ck-lit', !!s.hover); hl.textContent = s.hover ? 'HOVER' : (s.airborne ? 'FWD' : 'GND'); }
  const vn = $('ck-vsi-need'); if (vn) { const yy = 91 - (s.bandIndex || 0) * 27; vn.setAttribute('points', `14,${yy} 26,${yy - 5} 26,${yy + 5}`); }
  // Real minimap + radar blips (refresh each push; the layer is rotated per-frame).
  renderMini(s.minimap);
  paintRadarWorld(s);
  // Engine labels/stable state.
  (s.engines || []).forEach((e, i) => { const lbl = $(`ck-eng-lbl-${i}`); if (lbl) { lbl.textContent = e.stable ? 'OK' : (s.runup ? '···' : 'CHK'); lbl.setAttribute('fill', e.stable ? '#46e05a' : '#ffb23e'); } });
}

// The real minimap — actual surrounding zones (getMinimapData) with danger colour.
function renderMini(nodes) {
  const box = $('ck-mini'); if (!box) return;
  if (!nodes || !nodes.length) { box.innerHTML = '<div class="ck-mini-empty">— no ground contact —</div>'; return; }
  const cur = nodes.find(n => n.is_current) || nodes[0];
  if (cur.grid_x == null) { box.innerHTML = '<div class="ck-mini-empty">—</div>'; return; }
  let minx = 99, maxx = -99, miny = 99, maxy = -99;
  for (const n of nodes) { if (n.grid_x == null) continue; minx = Math.min(minx, n.grid_x); maxx = Math.max(maxx, n.grid_x); miny = Math.min(miny, n.grid_y); maxy = Math.max(maxy, n.grid_y); }
  const byXY = new Map(nodes.filter(n => n.grid_x != null).map(n => [`${n.grid_x},${n.grid_y}`, n]));
  const danger = (d) => d >= 5 ? '#ff5b5b' : d >= 3 ? '#ffb23e' : d >= 1 ? '#8fd0ff' : '#46e05a';
  let rows = '';
  for (let y = miny; y <= maxy; y++) {
    let cells = '';
    for (let x = minx; x <= maxx; x++) {
      const n = byXY.get(`${x},${y}`);
      if (!n) { cells += '<span class="ck-mini-c"></span>'; continue; }
      const isC = n.is_current;
      cells += `<span class="ck-mini-c" style="color:${isC ? '#ffcf3e' : danger(n.danger_rating || 0)}" title="${esc(n.name)}">${isC ? '◉' : (n.marker || '▪')}</span>`;
    }
    rows += `<div class="ck-mini-row">${cells}</div>`;
  }
  box.innerHTML = rows;
}

// ── Instrument builders (composed per aircraft) ───────────────────────────────
function adiInst() {
  return `<div class="ck-inst ck-inst-adi"><div class="ck-inst-lbl">ATTITUDE</div>
    <svg viewBox="0 0 200 200" class="ck-svg">
      <defs>
        <clipPath id="ck-adi-clip"><circle cx="100" cy="100" r="86"/></clipPath>
        <linearGradient id="ck-adi-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
        <linearGradient id="ck-adi-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f18"/><stop offset="1" stop-color="#2a1d0a"/></linearGradient>
        <radialGradient id="ck-glass" cx="34%" cy="24%" r="80%"><stop offset="0" stop-color="rgba(255,255,255,0.22)"/><stop offset="42%" stop-color="rgba(255,255,255,0.02)"/><stop offset="100%" stop-color="rgba(0,0,0,0.55)"/></radialGradient>
      </defs>
      <circle cx="100" cy="100" r="94" class="ck-bezel-ring"/>
      <g clip-path="url(#ck-adi-clip)"><g id="ck-adi-h">
        <rect x="-140" y="-160" width="480" height="260" fill="url(#ck-adi-sky)"/>
        <rect x="-140" y="100" width="480" height="260" fill="url(#ck-adi-gnd)"/>
        <line x1="-140" y1="100" x2="340" y2="100" stroke="#eaf6ff" stroke-width="2"/>
        ${[-3, -2, -1, 1, 2, 3].map(k => `<line x1="${100 - (4 - Math.abs(k)) * 7}" y1="${100 + k * 17}" x2="${100 + (4 - Math.abs(k)) * 7}" y2="${100 + k * 17}" stroke="rgba(255,255,255,0.5)" stroke-width="1.3"/>`).join('')}
      </g><rect x="6" y="6" width="188" height="188" fill="url(#ck-glass)"/></g>
      <g id="ck-adi-bank">${[-60, -30, -20, -10, 10, 20, 30, 60].map(deg => { const r = deg * Math.PI / 180; const inner = Math.abs(deg) % 30 === 0 ? 74 : 80; return `<line x1="${100 + Math.sin(r) * inner}" y1="${100 - Math.cos(r) * inner}" x2="${100 + Math.sin(r) * 86}" y2="${100 - Math.cos(r) * 86}" stroke="#8fd0ff" stroke-width="${Math.abs(deg) % 30 === 0 ? 2 : 1}"/>`; }).join('')}<polygon points="100,12 94,24 106,24" fill="#ffcf3e"/></g>
      <path d="M58,100 L86,100 M114,100 L142,100" stroke="#ffcf3e" stroke-width="4" stroke-linecap="round"/>
      <rect x="94" y="94" width="12" height="12" fill="none" stroke="#ffcf3e" stroke-width="2.5"/>
      <circle cx="100" cy="100" r="94" fill="none" class="ck-bezel-glass"/>
    </svg></div>`;
}
function radarInst(size) {
  return `<div class="ck-inst ck-inst-radar ck-radar-${size}"><div class="ck-inst-lbl">RADAR · HDG-UP</div>
    <svg viewBox="0 0 260 260" class="ck-svg">
      <circle cx="130" cy="130" r="126" class="ck-bezel-ring"/><circle cx="130" cy="130" r="118" fill="#03151b"/>
      ${[30, 60, 90, 118].map(r => `<circle cx="130" cy="130" r="${r}" fill="none" stroke="#0e3a44" stroke-width="1"/>`).join('')}
      <g id="ck-radar-world"></g>
      <g id="ck-radar-sweep"><path d="M130,130 L130,12 A118,118 0 0,1 210,44 Z" fill="url(#ck-sweepgrad)" opacity="0.5"/></g>
      <defs><linearGradient id="ck-sweepgrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(79,224,160,0.5)"/><stop offset="1" stop-color="rgba(79,224,160,0)"/></linearGradient></defs>
      <polygon points="130,116 122,142 130,136 138,142" fill="#ffcf3e"/><polygon points="130,8 124,18 136,18" fill="#8fd0ff"/>
      <g id="ck-radar-guide" style="display:none"><polygon points="130,26 122,44 130,38 138,44" fill="#ffb23e"><animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite"/></polygon></g>
      <circle cx="130" cy="130" r="126" fill="none" class="ck-bezel-glass"/>
    </svg><div class="ck-guide-label" id="ck-guide-label"></div></div>`;
}
function compassInst() {
  return `<div class="ck-inst ck-inst-compass"><div class="ck-inst-lbl">HDG</div>
    <svg viewBox="0 0 120 120" class="ck-svg">
      <circle cx="60" cy="60" r="56" class="ck-bezel-ring"/><circle cx="60" cy="60" r="50" fill="#04121a"/>
      <g id="ck-compass-card">${Array.from({ length: 12 }, (_, i) => { const deg = i * 30; const r = (deg - 90) * Math.PI / 180; const maj = deg % 90 === 0; const L = maj ? { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg] : (deg / 10); return `<line x1="${60 + Math.cos(r) * (maj ? 38 : 42)}" y1="${60 + Math.sin(r) * (maj ? 38 : 42)}" x2="${60 + Math.cos(r) * 48}" y2="${60 + Math.sin(r) * 48}" stroke="${maj ? '#8fd0ff' : '#3f6d8c'}" stroke-width="${maj ? 2 : 1}"/><text x="${60 + Math.cos(r) * 30}" y="${60 + Math.sin(r) * 30 + 3}" fill="${deg === 0 ? '#ff5b5b' : '#8fd0ff'}" font-size="${maj ? 10 : 7}" text-anchor="middle" font-family="monospace">${L}</text>`; }).join('')}</g>
      <polygon points="60,6 55,16 65,16" fill="#ffcf3e"/><circle cx="60" cy="60" r="56" fill="none" class="ck-bezel-glass"/>
    </svg><div class="ck-hdg-readout"><span id="ck-hdg-num" class="ck-seg ck-seg-c">000°</span><span id="ck-hdg-card" class="ck-hdg-card">N</span></div></div>`;
}
function engInst(n) {
  const bars = Array.from({ length: n }, (_, i) => `<g transform="translate(${18 + i * 30} 0)">
      <rect x="0" y="20" width="20" height="100" rx="3" class="ck-eng-tube"/><rect x="2" y="24" width="16" height="${96 * 0.72}" class="ck-eng-band"/>
      <rect id="ck-eng-fill-${i}" x="2" y="118" width="16" height="0" fill="#ffb23e"/><line id="ck-eng-need-${i}" x1="0" y1="118" x2="20" y2="118" stroke="#fff" stroke-width="1.4"/>
      <text x="10" y="134" id="ck-eng-lbl-${i}" fill="#ffb23e" font-size="9" text-anchor="middle" font-family="monospace">···</text>
      <text x="10" y="15" fill="#5f8299" font-size="8" text-anchor="middle" font-family="monospace">${n > 1 ? i + 1 : 'ENG'}</text></g>`).join('');
  return `<div class="ck-inst ck-inst-eng"><div class="ck-inst-lbl">${n > 1 ? n + '× ENGINE' : 'ENGINE'} TEMP</div><svg viewBox="0 0 ${18 + n * 30 + 6} 140" class="ck-svg">${bars}</svg></div>`;
}
function miniInst() {
  return `<div class="ck-inst ck-inst-mini"><div class="ck-inst-lbl">MAP</div>
    <div class="ck-mini" id="ck-mini"><div class="ck-mini-empty">—</div></div>
    <div class="ck-surface-row">⌖ <b id="ck-surface">—</b> · <span id="ck-alt-band">GND</span></div></div>`;
}
function hoverInst() {   // VTOL: a vertical altitude tape + HOVER lamp
  return `<div class="ck-inst ck-inst-hover"><div class="ck-inst-lbl">VERT</div>
    <svg viewBox="0 0 64 130" class="ck-svg">
      <rect x="26" y="10" width="12" height="108" rx="3" class="ck-eng-tube"/>
      ${[10, 37, 64, 91, 118].map((y, i) => `<line x1="20" y1="${y}" x2="44" y2="${y}" stroke="#2b4a60" stroke-width="1"/><text x="48" y="${y + 3}" fill="#5f8299" font-size="7" font-family="monospace">${['HI', 'CR', 'LO', 'GND', ''][i] || ''}</text>`).join('')}
      <polygon id="ck-vsi-need" points="14,118 26,113 26,123" fill="#4fe0a0"/>
    </svg><div class="ck-hover-lamp" id="ck-hover-lamp">HOVER</div></div>`;
}
function wpnInst(hp) {
  return `<div class="ck-inst ck-inst-wpn"><div class="ck-inst-lbl">ARMAMENT</div>
    <div class="ck-wpn-arm ck-dim" id="ck-wpn-arm">○ SAFE</div>
    <div class="ck-wpn-pips" id="ck-wpn-pips">${'◆'.repeat(hp)}</div>
    <div class="ck-wpn-note">${hp} HARDPOINT${hp > 1 ? 'S' : ''}</div></div>`;
}
function cargoInst() {
  return `<div class="ck-inst ck-inst-cargo"><div class="ck-inst-lbl">LOAD · W&amp;B</div>
    <div class="ck-load"><div class="ck-load-fill" id="ck-load-fill"></div></div>
    <div class="ck-load-txt" id="ck-load-txt">0 kg</div></div>`;
}

// ── The passenger cabin: a big window + a slim readout strip, nothing to fly ──
function mountPassenger(s) {
  const th = themeFor(s.class);
  const html = `<div id="ck-hud-root" class="ck-hud ck-pax ck-chrome-${th.chrome}" style="--acc:${th.acc}">
    <div class="ck-titlebar">
      <span class="ck-tmark">✈</span><span class="ck-t-name" id="ck-tail">CABIN</span>
      <span class="ck-t-class" id="ck-class"></span>
      <span class="ck-phase" id="ck-phase">Enjoy the flight.</span>
    </div>
    <div class="ck-pax-window">${windshieldHTML('ck-ws', 'CABIN WINDOW')}</div>
    <div class="ck-pax-strip">
      <span>◈ <b id="ck-pax-dest">—</b></span>
      <span>ALT <b id="ck-pax-alt">GND</b></span>
      <span>SPD <b id="ck-pax-spd">0</b> kt</span>
      <span>HDG <b id="ck-pax-hdg">000°</b></span>
    </div>
    <div class="ck-warn" id="ck-warn" style="display:none"></div>
  </div>`;
  setAreaPane(html);
}

// ── Compose the DOM from the aircraft's capabilities + size ───────────────────
function mountHud(s) {
  ensureWindshieldStyles();
  if (s.seat === 'passenger') return mountPassenger(s);
  const n = Math.max(1, s.engines?.length || 1);
  const th = themeFor(s.class);
  const hasWpn = (s.hardpoints || 0) > 0, hasCargo = (s.cargoCap || 0) > 0, isVtol = !!s.vtol;

  // Row 2: compass + engines, plus a hover tape for VTOL.
  const row2 = [compassInst(), engInst(n), isVtol ? hoverInst() : ''].filter(Boolean).join('');
  // Row 3: the minimap, plus capability panels (cargo / weapons).
  const row3 = [miniInst(), hasCargo ? cargoInst() : '', hasWpn ? wpnInst(s.hardpoints) : ''].filter(Boolean).join('');

  const html = `<div id="ck-hud-root" class="ck-hud ck-chrome-${th.chrome}" style="--acc:${th.acc}">
    <div class="ck-titlebar">
      <span class="ck-tmark">✈</span><span class="ck-t-name" id="ck-tail">CRAFT</span>
      <span class="ck-t-class" id="ck-class"></span>
      <span class="ck-phase" id="ck-phase"></span>
      <span class="ck-pip ck-dim" id="ck-arm" style="display:none"></span>
      <span class="ck-pip ck-dim" id="ck-cargo" style="display:none"></span>
    </div>
    <div class="ck-canopy">${windshieldHTML('ck-ws', 'FWD VIEW')}</div>
    <div class="ck-grid">
      <div class="ck-row ck-row-top">${adiInst()}${radarInst(th.radar)}</div>
      <div class="ck-row">${row2}</div>
      <div class="ck-row">${row3}</div>
    </div>
    <div class="ck-dials">
      <div class="ck-dial"><div class="ck-dial-lbl">FUEL</div><div class="ck-seg ck-seg-g" id="ck-d-fuel">000</div><div class="ck-dial-u">%</div></div>
      <div class="ck-dial"><div class="ck-dial-lbl">THR</div><div class="ck-seg ck-seg-c" id="ck-d-thr">000</div><div class="ck-dial-u">%</div></div>
      <div class="ck-dial"><div class="ck-dial-lbl">HULL</div><div class="ck-seg ck-seg-g" id="ck-d-hull">100</div><div class="ck-dial-u">%</div></div>
      <div class="ck-dial"><div class="ck-dial-lbl">ASPD</div><div class="ck-seg ck-seg-c" id="ck-d-spd">000</div><div class="ck-dial-u">kt</div></div>
    </div>
    <div class="ck-warn" id="ck-warn" style="display:none"></div>
  </div>`;
  setAreaPane(html);
  paintRadarWorld(s);
}

// Radar blips: land/field/nofly cells from the coarse map window, plotted N-up
// (the parent group is rotated to heading-up each frame).
function paintRadarWorld(s) {
  const g = $('ck-radar-world'); if (!g) return;
  if (!s.map) { g.innerHTML = ''; return; }
  const R = (s.map.length - 1) / 2, step = 108 / (R + 0.5);
  let out = '';
  for (let ry = 0; ry < s.map.length; ry++) for (let rx = 0; rx < s.map[ry].length; rx++) {
    const cell = s.map[ry][rx]; if (cell.kind === 'air' || cell.kind === 'craft') continue;
    const cx = 130 + (rx - R) * step, cy = 130 + (ry - R) * step;
    if (cell.kind === 'field') out += `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="none" stroke="#46e05a" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="1.5" fill="#46e05a"/>`;
    else if (cell.kind === 'nofly') out += `<path d="M${cx - 4},${cy - 4} L${cx + 4},${cy + 4} M${cx + 4},${cy - 4} L${cx - 4},${cy + 4}" stroke="#ff5b5b" stroke-width="1.5"/>`;
    else out += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="#2f6d4a"/>`;
  }
  g.innerHTML = out;
}

function ensureHudStyles() {
  if (document.getElementById('cockpit-hud-styles')) return;
  const st = document.createElement('style'); st.id = 'cockpit-hud-styles';
  st.textContent = `
    /* Fill the whole top pane and scale with it — the HUD is a flex column whose
       instrument grid grows to eat all available height. */
    #area-content:has(.ck-hud) { height:100%; }
    .ck-hud { --acc:#4fb8e0; font-family:'Courier New',monospace; color:#a9d4ec; padding:6px;
      height:100%; box-sizing:border-box; display:flex; flex-direction:column; overflow:hidden;
      background:
        linear-gradient(180deg, rgba(90,110,130,0.10), transparent 30%),
        repeating-linear-gradient(102deg, #20272e 0px, #20272e 2px, #262e37 3px, #20272e 4px),
        linear-gradient(160deg, #232b33, #12171c 60%, #0a0e12);
      border:1px solid #05080b; border-radius:8px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 40px rgba(0,0,0,0.6); }
    .ck-titlebar { display:flex; align-items:center; gap:10px; padding:2px 6px 6px; border-bottom:1px solid #2a3540; letter-spacing:1px; font-size:12px; }
    .ck-tmark { color:var(--acc); text-shadow:0 0 10px rgba(79,184,224,0.8); animation:ck-br 3.2s ease-in-out infinite; }
    @keyframes ck-br { 50% { text-shadow:0 0 18px rgba(79,184,224,1); } }
    .ck-t-name { color:#eaf6ff; font-weight:bold; letter-spacing:2px; }
    .ck-t-class { color:#5f8299; font-size:10px; }
    .ck-phase { margin-left:auto; font-size:11px; letter-spacing:1px; }
    .ck-pip { font-size:10px; padding:1px 6px; border:1px solid #2a3540; border-radius:3px; background:rgba(0,0,0,0.3); }
    /* Out-the-window canopy band (pilot) — sits above the instrument grid. */
    .ck-canopy { flex:1.15 1 0; min-height:82px; margin:8px 2px 0; }
    .ck-canopy .ws-wrap { height:100%; }
    /* Passenger cabin: the window IS the panel. */
    .ck-pax .ck-pax-window { flex:1 1 auto; min-height:0; margin:8px 4px 0; }
    .ck-pax .ck-pax-window .ws-wrap { height:100%; }
    .ck-pax-strip { display:flex; justify-content:space-around; gap:10px; padding:8px 6px 4px; font-size:11px; letter-spacing:1px; color:#7fae99; }
    .ck-pax-strip b { color:#eaf6ff; }
    /* Capability-driven flex layout: rows of instrument cards. Which cards exist,
       and the radar's size, are chosen per aircraft in mountHud(). */
    .ck-grid { display:flex; flex-direction:column; gap:8px; padding:8px 2px 2px; flex:1 1 auto; min-height:0; }
    .ck-row { display:flex; gap:8px; align-items:stretch; flex:1 1 0; min-height:0; }
    .ck-row-top { flex:1.5 1 0; }
    .ck-row-top .ck-inst-adi { flex:1 1 40%; }
    .ck-row > .ck-inst { flex:1 1 0; min-width:0; }
    .ck-radar-sm { flex:1.1 1 0 !important; } .ck-radar-md { flex:1.5 1 0 !important; } .ck-radar-lg { flex:2 1 0 !important; }
    .ck-inst { position:relative; padding:6px; border-radius:8px; display:flex; flex-direction:column; min-height:0;
      background:linear-gradient(160deg, #2a333c, #161c22 70%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.5); }
    .ck-inst-lbl { position:absolute; top:5px; left:9px; font-size:8px; letter-spacing:2px; color:#5f8299; z-index:2; }
    /* SVG instruments scale to fill their card (aspect preserved via viewBox meet). */
    .ck-svg { display:block; width:100%; height:100%; flex:1 1 0; min-height:0; }
    .ck-inst-radar .ck-svg { max-height:none; }
    .ck-inst-mini, .ck-inst-cargo, .ck-inst-wpn { justify-content:center; }
    .ck-bezel-ring { fill:none; stroke:#39434d; stroke-width:6; filter:drop-shadow(0 1px 1px rgba(0,0,0,0.7)); }
    .ck-bezel-glass { stroke:rgba(180,220,255,0.10); stroke-width:2; }
    .ck-eng-tube { fill:#0a1620; stroke:#2b4a60; stroke-width:1; }
    .ck-eng-band { fill:rgba(70,224,90,0.14); }
    .ck-green,.ck-seg-g { color:#46e05a; } .ck-amber,.ck-seg-a { color:#ffb23e; } .ck-red,.ck-seg-r { color:#ff5b5b; } .ck-seg-c { color:#4fb8e0; } .ck-dim { color:#5f8299; }
    /* Digital seven-segment style */
    .ck-seg { font-family:'Courier New',monospace; font-weight:bold; letter-spacing:3px; font-size:18px;
      text-shadow:0 0 8px currentColor, 0 0 2px currentColor; background:#050b0f; padding:2px 6px; border-radius:3px;
      border:1px solid #1a2730; box-shadow:inset 0 0 8px rgba(0,0,0,0.9); }
    .ck-hdg-readout { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:4px; }
    .ck-hdg-card { color:#eaf6ff; font-weight:bold; letter-spacing:1px; }
    .ck-mini { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; padding:14px 4px 2px; min-height:70px; background:#04121c; border-radius:5px; box-shadow:inset 0 0 16px rgba(0,0,0,0.7); }
    .ck-mini-row { display:flex; line-height:1.1; }
    .ck-mini-c { width:13px; text-align:center; font-size:12px; }
    .ck-mini-empty { color:#3f5666; font-size:10px; letter-spacing:1px; }
    .ck-surface-row { text-align:center; font-size:10px; color:#7fae99; padding:4px 2px 0; letter-spacing:1px; }
    .ck-surface-row b { color:#a9e6c6; }
    .ck-guide-label { text-align:center; font-size:10px; letter-spacing:1px; min-height:13px; padding-top:2px; }
    .ck-dials { display:flex; gap:8px; padding:8px 4px 2px; justify-content:space-between; }
    .ck-dial { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px;
      border-radius:6px; background:linear-gradient(160deg, #2a333c, #12171c);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 5px rgba(0,0,0,0.5); }
    .ck-dial-lbl { font-size:8px; letter-spacing:2px; color:#5f8299; }
    .ck-dial-u { font-size:8px; color:#5f8299; }
    .ck-warn { margin:6px 2px 0; padding:5px; text-align:center; font-weight:bold; letter-spacing:1px; border-radius:5px;
      background:rgba(255,91,91,0.10); animation:ck-fl 1s steps(2) infinite; }
    .ck-warn-a { color:#ffb23e; background:rgba(255,178,62,0.10); } .ck-warn-r { color:#ff5b5b; }
    @keyframes ck-fl { 50% { opacity:0.4; } }
    /* Capability panels (present only on craft that carry them) */
    .ck-inst-hover { flex:0.5 1 0 !important; }
    .ck-hover-lamp { text-align:center; font-size:9px; letter-spacing:2px; margin-top:2px; color:#5f8299; border:1px solid #223; border-radius:3px; padding:1px; }
    .ck-hover-lamp.ck-lit { color:#04101a; background:#4fe0a0; border-color:#4fe0a0; }
    .ck-inst-wpn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; }
    .ck-wpn-arm { font-size:15px; font-weight:bold; letter-spacing:2px; text-shadow:0 0 8px currentColor; }
    .ck-wpn-pips { letter-spacing:4px; font-size:16px; color:#ff6b5b; text-shadow:0 0 8px rgba(255,107,91,0.7); }
    .ck-wpn-note { font-size:8px; letter-spacing:2px; color:#5f8299; }
    .ck-inst-cargo { display:flex; flex-direction:column; justify-content:center; gap:6px; }
    .ck-load { height:16px; background:#0a1620; border:1px solid #2b4a60; border-radius:4px; overflow:hidden; box-shadow:inset 0 0 8px rgba(0,0,0,0.8); }
    .ck-load-fill { height:100%; width:0%; background:var(--acc); transition:width .3s, background .3s; }
    .ck-load-txt { text-align:center; font-size:11px; letter-spacing:1px; color:#a9d4ec; }
    /* Accent-driven bits so each class palette reads through */
    .ck-tmark { color:var(--acc) !important; }
    .ck-seg-c { color:var(--acc); }
    /* Per-class chrome flourishes */
    .ck-chrome-military .ck-titlebar { border-bottom-color:#5a2a2a; }
    .ck-chrome-military .ck-inst-radar { box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(0,0,0,0.5), 0 0 14px rgba(255,107,91,0.18); }
    .ck-chrome-industrial .ck-inst { border-left:2px solid rgba(255,178,62,0.28); }
    .ck-chrome-minimal .ck-inst { background:linear-gradient(160deg,#242c33,#141a1f 70%); }
    .ck-chrome-minimal .ck-titlebar::after { content:'ULTRALIGHT · MINIMAL PANEL'; margin-left:6px; font-size:9px; letter-spacing:2px; color:#3f5666; }
    .ck-chrome-rotor .ck-inst-hover { flex:0.6 1 0 !important; }
    /* Wreck: salvaged, degraded avionics — flicker + desaturation + a warning tag */
    .ck-chrome-degraded .ck-inst { animation:ck-glitch 5s infinite steps(60); filter:saturate(0.55) contrast(0.92) brightness(0.95); }
    .ck-chrome-degraded .ck-inst-adi { position:relative; }
    .ck-chrome-degraded .ck-inst-adi::after { content:'⚠ AVIONICS DEGRADED'; position:absolute; inset:auto 0 8px 0; text-align:center; font-size:9px; letter-spacing:2px; color:#ffb23e; text-shadow:0 0 6px rgba(0,0,0,0.9); }
    .ck-chrome-degraded .ck-titlebar { border-bottom-color:#4a5a2a; }
    @keyframes ck-glitch { 0%,90%,100%{opacity:1} 92%{opacity:0.72} 94%{opacity:1} 96%{opacity:0.85} }
    @media (max-width:560px) { .ck-row { flex-wrap:wrap; } .ck-row-top .ck-inst-adi, .ck-row-top .ck-inst-radar { flex:1 1 100% !important; } }
  `;
  document.head.appendChild(st);
}

// ══════════════════════════════════════════════════════════════════════════════
// MINIGAME CHASSIS (shared styling for the focused decks)
// ══════════════════════════════════════════════════════════════════════════════
function ensureMgStyles() {
  if (document.getElementById('cockpit-mg-styles')) return;
  const s = document.createElement('style'); s.id = 'cockpit-mg-styles';
  s.textContent = `
    #cockpit-overlay { --mg-accent:#4fb8e0; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,4,7,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #cockpit-overlay .ck-panel { width:min(560px,95vw); color:#a9d4ec;
      background:
        repeating-linear-gradient(102deg, rgba(255,255,255,0.02) 0 2px, transparent 2px 4px),
        linear-gradient(180deg,#2b3a48 0%,#1c2833 8%,#111c26 13%,#070f16 100%);
      padding:14px 16px 16px; border-radius:14px; animation:ck-boot .3s ease-out;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.07), 0 20px 50px rgba(0,0,0,0.75); }
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
    #cockpit-overlay .ck-win { color:#46e05a; } #cockpit-overlay .ck-lose { color:#ff5b5b; } #cockpit-overlay .ck-hint { color:#7fae99; font-weight:normal; } #cockpit-overlay .ck-call { color:#ffcf3e; }
    #cockpit-overlay .ck-actions { display:flex; gap:8px; margin-top:8px; }
    #cockpit-overlay .ck-btn { flex:1; padding:11px 6px; background:linear-gradient(180deg,#16283a,#0f1c28); color:#8fc4e0; border:1px solid #2b4a60; border-radius:4px;
      cursor:pointer; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 0 rgba(0,0,0,0.5); transition:all .12s; user-select:none; -webkit-user-select:none; touch-action:none; }
    #cockpit-overlay .ck-btn:hover { color:#4fb8e0; border-color:#4fb8e0; }
    #cockpit-overlay .ck-btn.ck-down { color:#04101a; background:#4fb8e0; border-color:#4fb8e0; box-shadow:inset 0 2px 4px rgba(0,0,0,0.4); }
    #cockpit-overlay .ck-btn.ck-lit { color:#04101a; background:#46e05a; border-color:#46e05a; }
    #cockpit-overlay .ck-btn-abort:hover { color:#ff5b5b; border-color:#ff5b5b; }
    #cockpit-overlay .ck-btn-flare { flex:1.3; background:#2a1a06; color:#ffb23e; border-color:#7a5310; }
    #cockpit-overlay .ck-btn-flare.ck-armed { animation:ck-flare-pulse 0.5s steps(2) infinite; color:#04101a; background:#ffb23e; border-color:#ffcf3e; }
    @keyframes ck-flare-pulse { 50% { opacity:0.55; } }
  `;
  document.head.appendChild(s);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. TAKEOFF — run-up → roll → V-speeds → rotate → gear up
// ══════════════════════════════════════════════════════════════════════════════
// Lever + big-message styling for the takeoff deck (injected once).
function ensureTakeoffStyles() {
  if (document.getElementById('cockpit-takeoff-styles')) return;
  const s = document.createElement('style'); s.id = 'cockpit-takeoff-styles';
  s.textContent = `
    #cockpit-overlay .ck-scr-wrap { position:relative; }
    #cockpit-overlay .ck-bigmsg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none;
      font-weight:bold; letter-spacing:2px; font-size:22px; text-align:center; text-shadow:0 0 12px currentColor, 0 2px 4px #000; }
    #cockpit-overlay .ck-levers { display:flex; gap:10px; margin-top:10px; align-items:stretch; }
    #cockpit-overlay .ck-lever { position:relative; flex:1; height:140px; border-radius:8px; cursor:grab; touch-action:none; user-select:none;
      background:linear-gradient(180deg,#0c1826,#050b12); border:1px solid #2b4a60; box-shadow:inset 0 0 14px rgba(0,0,0,0.8); }
    #cockpit-overlay .ck-lever.ck-grab { cursor:grabbing; }
    #cockpit-overlay .ck-lever-fill { position:absolute; left:0; right:0; bottom:0; height:0%; border-radius:0 0 8px 8px; background:linear-gradient(180deg,rgba(79,184,224,0.35),rgba(79,184,224,0.12)); }
    #cockpit-overlay .ck-lever-knob { position:absolute; left:4px; right:4px; height:20px; border-radius:5px; background:linear-gradient(180deg,#d6e8f5,#7f9bb0);
      box-shadow:0 2px 4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.5); }
    #cockpit-overlay .ck-lever-mid { position:absolute; left:0; right:0; top:50%; height:1px; background:#2b4a60; }
    #cockpit-overlay .ck-lever-v1 { position:absolute; left:0; right:0; height:2px; background:#46e05a; box-shadow:0 0 6px #46e05a; }
    #cockpit-overlay .ck-lever-lbl { position:absolute; top:4px; left:0; right:0; text-align:center; font-size:9px; letter-spacing:2px; color:#7f93a4; pointer-events:none; }
    #cockpit-overlay .ck-lever-lbl b { display:block; color:#4fb8e0; font-size:14px; margin-top:2px; }
    #cockpit-overlay .ck-deck-canopy { height:72px; margin:2px 0 6px; }
    #cockpit-overlay .ck-deck-canopy .ws-wrap { height:100%; min-height:0; }
  `;
  document.head.appendChild(s);
}

// TAKEOFF — a hand-flown departure on two controls: a THROTTLE lever (drag to set
// 0–100%, holds where you leave it) and a CONTROL COLUMN (drag up = push forward =
// pitch down; drag down = pull back = pitch up; holds). Roll begins once the
// throttle's up; at 80% of runway with ≥60% throttle you get V1 — ROTATE, and a
// GENTLE pull-back (≈20–30%) lifts you off. Over-rotate → STALL (level out or
// crash); nose-down → crash nose-first; no rotation before the end → overrun.
// ══════════════════════════════════════════════════════════════════════════════
// 2.5. THE CONTINUOUS COCKPIT (client-sim + server-reconcile)  — Phase 1 slice
// ══════════════════════════════════════════════════════════════════════════════
// A persistent, always-live cockpit that runs the real flight-model.js physics at
// 60fps in the area pane. Draggable yoke/throttle/flaps (Pointer Events, mouse +
// touch). It streams state to the server via `flightsync`, reports wheels-up and
// touchdown via `flightevent`, and consumes `flight_ctx` for authoritative fuel +
// the world below. The yoke is physically inverted (pull DOWN = nose up). Retires
// the modal takeoff/glideslope decks for continuous craft (currently the Mayfly).

let _fsim = null;
const lerpN = (a, b, t) => a + (b - a) * t;
// Live-tunable render knobs exposed as in-cockpit sliders (⚙). RENDER_TUNE is shared
// with windshield.js so a slider change takes effect on the very next frame.
const FSIM_TUNE = [
  ['worldPace', 'Ground speed', 0, 0.001, 0.00005],
  ['eh', 'Horizon compress', 0, 1, 0.01],
  ['climbLift', 'Climb lift', 0, 20, 0.5],
  ['tile', 'Floor tiles', 0.1, 3, 0.05],
  ['pixel', 'Pixel size', 1, 10, 1],
  ['bldgH', 'Bldg height', 0.05, 3, 0.05],
  ['bldgFoot', 'Bldg width', 0.05, 1.5, 0.05],
  ['texRes', 'Texture res', 0.3, 4, 0.25],
  ['haze', 'Distance haze', 0.3, 3, 0.05],
  ['rwl', 'Runway length', 1, 8, 0.2],
  ['rwyRecede', 'Runway recede', 0.5, 6, 0.2],
];

function ensureFlightSimStyles() {
  if (document.getElementById('fsim-styles')) return;
  const s = document.createElement('style'); s.id = 'fsim-styles';
  s.textContent = `
    .fsim{ display:flex; flex-direction:column; gap:6px; font-family:var(--font,monospace); --cy:var(--accent,#8fd0ff); --mg:#ff4a9a; --gr:#5fe0a0; }
    .fsim-view{ position:relative; height:clamp(150px,26vh,300px); border-radius:8px; overflow:hidden; box-shadow:inset 0 0 0 2px #0f1c28, 0 0 12px rgba(0,0,0,.6); }
    .fsim-lamp{ position:absolute; top:8px; left:50%; transform:translateX(-50%); font:11px/1 monospace; letter-spacing:2px; z-index:3;
      color:#ff5a5b; background:rgba(40,4,6,.7); border:1px solid #ff5a5b; border-radius:5px; padding:3px 9px; opacity:0; transition:opacity .12s; }
    /* glass panel row: PFD | MFD (Diamond DA42-inspired) */
    .fsim-glass{ display:flex; gap:6px; height:clamp(150px,23vh,212px); }
    .fsim-pfd,.fsim-mfd,.fsim-gauges{ position:relative; flex:1 1 0; background:#060c12; border:1px solid #16303f; border-radius:8px; overflow:hidden;
      box-shadow:inset 0 0 10px rgba(0,0,0,.7), 0 0 0 1px rgba(95,208,255,.08); }
    .fsim-pfd{ flex:0.6 1 0; }        /* left PFD */
    .fsim-mfd{ flex:0.6 1 0; }        /* right MFD squeezed to the SAME width as the PFD */
    .fsim-gauges{ flex:2 1 0; }       /* wide centre: gauges hug its edges, the yoke rises up its middle */
    .fsim-rightctl{ flex:0 0 140px; display:flex; gap:6px; }   /* throttle + start + flaps, to the right of the MFD */
    .fsim-pfd canvas,.fsim-mfd canvas,.fsim-gauges canvas{ width:100%; height:100%; display:block; image-rendering:pixelated; }
    .fsim-mfd-tog{ position:absolute; top:5px; right:5px; z-index:2; background:rgba(6,14,22,.8); border:1px solid var(--cy); color:var(--cy);
      border-radius:4px; font:8px monospace; padding:2px 5px; letter-spacing:1px; cursor:pointer; }
    .fsim-mfd-lbl{ position:absolute; top:6px; left:7px; z-index:2; font:8px monospace; letter-spacing:1px; color:var(--cy); opacity:.85; }
    /* controls: full yoke + throttle quadrant */
    /* control row: badge (bottom-left) | YOKE (aligned under gauges) | transponder (bottom-right) */
    .fsim-ctl{ display:flex; gap:6px; align-items:stretch; height:120px; }
    .fsim-placard,.fsim-xpdr{ background:#04080c; border:1px solid #16303f; border-radius:8px; box-shadow:inset 0 0 12px rgba(0,0,0,.8); padding:9px 11px; display:flex; flex-direction:column; overflow:hidden; }
    .fsim-placard{ flex:0.6 1 0; justify-content:center; gap:4px; }
    .fsim-xpdr{ flex:1 1 0; gap:5px; justify-content:center; }
    .fsim-plac-title,.fsim-xpdr-title{ font-size:8px; letter-spacing:2px; color:#4a5a68; }
    .fsim-plac-reg{ font-size:16px; font-weight:bold; letter-spacing:2px; color:var(--cy); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .fsim-plac-own{ font-size:10px; letter-spacing:1px; color:#8a9aa8; }
    .fsim-plac-own.rented{ color:#ffb23e; }
    .fsim-xpdr-sq{ font-size:19px; font-weight:bold; letter-spacing:4px; color:var(--gr); text-shadow:0 0 6px rgba(95,224,160,.4); }
    .fsim-xpdr-row{ display:flex; justify-content:space-between; font-size:10px; color:#8a9aa8; letter-spacing:1px; }
    .fsim-xpdr-row b{ color:var(--cy); }
    .fsim-yoke{ position:relative; flex:2 1 0; background:radial-gradient(circle at 50% 26%,#0e1a24,#070d13); border:1px solid #16303f;
      border-radius:12px; touch-action:none; cursor:grab; overflow:visible; perspective:1000px; box-shadow:inset 0 0 14px rgba(0,0,0,.7); }
    .fsim-yoke.drag{ cursor:grabbing; }
    /* Big yoke anchored HIGH: it rises up into the centre of the gauges panel (between the
       edge gauges) and its pull-down never drags it off the bottom of the frame. */
    .fsim-yoke-svg{ position:absolute; left:17%; top:-120%; width:66%; height:194%; transform-style:preserve-3d; will-change:transform;
      transform-origin:50% 66%; pointer-events:none; filter:drop-shadow(0 7px 10px rgba(0,0,0,.65)); }
    .fsim-climbmark{ position:absolute; left:10%; right:10%; top:66%; height:0; border-top:1px dashed rgba(95,224,160,0.55); pointer-events:none; }
    .fsim-climbmark::after{ content:'BEST CLIMB'; position:absolute; right:1px; top:-9px; font-size:7px; letter-spacing:1px; color:var(--gr); }
    .fsim-throttle{ position:relative; flex:0 0 56px; background:linear-gradient(180deg,#0c141c,#080e14); border:1px solid #16303f;
      border-radius:10px; touch-action:none; cursor:ns-resize; overflow:hidden; }
    .fsim-thr-slot{ position:absolute; left:50%; top:12px; bottom:22px; width:8px; margin-left:-4px; background:#04080c; border:1px solid #16303f; border-radius:4px; box-shadow:inset 0 0 4px #000; }
    .fsim-thr-notch{ position:absolute; left:8px; width:7px; height:1px; background:rgba(120,150,175,.4); }
    .fsim-thr-lever{ position:absolute; left:6px; right:6px; height:20px; }
    .fsim-thr-grip{ position:absolute; inset:0; border-radius:6px; background:linear-gradient(180deg,#3a6f8f 0%,#1a3d52 55%,#0e2130 100%);
      border:1px solid var(--cy); box-shadow:0 2px 6px rgba(0,0,0,.6), inset 0 1px 2px rgba(255,255,255,.35); }
    .fsim-thr-grip::after{ content:''; position:absolute; left:22%; right:22%; top:8px; height:4px; background:repeating-linear-gradient(90deg,#0e2130 0 2px,rgba(95,208,255,.25) 2px 4px); }
    .fsim-thr-val{ position:absolute; bottom:4px; left:0; right:0; text-align:center; font:9px monospace; color:var(--cy); }
    .fsim-side{ flex:1 1 auto; display:flex; flex-direction:column; gap:8px; align-items:stretch; }
    /* engine master: a round accent button with a power glyph that recesses when running */
    .fsim-engbtn{ flex:0 0 auto; align-self:center; width:52px; height:52px; border-radius:50%; border:2px solid var(--cy); color:var(--cy);
      background:radial-gradient(circle at 50% 34%,#0e2230,#06121c); font-size:22px; line-height:1; cursor:pointer; user-select:none;
      display:flex; align-items:center; justify-content:center; box-shadow:0 3px 0 rgba(0,0,0,.55), 0 5px 9px rgba(0,0,0,.5); transition:transform .09s, box-shadow .09s, text-shadow .12s; }
    .fsim-engbtn:active{ transform:translateY(2px); }
    .fsim-engbtn.on{ transform:translateY(3px); box-shadow:inset 0 3px 9px rgba(0,0,0,.85); text-shadow:0 0 10px var(--cy); }
    /* flaps: a 3-position switch (UP / ½ / FULL) — click the track to snap to a detent */
    .fsim-flapsw{ flex:1 1 auto; display:flex; gap:7px; align-items:stretch; }
    .fsim-flapsw-track{ position:relative; flex:0 0 20px; background:#04080c; border:1px solid #16303f; border-radius:6px; cursor:pointer; box-shadow:inset 0 0 5px #000; touch-action:none; }
    .fsim-flapsw-knob{ position:absolute; left:2px; right:2px; height:28%; top:2%; border-radius:4px; background:linear-gradient(180deg,#d6e8f5,#7f9bb0); box-shadow:0 2px 5px rgba(0,0,0,.6); transition:top .12s; }
    .fsim-flapsw-lbls{ flex:1 1 auto; display:flex; flex-direction:column; justify-content:space-between; font:9px monospace; letter-spacing:1px; color:#6f8698; padding:1px 0; }
    .fsim-flapsw-lbls span.on{ color:var(--cy); text-shadow:0 0 5px var(--cy); }
    .fsim-tunebtn{ position:absolute; top:6px; right:8px; z-index:4; background:rgba(6,12,18,.7); border:1px solid #16303f; color:var(--cy);
      border-radius:6px; width:24px; height:22px; font-size:12px; line-height:1; cursor:pointer; }
    .fsim-tune{ position:absolute; top:32px; right:8px; z-index:4; width:186px; background:rgba(8,14,20,.94); border:1px solid #14212d; border-radius:8px; padding:8px; }
    .fsim-tune .trow{ display:flex; align-items:center; gap:5px; margin-bottom:5px; font-size:9px; }
    .fsim-tune .trow label{ flex:0 0 64px; color:#6f8698; letter-spacing:.5px; }
    .fsim-tune .trow input{ flex:1; min-width:0; }
    .fsim-tune .tv{ flex:0 0 34px; text-align:right; color:var(--cy); font-variant-numeric:tabular-nums; }`;
  document.head.appendChild(s);
}

// A full control yoke (cyberpunk-industrial): a horned control wheel with side grips
// and a lit centre boss. It's transformed live (roll + a 3-D pull toward/away) in the
// frame loop so the wheel feels like it's coming toward you as you pull back.
const YOKE_SVG = `<svg class="fsim-yoke-svg" id="fsim-yoke-svg" viewBox="0 0 100 74" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="ykblk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3d42"/><stop offset="0.16" stop-color="#191b1f"/><stop offset="0.6" stop-color="#0c0d10"/><stop offset="1" stop-color="#050506"/></linearGradient>
    <linearGradient id="ykgr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2e34"/><stop offset="0.14" stop-color="#131418"/><stop offset="1" stop-color="#040405"/></linearGradient>
    <radialGradient id="ykgloss" cx="0.4" cy="0.18" r="0.75"><stop offset="0" stop-color="rgba(255,255,255,0.32)"/><stop offset="0.45" stop-color="rgba(255,255,255,0.04)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>
    <radialGradient id="ykgreen" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9dffc8"/><stop offset="0.5" stop-color="#3ad07a"/><stop offset="1" stop-color="#0d3a22"/></radialGradient>
    <radialGradient id="ykred" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffb6b8"/><stop offset="0.5" stop-color="#e0403a"/><stop offset="1" stop-color="#3a0d0d"/></radialGradient>
  </defs>
  <rect x="44" y="42" width="12" height="30" rx="4" fill="url(#ykblk)" stroke="#000" stroke-width="0.5"/>
  <path d="M12,46 Q8,22 24,18 Q37,13 50,15 Q63,13 76,18 Q92,22 88,46 L79,46 Q82,28 66,24 Q58,22 50,22 Q42,22 34,24 Q18,28 21,46 Z" fill="url(#ykblk)" stroke="#000" stroke-width="0.8"/>
  <rect x="7" y="39" width="17" height="27" rx="8" fill="url(#ykgr)" stroke="#000" stroke-width="0.8"/>
  <rect x="76" y="39" width="17" height="27" rx="8" fill="url(#ykgr)" stroke="#000" stroke-width="0.8"/>
  <path d="M12,46 Q8,22 24,18 Q37,13 50,15 Q63,13 76,18 Q92,22 88,46 L79,46 Q82,28 66,24 Q58,22 50,22 Q42,22 34,24 Q18,28 21,46 Z" fill="url(#ykgloss)"/>
  <rect x="38" y="30" width="24" height="13" rx="3" fill="#0a0b0d" stroke="#2a2d33" stroke-width="0.6"/>
  <circle id="fsim-yk-green" cx="44.5" cy="36.5" r="3" fill="url(#ykgreen)" opacity="0.2"/>
  <circle id="fsim-yk-red" cx="55.5" cy="36.5" r="3" fill="url(#ykred)" opacity="0.2"/>
</svg>`;

export function openFlightSim(opts = {}) {
  closeFlightSim();          // clear any prior
  closeCockpit();            // stop the glass HUD loop; the continuous cockpit owns the pane
  ensureWindshieldStyles(); ensureFlightSimStyles(); refreshAccent();
  const P = TYPES[opts.craftType] || TYPES.mayfly;
  const s = createState(P);
  s.heading = (((opts.heading || 0) % 360) + 360) % 360;

  const F = {
    P, s, cls: opts.craftClass || 'ultralight',
    input: { elevator: 0, aileron: 0, throttle: 0, flaps: 0 },
    pos: { x: opts.gx || 0, y: opts.gy || 0 },
    mapCenter: { x: Math.round(opts.gx || 0), y: Math.round(opts.gy || 0) }, rollDist: 0, travel: 0,
    rwOrigin: { x: opts.gx || 0, y: opts.gy || 0 }, rwHdg: (((opts.heading || 0) % 360) + 360) % 360,   // world-fixed departure runway anchor
    airport: opts.airport || 'default',
    reg: opts.registration || (opts.deviceName || 'MAYFLY').toUpperCase(), owner: opts.owner || 'RENTED',
    fuel: opts.fuel ?? 100, fuelCap: opts.fuelCap || 100, warn: null,
    map: opts.map || null, sky: opts.sky || { hour: 12, weather: 'clear', wind: 0 }, biomeBelow: opts.biomeBelow ?? null,
    minimap: opts.minimap || null, mfdMode: 'local',
    deadStick: false, reportedAirborne: false, over: false,
    engineOn: !!opts.engineOn,
    yokeDrag: false, thrDrag: false,
    raf: 0, last: 0, syncAcc: 0, hornBeat: 0, audioAcc: 0,
    temp: 40, battery: 100,          // cosmetic engine-temp (°C) + battery charge (%) for the gauge cluster

    disp: { ias: 0, alt: 0, vs: 0, hdg: s.heading, rpm: 0, pitch: 0, bank: 0 },
    listeners: [],
  };
  _fsim = F;

  const html = `<div id="fsim-root" class="fsim">
    <div class="fsim-view">${windshieldHTML('fsim-ws', 'FWD VIEW · ' + esc((opts.deviceName || P.name).toUpperCase()))}<div class="fsim-lamp" id="fsim-lamp">⚠ STALL</div><button class="fsim-tunebtn" id="fsim-tunebtn" title="render tuning">⚙</button><div class="fsim-tune" id="fsim-tune" style="display:none"></div></div>
    <div class="fsim-glass">
      <div class="fsim-pfd"><canvas id="fsim-pfd"></canvas></div>
      <div class="fsim-gauges"><canvas id="fsim-gauges"></canvas></div>
      <div class="fsim-mfd"><canvas id="fsim-mfd"></canvas><span class="fsim-mfd-lbl" id="fsim-mfd-lbl">LOCAL</span><button class="fsim-mfd-tog" id="fsim-mfd-tog">NAV ▸</button></div>
      <div class="fsim-rightctl">
        <div class="fsim-throttle" id="fsim-thr">
          <div class="fsim-thr-slot"></div>
          <div class="fsim-thr-notch" style="top:16px"></div><div class="fsim-thr-notch" style="top:42%"></div><div class="fsim-thr-notch" style="bottom:28px"></div>
          <div class="fsim-thr-lever" id="fsim-thr-lever"><div class="fsim-thr-grip"></div></div>
          <span class="fsim-thr-val" id="fsim-thrv">0%</span>
        </div>
        <div class="fsim-side">
          <button class="fsim-engbtn" id="fsim-eng" title="engine master">⏻</button>
          <div class="fsim-flapsw">
            <div class="fsim-flapsw-track" id="fsim-flapsw-track"><div class="fsim-flapsw-knob" id="fsim-flapsw-knob"></div></div>
            <div class="fsim-flapsw-lbls"><span class="on">UP</span><span>½</span><span>FULL</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="fsim-ctl">
      <div class="fsim-placard">
        <div class="fsim-plac-title">◈ AIRCRAFT</div>
        <div class="fsim-plac-reg" id="fsim-reg">—</div>
        <div class="fsim-plac-own" id="fsim-own">—</div>
      </div>
      <div class="fsim-yoke" id="fsim-yoke">${YOKE_SVG}</div>
      <div class="fsim-xpdr">
        <div class="fsim-xpdr-title">XPDR · RADIO</div>
        <div class="fsim-xpdr-sq" id="fsim-sq">1200</div>
        <div class="fsim-xpdr-row"><span>COM</span><b>118.00</b></div>
        <div class="fsim-xpdr-row"><span>NAV</span><b>112.30</b></div>
      </div>
    </div>
  </div>`;
  setAreaPane(html);
  const root = document.getElementById('fsim-root');
  if (!root) { _fsim = null; return; }
  const q = (sel) => root.querySelector(sel);
  const add = (t, ty, fn, op) => { if (!t) return; t.addEventListener(ty, fn, op); F.listeners.push([t, ty, fn, op]); };

  // Yoke — 2D pad, springs to centre. Physically inverted: drag DOWN = pull = nose up.
  const pad = q('#fsim-yoke');
  const padTo = (e) => { const r = pad.getBoundingClientRect(); F.input.aileron = clampNum(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1); F.input.elevator = clampNum(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1); };
  add(pad, 'pointerdown', (e) => { F.yokeDrag = true; pad.classList.add('drag'); try { pad.setPointerCapture(e.pointerId); } catch {} padTo(e); });
  add(pad, 'pointermove', (e) => { if (F.yokeDrag) padTo(e); });
  add(window, 'pointerup', () => { F.yokeDrag = false; pad.classList.remove('drag'); });

  // Throttle — vertical lever, holds where you leave it.
  const thr = q('#fsim-thr');
  const thrTo = (e) => { const r = thr.getBoundingClientRect(); F.input.throttle = clampNum(1 - (e.clientY - r.top) / r.height, 0, 1); };
  add(thr, 'pointerdown', (e) => { F.thrDrag = true; try { thr.setPointerCapture(e.pointerId); } catch {} thrTo(e); });
  add(thr, 'pointermove', (e) => { if (F.thrDrag) thrTo(e); });
  add(window, 'pointerup', () => { F.thrDrag = false; });

  // Aircraft placard (bottom-left): registration + owner (RENTED if none).
  const regEl = q('#fsim-reg'), ownEl = q('#fsim-own');
  if (regEl) regEl.textContent = F.reg;
  if (ownEl) { ownEl.textContent = F.owner; ownEl.classList.toggle('rented', F.owner === 'RENTED'); }

  // Flaps — a 3-position switch (UP / ½ / FULL). Click the track to snap to the nearest detent.
  const flapTrack = q('#fsim-flapsw-track'), flapKnob = q('#fsim-flapsw-knob');
  const flapLbls = root.querySelectorAll('.fsim-flapsw-lbls span');
  const FLAP_VAL = [0, 0.5, 1], FLAP_TOP = ['2%', '36%', '70%'];
  const setFlap = (i) => { F.input.flaps = FLAP_VAL[i]; if (flapKnob) flapKnob.style.top = FLAP_TOP[i]; flapLbls.forEach((s2, j) => s2.classList.toggle('on', j === i)); };
  add(flapTrack, 'pointerdown', (e) => { const r = flapTrack.getBoundingClientRect(); const f = (e.clientY - r.top) / r.height; const i = f < 0.34 ? 0 : f < 0.67 ? 1 : 2; if (FLAP_VAL[i] !== F.input.flaps) { setFlap(i); flapWhir(); } });
  setFlap(0);

  // Engine master — a round accent button that recesses while running. Off→on any time;
  // on→off only parked and stopped (you can't kill the engine in the air).
  const engBtn = q('#fsim-eng');
  if (F.engineOn) engBtn.classList.add('on');
  add(engBtn, 'click', () => {
    if (!F.engineOn) {
      F.engineOn = true; engBtn.classList.add('on');
      try { spoolUp(F.cls); } catch {}
      sendCmdSilent('flightevent engineon');
    } else if (s.onGround && s.airspeed < 5) {
      F.engineOn = false; engBtn.classList.remove('on');
      try { spoolDown(F.cls); } catch {}
      sendCmdSilent('flightevent engineoff');
    }
  });

  // MFD map toggle — real local minimap ↔ aerial biome nav map.
  const mfdTog = q('#fsim-mfd-tog'), mfdLbl = q('#fsim-mfd-lbl');
  add(mfdTog, 'click', () => {
    F.mfdMode = F.mfdMode === 'local' ? 'nav' : 'local';
    if (mfdLbl) mfdLbl.textContent = F.mfdMode === 'local' ? 'LOCAL' : 'NAV';
    if (mfdTog) mfdTog.textContent = F.mfdMode === 'local' ? 'NAV ▸' : '◂ LOCAL';
  });

  // Live render-tuning sliders (⚙) — mutate the shared RENDER_TUNE, effect is instant.
  const tuneBtn = q('#fsim-tunebtn'), tunePanel = q('#fsim-tune');
  const tvFmt = (n) => (n >= 1 ? n.toFixed(1) : n.toFixed(3));
  tunePanel.innerHTML = FSIM_TUNE.map(([k, lbl, lo, hi, stp]) =>
    `<div class="trow"><label>${lbl}</label><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${stp}" value="${RENDER_TUNE[k]}"><span class="tv" id="fsim-tv-${k}">${tvFmt(RENDER_TUNE[k])}</span></div>`).join('');
  tunePanel.querySelectorAll('input').forEach((inp) => add(inp, 'input', () => {
    RENDER_TUNE[inp.dataset.k] = parseFloat(inp.value);
    const tv = document.getElementById('fsim-tv-' + inp.dataset.k); if (tv) tv.textContent = tvFmt(RENDER_TUNE[inp.dataset.k]);
  }));
  add(tuneBtn, 'click', () => { tunePanel.style.display = tunePanel.style.display === 'none' ? 'block' : 'none'; });

  F.last = performance.now();
  F.raf = requestAnimationFrame(fsimFrame);
}

// Off-map guard: if the tiles right under us are void (the endless-desert buffer beyond
// the built world), return the compass heading back toward the centroid of real terrain
// so the HUD can say "TURN xxx°". null = we're over the map, no warning. Heading convention
// matches the renderer: 0°=−y (north), 90°=+x (east).
function offMapHeading(F) {
  const map = F.map; if (!map || !map.length) return null;
  const R = (map.length - 1) / 2;
  const cx = R + (F.pos.x - F.mapCenter.x), cy = R + (F.pos.y - F.mapCenter.y);
  const at = (x, y) => { const row = map[Math.round(y)]; return row ? row[Math.round(x)] : null; };
  const real = (c) => c && c.kind !== 'air' && c.biome && c.biome !== 'water';
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (real(at(cx + dx, cy + dy))) return null;  // still over the world
  let sx = 0, sy = 0, n = 0;
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) if (real(map[ry][rx])) { sx += rx; sy += ry; n++; }
  if (!n) return null;
  const bx = (sx / n) - cx, by = (sy / n) - cy;
  return (Math.round(Math.atan2(bx, -by) * 180 / Math.PI) + 360) % 360;
}

function fsimFrame(now) {
  const F = _fsim; if (!F) return;
  const root = document.getElementById('fsim-root');
  if (!root) { closeFlightSim(); return; }
  const dt = clampNum((now - F.last) / 1000, 0, 0.05); F.last = now;
  const { s, P, input } = F;

  // Yoke springs to centre when released.
  if (!F.yokeDrag) { input.elevator = lerpN(input.elevator, 0, Math.min(1, dt * 6)); input.aileron = lerpN(input.aileron, 0, Math.min(1, dt * 6)); }
  // Effective throttle: the lever always moves, but there's no thrust unless the
  // engine master switch is on and the tank isn't dry (dead stick).
  const thr = (F.engineOn && !F.deadStick) ? input.throttle : 0;

  step(s, { elevator: input.elevator, aileron: input.aileron, throttle: thr, flaps: input.flaps }, P, dt);

  // Move through the world whenever rolling or flying — the takeoff roll translates
  // you forward down the runway (buildings grow and pass); liftoff just adds altitude.
  if (s.airspeed > 0.5) {
    // Ground pace is a constant (0.001) — the world simply scrolls in proportion to airspeed.
    const d = s.airspeed * RENDER_TUNE.worldPace * dt, hr = s.heading * Math.PI / 180;
    F.pos.x += Math.sin(hr) * d; F.pos.y += -Math.cos(hr) * d;
    F.travel += d;
    if (F.engineOn) F.rollDist += d;
  }

  // Transitions → tell the server. Track descent rate while airborne so touchdown knows
  // how hard the arrival was (soft squeak vs firm thump).
  if (!s.onGround) F.touchVs = s.vs;
  if (!s.onGround && !F.reportedAirborne) { F.reportedAirborne = true; groundFx('liftoff'); sendCmdSilent('flightevent takeoff'); }
  if (s.onGround && F.reportedAirborne && !F.over) {
    F.over = true;
    groundFx((F.touchVs || 0) < -500 ? 'touchdownHard' : 'touchdown');   // tyre squeak on the numbers
    // Report the exact touchdown tile first, then land — the server decides
    // field-landing vs off-field crash from this position.
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} 0 0 ${Math.round(s.heading)} 0 0 1 0`);
    sendCmdSilent('flightevent land');
    setTimeout(() => { closeFlightSim(); sendCmdSilent('look'); }, 500);
  }

  // Stall horn (intermittent → continuous).
  fsimHorn(F, dt);

  const r = readout(s, P), d = F.disp;
  d.ias = lerpN(d.ias, r.airspeed, Math.min(1, dt * 6)); d.alt = lerpN(d.alt, r.altitude, Math.min(1, dt * 5));
  d.vs = lerpN(d.vs, r.vs, Math.min(1, dt * 4)); d.rpm = lerpN(d.rpm, r.rpm, Math.min(1, dt * 6));
  d.pitch = lerpN(d.pitch, r.pitch, Math.min(1, dt * 10)); d.bank = lerpN(d.bank, r.bank, Math.min(1, dt * 10));
  const dh = ((r.heading - d.hdg + 540) % 360) - 180; d.hdg = (d.hdg + dh * Math.min(1, dt * 6) + 360) % 360;

  // PFD (attitude + speed/altitude tapes + heading + VSI) and MFD (map).
  paintPFD(document.getElementById('fsim-pfd'), {
    pitch: d.pitch, bank: d.bank, ias: d.ias, alt: d.alt, vs: d.vs, hdg: d.hdg,
    vr: P.vr, vne: P.vne, vs0: P.vs0, sm: s.stallMargin, fuelPct: Math.round(F.fuel / (F.fuelCap || 1) * 100),
    warn: r.stalled || s.stallMargin < 0.35, bingo: F.fuel <= 0 || F.warn === 'BINGO',
  });
  paintMFD(document.getElementById('fsim-mfd'), F, d);

  // Cosmetic engine gauges: temp eases with RPM (slow thermal lag); battery charges while
  // the engine turns and trickles down otherwise. Neither feeds physics — dials only.
  const tgtTemp = 40 + s.rpm * 175;
  F.temp = lerpN(F.temp, tgtTemp, Math.min(1, dt * 0.35));
  F.battery = clampNum(F.battery + ((F.engineOn && s.rpm > 0.2) ? 5 : -1.1) * dt, 0, 100);
  paintGauges(document.getElementById('fsim-gauges'), {
    rpm: s.rpm, temp: F.temp, ias: r.airspeed, vr: P.vr, vne: P.vne, vs0: P.vs0,
    fuelPct: Math.round(F.fuel / (F.fuelCap || 1) * 100), battery: F.battery,
    stall: r.stalled, warn: r.stalled || s.stallMargin < 0.35, hornBeat: F.hornBeat,
  });

  // Full yoke: roll with aileron + a 3-D pull toward/away with elevator (capped so it
  // stays in frame). Green light glows near best-climb pull; red light glows on stall.
  const yk = document.getElementById('fsim-yoke-svg');
  if (yk) yk.style.transform = `translateX(${input.aileron * 7}px) translateY(${input.elevator * 18}px) rotateX(${-input.elevator * 34}deg) rotateZ(${input.aileron * 30}deg) scale(${1 + Math.max(0, input.elevator) * 0.2})`;
  const gL = document.getElementById('fsim-yk-green'), rL = document.getElementById('fsim-yk-red');
  const atClimb = input.elevator > 0.40 && input.elevator < 0.66;
  const stalling = r.stalled || s.stallMargin < 0.35;
  if (gL) { gL.style.opacity = atClimb ? '1' : '0.2'; gL.style.filter = atClimb ? 'drop-shadow(0 0 4px #3ad07a)' : 'none'; }
  if (rL) { rL.style.opacity = stalling ? '1' : '0.2'; rL.style.filter = stalling ? 'drop-shadow(0 0 5px #e0403a)' : 'none'; }

  // Throttle quadrant lever.
  const lever = document.getElementById('fsim-thr-lever'), tv = document.getElementById('fsim-thrv');
  if (lever) lever.style.bottom = (10 + input.throttle * 70) + '%';
  if (tv) tv.textContent = Math.round(input.throttle * 100) + '%';

  const back = F.reportedAirborne ? offMapHeading(F) : null;
  // Landing guide: show the glideslope gates once airborne, low, and within reach of the
  // departure runway (so it appears as you turn back to land).
  const rwDist = Math.hypot(F.rwOrigin.x - F.pos.x, F.rwOrigin.y - F.pos.y);
  const landGuide = (F.reportedAirborne && r.altitude < 1600 && rwDist < 16) ? { alt: r.altitude } : null;
  paintWindshield('fsim-ws', {
    pitch: d.pitch, bank: d.bank,
    // Render height fraction (drives eye-height/compression). Referenced to 3000ft with a
    // sqrt curve so it ramps HARD off the deck — by ~500ft you're visibly above the buildings.
    height: Math.min(1, Math.sqrt(Math.max(0, r.altitude) / 3000)), speed: clampNum(r.airspeed / (P.vne || 120), 0, 1),
    hour: F.sky?.hour, weather: F.sky?.weather, wind: F.sky?.wind, heading: d.hdg,
    map: F.map, mapCenter: F.mapCenter, phase: 'cruise', airport: F.airport, biomeBelow: F.biomeBelow,
    mapOffset: { x: F.pos.x - F.mapCenter.x, y: F.pos.y - F.mapCenter.y }, travel: F.travel,
    // World-fixed runway: its origin + heading in the world, offset from the craft — so it
    // stays put and recedes/rotates naturally as you fly away (not glued ahead of the nose).
    runway: { ox: F.rwOrigin.x - F.pos.x, oy: F.rwOrigin.y - F.pos.y, hdg: F.rwHdg, alt: clampNum(r.altitude / 320, 0, 1) },
    landGuide,
    hud: true, navWarn: back == null ? null : `⚠ TURN ${String(back).padStart(3, '0')}° — RETURN TO MAP`,
  });

  // Stream state to the server (~1.2s) once we're actually flying; ride the engine audio.
  F.syncAcc += dt; F.audioAcc += dt;
  if (F.reportedAirborne && F.syncAcc >= 1.2) {
    F.syncAcc = 0;
    sendCmdSilent(`flightsync ${F.pos.x.toFixed(2)} ${F.pos.y.toFixed(2)} ${Math.round(s.altitude)} ${Math.round(s.airspeed)} ${Math.round(s.heading)} ${Math.round(thr * 100)} ${Math.round(s.vs)} ${s.onGround ? 1 : 0} ${s.stalled ? 1 : 0}`);
    // NB: mapCenter is NOT advanced here — it stays paired with the map the server sends back
    // (updated in flightSimContext), so buildings never jump/re-seed on a window recenter.
  }
  if (F.audioAcc >= 0.25) {
    F.audioAcc = 0;
    updateEngineAudio({ airborne: F.reportedAirborne, engineOn: F.engineOn, class: F.cls, throttle: Math.round(thr * 100), spd: Math.round(s.airspeed), engines: [{ pct: Math.round(s.rpm * 100) }], bandIndex: s.altitude > 500 ? 1 : 0, sky: F.sky });
  }

  F.raf = requestAnimationFrame(fsimFrame);
}

function fsimHorn(F, dt) {
  const lamp = document.getElementById('fsim-lamp'); if (!lamp) return;
  const { s } = F;
  // The lamp + audible horn: continuous in the stall, pulsing on the approach, silent otherwise.
  if (s.onGround) { lamp.style.opacity = 0; stallHorn(0); return; }   // no stall warning parked/rolling
  if (s.stalled) { lamp.textContent = '⚠ STALL'; lamp.style.opacity = 1; stallHorn(0.6); }
  else if (s.stallMargin < 0.35) { F.hornBeat = (F.hornBeat + dt * (2 + (0.35 - s.stallMargin) * 10)) % 1; const on = F.hornBeat < 0.5; lamp.style.opacity = on ? 1 : 0; stallHorn(on ? 0.4 : 0); }
  else { lamp.style.opacity = 0; stallHorn(0); }
}

// ── PFD (attitude + speed/altitude tapes + heading + VSI) ─────────────────────
function pfdTape(ctx, x, w, H, val, step, count, warn, marks) {
  const cy = H / 2, ppu = (H * 0.9) / (step * count), left = x < 4;
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w, H); ctx.clip();
  ctx.fillStyle = 'rgba(6,14,22,0.82)'; ctx.fillRect(x, 0, w, H);
  ctx.font = '7px monospace'; ctx.textBaseline = 'middle';
  const base = Math.round(val / step) * step;
  for (let i = -count; i <= count; i++) {
    const tv = base + i * step; if (tv < 0) continue;
    const yy = cy - (tv - val) * ppu; if (yy < -4 || yy > H + 4) continue;
    ctx.strokeStyle = 'rgba(150,190,220,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left ? x + w - 4 : x, yy); ctx.lineTo(left ? x + w : x + 4, yy); ctx.stroke();
    ctx.fillStyle = ACCENT; ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(String(tv), left ? x + w - 6 : x + 6, yy);
  }
  if (marks) for (const m of marks) { const yy = cy - (m.v - val) * ppu; if (yy < 0 || yy > H) continue; ctx.strokeStyle = m.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left ? x + w - 5 : x, yy); ctx.lineTo(left ? x + w : x + 5, yy); ctx.stroke(); }
  ctx.fillStyle = '#0b1219'; ctx.strokeStyle = warn ? '#ff5a5b' : ACCENT; ctx.lineWidth = 1;
  ctx.fillRect(x, cy - 8, w, 16); ctx.strokeRect(x, cy - 8, w, 16);
  ctx.fillStyle = warn ? '#ff5a5b' : ACCENT; ctx.textAlign = 'center'; ctx.fillText(String(Math.round(val)), x + w / 2, cy);
  ctx.restore();
}

function paintPFD(cv, s) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H);
  const TAPE = Math.min(30, W * 0.2), cx = W / 2, cy = H * 0.47, aL = TAPE, aR = W - TAPE, ppd = 2.0;
  ctx.save(); ctx.beginPath(); ctx.rect(aL, 0, aR - aL, H); ctx.clip();
  ctx.save(); ctx.translate((aL + aR) / 2, cy); ctx.rotate(-(s.bank || 0) * Math.PI / 180);
  const ph = (s.pitch || 0) * ppd;
  ctx.fillStyle = '#12466a'; ctx.fillRect(-W, -H * 2 + ph, W * 2, H * 2);
  ctx.fillStyle = '#4a3720'; ctx.fillRect(-W, ph, W * 2, H * 2);
  ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-W, ph); ctx.lineTo(W, ph); ctx.stroke();
  ctx.strokeStyle = 'rgba(200,230,255,0.6)'; ctx.font = '6px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let dd = -30; dd <= 30; dd += 10) { if (!dd) continue; const yy = ph - dd * ppd; const wln = Math.abs(dd) >= 20 ? 14 : 9; ctx.beginPath(); ctx.moveTo(-wln, yy); ctx.lineTo(wln, yy); ctx.stroke(); }
  ctx.restore(); ctx.restore();
  ctx.strokeStyle = '#ffcf3e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 15, cy); ctx.lineTo(cx - 6, cy); ctx.lineTo(cx - 6, cy + 3); ctx.moveTo(cx + 15, cy); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx + 6, cy + 3); ctx.stroke();
  ctx.fillStyle = '#ffcf3e'; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  ctx.beginPath(); ctx.moveTo(cx, 5); ctx.lineTo(cx - 4, 11); ctx.lineTo(cx + 4, 11); ctx.closePath(); ctx.fillStyle = '#dff0ff'; ctx.fill();
  pfdTape(ctx, 0, TAPE, H, s.ias || 0, 10, 5, s.warn, [{ v: s.vr, col: '#5fe0a0' }, { v: s.vne, col: '#ff5a5b' }, { v: s.vs0, col: '#ff5a5b' }]);
  pfdTape(ctx, W - TAPE, TAPE, H, s.alt || 0, 100, 5, false, null);
  ctx.fillStyle = '#0b1219'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.fillRect(cx - 17, 0, 34, 12); ctx.strokeRect(cx - 17, 0, 34, 12);
  ctx.fillStyle = ACCENT; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(Math.round(s.hdg || 0)).padStart(3, '0') + '°', cx, 6);
  const vy = clampNum(cy - (s.vs || 0) / 2000 * (H * 0.42), 6, H - 6);
  ctx.fillStyle = (s.vs || 0) >= 0 ? '#5fe0a0' : '#ffb23e'; ctx.fillRect(W - TAPE - 4, Math.min(cy, vy), 3, Math.abs(vy - cy));
  ctx.fillStyle = s.bingo ? '#ff5a5b' : '#6f8698'; ctx.font = '7px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('FUEL ' + (s.fuelPct | 0) + '%', TAPE + 3, H - 2);
  ctx.restore();
}

// ── Engine gauge cluster (RPM · temp · speed · fuel · battery + stall lamp) ────
// A 270° arc dial: background arc, coloured zone marks, a filled value arc + needle,
// with a short label above and a digital read-out below.
function arcGauge(ctx, cx, cy, r, frac, label, val, opts) {
  opts = opts || {};
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, lw = Math.max(2, r * 0.18);
  frac = clampNum(frac, 0, 1);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(60,82,100,0.5)'; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(cx, cy, r, A0, A1); ctx.stroke();
  if (opts.marks) for (const m of opts.marks) { const a = A0 + (A1 - A0) * clampNum(m.v, 0, 1); ctx.strokeStyle = m.col; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, a - 0.06, a + 0.06); ctx.stroke(); }
  const va = A0 + (A1 - A0) * frac;
  ctx.strokeStyle = opts.col || '#5fe0a0'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, A0, va); ctx.stroke();
  ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(va) * r * 0.82, cy + Math.sin(va) * r * 0.82); ctx.stroke();
  ctx.fillStyle = '#dff0ff'; ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, 7); ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6f8698'; ctx.font = '6px monospace'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, cx, cy - r - 3);
  ctx.fillStyle = opts.valcol || ACCENT; ctx.font = '7px monospace'; ctx.textBaseline = 'middle'; ctx.fillText(val, cx, cy + r * 0.56);
}

function paintGauges(cv, g) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H);
  // Two columns hugging the LEFT and RIGHT edges (middle left clear for the yoke that rises
  // up through it), 3 rows each, dials sized as large as the panel allows for legibility.
  const rows = 3, chd = H / rows, colL = W * 0.12, colR = W * 0.88, r = Math.min(W * 0.09, chd * 0.42);
  const yAt = (i) => (i + 0.5) * chd;
  const vne = g.vne || 120, tf = clampNum((g.temp - 40) / 175, 0, 1);
  arcGauge(ctx, colL, yAt(0), r, g.rpm, 'RPM', Math.round(g.rpm * 100), { col: ACCENT, marks: [{ v: 0.92, col: '#ff5a5b' }] });
  arcGauge(ctx, colL, yAt(1), r, g.ias / vne, 'SPD', Math.round(g.ias), { col: g.warn ? '#ff5a5b' : '#5fe0a0', valcol: g.warn ? '#ff5a5b' : ACCENT, marks: [{ v: g.vs0 / vne, col: '#ff5a5b' }, { v: g.vr / vne, col: '#5fe0a0' }, { v: 1, col: '#ff5a5b' }] });
  arcGauge(ctx, colL, yAt(2), r, g.battery / 100, 'BATT', Math.round(g.battery) + '%', { col: g.battery <= 20 ? '#ff5a5b' : '#5fe0a0' });
  arcGauge(ctx, colR, yAt(0), r, tf, 'TEMP', Math.round(g.temp) + '°', { col: tf > 0.82 ? '#ff5a5b' : tf > 0.6 ? '#ffb23e' : '#5fe0a0', marks: [{ v: 0.82, col: '#ff5a5b' }] });
  arcGauge(ctx, colR, yAt(1), r, g.fuelPct / 100, 'FUEL', g.fuelPct + '%', { col: g.fuelPct <= 15 ? '#ff5a5b' : '#ffb23e', valcol: g.fuelPct <= 15 ? '#ff5a5b' : ACCENT, marks: [{ v: 0.15, col: '#ff5a5b' }] });
  // Stall lamp — dim when clear, pulses with the horn on approach, solid on stall.
  const c = { x: colR, y: yAt(2) };
  const on = g.stall ? 1 : (g.warn ? (g.hornBeat < 0.5 ? 1 : 0.28) : 0.16);
  if (on > 0.5) { ctx.shadowColor = '#e0403a'; ctx.shadowBlur = 10; }
  ctx.fillStyle = `rgba(224,64,58,${on})`; ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.82, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,120,116,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.82, 0, 7); ctx.stroke();
  ctx.fillStyle = on > 0.5 ? '#fff' : '#7a3a38'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STALL', c.x, c.y);
  ctx.restore();
}

// ── MFD (switchable: real local minimap ↔ aerial biome nav map) ───────────────
const MFD_DCOL = { safe: '#2f6d4a', low: '#2b5f7a', medium: '#8a6a2a', high: '#8a4a2a', lethal: '#7a2a2a' };
const MFD_BCOL = { water: '#22506e', badlands: '#8a6a48', industrial: '#484440', freight: '#4a4e56', ruins: '#5a6a3a', oldcoldwater: '#3a3632', uptown: '#38445a', civic: '#42423c', marquee: '#3e3242', citycore: '#3a3c42', parkland: '#3a5c34', docks: '#3c4850', infra: '#464a50', airport: '#3c403c' };

function paintMFD(cv, F, d) {
  if (!cv || !cv.getContext) return;
  const cw = cv.clientWidth, ch = cv.clientHeight; if (!cw || !ch) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const ctx = cv.getContext('2d'); ctx.save(); ctx.scale(dpr, dpr);
  const W = cw, H = ch; ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#050a10'; ctx.fillRect(0, 0, W, H);
  const ox = F.pos.x - F.mapCenter.x, oy = F.pos.y - F.mapCenter.y, hdgRad = (d.hdg || 0) * Math.PI / 180;
  // TRACK-UP minimap: the map ROTATES so your direction of travel is always toward the top;
  // the aircraft marker stays fixed pointing up. A north pointer swings round to show North.
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-hdgRad); ctx.translate(-W / 2, -H / 2);
  if (F.mfdMode === 'nav') paintNav(ctx, W, H, F, ox, oy); else paintLocal(ctx, W, H, F, ox, oy);
  ctx.restore();
  // Fixed aircraft marker — always points up (= where you're heading).
  ctx.save(); ctx.translate(W / 2, H / 2);
  ctx.fillStyle = '#ffcf3e'; ctx.strokeStyle = '#1a1200'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // North pointer — sits toward North on the rotated map (opposite your heading offset).
  const rr = Math.min(W, H) * 0.4, nx = W / 2 - Math.sin(hdgRad) * rr, ny = H / 2 - Math.cos(hdgRad) * rr;
  ctx.fillStyle = accA(0.8); ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny);
  ctx.restore();
}

// Full 5×5 tiles centred on the craft, straight from the always-complete map window —
// no fog of war, every cell shown (off-window cells read as neutral, never blank).
function paintLocal(ctx, W, H, F, ox, oy) {
  const map = F.map;
  if (!map || !map.length) { ctx.fillStyle = '#456'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO MAP', W / 2, H / 2); return; }
  const R = (map.length - 1) / 2, cell = Math.min(W, H) / 5;   // 5 tiles visible across the panel
  const drawHalf = 3;                                         // draw 7×7 so track-up rotation still fills the corners
  const ccx = R + ox, ccy = R + oy, bx = Math.round(ccx), by = Math.round(ccy);
  const fx = ccx - bx, fy = ccy - by;                        // sub-tile offset → smooth scroll
  for (let dy = -drawHalf; dy <= drawHalf; dy++) for (let dx = -drawHalf; dx <= drawHalf; dx++) {
    const c = (map[by + dy] && map[by + dy][bx + dx]) || null;
    const sx = W / 2 + (dx - fx) * cell, sy = H / 2 + (dy - fy) * cell;
    const col = !c ? '#12202c' : c.kind === 'air' ? '#0a1119' : c.kind === 'field' ? '#5fe0a0' : c.kind === 'nofly' ? '#7a2a2a' : (MFD_BCOL[c.biome] || '#2a3540');
    ctx.fillStyle = col; ctx.fillRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
    if (c && c.road) { ctx.fillStyle = 'rgba(150,150,120,0.5)'; ctx.fillRect(sx - cell / 2, sy - 1.5, cell - 1, 3); }
    ctx.strokeStyle = accA(0.14); ctx.lineWidth = 1; ctx.strokeRect(sx - cell / 2, sy - cell / 2, cell - 1, cell - 1);
  }
}

function paintNav(ctx, W, H, F, ox, oy) {
  const map = F.map;
  if (!map || !map.length) { ctx.fillStyle = '#456'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('NO MAP', W / 2, H / 2); return; }
  // Overscan: size cells so the whole 9×9 window spans the panel DIAGONAL — then track-up
  // rotation never reveals empty corners (the outer rings just run off the visible edges).
  const R = (map.length - 1) / 2, cell = Math.hypot(W, H) / map.length * 1.1;
  for (let ry = 0; ry < map.length; ry++) for (let rx = 0; rx < map[ry].length; rx++) {
    const c = map[ry][rx];
    const sx = W / 2 + (rx - R - ox) * cell, sy = H / 2 + (ry - R - oy) * cell;
    const col = !c ? '#0e1a24' : c.kind === 'air' ? '#0a1119' : c.kind === 'field' ? '#5fe0a0' : c.kind === 'nofly' ? '#7a2a2a' : (MFD_BCOL[c.biome] || '#2a3540');
    ctx.fillStyle = col; ctx.fillRect(sx - cell / 2, sy - cell / 2, cell, cell);
    if (c && c.kind === 'nofly') { ctx.strokeStyle = '#ff5a5b'; ctx.lineWidth = 1; ctx.strokeRect(sx - cell / 2, sy - cell / 2, cell, cell); }
  }
  ctx.strokeStyle = accA(0.18); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.32, 0, 7); ctx.stroke();
}

// Server context push (authoritative fuel + the world below).
export function flightSimContext(msg) {
  const F = _fsim; if (!F || !msg) return;
  if (msg.fuel != null) F.fuel = msg.fuel;
  if (msg.fuelCap != null) F.fuelCap = msg.fuelCap;
  // Update the map AND its window centre together so they stay paired (no recenter jump).
  if (msg.map) { F.map = msg.map; if (msg.mapX != null) F.mapCenter = { x: msg.mapX, y: msg.mapY }; }
  if (msg.minimap) F.minimap = msg.minimap;
  if (msg.sky) F.sky = msg.sky;
  if ('biomeBelow' in msg) F.biomeBelow = msg.biomeBelow;
  F.warn = msg.warn || null;
  F.deadStick = F.fuel <= 0;   // dead-stick when dry; clears once refuelled
}

// True while the continuous cockpit owns the area pane — dispatch uses this to stop
// room `look`/`move` renders from clobbering the cockpit out from under the pilot.
export function isFlightSimActive() { return !!_fsim; }

export function closeFlightSim() {
  const F = _fsim; if (!F) return;
  _fsim = null;
  if (F.raf) cancelAnimationFrame(F.raf);
  for (const [t, ty, fn, op] of F.listeners) { try { t.removeEventListener(ty, fn, op); } catch {} }
  try { disposeWindshield('fsim-ws'); } catch {}
  stopEngineAudio();
}

export function openTakeoff(opts = {}) {
  if (opts.vtol) return openVtolLift(opts, 'takeoff');   // helicopters lift vertically
  ensureMgStyles(); ensureChassisStyles(); ensureTakeoffStyles(); ensureWindshieldStyles();
  const o = { skill: 4, difficulty: 5, vtol: false, deviceName: 'CRAFT', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const ROLL = clampNum(0.16 + edge * 0.01, 0.10, 0.24);   // runway consumed per sec at full speed
  const STALL_BAND = clampNum(0.58 - edge * 0.02, 0.46, 0.66);   // stick past this = stall (skill widens margin)

  let throttle = 0, stick = 0, pitch = 0, speed = 0, roll = 0, alt = 0;
  let airborne = false, v1 = false, over = false, stallT = 0, raf = 0, last = 0, dash = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  // Side-view attitude: sky/ground, a scrolling runway, the aircraft pitching +
  // climbing, and a runway-remaining bar with a V1 gate.
  const scr = `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="ck-to-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
      <linearGradient id="ck-to-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3a20"/><stop offset="1" stop-color="#161c10"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="300" height="128" fill="url(#ck-to-sky)"/>
    <rect x="0" y="128" width="300" height="42" fill="url(#ck-to-gnd)"/>
    <rect x="0" y="122" width="300" height="10" fill="#3a4a2a"/>
    <line id="ck-to-rwline" x1="-40" y1="127" x2="340" y2="127" stroke="#cfe8d6" stroke-width="2" stroke-dasharray="16 14"/>
    <g id="ck-to-plane" transform="translate(96 118)">
      <path d="M-16,2 L10,-1 L16,2 L10,5 L-16,3 Z M-4,-2 L2,-9 L4,-2 Z M-16,3 L-20,-3 L-13,0 Z" fill="#eaf6ff" stroke="#4fb8e0" stroke-width="0.8"/>
    </g>
    <rect x="24" y="150" width="252" height="10" rx="3" fill="#0a1620" stroke="#2b4a60"/>
    <rect id="ck-to-rwrem" x="26" y="152" width="248" height="6" rx="2" fill="#2f6d4a"/>
    <line x1="${26 + 248 * 0.8}" y1="148" x2="${26 + 248 * 0.8}" y2="162" stroke="#46e05a" stroke-width="2"/>
    <text x="${26 + 248 * 0.8}" y="147" fill="#46e05a" font-size="7" text-anchor="middle" font-family="monospace">V1</text>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#9992;', o.vtol ? 'LIFT-OFF' : 'TAKEOFF', 'DEPARTURE &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-deck-canopy">${windshieldHTML('ck-ws-to', 'FWD VIEW')}</div>
    <div class="ck-hud2"><span>ASPD <b id="ck-to-asi">0</b></span><span>PITCH <b id="ck-to-pit">0°</b></span><span>GEAR <b id="ck-gear">DOWN</b></span>
      <span class="ck-asi-wrap">THR <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-to-thrbar" style="background:linear-gradient(90deg,#7a5310,#ffb23e)"></span></span></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr-wrap"><div class="ck-scr mg-screen" style="--mg-sweep-h:170px">${scr}${crtOverlays()}</div><div class="ck-bigmsg" id="ck-bigmsg"></div></div></div>
    ${deckStrip('CONTROL BUS', 'RWY USED')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">Drag the <b>THROTTLE</b> up to roll. At <b>V1</b>, gently pull the <b>COLUMN</b> back to rotate.</span></div>
    <div class="ck-levers">
      <div class="ck-lever" id="ck-thr"><div class="ck-lever-fill" id="ck-thr-fill"></div><div class="ck-lever-v1" style="bottom:60%"></div><div class="ck-lever-knob" id="ck-thr-knob" style="bottom:0%"></div><div class="ck-lever-lbl">THROTTLE<b id="ck-thr-val">0%</b></div></div>
      <div class="ck-lever" id="ck-col"><div class="ck-lever-mid"></div><div class="ck-lever-knob" id="ck-col-knob" style="bottom:50%"></div><div class="ck-lever-lbl">COLUMN<b id="ck-col-val">NEUTRAL</b></div></div>
    </div>
    <div class="ck-actions"><button class="ck-btn ck-btn-abort">Abort</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const big = (h, color) => { const el = q('#ck-bigmsg'); if (el) { el.innerHTML = h || ''; el.style.color = color || '#ffcf3e'; } };

  const finish = (won, why) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-rotate' : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    disposeWindshield('ck-ws-to');
    if (!won) creak('stress');
    big(won ? '◇ AIRBORNE' : '✕ ' + (why || 'CRASH'), won ? '#46e05a' : '#ff5b5b');
    setStatus(won ? '<span class="ck-win">◇ POSITIVE RATE — gear up, climbing out.</span>' : `<span class="ck-lose">✕ ${why || 'CRASH'}.</span>`);
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1150);
  };

  // ── Drag a lever; sets a 0..1 fraction from the pointer's Y within the track ──
  function bindLever(id, onFrac) {
    const el = q('#' + id); if (!el) return;
    let dragging = false;
    const setFromY = (clientY) => { const r = el.getBoundingClientRect(); onFrac(clampNum(1 - (clientY - r.top) / r.height, 0, 1)); };
    add(el, 'pointerdown', (e) => { dragging = true; el.classList.add('ck-grab'); try { el.setPointerCapture(e.pointerId); } catch {} setFromY(e.clientY); });
    add(el, 'pointermove', (e) => { if (dragging) setFromY(e.clientY); });
    const end = () => { dragging = false; el.classList.remove('ck-grab'); };
    add(el, 'pointerup', end); add(el, 'pointercancel', end);
  }
  bindLever('ck-thr', (f) => { throttle = f; q('#ck-thr-knob').style.bottom = `${f * 100}%`; q('#ck-thr-fill').style.height = `${f * 100}%`; const v = q('#ck-thr-val'); if (v) { v.textContent = `${Math.round(f * 100)}%`; v.style.color = f >= 0.6 ? '#46e05a' : '#4fb8e0'; } });
  bindLever('ck-col', (f) => { stick = (f - 0.5) * 2; q('#ck-col-knob').style.bottom = `${f * 100}%`; const v = q('#ck-col-val'); if (v) v.textContent = stick > 0.1 ? `BACK ${Math.round(stick * 100)}%` : stick < -0.1 ? `FWD ${Math.round(-stick * 100)}%` : 'NEUTRAL'; });

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    // Airspeed builds toward the throttle setting; roll eats runway while grounded.
    speed = clampNum(speed + (throttle - speed) * dt * 1.1, 0, 1);
    if (!airborne && throttle > 0) roll = clampNum(roll + speed * ROLL * dt, 0, 1);
    pitch += (stick - pitch) * Math.min(1, dt * 7);

    if (!v1 && roll >= 0.8 && throttle >= 0.6) { v1 = true; big('V1 — ROTATE!', '#ffcf3e'); csfx('flight-lock'); }

    if (!airborne) {
      if (roll >= 1 && !v1) { finish(false, 'OVERRUN — off the end of the strip'); return; }
      if (v1 && stick > 0.12) {
        if (stick > STALL_BAND) { big('⚠ OVER-ROTATE — EASE OFF', '#ff5b5b'); stallT += dt; if (stallT > 1.2) { finish(false, 'STALL on rotation'); return; } }
        else { airborne = true; stallT = 0; big('POSITIVE RATE — CLIMB', '#46e05a'); creak('gear'); q('#ck-gear').textContent = 'UP'; q('#ck-gear').style.color = '#46e05a'; }
      } else if (roll > 0.9 && stick < -0.15) { finish(false, 'NOSE-FIRST — you drove it into the ground'); return; }
      else if (stallT > 0 && stick <= STALL_BAND) { stallT = 0; big(v1 ? 'V1 — ROTATE!' : ''); }
    } else {
      // Airborne: hold gentle back-pressure to climb out.
      if (stick > STALL_BAND) { big('STALL! LEVEL OUT', '#ff5b5b'); stallT += dt; alt = clampNum(alt - 0.4 * dt, 0, 1); if (stallT > 1.4 || alt <= 0) { finish(false, 'STALL — you dropped it'); return; } }
      else if (stick < -0.05 && alt < 0.65) { big('NOSE DOWN — PULL UP', '#ff8a3e'); alt = clampNum(alt - 0.55 * dt, 0, 1); if (alt <= 0) { finish(false, 'NOSE-FIRST into the deck'); return; } }
      else { stallT = 0; if (alt < 1) big('CLIMB', '#46e05a'); alt = clampNum(alt + clampNum(stick, -0.15, 0.55) * 0.55 * dt, 0, 1); }
      if (alt >= 1) { finish(true); return; }
    }

    // Render.
    dash = (dash + speed * 220 * dt) % 30;
    q('#ck-to-rwline').setAttribute('stroke-dashoffset', `${dash}`);
    const px = 96, py = 118 - alt * 92;
    q('#ck-to-plane').setAttribute('transform', `translate(${px} ${py}) rotate(${-pitch * 22})`);
    q('#ck-to-rwrem').setAttribute('width', `${248 * (1 - roll)}`);
    q('#ck-to-rwrem').setAttribute('fill', roll > 0.85 ? '#ff5b5b' : roll > 0.6 ? '#ffb23e' : '#2f6d4a');
    q('#ck-to-asi').textContent = Math.round(speed * 160);
    q('#ck-to-pit').textContent = `${Math.round(pitch * 22)}°`;
    q('#ck-to-thrbar').style.width = `${Math.round(throttle * 100)}%`;
    setDeckLevel(overlay, roll);
    paintWindshield('ck-ws-to', { pitch: pitch * 22, bank: 0, height: alt, speed, hour: _target?.sky?.hour, weather: _target?.sky?.weather, wind: _target?.sky?.wind, phase: 'takeoff', airport: o.airport || _target?.ground?.theme });
    raf = requestAnimationFrame(tick);
  };

  q('.mg-close').addEventListener('click', () => finish(false, 'ABORT'));
  q('.ck-btn-abort').addEventListener('click', () => finish(false, 'ABORT'));
  window.AudioEngine?.init?.(); csfx('flight-roll', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// Shared vertical-lever drag: sets a 0..1 fraction from the pointer's Y in the track.
function levDrag(overlay, add, id, onFrac) {
  const el = overlay.querySelector('#' + id); if (!el) return;
  let dragging = false;
  const setY = (cy) => { const r = el.getBoundingClientRect(); onFrac(clampNum(1 - (cy - r.top) / r.height, 0, 1)); };
  add(el, 'pointerdown', (e) => { dragging = true; el.classList.add('ck-grab'); try { el.setPointerCapture(e.pointerId); } catch {} setY(e.clientY); });
  add(el, 'pointermove', (e) => { if (dragging) setY(e.clientY); });
  const end = () => { dragging = false; el.classList.remove('ck-grab'); };
  add(el, 'pointerup', end); add(el, 'pointercancel', end);
}

// ══════════════════════════════════════════════════════════════════════════════
// VTOL LIFT — the helicopter/Dragonfly minigame (collective + cyclic). mode
// 'takeoff' climbs off the pad to altitude; 'landing' settles gently back onto it.
// Raise/lower the COLLECTIVE for vertical rate; nudge ◀ ▶ (cyclic) to hold station
// over the pad against wind. Drift off the pad, or thump it down too hard, and you
// wreck it.
// ══════════════════════════════════════════════════════════════════════════════
export function openVtolLift(opts, mode) {
  ensureMgStyles(); ensureChassisStyles(); ensureTakeoffStyles(); ensureWindshieldStyles();
  const o = { skill: 4, difficulty: 5, deviceName: 'PAD', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const wind = clampNum(0.28 + o.difficulty * 0.05 - o.skill * 0.02, 0.12, 0.8);
  const HOVER = 0.5, takeoff = mode === 'takeoff';
  let coll = takeoff ? 0 : HOVER, cyc = 0, drift = 0, driftV = 0, alt = takeoff ? 0 : 1, vs = 0, over = false, raf = 0, last = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="300" height="200" fill="#04121c"/>
    <line x1="150" y1="18" x2="150" y2="184" stroke="#153040" stroke-width="1" stroke-dasharray="3 6"/>
    <ellipse cx="150" cy="180" rx="46" ry="9" fill="#0c1a12" stroke="#3f8a5c" stroke-width="1.5"/>
    <text x="150" y="183" fill="#3f8a5c" font-size="9" text-anchor="middle" font-family="monospace">H</text>
    <rect x="150" y="${takeoff ? 24 : 172}" width="0" height="8" x2="0"/>
    <line x1="118" y1="${takeoff ? 28 : 176}" x2="182" y2="${takeoff ? 28 : 176}" stroke="#46e05a" stroke-width="1.5" stroke-dasharray="4 4"/>
    <text x="186" y="${takeoff ? 31 : 179}" fill="#46e05a" font-size="7" font-family="monospace">${takeoff ? 'ALT' : 'PAD'}</text>
    <g id="ck-vt-craft"><circle cx="0" cy="0" r="7" fill="none" stroke="#4fe0a0" stroke-width="2"/><line x1="-12" y1="0" x2="12" y2="0" stroke="#4fe0a0" stroke-width="2"/><line x1="0" y1="-9" x2="0" y2="5" stroke="#4fe0a0" stroke-width="2"/></g>
    <rect x="284" y="20" width="8" height="160" rx="3" fill="#0a1620" stroke="#2b4a60"/>
    <rect id="ck-vt-tape" x="286" y="180" width="4" height="0" fill="#4fe0a0"/>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#128757;', takeoff ? 'VERTICAL LIFT' : 'VERTICAL LANDING', 'VTOL &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-deck-canopy">${windshieldHTML('ck-ws-vt', 'FWD VIEW')}</div>
    <div class="ck-hud2"><span>ALT <b id="ck-vt-altn">0%</b></span><span>DRIFT <b id="ck-vt-drift">0</b></span><span>V/S <b id="ck-vt-vs">0</b></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr-wrap"><div class="ck-scr mg-screen" style="--mg-sweep-h:200px">${scr}${crtOverlays()}</div><div class="ck-bigmsg" id="ck-bigmsg"></div></div></div>
    ${deckStrip('ROTOR BUS', 'DRIFT')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">${takeoff ? 'Raise the <b>COLLECTIVE</b> to lift off; hold it over the pad (◀ ▶) and climb out.' : 'Ease the <b>COLLECTIVE</b> down to settle gently onto the pad; stay centred (◀ ▶).'}</span></div>
    <div class="ck-levers">
      <button class="ck-btn ck-btn-l" style="flex:0.5">◀</button>
      <div class="ck-lever" id="ck-coll"><div class="ck-lever-fill" id="ck-coll-fill" style="height:${coll * 100}%"></div><div class="ck-lever-v1" style="bottom:50%"></div><div class="ck-lever-knob" id="ck-coll-knob" style="bottom:${coll * 100}%"></div><div class="ck-lever-lbl">COLLECTIVE<b id="ck-coll-val">${Math.round(coll * 100)}%</b></div></div>
      <button class="ck-btn ck-btn-r" style="flex:0.5">▶</button>
    </div>
    <div class="ck-actions"><button class="ck-btn ck-btn-abort">Abort</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const big = (h, c) => { const el = q('#ck-bigmsg'); if (el) { el.innerHTML = h || ''; el.style.color = c || '#ffcf3e'; } };

  const finish = (won, why) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? (takeoff ? 'flight-rotate' : 'flight-touchdown') : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    disposeWindshield('ck-ws-vt');
    if (!won) creak('stress'); else creak('gear');
    big(won ? (takeoff ? '◇ AIRBORNE' : '◇ ON THE PAD') : '✕ ' + (why || 'CRASH'), won ? '#46e05a' : '#ff5b5b');
    setStatus(won ? `<span class="ck-win">◇ ${takeoff ? 'Clean lift-off — climbing away.' : 'Soft touchdown — skids down.'}</span>` : `<span class="ck-lose">✕ ${why || 'CRASH'}.</span>`);
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1100);
  };

  levDrag(overlay, add, 'ck-coll', (f) => { coll = f; q('#ck-coll-knob').style.bottom = `${f * 100}%`; q('#ck-coll-fill').style.height = `${f * 100}%`; const v = q('#ck-coll-val'); if (v) v.textContent = `${Math.round(f * 100)}%`; });
  const lb = q('.ck-btn-l'), rb = q('.ck-btn-r');
  add(lb, 'pointerdown', (e) => { e.preventDefault(); cyc = -1; }); add(lb, 'pointerup', () => cyc = 0);
  add(rb, 'pointerdown', (e) => { e.preventDefault(); cyc = 1; }); add(rb, 'pointerup', () => cyc = 0);
  add(window, 'keydown', (e) => { const k = e.key.toLowerCase(); if (k === 'a' || k === 'arrowleft') cyc = -1; else if (k === 'd' || k === 'arrowright') cyc = 1; });
  add(window, 'keyup', (e) => { const k = e.key.toLowerCase(); if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) cyc = 0; });
  q('.mg-close').addEventListener('click', () => finish(false, 'ABORT'));
  q('.ck-btn-abort').addEventListener('click', () => finish(false, 'ABORT'));

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    driftV += ((Math.random() - 0.5) * wind - cyc * 1.5) * dt; driftV *= 0.9; drift = clampNum(drift + driftV * dt, -1, 1);
    vs = (coll - HOVER) * 1.3;
    alt = clampNum(alt + vs * dt, 0, 1.05);
    if (Math.abs(drift) >= 1) { finish(false, takeoff ? 'DRIFTED OFF — clipped something' : 'DRIFTED OFF the pad'); return; }
    if (Math.abs(drift) > 0.55) big('DRIFTING — CENTRE IT', '#ff8a3e');
    else if (!takeoff && alt < 0.25 && vs < -0.24) big('TOO FAST — RAISE COLLECTIVE', '#ff5b5b');
    else big(takeoff ? (alt > 0.05 ? 'CLIMB' : '') : 'EASE IT DOWN', takeoff ? '#46e05a' : '#8fd0ff');
    if (takeoff && alt >= 1) { finish(Math.abs(drift) < 0.5); return; }
    if (!takeoff && alt <= 0.02) { finish(Math.abs(vs) < 0.2 && Math.abs(drift) < 0.4, Math.abs(vs) >= 0.2 ? 'HARD LANDING — dropped it on the pad' : 'OFF THE PAD'); return; }
    // render
    q('#ck-vt-craft').setAttribute('transform', `translate(${150 + drift * 90} ${180 - alt * 150})`);
    q('#ck-vt-tape').setAttribute('height', `${alt * 158}`); q('#ck-vt-tape').setAttribute('y', `${180 - alt * 158}`);
    q('#ck-vt-altn').textContent = `${Math.round(alt * 100)}%`;
    q('#ck-vt-drift').textContent = Math.abs(drift) < 0.1 ? 'CTR' : (drift < 0 ? '◀' : '▶') + Math.round(Math.abs(drift) * 100);
    q('#ck-vt-vs').textContent = (vs >= 0 ? '+' : '') + Math.round(vs * 500);
    setDeckLevel(overlay, Math.abs(drift));
    paintWindshield('ck-ws-vt', { pitch: vs * 30, bank: -drift * 10, height: alt, speed: 0.12, drift, hour: _target?.sky?.hour, weather: _target?.sky?.weather, wind: _target?.sky?.wind, phase: 'vtol' });
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx(takeoff ? 'flight-roll' : 'flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. APPROACH — unified with takeoff: THROTTLE lever + CONTROL COLUMN, then flare
// ══════════════════════════════════════════════════════════════════════════════
export function openGlideslope(opts = {}) {
  if (opts.vtol) return openVtolLift(opts, 'landing');   // helicopters set down vertically
  ensureMgStyles(); ensureChassisStyles(); ensureTakeoffStyles(); ensureWindshieldStyles();
  const o = { skill: 4, difficulty: 5, emergency: false, deviceName: 'FIELD', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const STALL_BAND = clampNum(0.58 - edge * 0.02, 0.46, 0.66);
  const descentRate = o.emergency ? 0.10 : 0.075;    // approach clock 0→1
  const gustF = clampNum(0.3 + o.difficulty * 0.04 - o.skill * 0.02 + (o.emergency ? 0.25 : 0), 0.1, 0.9);

  let throttle = o.emergency ? 0 : 0.4, stick = 0, pitch = 0, height = 1, descent = 0, sink = 0.1, over = false, raf = 0, last = 0, dash = 0, flared = false;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="ck-la-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
      <linearGradient id="ck-la-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f3a20"/><stop offset="1" stop-color="#161c10"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="300" height="128" fill="url(#ck-la-sky)"/>
    <rect x="0" y="128" width="300" height="42" fill="url(#ck-la-gnd)"/>
    <polygon id="ck-la-rw" points="120,168 180,168 165,132 135,132" fill="#2a3420" stroke="#3f8a5c" stroke-width="1"/>
    <line id="ck-la-cl" x1="150" y1="168" x2="150" y2="132" stroke="#cfe8d6" stroke-width="1.5" stroke-dasharray="8 8"/>
    <!-- glideslope scale (right): keep the diamond centred -->
    <line x1="284" y1="20" x2="284" y2="150" stroke="#2b4a60" stroke-width="1.5"/>
    ${[20, 52, 85, 118, 150].map(y => `<circle cx="284" cy="${y}" r="3" fill="none" stroke="#5f8fa8" stroke-width="1"/>`).join('')}
    <polygon id="ck-la-gs" points="284,78 290,85 284,92 278,85" fill="#4fb8e0"/>
    <text x="284" y="14" fill="#5f8fa8" font-size="7" text-anchor="middle" font-family="monospace">G/S</text>
    <g id="ck-la-plane" transform="translate(70 40)"><path d="M-16,2 L10,-1 L16,2 L10,5 L-16,3 Z M-4,-2 L2,-9 L4,-2 Z M-16,3 L-20,-3 L-13,0 Z" fill="#eaf6ff" stroke="#4fb8e0" stroke-width="0.8"/></g>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#128758;', o.emergency ? 'DEAD STICK' : 'APPROACH', 'LANDING &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-deck-canopy">${windshieldHTML('ck-ws-la', 'FWD VIEW')}</div>
    <div class="ck-hud2"><span>ALT <b id="ck-la-alt">—</b></span><span>SINK <b id="ck-la-sink">0</b></span><span>G/S <b id="ck-la-gsr">—</b></span>
      <span class="ck-asi-wrap">THR <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-la-thrbar" style="background:linear-gradient(90deg,#7a5310,#ffb23e)"></span></span></span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr-wrap"><div class="ck-scr mg-screen" style="--mg-sweep-h:170px">${scr}${crtOverlays()}</div><div class="ck-bigmsg" id="ck-bigmsg"></div></div></div>
    ${deckStrip('CONTROL BUS', 'DEVIATION')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">${o.emergency ? 'No power — glide it down on the COLUMN.' : 'THROTTLE for energy, COLUMN for pitch. Hold the glidepath; FLARE at the threshold.'}</span></div>
    <div class="ck-levers">
      <div class="ck-lever" id="ck-la-thr"><div class="ck-lever-fill" id="ck-la-thrfill" style="height:${throttle * 100}%"></div><div class="ck-lever-knob" id="ck-la-thrknob" style="bottom:${throttle * 100}%"></div><div class="ck-lever-lbl">THROTTLE<b id="ck-la-thrval">${Math.round(throttle * 100)}%</b></div></div>
      <div class="ck-lever" id="ck-la-col"><div class="ck-lever-mid"></div><div class="ck-lever-knob" id="ck-la-colknob" style="bottom:50%"></div><div class="ck-lever-lbl">COLUMN<b id="ck-la-colval">NEUTRAL</b></div></div>
    </div>
    <div class="ck-actions"><button class="ck-btn ck-btn-abort">${o.emergency ? 'Bail' : 'Go Around'}</button></div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const big = (h, c) => { const el = q('#ck-bigmsg'); if (el) { el.innerHTML = h || ''; el.style.color = c || '#ffcf3e'; } };

  const finish = (won, why) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-touchdown' : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    disposeWindshield('ck-ws-la');
    if (!won) creak('stress');
    big(won ? '◇ TOUCHDOWN' : '✕ ' + (why || 'CRASH'), won ? '#46e05a' : '#ff5b5b');
    setStatus(won ? '<span class="ck-win">◇ Mains, nose, brakes — down safe.</span>' : `<span class="ck-lose">✕ ${why || 'CRASH'}.</span>`);
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1150);
  };

  levDrag(overlay, add, 'ck-la-thr', (f) => { throttle = f; q('#ck-la-thrknob').style.bottom = `${f * 100}%`; q('#ck-la-thrfill').style.height = `${f * 100}%`; const v = q('#ck-la-thrval'); if (v) v.textContent = `${Math.round(f * 100)}%`; });
  levDrag(overlay, add, 'ck-la-col', (f) => { stick = (f - 0.5) * 2; q('#ck-la-colknob').style.bottom = `${f * 100}%`; const v = q('#ck-la-colval'); if (v) v.textContent = stick > 0.1 ? `BACK ${Math.round(stick * 100)}%` : stick < -0.1 ? `FWD ${Math.round(-stick * 100)}%` : 'NEUTRAL'; });
  q('.mg-close').addEventListener('click', () => finish(false, 'GO-AROUND'));
  q('.ck-btn-abort').addEventListener('click', () => finish(false, 'GO-AROUND'));

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    pitch += (stick - pitch) * Math.min(1, dt * 7);
    descent = clampNum(descent + descentRate * dt, 0, 1.05);
    // Sink rate: pull back (pitch up) + power reduce it; nose-down + idle steepen it.
    sink = clampNum(0.12 - stick * 0.10 - (throttle - 0.45) * 0.06 + (Math.random() - 0.5) * gustF * 0.03, 0, 0.30);
    height = clampNum(height - sink * dt, 0, 1);
    const dev = height - (1 - descent);   // >0 HIGH, <0 LOW
    // Fail modes.
    if (stick > STALL_BAND && throttle < 0.4) { big('STALL — NOSE DOWN, ADD POWER', '#ff5b5b'); if (height <= 0.5) { finish(false, 'STALL on final'); return; } }
    else if (stick < -0.25 && height < 0.22) { big('NOSE DOWN — PULL UP', '#ff8a3e'); if (height <= 0.03) { finish(false, 'NOSE-FIRST into the threshold'); return; } }
    else if (descent >= 0.85) { flared = flared || stick > 0.12; big('FLARE — EASE IT ON', '#ffcf3e'); }
    else if (dev > 0.18) big('HIGH — reduce power / nose down', '#ffb23e');
    else if (dev < -0.18) big('LOW — add power / nose up', '#ffb23e');
    else big('ON GLIDEPATH', '#46e05a');
    // Touchdown.
    if (height <= 0.02 || descent >= 1) {
      if (descent < 0.8) { finish(false, 'landed short — you dropped it in early'); return; }
      const onGs = Math.abs(dev) < 0.16, soft = sink < 0.14, gentle = stick > 0.05 && stick <= STALL_BAND;
      finish(onGs && soft && gentle && flared, !soft ? 'HARD LANDING — too much sink' : !onGs ? 'off the glidepath at the threshold' : 'you forgot to flare');
      return;
    }
    // Render.
    dash = (dash + (1 - descent) * 60 * dt) % 16;
    const g = Math.min(1, descent), half = 15 + g * 40, topY = 132 - g * 24, cx = 150;
    q('#ck-la-rw').setAttribute('points', `${cx - half},168 ${cx + half},168 ${cx + half * 0.55},${topY} ${cx - half * 0.55},${topY}`);
    q('#ck-la-cl').setAttribute('y2', `${topY}`); q('#ck-la-cl').setAttribute('stroke-dashoffset', `${dash}`);
    q('#ck-la-plane').setAttribute('transform', `translate(70 ${40 + (1 - height) * 78}) rotate(${-pitch * 20})`);
    const gy = clampNum(85 - dev * 260, 20, 150); const gs = q('#ck-la-gs'); gs.setAttribute('points', `284,${gy - 7} 290,${gy} 284,${gy + 7} 278,${gy}`); gs.setAttribute('fill', Math.abs(dev) < 0.16 ? '#46e05a' : '#ff8a3e');
    q('#ck-la-alt').textContent = `${Math.round(height * (o.emergency ? 300 : 600))}ft`;
    q('#ck-la-sink').textContent = `-${Math.round(sink * 900)}`;
    q('#ck-la-gsr').textContent = Math.abs(dev) < 0.16 ? 'ON' : dev > 0 ? 'HIGH' : 'LOW';
    q('#ck-la-thrbar').style.width = `${Math.round(throttle * 100)}%`;
    setDeckLevel(overlay, Math.min(1, Math.abs(dev) / 0.3));
    paintWindshield('ck-ws-la', { pitch: pitch * 20, bank: 0, height, speed: 0.32 + throttle * 0.4, hour: _target?.sky?.hour, weather: _target?.sky?.weather, phase: 'landing', airport: o.airport });
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. TARGETING — the gun-pass reticle deck
// ══════════════════════════════════════════════════════════════════════════════
export function openTargeting(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 6, deviceName: 'TARGET', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const lockRadius = clampNum(0.16 + edge * 0.014, 0.08, 0.28);
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
    <line x1="110" y1="14" x2="110" y2="206" stroke="#153040" stroke-width="1"/><line x1="14" y1="110" x2="206" y2="110" stroke="#153040" stroke-width="1"/>
    <g id="ck-tgt"><rect x="-9" y="-9" width="18" height="18" fill="none" stroke="#ff8a3e" stroke-width="2"/><circle cx="0" cy="0" r="2.5" fill="#ff8a3e"/></g>
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
  const overlay = mounted.overlay; const svg = overlay.querySelector('#ck-tgt-svg');
  const setStatus = (h) => { const el = overlay.querySelector('#ck-status'); if (el) el.innerHTML = h; };

  const finish = (won) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-guns' : 'flight-abort', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ SPLASH — target destroyed.</span>' : '<span class="ck-lose">✕ No hits — you overfly the target.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 950);
  };
  const fire = () => { if (over) return; finish(!!locked); };
  const svgXY = (e) => { const r = svg.getBoundingClientRect(); return { x: clampNum((e.clientX - r.left) / r.width, 0, 1), y: clampNum((e.clientY - r.top) / r.height, 0, 1) }; };
  add(svg, 'pointermove', (e) => { ret = svgXY(e); });
  add(window, 'keydown', (e) => { const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') ret.x = clampNum(ret.x - 0.05, 0, 1); else if (k === 'arrowright' || k === 'd') ret.x = clampNum(ret.x + 0.05, 0, 1);
    else if (k === 'arrowup' || k === 'w') ret.y = clampNum(ret.y - 0.05, 0, 1); else if (k === 'arrowdown' || k === 's') ret.y = clampNum(ret.y + 0.05, 0, 1);
    else if (k === ' ' || k === 'spacebar') { e.preventDefault(); fire(); } });
  overlay.querySelector('.ck-btn-fire').addEventListener('click', fire);
  overlay.querySelector('.ck-btn-abort').addEventListener('click', () => finish(false));
  overlay.querySelector('.mg-close').addEventListener('click', () => finish(false));

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; if (!t0) t0 = t;
    tgtT -= dt; if (tgtT <= 0) { tgt.tx = 0.2 + Math.random() * 0.6; tgt.ty = 0.15 + Math.random() * 0.5; tgtT = 0.4 + Math.random() / jink; }
    tgt.x += ((tgt.tx ?? 0.5) - tgt.x) * Math.min(1, jink * dt * 2); tgt.y += ((tgt.ty ?? 0.3) - tgt.y) * Math.min(1, jink * dt * 2);
    const d = Math.hypot(ret.x - tgt.x, ret.y - tgt.y), on = d <= lockRadius;
    lock = clampNum(lock + (on ? lockRate : -lockRate * 1.3) * dt, 0, 1);
    const wasLocked = locked; locked = lock >= 1; if (locked && !wasLocked) csfx('flight-lock');
    const px = (v) => 14 + v * 192;
    overlay.querySelector('#ck-ret').setAttribute('transform', `translate(${px(ret.x)} ${px(ret.y)})`);
    overlay.querySelector('#ck-tgt').setAttribute('transform', `translate(${px(tgt.x)} ${px(tgt.y)})`);
    overlay.querySelector('#ck-ret').style.stroke = locked ? '#46e05a' : on ? '#ffb23e' : '#4fb8e0';
    overlay.querySelector('#ck-lock').style.width = `${Math.round(lock * 100)}%`;
    setDeckLevel(overlay, lock);
    if (locked && !wasLocked) setStatus('<span style="color:#46e05a">LOCK — FIRE!</span>');
    if ((t - t0) / 1000 >= TIME) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  };
  window.AudioEngine?.init?.(); csfx('flight-approach', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}
