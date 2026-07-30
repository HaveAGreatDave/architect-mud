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
import { initWorld, setLivePlayer, removeLivePlayer, addPlayerToZone, removePlayerFromZone, getAllZones, getLivePlayer, world, setDoorCache, deleteDoorCache, getDoorForExit, getApartment, insertFurniture, deleteFurniture, getZone, registerTransientZone, removeTransientZone, isTransientZone } from '../server/engine/world.js';
import { moveEntity } from '../server/engine/ai-behaviour.js';
import { exitTargets, allExits, neighborZoneIds, addExit, removeExit } from '../server/engine/exits.js';
import { cmdMove, dragFollowers } from '../server/engine/commands/movement.js';
import { resolveNamedDestination } from '../server/engine/commands/describe.js';
import { tickOnsets } from '../server/engine/drugs.js';
import { getSelectionState, clearSelectionState } from '../server/engine/sift.js';
import { loadPlugins, getLoadedPlugins, getRegisteredCommands, getRegisteredHooks } from '../server/engine/plugins.js';
import { getHelpTopic, listHelpTopics } from '../server/engine/help.js';
import { TOPIC_VERBS } from '../server/engine/help-topics.js';
import { getAlias } from '../server/engine/commands/aliases.js';
import { loadItems, reloadItem, deleteItemCache } from '../server/engine/items-cache.js';
import { getVendorStock, buyFromVendor, restockSourcedContainers } from '../server/engine/vendor.js';
import { randomUUID } from 'crypto';
import { loadDrugs } from '../server/engine/drugs.js';
import { loadMisSettings } from '../server/engine/mis.js';
import { handleCommand } from '../server/engine/commands/index.js';
import { getRegisteredMoveGates } from '../server/engine/movement-gates.js';
import { getRegisteredSpecializedActions } from '../server/engine/specializedActions.js';
import { registerProtectionProvider, getZoneProtection, getRegisteredProtectionProviders } from '../server/engine/protection.js';
import { npcHomedInOwnedUnit, authoredRentCost } from '../server/engine/apartments.js';
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
    if (!graph) return new Set([' missing:' + scriptId]);
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
      if (tok.startsWith(' missing:')) { problems.push(`${t.id} → ${tok.slice(8)} does not exist`); continue; }
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
