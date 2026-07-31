// The TEXT COCKPIT — a live instrument panel for a text-mode pilot, drawn entirely
// in characters. Mounts in the same top pane (#area-content) the 3D cockpit and the
// room description share, and is handed back by the same `cockpit_close`.
//
// Deliberately NOT a downgraded glass cockpit. There is no canvas, no WebGL and no
// image in this file: box-drawing rules, a scrolling compass tape, block-character
// bars and an ASCII attitude ladder. It should read like an instrument panel someone
// built out of a terminal, because that is what a text pilot is flying.
//
// Fed the `text_cockpit` payload from plugins/flight/textpilot.js once a second (the
// server sim's own tick). Everything here is a pure render of that payload — no state
// of its own beyond the last packet, so a missed tick simply redraws the old numbers.

let _last = null;
let _open = false;

function ensureStyles() {
  if (document.getElementById('textcockpit-styles')) return;
  const st = document.createElement('style');
  st.id = 'textcockpit-styles';
  st.textContent = `
    #area-content:has(.tck) { height:100%; }
    .tck { font-family:'Courier New',monospace; font-size:12px; line-height:1.25;
      color:#9fe0c4; background:linear-gradient(170deg,#0b1512,#060b09 70%);
      border:1px solid #10261e; border-radius:6px; padding:8px 10px;
      height:100%; box-sizing:border-box; overflow:auto; white-space:pre; }
    .tck b { color:#d8fff0; font-weight:700; }
    .tck .dim { color:#4d6d60; }
    .tck .hi { color:#7fe3ff; }
    .tck .warn { color:#ffc94a; }
    .tck .bad { color:#ff6a5a; font-weight:700; }
    .tck .ok { color:#6ef0a8; }
    .tck .rule { color:#1d4436; }
    .tck-hd { display:flex; justify-content:space-between; gap:12px; color:#7fe3ff; letter-spacing:1px; }
    @media (max-width:700px){ .tck { font-size:11px; } }
  `;
  document.head.appendChild(st);
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pad = (s, n) => String(s).padStart(n, ' ');
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// A block-character bar: █ filled, ░ empty. Used for throttle, fuel and hull, so all
// three read at a glance without a single pixel of graphics.
function bar(frac, width = 12, cls = '') {
  const f = Math.round(clamp(frac, 0, 1) * width);
  return `<span class="${cls}">${'█'.repeat(f)}</span><span class="dim">${'░'.repeat(width - f)}</span>`;
}

// The compass tape: a strip of the 360° ruler centred on the current heading, so it
// slides sideways as she turns exactly like a real HSI tape.
const TAPE_MARKS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
function compassTape(hdg, width = 45) {
  const half = Math.floor(width / 2);
  let out = '';
  for (let i = -half; i <= half; i++) {
    const deg = ((Math.round(hdg) + i) % 360 + 360) % 360;
    if (TAPE_MARKS[deg]) out += TAPE_MARKS[deg][0];
    else if (deg % 10 === 0) out += '|';
    else if (deg % 5 === 0) out += '.';
    else out += '·';
  }
  return out;
}

// A small ASCII attitude indicator: the horizon line shifts with pitch and tilts with
// bank. Three rows is enough to fly by — it answers "nose up or down, wings level?".
function attitude(pitch, bank) {
  const rows = 5, cols = 21, mid = Math.floor(rows / 2);
  const horizonRow = clamp(mid - Math.round(pitch / 8), 0, rows - 1);
  const slope = Math.tan(clamp(bank, -60, 60) * Math.PI / 180) * 0.35;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const dx = c - Math.floor(cols / 2);
      const hr = horizonRow + slope * dx;
      if (Math.abs(r - hr) < 0.5) line += '─';
      else if (r < hr) line += ' ';
      else line += '·';
    }
    grid.push(line);
  }
  // The fixed aircraft reference, always dead centre.
  const cRow = grid[mid].split('');
  const cMid = Math.floor(cols / 2);
  cRow[cMid - 1] = '-'; cRow[cMid] = '+'; cRow[cMid + 1] = '-';
  grid[mid] = cRow.join('');
  return grid;
}

// The minimap the server already builds for the 3D cockpit — a flat node array with
// grid coords (getMinimapData), not a grid — rasterized here into a character block
// centred on the plane. Glyphs, not tiles: @ you, ▲ an airfield, ≈ water, # a
// building, · plain ground.
function miniRows(nodes, cx, cy, R = 4) {
  if (!Array.isArray(nodes) || !nodes.length) return [];
  const at = new Map();
  for (const n of nodes) if (n.grid_x != null) at.set(`${n.grid_x},${n.grid_y}`, n);
  const rows = [];
  for (let y = cy - R; y <= cy + R; y++) {
    let line = '';
    for (let x = cx - R; x <= cx + R; x++) {
      if (x === cx && y === cy) { line += '@'; continue; }
      const n = at.get(`${x},${y}`);
      if (!n) { line += ' '; continue; }
      if (n.is_current) line += '@';
      else if (n.building_type === 'airfield' || /field|airport|regional/i.test(n.name || '')) line += '▲';
      else if (n.terrain === 'water') line += '≈';
      else if (n.building_name || n.enterable) line += '#';
      else line += '·';
    }
    rows.push(line);
  }
  return rows;
}

export function openTextCockpit(msg) {
  ensureStyles();
  _open = true;
  _last = null;
  const el = document.getElementById('area-content');
  if (el) el.innerHTML = `<div class="tck"><span class="hi">▛ ${esc(msg?.craft || 'AIRCRAFT')} — instruments coming alive…</span></div>`;
}

export function closeTextCockpit() {
  _open = false; _last = null;
}

export function isTextCockpitActive() { return _open; }

export function updateTextCockpit(s) {
  ensureStyles();
  _open = true;
  _last = s;
  const el = document.getElementById('area-content');
  if (!el) return;

  const W = 46;
  const rule = `<span class="rule">${'─'.repeat(W)}</span>`;
  const hdg = pad(Math.round(s.hdg), 3).replace(/ /g, '0');
  const spdCls = s.stalled ? 'bad' : (s.airborne && s.ias < s.vs0 * 1.15 ? 'warn' : 'ok');
  const att = attitude(s.pitch || 0, s.bank || 0);
  const mini = miniRows(s.minimap, s.x, s.y);

  // Attitude ladder and minimap sit side by side, both character grids.
  const bodyRows = [];
  const attW = att[0].length;
  for (let i = 0; i < Math.max(att.length, mini.length); i++) {
    const a = (att[i] ?? ' '.repeat(attW)).padEnd(attW, ' ');
    const m = mini[i] ?? '';
    bodyRows.push(`<span class="dim">${esc(a)}</span>   <span class="hi">${esc(m)}</span>`);
  }

  const warnings = [];
  if (s.stalled) warnings.push('<span class="bad">⚠ STALLED — the assist is unloading and adding power.</span>');
  else if (s.stallMargin < 0.25) warnings.push('<span class="warn">⚠ BUFFET — she is getting slow.</span>');
  if (s.warn === 'STARVATION') warnings.push('<span class="bad">⚠ ENGINE OUT — dry tank.</span>');
  else if (s.warn === 'BINGO') warnings.push('<span class="warn">⚠ BINGO FUEL.</span>');
  if (s.surfaces) warnings.push('<span class="bad">⚠ STRUCTURAL DAMAGE — she is flying asymmetric.</span>');
  if (s.checkride?.instruction) warnings.push(`<span class="hi">✈ ${esc(s.checkride.stageName || 'CHECKRIDE')}: </span><span class="dim">${esc(s.checkride.instruction)}</span>`);

  el.innerHTML = `<div class="tck">` +
    `<div class="tck-hd"><span>▛ ${esc(s.craft)} ${esc(s.tail)}</span><span>${s.onGround ? 'ON THE GROUND' : 'AIRBORNE'}</span></div>` +
    rule + '\n' +
    `<span class="dim">${esc(compassTape(s.hdg, W - 1))}</span>\n` +
    `<span class="dim">${' '.repeat(Math.floor((W - 1) / 2))}▲</span>   <b>HDG ${hdg}°</b>\n` +
    rule + '\n' +
    bodyRows.join('\n') + '\n' +
    rule + '\n' +
    `<b>ALT</b> ${pad(s.alt, 6)} ft${s.tgtAlt != null ? ` <span class="dim">→ ${s.tgtAlt}</span>` : ''}\n` +
    `<b>IAS</b> <span class="${spdCls}">${pad(s.ias, 6)} kt</span> <span class="dim">(Vr ${s.vr} · stall ${s.vs0})</span>\n` +
    `<b>V/S</b> ${pad((s.vs > 0 ? '+' : '') + s.vs, 6)} fpm\n` +
    `<b>THR</b> ${bar(s.throttle / 100, 12, 'ok')} ${pad(s.throttle, 3)}%\n` +
    `<b>FUE</b> ${bar((s.fuelPct || 0) / 100, 12, s.fuelPct <= 20 ? 'warn' : 'ok')} ${pad(s.fuelPct, 3)}%\n` +
    `<b>HUL</b> ${bar((s.hull ?? 100) / 100, 12, (s.hull ?? 100) < 50 ? 'bad' : 'ok')} ${pad(s.hull ?? 100, 3)}%\n` +
    `<span class="dim">GEAR ${s.gear ? 'DOWN' : 'UP  '} · FLAPS ${pad(s.flaps, 3)}% · ${esc(s.surface || 'open air')}</span>\n` +
    (warnings.length ? rule + '\n' + warnings.join('\n') + '\n' : '') +
    `</div>`;
}
