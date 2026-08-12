// THE LONG HAUL — the depot, as a place rather than a table.
//
// This was a 250-line modal with four tabs and three numbers per truck, sitting over the road
// because you had walked across a particular kerb. The hangar it was supposedly modelled on is a
// full-screen application with a 3D floor you can click a machine on, a walkaround camera, a
// dealer's lot and a mechanic's bench — and the gap between the two was the whole difference
// between owning an aircraft and owning a truck.
//
// So this is the same application, for trucks, and almost none of it is new code:
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

import { sendCmdSilent } from '../net.js';
import { drawWireframe3D, themeColor } from './wireframe-plane.js';
import { drawHangarScene, drawHangarFloorBay } from './aircraft3d.js';

let B = null;             // { data, screen, selId, inspect, bench }
let raf = null;
let sceneHits = [];
let yaw = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `${Number(n || 0).toLocaleString()}₵`;
const pct = (n) => `${Math.round((n || 0) * 100)}%`;

// Which screen a server-sent tab lands on. The server thinks in tabs because the log rung does;
// this file thinks in screens because it has a floor and a walkaround that no tab ever named.
const SCREEN_FOR_TAB = { fleet: 'floor', buy: 'buy', freight: 'freight', market: 'market', bench: 'bench' };

export function isTruckDepotActive() { return !!B; }

export function openTruckDepot(msg) {
  ensureStyles();
  const first = !B;
  const keepSel = B?.selId || null;
  B = {
    data: msg,
    screen: SCREEN_FOR_TAB[msg.tab] || (first ? 'floor' : B?.screen) || 'floor',
    selId: (msg.fleet || []).some(t => t.id === keepSel) ? keepSel : (msg.fleet || [])[0]?.id || null,
    inspect: B?.inspect || inspectDefault(),
    bench: B?.bench || { tab: 'condition', tune: null, paint: null },
    lotSel: B?.lotSel || null,
  };
  // A fresh truck selected (you just bought one) resets any half-turned dials — they belonged to a
  // different machine, and carrying them across would silently propose a tune nobody asked for.
  B.bench.tune = null; B.bench.paint = null;
  mount();
}

export function closeTruckDepot() {
  if (raf) cancelAnimationFrame(raf);
  raf = null; sceneHits = []; walkKeys.clear();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('keyup', onKeyUp);
  for (const n of document.querySelectorAll('.td-root')) n.remove();
  B = null;
}

function mount() {
  let root = document.getElementById('td-root');
  if (!root) {
    const host = document.getElementById('overlay-host') || document.body;
    root = document.createElement('div');
    root.id = 'td-root';
    root.className = 'td-root';
    host.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
  }
  render();
  startSpin();
}

const selected = () => (B?.data.fleet || []).find(t => t.id === B.selId) || null;

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('td-root');
  if (!root || !B) return;
  const d = B.data;
  const nav = [['floor', 'The Yard'], ['buy', 'For Sale'], ['bench', 'Bench'], ['freight', 'Freight'], ['market', 'Exchange']]
    .map(([k, label]) => `<button class="td-tab${B.screen === k ? ' on' : ''}" data-screen="${k}">${label}</button>`).join('');

  root.innerHTML = `
  <div class="td-app" role="dialog" aria-label="${esc(d.depot)}">
    <header class="td-head">
      <div class="td-title"><b>${esc(d.depot)}</b><span class="td-dim"> · ${esc(d.regionName || '')}</span></div>
      <nav class="td-nav">${nav}</nav>
      <div class="td-bal">${money(d.credits)}</div>
      <button class="td-x" data-close aria-label="Close">✕</button>
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
  </div>`;
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
    sel.hereNow ? `<button class="td-act primary" data-cmd="drive">Take it out</button>` : '',
    `<button class="td-act" data-screen="bench">Bench</button>`,
    d.fuelHere && sel.fuel < 0.99 ? `<button class="td-act" data-cmd="rig fuel ${esc(sel.id)}">Refuel · ${money(sel.refuel)}</button>` : '',
    `<button class="td-act" data-screen="inspect">Walk around</button>`,
    sel.hereNow ? `<button class="td-act ghost" data-confirm="yard sell ${esc(sel.id)}">Sell · ${money(sel.resale)}</button>` : '',
    `<button class="td-act ghost" data-screen="buy">Dealer's line</button>`,
  ].filter(Boolean).join('') : `<button class="td-act primary" data-screen="buy">See what's for sale</button>`;

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
const inspectDefault = () => ({ mode: 'walk', yaw: 0, elev: 0.3, zoom: 1.1,
  cam: { x: 4.2, y: 1.8, z: -0.02, yaw: Math.PI - 0.35, pitch: 0.02, fov: 1 } });
const walkKeys = new Set();
const WALK_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f']);

function inspectScreen() {
  const t = selected();
  if (!t) return '<div class="td-none">Nothing selected.</div>';
  const m = B.inspect.mode;
  const board = (m === 'walk' && t.hereNow)
    ? '<div class="td-board" id="td-board" data-cmd="drive">CLIMB IN</div>' : '';
  return `
    <div class="td-floor">
      <canvas id="td-hero" class="td-scene" tabindex="0" aria-label="Walkaround"></canvas>
      ${board}
      <div class="td-strip">
        <button class="td-act${m === 'orbit' ? ' primary' : ''}" data-mode="orbit">Turntable</button>
        <button class="td-act${m === 'walk' ? ' primary' : ''}" data-mode="walk">Walk around</button>
        ${t.hereNow ? '<button class="td-act primary" data-cmd="drive">Take it out</button>' : ''}
        <button class="td-act ghost" data-view-reset>Reset view</button>
        <button class="td-act ghost" data-screen="floor">Back to the floor</button>
        <span class="td-dim td-note">${m === 'walk'
          ? 'WASD to move · drag to look · Q/E turn · R/F height · walk up to the door and press Enter.'
          : 'Drag to turn it · wheel to zoom.'}</span>
      </div>
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
  const AF = 2.6, AG = 0.95;   // a rig is long and narrow — an aeroplane's ellipse is the wrong shape
  if (cam.z < 1.1) { const d = Math.hypot(cam.x / AF, cam.y / AG); if (d > 1e-3 && d < 1) { cam.x /= d; cam.y /= d; } }
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
        <button class="td-act primary" data-cmd="yard buy ${esc(t.id)}" ${t.afford ? '' : 'disabled title="You cannot afford it"'}>Buy · ${money(t.price)}</button>
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
  const tabs = [['condition', 'Condition'], ['tune', 'Tuning'], ['kits', 'Kits'], ['paint', 'Paint']]
    .map(([k, l]) => `<button class="td-tab sm${B.bench.tab === k ? ' on' : ''}" data-bench="${k}">${l}</button>`).join('');
  return `
    <div class="td-floor">
      <canvas id="td-hero" class="td-scene" aria-label="${esc(t.name)}"></canvas>
      <div class="td-strip">${tabs}<button class="td-act ghost" data-screen="floor">Back to the floor</button></div>
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
  const t = e.target.closest('[data-cmd],[data-screen],[data-sel],[data-bench],[data-mode],[data-lot],[data-flash],[data-close],[data-confirm],[data-tune-reset],[data-paint-reset],[data-view-reset]');
  if (!t || t.disabled) {
    if (e.target.id === 'td-scene') pickOnFloor(e);
    return;
  }
  if (t.dataset.close != null) return void closeTruckDepot();
  if (t.dataset.sel) { B.selId = t.dataset.sel; B.bench.tune = null; B.bench.paint = null; return void render(); }
  if (t.dataset.screen) { B.screen = t.dataset.screen; return void render(); }
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
  if (e.key === 'Escape') return void closeTruckDepot();
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
        selId: B.selId, entries: (B.data.fleet || []).map(t => ({ id: t.id, cls: 'truck', variant: t.variant, livery: liveryOf(t), label: t.name })),
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
      if (ctx) drawHangarFloorBay(ctx, {
        w: hero._cw, h: hero._ch, cls: 'truck', variant: sel.variant, livery: liveryOf(sel),
        // The bench hero keeps its slow auto-turn; the turntable is YOURS to drag once you've asked
        // to walk around it, which is the whole difference between a display and an inspection.
        yaw: inspecting && !walk ? B.inspect.yaw : yaw,
        elev: inspecting && !walk ? B.inspect.elev : undefined,
        zoom: inspecting && !walk ? B.inspect.zoom : undefined,
        venue: 'garage', sky: B.data.sky, floor: true, floor3d: walk,
        cam: walk ? { ...B.inspect.cam } : null,
      });
      // The door is at the cab, not at the middle of the rig: walk up to the near-side step and the
      // prompt lights. Same distance test the hangar's BOARD uses, over the truck's own geometry.
      if (walk) {
        const c = B.inspect.cam, near = Math.hypot(c.x - 0.9, c.y, c.z - 0.1) < 2.6;
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
  s.textContent = `
  .td-root{position:fixed;inset:0;background:rgba(4,5,7,.86);display:flex;align-items:center;justify-content:center;z-index:900}
  .td-app{width:min(1240px,97vw);height:min(860px,94vh);display:flex;flex-direction:column;background:#0e1114;
    border:1px solid #2b3138;border-radius:8px;color:#cdd6e0;font:13px/1.45 inherit;box-shadow:0 24px 80px rgba(0,0,0,.7)}
  .td-head{display:flex;align-items:center;gap:14px;padding:10px 14px;border-bottom:1px solid #262c33}
  .td-title b{color:#e8e8e8}
  .td-nav{display:flex;gap:2px;margin-left:8px}
  .td-bal{margin-left:auto;color:#e8c07a;font-variant-numeric:tabular-nums}
  .td-x{background:none;border:0;color:#7c848f;font-size:16px;cursor:pointer}
  .td-x:hover{color:#fff}
  .td-tab{background:none;border:0;border-bottom:2px solid transparent;padding:6px 12px;color:#7c848f;
    font:600 11px/1 inherit;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
  .td-tab.sm{padding:5px 9px}
  .td-tab:hover{color:#cdd6e0}
  .td-tab.on{color:#e8c07a;border-bottom-color:#e8c07a}
  .td-body{flex:1;min-height:0;display:flex;gap:12px;padding:12px;overflow:hidden}
  .td-floor{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;position:relative}
  .td-scene{flex:1;min-height:0;width:100%;border:1px solid #22282e;border-radius:6px;background:#0a0c0f;cursor:pointer}
  .td-scene:focus{outline:none;border-color:#3b4652}
  .td-board{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%) scale(.9);z-index:5;
    padding:8px 16px;border:1px solid #6d5a34;border-radius:4px;background:rgba(14,17,20,.82);color:#e8c07a;
    font:700 12px/1 inherit;letter-spacing:.16em;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
  .td-board.near{opacity:1;pointer-events:auto;cursor:pointer;transform:translate(-50%,-50%) scale(1);
    animation:tdBoardPulse 1.4s ease-in-out infinite}
  @keyframes tdBoardPulse{0%,100%{box-shadow:0 0 0 0 rgba(232,192,122,.28)}50%{box-shadow:0 0 0 10px rgba(232,192,122,0)}}
  .td-hint{position:absolute;top:14px;left:16px;right:16px;color:#8b949f;font-size:12px;max-width:46ch}
  .td-strip{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .td-chip{display:flex;flex-direction:column;gap:2px;min-width:132px;text-align:left;padding:6px 8px;cursor:pointer;
    background:#14181d;border:1px solid #262c33;border-radius:5px;color:#cdd6e0}
  .td-chip.on{border-color:#e8c07a}
  .td-chip.away{opacity:.6}
  .td-chip-name{font-weight:600;font-size:12px}
  .td-chip-sub{color:#7c848f;font-size:10.5px}
  .td-side{width:352px;flex:none;overflow:auto;display:flex;flex-direction:column;gap:10px}
  .td-pane{display:flex;flex-direction:column;gap:8px}
  .td-pane-head{display:flex;align-items:flex-start;gap:8px}
  .td-pane-head b{color:#e8e8e8}
  .td-band{margin-left:auto;font:600 10px/1 inherit;letter-spacing:.1em;text-transform:uppercase;padding:4px 7px;border-radius:3px;background:#1a1f25}
  .td-band.sound{color:#6fcf83}.td-band.worked{color:#a8c98a}.td-band.tired{color:#e8c07a}
  .td-band.ailing{color:#d8934e}.td-band.derelict{color:#d2685c}
  .td-spec{display:flex;flex-wrap:wrap;gap:10px 16px;margin:2px 0}
  .td-spec div{display:flex;flex-direction:column}
  .td-spec dt{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#69727d}
  .td-spec dd{margin:0;font-variant-numeric:tabular-nums}
  .td-axes{display:flex;flex-direction:column;gap:3px;margin:4px 0}
  .td-axis{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:8px;font-size:10.5px;color:#8b949f}
  .td-axis-bar{height:5px;background:#1c2126;border-radius:3px;overflow:hidden}
  .td-axis-bar i{display:block;height:100%;background:#5f87b0}
  .td-axis-bar i.up{background:#6fcf83}.td-axis-bar i.down{background:#d2685c}
  .td-bar{display:block;height:4px;background:#1c2126;border-radius:2px;overflow:hidden}
  .td-bar i{display:block;height:100%;background:#5c8f6a}
  .td-bar i.ctired{background:#e8c07a}.td-bar i.cailing{background:#d8934e}.td-bar i.cderelict{background:#d2685c}
  .td-gauge{position:relative;height:16px;background:#1c2126;border-radius:3px;overflow:hidden}
  .td-gauge i{display:block;height:100%;background:#5c8f6a}
  .td-gauge i.ctired{background:#e8c07a}.td-gauge i.cailing{background:#d8934e}.td-gauge i.cderelict{background:#d2685c}
  .td-gauge span{position:absolute;inset:0;text-align:center;font:600 10px/16px inherit;color:#0b0d10}
  .td-acts{display:flex;gap:6px;flex-wrap:wrap}
  .td-acts.col{flex-direction:column;align-items:stretch}
  .td-act{padding:7px 11px;font:600 11px/1.3 inherit;letter-spacing:.05em;color:#cdd6e0;text-align:left;
    background:#1a1f25;border:1px solid #333a43;border-radius:4px;cursor:pointer}
  .td-act.primary{border-color:#6d5a34;color:#e8c07a}
  .td-act.ghost{background:none}
  .td-act:hover:not(:disabled){background:#232a31;border-color:#4d5763;color:#fff}
  .td-act:disabled{opacity:.35;cursor:not-allowed}
  .td-lots{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;align-content:start}
  .td-lot{border:1px solid #262c33;border-radius:6px;padding:12px;background:linear-gradient(#14181d,#0f1216);display:flex;flex-direction:column;gap:6px}
  .td-lot.on{border-color:#e8c07a}
  .td-lot.poor{opacity:.62}
  .td-lot-head{display:flex;align-items:flex-start}
  .td-lot-head b{color:#e8e8e8;font-size:14px}
  .td-price{margin-left:auto;color:#e8c07a;font-variant-numeric:tabular-nums;font-weight:600}
  .td-wf{display:block;width:100%;height:auto;background:#090b0d;border:1px solid #1c2126;border-radius:4px}
  .td-blurb{color:#828c98;font-size:11.5px;min-height:3.2em}
  .td-sub-head{grid-column:1/-1;font:600 10px/1 inherit;letter-spacing:.12em;text-transform:uppercase;color:#69727d;margin-top:6px}
  .td-rows{grid-column:1/-1;display:flex;flex-direction:column}
  .td-rows.wide{flex:1;overflow:auto}
  .td-row{display:grid;grid-template-columns:1fr 78px 78px 132px 104px;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #191e23}
  .td-row.head{color:#69727d;font-size:10px;letter-spacing:.1em;text-transform:uppercase;border-top:0}
  .td-rows .td-row:first-child{border-top:0}
  .td-main{min-width:0}
  .td-num{text-align:right;font-variant-numeric:tabular-nums}
  .td-pay{grid-column:2/5;text-align:right;color:#e8c07a;font-variant-numeric:tabular-nums}
  .td-knob{border-top:1px solid #1c2126;padding-top:8px}
  .td-knob-head{display:flex;align-items:baseline;gap:8px}
  .td-knob-head .td-num{margin-left:auto;color:#e8c07a}
  .td-knob-poles{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.1em;color:#69727d}
  .td-slider{width:100%;accent-color:#e8c07a}
  .td-kit-row{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #1c2126}
  .td-kit-row.on{opacity:.72}
  .td-fitted{font:600 10px/1 inherit;letter-spacing:.1em;color:#6fcf83}
  .td-kits{display:flex;gap:4px;flex-wrap:wrap}
  .td-kit{font-size:10px;padding:2px 6px;border-radius:3px;background:#1a1f25;color:#8fae8f}
  .td-paint{display:flex;gap:14px;align-items:center}
  .td-paint label{display:flex;align-items:center;gap:6px;font-size:11px;color:#8b949f}
  .td-col{width:44px;height:26px;border:1px solid #333a43;border-radius:4px;background:none;cursor:pointer}
  .td-swatches{display:flex;gap:4px;flex-wrap:wrap}
  .td-swatch{padding:5px 9px;font:600 10px/1 inherit;letter-spacing:.08em;text-transform:uppercase;color:#8b949f;
    background:#14181d;border:1px solid #262c33;border-radius:4px;cursor:pointer}
  .td-swatch.on{border-color:#e8c07a;color:#e8c07a}
  .td-check{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#8b949f}
  .td-deck{border-top:1px solid #20262c;padding-top:8px}
  .td-lab{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#69727d;display:block}
  .td-none{color:#727b86;padding:12px}
  .td-dim{color:#727b86}
  .td-note{font-size:11px}
  .td-good{color:#6fcf83}
  .td-warn{color:#d8a24e}
  .td-foot{padding:8px 14px;border-top:1px solid #20262c;font-size:11px;color:#727b86}
  .td-foot code{background:#171b20;padding:1px 5px;border-radius:3px;margin-right:4px}
  @media (max-width:900px){.td-body{flex-direction:column}.td-side{width:auto}}
  `;
  document.head.appendChild(s);
}
