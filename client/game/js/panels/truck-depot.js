// THE LONG HAUL — the depot, as a place rather than a table.
//
// This was a 250-line modal with four tabs and three numbers per truck, sitting over the road
// because you had walked across a particular kerb. The hangar it was supposedly modelled on is a
// PANE APP with a 3D floor you can click a machine on, a walkaround camera, a dealer's lot and a
// mechanic's bench — and the gap between the two was the whole difference between owning an
// aircraft and owning a truck.
//
// So this is the same application, for trucks, in the same place (see `render` for why the pane
// rather than an overlay, and `ensureStyles` for why it wears the same paint), and almost none of
// it is new code:
//
//   the floor      drawHangarScene (aircraft3d.js) with venue 'garage' — ONE room, one camera,
//                  every rig you own parked in it side by side, click-selected by hit-testing the
//                  scene's own returned regions. The only change that had to be made to the
//                  renderer was letting an entry carry a `variant`, because which of the four
//                  trucks a thing is does not fit in `cls`.
//   the walkaround drawHangarFloorBay with a free camera — the same WASD/orbit inspect the hangar
//                  has, around a truck instead of an aeroplane.
//   the lot        drawWireframe3D, big — a schematic of the actual mesh you will own, not an
//                  illustration of one, and large enough to read the thing you are buying.
//   the bench      the same hero shot with the dials underneath it.
//
// THREE RULES, all inherited and all load-bearing:
//
//  1. THE CLIENT COMPUTES NOTHING. Affordability, resale, repair prices, the performance bars, the
//     spread against the last market you stood in — every one of them arrives as a fact. What this
//     file decides is where a rectangle goes.
//
//  2. EVERY BUTTON IS A VERB STRING A PLAYER COULD HAVE TYPED. `yard buy krell`, `rig repair shop`,
//     `rig tune 1 0 -0.5 0`, `haul 2`, `drive`. That is what keeps the log rung honest: the panel
//     is a skin over the commands, so anything you can click you can also type, and the text rung
//     is not a second implementation of the depot.
//
//  3. THE PANEL NEVER GUESSES WHAT CHANGED. Every mutating command re-pushes the whole payload
//     from the server (plugins/trucking/index.js repush), and this file simply redraws. Optimistic
//     local edits are how the old panel came to show a Buy button on a truck you already owned.

import { setAreaPane } from '../render.js';
import { sendCmdSilent } from '../net.js';
import { drawWireframe3D, themeColor } from './wireframe-plane.js';
import { drawHangarScene, drawHangarFloorBay, pickSceneHit, truckLivery } from './aircraft3d.js';
// ⚠ THE DERIVATION, NOT A CATALOGUE. Everything else this panel draws comes off the wire (see the
// ⚠ in paintTab) — but a mixed interior is previewed while the player is still dragging the well,
// so there is no committed value for the server to have sent. This is the same function the cab
// renderer resolves a mixed colourway through, imported rather than reimplemented, which is what
// makes the picture and the cab provably the same three-picks-to-fourteen-values arithmetic.
import { customColourway, CUSTOM_COL } from '../../../shared/cab-trim.js';
import { suppressWeatherFx } from './weather-fx.js';

let B = null;             // { data, screen, selId, inspect, bench }
let raf = null;
let sceneHits = [];
let yaw = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Icon + label chip, the hangar's `tbtn` verbatim (hangar-bay.js): the glyph is decoration and the
// word beside it is the button's real name, so the icon is hidden from the accessible tree —
// otherwise "Sell" is announced as "credit Sell".
const tbtn = (icon, label, attrs = '', cls = '') =>
  `<button class="td-act${cls ? ' ' + cls : ''}" ${attrs}><span class="td-ico" aria-hidden="true">${icon}</span>${label}</button>`;
const money = (n) => `${Number(n || 0).toLocaleString()}₵`;
const pct = (n) => `${Math.round((n || 0) * 100)}%`;

// Which screen a server-sent tab lands on. The server thinks in tabs because the log rung does;
// this file thinks in screens because it has a floor and a walkaround that no tab ever named.
const SCREEN_FOR_TAB = { fleet: 'floor', buy: 'buy', freight: 'freight', market: 'market', bench: 'bench' };

export function isTruckDepotActive() { return !!B; }
// The walkaround drives a first-person WASD camera, so — exactly like the flight sim and the
// hangar — it has to OWN those keys while it is up: the MUD's wasd-move (main.js) and the
// type-anywhere auto-focus (input.js) both stand down on this.
//
// This was never wired, and as a fixed overlay it very nearly got away with it: `preventDefault`
// does not stop propagation, so holding W to walk down the flank of your own truck was also
// sending you north. In the pane, where the room description is right there behind the panel,
// that is not a bug you could fail to notice — so it is wired the way the hangar wires it.
export function isTruckDepotWalkActive() {
  return !!(B && B.screen === 'inspect' && B.inspect?.mode === 'walk');
}

export function openTruckDepot(msg) {
  ensureStyles();
  const first = !B;
  // THE OVERLAY IS AN OUTDOOR EFFECT AND THIS IS A SHED. The weather FX layer is pinned over
  // #area-pane, not over the room — so with the depot mounted it rained *inside the garage*, over
  // a 3D scene that already draws its own lighting. Same hard override the cockpit takes when it
  // owns the pane (weather-fx.js `suppressed`), released in closeTruckDepot.
  suppressWeatherFx(true, 'depot');
  // Snap the top pane back to its default auto size so the whole depot fits, whatever manual drag
  // height was left on the previous room look. The hangar does exactly this on a fresh open.
  if (first) document.getElementById('area-pane')?.dispatchEvent(new CustomEvent('lookpaneauto'));
  const keepSel = B?.selId || null;
  B = {
    data: msg,
    screen: SCREEN_FOR_TAB[msg.tab] || (first ? 'floor' : B?.screen) || 'floor',
    selId: (msg.fleet || []).some(t => t.id === keepSel) ? keepSel : (msg.fleet || [])[0]?.id || null,
    inspect: B?.inspect || inspectDefault(),
    bench: B?.bench || { tab: 'condition', psec: 'scheme', tune: null, paint: null, trim: null },
    lotSel: B?.lotSel || null,
  };
  // A fresh truck selected (you just bought one) resets any half-turned dials — they belonged to a
  // different machine, and carrying them across would silently propose a tune nobody asked for.
  B.bench.tune = null; B.bench.paint = null; B.bench.trim = null;
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  render();
}

export function closeTruckDepot() {
  suppressWeatherFx(false, 'depot');
  if (raf) cancelAnimationFrame(raf);
  raf = null; sceneHits = []; walkKeys.clear();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('keyup', onKeyUp);
  // Drop the immersive layout, or the room look that follows is left with no log and no command
  // box — the hangar learned this one the hard way and clears both classes on the way out too.
  document.body.classList.remove('td-fullscreen', 'td-hidepanel');
  document.getElementById('td-root')?.remove();
  B = null;
}

const selected = () => (B?.data.fleet || []).find(t => t.id === B.selId) || null;

// ── Render ───────────────────────────────────────────────────────────────────
// THE DEPOT IS A PANE APP, not a modal over one.
//
// It used to be a fixed overlay filling the viewport, dimming the game behind it and closing on
// a ✕ — while the hangar it is modelled on mounts in #area-pane like the flight cockpit does, with
// the log and the command box still live underneath. That is not decoration: it is the difference
// between a screen you are USING and a screen you are TRAPPED IN. In the pane you can still read
// what the room is saying, still type, still watch the log answer the buttons you are pressing —
// which matters most in exactly this panel, because every button here is a command and the log is
// where its reply lands. A modal hid the other half of its own interaction.
//
// So it mounts through setAreaPane, carries the same ⊟/⛶ immersive toggles the sim and the hangar
// carry, and backs out one screen at a time on Escape rather than slamming shut. The one cost is
// that setAreaPane rebuilds the subtree on every render, so the delegated listeners are re-bound
// each time (`wire`) — on a node that is always brand new, which is why that cannot stack up.
function render() {
  if (!B) return;
  const d = B.data;
  const nav = [['floor', 'The Yard', '⌂'], ['buy', 'For Sale', '⊕'], ['bench', 'Bench', '⚙'], ['freight', 'Freight', '▤'], ['market', 'Exchange', '₵']]
    .map(([k, label, ico]) => `<button class="td-tab${B.screen === k ? ' on' : ''}" data-screen="${k}"><span class="td-tab-ico" aria-hidden="true">${ico}</span>${label}</button>`).join('');

  // The same immersive pair the sim and the hangar carry: ⊟ folds away the scrollback (the command
  // box stays), ⛶ fills the whole column. Their lit state is read off the body class, so it
  // survives every re-render without being held anywhere.
  const fs = document.body.classList.contains('td-fullscreen');
  const hp = document.body.classList.contains('td-hidepanel');

  setAreaPane(`<div id="td-root" role="region" aria-label="${esc(d.depot)}">
    <header class="td-head">
      <div class="td-title"><b>${esc(d.depot)}</b><span class="td-dim"> · ${esc(d.regionName || '')}</span></div>
      <nav class="td-nav td-seg">${nav}</nav>
      <div class="td-bal">${money(d.credits)}</div>
      <span class="td-viewbtns">
        <button class="td-x${hp ? ' on' : ''}" data-act="hidepanel" title="hide the text panel — more yard">⊟</button>
        <button class="td-x${fs ? ' on' : ''}" data-act="fullscreen" title="fullscreen">⛶</button>
        <button class="td-x" data-close title="close" aria-label="Close the depot">⏻</button>
      </span>
    </header>
    <div class="td-body">${
      B.screen === 'buy' ? buyScreen()
      : B.screen === 'bench' ? benchScreen()
      : B.screen === 'inspect' ? inspectScreen()
      : B.screen === 'freight' ? freightScreen()
      : B.screen === 'market' ? marketScreen()
      : floorScreen()}</div>
    <footer class="td-foot">${footChips()}</footer>
  </div>`);
  wire();
  startSpin();
}

// ── The footer ───────────────────────────────────────────────────────────────
// EVERY BUTTON ON THIS SCREEN IS A COMMAND (rule 2), so the footer used to SAY so — a dim line of
// text reading "Everything here is a command:" followed by five greyed examples with somebody
// else's arguments in them (`yard buy krell` when you own a Krell already; `haul 1` when the board
// is empty). A caption explaining the interface is the interface admitting it isn't obvious, and an
// example you cannot press is a button that has been switched off for no reason.
//
// So the examples are gone and the row is real: the verbs are built from what is actually true
// right now — this truck, this job, this quote — and every one of them runs. Anything that SPENDS
// goes through the same two-step arm the Sell button uses, because a footer is somewhere a cursor
// passes through on its way somewhere else.
function footChips() {
  const d = B.data, sel = selected();
  const chip = (cmd, label, spend = false) =>
    `<button class="td-verb" ${spend ? 'data-confirm' : 'data-cmd'}="${esc(cmd)}">${esc(label || cmd)}</button>`;
  const out = [];
  if (sel?.hereNow) out.push(chip(`drive ${sel.id}`, 'drive'));
  if (sel && sel.condition < 1) out.push(chip(`rig repair ${sel.id} shop`, `rig repair · ${money(sel.repairShop)}`, true));
  if (sel && d.fuelHere && sel.fuel < 0.99) out.push(chip(`rig fuel ${sel.id}`, `rig fuel · ${money(sel.refuel)}`, true));
  if (d.board?.length) out.push(chip('haul 1', `haul 1 · ${money(d.board[0].pay)}`));
  if (d.cargo?.kind === 'goods') out.push(chip('market sell'));
  out.push(chip('yard'));
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

// ── The floor: one garage, every rig you own standing in it ──────────────────
function floorScreen() {
  const d = B.data, fleet = d.fleet || [];
  const sel = selected();
  // ⚠ THE BOXES YOU OWN, WHICH THIS SCREEN NEVER SHOWED. A trailer was drawn out on the hardstand
  // and listed nowhere, so buying a reefer and then looking for it was a search of the yard on
  // foot. It is a list rather than a second turntable on purpose: a box is a capacity and a place,
  // and neither of those is a thing you look at from three angles.
  const mine = d.trailers || [];
  const boxes = mine.length ? `
      <div class="td-deck td-boxes"><span class="td-lab">Your boxes</span>
        ${mine.map(t => `<div class="td-box-row">
          <b>${esc(t.name)}</b> <span class="td-dim">· ${t.ratedKg} kg rated</span>
          <span class="td-dim">· ${t.towedBy ? 'on the pin' : t.hereNow ? 'standing here' : `at ${esc(t.where)}`}</span>
          ${t.cargo ? `<span class="td-dim">· loaded: ${esc(t.cargo.name)}</span>` : ''}
          ${t.hereNow && d.driving ? tbtn('⚯', 'Back under it', 'data-cmd="hitch"') : ''}
        </div>`).join('')}
      </div>` : '';
  const deck = d.cargo
    ? (d.cargo.kind === 'goods'
      ? `<b>${esc(d.cargo.qty)} × ${esc(d.cargo.name)}</b> · ${d.cargo.kg} kg · paid ${money(d.cargo.paid)}/unit`
      : `<b>${esc(d.cargo.name)}</b> · contracted to ${esc(d.cargo.to)}`)
    : '<span class="td-dim">empty</span>';

  // The toolbar is the selected truck's, and every entry on it is gated on a fact the SERVER sent.
  // A button that is present and refuses is worse than one that is absent and explains itself.
  const acts = sel ? [
    sel.hereNow ? tbtn('➤', 'Take it out', `data-cmd="drive ${esc(sel.id)}"`, 'primary') : '',
    tbtn('⚙', 'Bench', 'data-screen="bench"'),
    d.fuelHere && sel.fuel < 0.99 ? tbtn('⛽', `Refuel · ${money(sel.refuel)}`, `data-cmd="rig fuel ${esc(sel.id)}"`) : '',
    tbtn('◉', 'Walk around', 'data-screen="inspect"'),
    sel.hereNow ? tbtn('₵', `Sell · ${money(sel.resale)}`, `data-confirm="yard sell ${esc(sel.id)}"`) : '',
    // NOT HERE? THEN THE ONLY USEFUL BUTTON IS THE ONE THAT FETCHES IT. A rig parked two regions
    // away used to offer nothing at all — the toolbar simply thinned out and left you looking at a
    // truck you could not reach, with no way back to it except the drive you were trying to avoid.
    sel.hereNow ? '' : tbtn('⛓', `Tow it home · ${money(sel.recall)}`, `data-confirm="yard recall ${esc(sel.id)}"`, 'primary'),
    tbtn('⊕', "Dealer's line", 'data-screen="buy"'),
  ].filter(Boolean).join('') : tbtn('⊕', "See what's for sale", 'data-screen="buy"', 'primary');

  return `
    <div class="td-floor">
      <canvas id="td-scene" class="td-scene" aria-label="The depot floor"></canvas>
      ${fleet.length ? '' : `<div class="td-hint">The bay is empty and the strip light is buzzing over nothing.
        There is a line of trucks along the fence outside with chalk on their screens.</div>`}
      <div class="td-strip">${fleet.map(t => `
        <button class="td-chip${t.id === B.selId ? ' on' : ''}${t.hereNow ? '' : ' away'}" data-sel="${esc(t.id)}">
          <span class="td-chip-name">${esc(t.name)}</span>
          <span class="td-chip-sub">${t.hereNow ? esc(t.type) : `at ${esc(t.whereName || 'another yard')}`}</span>
          <span class="td-bar" title="condition ${pct(t.condition)}"><i class="c${t.band}" style="width:${Math.round(t.condition * 100)}%"></i></span>
        </button>`).join('')}</div>
    </div>
    <aside class="td-side">
      ${sel ? truckPane(sel) : '<div class="td-none">Nothing of yours is standing here.</div>'}
      <div class="td-acts">${acts}</div>
      <div class="td-deck"><span class="td-lab">On the deck</span> ${deck}
        ${d.driving ? '' : '<div class="td-dim td-note">You are not in a truck.</div>'}</div>
      ${boxes}
    </aside>`;
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

// ── Boarding ─────────────────────────────────────────────────────────────────
// THE IGNITION BELONGS IN THE CAB, NOT IN THE YARD.
//
// This used to be a cinematic: pressing Take it out dropped you into the walkaround, lit the rig,
// held you there while it came up on its lifters, and only then sent 'drive'. It was the wrong
// place for all of it. You watched your own truck start from the concrete beside it, and the
// server had already answered 'drive' — mounted you, moved you onto the apron — while the panel
// was still showing a shed. The one thing the sequence never did was put you behind the wheel.
//
// So the button is the verb again, with nothing in front of it: 'drive' goes out, the cab takes
// the pane (dispatch 'truck_sim' → openCab), and the engine comes to life in the only view where
// a driver could actually hear it — through the windscreen, with the wheel in front of you.

// ── Walkaround ───────────────────────────────────────────────────────────────
// THE SAME WALKAROUND THE HANGAR HAS, because a truck is a thing you walk up to for exactly the
// reasons an aeroplane is. It was a poor relation of it: one step per KEYPRESS (so crossing the bay
// was thirty taps), no mouse-look at all despite the hint saying "drag to spin it", and no way to
// get in from inside the view — you had to back out to the floor to board the machine you were
// standing next to. All three are the hangar's model, adopted verbatim:
//   • WALK — a first-person free camera. Held keys move the eye per FRAME (dt-scaled), drag turns
//     the head, wheel changes FOV, and you cannot walk through the truck.
//   • ORBIT — the turntable, dragged rather than only auto-spun.
// And the BOARD prompt: walk up to the cab door and it lights, and it sends `drive` — the same verb
// the floor's button sends, because everything here is still a command a player could have typed.
// YOU START AT THE DOOR, not across the shed. The first cut opened the walkaround four units out
// on the diagonal — outside the BOARD radius, facing the truck's quarter — so the first thing
// anybody did in here was hold W for three seconds. The walk exists to look at the machine up
// close; the far view is what the turntable and the floor already give you. So the eye opens just
// off the near-side step, at a driver's height, looking along the flank at the cab: close enough
// that CLIMB IN is already lit, and a step back is a key rather than a chore.
//
// AND IT IS SHOWROOM-SIZED. Every camera constant on this screen used to be a number tuned against
// a truck that was drawn at a fifth of an aeroplane's size in an aeroplane's room, resting a whole
// truck-height above an aeroplane's ground plane (see `fit` in aircraft3d.js). Both are one fix
// there, so the numbers below are now honest world units against a rig that measures FIT long: the
// eye opens two rig-widths off the near-side front quarter at chest height, which is the shot that
// makes the machine big — a truck fills the frame and you are looking slightly UP the flank at the
// cab, rather than down at a model of one from across a shed.
const FIT = 2.0;          // the span a depot truck is drawn at — an airframe's, so the room fits it
const DOOR = [0.35, 0.83, 0.1];   // the near-side cab step, in the same units, for the BOARD prompt
const inspectDefault = () => ({ mode: 'walk', yaw: 0, elev: 0.3, zoom: 1.1,
  cam: { x: 0.55, y: 1.9, z: 0.3, yaw: -1.85, pitch: 0.02, fov: 1 } });
const walkKeys = new Set();
const WALK_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f']);

function inspectScreen() {
  const t = selected();
  if (!t) return '<div class="td-none">Nothing selected.</div>';
  const m = B.inspect.mode;
  const board = (m === 'walk' && t.hereNow)
    ? `<div class="td-board" id="td-board" data-cmd="drive ${esc(t.id)}">CLIMB IN</div>` : '';
  const strip = `${tbtn('⟳', 'Turntable', 'data-mode="orbit"', m === 'orbit' ? 'primary' : '')}
       ${tbtn('◉', 'Walk around', 'data-mode="walk"', m === 'walk' ? 'primary' : '')}
       ${t.hereNow ? tbtn('➤', 'Take it out', `data-cmd="drive ${esc(t.id)}"`, 'primary') : ''}
       ${t.hereNow ? tbtn('📯', 'Horn', 'data-cmd="horn"') : ''}
       ${tbtn('⌖', 'Reset view', 'data-view-reset', 'ghost')}
       ${tbtn('←', 'Back to the floor', 'data-screen="floor"', 'ghost')}
       <span class="td-dim td-note">${m === 'walk'
         ? 'WASD to move · drag to look · Q/E turn · R/F height · walk up to the door and press Enter.'
         : 'Drag to turn it · wheel to zoom.'}</span>`;
  return `
    <div class="td-floor">
      <canvas id="td-hero" class="td-scene" tabindex="0" aria-label="Walkaround"></canvas>
      ${board}
      <div class="td-strip">${strip}</div>
    </div>
    <aside class="td-side">${truckPane(t)}</aside>`;
}

// Held-key capture for the walk camera. Bound while the panel is mounted (onKey), and never while
// a text field has focus, so it can't eat what was meant for the command box.
function walkKeyDown(k) { if (!WALK_KEYS.has(k)) return false; walkKeys.add(k); return true; }

// Mouse-look / orbit-drag / zoom on the hero canvas. Re-bound after every render (the canvas is
// rebuilt by innerHTML), which is why the handlers live on the element and hold no state of their own
// beyond the pointer map.
function bindHeroPointer() {
  const cv = document.getElementById('td-hero');
  if (!cv || cv._tdBound) return;
  cv._tdBound = 1;
  cv.focus?.();
  const ptrs = new Map();
  let pinch = 0;
  const twoDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const zoomBy = (ratio) => {
    if (B.inspect.mode === 'walk') B.inspect.cam.fov = Math.max(0.5, Math.min(2, B.inspect.cam.fov / ratio));
    else B.inspect.zoom = Math.max(0.6, Math.min(2.8, B.inspect.zoom * ratio));
  };
  cv.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; cv.focus?.(); if (ptrs.size === 2) pinch = twoDist(); });
  cv.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId); if (!prev || !B) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size >= 2) { const d = twoDist(); if (pinch) zoomBy(d / pinch); pinch = d; return; }
    if (B.inspect.mode === 'walk') {
      B.inspect.cam.yaw += dx * 0.006;
      B.inspect.cam.pitch = Math.max(-1.2, Math.min(1.2, B.inspect.cam.pitch - dy * 0.005));
    } else {
      B.inspect.yaw -= dx * 0.01;
      B.inspect.elev = Math.max(0.05, Math.min(1.3, B.inspect.elev + dy * 0.006));
    }
  });
  const end = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; if (!ptrs.size) cv.style.cursor = 'grab'; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(1 - e.deltaY * 0.0012); }, { passive: false });
}

// One frame of walking. THE TRUCK IS SOLID: an exclusion ellipse in the ground plane sized off the
// rig's own footprint, so you slide along the flank instead of walking out through the far door.
function stepWalk(dt) {
  const cam = B.inspect.cam;
  let mf = 0, mr = 0, mu = 0;
  if (walkKeys.has('w')) mf += 1; if (walkKeys.has('s')) mf -= 1;
  if (walkKeys.has('d')) mr += 1; if (walkKeys.has('a')) mr -= 1;
  if (walkKeys.has('r')) mu += 1; if (walkKeys.has('f')) mu -= 1;
  if (walkKeys.has('e')) cam.yaw += 1.6 * dt;
  if (walkKeys.has('q')) cam.yaw -= 1.6 * dt;
  if (!mf && !mr && !mu) return;
  const spd = 1.7 * dt, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  cam.x = Math.max(-9, Math.min(9, cam.x + (mf * cy + mr * -sy) * spd));
  cam.y = Math.max(-9, Math.min(9, cam.y + (mf * sy + mr * cy) * spd));
  cam.z = Math.max(-0.12, Math.min(2.6, cam.z + mu * spd));
  // A rig is long and narrow — an aeroplane's ellipse is the wrong shape. Sized off the FITTED
  // footprint (half a rig long, a little over half wide) plus a pace of personal space, and the
  // height gate is the fitted roofline: above the stacks there is nothing to walk into.
  const AF = 1.35, AG = 1.15;
  if (cam.z < 0.75) { const d = Math.hypot(cam.x / AF, cam.y / AG); if (d > 1e-3 && d < 1) { cam.x /= d; cam.y /= d; } }
}

// ── The dealer's line ────────────────────────────────────────────────────────
// Big cards, big schematics. The old lot drew a 260×104 thumbnail per truck, which for the one
// screen in the system whose entire job is "look at what you could own" was the wrong size by
// about half — you were buying a price and a paragraph.
function buyScreen() {
  const d = B.data;
  // One scale for the whole line, taken off the biggest thing on it — see the `fitRef` note in
  // wireframe-plane.js. The top of the range is the reference by DATA (the highest tier the dealer
  // stocks) rather than by a type id written in here, so a new flagship needs no edit.
  const fitRef = (d.stock || []).reduce((a, b) => (a && a.tier >= b.tier ? a : b), null)?.variant || '';
  const cards = (d.stock || []).map(t => `
    <div class="td-lot${t.afford ? '' : ' poor'}${B.lotSel === t.id ? ' on' : ''}" data-lot="${esc(t.id)}">
      <div class="td-lot-head">
        <div><b>${esc(t.name)}</b><div class="td-dim">TIER ${t.tier}</div></div>
        <div class="td-price">${money(t.price)}</div>
      </div>
      <canvas class="td-wf" width="440" height="300" data-variant="${esc(t.variant)}" data-fit="${esc(fitRef)}" aria-hidden="true"></canvas>
      <div class="td-blurb">${esc(t.blurb)}</div>
      ${statBars(t.stats)}
      <dl class="td-spec">
        <div><dt>deck</dt><dd>${t.kg} kg</dd></div>
        <div><dt>tank</dt><dd>${t.tank}</dd></div>
        <div><dt>top</dt><dd>${t.top} mph</dd></div>
      </dl>
      <div class="td-acts">
        ${tbtn('⊕', `Buy · ${money(t.price)}`, `data-cmd="yard buy ${esc(t.id)}" ${t.afford ? '' : 'disabled title="You cannot afford it"'}`, 'primary')}
      </div>
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

// ── The bench ────────────────────────────────────────────────────────────────
function benchScreen() {
  const t = selected();
  if (!t) return '<div class="td-none">Nothing of yours is here to work on. <button class="td-act" data-screen="buy">The dealer\'s line</button></div>';
  const tabs = [['condition', 'Condition', '◧'], ['tune', 'Tuning', '⌥'], ['kits', 'Kits', '⊞'], ['paint', 'Paint', '◐']]
    .map(([k, l, ico]) => `<button class="td-tab sm${B.bench.tab === k ? ' on' : ''}" data-bench="${k}"><span class="td-tab-ico" aria-hidden="true">${ico}</span>${l}</button>`).join('');
  return `
    <div class="td-floor">
      <canvas id="td-hero" class="td-scene" aria-label="${esc(t.name)}"></canvas>
      <div class="td-strip"><div class="td-seg">${tabs}</div>${tbtn('←', 'Back to the floor', 'data-screen="floor"', 'ghost')}</div>
    </div>
    <aside class="td-side">
      <div class="td-pane-head"><div><b>${esc(t.name)}</b><div class="td-dim">${esc(t.type)}</div></div>
        <span class="td-band ${t.band}">${esc(t.bandLabel)}</span></div>
      ${B.bench.tab === 'tune' ? tuneTab(t) : B.bench.tab === 'kits' ? kitsTab(t) : B.bench.tab === 'paint' ? paintTab(t) : conditionTab(t)}
    </aside>`;
}

function conditionTab(t) {
  const d = B.data;
  return `
    <div class="td-pane">
      <div class="td-gauge"><i class="c${t.band}" style="width:${Math.round(t.condition * 100)}%"></i><span>${pct(t.condition)}</span></div>
      <div class="td-dim td-note">${esc(t.bandText)}</div>
      ${statBars(t.stats)}
      <div class="td-acts col">
        <button class="td-act" data-cmd="rig repair ${esc(t.id)}" ${t.canField ? '' : 'disabled title="Already past what hand tools reach"'}>
          Do it yourself · ${money(t.repairField)}<span class="td-dim"> — up to ${pct(0.8)}, and you can botch it</span></button>
        <button class="td-act primary" data-cmd="rig repair ${esc(t.id)} shop">
          Put it through the shop · ${money(t.repairShop)}<span class="td-dim"> — back to new, no roll</span></button>
        ${d.fuelHere ? `<button class="td-act" data-cmd="rig fuel ${esc(t.id)}" ${t.fuel < 0.99 ? '' : 'disabled title="Already full"'}>Fill the tanks · ${money(t.refuel)}</button>`
          : '<div class="td-dim td-note">No pump in this yard.</div>'}
      </div>
      <div class="td-dim td-note">Fuel ${pct(t.fuel)} · ${t.odometer.toLocaleString()} tiles on the clock · trade-in ${money(t.resale)}</div>
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
      <div class="td-dim td-note">Dials reach ±${range} with your hands and what is fitted.</div>
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
        : `<button class="td-act" data-cmd="rig kit ${esc(t.id)} ${esc(k.id)}" ${k.afford ? '' : 'disabled title="You cannot afford it"'}>${money(k.price)}</button>`}
    </div>`;
  }).join('')}</div>`;
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
  ['bright', 'Brightwork',     'Grille, spear, stacks — while chrome is on.'],
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
        <input type="color" class="td-col" data-paint="${k}" value="${esc(cur[k])}" aria-label="${esc(label)}">
        <span class="td-cname">${esc(label)}<span class="td-dim">${esc(note)}</span></span>
        <code class="td-chex">${esc(String(cur[k] || '').toUpperCase())}</code>
      </label>`).join('');
  return `
      <div class="td-lab">Where the paint goes</div>
      <div class="td-crows">${rows}</div>
      <label class="td-check"><input type="checkbox" data-paint="chrome" ${cur.chrome ? 'checked' : ''}> Brightwork polished<span class="td-dim"> — off blacks it out to the hardware colour</span></label>
      <div class="td-lab">Paint job<span class="td-dim"> — what the flash colour above is laid on in</span></div>
      <div class="td-swatches">${swatches(B.data.flashes, 'flash')}</div>
      <div class="td-lab">Finish coat<span class="td-dim"> — the only thing that moves the price</span></div>
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
        <input type="color" class="td-col" data-trimcol="${k}" value="${esc(mixNow(cur)[k])}" aria-label="${esc(label)}">
        <span class="td-cname">${esc(label)}<span class="td-dim">${esc(note)}</span></span>
        <code class="td-chex">${esc(String(mixNow(cur)[k] || '').toUpperCase())}</code>
      </label>`).join('');
  return `
      ${dashPreview(cur)}
      <div class="td-lab">Colourway<span class="td-dim"> — the light you drive by</span></div>
      <div class="td-tswatches">${cols.map(swatch).join('')}${cur.cust ? mixSwatch() : ''}</div>
      <div class="td-lab">Or mix your own<span class="td-dim"> — three picks, and the rest of the cab follows them</span></div>
      <div class="td-crows${cur.col === CUSTOM_COL ? ' on' : ''}">${wells}</div>
      <div class="td-lab">Material</div>
      <div class="td-swatches">${mats.map(matRow).join('')}</div>
      <div class="td-acts">
        <button class="td-act primary" data-cmd="${esc(cmd || '')}" ${cmd ? '' : 'disabled title="Nothing changed"'}>Retrim it · ${money(t.trimPrice || 0)}</button>
        <button class="td-act ghost" data-trim-reset ${cmd ? '' : 'disabled'}>Put it back</button>
      </div>
      <div class="td-dim td-note">The bench does not sell instruments. What is in the binnacle came with the truck.</div>`;
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
      <div class="td-dim td-note td-dm-cap">${esc([c.label || 'stock', m.label || 'stock'].join(', '))}${c.custom ? ' — nobody else is driving this one' : c.stock === false ? ' — a bench colour, on no truck from the factory' : ''}</div>`;
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
function freightScreen() {
  const d = B.data;
  if (!(d.board || []).length) return '<div class="td-none">Nothing on the board today.</div>';
  return `<div class="td-rows wide">${d.board.map(b => `
    <div class="td-row">
      <div class="td-main"><b>${esc(b.name)}</b><div class="td-dim">${b.kg} kg → ${esc(b.toName)}${b.crosses ? ' <span class="td-warn">across the waste</span>' : ''}</div></div>
      <div class="td-pay">${money(b.pay)}</div>
      <button class="td-act" data-cmd="haul ${b.i + 1}" ${d.driving ? '' : 'disabled title="Get in a truck first"'}>Take it</button>
    </div>`).join('')}</div>`;
}

function marketScreen() {
  const d = B.data;
  const rows = (d.quotes || []).map(q => {
    const gain = q.thereBid == null ? null : q.thereBid - q.ask;
    const there = q.thereBid == null ? '<span class="td-dim">—</span>'
      : `<span class="${gain > 0 ? 'td-good' : 'td-dim'}">${money(q.thereBid)}${gain > 0 ? ` (+${gain}/u)` : ''}</span>`
        + (q.thereAge ? ` <span class="td-dim">${q.thereAge}d</span>` : '');
    const fits = Math.min(q.canAfford, q.holds);
    return `<div class="td-row">
      <div class="td-main"><b>${esc(q.name)}</b><span class="td-dim"> · ${q.kg} kg</span></div>
      <div class="td-num">${money(q.ask)}</div>
      <div class="td-num td-dim">${money(q.bid)}</div>
      <div class="td-num">${there}</div>
      <button class="td-act" data-cmd="market buy ${q.key} full" ${d.driving && fits > 0 ? '' : 'disabled'}
        title="${fits > 0 ? `Fills the deck: ${fits}` : 'Not enough credits, or no truck'}">Buy ${fits > 0 ? fits : ''}</button>
    </div>`;
  }).join('');
  const sell = d.cargo?.kind === 'goods'
    ? `<div class="td-acts"><button class="td-act primary" data-cmd="market sell">Sell ${esc(d.cargo.qty)} × ${esc(d.cargo.name)} here</button></div>` : '';
  return `<div class="td-rows wide">
      <div class="td-row head"><div class="td-main">good</div><div class="td-num">buy</div><div class="td-num">sell</div>
        <div class="td-num">${d.thereName ? esc(d.thereName) : 'there'}</div><div></div></div>
      ${rows}</div>${sell}
    <div class="td-dim td-note">Your deck holds ${d.deckKg} kg.</div>`;
}

// ── Events ───────────────────────────────────────────────────────────────────
function onClick(e) {
  if (!B) return;
  const t = e.target.closest('[data-cmd],[data-screen],[data-sel],[data-bench],[data-mode],[data-lot],[data-paintpick],[data-trimpick],[data-psec],[data-preset],[data-close],[data-act],[data-confirm],[data-tune-reset],[data-paint-reset],[data-trim-reset],[data-view-reset]');
  if (!t || t.disabled) {
    if (e.target.id === 'td-scene') pickOnFloor(e);
    return;
  }
  // Closing the depot leaves you standing in the yard, so it has to put the room back — the pane
  // is the room's pane, and a panel that simply removed itself would leave it blank until the next
  // thing you happened to type redrew it.
  if (t.dataset.close != null) { closeTruckDepot(); return void sendCmdSilent('look'); }
  if (t.dataset.act === 'fullscreen') { document.body.classList.toggle('td-fullscreen'); return void render(); }
  if (t.dataset.act === 'hidepanel') { document.body.classList.toggle('td-hidepanel'); return void render(); }
  if (t.dataset.sel) { B.selId = t.dataset.sel; B.bench.tune = null; B.bench.paint = null; B.bench.trim = null; return void render(); }
  if (t.dataset.screen) { B.screen = t.dataset.screen; return void render(); }
  if (t.dataset.bench) { B.bench.tab = t.dataset.bench; return void render(); }
  if (t.dataset.mode) { B.inspect.mode = t.dataset.mode; walkKeys.clear(); return void render(); }
  if (t.dataset.viewReset != null) { const m = B.inspect.mode; B.inspect = inspectDefault(); B.inspect.mode = m; walkKeys.clear(); return void render(); }
  if (t.dataset.lot) { B.lotSel = t.dataset.lot; return void render(); }
  // One swatch, whichever row it came from — the paint job, the finish coat and the door art are
  // three lists of the same widget, so they are one handler rather than three near-copies.
  if (t.dataset.paintpick) { B.bench.paint = { ...paintNow(), [t.dataset.paintpick]: t.dataset.paintval }; return void render(); }
  // Which screen of the booth. Held on the bench rather than in a module local so that selecting a
  // different truck resets it with everything else — see the `sel` branch above.
  if (t.dataset.psec) { B.bench.psec = t.dataset.psec; return void render(); }
  // The interior's two swatch rows, exactly as the paint's are: an edit held locally, previewed,
  // and charged only by the button. ⚠ It is a SEPARATE draft from the paint (`B.bench.trim`), or
  // clicking a colourway would dirty the respray and the booth would quote for both.
  if (t.dataset.trimpick) { B.bench.trim = { ...trimNow(), [t.dataset.trimpick]: t.dataset.trimval }; return void render(); }
  // A scheme sets every field at once. ⚠ It is applied LOCALLY rather than sent as
  // `rig paint <id> preset <name>`, even though that verb exists and works: sending it would
  // charge for the respray the instant somebody clicked a swatch to see what it looked like.
  // The preset is a shortcut through the pickers, not a purchase — the button is the purchase.
  if (t.dataset.preset) {
    const p = (B.data.paintPresets || []).find(r => r.id === t.dataset.preset);
    if (p) { const { id, label, ...fields } = p; B.bench.paint = { ...paintNow(), ...fields }; }
    return void render();
  }
  if (t.dataset.tuneReset != null) { B.bench.tune = null; return void render(); }
  if (t.dataset.paintReset != null) { B.bench.paint = null; return void render(); }
  if (t.dataset.trimReset != null) { B.bench.trim = null; return void render(); }
  // SELLING IS THE ONE IRREVERSIBLE BUTTON on this screen, and it sits next to Refuel. It asks.
  if (t.dataset.confirm) {
    if (t.dataset.armed) { sendCmdSilent(t.dataset.confirm); return; }
    t.dataset.armed = '1'; t.textContent = 'Sure? Click again';
    setTimeout(() => { delete t.dataset.armed; render(); }, 4000);
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
  if (cap) cap.textContent = [c.label || 'stock', m.label || 'stock'].join(', ') + (c.custom ? ' — nobody else is driving this one' : '');
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
  if (!B) return;
  // Escape BACKS OUT ONE SCREEN, the hangar's behaviour. As a modal it slammed the whole panel
  // shut from four screens deep, which is the wrong answer to "I'm done with the dealer's line" —
  // and in the pane it is worse, because Escape is a key you press to leave a text box.
  if (e.key === 'Escape') {
    const el0 = document.activeElement;
    if (el0 && (el0.tagName === 'INPUT' || el0.tagName === 'TEXTAREA' || el0.isContentEditable)) return;
    if (B.screen !== 'floor') { B.screen = 'floor'; return void render(); }
    closeTruckDepot();
    return void sendCmdSilent('look');
  }
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (B.screen !== 'inspect' || B.inspect.mode !== 'walk') return;
  const k = e.key.toLowerCase();
  // Enter boards, but ONLY once you've walked up to the door — otherwise it is a click on a button
  // you cannot see, and a truck that pulls out of the yard because you tapped Enter across the shed.
  if (k === 'enter') {
    const b = document.getElementById('td-board');
    if (b?.classList.contains('near')) { b.click(); e.preventDefault(); }
    return;
  }
  if (walkKeyDown(k)) e.preventDefault();
}
function onKeyUp(e) { walkKeys.delete(e.key.toLowerCase()); }

// Clicking a truck on the floor selects it — hit-tested against the regions the scene returns,
// because there is no DOM element per truck to hang a listener on.
function pickOnFloor(e) {
  const cv = document.getElementById('td-scene');
  if (!cv || !sceneHits.length) return;
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const best = pickSceneHit(sceneHits, x, y);   // the rig's own silhouette, not a circle on the floor
  // A TRAILER IS ON THE FLOOR BUT IT IS NOT A SELECTION. Everything the side pane, the bench and
  // the toolbar draw is read out of a FLEET row, so selecting a box would empty all three and the
  // panel would sit there insisting nothing of yours is here while you looked at your own trailer.
  if (best && !(B.data.fleet || []).some(t => t.id === best.id)) return;
  if (best && best.id !== B.selId) { B.selId = best.id; B.bench.tune = null; B.bench.paint = null; B.bench.trim = null; render(); }
}

// ── The one animation loop ───────────────────────────────────────────────────
// One rAF for the whole app, exactly as the hangar bay runs one: the floor, the walkaround hero
// and every wireframe on the dealer's line are drawn from the same tick. Per-canvas loops would be
// a dozen timers racing each other for the same frame.
function startSpin() {
  if (raf) return;
  let last = 0;
  const loop = (now) => {
    const root = document.getElementById('td-root');
    if (!root || !B) { raf = null; return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    yaw += 0.006;
    const accent = themeColor('--accent', '#d8892e');

    const scene = root.querySelector('#td-scene');
    if (scene) {
      const ctx = sizeCanvas(scene);
      if (ctx) sceneHits = drawHangarScene(ctx, {
        w: scene._cw, h: scene._ch, venue: 'garage', sky: B.data.sky,
        selId: B.selId, // PARKED, because they are. `~p` is the variant grammar's shut-down pose (aircraft3d): the rig
        // settles onto its lifters and the emitter bands go out — a truck hovering with a cold engine
        // in the middle of a garage was the tell that the hover was decoration rather than a machine.
        // NO FLOATING NAME. The hangar labels its aircraft because a row of white airframes is
        // genuinely hard to tell apart by sight and a tail number is how a pilot refers to one. A
        // yard is not that: the rig is painted the colour YOU chose, the strip under the canvas
        // names every one of them, and the pane beside it names the selected one twice over. A
        // caption floating in the middle of the bay was a third answer to a question nobody asked,
        // sitting across the bumper of the thing it was labelling.
        // Every rig on the floor is PARKED, because a running one is a rig you are sitting in and
        // that view is the cab, not the yard.
        // ⚠ AND THE BOXES. The floor drew the FLEET and nothing else, so a trailer you had just
        // paid for appeared on no screen in the building it was standing outside — the yard is
        // where you buy one, and the yard was the one place it did not exist. `~s` is the solo
        // mesh (the box with the tractor thrown away, the same variant `trailersNear` draws out on
        // the hardstand), and the shape comes from the RATING for the reason it does there: a
        // trailer row carries no mesh of its own and its capacity already says how big it is.
        //
        // Only the ones standing HERE. A box on the pin is drawn under the truck that is towing it
        // (that is what `+t` on the fleet variant is), and one at another yard is somewhere else.
        entries: [
          ...(B.data.fleet || []).map(t => ({ id: t.id, cls: 'truck', livery: liveryOf(t),
            variant: `${t.variant}~p` })),
          // …in their own colours. A box is stamped with the cab colour of whoever bought it and
          // repainted on its own (yard paint), so the floor draws a fleet rather than a row of
          // black slabs — and the colour is the SERVER's, exactly as the paint on a truck is.
          ...(B.data.trailers || []).filter(t => t.hereNow).map(t => ({
            id: t.id, cls: 'truck', variant: `${boxShape(t.ratedKg)}+t~s`,
            livery: boxLivery(t.colour),
          })),
        ],
      });
    }
    const hero = root.querySelector('#td-hero');
    const sel = selected();
    if (hero && sel) {
      if (B.screen === 'inspect') bindHeroPointer();
      const ctx = sizeCanvas(hero);
      const inspecting = B.screen === 'inspect';
      const walk = inspecting && B.inspect.mode === 'walk';
      if (walk) stepWalk(dt);
      const camNow = walk ? { ...B.inspect.cam } : null;
      if (ctx) drawHangarFloorBay(ctx, {
        w: hero._cw, h: hero._ch, cls: 'truck',
        variant: `${sel.variant}~p`,
        livery: liveryOf(sel, true),
        // The bench hero keeps its slow auto-turn; the turntable is YOURS to drag once you've asked
        // to walk around it, which is the whole difference between a display and an inspection.
        yaw: inspecting && !walk ? B.inspect.yaw : yaw,
        elev: inspecting && !walk ? B.inspect.elev : undefined,
        zoom: inspecting && !walk ? B.inspect.zoom : undefined,
        venue: 'garage', sky: B.data.sky, floor: true, floor3d: walk, fit: FIT,
        cam: camNow,
      });
      // The door is at the cab, not at the middle of the rig: walk up to the near-side step and the
      // prompt lights. Same distance test the hangar's BOARD uses, over the truck's own geometry.
      if (walk) {
        const c = B.inspect.cam, near = Math.hypot(c.x - DOOR[0], c.y - DOOR[1], c.z - DOOR[2]) < 1.6;
        root.querySelector('#td-board')?.classList.toggle('near', near);
      }
    }
    for (const c of root.querySelectorAll('.td-wf')) {
      const ctx = c.getContext('2d');
      // `fill` — the rig is sized by the CARD, not by how big the mesh happens to be authored. A
      // truck is a quarter of an airframe across and this viewport was drawn for airframes, which
      // is why the schematic used to be a doodle in the middle of an empty box.
      if (ctx) drawWireframe3D(ctx, { cls: 'truck', variant: c.dataset.variant, w: c.width, h: c.height, accent, yaw,
        fill: 0.94, fitRef: c.dataset.fit });
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

// A truck's paint, in the shape the shared renderer's palette already speaks. `base`/`trim` are the
// two colours every model here is skinned from, so a repainted cab is repainted everywhere it is
// drawn — the floor, the walkaround and the bench hero — for no per-surface code at all.
// …and it now carries the FLASH, which is the half of a paint job that was doing nothing at all.
// `pattern` is what `faceWearsTrim` reads to decide base-or-trim per facet, and the truck flashes
// go through it under the `truck:` prefix (see aircraft3d) so they can never be mistaken for the
// airframe patterns that share their vocabulary.
//
// AND IT PREVIEWS. The bench drew `t.paint` — the SERVER's paint — so every colour you picked
// showed you the truck you already had, and the only way to find out what teal looked like was to
// pay for teal. A half-turned dial is not a lie about the world here: nothing is committed, the
// button still says what it will cost, and the model in front of you is the one you are describing.
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
  return truckLivery(p);
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
  .td-head{display:flex;align-items:center;gap:14px;padding:0 16px;height:52px;flex:0 0 auto;
    background:color-mix(in srgb, var(--td-surf) 82%, transparent);
    border-bottom:1px solid color-mix(in srgb, var(--td-accent) 26%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 2px 8px rgba(0,0,0,.14)}
  .td-title b{color:var(--td-fg);letter-spacing:2px;text-shadow:0 0 6px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-nav{margin-left:8px}
  .td-bal{margin-left:auto;color:var(--td-fg);letter-spacing:1px;font-variant-numeric:tabular-nums;
    text-shadow:0 0 5px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-viewbtns{display:flex;gap:6px;margin-left:10px}
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
  .td-seg{display:flex;gap:4px;flex-wrap:wrap;padding:4px;border-radius:9px;
    background:var(--td-surf-lo);border:1px solid var(--border);box-shadow:inset 0 1px 3px var(--td-bevel-lo)}
  .td-tab{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;overflow:hidden;
    font-family:inherit;font:700 12.5px/1 'Courier New',monospace;letter-spacing:1px;cursor:pointer;
    color:var(--td-fg-dim);background:transparent;border:1px solid transparent;border-radius:6px;padding:7px 12px;
    transition:filter .12s,box-shadow .12s,color .12s,background .12s}
  .td-tab.sm{padding:6px 10px}
  .td-tab-ico{font-size:13.5px;line-height:1;opacity:.7;transition:opacity .12s,filter .12s}
  .td-tab:hover{color:var(--td-fg);background:color-mix(in srgb, var(--td-accent) 10%, transparent)}
  .td-tab:hover .td-tab-ico{opacity:1}
  .td-tab.on{color:var(--td-fg);background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border-color:color-mix(in srgb, var(--td-accent) 40%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 1px 3px rgba(0,0,0,.2)}
  .td-tab.on .td-tab-ico{opacity:1;filter:drop-shadow(0 0 5px color-mix(in srgb, var(--td-accent) 70%, transparent))}
  .td-tab.on::after{content:'';position:absolute;left:14%;right:14%;bottom:0;height:2px;border-radius:2px;
    background:var(--td-accent);box-shadow:0 0 8px var(--td-accent);animation:tdTabSlide .22s ease-out}
  @keyframes tdTabSlide{from{left:48%;right:48%;opacity:0}to{left:14%;right:14%;opacity:1}}
  .td-body{flex:1;min-height:0;display:flex;gap:12px;padding:12px 14px;overflow:hidden}
  .td-floor{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;position:relative}
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
  .td-strip{display:flex;gap:9px;flex-wrap:wrap;align-items:center;flex:0 0 auto;padding:11px 12px;border-radius:9px;
    background:color-mix(in srgb, var(--td-surf-lo) 84%, transparent);
    border:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 2px 8px var(--td-bevel-lo),inset 0 1px 0 var(--td-bevel-hi)}
  /* A rig on the strip is a raised surface card, same recipe as the dealer's lot cards. */
  .td-chip{display:flex;flex-direction:column;gap:3px;min-width:138px;text-align:left;padding:7px 10px;cursor:pointer;
    font-family:inherit;color:var(--td-fg);border-radius:8px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 2px 5px rgba(0,0,0,.2);
    transition:filter .12s,box-shadow .12s,border-color .12s}
  .td-chip:hover{filter:brightness(1.08);border-color:var(--td-accent)}
  .td-chip.on{border-color:var(--td-accent);box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 0 12px color-mix(in srgb, var(--td-accent) 30%, transparent)}
  .td-chip.away{opacity:.55}
  .td-chip-name{font-weight:bold;font-size:13.5px;letter-spacing:.5px}
  .td-chip-sub{color:var(--td-fg-dim);font-size:12px}
  .td-side{width:352px;flex:none;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}
  /* The read-out is a raised surface card too — the hangar's .hb-info. */
  .td-pane{display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-radius:9px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 2px 5px rgba(0,0,0,.2)}
  .td-pane-head{display:flex;align-items:flex-start;gap:8px}
  .td-pane-head b{color:var(--td-fg);font-size:16px;letter-spacing:.5px}
  .td-band{margin-left:auto;font:700 10.5px/1 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;
    padding:4px 9px;border-radius:11px;background:var(--td-surf-lo);border:1px solid var(--border)}
  .td-band.sound{color:#6fcf83}.td-band.worked{color:#a8c98a}.td-band.tired{color:#e8c07a}
  .td-band.ailing{color:#d8934e}.td-band.derelict{color:#d2685c}
  .td-spec{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0}
  /* Each spec is a recessed vital pill, the hangar's .hb-bench-vital. */
  .td-spec div{display:flex;flex-direction:column;line-height:1.2;padding:3px 10px;border-radius:6px;
    background:var(--td-surf-lo);border:1px solid var(--border);box-shadow:inset 0 1px 2px var(--td-bevel-lo)}
  .td-spec dt{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim2)}
  .td-spec dd{margin:0;font-size:15px;font-weight:bold;color:var(--td-fg);font-variant-numeric:tabular-nums}
  .td-axes{display:flex;flex-direction:column;gap:4px;margin:4px 0}
  .td-axis{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:8px;
    font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim)}
  .td-axis-bar,.td-bar,.td-gauge{background:var(--td-surf-lo);border-radius:4px;overflow:hidden;
    box-shadow:inset 0 1px 2px var(--td-bevel-lo),inset 0 0 0 1px var(--border)}
  .td-axis-bar{height:7px}
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
  .td-acts{display:flex;gap:9px;flex-wrap:wrap}
  .td-acts.col{flex-direction:column;align-items:stretch}
  /* THE 3D KEY. The tablet's bevel language: a raised accent-tinted cap with a bright top highlight
     and a dark bottom bevel that PRESSES IN to a deep inset recess on :active, so every press feels
     like a physical key rather than a link with a border. */
  .td-act{display:inline-flex;align-items:center;justify-content:center;gap:8px;
    font-family:inherit;font-size:12.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;
    cursor:pointer;padding:10px 16px;border-radius:9px;color:var(--td-fg);
    border:1px solid color-mix(in srgb, var(--td-accent) 38%, transparent);
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 4px var(--td-bevel-lo),0 2px 4px rgba(0,0,0,.25);
    transition:filter .12s,box-shadow .12s,transform .05s,border-color .12s}
  .td-ico{font-size:15.5px;line-height:1;opacity:.95}
  .td-act:hover:not(:disabled){filter:brightness(1.1);border-color:var(--td-accent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 4px var(--td-bevel-lo),0 3px 9px rgba(0,0,0,.28),0 0 14px color-mix(in srgb, var(--td-accent) 32%, transparent)}
  .td-act:active:not(:disabled){transform:translateY(1px);box-shadow:inset 0 2px 6px var(--td-bevel-lo)}
  .td-act:disabled{opacity:.4;cursor:default;filter:grayscale(.5)}
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
  .td-acts.col .td-act{justify-content:flex-start;text-align:left;text-transform:none;letter-spacing:.4px;line-height:1.35}
  .td-lots{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;align-content:start;padding:2px}
  .td-lot{padding:12px;border-radius:12px;display:flex;flex-direction:column;gap:6px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 3px 10px rgba(0,0,0,.22);
    transition:filter .12s,box-shadow .12s,border-color .12s}
  .td-lot:hover{filter:brightness(1.05);border-color:var(--td-accent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 5px 16px rgba(0,0,0,.28),0 0 14px color-mix(in srgb, var(--td-accent) 22%, transparent)}
  .td-lot.on{border-color:var(--td-accent)}
  .td-lot.poor{opacity:.62}
  .td-lot-head{display:flex;align-items:flex-start}
  .td-lot-head b{color:var(--td-fg);font-size:16.5px;letter-spacing:1px}
  .td-price{margin-left:auto;color:var(--td-fg);font-variant-numeric:tabular-nums;font-weight:bold;letter-spacing:1px}
  /* The schematic sits in its own recessed dark viewport, same as the hangar's .hb-lot-view. */
  .td-wf{display:block;width:100%;height:auto;padding:6px;border-radius:9px;
    background:radial-gradient(120% 120% at 50% 40%,color-mix(in srgb, var(--td-accent) 15%, var(--bg)),color-mix(in srgb, var(--td-accent) 8%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--td-accent) 22%, transparent);box-shadow:inset 0 2px 9px rgba(0,0,0,.4)}
  .td-blurb{color:var(--td-fg-dim);font-size:13px;min-height:3.2em}
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
  /* A scheme card: the whole truck as six chips, then its name, then what it is wearing. */
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
  /* The mix, while it is the one fitted. Same accent the selected swatch wears, so "this is the
     one you have chosen" reads the same on a row of wells as it does on a row of buttons. */
  .td-crows.on{box-shadow:inset 2px 0 0 var(--td-accent);padding-left:6px;border-radius:7px}
  .td-cname{display:flex;flex-direction:column;gap:1px;font:700 11.5px/1.1 'Courier New',monospace;
    letter-spacing:.6px;text-transform:uppercase;color:var(--td-fg)}
  .td-cname .td-dim{font:400 11px/1.25 inherit;letter-spacing:0;text-transform:none}
  .td-chex{font:400 10.5px/1 'Courier New',monospace;color:var(--td-fg-dim2)}
  .td-col{width:38px;height:30px;border:1px solid color-mix(in srgb, var(--td-accent) 35%, transparent);
    border-radius:6px;background:var(--td-surf-lo);cursor:pointer;box-shadow:inset 0 1px 0 var(--td-bevel-hi);padding:2px}
  /* ── The interior, and its still ────────────────────────────────────────────
     A dashboard is a slab under a header rail with two lit dials in it, and that is exactly what
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
  .td-deck{padding:10px 12px;border-radius:9px;background:var(--td-surf-lo);
    border:1px solid var(--border);box-shadow:inset 0 1px 3px var(--td-bevel-lo)}
  /* The boxes you own, under the deck read-out — a list, because a trailer is a capacity and a
     place rather than something you look at from three angles. */
  .td-boxes{margin-top:8px}
  .td-box-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;padding:4px 0;
    border-top:1px solid var(--border)}
  .td-box-row:first-of-type{border-top:0}
  .td-box-row .td-act{margin-left:auto;padding:2px 8px;font-size:11px}
  .td-lab{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim2);display:block}
  .td-none{color:var(--td-fg-dim);padding:14px;text-align:center}
  .td-dim{color:var(--td-fg-dim)}
  .td-note{font-size:12.5px}
  .td-good{color:#6fcf83}
  .td-warn{color:#ffb26b}
    .td-foot{flex:0 0 auto;padding:10px 16px;font-size:12.5px;color:var(--td-fg-dim);
    background:color-mix(in srgb, var(--td-surf-lo) 84%, transparent);
    border-top:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi)}
  /* The footer verbs. They are buttons, so they look pressable: a raised chip that lifts under the
     cursor and sits down when armed — never the flat dim <code> they used to be, which read as
     documentation and was ignored accordingly. */
  .td-foot{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
  .td-verb{font:inherit;font-size:12.5px;color:var(--td-fg);cursor:pointer;
    background:linear-gradient(180deg,color-mix(in srgb, var(--td-surf) 92%, transparent),var(--td-surf-lo));
    padding:4px 11px;border-radius:6px;
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
  @media (max-width:900px){.td-body{flex-direction:column}.td-side{width:auto}}
  @media (prefers-reduced-motion:reduce){.td-board.near,.td-run{animation:none}.td-tab.on::after{animation:none}}
  `;
  document.head.appendChild(s);
}
