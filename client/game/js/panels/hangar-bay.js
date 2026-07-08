// HANGAR BAY — the unified 3D hangar app. Replaces the old paint-bay modal
// (hangar.js) and the fleet lazy-susan (fleet.js) with one area-pane app, mounted
// like the flight cockpit (the command pane stays live beneath it). The server
// (flight/hangars.js pushHangarBay) owns all the data; this file only draws it and
// posts the same text commands the old panels did (paintset/scheme/hangaract/
// repair/modify/loadout/buy/rent/embark) — the server already re-pushes a fresh
// hangar_bay_open after the ones that mutate state (paint/scheme/store-pull); the
// rest (repair/tune/loadout/buy/rent) we re-fetch with a short delayed `hangar`,
// same trick fleet.js used for buy.
//
// Screens (all client-side switches over one cached payload, no re-fetch needed
// except where noted): floor → charter → buyrent → bench. `back` always returns
// to floor.
import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { drawHangarFloorBay, drawHangarScene } from './aircraft3d.js';
import { drawWireframe3D, drawEngineWireframe, themeColor } from './wireframe-plane.js';

let B = null;       // { data, screen, selId, work (paint edit copy) }
let raf = null;      // shared spin/scene-draw loop
let yaw = 0;
let sceneHits = [];  // last drawHangarScene() click regions, refreshed every frame
let charterData = null;   // last charter_open payload
let charterAny = false;   // off-airfield (Dragonfly) mode toggled on the charter screen

export function isHangarBayActive() { return !!document.getElementById('hb-root'); }

// ── Entry points (dispatch.js wires these to the server pushes) ───────────────
export function openHangarBay(data) {
  const freshOpen = !B;
  B = B || { screen: 'floor', selId: null, work: null };
  B.data = data || {};
  const craft = B.data.craft || [];
  if (data.select && craft.find(c => c.id === data.select)) {
    B.selId = data.select; B.screen = 'bench'; B.work = { ...craft.find(c => c.id === data.select).livery };
  } else if (freshOpen) {
    B.selId = null; B.screen = 'floor';
  } else if (B.selId && !craft.find(c => c.id === B.selId)) {
    B.selId = null; if (B.screen === 'bench') B.screen = 'floor';
  }
  ensureStyles();
  render();
}

export function openCharterScreen(data) {
  if (!B) openHangarBay({});
  charterData = data;
  charterAny = false;
  B.screen = 'charter';
  render();
}

export function closeHangarBay() {
  cleanupPopover();
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  B = null; charterData = null;
  // Tear the panel out of the pane immediately rather than leaving it (with its
  // now-dead click handlers) on screen until whatever look/move follows renders.
  const root = document.getElementById('hb-root');
  if (root) root.remove();
}

// Escape backs out one screen at a time (matches the header/toolbar back button);
// bound once at module load, not per-render, so it never stacks up duplicate handlers.
window.addEventListener('keydown', (e) => {
  if (!B || e.key !== 'Escape') return;
  if (B.screen !== 'floor') { go('floor'); } else if (B.data?.inHangar) { sendCmdSilent('out'); } else { closeHangarBay(); sendCmdSilent('look'); }
});

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
function go(screen) { cleanupPopover(); B.screen = screen; render(); }
// Commands that don't self-refresh the panel (repair/tune/loadout/buy/rent) get a
// short delayed re-fetch — the same trick fleet.js used for `buy`.
function refetch() { setTimeout(() => sendCmdSilent('hangar'), 450); }

// ── Floor ───────────────────────────────────────────────────────────────────
function bayCanvas(id, cls, livery, tint, size, extra = '') {
  return `<canvas class="hb-bay" id="${id}" data-hb-cls="${esc(cls || '')}" data-hb-livery="${esc(JSON.stringify(livery || {}))}" data-hb-tint="${esc(tint || '')}" style="width:${size}px;height:${Math.round(size * 0.78)}px" ${extra}></canvas>`;
}

// The floor is ONE 3D room (a single <canvas>, one shared camera) — every craft
// you own here plus the pilot-tinted CHARTER Mule sit in it side by side, not a
// row of separate thumbnail cards. Selection/hover is done by hit-testing the
// scene's own screen-space regions (sceneHits, refreshed every draw), since
// there's no per-plane DOM element to click.
function floorScreen() {
  const d = B.data, craft = (d.craft || []).filter(c => !c.wreck);
  const sel = craft.find(c => c.id === B.selId) || null;
  const pilot = d.pilot || { present: false };
  const hasCharterTile = d.canRent !== undefined;
  const empty = !craft.length && !pilot.present && !d.charterWaiting;

  // The 3D scene draws an empty bay fine with zero entries (just the backdrop,
  // no planes) — always mount the canvas so an empty hangar still looks like a
  // hangar, and say so as a hint over it instead of replacing it with text.
  const stage = `<canvas id="hb-scene" class="hb-scene"></canvas>`;

  const mulePrompt = d.charterWaiting
    ? `, or the ${esc(pilot.name)}-coloured Mule — it's fuelled and waiting for you`
    : pilot.present ? `, or the ${esc(pilot.name)}-coloured Mule to charter a ride` : '';
  const info = sel ? `
    <div class="hb-info">
      <div class="hb-info-name">${esc(sel.tail)} <span class="hb-info-type">${esc(sel.typeName)}</span> ${locBadge(sel)}</div>
      <div class="hb-bars">
        <span class="hb-bl">HULL</span><span class="hb-bar"><i style="width:${sel.hullPct}%;background:${barCol(sel.hullPct)}"></i></span>
        <span class="hb-bl">FUEL</span><span class="hb-bar"><i style="width:${sel.fuelPct}%;background:#4fb8e0"></i></span>
      </div>
      <div class="hb-info-actions">
        ${!sel.wreck ? `<button class="hb-btn hb-go" data-act="embark" data-tail="${esc(sel.tail)}">Fly</button>` : ''}
        ${!sel.wreck ? `<button class="hb-btn" data-act="bench">Maintenance</button>` : ''}
        ${d.hasBay && !sel.wreck && sel.location === 'ramp' ? `<button class="hb-btn" data-act="store">Store in bay</button>` : ''}
        ${d.hasBay && sel.location === 'hangar' ? `<button class="hb-btn" data-act="pull">Roll out</button>` : ''}
      </div>
    </div>` : empty
      ? `<div class="hb-hint">No aircraft of yours are here yet.${d.canBuy || d.canRent ? '' : ' There\'s no dealer or rental desk at this field either.'}</div>`
      : hasCharterTile ? `<div class="hb-hint">Click a plane to select it${mulePrompt}.</div>` : '';

  return `
    <div class="hb-floor">${stage}</div>
    ${info}
    <div class="hb-toolbar">
      ${d.canBuy || d.canRent ? `<button class="hb-btn hb-accent" data-act="buyrent">Buy / Rent</button>` : ''}
      <button class="hb-btn hb-close" data-act="close">${d.inHangar ? 'Exit Hangar' : 'Close'}</button>
    </div>`;
}
// The scene's entries: your craft (livery as-is) plus, when a pilot's on duty,
// the CHARTER Mule solid-painted in their signature colour.
function sceneEntries() {
  const d = B.data, craft = (d.craft || []).filter(c => !c.wreck);
  const entries = craft.map(c => ({ id: c.id, cls: c.class, livery: c.livery, label: c.tail }));
  const pilot = d.pilot;
  // Booked-for-you reads exactly like an available pilot (full colour, clickable —
  // to embark instead of opening the booking dialog); a stranger's booking still
  // shows the tinted plane rather than making it look like it vanished, it's just
  // not present/bookable (server-gated: only the charterer can board it).
  if (pilot && d.canRent !== undefined) {
    const ready = pilot.present || !!d.charterWaiting;
    entries.push({
      id: '__charter', cls: 'prop', tint: ready ? (pilot.color || '#f2b01e') : null,
      livery: { base: pilot.color || '#f2b01e', trim: '#1a1a1a', pattern: 'solid', finish: 'gloss', cabin: '#1a1a1a' },
      label: d.charterWaiting ? `✈ CHARTER — ${pilot.name} (ready to board)` : pilot.present ? `✈ CHARTER — ${pilot.name}` : '✈ CHARTER — off shift',
    });
  }
  return entries;
}
function barCol(pct) { return pct <= 25 ? '#ff5b5b' : pct <= 55 ? '#ffb23e' : '#46e05a'; }
function locBadge(c) {
  if (c.wreck) return '<span class="hb-badge hb-b-wreck">WRECK</span>';
  if (c.rental) return '<span class="hb-badge hb-b-rent">RENTAL</span>';
  if (c.location === 'hangar') return '<span class="hb-badge hb-b-bay">IN BAY</span>';
  return '<span class="hb-badge hb-b-ramp">ON RAMP</span>';
}

// ── Charter destination picker ─────────────────────────────────────────────
function charterScreen() {
  const c = charterData;
  if (!c) return '<div class="hb-empty">Loading the charter desk…</div>';
  const tiles = c.tiles || [];
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = maxX - minX + 1, H = maxY - minY + 1;

  const cells = tiles.map(t => {
    const gx = t.x - minX + 1, gy = t.y - minY + 1;
    const pickable = t.charterAirfield && !t.charterHere;
    const anyPickable = charterAny && !t.charterHere && t.reachable !== false;
    const active = charterAny ? anyPickable : pickable;
    const fare = charterAny ? t.charterFareAny : t.charterFareMule;
    let cls = 'hb-tile';
    if (t.charterHere) cls += ' hb-tile-here';
    else if (active) cls += ' hb-tile-dest' + (t.charterAirfield ? ' hb-tile-airfield' : '');
    else cls += ' hb-tile-dim';
    const label = t.charterHere ? '◆' : t.charterAirfield ? '✈' : (t.icon || '');
    return `<div class="${cls}" style="grid-column:${gx};grid-row:${gy}" ${active ? `data-hb-dest="${t.id}"` : ''} title="${esc(t.name)}${fare != null && active ? ` — ${fare}c` : ''}">
      <span class="hb-tile-icon">${label}</span>
      ${active && fare != null ? `<span class="hb-tile-fare">${fare}c</span>` : ''}
    </div>`;
  }).join('');

  return `
    <div class="hb-charter-crt">
      <div class="hb-charter-head">
        <span class="hb-charter-pilot" style="color:${c.pilotColor || '#f2b01e'}">✈ ${esc(c.pilotName)}</span>
        <span class="hb-dim">"Where you headed? Pick a spot on the map."</span>
        <span class="hb-credits">₵ ${c.credits ?? 0}</span>
      </div>
      <div class="hb-charter-map" style="grid-template-columns:repeat(${W},20px); grid-template-rows:repeat(${H},20px);">${cells}</div>
      <div class="hb-charter-legend">
        <span><i class="hb-swatch hb-sw-air"></i> Airfield — the Mule (${charterAny ? '' : 'active'})</span>
        <span><i class="hb-swatch hb-sw-any"></i> Any tile — the Dragonfly, off-airfield premium</span>
      </div>
    </div>
    <div class="hb-toolbar">
      <button class="hb-btn${charterAny ? ' hb-accent' : ''}" data-act="charter-any">${charterAny ? '✓ ' : ''}Off-airfield drop (Dragonfly)</button>
      <button class="hb-btn" data-act="back">Back</button>
    </div>`;
}

// ── Buy / Rent — a dealer terminal: CRT scanlines + a wireframe schematic per
// lot instead of the floor/bench's realistic shaded 3D turntable. Deliberately
// the only screen styled this way (see ensureStyles' .hb-dealer-* block) — the
// floor and mechanics bench keep the ordinary hangar look untouched.
function lotCard(t, mode) {
  return `<button class="hb-lot hb-dealer-lot" data-hb-${mode}="${esc(t.id)}">
    <canvas class="hb-wf-lot" data-wf-cls="${esc(t.class)}" width="128" height="90"></canvas>
    <div class="hb-lot-name">${esc(t.name)}</div>
    <div class="hb-lot-meta">${esc(t.class)} · ${t.seats} seat${t.seats > 1 ? 's' : ''} · ${esc(t.fuel)}</div>
    <div class="hb-lot-price">₵ ${t.price}${mode === 'rent' ? '/hr' : ''}</div>
  </button>`;
}
function buyRentScreen() {
  const d = B.data;
  const buy = d.canBuy ? `<div class="hb-section">BUY</div><div class="hb-lotgrid">${(d.buyCatalog || []).map(t => lotCard(t, 'buy')).join('')}</div>` : '';
  const rent = d.canRent ? `<div class="hb-section">RENT (self-flown)</div><div class="hb-lotgrid">${(d.rentCatalog || []).map(t => lotCard(t, 'rent')).join('')}</div>` : '';
  return `<div class="hb-dealer-crt"><div class="hb-scroll">${buy}${rent}</div><div class="hb-dealer-scanlines"></div><div class="hb-crt-glass"></div></div>
    <div class="hb-toolbar"><button class="hb-btn" data-act="back">Back</button></div>`;
}

// ── Mechanics bench (maintenance: paint + repair + tune + loadout) ─────────
const clamp01 = (n) => n < 0 ? 0 : n > 1 ? 1 : n;
function hex2hsv(hex) {
  const n = parseInt((hex || '#808080').replace('#', ''), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsv2hex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return '#' + [r, g, b].map(ch => Math.round(clamp01(ch + m) * 255).toString(16).padStart(2, '0')).join('');
}
function drawSV(canvas, hue) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.fillStyle = hsv2hex(hue, 1, 1); ctx.fillRect(0, 0, w, h);
  let g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// A custom draggable colour picker (hue strip + saturation/value square) replacing
// the native <input type=color>, whose OS-level dialog swallows drag gestures and
// closes on the first click. Dragging here writes straight into B.work — the bench
// hero canvas re-reads it every animation frame (startSpin), so the plane repaints
// live as you drag, with no full render() (which would tear down the popover) until
// the picker closes.
let cpState = null; // { field, pop, btn, hue, sat, val }
function onDocPointerDown(e) {
  if (!cpState) return;
  if (cpState.pop.contains(e.target) || e.target === cpState.btn) return;
  closeColorPopover();
}
function cleanupPopover() {
  if (!cpState) return;
  cpState.pop.remove();
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  cpState = null;
}
function closeColorPopover() { if (cpState) { cleanupPopover(); render(); } }
function setPickerColor(field, hex) {
  B.work[field] = hex;
  if (cpState) {
    cpState.btn.style.background = hex;
    const hi = cpState.pop.querySelector('.hb-cp-hex-input');
    if (hi && document.activeElement !== hi) hi.value = hex;
  }
}
function openColorPopover(field, btn) {
  const reopening = cpState && cpState.field === field;
  cleanupPopover();
  if (reopening) return;
  const { h, s, v } = hex2hsv(B.work[field]);
  const pop = document.createElement('div');
  pop.className = 'hb-cp-pop';
  pop.innerHTML = `
    <div class="hb-cp-svwrap"><canvas class="hb-cp-sv" width="160" height="100"></canvas><div class="hb-cp-svcursor"></div></div>
    <div class="hb-cp-hue"><div class="hb-cp-huecursor"></div></div>
    <input type="text" class="hb-cp-hex-input" maxlength="7" value="${B.work[field]}">`;
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(pop);
  cpState = { field, pop, btn, hue: h, sat: s, val: v };

  const svCanvas = pop.querySelector('.hb-cp-sv'), svCursor = pop.querySelector('.hb-cp-svcursor');
  const hueBar = pop.querySelector('.hb-cp-hue'), hueCursor = pop.querySelector('.hb-cp-huecursor');
  const hexInput = pop.querySelector('.hb-cp-hex-input');
  const placeCursors = () => {
    svCursor.style.left = `${cpState.sat * 160}px`;
    svCursor.style.top = `${(1 - cpState.val) * 100}px`;
    hueCursor.style.left = `${(cpState.hue / 360) * 160}px`;
  };
  drawSV(svCanvas, cpState.hue);
  placeCursors();
  const updateFromHsv = () => { setPickerColor(field, hsv2hex(cpState.hue, cpState.sat, cpState.val)); placeCursors(); };

  svCanvas.addEventListener('pointerdown', (e) => {
    svCanvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = svCanvas.getBoundingClientRect();
      cpState.sat = clamp01((ev.clientX - r.left) / r.width);
      cpState.val = clamp01(1 - (ev.clientY - r.top) / r.height);
      updateFromHsv();
    };
    move(e);
    svCanvas.addEventListener('pointermove', move);
    svCanvas.addEventListener('pointerup', () => svCanvas.removeEventListener('pointermove', move), { once: true });
  });
  hueBar.addEventListener('pointerdown', (e) => {
    hueBar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = hueBar.getBoundingClientRect();
      cpState.hue = clamp01((ev.clientX - r.left) / r.width) * 360;
      drawSV(svCanvas, cpState.hue);
      updateFromHsv();
    };
    move(e);
    hueBar.addEventListener('pointermove', move);
    hueBar.addEventListener('pointerup', () => hueBar.removeEventListener('pointermove', move), { once: true });
  });
  hexInput.addEventListener('change', () => {
    const v2 = hexInput.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v2)) return;
    const hsv = hex2hsv(v2);
    cpState.hue = hsv.h; cpState.sat = hsv.s; cpState.val = hsv.v;
    drawSV(svCanvas, cpState.hue);
    setPickerColor(field, v2);
    placeCursors();
  });
  setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown, true), 0);
}

function swatchRow(label, field) {
  return `<label class="hb-ctl"><span>${label}</span><button type="button" class="hb-cp-swatch" data-cp="${field}" style="background:${B.work[field]}"></button></label>`;
}
function selectRow(label, field, opts) {
  return `<label class="hb-ctl"><span>${label}</span><select data-sel-field="${field}">${
    opts.map(o => `<option value="${o.id}"${o.id === B.work[field] ? ' selected' : ''}>${o.label}</option>`).join('')
  }</select></label>`;
}
// Paint gets its own EXTERIOR/INTERIOR/SCHEMES sub-tabs — it's the one section
// with enough controls to need it even inside a single bench tab.
function paintTabHtml(c, cat, dirty) {
  if (!c.paintable) {
    return `<div class="hb-note">${c.wreck ? 'A wreck — nothing worth painting.' : c.rental ? "Rentals can't be painted." : 'You can only paint an aircraft you own.'}</div>`;
  }
  const pt = ['exterior', 'interior', 'schemes'].includes(B.paintTab) ? B.paintTab : (B.paintTab = 'exterior');
  const subtabs = `<div class="hb-subtabs">
    <button class="hb-subtab${pt === 'exterior' ? ' hb-subtab-active' : ''}" data-paint-tab="exterior">Exterior</button>
    <button class="hb-subtab${pt === 'interior' ? ' hb-subtab-active' : ''}" data-paint-tab="interior">Interior</button>
    <button class="hb-subtab${pt === 'schemes' ? ' hb-subtab-active' : ''}" data-paint-tab="schemes">Schemes</button>
  </div>`;
  const applyRow = `<div class="hb-apply-row">
    <button class="hb-btn hb-accent" data-act="paint-apply"${dirty ? '' : ' disabled'}>Apply · ${c.paintCost}c</button>
    <button class="hb-btn" data-act="paint-revert"${dirty ? '' : ' disabled'}>Revert</button>
  </div>`;
  let panel;
  if (pt === 'exterior') {
    panel = `
      <div class="hb-presets">${(cat.presets || []).map(p => `<button class="hb-preset" data-preset="${p.id}"><span class="hb-chip" style="background:${p.base};box-shadow:inset 0 0 0 3px ${p.trim}"></span>${p.label}</button>`).join('')}</div>
      <div class="hb-ctls">
        ${swatchRow('Base', 'base')}${swatchRow('Trim', 'trim')}
        ${selectRow('Pattern', 'pattern', cat.patterns)}${selectRow('Finish', 'finish', cat.finishes)}
        ${selectRow('Nose art', 'decal', cat.decals || [])}
      </div>
      ${applyRow}`;
  } else if (pt === 'interior') {
    panel = `
      <div class="hb-ctls">${swatchRow('Cabin', 'cabin')}${selectRow('Upholstery', 'uphol', cat.uphol)}</div>
      ${applyRow}`;
  } else {
    panel = `
      <div class="hb-schemes">${(c.schemes || []).length
        ? c.schemes.map(s => `<span class="hb-scheme"><button class="hb-scheme-load" data-scheme-load="${esc(s.name)}"><span class="hb-chip" style="background:${s.base};box-shadow:inset 0 0 0 3px ${s.trim}"></span>${esc(s.name)}</button><button class="hb-scheme-del" data-scheme-del="${esc(s.name)}">✕</button></span>`).join('')
        : '<span class="hb-dim">none saved yet</span>'}</div>
      <div class="hb-scheme-save"><input id="hb-scheme-name" placeholder="scheme name" maxlength="16"><button class="hb-btn" data-act="scheme-save"${dirty ? ' disabled title="Apply your paint first"' : ''}>Save current look</button></div>`;
  }
  return subtabs + panel;
}

function hullTabHtml(c) {
  return c.rental
    ? `<div class="hb-note">Maintenance is bundled into your rental — <button class="hb-btn" data-act="repair">Square her away (free)</button></div>`
    : c.hullPct >= 98 ? `<div class="hb-note">Hull's in fine shape.</div>`
    : `<div class="hb-repair-row">
        <button class="hb-btn" data-act="repair">DIY repair · ~${c.diyCost}c</button>
        <button class="hb-btn hb-accent" data-act="repair-pro">Shop repair · ${c.shopCost}c (guaranteed)</button>
      </div>`;
}

// Tuning is owner-only (matches the server's requireOwned/ownedCraft gate in
// hangars.js — a rental flies stock, no tune curves to push) — a rental
// previously showed the same cycle buttons as an owned craft, which the server
// silently rejected on click. Gated here so it never renders in the first place.
function tuningTabHtml(c, tuneParams) {
  if (c.wreck) return '<div class="hb-note">A wreck — nothing to tune.</div>';
  if (c.rental) return '<div class="hb-note">You can only tune an aircraft you <b>own</b> — rentals fly stock.</div>';
  return `<div class="hb-tune">${tuneParams.map(p => {
    const v = c.tune?.[p.id] ?? 0, next = v >= 2 ? -2 : v + 1;
    return `<div class="hb-tune-row"><b>${esc(p.id)}</b> <span class="hb-tune-val">[${v > 0 ? '+' : ''}${v}]</span>
      <span class="hb-tune-desc">${esc(p.desc)}</span>
      <button class="hb-btn hb-tune-cycle" data-tune="${p.id}" data-next="${next}">cycle</button></div>`;
  }).join('')}</div>`;
}

function weightTabHtml(c) {
  const opt = (lbl, seats, cmd) => `<button class="hb-btn${seats === c.seatsNow ? ' hb-accent' : ''}" data-loadout="${cmd}">${lbl} (${seats} seat${seats > 1 ? 's' : ''})</button>`;
  return `<div class="hb-loadout">
    <div class="hb-dim">Budget ${c.loadoutBudget}kg — now: ${c.seatsNow} seats + ${c.cargoCapNow}kg hold${c.cargoLoaded ? ` (${c.cargoLoaded}kg loaded)` : ''}</div>
    <div class="hb-loadout-row">${opt('Passenger', c.maxSeats, 'passenger')}${opt('Combi', c.seats, 'combi')}${opt('Freight', 1, 'freight')}</div>
  </div>`;
}

// ATM-style terminal: tabbed so no section needs its own scrollbar — PAINT/HULL/
// TUNING/WEIGHT each get the full panel to themselves instead of stacking. The
// stage swaps to a wireframe engine schematic (drawEngineWireframe, animated in
// startSpin) while on the TUNING tab; every other tab keeps the real 3D plane.
function benchScreen() {
  const c = (B.data.craft || []).find(x => x.id === B.selId);
  if (!c) return '<div class="hb-empty">Pick an aircraft on the floor first.</div><div class="hb-toolbar"><button class="hb-btn" data-act="back">Back</button></div>';
  if (!B.work) B.work = { ...c.livery };
  const cat = B.data.catalog || { patterns: [], finishes: [], uphol: [], presets: [] };
  const dirty = JSON.stringify(B.work) !== JSON.stringify(c.livery);
  const tuneParams = B.data.tuneParams || [];
  const canTune = !c.wreck && !c.rental;

  const tabs = [
    { id: 'paint', label: 'PAINT' },
    { id: 'hull', label: `HULL · ${c.hullPct}%` },
    ...(canTune ? [{ id: 'tuning', label: 'TUNING' }] : []),
    ...(c.configurable ? [{ id: 'weight', label: 'W&B' }] : []),
  ];
  if (!tabs.some(t => t.id === B.benchTab)) B.benchTab = tabs[0].id;

  const tabBar = `<div class="hb-bench-tabs">${tabs.map(t =>
    `<button class="hb-tab${t.id === B.benchTab ? ' hb-tab-active' : ''}" data-bench-tab="${t.id}">${t.label}</button>`).join('')}</div>`;

  const body = B.benchTab === 'hull' ? hullTabHtml(c)
    : B.benchTab === 'tuning' ? tuningTabHtml(c, tuneParams)
    : B.benchTab === 'weight' ? weightTabHtml(c)
    : paintTabHtml(c, cat, dirty);

  const stage = B.benchTab === 'tuning'
    ? `<canvas id="hb-engine-wf" width="260" height="230"></canvas>`
    : bayCanvas('hb-bench-hero', c.wreck ? 'wreck' : c.class, B.work, null, 340, 'data-hb-src="work" data-hb-zoom="1.4"');

  return `
    <div class="hb-bench hb-bench-crt">
      <div class="hb-bench-stage">${stage}</div>
      <div class="hb-bench-panels">
        ${tabBar}
        <div class="hb-bench-tabbody">${body}</div>
      </div>
      <div class="hb-dealer-scanlines"></div>
      <div class="hb-crt-glass"></div>
    </div>
    <div class="hb-toolbar">
      ${!c.wreck ? `<button class="hb-btn hb-go" data-act="embark" data-tail="${esc(c.tail)}">Fly</button>` : ''}
      <button class="hb-btn" data-act="back">Back</button>
    </div>`;
}

// ── Render dispatch ─────────────────────────────────────────────────────────
function render() {
  if (!B) return;
  const d = B.data || {};
  const title = B.screen === 'charter' ? 'CHARTER' : B.screen === 'buyrent' ? 'BUY / RENT' : B.screen === 'bench' ? 'MECHANICS BENCH' : 'HANGAR BAY';
  const body = B.screen === 'charter' ? charterScreen() : B.screen === 'buyrent' ? buyRentScreen() : B.screen === 'bench' ? benchScreen() : floorScreen();
  // A persistent back button lives in the header itself (not just the bottom
  // toolbar) on every non-floor screen — always visible, never scrolled out of view.
  const backBtn = B.screen !== 'floor' ? `<button class="hb-back" data-act="back" title="Back to the hangar floor">‹ Hangar</button>` : '';
  setAreaPane(`<div id="hb-root">
    <div class="hb-head">${backBtn}<span class="hb-title">✈ ${title} — ${esc(d.field || '')}</span>
      <span class="hb-credits">₵ ${d.credits ?? 0}</span></div>
    <div class="hb-body">${body}</div>
  </div>`);
  wire();
  startSpin();
}

function wire() {
  const root = document.getElementById('hb-root'); if (!root) return;
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));

  on('[data-bench-tab]', 'click', (e) => { B.benchTab = e.currentTarget.getAttribute('data-bench-tab'); render(); });
  on('[data-paint-tab]', 'click', (e) => { B.paintTab = e.currentTarget.getAttribute('data-paint-tab'); render(); });

  const scene = root.querySelector('#hb-scene');
  if (scene) scene.addEventListener('click', (e) => {
    const r = scene.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bestD = Infinity;
    for (const h of sceneHits) {
      const dx = mx - h.sx, dy = my - h.sy, d = Math.hypot(dx, dy);
      if (d <= h.r && d < bestD) { best = h; bestD = d; }
    }
    if (!best) return;
    if (best.id === '__charter') {
      // Already booked for you: click boards it directly. Otherwise, if a pilot's
      // on duty, click opens the booking dialog. A stranger's booking (pilot busy,
      // not yours) is neither — the server keeps it unbookable either way.
      if (B.data.charterWaiting) { sendCmdSilent('embark'); closeHangarBay(); }
      else if (B.data.pilot?.present) sendCmdSilent('charterinfo');
      return;
    }
    B.selId = best.id;
    const c = (B.data.craft || []).find(x => x.id === B.selId);
    B.work = c ? { ...c.livery } : null;
    render();
  });
  on('[data-hb-dest]', 'click', (e) => {
    const dest = e.currentTarget.getAttribute('data-hb-dest');
    sendCmdSilent(`charterbook ${dest}${charterAny ? ' any' : ''}`);
    go('floor'); refetch();
  });

  on('[data-act]', 'click', (e) => {
    const act = e.currentTarget.getAttribute('data-act');
    // Standing inside the walk-in hangar: "Exit" actually walks you back out to the
    // ramp — `out` fires zone.entered on the far side, which pushes `hangar_close`
    // to dismiss the panel. Opened from the open ramp itself, there's no interior
    // to leave, so just dismiss it here.
    if (act === 'close') { if (B.data.inHangar) sendCmdSilent('out'); else { closeHangarBay(); sendCmdSilent('look'); } return; }
    if (act === 'back') { go('floor'); return; }
    if (act === 'buyrent') { go('buyrent'); return; }
    if (act === 'bench') { go('bench'); return; }
    if (act === 'charter-any') { charterAny = !charterAny; render(); return; }
    if (act === 'embark') { sendCmdSilent(`embark ${e.currentTarget.getAttribute('data-tail')}`); closeHangarBay(); return; }
    if (act === 'store') { sendCmdSilent(`hangaract store ${B.selId}`); return; }
    if (act === 'pull') { sendCmdSilent(`hangaract pull ${B.selId}`); return; }
    if (act === 'repair') { sendCmdSilent('repair'); refetch(); return; }
    if (act === 'repair-pro') { sendCmdSilent('repair hangar'); refetch(); return; }
    if (act === 'paint-apply') { const c = (B.data.craft || []).find(x => x.id === B.selId); if (c) sendCmdSilent(`paintset ${c.id} ${B.work.base} ${B.work.trim} ${B.work.pattern} ${B.work.finish} ${B.work.cabin} ${B.work.uphol} ${B.work.decal || 'none'}`); return; }
    if (act === 'paint-revert') { const c = (B.data.craft || []).find(x => x.id === B.selId); if (c) { B.work = { ...c.livery }; render(); } return; }
    if (act === 'scheme-save') { const n = (document.getElementById('hb-scheme-name')?.value || '').trim(); if (n) sendCmdSilent(`scheme save ${n}`); return; }
  });
  on('[data-cp]', 'click', (e) => { e.stopPropagation(); openColorPopover(e.currentTarget.getAttribute('data-cp'), e.currentTarget); });
  on('[data-sel-field]', 'change', (e) => { B.work[e.currentTarget.getAttribute('data-sel-field')] = e.currentTarget.value; render(); });
  on('[data-preset]', 'click', (e) => {
    const p = (B.data.catalog?.presets || []).find(x => x.id === e.currentTarget.getAttribute('data-preset'));
    if (p) { B.work = { ...B.work, base: p.base, trim: p.trim, pattern: p.pattern, finish: p.finish, cabin: p.cabin, uphol: p.uphol }; render(); }
  });
  on('[data-scheme-load]', 'click', (e) => sendCmdSilent(`scheme load ${e.currentTarget.getAttribute('data-scheme-load')}`));
  on('[data-scheme-del]', 'click', (e) => sendCmdSilent(`scheme delete ${e.currentTarget.getAttribute('data-scheme-del')}`));
  on('[data-tune]', 'click', (e) => { sendCmdSilent(`modify ${e.currentTarget.getAttribute('data-tune')} ${e.currentTarget.getAttribute('data-next')}`); refetch(); });
  on('[data-loadout]', 'click', (e) => { sendCmdSilent(`loadout ${e.currentTarget.getAttribute('data-loadout')}`); refetch(); });
  on('[data-hb-buy]', 'click', (e) => { sendCmdSilent(`buy ${e.currentTarget.getAttribute('data-hb-buy')}`); refetch(); });
  on('[data-hb-rent]', 'click', (e) => { sendCmdSilent(`rent ${e.currentTarget.getAttribute('data-hb-rent')}`); refetch(); });
}

// ── Shared render loop — the one #hb-scene canvas (a fixed camera angle, no
// sway: it's one room, not a row of individual turntables) plus any .hb-bay
// single-craft canvases on the bench/buy-rent screens (those keep their own
// idle spin, offset per canvas so they don't move in lock-step).
function startSpin() {
  if (raf) return;
  let last = 0;
  const loop = (t) => {
    const root = document.getElementById('hb-root');
    if (!root) { raf = null; return; }
    if (last) yaw += Math.min(0.05, (t - last) / 1000) * 0.55;
    last = t;

    const scene = root.querySelector('#hb-scene');
    if (scene) {
      if (!scene._cw) sizeCanvas(scene);
      const ctx = scene.getContext('2d');
      if (ctx) {
        ctx.setTransform(scene._dpr, 0, 0, scene._dpr, 0, 0);
        sceneHits = drawHangarScene(ctx, { w: scene._cw, h: scene._ch, entries: sceneEntries(), selId: B.selId, sky: B.data?.sky });
      }
    }
    root.querySelectorAll('canvas.hb-bay').forEach((cv) => {
      if (!cv._cw) sizeCanvas(cv);
      const ctx = cv.getContext('2d'); if (!ctx) return;
      ctx.setTransform(cv._dpr, 0, 0, cv._dpr, 0, 0);
      let lv = {};
      if (cv.getAttribute('data-hb-src') === 'work') lv = B.work || {};
      else { try { lv = JSON.parse(cv.getAttribute('data-hb-livery') || '{}'); } catch {} }
      const tint = cv.getAttribute('data-hb-tint') || undefined;
      const cls = cv.getAttribute('data-hb-cls');
      const zoom = parseFloat(cv.getAttribute('data-hb-zoom')) || 1;
      drawHangarFloorBay(ctx, { cls, livery: lv, yaw: yaw + (cv._phase || 0), w: cv._cw, h: cv._ch, tint, sky: B.data?.sky, zoom });
    });
    // Dealer lot cards — true-3D wireframe schematics, each spun at its own
    // phase offset (like the `.hb-bay` turntables) so a row of them doesn't
    // rotate in lockstep. Fixed-size canvases (no dpr scaling needed).
    root.querySelectorAll('canvas.hb-wf-lot').forEach((cv) => {
      if (cv._phase == null) cv._phase = Math.random() * 6.28;
      drawWireframe3D(cv.getContext('2d'), { cls: cv.getAttribute('data-wf-cls'), w: cv.width, h: cv.height, accent: themeColor('--accent', '#39ff9e'), yaw: yaw + cv._phase });
    });
    // Tuning tab's engine schematic — spins the prop-hub in step with the shared
    // yaw clock, needles read live off the selected craft's current tune curves.
    const engineCv = root.querySelector('#hb-engine-wf');
    if (engineCv) {
      const c = (B.data.craft || []).find(x => x.id === B.selId);
      drawEngineWireframe(engineCv.getContext('2d'), { w: engineCv.width, h: engineCv.height, tune: c?.tune || {}, spin: yaw, accent: themeColor('--accent', '#5fd6ff') });
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
// `.hb-bay` canvases carry their pixel size inline (style="width:..."); `#hb-scene`
// fills its container via CSS instead (it's meant to fill the available room, not
// sit at a fixed thumbnail size), so its size comes off its rendered box.
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const inline = parseFloat(cv.style.width);
  const rect = Number.isFinite(inline) ? null : cv.getBoundingClientRect();
  const cw = Number.isFinite(inline) ? inline : rect.width;
  const ch = Number.isFinite(inline) ? parseFloat(cv.style.height) : rect.height;
  if (!cw || !ch) return;   // not laid out yet — try again next frame
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  cv._dpr = dpr; cv._cw = cw; cv._ch = ch; cv._phase = Math.random() * 0.6;
}

// ── Styles ────────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('hb-styles')) return;
  const st = document.createElement('style'); st.id = 'hb-styles';
  st.textContent = `
  #area-content:has(#hb-root) { height:100%; }
  /* The shell — a moulded chassis (not a flat panel): a top sheen, a deep outer
     shadow, and a subtle edge highlight, the same "real object" cues the ATM's
     own #atm-box uses. Tinted off the theme's own bg/border palette (not a fixed
     blue-grey) so the casing itself follows whatever theme is active — only the
     CRT tubes' phosphor glow (green/cyan/yellow above) stays dark glass regardless
     of theme, the same way a real screen doesn't relight for your desktop wallpaper. */
  #hb-root { position:relative; display:flex; flex-direction:column; height:100%; min-height:460px; color:var(--text-bright, #dcecf8);
    font-family:'Courier New',monospace;
    background:linear-gradient(175deg,color-mix(in srgb, var(--border) 55%, var(--bg3)) 0%,var(--bg3) 8%,var(--bg2) 50%),
      radial-gradient(140% 100% at 50% 0%,color-mix(in srgb, var(--border) 40%, var(--bg3)),var(--bg) 75%);
    border:1px solid var(--hb-black2); border-radius:10px; overflow:hidden;
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(0,0,0,0.3), 0 14px 34px rgba(0,0,0,0.5); }
  /* A faint brushed-plastic grain over the shell — two crossed diagonal hairline
     sets at very low opacity, purely decorative (z-index:0, sits under every
     real screen/panel which are all z-index:1+). */
  #hb-root::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none; border-radius:inherit;
    background-image:
      repeating-linear-gradient(35deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px),
      repeating-linear-gradient(-55deg, rgba(0,0,0,0.03) 0 1px, transparent 1px 4px); }
  #hb-root > * { position:relative; z-index:1; }
  /* Top pane — ATM chassis language (dark moulded metal, glowing green readout)
     bookending the ordinary hangar look; only the head/toolbar chrome changes,
     the 3D scene and every screen's own content in between is untouched. */
  /* Monochrome, like the real ATM: every surface is the SAME hue (the theme's
     accent) at a different intensity — near-black tube glass at ~5-10%, full
     brightness for text/borders, brighter still on hover. Not a neutral black
     with a colored accent painted on top of it — the black itself carries the
     hue, so it reads as "this machine's colour, dimmed" rather than two
     unrelated colours layered together. --hb-black2 is the deeper edge tone. */
  #hb-root { --hb-atm-accent:var(--accent);
    --hb-black:color-mix(in srgb, var(--hb-atm-accent) 20%, #060809);
    --hb-black2:color-mix(in srgb, var(--hb-atm-accent) 11%, #020304); }
  /* Head/toolbar CRT glass via ::before/::after (not extra markup, since each
     screen builds its own toolbar) — scanlines + a diagonal sheen painted OVER
     the bar, same as a real tube's glass sits in front of the phosphor; buttons
     underneath stay clickable (pointer-events:none on both pseudo-layers). */
  #hb-root .hb-head, #hb-root .hb-toolbar { position:relative; overflow:hidden; }
  #hb-root .hb-head::before, #hb-root .hb-toolbar::before {
    content:''; position:absolute; inset:0; pointer-events:none; z-index:1;
    background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,0.22) 2px 3px); }
  #hb-root .hb-head::after, #hb-root .hb-toolbar::after {
    content:''; position:absolute; inset:0; pointer-events:none; z-index:1;
    background:linear-gradient(115deg, transparent 0 40%, rgba(220,255,245,0.07) 47%, rgba(220,255,245,0.02) 52%, transparent 60% 100%); }
  #hb-root .hb-head > *, #hb-root .hb-toolbar > * { position:relative; z-index:2; }
  #hb-root .hb-head { display:flex; align-items:center; gap:12px; padding:10px 14px; flex:0 0 auto;
    background:radial-gradient(160% 220% at 50% -60%,color-mix(in srgb, var(--hb-atm-accent) 20%, var(--hb-black)) 0%,var(--hb-black2) 80%); border-bottom:1px solid var(--hb-black2);
    box-shadow:inset 0 0 22px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 10px rgba(0,0,0,0.4); }
  #hb-root .hb-title { color:var(--hb-atm-accent); font-weight:bold; letter-spacing:2px; text-shadow:0 0 6px color-mix(in srgb, var(--hb-atm-accent) 55%, transparent); }
  /* Credits/price numbers read as bright emphasis, not a separate gold — same
     convention as the corp console's balance figure (.cc-bal, a fixed near-white
     regardless of accent) and the ATM's own all-one-color readout. */
  #hb-root .hb-credits { margin-left:auto; color:#eafffb; letter-spacing:1px; text-shadow:0 0 5px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); }
  #hb-root .hb-back { font-family:inherit; font-size:11px; letter-spacing:1px; cursor:pointer; padding:6px 12px;
    color:var(--hb-atm-accent); text-shadow:0 0 4px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent);
    background:color-mix(in srgb, var(--hb-atm-accent) 8%, #0d1013); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); border-radius:6px; }
  #hb-root .hb-back:hover { border-color:var(--hb-atm-accent); box-shadow:0 0 10px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  #hb-root .hb-body { flex:1 1 auto; overflow-y:auto; padding:10px 14px; min-height:0; display:flex; flex-direction:column; }
  #hb-root .hb-dim { color:#9db5c6; }
  #hb-root .hb-empty { color:#c2d6e4; font-size:13px; text-align:center; padding:24px 10px; }
  #hb-root .hb-note { color:#9db5c6; font-size:12px; padding:8px 0; }
  #hb-root .hb-hint { color:#9db5c6; font-size:11px; text-align:center; padding:8px 0; }

  /* Floor — one 3D scene canvas, not a row of cards */
  #hb-root .hb-floor { flex:1 1 auto; display:flex; min-height:280px; }
  #hb-root .hb-scene { width:100%; height:100%; min-height:280px; display:block; border-radius:8px; cursor:pointer; }
  #hb-root .hb-bay { display:block; border-radius:6px; }

  /* The selected-craft readout is a "panel on the floor scene" (not the 3D scene
     itself, which stays untouched) — same CRT glass treatment as the head/toolbar. */
  /* flex-shrink:0 matters here: .hb-floor is flex:1 1 auto and will happily eat
     all the room in a short area-pane, and since this box has overflow:hidden
     (needed to clip the scanline/glass corners) a squeezed box was silently
     clipping its OWN last child — the action buttons — instead of just looking
     cramped. Never shrinking below its content's natural height means the
     BODY scrolls instead of the buttons vanishing. */
  #hb-root .hb-info { position:relative; overflow:hidden; flex-shrink:0; margin-top:10px; padding:10px; border-radius:8px;
    background:radial-gradient(160% 220% at 50% -40%,color-mix(in srgb, var(--hb-atm-accent) 20%, var(--hb-black)) 0%,var(--hb-black2) 85%);
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, transparent);
    box-shadow:inset 0 0 18px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05); }
  #hb-root .hb-info::before { content:''; position:absolute; inset:0; pointer-events:none; z-index:1; border-radius:inherit;
    background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,0.2) 2px 3px); }
  #hb-root .hb-info::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:1; border-radius:inherit;
    background:linear-gradient(115deg, transparent 0 40%, rgba(220,255,245,0.06) 47%, rgba(220,255,245,0.02) 52%, transparent 60% 100%); }
  /* Real content sits ABOVE the decorative glass/scanline layers (z-index:1) —
     without this, buttons render fine but visually read as washed out/gone
     under the overlay, since absolutely-positioned decoration always paints
     over static in-flow content regardless of DOM order. */
  #hb-root .hb-info > * { position:relative; z-index:2; }
  #hb-root .hb-info-name { color:#ffffff; font-weight:bold; font-size:14px; }
  #hb-root .hb-info-type { color:#a8c6d8; font-weight:normal; font-size:11px; margin-left:6px; }
  #hb-root .hb-info-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
  #hb-root .hb-bars { display:inline-grid; grid-template-columns:auto 140px; gap:4px 8px; align-items:center; font-size:9px; letter-spacing:1px; color:#b8cede; margin-top:6px; }
  #hb-root .hb-bar { height:6px; background:rgba(0,0,0,0.3); border-radius:3px; overflow:hidden; } #hb-root .hb-bar i { display:block; height:100%; }
  #hb-root .hb-badge { font-size:8px; letter-spacing:1px; padding:1px 5px; border-radius:3px; margin-left:6px; vertical-align:middle; }
  #hb-root .hb-b-ramp { background:#2a5f8a; color:#bfe4ff; } #hb-root .hb-b-bay { background:#2a7a52; color:#b8f2cf; }
  #hb-root .hb-b-rent { background:#7a6a1e; color:#f2e0a0; } #hb-root .hb-b-wreck { background:#7a3a2a; color:#f2b8a0; }

  /* Every button in the hangar — toolbar, floor info panel, bench controls,
     charter — uses the exact same "ATM-recipe" single accent, gradient-filled,
     glowing on hover (see atm.js .atm-confirm / corp-console.js .cc-btn). Fully
     monochrome: even Exit Hangar/close uses the SAME accent as everything else
     now, no red exception — the whole console reads as one machine, one colour. */
  #hb-root .hb-btn { font-family:inherit; font-size:10.5px; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; cursor:pointer; padding:7px 13px; border-radius:4px;
    color:var(--hb-atm-accent); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 55%, transparent);
    background:linear-gradient(180deg, color-mix(in srgb, var(--hb-atm-accent) 20%, transparent), color-mix(in srgb, var(--hb-atm-accent) 7%, transparent));
    text-shadow:0 0 4px color-mix(in srgb, var(--hb-atm-accent) 40%, transparent);
    box-shadow:inset 0 -2px 0 rgba(0,0,0,0.4); transition:filter .12s, box-shadow .12s, transform .05s; }
  #hb-root .hb-btn:hover:not(:disabled) { filter:brightness(1.2); box-shadow:0 0 14px color-mix(in srgb, var(--hb-atm-accent) 40%, transparent), inset 0 -2px 0 rgba(0,0,0,0.4); }
  #hb-root .hb-btn:active:not(:disabled) { transform:translateY(1px); }
  #hb-root .hb-btn:disabled { opacity:0.4; cursor:default; }

  /* Bottom pane — same ATM chassis deck as the head bar; buttons here are the
     shared .hb-btn recipe above, no toolbar-specific override needed anymore.
     position:sticky pins it to the bottom of the scrolling body — Buy/Rent and
     Exit Hangar stay on-screen even when a tall floor/info panel makes .hb-body
     scroll, instead of needing to be scrolled down to. */
  #hb-root .hb-toolbar { display:flex; gap:8px; flex-wrap:wrap; flex:0 0 auto; padding:10px 14px; margin-top:auto;
    position:sticky; bottom:0; z-index:5;
    background:radial-gradient(160% 220% at 50% 160%,color-mix(in srgb, var(--hb-atm-accent) 20%, var(--hb-black)) 0%,var(--hb-black2) 80%); border-top:1px solid var(--hb-black2);
    box-shadow:inset 0 0 22px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.05), 0 -2px 10px rgba(0,0,0,0.4); }

  /* Charter — the whole screen sits in one CRT tube, same language as buy/rent. */
  #hb-root .hb-charter-crt { position:relative; overflow:hidden; padding:12px; border-radius:20px/14px;
    background:radial-gradient(130% 130% at 50% 42%,var(--hb-black) 55%,var(--hb-black2) 100%); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 25%, transparent);
    box-shadow:inset 0 0 30px rgba(0,0,0,0.9), inset 0 0 8px color-mix(in srgb, var(--hb-atm-accent) 25%, transparent); }
  #hb-root .hb-charter-crt::before { content:''; position:absolute; inset:0; pointer-events:none; z-index:1; border-radius:inherit;
    background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,0.2) 2px 3px); }
  #hb-root .hb-charter-crt::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:1; border-radius:inherit;
    background:
      linear-gradient(115deg, transparent 0 40%, rgba(220,255,245,0.08) 47%, rgba(220,255,245,0.03) 52%, transparent 60% 100%),
      radial-gradient(120% 120% at 50% 50%, transparent 65%, rgba(0,0,0,0.22) 100%); }
  #hb-root .hb-charter-crt > * { position:relative; z-index:2; }
  #hb-root .hb-charter-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; }
  #hb-root .hb-charter-pilot { font-weight:bold; letter-spacing:1px; }
  #hb-root .hb-charter-map { display:grid; gap:1px; margin:6px auto; overflow:auto; max-height:340px; background:#28333d; padding:4px; border-radius:6px; }
  #hb-root .hb-tile { width:20px; height:20px; display:flex; align-items:center; justify-content:center; position:relative; font-size:11px; border-radius:2px; }
  #hb-root .hb-tile-dim { background:#38434e; color:#7d92a1; }
  #hb-root .hb-tile-here { background:#4a3f70; color:#e0c6ff; }
  #hb-root .hb-tile-dest { background:#2a5f42; color:#a8f2c0; cursor:pointer; }
  #hb-root .hb-tile-dest:hover { background:#357d54; box-shadow:0 0 0 1px #6fe89a; }
  #hb-root .hb-tile-airfield { background:#3a5f24; color:#e0f28a; }
  #hb-root .hb-tile-airfield:hover { box-shadow:0 0 0 1px #e0f28a; }
  #hb-root .hb-tile-fare { position:absolute; bottom:-11px; left:50%; transform:translateX(-50%); font-size:7px; color:var(--yellow); white-space:nowrap; }
  #hb-root .hb-charter-legend { display:flex; gap:16px; font-size:10px; color:#b8cede; margin:14px 0 4px; flex-wrap:wrap; }
  #hb-root .hb-swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:middle; }
  #hb-root .hb-sw-air { background:#e0f28a; } #hb-root .hb-sw-any { background:#a8f2c0; }

  /* Buy/Rent */
  #hb-root .hb-scroll { overflow-y:auto; }
  #hb-root .hb-section { font-size:9px; letter-spacing:3px; color:#9db5c6; margin:12px 0 6px; border-bottom:1px solid #4a5f70; padding-bottom:3px; }
  #hb-root .hb-lotgrid { display:flex; flex-wrap:wrap; gap:12px; }
  #hb-root .hb-lot { width:150px; background:linear-gradient(160deg,#4a5f70,#374a58); border:1px solid #5a7185; border-radius:8px; padding:8px; cursor:pointer; font-family:inherit; color:#dcecf8; }
  #hb-root .hb-lot:hover { border-color:#7fd6ff; }
  #hb-root .hb-lot-art { display:flex; justify-content:center; }
  #hb-root .hb-lot-name { color:#ffffff; font-weight:bold; letter-spacing:1px; text-align:center; margin-top:4px; font-size:11px; }
  #hb-root .hb-lot-meta { color:#a8c6d8; font-size:9px; text-align:center; margin:2px 0 4px; }
  #hb-root .hb-lot-price { text-align:center; letter-spacing:1px; color:var(--yellow); }

  /* Dealer terminal (Buy/Rent) and mechanics bench — the full ATM CRT tube
     (bulging-glass radial gradient, deep inset vignette, scanlines, glass
     sheen), not just a dark glow. The floor screen deliberately keeps the
     ordinary hangar-room look — it's the one screen meant to feel like a
     physical space, not a terminal. */
  #hb-root .hb-dealer-crt { position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column;
    background:radial-gradient(130% 130% at 50% 42%,color-mix(in srgb, var(--hb-atm-accent) 22%, var(--hb-black2)) 55%,var(--hb-black2) 100%);
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, var(--hb-black2)); border-radius:20px/14px; padding:12px; overflow:hidden;
    box-shadow:inset 0 0 30px rgba(0,0,0,0.9), inset 0 0 8px color-mix(in srgb, var(--hb-atm-accent) 25%, transparent); }
  #hb-root .hb-dealer-crt .hb-scroll { position:relative; z-index:4; }
  #hb-root .hb-dealer-scanlines { position:absolute; inset:0; z-index:2; pointer-events:none; border-radius:inherit;
    background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,0.22) 2px 3px); }
  #hb-root .hb-crt-glass { position:absolute; inset:0; z-index:3; pointer-events:none; border-radius:inherit;
    background:
      linear-gradient(115deg, transparent 0 40%, rgba(220,255,245,0.09) 47%, rgba(220,255,245,0.03) 52%, transparent 60% 100%),
      radial-gradient(80% 55% at 26% 18%, rgba(255,255,255,0.10), transparent 60%),
      radial-gradient(120% 120% at 50% 50%, transparent 65%, rgba(0,0,0,0.22) 100%); }
  #hb-root .hb-dealer-crt .hb-section { color:var(--hb-atm-accent); text-shadow:0 0 5px color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); border-bottom-color:color-mix(in srgb, var(--hb-atm-accent) 35%, var(--hb-black2)); }
  #hb-root .hb-dealer-lot { background:linear-gradient(160deg,color-mix(in srgb, var(--hb-atm-accent) 22%, var(--hb-black2)),color-mix(in srgb, var(--hb-atm-accent) 5%, var(--hb-black2)));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 45%, var(--hb-black2)); color:var(--hb-atm-accent); text-shadow:0 0 4px color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); }
  #hb-root .hb-dealer-lot:hover { border-color:var(--hb-atm-accent); box-shadow:0 0 12px color-mix(in srgb, var(--hb-atm-accent) 25%, transparent); }
  #hb-root .hb-dealer-lot .hb-lot-name { color:var(--hb-atm-accent); }
  #hb-root .hb-dealer-lot .hb-lot-meta { color:color-mix(in srgb, var(--hb-atm-accent) 65%, white); }
  #hb-root .hb-dealer-lot .hb-lot-price { color:#eafffb; text-shadow:0 0 4px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); }
  #hb-root .hb-wf-lot { display:block; margin:0 auto; }

  /* Bench — ATM-style terminal (matches the dealer's CRT language, own cyan
     accent). Tabbed (PAINT/HULL/TUNING/W&B) instead of one long stack, so no
     section ever needs its own scrollbar. The stage stays pinned to the top
     (position:sticky) so the plane — or, on TUNING, the engine schematic —
     stays visible while the tab body scrolls beside it. */
  #hb-root .hb-bench { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
  #hb-root .hb-bench-stage { flex:0 0 auto; position:sticky; top:0; z-index:4; }
  #hb-root .hb-bench-panels { flex:1 1 260px; min-width:240px; position:relative; z-index:4; }
  /* No overflow:hidden here (unlike .hb-dealer-crt) — this element holds the
     sticky stage, and overflow:hidden would make IT the sticky containing
     block instead of the real scroll container (.hb-body), breaking the
     "stage stays visible while the tab body scrolls" behavior. The rounded
     corners are already matched by the scanline/glass overlays below, which
     are sized exactly to this box, so nothing needs clipping. */
  #hb-root .hb-bench-crt { position:relative; padding:12px; border-radius:20px/14px; border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, var(--hb-black2));
    background:radial-gradient(130% 130% at 50% 42%,color-mix(in srgb, var(--hb-atm-accent) 22%, var(--hb-black2)) 55%,var(--hb-black2) 100%);
    box-shadow:inset 0 0 30px rgba(0,0,0,0.9), inset 0 0 8px color-mix(in srgb, var(--hb-atm-accent) 25%, transparent); }
  #hb-root .hb-bench-crt .hb-note, #hb-root .hb-bench-crt .hb-dim { color:color-mix(in srgb, var(--hb-atm-accent) 55%, white); }
  #hb-root #hb-engine-wf { display:block; margin:0 auto; }
  #hb-root .hb-bench-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
  #hb-root .hb-tab { font-family:inherit; font-size:10px; letter-spacing:1.5px; color:var(--hb-atm-accent); cursor:pointer;
    background:color-mix(in srgb, var(--hb-atm-accent) 6%, transparent); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); border-radius:5px; padding:6px 11px;
    text-shadow:0 0 4px color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); }
  #hb-root .hb-tab:hover { border-color:var(--hb-atm-accent); background:color-mix(in srgb, var(--hb-atm-accent) 14%, transparent); }
  #hb-root .hb-tab-active { border-color:var(--hb-atm-accent); background:color-mix(in srgb, var(--hb-atm-accent) 20%, transparent); box-shadow:0 0 12px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  #hb-root .hb-bench-tabbody { color:color-mix(in srgb, var(--hb-atm-accent) 40%, white); }
  #hb-root .hb-bench-tabbody .hb-ctl, #hb-root .hb-bench-tabbody .hb-tune-row { color:color-mix(in srgb, var(--hb-atm-accent) 40%, white); }
  #hb-root .hb-subtabs { display:flex; gap:5px; margin-bottom:8px; }
  #hb-root .hb-subtab { font-family:inherit; font-size:9px; letter-spacing:1px; color:color-mix(in srgb, var(--hb-atm-accent) 55%, white); cursor:pointer;
    background:none; border:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); border-radius:4px; padding:4px 9px; }
  #hb-root .hb-subtab:hover { border-color:var(--hb-atm-accent); color:var(--hb-atm-accent); }
  #hb-root .hb-subtab-active { color:var(--hb-atm-accent); border-color:var(--hb-atm-accent); background:color-mix(in srgb, var(--hb-atm-accent) 12%, transparent); }
  #hb-root .hb-repair-row { display:flex; gap:8px; flex-wrap:wrap; }
  #hb-root .hb-tune-row { display:flex; align-items:center; gap:8px; font-size:11px; padding:3px 0; }
  #hb-root .hb-tune-val { color:#eafffb; min-width:32px; }
  #hb-root .hb-tune-desc { color:#a8c6d8; font-size:10px; flex:1; }
  #hb-root .hb-tune-cycle { padding:3px 8px; font-size:9px; }
  #hb-root .hb-loadout-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
  #hb-root .hb-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  #hb-root .hb-preset { display:flex; align-items:center; gap:6px; font-size:10px; letter-spacing:1px; color:#dcecf8; cursor:pointer;
    background:rgba(255,255,255,0.07); border:1px solid #5a7185; border-radius:6px; padding:4px 8px; font-family:inherit; }
  #hb-root .hb-preset:hover { border-color:#7fd6ff; }
  #hb-root .hb-chip { width:14px; height:14px; border-radius:3px; display:inline-block; }
  #hb-root .hb-ctls { display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
  #hb-root .hb-ctl { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; color:#dcecf8; letter-spacing:1px; }
  #hb-root .hb-ctl input[type=color] { width:44px; height:26px; padding:0; border:1px solid #5a7185; border-radius:5px; background:none; cursor:pointer; }
  #hb-root .hb-cp-swatch { width:44px; height:26px; padding:0; border:1px solid #5a7185; border-radius:5px; cursor:pointer; }
  #hb-root .hb-cp-pop { position:absolute; z-index:50; top:calc(100% + 6px); right:0; padding:10px; background:#1c2530; border:1px solid #5a7185; border-radius:8px; box-shadow:0 10px 24px rgba(0,0,0,0.5); width:160px; }
  #hb-root .hb-cp-svwrap { position:relative; width:160px; height:100px; }
  #hb-root .hb-cp-sv { display:block; width:160px; height:100px; border-radius:4px; cursor:crosshair; touch-action:none; }
  #hb-root .hb-cp-svcursor { position:absolute; top:0; left:0; width:10px; height:10px; margin:-5px 0 0 -5px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 2px rgba(0,0,0,0.8); pointer-events:none; }
  #hb-root .hb-cp-hue { position:relative; width:160px; height:14px; margin-top:10px; border-radius:4px; cursor:pointer; touch-action:none;
    background:linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000); }
  #hb-root .hb-cp-huecursor { position:absolute; top:-2px; left:0; width:6px; height:18px; margin-left:-3px; border-radius:2px; background:#fff; box-shadow:0 0 2px rgba(0,0,0,0.8); pointer-events:none; }
  #hb-root .hb-cp-hex-input { margin-top:10px; width:100%; box-sizing:border-box; background:rgba(0,0,0,0.25); color:#dcecf8; border:1px solid #5a7185; border-radius:5px; padding:5px 8px; font-family:inherit; text-align:center; letter-spacing:1px; }
  #hb-root .hb-ctl select { flex:1; max-width:120px; background:rgba(0,0,0,0.25); color:#dcecf8; border:1px solid #5a7185; border-radius:5px; padding:4px; font-family:inherit; }
  #hb-root .hb-apply-row { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  #hb-root .hb-schemes { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  #hb-root .hb-scheme { display:inline-flex; align-items:center; background:rgba(255,255,255,0.07); border:1px solid #5a7185; border-radius:6px; overflow:hidden; }
  #hb-root .hb-scheme-load { display:flex; align-items:center; gap:6px; font-size:10px; letter-spacing:1px; color:#dcecf8; cursor:pointer; background:none; border:none; padding:4px 6px 4px 8px; font-family:inherit; }
  #hb-root .hb-scheme-del { background:none; border:none; border-left:1px solid #5a7185; color:#9db5c6; cursor:pointer; padding:4px 7px; font-family:inherit; }
  #hb-root .hb-scheme-del:hover { color:#ff8a8a; }
  #hb-root .hb-scheme-save { display:flex; gap:8px; }
  #hb-root .hb-scheme-save input { flex:0 0 120px; background:rgba(0,0,0,0.25); color:#dcecf8; border:1px solid #5a7185; border-radius:5px; padding:5px 8px; font-family:inherit; }
  @media (max-width:620px) { #hb-root .hb-ctls { grid-template-columns:1fr; } #hb-root .hb-bench { flex-direction:column; align-items:center; } }
  `;
  document.head.appendChild(st);
}
