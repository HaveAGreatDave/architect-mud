// PAGE CHROME — big screen, and the sidebar switch beside it.
//
// Two controls that are page-level rather than seat-level, which is why they live together and away
// from the seats: a seat's ⊟ and ⛶ are body classes the SEAT owns and clears, and these two belong
// to nobody in particular. Big screen is the whole of the page at once; the sidebar switch is the
// one piece of it worth taking on its own.
//
// BIG SCREEN — the whole window, and nothing on it but the world.
//
// Every seat in this renderer already has a two-rung ladder in its own corner: ⊟ folds the
// scrollback away, ⛶ folds the command box with it. Both of those grow the pane INSIDE the page,
// and the page is still there — a header, two hundred and forty pixels of sidebar panels, a border
// down one edge, a d-pad on a phone. This is the third rung and it leaves the page: the header, the
// sidebar, the log and the input go, the seat fills the viewport, and every readout the seat hangs
// on its own glass goes with them. Esc is the way back.
//
// ⚠ THIS FILE OWNS THE PAGE AND EACH SEAT OWNS ITS OWN GLASS. The layout half is in styles.css
// beside the other immersive layouts, because #header, #sidebar and #area-pane belong to no seat in
// particular; the "what stays in the shot" half is one rule in each seat's own stylesheet, keyed on
// `body.bigscreen`, sitting directly beside the `-freecam` rule that already answers the same
// question for a detached camera. That is the split `freecam-idle` already uses and it is here for
// the reason freecam.js gives: the stylesheets spell the word out, so grepping for it finds the
// rules rather than one line of prose about them.
//
// ⚠ THE DOM GOES AND THE RENDER STAYS. A cab's dashboard, a cockpit's coaming and the A-pillars
// down each edge are painted INTO the world canvas by the renderer — they are the vehicle you are
// sitting in rather than chrome laid over it — so they are still there. What goes is everything the
// client drew on top of the picture in HTML. The way to a clean shot of the city is the one it
// always was: take the camera off its mount.
//
// ⚠ AND THE NAME IS NOT 'cinema', WHICH IS WHAT THIS WAS CALLED FOR AN HOUR. 'cinema' is a
// building_type in Coldwater and the word is all over windshield.js — a palette row, an arm, a
// signage entry, a trade word — so a body class called that is a class nobody can grep for. Same
// trap THOMAS and SIREN are written up for in CLAUDE.md, caught before it shipped this time.

import { activeModal } from '../a11y-focus.js';

const ON = 'bigscreen';
const IDLE = 'bigscreen-idle';

// A shade longer than the free camera's 2400. The one thing left on this screen is the way off it,
// and somebody who has just pressed the button deserves to read it before it goes.
const IDLE_MS = 3200;
// Every way a player can say they are still here. Capture-phase and passive, exactly as
// bindFreeCamIdle does it: this only ever reads the clock, so nothing below can be starved of an
// event and nothing here can swallow one.
const WAKERS = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup'];

let on = false;
let ownsFullscreen = false;          // did WE ask the browser for it? — see dropFullscreen
let hintEl = null;
let idleTimer = 0, lastInput = 0;

// The buttons that put you in here, so their lit state can follow the mode however it is left.
// A WeakSet would not do: this iterates.
const buttons = new Set();

export function isBigScreen() { return on; }

// ── THE BROWSER'S OWN FULLSCREEN ─────────────────────────────────────────────
//
// Asked for, never depended on. The class is the source of truth and the mode works without this;
// what the real thing buys is the browser's own chrome — tab strip, address bar, taskbar — which is
// the last furniture left once the page's is gone, and on a laptop it is a real slice of the
// screen. It is refused in an iframe with no allow attribute and in the desktop app's browser pane,
// both of which land in the catch and change nothing.
//
// ⚠ AND ESC IS THEN THE BROWSER'S KEY BEFORE IT IS OURS. In real fullscreen the browser takes the
// keypress to leave fullscreen and this file may never see it at all — so 'fullscreenchange' is a
// way OUT of big screen rather than just a thing that happens to it. Without that the player
// presses Esc, the window shrinks back into the page, and the page is still wearing no header and
// no sidebar.
function askFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = req.call(el);
    // Only OURS once it has actually been granted. Claiming it on the call means a refusal leaves
    // this file believing it holds a fullscreen it never got, and the next exit calls
    // exitFullscreen on somebody else's.
    // ⚠ AND ONLY IF THE MODE IS STILL ON WHEN IT RESOLVES. The request is asynchronous and Esc is
    // not: leave inside the same beat and the grant lands on a mode that has already exited, which
    // leaves a claim on a fullscreen nobody is in for the next enter to try to release.
    if (p && p.then) p.then(() => { if (on) ownsFullscreen = true; }, () => {});
    else ownsFullscreen = true;
  } catch { /* refused — the class does the work on its own */ }
}

function dropFullscreen() {
  if (!ownsFullscreen) return;
  ownsFullscreen = false;
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (!ex || !(document.fullscreenElement || document.webkitFullscreenElement)) return;
  try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* already gone */ }
}

function onFullscreenChange() {
  if (!on || !ownsFullscreen) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  ownsFullscreen = false;   // the browser took it back; there is nothing left to exit
  exitBigScreen();
}

// ── ESC ──────────────────────────────────────────────────────────────────────
//
// ⚠ CAPTURE PHASE AND STOPPED, because the helm binds Esc on the window to LEAVE THE HELM and the
// cab and the cockpit each have their own keys on the same window. A bubble listener here would
// fire after those, and the first press would both drop you out of big screen and shut the
// wheelhouse. Big screen is the outermost thing on the page, so while it is on it takes the key.
//
// ⚠ EXCEPT FOR A MODAL, WHICH IS THE ONE THING ABOVE IT. A confirm window opened over the shot is
// the innermost layer and gets the key first — the layered-Escape rule cardpack.js writes up — and
// 'activeModal()' is already exported from a11y-focus for exactly this question.
//
// ⚠ AND A TEST MUST DISPATCH THE KEY AT AN ELEMENT, NOT AT THE WINDOW. A real keydown is targeted
// at document.activeElement, so window's capture listener runs first and the stop keeps it off the
// window's bubble listeners. An event dispatched ON the window is AT_TARGET there, where capture
// and bubble listeners run together in REGISTRATION order and the stop comes too late — which
// reads exactly like the layering not working (Esc leaving big screen and shutting the wheelhouse
// in one press). Measured both ways; it was the harness that was wrong, not the rule.
function onKey(e) {
  if (!on || e.key !== 'Escape' || e.defaultPrevented) return;
  if (activeModal()) return;
  e.preventDefault();
  e.stopPropagation();
  exitBigScreen();
}

// ── THE ONE THING LEFT ON THE GLASS ──────────────────────────────────────────
//
// A mode with no chrome at all and no way out written down is a mode people get stuck in, so the
// same answer freecam reached: one line, on a timer, back on the first thing the player does.
//
// ⚠ IT IS A BUTTON RATHER THAN A LABEL, AND THAT IS THE PHONE. Esc does not exist on a touch device
// and this mode has just hidden every control that did — so the hint is the way out as well as the
// note about it, and a tap wakes it (pointerdown is a waker) and a second tap presses it. The video
// player's own convention, and it costs a button element.
function ensureHint() {
  if (hintEl && hintEl.isConnected) return hintEl;
  hintEl = document.createElement('button');
  hintEl.type = 'button';
  hintEl.id = 'bigscreen-hint';
  hintEl.addEventListener('click', () => exitBigScreen());
  document.body.appendChild(hintEl);
  return hintEl;
}

function hintText() {
  // 'hover: none' is the honest test for "there is no Esc key on this thing", where a width query
  // would call a small window a phone and a touchscreen laptop a desktop.
  const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
  return touch ? '✕  leave big screen' : 'Esc  leaves big screen';
}

// ── THE IDLE TIMER ───────────────────────────────────────────────────────────
// ⚠ ONE TIMER, RE-ARMED OFF A STAMP, rather than torn down and rebuilt on every event —
// bindFreeCamIdle's own note, and for the same reason: under a pointer lock 'pointermove' arrives
// at the mouse's polling rate and this listener is on the window for as long as the mode is on.
function idleTick() {
  idleTimer = 0;
  if (!on) return;
  const left = IDLE_MS - (performance.now() - lastInput);
  if (left > 16) { idleTimer = setTimeout(idleTick, left); return; }   // woken since it was armed
  document.body.classList.add(IDLE);
}

function wake() {
  lastInput = performance.now();
  document.body.classList.remove(IDLE);
  if (on && !idleTimer) idleTimer = setTimeout(idleTick, IDLE_MS);
}

const onInput = () => { if (on) wake(); };
const IDLE_OPTS = { passive: true, capture: true };

function syncButtons() {
  for (const b of [...buttons]) {
    if (!b.isConnected) { buttons.delete(b); continue; }
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

export function enterBigScreen() {
  if (on) return;
  on = true;
  document.body.classList.add(ON);
  ensureStyles();
  ensureHint().textContent = hintText();
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  for (const ev of WAKERS) window.addEventListener(ev, onInput, IDLE_OPTS);
  wake();
  askFullscreen();
  syncButtons();
  // The pane has just changed size by a lot. Every windshield canvas sizes itself off its own CSS
  // box once a frame and needs nothing — but the widgets beside them (the helm wheel, a minimap)
  // measure once and listen for this.
  window.dispatchEvent(new Event('resize'));
}

export function exitBigScreen() {
  if (!on) return;
  on = false;
  document.body.classList.remove(ON, IDLE);
  window.removeEventListener('keydown', onKey, true);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  for (const ev of WAKERS) window.removeEventListener(ev, onInput, IDLE_OPTS);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = 0;
  hintEl?.remove();
  dropFullscreen();
  syncButtons();
  window.dispatchEvent(new Event('resize'));
}

export function toggleBigScreen() { if (on) exitBigScreen(); else enterBigScreen(); }

// What a seat calls on its own button. The lit state is kept here rather than by the seat, because
// the mode can also be left by Esc, by the browser's own fullscreen key and by the seat closing —
// three things a button that lit itself on click would be wrong about.
export function bindBigScreenButton(btn) {
  if (!btn) return;
  buttons.add(btn);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('on', on);
  btn.addEventListener('click', (e) => { e.preventDefault(); toggleBigScreen(); });
}

// The glyph and the tooltip, in one place, so five corners cannot disagree about what the control
// is called. ⤢ rather than a second ⛶: this is the rung above fullscreen and the two sit next to
// each other in the same row.
export const BIGSCREEN_GLYPH = '⤢';
export const BIGSCREEN_TITLE = 'big screen — the whole screen, no panels, no HUD (Esc leaves)';

// ── THE SIDEBAR SWITCH ───────────────────────────────────────────────────────
//
// Two hundred and forty pixels of status panels down one side of the window. The ⊟/⛶ ladder is
// about the COLUMN — it folds the log and the command box, which are stacked under the pane — and
// nothing in it has ever touched the sidebar, so a seat at ⛶ is still looking through a picture
// a fifth narrower than the window. This is that fifth, and it is a separate control rather than a
// fourth rung precisely because it is a separate axis: the vertical ladder and the horizontal one
// compose, and a player who wants a wide picture with the log still under it can have one.
//
// ⚠ IT IS CLEARED WHEN THE SEAT CLOSES, for the reason `exitBigScreen` is. Nothing else in the
// client can bring the sidebar back — there is no switch for it in the base UI — so a player who
// shut a seat with it hidden would be left looking at a game with its panels gone and nothing on
// screen to say why, which is the same stranding the gate already watches for one rung up.
const NOSIDE = 'nosidebar';

export function isSidebarHidden() { return document.body.classList.contains(NOSIDE); }

export function setSidebarHidden(hide) {
  const want = !!hide;
  if (want === isSidebarHidden()) return want;
  document.body.classList.toggle(NOSIDE, want);
  syncSidebarButtons();
  // The pane just changed width by 240px. Same reason the big-screen pair fire it: every windshield
  // canvas sizes itself off its own CSS box once a frame, and the widgets beside them do not.
  window.dispatchEvent(new Event('resize'));
  return want;
}

export function toggleSidebar() { return setSidebarHidden(!isSidebarHidden()); }

const sideButtons = new Set();

function syncSidebarButtons() {
  const hid = isSidebarHidden();
  for (const b of [...sideButtons]) {
    if (!b.isConnected) { sideButtons.delete(b); continue; }
    b.classList.toggle('on', hid);
    b.setAttribute('aria-pressed', hid ? 'true' : 'false');
  }
}

export function bindSidebarButton(btn) {
  if (!btn) return;
  sideButtons.add(btn);
  btn.setAttribute('aria-pressed', isSidebarHidden() ? 'true' : 'false');
  btn.classList.toggle('on', isSidebarHidden());
  btn.addEventListener('click', (e) => { e.preventDefault(); toggleSidebar(); });
}

export const SIDEBAR_GLYPH = '◧';
export const SIDEBAR_TITLE = 'hide the sidebar panels — a wider picture';

function ensureStyles() {
  const el = document.getElementById('bigscreen-styles') || document.createElement('style');
  el.id = 'bigscreen-styles';
  // Rewritten rather than early-returned, the idiom the seats use: a stale block left by an older
  // build would pin the old layout under this module's fresh JS.
  // ⚠ ONLY THE HINT LIVES HERE. The page layout is in styles.css with the other immersive modes and
  // the per-seat stripping is in each seat's own sheet — see the header.
  el.textContent = `
    /* ⚠ THE CORNER, NOT THE MIDDLE, and that is what a screenshot said rather than a rect census.
       The three seats put their freecam hint at bottom centre and get away with it because a
       detached camera has already hidden the vehicle; here the vehicle is still drawn, and bottom
       centre in a truck is the steering wheel, in an aeroplane the yoke and on the Echelon the
       telegraph. The bottom right is the one part of every seat that big screen has just emptied. */
    #bigscreen-hint{ position:fixed; right:14px; bottom:14px; z-index:9400;
      font:11px/1 system-ui,sans-serif; letter-spacing:.7px; color:#dfe6ef;
      background:rgba(8,11,15,.62); border:1px solid rgba(255,255,255,.16); border-radius:11px;
      padding:7px 14px; cursor:pointer; white-space:nowrap; transition:opacity .35s linear; }
    #bigscreen-hint:hover{ border-color:rgba(255,255,255,.42); }
    /* Opacity rather than display: this is a look and it must not move the layout under a shot
       being composed — with pointer-events, so a faded control cannot be clicked by a cursor that
       cannot see it. */
    body.bigscreen-idle #bigscreen-hint{ opacity:0; pointer-events:none; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
