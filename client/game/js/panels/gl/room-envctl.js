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
  // a polished gold bezel, a dark lip inside it, and a pane of black glass, flush to the wall
  pbox(-hw, hw, y0, y1, -hd, hd - 0.008, '#c9a25e', 1.1, null, METAL);
  pbox(-hw + 0.01, hw - 0.01, y0 + 0.01, y1 - 0.01, hd - 0.008, hd - 0.005, '#14110c', 1, null, METAL);
  pbox(-hw + 0.016, hw - 0.016, y0 + 0.016, y1 - 0.016, hd - 0.005, z, '#05070a', 1, null, GLOSS);
  // what the screen shows awake, as its home menu does: a status line, the greeting in gold, then a
  // two-by-two grid of app tiles (Lights, Climate, Security, Shutters), each with its lit glyph
  const f = z + 0.0015, x0 = -hw + 0.03, x1 = hw - 0.03, top = y1 - 0.03;
  const lit = (a, b, c, d, hex, k) => pbox(a, b, c, d, f - 0.001, f, hex, k, null, GLOW);
  lit(x0, x0 + 0.05, top - 0.008, top, '#8a96a0', 1.2);
  lit(x1 - 0.03, x1, top - 0.008, top, '#8a96a0', 1.2);
  lit(x0, x0 + (x1 - x0) * 0.7, top - 0.05, top - 0.03, '#ffe0a3', 1.7);
  const gx = (x1 - x0 - 0.012) / 2, gTop = top - 0.07, gh = (gTop - (y0 + 0.03) - 0.012) / 2;
  const glyph = ['#ffe0a3', '#8fe6e0', '#ff6a5a', '#d9b26f'];
  for (let i = 0; i < 4; i++) {
    const a = x0 + (i % 2) * (gx + 0.012), t = gTop - Math.floor(i / 2) * (gh + 0.012);
    pbox(a, a + gx, t - gh, t, f - 0.0012, f - 0.0002, '#1a1d22', 1.15, null, GLOW);
    pbox(a + 0.012, a + 0.034, t - 0.034, t - 0.012, f - 0.0002, f + 0.0004, glyph[i], 1.8, null, GLOW);
    pbox(a + 0.012, a + gx * 0.7, t - gh + 0.012, t - gh + 0.02, f - 0.0002, f + 0.0004, '#8a96a0', 1.2, null, GLOW);
  }
  return true;
}
