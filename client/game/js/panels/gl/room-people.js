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

import { actorBake, actorOutfit, actorSkinAt, actorSkinMix, actorClipFace, actorStrideM, ACTOR_CLIPS, ACTOR_IDLES, ACTOR_IDLE_SLOT, ACTOR_ACTS, ACTOR_MAT, ACTOR_ROOM_CLIPS } from '../actor3d.js';
import { buildFigure, figureKey, figureGear, figureFabric, mutationLook, wildMutations, somaOf, FIGURE_FACIAL, FIG_SLOT, FIG_FABRIC, FIGURE_XBONES, FIGURE_BONE_COUNT, FIGURE_BONES, FIGURE_BONE, SCULPT_BUILDS, FIGURE_CROWN } from '../figure.js';
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
// the accent a person's mutations share (gl/figure-hd.js uMutC): teal, violet, amber, jade, coral, cobalt
const MUT_ACCENT = [[40, 170, 170], [140, 90, 210], [235, 160, 40], [60, 180, 110], [240, 110, 90], [60, 110, 220]];
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
// `sex` picks the face and build a sculpted person rolls from; without one it's the roll's. `figure` is
// what's been settled for them (an NPC's flags.figure, docs/flags-keys.md), and beats any roll.
function lookOf(id, level, dress = '', sculpt = false, sex = '', figure = null) {
  const fg = sculpt ? figure : null;
  const k = id + '|' + level + '|' + dress + (sculpt ? '|s' + sex : '') + (fg ? '|f' : '');
  let o = looks.get(k);
  if (o) return o;
  const R = rand(id), pickOf = (list, j) => list[Math.min(list.length - 1, Math.floor(R(j) * list.length))];
  const fr = actorOutfit(R), c = (rgb) => lin(hexOf(rgb)), wild = dress === 'wildblood';
  const f0 = fg ? { ...fr, cut: fg.cut ?? fr.cut, coat: fg.top ?? fr.coat, legs: fg.legs ?? fr.legs, shoes: fg.shoes ?? fr.shoes, skin: fg.skin ?? fr.skin, hair: fg.hair ?? fr.hair, mat: fg.top ? [0, 0, 2] : fr.mat,
    face: { ...fr.face, iris: fg.iris ?? fr.face?.iris, layout: fg.layout ?? fr.face?.layout } } : fr;
  // a Wildblood's from the town's own palettes, the skin tinted, the eyes gone amber
  const f = wild ? { ...f0, cut: 'tunic', coat: pickOf(WILD.tunic, 26), legs: pickOf(WILD.legs, 27), shoes: pickOf(WILD.shoes, 28), hair: pickOf(WILD.hair, 29),
    skin: f0.skin.map((v, j) => v * 0.55 + pickOf(WILD.tint, 30)[j] * 0.45), mat: [0, 0, 2], face: { ...f0.face, iris: pickOf(WILD.iris, 31), hairStyle: pickOf([3, 2, 3, 0, 4], 32) } } : f0;
  // a sculpted person: head shape, build and age off the same rand, slots 46 and 52 to 53. The soft
  // head is a woman's, and takes a woman's build and hair.
  const sculptHead = !sculpt ? 0 : fg?.head ?? (sex === 'female' ? 3 : sex === 'male' ? Math.min(2, Math.floor(R(46) * 3)) : Math.min(3, Math.floor(R(46) * 4))), soft = sculptHead === 3, br = R(52);
  const build = !sculpt ? 'average' : fg?.build ? fg.build : soft ? 'woman' : br < 0.84 ? 'average' : br < 0.95 ? 'older' : 'hunched';
  // their weight, ectomorph to endomorph, in tenths so people share meshes: most near the middle, the old a
  // little heavier. Slots 56 and 57. A settled look without one keeps the base body.
  const weight = !sculpt ? null : fg ? fg.weight ?? null : Math.round(Math.min(1, (R(56) + R(57)) / 2 + (build === 'older' ? 0.15 : 0)) * 10) / 10;
  const age = fg?.age ?? (sculpt && (build === 'older' || R(53) < 0.1) ? 0.6 + 0.4 * R(54) : 0);
  // sculpted, nothing below the waist is paler than worn denim: the eye belongs on the face and jacket
  const legs0 = c(f.legs), legK = sculpt ? Math.min(1, 0.05 / Math.max(1e-3, (legs0[0] + legs0[1] + legs0[2]) / 3)) : 1;
  // sculpted skin is warmed and deepened; dark skin is lifted instead, or its planes go to mud
  const skin0 = c(f.skin), dk = Math.max(0, Math.min(1, (0.14 - (skin0[0] + skin0[1] + skin0[2]) / 3) / 0.1));
  const skin = skin0.map((v, j) => v * (sculpt && !fg?.skin ? [0.82, 0.68, 0.58][j] + ([1.12, 1.0, 0.94][j] - [0.82, 0.68, 0.58][j]) * dk : 1)), top = c(f.coat), legs = legs0.map((v, j) => v * legK * (sculpt ? [0.96, 1, 1.08][j] : 1)), shoes = c(f.shoes), hair = c(f.hair).map((v) => (sculpt && !fg?.hair ? (age ? v * 0.1 + 0.22 * age : v * 0.3) : v));
  const col = new Float32Array(60), surf = new Float32Array(20).fill(MAT.SKIN);
  const put = (slot, rgb, m) => { col.set(rgb, slot * 3); surf[slot] = m; };
  // skin is matte: the comic manner has no sheen on a face (gl/figure-hd.js)
  put(FIG_SLOT.skin, skin, MAT.MATTE); put(FIG_SLOT.face, skin, MAT.MATTE); put(FIG_SLOT.ear, skin, MAT.MATTE); put(FIG_SLOT.neck, skin, MAT.MATTE);
  put(FIG_SLOT.top, top, SURF[f.mat[0]] ?? MAT.CLOTH); put(FIG_SLOT.collar, top, SURF[f.mat[0]] ?? MAT.CLOTH);
  put(FIG_SLOT.legs, legs, SURF[f.mat[1]] ?? MAT.CLOTH); put(FIG_SLOT.shoes, shoes, SURF[f.mat[2]] ?? MAT.LEATHER);
  // what each is made of (figure.js figureFabric), slots 60 to 62; a settled look may name them
  const fb = figureFabric([R(60), R(61), R(62)], f.cut, wild), fab = new Float32Array(20);
  const FAB_SURF = { [FIG_FABRIC.leather]: MAT.LEATHER, [FIG_FABRIC.rubber]: MAT.GLOSS, [FIG_FABRIC.quilt]: MAT.SATIN };
  const fabOf = (slot, kind) => { const k = FIG_FABRIC[kind] ?? kind; fab[slot] = k; if (FAB_SURF[k] != null) surf[slot] = FAB_SURF[k]; };
  fabOf(FIG_SLOT.top, fg?.fabric_top ?? fb.top); fabOf(FIG_SLOT.collar, fg?.fabric_top ?? fb.top);
  fabOf(FIG_SLOT.legs, fg?.fabric_legs ?? fb.legs); fabOf(FIG_SLOT.shoes, fg?.fabric_shoes ?? fb.shoes);
  if (fb.cloak != null) fabOf(FIG_SLOT.cloak, fb.cloak);
  put(FIG_SLOT.hair, hair, MAT.SATIN); put(FIG_SLOT.card, hair, MAT.SATIN);
  put(FIG_SLOT.eye, skin, MAT.MATTE); put(FIG_SLOT.lid, skin, MAT.MATTE);
  // the gear's leather and the pads, from a short list each, and the gloves'
  const leather = c(pickOf(GEAR_LEATHER, 23)), pad = c(pickOf(GEAR_PADS, 24)), glove = c(pickOf(GEAR_LEATHER, 25));
  put(FIG_SLOT.gear, leather, MAT.LEATHER); put(FIG_SLOT.pad, pad, MAT.SATIN);
  // a shirt under a vest, a cloak, horn and bone, and the one blue a Wildblood wears: salvage
  put(FIG_SLOT.shirt, c(fg?.shirt ?? pickOf(SHIRTS, 33)), MAT.CLOTH); put(FIG_SLOT.cloak, c(pickOf(WILD.cloak, 34)), surf[FIG_SLOT.cloak] === MAT.LEATHER ? MAT.LEATHER : MAT.CLOTH);
  put(FIG_SLOT.horn, c(pickOf(WILD.horn, 35)), MAT.SATIN); put(FIG_SLOT.salvage, c([58, 110, 190]), MAT.GLOSS);
  const g0 = figureGear(R), style = fg?.hair_style ?? (soft ? pickOf([3, 3, 1, 4], 55) : f.face?.hairStyle ?? 0);
  const gear = wild ? { belt: true, strap: g0.strap, pouch: true, pads: false, gloves: false } : fg?.gear === false ? { belt: false } : g0;
  // their changes, a Gift asked for or a Lesson not (docs/lore-wildblood.md): one or two each
  const body = wild ? { mighty: R(36) < 0.35 ? (R(37) < 0.5 ? 'L' : 'R') : '', thorn: R(38) < 0.3, horns: R(39) < 0.3, claws: R(40) < 0.35, teeth: R(41) < 0.6, goggles: R(42) < 0.25 } : null;
  if (body && !body.mighty && !body.thorn && !body.horns && !body.claws) body.claws = true;
  // their mutations (figure.js MUTATION_LOOK): a Wildblood rolls one or two, slots 63 to 65; a settled
  // look names its own (flags.figure.mutations), which replace the roll
  const muts = fg?.mutations || figure?.mutations || (wild ? wildMutations([R(63), R(64), R(65)]) : []), ml = mutationLook(muts);
  const bodyM = Object.keys(ml.body).length ? { ...(body || {}), ...ml.body } : body;
  // a sculpted face's brows, mouth and facial hair: slots 47 to 51
  let fw = R(47) * FACIAL_ROLL.reduce((n, c) => n + c[1], 0), rolled = 'clean';
  for (const c of FACIAL_ROLL) { fw -= c[1]; if (fw <= 0) { rolled = c[0]; break; } }
  const fl = facialLook(!sculpt || soft ? 'clean' : fg ? fg.facial ?? (fg.beard ? 'stubble' : 'clean') : rolled);
  o = {
    mut: ml.paint, mutCol: new Float32Array(c(fg?.mut_accent ?? pickOf(MUT_ACCENT, 69))), key: { cut: f.cut, style, level, gear, body: bodyM, sculpt, head: sculptHead, build, weight, beard: fl.beardMesh }, age, col, beardA: fl.beardA, beardB: fl.beardB, faceV: new Float32Array([fg?.brow ?? (soft ? 0.5 : 0.75 + 0.55 * R(48)), fg?.mouth ?? 0.88 + 0.22 * R(49), fg?.beard ?? fl.stubble * (0.8 + 0.4 * R(51)), soft ? 1 : 0]), smile: fg?.smile || 0, trim: new Float32Array(fg?.trim ? c(fg.trim) : [0.02, 0.02, 0.02]), surf, fab, gloves: gear.gloves, glove: new Float32Array(glove),
    wild, mark: Math.floor(R(43) * 4), markCol: new Float32Array(c(pickOf(WILD.mark, 44))), wrapCol: new Float32Array(c(pickOf(WILD.wrap, 45))),
    face: new Float32Array([f.face?.layout ?? 0, sculpt && !soft ? 0 : f.face?.makeup ?? 0, style, rand(id)(5) * 50]),
    lip: new Float32Array(sculpt ? skin.map((v, j) => v * [0.8, 0.6, 0.55][j]) : c(f.face?.lip || f.skin)), lipstick: new Float32Array(c(f.face?.lipstick || f.skin)), iris: new Float32Array(c(f.face?.iris || [60, 40, 30])),
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
const CLIP_DUR = Object.fromEntries([...ACTOR_CLIPS, ...ACTOR_ROOM_CLIPS].map((c) => [c.name, c.dur]));
// How long a clip that plays once takes, in seconds; 0 for one that loops.
export const clipOnce = (name) => (ACTOR_ROOM_CLIPS.find((c) => c.name === name && c.once)?.dur || 0);
// The clip an act (client/shared/npc-acts.js) is for somebody standing, sitting or lying, or null.
const POSE_KEY = { stand: 'stand', sit: 'sit', lie: 'lie' };
export const actClip = (act, pose) => ACTOR_ACTS[act]?.[POSE_KEY[pose]] || null;
// How long an act plays before they go back to idling, in seconds: a clip that plays once, once; anything else a
// couple of its cycles, between eight seconds and fourteen.
export const clipHold = (name) => clipOnce(name) || Math.min(14, Math.max(8, 2 * (CLIP_DUR[name] || 6)));
// Seconds a clip's cycle takes.
export const clipDur = (name) => CLIP_DUR[name] || 6;
const NBONE = FIGURE_BONE_COUNT;
// The grown bones (figure.js FIGURE_XBONES), posed off their parents after the clip and the stance:
// each is its parent's skin matrix, then to its joint, turned, scaled, and back from where it was modelled.
const XPARENT = FIGURE_XBONES.map((x) => FIGURE_BONE[x.parent]);
function mul4(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
// Ry · Rx · Rz, column-major, scaled by k
function turn4(yaw, pitch, roll, k) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  const m = [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz, 0, -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz, 0, sy * cx, -sx, cy * cx, 0, 0, 0, 0, 1];
  for (let i = 0; i < 11; i++) if (i % 4 !== 3) m[i] *= k;
  return m;
}
// an affine 4×4's inverse (column-major)
function inv4(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], k = m[10];
  const A = e * k - f * h, Bq = -(d * k - f * g), C = d * h - e * g, det = a * A + b * Bq + c * C || 1e-9;
  const i00 = A / det, i01 = -(b * k - c * h) / det, i02 = (b * f - c * e) / det;
  const i10 = Bq / det, i11 = (a * k - c * g) / det, i12 = -(a * f - c * d) / det;
  const i20 = C / det, i21 = -(a * h - b * g) / det, i22 = (a * e - b * d) / det;
  const tx = m[12], ty = m[13], tz = m[14];
  return [i00, i10, i20, 0, i01, i11, i21, 0, i02, i12, i22, 0, -(i00 * tx + i01 * ty + i02 * tz), -(i10 * tx + i11 * ty + i12 * tz), -(i20 * tx + i21 * ty + i22 * tz), 1];
}
const T4 = (p) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
// a second head blinks on its own clock
const blinkOf = (t, R0) => { const every = 4.1 + 2.3 * R0(67), b = (t + R0(68) * 9) % every; return b < 0.16 ? Math.sin((b / 0.16) * Math.PI) : 0; };
const hash1 = (n) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
function growBones(S, t, seed) {
  const out = S.slice();
  FIGURE_XBONES.forEach((x, i) => {
    let yaw = x.yaw || 0, pitch = x.pitch || 0, roll = x.roll || 0;
    if (x.move === 'look') {
      // a second head looks about on its own clock: a glance every couple of seconds, eased
      const u = t + seed * 5, g = Math.floor(u / 2.4), e = Math.min(1, (u % 2.4) / 0.35), k = e * e * (3 - 2 * e);
      const was = hash1(g * 12.9898 + seed * 78.2) - 0.5, now = hash1((g + 1) * 12.9898 + seed * 78.2) - 0.5;
      yaw += (was + (now - was) * k) * 1.1; pitch = 0.06 * Math.sin(t * 0.7 + seed) - 0.05;
    } else if (x.move === 'sway') {
      roll += x.amp * Math.sin(t * 0.9 + x.ph + seed * 6); pitch += x.amp * 0.7 * Math.sin(t * 0.63 + x.ph * 1.3 + seed * 4);
    } else if (x.move === 'flap') {
      yaw += 0.07 * Math.sin(t * 0.8 + seed) * Math.sign(x.at[0]);
    }
    if (x.move === 'copy') {
      // the source bone's motion relative to its own parent, laid on this one: a root is also moved
      // from where it was modelled to where it sits, and turned there
      const si = FIGURE_BONE[x.src], sp = FIGURE_BONES[si][1], rel = mul4(inv4(out[sp]), out[si]);
      const off = x.from ? mul4(mul4(T4(x.at), turn4(yaw, pitch, roll, 1)), T4(x.from.map((v) => -v))) : null;
      out[FIGURE_BONES.length + i] = mul4(out[XPARENT[i]], off ? mul4(off, rel) : rel);
      return;
    }
    const m = mul4(mul4(T4(x.at), turn4(yaw, pitch, roll, x.k || 1)), T4((x.from || x.at).map((v) => -v)));
    out[FIGURE_BONES.length + i] = mul4(out[XPARENT[i]], m);
  });
  return out;
}
// A build's stance, laid on the posed bones so it holds through every clip. Each turn is about a joint
// where the pose has put it: the arms held off the body, the back bowed from the chest, and the head
// brought most of the way back up to look ahead.
const BN = FIGURE_BONE, JOINT = { uarmL: [0.195, 1.39, -0.01], uarmR: [-0.195, 1.39, -0.01], chest: [0, 1.22, 0], head: [0, 1.53, 0.005] };
const UPPER = ['chest', 'neck', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR'].map((n) => BN[n]);
const at = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
// turn bone matrices about an axis (a, b are the two axes the turn mixes) through pivot p
function turn(M, bones, a, b, ang, p) {
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const i of bones) {
    const m = (M[i] = Float32Array.from(M[i]));
    for (let k = 0; k < 4; k++) {
      const A = m[k * 4 + a] - (k === 3 ? p[a] : 0), Bv = m[k * 4 + b] - (k === 3 ? p[b] : 0);
      m[k * 4 + a] = c * A - s * Bv + (k === 3 ? p[a] : 0);
      m[k * 4 + b] = s * A + c * Bv + (k === 3 ? p[b] : 0);
    }
  }
}
const HEAD_SINK = 0.016;
// the sculpted face's lower half, lifted to put it in thirds; the head sinks by the same again, so the chin
// stays where it was on the neck. A soft face is shorter already.
const FACE_UP = 0.012, FACE_UP_SOFT = 0.006, faceUpOf = (key) => (!key.sculpt ? 0 : key.head === 3 ? FACE_UP_SOFT : FACE_UP);
function stance(S, key, armsOff = 1) {
  const B0 = key.sculpt ? SCULPT_BUILDS[key.build] : null, Bd = B0 && key.weight !== null && key.weight !== undefined ? { ...B0, abduct: (B0.abduct || 0) + somaOf(key.weight).abduct } : B0;
  if (!Bd) return S;
  const M = Array.from(S);
  if (Bd.abduct) {
    turn(M, [BN.uarmL, BN.farmL, BN.handL], 0, 1, Bd.abduct * armsOff, at(M[BN.uarmL], JOINT.uarmL));
    turn(M, [BN.uarmR, BN.farmR, BN.handR], 0, 1, -Bd.abduct * armsOff, at(M[BN.uarmR], JOINT.uarmR));
  }
  if (Bd.hunch) {
    turn(M, UPPER, 2, 1, Bd.hunch, at(M[BN.chest], JOINT.chest));
    turn(M, [BN.head], 2, 1, -Bd.hunch * 0.75, at(M[BN.head], JOINT.head));
  }
  // the head sits lower on the neck: the sculpted figure's is too long otherwise
  const hd = (M[BN.head] = Float32Array.from(M[BN.head]));
  // and lower again on a heavy body, whose neck is short
  const sink = HEAD_SINK + faceUpOf(key) + (key.weight === null || key.weight === undefined ? 0 : 0.012 * somaOf(key.weight).fat);
  for (let r = 0; r < 3; r++) hd[12 + r] -= sink * hd[4 + r];
  return M;
}
// What somebody with nothing to do is doing at time `t`: a clip for each slot, off their id, and the
// last one for the second it takes to go from it to the next. A pure function of the id and the clock,
// so it costs no state, and everybody in a room is on their own slots.
// `kind` is an ACTOR_IDLES list: how they are (stand, sit, lie, asleep, out cold) or the work they're at.
const IDLE_SLOT = 10, IDLE_BLEND = 1.2;
function idlePlan(id, kind, t) {
  const list = ACTOR_IDLES[kind] || ACTOR_IDLES.stand, slot = ACTOR_IDLE_SLOT[kind] || IDLE_SLOT, R = rand(id), total = list.reduce((n, c) => n + c[1], 0);
  const u = (t + R(6) * slot) / slot, n = Math.floor(u), f = u - n;
  const pick = (i) => { let w = R(60 + (((i % 40) + 40) % 40)) * total; for (const c of list) { w -= c[1]; if (w <= 0) return c[0]; } return list[0][0]; };
  const a = pick(n - 1), b = pick(n), cycles = (c) => Math.max(1, Math.round(slot / (CLIP_DUR[c] || slot)));
  const x = Math.min(1, (f * slot) / IDLE_BLEND);
  return { a, pa: (1 + f) * cycles(a), b, pb: f * cycles(b), k: x * x * (3 - 2 * x), f };
}
// A man's facial hair, as [name, how often]. A roll, unless his look is settled (flags.figure.facial).
const FACIAL_ROLL = [['clean', 3.2], ['stubble', 2], ['shadow', 1.4], ['moustache', 0.8], ['goatee', 1], ['vandyke', 0.5], ['soulpatch', 0.3], ['chinstrap', 0.4], ['sideburns', 0.4], ['trimmed', 0.8], ['full', 0.8], ['long', 0.25]];
const facialLook = (name) => { const F = FIGURE_FACIAL[name] || FIGURE_FACIAL.clean; return { beardA: new Float32Array(F.shape || [0, 0, 0, 0]), beardB: new Float32Array(F.more || [0, 0, 0]), beardMesh: F.mesh || '', stubble: F.stubble || 0 }; };
// How an order dresses its people in a room, by the order's id (plugins/roomstage sends an NPC's).
// The others wear the city's clothes.
const ORDER_DRESS = { ideology_wildblood: 'wildblood' };
export const dressOf = (order) => ORDER_DRESS[order] || '';
// Level of detail in a room. Across the room nobody sees an eyelid, so a person drops from the close-up figure to
// the lite one, and the gap between the two distances stops somebody at the line flickering between them.
export const FIGURE_LOD = { near: 3.1, far: 3.7 };
const lodOf = new Map();
function levelAt(L, body, asked, eye) {
  if (asked !== 'hd') return asked;
  const p = L.world(body.at[0], body.at[1], 1.5), d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
  const lv = lodOf.get(body.id) === 'lite' ? (d < FIGURE_LOD.near ? 'hd' : 'lite') : d > FIGURE_LOD.far ? 'lite' : 'hd';
  lodOf.set(body.id, lv);
  return lv;
}
// `bodies` as peopleBatch takes them, each with a `dress` (dressOf); `level` is figure.js's (`lite`
// on a phone). Returns
// [{ key, rows, col, surf, face, lip, lipstick, iris }] for gl/figure-hd.js.
// `eye` is the camera, and lets a close-up figure drop to the lite one with distance.
export function figurePeople(L, bodies, t = 0, { level: asked = 'hd', eye = null } = {}) {
  const out = [];
  for (const body of bodies) {
    const level = eye ? levelAt(L, body, asked, eye) : asked;
    let o = lookOf(body.id, level, body.dress || '', !!body.sculpt, body.sex || '', body.figure || null);
    // the Lab's own picks
    if (body.build) o = { ...o, key: { ...o.key, build: body.build } };
    if (body.facial) { const fl = facialLook(body.facial), fv = o.faceV.slice(); fv[2] = fl.stubble; o = { ...o, faceV: fv, beardA: fl.beardA, beardB: fl.beardB, key: { ...o.key, beard: fl.beardMesh } }; }
    if (body.weight !== undefined && body.weight !== '') o = { ...o, key: { ...o.key, weight: Math.round(body.weight * 10) / 10 } };
    // `clip` is the stage's when they're walking or talking; a walk's phase is how far they've come
    const lying = body.pose === 'lie', clip = body.clip || (body.pose === 'sit' ? 'sit' : lying ? 'lieBack' : 'idle'), dur = CLIP_DUR[clip] || 4;
    // with nothing to do, what they're doing comes off their id and the clock: from what suits how they are, asleep
    // or out cold, or at the work they're at (`manner`, plugins/roomstage)
    const kind = lying ? body.rest || 'lie' : body.pose === 'sit' ? (body.rest === 'sleep' ? 'sitSleep' : body.rest === 'out' ? 'sitOut' : 'sit') : body.manner || 'stand';
    const plan = !body.clip && body.phase === undefined && (body.pose === 'sit' || body.pose === 'stand' || lying) ? idlePlan(body.id, kind, t) : null;
    const seated = lying || (plan ? plan.b : clip).startsWith('sit');
    // the face: what they're saying, or what the clip does to it, and a blink every few seconds
    const R0 = rand(body.id), M = o.key.sculpt ? body.mouth || null : null, cf = !o.key.sculpt ? null : plan ? actorClipFace(plan.b, plan.pb) : body.clip ? actorClipFace(clip, body.phase ?? t / dur) : null;
    // the eyes settle on something for a couple of seconds, then flick to something else
    const look = Math.floor((t + R0(9) * 7) / (1.8 + 1.6 * R0(10))), gaze = body.gaze || [(R0(70 + (look % 24)) - 0.5) * 0.5, (R0(95 + (look % 24)) - 0.5) * 0.22];
    const every = 3.2 + 3.4 * R0(7), blinkAt = (t + R0(8) * 9) % every, blink = Math.max(blinkAt < 0.16 ? Math.sin((blinkAt / 0.16) * Math.PI) : 0, cf?.shut || 0);
    // `mix` is a host's own blend of two clips ({ a, pa, b, pb, k }), as the Zamboni's driver eases into a wave
    const mx = body.mix;
    const S0 = stance(mx ? actorSkinMix(mx.a, mx.pa, mx.b, mx.pb, mx.k) : plan ? actorSkinMix(plan.a, plan.pa, plan.b, plan.pb, plan.k) : actorSkinAt(clip, body.phase ?? (clip === 'walk' ? (body.walked || 0) / actorStrideM() : t / dur + rand(body.id)(3))), o.key, seated ? 0.3 : 1);
    const { O, AX, AY, AZ } = placeOf(L, body);
    // the head goes where the eyes go, and turns to whoever's watching when they come close
    const { S: S1, eyes } = lying ? { S: S0, eyes: gaze } : lookAround(S0, body, kind, O, AX, AY, AZ, eye, gaze, t);
    // the grown bones, off the posed ones (only a mutated body has anything on them)
    const S = o.key.body ? growBones(S1, t, R0(66)) : S1;
    // stood on the floor: the lowest sole point at zero, as the bake drops its frames. Lying, the feet are where
    // placeOf puts them, and a knee drawn up mustn't slide the whole body up the bed
    let drop = lying ? 0 : Infinity;
    if (!lying) for (const v of solesOf(o.key)) {
      let y = 0;
      for (let k = 0; k < 4; k++) { if (!v.w[k]) continue; const m = S[v.b[k]]; y += v.w[k] * (m[1] * v.p[0] + m[5] * v.p[1] + m[9] * v.p[2] + m[13]); }
      if (y < drop) drop = y;
    }
    if (!Number.isFinite(drop)) drop = 0;
    // their height (flags.figure.height, or the Lab's pick), metres to the crown: the posed body scaled about
    // the floor under it, or about the pelvis when they're sat or lying, so a tall man still sits on the chair
    const hm = o.key.sculpt ? +(body.height || body.figure?.height || 0) : 0, hk = hm > 1 ? hm / FIGURE_CROWN : 1;
    const piv = seated ? [S[0][12], S[0][13], S[0][14]] : [0, drop, 0];
    // each bone's 3×4, bind space into the room: placed (O + AX x + AY (y - drop) + AZ z) after its skin matrix
    const rows = new Float32Array(NBONE * 12);
    for (let b = 0; b < Math.min(NBONE, S.length); b++) {
      const m0 = S[b], m = hk === 1 ? m0 : m0.map((v, i) => (i === 12 || i === 13 || i === 14 ? hk * v + (1 - hk) * piv[i - 12] : i % 4 === 3 ? v : hk * v));
      for (let r = 0; r < 3; r++) {
        const o4 = b * 12 + r * 4;
        for (let c = 0; c < 4; c++) rows[o4 + c] = AX[r] * m[c * 4] + AY[r] * m[c * 4 + 1] + AZ[r] * m[c * 4 + 2];
        rows[o4 + 3] += O[r] - AY[r] * drop;
      }
    }
    out.push({ key: o.key, rows, col: o.col, surf: o.surf, fab: o.fab, mut: o.mut || 0, mutCol: o.mutCol, blink2: o.key.body?.head2 ? blinkOf(t + 1.7, R0) : 0, face: o.face, lip: o.lip, lipstick: o.lipstick, iris: o.iris, faceV: o.faceV, age: o.age, smile: o.smile, trim: o.trim, beardA: o.beardA, beardB: o.beardB,
      mouthA: [M?.open ?? cf?.open ?? 0, M?.wide ?? 0, M?.round ?? cf?.round ?? 0], mouthB: [M?.press ?? 0, M?.teeth ?? 0, M?.tongue ?? 0], blink: o.key.sculpt ? blink : 0, faceUp: faceUpOf(o.key), realEye: o.key.sculpt && o.key.level === 'hd', gaze: eyes, gloves: o.gloves, glove: o.glove, wild: o.wild, mark: o.mark, markCol: o.markCol, wrapCol: o.wrapCol });
  }
  return out;
}
// Where somebody's head is pointed, eased per person so it turns rather than snaps: { y, p, t, on }.
const heads = new Map();
// Who notices the viewer: inside this many metres, and within this far round from straight ahead (radians).
export const NOTICE = { near: 3.2, arc: 1.7, yaw: 0.85, pitch: 0.35, rate: 3.5 };
// The posed bones with the head (and a little of the chest) turned to look. The head follows the eyes'
// wander a third of the way; a person awake and close by turns to the viewer most of the time, a few
// seconds in each nine or so, and their eyes come to rest on the viewer's. Asleep or out cold, nobody looks.
function lookAround(S, body, kind, O, AX, AY, AZ, eye, gaze, t) {
  const R = rand(body.id), awake = !/sleep|Out|out/.test(kind) && body.rest !== 'sleep' && body.rest !== 'out';
  let ty = gaze[0] * 0.6, tp = gaze[1] * 0.5, on = false;
  if (eye && awake && !body.gaze) {
    const hy = body.pose === 'sit' ? 1.15 : 1.55, d = [0, 1, 2].map((r) => eye[r] - (O[r] + AY[r] * hy));
    const x = d[0] * AX[0] + d[1] * AX[1] + d[2] * AX[2], y = d[0] * AY[0] + d[1] * AY[1] + d[2] * AY[2], z = d[0] * AZ[0] + d[1] * AZ[1] + d[2] * AZ[2];
    const flat = Math.hypot(x, z), yaw = Math.atan2(x, z), slot = 9 + 4 * R(11), keen = 0.45 + 0.4 * R(12);
    // whether they've the mind to look, this slot of their own clock
    const minded = R(110 + (Math.floor((t + R(13) * slot) / slot) % 30)) < keen;
    if (flat < NOTICE.near && Math.abs(yaw) < NOTICE.arc && minded) {
      on = true;
      ty = Math.max(-NOTICE.yaw, Math.min(NOTICE.yaw, yaw));
      tp = Math.max(-NOTICE.pitch, Math.min(NOTICE.pitch, Math.atan2(y, flat)));
    }
  }
  let h = heads.get(body.id);
  const dt = h ? t - h.t : 0;
  if (!h || dt < 0 || dt > 1) h = { y: ty, p: tp };
  else { const k = 1 - Math.exp(-dt * NOTICE.rate); h = { y: h.y + (ty - h.y) * k, p: h.p + (tp - h.p) * k }; }
  h.t = t; h.on = on;
  heads.set(body.id, h);
  if (Math.abs(h.y) < 1e-3 && Math.abs(h.p) < 1e-3) return { S, eyes: gaze };
  const M = Array.from(S);
  // a fifth of the turn from the chest, the rest from the top of the neck
  turn(M, UPPER, 2, 0, h.y * 0.2, at(M[BN.chest], JOINT.chest));
  const pv = at(M[BN.head], JOINT.head);
  turn(M, [BN.head], 2, 0, h.y * 0.8, pv);
  turn(M, [BN.head], 2, 1, h.p, pv);
  // looking at the viewer, the eyes are on them: what's left of the wander, mostly gone
  return { S: M, eyes: on ? [gaze[0] * 0.15, gaze[1] * 0.15] : gaze };
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
  return { O: L.world(body.at[0], body.at[1], L.baseAt?.(body.at[0], body.at[1]) || 0), AX: [Math.cos(yaw), 0, -Math.sin(yaw)], AY: [0, 1, 0], AZ: [Math.sin(yaw), 0, Math.cos(yaw)] };
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
      O = L.world(body.at[0], body.at[1], L.baseAt?.(body.at[0], body.at[1]) || 0);
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
