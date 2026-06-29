// Broadcast channel panel — list + timeline editor + camera manager.
// All functions land in global scope (no modules).

const CHANNEL_TYPES = ['playlist','news','mixed','live','emergency'];
const NEWS_CATEGORIES = [
  'murder','wanted','police','robbery','martial_law','nuclear_events',
  'major_fires','mutants','player_deaths','gang_wars','explosions',
  'disease','corporate','elections','prison_escapes','bounties',
  'new_businesses','weather',
];

// ── State ────────────────────────────────────────────────────────────────────

let _channelList = [];
let _channelEditTarget = null;
let _channelPlaylist = [];     // [{ id, broadcast_id, broadcast_name, start_time, duration, duration_override, priority, conditions }]
let _channelBroadcasts = [];   // available broadcast assets for dragging onto timeline
let _tlScale = 2;              // px per second
let _tlLoopDuration = 3600;    // total loop seconds
let _tlDragging = null;        // { idx, startX, origStartTime }
let _tlResizing = null;        // { idx, startX, origDuration }
let _cameras = [];

// ── Panel render ─────────────────────────────────────────────────────────────

function renderChannelsPanel(data) {
  _channelList = Array.isArray(data) ? data : [];
  const panel = document.getElementById('list-panel');

  const typeColor = { playlist:'var(--cyan)', news:'var(--yellow)', mixed:'var(--accent)', live:'var(--green)', emergency:'var(--red)' };

  const rows = _channelList.map(ch => {
    const plCount = Array.isArray(ch.playlist) ? ch.playlist.length : 0;
    return `<tr>
      <td style="font-weight:bold;color:var(--accent);min-width:32px">${ch.number ?? '—'}</td>
      <td style="font-weight:600;color:${ch.enabled ? 'var(--text-bright)' : 'var(--text-dim)'}">${escHtml2(ch.name)}</td>
      <td><span style="font-size:10px;padding:2px 6px;border-radius:2px;background:var(--bg3);color:${typeColor[ch.channel_type] || 'var(--text)'}">${ch.channel_type || 'playlist'}</span></td>
      <td style="text-align:center;color:var(--text-dim)">${plCount}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="openChannelEditor(${JSON.stringify(ch).replace(/"/g,'&quot;')})">✏ Edit</button>
        <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteChannel('${ch.id}','${escHtml2(ch.name).replace(/'/g,"\\'")}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">Channels</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${_channelList.length} channel${_channelList.length !== 1 ? 's' : ''} — tune devices to a number to receive</div>
        </div>
        <button class="action-btn" onclick="openChannelEditor(null)">+ New Channel</button>
      </div>
      ${_channelList.length ? `
      <table>
        <thead><tr><th style="min-width:32px">#</th><th>Name</th><th>Type</th><th style="text-align:center">Items</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<div style="padding:24px;color:var(--text-dim)">No channels yet. Create one to schedule broadcasts.</div>'}
    </div>
    <div style="padding:10px 16px;background:var(--bg2);margin-top:4px;border-bottom:2px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">Cameras</div>
        <button class="action-btn" onclick="openCameraEditor(null)">+ New Camera</button>
      </div>
      <div id="camera-list-area"></div>
    </div>`;

  loadCameraList();
}

// ── Camera list ──────────────────────────────────────────────────────────────

async function loadCameraList() {
  try {
    _cameras = await directAPI('/broadcast/cameras');
    renderCameraList();
  } catch (e) {
    document.getElementById('camera-list-area').innerHTML =
      `<span style="color:var(--text-dim);font-size:12px">Could not load cameras.</span>`;
  }
}

function renderCameraList() {
  const el = document.getElementById('camera-list-area');
  if (!el) return;
  if (!Array.isArray(_cameras) || !_cameras.length) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:12px">No cameras placed.</div>';
    return;
  }
  const rows = _cameras.map(c => `<tr>
    <td style="font-size:12px">${escHtml2(c.zone_name || c.zone_id || '—')}</td>
    <td style="font-size:11px;color:var(--text-dim)">${c.direction}</td>
    <td style="text-align:center">${c.is_powered ? '<span style="color:var(--green)">⬤</span>' : '<span style="color:var(--text-dim)">⬤</span>'}</td>
    <td style="text-align:center">${c.is_recording ? '<span style="color:var(--red)">⏺</span>' : '—'}</td>
    <td style="text-align:center">${c.is_streaming ? `<span style="color:var(--cyan)">▶ Ch ${c.channel_number ?? '?'}</span>` : '—'}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="openCameraEditor(${JSON.stringify(c).replace(/"/g,'&quot;')})">✏</button>
      <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="clearCameraBuffer('${c.id}')">⏹ Clear</button>
      <button class="action-btn" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="cameraTobroadcast('${c.id}')">→ Broadcast</button>
      <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteCamera('${c.id}')">✕</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `<table>
    <thead><tr><th>Zone</th><th>Dir</th><th>Power</th><th>Rec</th><th>Stream</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Channel editor (metadata + timeline) ─────────────────────────────────────

async function openChannelEditor(rec) {
  _channelEditTarget = rec || null;
  _channelPlaylist = [];

  // Load broadcasts, themes, graphics, and zones in parallel
  let themes = [], graphics = [], zones = [];
  try {
    const [bcs, ths, gfx, zns] = await Promise.all([
      directAPI('/broadcast/broadcasts'),
      directAPI('/broadcast/themes'),
      directAPI('/broadcast/graphics'),
      directAPI('/zones'),
    ]);
    _channelBroadcasts = Array.isArray(bcs) ? bcs : [];
    themes   = Array.isArray(ths) ? ths : [];
    graphics = Array.isArray(gfx) ? gfx : [];
    zones    = Array.isArray(zns) ? zns : [];
  } catch (e) { _channelBroadcasts = []; themes = []; graphics = []; zones = []; }

  // Load existing playlist
  if (rec) {
    try {
      const pl = await directAPI(`/broadcast/channels/${rec.id}/playlist`);
      _channelPlaylist = (Array.isArray(pl) ? pl : []).map(item => {
        const msgs = Array.isArray(item.messages) ? item.messages : (item.messages ? JSON.parse(item.messages || '[]') : []);
        const dur = item.duration_override || (msgs.length * (item.message_interval || 5));
        return {
          id: item.id,
          broadcast_id: item.broadcast_id,
          broadcast_name: item.broadcast_name || item.broadcast_id,
          start_time: item.start_time || 0,
          duration: dur || 60,
          duration_override: item.duration_override || null,
          priority: item.priority || 0,
          conditions: item.conditions || [],
        };
      });
    } catch (e) { _channelPlaylist = []; }
  }

  // Compute a sensible loop duration
  if (_channelPlaylist.length) {
    _tlLoopDuration = Math.max(3600, ...(_channelPlaylist.map(i => i.start_time + i.duration)));
  } else {
    _tlLoopDuration = 3600;
  }

  // Build idle broadcast options
  const idleOptions = [
    '<option value="">— None —</option>',
    ..._channelBroadcasts.map(b =>
      `<option value="${b.id}"${rec?.idle_broadcast_id === b.id ? ' selected' : ''}>${escHtml2(b.name)}</option>`
    ),
  ].join('');

  const typeOptions = CHANNEL_TYPES.map(t =>
    `<option value="${t}"${(rec?.channel_type || 'playlist') === t ? ' selected' : ''}>${t}</option>`
  ).join('');

  const themeOptions = [
    '<option value="">— None —</option>',
    ...themes.map(t =>
      `<option value="${t.id}"${rec?.theme_id === t.id ? ' selected' : ''}>${escHtml2(t.name)}</option>`
    ),
  ].join('');

  const graphicOptions = [
    '<option value="">— None —</option>',
    ...[...graphics].sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(g =>
      `<option value="${g.id}"${rec?.offline_graphic_id === g.id ? ' selected' : ''}>${escHtml2(g.name||g.id)}</option>`
    ),
  ].join('');

  const zoneOptions2 = [
    '<option value="">— None —</option>',
    ...[...zones].sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(z =>
      `<option value="${z.id}"${rec?.studio_zone_id === z.id ? ' selected' : ''}>${escHtml2(z.name)}</option>`
    ),
  ].join('');

  const newsCatCheckboxes = NEWS_CATEGORIES.map(cat => {
    const checked = Array.isArray(rec?.news_categories) && rec.news_categories.includes(cat) ? ' checked' : '';
    return `<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer">
      <input type="checkbox" class="ch-news-cat" value="${cat}"${checked}> ${cat.replace(/_/g,' ')}
    </label>`;
  }).join('');

  const body = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <!-- Metadata -->
      <div style="display:grid;grid-template-columns:80px 1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Channel #</label>
          <input id="ch-number" type="number" class="form-input" value="${rec?.number ?? ''}" placeholder="1" min="1">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Name *</label>
          <input id="ch-name" class="form-input" value="${escHtml2(rec?.name || '')}" placeholder="Channel name">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Type</label>
          <select id="ch-type" class="form-input">${typeOptions}</select>
        </div>
      </div>
      <div>
        <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Description</label>
        <input id="ch-description" class="form-input" value="${escHtml2(rec?.description || '')}" placeholder="Channel description">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Station Name</label>
          <input id="ch-station-name" class="form-input" value="${escHtml2(rec?.station_name || '')}" placeholder="Shown in TV header (defaults to Name)">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">TV Theme</label>
          <select id="ch-theme" class="form-input">${themeOptions}</select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Studio Zone</label>
          <select id="ch-studio-zone" class="form-input">${zoneOptions2}</select>
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Offline Graphic</label>
          <select id="ch-offline-graphic" class="form-input">${graphicOptions}</select>
        </div>
      </div>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
          <input type="checkbox" id="ch-enabled" ${rec?.enabled !== 0 ? 'checked' : ''}> Enabled
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
          <input type="checkbox" id="ch-loop" ${rec?.loop_playlist !== 0 ? 'checked' : ''}> Loop playlist
        </label>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11px;color:var(--text-dim)">Idle broadcast:</label>
          <select id="ch-idle" class="form-input" style="width:160px;font-size:11px">${idleOptions}</select>
        </div>
      </div>

      <!-- News categories (shown for news/mixed) -->
      <div id="ch-news-section" style="display:${(rec?.channel_type === 'news' || rec?.channel_type === 'mixed') ? 'block' : 'none'}">
        <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px">News Categories</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;background:var(--bg3);padding:8px;border-radius:2px">${newsCatCheckboxes}</div>
      </div>

      <!-- Timeline -->
      <div style="border:1px solid var(--border);border-radius:2px;overflow:hidden">
        <div style="padding:6px 10px;background:var(--bg3);display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px">Playlist Timeline</span>
          <div style="display:flex;gap:8px;align-items:center">
            <label style="font-size:11px;color:var(--text-dim)">Loop:</label>
            <input id="tl-loop-dur" type="number" class="form-input" style="width:80px;font-size:11px" value="${_tlLoopDuration}" min="60" step="60"> s
            <button class="action-btn" style="font-size:10px;padding:3px 6px" onclick="tlZoom(-0.5)">−</button>
            <span id="tl-scale-label" style="font-size:10px;color:var(--text-dim);min-width:40px;text-align:center">${_tlScale}px/s</span>
            <button class="action-btn" style="font-size:10px;padding:3px 6px" onclick="tlZoom(0.5)">+</button>
          </div>
        </div>
        <div style="display:flex;gap:0;min-height:120px">
          <!-- Library -->
          <div style="width:160px;min-width:160px;border-right:1px solid var(--border);padding:6px;overflow-y:auto;max-height:260px;background:var(--bg2)">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Library</div>
            <div id="tl-library" style="display:flex;flex-direction:column;gap:3px"></div>
          </div>
          <!-- Timeline canvas -->
          <div style="flex:1;overflow-x:auto;position:relative;background:var(--bg)">
            <div id="tl-ruler" style="height:20px;position:sticky;top:0;z-index:2;background:var(--bg2);border-bottom:1px solid var(--border)"></div>
            <div id="tl-track" style="position:relative;height:80px;min-width:100%;overflow:hidden"
              ondragover="event.preventDefault()" ondrop="tlDrop(event)"></div>
          </div>
        </div>
      </div>
    </div>`;

  openModal(rec ? `Edit Channel: ${rec.name}` : 'New Channel', body);

  // Make modal wider for the timeline
  const card = document.querySelector('#generic-modal .modal-card');
  if (card) card.style.width = '820px';

  // Wire type → news section visibility
  document.getElementById('ch-type')?.addEventListener('change', (e) => {
    const sec = document.getElementById('ch-news-section');
    if (sec) sec.style.display = (e.target.value === 'news' || e.target.value === 'mixed') ? 'block' : 'none';
  });

  document.getElementById('tl-loop-dur')?.addEventListener('change', (e) => {
    _tlLoopDuration = parseInt(e.target.value, 10) || 3600;
    tlRender();
  });

  tlRenderLibrary();
  tlRender();

  document.getElementById('modal-save').onclick = saveChannel;
}

// ── Timeline editor ──────────────────────────────────────────────────────────

function tlZoom(delta) {
  _tlScale = Math.max(0.5, Math.min(20, _tlScale + delta));
  const label = document.getElementById('tl-scale-label');
  if (label) label.textContent = `${_tlScale}px/s`;
  tlRender();
}

function tlRenderLibrary() {
  const lib = document.getElementById('tl-library');
  if (!lib) return;
  if (!_channelBroadcasts.length) {
    lib.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">No broadcasts.</div>';
    return;
  }
  lib.innerHTML = _channelBroadcasts.map(b => {
    const msgs = Array.isArray(b.messages) ? b.messages : [];
    const dur = b.override_duration || (msgs.length * (b.message_interval || 5));
    return `<div draggable="true"
      style="font-size:11px;padding:3px 6px;background:var(--bg3);border-radius:2px;cursor:grab;border-left:3px solid var(--accent);user-select:none"
      ondragstart="tlLibDragStart(event,'${b.id}','${escHtml2(b.name).replace(/'/g,"\\'")}',${dur})"
      title="${escHtml2(b.name)} — ${dur}s">
      ${escHtml2(b.name.length > 22 ? b.name.slice(0,20)+'…' : b.name)}
      <span style="color:var(--text-dim);font-size:10px"> ${dur}s</span>
    </div>`;
  }).join('');
}

function tlLibDragStart(event, broadcastId, broadcastName, duration) {
  event.dataTransfer.setData('bc_id', broadcastId);
  event.dataTransfer.setData('bc_name', broadcastName);
  event.dataTransfer.setData('bc_dur', duration);
}

function tlDrop(event) {
  event.preventDefault();
  const track = document.getElementById('tl-track');
  if (!track) return;
  const bcId = event.dataTransfer.getData('bc_id');
  const bcName = event.dataTransfer.getData('bc_name');
  const bcDur = parseFloat(event.dataTransfer.getData('bc_dur')) || 60;
  if (!bcId) return;

  const rect = track.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const rawTime = offsetX / _tlScale;
  const startTime = Math.max(0, Math.round(rawTime / 30) * 30); // snap to 30s

  _channelPlaylist.push({
    id: `pl_new_${Date.now()}`,
    broadcast_id: bcId,
    broadcast_name: bcName,
    start_time: startTime,
    duration: bcDur,
    duration_override: null,
    priority: 0,
    conditions: [],
  });
  tlRender();
}

function tlRender() {
  const track = document.getElementById('tl-track');
  const ruler = document.getElementById('tl-ruler');
  if (!track || !ruler) return;

  const totalWidth = Math.max((_tlLoopDuration + 300) * _tlScale, 400);
  track.style.width = `${totalWidth}px`;
  ruler.style.width = `${totalWidth}px`;

  // Ruler tick marks
  const COLORS = ['var(--cyan)','var(--yellow)','var(--green)','var(--accent)','var(--red)'];
  let rulerHtml = '';
  const tickEvery = _tlScale < 1 ? 600 : _tlScale < 3 ? 300 : _tlScale < 6 ? 120 : 60;
  for (let t = 0; t <= _tlLoopDuration; t += tickEvery) {
    const x = t * _tlScale;
    const label = t >= 3600 ? `${(t/3600).toFixed(1)}h` : t >= 60 ? `${Math.floor(t/60)}m` : `${t}s`;
    rulerHtml += `<div style="position:absolute;left:${x}px;top:0;height:100%;border-left:1px solid var(--border);padding-left:3px;font-size:9px;color:var(--text-dim);white-space:nowrap;line-height:20px">${label}</div>`;
  }
  // Loop end marker
  const loopX = _tlLoopDuration * _tlScale;
  rulerHtml += `<div style="position:absolute;left:${loopX}px;top:0;height:100%;border-left:2px dashed var(--text-dim);z-index:3"></div>`;
  ruler.innerHTML = rulerHtml;

  // Playlist items
  track.innerHTML = _channelPlaylist.map((item, idx) => {
    const left = item.start_time * _tlScale;
    const width = Math.max(item.duration * _tlScale, 20);
    const color = COLORS[idx % COLORS.length];
    const label = item.broadcast_name || item.broadcast_id;
    const dur = item.duration_override ? `${item.duration_override}s` : `${item.duration.toFixed(0)}s`;
    const dimmed = item.start_time + item.duration > _tlLoopDuration;
    return `<div class="tl-item" data-idx="${idx}" style="
        position:absolute;left:${left}px;top:8px;width:${width}px;height:64px;
        background:color-mix(in srgb,${color} 20%,var(--bg3));
        border-left:3px solid ${color};border-radius:2px;
        box-sizing:border-box;overflow:hidden;cursor:grab;user-select:none;
        opacity:${dimmed ? 0.4 : 1};
      "
      onmousedown="tlItemDragStart(event,${idx})"
      ondblclick="tlEditItem(${idx})">
      <div style="font-size:10px;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-bright)">${escHtml2(label)}</div>
      <div style="font-size:9px;padding:0 6px;color:var(--text-dim)">${formatTime(item.start_time)} — ${dur}</div>
      <button onclick="event.stopPropagation();tlRemoveItem(${idx})" style="position:absolute;top:2px;right:2px;background:transparent;border:none;color:var(--text-dim);font-size:11px;cursor:pointer;line-height:1;padding:0">✕</button>
      <div class="tl-resize-handle" style="position:absolute;right:0;top:0;bottom:0;width:8px;cursor:ew-resize;background:linear-gradient(to right,transparent,${color})" onmousedown="tlResizeStart(event,${idx})"></div>
    </div>`;
  }).join('');
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function tlItemDragStart(event, idx) {
  if (event.target.classList.contains('tl-resize-handle')) return;
  event.preventDefault();
  _tlDragging = { idx, startX: event.clientX, origStartTime: _channelPlaylist[idx].start_time };
  const onMove = (e) => {
    if (!_tlDragging) return;
    const dx = e.clientX - _tlDragging.startX;
    const newTime = Math.max(0, _tlDragging.origStartTime + dx / _tlScale);
    _channelPlaylist[_tlDragging.idx].start_time = Math.round(newTime / 30) * 30;
    tlRender();
  };
  const onUp = () => {
    _tlDragging = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function tlResizeStart(event, idx) {
  event.preventDefault();
  event.stopPropagation();
  _tlResizing = { idx, startX: event.clientX, origDuration: _channelPlaylist[idx].duration };
  const onMove = (e) => {
    if (!_tlResizing) return;
    const dx = e.clientX - _tlResizing.startX;
    const newDur = Math.max(30, _tlResizing.origDuration + dx / _tlScale);
    _channelPlaylist[_tlResizing.idx].duration = Math.round(newDur / 30) * 30;
    _channelPlaylist[_tlResizing.idx].duration_override = _channelPlaylist[_tlResizing.idx].duration;
    tlRender();
  };
  const onUp = () => {
    _tlResizing = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function tlRemoveItem(idx) {
  _channelPlaylist.splice(idx, 1);
  tlRender();
}

function tlEditItem(idx) {
  const item = _channelPlaylist[idx];
  if (!item) return;
  const newTime = prompt(`Start time for "${item.broadcast_name}" (seconds):`, item.start_time);
  if (newTime !== null) {
    const t = parseInt(newTime, 10);
    if (!isNaN(t)) { item.start_time = Math.max(0, t); tlRender(); }
  }
}

// ── Save channel ─────────────────────────────────────────────────────────────

async function saveChannel() {
  const name = document.getElementById('ch-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  const newsCategories = Array.from(document.querySelectorAll('.ch-news-cat:checked')).map(cb => cb.value);

  const channelBody = {
    name,
    number: parseInt(document.getElementById('ch-number')?.value || 0, 10) || null,
    description: document.getElementById('ch-description')?.value || '',
    station_name: document.getElementById('ch-station-name')?.value?.trim() || '',
    channel_type: document.getElementById('ch-type')?.value || 'playlist',
    enabled: document.getElementById('ch-enabled')?.checked ? 1 : 0,
    loop_playlist: document.getElementById('ch-loop')?.checked ? 1 : 0,
    idle_broadcast_id: document.getElementById('ch-idle')?.value || null,
    theme_id: document.getElementById('ch-theme')?.value || null,
    news_categories: newsCategories,
    studio_zone_id: document.getElementById('ch-studio-zone')?.value?.trim() || null,
    offline_graphic_id: document.getElementById('ch-offline-graphic')?.value?.trim() || null,
  };

  const isNew = !_channelEditTarget;
  const chPath = isNew ? '/broadcast/channels' : `/broadcast/channels/${_channelEditTarget.id}`;
  const chMethod = isNew ? 'POST' : 'PUT';

  try {
    const chRes = await directAPI(chPath, chMethod, channelBody);
    if (chRes?.error) { toast(chRes.error, true); return; }

    const channelId = isNew ? chRes.id : _channelEditTarget.id;

    // Save playlist
    const playlistBody = _channelPlaylist.map(item => ({
      broadcast_id: item.broadcast_id,
      start_time: item.start_time,
      duration_override: item.duration_override || null,
      priority: item.priority || 0,
      conditions: item.conditions || [],
    }));
    const plRes = await directAPI(`/broadcast/channels/${channelId}/playlist`, 'PUT', playlistBody);
    if (plRes?.error) { toast(plRes.error, true); return; }

    closeModal();
    toast(isNew ? 'Channel created.' : 'Channel saved.');
    await bcSuiteRefresh('channels');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteChannel(id, name) {
  if (!confirm(`Delete channel "${name}" and its playlist? This cannot be undone.`)) return;
  try {
    const res = await directAPI(`/broadcast/channels/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }
    toast('Channel deleted.');
    await bcSuiteRefresh('channels');
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Camera editor ────────────────────────────────────────────────────────────

async function openCameraEditor(rec) {
  let zones = [];
  let channels = [];
  try {
    [zones, channels] = await Promise.all([directAPI('/zones'), directAPI('/broadcast/channels')]);
    zones = Array.isArray(zones) ? zones : [];
    channels = Array.isArray(channels) ? channels : [];
  } catch (e) {}

  const zoneOptions = ['<option value="">— No zone —</option>',
    ...zones.map(z => `<option value="${z.id}"${rec?.zone_id === z.id ? ' selected' : ''}>${escHtml2(z.name)}</option>`)
  ].join('');
  const chOptions = ['<option value="">— Not streaming —</option>',
    ...channels.map(c => `<option value="${c.id}"${rec?.streaming_channel_id === c.id ? ' selected' : ''}>Ch ${c.number}: ${escHtml2(c.name)}</option>`)
  ].join('');

  const body = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Zone</label>
          <select id="cam-zone" class="form-input">${zoneOptions}</select>
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Direction</label>
          <select id="cam-dir" class="form-input">
            ${['north','south','east','west','up','down','all'].map(d =>
              `<option value="${d}"${(rec?.direction || 'north') === d ? ' selected' : ''}>${d}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div>
        <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Stream to Channel</label>
        <select id="cam-channel" class="form-input">${chOptions}</select>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
          <input type="checkbox" id="cam-powered" ${rec?.is_powered !== 0 ? 'checked' : ''}> Powered
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
          <input type="checkbox" id="cam-recording" ${rec?.is_recording ? 'checked' : ''}> Recording
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
          <input type="checkbox" id="cam-streaming" ${rec?.is_streaming ? 'checked' : ''}> Streaming
        </label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Storage Limit (frames)</label>
          <input id="cam-storage" type="number" class="form-input" value="${rec?.storage_limit || 200}" min="10" max="2000">
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Permissions</label>
          <select id="cam-perms" class="form-input">
            ${['public','private','admin'].map(p =>
              `<option value="${p}"${(rec?.permissions || 'public') === p ? ' selected' : ''}>${p}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </div>`;

  openModal(rec ? 'Edit Camera' : 'New Camera', body);

  document.getElementById('modal-save').onclick = async () => {
    const camBody = {
      zone_id: document.getElementById('cam-zone')?.value || null,
      direction: document.getElementById('cam-dir')?.value || 'north',
      streaming_channel_id: document.getElementById('cam-channel')?.value || null,
      is_powered: document.getElementById('cam-powered')?.checked ? 1 : 0,
      is_recording: document.getElementById('cam-recording')?.checked ? 1 : 0,
      is_streaming: document.getElementById('cam-streaming')?.checked ? 1 : 0,
      storage_limit: parseInt(document.getElementById('cam-storage')?.value || 200, 10),
      permissions: document.getElementById('cam-perms')?.value || 'public',
    };
    try {
      const path = rec ? `/broadcast/cameras/${rec.id}` : '/broadcast/cameras';
      const method = rec ? 'PUT' : 'POST';
      const res = await directAPI(path, method, camBody);
      if (res?.error) { toast(res.error, true); return; }
      closeModal();
      toast(rec ? 'Camera saved.' : 'Camera created.');
      await loadCameraList();
    } catch (err) { toast(err.message, true); }
  };
}

async function deleteCamera(id) {
  if (!confirm('Delete this camera?')) return;
  try {
    const res = await directAPI(`/broadcast/cameras/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }
    toast('Camera deleted.');
    await loadCameraList();
  } catch (err) { toast(err.message, true); }
}

async function clearCameraBuffer(id) {
  if (!confirm('Clear the recording buffer for this camera?')) return;
  try {
    await directAPI(`/broadcast/cameras/${id}/clear-buffer`, 'POST');
    toast('Buffer cleared.');
  } catch (err) { toast(err.message, true); }
}

async function cameraTobroadcast(id) {
  const name = prompt('Name for the new broadcast:');
  if (!name) return;
  try {
    const res = await directAPI(`/broadcast/cameras/${id}/to-broadcast`, 'POST', { name });
    if (res?.error) { toast(res.error, true); return; }
    toast(`Broadcast created (${res.message_count} frames).`);
  } catch (err) { toast(err.message, true); }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escHtml2(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
