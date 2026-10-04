// THE TANK — what a boat burns, and the one place you can put any back.
//
// `stepBoat` has been spending fuel since the day the sim shipped (the panel at
// `0.00042 + 0.0035 * pedal` a second, `texthelm.js` at the identical rate), the row has carried
// the number, the sync has clamped it one-way and `helm` has refused a dry hull with "there is a
// pump on the fuel pontoon" — against a world with no pump and no pontoon in it. A tank that only
// ever goes down is not an economy, it is a countdown on an asset somebody paid 14,500 for, and
// the countdown was about four minutes long at full throttle.
//
// ── ⚠ PRICED PER UNIT OFF THE TYPE'S OWN TANK, NEVER AS A FLAT FILL ─────────
//
// Trucking prices a fill at one flat number because "diesel is diesel — the interesting variable
// in this system is the DISTANCE between pumps". That is true of a road network and it is not true
// here: there is one pump on the whole Basin, so the interesting variable is the HULL, and a
// second hull with a bigger tank has to cost more to fill without anybody authoring a second
// price. `tank` is already on every type in flight-model.js (260 on the Rooster, 850 on a Barrow),
// so the fill is a rate times a capacity and the ladder comes out of the ladder.
//
// ⚠ AND IT IS DEARER THAN DIESEL ON PURPOSE. Trucking's own numbers work out at 0.447₵ a unit; a
// blown race boat does not drink diesel, and the marina is Ascendant and priced steeply by design
// (see the MOVE_IN note in yard.js — "the gate is your wallet rather than your standing"). At 1.15
// a Rooster's 260 units are 299₵ against a 14,500₵ hull, which is a real running cost and not a
// toll.
//
// ── ⚠ THE ROW IS THE TANK AND `rigs` IS A COPY OF IT ────────────────────────
//
// Fuel is one of the three spent fields, and `cmdBoatSync`'s clamp is deliberately ONE-WAY: a
// client may report the tank DOWN and never up. That is the whole of the anti-cheat, and it means
// a fill written only to the row is a fill the sim immediately clamps back off the moment the next
// packet arrives four times a second later. So a fill reaches every live copy of the boat there
// is — the row, the RAM rig, the text helm's own state — and the panel is told, which is what
// makes the gauge move on the same beat the credits do.

import { registerAction } from '../../server/engine/actions.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { surfaceAt } from '../flight/state.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { aboard, berthsNear, myBoats, pickBoat } from './yard.js';
import { conning } from './texthelm.js';
import { rigs } from './index.js';

// ── TUNING ───────────────────────────────────────────────────────────────────

/** Credits per unit of marine fuel. One number; the tank size does the rest. */
export const FUEL_PER_UNIT = 1.15;
/** The tank of a type with none authored — the Rooster's, so a new hull is never free to fill. */
const DEFAULT_TANK = 260;

/** What a full tank of this type costs, in credits. */
export function tankPrice(typeId) {
  return Math.round((TYPES[typeId]?.tank || DEFAULT_TANK) * FUEL_PER_UNIT);
}

/**
 * Does this zone sell marine fuel?
 *
 * ⚠ ONE FLAG, AND IT IS NOT `truck_fuel`. A diesel pump on a forecourt and a fuel float on a
 * pontoon are the same trade and completely different places, and there is no route by which a
 * hull reaches a forecourt — so sharing the flag would only make every fuel yard in the basin
 * claim to sell something no boat can get to it to buy.
 */
export function boatFuelAt(zone) {
  // ⚠ IT TAKES A ZONE OR THE SHAPE A HOOK HANDS YOU, AND THOSE ARE NOT THE SAME THING. The price
  // pylon gathers `fuel.prices` with `{ id: cell.id }` and nothing else — no flags at all — so a
  // contributor that read `zone.flags` off the argument would work perfectly for `examine`, answer
  // nothing for the sign out the windscreen, and say not one word about why. Both other
  // contributors on that hook make this same move for this same reason.
  const z = zone && zone.flags ? zone : (zone?.id ? getZone(zone.id) : null);
  return !!z?.flags?.boat_fuel;
}

// ── ALONGSIDE ────────────────────────────────────────────────────────────────
//
// ⚠ A FUEL BERTH SELLS TO THE WATER BESIDE IT, NOT TO ITS OWN DECK. A hull lies alongside the
// pylons; it does not park on top of the float. So a `fuel_dock` tile serves the one water tile on
// its pylon side, and `boatFuelAt` (which the price pylon reads) still answers for the deck, where
// the board stands. An older fuel float of any other building type is still served on the tile.
//
// ⚠ THE SIDE IS DERIVED FROM THE ENTRANCE AND NEVER AUTHORED: 90 degrees counter-clockwise of it on
// the compass, a south entrance putting the pylons EAST. The GLASS arm (windshield.js, case
// 'fuel_dock') draws the pylons on its local +X by exactly this rule, and an arm cannot be handed a
// per-tile flag because its mesh is shared by every tile drawing the model — so this function and
// that arm are the two halves of one decision.
const CCW = { south: 'east', east: 'north', north: 'west', west: 'south' };
const STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const BEARING = { north: 0, east: 90, south: 180, west: 270 };
export function fuelSideOf(zone) {
  const f = zone?.flags;
  if (!f?.boat_fuel || f.building_type !== 'fuel_dock') return null;
  return CCW[f.entrance] || 'east';
}
// ⚠ THE FLOAT'S OWN TILE COUNTS AS WELL. A hull tied up at the fuel float has `berth_zone` on the
// float itself (that is what `disembark` alongside writes), and she is lying against its pumps; the
// first cut answered false for that tile, so `fuel` told somebody standing on the float that there
// was no pump where their boat was.
export function fuelServesAt(zone) {
  const z = zone && zone.flags ? zone : (zone?.id ? getZone(zone.id) : null);
  if (!z) return false;
  if (z.flags?.boat_fuel) return true;
  if (!(z.grid_x || z.grid_y)) return false;
  for (const [dir, [sx, sy]] of Object.entries(STEP)) {
    // The neighbour that would have to be pointing back at us lies on the OPPOSITE side.
    const cell = surfaceAt(z.grid_x - sx, z.grid_y - sy);
    const n = cell?.id ? getZone(cell.id) : null;
    if (n && fuelSideOf(n) === dir) return true;
  }
  return false;
}

// ── THE BOX A HULL LIES IN ───────────────────────────────────────────────────
//
// ⚠ ALONGSIDE IS MEASURED FROM THE PUMPS, NOT READ OFF A TILE. The deck's pylon face is 0.38 of a
// tile from its middle and the tile boundary is at 0.5, so a hull lying right against the pumps
// (her centre within a beam of the face, which is where the seat's fender stops her) is on the
// float's own tile. The tile rule sold fuel only on the NEXT tile, so the one place a skipper
// would actually stop to fill up was refused, and stopping further out was accepted.
//
// So the berth is a box in world tiles: centred `off` out from the deck's middle on the pylon side,
// its long axis along the deck edge. The seat draws exactly this box (helm.js `berthMarksNear`)
// and `fuelAlongside` accepts the box plus `SLACK` all round and everything between it and the
// deck, so a box the seat shows green is one this file accepts.
export const FUEL_BOX = { off: 0.66, hl: 0.42, hw: 0.26 };
const SLACK = 0.15;

/** The drawn berth beside a fuel float's pumps, or null for anything that is not one. */
export function fuelBox(zone) {
  const side = fuelSideOf(zone);
  if (!side || !(zone.grid_x || zone.grid_y)) return null;
  const [nx, ny] = STEP[side];
  return { kind: 'fuel', id: zone.id, x: zone.grid_x + nx * FUEL_BOX.off, y: zone.grid_y + ny * FUEL_BOX.off,
    // The long axis runs along the deck edge, a quarter turn off the way the pumps face.
    hdg: (BEARING[side] + 270) % 360, hl: FUEL_BOX.hl, hw: FUEL_BOX.hw };
}

/**
 * The fuel float a hull at world (x, y) is lying alongside, or null.
 *
 * ⚠ SYNC AND CHEAP, because `svcTick` asks it four times a second per helmsman: nine `surfaceAt`
 * reads and arithmetic. An older float of any other building type still serves its own tile.
 */
export function fuelAlongside(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rx = Math.round(x), ry = Math.round(y);
  // The diagonals too: the slack runs past the half tile along the deck, into the next row.
  for (const [sx, sy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cell = surfaceAt(rx + sx, ry + sy);
    const z = cell?.id ? getZone(cell.id) : null;
    if (!z?.flags?.boat_fuel) continue;
    const side = fuelSideOf(z);
    if (!side) { if (!sx && !sy) return z; continue; }
    const [nx, ny] = STEP[side];
    const dx = x - z.grid_x, dy = y - z.grid_y;
    const across = dx * nx + dy * ny, along = Math.abs(dy * nx - dx * ny);
    if (across >= 0 && across <= FUEL_BOX.off + FUEL_BOX.hw + SLACK && along <= FUEL_BOX.hl + SLACK) return z;
  }
  return null;
}

/**
 * How much a request actually buys — the shape of trucking's `pumpClamp`, with this file's price.
 *
 * ⚠ THE BALANCE IS A CLAMP AND NEVER A REFUSAL, for that function's own stated reason: refusing
 * the whole transaction for being short is how you strand somebody who had enough to get home.
 * Here it is worse than stranding, because the thing you are short of fuel in does not float to
 * anywhere useful on its own.
 */
export function fuelClamp(credits, fuel, want, typeId) {
  const full = tankPrice(typeId);
  const take = Math.max(0, Math.min(
    Number.isFinite(want) ? Math.max(0, want) : 1,
    1 - Math.max(0, Math.min(1, Number(fuel ?? 1))),
    (credits || 0) / Math.max(1, full),
  ));
  return { take, cost: Math.round(take * full) };
}

// ── THE FILL ─────────────────────────────────────────────────────────────────

/**
 * Put fuel in a boat, everywhere she is currently represented.
 *
 * ⚠ THREE PLACES, AND MISSING ANY ONE OF THEM IS SILENT. The row is what survives a restart; the
 * `rigs` record is what `vehicle.contacts` publishes and what `cmdBoatSync`'s one-way clamp
 * compares the client against; the `conning` state is the text rung's own tank. A fill that
 * reached only the row would be undone by the next sync packet, and a fill that reached only RAM
 * would be gone at the next flush.
 */
async function pourInto(player, boat, take) {
  const next = Math.max(0, Math.min(1, Number(boat.fuel ?? 0) + take));
  await query('UPDATE boats SET fuel = $2 WHERE id = $1', [boat.id, next]);
  const rig = rigs.get(player.id);
  if (rig && rig.boatId === boat.id) rig.fuel = next;
  const c = conning.get(player.id);
  if (c && c.boatId === boat.id) { c.fuel = next; c.said.fuel = 0; }
  // The panel's gauge, on the same beat as the credits. `boat_fuel` is a thin push rather than a
  // whole context: the seat is already painting and only one number moved.
  sendToPlayer(player.id, { type: 'boat_fuel', boatId: boat.id, fuel: next });
  return next;
}

const say = (message) => ({ type: 'output', message });
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v ?? 0))) * 100);

/**
 * Which boat a fill means, and whether there is a pump where she is.
 *
 * ⚠ THE PUMP IS TESTED AT THE BOAT AND NOT AT THE PLAYER, and that is the one decision in this
 * file worth arguing about. You fuel a hull where the hull is: sitting in her at the float, you
 * and she are on the same tile; standing in the Dock Hall with her tied up outside, she is at the
 * pump and you are two steps from it, which is a hose. Asked at the PLAYER it would refuse a
 * helmsman whose `current_zone` is still the room they embarked from — which is every helmsman,
 * because taking the seat deliberately does not move your body.
 */
async function resolveFill(player, want) {
  const seatedId = aboard.get(player.id);
  const rows = await myBoats(player.id);
  if (!rows.length) return { none: true };

  // Aboard one? That is the one you mean, whatever you typed.
  if (seatedId) {
    const boat = rows.find((b) => b.id === seatedId);
    if (boat) return { boat };
  }
  const pick = pickBoat(rows, want);
  if (pick.boat) return { boat: pick.boat };
  return pick;
}

registerAction({
  type: 'BOAT_FUEL',
  validate: ({ actor }) => (actor ? null : 'nobody there'),
  // ⚠ `null` MEANS "NOT MY QUESTION", NEVER "NO". Both routers into this action (trucking's `fuel`
  // and flight's `refuel`) read a null as permission to carry on to their own answer, so every
  // refusal that is genuinely about a boat has to be a real reply — see the same rule on
  // BOAT_EMBARK in yard.js.
  handler: async ({ actor: player, params = {} }) => {
    const want = String(params.want || '').trim();
    const found = await resolveFill(player, want);
    if (found.none) return null;                       // owns no boat — not a question about boats
    if (found.miss) return null;                       // named something that is not a boat of theirs
    if (found.ambiguous) {
      return say(`<span class="text-dim">Which one? ${found.ambiguous.map((b) => b.name || TYPES[b.type_id]?.name).join(', ')}.</span>`);
    }
    const boat = found.boat;
    const name = boat.name || TYPES[boat.type_id]?.name || 'she';

    // ── ⚠ YOU HAVE TO BE WHERE SHE IS, AND THAT GATE COMES FIRST ────────────
    //
    // Without it this is a remote fill: a driver standing at Flash Point Fuel on the other side of
    // the city, who happens to own a boat tied up at the float, types `fuel` meaning the truck
    // under their hand and tops up a hull four hundred tiles away instead — because the only thing
    // the old test asked was whether there was a pump where the BOAT was. Being near her is also
    // what makes the router above safe: away from a marina this answers null, and `fuel` goes on
    // meaning diesel everywhere it has ever meant diesel.
    const seated = aboard.get(player.id) === boat.id;
    const near = seated || berthsNear(player.current_zone).some((z) => z.id === boat.berth_zone);
    if (!near) return null;

    // ⚠ UNDER WAY, SHE IS WHERE THE HULL IS, NOT WHERE SHE WAS BERTHED. `berth_zone` is the slot she
    // came out of, so a helmsman who brought her alongside the float was told there was no pump —
    // at the pump. The live position answers it, against the box (`fuelAlongside`) rather than a
    // tile, and she has to have stopped: nobody fuels a boat going past the float at forty.
    const { livePosition } = await import('./adrift.js');
    const live = seated ? livePosition(player.id) : null;
    if (live && live.speed > 2) return say(`<span class="text-dim">Bring ${name} to a stop alongside first.</span>`);
    const atPump = live ? !!fuelAlongside(live.x, live.y) : fuelServesAt(boat.berth_zone ? getZone(boat.berth_zone) : null);
    if (!atPump) {
      // ⚠ A DRY HULL GETS TOLD THE WAY OUT. "Bring her alongside the fuel float" is a fine
      // instruction to somebody with fuel and a useless one to somebody with none, and this is the
      // verb they will reach for first when the engine stops — so it is the one place `tow` has to
      // be mentioned, or the only route out of a stranding is a word nobody has been told.
      const dry = Number(boat.fuel ?? 1) <= 0.005;
      return say(`<span class="text-dim">There is no pump where ${name} is lying. Bring her alongside the pumps at the fuel berth.`
        + (dry ? ' On what, though: she is dry. Somebody will come out for her: <b>tow</b>.' : '') + '</span>');
    }

    const room = 1 - Math.max(0, Math.min(1, Number(boat.fuel ?? 1)));
    if (room < 0.02) return say(`<span class="text-dim">${name} is full.</span>`);

    const full = tankPrice(boat.type_id);
    const { take, cost } = fuelClamp(player.credits, boat.fuel, room, boat.type_id);
    if (take < 0.01) {
      return say(`<span class="text-dim">You cannot cover so much as a splash. A tank is ₵${full.toLocaleString()}.</span>`);
    }

    // Fuel first, money second — trucking's rule, and for its reason: a failed write must never
    // bill for a fill that did not happen.
    const next = await pourInto(player, boat, take);
    await adjustCredits(player, -cost, query, 'boat fuel');

    return say(next >= 0.995
      ? `<span class="item-grant">The nozzle kicks off in your hand. ${name} is full. ₵${cost.toLocaleString()}.</span>`
      : `<span class="item-grant">₵${cost.toLocaleString()} of it goes in, and that is all you have. ${name} is at ${pct(next)}%.</span>`);
  },
});

// ── THE BOARD ────────────────────────────────────────────────────────────────
//
// `fuel.prices` is the forecourt plugin's gather hook, and its rule is quoted here rather than
// worked around: a price on a board is never a number that plugin knows, because three systems
// already charge for fuel and none of them agrees what a unit is. This is the fourth, answering
// with the number it will actually take off you.
//
// ⚠ SYNC BY CONTRACT. The map window derives ~5,300 cells a snapshot and the pylon's rows come
// through `gatherHookSync`, so a contributor that turns `async` keeps working for `examine` and
// silently disappears from the sign out the windscreen.
export function fuelPrices(zone) {
  if (!boatFuelAt(zone)) return undefined;
  const full = tankPrice('hydro');
  return {
    grade: 'MARINE',
    unit: 'tank',
    price: full,
    // ⚠ DERIVED FROM THE SAME CONSTANT IT CHARGES BY, never written out — the fuelstation README's
    // own rule, because `each` is a PRESENTATION of one number rather than a second entry of it.
    each: FUEL_PER_UNIT,
    note: 'race fuel, by the unit: a Rooster takes 260 of them',
  };
}

export const _test = { tankPrice, boatFuelAt, fuelClamp, FUEL_PER_UNIT, fuelBox, fuelAlongside, FUEL_BOX, SLACK };
