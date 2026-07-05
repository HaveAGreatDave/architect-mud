// Flight — acquisition & fuel. Charter (rent) and buy aircraft at a field's
// dealer/charter desk; refuel against the field's stocked fuel types. The
// soft-graduated access the blueprint calls for is purely economic: anyone can
// charter a Mayfly, nobody can afford a Leviathan early.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, liveAircraft, persist, pushHud, REFUEL_PRICE_PER_UNIT, effStats, fieldFor as fieldOf } from './state.js';
// `buy` belongs to commerce (shopping); flight wins it by load order (manifest
// `after`) and delegates back unless you're buying an aircraft at a dealer field.
import { commands as commerceCommands } from '../commerce/index.js';

const MAX_OWNED = 8;   // anti-clutter cap per player


// Fuel types a field stocks (defaults to all if only the legacy bool is set).
export function fieldStocks(zone) {
  const f = zone?.flags || {};
  if (Array.isArray(f.airfield_fuels)) return f.airfield_fuels;
  return f.airfield_fuel ? ['avgas', 'jet', 'biofuel'] : [];
}

async function listTypes(kind) {
  const { rows } = await query(
    "SELECT id, name, class, seats, cargo_capacity, fuel_type, price_buy, price_rent_hourly FROM aircraft_types WHERE class <> 'wreck' ORDER BY price_buy"
  );
  return rows;
}

function typeLine(t, kind) {
  const price = kind === 'buy' ? `${t.price_buy}c` : `${t.price_rent_hourly}c/hr`;
  return `<b>${t.name}</b> <span class="text-dim">(${t.class}, ${t.seats} seat${t.seats > 1 ? 's' : ''}, ${t.fuel_type})</span> — ${price} · <span class="action-link" data-action="cmd" data-cmd="${kind} ${t.id}">${kind}</span>`;
}

// Anti-clutter cap. Buying counts only aircraft you OWN outright (rental=0) so a
// pile of rentals can never block a purchase; renting counts the total so rentals
// can't be spammed without bound.
async function ownedCount(playerId, ownedOnly) {
  const sql = ownedOnly
    ? 'SELECT COUNT(*)::int n FROM aircraft WHERE owner_id=$1 AND is_wreck=0 AND rental=0'
    : 'SELECT COUNT(*)::int n FROM aircraft WHERE owner_id=$1 AND is_wreck=0';
  const { rows } = await query(sql, [playerId]);
  return rows[0]?.n || 0;
}

async function acquire(args, raw, player, kind) {
  const field = fieldOf(player);
  const flagKey = kind === 'buy' ? 'airfield_dealer' : 'airfield_charter';
  if (!field || !field.flags[flagKey])
    return { type: 'emote', message: `There's no ${kind === 'buy' ? 'aircraft dealer' : 'rental desk'} here.` };

  const types = await listTypes(kind);
  const wanted = (args[0] || '').toLowerCase();
  if (!wanted) {
    const lines = types.map(t => '· ' + typeLine(t, kind));
    return { type: 'output', message: `<span class="text-cyan">${kind === 'buy' ? 'FOR SALE' : 'FOR RENT (self-flown)'} at ${field.flags.airfield_name || field.name}:</span>\n${lines.join('\n')}` };
  }
  const t = types.find(x => x.id === wanted || x.name.toLowerCase() === wanted || x.id.endsWith(wanted));
  if (!t) return { type: 'emote', message: `They don't ${kind} a "${wanted}" here. Type <b>${kind}</b> to see the list.` };

  const price = kind === 'buy' ? t.price_buy : t.price_rent_hourly;
  if ((player.credits || 0) < price) return { type: 'emote', message: `That's ${price}c — you're short.` };
  if (await ownedCount(player.id, kind === 'buy') >= MAX_OWNED) return { type: 'emote', message: kind === 'buy'
    ? 'You already own the most aircraft you can. Sell or scrap one before buying another.'
    : "You've got too many aircraft out as it is. Return or scrap one first." };

  player.credits -= price;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);

  const id = `aircraft_${kind}_${player.id.slice(0, 6)}_${randomUUID().slice(0, 8)}`;
  const tailNum = `${kind === 'buy' ? '' : 'R-'}${(player.handle || 'PLT').slice(0, 3).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,engine_temp,rental)
     VALUES ($1,$2,$3,$4,'map_world',$5,$6,'ground','n',$7,$8,20,$9)`,
    [id, t.id, tailNum, player.id, field.grid_x, field.grid_y, field.id, Math.round((await typeCap(t.id)) * 0.5), kind === 'buy' ? 0 : 1]
  );
  return { type: 'output', message: kind === 'buy'
    ? `<span class="item-grant">Sold. A brand-new <b>${t.name}</b> (${tailNum}) is towed onto the ramp. It's yours — <b>embark</b> her.</span>`
    : `<span class="item-grant">Rented a <b>${t.name}</b> (${tailNum}), half a tank, parked and ready. <b>embark</b> her and fly it yourself — the meter's running, so bring her back in one piece.</span>` };
}

async function typeCap(typeId) {
  const { rows } = await query('SELECT fuel_capacity FROM aircraft_types WHERE id=$1', [typeId]);
  return rows[0]?.fuel_capacity || 40;
}

// ── Refuel (called by index.cmdRefuel when the player is aboard) ───────────────
export async function refuelAt(args, raw, player) {
  const live = liveAircraft.get(player.aircraftId);
  if (!live) return { type: 'emote', message: "You're not aboard an aircraft." };
  if (player.seat !== 'pilot') return { type: 'emote', message: "You're not in the pilot's seat." };
  if (live.row.airborne) return { type: 'emote', message: "You can't refuel in the air." };
  const zone = getZone(live.row.parked_zone_id);
  const stocks = fieldStocks(zone);
  if (!stocks.length) return { type: 'emote', message: 'No fuel service at this field.' };
  if (!stocks.includes(live.type.fuel_type))
    return { type: 'emote', message: `This field pumps ${stocks.join('/')}, but the ${live.type.name} runs on ${live.type.fuel_type}. Find it elsewhere.` };
  const cap = effStats(live).fuelCap;
  const need = cap - live.row.fuel;
  if (need <= 0.5) return { type: 'emote', message: 'The tank is already full.' };
  const want = args[0] ? Math.min(need, Math.max(0, parseInt(args[0], 10) || 0)) : need;
  const cost = Math.ceil(want * REFUEL_PRICE_PER_UNIT);
  if ((player.credits || 0) < cost) return { type: 'emote', message: `Fuel runs ${REFUEL_PRICE_PER_UNIT}c/unit — you can't cover ${cost}c.` };
  player.credits -= cost;
  live.row.fuel = Math.min(cap, live.row.fuel + want);
  live.starving = false;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await persist(live);
  pushHud(live);
  return { type: 'output', message: `You pump ${Math.round(want)} units of ${live.type.fuel_type} for ${cost}c. Tank: ${Math.round(live.row.fuel)}/${Math.round(cap)}.`,
    player_update: { credits: player.credits } };
}

// `buy` router: at an aircraft dealer, `buy` (no arg) lists the roster and
// `buy <type>` purchases; anywhere else it's ordinary shopping → commerce.
async function cmdBuy(args, raw, player, broadcast) {
  const field = fieldOf(player);
  if (field?.flags?.airfield_dealer) {
    const types = await listTypes('buy');
    const wanted = (args[0] || '').toLowerCase();
    if (!wanted || types.some(t => t.id === wanted || t.name.toLowerCase() === wanted || t.id.endsWith(wanted)))
      return acquire(args, raw, player, 'buy');
  }
  return commerceCommands.buy(args, raw, player, broadcast);
}

// `rent` router: at a charter field, `rent` lists / `rent <type>` rents a
// self-flown aircraft (owned by you, rental=1). Anywhere else it falls through to
// the engine's apartment-rent builtin (return undefined). Distinct from `charter`
// (an NPC-pilot ride, see charter.js).
async function cmdRent(args, raw, player) {
  const field = fieldOf(player);
  if (field?.flags?.airfield_charter) {
    const types = await listTypes('rent');
    const wanted = (args[0] || '').toLowerCase();
    if (!wanted || types.some(t => t.id === wanted || t.name.toLowerCase() === wanted || t.id.endsWith(wanted)))
      return acquire(args, raw, player, 'rent');
  }
  return undefined;   // → engine apartment-rent builtin
}

export const commands = {
  buy: cmdBuy,
  rent: cmdRent,
};
