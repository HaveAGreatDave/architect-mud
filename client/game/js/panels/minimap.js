// Sidebar minimap (9×9 BFS/grid) and the full-screen map popup.
import { sendCmd, sendCmdSilent } from '../net.js';
import { appendMsg } from '../render.js';
import { state } from '../state.js';

// Avenue View for the sidebar/HUD/mobile minimaps: a rendering toggle (not a
// server round-trip) that strips room symbols down to "does a named artery run
// through here" — || north/south, = east/west, + at a crossing. Persisted, and
// the last node payload is cached so the toggle can re-render without a move.
const MM_AVENUE_KEY = 'mm_avenue';
let mmAvenueView = false; // avenue mode retired — toggle removed, always plain
let _lastMinimapNodes = null;

// The city map lives in the tablet Map app now (the standalone popup is retired).
// tablet-os.js injects its opener here via setMapOpener so the minimap double-click
// can open it without minimap.js importing the tablet (which would be a cycle). The
// fallback still opens the tablet map, just without the skip-boot fast-path.
let _mapOpener = () => sendCmdSilent('tabletnav map');
export function setMapOpener(fn) { if (typeof fn === 'function') _mapOpener = fn; }

// Minimap zoom: three levels sharing the same render, differing only in the BFS
// window radius R (fewer tiles = closer) and a matching tile size so each minimap's
// footprint stays ~constant as you zoom. Level 0 (R=4, 9×9) reproduces the CSS
// defaults exactly, so nothing changes at the default zoom. Applies to all three
// minimaps (sidebar / HUD / mobile) since they share one rendered html string.
const MM_ZOOM_KEY = 'mm_zoom';
const MM_ZOOM = [{ R: 4 }, { R: 3 }, { R: 2 }]; // far → near (9×9, 7×7, 5×5)
const MM_GRIDS = [
  { id: 'minimap-grid', base: 1.7 },
  { id: 'minimap-grid-hud', base: 1.4 },
  { id: 'minimap-grid-mob', base: 1.75 },
];
let mmZoom = 0;
try { const z = parseInt(localStorage.getItem(MM_ZOOM_KEY), 10); if (z >= 0 && z < MM_ZOOM.length) mmZoom = z; } catch {}

// Size the grid tracks to the current zoom's window and scale the tile size so the
// grid keeps roughly the same overall footprint. At level 0 scale is 1, so the
// inline values match the CSS and there's no visual change from default.
function applyMinimapZoom() {
  const n = 2 * MM_ZOOM[mmZoom].R + 1;
  const scale = 9 / n;
  for (const { id, base } of MM_GRIDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.setProperty('--mm-room', (base * scale).toFixed(3) + 'em');
    el.style.gridTemplateColumns = `repeat(${n}, var(--mm-room))`;
    el.style.gridTemplateRows = `repeat(${n}, var(--mm-room))`;
  }
  const zin = document.getElementById('mm-zoom-in');
  const zout = document.getElementById('mm-zoom-out');
  if (zin) zin.disabled = mmZoom >= MM_ZOOM.length - 1;
  if (zout) zout.disabled = mmZoom <= 0;
}

// +1 = zoom in (closer, smaller R), −1 = zoom out. Clamped; re-renders in place.
function stepMinimapZoom(delta) {
  const next = Math.min(MM_ZOOM.length - 1, Math.max(0, mmZoom + delta));
  if (next === mmZoom) return;
  mmZoom = next;
  try { localStorage.setItem(MM_ZOOM_KEY, String(mmZoom)); } catch {}
  if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes);
  else applyMinimapZoom();
}

function wireMinimapAvenueToggle() {
  const btn = document.getElementById('mm-avenue-toggle');
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.classList.toggle('active', mmAvenueView);
  btn.addEventListener('click', () => {
    mmAvenueView = !mmAvenueView;
    try { localStorage.setItem(MM_AVENUE_KEY, mmAvenueView ? '1' : '0'); } catch {}
    btn.classList.toggle('active', mmAvenueView);
    if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes);
  });
}
// Run mode mirrors the server's player.running (source of truth). The Run toggle
// and the `run` command both round-trip through the server, which echoes a
// `run_state` message back into setRunState() to light the button and re-pace
// auto-walk. Kept in sync with the client's cached stamina so auto-walk can tell
// when a runner has gone too winded to keep the pace.
let runMode = false;
const RUN_STEP_STAMINA = 4;        // must match movement.js RUN_STEP_STAMINA
const WALK_STEP_MS = 1000;         // relaxed walking cadence
const RUN_STEP_MS  = 480;          // brisk running cadence
// Delay before the next auto-walk step: run cadence only while running AND with
// stamina left to spend — otherwise a winded runner auto-drops to the walk pace.
// The server's pacing plugin honours player.running too (RUN_COOLDOWN_MS, road-halved),
// so our send-rate must stay just above the server's cooldown or a too-fast step gets
// silently QUEUED — which the stuck-detector below would misread as no-progress. On-road
// the server cooldown is ~350ms, so the brisk RUN_STEP_MS (480) clears it with margin.
// Off-road we conservatively floor to the walk pace (server cooldown ~700ms there).
function autoWalkDelay() {
  const sta = state.player?.stamina ?? 100;
  if (!runMode || sta < RUN_STEP_STAMINA) return WALK_STEP_MS;
  const cur = (_lastMinimapNodes || []).find(n => n.is_current);
  const onRoad = cur?.terrain === 'road' || (Array.isArray(cur?.artery) && cur.artery.length > 0);
  return onRoad ? RUN_STEP_MS : WALK_STEP_MS;
}
function runBtn() { return document.getElementById('mm-run-toggle'); }
// Run-state subscribers outside this module (e.g. the Tablet Map app's Run button)
// so they can light up in step with the sidebar toggle when a `run_state` arrives.
const _runListeners = [];
export function isRunning() { return runMode; }
export function onRunStateChange(fn) { _runListeners.push(fn); }
// Called from dispatch on a `run_state` message (the server's answer to `run`).
export function setRunState(running) {
  runMode = !!running;
  runBtn()?.classList.toggle('active', runMode);
  for (const fn of _runListeners) { try { fn(runMode); } catch {} }
}

// Auto-walk: steps the player toward the plotted GPS route (mapState.tracePath,
// set by the `gps` command or a clicked map route) one hop at a time, until
// arrival, the route runs out, or the user stops it. Cadence follows run/walk mode.
const DIR_CMDS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out'];
let autoWalkTimer = null;
// Watchdog for a sent-but-unconfirmed hop. Auto-walk is CONFIRMATION-DRIVEN: after
// sending a step we don't blind-fire the next one on a timer (that races the server —
// a slow move reply meant we'd re-send the same hop, double-step, overshoot a turn and
// wander off the plotted corridor → the "bouncing / off-path" bug). Instead we wait for
// the server's move reply to confirm we reached the next tile (notifyAutoWalkArrival),
// then pace the following hop. The watchdog only fires if that confirmation never comes
// (a swallowed move, a stall), re-evaluating from our real position.
let autoWalkWatchdog = null;
const AUTO_WATCHDOG_MS = 3000;
// The player's standing intent to auto-walk. Distinct from autoWalkTimer (the
// "currently stepping" state): it SURVIVES arriving at a waypoint, so when a quest
// advances a phase and re-plots the route (gps_route resumeAuto), we can pick the
// next leg up without another Auto click. Cleared only by an explicit stop
// (toggle off), a hard error, or the route being cleared.
let autoWalkArmed = false;
// Does the current route want auto-walk to STAY armed after arriving? Set from the
// server's `continueOnArrival` flag on the gps_route (see setAutoWalkPersist). Quest
// legs set it true so a multi-leg journey resumes at the next waypoint without another
// Auto click; a plain `gps` destination leaves it false, so arriving fully turns
// auto-walk off (button unlit, intent cleared) instead of lingering armed.
let autoWalkPersist = false;
// Stuck detection: a step that leaves us in the same room made no progress. The
// only non-erroring way that happens mid-walk is an ambiguous exit throwing a SIFT
// picker (which auto-walk can't answer, so it just re-prompts). Two in a row → stop.
let autoNoProgress = 0;
let autoLastZone = null;
let autoPendingTarget = null; // the zone id the last auto-walk step is trying to reach
// Off-course recovery: if a step lands us off the plotted corridor, we ask the server
// to re-plot from here and resume. Bounded so a destination the server can't reach
// from our new spot doesn't spin forever.
let autoRerouteTries = 0;
// Blocked-entrance recovery: tiles whose entrance turned out to be blocked (a locked
// door, a gated apartment) — a route that isn't visible to the road planner. On a
// blocked step we add the tile here and re-plot AROUND it (server-side avoid set)
// instead of dead-stopping, so the walk problem-solves its way past obstacles. Bounded
// so a genuinely walled-off destination stops cleanly rather than thrashing.
const autoAvoid = new Set();
const AUTO_AVOID_MAX = 8;
// Consecutive blocks from the SAME standing tile. A tile-specific obstacle (locked
// door) is passed by rerouting and we move on, resetting this; a GLOBAL block
// (encumbrance fails every direction) keeps failing from the same spot — cap it so we
// stop cleanly after a few instead of spamming a reroute per direction.
let autoBlockAnchor = null;
let autoBlockTries = 0;
const AUTO_BLOCK_MAX = 3;

function autoWalkBtn() { return document.getElementById('mm-auto-toggle'); }

function clearAutoWalkWatchdog() {
  if (autoWalkWatchdog) { clearTimeout(autoWalkWatchdog); autoWalkWatchdog = null; }
}
// Arm the safety net for a hop we just sent: if the server never confirms arrival,
// re-run the step from our real position (which either retries, reroutes, or stops).
function armAutoWalkWatchdog() {
  clearAutoWalkWatchdog();
  autoWalkWatchdog = setTimeout(() => { autoWalkWatchdog = null; autoWalkStep(); }, AUTO_WATCHDOG_MS);
}

// Ask the server to re-plot to `destId` from wherever we are now, routing around any
// tiles we've learned are blocked, and quietly resume the armed walk (no y/n prompt).
// Shared by off-course recovery and blocked-entrance recovery.
function requestReroute(destId) {
  const avoid = autoAvoid.size ? ` !avoid ${[...autoAvoid].join(',')}` : '';
  sendCmdSilent(`gps ${destId}${avoid} !resume`);
}

// An ambiguous-direction move threw a numbered exit picker. Because auto-walk
// already knows the exact next zone id on the route, match it against the picker's
// candidates and answer the matching number ourselves — so the walk flows straight
// through multi-exit junctions instead of stalling. Returns true if we answered
// (the caller then suppresses the picker text). `picker.candidates` is [{n,id}] in
// the same order the [1]/[2] options are rendered.
export function resolveAutoWalkPicker(picker) {
  if (!isAutoWalking() || autoPendingTarget == null) return false;
  const hit = (picker?.candidates || []).find((c) => c.id === autoPendingTarget);
  // The picker only accepts a number on the visible page (SIFT PAGE_SIZE = 5); if
  // our target sits deeper, let it fall through to the stall-and-stop path.
  if (!hit || hit.n == null || hit.n > 5) return false;
  sendCmdSilent(String(hit.n)); // resolves the pending selection → the move completes
  return true;
}

// keepArmed:true is the "arrived at this leg's end but still want to auto-walk the
// next one" case — the timer stops but the intent persists for a resume.
function stopAutoWalk(message, { keepArmed = false } = {}) {
  if (autoWalkTimer) { clearTimeout(autoWalkTimer); autoWalkTimer = null; }
  clearAutoWalkWatchdog();
  if (!keepArmed) { autoWalkArmed = false; autoWalkBtn()?.classList.remove('active'); autoAvoid.clear(); }
  autoNoProgress = 0; autoLastZone = null; autoPendingTarget = null; autoRerouteTries = 0;
  autoBlockAnchor = null; autoBlockTries = 0;
  if (message) appendMsg(message, 'system');
}

// Actively walking = either pacing the gap to the next hop (autoWalkTimer) or waiting
// for the server to confirm a hop we already sent (autoWalkWatchdog). Both count so a
// blocked move / exit picker arriving during the confirmation wait is still handled.
export function isAutoWalking() { return autoWalkTimer !== null || autoWalkWatchdog !== null; }

// A manual `gps` walk is a one-shot to a chosen destination (autoWalkPersist false),
// as opposed to a continuing quest walk (persist true). Dispatch uses this to keep a
// background quest re-plot from hijacking the route mid manual-walk — the player picked
// where they're going; let them arrive and stop there.
export function isManualAutoWalkInProgress() { return isAutoWalking() && !autoWalkPersist; }

// A quest re-plotted the GPS route for a new phase (gps_route resumeAuto). If the
// player had auto-walk engaged for the prior leg — even if it "arrived" and paused
// between legs — resume walking the fresh route automatically.
export function resumeAutoWalkIfArmed() {
  if (autoWalkArmed && !isAutoWalking()) startAutoWalk();
}

// Called from dispatch for any gps_route that declares `continueOnArrival` (quest legs
// true, plain `gps` false). Reroute re-plots during an in-progress walk omit the flag,
// so they leave the current setting untouched — a quest walk stays "continuing" across
// an off-course reroute.
export function setAutoWalkPersist(v) { autoWalkPersist = !!v; }

function autoWalkStep() {
  autoWalkTimer = null;
  const current = (_lastMinimapNodes || []).find(n => n.is_current);
  if (!current) { stopAutoWalk('Auto-walk stopped — lost track of where you are.'); return; }
  const path = effectiveTracePath(current.id);
  // Arrived at this leg's end. Keep the intent armed only for a continuing route (a
  // quest leg — autoWalkPersist) so a quest advancing to a new waypoint (gps_route
  // resumeAuto) picks up without another Auto click. A plain `gps` destination isn't
  // continuing, so fully stop: unlight the Auto button and clear the armed intent.
  if (!path || path.length < 2) { stopAutoWalk('Auto-walk: arrived.', { keepArmed: autoWalkPersist }); return; }

  // Off course: a forced move / wrong turn / mismatched exit dropped us off the
  // plotted corridor. Rather than stall trying to step to a tile we can't reach, ask
  // the server to re-plot from here to the same destination and resume (armed).
  if (!mapState.tracePath.includes(current.id)) {
    const destId = mapState.tracePath[mapState.tracePath.length - 1];
    if (destId && current.id !== destId && ++autoRerouteTries <= 5) {
      autoLastZone = null; autoPendingTarget = null;
      requestReroute(destId); // gps_route resumeAuto re-arms the step from our new spot
      return;
    }
    stopAutoWalk("Auto-walk stopped — off course and can't find a way back to the route.");
    return;
  }
  autoRerouteTries = 0;

  // Still in the same room as last step = the move didn't take (an ambiguous exit
  // threw a SIFT picker). Tolerate one hiccup; on the second, stop and dismiss the
  // pending picker so it doesn't swallow the player's next input.
  if (autoLastZone === current.id) {
    if (++autoNoProgress >= 2) {
      sendCmdSilent('cancel');
      stopAutoWalk('Auto-walk stopped — the way ahead is ambiguous. Pick an exit yourself.');
      return;
    }
  } else {
    autoNoProgress = 0;
  }
  autoLastZone = current.id;

  const nextId = path[1];
  // Prefer the server's authoritative per-hop direction (mapState.traceDirs, aligned
  // to the full tracePath): the minimap node only knows the FIRST target per direction
  // (primaryExits), so it can't resolve a second same-direction exit on its own. When
  // the server didn't supply dirs (a client-side map-click route), fall back to reading
  // the direction off the current node's exits.
  const idx = mapState.tracePath.indexOf(current.id);
  let dir = (mapState.traceDirs && idx >= 0) ? mapState.traceDirs[idx] : null;
  if (!dir) dir = Object.entries(current.exits || {}).find(([, id]) => id === nextId)?.[0];
  if (!dir || !DIR_CMDS.includes(dir)) { stopAutoWalk("Auto-walk stopped — can't step off the route from here."); return; }
  autoPendingTarget = nextId; // so an exit picker can be answered toward this zone
  sendCmd(dir);
  // Confirmation-driven: wait for the server to report we've reached nextId
  // (notifyAutoWalkArrival) before pacing the next hop — don't blind-fire a timer that
  // could outrun the server and walk us off the plotted path. The watchdog re-evaluates
  // only if that confirmation never lands.
  armAutoWalkWatchdog();
}

// renderMinimap calls this on every confirmed position update. When the tile we were
// stepping toward becomes our current room, the hop is done — pace the next one. Cosmetic
// re-renders (avenue toggle, overlay changes) pass our unchanged standing tile, which can
// never equal the pending NEXT tile, so they never false-advance the walk.
export function notifyAutoWalkArrival(currentId) {
  if (!autoWalkArmed || autoPendingTarget == null) return;
  if (currentId !== autoPendingTarget) return;   // not the hop we're waiting on
  autoPendingTarget = null;
  clearAutoWalkWatchdog();
  if (autoWalkTimer) clearTimeout(autoWalkTimer);
  autoWalkTimer = setTimeout(autoWalkStep, autoWalkDelay());
}

export function startAutoWalk() {
  // Idempotent — clear any walk already in flight so a fresh route (e.g. the
  // Tablet's Auto button re-plotting) never leaves two step-timers racing.
  if (autoWalkTimer) { clearTimeout(autoWalkTimer); autoWalkTimer = null; }
  clearAutoWalkWatchdog();
  const current = (_lastMinimapNodes || []).find(n => n.is_current);
  const path = current ? effectiveTracePath(current.id) : null;
  if (!path || path.length < 2) { appendMsg('Auto-walk: no GPS route plotted.', 'system'); return; }
  autoWalkArmed = true;
  autoNoProgress = 0; autoLastZone = null;
  autoWalkBtn()?.classList.add('active');
  autoWalkStep();
}

// One-shot "auto-walk there now? (y/n)" prompt armed by a manual `gps` plot.
// The next typed line answers it (input.js): y/yes walks the just-plotted route,
// anything else lets it lapse. Cleared on any answer so it never lingers.
let autoWalkPromptPending = false;
export function armAutoWalkPrompt() { autoWalkPromptPending = true; }
export function isAutoWalkPromptPending() { return autoWalkPromptPending; }
export function answerAutoWalkPrompt(yes) {
  autoWalkPromptPending = false;
  if (yes) { autoAvoid.clear(); startAutoWalk(); } // fresh walk — forget prior obstacles
}

// `auto` command / Auto button: toggle the route walk. Armed-but-paused (arrived
// between quest legs) counts as "on" so a click turns the intent fully off.
export function toggleAutoWalk() {
  if (isAutoWalking() || autoWalkArmed) stopAutoWalk('Auto-walk stopped.');
  else { autoAvoid.clear(); startAutoWalk(); } // fresh walk — forget prior obstacles
}

// Cancel an in-progress (or armed-but-paused) walk from outside the module — a
// typed `stop`, or a blocked move (locked door, encumbrance) echoed back as an
// error. No-ops (and stays silent) if there was nothing to stop.
export function cancelAutoWalk(message) {
  if (!isAutoWalking() && !autoWalkArmed) return false;
  stopAutoWalk(message);
  return true;
}

// A move the walker sent came back as an error (a blocked entrance — locked door,
// gated apartment — that the road planner couldn't see). Instead of dead-stopping,
// mark that tile as avoid and re-plot AROUND it, so the walk problem-solves past the
// obstacle. Falls back to a clean stop when there's nothing to route around: the
// blocked tile IS the destination, no step was in flight, or the avoid budget is spent.
// Returns true if it handled the error (rerouted or stopped an active walk).
export function autoWalkBlocked(message) {
  if (!isAutoWalking()) return false;
  const destId = mapState.tracePath?.[mapState.tracePath.length - 1];
  const blocked = autoPendingTarget;
  const here = (_lastMinimapNodes || []).find(n => n.is_current)?.id;
  // Count consecutive blocks from this same tile — resets the moment we actually move
  // (a new standing tile), so a route past several locked buildings still gets the full
  // avoid budget, but a wall we can't leave at all stops after AUTO_BLOCK_MAX.
  if (here === autoBlockAnchor) autoBlockTries++; else { autoBlockAnchor = here; autoBlockTries = 1; }
  if (blocked && destId && blocked !== destId && autoAvoid.size < AUTO_AVOID_MAX && autoBlockTries <= AUTO_BLOCK_MAX) {
    autoAvoid.add(blocked);
    if (autoWalkTimer) { clearTimeout(autoWalkTimer); autoWalkTimer = null; }
    clearAutoWalkWatchdog();
    autoLastZone = null; autoPendingTarget = null;
    requestReroute(destId);
    return true;
  }
  stopAutoWalk(message || 'Auto-walk stopped — the way ahead is blocked.');
  return true;
}

function wireMinimapAutoToggle() {
  const btn = autoWalkBtn();
  if (btn && !btn._wired) { btn._wired = true; btn.addEventListener('click', toggleAutoWalk); }
  // Run toggle: let the server flip player.running (it echoes run_state back).
  const rbtn = runBtn();
  if (rbtn && !rbtn._wired) { rbtn._wired = true; rbtn.addEventListener('click', () => sendCmd('run')); }
}
// Double-clicking any minimap (sidebar / HUD / mobile) opens the full-screen map.
// Delegated on document so it works no matter when the grids are created.
let _mmDblWired = false;
function wireMinimapDblClick() {
  if (_mmDblWired) return;
  _mmDblWired = true;
  document.addEventListener('dblclick', (e) => {
    if (e.target?.closest?.('#minimap-grid, #minimap-grid-hud, #minimap-grid-mob')) _mapOpener();
  });
}
function wireMinimapZoom() {
  const zin = document.getElementById('mm-zoom-in');
  const zout = document.getElementById('mm-zoom-out');
  if (zin && !zin._wired) { zin._wired = true; zin.addEventListener('click', () => stepMinimapZoom(1)); }
  if (zout && !zout._wired) { zout._wired = true; zout.addEventListener('click', () => stepMinimapZoom(-1)); }
  applyMinimapZoom(); // apply the persisted level + set initial button disabled states
}
function wireMinimap() { wireMinimapAvenueToggle(); wireMinimapAutoToggle(); wireMinimapDblClick(); wireMinimapZoom(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireMinimap);
else wireMinimap();

// luminanceTextColor lived here. It moved to scripts/content/derive.mjs as
// contrastText() and now runs at build time, so spec.text is already final — the
// renderer never picks a colour. (There were two of these, and they disagreed:
// the dev panel's returned a binary #111111/#eeeeee against this one's continuous
// grey, so the same tile was lettered differently in the editor and the game.)

// Slide the minimap in the direction of travel so a move reads as movement
// rather than a hard swap. Offset is one cell; the new frame starts shifted
// toward where you came from and slides to center (camera-follow feel).
const MM_SLIDE = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
// Scale for z-transitions: up feels like rising (expand), down like descending (contract).
const MM_SCALE = { up: 1.18, down: 0.82 };

function slideMinimap(direction) {
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  for (const id of ['minimap-grid', 'minimap-grid-mob']) {
    const el = document.getElementById(id);
    if (!el || !el.animate) continue;
    const off = MM_SLIDE[direction];
    if (off) {
      el.animate(
        [{ transform: `translate(${off[0] * 1.6}em, ${off[1] * 1.6}em)` }, { transform: 'translate(0, 0)' }],
        { duration: 180, easing: 'ease-out' }
      );
    } else if (MM_SCALE[direction]) {
      // Z-level shift: fade+scale from the departure state into the new floor.
      const s = MM_SCALE[direction];
      el.animate(
        [{ opacity: 0, transform: `scale(${s})` }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' }
      );
    } else if (direction === 'in' || direction === 'out') {
      // Portal/building transition: quick opacity dip.
      el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 200, easing: 'ease-in-out' }
      );
    }
  }
}

function minimapMessage(msg) {
  for (const id of ['minimap-grid', 'minimap-grid-mob', 'minimap-grid-hud']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span class="mm-msg">${msg}</span>`;
  }
}

// Toggle the void theming class on every minimap grid (dark ashen backdrop). Kept
// separate so the normal city render can clear it when you step back onto the grid.
function setMinimapCrossing(on) {
  for (const id of ['minimap-grid', 'minimap-grid-hud', 'minimap-grid-mob']) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('mm-crossing-mode', on);
  }
}

// ── Crossing mode: the void has no grid, so we render the branch-trail instead ──
// The void's exits are a convention: `north` is always "back the way you came"
// (`east` for a dead-end detour), `south` is "deeper", `east`/`west` off the trunk
// are a fork/divert or a risk-for-loot detour. We chart only what you'd honestly
// know — the trail behind you (walked), where you stand, and that it goes on into
// fog ahead (the layout ahead stays a blind gamble, per the design). Fork/detour
// options off your CURRENT room show as branch ticks.
const backDirOf = (n) => (n.void_detour ? 'east' : 'north');
const fwdDirOf = (n) => (n.void_detour ? null : 'south');

// The trail's inner markup (cap → walked → you → ahead → foot), from the minimap
// nodes. Pure + exported so the tablet Map app renders the identical "journey map"
// off the grid (tablet-os.js renderJourneyMap) — one source of truth for the void
// chart, mirroring how the minimap and tablet map share the city tiles.
export function crossingInnerHtml(nodes, current) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const isVoid = (n) => !!(n && n.void_crossing);

  // The walked trail behind: follow the "back" exit room to room (nearest first).
  const behind = [];
  let cur = current, guard = 0;
  while (guard++ < 5) {
    const b = byId.get(cur.exits?.[backDirOf(cur)]);
    if (!isVoid(b)) break;      // hit the origin gate (off the void map) or the window edge
    behind.push(b);
    cur = b;
  }

  // What's ahead: a dead-end (detour), the far gate (south leaves the void map onto
  // a region), or more trail into fog.
  let ahead;
  if (current.void_detour) ahead = 'dead';
  else {
    const sId = current.exits?.south;
    ahead = !sId ? 'none' : (byId.has(sId) ? 'fog' : 'gate');
  }

  // Branch options off where you stand (anything that isn't back or forward).
  const back = backDirOf(current), fwd = fwdDirOf(current);
  const branches = [];
  for (const [dir, tId] of Object.entries(current.exits || {})) {
    if (dir === back || dir === fwd) continue;
    const t = byId.get(tId);
    if (t?.void_detour) branches.push({ dir, kind: 'gamble' });
    else if (isVoid(t)) branches.push({ dir, kind: 'divert' });
  }

  // A short label rides beside each meaningful node so the trail reads at a glance —
  // which way is back, where you stand, what's ahead — instead of a column of bare dots.
  const lbl = (t) => `<span class="mm-x-lbl">${t}</span>`;
  const hotHere = !!current.void_hard;   // you're standing on a seeded hard node
  const hotBehind = behind.some(b => b.void_hard);
  let rows = '';
  // Top cue: the vertical axis points BACK the way you came (north), so mark it.
  if (behind.length) rows += `<div class="mm-x-row mm-x-cue"><span class="mm-x-node">↑</span>${lbl('the way back')}</div>`;
  for (const b of behind.slice().reverse())
    rows += `<div class="mm-x-row mm-x-walked${b.void_hard ? ' mm-x-hot' : ''}" title="${escapeHtml(b.name || 'the waste')}${b.void_hard ? ' — bad ground, and you came through it' : ''}"><span class="mm-x-node">${b.void_hard ? '✷' : '●'}</span></div>`;
  const ticks = branches.map(br =>
    `<span class="mm-x-branch mm-x-${br.kind}" title="${br.dir}: ${br.kind === 'gamble' ? 'a risk-for-loot detour' : 'divert toward another region'}">${br.kind === 'gamble' ? '?' : '⋔'}</span>`
  ).join('');
  const hotTick = hotHere ? `<span class="mm-x-branch mm-x-hazard" title="hard ground — a rougher ambush lives here">⚠</span>` : '';
  rows += `<div class="mm-x-row mm-x-you${hotHere ? ' mm-x-hot' : ''}" title="${escapeHtml(current.name || 'the void')}">${lbl(hotHere ? 'bad ground' : 'you')}<span class="mm-x-node mm-x-here">◎</span>${ticks}${hotTick}</div>`;
  if (ahead === 'gate') rows += `<div class="mm-x-row mm-x-gate" title="the far gate"><span class="mm-x-node">⌂</span>${lbl('the gate')}</div>`;
  else if (ahead === 'fog') rows += `<div class="mm-x-row mm-x-fog"><span class="mm-x-node">⋯</span>${lbl('onward')}</div>`;
  else if (ahead === 'dead') rows += `<div class="mm-x-row mm-x-dead" title="a dead end"><span class="mm-x-node">▚</span>${lbl('dead end')}</div>`;

  // Spell out the branch ticks (⋔ / ? / ⚠) only when there are any — otherwise they're cryptic.
  const legendBits = [];
  if (branches.some(b => b.kind === 'divert')) legendBits.push('⋔ another way');
  if (branches.some(b => b.kind === 'gamble')) legendBits.push('? risk-for-loot');
  if (hotHere || hotBehind) legendBits.push('⚠ hard ground');
  const legend = legendBits.length ? `<div class="mm-x-legend">${legendBits.join(' · ')}</div>` : '';
  return `<div class="mm-x-cap">◈ THE VOID</div>`
    + `<div class="mm-x-trail">${rows}</div>${legend}`;
}

// Whether the player is currently out on a void crossing (the last minimap payload
// put them in a void_crossing room). Cheap read of the cached nodes — the tablet
// home grid uses it to make the Frontier app glow while you're mid-journey.
export function isOnCrossing() {
  return !!_lastMinimapNodes?.find(n => n.is_current)?.void_crossing;
}

function renderCrossing(nodes, current, direction) {
  setMinimapCrossing(true);
  const html = `<div class="mm-crossing">${crossingInnerHtml(nodes, current)}</div>`;

  applyMinimapZoom();
  for (const id of ['minimap-grid', 'minimap-grid-hud', 'minimap-grid-mob']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  if (direction) slideMinimap(direction);
}

export function renderMinimap(nodes, direction) {
  if (!nodes || !nodes.length) { minimapMessage('(unmapped)'); return; }

  const current = nodes.find(n => n.is_current);
  if (!current) { minimapMessage('(unmapped)'); return; }
  _lastMinimapNodes = nodes; // cache so the Avenue View toggle can re-render in place
  notifyAutoWalkArrival(current.id); // confirmation-driven auto-walk: advance only when we actually arrive

  // Off the grid: a waste-crossing room isn't on the world map, so drop the city
  // renderer for a stylized "you are in the void" trail view (walked → you → fog).
  if (current.void_crossing) { renderCrossing(nodes, current, direction); return; }
  setMinimapCrossing(false);

  const byId = new Map(nodes.map(n => [n.id, n]));
  const coords = new Map();

  // District clipping DISABLED: the sidebar now renders every tile in the window,
  // regardless of district, so neighbouring districts stay in place instead of being
  // fogged to void. (`inDist` is kept as an always-true predicate so the gateway /
  // foreign-tile branches below simply never fire.)
  const inDist = () => true;
  const gateways = new Set();

  if (current.map_id && current.grid_x != null && current.grid_y != null) {
    for (const n of nodes) {
      if (n.map_id === current.map_id && n.grid_z === current.grid_z && n.grid_x != null && n.grid_y != null) {
        coords.set(n.id, [n.grid_x - current.grid_x, n.grid_y - current.grid_y]);
      }
    }
  }

  if (!coords.size) {
    const DIR_OFFSET = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
    coords.set(current.id, [0,0]);
    const queue = [current.id];
    const seen = new Set([current.id]);
    while (queue.length) {
      const id = queue.shift();
      const node = byId.get(id);
      const [x,y] = coords.get(id);
      if (!node) continue;
      for (const [dir, targetId] of Object.entries(node.exits || {})) {
        if (!DIR_OFFSET[dir] || !byId.has(targetId) || seen.has(targetId)) continue;
        const [dx,dy] = DIR_OFFSET[dir];
        coords.set(targetId, [x+dx, y+dy]);
        seen.add(targetId);
        queue.push(targetId);
      }
    }
  }

  // Edge-to-edge 1:1: a 9×9 tile window (x,y ∈ −R..R), one cell per tile — tiles
  // touch and roads/buildings render their own spec.feature footprint, so there are no
  // connector/gap cells (mirrors the full-map popup). Gateways: a foreign tile one
  // step across a district boundary from an in-district tile still renders as an edge
  // marker, so crossing between neighborhoods reads.
  const R = MM_ZOOM[mmZoom].R;
  const gCols = 2 * R + 1, gRows = gCols;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  const inWin = (x, y) => x >= -R && x <= R && y >= -R && y <= R;
  for (const [id, [x, y]] of coords) {
    if (!inWin(x, y)) continue;
    cell[y + R][x + R] = id;
    const node = byId.get(id);
    if (!node || !inDist(node)) continue;
    for (const targetId of Object.values(node.exits || {})) {
      if (!coords.has(targetId)) continue;
      const [tx, ty] = coords.get(targetId);
      if (Math.abs(tx - x) > 1 || Math.abs(ty - y) > 1) continue;
      const tnode = byId.get(targetId);
      if (tnode && !inDist(tnode)) gateways.add(targetId);
    }
  }

  // A named zone-icon SVG (spec.feature → assets/zone-icons/<name>.svg) is the tile's
  // footprint, drawn as a CSS mask so it takes the tile's text colour. Mirrors the
  // full map: the SVG footprint is the base layer in every overlay mode, and the
  // shared overlay setting (mapState.avenueOverlay) paints a 2-letter acronym or a
  // building-type glyph over building tiles on top.
  const iconSvg = (name) => /^[a-z0-9_-]+$/i.test(name || '')
    ? `<span class="mm-icon" style="--zi:url(/assets/zone-icons/${name}.svg)"></span>` : '';
  const overlay = mapState.avenueOverlay || 'icons'; // none | labels | icons
  // ONE CHANNEL. Both layers a tile can stand on top of its ground come from the spec
  // the build derived (scripts/content/derive.mjs), so this file no longer decides what
  // a tile is: `spec.feature` is the footprint SVG, `spec.label` is the code someone
  // reads. There used to be a second, separately-computed `node.icon_svg`, and an
  // `isBuilding()` predicate here that the tablet spelled differently — which is how the
  // two screens came to disagree about which tiles wear a label.
  const baseSym = (node) => iconSvg(node.spec?.feature) || (node.enterable
    ? '▣ ' // pass-through building tile: a door you enter, not a room you stand in
    : (node.sanctuary ? '◆ ' : '')); // bare tile — no marker glyph (#, ⸪., …)
  // `spec.label.kind` decides what the overlay toggle is allowed to do, so the toggle
  // cannot reach a tile that has no business toggling:
  //   building  a navigable code — Labels mode replaces the graphic with a solid box
  //   room      an apartment designation — a code, so it follows Labels too
  //   art       sewer-corridor connectivity art. THE TILE'S OWN DRAWING, exactly like a
  //             road connector, so it survives every mode. This is the rule that stops
  //             roads vanishing when someone switches buildings to letters.
  // A road has no label key at all, which is why no mode can touch it.
  const symFor = (node) => {
    const lbl = node.spec?.label || null;
    if (lbl?.kind === 'art') return baseSym(node) + `<span class="map-bld-ov map-bld-art">${escapeHtml(lbl.text)}</span>`;
    // Labels: hide the building graphic entirely and show the code filling the tile
    // square (map-bld-label turns the tile into a solid labelled box). No label ⇒ draw
    // the bare tile, not the building furniture — falling through would stamp the
    // building-type glyph on an unmarked interior room.
    if (overlay === 'labels' && lbl) return `<span class="map-bld-ov map-bld-label">${escapeHtml(lbl.text)}</span>`;
    const base = baseSym(node);
    if (overlay === 'none' || !node.building_type) return base;
    const glyph = BUILDING_ICON[node.building_type] || BUILDING_ICON._default;
    return base + `<span class="map-bld-ov map-bld-icon">${glyph}</span>`;
  };
  // Hover tooltip: zone name, its district, street name(s), plus any building(s).
  const titleFor = (node) => {
    const parts = [node.enterable && node.building_name ? `${node.building_name} — enter` : node.name];
    if (node.district?.name) parts.push(node.district.name);
    if (node.artery?.length) parts.push(node.artery.join(' / '));
    if (node.buildings?.length) parts.push(node.buildings.join(', '));
    return escapeHtml(parts.join('\n'));
  };

  // Route trace (shared with the full map): the plotted route is drawn as an accent
  // line through tile centres (an SVG laid over the grid, built after the cell loop),
  // matching the full map's polyline rather than highlighting boxes.
  const tracePath = effectiveTracePath(current.id) || [];

  // Overworld water: when standing on map_world we can map an empty window cell back
  // to its absolute grid coord (current.grid_x/y + its offset) and tint the bay corners.
  const worldMap = current.map_id === 'map_world' && current.grid_x != null && current.grid_y != null;

  let html = '';
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      const id = cell[r][c];
      if (!id) {
        if (worldMap && isWorldWaterVoid('map_world', current.grid_x + (c - R), current.grid_y + (r - R)))
          html += `<span class="mm-c mm-room mm-terr mm-water mm-styled" style="background-color:${WATER_VOID_FILL}" title="Coldwater Bay"></span>`;
        else html += `<span class="mm-c mm-void"></span>`;
        continue;
      }
      const node = byId.get(id);
      if (!node) { html += `<span class="mm-c mm-void"></span>`; continue; }
      if (node.is_current) {
        // Render the tile you're standing on (its terrain fill / authored colour)
        // UNDER the "you are here" beacon, so the marker reads as a locator on a
        // visible tile rather than a blank swatch. The beacon (mm-current ::before/
        // ::after) is a small centred dot+ring, so the tile shows around it.
        const cs = [];
        const cterr = terrainOf(node);
        if (node.spec?.fill) cs.push(`background-color:${node.spec.fill}`);
        else if (node.district?.color) { const [dr, dg, db] = hexToRgb(node.district.color); cs.push(`background-color:rgba(${dr},${dg},${db},0.20)`); }
        const cterrCls = cterr ? ` mm-terr mm-${cterr}` : '';
        const cStyle = cs.length ? ` style="${cs.join(';')}"` : '';
        html += `<span class="mm-c mm-room mm-current${cterrCls}"${cStyle} title="${titleFor(node)}">${entranceMark(node.entrance, 'mm')}${exitMarks(node.exit_dirs, 'mm')}</span>`;
        continue;
      }
      // Foreign tile: only the ones one step across a boundary survive, as a gateway
      // edge marker (the district's initials in its colour). Deeper foreign tiles are
      // dropped to void so the sidebar stays scoped to your district.
      if (!inDist(node)) {
        if (gateways.has(node.id)) {
          const g = node.district || {};
          const gs = [];
          if (g.color) { const [r0, g0, b0] = hexToRgb(g.color); gs.push(`background:rgba(${r0},${g0},${b0},0.12)`, `color:${g.color}`, `border-color:${g.color}`); }
          html += `<span class="mm-c mm-room mm-gateway" style="${gs.join(';')}" title="→ ${escapeHtml(g.name || node.name)}">${streetAbbrev(g.name || node.name)}</span>`;
        } else {
          html += `<span class="mm-c mm-void"></span>`;
        }
        continue;
      }
      // Authored bg wins; otherwise a faint district tint so the sidebar reads as
      // coloured neighborhood regions, not a uniform code-grid.
      // Everything a tile looks like comes from spec — resolved at BUILD time by
      // scripts/content/derive.mjs, never recomputed here. The district tint is the
      // one thing left: it is a per-viewer overlay, not a property of the tile.
      const styles = [];
      const fill = node.spec?.fill || null;
      if (fill) styles.push(`background:${fill}`);
      else if (node.district?.color) { const [dr, dg, db] = hexToRgb(node.district.color); styles.push(`background:rgba(${dr},${dg},${db},0.20)`); }
      if (node.spec?.text) styles.push(`color:${node.spec.text}`);
      let styled = (fill || node.spec?.text) ? ' mm-styled' : '';
      // Terrain override (road / water / grass): seamless tileable fill. Roads become
      // grey asphalt with yellow markings (the road SVG mask inherits `color`); water
      // and grass drop their marker text for a clean coloured expanse + a connecting
      // texture supplied by the .mm-<terrain> class. `background-color` (long-hand) is
      // used so the class's texture background-image survives.
      let content = symFor(node);
      const terr = terrainOf(node);
      if (terr) {
        // Terrain paints the GROUND. Whatever stands on that ground is a separate
        // layer and survives the fill: an authored flags.icon SVG (a statue, a
        // helipad, an AA nest), the ▣ door marker, a building's overlay glyph or
        // label. Painting the statue's square `park` must not delete the statue —
        // symFor() already emits nothing for a bare tile, so there is no stray
        // marker text here to blank, only meaning. `background-color` (long-hand)
        // is used so the .mm-<terrain> class's texture image survives.
        // Roads and dirt roads need no branch any more: their yellow/tan markings
        // are just the palette's `text` for that terrain (auto_tile says the
        // connector SVG in spec.feature is doing the drawing).
        styles.length = 0;
        styles.push(`background-color:${node.spec.fill}`, `color:${node.spec.text}`);
        styled = ' mm-styled';
      }
      const terrCls = terr ? ` mm-terr mm-${terr}` : '';
      // Perimeter wall: gate tiles get a highlighted opening; other curtain tiles a
      // shimmer-edge; the glacis kill-zone a faint hazard tint. (server whitelists these.)
      const perimCls = node.perimeter_gate ? ' mm-gate' : (node.curtain ? ' mm-curtain' : (node.glacis ? ' mm-glacis' : ''));
      const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
      const unreach = node.reachable === false ? ' mm-unreachable' : '';
      // Enterable buildings are doors, not rooms — clickable (action-link + data-dest
      // rides main.js's delegated handler, sending `go <building name>`).
      const dangerCls = node.enterable ? 'safe' : (node.danger || 'safe');
      const enterCls = node.enterable ? ' mm-building action-link' : '';
      const enterAttrs = node.enterable && node.building_name
        ? ` data-action="go" data-target="${escapeHtml(node.building_name)}" data-dest="${escapeHtml(node.building_name)}"`
        : '';
      const cls = `mm-c mm-room danger-${dangerCls}${styled}${unreach}${enterCls}${terrCls}${perimCls}`;
      html += `<span class="${cls}"${styleAttr}${enterAttrs} title="${titleFor(node)}">${content}${entranceMark(node.entrance, 'mm')}${exitMarks(node.exit_dirs, 'mm')}</span>`;
    }
  }
  // GPS route line: an accent polyline through the centres of the route tiles that
  // fall inside this window, laid over the grid as an SVG spanning every track (so it
  // aligns with the centred cells without pixel math). viewBox is in tile units.
  const gpsPts = [];
  for (const id of tracePath) {
    const co = coords.get(id);
    if (!co) continue;
    const [x, y] = co;
    if (!inWin(x, y)) continue;
    gpsPts.push(`${(x + R + 0.5).toFixed(2)},${(y + R + 0.5).toFixed(2)}`);
  }
  if (gpsPts.length > 1)
    html += `<svg class="mm-gps-svg" viewBox="0 0 ${gCols} ${gRows}" preserveAspectRatio="none"><polyline class="mm-gps-line" points="${gpsPts.join(' ')}"/></svg>`;

  applyMinimapZoom(); // keep the grid tracks in step with R before painting the cells
  for (const id of ['minimap-grid', 'minimap-grid-mob', 'minimap-grid-hud']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  if (direction) slideMinimap(direction);
}

// Land-use / function colour key for the default map view. Keys + colours match
// server mapFunc() (movement.js) and scripts/landuse-zone-colors.js — keep synced.
// The district legend — SERVED, never written here. This was a hand-kept copy of
// the server's district registry, and it did exactly what a hand-kept copy does:
// four districts added over the past months were never copied across — wilds,
// sewer, yards and longwatch — so the regional map gave them no tint, no legend
// row and no tooltip. The Wilds alone is 3,471 tiles, the largest district in the
// game, rendering as a hole in the legend nobody could see the cause of.
//
// It is filled from /api/districts at boot (main.js), off the same rows the engine
// resolves districtFor() against, so a district authored in the Studio appears here
// with no code change at all. Empty until that lands: every read site already
// guards with `?.` or a default, because a tile can carry a func the legend has
// never heard of — which is precisely how the drift stayed invisible.
export const FUNC_LEGEND = {};

/** Fill the legend from the server's registry. Mutates in place — importers hold
 *  the binding, and reassigning would leave every one of them on the empty object. */
export function setDistrictLegend(districts) {
  for (const k of Object.keys(FUNC_LEGEND)) delete FUNC_LEGEND[k];
  for (const [key, d] of Object.entries(districts || {})) {
    FUNC_LEGEND[key] = { label: d.label || d.name || key, color: d.color };
  }
  return Object.keys(FUNC_LEGEND).length;
}

// Street tint: a connector inherits meaning from the tiles it joins. In zone/interior
// view it takes the *higher* danger of its two endpoints (so any street touching a
// lethal tile glows red); in regional view it blends the two land-use colours.
const DANGER_RANK = { safe: 0, low: 1, medium: 2, high: 3, lethal: 4 };
const DANGER_STREET = [
  'rgba(120,140,165,0.40)', // safe — neutral steel
  'rgba(205,180,70,0.44)',  // low
  'rgba(220,140,55,0.48)',  // medium
  'rgba(212,70,60,0.52)',   // high
  'rgba(214,55,55,0.64)',   // lethal
];
function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
// A street with nothing to inherit from: the legend has not arrived yet, or both
// its ends carry a district this build has never heard of. Neutral steel, the same
// grey the safe-danger street already uses — not a district colour, because
// pretending to be one would be a colour no author chose.
const STREET_UNKNOWN = '#788ca5';
function streetColor(a, b, regional) {
  if (regional) {
    const [r1, g1, b1] = hexToRgb(FUNC_LEGEND[a.func]?.color || FUNC_LEGEND.residential?.color || STREET_UNKNOWN);
    const [r2, g2, b2] = hexToRgb(FUNC_LEGEND[b.func]?.color || FUNC_LEGEND.residential?.color || STREET_UNKNOWN);
    return `rgba(${(r1 + r2) >> 1},${(g1 + g2) >> 1},${(b1 + b2) >> 1},0.5)`;
  }
  return DANGER_STREET[Math.max(DANGER_RANK[a.danger] ?? 0, DANGER_RANK[b.danger] ?? 0)];
}

// Landmark icons — icon glyph must match the server POI_ICON in movement.js.
export const POI_LEGEND = {
  aa:      { icon: '⌖', label: 'AA battery' },
  airport: { icon: '✈', label: 'Airport / airfield' },
  police:  { icon: '★', label: 'Police station' },
  power:   { icon: '⚡', label: 'Power plant' },
  club:    { icon: '♥', label: 'Strip club' },
  nightclub: { icon: '🎶', label: 'Nightclub' },
  hotel:   { icon: '🏨', label: 'Hotel' },
  bar:     { icon: '🍺', label: 'Bar' },
  vendor:  { icon: '$', label: 'Vendor / shop' },
  home:    { icon: '⌂', label: 'Apartments / housing' },
  stairs:  { icon: '⇕', label: 'Stairs (up/down)' },
};

// Building-type → overlay glyph for the map's "icons" mode. One entry per
// building_type the content pipeline emits (server BUILDING_TYPE_ICON in world.js);
// synonyms collapse the way the rooftop-SVG table does (store/grocery → shop). Keep
// this in sync when a new building_type is added so it reads on the map, not just
// from the air. Unlisted types fall back to _default.
export const BUILDING_ICON = {
  residential: '⌂', apartment: '🏢',
  shop: '$', store: '$', grocery: '$',
  bar: '🍺', club: '♥', nightclub: '🎶', boutique: '👗', police: '★',
  corporate_office: '💼', hotel: '🏨', power: '⚡',
  hangar: '✈', studio: '🎬', clinic: '✚', diner: '🍔',
  // The Yards — semi-industrial freight district.
  warehouse: '📦', container_yard: '▤', fuel_yard: '⛽', cold_storage: '❄', fabrication: '⚙', wharf: '⚓', freight_office: '📋', freight_forwarder: '🚚',
  _default: '▢',
};

// Tileable terrain styling (server `terrain` field). Roads recolour to grey asphalt
// with yellow lane markings; water/grass render as a seamless coloured expanse with a
// connecting texture from the .mm-<terrain> / .map-<terrain> CSS classes.
const TERRAIN = new Set(['road', 'dirt_road', 'water', 'grass', 'park', 'asphalt', 'concrete', 'dirt', 'sand', 'gravel', 'dock', 'scrub', 'redrock', 'ash', 'marsh']);
// (Every painted surface keeps whatever stands on it — see the terrain branch in the
// cell loop. There is no longer a glyph-keeping subset: blanking icons and building
// overlays on painted ground was the bug that hid the Fisherman Statue.)
// TERRAIN_FILL is gone. Every colour on this map now arrives already resolved in
// node.spec, built by scripts/content/derive.mjs from content/map/terrain.json.
// There used to be three copies of this table — here, the tablet, and the dev
// panel — and they had drifted: redrock was #6f3524 in the game and #9e4a30 in
// the editor, so for 2,996 tiles the map an author painted was not the map a
// player saw. One palette, resolved once, at build time.

// The terrain CLASS for styling hooks (.mm-<terrain> textures) — a name, not a
// colour. spec.minimap_class is what derive resolved; the payload's node.terrain
// stays as the fallback for a transient zone, which has no derived row.
function terrainOf(node) {
  const t = node?.spec?.minimap_class || node?.terrain || null;
  return t && TERRAIN.has(t) ? t : null;
}

// Cosmetic open water — Coldwater Bay. The overworld (`map_world`) has empty grid
// cells in its north-west and north-east corners where the bay lies; rather than
// author zones for open water we tint those VOID cells as water on the minimap + the
// tablet map. Bounds are absolute world grid coords (north = smaller grid_y). Only
// EMPTY cells are ever filled, so land tiles overlapping a band stay untouched.
const WATER_VOID_REGIONS = [
  (x, y) => x <= 890 && y <= 901, // north-west bay
  (x, y) => x >= 927 && y <= 908, // north-east bay
];
export function isWorldWaterVoid(mapId, x, y) {
  if (mapId !== 'map_world' || x == null || y == null) return false;
  return WATER_VOID_REGIONS.some(fn => fn(x, y));
}
// Absolute [x,y] for an overworld tile from its id (zone_district_<x>_<y>), or null.
// Lets the tablet map recover absolute world coords from its center-relative tiles.
const DISTRICT_ID_RE = /^zone_district_(\d+)_(\d+)$/;
export function districtCoord(id) {
  const m = DISTRICT_ID_RE.exec(id || '');
  return m ? [+m[1], +m[2]] : null;
}
// Match the authored Coldwater water zones' bg_color (dark teal) so the cosmetic bay
// reads as one body with the real water tiles, not a second brighter blue.
export const WATER_VOID_FILL = '#1d3b52';
// Small entrance arrow overlaid on a building tile, pointing to the edge the door
// faces (server `entrance` field). A CSS triangle (no glyph) via .<pfx>-ent-<dir>;
// pfx is 'mm' (sidebar) or 'map' (full popup).
const ENTRANCE_DIRS = new Set(['north', 'south', 'east', 'west']);
function entranceMark(dir, pfx) {
  return ENTRANCE_DIRS.has(dir) ? `<span class="${pfx}-entrance ${pfx}-ent-${dir}"></span>` : '';
}

// Interior exit arrows: the same amber triangles as the entrance arrow, one per
// cardinal direction that leads out of the building (server `exit_dirs`).
function exitMarks(dirs, pfx) {
  return Array.isArray(dirs) ? dirs.map(d => entranceMark(d, pfx)).join('') : '';
}

// The tile-label overlay mode (none | labels | icons) is persisted so it survives
// reloads; the sidebar minimap reads this one saved value.
const MAP_OVERLAY_KEY = 'map_overlay';
let _savedOverlay = 'none';
try { _savedOverlay = localStorage.getItem(MAP_OVERLAY_KEY) || 'icons'; } catch {}
// Shared map state that outlives the retired full-screen popup: the overlay label
// mode (read by the sidebar minimap) and the active GPS route — tracePath/traceDirs,
// set by the `gps` command or the tablet map's "Route here", walked by auto-walk, and
// mirrored onto both the sidebar minimap and the tablet map.
const mapState = { avenueOverlay: _savedOverlay, tracePath: null, traceDirs: null };

function twoLetterAbbrev(name) {
  return ((name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '??');
}
// Avenue-View label: initials of the significant words ("Franchise Strip" → "FS",
// "Muster Yard" → "MY"); a single word falls back to its first two letters. Drops
// leading articles so "The Marquee" → "MA", not "TM".
function streetAbbrev(name) {
  const words = String(name || '').split(/\s+/).filter(w => w && !/^(the|of|and|at|a|an)$/i.test(w));
  if (!words.length) return twoLetterAbbrev(name);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

// Shortest walkable route between two tiles over the currently-shown tiles, stepping
// only through orthogonal grid-adjacent exits (so every leg can be drawn as a road
// band). Returns an ordered array of tile ids from `fromId` to `toId`, or null if
// there's no drawable path on this map level (e.g. only reachable via up/down/in/out).
function traceRoute(fromId, toId, byId) {
  if (!fromId || !toId || fromId === toId) return null;
  const from = byId.get(fromId), to = byId.get(toId);
  if (!from || !to || from.x == null || to.x == null) return null;
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toId) break;
    const t = byId.get(id);
    for (const targetId of Object.values(t?.exits || {})) {
      if (prev.has(targetId)) continue;
      const n = byId.get(targetId);
      if (!n || n.x == null) continue;
      const dx = Math.abs(n.x - t.x), dy = Math.abs(n.y - t.y);
      if (dx + dy !== 1) continue; // orthogonal unit step only (drawable)
      prev.set(targetId, id);
      queue.push(targetId);
    }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  for (let id = toId; id != null; id = prev.get(id)) path.push(id);
  return path.reverse();
}

// The still-relevant slice of the stored route, given where you are now: trimmed to
// start at the current tile (so tiles already walked drop off), or the whole route if
// you've stepped off it. Returns null once you've arrived (nothing left ahead) and
// consumes the stored route at that point so it doesn't linger behind you.
function effectiveTracePath(currentId) {
  const p = mapState.tracePath;
  if (!p || !p.length) return null;
  const i = p.indexOf(currentId);
  if (i === -1) return p;                 // stepped off-route — still show the corridor
  const rest = p.slice(i);
  if (rest.length <= 1) { mapState.tracePath = null; mapState.traceDirs = null; return null; } // arrived
  return rest;
}

// ── Shared with the Tablet Map app (panels/tablet-os.js) ─────────────────────
// The tablet renders its own grid from the same `map` payload, but leans on the
// popup's route machinery so there's one source of truth for GPS routes.
// Plot the shortest drawable route between two tiles over an arbitrary tile list.
export function routeBetween(fromId, toId, tiles) {
  const byId = new Map((tiles || []).map(t => [t.id, t]));
  return traceRoute(fromId, toId, byId);
}
// The currently-plotted GPS/route path (ordered tile ids), or null — so the
// tablet map can highlight the same route the sidebar minimap shows.
export function getTracePath() { return mapState.tracePath; }


// Server-driven route (the `gps` command): the path can span the whole map, not
// just whatever's currently on screen, so it's set directly rather than via
// traceRoute's on-screen BFS. Mirrors onto the sidebar minimap immediately; the
// tablet map, if open, picks the route up on its next render/refresh.
export function setGpsRoute(path, dirs = null) {
  mapState.tracePath = (path && path.length > 1) ? path : null;
  // Per-hop directions from the server (aligned to the full path), so the walker
  // can follow second same-direction exits it couldn't resolve on its own. Cleared
  // with the path; absent for client-side map-click routes (walker falls back to
  // reading the direction off the node's exits).
  mapState.traceDirs = mapState.tracePath ? dirs : null;
  if (!mapState.tracePath && isAutoWalking()) stopAutoWalk('Auto-walk stopped — route cleared.');
  if (_lastMinimapNodes) renderMinimap(_lastMinimapNodes);
}
