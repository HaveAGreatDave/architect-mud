// DEADBALL · THE CLIP FILE. What one file under content/animation_clips/ may hold, and how it's
// written out.
//
// A clip is a run of poses in the rig's pose language (diamond/rig.js) at times, with its events
// and its plants:
//
//   { id, role, duration, loop?, note?,
//     keys:   [{ t, tension?, pose }],        t from 0 to the duration, in order; tension as in
//                                             diamond/anim.js (below 0 the motion goes through
//                                             the key faster, at 1 it stops there)
//     events: [{ t, kind, ... }],             what the director waits on (CLIP_EVENTS)
//     plants: [{ foot, from, to }] }          when a foot is held on the ground
//
// Clips are keyed for a right-hander: a left-hander does them in a mirror (diamond/anim.js
// sampleClip). A pitcher's are keyed as he stands on the rubber, side-on with +x toward the plate;
// everyone else's facing the way he faces, +z. A loop's last key is its first again.
//
// Three callers check a clip with `validateClip`: the bake (scripts/shapes/bake-clips.mjs), the
// gate (scripts/shapes/anim-smoke.mjs) and the Pose Lab before it saves. Each key has to be a pose
// a body can make (diamond/anim.js JOINT_LIMITS); what happens between the keys is the gate's.
//
// Pure: no DOM, no Node.

import { solvePose } from './rig.js';
import { completePose, limitBreaks, FEET, DIRS } from './anim.js';

export const CLIP_ROLES = Object.freeze(['pitcher', 'batter', 'catcher', 'ump', 'fielder', 'runner', 'coach', 'any']);
// An event's kind and what else it carries: the hand that lets go of or takes the ball, the way a
// throw goes (in the pose's frame), the umpire's call, the foot that lands; a `hit` is the pitch
// striking the batter, and a `contact` the bat meeting the ball. A catch says which way the ball
// comes from, `from` (a direction in the pose's frame; [0, 0, 1], straight at him, if it doesn't
// say), and may say where its glove can take it, `reach: { x: [lo, hi], y: [lo, hi], follow }`: a
// box standing across the ball's line through the glove at the catch, x along the catcher's left
// as he faces the ball (from the pose frame's origin) and y up from the ground, in feet, and how
// far the body may follow it (diamond/anim.js reach). The gate holds the clip to it, and the
// director sends a ball outside it to another clip.
export const CLIP_EVENTS = Object.freeze({
  release: Object.freeze(['hand', 'dir']),
  contact: Object.freeze([]),
  catch: Object.freeze(['hand', 'from', 'reach']),
  call: Object.freeze(['call']),
  step: Object.freeze(['foot']),
  hit: Object.freeze([]),
});
// The umpire's calls: `dead` is a dead ball, as when a pitch hits the batter.
export const CALLS = Object.freeze(['strike', 'ball', 'out', 'safe', 'foul', 'dead']);
export const MAX_DURATION = 20;
export const MAX_KEYS = 64;
// Most a direction may turn from one key to the next. Directions are mixed by their parts, so one
// that turns right round passes through nothing on the way.
export const MAX_TURN = 150;

// The pose language's fields, in the order a clip file writes them, a line a group.
const POSE_LINES = [
  ['pelvis', 'pitch', 'twist', 'roll', 'spine', 'chest', 'neck', 'head'],
  ['ankL', 'plantL', 'toeL', 'kneeL', 'ankR', 'plantR', 'toeR', 'kneeR'],
  ['wrL', 'elbL', 'handL', 'palmL'],
  ['wrR', 'elbR', 'handR', 'palmR'],
  ['bat'],
];
export const POSE_FIELDS = Object.freeze(POSE_LINES.flat());

export const clipFileName = (id) => id + '.json';
const ID_RE = /^[a-z][a-z0-9_]*$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const nonZero = (v) => Math.hypot(...v) > 1e-6;
const canon = (v) => (Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v));
const turn = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))) * 180 / Math.PI;

// What's wrong with one pose, as words; `where` says which key.
function poseErrors(P, where) {
  const out = [];
  if (!P || typeof P !== 'object' || Array.isArray(P)) return [`${where}: a pose is an object`];
  for (const k of Object.keys(P)) if (!POSE_FIELDS.includes(k)) out.push(`${where}: '${k}' isn't in the pose language`);
  if (!isVec(P.pelvis, 3)) out.push(`${where}: pelvis is three numbers`);
  for (const k of ['pitch', 'twist', 'roll']) if (k in P && !isNum(P[k])) out.push(`${where}: ${k} is a number of degrees`);
  for (const k of ['spine', 'chest', 'neck', 'head']) if (k in P && !isVec(P[k], 3)) out.push(`${where}: ${k} is three numbers of degrees`);
  for (const S of FEET) {
    const a = P['ank' + S];
    if (!isVec(a, 2) && !isVec(a, 3)) out.push(`${where}: ank${S} is [x, z] on the ground or [x, y, z]`);
    if ('plant' + S in P && typeof P['plant' + S] !== 'boolean') out.push(`${where}: plant${S} is true or false`);
    if (!P.bat && !isVec(P['wr' + S], 3)) out.push(`${where}: wr${S} is three numbers (only a bat in the hands decides the wrists)`);
    else if ('wr' + S in P && !isVec(P['wr' + S], 3)) out.push(`${where}: wr${S} is three numbers`);
  }
  for (const k of DIRS) if (k in P && !(isVec(P[k], 3) && nonZero(P[k]))) out.push(`${where}: ${k} is a direction, three numbers not all 0`);
  if ('bat' in P) {
    const b = P.bat;
    if (!b || typeof b !== 'object') out.push(`${where}: bat is { knob, dir, bottom }`);
    else {
      if (!isVec(b.knob, 3)) out.push(`${where}: bat.knob is three numbers`);
      if (!(isVec(b.dir, 3) && nonZero(b.dir))) out.push(`${where}: bat.dir is a direction`);
      if ('bottom' in b && b.bottom !== 'L' && b.bottom !== 'R') out.push(`${where}: bat.bottom is 'L' or 'R'`);
      for (const k of Object.keys(b)) if (!['knob', 'dir', 'bottom'].includes(k)) out.push(`${where}: bat.${k} isn't part of a bat`);
    }
  }
  return out;
}

// { errors, warnings } for a clip file's contents. `file` names it in the messages and, when
// given, has to be the clip's own file name.
export function validateClip(doc, file = '<clip>') {
  const errors = [], warnings = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { err('a clip is an object'); return { errors, warnings }; }
  for (const k of Object.keys(doc)) if (!['id', 'role', 'duration', 'loop', 'note', 'keys', 'events', 'plants'].includes(k)) err(`'${k}' isn't part of a clip`);
  if (typeof doc.id !== 'string' || !ID_RE.test(doc.id)) err('id is lower case letters, digits and underscores, starting with a letter');
  else if (file !== '<clip>' && file !== clipFileName(doc.id)) err(`a clip called ${doc.id} lives in ${clipFileName(doc.id)}`);
  if (!CLIP_ROLES.includes(doc.role)) err(`role is one of ${CLIP_ROLES.join(', ')}`);
  if (!isNum(doc.duration) || doc.duration <= 0 || doc.duration > MAX_DURATION) err(`duration is seconds, more than 0 and at most ${MAX_DURATION}`);
  if ('loop' in doc && typeof doc.loop !== 'boolean') err('loop is true or false');
  if ('note' in doc && typeof doc.note !== 'string') err('note is words');
  const keys = doc.keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > MAX_KEYS) { err(`keys is a list of 1 to ${MAX_KEYS} { t, pose }`); return { errors, warnings }; }
  if (errors.length) return { errors, warnings };
  const D = doc.duration;
  let prevT = -Infinity, shapeOk = true;
  keys.forEach((k, i) => {
    if (!k || typeof k !== 'object' || !isNum(k.t)) { err(`key ${i}: t is seconds`); shapeOk = false; return; }
    if (k.t <= prevT) err(`key ${i} at ${k.t} s comes before the key ahead of it`);
    prevT = k.t;
    for (const x of Object.keys(k)) if (x !== 't' && x !== 'pose' && x !== 'tension') err(`key ${i}: '${x}' isn't part of a key`);
    if ('tension' in k && !(isNum(k.tension) && k.tension >= -1 && k.tension <= 1)) err(`key ${i}: tension is a number from -1 (through the key fast) to 1 (stopping at it)`);
    const pe = poseErrors(k.pose, `key ${i} at ${k.t} s`);
    if (pe.length) { shapeOk = false; for (const m of pe) err(m); }
  });
  if (keys[0].t !== 0) err('the first key is at 0 s');
  if (keys.length > 1 && keys[keys.length - 1].t !== D) err(`the last key is at the duration, ${D} s`);
  if (doc.loop && keys.length < 3) err('a loop has at least three keys, its last the same as its first');
  // what happens and when
  const events = doc.events === undefined ? [] : doc.events;
  if (!Array.isArray(events)) err('events is a list');
  else events.forEach((e, i) => {
    const where = `event ${i}`;
    if (!e || typeof e !== 'object') { err(`${where} is { t, kind, ... }`); return; }
    if (!isNum(e.t) || e.t < 0 || e.t > D) err(`${where}: t is within the clip, 0 to ${D} s`);
    const want = CLIP_EVENTS[e.kind];
    if (!want) { err(`${where}: kind is one of ${Object.keys(CLIP_EVENTS).join(', ')}`); return; }
    for (const x of Object.keys(e)) if (x !== 't' && x !== 'kind' && !want.includes(x)) err(`${where}: a ${e.kind} doesn't carry '${x}'`);
    if (want.includes('hand') && e.hand !== 'L' && e.hand !== 'R') err(`${where}: a ${e.kind} names its hand, 'L' or 'R'`);
    if (want.includes('foot') && e.foot !== 'L' && e.foot !== 'R') err(`${where}: a ${e.kind} names its foot, 'L' or 'R'`);
    if (want.includes('dir') && !(isVec(e.dir, 3) && nonZero(e.dir))) err(`${where}: a ${e.kind} says which way the ball goes, a direction in the pose's frame`);
    if ('from' in e && !(isVec(e.from, 3) && Math.hypot(e.from[0], e.from[2]) > 1e-6)) err(`${where}: from is the way the ball comes, a direction in the pose's frame with some of it along the ground`);
    if (want.includes('call') && !CALLS.includes(e.call)) err(`${where}: a call is one of ${CALLS.join(', ')}`);
    if ('reach' in e) {
      const r = e.reach, span = (v) => isVec(v, 2) && v[0] < v[1];
      if (!r || typeof r !== 'object' || !span(r.x) || !span(r.y) || !(isNum(r.follow) && r.follow >= 0 && r.follow <= 2) || Object.keys(r).some((k) => !['x', 'y', 'follow'].includes(k))) {
        err(`${where}: reach is { x: [lo, hi], y: [lo, hi], follow }, follow 0 to 2 ft`);
      }
    }
  });
  const plants = doc.plants === undefined ? [] : doc.plants;
  if (!Array.isArray(plants)) err('plants is a list');
  else {
    plants.forEach((p, i) => {
      if (!p || typeof p !== 'object' || (p.foot !== 'L' && p.foot !== 'R') || !isNum(p.from) || !isNum(p.to)) { err(`plant ${i} is { foot: 'L' or 'R', from, to }`); return; }
      for (const x of Object.keys(p)) if (!['foot', 'from', 'to'].includes(x)) err(`plant ${i}: '${x}' isn't part of a plant`);
      if (!(p.from >= 0 && p.to <= D && p.from < p.to)) err(`plant ${i}: from comes before to, both within 0 to ${D} s`);
    });
    for (const S of FEET) {
      const mine = plants.filter((p) => p && p.foot === S && isNum(p.from)).sort((a, b) => a.from - b.from);
      for (let i = 1; i < mine.length; i++) if (mine[i].from <= mine[i - 1].to) err(`foot ${S} is planted twice at once, ${mine[i - 1].from} to ${mine[i - 1].to} and from ${mine[i].from}`);
    }
  }
  if (!shapeOk) return { errors, warnings };
  // a foot keyed on the ground with no plant holding it slides along the curve to the next key
  if (Array.isArray(plants)) keys.forEach((k, i) => {
    for (const S of FEET) {
      if (k.pose['ank' + S].length !== 2 || k.pose['plant' + S] === false) continue;
      if (!plants.some((p) => p && p.foot === S && k.t >= p.from - 1e-9 && k.t <= p.to + 1e-9)) warnings.push(`${file}: key ${i} at ${k.t} s has foot ${S} on the ground, but no plant holds it there`);
    }
  });
  // every key a pose a body can make, and nothing turning right round between two keys
  const done = keys.map((k) => completePose(k.pose));
  done.forEach((P, i) => {
    for (const m of limitBreaks(P, solvePose({ ...P, at: [0, 0, 0], yaw: 0 }))) err(`key ${i} at ${keys[i].t} s: ${m}`);
    if (i) {
      for (const k of DIRS) { const a = turn(done[i - 1][k], P[k]); if (a > MAX_TURN) err(`key ${i} at ${keys[i].t} s: ${k} turns ${a.toFixed(0)}° from the key before (most ${MAX_TURN})`); }
      // an angle is mixed as a number, so a turn of more than half round is the long way round:
      // -80 to 180 spins him 260 degrees, where -80 to -180 turns him 100
      for (const k of ['pitch', 'twist', 'roll']) { const a = Math.abs(P[k] - done[i - 1][k]); if (a > 180) err(`key ${i} at ${keys[i].t} s: ${k} goes ${a.toFixed(0)}° from the key before, the long way round (most 180; key a turn between)`); }
      const A = done[i - 1].bat, B = P.bat;
      if (A && B) {
        if (A.bottom !== B.bottom) err(`key ${i} at ${keys[i].t} s: the bottom hand on the bat changes from the key before`);
        const a = turn(A.dir, B.dir);
        if (a > MAX_TURN) err(`key ${i} at ${keys[i].t} s: the bat turns ${a.toFixed(0)}° from the key before (most ${MAX_TURN})`);
      }
    }
  });
  if (doc.loop && keys.length >= 3 && canon(done[0]) !== canon(done[done.length - 1])) err('a loop\'s last key is the same pose as its first');
  return { errors, warnings };
}

// ── writing a clip out ─────────────────────────────────────────────────────────
// A clip file is JSON, laid out to be read and diffed: the clip's own fields first, then each key
// with its pose a line a group (the torso, the legs, each arm, the bat).
const num = (v) => (Object.is(v, -0) ? '0' : JSON.stringify(v));
function lit(v) {
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.keys(v).map((k) => JSON.stringify(k) + ': ' + lit(v[k])).join(', ') + ' }';
  return JSON.stringify(v);
}
function poseText(P, pad) {
  const lines = [];
  for (const group of POSE_LINES) {
    const items = group.filter((k) => k in P).map((k) => JSON.stringify(k) + ': ' + lit(k === 'bat' ? { knob: P.bat.knob, dir: P.bat.dir, ...(P.bat.bottom ? { bottom: P.bat.bottom } : {}) } : P[k]));
    if (items.length) lines.push(items.join(', '));
  }
  const rest = Object.keys(P).filter((k) => !POSE_FIELDS.includes(k)).sort();
  if (rest.length) lines.push(rest.map((k) => JSON.stringify(k) + ': ' + lit(P[k])).join(', '));
  return '{\n' + lines.map((l) => pad + '  ' + l).join(',\n') + '\n' + pad + '}';
}
export function formatClip(doc) {
  const head = ['id', 'role', 'duration', 'loop', 'note'].filter((k) => k in doc).map((k) => `  ${JSON.stringify(k)}: ${lit(doc[k])}`);
  const list = (xs) => (xs.length ? '[\n' + xs.map((x) => '    ' + lit(x)).join(',\n') + '\n  ]' : '[]');
  if ('events' in doc) head.push(`  "events": ${list(doc.events)}`);
  if ('plants' in doc) head.push(`  "plants": ${list(doc.plants)}`);
  const keys = doc.keys.map((k) => `    {\n      "t": ${num(k.t)},\n${'tension' in k ? `      "tension": ${num(k.tension)},\n` : ''}      "pose": ${poseText(k.pose, '      ')}\n    }`);
  head.push(`  "keys": [\n${keys.join(',\n')}\n  ]`);
  const rest = Object.keys(doc).filter((k) => !['id', 'role', 'duration', 'loop', 'note', 'events', 'plants', 'keys'].includes(k)).sort();
  for (const k of rest) head.push(`  ${JSON.stringify(k)}: ${lit(doc[k])}`);
  return '{\n' + head.join(',\n') + '\n}\n';
}
