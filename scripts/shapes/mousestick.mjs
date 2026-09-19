// THE MOUSE STICK — does moving the mouse move the column by the same amount, and does it STAY?
//
// The contract is one sentence and every assertion here is a way of reading it: a movement of the
// mouse produces an equal movement of the control, in the same direction, and nothing afterwards
// pulls it back. The version this replaced mapped cursor POSITION onto deflection, which put an
// invisible magnet in the middle of the glass; most of what is checked below is the absence of
// that magnet in each of the places it could hide.
//
// ⚠ AND THE ONE THING A FAKE SURFACE LIES ABOUT is the pointer lock, which it GRANTS on request —
// so the refused path, the one taken in the Claude desktop browser pane where this gets judged, is
// never exercised unless a second surface is built that refuses. There is one below.
//
// Every assertion was mutation-tested: the rule was broken, the suite was confirmed red, and the
// rule was put back. An assertion that cannot fail is the same false green as no assertion.
import { MOUSE_STICK, STICK_TUNE, createMouseStick, bindMouseStick } from '../../client/game/js/panels/mousestick.js';

let bad = 0, checks = 0;
const ck = (ok, what) => { checks++; if (!ok) { bad++; console.log(`  ✗ ${what}`); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// The knobs as they ship, restored between blocks so one block's tuning cannot decide another's
// result — the trap every bench in this repo has fallen into at least once.
const SHIPPED = { ...MOUSE_STICK };
const reset = () => Object.assign(MOUSE_STICK, SHIPPED);

// ── EQUAL MOVEMENT ──────────────────────────────────────────────────────────
{
  reset();
  const st = createMouseStick();
  st.setArmed(true);

  // The headline. `px` pixels of mouse is full deflection, so half of it is half.
  st.by(MOUSE_STICK.px / 2, 0);
  ck(near(st.x, 0.5), `half the travel right gives ${st.x} rather than 0.5`);

  // ⚠ IT ACCUMULATES. Two movements of the same size are twice the deflection — which is the
  // difference between this and a position map, where the second one would land on the same spot.
  st.by(MOUSE_STICK.px / 4, 0);
  ck(near(st.x, 0.75), `a second movement did not add: ${st.x} rather than 0.75`);

  // ⚠ AND IT IS SYMMETRIC. Moving back by what you moved out by returns exactly, with no drift and
  // no hysteresis — the property a pilot checks first without knowing they are checking it.
  st.by(-MOUSE_STICK.px * 0.75, 0);
  ck(Object.is(st.x, 0), `out and back did not return to centre: ${st.x}`);

  // ⚠ THE TWO AXES ARE THE SAME NUMBER. "Move it in any direction and it moves the same" is a
  // claim about the axes agreeing, and the old version got this wrong by normalising each against
  // its own side of a 16:9 rect.
  st.by(90, 90);
  ck(near(st.x, Math.abs(st.y)), `the axes disagree at the same movement: ${st.x} vs ${st.y}`);

  // Sensitivity is a pixel count and nothing else touches the response.
  reset(); MOUSE_STICK.px = 150;
  st.setArmed(false); st.setArmed(true);
  st.by(150, 0);
  ck(near(st.x, 1), `at px 150 a 150px sweep gives ${st.x} rather than full travel`);

  // The yoke's own convention, which the pad already has: DOWN the glass is back on the column and
  // nose UP, a positive elevator. Getting it backwards reads as the flight model being wrong.
  reset();
  st.setArmed(false); st.setArmed(true);
  st.by(0, 100);
  ck(st.y > 0, `pulling the mouse toward you gives elevator ${st.y} — the column is not inverted`);
  MOUSE_STICK.pullUp = 1;
  st.setArmed(false); st.setArmed(true);
  st.by(0, 100);
  ck(st.y < 0, `the pull-up setting did not flip the pitch axis: ${st.y}`);

  reset();
  console.log(`  ${bad ? '✗' : '✓'} equal movement — it accumulates, it is symmetric, and both axes agree`);
}

// ── NOTHING PULLS IT HOME ───────────────────────────────────────────────────
// The bug this file was rewritten over. Four separate things could put the column back on centre
// without being asked, and each one is checked on its own because each would feel identical.
{
  reset();
  const before = bad;
  const st = createMouseStick();
  st.setArmed(true);
  st.by(MOUSE_STICK.px * 0.4, MOUSE_STICK.px * 0.3);
  const held = [st.x, st.y];
  ck(held[0] !== 0 && held[1] !== 0, 'the column did not move at all');

  // 1. Time alone must not move it. At the shipped `ret` of 0 the column holds for ever, and ten
  //    seconds of frames is how a pilot notices that it does not.
  for (let i = 0; i < 600; i++) st.step(1 / 60);
  ck(st.x === held[0] && st.y === held[1], `the column drifted on its own from ${held} to ${[st.x, st.y]} — something is pulling it home`);

  // 2. An event carrying no movement must not move it. A browser sends plenty.
  st.by(0, 0);
  ck(st.x === held[0] && st.y === held[1], 'a zero-movement event moved the column');

  // 3. ⚠ THE OLD BUG IN ITS PUREST FORM. A position map has a home at the centre of the glass, so
  //    a hand that returns to the middle of the screen returns the column — even though the two
  //    movements that got it there cancelled to a net push. There is no such thing as "where the
  //    cursor is" here, so a sequence that nets out to a push must leave a push.
  st.setArmed(false); st.setArmed(true);
  st.by(300, 0); st.by(-200, 0);
  ck(near(st.x, 100 / MOUSE_STICK.px), `a net movement of 100px left the column at ${st.x} rather than ${(100 / MOUSE_STICK.px).toFixed(4)}`);

  // 4. And the opt-in spring, for anyone who does want one, must be OFF by default and must work
  //    when asked for. Both halves matter: a default of 0 that nothing reads is the same bug.
  ck(SHIPPED.ret === 0, `the sprung return ships at ${SHIPPED.ret} rather than off`);
  MOUSE_STICK.ret = 2;
  for (let i = 0; i < 600; i++) st.step(1 / 60);
  ck(st.x === 0 && st.y === 0, `at ret 2 the column did not come home: ${st.x}, ${st.y}`);

  reset();
  console.log(`  ${bad > before ? '✗' : '✓'} nothing pulls it home — not time, not a null event, not a round trip across the glass`);
}

// ── SATURATION, AND GETTING BACK OFF IT ─────────────────────────────────────
{
  reset();
  const before = bad;
  const st = createMouseStick();
  st.setArmed(true);

  st.by(MOUSE_STICK.px * 3, 0);
  ck(st.x === 1, `a long push does not saturate at full travel: ${st.x}`);
  // ⚠ CLAMPED AS IT ACCUMULATES, NEVER ON THE WAY OUT. Let the stored value wind past 1 and the
  // column stops answering: you have to drag the whole overshoot back before anything happens,
  // which reads as the controls sticking. Reversing must take effect on the very next event.
  st.by(-MOUSE_STICK.px / 4, 0);
  ck(near(st.x, 0.75), `after saturating, a quarter back gives ${st.x} rather than 0.75 — the value wound up`);

  st.by(-MOUSE_STICK.px * 3, 0);
  ck(st.x === -1, `it does not saturate the other way: ${st.x}`);

  reset();
  console.log(`  ${bad > before ? '✗' : '✓'} saturation — full travel is a limit, not a trap`);
}

// ── ARMING PICKS THE COLUMN UP WHERE IT LIES ────────────────────────────────
{
  reset();
  const before = bad;
  let live = [0, 0];
  const st = createMouseStick({ key: 'k', read: () => live });

  ck(st.armed === false, 'it starts armed');
  ck(st.onKey('k', true, false) === true && st.armed === true, 'K does not take the mouse');
  ck(st.onKey('k', true, false) === true && st.armed === false, 'K again does not give it back');
  // ⚠ AN ODD NUMBER OF REPEATS. A first cut fired two and asserted the state was unchanged, which
  // is also what a key that toggles on every repeat produces — it caught nothing, and the mutation
  // run is the only reason anybody found out.
  st.setArmed(true);
  st.onKey('k', true, true); st.onKey('k', true, true); st.onKey('k', true, true);
  ck(st.armed === true, 'a held K toggles the mouse');
  ck(st.onKey('j', true, false) === false, 'it claims a key that is not its own');
  ck(st.onKey('k', false, false) === true, 'it lets the keyup through to the seat');

  // ⚠ THE OTHER HALF OF "NOTHING FORCES IT BACK". A pilot holding a turn on the pad presses K:
  // the column must pick up that turn, not snap to neutral and drop the wing.
  st.setArmed(false);
  live = [0.6, -0.25];
  st.setArmed(true);
  ck(near(st.x, 0.6) && near(st.y, -0.25), `arming snapped the controls to ${[st.x, st.y]} instead of picking up ${live}`);
  // …and from there it is ordinary movement, measured from where it was picked up.
  st.by(MOUSE_STICK.px * 0.2, 0);
  ck(near(st.x, 0.8), `movement after a seeded arm is not relative to the seed: ${st.x}`);

  // Disarming leaves the column exactly where it was: the seat's own spring is what recentres it,
  // over a few frames, and zeroing here would be the jump that spring exists to avoid.
  const parked = [st.x, st.y];
  st.setArmed(false);
  ck(st.x === parked[0] && st.y === parked[1], `disarming snapped the column from ${parked} to ${[st.x, st.y]}`);

  // A stowed stick ignores the mouse outright — the panel reads `armed` before it writes the
  // aircraft, and this is the other half of that contract.
  st.by(500, 500);
  ck(st.x === parked[0], `a stowed stick is still flying: ${st.x}`);

  // ⚠ MODE 0 CANNOT BE ARMED. This is the A/B control for the whole feature, so it has to be a
  // property of the state machine rather than of whichever caller remembered to check.
  MOUSE_STICK.mode = 0;
  ck(st.setArmed(true) === false && st.armed === false, 'mode 0 can still be armed — the off switch is not off');
  reset();
  console.log(`  ${bad > before ? '✗' : '✓'} arming — one key, no repeat, and it picks the column up where the aircraft left it`);
}

// ── THE SURFACE: THE WIRING, AND THE REFUSED LOCK ───────────────────────────
{
  reset();
  const before = bad;
  const realDoc = globalThis.document, realWin = globalThis.window;

  const target = () => {
    const l = {};
    return {
      _l: l,
      style: { cursor: 'crosshair' },
      addEventListener(t, fn) { (l[t] ||= []).push(fn); },
      removeEventListener(t, fn) { l[t] = (l[t] || []).filter((f) => f !== fn); },
      fire(t, ev) { for (const fn of (l[t] || []).slice()) fn(ev); return ev; },
      count() { return Object.values(l).reduce((n, a) => n + a.length, 0); },
    };
  };
  const ev = (o = {}) => ({ movementX: 0, movementY: 0, ...o });
  // A cursor walk: the events a real mouse produces going from one place to another.
  const walk = (win, pts) => { for (const [x, y] of pts) win.fire('pointermove', ev({ clientX: x, clientY: y })); };

  // ── A surface that GRANTS the lock ──
  {
    const doc = target(), win = target(), el = target();
    doc.pointerLockElement = null;
    // A real browser fires pointerlockchange on both edges and the binder's release valve hangs
    // off it, so a fake that only flipped the field would pass a test the browser would fail.
    el.requestPointerLock = () => { doc.pointerLockElement = el; doc.fire('pointerlockchange', ev()); };
    doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange', ev()); };
    globalThis.document = doc; globalThis.window = win;

    const st = createMouseStick();
    const unbind = bindMouseStick(el, st);

    MOUSE_STICK.mode = 1;
    // ⚠ A STOWED STICK EATS NOTHING. The cockpit's own yoke pad, the orbit drag and the wheel all
    // live on or beside this element; a scheme that read the mouse before it was asked to would
    // fly the aeroplane whenever the cursor crossed the windscreen.
    walk(win, [[400, 300], [700, 300]]);
    ck(st.x === 0, `a stowed stick flew the aircraft: ${st.x}`);
    ck(el.style.cursor === 'crosshair', 'a stowed stick hid the cursor');

    st.setArmed(true);
    ck(el.style.cursor === 'none', 'arming did not hide the cursor');
    ck(doc.pointerLockElement === null, 'mode 1 asked for a pointer lock it does not need');

    // ⚠ THE FIRST EVENT AFTER ARMING ESTABLISHES WHERE THE CURSOR IS AND MOVES NOTHING. Without
    // that, the first delta is measured against a position from before the discontinuity — the
    // whole width of the screen, straight into the control surfaces.
    win.fire('pointermove', ev({ clientX: 400, clientY: 300 }));
    ck(st.x === 0 && st.y === 0, `the first event after arming moved the column to ${[st.x, st.y]}`);
    win.fire('pointermove', ev({ clientX: 400 + MOUSE_STICK.px / 2, clientY: 300 }));
    ck(near(st.x, 0.5), `an unlocked cursor walk is not steering: ${st.x}`);

    // ⚠ AND IT GOES ON READING THE CURSOR OFF THE GLASS. Unlocked, the pointer wanders wherever
    // the hand takes it, and the column is what matters — the listener is on the window for this.
    win.fire('pointermove', ev({ clientX: 40000, clientY: 300 }));
    ck(st.x === 1, `the column stopped following the cursor off the element: ${st.x}`);

    st.setArmed(false);
    ck(el.style.cursor === 'crosshair', 'disarming did not put the cursor back');

    // Mode 2 takes the lock, and the move handler switches to movement deltas on its own — it asks
    // the browser whether it is locked rather than trusting the mode, which is the distinction the
    // refused-lock block below turns on. The scale is identical to the unlocked branch.
    MOUSE_STICK.mode = 2;
    st.setArmed(true);
    ck(doc.pointerLockElement === el, 'mode 2 did not take the pointer');
    win.fire('pointermove', ev({ movementX: MOUSE_STICK.px / 2, clientX: 0, clientY: 0 }));
    ck(near(st.x, 0.5), `a locked stick reads movement at a different scale: ${st.x} rather than 0.5`);

    // ⚠ LOSING THE LOCK LETS GO. Esc is how everybody gets their mouse back, and under a granted
    // lock the browser takes it before any handler sees the key — carrying on unlocked there
    // leaves a visible cursor loose on screen and still flying the aeroplane.
    doc.exitPointerLock();
    ck(st.armed === false, 'the stick kept flying after the browser took the lock back');
    ck(el.style.cursor === 'crosshair', '…and kept the cursor hidden with it');

    // ⚠ AN ARMED STICK BEHIND A WINDOW THAT HAS GONE AWAY HOLDS ITS LAST DEFLECTION, and holding
    // is this control's whole design — so the aeroplane flies a standing turn into the ground
    // while nobody is looking at it.
    MOUSE_STICK.mode = 1;
    st.setArmed(true);
    win.fire('blur', ev());
    ck(st.armed === false, 'alt-tabbing left the stick armed and the aircraft holding its deflection');
    // Esc, where the lock was never taken and there is no pointerlockchange for it to arrive on.
    st.setArmed(true);
    win.fire('keydown', { key: 'Escape' });
    ck(st.armed === false, 'ESC does not give the mouse back when the lock was never held');

    // ⚠ AND EVERY ONE OF THOSE DROPS THE REMEMBERED CURSOR POSITION. The hand moves while the
    // column is stowed — that is most of what a mouse is for — so a `last` that survived the stow
    // makes the first event after re-arming a delta across the whole of that journey, which is the
    // width of the screen straight into the control surfaces.
    //
    // ⚠ MEASURE THE FIRST EVENT, NOT THE SECOND. A first cut captured `x` after the first event
    // and asserted the NEXT one moved 0.25 — which it does either way, because the jump is already
    // absorbed into the baseline. It stayed green with the rule deleted.
    st.setArmed(true);
    win.fire('pointermove', ev({ clientX: 100, clientY: 100 }));
    win.fire('pointermove', ev({ clientX: 100 + MOUSE_STICK.px / 4, clientY: 100 }));
    st.setArmed(false);
    st.setArmed(true);
    win.fire('pointermove', ev({ clientX: 900, clientY: 700 }));
    ck(st.x === 0 && st.y === 0, `the first event after re-arming flew the aircraft to ${[st.x, st.y]} — it measured across the stow`);
    win.fire('pointermove', ev({ clientX: 900 + MOUSE_STICK.px / 4, clientY: 700 }));
    ck(near(st.x, 0.25), `movement after re-arming is not measured from where the cursor now is: ${st.x}`);

    st.setArmed(true);
    unbind();
    ck(st.armed === false && el.style.cursor === 'crosshair', 'unbinding left the stick armed or the cursor hidden');
    ck(el.count() === 0 && win.count() === 0 && doc.count() === 0, 'unbinding left listeners behind');
  }

  // ── A surface that REFUSES the lock: the Claude desktop browser pane ──
  // ⚠ THE MOST IMPORTANT BLOCK IN THE FILE, and one a fake surface will not give you unless it is
  // built to. `featurePolicy.allowsFeature('pointer-lock')` is false there, at the top level and
  // not in an iframe, so the request answers `pointerlockerror` and nothing else. The control has
  // to go on working unchanged — that pane is where this gets judged.
  {
    reset(); MOUSE_STICK.mode = 2;
    const doc = target(), win = target(), el = target();
    doc.pointerLockElement = null;
    doc.featurePolicy = { allowsFeature: (n) => (n === 'pointer-lock' ? false : true) };
    el.requestPointerLock = () => { doc.fire('pointerlockerror', ev()); };
    globalThis.document = doc; globalThis.window = win;

    const st = createMouseStick();
    const unbind = bindMouseStick(el, st);
    st.setArmed(true);
    ck(st.armed === true, 'a refused lock disarmed the stick');
    ck(doc.pointerLockElement === null, 'a refusing surface ended up locked');
    ck(el.style.cursor === 'none', 'a refused lock left the cursor showing — the only half of "out of the shot" still available');
    walk(win, [[400, 300], [400 + MOUSE_STICK.px, 300]]);
    ck(st.x === 1, `mode 2 under a refused lock does not fly: ${st.x}`);
    unbind();
  }

  // ── The mousemove fallback, on a surface that has never seen a pointer event ──
  // ⚠ ON ITS OWN BINDING, because the flag that makes the fallback inert LATCHES for the life of
  // the binding — correct behaviour, and exactly what a shared surface hides. A first cut asserted
  // this after an earlier block had already fired a `pointermove` through the same binder, so it
  // measured the fallback correctly standing down and reported it as dead.
  {
    reset();
    const doc = target(), win = target(), el = target();
    doc.pointerLockElement = null;
    globalThis.document = doc; globalThis.window = win;
    const st = createMouseStick();
    const unbind = bindMouseStick(el, st);
    st.setArmed(true);
    win.fire('mousemove', { clientX: 400, clientY: 300 });
    win.fire('mousemove', { clientX: 400 - MOUSE_STICK.px / 2, clientY: 300 });
    ck(near(st.x, -0.5), `the mousemove fallback does not reach the column: ${st.x}`);
    unbind();
  }

  // ── …and inert the moment pointer events do arrive ──
  // ⚠ ASKED UNDER A LOCK, WHICH IS THE ONLY PLACE IT CAN FAIL — and the first cut asked it
  // unlocked, where double-counting is harmless BY CONSTRUCTION and the assertion could not fail.
  // A browser sends `pointermove` and then a compatibility `mousemove` carrying the SAME
  // `clientX`, so the duplicate's delta against a `last` the first handler already advanced is
  // zero. Under a lock there is no `last`: `movementX` rides both events, and a second handler
  // reading it doubles the sensitivity of the whole control.
  {
    reset(); MOUSE_STICK.mode = 2;
    const doc = target(), win = target(), el = target();
    doc.pointerLockElement = null;
    el.requestPointerLock = () => { doc.pointerLockElement = el; doc.fire('pointerlockchange', ev()); };
    doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange', ev()); };
    globalThis.document = doc; globalThis.window = win;
    const st = createMouseStick();
    const unbind = bindMouseStick(el, st);
    st.setArmed(true);
    ck(doc.pointerLockElement === el, 'the double-count check never took a lock, so it proves nothing');
    const m = MOUSE_STICK.px / 2;
    win.fire('pointermove', ev({ movementX: m, movementY: 0 }));
    win.fire('mousemove', { movementX: m, movementY: 0 });   // the compatibility event, ignored
    ck(near(st.x, 0.5), `the mousemove fallback is still live after a pointermove: ${st.x} rather than 0.5 — double sensitivity`);
    unbind();
  }

  // ── A surface with no style, which is every node harness and was a real freecam bug ──
  {
    reset();
    const el = { _l: {}, addEventListener() {}, removeEventListener() {} };
    globalThis.document = target(); globalThis.window = target();
    globalThis.document.pointerLockElement = null;
    const st = createMouseStick();
    let threw = null;
    try { const u = bindMouseStick(el, st); st.setArmed(true); st.setArmed(false); u(); } catch (e) { threw = e; }
    ck(!threw, `a surface with no style took the stick down with it: ${threw && threw.message}`);
  }

  globalThis.document = realDoc; globalThis.window = realWin;
  reset();
  console.log(`  ${bad > before ? '✗' : '✓'} surface — stowed eats nothing, a refused lock still flies, and every way of losing the pointer lets go`);
}

// ── THE PANEL CONTRACT ──────────────────────────────────────────────────────
// The ⚙ panel builds a slider per row and writes `MOUSE_STICK[k]` from it. A row naming a knob that
// does not exist renders a slider reading `undefined` that then writes NaN into the column — which
// does not throw, does not warn, and flies an aeroplane with a NaN deflection.
{
  const before = bad;
  for (const [k, lbl, lo, hi, stp] of STICK_TUNE) {
    ck(Object.prototype.hasOwnProperty.call(MOUSE_STICK, k), `the ⚙ panel has a row for '${k}', which is not a knob`);
    ck(typeof MOUSE_STICK[k] === 'number', `'${k}' is not a number, so its slider cannot round-trip it`);
    ck(MOUSE_STICK[k] >= lo && MOUSE_STICK[k] <= hi, `'${k}' ships at ${MOUSE_STICK[k]}, outside its own slider's ${lo}..${hi}`);
    ck(typeof lbl === 'string' && lbl.length > 0 && stp > 0, `'${k}' has no label or no step`);
  }
  // Every knob is reachable from the panel. A knob with no row is one nobody can find, which is
  // most of the way to a knob nobody reads.
  for (const k of Object.keys(MOUSE_STICK)) {
    ck(STICK_TUNE.some((r) => r[0] === k), `'${k}' is a knob with no row in the ⚙ panel`);
  }
  console.log(`  ${bad > before ? '✗' : '✓'} panel — every slider names a real knob, and every knob has a slider`);
}

console.log(bad ? `mousestick: ${bad} of ${checks} FAILED` : `mousestick: ${checks}/${checks} passed`);
if (bad) process.exit(1);
