// SEAT KEYS — who the keyboard belongs to: the 3-D seat, or the command bar.
//
// Every 3-D seat in this client reads its controls off the WINDOW and steps aside for a focused
// text field. That is the right rule and it is also how a driver ends up typing "aaazzzxc" into
// the chat box: the command bar is three inches under the windscreen, it is where every other part
// of the game wants focus, and nothing about a truck, an aeroplane or a boat ever asked for it
// back. So a seat TAKES the keyboard when it opens and again on any press inside its own pane, and
// says on the glass which of the two has it. Nothing is ever trapped — clicking the command bar
// gives it straight back, because a driver who wants to say something to the room must be able to.
//
// ⚠ THIS IS NOT NEW BEHAVIOUR. IT IS THE CAB'S, LIFTED, BECAUSE THREE SEATS HAD IT AND TWO DID
// NOT. cab-view.js (`grabKeys`), cockpit.js's flight sim (`focusSim`) and its charter cabin
// (`focusPax`) each carried their own copy of the same dozen lines; free look and the wheelhouse
// carried none, so in those two the command bar kept the keyboard for the whole session and
// clicking the picture did nothing about it. Two of the three copies had no readout either, so the
// one thing that tells you which surface has the keys existed only in the truck.
//
// ⚠ AND THE COPIES WERE BOUND ON THE BUBBLE, WHICH THE FREE CAMERA SILENTLY BEATS. Each bound its
// own handler on its pane and let the press bubble up to it — and `bindFreeCamPointer` binds
// `pointerdown` on the CAPTURE phase of the glass inside that pane and calls
// `stopImmediatePropagation` on everything it consumes (deliberately: the cab has a second handler
// on the same node whose middle-button branch is the chase orbit). Capture on a descendant runs
// before bubble on its ancestor, so with the camera off its mount the press never reached the
// pane and clicking the picture stopped giving the keyboard back — in the one mode where the
// keyboard is the whole control scheme. This binds on the DOCUMENT, in capture, which runs before
// any of it and cannot be starved by a seat stopping its own event.
//
// ⚠ THE TAG IS THE SEAT'S OWN ELEMENT WHEN IT HAS ONE. The cab's chip is placed against the shelf
// (`--cab-shelf`) and hides its quiet half on a touch screen, which is a judgement about the cab
// and not about seats in general — so a seat may hand its own element in and this only ever paints
// it. A seat that hands none gets the default chip, inside its own `.ws-wrap`, which is the one
// anchor `windshieldHTML` guarantees every seat has.

import { activeModal } from '../a11y-focus.js';

const TAG_ID = 'seat-keys-tag';

// The pane the open seat owns, and what to call it. One at a time: there has never been a moment
// in this client with two seats mounted, and a second claim replaces the first rather than
// stacking, so a seat that forgets to end its own claim cannot leave a dead pane holding the keys.
let pane = null;
let label = 'SEAT';
let ownTag = null;      // the element handed in by the seat, or null when this file made one
let installed = false;

// ⚠ NOT EVERY `INPUT` IS SOMEWHERE YOU TYPE. The private copies tested `/^(INPUT|TEXTAREA)$/`,
// which counts a range slider — and the flight sim's ⚙ tune panel is two dozen of them, so
// touching a render slider read as "the command bar has the keyboard" and the chip went amber over
// a sim that was still taking every key. The arrow keys on a slider are the slider's; they are not
// text, and this is the question of whether a keypress is a letter somebody is writing.
const NOT_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);
function typingFocus(el = document.activeElement) {
  if (!el) return null;
  if (el.isContentEditable) return el;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return el;
  if (tag !== 'INPUT') return null;
  return NOT_TEXT.has((el.type || 'text').toLowerCase()) ? null : el;
}

// …and the same question asked of a click rather than of the caret: is this press landing ON
// somewhere you type? Walked by `parentNode` rather than by `closest`, because the label inside a
// field's wrapper is as much a click into it as the field itself.
function fieldUnder(el) {
  for (let n = el; n; n = n.parentNode) { const f = typingFocus(n); if (f) return f; }
  return null;
}

// A pane that has left the document is a seat that closed without saying so. Cheap to ask and it
// makes every answer below true of the page as it is rather than of the page as it was.
function live() {
  if (pane && !pane.isConnected) { pane = null; ownTag = null; }
  return pane;
}

// ── THE ONE QUESTION EVERYTHING ELSE ASKS ────────────────────────────────────
//
// True exactly when the next keypress will reach the seat: a seat is mounted and the caret is not
// in something you type into. That is the same test every seat's own key handler already makes, so
// this cannot drift from what actually happens to a key — which is what makes it the right thing
// for input.js to hang its auto-focus on. Focus sitting on the body (somebody clicked the log)
// still counts as the seat's: the seats listen on the window, and so it is.
export function seatHoldsKeyboard() { return !!live() && !typingFocus(); }

// Take the keyboard for the seat. Returns whether it ended up there.
//
// ⚠ A MODAL OUTRANKS IT, the layered rule bigscreen.js follows for Escape: a confirm window over
// the picture is the innermost layer, its field is where the player is typing, and a seat that
// blurred it would make the dialog unusable while looking like nothing happened.
export function grabSeatKeys() {
  const p = live();
  if (!p) return false;
  if (activeModal()) { paintSeatKeys(); return false; }
  try {
    typingFocus()?.blur();
    if (!p.contains(document.activeElement)) p.focus({ preventScroll: true });
  } catch { /* a pane mid-teardown is not a reason to throw out of a pointerdown */ }
  paintSeatKeys();
  return true;
}

// A seat opening or closing is news to more than the seat: the location d-pad has a WASD walk
// mode that binds W/A/S/D on the window, and while a seat is up those letters are steering
// something. The keydown guard makes it a no-op on its own; this is so the BUTTON says so, rather
// than sitting armed over keys it is no longer getting. One event, from the two functions that
// are already the only way the claim changes, so a listener cannot drift from the truth.
function announce() {
  try { window.dispatchEvent(new CustomEvent("seat:keyboard", { detail: { seated: !!live() } })); }
  catch { /* a dispatch is never a reason to throw out of a seat mounting */ }
}

// A seat mounting: hand over the pane the player presses on and a word for it. `tag` is the seat's
// own readout element if it has one.
export function claimSeatKeyboard(el, opts = {}) {
  if (!el) return;
  install();
  pane = el;
  label = String(opts.label || 'SEAT').toUpperCase().slice(0, 12);
  ownTag = opts.tag || null;
  // A handed-in chip is a control as well as a readout, exactly as the default one is — the cab's
  // is a <button> and its own note says it stays one so the keyboard can reach it. The pointerdown
  // path below covers a mouse whatever the chip's pointer-events say; this is Enter and Space.
  if (ownTag && !ownTag._seatKeys) { ownTag._seatKeys = true; ownTag.addEventListener('click', grabSeatKeys); }
  // Focusable, but never in the tab order: the pane is a place for the keyboard to LIVE, not a
  // stop on the way to the command bar.
  try { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; } catch { /* a detached node */ }
  grabSeatKeys();
  announce();
}

// …and coming down. Takes the pane so a seat closing late cannot end somebody else's claim.
export function endSeatKeyboard(el) {
  if (el && pane && el !== pane) return;
  pane = null;
  ownTag = null;
  document.getElementById(TAG_ID)?.remove();
  announce();
}

// ── THE READOUT ──────────────────────────────────────────────────────────────
//
// It says which surface has the keys, and it is the way back as well as the note about it — the
// same shape big screen's own hint takes, and for the same reason: a state you can get into by
// clicking somewhere needs something on screen telling you how to get out of it.
export function paintSeatKeys() {
  const p = live();
  const away = !!p && !!typingFocus();
  const el = ownTag && ownTag.isConnected ? ownTag : defaultTag(p);
  if (!el) return;
  el.textContent = away ? '⌨ KEYS: TEXT BAR' : `⌨ KEYS: ${label}`;
  el.classList.toggle('away', away);
}

// The chip for a seat that brought none. Inside `.ws-wrap`, because that is the one element
// `windshieldHTML` puts in every seat and so the one anchor that cannot be wrong about where the
// picture is; the seat's own chrome rows sit outside it and are already spoken for.
function defaultTag(p) {
  if (!p) { document.getElementById(TAG_ID)?.remove(); return null; }
  const host = p.querySelector('.ws-wrap') || p;
  let el = document.getElementById(TAG_ID);
  if (el && el.parentNode === host) return el;
  el?.remove();
  el = document.createElement('button');
  el.type = 'button';
  el.id = TAG_ID;
  el.title = 'click the picture to give the keyboard back to this view';
  el.addEventListener('click', grabSeatKeys);
  ensureStyles();
  host.appendChild(el);
  return el;
}

// ── WIRING ───────────────────────────────────────────────────────────────────
function onDown(e) {
  const p = live();
  if (!p) return;
  // ⚠ A TEXT FIELD INSIDE THE SEAT IS STILL A TEXT FIELD. Taking the keyboard on ANY press inside
  // the pane is right for a picture and catastrophic for a box somebody is clicking into to type
  // in: the grab blurs it on the way down, so the field takes focus and loses it in the same
  // gesture and the seat looks like it is refusing to be typed in. Nothing in a seat has one
  // today, which is exactly why this is written down rather than left to be discovered.
  if (fieldUnder(e.target)) { setTimeout(paintSeatKeys, 0); return; }
  if (p.contains(e.target)) grabSeatKeys();
  // A press anywhere else has not moved focus yet — that is the browser's default and it runs
  // after this. So the readout is repainted on the far side of it rather than from here, where it
  // would describe the state the click is about to leave.
  else setTimeout(paintSeatKeys, 0);
}

function install() {
  if (installed) return;
  installed = true;
  // ⚠ CAPTURE, ON THE DOCUMENT — see the header. A seat's own glass stops this event on its way
  // down; the document sees it first and nothing downstream can take that away.
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('focusin', paintSeatKeys, true);
  // `focusout` fires BEFORE the new focus lands, and a blur with nothing to follow it fires only
  // this — so the repaint is deferred and reads where the caret actually ended up.
  document.addEventListener('focusout', () => setTimeout(paintSeatKeys, 0), true);
}

function ensureStyles() {
  const el = document.getElementById('seat-keys-styles') || document.createElement('style');
  el.id = 'seat-keys-styles';
  // Rewritten rather than early-returned, the idiom every panel here uses: a stale block left by an
  // older build would pin the old layout under this module's fresh JS.
  //
  // ⚠ THE QUIET HALF IS NOT DRAWN AT ALL. The cab earns its steady '⌨ KEYS: CAB' chip because a
  // truck has a shelf of chrome to sit it in; every other seat this reaches is a picture with a
  // corner row over it, and a badge saying that nothing is wrong is a badge in the shot. What is
  // worth a chip is the state somebody has to be told about, which is the keyboard having gone.
  //
  // ⚠ BOTTOM LEFT, which is the one corner of a windshield nothing else is in: the label is top
  // left, every seat's chrome row is top right, big screen's own hint is bottom right, and the
  // free camera writes its line of help across the bottom CENTRE.
  el.textContent = `
    #${TAG_ID}{ display:none; position:absolute; left:10px; bottom:12px;
      z-index:7; font:600 9px/1 system-ui,sans-serif; letter-spacing:.10em; cursor:pointer;
      border-radius:4px; padding:5px 9px;
      border:1px solid #d8a24e; color:#f0c777; background:rgba(30,20,6,.85); }
    #${TAG_ID}.away{ display:block; }
    #${TAG_ID}:hover{ color:#fff2d8; border-color:#f0c777; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
