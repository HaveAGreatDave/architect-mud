// ROOM'S MESHES, BUILT OFF THE MAIN THREAD, for the rooms baked ahead (room-stage.js `S.ahead`).
// A room's mesh is 40 to 60 ms warm and 160 to 240 ms cold. Baked on the main thread it ran mid-stride as you
// walked into a room, which was the stutter after every doorway. Here it's built from the spec and the pieces
// (the layout is made again on this side, since a layout carries functions) and posted back as data.
// ⚠ ONLY THE FIELDS THE STAGE READS GO BACK (MESH_FIELDS in room-stage.js). buildRoom also returns its kit's
// helpers (quad, box, TB…) and the layout, which can't be posted, and nothing past the build uses them. A new
// field the Stage reads off a mesh goes in that list, or a room baked ahead arrives without it.

import { roomLayout } from '../../../shared/room-layout.js';
import { buildRoom, paintRoomTexture } from './gl/room-mesh.js';
import { STRIDE } from './gl/ballpark-mesh.js';

// A material's picture (paintRoomTexture) is 5 to 35 ms of 2-D painting; on the page it ran as you turned round
// the room you'd just walked into. Here it's painted on an OffscreenCanvas and sent back as an ImageBitmap.
const offDoc = { createElement: () => new OffscreenCanvas(1, 1) };

self.onmessage = ({ data: { id, spec, pieces, opts, fields, texture, seed } }) => {
  if (texture) {
    try { const bitmap = paintRoomTexture(offDoc, texture, seed).transferToImageBitmap(); self.postMessage({ id, bitmap }, [bitmap]); }
    catch (err) { self.postMessage({ id, error: String(err?.stack || err) }); }
    return;
  }
  try {
    const m = buildRoom(roomLayout(spec, pieces), opts);
    const out = {};
    for (const k of fields) if (k in m) out[k] = m[k];
    // the batches cut to length here, as the page's cache would, so they're moved and not copied
    const move = [];
    for (const b of [out.solid, out.glass, out.screen, out.view, ...(out.textured ? out.textured.values() : [])]) {
      if (!b?.data) continue;
      if (b.data.length > b.n * STRIDE) b.data = b.data.slice(0, b.n * STRIDE);
      move.push(b.data.buffer);
    }
    self.postMessage({ id, mesh: out }, move);
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};
