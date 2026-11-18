// SCUTTLE: wrecking an aircraft somebody left out in the open.
//
// A craft parked anywhere but a hangar bay stays where it was left, across logouts and restarts
// (the row keeps parked_zone_id; access.js seeds the open-tile index from it at boot). Out there it
// can be taken (the shared lock rule in vehicle-access.js) and it can be wrecked, with this verb.
// A craft put away in a hangar (`hangar_id` set) isn't on the index, so nothing here reaches it:
// flying her back to a field with storage and putting her away is the only protection.
//
// Each go knocks DAMAGE_PER_GO off the airframe, more with Brawn. At damage 1 she's a wreck:
// `is_wreck`, `crashed_at` stamped, and `flight.crashed` fired so the wreck sweep gives the owner
// the usual salvage window before clearing her. A stranger doing it is vandalism, on the ordinary
// witness roll. Not a hot path: a typed verb, so it reads the row.

import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { parkedIn, noteLock, isLocked } from '../../server/engine/vehicle-access.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { liveAircraft } from './state.js';
import { unindexAircraft } from './access.js';

export const DAMAGE_PER_GO = 0.25;

/** How much one go takes off. Pure, so regress can pin it. */
export const scuttleDamage = (brawn) => DAMAGE_PER_GO + Math.max(0, (Number(brawn) || 0) - 3) * 0.02;

/** Difficulty of springing a parked craft's latch (Security). */
export const JIMMY_DIFF = 6;

// The craft on this tile the verb means, from the open-tile index (RAM). { v, live } or { err }.
function pickParked(args, player, verb, mineToo) {
  if (player.aircraftId) return { err: { type: 'emote', message: 'Climb out first.' } };
  if ((player.posture || 'standing') !== 'standing') return { err: { type: 'emote', message: 'You need to be on your feet for that.' } };
  const word = String(args?.join ? args.join(' ') : args || '').trim().toLowerCase();
  const here = parkedIn(player.current_zone).filter((v) => v.kind === 'aircraft' && (mineToo || v.ownerId !== player.id));
  if (!here.length) return { err: { type: 'emote', message: "There's no aircraft parked out here for that. Anything in a hangar is behind a locked door." } };
  const list = word ? here.filter((v) => v.id.toLowerCase() === word || v.name.toLowerCase().includes(word) || (v.words || []).includes(word)) : here;
  if (!list.length) return { err: { type: 'emote', message: "There's no aircraft like that parked here." } };
  if (list.length > 1) return { err: { type: 'output', message: `Which one? ${list.map((v) => `<b>${v.name}</b> (${verb} ${v.id})`).join(', ')}` } };
  const v = list[0];
  const live = liveAircraft.get(v.id);
  if (live?.occupants?.size) return { err: { type: 'emote', message: `Somebody's aboard the ${v.name}.` } };
  return { v, live };
}

// `jimmy <aircraft>`: spring the canopy latch on somebody else's parked craft, so `embark` takes
// her. Opening it is the whole job; the theft is charged when you climb in and go (vehicle.taken).
async function cmdJimmy(args, raw, player, broadcast) {
  const { v, live, err } = pickParked(args, player, 'jimmy', false);
  if (err) return err;
  if (!isLocked(live?.row?.custom_data ?? { locked: v.locked })) return { type: 'emote', message: `The ${v.name} isn't locked. <b>embark ${v.name}</b>.` };
  const chk = await skillCheck(player, 'security', JIMMY_DIFF);
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} works at the canopy latch of the ${v.name}.` }, player.id);
  if (!chk.success) return { type: 'emote', message: `The ${v.name}'s latch won't give.` };
  const { rowCount } = await query(
    `UPDATE aircraft SET custom_data = jsonb_set(COALESCE(custom_data,'{}'::jsonb), '{locked}', 'false'::jsonb, true)
      WHERE id=$1 AND is_wreck=0 AND hangar_id IS NULL AND parked_zone_id=$2`, [v.id, player.current_zone]);
  if (!rowCount) { unindexAircraft(v.id); return { type: 'emote', message: `The ${v.name} isn't there any more.` }; }
  if (live) live.row.custom_data = { ...(live.row.custom_data || {}), locked: false };
  noteLock('aircraft', v.id, false);
  awardSkillUse(player.id, 'security', chk.margin).catch(() => {});
  return { type: 'emote', message: `The ${v.name}'s latch pops. <b>embark ${v.name}</b> and she's yours, for as long as nobody catches you.` };
}

// `scuttle <aircraft>`: wreck a craft parked out in the open, your own included.
async function cmdScuttle(args, raw, player, broadcast) {
  const { v, live, err } = pickParked(args, player, 'scuttle', true);
  if (err) return err;

  const hit = scuttleDamage(player.stat_brawn);
  const { rows: [row] } = await query(
    `UPDATE aircraft a SET damage = LEAST(1, COALESCE(a.damage,0) + $2) FROM aircraft_types t
      WHERE t.id = a.type_id AND a.id=$1 AND a.is_wreck=0 AND a.airborne=0 AND a.hangar_id IS NULL AND a.parked_zone_id=$3
      RETURNING a.damage, a.owner_id, a.rental, a.type_id, t.name tname`, [v.id, hit, player.current_zone]);
  if (!row) { unindexAircraft(v.id); return { type: 'emote', message: `The ${v.name} isn't there any more.` }; }
  const stranger = row.owner_id !== player.id;
  if (stranger) {
    dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'vandalism', zoneId: player.current_zone } }).catch(() => {});
  }
  if (live) live.row.damage = row.damage;

  if (row.damage < 1) {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} goes at the ${v.name}, smashing glass and tearing at panels.` }, player.id);
    return { type: 'emote', message: `You smash what you can reach on the ${v.name}. She's ${Math.round(row.damage * 100)}% wrecked.` };
  }
  const at = Date.now();
  await query(
    `UPDATE aircraft SET is_wreck=1, damage=1, engine_on=0, throttle=0,
       custom_data = (COALESCE(custom_data,'{}'::jsonb) - 'aloft') || jsonb_build_object('crashed_at', $2::bigint)
     WHERE id=$1`, [v.id, at]);
  if (live) {
    const { aloft, ...cd } = live.row.custom_data || {};
    Object.assign(live.row, { is_wreck: 1, damage: 1, engine_on: 0, throttle: 0, custom_data: { ...cd, crashed_at: at } });
  }
  unindexAircraft(v.id);
  // The crash event: the wreck sweep starts her clock, and insurance pays the owner's hull claim
  // when somebody else did it (`combat` is the insurer's word for "not your fault").
  emit('flight.crashed', {
    aircraftId: v.id, ownerId: row.owner_id, typeId: row.type_id, typeName: row.tname, reason: 'scuttled',
    wreckZone: player.current_zone, rental: !!row.rental, combat: stranger, scuttledBy: player.id,
  });
  broadcast(player.current_zone, { type: 'zone_event', message: `<span class="text-red">${player.handle} puts the last of the ${v.name} out of commission. She's a wreck.</span>`, refresh: true }, player.id);
  return { type: 'emote', message: `<span class="text-red">The ${v.name} sags onto her gear. She's a wreck now.</span>`, refresh: true };
}

export const commands = { scuttle: cmdScuttle, jimmy: cmdJimmy };
