// A ROOM THAT ISN'T A BOX: the walls of a room in a ship's hull or deckhouse (room-layout.js hullSpecOf), for
// gl/room-mesh.js buildRoom. Its side walls follow the hull's plan and lean in as they rise, its front can be a raked
// screen, and an open deck has a rail instead of walls. buildRoom still draws the front and back walls where they're
// upright, cut round their doors, and lays the floor and ceiling to the same plan (hullFloor).
//
// Every face is drawn from both sides: a hull room is seen from inside and, in one-world, past its own glass.
import { hullHalf, hullStations, doorwaysOf } from '../../../../shared/room-layout.js';
import { MAT } from './ballpark-mesh.js';

const { GLOSS, METAL, SATIN } = MAT;
const T = 0.14;   // the wall's thickness, as buildRoom's

// Which walls the hull draws, so buildRoom leaves them out: the sides always, the front when it's raked, all four
// round an open deck.
export function hullWalls(hull) {
  const w = new Set(['left', 'right']);
  if (hull.rake || hull.deck) w.add('front');
  if (hull.deck) w.add('back');
  return w;
}

// The floor (y 0) or the ceiling (y H, facing down) as strips between the hull's stations, each a trapezoid as wide
// as the sides at its two ends. `lay(ps)` gets four [u, v, y] corners.
export function hullFloor(hull, D, y, lay, top = false) {
  const vs = hullStations(hull, D), t = top ? 1 : 0;
  for (let i = 0; i < vs.length - 1; i++) {
    const v0 = vs[i], v1 = vs[i + 1], a = hullHalf(hull, v0, t), b = hullHalf(hull, v1, t);
    // under a raked screen the ceiling starts where the screen meets it
    const s0 = top && hull.rake ? Math.max(v0, hull.rake) : v0;
    if (v1 - s0 < 0.01) continue;
    const a0 = top ? hullHalf(hull, s0, 1) : a;
    lay(top ? [[-a0, s0, y], [a0, s0, y], [b, v1, y], [-b, v1, y]].reverse() : [[-a, v0, y], [a, v0, y], [b, v1, y], [-b, v1, y]]);
  }
}

// The hull's own walls. Returns the light descriptors of its glass, as drawPane's, for the room's daylight.
export function drawHullShell(K, L, { H, D, wallC, plaster, trim, accent, glass = [] }) {
  const hull = L.spec.hull, lights = [];
  const dir = (du, dv) => { const a = L.world(du, dv, 0), o = L.world(0, 0, 0); const n = [a[0] - o[0], 0, a[2] - o[2]], l = Math.hypot(n[0], n[2]) || 1; return [n[0] / l, 0, n[2] / l]; };
  const neg = (n) => [-n[0], -n[1], -n[2]];
  // a wall face, `col` on the inside, and its outside `out` (a dark hull) a wall's thickness out from it. `inw` is the
  // way into the room, [u, v]. There's no face culling here, so the two can't share a plane.
  const both = (ps, inw, col, out = '#0a0c10', mat = SATIN, tex = null) => {
    const n = dir(inw[0], inw[1]);
    if (tex) K.quad(K.TB(tex.key), ps, n, K.C(tex.c, 1), mat, ps.map((p) => [(p[0] + p[1]) / tex.t, p[2] / tex.t]));
    else K.quad(K.solid, ps, n, K.C(col, 1), mat);
    K.quad(K.solid, ps.map((p) => [p[0] - inw[0] * T, p[1] - inw[1] * T, p[2]]), neg(n), K.C(out, 1), GLOSS);
  };
  const pane = (ps, n) => {
    const uv = [[100, ps[0][2]], [101, ps[1][2]], [101, ps[2][2]], [100, ps[3][2]]];
    K.quad(K.glass, ps, n, [0.8, 0.86, 0.9], GLOSS, uv, true);
  };
  // a thin frame member from p to q (two [u, v, y] points) standing `d` in off the glass toward `n`
  const bar = (p, q, w, inward, hex = '#16181c') => {
    const [nu, nv] = inward, s = 0.03, along = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...along) || 1;
    // across the bar, in the wall's plane: up the wall for a horizontal bar, along it for an upright
    const side = Math.abs(along[2]) / l > 0.7 ? [-nv * w / 2, nu * w / 2, 0] : [0, 0, w / 2];
    const at = (o, k) => [o[0] + side[0] * k + nu * s, o[1] + side[1] * k + nv * s, o[2] + side[2] * k];
    K.quad(K.solid, [at(p, -1), at(q, -1), at(q, 1), at(p, 1)], dir(nu, nv), K.C(hex, 1), METAL);
  };
  const light = (c, nIn, along, y0, y1, half) => {
    const p = L.world(c[0] + nIn[0] * 0.02, c[1] + nIn[1] * 0.02, (y0 + y1) / 2), wa = L.world(along[0], along[1], 0), w0 = L.world(0, 0, 0);
    const n = dir(nIn[0], nIn[1]);
    lights.push({ p, n, a: [wa[0] - w0[0], 0, wa[2] - w0[2]], b: [0, y1 - y0, 0], k: Math.min(3, Math.max(1, half * 2 * (y1 - y0) / 2.4)), y0, y1 });
  };

  const vs = hullStations(hull, D), rk = hull.rake || 0;
  // where a side wall's front edge is at height t: back of the raked screen
  const vAt = (v, t) => Math.max(v, rk * t);
  if (hull.deck) return drawRail(K, L, { D, both, bar, dir, trim, accent });

  // THE SIDES, segment by segment, floor to ceiling, leaning in by the plan
  for (const s of [-1, 1]) {
    const wall = s < 0 ? 'left' : 'right', isGlass = glass.includes(wall), nIn = [-s, 0];
    for (let i = 0; i < vs.length - 1; i++) {
      const v0 = vs[i], v1 = vs[i + 1];
      const f0 = hullHalf(hull, v0, 0), f1 = hullHalf(hull, v1, 0), h0 = hullHalf(hull, vAt(v0, 1), 1), h1 = hullHalf(hull, vAt(v1, 1), 1);
      const ps = [[s * f0, v0, 0], [s * f1, v1, 0], [s * h1, vAt(v1, 1), H], [s * h0, vAt(v0, 1), H]];
      const inN = dir(-s, 0);
      if (!isGlass) { both(ps, nIn, wallC, '#0a0c10', SATIN, plaster ? { key: plaster.t, c: plaster.c, t: 1 } : null); continue; }
      // glass from a low upstand to just under the ceiling, mullions every metre and a half
      const up = 0.32, top = H - 0.08, lerp = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
      const atY = (pf, ph, y) => lerp(pf, ph, y / H);
      const g = [atY(ps[0], ps[3], up), atY(ps[1], ps[2], up), atY(ps[1], ps[2], top), atY(ps[0], ps[3], top)];
      both([ps[0], ps[1], g[1], g[0]], nIn, trim);   // the upstand
      both([g[3], g[2], ps[2], ps[3]], nIn, trim);   // the head
      pane(g, inN);
      const n = Math.max(1, Math.round((v1 - v0) / 1.5));
      for (let j = 0; j <= n; j++) bar(lerp(g[0], g[1], j / n), lerp(g[3], g[2], j / n), 0.05, nIn);
      bar(g[0], g[1], 0.06, nIn, accent || '#16181c'); bar(g[3], g[2], 0.05, nIn);
      light([(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2], nIn, [0, v1 - v0], up, top, (v1 - v0) / 2);
    }
  }

  // THE RAKED FRONT: from the floor at v 0 to the ceiling at v rake, glass between a low upstand and the head
  if (rk) {
    const f = hullHalf(hull, 0, 0), h = hullHalf(hull, rk, 1), nIn = [0, 1], inN = dir(0, 1);
    const ps = [[f, 0, 0], [-f, 0, 0], [-h, rk, H], [h, rk, H]];
    if (!glass.includes('front')) both(ps, nIn, wallC);
    else {
      const up = 0.45, top = H - 0.06, lerp = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
      const g = [lerp(ps[0], ps[3], up / H), lerp(ps[1], ps[2], up / H), lerp(ps[1], ps[2], top / H), lerp(ps[0], ps[3], top / H)];
      both([ps[0], ps[1], g[1], g[0]], nIn, trim);
      both([g[3], g[2], ps[2], ps[3]], nIn, trim);
      pane(g, inN);
      const n = Math.max(2, Math.round(f * 2 / 1.6));
      for (let j = 0; j <= n; j++) bar(lerp(g[1], g[0], j / n), lerp(g[2], g[3], j / n), 0.06, nIn);
      bar(g[1], g[0], 0.07, nIn, accent || '#16181c');
      light([0, rk * 0.3], nIn, [-2 * f, 0], up, top, f);
    }
  }
  return lights;
}

// AN OPEN DECK: stanchions and a top rail along the sides and across both ends, a toe board at the foot, with gaps
// where a doorway or a stair comes through the end.
function drawRail(K, L, { D, bar, dir, trim, accent }) {
  const hull = L.spec.hull, R = hull.rail || 1.05, vs = hullStations(hull, D), steel = accent || '#c9ced4';
  const post = (u, v) => K.box(u - 0.025, u + 0.025, v - 0.025, v + 0.025, 0, R, steel, 1.05, null, METAL);
  const runAlong = (p, q) => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(l / 1.4));
    for (let j = 0; j < n; j++) post(p[0] + (q[0] - p[0]) * j / n, p[1] + (q[1] - p[1]) * j / n);
    for (const y of [R, R * 0.55]) {
      const a = [p[0], p[1], y], b = [q[0], q[1], y];
      K.quad(K.solid, [[a[0], a[1], y - 0.02], [b[0], b[1], y - 0.02], [b[0], b[1], y + 0.02], [a[0], a[1], y + 0.02]], dir(0, 1), K.C(steel, 1.05), METAL);
    }
    K.quad(K.solid, [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], 0.1], [p[0], p[1], 0.1]], dir(0, 1), K.C(trim, 1), SATIN);
  };
  for (const s of [-1, 1]) for (let i = 0; i < vs.length - 1; i++) runAlong([s * hullHalf(hull, vs[i]), vs[i]], [s * hullHalf(hull, vs[i + 1]), vs[i + 1]]);
  // across the ends, less the doorways through them
  const ways = doorwaysOf(L.spec);
  for (const [wall, v] of [['front', 0], ['back', D]]) {
    const half = hullHalf(hull, v), gaps = ways.filter((o) => o.wall === wall).map((o) => [o.a - 0.1, o.b + 0.1]).sort((a, b) => a[0] - b[0]);
    let s = -half;
    for (const [a, b] of gaps) { if (a > s + 0.05) runAlong([s, v], [a, v]); post(a, v); post(b, v); s = b; }
    if (half > s + 0.05) runAlong([s, v], [half, v]);
  }
  return [];
}
