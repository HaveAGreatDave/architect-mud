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
import { cabServiceHost, cabPreview, cabView } from './cab-view.js';

let B = null;             // { mode: 'yard'|'service', data, screen, selId, bench, toast, open }
let raf = null;
let yaw = 0;
let toastT = null;
let ro = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Icon + label chip, the hangar's `tbtn` verbatim (hangar-bay.js): the glyph is decoration and the
// word beside it is the button's real name, so the icon is hidden from the accessible tree —
// otherwise "Sell" is announced as "credit Sell".
const tbtn = (icon, label, attrs = '', cls = '') =>
  `<button class="td-act${cls ? ' ' + cls : ''}" ${attrs}><span class="td-ico" aria-hidden="true">${icon}</span>${label}</button>`;
const money = (n) => `${Number(n || 0).toLocaleString()}₵`;
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

export function isTruckDepotActive() { return !!B && B.mode === 'yard'; }

// ── Opening ──────────────────────────────────────────────────────────────────
export function openTruckDepot(msg) {
  ensureCardStyles();
  // The bay's payload is the same object with one flag on it (plugins/trucking/index.js
  // pushBayService); where it goes is the only thing that differs.
  if (msg?.service) return openBayService(msg);
  ensureStyles();
  const first = !B || B.mode !== 'yard';
  if (B && B.mode !== 'yard') closeTruckDepot();
  // THE OVERLAY IS AN OUTDOOR EFFECT AND THIS IS A COUNTER. The weather FX layer is pinned over
  // #area-pane, not over the room — so with the depot mounted it rained on the paperwork. Same hard
  // override the cockpit takes when it owns the pane, released in closeTruckDepot.
  suppressWeatherFx(true, 'depot');
  if (first) document.getElementById('area-pane')?.dispatchEvent(new CustomEvent('lookpaneauto'));
  if (first) compactHidePanel('td-hidepanel');
  window.dispatchEvent(new Event('pane:claimed'));   // a phone keeps #area-pane collapsed until told; an app that mounts there has to say so
  const keep = first ? null : B;
  B = {
    mode: 'yard',
    data: msg,
    screen: SCREEN_FOR_TAB[msg.tab] || keep?.screen || 'lot',
    selId: null,
    bench: { tab: 'service', psec: 'scheme', fslot: null, cslot: null, tune: null, paint: null, trim: null },
    lotSel: keep?.lotSel || null,
    boxSel: (msg.trailers || []).some(t => t.id === keep?.boxSel) ? keep.boxSel : (msg.trailers || [])[0]?.id || null,
    toast: keep?.toast || null,
  };
  document.addEventListener('keydown', onKey);
  render();
}

// THE BAY. Mounted into the cab's own wrapper rather than the pane, which the cab owns while you
// are in it — so this never calls `setAreaPane` and never claims the pane.
export function openBayService(msg) {
  ensureStyles();
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
  };
  B.bench.tune = null; B.bench.trim = null;
  if (!was) B.bench.paint = null;
  // A hire truck has only the tabs that do something to it.
  if (hired() && !HIRE_OK.has(B.bench.tab)) B.bench.tab = 'service';
  if (was) noteDeckChange(wasCargo, msg.cargo || null);
  renderService();
}

/** The truck has left the shed (or the cab has shut): take the overlay down and hand the camera back. */
export function closeBayService() {
  if (!B || B.mode !== 'service') return;
  restoreView();
  try { cabPreview({ paint: null }); } catch { /* the cab can already be gone */ }
  document.getElementById('td-svc')?.remove();
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
  document.body.classList.remove('td-fullscreen', 'td-hidepanel');
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
  const nav = [['lot', 'Your trucks', '⌂'], ['buy', 'For sale', '⊕'], ['rent', 'Hire', '⟲']]
    .map(([k, label, ico]) => `<button class="td-tab${B.screen === k ? ' on' : ''}" data-screen="${k}"><span class="td-tab-ico" aria-hidden="true">${ico}</span>${label}</button>`).join('');
  const fs = document.body.classList.contains('td-fullscreen');
  const hp = document.body.classList.contains('td-hidepanel');

  setAreaPane(`<div id="td-root" role="region" aria-label="${esc(d.depot)}">
    <header class="td-head">
      <div class="td-title"><b>${esc(d.depot)}</b><span class="td-dim"> · ${esc(d.regionName || '')}</span></div>
      <nav class="td-nav td-seg">${nav}</nav>
      <div class="td-bal">${money(d.credits)}</div>
      <span class="td-viewbtns">
        <button class="td-x${hp ? ' on' : ''}" data-act="hidepanel" title="hide the text panel, more yard">⊟</button>
        <button class="td-x${fs ? ' on' : ''}" data-act="fullscreen" title="fullscreen">⛶</button>
        <button class="td-x" data-close title="close" aria-label="Close the depot">⏻</button>
      </span>
    </header>
    <div class="td-body">${B.screen === 'buy' ? buyScreen() : B.screen === 'rent' ? rentScreen() : lotScreen()}</div>
    ${B.toast ? `<div class="td-toast${B.toast.kind ? ' ' + B.toast.kind : ''}" aria-hidden="true">${esc(B.toast.text)}</div>` : ''}
    <footer class="td-foot">${footChips()}</footer>
  </div>`);
  wire();
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
      !t.hereNow ? `<button class="vc-mini" data-confirm="yard recall ${esc(t.id)}" title="Bring it here on a low-loader">Tow home · ${money(t.recall)}</button>` : '',
      t.hereNow && !t.rental ? `<button class="vc-mini" data-confirm="yard sell ${esc(t.id)}" title="Sell ${esc(t.name)}">Sell · ${money(t.resale)}</button>` : '',
      t.hereNow && t.rental ? `<button class="vc-mini" data-confirm="yard return ${esc(t.id)}" title="Hand it back early, no refund">Hand it back</button>` : '',
    ].filter(Boolean).join('');
    return `<div class="vc-wrap${here ? '' : ' away'}">
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
  const buyCard = `<div class="vc-wrap"><button class="vc-card slot" data-screen="buy" aria-label="Buy a truck">
      <canvas class="vc-cv" data-slot="buy" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>Buy a truck</b><span class="vc-sub">${(d.stock || []).length} on the line</span></span></button></div>`;
  const hireCard = `<div class="vc-wrap"><button class="vc-card slot" data-screen="rent" aria-label="Hire a truck">
      <canvas class="vc-cv" data-slot="rent" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>Hire a truck</b><span class="vc-sub">${d.hasRental ? 'one out already' : 'by the day, back at any yard'}</span></span></button></div>`;
  return `<div class="td-col td-lot-col">
      ${fleet.length ? '' : '<div class="td-hint">Nothing of yours in the shed. Buy one, or hire one for the afternoon.</div>'}
      <div class="vc-hand">${cards}${buyCard}${hireCard}</div>
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
      ${t.canSell ? tbtn('₵', `Sell · ${money(t.resale)}`, `data-confirm="yard sell ${esc(t.id)}" title="Sell ${esc(t.name)}"`) : ''}
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
  let el = document.getElementById('td-svc');
  if (!el || el.parentElement !== host) {
    el?.remove();
    el = document.createElement('div');
    el.id = 'td-svc';
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    host.appendChild(el);
  }
  const d = B.data, t = selected();
  el.className = 'td-svc' + (B.open ? ' open' : ' folded');
  if (!B.open) {
    el.innerHTML = `<button class="td-svc-chip" data-act="svc-open" title="Open the service bay">⚙ ${esc(d.depot)} · service bay</button>`;
    syncView();
    return;
  }
  const tabs = SVC_TABS.filter(([k]) => !t?.rental || HIRE_OK.has(k))
    .map(([k, l, ico]) => `<button class="td-tab sm${B.bench.tab === k ? ' on' : ''}" data-bench="${k}"><span class="td-tab-ico" aria-hidden="true">${ico}</span>${l}</button>`).join('');
  const body = !t ? '<div class="td-none">The truck is not on the books here.</div>'
    : B.bench.tab === 'tune' ? tuneTab(t) : B.bench.tab === 'kits' ? kitsTab(t) : B.bench.tab === 'paint' ? paintTab(t)
    : B.bench.tab === 'fits' ? fitsTab(t) : B.bench.tab === 'cab' ? cabTab(t) : B.bench.tab === 'badge' ? badgeTab(t)
    : B.bench.tab === 'freight' ? freightScreen() : B.bench.tab === 'market' ? marketScreen() : serviceTab(t);
  el.innerHTML = `
    <header class="td-svc-head">
      <div class="td-title"><b>⚙ ${esc(d.depot)}</b><span class="td-dim"> · ${t ? esc(t.name) : 'service bay'}</span></div>
      <div class="td-bal">${money(d.credits)}</div>
      <button class="td-x" data-act="svc-fold" title="Fold the bay away and drive">Drive out ▸</button>
    </header>
    ${t?.rental ? `<div class="td-svc-hire">Hire truck · ${esc(t.rental.leftText)} · back at any yard: <b>park</b> in a shed and <b>yard return</b></div>` : ''}
    ${d.hitchState ? `<div class="td-svc-pin">${hitchAct(d.hitchState)}</div>` : ''}
    <nav class="td-seg td-svc-tabs">${tabs}</nav>
    <div class="td-side td-svc-body">${body}</div>
    ${B.toast ? `<div class="td-toast${B.toast.kind ? ' ' + B.toast.kind : ''}" aria-hidden="true">${esc(B.toast.text)}</div>` : ''}
    <div class="td-svc-foot td-dim">Roll at the door and it lifts. The bay goes when you leave the shed.</div>`;
  syncView();
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
  const want = !B.open ? null : B.bench.tab === 'cab' ? 'cab' : 'ext';
  try {
    const first = want && B.view == null;
    if (first) B.view = cabView();                              // remember what they had, once
    if (want) cabView(want, { quarter: first });
    else restoreView();
    cabPreview({ paint: B.open && B.bench.tab === 'paint' && B.bench.paint ? paintNow() : null });
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
  const rows = svc.items.map((i) => `
    <div class="td-svc-row ${i.band}">
      <div class="td-main"><b>${esc(i.label)}</b><span class="td-dim"> · ${esc(i.bandLabel)}</span>
        <div class="td-bar" title="${pct(i.life)} left"><i class="s${i.band}" style="width:${Math.round(i.life * 100)}%"></i></div>
        <div class="td-dim td-note">${i.band === 'fresh' ? `About ${i.left.toLocaleString()} tiles before it costs you.` : esc(i.desc)}</div></div>
      <button class="td-act" data-cmd="rig service ${esc(t.id)} ${esc(i.id)}" ${i.life >= 0.995 ? 'disabled title="Just done"' : ''}>${money(i.price)}</button>
    </div>`).join('');
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

// The read-out for one rig: what it is, how worn, how full, and what it is worth. Same facts the
// log rung prints, in the same order, because they are the same facts.
function truckPane(t) {
  return `
    <div class="td-pane">
      <div class="td-pane-head">
        <div><b>${esc(t.name)}</b><div class="td-dim">${esc(t.type)}${t.impound ? ' · <span class="td-warn">IMPOUNDED</span>' : ''}</div></div>
        <span class="td-band ${t.band}">${esc(t.bandLabel)}</span>
      </div>
      <div class="td-dim td-note">${esc(t.bandText)}</div>
      ${t.grimeBand && t.grimeBand !== 'clean'
        ? `<div class="td-dim td-note"><b>${esc(t.grimeLabel)}</b>: ${esc(t.grimeText)}.</div>` : ''}
      <dl class="td-spec">
        <div><dt>condition</dt><dd>${pct(t.condition)}</dd></div>
        <div><dt>fuel</dt><dd>${pct(t.fuel)}</dd></div>
        <div><dt>deck</dt><dd>${t.kg} kg</dd></div>
        <div><dt>tank</dt><dd>${t.tank}</dd></div>
        <div><dt>top</dt><dd>${t.top} mph</dd></div>
        <div><dt>clock</dt><dd>${t.odometer.toLocaleString()}</dd></div>
      </dl>
      ${statBars(t.stats)}
      ${t.kits?.length ? `<div class="td-kits">${t.kits.map(k => `<span class="td-kit">${esc(kitName(k))}</span>`).join('')}</div>` : ''}
      <div class="td-dim td-note">Trade-in ${money(t.resale)}</div>
    </div>`;
}

const kitName = (id) => (B.data.kitCatalog || []).find(k => k.id === id)?.name || id;

// FIVE BARS, and they are the server's numbers. The dial panel redraws these from a PREVIEW the
// server also sent, so what a bar promises and what the wheel delivers are the same derivation.
function statBars(s, prev = null) {
  const ROWS = [['pull', 'Pull'], ['speed', 'Speed'], ['stop', 'Stopping'], ['turn', 'Turn-in'], ['range', 'Range']];
  if (!s) return '';
  return `<div class="td-axes">${ROWS.map(([k, label]) => {
    const v = Math.round((s[k] || 0) * 100), p = prev ? Math.round((prev[k] || 0) * 100) : null;
    const delta = p == null ? '' : v > p ? ' up' : v < p ? ' down' : '';
    return `<div class="td-axis"><span>${label}</span><span class="td-axis-bar"><i class="${delta}" style="width:${v}%"></i></span></div>`;
  }).join('')}</div>`;
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
      ${statBars(t.stats)}
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
  return `<div class="td-pane">${(B.data.kitCatalog || []).map(k => {
    const on = fitted.includes(k.id);
    return `<div class="td-kit-row${on ? ' on' : ''}">
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
  const t = e.target.closest('[data-cmd],[data-screen],[data-bench],[data-lot],[data-box],[data-paintpick],[data-trimpick],[data-psec],[data-fslot],[data-cslot],[data-preset],[data-close],[data-act],[data-confirm],[data-tune-reset],[data-paint-reset],[data-trim-reset],[data-hear],[data-plate]');
  if (!t || t.disabled) return;
  // Closing the counter leaves you standing in the yard, so it has to put the room back — the pane
  // is the room's pane, and a panel that simply removed itself would leave it blank.
  if (t.dataset.close != null) { closeTruckDepot(); return void sendCmdSilent('look'); }
  if (t.dataset.act === 'fullscreen') { document.body.classList.toggle('td-fullscreen'); return void render(); }
  if (t.dataset.act === 'hidepanel') { document.body.classList.toggle('td-hidepanel'); return void render(); }
  // ⚠ FOLDING THE BAY IS NOT LEAVING IT. The shed is still round you and the fitters are still
  // there; the chip in the corner brings it back until the truck rolls out through the door.
  if (t.dataset.act === 'svc-fold') { B.open = false; return void renderService(); }
  if (t.dataset.act === 'svc-open') { B.open = true; return void renderService(); }
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
  // ANYTHING IRREVERSIBLE ASKS — selling, handing a hire back, a tow bill.
  if (t.dataset.confirm) {
    if (t.dataset.armed) { sendCmdSilent(t.dataset.confirm); return; }
    t.dataset.armed = '1'; t.textContent = 'Sure? Click again';
    setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; redraw(); } }, 4000);
    return;
  }
  if (t.dataset.cmd) sendCmdSilent(t.dataset.cmd);
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
  for (const cv of root.querySelectorAll('canvas[data-rent]')) {
    const id = cv.dataset.rent;
    paintVehicleCard(cv, { style: cardStyleFor('hire:' + id), seed: cardSeed('hire:' + id),
      v: { cls: 'truck', variant: `${cv.dataset.variant || id}~p`, livery: truckLivery(B.data.paintDefault || {}, 0), yaw: 0.62, fit: 1.45 } });
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


// WHICH BOX TO DRAW, off the one number that already says how big the thing is. The server's own
// `meshShapeFor` (plugins/trucking/trailers.js) picks the same way for the world renderer, and the
// two must agree or a trailer changes length when you walk out of the shed.
function boxShape(ratedKg) {
  const r = ratedKg || 0;
  return r >= 5000 ? 'continental' : r >= 3200 ? 'drayman' : r >= 2000 ? 'hauler' : 'scrapper';
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
  s.textContent = `
  /* The depot fills its pane exactly (flex column), so the pane itself never scrolls the whole
     interface — only .td-body does, between the pinned head and foot. Same contract #hb-root has. */
  #area-pane:has(#td-root){overflow:hidden}
  #area-content:has(#td-root){height:100%;min-height:0;display:flex;flex-direction:column}
  /* The shell: a moulded chassis, not a flat panel — top sheen, deep outer shadow, edge highlight. */
  #td-root{--td-accent:var(--accent,#d8892e);
    --td-surf:color-mix(in srgb, var(--td-accent) 18%, var(--bg2));
    --td-surf-lo:color-mix(in srgb, var(--td-accent) 6%, var(--bg2));
    --td-surf-mid:color-mix(in srgb, var(--td-accent) 12%, var(--bg2));
    --td-bevel-hi:rgba(255,255,255,.5); --td-bevel-lo:rgba(0,0,0,.45);
    --td-fg:var(--text-bright,var(--text,#eafffb));
    --td-fg-dim:var(--text-dim,#9db5c6);
    --td-fg-dim2:color-mix(in srgb, var(--text-dim,#9db5c6) 60%, transparent);
    position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;
    /* ⚠ AND THE 'white-space' HERE IS WORTH MORE THAN EVERY OTHER SIZE IN THIS FILE PUT
       TOGETHER. The client sets 'pre-wrap' globally because the LOG is prose the server formatted
       with newlines in it — and this panel is markup built out of indented template literals, so
       every line break between two tags was being rendered as a real one. A four-child block cost
       four extra 19px line boxes it drew nothing in: the box detail measured 246px for 76px of
       content, and the same tax was on the read-out, the deck, the boxes and every row. It is not a
       tightening, it is whitespace that was never meant to be there. Anything here that genuinely
       wants the log's behaviour asks for it by name. */
    white-space:normal;
    color:var(--td-fg);font-family:'Courier New',monospace;font-size:14.5px;line-height:1.5;
    background:linear-gradient(175deg,color-mix(in srgb, var(--border) 55%, var(--bg3)) 0%,var(--bg3) 8%,var(--bg2) 50%),
      radial-gradient(140% 100% at 50% 0%,color-mix(in srgb, var(--border) 40%, var(--bg3)),var(--bg) 75%);
    border:1px solid color-mix(in srgb, var(--td-accent) 22%, var(--border));border-radius:10px;overflow:hidden;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(0,0,0,.3),0 14px 34px rgba(0,0,0,.5)}
  /* Brushed-plastic grain over the shell — decorative only, under every real surface. */
  #td-root::before{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;
    background-image:repeating-linear-gradient(35deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px),
      repeating-linear-gradient(-55deg,rgba(0,0,0,.03) 0 1px,transparent 1px 4px)}
  #td-root > *{position:relative;z-index:1}
  /* Head + foot are frosted tablet chrome: a slim accent-tinted glass slab over whatever's behind. */
  .td-head,.td-foot{-webkit-backdrop-filter:blur(11px) saturate(1.15);backdrop-filter:blur(11px) saturate(1.15)}
  /* ⚠ ONE ROW, AND IT HAS TO STAY ONE ROW. At the pane's ordinary width the title wrapped onto two
     lines, the balance broke between the thousands and the units ("24,85 / 0₵") and the fifth tab
     dropped under the other four — a 52px bar drawing 78px of content, so the head ate the top of
     the yard on every screen. Nothing here may wrap: the title takes the slack and ellipsises, the
     balance and the tabs are rigid. The 720px query below is where it is ALLOWED to break, and it
     says so explicitly. */
  .td-head{display:flex;align-items:center;gap:10px;padding:0 12px;height:44px;flex:0 0 auto;
    background:color-mix(in srgb, var(--td-surf) 82%, transparent);
    border-bottom:1px solid color-mix(in srgb, var(--td-accent) 26%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 2px 8px rgba(0,0,0,.14)}
  .td-title{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .td-title b{color:var(--td-fg);letter-spacing:1.2px;text-shadow:0 0 6px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-nav{margin-left:2px;flex:0 0 auto}
  .td-bal{margin-left:auto;flex:0 0 auto;white-space:nowrap;color:var(--td-fg);letter-spacing:1px;font-variant-numeric:tabular-nums;
    text-shadow:0 0 5px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-viewbtns{display:flex;gap:5px;margin-left:6px;flex:0 0 auto}
  .td-x{font-family:inherit;font-size:14px;line-height:1;cursor:pointer;padding:6px 9px;color:var(--td-fg-dim);
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 28%, transparent);border-radius:6px;
    box-shadow:inset 0 1px 0 var(--td-bevel-hi);transition:filter .12s,box-shadow .12s,color .12s,border-color .12s}
  .td-x:hover{filter:brightness(1.1);color:var(--td-fg);border-color:var(--td-accent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 0 10px color-mix(in srgb, var(--td-accent) 28%, transparent)}
  .td-x.on{color:var(--td-fg);border-color:var(--td-accent);
    background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf-lo));
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 32%, transparent),inset 0 1px 0 var(--td-bevel-hi)}
  /* Segmented pill nav — the active tab lifts out of a recessed track and lights a hairline bar
     along its bottom edge. Replaces the underlined-text tabs, which were the single loudest tell
     that this was a web page and the hangar was a device. */
  .td-seg{display:flex;gap:3px;flex-wrap:nowrap;padding:3px;border-radius:8px;
    background:var(--td-surf-lo);border:1px solid var(--border);box-shadow:inset 0 1px 3px var(--td-bevel-lo)}
  .td-tab{position:relative;display:flex;align-items:center;justify-content:center;gap:5px;overflow:hidden;
    font-family:inherit;font:700 11.5px/1 'Courier New',monospace;letter-spacing:.8px;cursor:pointer;white-space:nowrap;
    color:var(--td-fg-dim);background:transparent;border:1px solid transparent;border-radius:6px;padding:6px 10px;
    transition:filter .12s,box-shadow .12s,color .12s,background .12s}
  .td-tab.sm{padding:5px 8px;letter-spacing:.4px}
  .td-tab-ico{font-size:12.5px;line-height:1;opacity:.7;transition:opacity .12s,filter .12s}
  .td-tab:hover{color:var(--td-fg);background:color-mix(in srgb, var(--td-accent) 10%, transparent)}
  .td-tab:hover .td-tab-ico{opacity:1}
  .td-tab.on{color:var(--td-fg);background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border-color:color-mix(in srgb, var(--td-accent) 40%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 1px 3px rgba(0,0,0,.2)}
  .td-tab.on .td-tab-ico{opacity:1;filter:drop-shadow(0 0 5px color-mix(in srgb, var(--td-accent) 70%, transparent))}
  .td-tab.on::after{content:'';position:absolute;left:14%;right:14%;bottom:0;height:2px;border-radius:2px;
    background:var(--td-accent);box-shadow:0 0 8px var(--td-accent);animation:tdTabSlide .22s ease-out}
  @keyframes tdTabSlide{from{left:48%;right:48%;opacity:0}to{left:14%;right:14%;opacity:1}}
  .td-body{flex:1;min-height:0;display:flex;gap:9px;padding:9px 10px;overflow:hidden}
  .td-floor{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;position:relative}
  /* The 3D floor is a recessed viewport — a screen sunk into the chassis, and one of the two things
     that deliberately does NOT follow a light theme. */
  .td-scene{flex:1;min-height:0;width:100%;display:block;border-radius:9px;cursor:pointer;touch-action:none;
    background:radial-gradient(120% 120% at 50% 40%,color-mix(in srgb, var(--td-accent) 13%, var(--bg)),color-mix(in srgb, var(--td-accent) 7%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--td-accent) 22%, transparent);
    box-shadow:inset 0 2px 10px rgba(0,0,0,.45)}
  .td-scene:focus{outline:none;border-color:var(--td-accent)}
  .td-board{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%) scale(.9);z-index:5;
    font:700 15px/1 'Courier New',monospace;letter-spacing:2px;color:var(--td-fg);cursor:pointer;
    padding:9px 16px;border-radius:8px;opacity:0;pointer-events:none;
    background:color-mix(in srgb, var(--td-accent) 30%, rgba(6,12,18,.7));border:1px solid var(--td-accent);
    box-shadow:0 0 16px color-mix(in srgb, var(--td-accent) 45%, transparent);
    text-shadow:0 0 6px color-mix(in srgb, var(--td-accent) 55%, transparent);transition:opacity .18s,transform .18s}
  .td-board.near{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1);animation:tdBoardPulse 1.4s ease-in-out infinite}
  @keyframes tdBoardPulse{0%,100%{box-shadow:0 0 14px color-mix(in srgb, var(--td-accent) 40%, transparent)}
    50%{box-shadow:0 0 22px color-mix(in srgb, var(--td-accent) 70%, transparent)}}
  /* Start-up status line — lit, so a stood-down toolbar still reads as the machine doing something. */
  .td-run{display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border-radius:8px;
    font:700 12.5px/1 'Courier New',monospace;letter-spacing:1.5px;color:var(--td-fg);
    background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf-lo));
    border:1px solid var(--td-accent);box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 0 14px color-mix(in srgb, var(--td-accent) 35%, transparent);
    animation:tdRunPulse 1.1s ease-in-out infinite}
  @keyframes tdRunPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.16)}}
  .td-hint{position:absolute;top:16px;left:18px;right:18px;color:var(--td-fg-dim);font-size:13.5px;max-width:46ch;
    text-shadow:0 1px 3px rgba(0,0,0,.8);pointer-events:none}
  .td-strip{display:flex;gap:7px;flex-wrap:wrap;align-items:center;flex:0 0 auto;padding:7px 9px;border-radius:9px;
    background:color-mix(in srgb, var(--td-surf-lo) 84%, transparent);
    border:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 2px 8px var(--td-bevel-lo),inset 0 1px 0 var(--td-bevel-hi)}
  /* A rig on the strip is a raised surface card, same recipe as the dealer's lot cards. */
  .td-chip{display:flex;flex-direction:column;gap:2px;min-width:118px;text-align:left;padding:5px 9px;cursor:pointer;
    font-family:inherit;color:var(--td-fg);border-radius:8px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 2px 5px rgba(0,0,0,.2);
    transition:filter .12s,box-shadow .12s,border-color .12s}
  .td-chip:hover{filter:brightness(1.08);border-color:var(--td-accent)}
  .td-chip.on{border-color:var(--td-accent);box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 0 12px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-chip.away{opacity:.55}
  .td-chip-name{font-weight:bold;font-size:12.5px;letter-spacing:.4px}
  .td-chip-sub{color:var(--td-fg-dim);font-size:11px}
  .td-side{width:326px;flex:none;overflow:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px}
  /* The read-out is a raised surface card too — the hangar's .hb-info. */
  .td-pane{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:9px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 2px 5px rgba(0,0,0,.2)}
  .td-pane-head{display:flex;align-items:flex-start;gap:8px}
  .td-pane-head b{color:var(--td-fg);font-size:14.5px;letter-spacing:.4px}
  .td-band{margin-left:auto;font:700 10.5px/1 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;
    padding:4px 9px;border-radius:11px;background:var(--td-surf-lo);border:1px solid var(--border)}
  .td-band.sound{color:#6fcf83}.td-band.worked{color:#a8c98a}.td-band.tired{color:#e8c07a}
  .td-band.ailing{color:#d8934e}.td-band.derelict{color:#d2685c}
  /* ⚠ SIX PILLS ON A GRID, NOT ON A WRAPPING ROW. Free-flowing they packed 3/2/1 to a line against
     the width of whatever numbers the truck happened to carry, so the read-out changed height when
     the odometer rolled over — and it is the read-out's height that decides whether the toolbar
     under it is on screen. Two fixed rows of three is the same information in a predictable box. */
  .td-spec{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:1px 0}
  /* Each spec is a recessed vital pill, the hangar's .hb-bench-vital. */
  .td-spec div{display:flex;flex-direction:column;line-height:1.15;padding:2px 7px;border-radius:6px;min-width:0;
    background:var(--td-surf-lo);border:1px solid var(--border);box-shadow:inset 0 1px 2px var(--td-bevel-lo)}
  .td-spec dt{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:var(--td-fg-dim2)}
  .td-spec dd{margin:0;font-size:13px;font-weight:bold;color:var(--td-fg);font-variant-numeric:tabular-nums;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .td-axes{display:flex;flex-direction:column;gap:2px;margin:2px 0}
  .td-axis{display:grid;grid-template-columns:54px 1fr;align-items:center;gap:7px;
    font-size:9.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--td-fg-dim)}
  .td-axis-bar,.td-bar,.td-gauge{background:var(--td-surf-lo);border-radius:4px;overflow:hidden;
    box-shadow:inset 0 1px 2px var(--td-bevel-lo),inset 0 0 0 1px var(--border)}
  .td-axis-bar{height:6px}
  .td-axis-bar i{display:block;height:100%;background:var(--td-accent);box-shadow:0 0 7px currentColor}
  .td-axis-bar i.up{background:#6fcf83}.td-axis-bar i.down{background:#d2685c}
  .td-bar{display:block;height:5px}
  .td-bar i{display:block;height:100%;background:#5c8f6a}
  .td-bar i.ctired{background:#e8c07a}.td-bar i.cailing{background:#d8934e}.td-bar i.cderelict{background:#d2685c}
  .td-gauge{position:relative;height:22px}
  .td-gauge i{display:block;height:100%;background:#5c8f6a;box-shadow:0 0 8px currentColor}
  .td-gauge i.ctired{background:#e8c07a}.td-gauge i.cailing{background:#d8934e}.td-gauge i.cderelict{background:#d2685c}
  .td-gauge span{position:absolute;inset:0;text-align:center;font:700 12px/22px 'Courier New',monospace;color:var(--td-fg);
    text-shadow:0 1px 2px rgba(0,0,0,.7)}
  .td-acts{display:flex;gap:6px;flex-wrap:wrap}
  .td-acts.col{flex-direction:column;align-items:stretch}
  /* ── THE TOOLBAR IS ON THE GLASS AT EVERY WIDTH ────────────────────────────
     The phone query below has pinned it since the day somebody reported not being able to tow a
     truck home, and the diagnosis in it — "the toolbar sits under the read-out, and the read-out is
     taller than a phone" — was never only true of phones. In the pane the sidebar is the scroller,
     and it holds 1,360px of read-out, boxes and deck in about 350px of glass: Take it out, the pin
     and Tow it home all opened two hundred pixels BELOW the fold, on the screen whose whole job is
     to let you do something with the truck you are looking at. Sticky keeps the reading order —
     the machine, then the buttons that act on it — and keeps them where the cursor can reach them.
     ⚠ It needs a surface of its own, because content scrolls underneath it. */
  .td-side > .td-acts{position:sticky;bottom:0;z-index:3;margin:0 -4px;padding:7px 4px;
    background:color-mix(in srgb, var(--td-surf) 90%, transparent);
    -webkit-backdrop-filter:blur(11px) saturate(1.15);backdrop-filter:blur(11px) saturate(1.15);
    border-top:1px solid color-mix(in srgb, var(--td-accent) 26%, transparent);
    box-shadow:0 -6px 14px rgba(0,0,0,.28)}
  /* ⚠ AND A PINNED BAR HAS TO EARN ITS PIXELS, because it is the one thing on this screen that is
     never scrolled away — every row it takes is a row the read-out behind it never gets back. Left
     to wrap, six keys of uppercase at 1px tracking went one to a line and spent 180px of a 300px
     sidebar; two columns put the same six in three rows and half the height with nothing shortened
     and nothing dropped. The two PRIMARY keys take a line to themselves: there is at most one of
     them at a time (you either take the truck out or you tow it home), and it is the one thing on
     the bar somebody is looking for. */
  .td-side > .td-acts{display:grid;grid-template-columns:1fr 1fr;gap:5px}
  .td-side > .td-acts .td-act{justify-content:flex-start;min-width:0;padding:8px 9px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex}
  .td-side > .td-acts .td-act.primary{grid-column:1/-1}
  /* THE 3D KEY. The tablet's bevel language: a raised accent-tinted cap with a bright top highlight
     and a dark bottom bevel that PRESSES IN to a deep inset recess on :active, so every press feels
     like a physical key rather than a link with a border. */
  .td-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;
    font-family:inherit;font-size:11.5px;font-weight:bold;letter-spacing:.5px;text-transform:uppercase;
    cursor:pointer;padding:7px 11px;border-radius:8px;color:var(--td-fg);
    border:1px solid color-mix(in srgb, var(--td-accent) 38%, transparent);
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 4px var(--td-bevel-lo),0 2px 4px rgba(0,0,0,.25);
    transition:filter .12s,box-shadow .12s,transform .05s,border-color .12s}
  .td-ico{font-size:13.5px;line-height:1;opacity:.95}
  .td-act:hover:not(:disabled){filter:brightness(1.1);border-color:var(--td-accent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 4px var(--td-bevel-lo),0 3px 9px rgba(0,0,0,.28),0 0 14px color-mix(in srgb, var(--td-accent) 32%, transparent)}
  .td-act:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 2px 6px var(--td-bevel-lo)}
  .td-act:disabled{opacity:.4;cursor:default;filter:grayscale(.5)}
  /* ⚠ A KEY'S LABEL IS A LABEL, NOT A PARAGRAPH. On a shelf row the button is a flex item with the
     description beside it, so it shrinks — and with nothing stopping it, "2,400₵" broke after the
     2 and the key drew a digit above a comma. The stacked keys on the bench are the one deliberate
     exception, because those really are sentences (see '.td-acts.col' below). */
  .td-act{white-space:nowrap}
  .td-kit-row .td-act,.td-row .td-act{flex:0 0 auto}
  /* The primary key — a stronger accent tint of the theme bg, never a solid accent fill, so the
     high-contrast label stays legible on a light theme and a dark one alike. */
  .td-act.primary{border-color:var(--td-accent);
    background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 32%, var(--bg2)),color-mix(in srgb, var(--td-accent) 15%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 4px var(--td-bevel-lo),0 2px 5px rgba(0,0,0,.28),0 0 14px color-mix(in srgb, var(--td-accent) 35%, transparent)}
  .td-act.ghost{background:linear-gradient(165deg,var(--td-surf-lo),transparent);
    border-color:color-mix(in srgb, var(--td-accent) 22%, transparent);color:var(--td-fg-dim)}
  .td-act.ghost:hover:not(:disabled){color:var(--td-fg)}
  /* A stacked column of choices is a list of sentences, not a row of keys: left-align it and let a
     line wrap, or "Do it yourself · 340₵ — up to 80%, and you can botch it" centres into porridge. */
  /* ⚠ AND IT HAS TO LEAVE FLEX TO DO IT. A stacked key is "Put it through the shop · 980₵" followed
     by "— back to new, no roll", and as a flex box those are TWO ITEMS side by side: the price sat
     in a column of its own while the label wrapped in the middle of a word beside it. Block flow is
     what a sentence wants, and the reason goes under the offer rather than next to it. */
  .td-acts.col .td-act{display:block;text-align:left;text-transform:none;letter-spacing:.4px;line-height:1.35;white-space:normal}
  .td-acts.col .td-act .td-dim{display:block;font-size:11px}
  /* ⚠ THREE TO A ROW, NOT TWO. A 360px minimum put two cards across the pane and the dealer's four
     trucks became two screens of scrolling to compare four numbers — on the one screen whose whole
     job is "look at what you could own side by side". At 290 the whole line fits above the fold on
     an ordinary pane and the schematic is still the biggest thing on the card, which is the part
     that had to be protected. */
  .td-lots{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px;align-content:start;padding:2px}
  .td-lot{padding:10px;border-radius:11px;display:flex;flex-direction:column;gap:5px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 3px 10px rgba(0,0,0,.22);
    transition:filter .12s,box-shadow .12s,border-color .12s}
  .td-lot:hover{filter:brightness(1.05);border-color:var(--td-accent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 5px 16px rgba(0,0,0,.28),0 0 14px color-mix(in srgb, var(--td-accent) 22%, transparent)}
  .td-lot.on{border-color:var(--td-accent)}
  .td-lot.poor{opacity:.62}
  .td-lot-head{display:flex;align-items:center;gap:8px}
  .td-lot-head b{color:var(--td-fg);font-size:15px;letter-spacing:.8px}
  .td-lot-head .td-main{flex:1;min-width:0;overflow:hidden}
  .td-lot-head .td-act{flex:0 0 auto;font-variant-numeric:tabular-nums}
  /* The schematic sits in its own recessed dark viewport, same as the hangar's .hb-lot-view. */
  .td-wf{display:block;width:100%;height:auto;padding:6px;border-radius:9px;
    background:radial-gradient(120% 120% at 50% 40%,color-mix(in srgb, var(--td-accent) 15%, var(--bg)),color-mix(in srgb, var(--td-accent) 8%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--td-accent) 22%, transparent);box-shadow:inset 0 2px 9px rgba(0,0,0,.4)}
  /* ⚠ THE CLAMP REPLACES A 'min-height', WHICH IS THE SAME JOB DONE FROM THE OTHER END. The reserve
     was there so four cards on a row line their specs up whatever length the copywriter ran to, and
     it only ever worked downward — a blurb longer than three lines still pushed its own card taller
     than its neighbours. Clamped, every card spends exactly three lines on the blurb: the row lines
     up, and the tallest card no longer decides how far you scroll. */
  .td-blurb{color:var(--td-fg-dim);font-size:12.5px;line-height:1.35;height:4.05em;overflow:hidden;
    display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3}
  .td-sub-head{grid-column:1/-1;font:700 11px/1 'Courier New',monospace;letter-spacing:3px;text-transform:uppercase;
    color:var(--td-fg-dim);margin:12px 0 2px;padding-bottom:4px;
    border-bottom:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent)}
  .td-rows{grid-column:1/-1;display:flex;flex-direction:column}
  .td-rows.wide{flex:1;overflow:auto}
  .td-row{display:grid;grid-template-columns:1fr 78px 78px 132px 116px;gap:10px;align-items:center;padding:8px 4px;
    border-top:1px solid color-mix(in srgb, var(--td-accent) 14%, transparent)}
  .td-row.head{color:var(--td-fg-dim);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;border-top:0}
  .td-rows .td-row:first-child{border-top:0}
  .td-main{min-width:0}
  .td-num{text-align:right;font-variant-numeric:tabular-nums}
  .td-pay{grid-column:2/5;text-align:right;color:var(--td-fg);font-weight:bold;font-variant-numeric:tabular-nums}
  .td-knob{border-top:1px solid color-mix(in srgb, var(--td-accent) 16%, transparent);padding-top:9px}
  .td-knob-head{display:flex;align-items:baseline;gap:8px}
  .td-knob-head b{letter-spacing:.5px}
  .td-knob-head .td-num{margin-left:auto;color:var(--td-fg);font-weight:bold}
  .td-knob-poles{display:flex;justify-content:space-between;font-size:11px;letter-spacing:1px;color:var(--td-fg-dim2)}
  .td-slider{width:100%;accent-color:var(--td-accent)}
  .td-kit-row{display:flex;gap:10px;align-items:center;padding:9px 0;
    border-top:1px solid color-mix(in srgb, var(--td-accent) 16%, transparent)}
  .td-kit-row.on{opacity:.72}
  .td-fitted{font:700 11px/1 'Courier New',monospace;letter-spacing:1px;color:#6fcf83}
  /* ── THE RIG SHEET ─────────────────────────────────────────────────────────
     Eight cells, two across, and each one answers a question the old shelf made you scroll for:
     what's on this truck, in this place, right now. The cell is also the tab that opens that
     place's shelf, so 'on' (something is fitted here) and 'sel' (this is the one you're looking
     at) have to be legible AT THE SAME TIME and can't share a channel — 'on' is the fitted name
     going green, 'sel' is the accent border every other selected thing in this panel wears. */
  .td-fitsheet{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:2px}
  .td-fitcell{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px;cursor:pointer;text-align:left;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));border-radius:7px;
    border:1px solid color-mix(in srgb, var(--td-accent) 18%, transparent)}
  .td-fitcell:hover{border-color:color-mix(in srgb, var(--td-accent) 55%, transparent)}
  .td-fitcell.sel{border-color:var(--td-accent);
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 28%, transparent),inset 0 1px 0 var(--td-bevel-hi)}
  .td-fitslot{font:700 9.5px/1 'Courier New',monospace;letter-spacing:1.6px;text-transform:uppercase;color:var(--td-fg-dim2)}
  /* The empty state is italic and dim; the filled one is the same green the FITTED tag uses on the
     kits tab, because "there's something here" is one idea and shouldn't be two colours. */
  .td-fitwhat{font:400 11.5px/1.2 'Courier New',monospace;color:var(--td-fg-dim2);font-style:italic;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
  .td-fitcell.on .td-fitslot{color:var(--td-fg-dim)}
  .td-fitcell.on .td-fitwhat{color:#6fcf83;font-style:normal}
  /* "You already paid for this one." The price the server quotes is zero for anything in the
     drawer, so this tag and the button's own label come off the same fact. */
  .td-drawer{margin-left:7px;padding:2px 5px;border-radius:8px;vertical-align:1px;
    font:700 9px/1 'Courier New',monospace;letter-spacing:1.2px;color:var(--td-accent);
    border:1px solid color-mix(in srgb, var(--td-accent) 40%, transparent)}
  .td-kits{display:flex;gap:5px;flex-wrap:wrap}
  .td-kit{font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;border-radius:11px;
    color:var(--td-fg-dim);background:var(--td-surf-lo);border:1px solid var(--border)}
  /* ── THE BOOTH ─────────────────────────────────────────────────────────────
     Four screens behind one segmented control, and every row on them is the same two shapes: a
     swatch (a thing you pick) or a well (a colour you set). Nothing here is bespoke to one
     section, which is what keeps a seven-colour booth from reading as seven different widgets. */
  .td-seg.wide{display:flex;gap:4px;margin-bottom:10px;padding:3px;border-radius:9px;
    background:var(--td-surf-lo);border:1px solid var(--border)}
  .td-seg-btn{flex:1;padding:6px 4px;cursor:pointer;border:0;border-radius:6px;background:transparent;
    font:700 10.5px/1 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim2)}
  .td-seg-btn:hover{color:var(--td-fg)}
  .td-seg-btn.on{color:var(--td-fg);background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf-lo));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 0 8px color-mix(in srgb, var(--td-accent) 24%, transparent)}
  /* A scheme card: the whole truck as six chips, then its name, then what it's wearing. */
  .td-schemes{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
  .td-scheme{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:7px 8px;cursor:pointer;text-align:left;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));border-radius:8px;
    border:1px solid color-mix(in srgb, var(--td-accent) 20%, transparent);color:var(--td-fg-dim)}
  .td-scheme:hover{border-color:color-mix(in srgb, var(--td-accent) 55%, transparent);color:var(--td-fg)}
  .td-scheme.on{border-color:var(--td-accent);color:var(--td-fg);
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 30%, transparent),inset 0 1px 0 var(--td-bevel-hi)}
  .td-scheme b{font:700 11.5px/1.2 'Courier New',monospace;letter-spacing:.6px;text-transform:uppercase}
  .td-scheme .td-dim{font-size:10.5px;line-height:1.25}
  .td-chips{display:flex;width:100%;border-radius:3px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
  .td-chips .td-pchip{flex:1;height:14px;border-radius:0;box-shadow:none}
  .td-pchip{width:11px;height:16px;border-radius:2px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.45)}
  /* A colour row: the well, what it paints, and the hex. Grid, so seven of them line up. */
  .td-crows{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}
  .td-crow{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;
    padding:5px 6px;border-radius:7px;cursor:pointer}
  .td-crow:hover{background:var(--td-surf-lo)}
  .td-crow.off{opacity:.45}
  /* The mix, while it's the one fitted. Same accent the selected swatch wears, so "this is the
     one you have chosen" reads the same on a row of wells as it does on a row of buttons. */
  .td-crows.on{box-shadow:inset 2px 0 0 var(--td-accent);padding-left:6px;border-radius:7px}
  .td-cname{display:flex;flex-direction:column;gap:1px;font:700 11.5px/1.1 'Courier New',monospace;
    letter-spacing:.6px;text-transform:uppercase;color:var(--td-fg)}
  .td-cname .td-dim{font:400 11px/1.25 inherit;letter-spacing:0;text-transform:none}
  .td-chex{font:400 10.5px/1 'Courier New',monospace;color:var(--td-fg-dim2)}
  /* ⚠ THE WELL IS '.td-well', AND IT USED TO BE '.td-col'. So did the column the freight board and
     the exchange stack themselves in (see '.td-col' below), and the two rules landed in one file
     forty lines apart: a 38×30 swatch is a cross-axis HEIGHT, which 'flex:1' does not override, so
     both boards drew their column at thirty pixels tall and every row on them spilled out of the
     panel — unpainted, and with no scroll container to reach them in. One class, two ideas, and the
     symptom was on the screens neither rule mentions. */
  .td-well{width:38px;height:30px;border:1px solid color-mix(in srgb, var(--td-accent) 35%, transparent);
    border-radius:6px;background:var(--td-surf-lo);cursor:pointer;box-shadow:inset 0 1px 0 var(--td-bevel-hi);padding:2px}
  /* ── The interior, and its still ────────────────────────────────────────────
     A dashboard is a slab under a header rail with two lit dials in it, and that's exactly what
     this is — the colourway's own gradient, the material's grain, the gloss on the lip. */
  .td-dashmock{position:relative;display:block;height:96px;border-radius:9px;overflow:hidden;margin-bottom:4px;
    border:1px solid var(--border);box-shadow:inset 0 2px 8px rgba(0,0,0,.5)}
  .td-dm-hdr{position:absolute;inset:0 0 auto 0;height:22px}
  .td-dm-slab{position:absolute;inset:22px 0 0 0;display:block}
  .td-dm-grain,.td-dm-lip{position:absolute;inset:0;display:block;pointer-events:none}
  .td-dm-lip{inset:auto 0 auto 0;top:0;height:2px}
  .td-dm-dials{position:absolute;left:0;right:0;top:14px;display:flex;justify-content:center;gap:18px}
  .td-dial{position:relative;width:38px;height:38px;border-radius:50%;display:block}
  .td-dial i{position:absolute;left:50%;top:50%;width:2px;height:15px;margin-left:-1px;
    border-radius:1px;transform-origin:50% 100%;translate:0 -15px}
  .td-dm-cap{margin-bottom:10px}
  .td-tswatches{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
  .td-tswatch{display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px 6px;cursor:pointer;
    font:700 10px/1 'Courier New',monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--td-fg-dim);
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));border-radius:7px;
    border:1px solid color-mix(in srgb, var(--td-accent) 20%, transparent)}
  .td-tswatch:hover{color:var(--td-fg);border-color:color-mix(in srgb, var(--td-accent) 55%, transparent)}
  .td-tswatch.on{border-color:var(--td-accent);color:var(--td-fg);
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-tchip{position:relative;width:34px;height:20px;border-radius:3px;display:block;
    box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
  .td-tchip i{position:absolute;right:4px;bottom:4px;width:4px;height:4px;border-radius:50%}
  .td-swatches{display:flex;gap:5px;flex-wrap:wrap}
  .td-swatch{padding:6px 10px;font:700 11.5px/1 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;
    color:var(--td-fg-dim);border-radius:7px;cursor:pointer;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 1px 3px rgba(0,0,0,.2);transition:filter .12s,border-color .12s,color .12s}
  .td-swatch:hover{filter:brightness(1.1);color:var(--td-fg)}
  .td-swatch.on{border-color:var(--td-accent);color:var(--td-fg);
    background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf-lo));
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 32%, transparent),inset 0 1px 0 var(--td-bevel-hi)}
  .td-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--td-fg-dim)}
  .td-check input{accent-color:var(--td-accent)}
  .td-deck{padding:7px 9px;border-radius:9px;background:var(--td-surf-lo);
    border:1px solid var(--border);box-shadow:inset 0 1px 3px var(--td-bevel-lo)}
  /* The two boards stack their own contents — .td-body is a flex ROW (see freightScreen). */
  .td-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px}
  /* A caption, not a card: one row, wrapping only when the load is long enough to need it, with the
     ledge between items doing the work three stacked lines used to. */
  .td-deckstrip{flex:0 0 auto;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;font-size:13px}
  .td-deckstrip .td-lab{display:inline}
  /* The row you're already carrying: lit down its leading edge, the same channel the selected box
     row uses, so "this one is yours" reads the same way everywhere in the panel. */
  .td-row.taken{background:color-mix(in srgb,var(--td-accent) 9%,transparent);
    box-shadow:inset 2px 0 0 var(--td-accent)}
  /* …and its marker sits where the button it replaced sat. */
  .td-row .td-fitted{text-align:center}
  /* THE NOTICE. Pinned over the body rather than pushed into it, because a strip that reflows the
     board would move the button under the cursor at the exact moment the player is looking at it.
     One 5.2s animation, matching the timer in showToast — there's no second clock. */
  #td-root .td-toast{position:absolute;left:50%;bottom:64px;z-index:6;max-width:min(78%,64ch);
    transform:translateX(-50%);pointer-events:none;text-align:center;
    font:700 12.5px/1.4 'Courier New',monospace;letter-spacing:1px;color:var(--td-fg);
    padding:9px 16px;border-radius:8px;
    background:color-mix(in srgb, var(--td-accent) 26%, rgba(6,12,18,.86));
    border:1px solid var(--td-accent);
    box-shadow:0 0 18px color-mix(in srgb, var(--td-accent) 40%, transparent),inset 0 1px 0 var(--td-bevel-hi);
    animation:tdToast 5.2s ease-out forwards}
  #td-root .td-toast.good{border-color:#6fcf83;color:#d9f5df;
    background:color-mix(in srgb, #6fcf83 22%, rgba(6,12,18,.86));
    box-shadow:0 0 18px rgba(111,207,131,.35),inset 0 1px 0 var(--td-bevel-hi)}
  @keyframes tdToast{0%{opacity:0;transform:translate(-50%,10px)}
    7%{opacity:1;transform:translate(-50%,0)}
    86%{opacity:1;transform:translate(-50%,0)}
    100%{opacity:0;transform:translate(-50%,-4px)}}
  @media (prefers-reduced-motion:reduce){#td-root .td-toast{animation:tdToastFade 5.2s linear forwards}
    @keyframes tdToastFade{0%,90%{opacity:1}100%{opacity:0}}}
  /* The boxes you own, under the deck read-out — a list, because a trailer is a capacity and a
     place rather than something you look at from three angles. */
  .td-boxes{margin-top:6px}
  /* ⚠ ONE LINE PER BOX. Wrapping, a row was the name, the rating, where it is and what is on it,
     then two keys — four to six flex items in a 300px column, which came out 80px tall EACH, so
     three trailers were 240px of a sidebar that has 350px in it. The facts are one ellipsised run
     now and the keys hold the right-hand end; the DETAIL panel underneath is where the full text
     already lives, which is what the row selection is for. */
  .td-box-row{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;font-size:12.5px;padding:3px 6px;
    border-top:1px solid var(--border);cursor:pointer;border-radius:4px}
  .td-box-what{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .td-box-why{flex:0 0 auto;white-space:nowrap;font-size:11px}
  .td-box-row:hover{background:color-mix(in srgb,var(--td-accent) 8%,transparent)}
  .td-box-row.on{background:color-mix(in srgb,var(--td-accent) 15%,transparent);
    box-shadow:inset 2px 0 0 var(--td-accent)}
  .td-box-detail{margin-top:5px;padding:7px 8px;border-radius:5px;font-size:12.5px;
    background:color-mix(in srgb,var(--td-accent) 6%,transparent);
    border:1px solid color-mix(in srgb,var(--td-accent) 22%,transparent)}
  /* Two columns rather than a wrapping row: four facts that each fit half the width were taking a
     line apiece, because the longest of them ("Standing here") decided the wrap for all of them. */
  .td-box-stats{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin-top:4px;font-size:12px}
  .td-box-row:first-of-type{border-top:0}
  .td-box-row .td-act{margin-left:auto;padding:2px 8px;font-size:11px}
  .td-lab{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim2);display:block}
  .td-none{color:var(--td-fg-dim);padding:14px;text-align:center}
  .td-dim{color:var(--td-fg-dim)}
  .td-note{font-size:12.5px}
  .td-good{color:#6fcf83}
  .td-warn{color:#ffb26b}
    .td-foot{flex:0 0 auto;padding:7px 10px;font-size:11.5px;color:var(--td-fg-dim);
    background:color-mix(in srgb, var(--td-surf-lo) 84%, transparent);
    border-top:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi)}
  /* The footer verbs. They're buttons, so they look pressable: a raised chip that lifts under the
     cursor and sits down when armed — never the flat dim <code> they used to be, which read as
     documentation and was ignored accordingly. */
  .td-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .td-verb{font:inherit;font-size:11.5px;color:var(--td-fg);cursor:pointer;
    background:linear-gradient(180deg,color-mix(in srgb, var(--td-surf) 92%, transparent),var(--td-surf-lo));
    padding:4px 9px;border-radius:6px;
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, var(--border));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 1px 2px rgba(0,0,0,.25);
    transition:transform .08s ease,border-color .12s ease,background .12s ease}
  .td-verb:hover{border-color:color-mix(in srgb, var(--td-accent) 62%, var(--border));transform:translateY(-1px);
    background:linear-gradient(180deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf))}
  .td-verb:active{transform:translateY(0);box-shadow:inset 0 1px 3px var(--td-bevel-lo)}
  .td-verb:focus-visible{outline:2px solid color-mix(in srgb, var(--td-accent) 70%, transparent);outline-offset:2px}
  .td-verb[data-armed]{border-color:#ffb26b;color:#ffb26b}
  /* The one in-theme scrollbar recipe: an accent-lit thumb in a recessed track, never the OS slab. */
  .td-side,.td-lots,.td-rows.wide{scrollbar-width:thin;scrollbar-color:color-mix(in srgb, var(--td-accent) 55%, var(--border)) transparent}
  .td-side::-webkit-scrollbar,.td-lots::-webkit-scrollbar,.td-rows.wide::-webkit-scrollbar{width:7px;height:7px}
  .td-side::-webkit-scrollbar-track,.td-lots::-webkit-scrollbar-track,.td-rows.wide::-webkit-scrollbar-track{
    background:var(--td-surf-lo);border-radius:4px;box-shadow:inset 0 0 3px var(--td-bevel-lo)}
  .td-side::-webkit-scrollbar-thumb,.td-lots::-webkit-scrollbar-thumb,.td-rows.wide::-webkit-scrollbar-thumb{border-radius:4px;
    background:linear-gradient(180deg,color-mix(in srgb, var(--td-accent) 70%, var(--bg2)),color-mix(in srgb, var(--td-accent) 35%, var(--bg2)));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi)}
  /* ── THE PHONE ──────────────────────────────────────────────────────────────
     Three faults, and the first is why the other two were never reported.

     ⚠ THE BODY CLIPPED WHAT IT COULDN'T FIT AND NOTHING SCROLLED. Side by side, the row
     layout bounds .td-side and .td-side scrolls itself, so 'overflow:hidden' on the body
     is right — it's what stops the pane scrolling the whole device. Stacked into a
     column that bound is gone: .td-side is 'flex:none', so it stands at its content
     height (1,229px on the yard screen) inside a 547px body, and the 973px difference
     was painted nowhere and reachable by nothing. That is the whole of "I can't tow my
     truck home" — the toolbar sits under the read-out, and the read-out is taller than
     a phone. So the BODY is the scroller here and .td-side is just tall.

     ⚠ THE HEAD IS A 52px ROW AND THE TAB STRIP WRAPPED INSIDE IT. Five tabs want 425px
     and get 328, so .td-seg's own 'flex-wrap' stacked them into a 231px column centred
     in a 52px head: two tabs above the top of the panel, where #td-root's 'overflow'
     ate them, and two below it over the yard. Four of the five screens had no reachable
     way in. The head's rows are real rows now, and the tabs get one to themselves —
     scrolling sideways rather than wrapping, because a strip that doesn't fit is a strip
     you swipe, and one that wraps is one that lies about its height.

     ⚠ AND THE VERBS ARE PINNED RATHER THAN REORDERED. Moving .td-acts to the top of the
     column would look the same and would put the buttons ahead of the machine they act
     on for anybody reading in DOM order. Sticky keeps the order and keeps them on the
     glass, which is what the toolbar is for. */
  @media (max-width:900px){
    /* The stack, and the scroller that has to come with it. */
    .td-body{flex-direction:column;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}
    .td-side{width:auto;flex:0 0 auto;overflow:visible}
    /* The floor stops being the thing that takes up the slack: in a scrolling column
       'flex:1' has no slack to take, and a canvas with no height at all is a canvas at 0. */
    .td-floor{flex:0 0 auto}
    .td-scene{flex:0 0 auto;height:min(30vh,200px)}
    /* The toolbar's own pin is no longer this query's business — it is sticky at every width now
       (see '.td-side > .td-acts' above), which is where the argument written here always led. What
       IS this query's is the scrollport it sticks to: stacked, the BODY is the scroller and the
       sidebar is merely tall, so the bar has to stick to the body rather than to a column that no
       longer clips anything — and sticky resolves against the nearest scroller on its own, so the
       stack needs no rule of its own for it. */
  }
  /* The head repack is a separate question from the stack: at 880px the columns won't sit
     side by side and the head is still fine, and it's the head that decides this one. 720px
     is where the title, five tabs, the balance and three buttons stop fitting on a line —
     and it's the breakpoint the rest of the client already turns at. */
  @media (max-width:720px){
    .td-head{height:auto;min-height:44px;flex-wrap:wrap;padding:7px 10px;gap:6px 10px;row-gap:6px}
    /* ⚠ A BASIS, NOT auto. flex-wrap breaks the line before it shrinks anything, so a title at its
       natural 171px pushed the three window buttons onto a row of their own and the head cost 110px
       for two rows of content. Given a basis the three fit on one line and the title takes the slack. */
    .td-title{flex:1 1 110px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* The region is on the sign outside and on every other screen in the app; the depot's
       own name is the thing this line has to get across. */
    .td-title .td-dim{display:none}
    .td-bal{white-space:nowrap;font-size:13px}
    /* The depot name is 16 characters of 14.5px mono at 2px tracking — 171px of a 148px slot, so
       it arrived on a phone already ellipsised. It fits at the chrome size around it. */
    .td-title b{font-size:13px;letter-spacing:1px}
    .td-viewbtns{margin-left:0}
    /* A row of its own, full width, swipeable. */
    .td-nav{order:3;flex:1 0 100%;margin-left:0}
    .td-seg{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:3px;gap:2px}
    .td-seg::-webkit-scrollbar{display:none}
    /* ⚠ THEY SHRINK RATHER THAN SCROLL. Five tabs want 336px of a 334px strip — two pixels over,
       which as a scroller reads as a broken last tab rather than as a row you swipe. Shrinking
       fits them at any width and only spends an ellipsis on a phone narrower than this one; the
       overflow above is the last resort it now almost never reaches. display:block because the
       icon is gone, and text-overflow has nothing to trim inside a flex container. */
    .td-tab{display:block;flex:0 1 auto;min-width:0;padding:6px 5px;font-size:11px;letter-spacing:.2px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
    /* The glyph is decoration (it's aria-hidden), and decoration is what a 328px strip
       gives up first. */
    .td-tab .td-tab-ico{display:none}
    /* ⚠ ONE ROW, NOT FOUR. The footer wrapped to 157px — a fifth of the screen, spent on
       chips that mostly repeat the toolbar four inches above them. Same chips, same order,
       one swipeable line. */
    .td-foot{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:8px 10px;gap:6px}
    .td-foot::-webkit-scrollbar{display:none}
    .td-verb{flex:0 0 auto;white-space:nowrap}
    /* The two-column bar argued for here is the desktop bar's now as well, for the same reason in
       a bigger box — see the rule above. What is left for a phone is the type. */
    .td-side > .td-acts .td-act{padding:9px 8px;letter-spacing:.3px}
  }
  @media (prefers-reduced-motion:reduce){.td-board.near,.td-run{animation:none}.td-tab.on::after{animation:none}}
  /* The hint above the hand is in the flow; the old floor screen floated it over a 3-D scene. */
  .td-lot-col{overflow:auto;padding-right:2px}
  .td-lot-col .td-hint{position:static;transform:none;margin:0 0 4px;max-width:none}
  /* ── THE BAY ─────────────────────────────────────────────────────────────
     A panel docked on the right of the glass, inside the cab's own wrapper. It never covers the
     road ahead and it never covers the dash: the top is below the glass chrome, the bottom stops
     above the shelf, and folded it is one chip. */
  #td-svc{--td-accent:var(--accent,#d8892e);
    --td-surf:color-mix(in srgb, var(--td-accent) 18%, var(--bg2));
    --td-surf-lo:color-mix(in srgb, var(--td-accent) 6%, var(--bg2));
    --td-surf-mid:color-mix(in srgb, var(--td-accent) 12%, var(--bg2));
    --td-bevel-hi:rgba(255,255,255,.5); --td-bevel-lo:rgba(0,0,0,.45);
    --td-fg:var(--text-bright,var(--text,#eafffb));
    --td-fg-dim:var(--text-dim,#9db5c6);
    --td-fg-dim2:color-mix(in srgb, var(--text-dim,#9db5c6) 60%, transparent);
    position:absolute;z-index:40;right:10px;top:46px;white-space:normal;
    color:var(--td-fg);font-family:'Courier New',monospace;font-size:13.5px;line-height:1.45}
  #td-svc.open{bottom:12%;width:min(620px,58%);display:flex;flex-direction:column;gap:6px;padding:8px;
    background:color-mix(in srgb, var(--bg2) 86%, transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
    border:1px solid color-mix(in srgb, var(--td-accent) 36%, var(--border));border-radius:10px;
    box-shadow:0 12px 30px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08)}
  #td-svc.folded{right:auto;left:10px;top:46px}
  .td-svc-chip{font-family:inherit;font-size:12px;letter-spacing:.8px;cursor:pointer;padding:6px 11px;border-radius:7px;color:var(--td-fg);
    background:color-mix(in srgb, var(--bg2) 80%, transparent);border:1px solid var(--td-accent);
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-svc-head{display:flex;align-items:center;gap:8px;flex:0 0 auto}
  .td-svc-head .td-title{flex:1 1 auto}
  .td-svc-hire,.td-svc-pin{flex:0 0 auto;font-size:11.5px;padding:4px 8px;border-radius:6px;background:var(--td-surf-lo);
    border:1px solid color-mix(in srgb, #5aa58c 60%, transparent)}
  .td-svc-pin{border-color:color-mix(in srgb, var(--td-accent) 40%, transparent)}
  .td-svc-tabs{flex:0 0 auto;flex-wrap:wrap;gap:2px}
  #td-svc .td-side.td-svc-body{width:auto;flex:1 1 auto;min-height:0}
  #td-svc .td-toast{position:absolute;left:50%;bottom:36px;transform:translateX(-50%);z-index:6;max-width:90%}
  .td-svc-foot{flex:0 0 auto;font-size:11px;text-align:center}
  .td-svc-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid color-mix(in srgb, var(--border) 60%, transparent)}
  .td-svc-row:last-of-type{border-bottom:0}
  .td-svc-row .td-bar{margin:3px 0 1px}
  .td-bar i.sfresh{background:#5c8f6a}.td-bar i.sdue{background:#e8c07a}.td-bar i.sover{background:#d2685c}
  .td-svc-row.over b{color:#f0a097}
  .td-plateform{display:flex;gap:6px}
  .td-plate-in{flex:1 1 auto;min-width:0;font-family:inherit;font-size:13px;padding:5px 7px;border-radius:6px;color:var(--td-fg);
    background:var(--td-surf-lo);border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);text-transform:uppercase}
  @media (max-width:720px){ #td-svc.open{left:8px;right:8px;width:auto;bottom:38%} }
  `;
  document.head.appendChild(s);
}
