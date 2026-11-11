// THE STREET'S BAKE, OFF THE MAIN THREAD.
//
// actor3d.js starts this when the street's bodies come from the close-up figure (ACTOR_BAKE.hd): building
// the figure, cutting it down and skinning every frame of four silhouettes is seconds of work, and each
// figure is one block of it too long to slice. This runs the same bake (actorBake) and hands every
// array back without copying it.
import { ACTOR_BAKE, actorBake } from './actor3d.js';

self.onmessage = (e) => {
  ACTOR_BAKE.hd = !!(e.data && e.data.hd);
  const bake = actorBake();
  const buffers = new Set();
  const take = (o) => { if (o) for (const v of Object.values(o)) if (ArrayBuffer.isView(v)) buffers.add(v.buffer); };
  for (const s of bake.sils) { take(s); take(s.far); }
  self.postMessage({ bake }, [...buffers]);
};
