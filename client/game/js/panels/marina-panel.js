// THE MARINA, AS A SCREEN.
//
// The `prefersLoggedPanels` half of the boat. The hangar bay and the truck depot are the shape this
// follows: one panel that AUTO-OPENS when you walk into the yard and closes when you leave, with
// the fleet, the dealer, the berths and the refit bench on tabs.
//
// ── ⚠ IT IS A SKIN OVER THE IDENTICAL TEXT, AND THAT IS THE WHOLE CONTRACT ───
//
// Every button here sends a verb string a player could have typed — `boat continental`, `berth 2
// covered`, `refit 1` — and every number it shows is a number the text rung prints. That is the
// `prefersLoggedPanels` rule from docs/systems-display-mode.md: delete this file and nobody is
// STUCK, they are reading instead of clicking, which is the difference between this axis and the
// helm's. A panel that grew a decision of its own would break that in the one way nobody notices
// until a player on the bottom rung cannot do something everybody else can.
//
// ⚠ AND IT RE-PUSHES AFTER EVERY MUTATION. This is the truck depot's oldest complaint quoted: you
// buy a hull, the server charges you, writes the row and answers with a line of prose — and the
// panel sitting over the top of it still shows the same dealer card, the same Buy button and a
// stale balance, so a purchase that WORKED looks exactly like one that did not. Nothing here may
// end in a bare send if it changed the world; the server re-pushes and this redraws.

import { bindBigScreenButton, exitBigScreen, BIGSCREEN_GLYPH, BIGSCREEN_TITLE } from './bigscreen.js';
// The same scene the hangar bay and the truck depot draw, handed a third venue. ⚠ NOT A SECOND
// PREVIEW RENDERER — the boat on the dock is `aircraftFaces('hydro')`, which is the hull the flight
// sim puts in your windscreen, so there is nothing here that can disagree with the water about what
// she looks like.
import { drawHangarScene, pickSceneHit } from './aircraft3d.js';
// ⚠ AND THE DEALER'S SCHEMATIC IS THE SAME ONE THE OTHER TWO LOTS BUY THROUGH. `drawWireframe3D`
// strokes the edges of `aircraftFaces` — the identical face list the dock tab, the windscreen and
// a stranger's contact draw — so this is a second PRESENTATION of one mesh and not a second
// renderer. The aircraft lot (hangar-bay.js) and the rig lot (truck-depot.js) are its two existing
// callers, and a third that drew its own hull would be the thing this file's header forbids.
import { drawWireframe3D, themeColor } from './wireframe-plane.js';

// ⚠ THE DOCK TAB ONLY EXISTS IN A ROOM WITH WATER IN IT. The server says which room this is
// (`dock`), because whether you are standing on a berth is its question and not the client's — the
// same rule every button here follows.
const TABS = [
  ['dock', 'THE DOCK'],
  ['fleet', 'YOUR BOATS'],
  ['dealer', 'HULLS'],
  ['berths', 'BERTHS'],
  ['bench', 'REFIT'],
];
const tabsFor = (d) => TABS.filter(([k]) => k !== 'dock' || d?.dock);

let st = null;

export function isMarinaActive() { return !!st; }

export function openMarina(msg = {}) {
  const host = msg.mount || document.getElementById('area-content');
  if (!host) return;
  ensureMarinaStyles();
  const avail = tabsFor(msg);
  const want = st?.tab && avail.some(([k]) => k === st.tab) ? st.tab : (msg.tab || 'fleet');
  st = {
    host,
    data: msg,
    tab: avail.some(([k]) => k === want) ? want : avail[0][0],
    // Which hull the dock screen is looking at. The id the server sent, never an index into a list
    // that the next push may reorder.
    selId: msg.fleet?.find((b) => b.aboard)?.id || msg.fleet?.find((b) => b.hereNow)?.id || null,
    onSend: msg.onSend || null,
    onExit: msg.onExit || null,
  };
  draw();
  watchDock();
}

export function closeMarina() {
  if (!st) return;
  if (ro) { ro.disconnect(); ro = null; }
  // ⚠ AND THE SCHEMATICS STOP TURNING. The loop re-queries its canvases and retires itself when
  // they are gone, which covers a redraw — but `closeMarina` empties the host in the same tick, so
  // without this there is one more frame scheduled against a detached node. Cheap, and it is the
  // difference between a loop that ends and a loop that happens to run out of work.
  stopWireframes();
  hits = [];
  // ⚠ THE MODE OWNS THE PAGE. Same rule the seats follow: leaving in big screen with nothing to
  // take it down strands the player with no sidebar, no log and no command box.
  exitBigScreen();
  if (st.host) st.host.innerHTML = '';
  st = null;
}

/** The server re-pushes after anything that changed the world; this is where it lands. */
export function marinaSetData(msg = {}) {
  if (!st) return openMarina(msg);
  st.data = msg;
  const avail = tabsFor(msg);
  if (msg.tab && avail.some(([k]) => k === msg.tab)) st.tab = msg.tab;
  if (!avail.some(([k]) => k === st.tab)) st.tab = avail[0][0];
  // ⚠ KEEP THE SELECTION IF THE HULL IS STILL THERE. A re-push follows every purchase, refit and
  // berth move, and re-picking from scratch each time throws the player back to the first boat in
  // the middle of working on the second one.
  if (!msg.fleet?.some((b) => b.id === st.selId)) {
    st.selId = msg.fleet?.find((b) => b.aboard)?.id || msg.fleet?.find((b) => b.hereNow)?.id || msg.fleet?.[0]?.id || null;
  }
  draw();
  watchDock();
}

const send = (cmd) => { try { st?.onSend?.(cmd); } catch { /* the pane can outlive the socket */ } };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v ?? 0))) * 100);

function draw() {
  if (!st) return;
  const d = st.data || {};
  const tabs = tabsFor(d).map(([k, label]) =>
    `<button class="mar-tab${k === st.tab ? ' on' : ''}" data-tab="${k}" type="button">${label}</button>`).join('');

  st.host.innerHTML = '<div class="mar-root">'
    + '<div class="mar-head">'
    + `<span class="mar-name">${esc(d.name || 'The Marina')}</span>`
    + `<span class="mar-credits">₵${Number(d.credits || 0).toLocaleString()}</span>`
    + `<span class="mar-spacer"></span>`
    + `<button class="mar-chip mar-big" type="button" title="${BIGSCREEN_TITLE}">${BIGSCREEN_GLYPH}</button>`
    + '</div>'
    + `<div class="mar-tabs">${tabs}</div>`
    + `<div class="mar-body">${bodyFor(st.tab, d)}</div>`
    + '</div>';

  const root = st.host.querySelector('.mar-root');
  bindBigScreenButton(root.querySelector('.mar-big'));
  root.addEventListener('click', (e) => {
    const tab = e.target.closest?.('[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; draw(); watchDock(); return; }
    // ⚠ EVERY BUTTON CARRIES A VERB STRING, never an opaque id — see the header. It is also what
    // makes this testable: a gate can sweep every `data-cmd` in the panel against the live verb
    // registry and prove the screen cannot offer something you could not type.
    const pick = e.target.closest?.('[data-sel]');
    if (pick) { st.selId = pick.dataset.sel; draw(); watchDock(); return; }
    const btn = e.target.closest?.('[data-cmd]');
    if (btn) send(btn.dataset.cmd);
  });
  // Clicking a hull in the water selects her — hit-tested against the silhouettes the scene
  // returns, because there is no DOM element per boat to hang a listener on.
  const scene = root.querySelector('#mar-scene');
  if (scene) {
    scene.addEventListener('click', (e) => {
      if (!hits.length) return;
      const r = scene.getBoundingClientRect();
      const best = pickSceneHit(hits, e.clientX - r.left, e.clientY - r.top);
      if (best && best.id !== st.selId) { st.selId = best.id; draw(); watchDock(); }
    });
  }
}

function bodyFor(tab, d) {
  if (tab === 'dock') return dockBody(d);
  if (tab === 'fleet') return fleetBody(d);
  if (tab === 'dealer') return dealerBody(d);
  if (tab === 'berths') return berthBody(d);
  return benchBody(d);
}

// ── THE DOCK ─────────────────────────────────────────────────────────────────
//
// What you get for walking into the room the hulls are kept in: the room, with them in it. The
// truck depot's floor screen is the shape, and the two differ in one way that matters — a yard
// SELECTS a rig because a rig is parked among five others and you have to say which; here the
// selection is mostly a formality, because a berth holds two hulls, so the strip under the canvas
// is short and the pane beside it is the point.
//
// ⚠ EVERY BUTTON ON IT IS STILL A VERB STRING. See the header. The gating is the SERVER'S facts
// (`hereNow`, `aboard`) rather than this file's opinion, and a button that cannot fire is present
// and says why rather than absent — that is the truck depot's own rule, and it is the whole fix for
// "the buttons don't let me get in my boat": Board refused away from the berth by design and looked
// broken because nothing on the screen had said so.
function dockBody(d) {
  const fleet = d.fleet || [];
  const here = fleet.filter((b) => b.hereNow);
  const sel = fleet.find((b) => b.id === st.selId) || here[0] || null;
  return `
    <div class="mar-dock">
      <canvas id="mar-scene" class="mar-scene" aria-label="${esc(d.hereName || 'The dock')}"></canvas>
      ${here.length ? '' : `<div class="mar-hint">Nothing of yours is tied up here. The water moves
        under the deck and the slot is empty the whole way to the Basin.</div>`}
      <div class="mar-strip">${fleet.map((b) => `
        <button class="mar-chip${b.id === st.selId ? ' on' : ''}${b.hereNow ? '' : ' away'}" data-sel="${esc(b.id)}">
          <span class="mar-chip-name">${esc(b.name)}</span>
          <span class="mar-chip-sub">${b.hereNow ? esc(b.typeName) : 'at ' + esc(b.whereShort || 'another berth')}</span>
          <span class="mar-chip-bar"><i class="${b.hull < 0.3 ? 'bad' : b.hull < 0.6 ? 'warn' : 'ok'}" style="width:${pct(b.hull)}%"></i></span>
        </button>`).join('')}</div>
    </div>
    <aside class="mar-side">
      ${sel ? boatPane(sel) : '<div class="mar-dim">Nothing of yours is on this water.</div>'}
      <div class="mar-acts">${sel ? dockActs(sel) : ''}</div>
    </aside>`;
}

function boatPane(b) {
  return `<div class="mar-card">
    <div class="mar-card-head"><span class="mar-boat">${esc(b.name)}</span>
      <span class="mar-dim">${esc(b.typeName || '')}</span></div>
    ${bar('hull', b.hull, b.band)}
    ${bar('fuel', b.fuel)}
    ${b.nitro != null ? bar('bottle', b.nitro) : ''}
    <div class="mar-where">${esc(b.aboard ? 'You are sitting in her.' : b.where || '')}</div>
  </div>`;
}

// The two things you came down here to do, and the reason when you cannot do one of them.
function dockActs(b) {
  const board = b.aboard
    ? '<button class="mar-go" type="button" data-cmd="disembark">Climb out</button>'
    : b.hereNow
      ? '<button class="mar-go pri" type="button" data-cmd="embark">Board her</button>'
      : `<button class="mar-go" type="button" disabled title="She is at ${esc(b.whereShort || 'another berth')}">Board her</button>`;
  const helm = b.aboard
    ? '<button class="mar-go pri" type="button" data-cmd="helm">Take the helm</button>'
    : '<button class="mar-go" type="button" disabled title="Get aboard her first">Take the helm</button>';
  return board + helm;
}

// ── YOUR BOATS ───────────────────────────────────────────────────────────────
function fleetBody(d) {
  const rows = d.fleet || [];
  if (!rows.length) {
    return '<p class="mar-dim">You do not own a boat. The dealer tab is what to do about that.</p>';
  }
  return rows.map((b, i) => `<div class="mar-card">`
    + `<div class="mar-card-head"><span class="mar-boat">${esc(b.name)}</span>`
    + `<span class="mar-dim">${esc(b.typeName || '')}</span></div>`
    + bar('hull', b.hull, b.band)
    + bar('fuel', b.fuel)
    + (b.nitro != null ? bar('bottle', b.nitro) : '')
    + `<div class="mar-where">${esc(b.where || '')}</div>`
    + '<div class="mar-acts">'
    // ⚠ THE INDEX IS THE ONE THE TEXT RUNG PRINTS, so a player who reads `boats` and a player who
    // clicks here are naming the same hull. A panel-local id would be a second numbering.
    //
    // ⚠ AND BOARD AND HELM ARE GATED ON THE SERVER'S ANSWER, never offered flat. Both were
    // unconditional, so a card for a hull under cover two rooms away offered a Board button that
    // `embark` correctly refuses — which is the whole of "the buttons don't let me get in my boat".
    + dockActs(b)
    + `<button class="mar-go" type="button" data-cmd="refit ${i + 1}">Refit</button>`
    + '</div></div>').join('');
}

function bar(label, v, note) {
  const p = pct(v);
  const tone = p < 30 ? 'bad' : p < 60 ? 'warn' : 'ok';
  return `<div class="mar-bar"><span class="mar-bl">${label}</span>`
    + `<span class="mar-bt"><i class="${tone}" style="width:${p}%"></i></span>`
    + `<span class="mar-bv">${p}%${note ? ' ' + esc(note) : ''}</span></div>`;
}

// ── THE DEALER ───────────────────────────────────────────────────────────────
//
// ⚠ A SCHEMATIC OF THE ACTUAL MESH YOU WILL OWN, and it is `drawWireframe3D` — the SAME function
// the aircraft lot and the truck lot already buy through — rather than anything written here. That
// is the dock tab's own rule one tab across: the hull on the water is `aircraftFaces('hydro')`, so
// there is nothing on this screen that can disagree with the Basin about what she looks like. A
// picture drawn beside a price is the only part of "look at what you could own" the text rung
// genuinely cannot carry, which is why this is the one thing here that is not a line of prose.
//
// ⚠ AND IT IS `fill` RATHER THAN THE STOCK FOCAL. That focal was set for airframes, which measure
// about ±1.05 across the wing; a hull is authored far smaller, so unfitted she renders as a doodle
// in the middle of an empty box — the truck lot's own bug, recorded at its call site in
// truck-depot.js and inherited here for free by asking for the same thing.
//
// ⚠ NO `fitRef`, AND THAT IS A DECISION WITH A DATE ON IT. `fitRef` is what keeps a LINE of
// vehicles a line — fit each mesh to its own frame and the cheapest rig on the lot draws exactly as
// big as the flagship, so the tier ladder vanishes. There is one hull in the game, so there is no
// ladder to flatten and a shared reference would only be a second cache entry for the same mesh.
// ⚠ It cannot simply be switched on when a second hull ships, either: `fitRef` is spent as a
// VARIANT, and `aircraftFaces` dispatches a boat on its CLASS (`boatShape(cls) ? buildBoat(cls)`),
// so a boat family needs a reference CLASS and `wireframe-plane.js` has nowhere to put one yet.
function dealerBody(d) {
  if (!d.dealer) return '<p class="mar-dim">Nobody sells hulls here.</p>';
  const afford = Number(d.credits || 0);
  return (d.stock || []).map((t) => `<div class="mar-card">`
    + `<div class="mar-card-head"><span class="mar-boat">${esc(t.name)}</span>`
    + `<span class="mar-price${t.price > afford ? ' over' : ''}">₵${Number(t.price).toLocaleString()}</span></div>`
    + `<canvas class="mar-wf" data-wf-cls="${esc(t.id)}" aria-label="${esc(t.name)}, schematic"></canvas>`
    + `<p class="mar-blurb">${esc(t.blurb || '')}</p>`
    // ⚠ WHAT SHE LEAVES THE SHED WITH, SAID AT THE POINT OF DECISION. She has always been sold
    // brimmed — the insert writes `fuel, condition` as `1, 1` and the reply says so — and until
    // fuel could be spent that was a detail nobody could act on. Now that a tank is a real running
    // cost, "the price includes a full one" is part of the price, and saying it only in the
    // confirmation is saying it to somebody who has already decided.
    + '<div class="mar-out">Out of the shed: <b>hull sound</b> · <b>tank full</b> · <b>bottle charged</b></div>'
    + '<div class="mar-acts">'
    // ⚠ DISABLED RATHER THAN HIDDEN when you cannot afford her. A button that is not there is a
    // boat you do not know exists; one you cannot press is a boat to come back for.
    + `<button class="mar-go" type="button" data-cmd="boat ${esc(t.id)}"${t.price > afford ? ' disabled' : ''}>Buy</button>`
    + '</div></div>').join('') || '<p class="mar-dim">The shed is empty.</p>';
}

// ── THE BERTHS ───────────────────────────────────────────────────────────────
function berthBody(d) {
  const rows = d.berths || [];
  if (!rows.length) return '<p class="mar-dim">Nowhere here to keep a hull.</p>';
  return rows.map((b) => `<div class="mar-card">`
    + `<div class="mar-card-head"><span class="mar-boat">${esc(b.name)}</span>`
    + `<span class="mar-dim">${esc(b.kindWord || '')}</span></div>`
    // ⚠ TAKEN OF CAPACITY, COUNTED SERVER-SIDE. The yard's own note: occupancy is counted against
    // the rows and never stored, so a crash cannot leave a berth believing it is full.
    + `<div class="mar-where">${b.taken} of ${b.capacity} taken</div>`
    + '</div>').join('');
}

// ── THE BENCH ────────────────────────────────────────────────────────────────
function benchBody(d) {
  const cap = d.refitCap;
  return '<p class="mar-blurb">A refit is capped by WHERE it happens — a patch on the water, a '
    + 'cradle outside, a shed with a shipwright in it. That is the whole reason to pay for a roof.</p>'
    + (cap != null ? `<p class="mar-dim">Here, she can be brought back to <b>${pct(cap)}%</b>.</p>` : '')
    + ((d.fleet || []).map((b, i) =>
      `<div class="mar-card"><div class="mar-card-head"><span class="mar-boat">${esc(b.name)}</span>`
      + `<span class="mar-dim">hull ${pct(b.hull)}%</span></div>`
      + '<div class="mar-acts">'
      + `<button class="mar-go" type="button" data-cmd="refit ${i + 1}">Refit her</button>`
      + '</div></div>').join('') || '<p class="mar-dim">Nothing of yours to work on.</p>');
}

// ── PAINTING THE DOCK ────────────────────────────────────────────────────────
//
// ⚠ IT IS A STILL, AND DELIBERATELY. The depot runs a rAF because its floor spins a turntable and
// its walkaround takes key input; `drawHangarScene` does neither — it has no yaw parameter at all,
// every machine on it faces the same way, and a frame drawn twice is the same frame. So this paints
// once per redraw and again when the pane changes size, and burns nothing sitting there. A loop
// here would be a timer running for the life of the panel to produce an identical picture.
let hits = [];
let ro = null;

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

/** Paint the slot. Called after every redraw, and by the observer when the pane resizes. */
function paintDock() {
  hits = [];
  if (!st) return;
  const cv = st.host?.querySelector('#mar-scene');
  if (!cv) return;
  // ⚠ THE CANVAS IS SIZED FROM ITS BOX, so this cannot run in the same tick as the innerHTML that
  // created it — a flex child that has not been laid out yet measures zero and paints nothing.
  const ctx = sizeCanvas(cv);
  if (!ctx) return;
  // ⚠ NO LABELS IN THE WATER, and the depot's reasoning applies here twice over: the strip under
  // the canvas names every hull and the pane beside it names the selected one. A caption floating
  // across a boat's transom would be a third answer to a question nobody asked.
  hits = drawHangarScene(ctx, {
    w: cv._cw, h: cv._ch, venue: 'dock', sky: st.data?.sky, selId: st.selId,
    entries: (st.data?.fleet || []).filter((b) => b.hereNow).map((b) => ({
      id: b.id, cls: b.typeId || 'hydro', livery: b.livery || null,
    })),
  }) || [];
}

function watchDock() {
  spinWireframes();
  const cv = st?.host?.querySelector('#mar-scene');
  if (ro) { ro.disconnect(); ro = null; }
  if (!cv) return;
  requestAnimationFrame(paintDock);
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => paintDock());
    ro.observe(cv);
  }
}

// ── THE SCHEMATICS, TURNING ──────────────────────────────────────────────────
//
// ⚠ THE ONE LOOP IN THIS FILE, AND IT IS THE OPPOSITE CASE FROM THE DOCK. Two tabs over,
// `paintDock` paints once per redraw and explicitly refuses a loop, because the slot is a still
// life: nothing in it moves, so a frame drawn twice is the same frame and a timer would burn for
// the life of the panel to produce an identical picture. A schematic is the other thing — it turns,
// and that is most of what makes a wireframe read as a solid you are being shown rather than as a
// drawing of one.
//
// ⚠ SO IT IS STARTED AND STOPPED BY WHICH TAB IS UP, never merely by the panel being open. Left
// running behind the fleet list it is a rAF loop with nothing to draw, for ever, on a screen a
// player leaves open while they do other things. `watchDock` is the one hook every redraw already
// goes through — open, re-push and tab click — so it is where the decision belongs.
let spinRaf = 0;
function stopWireframes() { if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; } }

function spinWireframes() {
  stopWireframes();
  if (!st || st.tab !== 'dealer') return;
  const accent = themeColor('--cyan', '#7fd4ff');
  const loop = () => {
    const cards = st?.host?.querySelectorAll?.('.mar-wf');
    // ⚠ SELF-HEALING RATHER THAN TRUSTED. `draw()` replaces the whole body on every re-push, so the
    // canvases this closure started with are detached the moment anybody buys anything — and a
    // redraw that switched tab has none at all. Re-queried each frame and stopped when the answer
    // is empty, so the loop can never outlive what it is painting.
    if (!cards || !cards.length) { spinRaf = 0; return; }
    const yaw = performance.now() / 2600;
    for (const cv of cards) {
      const ctx = sizeCanvas(cv);
      if (!ctx) continue;
      drawWireframe3D(ctx, {
        cls: cv.dataset.wfCls || 'hydro', w: cv._cw, h: cv._ch, accent,
        // Each card turns from its own offset, so a line of them reads as several boats rather
        // than as one boat drawn several times. The truck lot's `_phase`, derived off the id
        // instead of stored, because the element is thrown away and rebuilt on every re-push.
        yaw: yaw + phaseOf(cv.dataset.wfCls || ''),
        fill: 0.94,
      });
    }
    spinRaf = requestAnimationFrame(loop);
  };
  spinRaf = requestAnimationFrame(loop);
}

/** A stable turn offset per hull, so two cards are never in step. */
function phaseOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 628) / 100;
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
    .mar-tabs{ display:flex; gap:2px; padding:8px 12px 0; border-bottom:1px solid #1b242e; }
    .mar-tab{ background:none; border:1px solid transparent; border-bottom:none; color:#6f8399;
      font:600 12px/1 ui-monospace,monospace; letter-spacing:.06em; padding:8px 12px; cursor:pointer; }
    .mar-tab.on{ color:#cfe9ff; border-color:#24303d; background:#0c121a; }
    .mar-body{ flex:1; overflow:auto; padding:14px; }
    .mar-card{ border:1px solid #1b242e; border-radius:4px; padding:10px 12px; margin-bottom:10px; background:#0a0f15; }
    .mar-card-head{ display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
    .mar-boat{ color:#7fd4ff; font-weight:600; }
    .mar-dim{ color:#6f8399; }
    .mar-price{ color:#8fe0a8; }
    .mar-price.over{ color:#c0707a; }
    .mar-blurb{ color:#8aa0b5; margin:6px 0 2px; }
    /* ⚠ THE VIEWPORT IS A HEIGHT, NOT AN ASPECT, and the truck lot's note says why: the canvas is
       displayed at the card's width, so its buffer aspect IS its height on screen and a shorter
       box is a smaller boat. A hull projects long and low at this camera, so unlike a rig it does
       want the letterbox — but the height is still the whole budget, and 168 is where the schematic
       stops being a thumbnail without pushing the Buy button off a partly-scrolled card. */
    .mar-wf{ display:block; width:100%; height:168px; margin:8px 0 2px;
      background:radial-gradient(ellipse at 50% 62%, #0d1721 0%, #070a0e 72%);
      border:1px solid #16202b; border-radius:3px; }
    .mar-out{ color:#6f8399; font-size:12px; letter-spacing:.02em; margin:4px 0 2px; }
    /* ⚠ A PHRASE WRAPS WHOLE OR NOT AT ALL. Measured in a 368px card, "bottle charged" broke
       across the line — and a two-word state read as one word and a stray verb, which is worse
       than the line being a row longer. The row still wraps BETWEEN phrases, which is the break
       that means something. */
    .mar-out b{ color:#8fe0a8; font-weight:600; white-space:nowrap; }
    .mar-where{ color:#6f8399; font-size:12px; margin-top:6px; }
    .mar-bar{ display:flex; align-items:center; gap:8px; margin-top:6px; font-size:12px; }
    .mar-bl{ width:52px; color:#6f8399; }
    .mar-bt{ flex:1; height:6px; background:#141c25; border-radius:3px; overflow:hidden; }
    .mar-bt i{ display:block; height:100%; }
    .mar-bt i.ok{ background:#4fae74; } .mar-bt i.warn{ background:#c8a04a; } .mar-bt i.bad{ background:#b4545e; }
    .mar-bv{ width:92px; text-align:right; color:#9fb6cc; }
    .mar-acts{ display:flex; gap:6px; margin-top:8px; }
    .mar-go{ background:#121a24; border:1px solid #2a3846; color:#cfe9ff;
      font:600 12px/1 ui-monospace,monospace; padding:7px 11px; border-radius:3px; cursor:pointer; }
    .mar-go:hover:not([disabled]){ border-color:#3f556b; }
    .mar-go[disabled]{ opacity:.4; cursor:default; }
    .mar-body:has(.mar-dock){ display:flex; gap:12px; padding:12px; }
    .mar-dock{ flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }
    .mar-scene{ flex:1; min-height:200px; width:100%; display:block; border-radius:6px;
      border:1px solid #1b242e; cursor:pointer; touch-action:none; }
    .mar-hint{ color:#6f8399; font-size:12px; }
    .mar-strip{ display:flex; gap:6px; flex-wrap:wrap; }
    .mar-chip{ background:#0a0f15; border:1px solid #1b242e; border-radius:4px; padding:6px 9px;
      color:#c6d7e6; font:12px/1.35 ui-monospace,monospace; cursor:pointer; text-align:left; }
    .mar-chip.on{ border-color:#3f556b; background:#101a24; }
    .mar-chip.away{ opacity:.55; }
    .mar-chip-name{ display:block; color:#7fd4ff; font-weight:600; }
    .mar-chip-sub{ display:block; color:#6f8399; }
    .mar-chip-bar{ display:block; height:4px; margin-top:4px; background:#141c25; border-radius:2px; overflow:hidden; }
    .mar-chip-bar i{ display:block; height:100%; background:#4fae74; }
    .mar-chip-bar i.warn{ background:#c8a04a; } .mar-chip-bar i.bad{ background:#b4545e; }
    .mar-side{ width:min(300px,38%); flex:0 0 auto; overflow:auto; }
    .mar-go.pri{ border-color:#3f6d8a; background:#16283a; }
    @media (max-width:760px){
      .mar-body:has(.mar-dock){ flex-direction:column; }
      .mar-side{ width:100%; }
      .mar-scene{ flex:0 0 auto; height:min(34vh,220px); }
    }
    /* Same allow-list shape the seats use: the picture stays, the chrome goes. There is no world
       canvas here, so what big screen buys is the whole window for the screen itself. */
    body.bigscreen .mar-root > .mar-head{ display:none !important; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
