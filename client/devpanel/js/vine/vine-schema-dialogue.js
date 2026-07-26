// VINE dialogue schema — converts dialogue_tree JSON ↔ VINE graph format and
// defines the single "dialogue" node type with its properties panel.

function _escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A node's `text` may be an ARRAY of interchangeable lines — the engine picks one
// at random per render (server/engine/dialogue.js). The properties panel is a single
// textarea, so variants are edited as blocks separated by a lone `---` line, and
// collapse back to a plain string when there's only one.
const _TEXT_SPLIT = /\n[ \t]*---[ \t]*\n/;

function _joinTextLines(text) {
  if (Array.isArray(text)) return text.join('\n---\n');
  return text || '';
}

function _splitTextLines(text) {
  const parts = String(text || '').split(_TEXT_SPLIT).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : (parts[0] || '');
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

// ── Help box ─────────────────────────────────────────────────────────────────

function _dialogueHelpBox(nodeId, desc, example) {
  const boxId = `vine-help-${nodeId}`;
  return `
    <div style="margin-bottom:10px">
      <button onclick="(function(b){var d=document.getElementById('${boxId}');var open=d.style.display==='block';d.style.display=open?'none':'block';b.style.color=open?'var(--text-dim)':'var(--accent)';b.style.borderColor=open?'var(--border)':'var(--accent)'})(this)"
              style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:1px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">?</button>
      <div id="${boxId}" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:2px;font-size:11px;line-height:1.5">
        <div style="color:var(--text);margin-bottom:6px">${desc}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:3px">Example</div>
        <pre style="margin:0;font-size:10px;color:var(--accent2);font-family:var(--font);white-space:pre-wrap;word-break:break-all">${_escHtml(example)}</pre>
      </div>
    </div>`;
}

// ── Shared style constants ────────────────────────────────────────────────────

const _IS = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;box-sizing:border-box;border-radius:2px';
const _LS = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

// ── Actions editor ─────────────────────────────────────────────────────────────
// Renders a list of action cards into `container`. Calls `onChange` on every mutation.

// Action types that carry a quest_id — these get an "Open quest ▸" jump button.
const _QUEST_LINK_ACTIONS = ['START_QUEST', 'TURN_IN', 'COMPLETE', 'ADVANCE'];

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

      // Cross-link: quest-referencing actions get a jump into that quest's editor.
      if (_QUEST_LINK_ACTIONS.includes(action.action) && action.quest_id) {
        const jump = document.createElement('button');
        jump.className = 'action-btn';
        jump.style.cssText = 'font-size:10px;margin-top:5px;width:100%';
        jump.textContent = `🌿 Open quest ▸ ${action.quest_id}`;
        jump.title = 'Commit this graph and open the referenced quest in VINE';
        jump.onclick = () => vineJumpTo('quest', action.quest_id);
        card.appendChild(jump);
      }

      // Cross-link: EXECUTE_SCRIPT jumps into the referenced script's editor.
      if (action.action === 'EXECUTE_SCRIPT' && action.scriptId) {
        const jump = document.createElement('button');
        jump.className = 'action-btn';
        jump.style.cssText = 'font-size:10px;margin-top:5px;width:100%';
        jump.textContent = `🌿 Open script ▸ ${action.scriptId}`;
        jump.title = 'Commit this graph and open the referenced script in VINE';
        jump.onclick = () => vineJumpTo('script', action.scriptId);
        card.appendChild(jump);
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

// Options are wired to their next node by INDEX (port `opt_N`), so any reorder or
// removal has to move the edges with them — otherwise deleting option 1 leaves
// every branch below it pointing one slot too high, and the tree quietly reroutes.
// Shared with the play-view editor (vine-dialogue-preview.js).
function _vineDropOptionEdge(graph, nodeId, removed) {
  for (let j = graph.edges.length - 1; j >= 0; j--) {
    const e = graph.edges[j];
    if (e.fromNode !== nodeId) continue;
    const m = /^opt_(\d+)$/.exec(e.fromPort);
    if (!m) continue;
    const n = Number(m[1]);
    if (n === removed) graph.edges.splice(j, 1);
    else if (n > removed) e.fromPort = `opt_${n - 1}`;
  }
}

function _vineSwapOptionEdges(graph, nodeId, a, b) {
  for (const e of graph.edges) {
    if (e.fromNode !== nodeId) continue;
    if (e.fromPort === `opt_${a}`) e.fromPort = `opt_${b}`;
    else if (e.fromPort === `opt_${b}`) e.fromPort = `opt_${a}`;
  }
}

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
      delBtn.onclick = () => { options.splice(i, 1); _vineDropOptionEdge(editor.graph, nodeId, i); onChange(); render(); };

      hdr.appendChild(title);
      hdr.appendChild(mkMoveBtn('↑', i === 0, () => { [options[i-1], options[i]] = [options[i], options[i-1]]; _vineSwapOptionEdges(editor.graph, nodeId, i-1, i); onChange(); render(); }));
      hdr.appendChild(mkMoveBtn('↓', i === options.length - 1, () => { [options[i], options[i+1]] = [options[i+1], options[i]]; _vineSwapOptionEdges(editor.graph, nodeId, i, i+1); onChange(); render(); }));
      hdr.appendChild(delBtn);
      card.appendChild(hdr);

      // Text
      const textInp = document.createElement('input');
      textInp.style.cssText = _IS + ';margin-bottom:5px';
      textInp.placeholder = 'Choice text shown to player…';
      textInp.value = opt.text || opt.label || '';
      // Drop the legacy `label` once edited here — both this editor and the game
      // client read `text || label`, so leaving it would resurrect the old wording
      // the moment you cleared the field.
      textInp.oninput = () => { opt.text = textInp.value; delete opt.label; onChange(); };
      card.appendChild(textInp);

      // Icon: the glyph shown ahead of this choice in the game. Blank = the engine's
      // derived one (shop/quest/turn-in/leave/hostile). The play view has a palette
      // for this; here it's a plain field so a glyph can be pasted in.
      const iconRow = document.createElement('div');
      iconRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
      const iconInp = document.createElement('input');
      iconInp.style.cssText = _IS + ';width:46px;text-align:center;font-size:14px;padding:2px';
      iconInp.value = opt.icon || '';
      iconInp.placeholder = '·';
      iconInp.oninput = () => {
        const v = iconInp.value.trim();
        if (v) opt.icon = v; else delete opt.icon;
        onChange();
      };
      const iconLbl = document.createElement('span');
      iconLbl.style.cssText = 'font-size:10px;color:var(--text-dim)';
      iconLbl.textContent = 'Icon (blank = automatic)';
      iconRow.appendChild(iconInp);
      iconRow.appendChild(iconLbl);
      card.appendChild(iconRow);

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
  vineIdentity: { kind: 'dialogue', tagline: 'NPC conversation tree', color: 'var(--accent2)', icon: '💬' },
  // Header button: open the play view on the conversation's entry node, so it's one
  // click from any NPC's dialogue without hunting for a node first.
  headerButton: {
    label: '🎮 Play view',
    title: 'Write, read and edit this conversation as the player sees it — starts a root beat if the graph is empty',
    onClick: () => vineDialoguePreviewOpen(window._vineActiveEditor),
  },
  nodeTypes: {
    dialogue: {
      label: 'Dialogue Node',
      // Tracks the active theme instead of a fixed green: VineDialogue's family
      // colour (--accent2), darkened so the header's white text stays legible on
      // light themes too.
      color: 'color-mix(in srgb, var(--accent2) 65%, #000)',
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
        const mentionsQuest = /quest/i.test(node.data.text || '') ||
          (node.data.options || []).some(o => /quest/i.test(o.text || o.label || ''));
        return `
          ${_dialogueHelpBox(nodeId,
            'One beat of NPC dialogue. The NPC Text is what the character says — separate alternate wordings with a line containing only <b>---</b> and the NPC picks one at random each time. Each Option is a choice shown to the player — draw an edge from an option\'s output port to the next dialogue node. Node Actions fire the moment this node is entered, before the player sees the text.',
            'NPC Text: "You look lost, stranger."\n           ---\n           "Lost, are you?"\n\nOption 1: "I\'m looking for the docks."  → node: give_directions\nOption 2: "None of your business."     → node: npc_offended\n\nNode Action: SET_FLAG  flag=met_harker'
          )}
          <button class="action-btn" style="font-size:10px;margin-bottom:10px;width:100%"
                  data-node="${_escHtml(nodeId)}"
                  onclick="vineDialoguePreviewOpen(window._vineActiveEditor, this.dataset.node)"
                  title="See this beat as the player does — and edit the text and options right in it">🎮 Play view — preview &amp; edit ▸</button>
          ${mentionsQuest ? `<button class="action-btn" style="font-size:10px;margin-bottom:10px;width:100%" onclick="vineGoToFamily('quest')" title="This node's text mentions &quot;quest&quot; — commit and jump to VineQuest">🌿 Mentions "quest" → Open VineQuest ▸</button>` : ''}
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
      // Anything the engine reads that this editor has no field for (grants_item,
      // node-level conditions, …) rides along untouched instead of being dropped
      // on save.
      const { text, options, actions, _vine, ...rest } = node;
      nodes[id] = {
        type: 'dialogue',
        x: pos.x,
        y: pos.y,
        _rest: rest,
        data: {
          text: _joinTextLines(node.text),
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
        ...(node._rest || {}),
        text: _splitTextLines(data.text),
        options: opts,
        actions: data.actions || [],
        _vine: { x: node.x, y: node.y },
      };
    }

    return tree;
  },
};
