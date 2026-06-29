// broadcast.js — unified broadcast suite (tab switcher + storyboard editor).
// All functions land in global scope.

// ── Markup renderer (BBCode → HTML, no token expansion) ─────────────────────

function _bcMarkup(text) {
  let s = String(text ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Rainbow
  s = s.replace(/\[rainbow\]([\s\S]*?)\[\/rainbow\]/gi, (_, t) => {
    const parts = []; t.replace(/&[a-z#][a-z0-9]*;|./gis, m => parts.push(m));
    return parts.map((ch, i) => `<span style="color:hsl(${Math.round(i/Math.max(parts.length-1,1)*300)},100%,65%)">${ch}</span>`).join('');
  });
  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi,      '<strong>$1</strong>');
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi,       '<em>$1</em>');
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi,       '<span style="text-decoration:underline">$1</span>');
  s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi,       '<span style="text-decoration:line-through">$1</span>');
  s = s.replace(/\[blink\]([\s\S]*?)\[\/blink\]/gi,'<span style="animation:blink 1s step-end infinite">$1</span>');
  s = s.replace(/\[color=([^\]]{1,30})\]([\s\S]*?)\[\/color\]/gi, (_, c, t) =>
    /^(?:[a-zA-Z]+|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)$/.test(c.trim())
      ? `<span style="color:${c.trim()}">${t}</span>` : t);
  s = s.replace(/\[danger\]([\s\S]*?)\[\/danger\]/gi,  '<span style="color:var(--red)">$1</span>');
  s = s.replace(/\[safe\]([\s\S]*?)\[\/safe\]/gi,      '<span style="color:var(--green)">$1</span>');
  s = s.replace(/\[player\]([\s\S]*?)\[\/player\]/gi,  '<span style="color:var(--purple)">$1</span>');
  s = s.replace(/\[item\]([\s\S]*?)\[\/item\]/gi,      '<span style="color:var(--yellow)">$1</span>');
  s = s.replace(/\[system\]([\s\S]*?)\[\/system\]/gi,  '<span style="color:var(--text-dim)">$1</span>');
  return s;
}

function _bcMarkupPreview(previewId, text) {
  const el = document.getElementById(previewId);
  if (!el) return;
  el.innerHTML = _bcMarkup(text);
  el.style.display = text?.trim() ? '' : 'none';
}

function _bcInsertTag(taId, open, close) {
  const ta = document.getElementById(taId);
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'text';
  ta.value = ta.value.slice(0, s) + open + sel + close + ta.value.slice(e);
  ta.dispatchEvent(new Event('input'));
  ta.focus();
  ta.setSelectionRange(s + open.length, s + open.length + sel.length);
}

// ── Broadcast Suite (tab container) ──────────────────────────────────────────

let _bcSuiteTab  = 'broadcasts'; // active sub-tab
let _bcSuiteData = {};           // full fetched data cache

const BC_SUITE_TABS = [
  { id: 'broadcasts',  label: '📺 Broadcasts'  },
  { id: 'channels',    label: '📡 Channels'    },
  { id: 'schedule',    label: '📅 Schedule'    },
  { id: 'commercials', label: '📼 Commercials' },
  { id: 'themes',      label: '🎨 Themes'      },
  { id: 'graphics',    label: '🖼 Graphics'    },
  { id: 'npcs',        label: '👥 NPCs'        },
];

function renderBroadcastSuite(data) {
  _bcSuiteData = data || {};
  // Render the tab bar + content area into list-panel
  const panel = document.getElementById('list-panel');
  panel.innerHTML = `
    <div class="bc-suite">
      <div class="bc-tabs" id="bc-suite-tabs">
        ${BC_SUITE_TABS.map(t => `
          <button class="bc-tab${_bcSuiteTab === t.id ? ' bc-tab-active' : ''}"
            id="bc-suite-tab-${t.id}"
            onclick="bcSuiteSelectTab('${t.id}')">
            ${t.label}
          </button>`).join('')}
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
    el.classList.toggle('bc-tab-active', t.id === tab);
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
      case 'broadcasts':  renderBroadcastsPanel(_bcSuiteData); break;
      case 'channels':    renderChannelsPanel(_bcSuiteData.channels || []); break;
      case 'schedule':    renderSchedulePanel({ channels: _bcSuiteData.channels || [], broadcasts: _bcSuiteData.broadcasts || [], npcs: _bcSuiteData.npcs || [] }); break;
      case 'commercials': renderCommercialsPanel(_bcSuiteData); break;
      case 'themes':      renderThemesPanel(_bcSuiteData.themes || []); break;
      case 'graphics':    renderGraphicsPanel(_bcSuiteData.graphics || []); break;
      case 'npcs':        renderBroadcastNpcsPanel(_bcSuiteData); break;
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
  _bcNpcCache = null; // invalidate NPC status cache on any refresh
  const data = await PANELS.broadcasts.fetch();
  renderBroadcastSuite(data);
}

const BROADCAST_CATEGORIES = ['general','news','advertisement','entertainment','emergency','weather','sport','music','documentary','surveillance'];
const BROADCAST_MODES      = ['scripted','dynamic_news','live','recorded'];

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
let _broadcastGraph  = null;
let _bcNewChVisible  = false;
let _bcNewActive     = false;  // true while the blank "new broadcast" canvas is open
let _bcCommNewActive = false;  // true while the blank "new commercial" canvas is open

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
  _bcNewActive    = !id;  // opening a new blank canvas

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

  if (!_bcSelected) {
    if (!_bcNewActive) {
      el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-dim);font-size:11px;font-family:var(--font)">Select a broadcast or click + New</div>`;
      return;
    }
    el.innerHTML = _bcCanvasHtml(null);
    _bcRenderCards();
    return;
  }

  el.innerHTML = _bcCanvasHtml(_bcSelected);
  _bcRenderCards();
}

function _bcCanvasHtml(rec, opts = {}) {
  const isCommercial = opts.mode === 'commercial';

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

  const saveHandler   = isCommercial ? 'saveCommercialCanvas()' : 'saveBroadcast()';
  const cancelHandler = isCommercial ? '_bcCancelNewCommercial()' : '_bcCancelNewBroadcast()';
  const delHandler    = isCommercial
    ? `deleteCommercialCanvas('${rec?.id || ''}','${escHtml(rec?.name||'').replace(/'/g,"\\'")}')`
    : `deleteBroadcast('${rec?.id || ''}','${escHtml(rec?.name||'').replace(/'/g,"\\'")}')`;
  const leftBtn = rec
    ? `<button class="action-btn danger bc-canvas-btn" onclick="${delHandler}">✕ Delete</button>`
    : `<button class="action-btn bc-canvas-btn" onclick="${cancelHandler}">Cancel</button>`;

  const categoryRow = isCommercial
    ? `<span class="bc-chip" style="font-size:11px;padding:3px 10px;color:var(--accent2);border-color:var(--accent2);letter-spacing:1px">COMMERCIAL</span>`
    : `<div style="display:flex;align-items:center;gap:6px">
         <span style="font-size:10px;color:var(--text-dim)">Category</span>
         <select id="bc-category" class="form-input" style="font-size:11px;width:130px">${catOptions}</select>
       </div>`;

  const nodeCount = Object.keys(rec?.broadcast_graph?.nodes || {}).length;

  const newChForm = `
    <div id="bc-newch-form" style="display:${_bcNewChVisible ? 'flex' : 'none'};align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap">
      <input id="bc-newch-name"   class="form-input" placeholder="Channel name"   style="width:160px;font-size:11px">
      <input id="bc-newch-number" class="form-input" placeholder="Number" type="number" min="1" style="width:72px;font-size:11px">
      <button class="action-btn primary" style="font-size:11px" onclick="_bcCreateChannel()">Create</button>
      <button class="action-btn" style="font-size:11px" onclick="_bcToggleNewCh(false)">Cancel</button>
    </div>`;

  return `
    <div style="max-width:900px;margin:0 auto;padding:24px 28px;display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:2px;background:var(--bg2)">

      <!-- Header -->
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:4px">
        <input id="bc-name" class="form-input" value="${escHtml(rec?.name || '')}" placeholder="${isCommercial ? 'Commercial name' : 'Broadcast name'}"
          style="flex:1;font-size:18px;font-weight:700;color:var(--text-bright);background:transparent;border-color:transparent;padding:4px 0;font-family:var(--font)"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='transparent'">
        ${leftBtn}
        <button class="action-btn primary bc-canvas-btn" onclick="${saveHandler}">Save</button>
      </div>

      <!-- Channel row -->
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:12px">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);min-width:56px;font-family:var(--font)">Channel</span>
        <select id="bc-channel" class="form-input" style="width:220px;font-size:12px" onchange="_bcOnChannelSelect(this.value)">${chOptions}</select>
        ${newChForm}
      </div>

      <!-- Metadata row -->
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px">
        ${categoryRow}
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
    case 'say': {
      const taId = `bc-say-ta-${idx}`, prvId = `bc-say-pv-${idx}`;
      const fmtBtns = [['B','[b]','[/b]'],['I','[i]','[/i]'],['U','[u]','[/u]'],['S','[s]','[/s]'],['~','[blink]','[/blink]'],['🌈','[rainbow]','[/rainbow]']].map(([lbl,o,c]) =>
        `<button class="action-btn" style="font-size:10px;padding:1px 5px;font-weight:bold" title="${o}${c}" onclick="_bcInsertTag('${taId}','${o}','${c}')">${lbl}</button>`).join('');
      const colorBtns = ['red','#ff8c00','yellow','lime','cyan','#7b68ee','magenta'].map(c =>
        `<button style="width:16px;height:16px;background:${c};border:1px solid var(--border);border-radius:2px;cursor:pointer;padding:0;flex-shrink:0" title="[color=${c}]" onclick="_bcInsertTag('${taId}','[color=${c}]','[/color]')"></button>`).join('');
      const gameBtns = ['danger','safe','player','item','system'].map(lbl =>
        `<button class="action-btn" style="font-size:9px;padding:1px 5px" onclick="_bcInsertTag('${taId}','[${lbl}]','[/${lbl}]')">${lbl}</button>`).join('');
      return `<div style="display:flex;flex-direction:column;gap:6px;padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim)">Text</label>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:4px 0">
          ${fmtBtns}
          <span style="width:1px;background:var(--border);height:14px;margin:0 2px"></span>
          ${colorBtns}
          <span style="width:1px;background:var(--border);height:14px;margin:0 2px"></span>
          ${gameBtns}
        </div>
        <textarea id="${taId}" class="form-input" rows="4" style="resize:vertical;font-size:12px"
          oninput="_bcCards[${idx}].text=this.value;_bcUpdateDurLabel();_bcMarkupPreview('${prvId}',this.value)">${escHtml(card.text||'')}</textarea>
        <div id="${prvId}" style="font-size:12px;line-height:1.6;padding:6px 8px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;min-height:24px;${card.text?'':'display:none'}">${_bcMarkup(card.text||'')}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:10px;color:var(--text-dim)">Style</label>
          <select class="form-input" style="width:120px;font-size:11px" oninput="_bcCards[${idx}].style=this.value">
            ${['raw','emote','narrate','system'].map(s=>`<option value="${s}" ${card.style===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }
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
    case 'npc_anchor': {
      const chType = (_bcSuiteData.channels || []).find(c => c.id === _bcSelected?.channel_id)?.channel_type;
      const anchorNote = chType && chType !== 'live'
        ? `<div style="font-size:10px;color:var(--yellow);margin-top:6px">⚠ NPC presence is only enforced on live channels. This anchor is decorative on <em>${chType}</em> channels.</div>`
        : '';
      return `<div style="padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px">NPC ID</label>
        <input class="form-input" value="${escHtml(card.npc_id||'')}" placeholder="npc_john_akerson" style="font-size:12px" ${bind('npc_id')}>
        ${anchorNote}
      </div>`;
    }
    case 'camera_cut': {
      const zoneOpts = `<option value="">— none —</option>` +
        [...(_bcSuiteData.zones || [])].sort((a,b) => (a.name||'').localeCompare(b.name||''))
          .map(z => `<option value="${escHtml(z.id)}"${card.zone_id === z.id ? ' selected' : ''}>${escHtml(z.name)} <span style="color:var(--text-dim)">(${escHtml(z.id)})</span></option>`).join('');
      return `<div style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Zone</label>
        <select class="form-input" style="font-size:12px;width:100%" oninput="_bcCards[${idx}].zone_id=this.value;_bcUpdateDurLabel()">${zoneOpts}</select></div>
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Label</label>
        <input class="form-input" value="${escHtml(card.label||'')}" placeholder="Optional label" style="font-size:12px" ${bind('label')}></div>
      </div>`;
    }
    case 'overlay': {
      const graphicOpts = `<option value="">— none —</option>` +
        [...(_bcSuiteData.graphics || [])].sort((a,b) => (a.name||'').localeCompare(b.name||''))
          .map(g => `<option value="${escHtml(g.id)}"${card.graphic_id === g.id ? ' selected' : ''}>${escHtml(g.name||g.id)}</option>`).join('');
      return `<div style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Graphic</label>
        <select class="form-input" style="font-size:12px;width:100%" oninput="_bcCards[${idx}].graphic_id=this.value">${graphicOpts}</select></div>
        <div><label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Overlay text</label>
        <textarea class="form-input" rows="2" style="font-size:12px;resize:vertical" ${bind('text')}>${escHtml(card.text||'')}</textarea></div>
      </div>`;
    }
    case 'title_card': {
      const graphicOpts = `<option value="">— none —</option>` +
        [...(_bcSuiteData.graphics || [])].sort((a,b) => (a.name||'').localeCompare(b.name||''))
          .map(g => `<option value="${escHtml(g.id)}"${card.graphic_id === g.id ? ' selected' : ''}>${escHtml(g.name||g.id)}</option>`).join('');
      return `<div style="padding-top:10px">
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px">Graphic</label>
        <select class="form-input" style="font-size:12px;width:100%" oninput="_bcCards[${idx}].graphic_id=this.value">${graphicOpts}</select>
      </div>`;
    }
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
    const newId = res.id || _bcSelected?.id;
    _bcSelected = null;
    await bcSuiteRefresh('broadcasts');
    _bcSelected = (_bcSuiteData?.broadcasts || []).find(b => b.id === newId) || null;
    if (_bcSelected) {
      _bcCards = _bcBuildCards(_bcSelected);
      _bcExpandedIdx = null;
      _bcNewActive = false;
    }
    _bcSuiteRender();
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

let _bcImportInProgress = false;
function bcImportBsm() {
  if (_bcImportInProgress) { toast('Import already in progress.', false); return; }
  if (_bcNewActive) _bcCancelNewBroadcast();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bsm,.txt';
  input.onchange = async (e) => {
    if (_bcImportInProgress) return;
    _bcImportInProgress = true;
    const file = e.target.files[0];
    input.remove();
    if (!file) { _bcImportInProgress = false; return; }
    const text = await file.text();
    let compiled;
    try { compiled = compileBsm(text); }
    catch (err) { toast(`BSM parse error: ${err.message}`, true); _bcImportInProgress = false; return; }
    console.group('[BSM Import] ' + (compiled.meta.name || file.name));
    console.table(compiled._debug?.nodeTypes || {});
    if (compiled._debug?.unknownDirectives?.length)
      console.warn('Unknown/unhandled directives:', compiled._debug.unknownDirectives);
    if (compiled._debug?.unresolvedSpeakers?.length)
      console.warn('Unresolved speaker aliases:', compiled._debug.unresolvedSpeakers);
    console.log('Actors:', compiled.actorIds);
    console.log('Rooms:', compiled.rooms);
    console.log('Assets:', compiled.assets.map(a => a.id));
    console.log('Total nodes:', Object.keys(compiled.broadcastGraph?.nodes || {}).length);
    console.groupEnd();
    if (!compiled.meta.name) { toast('BSM file is missing @broadcast name.', true); _bcImportInProgress = false; return; }
    if (compiled._debug?.unresolvedSpeakers?.length) {
      const names = compiled._debug.unresolvedSpeakers.map(u => `${u.label} → ${u.fallback}`).join(', ');
      toast(`BSM warning: speaker(s) with no alias in ::actors — ${names}. Add @alias lines or they will be created as placeholder NPCs.`, false);
    }
    _bcShowImportChannelModal(compiled);
  };
  input.click();
}

// ── BSM import — channel selection step ──────────────────────────────────────

let _bcImportChannelId  = null;  // resolved channel id for the import
let _bcImportChZone     = null;  // { x, y } picked for new channel's zone_id
let _bcImportAllZones   = [];    // cached zones for the channel zone picker
let _bcImportPending    = null;  // compiled BSM held during channel selection

async function _bcShowImportChannelModal(compiled) {
  _bcImportChannelId = null;
  _bcImportChZone    = null;
  _bcImportPending   = compiled;

  // Pre-fetch zones so the zone picker is ready
  try {
    _bcImportAllZones = await directAPI('/zones', 'GET') || [];
  } catch { _bcImportAllZones = []; }

  const isScripted = compiled.meta?.type === 'scripted';
  const chOptions = `<option value="">— no channel —</option>` +
    [..._bcChannels].sort((a, b) => (a.number || 99) - (b.number || 99))
      .map(c => `<option value="${c.id}">Ch ${c.number}: ${escHtml(c.name)}</option>`).join('') +
    `<option value="__new__">+ Create new channel…</option>`;

  const studioNamePlaceholder = isScripted ? 'e.g. Broadcast Tower' : 'e.g. KSAB Studio';

  const overlay = document.createElement('div');
  overlay.id = 'bsm-channel-overlay';
  overlay.dataset.scripted = isScripted ? '1' : '';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:700;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--accent);padding:20px;width:480px;max-width:94vw;border-radius:3px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--accent);font-size:13px;letter-spacing:2px;text-transform:uppercase">BSM Import — Assign Channel</span>
        <button onclick="document.getElementById('bsm-channel-overlay').remove()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);width:26px;height:26px;cursor:pointer;border-radius:2px;font-size:13px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim)">
        ${isScripted ? 'Scripted show — no NPC hosts required.' : 'Select a channel to assign this broadcast to, or create a new one.'}
      </div>
      <div>
        <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px">Channel</label>
        <select id="bsm-ch-select" class="form-input" style="width:100%;font-size:12px" onchange="_bcImportChSelectChange(this.value)">
          ${chOptions}
        </select>
      </div>
      <div id="bsm-new-ch-form" style="display:none;flex-direction:column;gap:10px;padding:12px;background:var(--bg3);border-radius:2px;border:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">New Channel</div>
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Name</label>
            <input id="bsm-new-ch-name" class="form-input" placeholder="Channel name" style="width:100%;font-size:12px;box-sizing:border-box">
          </div>
          <div style="width:80px">
            <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Number</label>
            <input id="bsm-new-ch-number" class="form-input" type="number" min="1" placeholder="#" style="width:100%;font-size:12px;box-sizing:border-box">
          </div>
        </div>
      </div>
      <div style="padding:12px;background:var(--bg3);border-radius:2px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Studio Zone <span style="color:var(--accent)">*</span></div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="action-btn" style="font-size:11px;white-space:nowrap" onclick="_bcImportPickChZone()">📍 Pick on map</button>
          <span id="bsm-new-ch-zone-label" style="font-size:11px;color:var(--text-dim)">No zone selected</span>
        </div>
        <div id="bsm-new-ch-studio-row" style="display:none">
          <label style="font-size:10px;color:var(--text-dim);display:block;margin-bottom:3px">Studio Zone Name</label>
          <input id="bsm-new-ch-studio-name" class="form-input" placeholder="${studioNamePlaceholder}" style="width:100%;font-size:12px;box-sizing:border-box">
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="action-btn" onclick="document.getElementById('bsm-channel-overlay').remove()">Cancel</button>
        <button class="action-btn primary" onclick="_bcImportChannelConfirm()">Continue →</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _bcImportChSelectChange(val) {
  const form = document.getElementById('bsm-new-ch-form');
  if (form) form.style.display = val === '__new__' ? 'flex' : 'none';
}

let _bcZonePickerMode = 'map'; // 'map' | 'list'

function _bcImportPickChZone() {
  _bcZonePickerMode = 'map';
  _bcZonePickerRender();
}

function _bcZonePickerRender() {
  document.getElementById('bsm-ch-picker-overlay')?.remove();
  const allZones = _bcImportAllZones;
  const picker = document.createElement('div');
  picker.id = 'bsm-ch-picker-overlay';
  picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:800;display:flex;align-items:center;justify-content:center';

  let modeContent;
  if (_bcZonePickerMode === 'list') {
    // Show only interior zones (not world map) for studio placement
    const interiorZones = allZones.filter(z => z.map_id && z.map_id !== 'map_world');
    const rows = interiorZones.map(z =>
      `<div class="bsm-ch-zone-row" data-id="${z.id}"
        onclick="_bcImportChPickExisting('${z.id}', ${JSON.stringify(escHtml(z.name)).replace(/'/g,"\\'")})"
        style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:baseline">
        <span style="font-size:11px;color:var(--text)">${escHtml(z.name)}</span>
        <span style="font-size:9px;color:var(--text-dim)">${z.id}</span>
      </div>`
    ).join('');
    modeContent = `
      <div class="bc-meta" style="margin-bottom:6px">Showing interior/building zones only. Use 🗺 World Map to create a new studio.</div>
      <input id="bsm-zone-search" class="form-input" placeholder="Search zones..." style="margin-bottom:6px"
        oninput="_bcZoneListFilter(this.value)">
      <div id="bsm-zone-list" style="overflow:auto;max-height:340px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
        ${rows || '<div class="bc-meta" style="padding:10px">No interior zones found.</div>'}
      </div>`;
  } else {
    const placed = allZones.filter(z => z.grid_x != null && z.grid_y != null && z.map_id === 'map_world');
    let minX = -3, maxX = 3, minY = -3, maxY = 3;
    if (placed.length) {
      const xs = placed.map(z => z.grid_x), ys = placed.map(z => z.grid_y);
      minX = Math.min(...xs) - 2; maxX = Math.max(...xs) + 2;
      minY = Math.min(...ys) - 2; maxY = Math.max(...ys) + 2;
    }
    const byCoord = new Map(placed.map(z => [`${z.grid_x},${z.grid_y}`, z]));
    const W = maxX - minX + 1;
    const CELL = 76;
    let cells = '';
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const z = byCoord.get(`${x},${y}`);
        if (z) {
          cells += `<div class="bsm-ch-pick-cell bsm-ch-pick-occupied" data-x="${x}" data-y="${y}" data-zone-id="${z.id}" data-zone-name="${escHtml(z.name)}" onclick="_bcImportChPickOccupied('${z.id}',${JSON.stringify(z.name)},this)" style="background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-dim);text-align:center;padding:2px;overflow:hidden;line-height:1.2;cursor:pointer" title="${z.id}">${escHtml(z.name)}</div>`;
        } else {
          cells += `<div class="bsm-ch-pick-cell" data-x="${x}" data-y="${y}" onclick="_bcImportChPickCell(${x},${y},this)" style="background:var(--bg);border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--border);cursor:pointer" title="${x},${y}">+</div>`;
        }
      }
    }
    modeContent = `
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">Click an empty cell (+) to create a new zone on the world map.</div>
      <div id="bsm-map-scroll" style="overflow:auto;max-height:400px">
        <div style="display:grid;grid-template-columns:repeat(${W},${CELL}px);grid-template-rows:repeat(${maxY - minY + 1},${Math.round(CELL * 0.65)}px);gap:2px;width:fit-content">
          ${cells}
        </div>
      </div>`;
  }

  picker.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--yellow);padding:16px;width:660px;max-width:96vw;border-radius:3px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--yellow);font-size:12px;letter-spacing:1px;text-transform:uppercase">Pick Channel Zone</span>
        <button onclick="document.getElementById('bsm-ch-picker-overlay').remove()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);width:24px;height:24px;cursor:pointer;border-radius:2px;font-size:12px">✕</button>
      </div>
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:2px;overflow:hidden;align-self:flex-start">
        <button onclick="_bcZonePickerSwitch('map')" class="action-btn" style="border:none;border-radius:0;${_bcZonePickerMode === 'map' ? 'background:var(--bg3);color:var(--accent2)' : ''}">🗺 World Map</button>
        <button onclick="_bcZonePickerSwitch('list')" class="action-btn" style="border:none;border-radius:0;border-left:1px solid var(--border);${_bcZonePickerMode === 'list' ? 'background:var(--bg3);color:var(--accent2)' : ''}">☰ Zone List</button>
      </div>
      ${modeContent}
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <span id="bsm-ch-picker-label" style="font-size:11px;color:var(--text-dim)">No zone selected</span>
        <button onclick="document.getElementById('bsm-ch-picker-overlay').remove()" class="action-btn">Cancel</button>
        <button id="bsm-ch-picker-confirm" class="action-btn primary" disabled onclick="_bcImportChPickerConfirm()">Use This Zone</button>
      </div>
    </div>`;
  document.body.appendChild(picker);
  // Scroll map to center after render
  const scroll = document.getElementById('bsm-map-scroll');
  if (scroll) {
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
    scroll.scrollTop  = (scroll.scrollHeight - scroll.clientHeight) / 2;
  }
}

function _bcZonePickerSwitch(mode) {
  _bcZonePickerMode = mode;
  _bcImportChZone = null;
  _bcZonePickerRender();
}

function _bcZoneListFilter(q) {
  const lower = q.toLowerCase();
  document.querySelectorAll('.bsm-ch-zone-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(lower) ? '' : 'none';
  });
}

function _bcImportChPickExisting(zoneId, zoneName) {
  document.querySelectorAll('.bsm-ch-zone-row').forEach(r => {
    r.style.background = r.dataset.id === zoneId ? 'color-mix(in srgb,var(--accent2) 15%,transparent)' : '';
  });
  _bcImportChZone = { existingId: zoneId, existingName: zoneName };
  const lbl = document.getElementById('bsm-ch-picker-label');
  if (lbl) lbl.textContent = `Selected: ${zoneName}`;
  const btn = document.getElementById('bsm-ch-picker-confirm');
  if (btn) btn.removeAttribute('disabled');
}

function _bcImportChPickCell(x, y, el) {
  document.querySelectorAll('.bsm-ch-pick-cell').forEach(c => {
    c.style.background = c.classList.contains('bsm-ch-pick-occupied') ? 'var(--bg3)' : 'var(--bg)';
    c.style.borderColor = 'var(--border)'; c.style.color = c.classList.contains('bsm-ch-pick-occupied') ? 'var(--text-dim)' : 'var(--border)';
  });
  el.style.background = 'color-mix(in srgb,var(--yellow) 20%,transparent)';
  el.style.borderColor = 'var(--yellow)'; el.style.color = 'var(--yellow)';
  _bcImportChZone = { x, y };
  const lbl = document.getElementById('bsm-ch-picker-label');
  if (lbl) lbl.textContent = `Selected: ${x}, ${y}`;
  const btn = document.getElementById('bsm-ch-picker-confirm');
  if (btn) btn.removeAttribute('disabled');
}

async function _bcImportChPickOccupied(zoneId, zoneName, el) {
  document.querySelectorAll('.bsm-ch-pick-cell').forEach(c => {
    c.style.background = c.classList.contains('bsm-ch-pick-occupied') ? 'var(--bg3)' : 'var(--bg)';
    c.style.borderColor = 'var(--border)'; c.style.color = c.classList.contains('bsm-ch-pick-occupied') ? 'var(--text-dim)' : 'var(--border)';
  });
  el.style.background = 'color-mix(in srgb,var(--yellow) 20%,transparent)';
  el.style.borderColor = 'var(--yellow)'; el.style.color = 'var(--accent)';

  const lbl = document.getElementById('bsm-ch-picker-label');
  if (lbl) lbl.textContent = `Checking ${zoneName}…`;

  let info = null;
  try {
    const r = await fetch('/api/broadcast/studio-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exterior_zone_id: zoneId }),
    });
    if (r.ok) info = await r.json();
  } catch (_) {}

  let studioZoneId = null;
  if (info?.stage_zone_id) {
    studioZoneId = info.stage_zone_id;
    const missing = [];
    if (info.missingUtility) missing.push('utility room');
    if (info.missingProduction) missing.push('control room');
    const detail = missing.length ? ` Missing: ${missing.join(' + ')} (will be created).` : ' Studio is complete.';
    if (lbl) lbl.textContent = `Attaching to: ${zoneName}.${detail}`;
  } else {
    if (lbl) lbl.textContent = `No studio in ${zoneName} — will create one.`;
  }

  _bcImportChZone = { exteriorId: zoneId, existingId: studioZoneId, existingName: zoneName, fromMap: true, needsEnsure: true };

  const studioRow = document.getElementById('bsm-new-ch-studio-row');
  const studioInput = document.getElementById('bsm-new-ch-studio-name');
  if (studioRow) studioRow.style.display = 'block';
  if (studioInput && !studioInput.value) {
    const chName = document.getElementById('bsm-new-ch-name')?.value?.trim();
    studioInput.value = chName ? `${chName} Studio` : '';
  }
  const btn = document.getElementById('bsm-ch-picker-confirm');
  if (btn) btn.removeAttribute('disabled');
}

function _bcImportChPickerConfirm() {
  document.getElementById('bsm-ch-picker-overlay')?.remove();
  const lbl = document.getElementById('bsm-new-ch-zone-label');
  if (!_bcImportChZone) return;

  if (_bcImportChZone.needsEnsure) {
    // Occupied tile: ensure-studio path — studio name may be needed for room creation
    if (lbl) lbl.textContent = _bcImportChZone.existingName || _bcImportChZone.exteriorId;
    const studioRow = document.getElementById('bsm-new-ch-studio-row');
    if (studioRow) studioRow.style.display = 'block';
    if (!document.getElementById('bsm-new-ch-studio-name')?.value) {
      const chName = document.getElementById('bsm-new-ch-name')?.value?.trim();
      const inp = document.getElementById('bsm-new-ch-studio-name');
      if (inp) inp.value = chName ? `${chName} Studio` : '';
    }
  } else if (_bcImportChZone.existingId) {
    // Existing zone from dropdown — no new zone needed
    if (lbl) lbl.textContent = _bcImportChZone.existingName || _bcImportChZone.existingId;
    const studioRow = document.getElementById('bsm-new-ch-studio-row');
    if (studioRow) studioRow.style.display = 'none';
  } else {
    // New zone from map (empty tile)
    if (lbl) lbl.textContent = `New zone at ${_bcImportChZone.x}, ${_bcImportChZone.y}`;
    const studioRow = document.getElementById('bsm-new-ch-studio-row');
    const studioInput = document.getElementById('bsm-new-ch-studio-name');
    if (studioRow) studioRow.style.display = 'block';
    if (studioInput && !studioInput.value) {
      const chName = document.getElementById('bsm-new-ch-name')?.value?.trim();
      const isScripted = document.getElementById('bsm-channel-overlay')?.dataset.scripted === '1';
      studioInput.value = chName ? `${chName} ${isScripted ? 'Broadcast Zone' : 'Studio'}` : '';
    }
  }
}

async function _bcImportChannelConfirm() {
  const compiled = _bcImportPending;
  const isScripted = compiled.meta?.type === 'scripted';
  const sel = document.getElementById('bsm-ch-select')?.value || '';

  if (!_bcImportChZone) { toast('Pick a studio zone on the map first.', true); return; }

  if (sel === '__new__') {
    const name   = document.getElementById('bsm-new-ch-name')?.value?.trim();
    const number = parseInt(document.getElementById('bsm-new-ch-number')?.value || '');
    if (!name)   { toast('Channel name is required.', true); return; }
    if (!number) { toast('Channel number is required.', true); return; }

    const chId = `ch_${number}_${Date.now()}`;
    const chBody = { id: chId, name, number, channel_type: 'playlist', enabled: 1 };
    if (_bcImportChZone) {
      if (_bcImportChZone.existingId && !_bcImportChZone.fromMap) {
        // Existing interior zone picked from list — use directly, no studio creation
        const zoneId = _bcImportChZone.existingId;
        if (isScripted) chBody.zone_id = zoneId;
        else chBody.studio_zone_id = zoneId;
        _bcImportStudioZoneId = zoneId;
      } else {
        // New map cell or occupied map cell — create or ensure studio
        const defaultName = isScripted ? `${name} Broadcast Zone` : `${name} Studio`;
        const zoneName = document.getElementById('bsm-new-ch-studio-name')?.value?.trim() || defaultName;
        const studioPayload = { studio_name: zoneName, channel_id: chId };
        const useEnsure = !!_bcImportChZone.needsEnsure;
        if (_bcImportChZone.exteriorId) {
          studioPayload.exterior_zone_id = _bcImportChZone.exteriorId;
        } else if (_bcImportChZone.existingId) {
          studioPayload.exterior_zone_id = _bcImportChZone.existingId;
        } else {
          studioPayload.grid_x = _bcImportChZone.x;
          studioPayload.grid_y = _bcImportChZone.y;
        }
        let studio;
        try {
          const endpoint = useEnsure ? '/broadcast/ensure-studio' : '/broadcast/create-studio';
          studio = await directAPI(endpoint, 'POST', studioPayload);
          if (studio?.error) { toast(`Studio creation failed: ${studio.error}`, true); return; }
        } catch (err) { toast(`Studio creation failed: ${err.message}`, true); return; }

        if (isScripted) chBody.zone_id = studio.studio_zone_id;
        else chBody.studio_zone_id = studio.studio_zone_id;
        _bcImportStudioZoneId   = studio.studio_zone_id;
        _bcImportStudioZoneName = zoneName;

        // Show confirmation before proceeding
        document.getElementById('bsm-channel-overlay')?.remove();
        await _bcShowStudioConfirmation(studio, zoneName, compiled, chBody, chId);
        return;
      }
    }

    try {
      const res = await directAPI('/broadcast/channels', 'POST', chBody);
      if (res?.error) { toast(res.error, true); return; }
      _bcImportChannelId = res.id || chId;
      _bcChannels.push({ ...(res || {}), id: _bcImportChannelId, name, number });
    } catch (err) { toast(err.message, true); return; }

  } else {
    _bcImportChannelId = sel || null;
    const existingCh = _bcChannels.find(c => c.id === sel) || {};

    if (_bcImportChZone.existingId && !_bcImportChZone.fromMap) {
      // List-picked existing interior zone — assign directly, no studio creation needed
      _bcImportStudioZoneId = _bcImportChZone.existingId;
      try {
        await directAPI(`/broadcast/channels/${sel}`, 'PUT', { ...existingCh, studio_zone_id: _bcImportChZone.existingId });
      } catch (err) { toast(`Failed to update channel: ${err.message}`, true); return; }
    } else {
      // New map cell or occupied map cell — create or ensure studio
      const defaultName = `${existingCh.name || 'Studio'} Studio`;
      const zoneName = document.getElementById('bsm-new-ch-studio-name')?.value?.trim() || defaultName;
      const studioPayload = { studio_name: zoneName, channel_id: sel };
      const useEnsure = !!_bcImportChZone.needsEnsure;
      if (_bcImportChZone.exteriorId) {
        studioPayload.exterior_zone_id = _bcImportChZone.exteriorId;
      } else if (_bcImportChZone.existingId) {
        studioPayload.exterior_zone_id = _bcImportChZone.existingId;
      } else {
        studioPayload.grid_x = _bcImportChZone.x;
        studioPayload.grid_y = _bcImportChZone.y;
      }
      let studio;
      try {
        const endpoint = useEnsure ? '/broadcast/ensure-studio' : '/broadcast/create-studio';
        studio = await directAPI(endpoint, 'POST', studioPayload);
        if (studio?.error) { toast(`Studio creation failed: ${studio.error}`, true); return; }
      } catch (err) { toast(`Studio creation failed: ${err.message}`, true); return; }

      _bcImportStudioZoneId   = studio.studio_zone_id;
      _bcImportStudioZoneName = zoneName;
      try {
        await directAPI(`/broadcast/channels/${sel}`, 'PUT', { ...existingCh, studio_zone_id: studio.studio_zone_id });
      } catch (err) { toast(`Failed to update channel: ${err.message}`, true); return; }

      document.getElementById('bsm-channel-overlay')?.remove();
      await _bcShowStudioConfirmation(studio, zoneName, compiled, null, sel);
      return;
    }
  }

  document.getElementById('bsm-channel-overlay')?.remove();
  await _bcImportDependencies(compiled);
}

async function _bcShowStudioConfirmation(studio, studioName, compiled, chBody, chId) {
  const rows = [
    ['Studio lot',       studio.exterior_zone_id,   'Outdoor zone / entrance'],
    ['Stage floor',      studio.studio_zone_id,     'Camera area (entry via "in")'],
    ['Utility room',     studio.utility_zone_id,    'Junction box + power (down from stage)'],
    ['Production room',  studio.production_zone_id, 'Media deck (up from stage)'],
  ].map(([label, id, note]) => `
    <div style="display:grid;grid-template-columns:120px 1fr;gap:4px;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;color:var(--text-dim)">${label}</span>
      <div>
        <div style="font-size:11px;color:var(--accent2)">${escHtml(id || '—')}</div>
        <div style="font-size:9px;color:var(--text-dim)">${note}</div>
      </div>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'bsm-studio-confirm-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:700;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--green);padding:20px;width:480px;max-width:94vw;border-radius:3px;display:flex;flex-direction:column;gap:14px">
      <div style="color:var(--green);font-size:13px;letter-spacing:2px;text-transform:uppercase">✓ Studio Created</div>
      <div style="font-size:11px;color:var(--text-dim)">The following zones and infrastructure were created for <strong style="color:var(--text)">${escHtml(studioName)}</strong>:</div>
      <div>${rows}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="action-btn primary" onclick="_bcStudioConfirmContinue()">Continue Import →</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // Store pending channel body for the continue action
  window._bcPendingChBody    = chBody;
  window._bcPendingChId      = chId;
  window._bcPendingChName    = chBody?.name ?? null;
  window._bcPendingChNum     = chBody?.number ?? null;
  window._bcPendingCompiled  = compiled;
}

async function _bcStudioConfirmContinue() {
  document.getElementById('bsm-studio-confirm-overlay')?.remove();
  const { _bcPendingChBody: chBody, _bcPendingChId: chId, _bcPendingChName: name, _bcPendingChNum: number, _bcPendingCompiled: compiled } = window;
  if (chBody) {
    try {
      const res = await directAPI('/broadcast/channels', 'POST', chBody);
      if (res?.error) { toast(res.error, true); return; }
      _bcImportChannelId = res.id || chId;
      _bcChannels.push({ ...(res || {}), id: _bcImportChannelId, name, number });
    } catch (err) { toast(err.message, true); return; }
  }
  // Run world validator to fix any dangling exits from studio creation
  directAPI('/worldvalidator/run-full', 'POST', { autoRepair: true }).catch(() => {});
  await _bcImportDependencies(compiled);
}

// ── BSM dependency resolver ───────────────────────────────────────────────────

let _bcDepCompiled = null;
let _bcDepPending  = new Set();
let _bcPickerZoneId   = null;
let _bcPickerSelected = null;
let _bcPickerOutdoorId = null;   // outdoor zone chosen in step 1
let _bcPickerAllZones  = [];     // zones snapshot for multi-step picker
let _bcZoneRemap = {};           // { bsmZoneId: realZoneId } — applied at save
let _bcImportStudioZoneId   = null;
let _bcImportStudioZoneName = null;

async function _bcImportDependencies(compiled) {
  _bcZoneRemap = {};
  const isScripted = compiled.meta?.type === 'scripted';
  const [allZones, allNpcs] = await Promise.all([
    directAPI('/zones', 'GET'), directAPI('/npcs', 'GET'),
  ]);
  const zoneIds  = new Set((allZones || []).map(z => z.id));
  const npcDbIds = new Set((allNpcs  || []).map(n => n.id));
  _bcExistingNpcIds = npcDbIds;
  const missingZones = compiled.rooms.filter(id => !zoneIds.has(id));
  // NPCs are always auto-created in _bcImportSave — never block the import on them.
  if (!missingZones.length) { await _bcImportSave(compiled); return; }
  _bcDepCompiled = compiled;
  _bcDepPending  = new Set(missingZones);
  _bcShowDepModal([], missingZones, allZones || []);
}

function _bcShowDepModal(missingNpcs, missingZones, allZones) {
  const npcRows = missingNpcs.map(id => `
    <div id="dep-row-${CSS.escape(id)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg3);border-radius:2px">
      <span style="flex:1;font-size:12px;color:var(--text)">NPC <span style="color:var(--cyan)">${escHtml(id)}</span></span>
      <span id="dep-status-${CSS.escape(id)}" style="font-size:10px;color:var(--text-dim)">missing</span>
      <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="_bcCreateNpc('${id}')">Create NPC</button>
    </div>`).join('');

  const zoneRows = missingZones.map(id => {
    const studioBtn = _bcImportStudioZoneId
      ? `<button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="_bcUseStudioZone('${id}')">Use ${escHtml(_bcImportStudioZoneName || _bcImportStudioZoneId)}</button>`
      : '';
    return `
    <div id="dep-row-${CSS.escape(id)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg3);border-radius:2px">
      <span style="flex:1;font-size:12px;color:var(--text)">Zone <span style="color:var(--yellow)">${escHtml(id)}</span></span>
      <span id="dep-status-${CSS.escape(id)}" style="font-size:10px;color:var(--text-dim)">missing</span>
      ${studioBtn}
      <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="_bcShowZonePicker('${id}')">Place on Map</button>
    </div>`;
  }).join('');

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

function _bcUseStudioZone(bsmId) {
  if (!_bcImportStudioZoneId) return;
  if (bsmId !== _bcImportStudioZoneId) _bcZoneRemap[bsmId] = _bcImportStudioZoneId;
  _bcMarkResolved(bsmId);
  toast(`Zone "${bsmId}" → "${_bcImportStudioZoneName || _bcImportStudioZoneId}"`);
}

let _bcExistingNpcIds = new Set(); // populated during dependency check

async function _bcCreateNpc(id) {
  if (_bcExistingNpcIds.has(id)) { _bcMarkResolved(id); return; }
  const name = id.replace(/^npc_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  try {
    const res = await directAPI('/npcs', 'POST', {
      id, name, description: `${name}. Edit this description.`, zone_id: null,
      behaviour_graph: _bcDefaultStudioGraph(),
    });
    if (res?.error) { toast(res.error, true); return; }
    _bcMarkResolved(id);
  } catch (err) { toast(err.message, true); }
}

// ── Dep zone picker — 3-step: outdoor zone → building → interior confirm ────────

function _bcShowZonePicker(zoneId) {
  _bcPickerZoneId    = zoneId;
  _bcPickerSelected  = null;
  _bcPickerOutdoorId = null;
  const overlay = document.getElementById('bsm-dep-overlay');
  _bcPickerAllZones  = overlay?._allZones || _bcImportAllZones || [];
  _bcShowOutdoorPicker();
}

function _bcShowOutdoorPicker() {
  document.getElementById('bsm-picker-overlay')?.remove();
  const allZones = _bcPickerAllZones;
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
        cells += `<div class="bsm-pick-outdoor" data-id="${escHtml(z.id)}"
          onclick="_bcOutdoorPickExisting('${escHtml(z.id)}')"
          style="background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text);text-align:center;padding:2px;overflow:hidden;line-height:1.2;cursor:pointer"
          onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'"
          title="${escHtml(z.id)}">${escHtml(z.name)}</div>`;
      } else {
        cells += `<div class="bsm-pick-cell" data-x="${x}" data-y="${y}"
          onclick="_bcOutdoorPickNewCell(${x},${y},this)"
          style="background:var(--bg);border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--border);cursor:pointer"
          title="${x},${y}">+</div>`;
      }
    }
  }
  const picker = document.createElement('div');
  picker.id = 'bsm-picker-overlay';
  picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:800;display:flex;align-items:center;justify-content:center';
  picker.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--yellow);padding:16px;width:660px;max-width:96vw;border-radius:3px;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--yellow);font-size:12px;letter-spacing:1px;text-transform:uppercase">Place <strong>${escHtml(_bcPickerZoneId)}</strong> — Pick Outdoor Zone</span>
        <button onclick="document.getElementById('bsm-picker-overlay').remove()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);width:24px;height:24px;cursor:pointer;border-radius:2px;font-size:12px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim)">Click an existing outdoor zone or an empty cell (+) to auto-create a new one. A stage building will be created inside it.</div>
      <div style="overflow:auto;max-height:400px">
        <div style="display:grid;grid-template-columns:repeat(${W},${CELL}px);grid-template-rows:repeat(${H},${Math.round(CELL*0.65)}px);gap:2px;width:fit-content">
          ${cells}
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="document.getElementById('bsm-picker-overlay').remove()" class="action-btn">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(picker);
}

async function _bcOutdoorPickExisting(outdoorZoneId) {
  _bcPickerOutdoorId = outdoorZoneId;
  const studioName = _bcPickerZoneId.split('/').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const cell = document.querySelector(`.bsm-pick-outdoor[data-id="${CSS.escape(outdoorZoneId)}"]`);
  const origText = cell?.textContent;
  if (cell) { cell.textContent = '…'; cell.style.opacity = '0.6'; cell.style.pointerEvents = 'none'; }
  try {
    const studio = await directAPI('/broadcast/create-studio', 'POST', { studio_name: studioName, exterior_zone_id: outdoorZoneId });
    if (studio?.error) {
      toast(`Stage creation failed: ${studio.error}`, true);
      if (cell) { cell.textContent = origText; cell.style.opacity = ''; cell.style.pointerEvents = ''; }
      return;
    }
    _bcPickerAllZones = await directAPI('/zones', 'GET') || _bcPickerAllZones;
    document.getElementById('bsm-picker-overlay')?.remove();
    _bcShowInteriorConfirm(studio.studio_zone_id, studioName, outdoorZoneId);
  } catch (err) {
    toast(`Stage creation failed: ${err.message}`, true);
    if (cell) { cell.textContent = origText; cell.style.opacity = ''; cell.style.pointerEvents = ''; }
  }
}

async function _bcOutdoorPickNewCell(x, y, el) {
  document.querySelectorAll('.bsm-pick-cell').forEach(c => {
    c.style.background = 'var(--bg)'; c.style.borderColor = 'var(--border)'; c.style.color = 'var(--border)';
  });
  el.style.background = 'color-mix(in srgb,var(--yellow) 20%,transparent)';
  el.style.borderColor = 'var(--yellow)'; el.style.color = 'var(--yellow)';
  el.textContent = '…'; el.style.pointerEvents = 'none';
  const studioName = _bcPickerZoneId.split('/').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  try {
    const studio = await directAPI('/broadcast/create-studio', 'POST', { studio_name: studioName, grid_x: x, grid_y: y });
    if (studio?.error) { toast(`Stage creation failed: ${studio.error}`, true); el.textContent = '+'; el.style.pointerEvents = ''; return; }
    _bcPickerAllZones = await directAPI('/zones', 'GET') || _bcPickerAllZones;
    document.getElementById('bsm-picker-overlay')?.remove();
    _bcShowInteriorConfirm(studio.studio_zone_id, studioName, studio.exterior_zone_id);
  } catch (err) { toast(`Stage creation failed: ${err.message}`, true); el.textContent = '+'; el.style.pointerEvents = ''; }
}

// ── Step 3: interior confirm ───────────────────────────────────────────────────

function _bcShowInteriorConfirm(interiorZoneId, interiorZoneName, outdoorZoneId) {
  document.getElementById('bsm-picker-overlay')?.remove();
  const zone = _bcPickerAllZones.find(z => z.id === interiorZoneId)
    || { id: interiorZoneId, name: interiorZoneName, description: '' };
  const backFn = '_bcShowOutdoorPicker()';
  const remapNote = interiorZoneId !== _bcPickerZoneId
    ? `<div style="font-size:10px;color:var(--yellow);padding:6px 0">⚠ BSM ID <code>${escHtml(_bcPickerZoneId)}</code> will be remapped to <code>${escHtml(interiorZoneId)}</code> on import.</div>`
    : '';
  const picker = document.createElement('div');
  picker.id = 'bsm-picker-overlay';
  picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:800;display:flex;align-items:center;justify-content:center';
  picker.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--accent);padding:20px;width:460px;max-width:96vw;border-radius:3px;display:flex;flex-direction:column;gap:14px">
      <span style="color:var(--accent);font-size:12px;letter-spacing:1px;text-transform:uppercase">Place <strong>${escHtml(_bcPickerZoneId)}</strong> — Confirm Stage</span>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:2px;padding:12px;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:13px;font-weight:600;color:var(--text-bright)">${escHtml(zone.name || interiorZoneId)}</div>
        <div style="font-size:10px;color:var(--text-dim);font-family:monospace">${escHtml(zone.id)}</div>
        ${zone.description ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px">${escHtml(zone.description)}</div>` : ''}
      </div>
      ${remapNote}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="${backFn}" class="action-btn">← Back</button>
        <button class="action-btn primary" onclick="_bcInteriorConfirm('${escHtml(interiorZoneId)}')">Use This Zone ✓</button>
      </div>
    </div>`;
  document.body.appendChild(picker);
}

function _bcInteriorConfirm(interiorZoneId) {
  const bsmId = _bcPickerZoneId;
  document.getElementById('bsm-picker-overlay')?.remove();
  if (interiorZoneId !== bsmId) _bcZoneRemap[bsmId] = interiorZoneId;
  _bcMarkResolved(bsmId);
  toast(`Zone "${bsmId}" → "${interiorZoneId}"`);
}

async function _bcDepFinish() {
  document.getElementById('bsm-dep-overlay')?.remove();
  if (_bcDepCompiled) await _bcImportSave(_bcDepCompiled);
}

async function _bcImportSave({ meta, broadcastGraph, messages, assets, cameras, actorIds }) {
  // Apply zone ID remaps to camera_cut nodes (BSM ID → real interior zone ID)
  for (const node of Object.values(broadcastGraph?.nodes || {})) {
    if (node.type === 'camera_cut') {
      if (_bcZoneRemap[node.zone_id]) node.zone_id = _bcZoneRemap[node.zone_id];
      // Default empty zone_id to the studio stage zone created during import
      if (!node.zone_id && _bcImportStudioZoneId) node.zone_id = _bcImportStudioZoneId;
    }
  }
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
  // Use channel selected during import; fall back to @channel directive
  const channelId = _bcImportChannelId !== undefined && _bcImportChannelId !== null
    ? _bcImportChannelId
    : (meta.channel
        ? (_bcChannels.find(c => c.id === meta.channel || String(c.number) === meta.channel)?.id || null)
        : null);

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
    if (res?.error) { toast(`Import failed (saving broadcast): ${res.error}`, true); return; }
    const nodeCount = Object.keys(broadcastGraph.nodes).length;

    // Auto-spawn media deck in production/control room + cameras on stage floor
    const camNums = Array.isArray(cameras) ? cameras : [];
    if (_bcImportChannelId && _bcImportStudioZoneId) {
      try {
        const deckRes = await directAPI('/broadcast/deck', 'POST', {
          channel_id: _bcImportChannelId, auto_place: true, no_camera: true,
        });
        if (deckRes?.error) console.warn('[BSM] Media deck spawn failed:', deckRes.error);
        const ts = Date.now();
        if (camNums.length) {
          const camResults = await Promise.all(camNums.map((num, idx) =>
            directAPI('/broadcast/cameras', 'POST', {
              id: `cam_${_bcImportChannelId}_${num}_${ts + idx}`,
              zone_id: _bcImportStudioZoneId,
              direction: 'all',
              is_powered: 1, is_recording: 0, is_streaming: 1,
              streaming_channel_id: _bcImportChannelId,
              storage_limit: 200,
              permissions: 'public',
            })
          ));
          const camErrors = camResults.filter(r => r?.error);
          if (camErrors.length) console.warn(`[BSM] ${camErrors.length} camera(s) failed:`, camErrors.map(r => r.error));
        }
        // Spawn declared actors in studio zone if they don't already exist
        let npcSpawnCount = 0;
        const existingNpcIds = _bcExistingNpcIds instanceof Set ? _bcExistingNpcIds : new Set();
        const actors = [...new Set(Array.isArray(actorIds) ? actorIds : [])];
        for (const npcId of actors) {
          if (existingNpcIds.has(npcId)) continue;
          try {
            const npcRes = await directAPI('/npcs', 'POST', {
                id: npcId, name: npcId.replace(/^npc_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                description: 'A broadcast studio host.',
                zone_id: _bcImportStudioZoneId, home_zone: _bcImportStudioZoneId,
                wanders: 0, wander_zones: [],
                dialogue_tree: {}, vendor_inventory: [], flags: { studio_npc: true },
                behaviour_graph: _bcDefaultStudioGraph(),
              });
            if (npcRes?.error) console.warn(`[BSM] NPC spawn failed for ${npcId}:`, npcRes.error);
            else npcSpawnCount++;
          } catch (npcErr) { console.warn(`[BSM] NPC spawn error for ${npcId}:`, npcErr.message); }
        }
        const camNote = camNums.length ? `, ${camNums.length} camera(s) spawned` : '';
        const npcNote = npcSpawnCount ? `, ${npcSpawnCount} NPC(s) spawned` : '';
        toast(`Imported "${meta.name}" — ${messages.length} messages, ${nodeCount} graph nodes${assets.length ? `, ${assets.length} asset(s)` : ''}${camNote}${npcNote}.`);
      } catch (camErr) {
        toast(`Imported "${meta.name}" — broadcast saved, but studio setup failed: ${camErr.message}`, true);
      }
    } else {
      toast(`Imported "${meta.name}" — ${messages.length} messages, ${nodeCount} graph nodes${assets.length ? `, ${assets.length} asset(s)` : ''}.`);
    }

    await bcSuiteRefresh('broadcasts');
  } catch (err) { toast(`Import error: ${err.message}`, true); console.error('[BSM] _bcImportSave threw:', err); }
  _bcImportInProgress = false;
}

function _bcCancelImport() {
  document.getElementById('bsm-channel-overlay')?.remove();
  document.getElementById('bsm-studio-confirm-overlay')?.remove();
  document.getElementById('bsm-dep-overlay')?.remove();
  _bcImportInProgress = false;
}

// ── Commercials Tab ───────────────────────────────────────────────────────────

let _bcCommSelected = null;

function renderCommercialsPanel(data) {
  const el = document.getElementById('list-panel');
  const ads = (data?.broadcasts || []).filter(b => b.category === 'advertisement');

  // Sync selected object from fresh data, then sync broadcast canvas state
  if (_bcCommSelected) _bcCommSelected = ads.find(b => b.id === _bcCommSelected.id) || null;
  _bcSelected = _bcCommSelected;
  _bcCards    = _bcBuildCards(_bcCommSelected);

  const sidebar = ads.map(b => {
    const dur = b.override_duration || ((Array.isArray(b.messages) ? b.messages.length : 0) * (b.message_interval || 5)) || 30;
    const active = _bcCommSelected?.id === b.id;
    return `<div onclick="_bcCommSelect('${b.id}')"
      style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);
             background:${active ? 'var(--bg3)' : 'transparent'};
             border-left:3px solid ${active ? 'var(--accent2)' : 'transparent'}">
      <div class="bc-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(b.name)}</div>
      <div class="bc-meta">${Math.round(dur)}s · ${b.messages?.length || 0} msgs</div>
    </div>`;
  }).join('') || `<div class="bc-meta" style="padding:12px">No advertisements yet</div>`;

  el.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden">
      <div style="width:220px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)">
        <div style="padding:8px;border-bottom:1px solid var(--border);display:flex;gap:4px;flex-shrink:0">
          <button class="action-btn" style="flex:1;font-size:11px" onclick="_bcCommNew()">+ New</button>
          <button class="action-btn" style="font-size:11px" title="Import .bsm file" onclick="_bcCommImportBsm()">↑ BSM</button>
        </div>
        <div style="flex:1;overflow-y:auto">${sidebar}</div>
      </div>
      <div style="flex:1;overflow:auto;padding:16px">${(_bcCommSelected || _bcCommNewActive)
        ? _bcCanvasHtml(_bcCommSelected, { mode: 'commercial' })
        : `<div style="padding:32px;text-align:center;color:var(--text-dim);font-size:11px;font-family:var(--font)">Select a commercial or click + New</div>`
      }</div>
    </div>`;

  if (_bcCommSelected || _bcCommNewActive) _bcRenderCards();
}

function _bcCommSelect(id) {
  _bcCommSelected  = (_bcSuiteData?.broadcasts || []).find(b => b.id === id) || null;
  _bcCommNewActive = false;
  _bcSuiteRender();
}

function _bcCommEditor(bc, channels) {
  // Which channels include this commercial in their pool
  const poolChannels = channels.filter(ch => {
    const pool = Array.isArray(ch.commercial_pool) ? ch.commercial_pool : (ch.commercial_pool ? JSON.parse(ch.commercial_pool) : []);
    return pool.includes(bc.id);
  });
  const poolList = poolChannels.length
    ? poolChannels.map(c => `<span class="bc-chip">${escHtml(c.name)}</span>`).join(' ')
    : `<span class="bc-meta">Not assigned to any channels</span>`;

  const msgs = Array.isArray(bc.messages) ? bc.messages : [];
  const dur = bc.override_duration || (msgs.length * (bc.message_interval || 5)) || 30;

  return `
    <div style="max-width:640px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <input class="form-input" id="bc-comm-name" value="${escHtml(bc.name)}"
          style="flex:1;font-size:13px;font-weight:600" onblur="_bcCommSaveMeta()">
        <button class="action-btn danger" onclick="_bcCommDelete('${bc.id}')">Delete</button>
      </div>

      <div class="bc-section">
        <div class="bc-section-head">Timing</div>
        <div class="bc-section-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label class="bc-label">Interval (sec between messages)</label>
            <input class="form-input" type="number" id="bc-comm-interval" value="${bc.message_interval || 5}" min="1" onblur="_bcCommSaveMeta()">
          </div>
          <div>
            <label class="bc-label">Override duration (sec)</label>
            <input class="form-input" type="number" id="bc-comm-duration" value="${bc.override_duration || ''}" min="1" placeholder="auto (${Math.round(dur)}s)" onblur="_bcCommSaveMeta()">
          </div>
        </div>
      </div>

      <div class="bc-section">
        <div class="bc-section-head" style="justify-content:space-between">
          Messages
          <button class="action-btn" style="font-size:10px" onclick="_bcCommAddMsg('${bc.id}')">+ Add</button>
        </div>
        <div class="bc-section-body" style="display:flex;flex-direction:column;gap:6px">
          ${msgs.length
            ? msgs.map((m, i) => {
              const taId = `bc-comm-ta-${bc.id}-${i}`, pvId = `bc-comm-pv-${bc.id}-${i}`;
              return `<div style="display:flex;gap:6px;align-items:flex-start">
                <span class="bc-meta" style="padding-top:6px;min-width:20px">${i + 1}.</span>
                <div style="flex:1;display:flex;flex-direction:column;gap:3px">
                  <textarea id="${taId}" class="form-input" rows="2" style="width:100%;font-size:11px;resize:vertical"
                    oninput="_bcMarkupPreview('${pvId}',this.value)"
                    onblur="_bcCommSaveMsg('${bc.id}',${i},this.value)">${escHtml(m)}</textarea>
                  <div id="${pvId}" style="font-size:11px;line-height:1.5;padding:4px 6px;background:var(--bg3);border:1px solid var(--border);border-radius:2px;${m?'':'display:none'}">${_bcMarkup(m)}</div>
                </div>
                <button class="action-btn danger" style="padding:2px 6px;font-size:10px;margin-top:2px" onclick="_bcCommDelMsg('${bc.id}',${i})">✕</button>
              </div>`;
            }).join('')
            : `<div class="bc-meta">No messages yet</div>`}
        </div>
      </div>

      <div class="bc-section">
        <div class="bc-section-head">Channel Pool Membership</div>
        <div class="bc-section-body">${poolList}</div>
      </div>
    </div>`;
}

function _bcCancelNewBroadcast() {
  _bcNewActive = false;
  _bcSelected  = null;
  _bcCards     = [];
  _bcRenderCanvas();
}

function _bcCancelNewCommercial() {
  _bcCommNewActive = false;
  _bcCommSelected  = null;
  _bcSuiteRender();
}

function _bcCommNew() {
  _bcCommNewActive = true;
  _bcCommSelected  = null;
  _bcSuiteRender();
}

async function saveCommercialCanvas() {
  const name = document.getElementById('bc-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }
  const { graph, messages } = _bcRebuildGraph();
  const body = {
    name,
    description:       _bcSelected?.description || '',
    category:          'advertisement',
    playback_mode:     document.getElementById('bc-mode')?.value || 'scripted',
    message_interval:  parseFloat(document.getElementById('bc-interval')?.value || 5),
    override_duration: parseFloat(document.getElementById('bc-override-dur')?.value || '') || null,
    loop:              document.getElementById('bc-loop')?.checked    ? 1 : 0,
    enabled:           document.getElementById('bc-enabled')?.checked ? 1 : 0,
    messages,
    broadcast_graph:   graph,
    channel_id:        document.getElementById('bc-channel')?.value || null,
    fallback_messages: (document.getElementById('bc-fallback-msgs')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
  };
  const isNew = !_bcSelected;
  const path   = isNew ? '/broadcast/broadcasts' : `/broadcast/broadcasts/${_bcSelected.id}`;
  const method = isNew ? 'POST' : 'PUT';
  try {
    const res = await directAPI(path, method, body);
    if (res?.error) { toast(res.error, true); return; }
    const newId = res.id || _bcSelected?.id;
    toast(isNew ? 'Commercial created.' : 'Commercial saved.');
    _bcCommSelected = null; // will be re-set after fresh data arrives
    await bcSuiteRefresh('commercials');
    _bcCommSelected = (_bcSuiteData?.broadcasts || []).find(b => b.id === newId) || null;
    if (_bcCommSelected) _bcSuiteRender();
  } catch (err) { toast(err.message, true); }
}

async function deleteCommercialCanvas(id, name) {
  if (!id) return;
  if (!confirm(`Delete commercial "${name}"? This cannot be undone.`)) return;
  try {
    const res = await directAPI(`/broadcast/broadcasts/${id}`, 'DELETE');
    if (res?.error) { toast(res.error, true); return; }
    _bcCommSelected = null;
    _bcSelected     = null;
    toast('Commercial deleted.');
    await bcSuiteRefresh('commercials');
  } catch (err) { toast(err.message, true); }
}

function _bcCommImportBsm() {
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
    await _bcCommSaveBsm(compiled);
  };
  input.click();
}

async function _bcCommSaveBsm({ meta, broadcastGraph, messages, assets }) {
  for (const asset of assets) {
    try { await directAPI('/broadcast/graphics', 'POST', asset); }
    catch { try { await directAPI(`/broadcast/graphics/${asset.id}`, 'PUT', asset); } catch {} }
  }
  let method = 'POST', path = '/broadcast/broadcasts';
  const ads = (_bcSuiteData?.broadcasts || []).filter(b => b.category === 'advertisement');
  const existing = ads.find(b => b.name === meta.name);
  if (existing) {
    const overwrite = confirm(`A commercial named "${meta.name}" already exists.\n\nOK = overwrite   Cancel = create copy`);
    if (overwrite) { method = 'PUT'; path = `/broadcast/broadcasts/${existing.id}`; }
    else meta.name += ' (imported)';
  }
  const body = {
    name: meta.name, category: 'advertisement',
    playback_mode: 'scripted', message_interval: 5,
    override_duration: meta.length || null, loop: 0, enabled: 1,
    messages: messages.map(t => ({ text: t })),
    broadcast_graph: broadcastGraph,
  };
  const res = await directAPI(path, method, body);
  if (res?.error) { toast(res.error, true); return; }
  toast(`Imported commercial "${meta.name}".`);
  await bcSuiteRefresh('commercials');
}

async function _bcCommSaveMeta() {
  if (!_bcCommSelected) return;
  const name     = document.getElementById('bc-comm-name')?.value?.trim();
  const interval = parseInt(document.getElementById('bc-comm-interval')?.value) || 5;
  const duration = parseInt(document.getElementById('bc-comm-duration')?.value) || null;
  if (!name) return;
  const res = await directAPI(`/broadcast/broadcasts/${_bcCommSelected.id}`, 'PUT', {
    ..._bcCommSelected, name, message_interval: interval, override_duration: duration || null,
  });
  if (res?.error) { toast(res.error, true); return; }
  _bcCommSelected.name             = name;
  _bcCommSelected.message_interval = interval;
  _bcCommSelected.override_duration = duration || null;
  await bcSuiteRefresh('commercials');
}

async function _bcCommAddMsg(bcId) {
  const bc = (_bcSuiteData?.broadcasts || []).find(b => b.id === bcId);
  if (!bc) return;
  const msgs = Array.isArray(bc.messages) ? [...bc.messages, 'New message'] : ['New message'];
  const res = await directAPI(`/broadcast/broadcasts/${bcId}`, 'PUT', { ...bc, messages: msgs });
  if (res?.error) { toast(res.error, true); return; }
  await bcSuiteRefresh('commercials');
}

async function _bcCommSaveMsg(bcId, idx, val) {
  const bc = (_bcSuiteData?.broadcasts || []).find(b => b.id === bcId);
  if (!bc) return;
  const msgs = Array.isArray(bc.messages) ? [...bc.messages] : [];
  msgs[idx] = val;
  const res = await directAPI(`/broadcast/broadcasts/${bcId}`, 'PUT', { ...bc, messages: msgs });
  if (res?.error) { toast(res.error, true); return; }
  await bcSuiteRefresh('commercials');
}

async function _bcCommDelMsg(bcId, idx) {
  const bc = (_bcSuiteData?.broadcasts || []).find(b => b.id === bcId);
  if (!bc) return;
  const msgs = Array.isArray(bc.messages) ? bc.messages.filter((_, i) => i !== idx) : [];
  const res = await directAPI(`/broadcast/broadcasts/${bcId}`, 'PUT', { ...bc, messages: msgs });
  if (res?.error) { toast(res.error, true); return; }
  await bcSuiteRefresh('commercials');
}

async function _bcCommDelete(bcId) {
  if (!confirm('Delete this commercial?')) return;
  const res = await directAPI(`/broadcast/broadcasts/${bcId}`, 'DELETE');
  if (res?.error) { toast(res.error, true); return; }
  _bcCommSelected = null;
  await bcSuiteRefresh('commercials');
}

// ── NPC helpers ───────────────────────────────────────────────────────────────

function _bcDefaultStudioGraph() {
  return {
    _start: 'n_start',
    nodes: {
      n_start:  { type: 'start',  next: 'n_life' },
      n_life:   { type: 'action', action_type: 'HAVE_LIFE',  next: 'n_work' },
      n_work:   { type: 'action', action_type: 'GO_TO_WORK', next: 'n_atwork' },
      n_atwork: { type: 'action', action_type: 'AT_WORK',    next: 'n_wait' },
      n_wait:   { type: 'wait',   seconds: 30,               next: 'n_loop' },
      n_loop:   { type: 'loop',   next: 'n_start' },
    },
  };
}

// ── NPC Status Tab ────────────────────────────────────────────────────────────

let _bcNpcExpanded  = null;   // currently-expanded NPC id
let _bcNpcCache     = null;   // { rows, gameSec } — cached render data

function renderBroadcastNpcsPanel(data) {
  const el = document.getElementById('list-panel');
  // If we have cached data, render immediately (toggle expand without reload)
  if (_bcNpcCache) { _bcNpcDraw(el); return; }
  el.innerHTML = `<div style="padding:16px;color:var(--text-dim);font-size:12px">Loading NPC status…</div>`;
  _bcNpcLoad(data, el).catch(err =>
    el.innerHTML = `<div style="padding:16px;color:var(--red);font-size:12px">Error: ${escHtml(err.message)}</div>`
  );
}

async function _bcNpcLoad(data, el) {
  // Collect NPC IDs referenced as npc_anchor in any broadcast graph
  const npcIdSet = new Set();
  for (const bc of (data.broadcasts || [])) {
    const g = typeof bc.broadcast_graph === 'object' ? bc.broadcast_graph
              : (bc.broadcast_graph ? JSON.parse(bc.broadcast_graph) : null);
    if (!g?.nodes) continue;
    for (const node of Object.values(g.nodes)) {
      const nid = node.data?.npc_id || node.npc_id;
      if (node.type === 'npc_anchor' && nid) npcIdSet.add(nid);
    }
  }

  // Channels with studio zones running daily schedules
  const channels = data.channels || [];
  const dailyStudios = channels.filter(c => c.schedule_mode === 'daily' && c.studio_zone_id);

  // Fetch game time and all relevant playlists in parallel
  const [envState, ...playlists] = await Promise.all([
    directAPI('/environment/state'),
    ...dailyStudios.map(ch => directAPI(`/broadcast/channels/${ch.id}/playlist`).catch(() => [])),
  ]);

  const [hh, mm] = (envState.time || '0:0').split(':').map(Number);
  const gameSecNow = (hh || 0) * 3600 + (mm || 0) * 60;

  // Build: npcId → { isNow, isFuture, studioZoneId }
  const npcSchedule = new Map();
  dailyStudios.forEach((ch, idx) => {
    for (const item of (Array.isArray(playlists[idx]) ? playlists[idx] : [])) {
      const cond = typeof item.conditions === 'object' ? item.conditions : JSON.parse(item.conditions || '{}');
      const staff = Array.isArray(cond.npc_staff) ? cond.npc_staff : [];
      const start = item.start_time || 0;
      const dur   = item.duration_override || 3600;
      const isNow    = gameSecNow >= start && gameSecNow < start + dur;
      const isFuture = start > gameSecNow;
      for (const npcId of staff) {
        const e = npcSchedule.get(npcId) || { isNow: false, isFuture: false, studioZoneId: ch.studio_zone_id };
        if (isNow)              e.isNow    = true;
        if (isFuture && !e.isNow) e.isFuture = true;
        e.studioZoneId = e.studioZoneId || ch.studio_zone_id;
        npcSchedule.set(npcId, e);
      }
    }
  });

  const zones   = data.zones || [];
  const zoneMap = new Map(zones.map(z => [z.id, z.name]));
  const npcs    = (data.npcs || []).filter(n => npcIdSet.has(n.id));

  _bcNpcCache = { npcs, npcSchedule, zoneMap };
  _bcNpcDraw(el);
}

function _bcNpcStatus(npc, npcSchedule) {
  const sched = npcSchedule.get(npc.id);
  if (!sched) return { label: 'Not Scheduled', color: 'var(--text-dim)' };
  const atStudio = npc.zone_id === sched.studioZoneId;
  if (sched.isNow) {
    if (atStudio) return { label: 'At Work',  color: 'var(--green)'    };
    return           { label: 'Late',         color: 'var(--red)'      };
  }
  if (sched.isFuture) return { label: 'Scheduled', color: 'var(--yellow)' };
  return               { label: 'Not Scheduled', color: 'var(--text-dim)' };
}

function _bcNpcOpenSidebar(npcId) {
  if (!_bcNpcCache) return;
  const npc = _bcNpcCache.npcs.find(n => n.id === npcId);
  if (!npc) return;
  _bcNpcExpanded = npcId;
  // Render into the standard edit-panel sidebar so the tab bar stays visible
  const editPanel = document.getElementById('edit-panel');
  const editTitle = document.getElementById('edit-title');
  const editBody  = document.getElementById('edit-body');
  const editFooter = editPanel?.querySelector('.edit-footer');
  if (!editPanel || !editBody) return;
  editTitle.textContent = `NPC: ${npc.name}`;
  editBody.innerHTML = npcEditForm(npc, false);
  if (editFooter) {
    editFooter.innerHTML = `
      <button class="action-btn success" style="flex:1" onclick="_bcNpcSaveSidebar('${escHtml(npcId)}')">Save NPC</button>
      <button class="action-btn" onclick="closeEdit()">Cancel</button>`;
  }
  editPanel.classList.add('open');
}

async function _bcNpcSaveSidebar(npcId) {
  const npc = _bcNpcCache?.npcs.find(n => n.id === npcId);
  if (!npc) return;
  const result = await saveNpc(npc);
  if (result?.error) { toast(result.error, true); return; }
  toast(result?.staged ? 'Staged — publish to apply' : (result?.message || 'NPC saved'));
  _bcNpcCache = null;
  closeEdit();
  await bcSuiteRefresh('npcs');
}

function _bcNpcDraw(el) {
  if (!_bcNpcCache) return;
  const { npcs, npcSchedule, zoneMap } = _bcNpcCache;

  if (!npcs.length) {
    el.innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:12px">No NPCs are referenced as npc_anchor nodes in any broadcast.</div>`;
    return;
  }

  const rows = npcs.map(npc => {
    const { label, color } = _bcNpcStatus(npc, npcSchedule);
    const zoneName = npc.zone_id ? (zoneMap.get(npc.zone_id) || npc.zone_id) : '—';
    return `
      <div style="border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;user-select:none"
             onclick="_bcNpcOpenSidebar('${escHtml(npc.id)}')">
          <span style="min-width:160px;font-size:13px;font-weight:600;color:var(--text)">${escHtml(npc.name)}</span>
          <span style="min-width:120px;font-size:11px;font-weight:600;color:${color}">${label}</span>
          <span style="flex:1;font-size:11px;color:var(--text-dim)" title="${escHtml(npc.zone_id || '')}">${escHtml(zoneName)}</span>
          <span style="font-size:10px;color:var(--text-dim)">✏</span>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div>
      <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;
                  border-bottom:2px solid var(--border);background:var(--bg2)">
        <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;min-width:160px">NPC</span>
        <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;min-width:120px">Work Status</span>
        <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;flex:1">Active Zone</span>
        <button class="action-btn" style="font-size:10px;padding:3px 10px" onclick="_bcRecalcSchedules(this)">⟳ Recalculate Schedules</button>
      </div>
      ${rows}
    </div>`;
}


async function _bcRecalcSchedules(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Working…'; }
  try {
    const res = await directAPI('/broadcast/recalculate-schedules', 'POST', {});
    if (res?.error) { toast(res.error, true); return; }
    toast(res.message || 'Schedules recalculated.');
    _bcNpcCache = null;
    await bcSuiteRefresh('npcs');
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Recalculate Schedules'; }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
