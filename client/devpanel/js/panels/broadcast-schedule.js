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

const SCHED_PX_PER_HOUR = 52;                        // px per game hour
const SCHED_SCALE       = SCHED_PX_PER_HOUR / 3600;  // px per second
const SCHED_SNAP        = 1800;                       // snap to 30-minute increments
const SCHED_W           = SCHED_PX_PER_HOUR * 24;    // 1248px total
const SCHED_H           = 72;                         // px height of timeline

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

function _schedToX(sec)  { return sec * SCHED_SCALE; }
function _schedToSec(px) { return Math.round((px / SCHED_SCALE) / SCHED_SNAP) * SCHED_SNAP; }
function _schedClamp(sec, dur) { return Math.max(0, Math.min(86400 - (dur || SCHED_SNAP), sec)); }

function _schedFmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── Panel entry ──────────────────────────────────────────────────────────────

async function renderSchedulePanel(data) {
  const panel = document.getElementById('list-panel');
  panel.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:12px">Loading schedule…</div>';

  _schedChannels   = Array.isArray(data?.channels)   ? data.channels   : [];
  _schedBroadcasts = Array.isArray(data?.broadcasts) ? data.broadcasts : [];
  _schedNpcs       = Array.isArray(data?.npcs)       ? data.npcs       : [];

  if (!_schedChannelId && _schedChannels.length) _schedChannelId = _schedChannels[0].id;

  await _schedLoadItems();
  _schedRender();

  // Global mouse handlers for resize
  document.addEventListener('mousemove', _schedOnMouseMove);
  document.addEventListener('mouseup',   _schedOnMouseUp);
}

async function _schedLoadItems() {
  if (!_schedChannelId) { _schedItems = []; return; }
  try {
    const ch = await directAPI(`/broadcast/channels/${_schedChannelId}`, 'GET');
    const pl = Array.isArray(ch?.playlist) ? ch.playlist : [];
    _schedItems = pl.map(item => {
      const bc = _schedBroadcasts.find(b => b.id === item.broadcast_id) || {};
      const dur = item.duration_override
        || bc.override_duration
        || ((Array.isArray(bc.messages) ? bc.messages.length : 0) * (bc.message_interval || 5))
        || 3600;
      const cond = item.conditions ? (typeof item.conditions === 'string' ? JSON.parse(item.conditions) : item.conditions) : {};
      return {
        broadcast_id:      item.broadcast_id,
        broadcast_name:    bc.name || item.broadcast_id,
        broadcast_category: bc.category || 'general',
        start_time:        item.start_time || 0,
        duration:          dur,
        duration_override: item.duration_override || null,
        npc_staff:         Array.isArray(cond.npc_staff) ? cond.npc_staff : [],
      };
    });
  } catch { _schedItems = []; }
}

// ── Main render ──────────────────────────────────────────────────────────────

function _schedRender() {
  const panel = document.getElementById('list-panel');
  const ch = _schedChannels.find(c => c.id === _schedChannelId);
  const isDaily = ch?.schedule_mode === 'daily';

  const chOptions = _schedChannels.map(c =>
    `<option value="${c.id}" ${c.id === _schedChannelId ? 'selected' : ''}>${escHtml(c.name)} (ch ${c.number})</option>`
  ).join('');

  const libRows = _schedBroadcasts.map(b => {
    const dur = b.override_duration || ((Array.isArray(b.messages) ? b.messages.length : 0) * (b.message_interval || 5)) || 3600;
    const col = SCHED_CAT_COLOR[b.category] || 'var(--text-dim)';
    return `<div class="sched-lib-item" draggable="true"
      ondragstart="_schedLibDragStart(event,'${b.id}')"
      style="padding:5px 8px;border-left:3px solid ${col};background:var(--bg3);border-radius:2px;cursor:grab;margin-bottom:3px">
      <div style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(b.name)}</div>
      <div style="font-size:10px;color:var(--text-dim)">${_schedFmtDur(dur)}</div>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;gap:0">

      <!-- Toolbar -->
      <div style="padding:8px 12px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0">
        <select id="sched-ch-sel" class="form-input" style="width:200px" onchange="_schedSwitchChannel(this.value)">${chOptions}</select>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);cursor:pointer">
          <input type="checkbox" id="sched-daily-toggle" ${isDaily ? 'checked' : ''} onchange="_schedToggleMode(this.checked)">
          Daily schedule mode
        </label>
        <span style="font-size:11px;color:var(--text-dim)">${isDaily ? 'start_time = seconds from midnight' : 'Loop mode — use Channels panel to manage'}</span>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="action-btn" onclick="bcImportBsm()" title="Import a .bsm file and place it on the timeline">↑ Import .bsm</button>
          <button class="action-btn primary" onclick="_schedSave()">Save Schedule</button>
        </div>
      </div>

      <!-- Body: library + timeline -->
      <div style="display:flex;flex:1;overflow:hidden">

        <!-- Library pane -->
        <div style="width:200px;flex-shrink:0;border-right:1px solid var(--border);padding:8px;overflow-y:auto;background:var(--bg)">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px">Broadcasts</div>
          ${libRows || '<div style="color:var(--text-dim);font-size:11px">No broadcasts</div>'}
        </div>

        <!-- Timeline pane -->
        <div style="flex:1;overflow:auto;padding:12px">
          ${!isDaily ? `<div style="padding:24px;color:var(--text-dim);font-size:12px">Enable <strong>Daily schedule mode</strong> above to use the 24-hour timeline editor.</div>` : _schedBuildTimeline()}
        </div>

      </div>
    </div>`;

  _schedClosePopover();
}

function _schedBuildTimeline() {
  // Ruler
  let ruler = `<div style="position:relative;width:${SCHED_W}px;height:24px;flex-shrink:0;border-bottom:1px solid var(--border);margin-bottom:2px">`;
  for (let h = 0; h < 24; h++) {
    const x = _schedToX(h * 3600);
    ruler += `<div style="position:absolute;left:${x}px;top:0;height:100%;border-left:1px solid var(--border);padding-left:3px;font-size:10px;color:var(--text-dim);line-height:24px">${String(h).padStart(2,'0')}:00</div>`;
  }
  ruler += '</div>';

  // Items
  let items = '';
  _schedItems.forEach((item, idx) => {
    const x   = _schedToX(item.start_time);
    const w   = Math.max(12, _schedToX(item.duration));
    const col = SCHED_CAT_COLOR[item.broadcast_category] || 'var(--text-dim)';
    const staffChips = item.npc_staff.map(id => {
      const npc = _schedNpcs.find(n => n.id === id);
      const initials = (npc?.name || id).slice(0, 2).toUpperCase();
      return `<span style="background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:0 3px;font-size:9px;color:var(--text-dim)">${initials}</span>`;
    }).join('');
    items += `
      <div class="sched-item" draggable="true"
        ondragstart="_schedItemDragStart(event,${idx})"
        onclick="_schedOpenPopover(event,${idx})"
        style="position:absolute;left:${x}px;width:${w}px;height:${SCHED_H}px;top:0;
               background:color-mix(in srgb,${col} 18%,var(--bg2));
               border:1px solid ${col};border-radius:2px;box-sizing:border-box;
               overflow:hidden;cursor:grab;user-select:none">
        <div style="padding:3px 5px;font-size:10px;font-weight:600;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.broadcast_name)}</div>
        <div style="padding:0 5px;font-size:9px;color:var(--text-dim)">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
        <div style="padding:2px 4px;display:flex;gap:2px;flex-wrap:wrap">${staffChips}</div>
        <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
          style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:${col};opacity:0.5"></div>
      </div>`;
  });

  return `
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Drag broadcasts from the library onto the timeline. Snap: 30 min. Click a block to edit.</div>
    <div style="overflow-x:auto">
      <div style="width:${SCHED_W}px">
        ${ruler}
        <div id="sched-timeline" style="position:relative;width:${SCHED_W}px;height:${SCHED_H}px;background:var(--bg3);border:1px solid var(--border);border-radius:2px"
          ondragover="event.preventDefault()"
          ondrop="_schedTlDrop(event)">
          ${items}
        </div>
      </div>
    </div>`;
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
  _schedRender();
}

async function _schedToggleMode(daily) {
  if (!_schedChannelId) return;
  try {
    const res = await directAPI(`/broadcast/channels/${_schedChannelId}`, 'PUT', { schedule_mode: daily ? 'daily' : 'loop' });
    if (res?.error) { toast(res.error, true); return; }
    const ch = _schedChannels.find(c => c.id === _schedChannelId);
    if (ch) ch.schedule_mode = daily ? 'daily' : 'loop';
    _schedRender();
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
    _schedDragOffset = (e.clientX - rect.left) / SCHED_SCALE - item.start_time;
  }
  e.dataTransfer.effectAllowed = 'move';
  e.stopPropagation();
}

function _schedTlDrop(e) {
  e.preventDefault();
  const tl = document.getElementById('sched-timeline');
  if (!tl) return;
  const rect = tl.getBoundingClientRect();
  const rawSec = (e.clientX - rect.left) / SCHED_SCALE;

  if (_schedDragBcId != null) {
    const bc  = _schedBroadcasts.find(b => b.id === _schedDragBcId);
    if (!bc) return;
    const dur = bc.override_duration || ((Array.isArray(bc.messages) ? bc.messages.length : 0) * (bc.message_interval || 5)) || 3600;
    const sec = _schedClamp(_schedToSec(rawSec), dur);
    _schedItems.push({
      broadcast_id:       bc.id,
      broadcast_name:     bc.name,
      broadcast_category: bc.category || 'general',
      start_time:         sec,
      duration:           dur,
      duration_override:  null,
      npc_staff:          [],
    });
  } else if (_schedDragIdx != null) {
    const item = _schedItems[_schedDragIdx];
    item.start_time = _schedClamp(_schedToSec(rawSec - _schedDragOffset * SCHED_SCALE), item.duration);
  }

  _schedDragBcId   = null;
  _schedDragIdx    = null;
  _schedDragOffset = 0;
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
  const dur = Math.max(SCHED_SNAP, _schedToSec(_schedResizeStartDur * SCHED_SCALE + dx));
  const item = _schedItems[_schedResizeIdx];
  item.duration          = dur;
  item.duration_override = dur;
  _schedRenderTimeline();
}

function _schedOnMouseUp() {
  _schedResizeIdx = null;
}

// ── Partial re-render (timeline only, preserves scroll) ───────────────────────

function _schedRenderTimeline() {
  const tl = document.getElementById('sched-timeline');
  if (!tl) { _schedRender(); return; }

  let items = '';
  _schedItems.forEach((item, idx) => {
    const x   = _schedToX(item.start_time);
    const w   = Math.max(12, _schedToX(item.duration));
    const col = SCHED_CAT_COLOR[item.broadcast_category] || 'var(--text-dim)';
    const staffChips = item.npc_staff.map(id => {
      const npc = _schedNpcs.find(n => n.id === id);
      const initials = (npc?.name || id).slice(0, 2).toUpperCase();
      return `<span style="background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:0 3px;font-size:9px;color:var(--text-dim)">${initials}</span>`;
    }).join('');
    items += `
      <div class="sched-item" draggable="true"
        ondragstart="_schedItemDragStart(event,${idx})"
        onclick="_schedOpenPopover(event,${idx})"
        style="position:absolute;left:${x}px;width:${w}px;height:${SCHED_H}px;top:0;
               background:color-mix(in srgb,${col} 18%,var(--bg2));
               border:1px solid ${col};border-radius:2px;box-sizing:border-box;
               overflow:hidden;cursor:grab;user-select:none">
        <div style="padding:3px 5px;font-size:10px;font-weight:600;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.broadcast_name)}</div>
        <div style="padding:0 5px;font-size:9px;color:var(--text-dim)">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
        <div style="padding:2px 4px;display:flex;gap:2px;flex-wrap:wrap">${staffChips}</div>
        <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
          style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:${col};opacity:0.5"></div>
      </div>`;
  });

  tl.innerHTML = items;
}

// ── Popover (click a block) ───────────────────────────────────────────────────

function _schedOpenPopover(e, idx) {
  e.stopPropagation();
  _schedClosePopover();
  _schedPopoverIdx = idx;
  const item = _schedItems[idx];

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
  _schedRenderTimeline();
}

function _schedPopSetDur(idx, val) {
  const dur = Math.max(60, parseInt(val) * 60);
  _schedItems[idx].duration          = dur;
  _schedItems[idx].duration_override = dur;
  _schedRenderTimeline();
}

function _schedToggleNpc(idx, npcId, checked) {
  const staff = _schedItems[idx].npc_staff;
  if (checked && !staff.includes(npcId)) staff.push(npcId);
  if (!checked) _schedItems[idx].npc_staff = staff.filter(id => id !== npcId);
  _schedRenderTimeline();
}

function _schedDeleteItem(idx) {
  _schedItems.splice(idx, 1);
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
    conditions:        item.npc_staff.length ? { npc_staff: item.npc_staff } : [],
  }));
  try {
    const res = await directAPI(`/broadcast/channels/${_schedChannelId}/playlist`, 'PUT', payload);
    if (res?.error) { toast(res.error, true); return; }
    toast('Schedule saved.');
  } catch (err) { toast(err.message, true); }
}
