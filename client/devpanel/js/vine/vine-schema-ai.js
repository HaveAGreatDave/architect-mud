// VINE AI Behaviour schema — converts AI behaviour_graph JSON ↔ VINE graph format.
// Defines node types for the visual AI behaviour editor.

function _escAI(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _AI_AI_IS = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;box-sizing:border-box;border-radius:2px';
const _AI_AI_LS = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

function _aiField(label, inputHtml) {
  return `<div style="margin-bottom:8px"><label style="${_AI_LS}">${label}</label>${inputHtml}</div>`;
}

function _aiInput(field, value, placeholder, type) {
  const t = type || 'text';
  return `<input data-vine-field="${field}" ${t !== 'text' ? `data-vine-type="${t}" type="${t}"` : ''} value="${_escAI(value)}" placeholder="${placeholder || ''}" style="${_AI_IS}">`;
}

function _aiTextarea(field, value, rows) {
  return `<textarea data-vine-field="${field}" data-vine-type="json" rows="${rows || 3}" style="${_AI_IS};resize:vertical;font-size:11px">${_escAI(typeof value === 'object' ? JSON.stringify(value, null, 2) : (value || ''))}</textarea>`;
}

function _aiSelect(field, options, current) {
  const opts = options.map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('');
  return `<select data-vine-field="${field}" style="${_AI_IS}">${opts}</select>`;
}

// ── Condition type catalogue ──────────────────────────────────────────────────

const AI_CONDITIONS = [
  { type: 'HAS_TARGET',       label: 'Has Target',              params: [] },
  { type: 'HP_BELOW',         label: 'HP Below %',              params: [{ key: 'pct',     label: 'Threshold %',       type: 'number', default: 30 }] },
  { type: 'HP_ABOVE',         label: 'HP Above %',              params: [{ key: 'pct',     label: 'Threshold %',       type: 'number', default: 70 }] },
  { type: 'IN_ZONE',          label: 'In Zone',                 params: [{ key: 'zone_id', label: 'Zone ID',           type: 'text',   default: '' }] },
  { type: 'PLAYER_IN_ZONE',   label: 'Player In Zone',          params: [{ key: 'min',     label: 'Min players',       type: 'number', default: 1 }] },
  { type: 'TARGET_HP_BELOW',  label: "Target's HP Below %",     params: [{ key: 'pct',     label: 'Threshold %',       type: 'number', default: 30 }] },
  { type: 'FACTION_MATCH',    label: 'Target Faction Matches',  params: [{ key: 'faction', label: 'Faction',           type: 'text',   default: '' }] },
  { type: 'FLAG_SET',         label: 'Flag Is Set',             params: [{ key: 'flag',    label: 'Flag key',          type: 'text',   default: '' }, { key: 'scope', label: 'Scope', type: 'select', options: ['world', 'self'], default: 'self' }] },
  { type: 'RANDOM_CHANCE',    label: 'Random Chance',           params: [{ key: 'chance',  label: 'Probability 0–1',   type: 'number', default: 0.5 }] },
  { type: 'IS_DAYTIME',       label: 'Is Daytime',              params: [] },
];

// ── Action type catalogue ─────────────────────────────────────────────────────

const AI_ACTIONS = [
  { type: 'ATTACK',          label: 'Attack',          params: [] },
  { type: 'ACQUIRE_TARGET',  label: 'Acquire Target',  params: [{ key: 'prefer',      label: 'Prefer',                type: 'select', options: ['random', 'lowest_hp'], default: 'random' }] },
  { type: 'DROP_TARGET',     label: 'Drop Target',     params: [] },
  { type: 'PATROL',          label: 'Patrol',          params: [
    { key: 'waypoints',  label: 'Waypoints (JSON array of zone IDs)',  type: 'json',    default: [] },
    { key: 'mode',       label: 'Move mode',                           type: 'select',  options: ['walk', 'teleport'], default: 'walk' },
    { key: 'loop',       label: 'Loop back to start',                  type: 'boolean', default: true },
  ]},
  { type: 'FLEE',            label: 'Flee',            params: [{ key: 'max_distance', label: 'Max distance (zones)', type: 'number', default: 3 }] },
  { type: 'SAY',             label: 'Say',             params: [
    { key: 'message',    label: 'Message',           type: 'text',    default: '' },
    { key: 'once',       label: 'Say once only',     type: 'boolean', default: false },
    { key: 'cooldown_s', label: 'Cooldown (s)',      type: 'number',  default: 30 },
  ]},
  { type: 'CALL_BACKUP',     label: 'Call Backup',     params: [
    { key: 'radius',       label: 'Search radius (zones)', type: 'number',  default: 2 },
    { key: 'faction_only', label: 'Same faction only',     type: 'boolean', default: true },
  ]},
  { type: 'TELEPORT',        label: 'Teleport',        params: [{ key: 'zone_id', label: 'Zone ID', type: 'text', default: '' }] },
  { type: 'IDLE',            label: 'Idle',            params: [] },
  { type: 'SET_FLAG',        label: 'Set Flag',        params: [
    { key: 'flag',  label: 'Flag key', type: 'text',   default: '' },
    { key: 'value', label: 'Value',    type: 'text',   default: 'true' },
    { key: 'scope', label: 'Scope',    type: 'select', options: ['world', 'self'], default: 'self' },
  ]},
];

// ── Shared param form renderer ────────────────────────────────────────────────

function _renderParamFields(container, catalogue, typeKey, dataObj, onChange) {
  container.innerHTML = '';
  const def = catalogue.find(d => d.type === dataObj[typeKey]);
  if (!def || !def.params.length) return;

  for (const p of def.params) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:80px;flex-shrink:0';
    lbl.textContent = p.label;

    let inp;
    if (p.type === 'boolean') {
      inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = dataObj.params?.[p.key] ?? p.default ?? false;
      inp.onchange = () => { (dataObj.params = dataObj.params || {})[p.key] = inp.checked; onChange(); };
    } else if (p.type === 'select') {
      inp = document.createElement('select');
      inp.style.cssText = _AI_IS;
      const cur = dataObj.params?.[p.key] ?? p.default ?? (p.options || [])[0];
      inp.innerHTML = (p.options || []).map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>${o}</option>`).join('');
      inp.onchange = () => { (dataObj.params = dataObj.params || {})[p.key] = inp.value; onChange(); };
    } else if (p.type === 'json') {
      inp = document.createElement('textarea');
      inp.style.cssText = _AI_IS + ';resize:vertical;font-size:10px;height:44px';
      const cur = dataObj.params?.[p.key] ?? p.default ?? [];
      inp.value = typeof cur === 'string' ? cur : JSON.stringify(cur, null, 2);
      inp.onchange = () => {
        try { (dataObj.params = dataObj.params || {})[p.key] = JSON.parse(inp.value); onChange(); } catch {}
      };
    } else {
      inp = document.createElement('input');
      inp.type = p.type === 'number' ? 'number' : 'text';
      inp.style.cssText = _AI_IS;
      inp.value = dataObj.params?.[p.key] ?? p.default ?? '';
      if (p.type === 'number') inp.step = 'any';
      inp.oninput = () => {
        (dataObj.params = dataObj.params || {})[p.key] = p.type === 'number' ? Number(inp.value) : inp.value;
        onChange();
      };
    }

    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  }
}

// ── Branch editor (for random nodes) ─────────────────────────────────────────

function _buildBranchEditor(container, node, editor, nodeId) {
  const branches = node.data.branches || (node.data.branches = []);
  const onChange = () => {
    editor._refreshNodeDisplay(nodeId);
    editor._renderEdges();
    editor._fire('change');
  };

  const render = () => {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:5px';

    branches.forEach((b, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:6px;display:flex;align-items:center;gap:6px';

      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:60px';
      lbl.textContent = `Branch ${i}`;

      const wLbl = document.createElement('label');
      wLbl.style.cssText = 'font-size:10px;color:var(--text-dim);flex-shrink:0';
      wLbl.textContent = 'Weight';

      const wInp = document.createElement('input');
      wInp.type = 'number';
      wInp.min = '1';
      wInp.step = '1';
      wInp.style.cssText = _AI_IS + ';width:60px;flex-shrink:0';
      wInp.value = b.weight ?? 1;
      wInp.oninput = () => { b.weight = Math.max(1, parseInt(wInp.value) || 1); onChange(); };

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn danger';
      delBtn.style.cssText = 'padding:1px 5px;font-size:10px;flex-shrink:0';
      delBtn.textContent = '✕';
      delBtn.onclick = () => {
        branches.splice(i, 1);
        onChange();
        render();
      };

      card.appendChild(lbl);
      card.appendChild(wLbl);
      card.appendChild(wInp);
      card.appendChild(delBtn);
      list.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'action-btn';
    addBtn.style.cssText = 'font-size:11px;width:100%;margin-top:2px';
    addBtn.textContent = '+ Add Branch';
    addBtn.onclick = () => { branches.push({ weight: 1 }); onChange(); render(); };
    list.appendChild(addBtn);
    container.appendChild(list);
  };

  render();
}

// ── Node type definitions ─────────────────────────────────────────────────────

const _aiNodeDefs = {

  start: {
    label: 'Start',
    color: '#334433',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--accent);letter-spacing:1px">↳ ENTRY</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: () => `<div style="color:var(--text-dim);font-size:12px">Entry point. Connect to the first node to evaluate each tick.</div>`,
  },

  condition: {
    label: 'Condition',
    color: '#aa4422',
    defaultData: { condition_type: 'HAS_TARGET', params: {} },
    renderBody: (n) => {
      const def = AI_CONDITIONS.find(c => c.type === n.data.condition_type);
      return `<div style="font-size:11px;color:var(--text-dim)">${_escAI(def?.label || n.data.condition_type || '(no condition)')}</div>`;
    },
    getOutPorts: () => [{ key: 'ifTrue', label: 'if true' }, { key: 'ifFalse', label: 'if false' }],
    renderProperties: (n, ed, id) => {
      const condOpts = AI_CONDITIONS.map(c =>
        `<option value="${c.type}" ${c.type === n.data.condition_type ? 'selected' : ''}>${c.label}</option>`
      ).join('');
      return `
        ${_aiField('Condition Type', `<select data-vine-field="data.condition_type" style="${_AI_IS}" id="ai-cond-type-${id}">${condOpts}</select>`)}
        <div id="ai-cond-params-${id}"></div>
      `;
    },
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const sel = propsEl.querySelector(`#ai-cond-type-${nodeId}`);
      const paramContainer = propsEl.querySelector(`#ai-cond-params-${nodeId}`);
      const onChange = () => {
        editor._refreshNodeDisplay(nodeId);
        editor._fire('change');
      };
      if (paramContainer) _renderParamFields(paramContainer, AI_CONDITIONS, 'condition_type', node.data, onChange);
      if (sel) {
        sel.addEventListener('change', () => {
          node.data.condition_type = sel.value;
          node.data.params = {};
          if (paramContainer) _renderParamFields(paramContainer, AI_CONDITIONS, 'condition_type', node.data, onChange);
          onChange();
        });
      }
    },
  },

  action: {
    label: 'Action',
    color: '#4455aa',
    defaultData: { action_type: 'IDLE', params: {} },
    renderBody: (n) => {
      const def = AI_ACTIONS.find(a => a.type === n.data.action_type);
      return `<div style="font-size:11px;color:var(--accent)">${_escAI(def?.label || n.data.action_type || '(no action)')}</div>`;
    },
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => {
      const actOpts = AI_ACTIONS.map(a =>
        `<option value="${a.type}" ${a.type === n.data.action_type ? 'selected' : ''}>${a.label}</option>`
      ).join('');
      return `
        ${_aiField('Action Type', `<select data-vine-field="data.action_type" style="${_AI_IS}" id="ai-act-type-${id}">${actOpts}</select>`)}
        <div id="ai-act-params-${id}"></div>
      `;
    },
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const sel = propsEl.querySelector(`#ai-act-type-${nodeId}`);
      const paramContainer = propsEl.querySelector(`#ai-act-params-${nodeId}`);
      const onChange = () => {
        editor._refreshNodeDisplay(nodeId);
        editor._fire('change');
      };
      if (paramContainer) _renderParamFields(paramContainer, AI_ACTIONS, 'action_type', node.data, onChange);
      if (sel) {
        sel.addEventListener('change', () => {
          node.data.action_type = sel.value;
          node.data.params = {};
          if (paramContainer) _renderParamFields(paramContainer, AI_ACTIONS, 'action_type', node.data, onChange);
          onChange();
        });
      }
    },
  },

  wait: {
    label: 'Wait',
    color: '#446688',
    defaultData: { seconds: 5 },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${n.data.seconds || 0}s pause</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      <div style="color:var(--text-dim);font-size:12px;margin-bottom:8px">Suspend AI evaluation for N seconds, then continue. Useful after SAY or ATTACK to pace behavior.</div>
      ${_aiField('Seconds', `<input data-vine-field="data.seconds" data-vine-type="number" type="number" min="0" step="1" value="${n.data.seconds || 0}" style="${_AI_IS}">`)}
    `,
  },

  random: {
    label: 'Random Branch',
    color: '#886644',
    defaultData: { branches: [{ weight: 1 }, { weight: 1 }] },
    renderBody: (n) => {
      const branches = n.data.branches || [];
      return `<div style="font-size:11px;color:var(--text-dim)">${branches.length} branch${branches.length !== 1 ? 'es' : ''}</div>`;
    },
    getOutPorts: (n) => {
      const branches = n.data.branches || [];
      return branches.map((b, i) => ({
        key: `branch_${i}`,
        label: `branch ${i}${b.weight !== 1 ? ` (×${b.weight})` : ''}`,
      }));
    },
    renderProperties: (n, ed, id) => `
      <div style="color:var(--text-dim);font-size:12px;margin-bottom:8px">Picks one branch at random each tick, weighted by the branch's weight value.</div>
      <div id="ai-branches-${id}"></div>
    `,
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const container = propsEl.querySelector(`#ai-branches-${nodeId}`);
      if (container) _buildBranchEditor(container, node, editor, nodeId);
    },
  },
};

// ── Conversion: DB graph ↔ VINE graph ─────────────────────────────────────────

function _autoLayoutAI(dbGraph) {
  const pos = {};
  const W = 320, H = 170;
  const colRows = {};
  const visited = new Set();
  const queue = [{ id: dbGraph._start, col: 0 }];
  const nodes = dbGraph.nodes || {};

  while (queue.length) {
    const { id, col } = queue.shift();
    if (visited.has(id) || !nodes[id]) continue;
    visited.add(id);
    colRows[col] = (colRows[col] || 0);
    pos[id] = { x: col * W + 40, y: colRows[col] * H + 60 };
    colRows[col]++;

    const n = nodes[id];
    const nexts = [n.next, n.ifTrue, n.ifFalse, ...(Object.keys(n).filter(k => k.startsWith('branch_')).map(k => n[k]))].filter(Boolean);
    const nextCols = n.ifTrue || n.ifFalse ? [col + 1, col + 2] : [col + 1];
    nexts.forEach((nid, i) => {
      if (!visited.has(nid)) queue.push({ id: nid, col: nextCols[i] || col + 1 });
    });
  }

  // Orphan nodes
  let orphanRow = Object.keys(pos).length;
  for (const id of Object.keys(nodes)) {
    if (!pos[id]) { pos[id] = { x: 40, y: orphanRow * H + 60 }; orphanRow++; }
  }
  return pos;
}

window.VineAISchema = {
  nodeTypes: _aiNodeDefs,

  // DB format → VINE internal graph
  fromAiGraph(dbGraph) {
    if (!dbGraph || !dbGraph.nodes) return { nodes: {}, edges: [], _start: '' };

    const layout = _autoLayoutAI(dbGraph);
    const nodes = {};
    const edges = [];

    for (const [id, node] of Object.entries(dbGraph.nodes)) {
      const { type, next, ifTrue, ifFalse, _vine, ...fields } = node;
      const pos = _vine || layout[id] || { x: 40, y: 40 };

      if (next)   edges.push({ fromNode: id, fromPort: 'next',    toNode: next });
      if (ifTrue) edges.push({ fromNode: id, fromPort: 'ifTrue',  toNode: ifTrue });
      if (ifFalse)edges.push({ fromNode: id, fromPort: 'ifFalse', toNode: ifFalse });

      // Random branches
      for (const [k, v] of Object.entries(fields)) {
        if (k.startsWith('branch_') && v) {
          edges.push({ fromNode: id, fromPort: k, toNode: v });
          delete fields[k];
        }
      }

      nodes[id] = { type: type || 'action', x: pos.x, y: pos.y, data: { ...fields } };
    }

    return { nodes, edges, _start: dbGraph._start || '' };
  },

  // VINE internal graph → DB format
  toAiGraph(vineGraph) {
    const nodes = {};
    const edges = vineGraph.edges || [];

    // Find _start: prefer node with type 'start', else first node
    let _start = vineGraph._start || '';
    if (!_start) {
      const startNode = Object.entries(vineGraph.nodes || {}).find(([, n]) => n.type === 'start');
      _start = startNode ? startNode[0] : Object.keys(vineGraph.nodes || {})[0] || '';
    }

    for (const [id, node] of Object.entries(vineGraph.nodes || {})) {
      const data = { ...node.data };
      const nextEdge  = edges.find(e => e.fromNode === id && e.fromPort === 'next');
      const trueEdge  = edges.find(e => e.fromNode === id && e.fromPort === 'ifTrue');
      const falseEdge = edges.find(e => e.fromNode === id && e.fromPort === 'ifFalse');

      // Collect branch edges for random nodes
      const branchEdges = {};
      for (const e of edges) {
        if (e.fromNode === id && e.fromPort.startsWith('branch_')) {
          branchEdges[e.fromPort] = e.toNode;
        }
      }

      nodes[id] = {
        type: node.type,
        ...data,
        ...(nextEdge  ? { next:    nextEdge.toNode }  : {}),
        ...(trueEdge  ? { ifTrue:  trueEdge.toNode }  : {}),
        ...(falseEdge ? { ifFalse: falseEdge.toNode } : {}),
        ...branchEdges,
        _vine: { x: node.x, y: node.y },
      };
    }

    return { _start, nodes };
  },
};
