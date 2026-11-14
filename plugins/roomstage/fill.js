// plugins/roomstage/fill.js
//
// HOW FULL A CONTAINER LOOKS ON THE STAGE: a fridge, a wardrobe, a cupboard or a crate is drawn empty, with a few
// things in it, half full or full (`fill` 0 to 3 on its piece; gl/room-fittings.js stockOf draws it). The picture
// isn't the contents: it's a level, so nothing here sends what's in the box.
//
// ⚠ IT'S RAM AND IT'S NEVER READ ON A MOVE. Each box's tally (how many things, what they weigh) is kept here by
// furniture id. The engine's `container.view` hook hands it over for nothing on every open, and again on every put
// and take the panel makes, since the view it fires with already counts the box. A box nobody has opened since the
// server started is counted by one query for every container in the world (`warm`), started the first time a room
// is drawn and never awaited by it; until it lands a container has no level, and the client draws it half full.
// A box changed some other way (a typed `put`, a restock, a cook) is a level behind until somebody opens it.

import { query } from '../../server/models/db.js';
import { world, getFurnitureById, getZoneFurniture } from '../../server/engine/world.js';

// furniture id -> { n: how many things, used: grams }
const tallies = new Map();
let warmed = false, warming = null;

// A furniture row's capacity in grams, as the engine reads it (commands/inventory.js containerCapacity).
const capOf = (f) => Number(f?.flags?.container) > 0 ? Number(f.flags.container) : 60000;

// The level from a count and a weight: 1 or 2 things is a few, 3 to 7 is half full, 8 or more is full, and so
// is a box loaded past 70% of what it holds by weight, however few things that is.
export function fillLevel(n, used, cap) {
  if (!(n > 0)) return 0;
  const s = Math.max(n / 12, cap > 0 ? used / cap / 0.7 : 0);
  return s < 0.25 ? 1 : s < 0.6 ? 2 : 3;
}

// A piece's level, its compartments counted in (a cabinet whose shelves are rows of their own, `compartment_of`).
// Null until the warm has landed and nobody has opened it: the client then draws it as it always did.
export function fillOf(id) {
  const f = getFurnitureById(id);
  if (!f) return null;
  const ids = [id, ...getZoneFurniture(f.zone_id).filter((x) => x.flags?.compartment_of === id).map((x) => x.id)];
  if (!warmed && !ids.some((x) => tallies.has(x))) return null;
  let n = 0, used = 0, cap = 0;
  for (const x of ids) { const t = tallies.get(x); if (t) { n += t.n; used += t.used; } cap += capOf(getFurnitureById(x)); }
  return fillLevel(n, used, cap);
}

// From a container view (the engine's `container.view` hook): the box and its paired one. Returns the furniture
// ids whose level moved, for the Stage to send again.
export function noteView(view) {
  const moved = [];
  for (const box of [view, view?.secondary]) {
    const id = box?.containerId, f = id && getFurnitureById(id);
    if (!f || !Array.isArray(box.containerItems)) continue;
    const owner = f.flags?.compartment_of || id, was = fillOf(owner);
    const n = box.containerItems.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    tallies.set(id, { n, used: Number(box.usedWeight) || 0 });
    if (fillOf(owner) !== was) moved.push(owner);
  }
  return moved;
}

// Every container's tally in one query, the first time a room is drawn. `onDone` is told which pieces now have a
// level, so the rooms open can be sent them.
export function warm(onDone) {
  if (warmed || warming) return;
  const ids = [];
  for (const f of world.furniture.values()) if (f.object_type === 'container' || Number(f.flags?.container) > 0) ids.push(f.id);
  if (!ids.length) { warmed = true; return; }
  warming = query(
    `SELECT pi.container_id AS id, SUM(pi.quantity)::int AS n, COALESCE(SUM(i.weight * pi.quantity), 0)::float AS used
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.container_id = ANY($1::text[]) GROUP BY pi.container_id`, [ids])
    .then(({ rows }) => {
      // a box opened while the query was out keeps what its view said
      for (const r of rows) if (!tallies.has(r.id)) tallies.set(r.id, { n: Number(r.n) || 0, used: Number(r.used) || 0 });
      warmed = true;
      onDone?.(ids);
    })
    .catch((e) => console.error('[roomstage] fill warm:', e.message))
    .finally(() => { warming = null; });
}

export const _fillTest = { tallies, reset: () => { tallies.clear(); warmed = false; warming = null; }, setWarmed: (v) => { warmed = v; } };
