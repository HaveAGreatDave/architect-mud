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
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getAllZones, getLivePlayer, world, setDoorCache, deleteDoorCache, getDoorForExit, frontDoorOf, getApartment, insertFurniture, deleteFurniture, getZone, registerTransientZone, removeTransientZone, isTransientZone, regionForZone, renderOf, specOf, getConnection, getConnectionBetween, getDoorForEdge, doorOnLink } from '../server/engine/world.js';
import { moveEntity } from '../server/engine/ai-behaviour.js';
import { exitTargets, allExits, neighborZoneIds, addExit, removeExit } from '../server/engine/exits.js';
import { cmdMove, dragFollowers } from '../server/engine/commands/movement.js';
import { resolveNamedDestination } from '../server/engine/commands/describe.js';
import { tickOnsets } from '../server/engine/drugs.js';
import { getSelectionState, clearSelectionState } from '../server/engine/sift.js';
import { loadPlugins, getLoadedPlugins, getRegisteredCommands, getRegisteredHooks } from '../server/engine/plugins.js';
import { loadItems } from '../server/engine/items-cache.js';
import { loadDrugs } from '../server/engine/drugs.js';
import { loadMisSettings } from '../server/engine/mis.js';
import { handleCommand } from '../server/engine/commands/index.js';
import { getRegisteredMoveGates } from '../server/engine/movement-gates.js';
import { getRegisteredSpecializedActions } from '../server/engine/specializedActions.js';
import { registerProtectionProvider, getZoneProtection, getRegisteredProtectionProviders } from '../server/engine/protection.js';
import { npcHomedInOwnedUnit, authoredRentCost } from '../server/engine/apartments.js';
import { validateTags, validateZoneColumns, zoneColumnCatalog, TAG_CATALOG } from '../server/engine/tags.js';
import { stopAll } from '../server/engine/scheduler.js';
import { CONTENT_TABLES, EXCLUDED_TABLES, REGISTRY } from '../server/models/content-registry.js';
import { SCHEMA_SQL } from '../server/models/schema.js';
import { handleApiRequest, apiUpdateZone, apiPatchZoneTag } from '../server/api/routes.js';
import { query } from '../server/models/db.js';
import { resolveDefault, deriveWorld, deriveMarker, assignBuildingMarkers, projectEdges, edgesToExits, OPPOSITE } from '../scripts/content/derive.mjs';

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
// The drug cache is boot state in production (server/index.js loads it), and
// anything that resolves a drug reads it. Without it DRUG_CACHE is {}, so every
// drug-touching assertion in the suite silently degrades — a check expecting
// "no cross-load" passes because the cache is empty, not because the law works.
await loadDrugs();
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
    // omitWhenNull columns are AUTHORED (just absent by default), so naming one
    // that's also excluded means the pipeline both writes and refuses to write it.
    for (const c of e.omitWhenNull || []) {
      if (!cols.has(c)) colErrors.push(`${e.table}: omitWhenNull "${c}" not in SCHEMA_SQL`);
      if ((e.excludeColumns || []).includes(c)) colErrors.push(`${e.table}: "${c}" is both omitWhenNull and excludeColumns`);
      if ((e.pk || []).includes(c)) colErrors.push(`${e.table}: pk column "${c}" cannot be omitWhenNull`);
    }
  }
  check('registry pk/excludeColumns/omitWhenNull name real columns', colErrors.length === 0, colErrors.join('; '));

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

  // ── The COLUMN half of a tile (spec §3.1–3.2) ──────────────────────────────
  // The flag bag has been catalogue-validated for a while; the columns were
  // validated by nothing. These pin the catalog to the schema, because a catalog
  // that has drifted from the table it describes is worse than no catalog — it
  // reads as authoritative while an editor generated from it silently omits a
  // field nobody can then set.
  const colCat = zoneColumnCatalog();
  const zoneCols = new Set();
  {
    const block = SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS zones \(([\s\S]*?)\n  \);/m);
    for (const line of (block?.[1] || '').split('\n')) {
      const m = line.match(/^\s{4}"?([a-z_]+)"?\s/);
      if (m && !['primary', 'foreign', 'unique', 'check', 'constraint'].includes(m[1])) zoneCols.add(m[1]);
    }
    for (const m of SCHEMA_SQL.matchAll(/ALTER TABLE zones\s+ADD COLUMN IF NOT EXISTS (\w+)/g)) zoneCols.add(m[1]);
  }
  const phantomCols = Object.keys(colCat).filter(c => !zoneCols.has(c));
  check('every zone_column entry names a real zones column', phantomCols.length === 0, phantomCols.join(', '));

  // Deliberately uncatalogued, with the reason each one is exempt. A new zones
  // column lands here as a failure until somebody decides which side it's on.
  const NOT_AUTHORED = new Set(['id', 'flags', 'exits', 'stains', 'created_by', 'updated_at']);
  const uncatalogued = [...zoneCols].filter(c => !colCat[c] && !NOT_AUTHORED.has(c));
  check('every authored zones column is in the field catalog', uncatalogued.length === 0,
    `${uncatalogued.join(', ')} — catalogue it as zone:<column> or add it to NOT_AUTHORED with a reason`);

  // One shape vocabulary. A catalog entry whose shape shapeError() doesn't know
  // is unvalidated and looks validated, which is the failure mode this whole
  // section exists to remove.
  const KNOWN_SHAPES = new Set(['text', 'flag', 'int', 'number', 'enum', 'ref', 'list', 'object', 'range', 'hot', 'statmap']);
  const oddShapes = [...new Set(Object.values(TAG_CATALOG).map(d => d?.shape))].filter(s => !KNOWN_SHAPES.has(s));
  check('every catalogued shape is one shapeError understands', oddShapes.length === 0, oddShapes.join(', '));
  check('int was collapsed into number', !Object.values(TAG_CATALOG).some(d => d?.shape === 'int'));

  // The Tags screen's dropdown is a THIRD copy of the shape vocabulary, and a
  // shape missing from it is silently rewritten to the first option the moment
  // anybody edits that tag — which is exactly how `number` and `list` entries
  // were one careless save away from becoming `text`.
  {
    const panel = await readFile(join(__dirname, '..', 'client', 'devpanel', 'js', 'panels', 'tags.js'), 'utf8');
    const listed = new Set([...(panel.match(/const SHAPES = \[([^\]]*)\]/)?.[1] || '').matchAll(/'([a-z]+)'/g)].map(m => m[1]));
    const inUse = new Set(Object.values(TAG_CATALOG).map(d => d?.shape).filter(Boolean));
    const missing = [...inUse].filter(s => !listed.has(s));
    check('the Tags screen offers every shape the catalog uses', listed.size > 0 && missing.length === 0,
      missing.length ? `${missing.join(', ')} missing from SHAPES in panels/tags.js` : `${listed.size} shapes`);
  }

  // A `ref` with no refTable, or one naming a table that doesn't exist, is a
  // picker that can't populate and a lint check that silently passes everything.
  const badRefs = Object.entries(TAG_CATALOG)
    .filter(([, d]) => d?.shape === 'ref')
    .filter(([, d]) => !d.refTable || !new RegExp(`CREATE TABLE IF NOT EXISTS ${d.refTable} \\(`).test(SCHEMA_SQL))
    .map(([k, d]) => `${k}→${d.refTable ?? '(none)'}`);
  check('every ref names a real table', badRefs.length === 0, badRefs.join(', '));

  const colBad = validateZoneColumns({ ambient_theme: 'swamp', grid_x: 'twelve', audio_theme_id: 7, ambient_events: 'a pipe knocks' });
  check('validateZoneColumns catches enum/number/ref/list violations', colBad.badShape.length === 4, colBad.badShape.join(' | '));
  check('validateZoneColumns says nothing about absent, null or blank columns',
    validateZoneColumns({ name: 'Somewhere', audio_theme_id: null, marker: '' }).ok);

  // Every live tile must already pass, or the gate is being introduced on top of
  // content that violates it — which is how a check gets quietly disabled later.
  const colErrors = [];
  for (const z of world.zones.values()) {
    const v = validateZoneColumns(z);
    if (!v.ok) colErrors.push(`${z.id}: ${v.badShape.join(', ')}`);
  }
  check(`every live zone passes validateZoneColumns (${world.zones.size} zones)`,
    colErrors.length === 0, colErrors.slice(0, 5).join(' | '));

  const rCol = await apiUpdateZone('zone_regress_tag_probe', { ambient_theme: 'swamp' });
  check('apiUpdateZone rejects an out-of-catalog ambient_theme with 400',
    rCol?.status === 400 && /ambient_theme/.test(rCol?.body?.error || ''), JSON.stringify(rCol?.body).slice(0, 120));
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

  // ── Transient zones (void-travel Slice 1 substrate) ────────────────────────
  // A synthetic zone injected via registerTransientZone must behave like a real
  // zone to movement/describe (which read world.zones) yet stay invisible to the
  // bulk getAllZones scan and never be mistaken for a DB zone. This is the seam
  // the whole void-crossing system stands on.
  {
    const voidId = 'zone_regress_void_' + process.pid;
    const gateId = 'zone_regress_voidgate_' + process.pid;
    world.zones.set(gateId, {
      id: gateId, name: 'Void Gate', description: 'A gap in the perimeter wall.', flags: {}, exits: { south: voidId },
      players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(),
    });
    const vz = registerTransientZone({
      id: voidId, name: 'The Trackless Waste', description: 'Nothing but dust in every direction.',
      map_id: 'map_void', exits: { north: gateId },
    });
    check('registerTransientZone injects into the world store', getZone(voidId) === vz && vz.name === 'The Trackless Waste', getZone(voidId)?.name);
    check('registerTransientZone marks the zone transient', isTransientZone(voidId) === true, String(isTransientZone(voidId)));
    check('registerTransientZone normalizes occupant sets', vz.players instanceof Set && vz.corpses instanceof Set, typeof vz.players);
    check('transient zone excluded from the getAllZones bulk scan', !getAllZones().some(z => z.id === voidId), 'leaked into getAllZones');

    // The spike's core claim: cmdMove tolerates walking INTO a synthetic non-DB zone.
    const mover = getPlayer();
    const savedZone = mover.current_zone;
    mover.current_zone = gateId;
    mover._lastStepAt = 0;
    const into = await cmdMove('south', mover, broadcast);
    check('cmdMove walks a player into a transient zone', into?.type === 'move' && mover.current_zone === voidId, `${into?.type} zone=${mover.current_zone}`);
    check('player is an occupant of the transient zone after moving in', getZone(voidId).players.has(mover.id), [...getZone(voidId).players].join(','));

    // …and back out again.
    mover._lastStepAt = 0;
    const out = await cmdMove('north', mover, broadcast);
    check('cmdMove walks a player back out of a transient zone', out?.type === 'move' && mover.current_zone === gateId, `${out?.type} zone=${mover.current_zone}`);

    // removeTransientZone cleans up, and refuses to evict a real DB zone.
    check('removeTransientZone removes the synthetic zone', removeTransientZone(voidId) === true && !getZone(voidId), String(!!getZone(voidId)));
    check('removeTransientZone refuses to evict a real DB zone', zones[0] && removeTransientZone(zones[0].id) === false && !!getZone(zones[0].id), 'evicted a real zone!');

    mover.current_zone = savedZone;
    world.zones.delete(gateId);
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

// LAW: a building's front door is the SAME door however you reach it. It sits on the
// facade↔interior seam, which is one hop further in than a near/far-side lookup gets
// from the street — a facade is never stood on. Three consumers reached through the
// facade for it and reached differently: movement handled cardinal AND legacy seams,
// ai-behaviour matched only legacy 'in'/'out' (so a locked shop never stopped an NPC
// at any of the 52 cardinal-seam buildings), and the door verbs never looked at all
// (`open door` from the street returned null for every building). frontDoorOf is the
// one implementation they now share; these assertions pin BOTH seam labels, because
// the legacy-only version passed the 'in'/'out' half of this test.
{
  const streetId = 'zone_regress_street_' + process.pid;
  const facadeId = 'zone_regress_facade_' + process.pid;
  const entryId = 'zone_regress_entry_' + process.pid;
  const mapId = 'map_regress_int_' + process.pid;
  const frontId = 'door_regress_front_' + process.pid;
  const mkZone = (id, name, flags, exits, map) => world.zones.set(id, {
    id, name, flags, exits, map_id: map || null,
    description: 'A regress fixture.', ambient_theme: 'indoors', ambient_events: [],
    players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), items: new Set(),
  });
  // Seam labelled with CARDINALS — the shape 52 of the 56 facade-anchored doors use.
  mkZone(streetId, 'Regress Street', {}, { east: facadeId });
  mkZone(facadeId, 'Regress Shop', { facade: true, is_building: true, entrance: 'west' }, { west: streetId, east: entryId });
  mkZone(entryId, 'Regress Shop Floor', { is_interior: true, is_building: true }, { west: facadeId }, mapId);
  world.maps.set(mapId, { id: mapId, parent_zone_id: facadeId, entry_zone_id: entryId });
  setDoorCache(frontId, {
    id: frontId, zone_id: facadeId, exit_dir: 'east', target_zone: entryId,
    hp: 100, hp_max: 100, is_open: 0, lock_state: 'locked', tags: {},
  });

  check('frontDoorOf resolves a CARDINAL facade seam', frontDoorOf(getZone(facadeId))?.id === frontId,
    String(frontDoorOf(getZone(facadeId))?.id));

  // The door verbs must reach it from the STREET. A locked door short-circuits before
  // any DB write, so this proves resolution without touching the doors table.
  const saved = getPlayer().current_zone;
  getPlayer().current_zone = streetId;
  addPlayerToZone(P.id, streetId);
  const openFromStreet = await run('open door east');
  check('`open door` from the street reaches the front door', /locked/i.test(openFromStreet?.message || ''),
    JSON.stringify(openFromStreet)?.slice(0, 120));

  // ...and `look` must SAY so. A door that stops the step and describes itself as an
  // open way through is the specific lie this pins: the building keeps its name (you
  // can see which building it is from the street) and gains the door's state.
  const lookStreet = await run('look');
  const streetText = (lookStreet?.message || '').replace(/<[^>]*>/g, '');
  check('`look` shows the front door on a building, keeping its name',
    /Regress Shop/.test(streetText) && /\(locked\)/.test(streetText),
    streetText.split('\n').find(l => /Buildings:/.test(l)) || streetText.slice(0, 120));

  // The far-side case for ordinary exits: the door row lives in the NEIGHBOUR and
  // points back. 58 shipped doors are anchored one-sided like this and used to read
  // as plain exits from the other room.
  const farId = 'zone_regress_far_' + process.pid;
  const farDoorId = 'door_regress_far_' + process.pid;
  mkZone(farId, 'Regress Far Room', {}, { south: streetId });
  world.zones.get(streetId).exits = { east: facadeId, north: farId };
  setDoorCache(farDoorId, {
    id: farDoorId, zone_id: farId, exit_dir: 'south', target_zone: streetId,
    name: 'a steel shutter', hp: 100, hp_max: 100, is_open: 0, lock_state: null, tags: {},
  });
  const lookFar = (await run('look'))?.message || '';
  check('`look` shows a door anchored on the FAR side of an ordinary exit',
    /steel shutter/.test(lookFar), lookFar.replace(/<[^>]*>/g, '').split('\n').find(l => /Exits:/.test(l)) || '');
  deleteDoorCache(farDoorId);
  world.zones.delete(farId);
  world.zones.get(streetId).exits = { east: facadeId };

  // Same building wired the LEGACY way ('in'/'out'). Both must resolve, or half the
  // world silently has no front door.
  world.zones.get(facadeId).exits = { west: streetId, in: entryId };
  world.zones.get(entryId).exits = { out: facadeId };
  setDoorCache(frontId, { ...getDoorForExit(facadeId, 'east', entryId) || {}, id: frontId, zone_id: facadeId, exit_dir: 'in', target_zone: entryId, hp: 100, hp_max: 100, is_open: 0, lock_state: 'locked', tags: {} });
  check('frontDoorOf resolves a LEGACY in/out facade seam', frontDoorOf(getZone(facadeId))?.id === frontId,
    String(frontDoorOf(getZone(facadeId))?.id));

  removePlayerFromZone(P.id, streetId);
  getPlayer().current_zone = saved;
  addPlayerToZone(P.id, saved);
  deleteDoorCache(frontId);
  world.maps.delete(mapId);
  world.zones.delete(streetId); world.zones.delete(facadeId); world.zones.delete(entryId);
}

// LAW: defaults-and-overrides resolves most-specific-first, and the AUTHORED world
// actually uses it. resolveDefault is the primitive every later derivation calls
// (map-pipeline-spec §7.3), so its precedence order is pinned here rather than
// discovered later from a tile that plays the wrong song. The live half — that a
// Coldwater tile with no override still gets the region's theme — is what turns
// 5,785 nulls into 2 authored values; if the region rung ever stops firing, the
// world goes silent and nothing else would notice.
{
  const palette = { terrains: { concrete: { audio_theme_id: 'song_from_palette' } } };
  const region = { id: 'region_regress', defaults: { audio_theme_id: 'song_from_region' } };
  // The palette rung is reached through the tile's TERRAIN. There is deliberately
  // no palette-wide default terrain — an unpainted tile has no ground surface, and
  // inventing one would have painted 530 interiors concrete grey.
  const bare = { id: 'z', flags: { terrain: 'concrete' } };

  check('resolveDefault: tile override wins over region',
    resolveDefault('audio_theme_id', { ...bare, audio_theme_id: 'song_own' }, region, palette) === 'song_own');
  check('resolveDefault: region beats the palette',
    resolveDefault('audio_theme_id', bare, region, palette) === 'song_from_region');
  check('resolveDefault: palette catches a tile with no region',
    resolveDefault('audio_theme_id', bare, null, palette) === 'song_from_palette');
  check('resolveDefault: falls through to the global default',
    resolveDefault('ambient_theme', bare, null, null) === 'indoors');
  // A null anywhere on the chain means "no opinion", never "stop here" — the one
  // thing the mechanism deliberately cannot express (see derive.mjs).
  check('resolveDefault: a null override does not shadow the region',
    resolveDefault('audio_theme_id', { ...bare, audio_theme_id: null }, region, null) === 'song_from_region');
  check('resolveDefault: unknown key with nothing to say resolves null',
    resolveDefault('marker', bare, null, null) === null);
  check('resolveDefault is pure — no DB, no clock, no RNG',
    resolveDefault('audio_theme_id', bare, region, palette) === resolveDefault('audio_theme_id', bare, region, palette));

  // The authored world, as loaded. Not a fixture: these are the real region rows.
  const themed = getAllZones().filter(z => z.flags?.region_id && !z.audio_theme_id);
  const withTheme = themed.filter(z => resolveDefault('audio_theme_id', z, regionForZone(z)));
  check('region defaults reach the tiles that inherit them',
    themed.length > 0 && withTheme.length === themed.length,
    `${withTheme.length}/${themed.length} region tiles resolve a theme`);
  check('a tile outside every region resolves no theme',
    getAllZones().filter(z => !z.flags?.region_id)
      .every(z => resolveDefault('audio_theme_id', z, regionForZone(z)) === null));
  // Every authored default must name a song that EXISTS. content:lint checks this
  // against the file tree; this checks the database the world actually booted from,
  // because a JSONB value has no foreign key to break loudly.
  const wanted = [...world.regions.values()].map(r => r.defaults?.audio_theme_id).filter(Boolean);
  const known = new Set((await query('SELECT id FROM audio_songs')).rows.map(r => r.id));
  const badDefaults = wanted.filter(id => !known.has(id));
  check('every region default names a real song', wanted.length > 0 && badDefaults.length === 0,
    badDefaults.length ? badDefaults.join(', ') : `${wanted.length} authored`);
}

// LAW: presentation is DERIVED AT BUILD TIME, and there is exactly one derivation.
// Every renderer reads zone_render.spec; none of them owns a palette. These pin the
// three claims that makes: the table is complete, the function is pure, and the
// function is deterministic — because a derived value that varies by machine is
// worse than one computed at runtime, not better.
{
  const palettePath = join(__dirname, '..', 'content', 'map', 'terrain.json');
  const palette = existsSync(palettePath) ? JSON.parse(await readFile(palettePath, 'utf8')) : null;
  check('the terrain palette exists and has entries', !!palette && Object.keys(palette.terrains || {}).length > 0);

  // Purity is enforced by the seam, not by inspection (spec §7.1) — but the seam
  // only holds while derive imports nothing. An import here is the one edit that
  // would let a query() into the build without anybody noticing.
  const deriveSrc = await readFile(join(__dirname, '..', 'scripts', 'content', 'derive.mjs'), 'utf8');
  const imports = [...deriveSrc.matchAll(/^\s*import\s.+$/gm)].map(m => m[0].trim());
  check('derive.mjs imports nothing — no DB handle, no fs, no clock can reach it',
    imports.length === 0, imports.join(' | '));

  const zonesForDerive = getAllZones().map(z => ({
    id: z.id, marker: z.marker, color: z.color, bg_color: z.bg_color,
    ambient_theme: z.ambient_theme, audio_theme_id: z.audio_theme_id, flags: z.flags,
  }));
  const regionsForDerive = [...world.regions.values()];
  const ser = (w) => JSON.stringify([...w.render.entries()]);
  const a = deriveWorld({ zones: zonesForDerive, regions: regionsForDerive, palette });
  const b = deriveWorld({ zones: zonesForDerive, regions: regionsForDerive, palette });
  check('deriveWorld is deterministic — same input, byte-identical output', ser(a) === ser(b));
  // Shuffled input must not change the output: derive is whole-map and sorted, so
  // it can't depend on which rows an upsert happened to touch first (§7.2).
  const shuffled = [...zonesForDerive].reverse();
  check('deriveWorld does not depend on input order',
    ser(deriveWorld({ zones: shuffled, regions: regionsForDerive, palette })) === ser(a));

  // Completeness. A tile with no derived row renders with no fill at all, and the
  // renderers have no fallback any more — that is the point, so this must hold.
  const missing = getAllZones().filter(z => !renderOf(z.id));
  check(`every zone has a zone_render row (${world.render.size} rows)`, missing.length === 0,
    missing.slice(0, 3).map(z => z.id).join(', ') + (missing.length ? ' — run npm run map:derive' : ''));
  const noSpec = getAllZones().filter(z => !specOf(z.id));
  check('every zone_render row carries a spec', noSpec.length === 0, noSpec.slice(0, 3).map(z => z.id).join(', '));

  // Every painted terrain must resolve in the palette, or the tile paints nothing.
  const unknownTerrain = [...new Set(getAllZones().map(z => z.flags?.terrain).filter(Boolean))]
    .filter(t => !palette?.terrains?.[t]);
  check('every painted terrain resolves in the palette', unknownTerrain.length === 0, unknownTerrain.join(', '));

  // A painted tile's fill comes from the palette, not from its authored bg_color —
  // except where the palette says otherwise. Both halves, on real tiles.
  const paintedNoOverride = getAllZones().find(z => z.flags?.terrain === 'redrock');
  if (paintedNoOverride) {
    check('a painted tile takes the palette fill, not its authored room colour',
      specOf(paintedNoOverride.id).fill === palette.terrains.redrock.fill,
      `${specOf(paintedNoOverride.id).fill} vs authored ${paintedNoOverride.bg_color}`);
  }
  const authoredWins = getAllZones().find(z => z.flags?.terrain === 'water' && z.bg_color);
  if (authoredWins) {
    check('authored_bg_wins terrain keeps the tile\'s own colour',
      specOf(authoredWins.id).fill === authoredWins.bg_color);
  }

  // THE PACING BUG (spec §1.2). Pacing keyed off flags.icon matching /^road_/, so a
  // tile painted `road` with no authored icon moved you at walking pace. The painted
  // fact and the mechanical fact are the same fact now.
  const paintedRoadNoIcon = getAllZones().find(z =>
    z.flags?.terrain === 'road' && !/^(road_|runway_)/.test(z.flags?.icon || '') && !z.flags?.artery);
  if (paintedRoadNoIcon) {
    check('a painted road with no authored icon carries the road speed-up',
      specOf(paintedRoadNoIcon.id).speed_mult === 2,
      `${paintedRoadNoIcon.id} → ${specOf(paintedRoadNoIcon.id).speed_mult}`);
  }
  check('a non-road terrain carries no speed-up',
    specOf(getAllZones().find(z => z.flags?.terrain === 'redrock')?.id)?.speed_mult === 1);

  // The step-1 loan, repaid: the resolved audio theme now lives in the table, and it
  // must agree with what resolveDefault would have said at the call site.
  const themed = getAllZones().filter(z => z.flags?.region_id).slice(0, 200);
  const themeMismatch = themed.filter(z =>
    renderOf(z.id).audio_theme_id !== resolveDefault('audio_theme_id', z, regionForZone(z)));
  check('the derived audio theme agrees with resolveDefault', themeMismatch.length === 0,
    themeMismatch.slice(0, 3).map(z => z.id).join(', '));
  check('zone_render.ambient_theme is always present',
    getAllZones().every(z => !!renderOf(z.id).ambient_theme));

  // ── deriveMarker: four jobs, separated (spec §7.4) ─────────────────────────
  // `zones.marker` meant four unrelated things. After the split it means exactly
  // one: a human overrode this tile's map code.
  const bldCtx = { buildingMarkers: new Map([['zone_mk_probe', 'ZZ']]) };
  const mk = (z, ctx = bldCtx) => deriveMarker(z, palette, ctx);
  check('deriveMarker: an authored marker always wins',
    mk({ id: 'zone_mk_probe', map_id: 'map_world', marker: '☠', flags: { facade: true } }) === '☠');
  check('deriveMarker: a building takes its whole-map assignment',
    mk({ id: 'zone_mk_probe', map_id: 'map_world', flags: { facade: true } }) === 'ZZ');
  check('deriveMarker: an apartment takes its floor designation',
    mk({ id: 'z', name: 'Unit 2A', flags: { is_apartment: true } }) === '2A'
    && mk({ id: 'z', name: 'Halcyon Residence 41-A', flags: { is_apartment: true } }) === '41');
  check('deriveMarker: sewer art comes from connectivity',
    mk({ id: 'zone_under_1_1', grid_z: -1, exits: { north: 'a', south: 'b' } }) === '║'
    && mk({ id: 'zone_under_1_1', grid_z: -1, exits: { north: 'a', east: 'b', south: 'c', west: 'd' } }) === '╬');
  // The one case §7.4 got wrong about this world: terrain glyphs are hand-placed
  // decoration, not a function of the paint, so the palette derives nothing.
  check('deriveMarker: painted ground derives no glyph',
    mk({ id: 'z', flags: { terrain: 'water' } }) === null);

  // A building's code can only be unique if something sees every building at once.
  {
    const stripped = getAllZones().map(z => (z.map_id === 'map_world' && (z.flags?.facade || z.flags?.is_building))
      ? { ...z, marker: null } : z);
    const { markers, collisions } = assignBuildingMarkers(stripped);
    const codes = [...markers.values()].filter(Boolean);
    check(`derived building codes are unique across the world (${codes.length})`,
      codes.length > 0 && new Set(codes).size === codes.length);
    check('nothing collides once every code is derived', collisions.length === 0);
    // Order-independence matters more here than anywhere: assignment is sequential,
    // so a different row order could otherwise hand two buildings each other's code.
    const rev = assignBuildingMarkers([...stripped].reverse()).markers;
    check('building assignment does not depend on row order',
      [...markers].every(([id, code]) => rev.get(id) === code));
  }

  // The migration itself: derivation must reproduce the world that shipped. Every
  // authored marker still draws; nothing was invented and nothing was lost.
  const markerDrift = getAllZones().filter(z => {
    const authored = z.marker == null ? null : String(z.marker).trim() || null;
    return (renderOf(z.id).marker ?? null) !== authored;
  });
  check(`every tile draws the marker it shipped with (${world.zones.size} zones)`,
    markerDrift.length === 0, markerDrift.slice(0, 3).map(z => `${z.id}: ${z.marker} → ${renderOf(z.id).marker}`).join(' | '));
}

// LAW: connectivity is PROJECTED — grid geometry plus the things geometry cannot
// say (spec §7.5). `zones.exits` is still what the engine boots from, so the whole
// value of this step is the LAST check in this block: the projected graph and the
// authored exits must agree edge for edge. The moment they don't, `exits` cannot
// leave content, and the two would be two sources of truth instead of one.
{
  const connDir = join(__dirname, '..', 'content', 'connections');
  const connections = existsSync(connDir)
    ? await Promise.all((await readdir(connDir)).filter(f => f.endsWith('.json'))
        .map(async f => JSON.parse(await readFile(join(connDir, f), 'utf8'))))
    : [];
  check(`content/connections/ is populated (${connections.length} files)`, connections.length > 0);

  // Every connection file must be shaped so the build can act on it. A dangling
  // end is silently skipped by projectEdges, which is exactly why lint errors on
  // it — but the file's own fields have to hold up here too.
  const zoneIds = new Set(getAllZones().map(z => z.id));
  const badEnd = connections.filter(c => !zoneIds.has(c.a) || !zoneIds.has(c.b));
  check('every connection joins two real zones', badEnd.length === 0,
    badEnd.slice(0, 3).map(c => c.id).join(', '));
  const badDir = connections.filter(c => !c.dir || (!OPPOSITE[c.dir] && !c.one_way));
  check('every two-way connection uses a direction the build can reverse', badDir.length === 0,
    badDir.slice(0, 3).map(c => `${c.id}:${c.dir}`).join(', '));
  const dupIds = connections.length - new Set(connections.map(c => c.id)).size;
  check('connection ids are unique — a lock is keyed by one (§6)', dupIds === 0);

  const zonesForEdges = getAllZones().map(z => ({
    id: z.id, map_id: z.map_id, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z, flags: z.flags,
  }));
  const { edges, undeclaredOneWays, unusedBlocks } = projectEdges(zonesForEdges, connections);
  const serE = (e) => JSON.stringify(e);
  check('projectEdges is deterministic', serE(edges) === serE(projectEdges(zonesForEdges, connections).edges));
  check('projectEdges does not depend on input order',
    serE(edges) === serE(projectEdges([...zonesForEdges].reverse(), [...connections].reverse()).edges));

  // The undeclared one-way (§7.5): a step that goes and does not come back with
  // nothing saying so. A warp the map cannot draw and nobody chose.
  check('no undeclared one-way edges', undeclaredOneWays.length === 0,
    undeclaredOneWays.slice(0, 3).map(e => `${e.from_zone} -${e.direction}-> ${e.to_zone}`).join(' | '));
  check('no connection blocks something geometry never projected', unusedBlocks.length === 0,
    unusedBlocks.slice(0, 3).join(', '));

  // …and the detector has teeth. A connection that REDIRECTS a direction is the
  // realistic way to strand a neighbour: A's north now goes to C, but B's south
  // still comes back to A, so the pair is passable one way and nobody said so.
  {
    const at = (id, x, y) => ({ id, map_id: 'map_probe', grid_x: x, grid_y: y, grid_z: 0, flags: {} });
    const probe = [at('zp_a', 0, 0), at('zp_b', 0, -1), at('zp_c', 5, 5)];
    const clean = projectEdges(probe, []);
    check('projectEdges: two adjacent tiles project both ways', clean.edges.length === 2
      && clean.undeclaredOneWays.length === 0);
    const redirected = projectEdges(probe, [{ id: 'conn_probe', a: 'zp_a', b: 'zp_c', dir: 'north', one_way: true }]);
    check('projectEdges: a redirect that strands the neighbour is reported',
      redirected.undeclaredOneWays.length === 1
      && redirected.undeclaredOneWays[0].from_zone === 'zp_b');
    const walled = projectEdges(probe, [{ id: 'conn_probe', a: 'zp_a', b: 'zp_b', dir: 'north', blocked: true }]);
    check('projectEdges: a wall removes both directions', walled.edges.length === 0);
    const orphanWall = projectEdges(probe, [{ id: 'conn_probe', a: 'zp_a', b: 'zp_c', dir: 'north', blocked: true }]);
    check('projectEdges: a wall between tiles that never touched is reported',
      orphanWall.unusedBlocks.length === 1);
  }

  // The grid must still be doing the work. If a refactor quietly broke the
  // geometry pass, connection files would silently become the whole graph and
  // every one of the checks above would still pass on a much smaller world.
  const kinds = edges.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {});
  check(`geometry projects the bulk of the graph (${kinds.grid} grid, ${kinds.authored || 0} authored, ${kinds.portal || 0} portal)`,
    kinds.grid > (edges.length * 0.9));

  // ── The agreement gate (§11 step 6) ────────────────────────────────────────
  // "Cut over only when they agree." This is the check that earns the cutover.
  const authoredEdges = new Set();
  for (const z of getAllZones()) {
    for (const [dir, v] of Object.entries(z.exits || {})) {
      for (const t of (Array.isArray(v) ? v : [v])) if (t) authoredEdges.add(`${z.id}|${dir}|${t}`);
    }
  }
  const projectedEdges = new Set(edges.map(e => `${e.from_zone}|${e.direction}|${e.to_zone}`));
  const gaps = [...authoredEdges].filter(k => !projectedEdges.has(k));
  const invented = [...projectedEdges].filter(k => !authoredEdges.has(k));
  check(`the projected graph loses no authored exit (${authoredEdges.size} edges)`, gaps.length === 0,
    gaps.slice(0, 3).join(' | '));
  check('the projected graph invents no exit', invented.length === 0, invented.slice(0, 3).join(' | '));

  // Shape, not just membership: exits lets one direction hold an ARRAY (two
  // elevators do), and a graph that flattens those to one target loses nine
  // floors while still passing a set comparison.
  const view = edgesToExits(edges);
  const norm = (o) => JSON.stringify(Object.keys(o || {}).sort()
    .map(k => [k, [].concat(o[k]).filter(Boolean).slice().sort()]));
  const shapeDrift = getAllZones().filter(z => norm(z.exits) !== norm(view.get(z.id)));
  check('zone_edges presents the same exits object the engine boots from', shapeDrift.length === 0,
    shapeDrift.slice(0, 3).map(z => z.id).join(', '));

  // And the table the build actually wrote — not just what derive would say now.
  const written = await query('SELECT count(*)::int AS n FROM zone_edges');
  check(`zone_edges is built (${written.rows[0].n} rows)`, written.rows[0].n === edges.length,
    `table ${written.rows[0].n} vs derived ${edges.length} — run npm run map:derive`);
}

// LAW: the Studio computes no presentation and hand-writes no form field
// (spec §10). Both are properties of source, not behaviour, so they are asserted
// by reading it: the moment the tool grows its own palette or its own field list
// it stops being a preview of the build and becomes a second opinion about it —
// which is precisely the three-disagreeing-palettes bug step 3 deleted.
{
  const dir = join(__dirname, '..', 'tools', 'studio');
  const serve = await readFile(join(dir, 'serve.mjs'), 'utf8');
  const client = await readFile(join(dir, 'studio.js'), 'utf8');

  check('the Studio imports the build\'s derive module',
    /from '\.\.\/\.\.\/scripts\/content\/derive\.mjs'/.test(serve));
  check('the Studio runs the same lint the deploy gate runs',
    /lintContentTree/.test(serve));
  check('the Studio validates writes with the engine\'s own shape checks',
    /validateZoneColumns/.test(serve) && /validateTags/.test(serve));
  check('the Studio builds its forms from the field catalog',
    /zoneColumnCatalog/.test(serve) && /catalog\.columns/.test(client));

  // No hex literals in the client: a colour written here is a colour the build did
  // not produce. The CSS lives in index.html, which is chrome, not map paint.
  const hexes = [...client.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0])
    .filter(h => !['#0e0f12', '#c8c8cc', '#1a1c21', '#6ee7d0', '#ffd479'].includes(h));
  check('the Studio client paints no colour of its own invention', hexes.length === 0, hexes.join(', '));
  check('the Studio client owns no terrain palette',
    !/TERRAIN_FILL|luminanceTextColor|terrains\s*:\s*\{/.test(client));

  // No database in the process at all — that is the whole claim of §10.
  check('no database can be reached from the Studio',
    !/models\/db\.js|from 'pg'|require\('pg'\)/.test(serve + client));
}

// LAW: ONE FIXTURE PER CONNECTION (spec §6.3, §11 step 7). A door is a fixture on
// an authored link, not a thing that lives at a coordinate. 56 of 117 seams used
// to carry two rows — one authored from each side, with two lock_states, two hp
// pools and two tag sets — which is "a door open in `look` and locked on move"
// waiting for somebody to edit one of them.
{
  const doors = [...world.doors.values()];
  check(`doors are loaded (${doors.length})`, doors.length > 0);

  const unanchored = doors.filter(d => !d.connection_id);
  check('every door names the connection it is a fixture on', unanchored.length === 0,
    unanchored.slice(0, 3).map(d => `${d.id} (${d.zone_id} ${d.exit_dir})`).join(', ')
    + (unanchored.length ? ' — run scripts/content/anchor-doors.mjs' : ''));

  const dangling = doors.filter(d => d.connection_id && !getConnection(d.connection_id));
  check('every door\'s connection exists', dangling.length === 0, dangling.slice(0, 3).map(d => d.id).join(', '));

  const perConn = new Map();
  for (const d of doors) {
    if (!d.connection_id) continue;
    if (!perConn.has(d.connection_id)) perConn.set(d.connection_id, []);
    perConn.get(d.connection_id).push(d.id);
  }
  const doubled = [...perConn.entries()].filter(([, ids]) => ids.length > 1);
  check(`no connection carries two doors (${perConn.size} seams)`, doubled.length === 0,
    doubled.slice(0, 3).map(([c, ids]) => `${c}: ${ids.join(' + ')}`).join(' | '));

  // A door hung on a wall is a door into a wall.
  const onWalls = doors.filter(d => getConnection(d.connection_id)?.blocked);
  check('no door is hung on a blocked connection', onWalls.length === 0, onWalls.slice(0, 3).map(d => d.id).join(', '));

  // The §6.3 property itself: the seam answers to BOTH its ends, identically.
  // This is what the near-then-far dance was approximating at six call sites.
  const asym = doors.filter(d => {
    const c = getConnection(d.connection_id);
    if (!c) return false;
    const fromA = getDoorForEdge(c.a, c.b), fromB = getDoorForEdge(c.b, c.a);
    return fromA?.door?.id !== d.id || fromB?.door?.id !== d.id
      || fromA.side !== 'a' || fromB.side !== 'b';
  });
  check('getDoorForEdge finds the same door from either end, and knows which end',
    asym.length === 0, asym.slice(0, 3).map(d => d.id).join(', '));

  // …and the direction-taking resolver every call site actually uses agrees.
  const linkMiss = doors.filter(d => {
    const c = getConnection(d.connection_id);
    if (!c) return false;
    const far = c.a === d.zone_id ? c.b : c.a;
    return doorOnLink(d.zone_id, d.exit_dir, far)?.id !== d.id;
  });
  check('doorOnLink resolves every door from the side it is recorded on',
    linkMiss.length === 0, linkMiss.slice(0, 3).map(d => `${d.id} ${d.zone_id} ${d.exit_dir}`).join(' | '));

  // The keycard minter is deleted as a MECHANISM (spec §6), not merely unused —
  // it manufactured a stray item and anchored a door id inside a player's pocket.
  // A keycardlock still reads an AUTHORED item, which is the bearer-key pattern
  // it was pretending to be.
  const doorsSrc = await readFile(join(__dirname, '..', 'server', 'engine', 'commands', 'doors.js'), 'utf8');
  const routesSrc = await readFile(join(__dirname, '..', 'server', 'api', 'routes.js'), 'utf8');
  check('nothing mints a keycard any more',
    !/keycard_\$\{|apiCreateKeycard/.test(doorsSrc + routesSrc));
  const minted = await query("SELECT count(*)::int AS n FROM items WHERE id LIKE 'keycard\\_%'");
  check('no auto-minted keycard survives in the catalog', minted.rows[0].n === 0, `${minted.rows[0].n} found`);
}

// LAW: no NPC may be homed in a PLAYER-OWNED apartment (the "someone's in Akerson's
// 2A" bug class). npcHomedInOwnedUnit is the predicate reconcileNpcHomesVsOwnership
// acts on at boot; assert it against synthetic in-memory state (no DB writes). The
// rehome path itself rides rehomeNpc/findNearestVacantApartment, exercised elsewhere.
{
  const ownedId = 'zone_regress_owned_' + process.pid;
  const openId = 'zone_regress_open_' + process.pid;
  world.zones.set(ownedId, { id: ownedId, name: 'Owned Flat', flags: { is_apartment: true }, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });
  world.zones.set(openId, { id: openId, name: 'Open Hall', flags: {}, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });
  const squatter = { id: 'npc_rg_squat_' + process.pid, name: 'Squatter', home_zone: ownedId };

  // Unowned apartment → not a squat (the shared-housing pool is intended).
  world.apartments.set(ownedId, { zone_id: ownedId, owner_id: null });
  check('NPC in an UNOWNED apartment is not a squatter', npcHomedInOwnedUnit(squatter) === false, 'owner=null');
  // A player takes the deed → the same NPC now squats a player-owned unit.
  world.apartments.set(ownedId, { zone_id: ownedId, owner_id: 'player_regress' });
  check('NPC in a PLAYER-OWNED apartment is a squatter', npcHomedInOwnedUnit(squatter) === true, 'owner set');
  // Homed in a non-apartment, or nowhere → never a squat.
  check('NPC homed in a non-apartment is not a squatter', npcHomedInOwnedUnit({ id: 'x', home_zone: openId }) === false);
  check('NPC with no home is not a squatter', npcHomedInOwnedUnit({ id: 'x' }) === false);

  // Authored rent price is CONTENT on the zone (flags.rent_cost), read via
  // authoredRentCost — NOT the player-classed apartments tenancy row. Unpriced ⇒ 100c.
  check('authoredRentCost reads flags.rent_cost', authoredRentCost({ flags: { rent_cost: 250 } }) === 250);
  check('authoredRentCost defaults to 100c when unpriced', authoredRentCost({ flags: {} }) === 100 && authoredRentCost({}) === 100 && authoredRentCost(null) === 100);
  check('authoredRentCost ignores a non-numeric flag', authoredRentCost({ flags: { rent_cost: 'lots' } }) === 100);
  check('authoredRentCost honours a free (0c) unit', authoredRentCost({ flags: { rent_cost: 0 } }) === 0);

  world.apartments.delete(ownedId);
  world.zones.delete(ownedId);
  world.zones.delete(openId);
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
  const { isEnterableFacade } = await import('../server/engine/world.js');
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

  // Radiation comes from the tag alone; exposure now trickles from the RADIATION
  // MODEL in the minute tick (+1/10min on any hot tile), NOT a per-step spike.
  check('getZoneRadiation reads the tag', getZoneRadiation({ flags: { radiation: 30 } }) === 30);
  check('getZoneRadiation ignores the dropped column', getZoneRadiation({ radiation_level: 20, flags: {} }) === 0);
  // Skip water (impassable) AND enterable facades: stepping onto a facade forwards you
  // into its interior (or bounces off a gated Threshold), so the facade tile itself is
  // never a place you stand and accrue radiation — pick a plain standable neighbour.
  const exit0 = allExits(world.zones.get(p.current_zone)).find(e => { const zt = world.zones.get(e.target); return zt && !zt.flags?.water && !isEnterableFacade(zt); });
  if (exit0) {
    const destZone = world.zones.get(exit0.target);
    const radBefore = p.radiation || 0;
    try {
      destZone.flags.radiation = 30;
      p._lastStepAt = 0; // clear the pacing plugin's cadence clock (same as the layer-2 move fixtures)
      const mv = await cmdMove(exit0.dir, p, broadcast, { targetZoneId: exit0.target });
      check('moving into a tag-radiation zone no longer spikes rad on the step',
        mv?.type !== 'error' && (getPlayer().radiation || 0) === radBefore,
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

// ── Facade↔interior arrow alignment (real content) ──────────────────────────
// The door is now AUTHORED (facade flags.entrance), not inferred from the road
// graph — so terrain painting can't silently relocate it (the recurrence that
// moved Pawn & Pity's door off Marrow Street). Three invariants keep the arrows
// honest, each a hard fail:
//   1. every enterable facade has flags.entrance (buildingEntranceDir reads it;
//      no flag ⇒ no door arrow, and no anchor for the interior exit)
//   2. a facade has exactly ONE interior map — a duplicate hid the Ration Nine
//      diner/grocery collision, because getMapByParentZone silently took the first
//   3. the interior's single cardinal out-exit points the SAME way as the door
//      (NOT the mirror of the facade→interior link — the reverted intuition)
{
  const { isEnterableFacade, buildingEntranceDir, interiorExitDirs, getMapByParentZone } = await import('../server/engine/world.js');
  const noEntrance = [], dupMap = [], misaligned = [];
  for (const facade of world.zones.values()) {
    if (!isEnterableFacade(facade)) continue;
    const maps = [...world.maps.values()].filter(m => m.parent_zone_id === facade.id);
    if (maps.length > 1) dupMap.push(`${facade.name} [${facade.id}]: ${maps.length} maps`);
    const door = buildingEntranceDir(facade);
    if (!door) { noEntrance.push(`${facade.name} [${facade.id}]`); continue; }
    const interior = world.zones.get(getMapByParentZone(facade.id)?.entry_zone_id);
    const outs = interiorExitDirs(interior);              // interior exit arrow(s), or null
    if (!outs || outs.length !== 1) continue;             // neutral/multi out → not a contradiction
    if (outs[0] !== door) misaligned.push(`${facade.name} [${facade.id}]: door=${door} but interior leaves ${outs[0]}`);
  }
  check('every enterable facade has an authored flags.entrance', noEntrance.length === 0, noEntrance.join(' | '));
  check('no facade has more than one interior map', dupMap.length === 0, dupMap.join(' | '));
  check('every building interior leaves toward its map entrance arrow', misaligned.length === 0, misaligned.join(' | '));
}

// ── Layer 2f: statmods ledger — caps and their current values stay consistent ─
// The ledger is the substrate every timed buff/debuff writes through (drugs,
// phases, withdrawal, intoxication). A cap can fall through BOTH paths — reversing
// a buff, or applying a debuff — and the current value must follow it under either
// way, or a player walks around with hp > hp_max. The two paths drifting apart is
// exactly the split-source bug class this harness exists to catch.
{
  const { applyMods, reverseMods } = await import('../server/engine/statmods.js');
  let p = { hp: 100, hp_max: 100 };
  applyMods(p, 'wd', { hp_max: -25 });
  check('debuff lowers the cap', p.hp_max === 75, JSON.stringify(p));
  check('current hp follows a lowered cap under', p.hp === 75, JSON.stringify(p));
  reverseMods(p, 'wd');
  check('reversing restores the cap exactly', p.hp_max === 100, JSON.stringify(p));
  check('reversing does not refund the spent hp', p.hp === 75, JSON.stringify(p));

  p = { hp: 40, hp_max: 100 };
  applyMods(p, 'wd', { hp_max: -25 });
  check('a debuff never raises current hp', p.hp === 40, JSON.stringify(p));

  p = { hp: 50, hp_max: 100 };
  applyMods(p, 'buff', { hp_max: 20 });
  check('a buff raises the cap only', p.hp_max === 120 && p.hp === 50, JSON.stringify(p));
  p.hp = 120;
  reverseMods(p, 'buff');
  check('comedown pulls hp under the restored cap', p.hp === 100 && p.hp_max === 100, JSON.stringify(p));

  // The withdrawal severity arc re-applies the same source with new values.
  p = { hp: 100, hp_max: 100 };
  applyMods(p, 'wd', { hp_max: -6 });
  applyMods(p, 'wd', { hp_max: -25 });
  check('re-applying a source replaces rather than stacks', p.hp_max === 75, JSON.stringify(p));
  applyMods(p, 'wd', { hp_max: -6 });
  check('tapering severity restores the cap', p.hp_max === 94, JSON.stringify(p));
  reverseMods(p, 'wd');
  check('full recovery restores the base cap', p.hp_max === 100, JSON.stringify(p));

  p = { hp: 10, hp_max: 10 };
  applyMods(p, 'brutal', { hp_max: -999 });
  check('the ledger clamp can never kill (floors at 1)', p.hp === 1, JSON.stringify(p));
}

// ── Layer 3: per-plugin suites (plugins/<name>/regress.js) ───────────────────
//
// Every suite drives the SAME live player object, and ~16 plugins arm real
// setTimeouts on it (paced move queues, timed drinks, elevator rides, trips).
// A suite that returns while one is still armed leaks it into whatever runs
// next: the timer fires mid-assertion and moves the player, deletes an item, or
// mutates posture — and because it lands wherever the wall clock happens to be,
// a DIFFERENT assertion fails each run. That is the shape of a flaky gate, and a
// gate that goes red at random trains people to force through it.
//
// So: between suites, disarm and clear the shared player's transient activity,
// and NAME the suite that left something behind. Cleaning silently would fix the
// flake but hide the culprit, so this reports — as a note, not a failure, since
// leaking is sloppy rather than broken.
const TRANSIENT = ['_moveQueue', '_moveTimer', '_consume', '_crossing', '_elevator', '_pendingTrade'];
function disarm(p) {
  const left = [];
  if (p._moveTimer) { clearTimeout(p._moveTimer); left.push('paced move timer'); }
  if (p._moveQueue?.length) left.push(`${p._moveQueue.length} queued step(s)`);
  for (const t of p._consume?.timers || []) clearTimeout(t);
  if (p._consume) left.push('timed consume');
  for (const t of p._elevator?.timers || []) clearTimeout(t);
  if (p._elevator) left.push('elevator ride');
  if (p._crossing) left.push('void crossing');
  if (p.activeDrugs?.length) left.push(`${p.activeDrugs.length} active drug(s)`);
  if (p.pendingOnsets?.length) left.push(`${p.pendingOnsets.length} pending onset(s)`);
  for (const k of TRANSIENT) delete p[k];
  p.activeDrugs = []; p.pendingOnsets = [];
  p._lastStepAt = 0;            // no suite should inherit another's move cadence
  if (p.posture && p.posture !== 'standing') { left.push(`posture=${p.posture}`); p.posture = 'standing'; p.sittingOn = null; }
  return left;
}

console.log('— layer 3: plugin suites —');
const dirs = (await readdir(PLUGINS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
for (const d of dirs) {
  const suitePath = join(PLUGINS_DIR, d.name, 'regress.js');
  if (!existsSync(suitePath)) continue;
  const zoneBefore = getPlayer().current_zone;
  try {
    const mod = await import(pathToFileURL(suitePath).href);
    if (typeof mod.default !== 'function') { check(`${d.name}: regress.js has default export`, false, 'no default function'); continue; }
    await mod.default({ run, check: (name, cond, detail) => check(`${d.name}: ${name}`, cond, detail), getPlayer });
  } catch (e) {
    check(`${d.name}: suite runs`, false, e.message);
  } finally {
    const leaked = disarm(getPlayer());
    if (getPlayer().current_zone !== zoneBefore) {
      leaked.push(`left the player in ${getPlayer().current_zone} (was ${zoneBefore})`);
      getPlayer().current_zone = zoneBefore;
    }
    if (leaked.length) console.log(`    ⚠ ${d.name}: left live state behind — ${leaked.join(', ')} (disarmed)`);
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
removePlayerFromZone(P.id, getPlayer().current_zone);
removeLivePlayer(P.id);
stopAll();

const failed = results.filter(x => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);

// With 1500+ checks, a single failure scrolls far off the top. Reprint every
// failure together at the very end so what broke — and why — is the last thing
// on screen.
if (failed.length) {
  console.log(`\n— FAILURES (${failed.length}) —`);
  for (const f of failed) {
    console.log(`  ✗ ${f.name}${f.detail ? `\n      ↳ ${f.detail}` : ''}`);
  }
}

process.exit(failed.length ? 1 : 0);
