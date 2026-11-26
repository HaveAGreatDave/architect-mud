// The frame-rate governor (Settings → Graphics → Frame Rate): every view's frame loop asks
// `requestAnimationFrame`, so capping the page's frame rate is done once, here, by standing in for it.
//
//   'vsync'    the browser's own: one frame a screen refresh. Nothing is wrapped.
//   '60', '30' at most that many frames a second. Frames are still taken on a refresh, so a 60 Hz
//              screen at '30' gets every second one; on a 144 Hz screen '60' alternates two and
//              three refreshes and averages 60.
//   'off'      no governor: a frame is called as soon as the last one's callbacks have run (a 0 ms
//              timer), so the paint runs as fast as the CPU allows. ⚠ A browser can't switch vsync
//              off: what reaches the screen is still shown on its refresh. This is for reading the
//              real paint rate with the perf meter, and it keeps one core busy.
//
// Callbacks queued in one frame are all called with the same timestamp, as the browser does.
// cancelAnimationFrame takes either kind of id.

let native = null;              // the browser's pair, once wrapped
let mode = 'vsync';
let interval = 0;               // ms between frames for a cap
let queue = new Map();          // id -> callback, waiting for the next frame
let nextId = 1e9;               // well clear of the browser's own ids
let pending = false;            // a pump is scheduled
let last = 0;                   // the time the last capped frame was handed out

export function frameCap() { return mode; }

export function setFrameCap(m) {
  m = m === '60' || m === '30' || m === 'off' ? m : 'vsync';
  if (m === mode) return mode;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return mode;
  mode = m;
  interval = m === '60' ? 1000 / 60 : m === '30' ? 1000 / 30 : 0;
  // A pump scheduled under the old mode may be a timer the new one doesn't wait on, or a frame
  // that never comes; start the new mode's own. An extra pump only hands out an empty queue.
  pending = false;
  if (m === 'vsync') {
    if (native) {
      window.requestAnimationFrame = native.raf;
      window.cancelAnimationFrame = native.caf;
      // Anything still waiting on the governor goes on the next real frame.
      const q = queue; queue = new Map();
      if (q.size) native.raf((t) => run(q, t));
    }
    return mode;
  }
  if (!native) native = { raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window) };
  window.requestAnimationFrame = request;
  window.cancelAnimationFrame = cancel;
  last = 0;
  if (queue.size) pump();
  return mode;
}

function request(cb) {
  const id = nextId++;
  queue.set(id, cb);
  pump();
  return id;
}

function cancel(id) {
  if (queue.delete(id)) return;
  native?.caf(id);
}

function pump() {
  if (pending) return;
  pending = true;
  if (mode === 'off') setTimeout(() => { pending = false; deliver(performance.now()); }, 0);
  else native.raf(tick);
}

function tick(t) {
  pending = false;
  // Keep the cadence (last += interval) so the average holds at the cap on any refresh rate, but
  // start again after a stall rather than racing to catch up.
  if (last && t - last < interval - 2) { pump(); return; }
  last = last && t - last < interval * 2 ? last + interval : t;
  deliver(t);
}

function deliver(t) {
  const q = queue;
  queue = new Map();
  run(q, t);
}

function run(q, t) {
  for (const cb of q.values()) {
    try { cb(t); } catch (e) { setTimeout(() => { throw e; }); }
  }
}
