// THE ANGLER: you, sat on the skiff's aft thwart with a rod, for boat fishing's rod mode.
//
// The body is Deadball's ballplayer (gl/ballplayer-mesh.js buildBody), built once in the rig's bind
// pose and skinned here on the CPU into whatever the clips say, because the seat draws it into
// GLASS's solids rather than the ballpark's own skinned pass. The clips are Deadball's too, in its
// schema (content/animation_clips/fish_*.json, baked into diamond/clips.js): the rod is held the
// way a bat is, both hands on it, so the rig puts the hands where the rod is and the rod is the bat's
// knob and direction (rig.js solvePose, J.batKnob and J.batDir).
//
// Pure: no DOM, no GL. boat-view.js owns the animation state (a plain object, below) and decides
// which clip plays when; glass/rod-rig.js poses and draws it. Both load this module lazily, because
// the clip library is two megabytes and only a player in rod mode needs it.
//
// Units are the rig's: feet, x his left, y up from the boat's sole, z his front.

import { CLIPS } from './diamond/clips.js';
import { sampleClip, mixPose, eventTime } from './diamond/anim.js';
import { solvePose, boneFrames, bindFrames, skinRows, BONE } from './diamond/rig.js';
import { createPlayerSet, buildBody, lookOf, hex, SKIN_STRIDE, rigBuildOf } from './gl/ballplayer-mesh.js';
import { MAT } from './gl/ballpark-mesh.js';

export const FT_M = 0.3048;
export const ROD_FT = 7;               // a seven-foot spinning rod, butt to tip
export const HANDLE_FT = 1.25;         // the cork, from the butt
// Where the first-person camera is put on the seated rig: a little up and back from his eye at rest
// (about [0, 3.48, 0.46]), so hands held high in the fight aren't in your face.
export const EYE_FT = Object.freeze([0, 3.62, -0.15]);
// Where the seat's top is in the rig (the sole is y 0), which the chase view keeps unstretched above.
export const SEAT_FT = 1.15;

// The fight is two clips blended by the lean (boatFishState().lean); 'fight' names the pair.
const FIGHT = ['fish_fight_left', 'fish_fight_right'];
export const ANGLER_CLIPS = Object.freeze(['fish_sit', 'fish_cast', 'fish_twitch', 'fish_strike', 'fish_reel', ...FIGHT]);
const clipOf = (id) => CLIPS[id === 'fight' ? FIGHT[0] : id];
export const clipDuration = (id) => clipOf(id)?.duration || 1;
export const clipLoops = (id) => !!clipOf(id)?.loop;
// The cast: the rod is held at the load while the range charges, and the lure goes at the snap.
export const CAST_SNAP_S = eventTime(CLIPS.fish_cast, 'contact') ?? 0.7;
export const CAST_LOAD_S = 0.58;

// ── The animation state ─────────────────────────────────────────────────────────────────────────
// { id, t0, hold, prev: { id, t0, hold } | null, mix0, mixMs, lean }. `t0` is the wall clock (ms)
// the clip started at, `hold` a time (s) to hold it at instead of running on.
export function newAnim(now) { return { id: 'fish_sit', t0: now, hold: null, prev: null, mix0: 0, mixMs: 0, lean: 0 }; }
// Plays `id` from `at` seconds in, mixing over `mixMs` from what was playing.
export function play(A, id, now, { at = 0, mixMs = 220 } = {}) {
  if (!A) return;
  A.prev = { id: A.id, t0: A.t0, hold: A.hold };
  A.mix0 = now; A.mixMs = mixMs;
  A.id = id; A.t0 = now - at * 1000; A.hold = null;
}
export const clipTime = (A, now) => (A.hold != null ? A.hold : (now - A.t0) / 1000);
export function holdAt(A, s, now) { A.hold = s; A.t0 = now - s * 1000; }
export function release(A, now) { if (A.hold != null) { A.t0 = now - A.hold * 1000; A.hold = null; } }

function sampleOne(id, t, lean) {
  if (id === 'fight') {
    const w = Math.max(0, Math.min(1, (1 - (lean || 0)) / 2));   // lean -1 is all left, +1 all right
    const a = sampleClip(CLIPS[FIGHT[0]], t), b = sampleClip(CLIPS[FIGHT[1]], t);
    return mixPose(a, b, 1 - w);
  }
  return sampleClip(clipOf(id), t);
}
/** The pose the state holds now, mixes and the fight's lean done. */
export function anglerPose(A, now) {
  const P = sampleOne(A.id, clipTime(A, now), A.lean);
  if (!A.prev || !(A.mixMs > 0)) return P;
  const w = (now - A.mix0) / A.mixMs;
  if (w >= 1) { A.prev = null; return P; }
  const Q = sampleOne(A.prev.id, A.prev.hold != null ? A.prev.hold : (now - A.prev.t0) / 1000, A.lean);
  const e = w * w * (3 - 2 * w);
  return mixPose(Q, P, e);
}

// ── The body ────────────────────────────────────────────────────────────────────────────────────
// Working clothes rather than the grounds crew's: their green shirt and khaki are what the plain
// branch builds, and they're swapped here for a navy jumper, oilskin trousers and a knit-red cap.
const RECOLOUR = [['#2e4a35', '#283244'], ['#a39169', '#4e5638'], ['#3a2a1a', '#2a2622'], ['#1b2b20', '#5a2219']];
// Hair named as the server names it (server/engine/appearance.js HAIR_COLORS).
const HAIR_HEX = { black: '#141414', 'dark brown': '#2a1c12', brown: '#5b3a1e', auburn: '#73341c', 'dirty blonde': '#8f7448',
  blonde: '#c2a165', red: '#8a3218', grey: '#7d7d7b', white: '#d6d4cf', silver: '#aeb2b6',
  'dyed blue': '#25418c', 'dyed green': '#2d6b34', 'dyed purple': '#5a2d7a', 'dyed red': '#a01e24' };
const SKIN_HEX = ['#e9c2a0', '#d9a77f', '#b77a52', '#8d5a3b', '#5e3a26', '#f0cdb0'];
const enc = (c) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-3;

// The bones the first-person view keeps: your own forearms and hands, and nothing that hangs from
// your head or chest (they'd fill the screen from inside).
const ARM_BONES = new Set([BONE.forearmL, BONE.forearmR, BONE.fistL, BONE.fistR, BONE.handL, BONE.handR]);
// `arm` is 1 and 2 on the left and right forearm, 3 and 4 on the left and right hand, so the seat
// can tell where a hand is and drop that whole arm at once ((arm - 1) % 2 is the side).
const LEFT_BONES = new Set([BONE.forearmL, BONE.fistL, BONE.handL]);
const HAND_BONES = new Set([BONE.fistL, BONE.fistR, BONE.handL, BONE.handR]);

const _bodies = new Map();
/**
 * The skinned body for a look `{ id, skin, hair, hairStyle }` (any can be missing: the id picks the
 * rest, so a player is always the same man). Built once a look and level of detail (0 to 2, as
 * gl/ballplayer-mesh.js PLAYER_LODS), about 40 ms at the coarsest.
 */
export function anglerBody(look = {}, lod = 2) {
  const key = lod + '|' + JSON.stringify(look);
  let B = _bodies.get(key);
  if (B) return B;
  const base = lookOf({ id: String(look.id || 'angler'), role: 'crew', side: 'home', helmet: true });
  if (look.skin) base.skin = /^#/.test(look.skin) ? look.skin : SKIN_HEX[Math.abs(hashS(look.skin)) % SKIN_HEX.length];
  if (look.hair) base.hair = /^#/.test(look.hair) ? look.hair : (HAIR_HEX[String(look.hair).toLowerCase()] || base.hair);
  if (Number.isInteger(look.hairStyle)) base.hairStyle = look.hairStyle;
  base.helmet = true;   // builds the fists that grip, on their own bones; the cap still comes from the plain branch
  const G = createPlayerSet({ skin: true, lod });
  buildBody(G, base);
  const swap = RECOLOUR.map(([a, b]) => [hex(a), hex(b)]);
  const skin = hex(base.skin), hair = hex(base.hair);
  const pos = [], nrm = [], ids = [], ws = [], col = [], arm = [];
  for (const b of G.batches.values()) {
    for (let v = 0; v < b.n; v++) {
      const o = v * SKIN_STRIDE, by = (o + SKIN_STRIDE - 2) * 4;
      const id0 = b.u8[by];
      if (id0 === BONE.bat) continue;   // the bat is the rod's place; glass/rod-rig.js draws the rod
      pos.push(b.data[o], b.data[o + 1], b.data[o + 2]);
      nrm.push(b.data[o + 3], b.data[o + 4], b.data[o + 5]);
      for (let k = 0; k < 4; k++) { ids.push(b.u8[by + k]); ws.push(b.u8[by + 4 + k]); }
      const m = b.data[o + 11];
      let c = [b.data[o + 8], b.data[o + 9], b.data[o + 10]];
      // A head vertex's colour channels carry its face-atlas place, not a colour.
      if (m === MAT.HEAD || m === MAT.EAR || m === MAT.NECK) c = skin;
      else if (m === MAT.HAIR) c = hair;
      else for (const [a, z] of swap) if (near(c, a)) { c = z; break; }
      col.push(enc(c[0]), enc(c[1]), enc(c[2]));
      arm.push(ARM_BONES.has(id0) ? (LEFT_BONES.has(id0) ? 1 : 2) + (HAND_BONES.has(id0) ? 2 : 0) : 0);
    }
  }
  const n = pos.length / 3;
  B = {
    n, tris: Math.floor(n / 3),
    pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), nout: new Float32Array(pos.length), ids: Uint8Array.from(ids), ws: Uint8Array.from(ws), col: Uint8Array.from(col), arm: Uint8Array.from(arm),
    bind: bindFrames(1, rigBuildOf(base)), out: new Float32Array(pos.length), rows: new Float32Array(22 * 12), frames: null,
  };
  _bodies.set(key, B);
  if (_bodies.size > 4) _bodies.delete(_bodies.keys().next().value);
  return B;
}
function hashS(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

/** The solve alone, for a view that draws the rod and not the man (GLASS 1). */
export const solveAngler = (P) => solvePose({ ...P, at: [0, 0, 0], yaw: 0 });

/**
 * Poses the body: `B.out` holds every vertex in the rig's frame after this, and `B.nout` its normal
 * (the ink outline pushes along it; a folded bone's normal is zero). Only the forearms and hands
 * with `armsOnly`. Returns the solve, whose J.batKnob and J.batDir are the rod's butt and its line.
 */
export function skinAngler(B, P, armsOnly = false) {
  const sol = solvePose({ ...P, at: [0, 0, 0], yaw: 0 });
  B.frames = boneFrames(sol, B.frames || undefined);
  const R = skinRows(B.frames, B.bind, B.rows), p = B.pos, out = B.out, ids = B.ids, ws = B.ws, q = B.nrm, nout = B.nout;
  const arm = B.arm;
  for (let v = 0; v < B.n; v++) {
    if (armsOnly && !arm[v]) continue;
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const nx = q[v * 3], ny = q[v * 3 + 1], nz = q[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0, sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = ws[v * 4 + k];
      if (!w) continue;
      const o = ids[v * 4 + k] * 12;
      ox += w * (R[o] * x + R[o + 1] * y + R[o + 2] * z + R[o + 3]);
      oy += w * (R[o + 4] * x + R[o + 5] * y + R[o + 6] * z + R[o + 7]);
      oz += w * (R[o + 8] * x + R[o + 9] * y + R[o + 10] * z + R[o + 11]);
      mx += w * (R[o] * nx + R[o + 1] * ny + R[o + 2] * nz);
      my += w * (R[o + 4] * nx + R[o + 5] * ny + R[o + 6] * nz);
      mz += w * (R[o + 8] * nx + R[o + 9] * ny + R[o + 10] * nz);
      sum += w;
    }
    sum = sum || 1;
    out[v * 3] = ox / sum; out[v * 3 + 1] = oy / sum; out[v * 3 + 2] = oz / sum;
    const ml = Math.hypot(mx, my, mz);
    if (ml > 1e-6) { nout[v * 3] = mx / ml; nout[v * 3 + 1] = my / ml; nout[v * 3 + 2] = mz / ml; }
    else { nout[v * 3] = 0; nout[v * 3 + 1] = 0; nout[v * 3 + 2] = 0; }
  }
  return sol;
}

/**
 * The rod's centre line, butt to tip, as `n + 1` points in the rig's frame. It bends toward `pull`
 * (a direction in the rig's frame, toward the line) by `bend`, 0 a rod at rest to 1 bent hard over:
 * the tip goes furthest, the butt not at all, as a rod loads from the tip down.
 */
export function rodPoints(J, pull, bend = 0, n = 10) {
  const k = J.batKnob, d = J.batDir;
  if (!k || !d) return null;
  const pd = pull[0] * d[0] + pull[1] * d[1] + pull[2] * d[2];
  let q = [pull[0] - d[0] * pd, pull[1] - d[1] * pd, pull[2] - d[2] * pd];
  const ql = Math.hypot(q[0], q[1], q[2]) || 1;
  q = [q[0] / ql, q[1] / ql, q[2] / ql];
  // A rod at rest droops a little under its own tip; under load it comes round to the line.
  const sag = 0.035 + 0.42 * Math.max(0, Math.min(1, bend));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, a = s * ROD_FT, off = sag * ROD_FT * s * s * s;
    // Bent, the rod is shorter along its old line by about what the bend took sideways.
    const along = a - 0.5 * off * off / Math.max(0.5, a || 0.5);
    out.push([k[0] + d[0] * along + q[0] * off, k[1] + d[1] * along + q[1] * off, k[2] + d[2] * along + q[2] * off]);
  }
  return out;
}
