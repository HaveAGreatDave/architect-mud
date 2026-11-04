// GLASS 2 · PEOPLE IN A ROOM. Everyone else in a Room Stage room (docs/proposals/room-stage.md,
// "People see each other"), as the close-up figure (figure.js `hd`, drawn by gl/figure-hd.js):
// their own cut of clothes, hair cards and the street's faces, playing the street figures' clips.
//
// Standing plays the `idle` clip and sitting the `sit` clip, at the spot the server relayed
// (plugins/roomstage) or on the piece they're on; lying is the idle pose laid down along the piece,
// head to the pillow. Clothes, face and hair come off the person's id through actorOutfit, the way a
// street figure's come off its token, so the same person is dressed the same on every screen.
//
// `figurePeople` is the room's: a record a person, its bones posed and placed here on the CPU (a
// room has a handful of people) and skinned on the GPU. `peopleBatch` is the crowd's body, posed on
// the CPU into a batch of ballpark-mesh.js vertices, which the Figure Lab draws beside the close-up
// one to compare.

import { actorBake, actorOutfit, actorSkinAt, ACTOR_CLIPS, ACTOR_MAT } from '../actor3d.js';
import { buildFigure, figureKey, figureGear, FIG_SLOT, FIGURE_BONES } from '../figure.js';
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

// ── The close-up figure ─────────────────────────────────────────────────────────────────────────────
const SURF = [MAT.CLOTH, MAT.SATIN, MAT.LEATHER, MAT.GLOSS, MAT.METAL];
const hexOf = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const looks = new Map();
// 0..255 sRGB, as actorOutfit's palettes are
const GEAR_LEATHER = [[52, 36, 26], [30, 26, 24], [86, 58, 36], [42, 42, 46], [70, 46, 30]];
const GEAR_PADS = [[38, 40, 44], [62, 64, 68], [30, 30, 32], [70, 58, 44]];
const SHIRTS = [[200, 196, 184], [150, 160, 170], [120, 60, 50], [90, 110, 90], [60, 70, 96]];
// The Thornwarren's: reds and earth for the cloth (the Actor Lab's order dress), skin tints and amber
// eyes from the changes, pigment for the marks (ash, ochre, the order's green, old blood) and linen
// for the wraps
const WILD = {
  cloak: [[150, 34, 30], [120, 26, 30], [170, 50, 34], [100, 22, 34]],
  tunic: [[120, 96, 64], [96, 80, 60], [140, 110, 70], [80, 64, 50], [110, 70, 50]],
  legs: [[60, 36, 30], [44, 30, 28], [70, 52, 36]],
  shoes: [[50, 34, 24], [40, 30, 26]],
  hair: [[120, 20, 60], [90, 16, 30], [30, 18, 20], [160, 60, 40], [22, 18, 16]],
  tint: [[196, 120, 120], [160, 128, 170], [150, 150, 120], [200, 140, 110]],
  iris: [[220, 150, 40], [200, 190, 60], [230, 110, 40]],
  mark: [[150, 146, 140], [170, 80, 40], [106, 176, 76], [120, 24, 24]],
  wrap: [[170, 150, 110], [140, 120, 90], [120, 110, 96]],
  horn: [[214, 200, 170], [170, 150, 120], [120, 100, 80]],
};
// What a person looks like close up, off their id: the mesh's key and the shader's colours, linear,
// by figure.js slot.
// `dress` is how their order dresses them in a room ('wildblood', or nothing for the city's own).
function lookOf(id, level, dress = '') {
  const k = id + '|' + level + '|' + dress;
  let o = looks.get(k);
  if (o) return o;
  const R = rand(id), pickOf = (list, j) => list[Math.min(list.length - 1, Math.floor(R(j) * list.length))];
  const f0 = actorOutfit(R), c = (rgb) => lin(hexOf(rgb)), wild = dress === 'wildblood';
  // a Wildblood's from the town's own palettes, the skin tinted, the eyes gone amber
  const f = wild ? { ...f0, cut: 'tunic', coat: pickOf(WILD.tunic, 26), legs: pickOf(WILD.legs, 27), shoes: pickOf(WILD.shoes, 28), hair: pickOf(WILD.hair, 29),
    skin: f0.skin.map((v, j) => v * 0.55 + pickOf(WILD.tint, 30)[j] * 0.45), mat: [0, 0, 2], face: { ...f0.face, iris: pickOf(WILD.iris, 31), hairStyle: pickOf([3, 2, 3, 0, 4], 32) } } : f0;
  const skin = c(f.skin), top = c(f.coat), legs = c(f.legs), shoes = c(f.shoes), hair = c(f.hair);
  const col = new Float32Array(54), surf = new Float32Array(18).fill(MAT.SKIN);
  const put = (slot, rgb, m) => { col.set(rgb, slot * 3); surf[slot] = m; };
  // skin is matte: the comic manner has no sheen on a face (gl/figure-hd.js)
  put(FIG_SLOT.skin, skin, MAT.MATTE); put(FIG_SLOT.face, skin, MAT.MATTE); put(FIG_SLOT.ear, skin, MAT.MATTE); put(FIG_SLOT.neck, skin, MAT.MATTE);
  put(FIG_SLOT.top, top, SURF[f.mat[0]] ?? MAT.CLOTH); put(FIG_SLOT.collar, top, SURF[f.mat[0]] ?? MAT.CLOTH);
  put(FIG_SLOT.legs, legs, SURF[f.mat[1]] ?? MAT.CLOTH); put(FIG_SLOT.shoes, shoes, SURF[f.mat[2]] ?? MAT.LEATHER);
  put(FIG_SLOT.hair, hair, MAT.SATIN); put(FIG_SLOT.card, hair, MAT.SATIN);
  // the gear's leather and the pads, from a short list each, and the gloves'
  const leather = c(pickOf(GEAR_LEATHER, 23)), pad = c(pickOf(GEAR_PADS, 24)), glove = c(pickOf(GEAR_LEATHER, 25));
  put(FIG_SLOT.gear, leather, MAT.LEATHER); put(FIG_SLOT.pad, pad, MAT.SATIN);
  // a shirt under a vest, a cloak, horn and bone, and the one blue a Wildblood wears: salvage
  put(FIG_SLOT.shirt, c(pickOf(SHIRTS, 33)), MAT.CLOTH); put(FIG_SLOT.cloak, c(pickOf(WILD.cloak, 34)), MAT.CLOTH);
  put(FIG_SLOT.horn, c(pickOf(WILD.horn, 35)), MAT.SATIN); put(FIG_SLOT.salvage, c([58, 110, 190]), MAT.GLOSS);
  const g0 = figureGear(R), style = f.face?.hairStyle ?? 0;
  const gear = wild ? { belt: true, strap: g0.strap, pouch: true, pads: false, gloves: false } : g0;
  // their changes, a Gift asked for or a Lesson not (docs/lore-wildblood.md): one or two each
  const body = wild ? { mighty: R(36) < 0.35 ? (R(37) < 0.5 ? 'L' : 'R') : '', thorn: R(38) < 0.3, horns: R(39) < 0.3, claws: R(40) < 0.35, teeth: R(41) < 0.6, goggles: R(42) < 0.25 } : null;
  if (body && !body.mighty && !body.thorn && !body.horns && !body.claws) body.claws = true;
  o = {
    key: { cut: f.cut, style, level, gear, body }, col, surf, gloves: gear.gloves, glove: new Float32Array(glove),
    wild, mark: Math.floor(R(43) * 4), markCol: new Float32Array(c(pickOf(WILD.mark, 44))), wrapCol: new Float32Array(c(pickOf(WILD.wrap, 45))),
    face: new Float32Array([f.face?.layout ?? 0, f.face?.makeup ?? 0, style, rand(id)(5) * 50]),
    lip: new Float32Array(c(f.face?.lip || f.skin)), lipstick: new Float32Array(c(f.face?.lipstick || f.skin)), iris: new Float32Array(c(f.face?.iris || [60, 40, 30])),
  };
  looks.set(k, o);
  return o;
}
// The lowest points of a figure's mesh in bind space (its soles), with their bones, to find how far
// a pose has to drop to stand on the floor.
const soles = new Map();
function solesOf(key) {
  const s = figureKey(key);
  if (soles.has(s)) return soles.get(s);
  const F = buildFigure(key), out = [];
  for (let v = 0; v < F.nv; v++) if (F.P[v * 3 + 1] < 0.012) out.push({ p: [F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]], b: [...F.B.subarray(v * 4, v * 4 + 4)], w: [...F.W.subarray(v * 4, v * 4 + 4)] });
  soles.set(s, out);
  return out;
}
const CLIP_DUR = Object.fromEntries(ACTOR_CLIPS.map((c) => [c.name, c.dur]));
const NBONE = FIGURE_BONES.length;
// How an order dresses its people in a room, by the order's id (plugins/roomstage sends an NPC's).
// The others wear the city's clothes.
const ORDER_DRESS = { ideology_wildblood: 'wildblood' };
export const dressOf = (order) => ORDER_DRESS[order] || '';
// `bodies` as peopleBatch takes them, each with a `dress` (dressOf); `level` is figure.js's (`lite`
// on a phone). Returns
// [{ key, rows, col, surf, face, lip, lipstick, iris }] for gl/figure-hd.js.
export function figurePeople(L, bodies, t = 0, { level = 'hd' } = {}) {
  const out = [];
  for (const body of bodies) {
    const o = lookOf(body.id, level, body.dress || '');
    const clip = body.pose === 'sit' ? 'sit' : 'idle', dur = CLIP_DUR[clip] || 4;
    const S = actorSkinAt(clip, t / dur + rand(body.id)(3));
    // stood on the floor: the lowest sole point at zero, as the bake drops its frames
    let drop = Infinity;
    for (const v of solesOf(o.key)) {
      let y = 0;
      for (let k = 0; k < 4; k++) { if (!v.w[k]) continue; const m = S[v.b[k]]; y += v.w[k] * (m[1] * v.p[0] + m[5] * v.p[1] + m[9] * v.p[2] + m[13]); }
      if (y < drop) drop = y;
    }
    if (!Number.isFinite(drop)) drop = 0;
    const { O, AX, AY, AZ } = placeOf(L, body);
    // each bone's 3×4, bind space into the room: placed (O + AX x + AY (y - drop) + AZ z) after its skin matrix
    const rows = new Float32Array(NBONE * 12);
    for (let b = 0; b < NBONE; b++) {
      const m = S[b];
      for (let r = 0; r < 3; r++) {
        const o4 = b * 12 + r * 4;
        for (let c = 0; c < 4; c++) rows[o4 + c] = AX[r] * m[c * 4] + AY[r] * m[c * 4 + 1] + AZ[r] * m[c * 4 + 2];
        rows[o4 + 3] += O[r] - AY[r] * drop;
      }
    }
    out.push({ key: o.key, rows, col: o.col, surf: o.surf, face: o.face, lip: o.lip, lipstick: o.lipstick, iris: o.iris, gloves: o.gloves, glove: o.glove, wild: o.wild, mark: o.mark, markCol: o.markCol, wrapCol: o.wrapCol });
  }
  return out;
}
// Where a body stands in the host frame: its origin and its three axes (+X its left, +Y up, +Z
// ahead, actor3d.js's), laid on its back along the piece when it's lying.
function placeOf(L, body) {
  const yaw = body.yaw || 0;
  if (body.pose === 'lie') {
    // laid on its back: the body's up runs to the head, its front faces the ceiling
    const hd = body.head || [0, -1], AY = [L.r[0] * hd[0] - L.f[0] * hd[1], 0, L.r[2] * hd[0] - L.f[2] * hd[1]];
    const feet = [body.at[0] - hd[0] * 1.55, body.at[1] - hd[1] * 1.55];
    const AZ = [0, 1, 0];
    return { O: L.world(feet[0], feet[1], (body.top || 0.4) + 0.12), AY, AZ, AX: [AY[1] * AZ[2] - AY[2] * AZ[1], AY[2] * AZ[0] - AY[0] * AZ[2], AY[0] * AZ[1] - AY[1] * AZ[0]] };
  }
  return { O: L.world(body.at[0], body.at[1], 0), AX: [Math.cos(yaw), 0, -Math.sin(yaw)], AY: [0, 1, 0], AZ: [Math.sin(yaw), 0, Math.cos(yaw)] };
}

// ── The crowd's body ────────────────────────────────────────────────────────────────────────────────
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
