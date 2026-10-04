// THE MARINA — a hand of cards at the counter, and the shipwright and the pump at the helm.
//
// The truck depot's shape (truck-depot.js), for boats. It opened on a 3-D dock that was a painted
// second copy of the Dock Hall; picking a hull now seats you in her in the REAL covered slot, on the
// water under the roof GLASS draws, so the painted dock is gone.
//
//   THE COUNTER (in the pane) is where you choose: your boats as cards — the hull on one of three
//       backdrops, her name, owned or hired — then a card to buy one and a card to hire one.
//       Picking a boat is `boat take <id>`, which walks you to her, puts you in her and hands you
//       the helm.
//
//   THE SEAT (an overlay on the helm's glass) is where you work on her. In the covered slot it is
//       the shipwright: the hull, the oil, the prop, the bottom, paint, a decal and her name, and
//       "Cast off" is the lever. Stopped at the fuel float it is the pump. The server opens and
//       closes it as she comes and goes (plugins/powerboat/helm.js svcTick).
//
// ⚠ IT IS STILL A SKIN OVER THE IDENTICAL TEXT. Every button sends a verb string a player could
// have typed and every number is one the text rung prints, which is what keeps this on
// `prefersLoggedPanels`: delete it and nobody is stuck, they are reading instead of clicking.
// ⚠ AND IT RE-PUSHES AFTER EVERY MUTATION; nothing here guesses what changed.

import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
// ⚠ THE DEALER'S SCHEMATIC IS THE SAME ONE THE OTHER TWO LOTS BUY THROUGH — `drawWireframe3D` strokes
// `aircraftFaces`, the face list the windscreen and a stranger's contact draw.
import { drawWireframe3D, themeColor } from './wireframe-plane.js';
import { paintVehicleCard, paintSlotCard, cardStyleFor, cardSeed, ensureCardStyles, barTone } from './vehicle-card.js';
import { boatServiceHost, boatPreview, boatView } from './boat-view.js';

const TABS = [['lot', 'YOUR BOATS'], ['dealer', 'FOR SALE'], ['rent', 'HIRE'], ['berths', 'BERTHS']];

// Which screen a server-sent tab lands on. The server's tabs predate the hand: everything that used
// to be the dock, the fleet or the bench is the hand now (the bench itself is in the seat).
const TAB_FOR = { lot: 'lot', fleet: 'lot', dock: 'lot', bench: 'lot', dealer: 'dealer', rent: 'rent', berths: 'berths' };

let st = null;      // the counter
let sv = null;      // the seat's overlay

export function isMarinaActive() { return !!st; }

export function openMarina(msg = {}) {
  if (msg.service) return openMarinaService(msg);
  const host = msg.mount || document.getElementById('area-content');
  if (!host) return;
  ensureMarinaStyles();
  ensureCardStyles();
  const want = TAB_FOR[msg.tab] || st?.tab || 'lot';
  st = { host, data: msg, tab: want, onSend: msg.onSend || st?.onSend || null };
  draw();
}

export function closeMarina() {
  if (!st) return;
  if (ro) { ro.disconnect(); ro = null; }
  stopWireframes();
  // ⚠ THE MODE OWNS THE PAGE — leaving in big screen with nothing to take it down strands the player.
  exitBigScreen();
  if (st.host) st.host.innerHTML = '';
  st = null;
}

/** The server re-pushes after anything that changed the world; this is where it lands. */
export function marinaSetData(msg = {}) {
  if (msg.service) return openMarinaService(msg);
  if (!st) return openMarina(msg);
  st.data = msg;
  if (TAB_FOR[msg.tab]) st.tab = TAB_FOR[msg.tab];
  draw();
}

const send = (cmd) => { try { (st?.onSend || sv?.onSend)?.(cmd); } catch { /* the pane can outlive the socket */ } };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v ?? 0))) * 100);
const money = (n) => `₵${Number(n || 0).toLocaleString()}`;

// ── The counter ──────────────────────────────────────────────────────────────
function draw() {
  if (!st) return;
  const d = st.data || {};
  const tabs = TABS.filter(([k]) => (k !== 'dealer' && k !== 'rent') || d.dealer)
    .map(([k, label]) => `<button class="mar-tab${k === st.tab ? ' on' : ''}" data-tab="${k}" type="button">${label}</button>`).join('');
  st.host.innerHTML = '<div class="mar-root">'
    + '<div class="mar-head">'
    + `<span class="mar-name">${esc(d.name || 'The Marina')}</span>`
    + `<span class="mar-credits">${money(d.credits)}</span>`
    + '<span class="mar-spacer"></span>'
    + `<button class="mar-chip mar-big" type="button" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>`
    + '<button class="mar-chip mar-x" type="button" title="Put the screen away and look at the room" aria-label="Close">✕</button>'
    + '</div>'
    + `<div class="mar-tabs">${tabs}</div>`
    // The room's doors. The screen sits over the room description, so the ways out have to be on it.
    + ((d.exits || []).length ? `<div class="mar-exits"><span class="mar-dim">Leave</span>${d.exits.map((x) =>
      `<button class="mar-go" type="button" data-leave="${esc(x.dir)}">${esc(x.dir)} · ${esc(x.name)}</button>`).join('')}</div>` : '')
    + `<div class="mar-body">${st.tab === 'dealer' ? dealerBody(d) : st.tab === 'rent' ? rentBody(d) : st.tab === 'berths' ? berthBody(d) : lotBody(d)}</div>`
    + '</div>';
  const root = st.host.querySelector('.mar-root');
  bindBigScreenButton(root.querySelector('.mar-big'));
  root.addEventListener('click', onClick);
  spinWireframes();
  requestAnimationFrame(paintCards);
  watchSize();
}

// ⚠ ANYTHING IRREVERSIBLE ASKS — handing a hire back, a crane bill, a tow.
function onClick(e) {
  const tab = e.target.closest?.('[data-tab]');
  if (tab && st) { st.tab = tab.dataset.tab; draw(); return; }
  // Leaving: the move closes the screen from the server side (marina_close), and the room paints.
  const leave = e.target.closest?.('[data-leave]');
  if (leave && st) { send(leave.dataset.leave); return; }
  // ✕ puts it away here and asks for the room; walking back in deals the hand again.
  if (e.target.closest?.('.mar-x') && st) { const s = st.onSend; closeMarina(); try { s?.('look'); } catch { /* socket gone */ } return; }
  const c = e.target.closest?.('[data-confirm]');
  if (c && !c.disabled) {
    if (c.dataset.armed) { send(c.dataset.confirm); return; }
    c.dataset.armed = '1'; c.textContent = 'Sure? Click again';
    setTimeout(() => { if (c.isConnected) (sv ? drawService() : draw()); }, 4000);
    return;
  }
  const b = e.target.closest?.('[data-cmd]');
  if (b && !b.disabled && b.dataset.cmd) send(b.dataset.cmd);
}

// ── THE HAND ─────────────────────────────────────────────────────────────────
// One card per hull you have, owned or hired, then Buy and Hire. The card is the button that seats
// you: `boat take`. ⚠ A HULL ON A CRADLE IS A CRANE JOB FIRST, and the card says so and what it costs
// (the server does it as part of `take`); one that is somewhere else is shown faded, not hidden.
function lotBody(d) {
  const fleet = d.fleet || [];
  const cards = fleet.map((b) => {
    const ready = b.inYard && !b.aboard && b.kind !== 'adrift';
    const hard = b.kind === 'hard';
    const badge = b.rental ? `<span class="vc-badge hired">HIRED · ${esc(b.rental.leftText)}</span>` : '<span class="vc-badge owned">OWNED</span>';
    const sub = b.aboard ? 'you are sitting in her'
      : !b.inYard ? esc(b.where || 'somewhere else')
      : hard ? `on a cradle: ${money(d.craneFee)} to crane her in` : `${esc(b.typeName)} · fuel ${pct(b.fuel)}%`;
    const cmd = `boat take ${b.id}`;
    const acts = [
      b.rental && b.inYard && !b.aboard ? `<button class="vc-mini" data-confirm="boat return ${esc(b.id)}" title="Hand her back early, no refund">Hand her back</button>` : '',
      !b.inYard ? '<button class="vc-mini" data-confirm="tow" title="Somebody goes out for her, for a price">Tow her in</button>' : '',
    ].filter(Boolean).join('');
    return `<div class="vc-wrap${ready ? '' : ' away'}">
      <button class="vc-card ${cardStyleFor(b.id)}" ${ready ? (hard ? `data-confirm="${esc(cmd)}"` : `data-cmd="${esc(cmd)}"`) : 'disabled'}
          aria-label="${esc(`${b.name}, ${b.rental ? 'hired' : 'owned'}${ready ? ': take the helm' : ''}`)}"
          title="${ready ? 'Take the helm: she starts in the covered slot' : esc(b.where || '')}">
        <canvas class="vc-cv" data-card="${esc(b.id)}" aria-hidden="true"></canvas>
        ${badge}
        <span class="vc-plate"><b>${esc(b.name)}</b><span class="vc-sub">${sub}</span>
          <span class="vc-bar" title="hull ${pct(b.hull)}%"><i class="${barTone(b.hull)}" style="width:${pct(b.hull)}%"></i></span></span>
      </button>
      ${acts ? `<div class="vc-acts">${acts}</div>` : ''}
    </div>`;
  }).join('');
  const slot = (tab, label, sub) => `<div class="vc-wrap"><button class="vc-card slot" data-tab="${tab}" aria-label="${label}">
      <canvas class="vc-cv" data-slot="${tab}" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>${label}</b><span class="vc-sub">${sub}</span></span></button></div>`;
  return `${fleet.length ? '' : '<p class="mar-dim">Nothing of yours on this water. Buy a hull, or hire one for the afternoon.</p>'}
    <div class="vc-hand">${cards}${d.dealer ? slot('dealer', 'Buy a boat', `${(d.stock || []).length} on the line`) + slot('rent', 'Hire a boat', d.hasRental ? 'one out already' : 'by the afternoon') : ''}</div>`;
}

function rentBody(d) {
  if (!d.dealer) return '<p class="mar-dim">Nobody hires hulls out here.</p>';
  const cards = (d.rentStock || []).map((t) => {
    const why = d.hasRental ? 'You already have one out on hire' : t.afford ? '' : "You can't afford it";
    return `<div class="vc-wrap">
      <div class="vc-card ${cardStyleFor('hire:' + t.id)} static">
        <canvas class="vc-cv" data-rent="${esc(t.id)}" aria-hidden="true"></canvas>
        <span class="vc-badge hired">FOR HIRE</span>
        <span class="vc-plate"><b>${esc(t.name)}</b><span class="vc-sub">${t.hours} hours · tank full</span></span>
      </div>
      <div class="vc-acts"><button class="mar-go pri" data-cmd="boat rent ${esc(t.id)}" ${why ? `disabled title="${esc(why)}"` : ''}>Hire · ${money(t.fee)}</button></div>
    </div>`;
  }).join('');
  return `<p class="mar-dim">A hire comes out of the covered dock fuelled and serviced, and goes back on its own when the time is up and she is tied up. One at a time.</p>
    <div class="vc-hand">${cards}</div>`;
}

// ── THE DEALER ───────────────────────────────────────────────────────────────
// ⚠ `fill` RATHER THAN THE STOCK FOCAL: that focal was set for airframes and a hull is authored far
// smaller, so unfitted she renders as a doodle in the middle of an empty box.
function dealerBody(d) {
  if (!d.dealer) return '<p class="mar-dim">Nobody sells hulls here.</p>';
  const afford = Number(d.credits || 0);
  return (d.stock || []).map((t) => '<div class="mar-card">'
    + `<div class="mar-card-head"><span class="mar-boat">${esc(t.name)}</span>`
    + `<span class="mar-price${t.price > afford ? ' over' : ''}">${money(t.price)}</span></div>`
    + `<canvas class="mar-wf" data-wf-cls="${esc(t.id)}" aria-label="${esc(t.name)}, schematic"></canvas>`
    + `<p class="mar-blurb">${esc(t.blurb || '')}</p>`
    + '<div class="mar-out">Out of the shed: <b>hull sound</b> · <b>tank full</b> · <b>bottle charged</b></div>'
    + `<div class="mar-acts"><button class="mar-go pri" type="button" data-cmd="boat ${esc(t.id)}"${t.price > afford ? ' disabled' : ''}>Buy</button></div>`
    + '</div>').join('') || '<p class="mar-dim">The shed is empty.</p>';
}

// ⚠ TAKEN OF CAPACITY, COUNTED SERVER-SIDE — occupancy is counted against the rows, never stored.
function berthBody(d) {
  const rows = d.berths || [];
  if (!rows.length) return '<p class="mar-dim">Nowhere here to keep a hull.</p>';
  return rows.map((b) => '<div class="mar-card">'
    + `<div class="mar-card-head"><span class="mar-boat">${esc(b.name)}</span><span class="mar-dim">${esc(b.kindWord || '')}</span></div>`
    + `<div class="mar-where">${b.taken} of ${b.capacity} taken: move a hull in with <b>berth</b> while standing there</div>`
    + '</div>').join('');
}

// ── The cards, painted ───────────────────────────────────────────────────────
// Once per draw and per resize, never in a loop (vehicle-card.js says why).
let ro = null;
function paintCards() {
  if (!st) return;
  const fleet = st.data?.fleet || [];
  for (const cv of st.host.querySelectorAll('canvas[data-card]')) {
    const b = fleet.find((r) => r.id === cv.dataset.card);
    if (!b) continue;
    paintVehicleCard(cv, { style: cardStyleFor(b.id), seed: cardSeed(b.id), dim: !b.inYard,
      v: { cls: b.typeId || 'hydro', livery: b.livery || null, yaw: 0.62, fit: 2.3, elev: 0.28 } });
  }
  for (const cv of st.host.querySelectorAll('canvas[data-rent]')) {
    const id = cv.dataset.rent;
    paintVehicleCard(cv, { style: cardStyleFor('hire:' + id), seed: cardSeed('hire:' + id),
      v: { cls: id, livery: null, yaw: 0.62, fit: 2.3, elev: 0.28 } });
  }
  for (const cv of st.host.querySelectorAll('canvas[data-slot]')) {
    const buy = cv.dataset.slot === 'dealer';
    paintSlotCard(cv, { style: buy ? 'showroom' : 'sunburst', seed: buy ? 5 : 9, glyph: buy ? '+' : '⟲' });
  }
}
function watchSize() {
  if (ro || typeof ResizeObserver !== 'function' || !st) return;
  let t = 0;
  ro = new ResizeObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(paintCards); });
  ro.observe(st.host);
}

// ── THE SCHEMATICS, TURNING ──────────────────────────────────────────────────
// Started and stopped by which tab is up; re-queries its canvases each frame and retires itself when
// there are none, so it can never outlive what it is painting.
let spinRaf = 0;
function stopWireframes() { if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; } }
function spinWireframes() {
  stopWireframes();
  if (!st || st.tab !== 'dealer') return;
  const accent = themeColor('--cyan', '#7fd4ff');
  const loop = () => {
    const cards = st?.host?.querySelectorAll?.('.mar-wf');
    if (!cards || !cards.length) { spinRaf = 0; return; }
    const yaw = performance.now() / 2600;
    for (const cv of cards) {
      const ctx = sizeCanvas(cv);
      if (ctx) drawWireframe3D(ctx, { cls: cv.dataset.wfCls || 'hydro', w: cv._cw, h: cv._ch, accent, yaw, fill: 0.94 });
    }
    spinRaf = requestAnimationFrame(loop);
  };
  spinRaf = requestAnimationFrame(loop);
}
function sizeCanvas(cv) {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!cv._cw || Math.abs(r.width - cv._cw) > 0.5 || Math.abs(r.height - cv._ch) > 0.5) {
    cv._cw = r.width; cv._ch = r.height;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  }
  const ctx = cv.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ── THE SEAT'S OVERLAY ───────────────────────────────────────────────────────
// Mounted in the helm's own root (boat-view `boatServiceHost`), never in the pane the seat owns.
// `dock` is the shipwright in the covered slot; `fuel` is the pump at the float.
export function openMarinaService(msg) {
  ensureMarinaStyles();
  const host = boatServiceHost();
  if (!host) return;
  const was = sv;
  sv = {
    data: msg, mode: msg.service, onSend: was?.onSend || msg.onSend || null,
    tab: was && was.mode === msg.service ? was.tab : 'service',
    // Open when she arrives; after that, folded or open is the helmsman's.
    open: was && was.mode === msg.service ? was.open : true,
    pick: was?.pick || null, view: was?.view ?? null,
  };
  const b = boat();
  if (b?.rental && sv.tab !== 'service') sv.tab = 'service';
  drawService();
}
export function setMarinaServiceSend(fn) { if (sv) sv.onSend = fn; }

export function closeMarinaService() {
  if (!sv) return;
  restoreView();
  try { boatPreview({ livery: null }); } catch { /* the seat can already be gone */ }
  document.getElementById('mar-svc')?.remove();
  sv = null;
}

const boat = () => (sv?.data?.fleet || []).find((b) => b.id === sv.data.serviceId) || null;

function drawService() {
  if (!sv) return;
  const host = boatServiceHost();
  if (!host) return;
  let el = document.getElementById('mar-svc');
  if (!el || el.parentElement !== host) {
    el?.remove();
    el = document.createElement('div');
    el.id = 'mar-svc';
    el.addEventListener('click', onServiceClick);
    host.appendChild(el);
  }
  const d = sv.data, b = boat();
  const where = sv.mode === 'fuel' ? 'the fuel float' : 'the covered dock';
  el.className = 'mar-svc' + (sv.open ? ' open' : ' folded');
  if (!sv.open) {
    el.innerHTML = `<button class="mar-go mar-svc-chip" data-svc="open">${sv.mode === 'fuel' ? '⛽' : '⚓'} ${esc(where)}</button>`;
    syncPreview();
    return;
  }
  const tabs = sv.mode === 'fuel' ? '' : [['service', 'SERVICE'], ['paint', 'PAINT'], ['name', 'NAME']]
    .filter(([k]) => !b?.rental || k === 'service')
    .map(([k, l]) => `<button class="mar-tab${sv.tab === k ? ' on' : ''}" data-svtab="${k}" type="button">${l}</button>`).join('');
  const body = !b ? '<p class="mar-dim">She is not on the books here.</p>'
    : sv.mode === 'fuel' ? fuelBody(b) : sv.tab === 'paint' ? paintBody(b, d) : sv.tab === 'name' ? nameBody(b) : serviceBody(b);
  el.innerHTML = `<div class="mar-svc-head"><span class="mar-name">${sv.mode === 'fuel' ? '⛽' : '⚓'} ${esc(b?.name || 'her')}</span>
      <span class="mar-credits">${money(d.credits)}</span><span class="mar-spacer"></span>
      ${sv.mode === 'dock' && b ? '<button class="mar-go pri" data-cmd="disembark" title="The slings take her out of the water and you step up into the Dock Hall (P)">⚓ Dock her</button>' : ''}
      <button class="mar-go" data-svc="fold" title="Fold this away">${sv.mode === 'fuel' ? 'Carry on ▸' : 'Cast off ▸'}</button></div>
    ${b?.rental ? `<div class="mar-svc-hire">Hire boat · ${esc(b.rental.leftText)} · step off in the slot to hand her back with <b>boat return</b></div>` : ''}
    ${tabs ? `<div class="mar-tabs">${tabs}</div>` : ''}
    <div class="mar-svc-body">${body}</div>
    <div class="mar-dim mar-svc-foot">${sv.mode === 'fuel' ? 'The pump goes when you pull away from the float.' : 'Dock her and the slings lift her out while you step up into the hall. Open the lever instead and she leaves the slot; stop in it again and the shipwright comes back.'}</div>`;
  syncPreview();
}

function serviceBody(b) {
  const svc = b.svc || { items: [] };
  const rows = svc.items.map((i) => `<div class="mar-svrow ${i.band}">
      <div class="mar-svmain"><b>${esc(i.label)}</b> <span class="mar-dim">· ${esc(i.bandLabel)}</span>
        <span class="mar-bt"><i class="${i.band === 'fresh' ? 'ok' : i.band === 'due' ? 'warn' : 'bad'}" style="width:${pct(i.life)}%"></i></span>
        <div class="mar-dim mar-small">${esc(i.desc)}</div></div>
      <button class="mar-go" data-cmd="refit service ${esc(b.id)} ${esc(i.id)}" ${i.life >= 0.995 ? 'disabled title="Just done"' : ''}>${money(i.price)}</button>
    </div>`).join('');
  return `<div class="mar-card"><div class="mar-card-head"><span class="mar-boat">The hull</span><span class="mar-dim">${esc(b.band)}</span></div>
      ${bar('hull', b.hull)}
      <div class="mar-acts"><button class="mar-go${b.hull < 0.9 ? ' pri' : ''}" data-cmd="refit ${esc(b.id)}" ${b.hull >= 0.999 ? 'disabled title="Sound"' : ''}>Repair the hull</button></div></div>
    <div class="mar-card"><div class="mar-card-head"><span class="mar-boat">Servicing</span></div>${rows}
      <div class="mar-acts"><button class="mar-go${svc.anyDue ? ' pri' : ''}" data-cmd="refit service ${esc(b.id)} all">Everything · ${money(svc.full)}</button></div></div>
    <p class="mar-dim mar-small">Fuel is at the float: lie her alongside the pumps, inside the amber box on the water, and stop.</p>`;
}

// ⚠ A SCHEME IS PREVIEWED ON THE HULL BEFORE IT IS BOUGHT: clicking a swatch shows it out of the chase
// camera, and only the button under it spends anything.
function paintBody(b, d) {
  const cur = sv.pick || b.scheme;
  const sw = (d.schemes || []).map((s) => {
    const base = s.livery?.base || '#6f7a86', trim = s.livery?.trim || '#c9ced6';
    return `<button class="mar-swatch${cur === s.id ? ' on' : ''}${b.scheme === s.id ? ' mine' : ''}" data-scheme="${esc(s.id)}" title="${esc(s.label)}">
      <i style="background:linear-gradient(135deg, ${base} 0 55%, ${trim} 55% 100%)"></i><span>${esc(s.label)}</span></button>`;
  }).join('');
  const decals = (d.decals || []).map((a) => `<button class="mar-go${b.decal === a.id ? ' pri' : ''}" data-cmd="refit decal ${esc(b.id)} ${esc(a.id)}" ${b.decal === a.id ? 'disabled' : ''}>${esc(a.label)}${a.id === 'none' || b.decal === a.id ? '' : ' · ' + money(d.decalPrice)}</button>`).join('');
  const dirty = cur !== b.scheme;
  return `<div class="mar-card"><div class="mar-card-head"><span class="mar-boat">Colours</span><span class="mar-dim">shown on her now, press V</span></div>
      <div class="mar-swatches">${sw}</div>
      <div class="mar-acts"><button class="mar-go pri" data-cmd="refit paint ${esc(b.id)} ${esc(cur)}" ${dirty ? '' : 'disabled title="Nothing changed"'}>Paint her · ${money(cur === 'factory' ? Math.round(d.paintPrice / 2) : d.paintPrice)}</button>
        <button class="mar-go" data-scheme="${esc(b.scheme)}" ${dirty ? '' : 'disabled'}>Put it back</button></div></div>
    <div class="mar-card"><div class="mar-card-head"><span class="mar-boat">On her topsides</span></div><div class="mar-decals">${decals}</div></div>`;
}

function nameBody(b) {
  return `<div class="mar-card"><div class="mar-card-head"><span class="mar-boat">Across her transom</span></div>
    <div class="mar-acts"><input class="mar-namein" type="text" maxlength="24" value="${esc(b.name)}" aria-label="Her name">
      <button class="mar-go pri" data-name="${esc(b.id)}">Paint it on</button></div>
    <p class="mar-dim mar-small">Free. The shipwright has done worse names than whatever you are about to choose.</p></div>`;
}

function fuelBody(b) {
  const f = b.liveFuel ?? b.fuel;
  return `<div class="mar-card"><div class="mar-card-head"><span class="mar-boat">Marine fuel</span><span class="mar-dim">alongside the float</span></div>
    ${bar('tank', f)}
    <div class="mar-acts"><button class="mar-go pri" data-cmd="fuel" ${f >= 0.99 ? 'disabled title="Full"' : ''}>Fill her · ${money(b.fillPrice)}</button></div>
    <p class="mar-dim mar-small">The nozzle stops when the money does.</p></div>`;
}

function bar(label, v) {
  const p = pct(v);
  return `<div class="mar-bar"><span class="mar-bl">${label}</span><span class="mar-bt"><i class="${barTone(v)}" style="width:${p}%"></i></span><span class="mar-bv">${p}%</span></div>`;
}

function onServiceClick(e) {
  if (!sv) return;
  const s = e.target.closest?.('[data-svc]');
  if (s) { sv.open = s.dataset.svc === 'open'; drawService(); return; }
  const t = e.target.closest?.('[data-svtab]');
  if (t) { sv.tab = t.dataset.svtab; drawService(); return; }
  const sc = e.target.closest?.('[data-scheme]');
  if (sc && !sc.disabled) { sv.pick = sc.dataset.scheme; drawService(); return; }
  const n = e.target.closest?.('[data-name]');
  if (n) {
    const v = String(n.parentElement?.querySelector('.mar-namein')?.value || '').trim();
    if (v) send(`refit name ${n.dataset.name} ${v}`);
    return;
  }
  onClick(e);
}

// The paint tab turns the camera round to look at her, and the preview rides on the hull; leaving the
// tab or the slot hands back whichever view the helmsman had.
function syncPreview() {
  if (!sv) return;
  // The dock always shows her from outside: you are looking at the boat you are working on.
  const onDock = sv.open && sv.mode === 'dock';
  const onPaint = onDock && sv.tab === 'paint';
  try {
    if (onDock) { const first = sv.view == null; if (first) sv.view = boatView(); boatView('ext', { quarter: first }); } else restoreView();
    const b = boat();
    const pick = onPaint && sv.pick && b && sv.pick !== b.scheme ? (sv.data.schemes || []).find((x) => x.id === sv.pick) : null;
    boatPreview({ livery: pick ? { ...(pick.livery || {}), ...(b.decal && b.decal !== 'none' ? { decal: b.decal } : {}) } : null });
  } catch { /* a seat without the hooks is a seat without the preview */ }
  if (!onPaint && sv) sv.pick = sv.tab === 'paint' ? sv.pick : null;
}
function restoreView() {
  if (!sv || sv.view == null) return;
  try { boatView(sv.view); } catch { /* gone */ }
  sv.view = null;
}

// ── THE STYLES ───────────────────────────────────────────────────────────────
function ensureMarinaStyles() {
  const el = document.getElementById('marina-styles') || document.createElement('style');
  el.id = 'marina-styles';
  el.textContent = `
    .mar-root{ display:flex; flex-direction:column; height:100%; min-height:320px;
      background:#070a0e; color:#c6d7e6; font:14px/1.5 ui-monospace,monospace; overflow:hidden; }
    .mar-head{ display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid #1b242e; }
    .mar-name{ color:#7fd4ff; font-weight:600; letter-spacing:.05em; }
    .mar-credits{ color:#8fe0a8; }
    .mar-spacer{ flex:1; }
    .mar-chip{ background:rgba(8,12,18,.72); border:1px solid #24303d; color:#9fb6cc;
      font:600 13px/1 ui-monospace,monospace; padding:6px 9px; border-radius:4px; cursor:pointer; }
    .mar-tabs{ display:flex; flex-wrap:wrap; gap:2px; padding:8px 12px 0; border-bottom:1px solid #1b242e; }
    .mar-exits{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 12px; border-bottom:1px solid #1b242e; font-size:11px; }
    .mar-exits .mar-go{ text-transform:capitalize; }
    .mar-tab{ background:none; border:1px solid transparent; border-bottom:none; color:#6f8399;
      font:600 12px/1 ui-monospace,monospace; letter-spacing:.06em; padding:8px 12px; cursor:pointer; }
    .mar-tab.on{ color:#cfe9ff; border-color:#24303d; background:#0c121a; }
    .mar-body{ flex:1; overflow:auto; padding:14px; }
    .mar-card{ border:1px solid #1b242e; border-radius:4px; padding:10px 12px; margin-bottom:10px; background:#0a0f15; }
    .mar-card-head{ display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
    .mar-boat{ color:#7fd4ff; font-weight:600; }
    .mar-dim{ color:#6f8399; }
    .mar-small{ font-size:11.5px; }
    .mar-price{ color:#8fe0a8; }
    .mar-price.over{ color:#c0707a; }
    .mar-blurb{ color:#8aa0b5; margin:6px 0 2px; }
    .mar-wf{ display:block; width:100%; height:168px; margin:8px 0 2px;
      background:radial-gradient(ellipse at 50% 62%, #0d1721 0%, #070a0e 72%);
      border:1px solid #16202b; border-radius:3px; }
    .mar-out{ color:#6f8399; font-size:12px; margin:4px 0 2px; }
    .mar-out b{ color:#8fe0a8; font-weight:600; white-space:nowrap; }
    .mar-where{ color:#6f8399; font-size:12px; margin-top:6px; }
    .mar-bar{ display:flex; align-items:center; gap:8px; margin-top:6px; font-size:12px; }
    .mar-bl{ width:52px; color:#6f8399; }
    .mar-bt{ flex:1; display:block; height:6px; background:#141c25; border-radius:3px; overflow:hidden; }
    .mar-bt i{ display:block; height:100%; background:#4fae74; }
    .mar-bt i.warn{ background:#c8a04a; } .mar-bt i.bad{ background:#b4545e; }
    .mar-bv{ width:52px; text-align:right; color:#9fb6cc; }
    .mar-acts{ display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .mar-go{ background:#121a24; border:1px solid #2a3846; color:#cfe9ff;
      font:600 12px/1 ui-monospace,monospace; padding:7px 11px; border-radius:3px; cursor:pointer; }
    .mar-go:hover:not([disabled]){ border-color:#3f556b; }
    .mar-go[disabled]{ opacity:.4; cursor:default; }
    .mar-go.pri{ border-color:#3f6d8a; background:#16283a; }
    .mar-body .vc-hand{ margin-top:4px; }
    /* ── The seat's overlay: docked right on the glass, above the lever and the wheel. */
    .mar-svc{ position:absolute; z-index:40; right:10px; top:44px; color:#c6d7e6; font:13px/1.45 ui-monospace,monospace; white-space:normal; }
    .mar-svc.open{ bottom:12%; width:min(620px,58%); display:flex; flex-direction:column; gap:6px; padding:8px;
      background:rgba(7,10,14,.88); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
      border:1px solid #2a3846; border-radius:8px; box-shadow:0 12px 30px rgba(0,0,0,.55); }
    .mar-svc.folded{ right:auto; left:10px; }
    .mar-svc-head{ display:flex; align-items:center; gap:8px; }
    .mar-svc .mar-tabs{ padding:0; }
    .mar-svc-body{ flex:1; min-height:0; overflow:auto; }
    .mar-svc-hire{ font-size:11.5px; padding:4px 8px; border:1px solid #2f6b58; border-radius:4px; }
    .mar-svc-foot{ font-size:11px; text-align:center; }
    .mar-svrow{ display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #141c25; }
    .mar-svrow:last-of-type{ border-bottom:0; }
    .mar-svmain{ flex:1; min-width:0; }
    .mar-svrow.over b{ color:#f0a097; }
    .mar-swatches{ display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:6px; margin-top:6px; }
    .mar-swatch{ display:flex; align-items:center; gap:6px; background:#0c121a; border:1px solid #24303d; border-radius:4px;
      color:#c6d7e6; font:12px/1.2 ui-monospace,monospace; padding:5px; cursor:pointer; text-align:left; }
    .mar-swatch i{ width:22px; height:22px; border-radius:3px; flex:none; border:1px solid rgba(255,255,255,.2); }
    .mar-swatch.on{ border-color:#7fd4ff; } .mar-swatch.mine span::after{ content:' ✓'; color:#8fe0a8; }
    .mar-decals{ display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
    .mar-namein{ flex:1; min-width:0; background:#0c121a; border:1px solid #2a3846; color:#cfe9ff; font:13px ui-monospace,monospace; padding:6px 8px; border-radius:3px; }
    @media (max-width:720px){ .mar-svc.open{ left:8px; right:8px; width:auto; bottom:40%; } }
    body.bigscreen .mar-root > .mar-head, body.bigscreen .mar-svc{ display:none !important; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
