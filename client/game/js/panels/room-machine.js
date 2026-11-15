// ROOM · THE RESURFACER IN ITS BAY (docs/proposals/slush-fund.md, "The Zamboni bay"). A room with a `resurfacer`
// piece has GLASS's own machine standing on it, nose to the piece's front; at each intermission the server says it's
// leaving, away or coming back (`vehicles.machine` on `room_view`, then `room_vehicles`, plugins/stands crew.js), and
// this plays that clock: the roller door in the wall it faces goes up, the machine drives out through it, the door
// comes down, and the bay stands empty until it comes back the same way.
//
// It decides nothing and sends nothing. The driver while it moves is the machine's own (gl/arena-mesh.js buildKen);
// parked, its seat is empty, and the crew NPC climbs on and off it as a person (the piece's seat, room-layout.js).
//
// ⚠ THE MESH IS GLASS'S. buildZamboni draws it in the rink's feet, z up; it's built once per livery into a scratch
// batch and each vertex carried into the room's metres here, into the beasts batch as the shed's truck is
// (room-hoist.js). Nothing here shapes a machine.
import { vtx, MAT } from './gl/ballpark-mesh.js';
import { RESURFACER } from '../../../shared/stadium.js';

const FT = 0.3048;
// the roller door: how much wider and taller than the machine, metres
const DOOR_PAD = 0.35, DOOR_H = 2.4;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const facing = (turn) => { const a = (turn || 0) * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };
const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

let meshMod = null;
const _meshes = new Map();
// the machine's triangles in its own frame (f forward, g left, h up; metres from its footprint's middle), per look
function meshOf(final, driver) {
  const key = `${final ? 1 : 0}${driver ? 1 : 0}`;
  if (_meshes.has(key)) return _meshes.get(key);
  if (!meshMod) return null;
  const M = meshMod, b = M.createBatch(1 << 14), bt = M.createBatch(256);
  // parked, the seat with no driver (a rig of the far driver's own numbers); moving, the far driver at the wheel
  const rig = driver ? null : { hub: [-0.82, 1.4, 4.5], seat: 3.2 };
  M.buildZamboni(b, bt, { x: 0, y: 0, h: 0 }, 0, true, rig, final ? { flags: [] } : null);
  const S = M.STRIDE, d = b.data;
  let f0 = Infinity, f1 = -Infinity, g0 = Infinity, g1 = -Infinity;
  for (let i = 0; i < b.n; i++) { const x = d[i * S], y = d[i * S + 1]; f0 = Math.min(f0, x); f1 = Math.max(f1, x); g0 = Math.min(g0, y); g1 = Math.max(g1, y); }
  const cf = (f0 + f1) / 2, cg = (g0 + g1) / 2, out = new Float32Array(b.n * 9);
  for (let i = 0; i < b.n; i++) {
    const o = i * S;
    out.set([(d[o] - cf) * FT, (d[o + 1] - cg) * FT, d[o + 2] * FT, d[o + 3], d[o + 4], d[o + 5], dec(d[o + 6]), dec(d[o + 7]), dec(d[o + 8])], i * 9);
  }
  const m = { tri: out, n: b.n };
  _meshes.set(key, m);
  return m;
}

/** The machine of one open Stage. */
export function createRoomMachine() {
  let L = null, V = null, t0 = 0, ver = 0, wanted = false;
  const machineOf = () => L?.placed?.find((p) => p.form === 'resurfacer') || null;
  function want() {
    if (wanted || meshMod) return;
    wanted = true;
    import('./gl/arena-mesh.js').then((m) => { meshMod = m; ver++; }).catch((e) => console.warn('[room] the resurfacer would not load:', e?.message));
  }
  /** A room opened or rebuilt (`Lnew`), or the server said where the machine is (`vehicles`). */
  function load(Lnew, vehicles) {
    if (Lnew) L = Lnew;
    if (vehicles !== undefined) {
      const m = vehicles?.machine || null, was = V;
      V = m;
      if (m && (!was || was.phase !== m.phase)) t0 = performance.now() - (m.age || 0);
    }
    if (machineOf()) want();
    ver++;
  }
  // 0 parked, 1 all the way out, along its front; null when it's away and not drawn
  function out(now) {
    const ph = V?.phase || 'parked', k = ease((now - t0) / (V?.ms || 6500));
    return ph === 'leaving' ? k : ph === 'returning' ? 1 - k : ph === 'away' ? null : 0;
  }
  const moving = (now = performance.now()) => !!V && (V.phase === 'leaving' || V.phase === 'returning') && now - t0 < (V.ms || 6500) + 400;
  // where the wall it faces is, from its middle: the distance, and the wall's plane
  function doorOf(p) {
    const [fu, fv] = facing(p.turn), hu = L.spec.w / 2, D = L.spec.d;
    const ts = [fu > 1e-6 ? (hu - p.u) / fu : fu < -1e-6 ? (-hu - p.u) / fu : Infinity, fv > 1e-6 ? (D - p.v) / fv : fv < -1e-6 ? (0 - p.v) / fv : Infinity];
    return { dist: Math.min(...ts), fu, fv };
  }

  /** Into the beasts batch: the roller door in its wall, and the machine where it is. */
  function into(b, now = performance.now()) {
    const p = machineOf();
    if (!L || !p) return;
    const { dist, fu, fv } = doorOf(p), su = -fv, sv = fu, k = out(now);
    const len = RESURFACER.l, half = len / 2;
    // the door: a dark opening on the wall and the shutter's slats over it, up while the machine is going through
    const W = (a, f, y) => L.world(p.u + su * a + fu * f, p.v + sv * a + fv * f, y);
    const dw = RESURFACER.w / 2 + DOOR_PAD, wf = dist - 0.012, up = [0, 1, 0], uv = [0, 0];
    const quad = (ps, col, mat = MAT.MATTE) => { for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, ps[i], up, uv, col, mat); };
    const ph = V?.phase || 'parked', tt = now - t0, ms = V?.ms || 6500;
    // the shutter is up (1) through the drive, rolling up in its first second and down in the second after it
    const open = ph === 'leaving' || ph === 'returning' ? Math.min(ease(tt / 1100), 1 - ease((tt - ms) / 1100)) : 0;
    quad([W(dw, wf, 0.01), W(-dw, wf, 0.01), W(-dw, wf, DOOR_H), W(dw, wf, DOOR_H)], [0.012, 0.014, 0.016]);
    const top = DOOR_H, bottom = DOOR_H * open, n = Math.max(1, Math.round((top - bottom) / 0.12));
    for (let i = 0; i < n; i++) {
      const y0 = bottom + i * (top - bottom) / n, y1 = y0 + (top - bottom) / n - 0.012, c = i % 2 ? [0.2, 0.22, 0.24] : [0.26, 0.28, 0.3];
      quad([W(dw, wf - 0.02, y0), W(-dw, wf - 0.02, y0), W(-dw, wf - 0.02, y1), W(dw, wf - 0.02, y1)], c, MAT.METAL);
    }
    quad([W(dw + 0.1, wf - 0.03, top), W(-dw - 0.1, wf - 0.03, top), W(-dw - 0.1, wf - 0.03, top + 0.3), W(dw + 0.1, wf - 0.03, top + 0.3)], [0.14, 0.15, 0.16], MAT.METAL);
    if (k == null) return;
    const m = meshOf(!!V?.final, k > 0.001);
    if (!m) return;
    // out along its front to past the wall, and a little further, so it's through the door
    const travel = Math.max(0, dist - (-half)) + 0.5, fo = k * travel, d = m.tri, n3 = m.n;
    const R = [L.world(1, 0, 0), L.world(0, 1, 0), L.world(0, 0, 1), L.world(0, 0, 0)];
    for (let i = 0; i < n3; i++) {
      // past the wall it's through the door, and a triangle out there isn't drawn
      if (i % 3 === 0 && Math.max(d[i * 9], d[i * 9 + 9], d[i * 9 + 18]) + fo > dist + 0.2) { i += 2; continue; }
      const o = i * 9, f = d[o] + fo, g = d[o + 1], h = d[o + 2];
      const pu = p.u + fu * f - su * g, pv = p.v + fv * f - sv * g, P = L.world(pu, pv, h);
      // the normal: forward and left in the room, up as is
      const nu = fu * d[o + 3] - su * d[o + 4], nv = fv * d[o + 3] - sv * d[o + 4];
      const N = [(R[0][0] - R[3][0]) * nu + (R[2][0] - R[3][0]) * d[o + 5] + (R[1][0] - R[3][0]) * nv, (R[0][1] - R[3][1]) * nu + (R[2][1] - R[3][1]) * d[o + 5] + (R[1][1] - R[3][1]) * nv, (R[0][2] - R[3][2]) * nu + (R[2][2] - R[3][2]) * d[o + 5] + (R[1][2] - R[3][2]) * nv];
      vtx(b, P, N, uv, [d[o + 6], d[o + 7], d[o + 8]], MAT.SATIN);
    }
    // the beacon on the roll hoop, going round while it's moving
    if (moving(now) && Math.floor(now / 300) % 2) b.lights = (b.lights || []).concat([{ p: W(0, fo - half + 0.3, RESURFACER.h + 0.2), c: [1.0, 0.6, 0.1], r: 5 }]);
  }

  return { load, into, moving, get active() { return !!machineOf(); }, get ver() { return ver; }, get phase() { return V?.phase || 'parked'; } };
}
