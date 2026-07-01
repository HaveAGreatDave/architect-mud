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
  colors: [],      // [row][col] = hex string | null (null = default)
  cursorR: 0, cursorC: 0,
  active: false,
};

let _grSelColor  = null;  // null = default color
let _grEraseMode = false;

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
  const isSvg = rec?.type === 'svg';

  const tagsVal = Array.isArray(rec?.tags) ? rec.tags.join(', ') : (rec?.tags || '');

  const body = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <!-- Meta row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Name *</label>
          <input id="gr-name" class="form-input" value="${escHtml4(rec?.name || '')}" placeholder="Graphic name">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Tags</label>
          <input id="gr-tags" class="form-input" value="${escHtml4(tagsVal)}" placeholder="intro, logo, alert">
        </div>
      </div>

      <!-- Tab bar -->
      <div style="display:flex;gap:2px;border-bottom:1px solid var(--border);align-items:flex-end">
        <button id="gr-tab-canvas" class="action-btn${isSvg ? '' : ' primary'}" style="font-size:10px;border-radius:2px 2px 0 0;margin-bottom:-1px${isSvg ? '' : ';border-bottom:1px solid var(--bg2)'}" onclick="_grTab('canvas')">🎨 ASCII Canvas</button>
        <button id="gr-tab-text"   class="action-btn" style="font-size:10px;border-radius:2px 2px 0 0;margin-bottom:-1px" onclick="_grTab('text')">✏ Text</button>
        <button id="gr-tab-vector" class="action-btn${isSvg ? ' primary' : ''}" style="font-size:10px;border-radius:2px 2px 0 0;margin-bottom:-1px${isSvg ? ';border-bottom:1px solid var(--bg2)' : ''}" onclick="_grTab('vector')">◈ Vector</button>
        <button class="action-btn" style="font-size:10px;margin-left:auto;margin-bottom:2px" onclick="_grTvPreview()">📺 TV Preview</button>
      </div>

      <!-- ASCII canvas tab -->
      <div id="gr-canvas-tab" style="display:${isSvg ? 'none' : ''}">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <div style="font-size:10px;color:var(--text-dim)">Char palette:</div>
          <div id="gr-palette" style="display:flex;flex-wrap:wrap;gap:2px;max-width:340px"></div>
          <div style="display:flex;gap:4px;margin-left:auto">
            <button id="gr-erase-btn" class="action-btn" style="font-size:10px;padding:2px 8px" onclick="_grToggleErase()">⌫ Erase</button>
            <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="_grClear()">Clear</button>
            <button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="_grImportFromText()">← Import text</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap">
          <div style="font-size:10px;color:var(--text-dim)">Selected:</div>
          <div id="gr-sel-char" style="font-family:monospace;font-size:18px;color:var(--accent);min-width:20px;text-align:center">█</div>
          <div style="width:1px;height:16px;background:var(--border)"></div>
          <div style="font-size:10px;color:var(--text-dim)">Color:</div>
          <input id="gr-color-pick" type="color" value="#b8d4c8"
            style="width:26px;height:22px;padding:0;border:1px solid var(--border);background:transparent;cursor:pointer"
            oninput="_grSetColor(this.value)" title="Character color">
          <button class="action-btn" style="font-size:10px;padding:1px 6px" onclick="_grSetColor(null)" title="Remove color — use default">✕ default</button>
          <div style="font-size:10px;color:var(--text-dim)">· Click to paint · Arrows move · Type chars · Backspace = erase</div>
        </div>
        <div style="overflow:auto;max-height:280px;border:1px solid var(--border);background:#050a08">
          <canvas id="gr-canvas" style="display:block;cursor:crosshair;image-rendering:pixelated"></canvas>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
          <div style="font-size:10px;color:var(--text-dim)">Grid:</div>
          <input id="gr-cols" type="number" min="10" max="120" value="${_ce.cols}" style="width:56px;font-size:11px" class="form-input" oninput="_grResize()">
          <div style="font-size:10px;color:var(--text-dim)">×</div>
          <input id="gr-rows" type="number" min="4" max="50" value="${_ce.rows}" style="width:56px;font-size:11px" class="form-input" oninput="_grResize()">
          <div style="font-size:10px;color:var(--text-dim)">Cell:</div>
          <input id="gr-cell-size" type="number" min="8" max="24" value="11" style="width:56px;font-size:11px" class="form-input" oninput="_grRedraw()">
        </div>
      </div>

      <!-- Text editor tab -->
      <div id="gr-text-tab" style="display:none">
        <textarea id="gr-content" class="form-input" rows="16" style="font-family:monospace;font-size:12px;white-space:pre;resize:vertical;width:100%" placeholder="Paste ASCII art or raw SVG here...">${escHtml4(rec?.content || '')}</textarea>
        <div id="gr-text-preview-area" style="border:1px solid var(--border);background:var(--bg3);padding:10px;margin-top:8px;display:none">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px">Preview</div>
          <pre id="gr-text-preview" style="font-size:12px;line-height:1.3;color:var(--accent);margin:0;overflow-x:auto"></pre>
        </div>
      </div>

      <!-- Vector editor tab -->
      <div id="gr-vector-tab" style="display:${isSvg ? '' : 'none'}">
        <!-- Toolbar -->
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px">
          <div style="display:flex;gap:3px">
            ${['select','rect','circle','line','text'].map(t => {
              const icons = {select:'↖',rect:'▬',circle:'●',line:'╱',text:'T'};
              return `<button class="sv-tool-btn action-btn" data-tool="${t}" onclick="_svSetTool('${t}')" title="${t}" style="font-size:12px;padding:3px 9px;min-width:32px">${icons[t]}</button>`;
            }).join('')}
          </div>
          <div style="width:1px;height:20px;background:var(--border)"></div>
          <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-dim)">
            W <input id="sv-w" type="number" min="100" max="1920" value="640" class="form-input" style="width:56px;font-size:11px" onchange="_svApplySize()">
            H <input id="sv-h" type="number" min="100" max="1080" value="360" class="form-input" style="width:56px;font-size:11px" onchange="_svApplySize()">
            BG <input id="sv-bg" type="color" value="#0a0f0d" style="width:32px;height:24px;padding:0;border:1px solid var(--border);background:transparent;cursor:pointer" onchange="_svApplySize()">
          </div>
          <div style="width:1px;height:20px;background:var(--border)"></div>
          <div style="display:flex;align-items:center;gap:3px">
            <button class="action-btn" style="font-size:13px;padding:1px 8px;line-height:1" onclick="_svSetZoom(_sv.zoom/1.25)" title="Zoom out">−</button>
            <span id="sv-zoom-label" style="font-size:10px;color:var(--text-dim);min-width:34px;text-align:center;cursor:pointer" onclick="_svZoomFit()" title="Click to fit">100%</span>
            <button class="action-btn" style="font-size:13px;padding:1px 8px;line-height:1" onclick="_svSetZoom(_sv.zoom*1.25)" title="Zoom in">+</button>
          </div>
          <label class="action-btn" style="cursor:pointer;font-size:10px;padding:2px 8px;margin-left:auto" title="Load an SVG file from disk">
            ⬆ Upload SVG
            <input type="file" accept=".svg,image/svg+xml" style="display:none" onchange="_grLoadSvgFile(this)">
          </label>
          <button class="action-btn danger" style="font-size:10px;padding:2px 8px" onclick="_svClearAll()">Clear All</button>
        </div>
        <!-- Main area: canvas + sidebar -->
        <div style="display:flex;gap:8px;height:380px">
          <!-- SVG canvas wrapper -->
          <div id="sv-wrapper" style="flex:1;overflow:auto;background:#050a08;border:1px solid var(--border);position:relative;cursor:crosshair">
            <svg id="sv-canvas" xmlns="http://www.w3.org/2000/svg" style="display:block;user-select:none"></svg>
          </div>
          <!-- Sidebar: props + shape list -->
          <div style="width:196px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;overflow:hidden">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Properties</div>
            <div id="sv-props-inner" style="flex:1;overflow-y:auto;font-size:11px">
              <div style="color:var(--text-dim);font-size:11px">Nothing selected</div>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:6px">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:5px">Shapes <span id="sv-shape-count" style="color:var(--text-dim)"></span></div>
              <div id="sv-shape-list" style="overflow-y:auto;max-height:140px"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  openModal(rec ? `Edit Graphic: ${escHtml4(rec.name)}` : 'New Graphic', body);
  document.getElementById('modal-save').onclick = saveGraphic;
  const card = document.querySelector('#generic-modal .modal-card');
  if (card) card.style.width = isSvg ? '960px' : '820px';

  setTimeout(() => {
    if (isSvg) {
      _svInit(rec?.content || '');
      _svAttachEvents();
    } else {
      _grInitCanvas(rec?.content || '');
      _grBuildPalette();
    }
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
    }
  }, 0);
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function _grTab(tab) {
  const tabs   = { canvas: 'gr-canvas-tab', text: 'gr-text-tab', vector: 'gr-vector-tab' };
  const btns   = { canvas: 'gr-tab-canvas', text: 'gr-tab-text', vector: 'gr-tab-vector' };
  const card   = document.querySelector('#generic-modal .modal-card');

  // Sync outgoing tab before switching
  const wasCanvas = document.getElementById('gr-canvas-tab')?.style.display !== 'none';
  const wasVector = document.getElementById('gr-vector-tab')?.style.display !== 'none';
  if (wasCanvas) _grSyncToTextarea();

  // Show/hide tabs
  Object.entries(tabs).forEach(([t, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  Object.entries(btns).forEach(([t, id]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const active = t === tab;
    btn.className = active ? 'action-btn primary' : 'action-btn';
    btn.style.borderBottom = active ? '1px solid var(--bg2)' : '';
  });

  if (card) card.style.width = tab === 'vector' ? '960px' : '820px';

  if (tab === 'canvas') {
    const ta = document.getElementById('gr-content');
    if (ta?.value.trim()) _grLoadFromText(ta.value);
  } else if (tab === 'text') {
    _grSyncToTextarea();
    const ta = document.getElementById('gr-content');
    const prev = document.getElementById('gr-text-preview');
    const prevArea = document.getElementById('gr-text-preview-area');
    if (ta && prev) {
      const v = ta.value.trim();
      prevArea.style.display = v ? 'block' : 'none';
      prev.textContent = v;
      if (!ta._previewBound) {
        ta.addEventListener('input', () => {
          const val = ta.value.trim();
          prevArea.style.display = val ? 'block' : 'none';
          prev.textContent = val;
        });
        ta._previewBound = true;
      }
    }
  } else if (tab === 'vector') {
    // If coming from text tab and content looks like SVG, try to reload it
    if (!wasVector) {
      const ta = document.getElementById('gr-content');
      const content = ta?.value.trim();
      if (content?.startsWith('<svg')) _svInit(content);
    }
    _svRender();
    _svAttachEvents();
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

function _grSetColor(hex) {
  _grSelColor = hex || null;
  const pick   = document.getElementById('gr-color-pick');
  const swatch = document.getElementById('gr-sel-char');
  if (pick)   { pick.style.opacity = hex ? '1' : '0.35'; if (hex) pick.value = hex; }
  if (swatch) swatch.style.color = hex || 'var(--accent)';
}

function _grToggleErase() {
  _grEraseMode = !_grEraseMode;
  const btn    = document.getElementById('gr-erase-btn');
  const canvas = document.getElementById('gr-canvas');
  if (btn) {
    btn.style.background   = _grEraseMode ? 'var(--accent2)' : '';
    btn.style.color        = _grEraseMode ? 'var(--bg)'      : '';
    btn.style.borderColor  = _grEraseMode ? 'var(--accent2)' : '';
  }
  if (canvas) canvas.style.cursor = _grEraseMode ? 'cell' : 'crosshair';
}

function _grInitCanvas(existingContent) {
  const cols = parseInt(document.getElementById('gr-cols')?.value || _ce.cols, 10);
  const rows = parseInt(document.getElementById('gr-rows')?.value || _ce.rows, 10);
  _ce.cols = cols; _ce.rows = rows;
  _ce.cursorR = 0; _ce.cursorC = 0;
  _ce.active = true;

  // Init empty grid
  _ce.cells  = Array.from({ length: rows }, () => Array(cols).fill(' '));
  _ce.colors = Array.from({ length: rows }, () => Array(cols).fill(null));

  if (existingContent) _grLoadFromText(existingContent);

  const canvas = document.getElementById('gr-canvas');
  if (!canvas) return;

  // Set up canvas interactions
  let _grMousePainting = false;
  canvas.onclick = null;
  canvas.onmousedown = (e) => {
    _grMousePainting = true;
    const { r, c } = _grCellFromEvent(e);
    _ce.cursorR = r; _ce.cursorC = c;
    _grPaintCell(r, c, _grEraseMode ? ' ' : _grSelChar);
    _grRedraw();
    canvas.focus();
  };
  canvas.onmousemove = (e) => {
    if (!_grMousePainting) return;
    const { r, c } = _grCellFromEvent(e);
    if (r === _ce.cursorR && c === _ce.cursorC) return;
    _ce.cursorR = r; _ce.cursorC = c;
    _grPaintCell(r, c, _grEraseMode ? ' ' : _grSelChar);
    _grRedraw();
  };
  canvas.onmouseup = canvas.onmouseleave = () => { _grMousePainting = false; };
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
        ctx.fillStyle = _ce.colors[r]?.[c] || '#b8d4c8';
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
  if (!_ce.cells[r])  _ce.cells[r]  = Array(_ce.cols).fill(' ');
  if (!_ce.colors[r]) _ce.colors[r] = Array(_ce.cols).fill(null);
  _ce.cells[r][c]  = ch;
  _ce.colors[r][c] = ch === ' ' ? null : _grSelColor;
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
  const newCells  = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (_ce.cells[r]?.[c]) ?? ' ')
  );
  const newColors = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (_ce.colors[r]?.[c]) ?? null)
  );
  _ce.cols = cols; _ce.rows = rows; _ce.cells = newCells; _ce.colors = newColors;
  _ce.cursorR = Math.min(_ce.cursorR, rows - 1);
  _ce.cursorC = Math.min(_ce.cursorC, cols - 1);
  _grRedraw();
}

function _grClear() {
  if (!confirm('Clear the canvas?')) return;
  _ce.cells  = Array.from({ length: _ce.rows }, () => Array(_ce.cols).fill(' '));
  _ce.colors = Array.from({ length: _ce.rows }, () => Array(_ce.cols).fill(null));
  _grRedraw();
}

// Parse a single line of BBCode into [{ch, color}] pairs (only [color=X] tags handled).
function _grParseLine(line) {
  const result = [];
  let i = 0, currentColor = null;
  const stack = [];
  while (i < line.length) {
    if (line[i] === '[') {
      const close = line.indexOf(']', i);
      if (close !== -1) {
        const tag = line.slice(i + 1, close);
        const m   = tag.match(/^color=(.+)$/i);
        if (m)              { stack.push(currentColor); currentColor = m[1]; i = close + 1; continue; }
        if (tag === '/color') { currentColor = stack.pop() ?? null;          i = close + 1; continue; }
        // Unknown tag — skip past it
        i = close + 1; continue;
      }
    }
    result.push({ ch: line[i], color: currentColor });
    i++;
  }
  return result;
}

function _grLoadFromText(text) {
  const lines   = text.split('\n');
  const parsed  = lines.map(ln => _grParseLine(ln));
  const maxCol  = Math.max(_ce.cols, ...parsed.map(p => p.length));
  if (maxCol > _ce.cols) {
    _ce.cols = Math.min(120, maxCol);
    const el = document.getElementById('gr-cols');
    if (el) el.value = _ce.cols;
  }
  const maxRow = Math.max(_ce.rows, parsed.length);
  if (maxRow > _ce.rows) {
    _ce.rows = Math.min(50, maxRow);
    const el = document.getElementById('gr-rows');
    if (el) el.value = _ce.rows;
  }
  _ce.cells  = Array.from({ length: _ce.rows }, (_, r) =>
    Array.from({ length: _ce.cols }, (_, c) => parsed[r]?.[c]?.ch  ?? ' ')
  );
  _ce.colors = Array.from({ length: _ce.rows }, (_, r) =>
    Array.from({ length: _ce.cols }, (_, c) => parsed[r]?.[c]?.color ?? null)
  );
  _grRedraw();
}

function _grImportFromText() {
  _grSyncToTextarea();
  const ta = document.getElementById('gr-content');
  if (ta?.value.trim()) _grLoadFromText(ta.value);
}

function _grLoadSvgFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const svg = e.target.result?.trim();
    if (!svg?.startsWith('<')) { toast('File does not look like an SVG.', true); return; }
    // Always put the raw SVG into the text tab textarea so it's preserved
    const ta = document.getElementById('gr-content');
    if (ta) ta.value = svg;
    // Try to parse into the vector editor
    _svInit(svg);
    // Check if the SVG has elements the editor can't represent (paths, groups, etc.)
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    const children = svgEl ? [...svgEl.children].filter(el => el.tagName !== 'rect' || el.getAttribute('x')) : [];
    const hasComplex = children.some(el => !['rect','circle','line','text'].includes(el.tagName));
    if (hasComplex) {
      // Store raw SVG so _svToString can emit it verbatim
      _sv.rawSvg = svg;
      // Show it as a static preview in the canvas wrapper
      const wrapper = document.getElementById('sv-wrapper');
      if (wrapper) {
        wrapper.innerHTML = `<div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#050a08">
          <div style="max-width:100%;max-height:100%;overflow:hidden">${svg}</div>
          <div style="position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:10px;color:var(--text-dim)">Complex SVG — displayed read-only. Editable shapes not available.</div>
        </div>`;
      }
      toast('Complex SVG loaded — will save and broadcast as-is.');
    } else {
      toast('SVG loaded.');
    }
  };
  reader.readAsText(file);
  input.value = ''; // reset so re-uploading same file triggers onchange
}

function _grSyncToTextarea() {
  const lines = _ce.cells.map((row, r) => {
    const colors = _ce.colors[r] || [];
    // Find last non-space column
    let last = row.length - 1;
    while (last >= 0 && (row[last] || ' ') === ' ') last--;
    if (last < 0) return '';
    // Build color segments up to last non-space
    let out = '', cur = null, seg = '';
    for (let c = 0; c <= last; c++) {
      const ch  = row[c] || ' ';
      const col = ch === ' ' ? null : (colors[c] || null);
      if (col === cur) {
        seg += ch;
      } else {
        if (seg) out += cur ? `[color=${cur}]${seg}[/color]` : seg;
        cur = col; seg = ch;
      }
    }
    if (seg) out += cur ? `[color=${cur}]${seg}[/color]` : seg;
    return out;
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const ta = document.getElementById('gr-content');
  if (ta) ta.value = lines.join('\n');
}

// ── Save / delete ─────────────────────────────────────────────────────────────

async function saveGraphic() {
  const name = document.getElementById('gr-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  const vectorVisible = document.getElementById('gr-vector-tab')?.style.display !== 'none';
  const canvasVisible = document.getElementById('gr-canvas-tab')?.style.display !== 'none';

  let content, type;
  if (vectorVisible) {
    content = _svToString();
    type = 'svg';
  } else {
    if (canvasVisible) _grSyncToTextarea();
    content = document.getElementById('gr-content')?.value || '';
    // Infer type from content
    type = content.trim().startsWith('<svg') ? 'svg' : 'ascii';
  }

  if (!content.trim()) { toast('Content is required.', true); return; }

  const rawTags = document.getElementById('gr-tags')?.value || '';
  const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean);

  const payload = {
    name,
    description: '',
    type,
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
    await bcSuiteRefresh('graphics');
  } catch (e) {
    toast(`Save failed: ${e.message}`, true);
  }
}

async function deleteGraphic(id, name) {
  if (!confirm(`Delete graphic "${name}"?`)) return;
  try {
    await directAPI(`/broadcast/graphics/${id}`, 'DELETE');
    toast('Graphic deleted.');
    await bcSuiteRefresh('graphics');
  } catch (e) {
    toast(`Delete failed: ${e.message}`, true);
  }
}

function escHtml4(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TV Preview ────────────────────────────────────────────────────────────────

function _grBBtoHTML(text) {
  // Minimal BBCode [color=X]...[/color] → <span style="color:X">...</span>
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc(text)
    .replace(/\[color=([^\]]+)\]/g, '<span style="color:$1">')
    .replace(/\[\/color\]/g, '</span>');
}

function _grTvPreview() {
  const vectorVisible = document.getElementById('gr-vector-tab')?.style.display !== 'none';
  const canvasVisible = document.getElementById('gr-canvas-tab')?.style.display !== 'none';

  let content, type;
  if (vectorVisible) {
    content = _svToString();
    type = 'svg';
  } else {
    if (canvasVisible) _grSyncToTextarea();
    content = document.getElementById('gr-content')?.value?.trim() || '';
    type = content.startsWith('<svg') ? 'svg' : 'ascii';
  }

  if (!content) { toast('No content to preview.', true); return; }

  document.getElementById('gr-tv-preview-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'gr-tv-preview-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer';

  const tvWin = document.createElement('div');
  tvWin.style.cssText = [
    '--tv-bg:#080c10;--tv-border:rgba(0,220,180,0.45);--tv-text:#b8d4c8;--tv-header-color:#00dbb4;',
    'width:min(760px,96vw);aspect-ratio:760/520;',
    'background:var(--tv-bg);',
    'border:3px solid #1a1a1a;outline:1px solid var(--tv-border);',
    'box-shadow:0 0 0 6px #111,0 0 0 7px rgba(0,220,180,0.08),0 0 60px rgba(0,180,140,0.22),0 8px 40px rgba(0,0,0,0.8);',
    'font-family:monospace;color:var(--tv-text);border-radius:4px;',
    'display:flex;flex-direction:column;cursor:default;position:relative;',
    'background-image:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.09) 3px,rgba(0,0,0,0.09) 4px),radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.55) 100%);',
  ].join('');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--tv-border);flex-shrink:0;background:rgba(0,40,30,0.5);position:relative;z-index:2';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:#0c100e;border:2px solid #1e2e28;color:#2e4840;font-size:15px;cursor:pointer;padding:0;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-family:inherit';
  closeBtn.onclick = () => overlay.remove();
  header.innerHTML = '<span style="font-size:12px;font-weight:bold;letter-spacing:2px;color:var(--tv-header-color);text-transform:uppercase">TV PREVIEW</span><span style="font-size:11px;color:rgba(184,212,200,0.4);font-style:italic">how this graphic appears on screen</span>';
  header.appendChild(closeBtn);

  const contentEl = document.createElement('div');
  contentEl.style.cssText = 'flex:1;overflow:hidden;padding:14px 18px;position:relative;';

  tvWin.appendChild(header);
  tvWin.appendChild(contentEl);
  overlay.appendChild(tvWin);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const escClose = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escClose); } };
  document.addEventListener('keydown', escClose);

  document.body.appendChild(overlay);

  if (type === 'svg') {
    const tmp = document.createElement('div');
    tmp.innerHTML = content;
    const svg = tmp.querySelector('svg');
    if (svg) {
      if (!svg.getAttribute('viewBox')) {
        const w = parseFloat(svg.getAttribute('width')) || 640;
        const h = parseFloat(svg.getAttribute('height')) || 360;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.cssText = 'width:100%;max-width:100%;height:auto;display:block;margin:0 auto';
    }
    contentEl.innerHTML = tmp.innerHTML;
  } else {
    const el = document.createElement('pre');
    el.style.cssText = 'margin:0;line-height:1.3;color:var(--tv-text);';
    el.innerHTML = _grBBtoHTML(content);
    contentEl.appendChild(el);
    // Exact same scaling logic as tv.js appendTvMessage
    requestAnimationFrame(() => {
      const plain = content.replace(/\[[^\]]*\]/g, '');
      const lines = plain.split('\n');
      const maxLen = Math.max(...lines.map(l => l.length), 1);
      const availPx = contentEl.clientWidth - 36;
      const targetPx = Math.min(availPx / (maxLen * 0.6), 18);
      el.style.fontSize = Math.max(targetPx, 7).toFixed(1) + 'px';
    });
  }
}

// ── Vector editor ─────────────────────────────────────────────────────────────

let _sv = {
  shapes: [], selectedId: null, tool: 'select',
  w: 640, h: 360, bgColor: '#0a0f0d',
  zoom: 1,
  mouseDown: false, creating: false,
  createX0: 0, createY0: 0,
  dragging: false, dragX0: 0, dragY0: 0, dragAttrs: null,
  resizing: false, resizeHandle: null,
  rawSvg: null, // set when an uploaded SVG can't be fully parsed into editable shapes
};
let _svNextId = 1;

const _SV_DEFAULTS = {
  rect:   { fill: '#00dbb4', stroke: 'none', strokeWidth: 0, rx: 0,        opacity: 1 },
  circle: { fill: '#00dbb4', stroke: 'none', strokeWidth: 0,               opacity: 1 },
  line:   { fill: 'none',    stroke: '#c0e0c0', strokeWidth: 2,            opacity: 1 },
  text:   { fill: '#e0f4e0', stroke: 'none', strokeWidth: 0, fontSize: 28,
            fontWeight: 'bold', fontFamily: 'monospace',                    opacity: 1 },
};

function _svId() { return `s${_svNextId++}`; }

// ── Init ──────────────────────────────────────────────────────────────────────

function _svInit(content) {
  _sv.shapes = []; _svNextId = 1; _sv.selectedId = null; _sv.tool = 'select';
  _sv.zoom = 1;
  _sv.mouseDown = false; _sv.creating = false; _sv.dragging = false; _sv.resizing = false;
  _sv.rawSvg = null;
  if (content?.trim().startsWith('<svg')) {
    try { _svParse(content); } catch(e) {}
  }
  const wEl = document.getElementById('sv-w'), hEl = document.getElementById('sv-h'), bgEl = document.getElementById('sv-bg');
  if (wEl) wEl.value = _sv.w;
  if (hEl) hEl.value = _sv.h;
  if (bgEl) bgEl.value = _sv.bgColor;
  _svSetTool('select');
  _svRender();
  _svRefreshProps();
  _svRefreshList();
}

function _svClearAll() {
  if (!confirm('Clear all shapes?')) return;
  _sv.shapes = []; _sv.selectedId = null;
  _svRender(); _svRefreshProps(); _svRefreshList();
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function _svSetTool(t) {
  _sv.tool = t;
  const wrapper = document.getElementById('sv-wrapper');
  if (wrapper) wrapper.style.cursor = t === 'select' ? 'default' : 'crosshair';
  document.querySelectorAll('.sv-tool-btn').forEach(b => {
    const active = b.dataset.tool === t;
    b.style.background = active ? 'var(--accent)' : '';
    b.style.color      = active ? 'var(--bg)'    : '';
    b.style.borderColor= active ? 'var(--accent)' : '';
  });
}

function _svApplySize() {
  _sv.w       = Math.max(100, parseInt(document.getElementById('sv-w')?.value  || 640, 10));
  _sv.h       = Math.max(100, parseInt(document.getElementById('sv-h')?.value  || 360, 10));
  _sv.bgColor = document.getElementById('sv-bg')?.value || '#0a0f0d';
  _svRender();
}

// ── Coordinate helper ─────────────────────────────────────────────────────────

function _svPt(e) {
  const svg = document.getElementById('sv-canvas');
  if (!svg) return { x: 0, y: 0 };
  const r = svg.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - r.left) * (_sv.w / r.width)),
    y: Math.round((e.clientY - r.top)  * (_sv.h / r.height)),
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

function _svRender() {
  const svg = document.getElementById('sv-canvas');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${_sv.w} ${_sv.h}`);
  svg.setAttribute('width',  Math.round(_sv.w * _sv.zoom));
  svg.setAttribute('height', Math.round(_sv.h * _sv.zoom));

  let html = `<rect width="${_sv.w}" height="${_sv.h}" fill="${escHtml4(_sv.bgColor)}"/>`;

  for (const s of _sv.shapes) {
    const sel   = s.id === _sv.selectedId;
    const base  = `data-sid="${s.id}" class="sv-shape${sel ? ' sv-sel' : ''}"`;
    const op    = (s.opacity != null && s.opacity !== 1) ? ` opacity="${s.opacity}"` : '';
    const st    = s.stroke && s.stroke !== 'none'
                    ? ` stroke="${escHtml4(s.stroke)}" stroke-width="${s.strokeWidth || 1}"`
                    : ' stroke="none"';
    switch (s.type) {
      case 'rect':
        html += `<rect ${base} x="${s.x}" y="${s.y}" width="${Math.max(1,Math.abs(s.w))}" height="${Math.max(1,Math.abs(s.h))}" fill="${escHtml4(s.fill)}"${st}${s.rx ? ` rx="${s.rx}"` : ''}${op}/>`;
        break;
      case 'circle':
        html += `<circle ${base} cx="${s.cx}" cy="${s.cy}" r="${Math.max(1, s.r)}" fill="${escHtml4(s.fill)}"${st}${op}/>`;
        break;
      case 'line':
        html += `<line ${base} x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"${st}${op} fill="none"/>`;
        break;
      case 'text':
        html += `<text ${base} x="${s.x}" y="${s.y}" fill="${escHtml4(s.fill)}"${st}${op} font-size="${s.fontSize || 20}" font-weight="${s.fontWeight || 'normal'}" font-family="${escHtml4(s.fontFamily || 'monospace')}">${escHtml4(s.text || '')}</text>`;
        break;
    }
  }

  // Selection handles
  if (_sv.selectedId) {
    const s = _sv.shapes.find(sh => sh.id === _sv.selectedId);
    if (s) html += _svHandlesHtml(s);
  }

  svg.innerHTML = html;

  // Re-attach shape / handle events
  svg.querySelectorAll('.sv-shape').forEach(el => el.addEventListener('mousedown', _svOnShapeDown));
  svg.querySelectorAll('.sv-handle').forEach(el => el.addEventListener('mousedown', _svOnHandleDown));
}

function _svHandlesHtml(s) {
  const HS = 7;
  const handle = (h, cx, cy, cursor) =>
    `<rect class="sv-handle" data-handle="${h}" x="${cx - HS/2}" y="${cy - HS/2}" width="${HS}" height="${HS}" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5" style="cursor:${cursor}"/>`;

  if (s.type === 'line') {
    const dot = (h, cx, cy) =>
      `<circle class="sv-handle" data-handle="${h}" cx="${cx}" cy="${cy}" r="${HS/2 + 1}" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5" style="cursor:move"/>`;
    return dot('p1', s.x1, s.y1) + dot('p2', s.x2, s.y2);
  }
  if (s.type === 'text') {
    return `<circle class="sv-handle" data-handle="move" cx="${s.x}" cy="${s.y}" r="${HS/2 + 1}" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5" style="cursor:move"/>`;
  }

  let bx, by, bw, bh;
  if (s.type === 'rect')   { bx = s.x;       by = s.y;       bw = Math.abs(s.w); bh = Math.abs(s.h); }
  if (s.type === 'circle') { bx = s.cx - s.r; by = s.cy - s.r; bw = s.r * 2;     bh = s.r * 2; }
  if (bx == null) return '';

  return [
    handle('nw', bx,       by,        'nw-resize'),
    handle('n',  bx+bw/2,  by,        'n-resize'),
    handle('ne', bx+bw,    by,        'ne-resize'),
    handle('e',  bx+bw,    by+bh/2,   'e-resize'),
    handle('se', bx+bw,    by+bh,     'se-resize'),
    handle('s',  bx+bw/2,  by+bh,     's-resize'),
    handle('sw', bx,       by+bh,     'sw-resize'),
    handle('w',  bx,       by+bh/2,   'w-resize'),
  ].join('');
}

// ── Event attachment ──────────────────────────────────────────────────────────

function _svAttachEvents() {
  const wrapper = document.getElementById('sv-wrapper');
  const svg     = document.getElementById('sv-canvas');
  if (!wrapper || !svg) return;

  svg.onmousedown = _svOnCanvasDown;
  wrapper.onmousemove = _svOnMove;
  wrapper.onmouseup   = _svOnUp;
  wrapper.onmouseleave = _svOnUp;

  // Mousewheel zoom toward cursor
  if (wrapper._svWheelListener) wrapper.removeEventListener('wheel', wrapper._svWheelListener);
  wrapper._svWheelListener = (e) => {
    e.preventDefault();
    const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const oldZoom = _sv.zoom;
    const newZoom = Math.max(0.1, Math.min(8, oldZoom * factor));
    const rect    = wrapper.getBoundingClientRect();
    const mx      = e.clientX - rect.left;
    const my      = e.clientY - rect.top;
    _sv.zoom = newZoom;
    _svRender();
    wrapper.scrollLeft = (wrapper.scrollLeft + mx) * (newZoom / oldZoom) - mx;
    wrapper.scrollTop  = (wrapper.scrollTop  + my) * (newZoom / oldZoom) - my;
    const zEl = document.getElementById('sv-zoom-label');
    if (zEl) zEl.textContent = `${Math.round(newZoom * 100)}%`;
  };
  wrapper.addEventListener('wheel', wrapper._svWheelListener, { passive: false });
}

function _svSetZoom(z) {
  const wrapper = document.getElementById('sv-wrapper');
  if (!wrapper) return;
  const oldZoom = _sv.zoom;
  _sv.zoom = Math.max(0.1, Math.min(8, z));
  const cx = wrapper.scrollLeft + wrapper.clientWidth  / 2;
  const cy = wrapper.scrollTop  + wrapper.clientHeight / 2;
  _svRender();
  const scale = _sv.zoom / oldZoom;
  wrapper.scrollLeft = cx * scale - wrapper.clientWidth  / 2;
  wrapper.scrollTop  = cy * scale - wrapper.clientHeight / 2;
  const zEl = document.getElementById('sv-zoom-label');
  if (zEl) zEl.textContent = `${Math.round(_sv.zoom * 100)}%`;
}

function _svZoomFit() {
  const wrapper = document.getElementById('sv-wrapper');
  if (!wrapper) return;
  const scaleX = (wrapper.clientWidth  - 16) / _sv.w;
  const scaleY = (wrapper.clientHeight - 16) / _sv.h;
  _sv.zoom = Math.min(scaleX, scaleY, 1);
  _svRender();
  wrapper.scrollTo(0, 0);
  const zEl = document.getElementById('sv-zoom-label');
  if (zEl) zEl.textContent = `${Math.round(_sv.zoom * 100)}%`;
}

// ── Mouse down handlers ───────────────────────────────────────────────────────

function _svOnCanvasDown(e) {
  if (e.target.classList.contains('sv-handle')) return;
  if (e.target.classList.contains('sv-shape') && _sv.tool === 'select') return;

  e.preventDefault();
  const pt = _svPt(e);

  if (_sv.tool === 'text') {
    const text = prompt('Enter text:');
    if (!text) return;
    const s = { id: _svId(), type: 'text', x: pt.x, y: pt.y, text, ..._SV_DEFAULTS.text };
    _sv.shapes.push(s); _sv.selectedId = s.id;
    _svRender(); _svRefreshProps(); _svRefreshList();
    return;
  }

  if (_sv.tool === 'select') {
    _sv.selectedId = null; _svRender(); _svRefreshProps(); _svRefreshList();
    return;
  }

  // Start creating a shape
  _sv.creating = true; _sv.mouseDown = true;
  _sv.createX0 = pt.x; _sv.createY0 = pt.y;

  let s;
  const def = _SV_DEFAULTS[_sv.tool] || {};
  if (_sv.tool === 'rect')   s = { id: _svId(), type: 'rect',   x: pt.x, y: pt.y, w: 1, h: 1, ...def };
  if (_sv.tool === 'circle') s = { id: _svId(), type: 'circle', cx: pt.x, cy: pt.y, r: 1, ...def };
  if (_sv.tool === 'line')   s = { id: _svId(), type: 'line',   x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, ...def };
  if (s) { _sv.shapes.push(s); _sv.selectedId = s.id; _svRender(); }
}

function _svOnShapeDown(e) {
  if (_sv.tool !== 'select') { _svOnCanvasDown(e); return; }
  e.stopPropagation(); e.preventDefault();
  const id = e.currentTarget.dataset.sid;
  _sv.selectedId = id; _svRender(); _svRefreshProps(); _svRefreshList();
  const pt = _svPt(e);
  const s  = _sv.shapes.find(sh => sh.id === id);
  if (!s) return;
  _sv.dragging = true; _sv.mouseDown = true;
  _sv.dragX0 = pt.x; _sv.dragY0 = pt.y; _sv.dragAttrs = { ...s };
}

function _svOnHandleDown(e) {
  e.stopPropagation(); e.preventDefault();
  const s = _sv.shapes.find(sh => sh.id === _sv.selectedId);
  if (!s) return;
  const pt = _svPt(e);
  _sv.resizing = true; _sv.mouseDown = true;
  _sv.resizeHandle = e.currentTarget.dataset.handle;
  _sv.dragX0 = pt.x; _sv.dragY0 = pt.y; _sv.dragAttrs = { ...s };
}

// ── Mouse move / up ───────────────────────────────────────────────────────────

function _svOnMove(e) {
  if (!_sv.mouseDown) return;
  const pt = _svPt(e);
  const dx = pt.x - _sv.dragX0, dy = pt.y - _sv.dragY0;
  const s  = _sv.shapes.find(sh => sh.id === _sv.selectedId);
  if (!s) return;

  if (_sv.creating) {
    const x0 = _sv.createX0, y0 = _sv.createY0;
    if (s.type === 'rect')   { s.x = Math.min(x0, pt.x); s.y = Math.min(y0, pt.y); s.w = Math.abs(pt.x - x0); s.h = Math.abs(pt.y - y0); }
    if (s.type === 'circle') { s.r = Math.round(Math.hypot(pt.x - x0, pt.y - y0)); }
    if (s.type === 'line')   { s.x2 = pt.x; s.y2 = pt.y; }
    _svRender(); return;
  }

  if (_sv.dragging) {
    const o = _sv.dragAttrs;
    if (s.type === 'rect')   { s.x = o.x + dx; s.y = o.y + dy; }
    if (s.type === 'circle') { s.cx = o.cx + dx; s.cy = o.cy + dy; }
    if (s.type === 'line')   { s.x1 = o.x1+dx; s.y1 = o.y1+dy; s.x2 = o.x2+dx; s.y2 = o.y2+dy; }
    if (s.type === 'text')   { s.x = o.x + dx; s.y = o.y + dy; }
    _svRender(); return;
  }

  if (_sv.resizing) {
    const o = _sv.dragAttrs, h = _sv.resizeHandle;
    if (s.type === 'line') {
      if (h === 'p1') { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; }
      if (h === 'p2') { s.x2 = o.x2 + dx; s.y2 = o.y2 + dy; }
    } else if (s.type === 'circle') {
      s.r = Math.max(1, Math.round(Math.hypot(pt.x - s.cx, pt.y - s.cy)));
    } else if (s.type === 'rect') {
      let l = o.x, t = o.y, r = o.x + o.w, b = o.y + o.h;
      if (h.includes('w')) l = Math.min(pt.x, r - 1);
      if (h.includes('e')) r = Math.max(pt.x, l + 1);
      if (h.includes('n')) t = Math.min(pt.y, b - 1);
      if (h.includes('s')) b = Math.max(pt.y, t + 1);
      s.x = l; s.y = t; s.w = r - l; s.h = b - t;
    }
    _svRender();
  }
}

function _svOnUp() {
  if (!_sv.mouseDown) return;
  _sv.mouseDown = false; _sv.creating = false; _sv.dragging = false; _sv.resizing = false;
  _sv.dragAttrs = null; _sv.resizeHandle = null;
  _svRefreshProps(); _svRefreshList();
}

// ── Properties panel ──────────────────────────────────────────────────────────

function _svRefreshProps() {
  const el = document.getElementById('sv-props-inner');
  if (!el) return;
  const s = _sv.shapes.find(sh => sh.id === _sv.selectedId);
  if (!s) { el.innerHTML = '<div style="color:var(--text-dim);font-size:11px">Nothing selected</div>'; return; }

  const lbl = (text) => `<div style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">${text}</div>`;
  const row = (label, inner) => `<div style="margin-bottom:7px">${lbl(label)}${inner}</div>`;
  const num  = (key, val, min, max, step) =>
    `<input type="number" class="form-input" value="${val ?? 0}" min="${min ?? 0}" max="${max ?? 9999}" step="${step ?? 1}" style="width:100%;font-size:11px" oninput="_svProp('${key}',parseFloat(this.value)||0)">`;
  const colorInput = (key, val) => `<div style="display:flex;gap:5px;align-items:center">
    <input type="color" value="${val && val !== 'none' ? val : '#000000'}" oninput="_svProp('${key}',this.value)" style="width:30px;height:24px;padding:0;border:1px solid var(--border);background:transparent;cursor:pointer;flex-shrink:0">
    <input class="form-input" value="${escHtml4(val || 'none')}" style="flex:1;font-size:11px" oninput="_svProp('${key}',this.value)" placeholder="none">
    </div>`;

  let html = '';

  if (s.type === 'text') {
    html += row('Text', `<textarea class="form-input" rows="2" style="font-size:11px;width:100%;resize:vertical;box-sizing:border-box" oninput="_svProp('text',this.value)">${escHtml4(s.text || '')}</textarea>`);
    html += row('Font Size', num('fontSize', s.fontSize, 4, 300));
    html += row('Weight', `<select class="form-input" style="font-size:11px;width:100%" onchange="_svProp('fontWeight',this.value)">
      <option ${s.fontWeight==='normal'?'selected':''} value="normal">normal</option>
      <option ${s.fontWeight==='bold'?'selected':''} value="bold">bold</option>
    </select>`);
    html += row('Font', `<select class="form-input" style="font-size:11px;width:100%" onchange="_svProp('fontFamily',this.value)">
      ${['monospace','sans-serif','serif'].map(f => `<option value="${f}"${s.fontFamily===f?' selected':''}>${f}</option>`).join('')}
    </select>`);
  }
  if (s.type === 'rect') {
    html += row('Corner Radius', num('rx', s.rx, 0, 300));
  }

  html += row('Fill', colorInput('fill', s.fill));
  html += row('Stroke', colorInput('stroke', s.stroke));
  if (s.stroke && s.stroke !== 'none') {
    html += row('Stroke Width', num('strokeWidth', s.strokeWidth, 0, 100));
  }
  html += row('Opacity', num('opacity', s.opacity, 0, 1, 0.05));

  el.innerHTML = html;
}

function _svProp(key, val) {
  const s = _sv.shapes.find(sh => sh.id === _sv.selectedId);
  if (!s) return;
  s[key] = val;
  _svRender();
  if (key === 'stroke') _svRefreshProps(); // show/hide stroke-width row
}

// ── Shape list ────────────────────────────────────────────────────────────────

function _svRefreshList() {
  const el = document.getElementById('sv-shape-list');
  const cnt = document.getElementById('sv-shape-count');
  if (!el) return;
  if (cnt) cnt.textContent = _sv.shapes.length ? `(${_sv.shapes.length})` : '';
  if (!_sv.shapes.length) { el.innerHTML = '<div style="color:var(--text-dim);font-size:11px">No shapes yet</div>'; return; }

  el.innerHTML = [..._sv.shapes].reverse().map((s, ri) => {
    const i   = _sv.shapes.length - 1 - ri;
    const sel = s.id === _sv.selectedId;
    const lbl = s.type === 'text' ? `"${(s.text || '').slice(0, 16)}"` : `${s.type} ${i + 1}`;
    return `<div onclick="_svSelectShape('${s.id}')" style="display:flex;align-items:center;gap:3px;padding:3px 5px;cursor:pointer;border-radius:2px;margin-bottom:2px;background:${sel ? 'var(--bg3)' : 'transparent'};border:1px solid ${sel ? 'var(--accent)' : 'transparent'}">
      <span style="flex:1;font-size:10px;color:${sel ? 'var(--accent)' : 'var(--text)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml4(lbl)}</span>
      <button onclick="event.stopPropagation();_svMove('${s.id}',-1)" class="action-btn" style="font-size:8px;padding:1px 3px" title="Forward">↑</button>
      <button onclick="event.stopPropagation();_svMove('${s.id}',1)"  class="action-btn" style="font-size:8px;padding:1px 3px" title="Back">↓</button>
      <button onclick="event.stopPropagation();_svDel('${s.id}')"    class="action-btn danger" style="font-size:8px;padding:1px 3px">✕</button>
    </div>`;
  }).join('');
}

function _svSelectShape(id) {
  _sv.selectedId = id; _svRender(); _svRefreshProps(); _svRefreshList();
}

function _svDel(id) {
  _sv.shapes = _sv.shapes.filter(s => s.id !== id);
  if (_sv.selectedId === id) _sv.selectedId = null;
  _svRender(); _svRefreshProps(); _svRefreshList();
}

function _svMove(id, dir) {
  // dir: -1 = toward front (higher index), +1 = toward back (lower index)
  const i = _sv.shapes.findIndex(s => s.id === id);
  const j = i - dir;
  if (i < 0 || j < 0 || j >= _sv.shapes.length) return;
  [_sv.shapes[i], _sv.shapes[j]] = [_sv.shapes[j], _sv.shapes[i]];
  _svRender(); _svRefreshList();
}

// ── Serialise / deserialise ───────────────────────────────────────────────────

function _svToString() {
  // If a complex uploaded SVG is stored, emit it verbatim
  if (_sv.rawSvg) return _sv.rawSvg;
  const e = escHtml4;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${_sv.w} ${_sv.h}" width="${_sv.w}" height="${_sv.h}">`,
    `  <rect width="${_sv.w}" height="${_sv.h}" fill="${_sv.bgColor}"/>`,
  ];
  for (const s of _sv.shapes) {
    const op = s.opacity != null && s.opacity !== 1 ? ` opacity="${s.opacity}"` : '';
    const st = s.stroke && s.stroke !== 'none'
      ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth || 1}"`
      : '';
    switch (s.type) {
      case 'rect':
        lines.push(`  <rect x="${s.x}" y="${s.y}" width="${Math.max(1,Math.abs(s.w))}" height="${Math.max(1,Math.abs(s.h))}" fill="${s.fill}"${st}${s.rx ? ` rx="${s.rx}"` : ''}${op}/>`);
        break;
      case 'circle':
        lines.push(`  <circle cx="${s.cx}" cy="${s.cy}" r="${Math.max(1, s.r)}" fill="${s.fill}"${st}${op}/>`);
        break;
      case 'line':
        lines.push(`  <line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke || '#ffffff'}" stroke-width="${s.strokeWidth || 1}"${op}/>`);
        break;
      case 'text':
        lines.push(`  <text x="${s.x}" y="${s.y}" fill="${s.fill}"${st}${op} font-size="${s.fontSize || 20}" font-weight="${s.fontWeight || 'normal'}" font-family="${s.fontFamily || 'monospace'}">${e(s.text || '')}</text>`);
        break;
    }
  }
  lines.push('</svg>');
  return lines.join('\n');
}

function _svParse(svgStr) {
  const doc   = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return;

  const vb = svgEl.getAttribute('viewBox')?.split(/\s+/);
  if (vb?.length === 4) { _sv.w = parseInt(vb[2]) || 640; _sv.h = parseInt(vb[3]) || 360; }

  const children = [...svgEl.children];
  // First child with no x/y is the background rect
  const first = children[0];
  if (first?.tagName === 'rect' && !first.getAttribute('x') && !first.getAttribute('y')) {
    _sv.bgColor = first.getAttribute('fill') || '#0a0f0d';
    children.shift();
  }

  for (const el of children) {
    const n = (a) => parseFloat(el.getAttribute(a)) || 0;
    const a = (k) => el.getAttribute(k) || '';
    const op = parseFloat(a('opacity') || '1');
    let s;
    switch (el.tagName) {
      case 'rect':
        s = { type:'rect', x:n('x'), y:n('y'), w:n('width'), h:n('height'),
          fill:a('fill')||'#00dbb4', stroke:a('stroke')||'none', strokeWidth:n('stroke-width'), rx:n('rx'), opacity:op };
        break;
      case 'circle':
        s = { type:'circle', cx:n('cx'), cy:n('cy'), r:n('r'),
          fill:a('fill')||'#00dbb4', stroke:a('stroke')||'none', strokeWidth:n('stroke-width'), opacity:op };
        break;
      case 'line':
        s = { type:'line', x1:n('x1'), y1:n('y1'), x2:n('x2'), y2:n('y2'),
          fill:'none', stroke:a('stroke')||'#c0e0c0', strokeWidth:n('stroke-width')||2, opacity:op };
        break;
      case 'text':
        s = { type:'text', x:n('x'), y:n('y'), text:el.textContent||'',
          fill:a('fill')||'#e0f4e0', stroke:a('stroke')||'none', strokeWidth:n('stroke-width'),
          fontSize:n('font-size')||20, fontWeight:a('font-weight')||'normal',
          fontFamily:a('font-family')||'monospace', opacity:op };
        break;
      default: continue;
    }
    _sv.shapes.push({ id: _svId(), ...s });
  }
}
