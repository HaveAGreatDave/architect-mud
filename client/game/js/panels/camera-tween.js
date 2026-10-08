// CAMERA FRAMING: an eased move of a seat's chase camera onto a named shot.
//
// The three seats that host a service bay (cab-view, boat-view, cockpit) all orbit their chase
// camera with the same three numbers: a yaw in degrees, a pitch in radians and a zoom multiplier.
// A garage shows you the part you are buying, so each bay tab asks for a shot and this moves the
// camera there over a moment instead of cutting.
//
// ⚠ THE PLAYER'S HAND WINS. Drag and wheel write the same fields this does. Each step checks the
// fields still hold what it wrote last time; if they don't, somebody else moved the camera and the
// move stops where it is. That needs nothing from the seats' input handlers.
//
// ⚠ YAW IS NET OF 'chaseYaw'. The renderer adds RENDER_TUNE.chaseYaw to whatever yaw a seat sends,
// so a shot's yaw is the angle the player sees (0 astern, 180 ahead, 225 front-right) and the seat
// subtracts chaseYaw before handing it here. See cabView's quarter shot.

// The shots a bay asks for. Net yaw in degrees, pitch in radians above the horizon, zoom as the
// seat's own multiplier (1 is the seat's resting distance).
export const SHOTS = {
  quarter: { yaw: 225, pitch: 0.30, zoom: 1.0 },    // front-right 3/4: the showroom shot
  side:    { yaw: 270, pitch: 0.16, zoom: 1.0 },    // broadside, for paint down the flank
  rear:    { yaw: 320, pitch: 0.22, zoom: 0.95 },   // rear-right 3/4: plate, horn, the deck
  front:   { yaw: 180, pitch: 0.10, zoom: 0.9 },    // nose on and low, for what's under the hood
  low:     { yaw: 140, pitch: 0.05, zoom: 0.9 },    // front-left 3/4 from the floor: tuning
  high:    { yaw: 200, pitch: 0.80, zoom: 1.1 },    // over the top, for the load
};

const live = new WeakMap();   // the seat state → its running move
const motionOff = () => document.documentElement.dataset.motion === 'off'
  || document.body?.dataset?.motion === 'off'
  || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const wrap = (d) => ((d % 360) + 360) % 360;
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);   // smootherstep: no kick at either end

/**
 * Move `obj[keys.yaw|pitch|zoom]` to `to` over `ms`. `to.yaw` is in the seat's own frame (already
 * net of chaseYaw). Any key left out of `to` is left alone. Returns a cancel function.
 */
export function tweenOrbit(obj, keys, to, ms = 700) {
  if (!obj) return () => {};
  live.get(obj)?.();
  const names = ['yaw', 'pitch', 'zoom'].filter((k) => keys[k] && Number.isFinite(to[k]));
  const from = {}, span = {};
  for (const k of names) {
    from[k] = Number(obj[keys[k]]) || 0;
    // Yaw goes the short way round; the others are plain numbers.
    span[k] = k === 'yaw' ? ((wrap(to[k] - from[k]) + 540) % 360) - 180 : to[k] - from[k];
  }
  if (motionOff() || ms <= 0) {
    for (const k of names) obj[keys[k]] = k === 'yaw' ? wrap(from[k] + span[k]) : from[k] + span[k];
    return () => {};
  }
  let raf = 0, dead = false;
  const wrote = {};
  for (const k of names) wrote[k] = from[k];
  const t0 = performance.now();
  const stop = () => { dead = true; cancelAnimationFrame(raf); if (live.get(obj) === stop) live.delete(obj); };
  const step = (now) => {
    if (dead) return;
    // Somebody dragged or wheeled since the last step: hand the camera back.
    for (const k of names) if (Math.abs((Number(obj[keys[k]]) || 0) - wrote[k]) > 1e-6) { stop(); return; }
    const e = ease(Math.min(1, (now - t0) / ms));
    for (const k of names) {
      const v = from[k] + span[k] * e;
      obj[keys[k]] = wrote[k] = k === 'yaw' ? wrap(v) : v;
    }
    if (e >= 1) { stop(); return; }
    raf = requestAnimationFrame(step);
  };
  live.set(obj, stop);
  raf = requestAnimationFrame(step);
  return stop;
}
