// Broadcast asset panel — list + modal editor with message sequence builder.
// All functions land in global scope (no modules).

const BROADCAST_CATEGORIES = ['general','news','advertisement','entertainment','emergency','weather','sport','music','documentary','surveillance'];
const BROADCAST_MODES = ['scripted','dynamic_news','live_camera','recorded'];

// ── State ────────────────────────────────────────────────────────────────────

let _broadcastList = [];
let _broadcastEditTarget = null;
let _broadcastMessages = [];

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
          </div>
          <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="bcAddMessage()">+ Add Message</button>
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

// ── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
