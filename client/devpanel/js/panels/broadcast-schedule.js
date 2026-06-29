// broadcast-schedule.js — 24-hour daily broadcast schedule editor.
// All functions land in global scope (no modules).

// ── State ────────────────────────────────────────────────────────────────────

let _schedChannels   = [];
let _schedBroadcasts = [];
let _schedNpcs       = [];
let _schedChannelId  = null;
let _schedItems      = []; // { broadcast_id, broadcast_name, start_time, duration, duration_override, npc_staff[] }

// Drag state
let _schedDragBcId   = null;  // broadcast id from library drag
let _schedDragIdx    = null;  // item index for timeline-item drag
let _schedDragOffset = 0;     // seconds from item left edge to mouse

// Resize state
let _schedResizeIdx       = null;
let _schedResizeStartX    = 0;
let _schedResizeStartDur  = 0;

// Popover state
let _schedPopoverIdx = null;

// Dirty tracking
let _schedDirty   = false;
let _schedNowTimer = null;

let   _schedPxPerHour   = 52;
const SCHED_SNAP        = 1800;
const SCHED_H           = 72;

function _schedScale() { return _schedPxPerHour / 3600; }
function _schedW() {
  if (!_schedItems.length) return _schedPxPerHour * 24;
  const rightmost = Math.max(..._schedItems.map(i => _schedToX(i.start_time + i.duration)));
  return Math.max(_schedPxPerHour * 24, rightmost) + 60;
}

const SCHED_CAT_COLOR = {
  entertainment: 'var(--cyan)',
  news:          'var(--yellow)',
  advertisement: 'var(--accent2)',
  emergency:     'var(--red)',
  music:         '#8a5cf7',
  documentary:   '#4a9e6e',
  sport:         '#e0883a',
  general:       'var(--text-dim)',
};

function _schedToX(sec)  { return sec * _schedScale(); }
function _schedToSec(px) { return Math.round((px / _schedScale()) / SCHED_SNAP) * SCHED_SNAP; }
function _schedClamp(sec, dur) { return Math.max(0, Math.min(86400 - (dur || SCHED_SNAP), sec)); }

function _schedZoom(delta) {
  _schedPxPerHour = Math.max(8, Math.min(400, _schedPxPerHour + delta));
  const label = document.getElementById('sched-zoom-label');
  if (label) label.textContent = _schedZoomLabel();
  _schedRenderTimeline();
}
function _schedZoomLabel() {
  if (_schedPxPerHour <= 14)  return 'day view';
  if (_schedPxPerHour <= 60)  return 'hour view';
  if (_schedPxPerHour <= 180) return 'min view';
  return 'sec view';
}

function _schedFmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── Panel entry ──────────────────────────────────────────────────────────────

async function renderSchedulePanel(data) {
  _schedChannels   = Array.isArray(data?.channels)   ? data.channels   : [];
  _schedBroadcasts = Array.isArray(data?.broadcasts) ? data.broadcasts : [];
  _schedNpcs       = Array.isArray(data?.npcs)       ? data.npcs       : [];

  if (!_schedChannelId && _schedChannels.length) _schedChannelId = _schedChannels[0].id;

  const panel = document.getElementById('list-panel');
  panel.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden">
      <div id="sched-sidebar" style="width:220px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)"></div>
      <div id="sched-content" style="flex:1;overflow:auto;background:var(--bg)"></div>
    </div>`;

  await _schedLoadItems();
  _schedRenderSidebar();
  _schedRenderContent();

  // Global mouse handlers for resize
  document.addEventListener('mousemove', _schedOnMouseMove);
  document.addEventListener('mouseup',   _schedOnMouseUp);
}

// ── New channel ───────────────────────────────────────────────────────────────

let _schedNewChVisible = false;

function _schedToggleNewCh(show) {
  _schedNewChVisible = show;
  const form = document.getElementById('sched-newch-form');
  if (form) form.style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('sched-newch-name')?.focus();
}

async function _schedCreateChannel() {
  const name   = document.getElementById('sched-newch-name')?.value?.trim();
  const number = parseInt(document.getElementById('sched-newch-number')?.value || '');
  if (!name)   { toast('Channel name is required.', true); return; }
  if (!number) { toast('Channel number is required.', true); return; }
  try {
    const res = await directAPI('/broadcast/channels', 'POST', {
      id: `ch_${number}_${Date.now()}`, name, number, channel_type: 'playlist', enabled: 1,
    });
    if (res?.error) { toast(res.error, true); return; }
    const newCh = { id: res.id || `ch_${number}_${Date.now()}`, name, number, channel_type: 'playlist', schedule_mode: 'daily' };
    _schedChannels.push(newCh);
    _schedChannels.sort((a, b) => (a.number || 99) - (b.number || 99));
    _schedChannelId = newCh.id;
    _schedItems = [];
    _schedToggleNewCh(false);
    _schedRenderSidebar();
    _schedRenderContent();
    toast(`Channel ${number}: ${name} created.`);
  } catch (err) { toast(err.message, true); }
}

async function _schedLoadItems() {
  if (!_schedChannelId) { _schedItems = []; return; }
  try {
    const pl = await directAPI(`/broadcast/channels/${_schedChannelId}/playlist`, 'GET');
    if (!Array.isArray(pl)) { _schedItems = []; return; }
    _schedItems = pl.map(item => {
      const bc = _schedBroadcasts.find(b => b.id === item.broadcast_id) || {};
      const dur = item.duration_override
        || bc.override_duration
        || ((Array.isArray(bc.messages) ? bc.messages.length : 0) * (bc.message_interval || 5))
        || 3600;
      const cond = item.conditions ? (typeof item.conditions === 'string' ? JSON.parse(item.conditions) : item.conditions) : {};
      const isBreak = item.slot_type === 'commercial_break';
      return {
        broadcast_id:      item.broadcast_id,
        broadcast_name:    isBreak ? 'Commercial Break' : (bc.name || item.broadcast_id),
        broadcast_category: isBreak ? 'commercial' : (bc.category || 'general'),
        slot_type:         item.slot_type || 'broadcast',
        start_time:        item.start_time || 0,
        duration:          dur,
        duration_override: item.duration_override || null,
        npc_staff:         Array.isArray(cond.npc_staff) ? cond.npc_staff : [],
      };
    });
  } catch { _schedItems = []; }
  _schedDirty = false;
  _schedUpdateSaveBtn();
}

function _schedMarkDirty() {
  if (_schedDirty) return;
  _schedDirty = true;
  _schedUpdateSaveBtn();
}

function _schedUpdateSaveBtn() {
  const btn = document.querySelector('[onclick="_schedSave()"]');
  if (!btn) return;
  if (_schedDirty) {
    btn.textContent = 'Save Schedule';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  } else {
    btn.textContent = '✓ Saved';
    btn.style.background = 'var(--green)';
    btn.style.color = 'var(--bg)';
    btn.style.borderColor = 'var(--green)';
  }
}

function _schedUpdateNowLine() {
  const line = document.getElementById('sched-now-line');
  if (!line) return;
  const now = new Date();
  const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  line.style.left = _schedToX(sec) + 'px';
}

// ── Sidebar render ────────────────────────────────────────────────────────────

function _schedRenderSidebar() {
  const el = document.getElementById('sched-sidebar');
  if (!el) return;

  const items = _schedChannels.map(ch => {
    const sel     = ch.id === _schedChannelId;
    const isDaily = ch.schedule_mode === 'daily';
    return `<div onclick="_schedSwitchChannel('${ch.id}')"
      style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);
             background:${sel ? 'var(--bg3)' : 'transparent'};
             border-left:3px solid ${sel ? 'var(--accent)' : 'transparent'}">
      <div style="font-size:12px;font-weight:600;color:var(--text-bright)">
        <span style="color:var(--text-dim);font-size:10px">Ch ${ch.number || '?'} </span>${escHtml(ch.name)}
      </div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px;display:flex;gap:6px">
        <span>${ch.channel_type || 'playlist'}</span>
        <span style="color:${isDaily ? 'var(--cyan)' : 'var(--border)'}">● ${isDaily ? 'daily' : 'loop'}</span>
      </div>
    </div>`;
  }).join('');

  const newChForm = `
    <div id="sched-newch-form" style="display:${_schedNewChVisible ? 'flex' : 'none'};flex-direction:column;gap:4px;padding:8px;background:var(--bg3);border-bottom:1px solid var(--border)">
      <input id="sched-newch-name"   class="form-input" placeholder="Channel name"  style="font-size:11px">
      <div style="display:flex;gap:4px">
        <input id="sched-newch-number" class="form-input" placeholder="Ch #" type="number" min="1" style="width:64px;font-size:11px">
        <button class="action-btn primary" style="font-size:11px;flex:1" onclick="_schedCreateChannel()">Create</button>
        <button class="action-btn" style="font-size:11px" onclick="_schedToggleNewCh(false)">✕</button>
      </div>
    </div>`;

  el.innerHTML = `
    <div style="padding:8px;border-bottom:1px solid var(--border);flex-shrink:0">
      <button class="action-btn" style="width:100%;font-size:11px" onclick="_schedToggleNewCh(true)">+ New Channel</button>
    </div>
    ${newChForm}
    <div style="flex:1;overflow-y:auto">
      ${items || '<div style="padding:16px;color:var(--text-dim);font-size:11px">No channels yet.</div>'}
    </div>`;
}

// ── Content render (timeline + library) ──────────────────────────────────────

function _schedRenderContent() {
  const el = document.getElementById('sched-content');
  if (!el) return;

  const ch = _schedChannels.find(c => c.id === _schedChannelId);
  if (!ch) {
    el.innerHTML = '<div style="padding:32px;color:var(--text-dim);font-size:12px">Select a channel from the sidebar.</div>';
    return;
  }

  const isDaily = ch.schedule_mode === 'daily';

  const libRows = _schedBroadcasts.map(b => {
    const dur = b.override_duration || ((Array.isArray(b.messages) ? b.messages.length : 0) * (b.message_interval || 5)) || 3600;
    const col = SCHED_CAT_COLOR[b.category] || 'var(--text-dim)';
    return `<div class="bc-lib-item" draggable="true"
      ondragstart="_schedLibDragStart(event,'${b.id}')"
      style="border-left:3px solid ${col}">
      <div class="bc-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${escHtml(b.name)}</div>
      <div class="bc-meta">${_schedFmtDur(dur)}</div>
    </div>`;
  }).join('');

  const breakTile = `<div class="bc-lib-item" draggable="true"
    ondragstart="_schedLibDragStart(event,'__break__')"
    style="border-left:3px solid var(--text-dim);border-style:dashed">
    <div class="bc-title">⏸ BREAK</div>
    <div class="bc-meta">commercial slot</div>
  </div>`;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;min-height:0">

      <!-- Channel header -->
      <div style="padding:10px 16px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="bc-meta">Ch</span>
          <input id="sched-ch-number" type="number" class="form-input" value="${ch.number || ''}" min="1"
            style="width:52px;font-size:13px;font-weight:700" onblur="_schedSaveChMeta()">
          <input id="sched-ch-name" class="form-input" value="${escHtml(ch.name)}"
            style="width:180px;font-size:13px;font-weight:700" onblur="_schedSaveChMeta()">
        </div>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--text)">
          <input type="checkbox" id="sched-daily-toggle" ${isDaily ? 'checked' : ''} onchange="_schedToggleMode(this.checked)">
          Daily mode
        </label>
        <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
          <div style="display:flex;align-items:center;gap:4px">
            <button class="action-btn" style="padding:2px 7px" onclick="_schedZoom(-16)" title="Zoom out">−</button>
            <span id="sched-zoom-label" class="bc-meta" style="min-width:58px;text-align:center">${_schedZoomLabel()}</span>
            <button class="action-btn" style="padding:2px 7px" onclick="_schedZoom(16)" title="Zoom in">+</button>
          </div>
          <button class="action-btn" onclick="bcImportBsm()" title="Import a .bsm file">↑ BSM</button>
          <button class="action-btn primary" onclick="_schedSave()">Save Schedule</button>
        </div>
      </div>

      <!-- Timeline area -->
      <div style="flex:1;overflow:auto;padding:16px">
        ${!isDaily
          ? `<div style="padding:24px 0;color:var(--text-dim);font-size:12px">
               Enable <strong>Daily mode</strong> above to use the 24-hour timeline editor for this channel.
             </div>`
          : `<div class="bc-meta" style="margin-bottom:8px">Drag broadcasts from the library onto the timeline. Click a block to edit. Snap: 30 min.</div>
             ${_schedBuildTimeline()}`}
      </div>

      <!-- Library drawer -->
      <div style="border-top:1px solid var(--border);padding:8px 12px;background:var(--bg2);flex-shrink:0">
        <div class="bc-label" style="margin-bottom:6px">Broadcast Library</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow-y:auto">
          ${breakTile}
          ${libRows || '<div class="bc-meta">No broadcasts</div>'}
        </div>
      </div>

    </div>`;

  _schedClosePopover();
}

// ── Save channel name/number on blur ──────────────────────────────────────────

function _schedChBody(ch, overrides = {}) {
  return {
    name: ch.name, number: ch.number, description: ch.description || '',
    station_name: ch.station_name || '', theme_id: ch.theme_id || null,
    studio_zone_id: ch.studio_zone_id || null, offline_graphic_id: ch.offline_graphic_id || null,
    enabled: ch.enabled !== 0 ? 1 : 0, loop_playlist: ch.loop_playlist !== 0 ? 1 : 0,
    priority: ch.priority || 0, channel_type: ch.channel_type || 'playlist',
    idle_broadcast_id: ch.idle_broadcast_id || null,
    news_categories: ch.news_categories || [],
    schedule_mode: ch.schedule_mode || 'daily',
    ...overrides,
  };
}

async function _schedSaveChMeta() {
  const ch = _schedChannels.find(c => c.id === _schedChannelId);
  if (!ch) return;
  const name   = document.getElementById('sched-ch-name')?.value?.trim()  || ch.name;
  const number = parseInt(document.getElementById('sched-ch-number')?.value || '') || ch.number;
  if (name === ch.name && number === ch.number) return;
  try {
    const res = await directAPI(`/broadcast/channels/${ch.id}`, 'PUT', _schedChBody(ch, { name, number }));
    if (res?.error) { toast(res.error, true); return; }
    ch.name = name; ch.number = number;
    _schedRenderSidebar();
  } catch (err) { toast(err.message, true); }
}

function _schedBuildTimeline() {
  const w = _schedW();
  // Ruler
  let ruler = `<div style="position:relative;width:${w}px;height:24px;flex-shrink:0;border-bottom:1px solid var(--border);margin-bottom:2px">`;
  for (let h = 0; h < 24; h++) {
    const x = _schedToX(h * 3600);
    ruler += `<div style="position:absolute;left:${x}px;top:0;height:100%;border-left:1px solid var(--border);padding-left:3px;font-size:10px;color:var(--text-dim);line-height:24px">${String(h).padStart(2,'0')}:00</div>`;
  }
  ruler += '</div>';

  // Items
  let items = '';
  _schedItems.forEach((item, idx) => {
    const x   = _schedToX(item.start_time);
    const iw  = Math.max(12, _schedToX(item.duration));
    const col = SCHED_CAT_COLOR[item.broadcast_category] || 'var(--text-dim)';

    if (item.slot_type === 'commercial_break') {
      items += `
        <div class="bc-break-slot" draggable="true"
          ondragstart="_schedItemDragStart(event,${idx})"
          onclick="_schedOpenPopover(event,${idx})"
          style="left:${x}px;width:${iw}px;">
          <span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">⏸ BREAK</span>
          <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
            style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:var(--border);opacity:0.8"></div>
        </div>`;
      return;
    }

    const staffChips = item.npc_staff.map(id => {
      const npc = _schedNpcs.find(n => n.id === id);
      const initials = (npc?.name || id).slice(0, 2).toUpperCase();
      return `<span class="bc-chip">${initials}</span>`;
    }).join('');
    items += `
      <div class="sched-item" draggable="true"
        ondragstart="_schedItemDragStart(event,${idx})"
        onclick="_schedOpenPopover(event,${idx})"
        style="position:absolute;left:${x}px;width:${iw}px;height:${SCHED_H}px;top:0;
               background:color-mix(in srgb,${col} 18%,var(--bg2));
               border:1px solid ${col};border-radius:2px;box-sizing:border-box;
               overflow:hidden;cursor:grab;user-select:none">
        <div style="padding:3px 5px;font-size:10px;font-weight:600;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.broadcast_name)}</div>
        <div class="bc-meta" style="padding:0 5px">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
        <div style="padding:2px 4px;display:flex;gap:2px;flex-wrap:wrap">${staffChips}</div>
        <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
          style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:${col};opacity:0.5"></div>
      </div>`;
  });

  return `
    <div style="overflow-x:auto">
      <div style="width:${w}px">
        ${ruler}
        <div id="sched-timeline" style="position:relative;width:${w}px;height:${SCHED_H}px;background:var(--bg3);border:1px solid var(--border);border-radius:2px"
          ondragover="_schedTlDragOver(event)"
          ondragleave="_schedTlDragLeave()"
          ondrop="_schedTlDrop(event)">
          <div id="sched-drop-line"></div>
          <div id="sched-now-line" style="position:absolute;top:0;bottom:0;width:2px;background:var(--accent);opacity:0.7;pointer-events:none;z-index:5"></div>
          ${items}
        </div>
      </div>
    </div>`;
  _schedUpdateNowLine();
  if (!_schedNowTimer) _schedNowTimer = setInterval(_schedUpdateNowLine, 10000);
}

function _schedFmtDur(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

// ── Channel switching + mode toggle ──────────────────────────────────────────

async function _schedSwitchChannel(id) {
  _schedChannelId = id;
  await _schedLoadItems();
  _schedRenderSidebar();
  _schedRenderContent();
}

async function _schedToggleMode(daily) {
  if (!_schedChannelId) return;
  const ch = _schedChannels.find(c => c.id === _schedChannelId);
  if (!ch) return;
  const mode = daily ? 'daily' : 'loop';
  try {
    const res = await directAPI(`/broadcast/channels/${ch.id}`, 'PUT', _schedChBody(ch, { schedule_mode: mode }));
    if (res?.error) { toast(res.error, true); return; }
    ch.schedule_mode = mode;
    _schedRenderSidebar();
    _schedRenderContent();
  } catch (err) { toast(err.message, true); }
}

// ── Library drag ─────────────────────────────────────────────────────────────

function _schedLibDragStart(e, broadcastId) {
  _schedDragBcId   = broadcastId;
  _schedDragIdx    = null;
  _schedDragOffset = 0;
  e.dataTransfer.effectAllowed = 'copy';
}

// ── Timeline item drag ────────────────────────────────────────────────────────

function _schedItemDragStart(e, idx) {
  _schedDragIdx  = idx;
  _schedDragBcId = null;
  const tl = document.getElementById('sched-timeline');
  if (tl) {
    const rect = tl.getBoundingClientRect();
    const item = _schedItems[idx];
    _schedDragOffset = (e.clientX - rect.left) - _schedToX(item.start_time); // pixels from item left edge
  }
  e.dataTransfer.effectAllowed = 'move';
  e.stopPropagation();
}

function _schedTlDragOver(e) {
  e.preventDefault();
  const tl = document.getElementById('sched-timeline');
  const line = document.getElementById('sched-drop-line');
  if (!tl || !line) return;
  const rect = tl.getBoundingClientRect();
  const rawPx = e.clientX - rect.left;
  const snappedPx = _schedToX(_schedToSec(rawPx));
  line.style.display = 'block';
  line.style.left = snappedPx + 'px';
}

function _schedTlDragLeave() {
  const line = document.getElementById('sched-drop-line');
  if (line) line.style.display = 'none';
}

function _schedTlDrop(e) {
  e.preventDefault();
  const line = document.getElementById('sched-drop-line');
  if (line) line.style.display = 'none';
  const tl = document.getElementById('sched-timeline');
  if (!tl) return;
  const rect = tl.getBoundingClientRect();
  const rawPx = e.clientX - rect.left;

  if (_schedDragBcId === '__break__') {
    const dur = SCHED_SNAP;
    const sec = _schedClamp(_schedToSec(rawPx), dur);
    _schedItems.push({
      broadcast_id:       null,
      broadcast_name:     'Commercial Break',
      broadcast_category: 'commercial',
      slot_type:          'commercial_break',
      start_time:         sec,
      duration:           dur,
      duration_override:  null,
      npc_staff:          [],
    });
  } else if (_schedDragBcId != null) {
    const bc  = _schedBroadcasts.find(b => b.id === _schedDragBcId);
    if (!bc) return;
    const dur = bc.override_duration || ((Array.isArray(bc.messages) ? bc.messages.length : 0) * (bc.message_interval || 5)) || 3600;
    const sec = _schedClamp(_schedToSec(rawPx), dur);
    _schedItems.push({
      broadcast_id:       bc.id,
      broadcast_name:     bc.name,
      broadcast_category: bc.category || 'general',
      slot_type:          'broadcast',
      start_time:         sec,
      duration:           dur,
      duration_override:  null,
      npc_staff:          [],
    });
  } else if (_schedDragIdx != null) {
    const item = _schedItems[_schedDragIdx];
    item.start_time = _schedClamp(_schedToSec(rawPx - _schedDragOffset), item.duration);
  }

  _schedDragBcId   = null;
  _schedDragIdx    = null;
  _schedDragOffset = 0;
  _schedMarkDirty();
  _schedRenderTimeline();
}

// ── Resize ───────────────────────────────────────────────────────────────────

function _schedResizeStart(e, idx) {
  e.stopPropagation();
  e.preventDefault();
  _schedResizeIdx      = idx;
  _schedResizeStartX   = e.clientX;
  _schedResizeStartDur = _schedItems[idx].duration;
}

function _schedOnMouseMove(e) {
  if (_schedResizeIdx == null) return;
  const dx  = e.clientX - _schedResizeStartX;
  const dur = Math.max(SCHED_SNAP, _schedToSec(_schedResizeStartDur * _schedScale() + dx));
  const item = _schedItems[_schedResizeIdx];
  item.duration          = dur;
  item.duration_override = dur;
  _schedMarkDirty();
  _schedRenderTimeline();
}

function _schedOnMouseUp() {
  _schedResizeIdx = null;
}

// ── Partial re-render (timeline only, preserves scroll) ───────────────────────

function _schedRenderTimeline() {
  const tl = document.getElementById('sched-timeline');
  if (!tl) { _schedRenderContent(); return; }

  let items = '';
  _schedItems.forEach((item, idx) => {
    const x   = _schedToX(item.start_time);
    const iw  = Math.max(12, _schedToX(item.duration));
    const col = SCHED_CAT_COLOR[item.broadcast_category] || 'var(--text-dim)';

    if (item.slot_type === 'commercial_break') {
      items += `
        <div class="bc-break-slot" draggable="true"
          ondragstart="_schedItemDragStart(event,${idx})"
          onclick="_schedOpenPopover(event,${idx})"
          style="left:${x}px;width:${iw}px;">
          <span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">⏸ BREAK</span>
          <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
            style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:var(--border);opacity:0.8"></div>
        </div>`;
      return;
    }

    const staffChips = item.npc_staff.map(id => {
      const npc = _schedNpcs.find(n => n.id === id);
      const initials = (npc?.name || id).slice(0, 2).toUpperCase();
      return `<span class="bc-chip">${initials}</span>`;
    }).join('');
    items += `
      <div class="sched-item" draggable="true"
        ondragstart="_schedItemDragStart(event,${idx})"
        onclick="_schedOpenPopover(event,${idx})"
        style="position:absolute;left:${x}px;width:${iw}px;height:${SCHED_H}px;top:0;
               background:color-mix(in srgb,${col} 18%,var(--bg2));
               border:1px solid ${col};border-radius:2px;box-sizing:border-box;
               overflow:hidden;cursor:grab;user-select:none">
        <div style="padding:3px 5px;font-size:10px;font-weight:600;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.broadcast_name)}</div>
        <div class="bc-meta" style="padding:0 5px">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
        <div style="padding:2px 4px;display:flex;gap:2px;flex-wrap:wrap">${staffChips}</div>
        <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
          style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:${col};opacity:0.5"></div>
      </div>`;
  });

  const w = _schedW();
  tl.style.width = w + 'px';
  tl.innerHTML = '<div id="sched-drop-line"></div><div id="sched-now-line" style="position:absolute;top:0;bottom:0;width:2px;background:var(--accent);opacity:0.7;pointer-events:none;z-index:5"></div>' + items;
  _schedUpdateNowLine();
}

// ── Popover (click a block) ───────────────────────────────────────────────────

function _schedOpenPopover(e, idx) {
  e.stopPropagation();
  _schedClosePopover();
  _schedPopoverIdx = idx;
  const item = _schedItems[idx];

  // Auto-seed npc_staff from npc_anchor nodes in the broadcast graph
  if (item.broadcast_id) {
    const bc = _schedBroadcasts.find(b => b.id === item.broadcast_id);
    if (bc?.broadcast_graph?.nodes) {
      for (const node of Object.values(bc.broadcast_graph.nodes)) {
        if (node.type === 'npc_anchor' && node.npc_id && !item.npc_staff.includes(node.npc_id))
          item.npc_staff.push(node.npc_id);
      }
    }
  }

  const npcCheckboxes = _schedNpcs.map(n => {
    const checked = item.npc_staff.includes(n.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;padding:2px 0">
      <input type="checkbox" value="${n.id}" ${checked} onchange="_schedToggleNpc(${idx},this.value,this.checked)">
      ${escHtml(n.name)} <span style="font-size:9px;color:var(--text-dim)">${n.id}</span>
    </label>`;
  }).join('');

  const pop = document.createElement('div');
  pop.id = 'sched-popover';
  pop.style.cssText = `position:fixed;z-index:600;background:var(--bg2);border:1px solid var(--accent);border-radius:3px;padding:12px;width:260px;box-shadow:0 4px 16px rgba(0,0,0,0.5)`;
  pop.style.left = Math.min(e.clientX, window.innerWidth - 280) + 'px';
  pop.style.top  = Math.min(e.clientY + 8, window.innerHeight - 300) + 'px';
  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:11px;font-weight:600;color:var(--accent)">${escHtml(item.broadcast_name)}</span>
      <button onclick="_schedClosePopover()" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:13px;padding:0">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
      <div>
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:2px">Start</label>
        <input id="sched-pop-start" class="form-input" value="${_schedFmtTime(item.start_time)}" placeholder="HH:MM"
          onchange="_schedPopSetStart(${idx},this.value)" style="font-size:11px">
      </div>
      <div>
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:2px">Duration (min)</label>
        <input id="sched-pop-dur" type="number" class="form-input" value="${Math.round(item.duration / 60)}" min="1"
          onchange="_schedPopSetDur(${idx},this.value)" style="font-size:11px">
      </div>
    </div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">NPC Staff</div>
    <div style="max-height:120px;overflow-y:auto;margin-bottom:8px">
      ${npcCheckboxes || '<div style="font-size:11px;color:var(--text-dim)">No NPCs in DB</div>'}
    </div>
    <button class="action-btn danger" style="width:100%;font-size:11px" onclick="_schedDeleteItem(${idx})">Remove from schedule</button>`;

  document.body.appendChild(pop);
  document.addEventListener('click', _schedPopoverOutsideClick);
}

function _schedClosePopover() {
  document.getElementById('sched-popover')?.remove();
  document.removeEventListener('click', _schedPopoverOutsideClick);
  _schedPopoverIdx = null;
}

function _schedPopoverOutsideClick(e) {
  const pop = document.getElementById('sched-popover');
  if (pop && !pop.contains(e.target)) _schedClosePopover();
}

function _schedPopSetStart(idx, val) {
  const [h, m] = val.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return;
  _schedItems[idx].start_time = _schedClamp(h * 3600 + m * 60, _schedItems[idx].duration);
  _schedMarkDirty();
  _schedRenderTimeline();
}

function _schedPopSetDur(idx, val) {
  const dur = Math.max(60, parseInt(val) * 60);
  _schedItems[idx].duration          = dur;
  _schedItems[idx].duration_override = dur;
  _schedMarkDirty();
  _schedRenderTimeline();
}

function _schedToggleNpc(idx, npcId, checked) {
  const staff = _schedItems[idx].npc_staff;
  if (checked && !staff.includes(npcId)) staff.push(npcId);
  if (!checked) _schedItems[idx].npc_staff = staff.filter(id => id !== npcId);
  _schedMarkDirty();
  _schedRenderTimeline();
}

function _schedDeleteItem(idx) {
  _schedItems.splice(idx, 1);
  _schedMarkDirty();
  _schedClosePopover();
  _schedRenderTimeline();
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function _schedSave() {
  if (!_schedChannelId) return;
  const payload = _schedItems.map(item => ({
    broadcast_id:      item.broadcast_id,
    start_time:        item.start_time,
    duration_override: item.duration_override,
    slot_type:         item.slot_type || 'broadcast',
    conditions:        item.npc_staff.length ? { npc_staff: item.npc_staff } : [],
  }));
  try {
    const res = await directAPI(`/broadcast/channels/${_schedChannelId}/playlist`, 'PUT', payload);
    if (res?.error) { toast(res.error, true); return; }
    _schedDirty = false;
    _schedUpdateSaveBtn();
  } catch (err) { toast(err.message, true); }
}
