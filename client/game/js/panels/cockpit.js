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
import { updateEngineAudio, stopEngineAudio, creak, spoolUp, spoolDown } from './engine-audio.js';

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

  // Rebuild the panel only when the aircraft's capability layout changes.
  const sig = `${_target.class}|${_target.engines?.length || 1}|${(_target.hardpoints || 0) > 0}|${(_target.cargoCap || 0) > 0}|${!!_target.vtol}`;
  const root = document.getElementById('ck-hud-root');
  if (!root || _sig !== sig) { mountHud(_target); _sig = sig; }

  if (!_anim) _anim = { hdg: _target.headingDeg || 0, pitch: 0, roll: 0, sweep: 0, eng: _target.engines?.map(e => e.pct) || [0], fuel: _target.fuelPct || 0, thr: _target.throttle || 0, hull: _target.hullPct || 100, spd: _target.spd || 0 };
  if (!_raf) { _lastT = performance.now(); _raf = requestAnimationFrame(hudFrame); }
  applyText(_target);
}

export function closeCockpit() {
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
  _raf = requestAnimationFrame(hudFrame);
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

// ── Compose the DOM from the aircraft's capabilities + size ───────────────────
function mountHud(s) {
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
    .ck-hud { --acc:#4fb8e0; font-family:'Courier New',monospace; color:#a9d4ec; padding:6px;
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
    /* Capability-driven flex layout: rows of instrument cards. Which cards exist,
       and the radar's size, are chosen per aircraft in mountHud(). */
    .ck-grid { display:flex; flex-direction:column; gap:8px; padding:8px 2px 2px; }
    .ck-row { display:flex; gap:8px; align-items:stretch; }
    .ck-row-top .ck-inst-adi { flex:1 1 40%; }
    .ck-row > .ck-inst { flex:1 1 0; min-width:0; }
    .ck-radar-sm { flex:1.1 1 0 !important; } .ck-radar-md { flex:1.5 1 0 !important; } .ck-radar-lg { flex:2 1 0 !important; }
    .ck-inst { position:relative; padding:6px; border-radius:8px;
      background:linear-gradient(160deg, #2a333c, #161c22 70%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.5); }
    .ck-inst-lbl { position:absolute; top:5px; left:9px; font-size:8px; letter-spacing:2px; color:#5f8299; z-index:2; }
    .ck-svg { display:block; width:100%; height:auto; }
    .ck-inst-radar .ck-svg { max-height:none; }
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
export function openTakeoff(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 5, vtol: false, deviceName: 'CRAFT', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const accel = clampNum(0.40 + edge * 0.03, 0.22, 0.78);
  const rollRate = clampNum(0.05 - edge * 0.003, 0.026, 0.072);
  const xwind = clampNum(0.35 + o.difficulty * 0.05 - o.skill * 0.02, 0.2, 1.2);   // crosswind pushing you off centreline
  const V1 = 0.55, VR = 0.78, V2 = 0.92;

  let hold = false, speed = 0, dist = 0, cl = 0, clVel = 0, rotated = false, gearUp = false, over = false, raf = 0, last = 0, clOffset = 0;
  let steer = 0;   // -1..1 player rudder input
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const runway = `<svg viewBox="0 0 220 210" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="ck-rw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1a12"/><stop offset="1" stop-color="#16281b"/></linearGradient></defs>
    <polygon points="80,14 140,14 196,196 24,196" fill="url(#ck-rw)" stroke="#2f6d4a" stroke-width="1.5"/>
    <g id="ck-rw-lines" stroke="#cfe8d6" stroke-width="2" stroke-dasharray="10 12">
      <line x1="110" y1="20" x2="110" y2="196" id="ck-rw-line"/>
    </g>
    <line x1="70" y1="${210 - V1 * 196}" x2="150" y2="${210 - V1 * 196}" stroke="#5f8fa8" stroke-width="1" stroke-dasharray="3 5"/><text x="152" y="${212 - V1 * 196}" fill="#5f8fa8" font-size="8" font-family="monospace">V1</text>
    <line x1="64" y1="${210 - VR * 196}" x2="156" y2="${210 - VR * 196}" stroke="#46e05a" stroke-width="2" stroke-dasharray="4 4"/><text x="158" y="${212 - VR * 196}" fill="#46e05a" font-size="9" font-family="monospace">Vr</text>
    <g id="ck-rw-plane" transform="translate(110 186)"><path d="M0,-11 L4,-3 L12,3 L4,4 L2,11 L-2,11 L-4,4 L-12,3 L-4,-3 Z" fill="#d6f0ff" stroke="#4fb8e0" stroke-width="0.7"/></g>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#9992;', o.vtol ? 'LIFT-OFF' : 'TAKEOFF', 'DEPARTURE &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-hud2">
      <span>RWY <b id="ck-rwy">FULL</b></span><span>GEAR <b id="ck-gear">DOWN</b></span>
      <span class="ck-asi-wrap">ASI <span class="ck-asi-bar"><span class="ck-asi-fill" id="ck-asi"></span><span class="ck-asi-vr" style="left:${VR * 100}%"></span></span></span>
    </div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr mg-screen" style="--mg-sweep-h:210px">${runway}${crtOverlays()}</div></div>
    ${deckStrip('THROTTLE BUS', 'RWY USED')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">HOLD throttle to accelerate. Keep it on the centreline (◀ ▶ / A-D). Rotate at Vr.</span></div>
    <div class="ck-actions">
      <button class="ck-btn ck-btn-l">◀</button>
      <button class="ck-btn ck-btn-hold" style="flex:2">Throttle Up &#9251;</button>
      <button class="ck-btn ck-btn-r">▶</button>
      <button class="ck-btn ck-btn-abort">Abort</button>
    </div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const setHold = (on) => { hold = on; q('.ck-btn-hold')?.classList.toggle('ck-down', on); };

  const finish = (won) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-rotate' : 'flight-abort', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ POSITIVE RATE — gear up, you\'re flying.</span>' : '<span class="ck-lose">✕ ABORT — off the side / out of strip.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1050);
  };

  let calledV1 = false;
  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    speed = clampNum(speed + (hold ? accel : -0.16) * dt, 0, 1);
    dist = clampNum(dist + speed * rollRate * dt * 12, 0, 1);
    // Centreline: crosswind shoves, steer corrects; worse the faster you go.
    clVel += ((Math.random() - 0.5) * xwind - steer * 1.8) * dt * (0.6 + speed);
    clVel *= 0.9; cl = clampNum(cl + clVel * dt, -1, 1);
    if (Math.abs(cl) >= 1) { finish(false); return; }
    // Callouts.
    if (!calledV1 && speed >= V1) { calledV1 = true; setStatus('<span class="ck-call">V1</span>'); csfx('flight-lock'); }
    if (speed >= VR && !rotated) { setStatus('<span class="ck-call">ROTATE</span>'); }
    // Render.
    const pl = q('#ck-rw-plane'); if (pl) pl.setAttribute('transform', `translate(${110 + cl * 46} ${186 - dist * 146})`);
    clOffset = (clOffset + speed * 200 * dt) % 22; const line = q('#ck-rw-line'); if (line) line.setAttribute('stroke-dashoffset', `${clOffset}`);
    q('#ck-asi').style.width = `${Math.round(speed * 100)}%`;
    q('#ck-rwy').textContent = dist > 0.82 ? 'SHORT' : dist > 0.4 ? `${Math.round((1 - dist) * 100)}%` : 'FULL';
    setDeckLevel(overlay, dist);
    if (speed >= V2 && rotated && !gearUp) { gearUp = true; q('#ck-gear').textContent = 'UP'; q('#ck-gear').style.color = '#46e05a'; creak('gear'); finish(true); return; }
    if (dist >= 1 && speed < VR) { finish(false); return; }
    raf = requestAnimationFrame(tick);
  };
  const rotate = () => { if (over || rotated) return; if (speed >= VR) { rotated = true; creak('stress'); setStatus('<span class="ck-call">POSITIVE RATE</span>'); } else finish(false); };

  q('.mg-close').addEventListener('click', () => finish(false));
  q('.ck-btn-abort').addEventListener('click', () => finish(false));
  const holdBtn = q('.ck-btn-hold');
  add(holdBtn, 'pointerdown', (e) => { e.preventDefault(); setHold(true); }); add(window, 'pointerup', () => setHold(false)); add(window, 'pointercancel', () => setHold(false));
  const lb = q('.ck-btn-l'), rb = q('.ck-btn-r');
  add(lb, 'pointerdown', (e) => { e.preventDefault(); steer = -1; }); add(lb, 'pointerup', () => steer = 0);
  add(rb, 'pointerdown', (e) => { e.preventDefault(); steer = 1; }); add(rb, 'pointerup', () => steer = 0);
  add(window, 'keydown', (e) => { const k = e.key.toLowerCase();
    if ((k === ' ' || k === 'spacebar') && !e.repeat) { e.preventDefault(); setHold(true); }
    else if (k === 'a' || k === 'arrowleft') steer = -1;
    else if (k === 'd' || k === 'arrowright') steer = 1;
    else if (k === 'r' || k === 'enter') rotate(); });
  add(window, 'keyup', (e) => { const k = e.key.toLowerCase(); if (k === ' ' || k === 'spacebar') setHold(false); else if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) steer = 0; });
  // A rotate button appears once at Vr via the same steer buttons? Provide Enter/R + a click on plane.
  add(overlay.querySelector('.ck-scr'), 'pointerdown', () => rotate());
  window.AudioEngine?.init?.(); csfx('flight-roll', 'hololock-entry');
  last = performance.now(); raf = requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. GLIDESLOPE — localizer + glideslope, gear/flaps, flare + rollout
// ══════════════════════════════════════════════════════════════════════════════
export function openGlideslope(opts = {}) {
  ensureMgStyles(); ensureChassisStyles();
  const o = { skill: 4, difficulty: 5, emergency: false, deviceName: 'FIELD', onResult: null, ...opts };
  const edge = o.skill - o.difficulty;
  const gate = clampNum(0.28 + edge * 0.025, 0.13, 0.46);       // capture window (both axes)
  const force = clampNum(0.5 + o.difficulty * 0.05 - o.skill * 0.02 + (o.emergency ? 0.35 : 0), 0.3, 1.5);
  const descentRate = o.emergency ? 0.11 : 0.07;

  const LIFT = 1.7, GRAV = 1.15, DAMP = 0.86;
  let hold = false, pos = 0.5, vel = 0;         // vertical (glideslope)
  let loc = 0.5, locVel = 0, steer = 0;         // horizontal (localizer)
  let descent = 0, inBand = 0, gearDown = false, flareArmed = false, flareHit = false, over = false, raf = 0, last = 0;
  const listeners = [];
  const add = (t, ty, fn, op) => { t.addEventListener(ty, fn, op); listeners.push([t, ty, fn, op]); };

  const scr = `<svg viewBox="0 0 240 250" preserveAspectRatio="xMidYMid meet">
    <defs>
      <clipPath id="ck-hz-clip"><rect x="8" y="8" width="184" height="234" rx="10"/></clipPath>
      <linearGradient id="ck-hz-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e4c78"/><stop offset="1" stop-color="#1a6fa8"/></linearGradient>
      <linearGradient id="ck-hz-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f18"/><stop offset="1" stop-color="#241a0c"/></linearGradient>
    </defs>
    <g clip-path="url(#ck-hz-clip)">
      <g id="ck-hz">
        <rect x="-140" y="-200" width="480" height="340" fill="url(#ck-hz-sky)"/>
        <rect x="-140" y="125" width="480" height="340" fill="url(#ck-hz-gnd)"/>
        <line x1="-140" y1="125" x2="340" y2="125" stroke="#eaf6ff" stroke-width="1.5"/>
      </g>
      <polygon id="ck-runway" points="96,240 104,240 103,240 97,240" fill="#0c1a12" stroke="#3f8a5c" stroke-width="1"/>
      <line id="ck-rw-cl" x1="100" y1="240" x2="100" y2="240" stroke="#cfe8d6" stroke-width="1.5" stroke-dasharray="4 5"/>
    </g>
    <!-- fixed aircraft ref -->
    <path d="M70,125 L92,125 M108,125 L130,125" stroke="#ffcf3e" stroke-width="3" stroke-linecap="round"/>
    <rect x="96" y="121" width="8" height="8" fill="none" stroke="#ffcf3e" stroke-width="2"/>
    <!-- localizer (bottom) + glideslope (right) needles -->
    <line x1="40" y1="224" x2="160" y2="224" stroke="#2b4a60" stroke-width="1.5"/>
    ${[40, 70, 100, 130, 160].map(x => `<circle cx="${x}" cy="224" r="3" fill="none" stroke="#5f8fa8" stroke-width="1"/>`).join('')}
    <line id="ck-loc-need" x1="100" y1="212" x2="100" y2="236" stroke="#4fb8e0" stroke-width="2.5"/>
    <line x1="208" y1="40" x2="208" y2="210" stroke="#2b4a60" stroke-width="1.5"/>
    ${[40, 82, 125, 168, 210].map(y => `<circle cx="208" cy="${y}" r="3" fill="none" stroke="#5f8fa8" stroke-width="1"/>`).join('')}
    <line id="ck-gs-need" x1="196" y1="125" x2="220" y2="125" stroke="#4fb8e0" stroke-width="2.5"/>
    <text x="208" y="26" fill="#5f8fa8" font-size="8" text-anchor="middle" font-family="monospace">G/S</text>
    <text x="100" y="248" fill="#5f8fa8" font-size="8" text-anchor="middle" font-family="monospace">LOC</text>
    <rect x="8" y="8" width="224" height="234" rx="10" fill="none" stroke="#22465a" stroke-width="2"/>
  </svg>`;

  const html = `<div class="ck-panel mg-chassis">
    ${deviceHeader('&#128758;', o.emergency ? 'DEAD STICK' : 'APPROACH', 'ILS &middot; ' + esc(o.deviceName).toUpperCase())}
    <div class="ck-hud2"><span>ALT <b id="ck-alt">—</b></span><span>GEAR <b id="ck-gear">UP</b></span><span>G/S <b id="ck-gs">—</b></span><span class="ck-asi-wrap">${o.emergency ? '<span style="color:#ff5b5b">NO ENGINE</span>' : 'ILS'}</span></div>
    <div class="mg-bezel">${bezelScrews()}<div class="ck-scr mg-screen" style="--mg-sweep-h:250px">${scr}${crtOverlays()}</div></div>
    ${deckStrip('CONTROL BUS', 'DEVIATION')}
    <div class="ck-status2" id="ck-status"><span class="ck-hint">HOLD to arrest sink · ◀ ▶ track the localizer · GEAR down · FLARE at touchdown.</span></div>
    <div class="ck-actions">
      <button class="ck-btn ck-btn-l">◀</button>
      <button class="ck-btn ck-btn-hold" style="flex:1.6">Pull Up &#9251;</button>
      <button class="ck-btn ck-btn-r">▶</button>
      <button class="ck-btn ck-btn-gear">Gear</button>
      <button class="ck-btn ck-btn-flare">Flare</button>
    </div>
  </div>`;

  const mounted = mountOverlay({ id: 'cockpit-overlay', html, closeOnBackdrop: false,
    onClose: () => { if (raf) cancelAnimationFrame(raf); for (const [t, ty, fn, op] of listeners) t.removeEventListener(ty, fn, op); } });
  const overlay = mounted.overlay; const q = (s) => overlay.querySelector(s);
  const setStatus = (h) => { const el = q('#ck-status'); if (el) el.innerHTML = h; };
  const setHold = (on) => { hold = on; q('.ck-btn-hold')?.classList.toggle('ck-down', on); };
  const onGS = () => Math.abs(pos - 0.5) <= gate / 2 && Math.abs(loc - 0.5) <= gate / 2;

  const finish = (won) => {
    if (over) return; over = true; if (raf) cancelAnimationFrame(raf); raf = 0;
    csfx(won ? 'flight-touchdown' : 'flight-crash', won ? 'hololock-win' : 'hololock-lose');
    setStatus(won ? '<span class="ck-win">◇ TOUCHDOWN — mains, nose, brakes. Down safe.</span>' : '<span class="ck-lose">✕ Unstable at the threshold — hard arrival.</span>');
    setTimeout(() => { mounted.close(); if (o.onResult) o.onResult({ won }); }, 1100);
  };

  const render = () => {
    const pitch = (pos - 0.5) * 120, roll = clampNum((loc - 0.5) * 80 + vel * 20, -18, 18);
    const hz = q('#ck-hz'); if (hz) hz.setAttribute('transform', `translate(0 ${pitch}) rotate(${roll} 100 125)`);
    const gy = clampNum(125 + (pos - 0.5) * 340, 42, 210); const gsn = q('#ck-gs-need'); if (gsn) { gsn.setAttribute('y1', gy); gsn.setAttribute('y2', gy); gsn.setAttribute('stroke', Math.abs(pos - 0.5) <= gate / 2 ? '#46e05a' : '#ff8a3e'); }
    const lx = clampNum(100 + (loc - 0.5) * 240, 40, 160); const lcn = q('#ck-loc-need'); if (lcn) { lcn.setAttribute('x1', lx); lcn.setAttribute('x2', lx); lcn.setAttribute('stroke', Math.abs(loc - 0.5) <= gate / 2 ? '#46e05a' : '#ff8a3e'); }
    const g = Math.min(1, descent), half = 3 + g * 40, topY = 240 - g * 150, cx = 100 + (loc - 0.5) * 30;
    const rw = q('#ck-runway'); if (rw) rw.setAttribute('points', `${cx - 3},240 ${cx + 3},240 ${cx + half},${topY} ${cx - half},${topY}`);
    const cln = q('#ck-rw-cl'); if (cln) { cln.setAttribute('x1', cx); cln.setAttribute('x2', cx); cln.setAttribute('y2', topY); }
    q('#ck-alt').textContent = `${Math.max(0, Math.round((1 - descent) * (o.emergency ? 300 : 600)))}ft`;
    q('#ck-gs').textContent = onGS() ? 'ON' : (pos < 0.5 ? 'HIGH' : 'LOW');
    setDeckLevel(overlay, Math.min(1, (Math.abs(pos - 0.5) + Math.abs(loc - 0.5)) / gate));
  };

  const tick = (t) => {
    if (over) return; const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    vel = (vel + (hold ? -LIFT : GRAV) * dt) * DAMP; pos = clampNum(pos + vel * dt, 0.04, 0.96);
    if (pos <= 0.04 || pos >= 0.96) vel = 0;
    pos = clampNum(pos + (Math.random() - 0.5) * force * dt * 0.5, 0.04, 0.96);
    locVel += ((Math.random() - 0.5) * force - steer * 1.6) * dt; locVel *= 0.9; loc = clampNum(loc + locVel * dt, 0.04, 0.96);
    if (onGS()) inBand += dt;
    descent = clampNum(descent + descentRate * dt, 0, 1);
    if (descent >= 0.6 && !gearDown) setStatus('<span style="color:#ffb23e">GEAR — put it down.</span>');
    if (descent >= 0.87 && !flareArmed) { flareArmed = true; q('.ck-btn-flare')?.classList.add('ck-armed'); csfx('flight-flare'); setStatus('<span class="ck-call">FLARE</span>'); }
    render();
    if (descent >= 1) { finish(onGS() && flareHit && gearDown && inBand > descent * 0.85); return; }
    raf = requestAnimationFrame(tick);
  };
  const doGear = () => { if (over || gearDown) return; gearDown = true; q('#ck-gear').textContent = 'DOWN'; q('#ck-gear').style.color = '#46e05a'; q('.ck-btn-gear')?.classList.add('ck-lit'); creak('gear'); };
  const doFlare = () => { if (over || flareHit) return; if (!flareArmed) { finish(false); return; } flareHit = true; q('.ck-btn-flare')?.classList.remove('ck-armed'); setStatus('<span style="color:#8fd0ff">Flared — hold it off…</span>'); };

  q('.mg-close').addEventListener('click', () => finish(false));
  const holdBtn = q('.ck-btn-hold');
  add(holdBtn, 'pointerdown', (e) => { e.preventDefault(); setHold(true); }); add(window, 'pointerup', () => setHold(false)); add(window, 'pointercancel', () => setHold(false));
  const lb = q('.ck-btn-l'), rb = q('.ck-btn-r');
  add(lb, 'pointerdown', (e) => { e.preventDefault(); steer = -1; }); add(lb, 'pointerup', () => steer = 0);
  add(rb, 'pointerdown', (e) => { e.preventDefault(); steer = 1; }); add(rb, 'pointerup', () => steer = 0);
  add(q('.ck-btn-gear'), 'click', doGear); add(q('.ck-btn-flare'), 'click', doFlare);
  add(window, 'keydown', (e) => { const k = e.key.toLowerCase();
    if ((k === ' ' || k === 'spacebar') && !e.repeat) { e.preventDefault(); setHold(true); }
    else if (k === 'a' || k === 'arrowleft') steer = -1; else if (k === 'd' || k === 'arrowright') steer = 1;
    else if (k === 'g') doGear(); else if (k === 'f') doFlare(); });
  add(window, 'keyup', (e) => { const k = e.key.toLowerCase(); if (k === ' ' || k === 'spacebar') setHold(false); else if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) steer = 0; });
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
