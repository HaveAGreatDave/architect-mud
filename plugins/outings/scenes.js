// plugins/outings/scenes.js
//
// WHAT A PARTY DOES. Once two or more of a night out or a house party are there, the group is always in one
// scene: huddled round talking, dancing, a toast, a drinking game, a sing-song with their arms round each other,
// somebody passed out on the floor with the rest laughing at them, or a couple slipping off into a corner and
// then out of the door together. Each scene lasts a minute or two of real time and the next is rolled by how far
// into the night it is (early, peak, late), so the evening warms up and then falls apart.
//
// ⚠ IT'S THE PICTURE'S STATE. RAM only. The text world hears one line as each scene starts, with a player in the
// room; the Room Stage draws it through `room.npcStage` (sceneStage below), which stands the group together and
// gives each of them their clip (actor3d.js: groove, toastUp, huddle, chug, chant, pointLaugh, canoodle,
// swaySing, and the stock talk, listen, laugh and sprawl). Nothing here moves an NPC between zones, sits them or
// lays them down: an NPC the engine has sat on something is left as the engine says.
//
// The one thing a scene does to the night is the couple's: when it ends they leave together (release()).

import { roomLayout, roomNearFree } from '../../client/shared/room-layout.js';

// how long each lasts, ms of real time, and how often each comes up early, at the peak and late in the night
export const SCENES = {
  huddle:   { ms: [70_000, 130_000], w: [3, 1.5, 1.5], min: 2 },
  dance:    { ms: [60_000, 120_000], w: [1, 3, 1], min: 2 },
  toast:    { ms: [14_000, 20_000], w: [2, 1, 0.5], min: 2 },
  drinking: { ms: [40_000, 70_000], w: [0.3, 2, 1], min: 3 },
  singalong:{ ms: [40_000, 80_000], w: [0, 1.5, 1.5], min: 3 },
  passedOut:{ ms: [70_000, 110_000], w: [0, 0.3, 1.2], min: 3 },
  slipOff:  { ms: [50_000, 80_000], w: [0, 0.7, 1], min: 3 },
};
// a line as each starts, {a} the one it's about (the chugger, the one on the floor, one of the couple), {b} the
// other of the couple, {all} everybody there
const LINES = {
  huddle: ['{all} get their heads together over something.', '{all} stand round in a tight knot, talking over each other.'],
  dance: ['{a} turns the music up, and {all} start dancing.', 'Somebody\'s song comes on. {all} dance to it, badly.'],
  toast: ['{a} raises a drink. "To us." {all} clink.', '{all} hold their drinks up together and drink to nothing in particular.'],
  drinking: ['{a} is downing a drink while the others chant "Down it! Down it!"', 'A drinking game starts. {a} loses the first round and has to finish their drink.'],
  singalong: ['{all} put their arms round each other and sing along, loudly and out of tune.', '{a} starts singing, and the others join in with the bits they know.'],
  passedOut: ['{a} lies down on the floor "for a minute" and is out cold. The others find this very funny.', '{a} has passed out on the floor. Somebody takes a picture.'],
  slipOff: ['{a} and {b} drift off to a corner on their own.', '{a} and {b} are suddenly very interested in each other.'],
};
const END_LINES = {
  passedOut: ['{a} comes round, sits up and asks what they missed.', '{a} gets up off the floor as if nothing happened.'],
  slipOff: ['{a} and {b} slip out together without saying goodbye.', '{a} and {b} leave together. Nobody\'s surprised.'],
};
// what each of them does, by role; a list is rolled through by their place in the group and the clock
const CLIPS = {
  huddle: { all: ['huddle', 'talk', 'huddle', 'laugh', 'listen'] },
  dance: { all: ['groove', 'groove', 'dance'] },
  toast: { all: ['toastUp'] },
  drinking: { a: ['chug'], all: ['chant'] },
  singalong: { all: ['swaySing'] },
  passedOut: { a: ['sprawl'], all: ['pointLaugh', 'laugh', 'pointLaugh'] },
  slipOff: { a: ['canoodle'], all: ['huddle', 'talk', 'listen'] },
};
const SLOT_MS = 9_000;   // how long one of a list's clips plays before the next

const pick = (list, rnd = Math.random) => list[Math.floor(rnd() * list.length)];
const between = ([a, b], rnd = Math.random) => a + Math.floor(rnd() * (b - a));
const stageOf = (o, now) => {
  const k = Math.min(1, Math.max(0, (now - o.startedAt) / Math.max(1, o.endsAt - o.startedAt)));
  return k < 0.25 ? 0 : k < 0.7 ? 1 : 2;
};

// The next scene for the group as it is now: rolled by the time of night, among the ones there are enough of them
// for, and never the one they just did.
export function rollScene(o, now = Date.now(), rnd = Math.random) {
  const there = [...o.arrived];
  const st = stageOf(o, now), last = o.scene?.kind;
  const fits = Object.entries(SCENES).filter(([k, s]) => k !== last && there.length >= s.min && s.w[st] > 0);
  if (!fits.length) return null;
  let roll = rnd() * fits.reduce((x, [, s]) => x + s.w[st], 0), kind = fits[0][0];
  for (const [k, s] of fits) if ((roll -= s.w[st]) <= 0) { kind = k; break; }
  const guests = there.filter((id) => id !== o.caller || o.kind !== 'house');
  const a = pick(guests.length ? guests : there, rnd);
  const b = kind === 'slipOff' ? pick(there.filter((id) => id !== a && (id !== o.caller || o.kind !== 'house')), rnd) : null;
  if (kind === 'slipOff' && !b) return null;
  return { kind, a, b, t0: now, ends: now + between(SCENES[kind].ms, rnd), cast: there, spots: null };
}

const fill = (line, names) => line.replace(/\{(\w+)\}/g, (_, k) => names[k] || '');

// Called each time one of the group is driven while they're all there. Starts the first scene, ends one that's
// run its time and starts the next. `names(ids)` is "A, B and C"; `nameOf(id)`; `say(line)` to the room;
// `changed()` tells the Stage; `leave(ids)` lets the couple go. Returns the scene in hand.
export function sceneTick(o, now, { names, nameOf, say, changed, leave }) {
  if (o.arrived.size < 2) { if (o.scene) { o.scene = null; changed(); } return null; }
  const s = o.scene;
  // somebody new came in or somebody left: the same scene, laid out again with them in it
  if (s && now < s.ends && (s.cast.length !== o.arrived.size || s.cast.some((id) => !o.arrived.has(id)))) {
    if ((s.a && !o.arrived.has(s.a)) || (s.b && !o.arrived.has(s.b))) s.ends = now;
    else { s.cast = [...o.arrived]; s.spots = null; changed(); }
  }
  if (s && now < s.ends) return s;
  if (s) {
    const end = END_LINES[s.kind];
    if (end) say(fill(pick(end), { a: nameOf(s.a), b: nameOf(s.b) }));
    if (s.kind === 'slipOff') { o.scene = null; leave([s.a, s.b]); if (o.arrived.size < 2) { changed(); return null; } }
  }
  const next = rollScene(o, now);
  o.scene = next;
  if (next) say(fill(pick(LINES[next.kind]), { a: nameOf(next.a), b: nameOf(next.b), all: names(next.cast) }));
  changed();
  return next;
}

// ── Where they stand ─────────────────────────────────────────────────────────
// A free spot on the open floor near the middle of the room, and a ring of spots round it, one each, everybody
// facing the middle. The couple go to a corner; the one passed out is laid at the ring's edge with the rest
// stood over them; a sing-song is a line shoulder to shoulder.
function layout(s, L) {
  const [u0, u1, v0, v1] = L.bounds, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const mid = roomNearFree(L, cu + (Math.random() - 0.5) * (u1 - u0) * 0.3, cv + (Math.random() - 0.5) * (v1 - v0) * 0.3, 2.5, L.bounds) || [cu, cv];
  const spots = new Map(), taken = [];
  const free = (u, v) => {
    for (let r = 0; r <= 0.9; r += 0.15) for (let i = 0; i < 8; i++) {
      const a = i / 8 * 2 * Math.PI, q = roomNearFree(L, u + Math.cos(a) * r, v + Math.sin(a) * r, 0.3, L.bounds);
      if (q && taken.every((t) => Math.hypot(t[0] - q[0], t[1] - q[1]) >= 0.5)) { taken.push(q); return q; }
    }
    return null;
  };
  const face = (from, to) => { const du = to[0] - from[0], dv = to[1] - from[1], m = Math.hypot(du, dv) || 1; return [+(du / m).toFixed(3), +(dv / m).toFixed(3)]; };
  const put = (id, q, f) => { if (q) spots.set(id, { at: q.map((x) => +x.toFixed(2)), face: f }); };
  let ring = s.cast;
  if (s.kind === 'slipOff') {
    // the corner furthest from the middle that's free
    const corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].sort((p, q) => Math.hypot(q[0] - mid[0], q[1] - mid[1]) - Math.hypot(p[0] - mid[0], p[1] - mid[1]));
    for (const [cu2, cv2] of corners) {
      const qa = free(cu2 + Math.sign(mid[0] - cu2) * 0.3, cv2 + Math.sign(mid[1] - cv2) * 0.3);
      if (!qa) continue;
      const qb = free(qa[0] + Math.sign(mid[0] - qa[0]) * 0.45, qa[1]) || free(qa[0], qa[1] + Math.sign(mid[1] - qa[1]) * 0.45);
      if (qb) { put(s.a, qa, face(qa, qb)); put(s.b, qb, face(qb, qa)); break; }
      taken.pop();
    }
    ring = ring.filter((id) => id !== s.a && id !== s.b);
  }
  if (s.kind === 'singalong') {
    // shoulder to shoulder across the room, everybody facing the same way: towards the middle of the far wall
    const n = ring.length, out = [mid[0], v1];
    ring.forEach((id, i) => { const q = free(mid[0] + (i - (n - 1) / 2) * 0.55, mid[1]); put(id, q, q ? face(q, out) : [0, 1]); });
    return spots;
  }
  const r = s.kind === 'dance' ? Math.max(0.6, 0.26 * ring.length) : s.kind === 'toast' || s.kind === 'huddle' ? Math.max(0.45, 0.18 * ring.length) : Math.max(0.55, 0.22 * ring.length);
  const a0 = Math.random() * 2 * Math.PI;
  let centre = mid;
  if (s.kind === 'passedOut') {
    // laid on the floor at the middle, and everybody else round them a little further off
    const q = free(mid[0], mid[1]);
    if (q) { put(s.a, q, [1, 0]); centre = q; }
    ring = ring.filter((id) => id !== s.a);
  }
  ring.forEach((id, i) => {
    const a = a0 + i / ring.length * 2 * Math.PI, rr = s.kind === 'passedOut' ? r + 0.5 : r;
    const q = free(centre[0] + Math.cos(a) * rr, centre[1] + Math.sin(a) * rr);
    put(id, q, q ? face(q, centre) : [0, 1]);
  });
  return spots;
}

// The clip for one of them now: their role's list, rolled through by their place in the group and the clock so
// they don't all change at once.
export function clipFor(s, id, now = Date.now()) {
  const c = CLIPS[s.kind];
  const list = (id === s.a || id === s.b) && c.a ? c.a : c.all;
  const i = Math.max(0, s.cast.indexOf(id));
  return list[(Math.floor((now - s.t0) / SLOT_MS) + i) % list.length];
}

// `room.npcStage` for a member of a party in its room: where they stand and what they're doing. Null when it isn't
// ours to say (not at a party here, nothing going on, sat down by the engine, no room to lay it out in).
export function sceneStage(o, n, zoneId, pieces, spec, now = Date.now()) {
  const s = o?.scene;
  if (!s || zoneId !== o.venue || !o.arrived.has(n.id) || !s.cast.includes(n.id)) return null;
  if (n.onFurniture || n.sittingOn || (n.posture && n.posture !== 'standing')) return null;
  const clip = clipFor(s, n.id, now);
  if (!spec) return { clip };
  if (!s.spots) { try { s.spots = layout(s, roomLayout(spec, pieces || [])); } catch { s.spots = new Map(); } }
  const at = s.spots.get(n.id);
  return at ? { posture: 'standing', on: null, at: at.at, face: at.face, clip } : { clip };
}
