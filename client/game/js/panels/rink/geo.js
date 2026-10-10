import { clamp } from './util.js';

// Rinkside · the sheet, in feet. x runs the length (0..200), y runs across (0 is the camera
// side, 85 the far boards), z is up. The sim speaks in fractions of the sheet ("model"
// units, x and y both 0..1); `ft()` is the one conversion, and GEO/DOTS are exported in
// model units because the broadcast regress reads them in the sim's own frame.

export const RL = 200, RW = 85, RC = 28;          // length, width, corner radius
export const BOARD_H = 3.5, GLASS_H = 8.5;
export const GOAL_X = [11, 189];                   // goal lines
export const BLUE_X = [75, 125];
export const NET_HALF = 3, NET_DEPTH = 3.3, NET_H = 4;
export const CREASE_R = 6;
export const MID_Y = RW / 2;

// The away club defends the low end and attacks the high one, every period. That is how
// the sim writes its keyframes (`synthPossession`: side 0 shoots at x≈0.955), so the view
// follows it rather than swapping ends.
export const attackDir = (side) => (side === 'a' ? 1 : -1);
export const netX = (defSide) => (defSide === 'a' ? GOAL_X[0] : GOAL_X[1]);

// Faceoff dots. `aZL` is in the AWAY club's defensive zone (the low end).
export const DOT_FT = {
  C: [100, MID_Y],
  aZL: [31, 20.5], aZR: [31, 64.5], hZL: [169, 20.5], hZR: [169, 64.5],
  aNL: [80, 20.5], aNR: [80, 64.5], hNL: [120, 20.5], hNR: [120, 64.5],
};
export const ft = (p) => [p[0] * RL, p[1] * RW];

// Model-unit geometry for anything that reads the sim's frame. A goal's last keyframe
// (x≈0.955) lies past goalLine[1] and inside cageBack[1], so the puck visibly crosses
// and then reaches the mesh; the broadcast regress asserts the first half of that.
export const GEO = {
  goalLine: [GOAL_X[0] / RL, GOAL_X[1] / RL],
  cageBack: [(GOAL_X[0] - NET_DEPTH) / RL, (GOAL_X[1] + NET_DEPTH) / RL],
  blue: [BLUE_X[0] / RL, BLUE_X[1] / RL],
  centre: 0.5,
  netHalf: NET_HALF / RW,
};
export const DOTS = Object.fromEntries(Object.entries(DOT_FT).map(([k, [x, y]]) => [k, [x / RL, y / RW]]));

// Null when (x, y) is at least `m` feet inside the boards; otherwise the nearest point
// that is, and the inward normal there. Straight walls and corners in one expression.
export function insideRink(x, y, m) {
  const cx = clamp(x, RC, RL - RC), cy = clamp(y, RC, RW - RC);
  const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), lim = RC - m;
  if (d <= lim) return null;
  const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1;
  return { x: cx + nx * lim, y: cy + ny * lim, nx: -nx, ny: -ny };
}

// The dasherboards as segments with inward normals. The far straight is one segment
// because the broadcast camera sees it at a single depth and maps the advertising onto it.
export const SEGS = (() => {
  const out = [];
  const seg = (x0, y0, x1, y1, kind) => {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let nx = -(y1 - y0), ny = x1 - x0;
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * (RL / 2 - mx) + ny * (MID_Y - my) < 0) { nx = -nx; ny = -ny; }
    out.push({ x0, y0, x1, y1, nx, ny, kind });
  };
  const arc = (cx, cy, a0, a1) => {
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t0 = a0 + (a1 - a0) * i / N, t1 = a0 + (a1 - a0) * (i + 1) / N;
      seg(cx + Math.cos(t0) * RC, cy + Math.sin(t0) * RC, cx + Math.cos(t1) * RC, cy + Math.sin(t1) * RC, 'corner');
    }
  };
  seg(RC, RW, RL - RC, RW, 'far');
  arc(RL - RC, RW - RC, Math.PI / 2, 0);
  seg(RL, RW - RC, RL, RC, 'end');
  arc(RL - RC, RC, 0, -Math.PI / 2);
  seg(RL - RC, 0, RC, 0, 'near');
  arc(RC, RC, -Math.PI / 2, -Math.PI);
  seg(0, RC, 0, RW - RC, 'end');
  arc(RC, RW - RC, Math.PI, Math.PI / 2);
  return out;
})();

// Far glass panels: 24 of them, 6ft each, along the far straight.
export const PANEL_W = 6, PANEL_X0 = RC, PANELS = (RL - 2 * RC) / PANEL_W;
export const panelAt = (x) => clamp(Math.floor((x - PANEL_X0) / PANEL_W), 0, PANELS - 1);
