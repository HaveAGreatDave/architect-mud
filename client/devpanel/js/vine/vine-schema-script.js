// VINE script schema — converts script graph JSON ↔ VINE graph format and
// defines node types matching the script engine in server/engine/graph.js.

function _escHtmlS(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _inputStyle = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px;box-sizing:border-box;border-radius:2px;margin-bottom:6px';
const _labelStyle = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

function _field(label, inputHtml) {
  return `<div style="margin-bottom:8px"><label style="${_labelStyle}">${label}</label>${inputHtml}</div>`;
}

function _textInput(field, value, placeholder) {
  return `<input data-vine-field="${field}" value="${_escHtmlS(value)}" placeholder="${placeholder || ''}" style="${_inputStyle}">`;
}

function _textarea(field, value, rows, type) {
  return `<textarea data-vine-field="${field}" ${type ? `data-vine-type="${type}"` : ''} rows="${rows || 3}"
           style="${_inputStyle};resize:vertical;font-size:11px">${_escHtmlS(value)}</textarea>`;
}

function _select(field, options, current) {
  const opts = options.map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('');
  return `<select data-vine-field="${field}" style="${_inputStyle}">${opts}</select>`;
}

function _actionTypeOptions(current) {
  const types = (window.VineActionTypes || []).map(a =>
    `<option value="${a.type}" ${a.type === current ? 'selected' : ''}>${a.label} (${a.type})</option>`
  ).join('');
  return `<option value="">— choose action —</option>${types}`;
}

const _scriptNodeDefs = {
  action: {
    label: 'Action',
    color: '#4455aa',
    defaultData: { action: '', params: {} },
    renderBody: (n) => `<div style="font-size:11px;color:var(--accent)">${_escHtmlS(n.data.action || '(no action)')}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_field('Action Type', `<select data-vine-field="data.action" style="${_inputStyle}">${_actionTypeOptions(n.data.action)}</select>`)}
      ${_field('Params (JSON)', _textarea('data.params', JSON.stringify(n.data.params || {}, null, 2), 4, 'json'))}
    `,
  },
  setflag: {
    label: 'Set Flag',
    color: '#886622',
    defaultData: { scope: 'player', op: 'set', flag: '', value: 'true' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escHtmlS(n.data.scope)}.${_escHtmlS(n.data.flag)} = ${_escHtmlS(n.data.value)}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_field('Scope', _select('data.scope', ['player', 'world'], n.data.scope))}
      ${_field('Operation', _select('data.op', ['set', 'clear'], n.data.op))}
      ${_field('Flag Key', _textInput('data.flag', n.data.flag, 'flag_name'))}
      ${_field('Value', _textInput('data.value', n.data.value ?? 'true', 'true'))}
    `,
  },
  condition: {
    label: 'Condition',
    color: '#aa4422',
    defaultData: { condition: {} },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escHtmlS(JSON.stringify(n.data.condition || {}))}</div>`,
    getOutPorts: () => [{ key: 'ifTrue', label: 'if true' }, { key: 'ifFalse', label: 'if false' }],
    renderProperties: (n, ed, id) => `
      ${_field('Condition (JSON)', _textarea('data.condition', JSON.stringify(n.data.condition || {}, null, 2), 4, 'json'))}
      <div style="font-size:10px;color:var(--text-dim)">Example: <code style="font-size:10px">{"flag":"met_bob","op":"set"}</code></div>
    `,
  },
  say: {
    label: 'Say',
    color: '#226644',
    defaultData: { text: '' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text)">${_escHtmlS((n.data.text || '').slice(0, 60))}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_field('Text', _textarea('data.text', n.data.text, 3))}
    `,
  },
  wait: {
    label: 'Wait',
    color: '#446688',
    defaultData: { seconds: 1 },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${n.data.seconds || 0}s</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_field('Seconds', `<input data-vine-field="data.seconds" data-vine-type="number" type="number" min="0" step="0.5" value="${n.data.seconds || 0}" style="${_inputStyle}">`)}
    `,
  },
  script: {
    label: 'Run Script',
    color: '#664488',
    defaultData: { scriptId: '' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escHtmlS(n.data.scriptId || '(no script)')}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_field('Script ID', _textInput('data.scriptId', n.data.scriptId, 'script_id'))}
    `,
  },
};

// Auto-layout script nodes in a simple vertical chain from start node.
function _autoLayoutScript(graph) {
  const pos = {};
  const W = 300, H = 160;
  const visited = new Set();
  let col = 0, row = 0;

  function walk(id, c) {
    if (visited.has(id) || !graph.nodes[id]) return;
    visited.add(id);
    pos[id] = { x: c * W + 40, y: row * H + 60 };
    row++;
    const node = graph.nodes[id];
    if (node.next) walk(node.next, c);
    if (node.ifTrue) walk(node.ifTrue, c + 1);
    if (node.ifFalse) walk(node.ifFalse, c + 2);
    row = Math.max(row, Object.keys(pos).filter(k => pos[k].x === c * W + 40).length);
  }

  if (graph.start) walk(graph.start, 0);
  let orphanRow = Object.keys(pos).length;
  for (const id of Object.keys(graph.nodes)) {
    if (!pos[id]) { pos[id] = { x: 40, y: orphanRow * H + 60 }; orphanRow++; }
  }
  return pos;
}

window.VineScriptSchema = {
  nodeTypes: _scriptNodeDefs,

  // { start, nodes: { id: { type, ...fields, next?, ifTrue?, ifFalse?, _vine? } } }
  // → VINE graph { nodes, edges, _start }
  fromScriptGraph(graph) {
    if (!graph || !graph.nodes) return { nodes: {}, edges: [], _start: '' };

    const layout = _autoLayoutScript(graph);
    const nodes = {};
    const edges = [];

    for (const [id, node] of Object.entries(graph.nodes)) {
      const { type = 'action', next, ifTrue, ifFalse, _vine, ...fields } = node;
      const pos = _vine || layout[id] || { x: 40, y: 40 };

      if (next) edges.push({ fromNode: id, fromPort: 'next', toNode: next });
      if (ifTrue) edges.push({ fromNode: id, fromPort: 'ifTrue', toNode: ifTrue });
      if (ifFalse) edges.push({ fromNode: id, fromPort: 'ifFalse', toNode: ifFalse });

      nodes[id] = { type, x: pos.x, y: pos.y, data: { ...fields } };
    }

    return { nodes, edges, _start: graph.start || '' };
  },

  // VINE graph → { start, nodes }
  toScriptGraph(vineGraph) {
    const nodes = {};
    const edges = vineGraph.edges || [];
    const start = vineGraph._start || Object.keys(vineGraph.nodes || {})[0] || '';

    for (const [id, node] of Object.entries(vineGraph.nodes || {})) {
      const data = { ...node.data };
      const nextEdge = edges.find(e => e.fromNode === id && e.fromPort === 'next');
      const trueEdge = edges.find(e => e.fromNode === id && e.fromPort === 'ifTrue');
      const falseEdge = edges.find(e => e.fromNode === id && e.fromPort === 'ifFalse');

      nodes[id] = {
        type: node.type,
        ...data,
        ...(nextEdge ? { next: nextEdge.toNode } : {}),
        ...(trueEdge ? { ifTrue: trueEdge.toNode } : {}),
        ...(falseEdge ? { ifFalse: falseEdge.toNode } : {}),
        _vine: { x: node.x, y: node.y },
      };
    }

    return { start, nodes };
  },
};
