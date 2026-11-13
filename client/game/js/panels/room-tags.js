// PAINT ON A ROOM'S WALLS: where the spray can is aimed, and how a tag lies on the plaster
// (plugins/graffiti `room.tags`, sent on `room_view` as `tags` and again as `room_tags`).
//
// A tag sprayed in ROOM goes where you were looking when you pressed spray: `aimWall` casts the eye's
// ray at the walls of the room you're standing in (the flat, or its en-suite) and answers a spot,
// `{ u, v, y, n }` in metres in the Stage's frame, `n` the wall's inward normal. The server keeps it
// with the tag (paint.js safeSpot) and checks nothing about it but its numbers: where is the picture's
// business, whether is the server's. A tag sprayed from the log has no spot, and lies on the left wall.
//
// `tagDecals` turns the tags into quads for gl/room.js `setDecals`, each baked by the same code that
// paints a tag on a building in GLASS (tag-bake.js), so a piece reads the same indoors and out.
//
// ⚠ A LEAF, apart from tag-bake.js (itself a leaf) and the room's layout constants: the spray session
// and the Stage both pull it in, and neither may drag the other along.

import { bakeTagText } from './tag-bake.js';
import { FT_PER_M } from '../../../shared/room-layout.js';

const REACH_M = 3.5;          // how far a can carries: past this you're spraying the air
const HIGH_M = 1.55;          // where the middle of a tag goes on a wall when nobody aimed it
const NORMAL = { 'u+': [1, 0], 'u-': [-1, 0], 'v+': [0, 1], 'v-': [0, -1] };

const perM = (L) => (L.ft || 1) * FT_PER_M;

// The box of floor you're in: the room, or its en-suite when you're through its door. [u0, u1, v0, v1, h]
function boxAt(L, u, v) {
  const A = L.annex;
  if (A && v > A.v0 - 0.05) return [A.u0, A.u1, A.v0, A.v0 + (A.spec.d || 2), A.spec.h || L.h];
  return [-L.w / 2, L.w / 2, 0, L.d, L.h];
}

/**
 * The wall the eye is looking at, within reach: `{ u, v, y, n }` in metres, or null.
 * `eye` is a point in the room's frame (L.world's), `yaw` and `pitch` the room camera's (gl/room.js
 * roomMatrices: forward is [sin yaw cos pitch, sin pitch, cos yaw cos pitch]).
 */
export function aimWall(L, eye, yaw, pitch) {
  if (!L || !eye) return null;
  const k = perM(L), [eu, ev, ey] = L.local(eye);
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const du = f[0] * L.r[0] + f[2] * L.r[2], dv = -(f[0] * L.f[0] + f[2] * L.f[2]), dy = f[1];
  const [u0, u1, v0, v1, h] = boxAt(L, eu, ev);
  let best = null;
  const tryWall = (t, n) => {
    if (!(t > 0) || t > REACH_M * k || (best && t >= best.t)) return;
    const u = eu + du * t, v = ev + dv * t, y = ey + dy * t;
    if (u < u0 - 0.01 || u > u1 + 0.01 || v < v0 - 0.01 || v > v1 + 0.01 || y < 0.25 * k || y > h - 0.1 * k) return;
    best = { t, u, v, y, n };
  };
  if (du < -1e-4) tryWall((u0 - eu) / du, 'u+');
  if (du > 1e-4) tryWall((u1 - eu) / du, 'u-');
  if (dv < -1e-4) tryWall((v0 - ev) / dv, 'v+');
  if (dv > 1e-4) tryWall((v1 - ev) / dv, 'v-');
  if (!best) return null;
  const r2 = (x) => Math.round(x / k * 100) / 100;
  return { u: r2(best.u), v: r2(best.v), y: r2(best.y), n: best.n };
}

// Where a tag sprayed from the log goes: the middle of the left wall, a little over head height.
const defaultSpot = (L) => ({ u: -L.w / 2 / perM(L), v: L.d / 2 / perM(L), y: HIGH_M, n: 'u+' });

/**
 * One tag's quad on its wall, sized to the piece: [tl, tr, br, bl] in the room's frame, with the
 * wall's inward normal. `aspect` is the bake's width over its height.
 */
export function tagQuad(L, spot, aspect, lenChars = 8) {
  const k = perM(L), s = spot && NORMAL[spot.n] ? spot : defaultSpot(L);
  const [nu, nv] = NORMAL[s.n];
  const [u0, u1, v0, v1, h] = boxAt(L, s.u * k, s.v * k);
  // along the wall (v on a side wall, u on the front and back), and how much of it there is
  const lo = nu ? v0 : u0, hi = nu ? v1 : u1, at = nu ? s.v * k : s.u * k;
  // a longer tag goes up wider; never more than the wall has, or taller than it's high
  let w = Math.min(2.8, 0.9 + 0.07 * lenChars) * k;
  let hh = w / Math.max(0.4, aspect || 2.5);
  if (hh > 1.3 * k) { hh = 1.3 * k; w = hh * (aspect || 2.5); }
  w = Math.min(w, Math.max(0.3 * k, (hi - lo) - 0.2 * k));
  hh = Math.min(hh, w / Math.max(0.4, aspect || 2.5));
  const c = Math.max(lo + w / 2 + 0.05 * k, Math.min(hi - w / 2 - 0.05 * k, at));
  const y = Math.max(hh / 2 + 0.15 * k, Math.min(h - hh / 2 - 0.08 * k, s.y * k));
  // the wall's own plane, a hair proud of it so the paint wins the depth test against the plaster
  const proud = 0.006 * k;
  const wu = nu ? (nu > 0 ? u0 : u1) + nu * proud : null, wv = nv ? (nv > 0 ? v0 : v1) + nv * proud : null;
  const pt = (a, yy) => (nu ? L.world(wu, a, yy) : L.world(a, wv, yy));
  // which way is right for somebody facing the wall: the inward normal turned, in the world, so the
  // words read left to right whichever wall they're on
  const pA = pt(c - w / 2, y), pB = pt(c + w / 2, y);
  const nW = (() => { const o = L.world(nu ? wu : c, nu ? c : wv, y), q = L.world((nu ? wu : c) + nu, (nu ? c : wv) + nv, y); return [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; })();
  // right = cross(facing, up), facing = -n: (-n) x (0,1,0) = (n.z, 0, -n.x)
  const right = [nW[2], 0, -nW[0]];
  const ab = [pB[0] - pA[0], pB[2] - pA[2]];
  const [left, rightP] = ab[0] * right[0] + ab[1] * right[2] >= 0 ? [pA, pB] : [pB, pA];
  const up = hh / 2;
  const tl = [left[0], left[1] + up, left[2]], tr = [rightP[0], rightP[1] + up, rightP[2]];
  const br = [rightP[0], rightP[1] - up, rightP[2]], bl = [left[0], left[1] - up, left[2]];
  const len = Math.hypot(nW[0], nW[2]) || 1;
  return { quad: [tl, tr, br, bl], n: [nW[0] / len, 0, nW[2] / len] };
}

// A tag's bake, as GLASS would paint it: the player's letterform if they picked one, else rolled off
// the room, as the server rolls `v` off the room's id (tagVariant). Lit paint, so the night palette never
// applies indoors, and none of the scrawls GLASS puts round a piece on a street wall.
export function bakeRoomTag(t) {
  return bakeTagText(t.t, t.r || null, '#b8f03a', 0, t.v | 0, 0, 'throw', t.f || null);
}

// The variant the server gives a room's tag (plugins/graffiti roomTags): the same hash of the zone id.
export const tagVariant = (zoneId) => (String(zoneId).split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) & 0xffff);

/** The room's tags as decals for gl/room.js setDecals. */
export function tagDecals(L, tags) {
  const out = [];
  for (const t of tags || []) {
    if (!t?.t) continue;
    const src = bakeRoomTag(t);
    if (!src) continue;
    const q = tagQuad(L, t.spot, src.width / Math.max(1, src.height), t.t.length);
    out.push({ key: 'tag:' + (t.zone || '') + ':' + t.t + ':' + JSON.stringify(t.spot || null) + ':' + (t.f || ''), src, ...q });
  }
  return out;
}
