// VINE Broadcast schema — node types for the visual broadcast script editor.
// Saved to media_broadcasts.broadcast_graph (same DB format as AI graphs).

function _escB(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const _BS = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;box-sizing:border-box;border-radius:2px';
const _BL = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

function _bField(label, inputHtml) {
  return `<div style="margin-bottom:8px"><label style="${_BL}">${label}</label>${inputHtml}</div>`;
}
function _bInput(field, value, placeholder, type) {
  const t = type || 'text';
  return `<input data-vine-field="${field}" ${t !== 'text' ? `type="${t}" data-vine-type="${t}"` : ''} value="${_escB(value)}" placeholder="${_escB(placeholder||'')}" style="${_BS}">`;
}
function _bTextarea(field, value, rows) {
  return `<textarea data-vine-field="${field}" rows="${rows||3}" style="${_BS};resize:vertical;font-size:11px">${_escB(value||'')}</textarea>`;
}
function _bSelect(field, options, current) {
  const opts = options.map(([v,l]) => `<option value="${v}"${v===current?' selected':''}>${l||v}</option>`).join('');
  return `<select data-vine-field="${field}" style="${_BS}">${opts}</select>`;
}
function _bHelp(nodeId, desc) {
  const id = `bh-${nodeId}`;
  return `<div style="margin-bottom:10px">
    <button onclick="(function(b){var d=document.getElementById('${id}');var o=d.style.display==='block';d.style.display=o?'none':'block';b.style.color=o?'var(--text-dim)':'var(--accent)';b.style.borderColor=o?'var(--border)':'var(--accent)'})(this)"
      style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:1px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">?</button>
    <div id="${id}" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:2px;font-size:11px;line-height:1.5;color:var(--text)">${desc}</div>
  </div>`;
}

// ── Condition catalogue ───────────────────────────────────────────────────────

const BROADCAST_CONDITIONS = [
  { type: 'IS_DAYTIME',       label: 'Is Daytime',         params: [] },
  { type: 'VIEWERS_PRESENT',  label: 'Viewers Present',    params: [] },
  { type: 'NEWS_AVAILABLE',   label: 'News Available',     params: [{ key: 'category', label: 'Category (blank = any)', type: 'text', default: '' }] },
  { type: 'HOUR_RANGE',       label: 'Hour Range',         params: [{ key: 'from', label: 'From hour (0–23)', type: 'number', default: 18 }, { key: 'to', label: 'To hour (0–23)', type: 'number', default: 23 }] },
  { type: 'RANDOM_CHANCE',    label: 'Random Chance',      params: [{ key: 'chance', label: 'Probability 0–1', type: 'number', default: 0.5 }] },
];

function _renderBroadcastCondParams(container, data, onChange) {
  container.innerHTML = '';
  const def = BROADCAST_CONDITIONS.find(c => c.type === data.condition_type);
  if (!def || !def.params.length) return;
  for (const p of def.params) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:100px;flex-shrink:0';
    lbl.textContent = p.label;
    const inp = document.createElement('input');
    inp.type = p.type === 'number' ? 'number' : 'text';
    inp.style.cssText = _BS;
    inp.value = data.params?.[p.key] ?? p.default ?? '';
    if (p.type === 'number') inp.step = 'any';
    inp.oninput = () => { (data.params = data.params||{})[p.key] = p.type==='number' ? Number(inp.value) : inp.value; onChange(); };
    row.appendChild(lbl); row.appendChild(inp);
    container.appendChild(row);
  }
}

// ── Branch editor (shared with AI schema pattern) ─────────────────────────────

function _buildBCBranchEditor(container, node, editor, nodeId) {
  const branches = node.data.branches || (node.data.branches = []);
  const onChange = () => { editor._refreshNodeDisplay(nodeId); editor._renderEdges(); editor._fire('change'); };
  const render = () => {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    branches.forEach((b, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:5px;display:flex;align-items:center;gap:6px';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:56px';
      lbl.textContent = `Branch ${i}`;
      const wLbl = document.createElement('label');
      wLbl.style.cssText = 'font-size:10px;color:var(--text-dim);flex-shrink:0';
      wLbl.textContent = 'Weight';
      const wInp = document.createElement('input');
      wInp.type = 'number'; wInp.min = '1'; wInp.step = '1';
      wInp.style.cssText = _BS + ';width:56px;flex-shrink:0';
      wInp.value = b.weight ?? 1;
      wInp.oninput = () => { b.weight = Math.max(1, parseInt(wInp.value)||1); onChange(); };
      const del = document.createElement('button');
      del.className = 'action-btn danger'; del.style.cssText = 'padding:1px 5px;font-size:10px;flex-shrink:0';
      del.textContent = '✕';
      del.onclick = () => { branches.splice(i,1); onChange(); render(); };
      card.appendChild(lbl); card.appendChild(wLbl); card.appendChild(wInp); card.appendChild(del);
      list.appendChild(card);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'action-btn'; addBtn.style.cssText = 'font-size:11px;width:100%;margin-top:2px';
    addBtn.textContent = '+ Add Branch';
    addBtn.onclick = () => { branches.push({ weight:1 }); onChange(); render(); };
    list.appendChild(addBtn);
    container.appendChild(list);
  };
  render();
}

// ── Node type definitions ─────────────────────────────────────────────────────

const _bcNodeDefs = {

  start: {
    label: 'Start',
    color: '#334433',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--accent);letter-spacing:1px">↳ ENTRY</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Entry point. Connect to the first node the broadcast should execute on each cycle.')}
      <div style="color:var(--text-dim);font-size:12px">One Start per graph. Connect output to the first node.</div>`,
  },

  say: {
    label: 'Say',
    color: '#226644',
    defaultData: { text:'', style:'raw' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text)">${_escB((n.data.text||'').slice(0,60))}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Pushes a line of text to every player watching this channel. Stops graph execution for this tick; the next tick resumes from <em>next</em>. Prefix is prepended by the active NPC Anchor if one is set.')}
      ${_bField('Text', _bTextarea('data.text', n.data.text, 3))}
      ${_bField('Style', _bSelect('data.style', [['raw','Normal (raw)'],['ticker','Ticker (>> text <<)']], n.data.style||'raw'))}`,
  },

  ticker: {
    label: 'Ticker',
    color: '#443388',
    defaultData: { text:'' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--accent)">» ${_escB((n.data.text||'').slice(0,50))}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Pushes a ticker-style line formatted as <strong>&gt;&gt; text &lt;&lt;</strong>. Displayed with accent colour and italic styling. Useful for news headlines, emergency alerts, scrolling bulletins.')}
      ${_bField('Ticker text', _bTextarea('data.text', n.data.text, 2))}`,
  },

  npc_anchor: {
    label: 'NPC Anchor',
    color: '#664488',
    defaultData: { npc_id:'' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB(n.data.npc_id||'(no NPC)')}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Sets the broadcast "voice". Every Say node after this one will be prefixed with <strong>[NPC Name]</strong> until a new NPC Anchor is encountered or the graph loops. The NPC does not need to be present in the zone — they\'re a named voice only.<br><br>For a fully embodied host who reacts to world events, use the <strong>BROADCAST_SAY</strong> action in that NPC\'s AI behaviour graph instead.')}
      ${_bField('NPC ID', _bInput('data.npc_id', n.data.npc_id, 'npc database id'))}`,
  },

  npc_action: {
    label: 'Emote',
    color: '#664422',
    defaultData: { message:'' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB((n.data.message||'').slice(0,60))}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Makes the active NPC Anchor perform an action in the studio zone. For live channels the emote fires in-world and relays to TV watchers as "<Name> <action>". Requires an NPC Anchor node earlier in the graph.')}
      ${_bField('Action text', _bTextarea('data.message', n.data.message, 2))}`,
  },

  inject_news: {
    label: 'Inject News',
    color: '#886622',
    defaultData: { category:'', fallback_text:'' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB(n.data.category||'any')}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Pulls the next item from the news queue for this category (or any category if blank). If the queue is empty, emits the fallback text instead. If both are empty, skips silently to the next node without stopping the tick.')}
      ${_bField('Category filter', _bInput('data.category', n.data.category, 'murder, martial_law, npc, … (blank = any)'))}
      ${_bField('Fallback text', _bTextarea('data.fallback_text', n.data.fallback_text, 2))}`,
  },

  camera_cut: {
    label: 'Camera Cut',
    color: '#335566',
    defaultData: { zone_id:'', label:'' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB(n.data.label||n.data.zone_id||'(no zone)')}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Reads a live snapshot of the target zone (description + visible entities) and pushes it as <strong>[CAM: label] ...</strong>. Use multiple Camera Cut nodes to pan between rooms in a live news segment or surveillance feed.')}
      ${_bField('Zone ID', _bInput('data.zone_id', n.data.zone_id, 'zone_plaza_main'))}
      ${_bField('Display label', _bInput('data.label', n.data.label, 'Downtown Plaza'))}`,
  },

  break: {
    label: 'Break',
    color: '#444444',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--text-dim);letter-spacing:1px">— BREAK —</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Marks a natural cut-point in the broadcast. At runtime, if there are any items in the news queue, one is consumed and output here instead of continuing the graph. The graph then resumes after the break on the next tick.<br><br>Use Break nodes at segment boundaries so urgent news (martial law alerts, player deaths) can interrupt a scripted show at a clean moment.')}
      <div style="color:var(--text-dim);font-size:12px">No properties. Connect output to the next segment.</div>`,
  },

  condition: {
    label: 'Condition',
    color: '#aa4422',
    defaultData: { condition_type:'IS_DAYTIME', params:{} },
    renderBody: (n) => {
      const def = BROADCAST_CONDITIONS.find(c => c.type === n.data.condition_type);
      return `<div style="font-size:11px;color:var(--text-dim)">${_escB(def?.label||n.data.condition_type||'(no condition)')}</div>`;
    },
    getOutPorts: () => [{ key:'ifTrue', label:'if true' }, { key:'ifFalse', label:'if false' }],
    renderProperties: (n, ed, id) => {
      const opts = BROADCAST_CONDITIONS.map(c => `<option value="${c.type}"${c.type===n.data.condition_type?' selected':''}>${c.label}</option>`).join('');
      return `
        ${_bHelp(id,'Evaluates a world condition and routes to <em>if true</em> or <em>if false</em>. Conditions are synchronous — no DB queries. Use them to gate primetime vs. late-night content, check whether anyone is watching, or vary output by whether breaking news is queued.')}
        ${_bField('Condition type', `<select data-vine-field="data.condition_type" style="${_BS}" id="bc-ctype-${id}">${opts}</select>`)}
        <div id="bc-cparams-${id}"></div>`;
    },
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const sel = propsEl.querySelector(`#bc-ctype-${nodeId}`);
      const pc = propsEl.querySelector(`#bc-cparams-${nodeId}`);
      const onChange = () => { editor._refreshNodeDisplay(nodeId); editor._fire('change'); };
      if (pc) _renderBroadcastCondParams(pc, node.data, onChange);
      if (sel) sel.addEventListener('change', () => {
        node.data.condition_type = sel.value; node.data.params = {};
        if (pc) _renderBroadcastCondParams(pc, node.data, onChange);
        onChange();
      });
    },
  },

  wait: {
    label: 'Wait',
    color: '#446688',
    defaultData: { seconds:5 },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${n.data.seconds||0}s pause</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Suspends this broadcast for N seconds. The graph resumes from <em>next</em> after the timer expires. Tick delivery continues for other channels; only this one pauses.')}
      ${_bField('Seconds', `<input data-vine-field="data.seconds" data-vine-type="number" type="number" min="0" step="1" value="${n.data.seconds||5}" style="${_BS}">`)}`,
  },

  loop: {
    label: 'Loop',
    color: '#446644',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--accent);letter-spacing:1px">↺ LOOP</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Jumps to the connected node — or back to Start if unconnected — without stopping execution. Place at the end of a segment to cycle the broadcast indefinitely.')}
      <div style="color:var(--text-dim);font-size:12px">Connect to jump target, or leave unconnected to jump to Start.</div>`,
  },

  random: {
    label: 'Random Branch',
    color: '#886644',
    defaultData: { branches:[{weight:1},{weight:1}] },
    renderBody: (n) => {
      const b = n.data.branches||[];
      return `<div style="font-size:11px;color:var(--text-dim)">${b.length} branch${b.length!==1?'es':''}</div>`;
    },
    getOutPorts: (n) => (n.data.branches||[]).map((b,i) => ({ key:`branch_${i}`, label:`branch ${i}${b.weight!==1?` (×${b.weight})`:''}`})),
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Picks one output at random each time, weighted by the weight values. Use this to vary ad lines, rotate between reporters, or randomise programme filler.')}
      <div id="bc-branches-${id}"></div>`,
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const c = propsEl.querySelector(`#bc-branches-${nodeId}`);
      if (c) _buildBCBranchEditor(c, node, editor, nodeId);
    },
  },

  set_flag: {
    label: 'Set Flag',
    color: '#553322',
    defaultData: { flag:'', value:'true' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB(n.data.flag||'(no flag)')}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Writes a world flag. Useful for emergency broadcasts that should also trigger a game-state change — e.g. a broadcast announcing martial law can also set the world.martial_law flag to activate other systems.')}
      ${_bField('World flag key', _bInput('data.flag', n.data.flag, 'martial_law'))}
      ${_bField('Value', _bInput('data.value', n.data.value ?? 'true', 'true'))}`,
  },

  title_card: {
    label: 'Title Card',
    color: '#224455',
    defaultData: { graphic_id:'', caption:'' },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB(n.data.graphic_id||'(no graphic)')}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Displays a graphic from the Graphics Library as ASCII art in the TV panel, or as pre-formatted text in the regular broadcast output. If the graphic_id is not found the node is skipped silently.')}
      ${_bField('Graphic ID', _bInput('data.graphic_id', n.data.graphic_id, 'graphic database id'))}
      ${_bField('Caption (optional)', _bInput('data.caption', n.data.caption, 'Text shown below the graphic'))}`,
  },

  show_overlay: {
    label: 'Show Overlay',
    color: '#335544',
    defaultData: { overlay_type:'lower_third', text:'', subtext:'', duration_s:6 },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${_escB(n.data.overlay_type||'lower_third')}: ${_escB((n.data.text||'').slice(0,40))}</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Pushes an overlay element to the TV panel for all current viewers. Does not stop graph execution — continues immediately to <em>next</em>. The overlay auto-clears after <em>duration</em> seconds, or when a <strong>Clear Overlay</strong> node fires.')}
      ${_bField('Type', _bSelect('data.overlay_type', [['lower_third','Lower Third (nameplate)'],['alert_flash','Alert Flash (full-screen)']], n.data.overlay_type||'lower_third'))}
      ${_bField('Main text', _bInput('data.text', n.data.text, 'DR. ELAINE VOSS'))}
      ${_bField('Subtext', _bInput('data.subtext', n.data.subtext, 'Chief Science Officer, NovaCorp'))}
      ${_bField('Duration (s)', `<input data-vine-field="data.duration_s" data-vine-type="number" type="number" min="1" step="1" value="${n.data.duration_s??6}" style="${_BS}">`)}`,
  },

  clear_overlay: {
    label: 'Clear Overlay',
    color: '#443322',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--text-dim);letter-spacing:1px">— CLEAR —</div>`,
    getOutPorts: () => [{ key:'next', label:'next' }],
    renderProperties: (n, ed, id) => `
      ${_bHelp(id,'Dismisses any active overlay on the TV panel immediately, for all current viewers. Continues to <em>next</em> without stopping the tick.')}
      <div style="color:var(--text-dim);font-size:12px">No properties.</div>`,
  },
};

// ── Auto-layout ───────────────────────────────────────────────────────────────

function _autoLayoutBroadcast(dbGraph) {
  const pos = {};
  const W = 300, H = 160;
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
    const nexts = [n.next, n.ifTrue, n.ifFalse, ...Object.keys(n).filter(k => k.startsWith('branch_')).map(k => n[k])].filter(Boolean);
    const nextCols = (n.ifTrue || n.ifFalse) ? [col+1, col+2] : [col+1];
    nexts.forEach((nid, i) => { if (!visited.has(nid)) queue.push({ id:nid, col:nextCols[i]||col+1 }); });
  }
  let orphanRow = Object.keys(pos).length;
  for (const id of Object.keys(nodes)) {
    if (!pos[id]) { pos[id] = { x:40, y:orphanRow*H+60 }; orphanRow++; }
  }
  return pos;
}

// ── Conversion: DB graph ↔ VINE graph ─────────────────────────────────────────

window.VineBroadcastSchema = {
  nodeTypes: _bcNodeDefs,

  fromBroadcastGraph(dbGraph) {
    if (!dbGraph || !dbGraph.nodes) return { nodes:{}, edges:[], _start:'' };
    const layout = _autoLayoutBroadcast(dbGraph);
    const nodes = {};
    const edges = [];

    for (const [id, node] of Object.entries(dbGraph.nodes)) {
      const { type, next, ifTrue, ifFalse, _vine, ...fields } = node;
      const pos = _vine || layout[id] || { x:40, y:40 };

      if (next)    edges.push({ fromNode:id, fromPort:'next',    toNode:next });
      if (ifTrue)  edges.push({ fromNode:id, fromPort:'ifTrue',  toNode:ifTrue });
      if (ifFalse) edges.push({ fromNode:id, fromPort:'ifFalse', toNode:ifFalse });
      for (const [k, v] of Object.entries(fields)) {
        if (k.startsWith('branch_') && v) { edges.push({ fromNode:id, fromPort:k, toNode:v }); delete fields[k]; }
      }
      nodes[id] = { type: type||'say', x:pos.x, y:pos.y, data:{ ...fields } };
    }
    return { nodes, edges, _start: dbGraph._start || '' };
  },

  toBroadcastGraph(vineGraph) {
    const nodes = {};
    const edges = vineGraph.edges || [];
    let _start = vineGraph._start || '';
    if (!_start) {
      const s = Object.entries(vineGraph.nodes||{}).find(([,n]) => n.type==='start');
      _start = s ? s[0] : Object.keys(vineGraph.nodes||{})[0] || '';
    }
    for (const [id, node] of Object.entries(vineGraph.nodes||{})) {
      const data = { ...node.data };
      const nextE  = edges.find(e => e.fromNode===id && e.fromPort==='next');
      const trueE  = edges.find(e => e.fromNode===id && e.fromPort==='ifTrue');
      const falseE = edges.find(e => e.fromNode===id && e.fromPort==='ifFalse');
      const branchE = {};
      for (const e of edges) {
        if (e.fromNode===id && e.fromPort.startsWith('branch_')) branchE[e.fromPort] = e.toNode;
      }
      nodes[id] = {
        type: node.type, ...data,
        ...(nextE  ? { next:   nextE.toNode }  : {}),
        ...(trueE  ? { ifTrue: trueE.toNode }  : {}),
        ...(falseE ? { ifFalse:falseE.toNode } : {}),
        ...branchE,
        _vine: { x:node.x, y:node.y },
      };
    }
    return { _start, nodes };
  },
};
