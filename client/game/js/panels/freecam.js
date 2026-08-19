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
const OWNED = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control']);

export function createFreeCam() {
  const st = { on: false, x: 0, y: 0, z: 0.45, yaw: 0, pitch: 0, keys: new Set() };
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
    releaseAll() { st.keys.clear(); },

    step(dt) {
      if (!st.on) return;
      const d = Math.min(0.1, Math.max(0, dt));
      if (held('arrowleft')) st.yaw -= LOOK * d;
      if (held('arrowright')) st.yaw += LOOK * d;
      if (held('arrowup')) st.pitch = Math.min(PITCH_LIM, st.pitch + LOOK * DEG * d);
      if (held('arrowdown')) st.pitch = Math.max(-PITCH_LIM, st.pitch - LOOK * DEG * d);
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
    view() { return st.on ? { x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch } : null; },
  };
}

// The one line of chrome all three panels show while it is on. Kept here so the wording is the same
// in a cab, a cockpit and a wheelhouse — three copies of a hint is three things to update.
export const FREECAM_HINT = 'FREE CAM · WASD move · E/Q up-down · arrows look · SHIFT fast · O exit';
