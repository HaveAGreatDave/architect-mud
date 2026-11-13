// Carving a cat's pose off the main thread. bakeCat (gl/cat-kit.js) takes a few seconds at the face's fine grid,
// which would freeze a room, so the carve runs in a worker (gl/cat-bake-worker.js) and comes back as typed arrays,
// moved, not copied. The rig is rebuilt here from the same numbers (catRig is cheap and the same numbers give the
// same rig), so the bake that comes back is the one bakeCat would have handed back, ready for skinCat.
//
// bakeCatOff(look, pose, o) → Promise of the bake. `pose` must be a name in CAT_POSES; a pose function can't cross
// to a worker, so it's carved here, as is everything when there's no Worker (Node, the gates).
import { bakeCat, catLook, catRig, CAT_POSES } from './cat-kit.js';

let worker = null, seq = 0;
const waiting = new Map();

function workerOf() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./cat-bake-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (!w) return;
      waiting.delete(data.id);
      if (data.error) w.reject(new Error(data.error)); else w.resolve(data.bake);
    };
    worker.onerror = (e) => {
      // a worker that can't start: carve the rest here
      for (const w of waiting.values()) w.fallback();
      waiting.clear(); worker = false;
      e.preventDefault?.();
    };
  } catch { worker = false; }
  return worker;
}

export function bakeCatOff(look0, pose = 'stand', o = {}) {
  const look = look0?.build ? look0 : catLook(look0);
  const here = () => Promise.resolve(bakeCat(look, pose, o));
  if (typeof pose !== 'string' || !CAT_POSES[pose] || o.rig || typeof Worker === 'undefined') return here();
  const W = workerOf();
  if (!W) return here();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, {
      resolve: (b) => resolve({ ...b, look, rig: catRig(look), pose: CAT_POSES[pose] }),
      reject,
      fallback: () => here().then(resolve, reject),
    });
    // the look is plain numbers and strings, so it clones as it is
    W.postMessage({ id, look: JSON.parse(JSON.stringify(look)), pose, o });
  });
}
