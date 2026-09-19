// MOUSE STICK — the windscreen as a control column, driven by MOVEMENT.
//
// Move the mouse and the column moves by the same amount, in the same direction, and STAYS THERE.
// That is the whole contract. There is no home position, nothing pulls toward centre, and the
// column is wherever your hand has put it.
//
// ⚠ AN EARLIER CUT MAPPED CURSOR POSITION ONTO DEFLECTION AND IT WAS THE WRONG SHAPE ENTIRELY.
// Absolute mapping sounds like a joystick — the middle of the glass is centre, the edges are full
// travel — and what it actually builds is a control with an invisible magnet in the middle of the
// screen: every movement back toward the centre of the glass un-does itself, so the stick is
// forever being dragged home by where your hand happens to be rather than by what you did with it.
// Reported as "I don't want it to force back the view". The fix is not a tuning value; a position
// map and a movement map are different controls, and this is the movement one.
//
// Everything that shaped the old version fell out with it. There is **no deadzone**, because a
// deadzone on an accumulated value is a dead band the column has to climb back through every time
// it passes centre. There is **no expo**, because a curve is a statement that far movements should
// count for more than near ones, and every movement here is a near one. And there is **no rate
// cap**, because a cap is a cap on how fast you may move the mouse.
//
// ⚠ AND IT NEEDS NO POINTER LOCK, which is the part that makes it work everywhere. A delta is
// `clientX - lastX` whether or not the cursor has been captured — the lock (MODE 2) only stops the
// cursor reaching the edge of the screen and the browser's own chrome. `featurePolicy.allowsFeature
// ('pointer-lock')` is FALSE in the Claude desktop browser pane, which is where this gets judged,
// so a control that needed the lock would be dead in the one place it has to be tried. MODE 1 is
// the default and asks for nothing.
//
// ⚠ AND RUNNING OUT OF DESK IS NOT THE PROBLEM HERE THAT IT IS FOR A LOOK CAMERA. freecam needs a
// rim push because a heading has no limit and the cursor does; a control surface saturates at full
// deflection, which is well inside one screen. Push into the edge at full travel and the column
// sits at full travel, which is what it would do anyway.

// ── THE KNOBS ────────────────────────────────────────────────────────────────
// Live-tunable from the cockpit's ⚙ panel, its own section. NOT in RENDER_TUNE: that object is
// shared with windshield.js and is about what the frame looks like, and a control scheme is not a
// render setting. Everything here takes effect on the next pointer event.
export const MOUSE_STICK = {
  // 0 the yoke pad alone, exactly what shipped and the A/B control · 1 the mouse, no pointer lock ·
  // 2 the same, under a pointer lock where the browser grants one. 1 and 2 are the SAME control:
  // the lock only decides whether the cursor can leave the glass, never how the column responds.
  mode: 1,
  // How far the mouse travels, in CSS pixels, for the column to go from centre to full deflection.
  // The one sensitivity number, and it applies identically to both axes — which is what "move it
  // in any direction and it moves the same" means.
  px: 300,
  // Return to centre, in deflection per second, while you are not moving the mouse. 0 is the
  // default and is the point of the whole file: the column holds where you left it. Above 0 it
  // behaves like a sprung stick and you have to keep pushing to hold a turn.
  ret: 0,
  // 0 is the yoke's own convention and matches the pad: the column is physically inverted, so
  // pulling the mouse toward you — DOWN the glass — pulls back and raises the nose. 1 flips it.
  pullUp: 0,
};

// The rows the cockpit's ⚙ panel renders. Shipped from here rather than written out beside the
// render sliders so the label and the range live next to the thing they describe.
export const STICK_TUNE = [
  ['mode', 'Mouse stick (0 off · 1 on · 2 lock)', 0, 2, 1],
  ['px', 'Pixels for full deflection', 60, 900, 10],
  ['ret', 'Return to centre (0 = holds)', 0, 8, 0.1],
  ['pullUp', 'Push forward to climb', 0, 1, 1],
];

// The key that takes the mouse and gives it back. A parameter at `createMouseStick` rather than a
// constant everyone reads, because the seats do not share a keyboard layout: this is free in the
// cockpit, and in the cab K cranks the engine. A seat picks its own or it collides with itself.
const STICK_KEY = 'k';

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
// Move `a` toward `b` by at most `m`, landing exactly on `b`. Only the optional return-to-centre
// uses it, and `x === 0` is how "the column is centred" is tested downstream, so an asymptote that
// never quite arrives is not good enough.
const approach = (a, b, m) => (Math.abs(b - a) <= m ? b : a + (b > a ? m : -m));

// ── THE COLUMN ───────────────────────────────────────────────────────────────
// State and arithmetic only: no DOM, no events, no clock of its own. `bindMouseStick` below is the
// wiring, and the split is what lets the whole state machine be driven from a node harness by
// calling its own API — the lesson from freecam, where the fake surface granted a lock the real one
// refuses and the refused path was never exercised by anything.
//
// `read` is how the column knows where the aircraft's controls already are. See setArmed.
export function createMouseStick(opts = {}) {
  const key = String(opts.key || STICK_KEY).toLowerCase();
  const read = typeof opts.read === 'function' ? opts.read : null;
  const armCbs = new Set();

  const st = {
    key,
    armed: false,
    // Set by the binder when the browser has actually granted a lock. Read rather than assumed:
    // mode 2 with a refused lock is mode 1, and the move handler asks this and never the mode.
    locked: false,
    // The deflection, ±1. There is no separate "raw" value any more — with no deadzone, no curve
    // and no rate cap there is nothing for a second number to mean.
    x: 0, y: 0,
    // Is a hand actually ON the column? Armed and centred is not — see the dive computer, which is
    // cancelled the moment a pilot touches the yoke and must not be cancelled merely by arming.
    get deflected() { return st.armed && (st.x !== 0 || st.y !== 0); },

    // ⚠ ARMING PICKS THE COLUMN UP WHERE THE AIRCRAFT LEFT IT, WHICH IS THE OTHER HALF OF "NOTHING
    // FORCES IT BACK". Zeroing on arm is the obvious thing to write and it is a jump: a pilot
    // holding a turn on the pad, or flying on trim, presses K and the controls snap to neutral.
    // `read` hands back the live input so taking the mouse changes nothing at all until the mouse
    // moves. With no reader the column starts where it already was, which is the same rule.
    setArmed(on) {
      on = !!on;
      // ⚠ MODE 0 CANNOT BE ARMED, and the guard belongs here rather than at the key. Every way in
      // — the key, the slider, a future button — goes through this one function, so the off
      // setting is provably the panel as it shipped: nothing writes the column, the cursor is
      // never hidden, and no lock is ever asked for. What it is not is the absence of a code path:
      // the binder's listeners are still attached and still return on the first line.
      if (on && MOUSE_STICK.mode === 0) return st.armed;
      if (on === st.armed) return st.armed;
      st.armed = on;
      // ⚠ AND WITH NO READER IT ZEROES, WHICH IS THE SAFE HALF OF THE SAME RULE. Keeping the old
      // value looks like the conservative choice and is the jump: while the column was stowed the
      // seat's own spring walked ITS input back to neutral, so resuming at the deflection we were
      // last holding puts the controls hard over the moment the mouse is taken. Zero is what the
      // seat is actually at whenever nobody can tell us otherwise.
      if (on) {
        const cur = read ? read() : null;
        st.x = cur ? clamp1(+cur[0] || 0) : 0;
        st.y = cur ? clamp1(+cur[1] || 0) : 0;
      }
      for (const cb of [...armCbs]) cb(on);
      return st.armed;
    },
    toggle() { return st.setArmed(!st.armed); },
    onArm(cb) { armCbs.add(cb); return () => armCbs.delete(cb); },

    // The whole control. `dx`/`dy` are pixels the mouse has moved since the last event — from
    // `clientX - lastX` unlocked, from `movementX` under a lock, and the two are the same number.
    //
    // ⚠ CLAMPED AS IT ACCUMULATES, never on the way out. Let it wind past 1 and the column stops
    // answering the mouse: after a long push you have to drag the whole overshoot back before
    // anything moves, which reads as the controls sticking. Clamping here means the moment you
    // reverse, it reverses.
    by(dx, dy) {
      if (!st.armed) return;
      const k = 1 / Math.max(10, MOUSE_STICK.px);
      const sy = MOUSE_STICK.pullUp ? -1 : 1;
      st.x = clamp1(st.x + dx * k);
      st.y = clamp1(st.y + dy * k * sy);
    },

    // Nothing to do unless somebody has asked for a sprung column. Deliberately not a place where
    // the deflection is post-processed: what the mouse did is what the aircraft gets.
    step(dt) {
      if (!st.armed || !(dt > 0)) return;
      const r = MOUSE_STICK.ret;
      if (r > 0) { st.x = approach(st.x, 0, r * dt); st.y = approach(st.y, 0, r * dt); }
    },

    // Returns true when the key was this one, so the seat's own handler can stop reading it. Edge
    // only, and never on a repeat: holding K down would otherwise toggle the mouse sixty times a
    // second and land on whichever state the key release happened to fall on.
    onKey(k, down, repeat) {
      if (String(k || '').toLowerCase() !== key) return false;
      if (down && !repeat) st.toggle();
      return true;
    },
  };
  return st;
}

// ── THE WIRING ───────────────────────────────────────────────────────────────
// `enabled()` is asked before every event: the cockpit passes "the free camera is stowed", because
// a detached camera owns the mouse and the aircraft is deliberately hands-off while it is out.
//
// ⚠ BIND ON THE BUBBLE PHASE. `bindFreeCamPointer` binds the same element on the CAPTURE phase and
// calls `stopImmediatePropagation` on what it consumes, which is how the camera gets first refusal
// without any of the panels knowing it exists. Capture here would take the mouse back off it.
export function bindMouseStick(el, st, opts = {}) {
  if (!el) return () => {};
  const enabled = opts.enabled || (() => true);

  const locked = () => (typeof document !== 'undefined' && document.pointerLockElement === el);
  // Same two sources freecam reads, for the same reason. The Permissions-Policy answer is
  // authoritative where a browser exposes it; otherwise optimism, corrected by the first refusal.
  // ⚠ RE-ASKED AT EVERY ARM rather than latched for the session: Chrome also refuses a re-request
  // made too soon after Esc, and a permanent flag would turn that momentary no into "this browser
  // cannot lock" for the rest of the flight.
  const policyAllows = () => {
    try { return document.featurePolicy?.allowsFeature?.('pointer-lock') !== false; } catch { return true; }
  };
  let lockable = policyAllows();

  // ⚠ GUARDED, because it is a decoration and the thing it sits in front of is not. A surface with
  // no `style` — a node harness's fake element, anything that is not a live node — would throw here
  // and take the arm path down with it, so hiding the cursor would break the stick it goes with.
  // Inline on purpose: it has to beat the view's own cursor rule, and an inline style does.
  let cursorWas = null;
  const hideCursor = (on) => {
    if (!el.style) return;
    if (on) { if (cursorWas === null) cursorWas = el.style.cursor || ''; el.style.cursor = 'none'; }
    else if (cursorWas !== null) { el.style.cursor = cursorWas; cursorWas = null; }
  };

  const release = () => { if (locked()) { try { document.exitPointerLock?.(); } catch { /* nothing to undo */ } } };
  const grab = () => {
    if (!lockable || locked()) return;
    try { el.requestPointerLock?.()?.catch?.(() => {}); } catch { /* older browsers throw instead */ }
  };

  // ⚠ THE LAST CURSOR POSITION IS DROPPED AT EVERY DISCONTINUITY. Arming, disarming, taking or
  // losing a lock: after any of them the remembered position describes a gesture nobody is making,
  // and a delta measured across one is a jump — the whole travel of the screen, straight into the
  // control surfaces. Same idiom as freecam's `last = null`, and the reason there is one name for
  // it rather than four assignments.
  let last = null;

  const applyArm = (on) => {
    st.locked = false;
    last = null;
    if (on) {
      hideCursor(true);
      lockable = policyAllows();
      if (MOUSE_STICK.mode === 2) grab();
    } else {
      release();
      hideCursor(false);
    }
  };
  const unArm = st.onArm(applyArm);

  // ── THE ONE MOVE HANDLER, AND WHY THERE ARE TWO OF THEM ──────────────────
  // A browser that delivers pointer events delivers `pointermove` first and the compatibility
  // `mousemove` after it, so one flag makes the second inert wherever the first exists. Without
  // the fallback the control is dead anywhere `pointermove` does not arrive; without the flag it
  // counts every movement twice and flies at double sensitivity.
  let sawPointer = false;
  const move = (e) => {
    if (!st.armed || !enabled()) return;
    if (locked() !== st.locked) { st.locked = locked(); last = null; }
    if (st.locked) { st.by(e.movementX || 0, e.movementY || 0); return; }
    const x = e.clientX, y = e.clientY;
    if (x == null || y == null) return;
    // The first event after a discontinuity establishes where the cursor is and moves nothing.
    if (!last) { last = { x, y }; return; }
    st.by(x - last.x, y - last.y);
    last = { x, y };
  };
  const onPointerMove = (e) => { sawPointer = true; move(e); };
  const onMouseMove = (e) => { if (!sawPointer) move(e); };

  // ⚠ LOSING THE LOCK LETS GO, WHICH IS NOT WHAT FREECAM DOES AND IS RIGHT HERE. Esc is the one key
  // everybody presses to get their mouse back, and under a granted lock the browser takes it before
  // any handler sees the key. Carrying on unlocked at that point hands the cursor back and goes on
  // flying with it, so the pointer is visibly loose on screen and still steering.
  const lockChange = () => {
    const now = locked();
    last = null;
    if (st.locked && !now && st.armed) { st.setArmed(false); return; }
    st.locked = now;
  };
  // ⚠ AND WHERE THE LOCK WAS REFUSED THERE IS NO `pointerlockchange` FOR ESC TO ARRIVE ON — the
  // cursor is hidden by the line above rather than by the browser — so the same key has to be heard
  // directly. NOT swallowed: Esc closes panels and leaves fullscreen, and a key that quietly
  // stopped doing those would be a worse trade than the one being fixed.
  const esc = (e) => { if (st.armed && !locked() && e.key === 'Escape') st.setArmed(false); };
  const lockError = () => { st.locked = false; last = null; };
  // ⚠ AN ARMED STICK BEHIND A WINDOW THAT HAS GONE AWAY HOLDS ITS LAST DEFLECTION — and holding is
  // the whole design here, so this matters more than it would for a sprung control. Alt-tab, a
  // click into the chat input, the tab going to the background: no more movement arrives, the
  // column stays where it is, and the aeroplane flies a standing turn into the ground while nobody
  // is looking at it. Letting go is the only safe answer to losing the pointer.
  const blur = () => { if (st.armed) st.setArmed(false); };

  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('mousemove', onMouseMove);
  if (typeof window !== 'undefined') {
    // On the window as well as the element, because an unlocked cursor wanders off the glass and
    // the hand is still flying: the column must go on reading it wherever it has got to.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('blur', blur);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerlockchange', lockChange);
    document.addEventListener('pointerlockerror', lockError);
  }

  return () => {
    unArm();
    st.setArmed(false);
    release();
    hideCursor(false);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('mousemove', onMouseMove);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('blur', blur);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerlockchange', lockChange);
      document.removeEventListener('pointerlockerror', lockError);
    }
  };
}

// What the toast says when the mouse is taken. Here rather than in the panel so the two seats that
// could bind this cannot describe it differently.
export const STICK_HINT_ON = '✋ MOUSE STICK — the mouse flies her, and she holds where you leave it · ESC or K to let go';
export const STICK_HINT_OFF = '✋ MOUSE STICK OFF — the yoke pad has it back';
