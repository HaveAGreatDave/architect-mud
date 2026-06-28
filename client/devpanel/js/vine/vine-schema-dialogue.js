// VINE dialogue schema — converts dialogue_tree JSON ↔ VINE graph format and
// defines the single "dialogue" node type with its properties panel.

function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Auto-layout a dialogue_tree left-to-right (BFS from 'root').
function _autoLayout(tree) {
  const pos = {};
  const W = 320, H = 180;
  const colRows = {};
  const visited = new Set();
  const queue = [{ id: 'root', col: 0 }];

  // BFS
  while (queue.length) {
    const { id, col } = queue.shift();
    if (visited.has(id) || !tree[id]) continue;
    visited.add(id);
    colRows[col] = colRows[col] || 0;
    pos[id] = { x: col * W + 40, y: colRows[col] * H + 60 };
    colRows[col]++;
    for (const opt of tree[id].options || []) {
      if (opt.next && !visited.has(opt.next)) queue.push({ id: opt.next, col: col + 1 });
    }
  }

  // Orphan nodes (not reachable from root)
  let orphanRow = Object.keys(pos).length;
  for (const id of Object.keys(tree)) {
    if (!pos[id]) { pos[id] = { x: 40, y: orphanRow * H + 60 }; orphanRow++; }
  }
  return pos;
}

// ── Shared style constants ────────────────────────────────────────────────────

const _IS = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;box-sizing:border-box;border-radius:2px';
const _LS = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

// ── Actions editor ─────────────────────────────────────────────────────────────
// Renders a list of action cards into `container`. Calls `onChange` on every mutation.

function _buildActionsEditor(container, actions, onChange) {
  container.innerHTML = '';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:5px';

  const render = () => {
    list.innerHTML = '';
    actions.forEach((action, i) => {
      const def = (window.VineActionTypes || []).find(a => a.type === action.action);

      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:6px';

      // Type row
      const typeRow = document.createElement('div');
      typeRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:5px';

      const sel = document.createElement('select');
      sel.style.cssText = _IS + ';flex:1';
      sel.innerHTML = `<option value="">— action type —</option>` +
        (window.VineActionTypes || []).map(a =>
          `<option value="${a.type}" ${a.type === action.action ? 'selected' : ''}>${a.label}</option>`
        ).join('');
      sel.onchange = () => {
        const newDef = (window.VineActionTypes || []).find(a => a.type === sel.value);
        actions[i] = { action: sel.value };
        if (newDef) for (const p of newDef.params) { if (p.default != null) actions[i][p.key] = p.default; }
        onChange(); render();
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn danger';
      delBtn.style.cssText = 'flex-shrink:0;padding:2px 6px;font-size:11px';
      delBtn.textContent = '✕';
      delBtn.onclick = () => { actions.splice(i, 1); onChange(); render(); };

      typeRow.appendChild(sel);
      typeRow.appendChild(delBtn);
      card.appendChild(typeRow);

      // Param fields
      if (def) {
        for (const p of def.params) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px';

          const lbl = document.createElement('label');
          lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:72px;flex-shrink:0';
          lbl.textContent = p.label;

          let inp;
          if (p.type === 'boolean') {
            inp = document.createElement('input');
            inp.type = 'checkbox';
            inp.checked = action[p.key] ?? p.default ?? false;
            inp.onchange = () => { action[p.key] = inp.checked; onChange(); };
          } else if (p.type === 'select') {
            inp = document.createElement('select');
            inp.style.cssText = _IS;
            inp.innerHTML = (p.options || []).map(o =>
              `<option value="${o}" ${o === (action[p.key] ?? p.default) ? 'selected' : ''}>${o}</option>`
            ).join('');
            inp.onchange = () => { action[p.key] = inp.value; onChange(); };
          } else if (p.type === 'json') {
            inp = document.createElement('textarea');
            inp.style.cssText = _IS + ';resize:vertical;font-size:10px;height:38px';
            inp.value = typeof action[p.key] === 'object'
              ? JSON.stringify(action[p.key], null, 2)
              : (action[p.key] ?? p.default ?? '{}');
            inp.onchange = () => { try { action[p.key] = JSON.parse(inp.value); onChange(); } catch {} };
          } else {
            inp = document.createElement('input');
            inp.type = p.type === 'number' ? 'number' : 'text';
            inp.style.cssText = _IS;
            inp.value = action[p.key] ?? p.default ?? '';
            inp.oninput = () => { action[p.key] = p.type === 'number' ? Number(inp.value) : inp.value; onChange(); };
          }

          row.appendChild(lbl);
          row.appendChild(inp);
          card.appendChild(row);
        }
      }

      list.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'action-btn';
    addBtn.style.cssText = 'font-size:11px;width:100%;margin-top:2px';
    addBtn.textContent = '+ Add Action';
    addBtn.onclick = () => { actions.push({ action: '' }); onChange(); render(); };
    list.appendChild(addBtn);
  };

  render();
  container.appendChild(list);
}

// ── Options editor ─────────────────────────────────────────────────────────────
// Renders a list of option cards into `container`.

function _buildOptionsEditor(container, node, editor, nodeId) {
  const options = node.data.options || (node.data.options = []);

  const onChange = () => {
    editor._refreshNodeDisplay(nodeId);
    editor._renderEdges();
    editor._fire('change');
  };

  const render = () => {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    options.forEach((opt, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:2px;padding:8px';

      // Header: label + move + delete
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:6px';

      const title = document.createElement('span');
      title.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);flex:1';
      title.textContent = `Option ${i + 1}`;

      const mkMoveBtn = (label, disabled, fn) => {
        const b = document.createElement('button');
        b.className = 'action-btn';
        b.style.cssText = 'padding:1px 5px;font-size:10px';
        b.textContent = label;
        b.disabled = disabled;
        b.onclick = fn;
        return b;
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn danger';
      delBtn.style.cssText = 'padding:1px 5px;font-size:10px';
      delBtn.textContent = '✕';
      delBtn.onclick = () => { options.splice(i, 1); onChange(); render(); };

      hdr.appendChild(title);
      hdr.appendChild(mkMoveBtn('↑', i === 0, () => { [options[i-1], options[i]] = [options[i], options[i-1]]; onChange(); render(); }));
      hdr.appendChild(mkMoveBtn('↓', i === options.length - 1, () => { [options[i], options[i+1]] = [options[i+1], options[i]]; onChange(); render(); }));
      hdr.appendChild(delBtn);
      card.appendChild(hdr);

      // Text
      const textInp = document.createElement('input');
      textInp.style.cssText = _IS + ';margin-bottom:5px';
      textInp.placeholder = 'Choice text shown to player…';
      textInp.value = opt.text || opt.label || '';
      textInp.oninput = () => { opt.text = textInp.value; onChange(); };
      card.appendChild(textInp);

      // Enabled
      const enabledRow = document.createElement('div');
      enabledRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = opt.enabled !== false;
      cb.onchange = () => { opt.enabled = cb.checked; onChange(); };
      const cbLbl = document.createElement('label');
      cbLbl.style.cssText = 'font-size:11px;color:var(--text-dim);cursor:pointer';
      cbLbl.textContent = 'Enabled';
      cbLbl.onclick = () => { cb.checked = !cb.checked; opt.enabled = cb.checked; onChange(); };
      enabledRow.appendChild(cb);
      enabledRow.appendChild(cbLbl);
      card.appendChild(enabledRow);

      // Conditions (JSON — stays raw; complex flag expressions)
      const condLbl = document.createElement('label');
      condLbl.style.cssText = _LS;
      condLbl.textContent = 'Conditions (JSON)';
      const condTA = document.createElement('textarea');
      condTA.style.cssText = _IS + ';resize:vertical;font-size:10px;height:44px';
      condTA.value = JSON.stringify(opt.conditions || [], null, 2);
      condTA.onchange = () => { try { opt.conditions = JSON.parse(condTA.value); onChange(); } catch {} };
      card.appendChild(condLbl);
      card.appendChild(condTA);

      // Actions for this option
      const actLbl = document.createElement('div');
      actLbl.style.cssText = _LS + ';margin-top:6px';
      actLbl.textContent = 'Actions';
      card.appendChild(actLbl);
      if (!opt.actions) opt.actions = [];
      const actContainer = document.createElement('div');
      card.appendChild(actContainer);
      _buildActionsEditor(actContainer, opt.actions, onChange);

      list.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'action-btn';
    addBtn.style.cssText = 'font-size:11px;width:100%;margin-top:2px';
    addBtn.textContent = '+ Add Option';
    addBtn.onclick = () => { options.push({ text: '', enabled: true, actions: [] }); onChange(); render(); };
    list.appendChild(addBtn);

    container.appendChild(list);
  };

  render();
}

// ── Schema definition ─────────────────────────────────────────────────────────

window.VineDialogueSchema = {
  nodeTypes: {
    dialogue: {
      label: 'Dialogue Node',
      color: '#2a6644',
      defaultData: { text: '', options: [], actions: [] },

      renderBody(node) {
        const text = node.data.text || '';
        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
        const opts = node.data.options || [];
        const optHtml = opts.map((o, i) =>
          `<div style="font-size:10px;color:var(--text-dim);padding:1px 0">↳ ${_escHtml(o.text || o.label || `Option ${i+1}`)}</div>`
        ).join('');
        return `
          <div style="font-size:12px;color:var(--text);margin-bottom:${opts.length ? '6px' : '0'}">${_escHtml(preview) || '<em style="color:var(--text-dim)">No text</em>'}</div>
          ${optHtml}
        `;
      },

      getOutPorts(node) {
        const opts = node.data.options || [];
        if (!opts.length) return [{ key: 'fallthrough', label: '(end)' }];
        return opts.map((o, i) => ({
          key: `opt_${i}`,
          label: (o.text || o.label || `Option ${i + 1}`).slice(0, 30),
        }));
      },

      renderProperties(node, editor, nodeId) {
        return `
          <div style="margin-bottom:12px">
            <label style="${_LS}">NPC Text</label>
            <textarea data-vine-field="data.text" data-vine-instant rows="5"
                      style="${_IS};resize:vertical">${_escHtml(node.data.text || '')}</textarea>
          </div>
          <div style="margin-bottom:4px">
            <label style="${_LS}">Player Options</label>
            <div id="vine-dp-options"></div>
          </div>
          <div>
            <label style="${_LS}">Node Actions <span style="font-weight:normal;text-transform:none;letter-spacing:0">(fire on enter)</span></label>
            <div id="vine-dp-node-actions"></div>
          </div>
        `;
      },

      afterRenderProperties(propsEl, node, editor, nodeId) {
        const optContainer = propsEl.querySelector('#vine-dp-options');
        if (optContainer) _buildOptionsEditor(optContainer, node, editor, nodeId);

        const actContainer = propsEl.querySelector('#vine-dp-node-actions');
        if (actContainer) {
          if (!node.data.actions) node.data.actions = [];
          _buildActionsEditor(actContainer, node.data.actions, () => {
            editor._refreshNodeDisplay(nodeId);
            editor._fire('change');
          });
        }
      },
    },
  },

  // Convert dialogue_tree JSONB → VINE internal graph format.
  fromDialogueTree(tree) {
    if (!tree || typeof tree !== 'object') return { nodes: {}, edges: [] };

    const layout = _autoLayout(tree);
    const nodes = {};
    const edges = [];

    for (const [id, node] of Object.entries(tree)) {
      const pos = node._vine || layout[id] || { x: 40, y: 40 };
      const opts = (node.options || []).map((opt, i) => {
        if (opt.next) edges.push({ fromNode: id, fromPort: `opt_${i}`, toNode: opt.next });
        const { next, ...rest } = opt;
        return rest;
      });
      nodes[id] = {
        type: 'dialogue',
        x: pos.x,
        y: pos.y,
        data: {
          text: node.text || '',
          options: opts,
          actions: node.actions || [],
        },
      };
    }

    return { nodes, edges };
  },

  // Convert VINE internal graph format → dialogue_tree JSONB.
  toDialogueTree(vineGraph) {
    const tree = {};
    const nodes = vineGraph.nodes || {};
    const edges = vineGraph.edges || [];

    for (const [id, node] of Object.entries(nodes)) {
      const data = node.data || {};
      const opts = (data.options || []).map((opt, i) => {
        const edge = edges.find(e => e.fromNode === id && e.fromPort === `opt_${i}`);
        return { ...opt, next: edge?.toNode || '' };
      });
      tree[id] = {
        text: data.text || '',
        options: opts,
        actions: data.actions || [],
        _vine: { x: node.x, y: node.y },
      };
    }

    return tree;
  },
};
