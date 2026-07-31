// VINE Dialogue — "Play view": the dialogue node as the player will actually see
// it, with every visible string editable in place. Launched from a dialogue node's
// properties panel; edits go straight into the open VineEditor's graph, so the
// normal 💾 Save & Close is still what persists them.
//
// Two panes:
//   • LEFT — the whole conversation as a TREE, parent→child by option wiring, with
//     an edit box on every line (NPC beats and player responses alike) and an icon
//     picker on every response. This is the writing surface: you can rewrite a
//     branch end-to-end without walking it.
//   • RIGHT — the single beat as the player sees it. Clicking an option walks the
//     card to that option's target node.
// The two panes edit the same graph objects, so a keystroke in one updates the
// other's field in place (never by re-render — that would eat the caret).

let _vdpEditor = null;
let _vdpNodeId = null;
let _vdpTrail = [];   // node ids walked into, for the ← Back button
let _vdpIconFor = null; // "nodeId|optIndex" whose icon palette is open, if any

function _vdpEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mirror of dialogueOptionKind() in server/engine/dialogue.js — same rules, read
// off the VINE graph instead of a dialogue_tree. The server is the source of truth
// for what the player sees; this exists so the author sees the same glyph while
// writing. Keep the two rule lists in step.
const _OPT_KINDS = {
  hostile:{ icon: '⚠', label: 'Turns hostile' },
  shop:   { icon: '🛒', label: 'Opens shop' },
  quest:  { icon: '❗', label: 'Takes a job' },
  turnin: { icon: '✅', label: 'Hands in a job' },
  leave:  { icon: '🚪', label: 'Ends conversation' },
};

// An author-assigned glyph (`opt.icon`) beats the derived one. It rides to the
// engine untouched — the option object is spread onto the wire in
// filterDialogueOptions() — so nothing server-side needs to know about it, and the
// game client prefers `_icon` over the kind glyph. A hostile option keeps its red
// styling and its stakes line either way; the icon is presentation, not the warning.
const _VDP_ICON_PALETTE = [
  '💬', '❓', '❗', '✅', '⚠', '🚪', '🛒', '💰', '🤝', '👊',
  '🔑', '📦', '🩸', '💉', '🍺', '🚬', '🔧', '🚗', '🎲', '☢',
  '❤', '🕵', '📄', '📻', '🏥', '🛏', '🎤', '🔒',
];

function _vdpTargetOf(graph, nodeId, i) {
  const edge = (graph.edges || []).find(e => e.fromNode === nodeId && e.fromPort === `opt_${i}`);
  return edge ? edge.toNode : '';
}

function _vdpKind(graph, nodeId, opt, i) {
  const target = _vdpTargetOf(graph, nodeId, i);
  const has = (name) =>
    (opt.actions || []).some(a => a?.action === name) ||
    ((graph.nodes[target]?.data?.actions) || []).some(a => a?.action === name);
  // Irreversible first: a line that both ends the talk and swings at you reads as
  // the swing. Mirrors HOSTILE_ACTIONS / isHostileOption in server/engine/dialogue.js.
  const repDelta = ['ADJUST_REPUTATION'].flatMap(n =>
    [...(opt.actions || []), ...((graph.nodes[target]?.data?.actions) || [])].filter(a => a?.action === n)
  ).map(a => Number(a.delta ?? a.params?.delta ?? 0));
  if (['ATTACK', 'ARREST', 'APPREHEND', 'CHARGE_CRIME', 'WANTED_RAISE', 'HEAT_RAISE'].some(has)
    || repDelta.some(d => d < 0)) return 'hostile';
  if (target === '__shop__' || has('OPEN_SHOP')) return 'shop';
  if (has('TURN_IN')) return 'turnin';
  if (has('START_QUEST')) return 'quest';
  if (has('END_CONVERSATION')) return 'leave';
  return null;
}

// ── Overlay ───────────────────────────────────────────────────────────────────

// `nodeId` omitted (header button) → start where the conversation starts: 'root',
// which is the entry node the engine looks for, else whatever node exists first.
function _vdpEntryNode(graph) {
  if (graph.nodes.root) return 'root';
  return Object.keys(graph.nodes)[0] || null;
}

// An empty graph is the normal starting point for a new NPC, so the play view
// writes the first beat itself rather than sending the author to the canvas. It
// must be called `root` — that's the entry node the engine looks for
// (renderDialogueNode in server/engine/dialogue.js), and addNode() only ever mints
// nodeN ids, so this one is seeded by hand.
function _vdpSeedRoot(editor) {
  editor.graph.nodes.root = { type: 'dialogue', x: 40, y: 60, data: { text: '', options: [], actions: [] } };
  editor._renderNode('root');
  editor._fire('change');
  return 'root';
}

// Give an option somewhere to go: mint the next beat, wire this option's port to
// it, and walk the play card into it so you can keep writing forward. This is what
// makes the play view a place you can build a whole conversation, not just edit one.
function _vdpNewChild(nodeId, i) {
  const editor = _vdpEditor;
  if (!editor) return;
  const parent = editor.graph.nodes[nodeId];
  const id = editor.addNode('dialogue', undefined, (parent?.x || 40) + 320, (parent?.y || 60) + i * 160);
  if (!id) return;
  editor.graph.edges.push({ fromNode: nodeId, fromPort: `opt_${i}`, toNode: id });
  editor._renderEdges();
  editor._fire('change');
  _vdpGoTo(id);
}

function vineDialoguePreviewOpen(editor, nodeId) {
  if (!editor) return;
  _vdpEditor = editor;
  // Blank graph (a brand-new NPC): seed the entry beat and start writing in it.
  const start = nodeId || _vdpEntryNode(editor.graph) || _vdpSeedRoot(editor);
  if (!editor.graph.nodes[start]) {
    _vdpEditor = null;
    return toast(`Node "${start}" isn't in this graph.`, true);
  }
  _vdpNodeId = start;
  _vdpTrail = [];

  let ov = document.getElementById('vine-dlg-preview');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'vine-dlg-preview';
    ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:660;' +
      'background:color-mix(in srgb,var(--bg) 78%,transparent);align-items:center;justify-content:center';
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) vineDialoguePreviewClose(); });
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  _vdpRender();
}

function vineDialoguePreviewClose() {
  const ov = document.getElementById('vine-dlg-preview');
  if (ov) ov.style.display = 'none';
  _vdpEditor = null;
  _vdpNodeId = null;
  _vdpTrail = [];
}

// Commit a change into the graph and keep the canvas behind us honest.
function _vdpChanged() {
  if (!_vdpEditor) return;
  _vdpEditor._refreshNodeDisplay(_vdpNodeId);
  _vdpEditor._renderEdges();
  _vdpEditor._fire('change');
}

function _vdpGoTo(id) {
  if (!_vdpEditor?.graph.nodes[id]) return;
  _vdpTrail.push(_vdpNodeId);
  _vdpNodeId = id;
  _vdpRender();
}

function _vdpBack() {
  const prev = _vdpTrail.pop();
  if (prev && _vdpEditor?.graph.nodes[prev]) { _vdpNodeId = prev; _vdpRender(); }
}

// Jump the canvas editor to whatever node the preview is on and close — for when
// you need the full properties panel (conditions, actions) for this beat.
function _vdpEditOnCanvas() {
  const editor = _vdpEditor, id = _vdpNodeId;
  vineDialoguePreviewClose();
  if (editor) { editor._selection.clear(); editor._selection.add(id); editor._renderAll(); editor._renderProperties(id); }
}

function _vdpRender() {
  const ov = document.getElementById('vine-dlg-preview');
  if (!ov || !_vdpEditor) return;
  const graph = _vdpEditor.graph;
  const node = graph.nodes[_vdpNodeId];
  if (!node) return vineDialoguePreviewClose();

  const npcName = (document.getElementById('vine-modal-title')?.textContent || 'NPC')
    .replace(/^Dialogue:\s*/, '');
  const options = node.data.options || (node.data.options = []);
  const text = node.data.text || '';
  const variants = text.split(/\n[ \t]*---[ \t]*\n/).length;

  ov.innerHTML = `
   <div style="display:flex;gap:14px;align-items:flex-start">
    <div id="vdp-tree-pane" style="width:min(460px,42vw);max-height:82vh;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;gap:8px;align-items:center;font-size:10px;letter-spacing:1.5px;
                  text-transform:uppercase;color:var(--text-dim)">
        <span>Conversation tree</span>
        <span style="flex:1"></span>
        <span style="text-transform:none;letter-spacing:0">every line editable</span>
      </div>
      <div id="vdp-tree" style="flex:1;overflow:auto;background:var(--bg2);border:1px solid var(--border);
                                border-radius:2px;padding:8px 8px 12px"></div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;align-items:center">
      <div style="display:flex;gap:6px;align-items:center;font-size:10px;letter-spacing:1.5px;
                  text-transform:uppercase;color:var(--text-dim)">
        <span>Play view — node</span>
        <span style="color:var(--accent2);font-weight:bold">${_vdpEsc(_vdpNodeId)}</span>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--accent2);width:min(520px,94vw);
                  min-height:360px;max-height:76vh;padding:16px 18px;border-radius:2px;
                  display:flex;flex-direction:column;box-sizing:border-box">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-shrink:0">
          <span style="color:var(--accent2);font-weight:bold;font-size:13px;text-transform:uppercase;letter-spacing:1px">
            ${_vdpEsc(npcName)}</span>
          <button class="action-btn" onclick="vineDialoguePreviewClose()" style="padding:1px 7px">✕</button>
        </div>

        <textarea id="vdp-text" placeholder="What the NPC says…"
          style="flex:1;min-height:120px;background:var(--bg);border:1px solid var(--border);
                 color:var(--text);font-family:var(--font);font-size:13px;line-height:1.45;
                 padding:8px;margin-bottom:8px;border-radius:2px;resize:vertical;box-sizing:border-box"
        >${_vdpEsc(text)}</textarea>
        ${variants > 1 ? `<div style="font-size:10px;color:var(--text-dim);margin:-4px 0 8px">
          ${variants} alternate lines (split on <b>---</b>) — the NPC picks one at random.</div>` : ''}

        <div id="vdp-options" style="display:flex;flex-direction:column;gap:4px;flex-shrink:0"></div>
        <button class="action-btn" id="vdp-add" style="font-size:11px;margin-top:6px">+ Add Option</button>
      </div>

      <div style="display:flex;gap:6px;align-items:center">
        <button class="action-btn" id="vdp-back" ${_vdpTrail.length ? '' : 'disabled'}>← Back</button>
        <button class="action-btn" onclick="_vdpEditOnCanvas()"
                title="Select this node on the canvas for its full properties (conditions, actions)">✎ Full editor</button>
        <span style="font-size:10px;color:var(--text-dim)">Edits land in the graph — 💾 Save &amp; Close still persists them.</span>
      </div>
    </div>
   </div>`;

  const cardText = document.getElementById('vdp-text');
  cardText.oninput = function () {
    node.data.text = this.value;
    // Mirror into the tree's box for the same beat by hand — re-rendering the tree
    // on every keystroke would move the caret out from under the author.
    const twin = document.querySelector(`#vdp-tree [data-vdp-node="${CSS.escape(_vdpNodeId)}"]`);
    if (twin && twin.value !== this.value) twin.value = this.value;
    _vdpChanged();
  };
  document.getElementById('vdp-add').onclick = () => {
    options.push({ text: '', enabled: true, actions: [] });
    _vdpChanged();
    _vdpRender();
  };
  document.getElementById('vdp-back').onclick = _vdpBack;

  _vdpRenderOptions(graph, node, options);
  _vdpRenderTree(graph);
}

// ── Tree pane ─────────────────────────────────────────────────────────────────

// Flatten the conversation into rows, depth-first over the option wiring, so the
// author reads it as parent→children. A node already shown earlier in the walk is
// emitted as a "loops back" leaf instead of being expanded again — dialogue trees
// routinely return to root, and expanding those would never terminate. Anything the
// walk can't reach from the entry node is listed after, as unreachable.
function _vdpTreeRows(graph) {
  const rows = [];
  const seen = new Set();

  const walk = (id, depth) => {
    if (!graph.nodes[id]) return;
    if (seen.has(id)) { rows.push({ kind: 'loop', id, depth }); return; }
    seen.add(id);
    rows.push({ kind: 'node', id, depth });
    const opts = graph.nodes[id].data.options || [];
    if (!opts.length) rows.push({ kind: 'end', id, depth: depth + 1 });
    opts.forEach((opt, i) => {
      rows.push({ kind: 'opt', id, i, opt, depth: depth + 1 });
      const target = _vdpTargetOf(graph, id, i);
      if (target) walk(target, depth + 2);
    });
  };

  const entry = _vdpEntryNode(graph);
  if (entry) walk(entry, 0);
  const orphans = Object.keys(graph.nodes).filter(n => !seen.has(n));
  if (orphans.length) {
    rows.push({ kind: 'orphan', depth: 0 });
    // Walking an orphan marks its own children seen, so a chain of unreachable
    // nodes reads as one subtree rather than repeating under each member.
    for (const id of orphans) if (!seen.has(id)) walk(id, 0);
  }
  return rows;
}

function _vdpRenderTree(graph) {
  const wrap = document.getElementById('vdp-tree');
  if (!wrap) return;
  wrap.innerHTML = '';

  for (const row of _vdpTreeRows(graph)) {
    const el = document.createElement('div');
    el.style.cssText = `margin-left:${row.depth * 13}px;padding-left:7px;` +
      'border-left:1px solid var(--border);padding-top:3px;padding-bottom:3px';

    if (row.kind === 'loop') {
      el.innerHTML = `<span style="font-size:10px;color:var(--text-dim)">↩ loops back to
        <b style="color:var(--accent2)">${_vdpEsc(row.id)}</b></span>`;
      el.style.cursor = 'pointer';
      el.onclick = () => _vdpGoTo(row.id);
    } else if (row.kind === 'end') {
      el.innerHTML = `<span style="font-size:10px;color:var(--text-dim)">■ ends the conversation</span>`;
    } else if (row.kind === 'orphan') {
      el.style.borderLeft = 'none';
      el.style.marginTop = '8px';
      el.innerHTML = `<span style="font-size:10px;text-transform:uppercase;letter-spacing:1px;
        color:var(--warn,var(--text-dim))">Unreachable from the entry node</span>`;
    } else if (row.kind === 'node') {
      _vdpTreeNodeRow(el, graph, row);
    } else {
      _vdpTreeOptRow(el, graph, row);
    }
    wrap.appendChild(el);
  }
  // An icon palette opened from the play card may be well down the tree.
  document.getElementById('vdp-icon-pal')?.scrollIntoView({ block: 'nearest' });
}

// An NPC beat: its id (click to walk the play card here) over an edit box for the
// line itself. Highlighted when it's the beat the card is showing.
function _vdpTreeNodeRow(el, graph, row) {
  const node = graph.nodes[row.id];
  const current = row.id === _vdpNodeId;

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px';
  const idBtn = document.createElement('button');
  idBtn.className = 'action-btn';
  idBtn.style.cssText = 'font-size:10px;padding:0 6px;' +
    (current ? 'color:var(--accent);border-color:var(--accent)' : '');
  idBtn.textContent = row.id;
  idBtn.title = 'Show this beat in the play view';
  idBtn.onclick = () => _vdpGoTo(row.id);
  hdr.appendChild(idBtn);
  if (current) {
    const here = document.createElement('span');
    here.style.cssText = 'font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--accent)';
    here.textContent = '◂ in play view';
    hdr.appendChild(here);
  }
  const addOpt = document.createElement('button');
  addOpt.className = 'action-btn';
  addOpt.style.cssText = 'font-size:9px;padding:0 5px;margin-left:auto';
  addOpt.textContent = '+ response';
  addOpt.title = 'Add a player choice to this beat';
  addOpt.onclick = () => {
    (node.data.options || (node.data.options = [])).push({ text: '', enabled: true, actions: [] });
    _vdpChanged();
    _vdpRender();
  };
  hdr.appendChild(addOpt);
  el.appendChild(hdr);

  const ta = document.createElement('textarea');
  ta.rows = 2;
  ta.dataset.vdpNode = row.id;
  ta.placeholder = 'What the NPC says…';
  ta.value = node.data.text || '';
  ta.style.cssText = 'width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);' +
    'font-family:var(--font);font-size:12px;line-height:1.4;padding:4px 6px;border-radius:2px;' +
    'resize:vertical;box-sizing:border-box';
  ta.oninput = () => {
    node.data.text = ta.value;
    if (row.id === _vdpNodeId) {
      const card = document.getElementById('vdp-text');
      if (card && card.value !== ta.value) card.value = ta.value;
    }
    _vdpEditor._refreshNodeDisplay(row.id);
    _vdpEditor._fire('change');
  };
  el.appendChild(ta);
}

// A player response: icon picker, edit box, and where it goes.
function _vdpTreeOptRow(el, graph, row) {
  const { opt, i } = row;
  const kind = _vdpKind(graph, row.id, opt, i);
  const meta = _OPT_KINDS[kind];
  const target = _vdpTargetOf(graph, row.id, i);
  const key = `${row.id}|${i}`;

  const line = document.createElement('div');
  line.style.cssText = 'display:flex;align-items:center;gap:5px' +
    (opt.enabled === false ? ';opacity:.5' : '');

  // Icon: assigned glyph if the author picked one, else the derived kind glyph
  // (shown dimmed, because the player sees it but it isn't stored on the option).
  const iconBtn = document.createElement('button');
  iconBtn.className = 'action-btn';
  iconBtn.style.cssText = 'font-size:12px;padding:0 4px;width:24px;flex-shrink:0' +
    (opt.icon ? '' : ';opacity:.55');
  iconBtn.textContent = opt.icon || (meta ? meta.icon : '·');
  iconBtn.title = opt.icon
    ? 'Assigned icon — click to change or clear'
    : (meta ? `Automatic: ${meta.label}. Click to assign one instead.` : 'Assign an icon');
  iconBtn.onclick = () => { _vdpIconFor = _vdpIconFor === key ? null : key; _vdpRenderTree(graph); };
  line.appendChild(iconBtn);

  const inp = document.createElement('input');
  inp.dataset.vdpOpt = key;
  inp.value = opt.text || opt.label || '';
  inp.placeholder = 'Choice text shown to the player…';
  inp.style.cssText = 'flex:1;min-width:0;background:var(--bg);border:1px solid var(--border);' +
    'color:var(--text);font-family:var(--font);font-size:12px;padding:3px 6px;border-radius:2px';
  inp.oninput = () => {
    opt.text = inp.value;
    delete opt.label;
    if (row.id === _vdpNodeId) {
      const card = document.querySelector(`#vdp-options [data-vdp-cardopt="${i}"]`);
      if (card && card.value !== inp.value) card.value = inp.value;
    }
    _vdpEditor._refreshNodeDisplay(row.id);
    _vdpEditor._renderEdges();
    _vdpEditor._fire('change');
  };
  line.appendChild(inp);

  // Where it goes — or, if nowhere yet, the button that writes the next beat.
  if (!target) {
    const add = document.createElement('button');
    add.className = 'action-btn';
    add.style.cssText = 'font-size:9px;padding:0 5px;flex-shrink:0';
    add.textContent = '+ beat';
    add.title = 'Create the NPC beat this choice leads to, and open it';
    add.onclick = () => _vdpNewChild(row.id, i);
    line.appendChild(add);
  } else {
    const dest = document.createElement('span');
    dest.style.cssText = 'font-size:9px;color:var(--text-dim);flex-shrink:0;max-width:90px;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    dest.textContent = graph.nodes[target] ? '▸' : `${target} ⚠`;
    dest.title = graph.nodes[target]
      ? `Goes to ${target}`
      : `Wired to "${target}", not a node in this graph (fine for __shop__).`;
    line.appendChild(dest);
  }

  el.appendChild(line);
  if (_vdpIconFor === key) el.appendChild(_vdpIconPalette(graph, opt));
}

// Glyph palette for one option. "Auto" clears the assignment and hands the option
// back to the derived kind glyph.
function _vdpIconPalette(graph, opt) {
  const pal = document.createElement('div');
  pal.id = 'vdp-icon-pal';
  pal.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;margin:4px 0 2px 24px;padding:4px;' +
    'background:var(--bg);border:1px solid var(--accent2);border-radius:2px';

  const pick = (glyph) => {
    if (glyph) opt.icon = glyph; else delete opt.icon;
    _vdpIconFor = null;
    _vdpChanged();
    _vdpRender();
  };

  const auto = document.createElement('button');
  auto.className = 'action-btn';
  auto.style.cssText = 'font-size:9px;padding:0 5px';
  auto.textContent = 'auto';
  auto.title = 'No assigned icon — use the one derived from what the option does';
  auto.onclick = () => pick(null);
  pal.appendChild(auto);

  for (const glyph of _VDP_ICON_PALETTE) {
    const b = document.createElement('button');
    b.className = 'action-btn';
    b.style.cssText = 'font-size:13px;padding:0 3px;min-width:22px' +
      (opt.icon === glyph ? ';border-color:var(--accent)' : '');
    b.textContent = glyph;
    b.onclick = () => pick(glyph);
    pal.appendChild(b);
  }
  return pal;
}

function _vdpRenderOptions(graph, node, options) {
  const wrap = document.getElementById('vdp-options');
  wrap.innerHTML = '';

  if (!options.length) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:6px 0">
      No options — this beat ends the conversation.</div>`;
    return;
  }

  options.forEach((opt, i) => {
    const kind = _vdpKind(graph, _vdpNodeId, opt, i);
    const target = _vdpTargetOf(graph, _vdpNodeId, i);
    const meta = _OPT_KINDS[kind];
    const disabled = opt.enabled === false;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;background:var(--bg3);' +
      'border:1px solid var(--border);border-radius:2px;padding:4px 8px' +
      (disabled ? ';opacity:.5' : '');

    // The glyph the player will actually see: the author's assigned icon if there
    // is one, else the one derived from what the option does. Click to assign.
    const ic = document.createElement('button');
    ic.className = 'action-btn';
    ic.style.cssText = 'font-size:12px;padding:0 4px;width:22px;flex-shrink:0;' +
      'background:none;border:none' + (opt.icon ? '' : ';opacity:.6');
    ic.textContent = opt.icon || (meta ? meta.icon : '·');
    ic.title = opt.icon ? 'Assigned icon — click to change or clear'
      : (meta ? `Automatic: ${meta.label}. Click to assign one instead.` : 'Assign an icon');
    ic.onclick = () => { _vdpIconFor = `${_vdpNodeId}|${i}`; _vdpRenderTree(graph); };
    row.appendChild(ic);

    const inp = document.createElement('input');
    inp.dataset.vdpCardopt = String(i);
    inp.value = opt.text || opt.label || '';
    inp.placeholder = 'Choice text shown to the player…';
    inp.style.cssText = 'flex:1;min-width:0;background:none;border:none;color:var(--text);' +
      'font-family:var(--font);font-size:13px;padding:2px 0;outline:none';
    inp.oninput = () => {
      opt.text = inp.value;
      delete opt.label;
      const twin = document.querySelector(`#vdp-tree [data-vdp-opt="${CSS.escape(_vdpNodeId + '|' + i)}"]`);
      if (twin && twin.value !== inp.value) twin.value = inp.value;
      _vdpChanged();
    };
    row.appendChild(inp);

    // Where it goes. Unwired options say so rather than looking finished.
    const dest = document.createElement('button');
    dest.className = 'action-btn';
    dest.style.cssText = 'font-size:10px;padding:1px 6px;flex-shrink:0;max-width:150px;overflow:hidden;text-overflow:ellipsis';
    if (target && graph.nodes[target]) {
      dest.textContent = `${target} ▸`;
      dest.title = 'Walk the preview to this option\'s node';
      dest.onclick = () => _vdpGoTo(target);
    } else if (target) {
      dest.textContent = `${target} ⚠`;
      dest.title = `Wired to "${target}", which isn't a node in this graph (fine for __shop__).`;
      dest.disabled = true;
    } else {
      // Nowhere yet — offer to write the next beat rather than just reporting it.
      dest.textContent = '+ beat ▸';
      dest.title = 'Create the NPC beat this choice leads to, and open it';
      dest.onclick = () => _vdpNewChild(_vdpNodeId, i);
    }
    row.appendChild(dest);

    const del = document.createElement('button');
    del.className = 'action-btn danger';
    del.style.cssText = 'font-size:10px;padding:1px 6px;flex-shrink:0';
    del.textContent = '✕';
    del.title = 'Delete this option';
    del.onclick = () => {
      options.splice(i, 1);
      _vineDropOptionEdge(graph, _vdpNodeId, i); // keeps the opt_N wiring aligned
      _vdpChanged();
      _vdpRender();
    };
    row.appendChild(del);

    wrap.appendChild(row);
  });
}

window.vineDialoguePreviewOpen = vineDialoguePreviewOpen;
window.vineDialoguePreviewClose = vineDialoguePreviewClose;
window._vdpEditOnCanvas = _vdpEditOnCanvas;
