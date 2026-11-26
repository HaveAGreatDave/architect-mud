// NPC DOORS: the door a person on the street opens to go into a building, or to come out of one.
//
// The street feed (server/engine/street-actors.js) drops somebody when they go indoors and adds them when they
// come out, and their last tile is always the one beside the door. windshield.js drawStreetActors turns that
// into a walk: up to the doorstep, the door opens, through it, and it shuts behind them. This file owns the door:
// where it is, when it's open, and handing it to glass/street-doors.js to draw.
//
// ⚠ THE BUILDING'S OWN DOORWAY, ON ITS FRONT. A person goes in by the front door and nowhere else: the building
// whose `flags.entrance` faces the tile they left (windshield.js doorwayDir), at the doorway its model drew
// (doorBayAt, the one the street door on foot is fitted to), not the middle of whichever wall was nearest. Only a
// model that records no doorway is measured off its mass at the front's middle, as before.
//
// ⚠ ONE DOOR, ONE LOOK. It's drawn by the street door's own renderer, in the kind the building's type has
// (client/shared/street-door.js doorForType): a revolving door on a tower, an automatic pair on a clinic, a glazed
// shop door, a painted leaf on a flat, a grille on a works. A building somebody on foot has a Stage door for is
// drawn once, by that door, and the person going through just opens it (npcDoorsOnto).
//
// ⚠ DECALS, NOT MASS, for the reason glass/street-doors.js gives. A door nobody is using isn't drawn here at all;
// the arm's own door stands in its doorway.
import { groundObstructionAt, doorBayAt } from '../windshield.js';
import { drawStreetDoors } from './street-doors.js';
import { doorForType } from '../../../../shared/street-door.js';

export const NPC_DOOR = Object.freeze({
  approach: 1100,   // ms from leaving the feed to the doorstep
  through: 850,     // ms from the doorstep to inside
  open: 450,        // ms for the door to open
  close: 650,       // ms for it to shut
  hold: 350,        // ms it stays open after the last person is through
  emerge: 1300,     // ms from inside the door to where somebody coming out stands
});

const DOORS = new Map();    // 'gx,gy,ex,ey' -> door
let _map = null;

// The doorway measured off the mass at the front's middle, for a model that records none.
function measured(gx, gy, c, at) {
  const hit = (lx, ly, z) => { const [px, py] = at(lx, ly); return groundObstructionAt(gx, gy, c, px, py, z, 0) > 0; };
  let wall = null;
  for (let ly = 0.5; ly >= 0.1 && wall == null; ly -= 0.005) if (hit(0, ly, 0.02)) wall = ly;
  if (wall == null) return null;
  let half = null, top = null;
  for (let lx = 0.01; lx <= 0.3 && half == null; lx += 0.004) if (hit(lx, wall + 0.02, 0.02) || hit(-lx, wall + 0.02, 0.02)) half = lx;
  for (let z = 0.03; z <= 3 && top == null; z += 0.01) if (hit(0, wall + 0.02, z)) top = z;
  let front = wall;
  if (half != null) for (let ly = 0.5; ly > wall; ly -= 0.004) if (hit(half + 0.012, ly, 0.02) || hit(-half - 0.012, ly, 0.02)) { front = ly; break; }
  // a tower's lobby opening is drawn to the tower's scale, so it's held to a door's size
  return { cx: 0, wall, front, half: Math.max(0.035, Math.min(half ?? 0.05, 0.075)), sill: 0, top: Math.max(0.09, Math.min(top ?? 0.12, 0.13)) };
}

// The door on building tile (gx, gy) facing E (out of the front, toward the street tile), or null when
// there's no wall there to put one in.
function probe(map, R, wcx, wcy, gx, gy, E) {
  const row = map[gy - wcy + R], c = row && row[gx - wcx + R];
  if (!c || !c.bt) return null;
  const bay = doorBayAt(gx, gy, c);
  const g = bay && bay.head - bay.sill > 0.05
    ? { cx: bay.lx, wall: bay.wall, front: bay.front, half: Math.max(0.03, Math.min(bay.half, 0.25)), sill: bay.sill || 0, top: bay.head }
    : measured(gx, gy, c, (lx, ly) => [gx + lx * E[1] + ly * E[0], gy - lx * E[0] + ly * E[1]]);
  if (!g) return null;
  // the tile's frame about the doorway's own middle: x along the front, y out of it
  const at = (lx, ly) => [gx + (lx + g.cx) * E[1] + ly * E[0], gy - (lx + g.cx) * E[0] + ly * E[1]];
  const plane = Math.min(0.498, g.front + 0.01);
  const tone = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
  const { kind, look } = doorForType(c.bt, tone);
  return { gx, gy, E, at, cx: g.cx, plane, back: plane - 0.006, half: g.half, sill: g.sill, top: g.top, kind, look, fit: bay ? 'model' : 'mass', ev: [] };
}

// The door into the building beside street tile (x, y) in direction (dx, dy), cached per window.
export function npcDoorFor(map, R, wcx, wcy, x, y, dx, dy) {
  if (map !== _map) { _map = map; for (const [k, d] of DOORS) if (!d?.ev.length) DOORS.delete(k); }   // null is a tile probed with no door
  const gx = Math.round(x) + dx, gy = Math.round(y) + dy, key = `${gx},${gy},${dx},${dy}`;
  if (DOORS.has(key)) { const d = DOORS.get(key); if (d) return d; }
  let d = null;
  try { d = probe(map, R, wcx, wcy, gx, gy, [-dx, -dy]); } catch { d = null; }
  DOORS.set(key, d);
  return d;
}

// Somebody needs the door open from `from` (it starts opening then) until `to` (it starts shutting then).
export function npcDoorUse(d, from, to) {
  d.ev.push({ a: from, b: Math.max(from + NPC_DOOR.open, to) });
}

// How far open it is at `now`, 0 shut to 1 open.
export function npcDoorOpen(d, now) {
  let o = 0;
  for (const e of d.ev) {
    if (now < e.a) continue;
    const k = now < e.b ? Math.min(1, (now - e.a) / NPC_DOOR.open) : Math.max(0, 1 - (now - e.b) / NPC_DOOR.close);
    if (k > o) o = k;
  }
  // a smooth swing: it eases off the latch and comes to a stop
  return o * o * (3 - 2 * o);
}

// Points along the way in: the doorstep in front of it and a step inside it, absolute tiles, on the doorway's middle.
export function npcDoorStep(d) { return d.at(0, d.plane + 0.07); }
export function npcDoorInside(d) { return d.at(0, d.plane - 0.16); }

function prune(now) {
  for (const d of DOORS.values()) if (d && d.ev.length) d.ev = d.ev.filter((e) => now < e.b + NPC_DOOR.close + 50);
}

// The Stage doors somebody on foot has (v.streetDoors, freelook-view.js doorLeaves) open for a person going
// through them too: one door, drawn once, by its own record. Called before drawStreetDoors.
export function npcDoorsOnto(doors, now) {
  if (!doors || !doors.length || !DOORS.size) return;
  prune(now);
  for (const d of DOORS.values()) {
    if (!d || !d.ev.length) continue;
    const s = doors.find((x) => Math.round(x.x) === d.gx && Math.round(x.y) === d.gy);
    if (s) s.open = Math.max(s.open || 0, npcDoorOpen(d, now));
  }
}

export function drawNpcDoors(ctx, cam, v, now, night) {
  if (!DOORS.size || !v.mapCenter) return;
  prune(now);
  const taken = v.streetDoors && v.streetDoors.length ? v.streetDoors : null, list = [];
  for (const d of DOORS.values()) {
    if (!d || !d.ev.length) continue;
    // somebody on foot already has this building's own door drawn, and npcDoorsOnto opened it
    if (taken && taken.some((s) => Math.round(s.x) === d.gx && Math.round(s.y) === d.gy)) continue;
    list.push({ x: d.gx, y: d.gy, E: d.E, plane: d.plane, back: d.back, half: d.half, sill: d.sill, top: d.top, cx: d.cx, fit: d.fit === 'mass' ? 'room' : 'model', kind: d.kind, look: d.look, open: npcDoorOpen(d, now) });
  }
  if (list.length) drawStreetDoors(ctx, cam, { streetDoors: list, mapCenter: v.mapCenter, mapOffset: v.mapOffset }, now, night, null);
}
