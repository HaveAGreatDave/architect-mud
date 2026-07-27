let _scriptGraph = { start: '', nodes: {} };

const SCRIPT_NODE_TYPES = ['action', 'setflag', 'condition', 'random', 'counter', 'say', 'broadcast', 'spawn', 'wait', 'script'];

function scriptEditForm(rec, isNew) {
  const g = (rec.graph && typeof rec.graph === 'object') ? rec.graph : JSON.parse(rec.graph || '{}');
  _scriptGraph = { start: g.start || '', nodes: g.nodes || {} };
  return `
    <div class="field"><label>Script ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''} placeholder="script_my_thing"></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Script Graph</label>
      <button type="button" class="action-btn" onclick="scriptsOpenVine()">🌿 Visual Editor</button>
    </div>
    <div class="field"><label>Start Node</label><select id="f-start" onchange="_scriptGraph.start=this.value"></select></div>
    <div class="field"><label>Nodes</label>
      <div id="script-nodes"></div>
      <button type="button" class="action-btn" onclick="addScriptNode()">+ Add Node</button>
    </div>
    <div class="field"><label>Raw Graph JSON</label>
      <textarea id="f-graph-json" rows="6" onchange="applyScriptJSON(this.value)"></textarea>
    </div>
  `;
}

function renderScriptEditor() {
  const startSel = document.getElementById('f-start');
  if (!startSel) return;
  const ids = Object.keys(_scriptGraph.nodes);
  startSel.innerHTML = ids.map(id => `<option value="${id}" ${id===_scriptGraph.start?'selected':''}>${id}</option>`).join('') || '<option value="">— no nodes —</option>';
  startSel.value = _scriptGraph.start || ids[0] || '';

  const cont = document.getElementById('script-nodes');
  if (cont) {
    cont.innerHTML = ids.map(id => renderScriptNode(id, _scriptGraph.nodes[id])).join('') ||
      '<div style="color:var(--text-dim);font-size:12px;padding:4px 0">No nodes yet.</div>';
  }
  syncScriptJSON();
}

function scriptsOpenVine() {
  const graphData = VineScriptSchema.fromScriptGraph(_scriptGraph);
  vineModalOpen(
    `Script: ${currentRecord?.name || currentRecord?.id || 'Script'}`,
    VineScriptSchema,
    graphData,
    (savedGraph) => {
      _scriptGraph = VineScriptSchema.toScriptGraph(savedGraph);
      renderScriptEditor();
      toast('Script graph saved — click Save to persist.');
    },
    null,
    vineFamilyTabs('script')
  );
}

function nodeIdOptions(selected) {
  return ['<option value="">— end —</option>', ...Object.keys(_scriptGraph.nodes).map(id =>
    `<option value="${id}" ${id===selected?'selected':''}>${id}</option>`)].join('');
}

function renderScriptNode(id, node) {
  const set = `onchange="setNodeField('${id}',this.dataset.k,this.value)"`;
  const typeSel = SCRIPT_NODE_TYPES.map(t => `<option value="${t}" ${t===node.type?'selected':''}>${t}</option>`).join('');
  let body = '';
  if (node.type === 'action') {
    body = `
      <input data-k="action" ${set} value="${node.action||''}" placeholder="ACTION e.g. GRANT_ITEM" style="width:100%;margin-bottom:4px">
      <textarea data-k="params" onchange="setNodeJSON('${id}','params',this.value)" rows="2" placeholder='{"item_id":"item_x"}' style="width:100%;margin-bottom:4px">${JSON.stringify(node.params||{})}</textarea>`;
  } else if (node.type === 'setflag') {
    body = `
      <select data-k="scope" ${set} style="margin-bottom:4px"><option value="player" ${node.scope!=='world'?'selected':''}>player</option><option value="world" ${node.scope==='world'?'selected':''}>world</option></select>
      <select data-k="op" ${set} style="margin-bottom:4px"><option value="set" ${node.op!=='clear'?'selected':''}>set</option><option value="clear" ${node.op==='clear'?'selected':''}>clear</option></select>
      <input data-k="flag" ${set} value="${node.flag||''}" placeholder="flag key" style="margin-bottom:4px">
      <input data-k="value" ${set} value="${node.value??''}" placeholder="value (default true)" style="margin-bottom:4px">`;
  } else if (node.type === 'condition') {
    body = `
      <textarea data-k="condition" onchange="setNodeJSON('${id}','condition',this.value)" rows="2" placeholder='{"flag":"met_bob","op":"set"}' style="width:100%;margin-bottom:4px">${JSON.stringify(node.condition||{})}</textarea>
      <label style="font-size:11px">if true →</label><select data-k="ifTrue" ${set} style="margin-bottom:4px">${nodeIdOptions(node.ifTrue)}</select>
      <label style="font-size:11px">if false →</label><select data-k="ifFalse" ${set} style="margin-bottom:4px">${nodeIdOptions(node.ifFalse)}</select>`;
  } else if (node.type === 'random') {
    // Outcomes carry their own `next`, so there is no node-id dropdown here —
    // the visual editor is the comfortable way to wire this one.
    body = `
      <textarea data-k="outcomes" onchange="setNodeJSON('${id}','outcomes',this.value)" rows="3" placeholder='[{"weight":3,"next":"n2"},{"weight":1,"next":"n3"}]' style="width:100%;margin-bottom:4px">${JSON.stringify(node.outcomes||[])}</textarea>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">Weights are relative, not percentages. Weight 0 parks an outcome.</div>`;
  } else if (node.type === 'counter') {
    body = `
      <select data-k="scope" ${set} style="margin-bottom:4px"><option value="player" ${node.scope!=='world'?'selected':''}>player</option><option value="world" ${node.scope==='world'?'selected':''}>world</option></select>
      <input data-k="flag" ${set} value="${node.flag||''}" placeholder="flag key e.g. alley_visits" style="margin-bottom:4px">
      <input data-k="delta" ${set} type="number" step="1" value="${node.delta??1}" placeholder="delta" style="margin-bottom:4px">
      <input data-k="threshold" ${set} value="${node.threshold??''}" placeholder="threshold (blank = no branch)" style="margin-bottom:4px">
      <select data-k="reset" ${set} style="margin-bottom:4px"><option value="false" ${!node.reset||node.reset==='false'?'selected':''}>keep counting</option><option value="true" ${node.reset===true||node.reset==='true'?'selected':''}>reset on hit</option></select>
      ${node.threshold ? `<label style="font-size:11px">threshold hit →</label><select data-k="ifTrue" ${set} style="margin-bottom:4px">${nodeIdOptions(node.ifTrue)}</select>
      <label style="font-size:11px">not yet →</label><select data-k="ifFalse" ${set} style="margin-bottom:4px">${nodeIdOptions(node.ifFalse)}</select>` : ''}`;
  } else if (node.type === 'say') {
    body = `<textarea data-k="text" ${set} rows="2" placeholder="line shown to the player" style="width:100%;margin-bottom:4px">${node.text||''}</textarea>`;
  } else if (node.type === 'broadcast') {
    body = `
      <textarea data-k="text" ${set} rows="2" placeholder="line the whole room sees" style="width:100%;margin-bottom:4px">${node.text||''}</textarea>
      <input data-k="zone" ${set} value="${node.zone||''}" placeholder="zone (blank = actor's room)" style="margin-bottom:4px">`;
  } else if (node.type === 'spawn') {
    body = `
      <select data-k="kind" ${set} style="margin-bottom:4px"><option value="enemy" ${node.kind!=='item'?'selected':''}>enemy</option><option value="item" ${node.kind==='item'?'selected':''}>item</option></select>
      <input data-k="id" ${set} value="${node.id||''}" placeholder="enemy template or item id" style="margin-bottom:4px">
      <input data-k="zone" ${set} value="${node.zone||''}" placeholder="zone (blank = actor's room)" style="margin-bottom:4px">
      <input data-k="container" ${set} value="${node.container||''}" placeholder="container id or name — dead drop (items only)" style="margin-bottom:4px">
      <input data-k="quantity" ${set} type="number" min="1" value="${node.quantity??1}" placeholder="quantity" style="margin-bottom:4px">
      <input data-k="announce" ${set} value="${node.announce??''}" placeholder="announce (blank = stock line)" style="margin-bottom:4px">`;
  } else if (node.type === 'wait') {
    body = `<input data-k="seconds" ${set} type="number" value="${node.seconds||0}" placeholder="seconds" style="margin-bottom:4px">`;
  } else if (node.type === 'script') {
    body = `<input data-k="scriptId" ${set} value="${node.scriptId||''}" placeholder="script_id to run" style="margin-bottom:4px">`;
  }
  const nextField = (node.type === 'condition') ? '' :
    `<label style="font-size:11px">next →</label><select data-k="next" ${set}>${nodeIdOptions(node.next)}</select>`;
  return `
    <div style="border:1px solid var(--border);border-radius:3px;padding:8px;margin-bottom:6px">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <strong style="font-family:monospace">${id}</strong>
        <select onchange="changeNodeType('${id}',this.value)">${typeSel}</select>
        <button type="button" class="action-btn" style="margin-left:auto" onclick="deleteScriptNode('${id}')">✕</button>
      </div>
      ${body}${nextField}
    </div>`;
}

function setNodeField(id, k, v) { _scriptGraph.nodes[id][k] = v; syncScriptJSON(); }
function setNodeJSON(id, k, v) {
  try { _scriptGraph.nodes[id][k] = JSON.parse(v || (k==='params'?'{}':'{}')); syncScriptJSON(); }
  catch { toast(`${k}: invalid JSON`, true); }
}
function changeNodeType(id, type) { _scriptGraph.nodes[id] = { type }; renderScriptEditor(); }
function addScriptNode() {
  let n = 1; while (_scriptGraph.nodes['n'+n]) n++;
  const id = 'n'+n;
  _scriptGraph.nodes[id] = { type: 'action' };
  if (!_scriptGraph.start) _scriptGraph.start = id;
  renderScriptEditor();
}
function deleteScriptNode(id) {
  delete _scriptGraph.nodes[id];
  if (_scriptGraph.start === id) _scriptGraph.start = Object.keys(_scriptGraph.nodes)[0] || '';
  renderScriptEditor();
}
function syncScriptJSON() {
  const ta = document.getElementById('f-graph-json');
  if (ta) ta.value = JSON.stringify(_scriptGraph, null, 2);
}
function applyScriptJSON(v) {
  try {
    const g = JSON.parse(v);
    _scriptGraph = { start: g.start || '', nodes: g.nodes || {} };
    renderScriptEditor();
  } catch { toast('Graph JSON: invalid', true); }
}

async function saveScript(existing) {
  const isNew = !existing?.id;
  const body = {
    name: document.getElementById('f-name').value || 'Untitled Script',
    description: document.getElementById('f-description').value || '',
    graph: _scriptGraph,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim() || undefined; return API('/scripts', 'POST', body); }
  return API(`/scripts/${existing.id}`, 'PUT', body);
}
