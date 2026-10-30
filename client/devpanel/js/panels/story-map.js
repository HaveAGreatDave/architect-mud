// Story Map: every quest on one canvas, laid out by what unlocks what, in
// lanes you can name and order (storylines table, content/storylines/).
//
// The map never edits story; the only thing it writes is storyline rows. The
// graph comes from buildStoryGraph (client/shared/story-graph.js, the same
// builder scripts/content/story-report.mjs prints) over the rows the VINE Suite
// reads, so there's nothing here to keep in sync. Your lanes come first, in your
// order; unplaced quests fall into derived lanes (quest-id prefix, else the
// giver), left to right by how many 'precedes' steps deep they sit.
//
//   drag            pan            wheel         zoom
//   click a quest   focus: dim all but what unlocks it and what it unlocks
//   double-click    open the quest (or an NPC card's dialogue) in VINE
//   alt-click       what-if cut: mark it removed and show what breaks in red
//   click a lane's name (one you made)   edit it in the side panel

let _sm = null; // { data, graph, hidden:Set, focus, laneSel, cut:Set, view:{x,y,k}, layout }

const SM_CARD_W = 180, SM_CARD_H = 38, SM_COL = 230, SM_ROW = 50, SM_LANE_PAD = 18, SM_LABEL_W = 170;

async function fetchStoryMap() {
  const [npcs, scripts, quests, triggers, jobBoards, storylines] = await Promise.all([
    directAPI('/npcs'), API('/scripts'), API('/quests'), API('/script-triggers'), API('/job-boards'), API('/storylines'),
  ]);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
  return {
    npcs: arr(npcs).map((n) => ({ ...n, dialogue_tree: parse(n.dialogue_tree) })),
    scripts: arr(scripts).map((s) => ({ ...s, graph: parse(s.graph) })),
    quests: arr(quests).map((q) => ({ ...q, rewards: parse(q.rewards) })),
    triggers: arr(triggers).map((t) => ({ ...t, params: parse(t.params) })),
    jobBoards: arr(jobBoards).map((b) => ({ ...b, quest_pool: parse(b.quest_pool) })),
    storylines: arr(storylines).map((s) => ({ ...s, nodes: parse(s.nodes) || [] })),
  };
}

// ── Model: the builder's typed graph, reshaped for drawing ──
// Builder ids are typed ('quest:x', 'npc:x', 'flag:x'); the map keys quests
// by bare id. Each quest gets its givers, the positive gates on its offer,
// its turn-ins, a lane and a depth.
const SM_POSITIVE = new Set(['set', 'eq', 'gt']);

function _smModel(raw) {
  const bare = (id) => id.slice(id.indexOf(':') + 1);
  const nodes = new Map();
  for (const n of raw.nodes.values()) {
    if (n.kind === 'quest') nodes.set(bare(n.id), { id: bare(n.id), type: 'quest', name: n.label, repeatable: n.repeatable, starts: [], gates: [], turnIns: [] });
    else if (n.kind === 'npc' || n.kind === 'script') nodes.set(bare(n.id), { id: bare(n.id), type: n.kind, name: n.label });
  }
  const flags = new Map(); // flag -> { flag, setters: [{by, value}] }
  const edges = [];
  for (const e of raw.edges) {
    const to = bare(e.to), from = bare(e.from);
    const q = nodes.get(to);
    if (e.kind === 'gives' && q?.type === 'quest') q.starts.push({ npc: from, viaQuest: e.from.startsWith('quest:') });
    else if (e.kind === 'turnin' && q?.type === 'quest') q.turnIns.push(from);
    else if (e.kind === 'gates' && q?.type === 'quest' && e.to.startsWith('quest:') && SM_POSITIVE.has(e.op)) q.gates.push({ flag: from, op: e.op, value: e.value });
    else if (e.kind === 'sets') {
      if (!flags.has(to)) flags.set(to, { flag: to, setters: [] });
      // A quest's own status flag walks active, completed, turned_in: '*' meets any eq.
      flags.get(to).setters.push({ by: from, value: e.from === 'quest:' + to ? '*' : e.value });
    } else if (e.kind === 'precedes' && e.to.startsWith('quest:') && e.from.startsWith('quest:')) {
      edges.push({ from, to, kind: 'unlocks', flag: e.flag || e.on });
    }
  }

  // Lanes: the word after 'quest_' when three or more quests share it, else the
  // first giver, else the job board, else Unsorted.
  const quests = [...nodes.values()].filter((n) => n.type === 'quest');
  const pre = (id) => id.replace(/^quest_/, '').split('_')[0];
  const preCount = new Map();
  for (const q of quests) preCount.set(pre(q.id), (preCount.get(pre(q.id)) || 0) + 1);
  const lanes = new Map();
  const lane = (key, name) => { if (!lanes.has(key)) lanes.set(key, { id: key, name, nodes: [] }); return lanes.get(key); };
  for (const q of quests) {
    const npcGiver = q.starts.find((s) => !s.viaQuest);
    if (preCount.get(pre(q.id)) >= 3) { q.lane = 'pre:' + pre(q.id); lane(q.lane, pre(q.id)); }
    else if (npcGiver) { q.lane = 'npc:' + npcGiver.npc; lane(q.lane, nodes.get(npcGiver.npc)?.name || npcGiver.npc); }
    else if (raw.boardQuests.has(q.id)) { q.lane = 'board'; lane('board', 'Job boards'); }
    else { q.lane = 'unsorted'; lane('unsorted', 'Unsorted'); }
    lanes.get(q.lane).nodes.push(q.id);
  }
  for (const l of lanes.values()) {
    if (!l.id.startsWith('pre:')) continue;
    const tally = new Map();
    for (const id of l.nodes) for (const s of nodes.get(id).starts) if (!s.viaQuest) tally.set(s.npc, (tally.get(s.npc) || 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (top) l.name = `${l.name} (${nodes.get(top[0])?.name || top[0]})`;
  }

  // Depth: the longest precedes chain into a quest, cycle-safe.
  const preds = new Map();
  for (const e of edges) { if (!preds.has(e.to)) preds.set(e.to, new Set()); preds.get(e.to).add(e.from); }
  const depth = new Map(), onStack = new Set();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (onStack.has(id)) return 0;
    onStack.add(id);
    let d = 0;
    for (const p of preds.get(id) || []) d = Math.max(d, depthOf(p) + 1);
    onStack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const q of quests) q.depth = depthOf(q.id);

  // Findings from the builder's lint. In the browser there's no code scan, so
  // flags set by engine or plugin code show as read-never-set; story-report.mjs
  // clears those.
  const L = raw.lint;
  const findings = [
    ...L.cycles.map((c) => ({ kind: 'cycle', flag: c.map(bare).join(' → ') })),
    ...Object.entries(L.arcGaps).filter(([, a]) => a.gaps.length).map(([f, a]) => ({ kind: 'ladder_gap', flag: f, missing: a.gaps })),
    ...L.readNeverSet.map((f) => ({ kind: 'read_never_set', flag: f })),
    ...L.unstarted.map((q) => ({ kind: 'no_starter', quest: q })),
  ];
  return { nodes, edges, flags, lanes, findings };
}

function _smSatisfies(cond, value) {
  if (cond.op === 'set') return true;
  if (value === '*') return cond.op === 'eq';
  if (cond.op === 'eq') return String(value) === String(cond.value);
  if (cond.op === 'gt') return Number(value) > Number(cond.value);
  return false;
}

// What-if cut. A flag strands when it had setters and every one is broken. A
// quest breaks when it's cut, when every giver is broken, or when a gate on its
// offer can no longer be met; a broken quest stops setting flags, so this runs
// to a fixpoint. Flags with no setter in content are set by code and never strand.
function _smWhatIf(g, cutIds) {
  const broken = new Set(cutIds);
  const stranded = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of g.flags.values()) {
      if (!stranded.has(f.flag) && f.setters.length && f.setters.every((s) => broken.has(s.by))) { stranded.add(f.flag); changed = true; }
    }
    for (const q of g.nodes.values()) {
      if (q.type !== 'quest' || broken.has(q.id) || !q.starts.length) continue;
      const giverOk = q.starts.some((s) => !broken.has(s.npc));
      const gatesOk = q.gates.every((c) => {
        const f = g.flags.get(c.flag);
        return !f || !f.setters.length || f.setters.some((s) => !broken.has(s.by) && _smSatisfies(c, s.value));
      });
      if (!giverOk || !gatesOk) { broken.add(q.id); changed = true; }
    }
  }
  return { broken, stranded };
}

// ── Authored lanes ──
// A storyline row is a lane you name and order yourself: { id, name, color,
// sort_order, notes, nodes: [{ ref, x }] }, ref a quest or NPC id and x its
// column. A quest lives in one authored lane at most and leaves its derived
// lane when placed; an NPC can sit in any number of lanes, each a separate
// card. Everything not placed stays in the derived lanes below.
function _smApplyStorylines(g, rows) {
  const authored = [];
  for (const row of rows.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name))) {
    const key = 'sl:' + row.id;
    const placed = (row.nodes || []).filter((p) => p && p.ref).sort((a, b) => a.x - b.x);
    for (const p of placed) {
      const q = g.nodes.get(p.ref);
      if (q?.type !== 'quest' || q.lane?.startsWith('sl:')) continue;
      const old = g.lanes.get(q.lane);
      if (old) { old.nodes = old.nodes.filter((id) => id !== q.id); if (!old.nodes.length) g.lanes.delete(q.lane); }
      q.lane = key;
    }
    authored.push({ id: key, row, name: row.name, color: row.color, authored: true, placed,
      nodes: placed.filter((p) => g.nodes.get(p.ref)?.lane === key).map((p) => p.ref) });
  }
  const derived = [...g.lanes.values()].sort((a, b) =>
    (a.id === 'unsorted') - (b.id === 'unsorted') || b.nodes.length - a.nodes.length || a.name.localeCompare(b.name));
  derived.forEach((l, i) => { l.color = _smLaneColor(i); });
  g.laneOrder = [...authored, ...derived];
  g.lanes = new Map(g.laneOrder.map((l) => [l.id, l]));
}

function _smRebuild() {
  const d = _sm.data;
  _sm.graph = _smModel(StoryGraph.buildStoryGraph(d));
  _smApplyStorylines(_sm.graph, d.storylines);
}

function renderStoryMap(data) {
  const prev = _sm;
  _sm = {
    data,
    hidden: prev ? prev.hidden : new Set(),
    focus: null,
    laneSel: null,
    cut: prev ? prev.cut : new Set(),
    view: prev ? prev.view : { x: 0, y: 0, k: 0.8 },
    showFindings: false,
  };
  _smRebuild();
  const el = document.getElementById('list-panel');
  el.innerHTML = `
    <div class="sm-root">
      <div class="sm-bar" id="sm-bar"></div>
      <div class="sm-body">
        <svg class="sm-svg" id="sm-svg"><g id="sm-world"></g></svg>
        <div class="sm-side" id="sm-side"></div>
      </div>
    </div>
    <datalist id="sm-refs"></datalist>`;
  document.getElementById('sm-refs').innerHTML =
    [...data.quests.map((q) => [q.id, q.name]), ...data.npcs.map((n) => [n.id, n.name])]
      .map(([id, name]) => `<option value="${_smEsc(id)}">${_smEsc(name)}</option>`).join('');
  _smBindCanvas();
  _smRenderAll();
}

function _smEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _smLaneColor(i) {
  const hues = [320, 145, 30, 190, 270, 55, 0, 100, 220, 170];
  return `hsl(${hues[i % hues.length]} 70% 60%)`;
}

function _smNpcName(id) {
  return _sm.graph.nodes.get(id)?.name || _sm.data.npcs.find((n) => n.id === id)?.name || id;
}

// Authored lanes first, in your order, one card per placement. Derived lanes
// follow, cards stacked per depth column. pos is keyed by quest id, or
// 'npc:<laneId>:<index>' for an NPC placement.
function _smLayout() {
  const g = _sm.graph;
  const pos = new Map();
  const bands = [];
  let y = 0;
  for (const lane of g.laneOrder) {
    const color = lane.color;
    if (_sm.hidden.has(lane.id)) { bands.push({ lane, color, hidden: true }); continue; }
    let rows = 1;
    if (lane.authored) {
      lane.placed.forEach((p, i) => {
        const at = { x: SM_LABEL_W + i * SM_COL, y: y + SM_LANE_PAD, color, col: i };
        if (g.nodes.get(p.ref)?.type === 'quest') { if (g.nodes.get(p.ref).lane === lane.id) pos.set(p.ref, at); }
        else pos.set(`npc:${lane.id}:${i}`, { ...at, npc: p.ref });
      });
    } else {
      const perCol = new Map();
      const ids = lane.nodes.slice().sort((a, b) => g.nodes.get(a).depth - g.nodes.get(b).depth || a.localeCompare(b));
      // A lane with no chain inside it (job boards, flight contracts) is a grid,
      // not one tall column.
      const flat = ids.every((id) => g.nodes.get(id).depth === 0);
      for (const [i, id] of ids.entries()) {
        const d = flat ? i % 6 : g.nodes.get(id).depth;
        const r = perCol.get(d) || 0;
        perCol.set(d, r + 1);
        rows = Math.max(rows, r + 1);
        pos.set(id, { x: SM_LABEL_W + d * SM_COL, y: y + SM_LANE_PAD + r * SM_ROW, color });
      }
    }
    const h = SM_LANE_PAD * 2 + rows * SM_ROW - (SM_ROW - SM_CARD_H);
    bands.push({ lane, color, y, h });
    y += h + 6;
  }
  return { pos, bands };
}

// Upstream and downstream of the focused quest, over unlock edges only.
function _smReach(start) {
  const g = _sm.graph;
  const up = new Set([start]), down = new Set([start]);
  const walk = (set, fwd) => {
    let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const n of frontier) for (const e of g.edges) {
        if (e.kind !== 'unlocks') continue;
        const [a, b] = fwd ? [e.from, e.to] : [e.to, e.from];
        if (a === n && !set.has(b)) { set.add(b); next.push(b); }
      }
      frontier = next;
    }
  };
  walk(up, false); walk(down, true);
  return new Set([...up, ...down]);
}

function _smRenderAll() {
  _smRenderBar();
  _smRenderWorld();
  _smRenderSide();
}

function _smRenderBar() {
  const g = _sm.graph;
  const chips = g.laneOrder.map((l) => `
    <label class="sm-chip${_sm.hidden.has(l.id) ? ' off' : ''}${l.authored ? ' authored' : ''}" style="--lane:${l.color}">
      <input type="checkbox" ${_sm.hidden.has(l.id) ? '' : 'checked'} onchange="smToggleLane('${_smEsc(l.id)}')">
      ${_smEsc(l.name)} <span class="sm-n">${l.authored ? l.placed.length : l.nodes.length}</span></label>`).join('');
  document.getElementById('sm-bar').innerHTML = `
    <button class="action-btn primary" onclick="smNewLane()">+ Lane</button>
    <button class="action-btn" onclick="smAllLanes(true)">All</button>
    <button class="action-btn" onclick="smAllLanes(false)">None</button>
    <button class="action-btn${_sm.showFindings ? ' active' : ''}" onclick="smToggleFindings()">Findings (${g.findings.length})</button>
    ${_sm.cut.size ? `<button class="action-btn sm-cutbtn" onclick="smClearCut()">Clear cut (${_sm.cut.size})</button>` : ''}
    <button class="action-btn" onclick="smFit()">Fit</button>
    <span class="sm-chips">${chips}</span>`;
}

function _smRenderWorld() {
  const g = _sm.graph;
  const { pos, bands } = _smLayout();
  _sm.layout = { pos, bands };
  const focusSet = _sm.focus ? _smReach(_sm.focus) : null;
  const cut = _sm.cut.size ? _smWhatIf(g, _sm.cut) : null;
  const laneOf = (id) => g.nodes.get(id)?.lane;

  let svg = '';
  const maxX = Math.max(SM_LABEL_W + SM_COL, ...[...pos.values()].map((p) => p.x + SM_CARD_W + 40));
  for (const b of bands) {
    if (b.hidden) continue;
    const nm = b.lane.name.length > 19 ? b.lane.name.slice(0, 18) + '…' : b.lane.name;
    svg += `<rect class="sm-band${b.lane.authored ? ' authored' : ''}${_sm.laneSel === b.lane.id ? ' sel' : ''}" x="0" y="${b.y}" width="${maxX}" height="${b.h}" style="--lane:${b.color}"/>
      <text class="sm-band-label${b.lane.authored ? ' authored' : ''}" data-lane="${_smEsc(b.lane.id)}" x="10" y="${b.y + 22}" style="fill:${b.color}">${_smEsc(nm)}<title>${_smEsc(b.lane.name)}${b.lane.authored ? ' (click to edit)' : ' (derived)'}</title></text>`;
  }

  // Unlock edges between visible quests. One edge per pair; its title lists the
  // flags. In an authored lane, an edge that runs right to left means the game
  // lets the player reach a step before one you placed ahead of it: amber.
  const pairs = new Map();
  for (const e of g.edges) {
    if (e.kind !== 'unlocks' || !pos.has(e.from) || !pos.has(e.to)) continue;
    const k = e.from + '>' + e.to;
    if (!pairs.has(k)) pairs.set(k, { from: e.from, to: e.to, flags: new Set() });
    pairs.get(k).flags.add(e.flag);
  }
  for (const p of pairs.values()) {
    const a = pos.get(p.from), b = pos.get(p.to);
    const x1 = a.x + SM_CARD_W, y1 = a.y + SM_CARD_H / 2, x2 = b.x, y2 = b.y + SM_CARD_H / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    const cross = laneOf(p.from) !== laneOf(p.to);
    const order = !cross && laneOf(p.from)?.startsWith('sl:') && b.col <= a.col;
    const dim = focusSet && !(focusSet.has(p.from) && focusSet.has(p.to));
    const dead = cut && cut.broken.has(p.from);
    const cls = `sm-edge${cross ? ' cross' : ''}${order ? ' order' : ''}${dim ? ' dim' : ''}${dead ? ' dead' : ''}${x2 <= x1 ? ' back' : ''}`;
    const title = [...p.flags].join(', ') + (order ? ' (placed out of the order the game allows)' : '');
    svg += `<path class="${cls}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"><title>${_smEsc(title)}</title></path>`;
  }

  // A thin rail joins consecutive cards in an authored lane, so the order you
  // set reads even where no unlock edge runs.
  for (const lane of g.laneOrder) {
    if (!lane.authored || _sm.hidden.has(lane.id)) continue;
    const keys = lane.placed.map((p, i) => (g.nodes.get(p.ref)?.type === 'quest' ? p.ref : `npc:${lane.id}:${i}`)).filter((k) => pos.has(k));
    for (let i = 1; i < keys.length; i++) {
      const a = pos.get(keys[i - 1]), b = pos.get(keys[i]);
      svg += `<line class="sm-rail" x1="${a.x + SM_CARD_W}" y1="${a.y + SM_CARD_H / 2}" x2="${b.x}" y2="${b.y + SM_CARD_H / 2}" style="--lane:${lane.color}"/>`;
    }
  }

  for (const [key, p] of pos) {
    if (p.npc) {
      const nm = _smNpcName(p.npc);
      svg += `<g class="sm-card npc" data-npc="${_smEsc(p.npc)}" transform="translate(${p.x},${p.y})" style="--lane:${p.color}">
        <rect width="${SM_CARD_W}" height="${SM_CARD_H}" rx="19"/>
        <text class="t" x="14" y="23">${_smEsc(nm.length > 24 ? nm.slice(0, 23) + '…' : nm)}</text>
        <title>${_smEsc(p.npc)}: double-click for dialogue</title></g>`;
      continue;
    }
    const n = g.nodes.get(key);
    const giver = n.starts[0] ? _smNpcName(n.starts[0].npc) : 'no giver';
    const dim = focusSet && !focusSet.has(key);
    const broken = cut && cut.broken.has(key);
    const isCut = _sm.cut.has(key);
    const cls = `sm-card${dim ? ' dim' : ''}${broken ? ' broken' : ''}${isCut ? ' cut' : ''}${_sm.focus === key ? ' focus' : ''}${n.starts.length ? '' : ' orphan'}`;
    const label = n.name.length > 26 ? n.name.slice(0, 25) + '…' : n.name;
    const sub = giver.length > 30 ? giver.slice(0, 29) + '…' : giver;
    svg += `<g class="${cls}" data-id="${_smEsc(key)}" transform="translate(${p.x},${p.y})" style="--lane:${p.color}">
      <rect width="${SM_CARD_W}" height="${SM_CARD_H}" rx="4"/>
      <text class="t" x="8" y="15">${_smEsc(label)}${n.repeatable ? ' ↻' : ''}</text>
      <text class="s" x="8" y="30">${_smEsc(sub)}</text>
      <title>${_smEsc(key)}</title></g>`;
  }
  document.getElementById('sm-world').innerHTML = svg;
  _smApplyView();
}

function _smRenderSide() {
  const side = document.getElementById('sm-side');
  const g = _sm.graph;
  const name = (id) => _smEsc(g.nodes.get(id)?.name || _smNpcName(id));
  const npcLink = (id) => `<a href="#" onclick="smOpen('dialogue','${_smEsc(id)}');return false">${name(id)}</a>`;
  const questLink = (id) => g.nodes.get(id)?.type === 'quest'
    ? `<a href="#" onclick="smFocus('${_smEsc(id)}');return false">${name(id)}</a>`
    : g.nodes.get(id)?.type === 'npc' ? npcLink(id)
    : g.nodes.get(id)?.type === 'script' ? `<a href="#" onclick="smOpen('script','${_smEsc(id)}');return false">${name(id)}</a>`
    : name(id);

  if (_sm.showFindings) {
    const labels = {
      cycle: 'Unlock cycles',
      ladder_gap: 'Gaps in an arc ladder',
      read_never_set: 'Read but never set in content (most are set by code; story-report.mjs filters those)',
      no_starter: 'Nothing starts it (some are started by code)',
    };
    const by = new Map();
    for (const f of g.findings) { if (!by.has(f.kind)) by.set(f.kind, []); by.get(f.kind).push(f); }
    side.innerHTML = '<h3>Findings</h3>' + Object.keys(labels).filter((k) => by.has(k)).map((k) =>
      `<details${k === 'cycle' || k === 'ladder_gap' ? ' open' : ''}><summary>${labels[k]} (${by.get(k).length})</summary><ul>` +
      by.get(k).map((f) => `<li>${f.quest ? questLink(f.quest)
        : `<code>${_smEsc(f.flag)}</code>${f.missing ? ` missing ${f.missing.join(', ')}` : ''}`}</li>`).join('') +
      '</ul></details>').join('');
    return;
  }

  const lane = _sm.laneSel && g.lanes.get(_sm.laneSel);
  if (lane && lane.authored) {
    const r = lane.row;
    const items = lane.placed.map((p, i) => `<li class="sm-place"><div class="sm-place-row">
      <span>${g.nodes.get(p.ref)?.type === 'quest' ? questLink(p.ref) : npcLink(p.ref) + ' <span class="sm-gate">NPC</span>'}</span>
      <span class="sm-place-btns">
        <button class="action-btn" title="Earlier" onclick="smMovePlacement(${i},-1)">←</button>
        <button class="action-btn" title="Later" onclick="smMovePlacement(${i},1)">→</button>
        <button class="action-btn danger" title="Take out of this lane" onclick="smRemovePlacement(${i})">✕</button></span></div></li>`).join('');
    side.innerHTML = `
      <h3>Lane</h3>
      <div class="field"><label>Name</label><input id="sm-ln-name" value="${_smEsc(r.name)}"></div>
      <div class="field"><label>Colour</label><input id="sm-ln-color" type="color" value="${_smEsc(/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#c9a227')}"></div>
      <div class="field"><label>Notes</label><textarea id="sm-ln-notes" rows="3">${_smEsc(r.notes || '')}</textarea></div>
      <p><button class="action-btn primary" onclick="smSaveLaneFields()">Save</button>
         <button class="action-btn" onclick="smMoveLane(-1)">Move up</button>
         <button class="action-btn" onclick="smMoveLane(1)">Move down</button>
         <button class="action-btn danger" onclick="smDeleteLane()">Delete</button></p>
      <h4>In order (${lane.placed.length})</h4>
      ${items ? `<ol class="sm-places">${items}</ol>` : '<p class="sm-help">Empty. Add quests and NPCs below, or use "Add to lane" on a focused quest.</p>'}
      <div class="sm-add"><input id="sm-ln-add" list="sm-refs" placeholder="quest or NPC id">
        <button class="action-btn" onclick="smAddPlacement()">Add</button></div>
      <p><button class="action-btn" onclick="smAutoArrange()" title="Order the quests by what unlocks what; each NPC stays just before the quest after it">Auto-arrange</button></p>
      <p class="sm-help">Saves to content/storylines/${_smEsc(r.id)}.json. A lane is framing only: the game never reads it.</p>`;
    return;
  }

  if (!_sm.focus) {
    const cut = _sm.cut.size ? _smWhatIf(g, _sm.cut) : null;
    side.innerHTML = `<h3>Story Map</h3>
      <p class="sm-help">Click a quest to focus it. Double-click opens it in VINE. Alt-click cuts it to see what breaks.</p>
      <p class="sm-help">Click a lane's name to edit it; "+ Lane" makes one. Lanes you make come first, in the order you set; the rest are derived from quest ids and givers.</p>
      <p class="sm-help">Bold yellow edges cross between lanes; amber ones run against the order you set; dashed ones run backwards.</p>
      ${cut ? `<h4>Cut breaks ${[...cut.broken].filter((id) => g.nodes.get(id)?.type === 'quest').length} quests</h4>
        <ul>${[...cut.broken].filter((id) => g.nodes.get(id)?.type === 'quest').map((id) => `<li>${questLink(id)}</li>`).join('')}</ul>
        <h4>Flags left unset</h4><p>${[...cut.stranded].map((f) => `<code>${_smEsc(f)}</code>`).join(' ') || 'none'}</p>` : ''}`;
    return;
  }

  const id = _sm.focus;
  const n = g.nodes.get(id);
  const ups = g.edges.filter((e) => e.kind === 'unlocks' && e.to === id);
  const downs = g.edges.filter((e) => e.kind === 'unlocks' && e.from === id);
  const sets = [...g.flags.values()].filter((f) => f.setters.some((s) => s.by === id) && f.flag !== id).map((f) => f.flag);
  const gateText = (c) => `<code>${_smEsc(c.flag)}</code> ${_smEsc(c.op || 'set')}${c.value != null ? ' ' + _smEsc(c.value) : ''}`;
  const authored = g.laneOrder.filter((l) => l.authored);
  const laneSelect = authored.length ? `<h4>Lane</h4><select onchange="smSetQuestLane('${_smEsc(id)}', this.value)">
      <option value="">(derived)</option>
      ${authored.map((l) => `<option value="${_smEsc(l.row.id)}"${n.lane === l.id ? ' selected' : ''}>${_smEsc(l.name)}</option>`).join('')}
    </select>` : '';
  side.innerHTML = `
    <h3>${_smEsc(n.name)}</h3>
    <div class="sm-id">${_smEsc(id)}${n.repeatable ? ' · repeatable' : ''}</div>
    <p><button class="action-btn" onclick="smOpen('quest','${_smEsc(id)}')">Open in VINE</button>
       <button class="action-btn" onclick="smToggleCut('${_smEsc(id)}')">${_sm.cut.has(id) ? 'Uncut' : 'What if cut?'}</button>
       <button class="action-btn" onclick="smFocus(null)">Clear focus</button></p>
    ${laneSelect}
    <h4>Given by</h4>
    ${n.starts.length ? '<ul>' + n.starts.map((s) => `<li>${questLink(s.npc)}${s.viaQuest ? ' (on its ending)' : ''}</li>`).join('') + '</ul>' : '<p class="sm-help">Nothing in content starts this quest.</p>'}
    ${n.gates.length ? `<h4>Offered when</h4><p class="sm-gate">${n.gates.map(gateText).join('<br>')}</p>` : ''}
    ${n.turnIns.length ? `<h4>Turned in to</h4><ul>${[...new Set(n.turnIns)].map((t) => `<li>${npcLink(t)}</li>`).join('')}</ul>` : ''}
    <h4>Unlocked by</h4>
    ${ups.length ? '<ul>' + ups.map((e) => `<li>${questLink(e.from)} <span class="sm-gate">via ${_smEsc(e.flag)}</span></li>`).join('') + '</ul>' : '<p class="sm-help">Nothing upstream: open from the start.</p>'}
    <h4>Unlocks</h4>
    ${downs.length ? '<ul>' + downs.map((e) => `<li>${questLink(e.to)} <span class="sm-gate">via ${_smEsc(e.flag)}</span></li>`).join('') + '</ul>' : '<p class="sm-help">Nothing downstream.</p>'}
    ${sets.length ? `<h4>Sets flags</h4><p>${sets.map((f) => `<code>${_smEsc(f)}</code>`).join(' ')}</p>` : ''}`;
}

// ── View: pan and zoom ──
function _smApplyView() {
  const { x, y, k } = _sm.view;
  document.getElementById('sm-world')?.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
}

function _smBindCanvas() {
  const svg = document.getElementById('sm-svg');
  let drag = null;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const v = _sm.view;
    const k2 = Math.min(2.5, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
    v.x = mx - (mx - v.x) * (k2 / v.k);
    v.y = my - (my - v.y) * (k2 / v.k);
    v.k = k2;
    _smApplyView();
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    drag = { sx: e.clientX, sy: e.clientY, vx: _sm.view.x, vy: _sm.view.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    _sm.view.x = drag.vx + dx; _sm.view.y = drag.vy + dy;
    _smApplyView();
  });
  svg.addEventListener('pointerup', (e) => {
    const moved = drag && drag.moved;
    drag = null;
    if (moved) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const label = hit?.closest('.sm-band-label');
    if (label) { smSelectLane(label.dataset.lane); return; }
    const card = hit?.closest('.sm-card');
    if (!card) { _sm.laneSel = null; smFocus(null); return; }
    if (card.dataset.npc) return;
    if (e.altKey) smToggleCut(card.dataset.id);
    else smFocus(card.dataset.id);
  });
  svg.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.sm-card');
    if (!card) return;
    if (card.dataset.npc) smOpen('dialogue', card.dataset.npc);
    else smOpen('quest', card.dataset.id);
  });
}

// ── Actions (global: the bar and side panel call them from markup) ──
function smToggleLane(id) {
  if (_sm.hidden.has(id)) _sm.hidden.delete(id); else _sm.hidden.add(id);
  _smRenderAll();
}
function smAllLanes(on) {
  _sm.hidden = on ? new Set() : new Set(_sm.graph.lanes.keys());
  _smRenderAll();
}
function smToggleFindings() { _sm.showFindings = !_sm.showFindings; _smRenderBar(); _smRenderSide(); }
function smFocus(id) {
  _sm.focus = id || null;
  if (id) { _sm.showFindings = false; _sm.laneSel = null; }
  const lane = id && _sm.graph.nodes.get(id)?.lane;
  if (lane && _sm.hidden.has(lane)) _sm.hidden.delete(lane);
  _smRenderAll();
}
function smSelectLane(id) {
  if (!_sm.graph.lanes.get(id)?.authored) return;
  _sm.laneSel = id; _sm.focus = null; _sm.showFindings = false;
  _smRenderAll();
}
function smToggleCut(id) {
  if (_sm.cut.has(id)) _sm.cut.delete(id); else _sm.cut.add(id);
  _smRenderAll();
}
function smClearCut() { _sm.cut.clear(); _smRenderAll(); }
function smOpen(kind, id) { vineJumpTo(kind, id); }
function smFit() {
  const svg = document.getElementById('sm-svg');
  const box = document.getElementById('sm-world').getBBox();
  if (!box.width) return;
  const r = svg.getBoundingClientRect();
  const k = Math.min(2, Math.max(0.15, Math.min(r.width / (box.width + 40), r.height / (box.height + 40))));
  _sm.view = { k, x: 20 - box.x * k, y: 20 - box.y * k };
  _smApplyView();
}

// ── Lane edits: each one PUTs the whole row, then redraws from local state ──
async function _smSaveRow(row) {
  row.nodes = (row.nodes || []).map((p, i) => ({ ref: p.ref, x: i }));
  const res = await API(`/storylines/${row.id}`, 'PUT', row);
  if (res && res.error) { toast(res.error, true); return false; }
  const list = _sm.data.storylines;
  const i = list.findIndex((r) => r.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
  _smRebuild();
  _smRenderAll();
  return true;
}
const _smRow = () => _sm.graph.lanes.get(_sm.laneSel)?.row;
const _smCopy = (row) => ({ ...row, nodes: (row.nodes || []).slice().sort((a, b) => a.x - b.x) });

async function smNewLane() {
  const name = await dpPrompt('Name for the new lane', '', { title: 'New lane' });
  if (!name) return;
  const base = 'sl_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  let id = base, n = 2;
  while (_sm.data.storylines.some((r) => r.id === id)) id = `${base}_${n++}`;
  const order = Math.max(-1, ..._sm.data.storylines.map((r) => r.sort_order || 0)) + 1;
  if (await _smSaveRow({ id, name, color: '#c9a227', sort_order: order, collapsed: false, nodes: [], notes: '' })) smSelectLane('sl:' + id);
}
function smSaveLaneFields() {
  const row = _smCopy(_smRow());
  row.name = document.getElementById('sm-ln-name').value.trim() || row.name;
  row.color = document.getElementById('sm-ln-color').value;
  row.notes = document.getElementById('sm-ln-notes').value;
  return _smSaveRow(row);
}
async function smMoveLane(dir) {
  const rows = _sm.graph.laneOrder.filter((l) => l.authored).map((l) => l.row);
  const i = rows.findIndex((r) => r.id === _smRow().id);
  const j = i + dir;
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (const [k, r] of rows.entries()) if ((r.sort_order || 0) !== k) await _smSaveRow({ ..._smCopy(r), sort_order: k });
}
async function smDeleteLane() {
  const row = _smRow();
  if (!(await dpConfirm(`Delete the lane "${row.name}"? Its quests go back to the derived lanes.`, { danger: true }))) return;
  const res = await API(`/storylines/${row.id}`, 'DELETE');
  if (res && res.error) return toast(res.error, true);
  _sm.data.storylines = _sm.data.storylines.filter((r) => r.id !== row.id);
  _sm.laneSel = null;
  _smRebuild();
  _smRenderAll();
}
function smMovePlacement(i, dir) {
  const row = _smCopy(_smRow());
  const j = i + dir;
  if (j < 0 || j >= row.nodes.length) return;
  [row.nodes[i], row.nodes[j]] = [row.nodes[j], row.nodes[i]];
  return _smSaveRow(row);
}
function smRemovePlacement(i) {
  const row = _smCopy(_smRow());
  row.nodes.splice(i, 1);
  return _smSaveRow(row);
}
async function smAddPlacement() {
  const ref = document.getElementById('sm-ln-add').value.trim();
  const isQuest = _sm.data.quests.some((q) => q.id === ref);
  if (!isQuest && !_sm.data.npcs.some((n) => n.id === ref)) return toast(`No quest or NPC "${ref}".`, true);
  if (isQuest) await _smTakeQuestOut(ref, _smRow().id);
  const row = _smCopy(_smRow());
  row.nodes.push({ ref, x: row.nodes.length });
  return _smSaveRow(row);
}
// A quest sits in one authored lane; take it out of any other first.
async function _smTakeQuestOut(questId, exceptId) {
  for (const r of _sm.data.storylines) {
    if (r.id === exceptId || !(r.nodes || []).some((p) => p.ref === questId)) continue;
    await _smSaveRow({ ..._smCopy(r), nodes: _smCopy(r).nodes.filter((p) => p.ref !== questId) });
  }
}
async function smSetQuestLane(questId, rowId) {
  await _smTakeQuestOut(questId, rowId);
  if (rowId) {
    const r = _sm.data.storylines.find((x) => x.id === rowId);
    if (!(r.nodes || []).some((p) => p.ref === questId)) await _smSaveRow({ ..._smCopy(r), nodes: [..._smCopy(r).nodes, { ref: questId, x: 1e9 }] });
  }
  smFocus(questId);
}
// Order quests by unlock depth (stable); an NPC rides with the quest after it.
function smAutoArrange() {
  const row = _smCopy(_smRow());
  const g = _sm.graph;
  const keyed = row.nodes.map((p, i) => ({ p, i, d: g.nodes.get(p.ref)?.type === 'quest' ? g.nodes.get(p.ref).depth : null }));
  for (let i = keyed.length - 1, next = Infinity; i >= 0; i--) {
    if (keyed[i].d == null) keyed[i].d = next - 0.5; else next = keyed[i].d;
  }
  keyed.sort((a, b) => a.d - b.d || a.i - b.i);
  row.nodes = keyed.map((k) => k.p);
  return _smSaveRow(row);
}
