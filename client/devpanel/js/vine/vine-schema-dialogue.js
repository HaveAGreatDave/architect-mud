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
        const data = node.data;
        const optsJson = JSON.stringify(
          (data.options || []).map(o => {
            const { next, ...rest } = o; // strip 'next' — connections are drawn
            return rest;
          }),
          null, 2
        );
        const actionsJson = JSON.stringify(data.actions || [], null, 2);
        const inputStyle = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px;box-sizing:border-box;border-radius:2px';
        return `
          <div style="margin-bottom:12px">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:4px">NPC Text</label>
            <textarea data-vine-field="data.text" data-vine-instant rows="5"
                      style="${inputStyle};resize:vertical">${_escHtml(data.text || '')}</textarea>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:4px">
              Options (JSON — omit "next", draw connections instead)
            </label>
            <textarea data-vine-field="data.options" data-vine-type="json" rows="10"
                      style="${inputStyle};resize:vertical;font-size:11px">${_escHtml(optsJson)}</textarea>
            <div style="font-size:10px;color:var(--text-dim);margin-top:3px">
              Each option: <code style="font-size:10px">{"text":"…","conditions":[],"actions":[],"enabled":true}</code>
            </div>
          </div>
          <div>
            <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:4px">
              Node Actions (fire on enter)
            </label>
            <textarea data-vine-field="data.actions" data-vine-type="json" rows="5"
                      style="${inputStyle};resize:vertical;font-size:11px">${_escHtml(actionsJson)}</textarea>
            <div style="font-size:10px;color:var(--text-dim);margin-top:3px">
              Each action: <code style="font-size:10px">{"action":"GRANT_ITEM","params":{"item_id":"…"}}</code>
            </div>
          </div>
        `;
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
