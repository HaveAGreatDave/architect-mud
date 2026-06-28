// SVG bezier edge rendering for VINE. Stateless — call render() whenever the
// graph changes. Edges are permanent paths; the temporary wire drawn while
// connecting is managed by VineEditor directly.
const VineEdges = {
  // Render all edges into svgEl. onDelete(edge) is called when an edge is clicked.
  render(nodes, edges, svgEl, canvasEl, onDelete) {
    // Remove all permanent edge paths (leave temp wires alone).
    svgEl.querySelectorAll('path[data-vine-edge]').forEach(p => p.remove());

    const svgRect = svgEl.getBoundingClientRect();
    if (!svgRect.width) return; // not yet in DOM

    for (const edge of edges) {
      const fromPort = canvasEl.querySelector(
        `[data-vine-id="${edge.fromNode}"][data-port="${edge.fromPort}"]`
      );
      const toPort = canvasEl.querySelector(`[data-vine-in="${edge.toNode}"]`);
      if (!fromPort || !toPort) continue;

      const fr = fromPort.getBoundingClientRect();
      const tr = toPort.getBoundingClientRect();

      const x1 = fr.right - svgRect.left;
      const y1 = fr.top + fr.height / 2 - svgRect.top;
      const x2 = tr.left - svgRect.left;
      const y2 = tr.top + tr.height / 2 - svgRect.top;

      const cp = Math.max(60, Math.abs(x2 - x1) * 0.45);
      const d = `M ${x1},${y1} C ${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('data-vine-edge', `${edge.fromNode}:${edge.fromPort}:${edge.toNode}`);
      path.style.cssText = 'stroke:var(--accent);stroke-width:2;fill:none;cursor:pointer;pointer-events:stroke';

      path.addEventListener('mouseenter', () => { path.style.stroke = 'var(--warning, #e0a500)'; path.style.strokeWidth = '3'; });
      path.addEventListener('mouseleave', () => { path.style.stroke = 'var(--accent)'; path.style.strokeWidth = '2'; });
      path.addEventListener('click', (e) => { e.stopPropagation(); if (onDelete) onDelete(edge); });

      svgEl.appendChild(path);
    }
  },

  // Compute a bezier path string between two screen points (used for temp wire).
  bezier(x1, y1, x2, y2) {
    const cp = Math.max(60, Math.abs(x2 - x1) * 0.45);
    return `M ${x1},${y1} C ${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;
  },
};

window.VineEdges = VineEdges;
