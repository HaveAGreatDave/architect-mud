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
import { buildFigure, figureKey, figureGear, figureFabric, mutationLook, wildMutations, somaOf, FIGURE_FACIAL, FIG_SLOT, FIG_FABRIC, FIGURE_CUTS, bustApex, FIGURE_XBONES, FIGURE_BONE_COUNT, FIGURE_BONES, FIGURE_BONE, SCULPT_BUILDS, FIGURE_CROWN, propKey, propsOf, propBind, propUpright, handScaleOf } from '../figure.js';
import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';
import { expressionOf, easeExpression } from '../../../../shared/expressions.js';
import { feelBand, wearFor } from '../../../../shared/comfort.js';

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
// `wear` is what they're dressed for where no look was authored for it (plugins/roomstage dressedAs): an
// occasion and a temperature band, which client/shared/comfort.js wearFor turns into a change of clothes.
// A settled look arrives as a new object with every `room_people`, so its text is kept by the object.
const figSigs = new WeakMap();
const figSig = (fg) => { let s = figSigs.get(fg); if (s === undefined) { s = JSON.stringify(fg); figSigs.set(fg, s); } return s; };
function lookOf(id, level, dress = '', sculpt = false, sex = '', figure = null, wear = null) {
  const fg = sculpt ? figure : null, wr = wear && dress !== 'wildblood' && (wear.occasion || wear.feel) ? wear : null;
  // the look itself is in the key: somebody changing for work or for bed is a different look, not a stale one
  const k = id + '|' + level + '|' + dress + (sculpt ? '|s' + sex + (globalThis.__figureMature ? '|M' : '') : '') + (fg ? '|f' + figSig(fg) : '') + (wr ? '|w' + (wr.occasion || '') + (wr.feel || 0) : '');
  let o = looks.get(k);
  if (o) return o;
  const R = rand(id), pickOf = (list, j) => list[Math.min(list.length - 1, Math.floor(R(j) * list.length))];
  const fr = actorOutfit(R), c = (rgb) => lin(hexOf(rgb)), wild = dress === 'wildblood';
  const f0 = fg ? { ...fr, cut: fg.cut ?? fr.cut, coat: fg.top ?? fr.coat, legs: fg.legs ?? fr.legs, shoes: fg.shoes ?? fr.shoes, skin: fg.skin ?? fr.skin, hair: fg.hair ?? fr.hair, mat: fg.top ? [0, 0, 2] : fr.mat,
    face: { ...fr.face, iris: fg.iris ?? fr.face?.iris, layout: fg.layout ?? fr.face?.layout } } : fr;
  // a Wildblood's from the town's own palettes, the skin tinted, the eyes gone amber
  const f = wild ? { ...f0, cut: 'tunic', coat: pickOf(WILD.tunic, 26), legs: pickOf(WILD.legs, 27), shoes: pickOf(WILD.shoes, 28), hair: pickOf(WILD.hair, 29),
    skin: f0.skin.map((v, j) => v * 0.55 + pickOf(WILD.tint, 30)[j] * 0.45), mat: [0, 0, 2], face: { ...f0.face, iris: pickOf(WILD.iris, 31), hairStyle: pickOf([3, 2, 3, 0, 4], 32) } } : { ...f0 };
  // a sculpted person: head shape, build and age off the same rand, slots 46 and 52 to 53. The soft
  // head is a woman's, and takes a woman's build and hair.
  const sculptHead = !sculpt ? 0 : fg?.head ?? (sex === 'female' ? 3 : sex === 'male' ? Math.min(2, Math.floor(R(46) * 3)) : Math.min(3, Math.floor(R(46) * 4))), soft = sculptHead === 3, br = R(52);
  // dressed for the occasion and the temperature: another cut in their own colour, in plain cloth, and the
  // bottoms, hat and scarf to go with it. Slots 120 and 121.
  const wardrobe = wardrobeOf(R, fg, soft, f.cut);
  if (wr) {
    const ch = wearFor({ cut: f.cut, ...wardrobe }, { occasion: wr.occasion, feel: wr.feel, female: soft || sex === 'female' }, R(120), R(121));
    if (ch.cut) { f.cut = ch.cut; f.mat = [0, f.mat[1], f.mat[2]]; }
    for (const key of ['bottoms', 'hat', 'scarf']) if (key in ch) wardrobe[key] = ch[key];
  }
  const build = !sculpt ? 'average' : fg?.build ? fg.build : soft ? 'woman' : br < 0.84 ? 'average' : br < 0.95 ? 'older' : 'hunched';
  // their weight, ectomorph to endomorph, in tenths so people share meshes: most near the middle, the old a
  // little heavier. Slots 56 and 57. A settled look without one keeps the base body.
  const weight = !sculpt ? null : fg ? fg.weight ?? null : Math.round(Math.min(1, (R(56) + R(57)) / 2 + (build === 'older' ? 0.15 : 0)) * 10) / 10;
  const age = fg?.age ?? (sculpt && (build === 'older' || R(53) < 0.1) ? 0.6 + 0.4 * R(54) : 0);
  // sculpted, nothing below the waist is paler than worn denim: the eye belongs on the face and jacket
  if (f.cut === 'strapwrap' && !fg?.top) f.coat = [226, 222, 212];
  // an underwear set's bottoms are its top's colour (figure.js FIGURE_CUTS legs)
  const legs0 = FIGURE_CUTS[f.cut]?.legs && !fg?.legs ? c(f.coat) : c(f.legs), legK = sculpt && !FIGURE_CUTS[f.cut]?.legs ? Math.min(1, 0.05 / Math.max(1e-3, (legs0[0] + legs0[1] + legs0[2]) / 3)) : 1;
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
    print: fg?.print || '', mut: ml.paint, mutCol: new Float32Array(c(fg?.mut_accent ?? pickOf(MUT_ACCENT, 69))), key: { cut: f.cut, style, level, gear, body: bodyM, sculpt, head: sculptHead, spikes: sculpt ? Math.round(Math.max(0, Math.min(1, +fg?.spikes || 0)) * 10) / 10 : 0, build, weight, beard: fl.beardMesh, prop: sculpt ? propKey(fg?.props) : '', bust: !sculpt ? null : fg?.bust ?? (soft ? Math.round((0.15 + 0.7 * R(70)) * 10) / 10 : null), groin: sculpt && globalThis.__figureMature && !soft ? 'm' : '', ...wardrobe, butt: !sculpt ? null : fg?.butt ?? (soft ? Math.round((0.15 + 0.75 * R(71)) * 10) / 10 : null) }, neck: fg?.neckline || null, slit: fg?.slit || null, age, col, beardA: fl.beardA, beardB: fl.beardB, faceV: new Float32Array([fg?.brow ?? (soft ? 0.5 : 0.75 + 0.55 * R(48)), fg?.mouth ?? 0.88 + 0.22 * R(49), fg?.beard ?? fl.stubble * (0.8 + 0.4 * R(51)), soft ? 1 : 0]), smile: fg?.smile || 0, trim: new Float32Array(fg?.trim ? c(fg.trim) : [0.02, 0.02, 0.02]), surf, fab, gloves: gear.gloves, glove: new Float32Array(glove),
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
// Points on the back of a body in bind space, each on the bone that carries it: the seat, the small of the
// back, between the shoulder blades, the back of the skull (figurePeople's seat-back check)
const BACK_PROBES = [[FIGURE_BONE.pelvis, [0, 0.95, -0.13]], [FIGURE_BONE.spine, [0, 1.1, -0.12]], [FIGURE_BONE.chest, [0, 1.32, -0.13]], [FIGURE_BONE.head, [0, 1.6, -0.1]]];
const at = (m, p) =>[0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
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
// Surfaces an arm mustn't pass through: a mark's `table` in front of them (its top `h` above the floor, and `near`
// to `far`, how far in front of them it runs) and its `surfaces`, boxes in the set's own frame ({ u0, u1, v0, v1, h,
// thick }), such as a bar at somebody's elbow. After the pose, a hand or an elbow it puts inside one is swung up at
// the shoulder, by flexion or abduction, whichever lifts it more, until it rests on the top. A point deeper than
// the top's thickness near an edge is under it (a hand in a lap), not in it; well inside, it can only be in it.
// `test(p)` takes a body-space point and gives how far it is below the top plus its clearance (body metres) and
// how far inside the nearest edge it is, or null. A hand holding something keeps that much more clear, and the
// thing itself is tested at its own base (`anchors`, bind-space points on each hand). `land` names a hand that's
// bringing something down on a surface (a slam's hit): a point just above the top is drawn down onto it.
function onSurfaces(S, tests, clear, anchors = {}, land = {}) {
  const M = Array.from(S);
  for (const [L, sd] of [['L', 1], ['R', -1]]) {
    const arm = [BN['uarm' + L], BN['farm' + L], BN['hand' + L]];
    let turned = 0;
    for (let k = 0; k < 5; k++) {
      const sh = at(M[BN['uarm' + L]], JOINT['uarm' + L]);
      const pts = [[at(M[BN['hand' + L]], [sd * 0.195, 0.8, 0.01]), clear[L]], [at(M[BN['farm' + L]], [sd * 0.195, 1.1, -0.01]), 0.04]];
      if (anchors[L]) pts.push([at(M[BN['hand' + L]], anchors[L]), 0.004, true]);
      let worst = null;
      for (const [q, cl, base] of pts) for (const test of tests) {
        const r = test(q, cl);
        if (!r) continue;
        // a hand coming down hard lands: its lowest point, hovering just over the top, goes down onto it
        if (land[L] && r.dy < -0.002 && r.dy > -0.1 && (base || !anchors[L])) { if (!worst || (worst.dy < 0 && r.dy > worst.dy)) worst = { q, dy: r.dy, deep: true }; continue; }
        if (r.dy <= 0.002) continue;
        const deep = r.edge > 0.25;
        if (!deep && r.dy > cl + r.thick) continue;
        if (!worst || worst.dy < 0 || r.dy > worst.dy) worst = { q, dy: r.dy, deep };
      }
      if (!worst) break;
      const oz = worst.q[2] - sh[2], ox = worst.q[0] - sh[0], useZ = Math.abs(oz) >= Math.abs(ox), off = useZ ? oz : ox;
      const ang = Math.sign(off || 1) * Math.sign(worst.dy) * Math.min(0.35, Math.abs(worst.dy) / Math.max(0.12, Math.abs(off)));
      turned += Math.abs(ang);
      if (turned > (worst.deep ? 0.9 : 0.6)) break;
      turn(M, arm, useZ ? 2 : 0, 1, ang, sh);
    }
  }
  return M;
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
// `feel` is how the room feels (client/shared/comfort.js, -1 cold to 1 hot): past room temperature, some of
// their slots go to the cold or the heat, a third of them just past the edge and most of them at its worst.
// A dancer at her pole keeps dancing, and nobody asleep notices.
const TEMP_IDLES = { '-2': 'cold', '-1': 'cool', 1: 'warm', 2: 'hot' }, TEMP_SIT = { '-2': 'sitCold', '-1': 'sitCool', 1: 'sitWarm', 2: 'sitHot' };
const NO_TEMP = new Set(['lie', 'sleep', 'out', 'sitSleep', 'sitOut', 'pole', 'floorwork', 'poleHot', 'floorHot']);
const TEMP_SHARE = [0.3, 0.85];
function idlePlan(id, kind, t, feel = 0) {
  const own = ACTOR_IDLES[kind] || ACTOR_IDLES.stand, slot = ACTOR_IDLE_SLOT[kind] || IDLE_SLOT, R = rand(id);
  const band = feel && !NO_TEMP.has(kind) ? feelBand(feel) : 0, temp = band ? ACTOR_IDLES[(kind === 'sit' ? TEMP_SIT : TEMP_IDLES)[band]] : null;
  const share = TEMP_SHARE[0] + (TEMP_SHARE[1] - TEMP_SHARE[0]) * Math.abs(feel);
  const u = (t + R(6) * slot) / slot, n = Math.floor(u), f = u - n;
  const pick = (i) => {
    const j = ((i % 40) + 40) % 40, list = temp && R(130 + j) < share ? temp : own;
    let w = R(60 + j) * list.reduce((s, c) => s + c[1], 0);
    for (const c of list) { w -= c[1]; if (w <= 0) return c[0]; }
    return list[0][0];
  };
  const a = pick(n - 1), b = pick(n), cycles = (c) => Math.max(1, Math.round(slot / (CLIP_DUR[c] || slot)));
  const x = Math.min(1, (f * slot) / IDLE_BLEND);
  return { a, pa: (1 + f) * cycles(a), b, pb: f * cycles(b), k: x * x * (3 - 2 * x), f };
}
// Bottoms, a hat and a scarf off the id (slots 72 to 74), or as flags.figure names them ('' or false for none): most
// people wear trousers bareheaded; women roll skirts more often than men, and the Wildblood none of it.
const BOTTOMS_M = [['', 70], ['shorts', 8], ['cutoffs', 4], ['bermudas', 5], ['capris', 1]];
const BOTTOMS_F = [['', 44], ['shorts', 6], ['cutoffs', 5], ['bermudas', 2], ['capris', 6], ['mini', 7], ['pencil', 8], ['aline', 9], ['midi', 8], ['longskirt', 5]];
const HATS = [['', 78], ['beanie', 6], ['cap', 6], ['fedora', 3], ['bucket', 2], ['hardhat', 2], ['flatcap', 3]];
const SCARVES = [['', 88], ['scarf', 5], ['chunky', 3], ['snood', 2], ['bandana', 2]];
const weighed = (list, x) => { let t = 0; for (const [, w] of list) t += w; x *= t; for (const [v, w] of list) if ((x -= w) < 0) return v; return list[0][0]; };
function wardrobeOf(R, fg, soft, cut) {
  if (cut === 'tunic') return {};
  const pick = (k, list, j) => (fg && k in fg ? fg[k] || '' : weighed(list, R(j)));
  return { bottoms: pick('bottoms', soft ? BOTTOMS_F : BOTTOMS_M, 72), hat: pick('hat', HATS, 73), scarf: pick('scarf', SCARVES, 74) };
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
    let o = lookOf(body.id, level, body.dress || '', !!body.sculpt, body.sex || '', body.figure || null, body.wear || null);
    // the Lab's own picks
    if (body.build) o = { ...o, key: { ...o.key, build: body.build } };
    for (const k of ['bottoms', 'hat', 'scarf']) if (body[k] !== undefined) o = { ...o, key: { ...o.key, [k]: body[k] } };
    if (body.facial) { const fl = facialLook(body.facial), fv = o.faceV.slice(); fv[2] = fl.stubble; o = { ...o, faceV: fv, beardA: fl.beardA, beardB: fl.beardB, key: { ...o.key, beard: fl.beardMesh } }; }
    if (body.weight !== undefined && body.weight !== '') o = { ...o, key: { ...o.key, weight: Math.round(body.weight * 10) / 10 } };
    if (o.key.sculpt && body.bust != null) o = { ...o, key: { ...o.key, bust: Math.round(body.bust * 10) / 10 } };
    if (o.key.sculpt && body.butt != null) o = { ...o, key: { ...o.key, butt: Math.round(body.butt * 10) / 10 } };
    // `clip` is the stage's when they're walking or talking; a walk's phase is how far they've come
    const lying = body.pose === 'lie', clip = body.clip || (body.pose === 'sit' ? 'sit' : lying ? 'lieBack' : 'idle'), dur = CLIP_DUR[clip] || 4;
    // with nothing to do, what they're doing comes off their id and the clock: from what suits how they are, asleep
    // or out cold, or at the work they're at (`manner`, plugins/roomstage)
    const kind = lying ? body.rest || 'lie' : body.pose === 'sit' ? (body.rest === 'sleep' ? 'sitSleep' : body.rest === 'out' ? 'sitOut' : 'sit') : body.manner || 'stand';
    const plan = !body.clip && body.phase === undefined && (body.pose === 'sit' || body.pose === 'stand' || lying) ? idlePlan(body.id, kind, t, body.feel || 0) : null;
    const seated = lying || (plan ? plan.b : clip).startsWith('sit');
    // the face: what they're saying, or what the clip does to it, and a blink every few seconds
    const R0 = rand(body.id), M = o.key.sculpt ? body.mouth || null : null, cf = !o.key.sculpt ? null : plan ? actorClipFace(plan.b, plan.pb) : body.clip ? actorClipFace(clip, body.phase ?? t / dur) : null;
    // the eyes settle on something for a couple of seconds, then flick to something else
    const look = Math.floor((t + R0(9) * 7) / (1.8 + 1.6 * R0(10))), gaze = body.gaze || [(R0(70 + (look % 24)) - 0.5) * 0.5, (R0(95 + (look % 24)) - 0.5) * 0.22];
    // their mood: how the brows, lids and mouth sit, and how often they blink (frightened, a lot; tired, hardly)
    const X = o.key.sculpt ? moodFace(body, t) : null;
    const every = (3.2 + 3.4 * R0(7)) / Math.max(0.3, X?.blink ?? 1), blinkAt = (t + R0(8) * 9) % every, blink = Math.max(blinkAt < 0.16 ? Math.sin((blinkAt / 0.16) * Math.PI) : 0, cf?.shut || 0, X ? Math.max(0, -X.lid) * 0.42 : 0);
    // `mix` is a host's own blend of two clips ({ a, pa, b, pb, k }), as the Zamboni's driver eases into a wave
    const mx = body.mix;
    const ph = body.phase ?? (clip === 'walk' ? (body.walked || 0) / actorStrideM() : t / dur + rand(body.id)(3));
    // a change of clip (a new act at the head of a beat, or back to idling) eases over from the last pose
    const now = mx ? null : plan ? (plan.k > 0.5 ? { c: plan.b, p: plan.pb } : { c: plan.a, p: plan.pa }) : { c: clip, p: ph };
    let xf = now ? fades.get(body.id) : null;
    if (now) {
      if (!xf) xf = { c: now.c, p: now.p, from: null, t0: t };
      else if (xf.c !== now.c) xf = { c: now.c, p: now.p, from: { c: xf.c, p: xf.p }, t0: t };
      else xf.p = now.p;
      fades.set(body.id, xf);
    }
    const fk = xf?.from ? Math.max(0, Math.min(1, (t - xf.t0) / CLIP_FADE)) : 1, fe = fk * fk * (3 - 2 * fk);
    const S0 = stance(mx ? actorSkinMix(mx.a, mx.pa, mx.b, mx.pb, mx.k) : fk < 1 ? actorSkinMix(xf.from.c, xf.from.p, now.c, now.p, fe) : plan ? actorSkinMix(plan.a, plan.pa, plan.b, plan.pb, plan.k) : actorSkinAt(clip, ph), o.key, seated ? 0.3 : 1);
    const { O, AX, AY, AZ } = placeOf(L, body);
    // a seat with a back (a sofa's cushions, `back` metres behind the seat spot): however far the clip leans
    // them back, the back of the hips, ribs and skull stay on its face, the whole body brought forward to it
    if (seated && !lying && body.back != null) {
      let worst = 0;
      for (const [b, p] of BACK_PROBES) { const z = at(S0[b], p)[2]; if (-body.back - z > worst) worst = -body.back - z; }
      const fwd = Math.min(0.35, worst);
      for (let r = 0; r < 3; r++) O[r] += AZ[r] * fwd;
    }
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
    // the table in front of them and anything else beside them (onSurfaces)
    const tests = [];
    if (body.table?.h) { const tb = body.table, fl = drop - (body.lift || 0); tests.push((q, cl) => (q[2] < (tb.near ?? 0.15) || q[2] > (tb.far ?? 1) ? null : { dy: fl + tb.h + cl - q[1], edge: q[2] - (tb.near ?? 0.15), thick: tb.thick ?? 0.09 })); }
    for (const sf of body.surfaces || []) tests.push((q, cl) => {
      const sc = piv.map((v, j) => v + hk * (q[j] - v)), w = [0, 1, 2].map((r) => O[r] + AX[r] * sc[0] + AY[r] * (sc[1] - drop) + AZ[r] * sc[2]);
      if (w[0] < sf.u0 || w[0] > sf.u1 || w[2] < sf.v0 || w[2] > sf.v1) return null;
      return { dy: (sf.h + cl - w[1]) / hk, edge: Math.min(w[0] - sf.u0, sf.u1 - w[0], w[2] - sf.v0, sf.v1 - w[2]), thick: sf.thick ?? 0.09 };
    });
    const held = propsOf(o.key.prop || ''), anchors = {}, land = {};
    for (const [L, sd] of [['L', 1], ['R', -1]]) if (held[L] && propUpright(held[L])) anchors[L] = propBind(held[L], sd, handScaleOf(o.key, sd));
    // a slam's hit, from the hand down to the table to the hold
    if (now && /^(sit)?[sS]lam$/.test(now.c)) { const q = ((now.p % 1) + 1) % 1; if (q > 0.42 && q < 0.7) land.R = true; }
    const SP = tests.length ? onSurfaces(S, tests, { L: held.L ? 0.06 : 0.05, R: held.R ? 0.06 : 0.05 }, anchors, land) : Array.from(S);
    // an upright prop's bone: carried from its place on the hand in bind space to where the hand has put it, unturned
    for (const [L, sd] of [['L', 1], ['R', -1]]) {
      if (!held[L] || !propUpright(held[L])) continue;
      const A = propBind(held[L], sd, handScaleOf(o.key, sd)), Hp = at(SP[BN['hand' + L]], A), bi = BN['prop' + L];
      for (let i = SP.length; i <= bi; i++) SP[i] = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      SP[bi] = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Hp[0] - A[0], Hp[1] - A[1], Hp[2] - A[2], 1);
    }
    // each bone's 3×4, bind space into the room: placed (O + AX x + AY (y - drop) + AZ z) after its skin matrix
    const rows = new Float32Array(NBONE * 12);
    for (let b = 0; b < Math.min(NBONE, SP.length); b++) {
      const m0 = SP[b] || S[b], m = hk === 1 ? m0 : m0.map((v, i) => (i === 12 || i === 13 || i === 14 ? hk * v + (1 - hk) * piv[i - 12] : i % 4 === 3 ? v : hk * v));
      for (let r = 0; r < 3; r++) {
        const o4 = b * 12 + r * 4;
        for (let c = 0; c < 4; c++) rows[o4 + c] = AX[r] * m[c * 4] + AY[r] * m[c * 4 + 1] + AZ[r] * m[c * 4 + 2];
        rows[o4 + 3] += O[r] - AY[r] * drop;
      }
    }
    // the cloth's lag: where the hips were a moment ago, eased toward where they are, less where they are
    const hip = [rows[3], rows[7], rows[11]], sp = springs.get(body.id) || { p: hip.slice(), t };
    const ek = 1 - Math.exp(-Math.max(0, Math.min(0.1, t - sp.t)) * 7);
    for (let i = 0; i < 3; i++) sp.p[i] += (hip[i] - sp.p[i]) * ek;
    sp.t = t; springs.set(body.id, sp);
    let sway = [sp.p[0] - hip[0], (sp.p[1] - hip[1]) * 0.3, sp.p[2] - hip[2]];
    const sl = Math.hypot(...sway); if (sl > 0.15) sway = sway.map((v) => (v * 0.15) / sl);
    // the bust's bounce: a damped spring on the chest bone, so a step or a turn sets it moving and it settles
    // a beat later (gl/figure-hd.js jiggle). Only a sculpted body with a bust carries one.
    // the seat's the same off the pelvis, a little stiffer
    const jiggle = o.key.sculpt && (o.key.bust ?? 0) > 0 ? bounceOf(body.id + '|c', rows, FIGURE_BONE.chest, t, JIGGLE) : null;
    const seatJ = o.key.sculpt && (o.key.butt ?? 0) > 0 ? bounceOf(body.id + '|p', rows, FIGURE_BONE.pelvis, t, SEAT_JIGGLE) : null;
    const nip = o.key.sculpt ? bustApex(o.key.bust ?? (o.key.head === 3 ? 0.35 : 0), o.key.weight ?? null) : null;
    out.push({ key: o.key, rows, sway, jiggle, seatJ, nip, floor: O[1], print: o.print, grip: holding(gripOf(plan ? (plan.k > 0.5 ? plan.b : plan.a) : clip), o.key.prop), col: o.col, surf: o.surf, fab: o.fab, mut: o.mut || 0, mutCol: o.mutCol, blink2: o.key.body?.head2 ? blinkOf(t + 1.7, R0) : 0, face: o.face, lip: o.lip, lipstick: o.lipstick, iris: o.iris, faceV: o.faceV, age: o.age, smile: X ? Math.min(1, Math.max(o.smile, X.smile)) : o.smile, trim: o.trim,
      expr: X ? [X.browIn, X.browUp, X.lid, X.frown] : null, sneer: X?.sneer || 0, beardA: o.beardA, beardB: o.beardB,
      mouthA: [Math.min(1, (M?.open ?? cf?.open ?? 0) + (X?.jaw || 0)), M?.wide ?? 0, M?.round ?? cf?.round ?? 0], mouthB: [M?.press ?? 0, M?.teeth ?? 0, M?.tongue ?? 0], blink: o.key.sculpt ? blink : 0, faceUp: faceUpOf(o.key), realEye: o.key.sculpt && o.key.level === 'hd', gaze: eyes, gloves: o.gloves, glove: o.glove, neck: o.neck, slit: o.slit, wild: o.wild, mark: o.mark, markCol: o.markCol, wrapCol: o.wrapCol });
  }
  return out;
}
// Somebody's face as their mood (client/shared/expressions.js) has it, eased per person so a mood comes on rather than
// snaps. `mood` is the server's { m, i, s }: `s` is how many seconds it has left, counted from when it arrived.
const faces = new Map(), moodEnds = new WeakMap();
function moodFace(body, t) {
  let m = body.mood || null;
  if (m && m.s) {
    if (!moodEnds.has(m)) moodEnds.set(m, performance.now() + m.s * 1000);
    if (performance.now() > moodEnds.get(m)) m = null;
  }
  // asleep or out cold, the face lets go whatever the mood
  if (body.rest === 'sleep' || body.rest === 'out' || body.asleep || body.out) m = null;
  const to = expressionOf(m?.m || 'neutral', m ? m.i ?? 0.8 : 0);
  let f = faces.get(body.id);
  if (!f) { f = { ...to, t }; faces.set(body.id, f); return f; }
  easeExpression(f, to, Math.min(0.25, Math.max(0, t - f.t)));
  f.t = t;
  return f;
}
// How each clip holds its hands (gl/figure-hd.js uGrip): [left, right, left index, right index], 0 the hand as
// modelled, 1 a fist, below 0 opened out. Anything not listed hangs loosely relaxed.
const GRIP = { spread: [-0.55, -0.55, 0, 0], holdup: [-0.5, -0.5, 0, 0], clap: [-0.35, -0.35, 0, 0], wave: [0.2, -0.5, 0, 0],
  point: [0.45, 1.05, 0, -1.45], slam: [1.0, 1.05, 0, 0], flex: [1.0, 1.0, 0, 0], cower: [0.8, 0.8, 0, 0], guard: [1.0, 1.0, 0, 0],
  sitCut: [0.3, 0.75, 0, 0], sitLine: [0.45, 0.8, 0, 0], sitSort: [0.2, 0.4, 0, 0.6], sitPill: [0.25, 0.7, 0, 0], sitPack: [0.6, 0.6, 0, 0], sitPipe: [0.7, 0.75, 0, 0],
  sitCook: [0.8, 0.75, 0, 0], sitShake: [0.25, 0.9, 0, 0], sitPour: [0.2, 0.85, 0, 0],
  sitClasp: [0.55, 0.55, 0, 0], sitBarSmoke: [0.15, 0.35, 0, 0], sitRest: [0.25, 0.35, 0, 0], sitBar: [0.15, 0.1, 0, 0], phone: [0.2, 0.75, 0, 0], drink: [0.2, 0.8, 0, 0], smoke: [0.25, 0.45, 0, -0.3],
  // a plate or a bowl on the left palm and a fork in the right; a spoon going round a pan
  eat: [-0.2, 0.8, 0, 0], stir: [0.55, 0.9, 0, 0], squatStir: [0.3, 0.9, 0, 0] };
// a hand with something in it keeps hold of it, whatever the clip says
// (a glass in a full grip; a cigarette between the fingers, so they stay nearly straight)
const holding = (g, prop) => { if (!prop) return g; const h = propsOf(prop), min = (n) => (n === 'cigarette' ? 0.15 : 0.55); return g.map((v, i) => (i < 2 && h[i ? 'R' : 'L'] ? Math.max(v, min(h[i ? 'R' : 'L'])) : i >= 2 && h[i === 3 ? 'R' : 'L'] ? Math.max(v, 0) : v)); };
const gripOf = (clip) => GRIP[clip] || GRIP[String(clip || '').replace(/^sit([A-Z])/, (m, c) => c.toLowerCase())] || [0.22, 0.22, 0, 0];
// Each person's clip and phase as last drawn, and the one it's easing over from (figurePeople), over CLIP_FADE s.
const fades = new Map(), CLIP_FADE = 0.4;
// Each person's cloth lag (figurePeople): the hips' eased position and the clock it was eased at.
// The bust's is about 2.5 Hz and settles in two or three swings; it moves up and down far more than side to
// side or in and out (`axis`), and `max` keeps a jolt to a couple of centimetres of lag, as measured on a walk.
const bounces = new Map(), JIGGLE = { k: 250, c: 9, axis: [0.45, 1, 0.35], max: 0.022 }, SEAT_JIGGLE = { k: 190, c: 7 };
// A damped spring on one bone's position: where the flesh over it thinks the bone is, less where it is, in room
// metres. Underdamped, so a step sets it moving and it settles a beat later.
function bounceOf(key, rows, bone, t, K) {
  const b = bone * 12, at = [rows[b + 3], rows[b + 7], rows[b + 11]], js = bounces.get(key) || { p: at.slice(), v: [0, 0, 0], t };
  let dt = Math.max(0, Math.min(0.05, t - js.t));
  while (dt > 0) { const h = Math.min(dt, 1 / 120); for (let i = 0; i < 3; i++) { js.v[i] += (K.k * (at[i] - js.p[i]) - K.c * js.v[i]) * h; js.p[i] += js.v[i] * h; } dt -= h; }
  js.t = t; bounces.set(key, js);
  const lim = K.max ?? 0.04;
  return [0, 1, 2].map((i) => Math.max(-lim, Math.min(lim, (js.p[i] - at[i]) * (K.axis ? K.axis[i] : 1))));
}
const springs = new Map();
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
  return { O: L.world(body.at[0], body.at[1], (L.baseAt?.(body.at[0], body.at[1]) || 0) + (body.lift || 0)), AX: [Math.cos(yaw), 0, -Math.sin(yaw)], AY: [0, 1, 0], AZ: [Math.sin(yaw), 0, Math.cos(yaw)] };
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
      O = L.world(body.at[0], body.at[1], (L.baseAt?.(body.at[0], body.at[1]) || 0) + (body.lift || 0));
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
