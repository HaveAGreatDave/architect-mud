// Story report: builds the story graph from content/ and prints how quests,
// NPCs and flags connect, plus the findings worth fixing.
//
//   node scripts/content/story-report.mjs              lint summary
//   node scripts/content/story-report.mjs --npc npc_grady   one NPC's chain
//   node scripts/content/story-report.mjs --arc asc_arc     one ladder
//   node scripts/content/story-report.mjs --json            the whole graph
//
// Reads files only; no database.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStoryGraph, lintStory, npcChain } from '../../client/shared/story-graph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

const readDir = (dir) => {
  const d = path.join(ROOT, 'content', dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
};

// Every string literal in engine and plugin code. A flag or quest id that
// appears here is set, read or started by code, so it isn't an orphan.
function codeStrings() {
  const out = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.(m?js)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/['"`]([a-z][a-z0-9_]{2,})['"`]/g)) out.add(m[1]);
        // Keys built in code, `arc_open_${order}`: keep the prefix.
        for (const m of src.matchAll(/`([a-z][a-z0-9_]*_)\$\{/g)) prefixes.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'server'));
  walk(path.join(ROOT, 'plugins'));
  // Prefixes clear flags only: `quest_${id}` in code would otherwise clear
  // every quest.
  return { exact: out, has: (k) => out.has(k) || [...prefixes].some((p) => k.startsWith(p)) };
}
const prefixes = new Set();

const graph = buildStoryGraph({
  quests: readDir('quests'),
  npcs: readDir('npcs'),
  scripts: readDir('scripts'),
  triggers: readDir('script_triggers'),
  jobBoards: readDir('job_boards'),
});
const lint = lintStory(graph.nodes, graph.edges, graph.boardQuests, codeStrings());

if (args.includes('--json')) {
  console.log(JSON.stringify({ nodes: [...graph.nodes.values()], edges: graph.edges, lint }, null, 1));
  process.exit(0);
}

const npc = opt('--npc');
if (npc) {
  const chain = npcChain(graph, npc);
  if (!chain.length) { console.log(`${npc} gives no quests.`); process.exit(0); }
  console.log(`${npc} gives:`);
  for (const step of chain) {
    const name = graph.nodes.get(`quest:${step.quest}`)?.label || '(no quest file)';
    console.log(`  ${step.quest}  "${name}"`);
    for (const t of step.then) console.log(`    -> ${t.quest}  via ${t.flag}`);
  }
  // Where the chain goes next: quests anyone else gives that these unlock.
  const mine = new Set(chain.map((s) => `quest:${s.quest}`));
  const out = graph.edges.filter((e) => e.kind === 'precedes' && mine.has(e.from) && !mine.has(e.to));
  for (const e of out) {
    const by = graph.edges.filter((x) => x.kind === 'gives' && x.to === e.to).map((x) => x.from.slice(4));
    console.log(`  hands off: ${e.from.slice(6)} -> ${e.to.slice(6)} (given by ${by.join(', ') || 'nobody'}) via ${e.flag}`);
  }
  process.exit(0);
}

const arc = opt('--arc');
const counts = {};
for (const n of graph.nodes.values()) counts[n.kind] = (counts[n.kind] || 0) + 1;
const ek = {};
for (const e of graph.edges) ek[e.kind] = (ek[e.kind] || 0) + 1;

console.log(`nodes: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.log(`edges: ${Object.entries(ek).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.log('');
for (const [name, a] of Object.entries(lint.arcGaps)) {
  if (arc && arc !== name) continue;
  console.log(`${name}: rungs 1-${a.max}, ${a.gaps.length ? `missing ${a.gaps.join(', ')}` : 'no gaps'}`);
  if (arc) for (const [v, qs] of Object.entries(a.rungs).sort((x, y) => x[0] - y[0])) console.log(`  ${v}: ${qs.join(', ')}`);
}
if (arc) process.exit(0);
console.log('');
console.log(`flags read but never set (${lint.readNeverSet.length}):`);
for (const f of lint.readNeverSet) console.log(`  ${f}  gates ${graph.edges.filter((e) => e.kind === 'gates' && e.from === `flag:${f}`).map((e) => e.to).join(', ')}`);
console.log('');
console.log(`quests nothing starts (${lint.unstarted.length}):`);
for (const q of lint.unstarted) console.log(`  ${q}`);
console.log('');
console.log(`precedence cycles (${lint.cycles.length}):`);
for (const c of lint.cycles) console.log(`  ${c.map((x) => x.slice(6)).join(' -> ')}`);
