// ONE WORLD · A ROOM'S PEOPLE (docs/proposals/one-world-interiors.md, phase C). Walking a building's rooms in GLASS, the
// people in the room you're in are stood where the Room Stage would stand them and handed to the street's figure
// (windshield.js drawRoomPeople), dressed by the same token as on the street (client/shared/person-token.js).
//
// Where somebody is, from what the server sent on `room_view` and `room_people` (plugins/roomstage peopleIn): on a
// seat of the piece they sit or lie on, at the post the server gave them (`at`, `face`, `lift`), or on clear floor
// (room-layout.js crowdSpot), the cases room-stage.js placeOf takes, less its walks in and out and the counter lines.
// Pure but for the spots it keeps, so nobody shuffles when somebody comes in.
// Walking in and out (`came` and `gone` on `room_people`) is noteMoves: from the doorway to their spot, or their spot
// to the doorway, at the Stage's pace (room-stage.js noteMoves, MOVE_SPEED) on the street body's walk.
// ⚠ LYING ISN'T DRAWN YET: the street's body has no lying clip, and somebody stood up in a bed is worse than nobody.
import { crowdSpot, crowdSeed, lineSpots, linePoints, roomYaw, seatsClash, roomPath, roomNearFree, pathAt, pathLength, openingInside } from '../../../shared/room-layout.js';
import { token } from '../../../shared/person-token.js';
import { playerFigure } from '../../../shared/player-figure.js';

// layout -> { spots: Map id -> { at, yaw }, lines: [{ spots, ids }] }, held while they're in the room
const spotsOf = new WeakMap();
// the Stage's own seed (room-layout.js crowdSeed), so somebody stands on the same spot in GLASS as on the Stage
const seedOf = (id) => crowdSeed(id);
// about half the NPCs in a room with a counter to queue at join its line, up to LINE_MAX (room-stage.js crowdPlace)
const LINE_SHARE = 0.5, LINE_MAX = 5;

// Where each person in a room stands: [{ p, at: [u, v], yaw, pose: 'stand' | 'sit' | 'lie', lift }] in the room's frame.
// `you` is left out (you're the camera), and so is anybody in the en-suite.
export function placePeople(L, people, you = null) {
  if (!L) return [];
  const out = [], used = [], here = (people || []).filter((p) => p && p.id !== you && !p.annex && !p._gone);
  let C = spotsOf.get(L);
  if (!C) spotsOf.set(L, (C = { spots: new Map(), lines: linePoints(L).map((q) => ({ spots: lineSpots(L, q, LINE_MAX), ids: [] })).filter((ln) => ln.spots.length) }));
  const spots = C.spots, ids = new Set(here.map((p) => p.id));
  for (const id of [...spots.keys()]) if (!ids.has(id)) spots.delete(id);
  for (const ln of C.lines) ln.ids = ln.ids.filter((id) => ids.has(id));
  const rest = [];
  for (const p of here) {
    if ((p.posture === 'sitting' || p.posture === 'lying') && p.on) {
      const lie = p.posture === 'lying', mine = (L.seats || []).filter((s) => String(s.piece) === String(p.on) && !!s.lie === lie);
      const pick = (Number.isInteger(p.seat) && L.seats[p.seat]?.piece === p.on && L.seats[p.seat]) || mine.find((s) => !used.some((o) => seatsClash(o, s))) || mine[0];
      if (pick) { used.push(pick); out.push({ p, at: [pick.u, pick.v], yaw: pick.yaw || 0, pose: pick.lie ? 'lie' : 'sit', lift: (!pick.lie && pick.lift) || 0, seat: pick }); continue; }
    }
    if (p.at) { out.push({ p, at: p.at, yaw: p.face ? roomYaw(L, p.face[0], p.face[1]) : p.yaw || 0, pose: 'stand', lift: p.lift || 0 }); continue; }
    rest.push(p);
  }
  // nobody's said where: in line at a counter (the line moves up as the front leaves), or a spot on clear floor
  for (const p of rest) {
    let inLine = null;
    for (const ln of C.lines) { const k = ln.ids.indexOf(p.id); if (k >= 0) inLine = ln.spots[k]; }
    if (!inLine && p.npc && !spots.has(p.id) && C.lines.length && (seedOf(p.id) & 0xffff) / 0x10000 < LINE_SHARE) {
      const ln = C.lines.reduce((a, b) => (b.ids.length < a.ids.length ? b : a));
      if (ln.ids.length < ln.spots.length) { ln.ids.push(p.id); inLine = ln.spots[ln.ids.length - 1]; }
    }
    if (inLine) { out.push({ p, at: [...inLine.at], yaw: inLine.yaw, pose: 'stand', lift: 0 }); continue; }
    let s = spots.get(p.id);
    if (!s) {
      // (a line keeps the place behind its last one free, so the next to join isn't stood in somebody)
      const taken = [...out.map((q) => q.at), ...[...spots.values()].map((q) => q.at), ...C.lines.flatMap((ln) => ln.spots.slice(0, ln.ids.length + 1).map((q) => q.at))];
      const at = crowdSpot(L, taken, seedOf(p.id));
      if (!at) continue;
      const [u0, u1, v0, v1] = L.bounds, turn = ((seedOf(p.id) >>> 16) / 0x10000 - 0.5) * 2.2;
      s = { at, yaw: roomYaw(L, (u0 + u1) / 2 - at[0], (v0 + v1) / 2 - at[1]) + turn };
      spots.set(p.id, s);
    }
    out.push({ p, at: s.at, yaw: s.yaw, pose: 'stand', lift: 0 });
  }
  return out;
}

const roomPt = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
// The clip the street's body plays for somebody placed: sat, its sit; stood, a clip the server gave them where the body
// has it (`p.clip`, eating and the like map to sitting), else idle.
const STREET_CLIPS = new Set(['idle', 'talk', 'listen', 'wait', 'phone', 'smoke', 'sit', 'cheer', 'leanSmoke', 'leanWall', 'wave']);
const clipOf = (q) => (q.pose === 'sit' ? 'sit' : STREET_CLIPS.has(q.p.clip) ? q.p.clip : q.p.manner === 'talk' ? 'talk' : 'idle');

// ── WALKING IN AND OUT (room-stage.js noteMoves) ──
const MOVE_SPEED = 1.3, PAST = 1.0;
// the way through to zone `to`: just inside it, and a step out past it (none for a stair)
function wayTo(L, to) {
  const o = (L.spec?.openings || []).find((x) => x.to === to);
  if (!o) return null;
  const inside = openingInside(L, o).at;
  if (o.kind === 'stair') return { inside, outside: null };
  const n = o.wall === 'front' ? [0, -1] : o.wall === 'back' ? [0, 1] : o.wall === 'left' ? [-1, 0] : [1, 0];
  return { inside, outside: [inside[0] + n[0] * PAST, inside[1] + n[1] * PAST] };
}
// never a straight line through a wall: no way round, and there's no walk (they just go, or are just there)
function safePath(L, a, b) {
  const q = roomPath(L, a, b);
  if (q) return q;
  const a2 = roomNearFree(L, a[0], a[1], 1.2), b2 = roomNearFree(L, b[0], b[1], 1.2);
  return a2 && b2 ? roomPath(L, a2, b2) : null;
}
const walkOf = (path, now) => { const len = pathLength(path); return { path, len, ms: Math.max(500, len / MOVE_SPEED * 1000), t0: now }; };
// `walks` is the caller's Map, kept with the room: id -> { out, p, path, len, ms, t0 }. `before` is who was in the room.
export function noteMoves(walks, L, msg, before, people, you, now) {
  if (!L) return;
  const was = placePeople(L, before, you), nowAt = placePeople(L, people, you);
  for (const g of msg.gone || []) {
    if (g.id === you || people.some((q) => q.id === g.id)) continue;
    const from = was.find((q) => q.p.id === g.id), w = from && wayTo(L, g.to), path = w && safePath(L, from.at, w.inside);
    if (!path) continue;
    if (w.outside) path.push(w.outside);
    walks.set(g.id, { out: true, p: { ...from.p, posture: 'standing', on: null }, ...walkOf(path, now) });
  }
  for (const c of msg.came || []) {
    if (c.id === you || before.some((q) => q.id === c.id)) continue;
    const end = nowAt.find((q) => q.p.id === c.id), w = end && wayTo(L, c.from);
    if (!w || end.pose !== 'stand') continue;
    const inPath = safePath(L, w.inside, end.at);
    if (!inPath) continue;
    walks.set(c.id, { out: false, p: end.p, ...walkOf([...(w.outside ? [w.outside] : []), ...inPath], now) });
  }
  for (const [id, q] of walks) if (q.out && people.some((x) => x.id === id)) walks.delete(id);   // back before they were through
}
// A route the server gave somebody crossing the room (`route`: { path, ms }, plugins/roomstage/npc-life.js), timed
// from when it came and no faster than a brisk walk, as room-stage.js noteRoutes has it. Returns id -> route.
const WALK_MAX = 1.6;   // metres a second, room-stage.js's
export function routesOf(people, now) {
  const out = new Map();
  for (const p of people || []) if (p.route?.path?.length > 1) {
    const len = pathLength(p.route.path);
    out.set(p.id, { path: p.route.path, len, ms: Math.max(p.route.ms || 0, len / WALK_MAX * 1000), t0: now });
  }
  return out;
}
// Whether anybody's still walking, so the caller works the records out again each frame until they've stopped.
export const walking = (walks, now) => [...walks.values()].some((q) => now - q.t0 < q.ms);

// The room's people as the street's figure takes them: { t, x, y, z, hd, clip, ph, s, g } in absolute tiles, `hd` the
// way they face as atan2 of the tile step (windshield.js streetActorPose's sense). `room` is a room-interiors.js entry.
export function roomPeopleRecords(room, people, you = null, walks = null, now = 0, routes = null) {
  if (!room?.L || !room.M) return [];
  const L = room.L, out = [];
  // whoever's walking in or out is where their walk has them, on the walk clip, facing along it
  const moving = new Map();
  if (walks) for (const [id, w] of walks) {
    const k = Math.min(1, (now - w.t0) / w.ms);
    if (k >= 1) { walks.delete(id); continue; }
    const at = pathAt(w.path, k * w.len);
    moving.set(id, { p: w.p, at: at.at, yaw: roomYaw(L, at.du, at.dv), pose: 'stand', lift: 0, walk: true, gone: k * w.len });
  }
  // and whoever's on a route is along it, and stood at its end once they're there, till the server says what they did
  if (routes) for (const [id, r] of routes) {
    const who = (people || []).find((x) => x.id === id);
    if (!who || moving.has(id) || id === you || who.annex) continue;
    const k = Math.min(1, (now - r.t0) / r.ms), at = pathAt(r.path, k * r.len);
    moving.set(id, { p: who, at: at.at, yaw: roomYaw(L, at.du, at.dv), pose: 'stand', lift: 0, walk: k < 1, gone: k * r.len });
  }
  const placed = placePeople(L, people, you).filter((q) => !moving.has(q.p.id));
  for (const q of [...placed, ...moving.values()]) {
    if (q.pose === 'lie') continue;
    // somebody drawn close up even standing (flags.figure.closeup: the In Between's attendant) is closeupBodies'
    if ((q.p.figure?.closeup || closeupAlso.has(q.p.id)) && !q.walk) continue;
    const g0 = L.groundAt ? L.groundAt(q.at[0], q.at[1]) || 0 : 0;
    const W = L.world(q.at[0], q.at[1], g0 + (q.lift || 0)), P = roomPt(room.M, W);
    const Q = roomPt(room.M, [W[0] + Math.sin(q.yaw), W[1], W[2] + Math.cos(q.yaw)]);
    const p = q.p, g = p.figure || (p.look ? playerFigure(p.look) : null);
    const t = token(p.id);
    out.push({ t, x: room.gx + P[0], y: room.gy + P[1], z: P[2], hd: Math.atan2(Q[1] - P[1], Q[0] - P[0]), clip: q.walk ? 'walk' : clipOf(q), ...(q.walk ? { gd: q.gone * Math.abs(room.M[6] || 1) } : {}), ph: (parseInt(t, 36) % 1000) / 1000, s: p.sex === 'female' ? 1 : 0, ...(g ? { g } : {}) });
  }
  return out;
}

// THE ROOM'S PEOPLE LYING DOWN, as the Room Stage poses them (room-stage.js bodiesNow): on the bed's own seat, its head
// and its top, asleep or out cold, as close-up bodies for figurePeople in the room's frame. The street's crowd body can't
// lie down, so roomPeopleRecords leaves them out and the room draws them close up instead (gl/interiors.js liveDraw).
export function lyingBodies(L, people, you = null) {
  if (!L) return [];
  return placePeople(L, people, you).filter((q) => q.pose === 'lie' && q.seat).map((q) => {
    const p = q.p, s = q.seat;
    return { id: p.id, seat: s, at: q.at, yaw: q.yaw, pose: 'lie', head: s.head, top: s.top, sculpt: true, sex: p.sex,
      figure: p.figure || (p.look ? playerFigure(p.look) : undefined), wear: p.wear, feel: p.feel,
      rest: p.asleep ? 'sleep' : p.out ? 'out' : undefined, manner: p.manner, mood: p.mood, ...(p.clip ? { clip: p.clip } : {}), ...(p.bar ? { bar: p.bar } : {}) };
  });
}

// THE ROOM'S PEOPLE DRAWN CLOSE UP STANDING (flags.figure.closeup, docs/proposals/the-inbetween.md): a figure the
// street's crowd body can't be, a 2.3 m attendant in mirror chrome, posed by figurePeople in the room's frame like the
// people lying down. Somebody walking a route stays in the crowd till they've stopped.
// Who else is drawn close up for now, by id, whatever their figure says: somebody playing at a chessboard in the room,
// whose hands move the men (freelook-view.js owChessTick fills it).
export const closeupAlso = new Set();
export function closeupBodies(L, people, you = null) {
  if (!L) return [];
  return placePeople(L, people, you).filter((q) => (q.p.figure?.closeup || closeupAlso.has(q.p.id)) && q.pose !== 'lie').map((q) => {
    const p = q.p;
    return { id: p.id, at: q.at, yaw: q.yaw, pose: q.pose === 'sit' ? 'sit' : 'stand', sculpt: true, sex: p.sex, figure: p.figure, wear: p.wear, feel: p.feel,
      manner: p.manner, mood: p.mood, ...(q.seat ? { seat: q.seat } : {}), ...(p.clip ? { clip: p.clip } : {}) };
  });
}

// The person you're facing and near enough to talk to, as the Room Stage's personAimed has it (room-walk.js `sight`:
// within 8 ft, squarely ahead, nearer and squarer winning): somebody the server runs (`npc`), not in the en-suite. `at`
// and `ahead` are [u, v] in the room's frame, `ahead` a step in front of you. Pure but for placePeople's kept spots.
const SIGHT_FT = 8, SIGHT_FACING = 0.7;
export function facedPerson(L, people, you, at, ahead) {
  if (!L || !at || !ahead) return null;
  const du = ahead[0] - at[0], dv = ahead[1] - at[1], n = Math.hypot(du, dv);
  if (!n) return null;
  const reach = SIGHT_FT * (L.ft || 1);
  let best = null, score = Infinity;
  for (const q of placePeople(L, people, you)) {
    if (!q.p.npc) continue;
    const pu = q.at[0] - at[0], pv = q.at[1] - at[1], d = Math.hypot(pu, pv), facing = d ? (pu * du + pv * dv) / (d * n) : 1;
    if (d > reach || facing < SIGHT_FACING) continue;
    const s = d * (2 - facing);
    if (s < score) { score = s; best = q.p; }
  }
  return best;
}
