// World integrity report — scans authored content for dangling references
// (the soft TEXT/JSONB refs that have no FK constraints) plus zone reachability.
//
//   npm run db:world-report                                       → local dev DB
//   node --env-file=.env.prod tools/world-report/report.mjs        → prod
//
// Output: tools/world-report/world-report.html (git-ignored) + console summary.
import { query } from '../../server/models/db.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rows = async sql => (await query(sql)).rows;

const zones = await rows(`SELECT id, name, exits, flags, parent_zone FROM zones`);
const doors = await rows(`SELECT id, name, zone_id, exit_dir, target_zone FROM doors`);
const spawns = await rows(`SELECT id, zone_id, enemy_id FROM zone_spawns`);
const enemies = await rows(`SELECT id, name, loot_table, butcher_table, faction FROM enemies`);
const items = await rows(`SELECT id FROM items`);
const npcs = await rows(`SELECT id, name, zone_id, home_zone, work_zone_id, studio_zone_id, wander_zones, faction, vendor_inventory, vendor_stock, dialogue_tree FROM npcs`);
const furniture = await rows(`SELECT id, name, zone_id, origin FROM furniture`);
const scavTables = await rows(`SELECT id, fishing_monsters, fishing_bait_catches FROM scavenging_tables`);
const scavItems = await rows(`SELECT id, table_id, item_id FROM scavenging_table_items`);
const lootTables = await rows(`SELECT id, name, entries FROM loot_tables`);
const orgs = await rows(`SELECT id FROM orgs`);
const quests = await rows(`SELECT id FROM quests`);
const players = await rows(`SELECT id, handle, current_zone, anchor_zone, home_zone FROM players`);
const overrides = await rows(`SELECT zone_id, direction, target_zone FROM zone_exit_overrides`);
const atms = await rows(`SELECT id FROM atm_units`);
const secDevices = await rows(`SELECT id, zone_id FROM security_devices`);
const decks = await rows(`SELECT id FROM media_deck_units`);

const zoneIds = new Set(zones.map(z => z.id));
const itemIds = new Set(items.map(i => i.id));
const enemyIds = new Set(enemies.map(e => e.id));
const orgIds = new Set(orgs.map(o => o.id));
const questIds = new Set(quests.map(q => q.id));
const scavIds = new Set(scavTables.map(t => t.id));
const furnIds = new Set(furniture.map(f => f.id));

const findings = [];
const add = (sev, title, desc, list) => findings.push({ sev, title, desc, items: list });
const bad = [];
const collect = () => { const b = [...bad]; bad.length = 0; return b; };

// exits.<dir> is string | string[] — normalize like server/engine/exits.js does
const exitTargets = v => Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);

// --- zone exits → zones ---
for (const z of zones)
  for (const [dirn, v] of Object.entries(z.exits || {}))
    for (const t of exitTargets(v))
      if (!zoneIds.has(t)) bad.push(`${z.id} [${dirn}] → ${t}`);
add('crit', 'Exits pointing at missing zones',
  'A player walking this direction hits a zone that does not exist.', collect());

// --- spawn root ---
add('crit', 'Spawn root missing', "The literal 'zone_start' is the hardcoded spawn/fallback zone.",
  zoneIds.has('zone_start') ? [] : ['zone_start not found in zones']);

// --- zone_spawns → zones / enemies ---
for (const s of spawns) {
  if (!zoneIds.has(s.zone_id)) bad.push(`spawn #${s.id}: zone ${s.zone_id}`);
  if (!enemyIds.has(s.enemy_id)) bad.push(`spawn #${s.id} in ${s.zone_id}: enemy ${s.enemy_id}`);
}
add('crit', 'Spawns referencing missing zones/enemies',
  'These spawn rows either place enemies in nonexistent zones or spawn nonexistent enemies.', collect());

// --- furniture (authored) → zones ---
for (const f of furniture)
  if (f.origin === 'authored' && !zoneIds.has(f.zone_id)) bad.push(`${f.id} (${f.name}) in ${f.zone_id}`);
add('crit', 'Authored furniture in missing zones', 'Furniture placed in zones that do not exist.', collect());

// --- zone flags → scavenging tables ---
for (const z of zones) {
  const fl = z.flags || {};
  if (fl.scavenging_table_id && !scavIds.has(fl.scavenging_table_id)) bad.push(`${z.id}: scavenging_table_id ${fl.scavenging_table_id}`);
  if (fl.fishing_table_id && !scavIds.has(fl.fishing_table_id)) bad.push(`${z.id}: fishing_table_id ${fl.fishing_table_id}`);
}
add('crit', 'Zone scavenging/fishing flags → missing tables',
  'Zones opted into scavenging or fishing whose table id resolves to nothing — the verb silently finds no loot.', collect());

// --- doors → zones ---
for (const d of doors) {
  if (!zoneIds.has(d.zone_id)) bad.push(`door #${d.id} (${d.name || d.exit_dir}): zone ${d.zone_id}`);
  if (d.target_zone && !zoneIds.has(d.target_zone)) bad.push(`door #${d.id} in ${d.zone_id}: target ${d.target_zone}`);
}
add('warn', 'Doors referencing missing zones', 'Owning zone or pinned target zone does not exist.', collect());

// --- enemy loot/butcher → items (entry key is `item`; check `item_id` too) ---
const lootRef = e => e && (e.item ?? e.item_id);
for (const en of enemies) {
  for (const e of (en.loot_table || [])) { const r = lootRef(e); if (r && !itemIds.has(r)) bad.push(`${en.id} loot: ${r}`); }
  for (const e of (en.butcher_table || [])) { const r = lootRef(e); if (r && !itemIds.has(r)) bad.push(`${en.id} butcher: ${r}`); }
  if (en.faction && !orgIds.has(en.faction)) bad.push(`${en.id} faction: ${en.faction}`);
}
add('warn', 'Enemy loot/butcher/faction dangling refs',
  'Loot rolls for missing items silently drop nothing; factions must resolve to orgs.', collect());

// --- standalone loot tables ---
for (const lt of lootTables)
  for (const e of (lt.entries || [])) { const r = lootRef(e); if (r && !itemIds.has(r)) bad.push(`${lt.id} (${lt.name}): ${r}`); }
add('warn', 'Loot tables with missing items', 'Entries in loot_tables.entries referencing nonexistent items.', collect());

// --- scavenging table items ---
for (const s of scavItems)
  if (!itemIds.has(s.item_id)) bad.push(`table ${s.table_id} entry #${s.id}: ${s.item_id}`);
add('warn', 'Scavenging table entries with missing items',
  'scavenging_table_items.item_id has no FK (deliberately deferred) — these entries can never drop.', collect());

// --- fishing JSONB (recursive scan for item/enemy refs) ---
const scanRefs = (v, path, out) => {
  if (Array.isArray(v)) v.forEach((x, i) => scanRefs(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'item_id' || k === 'item') && typeof x === 'string' && !itemIds.has(x)) out.push(`${path}.${k}=${x} (item)`);
      if ((k === 'enemy_id' || k === 'monster') && typeof x === 'string' && !enemyIds.has(x)) out.push(`${path}.${k}=${x} (enemy)`);
      scanRefs(x, `${path}.${k}`, out);
    }
  }
};
for (const t of scavTables) {
  scanRefs(t.fishing_monsters, `${t.id}.fishing_monsters`, bad);
  scanRefs(t.fishing_bait_catches, `${t.id}.fishing_bait_catches`, bad);
}
add('warn', 'Fishing table dangling refs', 'Item/enemy references inside fishing_monsters / fishing_bait_catches.', collect());

// --- npc zone/org refs ---
for (const n of npcs) {
  for (const [k, v] of [['home_zone', n.home_zone], ['work_zone_id', n.work_zone_id], ['studio_zone_id', n.studio_zone_id]])
    if (v && !zoneIds.has(v)) bad.push(`${n.id} (${n.name}) ${k}: ${v}`);
  for (const w of (n.wander_zones || [])) if (!zoneIds.has(w)) bad.push(`${n.id} (${n.name}) wander: ${w}`);
  if (n.faction && !orgIds.has(n.faction)) bad.push(`${n.id} (${n.name}) faction: ${n.faction}`);
  if (n.zone_id && !zoneIds.has(n.zone_id)) bad.push(`${n.id} (${n.name}) LIVE zone: ${n.zone_id}`);
}
add('warn', 'NPC zone/faction dangling refs',
  'Home/work/studio/wander zones and factions that resolve to nothing. LIVE zone entries mean the NPC is standing in a deleted zone right now.', collect());

// --- vendor inventories → items ---
for (const n of npcs) {
  for (const e of (n.vendor_inventory || [])) if (e?.item_id && !itemIds.has(e.item_id)) bad.push(`${n.id} (${n.name}) catalogue: ${e.item_id}`);
  for (const e of (n.vendor_stock || [])) if (e?.item_id && !itemIds.has(e.item_id)) bad.push(`${n.id} (${n.name}) shelf: ${e.item_id}`);
}
add('warn', 'Vendor stock with missing items', 'Catalogue or live shelf entries pointing at deleted items.', collect());

// --- dialogue trees: actions + intra-tree links ---
for (const n of npcs) {
  const tree = n.dialogue_tree || {};
  const nodeIds = new Set(Object.keys(tree));
  if (!nodeIds.size) continue;
  const checkActions = (actions, where) => {
    for (const a of (actions || [])) {
      if (a?.item_id && !itemIds.has(a.item_id)) bad.push(`${n.id} (${n.name}) ${where}: item ${a.item_id}`);
      if (a?.quest_id && !questIds.has(a.quest_id)) bad.push(`${n.id} (${n.name}) ${where}: quest ${a.quest_id}`);
      const goto = a?.node ?? a?.goto_node;
      if (goto && !nodeIds.has(goto)) bad.push(`${n.id} (${n.name}) ${where}: goto ${goto}`);
    }
  };
  for (const [nid, node] of Object.entries(tree)) {
    if (!node || typeof node !== 'object') continue;
    checkActions(node.actions, `node ${nid}`);
    if (node.grants_item?.item_id && !itemIds.has(node.grants_item.item_id)) bad.push(`${n.id} (${n.name}) node ${nid}: grants_item ${node.grants_item.item_id}`);
    for (const opt of (node.options || [])) {
      checkActions(opt?.actions, `node ${nid} option`);
      if (opt?.next && !nodeIds.has(opt.next)) bad.push(`${n.id} (${n.name}) node ${nid}: next → ${opt.next}`);
    }
  }
  if (!nodeIds.has('root')) bad.push(`${n.id} (${n.name}): dialogue tree has no 'root' node`);
}
add('warn', 'Dialogue tree dangling refs',
  "Item grants, quest actions, goto targets, and option links that resolve to nothing — plus trees missing their 'root' entry node.", collect());

// --- device ↔ furniture id pairing ---
for (const a of atms) if (!furnIds.has(a.id)) bad.push(`atm ${a.id}`);
for (const s of secDevices) if (!furnIds.has(s.id)) bad.push(`security device ${s.id} (zone ${s.zone_id})`);
for (const d of decks) if (!furnIds.has(d.id)) bad.push(`media deck ${d.id}`);
add('warn', 'Devices without their furniture row',
  'ATMs, security devices, and media decks share ids with a furniture row — these have lost theirs and are invisible in the world.', collect());

// --- players in missing zones (runtime rot) ---
for (const p of players) {
  if (p.current_zone && !zoneIds.has(p.current_zone)) bad.push(`${p.handle}: current ${p.current_zone}`);
  if (p.anchor_zone && !zoneIds.has(p.anchor_zone)) bad.push(`${p.handle}: anchor ${p.anchor_zone}`);
  if (p.home_zone && !zoneIds.has(p.home_zone)) bad.push(`${p.handle}: home ${p.home_zone}`);
}
add('warn', 'Players anchored to missing zones',
  'Login falls back to zone_start for current_zone, but stale anchor/home zones cause surprise respawns.', collect());

// --- reachability BFS from zone_start over exits + runtime overrides ---
const edges = {};
for (const z of zones)
  edges[z.id] = Object.values(z.exits || {}).flatMap(exitTargets).filter(t => zoneIds.has(t));
for (const o of overrides)
  if (zoneIds.has(o.zone_id) && zoneIds.has(o.target_zone)) (edges[o.zone_id] ??= []).push(o.target_zone);
const seen = new Set(['zone_start']);
const queue = ['zone_start'];
while (queue.length) for (const t of (edges[queue.shift()] || [])) if (!seen.has(t)) { seen.add(t); queue.push(t); }
add('info', 'Zones unreachable from spawn (walking)',
  'Not reachable via exits/overrides from zone_start. Teleports, VINE actions, and flight can still reach these — review, don’t assume dead.',
  zones.filter(z => !seen.has(z.id)).map(z => `${z.id} (${z.name})`));

// ---- output ----
const stats = { generatedAt: new Date().toISOString(), zones: zones.length, npcs: npcs.length, enemies: enemies.length, items: items.length, furniture: furniture.length, reachable: seen.size };
let html = readFileSync(path.join(dir, 'template.html'), 'utf8');
html = html.replace('/*__FINDINGS__*/', JSON.stringify(findings));
html = html.replace('/*__STATS__*/', JSON.stringify(stats));
writeFileSync(path.join(dir, 'world-report.html'), html);

const count = s => findings.filter(f => f.sev === s).reduce((a, f) => a + f.items.length, 0);
console.log(`zones=${zones.length} (${seen.size} reachable) npcs=${npcs.length} enemies=${enemies.length} items=${items.length}`);
for (const f of findings) if (f.items.length) console.log(`  [${f.sev}] ${f.title}: ${f.items.length}`);
console.log(`critical=${count('crit')} warnings=${count('warn')} info=${count('info')}`);
console.log(`wrote ${path.join(dir, 'world-report.html')}`);
process.exit(0);
