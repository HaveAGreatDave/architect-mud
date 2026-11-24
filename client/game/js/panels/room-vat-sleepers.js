// ROOM · THE SLEEPERS IN THE CLONE VATS (docs/proposals/clone-facility-depths.md). Who floats in each vat and how the
// fluid sees them, for the Room Stage (room-stage.js) and for the vat hall drawn in GLASS (freelook-view.js, one-world
// phase F), so the two pose the same bodies. Pure: a room layout and its mesh's vats in, body records out.
import { facing } from '../../../shared/room-layout.js';

// A vat sleeper's body as the fluid sees it: capsules through its joints in bind space (figure.js FIGURE_BONES), each
// carried by its bone's row into the room, and the mouth off the head. [bone, a, b, radius]
const SLEEPER_CAPS = [
  [1, [0, 0.9, 0], [0, 1.2, 0], 0.14], [2, [0, 1.22, 0], [0, 1.4, 0], 0.15], [4, [0, 1.63, 0.02], [0, 1.63, 0.02], 0.105],
  [5, [0.195, 1.37, -0.01], [0.195, 1.12, -0.01], 0.045], [6, [0.195, 1.1, 0], [0.195, 0.88, 0], 0.038],
  [8, [-0.195, 1.37, -0.01], [-0.195, 1.12, -0.01], 0.045], [9, [-0.195, 1.1, 0], [-0.195, 0.88, 0], 0.038],
  [11, [0.095, 0.88, 0], [0.095, 0.51, 0], 0.072], [12, [0.095, 0.47, 0], [0.095, 0.1, 0], 0.05],
  [14, [-0.095, 0.88, 0], [-0.095, 0.51, 0], 0.072], [15, [-0.095, 0.47, 0], [-0.095, 0.1, 0], 0.05],
];
// A posed sleeper's rows (figurePeople) as the vat layer's body: { caps, mouth, mask } (gl/room-vat.js setBodies)
export function sleeperCapsules(rows) {
  const W = (b, p) => [0, 1, 2].map((r) => rows[b * 12 + r * 4] * p[0] + rows[b * 12 + r * 4 + 1] * p[1] + rows[b * 12 + r * 4 + 2] * p[2] + rows[b * 12 + r * 4 + 3]);
  // the head's own axes, for the breathing mask over the mouth and nose (gl/room-vat.js drawGear)
  const ax = (c) => [rows[48 + c], rows[52 + c], rows[56 + c]];
  return { caps: SLEEPER_CAPS.map(([b, a, c, r]) => [...W(b, a), ...W(b, c), r]), mouth: W(4, [0, 1.6, 0.1]), mask: { p: W(4, [0, 1.585, 0.1]), r: ax(0), u: ax(1), f: ax(2) } };
}
const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return h >>> 0; };

// A close-up figure in every vat that isn't drained, nude, floating a hand off the plinth in the vatFloat clip, bowed
// and asleep. Drawn at the close-up level at any distance (no drop to the lite figure across the room), and handed to
// the vat's fluid as capsules off its bones, so the fluid flows round the body and the march stops at its skin.
// `L` the room's layout, `vs` its mesh's vats (gl/room-decor.js), `t` seconds.
export function vatSleepers(L, vs, t) {
  if (!L || !vs?.length) return [];
  const out = [];
  for (const v of vs) {
    if (v.state === 'drained' || v.sleeper === false || v.id == null || v.h < 1.2) continue;
    const p = L.placed.find((q) => String(q.id) === String(v.id));
    if (!p) continue;
    const [fu, fv] = facing(p.turn), at = [p.u + fu * 0.02, p.v + fv * 0.02];
    const o = L.world(at[0], at[1], 0), e = L.world(at[0] + fu, at[1] + fv, 0), floor = L.world(at[0], at[1], L.baseAt?.(at[0], at[1]) || 0)[1];
    const id = 'vat:' + v.id, h = hashStr(id), ph = (h % 1000) / 159;
    out.push({ id, vat: v.id, npc: true, sculpt: true, sex: h & 1 ? 'male' : 'female', at, clip: 'vatFloat', rest: 'sleep', gaze: [0, -0.3],
      yaw: Math.atan2(e[0] - o[0], e[2] - o[2]) + 0.06 * Math.sin(t * 0.13 + ph),
      lift: v.c[1] - floor + 0.05 + 0.025 * Math.sin(t * 0.31 + ph),
      height: Math.min(1.78, Math.max(1.45, v.h - 0.2)) * (0.95 + 0.05 * ((h >> 3) % 7) / 6),
      figure: { wear: { top: false, legs: false, shoes: false }, gear: false } });
  }
  return out;
}
