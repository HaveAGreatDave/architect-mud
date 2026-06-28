const USERS_TAB = '__users__';
const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

// Channels devpanel admins always have access to
const CHANNELS = [
  { id: '#system', permanent: true, systemOnly: true },
  { id: '#arcnet', permanent: true, systemOnly: false },
];

let _panelOpen = false;
let _activeTab = '#system';
const _convos = new Map(); // tabKey → { messages: [], unread: 0 }
let _onlinePlayers = [];
let _pollTimer = null;
let _lastPollTs = Date.now(); // ms timestamp; poll fetches messages since this
let _myHandle = null;

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _getConvo(key) {
  if (!_convos.has(key)) _convos.set(key, { messages: [], unread: 0 });
  return _convos.get(key);
}

// ── Presence ──────────────────────────────────────────────────────────────────

async function _sendPresence() {
  if (!_myHandle) return;
  try { await API('/admin/presence', 'POST', { handle: _myHandle }); } catch {}
}

// ── Online Players ────────────────────────────────────────────────────────────

async function _fetchOnline() {
  try {
    const data = await API('/players/online');
    _onlinePlayers = Array.isArray(data) ? data.filter(p => p.handle !== _myHandle) : [];
  } catch { _onlinePlayers = []; }
  if (_panelOpen && _activeTab === USERS_TAB) _renderLog();
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function _poll() {
  const since = _lastPollTs;
  _lastPollTs = Date.now();
  try {
    const data = await API(`/channels/messages?since=${since}`);
    for (const [channelId, messages] of Object.entries(data || {})) {
      for (const m of messages) {
        _receiveChannelMsg(channelId, m.from, m.message);
      }
    }
  } catch {}
}

function _startPoll() {
  if (_pollTimer) return;
  _pollTimer = setInterval(_poll, 3000);
}

function _stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ── MOTD ──────────────────────────────────────────────────────────────────────

function _applyMotdSubstitutions(template, handle, dynamicText) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let text = template;
  text = text.replace(/<player name>( *)/g, (_, spaces) => handle + spaces);
  text = text.replace(/<date>/g, date);
  text = text.replace(/^(.*?)<dynamic text>( *)(║?)$/gm, (_, prefix, spaces, rborder) => {
    const totalSpace = spaces.length + 14;
    const dyn = dynamicText || '';
    if (!rborder || dyn.length <= totalSpace) {
      return prefix + dyn + ' '.repeat(Math.max(0, totalSpace - dyn.length)) + rborder;
    }
    const contLeft = rborder + ' '.repeat(prefix.length - 1);
    const words = dyn.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (test.length > totalSpace) { if (cur) lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    if (!lines.length) return prefix + ' '.repeat(totalSpace) + rborder;
    return lines.map((l, i) => {
      const pad = ' '.repeat(Math.max(0, totalSpace - l.length));
      return (i === 0 ? prefix : contLeft) + l + pad + rborder;
    }).join('\n');
  });
  return text;
}

async function _loadMotd() {
  try {
    const data = await API('/motd');
    if (!data || data.error) return;
    const template = data.small || data.medium || data.big || '';
    if (!template) return;
    const rendered = _applyMotdSubstitutions(template, _myHandle || 'Admin', data.dynamic || '');
    const convo = _getConvo('#system');
    convo.messages = [{
      from: 'SYSTEM',
      message: rendered,
      isMOTD: true,
      ts: Date.now(),
    }];
    if (_panelOpen && _activeTab === '#system') _renderLog();
  } catch {}
}

// ── Channel history on open ───────────────────────────────────────────────────

async function _loadChannelHistory() {
  try {
    const data = await API('/channels/messages?since=0');
    for (const [channelId, messages] of Object.entries(data || {})) {
      const convo = _getConvo(channelId);
      if (convo.messages.length === 0) {
        for (const m of messages) {
          convo.messages.push({ from: m.from, message: m.message, ts: m.ts });
        }
      }
    }
    _lastPollTs = Date.now();
  } catch {}
}

// ── Toggle / open ─────────────────────────────────────────────────────────────

function toggleWhisperPanel() {
  _panelOpen = !_panelOpen;
  const panel = document.getElementById('whisper-panel');
  panel.style.display = _panelOpen ? 'flex' : 'none';
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = _panelOpen ? 'var(--accent)' : '';
  if (_panelOpen) {
    _switchTab(_activeTab);
    _fetchOnline();
    _startPoll();
    document.getElementById('whisper-input')?.focus();
  } else {
    _stopPoll();
  }
}

function openWhisper(id, handle) {
  const convo = _getConvo(handle);
  convo.unread = 0;
  convo.playerId = id;  // cache so send doesn't need to re-fetch
  _switchTab(handle);
  if (!_panelOpen) {
    _panelOpen = true;
    document.getElementById('whisper-panel').style.display = 'flex';
    const btn = document.getElementById('whisper-nav-btn');
    if (btn) btn.style.color = 'var(--accent)';
    _startPoll();
  }
  document.getElementById('whisper-input')?.focus();
}

function closeWhisper() {
  _panelOpen = false;
  document.getElementById('whisper-panel').style.display = 'none';
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = '';
  _stopPoll();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function _switchTab(key) {
  _activeTab = key;
  const convo = _convos.get(key);
  if (convo) convo.unread = 0;
  _refreshTabs();
  _renderLog();
  const footer = document.getElementById('whisper-footer');
  if (footer) {
    const isUsers = key === USERS_TAB;
    const isSysOnly = CHANNELS.find(c => c.id === key)?.systemOnly;
    footer.style.display = (isUsers || isSysOnly) ? 'none' : 'flex';
  }
  if (key === USERS_TAB) _fetchOnline();
}

function _refreshTabs() {
  const tabs = document.getElementById('whisper-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';

  const mkTab = (label, key, color) => {
    const active = _activeTab === key;
    const convo = _convos.get(key);
    const btn = document.createElement('button');
    btn.style.cssText = `position:relative;background:${active ? 'var(--bg3)' : 'transparent'};border:1px solid ${active ? color : 'var(--border)'};color:${active ? color : 'var(--text-dim)'};font-family:var(--font);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;white-space:nowrap;flex-shrink:0`;
    btn.textContent = label;
    btn.onclick = () => _switchTab(key);
    if (convo?.unread > 0) {
      const pip = document.createElement('span');
      pip.textContent = '!';
      pip.style.cssText = 'position:absolute;top:-5px;left:-5px;background:var(--red);color:#fff;font-size:9px;font-weight:bold;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;pointer-events:none';
      btn.appendChild(pip);
    }
    tabs.appendChild(btn);
  };

  mkTab('Users', USERS_TAB, 'var(--purple)');
  for (const ch of CHANNELS) mkTab(ch.id, ch.id, 'var(--yellow)');

  // DM tabs (non-channel convos)
  for (const [key] of _convos) {
    if (key === USERS_TAB || CHANNELS.find(c => c.id === key)) continue;
    const active = _activeTab === key;
    const convo = _convos.get(key);
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:inline-flex;align-items:center;gap:4px;flex-shrink:0;position:relative;background:${active ? 'var(--bg3)' : 'transparent'};border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:2px;padding:2px 4px 2px 8px;cursor:pointer`;
    wrap.onclick = () => _switchTab(key);
    if (convo?.unread > 0) {
      const pip = document.createElement('span');
      pip.textContent = '!';
      pip.style.cssText = 'position:absolute;top:-5px;left:-5px;background:var(--red);color:#fff;font-size:9px;font-weight:bold;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;pointer-events:none';
      wrap.appendChild(pip);
    }
    const lbl = document.createElement('span');
    lbl.style.cssText = `color:${active ? 'var(--accent)' : 'var(--text-dim)'};font-family:var(--font);font-size:10px;white-space:nowrap`;
    lbl.textContent = key;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:transparent;border:1px solid var(--border);color:var(--text-dim);font-size:11px;line-height:1;width:16px;height:16px;padding:0;cursor:pointer;border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0';
    closeBtn.onclick = e => { e.stopPropagation(); _closeTab(key); };
    wrap.appendChild(lbl);
    wrap.appendChild(closeBtn);
    tabs.appendChild(wrap);
  }
}

function _closeTab(key) {
  _convos.delete(key);
  if (_activeTab === key) _switchTab(USERS_TAB);
  else _refreshTabs();
}

// ── Log render ────────────────────────────────────────────────────────────────

function _renderLog() {
  const log = document.getElementById('whisper-log');
  if (!log) return;
  if (_activeTab === USERS_TAB) { _renderUsersTab(log); return; }
  const convo = _convos.get(_activeTab);
  log.innerHTML = '';
  if (!convo || convo.messages.length === 0) {
    log.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px 0">No messages yet.</div>';
    return;
  }
  for (const m of convo.messages) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border)';
    if (m.isMOTD) {
      el.innerHTML = `<pre style="font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;tab-size:4;color:var(--text);font-size:9pt">${_esc(m.message)}</pre>`;
    } else {
      el.innerHTML = `<div style="font-size:10px;color:var(--text-dim);margin-bottom:2px">${_esc(m.from)}</div><div style="color:var(--text)">${_esc(m.message)}</div>`;
    }
    log.appendChild(el);
  }
  log.scrollTop = log.scrollHeight;
}

function _renderUsersTab(log) {
  let html = '<div style="padding:4px 0 8px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Channels</div>';
  for (const ch of CHANNELS) {
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--yellow)">${ch.id}</span><button data-channel="${_esc(ch.id)}" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font);font-size:9px;padding:2px 6px;cursor:pointer;border-radius:2px">open</button></div>`;
  }
  html += '<div style="padding:10px 0 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Online now</div>';
  html += _onlinePlayers.length
    ? _onlinePlayers.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text)">${_esc(p.handle)}${p.current_zone === null ? ' <span style="color:var(--text-dim);font-size:10px">[dev]</span>' : ''}</span><button data-whisper="${_esc(p.handle)}" data-id="${_esc(p.id)}" style="background:transparent;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0 2px;line-height:1">💬</button></div>`).join('')
    : '<div style="padding:8px 0;color:var(--text-dim);font-size:11px">No players online.</div>';
  html += '<div style="padding:6px 0"><button id="whisper-refresh-btn" style="width:100%;background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:4px;cursor:pointer;border-radius:2px">↻ Refresh</button></div>';
  log.innerHTML = html;
  log.querySelectorAll('[data-channel]').forEach(btn => {
    btn.addEventListener('click', () => { _getConvo(btn.dataset.channel); _switchTab(btn.dataset.channel); });
  });
  log.querySelectorAll('[data-whisper]').forEach(btn => {
    btn.addEventListener('click', () => openWhisper(btn.dataset.id, btn.dataset.whisper));
  });
  log.querySelector('#whisper-refresh-btn')?.addEventListener('click', _fetchOnline);
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function _sendMessage() {
  const input = document.getElementById('whisper-input');
  const msg = input?.value?.trim();
  if (!msg || _activeTab === USERS_TAB) return;

  const ch = CHANNELS.find(c => c.id === _activeTab);
  if (ch) {
    if (ch.systemOnly) return;
    const r = await API(`/channels/${encodeURIComponent(_activeTab.replace(/^#/,''))}/message`, 'POST', { message: msg, handle: _myHandle || 'Admin' });
    if (r?.error) { toast(r.error, true); return; }
    input.value = '';
    return;
  }

  // DM — use cached player ID from when the tab was opened, fall back to online list
  const convo = _getConvo(_activeTab);
  const pid = convo.playerId || _onlinePlayers.find(p => p.handle === _activeTab)?.id;
  if (!pid) { toast(`${_activeTab} is not online.`, true); return; }
  const r = await API(`/players/${pid}/whisper`, 'POST', { message: msg });
  if (r?.error) { toast(r.error, true); return; }
  const convo = _getConvo(_activeTab);
  convo.messages.push({ from: _myHandle || 'Admin', message: msg });
  input.value = '';
  _renderLog();
}

// ── Receive ───────────────────────────────────────────────────────────────────

function _receiveChannelMsg(channelId, from, message) {
  if (!CHANNELS.find(c => c.id === channelId)) return;
  const convo = _getConvo(channelId);
  // Skip duplicates (same from+message within 2s - can happen on send)
  const last = convo.messages[convo.messages.length - 1];
  if (last && last.from === from && last.message === message) return;
  convo.messages.push({ from, message, ts: Date.now() });
  if (convo.messages.length > 100) convo.messages.shift();
  if (_panelOpen && _activeTab === channelId) {
    _renderLog();
  } else {
    convo.unread++;
    _refreshTabs();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initWhisperPanel() {
  _myHandle = typeof devHandle !== 'undefined' ? devHandle : null;
  for (const ch of CHANNELS) _getConvo(ch.id);
  _refreshTabs();
  _renderLog();

  document.getElementById('whisper-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _sendMessage();
  });
  document.getElementById('whisper-send-btn')?.addEventListener('click', _sendMessage);

  // Close button
  document.querySelector('#whisper-panel [data-close]')?.addEventListener('click', closeWhisper);

  // Drag
  const dragHandle = document.getElementById('whisper-drag-handle');
  const panel = document.getElementById('whisper-panel');
  let dragState = null;

  dragHandle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    dragState = { pointerId: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top };
    dragHandle.setPointerCapture(e.pointerId);
    dragHandle.style.cursor = 'grabbing';
  });

  dragHandle.addEventListener('pointermove', e => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    const x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  e.clientX - dragState.ox));
    const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - dragState.oy));
    panel.style.left   = x + 'px';
    panel.style.top    = y + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
  });

  const _endDrag = e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } };
  document.addEventListener('pointerup', _endDrag);
  document.addEventListener('pointercancel', _endDrag);

  _loadMotd();
  _loadChannelHistory();
  _sendPresence();
  setInterval(_sendPresence, 2 * 60 * 1000);
}
