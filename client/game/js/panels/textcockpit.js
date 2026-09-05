// The TEXT COCKPIT — a live instrument panel for a text-mode pilot, drawn entirely
// in characters. Mounts in the same top pane (#area-content) the 3D cockpit and the
// room description share, and is handed back by the same `cockpit_close`.
//
// Deliberately NOT a downgraded glass cockpit. There is no canvas, no WebGL and no
// image in this file: box-drawing rules, a scrolling compass tape, block-character
// bars, a coloured character-cell artificial horizon and a coloured moving chart. It
// should read like an instrument panel someone built out of a terminal, because that
// is what a text pilot is flying. Colour is doing real work here rather than decorating:
// with no window, the horizon and the chart are the only answers to "which way is up"
// and "where am I", and neither should have to be decoded character by character.
//
// Fed the `text_cockpit` payload from plugins/flight/textpilot.js once a second (the
// server sim's own tick). Everything here is a pure render of that payload — no state
// of its own beyond the last packet, so a missed tick simply redraws the old numbers.

import { esc, pad, clamp, bar, paintRow } from './textui.js';

let _last = null;
let _open = false;

function ensureStyles() {
  if (document.getElementById('textcockpit-styles')) return;
  const st = document.createElement('style');
  st.id = 'textcockpit-styles';
  st.textContent = `
    #area-content:has(.tck) { height:100%; }
    /* ⚠ NOT 'Courier New' — this panel is a CHARACTER GRID, and Courier New has no
       box-drawing or geometric-shape glyphs on Windows. Every ─ ╱ ╲ ▲ ◄ █ fell back
       to a different family with a different advance width, so any row containing one
       came out a different pixel width than the rows around it: the horizon ball had a
       ragged right edge and the chart's columns walked. Consolas/DejaVu/Cascadia all
       carry the block at the same width as their own space. Courier New stays the
       house font everywhere else; a grid is the one place it can't be used. */
    .tck { font-family:'Cascadia Mono',Consolas,'DejaVu Sans Mono','Liberation Mono',ui-monospace,monospace;
      font-size:0.75rem; line-height:1.25;
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
    /* Artificial horizon — solid colour, so attitude reads without being decoded. */
    .tck .ai-sky { background:#1d5fa8; color:#1d5fa8; }
    .tck .ai-gnd { background:#6b4a24; color:#6b4a24; }
    .tck .ai-hzn { background:#1d5fa8; color:#f4fbff; text-shadow:0 0 4px #cfefff; }
    .tck .ai-lad-s { background:#1d5fa8; color:#dbeeff; }
    .tck .ai-lad-g { background:#6b4a24; color:#f0dcc2; }
    .tck .ai-ref { color:#ffb63a; font-weight:700; text-shadow:0 0 5px rgba(255,150,40,.7); }
    /* Chart */
    .tck .mp-void { color:#0d1a15; }
    .tck .mp-ground { color:#3f7a5c; }
    .tck .mp-road { color:#7b8a80; }
    .tck .mp-water { color:#3f8fd0; }
    .tck .mp-bldg { color:#93a3ad; }
    .tck .mp-field { color:#5ce2ff; font-weight:700; text-shadow:0 0 5px rgba(92,226,255,.6); }
    .tck .mp-me { color:#ffb63a; font-weight:700; text-shadow:0 0 6px rgba(255,150,40,.8); }
    .tck-cols { display:flex; gap:18px; align-items:flex-start; }
    @media (max-width:700px){ .tck { font-size:0.6875rem; } .tck-cols { gap:10px; } }
  `;
  document.head.appendChild(st);
}

// The general half of this panel now lives in textui.js, so the next character
// panel doesn't have to copy it. Everything aviation-specific — the horizon, the
// compass tape, the chart — stays here.
//
// This file keeps its OWN stylesheet (`.tck`) rather than adopting `.txui`: the
// cockpit's palette and its full-height area-pane mount are particular to it, and
// a shared sheet that had to cover both would be a sheet neither one wanted.

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

// (paintRow, bar, esc, pad and clamp are imported from textui.js — the run-length
// encoding is the load-bearing one: a span per character would be a few thousand
// DOM nodes a second at the sim's tick rate for a panel 46 columns wide.)

// ── The artificial horizon ────────────────────────────────────────────────────
// A COLOURED attitude indicator, which is the one instrument a pilot with no window
// cannot fly without. Blue above the horizon, brown below it, a white horizon line that
// rolls with bank and slides with pitch, a pitch ladder ruled every 10°, a bank scale
// across the top with a pointer, and a fixed amber aircraft reference dead centre.
// The ladder rungs are lines of CONSTANT pitch, so they roll with the horizon rather than
// staying level — which is why a hard bank crosses several of them in one screen row.
//
// It is drawn as solid colour rather than punctuation on purpose: the old version was a
// three-row ASCII sketch, and "which way is up" is not a thing you should have to READ.
// At a glance the ratio of blue to brown IS your pitch and the tilt of the join IS your
// bank, exactly as on the real gauge — no characters to decode.
const AI_ROWS = 11, AI_COLS = 25, AI_DEG_PER_ROW = 5;   // ±25° of pitch across the ball

// THE ANGLE IS THE INSTRUMENT, so the horizon must not read as a staircase of blocks.
// A character cell is one sample of a continuous line, and a flat `─` in every cell
// throws away both halves of the information the line carries:
//
//   · WITHIN a cell — where the line crosses vertically. `▔ ─ ▁` split the cell into
//     three, so the ball resolves pitch to about 1.7° instead of 5°, and a slow trim
//     change moves the horizon smoothly instead of jumping a whole row at a time.
//   · ACROSS cells — which way the line is going. `╱ ╲` are drawn at ~45° in every
//     one of the fonts above, so a banked horizon is a continuous diagonal rather than
//     a flight of steps, and the tilt is legible at a glance without counting rows.
//
// Sign convention, derived from the `d` expression below rather than guessed: the
// horizon sits where dy·cosB = dx·sinB − pitchRows, so for bank > 0 (right wing down)
// dy grows with dx — the line falls to the RIGHT, which is `╲`. Past ~55° of bank the
// line is closer to vertical than to diagonal and `│` is the honest glyph.
//
// `d` is the signed distance BELOW the horizon in rows, so a negative d means the line
// crosses the upper part of the cell.
function horizonChar(d, bank) {
  const ab = Math.abs(bank);
  if (ab >= 55) return '│';
  if (ab >= 12) return bank > 0 ? '╲' : '╱';
  return d < -0.17 ? '▔' : d > 0.17 ? '▁' : '─';
}

function attitudeRows(pitch, bank) {
  const midR = (AI_ROWS - 1) / 2, midC = (AI_COLS - 1) / 2;
  // Roll the ball, don't roll the aeroplane: the horizon tilts by −bank (bank right ⇒ the
  // world tips left), and the pitch offset is measured along the ball's own vertical.
  const br = clamp(bank, -90, 90) * Math.PI / 180;
  const sinB = Math.sin(br), cosB = Math.cos(br);
  const pitchRows = clamp(pitch, -40, 40) / AI_DEG_PER_ROW;
  const rows = [];
  for (let r = 0; r < AI_ROWS; r++) {
    const cells = [];
    for (let c = 0; c < AI_COLS; c++) {
      // Character cells are about twice as tall as they are wide, so the horizontal offset
      // has to be halved before the rotation or every bank angle reads far too shallow.
      const dx = (c - midC) * 0.5, dy = r - midR;
      // Signed distance below the horizon, in rows, in the ball's frame.
      const d = (dy * cosB - dx * sinB) + pitchRows;
      const acrossN = (dy * sinB + dx * cosB) / (midC * 0.5);   // −1..1 along the horizon, for ladder width
      if (Math.abs(d) < 0.5) { cells.push({ ch: horizonChar(d, bank), cls: 'ai-hzn' }); continue; }
      const sky = d < 0;
      // Pitch ladder: a rung every 10° (2 rows), drawn as a short bar either side of centre.
      // A rung is a line of CONSTANT pitch, so it runs parallel to the horizon and gets the
      // same slope glyph — a flat rung under a banked horizon would read as a false level.
      const dRung = Math.abs(d) - Math.round(Math.abs(d) / 2) * 2;   // signed offset within the rung's own cell
      const rung = Math.abs(dRung) < 0.5 && Math.round(Math.abs(d) / 2) > 0;
      const inBar = Math.abs(acrossN) > 0.18 && Math.abs(acrossN) < 0.62;
      if (rung && inBar) {
        cells.push({ ch: horizonChar(sky ? -dRung : dRung, bank), cls: sky ? 'ai-lad-s' : 'ai-lad-g' });
        continue;
      }
      cells.push({ ch: ' ', cls: sky ? 'ai-sky' : 'ai-gnd' });
    }
    rows.push(cells);
  }
  // The fixed aircraft reference — the one thing on the gauge that never moves.
  const ref = rows[Math.round(midR)];
  ref[midC - 2] = { ch: '─', cls: 'ai-ref' }; ref[midC - 1] = { ch: '◄', cls: 'ai-ref' };
  ref[midC] = { ch: '▲', cls: 'ai-ref' };
  ref[midC + 1] = { ch: '►', cls: 'ai-ref' }; ref[midC + 2] = { ch: '─', cls: 'ai-ref' };
  return rows.map(paintRow);
}

// The bank scale that sits above the ball: fixed 10/20/30/60° index marks with a pointer
// that slides to the current bank, so a steep turn is readable as a number as well as a tilt.
function bankScale(bank) {
  const cells = [];
  const midC = (AI_COLS - 1) / 2;
  const ptr = Math.round(midC + clamp(bank, -60, 60) / 60 * midC);
  for (let c = 0; c < AI_COLS; c++) {
    if (c === ptr) { cells.push({ ch: '▼', cls: Math.abs(bank) > 45 ? 'bad' : 'ai-ref' }); continue; }
    const deg = Math.abs((c - midC) / midC * 60);
    const mark = [10, 20, 30, 60].some(m => Math.abs(deg - m) < 2.5);
    cells.push({ ch: c === midC ? '│' : mark ? '·' : ' ', cls: 'dim' });
  }
  return paintRow(cells);
}

// ── The chart ─────────────────────────────────────────────────────────────────
// The minimap the server already builds for the 3D cockpit — a flat node array with grid
// coords (getMinimapData), not a grid — rasterized here into a COLOURED character block
// centred on the aircraft. For a text pilot this is the whole outside world, so it is
// bigger and legible by colour: green ground, blue water, grey buildings, cyan airfields,
// and the aircraft itself drawn as an arrowhead pointing the way she's actually flying.
//
// The 8-way heading arrow matters more than it looks: a compass tape tells you the number,
// but the arrow puts the number and the map in the same glance, which is the difference
// between knowing your heading and knowing where you are going.
const HDG_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const arrowFor = (hdg) => HDG_ARROWS[Math.round((((hdg % 360) + 360) % 360) / 45) % 8];

function mapCell(n, isField) {
  // Airfields come from the payload's own `fields` list rather than being sniffed out of
  // the tile: the minimap node carries no airfield_id, and guessing one off the tile NAME
  // is how a bar called The Airstrip ends up drawn as somewhere you can put down.
  if (isField) return { ch: '✈', cls: 'mp-field' };
  if (!n) return { ch: ' ', cls: 'mp-void' };
  if (n.terrain === 'water') return { ch: '≈', cls: 'mp-water' };
  if (n.building_name || n.building_type || n.enterable) return { ch: '▣', cls: 'mp-bldg' };
  if (n.terrain === 'road') return { ch: '═', cls: 'mp-road' };
  return { ch: '·', cls: 'mp-ground' };
}

function mapRows(nodes, cx, cy, hdg, R, fields) {
  if (!Array.isArray(nodes) || !nodes.length) return [];
  const at = new Map();
  for (const n of nodes) if (n.grid_x != null) at.set(`${n.grid_x},${n.grid_y}`, n);
  const fieldAt = new Set((fields || []).map(f => `${f.gx},${f.gy}`));
  const rows = [];
  for (let y = cy - R; y <= cy + R; y++) {
    const cells = [];
    for (let x = cx - R; x <= cx + R; x++) {
      const key = `${x},${y}`;
      if (x === cx && y === cy) cells.push({ ch: arrowFor(hdg), cls: 'mp-me' });
      else cells.push(mapCell(at.get(key), fieldAt.has(key)));
      cells.push({ ch: ' ', cls: 'mp-void' });   // one space between columns — square tiles, not tall thin ones
    }
    rows.push(paintRow(cells));
  }
  return rows;
}

// What `land` will do in this airframe, printed on the panel so the rule is an instrument
// reading rather than something you only learn by being refused mid-approach.
const LAND_MODE_NOTE = {
  vtol: 'VTOL — she can set down anywhere, once she is slow.',
  stol: 'STOL — rough-field rated; get her slow and she will go in short.',
  strip: 'STRIP — she needs a runway under her to land.',
};

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
  const pitch = s.pitch || 0, bank = s.bank || 0;
  const att = [bankScale(bank), ...attitudeRows(pitch, bank)];
  const R = s.mapR || 6;
  const mini = mapRows(s.minimap, s.x, s.y, s.hdg, R, s.fields);

  // The horizon ball and the chart sit side by side as two independently-coloured
  // character grids. Flex columns rather than padded rows: the cells carry background
  // colour now, so a row padded with spaces would paint a ragged edge on the ball.
  const nearest = Array.isArray(s.fields) && s.fields.length ? s.fields[0] : null;
  const chartHead = `<span class="hi">CHART</span> <span class="dim">${s.x},${s.y}</span>`;
  const chartFoot = nearest
    ? `<span class="mp-field">✈ ${esc(nearest.name)}</span> <span class="dim">${pad(nearest.bearing, 3).replace(/ /g, '0')}° · ${nearest.dist}t</span>`
    : '<span class="dim">no field in range</span>';
  const bodyRows = [
    `<div class="tck-cols"><div>`
      + `<span class="hi">ATTITUDE</span> <span class="dim">${pitch >= 0 ? '+' : ''}${Math.round(pitch)}° pitch · ${Math.round(Math.abs(bank))}° ${Math.abs(bank) < 2 ? 'level' : bank > 0 ? 'right' : 'left'}</span>\n`
      + att.join('\n')
    + `</div><div>${chartHead}\n${mini.join('\n')}\n${chartFoot}</div></div>`,
  ];

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
    `<span class="dim">${esc(LAND_MODE_NOTE[s.landMode] || '')}</span>\n` +
    (warnings.length ? rule + '\n' + warnings.join('\n') + '\n' : '') +
    `</div>`;
}

// Exported for the regress harness — the attitude ball and chart are pure functions of the
// payload, so they can be checked without a DOM.
export const _test = { attitudeRows, bankScale, mapRows, arrowFor, paintRow };
