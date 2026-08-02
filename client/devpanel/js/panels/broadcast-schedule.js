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

// Channel 0 is the VCR input on the back of the set, not a station: every deck in
// the world points at that one row, so it has no timetable to author. It's listed
// so an author can see it exists, and refuses the timeline when picked.
function _schedIsDeckInput(ch) { return Number(ch?.number) === 0; }

// ── Day scope ────────────────────────────────────────────────────────────────
// There is ONE schedule. `days` is a 7-bit mask on each slot (bit 0 = Mon … bit 6
// = Sun); 127 = every day, the default. The day bar picks which slice of that one
// schedule you're editing:
//   • Every day (_schedDay = 0) — the base grid that repeats seven days a week.
//   • A weekday (_schedDay = 1..7) — that day's EXCEPTIONS, drawn on the SAME row as
//     a ghosted, read-only copy of the base grid, sitting on top of the block each
//     one replaces. One row, because two lanes made you read the same hour twice.
// Dropping a show while a weekday is selected creates a slot restricted to that day,
// and the server picks the most specific slot covering any given second — so an
// override needs no gap cut in the base grid underneath it.
const SCHED_DAYS_ALL  = 127;
const SCHED_DAY_ABBR  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let   _schedDay       = 0;

function _schedDayMask(days) {
  const n = Number(days);
  return Number.isFinite(n) && (n & SCHED_DAYS_ALL) ? (n & SCHED_DAYS_ALL) : SCHED_DAYS_ALL;
}
function _schedDayBit(dow)      { return 1 << (dow - 1); }
function _schedIsEveryDay(item) { return _schedDayMask(item.days) === SCHED_DAYS_ALL; }
function _schedDayLabel(days) {
  const m = _schedDayMask(days);
  if (m === SCHED_DAYS_ALL) return '';
  return SCHED_DAY_ABBR.filter((_, i) => m & (1 << i)).join(',');
}
// The mask a slot created in the current scope should carry.
function _schedScopeMask() { return _schedDay === 0 ? SCHED_DAYS_ALL : _schedDayBit(_schedDay); }
// Does this slot belong on the editable lane in the current scope?
function _schedInScope(item) {
  return _schedDay === 0
    ? _schedIsEveryDay(item)
    : (!_schedIsEveryDay(item) && (_schedDayMask(item.days) & _schedDayBit(_schedDay)));
}
// …and on the ghosted base lane behind it? (Only ever while a weekday is selected.)
function _schedIsGhost(item) { return _schedDay !== 0 && _schedIsEveryDay(item); }

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
        id:                item.id,
        broadcast_id:      item.broadcast_id,
        broadcast_name:    isBreak ? 'Commercial Break' : (bc.name || item.broadcast_id),
        broadcast_category: isBreak ? 'commercial' : (bc.category || 'general'),
        slot_type:         item.slot_type || 'broadcast',
        start_time:        item.start_time || 0,
        duration:          dur,
        duration_override: item.duration_override || null,
        days:              _schedDayMask(item.days),
        npc_staff:         Array.isArray(cond.npc_staff) ? cond.npc_staff : [],
      };
    });
  } catch { _schedItems = []; }

  // Replace scheduled slots with ghost blocks for cassettes that have been ejected from the deck.
  try {
    const ejected = await directAPI(`/broadcast/channels/${_schedChannelId}/ejected-slots`, 'GET');
    if (Array.isArray(ejected) && ejected.length) {
      const ejectedIds = new Set(ejected.map(s => s.broadcast_id));
      _schedItems = _schedItems.filter(item => !ejectedIds.has(item.broadcast_id));
      for (const slot of ejected) {
        const bc = _schedBroadcasts.find(b => b.id === slot.broadcast_id) || {};
        const dur = slot.duration_override
          || bc.override_duration
          || ((Array.isArray(bc.messages) ? bc.messages.length : 0) * (bc.message_interval || 5))
          || 3600;
        _schedItems.push({
          broadcast_id:       slot.broadcast_id,
          broadcast_name:     slot.broadcast_name || bc.name || slot.broadcast_id,
          broadcast_category: slot.broadcast_category || bc.category || 'general',
          slot_type:          slot.slot_type || 'broadcast',
          start_time:         slot.start_time || 0,
          duration:           dur,
          duration_override:  slot.duration_override || null,
          days:               _schedDayMask(slot.days),
          npc_staff:          [],
          missing_cassette:   true,
          deck_id:            slot.deck_id || null,
        });
      }
    }
  } catch {}

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

async function _schedUpdateNowLine() {
  const line = document.getElementById('sched-now-line');
  if (!line) return;
  try {
    const state = await directAPI('/environment/state', 'GET');
    // state.time is "HH:MM" (from getHUDPayload); minutes field is not exposed
    const [h, m] = (state.time || '0:0').split(':').map(Number);
    const sec = (h || 0) * 3600 + (m || 0) * 60;
    line.style.left = _schedToX(sec) + 'px';
  } catch (_) {}
}

// ── Sidebar render ────────────────────────────────────────────────────────────

function _schedRenderSidebar() {
  const el = document.getElementById('sched-sidebar');
  if (!el) return;

  const items = _schedChannels.map(ch => {
    const sel   = ch.id === _schedChannelId;
    const input = _schedIsDeckInput(ch);
    return `<div onclick="_schedSwitchChannel('${ch.id}')"
      style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);
             background:${sel ? 'var(--bg3)' : 'transparent'};
             border-left:3px solid ${sel ? 'var(--accent)' : 'transparent'}">
      <div style="font-size:12px;font-weight:600;color:var(--text-bright)">
        <span style="color:var(--text-dim);font-size:10px">Ch ${ch.number || '?'} </span>${escHtml(ch.name)}
      </div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px;display:flex;gap:6px">
        <span>${input ? 'deck input' : (ch.channel_type || 'playlist')}</span>
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

  // Channel 0 isn't a station — every VCR in the world is plugged into this one row,
  // so there is nothing here to schedule. Say so rather than offering a timeline that
  // would drive every deck in Coldwater in lockstep.
  if (_schedIsDeckInput(ch)) {
    el.innerHTML = `
      <div style="padding:32px;max-width:520px">
        <div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:8px">${escHtml(ch.name)} — deck input</div>
        <div style="font-size:12px;color:var(--text-dim);line-height:1.6">
          Channel 0 is not a station. It's the input on the back of the set that whatever
          deck is under it is plugged into, and <strong>every VCR in the world shares this
          one row</strong> — so it carries no schedule. A deck plays the cassette somebody
          put in it, and answers to no timetable.
        </div>
      </div>`;
    return;
  }

  // Auto-fit timeline to available width so 24 hours fills the panel
  const availW = el.clientWidth - 32;
  if (availW > 200) _schedPxPerHour = Math.floor(availW / 24);

  // Auto-minted surveillance-clip broadcasts (bc_clip_*/category surveillance)
  // aren't schedulable programming — collapse them out of the library drawer.
  const libRows = _schedBroadcasts.filter(b => !_bcIsClip(b)).map(b => {
    const dur = b.override_duration || ((Array.isArray(b.messages) ? b.messages.length : 0) * (b.message_interval || 5)) || 3600;
    const col = SCHED_CAT_COLOR[b.category] || 'var(--text-dim)';
    return `<div class="bc-lib-item" draggable="true"
      ondragstart="_schedLibDragStart(event,'${b.id}')"
      style="border-left:3px solid ${col}">
      <div class="bc-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${escHtml(b.name)}</div>
      <div class="bc-meta">${_schedFmtDur(dur)}</div>
    </div>`;
  }).join('');

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
        <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
          <div style="display:flex;align-items:center;gap:4px">
            <button class="action-btn" style="padding:2px 7px" onclick="_schedZoom(-16)" title="Zoom out">−</button>
            <span id="sched-zoom-label" class="bc-meta" style="min-width:58px;text-align:center">${_schedZoomLabel()}</span>
            <button class="action-btn" style="padding:2px 7px" onclick="_schedZoom(16)" title="Zoom in">+</button>
          </div>
          <button class="action-btn" onclick="bcImportBsm()" title="Import a .bsm file">↑ BSM</button>
          <button class="action-btn danger" onclick="_schedClear()" title="Remove all items from schedule">Clear</button>
          <button class="action-btn" onclick="_schedAutoScheduleOpen()" title="Fill a time block from available programs and commercials">Auto-schedule</button>
          <button class="action-btn primary" onclick="_schedSave()">Save Schedule</button>
        </div>
      </div>

      <!-- Timeline area -->
      <div style="flex:1;overflow:auto;padding:16px">
        ${_schedBuildDayBar()}
        <div class="bc-meta" style="margin-bottom:8px">${_schedScopeHint()}</div>
        ${_schedBuildTimeline()}
      </div>

      <!-- Library drawer -->
      <div style="border-top:1px solid var(--border);padding:8px 12px;background:var(--bg2);flex-shrink:0">
        <div class="bc-label" style="margin-bottom:6px">Broadcast Library</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow-y:auto">
          ${libRows || '<div class="bc-meta">No broadcasts</div>'}
        </div>
      </div>

    </div>`;

  _schedClosePopover();
  setTimeout(_schedUpdateNowLine, 0);
  if (!_schedNowTimer) _schedNowTimer = setInterval(_schedUpdateNowLine, 10000);
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
    // One scheduling model: the seven-day grid. The server pins this too.
    schedule_mode: 'daily',
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

// ── Day bar ──────────────────────────────────────────────────────────────────
// The whole point of the merge, made visible: one tab for the base grid that
// repeats all week, then one per weekday carrying a count of that day's
// exceptions. A day with no exceptions plays the base grid, and its tab says so.
function _schedBuildDayBar() {
  const counts = new Array(8).fill(0);
  let base = 0;
  for (const item of _schedItems) {
    if (_schedIsEveryDay(item)) { base++; continue; }
    const m = _schedDayMask(item.days);
    for (let d = 1; d <= 7; d++) if (m & _schedDayBit(d)) counts[d]++;
  }
  const tab = (d, label, count, sub) => {
    const sel = _schedDay === d;
    return `<button onclick="_schedSetDay(${d})"
      style="padding:4px 10px;font-size:11px;cursor:pointer;border:1px solid ${sel ? 'var(--accent)' : 'var(--border)'};
             border-radius:2px;background:${sel ? 'var(--accent)' : 'var(--bg2)'};
             color:${sel ? 'var(--bg)' : 'var(--text)'};font-weight:${sel ? 700 : 400};display:flex;
             flex-direction:column;align-items:center;line-height:1.25;min-width:52px">
      <span>${label}</span>
      <span style="font-size:9px;opacity:0.75">${count ? sub : '—'}</span>
    </button>`;
  };
  const dayTabs = SCHED_DAY_ABBR
    .map((abbr, i) => tab(i + 1, abbr, counts[i + 1], `${counts[i + 1]} override${counts[i + 1] === 1 ? '' : 's'}`))
    .join('');
  return `
    <div style="display:flex;gap:4px;align-items:stretch;margin-bottom:8px;flex-wrap:wrap">
      ${tab(0, 'Every day', base, `${base} slot${base === 1 ? '' : 's'}`)}
      <div style="width:1px;background:var(--border);margin:0 4px"></div>
      ${dayTabs}
    </div>`;
}

function _schedScopeHint() {
  if (_schedDay === 0) {
    return 'Editing the <strong>every-day grid</strong> — these slots play all seven days. '
         + 'Drag from the library to add, click a block to edit. Snap: 30 min. '
         + 'Pick a weekday above to change just that day.';
  }
  const d = SCHED_DAY_ABBR[_schedDay - 1];
  return `Editing <strong>${d} only</strong>. Anything you drop here airs on ${d} instead of the `
       + `dashed every-day block underneath it — the grid itself is untouched, and the other six days keep playing it.`;
}

async function _schedSetDay(d) {
  if (_schedDay === d) return;
  // The whole channel's slots live in _schedItems regardless of scope, so an unsaved
  // edit survives a scope switch — but a confused author shouldn't have to know that.
  _schedDay = d;
  _schedClosePopover();
  _schedRenderContent();
}

// Lift an every-day block onto the selected weekday as an editable override, then
// open it. The base slot is untouched — the copy just wins on this one day.
function _schedOverrideGhost(idx) {
  if (_schedDay === 0) return;
  const src = _schedItems[idx];
  if (!src || src.missing_cassette) return;
  const covered = _schedItems.some(o => _schedInScope(o) &&
    o.start_time < src.start_time + src.duration && o.start_time + o.duration > src.start_time);
  if (covered) { toast(`Already overridden on ${SCHED_DAY_ABBR[_schedDay - 1]} at this time.`, true); return; }
  _schedItems.push({
    ...src,
    id: null,                                  // a new row, not a move of the base slot
    days: _schedDayBit(_schedDay),
    npc_staff: [...(src.npc_staff || [])],
  });
  _schedMarkDirty();
  _schedRenderContent();
}

// One block on the editable lane. Shared by the full build and the partial
// re-render so the two can never drift apart.
function _schedItemHtml(item, idx) {
  const x   = _schedToX(item.start_time);
  const iw  = Math.max(12, _schedToX(item.duration));
  const col = SCHED_CAT_COLOR[item.broadcast_category] || 'var(--text-dim)';

  if (item.slot_type === 'commercial_break') {
    return `
      <div class="bc-break-slot" draggable="true"
        ondragstart="_schedItemDragStart(event,${idx})"
        onclick="_schedOpenPopover(event,${idx})"
        style="left:${x}px;width:${iw}px;z-index:2;">
        <span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">⏸ BREAK</span>
        <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
          style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:var(--border);opacity:0.8"></div>
      </div>`;
  }

  if (item.missing_cassette) {
    return `
      <div title="No cassette loaded — nothing scheduled here"
        style="position:absolute;left:${x}px;width:${iw}px;height:${SCHED_H}px;top:0;z-index:2;
                  background:repeating-linear-gradient(135deg,var(--bg3) 0,var(--bg3) 6px,var(--bg2) 6px,var(--bg2) 12px);
                  border:1px dashed var(--border);border-radius:2px;box-sizing:border-box;
                  overflow:hidden;opacity:0.7">
        <div style="padding:3px 5px;font-size:10px;font-weight:600;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">⚠ ${escHtml(item.broadcast_name)}</div>
        <div class="bc-meta" style="padding:0 5px">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
        <div style="padding:0 5px;font-size:9px;color:var(--red);letter-spacing:1px;text-transform:uppercase">NO CASSETTE</div>
        <div title="Discard this ghost slot" onclick="_schedRemoveEjected(${idx})"
          style="position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:15px;text-align:center;
                 font-size:11px;color:var(--red);cursor:pointer;border:1px solid var(--border);border-radius:2px;
                 background:var(--bg2)">✕</div>
      </div>`;
  }

  const staffChips = item.npc_staff.map(id => {
    const npc = _schedNpcs.find(n => n.id === id);
    const initials = (npc?.name || id).slice(0, 2).toUpperCase();
    return `<span class="bc-chip">${initials}</span>`;
  }).join('');
  // A day badge only appears when the slot isn't everyday — on the "Every day" scope
  // you'll never see one, so its presence always means "this is an exception".
  const dayTag = _schedDayLabel(item.days);
  const dayBadge = dayTag
    ? `<span style="font-size:8px;letter-spacing:0.5px;text-transform:uppercase;color:var(--bg);background:${col};border-radius:2px;padding:0 3px;margin-left:4px">${dayTag}</span>`
    : '';
  return `
    <div class="sched-item" draggable="true"
      ondragstart="_schedItemDragStart(event,${idx})"
      onclick="_schedOpenPopover(event,${idx})"
      style="position:absolute;left:${x}px;width:${iw}px;height:${SCHED_H}px;top:0;z-index:2;
             background:color-mix(in srgb,${col} 18%,var(--bg2));
             border:1px solid ${col};border-radius:2px;box-sizing:border-box;
             overflow:hidden;cursor:grab;user-select:none">
      <div style="padding:3px 5px;font-size:10px;font-weight:600;color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.broadcast_name)}${dayBadge}</div>
      <div class="bc-meta" style="padding:0 5px">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
      <div style="padding:2px 4px;display:flex;gap:2px;flex-wrap:wrap">${staffChips}</div>
      <div class="sched-resize-handle" onmousedown="_schedResizeStart(event,${idx})"
        style="position:absolute;right:0;top:0;width:6px;height:100%;cursor:ew-resize;background:${col};opacity:0.5"></div>
    </div>`;
}

// A read-only every-day block, drawn on the SAME row as the weekday's overrides and
// underneath them (z-index 1 vs 2). What airs on this day unless an override sits on
// top. Click an exposed one to lift a copy onto this day as an editable override.
//
// Deliberately NOT draggable and never a drop target of its own: dragover/drop bubble
// up to #sched-timeline, which reads clientX, so a drop that lands on a ghost means
// "new override here" rather than "move the base grid".
function _schedGhostHtml(item, idx) {
  const x   = _schedToX(item.start_time);
  const iw  = Math.max(12, _schedToX(item.duration));
  const col = SCHED_CAT_COLOR[item.broadcast_category] || 'var(--text-dim)';
  const covered = _schedItems.some(o => _schedInScope(o) &&
    o.start_time < item.start_time + item.duration && o.start_time + o.duration > item.start_time);
  const name = item.slot_type === 'commercial_break' ? '⏸ Break' : item.broadcast_name;
  return `
    <div onclick="_schedOverrideGhost(${idx})"
      title="${covered ? 'Replaced on this day by the override on top of it.' : 'From the every-day grid. Click to override it on ' + SCHED_DAY_ABBR[_schedDay - 1] + '.'}"
      style="position:absolute;left:${x}px;width:${iw}px;height:${SCHED_H}px;top:0;z-index:1;
             background:color-mix(in srgb,${col} 8%,var(--bg2));
             border:1px dashed ${col};border-radius:2px;box-sizing:border-box;
             opacity:${covered ? 0.3 : 0.75};cursor:${covered ? 'default' : 'copy'};
             overflow:hidden">
      <div style="padding:3px 5px;font-size:10px;font-weight:600;color:${col};white-space:nowrap;
                  overflow:hidden;text-overflow:ellipsis;
                  text-decoration:${covered ? 'line-through' : 'none'}">${escHtml(name)}</div>
      <div class="bc-meta" style="padding:0 5px">${_schedFmtTime(item.start_time)}–${_schedFmtTime(item.start_time + item.duration)}</div>
      <div style="padding:0 5px;font-size:9px;letter-spacing:0.5px;text-transform:uppercase;color:var(--text-dim)">
        ${covered ? 'replaced' : 'every day'}
      </div>
    </div>`;
}

// Everything that belongs in the single timeline row, back to front: the every-day
// ghosts first, this day's editable slots on top.
function _schedRowHtml() {
  const ghosts = _schedDay === 0 ? ''
    : _schedItems.map((item, idx) => _schedIsGhost(item) ? _schedGhostHtml(item, idx) : '').join('');
  const items = _schedItems.map((item, idx) => _schedInScope(item) ? _schedItemHtml(item, idx) : '').join('');
  return ghosts + items;
}

function _schedBuildTimeline() {
  const w = _schedW();
  // Ruler
  let ruler = `<div id="sched-ruler" style="position:relative;width:${w}px;height:24px;flex-shrink:0;border-bottom:1px solid var(--border);margin-bottom:2px">`;
  for (let h = 0; h <= 24; h++) {
    const x = _schedToX(h * 3600);
    ruler += `<div style="position:absolute;left:${x}px;top:0;height:100%;border-left:1px solid var(--border);padding-left:3px;font-size:10px;color:var(--text-dim);line-height:24px">${String(h).padStart(2,'0')}:00</div>`;
  }
  ruler += '</div>';

  // One row. Dashed low-contrast blocks are the every-day grid; solid ones with a day
  // badge are this day's overrides, sitting on top of what they replace.
  const legend = _schedDay === 0 ? '' :
    `<div class="bc-meta" style="margin-bottom:2px">
       <span style="color:var(--accent)">Solid = ${SCHED_DAY_ABBR[_schedDay - 1]} override</span> ·
       dashed = the every-day grid (click one to override it)
     </div>`;

  return `
    <div style="overflow:visible">
      <div style="width:${w}px">
        ${ruler}
        ${legend}
        <div id="sched-timeline" style="position:relative;width:${w}px;height:${SCHED_H}px;background:var(--bg3);border:1px solid var(--border);border-radius:2px"
          ondragover="_schedTlDragOver(event)"
          ondragleave="_schedTlDragLeave()"
          ondrop="_schedTlDrop(event)">
          <div id="sched-drop-line"></div>
          <div id="sched-now-line" style="position:absolute;top:0;bottom:0;width:2px;background:#44cc66;opacity:0.85;pointer-events:none;z-index:5"></div>
          ${_schedRowHtml()}
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
  _schedRenderSidebar();
  _schedRenderContent();
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

  if (_schedDragBcId != null) {
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
      days:               _schedScopeMask(),
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
  const item = _schedItems[_schedResizeIdx];
  // Cap growth so the block can't extend past 24:00.
  const dur = Math.min(86400 - item.start_time, Math.max(SCHED_SNAP, _schedToSec(_schedResizeStartDur * _schedScale() + dx)));
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

  // Ghosts and overrides re-render together — resizing an override changes which
  // every-day blocks it strikes through, and they share the row now.
  const w = _schedW();
  tl.style.width = w + 'px';
  tl.innerHTML = '<div id="sched-drop-line"></div><div id="sched-now-line" style="position:absolute;top:0;bottom:0;width:2px;background:var(--accent);opacity:0.7;pointer-events:none;z-index:5"></div>' + _schedRowHtml();

  // Rebuild ruler ticks at new zoom level
  const rulerEl = document.getElementById('sched-ruler');
  if (rulerEl) {
    rulerEl.style.width = w + 'px';
    let rulerHtml = '';
    for (let h = 0; h <= 24; h++) {
      const x = _schedToX(h * 3600);
      rulerHtml += `<div style="position:absolute;left:${x}px;top:0;height:100%;border-left:1px solid var(--border);padding-left:3px;font-size:10px;color:var(--text-dim);line-height:24px">${String(h).padStart(2,'0')}:00</div>`;
    }
    rulerEl.innerHTML = rulerHtml;
  }

  _schedUpdateNowLine();
}

// Discard a ghost (ejected) slot — the cassette is gone, so forget its saved
// schedule on the server, then reload the timeline.
async function _schedRemoveEjected(idx) {
  const item = _schedItems[idx];
  if (!item?.missing_cassette) return;
  if (!item.deck_id) { toast('Cannot remove — unknown deck.', true); return; }
  if (!(await dpConfirm(`Discard the ghost slot for "${item.broadcast_name}"?`))) return;
  try {
    const res = await directAPI(`/broadcast/channels/${_schedChannelId}/ejected-slots`, 'DELETE',
      { deck_id: item.deck_id, broadcast_id: item.broadcast_id });
    if (res?.error) { toast(res.error, true); return; }
    await _schedLoadItems();
    _schedRenderContent();
  } catch (err) { toast(err.message, true); }
}

// ── Popover (click a block) ───────────────────────────────────────────────────

function _schedOpenPopover(e, idx) {
  e.stopPropagation();
  const item = _schedItems[idx];
  if (item?.missing_cassette) return; // empty/ejected slot — nothing to edit, not clickable
  _schedClosePopover();
  _schedPopoverIdx = idx;

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
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Airs on</div>
    <div style="display:flex;gap:2px;margin-bottom:4px">${_schedDayChips(idx)}</div>
    <div class="bc-meta" style="margin-bottom:8px">${_schedDaySummary(item)}</div>
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

// Seven toggles + an "all" shortcut, so a slot's days are editable directly rather
// than only implied by which tab you dropped it on. Toggling every day back on
// returns the slot to the base grid; clearing the last day is refused (a slot that
// airs on no day is a slot that silently vanishes).
function _schedDayChips(idx) {
  const mask = _schedDayMask(_schedItems[idx].days);
  const all  = mask === SCHED_DAYS_ALL;
  const chip = (label, on, onclick, title) => `<button title="${title}" onclick="${onclick}"
    style="flex:1;padding:3px 0;font-size:9px;cursor:pointer;border-radius:2px;
           border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};
           background:${on ? 'var(--accent)' : 'var(--bg3)'};
           color:${on ? 'var(--bg)' : 'var(--text-dim)'};font-weight:${on ? 700 : 400}">${label}</button>`;
  return SCHED_DAY_ABBR.map((abbr, i) =>
    chip(abbr[0], !!(mask & (1 << i)), `_schedToggleDay(${idx},${i})`, abbr)
  ).join('') + chip('ALL', all, `_schedSetAllDays(${idx})`, 'Air every day');
}

function _schedDaySummary(item) {
  const label = _schedDayLabel(item.days);
  return label
    ? `Plays on ${label} only — it sits on top of whatever the every-day grid has at this time.`
    : 'Plays every day. Add a weekday-only slot over the top to change one day.';
}

function _schedToggleDay(idx, i) {
  const cur  = _schedDayMask(_schedItems[idx].days);
  const next = cur ^ (1 << i);
  if (!next) { toast('A slot must air on at least one day.', true); return; }
  _schedItems[idx].days = next;
  _schedMarkDirty();
  _schedRenderContent();
  _schedClosePopover();
}

function _schedSetAllDays(idx) {
  _schedItems[idx].days = SCHED_DAYS_ALL;
  _schedMarkDirty();
  _schedRenderContent();
  _schedClosePopover();
}

function _schedPopSetStart(idx, val) {
  const [h, m] = val.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return;
  _schedItems[idx].start_time = _schedClamp(h * 3600 + m * 60, _schedItems[idx].duration);
  _schedMarkDirty();
  _schedRenderTimeline();
}

function _schedPopSetDur(idx, val) {
  const dur = Math.min(86400 - _schedItems[idx].start_time, Math.max(60, parseInt(val) * 60));
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

// ── Clear schedule ────────────────────────────────────────────────────────────

// Clear is scoped to what you can see. Wiping a Thursday's exceptions must never
// take the every-day grid with it — that's six other days of programming.
async function _schedClear() {
  const inScope = _schedItems.filter(_schedInScope);
  if (!inScope.length) return;
  const what = _schedDay === 0
    ? 'Remove all slots from the every-day grid? Weekday overrides are kept.'
    : `Remove all ${SCHED_DAY_ABBR[_schedDay - 1]} overrides? The every-day grid is kept.`;
  if (!(await dpConfirm(what, { danger: true }))) return;
  _schedItems = _schedItems.filter(i => !_schedInScope(i));
  _schedMarkDirty();
  _schedRenderContent();
}

// ── Auto-schedule ─────────────────────────────────────────────────────────────

function _schedAutoScheduleOpen() {
  document.getElementById('sched-autosched-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'sched-autosched-modal';
  modal.style.cssText = `position:fixed;inset:0;z-index:700;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)`;
  modal.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--accent);border-radius:4px;padding:20px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.6)">
      <div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:14px">Auto-schedule</div>

      <label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;margin-bottom:12px">
        <input type="checkbox" id="as-whole-day" checked onchange="_schedAsWholeDay(this.checked)">
        Fill whole day (00:00 – 24:00)
      </label>

      <div id="as-range-row" style="display:none;gap:8px;margin-bottom:12px">
        <div style="flex:1">
          <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:2px">Start</label>
          <input id="as-start" class="form-input" value="00:00" placeholder="HH:MM" style="font-size:12px;width:100%">
        </div>
        <div style="flex:1">
          <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:2px">End</label>
          <input id="as-end" class="form-input" value="24:00" placeholder="HH:MM" style="font-size:12px;width:100%">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px">Loop count — minimum times each show plays before advancing (each show also fills a minimum 2-hour block)</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input id="as-loops" type="number" class="form-input" value="1" min="1" max="99" style="width:72px;font-size:12px">
          <span style="font-size:11px;color:var(--text-dim)">× per show</span>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="action-btn" onclick="document.getElementById('sched-autosched-modal').remove()">Cancel</button>
        <button class="action-btn primary" onclick="_schedAutoScheduleRun()">Schedule</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('mousedown', e => backdropDown(e, modal));
  modal.addEventListener('click', e => backdropClose(e, modal, () => modal.remove()));
}

function _schedAsWholeDay(checked) {
  const row = document.getElementById('as-range-row');
  if (row) row.style.display = checked ? 'none' : 'flex';
}

function _schedAutoScheduleRun() {
  const wholeDay = document.getElementById('as-whole-day')?.checked ?? true;
  let startSec = 0, endSec = 86400;

  if (!wholeDay) {
    const parseT = v => {
      const [h, m] = (v || '').split(':').map(Number);
      return isNaN(h) ? null : h * 3600 + (m || 0) * 60;
    };
    startSec = parseT(document.getElementById('as-start')?.value) ?? 0;
    endSec   = parseT(document.getElementById('as-end')?.value)   ?? 86400;
    if (endSec === 0) endSec = 86400; // 24:00 entered as 0
    if (endSec <= startSec) { toast('End time must be after start time.', true); return; }
  }

  const loops = Math.max(1, parseInt(document.getElementById('as-loops')?.value || '1') || 1);

  document.getElementById('sched-autosched-modal')?.remove();
  _schedAutoSchedule(startSec, endSec, loops);
}

function _schedAutoSchedule(startSec, endSec, loops) {
  const ch = _schedChannels.find(c => c.id === _schedChannelId);
  if (!ch) return;

  const poolIds = new Set(
    Array.isArray(ch.commercial_pool) ? ch.commercial_pool
    : (ch.commercial_pool ? JSON.parse(ch.commercial_pool) : [])
  );

  const schedulable = _schedBroadcasts.filter(b => !_bcIsClip(b));
  const programs    = schedulable.filter(b => !poolIds.has(b.id));
  const commercials = schedulable.filter(b => poolIds.has(b.id));

  if (!programs.length) { toast('No programs available to schedule.', true); return; }

  function makeDur(b) {
    return b.override_duration || ((Array.isArray(b.messages) ? b.messages.length : 0) * (b.message_interval || 5)) || 3600;
  }

  // Remove existing items that fall within the target window, keep items outside it.
  // Out-of-scope slots are ALWAYS kept: auto-scheduling the every-day grid must not
  // silently delete a weekday's overrides, and vice versa.
  const outside = _schedItems.filter(item => !_schedInScope(item)
    || item.start_time + item.duration <= startSec || item.start_time >= endSec);

  const MIN_BLOCK = 7200; // each show fills a minimum 2-hour block by looping

  const newItems = [];
  let cursor  = startSec;
  let progIdx = 0;
  let commIdx = 0;
  let playCount = 0;
  let blockElapsed = 0; // airtime accumulated for the current show's block

  while (cursor < endSec) {
    const prog = programs[progIdx % programs.length];
    const dur  = makeDur(prog);
    if (cursor + dur > endSec) break;
    newItems.push({
      broadcast_id:       prog.id,
      broadcast_name:     prog.name,
      broadcast_category: prog.category || 'general',
      slot_type:          'broadcast',
      start_time:         cursor,
      duration:           dur,
      duration_override:  null,
      days:               _schedScopeMask(),
      npc_staff:          [],
    });
    cursor += dur;
    playCount++;
    blockElapsed += dur;

    // Advance to the next show only once its block has aired at least 2 hours
    // (and satisfied the requested loop count). Between show blocks, play one
    // commercial break, rotating through the pool across breaks.
    if (playCount >= loops && blockElapsed >= MIN_BLOCK) {
      playCount = 0; blockElapsed = 0; progIdx++;
      if (commercials.length) {
        const comm    = commercials[commIdx % commercials.length];
        const commDur = makeDur(comm);
        if (cursor + commDur <= endSec) {
          newItems.push({
            broadcast_id:       comm.id,
            broadcast_name:     comm.name,
            broadcast_category: comm.category || 'advertisement',
            slot_type:          'broadcast',
            start_time:         cursor,
            duration:           commDur,
            duration_override:  null,
            days:               _schedScopeMask(),
            npc_staff:          [],
          });
          cursor += commDur;
          commIdx++;
        }
      }
    }
  }

  if (!newItems.length) { toast('Programs are too long to fit in the selected window.', true); return; }

  _schedItems = [...outside, ...newItems].sort((a, b) => a.start_time - b.start_time);
  _schedMarkDirty();
  _schedRenderTimeline();
  toast(`Auto-scheduled ${newItems.length} slot(s) across ${_schedFmtDur(cursor - startSec)}.`);
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function _schedSave() {
  if (!_schedChannelId) return;
  const payload = _schedItems.filter(item => !item.missing_cassette).map(item => ({
    // Round-trip the slot id so existing rows keep their id across saves. Without
    // this the server mints a fresh pl_<uuid> for every slot on each save (the PUT
    // deletes + reinserts the whole playlist), orphaning the old ids in git — which
    // then resurrect on the next content:import and bring "deleted" shows back.
    id:                item.id,
    broadcast_id:      item.broadcast_id,
    start_time:        item.start_time,
    duration_override: item.duration_override,
    slot_type:         item.slot_type || 'broadcast',
    days:              _schedDayMask(item.days),
    // Always an object — the engine reads conditions.npc_staff; an empty [] would
    // read as undefined and silently drop the slot from the studio staff recompute.
    conditions:        { npc_staff: item.npc_staff },
  }));
  try {
    const res = await directAPI(`/broadcast/channels/${_schedChannelId}/playlist`, 'PUT', payload);
    if (res?.error) { toast(res.error, true); return; }
    _schedDirty = false;
    _schedUpdateSaveBtn();
  } catch (err) { toast(err.message, true); }
}
