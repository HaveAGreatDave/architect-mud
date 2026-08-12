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
import { drawHangarScene, drawHangarFloorBay } from './aircraft3d.js';
import { hoverSpool, hoverSpoolSeconds } from './engine-audio.js';

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
  // Snap the top pane back to its default auto size so the whole depot fits, whatever manual drag
  // height was left on the previous room look. The hangar does exactly this on a fresh open.
  if (first) document.getElementById('area-pane')?.dispatchEvent(new CustomEvent('lookpaneauto'));
  const keepSel = B?.selId || null;
  B = {
    data: msg,
    screen: SCREEN_FOR_TAB[msg.tab] || (first ? 'floor' : B?.screen) || 'floor',
    selId: (msg.fleet || []).some(t => t.id === keepSel) ? keepSel : (msg.fleet || [])[0]?.id || null,
    inspect: B?.inspect || inspectDefault(),
    bench: B?.bench || { tab: 'condition', tune: null, paint: null },
    lotSel: B?.lotSel || null,
    // A start-up in flight survives a re-push (a repush lands mid-sequence often — `drive` itself
    // is what ends it), but never survives the panel closing; closeTruckDepot drops the whole B.
    start: B?.start || null,
  };
  // A fresh truck selected (you just bought one) resets any half-turned dials — they belonged to a
  // different machine, and carrying them across would silently propose a tune nobody asked for.
  B.bench.tune = null; B.bench.paint = null;
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  render();
}

export function closeTruckDepot() {
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
    <footer class="td-foot"><span class="td-dim">Everything here is a command:</span>
      <code>yard buy krell</code> <code>rig repair shop</code> <code>haul 1</code> <code>market buy scrap full</code> <code>drive</code></footer>
  </div>`);
  wire();
  startSpin();
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
  const deck = d.cargo
    ? (d.cargo.kind === 'goods'
      ? `<b>${esc(d.cargo.qty)} × ${esc(d.cargo.name)}</b> · ${d.cargo.kg} kg · paid ${money(d.cargo.paid)}/unit`
      : `<b>${esc(d.cargo.name)}</b> · contracted to ${esc(d.cargo.to)}`)
    : '<span class="td-dim">empty</span>';

  // The toolbar is the selected truck's, and every entry on it is gated on a fact the SERVER sent.
  // A button that is present and refuses is worse than one that is absent and explains itself.
  const acts = sel ? [
    sel.hereNow ? tbtn('➤', 'Take it out', 'data-cmd="drive"', 'primary') : '',
    tbtn('⚙', 'Bench', 'data-screen="bench"'),
    d.fuelHere && sel.fuel < 0.99 ? tbtn('⛽', `Refuel · ${money(sel.refuel)}`, `data-cmd="rig fuel ${esc(sel.id)}"`) : '',
    tbtn('◉', 'Walk around', 'data-screen="inspect"'),
    sel.hereNow ? tbtn('₵', `Sell · ${money(sel.resale)}`, `data-confirm="yard sell ${esc(sel.id)}"`, 'ghost') : '',
    tbtn('⊕', "Dealer's line", 'data-screen="buy"', 'ghost'),
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

// ── Lighting the lifters ─────────────────────────────────────────────────────
// `drive` used to be one line: send the verb, the panel closes, and the truck you had been
// walking around was suddenly a room description. The single most physical thing this machine
// ever does — a parked chassis putting its weight onto a hover field — happened off screen.
//
// So the verb is now the END of a short sequence rather than the whole of it. Pressing it drops
// you into the walkaround (the only view close enough for any of this to read), lights the rig,
// and sends `drive` when the thing is actually up. Three rules:
//
//  • IT IS STILL THE VERB. Nothing here decides anything; when the sequence ends it sends the
//    exact string the button always sent, and a player who typed `drive` gets the same result
//    without the cinematic. Rule 2 of this file survives intact.
//  • THE SOUND IS THE CLOCK. `hoverSpoolSeconds` comes from the same per-truck table that scores
//    it (engine-audio.js), so the rise cannot drift out of sync with the noise it is making —
//    the Continental takes 3.4s to get its weight up because its start-up cue is 3.4s long.
//  • THE RIDE HEIGHT IS REAL. It rises by the ride height the mesh itself gives up when parked
//    (aircraft3d HOVER, in fitted units), overshooting once and settling — a machine finding its
//    height on a field, not a prop being winched. Faking a bigger lift would look like a jump.
const RIDE = 0.07;              // the fitted ride height a lifter holds — see FIT above
const ease = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function beginStart(t) {
  if (!t || B.start || !t.hereNow) return false;
  B.start = { id: t.id, cmd: 'drive', at: performance.now(), dur: hoverSpoolSeconds(t.typeId) * 1000 };
  B.screen = 'inspect';         // you cannot see a truck sit up from across the yard
  B.inspect = inspectDefault();
  hoverSpool(t.typeId);
  render();
  return true;
}

// Where the sequence is, as the numbers every part of it reads. Split out so the model's rise,
// the dust and the emitter glow are three views of ONE clock rather than three timelines to keep
// agreeing with each other.
function startPhase(now) {
  const s = B.start;
  if (!s) return null;
  const p = clamp01((now - s.at) / s.dur);
  const lit = p > 0.18;                                   // the coils are across: bands on
  const r = clamp01((p - 0.32) / 0.5);                    // the weight transferring
  // Up, past height, and back down onto it. The overshoot is small and it only happens once.
  const rise = ease(r) * (1 + 0.42 * Math.sin(Math.PI * r) * (1 - r));
  return { p, lit, lift: RIDE * (rise - 1), blow: clamp01((p - 0.3) / 0.28) * (1 - clamp01((p - 0.72) / 0.28)) };
}

// The effects layer, drawn over the finished frame and anchored on the contact patch the renderer
// hands back — never on a fraction of the canvas, because the camera in here moves.
function drawStartFx(ctx, anchor, ph, w, h) {
  if (!anchor || !ph) return;
  const { sx, sy } = anchor.ground, ppu = anchor.ppu;
  ctx.save();
  // The pool of light under it, cyan off the emitter band's own colour (aircraft3d GLOW). It comes
  // up with the coils, not with the lift — light first, movement after, which is the order that
  // makes the light look like the CAUSE.
  const g = ph.lit ? clamp01((ph.p - 0.18) / 0.3) : 0;
  if (g > 0) {
    const rad = ppu * (0.75 + 0.35 * g);
    const rg = ctx.createRadialGradient(sx, sy, 1, sx, sy, rad);
    rg.addColorStop(0, `rgba(140,232,255,${0.34 * g})`);
    rg.addColorStop(0.45, `rgba(64,168,200,${0.16 * g})`);
    rg.addColorStop(1, 'rgba(30,92,104,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.ellipse(sx, sy, rad, rad * 0.42, 0, 0, 7); ctx.fill();
  }
  // Dust, thrown out from under the skirt as the field takes the weight. Deterministic per index
  // (no Math.random per frame, or every puff teleports) — each grain is an angle and a phase, and
  // the ring reads as a ground plane because it is squashed to the same 0.42 the light pool is.
  if (ph.blow > 0.01) {
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 34; i++) {
      const a = (i * 2.399) % 6.283, seedR = 0.55 + ((i * 37) % 100) / 220;
      const t = clamp01((ph.p - 0.3 - ((i * 13) % 100) / 900) / 0.5);
      if (t <= 0) continue;
      const d = ppu * seedR * (0.35 + 1.5 * ease(t));
      const px = sx + Math.cos(a) * d, py = sy + Math.sin(a) * d * 0.42 - ppu * 0.06 * t;
      const al = ph.blow * (1 - t) * 0.4;
      ctx.fillStyle = `rgba(196,206,214,${al.toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(px, py, ppu * (0.05 + 0.1 * t), ppu * (0.02 + 0.05 * t), 0, 0, 7); ctx.fill();
    }
  }
  // The contactor going across: one hard frame of white at the very start. It is short on purpose —
  // it is a switch closing, and you should half-wonder whether you saw it.
  if (ph.p < 0.05) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(190,225,255,${(0.16 * (1 - ph.p / 0.05)).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

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
  const board = (m === 'walk' && t.hereNow && !B.start)
    ? '<div class="td-board" id="td-board" data-cmd="drive">CLIMB IN</div>' : '';
  // Mid-start the controls stand down to one line of status and one way out. Leaving the buttons
  // up would invite a player to drag the camera through a truck that is in the middle of moving.
  const strip = B.start
    ? `<span class="td-run" role="status">◉ LIFTERS ONLINE — ${esc(t.name)} is coming up</span>
       <button class="td-act ghost" data-screen="floor">Shut it down</button>`
    : `${tbtn('⟳', 'Turntable', 'data-mode="orbit"', m === 'orbit' ? 'primary' : '')}
       ${tbtn('◉', 'Walk around', 'data-mode="walk"', m === 'walk' ? 'primary' : '')}
       ${t.hereNow ? tbtn('➤', 'Take it out', 'data-cmd="drive"', 'primary') : ''}
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
  const cards = (d.stock || []).map(t => `
    <div class="td-lot${t.afford ? '' : ' poor'}${B.lotSel === t.id ? ' on' : ''}" data-lot="${esc(t.id)}">
      <div class="td-lot-head">
        <div><b>${esc(t.name)}</b><div class="td-dim">TIER ${t.tier}</div></div>
        <div class="td-price">${money(t.price)}</div>
      </div>
      <canvas class="td-wf" width="440" height="200" data-variant="${esc(t.variant)}" aria-hidden="true"></canvas>
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

function paintTab(t) {
  const cur = B.bench.paint || t.paint || { base: '#7d3f2a', trim: '#d8cfc0', flash: 'stripe', chrome: 1 };
  const dirty = JSON.stringify(cur) !== JSON.stringify(t.paint || {});
  const flashes = (B.data.flashes || []).map(f =>
    `<button class="td-swatch${cur.flash === f ? ' on' : ''}" data-flash="${esc(f)}">${esc(f)}</button>`).join('');
  const cmd = `rig paint ${t.id} ${cur.base} ${cur.trim} ${cur.flash} ${cur.chrome ? 1 : 0}`;
  return `
    <div class="td-pane">
      <div class="td-paint">
        <label>Cab <input type="color" class="td-col" data-paint="base" value="${esc(cur.base)}"></label>
        <label>Trim <input type="color" class="td-col" data-paint="trim" value="${esc(cur.trim)}"></label>
      </div>
      <div class="td-lab">Flash down the flank</div>
      <div class="td-swatches">${flashes}</div>
      <label class="td-check"><input type="checkbox" data-paint="chrome" ${cur.chrome ? 'checked' : ''}> Chrome on the stacks and the tank straps</label>
      <div class="td-acts">
        <button class="td-act primary" data-cmd="${esc(cmd)}" ${dirty ? '' : 'disabled title="Nothing changed"'}>Into the booth · ${money(t.paintPrice)}</button>
        <button class="td-act ghost" data-paint-reset>Put it back</button>
      </div>
      <div class="td-dim td-note">The name on the door is the plate: <code>rig name ${esc(t.id)} &lt;plate&gt;</code>.</div>
    </div>`;
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
  const t = e.target.closest('[data-cmd],[data-screen],[data-sel],[data-bench],[data-mode],[data-lot],[data-flash],[data-close],[data-act],[data-confirm],[data-tune-reset],[data-paint-reset],[data-view-reset]');
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
  if (t.dataset.sel) { B.selId = t.dataset.sel; B.bench.tune = null; B.bench.paint = null; return void render(); }
  if (t.dataset.screen) { B.start = null; B.screen = t.dataset.screen; return void render(); }   // walking away from it aborts the start
  if (t.dataset.bench) { B.bench.tab = t.dataset.bench; return void render(); }
  if (t.dataset.mode) { B.inspect.mode = t.dataset.mode; walkKeys.clear(); return void render(); }
  if (t.dataset.viewReset != null) { const m = B.inspect.mode; B.inspect = inspectDefault(); B.inspect.mode = m; walkKeys.clear(); return void render(); }
  if (t.dataset.lot) { B.lotSel = t.dataset.lot; return void render(); }
  if (t.dataset.flash) { B.bench.paint = { ...(B.bench.paint || selected()?.paint || {}), flash: t.dataset.flash }; return void render(); }
  if (t.dataset.tuneReset != null) { B.bench.tune = null; return void render(); }
  if (t.dataset.paintReset != null) { B.bench.paint = null; return void render(); }
  // SELLING IS THE ONE IRREVERSIBLE BUTTON on this screen, and it sits next to Refuel. It asks.
  if (t.dataset.confirm) {
    if (t.dataset.armed) { sendCmdSilent(t.dataset.confirm); return; }
    t.dataset.armed = '1'; t.textContent = 'Sure? Click again';
    setTimeout(() => { delete t.dataset.armed; render(); }, 4000);
    return;
  }
  // `drive` is the one verb with a machine at the other end of it, so it gets the start-up (which
  // sends this same string when the rig is up). If the truck isn't standing here, beginStart says
  // so by refusing and the command goes straight out to be refused by the server, as before.
  if (t.dataset.cmd === 'drive' && (B.start || beginStart(selected()))) return;
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
  if (el.dataset.paint) {
    const t = selected(); if (!t) return;
    const key = el.dataset.paint;
    B.bench.paint = { ...(B.bench.paint || t.paint || { base: '#7d3f2a', trim: '#d8cfc0', flash: 'stripe', chrome: 1 }),
      [key]: key === 'chrome' ? (el.checked ? 1 : 0) : el.value };
    render();
  }
}

function onKey(e) {
  if (!B) return;
  // Escape BACKS OUT ONE SCREEN, the hangar's behaviour. As a modal it slammed the whole panel
  // shut from four screens deep, which is the wrong answer to "I'm done with the dealer's line" —
  // and in the pane it is worse, because Escape is a key you press to leave a text box.
  if (e.key === 'Escape') {
    const el0 = document.activeElement;
    if (el0 && (el0.tagName === 'INPUT' || el0.tagName === 'TEXTAREA' || el0.isContentEditable)) return;
    if (B.start) { B.start = null; return void render(); }
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
  let best = null, bd = 1e9;
  for (const h of sceneHits) {
    const d = Math.hypot(x - h.sx, y - h.sy);   // the scene returns screen-space centres (sx/sy) + a radius
    if (d < (h.r || 40) && d < bd) { bd = d; best = h; }
  }
  if (best && best.id !== B.selId) { B.selId = best.id; B.bench.tune = null; B.bench.paint = null; render(); }
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
        entries: (B.data.fleet || []).map(t => ({ id: t.id, cls: 'truck', variant: `${t.variant}~p`, livery: liveryOf(t) })),
      });
    }
    const hero = root.querySelector('#td-hero');
    const sel = selected();
    if (hero && sel) {
      if (B.screen === 'inspect') bindHeroPointer();
      const ctx = sizeCanvas(hero);
      const inspecting = B.screen === 'inspect';
      const walk = inspecting && B.inspect.mode === 'walk';
      if (walk && !B.start) stepWalk(dt);   // hands off the wheel while it lights — you are watching, not driving
      // A rig mid-start is drawn in its RUNNING mesh (emitter bands lit, the light patch on the
      // road under it) and pushed back down by `lift`, so the pose you see is the pose the mesh
      // means rather than a parked truck with a glow painted on it.
      const ph = startPhase(now);
      // The shake is on the CAMERA, not the model: the rig is a rigid body finding its height, and
      // what actually moves when a lifter takes six tonnes off a concrete floor is you.
      let camNow = walk ? { ...B.inspect.cam } : null;
      if (camNow && ph) {
        const k = ph.blow * 0.012;
        camNow.z += Math.sin(now * 0.047) * k;
        camNow.pitch += Math.sin(now * 0.031) * k * 0.5;
      }
      const anchor = ctx && drawHangarFloorBay(ctx, {
        w: hero._cw, h: hero._ch, cls: 'truck',
        variant: ph?.lit ? sel.variant : `${sel.variant}~p`, lift: ph ? ph.lift : 0,
        livery: liveryOf(sel),
        // The bench hero keeps its slow auto-turn; the turntable is YOURS to drag once you've asked
        // to walk around it, which is the whole difference between a display and an inspection.
        yaw: inspecting && !walk ? B.inspect.yaw : yaw,
        elev: inspecting && !walk ? B.inspect.elev : undefined,
        zoom: inspecting && !walk ? B.inspect.zoom : undefined,
        venue: 'garage', sky: B.data.sky, floor: true, floor3d: walk, fit: FIT,
        cam: camNow,
      });
      if (ctx && ph) drawStartFx(ctx, anchor, ph, hero._cw, hero._ch);
      // ONE PLACE ENDS IT, and it is the frame that reaches p === 1 — not a setTimeout racing the
      // animation, which would send `drive` while the rig was still halfway up on a slow tab.
      if (ph && ph.p >= 1) { const cmd = B.start.cmd; B.start = null; sendCmdSilent(cmd); }
      // The door is at the cab, not at the middle of the rig: walk up to the near-side step and the
      // prompt lights. Same distance test the hangar's BOARD uses, over the truck's own geometry.
      if (walk) {
        const c = B.inspect.cam, near = !B.start && Math.hypot(c.x - DOOR[0], c.y - DOOR[1], c.z - DOOR[2]) < 1.6;
        root.querySelector('#td-board')?.classList.toggle('near', near);
      }
    }
    for (const c of root.querySelectorAll('.td-wf')) {
      const ctx = c.getContext('2d');
      if (ctx) drawWireframe3D(ctx, { cls: 'truck', variant: c.dataset.variant, w: c.width, h: c.height, accent, yaw });
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

// A truck's paint, in the shape the shared renderer's palette already speaks. `base`/`trim` are the
// two colours every model here is skinned from, so a repainted cab is repainted everywhere it is
// drawn — the floor, the walkaround and the bench hero — for no per-surface code at all.
const liveryOf = (t) => (t.paint ? { base: t.paint.base, trim: t.paint.trim, finish: t.paint.chrome ? 'gloss' : 'matte' } : {});

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
    color:var(--td-fg);font-family:'Courier New',monospace;font-size:13px;line-height:1.45;
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
    font-family:inherit;font:700 11px/1 'Courier New',monospace;letter-spacing:1px;cursor:pointer;
    color:var(--td-fg-dim);background:transparent;border:1px solid transparent;border-radius:6px;padding:7px 12px;
    transition:filter .12s,box-shadow .12s,color .12s,background .12s}
  .td-tab.sm{padding:6px 10px}
  .td-tab-ico{font-size:12px;line-height:1;opacity:.7;transition:opacity .12s,filter .12s}
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
    font:700 13px/1 'Courier New',monospace;letter-spacing:2px;color:var(--td-fg);cursor:pointer;
    padding:9px 16px;border-radius:8px;opacity:0;pointer-events:none;
    background:color-mix(in srgb, var(--td-accent) 30%, rgba(6,12,18,.7));border:1px solid var(--td-accent);
    box-shadow:0 0 16px color-mix(in srgb, var(--td-accent) 45%, transparent);
    text-shadow:0 0 6px color-mix(in srgb, var(--td-accent) 55%, transparent);transition:opacity .18s,transform .18s}
  .td-board.near{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1);animation:tdBoardPulse 1.4s ease-in-out infinite}
  @keyframes tdBoardPulse{0%,100%{box-shadow:0 0 14px color-mix(in srgb, var(--td-accent) 40%, transparent)}
    50%{box-shadow:0 0 22px color-mix(in srgb, var(--td-accent) 70%, transparent)}}
  /* Start-up status line — lit, so a stood-down toolbar still reads as the machine doing something. */
  .td-run{display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border-radius:8px;
    font:700 11px/1 'Courier New',monospace;letter-spacing:1.5px;color:var(--td-fg);
    background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf-lo));
    border:1px solid var(--td-accent);box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 0 14px color-mix(in srgb, var(--td-accent) 35%, transparent);
    animation:tdRunPulse 1.1s ease-in-out infinite}
  @keyframes tdRunPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.16)}}
  .td-hint{position:absolute;top:16px;left:18px;right:18px;color:var(--td-fg-dim);font-size:12px;max-width:46ch;
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
  .td-chip-name{font-weight:bold;font-size:12px;letter-spacing:.5px}
  .td-chip-sub{color:var(--td-fg-dim);font-size:10.5px}
  .td-side{width:352px;flex:none;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-right:2px}
  /* The read-out is a raised surface card too — the hangar's .hb-info. */
  .td-pane{display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-radius:9px;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 30%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 3px var(--td-bevel-lo),0 2px 5px rgba(0,0,0,.2)}
  .td-pane-head{display:flex;align-items:flex-start;gap:8px}
  .td-pane-head b{color:var(--td-fg);font-size:14px;letter-spacing:.5px}
  .td-band{margin-left:auto;font:700 9px/1 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;
    padding:3px 8px;border-radius:11px;background:var(--td-surf-lo);border:1px solid var(--border)}
  .td-band.sound{color:#6fcf83}.td-band.worked{color:#a8c98a}.td-band.tired{color:#e8c07a}
  .td-band.ailing{color:#d8934e}.td-band.derelict{color:#d2685c}
  .td-spec{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0}
  /* Each spec is a recessed vital pill, the hangar's .hb-bench-vital. */
  .td-spec div{display:flex;flex-direction:column;line-height:1.2;padding:3px 10px;border-radius:6px;
    background:var(--td-surf-lo);border:1px solid var(--border);box-shadow:inset 0 1px 2px var(--td-bevel-lo)}
  .td-spec dt{font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim2)}
  .td-spec dd{margin:0;font-size:13px;font-weight:bold;color:var(--td-fg);font-variant-numeric:tabular-nums}
  .td-axes{display:flex;flex-direction:column;gap:4px;margin:4px 0}
  .td-axis{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:8px;
    font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim)}
  .td-axis-bar,.td-bar,.td-gauge{background:var(--td-surf-lo);border-radius:4px;overflow:hidden;
    box-shadow:inset 0 1px 2px var(--td-bevel-lo),inset 0 0 0 1px var(--border)}
  .td-axis-bar{height:7px}
  .td-axis-bar i{display:block;height:100%;background:var(--td-accent);box-shadow:0 0 7px currentColor}
  .td-axis-bar i.up{background:#6fcf83}.td-axis-bar i.down{background:#d2685c}
  .td-bar{display:block;height:5px}
  .td-bar i{display:block;height:100%;background:#5c8f6a}
  .td-bar i.ctired{background:#e8c07a}.td-bar i.cailing{background:#d8934e}.td-bar i.cderelict{background:#d2685c}
  .td-gauge{position:relative;height:18px}
  .td-gauge i{display:block;height:100%;background:#5c8f6a;box-shadow:0 0 8px currentColor}
  .td-gauge i.ctired{background:#e8c07a}.td-gauge i.cailing{background:#d8934e}.td-gauge i.cderelict{background:#d2685c}
  .td-gauge span{position:absolute;inset:0;text-align:center;font:700 10px/18px 'Courier New',monospace;color:var(--td-fg);
    text-shadow:0 1px 2px rgba(0,0,0,.7)}
  .td-acts{display:flex;gap:9px;flex-wrap:wrap}
  .td-acts.col{flex-direction:column;align-items:stretch}
  /* THE 3D KEY. The tablet's bevel language: a raised accent-tinted cap with a bright top highlight
     and a dark bottom bevel that PRESSES IN to a deep inset recess on :active, so every press feels
     like a physical key rather than a link with a border. */
  .td-act{display:inline-flex;align-items:center;justify-content:center;gap:8px;
    font-family:inherit;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;
    cursor:pointer;padding:9px 15px;border-radius:9px;color:var(--td-fg);
    border:1px solid color-mix(in srgb, var(--td-accent) 38%, transparent);
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),inset 0 -2px 4px var(--td-bevel-lo),0 2px 4px rgba(0,0,0,.25);
    transition:filter .12s,box-shadow .12s,transform .05s,border-color .12s}
  .td-ico{font-size:14px;line-height:1;opacity:.95}
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
  .td-lot-head b{color:var(--td-fg);font-size:14px;letter-spacing:1px}
  .td-price{margin-left:auto;color:var(--td-fg);font-variant-numeric:tabular-nums;font-weight:bold;letter-spacing:1px}
  /* The schematic sits in its own recessed dark viewport, same as the hangar's .hb-lot-view. */
  .td-wf{display:block;width:100%;height:auto;padding:6px;border-radius:9px;
    background:radial-gradient(120% 120% at 50% 40%,color-mix(in srgb, var(--td-accent) 15%, var(--bg)),color-mix(in srgb, var(--td-accent) 8%, var(--bg)));
    border:1px solid color-mix(in srgb, var(--td-accent) 22%, transparent);box-shadow:inset 0 2px 9px rgba(0,0,0,.4)}
  .td-blurb{color:var(--td-fg-dim);font-size:11.5px;min-height:3.2em}
  .td-sub-head{grid-column:1/-1;font:700 9px/1 'Courier New',monospace;letter-spacing:3px;text-transform:uppercase;
    color:var(--td-fg-dim);margin:12px 0 2px;padding-bottom:4px;
    border-bottom:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent)}
  .td-rows{grid-column:1/-1;display:flex;flex-direction:column}
  .td-rows.wide{flex:1;overflow:auto}
  .td-row{display:grid;grid-template-columns:1fr 78px 78px 132px 116px;gap:10px;align-items:center;padding:8px 4px;
    border-top:1px solid color-mix(in srgb, var(--td-accent) 14%, transparent)}
  .td-row.head{color:var(--td-fg-dim);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;border-top:0}
  .td-rows .td-row:first-child{border-top:0}
  .td-main{min-width:0}
  .td-num{text-align:right;font-variant-numeric:tabular-nums}
  .td-pay{grid-column:2/5;text-align:right;color:var(--td-fg);font-weight:bold;font-variant-numeric:tabular-nums}
  .td-knob{border-top:1px solid color-mix(in srgb, var(--td-accent) 16%, transparent);padding-top:9px}
  .td-knob-head{display:flex;align-items:baseline;gap:8px}
  .td-knob-head b{letter-spacing:.5px}
  .td-knob-head .td-num{margin-left:auto;color:var(--td-fg);font-weight:bold}
  .td-knob-poles{display:flex;justify-content:space-between;font-size:9px;letter-spacing:1px;color:var(--td-fg-dim2)}
  .td-slider{width:100%;accent-color:var(--td-accent)}
  .td-kit-row{display:flex;gap:10px;align-items:center;padding:9px 0;
    border-top:1px solid color-mix(in srgb, var(--td-accent) 16%, transparent)}
  .td-kit-row.on{opacity:.72}
  .td-fitted{font:700 9px/1 'Courier New',monospace;letter-spacing:1px;color:#6fcf83}
  .td-kits{display:flex;gap:5px;flex-wrap:wrap}
  .td-kit{font-size:9px;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;border-radius:11px;
    color:var(--td-fg-dim);background:var(--td-surf-lo);border:1px solid var(--border)}
  .td-paint{display:flex;gap:14px;align-items:center}
  .td-paint label{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--td-fg-dim)}
  .td-col{width:44px;height:28px;border:1px solid color-mix(in srgb, var(--td-accent) 35%, transparent);
    border-radius:6px;background:var(--td-surf-lo);cursor:pointer;box-shadow:inset 0 1px 0 var(--td-bevel-hi)}
  .td-swatches{display:flex;gap:5px;flex-wrap:wrap}
  .td-swatch{padding:6px 10px;font:700 10px/1 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;
    color:var(--td-fg-dim);border-radius:7px;cursor:pointer;
    background:linear-gradient(165deg,var(--td-surf),var(--td-surf-lo));
    border:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi),0 1px 3px rgba(0,0,0,.2);transition:filter .12s,border-color .12s,color .12s}
  .td-swatch:hover{filter:brightness(1.1);color:var(--td-fg)}
  .td-swatch.on{border-color:var(--td-accent);color:var(--td-fg);
    background:linear-gradient(165deg,color-mix(in srgb, var(--td-accent) 26%, var(--bg2)),var(--td-surf-lo));
    box-shadow:0 0 10px color-mix(in srgb, var(--td-accent) 32%, transparent),inset 0 1px 0 var(--td-bevel-hi)}
  .td-check{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--td-fg-dim)}
  .td-check input{accent-color:var(--td-accent)}
  .td-deck{padding:10px 12px;border-radius:9px;background:var(--td-surf-lo);
    border:1px solid var(--border);box-shadow:inset 0 1px 3px var(--td-bevel-lo)}
  .td-lab{font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--td-fg-dim2);display:block}
  .td-none{color:var(--td-fg-dim);padding:14px;text-align:center}
  .td-dim{color:var(--td-fg-dim)}
  .td-note{font-size:11px}
  .td-good{color:#6fcf83}
  .td-warn{color:#ffb26b}
  .td-foot{flex:0 0 auto;padding:9px 16px;font-size:11px;color:var(--td-fg-dim);
    background:color-mix(in srgb, var(--td-surf-lo) 84%, transparent);
    border-top:1px solid color-mix(in srgb, var(--td-accent) 25%, transparent);
    box-shadow:inset 0 1px 0 var(--td-bevel-hi)}
  .td-foot code{color:var(--td-fg);background:var(--td-surf);padding:2px 6px;border-radius:4px;margin-right:5px;
    border:1px solid color-mix(in srgb, var(--td-accent) 22%, transparent)}
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
