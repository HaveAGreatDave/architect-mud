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
// Degrees of yaw per pixel dragged. Slow enough that a full sweep is a deliberate gesture rather
// than a flick — this is a camera you are aiming, not a first-person shooter.
const MOUSE_YAW = 0.22, MOUSE_PITCH = 0.0038;
const ROLL_RATE = 48;     // degrees per second on Z/X
const ROLL_LIM = Math.PI; // all the way over, both ways: a dutch angle has no natural stopping point

export function createFreeCam() {
  const st = { on: false, x: 0, y: 0, z: 0.45, yaw: 0, pitch: 0, roll: 0, keys: new Set(), drag: null };
  const held = (k) => st.keys.has(k);

  return {
    get active() { return st.on; },
    // Opening it WHERE THE CHASE CAMERA WAS, not at the origin. Dropping the eye to (0,0) on the
    // vehicle's own tile means every session starts inside the bodywork and the first thing anybody
    // does is fly out of it. `seed` is whatever the panel can honestly say about the current shot.
    open(seed = {}) {
      st.on = true;
      st.keys.clear();
      st.yaw = seed.yaw != null ? seed.yaw : 0;
      st.pitch = seed.pitch != null ? seed.pitch : 0;
      st.z = seed.z != null ? seed.z : 0.45;
      st.x = seed.x || 0; st.y = seed.y || 0;
      st.roll = 0; st.drag = null;
    },
    close() { st.on = false; st.keys.clear(); },
    toggle(seed) { if (st.on) this.close(); else this.open(seed); return st.on; },

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
    releaseAll() { st.keys.clear(); st.drag = null; },

    // ── THE MOUSE ─────────────────────────────────────────────────────────────
    // Aiming a camera with four arrow keys is aiming it in four directions. A drag is the gesture
    // this actually wants, and it is the one the chase camera already taught: the orbit spins on a
    // middle-drag, so a detached camera looking around on a LEFT drag reads as the same instrument
    // rather than a new one. The panels decide which button reaches here — the cab and the helm have
    // no competing left-drag, the cockpit's is the yoke and stands down while the camera is out.
    //
    // ⚠ The pointer must be CAPTURED by the caller. Without it a drag that leaves the canvas stops
    // sending moves and the camera stops turning halfway through the sweep, which feels like the
    // control sticking rather than like the mouse leaving.
    beginDrag(px, py) { if (st.on) st.drag = { x: px, y: py }; return !!st.drag; },
    moveDrag(px, py) {
      if (!st.on || !st.drag) return false;
      st.yaw += (px - st.drag.x) * MOUSE_YAW;
      st.pitch = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, st.pitch - (py - st.drag.y) * MOUSE_PITCH));
      st.drag = { x: px, y: py };
      return true;
    },
    endDrag() { const was = !!st.drag; st.drag = null; return was; },
    get dragging() { return !!st.drag; },

    // The wheel dollies along the view axis — the same thing W and S do, on the control a hand is
    // already resting on. It is a nudge per notch rather than a zoom: changing the focal length
    // would make the camera lie about where it is, and where it is is the entire point of it.
    dolly(dir) {
      if (!st.on) return false;
      const s = Math.sin(st.yaw * DEG), c = Math.cos(st.yaw * DEG);
      const cp = Math.cos(st.pitch), d = (dir < 0 ? 1 : -1) * 0.55;
      st.x += d * s * cp; st.y += d * -c * cp; st.z += d * Math.sin(st.pitch);
      st.z = Math.max(-0.6, Math.min(40, st.z));
      return true;
    },

    step(dt) {
      if (!st.on) return;
      const d = Math.min(0.1, Math.max(0, dt));
      if (held('arrowleft')) st.yaw -= LOOK * d;
      if (held('arrowright')) st.yaw += LOOK * d;
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
      if (held('r') || held('e')) go(0, 0, sp);
      if (held('f') || held('q')) go(0, 0, -sp);
      // It may go under the road — briefly, and on purpose, because a low shot looking up at a rig
      // is worth having and the ground is not solid to a camera. What it may not do is fall forever.
      st.z = Math.max(-0.6, Math.min(40, st.z));
    },

    // The shape `paintWindshield` reads as `v.freeCam`. x/y are a world-tile offset from the
    // vehicle, z an absolute eye height, yaw degrees, pitch radians.
    view() { return st.on ? { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch, roll: st.roll } : null; },
  };
}

// The one line of chrome all three panels show while it is on. Kept here so the wording is the same
// in a cab, a cockpit and a wheelhouse — three copies of a hint is three things to update.
export const FREECAM_HINT = 'FREE CAM · drag to look · wheel dolly · WASD move · E/Q up-down · Z/X roll · SHIFT fast · O exit';

// ── BINDING IT TO A SURFACE ──────────────────────────────────────────────────
// The three panels each already own pointer gestures on their glass — the cockpit's yoke drag and
// its middle-button orbit, the cab's look-around — and a detached camera has to take the mouse
// away from all of them without any of them being edited to know it exists. So this binds on the
// CAPTURE phase and stops propagation on the events it consumes: the camera gets first refusal,
// and when it is stowed every one of those gestures behaves exactly as it did before.
//
// ⚠ The pointer is captured on the element. Without that, a drag that runs off the edge of the
// canvas stops delivering moves and the camera stops turning mid-sweep — which reads as the control
// sticking rather than as the mouse having left.
export function bindFreeCamPointer(el, cam) {
  if (!el) return () => {};
  const down = (e) => {
    if (!cam.active || e.button !== 0) return;
    cam.beginDrag(e.clientX, e.clientY);
    try { el.setPointerCapture(e.pointerId); } catch { /* not fatal — the window move below still tracks */ }
    e.preventDefault(); e.stopPropagation();
  };
  // On the window rather than the element: a capture can be lost (a dropped pointerId, a browser
  // quirk) and the drag should still track rather than freeze.
  const move = (e) => { if (cam.moveDrag(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); } };
  const up = () => { cam.endDrag(); };
  const wheel = (e) => {
    if (!cam.active) return;
    cam.dolly(e.deltaY);
    e.preventDefault(); e.stopPropagation();
  };
  el.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  el.addEventListener('wheel', wheel, { passive: false, capture: true });
  return () => {
    el.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    el.removeEventListener('wheel', wheel, { capture: true });
  };
}
