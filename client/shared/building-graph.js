// THE BUILDING STAGE'S GRAPH: which rooms make up a building and how their doors join
// (docs/proposals/building-stage.md, step 1). Pure: no DOM, no DB, so the server can build it from
// the world Maps at load and a gate can build it from the content tree.
//
// A building is one interior map: the `maps` row whose `parent_zone_id` is the facade tile on the
// world map and whose `entry_zone_id` is the room the front door opens into. Its rooms are the zones
// on that map. Interior zones all sit at grid 0,0 on their own map, so nothing here reads a
// coordinate; it's exits only.
//
// Every exit out of a room is one of:
//   door   to another room on the same map. `kind` says whether the floor plan can place it:
//          'straight' (the other side's opposite exit comes back), 'bent' (it comes back, but by
//          another direction, so the two rooms can't share one doorway), 'one_way' (nothing comes
//          back) or 'lift' (one exit with several targets, a lift car or a stairwell's list).
//   front  to a zone on the world map: the way out to the street.
//   link   to a room on another interior map: a door into the building next door. The Stage draws
//          it shut for now.
//
// A room has a Stage when it has a spec (roomSpecOf in room-layout.js: `flags.room`, or a flat). A
// room without one is a shut door. The building's `walk` is the specced rooms reached from the entry
// through specced rooms, and a building is 'ready' when its entry has a spec, 'partial' when some
// other room does, and 'none' otherwise.

import { withDoorways, roomSpecOf, withAnnex, WALL_T } from './room-layout.js';

export const OPPOSITE = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up', in: 'out', out: 'in',
};

// The map that holds rooms nobody can reach (stored buildings). Never a building.
export const SET_ASIDE_MAP = 'map_set_aside';

export function exitTargets(exits, dir) {
  const v = exits?.[dir];
  return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
}

// A zone's Stage spec from the content alone, as the roomstage plugin builds it (its specOf): `flags.room`, or a
// flat's, with the en-suite behind the back wall when `in` reaches one (the zone whose `out` comes back and whose
// parent is this one). The gate and the Room Lab plan a building from this, so the plan they check has the
// en-suite the game draws. Z is a Map of id -> zone.
export function zoneSpecOf(Z, z) {
  const spec = z ? roomSpecOf(z.flags, !!z.flags?.is_apartment) : null;
  if (!spec) return null;
  const inner = Z.get(exitTargets(z.exits, 'in')[0]);
  const annex = inner && exitTargets(inner.exits, 'out')[0] === z.id && inner.parent_zone === z.id ? inner : null;
  return annex ? withAnnex(spec, annex.id, annex.name) : spec;
}

// zones: a Map of id -> zone, or an iterable of zones ({ id, name, map_id, exits, flags }).
// maps: an iterable of map rows ({ id, name, parent_zone_id, entry_zone_id }).
// specOf(zone): the room's Stage spec, or null.
// Returns a Map of map id -> building.
export function buildingGraph({ zones, maps, specOf = () => null, world = 'map_world' }) {
  const Z = zones instanceof Map ? zones : new Map([...zones].map((z) => [z.id, z]));
  const byMap = new Map();
  for (const z of Z.values()) {
    if (!z.map_id || z.map_id === world || z.map_id === SET_ASIDE_MAP) continue;
    if (!byMap.has(z.map_id)) byMap.set(z.map_id, []);
    byMap.get(z.map_id).push(z);
  }
  const rows = new Map([...maps].map((m) => [m.id, m]));
  const out = new Map();
  for (const [mapId, list] of byMap) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const row = rows.get(mapId) || null;
    const b = {
      id: mapId,
      name: row?.name || mapId,
      facade: row?.parent_zone_id || null,
      entry: row?.entry_zone_id || null,
      rooms: [], doors: [], front: [], links: [], unreachable: [], problems: [],
    };
    const mine = new Set(list.map((z) => z.id));
    for (const z of list) b.rooms.push({ id: z.id, name: z.name, spec: !!specOf(z) });
    for (const z of list) {
      for (const dir of Object.keys(z.exits || {})) {
        const targets = exitTargets(z.exits, dir);
        for (const to of targets) {
          const t = Z.get(to);
          if (!t) { b.problems.push({ kind: 'missing', zone: z.id, dir, to }); continue; }
          if (t.map_id === world) { b.front.push({ from: z.id, dir, to }); continue; }
          if (!mine.has(to)) { if (t.map_id !== SET_ASIDE_MAP) b.links.push({ from: z.id, dir, to, map: t.map_id }); continue; }
          b.doors.push({ from: z.id, dir, to, kind: doorKind(z, dir, t, targets.length) });
        }
      }
    }
    // reachable from the entry through doors alone
    const start = b.entry && mine.has(b.entry) ? b.entry : null;
    if (!row) b.problems.push({ kind: 'no_map_row' });
    else if (!start) b.problems.push({ kind: 'no_entry', to: b.entry });
    if (start) {
      const seen = new Set([start]), stack = [start];
      while (stack.length) {
        const id = stack.pop();
        for (const d of b.doors) if (d.from === id && !seen.has(d.to)) { seen.add(d.to); stack.push(d.to); }
      }
      b.unreachable = list.map((z) => z.id).filter((id) => !seen.has(id));
    }
    if (!b.front.length) b.problems.push({ kind: 'no_front_door' });
    // The walk: rooms with a spec, reached from a specced entry through specced rooms. A room
    // without one is a shut door.
    const specd = new Set(b.rooms.filter((r) => r.spec).map((r) => r.id));
    b.walk = [];
    if (start && specd.has(start)) {
      const seen = new Set([start]), stack = [start];
      while (stack.length) {
        const id = stack.pop();
        for (const d of b.doors) if (d.from === id && specd.has(d.to) && !seen.has(d.to)) { seen.add(d.to); stack.push(d.to); }
      }
      b.walk = [...seen].sort();
    }
    const inWalk = new Set(b.walk);
    for (const d of b.doors) if (d.kind === 'bent' && inWalk.has(d.from) && inWalk.has(d.to)) b.problems.push({ kind: 'bent', zone: d.from, dir: d.dir, to: d.to });
    if (b.walk.length && !b.front.some((f) => inWalk.has(f.from))) b.problems.push({ kind: 'walk_no_front_door' });
    // A building whose facade was set aside (docs/proposals/stored-buildings.md) is off the map
    // with its interior kept whole. Nobody can walk into it, so nothing holds it to a plan.
    b.stored = Z.get(b.facade)?.map_id === SET_ASIDE_MAP;
    b.readiness = b.stored ? 'stored' : b.walk.length ? 'ready' : specd.size ? 'partial' : 'none';
    out.set(mapId, b);
  }
  return out;
}

function doorKind(z, dir, t, fanout) {
  if (fanout > 1) return 'lift';
  const back = OPPOSITE[dir];
  if (back && exitTargets(t.exits, back).includes(z.id)) return 'straight';
  for (const d of Object.keys(t.exits || {})) {
    const ts = exitTargets(t.exits, d);
    if (ts.includes(z.id)) return ts.length > 1 ? 'lift' : 'bent';
  }
  return 'one_way';
}

// A building's defects that block its Stage. Only a ready building (its entry has a spec) is held to
// them: the rest are on the way and are reported, not failed. A whole-map `unreachable` room isn't
// one; text reaches it however it does now.
export function buildingDefects(b) {
  if (b.readiness !== 'ready') return [];
  return b.problems.filter((p) => p.kind !== 'no_front_door').map((p) => ({ ...p }));
}

// ── the floor plan (step 2) ──────────────────────────────────────────────────────────────────────
// buildingLayout puts every room of a building's walk into one frame, the frame roomLayout calls the
// host's: x east, z north, y up, in metres, with a bearing measured from +z toward +x (north 0, east
// 90). The entry room's middle is the origin. Each room comes back as the `at`, `face` and `floor`
// its spec needs, so roomLayout({ ...spec, ...room }) draws it in place, and its `box`.
//
// A room's facing is the Room Stage's (bearingOf in plugins/roomstage): `flags.room.face`, else away
// from its first compass exit, else the facing of the room it was reached from. A plan only takes
// right angles; anything else is a `skew` problem.
//
// Rooms join through a door with ROOM_GAP between their floors: each room draws its own wall outside
// its floor (gl/room-mesh.js, 0.14 m), so two walls back to back make the wall between. The door is in the middle of the
// shared wall unless `flags.room.doors[dir]` moves it: metres along the wall, east on a north or
// south wall and north on an east or west wall, the same number on both sides of a wall, so the two
// rooms' offsets differ by how far their middles are apart. `up` and `down` stack a room on the one
// below, middle over middle. `in` goes through the back wall and `out` through the front, as the
// en-suite's door does.
//
// Every opening comes back in `doors`, with where it is on each room's own walls ({ wall, a, b } in
// roomLayout's u/v: `along` is u on the front and back walls and v on the side walls). A door to a
// room outside the walk is `shut`; one to the street is `front`; one to the building next door is
// `link`.
//
// Problems: `skew`, `diagonal` (a northeast door has no wall), `door_off_wall` (the offset puts the
// opening past the wall's end), `mismatch` (a room reached two ways lands in two places, so a door
// pair doesn't meet) and `overlap` (two rooms share floor space).

export const DOOR_W = 0.9;
export const LIFT_STOREY = 3.6;   // metres a lift stop rises per floor number
export const ROOM_GAP = 0.28;   // two room walls back to back (room-layout.js WALL_T each)
const MARGIN = 0.15, EPS = 0.01;
const BEARING = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
const COMPASS = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] };
const SIDE = { 0: 'north', 90: 'east', 180: 'south', 270: 'west' };
const norm = (a) => ((Math.round(a) % 360) + 360) % 360;
const r2 = (n) => Math.round(n * 1000) / 1000;

// Which way a room's front wall faces, as the Room Stage works it out, or null when the zone doesn't say.
export function faceOf(zone) {
  const own = Number(zone?.flags?.room?.face);
  if (Number.isFinite(own)) return norm(own);
  for (const dir of Object.keys(zone?.exits || {})) if (BEARING[dir] !== undefined && exitTargets(zone.exits, dir).length) return norm(BEARING[dir] + 180);
  return null;
}

// One room's openings, for its spec (roomLayout cuts and walks them): { wall, a, b, kind, dir, to }
// on the room's own walls. `dir` is the exit this room takes through it, so walking through sends
// `move <dir>`; a one-way door seen from the side it doesn't open from has none, and stays shut.
// Stairs have no wall and aren't here yet.
//
// A lift car (`plan.lifts`) has one doorway per stop, all on the wall the upper floors meet it by.
// Its openings depend on where the car is standing (`parked`, the stop's zone; the ground floor when
// null): that stop's doorway is open and leaves by `out`, the rest are shut, and only one of them is
// kept so the wall holds one pair of doors. A stop's landing always sees its own lift door open.
export function roomOpenings(b, plan, zoneId, parked = null) {
  const out = [], lift = plan.lifts?.[zoneId];
  const here = lift && parked && lift.stops.some((s) => s.zone === parked) ? parked : null;
  let rear = false;
  for (const d of plan.doors) {
    const side = d.sides[zoneId];
    if (!side || side.wall === 'floor' || side.wall === 'ceiling') continue;
    if (d.kind === 'lift') {
      // the landing's own doors: shut until you come up to them, as the street's glass doors are (`slide`),
      // and bronze, as the car's are (`lift`)
      if (d.from === zoneId) { out.push({ wall: side.wall, a: side.a, b: side.b, kind: 'door', dir: d.dir, to: d.to, slide: true, lift: true }); continue; }
      const open = here === d.from;
      if (!open && (rear || here)) continue;
      if (!open) rear = true;
      out.push({ wall: side.wall, a: side.a, b: side.b, kind: open ? 'door' : 'shut', dir: open ? 'out' : null, to: d.from });
      continue;
    }
    // `deep`: through a flat's back wall, the doorway is at the end of a hall past its en-suite (buildingLayout)
    const deep = side.deep ? { deep: side.deep } : {};
    if (here && d.kind === 'door') { out.push({ wall: side.wall, a: side.a, b: side.b, kind: 'shut', dir: null, to: d.from === zoneId ? d.to : d.from, ...deep }); continue; }
    const mine = d.from === zoneId, other = mine ? d.to : d.from;
    const dir = mine ? d.dir : (b.doors.find((x) => x.from === zoneId && x.to === other)?.dir ?? null);
    // the ground floor's way into the car is a plain door in the plan; its landing gets the bronze doors too
    const landing = !lift && !!plan.lifts?.[other] && d.kind === 'door';
    out.push({ wall: side.wall, a: side.a, b: side.b, kind: d.kind === 'door' && !dir ? 'shut' : d.kind, dir, to: other, ...deep, ...(d.slide || landing ? { slide: true } : {}), ...(landing ? { lift: true } : {}) });
  }
  return out;
}

// Where room `toId` stands as seen from room `fromId`, as the `at`, `face` and `floor` of its spec. The
// Stage draws the room you're in at the origin facing 0, so the next room's walls, laid out by
// roomLayout with these, come out in the same frame as yours (docs/proposals/building-stage.md, step 4).
export function placeFrom(plan, fromId, toId) {
  const A = plan.rooms[fromId], B = plan.rooms[toId];
  if (!A || !B) return null;
  const f = A.face * Math.PI / 180, dx = B.at[0] - A.at[0], dz = B.at[1] - A.at[1];
  // a lift car is always at the level of the floor it's open on, whichever side you look from
  const lifted = plan.lifts?.[fromId] || plan.lifts?.[toId];
  // ⚠ THE STAGE'S FRAME IS THE PLAN'S IN A MIRROR. The plan is a map, x east and z north, bearings clockwise; the
  // Stage draws with roomLayout, whose right-hand wall is -x when it faces +z, so turned to face 0 east is -x there.
  // Turned without the mirror, every room next door was drawn on the wrong side: from the Solenne's thirtieth-floor
  // hall, 30-B (east, the text says) was through the west wall. So: turn, then mirror x, and the facing runs back.
  const x = dx * Math.cos(f) - dz * Math.sin(f), z = dx * Math.sin(f) + dz * Math.cos(f);
  return { at: [r2(-x), r2(z)], face: norm(A.face - B.face), floor: lifted ? 0 : r2(B.floor - A.floor) };
}

// Every ready building with more than one room to walk and a plan with no problems, keyed by each of its
// rooms: { b, plan }. A building whose plan has problems isn't joined up (the content gate fails it),
// and each of its rooms stays a Stage of its own. specOf(zone) is the room's Stage spec or null.
export function walkPlans({ zones, maps, specOf }) {
  const out = new Map();
  for (const b of buildingGraph({ zones, maps, specOf }).values()) {
    if (b.readiness !== 'ready' || b.walk.length < 2) continue;
    const plan = buildingLayout(b, { zones, specOf });
    if (plan.problems.length) continue;
    const entry = { b, plan };
    for (const id of b.walk) out.set(id, entry);
  }
  return out;
}

// What a room's Stage gets from its building: its spec with its doorways (withDoorways), and the rooms one
// open doorway away, each with its own doorways and placed from this one, to be drawn as shells
// through them. The roomstage plugin's room_view and the Room Lab both build theirs here.
// specOf(zoneId) is a room's Stage spec; nameOf(zoneId) its name.
// `parked` is where a lift car stands when `zoneId` is one (roomOpenings); a car seen from one of its
// stops is open on that stop.
export function buildingView(bld, zoneId, spec, { specOf, nameOf = () => '', parked = null }) {
  const own = withDoorways(spec, roomOpenings(bld.b, bld.plan, zoneId, parked)), neighbours = [];
  for (const o of own.openings) {
    if (o.kind !== 'door' || !bld.plan.rooms[o.to] || neighbours.some((n) => n.zone === o.to)) continue;
    const s = specOf(o.to), at = placeFrom(bld.plan, zoneId, o.to);
    if (!s || !at) continue;
    neighbours.push({ zone: o.to, name: nameOf(o.to), spec: { ...withDoorways(s, roomOpenings(bld.b, bld.plan, o.to, zoneId)), ...at } });
  }
  return { spec: own, building: { id: bld.b.id, name: bld.b.name, neighbours } };
}

export function buildingLayout(b, { zones, specOf }) {
  const Z = zones instanceof Map ? zones : new Map([...zones].map((z) => [z.id, z]));
  const rooms = {}, doors = [], problems = [], walk = new Set(b.walk || []);
  if (!walk.size) return { rooms, doors, problems };

  // a stair's place in a room's own frame, [u, v], from `flags.room.doors.up`/`down`, or null
  const stairOf = (id, dir) => { const v = Z.get(id)?.flags?.room?.doors?.[dir]; return Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? v : null; };
  // a point in a placed room's own frame (u across, v back from the front wall) as [x, z] from its middle
  const fromMid = (face, d, [u, v]) => { const f = face * Math.PI / 180, fx = Math.sin(f), fz = Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f); return [fx * (d / 2 - v) + rx * u, fz * (d / 2 - v) + rz * u]; };
  // `flags.room.street_door`: { kind: 'sliding', w } is a pair of automatic glass doors in place of a plain one
  const streetDoorOf = (id) => { const v = Z.get(id)?.flags?.room?.street_door; return v?.kind === 'sliding' ? { w: Math.max(1.2, Math.min(3, Number(v.w) || 1.8)) } : null; };
  const offOf = (id, dir) => { const v = Number(Z.get(id)?.flags?.room?.doors?.[dir]); return Number.isFinite(v) ? v : 0; };
  const ext = (R) => (R.face % 180 === 0 ? [R.w, R.d] : [R.d, R.w]);
  const mid = (R) => [(R.box[0] + R.box[1]) / 2, (R.box[4] + R.box[5]) / 2];
  // the compass side of a room a door leaves by
  const sideOf = (R, dir) => (dir === 'in' ? SIDE[norm(R.face + 180)] : dir === 'out' ? SIDE[norm(R.face)] : COMPASS[dir] ? dir : null);
  const backOf = (face) => SIDE[norm(face + 180)];
  // ⚠ A FLAT'S EN-SUITE IS BEHIND ITS BACK WALL (room-layout.js withAnnex), and the plan didn't know: a landing put
  // across that wall had the bath, the basin and the pan standing in it, and the penthouse's wrapped deck ran through
  // its lift. So a room with an en-suite is `deep` there: what's past a door in its back wall stands past the
  // en-suite, and the door opens on a short hall beside it (`deep` on the opening; room-layout.js hallOf).
  const deepOf = (id) => { const s = specOf(Z.get(id)); return s?.annex ? r2(WALL_T + s.annex.d) : 0; };
  // Where along its wall a door is, as `offOf` measures it: the authored offset, else, through the back wall of a
  // flat (a room with a studio plan or an en-suite), the flat's own front door, so a corridor meets that door and
  // not the en-suite beside it; else the middle.
  const offAt = (id, face, dir) => {
    const own = Number(Z.get(id)?.flags?.room?.doors?.[dir]);
    if (Number.isFinite(own)) return own;
    const s = specOf(Z.get(id)), side = sideOf({ face }, dir);
    if (!s?.door || !(s.annex || s.plan) || !side || side !== backOf(face)) return 0;
    const u = (s.door[0] + s.door[1]) / 2, f = face * Math.PI / 180, r = [Math.cos(f), -Math.sin(f)];
    return r2(COMPASS[side][1] ? r[0] * u : r[1] * u);
  };
  // What a room covers past its own floor, for the overlap test: its en-suite and hall behind the back wall, and a
  // balcony in front, wrapped down the sides and (wrapped all round) the back. [x0, x1, z0, z1] in the plan.
  const footOf = (R, s) => {
    let u0 = -s.w / 2, u1 = s.w / 2, v0 = 0, v1 = s.d + R.deep;
    const B = s.balcony;
    if (B) {
      v0 = -WALL_T - B.d; u0 = Math.min(u0, B.u[0]); u1 = Math.max(u1, B.u[1]);
      if (B.wrap) v1 = Math.max(v1, B.sides ? B.wrap - WALL_T : B.wrap + B.d);
    }
    const f = R.face * Math.PI / 180, fv = [Math.sin(f), Math.cos(f)], rv = [Math.cos(f), -Math.sin(f)];
    const pts = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [R.at[0] + rv[0] * u - fv[0] * v, R.at[1] + rv[1] * u - fv[1] * v]);
    return [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))].map(r2);
  };

  const make = (id, face, cx, cz, y) => {
    const s = specOf(Z.get(id));
    const R = { w: s.w, d: s.d, h: s.h, face, floor: r2(y) };
    const [ex, ez] = ext(R), f = face * Math.PI / 180;
    R.box = [cx - ex / 2, cx + ex / 2, y, y + s.h, cz - ez / 2, cz + ez / 2].map(r2);
    R.at = [r2(cx + Math.sin(f) * s.d / 2), r2(cz + Math.cos(f) * s.d / 2)];
    R.deep = deepOf(id);
    R.foot = footOf(R, s);
    return R;
  };
  const faceFor = (id, from) => {
    const own = faceOf(Z.get(id));
    const face = own ?? from ?? 0;
    if (face % 90) { problems.push({ kind: 'skew', zone: id, face }); return null; }
    return face;
  };

  // where the opening is on a room's own walls: roomLayout's local(), then the wall it lies on
  const onWalls = (R, p, dw = DOOR_W) => {
    const f = R.face * Math.PI / 180, fv = [Math.sin(f), Math.cos(f)], rv = [Math.cos(f), -Math.sin(f)];
    const q = [p[0] - R.at[0], p[2] - R.at[1]], u = q[0] * rv[0] + q[1] * rv[1], v = -(q[0] * fv[0] + q[1] * fv[1]);
    const wall = Math.abs(v) < EPS ? 'front' : Math.abs(v - R.d) < EPS ? 'back' : u > 0 ? 'right' : 'left';
    const along = wall === 'front' || wall === 'back' ? u : v;
    return { wall, a: r2(along - dw / 2), b: r2(along + dw / 2) };
  };
  // the middle of an opening in room R's wall on `side`, `off` along it, and whether it fits
  const opening = (id, R, side, off, dw = DOOR_W) => {
    const [nx, nz] = COMPASS[side], [ex, ez] = ext(R), [cx, cz] = mid(R);
    const len = nz ? ex : ez;
    if (Math.abs(off) + dw / 2 > len / 2 - MARGIN + EPS) problems.push({ kind: 'door_off_wall', zone: id, side, off });
    return [r2(cx + nx * ex / 2 + (nz ? off : 0)), R.floor, r2(cz + nz * ez / 2 + (nx ? off : 0))];
  };

  // where room `to` stands when reached from placed room A by `dir`
  const across = (A, from, dir, to, face) => {
    const s = specOf(Z.get(to)), B = { w: s.w, d: s.d, h: s.h, face };
    const [ax, az] = mid(A);
    if (dir === 'up' || dir === 'down') {
      // stacked middle over middle, unless both rooms say where their stair is: then the stair's
      // head on one stands over its foot on the other
      const y = dir === 'up' ? A.floor + A.h : A.floor - s.h, mine = stairOf(from, dir), theirs = stairOf(to, OPPOSITE[dir]);
      if (!mine && !theirs) return { cx: ax, cz: az, y };
      const [px, pz] = mine ? fromMid(A.face, A.d, mine) : [0, 0], [qx, qz] = theirs ? fromMid(face, B.d, theirs) : [0, 0];
      return { cx: r2(ax + px - qx), cz: r2(az + pz - qz), y };
    }
    const side = sideOf(A, dir);
    if (!side) return null;
    const [nx, nz] = COMPASS[side], [aex, aez] = ext(A), [bex, bez] = ext(B), shift = offAt(from, A.face, dir) - offAt(to, face, OPPOSITE[dir]);
    // a door through a flat's back wall goes past its en-suite, on either side
    const gap = ROOM_GAP + (side === backOf(A.face) ? A.deep : 0) + (SIDE[norm(BEARING[side] + 180)] === backOf(face) ? deepOf(to) : 0);
    return { cx: ax + nx * ((aex + bex) / 2 + gap) + (nz ? shift : 0), cz: az + nz * ((aez + bez) / 2 + gap) + (nx ? shift : 0), y: A.floor };
  };

  const recorded = new Set();
  const record = (kind, from, dir, to) => {
    const key = [from, to].sort().join('|') + '|' + kind;
    if (to && recorded.has(key)) return;
    if (to) recorded.add(key);
    const A = rooms[from];
    if (dir === 'up' || dir === 'down') {
      const [mx, mz] = mid(A), st = stairOf(from, dir), [px, pz] = st ? fromMid(A.face, A.d, st) : [0, 0], cx = mx + px, cz = mz + pz;
      const at = [r2(cx), dir === 'up' ? r2(A.floor + A.h) : A.floor, r2(cz)];
      const sides = { [from]: { wall: dir === 'up' ? 'ceiling' : 'floor' } };
      if (rooms[to]) sides[to] = { wall: dir === 'up' ? 'floor' : 'ceiling' };
      doors.push({ kind: kind === 'door' ? 'stairs' : kind, from, dir, to, at, sides });
      return;
    }
    const side = sideOf(A, dir);
    if (!side) { problems.push({ kind: 'diagonal', zone: from, dir, to }); return; }
    // a street door can be a pair of automatic glass doors, as wide as it says (flags.room.street_door)
    const sd = kind === 'front' ? streetDoorOf(from) : null, dw = sd ? sd.w : DOOR_W;
    const [nx, nz] = COMPASS[side], aDeep = side === backOf(A.face) ? A.deep : 0;
    // on the room's own wall, and (through a flat's back wall) out past its en-suite at the end of its hall
    const wallAt = opening(from, A, side, offAt(from, A.face, dir), dw), at = [r2(wallAt[0] + nx * aDeep), wallAt[1], r2(wallAt[2] + nz * aDeep)];
    const sides = { [from]: { ...onWalls(A, wallAt, dw), ...(aDeep ? { deep: aDeep } : {}) } };
    if (rooms[to] && kind === 'door') {
      // the same opening on the far room's own wall, across the gap and the far room's own hall
      const B = rooms[to], bSide = SIDE[norm(BEARING[side] + 180)], bDeep = bSide === backOf(B.face) ? B.deep : 0, g = ROOM_GAP + bDeep;
      opening(to, B, bSide, offAt(to, B.face, OPPOSITE[dir]));
      sides[to] = { ...onWalls(B, [at[0] + nx * g, at[1], at[2] + nz * g]), ...(bDeep ? { deep: bDeep } : {}) };
    }
    doors.push({ kind, from, dir, to, at, sides, ...(sd ? { slide: true } : {}) });
  };

  const entry = b.entry, f0 = faceFor(entry, null);
  if (f0 === null) return { rooms, doors, problems };
  rooms[entry] = make(entry, f0, 0, 0, 0);
  const byFrom = new Map();
  for (const d of b.doors) { if (!byFrom.has(d.from)) byFrom.set(d.from, []); byFrom.get(d.from).push(d); }
  for (const list of byFrom.values()) list.sort((x, y) => (x.dir < y.dir ? -1 : x.dir > y.dir ? 1 : x.to < y.to ? -1 : 1));
  const grow = (queue) => { while (queue.length) {
    const id = queue.shift(), A = rooms[id];
    for (const d of byFrom.get(id) || []) {
      if (d.kind === 'lift' || d.kind === 'bent') continue;
      if (!walk.has(d.to)) { record('shut', id, d.dir, d.to); continue; }
      const face = rooms[d.to]?.face ?? faceFor(d.to, A.face);
      if (face === null) continue;
      const p = across(A, id, d.dir, d.to, face);
      if (!p) { problems.push({ kind: 'diagonal', zone: id, dir: d.dir, to: d.to }); continue; }
      if (rooms[d.to]) {
        const B = rooms[d.to], [bx, bz] = mid(B);
        if (Math.abs(bx - p.cx) > EPS || Math.abs(bz - p.cz) > EPS || Math.abs(B.floor - p.y) > EPS) problems.push({ kind: 'mismatch', zone: id, dir: d.dir, to: d.to });
        else record('door', id, d.dir, d.to);
        continue;
      }
      rooms[d.to] = make(d.to, face, p.cx, p.cz, p.y);
      queue.push(d.to);
      record('door', id, d.dir, d.to);
    }
  } };
  grow([entry]);

  // Lift cars, built bottom to top. A car is placed once, where the ground floor's doors reach it. Each
  // of its stops (flags.elevator_floors, lowest first) whose landing comes back by a plain `in` stands
  // across the car's wall at its own height: LIFT_STOREY a floor, and never lower than the top of
  // everything already placed, so a double-height room can't run into the floor above. Then that
  // floor's own doors are walked as the ground floor's were. The landing's back wall faces the car, so
  // the landing's `face` is also the side of the car its doors open on.
  const lifts = {};
  for (const C of Object.keys(rooms).sort()) {
    const car = Z.get(C);
    if (!car?.flags?.elevator || !Array.isArray(car.flags.elevator_floors)) continue;
    const backIn = (id) => { const t = exitTargets(Z.get(id)?.exits, 'in'); return t.length === 1 && t[0] === C; };
    const stops = car.flags.elevator_floors
      .filter((f) => f && walk.has(f.zone) && !rooms[f.zone] && Number.isFinite(Number(f.n)) && backIn(f.zone))
      .map((f) => ({ n: Number(f.n), zone: f.zone, label: f.label || Z.get(f.zone)?.name || f.zone }))
      .sort((a, b) => a.n - b.n);
    if (!stops.length) continue;
    const K = rooms[C], placed = [];
    for (const st of stops) {
      const top = Math.max(...Object.values(rooms).map((R) => R.box[3]));
      const y = r2(Math.max((st.n - 1) * LIFT_STOREY, top));
      const face = faceFor(st.zone, K.face);
      if (face === null) continue;
      const side = SIDE[norm(face)], s = specOf(Z.get(st.zone));
      const [nx, nz] = COMPASS[side], [aex, aez] = ext(K), [bex, bez] = ext({ face, w: s.w, d: s.d }), [ax, az] = mid(K), off = -offOf(st.zone, 'in');
      rooms[st.zone] = make(st.zone, face, ax + nx * ((aex + bex) / 2 + ROOM_GAP) + (nz ? off : 0), az + nz * ((aez + bez) / 2 + ROOM_GAP) + (nx ? off : 0), y);
      // the car's doors at this floor, on the car's own walls and on the landing's
      const Kv = { ...K, floor: y }, at = opening(C, Kv, side, 0);
      opening(st.zone, rooms[st.zone], SIDE[norm(BEARING[side] + 180)], offOf(st.zone, 'in'));
      doors.push({ kind: 'lift', from: st.zone, dir: 'in', to: C, at: [at[0], y, at[2]], sides: { [C]: onWalls(Kv, at), [st.zone]: onWalls(rooms[st.zone], [at[0] + nx * ROOM_GAP, y, at[2] + nz * ROOM_GAP]) }, stop: st.n });
      placed.push({ ...st, y });
      grow([st.zone]);
    }
    lifts[C] = { ground: exitTargets(car.exits, 'out')[0] || null, stops: placed };
  }
  // a street door names the facade it opens onto, so the Stage can stand you in it coming back in
  for (const f of b.front) if (rooms[f.from]) record('front', f.from, f.dir, f.to || null);
  for (const l of b.links) if (rooms[l.from]) record('link', l.from, l.dir, null);

  // two rooms overlap when what they cover does: the floor, and the en-suite, hall and balcony past it (footOf)
  const ids = Object.keys(rooms).sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const P = rooms[ids[i]], Q = rooms[ids[j]], p = P.foot || [P.box[0], P.box[1], P.box[4], P.box[5]], q = Q.foot || [Q.box[0], Q.box[1], Q.box[4], Q.box[5]];
    const o = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    if (o(p[0], p[1], q[0], q[1]) > EPS && o(P.box[2], P.box[3], Q.box[2], Q.box[3]) > EPS && o(p[2], p[3], q[2], q[3]) > EPS) problems.push({ kind: 'overlap', zone: ids[i], to: ids[j] });
  }
  return { rooms, doors, problems, lifts };
}
