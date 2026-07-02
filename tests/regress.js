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
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getAllZones, getLivePlayer } from '../server/engine/world.js';
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
const zone = zones.find(z => z.exits && Object.keys(z.exits).length > 0);
if (!zone) { console.error('No zone with exits found; aborting.'); process.exit(1); }

const P = {
  id: 'test_regress_' + process.pid,
  handle: 'Regressor',
  role: 'player',
  current_zone: zone.id,
  hp: 100, hp_max: 100, stamina: 100, stamina_max: 100,
  sanity: 50, sanity_max: 100,
  stat_brawn: 5, stat_reflexes: 5, stat_endurance: 5, stat_brains: 5, stat_cool: 5,
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
