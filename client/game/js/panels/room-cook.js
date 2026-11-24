// ROOM · WHERE THE KITCHEN STANDS IN A ROOM (docs/proposals/kitchen-stage.md). The Kitchen Stage cooks at what the room
// has: its hob, its microwave, a worktop. This says which, where its burner is, where you stand to use it, the room's
// fridges and its other cookers, for the Room Stage (room-stage.js) and for a room walked in GLASS (freelook-view.js,
// one-world), so the two stand you at the same cooker the same way. Pure: a room layout in, numbers out.
//
// ⚠ A HOB'S RINGS ARE THE MODEL'S (hobRings, which gl/room-mesh.js draws them by). The kitchen's live ring stands on one
// of them, the one the pan you're working with is on, and never in the middle of the top where no ring is drawn. Which
// ring a pan's on is the picture's: the server knows one heat a cooker (its dial), however many rings it has.
import { facing, roomFree, WASH_FORMS, FT_PER_M } from '../../../shared/room-layout.js';

// A hob's rings in its own frame (gl/room-kit.js `frame`: x across it, z out of its front), metres, and each one's
// radius: [{ x, z, r }]. Scaled to the piece as the mesh draws them. None on a microwave; one in the middle of anything
// that draws no rings of its own.
const RING_TABLE = {
  range: [[-0.15, -0.12, 0.09], [0.15, -0.12, 0.075], [-0.15, 0.14, 0.075], [0.15, 0.14, 0.09]],
  cooktop: [[-0.13, 0, 0.08], [0.13, 0, 0.07]],
  induction: [[-0.17, -0.06, 0.1], [0.17, -0.06, 0.08], [-0.17, 0.17, 0.08], [0.17, 0.17, 0.1]],
};
export function hobRings(p) {
  if (!p || p.form === 'microwave') return [];
  const t = RING_TABLE[p.form];
  if (!t) return [{ x: 0, z: 0, r: 0.09 }];
  const w = p.w || 0.76, d = p.d || 0.66;
  return t.map(([x, z, r]) => ({ x: x * w / 0.76, z: z * d / 0.66, r }));
}
// the ring a hob's kitchen stands on unless told otherwise: the biggest, the front one of two that size, then the right
export function homeRing(rings) {
  let best = 0;
  rings.forEach((g, i) => { const b = rings[best]; if (g.r > b.r + 1e-6 || (Math.abs(g.r - b.r) < 1e-6 && (g.z > b.z + 1e-6 || (Math.abs(g.z - b.z) < 1e-6 && g.x > b.x)))) best = i; });
  return best;
}

// Where the Kitchen Stage stands in this room (gl/kitchen.js host frame): its burner on the hob's top, on a ring,
// its y away from the cook into the hob, its x to the cook's right, z up, and room units per centimetre.
// Cooking never leaves the room, so it stands at what the room has, in this order: a hob that cooks,
// the microwave, a hob that's only drawn, then a worktop or a table. A microwave's frame stands on
// what it's set down on, under its middle, and carries `oven` (the kitchen draws it, and the room
// hides its own while it does); a worktop's carries `bench` (no hob at all). Null only in a room with
// none of them, where the kitchen draws on a set of its own. `want` is the piece you clicked to cook
// at: that one wins, so the microwave you clicked is the microwave you stand at even in a flat with a
// range. `ring` is which of a hob's rings the burner is on (hobRings; its home ring when null). Each frame
// also carries `stand`, where you stand to use it, facing it, and a hob's carries `rings`, each ring's
// middle in the kitchen's own frame (cm, about the burner) and its radius, and `ring`, the one it's on.
const BENCHES = [['surface', 'counter'], ['table', null], ['surface', null], ['sink', null]];
const cookable = (q) => q.arche === 'hob' || BENCHES.some(([a, f]) => q.arche === a && (!f || q.form === f) && !WASH_FORMS.includes(q.form));
export function cookFrame(L, want = null, ring = null) {
  const all = (L.placed || []).filter((q) => !q.annex && !q.on), mw = (q) => q.arche === 'hob' && q.form === 'microwave';
  const picked = want != null ? (L.placed || []).find((q) => String(q.id) === String(want) && !q.annex && cookable(q)) : null;
  const oven = picked && mw(picked) ? picked : all.concat((L.placed || []).filter((q) => !q.annex && q.on)).find(mw);
  const p = picked || all.find((q) => q.arche === 'hob' && !mw(q) && q.stove) || oven || all.find((q) => q.arche === 'hob' && !mw(q))
    || BENCHES.map(([a, f]) => all.find((q) => q.arche === a && (!f || q.form === f) && !WASH_FORMS.includes(q.form))).find(Boolean);
  if (!p) return null;
  const F = cookFrameOf(L, p, p === oven, ring);
  return F && { ...F, stand: cookStand(L, p) };
}
// Where you stand to use a piece: in front of it, clear of what's there, facing what's on its top.
// What it stands on (a worktop) is as deep as the piece's base, so the step out is from that.
export function cookStand(L, p) {
  const k = L.spec?.unit === 'ft' ? FT_PER_M : 1, [fu, fv] = facing(p.turn);
  const base = p.on ? (L.placed || []).find((q) => q.id === p.on) : null, half = Math.max(p.d || 0.5 * k, base?.d || (p.on ? 0.65 * k : 0)) / 2;
  let at = null;
  for (let r = half + 0.45 * k; r <= half + 1.3 * k && !at; r += 0.1 * k) { const u = p.u + fu * r, v = p.v + fv * r; if (roomFree(L, u, v)) at = [u, v]; }
  at ||= [p.u + fu * (half + 0.55 * k), p.v + fv * (half + 0.55 * k)];
  // what you look at: a microwave's middle (on its stand, or its trolley's 0.55, as room-mesh.js draws it), else the top
  const y = p.form === 'microwave' ? (p.y0 || 0) + (p.rise || 0.55) + 0.15 : (p.y0 || 0) + (p.rise || 0) + (p.h || 0.9 * k);
  const eye = L.world(at[0], at[1], 1.6 * k), top = L.world(p.u, p.v, y);
  const dx = top[0] - eye[0], dy = top[1] - eye[1], dz = top[2] - eye[2];
  return { at, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), piece: p.id, leave: 1.6 * k };
}
export function cookFrameOf(L, p, isOven, ring = null) {
  const k = L.spec?.unit === 'ft' ? FT_PER_M : 1, [fu, fv] = facing(p.turn);
  const a0 = L.world(p.u, p.v, 0), a1 = L.world(p.u + fu, p.v + fv, 0);
  let y = [a0[0] - a1[0], 0, a0[2] - a1[2]];
  const n = Math.hypot(y[0], y[2]) || 1;
  y = [y[0] / n, 0, y[2] / n];
  const z = [0, 1, 0], x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const s = k / 100;
  if (isOven) {
    // gl/room-mesh.js draws it as a 0.3-high box on its stand's top (`rise`), or on a trolley 0.55 high
    const stand = p.rise || 0.55, o = L.world(p.u, p.v, (p.y0 || 0) + stand);
    // which way its own x runs: the keypad is on its +x side, and that's the cook's right unless it isn't
    const q = L.world(p.u - fv, p.v + fu, (p.y0 || 0) + stand), flip = (q[0] - o[0]) * x[0] + (q[2] - o[2]) * x[2] < 0;
    return { o, x, y, z, s, piece: p.id, oven: { id: p.id, w: p.w / s, d: p.d / s, h: 0.3 / s, stand: p.rise ? 0 : stand / s, flip } };
  }
  const top = (p.y0 || 0) + (p.rise || 0) + (p.h || 0.92 * k);
  if (p.arche !== 'hob') return { o: L.world(p.u, p.v, top), x, y, z, s, piece: p.id, bench: true };
  // the burner on a ring the model draws: the piece's frame (x across it, z out of its front) into the room
  const su = -fv, sv = fu, at = (g) => L.world(p.u + su * g.x + fu * g.z, p.v + sv * g.x + fv * g.z, top);
  const list = hobRings(p), i = Number.isInteger(ring) && ring >= 0 && ring < list.length ? ring : homeRing(list);
  const o = at(list[i]);
  const into = (P) => { const d = [P[0] - o[0], P[1] - o[1], P[2] - o[2]]; return [x, y, z].map((a) => (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / s); };
  return { o, x, y, z, s, piece: p.id, ring: i, rings: list.map((g) => { const c = into(at(g)); return { at: [c[0], c[1]], r: g.r / s }; }) };
}

// The room's cookers, for the kitchen's appliance strip: the one you're at marked `here`.
export function cookersIn(L, here) {
  const n = { microwave: 'Microwave' };
  return (L.placed || []).filter((q) => q.arche === 'hob' && !q.annex).map((q) => ({
    id: q.id, here: String(q.id) === String(here),
    label: n[q.form] || (q.stove || q.form === 'range' ? 'Stove' : 'Hob'),
  }));
}
// The room's fridges and freezers in the kitchen's frame (cm): each one's id, the middle of its front at
// the floor, the way its front faces (x, y), and its width and height. The kitchen opens these, not a
// fridge of its own (kitchen-stage.js roomBoxes).
export function coldIn(L, F) {
  const k = L.spec?.unit === 'ft' ? FT_PER_M : 1;
  const into = (P) => { const d = [P[0] - F.o[0], P[1] - F.o[1], P[2] - F.o[2]]; return [0, 1, 2].map((a) => (d[0] * F[['x', 'y', 'z'][a]][0] + d[1] * F[['x', 'y', 'z'][a]][1] + d[2] * F[['x', 'y', 'z'][a]][2]) / F.s); };
  return (L.placed || []).filter((p) => p.arche === 'cold' && !p.annex && !p.on).map((p) => {
    const [fu, fv] = facing(p.turn), y0 = p.y0 || 0;
    const c = into(L.world(p.u, p.v, y0)), f = into(L.world(p.u + fu * (p.d || 0.6 * k) / 2, p.v + fv * (p.d || 0.6 * k) / 2, y0));
    const n = Math.hypot(f[0] - c[0], f[1] - c[1]) || 1;
    return { id: p.id, form: p.form, front: f, dir: [(f[0] - c[0]) / n, (f[1] - c[1]) / n], w: (p.w || 0.6 * k) * 100 / k, h: (p.h || 1.8 * k) * 100 / k };
  });
}
