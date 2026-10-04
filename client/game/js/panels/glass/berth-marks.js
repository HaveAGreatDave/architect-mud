// THE BOXES ON THE WATER: where to stop a boat at a fuel berth or in a covered slot.
//
// A seat hands the frame `v.berthMarks`, a list of boxes in world tiles with a state, and this
// draws them on the water: corner brackets in light, a faint outline and a wash inside, amber at the
// pumps, cyan under a roof, green once she is stopped in one. `boat-view.js` decides which boxes and
// what state; the boxes themselves come from the server (plugins/powerboat/helm.js
// `berthMarksNear`), which tests the same box or a larger one. Nothing here decides anything.
//
// ⚠ STROKES AND A DECAL, NOT MASS. A box comes and goes with the hull's distance and changes colour
// with her speed, so it cannot live in an arm: an arm's mass and adornment are captured once at a
// frozen clock. It is drawn from `drawWorldObjects` with the sinks open, so on GLASS 2 it is depth
// tested against the pilothouse like any wire (the dash hides it; a 2-D overlay would paint over
// the dash), and on the canvas it goes through the painter's queue.
//
// ⚠ PULLED TOWARD THE EYE BY A SWELL'S HEIGHT. The lines sit a hand above still water, and a crest
// between the eye and the box would take them out in pieces; `PULL` is about the crest of a working
// sea at this scale, far less than the metre to the pilothouse glass.
import { emitWire, emitDecoFill } from '../windshield.js';

const Z_LINE = 0.012, Z_POST = 0.08, PULL = 0.06;
const RGB = { fuel: '255,190,92', dock: '120,214,255', ready: '110,240,160' };

export function drawBerthMarks(ctx, cam, v, now) {
  const marks = v.berthMarks;
  if (!marks || !marks.length || !v.mapCenter) return;
  const ox = v.mapCenter.x + ((v.mapOffset && v.mapOffset.x) || 0);
  const oy = v.mapCenter.y + ((v.mapOffset && v.mapOffset.y) || 0);
  const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.004);
  for (const m of marks) {
    const fade = m.fade == null ? 1 : m.fade;
    if (!(fade > 0.02)) continue;
    const ready = m.state === 'ready';
    const rgb = ready ? RGB.ready : (RGB[m.kind] || RGB.dock);
    const a = fade * (ready ? 0.95 : m.state === 'in' ? 0.85 : 0.5 + 0.3 * pulse);
    const h = (m.hdg || 0) * Math.PI / 180;
    const fx = Math.sin(h) * m.hl, fy = -Math.cos(h) * m.hl;   // half the long axis
    const rx = Math.cos(h) * m.hw, ry = Math.sin(h) * m.hw;    // half the short one
    const cx = m.x - ox, cy = m.y - oy;
    const P = (sa, sr, z) => [cx + fx * sa + rx * sr, cy + fy * sa + ry * sr, z];
    // The wash inside, in reading order (corner 0 first).
    emitDecoFill(ctx, cam, [P(1, -1, Z_LINE * 0.5), P(1, 1, Z_LINE * 0.5), P(-1, 1, Z_LINE * 0.5), P(-1, -1, Z_LINE * 0.5)],
      `rgba(${rgb},1)`, a * (ready ? 0.16 : 0.09), PULL, 'berthmark');
    // The outline, faint, so the box reads as a box between the brackets.
    const ring = [[1, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      emitWire(ctx, cam, P(ring[i][0], ring[i][1], Z_LINE), P(ring[i + 1][0], ring[i + 1][1], Z_LINE), 1.3,
        `rgba(${rgb},0.55)`, a, { pull: PULL, tag: 'berthmark' });
    }
    // The brackets: an L at each corner with both legs the same length on the water, and a short
    // post standing out of it so a box half under a crest still shows where its corners are.
    const leg = Math.min(m.hl, m.hw) * 0.62;
    for (const [sa, sr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = P(sa, sr, Z_LINE);
      emitWire(ctx, cam, c, P(sa * (1 - leg / m.hl), sr, Z_LINE), 3.6, `rgba(${rgb},1)`, a, { pull: PULL, glow: 5, tag: 'berthmark' });
      emitWire(ctx, cam, c, P(sa, sr * (1 - leg / m.hw), Z_LINE), 3.6, `rgba(${rgb},1)`, a, { pull: PULL, glow: 5, tag: 'berthmark' });
      emitWire(ctx, cam, P(sa, sr, 0), P(sa, sr, Z_POST), 2.6, `rgba(${rgb},1)`, a, { pull: PULL, glow: 4, tag: 'berthmark' });
    }
  }
}
