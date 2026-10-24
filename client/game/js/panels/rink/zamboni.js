// Rinkside · the Zamboni's pattern: where it drives, how fast, and what it covers.
//
// THE PATTERN IS A REAL ONE. It comes in through the gate in the left end wall and works
// the middle first, in four ovals that each shift a strip toward the near boards, every
// strip overlapping the last by a few inches. Then two laps along the boards: the inner
// one, then one strip out to the outer one, its conditioner a few inches off the boards
// all the way round, corners included. Then on round the right end and back along the far
// boards, and out through the gate it came in by. Every square foot inside the boards is
// covered at least once (`coverage`, which the rink smoke checks); the ovals' ends and the
// lap corners overlap, the way a driver's do.
//
// THE MACHINE DRIVES IT. Nothing here jumps or slides sideways: the path is straights,
// arcs no tighter than 14 ft and smooth lane changes, the rear axle follows it and the
// machine points along it, so it turns the way a wheeled machine turns. Its speed is a
// driver's: about 7.5 mph on the straights, slower through the turns by how tight they
// are, easing up and away from a stop, walking pace through the gate. All of that is in
// MACHINE time (`T`, about four and a half minutes for the sheet). The broadcast shows it
// as a time-lapse, sped up to fit the break (`lapse`, which the director sets).
//
// Pure: no world, no canvas. The smoke runs it in node.

import { RL, RW, RC } from './geo.js';

export const ZW = 7.4;                  // the conditioner's width, ft
export const COND = 2.35;               // the conditioner's middle, behind the rear axle
export const AXLE = 3.0;                // the rear axle, behind the machine's own origin
export const GATE_Y = 52.5, GATE_OUT = 16;
// half the gate's width: the doorway in each end wall, and its two doors, a leaf each side
export const GATE_HALF = 4.5;
const OVERLAP = 0.4, S = ZW - OVERLAP;  // strip spacing
const CRUISE = 11, ALAT = 4, ACC = 2.5, DEC = 3, GATE_V = 4.5;

function build() {
  const X = [], Y = [], Hd = [], Dn = [];
  let x = -GATE_OUT, y = GATE_Y, h = 0, down = false;
  const push = () => { X.push(x); Y.push(y); Hd.push(h); Dn.push(down ? 1 : 0); };
  const straight = (len) => { const n = Math.max(1, Math.ceil(Math.abs(len) / 0.5)); for (let i = 0; i < n; i++) { x += Math.cos(h) * len / n; y += Math.sin(h) * len / n; push(); } };
  // `ang` > 0 turns left
  const arc = (r, ang) => {
    const n = Math.max(2, Math.ceil(Math.abs(r * ang) / 0.5)), s = Math.sign(ang), h0 = h;
    const cx = x - Math.sin(h) * r * s, cy = y + Math.cos(h) * r * s;
    for (let i = 1; i <= n; i++) { const a = h0 + ang * i / n; x = cx + Math.sin(a) * r * s; y = cy - Math.cos(a) * r * s; h = a; push(); }
  };
  // a lane change: `len` on, `d` to the left, as one smooth S
  const lane = (len, d) => {
    const h0 = h, x0 = x, y0 = y, n = Math.ceil(len / 0.5);
    for (let i = 1; i <= n; i++) {
      const u = i / n, f = (1 - Math.cos(Math.PI * u)) / 2;
      x = x0 + Math.cos(h0) * len * u - Math.sin(h0) * d * f; y = y0 + Math.sin(h0) * len * u + Math.cos(h0) * d * f;
      h = h0 + Math.atan(Math.PI * Math.sin(Math.PI * u) / 2 * d / len); push();
    }
    h = h0;
  };
  const toX = (tx) => straight(Math.abs(tx - x)), toY = (ty) => straight(Math.abs(ty - y));
  // a lap inset `d` from the boards, round from where it is on the near straight and back to it
  const lap = (d) => { const sx = x, r = RC - d; toX(RL - RC); arc(r, Math.PI / 2); toY(RW - RC); arc(r, Math.PI / 2); toX(RC); arc(r, Math.PI / 2); toY(RC); arc(r, Math.PI / 2); toX(sx); };

  push();
  straight(GATE_OUT - 2); down = true;                     // through the gate, conditioner down
  // the middle: four ovals, 28 ft across, each a strip nearer the near boards than the last
  const W0 = 4 * S, lap1 = 4 + S, top = RW - lap1 - S - W0, xR = 171, xL = 30;
  lane(26, top - GATE_Y);
  for (let j = 0; j < 4; j++) {
    const yl = top - j * S, next = j < 3 ? yl - S : lap1;
    toX(xR); arc(W0 / 2, Math.PI); toX(xL); arc((yl + W0 - next) / 2, Math.PI);
  }
  // the boards: the inner lap, a strip out, the outer lap
  lap(lap1); lane(30, -S); lap(4);
  // on round the right end and along the far boards, conditioner up, and out the gate
  toX(RL - RC); arc(RC - 4, Math.PI / 2); toY(RW - RC); arc(RC - 4, Math.PI / 2);
  toX(60); down = false;
  lane(40, (RW - 4) - GATE_Y);
  straight(x + GATE_OUT);

  // the speed a driver takes it at: capped by the turn ahead, eased up and down
  const n = X.length, Sd = new Float32Array(n), V = new Float32Array(n), T = new Float32Array(n);
  for (let i = 1; i < n; i++) Sd[i] = Sd[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3), ds = Sd[b] - Sd[a];
    let dh = Hd[b] - Hd[a]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const k = ds > 0 ? Math.abs(dh) / ds : 0;
    V[i] = Math.min(CRUISE, k > 1e-4 ? Math.sqrt(ALAT / k) : CRUISE);
    if (X[i] < 6 || X[i] > RL - 6) V[i] = Math.min(V[i], GATE_V);
  }
  V[0] = 0; V[n - 1] = 0;
  for (let i = 1; i < n; i++) V[i] = Math.min(V[i], Math.sqrt(V[i - 1] ** 2 + 2 * ACC * (Sd[i] - Sd[i - 1])));
  for (let i = n - 2; i >= 0; i--) V[i] = Math.min(V[i], Math.sqrt(V[i + 1] ** 2 + 2 * DEC * (Sd[i + 1] - Sd[i])));
  for (let i = 1; i < n; i++) T[i] = T[i - 1] + (Sd[i] - Sd[i - 1]) / Math.max(0.4, (V[i] + V[i - 1]) / 2);
  return { x: Float32Array.from(X), y: Float32Array.from(Y), h: Float32Array.from(Hd), down: Uint8Array.from(Dn), s: Sd, v: V, t: T, n, len: Sd[n - 1], T: T[n - 1] };
}

export const PLAN = build();

// Where the rear axle is `mt` seconds of machine time in, its heading, its speed, and
// whether the conditioner is down. `i` is a hint to start the search from.
export function planAt(mt, i = 0) {
  const P = PLAN;
  if (mt >= P.T) return { i: P.n - 1, x: P.x[P.n - 1], y: P.y[P.n - 1], h: P.h[P.n - 1], v: 0, down: false, end: true };
  while (i < P.n - 2 && P.t[i + 1] <= mt) i++;
  while (i > 0 && P.t[i] > mt) i--;
  const k = (mt - P.t[i]) / Math.max(1e-6, P.t[i + 1] - P.t[i]);
  let dh = P.h[i + 1] - P.h[i]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return {
    i, x: P.x[i] + (P.x[i + 1] - P.x[i]) * k, y: P.y[i] + (P.y[i + 1] - P.y[i]) * k, h: P.h[i] + dh * k,
    v: P.v[i] + (P.v[i + 1] - P.v[i]) * k, down: !!(P.down[i] && P.down[i + 1]), end: false,
  };
}

// The square feet inside the boards the conditioner never passes over, on a grid of
// `g` cells a foot. The pattern's own proof; the smoke fails a pattern that leaves any.
export function coverage(g = 2) {
  const P = PLAN, gw = RL * g, gh = RW * g, cov = new Uint8Array(gw * gh);
  for (let i = 1; i < P.n; i++) {
    if (!P.down[i]) continue;
    const ux = Math.cos(P.h[i]), uy = Math.sin(P.h[i]), cx = P.x[i] - ux * COND, cy = P.y[i] - uy * COND;
    // (the strip sampled every inch across, its far edge included)
    for (let a = -0.4; a <= 0.4; a += 0.1) for (let b = -ZW / 2; b <= ZW / 2 + 1e-6; b += ZW / 74) {
      const gx = Math.floor((cx + ux * a - uy * b) * g), gy = Math.floor((cy + uy * a + ux * b) * g);
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) cov[gy * gw + gx] = 1;
    }
  }
  let missed = 0;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const px = (gx + 0.5) / g, py = (gy + 0.5) / g, qx = Math.min(Math.max(px, RC), RL - RC), qy = Math.min(Math.max(py, RC), RW - RC);
    if (Math.hypot(px - qx, py - qy) < RC - 0.2 && !cov[gy * gw + gx]) missed++;
  }
  return missed / (g * g);
}
