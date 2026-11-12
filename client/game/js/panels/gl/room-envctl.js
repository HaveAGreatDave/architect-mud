// GLASS 2 · ROOM · the environmental control panel on a flat's wall (plugins/envcontrol). A piece is
// one when its row's `flags.look.dress` is 'envctl'; it lays out as a hung cabinet (client/shared/
// room-layout.js), so it hangs at HUNG_AT, blocks nothing, and a click runs the card's first line,
// `panel`, which opens the screen (panels/envctl.js). Pure: batches, no GL.

import { MAT } from './ballpark-mesh.js';
import { HUNG_AT } from '../../../../shared/room-layout.js';

const { GLOSS, METAL } = MAT;
// the code gl/room.js reads for a face that lights itself, as room-mesh.js has it
const GLOW = 40;

export function drawEnvPanel(K, F, p) {
  const { pbox } = F, hw = p.w / 2, hd = p.d / 2, y0 = HUNG_AT, y1 = y0 + p.h, z = hd;
  // a thin bronze bezel round a pane of black glass, flush to the wall
  pbox(-hw, hw, y0, y1, -hd, hd - 0.006, '#6a5238', 1, null, METAL);
  pbox(-hw + 0.012, hw - 0.012, y0 + 0.012, y1 - 0.012, hd - 0.006, z, '#07090c', 1, null, GLOSS);
  // what the screen shows when it's awake: a lit strip for the lights, a dial's arc for the climate,
  // and the door camera's grey picture down the right
  const gy0 = y0 + 0.03, gy1 = y1 - 0.03, cx = hw - 0.13, f = z + 0.0015;
  pbox(-hw + 0.03, -hw + 0.1, gy1 - 0.05, gy1, f - 0.001, f, '#ffcf8a', 1.5, null, GLOW);
  pbox(-hw + 0.03, -hw + 0.16, gy0, gy0 + 0.012, f - 0.001, f, '#7fd6d0', 1.4, null, GLOW);
  pbox(-hw + 0.03, -hw + 0.07, gy0 + 0.03, gy0 + 0.09, f - 0.001, f, '#7fd6d0', 1.6, null, GLOW);
  pbox(cx, hw - 0.03, gy0, gy1, f - 0.001, f, '#5d6a74', 1.25, null, GLOW);
  pbox(cx + 0.03, hw - 0.06, gy0 + 0.02, gy0 + 0.1, f - 0.0005, f + 0.0005, '#8a98a2', 1.3, null, GLOW);
  return true;
}
