// GLASS 2 · PEOPLE IN A ROOM. Everyone else in a Room Stage room, drawn from the street figures'
// own body (actor3d.js): the same skinned mesh and clips the pavements use, posed on the CPU here
// because a room has a handful of people and no instancing to share (docs/proposals/room-stage.md,
// "People see each other").
//
// Standing plays the `idle` clip and sitting the `sit` clip, at the spot the server relayed
// (plugins/roomstage) or on the piece they're on; lying is the idle pose laid down along the piece,
// head to the pillow. Clothes come off the person's id through actorOutfit, the way a street figure's
// come off its token, so the same person is dressed the same on every screen.
//
// Output is a batch of ballpark-mesh.js vertices in the host frame (gl/room.js draws it lit).

import { actorBake, actorOutfit, ACTOR_MAT } from '../actor3d.js';
import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';

let bake = null;
// The body, baked once and kept; null until asked for (it takes a few hundred milliseconds).
export function peopleReady() { return !!bake; }
export function preparePeople() { if (!bake) bake = actorBake({ head: true }); return bake; }

function rand(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (k) => { let x = Math.imul(h ^ (k * 0x9E3779B1), 0x85EBCA6B) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };
}
const outfits = new Map();
function dress(id) {
  let o = outfits.get(id);
  if (o) return o;
  const f = actorOutfit(rand(id)), c = (rgb) => lin('#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
  const col = { [ACTOR_MAT.skin]: c(f.skin), [ACTOR_MAT.coat]: c(f.coat), [ACTOR_MAT.legs]: c(f.legs), [ACTOR_MAT.shoes]: c(f.shoes), [ACTOR_MAT.hair]: c(f.hair),
    [ACTOR_MAT.eyes]: [0.02, 0.02, 0.025], [ACTOR_MAT.lips]: c(f.face?.lip || f.skin).map((x) => x * 0.8) };
  const surf = { [ACTOR_MAT.skin]: MAT.SATIN, [ACTOR_MAT.coat]: [MAT.CLOTH, MAT.SATIN, MAT.LEATHER, MAT.GLOSS, MAT.METAL][f.mat[0]] ?? MAT.CLOTH,
    [ACTOR_MAT.legs]: [MAT.CLOTH, MAT.SATIN, MAT.LEATHER, MAT.GLOSS, MAT.METAL][f.mat[1]] ?? MAT.CLOTH, [ACTOR_MAT.shoes]: MAT.LEATHER,
    [ACTOR_MAT.hair]: MAT.SATIN, [ACTOR_MAT.eyes]: MAT.GLOSS, [ACTOR_MAT.lips]: MAT.SATIN };
  o = { col, surf };
  outfits.set(id, o);
  return o;
}

// `bodies` is [{ id, at: [u, v], yaw (host), pose: 'stand'|'sit'|'lie', head: [du, dv], top }] in the
// layout's frame; `t` seconds moves the clips. Returns a batch, empty until preparePeople has run.
export function peopleBatch(L, bodies, t = 0) {
  const b = createBatch(16384);
  if (!bake || !bodies.length) return b;
  const { nv, idx, preview, mat, clips } = bake;
  const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3);
  for (const body of bodies) {
    const clip = clips[body.pose === 'sit' ? 'sit' : 'idle'] || clips.idle;
    // each person a little out of step with the next
    const ph = ((t / clip.dur) + (rand(body.id)(3))) % 1, F = clip.row0 + Math.min(clip.len - 1, Math.floor(ph * clip.len));
    const src = preview.subarray(F * nv * 3, (F + 1) * nv * 3);
    // the figure's frame: +X its left, +Y up, +Z ahead (actor3d.js), placed in the host's
    const yaw = body.yaw || 0, fwd = [Math.sin(yaw), 0, Math.cos(yaw)], left = [Math.cos(yaw), 0, -Math.sin(yaw)];
    let O, AX, AY, AZ;
    if (body.pose === 'lie') {
      // laid on its back: the body's up runs to the head, its front faces the ceiling
      const hd = body.head || [0, -1], hw = [L.r[0] * hd[0] - L.f[0] * hd[1], 0, L.r[2] * hd[0] - L.f[2] * hd[1]];
      const feet = [body.at[0] - hd[0] * 1.55, body.at[1] - hd[1] * 1.55];
      O = L.world(feet[0], feet[1], (body.top || 0.4) + 0.12);
      AY = hw; AZ = [0, 1, 0]; AX = [AY[1] * AZ[2] - AY[2] * AZ[1], AY[2] * AZ[0] - AY[0] * AZ[2], AY[0] * AZ[1] - AY[1] * AZ[0]];
    } else {
      O = L.world(body.at[0], body.at[1], 0);
      AX = left; AY = [0, 1, 0]; AZ = fwd;
    }
    for (let i = 0; i < nv; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      P[i * 3] = O[0] + AX[0] * x + AY[0] * y + AZ[0] * z;
      P[i * 3 + 1] = O[1] + AX[1] * x + AY[1] * y + AZ[1] * z;
      P[i * 3 + 2] = O[2] + AX[2] * x + AY[2] * y + AZ[2] * z;
    }
    Nn.fill(0);
    for (let k = 0; k < idx.length; k += 3) {
      const i0 = idx[k] * 3, i1 = idx[k + 1] * 3, i2 = idx[k + 2] * 3;
      const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2], vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const j of [i0, i1, i2]) { Nn[j] += nx; Nn[j + 1] += ny; Nn[j + 2] += nz; }
    }
    const o = dress(body.id), uv = [0, 0];
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], m = mat[i], j = i * 3, l = Math.hypot(Nn[j], Nn[j + 1], Nn[j + 2]) || 1;
      // a little darker low down, where the room's light doesn't reach
      const ao = 0.7 + 0.3 * Math.min(1, Math.max(0, (P[j + 1] - O[1]) / 0.9));
      const c = o.col[m] || [0.5, 0.5, 0.5];
      vtx(b, [P[j], P[j + 1], P[j + 2]], [Nn[j] / l, Nn[j + 1] / l, Nn[j + 2] / l], uv, [c[0] * ao, c[1] * ao, c[2] * ao], o.surf[m] ?? MAT.CLOTH);
    }
  }
  return b;
}
