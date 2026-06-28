// SVG bezier edge rendering for VINE. Stateless — call render() on every graph change.
// The temporary wire drawn while dragging a connection is managed by VineEditor directly.

// Sample 5 interior points along a cubic bezier (t = 0.2 … 0.8).
function _sampleBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2) {
  const pts = [];
  for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const mt = 1 - t;
    pts.push({
      x: mt*mt*mt*x1 + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*x2,
      y: mt*mt*mt*y1 + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*y2,
    });
  }
  return pts;
}

// Returns the vertical control-point offset (vo) needed to route around all
// intermediate nodes that the default bezier would pass through, or 0 if clear.
// Positive vo bows the curve below; negative above. Picks the shorter detour.
//
// Math: at t=0.5 the bezier midpoint is approximately edgeMidY + 0.75*vo,
// so vo = (desired_mid_y - edgeMidY) / 0.75.
function _computeNudge(x1, y1, cx1, cy1, cx2, cy2, x2, y2, nodeRects, fromId, toId) {
  const PAD = 8;
  const samples = _sampleBezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2);
  const edgeMidY = (y1 + y2) / 2;

  let voAbove = 0; // most-negative vo to clear all obstacles from above
  let voBelow = 0; // most-positive vo to clear all obstacles from below
  let found = false;

  for (const [id, r] of Object.entries(nodeRects)) {
    if (id === fromId || id === toId) continue;
    if (!samples.some(pt =>
      pt.x >= r.left - PAD && pt.x <= r.right + PAD &&
      pt.y >= r.top  - PAD && pt.y <= r.bottom + PAD
    )) continue;

    found = true;
    voAbove = Math.min(voAbove, (r.top    - PAD * 2 - edgeMidY) / 0.75);
    voBelow = Math.max(voBelow, (r.bottom + PAD * 2 - edgeMidY) / 0.75);
  }

  if (!found) return 0;
  return Math.abs(voAbove) <= Math.abs(voBelow) ? voAbove : voBelow;
}

const VineEdges = {
  render(nodes, edges, svgEl, canvasEl, onDelete, hidden) {
    svgEl.querySelectorAll('path[data-vine-edge]').forEach(p => p.remove());
    svgEl.querySelectorAll('defs.vine-edge-defs').forEach(d => d.remove());

    if (hidden) return;

    const svgRect = svgEl.getBoundingClientRect();
    if (!svgRect.width) return;

    // Snapshot node rects once so obstacle detection doesn't thrash the DOM.
    const nodeRects = {};
    canvasEl.querySelectorAll('[data-vine-id]').forEach(el => {
      nodeRects[el.dataset.vineId] = el.getBoundingClientRect();
    });

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.classList.add('vine-edge-defs');
    let gradIdx = 0;

    for (const edge of edges) {
      const fromPort = canvasEl.querySelector(`[data-vine-id="${edge.fromNode}"][data-port="${edge.fromPort}"]`);
      const toPort   = canvasEl.querySelector(`[data-vine-in="${edge.toNode}"]`);
      if (!fromPort || !toPort) continue;

      const fr = fromPort.getBoundingClientRect();
      const tr = toPort.getBoundingClientRect();

      const x1 = fr.right - svgRect.left,  y1 = fr.top + fr.height / 2 - svgRect.top;
      const x2 = tr.left  - svgRect.left,  y2 = tr.top + tr.height / 2 - svgRect.top;
      const dx = x2 - x1;

      let d, color, hoverColor;

      if (dx < -30) {
        // ── Backward / loop-back edge ─────────────────────────────────────────
        // Route as a U-curve going below both endpoints. Control points drop
        // straight down from each side so the curve exits/enters vertically,
        // which keeps the arc clear of horizontally-arranged nodes.
        const drop = Math.max(120, Math.abs(y2 - y1) * 0.5 + 80);
        const bottomY = Math.max(y1, y2) + drop;
        d = `M ${x1},${y1} C ${x1},${bottomY} ${x2},${bottomY} ${x2},${y2}`;

        // Gradient: accent3 (orange) at output/source → red at input/destination
        const gradId = `veg-${gradIdx++}`;
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        grad.setAttribute('x1', x1); grad.setAttribute('y1', y1);
        grad.setAttribute('x2', x2); grad.setAttribute('y2', y2);
        const b0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        b0.setAttribute('offset', '0%');
        b0.style.stopColor = 'var(--cyan)';
        const b1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        b1.setAttribute('offset', '100%');
        b1.style.stopColor = 'var(--red)';
        grad.appendChild(b0);
        grad.appendChild(b1);
        defs.appendChild(grad);

        color      = `url(#${gradId})`;
        hoverColor = 'var(--warning, #e0c040)';
      } else {
        // ── Forward edge ──────────────────────────────────────────────────────
        // Horizontal S-curve. If the path would pass through an intermediate
        // node, nudge the control points above or below to clear it.
        const cp = Math.max(60, Math.abs(dx) * 0.45);
        const vo = _computeNudge(x1, y1, x1+cp, y1, x2-cp, y2, x2, y2, nodeRects, edge.fromNode, edge.toNode);
        d = vo
          ? `M ${x1},${y1} C ${x1+cp},${y1+vo} ${x2-cp},${y2+vo} ${x2},${y2}`
          : `M ${x1},${y1} C ${x1+cp},${y1}    ${x2-cp},${y2}    ${x2},${y2}`;

        // Gradient: cyan at source (output/end of node) → accent at destination (input/beginning of node)
        const gradId = `veg-${gradIdx++}`;
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        grad.setAttribute('x1', x1); grad.setAttribute('y1', y1);
        grad.setAttribute('x2', x2); grad.setAttribute('y2', y2);
        const s0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s0.setAttribute('offset', '0%');
        s0.style.stopColor = 'var(--accent2)';
        const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s1.setAttribute('offset', '100%');
        s1.style.stopColor = 'var(--accent)';
        grad.appendChild(s0);
        grad.appendChild(s1);
        defs.appendChild(grad);

        color      = `url(#${gradId})`;
        hoverColor = 'var(--warning, #e0c040)';
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('data-vine-edge', `${edge.fromNode}:${edge.fromPort}:${edge.toNode}`);
      path.style.cssText = `stroke:${color};stroke-width:2;fill:none;cursor:pointer;pointer-events:stroke`;
      path.addEventListener('mouseenter', () => { path.style.stroke = hoverColor; path.style.strokeWidth = '3'; });
      path.addEventListener('mouseleave', () => { path.style.stroke = color;      path.style.strokeWidth = '2'; });
      path.addEventListener('click', (e) => { e.stopPropagation(); if (onDelete) onDelete(edge); });
      svgEl.appendChild(path);
    }

    if (defs.children.length) svgEl.insertBefore(defs, svgEl.firstChild);
  },

  // Temp-wire bezier while dragging a new connection (no obstacle avoidance needed).
  bezier(x1, y1, x2, y2) {
    const cp = Math.max(60, Math.abs(x2 - x1) * 0.45);
    return `M ${x1},${y1} C ${x1+cp},${y1} ${x2-cp},${y2} ${x2},${y2}`;
  },
};

window.VineEdges = VineEdges;
