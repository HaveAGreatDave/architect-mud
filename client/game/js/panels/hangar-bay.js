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
import { suppressWeatherFx } from './weather-fx.js';
import { drawWireframe3D, drawKnob, drawPerfRadar, themeColor, rgbTriplet } from './wireframe-plane.js';
import { openColorPicker, closeColorPicker } from './color-picker.js';
import { compactHidePanel } from '../../../shared/compact-view.js';
import { liveriesFor } from '../../../shared/livery-sets.js';
import { shellProfileFor } from '../../../shared/interior-shell.js';
import { loadWindshield, isLoaded as windshieldLoaded, paintWindshield, disposeWindshield, glWorldInstalled, RENDER_TUNE } from './windshield-lazy.js';
import { ensureDepotStyles, headHtml, jobsHtml, mountBay, setBayOpen, bayHtml, leaveHtml, bayChipHtml,
  armHolds, shellClick, clearViewModes, noteAct, notePush, money, readyHtml } from './depot-shell.js';
import { SHOTS } from './camera-tween.js';
import { garageBed } from './garage-ambience.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';

// hangar-bay.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const HANGAR_CSS = await loadCss(new URL('./hangar-bay.css', import.meta.url));

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
  return !!(B && !B.service && B.screen === 'inspect' && (B.inspect?.mode || 'walk') === 'walk');
}

// ⚠ THE COCKPIT IS ASKED FOR, NEVER IMPORTED. A static import would pull cockpit.js and GLASS
// with it (about 3 MB) to show a menu, which is why lazy-views.js loads this file without wiring
// the renderer. The bench only docks on a cockpit that is already open, so by then the module is
// loaded and this resolves from the cache.
let CK = null;
const cockpit = () => (CK ? Promise.resolve(CK) : import('./cockpit.js').then((m) => (CK = m)));

// ── Entry points (dispatch.js wires these to the server pushes) ───────────────
export function openHangarBay(data) {
  // A background refresh (e.g. after a remote tablet sale) only updates an
  // already-open bay — if the panel is closed, ignore it rather than popping the
  // 3D hangar open over whatever the player is actually looking at (the tablet).
  if (data?.refreshOnly && !B) return;
  // Sitting in her on the hangar floor: the bench docks on the cockpit (see THE SERVICE BAY).
  if (data?.service) return void openService(data);
  // A pane push while the bench is docked (a 'hangar' typed from the seat) leaves the bench where
  // it is: the pane is the cockpit's while you are sitting in her.
  if (B?.service) return;
  const freshOpen = !B;
  const spentFrom = freshOpen ? null : B.data?.credits;
  // Snap the top pane back to its default auto size so the whole hangar UI fits the
  // interface, regardless of any manual drag height left on the previous room look.
  if (freshOpen) document.getElementById('area-pane')?.dispatchEvent(new CustomEvent('lookpaneauto'));
  // ⚠ AND ON A PHONE THE LOG FOLDS AWAY. The bay is a full-height UI in a pane that is a third of
  // a phone screen, and the scrollback takes the rest. Only on a FRESH open, which is what stops a
  // background refresh (a remote tablet sale) re-asserting it over a player who reopened the log.
  // The buttons light themselves off the body class at render, so there is nothing to pass here.
  if (freshOpen) compactHidePanel('ds-hidepanel');
  // The bay draws its own weather (the ambience bed, lightning through the doors). The outdoor
  // rain overlay on top is wrong, and a second full-pane canvas redrawn every frame.
  suppressWeatherFx(true, 'hangar');
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told; an app that mounts there has to say so
  B = B || { screen: 'floor', selId: null, work: null };
  B.data = data || {};
  const craft = B.data.craft || [];
  if (data.select && craft.find(c => c.id === data.select)) {
    B.selId = data.select; B.screen = 'bench'; B.work = { ...craft.find(c => c.id === data.select).livery };
  } else if (freshOpen || (data.fresh && craft.some(c => c.id === data.fresh))) {
    // A push that names an aircraft you just bought or rented lands on the floor, where her key is.
    B.selId = null; B.screen = 'floor';
  } else if (B.selId && !craft.find(c => c.id === B.selId)) {
    B.selId = null; if (B.screen === 'bench') B.screen = 'floor';
  }
  ensureStyles();
  ensureDepotStyles();
  ensureCardStyles();
  render();
  if (spentFrom != null) notePush(document.getElementById('hb-root'), spentFrom, B.data.credits);
}

export function openCharterScreen(data) {
  if (B?.service) return;
  if (!B) openHangarBay({});
  charterData = data;
  charterAny = !!data?.vtolOnly;   // a VTOL-only pad (the Echelon) is Dragonfly-from-the-start
  B.screen = 'charter';
  render();
}

// ── THE SERVICE BAY ──────────────────────────────────────────────────────────
// Sitting in her on the hangar floor (`hangaract service`), the bench is an overlay on the cockpit
// rather than a pane app, the way the depot's is on the cab (truck-depot.js) and the shipwright's on
// the helm (marina-panel.js): the shell's bay (depot-shell.js) on the cockpit's glass. The camera is
// outside her and IS the preview: the working paint rides to it through cockpitPreview, nothing is
// charged until Apply, and each job swings the camera to the part it works on. "Taxi out" folds the
// bench and puts you in the seat. On a field with no GLASS hangar she is out on her pad, and the
// bench works on her there.
//
// ⚠ THE SERVER DECIDES WHEN THIS IS UP. pushHangarBay sends `service` while she is on the hangar
// floor with you aboard (hangars.js servicedCraft); every bench verb re-pushes, or is re-fetched,
// and lands back here. The bench goes when the cockpit does (`fsim:closed`) or when she rolls.
function openService(data) {
  cockpit().then((ck) => {
    const host = ck.cockpitServiceHost();
    // No cockpit under it (a text pilot, or the seat already shut): the pane bench is the fallback.
    if (!host) { openHangarBay({ ...data, service: false, select: data.serviceId }); return; }
    const was = B?.service ? B : null;
    // Coming from the counter: it held the pane, and the cockpit has it now.
    if (B && !B.service) dropPane();
    const c = (data.craft || []).find((x) => x.id === data.serviceId);
    B = { screen: 'bench', service: true, selId: data.serviceId, data,
      benchTab: was?.benchTab, paintTab: was?.paintTab, kitSel: was?.kitSel, open: was ? was.open : true,
      shot: was?.shot, view: was?.view ?? null,
      // The working copy survives a re-push (every Apply sends one) unless the bench is new.
      work: was && was.selId === data.serviceId && was.work ? was.work : (c ? { ...c.livery } : null),
      tune: was?.tune || null, tuneFor: was?.tuneFor || null };
    ensureStyles();
    ensureDepotStyles();
    if (!was) garageBed(data.hangar ? 'hangar' : null);
    render();
    if (was) notePush(document.getElementById('hb-svc'), was.data?.credits, data.credits);
    watchRoll(ck);
  }).catch(() => { /* no cockpit module, no bench to dock */ });
}
// The seat's own close takes the bench with it.
window.addEventListener('fsim:closed', () => { if (B?.service) closeHangarBay(); });

// ⚠ AND SO DOES ROLLING. Nothing on the server re-checks "on the hangar floor" while you sit in her
// (there is no flight sync with the engine off), so the bench watches the cockpit: once she is moving
// under her own power she has left the bay, and the bench goes for good.
let rollT = 0;
function watchRoll(ck) {
  clearInterval(rollT);
  rollT = setInterval(() => {
    if (!B?.service) { clearInterval(rollT); rollT = 0; return; }
    if (ck.cockpitRolling?.()) closeHangarBay();
  }, 500);
}

function dropPane() {
  closeColorPicker({ silent: true });
  suppressWeatherFx(false, 'hangar');
  stopHangarAmbience();   // the render loop drove the weather bed; it stops now, so silence it
  clearViewModes();       // drop the immersive layout so the room look isn't left with the log/command box hidden
  window.dispatchEvent(new Event('pane:released'));  // hand the collapsed pane back to the phone layout
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  dropSeat();
  // Tear the panel out of the pane immediately rather than leaving it (with its
  // now-dead click handlers) on screen until whatever look/move follows renders.
  document.getElementById('hb-root')?.remove();
}

export function closeHangarBay() {
  if (B?.service) {
    closeColorPicker({ silent: true });
    clearInterval(rollT); rollT = 0;
    garageBed(null);
    // Hand the camera back, and swap the working copy for her paint as the server last sent it: a
    // colour only looked at is never the one she flies in. ⚠ NOT NULL: the cockpit was opened with
    // the livery she had when you climbed in, and nothing pushes a respray to an open cockpit
    // (flight_ctx carries no own-ship livery), so null would put the OLD paint back on her for the
    // rest of the flight. closeFlightSim clears the preview when the flight ends.
    const view = B.view, c = (B.data?.craft || []).find((x) => x.id === B.selId);
    if (CK) { try { CK.cockpitPreview({ livery: c?.livery || null }); if (view) CK.cockpitView(view); } catch { /* the seat can already be gone */ } }
    document.getElementById('hb-svc')?.remove();
    B = null; charterData = null;
    return;
  }
  dropPane();
  B = null; charterData = null;
}

// Escape backs out one screen at a time (matches the header/toolbar back button);
// bound once at module load, not per-render, so it never stacks up duplicate handlers.
// The docked bench leaves Escape to the cockpit, which uses it to release the stick.
window.addEventListener('keydown', (e) => {
  if (!B || B.service || e.key !== 'Escape') return;
  if (B.screen !== 'floor') { go('floor'); } else if (B.data?.inHangar) { sendCmdSilent(B.data.exitDir || 'out'); } else { closeHangarBay(); sendCmdSilent('look'); }
});

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
// craft here, then the charter, then a slot to buy or rent. THE CARD SEATS YOU, as theirs do: she
// is boarded on the hangar floor (her pad, where the field has no hangar) with the bench on the
// cockpit and the camera outside her. A pilot without a licence can't take the seat, so for them
// the card opens the bench here in the pane, with its own 3-D stage. What else you can do to a
// craft from the floor is the strip under her card; what can't be undone there is held.
function floorScreen() {
  const d = B.data, craft = (d.craft || []).filter(c => !c.wreck);
  const pilot = d.pilot || { present: false };
  const pumps = d.fuelStocks || [];
  const seated = d.cockpitBench && (d.licensed || d.isAdmin);
  const cards = craft.map(c => {
    const style = cardStyleFor(c.id);
    const badge = c.rental ? '<span class="vc-badge hired">RENTAL</span>'
      : `<span class="vc-badge owned">${c.location === 'hangar' ? 'IN BAY' : 'ON RAMP'}</span>`;
    const hull = Math.max(0, Math.min(100, c.hullPct));
    const acts = [
      tbtnMini('Fly', `data-act="embark" data-id="${esc(c.id)}" data-tail="${esc(c.tail)}"`, 'vc-go'),
      pumps.includes(c.fuelType) && c.fuelPct < 100 ? tbtnMini(`Refuel · ${c.fuelPct}%`, `data-act="refuel" data-id="${esc(c.id)}"`) : '',
      d.hasBay && c.location === 'ramp' ? tbtnMini('Store', `data-act="store" data-id="${esc(c.id)}"`) : '',
      d.hasBay && c.location === 'hangar' ? tbtnMini('Roll out', `data-act="pull" data-id="${esc(c.id)}"`) : '',
      c.rental ? tbtnMini('Return', `data-hold="cancelrental ${esc(c.id)}" title="Hand her back: the rental ends here"`)
        : tbtnMini('Sell', `data-hold="sell ${esc(c.id)}" title="Sell her outright: this can't be undone"`),
    ].filter(Boolean).join('');
    return `<div class="vc-wrap${c.id === d.fresh ? ' fresh' : ''}">
      <button class="vc-card ${style}" data-act="${seated ? 'service' : 'bench'}" data-id="${esc(c.id)}"
          aria-label="${esc(`${c.tail}, ${c.typeName}: ${seated ? 'climb in and work on her' : 'open maintenance'}`)}"
          title="${seated ? (d.hangar ? 'Climb in on the hangar floor: the bench comes with you' : 'Climb in where she stands: the bench comes with you') : 'Maintenance, paint and tuning'}">
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
  // The aircraft you just bought or rented, and one key into her: the card's own Fly.
  const nu = craft.find(c => c.id === d.fresh);
  const ready = nu ? readyHtml({ title: nu.rental ? `${nu.tail}, rented.` : `${nu.tail} is yours.`,
    sub: `${nu.typeName}, ${nu.location === 'hangar' ? 'in the bay' : 'on the ramp'}, fuel ${nu.fuelPct}%.`,
    label: 'Fly her', ico: '✈', attrs: `data-act="embark" data-id="${esc(nu.id)}" data-tail="${esc(nu.tail)}"` }) : '';
  return `<div class="hb-hand-col hb-thin">${ready}${hint}<div class="vc-hand">${cards}${charter}${slots}</div></div>
    `;
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
  const boardPrompt = (walk && !c.wreck) ? `<div class="hb-board" id="hb-board" data-act="embark" data-id="${esc(c.id)}" data-tail="${esc(c.tail)}">✈ BOARD</div>` : '';
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
        ${!c.wreck ? tbtn('✈', 'Board', `data-act="embark" data-id="${esc(c.id)}" data-tail="${esc(c.tail)}"`, 'hb-accent hb-go') : ''}
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
    const setVariants = new Set(liveriesFor('aircraft', c.liveryModel || c.class).map(s => s.exterior?.variant).filter(Boolean));
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

// The tank, and the pump if this field has one for her. The figures are the server's (fuelNow,
// fuelCap, fillCost off buildCards); the key is the same `refuel <id>` the floor card sends, which
// fills her whether you are sitting in her or standing beside her.
function fuelTabHtml(c) {
  const pct = Math.max(0, Math.min(100, c.fuelPct));
  const col = pct < 15 ? '#ff6b6b' : pct < 40 ? '#ffb26b' : 'var(--hb-atm-accent)';
  const verdict = pct === 0 ? 'Bone dry. She is not going anywhere.'
    : pct >= 98 ? 'Brimmed.'
    : `${c.fuelNow} of ${c.fuelCap} units of ${esc(c.fuelType)}.`;
  const gauge = `<div class="hb-hull-gauge">
      <div class="hb-hull-num" style="color:${col}">${pct}<small>%</small></div>
      <div class="hb-hull-track"><i style="width:${pct}%;background:${col};color:${col}"></i>
        <u style="left:20%"></u><u style="left:50%"></u><u style="left:80%"></u></div>
      <div class="hb-hull-verdict">${verdict}</div>
    </div>`;
  const pumps = B.data?.fuelStocks || [];
  if (!pumps.length) return gauge + `<div class="hb-note">No pumps at this field.</div>`;
  if (!pumps.includes(c.fuelType)) return gauge + `<div class="hb-note">The pumps here are ${esc(pumps.join(' and '))}. She runs on ${esc(c.fuelType)}.</div>`;
  if (pct >= 98) return gauge + `<div class="hb-note">Full. Nothing to pump.</div>`;
  return gauge + `<div class="hb-repair-row">
      <button class="hb-btn hb-accent" data-act="refuel" data-id="${esc(c.id)}">Fill her up · ${money(c.fillCost)}</button>
    </div>`;
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
  const root = benchRoot(); if (!root) return;
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
    map: SEAT_MAP, livery: lv, powered: true, fuel: 1, hull: 1, noWxBadge: true, covered: 0.9,   // indoors: no weather readout on the glass, and the hangar roof over the cockpit
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
  const { jobs, body } = benchParts(c);
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
        <div class="hb-inspect-hint">${seat ? 'PAINT SHOP · drag to look round' : booth ? 'PAINT SHOP · drag to spin her · click to stop or start' : STAGE_CAP[venue] + ' · drag to walk round her'}</div>
        ${booth && hasCabin(c) ? `<div class="hb-view-seg" role="group" aria-label="Booth view">${[['ext', 'Exterior'], ['int', 'Interior']]
          .map(([k, l]) => `<button type="button" data-booth-view="${k}" aria-pressed="${(seat ? 'int' : 'ext') === k}"${(seat ? 'int' : 'ext') === k ? ' class="on"' : ''}>${l}</button>`).join('')}</div>` : ''}
        <button class="hb-stage-mode" data-act="stage-mode">${booth ? '⌂ Back to the ' + (venue === 'hangar' ? 'hangar' : venue === 'helipad' ? 'pad' : 'ramp') : '✦ Paint booth'}</button>
        ${radar}
      </div>
      <div class="hb-bay2-side">
        ${jobs}
        <div class="hb-bench-tabbody hb-thin" data-tabkey="${B.benchTab}">${body}</div>
      </div>
    </div>
    <div class="hb-toolbar">
      <div class="hb-tb-group">
        ${!c.wreck ? tbtn('✈', 'Fly', `data-act="embark" data-id="${esc(c.id)}" data-tail="${esc(c.tail)}"`, 'hb-accent hb-go') : ''}
        ${tbtn('◉', 'Walk round', 'data-act="inspect"')}
      </div>
      <div class="hb-tb-group hb-tb-right">${tbtn('‹', 'Back', 'data-act="back"')}</div>
    </div>`;
}

// THE BENCH'S JOBS AND THE PAGE UNDER THEM, for either home: the pane's bench (beside the 3-D
// stage) and the bench docked on the cockpit (where the cockpit's own camera is the stage). Each
// job's tile says what is waiting behind it, in the shell's tile (depot-shell.js jobsHtml).
function benchParts(c) {
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
  const tuneDirty = B.tune && B.tuneFor === c.id && TUNE_KEYS.some(k => Math.abs((B.tune[k] || 0) - ((c.tune || {})[k] || 0)) > 0.001);
  const fitted = (c.kitCatalog || []).filter(k => k.owned).length;
  const cards = [
    { id: 'hull', ico: '🔧', label: 'Repair', sub: `hull ${hull}%`, tone: hull >= 98 ? 'ok' : barTone(hull / 100) },
    ...(!c.wreck ? [{ id: 'fuel', ico: '⛽', label: 'Fuel', sub: `${c.fuelPct}%`, tone: c.fuelPct >= 98 ? 'ok' : barTone(c.fuelPct / 100) }] : []),
    { id: 'paint', ico: '🎨', label: 'Livery', sub: dirty ? 'unsaved' : lookName, tone: dirty ? 'hot' : '' },
    ...(c.hopperCap > 0 && !c.wreck ? [{ id: 'hopper', ico: '💧', label: 'Hopper', sub: `${Math.round((c.hopperAmount || 0) / c.hopperCap * 100)}%` }] : []),
    ...(canTune ? [{ id: 'tuning', ico: '🎛', label: 'Tuning', sub: tuneDirty ? 'unsaved' : tuned ? 'tuned' : 'stock', tone: tuneDirty ? 'hot' : '' },
                   { id: 'kits', ico: '⚙', label: 'Kits', sub: `${fitted} of ${(c.kitCatalog || []).length}` }] : []),
    ...(c.configurable ? [{ id: 'weight', ico: '⚖', label: 'Load', sub: `${c.seatsNow} seat${c.seatsNow === 1 ? '' : 's'}` }] : []),
  ];
  if (!cards.some(t => t.id === B.benchTab)) B.benchTab = cards[0].id;
  const body = B.benchTab === 'hull' ? hullTabHtml(c)
    : B.benchTab === 'fuel' ? fuelTabHtml(c)
    : B.benchTab === 'hopper' ? hopperTabHtml(c)
    : B.benchTab === 'tuning' ? tuningTabHtml(c)
    : B.benchTab === 'kits' ? kitsTabHtml(c)
    : B.benchTab === 'weight' ? weightTabHtml(c)
    : paintTabHtml(c, cat, dirty);
  return { jobs: jobsHtml(cards, B.benchTab, 'data-bench-tab'), body, dirty };
}

// ── Render dispatch ─────────────────────────────────────────────────────────
// The counter's screens and their head: the two you choose between are in the head's segment; the
// rest (the bench, the walk-round, the charter map) are reached from a card and go back to it.
const COUNTER_TITLE = { floor: 'Your aircraft', buyrent: 'Buy or rent', bench: 'Maintenance', inspect: 'Walk round', charter: 'Charter' };
function render() {
  if (!B) return;
  // setAreaPane rebuilds #hb-root, so drop any live colour popover first — otherwise
  // cpState would point at a detached node (it no longer self-closes on outside click).
  closeColorPicker({ silent: true });
  if (B.service) { renderService(); return; }
  const d = B.data || {};
  const body = B.screen === 'charter' ? charterScreen() : B.screen === 'buyrent' ? buyRentScreen() : B.screen === 'bench' ? benchScreen() : B.screen === 'inspect' ? inspectScreen() : floorScreen();
  const screens = [['floor', 'Your aircraft', '✈'], ...(d.canBuy || d.canRent ? [['buyrent', d.canBuy && d.canRent ? 'Buy or rent' : d.canBuy ? 'Buy' : 'Rent', '⊕']] : [])];
  const top = B.screen === 'floor' || B.screen === 'buyrent';
  setAreaPane(`<div id="hb-root" class="ds-root ds-counter hb-scope" role="region" aria-label="${esc(d.field || 'Hangar')}">
    ${headHtml({ ico: '✈', title: d.field || 'Hangar', sub: top ? '' : COUNTER_TITLE[B.screen], credits: d.credits,
      screens: top ? screens : null, screen: B.screen, back: top ? '' : 'Hangar' })}
    <div class="hb-body">${body}</div>
  </div>`);
  const root = document.getElementById('hb-root');
  root.addEventListener('click', onShellClick);
  wire();
  armHolds(root, sendCmdSilent);
  startSpin();
  if (B.screen === 'floor') { requestAnimationFrame(paintFloorCards); watchSize(); }
  // The tuning radar/knobs/bars aren't part of startSpin's canvas set — draw them
  // once here after the DOM is built; knob drags repaint them on the fly.
  if (B.screen === 'bench' && B.benchTab === 'tuning') paintTuning();
}

// The shell's keys: the head's screens, back, close, the two view toggles, and the docked bench's
// fold and unfold. Closing from inside the walk-in hangar walks you out of it (the move closes the
// panel from the server side); from the open ramp it just puts the panel away.
function onShellClick(e) {
  if (!B) return;
  // Every key here sends its verb from its own handler; this remembers which one it was, so the
  // purchase moment can name what the money went on when the push comes back (depot-shell notePush).
  const key = e.target.closest?.('button');
  if (key && !key.closest('[data-ds]')) noteAct(key);
  shellClick(e, {
    screen: (s) => go(s),
    back: () => go('floor'),
    close: () => { if (B.data.inHangar) sendCmdSilent(B.data.exitDir || 'out'); else { closeHangarBay(); sendCmdSilent('look'); } },
    fold: () => { B.open = false; render(); },
    open: () => { B.open = true; render(); },
  });
}

// ── The bench on the cockpit ─────────────────────────────────────────────────
// The bench's jobs and pages in the shell's bay, on the cockpit's glass. The cockpit's chase camera
// is the stage: each job swings it to the part it works on, the livery's Cabin page sits you in the
// seat to see a retrim where it is worn, and the working paint rides on her until it is applied.
const SHOT_FOR = { hull: 'quarter', fuel: 'side', paint: 'quarter', hopper: 'side', tuning: 'low', kits: 'front', weight: 'high' };
function renderService() {
  const ck = CK;
  const host = ck?.cockpitServiceHost();
  if (!host) { closeHangarBay(); return; }
  const el = mountBay(host, 'hb-svc', { click: onShellClick });
  setBayOpen(el, B.open, 'hb-scope');
  const d = B.data || {}, c = (d.craft || []).find(x => x.id === B.selId);
  if (!B.open || !c) {
    el.innerHTML = bayChipHtml(`⚙ ${d.field || 'Hangar'} · the bench`);
    syncCockpitView(ck, null, c);
    return;
  }
  const { jobs, body } = benchParts(c);
  const radar = B.benchTab === 'tuning' ? '<canvas id="hb-perf-radar" class="hb-svc-radar" width="220" height="200"></canvas>' : '';
  el.innerHTML = bayHtml({
    ico: '⚙', title: d.field || 'Hangar', sub: `${c.tail} · ${c.typeName}`, name: c.typeName || c.tail || '', credits: d.credits,
    actions: leaveHtml('Taxi out'),
    notes: c.rental ? '<div class="ds-note hire">Rental · maintenance is bundled in; she flies stock</div>' : '',
    jobs,
    body: `<div class="hb-bench-tabbody" data-tabkey="${B.benchTab}">${radar}${body}</div>`,
    foot: d.hangar ? 'Start up and roll at the door and it lifts. The bench goes when she moves.' : 'The bench goes when she moves.',
  });
  wire();
  armHolds(el, sendCmdSilent);
  if (B.benchTab === 'tuning') paintTuning();
  syncCockpitView(ck, B.open ? B.benchTab : null, c);
}

// Which camera, and what is on her. Outside on every job but the livery's Cabin page; the shot only
// moves on a change of job, so a re-push after a purchase leaves the camera where the pilot put it.
function syncCockpitView(ck, tab, c) {
  if (!ck) return;
  try {
    if (!tab) {
      if (B.view) { ck.cockpitView(B.view); B.view = null; }
      B.shot = null;
      // Folded, she wears what she has been painted (see closeHangarBay for why not null).
      ck.cockpitPreview({ livery: c?.livery || null });
      return;
    }
    const inside = tab === 'paint' && B.paintTab === 'cabin';
    if (B.view == null) B.view = ck.cockpitView();
    const shot = inside ? 'cab' : (tab === 'paint' && B.paintTab === 'paint' ? 'side' : SHOT_FOR[tab] || 'quarter');
    if (shot !== B.shot) {
      if (inside) ck.cockpitView('cab');
      else {
        // In a GLASS hangar the eye stays at the standoff (the renderer clamps a smaller zoom to it).
        const s = SHOTS[shot];
        ck.cockpitFrame(B.data.hangar ? { ...s, zoom: 0.01 } : s, B.shot == null ? 900 : 700);
      }
      B.shot = shot;
    }
    // The work copy itself, not a snapshot: the colour wheel writes into it as it drags, and the
    // renderer reads the preview every frame, so she changes colour under the cursor.
    ck.cockpitPreview({ livery: c ? B.work : null });
  } catch { /* a cockpit without the hooks is a cockpit without the preview */ }
}

// The live bench: docked on the cockpit, or the counter in the pane.
const benchRoot = () => document.getElementById(B?.service ? 'hb-svc' : 'hb-root');

function wire() {
  const root = benchRoot(); if (!root) return;
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
    let last = null, travel = 0;
    stage3d.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; travel = 0; stage3d.setPointerCapture(e.pointerId); B.orbit.held = true; });
    stage3d.addEventListener('pointermove', (e) => {
      if (!last) return;
      travel += Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y);
      B.orbit.a -= (e.clientX - last.x) * 0.008;
      B.orbit.h = Math.max(0.05, Math.min(1.4, B.orbit.h + (e.clientY - last.y) * 0.006));
      last = { x: e.clientX, y: e.clientY };
    });
    const up = () => { last = null; B.orbit.held = false; };
    // A press that never became a drag is a click: in the booth it stops or starts the turntable.
    stage3d.addEventListener('pointerup', () => { if (last && travel < 5 && boothOn()) B.orbit.still = !B.orbit.still; up(); });
    stage3d.addEventListener('pointercancel', up);
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
    // (Close, back in the head and the two view toggles are the shell's: onShellClick.)
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
    // THE CARD SEATS YOU, the way the depot's and the marina's do: `hangaract service` boards her on
    // the hangar floor (on her pad where the field has no hangar) with the bench on the cockpit. The
    // counter stays up until the server's push for the docked bench takes it down (openService), so
    // a refusal (not yours, not parked here) re-pushes the counter instead of leaving a blank pane.
    if (act === 'service') { noteAct(e.currentTarget); sendCmdSilent(`hangaract service ${idOf()}`); return; }
    // Fly: into the seat, nose to the door, no bench. `hangaract launch` where the server boards for
    // the bench (cockpitBench), the plain verb otherwise.
    if (act === 'embark') {
      const id = e.currentTarget.getAttribute('data-id');
      sendCmdSilent(B.data.cockpitBench && id ? `hangaract launch ${id}` : `embark ${e.currentTarget.getAttribute('data-tail')}`);
      closeHangarBay(); return;
    }
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
    if (!root) { raf = null; suppressWeatherFx(false, 'hangar'); return; }   // the pane was repainted out from under the bay
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
        // A click on the booth stops her turning and another starts her again (`o.still`); the
        // spin is an accumulated angle so she stops exactly where she was, not on a time jump.
        const still = o.still && boothOn();
        if (!o.held && !still) { o.a += dt * 0.12; o.spin = (o.spin || 0) + dt * 0.35; }
        const armed = sc.class === 'heli' && sc.hardpoints > 0;
        const R = Math.min(5.6, (1.9 + 1.05 * (MODEL_SCALE[sc.class] || 1) * (armed ? 1.8 : 1)) * o.r);
        const x = Math.cos(o.a) * R, y = Math.sin(o.a) * R, z = 0.05 + o.h * 1.6;
        const cam = { x, y, z, yaw: Math.atan2(-y, -x), pitch: -Math.atan2(z - 0.05, R) * 0.9, fov: 1 };
        ctx.setTransform(stage3d._dpr, 0, 0, stage3d._dpr, 0, 0);
        if (boothOn()) {
          const armedZ = armed ? 0.55 : 1;
          drawPaintBooth(ctx, { cls: sc.class, armed, wreck: !!sc.wreck, variant: liveVariant(B.work), livery: B.work || sc.livery,
            w: stage3d._cw, h: stage3d._ch, time: t / 1000, spin: o.spin || 0, yaw: -o.a * 2, zoom: 1.45 * armedZ, fit: 1.4 });
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
  st.textContent = HANGAR_CSS;
  document.head.appendChild(st);
}
