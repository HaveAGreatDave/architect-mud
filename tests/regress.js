// Regression harness — the pre-deploy gate. See CLAUDE.md "Regression testing"
// for when to run this; docs/plugin-standard.md documents the per-plugin
// regress.js convention.
//
// Boots the world + plugins (no HTTP/WS server, no game loop), then runs three
// layers:
//   1. Manifest contract sweep — every command a plugin.json declares is
//      actually registered, every declared hook has a live handler. Catches
//      manifest/registration drift automatically for ALL plugins, no per-plugin
//      code needed.
//   2. Core engine checks — dispatch order, posture substrate, move-gate
//      chain, unified stop, driven end-to-end through handleCommand with a
//      fake live player in a real zone. DB writes are no-ops (the fake player
//      id matches no players row).
//   3. Per-plugin suites — every plugins/<name>/regress.js default export runs
//      with { run, check, getPlayer }. Test code lives with the plugin and
//      never loads in production.
//
// Run: npm run test:regress   (needs .env; shares the Supabase session pool —
// if it dies with EMAXCONNSESSION, kill orphaned local servers / wait ~90s)

import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getAllZones, getLivePlayer, world, setDoorCache, deleteDoorCache, getDoorForExit } from '../server/engine/world.js';
import { moveEntity } from '../server/engine/ai-behaviour.js';
import { exitTargets, allExits, neighborZoneIds, addExit, removeExit } from '../server/engine/exits.js';
import { cmdMove } from '../server/engine/commands/movement.js';
import { resolveNamedDestination } from '../server/engine/commands/describe.js';
import { getSelectionState, clearSelectionState } from '../server/engine/sift.js';
import { loadPlugins, getLoadedPlugins, getRegisteredCommands, getRegisteredHooks } from '../server/engine/plugins.js';
import { loadMisSettings } from '../server/engine/mis.js';
import { handleCommand } from '../server/engine/commands/index.js';
import { getRegisteredMoveGates } from '../server/engine/movement-gates.js';
import { registerProtectionProvider, getZoneProtection, getRegisteredProtectionProviders } from '../server/engine/protection.js';
import { stopAll } from '../server/engine/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, '../plugins');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
}

const sent = [];
const broadcast = (zoneId, payload, exclude, toPlayer) => { sent.push({ zoneId, payload, toPlayer }); };

console.log('— regression: booting world + plugins (no server) —');
await initWorld();
await loadMisSettings();
await loadPlugins();

// ── Layer 1: manifest contract sweep ─────────────────────────────────────────
console.log('— layer 1: manifest contracts —');
{
  const registeredCommands = new Set(getRegisteredCommands());
  const registeredHooks = getRegisteredHooks(); // { hookName: [pluginNames] }
  let drift = [];
  for (const p of getLoadedPlugins()) {
    for (const cmd of p.commands) {
      if (!registeredCommands.has(cmd)) drift.push(`${p.name}: declared command "${cmd}" not registered`);
    }
    for (const hook of p.hooks) {
      if (!(registeredHooks[hook] || []).includes(p.name)) drift.push(`${p.name}: declared hook "${hook}" has no handler`);
    }
  }
  check(`manifest contracts hold for ${getLoadedPlugins().length} plugins`, drift.length === 0, drift.join('; '));
}

// ── Fake player setup ─────────────────────────────────────────────────────────
const zones = getAllZones();
// The fake player's home zone must be door-free. The door regress fixtures anchor
// synthetic doors on p.current_zone and its exits, and the move-gate tests expect
// an unobstructed exit — a real door here (content drift) shadows the fixtures and
// trips the door-lock gate. Exclude any zone a real door touches, on either side
// or via a neighbour. (Was: first zone with an exit, which broke when a locked
// hololock door landed on zone_meridian_unit_104, the first such zone.)
const doorZones = new Set();
for (const d of world.doors.values()) { if (d.zone_id) doorZones.add(d.zone_id); if (d.target_zone) doorZones.add(d.target_zone); }
const zone = zones.find(z =>
  z.exits && Object.keys(z.exits).length > 0 &&
  !doorZones.has(z.id) &&
  !neighborZoneIds(z).some(n => doorZones.has(n)));
if (!zone) { console.error('No door-free zone with exits found; aborting.'); process.exit(1); }

const P = {
  id: 'test_regress_' + process.pid,
  handle: 'Regressor',
  role: 'player',
  current_zone: zone.id,
  hp: 100, hp_max: 100, stamina: 100, stamina_max: 100,
  sanity: 50, sanity_max: 100,
  stat_brawn: 5, stat_reflexes: 5, stat_endurance: 5, stat_brains: 5, stat_cool: 5, stat_senses: 5,
  credits: 0, radiation: 0, hunger: 100, thirst: 100,
  mis_enabled: 0,
  biological_sex: 'male',
  appearance_data: {},
};
setLivePlayer(P.id, P);
addPlayerToZone(P.id, zone.id);

const run = (input) => handleCommand(input, getLivePlayer(P.id), broadcast);
const getPlayer = () => getLivePlayer(P.id);

// ── Layer 2: core engine checks ───────────────────────────────────────────────
console.log('— layer 2: engine core —');
let r = await run('look');
check('look returns a result', r && r.type !== 'error', JSON.stringify(r)?.slice(0, 120));

r = await run('zzznotacommand');
check('unknown verb → error', r?.type === 'error' && /Unknown command/.test(r.message), r?.message);

r = await run('sit');
check('sit sets posture', getPlayer().posture === 'sitting', `posture=${getPlayer().posture}`);

r = await run('stand');
check('stand resets posture', getPlayer().posture === 'standing', `posture=${getPlayer().posture}`);

r = await run('stop');
check('bare stop → nothing to stop', /aren't doing anything/.test(r?.message || ''), r?.message);

// Gear/equip wiring (DB writes are no-ops for the fake player, so this checks the
// command surface: dispatch, argument guards, and the gear payload shape).
r = await run('equip');
check('bare equip → prompt', r?.type === 'error' && /Equip what/.test(r.message || ''), r?.message);
r = await run('gear');
check('gear returns a gear payload', r?.type === 'gear' && Array.isArray(r.items) && r.soak !== undefined && r.effects !== undefined, JSON.stringify(r)?.slice(0, 120));

const gateOwners = getRegisteredMoveGates();
check('engine law gates registered', gateOwners.includes('engine:door-lock') && gateOwners.includes('engine:encumbrance'), gateOwners.join(','));

// Protection substrate: apartments publish forcefields through it, and a
// registered provider claims a zone.
check('forcefield protection provider registered', getRegisteredProtectionProviders().includes('engine:apartments'), getRegisteredProtectionProviders().join(','));
registerProtectionProvider(zid => (zid === 'zone_regress_shielded' ? { reason: 'test' } : null), 'regress');
check('protection provider claims zone', getZoneProtection('zone_regress_shielded')?.reason === 'test' && !getZoneProtection('zone_regress_unshielded'), JSON.stringify(getZoneProtection('zone_regress_shielded')));

// The steal law consults the substrate (thievery suite covers verb routing;
// this covers the cross-system law): a live decoy in a shielded zone.
const decoyId = 'test_decoy_' + process.pid;
setLivePlayer(decoyId, { id: decoyId, handle: 'ShieldedDecoy', current_zone: 'zone_regress_shielded', credits: 100 });
addPlayerToZone(decoyId, getPlayer().current_zone); // visible to SIFT in the thief's zone
{
  const decoy = getLivePlayer(decoyId);
  // SIFT resolves by zone membership; keep the decoy's protection zone on the record.
  const rr = await run('steal shieldeddecoy');
  check('protection law blocks steal', /forcefield/.test(rr?.message || ''), rr?.message);
}
removePlayerFromZone(decoyId, getPlayer().current_zone);
removeLivePlayer(decoyId);

const dir = Object.keys(zone.exits)[0];
const before = getPlayer().current_zone;

// Encumbrance gate: negative capacity guarantees a block without inventory rows.
getPlayer().stat_brawn = -999;
r = await run(dir);
check('encumbrance gate blocks move', r?.type === 'error' && /carrying too much/.test(r.message || ''), r?.message?.slice?.(0, 120));
check('blocked move does not relocate', getPlayer().current_zone === before, getPlayer().current_zone);

getPlayer().stat_brawn = 5;
r = await run(dir);
check('move succeeds when gates pass', r?.type === 'move' && getPlayer().current_zone !== before, `type=${r?.type} zone=${getPlayer().current_zone}`);

// Multi-exit substrate: exits.js accessor normalizes the string|array split, and
// the movement law asks the player to disambiguate a direction with 2+ exits.
{
  // Accessor unit checks (pure — the polymorphism contract lives in one file).
  const single = { exits: { north: 'z_a' } };
  const multi  = { exits: { north: ['z_a', 'z_b'], east: 'z_c' } };
  check('exitTargets: string → [id]', JSON.stringify(exitTargets(single, 'north')) === '["z_a"]');
  check('exitTargets: array passthrough', JSON.stringify(exitTargets(multi, 'north')) === '["z_a","z_b"]');
  check('exitTargets: missing → []', exitTargets(single, 'south').length === 0);
  check('allExits: flattens multi-dir', allExits(multi).length === 3);
  check('neighborZoneIds: flat targets', JSON.stringify(neighborZoneIds(multi)) === '["z_a","z_b","z_c"]');
  const m = { north: 'z_a' };
  addExit(m, 'north', 'z_b');
  check('addExit: single → array on second', Array.isArray(m.north) && m.north.length === 2);
  removeExit(m, 'north', 'z_b');
  check('removeExit: collapses back to string', m.north === 'z_a');
  removeExit(m, 'north', 'z_a');
  check('removeExit: empties the direction', !('north' in m));

  // Behavioural: a synthetic origin with two "north" exits to real interior zones.
  const interiors = zones.filter(z => (z.flags?.is_interior || z.flags?.is_apartment) && z.name);
  const uniqByName = [...new Map(interiors.map(z => [z.name.toLowerCase(), z])).values()];
  if (uniqByName.length >= 2) {
    const [A, B] = uniqByName;
    const originId = 'zone_regress_multiexit_' + process.pid;
    world.zones.set(originId, {
      id: originId, name: 'Regress Fork', flags: { is_interior: true },
      exits: { north: [A.id, B.id] }, players: new Set(), npcs: new Set(), enemies: new Set(),
    });
    const mover = getPlayer();
    const savedZone = mover.current_zone;
    mover.current_zone = originId;

    const amb = await cmdMove('north', mover, broadcast);
    check('ambiguous direction → numbered picker', amb?.type === 'output' && /Several ways lead north/.test(amb.message || '') && /\[1\]/.test(amb.message || ''), amb?.message?.slice?.(0, 120));
    check('ambiguous move does not relocate', mover.current_zone === originId, mover.current_zone);
    const sel = getSelectionState(mover.id);
    check('ambiguous move opens SIFT selection', sel?.allCandidates?.length === 2 && sel.context?.verb === 'move', JSON.stringify(sel?.context));
    clearSelectionState(mover.id);

    // SIFT: naming the destination resolves to that specific same-direction exit.
    const res = resolveNamedDestination(world.zones.get(originId), A.name);
    check('name resolves to a specific same-dir exit', res?.type === 'unique' && res.match.targetId === A.id, JSON.stringify(res)?.slice?.(0, 120));

    // Inline index (`in 2`): jumps straight to the Nth exit in stable name order,
    // no picker needed. #1 is the alphabetically-first destination.
    const ordered = [A, B].map(z => ({ id: z.id, name: z.name })).sort((a, b) => a.name.localeCompare(b.name));
    mover.current_zone = originId;
    const idx1 = await cmdMove('north', mover, broadcast, { exitIndex: 1 });
    check('inline index moves to Nth exit', idx1?.type === 'move' && mover.current_zone === ordered[0].id, `zone=${mover.current_zone} want=${ordered[0].id}`);
    check('inline index opens no picker', !getSelectionState(mover.id), JSON.stringify(getSelectionState(mover.id)));

    mover.current_zone = originId;
    const idxBad = await cmdMove('north', mover, broadcast, { exitIndex: 9 });
    check('out-of-range index errors, no move', idxBad?.type === 'error' && mover.current_zone === originId, `${idxBad?.type} zone=${mover.current_zone}`);

    mover.current_zone = savedZone;
    world.zones.delete(originId);
  } else {
    check('multi-exit behavioural (needs 2 named interiors)', true, 'skipped — insufficient interior zones');
  }
}

// NPC home-door lifecycle (moveEntity): a resident passes its own locked door,
// secures the home on arrival, can leave again, and non-owners are blocked.
// moveEntity guards every DB write behind `query` — pass undefined for a pure
// in-memory check on synthetic zones + a cached door.
{
  const hallId = 'zone_regress_hall_' + process.pid;
  const homeId = 'zone_regress_home_' + process.pid;
  world.zones.set(hallId, { id: hallId, name: 'Regress Hall', flags: {}, exits: { north: homeId }, players: new Set(), npcs: new Set(), enemies: new Set() });
  world.zones.set(homeId, { id: homeId, name: 'Regress Flat', flags: { is_apartment: true }, exits: { south: hallId }, players: new Set(), npcs: new Set(), enemies: new Set() });
  const doorId = 'door_regress_home_' + process.pid;
  const mkDoor = (lock_state, is_open) => setDoorCache(doorId, {
    id: doorId, zone_id: hallId, exit_dir: 'north', target_zone: homeId,
    hp: 100, hp_max: 100, is_open, lock_state, tags: { 'lock:hololock': {} },
  });

  // Someone else's locked door blocks a passer-by, who does not relocate.
  mkDoor('locked', 0);
  const stranger = { id: 'npc_rg_stranger_' + process.pid, name: 'Stranger', zone_id: hallId, home_zone: 'zone_elsewhere' };
  const blocked = moveEntity(stranger, homeId, broadcast, undefined);
  check('NPC blocked by another\'s locked door', blocked === false && stranger.zone_id === hallId, `moved=${blocked} zone=${stranger.zone_id}`);

  // The resident (home_zone === the flat) passes even a shut door and secures the
  // home behind them — locked + closed — with no redundant "closes behind them".
  mkDoor('unlocked', 0);
  const resident = { id: 'npc_rg_resident_' + process.pid, name: 'Resident', zone_id: hallId, home_zone: homeId };
  const before = sent.length;
  const entered = moveEntity(resident, homeId, broadcast, undefined);
  const homeDoor = getDoorForExit(hallId, 'north', homeId);
  const arrivalMsgs = sent.slice(before).map(s => s.payload?.message || '').join(' | ');
  check('resident secures home on arrival (locked + shut)',
    entered === true && resident.zone_id === homeId && homeDoor.lock_state === 'locked' && homeDoor.is_open === 0,
    `entered=${entered} zone=${resident.zone_id} lock=${homeDoor.lock_state} open=${homeDoor.is_open}`);
  check('home-secure does not double-fire "closes behind them"',
    /secures the door/.test(arrivalMsgs) && !/closes behind them/.test(arrivalMsgs), arrivalMsgs.slice(0, 140));

  // The resident can leave their own locked home (owner bypass); it stays locked.
  const left = moveEntity(resident, hallId, broadcast, undefined);
  const afterDoor = getDoorForExit(hallId, 'north', homeId);
  check('resident leaves; home stays locked',
    left === true && resident.zone_id === hallId && afterDoor.lock_state === 'locked',
    `left=${left} zone=${resident.zone_id} lock=${afterDoor.lock_state}`);

  deleteDoorCache(doorId);
  world.zones.delete(hallId);
  world.zones.delete(homeId);
}

// ── Layer 3: per-plugin suites (plugins/<name>/regress.js) ───────────────────
console.log('— layer 3: plugin suites —');
const dirs = (await readdir(PLUGINS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
for (const d of dirs) {
  const suitePath = join(PLUGINS_DIR, d.name, 'regress.js');
  if (!existsSync(suitePath)) continue;
  try {
    const mod = await import(pathToFileURL(suitePath).href);
    if (typeof mod.default !== 'function') { check(`${d.name}: regress.js has default export`, false, 'no default function'); continue; }
    await mod.default({ run, check: (name, cond, detail) => check(`${d.name}: ${name}`, cond, detail), getPlayer });
  } catch (e) {
    check(`${d.name}: suite runs`, false, e.message);
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
removePlayerFromZone(P.id, getPlayer().current_zone);
removeLivePlayer(P.id);
stopAll();

const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
process.exit(failed.length ? 1 : 0);
