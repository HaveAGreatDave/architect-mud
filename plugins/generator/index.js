/**
 * Portable generator plugin — deploy a fuel-burning generator into a building,
 * plug it into the building's junction box, and ride out a power outage on it.
 *
 * A deployed unit is a pair of rows, mirroring the destructible-infrastructure
 * pattern (docs: infrastructure.js): a `generators` row (generator_type
 * 'player') that the power sim already knows how to burn fuel for, plus a
 * `furniture` row (object_type 'generator_portable') linking back to it via
 * flags.generator_id so it's a real, examinable, packable object in the room.
 *
 * The engine wiring lives in environment.js Phase 5: a running, fuelled player
 * generator whose flags.junction_box_id points at a junction box back-feeds
 * that box's whole building whenever the city plant can't. This plugin owns the
 * player verbs that stand a unit up, fuel it, wire it in, and run it.
 *
 * Fuel is a liquid: it lives in fillable containers (see the fillable plugin,
 * fluid_type 'fuel') and is poured into the generator's tank with `refuel`.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { tagValue } from '../../server/engine/tags.js';
import { recomputePower } from '../../server/engine/environment.js';

// Fallbacks if the item's portable_generator tag omits a field. Numbers are
// content tuning — a bigger tank/capacity is just a heftier (pricier) unit.
const DEFAULTS = { capacity_kw: 3000, tank: 20, burn_rate: 0.02 };

// Resolve a portable generator item the player is carrying (top-level only). A
// named lookup that misses falls back to the sole carried unit, so filler words
// ("deploy the generator") don't strand an obvious target.
async function resolveInvGenerator(player, name) {
  const run = async filter => (await query(
    `SELECT pi.id, pi.item_id, pi.quantity, pi.custom_data, i.name, i.description, i.tags
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL
        AND jsonb_exists(i.tags,'portable_generator')${filter ? ' AND i.name ILIKE $2' : ''}
      ORDER BY length(i.name) LIMIT 1`,
    filter ? [player.id, `%${filter}%`] : [player.id])).rows[0] || null;
  return (name && await run(name)) || run(null);
}

// Resolve a deployed generator standing in the player's current zone. Same
// name-then-sole-unit fallback ("plug in generator", "connect the generator").
async function resolveDeployed(player, name) {
  const run = async filter => (await query(
    `SELECT g.*, f.id AS furn_id
       FROM furniture f JOIN generators g ON g.id = (f.flags->>'generator_id')
      WHERE f.zone_id=$1 AND f.object_type='generator_portable'${filter ? ' AND g.name ILIKE $2' : ''}
      ORDER BY length(g.name) LIMIT 1`,
    filter ? [player.current_zone, `%${filter}%`] : [player.current_zone])).rows[0] || null;
  return (name && await run(name)) || run(null);
}

// The junction box that powers the player's current zone (if any).
async function zoneJunctionBox(zoneId) {
  const { rows } = await query(
    `SELECT g.id, g.name FROM power_zones pz JOIN generators g ON g.id = pz.generator_id
      WHERE pz.id=$1 AND g.generator_type='junction_box' LIMIT 1`,
    [zoneId]);
  return rows[0] || null;
}

function fuelPct(g) {
  const tank = g.flags?.tank || DEFAULTS.tank;
  return Math.max(0, Math.min(100, Math.round(((g.fuel_remaining || 0) / tank) * 100)));
}

async function deploy(args, raw, player, broadcast) {
  const row = await resolveInvGenerator(player, args.join(' ').trim());
  if (!row) return { type: 'error', message: `You aren't carrying a portable generator${args.length ? ` matching "${args.join(' ')}"` : ''}.` };

  const cfg = tagValue(row, 'portable_generator', {}) || {};
  const capacity = Number(cfg.capacity_kw) || DEFAULTS.capacity_kw;
  const tank = Number(cfg.tank) || DEFAULTS.tank;
  const burn = Number(cfg.burn_rate) || DEFAULTS.burn_rate;
  const startFuel = Math.min(tank, Number(row.custom_data?.fuel_remaining) || 0);

  // Consume one unit of the carried stack.
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);

  const genId = `pgen_${randomUUID()}`;
  const furnId = `pgenf_${randomUUID()}`;
  await query(
    `INSERT INTO generators (id, zone_id, name, generator_type, capacity_kw, fuel_type, fuel_remaining, fuel_burn_rate, connection_range, status, flags)
     VALUES ($1,$2,$3,'player',$4,'fuel',$5,$6,0,'offline',$7)`,
    [genId, player.current_zone, row.name, capacity, startFuel, burn,
     JSON.stringify({ tank, item_id: row.item_id, owner_id: player.id, owner_handle: player.handle })]);
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ($1,$2,$3,$4,'generator_portable',$5)`,
    [furnId, player.current_zone, row.name,
     row.description || 'A squat, fuel-fed portable generator, all cage-frame and grab-handle.',
     JSON.stringify({ generator_id: genId })]);

  await recomputePower().catch(() => {}); // fire up the battery work light right away
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} sets down a ${row.name}; its work light flickers on.`, refresh: true }, player.id);
  return { type: 'use', message: `You set down the ${row.name}. Its battery work light casts a dim glow. Fuel it, plug it into the junction box, then start it.` };
}

async function connect(args, raw, player, broadcast) {
  const g = await resolveDeployed(player, args.join(' ').trim());
  if (!g) return { type: 'error', message: `There's no generator deployed here.` };
  if (g.flags?.junction_box_id) return { type: 'output', message: `The ${g.name} is already wired into the junction box.` };

  const jb = await zoneJunctionBox(player.current_zone);
  if (!jb) return { type: 'error', message: `There's no building junction box here to plug the ${g.name} into.` };

  await query(`UPDATE generators SET flags = COALESCE(flags,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ junction_box_id: jb.id }), g.id]);
  await recomputePower().catch(() => {});

  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} runs a cable from the ${g.name} to the ${jb.name}.` }, player.id);
  return { type: 'use', message: `You wire the ${g.name} into the ${jb.name}.` };
}

async function disconnect(args, raw, player, broadcast) {
  const g = await resolveDeployed(player, args.join(' ').trim());
  if (!g) return { type: 'error', message: `There's no generator deployed here.` };
  if (!g.flags?.junction_box_id) return { type: 'output', message: `The ${g.name} isn't wired into anything.` };

  await query(`UPDATE generators SET flags = COALESCE(flags,'{}'::jsonb) - 'junction_box_id' WHERE id=$1`, [g.id]);
  await recomputePower().catch(() => {});
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} pulls the ${g.name}'s cable from the junction box.` }, player.id);
  return { type: 'use', message: `You unplug the ${g.name}.` };
}

async function start(args, raw, player, broadcast) {
  const g = await resolveDeployed(player, args.join(' ').trim());
  if (!g) return { type: 'error', message: `There's no generator deployed here.` };
  if (g.status === 'online') return { type: 'output', message: `The ${g.name} is already running.` };
  if ((g.fuel_remaining || 0) <= 0) return { type: 'error', message: `The ${g.name}'s tank is dry. Refuel it first.` };

  await query(`UPDATE generators SET status='online' WHERE id=$1`, [g.id]);
  await recomputePower().catch(() => {});
  const note = g.flags?.junction_box_id ? '' : ' (it isn\'t plugged into anything yet)';
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} yanks the ${g.name} to life; it settles into a ragged mechanical drone.` }, player.id);
  return { type: 'use', message: `The ${g.name} coughs, catches, and runs.${note}` };
}

async function stop(args, raw, player, broadcast) {
  const g = await resolveDeployed(player, args.join(' ').trim());
  if (!g) return { type: 'error', message: `There's no generator deployed here.` };
  if (g.status !== 'online') return { type: 'output', message: `The ${g.name} isn't running.` };

  await query(`UPDATE generators SET status='offline' WHERE id=$1`, [g.id]);
  await recomputePower().catch(() => {});
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} kills the ${g.name}; its drone winds down to silence.` }, player.id);
  return { type: 'use', message: `You shut down the ${g.name}.` };
}

async function refuel(args, raw, player, broadcast) {
  // refuel [generator] [with <can>]
  const parts = args.join(' ').split(/\s+with\s+/i);
  const genName = (parts[0] || '').trim();
  const canName = (parts[1] || '').trim();

  const g = await resolveDeployed(player, genName);
  if (!g) return { type: 'error', message: `There's no generator deployed here${genName ? ` matching "${genName}"` : ''}.` };

  const { rows: cans } = await query(
    `SELECT pi.id, pi.custom_data, i.name
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'fillable')
        AND (pi.custom_data->>'fluid_type')='fuel'
        AND COALESCE((pi.custom_data->>'fluid_amount')::numeric,0) > 0${canName ? ' AND i.name ILIKE $2' : ''}
      ORDER BY length(i.name) LIMIT 1`,
    canName ? [player.id, `%${canName}%`] : [player.id]);
  const can = cans[0];
  if (!can) return { type: 'error', message: `You've got nothing holding fuel to pour${canName ? ` matching "${canName}"` : ''}.` };

  const tank = g.flags?.tank || DEFAULTS.tank;
  const space = tank - (g.fuel_remaining || 0);
  if (space <= 0) return { type: 'output', message: `The ${g.name}'s tank is already full.` };

  const have = Number(can.custom_data.fluid_amount) || 0;
  const pour = Math.min(space, have);
  const left = have - pour;

  await query(`UPDATE generators SET fuel_remaining = fuel_remaining + $1 WHERE id=$2`, [pour, g.id]);
  if (left > 0)
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
      [JSON.stringify({ fluid_amount: left }), can.id]);
  else
    await query(`UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) - 'fluid_amount' - 'fluid_type' WHERE id=$1`,
      [can.id]);
  await recomputePower().catch(() => {}); // a dry unit left running restarts once fuelled

  const g2 = { ...g, fuel_remaining: (g.fuel_remaining || 0) + pour };
  return { type: 'use', message: `You pour fuel from the ${can.name} into the ${g.name}. (Tank ${fuelPct(g2)}%)` };
}

async function pack(args, raw, player, broadcast) {
  const g = await resolveDeployed(player, args.join(' ').trim());
  if (!g) return { type: 'error', message: `There's no generator deployed here.` };
  if (g.status === 'online') return { type: 'error', message: `Shut the ${g.name} down before you pack it up.` };

  const itemId = g.flags?.item_id;
  if (!itemId) return { type: 'error', message: `The ${g.name} can't be packed up.` };

  await query('DELETE FROM furniture WHERE id=$1', [g.furn_id]);
  await query('DELETE FROM generators WHERE id=$1', [g.id]);
  // Carry the remaining fuel back into the item instance so it survives the move.
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, is_equipped, custom_data)
     VALUES ($1,$2,$3,1,0,$4)`,
    [randomUUID(), player.id, itemId, JSON.stringify({ fuel_remaining: g.fuel_remaining || 0 })]);
  // The removed unit won't be in the next sim's light pass, so kill its room's
  // work light now — unless another portable generator is still standing here.
  const { rows: others } = await query(
    `SELECT 1 FROM furniture WHERE zone_id=$1 AND object_type='generator_portable' LIMIT 1`, [player.current_zone]);
  if (!others.length)
    await query(`UPDATE lighting_states SET has_emergency_lighting=0 WHERE zone_id=$1`, [player.current_zone]);
  await recomputePower().catch(() => {});

  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} packs up the ${g.name}.`, refresh: true }, player.id);
  return { type: 'use', message: `You pack up the ${g.name}.` };
}

async function status(args, raw, player) {
  const g = await resolveDeployed(player, args.join(' ').trim());
  if (!g) return { type: 'output', message: `No generator is deployed here. Carry one in and \`deploy\` it.` };
  const running = g.status === 'online' ? 'running' : 'stopped';
  const wired = g.flags?.junction_box_id ? 'plugged into the junction box' : 'not plugged in';
  const bmax = g.flags?.battery_max || 100;
  const batt = Math.max(0, Math.min(100, Math.round(((g.flags?.battery ?? bmax) / bmax) * 100)));
  return { type: 'output', message: `${g.name}: ${running}, tank ${fuelPct(g)}%, ${wired}, work-light battery ${batt}%.` };
}

// `generator`/`gen` control hub. Subcommands cover the actions that don't get a
// friendly standalone verb (start/stop/pack/disconnect), plus mirrors of the
// ones that do, so everything is reachable one way.
const SUB = { deploy, connect, plug: connect, disconnect, unplug: disconnect, start, stop, refuel, pack, status };
async function generator(args, raw, player, broadcast) {
  const sub = (args[0] || 'status').toLowerCase();
  const fn = SUB[sub];
  if (!fn) return { type: 'error', message: `Usage: generator <deploy|connect|start|stop|refuel|pack|disconnect|status>` };
  const rest = args.slice(1);
  return fn(rest, rest.join(' '), player, broadcast);
}

export const commands = {
  generator, gen: generator,
  deploy, connect, plug: connect, refuel,
};

export const hooks = {
  // Status readout appended to the deployed unit when examined.
  'furniture.describe': async (f) => {
    if (f.object_type !== 'generator_portable') return undefined;
    const gid = f.flags?.generator_id;
    if (!gid) return undefined;
    const { rows } = await query('SELECT status, fuel_remaining, capacity_kw, flags FROM generators WHERE id=$1', [gid]);
    const g = rows[0];
    if (!g) return undefined;
    const running = g.status === 'online';
    const connected = !!g.flags?.junction_box_id;
    const pct = fuelPct(g);
    const bmax = g.flags?.battery_max || 100;
    const batt = Math.max(0, Math.min(100, Math.round(((g.flags?.battery ?? bmax) / bmax) * 100)));
    const workLight = running || batt > 0 ? `work light on (battery ${batt}%)` : 'work light dead';
    const color = running ? '#22c55e' : (pct > 0 ? '#f59e0b' : '#ff4444');
    const label = running ? 'RUNNING' : 'STOPPED';
    return `<span style="color:${color};font-size:11px;letter-spacing:1px">⬤ ${label}</span>`
      + ` <span class="text-dim">— tank ${pct}%, ${connected ? 'plugged in' : 'not plugged in'}, ${g.capacity_kw}W, ${workLight}</span>`;
  },
};
