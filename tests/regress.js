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

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getAllZones, getLivePlayer, world, setDoorCache, deleteDoorCache, getDoorForExit, getApartment, insertFurniture, deleteFurniture } from '../server/engine/world.js';
import { moveEntity } from '../server/engine/ai-behaviour.js';
import { exitTargets, allExits, neighborZoneIds, addExit, removeExit } from '../server/engine/exits.js';
import { cmdMove, dragFollowers } from '../server/engine/commands/movement.js';
import { resolveNamedDestination } from '../server/engine/commands/describe.js';
import { tickOnsets } from '../server/engine/drugs.js';
import { getSelectionState, clearSelectionState } from '../server/engine/sift.js';
import { loadPlugins, getLoadedPlugins, getRegisteredCommands, getRegisteredHooks } from '../server/engine/plugins.js';
import { loadItems } from '../server/engine/items-cache.js';
import { loadMisSettings } from '../server/engine/mis.js';
import { handleCommand } from '../server/engine/commands/index.js';
import { getRegisteredMoveGates } from '../server/engine/movement-gates.js';
import { getRegisteredSpecializedActions } from '../server/engine/specializedActions.js';
import { registerProtectionProvider, getZoneProtection, getRegisteredProtectionProviders } from '../server/engine/protection.js';
import { validateTags } from '../server/engine/tags.js';
import { stopAll } from '../server/engine/scheduler.js';
import { CONTENT_TABLES, EXCLUDED_TABLES, REGISTRY } from '../server/models/content-registry.js';
import { SCHEMA_SQL } from '../server/models/schema.js';
import { handleApiRequest, apiUpdateZone, apiPatchZoneTag } from '../server/api/routes.js';
import { query } from '../server/models/db.js';

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
await loadItems();
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

// ── Layer 1a: content-registry coverage (anti-drift for exports + the pipeline) ─
// Every table in SCHEMA_SQL must be classified in server/models/content-registry.js
// as content, runtime, or player. An unclassified table is the silent bug class
// behind the flight + quests losses: authored content that restores EMPTY on a
// fresh DB with no error, because the export allowlist never learned about it.
// The registry also drives the file-based content pipeline, so its pk and
// excludeColumns entries must name REAL columns — a typo there would silently
// export wrong files or upsert the wrong column set.
console.log('— layer 1a: content-registry coverage —');
{
  const contentNames = new Set(CONTENT_TABLES.map(e => typeof e === 'string' ? e : e.table));
  const excludedNames = new Set(EXCLUDED_TABLES);
  const schemaTables = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
  const unclassified = schemaTables.filter(t => !contentNames.has(t) && !excludedNames.has(t));
  const overlap = schemaTables.filter(t => contentNames.has(t) && excludedNames.has(t));
  check(`every SCHEMA_SQL table is classified in the content registry (${schemaTables.length} tables)`,
    unclassified.length === 0,
    unclassified.length ? `UNCLASSIFIED (add to server/models/content-registry.js): ${unclassified.join(', ')}` : '');
  check('no table is both content and excluded', overlap.length === 0, overlap.join(', '));

  // Registry entries must not name tables that don't exist (catches renames/deletes).
  const schemaSet = new Set(schemaTables);
  const phantom = REGISTRY.map(e => e.table).filter(t => !schemaSet.has(t));
  check('registry names no phantom tables', phantom.length === 0, phantom.join(', '));

  // pk + excludeColumns must be real columns of their table. Columns come from the
  // table's CREATE TABLE block plus any ADD COLUMN IF NOT EXISTS retrofits — the
  // same regex-over-SCHEMA_SQL style as the table sweep above.
  const columnsOf = (table) => {
    const cols = new Set();
    const block = SCHEMA_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n  \\);`, 'm'));
    if (block) {
      for (const line of block[1].split('\n')) {
        const m = line.match(/^\s{4}"?([a-z_]+)"?\s/);
        if (m && !['primary', 'foreign', 'unique', 'check', 'constraint'].includes(m[1])) cols.add(m[1]);
      }
    }
    for (const m of SCHEMA_SQL.matchAll(new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS (\\w+)`, 'g'))) {
      cols.add(m[1]);
    }
    return cols;
  };
  const colErrors = [];
  for (const e of REGISTRY.filter(e => e.class === 'content')) {
    const cols = columnsOf(e.table);
    if (!cols.size) { colErrors.push(`${e.table}: could not parse columns from SCHEMA_SQL`); continue; }
    if (!e.pk || !e.pk.length) colErrors.push(`${e.table}: content entry has no pk`);
    for (const c of e.pk || []) if (!cols.has(c)) colErrors.push(`${e.table}: pk column "${c}" not in SCHEMA_SQL`);
    for (const c of e.excludeColumns || []) if (!cols.has(c)) colErrors.push(`${e.table}: excludeColumns "${c}" not in SCHEMA_SQL`);
  }
  check('registry pk/excludeColumns name real columns', colErrors.length === 0, colErrors.join('; '));

  // Every content table must declare its read tier — where its rows live at
  // runtime (docs/architecture.md → Read Tiers). Adding a content table without
  // deciding this is exactly how "query fresh by accident" hot paths appear.
  const READ_TIERS = new Set(['boot', 'ttl', 'cold', 'fresh', 'dead']);
  const tierErrors = REGISTRY.filter(e => e.class === 'content' && !READ_TIERS.has(e.readTier))
    .map(e => `${e.table}: readTier "${e.readTier}" (must be one of ${[...READ_TIERS].join('/')})`);
  check('every content table declares a valid readTier', tierErrors.length === 0, tierErrors.join('; '));
}

// ── Layer 1b: object-gated verb discoverability ──────────────────────────────
// A verb that only works near a specific world object (furniture/item/NPC) must be
// discoverable in-world — surfaced on that object's examine via a tag-gated
// specializedAction (or flags.interactions) — or be an explicitly logged gap. A
// command that works but the player can't find is invisible content (the scrub /
// police_terminal case). Each plugin declares its object-gated verbs in the
// `objectGatedCommands` manifest field: { verb: { discoverVia, exposed, note } }.
// This check fails if a verb declared discoverable (exposed !== false) isn't wired
// into the specialized-action registry under the tag it claims. See
// docs/audits/affordance-discoverability-audit.md and the verb-discoverability memory.
console.log('— layer 1b: object-gated verb discoverability —');
{
  const specialized = getRegisteredSpecializedActions(); // { verb: [{ requiredTag, pluginName }] }
  const problems = [], knownGaps = [];
  const pluginDirs = (await readdir(PLUGINS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
  for (const e of pluginDirs) {
    const manifestPath = join(PLUGINS_DIR, e.name, 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const gated = manifest.objectGatedCommands || {};
    for (const [verb, spec] of Object.entries(gated)) {
      if (!(manifest.commands || []).includes(verb)) {
        problems.push(`${e.name}: objectGatedCommands "${verb}" is not in commands[]`);
      }
      if (spec.exposed === false) { knownGaps.push(`${e.name}:${verb} (via ${spec.discoverVia || '?'})`); continue; }
      const wired = (specialized[verb] || []).some(x => x.requiredTag === spec.discoverVia);
      if (!wired) problems.push(`${e.name}: "${verb}" declared discoverable via tag "${spec.discoverVia}" but no specializedAction surfaces it (examine shows no hint)`);
    }
  }
  check('object-gated verbs are discoverable or logged', problems.length === 0, problems.join('; '));
  if (knownGaps.length) console.log(`    (known discoverability gaps, logged not enforced: ${knownGaps.join(', ')})`);
}

// ── Layer 1c: CONTENT_READONLY gate (prod content is git-only) ───────────────
// With the env set, every HTTP content write — core routes, staging, plugin
// routes — must 403 with the read-only message, while ops routes (auth, player
// admin, environment controls…) must NOT be blocked BY THE GATE (they may still
// 401/403 for auth reasons — that's the handler speaking, not the gate).
console.log('— layer 1c: CONTENT_READONLY gate —');
{
  const READONLY_MSG = /read-only on production/;
  const hitsGate = async (method, url) => {
    try {
      const r = await handleApiRequest(url, method, {}, {});
      return r?.status === 403 && READONLY_MSG.test(r?.body?.error || '');
    } catch {
      return false; // reached a real handler and blew up on the empty body — not gated
    }
  };
  process.env.CONTENT_READONLY = '1';
  const mustBlock = [
    ['PUT', '/api/zones/zone_regress_gate_probe'],
    ['POST', '/api/staging/stage'],
    ['PUT', '/api/npcs/npc_regress_gate_probe'],
    ['PUT', '/api/audio/samples/smp_regress_gate_probe'],   // plugin route
    ['POST', '/api/quests'],                                 // plugin route
    ['POST', '/api/environment/climate/profiles'],           // climate = content
  ];
  const mustPass = [
    ['POST', '/api/auth/login'],                             // blocking this bricks the game
    ['POST', '/api/motd/push'],
    ['POST', '/api/admin/presence'],
    ['POST', '/api/environment/time/advance'],               // live-ops stay live
  ];
  const gateErrors = [];
  for (const [method, url] of mustBlock) {
    if (!(await hitsGate(method, url))) gateErrors.push(`${method} ${url} was NOT blocked`);
  }
  for (const [method, url] of mustPass) {
    if (await hitsGate(method, url)) gateErrors.push(`${method} ${url} WAS blocked (ops route caught by the gate)`);
  }
  delete process.env.CONTENT_READONLY;
  check('CONTENT_READONLY blocks content writes, passes ops routes', gateErrors.length === 0, gateErrors.join('; '));
  // Gate off ⇒ fully inert: the same content write must not see the gate message.
  check('gate is inert when CONTENT_READONLY is unset', !(await hitsGate('PUT', '/api/zones/zone_regress_gate_probe')));
}

// ── Layer 1d: zone tag substrate ──────────────────────────────────────────────
// zones.flags is the catalog-validated zone tag bag (scope 'zone'). Every live
// bag must validate (catches uncatalogued keys / junk values drifting back in),
// and the API write paths must reject bad bags loudly.
console.log('— layer 1d: zone tag substrate —');
{
  const bagErrors = [];
  for (const z of world.zones.values()) {
    const v = validateTags(z.flags || {});
    if (!v.ok) bagErrors.push(`${z.id}: ${[...v.unknown, ...v.badShape].join(', ')}`);
  }
  check(`every live zone flags bag passes validateTags (${world.zones.size} zones)`,
    bagErrors.length === 0, bagErrors.slice(0, 5).join(' | '));

  const bad = validateTags({ radation: 5, danger: 'extreme' });
  check('validateTags rejects a typo\'d key and a bad enum value',
    !bad.ok && bad.unknown.includes('radation') && bad.badShape.length === 1);

  const rPut = await apiUpdateZone('zone_regress_tag_probe', { flags: { radation: 5 } });
  check('apiUpdateZone rejects an uncatalogued zone flag with 400',
    rPut?.status === 400 && /radation/.test(rPut?.body?.error || ''), JSON.stringify(rPut?.body).slice(0, 120));

  const rPatchBad = await apiPatchZoneTag('zone_regress_tag_probe', { name: 'radation', value: 5 });
  check('apiPatchZoneTag rejects an uncatalogued tag with 400', rPatchBad?.status === 400);
  const rPatchMissing = await apiPatchZoneTag('zone_regress_tag_probe', { name: 'radiation', value: 5 });
  check('apiPatchZoneTag 404s on a missing zone (validation passed, no write)', rPatchMissing?.status === 404);
}

// ── Fake player setup ─────────────────────────────────────────────────────────
const zones = getAllZones();
// The fake player's home zone must be door-free. The door regress fixtures anchor
// synthetic doors on p.current_zone and its exits, and the move-gate tests expect
// an unobstructed exit — a real door here (content drift) shadows the fixtures and
// trips the door-lock gate. Exclude any zone a real door touches, on either side
// or via a neighbour. (Was: first zone with an exit, which broke when a locked
// hololock door landed on zone_meridian_unit_104, the first such zone.)
// Apartment zones are excluded too: hackDoor treats any door guarding an UNOWNED
// apartment as "already disengaged" (doors.js), so a vacant unit poisons every
// hololock fixture anchored there. Which zone the find() lands on depends on DB
// row order — a freshly file-imported world orders differently than a grown one,
// which is how this surfaced.
const doorZones = new Set();
for (const d of world.doors.values()) { if (d.zone_id) doorZones.add(d.zone_id); if (d.target_zone) doorZones.add(d.target_zone); }
// Prologue zones (flags.prologue) gate their one exit behind a story flag
// (plugins/prologue/index.js's prologueMoveGate) that this fake player never
// has, so an unconditional "move succeeds when gates pass" fails there — same
// content-drift class as the door/apartment exclusions above (a freshly
// file-imported world orders DB rows differently than a grown one, and can
// land find() on a zone with special move-gating instead of an ordinary one).
// A passable exit ([dir, targetId]) — one whose destination isn't open water. Open
// water is impassable (engine:water move gate), so the move/rad/gps fixtures need a
// step they can actually take, and the fake player must never be anchored ON water
// (its only "exits" lead to more water, and water is instantly lethal by design).
const zoneById = new Map(zones.map(z => [z.id, z]));
const dryExit = (z) => Object.entries(z?.exits || {})
  .map(([d, t]) => [d, Array.isArray(t) ? t[0] : t])
  .find(([, t]) => { const zt = zoneById.get(t); return zt && !zt.flags?.water; });
// Zone-name frequency: the world now has hundreds of identically-named terrain tiles
// ("Grasslands", …). The GPS fixtures resolve destinations BY NAME, so the fake player
// must sit on a uniquely-named tile with a uniquely-named dry neighbour — otherwise
// `gps <name>` is inherently ambiguous. We prefer such a zone and fall back to any
// door-free dry zone if the world somehow has none.
const nameCount = new Map();
for (const z of zones) nameCount.set(z.name, (nameCount.get(z.name) || 0) + 1);
const uniqueName = (z) => z && nameCount.get(z.name) === 1;
const baseOk = (z) =>
  z.exits && Object.keys(z.exits).length > 0 &&
  !z.flags?.water &&
  !doorZones.has(z.id) &&
  !getApartment(z.id) &&
  !z.flags?.prologue &&
  !neighborZoneIds(z).some(n => doorZones.has(n)) &&
  dryExit(z);
const zone =
  zones.find(z => baseOk(z) && uniqueName(z) && uniqueName(zoneById.get(dryExit(z)[1])))
  || zones.find(baseOk);
if (!zone) { console.error('No door-free, dry zone with a passable exit found; aborting.'); process.exit(1); }

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

// Drug onset (effects.onset_seconds): deferred instant hits land via tickOnsets.
// Zero deltas keep applyEffects side-effect-free (no stat write, no DB) so this
// checks purely the scheduling: elapsed timer lands + clears, future timer holds.
{
  const p = getPlayer();
  p.pendingOnsets = [{ landAt: Date.now() - 1000, deltas: { sanity: 0 }, diuretic: 1, halluc: null, drug: {}, broadcast: () => {}, landMessage: 'LANDED' }];
  const landed = tickOnsets(p);
  check('onset lands once its timer elapses', landed.includes('LANDED') && p.pendingOnsets.length === 0, JSON.stringify(landed));
  p.pendingOnsets = [{ landAt: Date.now() + 60000, deltas: { sanity: 0 }, diuretic: 1, halluc: null, drug: {}, broadcast: () => {}, landMessage: 'EARLY' }];
  const held = tickOnsets(p);
  check('onset holds until its timer elapses', held.length === 0 && p.pendingOnsets.length === 1, JSON.stringify(held));
  p.pendingOnsets = [];
}

// Gear/equip wiring (DB writes are no-ops for the fake player, so this checks the
// command surface: dispatch, argument guards, and the gear payload shape).
r = await run('equip');
check('bare equip → prompt', r?.type === 'error' && /Equip what/.test(r.message || ''), r?.message);
r = await run('gear');
check('gear returns a gear payload', r?.type === 'gear' && Array.isArray(r.items) && r.soak !== undefined && r.effects !== undefined, JSON.stringify(r)?.slice(0, 120));

// Restocking furniture container (engine law in buildContainerView): a container
// flagged `restock_items` keeps one of each listed item present — take one and the
// refreshed view a pull returns respawns it, so the supply is bottomless. Seed a
// throwaway container + item, drive the real open/pull verbs, clean up in finally.
// Mirrors the vending fixture pattern.
{
  const savedZone = getPlayer().current_zone;
  const RZ = 'zone_restock_regress', RITEM = 'item_restock_regress', RFURN = 'furn_restock_regress';
  try {
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'restock probe','restock probe','misc',0,10,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [RITEM, JSON.stringify({ misc: true })]
    );
    await insertFurniture({
      id: RFURN, name: 'restock case', description: 'a restock case', object_type: 'container',
      zone_id: RZ, flags: JSON.stringify({ container: 40000, restock_items: [RITEM] }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    await query('DELETE FROM player_inventory WHERE container_id=$1', [RFURN]);
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [getPlayer().id, RITEM]);

    getPlayer().current_zone = RZ;
    // Open on an empty case → buildContainerView tops it up to one of each listed item.
    let rc = await run(`opencontainer ${RFURN}`);
    const seeded = rc?.type === 'container_view' && rc.containerItems?.find(i => i.item_id === RITEM);
    check('restock container fills on open', !!seeded, JSON.stringify(rc?.containerItems)?.slice(0, 160));

    // Take the one copy out; the view a pull returns must have respawned it, and
    // the player must now hold a copy — the supply never runs dry.
    if (seeded) await run(`pullid ${seeded.id}`);
    const inCase = await query('SELECT 1 FROM player_inventory WHERE container_id=$1 AND item_id=$2', [RFURN, RITEM]);
    const held = await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL', [getPlayer().id, RITEM]);
    check('pulling from a restock container respawns it', inCase.rows.length === 1 && held.rows.length === 1, `inCase=${inCase.rows.length} held=${held.rows.length}`);
  } finally {
    await query('DELETE FROM player_inventory WHERE container_id=$1', [RFURN]).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [getPlayer().id, RITEM]).catch(() => {});
    await deleteFurniture(RFURN).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [RITEM]).catch(() => {});
    getPlayer().current_zone = savedZone;
  }
}

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

const dir = dryExit(zone)[0];
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
  // Excludes prologue zones same as the fake player's home zone above — actually
  // moving into one (this fixture drives a real cmdMove, not just an exits-map
  // read) hits prologueMoveGate's story-flag block regardless of where the move
  // originates from.
  const interiors = zones.filter(z => (z.flags?.is_interior || z.flags?.is_apartment) && z.name && !z.flags?.prologue);
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
    // movePicker carries ordered candidate zone ids so GPS auto-walk can answer the
    // right number itself (it knows which destination it's heading to).
    const pickIds = (amb?.movePicker?.candidates || []).map(c => c.id).sort();
    check('ambiguous move exposes candidate zone ids to the client', JSON.stringify(pickIds) === JSON.stringify([A.id, B.id].sort()) && amb.movePicker.candidates.every((c, i) => c.n === i + 1), JSON.stringify(amb?.movePicker));
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
    mover._lastStepAt = 0; // clear the pacing plugin's cadence clock — this test drives back-to-back moves to check exit indexing, not movement pacing
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

// dragFollowers leader-identity guard: an enemy keys on instanceId, so its
// entity.id is undefined. moveEntity passes that undefined to dragFollowers, and
// a non-following player's `following` is also undefined — so a naive
// `following === leaderId` check dragged every bystander after any moving enemy.
// The guard must ignore a nullish leader and drag only genuine followers.
{
  const dfZone = 'zone_regress_drag_' + process.pid;
  world.zones.set(dfZone, { id: dfZone, name: 'Drag Origin', flags: {}, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });

  const bystanderId = 'rg_drag_bystander_' + process.pid;
  const bystander = { id: bystanderId, handle: 'Bystander', current_zone: dfZone }; // no `following` — undefined
  setLivePlayer(bystanderId, bystander);
  addPlayerToZone(bystanderId, dfZone);

  // The bug: nullish leader (an enemy's undefined id) must not drag a non-follower.
  await dragFollowers(undefined, dfZone, 'north', broadcast);
  check('dragFollowers ignores a nullish leader (enemy id)', bystander.current_zone === dfZone, `zone=${bystander.current_zone}`);

  // Filter integrity: a real leader id still doesn't drag someone not following it.
  await dragFollowers('some_other_leader_id', dfZone, 'north', broadcast);
  check('dragFollowers spares a non-follower for a real leader', bystander.current_zone === dfZone, `zone=${bystander.current_zone}`);

  removeLivePlayer(bystanderId);
  removePlayerFromZone(bystanderId, dfZone);
  world.zones.delete(dfZone);
}

// NPC-residence rental guard: a unit registered in npc_residences reads as an
// occupied home and can't be rented. Fixture uses a real vacant apartment + a real
// NPC (both FK targets), and is torn down in finally so the dev DB stays clean.
{
  const apt = await import('../server/engine/apartments.js');
  const { query: q } = await import('../server/models/db.js');
  const rgZone = 'zone_meridian_unit_301'; // real apartment unit, normally vacant + unowned
  const rgNpc  = 'npc_embassy_barkeep';    // real NPC id (npc_residences.npc_id FK)
  try {
    await q(`INSERT INTO npc_residences (zone_id, npc_id) VALUES ($1,$2)
             ON CONFLICT (zone_id) DO UPDATE SET npc_id=$2`, [rgZone, rgNpc]);
    const hit = await apt.getNpcResidence(rgZone);
    check('getNpcResidence returns the resident', hit?.npc_id === rgNpc, JSON.stringify(hit));
    const miss = await apt.getNpcResidence('zone_not_a_home_' + process.pid);
    check('getNpcResidence null when unregistered', miss === null, JSON.stringify(miss));
    const renter = { id: 'rg_renter_' + process.pid, handle: 'Renter', current_zone: rgZone, credits: 99999 };
    const blocked = await apt.cmdRent(renter);
    check('rent blocked in an NPC residence',
      blocked?.type === 'error' && /lives here/i.test(blocked.message || ''), blocked?.message);
  } finally {
    await q('DELETE FROM npc_residences WHERE zone_id=$1', [rgZone]);
  }
}

// evict (admin housing command + engine rehoming helpers). Covers: (1) the gametable
// plugin's `evict` falls through when the player isn't at a poker table, so the engine
// handler runs; (2) findNearestVacantApartment returns a real vacant unit, preferring
// the same building; (3) the `evict <npc>` command frees the old unit and rehomes the
// NPC into that vacancy (npc_residences + home_zone follow). Real FK targets; the NPC's
// home/zone and role are captured and restored in finally so the dev DB stays clean.
{
  const apt = await import('../server/engine/apartments.js');
  const { query: q } = await import('../server/models/db.js');
  const { world, moveNpcToZone } = await import('../server/engine/world.js');

  // (1) Fall-through: a non-seated player's `evict` is not eaten by gametable. Our
  // fake player isn't admin, so the engine handler answers with the clearance gate —
  // crucially NOT gametable's "take a seat first".
  const ft = await run('evict Nobody');
  check('evict falls through gametable when not at a table',
    !/take a seat/i.test(ft?.message || ''), ft?.message);

  const npc = world.npcs.get('npc_embassy_barkeep');
  const oldZone = 'zone_meridian_unit_301'; // real, normally-vacant Meridian apartment
  const nearZone = 'zone_meridian_unit_302'; // its across-the-hall neighbour (2 hops)
  if (npc) {
    const savedHome = npc.home_zone, savedZone = npc.zone_id, savedRole = getPlayer().role;
    // Capture whoever currently lives next door so we can restore them — the dev DB
    // ships the Meridian near-full, which is exactly why we vacate one unit to make
    // "nearest" deterministic (otherwise the true nearest vacancy is another building).
    const { rows: nb } = await q('SELECT npc_id FROM npc_residences WHERE zone_id=$1', [nearZone]);
    const nearOrigNpc = nb[0]?.npc_id || null;
    try {
      // Seat the NPC in oldZone as its registered home, and vacate the neighbour.
      await q('UPDATE npcs SET home_zone=$1 WHERE id=$2', [oldZone, npc.id]);
      await q(`INSERT INTO npc_residences (zone_id, npc_id) VALUES ($1,$2)
               ON CONFLICT (zone_id) DO UPDATE SET npc_id=$2`, [oldZone, npc.id]);
      await q('DELETE FROM npc_residences WHERE zone_id=$1', [nearZone]);
      npc.home_zone = oldZone;
      moveNpcToZone(npc.id, oldZone);

      // (2) With the neighbour vacant, it's the nearest vacancy (2 hops, same building)
      // — closer than any unit in another building.
      const nearest = await apt.findNearestVacantApartment(oldZone, oldZone);
      check('findNearestVacantApartment picks the closest vacant unit',
        nearest === nearZone, `nearest=${nearest}`);

      // (3) The command itself: admin evicts the NPC → old unit freed, NPC rehomed.
      getPlayer().role = 'admin';
      const r = await run(`evict ${npc.name}`);
      check('evict <npc> reports the rehoming',
        r?.type === 'output' && /moved into/i.test(r?.message || ''), r?.message);
      check('evicted NPC no longer occupies the old unit',
        (await apt.getNpcResidence(oldZone)) === null, oldZone);
      check('evicted NPC now lives in the nearest vacancy',
        npc.home_zone === nearZone && (await apt.getNpcResidence(nearZone))?.npc_id === npc.id,
        `home=${npc.home_zone}`);
      const { rows: cnt } = await q('SELECT count(*)::int c FROM npc_residences WHERE npc_id=$1', [npc.id]);
      check('evicted NPC holds exactly one residence', cnt[0]?.c === 1, JSON.stringify(cnt[0]));
    } finally {
      getPlayer().role = savedRole;
      await q('DELETE FROM npc_residences WHERE npc_id=$1', [npc.id]);
      if (nearOrigNpc)
        await q(`INSERT INTO npc_residences (zone_id, npc_id) VALUES ($1,$2)
                 ON CONFLICT (zone_id) DO UPDATE SET npc_id=$2`, [nearZone, nearOrigNpc]);
      await q('UPDATE npcs SET home_zone=$1, zone_id=$2 WHERE id=$3', [savedHome, savedZone, npc.id]);
      npc.home_zone = savedHome;
      moveNpcToZone(npc.id, savedZone);
    }
  }
}

// Sanctuary + radiation zone tags (Phase 2 of the zone redesign). All fixtures
// are in-memory mutations of live world zone objects — no DB writes — and are
// torn down in finally.
{
  const { getZoneRadiation, isSanctuary, allowsSleep } = await import('../server/engine/zone-tags.js');
  const { getSleepEligibility } = await import('../server/engine/apartments.js');
  const { tickSpawns, getZoneEnemies } = await import('../server/engine/world.js');
  const p = getPlayer();
  const homeZone = world.zones.get(p.current_zone);

  // Protection substrate: the sanctuary tag claims the zone; untagged doesn't.
  check('sanctuary provider registered', getRegisteredProtectionProviders().includes('engine:sanctuary'));
  check('untagged zone has no sanctuary protection', getZoneProtection(homeZone.id)?.reason !== 'sanctuary');
  try {
    homeZone.flags.sanctuary = true;
    check('sanctuary tag grants zone protection', getZoneProtection(homeZone.id)?.reason === 'sanctuary');
    // The dropped is_safe_zone column must never grant anything, even if a
    // stale object still carries the field (61% of the world had it).
    check('isSanctuary ignores legacy is_safe_zone', !isSanctuary({ is_safe_zone: 1, flags: {} }));
    // Sleep: a sanctuary tag is sleepable.
    const elig = getSleepEligibility(p, { id: 'z_synth', flags: { sanctuary: true } });
    check('sleep allowed in a tag-only sanctuary', elig.canSleep === true && elig.reason === 'safe_zone', JSON.stringify(elig));

    // allow_sleep: rest is permitted WITHOUT the sanctuary bundle — the holding
    // cell should be sleepable but grant NO forcefield/combat protection.
    const eligAllow = getSleepEligibility(p, { id: 'z_cell', flags: { allow_sleep: true } });
    check('allow_sleep grants sleep (safe-zone rate)', eligAllow.canSleep === true && eligAllow.reason === 'allowed', JSON.stringify(eligAllow));
    check('allow_sleep is not a sanctuary (no forcefield bundle)',
      allowsSleep({ flags: { allow_sleep: true } }) && !isSanctuary({ flags: { allow_sleep: true } }));

    // Spawn suppression: a due, weight-100 spawn in a sanctuary zone must not fire.
    const anyTimer = [...world.spawnTimers.values()][0];
    if (anyTimer) {
      const synthId = 'regress_sanctuary_spawn';
      world.spawnTimers.set(synthId, { ...anyTimer, spawn_id: synthId, zone_id: homeZone.id, max_count: 50, spawn_weight: 100, respawn_seconds: 9999, nextSpawn: 0 });
      const before = getZoneEnemies(homeZone.id).length;
      await tickSpawns(null);
      const after = getZoneEnemies(homeZone.id).length;
      // The skip path still advances the timer — proves the tick processed the
      // entry rather than early-returning (which would make this test vacuous).
      const processed = (world.spawnTimers.get(synthId)?.nextSpawn ?? 0) > 0;
      world.spawnTimers.delete(synthId);
      check('spawn tick skips a sanctuary zone', processed && after === before, `processed=${processed} enemies ${before} -> ${after}`);
    }
  } finally {
    delete homeZone.flags.sanctuary;
  }

  // Radiation comes from the tag alone (entry formula: floor(rad/10)).
  check('getZoneRadiation reads the tag', getZoneRadiation({ flags: { radiation: 30 } }) === 30);
  check('getZoneRadiation ignores the dropped column', getZoneRadiation({ radiation_level: 20, flags: {} }) === 0);
  const exit0 = allExits(world.zones.get(p.current_zone)).find(e => { const zt = world.zones.get(e.target); return zt && !zt.flags?.water; });
  if (exit0) {
    const destZone = world.zones.get(exit0.target);
    const radBefore = p.radiation || 0;
    try {
      destZone.flags.radiation = 30;
      p._lastStepAt = 0; // clear the pacing plugin's cadence clock (same as the layer-2 move fixtures)
      const mv = await cmdMove(exit0.dir, p, broadcast, { targetZoneId: exit0.target });
      check('moving into a tag-radiation zone applies rad gain',
        mv?.type !== 'error' && (getPlayer().radiation || 0) >= radBefore + 3,
        `rad ${radBefore} -> ${getPlayer().radiation} (${JSON.stringify(mv?.message ?? mv).slice(0, 80)})`);
    } finally {
      delete destZone.flags.radiation;
      getPlayer().radiation = radBefore;
      // Walk back so later suites see the player where earlier layers left them.
      const back = allExits(destZone).find(e => e.target === homeZone.id);
      if (getPlayer().current_zone === destZone.id && back) {
        getPlayer()._lastStepAt = 0;
        await cmdMove(back.dir, getPlayer(), broadcast, { targetZoneId: homeZone.id });
      }
    }
  }
}

// Danger inference (Phase 3 of the zone redesign): spawn-derived, cached on the
// world zone object, tag override > sanctuary > radiation floor > inference.
{
  const { zoneDanger, enemyThreat, bucketThreat, DANGER_RANK } = await import('../server/engine/danger.js');
  const { computeZoneDanger, removeSpawn } = await import('../server/engine/world.js');
  const p = getPlayer();
  const homeZone = world.zones.get(p.current_zone);
  const savedInferred = homeZone._dangerInferred;

  check('enemyThreat scales with hp + damage',
    enemyThreat({ hp_max: 100, weapon: [{ min: 10, max: 20 }] }) === 220);
  check('bucketThreat rank order holds',
    bucketThreat(20) === 'low' && bucketThreat(70) === 'medium' && bucketThreat(120) === 'high' && bucketThreat(220) === 'lethal');
  check('danger tag override wins', zoneDanger({ flags: { danger: 'lethal' }, _dangerInferred: 'low' }) === 'lethal');
  check('sanctuary forces safe', zoneDanger({ flags: { sanctuary: true }, _dangerInferred: 'high' }) === 'safe');
  check('radiation floors danger (lethal at 40+)', zoneDanger({ flags: { radiation: 45 }, _dangerInferred: 'low' }) === 'lethal');
  check('inference cache read', zoneDanger({ flags: {}, _dangerInferred: 'medium' }) === 'medium');

  // Cache recompute: a synthetic beefy spawn raises the zone; removing it recomputes.
  try {
    const synthId = 'regress_danger_spawn';
    world.spawnTimers.set(synthId, { spawn_id: synthId, zone_id: homeZone.id, hp_max: 100, weapon: [{ min: 10, max: 20 }], max_count: 0, spawn_weight: 0, respawn_seconds: 9999, nextSpawn: Number.MAX_SAFE_INTEGER });
    computeZoneDanger(homeZone.id);
    check('computeZoneDanger caches inferred danger from spawns', homeZone._dangerInferred === 'lethal', homeZone._dangerInferred);
    removeSpawn(synthId);
    check('removeSpawn recomputes the zone danger', homeZone._dangerInferred !== 'lethal', homeZone._dangerInferred);
  } finally {
    world.spawnTimers.delete('regress_danger_spawn');
    homeZone._dangerInferred = savedInferred;
  }
  check('DANGER_RANK exports a total order', DANGER_RANK.safe < DANGER_RANK.low && DANGER_RANK.high < DANGER_RANK.lethal);
}

// Non-standable facades (Phase 5 of the zone redesign): a facade-tagged
// building tile auto-forwards movement into its interior entry zone; OUT from
// inside forwards straight back out onto the entrance street tile. Entirely synthetic in-memory
// fixture (street ↔ facade ↔ lobby + an interior map row), torn down in finally.
{
  const { isEnterableFacade, resolveLanding, getMapByParentZone } = await import('../server/engine/world.js');
  const mk = (id, name, extra = {}) => ({ id, name, description: '.', exits: {}, flags: {}, ambient_events: [],
    players: new Set(), enemies: new Set(), npcs: new Set(), corpses: new Set(), map_id: 'map_world', grid_z: 0, ...extra });
  const street = mk('rg_street', 'Regress Street');
  const facade = mk('rg_facade', 'Regress Tower', { flags: { is_building: true, facade: true, building_name: 'Regress Tower', world_exit_zone: 'rg_street' } });
  const lobby  = mk('rg_lobby', 'Regress Lobby', { flags: { is_interior: true }, map_id: 'map_rg_int' });
  street.exits = { north: 'rg_facade' };
  facade.exits = { south: 'rg_street', in: 'rg_lobby' };
  lobby.exits  = { out: 'rg_facade' };
  const p = getPlayer();
  const savedZone = p.current_zone;
  try {
    world.zones.set(street.id, street); world.zones.set(facade.id, facade); world.zones.set(lobby.id, lobby);
    world.maps.set('map_rg_int', { id: 'map_rg_int', name: 'RG Interior', parent_zone_id: 'rg_facade', entry_zone_id: 'rg_lobby' });

    check('isEnterableFacade: facade tag + interior map', isEnterableFacade(facade));
    check('isEnterableFacade: tag required (Tin Lane stays standable)', !isEnterableFacade({ flags: { is_building: true } }));
    check('resolveLanding forwards facades', resolveLanding('rg_facade') === 'rg_lobby');
    check('resolveLanding passes normal zones through', resolveLanding('rg_street') === 'rg_street');
    check('getMapByParentZone finds the interior', getMapByParentZone('rg_facade')?.id === 'map_rg_int');

    // Walk in: street --north--> facade ⇒ land in the lobby, one move result.
    removePlayerFromZone(p.id, p.current_zone);
    p.current_zone = 'rg_street';
    addPlayerToZone(p.id, 'rg_street');
    p._lastStepAt = 0;
    const inMove = await cmdMove('north', p, broadcast);
    check('moving onto a facade lands in the interior entry zone',
      inMove?.type === 'move' && p.current_zone === 'rg_lobby', `zone=${p.current_zone} type=${inMove?.type}`);
    check('facade holds no players after transit', facade.players.size === 0);

    // Walk out: lobby --out--> facade ⇒ forward straight through onto the
    // entrance street tile, never stranding the player on the non-standable facade.
    p._lastStepAt = 0;
    const outMove = await cmdMove('out', p, broadcast);
    check('OUT from the interior forwards onto the entrance street tile',
      outMove?.type === 'move' && p.current_zone === 'rg_street', `zone=${p.current_zone} type=${outMove?.type}`);
    check('facade holds no players after OUT transit', facade.players.size === 0);

    // NPC path-through: moveEntity onto the facade forwards to the lobby.
    const npc = { id: 'rg_npc', name: 'Regress Wanderer', zone_id: 'rg_street', flags: {} };
    world.zones.get('rg_street').npcs.add('rg_npc');
    world.npcs.set('rg_npc', npc);
    const moved = moveEntity(npc, 'rg_facade', broadcast, null);
    check('moveEntity forwards NPCs through the facade',
      moved === true && npc.zone_id === 'rg_lobby', `moved=${moved} zone=${npc.zone_id}`);

    // Locked front door blocks the transit at the gate (player stays outside).
    setDoorCache('rg_door', { id: 'rg_door', zone_id: 'rg_facade', exit_dir: 'in', target_zone: 'rg_lobby', door_type: 'standard', is_open: 0, hp: 10, hp_max: 10, lock_state: 'locked', flags: {}, tags: { 'lock:hololock': { difficulty: 5 } } });
    removePlayerFromZone(p.id, p.current_zone);
    p.current_zone = 'rg_street';
    addPlayerToZone(p.id, 'rg_street');
    p._lastStepAt = 0;
    const blocked = await cmdMove('north', p, broadcast);
    check('a locked front door blocks the facade transit on the street side',
      blocked?.type === 'error' && p.current_zone === 'rg_street', `zone=${p.current_zone} type=${blocked?.type} ${String(blocked?.message).slice(0, 60)}`);
  } finally {
    deleteDoorCache('rg_door');
    world.npcs.delete('rg_npc');
    world.zones.delete('rg_street'); world.zones.delete('rg_facade'); world.zones.delete('rg_lobby');
    world.maps.delete('map_rg_int');
    removePlayerFromZone(p.id, p.current_zone);
    p.current_zone = savedZone;
    addPlayerToZone(p.id, savedZone);
  }
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
