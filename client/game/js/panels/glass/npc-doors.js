// NPC DOORS: the door a person on the street opens to go into a building, or to come out of one.
//
// The street feed (server/engine/street-actors.js) drops somebody when they go indoors and adds them when they
// come out, and their last tile is always the one beside the door. windshield.js drawStreetActors turns that
// into a walk: up to the doorstep, the door swings open, through it, and it swings shut behind them. This file
// owns the door: where it is (read off the building's own mass, as freelook-view.js doorway() reads it for
// somebody on foot), when it's open, and drawing it.
//
// ⚠ DECALS, NOT MASS, for the reason glass/street-doors.js gives: an arm's mass is captured once at a frozen
// clock, and these move with when somebody walks through. A door nobody is using isn't drawn here at all; the
// arm's own door stands in its doorway.
//
// The leaf swings OUT, so it's in front of the wall and the jambs never hide it. Behind it, while it's open,
// the doorway is a dark card (lit warm at night) a hair behind the leaf's plane, which also hides the person
// once they're through.
import { emitDecoFill, groundObstructionAt } from '../windshield.js';

export const NPC_DOOR = Object.freeze({
  approach: 1100,   // ms from leaving the feed to the doorstep
  through: 850,     // ms from the doorstep to inside
  open: 450,        // ms for the door to swing open
  close: 650,       // ms for it to swing shut
  hold: 350,        // ms it stays open after the last person is through
  emerge: 1300,     // ms from inside the door to where somebody coming out stands
  swing: 1.35,      // how far it swings open (rad)
});
const CARD_IN = 0.006, CARD_PULL = 0.02, LIFT = 0.03, SILL = 0.0, HEAD = 0.96;

const DOORS = new Map();    // 'gx,gy,ex,ey' -> door
let _map = null;

// The door on building tile (gx, gy) facing E (out of the front, toward the street tile), or null when
// there's no wall there to put one in.
function probe(map, R, wcx, wcy, gx, gy, E) {
  const row = map[gy - wcy + R], c = row && row[gx - wcx + R];
  if (!c || !c.bt) return null;
  const at = (lx, ly) => [gx + lx * E[1] + ly * E[0], gy - lx * E[0] + ly * E[1]];
  const hit = (lx, ly, z) => { const [px, py] = at(lx, ly); return groundObstructionAt(gx, gy, c, px, py, z, 0) > 0; };
  let wall = null;
  for (let ly = 0.5; ly >= 0.1 && wall == null; ly -= 0.005) if (hit(0, ly, 0.02)) wall = ly;
  if (wall == null) return null;
  let half = null, top = null;
  for (let lx = 0.01; lx <= 0.3 && half == null; lx += 0.004) if (hit(lx, wall + 0.02, 0.02) || hit(-lx, wall + 0.02, 0.02)) half = lx;
  for (let z = 0.03; z <= 3 && top == null; z += 0.01) if (hit(0, wall + 0.02, z)) top = z;
  let front = wall;
  if (half != null) for (let ly = 0.5; ly > wall; ly -= 0.004) if (hit(half + 0.012, ly, 0.02) || hit(-half - 0.012, ly, 0.02)) { front = ly; break; }
  // A door is a person's door: a tower's lobby opening is drawn to the tower's scale, so it's held to a
  // door's size and stands in the middle of it.
  half = Math.max(0.035, Math.min(half ?? 0.05, 0.075));
  top = Math.max(0.09, Math.min(top ?? 0.12, 0.13));
  return { gx, gy, E, at, plane: Math.min(0.498, front + 0.01), half, top, ev: [], tone: ((gx * 73856093) ^ (gy * 19349663)) >>> 0 };
}

// The door into the building beside street tile (x, y) in direction (dx, dy), cached per window.
export function npcDoorFor(map, R, wcx, wcy, x, y, dx, dy) {
  if (map !== _map) { _map = map; for (const [k, d] of DOORS) if (!d.ev.length) DOORS.delete(k); }
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

// Points along the way in: the doorstep in front of it and a step inside it, absolute tiles.
export function npcDoorStep(d) { return d.at(0, d.plane + 0.07); }
export function npcDoorInside(d) { return d.at(0, d.plane - 0.16); }

const LEAF = [['rgb(58,40,30)', 'rgb(40,46,52)', 'rgb(70,28,24)', 'rgb(34,48,40)', 'rgb(64,60,52)'],
              ['rgb(30,22,18)', 'rgb(22,26,30)', 'rgb(38,16,14)', 'rgb(18,26,22)', 'rgb(34,32,28)']];

export function drawNpcDoors(ctx, cam, v, now, night) {
  if (!DOORS.size || !v.mapCenter) return;
  const ox = v.mapCenter.x + ((v.mapOffset && v.mapOffset.x) || 0);
  const oy = v.mapCenter.y + ((v.mapOffset && v.mapOffset.y) || 0);
  const taken = v.streetDoors && v.streetDoors.length ? v.streetDoors : null;
  for (const d of DOORS.values()) {
    if (!d || !d.ev.length) continue;
    d.ev = d.ev.filter((e) => now < e.b + NPC_DOOR.close + 50);
    if (!d.ev.length) continue;
    // somebody on foot already has this building's own doors drawn (glass/street-doors.js)
    if (taken && taken.some((s) => Math.round(s.x) === d.gx && Math.round(s.y) === d.gy)) continue;
    const open = npcDoorOpen(d, now);
    const P = (lx, ly, z) => { const p = d.at(lx, ly); return [p[0] - ox, p[1] - oy, z]; };
    const half = d.half, z0 = d.top * SILL, z1 = d.top * HEAD, pl = d.plane;
    if (open > 0.02) {
      const back = pl - CARD_IN;
      emitDecoFill(ctx, cam, [P(-half, back, z1), P(half, back, z1), P(half, back, 0), P(-half, back, 0)],
        night ? 'rgb(150,112,62)' : 'rgb(22,20,18)', 1, CARD_PULL, 'npcdoor', true);
    }
    // one leaf on a narrow door, a pair on a wide one, each hung on its jamb and swinging out
    const pair = half > 0.06;
    const th = open * NPC_DOOR.swing, c = Math.cos(th), s = Math.sin(th);
    const col = LEAF[night ? 1 : 0][d.tone % LEAF[0].length];
    for (const side of pair ? [-1, 1] : [1]) {
      const hinge = side * half, w = pair ? half : half * 2;
      const fx = hinge - side * w * c, fy = pl + w * s;
      emitDecoFill(ctx, cam, [P(hinge, pl, z1), P(fx, fy, z1), P(fx, fy, z0), P(hinge, pl, z0)], col, 1, LIFT, 'npcdoor', true);
      // the handle, on the leaf's free edge, so a door reads as a door at a few pixels
      const hx = hinge - side * w * 0.86 * c, hy = pl + w * 0.86 * s + 0.004, hz = d.top * 0.48, hw = d.top * 0.05;
      emitDecoFill(ctx, cam, [P(hx, hy, hz + hw), P(hx - side * 0.01 * c, hy + 0.01 * s, hz + hw), P(hx - side * 0.01 * c, hy + 0.01 * s, hz - hw), P(hx, hy, hz - hw)],
        night ? 'rgb(120,104,70)' : 'rgb(176,160,120)', 1, LIFT * 1.5, 'npcdoor', true);
    }
  }
}
