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
// ── AND THE RIM OF THE GLASS KEEPS TURNING ───────────────────────────────────
// Without a pointer lock the aim reads the cursor's TRAVEL, and travel telescopes: every delta the
// glass will ever report sums to `x_now − x_start`, which is bounded by the width of the window. At
// MOUSE_YAW that is 141° on a 640px pane and 180° on an 820px one — and a second sweep does not add
// to it, because bringing the cursor back un-turns exactly what it turned. So the camera reaches the
// right-hand edge of the screen and stops turning right, for the rest of the session. Pitch is
// clipped the same way on any pane under 720px tall, which is most of them.
//
// ⚠ THE COMMENT ON bindFreeCamPointer USED TO SAY "a full turn takes a couple of sweeps". It cannot:
// putting the cursor back is the whole of what the lock does, and without it there is no second
// sweep to be had. Reported as the camera only going half way round, and 180° is what the arithmetic
// says the widest ordinary pane will give.
//
// So the rim of the glass keeps the gesture going: a cursor parked in the last strip of it goes on
// aiming at a rate, the way an RTS scrolls its map when you push a map edge. It COMPOSES with the
// delta rather than replacing it — fine aim in the middle of the glass, an unbounded turn at the
// edge of it — and it is the UNLOCKED branch alone, because under a lock the pointer is nowhere and
// there is no rim to be near.
//
// ⚠ IT IS SPENT AS PIXELS PER SECOND, NOT AS DEGREES, and goes through the same `aim` the mouse
// does. A degrees-per-second constant here would be a second opinion about what a pixel is worth,
// which is the one thing MOUSE_YAW and MOUSE_PITCH are written to agree about; this way the two axes
// stay matched at the rim for free.
const EDGE_MARGIN = 96, EDGE_PX = 620;
// ── THE KEY THAT HANDS THE MOUSE BACK ────────────────────────────────────────
// Deliberately NOT in OWNED: that set is keys whose HELD state flies the camera, and this one is an
// edge.
//
// ⚠ U AND N ARE THE ONLY LETTERS LEFT, and that is measured rather than eyeballed. The cab binds
// nearly the whole alphabet — K cranks the engine, M swaps the box to auto, P parks, T opens the
// galley — and the cockpit most of the rest; two earlier picks, M and then K, were each already
// the cab's. A collision would in fact be harmless, because `onKey`'s first line means a STOWED
// camera consumes nothing and the seat's own keys are suspended while it is out (the camera
// already takes W/A/S/D, Z and X/C exactly that way, and the harness asserts the stowed half).
// But harmless is not the same as free: a driver pressing a key should not have to know which
// mode they are in to know what it does.
const POINTER_KEY = 'u';
// ── HOW FAST IT FLIES ────────────────────────────────────────────────────────
// A multiplier on everything in `step` that MOVES the camera, on [ and ]. BASE and FAST are two
// speeds and the gap between them is the whole of what the camera has: crossing the Basin at 5.5
// tiles a second is a long wait, and placing an eye a hand's breadth off a sign at 1.1 overshoots
// the shot every time. The modifiers stay exactly what they are and multiply THROUGH this, so a rung
// moves the walk, the sprint and the crawl together rather than being a fourth speed to remember.
//
// ⚠ GEOMETRIC, AND ITS OWN INVERSE AT EVERY RUNG — the rule the lens ladder is written to, for the
// same reason: a step down and back up is the speed you had, and a stop that is not a power of the
// step would quietly break that at the ends.
//
// ⚠ AND NO READOUT, WHICH IS A DECISION RATHER THAN AN OMISSION. The wheel's own nine-rung ladder
// has none either: you judge a lens by the picture and a speed by how fast the camera moves, and a
// number on the glass would be a number in a shot somebody is composing. What makes that honest is
// that `open` puts it back to 1 — the same reason the fov beside it does — so a rung is always
// counted from a known place rather than from wherever the last session left it.
const SPEED_STEP = 1.5, SPEED_LIM = 4;
const SPEED_MIN = Math.pow(SPEED_STEP, -SPEED_LIM), SPEED_MAX = Math.pow(SPEED_STEP, SPEED_LIM);
// ⚠ NOT IN `OWNED`: that set is keys whose HELD state flies the camera, and these are edges. They
// deliberately do NOT guard on repeat the way POINTER_KEY does — holding one is a ramp, which is the
// obvious thing to do with a ladder and costs nothing to allow.
const SPEED_DOWN = '[', SPEED_UP = ']';
const ROLL_RATE = 48;     // degrees per second on Z/X
const ROLL_LIM = Math.PI; // all the way over, both ways: a dutch angle has no natural stopping point
// The camera may go under the road — briefly, and on purpose, because a low shot looking up at a
// rig is worth having and the ground is not solid to a camera. What it may not do is fall forever.
const Z_MIN = -0.6, Z_MAX = 40;
// ── THE LENS ─────────────────────────────────────────────────────────────────
// A multiplier on the focal length, spent as the renderer's own `fovMul` — 1 is the seat's field of
// view, above it a longer lens, below it a wider one. It is the OTHER half of the wheel, and the
// difference is the whole reason both are here rather than one: a dolly moves the eye and a zoom
// does not, so the two can frame the same subject at the same size and disagree about everything
// behind it. Bounded either side, because past the top end the ground plane is a slab and the frame
// is all texture, and past the bottom a building two tiles away has receded into scenery.
// ⚠ THE STEP IS ITS OWN INVERSE. A notch down and back up is the shot you had — the reversibility
// the orbit is written for, and why this is not the chase camera's 1.1/0.9 (which is 0.99).
const FOV_MAX = 3.2, FOV_STEP = 1.1;
// ⚠ AND THE WIDE STOP IS A PAN LIMIT, NOT A FRAMING ONE. `proj` is a pinhole, so a yaw moves a
// point by FL·tan and its pan rate goes as sec² of its angle off the optical axis — the wider the
// lens, the more a turn SHEARS the frame instead of turning it. At the seat's own lens the corner
// of the frame is 59° off axis and pans 3.8× the centre, which reads as an ordinary wide lens.
// This was 0.4: a 146° field whose corner is 76° off axis and pans 16.5×, so the middle of the
// shot barely moved while the sides tore past — reported as the whole city shifting when you look
// left and right, and only at the wide end of the wheel. Four notches down is the last one that
// keeps the corner under 68° (128°, 7.0×): still a genuinely wide lens, about double the seat's
// own shear rather than four times it. ⚠ ON THE LADDER DELIBERATELY — a stop that is not a power
// of the step makes the step stop being its own inverse at the clamp, so a wheel down to the stop
// and back up would never return to the 1 it started from.
const FOV_MIN = Math.pow(FOV_STEP, -4);   // ≈0.683
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
  const st = { on: false, x: 0, y: 0, z: 0.45, yaw: 0, pitch: 0, roll: 0, fov: 1, speed: 1, px: 0, py: 0, keys: new Set(), btn: new Set(), notify: null, hold: true, holdNotify: null };
  const held = (k) => st.keys.has(k);

  // ── ONE PLACE WHERE A PIXEL BECOMES AN ANGLE ────────────────────────────────
  // Both the mouse and the rim push spend their travel here, which is what keeps them one control
  // rather than two: the rim is the same gesture continuing, so it must turn the camera at exactly
  // the rate the hand was turning it, and a second copy of this arithmetic is a second answer to
  // that. See EDGE_PX for why the push arrives as pixels rather than as degrees.
  const aim = (dx, dy) => {
    st.yaw = ((st.yaw + dx * MOUSE_YAW) % 360 + 360) % 360;
    st.pitch = clamp(st.pitch - dy * MOUSE_PITCH, -PITCH_LIM, PITCH_LIM);
  };
  // The rim push stops the moment the gesture it belongs to does. Anything that takes the mouse away
  // — the pointer handed back, the lock arriving, the camera stowed, a blur — comes through here, and
  // a push left set by one of them is a camera turning on its own with nothing on screen doing it.
  const stopPush = () => { st.px = 0; st.py = 0; };

  // ── WHO HAS THE MOUSE ───────────────────────────────────────────────────────
  // Two states, and the camera opens in the first. HELD: the cursor is gone, pinned inside the view,
  // and moving the mouse aims. FREE: it is a cursor again and aims nothing, which is the only way to
  // reach a button on the screen without the shot swinging on the way to it.
  //
  // ⚠ THIS IS NOT THE SAME QUESTION AS "IS THE POINTER LOCKED", and conflating them is the mistake
  // bindFreeCamPointer already has a paragraph about. The lock is refused outright by some embedders;
  // where it is, HELD still aims — it simply cannot hide the cursor by the browser's own means. Tie
  // the aim to the lock and the mouse is dead in exactly those places.
  const setHold = (v) => {
    const want = !!v;
    if (!st.on || want === st.hold) return st.hold;
    st.hold = want;
    // A button still down when the mouse is handed back never gets its pointerup, and an unseen
    // release is a camera that climbs on its own with nothing the player can press to stop it.
    // …and so is a rim push, for the same reason: a camera left turning after the mouse was handed
    // back is one no cursor on the screen is touching.
    if (!want) { st.btn.clear(); stopPush(); }
    st.holdNotify?.(want);
    return st.hold;
  };

  return {
    get active() { return st.on; },
    // Opening it WHERE THE CHASE CAMERA WAS, not at the origin. Dropping the eye to (0,0) on the
    // vehicle's own tile means every session starts inside the bodywork and the first thing anybody
    // does is fly out of it. `seed` is whatever the panel can honestly say about the current shot.
    open(seed = {}) {
      st.on = true;
      st.keys.clear(); st.btn.clear();
      // ⚠ BEFORE THE `notify` AT THE FOOT OF THIS FUNCTION, which is what the binder reads to decide
      // whether to take the pointer. A camera that opened free would hand the player a cursor and a
      // line of help telling them to press M to get rid of it.
      st.hold = true;
      st.yaw = seed.yaw != null ? seed.yaw : 0;
      st.pitch = seed.pitch != null ? seed.pitch : 0;
      st.z = seed.z != null ? seed.z : 0.45;
      st.x = seed.x || 0; st.y = seed.y || 0;
      st.roll = 0;
      // The lens comes back to the seat's own, for the reason the roll does: the shot you were
      // handed is the one the panel can honestly describe, and it cannot describe a zoom it has
      // never had. Opening on last session's 3x would read as the camera arriving broken.
      st.fov = 1;
      // And the speed ladder, for the same reason and with the same argument: the shot the panel
      // hands over is one it can honestly describe, and opening at last session's 5x would read as
      // the camera arriving with the throttle stuck open. See SPEED_STEP.
      st.speed = 1;
      stopPush();
      st.notify?.(true);
    },
    close() { st.on = false; st.keys.clear(); st.btn.clear(); stopPush(); st.notify?.(false); },
    toggle(seed) { if (st.on) this.close(); else this.open(seed); return st.on; },

    // The surface asking to be told when the camera comes out and goes back on its mount, so it can
    // take the pointer and give it back. ONE listener, because exactly one element owns the mouse
    // at a time and a second would be a second thing fighting for the lock. Returns its own removal
    // and clears only if it is still the one installed — the cab rebinds on every panel open, and a
    // stale teardown must not unhook the live surface.
    onToggle(fn) { st.notify = fn || null; return () => { if (st.notify === fn) st.notify = null; }; },

    // See setHold. One listener, for the reason onToggle takes one: exactly one surface owns the
    // mouse at a time, and a second subscriber would be a second thing fighting over it.
    get mouseHeld() { return st.hold; },
    setMouseHeld(v) { return setHold(v); },
    onMouseHeld(fn) { st.holdNotify = fn || null; return () => { if (st.holdNotify === fn) st.holdNotify = null; }; },

    // Returns true when the camera consumed the key, which is the panel's cue not to also steer the
    // vehicle with it. ⚠ Every one of these is a driving control on at least one of the three
    // panels (w/s is the throttle in the cab, a/d the wheel), so an inactive camera must consume
    // NOTHING — the check on `st.on` is the whole safety of routing key events through here.
    onKey(key, down) {
      if (!st.on) return false;
      const k = String(key || '').toLowerCase();
      // ⚠ AN EDGE, NOT A HELD STATE — and guarded on the set rather than on the panel's own
      // `e.repeat`, because two of the three panels forward the key without it and a held M would
      // otherwise hand the mouse back and take it again at the keyboard's repeat rate.
      if (k === POINTER_KEY) {
        if (!down) st.keys.delete(k);
        else if (!st.keys.has(k)) { st.keys.add(k); setHold(!st.hold); }
        return true;
      }
      // The speed ladder. See SPEED_STEP: an edge on the way down and nothing on the way up, and
      // deliberately no repeat guard, so holding one ramps at the keyboard's own rate.
      if (k === SPEED_DOWN || k === SPEED_UP) {
        // ⚠ DIVIDED, NOT MULTIPLIED BY THE RECIPROCAL. At THIS step the two happen to agree — 3ⁿ/2ⁿ
        // is exact in binary for every rung the ladder has, so both spellings come back to 1 — and
        // that is a property of 1.5 rather than of the code. Measured at the lens ladder's own step
        // next door: four notches up and four down through `1 / FOV_STEP` lands on 1.0000000000000004
        // and through a divide lands on 1, so the sentence `zoom` writes about itself is already off
        // by a hair. Spelling it as a divide is what keeps this one true if anybody retunes the step.
        if (down) st.speed = clamp(k === SPEED_UP ? st.speed * SPEED_STEP : st.speed / SPEED_STEP, SPEED_MIN, SPEED_MAX);
        return true;
      }
      if (!OWNED.has(k)) return false;
      if (down) st.keys.add(k); else st.keys.delete(k);
      return true;
    },
    // A blur or a panel teardown must not leave a key stuck down, or the camera drifts off on its
    // own with nobody touching it and no way to stop it but pressing and releasing the same key.
    releaseAll() { st.keys.clear(); st.btn.clear(); stopPush(); },
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
      aim(dx, dy);
      return true;
    },

    // ── THE RIM OF THE GLASS ──────────────────────────────────────────────────
    // How hard the cursor is being pushed into the edge of the view, per axis, as a signed fraction
    // of EDGE_MARGIN — 0 anywhere but the last strip of it, ±1 at the very edge and past it. The
    // binder works it out because it is the half that has an element to measure; this end spends it
    // in `step`, so the rim turn goes through the same frame clock everything else does and a
    // hitched frame cannot swing the shot.
    //
    // ⚠ IT IS A STATE, NOT AN EVENT. A cursor sitting still in the rim is still pushing, which is
    // the entire point — it is what makes the turn unbounded where a delta cannot be.
    setLookPush(px, py) {
      if (!st.on) return false;
      st.px = clamp(px || 0, -1, 1);
      st.py = clamp(py || 0, -1, 1);
      return true;
    },
    get lookPush() { return { x: st.px, y: st.py }; },

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

    // ── THE WHEEL ZOOMS ───────────────────────────────────────────────────────
    // The lens, on the control every other application in the world puts a zoom on. It changes the
    // focal length and NOTHING about where the camera is, which is exactly the objection the dolly
    // below was written against — and the objection is right, it is just not an argument for having
    // only one of them. A dolly walks the eye toward the subject and the background grows with it;
    // a zoom crops, and the background stays where it was. Those are two different photographs of
    // the same thing, and a camera you are composing shots with wants to be able to take both.
    //
    // ⚠ IT IS A MULTIPLIER ON THE FOCAL LENGTH, NOT A CROP OF THE CANVAS. It leaves here as
    // `view().fov` and is spent as the renderer's `fovMul`, which scales the LATERAL and VERTICAL
    // focal lengths together — so the world gets bigger and keeps its proportions. That is the one
    // thing this must not get wrong, and it is a mistake the renderer has already made once: see
    // makeCam's ⚠, where a per-seat field of view multiplied one axis and read as an anamorphic
    // stretch rather than as a lens.
    zoom(dir) {
      if (!st.on) return false;
      st.fov = clamp(st.fov * (dir < 0 ? FOV_STEP : 1 / FOV_STEP), FOV_MIN, FOV_MAX);
      return true;
    },

    // The dolly, on SHIFT+wheel — the same thing W and S do, on the control a hand is already
    // resting on. It is a nudge per notch, and it MOVES THE CAMERA: where the eye is is a real fact
    // about the shot, and nothing above changes it.
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
      // THE RIM, spent as the pixels the hand would have gone on travelling if the desk had not run
      // out. See EDGE_PX — it goes through `aim`, so it wraps the yaw and stops at PITCH_LIM on the
      // way in exactly as the mouse does, and the arrows above cannot disagree with it.
      if (st.px || st.py) aim(st.px * EDGE_PX * d, st.py * EDGE_PX * d);
      st.yaw = ((st.yaw % 360) + 360) % 360;

      // ⚠ THE LADDER MULTIPLIES THROUGH THE MODIFIERS rather than sitting beside them, so [ and ]
      // move the walk, the sprint and the crawl together. See SPEED_STEP.
      const sp = (held('shift') ? FAST : held('control') ? SLOW : BASE) * st.speed * d;
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
    // vehicle, z an absolute eye height, yaw degrees, pitch radians, fov a focal-length multiplier.
    view() { return st.on ? { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch, roll: st.roll, fov: st.fov } : null; },
    // Not part of `view` — the renderer has no use for it and would be the wrong reader anyway. It
    // is here because the harness has to be able to ask, and a second copy of the ladder there would
    // be a second opinion about where the stops are.
    get speed() { return st.speed; },
  };
}

// The one line of chrome all three panels show while it is on. Kept here so the wording is the same
// in a cab, a cockpit and a wheelhouse — three copies of a hint is three things to update.
export const FREECAM_HINT = 'FREE CAM · mouse looks, screen edge keeps turning · MMB orbit · LMB/RMB or R/F up-down · WASD move · [ ] speed · Q/E turn · Z/X roll · wheel zoom · SHIFT+wheel dolly · SHIFT fast · U free mouse · O exit';

// ── AND THEN THE SCREEN CLEARS ITSELF ────────────────────────────────────────
//
// Everything the vehicle reads out goes the moment the camera comes off its mount — the fuel, the
// damage, the warnings, the name of the boat (each panel's own stylesheet says which). That leaves
// the two things that cannot simply go: the corner buttons, because one of them is a way back, and
// the line of help, because it is the OTHER way back written down. Both are in the shot.
//
// So they go on a timer, the way a video player's controls do. Any input at all brings them
// straight back; a few seconds of stillness takes them away again — and a few seconds of stillness
// is exactly what composing a frame and then reaching for the screenshot key looks like. Nothing
// is ever unreachable: a player who has forgotten the key moves the mouse and the row is there.
//
// ⚠ IT IS A CLASS ON THE BODY AND NOT ON THE SEAT, because what it changes is which of the PAGE's
// controls are on screen — the same argument `fsim-freecam` and `helm-freecam` are already body
// classes for, and the only way one rule can reach a wheelhouse console that is not inside the
// view it belongs to. The three stylesheets spell the word out rather than interpolating it, so
// that grepping for it finds the rules and not just this line.
const FREECAM_IDLE = 'freecam-idle';
const IDLE_MS = 2400;
// Every way a player can say they are still here. Capture-phase and passive: this only ever reads
// the clock, so nothing below it can be starved of an event and nothing here can swallow one.
const IDLE_WAKERS = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup'];

export function bindFreeCamIdle(cam, ms = IDLE_MS) {
  // ⚠ ONE TIMER, RE-ARMED OFF A STAMP, rather than torn down and rebuilt on every event. Under a
  // pointer lock `pointermove` arrives at the mouse's own polling rate — a thousand a second on
  // some — and this listener sits on the window for as long as the seat is open.
  let t = 0, last = 0;
  const tick = () => {
    t = 0;
    if (!cam.active) return;
    const left = ms - (performance.now() - last);
    if (left > 16) { t = setTimeout(tick, left); return; }   // woken since it was armed
    document.body.classList.add(FREECAM_IDLE);
  };
  // Called by the panel on the keypress that detaches the camera and on the one that puts it back:
  // entering arms the timer, leaving clears the class whether a timer was running or not.
  const wake = () => {
    last = performance.now();
    document.body.classList.remove(FREECAM_IDLE);
    if (cam.active && !t) t = setTimeout(tick, ms);
  };
  // ⚠ GUARDED ON `cam.active`, because the class is on the body and the seat is not. A camera
  // bound behind a seat that is not the one being flown must not wake the chrome of the one that
  // is — and it must not arm a timer on every keystroke in the game either.
  const onInput = () => { if (cam.active) wake(); };
  const opts = { passive: true, capture: true };
  for (const ev of IDLE_WAKERS) window.addEventListener(ev, onInput, opts);
  return {
    wake,
    unbind() {
      for (const ev of IDLE_WAKERS) window.removeEventListener(ev, onInput, opts);
      if (t) clearTimeout(t);
      t = 0;
      document.body.classList.remove(FREECAM_IDLE);
    },
  };
}

// ── BINDING IT TO A SURFACE ──────────────────────────────────────────────────
// The three panels each already own pointer gestures on their glass — the cockpit's yoke drag and
// its middle-button orbit, the cab's look-around — and a detached camera has to take the mouse
// away from all of them without any of them being edited to know it exists. So this binds on the
// CAPTURE phase and stops propagation on the events it consumes: the camera gets first refusal,
// and when it is stowed every one of those gestures behaves exactly as it did before.
//
// ⚠ THE MOUSE ALWAYS LOOKS; THE POINTER LOCK ONLY REMOVES THE EDGE OF THE SCREEN. Both branches
// feed the same `aim` — a delta — so there is one scheme and one control, and the lock is an
// enhancement rather than a precondition: with it the deltas come from `movementX/Y` and a spin
// never runs out of desk, without it they come from the cursor's own travel across the glass and the
// rim of the glass carries the turn on from there. That is what leaves all three buttons free.
//
// ⚠ AND "a full turn takes a couple of sweeps" IS WHAT THIS USED TO SAY, WHICH IS IMPOSSIBLE. A
// delta scheme telescopes — see EDGE_MARGIN — so there is no second sweep, and the reachable turn
// was one screen width of it and then nothing. That is the bug the rim exists for, and it is worth
// leaving the wrong sentence written down: the arithmetic that disproves it is one subtraction, and
// nobody did it for months because the sentence sounded like it had been thought about.
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
  // …and whether the request currently in flight had a user gesture behind it. See lockError.
  let asked = false;
  const grab = (gesture) => {
    if (!lockable || locked()) return;
    asked = !!gesture;
    try { el.requestPointerLock?.()?.catch?.(() => {}); } catch { /* older browsers throw instead */ }
  };
  const release = () => { if (locked()) try { document.exitPointerLock?.(); } catch { /* nothing to undo */ } };

  // ⚠ AND WHERE THE LOCK IS REFUSED, HIDE THE CURSOR ANYWAY. Under a granted lock the browser does
  // this itself and the line below is redundant; where the request is refused it is the only half of
  // "the cursor is out of the shot" still available, and it is the half that was being reported —
  // an arrow drifting across a frame somebody is composing. It is an INLINE style on purpose: it has
  // to beat the cab's own `.ws-wrap{cursor:grab}` rule, and an inline one does. The previous value
  // is kept rather than assumed empty, so putting it back cannot quietly delete a panel's own.
  // ⚠ GUARDED, because it is a DECORATION and the thing it sits in front of is not. A surface
  // with no `style` (the headless harness's own, and anything else that is not a live element) would
  // throw here and take `applyHold` down with it — so the pointer would never be requested at all,
  // and hiding the cursor would have broken the lock it exists to go with.
  let cursorWas = null;
  const hideCursor = (on) => {
    if (!el.style) return;
    if (on) { if (cursorWas === null) cursorWas = el.style.cursor || ''; el.style.cursor = 'none'; }
    else if (cursorWas !== null) { el.style.cursor = cursorWas; cursorWas = null; }
  };
  // The whole of what HELD and FREE mean to the pointer. `last` is dropped either way: a delta
  // measured against where the cursor was before it went away, or before it came back, is a jump.
  const applyHold = (hold) => {
    last = null;
    cam.setLookPush?.(0, 0);
    if (hold) { hideCursor(true); grab(false); } else { release(); hideCursor(false); }
  };

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
    // ⚠ AND IT PUTS THE HELD/FREE STATE BACK WITH IT, whatever handed the pointer over — Esc, a tab
    // switch, or M. A click that took the lock without saying so would leave `mouseHeld` false while
    // the cursor was gone again: the aim dead, and M toggling a flag the screen disagrees with.
    // Re-taking it even after a deliberate M is the right trade, because the glass has nothing on it
    // to click — every panel keeps its chrome OUTSIDE the surface this binds to — so a click on the
    // view can only mean "carry on looking", and it is what a hand that hit Esc by reflex reaches for.
    if (lockable && !locked()) { cam.setMouseHeld?.(true); grab(true); return; }
    if (e.button === 0) cam.setButton('up', true);
    else if (e.button === 2) cam.setButton('down', true);
    else if (e.button === 1) cam.setButton('orbit', true);
  };
  // Where the cursor was last time, for the unlocked branch. ⚠ A NULL HERE MEANS "NO DELTA YET",
  // and it is the whole of what stops the camera snapping round when the pointer comes back from
  // somewhere else: the first move after a reset records a position and aims nothing.
  let last = null;
  // ── HOW HARD THE CURSOR IS PUSHING AT THE EDGE ──────────────────────────────
  // The binder's half of the rim turn: the cam owns the frame clock and spends this, and this end
  // owns the element and so is the only one that can measure it. See EDGE_MARGIN.
  //
  // ⚠ IT SATURATES OUTSIDE THE GLASS RATHER THAN FALLING OFF IT. A cursor the window has stopped
  // following is a cursor still being pushed — a clamp of ±1 is the whole of what makes the turn go
  // on once the desk has genuinely run out, which is the case the feature exists for.
  //
  // ⚠ AND THE MARGIN CANNOT BE A CONSTANT ON A SMALL VIEW. At 96px on a 200px-wide pane the two rims
  // meet in the middle and there is nowhere left to aim by hand, so it takes a third of the shorter
  // side as its ceiling and the two halves stay a rim rather than becoming the whole glass.
  const edgePush = (x, y) => {
    const r = el.getBoundingClientRect?.();
    if (!r || !(r.width > 0) || !(r.height > 0)) return;
    const m = Math.min(EDGE_MARGIN, r.width / 3, r.height / 3);
    const f = (v, lo, hi) => (v < lo + m ? (v - (lo + m)) / m : v > hi - m ? (v - (hi - m)) / m : 0);
    cam.setLookPush?.(f(x, r.left, r.right), f(y, r.top, r.bottom));
  };
  // ⚠ BOTH OF THESE ARE ON THE WINDOW rather than the element: under a lock the events do arrive at
  // the locked element, but a button released after the lock has gone would otherwise never be seen
  // at all — and an unseen release is a camera climbing on its own with nothing to stop it.
  const move = (e) => {
    if (!cam.active) return;
    // ⚠ A FREE MOUSE IS A CURSOR AND AIMS NOTHING. That is the entire point of handing it back: with
    // the look still live, crossing the glass to reach a button swings the shot on the way, which is
    // the awkwardness this was built to remove. A DRAG is the exception, because a held button is an
    // unambiguous gesture — the middle-button turntable every other view in the game already has.
    if (!cam.mouseHeld && !cam.orbiting) { last = null; cam.setLookPush?.(0, 0); return; }
    let dx, dy;
    // ⚠ NO RIM UNDER A LOCK, AND NONE WHILE ORBITING. Under a lock the pointer is nowhere, so
    // `clientX` is a frozen number that would read as a permanent push in whichever corner it
    // happened to stop; and the turntable is a drag whose subject stays centred, so a rim turn added
    // on top of it would swing the very thing it exists to hold still.
    if (locked() || cam.orbiting) { cam.setLookPush?.(0, 0); }
    if (locked()) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else {
      const x = e.clientX, y = e.clientY;
      if (x == null || y == null) return;
      if (!cam.orbiting) edgePush(x, y);
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
  // ⚠ AND THE STATE FOLLOWS THE BROWSER. Esc takes the lock away and leaves the camera out, so a
  // `mouseHeld` that stayed true would leave M toggling a flag that already says "held" while the
  // cursor is plainly back on the screen — one press doing nothing, which reads as a dead key.
  const lockChange = () => {
    last = null;
    // Either direction: taking the lock makes the cursor's position meaningless, and losing it means
    // we no longer know where the cursor is. A push carried across that is one nobody is making.
    cam.setLookPush?.(0, 0);
    if (locked()) { asked = false; return; }
    cam.releaseButtons();
    cam.setMouseHeld?.(false);
  };
  // Where the lock was refused there is no `pointerlockchange` for Esc to arrive on, and the cursor
  // is hidden by the line above rather than by the browser — so the one key everybody presses to get
  // a mouse back has to be heard directly. ⚠ NOT SWALLOWED: Esc leaves fullscreen and closes panels,
  // and a key that quietly stopped doing those would be a worse trade than the one being fixed.
  const esc = (e) => { if (cam.active && cam.mouseHeld && !locked() && e.key === 'Escape') cam.setMouseHeld?.(false); };
  // ⚠ A REFUSAL IS NOT ALWAYS A POLICY, AND TREATING IT AS ONE IS HALF OF THE 180° ABOVE. The lock
  // is also refused for want of a user gesture, and FREELOOK OPENS ON A SERVER MESSAGE — the camera
  // comes out because a `freelook_open` arrived over the socket, not because a key was pressed — so
  // the request `applyHold` makes at open time can be refused in a browser that would grant the very
  // same request off the next click. Condemning `lockable` there leaves every later click taking the
  // buttons branch instead of re-asking, and the camera on the bounded-drag branch for the whole
  // session. The cab and the cockpit never saw it, because O is a keypress and carries its own
  // activation; this is why the complaint was about freelook and nothing else.
  //
  // So only a GESTURE's own refusal is taken as a no. A refusal of the speculative open-time request
  // costs nothing and is forgotten — the click that follows is the one whose answer means something.
  const lockError = () => { last = null; if (asked) lockable = false; asked = false; };
  // The wheel is the lens; SHIFT on it is the dolly. See cam.zoom for why both exist.
  //
  // ⚠ A SHIFTED WHEEL ARRIVES ON THE OTHER AXIS. Chrome and Edge turn a shifted vertical wheel into
  // horizontal scroll — `deltaY` is 0 and the notch is in `deltaX` — so a modifier read off deltaY
  // alone is one that silently does nothing on the commonest desktop browser. Reading either axis
  // costs nothing and is also what makes a horizontal trackpad swipe work as the same control.
  const wheel = (e) => {
    if (!cam.active) return;
    const d = e.deltaY || e.deltaX;
    if (d) { if (e.shiftKey) cam.dolly(d); else cam.zoom(d); }
    mine(e);
  };
  // Taking the pointer the moment the camera comes off its mount, rather than making the player
  // click first: `O` is a keypress, which carries the user activation the lock needs, so the one
  // gesture that detaches the camera is also the one that hands it the mouse.
  const unToggle = cam.onToggle?.((on) => {
    if (on) { lockable = policyAllows(); applyHold(cam.mouseHeld); }
    else { last = null; cam.setLookPush?.(0, 0); release(); hideCursor(false); }
  }) || (() => {});
  // M, routed here from whichever panel is forwarding keys. See createFreeCam's setHold.
  const unHold = cam.onMouseHeld?.(applyHold) || (() => {});

  el.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  el.addEventListener('contextmenu', menu, true);
  document.addEventListener('pointerlockchange', lockChange);
  document.addEventListener('pointerlockerror', lockError);
  window.addEventListener('keydown', esc, true);
  el.addEventListener('wheel', wheel, { passive: false, capture: true });
  return () => {
    unToggle();
    unHold();
    release();
    hideCursor(false);
    cam.setLookPush?.(0, 0);
    el.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    el.removeEventListener('contextmenu', menu, true);
    document.removeEventListener('pointerlockchange', lockChange);
    document.removeEventListener('pointerlockerror', lockError);
    window.removeEventListener('keydown', esc, true);
    el.removeEventListener('wheel', wheel, { capture: true });
  };
}
