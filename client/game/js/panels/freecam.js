// THE DETACHED CAMERA — one implementation, three vehicles.
//
// The chase camera that every external view already had can orbit, pitch and dolly, but it is
// bolted to the thing it is watching: turn the vehicle and the shot turns with it. This is the
// other kind. You put the camera somewhere, point it, and the world carries on in front of it.
//
// WHY IT LIVES HERE AND NOT IN THREE PANELS. The flight sim, the truck cab and the yacht helm all
// render through `paintWindshield` and all three wanted the same thing, so the state and the input
// are written once and each panel does two things: forward its key events, and hand the resulting
// `view()` to the renderer as `freeCam`. Everything vehicle-specific — what "hold your attitude and
// speed" means for an aeroplane versus a truck — stays in the panel, because those are three
// genuinely different sentences and pretending otherwise would put a gearbox in this file.
//
// ⚠ IT IS PRESENTATION, AND ONLY PRESENTATION. Nothing here reaches the server. The rig keeps
// driving, the aircraft keeps flying, the odometer keeps counting: the camera has been taken off
// its mount, and that is the entire change. A free camera that paused the world would be a
// different feature with a different name, and one you could not use to photograph anything moving.

const DEG = Math.PI / 180;
// Tiles per second on the sticks. The base is a walking-pace dolly — slow enough to place a shot —
// and the modifiers are what make the same control useful for crossing a yard.
const BASE = 1.1, FAST = 5.5, SLOW = 0.28;
const LOOK = 62;          // degrees per second on the arrow keys
const PITCH_LIM = 1.35;   // ~77°, short of straight up/down where the projection stops meaning much

// Which keys this owns while it is active. Deliberately a SET rather than a series of comparisons
// scattered through a keydown handler: while the camera is detached these keys belong to it and to
// nothing else, and the panel needs one honest answer to "did the camera take that?".
const OWNED = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'z', 'x',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control']);
// Degrees of yaw per pixel of mouse movement. Slow enough that a full sweep is a deliberate gesture
// rather than a flick — this is a camera you are aiming, not a first-person shooter. The two are
// matched (0.22° is 0.0038 rad), so a pixel sideways and a pixel up turn the eye the same amount.
const MOUSE_YAW = 0.22, MOUSE_PITCH = 0.0038;
const ROLL_RATE = 48;     // degrees per second on Z/X
const ROLL_LIM = Math.PI; // all the way over, both ways: a dutch angle has no natural stopping point
// The camera may go under the road — briefly, and on purpose, because a low shot looking up at a
// rig is worth having and the ground is not solid to a camera. What it may not do is fall forever.
const Z_MIN = -0.6, Z_MAX = 40;
// ── THE ORBIT ────────────────────────────────────────────────────────────────
// Per pixel, and deliberately THE SAME NUMBERS THE CHASE CAMERA'S MIDDLE-DRAG USES (see cab-view's
// extYaw/extPitch handler): this is the gesture a player has already learnt on the view they came
// from, and a turntable that swung at a different rate depending on whether the camera was on its
// mount would read as two instruments.
const ORBIT_AZ = 0.30, ORBIT_EL = 0.006;
// How far up and over it may swing. Matches the chase's own upper clamp; short of the pole, where a
// near-vertical orbit stretches everything it is looking at into a spindle.
const ORBIT_LIM = 1.15;
// ⚠ AN ORBIT NEEDS A RADIUS, and the camera opens with none — all three panels seed it at x=0,y=0,
// which is the vehicle's own tile. Swinging round a subject you are standing inside is a rotation
// with nothing to show for it, so the first orbit input backs the eye off to here.
const ORBIT_MIN = 1.2;
// What the arc goes round, in world-z: roughly the middle of the thing being looked at (the chase
// camera solves this per class; a detached camera has no subject to ask). It sets where the swing
// is centred and nothing else — a few hundredths either way moves no control the player can feel.
// Exported because the harness asserts the subject stays centred, and it cannot ask that question
// without knowing what the subject is; a copy of the number there would be a second opinion.
export const ORBIT_PIVOT_Z = 0.3;
// The three mouse buttons, named for what they do rather than for which finger presses them.
const BTNS = new Set(['up', 'down', 'orbit']);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createFreeCam() {
  const st = { on: false, x: 0, y: 0, z: 0.45, yaw: 0, pitch: 0, roll: 0, keys: new Set(), btn: new Set(), notify: null };
  const held = (k) => st.keys.has(k);

  return {
    get active() { return st.on; },
    // Opening it WHERE THE CHASE CAMERA WAS, not at the origin. Dropping the eye to (0,0) on the
    // vehicle's own tile means every session starts inside the bodywork and the first thing anybody
    // does is fly out of it. `seed` is whatever the panel can honestly say about the current shot.
    open(seed = {}) {
      st.on = true;
      st.keys.clear(); st.btn.clear();
      st.yaw = seed.yaw != null ? seed.yaw : 0;
      st.pitch = seed.pitch != null ? seed.pitch : 0;
      st.z = seed.z != null ? seed.z : 0.45;
      st.x = seed.x || 0; st.y = seed.y || 0;
      st.roll = 0;
      st.notify?.(true);
    },
    close() { st.on = false; st.keys.clear(); st.btn.clear(); st.notify?.(false); },
    toggle(seed) { if (st.on) this.close(); else this.open(seed); return st.on; },

    // The surface asking to be told when the camera comes out and goes back on its mount, so it can
    // take the pointer and give it back. ONE listener, because exactly one element owns the mouse
    // at a time and a second would be a second thing fighting for the lock. Returns its own removal
    // and clears only if it is still the one installed — the cab rebinds on every panel open, and a
    // stale teardown must not unhook the live surface.
    onToggle(fn) { st.notify = fn || null; return () => { if (st.notify === fn) st.notify = null; }; },

    // Returns true when the camera consumed the key, which is the panel's cue not to also steer the
    // vehicle with it. ⚠ Every one of these is a driving control on at least one of the three
    // panels (w/s is the throttle in the cab, a/d the wheel), so an inactive camera must consume
    // NOTHING — the check on `st.on` is the whole safety of routing key events through here.
    onKey(key, down) {
      if (!st.on) return false;
      const k = String(key || '').toLowerCase();
      if (!OWNED.has(k)) return false;
      if (down) st.keys.add(k); else st.keys.delete(k);
      return true;
    },
    // A blur or a panel teardown must not leave a key stuck down, or the camera drifts off on its
    // own with nobody touching it and no way to stop it but pressing and releasing the same key.
    releaseAll() { st.keys.clear(); st.btn.clear(); },
    // Narrower, for the one case that is not a teardown: the pointer lock going away with a button
    // still down. That leaves the camera rising or falling with nothing the player can press to stop
    // it — the stuck-key failure above, arriving through the mouse — and it must not also drop the
    // keys, because a blur is not what happened and W is very likely still genuinely held.
    releaseButtons() { st.btn.clear(); },

    // ── THE MOUSE ─────────────────────────────────────────────────────────────
    // Aiming a camera with four arrow keys is aiming it in four directions, and aiming it with a
    // DRAG is aiming it one screen-width at a time. Freelook is the gesture this wants: the mouse
    // moves, the camera looks, and the buttons are left free for something else. That costs a
    // pointer lock — see bindFreeCamPointer — and it is what buys the other three controls below,
    // because a left drag cannot both aim the camera and lift it.
    //
    // ⚠ These take a DELTA, not a position. Under a lock there is no cursor to subtract a previous
    // position from: the pointer is nowhere, and `movementX/Y` is the whole of what the browser has
    // to say about the gesture.
    look(dx, dy) {
      if (!st.on) return false;
      st.yaw = ((st.yaw + dx * MOUSE_YAW) % 360 + 360) % 360;
      st.pitch = clamp(st.pitch - dy * MOUSE_PITCH, -PITCH_LIM, PITCH_LIM);
      return true;
    },

    // THE TURNTABLE, on the middle button, exactly where the chase camera keeps it.
    //
    // ⚠ WHAT IT GOES ROUND IS THE ORIGIN, and that falls out of the coordinates rather than being
    // chosen: x/y are a world-tile offset FROM THE VEHICLE, so (0,0) IS the subject. Every other
    // free camera has to invent a focus distance and then argue about it; this one does not have
    // the question. Turn the wheel to change the radius and the orbit happily follows it out.
    //
    // It is a LOCKED orbit — the subject stays centred, because a swing that let its subject drift
    // out of frame is a strafe with extra arithmetic. Yaw and pitch are therefore derived from the
    // new position rather than carried, which is also what makes the gesture reversible: drag back
    // the same distance and the shot is the one you had.
    orbit(dx, dy) {
      if (!st.on) return false;
      let ex = st.x, ey = st.y, ez = st.z - ORBIT_PIVOT_Z;
      let D = Math.hypot(ex, ey, ez);
      if (D < ORBIT_MIN) {
        // No radius to swing on (see ORBIT_MIN). Back off down the axis it is ALREADY looking along,
        // so the subject arrives in the middle of the frame where the camera was already pointed —
        // rather than at some compass direction of this function's choosing.
        const s = Math.sin(st.yaw * DEG), c = Math.cos(st.yaw * DEG), cp = Math.cos(st.pitch);
        ex = -ORBIT_MIN * s * cp; ey = ORBIT_MIN * c * cp; ez = -ORBIT_MIN * Math.sin(st.pitch);
        D = ORBIT_MIN;
      }
      // The camera's position, said as the aim it implies: `yaw` is already the angle that looks at
      // the origin, so there is no second angle to keep in step with it.
      const yaw = Math.atan2(-ex, ey) / DEG + dx * ORBIT_AZ;
      const el0 = Math.asin(clamp(ez / D, -1, 1));
      // ⚠ THE LIMIT HOLDS THE ORBIT, IT DOES NOT YANK THE CAMERA BACK INSIDE IT. W and R can fly the
      // eye anywhere, including straight up over the subject — which is further over than the orbit
      // is ever allowed to swing — and clamping flat would make the FIRST middle-drag jump the shot
      // down to 66° before it moved it at all. So the bound only bites in the direction of travel:
      // already outside, it can come back and it cannot get worse; inside, it is the wall it says.
      let el = el0 - dy * ORBIT_EL;
      el = clamp(el, Math.min(-ORBIT_LIM, el0), Math.max(ORBIT_LIM, el0));
      // ⚠ …BUT PITCH_LIM IS STILL THE WALL, because that one is not a matter of taste: the aim this
      // hands back is `-el`, and every other control in this file promises the renderer a pitch
      // inside it. `horizonY` clamps to the same number on the way in, so letting the orbit past it
      // would not tilt the view any further — it would just stop the horizon agreeing with where
      // the camera says it is. Flown straight up and then orbited, the eye gives up 77° worth of
      // height, which is a few hundredths of a tile rather than the drop to 66° above.
      el = clamp(el, -PITCH_LIM, PITCH_LIM);
      // ⚠ AND THE GROUND IS THE REAL LOWER BOUND, solved at THIS radius rather than set as a
      // constant — the same reasoning paintWindshield's `groundPitch` is written on. A fixed floor
      // angle is wrong at every radius but one: dollied in close it stops the camera well above the
      // road, and the shot a ground vehicle most wants is the one level with it.
      el = Math.max(Math.asin(clamp((Z_MIN - ORBIT_PIVOT_Z) / D, -1, 1)), el);
      const rh = D * Math.cos(el), yr = yaw * DEG;
      st.x = -rh * Math.sin(yr); st.y = rh * Math.cos(yr);
      st.z = clamp(ORBIT_PIVOT_Z + D * Math.sin(el), Z_MIN, Z_MAX);
      st.yaw = ((yaw % 360) + 360) % 360;
      st.pitch = -el;
      return true;
    },

    // LEFT LIFTS, RIGHT DROPS — held, not clicked, because a discrete hop is no use for placing a
    // shot. They are spent in `step` beside R and F rather than here, so the speed modifiers, the
    // frame clock and the height clamp are the ones the keyboard already goes through: two ways to
    // raise the camera, one thing that raises it.
    setButton(name, down) {
      if (!st.on || !BTNS.has(name)) return false;
      if (down) st.btn.add(name); else st.btn.delete(name);
      return true;
    },
    get orbiting() { return st.btn.has('orbit'); },

    // The wheel dollies along the view axis — the same thing W and S do, on the control a hand is
    // already resting on. It is a nudge per notch rather than a zoom: changing the focal length
    // would make the camera lie about where it is, and where it is is the entire point of it.
    dolly(dir) {
      if (!st.on) return false;
      const s = Math.sin(st.yaw * DEG), c = Math.cos(st.yaw * DEG);
      const cp = Math.cos(st.pitch), d = (dir < 0 ? 1 : -1) * 0.55;
      st.x += d * s * cp; st.y += d * -c * cp; st.z += d * Math.sin(st.pitch);
      st.z = clamp(st.z, Z_MIN, Z_MAX);
      return true;
    },

    step(dt) {
      if (!st.on) return;
      const d = Math.min(0.1, Math.max(0, dt));
      // TURNING IN PLACE, and it is the control this was missing. A/D strafe — which is the WASD
      // convention and worth keeping — so the camera could be MOVED left and right and, on the
      // keyboard alone, not TURNED. The arrows always could, but a hand on WASD does not want to
      // leave it to aim, and "arrows look" read as pitch rather than as yaw. Q/E cost nothing to
      // reassign: they were a second way to go up and down, and R/F already does that.
      if (held('arrowleft') || held('q')) st.yaw -= LOOK * d;
      if (held('arrowright') || held('e')) st.yaw += LOOK * d;
      if (held('arrowup')) st.pitch = Math.min(PITCH_LIM, st.pitch + LOOK * DEG * d);
      if (held('arrowdown')) st.pitch = Math.max(-PITCH_LIM, st.pitch - LOOK * DEG * d);
      // ROLL, on Z and X. The third rotation, and the only one a chase camera never had — it holds
      // a level horizon by definition, which is exactly the constraint you want removed when the
      // thing you are composing is a photograph. Unbounded both ways: a dutch angle has no natural
      // stopping point and there is nothing to protect, since the world is drawn through one canvas
      // rotate either way (see bankRad).
      if (held('z')) st.roll = Math.max(-ROLL_LIM, st.roll - ROLL_RATE * DEG * d);
      if (held('x')) st.roll = Math.min(ROLL_LIM, st.roll + ROLL_RATE * DEG * d);
      st.yaw = ((st.yaw % 360) + 360) % 360;

      const sp = (held('shift') ? FAST : held('control') ? SLOW : BASE) * d;
      // The view axes, in the frame `makeCam` reads: forward is (sin, −cos) and right is (cos, sin)
      // — the same two expressions the projection is built from, so "forward" here and "into the
      // screen" there cannot drift apart. Forward carries the pitch, because a camera you can only
      // fly horizontally is one you have to fight to get up over a trailer.
      const s = Math.sin(st.yaw * DEG), c = Math.cos(st.yaw * DEG);
      const cp = Math.cos(st.pitch), sp2 = Math.sin(st.pitch);
      const go = (fwd, right, up) => {
        st.x += fwd * s * cp + right * c;
        st.y += fwd * -c * cp + right * s;
        st.z += fwd * sp2 + up;
      };
      if (held('w')) go(sp, 0, 0);
      if (held('s')) go(-sp, 0, 0);
      if (held('d')) go(0, sp, 0);
      if (held('a')) go(0, -sp, 0);
      // Up and down, from the keyboard or from the two mouse buttons the freelook left free. Both
      // held at once cancels, which is the arithmetic doing the right thing rather than a rule.
      if (held('r') || st.btn.has('up')) go(0, 0, sp);
      if (held('f') || st.btn.has('down')) go(0, 0, -sp);
      st.z = clamp(st.z, Z_MIN, Z_MAX);
    },

    // The shape `paintWindshield` reads as `v.freeCam`. x/y are a world-tile offset from the
    // vehicle, z an absolute eye height, yaw degrees, pitch radians.
    view() { return st.on ? { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch, roll: st.roll } : null; },
  };
}

// The one line of chrome all three panels show while it is on. Kept here so the wording is the same
// in a cab, a cockpit and a wheelhouse — three copies of a hint is three things to update.
export const FREECAM_HINT = 'FREE CAM · mouse looks · MMB orbit · LMB/RMB or R/F up-down · WASD move · Q/E turn · Z/X roll · wheel dolly · SHIFT fast · O exit';

// ── BINDING IT TO A SURFACE ──────────────────────────────────────────────────
// The three panels each already own pointer gestures on their glass — the cockpit's yoke drag and
// its middle-button orbit, the cab's look-around — and a detached camera has to take the mouse
// away from all of them without any of them being edited to know it exists. So this binds on the
// CAPTURE phase and stops propagation on the events it consumes: the camera gets first refusal,
// and when it is stowed every one of those gestures behaves exactly as it did before.
//
// ⚠ THE MOUSE ALWAYS LOOKS; THE POINTER LOCK ONLY REMOVES THE EDGE OF THE SCREEN. Both branches
// feed `cam.look` the same way — a delta — so there is one scheme and one control, and the lock is
// an enhancement rather than a precondition: with it the deltas come from `movementX/Y` and a spin
// never runs out of desk, without it they come from the cursor's own travel across the glass and a
// full turn takes a couple of sweeps. That is what leaves all three buttons free for the camera.
//
// ⚠ AND THE LOCK REALLY IS REFUSED SOMEWHERE THAT MATTERS. Measured, not guessed: in the Claude
// desktop app's browser pane `document.featurePolicy.allowsFeature('pointer-lock')` is FALSE at the
// top level — not an iframe, the embedder simply does not grant it — so `requestPointerLock` answers
// `pointerlockerror` and nothing else. An earlier draft made freelook depend on the lock and had a
// comment reasoning that no environment this client runs in would refuse it. It is the environment
// the game is most often looked at from during development, and the whole mouse would have been
// dead there with nothing on screen to say why.
export function bindFreeCamPointer(el, cam) {
  if (!el) return () => {};
  const locked = () => document.pointerLockElement === el;
  // ⚠ CAN THIS DOCUMENT LOCK THE POINTER AT ALL? Everything below that treats a click as "take the
  // pointer" rather than "raise the camera" depends on the answer, and getting it wrong in the
  // pessimistic direction is invisible: the lock is refused, every click is spent asking for it
  // again, and all three buttons are dead with nothing on screen to say so. That shipped for an
  // afternoon and no headless test could see it, because a fake surface always grants the lock.
  //
  // Two sources, because neither alone is enough. The Permissions-Policy answer is authoritative
  // where a browser exposes it (the Claude desktop pane says false there). Otherwise optimism,
  // corrected by the first `pointerlockerror` — and ⚠ that correction is reset when the camera is
  // next opened, because Chrome also refuses a re-request made too soon after Esc, and a permanent
  // flag would turn that momentary no into a session-long one.
  const policyAllows = () => { try { return document.featurePolicy?.allowsFeature?.('pointer-lock') !== false; } catch { return true; } };
  let lockable = policyAllows();
  const grab = () => {
    if (!lockable || locked()) return;
    try { el.requestPointerLock?.()?.catch?.(() => {}); } catch { /* older browsers throw instead */ }
  };
  const release = () => { if (locked()) try { document.exitPointerLock?.(); } catch { /* nothing to undo */ } };

  // ⚠ IMMEDIATE, not merely `stopPropagation`. Stopping propagation stops the event reaching other
  // NODES; it does not stop a second listener on the SAME node, and the cab has one — a bubble
  // handler on the same `.ws-wrap` whose middle-button branch is the chase orbit. Whenever the glass
  // is the event's own target (rather than the canvas inside it) both would run, and a middle-drag
  // would swing the detached camera and the chase camera at once. The binder registers first, which
  // is what makes this reach it.
  const mine = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); };
  const down = (e) => {
    if (!cam.active) return;
    mine(e);
    // ⚠ THE CLICK THAT TAKES THE POINTER MOVES NOTHING. Esc hands the mouse back without stowing the
    // camera (that is Esc's job, not this feature's), so clicking to get the lock again is a thing
    // the player will do repeatedly — and if that same click also counted as "lift", every return to
    // the controls would jolt the shot upward. Where the lock is refused outright this simply never
    // succeeds, and the unlocked branch of 'move' goes on aiming the camera regardless.
    if (lockable && !locked()) { grab(); return; }
    if (e.button === 0) cam.setButton('up', true);
    else if (e.button === 2) cam.setButton('down', true);
    else if (e.button === 1) cam.setButton('orbit', true);
  };
  // Where the cursor was last time, for the unlocked branch. ⚠ A NULL HERE MEANS "NO DELTA YET",
  // and it is the whole of what stops the camera snapping round when the pointer comes back from
  // somewhere else: the first move after a reset records a position and aims nothing.
  let last = null;
  // ⚠ BOTH OF THESE ARE ON THE WINDOW rather than the element: under a lock the events do arrive at
  // the locked element, but a button released after the lock has gone would otherwise never be seen
  // at all — and an unseen release is a camera climbing on its own with nothing to stop it.
  const move = (e) => {
    if (!cam.active) return;
    let dx, dy;
    if (locked()) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else {
      const x = e.clientX, y = e.clientY;
      if (x == null || y == null) return;
      if (!last) { last = { x, y }; return; }
      dx = x - last.x; dy = y - last.y; last = { x, y };
    }
    if (!dx && !dy) return;
    if (cam.orbiting) cam.orbit(dx, dy); else cam.look(dx, dy);
    mine(e);
  };
  const up = (e) => {
    if (!cam.active) return;
    if (e.button === 0) cam.setButton('up', false);
    else if (e.button === 2) cam.setButton('down', false);
    else if (e.button === 1) cam.setButton('orbit', false);
    else cam.releaseButtons();
  };
  // The right button is a camera control now, so the menu it would otherwise open is not one.
  const menu = (e) => { if (cam.active) mine(e); };
  // Esc, a tab switch, a full-screen change: the lock can go without a pointerup ever arriving for
  // whatever was held at the time. See releaseButtons — the keys are deliberately left alone.
  const lockChange = () => { last = null; if (!locked()) cam.releaseButtons(); };
  const lockError = () => { lockable = false; last = null; };
  const wheel = (e) => {
    if (!cam.active) return;
    cam.dolly(e.deltaY);
    mine(e);
  };
  // Taking the pointer the moment the camera comes off its mount, rather than making the player
  // click first: `O` is a keypress, which carries the user activation the lock needs, so the one
  // gesture that detaches the camera is also the one that hands it the mouse.
  const unToggle = cam.onToggle?.((on) => { last = null; if (on) { lockable = policyAllows(); grab(); } else release(); }) || (() => {});

  el.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  el.addEventListener('contextmenu', menu, true);
  document.addEventListener('pointerlockchange', lockChange);
  document.addEventListener('pointerlockerror', lockError);
  el.addEventListener('wheel', wheel, { passive: false, capture: true });
  return () => {
    unToggle();
    release();
    el.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    el.removeEventListener('contextmenu', menu, true);
    document.removeEventListener('pointerlockchange', lockChange);
    document.removeEventListener('pointerlockerror', lockError);
    el.removeEventListener('wheel', wheel, { capture: true });
  };
}
