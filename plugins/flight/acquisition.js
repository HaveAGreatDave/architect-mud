// Flight — acquisition & fuel. Charter (rent) and buy aircraft at a field's
// dealer/charter desk; refuel against the field's stocked fuel types. The
// soft-graduated access the blueprint calls for is purely economic: anyone can
// charter a Mayfly, nobody can afford a Leviathan early.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, liveAircraft, persist, pushHud, sendToPlayer, REFUEL_PRICE_PER_UNIT, effStats, fieldFor as fieldOf, inHangarInterior, rentalOpFee, vtolOnlyField, acquirableTypes, airfieldOf, fieldName } from './state.js';
import { allExits } from '../../server/engine/exits.js';
import { getMinimapData, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { emit } from '../../server/engine/events.js';
import { sendToZone } from '../../server/engine/messaging.js';
// `buy` belongs to commerce (shopping); flight wins it by load order (manifest
// `after`) and delegates back unless you're buying an aircraft at a dealer field.
import { commands as commerceCommands } from '../commerce/index.js';

const MAX_OWNED = 8;   // anti-clutter cap per player


// Fuel types a field stocks — empty means it sells none.
//
// This used to read the ramp, then FALL BACK to the walk-in hangar interior, because
// the bowser could be declared on either tile ("lashed to the deck" at the Echelon).
// That fallback was the smear, not the fiction: it let the Echelon end up with a
// fuels list on its interior and no fuel flag on its ramp while Solenne carried one
// on both, and nothing could tell you which was intended. Fuel is a fact about the
// FIELD, so it is one column now and there is nothing to fall back to.
export function fieldStocks(zone) {
  return airfieldOf(zone)?.fuels || [];
}

// A field's acquirable roster — see state.acquirableTypes (shared with the
// hangar-bay lot so the two can't drift). `kind` doesn't affect the roster today;
// it's kept for the call signature.
async function listTypes(kind, field) {
  return acquirableTypes(field);
}

function typeLine(t, kind) {
  const price = kind === 'buy' ? `${t.price_buy}₵` : `${t.price_rent_hourly}₵/hr`;
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

// The step from the ramp into the hangar: the field's own exit toward its
// hangar building — the facade the interior hangs off, or the interior itself
// for a directly-linked field. Returns null when no such exit is adjacent
// (guidance then falls back to a generic "step inside").
function hangarEntryDir(field) {
  const interiorId = field.flags?.hangar_interior_zone;
  const facadeId = getZone(interiorId)?.parent_zone;
  for (const e of allExits(field))
    if (e.target === interiorId || e.target === facadeId) return e.dir;
  return null;
}

// Walk the player off the ramp and up to the desk inside the walk-in hangar.
// A plain teleport with its own flavour rather than the TELEPORT action's
// "vanishes/appears" pair — this is a few paces across the apron, not a warp.
// Returns false when there's nothing to walk into (no interior zone loaded).
async function walkIntoHangar(player, field) {
  const dest = getZone(field.flags.hangar_interior_zone);
  if (!dest) return false;
  const from = player.current_zone;
  if (from) {
    removePlayerFromZone(player.id, from);
    sendToZone(from, { type: 'zone_event', message: `${player.handle} walks off toward the hangar.`, refresh: true }, player.id);
  }
  addPlayerToZone(player.id, dest.id);
  player.current_zone = dest.id;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [dest.id, player.id]);
  sendToZone(dest.id, { type: 'zone_event', message: `${player.handle} comes in off the ramp.`, refresh: true }, player.id);
  emit('zone.entered', { actor: player, zone: dest.id, from });
  sendToPlayer(player.id, { type: 'move', message: await describeZone(dest, player), zone: dest.id,
    minimap: getMinimapData(dest.id, 8, player) });
  sendToPlayer(player.id, { type: 'output', message: '<span class="text-dim">You cross the apron and step in out of the wind, up to the desk.</span>' });
  return true;
}

async function acquire(args, raw, player, kind) {
  const field = fieldOf(player);
  const desk = kind === 'buy' ? 'dealer' : 'rental';
  if (!airfieldOf(field)?.[desk])
    return { type: 'emote', message: `There's no ${kind === 'buy' ? 'aircraft dealer' : 'rental desk'} here.` };
  // The desk is INSIDE the hangar. Rather than refuse someone standing out on the
  // ramp (which is exactly where you are after a landing rollout, and where the
  // hangar-bay panel's own Buy/Rent buttons fire from), walk them in and serve
  // them. Refusing here was a dead end you could only escape by guessing a
  // compass step; the counter is a few paces away either way.
  if (field.flags.hangar_interior_zone && !inHangarInterior(player)) {
    // Strapped into a cockpit is the one case we can't walk them out of.
    if (player.aircraftId) {
      const dir = hangarEntryDir(field);
      const how = dir ? `head <b>${dir}</b> into the hangar` : `step into the hangar off the ramp`;
      return { type: 'emote', message: `The ${kind === 'buy' ? 'dealer' : 'rental'} desk is inside — <b>disembark</b> and ${how}.` };
    }
    await walkIntoHangar(player, field);
  }

  const types = await listTypes(kind, field);
  const wanted = (args[0] || '').toLowerCase();
  if (!wanted) {
    const note = vtolOnlyField(field) ? ' <span class="text-dim">(helipad — VTOL only)</span>' : '';
    const lines = types.map(t => '· ' + typeLine(t, kind));
    return { type: 'output', message: `<span class="text-cyan">${kind === 'buy' ? 'FOR SALE' : 'FOR RENT (self-flown)'} at ${fieldName(field)}:</span>${note}\n${lines.join('\n')}` };
  }
  const t = types.find(x => x.id === wanted || x.name.toLowerCase() === wanted || x.id.endsWith(wanted));
  if (!t) return { type: 'emote', message: `They don't ${kind} a "${wanted}" here. Type <b>${kind}</b> to see the list.` };

  const price = kind === 'buy' ? t.price_buy : t.price_rent_hourly;
  if ((player.credits || 0) < price) return { type: 'emote', message: `That's ${price}₵ — you're short.` };
  if (await ownedCount(player.id, kind === 'buy') >= MAX_OWNED) return { type: 'emote', message: kind === 'buy'
    ? 'You already own the most aircraft you can. Sell or scrap one before buying another.'
    : "You've got too many aircraft out as it is. Return or scrap one first." };

  player.credits -= price;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);

  const id = `aircraft_${kind}_${player.id.slice(0, 6)}_${randomUUID().slice(0, 8)}`;
  const tailNum = `${kind === 'buy' ? '' : 'R-'}${(player.handle || 'PLT').slice(0, 3).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  // A rental remembers the hangar/operator it came from so the cockpit registration certificate
  // can name it as the registered operator, even after the plane's flown off to another field.
  const customData = kind === 'rent' ? { operator: fieldName(field) } : {};
  await query(
    `INSERT INTO aircraft (id,type_id,name,owner_id,map_id,grid_x,grid_y,altitude_band,heading,parked_zone_id,fuel,engine_temp,rental,custom_data)
     VALUES ($1,$2,$3,$4,'map_world',$5,$6,'ground','n',$7,$8,20,$9,$10)`,
    [id, t.id, tailNum, player.id, field.grid_x, field.grid_y, field.id, Math.round((await typeCap(t.id)) * 0.5), kind === 'buy' ? 0 : 1, JSON.stringify(customData)]
  );
  if (kind === 'buy') {
    // Point-of-sale insurance offer as an in-browser accept/decline popup (server
    // { type:'confirm' } → showConfirmDialog): confirm binds cover via `insurebind`,
    // cancel declines. Premium mirrors the insurance plugin's 15%-of-value rate for a
    // clean (no prior claims) buyer, so the number in the offer matches what binds.
    const premium = Math.max(1, Math.round(t.price_buy * 0.15));
    sendToPlayer(player.id, {
      type: 'confirm',
      title: '📄 Halcyon Assurance',
      prompt: `Cover your new ${t.name} before her first flight? The premium is ${premium}₵ for 30 days; a covered write-off pays out most of her value, less a small excess. Decline and an uninsured total loss is entirely on you.`,
      confirmLabel: `Insure (${premium}₵)`,
      command: `insurebind ${id}`,
    });
    return { type: 'output', message: `<span class="item-grant">Sold. A brand-new <b>${t.name}</b> (${tailNum}) is towed onto the ramp — it's yours. <b>embark</b> her. <span class="text-dim">You own her now: you buy your own fuel and pay for your own <b>repair</b>s (DIY, or the hangar does it right for more).</span></span>\n<span class="msg-system">📄 <b>HALCYON ASSURANCE</b> is offering cover — accept it in the popup, or <span class="action-link" data-action="cmd" data-cmd="insurebind ${id}">insure her now</span> later. <span class="text-dim">An uninsured write-off is a total loss.</span></span>` };
  }
  return { type: 'output', message: `<span class="item-grant">Rented a <b>${t.name}</b> (${tailNum}), half a tank, parked and ready. <b>embark</b> her and fly it yourself. <span class="text-dim">Flat desk fee ${price}₵ paid; the meter then runs while you're airborne — ~${rentalOpFee(t)}₵ per 30 min for gas &amp; upkeep. Maintenance is on the desk, so just bring her back.</span></span>` };
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
  if ((player.credits || 0) < cost) return { type: 'emote', message: `Fuel runs ${REFUEL_PRICE_PER_UNIT}₵/unit — you can't cover ${cost}₵.` };
  player.credits -= cost;
  live.row.fuel = Math.min(cap, live.row.fuel + want);
  live.starving = false;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await persist(live);
  pushHud(live);
  return { type: 'output', message: `You pump ${Math.round(want)} units of ${live.type.fuel_type} for ${cost}₵. Tank: ${Math.round(live.row.fuel)}/${Math.round(cap)}.`,
    player_update: { credits: player.credits } };
}

// Refuel a PARKED, owned aircraft at the field without boarding it — the ramp-side
// twin of refuelAt, driven by the room examine-menu's "refuel" link. Same pump price
// and fuel-type gate; writes straight to the row (and the live registry if it happens
// to still be loaded, e.g. just landed).
export async function refuelParked(player, craftId) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Head to the airfield to refuel.' };
  const { rows } = await query(
    `SELECT a.id, a.owner_id, a.parked_zone_id, a.fuel, a.custom_data, t.fuel_capacity, t.fuel_type, t.name tname
       FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1`, [craftId]);
  if (!rows.length) return { type: 'emote', message: 'No such aircraft here.' };
  const a = rows[0];
  if (a.owner_id !== player.id) return { type: 'emote', message: "That's not your aircraft to fuel." };
  if (a.parked_zone_id !== field.id) return { type: 'emote', message: 'That aircraft is parked at a different field.' };
  const stocks = fieldStocks(getZone(field.id));
  if (!stocks.length) return { type: 'emote', message: 'No fuel service at this field.' };
  if (!stocks.includes(a.fuel_type))
    return { type: 'emote', message: `This field pumps ${stocks.join('/')}, but the ${a.tname} runs on ${a.fuel_type}. Find it elsewhere.` };
  const cap = a.fuel_capacity || 1;
  const need = cap - a.fuel;
  if (need <= 0.5) return { type: 'emote', message: `The ${a.tname}'s tank is already full.` };
  const cost = Math.ceil(need * REFUEL_PRICE_PER_UNIT);
  if ((player.credits || 0) < cost) return { type: 'emote', message: `Topping her off is ${cost}₵ — you're short.` };
  player.credits -= cost;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  const live = liveAircraft.get(craftId);
  if (live) { live.row.fuel = cap; live.starving = false; await persist(live); }
  else await query('UPDATE aircraft SET fuel=$1 WHERE id=$2', [cap, craftId]);
  return { type: 'output', message: `You top off the ${a.tname} with ${Math.round(need)} units of ${a.fuel_type} for ${cost}₵. Full tank.`,
    player_update: { credits: player.credits } };
}

// `buy` router: at an aircraft dealer, `buy` (no arg) lists the roster and
// `buy <type>` purchases; anywhere else it's ordinary shopping → commerce.
async function cmdBuy(args, raw, player, broadcast) {
  const field = fieldOf(player);
  if (airfieldOf(field)?.dealer) {
    const types = await listTypes('buy', field);
    const wanted = (args[0] || '').toLowerCase();
    if (!wanted || types.some(t => t.id === wanted || t.name.toLowerCase() === wanted || t.id.endsWith(wanted)))
      return acquire(args, raw, player, 'buy');
  }
  return commerceCommands.buy(args, raw, player, broadcast);
}

// `rent` router: at a field with a rental desk (the airfield's `rental`), `rent` lists /
// `rent <type>` rents a self-flown aircraft (owned by you, rental=1). Anywhere else
// it falls through to the engine's apartment-rent builtin (return undefined).
// Distinct from `charter` (an NPC-pilot ride, see charter.js) — a field can offer
// one without the other, e.g. Buzzard Field charters but rents nothing.
async function cmdRent(args, raw, player) {
  const field = fieldOf(player);
  if (airfieldOf(field)?.rental) {
    const types = await listTypes('rent', field);
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
