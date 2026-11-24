// THE CROWD'S OUTFIT BODIES, OFF THE MAIN THREAD.
//
// actor3d.js actorOutfitReady sends one outfit's shape ({ cut, bottoms, hat }) at a time; this builds its
// body (actorOutfitBody: five close-up figures and a simplify, about a second) and hands the arrays back
// without copying them. A failure answers with no body, and the silhouette keeps drawing them.
import { OUTFIT_BODY, actorOutfitBody } from './actor3d.js';

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.hats !== undefined) OUTFIT_BODY.hats = d.hats;
  let body = null;
  try { body = actorOutfitBody(d.shape, d.tris); } catch (err) { console.warn('outfit body:', err && err.message); }
  const buffers = body ? Object.values(body).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer) : [];
  self.postMessage({ body }, buffers);
};
