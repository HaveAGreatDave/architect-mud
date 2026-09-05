// Flight — Phase B hazards + the airborne emergency verbs.
//
// The continuous flight tick calls rollHazards() each airborne tick (after the fuel-starvation
// check). ENGINE FIRE is a persistent escalating ladder that occupies live.hazard, cleared by
// `extinguish` (or a fuel cut); left alone it advances to a crash. WEATHER buffeting (hooked to
// the extreme-weather severity scalar) and BIRD STRIKE are one-shot per-tick events that can
// damage you. Stalls are NOT here — the continuous energy model owns them (stalledState +
// flightTick). Plus the airborne-only utility verbs (preflight, hover, spot, chart, squawk) and
// the abandon-ship verb (eject).

import { query } from '../../server/models/db.js';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { getZoneSeverity, getZonePrecip } from '../../server/engine/environment.js';
import { on } from '../../server/engine/events.js';
import { fireSpecializedAction } from '../../server/engine/specializedActions.js';
import { applyTopical } from '../../server/engine/topical.js';
import { getZonePlayers } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { carriedFluids } from './hangars.js';

// The ion storm's peak, mirrored locally off the weather-event signal so the
// hazard roll never has to reach into the weather plugin. `weather.event` fires
// once per phase transition, so this is three assignments an event, not a poll.
let empUntil = 0;
const EMP_WINDOW_MS = 90_000;
on('weather.event', ({ type, phase }) => {
  if (type === 'ion_storm' && phase === 'peak') empUntil = Date.now() + EMP_WINDOW_MS;
  else if (phase !== 'peak') empUntil = 0;
});
function empActive() { return Date.now() < empUntil; }
import {
  liveAircraft, surfaceAt, pilotOf, persist, crash, toOccupants, out, sendToZone,
  BANDS, effStats, getLivePlayer, detach, getZone, fieldFor as fieldOf, PILOT_IP,
} from './state.js';
// `eject` also belongs to broadcast (eject a cassette); flight wins it by load
// order and hands back when you're not bailing out of an aircraft.
import { commands as broadcastCommands } from '../broadcast/index.js';

function requirePilot(player) {
  const live = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!live) return { err: { type: 'emote', message: "You're not aboard an aircraft." } };
  if (player.seat !== 'pilot') return { err: { type: 'emote', message: "You're not in the pilot's seat." } };
  return { live };
}

async function hasParachute(playerId) {
  const { rows } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'parachute') LIMIT 1`,
    [playerId]
  );
  return rows.length > 0;
}

// ── The per-tick hazard roll ──────────────────────────────────────────────────
export async function rollHazards(live) {
  const a = live.row, eff = effStats(live);
  const pilot = pilotOf(live);
  const below = surfaceAt(a.grid_x, a.grid_y);

  // Escalate an active persistent hazard first.
  if (live.hazard) { await escalate(live); return; }

  // Cold start — you took off before the engines stabilised. They run hot and
  // may let go outright for the first several ticks.
  if (live.coldStart > 0) {
    live.coldStart--;
    a.engine_temp += 6;
    if (Math.random() < 0.16) {
      live.hazard = { type: 'FIRE', stage: 0 };
      toOccupants(live, '<span class="text-red">🔥 A cold cylinder seizes and the engine lets go — FIRE. You warned yourself. <b>extinguish</b> / <b>cut fuel</b>!</span>');
      return;
    }
  }

  // WEATHER buffeting — severity of the tile below, amplified with altitude.
  const severity = below ? getZoneSeverity(below.id) : 0;
  if (severity > 0.35) {
    const bandMul = 1 + BANDS.indexOf(a.altitude_band) * 0.4;
    if (pilot && Math.random() < severity * 0.4 * bandMul) {
      const chk = await skillCheck(pilot, 'piloting', 5 + Math.round(severity * 6));
      if (!chk.success) {
        a.damage = Math.min(1, a.damage + 0.06);
        a.engine_temp += 6;
        toOccupants(live, '<span class="text-amber">The air turns to concrete — a savage gust hammers the airframe and throws you off heading.</span>');
        if (a.damage >= 1) { await crash(live, 'weather'); return; }
      }
    }
  }

  // ACID RAIN — flying through the caustic downpour eats the airframe from the
  // outside in. Unlike buffeting there is no skill check to pass: you cannot
  // hand-fly your way out of chemistry. The only answers are altitude (get above
  // the cell), speed (get out of it), or the ground. It bleeds hull steadily
  // rather than spiking, so a short transit is survivable and loitering is not.
  const overflown = below ? getZonePrecip(below.id) : null;
  if (overflown?.precipType === 'acid' && overflown.precipRate > 0) {
    a.damage = Math.min(1, a.damage + 0.02 * overflown.precipRate);
    a.engine_temp += 3;
    if (!live._acidTicks || live._acidTicks % 4 === 0) {
      toOccupants(live, '<span class="text-amber">☣ The rain out here is EATING the aircraft — paint blistering off the leading edges, the airframe hissing where it lands.</span>');
    }
    live._acidTicks = (live._acidTicks || 0) + 1;
    if (a.damage >= 1) { await crash(live, 'acid'); return; }
  } else {
    live._acidTicks = 0;
  }

  // ION STORM — the pulse takes the avionics with it. This is deliberately NOT
  // damage: nothing about it will bring the aircraft down on its own. It takes
  // the instruments away and hands you the aircraft, which for most pilots is
  // considerably worse. Self-clearing, so it ends without a verb.
  if (!live.hazard && empActive() && Math.random() < 0.5) {
    live.hazard = { type: 'EMP', stage: 0 };
    toOccupants(live, '<span class="text-red">⚡ Every panel in the cockpit dies at once. Gauges, radio, nav — black. You\'re flying this thing by eye and by feel.</span>');
    return;
  }

  // BIRD STRIKE — low, slow, over inhabited ground.
  if (a.altitude_band === 'low' && below && a.throttle < 70 && Math.random() < 0.05) {
    a.damage = Math.min(1, a.damage + 0.08);
    a.engine_temp += 18;   // ingestion spikes the temp — can seed a fire
    toOccupants(live, '<span class="text-amber">⚠ BIRD STRIKE — a heavy thud, a smear on the glass, and the engine note changes.</span>');
    if (a.damage >= 1) { await crash(live, 'birdstrike'); return; }
  }

  // (Stalls are owned by the continuous energy model — a real slow/high-AoA break with its own
  // wing-drop, spin and authoritative consequences. See stalledState + flightTick. No dice-roll here.)

  // ENGINE FIRE — sustained overheat (from throttle, birds, tuning). Give one
  // OVERHEAT warning tick, then it lights.
  if (!live.hazard && a.engine_temp >= 145) {
    if (live._overheatTicks) {
      live.hazard = { type: 'FIRE', stage: 0 };
      live._overheatTicks = 0;
      toOccupants(live, '<span class="text-red">🔥 ENGINE FIRE — smoke pours back over the cockpit. <b>extinguish</b> it or <b>cut fuel</b>, fast.</span>');
    } else {
      live._overheatTicks = 1;
      toOccupants(live, '<span class="text-amber">⚠ OVERHEAT — the temp\'s in the red. Ease the throttle before it lights.</span>');
    }
  } else if (a.engine_temp < 130) {
    live._overheatTicks = 0;
  }
}

async function escalate(live) {
  const a = live.row, h = live.hazard;
  if (h.type === 'FIRE') {
    h.stage++;
    a.damage = Math.min(1, a.damage + 0.18);
    if (a.damage >= 1) { await crash(live, 'fire'); return; }
    toOccupants(live, `<span class="text-red">🔥 The fire spreads — hull ${Math.round((1 - a.damage) * 100)}%. <b>extinguish</b> / <b>cut fuel</b>!</span>`);
    return;
  }
  // EMP counts DOWN instead of up: the avionics come back on their own once the
  // boards finish rebooting. It's the one hazard you survive by waiting.
  if (h.type === 'EMP') {
    h.stage++;
    if (h.stage < EMP_HAZARD_TICKS) return;
    live.hazard = null;
    toOccupants(live, '<span class="text-cyan">The panels flicker, stutter, and come back one by one. You have instruments again.</span>');
  }
}

// ~3s per flight tick, so this is the better part of a minute flying blind.
const EMP_HAZARD_TICKS = 18;

// ── Emergency verbs ───────────────────────────────────────────────────────────
// (No `recover` verb — a stall is recovered by flying: nose down, unload, add power, and the
// continuous energy model bites and flies again. The old dice-roll STALL + skill-check recover
// retired with the banded flight path. See docs/proposals/flight-unified-model.md.)

async function cmdExtinguish(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.hazard?.type !== 'FIRE') return { type: 'emote', message: 'Nothing\'s on fire — yet.' };
  const cut = /fuel/.test(raw);
  if (cut) live.row.throttle = 0;
  const chk = await skillCheck(player, 'piloting', 5 + live.hazard.stage * 2 - (cut ? 2 : 0));
  live.row.engine_temp = Math.min(live.row.engine_temp, 120);
  if (!chk.success) return { type: 'emote', message: cut ? 'You chop the fuel but the fire\'s still lit — try again.' : 'The bottle empties and the flames gutter but hold. Again!' };
  live.hazard = null;
  // A real check just ran — pass its margin, so a fire caught late (a harder
  // difficulty, a narrower win) teaches more than an easy one. See PILOT_IP.
  await awardSkillUse(player.id, 'piloting', chk.margin);
  return { type: 'emote', message: cut
    ? '<span class="text-green">Fuel cut, the fire starves and dies. You\'re a glider now — find a field.</span>'
    : '<span class="text-green">The extinguisher smothers it. Smoke, but no more flame.</span>' };
}

async function cmdEject(args, raw, player, broadcast) {
  // Not airborne in a craft → this is a broadcast-deck cassette eject.
  const l = player.aircraftId ? liveAircraft.get(player.aircraftId) : null;
  if (!l || !l.row.airborne) return broadcastCommands.eject(args, raw, player, broadcast);
  const below = surfaceAt(l.row.grid_x, l.row.grid_y);
  const zone = below?.id || l.row.parked_zone_id || 'zone_start';
  const chute = await hasParachute(player.id);
  const wasPilot = player.seat === 'pilot';

  detach(player, { restore: true });
  player.current_zone = zone;
  getZone(zone)?.players.add(player.id);
  broadcast?.(zone, { type: 'zone_event', message: `${player.handle} drops out of the sky${chute ? ' under a snapping canopy' : ', not under a canopy'} and hits the ground.`, refresh: true }, player.id);

  if (chute) {
    out(player.id, '<span class="text-green">You punch out, the canopy cracks open, and you swing down hard but alive.</span>');
  } else {
    const p = getLivePlayer(player.id);
    if (p) { p.hp = Math.max(0, Math.floor((p.hp || 0) * 0.15) - 10); }
    out(player.id, '<span class="text-red">You bail with no chute. The ground isn\'t merciful.</span>');
    const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
    if (p && p.hp <= 0) await handlePlayerDeath(p, null, { type: 'fall', label: 'Bailed out without a parachute' });
  }
  // A pilot bailing dooms the craft — it flies on briefly, then augers in.
  if (wasPilot && l.occupants.size === 0) { await crash(l, 'abandoned'); }
  else await persist(l);
  return { type: 'noop' };
}

// ── Utility verbs ─────────────────────────────────────────────────────────────
async function cmdPreflight(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (live.row.airborne) return { type: 'emote', message: 'A little late for a walkaround.' };
  const chk = await skillCheck(player, 'piloting', 4);
  const eff = effStats(live);   // fitted tankage counts — the walkaround reads the tank she HAS
  const lines = [`<b>${live.type.name}</b> — hull ${Math.round((1 - live.row.damage) * 100)}%, fuel ${Math.round(live.row.fuel)}/${Math.round(eff.fuelCap)} ${live.type.fuel_type}.`];
  if (live.row.damage > 0.3 && chk.success) lines.push('<span class="text-amber">You find fresh damage — cracked skin, a weeping line. She\'ll fly, but she won\'t forgive much.</span>');
  else if (chk.success) lines.push('She looks honest. Controls free, no leaks, tyres up.');
  else lines.push('You give her a once-over. Looks fine — though you\'re not sure you\'d catch it if it wasn\'t.');
  return { type: 'output', message: lines.join('\n') };
}

async function cmdHover(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'You can only hover in the air.' };
  if (live.type.takeoff_mode !== 'vtol') return { type: 'emote', message: `The ${live.type.name} can't hover — it has to keep moving to stay up.` };
  live.hover = !live.hover;
  return { type: 'emote', message: live.hover
    ? 'You bring it to a hover, holding station over the ground.'
    : 'You drop the nose and let it fly forward again.' };
}

async function cmdSpot(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!live.row.airborne) return { type: 'emote', message: 'Get some altitude first — you spot from the air.' };
  const eff = await effectiveSkill(player, 'piloting');
  const radius = live.row.altitude_band === 'high' ? 4 : live.row.altitude_band === 'cruise' ? 3 : 2;
  const a = live.row;
  const finds = [];
  // Wrecks + airfields + AA within radius (senses/altitude scaled).
  const { rows: wrecks } = await query('SELECT name, grid_x, grid_y FROM aircraft WHERE is_wreck=1 AND parked_zone_id IS NOT NULL');
  for (const w of wrecks) {
    if (w.grid_x == null) continue;
    const d = Math.max(Math.abs(w.grid_x - a.grid_x), Math.abs(w.grid_y - a.grid_y));
    if (d <= radius) finds.push(`a downed <b>${w.name}</b> (${bearing(a, w)})`);
  }
  const { rows: aa } = await query('SELECT z.grid_x, z.grid_y, s.name FROM aa_sites s JOIN zones z ON z.id=s.zone_id WHERE s.active=1');
  for (const s of aa) {
    if (s.grid_x == null) continue;
    const d = Math.max(Math.abs(s.grid_x - a.grid_x), Math.abs(s.grid_y - a.grid_y));
    if (d <= radius + 1) finds.push(`<span class="text-red">${s.name}</span> (${bearing(a, s)})`);
  }
  if (eff < 3 && finds.length > 1) finds.length = 1;   // an unskilled eye misses things
  if (!finds.length) return { type: 'output', message: 'You scan the ground below. Nothing worth marking from up here.' };
  await awardSkillUse(player.id, 'piloting', PILOT_IP.ROUTINE);
  return { type: 'output', message: `<span class="text-cyan">From altitude you make out:</span>\n· ${finds.join('\n· ')}` };
}

// Crop-dusting — an ag-plane capability (the Locust; she's the one with the boom and nozzles
// modelled under the wing, and the hopper is the fat swelling of her spine). On a LOW pass the pilot opens the
// spray booms and lays a fine mist over the tile below. Flavour for now: the ground zone sees
// the pass; no entity effect yet (the hook is here to add one). Rate-limited to feel like the
// booms need to re-pressurise between runs. A duster with a hopper (type.data.hopper) must have
// liquid loaded to dust — each pass drains SPRAY_LOAD; loadhopper fills it on the ground.
const SPRAY_LOAD = 20;   // hopper units burned per dusting pass
const hopperCap = (live) => (live.type.data && live.type.data.hopper) || 0;
async function cmdSpray(args, raw, player, broadcast) {
  const { live, err } = requirePilot(player); if (err) return err;
  if (!(live.type.data && live.type.data.spray))
    return { type: 'emote', message: `The ${live.type.name} has no spray gear.` };
  if (!live.row.airborne) return { type: 'emote', message: 'Get in the air first — you dust on a low pass.' };
  if (live.row.altitude_band !== 'low')
    return { type: 'emote', message: 'Too high to dust — drop down to a <b>LOW</b> pass first.' };
  // Gate on a loaded hopper — but only for dusters that have one (cap 0 = flavour-only spray).
  const cap = hopperCap(live);
  const hop = live.row.custom_data?.hopper;
  if (cap > 0 && !(hop && hop.amount > 0))
    return { type: 'emote', message: 'The hopper\'s dry — land and <b>loadhopper</b> a liquid before you can dust.' };
  const now = Date.now();
  if (live.lastSpray && now - live.lastSpray < 2500) return { type: 'noop' };   // booms still re-pressurising
  live.lastSpray = now;
  let tail = '';
  // Read the fluid BEFORE the drain: a pass that empties the hopper still sprays
  // what was in it, and the drain below nulls `fluid_type` on the way to zero.
  const fluid = (cap > 0 && hop?.fluid_type) || null;
  if (cap > 0 && hop) {
    hop.amount = Math.max(0, hop.amount - SPRAY_LOAD);
    if (hop.amount <= 0) hop.fluid_type = null;
    await persist(live);
    tail = hop.amount > 0
      ? ` <span class="text-dim">(hopper ${Math.round(hop.amount / cap * 100)}%)</span>`
      : ' <span class="text-amber">The hopper runs dry.</span>';
  }
  const below = surfaceAt(live.row.grid_x, live.row.grid_y);
  if (below?.id) sendToZone(below.id, {
    type: 'zone_event',
    message: `<span class="text-dim">A crop-duster howls past low overhead, spray booms open, trailing a fine ${fluid === 'water' ? 'cool' : 'chemical'} mist that drifts down over ${below.name}.</span>`,
    refresh: false,
  }, player.id);

  // ── What actually lands on the people down there ──────────────────────────
  // The pass used to be flavour: the tile got a line and nobody got wet. It now
  // goes through the topical substrate, which owns two things this file must not
  // own — WHAT the fluid does (clothing-wetness registered `water`; a hopper of
  // fuel is somebody else's to claim later) and WHETHER it may land on that
  // particular person (`sprayconsent`, off by default). Both answers are the
  // substrate's, so nothing here needs to know either one.
  //
  // Flavour-only dusters (hopper cap 0) stay flavour-only: no hopper, no fluid,
  // nothing to apply. The pilot is told the shape of the result, never the names
  // — who opted out is not the sprayer's business.
  let landed = 0, passed = 0;
  if (below?.id && fluid) {
    const targets = getZonePlayers(below.id).filter(p => p.id !== player.id && !p.aircraftId);
    for (const t of targets) {
      const res = await applyTopical(t, {
        fluid, potency: 1, actor: player,
        source: 'The duster\'s booms open overhead',
        broadcast,
      });
      if (res.applied) landed++; else if (res.reason === 'no_consent') passed++;
      if (res.message) out(t.id, res.message);
    }
  }
  if (landed) tail += ` <span class="text-cyan">The mist settles over ${landed === 1 ? 'someone' : `${landed} people`} below.</span>`;
  else if (passed) tail += ' <span class="text-dim">Whoever is down there, the mist comes to nothing on them.</span>';

  return { type: 'emote', message: `<span class="text-green">You open the spray booms — a fine mist streams off the trailing edges and settles over the ground below.</span>${tail}` };
}

// Load the duster's chemical hopper from a liquid you're carrying. Any fillable container
// holding fluid works (water, fuel, a future ag-chem) — pouring empties that liquid into the
// hopper the same way generator refuel pours a jerry can into a tank, so the container comes
// back empty. One fluid type at a time; a ground job. `loadhopper [with] <container>`.
//
// TWO WAYS IN, one implementation. Aboard in the pilot's seat is the typed route. But loading
// chemical is a THING YOU DO ON THE RAMP, not something you climb into the cockpit for, and the
// hangar bench's Hopper tab operates a craft you're standing next to — so a leading craft id
// works too, exactly the way `refuel <id>` off the same panel already does. Anything that isn't
// a craft id is the container name, which is what keeps the bare typed form unchanged.
const CRAFT_ID = /^(?:aircraft_[a-z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
async function cmdLoadHopper(args, raw, player) {
  if (CRAFT_ID.test(args[0] || '')) return loadHopperParked(player, args[0], args.slice(1));
  const { live, err } = requirePilot(player); if (err) return err;
  if (!(live.type.data && live.type.data.spray))
    return { type: 'emote', message: `The ${live.type.name} has no spray gear.` };
  const cap = hopperCap(live);
  if (cap <= 0) return { type: 'emote', message: `The ${live.type.name} has no chemical hopper.` };
  if (live.row.airborne) return { type: 'emote', message: 'Pouring chemical into the hopper is a ground job — land first.' };

  const cd = live.row.custom_data || (live.row.custom_data = {});
  return pourIntoHopper(player, args, live.type.name, cap, cd, () => persist(live));
}

// The parked half of `loadhopper`: an owned craft sitting at THIS field, addressed by id.
// Mirrors refuelParked's checks (yours, here, on the ground) and then runs the identical pour.
async function loadHopperParked(player, craftId, args) {
  const field = fieldOf(player);
  if (!field) return { type: 'emote', message: 'Loading the hopper is a job for the airfield.' };
  const { rows } = await query(
    `SELECT a.id, a.owner_id, a.parked_zone_id, a.airborne, a.custom_data, t.name tname, t.data
       FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id WHERE a.id=$1`, [craftId]);
  const a = rows[0];
  if (!a) return { type: 'emote', message: 'No such aircraft here.' };
  if (a.owner_id !== player.id) return { type: 'emote', message: "That's not your aircraft to load." };
  if (a.parked_zone_id !== field.id) return { type: 'emote', message: 'That aircraft is parked at a different field.' };
  if (a.airborne) return { type: 'emote', message: `The ${a.tname} is in the air.` };
  if (!a.data?.spray) return { type: 'emote', message: `The ${a.tname} has no spray gear.` };
  const cap = a.data.hopper || 0;
  if (cap <= 0) return { type: 'emote', message: `The ${a.tname} has no chemical hopper.` };
  // Prefer the LIVE row when one exists (someone is sitting in her): writing the DB behind a
  // live aircraft's back is how the two copies drift, and persist() is the funnel that can't.
  const live = liveAircraft.get(craftId);
  const cd = live ? (live.row.custom_data || (live.row.custom_data = {})) : (a.custom_data || {});
  return pourIntoHopper(player, args, a.tname, cap, cd, () => live
    ? persist(live)
    : query(`UPDATE aircraft SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ hopper: cd.hopper }), craftId]));
}

// The pour itself, shared by both routes. `save` is how this craft's custom_data reaches
// storage — the live persist funnel or a direct row update.
async function pourIntoHopper(player, args, craftName, cap, cd, save) {
  const hop = cd.hopper || (cd.hopper = { amount: 0, fluid_type: null });
  const space = cap - (hop.amount || 0);
  if (space <= 0) return { type: 'output', message: `The ${craftName}'s hopper is already full.` };

  // Any carried fillable container holding liquid — a filter of fluid_amount>0 is exactly the
  // "must be a liquid" gate, since a fluid only exists inside a container that's been filled.
  const canName = args.join(' ').replace(/^with\s+/i, '').trim();
  const { rows: cans } = await query(
    `SELECT pi.id, pi.custom_data, i.name
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'fillable')
        AND COALESCE((pi.custom_data->>'fluid_amount')::numeric,0) > 0${canName ? ' AND i.name ILIKE $2' : ''}
      ORDER BY length(i.name) LIMIT 1`,
    canName ? [player.id, `%${canName}%`] : [player.id]);
  const can = cans[0];
  if (!can) return { type: 'emote', message: `You've nothing holding liquid to pour${canName ? ` matching "${canName}"` : ''}. Fill a container first.` };

  const fluidType = can.custom_data.fluid_type || 'water';
  if ((hop.amount || 0) > 0 && hop.fluid_type && hop.fluid_type !== fluidType)
    return { type: 'emote', message: `The hopper already holds ${hop.fluid_type} — spray it dry before loading ${fluidType}.` };

  const have = Number(can.custom_data.fluid_amount) || 0;
  const pour = Math.min(space, have);
  const left = have - pour;
  hop.amount = (hop.amount || 0) + pour;
  hop.fluid_type = fluidType;

  if (left > 0)
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ fluid_amount: left }), can.id]);
  else
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - 'fluid_amount' - 'fluid_type' - 'contaminated' WHERE id=$1`,
      [can.id]);
  await save();
  return { type: 'use', message: `You pour ${fluidType} from the ${can.name} into the ${craftName}'s hopper. <span class="text-dim">(hopper ${Math.round(hop.amount / cap * 100)}%)</span>` };
}

// The cockpit's HOPPER button, answered as data. A silent client resolve: it mutates nothing and
// returns `noop`, so it can be re-asked after every pour without printing a line into the log.
//
// It hands over the SAME can list the hangar bench's Hopper tab is built from (`carriedFluids`),
// which is the same predicate `pourIntoHopper` matches on — a button offering a can the verb
// would then refuse is worse than no button. The panel decides nothing: it draws these rows and
// sends `loadhopper with <name>`, an ordinary command a player could have typed.
async function cmdHopperBay(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  const cap = hopperCap(live);
  if (cap <= 0 || !(live.type.data && live.type.data.spray))
    return { type: 'emote', message: `The ${live.type.name} has no chemical hopper.` };
  const hop = (live.row.custom_data && live.row.custom_data.hopper) || {};
  sendToPlayer(player.id, {
    type: 'flight_hopper', craft: live.type.name,
    cap, amount: Math.round(hop.amount || 0), fluid: hop.fluid_type || null,
    airborne: !!live.row.airborne, cans: await carriedFluids(player),
  });
  return { type: 'noop' };
}

function bearing(from, to) {
  const dx = to.grid_x - from.grid_x, dy = to.grid_y - from.grid_y;
  const ns = dy < 0 ? 'N' : dy > 0 ? 'S' : '';
  const ew = dx > 0 ? 'E' : dx < 0 ? 'W' : '';
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  return `${ns}${ew || (ns ? '' : 'here')} ${dist || ''}`.trim();
}

async function cmdChart(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  const a = live.row, eff = effStats(live);
  // Nearest airfield (by chebyshev distance over coords).
  const { rows: fields } = await query(
    "SELECT id, name, grid_x, grid_y FROM zones WHERE map_id='map_world' AND flags ? 'airfield_id'"
  );
  let nearest = null, best = Infinity;
  for (const f of fields) {
    if (f.grid_x == null) continue;
    const d = Math.max(Math.abs(f.grid_x - a.grid_x), Math.abs(f.grid_y - a.grid_y));
    if (d < best) { best = d; nearest = f; }
  }
  const range = Math.floor(a.fuel / Math.max(0.1, eff.burn));
  const lines = [
    `<span class="text-cyan">— DEAD-RECKONING PLOT —</span>`,
    `Position ${a.grid_x}, ${a.grid_y} · heading ${(a.heading || 'n').toUpperCase()} · ${a.altitude_band.toUpperCase()}`,
    `Fuel range ≈ ${range} tiles at this burn.`,
  ];
  if (nearest) lines.push(`Nearest field: <b>${nearest.name}</b> — ${bearing(a, nearest)}${best <= range ? '' : ' <span class="text-amber">(beyond fuel range)</span>'}.`);
  return { type: 'output', message: lines.join('\n') };
}

async function cmdSquawk(args, raw, player) {
  const { live, err } = requirePilot(player); if (err) return err;
  const arg = (args[0] || '').toLowerCase();
  if (arg === 'off' || arg === 'dark') {
    live.squawk = null;
    return { type: 'emote', message: '<span class="text-amber">Transponder OFF — you\'re running dark. Invisible to the cameras, and that itself is a crime in controlled airspace.</span>' };
  }
  const code = /^\d{4}$/.test(arg) ? arg : String(1000 + Math.floor(Math.random() * 6000));
  live.squawk = code;
  return { type: 'emote', message: `Transponder set, squawking <b>${code}</b>. You read as legal traffic.` };
}

// `scan` also belongs to the library's lending terminal (a tag-gated specialized
// action). A plugin command beats a specialized action in dispatch order, so flight
// would otherwise eat the verb on the ground and answer "not aboard an aircraft" at
// a terminal. Same hand-back contract as `eject` above: when you're not flying, this
// isn't flight's verb — offer it to the specialized actions before refusing.
async function cmdScanVerb(args, raw, player, broadcast) {
  if (!player.aircraftId || !liveAircraft.get(player.aircraftId)) {
    const handed = await fireSpecializedAction('scan', args, raw, player, broadcast);
    if (handed !== undefined) return handed;
  }
  return cmdSpot(args, raw, player, broadcast);
}

export const commands = {
  extinguish: cmdExtinguish,
  eject: cmdEject,
  bail: cmdEject,
  preflight: cmdPreflight,
  hover: cmdHover,
  spot: cmdSpot,
  scan: cmdScanVerb,
  spray: cmdSpray,
  loadhopper: cmdLoadHopper,
  hopperbay: cmdHopperBay,
  chart: cmdChart,
  squawk: cmdSquawk,
};

export const _hazardTest = { rollHazards };
