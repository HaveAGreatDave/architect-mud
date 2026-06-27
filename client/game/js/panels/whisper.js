import { sendCmdSilent } from '../net.js';
import { state } from '../state.js';

const USERS_TAB = '__users__';
const WHISPER_MAX_MSGS = 100;

// Channels the server told us this player has access to: id -> { id, permanent }
const _channels = new Map();

let _whisperPanelVisible = false;
let _activeWhisperTab = USERS_TAB;
const _whisperConvos = new Map();
let _onlinePlayers = [];

export function initChannels(channelList) {
  for (const ch of (channelList || [])) {
    _channels.set(ch.id, ch);
    if (!_whisperConvos.has(ch.id)) _whisperConvos.set(ch.id, { messages: [], scrollTop: 0, unread: 0 });
  }
}

function _isSystemOnly(tabKey) {
  return _channels.has(tabKey) && _channels.get(tabKey).systemOnly;
}

export function toggleWhisperPanel() {
  _whisperPanelVisible = !_whisperPanelVisible;
  const panel = document.getElementById('whisper-panel');
  panel.style.display = _whisperPanelVisible ? 'flex' : 'none';
  if (_whisperPanelVisible) {
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
    document.getElementById('whisper-panel').style.display = 'flex';
  }
  document.getElementById('whisper-reply-input')?.focus();
  _updateChatBadge();
}

function _switchToTab(key) {
  _activeWhisperTab = key;
  _refreshWhisperTabs();
  _renderWhisperLog();
  const footer = document.getElementById('whisper-footer');
  if (footer) footer.style.display = (key === USERS_TAB || _isSystemOnly(key)) ? 'none' : 'flex';
  if (key === USERS_TAB) _fetchOnlinePlayers();
}

function _closeWhisperTab(handle) {
  // Permanent channels cannot be closed.
  if (_channels.has(handle) && _channels.get(handle).permanent) return;
  _whisperConvos.delete(handle);
  _channels.delete(handle);
  if (_activeWhisperTab === handle) _switchToTab(USERS_TAB);
  else { _refreshWhisperTabs(); _updateChatBadge(); }
}

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

  // Channel tabs — permanent ones use simple tab (no close), others get close button.
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

  // Player whisper tabs.
  for (const [handle] of _whisperConvos) {
    if (_channels.has(handle)) continue;
    const active = handle === _activeWhisperTab;
    mkClosableTab(handle, handle, active, () => openWhisperTab(handle), () => _closeWhisperTab(handle));
  }
}

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
    entry.innerHTML = `<div style="font-size:10px;color:${nameColor};margin-bottom:2px;font-style:${m.isMe?'italic':''}">${m.from}</div><div style="color:var(--text)">${m.message}</div>`;
    log.appendChild(entry);
  }
  log.scrollTop = convo.scrollTop || log.scrollHeight;
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
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text)">${p.handle}</span><button data-whisper="${h}" title="Whisper ${p.handle}" style="background:transparent;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0 2px;line-height:1">💬</button></div>`;
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

function _checkWhisperScroll() {
  const log = document.getElementById('whisper-log');
  const pill = document.getElementById('whisper-new-msgs');
  if (!log || !pill) return;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  pill.style.display = nearBottom ? 'none' : 'block';
}

function whisperScrollToBottom() {
  const log = document.getElementById('whisper-log');
  if (log) log.scrollTop = log.scrollHeight;
  document.getElementById('whisper-new-msgs').style.display = 'none';
}

export function sentWhisper(handle, message) {
  if (!_whisperConvos.has(handle)) {
    _whisperConvos.set(handle, { messages: [], scrollTop: 0, unread: 0 });
  }
  const convo = _whisperConvos.get(handle);
  convo.messages.push({ from: 'You', message, isMe: true, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  openWhisperTab(handle);
  const log = document.getElementById('whisper-log');
  if (log) log.scrollTop = log.scrollHeight;
}

export function receiveWhisper(from, message) {
  if (!_whisperConvos.has(from)) _whisperConvos.set(from, { messages: [], scrollTop: 0, unread: 0 });
  const convo = _whisperConvos.get(from);
  convo.messages.push({ from, message, isMe: false, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
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

function _updateChatBadge() {
  let total = 0;
  for (const c of _whisperConvos.values()) total += c.unread;
  const btn = document.getElementById('chat-toggle-btn');
  if (btn) {
    btn.textContent = '💬 Chat';
    btn.style.borderColor = total > 0 ? 'var(--red)' : '';
    btn.style.color = total > 0 ? 'var(--red)' : '';
  }
  const badge = document.getElementById('chat-notif-badge');
  if (badge) badge.style.display = (total > 0 && !_whisperPanelVisible) ? 'flex' : 'none';
}

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
  const msg = input?.value?.trim();
  if (!msg || !_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;

  // Intercept "whisper <handle>" typed inside a tab to open a new convo.
  const whisperCmd = msg.match(/^whisper\s+(\S+)$/i);
  if (whisperCmd) {
    if (input) input.value = '';
    _openWhisperByHandle(whisperCmd[1]);
    return;
  }

  // Channel tab: send via whisper command; message arrives back via channel_msg broadcast.
  if (_channels.has(_activeWhisperTab)) {
    if (_isSystemOnly(_activeWhisperTab)) return; // system-only channel, no player input
    sendCmdSilent(`whisper ${_activeWhisperTab} ${msg}`);
    if (input) input.value = '';
    return;
  }

  // Player whisper tab: send to server; whisper_sent response will add the message via sentWhisper.
  sendCmdSilent(`whisper ${_activeWhisperTab} ${msg}`);
  if (input) input.value = '';
}

export function debugFakeWhisper() {
  receiveWhisper('TestUser', 'This is a fake whisper to test the chat notification system.');
}

const SMALL_W = 300, SMALL_H = 340;
const LARGE_SCALE = 2;

let _whisperScale = 1;

function _applyWhisperScale(large) {
  _whisperScale = large ? LARGE_SCALE : 1;
  const panel   = document.getElementById('whisper-panel');
  const content = document.getElementById('whisper-content');
  const btnS    = document.getElementById('whisper-scale-small');
  const btnL    = document.getElementById('whisper-scale-large');

  panel.style.width  = (SMALL_W * _whisperScale) + 'px';
  panel.style.height = (SMALL_H * _whisperScale) + 'px';
  content.style.zoom = large ? LARGE_SCALE : 1;

  btnS.style.background   = large ? 'transparent' : 'var(--bg3)';
  btnS.style.borderColor  = large ? 'var(--border)' : 'var(--accent)';
  btnS.style.color        = large ? 'var(--text-dim)' : 'var(--accent)';
  btnL.style.background   = large ? 'var(--bg3)' : 'transparent';
  btnL.style.borderColor  = large ? 'var(--accent)' : 'var(--border)';
  btnL.style.color        = large ? 'var(--accent)' : 'var(--text-dim)';
}

export function initWhisperPanel() {
  document.getElementById('chat-toggle-btn').addEventListener('click', toggleWhisperPanel);
  document.getElementById('whisper-reply-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendWhisperReply();
  });
  document.getElementById('whisper-scale-small').addEventListener('click', e => { e.stopPropagation(); _applyWhisperScale(false); });
  document.getElementById('whisper-scale-large').addEventListener('click', e => { e.stopPropagation(); _applyWhisperScale(true); });
  // Wire close (✕) button in whisper panel header
  document.querySelectorAll('#whisper-panel button').forEach(btn => {
    if (btn.textContent.trim() === '✕') btn.addEventListener('click', toggleWhisperPanel);
  });
  document.querySelector('#whisper-footer button')?.addEventListener('click', sendWhisperReply);
  document.getElementById('whisper-new-msgs').addEventListener('click', whisperScrollToBottom);

  document.getElementById('whisper-log').addEventListener('scroll', () => {
    if (!_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;
    const log = document.getElementById('whisper-log');
    const convo = _whisperConvos.get(_activeWhisperTab);
    if (convo) convo.scrollTop = log.scrollTop;
    _checkWhisperScroll();
  });

  const dragHandle = document.getElementById('whisper-drag-handle');
  const panel = document.getElementById('whisper-panel');
  let dragState = null;

  // Only the grip bar initiates drag — not buttons inside it.
  dragHandle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    dragState = { pointerId: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, startTime: Date.now(), captured: false };
  });

  // Listen on document so fast moves off the bar don't drop the drag.
  document.addEventListener('pointermove', e => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    if (!dragState.captured) {
      if (Date.now() - dragState.startTime < 100) return;
      dragHandle.setPointerCapture(e.pointerId);
      dragState.captured = true;
      dragHandle.style.cursor = 'grabbing';
    }
    const x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  e.clientX - dragState.ox));
    const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - dragState.oy));
    panel.style.left = x + 'px'; panel.style.top = y + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  });

  document.addEventListener('pointerup',     e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } });
  document.addEventListener('pointercancel', e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } });
}
