// Broadcast graphics panel — ASCII art library for VINE title_card nodes.
// Includes an interactive canvas grid editor.
// All functions land in global scope (no modules).

// Common ASCII art characters for the palette
const ASCII_PALETTE = [
  '█','▓','▒','░','▄','▀','▌','▐','■','□','▪','▫',
  '─','│','┌','┐','└','┘','├','┤','┬','┴','┼',
  '═','║','╔','╗','╚','╝','╠','╣','╦','╩','╬',
  '●','○','◆','◇','★','☆','▲','▼','◄','►',
  '╱','╲','╳','≡','±','×','÷','∞','≈','≠',
];

// Canvas editor state
let _ce = {
  cols: 60, rows: 22,
  cells: [],       // [row][col] = char
  cursorR: 0, cursorC: 0,
  active: false,
};

let _graphicList = [];
let _graphicEditTarget = null;

// ── Panel render ─────────────────────────────────────────────────────────────

function renderGraphicsPanel(data) {
  _graphicList = Array.isArray(data) ? data : [];
  const panel = document.getElementById('list-panel');

  const rows = _graphicList.map(g => {
    const lineCount = (g.content || '').split('\n').length;
    const maxWidth = Math.max(...(g.content||'').split('\n').map(l => l.length));
    return `<tr>
      <td style="font-weight:600;color:var(--text-bright)">${escHtml4(g.name)}</td>
      <td style="font-size:10px;color:var(--text-dim);font-family:monospace">${escHtml4(g.id)}</td>
      <td style="font-size:11px;color:var(--text-dim)">${escHtml4(g.type || 'ascii')}</td>
      <td style="font-size:11px;color:var(--text-dim)">${lineCount}×${maxWidth}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="openGraphicEditor(${JSON.stringify(g).replace(/"/g,'&quot;')})">✏ Edit</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteGraphic('${g.id}','${escHtml4(g.name).replace(/'/g,"\\'")}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">Graphics Library</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${_graphicList.length} graphic${_graphicList.length !== 1 ? 's' : ''} — referenced by VINE title_card nodes</div>
        </div>
        <button class="action-btn" onclick="openGraphicEditor(null)">+ New Graphic</button>
      </div>
      ${_graphicList.length ? `
      <table>
        <thead><tr><th>Name</th><th>ID</th><th>Type</th><th>Size</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<div style="padding:24px;color:var(--text-dim)">No graphics yet. Create ASCII art to display via title_card nodes.</div>'}
    </div>`;
}

// ── Graphic editor modal ──────────────────────────────────────────────────────

function openGraphicEditor(rec) {
  _graphicEditTarget = rec || null;

  const typeOpts = ['ascii', 'svg'].map(t =>
    `<option value="${t}"${(rec?.type || 'ascii') === t ? ' selected' : ''}>${t}</option>`
  ).join('');

  const tagsVal = Array.isArray(rec?.tags) ? rec.tags.join(', ') : (rec?.tags || '');

  const body = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <!-- Meta row -->
      <div style="display:grid;grid-template-columns:1fr 80px 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Name *</label>
          <input id="gr-name" class="form-input" value="${escHtml4(rec?.name || '')}" placeholder="Graphic name">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Type</label>
          <select id="gr-type" class="form-input">${typeOpts}</select>
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Tags</label>
          <input id="gr-tags" class="form-input" value="${escHtml4(tagsVal)}" placeholder="intro, logo, alert">
        </div>
      </div>

      <!-- Tab bar -->
      <div style="display:flex;gap:2px;border-bottom:1px solid var(--border)">
        <button id="gr-tab-canvas" class="action-btn primary" style="font-size:10px;border-radius:2px 2px 0 0;margin-bottom:-1px;border-bottom:1px solid var(--bg2)" onclick="_grTab('canvas')">🎨 Canvas Editor</button>
        <button id="gr-tab-text" class="action-btn" style="font-size:10px;border-radius:2px 2px 0 0;margin-bottom:-1px" onclick="_grTab('text')">✏ Text Editor</button>
      </div>

      <!-- Canvas editor tab -->
      <div id="gr-canvas-tab">
        <!-- Toolbar -->
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <div style="font-size:10px;color:var(--text-dim)">Char palette:</div>
          <div id="gr-palette" style="display:flex;flex-wrap:wrap;gap:2px;max-width:340px"></div>
          <div style="display:flex;gap:4px;margin-left:auto">
            <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="_grClear()">Clear</button>
            <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="_grImportFromText()">← Import text</button>
          </div>
        </div>
        <!-- Selected char indicator -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <div style="font-size:10px;color:var(--text-dim)">Selected:</div>
          <div id="gr-sel-char" style="font-family:monospace;font-size:18px;color:var(--accent);min-width:20px;text-align:center">█</div>
          <div style="font-size:10px;color:var(--text-dim)">Click canvas to paint • Arrow keys move cursor • Type any character • Backspace = space</div>
        </div>
        <!-- Canvas -->
        <div style="overflow:auto;max-height:280px;border:1px solid var(--border);background:#050a08">
          <canvas id="gr-canvas" style="display:block;cursor:crosshair;image-rendering:pixelated"></canvas>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
          <div style="font-size:10px;color:var(--text-dim)">Grid size:</div>
          <input id="gr-cols" type="number" min="10" max="120" value="${_ce.cols}" style="width:56px;font-size:11px" class="form-input" oninput="_grResize()">
          <div style="font-size:10px;color:var(--text-dim)">×</div>
          <input id="gr-rows" type="number" min="4" max="50" value="${_ce.rows}" style="width:56px;font-size:11px" class="form-input" oninput="_grResize()">
          <div style="font-size:10px;color:var(--text-dim)">Cell size:</div>
          <input id="gr-cell-size" type="number" min="8" max="24" value="11" style="width:56px;font-size:11px" class="form-input" oninput="_grRedraw()">
        </div>
      </div>

      <!-- Text editor tab (hidden by default) -->
      <div id="gr-text-tab" style="display:none">
        <textarea id="gr-content" class="form-input" rows="16" style="font-family:monospace;font-size:12px;white-space:pre;resize:vertical;width:100%" placeholder="Paste or type ASCII art here...">${escHtml4(rec?.content || '')}</textarea>
        <div id="gr-text-preview-area" style="border:1px solid var(--border);background:var(--bg3);padding:10px;margin-top:8px;display:none">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px">Preview</div>
          <pre id="gr-text-preview" style="font-size:12px;line-height:1.3;color:var(--accent);margin:0;overflow-x:auto"></pre>
        </div>
      </div>
    </div>`;

  openModal(rec ? `Edit Graphic: ${escHtml4(rec.name)}` : 'New Graphic', body);
  document.getElementById('modal-save').onclick = saveGraphic;
  const card = document.querySelector('#generic-modal .modal-card');
  if (card) card.style.width = '820px';

  // Init canvas editor
  setTimeout(() => {
    _grInitCanvas(rec?.content || '');
    _grBuildPalette();
    // Text tab live preview
    const ta = document.getElementById('gr-content');
    const prev = document.getElementById('gr-text-preview');
    const prevArea = document.getElementById('gr-text-preview-area');
    if (ta && prev) {
      const update = () => {
        const v = ta.value.trim();
        prevArea.style.display = v ? 'block' : 'none';
        prev.textContent = v;
      };
      ta.addEventListener('input', update);
      update();
    }
  }, 0);
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function _grTab(tab) {
  const canvasTab = document.getElementById('gr-canvas-tab');
  const textTab = document.getElementById('gr-text-tab');
  const btnCanvas = document.getElementById('gr-tab-canvas');
  const btnText = document.getElementById('gr-tab-text');
  if (tab === 'canvas') {
    canvasTab.style.display = '';
    textTab.style.display = 'none';
    btnCanvas.className = 'action-btn primary';
    btnText.className = 'action-btn';
    // Sync from textarea to canvas
    const ta = document.getElementById('gr-content');
    if (ta?.value.trim()) _grLoadFromText(ta.value);
  } else {
    canvasTab.style.display = 'none';
    textTab.style.display = '';
    btnCanvas.className = 'action-btn';
    btnText.className = 'action-btn primary';
    // Sync from canvas to textarea
    _grSyncToTextarea();
    const ta = document.getElementById('gr-content');
    const prev = document.getElementById('gr-text-preview');
    const prevArea = document.getElementById('gr-text-preview-area');
    if (ta && prev) {
      const v = ta.value.trim();
      prevArea.style.display = v ? 'block' : 'none';
      prev.textContent = v;
    }
  }
}

// ── Canvas editor ─────────────────────────────────────────────────────────────

let _grSelChar = '█';

function _grBuildPalette() {
  const pal = document.getElementById('gr-palette');
  if (!pal) return;
  pal.innerHTML = ASCII_PALETTE.map(ch =>
    `<button title="${ch}" onclick="_grSelectChar('${ch}')" style="
      font-family:monospace;font-size:12px;width:20px;height:20px;
      padding:0;border:1px solid var(--border);background:var(--bg3);
      color:var(--accent);cursor:pointer;line-height:1;
    ">${ch}</button>`
  ).join('');
}

function _grSelectChar(ch) {
  _grSelChar = ch;
  const sel = document.getElementById('gr-sel-char');
  if (sel) sel.textContent = ch;
}

function _grInitCanvas(existingContent) {
  const cols = parseInt(document.getElementById('gr-cols')?.value || _ce.cols, 10);
  const rows = parseInt(document.getElementById('gr-rows')?.value || _ce.rows, 10);
  _ce.cols = cols; _ce.rows = rows;
  _ce.cursorR = 0; _ce.cursorC = 0;
  _ce.active = true;

  // Init empty grid
  _ce.cells = Array.from({ length: rows }, () => Array(cols).fill(' '));

  if (existingContent) _grLoadFromText(existingContent);

  const canvas = document.getElementById('gr-canvas');
  if (!canvas) return;

  // Set up canvas interactions
  canvas.onclick = null;
  canvas.onmousedown = (e) => {
    const { r, c } = _grCellFromEvent(e);
    _ce.cursorR = r; _ce.cursorC = c;
    _grPaintCell(r, c, _grSelChar);
    _grRedraw();
    canvas.focus();
  };
  canvas.tabIndex = 0;
  canvas.onkeydown = _grKeydown;

  _grRedraw();
}

function _grCellSize() {
  return parseInt(document.getElementById('gr-cell-size')?.value || 11, 10);
}

function _grRedraw() {
  const canvas = document.getElementById('gr-canvas');
  if (!canvas) return;
  const cs = _grCellSize();
  const cw = _ce.cols * cs;
  const ch = _ce.rows * cs;
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#050a08';
  ctx.fillRect(0, 0, cw, ch);

  // Grid lines (subtle)
  ctx.strokeStyle = 'rgba(0,180,120,0.08)';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= _ce.cols; c++) { ctx.beginPath(); ctx.moveTo(c*cs, 0); ctx.lineTo(c*cs, ch); ctx.stroke(); }
  for (let r = 0; r <= _ce.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r*cs); ctx.lineTo(cw, r*cs); ctx.stroke(); }

  // Characters
  ctx.font = `${Math.round(cs * 0.85)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let r = 0; r < _ce.rows; r++) {
    for (let c = 0; c < _ce.cols; c++) {
      const ch2 = (_ce.cells[r] && _ce.cells[r][c]) || ' ';
      if (ch2 !== ' ') {
        ctx.fillStyle = '#b8d4c8';
        ctx.fillText(ch2, c*cs + cs/2, r*cs + cs/2 + 0.5);
      }
    }
  }

  // Cursor
  const cr = _ce.cursorR, cc = _ce.cursorC;
  ctx.strokeStyle = 'rgba(0,220,180,0.8)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cc*cs + 1, cr*cs + 1, cs - 2, cs - 2);
}

function _grCellFromEvent(e) {
  const canvas = document.getElementById('gr-canvas');
  const rect = canvas.getBoundingClientRect();
  const cs = _grCellSize();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  return {
    r: Math.max(0, Math.min(_ce.rows - 1, Math.floor(y / cs))),
    c: Math.max(0, Math.min(_ce.cols - 1, Math.floor(x / cs))),
  };
}

function _grPaintCell(r, c, ch) {
  if (r < 0 || r >= _ce.rows || c < 0 || c >= _ce.cols) return;
  if (!_ce.cells[r]) _ce.cells[r] = Array(_ce.cols).fill(' ');
  _ce.cells[r][c] = ch;
}

function _grKeydown(e) {
  const move = (dr, dc) => {
    _ce.cursorR = Math.max(0, Math.min(_ce.rows - 1, _ce.cursorR + dr));
    _ce.cursorC = Math.max(0, Math.min(_ce.cols - 1, _ce.cursorC + dc));
  };
  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); move(-1, 0); break;
    case 'ArrowDown':  e.preventDefault(); move(1, 0); break;
    case 'ArrowLeft':  e.preventDefault(); move(0, -1); break;
    case 'ArrowRight': e.preventDefault(); move(0, 1); break;
    case 'Backspace':
      e.preventDefault();
      _grPaintCell(_ce.cursorR, _ce.cursorC, ' ');
      move(0, -1);
      break;
    case 'Enter':
      e.preventDefault();
      _ce.cursorR = Math.min(_ce.rows - 1, _ce.cursorR + 1);
      _ce.cursorC = 0;
      break;
    case 'Tab':
      e.preventDefault();
      move(0, 4);
      break;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        _grPaintCell(_ce.cursorR, _ce.cursorC, e.key);
        move(0, 1);
      }
      return;
  }
  _grRedraw();
}

function _grResize() {
  const cols = parseInt(document.getElementById('gr-cols')?.value || 60, 10);
  const rows = parseInt(document.getElementById('gr-rows')?.value || 22, 10);
  const newCells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (_ce.cells[r]?.[c]) ?? ' ')
  );
  _ce.cols = cols; _ce.rows = rows; _ce.cells = newCells;
  _ce.cursorR = Math.min(_ce.cursorR, rows - 1);
  _ce.cursorC = Math.min(_ce.cursorC, cols - 1);
  _grRedraw();
}

function _grClear() {
  if (!confirm('Clear the canvas?')) return;
  _ce.cells = Array.from({ length: _ce.rows }, () => Array(_ce.cols).fill(' '));
  _grRedraw();
}

function _grLoadFromText(text) {
  const lines = text.split('\n');
  const maxCol = Math.max(_ce.cols, ...lines.map(l => l.length));
  if (maxCol > _ce.cols) {
    _ce.cols = Math.min(120, maxCol);
    document.getElementById('gr-cols') && (document.getElementById('gr-cols').value = _ce.cols);
  }
  const maxRow = Math.max(_ce.rows, lines.length);
  if (maxRow > _ce.rows) {
    _ce.rows = Math.min(50, maxRow);
    document.getElementById('gr-rows') && (document.getElementById('gr-rows').value = _ce.rows);
  }
  _ce.cells = Array.from({ length: _ce.rows }, (_, r) => {
    const line = lines[r] || '';
    return Array.from({ length: _ce.cols }, (_, c) => line[c] ?? ' ');
  });
  _grRedraw();
}

function _grImportFromText() {
  _grSyncToTextarea();
  const ta = document.getElementById('gr-content');
  if (ta?.value.trim()) _grLoadFromText(ta.value);
}

function _grSyncToTextarea() {
  const lines = _ce.cells.map(row => {
    let line = row.join('');
    line = line.replace(/ +$/, ''); // trim trailing spaces per row
    return line;
  });
  // Trim trailing empty rows
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const ta = document.getElementById('gr-content');
  if (ta) ta.value = lines.join('\n');
}

// ── Save / delete ─────────────────────────────────────────────────────────────

async function saveGraphic() {
  const name = document.getElementById('gr-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  // If canvas tab is active, sync canvas → textarea first
  const canvasTabVisible = document.getElementById('gr-canvas-tab')?.style.display !== 'none';
  if (canvasTabVisible) _grSyncToTextarea();

  const content = document.getElementById('gr-content')?.value || '';
  if (!content.trim()) { toast('Content is required.', true); return; }

  const rawTags = document.getElementById('gr-tags')?.value || '';
  const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);

  const payload = {
    name,
    description: document.getElementById('gr-description')?.value?.trim() || '',
    type: document.getElementById('gr-type')?.value || 'ascii',
    content,
    tags,
  };

  try {
    if (_graphicEditTarget) {
      await directAPI(`/broadcast/graphics/${_graphicEditTarget.id}`, 'PUT', payload);
    } else {
      await directAPI('/broadcast/graphics', 'POST', payload);
    }
    closeModal();
    toast('Graphic saved.');
    await showPanel('graphics');
  } catch (e) {
    toast(`Save failed: ${e.message}`, true);
  }
}

async function deleteGraphic(id, name) {
  if (!confirm(`Delete graphic "${name}"?`)) return;
  try {
    await directAPI(`/broadcast/graphics/${id}`, 'DELETE');
    toast('Graphic deleted.');
    await showPanel('graphics');
  } catch (e) {
    toast(`Delete failed: ${e.message}`, true);
  }
}

function escHtml4(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
