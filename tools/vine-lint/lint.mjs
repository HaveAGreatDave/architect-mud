// VINE graph linter — validates every behaviour_graph / dialogue_tree /
// broadcast_graph / script graph in the DB. The runners fail SILENTLY on
// missing nodes and unknown types (ai-behaviour.js walk, graph.js runNode),
// so authoring mistakes are invisible at runtime — this surfaces them.
//
//   npm run db:vine-lint
//   node --env-file=.env.prod tools/vine-lint/lint.mjs
//
// Node-type / condition / action catalogues are parsed from the runtime
// switches in server/engine/ai-behaviour.js and server/engine/graph.js so the
// linter tracks the engine instead of a hardcoded list. Plugin-registered
// types are collected by static-scanning plugins/ for registerAIAction/
// registerAICondition calls.
import { query } from '../../server/models/db.js';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..', '..');
const rows = async sql => (await query(sql)).rows;

// ---- catalogues from engine source ----
const aiSrc = readFileSync(path.join(root, 'server/engine/ai-behaviour.js'), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); const j = b ? src.indexOf(b, i) : src.length; return src.slice(i, j < 0 ? src.length : j); };
const caseLabels = (s, re) => new Set([...s.matchAll(re)].map(m => m[1]));

const AI_CONDITIONS = caseLabels(between(aiSrc, 'function evalCondition', 'function execAction') || between(aiSrc, 'function evalCondition', 'async function execAction'), /case\s+'([A-Z_]+)'/g);
const AI_ACTIONS = caseLabels(between(aiSrc, 'function execAction', 'function tickEntityAI'), /case\s+'([A-Z_]+)'/g);
const AI_NODE_TYPES = new Set(['start', 'condition', 'action', 'wait', 'loop', 'random']);
const AI_PORTS = new Set(['next', 'ifTrue', 'ifFalse', 'goToWork', 'haveLife', 'endShift', 'offWork']); // + branch_N (vine-schema-ai.js AI_EDGE_PORTS)

const gSrc = readFileSync(path.join(root, 'server/engine/graph.js'), 'utf8');
const SCRIPT_NODE_TYPES = caseLabels(gSrc, /case\s+'(\w+)'/g);
const SCRIPT_PORTS = new Set(['next', 'ifTrue', 'ifFalse']);

const BROADCAST_NODE_TYPES = new Set(['start', 'say', 'ticker', 'npc_anchor', 'npc_action', 'inject_news', 'camera_cut',
  'tech_difficulties', 'break', 'condition', 'wait', 'loop', 'random', 'set_flag', 'title_card', 'show_overlay',
  'music', 'clear_overlay', 'overlay', 'credits', 'event']); // vine-schema-broadcast.js _bcNodeDefs

// plugin-registered AI types (static scan)
const walkJs = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && e.name !== 'node_modules') walkJs(p, out); else if (e.name.endsWith('.js')) out.push(p); } return out; };
const registeredActions = new Set(); // dialogue/script actions via registerAction({type: 'X'})
for (const f of [...walkJs(path.join(root, 'plugins')), ...walkJs(path.join(root, 'server'))]) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/registerAIAction\(\s*['"]([A-Z_]+)['"]/g)) AI_ACTIONS.add(m[1]);
  for (const m of s.matchAll(/registerAICondition\(\s*['"]([A-Z_]+)['"]/g)) AI_CONDITIONS.add(m[1]);
  for (const m of s.matchAll(/registerAction\(\s*\{[\s\S]{0,200}?type:\s*['"]([A-Z_]+)['"]/g)) registeredActions.add(m[1]);
}

// dialogue action types (+ required params) from the devpanel catalogue
let DIALOGUE_ACTIONS = null; // Map type -> [required param names]
try {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(path.join(root, 'client/devpanel/js/vine/vine-action-types.js'), 'utf8'), sandbox);
  DIALOGUE_ACTIONS = new Map((sandbox.window.VineActionTypes || []).map(a =>
    [a.type, (a.params || []).filter(p => p.required).map(p => p.key || p.name)]));
} catch { /* catalogue unavailable — skip action-type validation */ }

// ---- DB refs ----
const zoneIds = new Set((await rows(`SELECT id FROM zones`)).map(r => r.id));
const questIds = new Set((await rows(`SELECT id FROM quests`)).map(r => r.id));
const npcRows = await rows(`SELECT id, name, behaviour_graph, dialogue_tree FROM npcs`);
const npcIds = new Set(npcRows.map(r => r.id));
const scriptRows = await rows(`SELECT id, name, graph FROM scripts`);
const scriptIds = new Set(scriptRows.map(r => r.id));
const enemyRows = await rows(`SELECT id, name, behaviour_graph FROM enemies`);
const broadcastRows = await rows(`SELECT id, name, broadcast_graph FROM media_broadcasts`);
const channelIds = new Set((await rows(`SELECT id FROM media_channels`)).map(r => r.id));

const findings = [];
const add = (sev, title, desc, list) => findings.push({ sev, title, desc, items: list });
const bad = [];
const collect = () => { const b = [...bad]; bad.length = 0; return b; };

// ---- port-graph lint (AI / broadcast / script share the inline-port format) ----
function lintPortGraph(owner, graph, { nodeTypes, ports, conditions, actions, startKey }) {
  if (!graph || typeof graph !== 'object') return;
  const nodes = graph.nodes || {};
  const ids = new Set(Object.keys(nodes));
  if (!ids.size) return;
  const start = graph[startKey] || Object.keys(nodes).find(k => nodes[k]?.type === 'start') || Object.keys(nodes)[0];
  const structural = [], types = [], refs = [];
  if (graph[startKey] && !ids.has(graph[startKey])) structural.push(`${owner}: ${startKey} → missing node ${graph[startKey]}`);

  const edgeTargets = n => {
    const out = [];
    for (const [k, v] of Object.entries(n)) {
      if ((ports.has(k) || /^branch_\d+$/.test(k)) && typeof v === 'string' && v) out.push([k, v]);
      // dropped-port heuristic: unknown key whose string value names an existing node
      else if (typeof v === 'string' && ids.has(v) && !['type', '_start'].includes(k) && !k.startsWith('_') &&
               !['condition_type', 'action_type', 'text', 'flag', 'scope', 'value'].includes(k))
        structural.push(`${owner} node ${n.__id}: port '${k}' not in the schema port list — silently dropped on save`);
    }
    return out;
  };

  for (const [nid, n] of Object.entries(nodes)) {
    if (!n || typeof n !== 'object') { structural.push(`${owner} node ${nid}: not an object`); continue; }
    n.__id = nid;
    if (n.type && !nodeTypes.has(n.type)) types.push(`${owner} node ${nid}: unknown node type '${n.type}' — runner stops silently here`);
    if (conditions && n.type === 'condition' && n.condition_type && !conditions.has(n.condition_type))
      types.push(`${owner} node ${nid}: unknown condition '${n.condition_type}' — evaluates false forever`);
    if (actions && n.type === 'action' && n.action_type && !actions.has(n.action_type))
      types.push(`${owner} node ${nid}: unknown action '${n.action_type}' — does nothing`);
    for (const [port, target] of edgeTargets(n))
      if (!ids.has(target)) structural.push(`${owner} node ${nid} [${port}] → missing node ${target}`);
    // cross-asset refs
    const p = n.params || {};
    if (p.zone_id && !zoneIds.has(p.zone_id)) refs.push(`${owner} node ${nid}: zone ${p.zone_id}`);
    for (const w of (Array.isArray(p.waypoints) ? p.waypoints : [])) if (!zoneIds.has(w)) refs.push(`${owner} node ${nid}: waypoint ${w}`);
    if (p.quest_id && !questIds.has(p.quest_id)) refs.push(`${owner} node ${nid}: quest ${p.quest_id}`);
    if (p.channel_id && !channelIds.has(p.channel_id)) refs.push(`${owner} node ${nid}: channel ${p.channel_id}`);
    if (n.npc_id && !npcIds.has(n.npc_id)) refs.push(`${owner} node ${nid}: npc ${n.npc_id}`);
    if ((n.scriptId || p.scriptId) && !scriptIds.has(n.scriptId || p.scriptId)) refs.push(`${owner} node ${nid}: script ${n.scriptId || p.scriptId}`);
    delete n.__id;
  }
  // reachability from start
  const seen = new Set([start]); const q = [start];
  while (q.length) { const n = nodes[q.shift()]; if (!n) continue; for (const [, t] of edgeTargets(n)) if (!seen.has(t)) { seen.add(t); q.push(t); } }
  const orphans = [...ids].filter(i => !seen.has(i));
  if (orphans.length) structural.push(`${owner}: unreachable node(s) ${orphans.join(', ')}`);
  return { structural, types, refs };
}

const buckets = { structural: [], types: [], refs: [] };
const lintInto = (owner, graph, opts) => {
  const r = lintPortGraph(owner, graph, opts);
  if (r) { buckets.structural.push(...r.structural); buckets.types.push(...r.types); buckets.refs.push(...r.refs); }
};

const aiOpts = { nodeTypes: AI_NODE_TYPES, ports: AI_PORTS, conditions: AI_CONDITIONS, actions: AI_ACTIONS, startKey: '_start' };
for (const n of npcRows) lintInto(`npc ${n.id} (${n.name})`, n.behaviour_graph, aiOpts);
for (const e of enemyRows) lintInto(`enemy ${e.id} (${e.name})`, e.behaviour_graph, aiOpts);
for (const b of broadcastRows) lintInto(`broadcast ${b.id} (${b.name})`, b.broadcast_graph,
  { nodeTypes: BROADCAST_NODE_TYPES, ports: AI_PORTS, startKey: '_start' });
for (const s of scriptRows) lintInto(`script ${s.id} (${s.name})`, s.graph,
  { nodeTypes: SCRIPT_NODE_TYPES, ports: SCRIPT_PORTS, startKey: 'start' });

add('crit', 'Broken graph structure',
  'Missing start nodes, edges to nonexistent nodes, and ports outside the schema list (silently dropped on save). The runners stop dead — no log, no error.',
  buckets.structural);
add('warn', 'Unknown node / condition / action types',
  'Types absent from the runtime switches and plugin registrations. Conditions evaluate false forever; actions do nothing; unknown node types halt the walk.',
  buckets.types);
add('warn', 'Dangling cross-asset references',
  'Graph params naming zones, quests, channels, NPCs, or scripts that do not exist.', buckets.refs);

// ---- dialogue trees: structure + action-type validity (cross-refs live in world-report) ----
for (const n of npcRows) {
  const tree = n.dialogue_tree || {};
  const ids = new Set(Object.keys(tree));
  if (!ids.size) continue;
  const owner = `npc ${n.id} (${n.name})`;
  if (!ids.has('root')) bad.push(`${owner}: no 'root' node`);
  const seen = new Set(['root']); const q = ['root'];
  while (q.length) {
    const node = tree[q.shift()];
    const targets = [];
    for (const a of (node?.actions || [])) { const g = a?.node ?? a?.goto_node; if (g) targets.push(g); }
    for (const o of (node?.options || [])) {
      if (o?.next) targets.push(o.next);
      for (const a of (o?.actions || [])) { const g = a?.node ?? a?.goto_node; if (g) targets.push(g); }
    }
    for (const t of targets) if (ids.has(t) && !seen.has(t)) { seen.add(t); q.push(t); }
  }
  const orphans = [...ids].filter(i => !seen.has(i));
  if (orphans.length) bad.push(`${owner}: unreachable node(s) ${orphans.join(', ')}`);
  if (DIALOGUE_ACTIONS) {
    const checkA = (actions, where) => {
      for (const a of (actions || [])) {
        if (!a?.action) continue;
        if (registeredActions.has(a.action)) continue; // plugin/engine action — validates its own params
        if (!DIALOGUE_ACTIONS.has(a.action)) { bad.push(`${owner} ${where}: unknown action '${a.action}'`); continue; }
        for (const req of DIALOGUE_ACTIONS.get(a.action))
          if (a[req] === undefined || a[req] === '') bad.push(`${owner} ${where}: ${a.action} missing required '${req}'`);
      }
    };
    for (const [nid, node] of Object.entries(tree)) {
      checkA(node?.actions, `node ${nid}`);
      for (const o of (node?.options || [])) checkA(o?.actions, `node ${nid} option`);
    }
  }
}
add('warn', 'Dialogue tree structure & action validity',
  "Missing 'root', unreachable branches, unknown action types, and actions missing required params. (Dangling item/quest refs are covered by the world report.)",
  collect());

// ---- output ----
const stats = {
  generatedAt: new Date().toISOString(),
  graphs: npcRows.filter(n => n.behaviour_graph?.nodes).length + enemyRows.filter(e => e.behaviour_graph?.nodes).length +
          broadcastRows.filter(b => b.broadcast_graph?.nodes).length + scriptRows.filter(s => s.graph?.nodes).length,
  dialogues: npcRows.filter(n => Object.keys(n.dialogue_tree || {}).length).length,
  conditions: AI_CONDITIONS.size, actions: AI_ACTIONS.size,
};
let html = readFileSync(path.join(dir, 'template.html'), 'utf8');
html = html.replace('/*__FINDINGS__*/', JSON.stringify(findings));
html = html.replace('/*__STATS__*/', JSON.stringify(stats));
writeFileSync(path.join(dir, 'vine-lint.html'), html);

console.log(`graphs=${stats.graphs} dialogues=${stats.dialogues} | catalogue: ${AI_CONDITIONS.size} conditions, ${AI_ACTIONS.size} actions (incl. plugin-registered)`);
for (const f of findings) if (f.items.length) console.log(`  [${f.sev}] ${f.title}: ${f.items.length}`);
const count = s => findings.filter(f => f.sev === s).reduce((a, f) => a + f.items.length, 0);
console.log(`critical=${count('crit')} warnings=${count('warn')}`);
console.log(`wrote ${path.join(dir, 'vine-lint.html')}`);
process.exit(0);
