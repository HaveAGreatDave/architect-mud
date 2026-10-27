// THE FISH BOX: `boat hold` lists it, `boat unload` at a berth empties it into your inventory.
//
// The box is the `boat_hold` table (docs/proposals/boat-fishing.md §6), one row per fish, written by
// the fishing plugin's boat reel (plugins/fishing/boat.js). It's capped at the hull's `hold_kg`.
//
// ⚠ THE WEIGHT IS A RUNNING TOTAL IN RAM, READ ONCE. `holdKg` is the box's weight per boat id,
// loaded by `loadHold` the first time anything asks about that boat (the reel opening, or `boat
// hold`), and kept current by `addHoldKg` on every landing and `boat unload`. The live rig carries a
// copy as `rig.holdKg` for anything reading the rig. So checking whether a fish fits costs no query.

import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { aboard, berthKind, berthsNear, myBoats } from './yard.js';
import { livePosition, zoneUnder } from './adrift.js';
import { rigs } from './index.js';

const holdKg = new Map();   // boat id -> kg in the box

/** What a hull's box holds, in kg. A hull without `hold_kg` has no box. */
export const holdCapOf = (typeId) => Math.max(0, Number(TYPES[typeId]?.hold_kg) || 0);

/** The box's weight from RAM, or null before it's been read. */
export const holdKgOf = (boatId) => (holdKg.has(boatId) ? holdKg.get(boatId) : null);

function mirror(boatId, kg) {
  holdKg.set(boatId, kg);
  for (const rig of rigs.values()) if (rig?.boatId === boatId) rig.holdKg = kg;
}

/** Read the box's weight once and keep it. One query, the first time only. */
export async function loadHold(boatId) {
  if (!boatId) return 0;
  if (holdKg.has(boatId)) return holdKg.get(boatId);
  const r = await query('SELECT COALESCE(SUM(kg), 0)::real AS kg FROM boat_hold WHERE boat_id = $1', [boatId]);
  const kg = +Number(r.rows[0]?.kg || 0).toFixed(2);
  mirror(boatId, kg);
  return kg;
}

/** Add (or with a negative, take) weight on the running total. Sync: the caller writes the row. */
export function addHoldKg(boatId, kg) {
  const next = Math.max(0, +((holdKg.get(boatId) || 0) + kg).toFixed(2));
  mirror(boatId, next);
  return next;
}

const say = (message) => ({ type: 'output', message });
const dim = (m) => say(`<span class="text-dim">${m}</span>`);
const kgWords = (kg) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${(+kg.toFixed(1))} kg`);

// The boat a box verb means: the one you're sitting in, else your own lying at this marina.
async function boatFor(player) {
  const seated = aboard.get(player.id);
  const rows = await myBoats(player.id);
  if (seated) return rows.find((b) => b.id === seated) || { id: seated, type_id: rigs.get(player.id)?.typeId };
  const here = new Set(berthsNear(player.current_zone).map((z) => z.id));
  const mine = rows.filter((b) => here.has(b.berth_zone));
  return mine.length === 1 ? mine[0] : mine.find((b) => b.berth_zone === player.current_zone) || null;
}

/** `boat hold`: what's in the box. */
export async function boatHold(player) {
  const boat = await boatFor(player);
  if (!boat) return dim("You're not in a boat.");
  const cap = holdCapOf(boat.type_id);
  if (!cap) return dim("She hasn't got a fish box.");
  const r = await query('SELECT species, kg, item_id FROM boat_hold WHERE boat_id = $1 ORDER BY caught_at', [boat.id]);
  const total = +r.rows.reduce((s, f) => s + Number(f.kg), 0).toFixed(2);
  mirror(boat.id, total);
  if (!r.rows.length) return dim(`The box is empty. It takes ${cap} kg.`);
  const { SPECIES } = await import('../../client/shared/fish.js');
  const lines = r.rows.map((f) => `  ${SPECIES[f.species]?.name || f.species}, ${kgWords(Number(f.kg))}`);
  return say(`<span class="text-cyan">THE FISH BOX</span>\n${lines.join('\n')}`
    + `\n<span class="text-dim">${kgWords(total)} of ${cap} kg. <b>boat unload</b> at a berth takes it ashore.</span>`);
}

/** `boat unload`: at a berth, the box into your inventory. One statement moves every fish. */
export async function boatUnload(player) {
  const boat = await boatFor(player);
  if (!boat) return dim("You're not in a boat.");
  if (!holdCapOf(boat.type_id)) return dim("She hasn't got a fish box.");
  // At a berth: where she's lying now if she's out, else the row's berth.
  const at = aboard.get(player.id) ? livePosition(player.id) : null;
  const zone = at ? zoneUnder(at.x, at.y) : getZone(boat.berth_zone);
  if (!zone || !berthKind(zone)) return dim('Bring her alongside a berth first.');
  const r = await query(
    `WITH moved AS (DELETE FROM boat_hold WHERE boat_id = $1 RETURNING item_id, kg, species, caught_at)
     INSERT INTO player_inventory (id, player_id, item_id, quantity, condition, custom_data)
     SELECT gen_random_uuid()::text, $2, item_id, 1, 1.0,
            jsonb_build_object('kg', kg, 'species', species, 'caught_at', caught_at)
       FROM moved
     RETURNING custom_data`, [boat.id, player.id]);
  mirror(boat.id, 0);
  if (!r.rows.length) return dim('The box is empty.');
  emit('inventory.changed', { actor: player });
  const kg = r.rows.reduce((s, row) => s + Number(row.custom_data?.kg || 0), 0);
  const n = r.rows.length;
  return say(`You lift the lid and hand the catch up onto the deck: ${n} fish, ${kgWords(kg)}. The box smells about the same empty.`);
}

export const _test = { holdKg, mirror };
