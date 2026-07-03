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
const _channelExpanded = new Set();   // channel IDs with expanded children visible
const _channelDeckCache = {};         // channelId → { deck, cameras, mediaCameras } | 'loading' | 'error'

// ── Panel render ─────────────────────────────────────────────────────────────

const _chTypeColor = { playlist:'var(--cyan)', news:'var(--yellow)', mixed:'var(--accent)', live:'var(--green)', emergency:'var(--red)' };

function renderChannelsPanel(data) {
  _channelList = Array.isArray(data) ? data : [];
  const panel = document.getElementById('list-panel');

  const rows = _channelList.map(ch => _renderChannelRow(ch)).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">Channels</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${_channelList.length} channel${_channelList.length !== 1 ? 's' : ''} — tune devices to a number to receive</div>
        </div>
        <button class="action-btn" onclick="openChannelEditor(null)">+ New Channel</button>
      </div>
      ${_channelList.length
        ? `<div id="ch-accordion">${rows}</div>`
        : '<div style="padding:24px;color:var(--text-dim)">No channels yet. Create one to schedule broadcasts.</div>'}
    </div>`;

  // Reload deck data for any channels that were already expanded before re-render
  for (const channelId of _channelExpanded) {
    loadChannelDeckData(channelId);
  }
}

function _renderChannelRow(ch) {
  const plCount  = Array.isArray(ch.playlist) ? ch.playlist.length : 0;
  const expanded = _channelExpanded.has(ch.id);
  const col      = _chTypeColor[ch.channel_type] || 'var(--text)';
  const studio   = ch.studio_zone_id ? `<span style="font-size:9px;color:var(--text-dim);margin-left:6px">📍 ${escHtml2(ch.studio_zone_id)}</span>` : '';

  const children = expanded ? `
    <div id="ch-children-${CSS.escape(ch.id)}" style="border-top:1px solid var(--border);background:var(--bg3)">
      ${_renderDeckChild(ch)}
    </div>` : `<div id="ch-children-${CSS.escape(ch.id)}" style="display:none"></div>`;

  return `
    <div style="border:1px solid var(--border);border-radius:2px;margin-bottom:4px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg2);cursor:pointer"
           onclick="toggleChannelExpand('${ch.id}')">
        <span style="font-size:11px;color:var(--text-dim);width:12px;flex-shrink:0">${expanded ? '▼' : '▶'}</span>
        <span style="font-weight:bold;color:var(--accent);min-width:28px">Ch ${ch.number ?? '—'}</span>
        <span style="font-weight:600;flex:1;color:${ch.enabled ? 'var(--text-bright)' : 'var(--text-dim)'}">${escHtml2(ch.name)}</span>
        ${studio}
        <span style="font-size:10px;padding:2px 6px;border-radius:2px;background:var(--bg3);color:${col}">${ch.channel_type || 'playlist'}</span>
        <span style="font-size:10px;color:var(--text-dim)">${plCount} item${plCount !== 1 ? 's' : ''}</span>
        <button class="action-btn" style="font-size:10px;padding:2px 7px" onclick="event.stopPropagation();openChannelEditor(${JSON.stringify(ch).replace(/"/g,'&quot;')})">✏ Edit</button>
        <button class="action-btn danger" style="font-size:10px;padding:2px 7px" onclick="event.stopPropagation();deleteChannel(${JSON.stringify(ch).replace(/"/g,'&quot;')})">✕</button>
      </div>
      ${children}
    </div>`;
}

function _renderDeckChild(ch, deckData) {
  const hasDeck = deckData && deckData.deck;
  const studioLabel = ch.studio_zone_id
    ? `<span style="font-size:10px;color:var(--text-dim)">Studio: ${escHtml2(ch.studio_zone_id)}</span>`
    : '<span style="font-size:10px;color:var(--text-dim)">No studio zone set</span>';

  if (!deckData) {
    return `
      <div style="padding:8px 14px 6px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:1px">📼 Media Deck</span>
          ${studioLabel}
          <span class="bc-meta" style="margin-left:auto">Loading…</span>
        </div>
      </div>`;
  }

  if (deckData === 'error') {
    return `
      <div style="padding:8px 14px 6px">
        <span style="font-size:10px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:1px">📼 Media Deck</span>
        <span style="font-size:10px;color:var(--red);margin-left:8px">Failed to load</span>
      </div>`;
  }

  if (!hasDeck) {
    const canSpawn = !!ch.studio_zone_id;
    return `
      <div style="padding:8px 14px 10px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:1px">📼 Media Deck</span>
          ${studioLabel}
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding-left:4px">
          <span class="bc-meta">No media deck assigned.</span>
          ${canSpawn
            ? `<button class="action-btn" style="font-size:10px;padding:2px 8px" onclick="spawnDeckForChannel('${ch.id}')">+ Auto-Spawn Deck</button>`
            : `<span class="bc-meta" style="color:var(--text-dim)">(Set studio zone in Edit first)</span>`}
        </div>
      </div>`;
  }

  const deck = deckData.deck;
  const mediaCams = deckData.mediaCameras || [];
  const chName = escHtml2(ch.name || ch.id);

  const camRows = mediaCams.map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:10px">📹</span>
      <span style="font-size:10px;flex:1;color:var(--text)">${escHtml2(c.zone_name || c.zone_id || '—')}</span>
      <span style="font-size:9px;color:var(--text-dim)">${c.direction}</span>
      ${c.is_streaming ? `<span style="font-size:9px;color:var(--cyan)">▶ streaming</span>` : `<span style="font-size:9px;color:var(--text-dim)">idle</span>`}
      <button class="action-btn" style="font-size:9px;padding:1px 5px" onclick="openCameraEditor(${JSON.stringify(c).replace(/"/g,'&quot;')})">✏</button>
      <button class="action-btn danger" style="font-size:9px;padding:1px 5px" onclick="deleteCamera('${c.id}');loadChannelDeckData('${ch.id}')">✕</button>
    </div>`).join('');

  return `
    <div style="padding:8px 14px 10px;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:10px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:1px">📼 Media Deck</span>
        <span style="font-size:10px;color:var(--text)">${escHtml2(deck.name || deck.id)}</span>
        <span style="font-size:9px;color:var(--text-dim)">→ ${escHtml2(deck.zone_id)}</span>
        <button class="action-btn" style="font-size:9px;padding:1px 6px;margin-left:auto;color:#ff4455;border-color:#ff4455" onclick="bcLivePreview('${ch.id}','${chName}','${escHtml2(ch.studio_zone_id||'')}')">⬤ Live</button>
        <button class="action-btn" style="font-size:9px;padding:1px 6px" onclick="restartChannelBSM('${ch.id}')">⟳ Restart BSM</button>
        <button class="action-btn" style="font-size:9px;padding:1px 6px" onclick="spawnDeckForChannel('${ch.id}')">⇄ Replace</button>
      </div>
      <div style="padding-left:4px">
        <div style="font-size:10px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">📷 Cameras</div>
        ${mediaCams.length ? camRows : '<span class="bc-meta" style="color:var(--text-dim)">No cameras linked.</span>'}
      </div>
    </div>`;
}

async function toggleChannelExpand(channelId) {
  const ch = _channelList.find(c => c.id === channelId);
  if (!ch) return;
  const childEl = document.getElementById(`ch-children-${CSS.escape(channelId)}`);
  if (!childEl) return;

  if (_channelExpanded.has(channelId)) {
    _channelExpanded.delete(channelId);
    childEl.style.display = 'none';
    childEl.innerHTML = '';
    // Flip the toggle arrow
    const arrow = childEl.previousElementSibling?.querySelector('span:first-child');
    if (arrow) arrow.textContent = '▶';
  } else {
    _channelExpanded.add(channelId);
    childEl.style.display = '';
    // Flip the toggle arrow
    const arrow = childEl.previousElementSibling?.querySelector('span:first-child');
    if (arrow) arrow.textContent = '▼';
    // Show loading state immediately
    childEl.innerHTML = _renderDeckChild(ch);
    // Then load real data
    await loadChannelDeckData(channelId);
  }
}

async function loadChannelDeckData(channelId) {
  const ch = _channelList.find(c => c.id === channelId);
  if (!ch) return;
  const childEl = document.getElementById(`ch-children-${CSS.escape(channelId)}`);
  if (!childEl || !_channelExpanded.has(channelId)) return;

  try {
    const data = await directAPI(`/broadcast/deck/${channelId}`);
    _channelDeckCache[channelId] = data;
    childEl.innerHTML = `<div style="border-top:1px solid var(--border);background:var(--bg3)">${_renderDeckChild(ch, data)}</div>`;
  } catch {
    _channelDeckCache[channelId] = 'error';
    childEl.innerHTML = `<div style="border-top:1px solid var(--border);background:var(--bg3)">${_renderDeckChild(ch, 'error')}</div>`;
  }
}

async function restartChannelBSM(channelId) {
  try {
    const res = await directAPI(`/broadcast/channels/${channelId}/restart`, 'POST');
    if (res?.error) { toast(res.error, true); return; }
    toast('Broadcast restarted from the top.');
  } catch (e) { toast(e.message, true); }
}

async function spawnDeckForChannel(channelId) {
  try {
    const res = await directAPI('/broadcast/deck', 'POST', { channel_id: channelId, auto_place: true });
    if (res?.error) { toast(res.error, true); return; }
    toast('Media deck and camera spawned.');
    // Refresh this channel's data in the accordion
    const ch = _channelList.find(c => c.id === channelId);
    if (ch) ch.studio_zone_id = res.zone_id || ch.studio_zone_id;
    await loadChannelDeckData(channelId);
  } catch (e) { toast(e.message, true); }
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

  const ads = _channelBroadcasts.filter(b => b.category === 'advertisement');
  const currentPool = Array.isArray(rec?.commercial_pool)
    ? rec.commercial_pool
    : (rec?.commercial_pool ? JSON.parse(rec.commercial_pool) : []);
  const poolCheckboxes = ads.map(b => `
    <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
      <input type="checkbox" class="ch-comm-pool" value="${b.id}"${currentPool.includes(b.id) ? ' checked' : ''}>
      ${escHtml2(b.name)}
    </label>`).join('');

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
          <div style="font-size:10px;color:var(--text-dim);margin-top:3px">${rec?.channel_type === 'live' ? 'NPC hosts must be present here to broadcast' : 'Where this channel broadcasts from'}</div>
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

      <!-- Commercial Pool -->
      <div id="ch-comm-section" style="display:${ads.length ? 'block' : 'none'}">
        <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px">Commercial Pool</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;background:var(--bg3);padding:8px;border-radius:2px">
          ${poolCheckboxes || '<div style="font-size:11px;color:var(--text-dim)">No advertisements — create some in the Commercials tab</div>'}
        </div>
      </div>

      <!-- Timeline (hidden for daily-schedule channels — use the Schedule tab instead) -->
      ${rec?.schedule_mode === 'daily' ? `
      <div style="padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:2px;font-size:12px;color:var(--text-dim)">
        📅 This channel uses daily scheduling — use the <strong style="color:var(--accent)">Schedule</strong> tab to edit its programming blocks.
      </div>` : `
      <div id="ch-timeline-section" style="border:1px solid var(--border);border-radius:2px;overflow:hidden">
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
      </div>`}
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

  if (rec?.schedule_mode !== 'daily') {
    tlRenderLibrary();
    tlRender();
  }

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

async function tlEditItem(idx) {
  const item = _channelPlaylist[idx];
  if (!item) return;
  const newTime = await dpPrompt(`Start time for "${item.broadcast_name}" (seconds):`, item.start_time);
  if (newTime !== null) {
    const t = parseInt(newTime, 10);
    if (!isNaN(t)) { item.start_time = Math.max(0, t); tlRender(); }
  }
}

// ── Save channel ─────────────────────────────────────────────────────────────

async function saveChannel() {
  const name = document.getElementById('ch-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  const newsCategories  = Array.from(document.querySelectorAll('.ch-news-cat:checked')).map(cb => cb.value);
  const commercialPool  = Array.from(document.querySelectorAll('.ch-comm-pool:checked')).map(cb => cb.value);

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
    commercial_pool: commercialPool,
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

    // Save playlist — skip for daily-schedule channels (managed via the Schedule tab)
    if (_channelEditTarget?.schedule_mode !== 'daily') {
      const playlistBody = _channelPlaylist.map(item => ({
        broadcast_id: item.broadcast_id,
        start_time: item.start_time,
        duration_override: item.duration_override || null,
        priority: item.priority || 0,
        conditions: item.conditions || [],
      }));
      const plRes = await directAPI(`/broadcast/channels/${channelId}/playlist`, 'PUT', playlistBody);
      if (plRes?.error) { toast(plRes.error, true); return; }
    }

    closeModal();
    toast(isNew ? 'Channel created.' : 'Channel saved.');
    await bcSuiteRefresh('channels');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteChannel(ch) {
  const { id, name } = ch;
  if (!(await dpConfirm(`Delete channel "${name}" and its playlist? This cannot be undone.`, { danger: true }))) return;
  try {
    // Collect candidate zones and NPCs to offer cleanup
    const [allChannels, allNpcs, allZones] = await Promise.all([
      directAPI('/broadcast/channels'),
      directAPI('/npcs'),
      directAPI('/zones'),
    ]);
    const otherChannels = (allChannels || []).filter(c => c.id !== id);
    const otherZoneRefs = new Set(
      otherChannels.flatMap(c => [c.zone_id, c.studio_zone_id].filter(Boolean))
    );

    // Zones created for this channel that no other channel references
    const candidateZoneIds = [ch.zone_id, ch.studio_zone_id].filter(z => z && !otherZoneRefs.has(z));
    const candidateZones   = (allZones || []).filter(z => candidateZoneIds.includes(z.id));

    // NPCs whose zone_id is one of the candidate zones
    const candidateNpcs = (allNpcs || []).filter(n => candidateZoneIds.includes(n.zone_id));

    let deleteZones = [];
    let deleteNpcs  = [];
    if (candidateZones.length || candidateNpcs.length) {
      const chosen = await _chDeleteCleanupPrompt(name, candidateZones, candidateNpcs);
      if (chosen === null) return; // user cancelled
      deleteZones = chosen.zones;
      deleteNpcs  = chosen.npcs;
    }

    const res = await directAPI(`/broadcast/channels/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }

    await Promise.all([
      ...deleteNpcs.map(n  => directAPI(`/npcs/${n.id}`,  'DELETE').catch(() => {})),
      ...deleteZones.map(z => directAPI(`/zones/${z.id}`, 'DELETE').catch(() => {})),
    ]);

    const parts = ['Channel deleted'];
    if (deleteNpcs.length)  parts.push(`${deleteNpcs.length} NPC${deleteNpcs.length > 1 ? 's' : ''} removed`);
    if (deleteZones.length) parts.push(`${deleteZones.length} zone${deleteZones.length > 1 ? 's' : ''} removed`);
    toast(parts.join(' · ') + '.');
    await bcSuiteRefresh('channels');
  } catch (err) {
    toast(err.message, true);
  }
}

function _chDeleteCleanupPrompt(channelName, zones, npcs) {
  return new Promise(resolve => {
    const zoneHtml = zones.map(z => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">
        <input type="checkbox" class="ch-del-zone" data-id="${z.id}" checked style="accent-color:var(--accent)">
        <span style="font-size:12px"><span style="color:var(--yellow)">${escHtml2(z.name)}</span> <span style="color:var(--text-dim);font-size:10px">${z.id}</span></span>
      </label>`).join('');
    const npcHtml = npcs.map(n => `
      <label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer">
        <input type="checkbox" class="ch-del-npc" data-id="${n.id}" checked style="accent-color:var(--accent)">
        <span style="font-size:12px"><span style="color:var(--cyan)">${escHtml2(n.name || n.id)}</span> <span style="color:var(--text-dim);font-size:10px">${n.id}</span></span>
      </label>`).join('');

    const el = document.createElement('div');
    el.classList.add('modal-overlay'); el.style.cssText = 'background:rgba(0,0,0,0.8);z-index:900;display:flex';
    el.innerHTML = `
      <div style="background:var(--bg2);border:1px solid var(--accent);padding:20px;width:480px;max-width:94vw;border-radius:3px;display:flex;flex-direction:column;gap:14px">
        <div style="color:var(--accent);font-size:13px;letter-spacing:2px;text-transform:uppercase">Also delete?</div>
        <div style="font-size:11px;color:var(--text-dim)">These zones and NPCs appear to be associated with <strong style="color:var(--text)">${escHtml2(channelName)}</strong> and aren't used by other channels. Uncheck anything you want to keep.</div>
        ${zones.length ? `<div><div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Zones</div>${zoneHtml}</div>` : ''}
        ${npcs.length  ? `<div><div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">NPCs</div>${npcHtml}</div>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="action-btn" id="ch-del-cancel">Cancel</button>
          <button class="action-btn danger" id="ch-del-confirm">Delete Channel + Selected</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    el.querySelector('#ch-del-cancel').onclick = () => { el.remove(); resolve(null); };
    el.querySelector('#ch-del-confirm').onclick = () => {
      const selZones = [...el.querySelectorAll('.ch-del-zone:checked')].map(cb => zones.find(z => z.id === cb.dataset.id)).filter(Boolean);
      const selNpcs  = [...el.querySelectorAll('.ch-del-npc:checked')].map(cb => npcs.find(n => n.id === cb.dataset.id)).filter(Boolean);
      el.remove();
      resolve({ zones: selZones, npcs: selNpcs });
    };
  });
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
  if (!(await dpConfirm('Delete this camera?', { danger: true }))) return;
  try {
    const res = await directAPI(`/broadcast/cameras/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }
    toast('Camera deleted.');
    await loadCameraList();
  } catch (err) { toast(err.message, true); }
}

async function clearCameraBuffer(id) {
  if (!(await dpConfirm('Clear the recording buffer for this camera?', { danger: true }))) return;
  try {
    await directAPI(`/broadcast/cameras/${id}/clear-buffer`, 'POST');
    toast('Buffer cleared.');
  } catch (err) { toast(err.message, true); }
}

async function cameraTobroadcast(id) {
  const name = await dpPrompt('Name for the new broadcast:');
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
