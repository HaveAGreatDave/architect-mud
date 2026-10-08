// THE MARINA — a hand of cards at the counter, and the shipwright and the pump at the helm.
//
// The truck depot's shape (truck-depot.js), for boats, and the depot shell's chrome (depot-shell.js)
// so the two read as one device. It opened on a 3-D dock that was a painted second copy of the Dock
// Hall; picking a hull now seats you in her in the REAL covered slot, on the water under the roof
// GLASS draws, so the painted dock is gone.
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

// ⚠ THE DEALER'S SCHEMATIC IS THE SAME ONE THE OTHER TWO LOTS BUY THROUGH — `drawWireframe3D` strokes
// `aircraftFaces`, the face list the windscreen and a stranger's contact draw.
import { drawWireframe3D, themeColor } from './wireframe-plane.js';
import { paintVehicleCard, paintSlotCard, cardStyleFor, cardSeed, ensureCardStyles } from './vehicle-card.js';
import { boatServiceHost, boatPreview, boatView, boatFrame, boatRev } from './boat-view.js';
import { ensureDepotStyles, headHtml, jobsHtml, mountBay, setBayOpen, bayHtml, leaveHtml, bayChipHtml,
  statsHtml, meterHtml, serviceListHtml, btnHtml, armHolds, shellClick, clearViewModes, noteAct, notePush,
  esc, money, clamp01 } from './depot-shell.js';
import { SHOTS } from './camera-tween.js';
import { garageBed } from './garage-ambience.js';
import { TYPES } from './flight-model.js';

const SCREENS = [['lot', 'Your boats', '⚓'], ['dealer', 'For sale', '⊕'], ['rent', 'Hire', '⟲'], ['berths', 'Berths', '⌂']];

// Which screen a server-sent tab lands on. The server's tabs predate the hand: everything that used
// to be the dock, the fleet or the bench is the hand now (the bench itself is in the seat).
const TAB_FOR = { lot: 'lot', fleet: 'lot', dock: 'lot', bench: 'lot', dealer: 'dealer', rent: 'rent', berths: 'berths' };

// The shipwright's tabs, and the shot each one swings the camera to: the hull from the front 3/4,
// the paint down her flank, and her name across the transom.
const JOBS = [['service', 'Service', '⚙'], ['paint', 'Paint', '◐'], ['name', 'Name', '✎']];
const SHOT_FOR = { service: 'quarter', paint: 'side', name: 'rear' };

// ── A HULL'S BARS ────────────────────────────────────────────────────────────
// The dealer shows what she does the way the truck dealer does, and the numbers are the hull's own
// physics (flight-model.js TYPES, the table the helm sails on), placed on a scale wide enough for
// every hull in the shed. Nothing here is a second table of marketing figures.
const HULL_ROWS = [['speed', 'Speed'], ['pull', 'Pull'], ['turn', 'Turn'], ['range', 'Range'], ['bottle', 'Bottle']];
function hullStats(id) {
  const p = TYPES[id];
  if (!p) return null;
  const n = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
  return {
    speed: n(p.topSpeed, 110, 190),
    pull: n(p.thrustMax / (p.mass || 1), 25, 60),
    turn: n(p.turnLock, 20, 46),
    range: n(p.tank / (p.burn ?? 1), 150, 560),
    bottle: n(p.nitroMul, 1.1, 1.45),
  };
}

let st = null;      // the counter
let sv = null;      // the seat's overlay

export function isMarinaActive() { return !!st; }

export function openMarina(msg = {}) {
  if (msg.service) return openMarinaService(msg);
  const host = msg.mount || document.getElementById('area-content');
  if (!host) return;
  ensureDepotStyles();
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
  // ⚠ THE MODE OWNS THE PAGE — leaving fullscreen with nothing to take it down strands the player.
  clearViewModes();
  if (st.host) st.host.innerHTML = '';
  st = null;
}

export function marinaSetData(msg = {}) {
  if (msg.service) return openMarinaService(msg);
  if (!st) return openMarina(msg);
  const before = st.data?.credits;
  st.data = msg;
  if (TAB_FOR[msg.tab]) st.tab = TAB_FOR[msg.tab];
  draw();
  notePush(st.host.querySelector('.ds-counter'), before, msg.credits);
}

const send = (cmd) => { try { (st?.onSend || sv?.onSend)?.(cmd); } catch { /* the pane can outlive the socket */ } };
const pct = (v) => Math.round(clamp01(v ?? 0) * 100);

// ── The counter ──────────────────────────────────────────────────────────────
function draw() {
  if (!st) return;
  const d = st.data || {};
  const screens = SCREENS.filter(([k]) => (k !== 'dealer' && k !== 'rent') || d.dealer);
  st.host.innerHTML = `<div class="ds-root ds-counter mar-root">
    ${headHtml({ ico: '⚓', title: d.name || 'The Marina', credits: d.credits, screens, screen: st.tab })}
    ${(d.exits || []).length ? `<div class="mar-exits"><span class="ds-dim">Leave</span>${d.exits.map((x) =>
      `<button class="ds-btn ghost" type="button" data-leave="${esc(x.dir)}">${esc(x.dir)} · ${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="ds-body">${st.tab === 'dealer' ? dealerBody(d) : st.tab === 'rent' ? rentBody(d) : st.tab === 'berths' ? berthBody(d) : lotBody(d)}</div>
  </div>`;
  const root = st.host.querySelector('.mar-root');
  root.addEventListener('click', onClick);
  armHolds(root, send);
  spinWireframes();
  requestAnimationFrame(paintCards);
  watchSize();
}

function onClick(e) {
  if (shellClick(e, {
    screen: (s) => { if (st) { st.tab = s; draw(); } },
    // ✕ puts it away here and asks for the room; walking back in deals the hand again.
    close: () => { const s = st?.onSend; closeMarina(); try { s?.('look'); } catch { /* socket gone */ } },
  })) return;
  const tab = e.target.closest?.('[data-tab]');
  if (tab && st) { st.tab = tab.dataset.tab; draw(); return; }
  // Leaving: the move closes the screen from the server side (marina_close), and the room paints.
  const leave = e.target.closest?.('[data-leave]');
  if (leave && st) { send(leave.dataset.leave); return; }
  const b = e.target.closest?.('[data-cmd]');
  if (b && !b.disabled && b.dataset.cmd) { noteAct(b); send(b.dataset.cmd); }
}

// ── THE HAND ─────────────────────────────────────────────────────────────────
// One card per hull you have, owned or hired, then Buy and Hire. The card is the button that seats
// you: `boat take`. ⚠ A HULL ON A CRADLE IS A CRANE JOB FIRST: the card then does nothing and the
// key under it is a hold, because the crane is a bill. One that is somewhere else is shown faded,
// not hidden.
function lotBody(d) {
  const fleet = d.fleet || [];
  const cards = fleet.map((b) => {
    const ready = b.inYard && !b.aboard && b.kind !== 'adrift';
    const hard = b.kind === 'hard';
    const badge = b.rental ? `<span class="vc-badge hired">HIRED · ${esc(b.rental.leftText)}</span>` : '<span class="vc-badge owned">OWNED</span>';
    const sub = b.aboard ? 'you are sitting in her'
      : !b.inYard ? esc(b.where || 'somewhere else')
      : hard ? 'on a cradle' : `${esc(b.typeName)} · fuel ${pct(b.fuel)}%`;
    const cmd = `boat take ${b.id}`;
    const acts = [
      ready && hard ? `<button class="vc-mini" data-hold="${esc(cmd)}" title="The crane puts her in the water, then you take the helm">Crane her in · ${money(d.craneFee)}</button>` : '',
      b.rental && b.inYard && !b.aboard ? `<button class="vc-mini" data-hold="boat return ${esc(b.id)}" title="Hand her back early, no refund">Hand her back</button>` : '',
      !b.inYard ? '<button class="vc-mini" data-hold="tow" title="Somebody goes out for her, for a price">Tow her in</button>' : '',
    ].filter(Boolean).join('');
    const live = ready && !hard;
    return `<div class="vc-wrap${ready ? '' : ' away'}">
      <button class="vc-card ${cardStyleFor(b.id)}" ${live ? `data-cmd="${esc(cmd)}"` : ready ? '' : 'disabled'}
          aria-label="${esc(`${b.name}, ${b.rental ? 'hired' : 'owned'}${live ? ': take the helm' : ''}`)}"
          title="${live ? 'Take the helm: she starts in the covered slot' : hard && ready ? 'On a cradle: crane her in first' : esc(b.where || '')}">
        <canvas class="vc-cv" data-card="${esc(b.id)}" aria-hidden="true"></canvas>
        ${badge}
        <span class="vc-plate"><b>${esc(b.name)}</b><span class="vc-sub">${sub}</span>
          <span class="vc-bar" title="hull ${pct(b.hull)}%"><i class="${b.hull < 0.3 ? 'bad' : b.hull < 0.6 ? 'warn' : 'ok'}" style="width:${pct(b.hull)}%"></i></span></span>
      </button>
      ${acts ? `<div class="vc-acts">${acts}</div>` : ''}
    </div>`;
  }).join('');
  const slot = (tab, label, sub) => `<div class="vc-wrap"><button class="vc-card slot" data-tab="${tab}" aria-label="${label}">
      <canvas class="vc-cv" data-slot="${tab}" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>${label}</b><span class="vc-sub">${sub}</span></span></button></div>`;
  return `${fleet.length ? '' : '<p class="ds-hint">Nothing of yours on this water. Buy a hull, or hire one for the afternoon.</p>'}
    <div class="vc-hand">${cards}${d.dealer ? slot('dealer', 'Buy a boat', `${(d.stock || []).length} on the line`) + slot('rent', 'Hire a boat', d.hasRental ? 'one out already' : 'by the afternoon') : ''}</div>`;
}

function rentBody(d) {
  if (!d.dealer) return '<p class="ds-hint">Nobody hires hulls out here.</p>';
  const cards = (d.rentStock || []).map((t) => {
    const why = d.hasRental ? 'You already have one out on hire' : t.afford ? '' : "You can't afford it";
    return `<div class="vc-wrap">
      <div class="vc-card ${cardStyleFor('hire:' + t.id)} static">
        <canvas class="vc-cv" data-rent="${esc(t.id)}" aria-hidden="true"></canvas>
        <span class="vc-badge hired">FOR HIRE</span>
        <span class="vc-plate"><b>${esc(t.name)}</b><span class="vc-sub">${t.hours} hours · tank full</span></span>
      </div>
      <div class="vc-acts">${btnHtml(`Hire · ${money(t.fee)}`, { cmd: `boat rent ${t.id}`, cls: 'primary', disabled: !!why, why })}</div>
    </div>`;
  }).join('');
  return `<p class="ds-hint">A hire comes out of the covered dock fuelled and serviced, and goes back on its own when the time is up and she is tied up. One at a time.</p>
    <div class="vc-hand">${cards}</div>`;
}

// ── THE DEALER ───────────────────────────────────────────────────────────────
// Big schematics and the price on the buy key, the truck dealer's shape. ⚠ `fill` RATHER THAN THE
// STOCK FOCAL: that focal was set for airframes and a hull is authored far smaller, so unfitted she
// renders as a doodle in the middle of an empty box.
function dealerBody(d) {
  if (!d.dealer) return '<p class="ds-hint">Nobody sells hulls here.</p>';
  const afford = Number(d.credits || 0);
  return `<div class="mar-lots">${(d.stock || []).map((t) => `<div class="ds-panel mar-lot">
      <div class="ds-panel-head"><b>${esc(t.name)}</b>
        ${btnHtml(`Buy · ${money(t.price)}`, { cmd: `boat ${t.id}`, cls: 'primary', disabled: t.price > afford, why: t.price > afford ? "You can't afford it" : '' })}</div>
      <canvas class="mar-wf" data-wf-cls="${esc(t.id)}" aria-label="${esc(t.name)}, schematic"></canvas>
      <p class="mar-blurb ds-dim">${esc(t.blurb || '')}</p>
      ${statsHtml(HULL_ROWS, hullStats(t.id))}
      <div class="ds-dim ds-small">Out of the shed: <b>hull sound</b> · <b>tank full</b> · <b>bottle charged</b></div>
    </div>`).join('') || '<p class="ds-hint">The shed is empty.</p>'}</div>`;
}

// ⚠ TAKEN OF CAPACITY, COUNTED SERVER-SIDE — occupancy is counted against the rows, never stored.
function berthBody(d) {
  const rows = d.berths || [];
  if (!rows.length) return '<p class="ds-hint">Nowhere here to keep a hull.</p>';
  return rows.map((b) => `<div class="ds-panel">
      <div class="ds-panel-head"><b>${esc(b.name)}</b><span class="ds-dim">${esc(b.kindWord || '')}</span></div>
      ${meterHtml('taken', b.capacity ? b.taken / b.capacity : 0)}
      <div class="ds-dim ds-small">${b.taken} of ${b.capacity} taken: move a hull in with <b>berth</b> while standing there</div>
    </div>`).join('');
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

let spinRaf = 0;
function stopWireframes() { if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; } }
function spinWireframes() {
  stopWireframes();
  if (!st || st.tab !== 'dealer') return;
  const accent = themeColor('--accent', '#7fd4ff');
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
  ensureDepotStyles();
  ensureMarinaStyles();
  const host = boatServiceHost();
  if (!host) return;
  const was = sv;
  const same = was && was.mode === msg.service;
  sv = {
    data: msg, mode: msg.service, onSend: was?.onSend || msg.onSend || null,
    tab: same ? was.tab : 'service',
    // Open when she arrives; after that, folded or open is the helmsman's.
    open: same ? was.open : true,
    pick: was?.pick || null, view: was?.view ?? null, shot: same ? was.shot : undefined,
  };
  const b = boat();
  if (b?.rental && sv.tab !== 'service') sv.tab = 'service';
  // The slip has a sound; the fuel float is just the harbour, which the helm already plays.
  garageBed(sv.mode === 'dock' ? 'dock' : null);
  // Pulling into the shed: give the motor a blip, the way a garage menu does.
  if (!same && sv.mode === 'dock') setTimeout(() => boatRev(0.35), 450);
  drawService();
  if (same) notePush(document.getElementById('mar-svc'), was.data?.credits, msg.credits);
}
export function setMarinaServiceSend(fn) { if (sv) sv.onSend = fn; }

export function closeMarinaService() {
  if (!sv) return;
  restoreView();
  try { boatPreview({ livery: null }); } catch { /* the seat can already be gone */ }
  document.getElementById('mar-svc')?.remove();
  garageBed(null);
  sv = null;
}

const boat = () => (sv?.data?.fleet || []).find((b) => b.id === sv.data.serviceId) || null;

function drawService() {
  if (!sv) return;
  const host = boatServiceHost();
  if (!host) return;
  const el = mountBay(host, 'mar-svc', { click: onServiceClick });
  setBayOpen(el, sv.open);
  const d = sv.data, b = boat();
  const fuel = sv.mode === 'fuel';
  const where = fuel ? 'the fuel float' : 'the covered dock';
  if (!sv.open) {
    el.innerHTML = bayChipHtml(`${fuel ? '⛽' : '⚓'} ${where}`);
    syncPreview();
    return;
  }
  const jobs = fuel || !b ? '' : jobsHtml(JOBS.filter(([k]) => !b.rental || k === 'service')
    .map(([id, label, ico]) => ({ id, label, ico, ...jobState(id, b) })), sv.tab, 'data-svtab');
  const body = !b ? '<p class="ds-hint">She is not on the books here.</p>'
    : fuel ? fuelBody(b) : sv.tab === 'paint' ? paintBody(b, d) : sv.tab === 'name' ? nameBody(b) : serviceBody(b);
  el.innerHTML = bayHtml({
    ico: fuel ? '⛽' : '⚓', title: b?.name || 'her', sub: where, credits: d.credits,
    actions: (sv.mode === 'dock' && b ? btnHtml('Dock her', { cmd: 'disembark', ico: '⚓', attrs: 'title="The slings take her out of the water and you step up into the Dock Hall (P)"' }) : '')
      + leaveHtml(fuel ? 'Carry on' : 'Cast off'),
    notes: b?.rental ? `<div class="ds-note hire">Hire boat · ${esc(b.rental.leftText)} · step off in the slot to hand her back with <b>boat return</b></div>` : '',
    jobs, body,
    foot: fuel ? 'The pump goes when you pull away from the float.'
      : 'Dock her and the slings lift her out while you step up into the hall. Open the lever instead and she leaves the slot; stop in it again and the shipwright comes back.',
  });
  armHolds(el, send);
  syncPreview();
}

// What is waiting behind each tile, off the facts the tab draws.
function jobState(id, b) {
  if (id === 'service') {
    const items = b.svc?.items || [];
    const over = items.filter((i) => i.band === 'over').length, due = items.filter((i) => i.band === 'due').length;
    if (over) return { sub: `${over} overdue`, tone: 'bad' };
    if (due) return { sub: `${due} due`, tone: 'warn' };
    if ((b.hull ?? 1) < 0.9) return { sub: `hull ${pct(b.hull)}%`, tone: 'warn' };
    return { sub: 'all good', tone: 'ok' };
  }
  if (id === 'paint') return sv.pick && sv.pick !== b.scheme ? { sub: 'unsaved', tone: 'hot' } : { sub: (sv.data.schemes || []).find((s) => s.id === b.scheme)?.label || '' };
  if (id === 'name') return { sub: b.name };
  return {};
}

function serviceBody(b) {
  const svc = b.svc || { items: [] };
  return `<div class="ds-panel"><div class="ds-panel-head"><b>The hull</b><span class="ds-dim">${esc(b.band)}</span></div>
      ${meterHtml('hull', b.hull)}
      <div class="ds-acts">${btnHtml('Repair the hull', { cmd: `refit ${b.id}`, cls: b.hull < 0.9 ? 'primary' : '', disabled: b.hull >= 0.999, why: b.hull >= 0.999 ? 'Sound' : '' })}</div></div>
    <div class="ds-panel"><div class="ds-panel-head"><b>Servicing</b></div>
      ${serviceListHtml(svc.items, (i) => `refit service ${b.id} ${i.id}`)}
      <div class="ds-acts">${btnHtml(`Everything · ${money(svc.full)}`, { cmd: `refit service ${b.id} all`, cls: svc.anyDue ? 'primary' : '' })}</div></div>
    <p class="ds-dim ds-small">Fuel is at the float: lie her alongside the pumps, inside the amber box on the water, and stop.</p>`;
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
  const decals = (d.decals || []).map((a) => btnHtml(`${a.label}${a.id === 'none' || b.decal === a.id ? '' : ' · ' + money(d.decalPrice)}`,
    { cmd: `refit decal ${b.id} ${a.id}`, cls: b.decal === a.id ? 'primary' : '', disabled: b.decal === a.id })).join('');
  const dirty = cur !== b.scheme;
  return `<div class="ds-panel"><div class="ds-panel-head"><b>Colours</b><span class="ds-dim">shown on her now</span></div>
      <div class="mar-swatches">${sw}</div>
      <div class="ds-acts">${btnHtml(`Paint her · ${money(cur === 'factory' ? Math.round(d.paintPrice / 2) : d.paintPrice)}`, { cmd: `refit paint ${b.id} ${cur}`, cls: 'primary', disabled: !dirty, why: dirty ? '' : 'Nothing changed' })}
        <button class="ds-btn ghost" data-scheme="${esc(b.scheme)}" ${dirty ? '' : 'disabled'}>Put it back</button></div></div>
    <div class="ds-panel"><div class="ds-panel-head"><b>On her topsides</b></div><div class="ds-acts">${decals}</div></div>`;
}

function nameBody(b) {
  return `<div class="ds-panel"><div class="ds-panel-head"><b>Across her transom</b></div>
    <div class="ds-acts"><input class="mar-namein" type="text" maxlength="24" value="${esc(b.name)}" aria-label="Her name">
      <button class="ds-btn primary" data-name="${esc(b.id)}">Paint it on</button></div>
    <p class="ds-dim ds-small">Free. The shipwright has done worse names than whatever you are about to choose.</p></div>`;
}

function fuelBody(b) {
  const f = b.liveFuel ?? b.fuel;
  return `<div class="ds-panel"><div class="ds-panel-head"><b>Marine fuel</b><span class="ds-dim">alongside the float</span></div>
    ${meterHtml('tank', f)}
    <div class="ds-acts">${btnHtml(`Fill her · ${money(b.fillPrice)}`, { cmd: 'fuel', cls: 'primary', disabled: f >= 0.99, why: f >= 0.99 ? 'Full' : '' })}</div>
    <p class="ds-dim ds-small">The nozzle stops when the money does.</p></div>`;
}

function onServiceClick(e) {
  if (!sv) return;
  if (shellClick(e, {
    fold: () => { sv.open = false; drawService(); },
    open: () => { sv.open = true; drawService(); },
  })) return;
  const t = e.target.closest?.('[data-svtab]');
  if (t) { sv.tab = t.dataset.svtab; drawService(); return; }
  const sc = e.target.closest?.('[data-scheme]');
  if (sc && !sc.disabled) { sv.pick = sc.dataset.scheme; drawService(); return; }
  const n = e.target.closest?.('[data-name]');
  if (n) {
    const v = String(n.parentElement?.querySelector('.mar-namein')?.value || '').trim();
    if (v) { noteAct(n); send(`refit name ${n.dataset.name} ${v}`); }
    return;
  }
  const b = e.target.closest?.('[data-cmd]');
  if (b && !b.disabled && b.dataset.cmd) { noteAct(b); send(b.dataset.cmd); }
}

// The dock always shows her from outside, and the camera swings to what the tab works on; the
// preview rides on the hull; leaving the tab or the slot hands back whichever view the helmsman had.
function syncPreview() {
  if (!sv) return;
  const onDock = sv.open && sv.mode === 'dock';
  const onPaint = onDock && sv.tab === 'paint';
  try {
    if (onDock) {
      const first = sv.view == null;
      if (first) sv.view = boatView();
      boatView('ext', { quarter: first });
      // Only on a change of tab, so a re-push after a purchase leaves the camera where it was put.
      const shot = SHOT_FOR[sv.tab] || 'quarter';
      if (shot !== sv.shot) { boatFrame(SHOTS[shot], first ? 900 : 700); sv.shot = shot; }
    } else { restoreView(); sv.shot = undefined; }
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
// The chrome is the depot shell's; what is here is the marina's own furniture.
function ensureMarinaStyles() {
  const el = document.getElementById('marina-styles') || document.createElement('style');
  el.id = 'marina-styles';
  el.textContent = `
    .mar-exits{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 12px; flex:0 0 auto; font-size:11px;
      border-bottom:1px solid color-mix(in srgb, var(--ds-accent) 20%, transparent); }
    .mar-exits .ds-btn{ text-transform:capitalize; padding:4px 8px; font-size:11px; }
    .mar-lots{ display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
    .mar-lot{ margin:0; }
    .mar-blurb{ margin:2px 0; font-size:12.5px; }
    .mar-wf{ display:block; width:100%; height:168px; border-radius:7px;
      background:radial-gradient(ellipse at 50% 62%, #0d1721 0%, #070a0e 72%);
      border:1px solid color-mix(in srgb, var(--ds-accent) 22%, transparent); box-shadow:inset 0 2px 10px rgba(0,0,0,.45); }
    .mar-swatches{ display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:6px; }
    .mar-swatch{ display:flex; align-items:center; gap:6px; font-size:12px; line-height:1.2; font-family:inherit; padding:5px; cursor:pointer; text-align:left;
      color:var(--ds-fg); background:var(--ds-surf-lo); border:1px solid color-mix(in srgb, var(--ds-accent) 22%, transparent); border-radius:6px; }
    .mar-swatch i{ width:22px; height:22px; border-radius:4px; flex:none; border:1px solid rgba(255,255,255,.2); }
    .mar-swatch.on{ border-color:var(--ds-accent); box-shadow:0 0 10px color-mix(in srgb, var(--ds-accent) 30%, transparent); }
    .mar-swatch.mine span::after{ content:' ✓'; color:var(--ds-gain); }
    .mar-namein{ flex:1; min-width:0; font-size:13px; font-family:inherit; padding:6px 8px; border-radius:6px; color:var(--ds-fg);
      background:var(--ds-surf-lo); border:1px solid color-mix(in srgb, var(--ds-accent) 30%, transparent); }`;
  if (!el.parentNode) document.head.appendChild(el);
}
