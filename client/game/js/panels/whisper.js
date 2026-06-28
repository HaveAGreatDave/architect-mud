import { sendCmdSilent } from '../net.js';
import { state } from '../state.js';
import { parseMarkup, expandTokens, MARKUP_HELP_HTML, STATUS_TEMPLATE } from '../markup.js';

const USERS_TAB = '__users__';
const WHISPER_MAX_MSGS = 100;
const WHISPER_CONVO_KEY = 'whisper_convos';
const WHISPER_PERSIST_MAX = 100;

// Channels the server told us this player has access to: id -> { id, permanent, systemOnly }
const _channels = new Map();

let _whisperPanelVisible = false;
let _activeWhisperTab = USERS_TAB;
const _whisperConvos = new Map();
let _onlinePlayers = [];

// Window/text size settings
let _windowSize = 'small';   // 'small' | 'medium' | 'large'
let _textSize   = 'medium';  // 'small' | 'medium' | 'large'

// Stored MOTD data received from server (raw templates + dynamic text)
let _motdData = null;
let _motdDims = {}; // { big:{w,h}, medium:{w,h}, small:{w,h} } — cached from off-screen measure

const FONT_SIZES = { small: '5pt', medium: '8pt', large: '11pt' };

function _loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('whisper_settings') || '{}');
    if (['small','medium','large'].includes(s.windowSize)) _windowSize = s.windowSize;
    if (['small','medium','large'].includes(s.textSize))   _textSize   = s.textSize;
  } catch {}
}

function _saveSettings() {
  try { localStorage.setItem('whisper_settings', JSON.stringify({ windowSize: _windowSize, textSize: _textSize })); } catch {}
}

function _saveConvos() {
  try {
    const toSave = {};
    for (const [handle, convo] of _whisperConvos) {
      if (_channels.has(handle) || handle === USERS_TAB) continue;
      toSave[handle] = convo.messages.slice(-WHISPER_PERSIST_MAX);
    }
    if (Object.keys(toSave).length === 0) return;
    localStorage.setItem(WHISPER_CONVO_KEY, JSON.stringify(toSave));
    console.log('[whisper] saved convos:', Object.keys(toSave));
  } catch (e) {
    console.error('[whisper] save failed:', e);
  }
}

function _loadConvos() {
  try {
    const raw = localStorage.getItem(WHISPER_CONVO_KEY);
    console.log('[whisper] loading convos, raw key present:', raw !== null);
    const saved = JSON.parse(raw || '{}');
    for (const [handle, messages] of Object.entries(saved)) {
      if (!Array.isArray(messages) || messages.length === 0) continue;
      _whisperConvos.set(handle, { messages, scrollTop: 999999, unread: 0 });
    }
    console.log('[whisper] loaded handles:', [..._whisperConvos.keys()]);
  } catch (e) {
    console.error('[whisper] load failed:', e);
  }
}

export function initChannels(channelList) {
  for (const ch of (channelList || [])) {
    _channels.set(ch.id, ch);
    if (!_whisperConvos.has(ch.id)) _whisperConvos.set(ch.id, { messages: [], scrollTop: 0, unread: 0 });
  }
}

function _isSystemOnly(tabKey) {
  return _channels.has(tabKey) && _channels.get(tabKey).systemOnly;
}

// ── MOTD ──────────────────────────────────────────────────────────────────────

function _selectMotdSize() {
  if (_windowSize === 'large')  return 'big';
  if (_windowSize === 'medium') return 'medium';
  return 'small';
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _applyMotdSubstitutions(template, handle, dynamicText) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let text = template;

  text = text.replace(/<player name>( *)/g, (_, spaces) => handle + spaces);
  text = text.replace(/<date>/g, date);

  // <dynamic text> substitution: replace placeholder, preserving line width.
  // totalSpace = placeholder width (14) + trailing spaces — the full chars available for dyn.
  // Word-wraps onto continuation lines (║-indented) when dyn exceeds totalSpace.
  text = text.replace(/^(.*?)<dynamic text>( *)(║?)$/gm, (_, prefix, spaces, rborder) => {
    const totalSpace = spaces.length + 14;
    const dyn = dynamicText || '';

    if (!rborder || dyn.length <= totalSpace) {
      return prefix + dyn + ' '.repeat(Math.max(0, totalSpace - dyn.length)) + rborder;
    }

    // Word-wrap: continuation lines left-indent to match prefix depth
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

// Render each MOTD off-screen to measure natural width + height.
// Cached in _motdDims so _applyWindowSize can size the panel immediately,
// even when #system is not the active tab.
function _measureMotdDims() {
  if (!_motdData) return;
  const handle = document.getElementById('handle-display')?.textContent?.trim() || 'Player';
  const fs     = FONT_SIZES[_textSize];

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:-9999px;left:0;visibility:hidden;pointer-events:none;width:max-content';
  document.body.appendChild(host);

  for (const size of ['big', 'medium', 'small']) {
    const template = _motdData[size] || '';
    if (!template) { _motdDims[size] = { w: 0, h: 0 }; continue; }
    const rendered = _applyMotdSubstitutions(template, handle, _motdData.dynamic || '');
    const pre = document.createElement('pre');
    pre.style.cssText = `font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;font-size:${fs}`;
    pre.textContent = rendered;
    host.appendChild(pre);
    const rect = pre.getBoundingClientRect();
    _motdDims[size] = {
      w: Math.ceil(rect.width)  + 40, // +10+10px log padding +2px border +17px scrollbar
      h: Math.ceil(rect.height) + 82, // +10+10px log padding +2px border +26px drag handle +34px tabs row
    };
    host.removeChild(pre);
  }

  document.body.removeChild(host);
}

function _setSystemMOTD(renderedText) {
  const channelId = '#system';
  if (!_whisperConvos.has(channelId)) _whisperConvos.set(channelId, { messages: [], scrollTop: 0, unread: 0 });
  const convo   = _whisperConvos.get(channelId);
  const isFirst = convo.messages.length === 0;
  convo.messages = [{
    from: 'SYSTEM',
    message: `<pre style="font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;tab-size:4">${_esc(renderedText)}</pre>`,
    isMe: false,
    isHtml: true,
    ts: Date.now(),
  }];
  convo.unread    = 0;
  convo.scrollTop = 0;
  if (isFirst) {
    _activeWhisperTab = channelId; // default to #system when panel is opened, but don't open it
  } else if (_activeWhisperTab === channelId) {
    // Re-render immediately whenever #system is active, panel open or closed
    _renderWhisperLog();
    const log = document.getElementById('whisper-log');
    if (log) log.scrollTop = 0;
  } else {
    if (_whisperPanelVisible) _refreshWhisperTabs();
  }
}

function _rerenderMotd() {
  if (!_motdData) return;
  const size     = _selectMotdSize();
  const template = _motdData[size] || '';
  if (!template) return;
  const handle = document.getElementById('handle-display')?.textContent?.trim() || 'Player';
  const text   = _applyMotdSubstitutions(template, handle, _motdData.dynamic || '');
  _setSystemMOTD(text);
}

export function receiveMOTD(msg) {
  _motdData = { big: msg.big || '', medium: msg.medium || '', small: msg.small || '', dynamic: msg.dynamic || '' };
  _measureMotdDims();
  _applyWindowSize(); // update panel width now that widths are known
  _rerenderMotd();
}

// ── PANEL SIZE / TEXT SIZE ────────────────────────────────────────────────────

function _applyWindowSize() {
  const panel   = document.getElementById('whisper-panel');
  const content = document.getElementById('whisper-content');
  if (!panel) return;

  const motdKey   = _selectMotdSize(); // 'big' | 'medium' | 'small'
  const dims      = _motdDims[motdKey];
  const fallbackW = { small: 300, medium: 500, large: 700 }[_windowSize];
  const fallbackH = { small: 340, medium: 480, large: 600 }[_windowSize];
  const maxW      = Math.floor(window.innerWidth  * 0.95);
  const maxH      = Math.floor(window.innerHeight * 0.92);

  panel.style.width        = Math.min(Math.max(dims?.w || fallbackW, 150), maxW) + 'px';
  panel.style.height       = Math.min(Math.max(dims?.h || fallbackH, 150), maxH) + 'px';
  panel.style.right        = '8px';
  panel.style.bottom       = '8px';
  panel.style.left         = 'auto';
  panel.style.top          = 'auto';
  panel.style.borderRadius = '4px';

  if (content) {
    content.style.transform = '';
    content.style.width     = '';
  }

  _refreshCogMenu();
}

function _applyTextSize() {
  const fs  = FONT_SIZES[_textSize];
  const log = document.getElementById('whisper-log');
  if (log) log.style.fontSize = fs;
  const inp = document.getElementById('whisper-reply-input');
  if (inp) inp.style.fontSize = fs;
  _refreshCogMenu();
}

function _refreshCogMenu() {
  const menu = document.getElementById('whisper-cog-menu');
  if (!menu) return;
  menu.querySelectorAll('[data-winsize]').forEach(btn => {
    const active = btn.dataset.winsize === _windowSize;
    btn.style.background   = active ? 'var(--bg3)'    : 'transparent';
    btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border)';
    btn.style.color        = active ? 'var(--accent)' : 'var(--text-dim)';
  });
  menu.querySelectorAll('[data-txtsize]').forEach(btn => {
    const active = btn.dataset.txtsize === _textSize;
    btn.style.background   = active ? 'var(--bg3)'    : 'transparent';
    btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border)';
    btn.style.color        = active ? 'var(--accent)' : 'var(--text-dim)';
  });
}

// ── PANEL TOGGLE / TAB OPEN ───────────────────────────────────────────────────

export function toggleWhisperPanel() {
  _whisperPanelVisible = !_whisperPanelVisible;
  const panel = document.getElementById('whisper-panel');
  panel.style.display = _whisperPanelVisible ? 'flex' : 'none';
  if (_whisperPanelVisible) {
    _applyWindowSize();
    _applyTextSize();
    _switchToTab(_activeWhisperTab);
    if (_activeWhisperTab !== USERS_TAB) document.getElementById('whisper-reply-input')?.focus();
  }
  _updateChatBadge();
}

export function openWhisperTab(handle) {
  if (!_whisperConvos.has(handle)) {
    _whisperConvos.set(handle, { messages: [], scrollTop: 0, unread: 0 });
  }
  _whisperConvos.get(handle).unread = 0;
  _switchToTab(handle);
  if (!_whisperPanelVisible) {
    _whisperPanelVisible = true;
    const panel = document.getElementById('whisper-panel');
    panel.style.display = 'flex';
    _applyWindowSize();
    _applyTextSize();
  }
  if (!_isSystemOnly(handle)) document.getElementById('whisper-reply-input')?.focus();
  _updateChatBadge();
}

function _switchToTab(key) {
  _activeWhisperTab = key;
  const convo = _whisperConvos.get(key);
  if (convo) convo.unread = 0;
  _updateChatBadge();
  _refreshWhisperTabs();
  _renderWhisperLog();
  const footer = document.getElementById('whisper-footer');
  if (footer) footer.style.display = (key === USERS_TAB || _isSystemOnly(key)) ? 'none' : 'flex';
  if (key === USERS_TAB) _fetchOnlinePlayers();
}

function _closeWhisperTab(handle) {
  if (_channels.has(handle) && _channels.get(handle).permanent) return;
  _whisperConvos.delete(handle);
  _channels.delete(handle);
  _saveConvos();
  if (_activeWhisperTab === handle) _switchToTab(USERS_TAB);
  else { _refreshWhisperTabs(); _updateChatBadge(); }
}

// ── TABS ──────────────────────────────────────────────────────────────────────

function _refreshWhisperTabs() {
  const tabs = document.getElementById('whisper-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';

  const mkSimpleTab = (label, active, color, onClick) => {
    const t = document.createElement('button');
    t.style.cssText = `background:${active?'var(--bg3)':'transparent'};border:1px solid ${active?color:'var(--border)'};color:${active?color:'var(--text-dim)'};font-family:var(--font-mono);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;white-space:nowrap;flex-shrink:0`;
    t.textContent = label;
    t.onclick = onClick;
    tabs.appendChild(t);
  };

  const mkClosableTab = (label, handle, active, onOpen, onClose) => {
    const borderColor = active ? 'var(--accent)' : 'var(--border)';
    const textColor   = active ? 'var(--accent)' : 'var(--text-dim)';
    const bg          = active ? 'var(--bg3)' : 'transparent';
    const convo       = _whisperConvos.get(handle);

    const wrap = document.createElement('div');
    wrap.style.cssText = `display:inline-flex;align-items:center;gap:5px;flex-shrink:0;position:relative;background:${bg};border:1px solid ${borderColor};border-radius:2px;padding:2px 4px 2px 8px;cursor:pointer`;
    wrap.addEventListener('click', onOpen);

    if (convo?.unread > 0) {
      const pip = document.createElement('span');
      pip.textContent = '!';
      pip.style.cssText = 'position:absolute;top:-5px;left:-5px;background:var(--red);color:#fff;font-size:9px;font-weight:bold;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;pointer-events:none';
      wrap.appendChild(pip);
    }

    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = `color:${textColor};font-family:var(--font-mono);font-size:10px;white-space:nowrap`;
    labelSpan.textContent = label;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.style.cssText = `background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:11px;line-height:1;width:16px;height:16px;padding:0;cursor:pointer;border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0`;
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--red)'; closeBtn.style.color = 'var(--red)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--border)'; closeBtn.style.color = 'var(--text-dim)'; });
    closeBtn.addEventListener('click', e => { e.stopPropagation(); onClose(); });

    wrap.appendChild(labelSpan);
    wrap.appendChild(closeBtn);
    tabs.appendChild(wrap);
  };

  mkSimpleTab('Users', _activeWhisperTab === USERS_TAB, 'var(--purple)', () => _switchToTab(USERS_TAB));

  // Channel tabs
  for (const [id, ch] of _channels) {
    const active = _activeWhisperTab === id;
    const convo  = _whisperConvos.get(id);
    if (ch.permanent) {
      const color = active ? 'var(--yellow)' : 'var(--border)';
      const t = document.createElement('button');
      t.style.cssText = `position:relative;background:${active?'var(--bg3)':'transparent'};border:1px solid ${color};color:${active?'var(--yellow)':'var(--text-dim)'};font-family:var(--font-mono);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;white-space:nowrap;flex-shrink:0`;
      t.textContent = id;
      t.onclick = () => _switchToTab(id);
      if (convo?.unread > 0) {
        const pip = document.createElement('span');
        pip.textContent = '!';
        pip.style.cssText = 'position:absolute;top:-5px;left:-5px;background:var(--red);color:#fff;font-size:9px;font-weight:bold;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;pointer-events:none';
        t.appendChild(pip);
      }
      tabs.appendChild(t);
    } else {
      mkClosableTab(id, id, active, () => openWhisperTab(id), () => _closeWhisperTab(id));
    }
  }

  // Player whisper tabs
  for (const [handle] of _whisperConvos) {
    if (_channels.has(handle)) continue;
    const active = handle === _activeWhisperTab;
    mkClosableTab(handle, handle, active, () => openWhisperTab(handle), () => _closeWhisperTab(handle));
  }
}

// ── LOG RENDER ────────────────────────────────────────────────────────────────

function _renderWhisperLog() {
  const log = document.getElementById('whisper-log');
  if (!log) return;
  if (_activeWhisperTab === USERS_TAB) {
    _renderUsersTab(log);
    document.getElementById('whisper-new-msgs').style.display = 'none';
    return;
  }
  const convo = _whisperConvos.get(_activeWhisperTab);
  if (!convo) return;
  log.innerHTML = '';
  for (const m of convo.messages) {
    const entry = document.createElement('div');
    entry.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border)';
    const nameColor = m.isMe ? 'var(--text-dim)' : 'var(--purple)';
    const body = m.isHtml ? m.message : parseMarkup(m.message);
    entry.innerHTML = `<div style="color:${nameColor};margin-bottom:2px;font-style:${m.isMe?'italic':''}">${_esc(m.from)}</div><div style="color:var(--text)">${body}</div>`;
    log.appendChild(entry);
  }
  // Use ?? so scrollTop=0 (MOTD top) is respected; fall back to bottom for chat
  log.scrollTop = convo.scrollTop != null ? convo.scrollTop : log.scrollHeight;
  _checkWhisperScroll();
}

function _renderUsersTab(log) {
  let html = '';

  if (_channels.size > 0) {
    html += '<div style="padding:8px 10px 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Channels</div>';
    for (const [id] of _channels) {
      const h = id.replace(/"/g, '&quot;');
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--yellow)">${id}</span><button data-channel="${h}" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font-mono);font-size:9px;padding:2px 6px;cursor:pointer;border-radius:2px">open</button></div>`;
    }
  }

  html += '<div style="padding:8px 10px 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Online now</div>'
    + (_onlinePlayers.length
      ? _onlinePlayers.map(p => {
          const h = p.handle.replace(/"/g, '&quot;');
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text)">${_esc(p.handle)}</span><button data-whisper="${h}" title="Whisper ${_esc(p.handle)}" style="background:transparent;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0 2px;line-height:1">💬</button></div>`;
        }).join('')
      : '<div style="padding:10px 10px;color:var(--text-dim);font-size:11px">No other players online.</div>')
    + '<div style="padding:6px 10px"><button data-refresh-online style="width:100%;background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:4px;cursor:pointer;border-radius:2px">↻ Refresh</button></div>';

  log.innerHTML = html;

  log.querySelectorAll('[data-channel]').forEach(btn => {
    btn.addEventListener('click', () => openWhisperTab(btn.dataset.channel));
  });
  log.querySelectorAll('[data-whisper]').forEach(btn => {
    btn.addEventListener('click', () => openWhisperTab(btn.dataset.whisper));
  });
  log.querySelector('[data-refresh-online]')?.addEventListener('click', _fetchOnlinePlayers);
}

// ── ONLINE PLAYERS ────────────────────────────────────────────────────────────

export async function refreshOnlinePlayers() {
  await _fetchOnlinePlayers();
}

async function _fetchOnlinePlayers() {
  try {
    const r = await fetch('/api/players/online');
    const data = await r.json();
    const myHandle = document.getElementById('handle-display')?.textContent?.trim();
    _onlinePlayers = Array.isArray(data) ? data.filter(p => p.handle !== myHandle) : [];
  } catch { _onlinePlayers = []; }
  if (_whisperPanelVisible && _activeWhisperTab === USERS_TAB) {
    _renderUsersTab(document.getElementById('whisper-log'));
  }
}

// ── SCROLL ────────────────────────────────────────────────────────────────────

function _checkWhisperScroll() {
  const log  = document.getElementById('whisper-log');
  const pill = document.getElementById('whisper-new-msgs');
  if (!log || !pill) return;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  if (nearBottom) pill.style.display = 'none';
}

function whisperScrollToBottom() {
  const log = document.getElementById('whisper-log');
  if (log) log.scrollTop = log.scrollHeight;
  document.getElementById('whisper-new-msgs').style.display = 'none';
}

// ── SEND / RECEIVE ────────────────────────────────────────────────────────────

export function sentWhisper(handle, message) {
  if (!_whisperConvos.has(handle)) _whisperConvos.set(handle, { messages: [], scrollTop: 0, unread: 0 });
  const convo = _whisperConvos.get(handle);
  convo.messages.push({ from: 'You', message, isMe: true, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  _saveConvos();
  openWhisperTab(handle);
  const log = document.getElementById('whisper-log');
  if (log) log.scrollTop = log.scrollHeight;
}

export function receiveWhisper(from, message) {
  if (!_whisperConvos.has(from)) _whisperConvos.set(from, { messages: [], scrollTop: 0, unread: 0 });
  const convo = _whisperConvos.get(from);
  convo.messages.push({ from, message, isMe: false, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  _saveConvos();
  if (_whisperPanelVisible && _activeWhisperTab === from) {
    _renderWhisperLog();
    const log = document.getElementById('whisper-log');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (nearBottom) { log.scrollTop = log.scrollHeight; document.getElementById('whisper-new-msgs').style.display = 'none'; }
    else document.getElementById('whisper-new-msgs').style.display = 'block';
  } else {
    convo.unread++;
    _updateChatBadge();
    if (_whisperPanelVisible) _refreshWhisperTabs();
  }
}

// Replay stored channel history on login. history: { channelId: [{from, message, ts}, ...] }
export function initChannelHistory(history) {
  for (const [channelId, messages] of Object.entries(history || {})) {
    if (!_whisperConvos.has(channelId)) _whisperConvos.set(channelId, { messages: [], scrollTop: 0, unread: 0 });
    const convo = _whisperConvos.get(channelId);
    convo.messages = (messages || []).slice(-WHISPER_MAX_MSGS).map(m => ({
      from: m.from, message: m.message, isMe: false, ts: m.ts,
    }));
    if (_activeWhisperTab === channelId) _renderWhisperLog();
  }
}

export function receiveChannelMsg(channelId, from, message) {
  if (!_whisperConvos.has(channelId)) _whisperConvos.set(channelId, { messages: [], scrollTop: 0, unread: 0 });
  const convo = _whisperConvos.get(channelId);
  convo.messages.push({ from, message, isMe: false, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  if (_whisperPanelVisible && _activeWhisperTab === channelId) {
    _renderWhisperLog();
    const log = document.getElementById('whisper-log');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (nearBottom) { log.scrollTop = log.scrollHeight; document.getElementById('whisper-new-msgs').style.display = 'none'; }
    else document.getElementById('whisper-new-msgs').style.display = 'block';
  } else {
    convo.unread++;
    _updateChatBadge();
    if (_whisperPanelVisible) _refreshWhisperTabs();
  }
}

// ── BADGE ─────────────────────────────────────────────────────────────────────

function _updateChatBadge() {
  let total = 0;
  for (const c of _whisperConvos.values()) total += c.unread;
  const btn = document.getElementById('chat-toggle-btn');
  if (btn) {
    btn.textContent = '💬 Chat';
    btn.style.borderColor = total > 0 ? 'var(--red)' : '';
    btn.style.color       = total > 0 ? 'var(--red)' : '';
  }
  const badge = document.getElementById('chat-notif-badge');
  if (badge) badge.style.display = (total > 0 && !_whisperPanelVisible) ? 'flex' : 'none';
}

// ── SEND REPLY ────────────────────────────────────────────────────────────────

async function _openWhisperByHandle(handle) {
  await _fetchOnlinePlayers();
  const found = _onlinePlayers.find(p => p.handle.toLowerCase() === handle.toLowerCase());
  if (!found) {
    const log = document.getElementById('whisper-log');
    if (log) {
      const err = document.createElement('div');
      err.style.cssText = 'padding:6px 0;color:var(--red);font-size:11px';
      err.textContent = `"${handle}" is not online.`;
      log.appendChild(err);
      log.scrollTop = log.scrollHeight;
    }
    return;
  }
  openWhisperTab(found.handle);
}

function sendWhisperReply() {
  const input = document.getElementById('whisper-reply-input');
  const msg   = input?.value?.trim();
  if (!msg || !_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;

  // Client-only commands
  if (msg.toLowerCase() === '.markup') {
    if (input) input.value = '';
    appendToWhisperLog(MARKUP_HELP_HTML);
    return;
  }
  if (msg.toLowerCase() === '.status') {
    if (input) input.value = '';
    sendToActiveTab(STATUS_TEMPLATE);
    return;
  }

  const whisperCmd = msg.match(/^whisper\s+(\S+)$/i);
  if (whisperCmd) {
    if (input) input.value = '';
    _openWhisperByHandle(whisperCmd[1]);
    return;
  }

  // Expand $tokens at send time so recipients see the sender's values
  const expanded = expandTokens(msg);

  if (_channels.has(_activeWhisperTab)) {
    if (_isSystemOnly(_activeWhisperTab)) return;
    sendCmdSilent(`whisper ${_activeWhisperTab} ${expanded}`);
    if (input) input.value = '';
    return;
  }

  sendCmdSilent(`whisper ${_activeWhisperTab} ${expanded}`);
  if (input) input.value = '';
}

export function debugFakeWhisper() {
  receiveWhisper('TestUser', 'This is a fake whisper to test the chat notification system.');
}

// Append raw HTML into the active whisper tab. Returns true if it rendered, false if no tab is open.
export function appendToWhisperLog(html) {
  if (_activeWhisperTab === USERS_TAB || !_whisperConvos.has(_activeWhisperTab)) return false;
  const log = document.getElementById('whisper-log');
  if (!log) return false;
  const div = document.createElement('div');
  div.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border)';
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return true;
}

// Send text to the active whisper/channel tab (tokens expanded at call time).
export function sendToActiveTab(text) {
  if (!_activeWhisperTab || _activeWhisperTab === USERS_TAB) return false;
  if (_isSystemOnly(_activeWhisperTab)) return false;
  const expanded = expandTokens(text);
  sendCmdSilent(`whisper ${_activeWhisperTab} ${expanded}`);
  return true;
}

// ── INIT ──────────────────────────────────────────────────────────────────────

export function initWhisperPanel() {
  _loadSettings();
  _loadConvos();

  window.addEventListener('beforeunload', _saveConvos);

  document.getElementById('chat-toggle-btn').addEventListener('click', toggleWhisperPanel);
  document.getElementById('whisper-reply-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendWhisperReply();
  });

  // Close (✕) button
  document.querySelectorAll('#whisper-panel button').forEach(btn => {
    if (btn.textContent.trim() === '✕') btn.addEventListener('click', toggleWhisperPanel);
  });

  const footer   = document.getElementById('whisper-footer');
  const sendBtn  = footer?.querySelector('button');
  sendBtn?.addEventListener('click', sendWhisperReply);

  // ── Emoji picker ──────────────────────────────────────────────────────────────
  const EMOJIS = [
    '😂','💀','🔥','⚡','☢️','💉','🩸','🗡️',
    '💣','🤡','😈','👿','🤖','👾','🧠','👁️',
    '🤢','😤','😭','💯','🤙','👋','🫡','❤️',
    '✨','💥','🎯','🏚️','💊','🚬','🍺','💰',
  ];

  const emojiBtn = document.createElement('button');
  emojiBtn.textContent = '😊';
  emojiBtn.title = 'Insert emoji';
  emojiBtn.style.cssText = 'background:transparent;border:1px solid var(--border);color:var(--text);font-size:14px;padding:3px 7px;cursor:pointer;border-radius:2px;flex-shrink:0;line-height:1';

  const emojiPicker = document.createElement('div');
  emojiPicker.style.cssText = [
    'display:none;position:absolute;bottom:calc(100% + 4px);right:0',
    'background:var(--bg2);border:1px solid var(--border);border-radius:4px',
    'padding:6px;display:none;gap:4px;flex-wrap:wrap;width:220px',
    'z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.4)',
  ].join(';');

  for (const emoji of EMOJIS) {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.style.cssText = 'background:transparent;border:none;font-size:18px;cursor:pointer;padding:2px;border-radius:2px;line-height:1';
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--bg3)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', () => {
      const inp = document.getElementById('whisper-reply-input');
      if (!inp) return;
      const start = inp.selectionStart ?? inp.value.length;
      const end   = inp.selectionEnd   ?? inp.value.length;
      inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
      inp.selectionStart = inp.selectionEnd = start + emoji.length;
      inp.focus();
      emojiPicker.style.display = 'none';
    });
    emojiPicker.appendChild(btn);
  }

  const emojiWrap = document.createElement('div');
  emojiWrap.style.cssText = 'position:relative;flex-shrink:0';
  emojiWrap.appendChild(emojiBtn);
  emojiWrap.appendChild(emojiPicker);

  emojiBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = emojiPicker.style.display !== 'none';
    emojiPicker.style.display = open ? 'none' : 'flex';
  });
  document.addEventListener('click', e => {
    if (!emojiWrap.contains(e.target)) emojiPicker.style.display = 'none';
  });

  if (sendBtn) footer.insertBefore(emojiWrap, sendBtn);
  else footer?.appendChild(emojiWrap);
  document.getElementById('whisper-new-msgs').addEventListener('click', whisperScrollToBottom);

  document.getElementById('whisper-log').addEventListener('scroll', () => {
    if (!_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;
    const log   = document.getElementById('whisper-log');
    const convo = _whisperConvos.get(_activeWhisperTab);
    if (convo) convo.scrollTop = log.scrollTop;
    _checkWhisperScroll();
  });

  // Cog menu
  const cogBtn  = document.getElementById('whisper-cog-btn');
  const cogMenu = document.getElementById('whisper-cog-menu');
  if (cogBtn && cogMenu) {
    cogBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = cogMenu.style.display !== 'none';
      cogMenu.style.display = open ? 'none' : 'block';
      if (!open) _refreshCogMenu();
    });
    document.addEventListener('click', e => {
      if (!cogMenu.contains(e.target) && e.target !== cogBtn) cogMenu.style.display = 'none';
    });
    cogMenu.querySelectorAll('[data-winsize]').forEach(btn => {
      btn.addEventListener('click', () => {
        _windowSize = btn.dataset.winsize;
        _saveSettings();
        _applyWindowSize();
        _rerenderMotd();
        cogMenu.style.display = 'none';
      });
    });
    cogMenu.querySelectorAll('[data-txtsize]').forEach(btn => {
      btn.addEventListener('click', () => {
        _textSize = btn.dataset.txtsize;
        _saveSettings();
        _applyTextSize();
        _measureMotdDims(); // font size changed → widths change
        _applyWindowSize();
        _rerenderMotd();
        cogMenu.style.display = 'none';
      });
    });
  }

  const dragHandle = document.getElementById('whisper-drag-handle');
  const panel      = document.getElementById('whisper-panel');
  let dragState = null;

  dragHandle.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.target.closest('#whisper-cog-menu')) return;
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

  document.addEventListener('pointerup',     e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } });
  document.addEventListener('pointercancel', e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } });

}
