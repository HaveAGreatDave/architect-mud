// VINE — Visual Interaction/Node Editor.
// Generic DOM/SVG graph editor; dialogue and script specifics live in schemas.
// Global: window.VineEditor

class VineEditor {
  // containerEl: the div VINE fills. schema: { nodeTypes, ... } from a schema file.
  constructor(containerEl, schema) {
    this.schema = schema;
    this.containerEl = containerEl;
    this.graph = { nodes: {}, edges: [] };
    this._view = { x: 20, y: 20, scale: 1 };
    this._selection = new Set();
    this._history = new VineCommandStack();
    this._callbacks = { change: [], nodeSelect: [] };
    this._drag = null;      // { nodeId, startX, startY, origX, origY }
    this._pan = null;       // { startX, startY, viewX, viewY }
    this._wire = null;      // { fromNode, fromPort, path }
    this._edgesHidden = false;
    this._keyHandler = this._onKey.bind(this);
    this._setupDOM();
    this._bindWorkspace();
    document.addEventListener('keydown', this._keyHandler);
  }

  // ── DOM Setup ─────────────────────────────────────────────────────────────

  _setupDOM() {
    // Set individual properties so we don't overwrite height/flex/border the caller put on containerEl.
    this.containerEl.style.position = 'relative';
    this.containerEl.style.overflow = 'hidden';
    this.containerEl.style.display = 'flex';
    this.containerEl.style.background = 'var(--bg2)';
    this.containerEl.style.userSelect = 'none';

    // Left area: canvas + SVG
    this._area = document.createElement('div');
    this._area.style.cssText = 'position:relative;flex:1;overflow:hidden;min-width:0';

    this._canvas = document.createElement('div');
    this._canvas.className = 'vine-canvas';
    this._canvas.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;z-index:2';

    this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1';

    // Persistent gradient for the temp wire drawn while dragging a connection.
    const wireDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    this._wireGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    this._wireGrad.setAttribute('id', 'vine-wire-grad');
    this._wireGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
    const wg0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    wg0.setAttribute('offset', '0%');
    wg0.style.stopColor = 'var(--accent2)';
    const wg1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    wg1.setAttribute('offset', '100%');
    wg1.style.stopColor = 'var(--accent3)';
    this._wireGrad.appendChild(wg0);
    this._wireGrad.appendChild(wg1);
    wireDefs.appendChild(this._wireGrad);
    this._svg.appendChild(wireDefs);

    // Toolbar (on top of SVG)
    this._toolbar = document.createElement('div');
    this._toolbar.style.cssText = 'position:absolute;top:8px;left:8px;z-index:30;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100% - 290px)';

    this._area.appendChild(this._canvas);
    this._area.appendChild(this._svg);
    this._area.appendChild(this._toolbar);

    // Right area: properties panel
    this._props = document.createElement('div');
    this._props.className = 'vine-props';
    this._props.style.cssText = 'width:280px;min-width:280px;border-left:1px solid var(--border);overflow-y:auto;background:var(--bg3);z-index:10;flex-shrink:0';
    this._props.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:12px">Select a node to edit its properties.</div>';

    this.containerEl.appendChild(this._area);
    this.containerEl.appendChild(this._props);

    this._buildToolbar();
  }

  _buildToolbar() {
    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'action-btn';
      b.textContent = label;
      if (title) b.title = title;
      b.onclick = fn;
      return b;
    };

    const types = Object.keys(this.schema.nodeTypes || {});
    for (const type of types) {
      const def = this.schema.nodeTypes[type];
      this._toolbar.appendChild(mkBtn(`+ ${def.label || type}`, `Add ${def.label || type} node`, () => this.addNode(type)));
    }

    this._toolbar.appendChild(mkBtn('⊡', 'Reset view (Ctrl+0)', () => this._resetView()));
    this._toolbar.appendChild(mkBtn('−', 'Zoom out (Ctrl+−)', () => this._adjustZoom(-0.15)));
    this._toolbar.appendChild(mkBtn('+', 'Zoom in (Ctrl+=)', () => this._adjustZoom(0.15)));
    this._toolbar.appendChild(mkBtn('↩', 'Undo (Ctrl+Z)', () => { if (this._history.undo()) this._renderAll(); }));
    this._toolbar.appendChild(mkBtn('↪', 'Redo (Ctrl+Y)', () => { if (this._history.redo()) this._renderAll(); }));
    this._toolbar.appendChild(mkBtn('⟳ Auto-layout', 'Arrange nodes left-to-right, minimise crossings', () => this._autoLayout()));
    this._toolbar.appendChild(mkBtn('⬇ Layout Vertical', 'Arrange nodes top-to-bottom, packed to fit the most nodes on screen', () => this._autoLayoutVertical()));

    this._hideWiresBtn = mkBtn('Hide Wires', 'Toggle connection visibility', () => {
      this._edgesHidden = !this._edgesHidden;
      this._hideWiresBtn.textContent = this._edgesHidden ? 'Show Wires' : 'Hide Wires';
      this._renderEdges();
    });
    this._toolbar.appendChild(this._hideWiresBtn);
  }

  // ── Pan / Zoom ─────────────────────────────────────────────────────────────

  _applyTransform() {
    const { x, y, scale } = this._view;
    this._canvas.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    this._renderEdges();
  }

  _adjustZoom(delta, pivotX, pivotY) {
    const prev = this._view.scale;
    const next = Math.max(0.25, Math.min(2.5, prev + delta));
    if (pivotX != null) {
      this._view.x = pivotX - (pivotX - this._view.x) * (next / prev);
      this._view.y = pivotY - (pivotY - this._view.y) * (next / prev);
    }
    this._view.scale = next;
    this._applyTransform();
  }

  _resetView() {
    this._view = { x: 20, y: 20, scale: 1 };
    this._applyTransform();
  }

  // Fit all nodes into the visible area with padding.
  _fitToView() {
    const ids = Object.keys(this.graph.nodes);
    if (!ids.length) return;
    const PAD = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const el = this._canvas.querySelector(`[data-vine-id="${id}"]`);
      const n = this.graph.nodes[id];
      const w = el ? el.offsetWidth : 240;
      const h = el ? el.offsetHeight : 120;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }
    const areaW = this._area.clientWidth;
    const areaH = this._area.clientHeight;
    const contentW = maxX - minX + PAD * 2;
    const contentH = maxY - minY + PAD * 2;
    const scale = Math.min(1, Math.min(areaW / contentW, areaH / contentH));
    this._view = {
      x: (areaW - contentW * scale) / 2 - minX * scale + PAD * scale,
      y: (areaH - contentH * scale) / 2 - minY * scale + PAD * scale,
      scale,
    };
    this._applyTransform();
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  _bindWorkspace() {
    this._area.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const r = this._area.getBoundingClientRect();
        this._adjustZoom(e.deltaY < 0 ? 0.1 : -0.1, e.clientX - r.left, e.clientY - r.top);
      } else {
        this._view.x -= e.deltaX;
        this._view.y -= e.deltaY;
        this._applyTransform();
      }
    }, { passive: false });

    this._area.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        this._pan = { startX: e.clientX, startY: e.clientY, viewX: this._view.x, viewY: this._view.y };
        return;
      }
      // Click on empty background → deselect
      if (e.target === this._area || e.target === this._svg || e.target === this._canvas) {
        this._clearSelection();
      }
    });

    this._area.addEventListener('mousemove', (e) => {
      if (this._pan) {
        this._view.x = this._pan.viewX + (e.clientX - this._pan.startX);
        this._view.y = this._pan.viewY + (e.clientY - this._pan.startY);
        this._applyTransform();
        return;
      }
      if (this._drag) {
        const s = this._view.scale;
        const node = this.graph.nodes[this._drag.nodeId];
        if (node) {
          node.x = Math.round(this._drag.origX + (e.clientX - this._drag.startX) / s);
          node.y = Math.round(this._drag.origY + (e.clientY - this._drag.startY) / s);
          this._positionNode(this._drag.nodeId);
          this._renderEdges();
        }
        return;
      }
      if (this._wire) {
        const sr = this._svg.getBoundingClientRect();
        const pr = this._wire.anchorEl.getBoundingClientRect();
        const x1 = pr.right - sr.left;
        const y1 = pr.top + pr.height / 2 - sr.top;
        const x2 = e.clientX - sr.left;
        const y2 = e.clientY - sr.top;
        this._wire.path.setAttribute('d', VineEdges.bezier(x1, y1, x2, y2));
        this._wireGrad.setAttribute('x1', x1); this._wireGrad.setAttribute('y1', y1);
        this._wireGrad.setAttribute('x2', x2); this._wireGrad.setAttribute('y2', y2);
      }
    });

    this._area.addEventListener('mouseup', (e) => {
      if (this._pan) { this._pan = null; return; }
      if (this._drag) {
        const orig = { x: this._drag.origX, y: this._drag.origY };
        const id = this._drag.nodeId;
        const cur = { x: this.graph.nodes[id]?.x, y: this.graph.nodes[id]?.y };
        if (orig.x !== cur.x || orig.y !== cur.y) {
          this._history.push({
            undo: () => {
              if (this.graph.nodes[id]) { this.graph.nodes[id].x = orig.x; this.graph.nodes[id].y = orig.y; }
              this._positionNode(id); this._renderEdges();
            },
          });
          this._fire('change');
        }
        // Restore normal layering: nodes (canvas z-index:2) above edges (svg z-index:1)
        this._svg.style.zIndex = '1';
        const draggedEl = this._canvas.querySelector(`[data-vine-id="${id}"]`);
        if (draggedEl) draggedEl.style.zIndex = '';
        this._drag = null;
        return;
      }
      if (this._wire) { this._cancelWire(); }
    });
  }

  _onKey(e) {
    // Only act when focus is inside the vine container or on body.
    const active = document.activeElement;
    const inEditor = this.containerEl.contains(active) || active === document.body;
    if (!inEditor) return;
    const inText = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT';

    if ((e.key === 'Delete' || e.key === 'Backspace') && !inText) {
      e.preventDefault();
      this._deleteSelected();
    }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (this._history.undo()) this._renderAll(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); if (this._history.redo()) this._renderAll(); }
    if (e.ctrlKey && e.key === 'a' && !inText) { e.preventDefault(); this._selectAll(); }
  }

  // ── Node CRUD ──────────────────────────────────────────────────────────────

  addNode(type, data, x, y) {
    const def = this.schema.nodeTypes[type];
    if (!def) { console.warn('[vine] unknown node type:', type); return null; }
    let id = 'node1';
    let n = 1;
    while (this.graph.nodes[id]) id = 'node' + (++n);
    const node = {
      type,
      x: x ?? Math.max(40, Object.keys(this.graph.nodes).length * 40 + 80),
      y: y ?? 80,
      data: data != null ? data : JSON.parse(JSON.stringify(def.defaultData || {})),
    };
    this.graph.nodes[id] = node;
    this._renderNode(id);
    this._history.push({ undo: () => { this._removeNodeDOM(id); delete this.graph.nodes[id]; this._renderEdges(); } });
    this._fire('change');
    return id;
  }

  _renameNode(oldId, newId) {
    if (!newId || !oldId || oldId === newId) return false;
    if (this.graph.nodes[newId]) { toast(`Node ID "${newId}" already exists.`, true); return false; }
    this.graph.nodes[newId] = this.graph.nodes[oldId];
    delete this.graph.nodes[oldId];
    for (const edge of this.graph.edges) {
      if (edge.fromNode === oldId) edge.fromNode = newId;
      if (edge.toNode === oldId) edge.toNode = newId;
    }
    this._selection.delete(oldId);
    this._selection.add(newId);
    this._renderAll();
    this._renderProperties(newId);
    this._fire('change');
    return true;
  }

  _deleteNode(id) {
    const snap = { node: { ...this.graph.nodes[id] }, edges: this.graph.edges.filter(e => e.fromNode === id || e.toNode === id) };
    this._removeNodeDOM(id);
    this.graph.edges = this.graph.edges.filter(e => e.fromNode !== id && e.toNode !== id);
    delete this.graph.nodes[id];
    this._selection.delete(id);
    this._history.push({
      undo: () => {
        this.graph.nodes[id] = snap.node;
        this.graph.edges.push(...snap.edges);
        this._renderNode(id); this._renderEdges();
      },
    });
    this._renderEdges();
    if (!this._selection.size) this._props.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:12px">Select a node to edit its properties.</div>';
    this._fire('change');
  }

  _deleteSelected() {
    const ids = [...this._selection];
    if (!ids.length) return;
    for (const id of ids) this._deleteNode(id);
  }

  _removeNodeDOM(id) {
    this._canvas.querySelector(`[data-vine-id="${id}"]`)?.remove();
  }

  // ── Auto-layout (Sugiyama-lite) ────────────────────────────────────────────

  _autoLayout() { this._runAutoLayout(false); }
  _autoLayoutVertical() { this._runAutoLayout(true); }

  _runAutoLayout(vertical) {
    const nodes = this.graph.nodes;
    const edges = this.graph.edges;
    const ids = Object.keys(nodes);
    if (!ids.length) return;

    // Snapshot positions for undo.
    const before = {};
    for (const id of ids) before[id] = { x: nodes[id].x, y: nodes[id].y };

    // ── 1. Detect back edges (cycles) via DFS so they don't distort layering.
    const visited = new Set();
    const onStack = new Set();
    const backEdges = new Set();
    const dfs = (id) => {
      visited.add(id); onStack.add(id);
      for (const e of edges) {
        if (e.fromNode !== id) continue;
        if (onStack.has(e.toNode)) { backEdges.add(e); continue; }
        if (!visited.has(e.toNode)) dfs(e.toNode);
      }
      onStack.delete(id);
    };
    for (const id of ids) { if (!visited.has(id)) dfs(id); }

    // ── 2. Longest-path layer assignment (gives inputs-left, outputs-right).
    const layer = {};
    const inDeg = {};
    const fwdOut = {}; // forward adjacency only
    for (const id of ids) { inDeg[id] = 0; fwdOut[id] = []; }
    for (const e of edges) {
      if (!backEdges.has(e) && ids.includes(e.fromNode) && ids.includes(e.toNode)) {
        fwdOut[e.fromNode].push(e.toNode);
        inDeg[e.toNode]++;
      }
    }

    // Kahn's topological BFS, tracking longest path to each node.
    const queue = ids.filter(id => inDeg[id] === 0);
    for (const id of queue) layer[id] = 0;
    const q = [...queue];
    while (q.length) {
      const id = q.shift();
      for (const to of fwdOut[id]) {
        layer[to] = Math.max(layer[to] ?? 0, layer[id] + 1);
        if (--inDeg[to] === 0) q.push(to);
      }
    }
    // Anything left unassigned (pure cycle, no source) gets layer 0.
    for (const id of ids) { if (layer[id] == null) layer[id] = 0; }

    // ── 3. Group nodes into columns.
    const maxLayer = Math.max(...ids.map(id => layer[id]));
    const cols = Array.from({ length: maxLayer + 1 }, () => []);
    for (const id of ids) cols[layer[id]].push(id);

    // ── 4. Barycenter cross-minimisation (3 forward + 3 backward sweeps).
    // rank[id] = fractional position within its column (for barycenter calc).
    const rank = {};
    for (const col of cols) col.forEach((id, i) => rank[id] = i);

    const barycenter = (id, srcLayer) => {
      const preds = edges
        .filter(e => !backEdges.has(e) && e.toNode === id && layer[e.fromNode] === srcLayer)
        .map(e => rank[e.fromNode]);
      const succs = edges
        .filter(e => !backEdges.has(e) && e.fromNode === id && layer[e.toNode] === srcLayer)
        .map(e => rank[e.toNode]);
      const all = [...preds, ...succs];
      return all.length ? all.reduce((a, b) => a + b, 0) / all.length : rank[id];
    };

    for (let pass = 0; pass < 3; pass++) {
      // Forward sweep
      for (let l = 1; l <= maxLayer; l++) {
        cols[l].sort((a, b) => barycenter(a, l - 1) - barycenter(b, l - 1));
        cols[l].forEach((id, i) => rank[id] = i);
      }
      // Backward sweep
      for (let l = maxLayer - 1; l >= 0; l--) {
        cols[l].sort((a, b) => barycenter(a, l + 1) - barycenter(b, l + 1));
        cols[l].forEach((id, i) => rank[id] = i);
      }
    }

    // ── 5. Assign pixel positions.
    if (vertical) {
      const ROW_H = 110, OX = 40, OY = 50;
      const WRAP_COLS = Math.max(1, Math.ceil(Math.sqrt(Math.max(...cols.map(c => c.length)))));
      const COL_W = 200;
      for (const id of ids) {
        const r = rank[id];
        nodes[id].x = (r % WRAP_COLS) * COL_W + OX;
        nodes[id].y = layer[id] * ROW_H + Math.floor(r / WRAP_COLS) * (ROW_H * 0.55) + OY;
      }
    } else {
      const COL_W = 320, ROW_H = 180, OX = 40, OY = 60;
      for (const id of ids) {
        nodes[id].x = layer[id] * COL_W + OX;
        nodes[id].y = rank[id]  * ROW_H + OY;
      }
    }
    this._renderAll();
    requestAnimationFrame(() => { this._renderEdges(); this._fitToView(); });
    this._fire('change');

    // Push undo record after render so positions are stable.
    const after = {};
    for (const id of ids) after[id] = { x: nodes[id].x, y: nodes[id].y };
    this._history.push({
      undo: () => {
        for (const id of ids) { if (nodes[id]) { nodes[id].x = before[id].x; nodes[id].y = before[id].y; } }
        this._renderAll(); requestAnimationFrame(() => this._renderEdges());
      },
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  _renderAll() {
    this._canvas.innerHTML = '';
    for (const id of Object.keys(this.graph.nodes)) this._renderNode(id);
    this._renderEdges();
  }

  _renderNode(id) {
    const node = this.graph.nodes[id];
    if (!node) return;
    const def = this.schema.nodeTypes[node.type];
    if (!def) return;

    let el = this._canvas.querySelector(`[data-vine-id="${id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.vineId = id;
      this._canvas.appendChild(el);
    }

    const selected = this._selection.has(id);
    const color = def.color || 'var(--accent)';
    const ports = def.getOutPorts ? def.getOutPorts(node) : [{ key: 'next', label: 'next' }];

    const portHtml = ports.map(p => `
      <div class="vine-port-out" data-vine-id="${id}" data-port="${p.key}"
           style="display:flex;align-items:center;justify-content:space-between;padding:2px 8px;font-size:11px;color:var(--text-dim);cursor:crosshair;gap:4px">
        <span>${p.label}</span>
        <span style="color:var(--accent);font-size:14px;line-height:1">●</span>
      </div>`).join('');

    el.className = 'vine-node';
    el.style.cssText = `
      position:absolute;
      min-width:200px;max-width:280px;
      background:var(--bg3);
      border:2px solid ${selected ? 'var(--accent)' : 'var(--border)'};
      border-radius:4px;
      cursor:pointer;
      box-shadow:${selected ? '0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent)' : 'none'};
      font-family:var(--font);font-size:12px;
    `;

    el.innerHTML = `
      <div class="vine-node-header" data-vine-drag="${id}"
           style="background:${color};color:#fff;padding:5px 8px;font-size:11px;font-weight:bold;
                  display:flex;justify-content:space-between;align-items:center;cursor:move;border-radius:2px 2px 0 0">
        <span class="vine-node-id" style="opacity:0.85;font-size:10px">${id}</span>
        <span>${def.label || node.type}</span>
        <button class="vine-node-del" data-vine-del="${id}"
                style="background:none;border:none;color:#fff;cursor:pointer;opacity:0.7;font-size:14px;line-height:1;padding:0 2px"
                title="Delete node">✕</button>
      </div>
      <div data-vine-in="${id}"
           style="position:absolute;left:-10px;top:50%;transform:translateY(-50%);
                  width:12px;height:12px;background:var(--bg3);border:2px solid var(--accent);
                  border-radius:50%;cursor:crosshair;z-index:1" title="Input"></div>
      <div class="vine-node-body" style="padding:8px;border-bottom:${ports.length ? '1px solid var(--border)' : 'none'}">
        ${def.renderBody ? def.renderBody(node) : ''}
      </div>
      <div class="vine-node-ports">${portHtml}</div>
    `;

    this._positionNode(id);
    this._bindNodeEvents(el, id);
  }

  _positionNode(id) {
    const el = this._canvas.querySelector(`[data-vine-id="${id}"]`);
    const node = this.graph.nodes[id];
    if (el && node) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
  }

  _bindNodeEvents(el, id) {
    // Header drag
    el.querySelector(`[data-vine-drag="${id}"]`)?.addEventListener('mousedown', (e) => {
      if (e.target.dataset.vineDel) return;
      e.stopPropagation();
      const node = this.graph.nodes[id];
      this._drag = { nodeId: id, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
      // Lift SVG above all nodes, and dragged node above SVG so its connections are visible over siblings
      this._svg.style.zIndex = '3';
      el.style.zIndex = '4';
    });

    // Delete button
    el.querySelector(`[data-vine-del="${id}"]`)?.addEventListener('click', (e) => {
      e.stopPropagation(); this._deleteNode(id);
    });

    // Select on click (not on port or delete button)
    el.addEventListener('click', (e) => {
      if (e.target.dataset.vineDel || e.target.closest('[data-vine-id][data-port]') || e.target.closest('[data-vine-in]')) return;
      this._selectNode(id);
    });

    // Output ports → start wire
    el.querySelectorAll('[data-vine-id][data-port]').forEach(port => {
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this._startWire(id, port.dataset.port, port);
      });
    });

    // Input port → end wire
    el.querySelector(`[data-vine-in="${id}"]`)?.addEventListener('mouseup', (e) => {
      if (this._wire) { e.stopPropagation(); this._endWire(id); }
    });
  }

  _renderEdges() {
    VineEdges.render(this.graph.nodes, this.graph.edges, this._svg, this._canvas, (edge) => {
      this.graph.edges = this.graph.edges.filter(e => e !== edge);
      this._renderEdges();
      this._fire('change');
    }, this._edgesHidden);
  }

  // ── Wire (edge drawing) ────────────────────────────────────────────────────

  _startWire(fromNode, fromPort, anchorEl) {
    if (this._wire) this._cancelWire();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.style.cssText = 'stroke:url(#vine-wire-grad);stroke-width:2;fill:none;stroke-dasharray:5 3;pointer-events:none';
    this._svg.appendChild(path);
    this._wire = { fromNode, fromPort, anchorEl, path };
  }

  _endWire(toNode) {
    if (!this._wire) return;
    const { fromNode, fromPort } = this._wire;
    this._cancelWire();
    if (fromNode === toNode) return;
    // Replace any existing edge from the same port.
    this.graph.edges = this.graph.edges.filter(e => !(e.fromNode === fromNode && e.fromPort === fromPort));
    this.graph.edges.push({ fromNode, fromPort, toNode });
    this._renderEdges();
    this._fire('change');
  }

  _cancelWire() {
    if (this._wire?.path) this._wire.path.remove();
    this._wire = null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  _selectNode(id) {
    this._selection.clear();
    this._selection.add(id);
    this._canvas.querySelectorAll('[data-vine-id]').forEach(el => {
      const sel = this._selection.has(el.dataset.vineId);
      el.style.border = `2px solid ${sel ? 'var(--accent)' : 'var(--border)'}`;
      el.style.boxShadow = sel ? '0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent)' : 'none';
    });
    this._renderProperties(id);
    this._fire('nodeSelect', id);
  }

  _clearSelection() {
    this._selection.clear();
    this._canvas.querySelectorAll('[data-vine-id]').forEach(el => {
      el.style.border = '2px solid var(--border)';
      el.style.boxShadow = 'none';
    });
    this._props.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:12px">Select a node to edit its properties.</div>';
  }

  _selectAll() {
    Object.keys(this.graph.nodes).forEach(id => this._selection.add(id));
    this._canvas.querySelectorAll('[data-vine-id]').forEach(el => {
      el.style.border = '2px solid var(--accent)';
    });
  }

  // ── Properties Panel ───────────────────────────────────────────────────────

  _renderProperties(id) {
    const node = this.graph.nodes[id];
    if (!node) { this._clearSelection(); return; }
    const def = this.schema.nodeTypes[node.type];
    const bodyHtml = def?.renderProperties ? def.renderProperties(node, this, id) : '<div style="color:var(--text-dim);font-size:12px">No editable properties.</div>';

    this._props.innerHTML = `
      <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Node ID</div>
        <input id="vine-node-id-input" value="${id}"
               style="flex:1;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:3px 6px;border-radius:2px"
               title="Rename this node">
      </div>
      <div style="padding:12px">${bodyHtml}</div>
    `;

    // Node rename
    const idInput = this._props.querySelector('#vine-node-id-input');
    if (idInput) {
      idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') idInput.blur(); });
      idInput.addEventListener('blur', () => {
        const newId = idInput.value.trim();
        if (newId && newId !== id) this._renameNode(id, newId);
      });
    }

    // Let the schema build complex interactive UI now that the DOM exists
    if (def?.afterRenderProperties) def.afterRenderProperties(this._props, node, this, id);

    // Field bindings: data-vine-field="data.foo" with optional data-vine-type="json|number|boolean"
    this._props.querySelectorAll('[data-vine-field]').forEach(input => {
      const fieldPath = input.dataset.vineField;
      const valType = input.dataset.vineType || 'string';
      const update = () => {
        const n = this.graph.nodes[id];
        if (!n) return;
        let val = input.type === 'checkbox' ? input.checked : input.value;
        if (valType === 'json') {
          try { val = JSON.parse(val || input.dataset.vineDefault || '{}'); }
          catch { if (typeof toast === 'function') toast(`${fieldPath}: invalid JSON`, true); return; }
        } else if (valType === 'number') {
          val = Number(val);
        }
        // Support "data.key" paths
        if (fieldPath.startsWith('data.')) {
          n.data[fieldPath.slice(5)] = val;
        } else {
          n[fieldPath] = val;
        }
        // Re-render node body and ports
        this._refreshNodeDisplay(id);
        this._renderEdges();
        this._fire('change');
      };
      input.addEventListener('change', update);
      if (input.dataset.vineInstant) input.addEventListener('input', update);
    });
  }

  _refreshNodeDisplay(id) {
    const node = this.graph.nodes[id];
    const el = this._canvas.querySelector(`[data-vine-id="${id}"]`);
    if (!node || !el) return;
    const def = this.schema.nodeTypes[node.type];
    if (!def) return;

    const body = el.querySelector('.vine-node-body');
    if (body && def.renderBody) body.innerHTML = def.renderBody(node);

    const portsDiv = el.querySelector('.vine-node-ports');
    if (portsDiv && def.getOutPorts) {
      const ports = def.getOutPorts(node);
      portsDiv.innerHTML = ports.map(p => `
        <div class="vine-port-out" data-vine-id="${id}" data-port="${p.key}"
             style="display:flex;align-items:center;justify-content:space-between;padding:2px 8px;font-size:11px;color:var(--text-dim);cursor:crosshair;gap:4px">
          <span>${p.label}</span>
          <span style="color:var(--accent);font-size:14px;line-height:1">●</span>
        </div>`).join('');
      portsDiv.querySelectorAll('[data-vine-id][data-port]').forEach(port => {
        port.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this._startWire(id, port.dataset.port, port);
        });
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  load(graphData) {
    this.graph = {
      nodes: graphData.nodes ? JSON.parse(JSON.stringify(graphData.nodes)) : {},
      edges: graphData.edges ? JSON.parse(JSON.stringify(graphData.edges)) : [],
    };
    this._view = graphData._view ? { ...graphData._view } : { x: 20, y: 20, scale: 1 };
    this._history.clear();
    this._selection.clear();
    this._renderAll();
    this._applyTransform();
    this._props.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:12px">Select a node to edit its properties.</div>';
    // Re-render edges after layout settles (getBoundingClientRect needs a paint frame).
    requestAnimationFrame(() => this._renderEdges());
  }

  save() {
    return {
      nodes: JSON.parse(JSON.stringify(this.graph.nodes)),
      edges: JSON.parse(JSON.stringify(this.graph.edges)),
      _view: { ...this._view },
    };
  }

  destroy() {
    document.removeEventListener('keydown', this._keyHandler);
    this.containerEl.innerHTML = '';
  }

  on(event, fn) {
    if (this._callbacks[event]) this._callbacks[event].push(fn);
    return this;
  }

  _fire(event, data) {
    (this._callbacks[event] || []).forEach(fn => fn(data));
  }
}

window.VineEditor = VineEditor;

// ── VINE Modal (for NPC dialogue editor) ───────────────────────────────────

let _vineModalEditor = null;
let _vineModalOnSave = null;

function vineModalOpen(title, schema, graphData, onSave) {
  const modal = document.getElementById('vine-modal');
  if (!modal) return;
  document.getElementById('vine-modal-title').textContent = title;
  modal.style.display = 'flex';
  _vineModalOnSave = onSave;

  if (_vineModalEditor) { _vineModalEditor.destroy(); _vineModalEditor = null; }
  const body = document.getElementById('vine-modal-body');
  body.innerHTML = '';

  _vineModalEditor = new VineEditor(body, schema);
  window._vineActiveEditor = _vineModalEditor;
  _vineModalEditor.load(graphData);
}

function vineModalClose() {
  document.getElementById('vine-modal').style.display = 'none';
  if (_vineModalEditor) { _vineModalEditor.destroy(); _vineModalEditor = null; }
  window._vineActiveEditor = null;
}

function vineModalSave() {
  if (_vineModalEditor && _vineModalOnSave) {
    _vineModalOnSave(_vineModalEditor.save());
  }
  vineModalClose();
}

function vineModalImportJSON() {
  openModal('Load JSON into VINE', `
    <div class="field"><label>Paste graph JSON</label>
      <textarea id="vine-import-json" style="width:100%;height:300px;font-family:monospace;font-size:11px" placeholder='{"nodes":{},"edges":[]}'></textarea>
    </div>`);
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Load';
  saveBtn.onclick = () => {
    const raw = document.getElementById('vine-import-json').value.trim();
    try {
      const graph = JSON.parse(raw);
      if (_vineModalEditor) _vineModalEditor.load(graph);
      closeModal();
    } catch (e) {
      toast('Invalid JSON: ' + e.message, true);
    }
  };
}
