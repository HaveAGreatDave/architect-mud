// Story Map: every quest on one canvas, laid out by what unlocks what.
//
// Read-only. The graph comes from buildStoryGraph (client/shared/story-graph.js,
// the same builder scripts/content/story-report.mjs prints) over the rows the
// VINE Suite reads, so there's nothing here to keep in sync. Lanes are
// horizontal bands (quest-id prefix, else the giver); left to right is how many
// 'precedes' steps deep a quest sits.
//
//   drag            pan            wheel         zoom
//   click a quest   focus: dim all but what unlocks it and what it unlocks
//   double-click    open the quest's objective graph in VINE
//   alt-click       what-if cut: mark it removed and show what breaks in red
//
// Clicking a giver or turn-in NPC in the side panel opens their dialogue tree.

let _sm = null; // { graph, hidden:Set, focus, cut:Set, view:{x,y,k}, layout }

const SM_CARD_W = 180, SM_CARD_H = 38, SM_COL = 230, SM_ROW = 50, SM_LANE_PAD = 18, SM_LABEL_W = 170;

async function fetchStoryMap() {
  const [npcs, scripts, quests, triggers, jobBoards] = await Promise.all([
    directAPI('/npcs'), API('/scripts'), API('/quests'), API('/script-triggers'), API('/job-boards'),
  ]);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
  return {
    npcs: arr(npcs).map((n) => ({ ...n, dialogue_tree: parse(n.dialogue_tree) })),
    scripts: arr(scripts).map((s) => ({ ...s, graph: parse(s.graph) })),
    quests: arr(quests).map((q) => ({ ...q, rewards: parse(q.rewards) })),
    triggers: arr(triggers).map((t) => ({ ...t, params: parse(t.params) })),
    jobBoards: arr(jobBoards).map((b) => ({ ...b, quest_pool: parse(b.quest_pool) })),
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

function renderStoryMap(data) {
  const graph = _smModel(StoryGraph.buildStoryGraph(data));
  const prev = _sm;
  _sm = {
    graph,
    hidden: prev ? prev.hidden : new Set(),
    focus: null,
    cut: prev ? prev.cut : new Set(),
    view: prev ? prev.view : { x: 0, y: 0, k: 0.8 },
    showFindings: false,
  };
  const el = document.getElementById('list-panel');
  el.innerHTML = `
    <div class="sm-root">
      <div class="sm-bar" id="sm-bar"></div>
      <div class="sm-body">
        <svg class="sm-svg" id="sm-svg"><g id="sm-world"></g></svg>
        <div class="sm-side" id="sm-side"></div>
      </div>
    </div>`;
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

// Lanes sorted by size, Unsorted last; inside a lane, cards stack per column.
function _smLayout() {
  const g = _sm.graph;
  const lanes = [...g.lanes.values()].sort((a, b) =>
    (a.id === 'unsorted') - (b.id === 'unsorted') || b.nodes.length - a.nodes.length || a.name.localeCompare(b.name));
  const pos = new Map();
  const bands = [];
  let y = 0;
  lanes.forEach((lane, i) => {
    const color = _smLaneColor(i);
    if (_sm.hidden.has(lane.id)) { bands.push({ lane, color, hidden: true }); return; }
    const perCol = new Map();
    const ids = lane.nodes.slice().sort((a, b) => g.nodes.get(a).depth - g.nodes.get(b).depth || a.localeCompare(b));
    let rows = 1;
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
    const h = SM_LANE_PAD * 2 + rows * SM_ROW - (SM_ROW - SM_CARD_H);
    bands.push({ lane, color, y, h });
    y += h + 6;
  });
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
  const lanes = [...g.lanes.values()].sort((a, b) =>
    (a.id === 'unsorted') - (b.id === 'unsorted') || b.nodes.length - a.nodes.length || a.name.localeCompare(b.name));
  const chips = lanes.map((l, i) => `
    <label class="sm-chip${_sm.hidden.has(l.id) ? ' off' : ''}" style="--lane:${_smLaneColor(i)}">
      <input type="checkbox" ${_sm.hidden.has(l.id) ? '' : 'checked'} onchange="smToggleLane('${_smEsc(l.id)}')">
      ${_smEsc(l.name)} <span class="sm-n">${l.nodes.length}</span></label>`).join('');
  const nFind = g.findings.length;
  document.getElementById('sm-bar').innerHTML = `
    <button class="action-btn" onclick="smAllLanes(true)">All</button>
    <button class="action-btn" onclick="smAllLanes(false)">None</button>
    <button class="action-btn${_sm.showFindings ? ' active' : ''}" onclick="smToggleFindings()">Findings (${nFind})</button>
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
    svg += `<rect class="sm-band" x="0" y="${b.y}" width="${maxX}" height="${b.h}" style="--lane:${b.color}"/>
      <text class="sm-band-label" x="10" y="${b.y + 22}" style="fill:${b.color}">${_smEsc(b.lane.name.length > 19 ? b.lane.name.slice(0, 18) + "…" : b.lane.name)}<title>${_smEsc(b.lane.name)}</title></text>`;
  }

  // Unlock edges between visible quests. One edge per pair; its title lists the flags.
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
    const dim = focusSet && !(focusSet.has(p.from) && focusSet.has(p.to));
    const dead = cut && cut.broken.has(p.from);
    const cls = `sm-edge${cross ? ' cross' : ''}${dim ? ' dim' : ''}${dead ? ' dead' : ''}${x2 <= x1 ? ' back' : ''}`;
    svg += `<path class="${cls}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"><title>${_smEsc([...p.flags].join(', '))}</title></path>`;
  }

  for (const [id, p] of pos) {
    const n = g.nodes.get(id);
    const giver = n.starts[0] ? (g.nodes.get(n.starts[0].npc)?.name || n.starts[0].npc) : 'no giver';
    const dim = focusSet && !focusSet.has(id);
    const broken = cut && cut.broken.has(id);
    const isCut = _sm.cut.has(id);
    const cls = `sm-card${dim ? ' dim' : ''}${broken ? ' broken' : ''}${isCut ? ' cut' : ''}${_sm.focus === id ? ' focus' : ''}${n.starts.length ? '' : ' orphan'}`;
    const label = n.name.length > 26 ? n.name.slice(0, 25) + '…' : n.name;
    const sub = giver.length > 30 ? giver.slice(0, 29) + '…' : giver;
    svg += `<g class="${cls}" data-id="${_smEsc(id)}" transform="translate(${p.x},${p.y})" style="--lane:${p.color}">
      <rect width="${SM_CARD_W}" height="${SM_CARD_H}" rx="4"/>
      <text class="t" x="8" y="15">${_smEsc(label)}${n.repeatable ? ' ↻' : ''}</text>
      <text class="s" x="8" y="30">${_smEsc(sub)}</text>
      <title>${_smEsc(id)}</title></g>`;
  }
  document.getElementById('sm-world').innerHTML = svg;
  _smApplyView();
}

function _smRenderSide() {
  const side = document.getElementById('sm-side');
  const g = _sm.graph;
  const name = (id) => _smEsc(g.nodes.get(id)?.name || id);
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

  if (!_sm.focus) {
    const cut = _sm.cut.size ? _smWhatIf(g, _sm.cut) : null;
    side.innerHTML = `<h3>Story Map</h3>
      <p class="sm-help">Click a quest to focus it. Double-click opens it in VINE. Alt-click cuts it to see what breaks.</p>
      <p class="sm-help">Left to right is how many quests deep it sits. Bold edges cross between lanes; dashed ones run backwards.</p>
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
  side.innerHTML = `
    <h3>${_smEsc(n.name)}</h3>
    <div class="sm-id">${_smEsc(id)}${n.category ? ` · ${_smEsc(n.category)}` : ''}${n.repeatable ? ' · repeatable' : ''}</div>
    <p><button class="action-btn" onclick="smOpen('quest','${_smEsc(id)}')">Open in VINE</button>
       <button class="action-btn" onclick="smToggleCut('${_smEsc(id)}')">${_sm.cut.has(id) ? 'Uncut' : 'What if cut?'}</button>
       <button class="action-btn" onclick="smFocus(null)">Clear focus</button></p>
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
    const card = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sm-card');
    if (!card) { smFocus(null); return; }
    if (e.altKey) smToggleCut(card.dataset.id);
    else smFocus(card.dataset.id);
  });
  svg.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.sm-card');
    if (card) smOpen('quest', card.dataset.id);
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
  if (id) _sm.showFindings = false;
  const lane = id && _sm.graph.nodes.get(id)?.lane;
  if (lane && _sm.hidden.has(lane)) _sm.hidden.delete(lane);
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
