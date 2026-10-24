// THE LONG HAUL — the depot: a hand of cards at the counter, and a bench that comes to the cab.
//
// This was a pane app with a 3-D garage in it: every rig you own parked in a painted shed, a
// walkaround camera, a dealer's lot and a mechanic's bench, all standing in for a building the game
// already had. `drive` has put you inside the REAL shed for a long time now (the depot's facade
// tile, drawn by GLASS as a roofed bay with a roller door you roll up by driving at it), so the
// painted garage was a second picture of a place you were one click from sitting in. It is gone.
//
// What is left splits the way the job does:
//
//   THE COUNTER (yard mode, in the pane) is where you choose. Your trucks as a hand of cards — the
//       truck on one of three backdrops, its name, and whether it is yours or hired — then a card
//       to buy one and a card to hire one. Picking a truck is `drive <id>`, which seats you in it.
//
//   THE BAY (service mode, over the glass) is where you work on it. The moment the cab opens in the
//       shed, the server pushes this same payload with `service: true` and it lands as an overlay
//       on the windscreen: servicing, repairs, the pump, tuning, kits, paint, fittings, the inside,
//       the horn and plate, the freight board and the exchange. "Drive out" is the throttle — roll
//       at the door and it lifts, and the overlay goes when the truck leaves the shed.
//
// THE THREE RULES THIS FILE HAS ALWAYS HAD STILL HOLD, AND MATTER MORE IN THE CAB:
//
//  1. THE CLIENT COMPUTES NOTHING. Prices, bands, service life, the hire clock — every one arrives
//     as a fact. What this file decides is where a rectangle goes.
//
//  2. EVERY BUTTON IS A VERB STRING A PLAYER COULD HAVE TYPED. `drive truck_ab12`, `yard rent
//     drayman`, `rig service truck_ab12 oil`, `rig horn truck_ab12 chime`. The log rung is not a
//     second implementation of the depot; it is the same verbs without the cardboard.
//
//  3. THE PANEL NEVER GUESSES WHAT CHANGED. Every mutating command re-pushes the whole payload (in
//     the bay, straight into the overlay — see `repush` in plugins/trucking/index.js), and this file
//     simply redraws.

import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { drawWireframe3D, themeColor } from './wireframe-plane.js';
import { truckLivery } from './aircraft3d.js';
// ⚠ THE DERIVATION, NOT A CATALOGUE. Everything else this panel draws comes off the wire (see the
// ⚠ in paintTab) — but a mixed interior is previewed while the player is still dragging the well,
// so there is no committed value for the server to have sent. This is the same function the cab
// renderer resolves a mixed colourway through, imported rather than reimplemented, which is what
// makes the picture and the cab provably the same three-picks-to-fourteen-values arithmetic.
import { customColourway, CUSTOM_COL } from '../../../shared/cab-trim.js';
import { suppressWeatherFx } from './weather-fx.js';
import { compactHidePanel } from '../../../shared/compact-view.js';
import { paintVehicleCard, paintSlotCard, cardStyleFor, cardSeed, ensureCardStyles, barTone } from './vehicle-card.js';
import { airHorn } from './engine-audio.js';
// The cab this overlay sits on. ⚠ ONLY EVER ASKED, NEVER DRIVEN: the overlay reads which view is up
// and can hand the chase camera a paint job to preview, and that is the whole of the coupling.
import { cabServiceHost, cabPreview, cabView, cabFrame, cabRev } from './cab-view.js';
// The chrome every depot shares: the head, the job tiles, the bay, holds and the purchase moment.
import { ensureDepotStyles, headHtml, jobsHtml, mountBay, setBayOpen, bayHtml, leaveHtml, bayChipHtml, toastHtml,
  statsHtml, serviceListHtml, armHolds, shellClick, clearViewModes, noteAct, notePush, money, readyHtml } from './depot-shell.js';
import { SHOTS } from './camera-tween.js';
import { garageBed } from './garage-ambience.js';
import { escapeHtml as esc, loadCss } from '../../../shared/dom.js';

// truck-depot.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const DEPOT_CSS = await loadCss(new URL('./truck-depot.css', import.meta.url));

let B = null;            // { mode: 'yard'|'service', data, screen, selId, bench, toast, open }
let raf = null;
let yaw = 0;
let toastT = null;
let ro = null;

// Icon + label chip, the hangar's `tbtn` verbatim (hangar-bay.js): the glyph is decoration and the
// word beside it is the button's real name, so the icon is hidden from the accessible tree —
// otherwise "Sell" is announced as "credit Sell".
const tbtn = (icon, label, attrs = '', cls = '') =>
  `<button class="td-act${cls ? ' ' + cls : ''}" ${attrs}><span class="td-ico" aria-hidden="true">${icon}</span>${label}</button>`;
const pct = (n) => `${Math.round((n || 0) * 100)}%`;

// Which screen a server-sent tab lands on in the YARD. The server thinks in tabs because the log
// rung does; the counter has three screens and the rest of what the tabs name now lives in the bay.
const SCREEN_FOR_TAB = { fleet: 'lot', buy: 'buy', rent: 'rent' };

// The bay's tabs. ⚠ THE CUSTOMISING ONES ARE NOT OFFERED ON A HIRE TRUCK, because the verb behind
// every one of them refuses it (bench.js RENTAL_BARRED) — a tab full of buttons that all say no is
// worse than no tab.
const SVC_TABS = [
  ['service', 'Service', '⚙'], ['tune', 'Tuning', '⌥'], ['kits', 'Kits', '⊞'], ['paint', 'Paint', '◐'],
  ['fits', 'Fittings', '⚑'], ['cab', 'Inside', '◇'], ['badge', 'Horn & plate', '📯'],
  ['freight', 'Freight', '▤'], ['market', 'Exchange', '₵'],
];
const HIRE_OK = new Set(['service', 'freight', 'market']);
// THE CAMERA FOLLOWS THE TAB, the way a garage menu swings round to the part you are buying: the
// flank for fittings and graphics, the tail for the plate and the deck, low at the nose for what
// is under the hood. The cab tab (and the booth's interior) sit you in the seat instead.
const SHOT_FOR = { service: 'quarter', tune: 'low', kits: 'front', paint: 'quarter', fits: 'side', badge: 'rear',
  freight: 'rear', market: 'quarter' };
// The bars every truck screen draws, in this order.
const STAT_ROWS = [['pull', 'Pull'], ['speed', 'Speed'], ['stop', 'Stopping'], ['turn', 'Turn-in'], ['range', 'Range']];

export function isTruckDepotActive() { return !!B && B.mode === 'yard'; }

// ── Opening ──────────────────────────────────────────────────────────────────
export function openTruckDepot(msg) {
  ensureCardStyles();
  // The bay's payload is the same object with one flag on it (plugins/trucking/index.js
  // pushBayService); where it goes is the only thing that differs.
  if (msg?.service) return openBayService(msg);
  ensureStyles();
  ensureDepotStyles();
  const first = !B || B.mode !== 'yard';
  const spentFrom = first ? null : B.data?.credits;
  if (B && B.mode !== 'yard') closeTruckDepot();
  // THE OVERLAY IS AN OUTDOOR EFFECT AND THIS IS A COUNTER. The weather FX layer is pinned over
  // #area-pane, not over the room — so with the depot mounted it rained on the paperwork. Same hard
  // override the cockpit takes when it owns the pane, released in closeTruckDepot.
  suppressWeatherFx(true, 'depot');
  if (first) document.getElementById('area-pane')?.dispatchEvent(new CustomEvent('lookpaneauto'));
  if (first) compactHidePanel('ds-hidepanel');
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told; an app that mounts there has to say so
  const keep = first ? null : B;
  B = {
    mode: 'yard',
    data: msg,
    // A push that names a truck you just bought or hired lands on the hand, where its key is.
    screen: msg.fresh ? 'lot' : SCREEN_FOR_TAB[msg.tab] || keep?.screen || 'lot',
    selId: null,
    bench: { tab: 'service', psec: 'scheme', fslot: null, cslot: null, tune: null, paint: null, trim: null },
    lotSel: keep?.lotSel || null,
    boxSel: (msg.trailers || []).some(t => t.id === keep?.boxSel) ? keep.boxSel : (msg.trailers || [])[0]?.id || null,
    toast: keep?.toast || null,
  };
  document.addEventListener('keydown', onKey);
  render();
  if (spentFrom != null) notePush(document.getElementById('td-root'), spentFrom, msg.credits);
}

// THE BAY. Mounted into the cab's own wrapper rather than the pane, which the cab owns while you
// are in it — so this never calls `setAreaPane` and never claims the pane.
export function openBayService(msg) {
  ensureStyles();
  ensureDepotStyles();
  const host = cabServiceHost();
  if (!host) return;              // no cab under it (a text driver, or the cab already shut) — nothing to sit on
  const was = B && B.mode === 'service' ? B : null;
  const wasCargo = was?.data?.cargo || null;
  B = {
    mode: 'service',
    data: msg,
    screen: 'service',
    selId: msg.serviceId || msg.drivingId || null,
    // ⚠ THE TAB SURVIVES THE RE-PUSH THAT EVERY PURCHASE TRIGGERS, or buying a fitting would throw
    // you back to Service between the click and the next one.
    bench: was?.bench || { tab: 'service', psec: 'scheme', fslot: null, cslot: null, tune: null, paint: null, trim: null },
    toast: was?.toast || null,
    // Open on arrival, and after that it is the player's: a push that re-opened a panel somebody
    // had just folded away would make "drive out" a button that does not stay pressed.
    open: was ? was.open : true,
    view: was?.view ?? null,
    shot: was?.shot,
  };
  B.bench.tune = null; B.bench.trim = null;
  if (!was) B.bench.paint = null;
  // A hire truck has only the tabs that do something to it.
  if (hired() && !HIRE_OK.has(B.bench.tab)) B.bench.tab = 'service';
  if (was) noteDeckChange(wasCargo, msg.cargo || null);
  if (!was) garageBed('shed');
  renderService();
  if (was && notePush(document.getElementById('td-svc'), was.data?.credits, msg.credits)) {
    // A kit or a tune going on is a thing a driver hears: blip it.
    const t = selected(), w = (was.data?.fleet || []).find((r) => r.id === t?.id);
    if (t && w && (JSON.stringify(t.kits) !== JSON.stringify(w.kits) || JSON.stringify(t.tune) !== JSON.stringify(w.tune))) cabRev(0.7);
  }
}

/** The truck has left the shed (or the cab has shut): take the overlay down and hand the camera back. */
export function closeBayService() {
  if (!B || B.mode !== 'service') return;
  restoreView();
  try { cabPreview({ paint: null, trim: null }); } catch { /* the cab can already be gone */ }
  document.getElementById('td-svc')?.remove();
  garageBed(null);
  if (toastT) clearTimeout(toastT);
  toastT = null;
  B = null;
}

// ── The notice ───────────────────────────────────────────────────────────────
// TAKING A LOAD WAS INVISIBLE ON THE SCREEN YOU TOOK IT FROM. `haul` wrote a line into the log and
// re-pushed the panel, and the board redrew IDENTICALLY — so the only evidence was in the
// scrollback, which is the half of the screen a player deep in a pane app is not reading. Nothing
// here guesses what changed: the deck is a fact on the payload and the only thing derived is that it
// is DIFFERENT from the fact in the previous push. ⚠ Deliberately NOT a live region — the same
// words already reached #output, which IS one.
function noteDeckChange(was, now) {
  const key = (c) => (c ? `${c.kind || 'job'}|${c.name}|${c.qty || ''}|${c.to || ''}` : '');
  if (key(was) === key(now)) return;
  if (now) {
    showToast(now.kind === 'goods'
      ? `Loaded: ${now.qty} × ${now.name}, ${now.kg} kg on the deck`
      : `Loaded: ${now.name}, ${now.kg} kg for ${now.to}`, 'good');
  } else if (was) {
    showToast(`Deck clear: ${was.name} is off the truck`);
  }
}

function showToast(text, kind = '') {
  if (!B) return;
  B.toast = { text, kind };
  const mine = B.toast;
  if (toastT) clearTimeout(toastT);
  // One timer, and it re-renders once on the way out. The fade itself is CSS on the same 5.2s, so
  // there is no second clock to keep in step with this one.
  toastT = setTimeout(() => { toastT = null; if (B && B.toast === mine) { B.toast = null; redraw(); } }, 5200);
}

export function closeTruckDepot() {
  if (B?.mode === 'service') return closeBayService();
  suppressWeatherFx(false, 'depot');
  window.dispatchEvent(new Event('pane:released'));  // hand the collapsed pane back to the phone layout
  if (raf) cancelAnimationFrame(raf);
  if (toastT) clearTimeout(toastT);
  if (ro) { ro.disconnect(); ro = null; }
  raf = null; toastT = null;
  document.removeEventListener('keydown', onKey);
  // Drop the immersive layout, or the room look that follows is left with no log and no command
  // box — the hangar learned this one the hard way and clears both classes on the way out too.
  clearViewModes();
  document.getElementById('td-root')?.remove();
  B = null;
}

const selected = () => (B?.data.fleet || []).find(t => t.id === B.selId) || null;
const hired = () => !!selected()?.rental;
const redraw = () => (B?.mode === 'service' ? renderService() : render());

// ── The counter ──────────────────────────────────────────────────────────────
// A PANE APP, not a modal over one: the log and the command box stay live underneath, because every
// button here is a command and the log is where its reply lands. It carries the same ⊟/⛶ immersive
// toggles the sim and the hangar carry, and backs out one screen at a time on Escape.
function render() {
  if (!B || B.mode !== 'yard') return;
  const d = B.data;
  const screens = [['lot', 'Your trucks', '⌂'], ['buy', 'For sale', '⊕'], ['rent', 'Hire', '⟲']];
  setAreaPane(`<div id="td-root" class="ds-root ds-counter" role="region" aria-label="${esc(d.depot)}">
    ${headHtml({ ico: '⛟', title: d.depot, sub: d.regionName || '', credits: d.credits, screens, screen: B.screen })}
    <div class="td-body">${B.screen === 'buy' ? buyScreen() : B.screen === 'rent' ? rentScreen() : lotScreen()}</div>
    ${toastHtml(B.toast)}
    <footer class="ds-foot">${footChips()}</footer>
  </div>`);
  wire();
  armHolds(document.getElementById('td-root'), sendCmdSilent);
  startSpin();
  // The cards are painted once the pane has laid them out — a canvas with no box has nothing to
  // be sized to — and again whenever the pane changes size.
  requestAnimationFrame(paintCards);
  watchSize();
}

// The footer is the PLACE's: the bunkroom, which is the one room in a depot that is not about
// trucks. Everything that is about a truck is on its card or in the bay.
function footChips() {
  const d = B.data;
  const out = [];
  // ⚠ THE CHIP RUNS A DIRECTION, and that is the whole reason the server sends one instead of a
  // zone id: there is no `bunkroom` verb to type. Dim rather than absent out on the apron: the door
  // is real and it is fifteen feet away, and a button that disappears reads as a bug in the button.
  if (d.bunk) {
    out.push(d.bunk.here
      ? `<button class="td-verb" data-cmd="${esc(d.bunk.dir)}">bunkroom · ${esc(d.bunk.dir)}</button>`
      : '<button class="td-verb" disabled title="Off the shed floor, get inside first">bunkroom</button>');
  }
  out.push('<span class="td-dim td-foot-note">Pick a truck and you are in it, in the shed. The bench is in there with you.</span>');
  return out.join('');
}

// setAreaPane replaces the subtree, so the delegated handlers are attached to the FRESH #td-root
// after every render. They cannot accumulate: the node they are bound to is thrown away with them.
function wire() {
  const root = document.getElementById('td-root');
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
}

function watchSize() {
  if (ro || typeof ResizeObserver === 'undefined') return;
  const pane = document.getElementById('area-pane');
  if (!pane) return;
  let t = 0;
  ro = new ResizeObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(paintCards); });
  ro.observe(pane);
}

// ── THE HAND ─────────────────────────────────────────────────────────────────
// One card per truck you have — owned or hired — then one to buy and one to hire. The card is the
// button that seats you: `drive <id>`, the verb the old "Take it out" key sent. What else you can do
// to a truck from the counter is on a strip under its picture, and every one of those is gated on a
// fact the server sent.
//
// ⚠ A TRUCK AT ANOTHER YARD IS SHOWN, FADED, NOT HIDDEN. The hand is what you own, and hiding a card
// says you do not own it; faded, it says where it is and offers the tow home.
function lotScreen() {
  const d = B.data, fleet = d.fleet || [];
  const cards = fleet.map((t) => {
    const here = t.hereNow && !t.impound;
    const style = cardStyleFor(t.id);
    const badge = t.rental
      ? `<span class="vc-badge hired" title="Hired: ${esc(t.rental.leftText)}">HIRED · ${esc(t.rental.leftText)}</span>`
      : '<span class="vc-badge owned">OWNED</span>';
    const sub = t.impound ? '<span class="td-warn">IMPOUNDED</span>'
      : here ? `${esc(t.type)} · fuel ${pct(t.fuel)}` : `at ${esc(t.whereName || 'another yard')}`;
    const acts = [
      !t.hereNow ? `<button class="vc-mini" data-hold="yard recall ${esc(t.id)}" title="Bring it here on a low-loader">Tow home · ${money(t.recall)}</button>` : '',
      t.hereNow && !t.rental ? `<button class="vc-mini" data-hold="yard sell ${esc(t.id)}" title="Sell ${esc(t.name)}">Sell · ${money(t.resale)}</button>` : '',
      t.hereNow && t.rental ? `<button class="vc-mini" data-hold="yard return ${esc(t.id)}" title="Hand it back early, no refund">Hand it back</button>` : '',
    ].filter(Boolean).join('');
    return `<div class="vc-wrap${here ? '' : ' away'}${t.id === d.fresh ? ' fresh' : ''}">
      <button class="vc-card ${style}" data-cmd="${here ? `drive ${esc(t.id)}` : ''}" ${here ? '' : 'disabled'}
          aria-label="${esc(`${t.name}, ${t.type}, ${t.rental ? 'hired' : 'owned'}${here ? ': climb in' : ''}`)}"
          title="${here ? 'Climb in: you start in the shed' : esc(t.impound ? 'Impounded' : `At ${t.whereName || 'another yard'}`)}">
        <canvas class="vc-cv" data-card="${esc(t.id)}" aria-hidden="true"></canvas>
        ${badge}
        <span class="vc-plate"><b>${esc(t.name)}</b><span class="vc-sub">${sub}</span>
          <span class="vc-bar" title="condition ${pct(t.condition)}"><i class="${barTone(t.condition)}" style="width:${Math.round(t.condition * 100)}%"></i></span></span>
      </button>
      ${acts ? `<div class="vc-acts">${acts}</div>` : ''}
    </div>`;
  }).join('');
  // Anything else of yours kept in this shed (a racer, say), from the server's `depot.parked` hook.
  // Each card carries its own verb and its own picture, so this file knows nothing about racers.
  const guests = (d.parked || []).map((v) => `<div class="vc-wrap">
      <button class="vc-card ${cardStyleFor(v.id)}" ${v.cmd ? `data-cmd="${esc(v.cmd)}"` : 'disabled'}
          aria-label="${esc(`${v.name}, ${v.typeName}${v.cmd ? ': ' + v.verb.toLowerCase() : ''}`)}"
          title="${esc(v.cmd ? `${v.verb}: it comes out through the shed door` : v.sub)}">
        <canvas class="vc-cv" data-guest="${esc(v.id)}" aria-hidden="true"></canvas>
        ${v.hire ? `<span class="vc-badge hired">HIRED · ${esc(v.hire)}</span>` : '<span class="vc-badge owned">OWNED</span>'}
        <span class="vc-plate"><b>${esc(v.name)}</b><span class="vc-sub">${esc(v.sub)}</span>
          <span class="vc-bar"><i class="${barTone(v.cond)}" style="width:${Math.round(v.cond * 100)}%"></i></span></span>
      </button>
    </div>`).join('');
  const buyCard = `<div class="vc-wrap"><button class="vc-card slot" data-screen="buy" aria-label="Buy a truck">
      <canvas class="vc-cv" data-slot="buy" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>Buy a truck</b><span class="vc-sub">${(d.stock || []).length} on the line</span></span></button></div>`;
  const hireCard = `<div class="vc-wrap"><button class="vc-card slot" data-screen="rent" aria-label="Hire a truck">
      <canvas class="vc-cv" data-slot="rent" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>Hire a truck</b><span class="vc-sub">${d.hasRental ? 'one out already' : 'by the day, back at any yard'}</span></span></button></div>`;
  // The truck you just bought or hired, and one key into it: the card's own verb.
  const nu = fleet.find((t) => t.id === d.fresh && t.hereNow && !t.impound);
  const ready = nu ? readyHtml({ title: nu.rental ? `${nu.name}, yours for ${nu.rental.leftText}.` : `The ${nu.name} is yours.`,
    sub: `In the shed, fuel ${pct(nu.fuel)}.`, label: 'Drive it', cmd: `drive ${nu.id}` }) : '';
  return `<div class="td-col td-lot-col">
      ${ready}
      ${fleet.length || guests ? '' : '<div class="td-hint">Nothing of yours in the shed. Buy one, or hire one for the afternoon.</div>'}
      <div class="vc-hand">${cards}${guests}${buyCard}${hireCard}</div>
      ${boxList()}
    </div>`;
}

// The boxes you own, as a list — a trailer is a capacity and a place, and neither of those is a thing
// you look at on a card. Coupling one is done from the cab (the bay has the pin key); selling one is
// done from here.
function boxList() {
  const mine = B.data.trailers || [];
  if (!mine.length) return '';
  return `<div class="td-deck td-boxes"><span class="td-lab">Your boxes</span>
    ${mine.map(t => `<div class="td-box-row${t.id === B.boxSel ? ' on' : ''}" data-box="${esc(t.id)}">
      <span class="td-box-what"><b>${esc(t.name)}</b> <span class="td-dim">· ${t.ratedKg} kg
        · ${t.towedBy ? 'on the pin' : t.hereNow ? 'standing here' : `at ${esc(t.where)}`}${t.cargo ? ` · loaded: ${esc(t.cargo.name)}` : ''}</span></span>
      ${t.canSell ? `<button class="td-act" data-hold="yard sell ${esc(t.id)}" title="Sell ${esc(t.name)}">Sell · ${money(t.resale)}</button>` : ''}
      ${!t.canSell && (t.hereNow || t.towedBy) && t.loaded ? '<span class="td-dim td-box-why">empty it to sell it</span>' : ''}
    </div>`).join('')}
    ${boxDetail(mine)}
  </div>`;
}

// ⚠ A BOX IS A VEHICLE YOU OWN, so it answers the same three questions a truck does — what it is,
// where it is, and what state it is IN. The band words are the SERVER'S: a label table on the client
// is a second copy of BANDS waiting to drift.
function boxDetail(mine) {
  const t = mine.find(r => r.id === B.boxSel);
  if (!t) return '';
  // ⚠ 'loaded' WITHOUT 'cargo' IS A STASH, AND THE STASH IS THE POINT OF THE STASH. The server
  // tells this panel that the box is not empty and deliberately does not say what is in it.
  const load = t.cargo ? `${esc(t.cargo.name)} · ${t.cargo.kg} kg` : t.loaded ? 'carrying something' : 'empty';
  return `<div class="td-box-detail">
    <div class="td-main"><b>${esc(t.name)}</b><span class="td-dim"> · ${esc(t.bandLabel || t.band || '')} · ${pct(t.condition)}</span></div>
    ${t.bandText ? `<div class="td-dim td-note">${esc(t.bandText)}</div>` : ''}
    <div class="td-box-stats">
      <span class="td-dim">Rated <b>${t.ratedKg} kg</b></span>
      <span class="td-dim">Empty <b>${t.kg} kg</b></span>
      <span class="td-dim">${t.towedBy ? 'On the pin' : t.hereNow ? 'Standing here' : esc(t.where)}</span>
      <span class="td-dim">Load <b>${load}</b></span>
    </div>
  </div>`;
}

// ── THE HIRE LINE ────────────────────────────────────────────────────────────
// The same hand, dealt from the desk's stock: a card per model with its fee on the key. The truck on
// it is in the stock livery because that is what the desk hands you.
function rentScreen() {
  const d = B.data;
  const cards = (d.rentStock || []).map((t) => {
    const why = d.hasRental ? 'You already have one out on hire' : t.afford ? '' : "You can't afford it";
    return `<div class="vc-wrap">
      <div class="vc-card ${cardStyleFor('hire:' + t.id)} static">
        <canvas class="vc-cv" data-rent="${esc(t.id)}" data-variant="${esc(t.variant)}" aria-hidden="true"></canvas>
        <span class="vc-badge hired">FOR HIRE</span>
        <span class="vc-plate"><b>${esc(t.name)}</b><span class="vc-sub">${t.kg} kg deck · ${t.top} mph · ${t.hours} hours</span></span>
      </div>
      <div class="vc-acts">${tbtn('⟲', `Hire · ${money(t.fee)}`, `data-cmd="yard rent ${esc(t.id)}" ${why ? `disabled title="${esc(why)}"` : ''}`, 'primary')}</div>
    </div>`;
  }).join('');
  return `<div class="td-col td-lot-col">
      <div class="td-hint">A hire is yours for ${esc(String(d.rentStock?.[0]?.hours ?? 2))} hours and goes back at any yard. It comes serviced and fuelled; paint and parts stay the company's. One at a time.</div>
      <div class="vc-hand">${cards}</div>
    </div>`;
}

// ── THE BAY ──────────────────────────────────────────────────────────────────
// The overlay on the glass. Not a pane app: it is a panel inside the cab's own wrapper, so the road
// is right behind it and the throttle still works while it is up. Folded, it is one chip in the top
// left corner that says where you are.
function renderService() {
  if (!B || B.mode !== 'service') return;
  const host = cabServiceHost();
  if (!host) return;
  const el = mountBay(host, 'td-svc', { click: onClick, input: onInput, mouseover: onPeek, focusin: onPeek });
  const d = B.data, t = selected();
  setBayOpen(el, B.open);
  if (!B.open) {
    el.innerHTML = bayChipHtml(`⚙ ${d.depot} · service bay`);
    syncView();
    return;
  }
  const jobs = SVC_TABS.filter(([k]) => !t?.rental || HIRE_OK.has(k))
    .map(([id, label, ico]) => ({ id, label, ico, ...(t ? jobState(id, t) : {}) }));
  const body = !t ? '<div class="td-none">The truck is not on the books here.</div>'
    : B.bench.tab === 'tune' ? tuneTab(t) : B.bench.tab === 'kits' ? kitsTab(t) : B.bench.tab === 'paint' ? paintTab(t)
    : B.bench.tab === 'fits' ? fitsTab(t) : B.bench.tab === 'cab' ? cabTab(t) : B.bench.tab === 'badge' ? badgeTab(t)
    : B.bench.tab === 'freight' ? freightScreen() : B.bench.tab === 'market' ? marketScreen() : serviceTab(t);
  el.innerHTML = bayHtml({
    ico: '⚙', title: d.depot, sub: t ? t.name : 'service bay', credits: d.credits,
    actions: leaveHtml('Drive out'),
    notes: (t?.rental ? `<div class="ds-note hire">Hire truck · ${esc(t.rental.leftText)} · back at any yard: <b>park</b> in a shed and <b>yard return</b></div>` : '')
      + (d.hitchState ? `<div class="ds-note">${hitchAct(d.hitchState)}</div>` : ''),
    jobs: jobsHtml(jobs, B.bench.tab, 'data-bench'),
    body: `<div class="td-side td-svc-body">${body}</div>`,
    toast: B.toast,
    foot: 'Roll at the door and it lifts. The bay goes when you leave the shed.',
  });
  armHolds(el, sendCmdSilent);
  syncView();
}

// WHAT IS WAITING BEHIND EACH TILE, in a word or two, off the same facts the tab itself draws.
// tone: ok (nothing to do), warn (worth a look), bad (costing you), hot (unsaved on the bench).
function jobState(id, t) {
  const d = B.data;
  if (id === 'service') {
    const items = t.svc?.items || [];
    const over = items.filter((i) => i.band === 'over').length, due = items.filter((i) => i.band === 'due').length;
    if (over) return { sub: `${over} overdue`, tone: 'bad' };
    if (due) return { sub: `${due} due`, tone: 'warn' };
    if ((t.condition ?? 1) < 0.85) return { sub: `body ${pct(t.condition)}`, tone: 'warn' };
    return { sub: 'all good', tone: 'ok' };
  }
  if (id === 'tune') {
    if (B.bench.tune && JSON.stringify(B.bench.tune) !== JSON.stringify(t.tune)) return { sub: 'unsaved', tone: 'hot' };
    return { sub: Object.values(t.tune || {}).some((v) => Math.abs(v) > 0.001) ? 'tuned' : 'stock' };
  }
  if (id === 'kits') return { sub: `${(t.kits || []).length} of ${(d.kitCatalog || []).length}` };
  if (id === 'paint') return B.bench.paint || B.bench.trim ? { sub: 'unsaved', tone: 'hot' } : { sub: t.paint?.finish || '' };
  if (id === 'fits') return { sub: `${(t.fits || []).length} of ${d.fitCat?.slots?.length ?? 0}` };
  if (id === 'cab') return { sub: `${(t.cab || []).length} of ${d.cabCat?.slots?.length ?? 0}` };
  if (id === 'badge') return { sub: (d.hornCat || []).find((h) => h.id === (t.horn || 'stock'))?.name || '' };
  if (id === 'freight') return d.cargo ? { sub: d.cargo.name, tone: 'ok' } : { sub: 'deck empty' };
  return {};
}

// THE BARS PREVIEW WHAT YOU POINT AT. Hovering or focusing a kit's row redraws the kits tab's bars
// with that kit on, from the `kitStats` the server sent; leaving the list puts them back.
function onPeek(e) {
  if (!B || B.mode !== 'service' || B.bench.tab !== 'kits') return;
  const box = document.querySelector('#td-svc [data-kit-stats]');
  if (!box) return;
  const row = e.target.closest?.('[data-kit-peek]');
  const t = selected(); if (!t) return;
  const id = row && t.kitStats?.[row.dataset.kitPeek] ? row.dataset.kitPeek : '';
  if (box.dataset.peek === id) return;
  box.dataset.peek = id;
  box.innerHTML = statsHtml(STAT_ROWS, id ? t.kitStats[id] : t.stats, id ? t.stats : null);
}

// ── THE CAMERA FOLLOWS THE SHELF ─────────────────────────────────────────────
// Paint and fittings are the outside of the truck and the inside tab is the inside of it — and the
// cab already has both cameras. So the tab you are on picks the one that shows what you are
// buying, and leaving the tab (or the bay) hands back whichever one you had. The paint on the dials
// rides to the chase camera as a PREVIEW (cab-view `cabPreview`): nothing is charged until the
// booth button, and the server's push after it replaces the preview with the real thing.
function syncView() {
  if (!B || B.mode !== 'service') return;
  // The bay shows the truck from outside on every tab but the cab one: you are looking at what you are working on.
  // …and the paint booth's Interior section sits you in the seat, so a retrim is seen where it is worn.
  const inside = B.open && B.bench.tab === 'paint' && B.bench.psec === 'inside';
  const want = !B.open ? null : (B.bench.tab === 'cab' || inside) ? 'cab' : 'ext';
  try {
    const first = want && B.view == null;
    if (first) B.view = cabView();                              // remember what they had, once
    if (want) cabView(want, { quarter: first });
    else restoreView();
    // …and outside, the camera swings to the part the tab sells. Only on a change of tab, so a
    // re-push after a purchase does not yank the camera back off wherever the player dragged it.
    const shot = want === 'ext' ? (B.bench.tab === 'paint' && B.bench.psec === 'graphic' ? 'side' : SHOT_FOR[B.bench.tab] || 'quarter') : null;
    if (shot !== B.shot) {
      if (shot) cabFrame(SHOTS[shot], first ? 900 : 700);
      // Opening the tuning tab gives the engine a blip, the way a garage does when it pulls in.
      if (B.bench.tab === 'tune' && B.shot !== undefined) cabRev(0.4);
      B.shot = shot;
    }
    cabPreview({ paint: B.open && B.bench.tab === 'paint' && B.bench.paint ? paintNow() : null,
      trim: inside && B.bench.trim ? trimNow() : null });
  } catch { /* a cab without the hooks is a cab without the preview */ }
}
function restoreView() {
  if (!B || B.view == null) return;
  try { cabView(B.view); } catch { /* the cab can already be gone */ }
  B.view = null;
}

// ── The service tab ──────────────────────────────────────────────────────────
// What used to be the bench's Condition tab, with the three things that wear from the miles alone
// in front of the three that wear from being hit. Every price is the server's (service.js).
function serviceTab(t) {
  const d = B.data, svc = t.svc || { items: [] };
  // The docket is the shell's, the marina's too; only the fresh line's wording is the road's.
  const rows = serviceListHtml(svc.items.map((i) => (i.band === 'fresh'
    ? { ...i, desc: `About ${i.left.toLocaleString()} tiles before it costs you.` } : i)),
  (i) => `rig service ${t.id} ${i.id}`);
  return `
    <div class="td-pane">
      <div class="td-lab">Servicing</div>
      ${rows}
      <div class="td-acts"><button class="td-act${svc.anyDue ? ' primary' : ''}" data-cmd="rig service ${esc(t.id)} all">Full service · ${money(svc.full)}</button></div>
    </div>
    <div class="td-pane">
      <div class="td-lab">Bodywork and running gear</div>
      <div class="td-gauge"><i class="c${t.band}" style="width:${Math.round(t.condition * 100)}%"></i><span>${pct(t.condition)}</span></div>
      <div class="td-dim td-note">${esc(t.bandText)}</div>
      ${statBars(t.stats)}
      <div class="td-acts col">
        <button class="td-act" data-cmd="rig repair ${esc(t.id)}" ${t.canField ? '' : 'disabled title="Already past what hand tools reach"'}>
          Do it yourself · ${money(t.repairField)}<span class="td-dim">: up to ${pct(0.8)}, and you can botch it</span></button>
        <button class="td-act${t.condition < 0.85 ? ' primary' : ''}" data-cmd="rig repair ${esc(t.id)} shop" ${t.condition >= 0.999 ? 'disabled title="Nothing to do"' : ''}>
          Put it through the shop · ${money(t.repairShop)}<span class="td-dim">: back to new, no roll</span></button>
        <button class="td-act" data-cmd="rig wash ${esc(t.id)}" ${t.washPrice ? '' : 'disabled title="Already clean"'}>
          ${t.washPrice ? `Wash it · ${money(t.washPrice)}` : 'Wash it'}<span class="td-dim">: the paint back, and nothing else</span></button>
      </div>
    </div>
    <div class="td-pane">
      <div class="td-lab">The pump</div>
      <div class="td-gauge"><i class="csound" style="width:${Math.round((d.fuel ?? t.fuel) * 100)}%"></i><span>${pct(d.fuel ?? t.fuel)}</span></div>
      ${d.fuelHere ? `<div class="td-acts"><button class="td-act${(d.fuel ?? t.fuel) < 0.5 ? ' primary' : ''}" data-cmd="rig fuel ${esc(t.id)}" ${(d.fuel ?? t.fuel) < 0.99 ? '' : 'disabled title="Already full"'}>Fill the tanks · ${money(t.refuel)}</button></div>`
        : '<div class="td-dim td-note">No pump at this yard.</div>'}
      <div class="td-dim td-note">${t.odometer.toLocaleString()} tiles on the clock${t.rental ? '' : ` · trade-in ${money(t.resale)}`}</div>
    </div>`;
}

// ── Horn and plate ───────────────────────────────────────────────────────────
// Two things on a truck that are for other people and change nothing about the driving. The plate
// was a verb (`rig name`) with no button anywhere; the horn is new (client/shared/truck-horns.js).
// "Hear it" plays the horn here and now and sends nothing — a noise you are deciding whether to
// buy is not a noise the yard hears.
function badgeTab(t) {
  const cat = B.data.hornCat || [];
  const cur = t.horn || 'stock';
  const rows = cat.map((h) => {
    const p = (t.hornPrices || {})[h.id] ?? h.price, fitted = h.id === cur;
    return `<div class="td-kit-row${fitted ? ' on' : ''}">
      <div class="td-main"><b>${esc(h.name)}</b>${p === 0 && !fitted && h.id !== 'stock' ? '<span class="td-drawer">YOURS</span>' : ''}
        <div class="td-dim">${esc(h.desc)}</div></div>
      <button class="td-act ghost" data-hear="${esc(h.id)}" title="Hear it: nobody else does">▶</button>
      ${fitted ? '<span class="td-fitted">ON THE ROOF</span>'
        : `<button class="td-act" data-cmd="rig horn ${esc(t.id)} ${esc(h.id)}" ${(B.data.credits || 0) >= p ? '' : 'disabled title="You can\'t afford it"'}>${p ? money(p) : 'Put it back on'}</button>`}
    </div>`;
  }).join('');
  return `<div class="td-pane">
      <div class="td-lab">The plate</div>
      <div class="td-plateform"><input class="td-plate-in" type="text" maxlength="28" value="${esc(t.name)}" aria-label="Name on the plate">
        <button class="td-act" data-plate="${esc(t.id)}">Signwrite it</button></div>
      <div class="td-dim td-note">Free, and the yard will paint whatever you tell it to.</div>
    </div>
    <div class="td-pane"><div class="td-lab">The horn</div>${rows}
      <div class="td-dim td-note">Once bought, a horn is this truck's for good and swapping back to it costs nothing.</div></div>`;
}

// Which way the pin goes — the button for `hitchState`, or nothing when there is no cab under you
// and no box standing here. The refusal is a DIM BUTTON WITH THE REASON ON IT rather than an
// absence, because "you are alongside it, not on its pin" is the one thing a driver who cannot see
// why the verb said no actually needs; that is the same shape the freight board's `loadWhy` uses.
// ⚠ THE LABEL IS THE VERB PLUS THE BOX, in that order, because the key is half a two-column bar
// and what gets ellipsised is the END. "Back under a reefer" reads better and loses the word that
// tells you what the button does; "Hitch a reefer" survives being trimmed to "Hitch a ree…" and
// still says it. The full text is on the title either way.
function hitchAct(h) {
  if (!h) return '';
  if (h.verb === 'unhitch') return tbtn('⚯', `Unhitch ${esc(h.name)}`, `data-cmd="unhitch" title="Drop ${esc(h.name)} and pull out from under it"`);
  // ⚠ NOT `primary`, however much it wants to be. On this bar `primary` means "the one thing you
  // came here to do" and it takes a whole row to say so — Take it out, or Tow it home, never both
  // at once. A second one turns a two-row bar into a four-row bar, and the bar is pinned.
  return h.id
    ? tbtn('⚯', `Hitch ${esc(h.name)}`, `data-cmd="hitch ${esc(h.id)}" title="Back under ${esc(h.name)}"`)
    : tbtn('⚯', `Hitch ${esc(h.name)}`, `disabled title="${esc(h.why || '')}"`);
}

const kitName = (id) => (B.data.kitCatalog || []).find(k => k.id === id)?.name || id;

// FIVE BARS, and they are the server's numbers (axesFor in plugins/trucking/index.js). With `prev`
// they show a change: what it adds in green, what it costs as a red ghost.
function statBars(s, prev = null) { return statsHtml(STAT_ROWS, s, prev); }

// THE DIALS' PREVIEW. The server sent the bars at each end of every dial with the others where they
// are (`tuneEnds`); between the committed setting and an end the bars move in a straight line, and
// the dials' moves add. That is close, not exact (the physics multiplies), and the push after the
// commit puts the real numbers back, so a bar can be off by a hair for as long as a slider is held.
function tunePreview(t, cur) {
  const ends = t.tuneEnds, R = B.data.tuneRange || 1;
  if (!ends || !t.stats) return null;
  const out = { ...t.stats };
  for (const [k, e] of Object.entries(ends)) {
    const c = t.tune?.[k] ?? 0, x = cur[k] ?? c;
    if (x === c) continue;
    const to = x > c ? e.hi : e.lo, span = x > c ? R - c : c + R;
    if (!(span > 0)) continue;
    const f = Math.abs(x - c) / span;
    for (const [a] of STAT_ROWS) out[a] += ((to[a] ?? t.stats[a]) - t.stats[a]) * f;
  }
  for (const [a] of STAT_ROWS) out[a] = Math.max(0, Math.min(1, out[a]));
  return out;
}


// ── The dealer's line ────────────────────────────────────────────────────────
// Big cards, big schematics. The old lot drew a 260×104 thumbnail per truck, which for the one
// screen in the system whose entire job is "look at what you could own" was the wrong size by
// about half — you were buying a price and a paragraph.
//
// ⚠ AND THE PRICE IS THE BUY BUTTON. It was printed twice on every card — once in the head and once
// on a key at the bottom — and the key had a row of its own under the specs, so the one thing you
// came to this screen to press was the one thing furthest down it. Merged, the card loses a row, the
// number stops being said twice, and buying is next to the name at the top where a partly-scrolled
// card still shows it.
//
// ⚠ THE SCHEMATIC SHRANK WITH THE CARD, and there is no way round that: the canvas is displayed at
// the column's width, so its buffer aspect IS its height on screen, and `drawWireframe3D` fits the
// rig to whatever frame it is handed. A shorter viewport is a smaller truck. 230 is where that
// trade was left — three cards to a row instead of two, against a schematic about a fifth smaller.
// It is not the letterbox it looks like: at this camera a rig projects very nearly square (measured
// 141×131 for the Krell), so a wide frame buys nothing and the height is the whole budget.
function buyScreen() {
  const d = B.data;
  // One scale for the whole line, taken off the biggest thing on it — see the `fitRef` note in
  // wireframe-plane.js. The top of the range is the reference by DATA (the highest tier the dealer
  // stocks) rather than by a type id written in here, so a new flagship needs no edit.
  const fitRef = (d.stock || []).reduce((a, b) => (a && a.tier >= b.tier ? a : b), null)?.variant || '';
  const cards = (d.stock || []).map(t => `
    <div class="td-lot${t.afford ? '' : ' poor'}${B.lotSel === t.id ? ' on' : ''}" data-lot="${esc(t.id)}">
      <div class="td-lot-head">
        <div class="td-main"><b>${esc(t.name)}</b><div class="td-dim">TIER ${t.tier}</div></div>
        ${tbtn('⊕', `Buy · ${money(t.price)}`, `data-cmd="yard buy ${esc(t.id)}" ${t.afford ? '' : 'disabled title="You can\'t afford it"'}`, 'primary')}
      </div>
      <canvas class="td-wf" width="440" height="230" data-variant="${esc(t.variant)}" data-fit="${esc(fitRef)}" aria-hidden="true"></canvas>
      <div class="td-blurb">${esc(t.blurb)}</div>
      ${statBars(t.stats)}
      <dl class="td-spec">
        <div><dt>deck</dt><dd>${t.kg} kg</dd></div>
        <div><dt>tank</dt><dd>${t.tank}</dd></div>
        <div><dt>top</dt><dd>${t.top} mph</dd></div>
      </dl>
    </div>`).join('');

  // Trailers are bought on the same fence, because a tractor with nothing behind it carries
  // nothing — a buyer who leaves here with only a truck has bought half a rig and does not know it.
  const boxes = (d.trailerStock || []).map(t => `
    <div class="td-row">
      <div class="td-main"><b>${esc(t.name)}</b><span class="td-dim"> · ${t.rated} kg rated · ${t.kg} kg empty</span></div>
      <div class="td-num">${money(t.price)}</div>
      <button class="td-act" data-cmd="yard buy ${esc(t.id)}" ${t.afford ? '' : 'disabled'}>Buy</button>
    </div>`).join('');

  return `
    <div class="td-lots">${cards}
      ${boxes ? `<div class="td-sub-head">Boxes, standing behind the fence</div><div class="td-rows">${boxes}</div>` : ''}
    </div>`;
}


// The dials. Values live in B.bench.tune while you drag them and are only real when you commit —
// a knob that wrote the DB on every pixel of a drag would be a hundred round trips per adjustment.
function tuneTab(t) {
  const cur = B.bench.tune || { ...t.tune };
  const range = B.data.tuneRange || 1;
  const dirty = JSON.stringify(cur) !== JSON.stringify(t.tune);
  const knobs = (B.data.tuneParams || []).map(p => `
    <div class="td-knob">
      <div class="td-knob-head"><b>${esc(p.label)}</b><span class="td-num">${cur[p.id] > 0 ? '+' : ''}${(cur[p.id] ?? 0).toFixed(2)}</span></div>
      <input type="range" class="td-slider" data-tune="${esc(p.id)}" min="${-range}" max="${range}" step="0.05" value="${cur[p.id] ?? 0}">
      <div class="td-knob-poles"><span>${esc(p.lo)}</span><span>${esc(p.hi)}</span></div>
      <div class="td-dim td-note">${esc(p.desc)}</div>
    </div>`).join('');
  const cmd = `rig tune ${t.id} ${(B.data.tuneParams || []).map(p => (cur[p.id] ?? 0)).join(' ')}`;
  return `
    <div class="td-pane">
      <div data-tune-stats>${dirty ? statBars(tunePreview(t, cur) || t.stats, t.stats) : statBars(t.stats)}</div>
      <div class="td-dim td-note">Dials reach ±${range} with your hands and what's fitted.</div>
      ${knobs}
      <div class="td-acts">
        <button class="td-act primary" data-cmd="${esc(cmd)}" ${dirty ? '' : 'disabled title="Nothing changed"'}>Commit the tune</button>
        <button class="td-act ghost" data-tune-reset>Put it back</button>
      </div>
    </div>`;
}

function kitsTab(t) {
  const fitted = t.kits || [];
  return `<div class="td-pane">
    <div data-kit-stats data-peek="">${statBars(t.stats)}</div>
    <div class="td-dim td-note">Point at a kit to see what it does to the truck.</div>
    ${(B.data.kitCatalog || []).map(k => {
    const on = fitted.includes(k.id);
    return `<div class="td-kit-row${on ? ' on' : ''}" ${on ? '' : `data-kit-peek="${esc(k.id)}"`}>
      <div class="td-main"><b>${esc(k.name)}</b><div class="td-dim">${esc(k.desc)}</div></div>
      ${on ? '<span class="td-fitted">FITTED</span>'
        : `<button class="td-act" data-cmd="rig kit ${esc(t.id)} ${esc(k.id)}" ${k.afford ? '' : 'disabled title="You can\'t afford it"'}>${money(k.price)}</button>`}
    </div>`;
  }).join('')}</div>`;
}

// ── THE COSMETIC SHELF ───────────────────────────────────────────────────────
// The catalogue, in the place on the truck each thing goes — off the same server-sent table
// (`fitCat`) the verb prints from, because a shelf whose order differs between the panel and the
// log is two shelves.
//
// ⚠ EVERY BUTTON IS A VERB STRING, exactly as rule 2 at the top of this file says. The panel does
// not know what a fitting IS: it knows a name, a price the server quoted, and the command to send.
// It decides nothing — including whether a swap is a swap, which is why the fitted row in an
// occupied slot renders as TAKE IT OFF and every other row in it renders as its own price rather
// than as some computed difference.
//
// ── AND THE SHEET COMES FIRST, WHICH IS THE WHOLE REDESIGN ───────────────────
// This began as one column: eight headed sections, every item in the catalogue under them, in a
// pane about a third of the screen wide. Two things were wrong with it and they were the same
// thing twice.
//
//  1. THE COMMONEST QUESTION HAD THE LONGEST ANSWER. "What has this truck got on it?" was
//     answerable only by scrolling the entire catalogue and looking for the rows whose button said
//     Remove — a question about EIGHT facts, answered by reading thirty-eight rows. So the eight
//     facts are now the first thing on the tab: one cell per place, naming what is in it or saying
//     *empty*, the whole state of the rig in four lines that never scroll.
//
//  2. THE SHEET IS ALSO THE NAVIGATION, so there is no second control to keep in step with it.
//     Clicking a place opens that place's shelf underneath — four or five rows, which fits — and
//     the two halves cannot disagree about which place you are looking at because one of them IS
//     the other. (A segmented control across the top, the way the booth does its four sections,
//     was the obvious alternative and it would have been a ninth widget saying the same eight
//     words as the cells directly under it.)
//
// The selection lives on `B.bench.fslot` for the same reason the booth's section does: a repush
// lands after every fit and every unfit, and a tab that reset itself to the front bar each time
// would make trying two roof racks against each other a thing you had to re-find twice.
function fitsTab(t) {
  const cat = B.data.fitCat;
  if (!cat) return '<div class="td-pane"><div class="td-dim td-note">No shelf at this counter.</div></div>';
  const on = new Set(t.fits || []);
  // ⚠ THE PRICE IS THE OWNERSHIP TELL, and it is the server's answer rather than a second list on
  // the wire. `priceFor` quotes ZERO for anything already in this truck's drawer (fittings.js rule
  // 5), so `p === 0` is exactly "you own this and putting it back is free" with no `owned_fits`
  // shipped and nothing here to fall out of step with the till.
  const price = (id) => (t.fitPrices || {})[id];
  const byId = Object.fromEntries(cat.items.map((f) => [f.id, f]));
  const fittedIn = (sid) => (t.fits || []).map((id) => byId[id]).find((f) => f && f.slot === sid) || null;
  const sel = cat.slots.some((s) => s.id === B.bench.fslot) ? B.bench.fslot : cat.slots[0].id;

  const sheet = cat.slots.map((s) => {
    const f = fittedIn(s.id);
    return `<button class="td-fitcell${f ? ' on' : ''}${s.id === sel ? ' sel' : ''}" data-fslot="${esc(s.id)}"
        aria-pressed="${s.id === sel ? 'true' : 'false'}" title="${esc(s.note)}">
        <span class="td-fitslot">${esc(s.label)}</span>
        <span class="td-fitwhat">${f ? esc(f.name) : 'empty'}</span>
      </button>`;
  }).join('');

  const cur = cat.slots.find((s) => s.id === sel);
  const rows = cat.items.filter((f) => f.slot === sel).map((f) => {
    const fitted = on.has(f.id), p = price(f.id), mine = p === 0;
    return `<div class="td-kit-row${fitted ? ' on' : ''}">
      <div class="td-main"><b>${esc(f.name)}</b>${mine && !fitted ? '<span class="td-drawer">YOURS</span>' : ''}
        <div class="td-dim">${esc(f.desc)}</div></div>
      ${fitted
        ? `<button class="td-act ghost" data-cmd="rig unfit ${esc(t.id)} ${esc(f.id)}">Take it off</button>`
        : `<button class="td-act" data-cmd="rig fit ${esc(t.id)} ${esc(f.id)}" ${(B.data.credits || 0) >= p ? '' : 'disabled title="You can\'t afford it"'}>${p ? money(p) : 'Put it back on'}</button>`}
    </div>`;
  }).join('');

  const worn = cat.slots.filter((s) => fittedIn(s.id)).length;
  const drawer = cat.items.filter((f) => price(f.id) === 0 && !on.has(f.id)).length;
  return `<div class="td-pane">
    <div class="td-lab">On the truck<span class="td-dim">: ${worn} of ${cat.slots.length} places filled${drawer ? ` · ${drawer} more in the drawer` : ''}</span></div>
    <div class="td-fitsheet">${sheet}</div>
    <div class="td-sub-head">${esc(cur.label)} <span class="td-dim">${esc(cur.note)}</span></div>
    ${rows}
    <div class="td-dim td-note">None of it changes how the truck drives. One per place, and once it's yours, swapping is free.</div>
  </div>`;
}


// ── The inside ───────────────────────────────────────────────────────────────
// The same sheet-then-shelf shape as the fittings tab, and deliberately not a merged one. These
// are bought at the same bench and they are not the same kind of thing: what is bolted to the
// outside is for other people, and none of this is ever shown to anybody but the driver. Keeping
// them apart on screen is also what keeps them apart in the data — see the ⚠ in cab-trinkets.js
// about interior codes finding their way onto the wire.
function cabTab(t) {
  const cat = B.data.cabCat;
  if (!cat) return '<div class="td-pane"><div class="td-dim td-note">No case at this counter.</div></div>';
  const on = new Set(t.cab || []);
  const price = (id) => (t.cabPrices || {})[id];
  const byId = Object.fromEntries(cat.items.map((f) => [f.id, f]));
  const inSlot = (sid) => (t.cab || []).map((id) => byId[id]).find((f) => f && f.slot === sid) || null;
  const sel = cat.slots.some((s) => s.id === B.bench.cslot) ? B.bench.cslot : cat.slots[0].id;

  const sheet = cat.slots.map((s) => {
    const f = inSlot(s.id);
    return `<button class="td-fitcell${f ? ' on' : ''}${s.id === sel ? ' sel' : ''}" data-cslot="${esc(s.id)}"
        aria-pressed="${s.id === sel ? 'true' : 'false'}" title="${esc(s.note)}">
        <span class="td-fitslot">${esc(s.label)}</span>
        <span class="td-fitwhat">${f ? esc(f.name) : 'empty'}</span>
      </button>`;
  }).join('');

  const cur = cat.slots.find((s) => s.id === sel);
  const rows = cat.items.filter((f) => f.slot === sel).map((f) => {
    const fitted = on.has(f.id), p = price(f.id), mine = p === 0;
    return `<div class="td-kit-row${fitted ? ' on' : ''}">
      <div class="td-main"><b>${esc(f.name)}</b>${mine && !fitted ? '<span class="td-drawer">YOURS</span>' : ''}
        <div class="td-dim">${esc(f.desc)}</div></div>
      ${fitted
        ? `<button class="td-act ghost" data-cmd="rig cab ${esc(t.id)} off ${esc(f.id)}">Take it down</button>`
        : `<button class="td-act" data-cmd="rig cab ${esc(t.id)} ${esc(f.id)}" ${(B.data.credits || 0) >= p ? '' : 'disabled title="You can\'t afford it"'}>${p ? money(p) : 'Put it back'}</button>`}
    </div>`;
  }).join('');

  const worn = cat.slots.filter((s) => inSlot(s.id)).length;
  const drawer = cat.items.filter((f) => price(f.id) === 0 && !on.has(f.id)).length;
  return `<div class="td-pane">
    <div class="td-lab">In the cab<span class="td-dim">: ${worn} of ${cat.slots.length} places filled${drawer ? ` · ${drawer} more in the drawer` : ''}</span></div>
    <div class="td-fitsheet">${sheet}</div>
    <div class="td-sub-head">${esc(cur.label)} <span class="td-dim">${esc(cur.note)}</span></div>
    ${rows}
    <div class="td-dim td-note">Nobody but you ever sees any of it, and none of it changes how the truck drives.</div>
  </div>`;
}

// ── THE SEVEN SURFACES ───────────────────────────────────────────────────────
// Each row is a place on the truck, not a slot in a record — the label is where you would point,
// and the note is what changes when you move it. That second half is the whole reason these are a
// table rather than seven bare colour wells: 'Hardware' means nothing until somebody tells you it
// is the chassis and the tanks, and until then a player only ever moves the first one.
//
// ⚠ THE ORDER IS HOW MUCH OF THE TRUCK EACH ONE IS. Cab, then the flash on it, then the box, then
// the metalwork, then the two accents, then the glass — biggest surface first, so the list reads as
// a truck being painted rather than as an alphabetised set of fields.
const PAINT_FIELDS = [
  ['base',   'Cab',            'The colour anybody would call it.'],
  ['trim',   'Flash',          'Whatever the paint job lays over the cab.'],
  ['deck',   'Box',            'The trailer. Very often not the tractor.'],
  ['hw',     'Hardware',       'Chassis, tanks, steps, mirror arms.'],
  ['bright', 'Brightwork',     'Grille, spear, stacks: while chrome is on.'],
  ['glow',   'Running lights', 'The strip under the glass, and the roof pod.'],
  ['glass',  'Glass',          'The tint in the panes.'],
];
// ── AND THE THREE THE INSIDE IS MIXED FROM ───────────────────────────────────
// The interior's answer to PAINT_FIELDS, and it is three rows rather than fourteen for the reason
// stated at length in client/shared/cab-trim.js: eleven of a colourway's values are one of these
// three at a different strength, so wells for them would be eleven ways to make a cab that does
// not look like anything. Same shape as the exterior rows — where you would point, and what
// changes when you move it.
const MIX_FIELDS = [
  ['panel',  'Panel',     'The slab in front of you, and most of the cab by area.'],
  ['needle', 'Needle',    'The one moving thing you look at.'],
  ['glow',   'Backlight', 'What your face is lit by at night, and the tint on every edge.'],
];
// The sections of the booth. Four short screens beat one long one: the pane is a sidebar and the
// catalogue is now seven colours, fifteen paint jobs, eight coats, eleven pictures, four materials
// and seven interiors — which as a single scroll is a wall nobody reads to the bottom of.
//
// ⚠ AND THE LINE BETWEEN TWO OF THEM IS "IS IT PAINT", NOT "IS IT A COLOUR WELL". The PAINT JOB and
// the FINISH COAT sat under Graphics on the grounds that they are lists rather than colour pickers,
// which is a fact about the WIDGET and not about the thing being bought. Both are paint: a flash is
// a second colour laid over the cab and a coat is what goes on top of the lot, and a player looking
// for "the wave one" was looking under Paint and finding seven colour wells. So Paint is now the
// whole respray — the colours, the job and the coat — and Graphics is what is PRINTED on the truck,
// which is one row and is honest about being one row.
const PAINT_SECTIONS = [['scheme', 'Schemes'], ['colour', 'Paint'], ['graphic', 'Graphics'], ['inside', 'Inside']];

// ── THE BOOTH ────────────────────────────────────────────────────────────────
// Seven colours, fifteen paint jobs, eight finish coats, eleven pictures for the door and an
// interior — and the job this tab has is to stop all of that being WORSE than the two colours and
// four flashes it started as.
//
// Four things do that, and none of them is a smaller catalogue:
//
//  1. THE SCHEMES COME FIRST, on their own screen. A row of one-click liveries exactly as the
//     hangar does it (livery.js PRESETS), so the fastest route to a truck that looks deliberate is
//     one click, and the pickers are there for the person who wants to argue with it. Every scheme
//     now names every colour, which is what makes "one click and it is done" true rather than "one
//     click, and then go and find the three it did not set".
//  2. EVERY CHOICE PREVIEWS ON THE MODEL IN FRONT OF YOU. True of all seven colours, the job, the
//     coat and the door. Nothing is committed until the button; the button says what it will cost;
//     and the truck in the hero shot is the truck being described. Paying to find out what flake
//     looks like is not a mechanic.
//  3. AND THE PRICE MOVES WHILE YOU CHOOSE, because the finish is the one thing that changes it. A
//     booth that quoted one number and charged another the moment somebody picked candy would be
//     the panel lying about the only fact on it — see paintCost and the ⚠ in the payload.
//  4. THE INSIDE IS IN HERE TOO, AND IT HAS ITS OWN PREVIEW. A retrim was a verb and nothing else:
//     `rig trim` printed a swatch book of seven words, and the only way to find out what oxblood
//     and chrome looked like was to buy it. It stays a SEPARATE purchase from the paint — its own
//     button, its own price, because it is a different job at a different bench — but it answers
//     the same question the rest of this tab answers, so it lives on the same tab.
//
// ⚠ THE CATALOGUES ARE THE SERVER'S. This file renders `B.data.flashes` / `.finishes` / `.arts` /
// `.paintPresets` / `.dashMaterials` / `.dashColourways` and invents none of them, which is rule 1
// of this panel: the client computes nothing. A hardcoded list here is a second copy of a
// vocabulary `sanitizePaint` would then reject.
function paintTab(t) {
  const sec = B.bench.psec || 'scheme';
  const nav = PAINT_SECTIONS.map(([k, l]) =>
    `<button class="td-seg-btn${sec === k ? ' on' : ''}" data-psec="${k}">${l}</button>`).join('');
  const body = sec === 'colour' ? paintColours(t) : sec === 'graphic' ? paintGraphics(t)
    : sec === 'inside' ? paintInside(t) : paintSchemes(t);
  return `
    <div class="td-pane">
      <div class="td-seg wide">${nav}</div>
      ${body}
    </div>`;
}

// The commit row, shown under every section that edits PAINT. All three share it, because they are
// edits to one job that is bought once — a button per section would read as three resprays.
function paintFoot(t) {
  const cur = paintNow();
  const cmd = paintCmd(t, cur);
  return `
      <div class="td-acts">
        <button class="td-act primary" data-cmd="${esc(cmd || '')}" ${cmd ? '' : 'disabled title="Nothing changed"'}>Into the booth · ${money(paintPrice(t, cur))}</button>
        <button class="td-act ghost" data-paint-reset ${cmd ? '' : 'disabled'}>Put it back</button>
      </div>`;
}

// ── Schemes ──────────────────────────────────────────────────────────────────
// A scheme is the whole truck, so its card shows the whole truck: six colours in the order they
// cover it, with the job and the coat named underneath. Three chips and a word was a swatch; this
// is a paint job you can recognise before you click it.
function paintSchemes(t) {
  const cur = paintNow();
  const nameOf = (rows, id) => ((B.data[rows] || []).find(r => r.id === id) || {}).label || id;
  const cards = (B.data.paintPresets || []).map(p => {
    const on = ['base', 'trim', 'hw', 'deck', 'bright', 'glow', 'glass', 'flash', 'finish'].every(k => cur[k] === p[k]);
    const chips = ['base', 'trim', 'deck', 'hw', 'bright', 'glow']
      .map(k => `<span class="td-pchip" style="background:${esc(p[k] || '#000')}"></span>`).join('');
    return `<button class="td-scheme${on ? ' on' : ''}" data-preset="${esc(p.id)}">
        <span class="td-chips">${chips}</span>
        <b>${esc(p.label)}</b>
        <span class="td-dim">${esc(nameOf('flashes', p.flash))} · ${esc(nameOf('finishes', p.finish))}${p.chrome ? ' · chrome' : ''}</span>
      </button>`;
  }).join('');
  return `
      <div class="td-lab">One click, whole truck</div>
      <div class="td-schemes">${cards}</div>
      <div class="td-dim td-note">A scheme sets all seven colours, the paint job and the coat. Nothing is charged until you send it into the booth.</div>
      ${paintFoot(t)}`;
}

// ── Colours ──────────────────────────────────────────────────────────────────
// Seven wells, each with the name of the SURFACE and a line saying which part of the truck that is.
// The hex sits alongside because copying a colour off one rig onto another is a thing people
// actually do, and reading it back out of a native colour dialog is four clicks.
function paintColours(t) {
  const cur = paintNow();
  const swatches = (rows, key) => (rows || []).map(r =>
    `<button class="td-swatch${cur[key] === r.id ? ' on' : ''}" data-paintpick="${key}" data-paintval="${esc(r.id)}">${esc(r.label || r.id)}</button>`).join('');
  const rows = PAINT_FIELDS.map(([k, label, note]) => `
      <label class="td-crow${k === 'bright' && !cur.chrome ? ' off' : ''}">
        <input type="color" class="td-well" data-paint="${k}" value="${esc(cur[k])}" aria-label="${esc(label)}">
        <span class="td-cname">${esc(label)}<span class="td-dim">${esc(note)}</span></span>
        <code class="td-chex">${esc(String(cur[k] || '').toUpperCase())}</code>
      </label>`).join('');
  return `
      <div class="td-lab">Where the paint goes</div>
      <div class="td-crows">${rows}</div>
      <label class="td-check"><input type="checkbox" data-paint="chrome" ${cur.chrome ? 'checked' : ''}> Brightwork polished<span class="td-dim">: off blacks it out to the hardware colour</span></label>
      <div class="td-lab">Paint job<span class="td-dim">: what the flash colour above is laid on in</span></div>
      <div class="td-swatches">${swatches(B.data.flashes, 'flash')}</div>
      <div class="td-lab">Finish coat<span class="td-dim">: the only thing that moves the price</span></div>
      <div class="td-swatches">${swatches(B.data.finishes, 'finish')}</div>
      ${paintFoot(t)}`;
}

// ── Graphics ─────────────────────────────────────────────────────────────────
// What is PRINTED on the truck, as opposed to what it is painted — one row, because there is one
// thing on a rig you read rather than look at, and it is the door. (The paint job and the coat used
// to be up here; see the ⚠ on PAINT_SECTIONS for why they are not.)
function paintGraphics(t) {
  const cur = paintNow();
  const swatches = (rows, key) => (rows || []).map(r =>
    `<button class="td-swatch${cur[key] === r.id ? ' on' : ''}" data-paintpick="${key}" data-paintval="${esc(r.id)}">${esc(r.label || r.id)}</button>`).join('');
  return `
      <div class="td-lab">On the door</div>
      <div class="td-swatches">${swatches(B.data.arts, 'art')}</div>
      <div class="td-dim td-note">The name on the door is the plate: <code>rig name ${esc(t.id)} &lt;plate&gt;</code>.</div>
      ${paintFoot(t)}`;
}

// ── Inside ───────────────────────────────────────────────────────────────────
// The retrim, and the reason it earns a screen: what you are buying is THE LIGHT YOU DRIVE BY. A
// colourway is not a brown or a blue, it is a needle colour and a glow on your face for twenty
// minutes at a stretch, and none of that is sayable in a word. So it previews — the same colours
// the renderer takes, arranged as the thing they make.
//
// ⚠ SURFACE ONLY, AND THE PREVIEW MUST NOT PRETEND OTHERWISE. A retrim reaches the dash's material
// and its colourway and nothing else; `dials`, `band` and `lamps` are the fleet ladder and the
// ladder's teeth are INFORMATION. The mock draws two dials on every truck because it is a picture
// of a SURFACE, and no swatch on it can add an instrument — see the ⚠ in rig.js, which states the
// same boundary from the other side.
function paintInside(t) {
  const cur = trimNow(t);
  const cols = B.data.dashColourways || [];
  const mats = B.data.dashMaterials || [];
  const cmd = trimCmd(t, cur);
  const swatch = (c) => {
    const g = `linear-gradient(160deg, ${esc(c.dash?.[0] || '#555')}, ${esc(c.dash?.[1] || '#333')} 62%, ${esc(c.dash?.[2] || '#111')})`;
    return `<button class="td-tswatch${cur.col === c.id ? ' on' : ''}" data-trimpick="col" data-trimval="${esc(c.id)}" title="${esc(c.label)}">
        <span class="td-tchip" style="background:${g}"><i style="background:${esc(c.needle || '#fff')};box-shadow:0 0 6px ${esc(c.glow || '#fff')}"></i></span>
        ${esc(c.id)}</button>`;
  };
  const matRow = (m) => `<button class="td-swatch${cur.mat === m.id ? ' on' : ''}" data-trimpick="mat" data-trimval="${esc(m.id)}" title="${esc(m.blurb || '')}">${esc(m.label)}</button>`;
  // The mix, as one more swatch on the end of the book — so the way BACK to it after trying oxblood
  // is the same click as the way to oxblood. It only appears once there is one to go back to.
  const mixSwatch = () => {
    const d = customColourway(mixNow(cur)); if (!d) return '';
    const g = `linear-gradient(160deg, ${esc(d.dash[0])}, ${esc(d.dash[1])} 62%, ${esc(d.dash[2])})`;
    return `<button class="td-tswatch${cur.col === CUSTOM_COL ? ' on' : ''}" data-trimpick="col" data-trimval="${CUSTOM_COL}" title="Your own mix">
        <span class="td-tchip" style="background:${g}"><i style="background:${esc(d.needle)};box-shadow:0 0 6px ${esc(d.glow)}"></i></span>
        yours</button>`;
  };
  const wells = MIX_FIELDS.map(([k, label, note]) => `
      <label class="td-crow">
        <input type="color" class="td-well" data-trimcol="${k}" value="${esc(mixNow(cur)[k])}" aria-label="${esc(label)}">
        <span class="td-cname">${esc(label)}<span class="td-dim">${esc(note)}</span></span>
        <code class="td-chex">${esc(String(mixNow(cur)[k] || '').toUpperCase())}</code>
      </label>`).join('');
  return `
      ${dashPreview(cur)}
      <div class="td-lab">Colourway<span class="td-dim">: the light you drive by</span></div>
      <div class="td-tswatches">${cols.map(swatch).join('')}${cur.cust ? mixSwatch() : ''}</div>
      <div class="td-lab">Or mix your own<span class="td-dim">: three picks, and the rest of the cab follows them</span></div>
      <div class="td-crows${cur.col === CUSTOM_COL ? ' on' : ''}">${wells}</div>
      <div class="td-lab">Material</div>
      <div class="td-swatches">${mats.map(matRow).join('')}</div>
      <div class="td-acts">
        <button class="td-act primary" data-cmd="${esc(cmd || '')}" ${cmd ? '' : 'disabled title="Nothing changed"'}>Retrim it · ${money(t.trimPrice || 0)}</button>
        <button class="td-act ghost" data-trim-reset ${cmd ? '' : 'disabled'}>Put it back</button>
      </div>
      <div class="td-dim td-note">The bench doesn't sell instruments. What's in the binnacle came with the truck.</div>`;
}

// The mix currently on the wells: the player's own if they have one, otherwise the colourway they
// are WEARING taken apart into its three picks — so the wells open on the cab you are sitting in
// rather than on a default nobody chose, and nudging one is an edit to that rather than a jump.
function mixNow(cur) {
  if (cur.cust) return cur.cust;
  const c = (B.data.dashColourways || []).find(r => r.id === cur.col) || {};
  return { panel: (c.dash || [])[0] || '#3b414a', needle: c.needle || '#e8c07a', glow: c.glow || '#9fb4c4' };
}
// The colours the mock is drawn from: a catalogue row, or the same fourteen values the renderer
// will derive from the three picks. One function, so the picture cannot promise a cab the
// windscreen then refuses to draw.
const trimColours = (cur) => (cur.col === CUSTOM_COL ? customColourway(mixNow(cur)) : (B.data.dashColourways || []).find(r => r.id === cur.col)) || {};

// The material's grain, as the one thing about it a still picture can show. These are not the
// renderer's tiles (cabDashTex builds those procedurally at cab scale) and are not pretending to
// be: they are the difference between four words, which is what this row was.
const DASH_GRAIN = {
  steel:   'repeating-linear-gradient(92deg, rgba(255,255,255,.06) 0 1px, transparent 1px 3px)',
  plastic: 'radial-gradient(rgba(255,255,255,.05) .5px, transparent .6px) 0 0 / 3px 3px',
  vinyl:   'repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 7px)',
  wood:    'repeating-linear-gradient(88deg, rgba(0,0,0,.22) 0 2px, rgba(255,255,255,.05) 2px 3px, transparent 3px 9px)',
};
// The mock: a header rail, the dash slab in the colourway's own three-stop gradient with the
// material's grain over it, the lip highlight scaled by the material's gloss, and two lit dials
// with a needle at rest. That is every colour the renderer actually reads, arranged the way it
// reads them. CSS rather than a canvas because it is a STILL — nothing here animates, and a canvas
// would be a second rAF for a picture that only changes when you click.
function dashPreview(cur) {
  const c = trimColours(cur);
  const m = (B.data.dashMaterials || []).find(r => r.id === cur.mat) || {};
  const d = c.dash || ['#3b414a', '#1e2228', '#0d0f12'];
  const hdr = c.hdr || ['#16181c', '#23262b'];
  const face = c.face || ['#171a1f', '#0a0c0f'];
  const needle = c.needle || '#e8c07a', glow = c.glow || '#9fb4c4';
  const gloss = m.gloss == null ? 0.5 : m.gloss;
  const dial = (deg) => `<span class="td-dial" style="background:radial-gradient(circle at 50% 38%, ${esc(face[0])}, ${esc(face[1])});box-shadow:inset 0 0 0 2px ${esc(c.ring || 'rgba(150,165,185,0.28)')}, 0 0 12px ${esc(glow)}"><i style="background:${esc(needle)};transform:rotate(${deg}deg);box-shadow:0 0 5px ${esc(needle)}"></i></span>`;
  return `
      <div class="td-dashmock" aria-hidden="true">
        <span class="td-dm-hdr" style="background:linear-gradient(180deg, ${esc(hdr[0])}, ${esc(hdr[1])})"></span>
        <span class="td-dm-slab" style="background:linear-gradient(168deg, ${esc(d[0])}, ${esc(d[1])} 58%, ${esc(d[2])})">
          <span class="td-dm-grain" style="background:${DASH_GRAIN[cur.mat] || DASH_GRAIN.plastic}"></span>
          <span class="td-dm-lip" style="background:${esc(c.lip || 'rgba(190,205,225,0.16)')};opacity:${(0.35 + gloss * 0.65).toFixed(2)}"></span>
          <span class="td-dm-dials">${dial(-38)}${dial(24)}</span>
        </span>
      </div>
      <div class="td-dim td-note td-dm-cap">${esc([c.label || 'stock', m.label || 'stock'].join(', '))}${c.custom ? ': nobody else is driving this one' : c.stock === false ? ': a bench colour, on no truck from the factory' : ''}</div>`;
}

// What the booth will charge for the paint CURRENTLY ON THE DIALS. The scale is the server's — it
// sends the gloss-coat price and the multiplier for every coat — so this multiplies, it does not
// price. Get that wrong and the panel is quoting a number the till has never heard of.
function paintPrice(t, cur) {
  const mul = (B.data.finishMul || {})[cur.finish];
  return mul == null || t.paintBase == null ? t.paintPrice : Math.max(60, Math.round(t.paintBase * mul));
}
// The interior currently on the dials: the truck's own resolved trim (the server merges the stock
// row in, so this is never half-empty) with whatever the bench has clicked on top of it.
function trimNow(t) {
  const sel = t || selected();
  return { ...((sel && sel.trim) || {}), ...(B.bench.trim || {}) };
}
// `rig trim` is ORDER-FREE and takes bare words — a material and a colourway cannot be confused for
// one another — so the command is simply whichever of the two changed, in either order. The mix is
// the one part that is NAMED (`panel=#…`), because three hexes in a row say nothing about which is
// which, and naming any of them already means the custom colourway — so this never sends the word.
//
// ⚠ AND A MIX IS COMPARED BY ITS THREE PICKS, NEVER BY THE WORD 'custom'. Both sides of the
// comparison say `custom` the moment a driver has one fitted, so keying on the name would make
// every further nudge of a well a no-op with a dead button, which is indistinguishable from the
// panel being broken.
function trimCmd(t, cur) {
  const was = t.trim || {};
  const parts = [];
  if (cur.mat && cur.mat !== was.mat) parts.push(cur.mat);
  if (cur.col === CUSTOM_COL) {
    const now = mixNow(cur), fitted = was.col === CUSTOM_COL ? (was.cust || null) : null;
    if (!fitted || MIX_FIELDS.some(([k]) => now[k] !== fitted[k])) parts.push(...MIX_FIELDS.map(([k]) => `${k}=${now[k]}`));
  } else if (cur.col && cur.col !== was.col) parts.push(cur.col);
  return parts.length ? `rig trim ${t.id} ${parts.join(' ')}` : null;
}

// The verb, or null when nothing has changed. Named arguments, because eight positional ones is a
// grammar nobody can type — see rigPaint, which still accepts the old four for anything already
// written down.
function paintCmd(t, cur) {
  const was = { ...(B.data.paintDefault || {}), ...(t.paint || {}) };
  const keys = ['base', 'trim', 'hw', 'deck', 'bright', 'glow', 'glass', 'flash', 'finish', 'art'];
  const parts = keys.filter(k => cur[k] !== was[k]).map(k => `${k}=${cur[k]}`);
  if ((cur.chrome ? 1 : 0) !== (was.chrome ? 1 : 0)) parts.push(`chrome=${cur.chrome ? 1 : 0}`);
  return parts.length ? `rig paint ${t.id} ${parts.join(' ')}` : null;
}

// ── Freight and the exchange ─────────────────────────────────────────────────
//
// WHAT IS ON THE DECK IS THE OTHER HALF OF THIS BOARD, and neither screen used to state it. The
// buttons were gated on `canLoad` — is there a box standing here — so with a load already on that
// box every row still offered a live Take it that `haul` was certain to refuse ("Already loaded:
// …"), and the refusal only ever appeared in the log. A button that is present and refuses is worse
// than one that is absent and explains itself; this is the
// same rule, applied to the one screen that was breaking it.
//
// So: the deck is printed above both boards, the row you are already carrying says so instead of
// offering itself again, and every remaining button carries the reason it is dim.

// What the deck holds, in one strip. Purely a read-out of facts the server sent — the same three
// the Yard screen prints, in the place where they answer the question the buttons below are about
// to be asked.
function deckStrip() {
  const d = B.data;
  const load = d.cargo
    ? (d.cargo.kind === 'goods'
      ? `<b>${esc(d.cargo.qty)} × ${esc(d.cargo.name)}</b> · ${d.cargo.kg} kg · paid ${money(d.cargo.paid)}/unit`
      : `<b>${esc(d.cargo.name)}</b> · ${d.cargo.kg} kg · contracted to ${esc(d.cargo.to)}`)
    : '<span class="td-dim">empty</span>';
  // ⚠ ONE LINE. It was three — a block label, the load, then the rating on a rule of its own — which
  // cost 110px of a 370px board to say "empty, 3,600 kg". This strip is a caption over the thing the
  // screen is actually for, and a caption that takes a third of the screen is the screen.
  return `<div class="td-deck td-deckstrip"><span class="td-lab">On the deck</span>${load}
    <span class="td-dim">rated ${d.deckKg} kg</span>${d.canLoad || !d.loadWhy ? '' : `<span class="td-warn">${esc(d.loadWhy)}</span>`}
  </div>`;
}

// Why a load button is dim, in the words the verb itself would use — or null when it is live. One
// function for both boards, because `haul` and `market buy` refuse for exactly the same reasons.
function loadBlock() {
  const d = B.data;
  if (!d.canLoad) return d.loadWhy || 'Nowhere to put it';
  if (d.cargo) return `The deck is full: ${d.cargo.name}`;
  return null;
}

// Which board row you are already carrying. Matched on the SLOT and on what the load is — a board
// index means something different at every yard, and the name alone cannot separate two identical
// runs on one day's board.
const onDeck = (b, c) => !!c && c.slot === b.i && c.name === b.name && c.to === b.toName;

// ⚠ AND BOTH BOARDS ARE WRAPPED IN A COLUMN. `.td-body` is a flex ROW — it is the yard's
// scene-beside-sidebar layout — so every top-level node a screen returns becomes a column of its
// own. These two screens have always returned more than one (the exchange's Sell button and its
// footnote were sitting to the RIGHT of the table, not under it), and the deck strip would have
// been a third. The wrapper is what makes "above the board" mean above.
function freightScreen() {
  const d = B.data;
  if (!(d.board || []).length) return `<div class="td-col">${deckStrip()}<div class="td-none">Nothing on the board today.</div></div>`;
  const block = loadBlock();
  return `<div class="td-col">${deckStrip()}<div class="td-rows wide">${d.board.map(b => {
    const mine = onDeck(b, d.cargo);
    return `
    <div class="td-row${mine ? ' taken' : ''}">
      <div class="td-main"><b>${esc(b.name)}</b><div class="td-dim">${b.kg} kg → ${esc(b.toName)}${b.crosses ? ' <span class="td-warn">across the waste</span>' : ''}</div></div>
      <div class="td-pay">${money(b.pay)}</div>
      ${mine ? '<span class="td-fitted">✔ On the deck</span>'
        : `<button class="td-act" data-cmd="haul ${b.i + 1}" ${block ? `disabled title="${esc(block)}"` : ''}>Take it</button>`}
    </div>`;
  }).join('')}</div></div>`;
}

function marketScreen() {
  const d = B.data;
  const rows = (d.quotes || []).map(q => {
    const gain = q.thereBid == null ? null : q.thereBid - q.ask;
    const there = q.thereBid == null ? '<span class="td-dim">—</span>'
      : `<span class="${gain > 0 ? 'td-good' : 'td-dim'}">${money(q.thereBid)}${gain > 0 ? ` (+${gain}/u)` : ''}</span>`
        + (q.thereAge ? ` <span class="td-dim">${q.thereAge}d</span>` : '');
    const fits = Math.min(q.canAfford, q.holds);
    // Same block as the freight board, plus the one reason that is this screen's own. It used to
    // ask only `canLoad`, so a full deck left every Buy live and the refusal in the log.
    const block = loadBlock() || (fits > 0 ? null : 'Not enough credits');
    return `<div class="td-row">
      <div class="td-main"><b>${esc(q.name)}</b><span class="td-dim"> · ${q.kg} kg</span></div>
      <div class="td-num">${money(q.ask)}</div>
      <div class="td-num td-dim">${money(q.bid)}</div>
      <div class="td-num">${there}</div>
      <button class="td-act" data-cmd="market buy ${q.key} full" ${block ? 'disabled' : ''}
        title="${esc(block || `Fills the deck: ${fits}`)}">Buy ${fits > 0 ? fits : ''}</button>
    </div>`;
  }).join('');
  const sell = d.cargo?.kind === 'goods'
    ? `<div class="td-acts"><button class="td-act primary" data-cmd="market sell">Sell ${esc(d.cargo.qty)} × ${esc(d.cargo.name)} here</button></div>` : '';
  // The deck line was a footnote under this table ("Your deck holds N kg"); it is the strip now, at
  // the top, saying what is ON the deck as well as what it holds — which is the fact every dim Buy
  // below it is explained by.
  return `<div class="td-col">${deckStrip()}<div class="td-rows wide">
      <div class="td-row head"><div class="td-main">good</div><div class="td-num">buy</div><div class="td-num">sell</div>
        <div class="td-num">${d.thereName ? esc(d.thereName) : 'there'}</div><div></div></div>
      ${rows}</div>${sell}</div>`;
}


// ── Events ───────────────────────────────────────────────────────────────────
// One delegated handler for both homes — the counter's #td-root and the bay's #td-svc — because
// every control in either is one of the same dozen shapes.
function onClick(e) {
  if (!B) return;
  if (shellClick(e, {
    screen: (s) => { B.screen = s; render(); },
    // Closing the counter leaves you standing in the yard, so it has to put the room back — the
    // pane is the room's pane, and a panel that simply removed itself would leave it blank.
    close: () => { closeTruckDepot(); sendCmdSilent('look'); },
    // ⚠ FOLDING THE BAY IS NOT LEAVING IT. The shed is still round you and the fitters are still
    // there; the chip in the corner brings it back until the truck rolls out through the door.
    fold: () => { B.open = false; renderService(); },
    open: () => { B.open = true; renderService(); },
  })) return;
  const t = e.target.closest('[data-cmd],[data-screen],[data-bench],[data-lot],[data-box],[data-paintpick],[data-trimpick],[data-psec],[data-fslot],[data-cslot],[data-preset],[data-tune-reset],[data-paint-reset],[data-trim-reset],[data-hear],[data-plate]');
  if (!t || t.disabled) return;
  if (t.dataset.screen) { B.screen = t.dataset.screen; return void render(); }
  if (t.dataset.bench) { B.bench.tab = t.dataset.bench; return void redraw(); }
  if (t.dataset.lot) { B.lotSel = t.dataset.lot; return void render(); }
  if (t.dataset.box) { B.boxSel = t.dataset.box; return void render(); }
  // A horn you are deciding whether to buy is played HERE and nowhere else: no packet, nothing the
  // yard hears, and the same instrument the cord will sound once it is on the roof.
  if (t.dataset.hear) { airHorn(selected()?.typeId, 1.2, t.dataset.hear === 'stock' ? null : t.dataset.hear); return; }
  // The plate reads the box beside it at the moment of the click, so what goes out is exactly the
  // `rig name` a player would have typed with those words in it.
  if (t.dataset.plate) {
    const v = String(t.parentElement?.querySelector('.td-plate-in')?.value || '').trim();
    if (v) sendCmdSilent(`rig name ${t.dataset.plate} ${v}`);
    return;
  }
  // One swatch, whichever row it came from — the paint job, the finish coat and the door art are
  // three lists of the same widget, so they are one handler rather than three near-copies.
  if (t.dataset.paintpick) { B.bench.paint = { ...paintNow(), [t.dataset.paintpick]: t.dataset.paintval }; return void redraw(); }
  // Which screen of the booth, and which PLACE on the truck a shelf is showing. Held on the bench so
  // a re-push after a purchase does not throw the player back to the first one.
  if (t.dataset.psec) { B.bench.psec = t.dataset.psec; return void redraw(); }
  if (t.dataset.fslot) { B.bench.fslot = t.dataset.fslot; return void redraw(); }
  if (t.dataset.cslot) { B.bench.cslot = t.dataset.cslot; return void redraw(); }
  // The interior's two swatch rows, exactly as the paint's are: an edit held locally, previewed,
  // and charged only by the button. ⚠ It is a SEPARATE draft from the paint (`B.bench.trim`), or
  // clicking a colourway would dirty the respray and the booth would quote for both.
  if (t.dataset.trimpick) { B.bench.trim = { ...trimNow(), [t.dataset.trimpick]: t.dataset.trimval }; return void redraw(); }
  // A scheme sets every field at once. ⚠ Applied LOCALLY rather than sent as `rig paint <id> preset
  // <name>`: sending it would charge for the respray the instant somebody clicked a swatch to see
  // what it looked like. The preset is a shortcut through the pickers, not a purchase.
  if (t.dataset.preset) {
    const p = (B.data.paintPresets || []).find(r => r.id === t.dataset.preset);
    if (p) { const { id, label, ...fields } = p; B.bench.paint = { ...paintNow(), ...fields }; }
    return void redraw();
  }
  if (t.dataset.tuneReset != null) { B.bench.tune = null; return void redraw(); }
  if (t.dataset.paintReset != null) { B.bench.paint = null; return void redraw(); }
  if (t.dataset.trimReset != null) { B.bench.trim = null; return void redraw(); }
  // Anything irreversible (selling, handing a hire back, a tow bill) is a `data-hold` and never
  // reaches here: armHolds made it a hold-to-confirm. Everything else is a verb, sent as typed, and
  // remembered so the purchase moment can say what was bought.
  if (t.dataset.cmd) { noteAct(t); sendCmdSilent(t.dataset.cmd); }
}


function onInput(e) {
  const el = e.target;
  if (el.dataset.tune) {
    const t = selected(); if (!t) return;
    B.bench.tune = { ...(B.bench.tune || t.tune), [el.dataset.tune]: parseFloat(el.value) };
    // Repaint the numbers without rebuilding the DOM — rebuilding mid-drag drops the slider the
    // pointer is holding, which makes a dial impossible to actually turn.
    const head = el.parentElement.querySelector('.td-num');
    const v = B.bench.tune[el.dataset.tune];
    if (head) head.textContent = `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
    const commit = document.querySelector('.td-side .td-act.primary');
    if (commit) {
      commit.disabled = false;
      commit.dataset.cmd = `rig tune ${t.id} ${(B.data.tuneParams || []).map(p => (B.bench.tune[p.id] ?? 0)).join(' ')}`;
    }
    // The bars follow the dial: what this tune would do, against what is on the truck now.
    const bars = document.querySelector('[data-tune-stats]');
    const prev = tunePreview(t, B.bench.tune);
    if (bars && prev) bars.innerHTML = statBars(prev, t.stats);
    return;
  }
  // A mix well. Same no-re-render rule as the paint wells below and for the same reason — the DOM
  // cannot be rebuilt under a live native colour picker — so the two things that are facts about
  // the COLOUR (the hex beside it, and the mock above it) are patched in place, and the commit
  // button, which cannot repaint itself, is refreshed.
  //
  // ⚠ TOUCHING A WELL SELECTS THE MIX. It has to: a driver dragging the needle colour while
  // 'moss' is still the fitted colourway is telling you what they want, and leaving the swatch
  // selected would mean the preview moves, the button lights, and the cab comes back green.
  if (el.dataset.trimcol) {
    const t = selected(); if (!t) return;
    const cur = trimNow(t);
    B.bench.trim = { ...cur, col: CUSTOM_COL, cust: { ...mixNow(cur), [el.dataset.trimcol]: el.value } };
    const hex = el.parentElement && el.parentElement.querySelector('.td-chex');
    if (hex) hex.textContent = String(el.value || '').toUpperCase();
    syncDashMock(trimNow(t));
    refreshTrimCommit(t);
    if (B.mode === 'service') cabPreview({ trim: trimNow(t) });
    return;
  }
  if (el.dataset.paint) {
    const t = selected(); if (!t) return;
    const key = el.dataset.paint;
    B.bench.paint = { ...paintNow(), [key]: key === 'chrome' ? (el.checked ? 1 : 0) : el.value };
    // NO RE-RENDER, for the same reason the tune slider does not: a colour input fires `input`
    // continuously while you drag around the swatch, and rebuilding the DOM under a live native
    // colour picker closes it on the first pixel of movement. The hero shot needs no re-render
    // anyway — it reads B.bench.paint straight off the state every frame — so only the commit
    // button, which is the one thing that cannot repaint itself, is updated in place.
    // …and the hex beside the well, which is the one other thing on the row that is a fact about the
    // colour rather than about the truck. Same in-place update, same reason.
    const hex = el.parentElement && el.parentElement.querySelector('.td-chex');
    if (hex && key !== 'chrome') hex.textContent = String(el.value || '').toUpperCase();
    refreshPaintCommit(t);
    // In the bay the preview is the REAL truck, out of the chase camera, and it follows the well.
    if (B.mode === 'service') cabPreview({ paint: paintNow() });
    return;
  }
}

// The retrim button, kept in step with a colour drag. The interior is a SEPARATE purchase from the
// paint, so it has its own — see the ⚠ on B.bench.trim in the click handler.
function refreshTrimCommit(t) {
  const btn = document.querySelector('.td-side .td-act.primary');
  if (!btn) return;
  const cmd = trimCmd(t, trimNow(t));
  btn.disabled = !cmd;
  btn.dataset.cmd = cmd || '';
  const ghost = document.querySelector('.td-side .td-act.ghost[data-trim-reset]');
  if (ghost) ghost.disabled = !cmd;
}
// The mock, repainted without rebuilding it. Every value here is read out of the same
// `trimColours` the markup was built from, so this is the identical picture and not a second
// attempt at one — if you add a surface to dashPreview, add it here or it freezes mid-drag.
function syncDashMock(cur) {
  const root = document.querySelector('.td-dashmock');
  if (!root) return;
  const c = trimColours(cur);
  const d = c.dash || ['#3b414a', '#1e2228', '#0d0f12'], hdr = c.hdr || ['#16181c', '#23262b'];
  const face = c.face || ['#171a1f', '#0a0c0f'];
  const needle = c.needle || '#e8c07a', glow = c.glow || '#9fb4c4';
  const set = (sel, prop, v) => { const el = root.querySelector(sel); if (el) el.style[prop] = v; };
  set('.td-dm-hdr', 'background', `linear-gradient(180deg, ${hdr[0]}, ${hdr[1]})`);
  set('.td-dm-slab', 'background', `linear-gradient(168deg, ${d[0]}, ${d[1]} 58%, ${d[2]})`);
  set('.td-dm-lip', 'background', c.lip || 'rgba(190,205,225,0.16)');
  for (const dial of root.querySelectorAll('.td-dial')) {
    dial.style.background = `radial-gradient(circle at 50% 38%, ${face[0]}, ${face[1]})`;
    dial.style.boxShadow = `inset 0 0 0 2px ${c.ring || 'rgba(150,165,185,0.28)'}, 0 0 12px ${glow}`;
    const n = dial.querySelector('i');
    if (n) { n.style.background = needle; n.style.boxShadow = `0 0 5px ${needle}`; }
  }
  const cap = document.querySelector('.td-dm-cap');
  const m = (B.data.dashMaterials || []).find(r => r.id === cur.mat) || {};
  if (cap) cap.textContent = [c.label || 'stock', m.label || 'stock'].join(', ') + (c.custom ? ': nobody else is driving this one' : '');
}

// The paint currently on the dials: the server's truck, whatever the bench has edited on top of
// it, over the defaults. Everything that touches a picker goes through here, so a truck painted
// before the model widened never hands a half-filled object to the next edit.
function paintNow() {
  const t = selected();
  return { ...(B.data.paintDefault || {}), ...(t?.paint || {}), ...(B.bench.paint || {}) };
}
// The Into-the-booth button, kept in step with a colour drag without touching the rest of the DOM.
function refreshPaintCommit(t) {
  const btn = document.querySelector('.td-side .td-act.primary');
  if (!btn) return;
  const cur = paintNow(), cmd = paintCmd(t, cur);
  btn.disabled = !cmd;
  btn.dataset.cmd = cmd || '';
  btn.textContent = `Into the booth · ${money(paintPrice(t, cur))}`;
}


function onKey(e) {
  if (!B || B.mode !== 'yard') return;
  // Escape BACKS OUT ONE SCREEN, the hangar's behaviour, and only then closes the counter — and
  // never while a text box has the caret, because Escape is also how you leave one.
  if (e.key !== 'Escape') return;
  const el0 = document.activeElement;
  if (el0 && (el0.tagName === 'INPUT' || el0.tagName === 'TEXTAREA' || el0.isContentEditable)) return;
  if (B.screen !== 'lot') { B.screen = 'lot'; return void render(); }
  closeTruckDepot();
  sendCmdSilent('look');
}

// ── The cards ────────────────────────────────────────────────────────────────
// Painted once per render and per resize, never in a loop (vehicle-card.js says why). Each truck is
// drawn PARKED (`~p`, the variant grammar's shut-down pose) in its own paint and dirt, through the
// same livery conversion the cab and the world use.
function paintCards() {
  if (!B || B.mode !== 'yard') return;
  const root = document.getElementById('td-root');
  if (!root) return;
  const fleet = B.data.fleet || [];
  for (const cv of root.querySelectorAll('canvas[data-card]')) {
    const t = fleet.find((r) => r.id === cv.dataset.card);
    if (!t) continue;
    paintVehicleCard(cv, { style: cardStyleFor(t.id), seed: cardSeed(t.id), dim: !t.hereNow,
      v: { cls: 'truck', variant: `${t.variant}~p`, livery: liveryOf(t), yaw: 0.62, fit: 1.45 } });
  }
  // A guest card is drawn as its own plugin described it (`v`), in the shed's light.
  for (const cv of root.querySelectorAll('canvas[data-guest]')) {
    const v = (B.data.parked || []).find((r) => r.id === cv.dataset.guest);
    if (v) paintVehicleCard(cv, { style: cardStyleFor(v.id), seed: cardSeed(v.id), v: v.v });
  }
  for (const cv of root.querySelectorAll('canvas[data-rent]')) {
    const id = cv.dataset.rent;
    paintVehicleCard(cv, { style: cardStyleFor('hire:' + id), seed: cardSeed('hire:' + id),
      v: { cls: 'truck', variant: `${cv.dataset.variant || id}~p`, livery: truckLivery(B.data.paintFactory?.[cv.dataset.variant || id] || B.data.paintDefault || {}, 0), yaw: 0.62, fit: 1.45 } });
  }
  for (const cv of root.querySelectorAll('canvas[data-slot]')) {
    const buy = cv.dataset.slot === 'buy';
    paintSlotCard(cv, { style: buy ? 'showroom' : 'sunburst', seed: buy ? 7 : 11, glyph: buy ? '+' : '⟲' });
  }
}

// ── The one animation loop ───────────────────────────────────────────────────
// Only the dealer's schematics turn, so this only runs while they are on screen — and it retires
// itself the frame there is nothing left to draw rather than idling behind the hand of cards.
function startSpin() {
  if (raf) return;
  const loop = () => {
    const root = document.getElementById('td-root');
    const wfs = root ? root.querySelectorAll('.td-wf') : [];
    if (!root || !B || !wfs.length) { raf = null; return; }
    yaw += 0.006;
    const accent = themeColor('--accent', '#d8892e');
    for (const c of wfs) {
      const ctx = c.getContext('2d');
      // `fill` — the rig is sized by the CARD, not by how big the mesh happens to be authored.
      if (ctx) drawWireframe3D(ctx, { cls: 'truck', variant: c.dataset.variant, w: c.width, h: c.height, accent, yaw,
        fill: 0.94, fitRef: c.dataset.fit });
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}


// A box's livery from the one colour the server sends. Deliberately the same shape the trucks go
// through (truckLivery) rather than a bespoke object, so a trailer and a tractor are painted by
// one conversion — and the chassis and legs stay dark, because a trailer is a painted box on
// black steel and washing the whole thing in one colour reads as a toy.
const boxLivery = (c) => truckLivery({ base: c || '#8d9199', deck: c || '#8d9199', trim: c || '#8d9199',
  hw: '#23262b', bright: '#9aa2ab', glow: '#60c4d6', glass: '#324a5c', flash: 'none', finish: 'satin', art: 'none', chrome: 0 });
function liveryOf(t, live = false) {
  const p = (live && B?.bench?.paint && t.id === B.selId)
    ? { ...(B.data.paintDefault || {}), ...(t.paint || {}), ...B.bench.paint } : t.paint;
  if (!p) return {};
  // ⚠ FOUR COLOURS, AND THE FINISH IS ITS OWN FIELD NOW. `chrome` used to be handed to the renderer
  // AS the finish — a tickbox called 'chrome on the stacks' silently deciding gloss versus matte,
  // which is two different questions wearing one control. It is back to meaning brightwork, and
  // the coat is the coat.
  // …AND THE DIRT IT CAME IN WITH. The second argument to the one conversion — a truck on the
  // turntable that was clean while the same truck out of the windscreen was brown is the same
  // class of bug as a flash rendering in one view and not the other.
  //
  // ⚠ IT IS NOT PREVIEWED. Every other value in here can be a live bench edit (`live`, above) so a
  // dial moves the paint under your hand; dirt is not something you choose, so it is always the
  // truck's own number and the wash button is what changes it.
  return truckLivery(p, t.grime || 0);
}

function sizeCanvas(cv) {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!cv._cw || Math.abs(r.width - cv._cw) > 0.5 || Math.abs(r.height - cv._ch) > 0.5) {
    cv._cw = r.width; cv._ch = r.height; cv._dpr = dpr;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  }
  const ctx = cv.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}


// ── Styles ───────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('td-styles')) return;
  const s = document.createElement('style');
  s.id = 'td-styles';
  // THE DEPOT IS THE SAME DEVICE THE HANGAR IS.
  //
  // It was not. The hangar (hangar-bay.js) is a moulded chassis that FOLLOWS THE PLAYER'S THEME —
  // every surface is the theme's own accent at a different intensity over the theme's own bg tiers,
  // sharing the Architect OS tablet's `--tos-*` bevel recipe, so the bench and the tablet are
  // literally the same surface. This file was a flat #0e1114 slab with #e8c07a painted on it and
  // the body font inherited: a different manufacturer's product, one kerb away, doing the same job.
  // On a light theme the hangar reads light and the depot stayed a black box.
  //
  // So the palette below is the hangar's, verbatim, aliased onto this file's own class names — one
  // accent (`--td-accent: var(--accent)`), three surface tiers mixed from it, two translucent
  // bevels that read on a light theme and a dark one alike. Nothing here is a hex code except the
  // condition bands (which mean green→red and cannot follow a theme) and the recessed viewports:
  // THE SCREENS STAY DARK GLASS ON ANY THEME, because a real screen doesn't relight for your
  // wallpaper — the same exception the hangar carves out for its 3D scene and its schematics.
  s.textContent = DEPOT_CSS;
  document.head.appendChild(s);
}
