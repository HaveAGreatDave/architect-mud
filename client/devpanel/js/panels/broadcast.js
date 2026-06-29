// broadcast.js — unified broadcast suite (tab switcher + storyboard editor).
// All functions land in global scope.

// ── Broadcast Suite (tab container) ──────────────────────────────────────────

let _bcSuiteTab  = 'broadcasts'; // active sub-tab
let _bcSuiteData = {};           // full fetched data cache

const BC_SUITE_TABS = [
  { id: 'broadcasts', label: '📺 Broadcasts' },
  { id: 'channels',   label: '📡 Channels'   },
  { id: 'schedule',   label: '📅 Schedule'   },
  { id: 'themes',     label: '🎨 Themes'     },
  { id: 'graphics',   label: '🖼 Graphics'   },
];

function renderBroadcastSuite(data) {
  _bcSuiteData = data || {};
  // Render the tab bar + content area into list-panel
  const panel = document.getElementById('list-panel');
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      <div id="bc-suite-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border);flex-shrink:0;background:var(--bg2)">
        ${BC_SUITE_TABS.map(t => `
          <div onclick="bcSuiteSelectTab('${t.id}')"
            id="bc-suite-tab-${t.id}"
            style="padding:8px 16px;font-size:11px;letter-spacing:0.5px;cursor:pointer;border-bottom:2px solid ${_bcSuiteTab === t.id ? 'var(--accent)' : 'transparent'};
                   color:${_bcSuiteTab === t.id ? 'var(--accent)' : 'var(--text-dim)'};
                   margin-bottom:-2px;white-space:nowrap;transition:color 0.1s">
            ${t.label}
          </div>`).join('')}
      </div>
      <div id="bc-suite-content" style="flex:1;overflow:auto;min-height:0"></div>
    </div>`;
  _bcSuiteRender();
}

function bcSuiteSelectTab(tab) {
  _bcSuiteTab = tab;
  // Update tab highlights
  BC_SUITE_TABS.forEach(t => {
    const el = document.getElementById(`bc-suite-tab-${t.id}`);
    if (!el) return;
    const active = t.id === tab;
    el.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    el.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
  });
  _bcSuiteRender();
}

function _bcSuiteRender() {
  // Temporarily redirect list-panel to our inner content div
  const real = document.getElementById('list-panel');
  const inner = document.getElementById('bc-suite-content');
  if (!inner) return;

  // Swap list-panel id so existing render functions write into the inner div
  real.id  = '__bc_suite_outer';
  inner.id = 'list-panel';

  try {
    switch (_bcSuiteTab) {
      case 'broadcasts': renderBroadcastsPanel(_bcSuiteData); break;
      case 'channels':   renderChannelsPanel(_bcSuiteData.channels || []); break;
      case 'schedule':   renderSchedulePanel({ channels: _bcSuiteData.channels || [], broadcasts: _bcSuiteData.broadcasts || [], npcs: _bcSuiteData.npcs || [] }); break;
      case 'themes':     renderThemesPanel(_bcSuiteData.themes || []); break;
      case 'graphics':   renderGraphicsPanel(_bcSuiteData.graphics || []); break;
    }
  } finally {
    // Restore ids
    inner.id = 'bc-suite-content';
    real.id  = 'list-panel';
  }
}

// Called by sub-panels that need to refresh their data after mutations
async function bcSuiteRefresh(focusTab) {
  if (focusTab) _bcSuiteTab = focusTab;
  const data = await PANELS.broadcasts.fetch();
  renderBroadcastSuite(data);
}

const BROADCAST_CATEGORIES = ['general','news','advertisement','entertainment','emergency','weather','sport','music','documentary','surveillance'];
const BROADCAST_MODES      = ['scripted','dynamic_news','live_camera','recorded'];

const BC_CAT_COLOR = {
  entertainment: 'var(--cyan)',    news: 'var(--yellow)',
  advertisement: 'var(--accent2)', emergency: 'var(--red)',
  music:         '#8a5cf7',        documentary: '#4a9e6e',
  sport:         '#e0883a',        general: 'var(--text-dim)',
  weather:       '#60b8d4',        surveillance: 'var(--green)',
};

const BC_CARD_TYPES = ['say','ticker','wait','npc_anchor','camera_cut','overlay','title_card'];

const BC_CARD_META = {
  say:        { label: 'SAY',         color: 'var(--cyan)' },
  ticker:     { label: 'TICKER',      color: 'var(--yellow)' },
  wait:       { label: 'WAIT',        color: 'var(--text-dim)' },
  npc_anchor: { label: 'NPC ANCHOR',  color: '#8a5cf7' },
  camera_cut: { label: 'CAMERA CUT',  color: 'var(--green)' },
  overlay:    { label: 'OVERLAY',     color: '#e0883a' },
  title_card: { label: 'TITLE CARD',  color: '#60b8d4' },
  start:      { label: 'START',       color: 'var(--accent)' },
};

// ── State ────────────────────────────────────────────────────────────────────

let _broadcastList  = [];
let _bcChannels     = [];
let _bcSelected     = null;
let _bcCards        = [];
let _bcExpandedIdx  = null;
let _broadcastGraph = null;
let _bcNewChVisible = false;

// ── Panel entry ───────────────────────────────────────────────────────────────

function renderBroadcastsPanel(data) {
  _broadcastList = Array.isArray(data?.broadcasts) ? data.broadcasts : (Array.isArray(data) ? data : []);
  _bcChannels    = Array.isArray(data?.channels)   ? data.channels   : [];
  _bcSelected    = null;
  _bcCards       = [];
  _bcExpandedIdx = null;
  _bcNewChVisible = false;

  const panel = document.getElementById('list-panel');
  panel.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden">
      <div id="bc-sidebar" style="width:220px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)"></div>
      <div id="bc-canvas" style="flex:1;overflow:auto;background:var(--bg)">
        <div style="padding:48px 32px;color:var(--text-dim);font-size:12px;text-align:center">
          Select a broadcast to edit, or create a new one.
        </div>
      </div>
    </div>`;

  _bcRenderSidebar();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function _bcRenderSidebar() {
  const el = document.getElementById('bc-sidebar');
  if (!el) return;

  const items = _broadcastList.map(b => {
    const ch  = _bcChannels.find(c => c.id === b.channel_id);
    const col = BC_CAT_COLOR[b.category] || 'var(--text-dim)';
    const sel = _bcSelected?.id === b.id;
    return `<div onclick="bcSelectBroadcast('${b.id}')"
      style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);
             background:${sel ? 'var(--bg3)' : 'transparent'};
             border-left:3px solid ${sel ? 'var(--accent)' : 'transparent'}">
      <div style="font-size:12px;font-weight:600;color:var(--text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(b.name)}</div>
      <div style="font-size:10px;color:var(--text-dim);margin-top:2px;display:flex;gap:6px;align-items:center">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${col};flex-shrink:0"></span>
        ${ch ? `<span>Ch ${ch.number}</span><span style="color:var(--border)">·</span>` : ''}
        <span>${escHtml(b.category || 'general')}</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:8px;border-bottom:1px solid var(--border);display:flex;gap:4px;flex-shrink:0">
      <button class="action-btn" style="flex:1;font-size:11px" onclick="bcSelectBroadcast(null)">+ New</button>
      <button class="action-btn" style="font-size:11px" title="Import .bsm file" onclick="bcImportBsm()">↑ BSM</button>
    </div>
    <div style="flex:1;overflow-y:auto">
      ${items || '<div style="padding:16px;color:var(--text-dim);font-size:11px">No broadcasts yet.</div>'}
    </div>`;
}

// ── Select / open ─────────────────────────────────────────────────────────────

function bcSelectBroadcast(id) {
  _bcSelected     = id ? (_broadcastList.find(b => b.id === id) || null) : null;
  _bcExpandedIdx  = null;
  _bcNewChVisible = false;

  _bcCards        = _bcBuildCards(_bcSelected);
  _broadcastGraph = _bcSelected?.broadcast_graph || null;

  _bcRenderSidebar();
  _bcRenderCanvas();
}

// ── Build card array from VINE graph (or flat messages[] fallback) ─────────────

function _bcBuildCards(broadcast) {
  if (!broadcast) return [{ id: 'c_start', type: 'start' }];

  const graph = broadcast.broadcast_graph;
  if (graph && graph._start && graph.nodes) {
    const cards = [];
    let nodeId  = graph._start;
    const seen  = new Set();
    while (nodeId && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = graph.nodes[nodeId];
      if (!node) break;
      const { next, _vine, ...fields } = node;
      cards.push({ id: nodeId, ...fields });
      nodeId = next || null;
    }
    return cards.length ? cards : [{ id: 'c_start', type: 'start' }];
  }

  // Fallback: flat messages[]
  const msgs = Array.isArray(broadcast.messages) ? broadcast.messages : [];
  const cards = [{ id: 'c_start', type: 'start' }];
  msgs.forEach((m, i) => {
    const text = typeof m === 'string' ? m : (m.text || '');
    cards.push({ id: `c_msg_${i}`, type: 'say', text, style: 'raw' });
  });
  return cards;
}

// ── Rebuild VINE graph + messages[] from card array ───────────────────────────

function _bcRebuildGraph() {
  const nodes   = {};
  const msgs    = [];
  const COLS    = 5;
  const PX      = 220;
  const PY      = 160;

  _bcCards.forEach((card, i) => {
    const { id: _origId, ...fields } = card;
    const nodeId  = `c_${i}`;
    const col     = i % COLS, row = Math.floor(i / COLS);
    nodes[nodeId] = { ...fields, _vine: { x: 80 + col * PX, y: 80 + row * PY } };
    if (i < _bcCards.length - 1) nodes[nodeId].next = `c_${i + 1}`;
    if (card.type === 'say' || card.type === 'ticker') msgs.push({ text: card.text || '' });
  });

  const startId = 'c_0';
  return {
    graph:    { _start: startId, nodes },
    messages: msgs,
  };
}

// ── Canvas render ─────────────────────────────────────────────────────────────

function _bcRenderCanvas() {
  const el = document.getElementById('bc-canvas');
  if (!el) return;

  if (!_bcSelected && _bcCards.length <= 1 && !_bcCards.find(c => c.type !== 'start')) {
    // New broadcast
    el.innerHTML = _bcCanvasHtml(null);
    _bcRenderCards();
    return;
  }

  el.innerHTML = _bcCanvasHtml(_bcSelected);
  _bcRenderCards();
}

function _bcCanvasHtml(rec) {
  const chOptions = `<option value="">— no channel —</option>` +
    [..._bcChannels].sort((a,b) => (a.number||99) - (b.number||99)).map(c =>
      `<option value="${c.id}" ${rec?.channel_id === c.id ? 'selected' : ''}>Ch ${c.number}: ${escHtml(c.name)}</option>`
    ).join('') +
    `<option value="__new__">+ New Channel…</option>`;

  const catOptions = BROADCAST_CATEGORIES.map(c =>
    `<option value="${c}" ${(rec?.category || 'general') === c ? 'selected' : ''}>${c}</option>`
  ).join('');
  const modeOptions = BROADCAST_MODES.map(m =>
    `<option value="${m}" ${(rec?.playback_mode || 'scripted') === m ? 'selected' : ''}>${m.replace(/_/g,' ')}</option>`
  ).join('');

  const nodeCount = Object.keys(rec?.broadcast_graph?.nodes || {}).length;

  const newChForm = `
    <div id="bc-newch-form" style="display:${_bcNewChVisible ? 'flex' : 'none'};align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap">
      <input id="bc-newch-name"   class="form-input" placeholder="Channel name"   style="width:160px;font-size:11px">
      <input id="bc-newch-number" class="form-input" placeholder="Number" type="number" min="1" style="width:72px;font-size:11px">
      <button class="action-btn primary" style="font-size:11px" onclick="_bcCreateChannel()">Create</button>
      <button class="action-btn" style="font-size:11px" onclick="_bcToggleNewCh(false)">Cancel</button>
    </div>`;

  return `
    <div style="max-width:900px;margin:0 auto;padding:24px 28px;display:flex;flex-direction:column;gap:0">

      <!-- Header -->
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:4px">
        <input id="bc-name" class="form-input" value="${escHtml(rec?.name || '')}" placeholder="Broadcast name"
          style="flex:1;font-size:18px;font-weight:700;color:var(--text-bright);background:transparent;border-color:transparent;padding:4px 0"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'">
        <button class="action-btn danger" style="margin-top:4px" onclick="deleteBroadcast('${rec?.id || ''}','${escHtml(rec?.name||'').replace(/'/g,"\\'")}')" ${rec ? '' : 'disabled'}>✕ Delete</button>
        <button class="action-btn primary" style="margin-top:4px" onclick="saveBroadcast()">Save</button>
      </div>

      <!-- Channel row -->
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:12px">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);min-width:56px">Channel</span>
        <select id="bc-channel" class="form-input" style="width:220px;font-size:12px" onchange="_bcOnChannelSelect(this.value)">${chOptions}</select>
        ${newChForm}
      </div>

      <!-- Metadata row -->
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;color:var(--text-dim)">Category</span>
          <select id="bc-category" class="form-input" style="font-size:11px;width:130px">${catOptions}</select>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;color:var(--text-dim)">Mode</span>
          <select id="bc-mode" class="form-input" style="font-size:11px;width:120px">${modeOptions}</select>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;color:var(--text-dim)">Interval</span>
          <input id="bc-interval" type="number" class="form-input" value="${rec?.message_interval || 5}" min="1" max="300" style="width:56px;font-size:11px"> s
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;color:var(--text-dim)">Override dur.</span>
          <input id="bc-override-dur" type="number" class="form-input" value="${rec?.override_duration || ''}" placeholder="auto" min="0" style="width:72px;font-size:11px"> s
        </div>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
          <input type="checkbox" id="bc-loop" ${rec?.loop ? 'checked' : ''}> Loop
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
          <input type="checkbox" id="bc-enabled" ${rec?.enabled !== 0 ? 'checked' : ''}> Enabled
        </label>
      </div>

      <!-- Fallback messages (shown if NPC host is absent) -->
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Fallback Messages — if NPC host doesn't arrive (one per line)</label>
        <textarea id="bc-fallback-msgs" class="form-input" rows="2" style="width:100%;font-size:11px;resize:vertical" placeholder="[TECHNICAL DIFFICULTIES] Please stand by.">${(rec?.fallback_messages || []).join('\n')}</textarea>
      </div>

      <!-- Canvas toolbar -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="position:relative;display:inline-block">
          <button class="action-btn" onclick="_bcToggleAddMenu()" style="font-size:11px">+ Add Card ▾</button>
          <div id="bc-add-menu" style="display:none;position:absolute;top:100%;left:0;z-index:200;background:var(--bg2);border:1px solid var(--accent);border-radius:2px;min-width:140px;margin-top:2px">
            ${BC_CARD_TYPES.map(t => {
              const m = BC_CARD_META[t] || {};
              return `<div onclick="_bcAddCard('${t}')" style="padding:6px 12px;font-size:11px;cursor:pointer;color:${m.color || 'var(--text)'};display:flex;align-items:center;gap:8px" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">${m.label || t}</div>`;
            }).join('')}
          </div>
        </div>
        <button class="action-btn" onclick="broadcastOpenVine()" style="font-size:11px">⬡ VINE${nodeCount ? ` <span style="color:var(--text-dim)">${nodeCount}</span>` : ''}</button>
        <span id="bc-dur-label" style="font-size:10px;color:var(--text-dim);margin-left:auto"></span>
      </div>

      <!-- Card list -->
      <div id="bc-card-list" style="display:flex;flex-direction:column;gap:4px"></div>

    </div>`;
}

// ── Card rendering ────────────────────────────────────────────────────────────

function _bcRenderCards() {
  const el = document.getElementById('bc-card-list');
  if (!el) return;

  el.innerHTML = _bcCards.map((card, idx) => _bcCardHtml(card, idx)).join('');
  _bcUpdateDurLabel();
}

function _bcCardHtml(card, idx) {
  const meta    = BC_CARD_META[card.type] || { label: card.type?.toUpperCase() || '?', color: 'var(--text-dim)' };
  const isStart = card.type === 'start';
  const isReadOnly = !BC_CARD_TYPES.includes(card.type) && !isStart;
  const expanded = _bcExpandedIdx === idx && !isStart;

  const preview = _bcCardPreview(card);

  const header = `
    <div onclick="${isStart ? '' : `_bcExpandCard(${idx})`}"
      style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:${isStart ? 'default' : 'pointer'};user-select:none">
      ${isStart ? '' : `<span style="color:var(--border);font-size:16px;cursor:grab;padding:0 2px" draggable="true"
        ondragstart="_bcDragStart(event,${idx})" ondragover="event.preventDefault()" ondrop="_bcDrop(event,${idx})">⠿</span>`}
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;min-width:90px;color:${meta.color}">${meta.label}</span>
      <span style="flex:1;font-size:11px;color:var(--text-dim);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${expanded ? '' : escHtml(preview)}</span>
      ${isStart || isReadOnly ? '' : `
        <button onclick="event.stopPropagation();_bcMoveCard(${idx},-1)" ${idx<=1?'disabled':''} class="action-btn" style="font-size:9px;padding:1px 5px">▲</button>
        <button onclick="event.stopPropagation();_bcMoveCard(${idx},1)"  ${idx>=_bcCards.length-1?'disabled':''} class="action-btn" style="font-size:9px;padding:1px 5px">▼</button>
        <button onclick="event.stopPropagation();_bcDeleteCard(${idx})"  class="action-btn danger" style="font-size:9px;padding:1px 5px">✕</button>`}
      ${isReadOnly ? `<button onclick="broadcastOpenVine()" class="action-btn" style="font-size:9px;padding:1px 6px">⬡ VINE</button>` : ''}
      ${isStart ? '' : `<span style="font-size:12px;color:var(--text-dim);margin-left:2px">${expanded ? '▲' : '▼'}</span>`}
    </div>`;

  const body = expanded ? `<div style="padding:0 12px 12px 12px;border-top:1px solid var(--border)">${_bcCardFields(card, idx)}</div>` : '';

  return `<div style="border:1px solid ${expanded ? 'var(--accent)' : 'var(--border)'};border-radius:3px;background:${expanded ? 'var(--bg2)' : 'var(--bg3)'};overflow:hidden">
    ${header}${body}
  </div>`;
}

function _bcCardPreview(card) {
  switch (card.type) {
    case 'start':      return 'Beginning of broadcast';
    case 'say':        return (card.text || '').slice(0, 100) || '(empty)';
    case 'ticker':     return (card.text || '').slice(0, 100) || '(empty)';
    case 'wait':       return `${card.duration || 0}s`;
    case 'npc_anchor': return card.npc_id || '(unset)';
    case 'camera_cut': return `${card.zone_id || '?'}${card.label ? ' — '+card.label : ''}`;
    case 'overlay':    return `${card.graphic_id || '?'}${card.text ? ' · '+card.text.slice(0,40) : ''}`;
    case 'title_card': return card.graphic_id || '(unset)';
    default:           return '';
  }
}

function _bcCardFields(card, idx) {
  const bind = (key) => `oninput="_bcCards[${idx}]['${key}']=this.value;_bcUpdateDurLabel()"`;

  switch (card.type) {
    case 'say':
      return `<div style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim)">Text</label>
        <textarea class="form-input" rows="4" style="resize:vertical;font-size:12px" ${bind('text')}>${escHtml(card.text||'')}</textarea>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:10px;color:var(--text-dim)">Style</label>
          <select class="form-input" style="width:120px;font-size:11px" oninput="_bcCards[${idx}].style=this.value">
            ${['raw','emote','narrate','system'].map(s=>`<option value="${s}" ${card.style===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>`;
    case 'ticker':
      return `<div style="padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px">Ticker text</label>
        <textarea class="form-input" rows="3" style="resize:vertical;font-size:12px;width:100%" ${bind('text')}>${escHtml(card.text||'')}</textarea>
      </div>`;
    case 'wait':
      return `<div style="display:flex;align-items:center;gap:8px;padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim)">Duration</label>
        <input type="number" class="form-input" value="${card.duration||5}" min="0" style="width:80px;font-size:12px" oninput="_bcCards[${idx}].duration=parseFloat(this.value)||0"> s
      </div>`;
    case 'npc_anchor':
      return `<div style="padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px">NPC ID</label>
        <input class="form-input" value="${escHtml(card.npc_id||'')}" placeholder="npc_john_akerson" style="font-size:12px" ${bind('npc_id')}>
      </div>`;
    case 'camera_cut':
      return `<div style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Zone ID</label>
        <input class="form-input" value="${escHtml(card.zone_id||'')}" style="font-size:12px" ${bind('zone_id')}></div>
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Label</label>
        <input class="form-input" value="${escHtml(card.label||'')}" placeholder="Optional label" style="font-size:12px" ${bind('label')}></div>
      </div>`;
    case 'overlay':
      return `<div style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Graphic ID</label>
        <input class="form-input" value="${escHtml(card.graphic_id||'')}" style="font-size:12px" ${bind('graphic_id')}></div>
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Overlay text</label>
        <textarea class="form-input" rows="2" style="font-size:12px;resize:vertical" ${bind('text')}>${escHtml(card.text||'')}</textarea></div>
      </div>`;
    case 'title_card':
      return `<div style="padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px">Graphic ID</label>
        <input class="form-input" value="${escHtml(card.graphic_id||'')}" style="font-size:12px" ${bind('graphic_id')}>
      </div>`;
    default:
      return `<div style="padding:10px;font-size:11px;color:var(--text-dim)">This node type can only be edited in the VINE graph editor.</div>`;
  }
}

function _bcExpandCard(idx) {
  _bcExpandedIdx = _bcExpandedIdx === idx ? null : idx;
  _bcRenderCards();
}

function _bcVineDuration(graph, interval) {
  if (!graph?._start || !graph?.nodes) return 0;
  let total = 0, nodeId = graph._start;
  const seen = new Set();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = graph.nodes[nodeId];
    if (!node) break;
    if (node.type === 'say' || node.type === 'ticker') total += interval;
    else if (node.type === 'wait') total += node.data?.seconds ?? 5;
    nodeId = node.next ?? null;
  }
  return total;
}

function _bcUpdateDurLabel() {
  const label = document.getElementById('bc-dur-label');
  if (!label) return;
  const interval = parseFloat(document.getElementById('bc-interval')?.value || 5);
  const override = parseFloat(document.getElementById('bc-override-dur')?.value || '') || null;
  if (override) { label.textContent = `Duration: ${override}s (override)`; return; }
  const graph = _broadcastGraph;
  const vineDur = graph ? _bcVineDuration(graph, interval) : 0;
  if (vineDur > 0) {
    label.textContent = `Duration: ~${vineDur}s (VINE) · ${_bcCards.length} nodes`;
  } else {
    const sayCount = _bcCards.filter(c => c.type === 'say' || c.type === 'ticker').length;
    label.textContent = `Duration: ~${(sayCount * interval).toFixed(0)}s · ${sayCount} lines · ${_bcCards.length} nodes`;
  }
}

// ── Card drag-and-drop reorder ────────────────────────────────────────────────

let _bcDragIdx = null;

function _bcDragStart(e, idx) {
  _bcDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
}

function _bcDrop(e, targetIdx) {
  e.preventDefault();
  if (_bcDragIdx == null || _bcDragIdx === targetIdx) return;
  if (_bcDragIdx === 0 || targetIdx === 0) return; // don't move START
  const [card] = _bcCards.splice(_bcDragIdx, 1);
  _bcCards.splice(targetIdx, 0, card);
  _bcDragIdx = null;
  _bcRenderCards();
}

// ── Card mutations ────────────────────────────────────────────────────────────

function _bcAddCard(type) {
  _bcToggleAddMenu(false);
  const defaults = {
    say:        { text: '', style: 'raw' },
    ticker:     { text: '' },
    wait:       { duration: 5 },
    npc_anchor: { npc_id: '' },
    camera_cut: { zone_id: '', label: '' },
    overlay:    { graphic_id: '', text: '' },
    title_card: { graphic_id: '' },
  };
  const card = { id: `c_new_${Date.now()}`, type, ...(defaults[type] || {}) };
  _bcCards.push(card);
  _bcExpandedIdx = _bcCards.length - 1;
  _bcRenderCards();
  // Scroll to new card
  document.getElementById('bc-card-list')?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _bcMoveCard(idx, dir) {
  if (idx <= 1 && dir < 0) return; // protect START at 0
  const j = idx + dir;
  if (j <= 0 || j >= _bcCards.length) return;
  [_bcCards[idx], _bcCards[j]] = [_bcCards[j], _bcCards[idx]];
  if (_bcExpandedIdx === idx) _bcExpandedIdx = j;
  else if (_bcExpandedIdx === j) _bcExpandedIdx = idx;
  _bcRenderCards();
}

function _bcDeleteCard(idx) {
  if (idx === 0) return;
  _bcCards.splice(idx, 1);
  if (_bcExpandedIdx === idx) _bcExpandedIdx = null;
  else if (_bcExpandedIdx > idx) _bcExpandedIdx--;
  _bcRenderCards();
}

function _bcToggleAddMenu(force) {
  const menu = document.getElementById('bc-add-menu');
  if (!menu) return;
  const show = force !== undefined ? force : menu.style.display === 'none';
  menu.style.display = show ? 'block' : 'none';
  if (show) {
    const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

// ── Channel management ────────────────────────────────────────────────────────

function _bcOnChannelSelect(val) {
  if (val === '__new__') {
    _bcToggleNewCh(true);
    document.getElementById('bc-channel').value = _bcSelected?.channel_id || '';
  }
}

function _bcToggleNewCh(show) {
  _bcNewChVisible = show;
  const form = document.getElementById('bc-newch-form');
  if (form) form.style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('bc-newch-name')?.focus();
}

async function _bcCreateChannel() {
  const name   = document.getElementById('bc-newch-name')?.value?.trim();
  const number = parseInt(document.getElementById('bc-newch-number')?.value || '');
  if (!name)   { toast('Channel name is required.', true); return; }
  if (!number) { toast('Channel number is required.', true); return; }
  try {
    const res = await directAPI('/broadcast/channels', 'POST', {
      id: `ch_${number}_${Date.now()}`, name, number, channel_type: 'playlist', enabled: 1,
    });
    if (res?.error) { toast(res.error, true); return; }
    const newCh = { id: res.id || `ch_${number}_${Date.now()}`, name, number, channel_type: 'playlist' };
    _bcChannels.push(newCh);
    _bcChannels.sort((a, b) => (a.number || 99) - (b.number || 99));
    _bcToggleNewCh(false);
    // Rebuild dropdown and select new channel
    const sel = document.getElementById('bc-channel');
    if (sel) {
      const opt = document.createElement('option');
      opt.value = newCh.id; opt.textContent = `Ch ${newCh.number}: ${newCh.name}`;
      // Insert before the "New Channel" option
      sel.insertBefore(opt, sel.lastElementChild);
      sel.value = newCh.id;
    }
    toast(`Channel ${number}: ${name} created.`);
  } catch (err) { toast(err.message, true); }
}

// ── VINE integration ──────────────────────────────────────────────────────────

function broadcastOpenVine() {
  if (typeof VineBroadcastSchema === 'undefined') {
    toast('VINE broadcast schema not loaded.', true); return;
  }
  const { graph } = _bcRebuildGraph();
  const vineData  = VineBroadcastSchema.fromBroadcastGraph(graph);
  const name      = document.getElementById('bc-name')?.value?.trim() || 'Broadcast';
  vineModalOpen(`VINE — ${name}`, VineBroadcastSchema, vineData, (vineGraph) => {
    _broadcastGraph = VineBroadcastSchema.toBroadcastGraph(vineGraph);
    _bcCards = _bcBuildCards({ ..._bcSelected, broadcast_graph: _broadcastGraph });
    _bcExpandedIdx = null;
    _bcRenderCanvas();
    toast('Graph saved — canvas synced.');
  });
}

// ── Save / Delete ─────────────────────────────────────────────────────────────

async function saveBroadcast() {
  const name = document.getElementById('bc-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  const { graph, messages } = _bcRebuildGraph();

  const body = {
    name,
    description:      _bcSelected?.description || '',
    category:         document.getElementById('bc-category')?.value || 'general',
    playback_mode:    document.getElementById('bc-mode')?.value || 'scripted',
    message_interval: parseFloat(document.getElementById('bc-interval')?.value || 5),
    override_duration: parseFloat(document.getElementById('bc-override-dur')?.value || '') || null,
    loop:    document.getElementById('bc-loop')?.checked    ? 1 : 0,
    enabled: document.getElementById('bc-enabled')?.checked ? 1 : 0,
    messages,
    broadcast_graph: graph,
    channel_id: document.getElementById('bc-channel')?.value || null,
    fallback_messages: (document.getElementById('bc-fallback-msgs')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
  };

  const isNew = !_bcSelected;
  const path  = isNew ? '/broadcast/broadcasts' : `/broadcast/broadcasts/${_bcSelected.id}`;
  const method = isNew ? 'POST' : 'PUT';

  try {
    const res = await directAPI(path, method, body);
    if (res?.error) { toast(res.error, true); return; }
    toast(isNew ? 'Broadcast created.' : 'Broadcast saved.');
    // Refresh panel and re-select the broadcast
    const refreshedData = await Promise.all([
      directAPI('/broadcast/broadcasts'),
      directAPI('/broadcast/channels'),
    ]);
    const broadcasts = Array.isArray(refreshedData[0]) ? refreshedData[0] : [];
    const channels   = Array.isArray(refreshedData[1]) ? refreshedData[1] : [];
    _broadcastList = broadcasts;
    _bcChannels    = channels;
    const newId = res.id || _bcSelected?.id;
    _bcSelected = broadcasts.find(b => b.id === newId) || null;
    if (_bcSelected) {
      _bcCards = _bcBuildCards(_bcSelected);
      _bcExpandedIdx = null;
    }
    _bcRenderSidebar();
    _bcUpdateDurLabel();
  } catch (err) { toast(err.message, true); }
}

async function deleteBroadcast(id, name) {
  if (!id) return;
  if (!confirm(`Delete broadcast "${name}"? This cannot be undone.`)) return;
  try {
    const res = await directAPI(`/broadcast/broadcasts/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }
    toast('Broadcast deleted.');
    await bcSuiteRefresh('broadcasts');
  } catch (err) { toast(err.message, true); }
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
    broadcast_graph: rec.broadcast_graph || null,
    channel_id: rec.channel_id || null,
  };
  try {
    const res = await directAPI('/broadcast/broadcasts', 'POST', body);
    if (res?.error) { toast(res.error, true); return; }
    toast('Broadcast cloned.');
    await bcSuiteRefresh('broadcasts');
  } catch (err) { toast(err.message, true); }
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
    try { compiled = compileBsm(text); }
    catch (err) { toast(`BSM parse error: ${err.message}`, true); return; }
    if (!compiled.meta.name) { toast('BSM file is missing @broadcast name.', true); return; }
    await _bcImportDependencies(compiled);
  };
  input.click();
}

// ── BSM dependency resolver ───────────────────────────────────────────────────

let _bcDepCompiled = null;
let _bcDepPending  = new Set();
let _bcPickerZoneId = null;
let _bcPickerSelected = null;

async function _bcImportDependencies(compiled) {
  const [allZones, allNpcs] = await Promise.all([
    directAPI('/zones', 'GET'), directAPI('/npcs', 'GET'),
  ]);
  const zoneIds  = new Set((allZones || []).map(z => z.id));
  const npcDbIds = new Set((allNpcs  || []).map(n => n.id));
  const missingZones = compiled.rooms.filter(id => !zoneIds.has(id));
  const missingNpcs  = compiled.npcIds.filter(id => !npcDbIds.has(id));
  if (!missingZones.length && !missingNpcs.length) { await _bcImportSave(compiled); return; }
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
      ${npcRows}${zoneRows}
      <button id="bsm-finish-btn" class="action-btn primary" style="margin-top:4px" disabled onclick="_bcDepFinish()">Finish Import</button>
    </div>`;
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
    const res = await directAPI('/npcs', 'POST', { id, name, description: `${name}. Edit this description.`, zone_id: null, disposition: 'neutral' });
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
    c.style.background = 'var(--bg)'; c.style.borderColor = 'var(--border)'; c.style.color = 'var(--border)';
  });
  el.style.background = 'color-mix(in srgb,var(--yellow) 20%,transparent)';
  el.style.borderColor = 'var(--yellow)'; el.style.color = 'var(--yellow)';
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
      map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, marker: name.slice(0, 2).toUpperCase(),
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
  for (const asset of assets) {
    try { await directAPI('/broadcast/graphics', 'POST', asset); }
    catch { try { await directAPI(`/broadcast/graphics/${asset.id}`, 'PUT', asset); } catch {} }
  }
  let method = 'POST', path = '/broadcast/broadcasts';
  const existing = _broadcastList.find(b => b.name === meta.name);
  if (existing) {
    const overwrite = confirm(`A broadcast named "${meta.name}" already exists.\n\nOK = overwrite it   Cancel = create new copy`);
    if (overwrite) { method = 'PUT'; path = `/broadcast/broadcasts/${existing.id}`; }
    else { meta.name += ' (imported)'; }
  }
  // Resolve channel_id from @channel directive
  const channelId = meta.channel
    ? (_bcChannels.find(c => c.id === meta.channel || String(c.number) === meta.channel)?.id || null)
    : null;

  const body = {
    name: meta.name, category: meta.category || 'general',
    playback_mode: 'scripted', message_interval: 5,
    override_duration: meta.length || null, loop: 0, enabled: 1,
    messages: messages.map(t => ({ text: t })),
    broadcast_graph: broadcastGraph,
    channel_id: channelId,
  };
  try {
    const res = await directAPI(path, method, body);
    if (res?.error) { toast(res.error, true); return; }
    const nodeCount = Object.keys(broadcastGraph.nodes).length;
    toast(`Imported "${meta.name}" — ${messages.length} messages, ${nodeCount} graph nodes${assets.length ? `, ${assets.length} asset(s)` : ''}.`);
    await bcSuiteRefresh('broadcasts');
  } catch (err) { toast(err.message, true); }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
