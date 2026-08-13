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
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getAllZones, getLivePlayer, world, setDoorCache, deleteDoorCache, getDoorForExit, frontDoorOf, getApartment, insertFurniture, deleteFurniture, getZone, registerTransientZone, removeTransientZone, isTransientZone, regionForZone, renderOf, specOf, propsOf, getConnection, getConnectionBetween, getDoorForEdge, doorOnLink } from '../server/engine/world.js';
import { moveEntity, disturbSleeper, isNpcAsleep, wakeNpc, initBlackboard, tickEntityAI, isVendorClosed } from '../server/engine/ai-behaviour.js';
import { openShopSession, closeShopSession, getNpcForShopper } from '../server/engine/vendor-session.js';
import { exitTargets, allExits, neighborZoneIds, addExit, removeExit } from '../server/engine/exits.js';
import { cmdMove, dragFollowers } from '../server/engine/commands/movement.js';
import { resolveNamedDestination, _test as describeTest } from '../server/engine/commands/describe.js';
import { tickOnsets } from '../server/engine/drugs.js';
import { getSelectionState, clearSelectionState } from '../server/engine/sift.js';
import { loadPlugins, getLoadedPlugins, getRegisteredCommands, getRegisteredHooks } from '../server/engine/plugins.js';
import { getHelpTopic, listHelpTopics } from '../server/engine/help.js';
import { TOPIC_VERBS } from '../server/engine/help-topics.js';
import { getAlias } from '../server/engine/commands/aliases.js';
import { loadItems, reloadItem, deleteItemCache } from '../server/engine/items-cache.js';
import { getVendorStock, buyFromVendor, restockSourcedContainers, _internal } from '../server/engine/vendor.js';
import { randomUUID } from 'crypto';
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
import { resolveDefault, resolveTerrain, resolveProps, PROP_DEFAULTS, deriveWorld, deriveMarker, deriveColors, deriveLabel, assignBuildingMarkers, projectEdges, edgesToExits, OPPOSITE, featureProvenance, autoTileFamily, buildCellIndex, gridKey } from '../scripts/content/derive.mjs';
import { ASSET_REFS, assetRefIds, isAssetRef } from '../scripts/content/lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = join(__dirname, '../plugins');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
}

// Per-player tables, shared by the fake-player teardown and the end-of-run
// orphan sweep. Declared up here because both run before any later const would
// initialise (temporal dead zone).
const PER_PLAYER_TABLES = [
  'player_flags', 'player_inventory', 'player_skills', 'player_quests',
  'player_achievements', 'player_deaths', 'player_npc_relations', 'player_mutations',
  'player_drug_state', 'player_corpses', 'jail_prisoners',
];

const sent = [];
const broadcast = (zoneId, payload, exclude, toPlayer) => { sent.push({ zoneId, payload, toPlayer }); };

console.log('— regression: booting world + plugins (no server) —');
await initWorld();
// The world clock's singleton row is created by initEnvironment() at real boot,
// which this harness does not run. It is runtime state, so a from-files CI
// database has no row at all and every calendar read answers null.
{
  const { ensureClockRow } = await import('../server/engine/environment.js');
  await ensureClockRow(query).catch(() => {});
}
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

  // ── Scheduler discipline ───────────────────────────────────────────────────
  // A recurring world tick must be registered through engine/scheduler.js, never
  // a raw setInterval. The scheduler idle-gates on hasActivePlayers() BY DEFAULT
  // (a clock-driven tick that awaits query() on an empty world holds a pool
  // connection open and stops Neon's compute suspending — the server then bills
  // 24/7 for nobody), decorrelates cadence phase so ticks don't convoy, and
  // spreads same-cadence subscribers ~200 ms apart so they can't take every pool
  // slot while a player's move waits on pool.connect().
  //
  // That rule lived only in a comment at the top of scheduler.js, and drifted:
  // thirteen plugin ticks were raw setIntervals, six of them re-implementing the
  // idle guard by hand and seven with no guard at all. Documented-but-unchecked
  // is how it drifted, so it is checked here.
  //
  // The exemption is narrow and deliberate: a timer tied to the lifetime of ONE
  // object (a player's trip, a card table's shuffle loop) is not a world tick —
  // it's created and cleared with that object, and idle-gating it would be
  // meaningless. Those keep raw setInterval and are listed below by file.
  {
    const SESSION_TIMER_FILES = new Set([
      'mis/mis-system.js',      // per-player event interval, cleared by stopMisEvent
      'trip/index.js',          // per-player phantom sync, cleared when the trip ends
      'gametable/game-table.js',// per-table shuffle SFX, cleared with the table
    ]);
    const offenders = [];
    const walk = async (dir, rel = '') => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { await walk(join(dir, e.name), r); continue; }
        if (!e.name.endsWith('.js') || e.name === 'regress.js') continue;
        if (SESSION_TIMER_FILES.has(r)) continue;
        // Strip comments before matching — plugins legitimately DISCUSS
        // setInterval in the comment explaining why they use the scheduler, and
        // flagging that would train people to delete the explanation.
        const src = (await readFile(join(dir, e.name), 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/\bsetInterval\s*\(/.test(src)) offenders.push(r);
      }
    };
    await walk(PLUGINS_DIR);
    check('plugins schedule ticks via scheduler.js, not raw setInterval',
      offenders.length === 0,
      `${offenders.join(', ')} — use schedule('<cadence>', fn) so the tick is idle-gated and phase-spread; ` +
      `if it is a per-object session timer, add it to SESSION_TIMER_FILES in tests/regress.js with a reason`);
  }

  // Sanity moves through ONE funnel. `adjustSanity` in condition.js is where a
  // loss meets the player's composure (resistSanityLoss) and where a change
  // becomes observable (the `sanity.changed` event). It was added because the
  // resist function sat dead for months while twenty-odd call sites each did
  // their own clamp — a character built entirely for Cool ate exactly the same
  // horror as one who wasn't. A new `player.sanity = …` silently opts back out
  // of both, so the sweep is the only thing that keeps the funnel true.
  {
    const SANITY_WRITE_OK = new Set([
      'server/engine/condition.js',   // the funnel itself
    ]);
    const offenders = [];
    const walk = async (dir, base, rel = '') => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { await walk(join(dir, e.name), base, r); continue; }
        if (!e.name.endsWith('.js') || e.name === 'regress.js') continue;
        const full = `${base}/${r}`;
        if (SANITY_WRITE_OK.has(full)) continue;
        const src = (await readFile(join(dir, e.name), 'utf8'))
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        // Match a write to a BEING's sanity, not to a data bag that happens to
        // carry the word. `statUpdates.sanity` / `out.sanity` / `c.instant.sanity`
        // are payloads being assembled for a persistence or effects path and are
        // not the thing this rule is about; the receiver name is what tells them
        // apart. The trade is that a player held in an oddly-named local would be
        // missed — worth it, because a sweep that cries wolf gets deleted.
        if (/\b(?:player|target|actor|victim|entity|defender|attacker|npc|being|p|t)\.sanity\s*=(?!=)/.test(src))
          offenders.push(full);
      }
    };
    await walk(PLUGINS_DIR, 'plugins');
    await walk(join(__dirname, '../server'), 'server');
    check('sanity is written only through adjustSanity()',
      offenders.length === 0,
      `${offenders.join(', ')} — call adjustSanity(player, delta, reason) from server/engine/condition.js ` +
      `instead of assigning player.sanity, or a loss skips composure and the change fires no event`);
  }

  // Help guides name verbs. A guide that names a verb nobody registers is worse
  // than no guide — it teaches a player something that does not work. Engine
  // builtins aren't in the plugin registry, so they're allowed through by name.
  const ENGINE_VERBS = new Set([
    'eat', 'drink', 'sleep', 'stats', 'skills', 'raise', 'steal', 'pick', 'hack',
    'balance', 'deposit', 'withdraw', 'time', 'take', 'join', 'bet', 'raise', 'fold',
  ]);
  const missing = [];
  for (const [topic, verbs] of Object.entries(TOPIC_VERBS)) {
    if (!getHelpTopic(topic)) { missing.push(`topic "${topic}" is not registered`); continue; }
    for (const v of verbs) {
      if (!registeredCommands.has(v) && !ENGINE_VERBS.has(v) && !getAlias(v)) missing.push(`help ${topic}: names unknown verb "${v}"`);
    }
  }
  check(`every verb named by the ${Object.keys(TOPIC_VERBS).length} help guides actually exists`, missing.length === 0, missing.join('; '));

  const topicNames = listHelpTopics().map(t => t.name);
  check(`help guides are reachable (${topicNames.join(', ')})`, topicNames.length >= 6, topicNames);
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
      const wired = (specialized[verb] || []).some(x => x.requiredTag === spec.discoverVia || x.requiredFlag === spec.discoverVia);
      if (!wired) problems.push(`${e.name}: "${verb}" declared discoverable via "${spec.discoverVia}" but no specializedAction surfaces it (examine shows no hint)`);
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
  const NOT_AUTHORED = new Set(['id', 'flags', 'exits', 'stains']);
  const uncatalogued = [...zoneCols].filter(c => !colCat[c] && !NOT_AUTHORED.has(c));
  check('every authored zones column is in the field catalog', uncatalogued.length === 0,
    `${uncatalogued.join(', ')} — catalogue it as zone:<column> or add it to NOT_AUTHORED with a reason`);

  // One shape vocabulary. A catalog entry whose shape shapeError() doesn't know
  // is unvalidated and looks validated, which is the failure mode this whole
  // section exists to remove.
  const KNOWN_SHAPES = new Set(['text', 'flag', 'tristate', 'int', 'number', 'enum', 'ref', 'list', 'object', 'range', 'hot', 'statmap']);
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
  // An ASSET REF is the one legitimate exception: its collection is a directory of
  // files rather than a table (lib.mjs ASSET_REFS), and it is only exempt here
  // because lint resolves it against that directory — so the failure this check
  // guards against, a ref nobody can resolve, still cannot happen.
  const badRefs = Object.entries(TAG_CATALOG)
    .filter(([, d]) => d?.shape === 'ref')
    .filter(([, d]) => !d.refTable || !(isAssetRef(d.refTable)
      || new RegExp(`CREATE TABLE IF NOT EXISTS ${d.refTable} \\(`).test(SCHEMA_SQL)))
    .map(([k, d]) => `${k}→${d.refTable ?? '(none)'}`);
  check('every ref names a real table or a real asset directory', badRefs.length === 0, badRefs.join(', '));
  // The exemption is only sound while every asset ref actually resolves to files.
  const emptyAssetRefs = Object.keys(ASSET_REFS).filter(t => (assetRefIds(t) || []).length === 0);
  check('every asset ref resolves to a real directory of assets',
    emptyAssetRefs.length === 0, emptyAssetRefs.join(', '));

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

// ── Layer 1e: script trigger registry ────────────────────────────────────────
// The event→script seam (server/engine/script-triggers.js). Proves the binding
// end to end at runtime rather than inferring it: a real row, a real script
// graph, a real emit on the bus, and the flag the graph sets. Also proves the
// filters actually filter — a disabled trigger and a failing zone filter must
// NOT run, which is the direction that fails silently.
console.log('— layer 1e: script trigger registry —');
{
  const { loadScriptTriggers, getTriggeredEvents } = await import('../server/engine/script-triggers.js');
  const { emit } = await import('../server/engine/events.js');
  const { getFlag, clearFlag } = await import('../server/engine/flags.js');
  const { query } = await import('../server/models/db.js');

  const EVT = 'regress.trigger.probe';
  const ids = ['script_regress_trigger', 'trigger_regress_hit', 'trigger_regress_off', 'trigger_regress_zone'];
  const mkTrigger = (id, over = {}) => query(
    `INSERT INTO script_triggers (id,name,event,script_id,zone_id,enabled)
     VALUES ($1,$2,$3,'script_regress_trigger',$4,$5)
     ON CONFLICT (id) DO UPDATE SET event=EXCLUDED.event, zone_id=EXCLUDED.zone_id, enabled=EXCLUDED.enabled`,
    [id, id, over.event ?? EVT, over.zone_id ?? null, over.enabled ?? 1]);

  try {
    await query(`INSERT INTO scripts (id,name,graph) VALUES ('script_regress_trigger','regress trigger probe',$1)
                 ON CONFLICT (id) DO UPDATE SET graph=EXCLUDED.graph`, [JSON.stringify({
      start: 'n1',
      nodes: { n1: { type: 'setflag', scope: 'world', flag: 'regress_trigger_fired', value: 'yes' } },
    })]);
    await mkTrigger('trigger_regress_hit');
    await mkTrigger('trigger_regress_off', { enabled: 0 });
    await mkTrigger('trigger_regress_zone', { zone_id: 'zone_regress_nowhere' });
    await clearFlag('world', 'regress_trigger_fired');
    await loadScriptTriggers();

    check('trigger registry wires the bound event', getTriggeredEvents().includes(EVT), getTriggeredEvents().join(','));

    emit(EVT, {});
    await new Promise(r => setTimeout(r, 250)); // dispatch is fire-and-forget
    check('bound event runs its script graph', await getFlag('world', 'regress_trigger_fired') === 'yes');

    // Zone filter: the probe payload carries no zone, so the zone-filtered
    // trigger must not have fired — assert via a second, isolated round.
    await clearFlag('world', 'regress_trigger_fired');
    await query(`UPDATE script_triggers SET enabled=0 WHERE id='trigger_regress_hit'`);
    await loadScriptTriggers();
    emit(EVT, {});
    await new Promise(r => setTimeout(r, 250));
    check('disabled + zone-filtered triggers do not fire',
      await getFlag('world', 'regress_trigger_fired') === undefined,
      String(await getFlag('world', 'regress_trigger_fired')));
  } finally {
    await query('DELETE FROM script_triggers WHERE id = ANY($1)', [ids]).catch(() => {});
    await query(`DELETE FROM scripts WHERE id='script_regress_trigger'`).catch(() => {});
    await clearFlag('world', 'regress_trigger_fired').catch(() => {});
    await loadScriptTriggers();
  }
}

// ── Layer 1e4: a home override outlives the content deploy ───────────────────
// npcs.home_zone is authored CONTENT and is NOT in the npcs excludeColumns, so
// content:import upserts the authored value back over anything runtime wrote —
// a relocation written there survives until the next deploy and then silently
// reverts. npc_home_overrides is the runtime-class table that the deploy cannot
// reach; this proves the merge happens and that the DB column is left alone.
console.log('— layer 1e4: npc home overrides —');
{
  const { world, setNpcHomeOverride, clearNpcHomeOverride } = await import('../server/engine/world.js');
  const { dispatchAction } = await import('../server/engine/actions.js');
  const { query } = await import('../server/models/db.js');

  const NPC = [...world.npcs.values()].find(n => n.home_zone && world.zones.has(n.home_zone));
  const DEST = [...world.zones.keys()].find(z => z !== NPC?.home_zone);

  if (!NPC || !DEST) {
    check('npc home override: found a fixture NPC', false, 'no suitable NPC/zone in the world');
  } else {
    const authored = NPC.home_zone;
    try {
      await setNpcHomeOverride(NPC.id, DEST, { source: 'regress' });
      check('setNpcHomeOverride repoints the live NPC', world.npcs.get(NPC.id).home_zone === DEST,
        String(world.npcs.get(NPC.id).home_zone));

      // The whole point: the authored column must be untouched, or the next
      // export would serialise the relocation into the content files.
      const { rows } = await query('SELECT home_zone FROM npcs WHERE id=$1', [NPC.id]);
      check('…without writing the authored npcs.home_zone', rows[0].home_zone === authored,
        `db=${rows[0].home_zone} authored=${authored}`);

      const { rows: ov } = await query('SELECT home_zone FROM npc_home_overrides WHERE npc_id=$1', [NPC.id]);
      check('…and the override row is what carries it', ov[0]?.home_zone === DEST, JSON.stringify(ov[0]));

      // A relocation is about where they LIVE, not where they stand: no teleport.
      check('setting a home does not teleport the NPC', world.npcs.get(NPC.id).zone_id !== DEST || authored === DEST,
        String(world.npcs.get(NPC.id).zone_id));

      // Clearing falls back to the authored home, re-read from the DB rather
      // than from the live copy (which is the overridden one).
      await clearNpcHomeOverride(NPC.id);
      check('clearNpcHomeOverride restores the authored home', world.npcs.get(NPC.id).home_zone === authored,
        String(world.npcs.get(NPC.id).home_zone));

      // The content-facing route content actually uses.
      let r = await dispatchAction({ type: 'SET_NPC_HOME', actor: null, params: { npc_id: NPC.id, zone_id: DEST } });
      check('SET_NPC_HOME action relocates', r?.home_zone === DEST && world.npcs.get(NPC.id).home_zone === DEST, JSON.stringify(r));
      r = await dispatchAction({ type: 'SET_NPC_HOME', actor: null, params: { npc_id: NPC.id } });
      check('SET_NPC_HOME with no zone reverts to the authored home',
        r?.cleared === true && world.npcs.get(NPC.id).home_zone === authored, JSON.stringify(r));

      r = await dispatchAction({ type: 'SET_NPC_HOME', actor: null, params: { npc_id: 'npc_does_not_exist_regress', zone_id: DEST } });
      check('SET_NPC_HOME on an unknown NPC errors rather than writing a row', r?.type === 'error', JSON.stringify(r));
      r = await dispatchAction({ type: 'SET_NPC_HOME', actor: null, params: { npc_id: NPC.id, zone_id: 'zone_does_not_exist_regress' } });
      check('SET_NPC_HOME to a dead zone is refused', r?.type === 'error', JSON.stringify(r));
    } finally {
      await query('DELETE FROM npc_home_overrides WHERE npc_id=$1', [NPC.id]).catch(() => {});
      world.npcs.get(NPC.id).home_zone = authored;
    }
  }
}

// ── Layer 1e3: the spawn node stamps the INSTANCE, never the template ────────
// `flags` + `${actor.id}` on a spawn node are what let content author a pursuit
// that hunts one named player (a CHASE node in quarry:'flag' mode reads
// entity.flags.suspect_id). Two things are worth a test rather than a reading:
// that the token resolves to the triggering actor at all, and that the stamp
// does NOT leak onto the shared template — spawnEnemySync copies template.flags
// BY REFERENCE, so an in-place merge would make every later spawn of that
// template inherit the previous hunt, and nothing would look wrong until two
// different players were being chased by each other's pursuers.
console.log('— layer 1e3: spawn node instance flags —');
{
  const { runGraph } = await import('../server/engine/graph.js');
  const { world } = await import('../server/engine/world.js');
  const { query } = await import('../server/models/db.js');

  const TPL = 'enemy_regress_stamp';
  const zoneId = [...world.zones.keys()][0];
  const spawned = [];

  try {
    await query(
      `INSERT INTO enemies (id,name,description,hp_max,flags,behaviour_graph)
       VALUES ($1,'Regress Stamp Probe','',10,$2,'{}')
       ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags`,
      [TPL, JSON.stringify({ template_marker: true })]);

    const zone = world.zones.get(zoneId);
    const before = new Set(zone.enemies);
    const mkGraph = () => ({
      start: 'n1',
      nodes: { n1: {
        type: 'spawn', kind: 'enemy', id: TPL, zone: zoneId, announce: false,
        flags: { suspect_id: '${actor.id}', leash_radius: -1 },
      } },
    });
    const newOnes = () => [...zone.enemies].filter(id => !before.has(id)).map(id => world.enemies.get(id));

    await runGraph(mkGraph(), { actor: { id: 'player_regress_alpha' } });
    let fresh = newOnes();
    fresh.forEach(e => spawned.push(e.instanceId));
    check('spawn node stamps flags onto the instance', fresh[0]?.flags?.leash_radius === -1,
      JSON.stringify(fresh[0]?.flags));
    check('${actor.id} resolves to the triggering player',
      fresh[0]?.flags?.suspect_id === 'player_regress_alpha', String(fresh[0]?.flags?.suspect_id));
    check('the template\'s own flags survive the stamp', fresh[0]?.flags?.template_marker === true,
      JSON.stringify(fresh[0]?.flags));

    // The poisoning check: a second spawn for a DIFFERENT actor must not have
    // rewritten the first one's quarry, and must not inherit it either.
    const firstId = fresh[0]?.instanceId;
    await runGraph(mkGraph(), { actor: { id: 'player_regress_beta' } });
    const second = newOnes().find(e => e.instanceId !== firstId);
    spawned.push(second?.instanceId);
    check('a second spawn does not rewrite the first instance\'s stamp',
      world.enemies.get(firstId)?.flags?.suspect_id === 'player_regress_alpha',
      String(world.enemies.get(firstId)?.flags?.suspect_id));
    check('a second spawn gets its own quarry, not the first one\'s',
      second?.flags?.suspect_id === 'player_regress_beta', String(second?.flags?.suspect_id));

    // A bare id where a graph object belongs must be refused, not assigned — an
    // instance whose behaviour_graph is a string has an AI that never ticks.
    await runGraph({ start: 'n1', nodes: { n1: {
      type: 'spawn', kind: 'enemy', id: TPL, zone: zoneId, announce: false,
      behaviour_graph: 'enemy_some_other_graph',
    } } }, { actor: { id: 'player_regress_alpha' } });
    const third = newOnes().find(e => ![firstId, second?.instanceId].includes(e.instanceId));
    if (third) spawned.push(third.instanceId);
    check('a string behaviour_graph override is refused', typeof third?.behaviour_graph !== 'string',
      typeof third?.behaviour_graph);
  } finally {
    const zone = world.zones.get(zoneId);
    for (const id of spawned) { if (id) { zone?.enemies?.delete(id); world.enemies.delete(id); } }
    await query('DELETE FROM enemies WHERE id=$1', [TPL]).catch(() => {});
  }
}

// ── Layer 1e2: every shipped trigger supplies its script's ${params} ─────────
// A parameterised graph whose token is NOT supplied writes the literal key
// `bar_${venue}_visits` — every venue silently collapsing onto one shared
// counter, with no error anywhere. Static, so it catches the drift at author
// time instead of after someone plays it.
console.log('— layer 1e2: trigger params cover script tokens —');
{
  const { query } = await import('../server/models/db.js');
  const [{ rows: trigs }, { rows: scripts }] = await Promise.all([
    query('SELECT id, script_id, params FROM script_triggers'),
    query('SELECT id, graph FROM scripts'),
  ]);
  const byId = new Map(scripts.map(s => [s.id, s.graph]));
  const TOKEN = /\$\{([\w.]+)\}/g;
  // Supplied by the dispatcher, not by the trigger row: `zone`, and anything
  // reaching into the event payload.
  const dispatcherSupplied = (tok) => tok === 'zone' || tok === 'event' || tok.startsWith('event.');

  // Tokens used by a graph, following `script` sub-graph nodes. A sub-script id
  // that is itself a token resolves through the trigger's params.
  const tokensOf = (scriptId, params, seen = new Set()) => {
    if (!scriptId || seen.has(scriptId)) return new Set();
    seen.add(scriptId);
    const graph = byId.get(scriptId);
    if (!graph) return new Set(['\u0000missing:' + scriptId]);
    const found = new Set([...JSON.stringify(graph).matchAll(TOKEN)].map(m => m[1]));
    for (const node of Object.values(graph.nodes || {})) {
      if (node?.type !== 'script' || !node.scriptId) continue;
      const sub = String(node.scriptId).replace(TOKEN, (m, k) => params?.[k] ?? m);
      if (!sub.includes('${')) for (const t of tokensOf(sub, params, seen)) found.add(t);
    }
    return found;
  };

  const problems = [];
  for (const t of trigs) {
    const params = t.params || {};
    for (const tok of tokensOf(t.script_id, params)) {
      if (tok.startsWith('\u0000missing:')) { problems.push(`${t.id} → ${tok.slice(8)} does not exist`); continue; }
      if (dispatcherSupplied(tok)) continue;
      if (params[tok] == null) problems.push(`${t.id} does not supply \${${tok}}`);
    }
  }
  check(`every trigger supplies the tokens its script tree uses (${trigs.length} triggers)`,
    problems.length === 0, problems.join('; '));
}

// ── Layer 1f: graph runner — random + counter nodes ──────────────────────────
// Both are branch nodes, so the failure mode is "took the wrong edge", which is
// invisible in play. Weights of 1/0 make the random pick deterministic without
// stubbing Math.random; the counter runs three times to prove the reset wraps.
console.log('— layer 1f: random + counter nodes —');
{
  const { runGraph } = await import('../server/engine/graph.js');
  const { getFlag, clearFlag } = await import('../server/engine/flags.js');
  const mark = (flag) => ({ type: 'setflag', scope: 'world', flag, value: 'yes' });
  const wipe = async (...f) => { for (const k of f) await clearFlag('world', k); };

  try {
    // random: weight 0 must never be picked, weight 1 always.
    await wipe('regress_rand_a', 'regress_rand_b');
    await runGraph({ start: 'r', nodes: {
      r: { type: 'random', outcomes: [{ weight: 1, next: 'a' }, { weight: 0, next: 'b' }] },
      a: mark('regress_rand_a'), b: mark('regress_rand_b'),
    } }, { actor: null, broadcast });
    check('random takes the weighted outcome and never a weight-0 one',
      await getFlag('world', 'regress_rand_a') === 'yes' && await getFlag('world', 'regress_rand_b') === undefined);

    // random with nothing pickable falls through to next rather than dead-ending.
    await wipe('regress_rand_fall');
    await runGraph({ start: 'r', nodes: {
      r: { type: 'random', outcomes: [{ weight: 0, next: 'a' }], next: 'f' },
      a: mark('regress_rand_a'), f: mark('regress_rand_fall'),
    } }, { actor: null, broadcast });
    check('random with no pickable outcome falls through to next',
      await getFlag('world', 'regress_rand_fall') === 'yes');

    // counter: threshold 2 with reset → hits on run 2, then wraps.
    await wipe('regress_count', 'regress_count_hit', 'regress_count_miss');
    const counterGraph = { start: 'c', nodes: {
      c: { type: 'counter', scope: 'world', flag: 'regress_count', delta: 1, threshold: 2, reset: true, ifTrue: 'hit', ifFalse: 'miss' },
      hit: mark('regress_count_hit'), miss: mark('regress_count_miss'),
    } };
    await runGraph(counterGraph, { actor: null, broadcast });
    const afterOne = await getFlag('world', 'regress_count');
    check('counter increments and takes ifFalse below the threshold',
      afterOne === '1' && await getFlag('world', 'regress_count_hit') === undefined, `count=${afterOne}`);

    await runGraph(counterGraph, { actor: null, broadcast });
    check('counter takes ifTrue on the threshold and resets to 0',
      await getFlag('world', 'regress_count_hit') === 'yes' && await getFlag('world', 'regress_count') === '0',
      `count=${await getFlag('world', 'regress_count')}`);

    // Param interpolation: the same authored graph must land on a different flag
    // per instance, and an unsupplied token must stay verbatim rather than
    // collapsing two instances onto one key.
    await wipe('bar_alpha_visits', 'bar_beta_visits', 'bar_${venue}_visits');
    const parameterised = { start: 'c', nodes: {
      c: { type: 'counter', scope: 'world', flag: 'bar_${venue}_visits', delta: 1 },
    } };
    await runGraph(parameterised, { actor: null, broadcast, params: { venue: 'alpha' } });
    await runGraph(parameterised, { actor: null, broadcast, params: { venue: 'beta' } });
    await runGraph(parameterised, { actor: null, broadcast, params: {} });
    check('params interpolate per run into separate flags',
      await getFlag('world', 'bar_alpha_visits') === '1' && await getFlag('world', 'bar_beta_visits') === '1');
    check('an unsupplied ${token} stays verbatim instead of collapsing instances',
      await getFlag('world', 'bar_${venue}_visits') === '1');

    // Params must reach a `script` sub-graph and survive a condition node.
    await wipe('bar_gamma_seen', 'regress_interp_branch');
    await runGraph({ start: 'set', nodes: {
      set: { type: 'setflag', scope: 'world', flag: 'bar_${venue}_seen', value: 'true', next: 'gate' },
      gate: { type: 'condition', conditions: [{ flag: 'bar_${venue}_seen', scope: 'world', op: 'set' }], ifTrue: 'ok' },
      ok: mark('regress_interp_branch'),
    } }, { actor: null, broadcast, params: { venue: 'gamma' } });
    check('interpolated flag is readable by an interpolated condition',
      await getFlag('world', 'bar_gamma_seen') === 'true' && await getFlag('world', 'regress_interp_branch') === 'yes');

    // Payload reads: dotted tokens resolve into the event payload, so a script
    // can react to WHAT happened. The three cases that matter are a nested
    // scalar, a numeric accumulation, and the refusal to stringify an object.
    await wipe('regress_payload_spend', 'regress_payload_deep', 'regress_payload_obj');
    const payloadCtx = {
      actor: null, broadcast,
      params: { event: { delta: -37, item: { name: 'rust whiskey' }, actor: { id: 'p1', handle: 'Dud' } } },
    };
    await runGraph({ start: 'a', nodes: {
      a: { type: 'counter', scope: 'world', flag: 'regress_payload_spend', delta: '${event.delta}', next: 'b' },
      b: { type: 'setflag', scope: 'world', flag: 'regress_payload_deep', value: '${event.item.name}', next: 'c' },
      // ${event.actor} is a live object — it must NOT stringify into the value.
      c: { type: 'setflag', scope: 'world', flag: 'regress_payload_obj', value: '${event.actor}' },
    } }, payloadCtx);
    check('counter accumulates a numeric value off the payload',
      await getFlag('world', 'regress_payload_spend') === '-37',
      String(await getFlag('world', 'regress_payload_spend')));
    check('a nested payload scalar interpolates',
      await getFlag('world', 'regress_payload_deep') === 'rust whiskey',
      String(await getFlag('world', 'regress_payload_deep')));
    check('a payload token resolving to an object stays verbatim',
      await getFlag('world', 'regress_payload_obj') === '${event.actor}',
      String(await getFlag('world', 'regress_payload_obj')));

    // A missing payload field must be inert, not corrupting: the counter no-ops
    // rather than writing NaN over a running total.
    await wipe('regress_payload_nan');
    await runGraph({ start: 'a', nodes: {
      a: { type: 'counter', scope: 'world', flag: 'regress_payload_nan', delta: '${event.nope}' },
    } }, { actor: null, broadcast, params: { event: {} } });
    check('an unresolved numeric token is a no-op, not NaN',
      await getFlag('world', 'regress_payload_nan') === '0',
      String(await getFlag('world', 'regress_payload_nan')));

    // reset arrives as the STRING "false" from the devpanel select — and "false"
    // is truthy. This asserts the coercion, not the happy path.
    await wipe('regress_count2');
    const noReset = { start: 'c', nodes: {
      c: { type: 'counter', scope: 'world', flag: 'regress_count2', delta: 1, threshold: 1, reset: 'false', ifTrue: 'x' },
      x: { type: 'say', text: 'hit' },
    } };
    await runGraph(noReset, { actor: null, broadcast });
    check('counter reset="false" (string) does not reset', await getFlag('world', 'regress_count2') === '1');
  } finally {
    await wipe('regress_rand_a', 'regress_rand_b', 'regress_rand_fall',
      'regress_count', 'regress_count_hit', 'regress_count_miss', 'regress_count2',
      'bar_alpha_visits', 'bar_beta_visits', 'bar_${venue}_visits',
      'bar_gamma_seen', 'regress_interp_branch',
      'regress_payload_spend', 'regress_payload_deep', 'regress_payload_obj', 'regress_payload_nan');
  }
}

// ── Layer 1h: item / stat conditions + dialogue tokens ───────────────────────
// evalCondition grew two new shapes. The stat allow-list is the one to pin: the
// real columns are stat_brawn/stat_brains/stat_cool/stat_senses (NOT intellect or
// charisma), and an unknown stat must fail closed rather than build bad SQL.
console.log('— layer 1h: item / stat conditions + dialogue tokens —');
{
  const { evalCondition, evalConditions } = await import('../server/engine/flags.js');
  const { interp } = await import('../server/engine/interp.js');
  const fake = { id: 'regress_cond_player', stat_brawn: 7, stat_brains: 2 };

  check('stat condition compares with gte by default', await evalCondition({ stat: 'brawn', value: 5 }, fake));
  check('stat condition fails below the threshold', !(await evalCondition({ stat: 'brains', value: 5 }, fake)));
  check('stat condition honours an explicit op',
    await evalCondition({ stat: 'brains', op: 'lt', value: 5 }, fake));
  check('an unknown stat fails closed (no SQL built from it)',
    !(await evalCondition({ stat: 'intellect', value: 1 }, fake)));
  check('a stat condition with no player is false, not true',
    !(await evalCondition({ stat: 'brawn', value: 1 }, null)));

  // The fake player owns no inventory rows, so `has` is false and `lacks` is true
  // — which also proves the two ops are not accidentally the same branch.
  check('item condition: has is false for an empty inventory',
    !(await evalCondition({ item: 'item_drink_basin_swill' }, fake)));
  check('item condition: lacks is true for an empty inventory',
    await evalCondition({ item: 'item_drink_basin_swill', op: 'lacks' }, fake));

  // Mixing shapes in one ANDed list must still work — that's how a real gate reads.
  check('flag/item/stat conditions AND together',
    await evalConditions([{ stat: 'brawn', value: 5 }, { item: 'item_nope', op: 'lacks' }], fake));

  // Dialogue shares the interpolator, so one authored tree can serve many speakers.
  check('dialogue-style tokens resolve npc + player',
    interp('“Evening, ${player.handle}.” ${npc.name} does not look up.',
      { npc: { name: 'Vale' }, player: { handle: 'Dud' } })
      === '“Evening, Dud.” Vale does not look up.');
}

// ── Layer 1h2: the swing seam ────────────────────────────────────────────────
// The seam plugins bend a swing through. What matters most here is the NEGATIVE
// case: with nothing registered, combat must be byte-for-byte what it was, and
// the seam must allocate nothing. Everything else in this block pins the
// contract, so the failure mode for a badly-written contributor is "your
// technique does nothing" rather than "combat hangs".
console.log('— layer 1h2: swing seam —');
{
  const { registerSwingContributor, getSwingContributors, _swingTest }
    = await import('../server/engine/combat.js');

  // Real plugins register here (mastery does). Step them aside so the
  // nothing-registered assertions can still be made, and put them back at the end.
  const liveContributors = _swingTest.snapshot();
  _swingTest.clear();

  check('the engine itself registers no contributor — the seam is for plugins',
    getSwingContributors().length === 0, getSwingContributors().join(', '));
  check('an empty registry returns null rather than a context object',
    _swingTest.begin({ hitMod: 0 }) === null);
  check('...and closing a null swing is a no-op, not a throw',
    _swingTest.end(null, { hit: true }) === undefined);
  check('a null swing contributes no prose', _swingTest.lines(null) === '');

  const seen = [];
  registerSwingContributor((phase, ctx) => { seen.push(phase); ctx.hitMod += 3; }, '_regress');
  const ctx = _swingTest.begin({ kind: 'outgoing', hitMod: 0, lines: [] });
  check('a registered contributor sees "pre" and its modifier is read back',
    ctx && ctx.hitMod === 3 && seen[0] === 'pre', JSON.stringify(seen));
  _swingTest.end(ctx, { hit: false, margin: -2 });
  check('...and sees "post" WITH the outcome, including on a miss',
    seen[1] === 'post' && ctx.hit === false && ctx.margin === -2, JSON.stringify(seen));

  // The two ways a plugin can be wrong. Neither may take a swing down with it.
  registerSwingContributor(() => { throw new Error('boom'); }, '_regress_thrower');
  registerSwingContributor(async () => { await Promise.resolve(); }, '_regress_async');
  const survived = _swingTest.begin({ hitMod: 0, lines: [] });
  check('a contributor that throws is skipped, and the swing still resolves',
    survived !== null && survived.hitMod === 3);
  check('...and one that awaits does not make the seam async',
    typeof _swingTest.begin({ hitMod: 0 })?.then !== 'function');

  // Prose rides the context, so a contributor never has to reach for the socket.
  registerSwingContributor((phase, c) => { if (phase === 'post') c.lines?.push(' <i>read.</i>'); }, '_regress');
  const proseCtx = _swingTest.begin({ hitMod: 0, lines: [] });
  _swingTest.end(proseCtx, { hit: true });
  check('prose pushed in post rides the message the engine was already sending',
    _swingTest.lines(proseCtx) === ' <i>read.</i>', _swingTest.lines(proseCtx));

  // Stand the test contributors down and give the real ones back — one left
  // registered would bend every combat case that runs after this block.
  _swingTest.restore(liveContributors);
  check('the real contributors are back for the cases that follow',
    getSwingContributors().length === liveContributors.size, getSwingContributors().join(', '));
}

// ── Layer 1i: relations substrate (player↔NPC) ───────────────────────────
// The substrate every social read is about to depend on. Three things are pinned:
// the tier ladder (hostility outranks familiarity), the ZERO-query read contract,
// and the fallback rule — an unauthored NPC must render EXACTLY as it does today.
console.log('— layer 1i: relations substrate —');
{
  const { getRelation, adjustRelation, touchRelation, relationTier, relationAtLeast, hydrateRelations }
    = await import('../server/engine/relations.js');
  const { evalCondition } = await import('../server/engine/flags.js');
  const { dispatchAction } = await import('../server/engine/actions.js');

  const rp = { id: 'regress_rel_player' };
  await hydrateRelations(rp);

  // Never met = stranger, and reading an unknown NPC must not throw or allocate.
  check('an unmet NPC reads as stranger', relationTier(getRelation(rp, 'npc_nobody')) === 'stranger');
  check('an unmet NPC has zero familiarity', getRelation(rp, 'npc_nobody').familiarity === 0);

  // Familiarity alone climbs the neutral ladder.
  adjustRelation(rp, 'npc_probe', { familiarity: 4 });
  check('familiarity alone reaches known', relationTier(getRelation(rp, 'npc_probe')) === 'known');
  adjustRelation(rp, 'npc_probe', { familiarity: 6, warmth: 40 });
  check('familiarity + warmth reaches familiar', relationTier(getRelation(rp, 'npc_probe')) === 'familiar');

  // Hostility OUTRANKS familiarity — someone who knows you well and hates you is
  // not 'close', and relationAtLeast must agree with the ladder, not the numbers.
  adjustRelation(rp, 'npc_probe', { warmth: -120 });
  check('hostility outranks familiarity', relationTier(getRelation(rp, 'npc_probe')) === 'hostile');
  check('a hostile NPC is not atLeast known', !relationAtLeast(getRelation(rp, 'npc_probe'), 'known'));

  // Bounds hold under an absurd push in either direction.
  adjustRelation(rp, 'npc_probe', { familiarity: 9999, warmth: 9999 });
  const bounded = getRelation(rp, 'npc_probe');
  check('familiarity is capped', bounded.familiarity === 100, String(bounded.familiarity));
  check('warmth is capped', bounded.warmth === 100, String(bounded.warmth));

  // Contact is rate-limited: showing up repeatedly builds a relationship, spamming
  // `talk` in one sitting does not.
  const t1 = touchRelation(rp, 'npc_cooldown');
  const t2 = touchRelation(rp, 'npc_cooldown');
  check('first contact counts', t1 === true);
  check('immediate second contact is rate-limited', t2 === false);
  check('contact is per-NPC', touchRelation(rp, 'npc_cooldown2') === true);

  // The condition shape, registered from the substrate rather than built into flags.js.
  const ctx = { npc: { id: 'npc_probe' } };
  check('relation condition defaults to the speaking npc',
    await evalCondition({ relation: 'known' }, rp, ctx));
  check('relation condition honours an explicit npc',
    !(await evalCondition({ relation: 'known', npc: 'npc_nobody' }, rp, ctx)));
  check('relation condition op: below',
    await evalCondition({ relation: 'known', npc: 'npc_nobody', op: 'below' }, rp, ctx));
  check('an unknown tier fails closed',
    !(await evalCondition({ relation: 'besties' }, rp, ctx)));
  check('a relation condition with no player is false, not true',
    !(await evalCondition({ relation: 'known' }, null, ctx)));

  // RELATION_ADJUST is the authored (VINE) path, flat params, npc from context.
  await dispatchAction({ type: 'RELATION_ADJUST', actor: rp, params: { warmth: 5 }, context: ctx });
  check('RELATION_ADJUST moves the relationship through the action path',
    getRelation(rp, 'npc_probe').warmth === 100 || getRelation(rp, 'npc_probe').warmth > 0);
  const noNpc = await dispatchAction({ type: 'RELATION_ADJUST', actor: rp, params: { warmth: 5 }, context: {} });
  check('RELATION_ADJUST with no npc errors instead of guessing', noNpc?.type === 'error');

  // ── THE FALLBACK CONTRACT ──
  // An NPC with no relationship authoring must render byte-identically for a
  // stranger and for a close friend. This is what lets the substrate ship across
  // 167 existing NPCs without touching one of their trees.
  const { renderDialogueNode } = await import('../server/engine/dialogue.js');
  const plain = { id: 'npc_regress_plain', name: 'Plain Speaker',
    dialogue_tree: { root: { text: 'The usual line.', options: [] } } };
  const asStranger = await renderDialogueNode(plain, 'root', rp, { npc: plain });
  adjustRelation(rp, 'npc_regress_plain', { familiarity: 60, warmth: 90 });
  const asFriend = await renderDialogueNode(plain, 'root', rp, { npc: plain });
  check('an unauthored NPC falls back to its normal text',
    asStranger.text === 'The usual line.' && asFriend.text === 'The usual line.',
    `${asStranger.text} / ${asFriend.text}`);

  // An authored tier is used when the player is at it — and a MISSING tier walks
  // toward neutral rather than falling straight through to the default.
  const warm = { id: 'npc_regress_warm', name: 'Warm Speaker',
    dialogue_tree: { root: { text: 'State your business.',
      text_by_relation: { known: 'You again. Sit.' }, options: [] } } };
  const cold = await renderDialogueNode(warm, 'root', { id: 'regress_rel_stranger', _relations: new Map() }, { npc: warm });
  check('a stranger gets the ordinary line', cold.text === 'State your business.', cold.text);
  adjustRelation(rp, 'npc_regress_warm', { familiarity: 5 });
  const known = await renderDialogueNode(warm, 'root', rp, { npc: warm });
  check('a known player gets the authored line', known.text === 'You again. Sit.', known.text);
  adjustRelation(rp, 'npc_regress_warm', { familiarity: 60, warmth: 95 });
  const close = await renderDialogueNode(warm, 'root', rp, { npc: warm });
  check('a missing higher tier walks down to the nearest authored one',
    close.text === 'You again. Sit.', close.text);

  // A hostile player must NEVER inherit a line written for a friend.
  adjustRelation(rp, 'npc_regress_warm', { warmth: -400 });
  const hostile = await renderDialogueNode(warm, 'root', rp, { npc: warm });
  check('a hostile player never inherits the warm line',
    hostile.text === 'State your business.', hostile.text);

  // ── `first` — the introduction an NPC only gets to make ONCE ──
  // `stranger` is not "first meeting": it repeats for several visits, so an intro
  // line ("Folks call me Two-Cell") left in plain text gets recited forever. This
  // works only because touchRelation runs AFTER the text is chosen — if that ever
  // moves, the intro is skipped on the very visit it exists for.
  const intro = { id: 'npc_regress_intro', name: 'Introducer',
    dialogue_tree: { root: { text: 'What do you need.',
      text_by_relation: { first: "Name's Grady. Folks call me Two-Cell." }, options: [] } } };
  const meeter = { id: 'regress_rel_intro', _relations: new Map(), _relationsDirty: new Set() };
  const meet1 = await renderDialogueNode(intro, 'root', meeter, { npc: intro });
  const meet2 = await renderDialogueNode(intro, 'root', meeter, { npc: intro });
  check('the first meeting gets the introduction',
    meet1.text === "Name's Grady. Folks call me Two-Cell.", meet1.text);
  check('every visit after it gets the every-day greeting',
    meet2.text === 'What do you need.', meet2.text);

  // ── `{ on_air: … }` — a performer mid-broadcast doesn't hold a conversation.
  // Dialogue never interrupts a behaviour graph (AT_WORK keeps returning RUNNING
  // regardless), so this gate is fiction rather than a mechanical lock — but it
  // has to track the SAME predicate the graph holds on, or an author ends up
  // hand-maintaining a second copy of the schedule.
  const { filterDialogueOptions } = await import('../server/engine/dialogue.js');
  const { registerNpcScheduleChecker } = await import('../server/engine/broadcast-bridge.js');
  const host = { id: 'npc_regress_host' };
  const opts = [
    { label: 'off', next: 'n_off', conditions: [{ on_air: false }] },
    { label: 'on', next: 'n_on', conditions: [{ on_air: true }] },
    { label: 'always', next: 'n_any' },
  ];
  const prevChecker = null;
  registerNpcScheduleChecker(() => true);
  const live = await filterDialogueOptions(opts, {}, rp, { npc: host });
  check('on air: the off-air branch is hidden',
    live.length === 2 && live.some(o => o.next === 'n_on') && !live.some(o => o.next === 'n_off'),
    live.map(o => o.next).join(','));
  registerNpcScheduleChecker(() => false);
  const off = await filterDialogueOptions(opts, {}, rp, { npc: host });
  check('off air: the on-air branch is hidden',
    off.length === 2 && off.some(o => o.next === 'n_off') && !off.some(o => o.next === 'n_on'),
    off.map(o => o.next).join(','));
  // The gate must cost an ordinary NPC nothing: no schedule = never on air, so
  // `{ on_air: false }` stays true for every non-performer in the world.
  const plainNpc = await filterDialogueOptions(opts, {}, rp, { npc: { id: 'npc_regress_nobody' } });
  check('an unscheduled NPC reads as off air, not hidden',
    plainNpc.some(o => o.next === 'n_off'), plainNpc.map(o => o.next).join(','));
  registerNpcScheduleChecker(prevChecker || (() => false));
}

// ── Layer 1i2: NPC-vs-NPC combat ──────────────────────────────────────────
// The missing corner of the matrix (enemy→player, enemy→npc, enemy→enemy and
// npc→player all pre-existed). The one thing that MUST hold: `floorHp` is what
// separates a bar scrap from a killing, and a capped swing must never finish
// someone — otherwise a drunken brawl quietly leaves bodies in every bar.
{
  const { npcAttackNpc } = await import('../server/engine/combat.js');
  const mk = (id, hp) => ({
    id, name: id, hp, hp_max: 40, zone_id: 'zone_regress_brawl',
    flags: { hit: 3, dodge: 1, weapon: [{ type: 'kinetic', min: 3, max: 7 }] },
  });

  const a = mk('brawler_a', 40), b = mk('brawler_b', 14);
  for (let i = 0; i < 40; i++) { a._lastAttack = 0; await npcAttackNpc(a, b, { floorHp: 12 }); }
  check('a capped brawl never kills', b.hp >= 12 && !b._dead, `hp=${b.hp} dead=${!!b._dead}`);

  const c = mk('brawler_c', 40), d = mk('brawler_d', 14);
  let killed = false;
  for (let i = 0; i < 40 && !killed; i++) { c._lastAttack = 0; killed = !!(await npcAttackNpc(c, d, {}))?.killed; }
  check('...but an uncapped one can', killed && d.hp === 0, `hp=${d.hp} killed=${killed}`);

  // Getting hit makes it mutual — this is what turns one punch into a fight
  // without any brawl state machine. Swing until one LANDS: npcAttackNpc rolls
  // to-hit, so asserting after a single swing is a coin flip that passes locally
  // and fails in the pre-push gate. (It did exactly that.)
  const e = mk('brawler_e', 40), f = mk('brawler_f', 40);
  let landed = false;
  for (let i = 0; i < 40 && !landed; i++) { e._lastAttack = 0; landed = !!(await npcAttackNpc(e, f, { floorHp: 12 }))?.hit; }
  check('a swing lands within 40 tries (sanity on the to-hit roll)', landed);
  check('being hit makes the defender fight back', f._combatTargetId === e.id, String(f._combatTargetId));

  check('an NPC cannot attack itself', (await npcAttackNpc(e, e, {})) === null);
  const dead = mk('brawler_dead', 0); dead._dead = true;
  check('a dead NPC is not a target', (await npcAttackNpc(e, dead, {})) === null);
}

// ── Layer 1j: standing decay + relationship help ─────────────────────────
// Two rules with teeth: standing is MAINTAINED (it slides back to a resting
// point in both directions), and knowing someone is WORTH something at the till.
console.log('— layer 1j: standing decay + relationship help —');
{
  const { decayRep, restingRep, getTier } = await import('../server/engine/ideologies.js');
  const { relationHelp, adjustRelation } = await import('../server/engine/relations.js');
  const { treatmentQuote } = await import('../plugins/clinic/index.js');

  const now = Date.now();
  const daysAgo = (d) => Math.floor((now - d * 86400000) / 1000);

  // Positive standing is not banked — stop showing up and it drains.
  check('positive rep decays toward neutral', decayRep(800, daysAgo(30), 0, now) < 500,
    String(Math.round(decayRep(800, daysAgo(30), 0, now))));
  check('one half-life halves the distance to resting',
    Math.abs(decayRep(800, daysAgo(30), 0, now) - 400) < 1,
    String(decayRep(800, daysAgo(30), 0, now)));

  // ...and a grudge is not a life sentence. This is the direction that matters:
  // a bad early decision must not permanently close off a quarter of the game.
  check('negative rep climbs back toward neutral', decayRep(-800, daysAgo(30), 0, now) > -500,
    String(Math.round(decayRep(-800, daysAgo(30), 0, now))));
  check('rep does not stay hostile forever',
    getTier(decayRep(-900, daysAgo(180), 0, now)).id !== 'hostile',
    getTier(decayRep(-900, daysAgo(180), 0, now)).id);

  // No drift on a fresh stamp, and none at all for a row that was never stamped.
  check('same-day rep does not drift', decayRep(500, daysAgo(0), 0, now) === 500);
  check('an unstamped row is left alone', decayRep(500, 0, 0, now) === 500);
  check('decay never crosses the resting point', decayRep(10, daysAgo(3650), 0, now) >= 0);

  // The exception: a MAJOR ideological difference floors the recovery. Both
  // halves are required — opposite stance AND a different path.
  const order = { stance: 'redeem', path: 'machine' };
  check('an opposed player rests below neutral',
    restingRep(order, { stance: -80, path: 'human' }) < 0,
    String(restingRep(order, { stance: -80, path: 'human' })));
  check('a like-minded player rests at neutral',
    restingRep(order, { stance: 80, path: 'machine' }) === 0);
  check('opposite stance ALONE is not a major difference',
    restingRep(order, { stance: -80, path: 'machine' }) === 0);
  check('a different path ALONE is not a major difference',
    restingRep(order, { stance: 80, path: 'human' }) === 0);
  check('a lukewarm opponent is not a major difference',
    restingRep(order, { stance: -10, path: 'human' }) === 0);
  check('no player position rests at neutral', restingRep(order, null) === 0);
  check('an opposed player never fully recovers',
    decayRep(-900, daysAgo(3650), restingRep(order, { stance: -80, path: 'human' }), now) < -100);

  // ── Knowing someone is worth something ──
  const hp = { id: 'regress_help_player', hp: 50, hp_max: 100, statuses: [] };
  check('a stranger gets no help', relationHelp(hp, 'npc_help') === 0);
  const strangerQuote = treatmentQuote(hp, { rate: 2, minimum: 10 }, 'npc_help').cost;

  adjustRelation(hp, 'npc_help', { familiarity: 10, warmth: 40 });
  check('a familiar face gets a discount', relationHelp(hp, 'npc_help') > 0);
  const familiarQuote = treatmentQuote(hp, { rate: 2, minimum: 10 }, 'npc_help').cost;
  check('the clinic charges a regular less', familiarQuote < strangerQuote,
    `${strangerQuote} -> ${familiarQuote}`);

  adjustRelation(hp, 'npc_help', { familiarity: 30, warmth: 60 });
  const closeQuote = treatmentQuote(hp, { rate: 2, minimum: 10 }, 'npc_help');
  check('a close friend is patched for nothing', closeQuote.cost === 0 && closeQuote.free === true,
    JSON.stringify(closeQuote));

  // Being disliked has to cost something, or warmth is a ratchet with no downside.
  const grudge = { id: 'regress_grudge_player', hp: 50, hp_max: 100, statuses: [] };
  adjustRelation(grudge, 'npc_help', { warmth: -70 });
  check('a hostile NPC marks you up', relationHelp(grudge, 'npc_help') < 0);
  check('the clinic charges an enemy more',
    treatmentQuote(grudge, { rate: 2, minimum: 10 }, 'npc_help').cost > strangerQuote,
    String(treatmentQuote(grudge, { rate: 2, minimum: 10 }, 'npc_help').cost));

  // An unpriced NPC (no id passed) must quote exactly as before — the same
  // fallback contract the dialogue text variants have.
  check('a quote with no npc is unchanged by relationships',
    treatmentQuote(hp, { rate: 2, minimum: 10 }).cost === strangerQuote,
    `${treatmentQuote(hp, { rate: 2, minimum: 10 }).cost} vs ${strangerQuote}`);
}

// ── Layer 1g: broadcast / spawn nodes + durable waits ────────────────────────
// The three nodes that reach OUT of the graph into the world. Each is asserted
// on its observable effect (a zone message, a live enemy instance, a parked row),
// not on "it didn't throw".
console.log('— layer 1g: broadcast / spawn / durable wait —');
{
  const { runGraph, resumeDueWaits } = await import('../server/engine/graph.js');
  const { query } = await import('../server/models/db.js');
  // getAllZones() returns projections; spawn asserts on the LIVE zone object
  // (its `enemies` Set is what spawnEnemySync writes to).
  const probeZone = [...world.zones.values()].find(z => !z.flags?.is_building && z.enemies);

  const before = sent.length;
  await runGraph({ start: 'b', nodes: {
    b: { type: 'broadcast', text: 'The lights die in ${zone}.', zone: '${zone}' },
  } }, { actor: null, broadcast, params: { zone: probeZone.id } });
  const zoneMsgs = sent.slice(before).filter(s => s.zoneId === probeZone.id);
  check('broadcast node reaches the whole room (not one player)',
    zoneMsgs.length === 1 && /The lights die in/.test(zoneMsgs[0].payload?.message || '')
      && zoneMsgs[0].toPlayer == null,
    JSON.stringify(zoneMsgs[0]?.payload)?.slice(0, 90));
  check('broadcast interpolates ${zone} into its text',
    zoneMsgs[0]?.payload?.message?.includes(probeZone.id));

  // spawn: an unknown template must be a logged skip, not a thrown graph.
  const enemyCountBefore = probeZone.enemies.size;
  await runGraph({ start: 's', nodes: {
    s: { type: 'spawn', kind: 'enemy', id: 'enemy_does_not_exist_regress', zone: '${zone}' },
  } }, { actor: null, broadcast, params: { zone: probeZone.id } });
  check('spawn with a bogus template is skipped, not fatal', probeZone.enemies.size === enemyCountBefore);

  const { rows: anyEnemy } = await query('SELECT id FROM enemies LIMIT 1');
  if (anyEnemy.length) {
    await runGraph({ start: 's', nodes: {
      s: { type: 'spawn', kind: 'enemy', id: anyEnemy[0].id, zone: '${zone}', announce: 'Something arrives.' },
    } }, { actor: null, broadcast, params: { zone: probeZone.id } });
    const added = [...probeZone.enemies].filter(id => world.enemies.get(id)?.zoneId === probeZone.id);
    check('spawn node puts a live enemy instance in the zone',
      probeZone.enemies.size === enemyCountBefore + 1, `${enemyCountBefore} → ${probeZone.enemies.size}`);
    // Drop the instance we just made so later layers see an untouched zone.
    const newest = added[added.length - 1];
    if (probeZone.enemies.size > enemyCountBefore) { probeZone.enemies.delete(newest); world.enemies.delete(newest); }
  }

  // Dead drop: an item spawn with a `container` goes INSIDE it, not on the floor.
  // Asserted on the two things that actually matter — it's in the container's
  // contents, and it is NOT among the zone's ground rows (a leaked drop is worse
  // than a missing one). Name resolution is zone-scoped, so a bad name is a skip.
  {
    const { rows: box } = await query(
      `SELECT id, zone_id FROM furniture WHERE object_type='container' LIMIT 1`);
    if (box.length) {
      const dropZone = box[0].zone_id;
      const { rows: anyItem } = await query('SELECT id FROM items LIMIT 1');
      const drop = { start: 's', nodes: {
        s: { type: 'spawn', kind: 'item', id: anyItem[0].id, zone: dropZone, container: box[0].id },
      } };
      await runGraph(drop, { actor: null, broadcast });
      const { rows: inBox } = await query(
        'SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2', [box[0].id, anyItem[0].id]);
      check('dead drop lands inside the container', inBox.length === 1, `rows=${inBox.length}`);
      const { rows: onFloor } = await query(
        'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2', [`_ground_${dropZone}`, anyItem[0].id]);
      check('dead drop does NOT also land on the zone floor', onFloor.length === 0);

      // An unresolvable container skips the spawn rather than dumping it in the open.
      await runGraph({ start: 's', nodes: {
        s: { type: 'spawn', kind: 'item', id: anyItem[0].id, zone: dropZone, container: 'no such container here' },
      } }, { actor: null, broadcast });
      const { rows: leaked } = await query(
        'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2', [`_ground_${dropZone}`, anyItem[0].id]);
      check('an unresolvable container skips the drop instead of leaking it to the floor',
        leaked.length === 0, `floor rows=${leaked.length}`);

      await query('DELETE FROM player_inventory WHERE container_id=$1 AND item_id=$2', [box[0].id, anyItem[0].id]);
    }
  }

  // Durable wait: >= 120s parks a row instead of holding a timer, and resumeDueWaits
  // runs it once due. An actorless row runs immediately; a row owned by an offline
  // player stays owed rather than firing into nothing.
  await query(`DELETE FROM script_waits WHERE node_id LIKE 'regress_%'`).catch(() => {});
  const { clearFlag, getFlag } = await import('../server/engine/flags.js');
  await clearFlag('world', 'regress_durable_ran');
  await runGraph({ start: 'w', nodes: {
    w: { type: 'wait', seconds: 3600, next: 'regress_after' },
    regress_after: { type: 'setflag', scope: 'world', flag: 'regress_durable_ran', value: 'yes' },
  } }, { actor: null, broadcast });
  const { rows: parked } = await query(`SELECT * FROM script_waits WHERE node_id='regress_after'`);
  check('a long wait parks a row instead of holding a timer', parked.length === 1, `rows=${parked.length}`);
  check('the parked row is not yet due', await getFlag('world', 'regress_durable_ran') === undefined);

  await query(`UPDATE script_waits SET due_at=$1 WHERE node_id='regress_after'`, [Date.now() - 1000]);
  await resumeDueWaits(broadcast);
  check('resumeDueWaits runs a due parked continuation',
    await getFlag('world', 'regress_durable_ran') === 'yes');
  const { rows: leftover } = await query(`SELECT id FROM script_waits WHERE node_id='regress_after'`);
  check('a resumed wait deletes its row', leftover.length === 0);

  // A row owned by a player who is not live must be left alone, not consumed.
  await query(
    `INSERT INTO script_waits (id, graph, node_id, player_id, params, due_at)
     VALUES ('regress_owed', $1, 'regress_owed_node', 'player_who_is_offline', '{}', $2)`,
    [JSON.stringify({ nodes: { regress_owed_node: { type: 'say', text: 'hi' } } }), Date.now() - 1000]);
  await resumeDueWaits(broadcast);
  const { rows: owed } = await query(`SELECT id FROM script_waits WHERE id='regress_owed'`);
  check('a due wait for an offline player stays owed', owed.length === 1);
  await query(`DELETE FROM script_waits WHERE id='regress_owed'`);
  await clearFlag('world', 'regress_durable_ran');
}

// ── Layer 1g2: the enemy leash, pursuit, and the destination law ─────────────
// ROAM is an unbiased random walk, so before the leash a wanderer eventually
// reached anywhere the exit graph touched. These assert the three pieces that
// bound it — and, just as importantly, that a creature WITHOUT the new opt-in
// behaves exactly as it did before, since 44 shipped enemies depend on that.
console.log('— layer 1g2: leash / chase / destination law —');
{
  const { distanceFromSpawn, leashCandidates, canChase, moveEntity } =
    await import('../server/engine/ai-behaviour.js');
  const { spawnEnemySync } = await import('../server/engine/world.js');

  // A patch of real grid to measure against, so this tests the shipped map rather
  // than a fixture's idea of one. Pick a home that actually HAS the neighbours the
  // gradient checks need — an arbitrary first tile can sit on a map edge, which
  // silently skipped the two most valuable assertions here.
  const gridZones = [...world.zones.values()]
    .filter(z => z.grid_x != null && z.grid_y != null && z.map_id);
  const byPos = new Map(gridZones.map(z => [`${z.map_id}|${z.grid_z ?? 0}|${z.grid_x}|${z.grid_y}`, z]));
  const near = (origin, dx, dy) =>
    byPos.get(`${origin.map_id}|${origin.grid_z ?? 0}|${origin.grid_x + dx}|${origin.grid_y + dy}`);
  const OFFSETS = [[1, 1], [1, 0], [0, 1], [-1, 0], [0, -1], [5, 0], [6, 0], [7, 0]];
  const home = gridZones.find(z => OFFSETS.every(([dx, dy]) => near(z, dx, dy))) || gridZones[0];
  check('leash fixture found a tile with room around it (else checks below skip)',
    OFFSETS.every(([dx, dy]) => near(home, dx, dy)), home.id);
  const at = (dx, dy) => near(home, dx, dy);

  const mob = { instanceId: 'regress_leash_mob', spawnZoneId: home.id, flags: {}, _ai: {} };

  check('distance from a mob to its own spawn tile is zero',
    distanceFromSpawn(mob, home.id) === 0);

  const diag = at(1, 1);
  if (diag) {
    check('distance is Chebyshev, so a diagonal step is 1 tile not 2',
      distanceFromSpawn(mob, diag.id) === 1, `got ${distanceFromSpawn(mob, diag.id)}`);
  }

  const offMap = [...world.zones.values()].find(z => z.map_id && z.map_id !== home.map_id);
  if (offMap) {
    check('a zone on another map is definitively elsewhere, not a big number',
      distanceFromSpawn(mob, offMap.id) === Infinity);
  }
  check('a zone with no grid position is elsewhere too',
    distanceFromSpawn(mob, 'zone_that_does_not_exist_regress') === Infinity);

  // ── the three-value radius encoding ──
  // This is the assertion that matters most to a future refactor: it is very
  // tempting to write `Number(f) || LEASH_RADIUS`, which silently maps BOTH 0 and
  // undefined to the default and makes "pinned" impossible to express.
  const exits = ['a', 'b', 'c'];
  check('leash_radius -1 means unleashed: every exit stays on the table',
    leashCandidates({ ...mob, flags: { leash_radius: -1 } }, home.id, exits).length === 3);
  check('leash_radius 0 means PINNED, not unleashed',
    leashCandidates({ ...mob, flags: { leash_radius: 0 } }, home.id, exits).length === 0);
  check('a mob with no spawn stamp is unleashed (the feature is simply absent)',
    leashCandidates({ instanceId: 'x', flags: {} }, home.id, exits).length === 3);

  const neighbours = [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)].filter(Boolean).map(z => z.id);
  if (neighbours.length) {
    check('inside the radius a mob wanders freely — every near exit is legal',
      leashCandidates({ ...mob, flags: { leash_radius: 5 } }, home.id, neighbours).length === neighbours.length);
    // radius 1 is the tightest MEANINGFUL leash: standing at home, every neighbour
    // is exactly 1 away, so a tight leash paces its box rather than freezing.
    check('radius 1 still lets a mob step off its own tile (it paces a 3x3 box)',
      leashCandidates({ ...mob, flags: { leash_radius: 1 } }, home.id, neighbours).length === neighbours.length);
  }

  const far = at(6, 0);
  const backOne = at(5, 0);
  const further = at(7, 0);
  if (far && backOne && further) {
    const out = leashCandidates({ ...mob, flags: { leash_radius: 3 } }, far.id, [backOne.id, further.id]);
    check('outside the radius only steps that bring it home are offered',
      out.length === 1 && out[0] === backOne.id, out.join(','));
  }

  // ── pursuit is opt-in ──
  const plainGraph = { nodes: { a: { type: 'action', action_type: 'ATTACK' } } };
  const chaseGraph = { nodes: { a: { type: 'action', action_type: 'CHASE' } } };
  check('a creature with no CHASE node does not pursue (every shipped enemy)',
    canChase({ behaviour_graph: plainGraph }) === false);
  check('a creature with a CHASE node pursues',
    canChase({ behaviour_graph: chaseGraph }) === true);
  check('a creature with no graph at all does not pursue',
    canChase({}) === false);

  // ── pursuit modes ──
  // The police hunt somebody they are deliberately NOT targeting: under ~4 stars a
  // unit must arrive and detain, and a targetId is what makes the graph swing. That
  // is why CHASE grew a `flag` mode — and why the surveillance plugin was able to
  // delete its own duplicate pursuit loop. These pin the seam that made that safe.
  {
    const { tickEntityAI } = await import('../server/engine/ai-behaviour.js');
    const hunterGraph = {
      _start: 's',
      nodes: {
        s: { type: 'action', action_type: 'CHASE',
             params: { quarry: 'flag', flag: 'suspect_id' }, next: 'l' },
        l: { type: 'loop', next: 's' },
      },
    };
    const mk = () => ({
      instanceId: 'regress_hunter', name: 'a regress unit', hp: 10, hp_max: 10,
      zoneId: home.id, spawnZoneId: home.id, targetId: null,
      flags: { hunter: true, suspect_id: 'nobody_regress', leash_radius: -1 },
      behaviour_graph: hunterGraph,
      _ai: { currentNode: null, waitUntil: null, patrolPath: [], flags: {} },
    });

    const noQuarry = mk();
    noQuarry.flags.suspect_id = null;
    // Must not throw and must not invent a target out of nothing.
    await tickEntityAI(noQuarry, () => {}, null);
    check('a hunt with nobody to hunt does nothing', noQuarry.targetId === null);

    // The headline property: a flag-mode chase never writes targetId. If it did,
    // every unit would arrive swinging and the whole detain-under-4-stars branch
    // would be unreachable.
    const hunting = mk();
    for (let i = 0; i < 3; i++) await tickEntityAI(hunting, () => {}, null);
    check('a flag-mode chase never acquires a combat target',
      hunting.targetId === null, String(hunting.targetId));

    // …and it must not clear the flag either: the id belongs to whoever set it,
    // and a unit that forgot its suspect would stand still for the rest of the hunt.
    check('…and never clears the suspect it was given',
      hunting.flags.suspect_id === 'nobody_regress');

    check('leash_radius -1 is what lets a manhunt cross the map',
      leashCandidates(hunting, home.id, ['a', 'b', 'c']).length === 3);
  }

  // ── the destination law ──
  // Sanctuary and no_spawn have gated SPAWNING since they existed; until now they
  // never gated WALKING, so a mob could stroll into the one square the rules
  // promised was safe.
  const { rows: tmpl } = await query('SELECT * FROM enemies LIMIT 1');
  // A NEIGHBOUR of home, not just any zone: moveEntity now refuses a step between
  // two zones with no exit between them (the stale-route guard), so an arbitrary
  // room across the map would be blocked by that law long before reaching this one.
  const guarded = neighborZoneIds(world.zones.get(home.id))
    .map(id => world.zones.get(id))
    .find(z => z && z.id !== home.id && z.enemies && neighborZoneIds(z).includes(home.id));
  if (tmpl.length && guarded) {
    const inst = spawnEnemySync(tmpl[0], home.id);
    check('a spawned enemy records where it came from', inst.spawnZoneId === home.id);

    const priorFlags = guarded.flags;
    guarded.flags = { ...(priorFlags || {}), no_spawn: true };
    const blocked = moveEntity(inst, guarded.id, () => {}, null);
    check('an enemy may not WALK into a no-spawn zone, only fail to spawn there',
      blocked === false);

    // Destination-only, deliberately: if this also inspected where the mob came
    // FROM, anything already standing in a protected zone could never leave.
    inst.zoneId = guarded.id;
    guarded.enemies.add(inst.instanceId);
    const outward = moveEntity(inst, home.id, () => {}, null);
    check('…but it may always walk back OUT of one', outward === true);

    // The law does not apply to the law. A manhunt unit must be able to follow a
    // suspect into a safe room — huntStep calls moveEntity directly and does not
    // re-route on a refusal, so without this a cop stalls at the threshold forever
    // while the suspect sits inside, and any sanctuary ends a manhunt permanently.
    const cop = spawnEnemySync(tmpl[0], home.id);
    cop.flags = { ...(cop.flags || {}), hunter: true };
    check('a manhunt unit may follow a suspect into a sanctuary',
      moveEntity(cop, guarded.id, () => {}, null) === true);
    world.zones.get(cop.zoneId)?.enemies.delete(cop.instanceId);
    world.enemies.delete(cop.instanceId);

    guarded.flags = priorFlags;

    // ── the adjacency law ──
    // A step must follow a real exit. Nothing that walks ever means otherwise: a
    // route only points somewhere unreachable once it has gone STALE (something
    // else moved the entity out from under it), and moving there anyway announced
    // itself to two unrelated rooms as a directionless "X leaves."/"X arrives.".
    // Charter pilots did exactly that once a second for as long as anyone watched.
    {
      const homeNbrs = new Set(neighborZoneIds(world.zones.get(home.id)));
      const far = [...world.zones.values()].find(z => z.id !== home.id && !homeNbrs.has(z.id) && z.enemies);
      if (far) {
        const walker = spawnEnemySync(tmpl[0], home.id);
        walker._ai = { patrolPath: ['somewhere', 'stale'], patrolTarget: 'stale', flags: {} };
        check('a step to a zone with no exit between them is refused',
          moveEntity(walker, far.id, () => {}, null) === false);
        check('…the entity stays where it was', walker.zoneId === home.id, walker.zoneId);
        check('…and the dead route is dropped so it re-paths from where it stands',
          walker._ai.patrolPath.length === 0 && walker._ai.patrolTarget === null);
        check('…but a caller that means it can still teleport',
          moveEntity(walker, far.id, () => {}, null, { teleport: true }) === true);
        world.zones.get(walker.zoneId)?.enemies.delete(walker.instanceId);
        world.enemies.delete(walker.instanceId);
      }
    }

    world.zones.get(inst.zoneId)?.enemies.delete(inst.instanceId);
    guarded.enemies.delete(inst.instanceId);
    world.enemies.delete(inst.instanceId);
  }
}

// ── Stale-fixture sweep (start of run, deliberately) ──────────────────────────
//
// Suite fixtures that live in the DB are created and deleted by straight-line code:
// DELETE by id, INSERT, …checks…, DELETE by id. A check that THROWS between the two
// deletes skips the teardown, and the row survives the process — into the NEXT run,
// where it is no longer a fixture but world content. Aircraft are the sharp case,
// because several are parked in the fake player's own zone: a leftover one made three
// unrelated suites fail on the following run ("no aircraft here" checks found one, and
// `embark` answered with the pilot-licence gate). The failures pointed nowhere near
// the suite that actually leaked them.
//
// This runs at the START, unlike the orphaned-per-player sweep at the very end, and
// the difference is the whole point: an end-of-run sweep cannot help a run that died
// before reaching it. Nothing has created a fixture yet at this point, so there is
// nothing live to wipe.
//
// Scoped to ids only this suite ever mints (`aircraft_regress_*`) — deliberately NOT
// `aircraft_test_*`, which is what the in-game `testfly` verb conjures and would mean
// deleting a developer's own aircraft out of their dev world.
{
  const { rowCount } = await query("DELETE FROM aircraft WHERE id LIKE 'aircraft\\_regress\\_%'");
  if (rowCount) console.log(`  · swept ${rowCount} stale aircraft fixture(s) left by a previous crashed run`);
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
// …and it must not be a room inside a VEHICLE. An aircraft cabin or a deck of the
// Echelon is an ordinary-looking interior by every test above — exits, dry, no
// door, unique name — and `find()` lands on whichever the DB hands back first, so
// a re-ordered world silently anchored the fake player inside the Leviathan. From
// there the flight suite parked that very aircraft on its own cabin
// (`parked_zone_id = p.current_zone`) and then asserted that disembarking leaves
// the cabin, which cannot be true. A vehicle interior also MOVES, is entry-gated,
// and is always_lit — none of which an anchor room may be.
// NEXT DOOR to a vehicle is just as bad, and is how this actually bit: the anchor
// landed on `zone_util_zone_leviathan_cabin` — the utility room power self-heal
// built under the flying base — whose own flags say nothing about aircraft and
// whose one exit goes UP into the cabin. The move fixtures took that exit and left
// the player aboard for every suite that followed.
const inVehicle = (z) => !!(z.flags?.aircraft_cabin || z.flags?.vessel || z.flags?.echelon);
const nearVehicle = (z) => inVehicle(z) || neighborZoneIds(z).some(n => inVehicle(zoneById.get(n)));
const baseOk = (z) =>
  z.exits && Object.keys(z.exits).length > 0 &&
  !z.flags?.water &&
  !nearVehicle(z) &&
  !doorZones.has(z.id) &&
  !getApartment(z.id) &&
  !z.flags?.prologue &&
  !neighborZoneIds(z).some(n => doorZones.has(n)) &&
  dryExit(z);
const zone =
  zones.find(z => baseOk(z) && uniqueName(z) && uniqueName(zoneById.get(dryExit(z)[1])))
  || zones.find(baseOk);
if (!zone) { console.error('No door-free, dry zone with a passable exit found; aborting.'); process.exit(1); }
// Printed because which zone this lands on is DB-row-order dependent, and when a
// suite fails for a reason that makes no sense, the anchor is the first thing to
// check (see the vehicle-interior note above).
console.log(`· fake player anchored at ${zone.id} ("${zone.name}")`);

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

// ── Brief, against a REAL room ───────────────────────────────────────────────
// The unit cases further down use synthetic markup, which proves the transform's
// logic but NOT that it recognises what describeZone actually emits. That is the
// whole risk of parsing another module's output, so it gets checked against the
// live renderer here — if describeZone's shape drifts, this is what notices.
{
  const { briefRoom } = await import('../server/engine/room-brief.js');
  const full = r?.message || '';
  const short = briefRoom(full);
  check('brief: a real room description is recognised and shortened',
    short.length < full.length, `${short.length} vs ${full.length}`);
  check('brief: …and keeps the room name', /zone-name/.test(short), short.slice(0, 200));
  // The load-bearing half: a brief is only safe to repeat because it carries
  // everything that could have changed. Exits are the one every room has.
  if (/exits-row/.test(full)) {
    check('brief: …and keeps the exits', /exits-row/.test(short), short.slice(0, 400));
  }
  check('brief: …and drops the prose paragraph', !/room-desc/.test(short), short.slice(0, 400));

  // The ARRIVAL tier, against the same real room. A move says where you are and
  // what can hurt you; everything else waits for `look`. Checked against the
  // live renderer for the same reason brief is — it parses describeZone's markup.
  const { arrivalRoom } = await import('../server/engine/room-brief.js');
  const arr = arrivalRoom(full);
  check('arrival: a real room shortens further than brief still',
    arr.length <= short.length, `${arr.length} vs ${short.length}`);
  check('arrival: …and still says where you are', /zone-name/.test(arr), arr.slice(0, 200));
  check('arrival: …and drops the prose', !/room-desc/.test(arr), arr.slice(0, 400));
}

// ── Dialogue at the bottom Display Mode rung ─────────────────────────────────
// The dialogue panel is a modal you CLICK, and a `log` player has no panel — so
// until this existed they could open a conversation, not read it back, and not
// answer it. What's pinned here is the surface, not any particular tree: the
// frame reaches the log with its options numbered, a bare number advances it,
// and the conversation is face-to-face (walk away and it's over).
{
  const savedZone = getPlayer().current_zone;
  const savedMode = getPlayer().displayRung;
  // Any NPC whose root offers ungated options. Vendors are excluded only because
  // their implicit "Browse your wares." door leads to the shop rather than to a
  // second frame, which is a different check.
  const npc = [...world.npcs.values()].find(n =>
    n.zone_id && !(n.vendor_inventory || []).length
    && (n.dialogue_tree?.root?.options || []).length >= 2
    && !n.dialogue_tree.root.options.some(o => o.conditions || o.condition || o.actions?.length)
    && n.dialogue_tree.root.options.every(o => n.dialogue_tree[o.next]));
  check('log rung: the world has a plain conversation to test against', !!npc,
    npc ? npc.name : 'no NPC with an ungated 2-option root');
  if (npc) {
    getPlayer().current_zone = npc.zone_id;
    getPlayer().displayRung = 'log';
    const opened = await run(`talk ${npc.name}`);
    const first = opened?.message || '';
    check('log rung: talking writes the conversation instead of pushing a panel',
      opened?.type === 'output' && !/^dialogue/.test(String(opened?.type)), JSON.stringify(opened)?.slice(0, 200));
    check('…with the options numbered', />1\)</.test(first) && /">2\)</.test(first), first.slice(0, 500));
    check('…and how to answer', /reply/.test(first) && /endtalk/.test(first), first.slice(-300));

    // A bare number is the whole interaction on this rung — `reply 1` and `1`
    // must be the same act.
    const second = await run('1');
    check('a bare number advances the conversation',
      second?.type === 'output' && second.message !== first, String(second?.message).slice(0, 300));
    check('…and `reply` on its own repeats rather than advancing',
      (await run('reply'))?.message === second?.message, 'reply with no argument moved the conversation');
    check('…and a number nobody offered is refused, not guessed at',
      (await run('reply 99'))?.type === 'error', 'reply 99 was accepted');

    // Face-to-face: the state is keyed to the zone it opened in.
    getPlayer().current_zone = savedZone;
    const away = await run('reply 1');
    check('walking away ends the conversation', away?.type === 'error' && /over|isn't here/.test(away.message), JSON.stringify(away)?.slice(0, 200));
    check('…and the bare-number intercept lets go with it',
      !/reply/.test(String((await run('1'))?.message || '')), 'a bare number still routed to a dead conversation');

    // …and the rung above is untouched: a visual player still gets the panel.
    getPlayer().current_zone = npc.zone_id;
    getPlayer().displayRung = 'visual';
    check('the visual rung still opens the dialogue panel',
      (await run(`talk ${npc.name}`))?.type === 'dialogue', 'visual talk did not return a dialogue frame');
    await run('endtalk');
  }
  getPlayer().current_zone = savedZone;
  getPlayer().displayRung = savedMode;
}

// ── Three panels that had no written form at the log rung ────────────────────
// A body you can't read, a box you can't read, and a recipe list you can't
// read. Each was reachable by verb and blind: `lootall` took things you never
// saw, `open` said only that you'd opened it, `recipes` sent a panel and no
// text at all. The rule being pinned is the doc's: at this rung the RECORD
// reaches the log.
{
  const savedMode = getPlayer().displayRung;

  // Loot. Driven through the builder + the reply fork rather than a live corpse,
  // because what's under test is the presentation, not corpse spawning.
  {
    const { lootReply } = await import('../server/engine/commands/combat.js');
    const view = {
      type: 'loot_view', corpseId: 'corpse_x', corpseName: 'Dead Scrapper', butcherable: true,
      items: [{ name: 'Rusty Pipe', quantity: 1 }, { name: 'Cred Chip', quantity: 3 }], invItems: [],
    };
    check('loot: the visual rung still gets the panel',
      lootReply(view, { displayRung: 'visual' }).type === 'loot_view');
    const logged = lootReply(view, { displayRung: 'log' });
    check('loot: the log rung reads the body instead', logged.type === 'output', JSON.stringify(logged).slice(0, 120));
    check('loot: …every item on it is named',
      /Rusty Pipe/.test(logged.message) && /Cred Chip/.test(logged.message), logged.message);
    check('loot: …with the count', /x3/.test(logged.message), logged.message);
    check('loot: …and a way to take them', /loot &lt;item&gt; from Dead Scrapper/.test(logged.message)
      && /lootall corpse_x/.test(logged.message), logged.message.slice(-260));
    check('loot: …and the carve, when there is meat left', /butcher/.test(logged.message), logged.message.slice(-260));
    const empty = lootReply({ ...view, items: [] }, { displayRung: 'log' });
    check('loot: an empty body says so rather than printing a bare header',
      /Nothing left to take/.test(empty.message), empty.message);
  }

  // Containers. The pacing split is the part worth pinning: OPENING prints the
  // shelf, a stow/pull does NOT reprint forty rows.
  {
    const { containerReply } = await import('../server/engine/commands/inventory.js');
    const view = {
      type: 'container_view', containerId: 'box_x', containerName: 'Chest Freezer',
      capacity: 20000, usedWeight: 1200, containerItems: [{ name: 'Fish Fillet', quantity: 2, group: 'Frozen' }],
      invItems: [], compartments: [{ label: 'Top Shelf', active: true }, { label: 'Bottom Drawer', active: false }],
    };
    check('container: the visual rung still gets the panel',
      containerReply(view, { displayRung: 'visual' }).type === 'container_view');
    const opened = containerReply(view, { displayRung: 'log' });
    check('container: opening one reads it out', opened.type === 'examine' && /Fish Fillet/.test(opened.message), JSON.stringify(opened).slice(0, 160));
    check('container: …sectioned as the panel sections it', /Frozen/.test(opened.message), opened.message);
    check('container: …naming the shelves you are not looking at',
      /Bottom Drawer/.test(opened.message) && !/Top Shelf/.test(opened.message), opened.message);
    const stowed = containerReply(view, { displayRung: 'log' }, 'You stow Fish Fillet in Chest Freezer.');
    check('container: a stow says what it did and does NOT reprint the shelf',
      stowed.type === 'output' && /You stow/.test(stowed.message) && !/Fish Fillet<\/span> x2/.test(stowed.message),
      stowed.message);
  }

  // Crafting. Note the verb: `recipes` is DECLARED by the crafting plugin and
  // owned by the drinks one, so bare `craft` is the only live door to this list —
  // which is why it lists instead of erroring, and why this case guards the verb
  // as much as the rendering.
  {
    const saved = getPlayer().displayRung;
    getPlayer().displayRung = 'log';
    const out = await run('craft');
    check('craft: bare `craft` lists rather than pointing at a shadowed verb',
      out?.type === 'output' && !/Craft what\?/.test(out.message || ''), JSON.stringify(out)?.slice(0, 140));
    if (out?.type === 'output' && !/don't know how to make/.test(out.message)) {
      check('craft: …and the log rung shows what you are SHORT of, not just that you are short',
        /\d+\/\d+/.test(out.message) || /craft /.test(out.message), out.message.slice(0, 400));
    }
    getPlayer().displayRung = 'visual';
    check('craft: the visual rung still gets the panel', (await run('craft'))?.type === 'recipes',
      JSON.stringify(await run('craft'))?.slice(0, 140));
    getPlayer().displayRung = saved;
  }

  getPlayer().displayRung = savedMode;
}

// ── Room pane: attached satellites and light clicks ──────────────────────────
// Two rules about how the `Furniture:` line CLICKS, both easy to break silently
// because nothing throws when a link points at the wrong verb.
{
  const saved = getPlayer().current_zone;
  // A room with a television and a Betamax deck under it. The CONSUMER deck is
  // absorbed into the set entirely — it isn't in the pane at all, because the
  // television's own display carries its transport (plugins/broadcast `tv_deck`).
  // The television, of course, stays.
  getPlayer().current_zone = 'zone_solenne_apt_b';
  const deckRows = (html) => [...html.matchAll(/<span class="action-link[^"]*"[^>]*data-ftype="media_deck"[^>]*>/g)].map(([m]) => m);
  const body = (await run('look'))?.message || '';
  check('a consumer deck under a set is absorbed out of the room pane', deckRows(body).length === 0, body.slice(0, 900));
  check('the television keeps its own entry', /data-target="Polaris Executive Chromavision 88"/.test(body), body.slice(0, 900));
  {
    // …UNLESS no TV panel opens for this player. At the log rung the strip never
    // arrives, so the deck must be back in the pane as the satellite row it has
    // always had — absorbing it there would strand it behind a surface that
    // doesn't exist. This is the check that keeps that rung honest.
    const savedMode = getPlayer().displayRung;
    getPlayer().displayRung = 'log';
    const logBody = (await run('look'))?.message || '';
    const logRows = deckRows(logBody);
    getPlayer().displayRung = savedMode;
    check('…but at the log rung it is back, exactly once', logRows.length === 1, logBody.slice(0, 900));
    check('…hanging off its television rather than standing alone',
      logRows.every((m) => /furniture-attached/.test(m)), logRows.join('\n'));
    check('…and clicking through to its own panel',
      logRows.every((m) => /data-action="use"/.test(m)), logRows.join('\n'));
  }

  // ── Sectioned furniture ────────────────────────────────────────────────────
  // 30-B holds fifteen pieces with fifteen different names, so neither collapse
  // pass fires and the flat line is a paragraph. It sections instead. The rules
  // worth pinning: the sections REPLACE the single `Furniture:` label (a
  // remainder labelled "Furniture" under a heading that already said Furniture
  // is the thing this fixes), and no piece is lost between the two shapes.
  check('a busy room sections its furniture by type', /class="room-furn-secs"/.test(body), body.slice(0, 900));
  check('…and the sections replace the single Furniture: label',
    !/>Furniture:</.test(body), body.slice(0, 900));
  for (const label of ['Appliances:', 'Storage:', 'Media:']) {
    check(`…${label} is one of them`, body.includes(`>${label}<`), body.slice(0, 1200));
  }
  {
    // Nothing-is-ever-lost, and nothing is printed twice: the count of furniture
    // links equals the count of DISTINCT pieces among them. Asserted as a
    // relationship rather than a magic number, so re-dressing the flat doesn't
    // turn this red. A piece landing in two sections is the failure this catches.
    const links = [...body.matchAll(/class="action-link furniture-link"[^>]*data-target="([^"]+)"/g)].map((m) => m[1]);
    check('no piece is printed in two sections',
      links.length >= 8 && new Set(links).size === links.length, `${links.length} links: ${links.join(' | ')}`);
    check('…and the pieces themselves are still there',
      links.some((t) => /Chromavision/.test(t)) && links.some((t) => /Ember 300/.test(t)), links.join(' | '));
  }
  // …and a room with a handful of things stays flat, which is the common answer.
  getPlayer().current_zone = 'zone_apt_12';
  const smallBody = (await run('look'))?.message || '';
  check('a small room keeps the flat Furniture: line',
    !/room-furn-secs/.test(smallBody) && /Furniture:/.test(smallBody), smallBody.slice(0, 600));
  getPlayer().current_zone = 'zone_solenne_apt_b';

  // A switchable light clicks to its own switch rather than to examine, and the
  // tooltip says which way it will go — the pane already prints the state, so the
  // click a player reaches for is the flip.
  getPlayer().current_zone = 'zone_apt_12';
  const lampBody = (await run('look'))?.message || '';
  const lamp = lampBody.match(/<span class="action-link[^>]*data-target="(?:on|off) portable lamp"[^>]*>/)?.[0] || '';
  check('a switchable light clicks to its switch', /data-action="switch"/.test(lamp), lampBody.slice(0, 900));
  check('…and the tooltip says which way', /title="Turn (?:on|off) portable lamp"/.test(lamp), lamp);
  const lampRow = getZone('zone_apt_12') && world.furniture?.get('furn_apt12_lamp');
  const want = lampRow ? (lampRow.light_on ? 'off' : 'on') : null;
  check('…in the direction opposite its current state',
    !want || new RegExp(`data-target="${want} portable lamp"`).test(lamp), `light_on=${lampRow?.light_on} link=${lamp}`);

  // `flags.click_cmd`: a piece with a FACE (a card machine, a terminal) clicks
  // through to the command that opens it rather than to examine, which would
  // print a second drawing of the thing into the log. Verified on the live lamp
  // row so the seam is exercised, not just the flag read.
  if (lampRow) {
    const savedFlags = lampRow.flags;
    lampRow.flags = { ...(savedFlags || {}), click_cmd: 'buypack' };
    const cmdBody = (await run('look'))?.message || '';
    const link = cmdBody.match(/<span class="action-link[^>]*data-cmd="buypack"[^>]*>/)?.[0] || '';
    check('flags.click_cmd sends its command instead of examine',
      /data-action="cmd"/.test(link) && /data-cmd="buypack"/.test(link), cmdBody.slice(0, 900));
    check('…and still carries the bare piece name for the smart bar',
      /data-piece="portable lamp"/.test(link), link);
    lampRow.flags = savedFlags;
  }
  getPlayer().current_zone = saved;
}

r = await run('zzznotacommand');
check('unknown verb → error', r?.type === 'error' && /Unknown command/.test(r.message), r?.message);

r = await run('sit');
check('sit sets posture', getPlayer().posture === 'sitting', `posture=${getPlayer().posture}`);

r = await run('stand');
check('stand resets posture', getPlayer().posture === 'standing', `posture=${getPlayer().posture}`);

r = await run('stop');
check('bare stop → nothing to stop', /aren't doing anything/.test(r?.message || ''), r?.message);

// ── Zone message delivery (engine/delivery.js) ─────────────────────────────────
// The single most load-bearing decision in the server: does this room line reach
// this player? It used to live inside broadcast() in index.js with no coverage
// at all — a wiring mistake wouldn't throw, the room would just go quiet. It is
// now a testable function, so these are the rules, asserted.
{
  const { zoneAudience, receivesZoneMessage } = await import('../server/engine/delivery.js');
  const { setLivePlayer, removeLivePlayer, getZone, addPlayerToZone, removePlayerFromZone } =
    await import('../server/engine/world.js');

  const me = getPlayer();
  const zid = me.current_zone;
  const zone = getZone(zid);

  // A second occupant, so "everyone in the room" means more than one person.
  const MATE = '__regress_roommate';
  setLivePlayer(MATE, { id: MATE, handle: 'Roommate', posture: 'standing', current_zone: zid });
  addPlayerToZone(MATE, zid);
  try {
    let aud = zoneAudience(zid);
    check('delivery: both occupants hear the room', aud.includes(me.id) && aud.includes(MATE), aud);

    // The catastrophic case this whole block exists for.
    check('delivery: a room with occupants is never silent', aud.length >= 2, aud.length);

    // Exclusions — the speaker doesn't hear their own line echoed back.
    aud = zoneAudience(zid, { exclude: [me.id] });
    check('delivery: exclude drops that player only', !aud.includes(me.id) && aud.includes(MATE), aud);
    aud = zoneAudience(zid, { exclude: [me.id, MATE] });
    check('delivery: both exclude slots work', aud.length === 0, aud);
    aud = zoneAudience(zid, { excludeSet: new Set([MATE]) });
    check('delivery: excludeSet drops its members', !aud.includes(MATE) && aud.includes(me.id), aud);

    // The three predicate rules.
    const mate = (await import('../server/engine/world.js')).getLivePlayer(MATE);
    mate.sleeping = true;
    check('delivery: a sleeping player does not perceive the room',
      !zoneAudience(zid).includes(MATE));
    mate.sleeping = false;

    mate.posture = 'flying';
    check('delivery: an airborne player does not get ground ambience',
      !zoneAudience(zid).includes(MATE));
    mate.posture = 'standing';

    mate.current_zone = 'somewhere_else';
    check('delivery: current_zone wins over a stale occupant set',
      !zoneAudience(zid).includes(MATE));
    mate.current_zone = zid;
    check('delivery: and they come back when it agrees again', zoneAudience(zid).includes(MATE));

    // Unknown zone must be empty, not a throw.
    check('delivery: an unknown zone has no audience',
      zoneAudience('__regress_no_such_zone').length === 0);

    check('delivery: the predicate rejects a null player', receivesZoneMessage(null, zid) === false);
  } finally {
    removePlayerFromZone(MATE, zid);
    removeLivePlayer(MATE);
  }
}

// ── Zone membership (what zone broadcasts are delivered by) ────────────────────
// broadcast() no longer scans every connected client to find a room's occupants;
// it walks `zone.players`. That makes room chatter O(occupants) instead of
// O(players), but it also means a player missing from that set stops hearing
// their room with NO error — so the invariant "current_zone implies membership"
// is now load-bearing, and reconcileZoneMembership() is the safety net.
{
  const { reconcileZoneMembership, getZone, world: w } = await import('../server/engine/world.js');
  const p = getPlayer();
  const zid = p.current_zone;
  const zone = getZone(zid);

  check('zone membership: a live player is in their own zone\'s player set',
    !!zone && zone.players.has(p.id), `zone=${zid}`);

  // Simulate the exact bug the sweep exists for: a path that sets current_zone
  // without addPlayerToZone(). Before the sweep runs, that player is deaf.
  zone.players.delete(p.id);
  check('zone membership: drift is detectable (player absent from the set)',
    !zone.players.has(p.id));
  const repaired = reconcileZoneMembership({ quiet: true });
  check('zone membership: the sweep repairs drift', repaired >= 1 && zone.players.has(p.id),
    `repaired=${repaired}`);
  check('zone membership: a clean world needs no repair',
    reconcileZoneMembership({ quiet: true }) === 0);

  // A player aboard an aircraft is deliberately absent from the ground zone —
  // the sweep must not "repair" them back into a room they left the ground from.
  const priorPosture = p.posture;
  zone.players.delete(p.id);
  p.posture = 'flying';
  check('zone membership: an airborne player is NOT dragged back into the ground zone',
    reconcileZoneMembership({ quiet: true }) === 0 && !zone.players.has(p.id));
  p.posture = priorPosture;
  reconcileZoneMembership({ quiet: true });
  check('zone membership: restored once they are back on the ground', zone.players.has(p.id));

  // A player whose zone isn't a real DB room (transient void tiles) must not
  // throw or be counted as drift.
  const priorZone = p.current_zone;
  p.current_zone = '__regress_nonexistent_zone';
  check('zone membership: an unknown zone is skipped, not an error',
    reconcileZoneMembership({ quiet: true }) === 0);
  p.current_zone = priorZone;
}

// ── Work-gate substrate ────────────────────────────────────────────────────────
// Ticks that poll a table for outstanding work skip the round trip when the
// table is known-empty. The dangerous failure is a gate that says "nothing to
// do" forever because one writer forgot to call noteWork() — so the properties
// asserted here are the ones that make that a delay instead of a permanent
// stall: it re-probes on a timer regardless, and it fails OPEN.
{
  const { createWorkGate } = await import('../server/engine/worklist.js');

  let pending = 0, probes = 0;
  const gate = createWorkGate({
    name: '__regress_gate',
    probe: async () => { probes += 1; return pending; },
    reconcileMs: 50,
  });

  check('work gate: empty table → the tick is skipped', (await gate.shouldRun()) === false);
  const probesAfterFirst = probes;
  check('work gate: a skip costs no further probe', (await gate.shouldRun()) === false && probes === probesAfterFirst,
    `probes=${probes}`);

  pending = 1;
  gate.noteWork();
  check('work gate: noteWork() re-probes and lets the tick run', (await gate.shouldRun()) === true);

  pending = 0;
  gate.noteDrained(0);
  check('work gate: draining closes it again', (await gate.shouldRun()) === false);

  // The safety net: a writer that never called noteWork() must still surface.
  pending = 1;
  check('work gate: still shut before the reconcile window elapses', (await gate.shouldRun()) === false);
  await new Promise(r => setTimeout(r, 60));
  check('work gate: re-probes on its own after reconcileMs, so a missed noteWork is a DELAY not a stall',
    (await gate.shouldRun()) === true);

  // A probe that throws must never be read as "nothing to do".
  const failing = createWorkGate({
    name: '__regress_gate_fail',
    probe: async () => { throw new Error('db down'); },
  });
  check('work gate: a failed probe fails OPEN (runs the tick)', (await failing.shouldRun()) === true);
}

// ── Activity-tick substrate ────────────────────────────────────────────────────
// Six plugins used to run the identical posture sweep on their own 1s timer.
// They now register here instead, so the contract this seam guarantees — fires
// while the posture holds, cleans up exactly once when it doesn't — is the thing
// keeping fishing/mining/work honest. Registered under a private posture so it
// cannot collide with a real activity.
{
  const { registerActivity, runActivityTick } = await import('../server/engine/activity-tick.js');
  const seen = { ticks: 0, abandons: 0, sawState: null };
  registerActivity({
    posture: '__regress_activity',
    stateKey: '__regressActivityState',
    onTick: (player, st) => { seen.ticks += 1; seen.sawState = st; },
    onAbandon: (player) => { seen.abandons += 1; delete player.__regressActivityState; },
  });

  const p = getPlayer();
  const priorPosture = p.posture;

  // Posture set but no state → nothing fires. (A player who just stood up from
  // an activity must not get a phantom tick.)
  p.posture = '__regress_activity';
  await runActivityTick();
  check('activity tick: posture without state does not fire', seen.ticks === 0, `ticks=${seen.ticks}`);

  // Posture + state → onTick, with the state object handed through.
  p.__regressActivityState = { marker: 'live' };
  await runActivityTick();
  check('activity tick: fires while the posture holds', seen.ticks === 1, `ticks=${seen.ticks}`);
  check('activity tick: passes the plugin its own state object', seen.sawState?.marker === 'live', seen.sawState);

  // Posture cleared out from under it → onAbandon, exactly once, and the state
  // is gone so a second sweep is silent. This is the leak the old per-plugin
  // copies each had to get right independently.
  p.posture = 'standing';
  await runActivityTick();
  check('activity tick: abandon fires when the posture is lost', seen.abandons === 1, `abandons=${seen.abandons}`);
  await runActivityTick();
  check('activity tick: abandon does not repeat', seen.abandons === 1, `abandons=${seen.abandons}`);
  check('activity tick: no stray ticks after abandon', seen.ticks === 1, `ticks=${seen.ticks}`);

  p.posture = priorPosture;

  // Two players on the SAME activity must never have their onTick overlap. The
  // per-zone loot tables read stock, compute a lazy replenish in JS, and write
  // absolute quantities back — two interleaved catch-ups would both apply the
  // same replenish and duplicate stock. Different activities SHOULD overlap
  // (that is what six independent timers used to do), so both are asserted.
  // Needs two live players, and regress drives a single fake one — so stand up a
  // second throwaway live session rather than skipping the check. A test that
  // quietly does not run is worse than no test.
  const { setLivePlayer, removeLivePlayer, getAllLivePlayers } = await import('../server/engine/world.js');
  const GHOST_ID = '__regress_activity_ghost';
  setLivePlayer(GHOST_ID, { id: GHOST_ID, handle: 'RegressGhost', posture: 'standing' });
  try {
    const live = getAllLivePlayers();
    let inFlightSame = 0, overlapSame = false, overlapCross = false;
    let inFlightA = false, inFlightB = false;
    const yieldTwice = () => new Promise(res => setTimeout(res, 0));
    registerActivity({
      posture: '__regress_serial', stateKey: '__regressSerialState',
      onTick: async () => {
        inFlightSame += 1; inFlightA = true;
        if (inFlightSame > 1) overlapSame = true;
        await yieldTwice();
        if (inFlightB) overlapCross = true;
        inFlightSame -= 1; inFlightA = false;
      },
    });
    registerActivity({
      posture: '__regress_parallel', stateKey: '__regressParallelState',
      onTick: async () => {
        inFlightB = true;
        await yieldTwice();
        if (inFlightA) overlapCross = true;
        inFlightB = false;
      },
    });
    const [p1, p2] = live;
    const saved = [p1.posture, p2.posture];
    p1.posture = '__regress_serial'; p1.__regressSerialState = {};
    p2.posture = '__regress_serial'; p2.__regressSerialState = {};
    await runActivityTick();
    check('activity tick: same activity never runs two players concurrently', !overlapSame);

    p2.posture = '__regress_parallel';
    delete p2.__regressSerialState; p2.__regressParallelState = {};
    await runActivityTick();
    check('activity tick: different activities still overlap', overlapCross);

    delete p1.__regressSerialState; delete p2.__regressParallelState;
    p1.posture = saved[0]; p2.posture = saved[1];
  } finally {
    removeLivePlayer(GHOST_ID);
  }
}

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

// Bulk sweeps by CATEGORY (`put all frozen in the case`). The vocabulary is not
// a list anybody maintains: a tag name, then a facet label off classify.js — the
// same words the shelf headings print — then a handful of aliases for the words
// English has and the data doesn't ("non-perishable"). Seed one throwaway
// container and four probe items covering each ladder, drive the real verbs.
{
  const savedZone = getPlayer().current_zone;
  const BZ = 'zone_bulk_regress', BFURN = 'furn_bulk_regress';
  const PROBES = [
    ['item_bulk_utensil', 'bulk whisk', { utensil: true }],                                     // by TAG
    ['item_bulk_frozen', 'bulk frozen brick', { consumable: true, storage_tier: 'frozen' }],    // by FACET
    ['item_bulk_tinned', 'bulk tinned probe', { consumable: true, food_profile: 'preserved' }], // by ALIAS
    ['item_bulk_rock', 'bulk rock', { misc: true }],                                            // by nothing
    ['item_bulk_chilled', 'bulk chilled probe',                                                 // wants a cold box
      { consumable: true, perishable: true, spoil_rate: 'fast' }],
  ];
  try {
    for (const [id, name, tags] of PROBES) {
      await query(
        `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,$2,'bulk probe','misc',0,10,$3)
         ON CONFLICT (id) DO UPDATE SET tags=$3, name=$2`, [id, name, JSON.stringify(tags)]);
    }
    await insertFurniture({
      id: BFURN, name: 'bulk crate', description: 'a bulk crate', object_type: 'container',
      zone_id: BZ, flags: JSON.stringify({ container: 400000, aliases: 'crate' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    getPlayer().current_zone = BZ;

    const give = async () => {
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2)', [getPlayer().id, PROBES.map(p => p[0])]);
      await query('DELETE FROM player_inventory WHERE container_id=$1', [BFURN]);
      for (const [id] of PROBES) {
        await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`,
          [randomUUID(), getPlayer().id, id]);
      }
    };
    const inCrate = async () => (await query('SELECT item_id FROM player_inventory WHERE container_id=$1', [BFURN])).rows.map(r => r.item_id);

    await give();
    await run('put all utensils in crate');
    check('bulk sweep by TAG name, pluralised ("all utensils")',
      (await inCrate()).join() === 'item_bulk_utensil', (await inCrate()).join());

    await give();
    await run('put all frozen in crate');
    check('bulk sweep by SHELF HEADING — the word the section prints ("all frozen")',
      (await inCrate()).join() === 'item_bulk_frozen', (await inCrate()).join());

    await give();
    await run('put all non-perishable in crate');
    const np = await inCrate();
    check('bulk sweep by alias, and "non-perishable" means FOOD that keeps — not the rock',
      np.includes('item_bulk_frozen') && np.includes('item_bulk_tinned') && !np.includes('item_bulk_rock'), np.join());

    // The cupboard word: everything the cold half doesn't want. Both directions of
    // this matter — the frozen brick and the chilled probe staying OUT is what
    // makes it safe to type at a cabinet and walk away.
    await give();
    await run('put all pantry in crate');
    const pan = await inCrate();
    check('"all pantry" sweeps shelf-stable food and the kitchen kit',
      pan.includes('item_bulk_tinned') && pan.includes('item_bulk_utensil'), pan.join());
    check('...and leaves anything that wants a cold box',
      !pan.includes('item_bulk_frozen') && !pan.includes('item_bulk_chilled'), pan.join());
    check('...and is still food-only, so the rock stays put',
      !pan.includes('item_bulk_rock'), pan.join());

    await give();
    await run('put all cupboard in crate');
    check('"cupboard" and "cabinet" say the same thing as "pantry"',
      (await inCrate()).sort().join() === pan.sort().join(), (await inCrate()).join());

    await give();
    await run('put all non-perishable in crate');
    // ...and back out again, by the same word. A category that only works in one
    // direction is half a feature.
    await run('pull all frozen from crate');
    check('the same vocabulary empties a container ("pull all frozen")',
      !(await inCrate()).includes('item_bulk_frozen'), (await inCrate()).join());

    const r2 = await run('put all wombats in crate');
    check('a category that matches nothing is refused, not silently ignored',
      r2?.type === 'error', JSON.stringify(r2)?.slice(0, 120));
  } finally {
    await query('DELETE FROM player_inventory WHERE container_id=$1', [BFURN]).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2)', [getPlayer().id, PROBES.map(p => p[0])]).catch(() => {});
    await deleteFurniture(BFURN).catch(() => {});
    await query('DELETE FROM items WHERE id = ANY($1)', [PROBES.map(p => p[0])]).catch(() => {});
    getPlayer().current_zone = savedZone;
  }
}

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

// Compartments (engine law in buildContainerView + describe's subBoxIds): one
// piece of furniture that stores things in more than one place. Each shelf is a
// whole container row, so what's under test is that they present as ONE piece —
// tabs in order, the parent first, one room entry — while every storage path
// keeps treating them as the ordinary containers they are.
{
  const savedZone = getPlayer().current_zone;
  const CZ = 'zone_compartment_regress';
  const CTOP = 'furn_compartment_regress', CMID = 'furn_compartment_regress_b', CBOT = 'furn_compartment_regress_c';
  try {
    for (const [id, name, flags] of [
      [CTOP, 'test cabinet', { container: 20000 }],
      // Deliberately out of index order in the room, and the LAST one authored
      // sorts FIRST of the children — so a passing order proves the sort ran.
      [CBOT, 'test bottom shelf', { container: 8000, compartment_of: CTOP, compartment_label: 'Bottom', compartment_index: 2 }],
      [CMID, 'test middle shelf', { container: 12000, compartment_of: CTOP, compartment_label: 'Middle', compartment_index: 1 }],
    ]) {
      await insertFurniture({
        id, name, description: name, object_type: 'container',
        zone_id: CZ, flags: JSON.stringify(flags),
      }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, name=EXCLUDED.name');
    }
    getPlayer().current_zone = CZ;

    const rc = await run(`opencontainer ${CTOP}`);
    const tabs = rc?.compartments || [];
    check('opening a compartmented piece returns its whole set', tabs.length === 3, JSON.stringify(tabs));
    check('the parent is always the first tab', tabs[0]?.id === CTOP, tabs[0]?.id);
    check('tabs follow compartment_index, not authoring order',
      tabs.map(t => t.id).join(',') === `${CTOP},${CMID},${CBOT}`, tabs.map(t => t.id).join(','));
    check('the shelf you opened is the active one',
      tabs.filter(t => t.active).length === 1 && tabs[0].active, JSON.stringify(tabs.map(t => t.active)));
    check('a compartment_label names the tab', tabs[1]?.label === 'Middle', tabs[1]?.label);
    check('a shelf with no label falls back to its own name', tabs[0]?.label === 'Test Cabinet', tabs[0]?.label);

    // Switching is an ordinary open of the shelf: same set, different active.
    const rm = await run(`opencontainer ${CMID}`);
    check('opening a shelf directly still reports the whole piece', (rm?.compartments || []).length === 3, JSON.stringify(rm?.compartments));
    check('switching moves the active marker', rm?.compartments?.[1]?.active === true && rm.compartments[0].active === false,
      JSON.stringify(rm?.compartments?.map(t => t.active)));
    check('each shelf keeps its OWN capacity', rm?.capacity === 12000, rm?.capacity);

    // An ordinary container is untouched — no key, so the panel is unchanged.
    const solo = await run(`opencontainer ${CBOT}`);
    check('a shelf can be opened on its own', solo?.type === 'container_view', solo?.type);

    // The room names the PIECE once. Opening it reaches every shelf, so listing
    // each shelf as its own furniture would be the same cabinet three times.
    const pieces = [
      { id: CTOP, name: 'test cabinet', flags: { container: 20000 } },
      { id: CMID, name: 'test middle shelf', flags: { compartment_of: CTOP } },
      { id: CBOT, name: 'test bottom shelf', flags: { compartment_of: CTOP } },
    ];
    const hidden = describeTest.subBoxIds(pieces);
    check('the room lists the cabinet, not its shelves',
      !hidden.has(CTOP) && hidden.has(CMID) && hidden.has(CBOT), [...hidden].join(','));
    // A shelf whose parent isn't in the room stays listed — a dangling id must
    // never make a container nobody can then reach.
    const orphanHidden = describeTest.subBoxIds([{ id: CMID, name: 'orphan shelf', flags: { compartment_of: 'furn_not_here' } }]);
    check('an orphaned shelf is still listed', orphanHidden.size === 0, [...orphanHidden].join(','));

    getPlayer().current_zone = savedZone;
  } finally {
    for (const id of [CBOT, CMID, CTOP]) await deleteFurniture(id).catch(() => {});
    getPlayer().current_zone = savedZone;
  }
}

const gateOwners = getRegisteredMoveGates();
check('engine law gates registered', gateOwners.includes('engine:door-lock') && gateOwners.includes('engine:encumbrance'), gateOwners.join(','));
// Impassable terrain is a LAW, not a filter on the exit graph — the tiles stay adjacent
// and the refusal happens at the move. If this gate ever stops being registered, a cliff
// silently becomes scenery you can stroll through and every funnel in the world opens.
check('impassable-terrain gate registered', gateOwners.includes('engine:impassable-terrain'), gateOwners.join(','));

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
// A gate's message is prose and renders as HTML unless it opts out. This was
// opt-in and nine of the ten gates that write markup never set it, so the
// shoplifting door prompt showed the player a literal `<b>`. Asserted on the
// plainest gate in the game precisely because it carries no markup of its own:
// the flag has to ride EVERY block, not just the ones an author remembered.
check('a blocked move renders as HTML', r?.html === true, `html=${r?.html}`);

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

  // ── Hunger and thirst as prose ─────────────────────────────────────────────
  // The bars come off the HUD by default, so these lines ARE the interface now. What they
  // replaced was one band each ("You are very hungry.") fired every single minute — which is
  // the cry-wolf failure, and left the whole 20-point runway to starvation undifferentiated.
  {
    const { appetiteMessages, satiationLine, _test: A } = await import('../server/engine/appetite.js');
    const say = (p, gm = 1) => appetiteMessages(p, gm);

    // A healthy body is SILENT. Nagging a player who is fine is how you teach them to skim.
    const well = { hunger: 100, thirst: 100 };
    check('a fed, watered body says nothing', say(well).length === 0, JSON.stringify(say(well)));

    // Crossing into a band is an event and speaks at once, rather than waiting out a cadence.
    const falling = { hunger: 100, thirst: 100 };
    say(falling);
    falling.hunger = 38;
    check('falling into a band speaks immediately', say(falling).length === 1, JSON.stringify(say(falling)));

    // Sitting in a band repeats on ITS OWN cadence — that is the severity signal.
    const sitting = { hunger: 38, thirst: 100 };
    say(sitting);
    let quiet = 0;
    for (let i = 0; i < 21; i++) if (!say(sitting).length) quiet++;
    check('sitting in a mild band is mostly quiet', quiet >= 20, `${quiet}/21 silent minutes`);
    check('…but it does come back round', say(sitting).length === 1, 'repeats on cadence');
    // …and a worse band repeats faster. Cadence has to be monotonic or the rhythm lies.
    check('worse bands repeat faster than milder ones',
      A.HUNGER_BANDS.every((b, i) => i === 0 || b.every > A.HUNGER_BANDS[i - 1].every),
      A.HUNGER_BANDS.map(b => b.every).join(' < '));
    check('thirst warns harder than hunger throughout (it kills twice as fast)',
      A.THIRST_BANDS.every((b, i) => b.every < A.HUNGER_BANDS[i].every),
      A.THIRST_BANDS.map(b => b.every).join(','));

    // Bands must narrow toward zero: that is where the damage is, so that is where the
    // resolution belongs. Equal-width bands were the original sin.
    const widths = A.HUNGER_BANDS.map((b, i) => b.at - (A.HUNGER_BANDS[i - 1]?.at ?? 0));
    check('bands narrow toward starvation', widths.every((w, i) => i === 0 || w >= widths[i - 1]), widths.join(','));

    // AT ZERO the damage line already fires every minute and says all of this. Two systems
    // narrating one moment is exactly how the old version reached four lines a minute.
    const dead = { hunger: 0, thirst: 0 };
    say(dead);
    check('at zero the flavour stands aside for the damage line', say(dead).length === 0, JSON.stringify(say(dead)));

    // Recovery is quiet, EXCEPT climbing out of real trouble — and that must survive jumping
    // straight past every band, which is the normal case for a player who just ate.
    const rescued = { hunger: 8, thirst: 100 };
    say(rescued);
    rescued.hunger = 100;
    check('eating your way out of starvation is acknowledged', say(rescued)[0] === A.HUNGER_RELIEF, JSON.stringify(say(rescued)));
    const mild = { hunger: 50, thirst: 100 };
    say(mild);
    mild.hunger = 100;
    check('…but merely topping up from peckish is silent', say(mild).length === 0, JSON.stringify(say(mild)));

    // "Fine" has to sort ABOVE every band. Returning -1 made entering the mildest band look
    // like a recovery, so the first thing a hungry player was told was that it had let up.
    check('"fine" sorts above every band, not below',
      A.bandFor(A.HUNGER_BANDS, 100) > A.bandFor(A.HUNGER_BANDS, 3), 'fine is best');

    // A whole starvation run should be a handful of lines, not a wall of them.
    const run = { hunger: 100, thirst: 100 };
    let lines = 0;
    for (let m = 1; m <= 420; m++) {
      if (m % 4 === 0) run.hunger = Math.max(0, run.hunger - 1);
      if (m % 3 === 0) run.thirst = Math.max(0, run.thirst - 1);
      lines += say(run).length;
    }
    check('seven game-hours of starving is a few dozen lines, not hundreds',
      lines > 10 && lines < 60, `${lines} lines`);

    // SATIATION — the half that never existed. A bar tells you how empty you are; nothing in
    // the game could tell you how full, so portion sizes were unlearnable.
    // Assert the BAND a state maps to, not a keyword inside one phrasing. Each
    // band carries several lines now, and a /full/i test goes quietly flaky the
    // day someone adds a variant that happens not to contain the magic word.
    const inBand = (line, band) => A.SATIATION[band].includes(line);
    check('a big meal on an empty stomach reads as full',
      inBand(satiationLine({ hunger: 95, digestive_load: 80 }), 'full'), satiationLine({ hunger: 95, digestive_load: 80 }));
    check('a stuffed body is told to stop',
      inBand(satiationLine({ hunger: 100, digestive_load: 100 }), 'stuffed'), satiationLine({ hunger: 100, digestive_load: 100 }));
    check('a crumb on an empty stomach reads as barely anything',
      inBand(satiationLine({ hunger: 10, digestive_load: 5 }), 'trivial'), satiationLine({ hunger: 10, digestive_load: 5 }));
    // Hunger has no bar, so a number here would be a receipt against a scale the
    // player cannot see. Sampled, because the lines are chosen at random.
    check('eating never quotes a number at you',
      !/[0-9]/.test(Array.from({ length: 40 }, () => satiationLine({ hunger: 50, digestive_load: 20 })).join('')), 'no digits');
    check('satiation always says something', typeof satiationLine({}) === 'string', 'never null');
  }


  // ── Dissociative episodes ─────────────────────────────────────────────────
  // The wake paths ARE the risk: a missed one strands a player in a zone that is deleted out
  // from under them, and the symptom is a character who cannot move and cannot be found. Every
  // path funnels through endDissociation, so these assert the funnel rather than the callers.
  {
    const { beginDissociation, endDissociation, isDissociating, isDreamZone, DREAM_ZONE_PREFIX } =
      await import('../server/engine/dreamscape.js');

    const victim = getPlayer();
    const home = victim.current_zone;

    const began = await beginDissociation(victim, { broadcast: null, size: 2 });
    check('a dissociative episode builds and takes the mind elsewhere',
      began && isDissociating(victim) && victim.current_zone !== home,
      `began=${began} zone=${victim.current_zone}`);
    check('…into a real dreamscape zone', isDreamZone(victim.current_zone), victim.current_zone);

    // THE BODY STAYS PUT. This is the load-bearing half of the mind/body split: the player is
    // never removed from the real room, so they stand there vacant — lootable and killable,
    // exactly as a sleeper is. Removing them would make a dissociating player invulnerable.
    check('the body stays in the real room, vacant and vulnerable',
      !!world.zones.get(home)?.players?.has(victim.id), `zone.players in ${home}`);

    // persistableZone must find the real room if the socket drops mid-episode, or a relog
    // writes a dreamscape id into players.current_zone and strands them for good.
    const { persistableZone } = await import('../server/engine/world.js');
    check('a disconnect mid-episode persists the BODY zone, never the dreamscape',
      persistableZone(victim) === home, persistableZone(victim));

    // An episode cannot nest, or the second build orphans the first one's rooms.
    check('a second episode cannot start on top of the first',
      (await beginDissociation(victim, { broadcast: null })) === false, 'refused');

    const ended = endDissociation(victim, { broadcast: null, reason: 'silent' });
    check('ending returns the mind to the body', ended && victim.current_zone === home, victim.current_zone);
    check('…and clears the flag', !isDissociating(victim), 'clear');
    check('…and clears _bodyZone so nothing else reads a stale one', victim._bodyZone === undefined, String(victim._bodyZone));

    // The zones must actually be gone. A leak here is invisible until the process is full of
    // rooms nobody can reach.
    const leaked = [...world.zones.keys()].filter(z => z.startsWith(`${DREAM_ZONE_PREFIX}${victim.id}_`));
    check('the dreamscape is torn down, not leaked', leaked.length === 0, `${leaked.length} orphaned rooms`);

    // Idempotent, which is what lets death and logout call it unconditionally.
    check('ending an episode that is not running is a safe no-op',
      endDissociation(victim, { broadcast: null }) === false, 'no-op');
    check('a sleeping player never dissociates (they are already elsewhere)',
      (await (async () => { victim.sleeping = { inDream: false }; const r = await beginDissociation(victim, { broadcast: null }); victim.sleeping = null; return r; })()) === false,
      'refused while asleep');

    // The command gate is the other half of the hazard: a dream room is deleted seconds later,
    // so `drop` inside one orphans the item in the DB forever. The allowlist must cover a
    // dissociating player exactly as it covers a dreaming one.
    const { DREAM_VERBS } = await import('../server/engine/commands/index.js');
    check('walking and looking are allowed inside an episode',
      ['north', 'look', 'examine', 'say'].every(v => DREAM_VERBS.has(v)), 'allowed');
    check('anything that writes the world is not',
      !['drop', 'get', 'give', 'buy', 'attack'].some(v => DREAM_VERBS.has(v)), 'blocked');

    // ── A DREAM ACTION MUST NOT WAKE YOU ────────────────────────────────────
    // Membership in DREAM_VERBS is only half the promise. The dream branch in the
    // dispatcher FALLS THROUGH to the ordinary command pipeline, and the ordinary
    // pipeline's rule is "any command wakes a sleeper" — so the protection is the
    // `else if` that skips that branch, plus movement.js exempting a dreamer from
    // forceStand. Both are one edit away from being lost, and nothing tested that
    // the dream survived actually RUNNING a verb. This does.
    {
      const { buildDreamscape, wakeFromDream } = await import('../server/engine/dreamscape.js');
      const pacing = await import('../plugins/pacing/index.js');
      const p = getPlayer();
      const bodyZone = p.current_zone;
      const savedSleeping = p.sleeping, savedPosture = p.posture;

      const entry = await buildDreamscape(p.id, { size: 3, cause: 'dream', broadcast: null, player: p });
      if (!entry) {
        // No authored dream templates in this database — say so rather than
        // reporting a pass nothing exercised.
        check('SKIPPED: no dream templates authored, cannot test dream verbs', true, 'skipped');
      } else {
        p.sleeping = { inDream: true, bodyZone, minutesSlept: 5, light: false, restore: { hp: 0, sanity: 0, stamina: 0 } };
        p.posture = 'lying';                 // what cmdSleep actually leaves a sleeper as
        p.current_zone = entry;
        addPlayerToZone(p.id, entry);
        try {
          // Every allowlisted verb, run for real through the dispatcher. `wake` is
          // excluded on purpose — it is the ONE that is supposed to end this.
          for (const verb of ['look', 'examine', 'north', 'south', 'east', 'west', 'up', 'down', 'say hello', 'talk']) {
            await run(verb);
            check(`\`${verb}\` inside a dream does not wake you`,
              p.sleeping?.inDream === true, `sleeping=${JSON.stringify(p.sleeping)}`);
          }

          // A refused verb must not wake you either — the refusal is a flavour line,
          // not an ejection. This is the case a naive "unknown input wakes the
          // sleeper" fix would break.
          await run('drop everything');
          check('a verb REFUSED inside a dream still does not wake you',
            p.sleeping?.inDream === true, `sleeping=${JSON.stringify(p.sleeping)}`);

          // Moving in a dream must not stand the body up, or the sleeper is on their
          // feet in the real room while their mind is elsewhere.
          check('walking a dream leaves the body lying down',
            p.posture !== 'standing', String(p.posture));

          // THE STEPS YOU TOOK IN A DREAM MUST NOT COME TRUE. Walking faster than
          // the cadence QUEUES the extra steps on a timer; waking before that timer
          // fires used to drain them into the waking room, so a dream walk moved the
          // real body. The queue belongs to the room it was opened in.
          //
          // Forced rather than hoped for: stamping the cadence clock to NOW
          // guarantees the next step is too fast and therefore queued. Letting the
          // natural timing decide made the assertion count wobble between runs,
          // which is how a suite starts being ignored.
          // A dream room gets one or two RANDOM exits, so a hardcoded direction is
          // a coin flip: `north` usually doesn't exist, cmdMove errors before the
          // cadence gate is ever consulted, and nothing queues. Ask the room.
          pacing._test.cancelQueue(p);
          const exitDir = Object.keys(getZone(p.current_zone)?.exits || {})[0];
          check('a dream room has somewhere to walk to', !!exitDir, JSON.stringify(getZone(p.current_zone)?.exits));
          p._lastStepAt = Date.now();
          await run(exitDir);
          check('a too-fast step inside a dream is queued, not run',
            (p._moveQueue?.length || 0) === 1, `dir=${exitDir} queued=${p._moveQueue?.length || 0}`);

          await run('wake');
          check('`wake` is the way out, and it works', !p.sleeping, JSON.stringify(p.sleeping));

          const { drainOne } = pacing._test;
          await drainOne(p);
          check('steps queued in a dream do not walk the waking body',
            p.current_zone === bodyZone && (p._moveQueue?.length || 0) === 0,
            `zone=${p.current_zone} queued=${p._moveQueue?.length || 0}`);
        } finally {
          pacing._test.cancelQueue(p);
          wakeFromDream(p);
          p.sleeping = savedSleeping;
          p.posture = savedPosture;
          p.current_zone = bodyZone;
          addPlayerToZone(p.id, bodyZone);
        }
      }
    }

    // ── Exhaustion: a dream you have finished should end ────────────────────
    // A used-up dreamscape is dead time. Walking every room and examining every
    // object dissolves it — over two beats, so it reads as an ending rather than
    // the ejection the sleep rework deliberately moved away from.
    {
      const { buildDreamscape, wakeFromDream, markRoomSeen, markObjectSeen, isExhausted, _liveInstanceCount } =
        await import('../server/engine/dreamscape.js');
      const p = getPlayer();
      const bodyZone = p.current_zone;
      const savedSleeping = p.sleeping;

      const entry = await buildDreamscape(p.id, { size: 3, cause: 'dream', broadcast: null, player: p });
      if (!entry) {
        check('SKIPPED: no dream templates authored, cannot test exhaustion', true, 'skipped');
      } else {
        try {
          const inst = markRoomSeen(entry);
          check('a fresh dream is not exhausted', isExhausted(inst) === false, 'fresh');

          // Walk every room, examine every object — the long way, through the
          // same helpers the real verbs call.
          for (const id of inst.roomIds) {
            markRoomSeen(id);
            for (const o of (world.zones.get(id)?.dreamObjects || [])) markObjectSeen(id, o.name);
          }
          check('seeing every room and every object exhausts the dream',
            isExhausted(inst) === true, `rooms=${inst.roomIds.length}`);

          // Leaving ONE object unseen must hold it open — otherwise "exhausted"
          // is really just "walked around a bit".
          const withObjects = inst.roomIds.find(id => (world.zones.get(id)?.dreamObjects || []).length);
          if (withObjects) {
            const obj = world.zones.get(withObjects).dreamObjects[0];
            inst.seenObjects.delete(`${withObjects}::${obj.name.toLowerCase()}`);
            check('one unexamined object is enough to hold the dream open',
              isExhausted(inst) === false, `held by ${obj.name}`);
            markObjectSeen(withObjects, obj.name);
          }

          // A DRUG TRIP MUST NOT END THIS WAY. The dose is what the player paid
          // for; its length cannot depend on how thorough they were.
          const { noteDreamProgress } = await import('../server/engine/dreamscape.js');
          inst.cause = 'trip';
          p.sleeping = { inDream: true, bodyZone };
          check('an exhausted drug trip does NOT dissolve — the drug owns its clock',
            noteDreamProgress(p, inst, null) === false, 'trip held');
          inst.cause = 'dream';

          // …and a sleep dream does. Idempotent: poking at things after finishing
          // must not stack a second dissolve chain.
          check('an exhausted sleep dream begins to dissolve',
            noteDreamProgress(p, inst, null) === true, 'dissolving');
          check('…once, no matter how much more you poke at',
            noteDreamProgress(p, inst, null) === false, 'already dissolving');

          // The pending beat MUST die with the instance, or it fires against a
          // torn-down dream and wakes someone standing somewhere else.
          check('the dissolve arms a timer', !!inst.dissolveTimer, 'armed');
          wakeFromDream(p);
          check('waking by hand mid-dissolve clears the pending beat',
            !inst.dissolveTimer || _liveInstanceCount() === 0, `live=${_liveInstanceCount()}`);
        } finally {
          wakeFromDream(p);
          p.sleeping = savedSleeping;
          p.current_zone = bodyZone;
          addPlayerToZone(p.id, bodyZone);
        }
      }
    }
  }
  // ── Body temperature: the sleeping body is still a body ────────────────────
  // Sleep used to be a total, free immunity to temperature — resourceTick skipped a sleeper
  // before it reached the drift, so the canonical way to die of cold (fall asleep in it) was
  // the one guaranteed way not to, and any blizzard was survivable by lying down. The drift
  // is now a shared function both paths call, so the two can never diverge again.
  {
    const { driftBodyTemperature } = await import('../server/engine/gameLoop.js');
    const { bodyZoneOf } = await import('../server/engine/world.js');
    const { getZoneApparentTemperature } = await import('../server/engine/environment.js');

    // A scratch room, plus a dreamscape stand-in for the dreamer case below.
    const roomId = 'zone_regress_temp_' + process.pid;
    registerTransientZone({ id: roomId, name: 'Regress Thermal Room', description: 'A room.', exits: {}, flags: { is_interior: true } });
    const dreamId = 'zone_regress_dream_' + process.pid;
    registerTransientZone({ id: dreamId, name: 'Regress Dream', description: 'Not a place.', exits: {}, flags: { is_interior: true } });

    // MEASURE the room rather than assuming it: an interior's temperature is driven by the
    // live HVAC/outdoor sim, so the tests below aim the player's own terms (insulation and
    // exposure, both plain °C offsets) at a known warmthTemp instead of hardcoding an ambient.
    const amb = getZoneApparentTemperature(roomId, 0);
    // Deep cold: warmthTemp = −40, a 50° deficit ⇒ ~1.88 °C/min, far above the 0.1° rounding
    // the drift quantises to, so proportionality is actually measurable here.
    const deepCold = amb + 40;
    const body = (over = {}) => ({ current_zone: roomId, body_temp_c: 37.0, insulation: 0, exposurePenalty: deepCold, wetness: 0, ...over });
    // One rounding step of slack — driftBodyTemperature rounds the core to 0.1 every call.
    const near = (a, b) => Math.abs(a - b) <= 0.11;

    const chilled = body();
    driftBodyTemperature(chilled, 1);
    check('deep cold cools the core', chilled.body_temp_c < 37.0, String(chilled.body_temp_c));

    // Insulation and bare skin are the two player-controlled terms, in opposite directions.
    const coated = body({ insulation: 12 });
    driftBodyTemperature(coated, 1);
    check('insulation slows the cooling', coated.body_temp_c > chilled.body_temp_c, `${coated.body_temp_c} > ${chilled.body_temp_c}`);
    const barer = body({ exposurePenalty: deepCold + 15 });
    driftBodyTemperature(barer, 1);
    check('bare skin speeds the cooling', barer.body_temp_c < chilled.body_temp_c, `${barer.body_temp_c} < ${chilled.body_temp_c}`);

    // Wetness is a MULTIPLIER on the cold side — the term the bare-skin wetness bug was
    // silently zeroing out for an unclothed player standing in the rain.
    const soaked = body({ wetness: 100 });
    driftBodyTemperature(soaked, 1);
    const dLoss = 37.0 - chilled.body_temp_c, wLoss = 37.0 - soaked.body_temp_c;
    check('being soaked roughly doubles the cooling rate', near(wLoss, dLoss * 2), `${wLoss.toFixed(2)} vs ${(dLoss * 2).toFixed(2)}`);

    // Time scale: the drift is per GAME-minute, so a faster clock cools proportionally faster.
    const fast = body(); driftBodyTemperature(fast, 3);
    check('drift scales with game-minutes elapsed', near(37.0 - fast.body_temp_c, dLoss * 3), `${(37.0 - fast.body_temp_c).toFixed(2)} vs ${(dLoss * 3).toFixed(2)}`);

    // The comfort band is the cure, and the only one. Aim insulation so warmthTemp lands at
    // 20°C — inside 10..35 from both sides, whatever the room actually is today.
    const comfy = (over = {}) => ({ current_zone: roomId, body_temp_c: 37.0, insulation: 20 - amb, exposurePenalty: 0, wetness: 0, ...over });
    const recovering = comfy({ body_temp_c: 34.0 });
    driftBodyTemperature(recovering, 1);
    check('the comfort band warms you back toward 37', recovering.body_temp_c > 34.0, String(recovering.body_temp_c));
    const settled = comfy();
    driftBodyTemperature(settled, 60);
    check('thermoregulation settles at 37 and does not overshoot', settled.body_temp_c === 37.0, String(settled.body_temp_c));

    // THE DREAMER. The mind is in a dreamscape with no sky; the body is lying in the cold.
    // Reading current_zone here would have made every dream a warm one.
    const dreamer = { current_zone: dreamId, sleeping: { bodyZone: roomId }, body_temp_c: 37.0, insulation: 0, exposurePenalty: deepCold, wetness: 0 };
    check('bodyZoneOf prefers the sleeping body over the dreaming mind', bodyZoneOf(dreamer) === roomId, bodyZoneOf(dreamer));
    driftBodyTemperature(dreamer, 1);
    check('a dreamer freezes in the room their BODY is in, not the dream', dreamer.body_temp_c < 37.0, String(dreamer.body_temp_c));

    // Clamped, so no single extreme tick can produce a nonsense core reading.
    const extreme = body();
    driftBodyTemperature(extreme, 100000);
    check('core temperature is clamped to the survivable floor', extreme.body_temp_c === 25, String(extreme.body_temp_c));

    // ── The storm sweep's candidate set ─────────────────────────────────────
    // stormTick used to walk all ~5,800 zones every 5s to find the few anyone is
    // standing in; it now derives them from the players. The trap is the same one
    // the drift above exists for: key that derivation on `current_zone` and a room
    // whose only occupants are ASLEEP drops out of the weather entirely, because a
    // dreamer's current_zone is a dreamscape. Their body is still lying in the storm.
    {
      const { occupiedBodyZones } = await import('../server/engine/gameLoop.js');
      const { world } = await import('../server/engine/world.js');
      const wakerId = 'regress_storm_awake_' + process.pid;
      const sleeperId = 'regress_storm_asleep_' + process.pid;
      world.players.set(wakerId,  { id: wakerId,  current_zone: roomId });
      world.players.set(sleeperId, { id: sleeperId, current_zone: dreamId, sleeping: { bodyZone: roomId } });
      try {
        const occ = occupiedBodyZones();
        check('the storm sweep sees a room someone is awake in', occ.has(roomId));
        check('the storm sweep does NOT chase a dreamer into their dreamscape', !occ.has(dreamId));
        world.players.delete(wakerId);
        const asleepOnly = occupiedBodyZones();
        check('a room whose only occupant is asleep still gets weather', asleepOnly.has(roomId));
      } finally {
        world.players.delete(wakerId);
        world.players.delete(sleeperId);
      }
    }

    // ── Metabolic heat: a body is a furnace, not a rock ──────────────────────
    // The term the model was missing. Keeping moving in the cold is the most iconic fact
    // about cold survival there is, and none of it was represented.
    // Compared over FIVE minutes, not one: the drift rounds the core to 0.1°C every call, and
    // on the (deliberately flatter) 1.25 curve a few degrees of metabolic warmth is worth less
    // than one rounding step in a single minute. Five is still a short exposure and puts the
    // difference well clear of the quantisation.
    const still = body({ _lastMoveAt: 0, stamina: 0 });
    driftBodyTemperature(still, 5);
    const walking = body({ _lastMoveAt: Date.now(), stamina: 0 });
    driftBodyTemperature(walking, 5);
    const running = body({ _lastMoveAt: Date.now(), running: true, stamina: 0 });
    driftBodyTemperature(running, 5);
    check('moving keeps you warmer than standing still', walking.body_temp_c > still.body_temp_c, `${walking.body_temp_c} > ${still.body_temp_c}`);
    check('running keeps you warmer than walking', running.body_temp_c > walking.body_temp_c, `${running.body_temp_c} > ${walking.body_temp_c}`);

    // Shivering: costs stamina, and is the difference between holding the line and not.
    const shivering = body({ _lastMoveAt: 0, stamina: 100 });
    driftBodyTemperature(shivering, 5);
    check('a body with stamina shivers', shivering._shivering === true, String(shivering._shivering));
    check('shivering slows the cooling', shivering.body_temp_c > still.body_temp_c, `${shivering.body_temp_c} > ${still.body_temp_c}`);
    check('shivering costs stamina', shivering.stamina < 100, String(shivering.stamina));
    check('an exhausted body cannot shiver', still._shivering === false, String(still._shivering));

    // The cliff. Real shivering ceases around 32°C, and its absence is a classic marker that
    // mild hypothermia has become moderate — so the cooling rate STEPS UP exactly when the
    // body can least afford it. This is the mechanic that makes cold a slope with a cliff in it.
    const tooFarGone = body({ _lastMoveAt: 0, stamina: 100, body_temp_c: 31.5 });
    driftBodyTemperature(tooFarGone, 1);
    check('below 32C the body stops shivering however much stamina is left', tooFarGone._shivering === false, String(tooFarGone._shivering));
    check('and it does not spend stamina it cannot use', tooFarGone.stamina === 100, String(tooFarGone.stamina));

    check('a body in the heat does not shiver',
      (() => { const h = comfy({ insulation: 45 - amb, thirst: 0, _lastMoveAt: 0, stamina: 100 }); driftBodyTemperature(h, 1); return h._shivering === false; })(), 'no shivering in a heatwave');

    // ── Sweat: the heat side's mirror ───────────────────────────────────────
    // The cold half had shivering; the heat half had nothing, and the flavour pool has been
    // promising "You're not sweating anymore. That's very bad." to a model that couldn't
    // deliver it. Aim insulation so heatTemp lands at 45 — a genuine heatwave — whatever the
    // room is today.
    const baking = (over = {}) => ({ current_zone: roomId, body_temp_c: 37.0, insulation: 45 - amb, insulationWet: 45 - amb, exposurePenalty: 0, wetness: 0, thirst: 100, stamina: 100, _lastMoveAt: 0, ...over });

    // Ten minutes, for the same reason the cold comparisons take five: the drift rounds the
    // core to 0.1C a call, and sweat's edge is smaller than that over a single minute.
    const parched = baking({ thirst: 0 });
    driftBodyTemperature(parched, 10);
    const sweating = baking();
    driftBodyTemperature(sweating, 10);
    check('a hydrated body sweats in a heatwave', sweating._sweating === true, String(sweating._sweating));
    check('sweating slows the heating', sweating.body_temp_c < parched.body_temp_c, `${sweating.body_temp_c} < ${parched.body_temp_c}`);
    check('sweating spends WATER, not stamina',
      sweating.thirst < 100 && sweating.stamina === 100, `thirst ${sweating.thirst}, stamina ${sweating.stamina}`);
    check('a body with no water left cannot sweat', parched._sweating === false, String(parched._sweating));
    check('...and sweat is the ONLY thing draining thirst in the heat now (no double-count)',
      sweating.thirst === 100 - 2 * 10, String(sweating.thirst));

    // ANHIDROSIS — the exact mirror of shivering ceasing at 32°C, and the same cliff.
    const gone = baking({ body_temp_c: 41.6 });
    driftBodyTemperature(gone, 1);
    check('above 41C the body stops sweating however much water is left', gone._sweating === false, String(gone._sweating));
    check('and it does not spend water it cannot use', gone.thirst === 100, String(gone.thirst));

    // Dehydration THROTTLES sweat before it stops it — being thirsty is a slow disadvantage,
    // not just a bar that runs out.
    const dry = baking({ thirst: 10 });
    driftBodyTemperature(dry, 10);
    check('dehydration throttles sweating before it stops it',
      dry._sweating === true && dry.body_temp_c > sweating.body_temp_c, `${dry.body_temp_c} > ${sweating.body_temp_c}`);

    // Sweat feeds the hygiene meter — a long hot day should smell like one.
    check('sweating feeds the hygiene substrate', (sweating._sweat || 0) > 0, String(sweating._sweat));

    // A sealed shell is boil-in-the-bag: the same tag that saves you in a gale traps the sweat.
    const bagged = baking({ windproof: 1 });
    driftBodyTemperature(bagged, 10);
    check('a windproof shell makes a heatwave worse (trapped sweat)',
      bagged.body_temp_c > sweating.body_temp_c, `${bagged.body_temp_c} > ${sweating.body_temp_c}`);

    // EXERTION CUTS BOTH WAYS. A working body makes the same watts whichever way the weather
    // is trying to kill it, which is what makes the optimal play opposite at the two extremes.
    const restingHot = baking({ thirst: 0 });
    driftBodyTemperature(restingHot, 10);
    const runningHot = baking({ thirst: 0, _lastMoveAt: Date.now(), running: true });
    driftBodyTemperature(runningHot, 10);
    check('running makes a heatwave WORSE (it helped in the cold)',
      runningHot.body_temp_c > restingHot.body_temp_c, `${runningHot.body_temp_c} > ${restingHot.body_temp_c}`);

    // ── Wet insulation: "cotton kills" ──────────────────────────────────────
    // Wetness used to be a flat multiplier on the drift RATE and never touched insulation, so
    // a soaked arctic parka insulated exactly as well as a dry one. It was the single largest
    // inaccuracy left in the model.
    const coat = (over) => body({ insulation: 10, insulationWet: 0, ...over });
    const dryCoat = coat({ wetness: 0 });   driftBodyTemperature(dryCoat, 1);
    const wetCoat = coat({ wetness: 100 }); driftBodyTemperature(wetCoat, 1);
    check('a soaked coat no longer insulates like a dry one', wetCoat.body_temp_c < dryCoat.body_temp_c, `${wetCoat.body_temp_c} < ${dryCoat.body_temp_c}`);
    // …but wool and neoprene do. This is load-bearing for swimming: submersion pins wetness to
    // 100, so a wetsuit that lost its value wet would be no wetsuit at all.
    const wool = body({ insulation: 10, insulationWet: 10, wetness: 100 });
    driftBodyTemperature(wool, 1);
    check('a hydrophobic garment keeps its INSULATION soaked - but wet skin still conducts, so it never matches dry',
      wool.body_temp_c > wetCoat.body_temp_c && wool.body_temp_c < dryCoat.body_temp_c,
      `wet wool ${wool.body_temp_c}, wet cotton ${wetCoat.body_temp_c}, dry ${dryCoat.body_temp_c}`);
    check('…which is what stops a soaked wetsuit becoming useless', wool.body_temp_c > wetCoat.body_temp_c, `${wool.body_temp_c} > ${wetCoat.body_temp_c}`);
    // A soaked coat is still marginally better than nothing — it's a windbreak even when it
    // has stopped being a blanket.
    const bare = body({ insulation: 0, insulationWet: 0, wetness: 100 });
    driftBodyTemperature(bare, 1);
    check('a soaked coat still beats no coat at all', wetCoat.body_temp_c > bare.body_temp_c, `${wetCoat.body_temp_c} > ${bare.body_temp_c}`);

    // ── Warmth is a gradient, not a door ────────────────────────────────────
    // Recovery used to be a flat 0.05/min with warmthTemp nowhere in it, so a 20C room, a 35C
    // sauna and a freezing corridor-with-a-good-coat all rewarmed you at identical speed.
    // Being WARMER than merely comfortable did nothing — which is why the game had no fires,
    // heaters, blankets or hot drinks: there was no mechanic that would have rewarded one.
    const chilledBody = (ins) => ({ current_zone: roomId, body_temp_c: 32.0, insulation: ins, insulationWet: ins, exposurePenalty: 0, wetness: 0, thirst: 100, stamina: 100, _lastMoveAt: 0 });
    const barely = chilledBody(10 - amb);        // warmthTemp ~10: just inside the band
    driftBodyTemperature(barely, 10);
    const cosy = chilledBody(22 - amb);          // warmthTemp ~22: dressed, indoors
    driftBodyTemperature(cosy, 10);
    const toasty = chilledBody(28 - amb);        // warmthTemp ~28: heater plus winter gear
    driftBodyTemperature(toasty, 10);
    check('being warmer rewarms you faster', cosy.body_temp_c > barely.body_temp_c, `${cosy.body_temp_c} > ${barely.body_temp_c}`);
    check('and warmer still, faster still', toasty.body_temp_c > cosy.body_temp_c, `${toasty.body_temp_c} > ${cosy.body_temp_c}`);
    // The floor is the OLD constant, so being barely-in-the-band is exactly as slow as it was.
    const oldRate = 32 + (37 - 32) * (1 - Math.pow(0.95, 10));
    check('barely-in-the-band is unchanged from the old flat rate',
      Math.abs(barely.body_temp_c - oldRate) < 0.11, `${barely.body_temp_c} vs ${oldRate.toFixed(2)}`);
    // …and it is CAPPED, so a heat source is a strong advantage and never an instant reset.
    // Both of these sit at or past the cap; they must land on the same number. Note the
    // insulation stays at 34 in both so `heatTemp` never crosses 35 — the gradient is only
    // reachable in the comfort band, and a test that overshot it would be measuring the
    // heating branch instead.
    const { applyWarmth } = await import('../server/engine/warmth.js');
    const atCap = chilledBody(34 - amb);
    driftBodyTemperature(atCap, 10);
    const pastCap = chilledBody(34 - amb);
    applyWarmth(pastCap, 5, 60);                 // a hot drink on top of an already-capped body
    driftBodyTemperature(pastCap, 10);
    check('rewarming is capped — no heat source is an instant reset',
      pastCap.body_temp_c === atCap.body_temp_c && pastCap.body_temp_c < 37,
      `capped at ${pastCap.body_temp_c}`);
    check('the cap still beats a merely warm room', atCap.body_temp_c > toasty.body_temp_c, `${atCap.body_temp_c} > ${toasty.body_temp_c}`);

    // A hot drink or a hand warmer rides the same cold-side ledger as shivering.
    const cocoa = body(); applyWarmth(cocoa, 5, 30); driftBodyTemperature(cocoa, 1);
    const nothing = body(); driftBodyTemperature(nothing, 1);
    check('a hot drink slows the cold', cocoa.body_temp_c > nothing.body_temp_c, `${cocoa.body_temp_c} > ${nothing.body_temp_c}`);
    check('…and the drift burns its clock down', cocoa._warmMin === 29, String(cocoa._warmMin));

    removeTransientZone(roomId);
    removeTransientZone(dreamId);
  }

  // ── Windproofing, and seasonal water ───────────────────────────────────────
  {
    const { windChillDelta, waterTemperature, apparentTemperature } = await import('../server/engine/environment.js');
    const { recomputeInsulation } = await import('../server/engine/commands/inventory.js');

    // Wind chill is a property of the ZONE; a shell is a property of the PLAYER. The delta is
    // isolated by running the curve twice so the humidity terms cancel exactly.
    const windy = apparentTemperature(-5, 40, 80), calm = apparentTemperature(-5, 0, 80);
    check('wind chill only ever makes cold air colder', windy < calm, `${windy} < ${calm}`);
    check('windChillDelta is zero indoors (no wind in a room)', windChillDelta('nonexistent_zone_id') === 0, 'indoor/unknown → 0');

    // A shell gives back the wind's share for the slots it covers — torso is worth most of it.
    const shellRows = [{ tags: { slot: 'torso', windproof: true, insulation: 4 } }];
    const shelled = {}; await recomputeInsulation(shelled, shellRows);
    check('a windproof torso blocks most of the chill', shelled.windproof === 0.65, String(shelled.windproof));
    const fullRows = [{ tags: { slot: 'torso', covers: ['legs'], windproof: true, insulation: 4 } }];
    const sealed = {}; await recomputeInsulation(sealed, fullRows);
    check('a shell covering torso and legs blocks all of it', sealed.windproof === 1, String(sealed.windproof));
    const plainRows = [{ tags: { slot: 'torso', insulation: 4 } }];
    const plain = {}; await recomputeInsulation(plain, plainRows);
    check('an ordinary coat blocks none of it (windproof is not insulation)', plain.windproof === 0, String(plain.windproof));

    // `insulationWet` — the share that survives a soaking, derived here so the temp tick
    // never has to look at an item.
    check('an ordinary coat keeps none of its warmth wet', plain.insulationWet === 0, String(plain.insulationWet));
    const woolly = {}; await recomputeInsulation(woolly, [{ tags: { slot: 'torso', insulation: 3, hydrophobic: true } }]);
    check('a hydrophobic garment keeps all of it', woolly.insulationWet === 3, String(woolly.insulationWet));
    const mixed = {}; await recomputeInsulation(mixed, [
      { tags: { slot: 'torso', insulation: 3 } }, { tags: { slot: 'legs', insulation: 2, hydrophobic: true } }]);
    check('a mixed outfit keeps only the hydrophobic share',
      mixed.insulation === 5 && mixed.insulationWet === 2, `${mixed.insulation} total, ${mixed.insulationWet} wet`);
    check('the wet share can never exceed the total', mixed.insulationWet <= mixed.insulation, 'bounded');
    check('the two coats insulate identically — only the wind differs',
      plain.insulation === shelled.insulation, `${plain.insulation} vs ${shelled.insulation}`);

    // Extremity exposure — the field frostbite runs on, owned here so the plugin reads no inventory.
    check('bare extremities read fully exposed', plain.extremityExposure === 1, String(plain.extremityExposure));
    const gloved = {}; await recomputeInsulation(gloved, [
      { tags: { slot: 'hands' } }, { tags: { slot: 'feet' } }, { tags: { slot: 'head' } }]);
    check('gloves, boots and a hat cover every extremity', gloved.extremityExposure === 0, String(gloved.extremityExposure));
    const halfGloved = {}; await recomputeInsulation(halfGloved, [{ tags: { slot: 'hands' } }]);
    check('extremity exposure is a fraction, not a flag',
      Math.abs(halfGloved.extremityExposure - 2 / 3) < 1e-9, String(halfGloved.extremityExposure));

    // Water: authored override still wins outright, and the derived value stays in a band that
    // is liquid at one end and a temperate sea at the other, whatever month it is.
    const poolId = 'zone_regress_pool_' + process.pid;
    registerTransientZone({ id: poolId, name: 'Regress Pool', description: 'Water.', exits: {}, flags: { terrain: 'water', water_temp_c: 30 } });
    check('an authored water temperature wins outright', waterTemperature(poolId) === 30, String(waterTemperature(poolId)));
    removeTransientZone(poolId);

    const seaId = 'zone_regress_sea_' + process.pid;
    registerTransientZone({ id: seaId, name: 'Regress Sea', description: 'Water.', exits: {}, flags: { terrain: 'water' } });
    const deepId = 'zone_regress_deep_' + process.pid;
    registerTransientZone({ id: deepId, name: 'Regress Deep', description: 'Water.', exits: {}, flags: { terrain: 'water', underwater: true } });
    const surfaceC = waterTemperature(seaId), deepC = waterTemperature(deepId);
    check('surface water stays liquid and temperate', surfaceC >= 2 && surfaceC <= 24, String(surfaceC));
    check('deep water is colder than the surface', deepC < surfaceC, `${deepC} < ${surfaceC}`);
    check('deep water is capped below the surface maximum', deepC <= 12, String(deepC));
    // GEOTHERMAL WATER. A hot spring is heated from underneath, so it must ignore the seasonal
    // derivation entirely rather than offsetting it — the whole point is that it is warm in winter.
    // It has to land ABOVE the surface band (or it is not a refuge) and it must not be scalding
    // (there is no damage channel behind it), and an authored number still has to win, because
    // that is the escape hatch for a spring that should hurt.
    // `thermal: true` is passed as a FLAG rather than left to the hotspring preset, for the same
    // reason the deep-water case above passes `underwater: true`: a transient zone has no derived
    // row, and propsOf documents that the terrain PRESET rung is unreachable from the engine (it
    // needs the palette, a build-time input). The preset half is covered by the resolveProps suite;
    // this is the runtime branch.
    const springId = 'zone_regress_spring_' + process.pid;
    registerTransientZone({ id: springId, name: 'Regress Spring', description: 'Hot water.', exits: {}, flags: { terrain: 'hotspring', thermal: true } });
    const springC = waterTemperature(springId);
    check('a hot spring is warmer than any surface water', springC > surfaceC && springC > 24, `${springC} > ${surfaceC}`);
    check('a hot spring is bathing temperature, not scalding', springC >= 30 && springC <= 45, String(springC));
    removeTransientZone(springId);
    const scaldId = 'zone_regress_scald_' + process.pid;
    registerTransientZone({ id: scaldId, name: 'Regress Scald', description: 'Hot water.', exits: {}, flags: { terrain: 'hotspring', thermal: true, water_temp_c: 82 } });
    check('an authored temperature still beats the thermal preset', waterTemperature(scaldId) === 82, String(waterTemperature(scaldId)));
    removeTransientZone(scaldId);
    removeTransientZone(seaId);
    removeTransientZone(deepId);
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

// NPC lock-up never traps a player, and never bolts a bathroom.
// (ai-behaviour.js npcAutoLockable/markAutoLock + the engine:door-lock gate.)
{
  const streetId = 'zone_regress_street_' + process.pid;
  const shopId   = 'zone_regress_shop_' + process.pid;
  const mapId    = 'map_regress_shop_' + process.pid;
  const occupants = () => ({ players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), items: new Set(), furniture: new Set() });
  world.zones.set(streetId, { id: streetId, name: 'Regress Street', description: 'A street.', flags: {}, exits: { north: shopId }, ...occupants() });
  world.zones.set(shopId,   { id: shopId, name: 'Regress Shop', description: 'A shop.', map_id: mapId, flags: { is_interior: true }, exits: { south: streetId }, ...occupants() });
  const shopDoorId = 'door_regress_shop_' + process.pid;
  setDoorCache(shopDoorId, {
    id: shopDoorId, zone_id: shopId, exit_dir: 'south', target_zone: streetId,
    hp: 100, hp_max: 100, is_open: 0, lock_state: 'unlocked', tags: { 'lock:hololock': {} },
  });

  const vendor = { id: 'npc_rg_vendor_' + process.pid, name: 'Vendor', zone_id: shopId, work_zone_id: shopId };
  moveEntity(vendor, streetId, broadcast, undefined);
  const shopDoor = getDoorForExit(shopId, 'south', streetId);
  check('vendor locks up on leaving work, marking the inside',
    shopDoor.lock_state === 'locked' && shopDoor._autoLockedInside === shopId,
    `lock=${shopDoor.lock_state} inside=${shopDoor._autoLockedInside}`);

  const shopper = getPlayer();
  const savedShopperZone = shopper.current_zone;
  world.zones.get(shopId).players.add(shopper.id);
  shopper.current_zone = shopId;
  shopper._lastStepAt = 0;
  const gotOut = await cmdMove('south', shopper, broadcast);
  check('a player shut in by the closing shop can still walk out',
    shopper.current_zone === streetId, `${gotOut?.type}: ${gotOut?.message || ''}`);

  shopper._lastStepAt = 0;
  const gotIn = await cmdMove('north', shopper, broadcast);
  check('…but cannot walk back into the locked shop',
    shopper.current_zone === streetId && gotIn?.type === 'error', `${gotIn?.type}: ${gotIn?.message || ''}`);

  world.zones.get(streetId).players.delete(shopper.id);
  world.zones.get(shopId).players.delete(shopper.id);
  shopper.current_zone = savedShopperZone;
  deleteDoorCache(shopDoorId);
  world.zones.delete(streetId);
  world.zones.delete(shopId);

  // A privacy bolt (every bathroom door in the world) is never auto-engaged: a
  // resident walking home past their own ensuite used to bolt the toilet shut.
  const flatId = 'zone_regress_flat_' + process.pid;
  const bathId = 'zone_regress_bath_' + process.pid;
  world.zones.set(flatId, { id: flatId, name: 'Regress Flat 2', flags: { is_apartment: true }, exits: { north: bathId }, players: new Set(), npcs: new Set(), enemies: new Set() });
  world.zones.set(bathId, { id: bathId, name: 'Regress Ensuite', flags: {}, exits: { south: flatId }, players: new Set(), npcs: new Set(), enemies: new Set() });
  const bathDoorId = 'door_regress_bath_' + process.pid;
  setDoorCache(bathDoorId, {
    id: bathDoorId, zone_id: bathId, exit_dir: 'south', target_zone: flatId,
    hp: 100, hp_max: 100, is_open: 0, lock_state: 'unlocked',
    tags: { 'lock:privacylock': { privacySide: bathId } },
  });
  const bather = { id: 'npc_rg_bather_' + process.pid, name: 'Bather', zone_id: bathId, home_zone: flatId };
  moveEntity(bather, flatId, broadcast, undefined);
  const bathDoor = getDoorForExit(bathId, 'south', flatId);
  check('an NPC never bolts a privacy lock behind itself',
    bathDoor.lock_state !== 'locked', `lock=${bathDoor.lock_state}`);
  deleteDoorCache(bathDoorId);
  world.zones.delete(flatId);
  world.zones.delete(bathId);
}

// A shop session never freezes a vendor permanently.
//
// `_ai.shopPaused` yields the ENTIRE behaviour graph — no commute, no wander, no
// banter — and closeShopSession is only reached from `shop_close`, a disconnect, and
// cmdMove. Every other way a player's current_zone changes (sleep, death, jail, a
// lift, a flight, an apartment door, a VINE teleport) used to leave the flag stuck
// on until the next restart, welding the vendor to their counter. tickEntityAI now
// derives the pause from the shopper actually still standing there.
{
  const shopId = 'zone_regress_shopsess_' + process.pid;
  const awayId = 'zone_regress_shopsess_away_' + process.pid;
  const occupants = () => ({ players: new Set(), npcs: new Set(), enemies: new Set(), corpses: new Set(), items: new Set(), furniture: new Set() });
  world.zones.set(shopId, { id: shopId, name: 'Regress Counter', description: 'A counter.', flags: { is_interior: true }, exits: {}, ...occupants() });
  world.zones.set(awayId, { id: awayId, name: 'Regress Elsewhere', description: 'Elsewhere.', flags: { is_interior: true }, exits: {}, ...occupants() });

  // Minimal graph: a start node that goes nowhere, so the tick exercises the pause
  // gate and nothing else.
  const keeper = {
    id: 'npc_rg_shopsess_' + process.pid, name: 'Keeper', zone_id: shopId,
    behaviour_graph: { _start: 'start', nodes: { start: { type: 'start' } } },
    _ai: initBlackboard(),
  };
  world.npcs.set(keeper.id, keeper);
  world.zones.get(shopId).npcs.add(keeper.id);

  const shopper = getPlayer();
  const savedZone = shopper.current_zone;
  shopper.current_zone = shopId;

  openShopSession(shopper.id, keeper.id);
  check('opening a shop pauses the vendor', keeper._ai.shopPaused === true, `paused=${keeper._ai.shopPaused}`);

  // Still at the counter — the pause is real and must hold.
  await tickEntityAI(keeper, { broadcast, query: undefined });
  check('…and the pause holds while the shopper is still in the room',
    keeper._ai.shopPaused === true && getNpcForShopper(shopper.id) === keeper.id,
    `paused=${keeper._ai.shopPaused} session=${getNpcForShopper(shopper.id)}`);

  // Teleported out WITHOUT cmdMove — this is sleep/death/jail/lift/flight.
  shopper.current_zone = awayId;
  await tickEntityAI(keeper, { broadcast, query: undefined });
  check('a shopper who left by any route other than walking unfreezes the vendor',
    keeper._ai.shopPaused === false, `paused=${keeper._ai.shopPaused}`);
  check('…and the stale session is torn down, not just the flag',
    getNpcForShopper(shopper.id) === null, `session=${getNpcForShopper(shopper.id)}`);

  // A pause with no session behind it at all (a vendor left flagged by a crashed
  // handler) must also self-heal, or that NPC is frozen for the process lifetime.
  keeper._ai.shopPaused = true;
  await tickEntityAI(keeper, { broadcast, query: undefined });
  check('a pause with no session behind it clears itself too',
    keeper._ai.shopPaused === false, `paused=${keeper._ai.shopPaused}`);

  closeShopSession(shopper.id);
  shopper.current_zone = savedZone;
  world.npcs.delete(keeper.id);
  world.zones.delete(shopId);
  world.zones.delete(awayId);
}

// The room's "Vendors here:" section is a statement about whether you can BUY, so it
// asks the clock — an off-shift shopkeeper lists as an ordinary NPC rather than
// advertising a counter that the trade path will then refuse. This covers the
// predicate describe.js now consults; the two must not drift apart.
{
  const { getEnvironmentState } = await import('../server/engine/environment.js');
  const hour = getEnvironmentState().hour ?? 0;
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const everyDay = (block) => Object.fromEntries(DAYS.map(d => [d, [block]]));
  // A window that can never contain the current hour, whatever the clock says.
  const shutHour = (hour + 2) % 22;

  const openNow = { id: 'npc_rg_open', name: 'Open', vendor_schedule: everyDay({ from: 0, to: 24 }) };
  const shutNow = { id: 'npc_rg_shut', name: 'Shut', vendor_schedule: everyDay({ from: shutHour, to: shutHour + 1 }) };

  check('a vendor inside their scheduled hours reads as open',
    isVendorClosed(openNow) === false, `hour=${hour}`);
  check('a vendor outside them reads as closed, so the room stops calling them a vendor',
    isVendorClosed(shutNow) === true, `hour=${hour} window=${shutHour}-${shutHour + 1}`);
  check('a vendor with no schedule at all still trades round the clock',
    isVendorClosed({ id: 'npc_rg_always', name: 'Always' }) === false, 'no schedule');
  // Covert dealers are exempt outright — their window belongs to the dealer plugin,
  // and they were already camouflaged out of the vendor section by trust_flag.
  check('a covert dealer is never closed by vendor_schedule',
    isVendorClosed({ ...shutNow, flags: { covert: true } }) === false, 'covert');
}

// Disturbing a sleeping NPC: the roll, the wake-up state, and the escalation that
// stops a sleeper being a locked door. All in-memory on a synthetic NPC — no zone,
// no DB, no broadcast (disturbSleeper takes a null broadcast and still returns the
// line, which is what the verb answers the actor with).
{
  const mkSleeper = (dose = null) => {
    const npc = { id: 'npc_rg_sleeper_' + process.pid, name: 'Sleeper', zone_id: null, posture: 'lying' };
    npc._ai = initBlackboard();
    npc._ai.homeSleeping = true;
    npc._ai.sleepStartedAt = Date.now();
    npc._ai.dose = dose;
    return npc;
  };

  check('an awake NPC is not disturbable', disturbSleeper({ _ai: initBlackboard() }) === null);
  check('isNpcAsleep reads the sleep flag', isNpcAsleep(mkSleeper()) === true && isNpcAsleep({}) === false);

  // Every disturbance answers with a line, and the outcome is one of the two.
  const one = disturbSleeper(mkSleeper());
  check('a disturbance always produces a broadcastable line',
    !!one && typeof one.message === 'string' && one.message.includes('Sleeper'), JSON.stringify(one));
  check('a sleeper who stays under has no mood; one who wakes has one',
    one.woke ? (one.mood === 'annoyed' || one.mood === 'confused') : one.mood === null, JSON.stringify(one));

  // Persistence works: each attempt erodes the chance, so a bounded number of
  // tries always wakes them. Five is well past the 0.2-per-disturbance decay.
  const stubborn = mkSleeper({ loose: true });     // deepest sleeper there is
  let woke = false;
  for (let i = 0; i < 8 && !woke; i++) woke = !!disturbSleeper(stubborn)?.woke;
  check('repeated disturbance always eventually wakes even a doped sleeper', woke === true);
  check('waking clears the sleep state', !isNpcAsleep(stubborn) && stubborn.posture === 'standing',
    `asleep=${isNpcAsleep(stubborn)} posture=${stubborn.posture}`);
  check('waking restarts the graph and holds them awake',
    stubborn._ai.currentNode === null && stubborn._ai.waitUntil === null && stubborn._ai.wokenUntil > Date.now(),
    `node=${stubborn._ai.currentNode} wait=${stubborn._ai.waitUntil}`);
  check('waking records the mood the passive home-life ticker reads',
    !!stubborn._ai.wokeMood && ['annoyed', 'confused'].includes(stubborn._ai.wokeMood.mood));
  check('a woken NPC is no longer disturbable', disturbSleeper(stubborn) === null);

  // force skips the roll — being hit wakes you, no dice.
  const hit = mkSleeper({ loose: true });
  const forced = disturbSleeper(hit, { force: true });
  check('force wakes on the first try, no roll', forced.woke === true && !isNpcAsleep(hit));

  // wakeNpc is idempotent enough to call from any wake path without side damage.
  wakeNpc(hit);
  check('wakeNpc on an already-awake NPC is harmless', !isNpcAsleep(hit) && hit.posture === 'standing');
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
  // DELIBERATE: walking around does not play music. Region themes were tried and
  // pulled — a song starting because you crossed an invisible region boundary read
  // as a bug to the player, and the music slot belongs to things you can point at
  // (a radio, a TV, the broadcast plugin). The mechanism above stays pinned because
  // a tile-level theme is still a legitimate thing to author for one room; what is
  // asserted here is that no REGION carries one.
  check('no region paints its tiles with a music theme',
    getAllZones().every(z => resolveDefault('audio_theme_id', z, regionForZone(z)) === null),
    getAllZones().filter(z => resolveDefault('audio_theme_id', z, regionForZone(z)))
      .slice(0, 3).map(z => z.id).join(', '));
  // Every authored default must name a song that EXISTS. content:lint checks this
  // against the file tree; this checks the database the world actually booted from,
  // because a JSONB value has no foreign key to break loudly.
  const wanted = [...world.regions.values()].map(r => r.defaults?.audio_theme_id).filter(Boolean);
  const known = new Set((await query('SELECT id FROM audio_songs')).rows.map(r => r.id));
  const badDefaults = wanted.filter(id => !known.has(id));
  // Vacuous while no region authors a theme (see above) — kept because the day one
  // does, a typo'd song id must fail here rather than play silence.
  check('every region default names a real song', badDefaults.length === 0,
    badDefaults.length ? badDefaults.join(', ') : `${wanted.length} authored`);
}

// LAW: presentation is DERIVED AT BUILD TIME, and there is exactly one derivation.
// Every renderer reads zone_derived.spec; none of them owns a palette. These pin the
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
    // Coordinates, because auto-tiling is a function of the NEIGHBOURS (§7.3).
    // Without them the determinism and order-independence checks below would be
    // passing over a world in which every road tile is an island.
    map_id: z.map_id, grid_x: z.grid_x, grid_y: z.grid_y, grid_z: z.grid_z,
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

  // ── deriveAutoTile — adjacency-aware art (spec §7.3, §2.3) ────────────────
  // Which connector piece a road draws is a function of its neighbours, so it is
  // checked against THE MAP rather than against itself: for every auto-tiling tile,
  // each of the four sides must say exactly whether an auto-tiling tile is there.
  // Checked on the pure derive rather than on zone_derived, because this is the
  // authored half — the table is only as fresh as the last import.
  const autoTerrains = new Set(Object.entries(palette?.terrains || {})
    .filter(([, t]) => t.auto_tile).map(([k]) => k));
  const autoOf = (z) => !!(z && autoTerrains.has(resolveTerrain(z)));
  const AT_DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  // THE BUILD'S OWN CELL INDEX, not a second one written here. This check used to
  // build a last-wins map that also indexed off-map rooms — the same two defects
  // deriveWorld's private index had, so the test would have enshrined the bug it
  // was meant to catch. A cell holds a LIST, and a side joins if ANY occupant there
  // auto-tiles; off-map rooms have no map to be adjacent on and are not in the index.
  const cells = buildCellIndex(zonesForDerive);
  const occupantsAt = (z, dx = 0, dy = 0) =>
    cells.get(gridKey(z.map_id, z.grid_x + dx, z.grid_y + dy, z.grid_z)) || [];
  const anyAutoAt = (z, dx, dy) => occupantsAt(z, dx, dy).some(autoOf);
  const autoTiles = zonesForDerive.filter(z => autoOf(z) && z.grid_x != null);
  const specAt = (id) => a.render.get(id)?.spec;
  const wrongSide = autoTiles.filter(z => {
    const at = specAt(z.id)?.auto_tile;
    if (!at) return true;
    return Object.entries(AT_DIRS).some(([d, [dx, dy]]) => at[d] !== anyAutoAt(z, dx, dy));
  });
  check(`every auto-tiling tile's spec matches its neighbours (${autoTiles.length} tiles)`,
    autoTiles.length > 0 && wrongSide.length === 0, wrongSide.slice(0, 3).map(z => z.id).join(', '));
  // Present iff the palette auto-tiles the terrain (§2.3). It used to be a bare
  // boolean on all 5,788 tiles, which told a renderer that a tile auto-tiles
  // without telling it what to draw — so nothing drew anything.
  const strayAuto = zonesForDerive.filter(z => !autoOf(z) && specAt(z.id)?.auto_tile !== undefined);
  check('a terrain the palette does not auto-tile carries no auto_tile key',
    strayAuto.length === 0, strayAuto.slice(0, 3).map(z => z.id).join(', '));
  // And the thing that makes it worth deriving at all: a street in the middle of a
  // grid joins on more than one side. All-islands would satisfy every check above.
  const junctions = autoTiles.filter(z => Object.values(specAt(z.id).auto_tile).filter(Boolean).length >= 2);
  check('painted roads derive as a connected network, not a field of islands',
    junctions.length > 0, `${junctions.length}/${autoTiles.length} tiles join two or more sides`);

  // ── The tile stack: ground / feature / label (spec §7.7) ──────────────────
  // This used to read PAINTED GROUND NEVER CARRIES A LABEL, and it was a blanket
  // suppression standing in for a data cleanup: 860 tiles authored a terrain
  // DECORATION in `zones.marker` (`#` on grass, `≈` on water) which, drawn, letters
  // the grasslands. Deleting the decorations (tile-override-cleanup.mjs) let the rule
  // go, because the thing actually worth forbidding is narrower — see
  // docs/proposals/tile-presentation-overrides.md.
  //
  // WHAT REPLACES IT: a label on painted ground must be AUTHORED. A derived code —
  // a building acronym, an apartment floor, sewer corridor art — landing on ground
  // is the accident (it means a building or a corridor got painted as a surface, and
  // that reads as a lane drawn through a building). A human typing two characters
  // onto one tile is the feature. The old rule could not tell those apart and so
  // banned both.
  const specs = [...a.render.values()].map(r => r.spec);
  const labelledGround = zonesForDerive.filter(z => specAt(z.id)?.label && specAt(z.id)?.terrain);
  const derivedOnGround = labelledGround.filter(z => !String(z.marker ?? '').trim());
  check('a label on painted ground is authored, never derived', derivedOnGround.length === 0,
    derivedOnGround.slice(0, 3).map(z => z.id).join(', '));
  // AND THE OTHER SIDE OF THAT RULE: a building must not BE painted ground. The
  // suppression above is by design, so a stray terrain on a building tile silently
  // deletes its navigable code — and a missing label looks exactly like a tile that
  // never had one. Hall of Records sat as `terrain: road` and Halloran's Fix-It as
  // `grass`, both codeless on the map and the tablet, and the roads beside Hall of
  // Records drew a lane straight through the building. content:lint errors on it and
  // the Studio's brush refuses it; this is the same invariant against the live world.
  const groundedBuildings = zonesForDerive.filter(z => z.map_id === 'map_world'
    && (z.flags?.facade || z.flags?.is_building) && z.flags?.terrain);
  check('no building tile is painted as ground', groundedBuildings.length === 0,
    groundedBuildings.slice(0, 3).map(z => `${z.id} (${z.flags.terrain})`).join(', '));
  // An off-map room carries coordinates but no map, so it cannot be anybody's
  // neighbour. Seven of them — the Echelon suite's bath and boudoir, four Solenne
  // baths, The Inbetween — all sat on the single key `|0,0,0` in the render pass's
  // old private index, shadowing each other.
  const offMapIndexed = zonesForDerive.filter(z => z.map_id == null && z.grid_x != null
    && cells.has(gridKey(z.map_id, z.grid_x, z.grid_y, z.grid_z)));
  check('off-map rooms are absent from the coordinate index', offMapIndexed.length === 0,
    offMapIndexed.slice(0, 3).map(z => z.id).join(', '));
  // `spec.glyph` had exactly one consumer in the repo — the Studio's debug line —
  // because every renderer read the authored `zones.marker` off the payload instead.
  // Its replacement must not quietly come back.
  check('the dead spec.glyph channel is gone', specs.every(s => !('glyph' in s)));
  const labels = specs.filter(s => s.label);
  check(`a label declares what the overlay may do to it (${labels.length} tiles)`,
    labels.length > 0 && labels.every(s => typeof s.label.text === 'string' && s.label.text
      && ['building', 'room', 'mark'].includes(s.label.kind)));
  // `mark` is the only kind no overlay mode can switch off, so what qualifies for it
  // has to be checkable rather than assumed. It replaced a kind `art` that meant "this
  // tile's id starts with zone_under_ and sits below ground" — under which 34 authored
  // ROOM decorations were classified as corridor structure and became undismissable.
  // The rule now is an identity: kind `mark` iff a human authored zones.marker. This
  // check is the whole reason that defect cannot recur — not the sewers being fixed,
  // but the category losing its ability to admit a tile nobody drew on.
  const marked = zonesForDerive.filter(z => specAt(z.id)?.label?.kind === 'mark');
  const unauthoredMarks = marked.filter(z => !String(z.marker ?? '').trim());
  check(`kind 'mark' means a human authored zones.marker (${marked.length} tiles)`,
    marked.length > 0 && unauthoredMarks.length === 0,
    unauthoredMarks.slice(0, 3).map(z => z.id).join(', '));
  // The hierarchy, as data: a road tile has no label key the overlay could reach —
  // which is what stops "letters instead of buildings" also blanking roads. Same
  // narrowing as above: a road may now wear a label a human deliberately typed, but
  // it must never DERIVE one, because a derived code on a road means a building was
  // painted as a lane.
  const labelledAuto = autoTiles.filter(z => specAt(z.id)?.label && !String(z.marker ?? '').trim());
  check('an auto-tiled road derives no label, so no overlay mode can toggle it',
    labelledAuto.length === 0, labelledAuto.slice(0, 3).map(z => z.id).join(', '));
  // deriveFeature's precedence, checked against the map rather than against itself.
  const features = specs.filter(s => s.feature);
  const badFeature = features.filter(s => !/^[a-z0-9_-]+$/i.test(s.feature));
  check(`every feature names one zone-icon asset (${features.length} tiles)`,
    features.length > 0 && badFeature.length === 0, badFeature.slice(0, 3).map(s => s.feature).join(', '));
  const autoNoFeature = autoTiles.filter(z => !specAt(z.id)?.feature);
  check('every auto-tiling tile resolves to a connector piece',
    autoNoFeature.length === 0, autoNoFeature.slice(0, 3).map(z => z.id).join(', '));
  // THE PIECE FILE HAS TO EXIST. The check above only proves a tile named a piece; the
  // name is turned into `/assets/zone-icons/<name>.svg` by a CSS mask, and a missing file
  // fails SILENTLY — the tile just draws nothing, which on a cliff means an escarpment
  // with no outline and no way to tell it from open ground. A second family made that a
  // live risk: 16 new files, and the naming rule is generated, not typed.
  {
    const iconDir = join(__dirname, '..', 'client', 'game', 'assets', 'zone-icons');
    const wanted = [...new Set(specs.map(s => s.feature).filter(f => /^cliff_/.test(f || '')))];
    const missing = wanted.filter(n => !existsSync(join(iconDir, `${n}.svg`)));
    check(`every cliff piece a tile asks for exists on disk (${wanted.length} distinct)`,
      wanted.length > 0 && missing.length === 0, missing.join(', '));
  }
  // An authored flags.icon is the OVERRIDE rung and must win — that is the whole
  // basis for overriding a tile in the Studio.
  const overridden = zonesForDerive.filter(z => z.flags?.icon);
  check(`an authored flags.icon outranks the derived feature (${overridden.length} tiles)`,
    overridden.length > 0 && overridden.every(z => specAt(z.id)?.feature === String(z.flags.icon)));
  // featureProvenance is what the Studio explains a tile with. It must be the SAME
  // precedence deriveFeature ships, or the editor is describing a tile the build did
  // not make — so it is checked against deriveFeature on every tile, not sampled.
  // The FAMILY has to be threaded here for the same reason the Studio threads it: a
  // cliff tile's piece is `cliff_ns`, and provenance called at the default family
  // would say `road_ns` and report every cliff in the world as an editor/build
  // disagreement. Same function, same arguments, or this check is not checking.
  const provMismatch = zonesForDerive.filter(z =>
    featureProvenance(z, specAt(z.id)?.auto_tile ?? null, autoTileFamily(z, palette)).name
      !== (specAt(z.id)?.feature ?? null));
  check('the provenance an editor shows is the feature the build ships',
    provMismatch.length === 0, provMismatch.slice(0, 3).map(z => z.id).join(', '));
  const provSrc = zonesForDerive.map(z => featureProvenance(z, specAt(z.id)?.auto_tile ?? null, autoTileFamily(z, palette)));
  check('every feature reports which rung produced it',
    provSrc.every(p => (p.name === null) === (p.source === null)
      && (p.source === null || ['authored', 'rooftop', 'auto'].includes(p.source))));
  // The stale-pin warning the Studio draws is exactly the drift list, by construction.
  const staleProv = provSrc.filter(p => p.stale);
  check(`a stale pin is detectable per tile, not just in aggregate (${staleProv.length})`,
    staleProv.length === a.featureOverrides.length);
  // The Map Icon picker is the catalog's, not a hand-written control: `ref` + a
  // refTable the Studio can resolve. If this reverts to `text` the picker silently
  // becomes a free-text box and a typo goes back to being inert forever.
  check('Map Icon is a catalogued picker, not a free-text field',
    TAG_CATALOG.icon?.shape === 'ref' && TAG_CATALOG.icon?.refTable === 'zone_icons');
  // Every asset a feature names must exist on disk, or the map draws a broken image.
  const iconDir = join(__dirname, '..', 'client', 'game', 'assets', 'zone-icons');
  const haveIcons = new Set((await readdir(iconDir)).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)));
  const missingIcons = [...new Set(features.map(s => s.feature))].filter(n => !haveIcons.has(n));
  check('every derived feature has an SVG on disk', missingIcons.length === 0, missingIcons.slice(0, 5).join(', '));
  // Drift, reported not resolved: an authored road piece frozen by hand does not grow
  // an arm when someone paints a lane beside it later. This is a real, visible defect
  // class (a road dead-ending into another road), so it is surfaced with a count
  // rather than asserted to zero — which of the two is right is a call about the map.
  if (a.featureOverrides.length) {
    console.log(`    note: ${a.featureOverrides.length} authored road icons disagree with adjacency — ` +
      a.featureOverrides.slice(0, 3).map(o => `${o.id} ${o.authored}→${o.implied}`).join(', '));
  }

  // Completeness. A tile with no derived row renders with no fill at all, and the
  // renderers have no fallback any more — that is the point, so this must hold.
  const missing = getAllZones().filter(z => !renderOf(z.id));
  check(`every zone has a zone_derived row (${world.render.size} rows)`, missing.length === 0,
    missing.slice(0, 3).map(z => z.id).join(', ') + (missing.length ? ' — run npm run map:derive' : ''));
  const noSpec = getAllZones().filter(z => !specOf(z.id));
  check('every zone_derived row carries a spec', noSpec.length === 0, noSpec.slice(0, 3).map(z => z.id).join(', '));

  // ── Gameplay properties (docs/proposals/terrain-property-presets.md) ────────
  // Pure resolver first: no world, no DB, so a failure here is the RULE breaking
  // rather than the data.
  {
    const P = (flags) => resolveProps({ flags }, palette);
    check('props: an unpainted tile gets the defaults',
      JSON.stringify(P({})) === JSON.stringify(PROP_DEFAULTS));
    check('props: water inherits its terrain preset',
      P({ terrain: 'water' }).swimmable === true && P({ terrain: 'water' }).routable === false);
    check('props: solid ground inherits the defaults',
      P({ terrain: 'road' }).routable === true && P({ terrain: 'road' }).swimmable === false);
    // THE LANDFORM TRIO. cliff is the only impassable terrain in the game; plateau and
    // ramp are the same landform and must NOT inherit that — a tableland you cannot
    // stand on is scenery, and a ramp that refuses you is a wall with a paler fill.
    check('props: cliff is the one terrain a body cannot enter',
      P({ terrain: 'cliff' }).passable === false && P({ terrain: 'cliff' }).routable === false);
    check('props: the plateau on top of it, and the ramp up to it, are walkable',
      P({ terrain: 'plateau' }).passable === true && P({ terrain: 'ramp' }).passable === true);
    check('props: everything else is passable by default',
      P({}).passable === true && P({ terrain: 'water' }).passable === true);
    // THE VOLCANIC SET is surfaces, not elevation: none of it may raise ground or block a step.
    // hotspring is the exception that proves it — water, so swum rather than walked, and the only
    // terrain carrying `thermal`.
    check('props: a hot spring is swimmable water that is heated',
      P({ terrain: 'hotspring' }).thermal === true && P({ terrain: 'hotspring' }).swimmable === true
      && P({ terrain: 'hotspring' }).liquid === true && P({ terrain: 'hotspring' }).routable === false);
    check('props: cold water is not thermal',
      P({ terrain: 'water' }).thermal === false && P({}).thermal === false);
    check('props: basalt, dead stands and sinter are ordinary walkable ground',
      ['basalt', 'deadwood', 'sinter'].every(t => P({ terrain: t }).passable === true
        && P({ terrain: t }).swimmable === false));
    check('props: a sinter crust is not a foundation', P({ terrain: 'sinter' }).buildable === false);
    // THE tri-state regression. `false` must beat the preset — if this fails, the
    // override rung has collapsed back to presence-only and a frozen bay is
    // unauthorable. It is the reason the shape is `tristate` and not `flag`.
    const frozen = P({ terrain: 'water', swimmable: false, routable: true });
    check('props: an explicit FALSE overrides the preset (the frozen bay)',
      frozen.swimmable === false && frozen.routable === true,
      JSON.stringify(frozen));
    check('props: an unset key still inherits alongside an overridden one',
      frozen.buildable === false);
    check('props: a tile can force a property ON against its terrain (flooded basement)',
      P({ terrain: 'concrete', swimmable: true }).swimmable === true);
    // NUMERIC properties. A number already distinguishes absent from set, so it needs
    // no tri-state — but it must not go through the boolean path, which would turn
    // `speed_mult: 2` into `true` and every road into walking pace.
    check('props: a numeric property carries its preset', P({ terrain: 'road' }).speed_mult === 2);
    check('props: a numeric override is a NUMBER, not coerced to a boolean',
      P({ terrain: 'road', speed_mult: 0.5 }).speed_mult === 0.5,
      `${P({ terrain: 'road', speed_mult: 0.5 }).speed_mult}`);
    check('props: a garbage numeric override falls back to the default, never NaN',
      P({ terrain: 'road', speed_mult: 'fast' }).speed_mult === 1);
    // The underwater terrain: paints exactly like water, behaves nothing like it.
    check('props: the underwater terrain presets underwater + swimmable + liquid',
      P({ terrain: 'underwater' }).underwater === true && P({ terrain: 'underwater' }).swimmable === true
      && P({ terrain: 'underwater' }).liquid === true);
    check('props: surface water is NOT underwater',
      P({ terrain: 'water' }).underwater === false);
    check('props: frontage is preset on road only (dirt_road is not a front-door street)',
      P({ terrain: 'road' }).frontage === true && P({ terrain: 'dirt_road' }).frontage === false);
    // Your call, 2026-07-30: a marsh is walked, not swum.
    check('props: marsh is deliberately not swimmable',
      P({ terrain: 'marsh' }).swimmable === false && P({ terrain: 'marsh' }).liquid === false);
  }
  // The flag→terrain migration: 82 tiles carried terrain 'water' AND flags.underwater,
  // two facts saying one thing. They are now terrain 'underwater' and the flag is gone.
  check('no tile still carries a raw underwater flag (migrated to terrain)',
    getAllZones().every(z => !('underwater' in (z.flags || {}))),
    getAllZones().filter(z => 'underwater' in (z.flags || {})).slice(0, 3).map(z => z.id).join(', '));
  const noProps = getAllZones().filter(z => !renderOf(z.id)?.props);
  check('every zone_derived row carries props', noProps.length === 0,
    noProps.slice(0, 3).map(z => z.id).join(', '));

  // The 2026-07-21 guard, and the reason this block exists at all. `flags.water`
  // was migrated to terrain and its 12 readers were left behind; because the flag
  // then sat on no row, every water check silently answered "no" and GPS routed
  // across a 945-tile basin for nine days. Nothing failed. This is what would have.
  {
    const water = getAllZones().filter(z => z.flags?.terrain === 'water');
    const notSwim = water.filter(z => !propsOf(z.id).swimmable && !('swimmable' in (z.flags || {})));
    const routable = water.filter(z => propsOf(z.id).routable && !('routable' in (z.flags || {})));
    check(`every painted water tile resolves swimmable (${water.length} tiles)`,
      notSwim.length === 0, notSwim.slice(0, 3).map(z => z.id).join(', '));
    check('no painted water tile is routable unless it says so explicitly',
      routable.length === 0, routable.slice(0, 3).map(z => z.id).join(', '));
  }

  // Every painted terrain must resolve in the palette, or the tile paints nothing.
  const unknownTerrain = [...new Set(getAllZones().map(z => z.flags?.terrain).filter(Boolean))]
    .filter(t => !palette?.terrains?.[t]);
  check('every painted terrain resolves in the palette', unknownTerrain.length === 0, unknownTerrain.join(', '));

  // AUTHORED BEATS DERIVED, ON EVERY TERRAIN. The palette supplies the fill a tile
  // has no opinion about, and gets out of the way the moment one does. This used to
  // be the other way round behind an `authored_bg_wins` exception list, which cost
  // 3,484 authored fills and 150 glyph colours — see
  // docs/proposals/tile-presentation-overrides.md. Asserted on synthetic tiles
  // rather than found ones, because the law has to hold for the terrain nobody has
  // painted an override onto YET; a found-tile check silently passes when the world
  // stops containing an example.
  const paintedNoOverride = getAllZones().find(z => z.flags?.terrain === 'redrock');
  if (paintedNoOverride) {
    check('a painted tile with no authored fill takes the palette fill',
      specOf(paintedNoOverride.id).fill === palette.terrains.redrock.fill,
      `${specOf(paintedNoOverride.id).fill} vs palette ${palette.terrains.redrock.fill}`);
  }
  const pinnedTile = { id: 'synthetic', flags: { terrain: 'redrock' }, bg_color: '#ff00ff', color: '#00ff00' };
  check('an authored fill beats the palette on a terrain that once ignored it',
    deriveColors(pinnedTile, palette).bg_color === '#ff00ff',
    deriveColors(pinnedTile, palette).bg_color);
  check('an authored glyph colour beats a terrain that dictates its own',
    deriveColors({ ...pinnedTile, flags: { terrain: 'road' } }, palette).color === '#00ff00',
    deriveColors({ ...pinnedTile, flags: { terrain: 'road' } }, palette).color);
  check('an authored marker survives painted ground',
    deriveLabel({ ...pinnedTile, marker: '⌂' }, palette)?.text === '⌂');
  check('no terrain hides a tile\'s own fill behind an exception flag',
    Object.values(palette.terrains).every(t => !('authored_bg_wins' in t)));

  // THE PACING BUG (spec §1.2). Pacing keyed off flags.icon matching /^road_/, so a
  // tile painted `road` with no authored icon moved you at walking pace. The painted
  // fact and the mechanical fact are the same fact now.
  const paintedRoadNoIcon = getAllZones().find(z =>
    z.flags?.terrain === 'road' && !/^(road_|runway_)/.test(z.flags?.icon || '') && !z.flags?.artery);
  // speed_mult moved from spec to props on 2026-07-30 — it is pacing, which is
  // gameplay, and spec is the render payload. Assert it left, so nothing quietly
  // starts reading a stale copy from both places.
  if (paintedRoadNoIcon) {
    check('a painted road with no authored icon carries the road speed-up',
      propsOf(paintedRoadNoIcon.id).speed_mult === 2,
      `${paintedRoadNoIcon.id} → ${propsOf(paintedRoadNoIcon.id).speed_mult}`);
  }
  check('a non-road terrain carries no speed-up',
    propsOf(getAllZones().find(z => z.flags?.terrain === 'redrock')?.id)?.speed_mult === 1);
  check('speed_mult no longer rides the render spec (one home, not two)',
    specOf(paintedRoadNoIcon?.id)?.speed_mult === undefined);

  // The step-1 loan, repaid: the resolved audio theme now lives in the table, and it
  // must agree with what resolveDefault would have said at the call site.
  const themed = getAllZones().filter(z => z.flags?.region_id).slice(0, 200);
  const themeMismatch = themed.filter(z =>
    renderOf(z.id).audio_theme_id !== resolveDefault('audio_theme_id', z, regionForZone(z)));
  check('the derived audio theme agrees with resolveDefault', themeMismatch.length === 0,
    themeMismatch.slice(0, 3).map(z => z.id).join(', '));
  check('zone_derived.ambient_theme is always present',
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
  // Sewer art USED to be derived here from the tile's own exits, and the id-prefix
  // test that selected for it is what made 34 room decorations undismissable. The
  // 117 corridor pieces are authored markers now (the 4 tiles with a way up carry ◍,
  // which no connectivity rule could have produced), so connectivity must derive
  // nothing at all — otherwise the special case is back under a new name.
  check('deriveMarker: connectivity derives nothing; sewer art is authored',
    mk({ id: 'zone_under_1_1', grid_z: -1, exits: { north: 'a', south: 'b' } }) === null
    && mk({ id: 'zone_under_1_1', grid_z: -1, marker: '║', exits: { north: 'a', south: 'b' } }) === '║');
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
  //
  // A sewer exemption used to sit here, carved out because `deriveMarker` fell
  // through to `sewerArt(zone.exits)` for any zone_under_ tile with no override —
  // so for those, derivation was the SOURCE rather than a reproduction of something
  // authored, and "nothing was invented" was the wrong question to ask. That
  // derivation is gone and so is the carve-out: the 117 corridor pieces are
  // authored markers now, which puts them back under the invariant where a glyph
  // contradicting the tile it sits on is caught like any other.
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

  // THIS BLOCK READS FILES, NOT THE LIVE WORLD — and that is the invariant, not a
  // convenience. The question these checks ask is "does the SHIPPED world agree
  // with itself": authored exits vs. the graph geometry projects from authored
  // coordinates. The live world is a different thing, because the engine is
  // *designed* to move it out from under this comparison:
  //
  //   • The Echelon SAILS. `zone_echelon_exterior.grid_x/grid_y` are runtime state
  //     (plugins/yacht) — so wherever she's moored, geometry projects four grid
  //     edges no authored `exits` will ever hold ("invents an exit"), and the
  //     walls authored around her home tile block geometry that has moved away
  //     ("blocks something geometry never projected").
  //   • Power SELF-HEALS. `createUtilityRoomWithJunctionBox` wires a building down
  //     into a utility room through `zone_exit_overrides` — deliberately a runtime
  //     table so a content re-deploy can't orphan the room (environment.js) — so
  //     the live zone carries a `down` the file does not ("loses an authored exit").
  //
  // Both are correct behaviour. Read against the live world, they are permanent
  // false reds on any database that has ever been played in or booted with an
  // unpowered building, which is every dev box and, on the right boot, CI. That
  // cost several hours and taught people to reach for `--no-verify`, which is the
  // real damage. Reading the files instead makes the checks say what they meant,
  // and makes them deterministic: same tree, same answer, on any database.
  const zoneDir = join(__dirname, '..', 'content', 'zones');
  // READ IN BATCHES, not one Promise.all over the whole tree. A single Promise.all
  // opens every zone file at once, and on Windows that throws EMFILE somewhere north
  // of ~10k descriptors: the Scarletwastes took content/zones/ from 6,098 files to
  // 10,934 and this line died on file 8,189, taking the whole suite with it after the
  // checks had already passed. The batch size is well under any platform's limit and
  // the wall-clock cost of serialising 55 batches is a rounding error next to boot.
  const zoneFiles = (await readdir(zoneDir)).filter(f => f.endsWith('.json'));
  const authoredZones = [];
  const READ_BATCH = 200;
  for (let i = 0; i < zoneFiles.length; i += READ_BATCH) {
    authoredZones.push(...await Promise.all(zoneFiles.slice(i, i + READ_BATCH)
      .map(async f => JSON.parse(await readFile(join(zoneDir, f), 'utf8')))));
  }
  check(`content/zones/ is populated (${authoredZones.length} files)`, authoredZones.length > 0);
  // The world still has to BE the content — a DB missing half the tree would
  // otherwise sail through a files-only comparison. Extra live zones are fine and
  // expected (transient void rooms, dreamscapes); missing ones never are.
  const liveIds = new Set(getAllZones().map(z => z.id));
  const notLoaded = authoredZones.filter(z => !liveIds.has(z.id));
  check('every authored zone is in the booted world', notLoaded.length === 0,
    `${notLoaded.length} missing, e.g. ${notLoaded.slice(0, 3).map(z => z.id).join(', ')} — run npm run content:import`);

  // Every connection file must be shaped so the build can act on it. A dangling
  // end is silently skipped by projectEdges, which is exactly why lint errors on
  // it — but the file's own fields have to hold up here too.
  const zoneIds = new Set(authoredZones.map(z => z.id));
  const badEnd = connections.filter(c => !zoneIds.has(c.a) || !zoneIds.has(c.b));
  check('every connection joins two real zones', badEnd.length === 0,
    badEnd.slice(0, 3).map(c => c.id).join(', '));
  const badDir = connections.filter(c => !c.dir || (!OPPOSITE[c.dir] && !c.one_way));
  check('every two-way connection uses a direction the build can reverse', badDir.length === 0,
    badDir.slice(0, 3).map(c => `${c.id}:${c.dir}`).join(', '));
  const dupIds = connections.length - new Set(connections.map(c => c.id)).size;
  check('connection ids are unique — a lock is keyed by one (§6)', dupIds === 0);

  const zonesForEdges = authoredZones.map(z => ({
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
  for (const z of authoredZones) {
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
  const shapeDrift = authoredZones.filter(z => norm(z.exits) !== norm(view.get(z.id)));
  check('zone_edges presents the same exits object the engine boots from', shapeDrift.length === 0,
    shapeDrift.slice(0, 3).map(z => z.id).join(', '));

  // And the table the build actually wrote — not just what derive would say now.
  // Edges that touch a VESSEL are left out of both sides: she is somewhere else
  // now than when derive last ran, and the four tiles alongside her hull are the
  // one part of this graph that is legitimately allowed to differ (see the note
  // at the top of this block). Everything else still has to match exactly, so a
  // genuinely stale table is still caught.
  const mobileIds = new Set(authoredZones.filter(z => z.flags?.vessel).map(z => z.id));
  const moors = (from, to) => mobileIds.has(from) || mobileIds.has(to);
  const writtenRows = await query('SELECT from_zone, direction, to_zone FROM zone_edges');
  const writtenSet = new Set(writtenRows.rows.filter(r => !moors(r.from_zone, r.to_zone))
    .map(r => `${r.from_zone}|${r.direction}|${r.to_zone}`));
  const derivedSet = new Set(edges.filter(e => !moors(e.from_zone, e.to_zone))
    .map(e => `${e.from_zone}|${e.direction}|${e.to_zone}`));
  const missingRows = [...derivedSet].filter(k => !writtenSet.has(k));
  const extraRows = [...writtenSet].filter(k => !derivedSet.has(k));
  check(`zone_edges is built (${writtenSet.size} rows)`, missingRows.length === 0 && extraRows.length === 0,
    `${missingRows.length} missing / ${extraRows.length} extra — run npm run map:derive`
    + (missingRows.length ? ` — e.g. ${missingRows[0]}` : '')
    + (extraRows.length ? ` — e.g. ${extraRows[0]}` : ''));
}

// LAW: YOU LEAVE THE CITY THROUGH A GATE, OR YOU DO NOT LEAVE IT.
// The city↔wilds curtain used to be `crossesCurtain` in derive.mjs, keyed on
// `flags.district === 'wilds'` — a presentation field the Studio paints. Erasing a
// district on a frontier tile deleted a wall, produced no diff (the wall was never
// a file), and looked like nothing at all on the map, because missing ground-level
// wall reads exactly like ground. What a player got for it was the waste without
// The South Gate: no gate warning, no wanted/contraband check coming back, and
// death out there with no clone-vat.
//
// It is 133 authored walls now (scripts/content/mint-curtain-walls.mjs). The files
// are lint's business; THIS is the world you can actually walk, asserted against
// the booted engine — and it is deliberately independent of `zones.exits`, because
// the agreement gate above dies at the §5 cutover and this must not die with it.
{
  const isWilds = (z) => z?.flags?.district === 'wilds';
  const crossings = [];
  for (const z of getAllZones()) {
    for (const [dir, v] of Object.entries(z.exits || {})) {
      for (const t of (Array.isArray(v) ? v : [v])) {
        if (!t) continue;
        const far = getZone(t);
        if (!far || isWilds(z) === isWilds(far)) continue;
        // An authored connection is somebody DECIDING to open a hole, which is
        // what a gate is. Geometry deciding it is the bug.
        const conn = getConnectionBetween(z.id, t);
        crossings.push({ from: z.id, dir, to: t, gated: !!conn && !conn.blocked });
      }
    }
  }
  const ungated = crossings.filter(c => !c.gated);
  check('no step crosses the city↔wilds curtain except through an authored gate',
    ungated.length === 0,
    ungated.slice(0, 3).map(c => `${c.from} —${c.dir}→ ${c.to}`).join(' | '));

  // Positive control. An empty crossing list would satisfy the check above while
  // meaning the gate had been walled up and the wilds made unreachable on foot —
  // which is the same map defect wearing the opposite sign.
  check(`the curtain is pierced, and only at the gate (${crossings.length} crossing(s))`,
    crossings.length === 2 && crossings.every(c => c.from === 'zone_district_918_919' || c.to === 'zone_district_918_919'),
    crossings.map(c => `${c.from} —${c.dir}→ ${c.to}`).join(' | '));
}

// LAW: A MAP HANGS OFF ONE WORLD TILE, AND ONLY THE MAP SAYS WHICH.
// `maps.parent_zone_id` is the single place a map's anchor is decided; the copy
// every tile carries in `parent_zone` (and in `flags.world_exit_zone`, where it
// has one) is a cache of it, not a second opinion. Asserted against the BOOTED
// world rather than the files, because that is what the engine actually reads.
//
// It was not always true, and the failure is silent: `zones.parent_zone` was
// carrying the containing ROOM on 154 tiles across 12 hand-built maps (Halcyon's
// Elevator named its own Grand Lobby) while every runtime reader —
// flight/acquisition.js and three sites in engine/environment.js — resolves
// `flags.world_exit_zone || parent_zone` expecting a WORLD tile. Three utility
// rooms had additionally kept the address their building stood at before it
// moved. Every one of those ids resolves, so nothing could ever notice.
{
  const zones = [...world.zones.values()];
  const anchorBad = [];
  for (const z of zones) {
    if (!z.map_id) continue;                       // off-map rooms own their own parent_zone
    const m = world.maps.get(z.map_id);
    if (!m) continue;                              // dangling map_id is the FK check's job
    const want = m.parent_zone_id ?? null;
    if ((z.parent_zone ?? null) !== want) anchorBad.push(`${z.id} parent_zone=${z.parent_zone ?? 'null'} want ${want ?? 'null'}`);
    const wez = z.flags?.world_exit_zone ?? null;
    // On a FACADE the flag means the street out front, which the map does not own.
    if (want != null && !z.flags?.facade && wez != null && wez !== want) {
      anchorBad.push(`${z.id} world_exit_zone=${wez} want ${want}`);
    }
  }
  check(`every tile agrees with its map's anchor (${zones.filter(z => z.map_id).length} placed tiles)`,
    anchorBad.length === 0, anchorBad.slice(0, 3).join('; ')
    + (anchorBad.length ? ' — run node scripts/content/sync-map-anchors.mjs' : ''));

  // An interior map takes its name from the building it hangs off unless it
  // authors an override, so the two can never disagree the way 17 of them did.
  const unnamed = [...world.maps.values()].filter(m => !String(m.name || '').trim());
  check(`every map resolves to a name (${world.maps.size} maps)`, unnamed.length === 0,
    unnamed.slice(0, 3).map(m => m.id).join(', '));

  const anchoredOnItself = [...world.maps.values()].filter(m => m.parent_zone_id
    && world.zones.get(m.parent_zone_id)?.map_id === m.id);
  check('no map is anchored on one of its own tiles', anchoredOnItself.length === 0,
    anchoredOnItself.map(m => m.id).join(', '));

  // LAW: EVERY MAP HAS A WAY IN. A seam is an exit whose far end is on a different
  // map — the same thing projectEdges labels `kind: 'portal'` and the Studio draws.
  // A map with none is a map a player can only be teleported into, which is fine
  // when that is the design and a defect when it is an oversight. So the two that
  // legitimately have none are NAMED here: a map that joins them has to say so out
  // loud rather than quietly becoming unreachable.
  const NO_WALK_IN = new Set([
    'map_dream',                // entered by sleeping — plugins/dreams, never on foot
    'map_aircraft_leviathan',   // entered by boarding — the cabin has no ground seam
  ]);
  const withSeam = new Set();
  for (const z of world.zones.values()) {
    if (!z.map_id) continue;
    for (const target of Object.values(z.exits || {}).flat()) {
      const t = world.zones.get(target);
      if (t && (t.map_id || null) !== z.map_id) { withSeam.add(z.map_id); break; }
    }
  }
  const stranded = [...world.maps.keys()].filter(id => !withSeam.has(id) && !NO_WALK_IN.has(id));
  check(`every map can be walked into (${withSeam.size}/${world.maps.size} have a seam)`,
    stranded.length === 0,
    stranded.join(', ') + (stranded.length ? ' — add a connection, or name it in NO_WALK_IN with the reason' : ''));
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

  // The map's anchor is edited on the MAP and pushed, never typed per tile — and
  // the rule comes from the same module lint and the fixer use, so the tool cannot
  // hold a private opinion about what "anchored" means.
  check('the Studio pushes the map anchor from the shared invariant module',
    /from '\.\.\/\.\.\/scripts\/content\/map-anchor\.mjs'/.test(serve) && /applyAnchor/.test(serve));
  check('the Studio locks the map-owned anchor on the tile inspector',
    /lockedFieldHtml/.test(client) && /parent_zone/.test(client));

  // A seam is marked because the BUILD called it one. The moment this tool decides
  // for itself what a warp looks like — a facade here, a hatch there — the marking
  // stops being complete and starts being a list somebody has to remember to grow.
  check('the Studio marks the seams the build projected, not ones it recognises',
    /kind !== 'portal'/.test(serve) && /body\.portals/.test(client));
  // ONE SPATIAL MARK PER TILE. A facade's authored door and its seam direction are
  // opposite by construction on 60 of 62, so drawing both puts two marks on one tile
  // disagreeing about which way through — §2.3's failure at the presentation layer.
  // The bar is also why it is a bar: an arrow would point at the innocent neighbour.
  //
  // Scoped to drawPortal rather than the whole file. It used to assert the client
  // held no `ctx.moveTo` at all, as a proxy for "nothing here draws an arrow" — a
  // proxy that stopped being true the moment roads auto-tiled, because a lane from
  // the tile centre to a connected edge is a stroked path and has every right to be.
  // The invariant was always about the SEAM mark, so that is what it reads now.
  const portalFn = (client.match(/function drawPortal\([\s\S]*?\n\}/) || [''])[0];
  check('the Studio bars one edge, and the authored door wins it',
    /const BAR = \{/.test(client) && /authoredDoor/.test(client)
    && portalFn.length > 0 && !/(moveTo|lineTo)/.test(portalFn));
  // The tile stack, drawn from the spec and nowhere else. `spec.label` is present iff
  // a code means something there, so this file no longer holds the rule about which
  // tiles wear lettering — holding it wrongly is what stamped `#` across grasslands
  // the game renders as grass.
  check('the Studio draws the layers the spec declares, deciding neither',
    /spec\.feature/.test(client) && /spec\.label/.test(client)
    && !/\.marker\b/.test(client.slice(client.indexOf('function draw('), client.indexOf('// ── Input'))));
  // ONE LAYER PER TILE, and a switch between them. 61 world tiles carry a footprint
  // SVG AND a code, and the Studio used to stamp the letters over the middle of the
  // rooftop — a combination no screen in the game renders, because the graphic and
  // the code are two ways of saying the same tile. The overlay mode is the game's
  // own (minimap.js `avenueOverlay`), so the feature draw has to be gated on it.
  const drawFn = client.slice(client.indexOf('function draw('), client.indexOf('// ── Input'));
  check('the Studio shows a tile\'s art or its lettering, never both',
    /state\.overlay/.test(client) && /lettersWin/.test(drawFn)
    && /if \(spec\.feature && !lettersWin\)/.test(drawFn));
  // And the feature is THE GAME'S OWN ASSET, rasterised. An earlier pass hand-drew the
  // road lanes to match the SVGs by eye: correct that day, drift the day someone edits
  // road_ns.svg. No piece name may appear in this file — the build supplies it.
  check('the Studio rasterises the game\'s zone-icon asset, not an impression of it',
    /zone-icons\//.test(client) && /drawImage/.test(client) && !/road_[nesw]/.test(client));
  // A paint stroke changes the LOOK of the ring around it, so the response has to
  // carry that ring — otherwise a new lane meets an old one that still thinks it is
  // a dead end, until you reload the map.
  check('a paint response carries the tiles whose art the stroke changed',
    /orthoNeighbours/.test(serve) && /touched\.add/.test(serve));

  // One floor at a time. 273 cells on this world hold more than one tile, so a
  // stacked draw hides tiles under tiles and a click can only ever reach z=0.
  check('the Studio draws and hit-tests one floor at a time',
    /onFloor/.test(client) && /,\$\{state\.z\}/.test(client));

  // No hex literals in the client: a colour written here is a colour the build did
  // not produce. The CSS lives in index.html, which is chrome, not map paint.
  // #8ab4ff is the seam outline — chrome, and declared as --seam next to the rest of it.
  const hexes = [...client.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0])
    .filter(h => !['#0e0f12', '#c8c8cc', '#1a1c21', '#6ee7d0', '#ffd479', '#8ab4ff'].includes(h));
  check('the Studio client paints no colour of its own invention', hexes.length === 0, hexes.join(', '));
  check('the Studio client owns no terrain palette',
    !/TERRAIN_FILL|luminanceTextColor|terrains\s*:\s*\{/.test(client));

  // No database in the process at all — that is the whole claim of §10.
  check('no database can be reached from the Studio',
    !/models\/db\.js|from 'pg'|require\('pg'\)/.test(serve + client));

  // DISTRICTS ARE PAINTED, NOT TYPED. The tile inspector used to render
  // flags.district as a free-text box holding a key that had to match a district
  // exactly, with nothing checking it did — so a typo read as "unclassified" and
  // looked identical to a blank tile. The district view assigns it from a list of
  // the districts that exist; the tile still SAYS which one it is in. `terrain`
  // is skipped beside it for the same reason and by the same line: the brushes
  // paint it, and offering it on the form hands back the box the form took away.
  check('the Studio paints a tile\'s district rather than typing it',
    /'\/api\/assign'/.test(serve) && /assignDistrict/.test(serve)
    && /key === 'district' \|\| key === 'terrain'\) continue/.test(client)
    && /districtLine/.test(client));
  // And the district form comes from the catalog, exactly as the tile form does.
  check('the Studio builds its district form from the field catalog',
    /districtColumnCatalog/.test(serve) && /districtCatalog/.test(client));

  // A SAVE AND AN EXPORT MUST PRODUCE THE SAME BYTES, which is what makes a no-op
  // save a no-op diff and a terrain paint a one-line one. The rule that decides it
  // is the registry's omitWhenNull, and this file used to carry a hand-typed copy
  // (`k === 'audio_theme_id' || k === 'marker'`) — so adding a third omitted column
  // to the registry would have made every subsequent no-op save write an explicit
  // null the exporter omits, and nobody would have noticed until the diffs grew.
  // Matched on the old CODE's shape (`if (v === null && (k === 'audio_theme_id'`)
  // rather than on the column name, which still appears in the comment explaining
  // why this check exists — the first version of this check failed on that prose.
  check('the Studio reads omitWhenNull from the registry rather than retyping it',
    /contentEntries\(\)/.test(serve) && /omitWhenNull/.test(serve)
    && !/v === null && \(k ===/.test(serve));

  // Writes land whole, and never over somebody else's. The Studio is not the only
  // writer of content/ (a git pull, sync-map-anchors, the dev-panel save-hook, a
  // hand edit), and it reads the tree once at boot — so a save has to compare the
  // file it is replacing against the one it read, or it silently discards their work.
  check('the Studio renames writes into place rather than truncating a live file',
    /\.tmp-\$\{process\.pid\}/.test(serve) && /await rename\(/.test(serve));
  check('the Studio refuses to overwrite a file that changed under it',
    /function conflictOf/.test(serve) && /stamps\.get/.test(serve));
  // And the multi-file one is all-or-nothing: it used to write the map, push the
  // anchor tile by tile, and return 200 with `failed` for the ones that didn't.
  check('a map save validates every file it would touch before writing any',
    /objections/.test(serve) && !/failed\.push/.test(serve) && !/body\.failed/.test(client));

  // UNDO IS A FILE OPERATION. Every edit in the Studio is on disk before the gesture
  // is finished — there is no unsaved buffer — so a client-side undo would be
  // apologising for writes it cannot see and could not survive a reload. The journal
  // records at writeRow(), the ONE funnel every write goes through, which is the only
  // reason it is complete: a map save pushing its anchor onto 331 tiles is one entry
  // without the log knowing what an anchor push is.
  check('the Studio journals undo where the writes happen, not in the client',
    /function record\(table, id, after\)/.test(serve) && /record\(table, id, obj\);/.test(serve)
    // The client half is asserted as "no PERSISTED undo state", not "no localStorage at
    // all" — the Studio runs on its own port and cannot read the dev panel's stored theme,
    // so it keeps its own, and a colour preference is not an edit buffer. The original
    // blanket ban went red the day the theme toggle landed, for a line that has nothing to
    // do with undo.
    && !/localStorage[^;\n]*(undo|redo|journal|history|entries)/i.test(client));
  // Both sides of every file, so reverting is the same write in the other direction
  // rather than a per-operation inverse (un-paint, un-assign) with its own bugs.
  check('an undo entry keeps the whole row from both sides',
    /before: tree\[table\]\?\.get\(id\) \?\? null, after/.test(serve));
  // LIFO is what makes it sound without a dependency graph: the newest entry is by
  // construction the last writer of every file it touched. Anything else wrote it and
  // conflictOf catches that — the same check a save makes, refusing whole.
  check('an undo refuses rather than reverting over somebody else\'s write',
    /async function applyEntry/.test(serve) && /conflictOf\(f\.table, f\.id\)/.test(serve)
    && /nothing was written/.test(serve));
  // AS IF IT WERE A FRESH PAINT. derive is whole-map by contract, so the cache is
  // dropped and the world re-derived from the files that now exist — there is no
  // second render path through "undo" to disagree with the build.
  const applyFn = (serve.match(/async function applyEntry[\s\S]*?\n\}/) || [''])[0];
  check('an undo re-derives the world rather than patching the tiles it knows about',
    /derived = null;/.test(applyFn) && /reloadOpenMap/.test(client)
    && /'\/api\/undo'/.test(client) && /'\/api\/redo'/.test(client));
  check('the action log holds 20 actions deep', /const JOURNAL_MAX = 20;/.test(serve));

  // MOVING AND TURNING A BUILDING ARE THE PLANNER'S RULES, NOT THIS TOOL'S. Same
  // argument as the palette and the field catalog: the moment the Studio holds its
  // own idea of what a quarter turn does, it is a second opinion about content the
  // build has to agree with, and `npm run test:regress` below drives the planner
  // directly with no server in the room.
  check('the Studio moves and turns through the shared planner',
    /from '\.\.\/\.\.\/scripts\/content\/transform\.mjs'/.test(serve)
    && /planMove/.test(serve) && /planRotate/.test(serve));
  check('the Studio client computes no direction algebra of its own',
    !/rotateDir|rotatePoint|northeast'\s*,/.test(client));
  // ONE GESTURE IS ONE ENTRY, however many files it turned into — a move rewrites a
  // dozen for a small building and eighty for the Yards tenement, and taking that
  // back has to be one Ctrl+Z rather than eighty.
  check('a structural change is one journal action', /action\(plan\.label/.test(serve));
  // And it is all-or-nothing, the shape saveMap already keeps: every file validated
  // and conflict-checked before any is written.
  const applyPlanFn = (serve.match(/async function applyPlan[\s\S]*?\n\}/) || [''])[0];
  check('a move validates and conflict-checks every file before writing any',
    /objections/.test(applyPlanFn) && /conflictOf/.test(applyPlanFn)
    && /nothing was written/.test(applyPlanFn)
    && applyPlanFn.indexOf('objections.length') < applyPlanFn.indexOf('await writeRow'));
  // A PLAN WRITES NOTHING. The panel lists what would land because it is the same
  // call the commit makes — not a description maintained beside the thing it describes.
  const planRoute = (serve.match(/path === '\/api\/move-plan'\)[\s\S]*?\n    \}/) || [''])[0];
  check('a move plan writes nothing', planRoute.length > 0
    && !/writeRow|applyPlan|action\(/.test(planRoute));
  // power_zones is per-CELL: its id IS the zone id and its row says which grid feeds
  // that tile. A building that dragged it along would take the street's power with it.
  const tablesDecl = (serve.match(/const TABLES = \[[\s\S]*?\];/) || [''])[0];
  check('the Studio never opens power_zones, so a move cannot take one with it',
    tablesDecl.length > 0 && !/power_zones/.test(tablesDecl));

  // THE THREAT VIEW READS AND NEVER WRITES. It is the one view showing content the
  // Studio does not edit — spawns and the enemies they name — and the moment it
  // grows a write path it is authoring monsters through a map editor, with no
  // field catalog and no validation behind it. Pinned as an absence.
  const threatFn = (serve.match(/function threatView[\s\S]*?\n\}/) || [''])[0];
  check('the threat view writes nothing', threatFn.length > 0
    && !/writeRow|action\(|saveZone/.test(threatFn)
    && !/'\/api\/threat'[\s\S]{0,400}?writeRow/.test(serve));
  // A ROOM INSIDE A BUILDING HAS NO TILE. Its spawns are authored against a zone on
  // an interior map, so on the world map — the map you look at to ask where the
  // danger is — they would be invisible. They fold up onto the facade you enter
  // through, walking nested maps, which is the same rule the dev panel's Spawn Map
  // established and the only reason the world map's heat is honest.
  check('interior spawns fold onto the tile you enter them through',
    /function tileFor/.test(serve) && /parent_zone_id/.test(threatFn + serve)
    && /inside: zoneId !== t\.id/.test(serve));
  // And the score is one function in one place. Two tools disagreeing about which
  // end of town is worse is worse than either being wrong.
  check('the threat score is the server\'s, not a second copy in the client',
    /function enemyThreat/.test(serve) && !/hp_max/.test(client));
}

// LAW: a building moves and turns WHOLE, and neither can author what the gate rejects.
// Driven against the real content tree with no server and no database — the planners
// are pure, which is the entire reason they live in scripts/content/ beside derive.
{
  const { readContentTree, canonicalJson } = await import('../scripts/content/lib.mjs');
  const { planRotate, planMove, rotateDir, rotatePoint } = await import('../scripts/content/transform.mjs');

  const tree = {};
  for (const { entry, files } of readContentTree().entries) {
    tree[entry.table] = new Map(files.map(f => [f.data.id, f.data]));
  }
  const facades = [...tree.zones.values()].filter(z => z.flags?.facade);
  const apply = (t, writes) => {
    const next = {};
    for (const [k, v] of Object.entries(t)) next[k] = new Map(v);
    for (const w of writes) next[w.table].set(w.id, w.row);
    return next;
  };
  const driftFrom = (t) => {
    const out = [];
    for (const table of Object.keys(tree)) {
      for (const [id, row] of t[table]) {
        if (canonicalJson(row) !== canonicalJson(tree[table].get(id))) out.push(`${table}/${id}`);
      }
    }
    return out;
  };

  // NORTH IS y−1, so clockwise is (x, y) → (−y, x). Get this backwards and every
  // interior turns the wrong way while every exit key turns the right way — a
  // building whose rooms disagree with its own doors.
  check('a quarter turn moves north to east and takes the diagonals with it',
    rotateDir('north', 1) === 'east' && rotateDir('east', 1) === 'south'
    && rotateDir('northeast', 1) === 'southeast' && rotateDir('north', -1) === 'west');
  check('a quarter turn leaves up, down, in and out alone',
    ['up', 'down', 'in', 'out'].every(d => rotateDir(d, 1) === d));
  check('the grid turns the same way the compass does',
    String(rotatePoint(0, -1, 1)) === '1,0' && String(rotatePoint(1, -1, 1)) === '1,1');
  check('four quarter turns is no turn at all',
    ['north', 'northeast', 'west', 'up'].every(d => rotateDir(d, 4) === d));

  // TURNING BACK IS BYTE-FOR-BYTE THE SAME BUILDING. The strongest property the
  // planner has: it says the geometry, the exit keys, the connection directions, the
  // front door and the camera all turn together and reversibly. A partial turn —
  // exits without coordinates, or the facade without its interior — shows up here as
  // a file that did not come home.
  let turned = 0; const notHome = [];
  for (const f of facades) {
    for (const k of [1, -1]) {
      const out = planRotate(tree, f.id, k);
      if (out.errors.length) continue;
      const back = planRotate(apply(tree, out.writes), f.id, -k);
      if (back.errors.length) { notHome.push(`${f.id}: cannot turn back — ${back.errors[0]}`); continue; }
      turned++;
      const d = driftFrom(apply(apply(tree, out.writes), back.writes));
      if (d.length) notHome.push(`${f.id} (${k > 0 ? 'cw' : 'ccw'}): ${d.slice(0, 4).join(', ')}`);
    }
  }
  check(`turning a building back leaves the same bytes (${turned} turns)`,
    turned > 0 && notHome.length === 0, notHome.slice(0, 6).join(' | '));

  // A DOOR OPENS ONTO A STREET OR IT IS REFUSED. This is the rule that makes the
  // facade rule in derive.mjs meaningful: a facade opens at flags.entrance and
  // nowhere else, so an entrance pointed at another building is a building with no
  // way in that still looks enterable on the map.
  const intoWall = [];
  for (const f of facades) {
    for (const k of [1, 2, 3]) {
      const p = planRotate(tree, f.id, k);
      if (p.errors.length) continue;
      const w = p.writes.find(x => x.table === 'zones' && x.id === f.id);
      const street = tree.zones.get(w.row.flags.world_exit_zone);
      const blocked = !street || street.flags?.facade || street.flags?.is_building
        || street.flags?.is_interior || street.flags?.terrain === 'water' || street.flags?.water;
      if (blocked) intoWall.push(`${f.id} → ${w.row.flags.entrance} onto ${w.row.flags.world_exit_zone}`);
      // The zone's identity and its floor are not what a turn is about.
      if (w.row.id !== f.id || (w.row.grid_z ?? 0) !== (f.grid_z ?? 0)) intoWall.push(`${f.id}: a turn moved its id or its floor`);
    }
  }
  check('no turn ever opens a door onto a wall or water', intoWall.length === 0, intoWall.slice(0, 5).join(' | '));

  // MOVING NEVER TOUCHES A COORDINATE. A world-map zone id encodes its own position
  // (`zone_district_<x>_<y>`, 58 of the 62 facades), and map-audit GEO-1 calls a
  // coord/id disagreement the signature of a botched move — then refuses to run its
  // other fixers over the tile. The identity swap is what keeps every id true.
  const moved = [];
  let planned = 0;
  const OFF = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  for (const f of facades) {
    for (const [, [dx, dy]] of Object.entries(OFF)) {
      const p = planMove(tree, f.id, f.grid_x + dx * 2, f.grid_y + dy * 2);
      if (p.errors.length) continue;
      planned++;
      for (const w of p.writes.filter(x => x.table === 'zones')) {
        const was = tree.zones.get(w.id);
        if (w.row.grid_x !== was.grid_x || w.row.grid_y !== was.grid_y || (w.row.grid_z ?? 0) !== (was.grid_z ?? 0)) {
          moved.push(`${f.id}: ${w.id} changed coordinates`);
        }
        if (w.row.id !== was.id) moved.push(`${f.id}: ${w.id} changed id`);
      }
      if (p.writes.some(w => w.table === 'power_zones')) moved.push(`${f.id}: a move wrote a power_zones row`);
      // THE DOOR DOES NOT MOVE ITSELF (world.js:190 — inferring it relocated Pawn &
      // Pity's off Marrow Street). Turning is the only thing allowed to.
      const landed = p.writes.find(w => w.table === 'zones' && w.id === p.facadeId);
      if (landed.row.flags.entrance !== f.flags.entrance) moved.push(`${f.id}: a move turned the door`);
      // Exactly one interior map still hangs off exactly one facade — the dup-map
      // state regress hard-fails elsewhere, reached here by a tool rather than by hand.
      const maps = p.writes.filter(w => w.table === 'maps');
      if (maps.some(m => m.row.parent_zone_id !== p.facadeId)) moved.push(`${f.id}: an interior map was left on the old cell`);
      break;
    }
  }
  check(`moving a building changes no coordinate, no id and no door (${planned} moves planned)`,
    planned > 0 && moved.length === 0, moved.slice(0, 6).join(' | '));

  // The two refusals that stop the Studio authoring something the gate rejects.
  const ontoBuilding = [], ontoOccupied = [];
  for (const f of facades) {
    for (const [, [dx, dy]] of Object.entries(OFF)) {
      const target = [...tree.zones.values()].find(z => z.map_id === f.map_id
        && z.grid_x === f.grid_x + dx && z.grid_y === f.grid_y + dy && (z.grid_z ?? 0) === (f.grid_z ?? 0));
      if (!target?.flags?.facade) continue;
      const p = planMove(tree, f.id, target.grid_x, target.grid_y);
      if (!p.errors.some(e => /already a building/.test(e))) ontoBuilding.push(`${f.id} → ${target.id}`);
    }
  }
  check('a building cannot be moved onto another building',
    ontoBuilding.length === 0, ontoBuilding.slice(0, 5).join(' | '));

  // A facade is not standable, so anything left on the cell is sealed inside a
  // building nobody can enter — and nothing else in the pipeline reports it.
  const withStuff = [...tree.zones.values()].filter(z => z.map_id === 'map_world'
    && !z.flags?.facade && !z.flags?.is_building
    && [...tree.furniture.values()].some(fu => fu.zone_id === z.id));
  for (const z of withStuff.slice(0, 12)) {
    const near = facades.find(f => f.map_id === z.map_id
      && Math.abs(f.grid_x - z.grid_x) + Math.abs(f.grid_y - z.grid_y) <= 3);
    if (!near) continue;
    const p = planMove(tree, near.id, z.grid_x, z.grid_y);
    if (!p.errors.some(e => /standing on it/.test(e))) ontoOccupied.push(`${near.id} → ${z.id}`);
  }
  check('a building cannot be moved onto a cell something is standing on',
    ontoOccupied.length === 0, ontoOccupied.slice(0, 5).join(' | '));
}

// LAW: content-store's SCHEMA_SQL parse still finds columns.
// It reads the schema by regex — including the four-space column indent — and an
// empty result does not throw: it downgrades every jsonb column to a pass-through
// string, so anything that walks one (an exits graph, a flags lookup) sees
// characters instead of keys. A reformat of SCHEMA_SQL is the realistic cause.
{
  const { columnTypesOf } = await import('../tools/lib/content-store.mjs');
  const zoneTypes = columnTypesOf('zones');
  check(`content-store reads zone column types from SCHEMA_SQL (${zoneTypes.size} columns)`,
    zoneTypes.size > 10);
  check('content-store reads a jsonb column as jsonb, not as its default clause',
    zoneTypes.get('flags') === 'jsonb' && zoneTypes.get('exits') === 'jsonb',
    `flags=${zoneTypes.get('flags')} exits=${zoneTypes.get('exits')}`);
}

// LAW: DISTRICT DEFINITIONS ARE CONTENT, NOT CODE (and there is only one copy).
// They were a 240-line literal in server/engine/districts.js — names, colours and
// pools of prose that could only be changed by editing engine source — and the
// client kept a hand-maintained mirror of the colours that had gone four districts
// stale, so the 3,471-tile Wilds drew nothing on the regional map.
{
  const districts = await readFile(join(__dirname, '..', 'server', 'engine', 'districts.js'), 'utf8');
  const minimap = await readFile(join(__dirname, '..', 'client', 'game', 'js', 'panels', 'minimap.js'), 'utf8');

  check('the district registry holds no authored prose of its own',
    /export const DISTRICTS = \{\}/.test(districts) && /loadDistricts/.test(districts));
  // The one thing a boot-loaded registry must not do: reach for the DB on a path
  // that runs per move. districtFor() is sync by contract.
  check('districtFor stays sync and query-free',
    !/await|query\(/.test(districts) && /export function districtFor/.test(districts));
  check('the client legend is served, not written into the client',
    /export const FUNC_LEGEND = \{\}/.test(minimap) && /setDistrictLegend/.test(minimap));

  // Every district a tile claims must exist, or the tile silently reads as the
  // engine default while looking assigned in every tool.
  const { rows: dRows } = await query('SELECT id FROM districts').catch(() => ({ rows: [] }));
  const known = new Set(dRows.map(r => r.id));
  check(`districts load from the content table (${known.size})`, known.size > 0);
  const claimed = new Map();
  for (const z of world.zones.values()) {
    const d = z.flags?.district;
    if (d) claimed.set(d, (claimed.get(d) || 0) + 1);
  }
  const orphan = [...claimed.keys()].filter(d => !known.has(d));
  check('every district a tile claims exists', orphan.length === 0,
    orphan.map(d => `${d} (${claimed.get(d)} tiles)`).join(', '));
  // The prefix rung has to stay unambiguous: two districts claiming one prefix
  // would resolve by whichever loaded last.
  const seen = new Map();
  const dupes = [];
  const { rows: pRows } = await query('SELECT id, prefixes FROM districts').catch(() => ({ rows: [] }));
  for (const r of pRows) {
    for (const p of Array.isArray(r.prefixes) ? r.prefixes : []) {
      if (seen.has(p)) dupes.push(`${p}: ${seen.get(p)} and ${r.id}`);
      seen.set(p, r.id);
    }
  }
  check('no zone-id prefix is claimed by two districts', dupes.length === 0, dupes.join('; '));
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
  const { zoneDanger, zoneThreat, enemyThreat, bucketThreat, DANGER_RANK } = await import('../server/engine/danger.js');
  const { computeZoneThreat, removeSpawn } = await import('../server/engine/world.js');
  const p = getPlayer();
  const homeZone = world.zones.get(p.current_zone);
  const savedScore = homeZone._threatScore;

  check('enemyThreat scales with hp + damage',
    enemyThreat({ hp_max: 100, weapon: [{ min: 10, max: 20 }] }) === 220);
  check('bucketThreat rank order holds',
    bucketThreat(20) === 'low' && bucketThreat(70) === 'medium' && bucketThreat(120) === 'high' && bucketThreat(220) === 'lethal');
  check('danger tag override wins', zoneDanger({ flags: { danger: 'lethal' }, _threatScore: 20 }) === 'lethal');
  check('sanctuary forces safe', zoneDanger({ flags: { sanctuary: true }, _threatScore: 120 }) === 'safe');
  check('radiation floors danger (lethal at 40+)', zoneDanger({ flags: { radiation: 45 }, _threatScore: 20 }) === 'lethal');
  check('threat cache buckets at read time', zoneDanger({ flags: {}, _threatScore: 70 }) === 'medium');

  // A zero/absent score is 'safe', NOT bucketThreat(0) === 'low'. This is the
  // no-spawns case, and it used to be carried by a separate hasSpawn flag.
  check('no spawns reads safe, not low', zoneDanger({ flags: {}, _threatScore: 0 }) === 'safe');
  check('absent cache reads safe', zoneDanger({ flags: {} }) === 'safe');

  // zoneThreat exposes the raw number and ignores the band overrides.
  check('zoneThreat returns the raw score', zoneThreat({ _threatScore: 137 }) === 137);
  check('zoneThreat floors at 0', zoneThreat({}) === 0 && zoneThreat(null) === 0);

  // Cache recompute: a synthetic beefy spawn raises the zone; removing it recomputes.
  try {
    const synthId = 'regress_danger_spawn';
    world.spawnTimers.set(synthId, { spawn_id: synthId, zone_id: homeZone.id, hp_max: 100, weapon: [{ min: 10, max: 20 }], max_count: 0, spawn_weight: 0, respawn_seconds: 9999, nextSpawn: Number.MAX_SAFE_INTEGER });
    computeZoneThreat(homeZone.id);
    // The raw score only — NOT zoneDanger(homeZone), which a sanctuary tag or a
    // danger override on the spawn room would legitimately pull off 'lethal'.
    check('computeZoneThreat caches the raw score from spawns', homeZone._threatScore === 220, homeZone._threatScore);
    removeSpawn(synthId);
    check('removeSpawn recomputes the zone threat', homeZone._threatScore !== 220, homeZone._threatScore);
  } finally {
    world.spawnTimers.delete('regress_danger_spawn');
    homeZone._threatScore = savedScore;
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

// ── Wear splits a stack ──────────────────────────────────────────────────────
// `condition` is a column, so a merge used to keep one row's condition and throw
// the other's away. A row that has taken any wear is now its own object forever.
{
  const { rowIsMergeable, MERGEABLE_SQL, NOT_INSTANCED_SQL } =
    await import('../server/engine/inventory.js');

  check('an untouched row still merges', rowIsMergeable({ condition: 1 }) === true);
  check('a row with no condition at all merges (legacy rows)', rowIsMergeable({}) === true);
  check('a worn row never merges', rowIsMergeable({ condition: 0.83 }) === false);
  check('a nearly-pristine row is still its own object',
    rowIsMergeable({ condition: 0.97 }) === false);
  check('the instance-key rule still applies on top',
    rowIsMergeable({ condition: 1, custom_data: { cook_quality: 'masterful' } }) === false);
  check('MERGEABLE_SQL keeps the whole instance-key predicate',
    MERGEABLE_SQL.startsWith(NOT_INSTANCED_SQL), MERGEABLE_SQL);
  check('MERGEABLE_SQL guards the condition column', MERGEABLE_SQL.includes('condition'), MERGEABLE_SQL);
}

// ── What a container is FOR ──────────────────────────────────────────────────
// A fridge is not a cupboard. The kind of thing a box takes is DERIVED from the
// flags it already carries for other reasons, and it narrows the panel's stow
// column and a bare `stow all` — never an item the player named themselves.
{
  const { containerFilter } = await import('../server/engine/commands/inventory.js');
  const box = tags => ({ id: 'x', kind: 'furniture', tags });
  const row = tags => ({ tags });

  check('an ordinary crate filters nothing', containerFilter(box({ container: 5000 })) === null);
  check('a shop display case is the vendor\'s business, not the engine\'s',
    containerFilter(box({ preserves: 'cold', vendor_stock: 'npc_x' })) === null);

  const fridge = containerFilter(box({ preserves: 'cold' }));
  check('a cold box takes what spoils', !!fridge?.test(row({ perishable: true })));
  check('a cold box does not propose your pistol', fridge?.test(row({ weapon: true })) === false);

  const cabinet = containerFilter(box({ dish_cabinet: true }));
  check('a dish cabinet takes a pot', !!cabinet?.test(row({ vessel: true })));
  check('a dish cabinet takes a fork', !!cabinet?.test(row({ utensil: true })));
  check('a dish cabinet does not take a steak', cabinet?.test(row({ perishable: true })) === false);

  const wardrobe = containerFilter(box({ wardrobe: true }));
  check('a wardrobe takes what has a body slot', !!wardrobe?.test(row({ slot: 'torso' })));
  check('a wardrobe does not take a wrench', wardrobe?.test(row({ tool: true })) === false);
}

// ── Item facets: the shelf-sectioning substrate ──────────────────────────────
// server/engine/classify.js decides whether a list of items sections itself and
// along which axis. Pure functions over tags, so this is fixture-driven — no DB,
// no world. The failure modes it exists to prevent are all "the list got worse":
// sections nobody asked for, a section per item, or items quietly lost.
{
  const { classFacet, storageFacet, pickAxis, scoreAxis, sectionize, assignGroups,
          MIN_ITEMS_TO_GROUP, OTHER_LABEL } = await import('../server/engine/classify.js');

  const food = (name, tags) => ({ name, tags });

  // The motivating case: a grocer's stock is uniformly `Consumables` on the class
  // axis, so that axis must LOSE and storage must win. If class ever wins here,
  // Ration Nine renders one section called "Consumables" holding everything —
  // strictly worse than the flat list it replaced.
  const grocery = [
    food('rat loaf',    { consumable: true, food_profile: 'dense_meat', perishable: true, spoil_rate: 'fast' }),
    food('grey mince',  { consumable: true, food_profile: 'dense_meat', perishable: true, spoil_rate: 'fast' }),
    food('block ice',   { consumable: true, storage_tier: 'frozen' }),
    food('frozen fish', { consumable: true, storage_tier: 'frozen' }),
    food('dry noodle',  { consumable: true, food_profile: 'dry_starch' }),
    food('tin beans',   { consumable: true, food_profile: 'preserved' }),
    food('salt',        { consumable: true, food_profile: 'aromatic' }),
  ];
  check('a grocer sections by storage, not by type', pickAxis(grocery) === 'storage', String(pickAxis(grocery)));
  check('the useless axis scores zero, it is not merely outranked',
    scoreAxis(grocery, 'class') === 0, String(scoreAxis(grocery, 'class')));

  // The reverse case, on the same code path and with no configuration anywhere.
  const gunsmith = [
    food('pipe rifle',  { weapon: true, damage: { min: 4, max: 9 } }),
    food('scrap knife', { weapon: true, damage: { min: 2, max: 4 } }),
    food('slug pistol', { weapon: true, damage: { min: 3, max: 7 } }),
    food('flak vest',   { armor_soak: { ballistic: 4 }, slot: 'torso' }),
    food('plate rig',   { armor_soak: { ballistic: 7 }, slot: 'torso' }),
    food('ammo box',    { material: true }),
    food('cleaning kit',{ material: true }),
  ];
  check('a gunsmith sections by type', pickAxis(gunsmith) === 'class', String(pickAxis(gunsmith)));

  // Three ways an axis is useless, all of which must produce a FLAT list.
  const tiny = grocery.slice(0, 3);
  check('a short list is never sectioned', pickAxis(tiny) === null, String(pickAxis(tiny)));
  check('the flat-list floor is a real threshold', MIN_ITEMS_TO_GROUP > 1, String(MIN_ITEMS_TO_GROUP));

  const uniform = Array.from({ length: 10 }, (_, i) =>
    food(`ration ${i}`, { consumable: true, food_profile: 'dry_starch' }));
  check('a uniform list is never sectioned', pickAxis(uniform) === null, String(pickAxis(uniform)));

  const allDistinct = ['head', 'torso', 'hands', 'legs', 'feet', 'accessory']
    .map((s, i) => food(`piece ${i}`, { slot: s }));
  check('one item per bucket is a header list, not sections',
    scoreAxis(allDistinct, 'slot') === 0, String(scoreAxis(allDistinct, 'slot')));

  // Nothing may be lost. This is the bug that would be hardest to spot by eye:
  // an axis that answers for most of a list silently dropping the rest.
  const mixed = [...grocery, food('crowbar', { weapon: true }), food('rope', { material: true })];
  const sections = sectionize(mixed);
  const seen = sections.flatMap(s => s.items);
  check('sectioning loses no item', seen.length === mixed.length, `${seen.length}/${mixed.length}`);
  check('items an axis cannot answer for land in one trailing bucket',
    sections[sections.length - 1].group === OTHER_LABEL, JSON.stringify(sections.map(s => s.group)));

  // Section order is declared, not alphabetical — a fridge reads cold to ambient.
  const order = sectionize(grocery).map(s => s.group);
  check('storage sections read cold → ambient',
    order.indexOf('Frozen') < order.indexOf('Refrigerated') && order.indexOf('Refrigerated') < order.indexOf('Dry Goods'),
    JSON.stringify(order));

  // Frozen can only come from the author override — nothing in a spoil rate says
  // a fillet is sold frozen rather than fresh.
  check('frozen is authored, never derived',
    storageFacet({ perishable: true, spoil_rate: 'fast' }) === 'Refrigerated' &&
    storageFacet({ perishable: true, spoil_rate: 'fast', storage_tier: 'frozen' }) === 'Frozen');
  check('non-food is off the storage axis entirely',
    storageFacet({ weapon: true }) === null, String(storageFacet({ weapon: true })));

  // The author override is honoured whenever it splits at all — a looser bar than
  // auto-selection on purpose, because the quality heuristics exist to stop the
  // AUTOMATIC choice making a list worse, and an author naming an axis has already
  // made that call. `profile` would lose the auto contest on this stock (too many
  // thin buckets), which is exactly why it's the useful test of the override.
  check('an author override wins when it splits', pickAxis(grocery, 'profile') === 'profile', String(pickAxis(grocery, 'profile')));
  check('the overridden axis would have lost the auto contest',
    scoreAxis(grocery, 'profile') === 0 && pickAxis(grocery) === 'storage', String(scoreAxis(grocery, 'profile')));
  // Splitting nothing is still refused: one section named after the whole shelf is
  // never what anybody meant, so the override falls back to the scored winner.
  check('an override that splits nothing is ignored', pickAxis(gunsmith, 'storage') === 'class', String(pickAxis(gunsmith, 'storage')));

  // A flat list must leave `group` unset, or the client renders a header for it.
  const flat = uniform.map(u => ({ ...u }));
  check('a flat list stamps no group', assignGroups(flat) === null && flat.every(f => f.group === undefined));

  // vendorCategory still speaks singular for the examine pane, off the same rules.
  const { vendorCategory } = await import('../server/engine/vendor.js');
  check('vendorCategory stays singular', vendorCategory({ weapon: true }) === 'Weapon', vendorCategory({ weapon: true }));
  check('vendorCategory depluralises -ies correctly',
    vendorCategory({ slot: 'accessory' }) === 'Accessory', vendorCategory({ slot: 'accessory' }));
  check('vendorCategory leaves Goods alone', vendorCategory({}) === 'Goods', vendorCategory({}));
  check('the section header is the plural of it', classFacet({ weapon: true }) === 'Weapons', classFacet({ weapon: true }));
}

// ── Vendor sourced-container stock ───────────────────────────────────────────
// A catalogue entry with sourceContainer/restockToQty is physical stock, not
// the abstract vendor_stock shelf: getVendorStock must report the real count
// in that furniture container, buyFromVendor must MOVE a real row out (not
// insert a fresh one, so freshness/cooked state survives the sale), and
// restockSourcedContainers must top it up to the target, capped by the
// container's own weight capacity. Needs a real `players` row (adjustCredits
// requires one to exist), torn down in finally.
{
  const ITEM = 'item_vendorstock_regress';
  const FURN = 'furn_vendorstock_regress';
  const PID = 'vsr_player_' + process.pid;
  const npc = { id: 'npc_vendorstock_regress', vendor_inventory: [
    { item_id: ITEM, price: 5, sourceContainer: FURN, restockToQty: 3 },
  ], vendor_stock: [], vendor_credits: 0 };
  try {
    await query(
      `INSERT INTO players (id, username, password_hash, handle, credits) VALUES ($1,$2,'x',$3,999)
       ON CONFLICT (id) DO UPDATE SET credits=999`,
      [PID, PID, PID]
    );
    const buyer = { id: PID, handle: 'VendorStockTester', credits: 999, current_zone: 'zone_start' };

    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test frozen brick','test frozen brick','consumable',5,400,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [ITEM, JSON.stringify({ consumable: true, perishable: true, needs_cooking: true, spoil_rate: 'normal', restore_hunger: 10 })]
    );
    await reloadItem(ITEM);
    await insertFurniture({
      id: FURN, name: 'test cold case', description: 'a test cold case', object_type: 'container',
      zone_id: 'zone_start', flags: JSON.stringify({ preserves: 'frozen', container: 5000 }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    let stock = await getVendorStock(npc, PID);
    check('an empty sourced container reports zero real stock', stock.find(s => s.item_id === ITEM)?.stock === 0, JSON.stringify(stock));

    let buyResult = await buyFromVendor(buyer, npc, ITEM, 1);
    check('buying with nothing in the container is refused', buyResult.success === false, JSON.stringify(buyResult));

    await restockSourcedContainers(npc);
    let count = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [FURN, ITEM])).rows[0].n;
    check('restockSourcedContainers delivers up to restockToQty', count === 3, count);

    stock = await getVendorStock(npc, PID);
    check('getVendorStock now reports the real delivered count', stock.find(s => s.item_id === ITEM)?.stock === 3, JSON.stringify(stock));

    // Down to exactly one unit left, give it a real freshness checkpoint, then
    // buy it — since it's the ONLY row in the container, buyFromVendor's pick
    // is unambiguous, proving the sale MOVES that exact row (custom_data
    // intact) rather than inserting a fresh one.
    const { rows: inContainer } = await query('SELECT id FROM player_inventory WHERE container_id=$1 AND item_id=$2 ORDER BY id', [FURN, ITEM]);
    const markedId = inContainer[0].id;
    await query('DELETE FROM player_inventory WHERE container_id=$1 AND item_id=$2 AND id<>$3', [FURN, ITEM, markedId]);
    await query(`UPDATE player_inventory SET custom_data='{"freshness":{"value":42,"checkpointAt":1,"envBucket":"frozen","powerLostAt":null}}'::jsonb WHERE id=$1`, [markedId]);
    count = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [FURN, ITEM])).rows[0].n;
    check('exactly one marked unit remains before the sale', count === 1, count);

    const creditsBefore = buyer.credits;
    buyResult = await buyFromVendor(buyer, npc, ITEM, 1);
    check('buying a sourced item succeeds when in stock', buyResult.success === true, JSON.stringify(buyResult));
    check('the purchase actually debits credits', buyer.credits === creditsBefore - 5, buyer.credits);

    const sold = (await query('SELECT container_id, player_id, custom_data FROM player_inventory WHERE id=$1', [markedId])).rows[0];
    check('the sold row moved out of the container to the buyer', sold?.container_id === null && sold?.player_id === PID, JSON.stringify(sold));
    check('the sold row kept its freshness checkpoint (moved, not re-inserted)', sold?.custom_data?.freshness?.value === 42, JSON.stringify(sold));

    count = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [FURN, ITEM])).rows[0].n;
    check('the container is empty after selling the last unit', count === 0, count);

    buyResult = await buyFromVendor(buyer, npc, ITEM, 1);
    check('buying once the container is empty again is refused', buyResult.success === false, JSON.stringify(buyResult));

    // Weight-capacity cap: a 5000g container can't fit more than 12x a 400g item.
    await query('DELETE FROM player_inventory WHERE container_id=$1', [FURN]);
    npc.vendor_inventory[0].restockToQty = 50;
    await restockSourcedContainers(npc);
    count = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1', [FURN])).rows[0].n;
    check('restock never overfills the container past its weight capacity', count === 12, count);

    // The daily sweep's SKIP. `needsDelivery` decides from a pre-read cache whether
    // a vendor is short of anything, and a wrong `false` is invisible in play — the
    // shelf just quietly stops being restocked, forever. So it is asserted in both
    // directions against the same helper the sweep uses.
    await query('DELETE FROM player_inventory WHERE container_id=$1', [FURN]);
    npc.vendor_inventory[0].restockToQty = 3;
    let state = await _internal.loadDeliveryState([FURN]);
    check('a vendor with an empty case is NOT skipped', _internal.needsDelivery(npc, state) === true);

    await restockSourcedContainers(npc);
    state = await _internal.loadDeliveryState([FURN]);
    check('…and once delivered, it IS skipped', _internal.needsDelivery(npc, state) === false);

    // One unit sold is the case the skip exists to catch: still nearly full, but
    // short, so tomorrow's tick must not pass it over.
    await query('DELETE FROM player_inventory WHERE container_id=$1 AND item_id=$2 AND id=(SELECT id FROM player_inventory WHERE container_id=$1 LIMIT 1)', [FURN, ITEM]);
    state = await _internal.loadDeliveryState([FURN]);
    check('a case one unit short is not skipped', _internal.needsDelivery(npc, state) === true);

    // The seeded cache must deliver the same result as an unseeded call — it is
    // the sweep's only path, and a stale seed would under-deliver silently.
    await restockSourcedContainers(npc, state);
    count = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE container_id=$1 AND item_id=$2', [FURN, ITEM])).rows[0].n;
    check('a delivery against a seeded cache still reaches the target', count === 3, count);
  } finally {
    await query('DELETE FROM player_inventory WHERE item_id=$1 OR player_id=$2', [ITEM, PID]).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [ITEM]).catch(() => {});
    deleteItemCache(ITEM);
    await deleteFurniture(FURN).catch(() => {});
    await purgeFakePlayer(PID);
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
  }
}

// The suite's fake player id is `test_regress_<pid>` — a NEW identity every run.
// Deleting only the `players` row left every child row behind, and there is no FK
// cascade, so they orphaned permanently: a dev DB measured **34,839 orphaned
// `player_flags` rows across 4,121 dead player ids** against a `players` table
// holding 7. That is not just untidy — it makes local performance profiling
// unrepresentative, because measurements land on a hot table that is 99.8% test
// residue. (CI and prod were never affected: CI regress runs against a throwaway
// localhost DB, see .github/workflows/deploy-content.yml.)
//
// So sweep the children too. Deliberately data-driven rather than a hand-written
// list of DELETEs: a future per-player table added without a thought for teardown
// would silently resume the leak, and this at least fails loudly on a typo'd
// table instead of quietly skipping it.
// Delete every per-player row whose owner no longer exists in `players`. See the
// call site at the end of the run for why this is safe rather than heuristic.
// `player_inventory.player_id` is not always a player. The engine parks WORLD-owned
// rows there under sentinel ids, keyed and read by `container_id`/zone and never by
// player — so "has no `players` row" does NOT mean "unreachable" for them:
//
//   `_restock`          sourced vendor stock — the physical goods inside every shop
//                       cooler, display case and stockroom (engine/vendor.js).
//   `_ground_<zoneId>`  items dropped on the floor of a room (loadContainerById reads
//                       these explicitly, alongside the player's own rows).
//
// Sweeping those wiped every shop's self-service stock on every local regress run,
// which is as confusing as it sounds: the grocer's coolers read empty, re-seeding
// them fixed it, and the next test run emptied them again.
const WORLD_OWNED_PLAYER_ID = `(f.player_id = '_restock' OR f.player_id LIKE '_ground_%')`;

async function sweepOrphanedPlayerRows() {
  let total = 0;
  const hit = [];
  for (const t of PER_PLAYER_TABLES) {
    try {
      const keep = t === 'player_inventory' ? ` AND NOT ${WORLD_OWNED_PLAYER_ID}` : '';
      const { rowCount } = await query(
        `DELETE FROM ${t} f WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = f.player_id)${keep}`
      );
      if (rowCount) { total += rowCount; hit.push(`${t} ${rowCount}`); }
    } catch (err) {
      if (!/does not exist/i.test(err.message)) console.error(`  ! orphan sweep: ${t} — ${err.message}`);
    }
  }
  if (total) console.log(`  · swept ${total.toLocaleString()} orphaned per-player row(s): ${hit.join(', ')}`);
  return total;
}

async function purgeFakePlayer(playerId) {
  // Same table list as the end-of-run sweep, read at call time — this runs before
  // that `const` initialises (temporal dead zone), and a teardown that throws is a
  // teardown that doesn't tear down.
  for (const t of PER_PLAYER_TABLES) {
    // A table that doesn't exist yet (schema not applied) is not an error here —
    // but anything else is worth seeing rather than swallowing.
    await query(`DELETE FROM ${t} WHERE player_id=$1`, [playerId]).catch(err => {
      if (!/does not exist/i.test(err.message)) {
        console.error(`  ! teardown: ${t} purge failed — ${err.message}`);
      }
    });
  }
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
// flake but hide the culprit, so the leaker is reported by name.
//
// It is reported as a FAILURE, not a note. A note costs the leaking suite nothing
// and charges the whole bill to whoever runs next — which is exactly how this
// surfaced the first time, as voidwalking going red for someone else's timer. The
// suite that armed the timer is the one that should go red for it. Every suite was
// clean when this was tightened, so this gates the class shut rather than opening
// old ground.
// The same reasoning covers ALTERED STATES OF MIND, which are worse than a timer:
// a leaked dissociative episode or a leaked dreaming sleep doesn't fire once and
// move on, it re-gates every command for the rest of the process. Both make the
// engine answer any verb outside DREAM_VERBS with a DREAM_REFUSAL, so the next
// suite's assertions get "the intention arrives without a body attached to it"
// instead of the error they asked for, and the suite that lost its mind is not the
// one that goes red. The sanity suite leaked exactly this (a 1-in-8 dice roll at
// sanity 0/5 starting an episode), and yacht paid for it.
//
// Cleared through the real funnels — endDissociation / wakeFromDream — not by
// deleting the flags, because an episode also owns a built dreamscape and deleting
// the flag would strand its rooms for the life of the process.
const { endDissociation: _endDissoc, wakeFromDream: _wakeDream } = await import('../server/engine/dreamscape.js');

const TRANSIENT = ['_moveQueue', '_moveTimer', '_consume', '_crossing', '_elevator', '_pendingTrade'];
function disarm(p) {
  const left = [];
  if (p._dissociating) { _endDissoc(p, { broadcast: null, reason: 'silent' }); left.push('dissociative episode'); }
  if (p.sleeping?.inDream) { _wakeDream(p); left.push('dreaming sleep'); }
  if (p.sleeping) { p.sleeping = null; left.push('asleep'); }
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
    if (leaked.length) check(`${d.name}: leaves no live state behind`, false, `${leaked.join(', ')} (disarmed)`);
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
removePlayerFromZone(P.id, getPlayer().current_zone);
removeLivePlayer(P.id);

// Sweep orphaned per-player rows.
//
// The engine suite tears down its own fake player, but the plugin suites mint
// their own (`rt_burglar_test_regress_*`, `prologue_regress_*`, gametable's, …)
// and most don't clean the child tables. Chasing each suite individually is a
// game of whack-a-mole that the next new suite restarts, so sweep by the only
// property that actually matters: **a row whose player_id has no `players` row
// can never be read again** — every read in the codebase is keyed by the id of a
// live or loading player. They are unreachable by construction, so deleting them
// is safe in a way that a heuristic on id shape would not be.
//
// The one exception is `player_inventory`, where the engine parks WORLD-owned rows
// under sentinel player ids that ARE still read (by container, not by player). See
// WORLD_OWNED_PLAYER_ID above — those are held back, or this sweep quietly empties
// every shop cooler and every pile of dropped loot in the game.
//
// Left this to the very end so a mid-suite crash can't wipe a fixture a later
// suite still needs. Local-only in practice: CI runs against a throwaway DB.
// ── The map, written out ─────────────────────────────────────────────────────
// THE ONE SURFACE WHERE THE TWO TEXT RUNGS NEED DIFFERENT THINGS. A character
// grid is still a visual-spatial artefact: fine to glance at, close to useless
// read aloud. So  gets a chart and  gets a briefing — where you
// are, what each exit leads to BY NAME, and what is near with a bearing.
//
// Nothing exercised  before this, which is how an unimported symbol in
// cmdMap survived a full green run.
{
  const { _test: mt, renderMapBriefing, renderMapChart } = await import('../server/engine/map-text.js');

  // grid_y increases SOUTHWARD, so north is −dy. Getting this backwards would
  // send every listener the wrong way.
  check('map: north is negative dy', mt.bearing(0, -3) === 'north', mt.bearing(0, -3));
  check('map: south is positive dy', mt.bearing(0, 3) === 'south', mt.bearing(0, 3));
  check('map: east is positive dx', mt.bearing(4, 0) === 'east', mt.bearing(4, 0));
  check('map: diagonals compound', mt.bearing(3, -3) === 'north-east', mt.bearing(3, -3));
  // A bearing that over-specifies is worse than one that rounds honestly.
  check('map: a near-cardinal bearing rounds to the cardinal',
    mt.bearing(1, -9) === 'north', mt.bearing(1, -9));
  check('map: standing still is here, not a direction', mt.bearing(0, 0) === 'here');

  // A map render must never be able to take the process down. This block runs
  // after the engine suite tears its fake player down, which is exactly how the
  // crash was found: renderMapBriefing(null) threw and killed the whole run.
  let threw = null;
  try { renderMapBriefing(null); renderMapChart(null); renderMapBriefing({}); }
  catch (e) { threw = e.message; }
  check('map: rendering with no player returns prose rather than throwing', threw === null, threw);
  check('map: …and says so plainly', /nowhere/i.test(renderMapBriefing(null)), renderMapBriefing(null));
}

// ── Brief room descriptions at the `log` rung ────────────────────────────────
// The safety property is NOTHING IS EVER LOST, ONLY DEFERRED BY ONE KEYSTROKE,
// and it rests on two things that are easy to break by accident: `look` staying
// full, and the transform bailing out rather than emitting a stub when it does
// not recognise a description. Both are asserted here.
{
  const { briefRoom, arrivalRoom } = await import('../server/engine/room-brief.js');
  const ROOM = [
    '<span class="zone-name">Marrow Street</span>',
    '<span class="room-desc">Rain sheets off the awnings. Somewhere a transformer hums itself to sleep, and the gutter carries a slick of something that was recently alive.</span>',
    '<span class="npcs-label">Here:</span> a vendor',
    '<span class="exits-row"><span class="exits-label">Exits:</span> north, east</span>',
  ].join('\n');

  const b = briefRoom(ROOM);
  check('brief: the prose paragraph goes', !b.includes('transformer'), b);
  check('brief: …but where you are stays', b.includes('Marrow Street'), b);
  check('brief: …and the exits stay', b.includes('Exits:'), b);
  // The whole reason a brief is safe to repeat is that it carries everything
  // that could have CHANGED. Drop this and a log-rung player walks past people.
  check('brief: …and so does anyone standing there', b.includes('a vendor'), b);
  check('brief: it is actually shorter', b.length < ROOM.length, `${b.length} vs ${ROOM.length}`);

  // Bail-out behaviour. A description this transform does not understand must
  // come back WHOLE — a missing room is far worse than a long one.
  const alien = 'just some text with no markup at all';
  check('brief: an unrecognised description is returned untouched', briefRoom(alien) === alien);
  check('brief: a name-only room is not abbreviated to nothing',
    briefRoom('<span class="zone-name">A Cell</span>').includes('A Cell'));
  let threw = null;
  try { briefRoom(null); briefRoom(undefined); briefRoom(''); } catch (e) { threw = e.message; }
  check('brief: rendering with no description does not throw', threw === null, threw);

  // ── The ARRIVAL tier: walking is not reading ───────────────────────────────
  // A move says where you are and what can hurt you, and nothing else. The
  // safety property is unchanged and rests entirely on `look` staying full,
  // which stampToLog owns and a11y:smoke pins.
  const DANGER = [
    '<span class="zone-name">Marrow Street</span>',
    '<span class="room-desc">Rain sheets off the awnings. A transformer hums.</span>',
    '<span class="rad-warning">☢ The air crackles.</span>',
    '<span class="enemies-label">Hostiles:</span> a scav dog',
    '<span class="npcs-label">Here:</span> a vendor',
    '<span class="exits-row"><span class="exits-label">Exits:</span> north, east</span>',
  ].join('\n');
  const a = arrivalRoom(DANGER);
  check('arrival: where you are survives', a.includes('Marrow Street'), a);
  check('arrival: …and what can kill you', a.includes('☢') && a.includes('scav dog'), a);
  check('arrival: …the prose does not', !a.includes('transformer'), a);
  // The three that used to survive a brief and now wait for `look`. This is the
  // whole ask — as little as possible on a step — and it is only safe because
  // `look` is one keystroke and still renders everything.
  check('arrival: …nor the exits', !a.includes('Exits:'), a);
  check('arrival: …nor who is standing about', !a.includes('a vendor'), a);
  check('arrival: it is shorter than the brief of the same room',
    a.length < briefRoom(DANGER).length, `${a.length} vs ${briefRoom(DANGER).length}`);

  // Bail-out, same contract as brief: an unrecognised description comes back
  // whole, and a shape that leaves nothing falls back UP to the brief rather
  // than emitting a stub.
  check('arrival: an unrecognised description is returned untouched', arrivalRoom(alien) === alien);
  check('arrival: a name-only room still names itself',
    arrivalRoom('<span class="zone-name">A Cell</span>').includes('A Cell'));
  let athrew = null;
  try { arrivalRoom(null); arrivalRoom(undefined); arrivalRoom(''); } catch (e) { athrew = e.message; }
  check('arrival: rendering with no description does not throw', athrew === null, athrew);

  // ── Facet sections are FLATTENED, never dropped ────────────────────────────
  // describe.js emits the sections as a <div> with NO leading newline, so they
  // share a line with the prose paragraph. A drop-by-class rule takes the
  // furniture AND the prose's line with it — this is that bug, pinned.
  const SECTIONED = [
    '<span class="zone-name">The Scanline</span>',
    '<span class="room-desc">Rain sheets off the awnings.</span><div class="room-furn-secs">' +
      '<span class="furniture-label">Seating:</span><span class="furn-sec-items">a steel stool</span>' +
      '<span class="furniture-label">Storage:</span><span class="furn-sec-items">a parts bin</span></div>',
    '<span class="furniture-label">Installed:</span> Junction Box (online)',
    '<span class="exits-row"><span class="exits-label">Exits:</span> north</span>',
  ].join('\n');
  const sb = briefRoom(SECTIONED);
  // Furniture is now the TALLY tier — named in the closing line rather than
  // listed — so the pin is that the room is still SAID to have furniture. The
  // guard is unchanged in substance: if the flatten regressed to a drop, the
  // whole prose+sections line would go and there would be no mention at all.
  check('brief: sectioned furniture survives sharing a line with the prose',
    /Also here:[^<]*furniture/.test(sb), sb);
  check('brief: …tallied once, not per-category',
    !/Seating:/.test(sb) && !/Storage:/.test(sb)
    && (sb.match(/furniture/g) || []).length === 1, sb);
  check('brief: …and the prose on that same line still goes',
    !/awnings/.test(sb), sb);
  // Utility fixtures: identical every visit and each entry repeats the room name.
  check('brief: the Installed row is dropped', !/Installed:/.test(sb), sb);
  check('brief: …but Exits, which share its class, are not', /Exits:/.test(sb), sb);

  // ── The three tiers ────────────────────────────────────────────────────────
  // VITAL is printed, TALLY is named, DROP is gone. The tally is what keeps the
  // "nothing is ever lost" contract honest now that contents are not listed: a
  // brief must still SAY the room has items, or a log-rung player walks over
  // loot they were never told about.
  const TIERED = [
    '<span class="zone-name">Cutbank Alley</span>',
    // Realistic lengths. A synthetic one-sentence room understates the win by a
    // long way — the prose paragraph and the contents lists are what actually
    // make a logged room unlistenable, and both are full-size here.
    '<span class="room-desc">Somebody has been burning pallets in the doorway, and the smoke has nowhere '
      + 'to go but up between the two blocks. Fire escapes ladder the brick on both sides, most of them '
      + 'ending a full storey short of the ground. A gutter runs the length of the alley and carries '
      + 'something that has not been rain for a long time.</span>',
    '<span class="rad-warning">☢ The counter clicks steadily.</span>',
    '<span class="enemies-row"><span class="enemies-label">Enemies:</span> a scav dog</span>',
    '<span class="items-row"><span class="items-label">Items:</span> a bent rebar, a soaked paperback, '
      + 'three spent casings, a cracked ration tin</span>',
    '<span class="furniture-label">Furniture:</span> a dumpster, a stack of pallets, a standpipe',
    '<span class="vendors-row"><span class="vendors-label">Vendors:</span> Grady</span>',
    '<span class="exits-row"><span class="exits-label">Exits:</span> north, east</span>',
  ].join('\n');
  const tb = briefRoom(TIERED);
  check('brief: a hazard is printed', /counter clicks/.test(tb), tb);
  check('brief: …and so is anything that can attack you', /scav dog/.test(tb), tb);
  check('brief: …and the way out', /north, east/.test(tb), tb);
  check('brief: contents are named, not listed', !/bent rebar/.test(tb) && /Also here:[^<]*items/.test(tb), tb);
  check('brief: …vendors too', !/Grady/.test(tb) && /Also here:[^<]*vendors/.test(tb), tb);
  check('brief: the prose is gone entirely', !/pallets/.test(tb), tb);
  // The whole point of the ask: SHORT read aloud, not merely shorter. Measured on
  // the SPOKEN text — markup is free to a screen reader, so comparing HTML
  // lengths would flatter a brief that is still a paragraph of speech.
  const spoken = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;
  check('brief: a tiered brief is about a quarter of the speech',
    spoken(tb) < spoken(TIERED) * 0.3, `${spoken(tb)}/${spoken(TIERED)} spoken chars`);
  // A room with nothing in the tally tier gets no trailing line at all.
  const BARE = [
    '<span class="zone-name">Cutbank Alley</span>',
    '<span class="room-desc">Somebody has been burning pallets in the doorway.</span>',
    '<span class="exits-row"><span class="exits-label">Exits:</span> north</span>',
  ].join('\n');
  check('brief: an empty room adds no "Also here" line', !/Also here/.test(briefRoom(BARE)), briefRoom(BARE));
}

await sweepOrphanedPlayerRows();
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
