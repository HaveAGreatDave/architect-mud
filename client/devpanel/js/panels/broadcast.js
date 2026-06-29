// Broadcast asset panel — list + modal editor with message sequence builder.
// All functions land in global scope (no modules).

const BROADCAST_CATEGORIES = ['general','news','advertisement','entertainment','emergency','weather','sport','music','documentary','surveillance'];
const BROADCAST_MODES = ['scripted','dynamic_news','live_camera','recorded'];

// ── State ────────────────────────────────────────────────────────────────────

let _broadcastList = [];
let _broadcastEditTarget = null;
let _broadcastMessages = [];
let _broadcastGraph = null; // VINE graph data for scripted/news modes

// ── Panel render ─────────────────────────────────────────────────────────────

function renderBroadcastsPanel(data) {
  _broadcastList = Array.isArray(data?.broadcasts) ? data.broadcasts : (Array.isArray(data) ? data : []);
  const panel = document.getElementById('list-panel');

  const modeColor = { scripted: 'var(--cyan)', dynamic_news: 'var(--yellow)', live_camera: 'var(--green)', recorded: 'var(--text-dim)' };

  const rows = _broadcastList.map(b => {
    const msgCount = Array.isArray(b.messages) ? b.messages.length : 0;
    const dur = b.override_duration
      ? `${b.override_duration}s`
      : `${(msgCount * (b.message_interval || 5)).toFixed(0)}s (auto)`;
    const modeStyle = `color:${modeColor[b.playback_mode] || 'var(--text)'}`;
    return `<tr>
      <td style="font-weight:600;color:${b.enabled ? 'var(--text-bright)' : 'var(--text-dim)'}">
        ${escHtml(b.name)}${b.enabled ? '' : ' <span style="font-size:10px;color:var(--text-dim)">(disabled)</span>'}
      </td>
      <td><span style="font-size:10px;background:var(--bg3);padding:2px 6px;border-radius:2px;color:var(--accent)">${escHtml(b.category || 'general')}</span></td>
      <td style="${modeStyle};font-size:11px">${b.playback_mode || 'scripted'}</td>
      <td style="text-align:center;color:var(--text-dim)">${msgCount}</td>
      <td style="font-size:11px;color:var(--text-dim)">${dur}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="openBroadcastModal(${JSON.stringify(b).replace(/"/g,'&quot;')})">✏</button>
        <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="cloneBroadcast(${JSON.stringify(b).replace(/"/g,'&quot;')})">⎘</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteBroadcast('${b.id}','${escHtml(b.name).replace(/'/g,"\\'")}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">Broadcasts</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${_broadcastList.length} asset${_broadcastList.length !== 1 ? 's' : ''} — reusable media content</div>
        </div>
        <button class="action-btn" onclick="bcImportBsm()" title="Import a .bsm script file">↑ Import .bsm</button>
        <button class="action-btn" onclick="openBroadcastModal(null)">+ New Broadcast</button>
      </div>
      ${_broadcastList.length ? `
      <table>
        <thead><tr>
          <th>Name</th><th>Category</th><th>Mode</th>
          <th style="text-align:center" title="Message count">Msgs</th>
          <th>Duration</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<div style="padding:24px;color:var(--text-dim)">No broadcasts yet. Create one to get started.</div>'}
    </div>`;
}

// ── Modal editor ─────────────────────────────────────────────────────────────

function openBroadcastModal(rec, isNew) {
  _broadcastEditTarget = rec || null;
  _broadcastMessages = rec && Array.isArray(rec.messages)
    ? rec.messages.map(m => typeof m === 'string' ? m : (m.text || ''))
    : [];
  _broadcastGraph = rec?.broadcast_graph || null;

  const modeOptions = BROADCAST_MODES.map(m =>
    `<option value="${m}"${(rec?.playback_mode || 'scripted') === m ? ' selected' : ''}>${m.replace(/_/g,' ')}</option>`
  ).join('');
  const catOptions = BROADCAST_CATEGORIES.map(c =>
    `<option value="${c}"${(rec?.category || 'general') === c ? ' selected' : ''}>${c}</option>`
  ).join('');

  const body = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Name *</label>
          <input id="bc-name" class="form-input" value="${escHtml(rec?.name || '')}" placeholder="Broadcast name">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Category</label>
          <select id="bc-category" class="form-input">${catOptions}</select>
        </div>
      </div>
      <div>
        <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Description</label>
        <textarea id="bc-description" class="form-input" rows="2" placeholder="Optional description">${escHtml(rec?.description || '')}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Playback Mode</label>
          <select id="bc-mode" class="form-input">${modeOptions}</select>
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Msg Interval (s)</label>
          <input id="bc-interval" type="number" class="form-input" value="${rec?.message_interval || 5}" min="1" max="300">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Override Duration (s)</label>
          <input id="bc-override-dur" type="number" class="form-input" value="${rec?.override_duration || ''}" placeholder="auto" min="0">
        </div>
      </div>
      <div style="display:flex;gap:16px;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text)">
          <input type="checkbox" id="bc-enabled" ${rec?.enabled !== 0 ? 'checked' : ''}> Enabled
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text)">
          <input type="checkbox" id="bc-loop" ${rec?.loop ? 'checked' : ''}> Loop messages
        </label>
      </div>

      <div style="border:1px solid var(--border);border-radius:2px;overflow:hidden">
        <div style="padding:6px 10px;background:var(--bg3);display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px">Message Sequence</span>
            <span id="bc-dur-label" style="font-size:10px;color:var(--text-dim);margin-left:8px"></span>
            <span id="bc-graph-badge" style="display:none;font-size:10px;color:var(--cyan);margin-left:8px;background:var(--bg);border:1px solid var(--cyan);padding:1px 6px;border-radius:2px">VINE graph</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="broadcastOpenVine()" title="Open VINE graph editor">⬡ VINE</button>
            <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="bcAddMessage()">+ Add Message</button>
          </div>
        </div>
        <div id="bc-msg-list" style="padding:8px;display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto">
          <!-- rendered by renderBcMessages() -->
        </div>
      </div>
    </div>`;

  openModal(rec ? `Edit Broadcast: ${rec.name}` : 'New Broadcast', body);
  renderBcMessages();
  updateBcDurLabel();

  document.getElementById('bc-interval')?.addEventListener('input', updateBcDurLabel);
  document.getElementById('bc-override-dur')?.addEventListener('input', updateBcDurLabel);

  document.getElementById('modal-save').onclick = saveBroadcast;
}

function renderBcMessages() {
  const badge = document.getElementById('bc-graph-badge');
  if (badge) badge.style.display = _broadcastGraph ? 'inline' : 'none';
  const list = document.getElementById('bc-msg-list');
  if (!list) return;
  if (!_broadcastMessages.length) {
    list.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px">No messages yet. Add one above.</div>';
    return;
  }
  const interval = parseFloat(document.getElementById('bc-interval')?.value || 5);
  list.innerHTML = _broadcastMessages.map((msg, i) => {
    const timeSec = (i * interval).toFixed(0);
    return `<div style="display:flex;align-items:flex-start;gap:6px;background:var(--bg3);border-radius:2px;padding:4px 6px">
      <span style="font-size:10px;color:var(--text-dim);min-width:36px;padding-top:2px">${timeSec}s</span>
      <textarea class="form-input" style="flex:1;resize:vertical;min-height:36px;font-size:12px" rows="2"
        oninput="bcUpdateMessage(${i}, this.value)">${escHtml(msg)}</textarea>
      <div style="display:flex;flex-direction:column;gap:2px">
        <button class="action-btn" style="font-size:10px;padding:2px 5px" onclick="bcMoveMessage(${i},-1)" ${i===0?'disabled':''}>▲</button>
        <button class="action-btn" style="font-size:10px;padding:2px 5px" onclick="bcMoveMessage(${i},1)" ${i===_broadcastMessages.length-1?'disabled':''}>▼</button>
        <button class="action-btn danger" style="font-size:10px;padding:2px 5px" onclick="bcRemoveMessage(${i})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function updateBcDurLabel() {
  const label = document.getElementById('bc-dur-label');
  if (!label) return;
  const interval = parseFloat(document.getElementById('bc-interval')?.value || 5);
  const override = parseFloat(document.getElementById('bc-override-dur')?.value || '') || null;
  const auto = (_broadcastMessages.length * interval).toFixed(0);
  label.textContent = override ? `Duration: ${override}s (override)` : `Duration: ${auto}s (${_broadcastMessages.length} × ${interval}s)`;
}

function bcAddMessage() {
  _broadcastMessages.push('');
  renderBcMessages();
  updateBcDurLabel();
  // Scroll to bottom of list
  const list = document.getElementById('bc-msg-list');
  if (list) list.scrollTop = list.scrollHeight;
}

function bcUpdateMessage(i, val) {
  _broadcastMessages[i] = val;
  updateBcDurLabel();
}

function bcRemoveMessage(i) {
  _broadcastMessages.splice(i, 1);
  renderBcMessages();
  updateBcDurLabel();
}

function bcMoveMessage(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _broadcastMessages.length) return;
  [_broadcastMessages[i], _broadcastMessages[j]] = [_broadcastMessages[j], _broadcastMessages[i]];
  renderBcMessages();
}

function broadcastOpenVine() {
  if (typeof VineBroadcastSchema === 'undefined') {
    toast('VINE broadcast schema not loaded.', true); return;
  }
  const graphData = _broadcastGraph
    ? VineBroadcastSchema.fromBroadcastGraph(_broadcastGraph)
    : { nodes:{}, edges:[], _start:'' };
  const name = document.getElementById('bc-name')?.value?.trim() || 'Broadcast';
  vineModalOpen(`VINE — ${name}`, VineBroadcastSchema, graphData, (vineGraph) => {
    _broadcastGraph = VineBroadcastSchema.toBroadcastGraph(vineGraph);
    renderBcMessages();
    toast('Graph saved.');
  });
}

async function saveBroadcast() {
  const name = document.getElementById('bc-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  const body = {
    name,
    description: document.getElementById('bc-description')?.value || '',
    category: document.getElementById('bc-category')?.value || 'general',
    playback_mode: document.getElementById('bc-mode')?.value || 'scripted',
    message_interval: parseFloat(document.getElementById('bc-interval')?.value || 5),
    override_duration: parseFloat(document.getElementById('bc-override-dur')?.value || '') || null,
    loop: document.getElementById('bc-loop')?.checked ? 1 : 0,
    enabled: document.getElementById('bc-enabled')?.checked ? 1 : 0,
    messages: _broadcastMessages.map(t => ({ text: t })),
    broadcast_graph: _broadcastGraph || null,
  };

  const isNew = !_broadcastEditTarget;
  const path = isNew ? '/broadcast/broadcasts' : `/broadcast/broadcasts/${_broadcastEditTarget.id}`;
  const method = isNew ? 'POST' : 'PUT';

  try {
    const res = await directAPI(path, method, body);
    if (res?.error) { toast(res.error, true); return; }
    closeModal();
    toast(isNew ? 'Broadcast created.' : 'Broadcast saved.');
    await showPanel('broadcasts');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteBroadcast(id, name) {
  if (!confirm(`Delete broadcast "${name}"? This cannot be undone.`)) return;
  try {
    const res = await directAPI(`/broadcast/broadcasts/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }
    toast('Broadcast deleted.');
    await showPanel('broadcasts');
  } catch (err) {
    toast(err.message, true);
  }
}

async function cloneBroadcast(rec) {
  const body = {
    name: `${rec.name} (copy)`,
    description: rec.description || '',
    category: rec.category || 'general',
    playback_mode: rec.playback_mode || 'scripted',
    message_interval: rec.message_interval || 5,
    override_duration: rec.override_duration || null,
    loop: rec.loop || 0,
    enabled: 1,
    messages: Array.isArray(rec.messages) ? rec.messages : [],
  };
  try {
    const res = await directAPI('/broadcast/broadcasts', 'POST', body);
    if (res?.error) { toast(res.error, true); return; }
    toast('Broadcast cloned.');
    await showPanel('broadcasts');
  } catch (err) {
    toast(err.message, true);
  }
}

// ── BSM import ───────────────────────────────────────────────────────────────

function bcImportBsm() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bsm,.txt';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    let compiled;
    try {
      compiled = compileBsm(text);
    } catch (err) {
      toast(`BSM parse error: ${err.message}`, true); return;
    }
    if (!compiled.meta.name) { toast('BSM file is missing @broadcast name.', true); return; }
    await _bcImportDependencies(compiled);
  };
  input.click();
}

// ── BSM dependency resolver ───────────────────────────────────────────────────

let _bcDepCompiled = null;
let _bcDepPending = new Set();
let _bcPickerZoneId = null;
let _bcPickerSelected = null;

async function _bcImportDependencies(compiled) {
  const [allZones, allNpcs] = await Promise.all([
    directAPI('/zones', 'GET'),
    directAPI('/npcs', 'GET'),
  ]);

  const zoneIds = new Set((allZones || []).map(z => z.id));
  const npcDbIds = new Set((allNpcs || []).map(n => n.id));

  const missingZones = compiled.rooms.filter(id => !zoneIds.has(id));
  const missingNpcs  = compiled.npcIds.filter(id => !npcDbIds.has(id));

  if (!missingZones.length && !missingNpcs.length) {
    await _bcImportSave(compiled); return;
  }

  _bcDepCompiled = compiled;
  _bcDepPending  = new Set([...missingZones, ...missingNpcs]);
  _bcShowDepModal(missingNpcs, missingZones, allZones || []);
}

function _bcShowDepModal(missingNpcs, missingZones, allZones) {
  const npcRows = missingNpcs.map(id => `
    <div id="dep-row-${CSS.escape(id)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg3);border-radius:2px">
      <span style="flex:1;font-size:12px;color:var(--text)">NPC <span style="color:var(--cyan)">${escHtml(id)}</span></span>
      <span id="dep-status-${CSS.escape(id)}" style="font-size:10px;color:var(--text-dim)">missing</span>
      <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="_bcCreateNpc('${id}')">Create NPC</button>
    </div>`).join('');

  const zoneRows = missingZones.map(id => `
    <div id="dep-row-${CSS.escape(id)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg3);border-radius:2px">
      <span style="flex:1;font-size:12px;color:var(--text)">Zone <span style="color:var(--yellow)">${escHtml(id)}</span></span>
      <span id="dep-status-${CSS.escape(id)}" style="font-size:10px;color:var(--text-dim)">missing</span>
      <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="_bcShowZonePicker('${id}')">Place on Map</button>
    </div>`).join('');

  const el = document.createElement('div');
  el.id = 'bsm-dep-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:700;display:flex;align-items:center;justify-content:center';
  el.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--accent);padding:20px;width:560px;max-width:94vw;max-height:80vh;overflow-y:auto;border-radius:3px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--accent);font-size:13px;letter-spacing:2px;text-transform:uppercase">BSM Dependencies</span>
        <button onclick="document.getElementById('bsm-dep-overlay').remove()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);width:26px;height:26px;cursor:pointer;border-radius:2px;font-size:13px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim)">The following entities referenced in the script don't exist yet. Resolve each one before importing.</div>
      ${npcRows || ''}
      ${zoneRows || ''}
      <button id="bsm-finish-btn" class="action-btn primary" style="margin-top:4px" disabled onclick="_bcDepFinish()">Finish Import</button>
    </div>`;

  // stash allZones on the element for the picker
  el._allZones = allZones;
  document.body.appendChild(el);
}

function _bcMarkResolved(id) {
  _bcDepPending.delete(id);
  const statusEl = document.getElementById(`dep-status-${CSS.escape(id)}`);
  if (statusEl) { statusEl.textContent = '✓ created'; statusEl.style.color = 'var(--success)'; }
  const rowEl = document.getElementById(`dep-row-${CSS.escape(id)}`);
  if (rowEl) rowEl.querySelectorAll('button').forEach(b => b.disabled = true);
  if (_bcDepPending.size === 0) {
    const btn = document.getElementById('bsm-finish-btn');
    if (btn) btn.removeAttribute('disabled');
  }
}

async function _bcCreateNpc(id) {
  const name = id.replace(/^npc_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  try {
    const res = await directAPI('/npcs', 'POST', {
      id, name, description: `${name}. Edit this description.`,
      zone_id: null, disposition: 'neutral',
    });
    if (res?.error) { toast(res.error, true); return; }
    _bcMarkResolved(id);
  } catch (err) { toast(err.message, true); }
}

function _bcShowZonePicker(zoneId) {
  _bcPickerZoneId = zoneId;
  _bcPickerSelected = null;
  const overlay = document.getElementById('bsm-dep-overlay');
  const allZones = overlay?._allZones || [];
  const placed = allZones.filter(z => z.grid_x != null && z.grid_y != null && z.map_id === 'map_world');

  let minX = -3, maxX = 3, minY = -3, maxY = 3;
  if (placed.length) {
    const xs = placed.map(z => z.grid_x), ys = placed.map(z => z.grid_y);
    minX = Math.min(...xs) - 2; maxX = Math.max(...xs) + 2;
    minY = Math.min(...ys) - 2; maxY = Math.max(...ys) + 2;
  }
  const byCoord = new Map(placed.map(z => [`${z.grid_x},${z.grid_y}`, z]));
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const CELL = 76;

  let cells = '';
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const z = byCoord.get(`${x},${y}`);
      if (z) {
        cells += `<div style="background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-dim);text-align:center;padding:2px;overflow:hidden;line-height:1.2" title="${z.id}">${escHtml(z.name)}</div>`;
      } else {
        cells += `<div class="bsm-pick-cell" data-x="${x}" data-y="${y}" onclick="_bcPickCell(${x},${y},this)" style="background:var(--bg);border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--border);cursor:pointer" title="${x},${y}">+</div>`;
      }
    }
  }

  const picker = document.createElement('div');
  picker.id = 'bsm-picker-overlay';
  picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:800;display:flex;align-items:center;justify-content:center';
  picker.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--yellow);padding:16px;width:660px;max-width:96vw;border-radius:3px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--yellow);font-size:12px;letter-spacing:1px;text-transform:uppercase">Place Zone: <strong>${escHtml(zoneId)}</strong></span>
        <button onclick="document.getElementById('bsm-picker-overlay').remove()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);width:24px;height:24px;cursor:pointer;border-radius:2px;font-size:12px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim)">Click an empty cell (+) to place the zone on the world map.</div>
      <div style="overflow:auto;max-height:400px">
        <div style="display:grid;grid-template-columns:repeat(${W},${CELL}px);grid-template-rows:repeat(${H},${Math.round(CELL*0.65)}px);gap:2px;width:fit-content">
          ${cells}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <span id="bsm-picker-label" style="font-size:11px;color:var(--text-dim)">No cell selected</span>
        <button onclick="document.getElementById('bsm-picker-overlay').remove()" class="action-btn">Cancel</button>
        <button id="bsm-picker-confirm" class="action-btn primary" disabled onclick="_bcPickerConfirm()">Place Here</button>
      </div>
    </div>`;
  document.body.appendChild(picker);
}

function _bcPickCell(x, y, el) {
  document.querySelectorAll('.bsm-pick-cell').forEach(c => {
    c.style.background = 'var(--bg)';
    c.style.borderColor = 'var(--border)';
    c.style.color = 'var(--border)';
  });
  el.style.background = 'color-mix(in srgb,var(--yellow) 20%,transparent)';
  el.style.borderColor = 'var(--yellow)';
  el.style.color = 'var(--yellow)';
  _bcPickerSelected = { x, y };
  const lbl = document.getElementById('bsm-picker-label');
  if (lbl) lbl.textContent = `Selected: ${x}, ${y}`;
  const btn = document.getElementById('bsm-picker-confirm');
  if (btn) btn.removeAttribute('disabled');
}

async function _bcPickerConfirm() {
  if (!_bcPickerSelected || !_bcPickerZoneId) return;
  const { x, y } = _bcPickerSelected;
  const id = _bcPickerZoneId;
  const name = id.split('/').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  try {
    const res = await directAPI('/zones', 'POST', {
      id, name, description: `${name}. Edit this description.`,
      map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0,
      marker: name.slice(0, 2).toUpperCase(),
    });
    if (res?.error) { toast(res.error, true); return; }
    document.getElementById('bsm-picker-overlay')?.remove();
    _bcMarkResolved(id);
    toast(`Zone "${name}" placed at ${x},${y}.`);
  } catch (err) { toast(err.message, true); }
}

async function _bcDepFinish() {
  document.getElementById('bsm-dep-overlay')?.remove();
  if (_bcDepCompiled) await _bcImportSave(_bcDepCompiled);
}

async function _bcImportSave({ meta, broadcastGraph, messages, assets }) {
  // Upsert any ::asset blocks into media_graphics
  for (const asset of assets) {
    try {
      await directAPI('/broadcast/graphics', 'POST', asset);
    } catch {
      try { await directAPI(`/broadcast/graphics/${asset.id}`, 'PUT', asset); } catch {}
    }
  }

  // Check for duplicate name
  let method = 'POST', path = '/broadcast/broadcasts';
  const existing = _broadcastList.find(b => b.name === meta.name);
  if (existing) {
    const overwrite = confirm(`A broadcast named "${meta.name}" already exists.\n\nOK = overwrite it   Cancel = create new copy`);
    if (overwrite) {
      method = 'PUT';
      path = `/broadcast/broadcasts/${existing.id}`;
    } else {
      meta.name += ' (imported)';
    }
  }

  const body = {
    name: meta.name,
    category: meta.category || 'general',
    playback_mode: 'scripted',
    message_interval: 5,
    override_duration: meta.length || null,
    loop: 0,
    enabled: 1,
    messages: messages.map(t => ({ text: t })),
    broadcast_graph: broadcastGraph,
  };

  try {
    const res = await directAPI(path, method, body);
    if (res?.error) { toast(res.error, true); return; }
    const nodeCount = Object.keys(broadcastGraph.nodes).length;
    toast(`Imported "${meta.name}" — ${messages.length} messages, ${nodeCount} graph nodes${assets.length ? `, ${assets.length} asset(s)` : ''}.`);
    await showPanel('broadcasts');
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
