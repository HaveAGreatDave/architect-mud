// THE LONG HAUL — trailers, as things in the world.
//
// Phase 2.9. A trailer used to be a boolean on a rig: `hitch` set it true, `unhitch` set it false,
// and the box you dropped ceased to exist. That is fine for physics — the articulation angle only
// needs to know something is back there — and wrong for everything else, because the whole point of
// a fifth wheel is that the box and the truck are SEPARATE things. You drop a loaded one and come
// back for it. You run bobtail to somewhere and pick one up. You find one standing in a yard that
// is not yours.
//
// So a trailer is a row: `trailers`, with an owner, a place, and what is on it.
//
// TWO RULES, and both are decisions about where a trailer is allowed to BE:
//
//  1. `parked_zone` and `towed_by` are exclusive, and the DATABASE enforces it. A partial unique
//     index on `towed_by` means one trailer per truck is a constraint rather than a code path that
//     has to remember to check. Two players racing to hitch the same box is a lost UPDATE, not a
//     duplicated trailer.
//
//  2. A trailer can only stand where a ZONE still exists tomorrow. Depots and ordinary city tiles
//     are fine. A transient void room is not — it is torn down when the crossing ends, and a
//     trailer parked in one would be a row pointing at nothing, which is to say somebody's freight
//     silently deleted. `canDrop` is the whole of that rule and it is why `unhitch` on the corridor
//     answers no.
//
// READ TIER: cold, like the fleet. A trailer is read when you open a yard, hitch, or look at a
// tile — never on a tick and never on the drive. Once hitched, the live rig carries the row in RAM
// and the only write is on unhitch/park.

import { query } from '../../server/models/db.js';
import { randomUUID } from 'crypto';

// The dealer's line of boxes. Deliberately short: a trailer is not a second fleet ladder to climb,
// it is the thing that makes the truck you already bought useful. Rated capacity is what the weigh
// station measures you against (see the scale house), so it is the number that matters.
export const TRAILER_TYPES = [
  { id: 'flat', name: 'a flatbed', kg: 900, rated: 2200, price: 900,
    blurb: 'Open deck, chained load, nothing to hide behind. Light, cheap, and everybody can see what you are carrying.' },
  { id: 'box', name: 'a dry box', kg: 1400, rated: 3600, price: 2400,
    blurb: 'The ordinary one. Doors at the back, a seal you can break, and nobody can tell what is in it from the road.' },
  { id: 'reefer', name: 'a reefer', kg: 2100, rated: 4200, price: 5200,
    blurb: 'Insulated, and the unit on the nose runs whether you want it to or not. Heavy for what it holds, and worth it for what it holds.' },
  { id: 'tank', name: 'a tanker', kg: 2600, rated: 6000, price: 8800,
    blurb: 'A long steel cylinder on a frame. It carries more than anything else on the lot and it does not like corners.' },
];
export const trailerType = (id) => TRAILER_TYPES.find(t => t.id === id) || null;

const SELECT = 'id, name, owner_id, kg, rated_kg, parked_zone, towed_by, cargo, stash, condition, park_x, park_y, park_heading';

const shape = (r) => r && ({
  id: r.id, name: r.name, ownerId: r.owner_id,
  kg: r.kg, ratedKg: r.rated_kg,
  parkedZone: r.parked_zone, towedBy: r.towed_by,
  cargo: r.cargo || null, stash: r.stash || null,
  // The fourth component of the damage model (see damage.js). It is on the BOX rather than in the
  // truck's bag because a trailer outlives the tractor that towed it — damage that followed the
  // truck would heal itself every time somebody swapped boxes in a yard.
  condition: r.condition == null ? 1 : Number(r.condition),
  // WHERE IT IS STANDING, to the tile. Null on a row written before trailers had a pose (or on one
  // the yard put out as stock), which every reader treats as "the yard will place it" rather than
  // as an error — see `posed`.
  x: r.park_x == null ? null : Number(r.park_x),
  y: r.park_y == null ? null : Number(r.park_y),
  heading: r.park_heading == null ? null : Number(r.park_heading),
});
// Has this box got a real place in the world, or is it just somewhere in the room? One predicate,
// because "is it drawable" and "can I back under it" are the same question and must never drift.
export const posed = (t) => t && t.x != null && t.y != null;

// The trailer's half of the damage writer. Deliberately not guarded on ownership: a trailer you are
// towing is a trailer you are damaging, and the hitch is what already proved you were allowed to be
// towing it. Guarding here would refuse to record damage to somebody else's box that you crashed,
// which is the one case where recording it matters most.
export async function setTrailerCondition(id, condition) {
  await query('UPDATE trailers SET condition = $1 WHERE id = $2',
    [Math.max(0, Math.min(1, condition)), id]).catch(() => {});
}

export async function trailersAt(zoneId) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE parked_zone = $1 ORDER BY created_at`, [zoneId])
    .catch(() => ({ rows: [] }));
  return rows.map(shape);
}
export async function trailersOf(playerId) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE owner_id = $1 ORDER BY created_at`, [playerId])
    .catch(() => ({ rows: [] }));
  return rows.map(shape);
}
export async function getTrailer(id) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  return shape(rows[0]);
}
export async function trailerOnTruck(truckId) {
  const { rows } = await query(`SELECT ${SELECT} FROM trailers WHERE towed_by = $1`, [truckId]).catch(() => ({ rows: [] }));
  return shape(rows[0]);
}

export async function buyTrailer(playerId, typeId, zoneId) {
  const t = trailerType(typeId);
  if (!t) return null;
  const id = `trl_${randomUUID().slice(0, 12)}`;
  await query(
    'INSERT INTO trailers (id, name, owner_id, kg, rated_kg, parked_zone) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, t.name, playerId, t.kg, t.rated, zoneId]
  );
  return getTrailer(id);
}

// HITCH. Guarded on `parked_zone` so two drivers going for the same box is decided by the database
// rather than by whoever's round trip came back first — the loser's UPDATE matches zero rows and
// they are told somebody beat them to it, which is a better outcome than two trucks towing one
// trailer. Returns the row, or null if it was taken.
export async function hitchTrailer(trailerId, truckId, fromZone) {
  // The pose is cleared on the way onto the fifth wheel, and that is not tidiness: while it is
  // being towed the trailer's position IS the truck's, derived every frame from the articulation
  // angle. A stale park_x sitting in the row would be a second, wrong answer to "where is it",
  // and the renderer would eventually find it.
  const { rowCount } = await query(
    `UPDATE trailers SET towed_by = $1, parked_zone = NULL, park_x = NULL, park_y = NULL, park_heading = NULL
      WHERE id = $2 AND parked_zone = $3 AND towed_by IS NULL`,
    [truckId, trailerId, fromZone]
  ).catch(() => ({ rowCount: 0 }));
  return rowCount ? getTrailer(trailerId) : null;
}

// DROP. The zone has to be one that still exists tomorrow — see rule 2 at the top. `pose` is where
// in that zone: the tractor's own position and heading at the moment the pin was pulled, so a box
// is left where you left it, nose the way you were pointing. Optional, because a yard dropping
// stock has no truck to take a pose from.
export async function dropTrailer(trailerId, zoneId, pose = null) {
  await query(
    `UPDATE trailers SET towed_by = NULL, parked_zone = $1,
            park_x = $3, park_y = $4, park_heading = $5 WHERE id = $2`,
    [zoneId, trailerId, pose?.x ?? null, pose?.y ?? null, pose?.heading ?? null]);
  return getTrailer(trailerId);
}

// ── WHAT IS STANDING IN THIS YARD, IN RAM ────────────────────────────────────
// A parked trailer has to be DRAWN, and the cab pushes its world several times a second. Reading
// the table on that path would put a remote round trip on the drive — the exact thing the read
// tiers exist to forbid (docs/architecture.md) — so the zone's standing boxes are cached, and the
// cache is refreshed at the four moments the answer can change: mounting a truck, arriving in a
// zone, hitching, dropping. Nothing else writes `parked_zone`, so nothing else can invalidate it.
//
// ⚠ THE CACHE IS PER ZONE AND DELIBERATELY NOT GLOBAL. A yard nobody is standing in does not need
// to be in memory, and a stale row for a zone with no driver in it can hurt nobody.
// WHICH BOX TO DRAW. The mesh's trailer length is a property of the TRUCK SHAPE it was authored
// against (`deck` in TRUCK_SHAPES), and a trailer row carries no shape of its own — so the drawn
// length is derived from the one number that already says how big the thing is, its rated capacity.
// A flatbed is short, a tanker is long, and nobody had to author a second table to say so.
const meshShapeFor = (t) => {
  const r = t?.ratedKg || 0;
  return r >= 5000 ? 'continental' : r >= 3200 ? 'drayman' : r >= 2000 ? 'hauler' : 'scrapper';
};

const standing = new Map();   // zoneId -> { at, list }
export async function refreshStanding(zoneId) {
  if (!zoneId) return [];
  const list = await trailersAt(zoneId);
  standing.set(zoneId, { at: Date.now(), list });
  return list;
}
export function standingIn(zoneId) { return standing.get(zoneId)?.list || []; }
export function forgetStanding(zoneId) { standing.delete(zoneId); }
// The drawable set: standing boxes near a point, in the contact shape the cab already renders
// aircraft and other rigs in — so a trailer in the yard costs the client no new channel and no new
// code path. `~s` is the solo mesh: the same box you tow, with the tractor thrown away.
export function trailersNear(zoneId, x, y, range = 26) {
  const out = [];
  for (const t of standingIn(zoneId)) {
    if (!posed(t)) continue;                       // no pose, nothing to draw — the yard lists it instead
    if (Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) > range) continue;
    out.push({
      id: `trailer_${t.id}`, cls: 'truck', variant: `${meshShapeFor(t)}+t~s`,
      x: t.x, y: t.y, hdg: t.heading ?? 0,
      ias: 0, alt: 0, band: 'ground', onGround: true, groundZ: 0, altDiff: 0,
      bank: 0, pitch: 0, vs: 0, hullPct: Math.round((t.condition ?? 1) * 100),
      power: 0, lights: false,                     // nothing is running: no underglow, no lamps
      reg: t.name, trailerId: t.id,
    });
  }
  return out;
}

// ── BACKING UNDER ────────────────────────────────────────────────────────────
// Whether this truck, where it is standing right now, could take this box. Three tests, and each
// one is a thing a driver would actually have to get right:
//
//   NEAR      the kingpin has to be under the fifth wheel, not in the next bay. Half a tile.
//   SLOW      you couple at a walking pace. Hitting a parked trailer at speed is a collision, and
//             the collision system already has opinions about that.
//   SQUARE    you back UNDER a trailer along its own line. Thirty degrees of slop is generous for a
//             game and still refuses the case this exists to refuse: driving at the side of a box
//             and having it snap onto the pin.
//
// A trailer with no pose (yard stock, or a row written before trailers had a place) passes NEAR and
// SQUARE for free — it has no position to be wrong about, so the only test left is the sensible one.
export const HITCH_TILES = 0.5;
export const HITCH_MPH = 6;
export const HITCH_DEG = 30;
// ⚠ YOU COUPLE TO THE PIN, NOT TO THE TRAILER. A round half-tile around the trailer's pose is a
// DISC, and a disc has no front: it says yes to a truck alongside the box, and to one that has
// driven up the trailer's own flank until it happens to be near the middle of it. The pin is one
// point on one end of a forty-foot object, so the tolerance has to be shaped like the manoeuvre —
// a narrow lane on the trailer's centreline, running FORWARD from the pin, which is the only place
// a tractor can physically be when its fifth wheel is under one.
//
// The pose IS the coupling point: `unhitch` stores the tractor's own x/y at the moment the pin came
// out, so the point in the row is where the fifth wheel was standing. Nothing here has to guess at
// a trailer's length, and the picture agrees for free (see the nose anchoring in aircraft3d.js).
//
//   ACROSS   how far off its centreline you are. Tight — this is the one that refuses the flank.
//   ALONG    how far forward of the pin, plus a little slack BEHIND it for the overlap a fifth
//            wheel actually has. Longer than ACROSS, because the length of a tractor is the thing
//            you are judging by eye out of a mirror and the width is not.
export const HITCH_ACROSS = 0.22;
export const HITCH_ALONG = 0.55;
export const HITCH_BEHIND = 0.15;
export function hitchReach(rig, t) {
  if (!rig) return { ok: false, why: 'nodrive' };
  if (Math.abs(rig.speed || 0) > HITCH_MPH) return { ok: false, why: 'fast' };
  if (!posed(t)) return { ok: true, why: null };
  const dx = (rig.x ?? 0) - t.x, dy = (rig.y ?? 0) - t.y;
  const d = Math.hypot(dx, dy);
  // The trailer's own axes. Heading 0 is north, so forward is (sin, -cos) — the same convention the
  // sim integrates position in (flight-model.js), and the reason this is derived from it rather
  // than typed out is that a second copy of that convention is a sign error waiting to happen.
  const h = (t.heading ?? 0) * Math.PI / 180;
  const fx = Math.sin(h), fy = -Math.cos(h);
  const along = dx * fx + dy * fy;          // + is ahead of the pin, where a tractor belongs
  const across = Math.abs(dx * -fy + dy * fx);
  // ANGLE FIRST. A truck lying across the pin is not a truck that is nearly right, and telling it
  // it is 'too far off to couple' when it is inches away and sideways is the confusing answer.
  const off = Math.abs(((((rig.heading ?? 0) - t.heading + 540) % 360) - 180));
  if (off > HITCH_DEG) return { ok: false, why: 'angle', off };
  if (across > HITCH_ACROSS) return { ok: false, why: 'across', across, d };
  if (along > HITCH_ALONG || along < -HITCH_BEHIND) return { ok: false, why: 'far', d, along };
  return { ok: true, why: null, d, off, along, across };
}

// The load, written back as one statement. `cargo` is the DECLARED load and `stash` is what is not
// on the manifest; keeping them in two columns rather than one list is the entire reason the weigh
// station can ask a question the driver might be lying about the answer to.
export async function saveLoad(trailerId, cargo, stash) {
  await query('UPDATE trailers SET cargo = $1, stash = $2 WHERE id = $3',
    [cargo ? JSON.stringify(cargo) : null, stash?.length ? JSON.stringify(stash) : null, trailerId]);
}

// What the scale reads. The truck's own mass is not in here — a weighbridge under the trailer axles
// weighs the trailer, and that is also the only weight the driver has any control over.
export const declaredKg = (t) => (t?.kg || 0) + (t?.cargo?.kg || 0);
export const actualKg = (t) => declaredKg(t) + stashKg(t);
export const stashKg = (t) => (t?.stash || []).reduce((n, s) => n + (s.kg || 0), 0);

// A zone a trailer may be left in. Transient void rooms carry no coordinates and are deleted with
// the crossing, so a trailer dropped in one would be a row pointing at a zone that no longer
// exists — somebody's freight, gone, with no message. The coordinate test is the honest one: it is
// exactly "is this a place on the map".
export function canDrop(zone) {
  return !!zone && zone.grid_x != null && zone.grid_y != null;
}
