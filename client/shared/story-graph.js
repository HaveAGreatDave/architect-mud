// Story graph: quests, NPC dialogue and scripts joined by the flags they
// set and read. Pure: hand it the content rows, get nodes, edges and lint.
// Phase 1 of the Story Map (the dev panel view is built on this).
//
// Node ids are typed: 'npc:<id>', 'quest:<id>', 'script:<id>', 'flag:<key>'.
// Edge kinds:
//   gives    npc -> quest     START_QUEST in the NPC's dialogue
//   turnin   npc -> quest     TURN_IN / COMPLETE in the NPC's dialogue
//   runs     npc|trigger -> script
//   sets     quest|npc|script -> flag
//   gates    flag -> quest|script|flag   a condition on the branch that starts,
//                                        runs or sets it ({op, value} kept)
//   precedes quest -> quest  derived: finishing A makes a flag that opens B

const QUEST_START = new Set(['START_QUEST']);
const QUEST_END = new Set(['TURN_IN', 'COMPLETE']);
// A condition that waits for something to have happened. 'unset', 'neq' and
// 'lt' are "not yet" gates and never order one beat after another.
const POSITIVE_OPS = new Set(['set', 'eq', 'gt']);

const actionType = (a) => a && (a.action || a.type);

export function buildStoryGraph({ quests = [], npcs = [], scripts = [], triggers = [], jobBoards = [] }) {
  const nodes = new Map();
  const edges = [];
  const node = (id, kind, label, extra) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label: label || id.slice(id.indexOf(':') + 1), ...extra });
    return nodes.get(id);
  };
  const edge = (from, to, kind, extra) => edges.push({ from, to, kind, ...extra });

  for (const q of quests) node(`quest:${q.id}`, 'quest', q.name, { repeatable: !!q.repeatable, questType: q.quest_type || 'standard' });
  for (const s of scripts) node(`script:${s.id}`, 'script', s.name || s.id);

  // A quest's own id is its status flag; rewards.flags are set on turn-in.
  for (const q of quests) {
    edge(`quest:${q.id}`, `flag:${q.id}`, 'sets', { value: 'completed' });
    node(`flag:${q.id}`, 'flag');
    // Rewards, including each resolution's: an ending sets its own flags.
    for (const r of [q.rewards, ...(q.resolutions || []).map((x) => x.rewards)]) {
      for (const f of r?.flags || []) {
        node(`flag:${f.flag}`, 'flag');
        edge(`quest:${q.id}`, `flag:${f.flag}`, 'sets', { value: f.value, scope: f.scope });
      }
    }
    // An ending can hand over the next quest (on_turn_in / on_fail
    // .start_quest, at the top level or per resolution).
    for (const h of [q, ...(q.resolutions || [])]) {
      for (const k of ['on_turn_in', 'on_fail']) {
        const next = h[k]?.start_quest;
        if (next) {
          edge(`quest:${q.id}`, `quest:${next}`, 'gives', { on: k, resolution: h === q ? null : h.id });
          edge(`quest:${q.id}`, `quest:${next}`, 'precedes', { on: k });
        }
      }
    }
    for (const b of q.blocks || []) edge(`quest:${q.id}`, `quest:${b}`, 'blocks');
  }

  // What an action does, as edges from `src`, under the gates in force.
  const applyAction = (src, a, gates, npcId) => {
    const t = actionType(a);
    if (QUEST_START.has(t) && a.quest_id) {
      edge(src, `quest:${a.quest_id}`, 'gives');
      for (const g of gates) gate(g, `quest:${a.quest_id}`, a.quest_id);
    } else if (QUEST_END.has(t) && a.quest_id) {
      edge(src, `quest:${a.quest_id}`, 'turnin');
    } else if (t === 'SET_FLAG' && a.flag) {
      node(`flag:${a.flag}`, 'flag');
      edge(src, `flag:${a.flag}`, 'sets', { value: a.value, scope: a.scope, via: npcId });
      for (const g of gates) gate(g, `flag:${a.flag}`);
    } else if (t === 'EXECUTE_SCRIPT' && (a.scriptId || a.script_id)) {
      const sid = a.scriptId || a.script_id;
      edge(src, `script:${sid}`, 'runs');
      for (const g of gates) gate(g, `script:${sid}`);
    }
  };
  // A quest's offer is always gated on its own status being unset; that
  // self-gate says nothing about story order, so it's dropped.
  const gate = (c, to, selfQuest) => {
    if (!c.flag || c.flag === selfQuest) return;
    node(`flag:${c.flag}`, 'flag');
    edge(`flag:${c.flag}`, to, 'gates', { op: c.op, value: c.value });
  };

  // Walk each dialogue tree from root, carrying the conditions of every
  // option taken to reach a node. A node keeps the gates of the first path
  // that reaches it.
  for (const n of npcs) {
    const tree = n.dialogue_tree;
    if (!tree || typeof tree !== 'object' || !tree.root) continue;
    const src = `npc:${n.id}`;
    const npcNode = node(src, 'npc', n.name, { faction: n.faction || null });
    const seen = new Set();
    const queue = [['root', []]];
    while (queue.length) {
      const [key, gates] = queue.shift();
      if (seen.has(key)) continue;
      seen.add(key);
      const nd = tree[key];
      if (!nd || typeof nd !== 'object') continue;
      for (const a of nd.actions || []) applyAction(src, a, gates, n.id);
      for (const o of nd.options || []) {
        const og = o.conditions?.length ? gates.concat(o.conditions.filter((c) => c.flag)) : gates;
        for (const a of o.actions || []) applyAction(src, a, og, n.id);
        if (o.next) queue.push([o.next, og]);
      }
    }
    npcNode.dialogueNodes = seen.size;
  }

  // Scripts: setflag and counter nodes set, condition nodes gate the script,
  // script nodes run another. A shared script takes its keys from each
  // trigger's params ('bar_${venue}_regular'), so it's read once per trigger.
  const paramSets = new Map(); // script id -> [params]
  for (const t of triggers) {
    if (!t.script_id || !t.params || !Object.keys(t.params).length) continue;
    if (!paramSets.has(t.script_id)) paramSets.set(t.script_id, []);
    paramSets.get(t.script_id).push(t.params);
  }
  const fill = (str, P) => typeof str === 'string' ? str.replace(/\$\{(\w+)\}/g, (m, k) => (k in P ? String(P[k]) : m)) : str;
  for (const s of scripts) {
    const src = `script:${s.id}`;
    const gnodes = Object.values(s.graph?.nodes || {});
    for (const P of paramSets.get(s.id) || [{}]) {
      for (const nd of gnodes) {
        const flag = fill(nd.flag, P);
        if ((nd.type === 'setflag' || nd.type === 'counter') && flag && !flag.includes('${')) {
          node(`flag:${flag}`, 'flag');
          edge(src, `flag:${flag}`, 'sets', { value: nd.type === 'counter' ? 'count' : nd.value, scope: nd.scope });
        } else if (nd.type === 'action') {
          applyAction(src, { ...nd.params, action: nd.action }, [], null);
        } else if (nd.type === 'script' && nd.scriptId) {
          const sid = fill(nd.scriptId, P);
          if (!sid.includes('${')) edge(src, `script:${sid}`, 'runs');
        } else if (nd.type === 'condition' && nd.condition?.flag) {
          const f = fill(nd.condition.flag, P);
          if (!f.includes('${')) gate({ ...nd.condition, flag: f }, src);
        }
      }
    }
  }

  for (const t of triggers) {
    if (!t.script_id) continue;
    const id = `trigger:${t.id}`;
    node(id, 'trigger', t.name, { event: t.event });
    edge(id, `script:${t.script_id}`, 'runs');
  }

  const boardQuests = new Set();
  for (const b of jobBoards) for (const q of b.quest_pool || []) boardQuests.add(q);

  // Quest precedence: A precedes B when a flag A sets (its own status, its
  // reward flags, or a flag set on A's turn-in branch) positively gates B.
  const setters = new Map(); // flag -> Set(quest ids)
  const addSetter = (flag, qid) => {
    if (!setters.has(flag)) setters.set(flag, new Set());
    setters.get(flag).add(qid);
  };
  for (const e of edges) {
    if (e.kind === 'sets' && e.from.startsWith('quest:')) addSetter(e.to.slice(5), e.from.slice(6));
  }
  const setValues = (qid, flagNode) => edges
    .filter((x) => x.kind === 'sets' && x.from === `quest:${qid}` && x.to === flagNode)
    .map((x) => Number(x.value));
  for (const e of [...edges]) {
    if (e.kind !== 'gates' || !POSITIVE_OPS.has(e.op) || !e.to.startsWith('quest:')) continue;
    const flag = e.from.slice(5);
    let from = [...(setters.get(flag) || [])];
    // A ladder gate (gt n) opens after the lowest rung that passes it. Every
    // higher rung passes it too, but those come later, not before.
    if (e.op === 'gt') {
      const passing = from
        .map((qid) => [qid, Math.min(...setValues(qid, e.from).filter((v) => v > Number(e.value)))])
        .filter(([, v]) => Number.isFinite(v));
      const low = Math.min(...passing.map(([, v]) => v));
      from = passing.filter(([, v]) => v === low).map(([q]) => q);
    }
    for (const qid of from) {
      if (`quest:${qid}` !== e.to) edge(`quest:${qid}`, e.to, 'precedes', { flag });
    }
  }

  return { nodes, edges, boardQuests, lint: lintStory(nodes, edges, boardQuests) };
}

// Findings a writer would want before a deploy. Flags set or read by engine
// or plugin code look orphaned here; the caller passes `codeFlags` to clear
// them (see scripts/content/story-report.mjs).
export function lintStory(nodes, edges, boardQuests, codeFlags = new Set()) {
  const setFlags = new Set();
  const readFlags = new Map(); // flag -> [targets]
  for (const e of edges) {
    if (e.kind === 'sets') setFlags.add(e.to.slice(5));
    if (e.kind === 'gates') {
      const f = e.from.slice(5);
      if (!readFlags.has(f)) readFlags.set(f, []);
      readFlags.get(f).push(e.to);
    }
  }

  const readNeverSet = [...readFlags.keys()].filter((f) => !setFlags.has(f) && !codeFlags.has(f)).sort();

  const started = new Set(edges.filter((e) => e.kind === 'gives').map((e) => e.to.slice(6)));
  const unstarted = [...nodes.values()]
    .filter((n) => n.kind === 'quest' && !String(n.questType).endsWith('_template') && !started.has(n.id.slice(6)) && !boardQuests.has(n.id.slice(6)) && !(codeFlags.exact || codeFlags).has(n.id.slice(6)))
    .map((n) => n.id.slice(6)).sort();

  // Arc ladders: every '<order>_arc' value set by a quest, and the holes.
  const arcs = {};
  for (const e of edges) {
    if (e.kind !== 'sets' || !/_arc$/.test(e.to)) continue;
    const v = Number(e.value);
    if (!Number.isInteger(v)) continue;
    const a = (arcs[e.to.slice(5)] ||= {});
    (a[v] ||= []).push(e.from.slice(e.from.indexOf(':') + 1));
  }
  const arcGaps = {};
  for (const [arc, rungs] of Object.entries(arcs)) {
    const max = Math.max(...Object.keys(rungs).map(Number));
    const gaps = [];
    for (let i = 1; i <= max; i++) if (!rungs[i]) gaps.push(i);
    arcGaps[arc] = { max, gaps, rungs };
  }

  return { readNeverSet, unstarted, arcGaps, cycles: findCycles(edges) };
}

function findCycles(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (e.kind !== 'precedes') continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const cycles = [];
  const state = new Map(); // 1 on stack, 2 done
  const stack = [];
  const visit = (v) => {
    state.set(v, 1);
    stack.push(v);
    for (const w of adj.get(v) || []) {
      if (state.get(w) === 1) cycles.push(stack.slice(stack.indexOf(w)).concat(w));
      else if (!state.get(w)) visit(w);
    }
    stack.pop();
    state.set(v, 2);
  };
  for (const v of adj.keys()) if (!state.get(v)) visit(v);
  return cycles;
}

// The quests an NPC gives, in story order, with what joins each to the next.
export function npcChain(graph, npcId) {
  const given = graph.edges.filter((e) => e.kind === 'gives' && e.from === `npc:${npcId}`).map((e) => e.to);
  const set = new Set(given);
  const prec = graph.edges.filter((e) => e.kind === 'precedes' && set.has(e.from) && set.has(e.to));
  const indeg = new Map(given.map((q) => [q, 0]));
  for (const e of prec) indeg.set(e.to, indeg.get(e.to) + 1);
  const order = [];
  const ready = given.filter((q) => !indeg.get(q));
  while (ready.length) {
    const q = ready.shift();
    if (order.includes(q)) continue;
    order.push(q);
    for (const e of prec) if (e.from === q) { indeg.set(e.to, indeg.get(e.to) - 1); if (!indeg.get(e.to)) ready.push(e.to); }
  }
  for (const q of given) if (!order.includes(q)) order.push(q);
  return order.map((q) => ({
    quest: q.slice(6),
    then: prec.filter((e) => e.from === q).map((e) => ({ quest: e.to.slice(6), flag: e.flag })),
    givenBy: graph.edges.filter((e) => e.kind === 'gives' && e.to === q).map((e) => e.from.slice(4)),
  }));
}
