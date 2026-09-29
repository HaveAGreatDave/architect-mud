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
import { drawHangarFloorBay, drawPaintBooth, MODEL_SCALE, meshIdFor, meshParams } from './aircraft3d.js';
import { paintVehicleCard, paintSlotCard, cardStyleFor, cardSeed, ensureCardStyles, barTone } from './vehicle-card.js';
import { updateHangarAmbience, stopHangarAmbience } from './hangar-ambience.js';
import { drawWireframe3D, drawKnob, drawPerfRadar, themeColor, rgbTriplet } from './wireframe-plane.js';
import { showConfirmDialog } from './confirm.js';
import { openColorPicker, closeColorPicker } from './color-picker.js';
import { compactHidePanel } from '../../../shared/compact-view.js';
import { liveriesFor } from '../../../shared/livery-sets.js';
import { shellProfileFor } from '../../../shared/interior-shell.js';
import { loadWindshield, isLoaded as windshieldLoaded, paintWindshield, disposeWindshield, glWorldInstalled, RENDER_TUNE } from './windshield-lazy.js';

let B = null;       // { data, screen, selId, work (paint edit copy) }
let raf = null;      // shared spin/scene-draw loop
let yaw = 0;
let ro = null;       // resize watcher that repaints the floor's cards
let charterData = null;   // last charter_open payload
let charterAny = false;   // off-airfield (Dragonfly) mode toggled on the charter screen

export function isHangarBayActive() { return !!document.getElementById('hb-root'); }
// The walk-around inspect view drives its own first-person WASD camera, so — like the
// flight sim — it must own W/A/S/D: the MUD's wasd-move (main.js) and the type-anywhere
// auto-focus (input.js) both check this and stand down while it's up.
export function isHangarBayWalkActive() {
  return !!(B && B.screen === 'inspect' && (B.inspect?.mode || 'walk') === 'walk');
}

// ── Entry points (dispatch.js wires these to the server pushes) ───────────────
export function openHangarBay(data) {
  // A background refresh (e.g. after a remote tablet sale) only updates an
  // already-open bay — if the panel is closed, ignore it rather than popping the
  // 3D hangar open over whatever the player is actually looking at (the tablet).
  if (data?.refreshOnly && !B) return;
  const freshOpen = !B;
  // Snap the top pane back to its default auto size so the whole hangar UI fits the
  // interface, regardless of any manual drag height left on the previous room look.
  if (freshOpen) document.getElementById('area-pane')?.dispatchEvent(new CustomEvent('lookpaneauto'));
  // ⚠ AND ON A PHONE THE LOG FOLDS AWAY. The bay is a full-height UI in a pane that is a third of
  // a phone screen, and the scrollback takes the rest. Only on a FRESH open, which is what stops a
  // background refresh (a remote tablet sale) re-asserting it over a player who reopened the log.
  // The buttons light themselves off the body class at render, so there is nothing to pass here.
  if (freshOpen) compactHidePanel('hb-hidepanel');
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told; an app that mounts there has to say so
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
  ensureCardStyles();
  render();
}

export function openCharterScreen(data) {
  if (!B) openHangarBay({});
  charterData = data;
  charterAny = !!data?.vtolOnly;   // a VTOL-only pad (the Echelon) is Dragonfly-from-the-start
  B.screen = 'charter';
  render();
}

export function closeHangarBay() {
  closeColorPicker({ silent: true });
  stopHangarAmbience();   // the render loop drove the weather bed; it stops now, so silence it
  document.body.classList.remove('hb-fullscreen', 'hb-hidepanel');   // drop the immersive layout so the room look isn't left with the log/command box hidden
  window.dispatchEvent(new Event('pane:released'));  // hand the collapsed pane back to the phone layout
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  dropSeat();
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
  if (B.screen !== 'floor') { go('floor'); } else if (B.data?.inHangar) { sendCmdSilent(B.data.exitDir || 'out'); } else { closeHangarBay(); sendCmdSilent('look'); }
});

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
function go(screen) { closeColorPicker({ silent: true }); inspectKeys.clear(); B.screen = screen; render(); }
// Commands that don't self-refresh the panel (repair/tune/loadout/buy/rent) get a
// short delayed re-fetch — the same trick fleet.js used for `buy`.
function refetch() { setTimeout(() => sendCmdSilent('hangar'), 450); }

// Every toolbar button is an icon + label chip (tablet-style 3D control). One
// helper so the floor, bench, charter and dealer action bars all match.
function tbtn(icon, label, attrs = '', cls = '') {
  // The glyph is decoration and the word beside it is the button's real name, so
  // the icon is hidden from the accessible tree — otherwise "Cancel Rental" is
  // announced as "multiplication X Cancel Rental" and "Sell" as "credit Sell".
  return `<button class="hb-btn${cls ? ' ' + cls : ''}" ${attrs}><span class="hb-ico" aria-hidden="true">${icon}</span>${label}</button>`;
}

// ── Floor ───────────────────────────────────────────────────────────────────
// THE FLOOR IS A HAND OF CARDS, the depot's and the marina's (vehicle-card.js). One card per
// craft here — tap it and you're at her side in the maintenance bay — then the charter, then a
// slot to buy or rent. What else you can do to a craft from the floor is the strip under her card.
// The 3-D room is where the work happens (the bench), so the floor doesn't draw a second one.
function floorScreen() {
  const d = B.data, craft = (d.craft || []).filter(c => !c.wreck);
  const pilot = d.pilot || { present: false };
  const pumps = d.fuelStocks || [];
  const cards = craft.map(c => {
    const style = cardStyleFor(c.id);
    const badge = c.rental ? '<span class="vc-badge hired">RENTAL</span>'
      : `<span class="vc-badge owned">${c.location === 'hangar' ? 'IN BAY' : 'ON RAMP'}</span>`;
    const hull = Math.max(0, Math.min(100, c.hullPct));
    const acts = [
      tbtnMini('Fly', `data-act="embark" data-tail="${esc(c.tail)}"`, 'vc-go'),
      pumps.includes(c.fuelType) && c.fuelPct < 100 ? tbtnMini(`Refuel · ${c.fuelPct}%`, `data-act="refuel" data-id="${esc(c.id)}"`) : '',
      d.hasBay && c.location === 'ramp' ? tbtnMini('Store', `data-act="store" data-id="${esc(c.id)}"`) : '',
      d.hasBay && c.location === 'hangar' ? tbtnMini('Roll out', `data-act="pull" data-id="${esc(c.id)}"`) : '',
      c.rental ? tbtnMini('Return', `data-act="cancel_rental" data-id="${esc(c.id)}"`) : tbtnMini('Sell', `data-act="sell" data-id="${esc(c.id)}"`),
    ].filter(Boolean).join('');
    return `<div class="vc-wrap">
      <button class="vc-card ${style}" data-act="bench" data-id="${esc(c.id)}" aria-label="${esc(`${c.tail}, ${c.typeName}: open maintenance`)}" title="Maintenance, paint and tuning">
        <canvas class="vc-cv" data-card="${esc(c.id)}" aria-hidden="true"></canvas>
        ${badge}
        <span class="vc-plate"><b>${esc(c.tail)}</b><span class="vc-sub">${esc(c.typeName)} · fuel ${c.fuelPct}%</span>
          <span class="vc-bar" title="hull ${hull}%"><i class="${barTone(hull / 100)}" style="width:${hull}%"></i></span></span>
      </button>
      <div class="vc-acts">${acts}</div>
    </div>`;
  }).join('');

  // The charter, when this field has a desk: the pilot's own colours on a Mule (or a Dragonfly at a pad).
  let charter = '';
  if (pilot && d.canRent !== undefined && (pilot.present || d.charterWaiting || pilot.name)) {
    const unrated = !d.licensed && !d.isAdmin && d.venue !== 'helipad';
    const ready = pilot.present || !!d.charterWaiting;
    const sub = unrated ? 'take your checkride' : d.charterWaiting ? 'fuelled, ready to board' : pilot.present ? 'book a ride' : 'off shift';
    charter = `<div class="vc-wrap${ready || unrated ? '' : ' away'}"><button class="vc-card showroom" data-act="charter" ${ready || unrated ? '' : 'disabled'} aria-label="Charter: ${esc(sub)}">
        <canvas class="vc-cv" data-charter="1" aria-hidden="true"></canvas>
        <span class="vc-badge hired">CHARTER</span>
        <span class="vc-plate"><b>${esc(pilot.name || 'Charter')}</b><span class="vc-sub">${esc(sub)}</span></span></button></div>`;
  }
  const slots = [
    !d.isAdmin && !d.licensed ? `<div class="vc-wrap"><button class="vc-card slot" data-act="checkride" aria-label="Get your pilot licence">
        <canvas class="vc-cv" data-slot="licence" aria-hidden="true"></canvas>
        <span class="vc-plate"><b>Pilot licence</b><span class="vc-sub">a checkride in a loaner</span></span></button></div>` : '',
    d.canBuy || d.canRent ? `<div class="vc-wrap"><button class="vc-card slot" data-act="buyrent" aria-label="Buy or rent an aircraft">
        <canvas class="vc-cv" data-slot="buy" aria-hidden="true"></canvas>
        <span class="vc-plate"><b>${d.canBuy && d.canRent ? 'Buy or rent' : d.canBuy ? 'Buy' : 'Rent'}</b><span class="vc-sub">${(d.lots || []).length} on the line</span></span></button></div>` : '',
  ].join('');
  const hint = craft.length ? '' : `<div class="hb-hint">No aircraft of yours are here yet.${d.canBuy || d.canRent ? '' : ' There\'s no dealer or rental desk at this field either.'}</div>`;
  return `<div class="hb-hand-col hb-thin">${hint}<div class="vc-hand">${cards}${charter}${slots}</div></div>
    <div class="hb-toolbar"><div class="hb-tb-group hb-tb-right">${tbtn('⏻', d.inHangar ? 'Exit Hangar' : 'Close', 'data-act="close"', 'hb-close')}</div></div>`;
}
// A mesh craft's factory scheme rides on livery.variant; 'stock' means the file's own paint.
const liveVariant = (lv) => (lv?.variant && lv.variant !== 'stock' ? lv.variant : '');
function tbtnMini(label, attrs, cls = '') { return `<button class="vc-mini${cls ? ' ' + cls : ''}" ${attrs}>${label}</button>`; }

function watchSize() {
  if (ro || typeof ResizeObserver === 'undefined') return;
  const pane = document.getElementById('area-pane'); if (!pane) return;
  let t = 0;
  ro = new ResizeObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(paintFloorCards); });
  ro.observe(pane);
}
// The charter card's livery: the pilot's signature colour, solid.
function charterLivery() {
  const col = B.data.pilot?.color || '#f2b01e';
  return { base: col, trim: '#1a1a1a', pattern: 'solid', finish: 'gloss', cabin: '#1a1a1a' };
}
// Painted once per render and on resize, never in the loop (vehicle-card.js says why).
function paintFloorCards() {
  const root = document.getElementById('hb-root');
  if (!root || !B || B.screen !== 'floor') return;
  const craft = B.data.craft || [];
  for (const cv of root.querySelectorAll('canvas[data-card]')) {
    const c = craft.find(x => x.id === cv.dataset.card); if (!c) continue;
    paintVehicleCard(cv, { style: cardStyleFor(c.id), seed: cardSeed(c.id),
      v: { cls: c.class, armed: c.class === 'heli' && c.hardpoints > 0, variant: liveVariant(c.livery), livery: c.livery, yaw: 0.62, fit: 1.5 } });
  }
  for (const cv of root.querySelectorAll('canvas[data-charter]')) {
    paintVehicleCard(cv, { style: 'showroom', seed: 5, dim: !(B.data.pilot?.present || B.data.charterWaiting),
      v: { cls: B.data.venue === 'helipad' ? 'heli' : 'prop', livery: charterLivery(), yaw: 0.62, fit: 1.5 } });
  }
  for (const cv of root.querySelectorAll('canvas[data-slot]')) {
    const buy = cv.dataset.slot === 'buy';
    paintSlotCard(cv, { style: buy ? 'showroom' : 'sunburst', seed: buy ? 7 : 11, glyph: buy ? '+' : '✈' });
  }
}
// ── Walkaround inspect ────────────────────────────────────────────────────────
// A single-craft view of the selected plane in the hangar, in one of two modes:
//   • WALK — a first-person free camera: WASD/QE move the eye around the floor, drag turns
//     the head (mouse-look), scroll changes FOV. `cam` is the eye {x fwd, y right, z up, yaw,
//     pitch, fov} in the craft's frame.
//   • ORBIT — the classic turntable: drag orbits around the plane, drag up/down changes eye
//     height, scroll zooms.
// Both reuse the turntable renderer (drawHangarFloorBay → paintTurntable). Nested `cam` object
// ⇒ a factory (a shallow spread would share it across resets and mutate the default).
// Open standing off the nose, slightly to one side, looking back past the plane and out through
// the open bay door behind its tail — matching the floor/hangar view (door behind the craft), so
// the walk view frames it against the real sky/weather from the first frame (W walks you toward
// the tail + the door; the orbit turntable ignores cam).
const inspectDefault = () => ({ mode: 'walk', yaw: 0.7, elev: 0.28, zoom: 1.25,
  cam: { x: 2.5, y: 1.0, z: 0.02, yaw: Math.PI, pitch: 0.03, fov: 1 }, moveVec: { f: 0, r: 0, u: 0 } });
const inspectKeys = new Set();
const WALK_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', ' ']);
function inspectScreen() {
  const c = (B.data.craft || []).find(x => x.id === B.selId);
  if (!c) { B.screen = 'floor'; return floorScreen(); }
  const walk = (B.inspect?.mode || 'walk') === 'walk';
  // Touch controls (a thumbstick + up/down pads) — CSS-hidden on fine pointers (desktop uses
  // WASD/drag/scroll), shown on coarse pointers (phones/tablets), and only in walk mode.
  const touchPad = walk ? `
      <div class="hb-walk-pad"><div class="hb-walk-stick" id="hb-walk-stick"><div class="hb-walk-knob" id="hb-walk-knob"></div></div></div>
      <div class="hb-walk-vert">
        <button class="hb-walk-btn" data-walk="up" tabindex="-1">▲</button>
        <button class="hb-walk-btn" data-walk="dn" tabindex="-1">▼</button>
      </div>` : '';
  // Walk right up to the cockpit and this lights → tap/Enter to climb in (first-person embark).
  const boardPrompt = (walk && !c.wreck) ? `<div class="hb-board" id="hb-board" data-act="embark" data-tail="${esc(c.tail)}">✈ BOARD</div>` : '';
  return `
    <div class="hb-floor">
      <canvas id="hb-inspect" class="hb-scene hb-inspect" tabindex="0"></canvas>
      <div class="hb-inspect-name">${esc(c.tail)} <span>${esc(c.typeName)}</span></div>
      <div class="hb-inspect-hint">${walk ? 'WASD / stick move · drag look · walk up to BOARD' : 'drag to orbit · scroll / pinch zoom'}</div>
      ${boardPrompt}
      ${touchPad}
    </div>
    <div class="hb-toolbar">
      <div class="hb-tb-group">
        ${!c.wreck ? tbtn('✈', 'Board', `data-act="embark" data-tail="${esc(c.tail)}"`, 'hb-accent hb-go') : ''}
        ${tbtn('⇄', walk ? 'Walk' : 'Orbit', 'data-act="inspect-mode"')}
        ${tbtn('↺', 'Reset View', 'data-act="inspect-reset"')}
      </div>
      <div class="hb-tb-group hb-tb-right">${tbtn('‹', 'Back', 'data-act="back"')}</div>
    </div>`;
}
// WASD capture — only while the walk-inspect screen is up and no text field is focused
// (so it never eats keystrokes meant for the command box or a rename field). Bound once.
window.addEventListener('keydown', (e) => {
  if (!B || B.screen !== 'inspect' || (B.inspect?.mode || 'walk') !== 'walk') return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (WALK_KEYS.has(k)) {
    if (k === ' ' && !inspectKeys.has(' ')) startInspectHop();   // Space = a quick hop on the leading edge, not a held climb
    inspectKeys.add(k); e.preventDefault();
  } else if (k === 'enter' || k === 'f') { const b = document.getElementById('hb-board'); if (b?.classList.contains('near')) { b.click(); e.preventDefault(); } }   // board when you've walked up to her
});
// Space = a little hop: a quick upward bob that arcs back to eye level under gravity (NOT the
// continuous climb e/QE gives). Lives as a transient offset on B.inspect.hop, layered onto cam.z
// at render time; only fires from grounded so taps don't stack.
function startInspectHop() {
  if (!B?.inspect || B.inspect.mode !== 'walk') return;
  const hop = B.inspect.hop || (B.inspect.hop = { off: 0, vel: 0 });
  if (hop.off <= 1e-3 && Math.abs(hop.vel) < 1e-3) hop.vel = 2.1;
}
window.addEventListener('keyup', (e) => { inspectKeys.delete(e.key.toLowerCase()); });
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
    return `<div class="${cls}" style="grid-column:${gx};grid-row:${gy}" ${active ? `data-hb-dest="${t.id}"` : ''} title="${esc(t.name)}${fare != null && active ? `: ${fare}₵` : ''}">
      <span class="hb-tile-icon">${label}</span>
      ${active && fare != null ? `<span class="hb-tile-fare">${fare}₵</span>` : ''}
    </div>`;
  }).join('');

  const vtolOnly = !!c.vtolOnly;
  const legend = vtolOnly
    ? `<span><i class="hb-swatch hb-sw-any"></i> The Dragonfly sets down anywhere flat, pick any tile.</span>`
    : `<span><i class="hb-swatch hb-sw-air"></i> Airfield: the Mule (${charterAny ? '' : 'active'})</span>
       <span><i class="hb-swatch hb-sw-any"></i> Any tile: the Dragonfly, off-airfield premium</span>`;
  return `
    <div class="hb-charter-crt">
      <div class="hb-charter-head">
        <span class="hb-charter-pilot" style="color:${c.pilotColor || '#f2b01e'}">✈ ${esc(c.pilotName)}</span>
        <span class="hb-dim">"Where you headed? Pick a spot on the map."</span>
        <span class="hb-credits">₵ ${c.credits ?? 0}</span>
      </div>
      <div class="hb-charter-map" style="grid-template-columns:repeat(${W},20px); grid-template-rows:repeat(${H},20px);">${cells}</div>
      <div class="hb-charter-legend">${legend}</div>
    </div>
    <div class="hb-toolbar">
      <div class="hb-tb-group">${vtolOnly ? '' : tbtn('⛟', `${charterAny ? '✓ ' : ''}Off-airfield drop (Dragonfly)`, 'data-act="charter-any"', charterAny ? 'hb-accent' : '')}</div>
      <div class="hb-tb-group hb-tb-right">${tbtn('‹', 'Back', 'data-act="back"')}</div>
    </div>`;
}

// ── Buy / Rent — a dealer showroom: tablet-surface product cards, each with a
// wireframe schematic in a recessed viewport (instead of the floor/bench's realistic
// shaded 3D turntable) so an airframe you don't own yet reads as a spec drawing.
// Shares the tablet's --tos-* surface language with the rest of the hangar app.
// One big wireframe per airframe with a Buy and a Rent button underneath it (each shown only
// where the field offers that desk). A button is disabled if you can't afford it OR you have
// no pilot licence — admins bypass both. The whole card is no longer a single click target.
function lotCard(t) {
  const d = B.data;
  const admin = !!d.isAdmin, licensed = admin || !!d.licensed, credits = d.credits || 0;
  const acqBtn = (kind, price) => {
    const canAfford = admin || credits >= price;
    const ok = licensed && canAfford;
    const why = !licensed ? 'You need a pilot licence, pass a checkride first.'
      : !canAfford ? "You can't afford this." : `${kind === 'buy' ? 'Buy' : 'Rent'} the ${t.name}`;
    return `<button class="hb-lot-acq hb-lot-${kind}" data-hb-${kind}="${esc(t.id)}"${ok ? '' : ' disabled'} title="${esc(why)}">
      ${kind === 'buy' ? 'BUY' : 'RENT'} · ₵${price}${kind === 'rent' ? '/hr' : ''}</button>`;
  };
  return `<div class="hb-lot">
    <div class="hb-lot-view"><canvas class="hb-wf-lot" data-wf-cls="${esc(t.class)}" data-wf-armed="${t.class === 'heli' && (t.hardpoints > 0) ? '1' : ''}" width="200" height="142"></canvas></div>
    <div class="hb-lot-name">${esc(t.name)}</div>
    <div class="hb-lot-meta">${esc(t.class)} · ${t.seats} seat${t.seats > 1 ? 's' : ''} · ${esc(t.fuel)}</div>
    <div class="hb-lot-acts">
      ${d.canBuy ? acqBtn('buy', t.priceBuy) : ''}
      ${d.canRent ? acqBtn('rent', t.priceRent) : ''}
    </div>
  </div>`;
}
function buyRentScreen() {
  const d = B.data;
  const gate = !d.isAdmin && !d.licensed
    ? `<div class="hb-lot-lockmsg">⚠ You need a pilot licence to buy or rent, pass a checkride at Coldwater Regional first.
       <button class="hb-btn hb-accent" data-act="checkride" style="margin-top:8px">✈ Take the checkride</button></div>` : '';
  return `<div class="hb-dealer"><div class="hb-scroll">${gate}<div class="hb-lotgrid">${(d.lots || []).map(lotCard).join('')}</div></div></div>
    <div class="hb-toolbar"><div class="hb-tb-group hb-tb-right">${tbtn('‹', 'Back', 'data-act="back"')}</div></div>`;
}

// ── Mechanics bench (maintenance: paint + repair + tune + loadout) ─────────
// The colour picker itself now lives in ./color-picker.js — the spray can uses the
// same wheel, and a second copy would have drifted. What stays here is the bench's
// half of the deal: writing straight into B.work so the hero canvas repaints live
// as you drag (startSpin re-reads it every frame), and a full render() only once
// the picker closes, since rendering mid-drag would tear the popover down.
// A field is a livery key ('base') or a named mesh part ('part:ruff'), which lands in work.parts.
const workGet = (field) => field.startsWith('part:') ? (B.work.parts || {})[field.slice(5)] || partRgbHex(field.slice(5)) : B.work[field];
function setPickerColor(field, hex) {
  if (field.startsWith('part:')) B.work.parts = { ...(B.work.parts || {}), [field.slice(5)]: hex };
  else B.work[field] = hex;
  const btn = document.querySelector(`.hb-cp-swatch[data-cp="${field}"]`);
  const chip = btn?.querySelector('i'), lbl = btn?.querySelector('em');
  if (chip) chip.style.background = hex;
  if (lbl) lbl.textContent = hex.toUpperCase();
}
function openColorPopover(field, btn) {
  openColorPicker({
    key: field, anchor: btn, value: workGet(field), title: field.replace(/^part:/, ''), themeFrom: 'hb-root',
    onChange: (hex) => setPickerColor(field, hex),
    onClose: () => render(),
  });
}

function swatchRow(label, field) {
  // A plain <div>, deliberately NOT a <label>: a <button> is a labelable element, so
  // wrapping the swatch in a label made every click inside it get forwarded back to the
  // swatch a second time, which toggled the picker shut the instant you pressed a colour.
  return `<div class="hb-ctl hb-ctl-sw"><span>${label}</span>
    <button type="button" class="hb-cp-swatch" data-cp="${field}"><i style="background:${B.work[field]}"></i><em>${esc((B.work[field] || '').toUpperCase())}</em></button></div>`;
}
// The dash nameplate: left blank it reads the cabin trim's own name (Quackhawk Down) or the class default.
function plateRow(c, cat) {
  if (!(cat.plateDefault || {})[c.class]) return '';
  const trimName = ((cat.cabinTrims || {})[c.class] || []).find(t => t.id === B.work.itrim)?.plate || cat.plateDefault[c.class];
  return `<label class="hb-ctl"><span>Nameplate</span><input data-plate-field maxlength="${cat.plateMax || 16}" placeholder="${esc(trimName)}" value="${esc(B.work.plate || '')}"></label>`;
}
function selectRow(label, field, opts) {
  return `<label class="hb-ctl"><span>${label}</span><select data-sel-field="${field}">${
    opts.map(o => `<option value="${o.id}"${o.id === B.work[field] ? ' selected' : ''}>${o.label}</option>`).join('')
  }</select></label>`;
}
// LIVERY. Three pages:
//   SCHEMES — every look as a card: a band of its colours, its name and where it came from. The
//     special editions come off the model's own mesh file (its `schemes`), so a new model's editions
//     show up here without a line of this file changing.
//   PAINT — base, trim, pattern, finish and nose art, then EVERY PART the model's mesh file names,
//     each its own swatch. Nothing here knows which model it is; the list is the file's paint slots.
//   CABIN — trim, colour, upholstery and the dash nameplate.
// Picking only changes the preview on the stage; nothing is charged until Apply.
const LOOK_KEYS = ['base', 'trim', 'accent', 'pattern', 'finish', 'cabin', 'uphol'];
const hex2 = (c) => '#' + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
const curCraftMesh = () => { const c = curCraft(); return c ? meshParams(meshIdFor(c.class, c.class === 'heli' && c.hardpoints > 0)) : null; };
// A slot's colour as the model shows it now: the scheme picked in the work copy over the file's paint.
function slotRgb(mesh, slot, variant) {
  const sch = (variant && variant !== 'stock' && mesh?.schemes?.[variant]) || {};
  return (sch[slot] || mesh?.paints?.[slot] || {}).rgb || [128, 128, 128];
}
function partRgbHex(slot) { return hex2(slotRgb(curCraftMesh(), slot, B.work?.variant)); }
// A scheme's band: up to six distinct colours, in the order the file lists them.
function meshBand(mesh, variant) {
  const out = [];
  for (const k of Object.keys(mesh?.paints || {})) {
    if (/^(lens|lamp|pupil|eye|grille|gun|chrome|flag)/.test(k)) continue;
    const h = hex2(slotRgb(mesh, k, variant));
    if (!out.some(o => colourDist(o, h) < 40)) out.push(h);
    if (out.length >= 6) break;
  }
  return out;
}
function colourDist(a, b) { const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
const prettySlot = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
function lookCard(attrs, band, name, tag, on, extra = '') {
  const stripes = band.map((h, i) => `<i style="background:${esc(h)};--i:${i}"></i>`).join('');
  return `<button class="hb-look${on ? ' on' : ''}" ${attrs}>
    <span class="hb-look-band">${stripes}<em></em></span>
    <b>${esc(name)}</b>${tag ? `<span class="hb-look-tag">${esc(tag)}</span>` : ''}${extra}</button>`;
}
function paintTabHtml(c, cat, dirty) {
  if (!c.paintable) {
    return `<div class="hb-note">${c.wreck ? 'A wreck: nothing worth painting.' : c.rental ? "Rentals can't be painted." : 'You can only paint an aircraft you own.'}</div>`;
  }
  const pt = ['schemes', 'paint', 'cabin'].includes(B.paintTab) ? B.paintTab : (B.paintTab = 'schemes');
  const seg = [['schemes', 'Schemes'], ['paint', 'Paint'], ['cabin', 'Cabin']]
    .map(([k, l]) => `<button class="hb-subtab${pt === k ? ' hb-subtab-active' : ''}" data-paint-tab="${k}">${l}</button>`).join('');
  const applyRow = `<div class="hb-apply-row">
    <button class="hb-btn hb-accent" data-act="paint-apply"${dirty ? '' : ' disabled'}>Apply · ${c.paintCost}₵</button>
    <button class="hb-btn" data-act="paint-revert"${dirty ? '' : ' disabled'}>Revert</button>
  </div>`;
  const W = B.work, mesh = curCraftMesh();
  const noParts = !W.parts || !Object.keys(W.parts).length;
  let panel;
  if (pt === 'schemes') {
    const cards = [];
    const specials = ((cat.trims || {})[c.class] || []);
    const special = (v) => specials.find(t => t.id === v && t.id !== 'stock' && /special/i.test(t.label));
    const star = '<span class="hb-look-star">★</span>';
    // A factory edition that a livery set wears gets that set's card and no card of its own, or the
    // booth shows it twice. Every authored set counts, locked ones too, so a locked set's edition
    // doesn't come back free as a bare edition card.
    const setVariants = new Set(liveriesFor('aircraft', c.class).map(s => s.exterior?.variant).filter(Boolean));
    if (mesh && specials.length) for (const t of specials) {
      if (setVariants.has(t.id)) continue;
      const [name, sub] = t.label.split(' · ');
      cards.push(lookCard(`data-variant="${esc(t.id)}"`, meshBand(mesh, t.id), name,
        t.id === 'stock' ? 'the original' : sub || 'factory edition', (W.variant || 'stock') === t.id && W.pattern === 'bare' && noParts, special(t.id) ? star : ''));
    }
    // The livery sets this pilot has unlocked for the class (content/liveries/). A card only tries
    // the set on, so the booth shows it; Apply paints it for the respray fee. A set on the factory
    // pattern wears the mesh file's own scheme, so its band is that scheme's colours.
    for (const st of (c.sets || [])) {
      const sp = special(st.look.variant);
      const band = mesh && st.look.pattern === 'factory' ? meshBand(mesh, st.look.variant)
        : [st.look.base, st.look.trim, st.look.pattern === 'jazz' && st.look.accent].filter(Boolean);   // only jazz paints the accent
      cards.push(lookCard(`data-set="${esc(st.id)}"`, band, st.name, st.factory ? 'factory' : sp ? 'special edition' : 'livery set',
        LOOK_KEYS.every(k => st.look[k] == null || W[k] === st.look[k]) && (W.variant || 'stock') === (st.look.variant || 'stock'), sp ? star : ''));
    }
    const mine = (c.schemes || []).map(sc => `<span class="hb-look-wrap">${lookCard(`data-scheme-load="${esc(sc.name)}"`,
      [sc.base, sc.trim, sc.accent, ...Object.values(sc.parts || {})].filter(Boolean).filter((h, i, a) => a.findIndex(x => colourDist(x, h) < 30) === i).slice(0, 6),
      sc.name, 'yours', false)}<button class="hb-look-del" data-scheme-del="${esc(sc.name)}" aria-label="Delete scheme ${esc(sc.name)}">✕</button></span>`);
    panel = `
      <div class="hb-looks">${cards.join('')}</div>
      <div class="hb-section">YOUR SCHEMES</div>
      <div class="hb-looks">${mine.join('') || '<span class="hb-dim">None yet. Paint her on the Paint page, apply it, then save it here.</span>'}</div>
      <div class="hb-scheme-save"><input id="hb-scheme-name" placeholder="name this look" maxlength="16"><button class="hb-btn" data-act="scheme-save"${dirty ? ' disabled title="Apply your paint first"' : ''}>Save current look</button></div>
      ${applyRow}`;
  } else if (pt === 'paint') {
    const slots = Object.keys(mesh?.paints || {}).filter(k => !/^(lens|lamp|pupil)/.test(k));
    const parts = slots.map(k => {
      const own = (W.parts || {})[k], hex = own || partRgbHex(k);
      return `<span class="hb-part${own ? ' own' : ''}"><button type="button" class="hb-cp-swatch" data-cp="part:${esc(k)}" title="${esc(prettySlot(k))}"><i style="background:${esc(hex)}"></i><em>${esc(prettySlot(k))}</em></button>${own ? `<button class="hb-part-x" data-part-reset="${esc(k)}" aria-label="Back to the scheme's colour">↺</button>` : ''}</span>`;
    }).join('');
    panel = `
      <div class="hb-ctls">
        ${swatchRow('Base', 'base')}${swatchRow('Trim', 'trim')}
        ${W.pattern === 'jazz' ? swatchRow('Accent', 'accent') + swatchRow('Ground', 'ground') : ''}
        ${selectRow('Pattern', 'pattern', cat.patterns)}${selectRow('Finish', 'finish', cat.finishes)}
        ${selectRow('Nose art', 'decal', cat.decals || [])}
      </div>
      ${slots.length ? `<div class="hb-section">EVERY PART <span class="hb-dim">· tap one to paint it by itself</span></div>
      <div class="hb-parts">${parts}</div>
      ${noParts ? '' : '<button class="hb-btn" data-act="parts-clear">Clear every part</button>'}` : ''}
      ${applyRow}`;
  } else {
    panel = `
      <div class="hb-ctls">${(cat.cabinTrims || {})[c.class] ? selectRow('Cabin trim', 'itrim', cat.cabinTrims[c.class]) : ''}${swatchRow('Cabin', 'cabin')}${selectRow('Upholstery', 'uphol', cat.uphol)}${plateRow(c, cat)}</div>
      ${applyRow}`;
  }
  return `<div class="hb-subtabs">${seg}</div>` + panel;
}

// Hull — the airframe's condition read as a shop docket: a big lit gauge with the
// mechanic's verdict under it, then whatever work is actually on offer.
function hullTabHtml(c) {
  const pct = Math.max(0, Math.min(100, c.hullPct));
  const col = pct < 25 ? '#ff6b6b' : pct < 55 ? '#ffb26b' : pct < 90 ? 'var(--yellow)' : 'var(--hb-atm-accent)';
  const verdict = pct >= 98 ? 'Factory-tight. Nothing on the docket.'
    : pct >= 80 ? 'Cosmetic scuffing and a few popped rivets. Flies fine.'
    : pct >= 55 ? 'Working cracks in the skin. She rattles above cruise.'
    : pct >= 25 ? 'Structural. Something is going to let go.'
    : 'Held together by paint and optimism.';
  const gauge = `<div class="hb-hull-gauge">
      <div class="hb-hull-num" style="color:${col}">${pct}<small>%</small></div>
      <div class="hb-hull-track"><i style="width:${pct}%;background:${col};color:${col}"></i>
        <u style="left:25%"></u><u style="left:55%"></u><u style="left:90%"></u></div>
      <div class="hb-hull-verdict">${verdict}</div>
    </div>`;
  const acts = c.rental
    ? `<div class="hb-note">Maintenance is bundled into your rental.</div>
       <div class="hb-repair-row"><button class="hb-btn hb-accent" data-act="repair">Square her away (free)</button></div>`
    : pct >= 98 ? `<div class="hb-note">No work to book.</div>`
    : `<div class="hb-repair-row">
        <button class="hb-btn" data-act="repair">DIY repair · ~${c.diyCost}₵</button>
        <button class="hb-btn hb-accent" data-act="repair-pro">Shop repair · ${c.shopCost}₵ (guaranteed)</button>
      </div>`;
  return gauge + acts + hopperStripHtml(c);
}

// Loading the hopper, offered from the MAINTENANCE tab as well as its own.
//
// Topping her up is something you do in the same visit as the repair and the
// walk-round, and making it a separate tab meant leaving the bench you were
// already standing at. So the strip appears under Hull for anything that has a
// hopper, and the full tab stays for when the chemical is the reason you came.
//
// Both surfaces render the SAME buttons out of hopperCansHtml, so there is one
// definition of what a can button is and what disables it. A second copy here
// would be the place the clash rule quietly stopped matching.
function hopperStripHtml(c) {
  if (!(c.hopperCap > 0) || c.wreck) return '';
  const cap = c.hopperCap, amt = Math.max(0, Math.min(cap, c.hopperAmount || 0));
  const pct = Math.round(amt / cap * 100);
  const line = pct === 0 ? 'Hopper dry.'
    : pct >= 98 ? `Hopper brimmed with ${esc(c.hopperFluid || 'fluid')}.`
    : `Hopper at ${pct}%: ${amt} of ${cap} units of ${esc(c.hopperFluid || 'fluid')}.`;
  const body = pct >= 98
    ? `<div class="hb-note">Full. Fly a few passes before you top her up again.</div>`
    : hopperCansHtml(c, amt);
  return `<div class="hb-hop-strip"><div class="hb-card-head"><span class="hb-card-dot"></span>HOPPER</div>
    <div class="hb-hull-verdict">${line}</div>${body}</div>`;
}

// The can buttons. Every one is `loadhopper <craftId> <that can's name>` — a command
// the player could have typed, so the panel proposes and the verb decides.
function hopperCansHtml(c, amt) {
  const cans = B.data.chemCans || [];
  if (!cans.length)
    return `<div class="hb-note">You've nothing holding liquid. Fill a container at a tap or a water source, then come back.</div>`;
  // A hopper holds ONE fluid at a time, so anything that isn't what's already in there is shown
  // greyed with the reason — hiding it would read as "you're not carrying anything".
  const rows = cans.map(k => {
    const clash = amt > 0 && c.hopperFluid && k.fluid !== c.hopperFluid;
    return `<button class="hb-btn hb-hop-can${clash ? ' hb-hop-clash' : ''}" data-act="loadhopper" data-can="${esc(k.name)}"${clash ? ' disabled' : ''}>
      <b>${esc(k.name)}</b>${k.count > 1 ? ` <em>×${k.count}</em>` : ''}
      <span>${clash ? `holds ${esc(k.fluid)}, but she's loaded with ${esc(c.hopperFluid)}` : `${k.amount} units of ${esc(k.fluid)}`}</span></button>`;
  }).join('');
  return `<div class="hb-note">Pour from what you're carrying. The container comes back empty.</div><div class="hb-hop-cans">${rows}</div>`;
}

// Hopper — the ag-plane's chemical tank, read the same way Hull is: a gauge, a verdict, then
// the work on offer. The tab exists only where c.hopperCap > 0, so it's the Locust's alone.
//
// It offers CANS, not a free-text field: every button is `loadhopper <craftId> <that can's
// name>`, which is a command the player could have typed, so the panel proposes and the verb
// decides (the workspace HUD's rule — the bench must not re-derive the pour's preconditions).
// One press pours ONE container, which is why a stack shows its count rather than its total.
function hopperTabHtml(c) {
  const cap = c.hopperCap || 1, amt = Math.max(0, Math.min(cap, c.hopperAmount || 0));
  const pct = Math.round(amt / cap * 100);
  const col = pct < 10 ? '#ff6b6b' : pct < 40 ? '#ffb26b' : '#63d0f0';
  const verdict = pct === 0 ? 'Dry. Nothing to lay down.'
    : pct >= 98 ? `Brimmed with ${esc(c.hopperFluid || 'fluid')}. Watch your weight on the roll.`
    : `${amt} of ${cap} units of ${esc(c.hopperFluid || 'fluid')} aboard: about ${Math.floor(amt / 20)} pass${Math.floor(amt / 20) === 1 ? '' : 'es'} left.`;
  const gauge = `<div class="hb-hull-gauge">
      <div class="hb-hull-num" style="color:${col}">${pct}<small>%</small></div>
      <div class="hb-hull-track"><i style="width:${pct}%;background:${col};color:${col}"></i>
        <u style="left:20%"></u><u style="left:50%"></u><u style="left:80%"></u></div>
      <div class="hb-hull-verdict">${verdict}</div>
    </div>`;
  if (pct >= 98) return gauge + `<div class="hb-note">Full. Fly a few passes before you top her up again.</div>`;
  return gauge + hopperCansHtml(c, amt);
}

// ── Tuning: continuous dials + a live performance graph ───────────────────────
// The five perf axes, in radar-ring order. MIRROR of state.js PERF_AXES — the axis
// math below (computeAxesClient) mirrors state.perfAxes/computeStats so the graph
// morphs instantly as you drag, before the server round-trip. On Apply the server
// recomputes authoritatively and re-pushes, so any drift self-corrects.
const PERF_LABELS = [
  { id: 'speed', label: 'SPEED', desc: 'Cruise speed vs. stock, coarser pitch and more boost push this up; a leaner mixture trims it back a little.' },
  { id: 'economy', label: 'ECON', desc: 'Fuel burn vs. stock, a leaner mixture stretches your range; boost and a heavy load both drink more.' },
  { id: 'range', label: 'RANGE' },
  { id: 'cool', label: 'COOL', desc: 'Heat margin vs. stock, rich mixture and boost both run hotter; an intercooler kit tempers it.' },
  { id: 'agility', label: 'AGILITY' },
];
const TUNE_KEYS = ['mixture', 'pitch', 'boost', 'cg'];
function computeStatsClient(c, tune) {
  const b = c.perfBase || { cruise: 1, burn: 1, maxTOW: 300, pace: 1 };
  const mix = tune.mixture || 0, pitch = tune.pitch || 0, boost = tune.boost || 0;
  const loadFrac = (c.cargoNow || 0) / (b.maxTOW || 300);
  const cool = (c.kitsInstalled || []).includes('kit_intercooler') ? 0.6 : 1;
  return {
    burn: b.burn * (1 - mix * 0.12 + boost * 0.06) * (1 + loadFrac * 0.5),
    cruise: b.cruise * b.pace * (1 + pitch * 0.12 + boost * 0.10 - mix * 0.03),
    heatBias: (mix * 13 + Math.abs(boost) * 11) * cool,
  };
}
function computeAxesClient(c, tune) {
  const cur = computeStatsClient(c, tune), stk = computeStatsClient(c, {});
  const cl = v => Math.max(2, Math.min(100, Math.round(v)));
  const rng = s => s.cruise / s.burn;
  const cg = tune.cg || 0, pitch = tune.pitch || 0, loadFrac = (c.cargoNow || 0) / ((c.perfBase?.maxTOW) || 300);
  return {
    speed: cl(50 + (cur.cruise / stk.cruise - 1) * 300),
    economy: cl(50 + (stk.burn / cur.burn - 1) * 300),
    range: cl(50 + (rng(cur) / rng(stk) - 1) * 260),
    cool: cl(50 - cur.heatBias * 1.6),
    agility: cl(50 + cg * 16 - pitch * 8 - loadFrac * 22),
  };
}
const STOCK_AXES = { speed: 50, economy: 50, range: 50, cool: 50, agility: 50 };

// Init/keep the working tune copy the dials write into, keyed to the selected craft.
function ensureTuneWork(c) {
  if (!B.tune || B.tuneFor !== c.id) { B.tune = { ...(c.tune || {}) }; B.tuneFor = c.id; }
}
const curCraft = () => (B.data.craft || []).find(x => x.id === B.selId) || null;

// Owner-only (matches hangars.js requireOwned — rentals fly stock). Renders the four
// rotary knobs (hover each for what it does) side by side with the delta bars,
// Apply/Reset, and the kit shop. The radar lives on the bench stage; paintTuning()
// draws it + the knobs + the bars.
function tuningTabHtml(c) {
  if (c.wreck) return '<div class="hb-note">A wreck: nothing to tune.</div>';
  if (c.rental) return '<div class="hb-note">You can only tune an aircraft you <b>own</b>: rentals fly stock.</div>';
  ensureTuneWork(c);
  const params = (B.data.tuneParams || []).filter(p => TUNE_KEYS.includes(p.id));
  const knobs = params.map(p => `
    <div class="hb-knob-cell" title="${esc(p.desc || '')}">
      <canvas class="hb-knob" data-knob="${p.id}" width="60" height="60"></canvas>
      <div class="hb-knob-label">${esc(p.label || p.id)}</div>
      <div class="hb-knob-val" data-knobval="${p.id}">0.00</div>
      <div class="hb-knob-poles"><span>${esc(p.lo || '−')}</span><span>${esc(p.hi || '+')}</span></div>
    </div>`).join('');
  const bars = PERF_LABELS.map(a => `
    <div class="hb-pbar-row"><span class="hb-pbar-l"${a.desc ? ` title="${esc(a.desc)}"` : ''}>${a.label}</span>
      <span class="hb-pbar"${a.desc ? ` title="${esc(a.desc)}"` : ''}><i data-pbar="${a.id}"></i></span>
      <b class="hb-pbar-d" data-pbard="${a.id}"></b></div>`).join('');
  return `
    <div class="hb-tune-grid">
      <div class="hb-knobs">${knobs}</div>
      <div class="hb-perf-bars">${bars}</div>
    </div>
    <div class="hb-apply-row">
      <button class="hb-btn hb-accent" data-act="tune-apply">Apply Tune</button>
      <button class="hb-btn" data-act="tune-reset">Reset to stock</button>
      <span class="hb-tune-note">Range ±${c.tuneRange ?? 1}, set by <b>Fabrication</b> + kits (see the <b>KITS</b> tab). Hover a dial for what it does.</span>
    </div>`;
}

// The upgrade-kit shop — its own bench tab (kits widen the dials / tame the heat).
// A selectable list of the airframe's kits down the side, with the picked kit's
// blurb + install action beside it, so nothing ever scrolls off the tuning screen.
function kitsTabHtml(c) {
  if (c.wreck) return '<div class="hb-note">A wreck: nothing to upgrade.</div>';
  if (c.rental) return '<div class="hb-note">You can only fit kits to an aircraft you <b>own</b>: rentals fly stock.</div>';
  const cat = c.kitCatalog || [];
  if (!cat.length) return '<div class="hb-note">No upgrade kits fit this airframe.</div>';
  if (!B.kitSel || !cat.some(k => k.id === B.kitSel)) B.kitSel = (cat.find(k => !k.owned) || cat[0]).id;
  const sel = cat.find(k => k.id === B.kitSel) || cat[0];
  const list = cat.map(k => `
    <button class="hb-kit-item${k.id === sel.id ? ' hb-kit-item-sel' : ''}" data-kit-pick="${esc(k.id)}">
      <span class="hb-kit-item-name">${esc(k.name)}</span>
      <span class="hb-kit-item-tag${k.owned ? ' hb-kit-item-fitted' : ''}">${k.owned ? '✓ FITTED' : k.price + 'c'}</span>
    </button>`).join('');
  return `<div class="hb-kits-head">UPGRADE KITS</div>
    <div class="hb-kits2">
      <div class="hb-kit-list">${list}</div>
      <div class="hb-kit-detail">
        <div class="hb-kit-detail-name">${esc(sel.name)}</div>
        <div class="hb-kit-blurb">${esc(sel.blurb)}</div>
        <div class="hb-kit-detail-act">
          ${sel.owned ? '<span class="hb-kit-tag">✓ FITTED</span>' : `<button class="hb-btn hb-accent" data-kit="${esc(sel.id)}">Install · ${sel.price}₵</button>`}
        </div>
      </div>
    </div>`;
}

// Size a small instrument canvas to the device pixel ratio and hand back a context
// pre-scaled to CSS units, so the knob dials and radar stay crisp on hi-dpi screens
// (they were drawn at 1× before and went soft). Backing store is only resized when
// the target size/dpr changes, so repeated drag repaints stay cheap.
function hiDpiCtx(cv, cssW, cssH) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (cv._hdW !== cssW || cv._hdH !== cssH || cv._hdpr !== dpr) {
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv._hdW = cssW; cv._hdH = cssH; cv._hdpr = dpr;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
// Draw everything that reflects the live working tune: the stage radar, the four
// knob faces, the numeric read-outs, and the delta bars. Called after each render
// and on every knob drag (cheap; only redraws canvases + a few text/width writes).
function paintTuning() {
  const root = document.getElementById('hb-root'); if (!root) return;
  const c = curCraft(); if (!c || !B.tune) return;
  // Resolve the live theme so the canvas instruments follow it: accent for the lit
  // arcs/traces, `face` (the dial's surface) for the machined metal, `ink` (the text
  // colour) for graticule + ticks. On a light theme the dials come out pale, not black.
  const accent = themeColor('--accent', '#5fd6ff');
  const face = themeColor('--bg3', '#20262c');
  const ink = rgbTriplet(themeColor('--text-dim', '#8888a8'));
  const pos = themeColor('--green', '#9fe0b0'), neg = themeColor('--orange', '#e0894f');
  const axes = computeAxesClient(c, B.tune);
  const radar = root.querySelector('#hb-perf-radar');
  if (radar) drawPerfRadar(hiDpiCtx(radar, 220, 200), { w: 220, h: 200, axes, stock: STOCK_AXES, labels: PERF_LABELS, accent, ink });
  const range = c.tuneRange || 1;
  root.querySelectorAll('[data-knob]').forEach(cv => {
    const p = cv.getAttribute('data-knob');
    drawKnob(hiDpiCtx(cv, 60, 60), { w: 60, h: 60, value: B.tune[p] || 0, range, accent, face, ink });
  });
  root.querySelectorAll('[data-knobval]').forEach(el => {
    const v = B.tune[el.getAttribute('data-knobval')] || 0;
    el.textContent = (v > 0 ? '+' : '') + v.toFixed(2);
  });
  PERF_LABELS.forEach(a => {
    const bar = root.querySelector(`[data-pbar="${a.id}"]`), dl = root.querySelector(`[data-pbard="${a.id}"]`);
    const val = axes[a.id], delta = val - 50;
    if (bar) { const lo = Math.min(50, val), hi = Math.max(50, val); const col = delta >= 0 ? accent : neg; bar.style.left = lo + '%'; bar.style.width = (hi - lo) + '%'; bar.style.background = col; bar.style.color = col; }
    if (dl) { dl.textContent = (delta > 0 ? '+' : '') + delta; dl.style.color = delta >= 0 ? pos : neg; }
  });
}

// Vertical drag on a knob sets its curve (up = more). Writes B.tune live and repaints
// the graph each move; nothing is committed until Apply (tuneset). ~120px of travel
// spans one full side of the reachable range.
function startKnobDrag(e) {
  const cv = e.currentTarget, param = cv.getAttribute('data-knob');
  const c = curCraft(); if (!c || !B.tune) return;
  const range = c.tuneRange || 1, startY = e.clientY, startV = B.tune[param] || 0;
  cv.setPointerCapture(e.pointerId);
  const move = (ev) => {
    let v = startV + (startY - ev.clientY) * (range / 120);
    v = Math.round(Math.max(-range, Math.min(range, v)) * 100) / 100;
    B.tune[param] = v;
    paintTuning();
  };
  const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up, { once: true });
  cv.addEventListener('pointercancel', up, { once: true });
}

// Weight & balance — the cabin fit-out, read as a loading sheet: three stat tiles for
// what she's carrying now (with the hold's fill as a bar), then the three fits.
function weightTabHtml(c) {
  const opt = (lbl, seats, cmd) => `<button class="hb-btn${seats === c.seatsNow ? ' hb-accent' : ''}" data-loadout="${cmd}">${lbl} · ${seats} seat${seats > 1 ? 's' : ''}</button>`;
  const cap = c.cargoCapNow || 0, loaded = c.cargoLoaded || 0;
  const fill = cap ? Math.max(0, Math.min(100, Math.round(loaded / cap * 100))) : 0;
  return `<div class="hb-loadout">
    <div class="hb-wb-tiles">
      <div class="hb-wb-tile"><i>Budget</i><b>${c.loadoutBudget}<small>kg</small></b></div>
      <div class="hb-wb-tile"><i>Seats</i><b>${c.seatsNow}</b></div>
      <div class="hb-wb-tile"><i>Hold</i><b>${cap}<small>kg</small></b>
        <span class="hb-hullbar"><em style="width:${fill}%;background:var(--hb-atm-accent);color:var(--hb-atm-accent)"></em></span>
        <u>${loaded}kg loaded</u></div>
    </div>
    <div class="hb-section">CABIN FIT</div>
    <div class="hb-loadout-row">${opt('Passenger', c.maxSeats, 'passenger')}${opt('Combi', c.seats, 'combi')}${opt('Freight', 1, 'freight')}</div>
  </div>`;
}

// THE MAINTENANCE BAY. She stands in 3-D where she actually is — in the hangar if she's stored
// (or you're standing in it), out on the ramp if she's parked outside, on the pad at a helipad —
// and the work is a row of cards beside her: tap one and its page opens under the row. Drag the
// stage to walk round her. Livery edits preview on the stage live.
// The paint booth takes the stage on the Livery card unless you've asked for the bay back; the
// button on the stage flips it on any card.
const boothOn = () => (B.boothPick ?? B.benchTab === 'paint');
// THE BOOTH'S INTERIOR VIEW: the craft's own cockpit, the one she is flown from, painted by GLASS
// (windshield.js paintWindshield) with the work copy's cabin trim, nameplate and cabin colour. The
// cockpit is geometry only GLASS 2 draws, so with WebGL or 3-D interiors off the view says so.
const SEAT_ID = 'hb-seat';
const armedOf = (c) => c.class === 'heli' && c.hardpoints > 0;
const hasCabin = (c) => !!(c && !c.wreck && shellProfileFor(c.class, armedOf(c)));
const seatOn = () => boothOn() && B.boothView === 'int' && hasCabin(curCraft());
const seatDrawable = () => windshieldLoaded() && glWorldInstalled() && RENDER_TUNE.gl && RENDER_TUNE.interior && RENDER_TUNE.cockpit3d;
let seatLive = false;
function dropSeat() { if (seatLive && windshieldLoaded()) disposeWindshield(SEAT_ID); seatLive = false; }
// Nothing outside but flat ground: the booth is indoors, and the windows only need light through them.
const SEAT_MAP = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({ kind: 'land', biome: 'citycore', flr: 0 })));
function seatView(sc, t) {
  const lv = B.work || sc.livery || {}, look = B.seatLook || (B.seatLook = { yaw: -18, pitch: -12, held: false });
  // Left alone, the head drifts slowly across the panel, as the stage drifts round her outside.
  const yaw = look.held ? look.yaw : look.yaw + 14 * Math.sin(t * 0.25);
  return { cls: sc.class, armed: armedOf(sc), phase: 'cruise', height: 0.1, worldBlend: 1, hour: 13, weather: 'clear',
    speed: 0, heading: 0, mapOffset: { x: 0, y: 0 }, pitch: 0, bank: 0, lookYaw: yaw, lookPitch: look.pitch,
    map: SEAT_MAP, livery: lv, powered: true, fuel: 1, hull: 1, noWxBadge: true,   // indoors: no weather readout on the glass
    ...(sc.class === 'drake' ? { drakeCab: { trim: lv.itrim || 'stock', plate: lv.plate || '', gear: 1 } } : {}) };
}
function stageVenue(c) {
  if (B.data.venue === 'helipad') return 'helipad';
  if (B.data.inHangar || c.location === 'hangar') return 'hangar';
  return 'ramp';
}
const STAGE_CAP = { hangar: 'IN THE HANGAR', ramp: 'ON THE RAMP', helipad: 'ON THE PAD' };
function benchScreen() {
  const c = (B.data.craft || []).find(x => x.id === B.selId);
  if (!c) return '<div class="hb-empty">Pick an aircraft first.</div><div class="hb-toolbar"><button class="hb-btn" data-act="back">Back</button></div>';
  if (!B.work) B.work = { ...c.livery };
  const cat = B.data.catalog || { patterns: [], finishes: [], uphol: [] };
  const dirty = JSON.stringify(B.work) !== JSON.stringify(c.livery);
  const canTune = !c.wreck && !c.rental;
  const hull = Math.max(0, Math.min(100, c.hullPct));
  const lookName = (() => {
    const lv = c.livery || {};
    const st = (c.sets || []).find(x => LOOK_KEYS.every(k => x.look[k] == null || lv[k] === x.look[k]) && (lv.variant || 'stock') === (x.look.variant || 'stock'));
    if (st) return st.name;
    const sp = ((cat.trims || {})[c.class] || []).find(t => t.id === lv.variant && t.id !== 'stock');
    return sp ? sp.label.split(' · ')[0] : 'custom';
  })();
  const tuned = TUNE_KEYS.some(k => Math.abs((c.tune || {})[k] || 0) > 0.001);
  const fitted = (c.kitCatalog || []).filter(k => k.owned).length;
  const cards = [
    { id: 'hull', ico: '🔧', label: 'Repair', sub: `hull ${hull}%`, tone: barTone(hull / 100) },
    { id: 'paint', ico: '🎨', label: 'Livery', sub: dirty ? 'unsaved changes' : lookName },
    ...(c.hopperCap > 0 && !c.wreck ? [{ id: 'hopper', ico: '💧', label: 'Hopper', sub: `${Math.round((c.hopperAmount || 0) / c.hopperCap * 100)}%` }] : []),
    ...(canTune ? [{ id: 'tuning', ico: '🎛', label: 'Tuning', sub: tuned ? 'tuned' : 'stock' },
                   { id: 'kits', ico: '⚙', label: 'Kits', sub: `${fitted} fitted` }] : []),
    ...(c.configurable ? [{ id: 'weight', ico: '⚖', label: 'Load', sub: `${c.seatsNow} seat${c.seatsNow === 1 ? '' : 's'}` }] : []),
  ];
  if (!cards.some(t => t.id === B.benchTab)) B.benchTab = cards[0].id;
  const row = `<div class="hb-jobs">${cards.map(t => `<button class="hb-job${t.id === B.benchTab ? ' on' : ''}" data-bench-tab="${t.id}">
      <span class="hb-job-ico" aria-hidden="true">${t.ico}</span><b>${esc(t.label)}</b><span class="hb-job-sub${t.tone ? ' ' + t.tone : ''}">${esc(t.sub)}</span></button>`).join('')}</div>`;

  const body = B.benchTab === 'hull' ? hullTabHtml(c)
    : B.benchTab === 'hopper' ? hopperTabHtml(c)
    : B.benchTab === 'tuning' ? tuningTabHtml(c)
    : B.benchTab === 'kits' ? kitsTabHtml(c)
    : B.benchTab === 'weight' ? weightTabHtml(c)
    : paintTabHtml(c, cat, dirty);

  const venue = stageVenue(c);
  const booth = boothOn(), seat = seatOn();
  if (!seat) dropSeat();
  else if (!windshieldLoaded()) loadWindshield().then(() => { if (B && seatOn()) render(); }).catch(() => {});
  const radar = B.benchTab === 'tuning' ? `<canvas id="hb-perf-radar" class="hb-stage-radar" width="220" height="200"></canvas>` : '';
  const statusPill = c.rental ? '<b class="hb-bench-pill hb-bench-pill-rent">Rental</b>' : '';
  return `
    <div class="hb-bay2">
      <div class="hb-bay2-stage${booth ? ' hb-booth' : ''}">
        ${seat ? `<canvas id="${SEAT_ID}" class="hb-scene hb-seat" tabindex="0" aria-label="The cockpit of ${esc(c.tail)}"></canvas>
        ${seatDrawable() ? '' : `<div class="hb-seat-note">${windshieldLoaded() ? 'The cabin view needs 3-D graphics on.' : 'Opening her up…'}</div>`}`
        : `<canvas id="hb-stage3d" class="hb-scene" tabindex="0" aria-label="${esc(c.tail)} ${esc(STAGE_CAP[venue].toLowerCase())}"></canvas>`}
        <div class="hb-inspect-name">${esc(c.tail)} <span>${esc(c.typeName)}</span> ${statusPill}</div>
        <div class="hb-inspect-hint">${seat ? 'PAINT SHOP · drag to look round' : booth ? 'PAINT SHOP · drag to spin her' : STAGE_CAP[venue] + ' · drag to walk round her'}</div>
        ${booth && hasCabin(c) ? `<div class="hb-view-seg" role="group" aria-label="Booth view">${[['ext', 'Exterior'], ['int', 'Interior']]
          .map(([k, l]) => `<button type="button" data-booth-view="${k}" aria-pressed="${(seat ? 'int' : 'ext') === k}"${(seat ? 'int' : 'ext') === k ? ' class="on"' : ''}>${l}</button>`).join('')}</div>` : ''}
        <button class="hb-stage-mode" data-act="stage-mode">${booth ? '⌂ Back to the ' + (venue === 'hangar' ? 'hangar' : venue === 'helipad' ? 'pad' : 'ramp') : '✦ Paint booth'}</button>
        ${radar}
      </div>
      <div class="hb-bay2-side">
        ${row}
        <div class="hb-bench-tabbody hb-thin" data-tabkey="${B.benchTab}">${body}</div>
      </div>
    </div>
    <div class="hb-toolbar">
      <div class="hb-tb-group">
        ${!c.wreck ? tbtn('✈', 'Fly', `data-act="embark" data-tail="${esc(c.tail)}"`, 'hb-accent hb-go') : ''}
        ${tbtn('◉', 'Walk round', 'data-act="inspect"')}
      </div>
      <div class="hb-tb-group hb-tb-right">${tbtn('‹', 'Back', 'data-act="back"')}</div>
    </div>`;
}

// ── Render dispatch ─────────────────────────────────────────────────────────
function render() {
  if (!B) return;
  // setAreaPane rebuilds #hb-root, so drop any live colour popover first — otherwise
  // cpState would point at a detached node (it no longer self-closes on outside click).
  closeColorPicker({ silent: true });
  const d = B.data || {};
  const title = B.screen === 'charter' ? 'CHARTER' : B.screen === 'buyrent' ? 'BUY / RENT' : B.screen === 'bench' ? 'MAINTENANCE' : B.screen === 'inspect' ? 'INSPECT' : 'HANGAR BAY';
  const body = B.screen === 'charter' ? charterScreen() : B.screen === 'buyrent' ? buyRentScreen() : B.screen === 'bench' ? benchScreen() : B.screen === 'inspect' ? inspectScreen() : floorScreen();
  // A persistent back button lives in the header itself (not just the bottom
  // toolbar) on every non-floor screen — always visible, never scrolled out of view.
  const backBtn = B.screen !== 'floor' ? `<button class="hb-back" data-act="back" title="Back to the hangar floor">‹ Hangar</button>` : '';
  // Immersive view toggles — the same pair the flight sim carries: ⊟ folds away the
  // scrollback log (command box stays), ⛶ fills the whole column. Their lit state is
  // read off the body class so it survives every re-render.
  const fs = document.body.classList.contains('hb-fullscreen'), hp = document.body.classList.contains('hb-hidepanel');
  const viewBtns = `<span class="hb-viewbtns">
      <button class="hb-viewbtn${hp ? ' on' : ''}" data-act="hidepanel" title="hide the text panel, more hangar view">⊟</button>
      <button class="hb-viewbtn${fs ? ' on' : ''}" data-act="fullscreen" title="fullscreen">⛶</button>
    </span>`;
  setAreaPane(`<div id="hb-root">
    <div class="hb-head">${backBtn}<span class="hb-title">✈ ${title}: ${esc(d.field || '')}</span>
      <span class="hb-credits">₵ ${d.credits ?? 0}</span>${viewBtns}</div>
    <div class="hb-body">${body}</div>
  </div>`);
  wire();
  startSpin();
  if (B.screen === 'floor') { requestAnimationFrame(paintFloorCards); watchSize(); }
  // The tuning radar/knobs/bars aren't part of startSpin's canvas set — draw them
  // once here after the DOM is built; knob drags repaint them on the fly.
  // The bench no longer scrolls as a page (the tab body is the only scroll region, and
  // only as a last resort), so the stage needs no sticky offset measuring any more.
  if (B.screen === 'bench' && B.benchTab === 'tuning') paintTuning();
}

function wire() {
  const root = document.getElementById('hb-root'); if (!root) return;
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));

  on('[data-bench-tab]', 'click', (e) => { B.benchTab = e.currentTarget.getAttribute('data-bench-tab'); B.boothPick = null; render(); });
  on('[data-paint-tab]', 'click', (e) => { B.paintTab = e.currentTarget.getAttribute('data-paint-tab'); render(); });

  on('[data-booth-view]', 'click', (e) => { B.boothView = e.currentTarget.getAttribute('data-booth-view'); render(); });
  // The booth's cockpit: drag to turn your head, as you would sat in her.
  const seatCv = root.querySelector('#' + SEAT_ID);
  if (seatCv) {
    const look = B.seatLook || (B.seatLook = { yaw: -18, pitch: -12, held: false });
    let last = null;
    seatCv.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; seatCv.setPointerCapture(e.pointerId); look.held = true; });
    seatCv.addEventListener('pointermove', (e) => {
      if (!last) return;
      look.yaw = Math.max(-150, Math.min(150, look.yaw + (e.clientX - last.x) * 0.3));
      look.pitch = Math.max(-60, Math.min(40, look.pitch - (e.clientY - last.y) * 0.25));
      last = { x: e.clientX, y: e.clientY };
    });
    const up = () => { last = null; };
    seatCv.addEventListener('pointerup', up); seatCv.addEventListener('pointercancel', up);
    // The arrow keys look round too, so the view doesn't need a pointer.
    seatCv.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] }[e.key];
      if (!d) return;
      e.preventDefault(); look.held = true;
      look.yaw = Math.max(-150, Math.min(150, look.yaw + d[0])); look.pitch = Math.max(-60, Math.min(40, look.pitch + d[1]));
    });
  }
  // The maintenance stage: drag to walk round her (the camera orbits), scroll to step in or out.
  const stage3d = root.querySelector('#hb-stage3d');
  if (stage3d) {
    B.orbit = B.orbit || { a: 0.75, r: 1, h: 0.35 };
    let last = null;
    stage3d.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; stage3d.setPointerCapture(e.pointerId); B.orbit.held = true; });
    stage3d.addEventListener('pointermove', (e) => {
      if (!last) return;
      B.orbit.a -= (e.clientX - last.x) * 0.008;
      B.orbit.h = Math.max(0.05, Math.min(1.4, B.orbit.h + (e.clientY - last.y) * 0.006));
      last = { x: e.clientX, y: e.clientY };
    });
    const up = () => { last = null; B.orbit.held = false; };
    stage3d.addEventListener('pointerup', up); stage3d.addEventListener('pointercancel', up);
    stage3d.addEventListener('wheel', (e) => { e.preventDefault(); B.orbit.r = Math.max(0.7, Math.min(1.5, B.orbit.r * (1 + e.deltaY * 0.001))); }, { passive: false });
  }
  // Walkaround inspect: drag to orbit (yaw + eye height), scroll to zoom. Writes the
  // live camera into B.inspect, which the render loop reads every frame.
  const inspect = root.querySelector('#hb-inspect');
  if (inspect) {
    B.inspect = B.inspect || inspectDefault();
    inspect.focus?.();   // so WASD lands here, not the command box
    // Multi-pointer: ONE finger/mouse = look (walk) or orbit; TWO fingers = pinch-zoom. Pointer
    // Events unify mouse + touch, so this drives desktop and mobile from the same code.
    const ptrs = new Map();   // pointerId → {x, y}
    let pinch = 0;            // last two-finger distance, 0 when not pinching
    const twoDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const applyZoom = (ratio) => {
      if (B.inspect.mode === 'walk') B.inspect.cam.fov = Math.max(0.5, Math.min(2, B.inspect.cam.fov / ratio));
      else B.inspect.zoom = Math.max(0.6, Math.min(2.8, B.inspect.zoom * ratio));
    };
    inspect.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); inspect.setPointerCapture(e.pointerId); inspect.style.cursor = 'grabbing'; inspect.focus?.(); if (ptrs.size === 2) pinch = twoDist(); });
    inspect.addEventListener('pointermove', (e) => {
      const prev = ptrs.get(e.pointerId); if (!prev) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size >= 2) {                                       // pinch → zoom, no look
        const d = twoDist(); if (pinch) applyZoom(d / pinch); pinch = d; return;
      }
      if (B.inspect.mode === 'walk') {
        const cam = B.inspect.cam;
        cam.yaw += dx * 0.006;                                    // drag right → look right
        cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.005));   // drag up → look up
      } else {
        B.inspect.yaw -= dx * 0.01;
        B.inspect.elev = Math.max(0.05, Math.min(1.3, B.inspect.elev + dy * 0.006));
      }
    });
    const endPtr = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; if (!ptrs.size) inspect.style.cursor = 'grab'; };
    inspect.addEventListener('pointerup', endPtr);
    inspect.addEventListener('pointercancel', endPtr);
    inspect.addEventListener('wheel', (e) => { e.preventDefault(); applyZoom(1 - e.deltaY * 0.0012); }, { passive: false });
  }

  // Virtual thumbstick (touch, walk mode): feeds a move vector the render loop reads like WASD.
  const stick = root.querySelector('#hb-walk-stick'), knob = root.querySelector('#hb-walk-knob');
  if (stick && knob && B.inspect) {
    B.inspect.moveVec = B.inspect.moveVec || { f: 0, r: 0, u: 0 };
    let sid = null;
    const place = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(e.pointerId); });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const r = stick.getBoundingClientRect(), R = r.width / 2;
      let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const mag = Math.hypot(dx, dy); if (mag > R) { dx = dx / mag * R; dy = dy / mag * R; }
      place(dx, dy);
      B.inspect.moveVec.r = dx / R; B.inspect.moveVec.f = -dy / R;   // stick up = forward
    });
    const rel = (e) => { if (e.pointerId !== sid) return; sid = null; place(0, 0); B.inspect.moveVec.f = 0; B.inspect.moveVec.r = 0; };
    stick.addEventListener('pointerup', rel); stick.addEventListener('pointercancel', rel);
  }
  // Up/down pads (touch, walk mode) — hold to climb/drop the eye.
  const setU = (v) => { if (B.inspect) { B.inspect.moveVec = B.inspect.moveVec || { f: 0, r: 0, u: 0 }; B.inspect.moveVec.u = v; } };
  on('[data-walk]', 'pointerdown', (e) => { e.preventDefault(); setU(e.currentTarget.getAttribute('data-walk') === 'up' ? 1 : -1); });
  on('[data-walk]', 'pointerup', () => setU(0));
  on('[data-walk]', 'pointercancel', () => setU(0));
  on('[data-walk]', 'pointerleave', () => setU(0));
  on('[data-hb-dest]', 'click', (e) => {
    const dest = e.currentTarget.getAttribute('data-hb-dest');
    sendCmdSilent(`charterbook ${dest}${charterAny ? ' any' : ''}`);
    go('floor'); refetch();
  });

  on('[data-act]', 'click', (e) => {
    const act = e.currentTarget.getAttribute('data-act');
    // Standing inside the walk-in hangar: "Exit" actually walks you back out to the
    // ramp — the move fires zone.entered on the far side, which pushes `hangar_close`
    // to dismiss the panel. The way out is whatever door the interior actually has
    // (server-supplied exitDir; `out` on old hangars, a compass dir on rebuilt ones).
    // Opened from the open ramp itself, there's no interior to leave, so just dismiss.
    // Immersive view toggles (mirror the flight sim's ⛶/⊟): flip the body class the
    // CSS reads, keep the two mutually exclusive, and re-light both buttons in place —
    // no full render(), so the live 3D scene never blinks.
    if (act === 'fullscreen' || act === 'hidepanel') {
      const cls = act === 'fullscreen' ? 'hb-fullscreen' : 'hb-hidepanel';
      const other = act === 'fullscreen' ? 'hb-hidepanel' : 'hb-fullscreen';
      if (document.body.classList.toggle(cls)) document.body.classList.remove(other);
      root.querySelector('[data-act="fullscreen"]')?.classList.toggle('on', document.body.classList.contains('hb-fullscreen'));
      root.querySelector('[data-act="hidepanel"]')?.classList.toggle('on', document.body.classList.contains('hb-hidepanel'));
      return;
    }
    if (act === 'close') { if (B.data.inHangar) sendCmdSilent(B.data.exitDir || 'out'); else { closeHangarBay(); sendCmdSilent('look'); } return; }
    if (act === 'back') { go('floor'); return; }
    if (act === 'buyrent') { go('buyrent'); return; }
    const idOf = () => e.currentTarget.getAttribute('data-id') || B.selId;
    if (act === 'bench') {
      const id = idOf(), c = (B.data.craft || []).find(x => x.id === id); if (!c) return;
      if (B.selId !== id) { B.orbit = null; B.benchTab = null; }
      B.selId = id; B.work = { ...c.livery }; B.tune = null; B.tuneFor = null; B.kitSel = null; go('bench'); return;
    }
    if (act === 'charter') {
      // Unrated pilots can't fly anything yet: the charter card is the way to the checkride. Booked for
      // you, it boards; otherwise a pilot on duty opens the booking dialog.
      if (!B.data.licensed && !B.data.isAdmin && B.data.venue !== 'helipad') { sendCmdSilent('checkride'); closeHangarBay(); return; }
      if (B.data.charterWaiting) { sendCmdSilent('embark'); closeHangarBay(); }
      else if (B.data.pilot?.present) sendCmdSilent('charterinfo');
      return;
    }
    if (act === 'inspect') { B.inspect = B.inspect || inspectDefault(); go('inspect'); return; }
    if (act === 'inspect-reset') { const m = B.inspect?.mode; B.inspect = inspectDefault(); if (m) B.inspect.mode = m; inspectKeys.clear(); return; }
    if (act === 'inspect-mode') { if (B.inspect) B.inspect.mode = B.inspect.mode === 'walk' ? 'orbit' : 'walk'; inspectKeys.clear(); render(); return; }
    if (act === 'checkride') { sendCmdSilent('checkride'); closeHangarBay(); return; }
    if (act === 'charter-any') { charterAny = !charterAny; render(); return; }
    if (act === 'embark') { sendCmdSilent(`embark ${e.currentTarget.getAttribute('data-tail')}`); closeHangarBay(); return; }
    if (act === 'store') { sendCmdSilent(`hangaract store ${idOf()}`); return; }
    if (act === 'pull') { sendCmdSilent(`hangaract pull ${idOf()}`); return; }
    if (act === 'refuel') { sendCmdSilent(`refuel ${idOf()}`); refetch(); return; }
    if (act === 'repair') { sendCmdSilent(`repair ${B.selId}`); refetch(); return; }
    if (act === 'repair-pro') { sendCmdSilent(`repair ${B.selId} hangar`); refetch(); return; }
    // Pours ONE container and refetches — the can list and the gauge both move, and the server's
    // reply is the authority on whether the pour actually happened.
    if (act === 'loadhopper') { sendCmdSilent(`loadhopper ${B.selId} ${e.currentTarget.getAttribute('data-can')}`); refetch(); return; }
    if (act === 'tune-apply') {
      const t = B.tune || {}; const f = (v) => (v || 0).toFixed(2);
      sendCmdSilent(`tuneset ${B.selId} ${f(t.mixture)} ${f(t.pitch)} ${f(t.boost)} ${f(t.cg)}`);
      // Drop the working copy so the server's re-push reseeds it from the committed tune.
      B.tune = null; B.tuneFor = null;
      return;
    }
    if (act === 'tune-reset') { B.tune = { mixture: 0, pitch: 0, boost: 0, cg: 0 }; paintTuning(); return; }
    if (act === 'sell') {
      const c = (B.data.craft || []).find(x => x.id === idOf());
      if (c) showConfirmDialog({ title: 'Sell Aircraft', hold: true, prompt: `Sell the ${c.tail} outright? This deletes her, can't be undone.`, command: `sell ${c.id}`, confirmLabel: 'Sell' });
      return;
    }
    if (act === 'cancel_rental') {
      const c = (B.data.craft || []).find(x => x.id === idOf());
      if (c) showConfirmDialog({ title: 'Cancel Rental', hold: true, prompt: `Hand back the ${c.tail}? This deletes the rental, can't be undone.`, command: `cancelrental ${c.id}`, confirmLabel: 'Return' });
      return;
    }
    if (act === 'paint-apply') { const c = (B.data.craft || []).find(x => x.id === B.selId); if (c) sendCmdSilent(`paintset ${c.id} ${B.work.base} ${B.work.trim} ${B.work.pattern} ${B.work.finish} ${B.work.cabin} ${B.work.uphol} ${B.work.decal || 'none'} ${B.work.accent || '#c22b8c'} ${B.work.ground || '#eee7d6'} ${B.work.variant || 'stock'} ${B.work.itrim || 'stock'} ${(B.work.plate || '').trim().replace(/ +/g, '_') || '-'} ${Object.entries(B.work.parts || {}).map(([k, v]) => k + ':' + v).join(',') || '-'}`); return; }
    if (act === 'stage-mode') { B.boothPick = !boothOn(); render(); return; }
    if (act === 'parts-clear') { B.work.parts = {}; render(); return; }
    if (act === 'paint-revert') { const c = (B.data.craft || []).find(x => x.id === B.selId); if (c) { B.work = { ...c.livery }; render(); } return; }
    if (act === 'scheme-save') { const n = (document.getElementById('hb-scheme-name')?.value || '').trim(); if (n) sendCmdSilent(`scheme ${B.selId} save ${n}`); return; }
  });
  on('[data-cp]', 'click', (e) => { e.stopPropagation(); openColorPopover(e.currentTarget.getAttribute('data-cp'), e.currentTarget); });
  on('[data-plate-field]', 'input', (e) => {
    const chars = B.data?.catalog?.plateChars || 'ABCDEFGHIKLMNOPQRSTUVW ';
    const el = e.currentTarget, v = [...el.value.toUpperCase()].filter(ch => chars.includes(ch)).join('');
    if (v !== el.value) el.value = v;
    B.work.plate = v;
  });
  on('[data-sel-field]', 'change', (e) => { B.work[e.currentTarget.getAttribute('data-sel-field')] = e.currentTarget.value; render(); });
  // A factory edition is the mesh file's own paint, so it shows bare (no pattern over it) and drops
  // any per-part colours; the cabin follows it when the model has a cabin of that name.
  on('[data-variant]', 'click', (e) => {
    const v = e.currentTarget.getAttribute('data-variant');
    const cab = ((B.data.catalog?.cabinTrims || {})[curCraft()?.class] || []).some(t => t.id === v);
    B.work = { ...B.work, variant: v, pattern: 'bare', parts: {}, ...(cab ? { itrim: v } : {}) }; render();
  });
  on('[data-part-reset]', 'click', (e) => { const k = e.currentTarget.getAttribute('data-part-reset'); const p = { ...(B.work.parts || {}) }; delete p[k]; B.work.parts = p; render(); });
  const selCard = () => (B.data.craft || []).find(x => x.id === B.selId);
  on('[data-set]', 'click', (e) => {
    const st = (selCard()?.sets || []).find(x => x.id === e.currentTarget.getAttribute('data-set'));
    if (st) { B.work = { ...B.work, parts: {}, ...st.look }; render(); }
  });
  on('[data-scheme-load]', 'click', (e) => {
    const sc = (selCard()?.schemes || []).find(x => x.name === e.currentTarget.getAttribute('data-scheme-load'));
    if (sc) { B.work = { ...B.work, parts: {}, ...(sc.look || sc) }; delete B.work.name; delete B.work.look; render(); }
  });
  on('[data-scheme-del]', 'click', (e) => sendCmdSilent(`scheme ${B.selId} delete ${e.currentTarget.getAttribute('data-scheme-del')}`));
  on('[data-knob]', 'pointerdown', startKnobDrag);
  on('[data-kit]', 'click', (e) => sendCmdSilent(`installkit ${B.selId} ${e.currentTarget.getAttribute('data-kit')}`));
  on('[data-kit-pick]', 'click', (e) => { B.kitSel = e.currentTarget.getAttribute('data-kit-pick'); render(); });
  on('[data-loadout]', 'click', (e) => { sendCmdSilent(`loadout ${B.selId} ${e.currentTarget.getAttribute('data-loadout')}`); refetch(); });
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
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    yaw += dt * 0.55;
    last = t;

    // Weather audio + the lightning schedule for the walk-inspect bay-door diorama. Driven every
    // frame (active only in walk mode) so the ambient bed fades out when you leave the walk view;
    // the returned fx (flash/bolt/motion) rides through into the door renderer via the sky object.
    const walkActive = !!(B && ((B.screen === 'inspect' && (B.inspect?.mode || 'walk') === 'walk') || B.screen === 'bench'));
    const skyFx = updateHangarAmbience(B?.data?.sky, walkActive);

    // The maintenance stage: the selected craft where she stands (hangar, ramp or pad), on an
    // orbiting eye — it drifts round her on its own until you take hold of it.
    const stage3d = root.querySelector('#hb-stage3d');
    const sc = stage3d && (B.data.craft || []).find(x => x.id === B.selId);
    if (stage3d && sc) {
      const r = stage3d.getBoundingClientRect();
      if (!stage3d._cw || Math.abs(r.width - stage3d._cw) > 0.5 || Math.abs(r.height - stage3d._ch) > 0.5) sizeCanvas(stage3d);
      const ctx = stage3d.getContext('2d');
      if (ctx && stage3d._cw) {
        const o = B.orbit || (B.orbit = { a: 0.75, r: 1, h: 0.35 });
        if (!o.held) o.a += dt * 0.12;
        const armed = sc.class === 'heli' && sc.hardpoints > 0;
        const R = Math.min(5.6, (1.9 + 1.05 * (MODEL_SCALE[sc.class] || 1) * (armed ? 1.8 : 1)) * o.r);
        const x = Math.cos(o.a) * R, y = Math.sin(o.a) * R, z = 0.05 + o.h * 1.6;
        const cam = { x, y, z, yaw: Math.atan2(-y, -x), pitch: -Math.atan2(z - 0.05, R) * 0.9, fov: 1 };
        ctx.setTransform(stage3d._dpr, 0, 0, stage3d._dpr, 0, 0);
        if (boothOn()) {
          const armedZ = armed ? 0.55 : 1;
          drawPaintBooth(ctx, { cls: sc.class, armed, wreck: !!sc.wreck, variant: liveVariant(B.work), livery: B.work || sc.livery,
            w: stage3d._cw, h: stage3d._ch, time: t / 1000, yaw: -o.a * 2, zoom: 1.45 * armedZ, fit: 1.4 });
        } else drawHangarFloorBay(ctx, { cls: sc.class, armed, wreck: !!sc.wreck, variant: liveVariant(B.work), livery: B.work || sc.livery,
          w: stage3d._cw, h: stage3d._ch, sky: { ...(B.data?.sky || {}), fx: skyFx }, floor: true, floor3d: true,
          venue: stageVenue(sc), cam });
      }
    }

    // The booth's cockpit view, when it is up and GLASS can draw it.
    const seatCv = root.querySelector('#' + SEAT_ID);
    const seatCraft = seatCv && seatOn() && curCraft();
    if (seatCraft && seatDrawable()) { paintWindshield(SEAT_ID, seatView(seatCraft, t / 1000)); seatLive = true; }

    // Walkaround inspect — one craft on the player-driven camera (B.inspect): a free WASD
    // walk camera or the orbit turntable.
    const inspect = root.querySelector('#hb-inspect');
    if (inspect && B.inspect) {
      // WALK: WASD/QE (desktop) + the virtual thumbstick/pads (touch) drive the eye each frame
      // (dt-scaled), on the ground plane relative to where you're facing; clamped to a box.
      if (B.inspect.mode === 'walk') {
        const mv = B.inspect.moveVec || { f: 0, r: 0, u: 0 };
        let mf = mv.f, mr = mv.r, mu = mv.u;
        if (inspectKeys.has('w')) mf += 1; if (inspectKeys.has('s')) mf -= 1;
        if (inspectKeys.has('d')) mr += 1; if (inspectKeys.has('a')) mr -= 1;
        if (inspectKeys.has('e')) mu += 1; if (inspectKeys.has('q')) mu -= 1;   // Space no longer climbs — it hops (below)
        const cam = B.inspect.cam;
        if (mf || mr || mu) {
          const spd = 1.4 * dt, cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw);
          mf = Math.max(-1, Math.min(1, mf)); mr = Math.max(-1, Math.min(1, mr));
          cam.x = Math.max(-6, Math.min(6, cam.x + (mf * cyw + mr * -syw) * spd));   // forward=(cyw,syw), right=(-syw,cyw)
          cam.y = Math.max(-6, Math.min(6, cam.y + (mf * syw + mr * cyw) * spd));
          cam.z = Math.max(-0.12, Math.min(2.4, cam.z + mu * spd));
          // Collision: you can't walk INTO the plane. An exclusion ellipse in the ground plane
          // around the fuselage/wing-root core (nose↔tail is the long axis); if the eye is below
          // the airframe it gets pushed radially back out to the hull, so you slide along her side.
          const AF = 1.4, AG = 0.75;
          if (cam.z < 0.45) { const d = Math.hypot(cam.x / AF, cam.y / AG); if (d > 1e-3 && d < 1) { cam.x /= d; cam.y /= d; } }
        }
        // Hop physics: a transient vertical offset that arcs up on Space and falls back under gravity.
        const hop = B.inspect.hop || (B.inspect.hop = { off: 0, vel: 0 });
        if (hop.vel !== 0 || hop.off > 1e-4) { hop.vel -= 7.0 * dt; hop.off += hop.vel * dt; if (hop.off <= 0) { hop.off = 0; hop.vel = 0; } }
      }
      const r = inspect.getBoundingClientRect();
      if (!inspect._cw || Math.abs(r.width - inspect._cw) > 0.5 || Math.abs(r.height - inspect._ch) > 0.5) sizeCanvas(inspect);
      const ctx = inspect.getContext('2d');
      const c = (B.data.craft || []).find(x => x.id === B.selId);
      if (ctx && inspect._cw && c) {
        ctx.setTransform(inspect._dpr, 0, 0, inspect._dpr, 0, 0);
        const opts = { cls: c.class, armed: c.class === 'heli' && (c.hardpoints > 0), variant: liveVariant(c.livery), wreck: !!c.wreck, livery: c.livery, w: inspect._cw, h: inspect._ch, sky: { ...(B.data?.sky || {}), fx: skyFx }, floor: true, floor3d: true, venue: stageVenue(c) };
        if (B.inspect.mode === 'walk') opts.cam = { ...B.inspect.cam, z: B.inspect.cam.z + (B.inspect.hop?.off || 0) };   // layer the hop bob onto the eye
        else { opts.yaw = B.inspect.yaw; opts.elev = B.inspect.elev; opts.zoom = B.inspect.zoom; }
        drawHangarFloorBay(ctx, opts);
        // First-person embark: light the BOARD prompt when you've walked up to the cockpit.
        if (B.inspect.mode === 'walk' && !c.wreck) {
          const cam = B.inspect.cam, near = Math.hypot(cam.x - 0.35, cam.y, cam.z - 0.08) < 1.9;
          root.querySelector('#hb-board')?.classList.toggle('near', near);
        }
      }
    }
    // Dealer lot cards — true-3D wireframe schematics, each spun at its own
    // phase offset (like the `.hb-bay` turntables) so a row of them doesn't
    // rotate in lockstep. Fixed-size canvases (no dpr scaling needed).
    const wfLots = root.querySelectorAll('canvas.hb-wf-lot');
    if (wfLots.length) {
      balanceLotGrid(root.querySelector('.hb-lotgrid'), wfLots.length);   // even rows — never a lonely card on the bottom
      const accent = themeColor('--accent', '#39ff9e');   // one getComputedStyle for the whole row, not per-card
      wfLots.forEach((cv) => {
        if (cv._phase == null) cv._phase = Math.random() * 6.28;
        drawWireframe3D(cv.getContext('2d'), { cls: cv.getAttribute('data-wf-cls'), armed: cv.getAttribute('data-wf-armed') === '1', w: cv.width, h: cv.height, accent, yaw: yaw + cv._phase });
      });
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
// Balance the dealer showroom rows so the last row is never a single lonely card. The cards are
// fixed-width flex items (they wrap at the container width), so we cap the grid's width to a
// COLUMN COUNT chosen to avoid a remainder of exactly 1 — e.g. 7 planes render 4+3 / 5+2, not
// 6+1. Re-run each frame (cheap; only writes when the value changes) so it tracks pane resizes.
function balanceLotGrid(grid, n) {
  if (!grid || !n) return;
  const avail = (grid.parentElement?.clientWidth || grid.clientWidth || 0);
  if (!avail) return;
  const CARD = 236, GAP = 14;
  const fit = Math.max(1, Math.floor((avail + GAP) / (CARD + GAP)));   // cards that physically fit across
  let cols = Math.min(fit, n);
  if (cols > 2 && n % cols === 1) {                                    // a lonely last row — step down to an even split if one exists
    let c = cols; while (c > 2 && n % c === 1) c--;
    if (n % c !== 1) cols = c;
  }
  const px = (cols * CARD + (cols - 1) * GAP) + 'px';
  if (grid.style.maxWidth !== px) {
    grid.style.maxWidth = px;
    grid.style.marginLeft = grid.style.marginRight = 'auto';   // centre the capped grid in the scroll region
  }
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
  /* The hangar fills its pane exactly (flex column), so the pane itself never
     scrolls the whole tablet — only .hb-body (the middle) does, between the two
     pinned bars. Without the pane's overflow:hidden a tall body would spill past
     the 65% cap and #area-pane's own scrollbar would drag the bars out of view. */
  #area-pane:has(#hb-root) { overflow:hidden; }
  #area-content:has(#hb-root) { height:100%; min-height:0; display:flex; flex-direction:column; }
  /* The shell — a moulded chassis (not a flat panel): a top sheen, a deep outer
     shadow, and a subtle edge highlight, the same "real object" cues the ATM's
     own #atm-box uses. Tinted off the theme's own bg/border palette (not a fixed
     blue-grey) so the casing itself follows whatever theme is active — only the
     CRT tubes' phosphor glow (green/cyan/yellow above) stays dark glass regardless
     of theme, the same way a real screen doesn't relight for your desktop wallpaper. */
  #hb-root { position:relative; display:flex; flex-direction:column; flex:1 1 auto; min-height:0; color:var(--text-bright, #dcecf8);
    font-family:'Courier New',monospace;
    background:linear-gradient(175deg,color-mix(in srgb, var(--border) 55%, var(--bg3)) 0%,var(--bg3) 8%,var(--bg2) 50%),
      radial-gradient(140% 100% at 50% 0%,color-mix(in srgb, var(--border) 40%, var(--bg3)),var(--bg) 75%);
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, var(--border)); border-radius:10px; overflow:hidden;
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(0,0,0,0.3), 0 14px 34px rgba(0,0,0,0.5); }
  /* A faint brushed-plastic grain over the shell — two crossed diagonal hairline
     sets at very low opacity, purely decorative (z-index:0, sits under every
     real screen/panel which are all z-index:1+). */
  #hb-root::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none; border-radius:inherit;
    background-image:
      repeating-linear-gradient(35deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px),
      repeating-linear-gradient(-55deg, rgba(0,0,0,0.03) 0 1px, transparent 1px 4px); }
  #hb-root > * { position:relative; z-index:1; }
  /* Every surface is the SAME hue (the theme's accent) at a different intensity over
     the theme's own bg tiers — so the whole hangar app follows the active theme (a
     light theme reads light) and reads as "this machine's colour" rather than a fixed
     dark chassis with an accent painted on top. Only the 3D scene and the recessed
     schematic/map viewports stay dark glass regardless of theme (a real screen doesn't
     relight for your wallpaper). */
  #hb-root { --hb-atm-accent:var(--accent);
    /* Theme-following bench surfaces, sharing the Architect OS tablet's exact recipe
       (tablet-os.js --tos-surface-hi/lo): an accent tint over the theme's own bg tiers
       plus translucent bevels that read on a light or a dark theme alike, so the bench
       and the tablet are literally the same surface. --tos-* aliases below let the
       reworked bench markup use the tablet's own token names directly. */
    --hb-surf:color-mix(in srgb, var(--hb-atm-accent) 18%, var(--bg2));
    --hb-surf-lo:color-mix(in srgb, var(--hb-atm-accent) 6%, var(--bg2));
    --hb-surf-mid:color-mix(in srgb, var(--hb-atm-accent) 12%, var(--bg2));
    --hb-bevel-hi:rgba(255,255,255,0.5); --hb-bevel-lo:rgba(0,0,0,0.45);
    --tos-surface-hi:var(--hb-surf); --tos-surface-lo:var(--hb-surf-lo); --tos-surface:var(--hb-surf-mid);
    --tos-bevel-hi:var(--hb-bevel-hi); --tos-bevel-lo:var(--hb-bevel-lo);
    --tos-fg:var(--text-bright, var(--text, #eafffb));
    --tos-fg-dim:var(--text-dim, #9db5c6);
    --tos-fg-dim2:color-mix(in srgb, var(--text-dim, #9db5c6) 60%, transparent); }
  /* Top status bar + bottom action tray are flat, frosted tablet chrome that follows
     the theme (a light theme reads light): a slim accent-tinted glass slab with a
     hairline edge; backdrop-filter blurs whatever scrolls behind it, the "glass over
     content" cue a tablet's bars give. Backgrounds are semi-transparent so the blur reads. */
  #hb-root .hb-head, #hb-root .hb-toolbar { position:relative;
    -webkit-backdrop-filter:blur(11px) saturate(1.15); backdrop-filter:blur(11px) saturate(1.15); }
  #hb-root .hb-head { display:flex; align-items:center; gap:12px; padding:0 16px; height:48px; flex:0 0 auto;
    background:color-mix(in srgb, var(--hb-surf) 82%, transparent);
    border-bottom:1px solid color-mix(in srgb, var(--hb-atm-accent) 26%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 2px 8px rgba(0,0,0,0.14); }
  #hb-root .hb-title { color:var(--tos-fg); font-weight:bold; letter-spacing:2px; text-shadow:0 0 6px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  /* Credits/price numbers read as the theme's brightest ink so they stay legible on
     a light or dark bar alike, with a faint accent glow for emphasis. */
  #hb-root .hb-credits { margin-left:auto; color:var(--tos-fg); letter-spacing:1px; text-shadow:0 0 5px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  #hb-root .hb-back { font-family:inherit; font-size:11px; letter-spacing:1px; cursor:pointer; padding:6px 12px; color:var(--tos-fg);
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo)); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); border-radius:6px;
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi); transition:filter .12s, box-shadow .12s, border-color .12s; }
  #hb-root .hb-back:hover { filter:brightness(1.12); border-color:var(--hb-atm-accent); box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 0 10px color-mix(in srgb, var(--hb-atm-accent) 28%, transparent); }
  /* Fullscreen / hide-panel toggles — a small glyph pair pinned to the right of the head,
     matching the sim's ⛶/⊟. The lit ('on') state carries the accent glow so an active
     toggle reads as "engaged". */
  #hb-root .hb-viewbtns { display:flex; gap:6px; margin-left:10px; }
  #hb-root .hb-viewbtn { font-family:inherit; font-size:14px; line-height:1; cursor:pointer; padding:5px 8px; color:var(--tos-fg-dim);
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 28%, transparent); border-radius:6px;
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi); transition:filter .12s, box-shadow .12s, color .12s, border-color .12s; }
  #hb-root .hb-viewbtn:hover { filter:brightness(1.1); color:var(--tos-fg); border-color:var(--hb-atm-accent); box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 0 10px color-mix(in srgb, var(--hb-atm-accent) 28%, transparent); }
  #hb-root .hb-viewbtn.on { color:var(--tos-fg); border-color:var(--hb-atm-accent);
    background:linear-gradient(165deg, color-mix(in srgb, var(--hb-atm-accent) 26%, var(--bg2)), var(--hb-surf-lo));
    box-shadow:0 0 10px color-mix(in srgb, var(--hb-atm-accent) 32%, transparent), inset 0 1px 0 var(--hb-bevel-hi); }
  #hb-root .hb-body { flex:1 1 auto; overflow:hidden; padding:10px 14px; min-height:0; display:flex; flex-direction:column; }
  #hb-root .hb-dim { color:var(--tos-fg-dim); }
  #hb-root .hb-empty { color:var(--tos-fg); font-size:13px; text-align:center; padding:24px 10px; }
  #hb-root .hb-note { color:var(--tos-fg-dim); font-size:12px; padding:8px 0; }
  #hb-root .hb-hint { color:var(--tos-fg-dim); font-size:11px; text-align:center; padding:8px 0; }

  /* Floor — one 3D scene canvas, not a row of cards */
  #hb-root .hb-floor { position:relative; flex:1 1 auto; display:flex; min-height:280px; }
  #hb-root .hb-scene { width:100%; height:100%; min-height:280px; display:block; border-radius:8px; cursor:pointer; }
  #hb-root .hb-inspect { cursor:grab; touch-action:none; outline:none; }
  #hb-root .hb-inspect:active { cursor:grabbing; }
  #hb-root .hb-inspect-name { position:absolute; left:12px; top:10px; z-index:2; font-size:13px; font-weight:bold; letter-spacing:1px; color:var(--text-bright,#eafffb); text-shadow:0 1px 3px rgba(0,0,0,0.8); pointer-events:none; }
  #hb-root .hb-inspect-name span { font-size:10px; font-weight:normal; color:var(--hb-atm-accent); margin-left:6px; letter-spacing:0.5px; }
  #hb-root .hb-inspect-hint { position:absolute; right:12px; bottom:10px; z-index:2; font-size:9px; letter-spacing:1px; color:#9db5c6; background:rgba(6,12,18,0.6); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); border-radius:4px; padding:3px 7px; pointer-events:none; }
  /* Touch controls — hidden on a mouse (fine pointer), shown on phones/tablets (coarse). */
  #hb-root .hb-walk-pad, #hb-root .hb-walk-vert { display:none; }
  @media (pointer: coarse) { #hb-root .hb-walk-pad, #hb-root .hb-walk-vert { display:flex; } }
  #hb-root .hb-walk-pad { position:absolute; left:16px; bottom:16px; z-index:4; }
  #hb-root .hb-walk-stick { position:relative; width:104px; height:104px; border-radius:50%; touch-action:none;
    background:radial-gradient(circle at 50% 40%, rgba(30,44,56,0.5), rgba(6,12,18,0.5)); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); box-shadow:inset 0 0 14px rgba(0,0,0,0.5); }
  #hb-root .hb-walk-knob { position:absolute; left:50%; top:50%; width:46px; height:46px; margin:0; transform:translate(-50%,-50%); border-radius:50%;
    background:linear-gradient(180deg, color-mix(in srgb, var(--hb-atm-accent) 40%, #0e1620), color-mix(in srgb, var(--hb-atm-accent) 12%, #060c12)); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 55%, transparent); box-shadow:0 2px 6px rgba(0,0,0,0.5); }
  #hb-root .hb-walk-vert { position:absolute; right:16px; bottom:16px; z-index:4; flex-direction:column; gap:10px; }
  #hb-root .hb-walk-btn { width:48px; height:48px; font-size:16px; color:var(--hb-atm-accent); cursor:pointer; touch-action:none;
    background:rgba(6,12,18,0.5); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); border-radius:10px; }
  #hb-root .hb-walk-btn:active { background:color-mix(in srgb, var(--hb-atm-accent) 22%, rgba(6,12,18,0.5)); }
  /* First-person BOARD prompt — hidden until you're up close (.near), then it pulses. */
  #hb-root .hb-board { position:absolute; left:50%; top:44%; transform:translate(-50%,-50%) scale(0.9); z-index:5;
    font:bold 13px/1 monospace; letter-spacing:2px; color:#eafffb; cursor:pointer; padding:9px 16px; border-radius:8px; opacity:0; pointer-events:none;
    background:color-mix(in srgb, var(--hb-atm-accent) 30%, rgba(6,12,18,0.7)); border:1px solid var(--hb-atm-accent);
    box-shadow:0 0 16px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); transition:opacity .18s, transform .18s; text-shadow:0 0 6px color-mix(in srgb, var(--hb-atm-accent) 55%, transparent); }
  #hb-root .hb-board.near { opacity:1; pointer-events:auto; transform:translate(-50%,-50%) scale(1); animation:hbBoardPulse 1.4s ease-in-out infinite; }
  @keyframes hbBoardPulse { 0%,100% { box-shadow:0 0 14px color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); } 50% { box-shadow:0 0 22px color-mix(in srgb, var(--hb-atm-accent) 70%, transparent); } }
  #hb-root .hb-bay { display:block; border-radius:6px; }

  /* The selected-craft readout is a "panel on the floor scene" (not the 3D scene
     itself, which stays untouched) — the tablet summary-strip surface, matching the
     bench's identity strip so the whole hangar app reads as one device.
     flex-shrink:0 matters: .hb-floor is flex:1 1 auto and will happily eat all the
     room in a short area-pane; never shrinking below this box's natural height means
     the BODY scrolls instead of its content getting squeezed away. */
  #hb-root .hb-info { flex-shrink:0; margin-top:10px; padding:10px 12px; border-radius:8px;
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 2px 5px rgba(0,0,0,0.2); }
  #hb-root .hb-info-name { color:var(--tos-fg); font-weight:bold; font-size:14px; }
  #hb-root .hb-info-type { color:var(--tos-fg-dim); font-weight:normal; font-size:11px; margin-left:6px; }
  #hb-root .hb-bars { display:inline-grid; grid-template-columns:auto 140px; gap:5px 8px; align-items:center; font-size:9px; letter-spacing:1px; color:var(--tos-fg-dim); margin-top:8px; }
  #hb-root .hb-bar { height:7px; background:var(--hb-surf-lo); border-radius:4px; overflow:hidden; box-shadow:inset 0 1px 2px var(--hb-bevel-lo), inset 0 0 0 1px var(--border); } #hb-root .hb-bar i { display:block; height:100%; }
  #hb-root .hb-badge { font-size:8px; letter-spacing:1px; padding:1px 5px; border-radius:3px; margin-left:6px; vertical-align:middle; }
  #hb-root .hb-b-ramp { background:#2a5f8a; color:#bfe4ff; } #hb-root .hb-b-bay { background:#2a7a52; color:#b8f2cf; }
  #hb-root .hb-b-rent { background:#7a6a1e; color:#f2e0a0; } #hb-root .hb-b-wreck { background:#7a3a2a; color:#f2b8a0; }

  /* Tactile 3D chip — borrows the Architect OS tablet's bevel language
     (client/game/js/panels/tablet-os.js .tos-btn): a raised accent-tinted cap
     with a bright top highlight + dark bottom bevel that PRESSES IN to a deep
     inset recess on :active, so every press feels like a physical key. Icon +
     label sit side by side. Used everywhere in the hangar (toolbar, bench,
     charter) so the whole console reads as one device. */
  #hb-root .hb-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px;
    font-family:inherit; font-size:11px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; cursor:pointer; padding:9px 15px; border-radius:9px;
    color:var(--tos-fg); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 38%, transparent);
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 4px var(--hb-bevel-lo), 0 2px 4px rgba(0,0,0,0.25);
    transition:filter .12s, box-shadow .12s, transform .05s, border-color .12s; }
  #hb-root .hb-btn:hover:not(:disabled) { filter:brightness(1.1); border-color:var(--hb-atm-accent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 4px var(--hb-bevel-lo), 0 3px 9px rgba(0,0,0,0.28), 0 0 14px color-mix(in srgb, var(--hb-atm-accent) 32%, transparent); }
  #hb-root .hb-btn:active:not(:disabled) { transform:translateY(1px); box-shadow:inset 0 2px 6px var(--hb-bevel-lo); }
  #hb-root .hb-btn:disabled { opacity:0.4; cursor:default; }
  #hb-root .hb-ico { font-size:14px; line-height:1; opacity:0.95; }
  /* Accent (Fly / Buy-Rent / Apply) — same chip on a stronger accent tint of the
     theme bg (not a solid accent fill) so it reads as the primary key while the
     high-contrast --tos-fg label stays legible on a light or dark theme alike. */
  #hb-root .hb-accent { border-color:var(--hb-atm-accent);
    background:linear-gradient(165deg, color-mix(in srgb, var(--hb-atm-accent) 32%, var(--bg2)), color-mix(in srgb, var(--hb-atm-accent) 15%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 4px var(--hb-bevel-lo), 0 2px 5px rgba(0,0,0,0.28), 0 0 14px color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); }
  #hb-root .hb-accent:active:not(:disabled) { transform:translateY(1px); box-shadow:inset 0 2px 6px var(--hb-bevel-lo); }

  /* Bottom action tray — the buttons' own separate area: a recessed well (deep
     inset shadow) sunk into the chassis, with the 3D chips sitting proud of it.
     Left group = context actions, right group (.hb-tb-right) is pushed to the
     far edge. position:sticky pins the whole tray to the bottom of the scrolling
     body so the controls never scroll out of reach. */
  #hb-root .hb-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; flex:0 0 auto; padding:12px 14px; margin-top:auto;
    position:sticky; bottom:0; z-index:5;
    background:color-mix(in srgb, var(--hb-surf-lo) 84%, transparent);
    border-top:1px solid color-mix(in srgb, var(--hb-atm-accent) 25%, transparent);
    box-shadow:inset 0 2px 8px var(--hb-bevel-lo), inset 0 1px 0 var(--hb-bevel-hi), 0 -2px 10px rgba(0,0,0,0.14); }
  #hb-root .hb-tb-group { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  #hb-root .hb-tb-right { margin-left:auto; }

  /* Charter — a tablet-surface card (shared with the rest of the hangar app); the
     destination map sits in a recessed dark viewport so the tinted tiles read on any
     theme, the way the dealer's schematic viewport does. */
  #hb-root .hb-charter-crt { position:relative; padding:12px; border-radius:12px;
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 3px 12px rgba(0,0,0,0.22); }
  #hb-root .hb-charter-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
  /* Credits readout is fixed near-white for the dark head bar; on the light-following
     charter card use the theme foreground instead. */
  #hb-root .hb-charter-head .hb-credits { color:var(--tos-fg); text-shadow:none; }
  #hb-root .hb-charter-pilot { font-weight:bold; letter-spacing:1px; }
  #hb-root .hb-charter-map { display:grid; gap:2px; margin:6px auto; overflow:auto; max-height:340px; padding:8px; border-radius:9px;
    background:radial-gradient(120% 120% at 50% 30%, color-mix(in srgb, var(--hb-atm-accent) 13%, var(--bg)), color-mix(in srgb, var(--hb-atm-accent) 7%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 20%, transparent);
    box-shadow:inset 0 2px 10px rgba(0,0,0,0.4);
    scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
  #hb-root .hb-charter-map::-webkit-scrollbar { width:6px; height:6px; }
  #hb-root .hb-charter-map::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
  #hb-root .hb-tile { width:20px; height:20px; display:flex; align-items:center; justify-content:center; position:relative; font-size:11px; border-radius:3px; }
  #hb-root .hb-tile-dim { background:color-mix(in srgb, var(--hb-atm-accent) 9%, var(--bg2)); color:var(--tos-fg-dim); }
  #hb-root .hb-tile-here { background:color-mix(in srgb, #8f6fe0 55%, #1a1030); color:#e6d6ff; box-shadow:inset 0 0 0 1px #b79dff; }
  #hb-root .hb-tile-dest { background:color-mix(in srgb, var(--hb-atm-accent) 55%, var(--bg2)); color:var(--text-bright, #eafffb); cursor:pointer; }
  #hb-root .hb-tile-dest:hover { background:color-mix(in srgb, var(--hb-atm-accent) 72%, var(--bg2)); box-shadow:0 0 0 1px var(--hb-atm-accent); }
  #hb-root .hb-tile-airfield { background:color-mix(in srgb, #d9b53a 42%, #1a1408); color:#f5e6a8; }
  #hb-root .hb-tile-airfield:hover { box-shadow:0 0 0 1px #f0d060; }
  #hb-root .hb-tile-fare { position:absolute; bottom:-11px; left:50%; transform:translateX(-50%); font-size:7px; color:var(--yellow); white-space:nowrap; }
  #hb-root .hb-charter-legend { display:flex; gap:16px; font-size:10px; color:var(--tos-fg-dim); margin:14px 0 4px; flex-wrap:wrap; }
  #hb-root .hb-swatch { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:4px; vertical-align:middle; }
  #hb-root .hb-sw-air { background:color-mix(in srgb, #d9b53a 55%, #1a1408); } #hb-root .hb-sw-any { background:color-mix(in srgb, var(--hb-atm-accent) 55%, #0c1a14); }

  /* Buy/Rent — a dealer showroom in the tablet surface language (no CRT tube): a
     plain scroll region of product cards, each an accent-tinted raised surface with
     the wireframe schematic seated in a recessed dark viewport so it reads on any
     theme. */
  #hb-root .hb-dealer { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding:2px;
    scrollbar-width:thin; scrollbar-color:var(--border) var(--bg2); }
  #hb-root .hb-scroll { overflow-y:auto; flex:1 1 auto; min-height:0; }
  #hb-root .hb-scroll::-webkit-scrollbar { width:6px; }
  #hb-root .hb-scroll::-webkit-scrollbar-track { background:var(--bg2); }
  #hb-root .hb-scroll::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
  #hb-root .hb-section { font-size:9px; letter-spacing:3px; color:var(--tos-fg-dim); margin:12px 0 6px; border-bottom:1px solid color-mix(in srgb, var(--hb-atm-accent) 25%, transparent); padding-bottom:3px; }
  #hb-root .hb-lotgrid { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; }
  #hb-root .hb-lot { width:236px; padding:11px; border-radius:12px; font-family:inherit; color:var(--tos-fg);
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 3px 10px rgba(0,0,0,0.22);
    transition:filter .12s, box-shadow .12s, border-color .12s, transform .05s; }
  #hb-root .hb-lot:hover { filter:brightness(1.05); border-color:var(--hb-atm-accent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 5px 16px rgba(0,0,0,0.28), 0 0 14px color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); }
  /* Recessed schematic viewport — a "screen" inset into the card for the accent-drawn
     wireframe. Theme-following: an accent tint over the deepest bg tier, so it reads as
     a dark screen on a dark theme and a tinted-light screen on a light one (never a
     hardcoded black slab), with the inset shadow carrying the recessed cue. */
  #hb-root .hb-lot-view { display:flex; justify-content:center; padding:6px; margin-bottom:6px; border-radius:9px;
    background:radial-gradient(120% 120% at 50% 40%, color-mix(in srgb, var(--hb-atm-accent) 15%, var(--bg)), color-mix(in srgb, var(--hb-atm-accent) 8%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, transparent);
    box-shadow:inset 0 2px 9px rgba(0,0,0,0.4); }
  #hb-root .hb-lot-art { display:flex; justify-content:center; }
  #hb-root .hb-lot-name { color:var(--tos-fg); font-weight:bold; letter-spacing:1px; text-align:center; margin-top:4px; font-size:13px; }
  #hb-root .hb-lot-meta { color:var(--tos-fg-dim); font-size:10px; text-align:center; margin:2px 0 8px; }
  #hb-root .hb-lot-price { text-align:center; letter-spacing:1px; color:var(--yellow); }
  #hb-root .hb-lot-acts { display:flex; gap:8px; }
  #hb-root .hb-lot-acq { flex:1; padding:8px 4px; border-radius:7px; font-family:inherit; font-size:11px; font-weight:bold; letter-spacing:0.5px; cursor:pointer;
    color:var(--tos-fg); background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 35%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 2px 4px rgba(0,0,0,0.25);
    transition:filter .12s, box-shadow .12s, transform .05s; }
  #hb-root .hb-lot-acq:hover:not(:disabled) { filter:brightness(1.12); border-color:var(--hb-atm-accent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 3px 8px rgba(0,0,0,0.3), 0 0 12px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  #hb-root .hb-lot-acq:active:not(:disabled) { transform:translateY(1px); box-shadow:inset 0 2px 6px rgba(0,0,0,0.6); }
  /* BUY is the primary key — the brighter accent-lit chip. */
  #hb-root .hb-lot-buy { border-color:var(--hb-atm-accent);
    background:linear-gradient(165deg, color-mix(in srgb, var(--hb-atm-accent) 32%, var(--bg2)), color-mix(in srgb, var(--hb-atm-accent) 15%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 4px var(--hb-bevel-lo), 0 2px 5px rgba(0,0,0,0.28), 0 0 12px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  #hb-root .hb-lot-acq:disabled { opacity:0.4; cursor:not-allowed; filter:grayscale(0.6); }
  #hb-root .hb-lot-lockmsg { color:#ffcf6b; font-size:11px; letter-spacing:0.5px; text-align:center; margin:4px 0 12px; text-shadow:0 0 6px rgba(255,180,60,0.3); }
  #hb-root .hb-wf-lot { display:block; margin:0 auto; max-width:100%; }

  /* Bench — reworked as a tablet-style app (see benchScreen). It obeys the player's
     background (a light theme reads light) and shares the tablet's --tos-* surface
     recipe, NOT the dealer's dark CRT tube. Layout: a sticky top bar (identity summary
     + segmented nav) over a two-column body — a sticky 3D/scope stage beside a single
     controls card.
     SCROLLING IS A LAST RESORT: the bench itself never scrolls — it's a fixed-height
     flex column that fills the pane. Sections are tabs (and paint has sub-tabs), so a
     tab's controls are meant to fit outright. Only .hb-bench-tabbody can scroll, and it
     wears the in-theme .hb-thin bar when it has to. */
  #hb-root .hb-bench { display:flex; flex-direction:column; gap:10px; flex:1 1 auto; min-height:0; overflow:hidden; }
  /* The one in-theme scrollbar recipe, used anywhere a last-resort scroll survives:
     an accent-lit thumb in a recessed track, never the OS default slab. */
  #hb-root .hb-thin { scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--hb-atm-accent) 55%, var(--border)) transparent; }
  #hb-root .hb-thin::-webkit-scrollbar { width:7px; height:7px; }
  #hb-root .hb-thin::-webkit-scrollbar-track { background:var(--hb-surf-lo); border-radius:4px; box-shadow:inset 0 0 3px var(--hb-bevel-lo); }
  #hb-root .hb-thin::-webkit-scrollbar-thumb { border-radius:4px;
    background:linear-gradient(180deg, color-mix(in srgb, var(--hb-atm-accent) 70%, var(--bg2)), color-mix(in srgb, var(--hb-atm-accent) 35%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi); }
  #hb-root .hb-thin::-webkit-scrollbar-thumb:hover { background:var(--hb-atm-accent); }
  /* Top bar — summary + nav together as one frosted chrome slab. */
  #hb-root .hb-bench-top { flex:0 0 auto; z-index:6; display:flex; flex-direction:column; gap:8px;
    padding-bottom:9px;
    border-bottom:1px solid color-mix(in srgb, var(--hb-atm-accent) 18%, transparent); }
  /* Persistent craft-identity strip (tablet .tos-summary recipe). */
  #hb-root .hb-bench-summary { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;
    padding:9px 12px; border-radius:8px;
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 2px 5px rgba(0,0,0,0.2); }
  #hb-root .hb-bench-id { display:flex; align-items:center; gap:9px; flex-wrap:wrap; min-width:0; }
  #hb-root .hb-bench-id b { font-size:14px; letter-spacing:0.5px; color:var(--tos-fg); }
  #hb-root .hb-bench-id span { font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim); }
  #hb-root .hb-bench-pill { font-size:9px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; padding:2px 8px; border-radius:11px; }
  #hb-root .hb-bench-pill-wreck { color:#f2b8a0; background:color-mix(in srgb, #e0552f 22%, transparent); border:1px solid color-mix(in srgb, #e0552f 45%, transparent); }
  #hb-root .hb-bench-pill-rent { color:#f2e0a0; background:color-mix(in srgb, #d9b53a 20%, transparent); border:1px solid color-mix(in srgb, #d9b53a 45%, transparent); }
  #hb-root .hb-bench-vitals { display:flex; gap:8px; flex-wrap:wrap; }
  #hb-root .hb-bench-vital { display:flex; flex-direction:column; align-items:flex-end; line-height:1.2; padding:3px 11px; border-radius:6px;
    background:var(--hb-surf-lo); border:1px solid var(--border); box-shadow:inset 0 1px 2px var(--hb-bevel-lo); }
  #hb-root .hb-bench-vital i { font-size:8px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); font-style:normal; }
  #hb-root .hb-bench-vital b { font-size:13px; font-weight:bold; color:var(--tos-fg); }
  #hb-root .hb-bench-warn { color:#ffb26b !important; }
  /* Hull condition as a lit meter under its number — the colour is set inline so it
     bleeds accent → amber → red with the airframe. */
  #hb-root .hb-bench-vital-hull { align-items:stretch; min-width:96px; }
  #hb-root .hb-bench-vital-hull i, #hb-root .hb-bench-vital-hull b { text-align:right; }
  #hb-root .hb-hullbar { display:block; height:4px; margin-top:3px; border-radius:3px; background:var(--hb-surf);
    box-shadow:inset 0 1px 2px var(--hb-bevel-lo), inset 0 0 0 1px var(--border); overflow:hidden; }
  #hb-root .hb-hullbar em { display:block; height:100%; border-radius:3px; box-shadow:0 0 7px currentColor; transition:width .25s ease-out; }
  /* Segmented nav — a joined pill bar; the active tab lifts out of the recessed track
     and lights a hairline bar along its bottom edge (the "you're here" cue). */
  #hb-root .hb-bench-tabs { display:flex; gap:4px; flex-wrap:wrap; padding:4px; border-radius:9px;
    background:var(--hb-surf-lo); border:1px solid var(--border); box-shadow:inset 0 1px 3px var(--hb-bevel-lo); }
  #hb-root .hb-tab { position:relative; flex:1 1 auto; display:flex; align-items:center; justify-content:center; gap:6px;
    font-family:inherit; font-size:11px; font-weight:bold; letter-spacing:1px; cursor:pointer;
    color:var(--tos-fg-dim); background:transparent; border:1px solid transparent; border-radius:6px; padding:7px 12px; overflow:hidden;
    transition:filter .12s, box-shadow .12s, color .12s, background .12s; }
  #hb-root .hb-tab-ico { font-size:12px; line-height:1; opacity:0.7; transition:opacity .12s, filter .12s; }
  #hb-root .hb-tab:hover { color:var(--tos-fg); background:color-mix(in srgb, var(--hb-atm-accent) 10%, transparent); }
  #hb-root .hb-tab:hover .hb-tab-ico { opacity:1; }
  #hb-root .hb-tab-active { color:var(--tos-fg); background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border-color:color-mix(in srgb, var(--hb-atm-accent) 40%, transparent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 1px 3px rgba(0,0,0,0.2); }
  #hb-root .hb-tab-active .hb-tab-ico { opacity:1; filter:drop-shadow(0 0 5px color-mix(in srgb, var(--hb-atm-accent) 70%, transparent)); }
  #hb-root .hb-tab-active::after { content:''; position:absolute; left:14%; right:14%; bottom:0; height:2px; border-radius:2px;
    background:var(--hb-atm-accent); box-shadow:0 0 8px var(--hb-atm-accent); animation:hbTabSlide .22s ease-out; }
  @keyframes hbTabSlide { from { left:48%; right:48%; opacity:0; } to { left:14%; right:14%; opacity:1; } }
  /* Two-column body — the stage beside the controls card, both filling the pane height
     so nothing has to scroll to be reached. */
  #hb-root .hb-bench-main { display:flex; gap:12px; align-items:stretch; flex:1 1 auto; min-height:0; }
  #hb-root .hb-bench-stage { flex:0 0 auto; display:flex; flex-direction:column; gap:6px; min-height:0; }
  /* The plane sits in a real bay: a recessed viewport with corner brackets, a faint
     deck grid behind it and a pool of accent light under the gear. */
  #hb-root .hb-stage-frame { position:relative; display:flex; align-items:center; justify-content:center; padding:6px; border-radius:12px; overflow:hidden;
    background:radial-gradient(120% 110% at 50% 35%, color-mix(in srgb, var(--hb-atm-accent) 14%, var(--bg)), color-mix(in srgb, var(--hb-atm-accent) 5%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 26%, transparent);
    box-shadow:inset 0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 var(--hb-bevel-hi); }
  #hb-root .hb-stage-grid { position:absolute; inset:0; pointer-events:none; opacity:0.5;
    background-image:linear-gradient(color-mix(in srgb, var(--hb-atm-accent) 13%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--hb-atm-accent) 13%, transparent) 1px, transparent 1px);
    background-size:22px 22px; -webkit-mask-image:radial-gradient(70% 70% at 50% 55%, #000, transparent); mask-image:radial-gradient(70% 70% at 50% 55%, #000, transparent); }
  #hb-root .hb-stage-glow { position:absolute; left:50%; bottom:8%; width:62%; height:16px; transform:translateX(-50%); pointer-events:none;
    border-radius:50%; background:radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--hb-atm-accent) 45%, transparent), transparent 72%);
    filter:blur(3px); animation:hbBayPulse 4.5s ease-in-out infinite; }
  @keyframes hbBayPulse { 0%,100% { opacity:0.55; } 50% { opacity:0.95; } }
  /* Corner brackets — machined bay markings on the viewport. */
  #hb-root .hb-stage-frame::before, #hb-root .hb-stage-frame::after { content:''; position:absolute; width:16px; height:16px; pointer-events:none;
    border-color:color-mix(in srgb, var(--hb-atm-accent) 60%, transparent); }
  #hb-root .hb-stage-frame::before { top:5px; left:5px; border-top:2px solid; border-left:2px solid; border-top-left-radius:5px; }
  #hb-root .hb-stage-frame::after { bottom:5px; right:5px; border-bottom:2px solid; border-right:2px solid; border-bottom-right-radius:5px; }
  #hb-root .hb-stage-cap { text-align:center; font-size:8px; letter-spacing:2.5px; text-transform:uppercase; color:var(--tos-fg-dim2); }
  #hb-root .hb-bench-stage canvas { display:block; margin:0 auto; position:relative; z-index:1; }
  #hb-root .hb-bench-panels { flex:1 1 260px; min-width:230px; min-height:0; display:flex; position:relative; z-index:4; }
  #hb-root #hb-perf-radar { display:block; margin:0 auto; }
  /* Controls card (tablet .tos-card recipe) — one raised surface per section, filling
     the column so the tab body has a real box to live in rather than growing the page. */
  #hb-root .hb-bench-card { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding:10px 12px 12px; border-radius:10px;
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); background:var(--hb-surf-lo);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 2px 8px rgba(0,0,0,0.18); }
  /* Section header inside the card — a lit pip + the tab's name over a hairline. */
  #hb-root .hb-card-head { display:flex; align-items:center; gap:7px; flex:0 0 auto; margin-bottom:9px; padding-bottom:6px;
    font-size:9px; font-weight:bold; letter-spacing:3px; color:var(--tos-fg-dim);
    border-bottom:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); }
  #hb-root .hb-card-dot { width:6px; height:6px; border-radius:50%; background:var(--hb-atm-accent);
    box-shadow:0 0 8px var(--hb-atm-accent); animation:hbBayPulse 3s ease-in-out infinite; }
  /* The single last-resort scroll region — and it fades in on every tab change. */
  #hb-root .hb-bench-tabbody { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding-right:3px;
    animation:hbTabFade .18s ease-out; }
  @keyframes hbTabFade { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  #hb-root .hb-bench-card .hb-note, #hb-root .hb-bench-card .hb-dim { color:var(--text-dim); }
  #hb-root .hb-bench-tabbody { color:var(--text); }
  #hb-root .hb-bench-tabbody .hb-ctl, #hb-root .hb-bench-tabbody .hb-tune-row { color:var(--text); }
  /* Paint's exterior/interior/schemes sub-nav — the same segmented control, mini. */
  #hb-root .hb-subtabs { display:flex; gap:3px; margin-bottom:9px; padding:3px; border-radius:7px;
    background:var(--hb-surf-lo); border:1px solid var(--border); box-shadow:inset 0 1px 2px var(--hb-bevel-lo); }
  #hb-root .hb-subtab { flex:1 1 auto; text-align:center; font-family:inherit; font-size:9px; letter-spacing:1px; text-transform:uppercase; cursor:pointer;
    color:var(--tos-fg-dim); background:transparent; border:1px solid transparent; border-radius:5px; padding:5px 9px;
    transition:filter .12s, color .12s, background .12s; }
  #hb-root .hb-subtab:hover { color:var(--tos-fg); background:color-mix(in srgb, var(--hb-atm-accent) 10%, transparent); }
  #hb-root .hb-subtab-active { color:var(--tos-fg); background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    border-color:color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 1px 2px rgba(0,0,0,0.18); }
  /* If a tab body ever does have to scroll, its two anchors don't go with it: the paint
     sub-nav stays pinned to the top and the Apply/Revert row to the bottom, so the
     controls you need are always on screen without hunting for them. */
  #hb-root .hb-bench-tabbody .hb-subtabs { position:sticky; top:0; z-index:3; }
  #hb-root .hb-bench-tabbody .hb-apply-row { position:sticky; bottom:0; z-index:3; margin-top:10px; padding-top:9px;
    background:linear-gradient(to top, var(--hb-surf-lo) 72%, transparent);
    border-top:1px solid color-mix(in srgb, var(--hb-atm-accent) 18%, transparent); }
  /* Hull docket — a big lit condition gauge over the mechanic's verdict. The ticks on
     the track mark the thresholds where the verdict (and the colour) changes. */
  #hb-root .hb-hull-gauge { padding:12px 14px 13px; border-radius:11px; margin-bottom:11px; text-align:center;
    background:var(--hb-surf-lo); border:1px solid var(--border);
    box-shadow:inset 0 2px 9px var(--hb-bevel-lo), inset 0 1px 0 rgba(255,255,255,0.06); }
  #hb-root .hb-hull-num { font-size:34px; font-weight:bold; letter-spacing:1px; line-height:1;
    text-shadow:0 0 16px currentColor; }
  #hb-root .hb-hull-num small { font-size:14px; opacity:0.6; margin-left:2px; }
  #hb-root .hb-hull-track { position:relative; height:10px; margin:11px 0 9px; border-radius:6px; background:var(--hb-surf);
    box-shadow:inset 0 1px 3px var(--hb-bevel-lo), inset 0 0 0 1px var(--border); overflow:hidden; }
  #hb-root .hb-hull-track i { position:absolute; left:0; top:0; bottom:0; border-radius:6px; box-shadow:0 0 10px currentColor; transition:width .3s ease-out; }
  #hb-root .hb-hull-track u { position:absolute; top:0; bottom:0; width:1px; background:color-mix(in srgb, var(--text) 40%, transparent); z-index:2; }
  #hb-root .hb-hull-verdict { font-size:10.5px; line-height:1.45; color:var(--text-dim); font-style:italic; }
  #hb-root .hb-repair-row { display:flex; gap:8px; flex-wrap:wrap; }
  /* Hopper — the pour list. Each can is a wide two-line button (name + what's in it), so a
     row reads as a container on the shelf rather than a menu entry. */
  #hb-root .hb-hop-cans { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
  /* The same list, folded into the Hull tab under a rule — it is a second job on the
     same visit, not a second panel, so it sits below the repair row rather than
     competing with it for the top of the card. */
  #hb-root .hb-hop-strip { margin-top:14px; padding-top:10px; border-top:1px solid var(--hb-line, rgba(255,255,255,.12)); }
  #hb-root .hb-hop-strip .hb-card-head { margin-bottom:6px; }
  #hb-root .hb-hop-can { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; width:100%; text-align:left; justify-content:flex-start; }
  #hb-root .hb-hop-can em { font-style:normal; opacity:.6; }
  #hb-root .hb-hop-can span { margin-left:auto; font-size:11px; opacity:.66; }
  #hb-root .hb-hop-clash { opacity:.45; cursor:not-allowed; }
  /* Tuning — rotary dials + a delta-bar readout, side by side (not stacked) so the
     whole tab fits one screen with no scrolling. The two clusters read as paired
     instrument bays: each a shallow well sunk into the bench face, its dials/bars in
     their own bezels — the same tactile, theme-following depth the tablet gives its
     tiles (light on a light theme, dark on a dark one). */
  #hb-root .hb-tune-grid { display:grid; grid-template-columns:minmax(150px,auto) 1fr; gap:8px 10px; align-items:stretch; margin-bottom:8px; }
  /* Dial cluster — a sunken instrument bay. */
  #hb-root .hb-knobs { display:grid; grid-template-columns:repeat(2,1fr); gap:6px; padding:9px; border-radius:12px;
    background:var(--hb-surf-lo); border:1px solid var(--border);
    box-shadow:inset 0 2px 8px var(--hb-bevel-lo), inset 0 1px 0 rgba(255,255,255,0.06); }
  /* Each dial panel-mounted in its own raised bezel — bright top lip, soft drop. */
  #hb-root .hb-knob-cell { display:flex; flex-direction:column; align-items:center; gap:1px; padding:5px 4px 4px; border-radius:10px; cursor:help;
    background:linear-gradient(180deg, var(--hb-surf), var(--hb-surf-lo)); border:1px solid var(--border);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 2px 4px rgba(0,0,0,0.16);
    transition:filter .12s, box-shadow .12s, border-color .12s; }
  #hb-root .hb-knob-cell:hover { filter:brightness(1.07); border-color:color-mix(in srgb, var(--hb-atm-accent) 45%, var(--border));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo), 0 2px 7px rgba(0,0,0,0.2), 0 0 12px color-mix(in srgb, var(--hb-atm-accent) 20%, transparent); }
  #hb-root .hb-knob { display:block; cursor:ns-resize; touch-action:none; }
  #hb-root .hb-knob-label { font-size:8px; letter-spacing:1px; color:var(--text-dim); margin-top:2px; text-align:center; }
  /* Readout reads like a lit segment display. */
  #hb-root .hb-knob-val { font-size:11px; font-weight:bold; color:var(--text-bright); letter-spacing:0.5px; text-shadow:0 0 6px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); }
  #hb-root .hb-knob-poles { display:flex; justify-content:space-between; width:100%; font-size:6.5px; letter-spacing:0.5px; color:var(--text-dim); margin-top:1px; padding:0 2px; }
  /* Delta readout — a matching sunken bay of lit meters. */
  #hb-root .hb-perf-bars { display:grid; grid-template-columns:42px 1fr 32px; gap:6px 8px; align-items:center; padding:9px 11px; border-radius:12px;
    background:var(--hb-surf-lo); border:1px solid var(--border);
    box-shadow:inset 0 2px 8px var(--hb-bevel-lo), inset 0 1px 0 rgba(255,255,255,0.06); }
  #hb-root .hb-pbar-row { display:contents; }
  #hb-root .hb-pbar-l { font-size:8px; letter-spacing:0.5px; color:var(--text-dim); text-align:right; cursor:help; }
  #hb-root .hb-pbar { position:relative; height:9px; background:var(--hb-surf); border-radius:5px;
    box-shadow:inset 0 1px 3px var(--hb-bevel-lo), inset 0 0 0 1px var(--border); cursor:help; }
  /* The 50% mark = stock; bars grow from there both ways so a swing reads as +/-. */
  #hb-root .hb-pbar::before { content:''; position:absolute; left:50%; top:-1px; bottom:-1px; width:1px; background:color-mix(in srgb, var(--text) 35%, transparent); z-index:2; }
  #hb-root .hb-pbar i { position:absolute; top:0; bottom:0; left:50%; width:0; border-radius:5px; box-shadow:0 0 7px currentColor; z-index:1;
    transition:left .08s ease-out, width .08s ease-out, background .08s, box-shadow .08s; }
  #hb-root .hb-pbar-d { font-size:9px; font-weight:bold; letter-spacing:0.5px; text-align:left; min-width:28px; }
  #hb-root .hb-apply-row .hb-tune-note { flex-basis:100%; font-size:9px; color:var(--text-dim); margin-top:2px; }
  /* Upgrade kits — their own tab: a selectable list beside the picked kit's detail. */
  #hb-root .hb-kits-head { font-size:9px; letter-spacing:3px; color:var(--text-dim); margin-bottom:6px; }
  #hb-root .hb-kits2 { display:grid; grid-template-columns:minmax(118px,44%) 1fr; gap:10px; align-items:start; }
  #hb-root .hb-kit-list { display:flex; flex-direction:column; gap:6px; }
  #hb-root .hb-kit-item { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; text-align:left; cursor:pointer;
    font-family:inherit; font-size:11px; letter-spacing:0.5px; color:var(--text); padding:8px 10px; border-radius:9px;
    background:linear-gradient(180deg, var(--hb-surf), var(--hb-surf-lo)); border:1px solid var(--border);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), inset 0 -2px 3px var(--hb-bevel-lo); transition:filter .12s, border-color .12s, box-shadow .12s; }
  #hb-root .hb-kit-item:hover { filter:brightness(1.07); border-color:color-mix(in srgb, var(--hb-atm-accent) 45%, var(--border)); }
  #hb-root .hb-kit-item-sel { border-color:var(--hb-atm-accent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 0 10px color-mix(in srgb, var(--hb-atm-accent) 25%, transparent); }
  #hb-root .hb-kit-item-name { flex:1; }
  #hb-root .hb-kit-item-tag { font-size:9px; letter-spacing:0.5px; color:var(--text-bright); white-space:nowrap; }
  #hb-root .hb-kit-item-fitted { color:var(--green); }
  #hb-root .hb-kit-detail { padding:10px 12px; border-radius:12px; border:1px solid var(--border); background:var(--hb-surf-lo);
    box-shadow:inset 0 2px 8px var(--hb-bevel-lo); }
  #hb-root .hb-kit-detail-name { font-size:12px; font-weight:bold; letter-spacing:1px; color:var(--text-bright); margin-bottom:4px; }
  #hb-root .hb-kit-detail-act { margin-top:10px; padding-top:9px; border-top:1px solid var(--border); }
  #hb-root .hb-kit-tag { font-size:8px; letter-spacing:1px; color:var(--green); border:1px solid color-mix(in srgb, var(--green) 45%, transparent); border-radius:3px; padding:2px 6px; }
  #hb-root .hb-kit-blurb { font-size:10.5px; color:var(--text-dim); margin-top:4px; line-height:1.4; }
  /* W&B loading sheet — three read-out tiles over the cabin-fit keys. */
  #hb-root .hb-wb-tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  #hb-root .hb-wb-tile { padding:8px 10px 9px; border-radius:10px; background:var(--hb-surf-lo); border:1px solid var(--border);
    box-shadow:inset 0 2px 7px var(--hb-bevel-lo), inset 0 1px 0 rgba(255,255,255,0.06); }
  #hb-root .hb-wb-tile i { display:block; font-style:normal; font-size:8px; letter-spacing:1.5px; text-transform:uppercase; color:var(--tos-fg-dim2); }
  #hb-root .hb-wb-tile b { display:block; font-size:18px; font-weight:bold; color:var(--text-bright); line-height:1.2;
    text-shadow:0 0 9px color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); }
  #hb-root .hb-wb-tile b small { font-size:10px; opacity:0.6; margin-left:1px; }
  #hb-root .hb-wb-tile u { display:block; text-decoration:none; font-size:8.5px; color:var(--text-dim); margin-top:3px; }
  #hb-root .hb-loadout-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
  #hb-root .hb-chip { width:14px; height:14px; border-radius:3px; display:inline-block; }
  #hb-root .hb-ctls { display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
  #hb-root .hb-ctl { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; color:var(--tos-fg-dim); letter-spacing:1px; }
  #hb-root .hb-ctl input[type=color] { width:44px; height:26px; padding:0; border:1px solid color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); border-radius:5px; background:none; cursor:pointer; }
  /* The swatch chip: a lacquered paint sample beside its hex code. */
  #hb-root .hb-cp-swatch { display:inline-flex; align-items:center; gap:7px; padding:3px 8px 3px 4px; cursor:pointer; font-family:inherit;
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 40%, transparent); border-radius:7px;
    background:linear-gradient(165deg, var(--hb-surf), var(--hb-surf-lo));
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 1px 3px rgba(0,0,0,0.25); transition:filter .12s, border-color .12s, box-shadow .12s; }
  #hb-root .hb-cp-swatch i { width:26px; height:20px; border-radius:4px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(0,0,0,0.35); }
  #hb-root .hb-cp-swatch em { font-style:normal; font-size:9px; letter-spacing:0.8px; color:var(--tos-fg-dim); }
  #hb-root .hb-cp-swatch:hover { filter:brightness(1.08); border-color:var(--hb-atm-accent);
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi), 0 0 11px color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); }
  #hb-root .hb-cp-swatch:hover em { color:var(--tos-fg); }
  /* The colour-picker popover's own rules live with it in ./color-picker.js — it
     mounts on <body>, so they were never scoped under #hb-root anyway, and the
     spray can needs the same ones. The theme tokens above are what it copies. */
  #hb-root .hb-ctl select { flex:1; max-width:130px; padding:5px 6px; font-family:inherit; cursor:pointer;
    color:var(--tos-fg); background:color-mix(in srgb, var(--hb-atm-accent) 8%, var(--bg2));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); border-radius:6px; }
  /* The dash nameplate: typed in, so a field, but in the selects' finish rather than a white form box. */
  #hb-root .hb-ctl input[data-plate-field] { flex:1; min-width:0; max-width:130px; padding:5px 7px; font-family:inherit; letter-spacing:2px; text-transform:uppercase;
    color:var(--tos-fg); background:color-mix(in srgb, var(--hb-atm-accent) 8%, var(--bg2));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); border-radius:6px; }
  #hb-root .hb-ctl input[data-plate-field]::placeholder { color:var(--tos-fg-dim); }
  #hb-root .hb-apply-row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
  #hb-root .hb-schemes { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  #hb-root .hb-scheme { display:inline-flex; align-items:center; background:var(--hb-surf-lo); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 28%, transparent); border-radius:6px; overflow:hidden;
    box-shadow:inset 0 1px 0 var(--hb-bevel-hi); }
  #hb-root .hb-scheme-load { display:flex; align-items:center; gap:6px; font-size:10px; letter-spacing:1px; color:var(--tos-fg); cursor:pointer; background:none; border:none; padding:5px 6px 5px 8px; font-family:inherit; }
  #hb-root .hb-scheme-del { background:none; border:none; border-left:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); color:var(--tos-fg-dim); cursor:pointer; padding:5px 7px; font-family:inherit; }
  #hb-root .hb-scheme-del:hover { color:#ff8a8a; }
  #hb-root .hb-scheme-save { display:flex; gap:8px; }
  #hb-root .hb-scheme-save input { flex:0 0 120px; color:var(--tos-fg); background:color-mix(in srgb, var(--hb-atm-accent) 8%, var(--bg2)); border:1px solid color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); border-radius:6px; padding:6px 8px; font-family:inherit; outline:none; }
  #hb-root .hb-scheme-save input:focus { border-color:var(--hb-atm-accent); box-shadow:0 0 0 2px color-mix(in srgb, var(--hb-atm-accent) 22%, transparent); }
  /* Narrow pane: the two bench columns stack. The stage shrinks to a strip and the
     bench itself becomes the (in-theme) scroll region, since a phone-width column
     genuinely can't hold both — scrolling stays the last resort, not the default. */
  @media (max-width:620px) {
    #hb-root .hb-ctls { grid-template-columns:1fr; }
    #hb-root .hb-bench { overflow-y:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--hb-atm-accent) 55%, var(--border)) transparent; }
    #hb-root .hb-bench::-webkit-scrollbar { width:7px; }
    #hb-root .hb-bench::-webkit-scrollbar-track { background:var(--hb-surf-lo); border-radius:4px; }
    #hb-root .hb-bench::-webkit-scrollbar-thumb { background:linear-gradient(180deg, color-mix(in srgb, var(--hb-atm-accent) 70%, var(--bg2)), color-mix(in srgb, var(--hb-atm-accent) 35%, var(--bg2))); border-radius:4px; }
    #hb-root .hb-bench-main { flex-direction:column; align-items:stretch; min-height:auto; }
    #hb-root .hb-bench-stage { flex:0 0 auto; }
    #hb-root .hb-bench-tabbody { overflow:visible; }
    #hb-root .hb-tune-grid { grid-template-columns:1fr; }
  }
  /* ── The floor's hand of cards (vehicle-card.js draws the cards) ── */
  #hb-root .hb-hand-col { white-space:normal; flex:1 1 auto; min-height:0; overflow-y:auto; padding:2px 2px 8px; }
  #hb-root .hb-hand-col .vc-hand { grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); }
  #hb-root .hb-hand-col .hb-hint { position:static; margin-bottom:10px; }
  #hb-root .vc-mini.vc-go { border-color:var(--hb-atm-accent); color:var(--hb-atm-accent); font-weight:bold; }
  /* ── The maintenance bay: the 3-D stage beside a row of job cards ── */
  #hb-root .hb-bay2 { flex:1 1 auto; min-height:0; display:flex; gap:12px; white-space:normal; }
  #hb-root .hb-bay2-stage { position:relative; flex:1.25 1 0; min-width:0; min-height:260px; display:flex; border-radius:8px; overflow:hidden;
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 25%, var(--border)); }
  #hb-root .hb-bay2-stage .hb-scene { cursor:grab; border-radius:0; }
  #hb-root .hb-stage-mode { position:absolute; right:10px; top:10px; z-index:3; padding:5px 11px; border-radius:16px; cursor:pointer;
    font:600 11px/1 inherit; letter-spacing:.5px; color:#fff; background:linear-gradient(135deg, color-mix(in srgb, var(--hb-atm-accent) 70%, #000), rgba(10,14,20,.8));
    border:1px solid var(--hb-atm-accent); box-shadow:0 0 12px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); }
  #hb-root .hb-stage-mode:hover { filter:brightness(1.2); }
  #hb-root .hb-stage-radar { position:absolute; left:8px; bottom:8px; transform:scale(.72); transform-origin:left bottom; z-index:2; background:rgba(6,12,18,0.72); border-radius:8px; pointer-events:none; }
  /* The paint booth is an NFS Underground garage: neon on black, italic caps, a hard glow. */
  #hb-root .hb-bay2-stage.hb-booth { background:#05060c; box-shadow:inset 0 0 0 1px rgba(196,72,255,0.55), 0 0 18px rgba(196,72,255,0.25); }
  #hb-root .hb-booth .hb-inspect-name { font-style:italic; text-transform:uppercase; font-size:16px; letter-spacing:2px; color:#fff;
    text-shadow:0 0 6px rgba(64,220,255,0.9), 0 0 16px rgba(64,220,255,0.5); }
  #hb-root .hb-booth .hb-inspect-name span { color:#ff5cc0; text-shadow:0 0 6px rgba(255,60,170,0.8); }
  #hb-root .hb-booth .hb-inspect-hint { font-style:italic; color:#bfefff; background:rgba(5,6,12,0.75); border-color:rgba(64,220,255,0.6);
    box-shadow:0 0 8px rgba(64,220,255,0.35); }
  #hb-root .hb-booth .hb-stage-mode { font-style:italic; text-transform:uppercase; letter-spacing:1px; color:#fff; background:rgba(40,8,48,0.8);
    border:1px solid #c448ff; box-shadow:0 0 10px rgba(196,72,255,0.6), inset 0 0 6px rgba(196,72,255,0.4); }
  /* The booth's Exterior | Interior switch, top left, in the booth's neon. */
  #hb-root .hb-view-seg { position:absolute; left:10px; top:40px; z-index:3; display:flex; border:1px solid #c448ff; border-radius:16px; overflow:hidden;
    background:rgba(40,8,48,0.8); box-shadow:0 0 10px rgba(196,72,255,0.5); }
  #hb-root .hb-view-seg button { font:inherit; font-size:10px; font-style:italic; text-transform:uppercase; letter-spacing:1px; padding:5px 11px;
    color:#d9b8ff; background:none; border:0; cursor:pointer; }
  #hb-root .hb-view-seg button.on { color:#fff; background:rgba(196,72,255,0.45); text-shadow:0 0 6px rgba(255,120,255,0.9); }
  #hb-root .hb-view-seg button:focus-visible { outline:2px solid #40dcff; outline-offset:-2px; }
  #hb-root .hb-seat { background:#05060c; }
  #hb-root .hb-seat-note { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-style:italic; letter-spacing:1px;
    color:#bfefff; text-shadow:0 0 6px rgba(64,220,255,0.8); pointer-events:none; }
  #hb-root .hb-bay2-side { flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:10px; min-height:0; }
  #hb-root .hb-jobs { flex:0 0 auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); gap:6px; }
  #hb-root .hb-job { display:flex; flex-direction:column; align-items:flex-start; gap:1px; padding:7px 9px; border-radius:8px; cursor:pointer;
    font-family:inherit; text-align:left; color:var(--text); background:var(--hb-surf-lo, rgba(127,127,127,.08));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 20%, var(--border)); transition:transform .1s, border-color .1s; }
  #hb-root .hb-job:hover { transform:translateY(-2px); border-color:var(--hb-atm-accent); }
  #hb-root .hb-job.on { border-color:var(--hb-atm-accent); box-shadow:inset 0 0 0 1px var(--hb-atm-accent), 0 0 10px color-mix(in srgb, var(--hb-atm-accent) 30%, transparent); }
  #hb-root .hb-job-ico { font-size:16px; line-height:1.2; }
  #hb-root .hb-job b { font-size:12px; letter-spacing:.5px; }
  #hb-root .hb-job-sub { font-size:10px; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  #hb-root .hb-job-sub.warn { color:#e8c07a; } #hb-root .hb-job-sub.bad { color:#ff6b6b; }
  /* Livery scheme cards: a band of the look's colours under a moving sheen, the name, the tag. */
  #hb-root .hb-looks { display:grid; grid-template-columns:repeat(auto-fill,minmax(128px,1fr)); gap:8px; margin-bottom:8px; }
  #hb-root .hb-look { position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:3px; width:100%; padding:7px; border-radius:10px;
    cursor:pointer; overflow:hidden; font-family:inherit; text-align:left; color:var(--text);
    background:linear-gradient(160deg, color-mix(in srgb, var(--hb-atm-accent) 10%, rgba(20,24,32,.9)), rgba(8,10,14,.92));
    border:1px solid color-mix(in srgb, var(--hb-atm-accent) 22%, var(--border));
    box-shadow:0 4px 10px rgba(0,0,0,.35); transition:transform .14s, box-shadow .14s, border-color .14s; }
  #hb-root .hb-look:hover { transform:translateY(-3px) scale(1.02); border-color:var(--hb-atm-accent);
    box-shadow:0 10px 20px rgba(0,0,0,.45), 0 0 16px color-mix(in srgb, var(--hb-atm-accent) 35%, transparent); }
  #hb-root .hb-look.on { border-color:var(--hb-atm-accent);
    box-shadow:inset 0 0 0 1px var(--hb-atm-accent), 0 0 22px color-mix(in srgb, var(--hb-atm-accent) 45%, transparent); }
  #hb-root .hb-look.on::after { content:'✓'; position:absolute; top:10px; left:12px; z-index:3; font:700 13px/1 system-ui; color:#fff;
    text-shadow:0 1px 3px #000; }
  #hb-root .hb-look-band { position:relative; display:flex; width:100%; height:44px; border-radius:6px; overflow:hidden;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.18), inset 0 -8px 14px rgba(0,0,0,.35); transform:skewX(-8deg); }
  #hb-root .hb-look-band i { flex:1 1 0; display:block; }
  #hb-root .hb-look-band em { position:absolute; inset:0; background:linear-gradient(105deg, transparent 30%, rgba(255,255,255,.55) 45%, transparent 60%);
    transform:translateX(-120%); }
  #hb-root .hb-look:hover .hb-look-band em, #hb-root .hb-look.on .hb-look-band em { animation:hbSheen 1.4s ease-in-out infinite; }
  @keyframes hbSheen { from { transform:translateX(-120%); } to { transform:translateX(120%); } }
  #hb-root .hb-look b { font-size:12px; letter-spacing:.6px; text-transform:uppercase; }
  #hb-root .hb-look-tag { font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:var(--text-dim); }
  #hb-root .hb-look-star { position:absolute; top:4px; right:6px; z-index:3; font-size:15px; color:#ffd24a;
    text-shadow:0 0 8px rgba(255,210,74,.9), 0 1px 2px #000; animation:hbTwinkle 2.2s ease-in-out infinite; }
  @keyframes hbTwinkle { 50% { opacity:.55; transform:scale(.85) rotate(20deg); } }
  #hb-root .hb-look-wrap { position:relative; display:block; }
  #hb-root .hb-look-del { position:absolute; top:4px; right:4px; z-index:4; width:20px; height:20px; padding:0; border-radius:50%; cursor:pointer; font-size:10px;
    color:#fff; background:rgba(0,0,0,.6); border:1px solid rgba(255,255,255,.3); }
  /* Every part, as a swatch */
  #hb-root .hb-parts { display:grid; grid-template-columns:repeat(auto-fill,minmax(118px,1fr)); gap:5px; margin-bottom:8px; }
  #hb-root .hb-part { position:relative; display:block; }
  #hb-root .hb-part .hb-cp-swatch { width:100%; justify-content:flex-start; }
  #hb-root .hb-part.own .hb-cp-swatch { border-color:var(--hb-atm-accent); }
  #hb-root .hb-part-x { position:absolute; right:3px; top:50%; transform:translateY(-50%); width:20px; height:20px; padding:0; border-radius:50%;
    cursor:pointer; color:#fff; background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.25); font-size:11px; }
  @media (prefers-reduced-motion:reduce) { #hb-root .hb-look, #hb-root .hb-look-band em, #hb-root .hb-look-star { animation:none !important; transition:none; } }
  @media (max-width:720px) {
    #hb-root .hb-bay2 { flex-direction:column; overflow-y:auto; }
    #hb-root .hb-bay2-stage { flex:0 0 240px; }
    #hb-root .hb-bay2-side .hb-bench-tabbody { overflow:visible; }
  }
  `;
  document.head.appendChild(st);
}
