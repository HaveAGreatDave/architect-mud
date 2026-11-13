// GLASS 2 · THE ROOM STAGE'S OFFICE. A corner computer desk and the chair you sit at it in, drawn in
// their piece's own frame as room-fittings.js draws its forms (x across, z out of the front, y up), and
// handed to it through FORMS.
//
// pcdesk: an L of black glass on steel round the corner it stands in, its runs the ones the walker
// collides with (room-layout.js pcdeskRuns). On it: a black tower with a glass side and lit fans,
// cooler, memory and card inside it; a wide monitor on the corner's diagonal, facing whoever sits in the
// square the L holds; and a keyboard and mouse on a desk mat in front of it. What the monitor shows is
// the row's `flags.look.screen` (`p.screen`), a page room-mesh.js paints (paintDesktop); with none it's
// a desktop.
//
// office: an ergonomic desk chair: five spokes on castors, a gas lift, a moulded seat, a mesh back with
// a lumbar pad and a headrest, and arms.
//
// ⚠ THE LOOK COMES FROM DATA, NEVER FROM A NAME (room-fittings.js). Pure: batches, no GL.

import { MAT } from './ballpark-mesh.js';
import { PCDESK_RUN } from '../../../../shared/room-layout.js';

const { GLOSS, METAL, SATIN, CLOTH, MATTE } = MAT;
// Lit things are drawn unlit (k >= 1.25 is room-kit.js's lamp): the case's fans and strips, and the
// line under the desk's edge.
const LIT = 1.6;
const RGB = ['#ff3ad8', '#8a5aff', '#3ae8ff'];
const STEEL = '#1d1e22';

// A sub-frame turned to face (du, dv) in the plan, standing at the piece's local (x, z): for what sits
// on the desk at an angle. ⚠ A frame's +x is on your LEFT as you face its front (room-kit.js frame), so
// what's laid out for the person sitting at it runs along -x, and a picture's u runs the other way.
function turned(c, x, z, ax, az) {
  const { P } = c.F, o = P(x, 0, z), d = P(x + ax, 0, z + az), du = d[0] - o[0], dv = d[1] - o[1], l = Math.hypot(du, dv) || 1;
  return c.K.frame(o[0], o[1], du / l, dv / l);
}

function pcdesk(c) {
  const { F, p, K } = c, { pbox } = F, hw = p.w / 2, hd = p.d / 2, h = p.h, D = PCDESK_RUN, t = 0.035;
  const top = '#141518';
  // the top: two slabs of smoked glass, the back run the whole width and the side run down to the front
  pbox(-hw, hw, h - t, h, -hd, -hd + D, top, 1, null, GLOSS);
  pbox(hw - D, hw, h - t, h, -hd + D, hd, top, 1, null, GLOSS);
  // a steel lip under the glass and, under that, a lit line along the edges you sit at
  pbox(-hw, hw - D, h - t - 0.02, h - t, -hd + D - 0.03, -hd + D, STEEL, 1, null, METAL);
  pbox(hw - D, hw - D + 0.03, h - t - 0.02, h - t, -hd + D, hd, STEEL, 1, null, METAL);
  pbox(-hw + 0.04, hw - D, h - t - 0.026, h - t - 0.02, -hd + D - 0.02, -hd + D - 0.008, RGB[2], LIT);
  pbox(hw - D + 0.008, hw - D + 0.02, h - t - 0.026, h - t - 0.02, -hd + D, hd - 0.04, RGB[0], LIT);
  // legs: a steel panel at each open end and a square post in the corner, with a rail along the back
  pbox(-hw + 0.02, -hw + 0.06, 0, h - t - 0.02, -hd + 0.05, -hd + D - 0.05, STEEL, 0.95, null, METAL);
  pbox(hw - D + 0.05, hw - 0.05, 0, h - t - 0.02, hd - 0.06, hd - 0.02, STEEL, 0.95, null, METAL);
  pbox(hw - 0.1, hw - 0.04, 0, h - t - 0.02, -hd + 0.04, -hd + 0.1, STEEL, 0.95, null, METAL);
  pbox(-hw + 0.06, hw - 0.1, h - 0.16, h - 0.12, -hd + 0.06, -hd + 0.09, STEEL, 0.9, null, METAL);
  pbox(hw - 0.09, hw - 0.06, h - 0.16, h - 0.12, -hd + 0.1, hd - 0.06, STEEL, 0.9, null, METAL);

  tower(c, hw - 0.42, hw - 0.18, hd - 0.56, hd - 0.1, h);

  // the monitor, on the corner's diagonal, looking at the square the L holds
  const mx = hw - 0.4, mz = -hd + 0.4, M = turned(c, mx, mz, -1, 1);
  const W = 0.9, y0 = h + 0.13, y1 = y0 + 0.39;
  // the stand: a flat foot, a post, the panel's back
  M.pbox(-0.16, 0.16, h, h + 0.012, -0.16, 0.04, '#222327', 1, null, METAL);
  M.pbox(-0.03, 0.03, h + 0.012, y0 + 0.16, -0.12, -0.08, '#2a2b30', 1, null, METAL);
  M.pbox(-W / 2, W / 2, y0 - 0.012, y1 + 0.012, -0.045, -0.012, '#0e0f12', 1, null, SATIN);
  M.pbox(-0.12, 0.12, y0 + 0.08, y1 - 0.08, -0.08, -0.045, '#141518', 1, null, SATIN);
  // the bezel round the glass, a thin chin, and a lit dot on it
  M.pbox(-W / 2, W / 2, y0 - 0.012, y1 + 0.012, -0.012, 0, '#09090b', 1, null, GLOSS);
  M.pbox(-W / 2 + 0.045, -W / 2 + 0.05, y0 - 0.008, y0 - 0.004, 0, 0.002, '#ffffff', LIT);
  // the picture: the page the row names, lit, edge to edge inside the bezel
  const sx = W / 2 - 0.008, s0 = y0 + 0.004, s1 = y1 - 0.004, z = 0.0015;
  const key = 'roomScreen|' + (p.screen || 'desktop');
  K.quad(K.TB(key), [M.P(-sx, s0, z), M.P(sx, s0, z), M.P(sx, s1, z), M.P(-sx, s1, z)], M.N(0, 0, 1), K.C('#ffffff', 0.92), K.E, [[1, 1], [0, 1], [0, 0], [1, 0]], true);
  // a glow off the screen onto the glass under it
  M.pbox(-sx * 0.9, sx * 0.9, h + 0.0005, h + 0.001, 0.02, 0.22, '#3a3240', 1, null, GLOSS);

  // the mat, the keyboard on it with a lit line under it, the mouse beside it
  const kx = 0, kz = 0.34;
  M.pbox(-0.46, 0.46, h, h + 0.004, kz - 0.18, kz + 0.17, '#101114', 1, null, CLOTH);
  M.pbox(-0.43, 0.43, h + 0.004, h + 0.0045, kz - 0.17, kz + 0.16, '#5a2a8a', 1, null, MATTE);
  M.pbox(-0.44, 0.44, h + 0.0045, h + 0.006, kz - 0.175, kz + 0.165, '#101114', 1, null, CLOTH);
  M.pbox(kx - 0.15, kx + 0.22, h + 0.006, h + 0.022, kz - 0.07, kz + 0.07, '#18191d', 1, null, SATIN);
  M.pbox(kx - 0.145, kx + 0.215, h + 0.006, h + 0.009, kz - 0.072, kz + 0.072, RGB[1], LIT);
  // the keys, row by row, a little lighter than the deck they stand in
  for (let row = 0; row < 5; row++) {
    const zr = kz - 0.055 + row * 0.027, n = row === 4 ? 1 : 14;
    if (n === 1) { M.pbox(kx - 0.04, kx + 0.1, h + 0.022, h + 0.03, zr - 0.009, zr + 0.009, '#2a2b30', 1, null, SATIN); continue; }
    for (let i = 0; i < n; i++) { const xk = kx + 0.189 - i * 0.0255; M.pbox(xk, xk + 0.021, h + 0.022, h + 0.03, zr - 0.01, zr + 0.01, '#2a2b30', 1, null, SATIN); }
  }
  c.R(...M.alongX(), -0.33, -0.27, kz - 0.06, kz + 0.04, h + 0.006, h + 0.04, 0.016, '#18191d', 1, SATIN);
  M.pbox(-0.304, -0.296, h + 0.03, h + 0.042, kz + 0.0, kz + 0.025, RGB[0], LIT);
}

// The tower, standing on the desk along its +x run, its front out along z and its glass side to -x,
// toward the chair. x0..x1 across, z0..z1 deep, on the top at y.
function tower(c, x0, x1, z0, z1, y) {
  const { pbox } = c.F, H = 0.48, black = '#0b0b0d', w = 0.008;
  const y1 = y + H;
  // the shell: feet, floor, roof, the solid side, the back, and a front of black mesh with a lit strip
  for (const [x, z] of [[x0 + 0.02, z0 + 0.03], [x1 - 0.02, z0 + 0.03], [x0 + 0.02, z1 - 0.03], [x1 - 0.02, z1 - 0.03]]) pbox(x - 0.012, x + 0.012, y, y + 0.012, z - 0.015, z + 0.015, '#2a2b30', 1, null, MATTE);
  const b0 = y + 0.012;
  pbox(x0, x1, b0, b0 + w, z0, z1, black, 1, null, SATIN);
  pbox(x0, x1, y1 - w, y1, z0, z1, black, 1, null, SATIN);
  pbox(x1 - w, x1, b0, y1, z0, z1, black, 1, null, SATIN);
  pbox(x0, x1, b0, y1, z0, z0 + w, black, 1, null, SATIN);
  pbox(x0, x1, b0, y1, z1 - w, z1, '#121316', 1, null, MATTE);
  pbox(x0 + 0.03, x0 + 0.036, b0 + 0.04, y1 - 0.04, z1, z1 + 0.003, RGB[2], LIT);
  pbox(x1 - 0.05, x1 - 0.03, y1 - 0.045, y1 - 0.035, z1, z1 + 0.003, '#ffffff', LIT);
  // the glass side: no pane (the room can't draw one you see through), just its black edge and two
  // streaks of reflection, so it reads as glass over a lit inside
  pbox(x0 - 0.002, x0 + w, b0, b0 + 0.02, z0, z1, black, 1, null, GLOSS);
  pbox(x0 - 0.002, x0 + w, y1 - 0.02, y1, z0, z1, black, 1, null, GLOSS);
  pbox(x0 - 0.002, x0 + w, b0, y1, z0, z0 + 0.02, black, 1, null, GLOSS);
  pbox(x0 - 0.002, x0 + w, b0, y1, z1 - 0.02, z1, black, 1, null, GLOSS);
  // inside: the board on the far wall, the shroud over the supply, the card, the cooler, the memory
  const xi = x1 - w - 0.004;
  pbox(xi - 0.006, xi, b0 + 0.11, y1 - 0.02, z0 + 0.06, z1 - 0.04, '#16171b', 1, null, SATIN);
  pbox(x0 + 0.01, xi, b0, b0 + 0.1, z0 + w, z1 - 0.02, '#141518', 1, null, SATIN);
  pbox(x0 + 0.012, x0 + 0.016, b0 + 0.06, b0 + 0.064, z0 + 0.03, z1 - 0.03, RGB[0], LIT);
  const gy = b0 + 0.17;
  pbox(x0 + 0.03, xi - 0.006, gy, gy + 0.05, z0 + 0.06, z1 - 0.06, '#1e1f24', 1, null, SATIN);
  pbox(x0 + 0.028, x0 + 0.032, gy + 0.018, gy + 0.03, z0 + 0.08, z1 - 0.08, RGB[1], LIT);
  // the cooler's pump: a block with a lit ring on its face, toward the glass
  const cy = y1 - 0.14, cz = (z0 + z1) / 2 + 0.03, rr = 0.035;
  pbox(x0 + 0.06, xi - 0.006, cy - 0.04, cy + 0.04, cz - 0.04, cz + 0.04, '#1a1b1f', 1, null, SATIN);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, py = cy + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
    pbox(x0 + 0.056, x0 + 0.06, py - 0.007, py + 0.007, pz - 0.007, pz + 0.007, RGB[i % 3], LIT);
  }
  // four sticks of memory with lit tops, behind the cooler
  for (let i = 0; i < 4; i++) { const z = cz + 0.07 + i * 0.012; pbox(x0 + 0.08, xi - 0.01, cy - 0.06, cy + 0.06, z, z + 0.006, '#202126', 1, null, SATIN); pbox(x0 + 0.08, xi - 0.01, cy + 0.06, cy + 0.067, z, z + 0.006, RGB[(i + 1) % 3], LIT); }
  // three fans in the front, edge on through the glass: their lit rings as bars
  for (let i = 0; i < 3; i++) {
    const fy = b0 + 0.13 + i * 0.105;
    pbox(x0 + 0.02, xi - 0.01, fy - 0.045, fy + 0.045, z1 - 0.045, z1 - 0.02, '#141518', 1, null, SATIN);
    pbox(x0 + 0.018, x0 + 0.022, fy - 0.04, fy + 0.04, z1 - 0.04, z1 - 0.025, RGB[i], LIT);
  }
  // a strip along the inside of the roof
  pbox(x0 + 0.02, xi - 0.01, y1 - w - 0.006, y1 - w, z0 + 0.03, z1 - 0.05, RGB[1], LIT);
}

function office(c) {
  const { F, p } = c, { pbox, P } = F, rod = c.rod, sy = 0.47, hd = p.d / 2;
  const frame = '#26272c', mesh = '#141518', alu = '#b8bcc2';
  // five spokes on castors, a hub, the gas lift
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3, x = Math.sin(a) * 0.3, z = Math.cos(a) * 0.3;
    rod(P(0, 0.1, 0), P(x, 0.07, z), 0.022, alu, 1, METAL, 6);
    c.lat(x, z, [[0, 0], [0.026, 0.008], [0.03, 0.03], [0.022, 0.052], [0, 0.055]], '#151518', 1, 10, GLOSS);
  }
  c.lat(0, 0, [[0, 0.08], [0.05, 0.08], [0.05, 0.12], [0.03, 0.14], [0, 0.14]], alu, 1, 14, METAL);
  rod(P(0, 0.12, 0), P(0, sy - 0.06, 0), 0.026, '#2a2b30', 1, METAL, 10);
  rod(P(0, 0.2, 0), P(0, sy - 0.08, 0), 0.03, '#1a1b1f', 1, SATIN, 10);
  pbox(-0.12, 0.12, sy - 0.07, sy - 0.04, -0.12, 0.12, frame, 1, null, METAL);
  // the seat: a moulded pan with a waterfall front
  c.R(...F.alongX(), -0.25, 0.25, -0.23, 0.22, sy - 0.04, sy + 0.035, 0.03, mesh, 1, CLOTH);
  c.R(...F.alongX(), -0.235, 0.235, -0.215, 0.2, sy + 0.025, sy + 0.05, 0.02, '#1c1d22', 1, CLOTH);
  // the back: two uprights leaning back, a mesh panel between them, the lumbar pad and the headrest
  const lean = 0.16, b0 = sy + 0.06, b1 = sy + 0.62, bz = -hd + 0.06;
  const back = (y) => bz - (y - b0) * lean, bm = b0 + (b1 - b0) * 0.42;
  for (const x of [-1, 1]) { rod(P(x * 0.18, sy - 0.01, -0.2), P(x * 0.18, bm, back(bm)), 0.018, frame, 1, SATIN, 8); rod(P(x * 0.18, bm, back(bm)), P(x * 0.225, b1, back(b1)), 0.018, frame, 1, SATIN, 8); }
  rod(P(-0.22, b1, back(b1)), P(0.22, b1, back(b1)), 0.018, frame, 1, SATIN, 8);
  rod(P(-0.18, b0, back(b0)), P(0.18, b0, back(b0)), 0.016, frame, 1, SATIN, 8);
  // the mesh in two panels, narrow at the waist and wide at the shoulders, so it reads as shaped to a back
  c.R(...F.alongX(-lean, b0), -0.17, 0.17, bz - 0.012, bz + 0.004, b0 + 0.01, bm, 0.02, mesh, 0.9, CLOTH);
  c.R(...F.alongX(-lean, b0), -0.215, 0.215, bz - 0.012, bz + 0.004, bm - 0.02, b1 - 0.01, 0.04, mesh, 0.9, CLOTH);
  for (let i = 1; i < 9; i++) { const y = b0 + (b1 - b0) * i / 9; { const wy = y < bm ? 0.16 : 0.2; rod(P(-wy, y, back(y) + 0.006), P(wy, y, back(y) + 0.006), 0.003, '#2c2d33', 1, CLOTH, 4); } }
  const ly = b0 + 0.12;
  c.R(...F.alongX(-lean, ly), -0.17, 0.17, back(ly) + 0.004, back(ly) + 0.03, ly - 0.05, ly + 0.05, 0.02, '#2a2b30', 1, SATIN);
  const hy0 = b1 + 0.06, hy1 = b1 + 0.17, hz = back(b1) - 0.03;
  rod(P(0, b1, back(b1)), P(0, hy0 + 0.02, hz), 0.014, frame, 1, METAL, 8);
  c.R(...F.alongX(-lean, hy0), -0.14, 0.14, hz - 0.01, hz + 0.035, hy0, hy1, 0.03, mesh, 1, CLOTH);
  // the arms: a post off each side of the seat and a padded rest on it
  for (const x of [-0.27, 0.27]) {
    pbox(x - 0.02, x + 0.02, sy - 0.02, sy + 0.2, -0.08, -0.03, frame, 1, null, SATIN);
    c.R(...F.alongX(), x - 0.04, x + 0.04, -0.13, 0.11, sy + 0.2, sy + 0.235, 0.015, '#1a1a1d', 1, SATIN);
  }
  // the lever under the seat
  rod(P(0.12, sy - 0.06, 0.05), P(0.24, sy - 0.08, 0.12), 0.008, '#2a2b30', 1, METAL, 6);
}

export const OFFICE_FORMS = Object.freeze({ pcdesk, office });
