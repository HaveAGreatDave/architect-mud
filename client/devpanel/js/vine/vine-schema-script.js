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

function _helpBox(nodeId, desc, example) {
  const boxId = `vine-help-${nodeId}`;
  return `
    <div style="margin-bottom:10px">
      <button onclick="(function(b){var d=document.getElementById('${boxId}');var open=d.style.display==='block';d.style.display=open?'none':'block';b.style.color=open?'var(--text-dim)':'var(--accent)';b.style.borderColor=open?'var(--border)':'var(--accent)'})(this)"
              style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:1px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">?</button>
      <div id="${boxId}" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:2px;font-size:11px;line-height:1.5">
        <div style="color:var(--text);margin-bottom:6px">${desc}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:3px">Example</div>
        <pre style="margin:0;font-size:10px;color:var(--accent2);font-family:var(--font);white-space:pre-wrap;word-break:break-all">${_escHtmlS(example)}</pre>
      </div>
    </div>`;
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
      ${_helpBox(id,
        'Runs a single game action when execution reaches this node. Pick the type from the dropdown, then fill in its parameters.',
        'action: GRANT_ITEM\nparams: { "item_id": "medkit", "quantity": 1, "once": true }'
      )}
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
      ${_helpBox(id,
        'Sets or clears a named flag on a player or the world. Use flags to track quest state, NPC encounters, and world events. Condition nodes read these flags to branch logic.',
        'scope: player\nop: set\nflag: met_detective\nvalue: true'
      )}
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
      ${_helpBox(id,
        'Checks a flag and routes execution down the "if true" or "if false" output. Connect two separate branches to those ports. Supported ops: "set" (flag exists), "unset" (flag absent), "eq"/"neq" (value equals/not-equals), "gt"/"lt" (numeric compare).',
        '{ "flag": "met_detective", "op": "set" }\n\n→ if true:  detective already met\n→ if false: first encounter'
      )}
      ${_field('Condition (JSON)', _textarea('data.condition', JSON.stringify(n.data.condition || {}, null, 2), 4, 'json'))}
    `,
  },
  say: {
    label: 'Say',
    color: '#226644',
    defaultData: { text: '' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text)">${_escHtmlS((n.data.text || '').slice(0, 60))}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_helpBox(id,
        'Sends a line of text to the player\'s feed. Execution continues immediately to the next node — use a Wait node after if you want a pause before the next message.',
        'The alarm blares overhead.\nSomething is very wrong.'
      )}
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
      ${_helpBox(id,
        'Pauses script execution for the given number of seconds, then continues to the next node. Useful for pacing Say messages or delaying an action after a trigger.',
        'seconds: 2.5\n\n→ waits 2.5 seconds, then continues'
      )}
      ${_field('Seconds', `<input data-vine-field="data.seconds" data-vine-type="number" type="number" min="0" step="0.5" value="${n.data.seconds || 0}" style="${_inputStyle}">`)}
    `,
  },
  broadcast: {
    label: 'Broadcast',
    color: '#227766',
    defaultData: { text: '', zone: '', excludeActor: false, refresh: false },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text)">📢 ${_escHtmlS((n.data.text || '').slice(0, 50))}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_helpBox(id,
        'Sends a line to EVERYONE in the room, not just the triggering player — this is how a script makes a scene instead of a whisper. Defaults to the actor\'s zone; set zone (or use ${zone}) for an actorless event. Tick "refresh" if the room\'s contents changed and clients should re-look.',
        'The lights die. Somewhere in the dark, a glass hits the floor.'
      )}
      ${_field('Text', _textarea('data.text', n.data.text, 3))}
      ${_field('Zone (blank = actor\'s room)', _textInput('data.zone', n.data.zone, '${zone}'))}
      ${_field('Exclude the actor', _select('data.excludeActor', ['false', 'true'], String(!!n.data.excludeActor)))}
      ${_field('Refresh clients', _select('data.refresh', ['false', 'true'], String(!!n.data.refresh)))}
    `,
  },
  spawn: {
    label: 'Spawn',
    color: '#993344',
    defaultData: { kind: 'enemy', id: '', zone: '', container: '', quantity: 1, announce: '' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escHtmlS(n.data.kind || 'enemy')} × ${n.data.quantity || 1} → ${_escHtmlS(n.data.id || '(none)')}${n.data.container ? ` 📥 ${_escHtmlS(n.data.container)}` : ''}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_helpBox(id,
        'Puts something in the world: an enemy instance from an enemies template, or an item into a zone. Blank zone means the actor\'s room. Leave "announce" empty for the stock arrival line; type one to override it. An enemy with announce set to the literal word false arrives SILENTLY — for a tail the player has not noticed yet.\n\nDEAD DROP: give an item spawn a container (a furniture id, or a name to match in that zone) and the item goes INSIDE it rather than onto the open floor — really there, really retrievable, but not visible to the next person through the room. If the container cannot be found the drop is skipped, never dumped on the floor.',
        'kind: item\nid: item_credit_chip\nzone: zone_mq_pigeon_bar\ncontainer: trash bin\n\n→ the chip is in the bin, waiting for whoever knows to look'
      )}
      ${_field('Kind', _select('data.kind', ['enemy', 'item'], n.data.kind))}
      ${_field('Template / Item ID', _textInput('data.id', n.data.id, 'enemy_alley_mugger'))}
      ${_field('Zone (blank = actor\'s room)', _textInput('data.zone', n.data.zone, '${zone}'))}
      ${_field('Container (items only — dead drop)', _textInput('data.container', n.data.container, 'trash bin'))}
      ${_field('Quantity', `<input data-vine-field="data.quantity" data-vine-type="number" type="number" min="1" value="${n.data.quantity || 1}" style="${_inputStyle}">`)}
      ${_field('Announce (blank = stock line)', _textInput('data.announce', n.data.announce, ''))}
    `,
  },
  random: {
    label: 'Random',
    color: '#775599',
    defaultData: { outcomes: [{ weight: 1 }, { weight: 1 }] },
    renderBody: (n) => {
      const outs = n.data.outcomes || [];
      const total = outs.reduce((s, o) => s + (Number(o.weight ?? 1) || 0), 0) || 1;
      return `<div style="font-size:11px;color:var(--text-dim)">${outs.map((o, i) =>
        `#${i + 1} ${Math.round((Number(o.weight ?? 1) || 0) / total * 100)}%`).join(' · ') || '(no outcomes)'}</div>`;
    },
    getOutPorts: (n) => (n.data.outcomes || []).map((o, i) =>
      ({ key: `out${i}`, label: `#${i + 1} (${o.weight ?? 1})` })),
    renderProperties: (n, ed, id) => `
      ${_helpBox(id,
        'Picks ONE outgoing branch at random, weighted. Each outcome gets its own output port — wire them to different branches. Weight is relative, not a percentage: weights 3 and 1 mean 75%/25%. A weight of 0 parks an outcome without deleting it. Edit the count by editing the JSON below; the ports follow.',
        '[{ "weight": 3 }, { "weight": 1 }]\n\n→ #1 fires 75% of the time, #2 25%'
      )}
      ${_field('Outcomes (JSON)', _textarea('data.outcomes', JSON.stringify(n.data.outcomes || [], null, 2), 5, 'json'))}
    `,
  },
  counter: {
    label: 'Counter',
    color: '#996633',
    defaultData: { scope: 'player', flag: '', delta: 1, threshold: '', reset: false },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escHtmlS(n.data.scope || 'player')}.${_escHtmlS(n.data.flag)} ${(Number(n.data.delta ?? 1) >= 0 ? '+' : '')}${n.data.delta ?? 1}${n.data.threshold ? ` → ≥${_escHtmlS(String(n.data.threshold))}` : ''}</div>`,
    getOutPorts: (n) => (n.data.threshold === '' || n.data.threshold == null)
      ? [{ key: 'next', label: 'next' }]
      : [{ key: 'ifTrue', label: 'threshold hit' }, { key: 'ifFalse', label: 'not yet' }],
    renderProperties: (n, ed, id) => `
      ${_helpBox(id,
        'Adds to a numeric flag, then optionally branches on a threshold. Leave threshold blank and it just bumps the number and continues. With a threshold it routes to "threshold hit" once the value reaches it. Tick "reset on hit" to zero the flag at that moment — that is how you build "every 5th time". Delta accepts a ${token}, so it can total a VALUE off the event payload instead of counting occurrences.',
        'flag: alley_visits\ndelta: 1\nthreshold: 5\nreset: true\n\n→ fires the "threshold hit" branch on every 5th run\n\nflag: lifetime_spend\ndelta: ${event.delta}\n\n→ totals credits.changed instead of counting it'
      )}
      ${_field('Scope', _select('data.scope', ['player', 'world'], n.data.scope))}
      ${_field('Flag Key', _textInput('data.flag', n.data.flag, 'alley_visits'))}
      ${_field('Delta', `<input data-vine-field="data.delta" data-vine-type="number" type="number" step="1" value="${n.data.delta ?? 1}" style="${_inputStyle}">`)}
      ${_field('Threshold (blank = no branch)', _textInput('data.threshold', n.data.threshold ?? '', ''))}
      ${_field('Reset on hit', _select('data.reset', ['false', 'true'], String(!!n.data.reset)))}
    `,
  },
  script: {
    label: 'Run Script',
    color: '#664488',
    defaultData: { scriptId: '' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escHtmlS(n.data.scriptId || '(no script)')}</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_helpBox(id,
        'Runs another script by ID as a sub-routine, waits for it to finish, then continues from the "next" port. Good for reusable sequences — e.g. a shared "give starter loot" script called from multiple quest triggers.',
        'scriptId: give_starting_gear\n\n→ runs that script fully, then continues'
      )}
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
    // A random node fans out through its outcomes, not through next/ifTrue —
    // walk those too or every branch lands in the orphan pile.
    if (Array.isArray(node.outcomes)) node.outcomes.forEach((o, i) => { if (o?.next) walk(o.next, c + 1 + i); });
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
  vineIdentity: { kind: 'script', tagline: 'Scripted event graph', color: 'var(--cyan)', icon: '⎇' },
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

      // A random node's branches live inside its outcomes array, one dynamic
      // port each. The wiring becomes edges; only the weight stays in data, so
      // there is exactly one source of truth for where an outcome goes.
      if (type === 'random' && Array.isArray(fields.outcomes)) {
        fields.outcomes.forEach((o, i) => {
          if (o?.next) edges.push({ fromNode: id, fromPort: `out${i}`, toNode: o.next });
        });
        fields.outcomes = fields.outcomes.map(o => ({ weight: o?.weight ?? 1 }));
      }

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

      // Fold the random node's per-outcome edges back into its outcomes array.
      if (node.type === 'random' && Array.isArray(data.outcomes)) {
        data.outcomes = data.outcomes.map((o, i) => {
          const e = edges.find(x => x.fromNode === id && x.fromPort === `out${i}`);
          return { weight: o?.weight ?? 1, ...(e ? { next: e.toNode } : {}) };
        });
      }

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
