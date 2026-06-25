import { sendCmdSilent } from '../net.js';
import { state } from '../state.js';

const USERS_TAB = '__users__';
const WHISPER_MAX_MSGS = 100;

let _whisperPanelVisible = false;
let _activeWhisperTab = USERS_TAB;
const _whisperConvos = new Map();
let _onlinePlayers = [];

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
  if (footer) footer.style.display = key === USERS_TAB ? 'none' : 'flex';
  if (key === USERS_TAB) _fetchOnlinePlayers();
}

function _closeWhisperTab(handle) {
  _whisperConvos.delete(handle);
  if (_activeWhisperTab === handle) _switchToTab(USERS_TAB);
  else { _refreshWhisperTabs(); _updateChatBadge(); }
}

function _refreshWhisperTabs() {
  const tabs = document.getElementById('whisper-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  const mkTab = (label, active, color, onClick) => {
    const t = document.createElement('button');
    t.style.cssText = `background:${active?'var(--bg3)':'transparent'};border:1px solid ${active?color:'var(--border)'};color:${active?color:'var(--text-dim)'};font-family:var(--font-mono);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;white-space:nowrap;flex-shrink:0`;
    t.textContent = label;
    t.onclick = onClick;
    tabs.appendChild(t);
  };
  mkTab('Users', _activeWhisperTab === USERS_TAB, 'var(--purple)', () => _switchToTab(USERS_TAB));
  for (const [handle, convo] of _whisperConvos) {
    const active = handle === _activeWhisperTab;
    const borderColor = active ? 'var(--accent)' : 'var(--border)';
    const textColor   = active ? 'var(--accent)' : 'var(--text-dim)';
    const bg          = active ? 'var(--bg3)' : 'transparent';

    const wrap = document.createElement('div');
    wrap.style.cssText = `display:inline-flex;align-items:stretch;flex-shrink:0;position:relative`;

    const labelBtn = document.createElement('button');
    labelBtn.style.cssText = `background:${bg};border:1px solid ${borderColor};color:${textColor};font-family:var(--font-mono);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;white-space:nowrap`;
    labelBtn.textContent = handle;
    labelBtn.addEventListener('click', () => openWhisperTab(handle));

    if (convo.unread > 0) {
      const pip = document.createElement('span');
      pip.textContent = '!';
      pip.style.cssText = 'position:absolute;top:-5px;left:-5px;background:var(--red);color:#fff;font-size:9px;font-weight:bold;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;pointer-events:none';
      wrap.appendChild(pip);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.style.cssText = `background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:13px;line-height:1;width:20px;height:20px;padding:0;cursor:pointer;border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0;align-self:center;margin-left:3px`;
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--red)'; closeBtn.style.color = 'var(--red)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--border)'; closeBtn.style.color = 'var(--text-dim)'; });
    closeBtn.addEventListener('click', () => _closeWhisperTab(handle));

    wrap.appendChild(labelBtn);
    wrap.appendChild(closeBtn);
    tabs.appendChild(wrap);
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
    const msgColor  = m.isMe ? 'var(--text-dim)' : 'var(--text)';
    entry.innerHTML = `<div style="font-size:10px;color:${nameColor};margin-bottom:2px;font-style:${m.isMe?'italic':''}">${m.from}</div><div style="color:${msgColor}">${m.message}</div>`;
    log.appendChild(entry);
  }
  log.scrollTop = convo.scrollTop || log.scrollHeight;
  _checkWhisperScroll();
}

function _renderUsersTab(log) {
  log.innerHTML = '<div style="padding:8px 10px 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Online now</div>'
    + (_onlinePlayers.length
      ? _onlinePlayers.map(p => {
          const h = p.handle.replace(/"/g, '&quot;');
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text)">${p.handle}</span><button data-whisper="${h}" title="Whisper ${p.handle}" style="background:transparent;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0 2px;line-height:1">💬</button></div>`;
        }).join('')
      : '<div style="padding:10px 10px;color:var(--text-dim);font-size:11px">No other players online.</div>')
    + '<div style="padding:6px 10px"><button data-refresh-online style="width:100%;background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:4px;cursor:pointer;border-radius:2px">↻ Refresh</button></div>';

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

  // Intercept "whisper <handle>" to open a new conversation tab.
  const whisperCmd = msg.match(/^whisper\s+(\S+)$/i);
  if (whisperCmd) {
    if (input) input.value = '';
    _openWhisperByHandle(whisperCmd[1]);
    return;
  }

  if (!_whisperConvos.has(_activeWhisperTab)) _whisperConvos.set(_activeWhisperTab, { messages: [], scrollTop: 0, unread: 0 });
  const convo = _whisperConvos.get(_activeWhisperTab);
  convo.messages.push({ from: 'You', message: msg, isMe: true, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  _renderWhisperLog();
  const log = document.getElementById('whisper-log');
  if (log) log.scrollTop = log.scrollHeight;
  sendCmdSilent(`whisper ${_activeWhisperTab} ${msg}`);
  if (input) input.value = '';
}

export function debugFakeWhisper() {
  receiveWhisper('TestUser', 'This is a fake whisper to test the chat notification system.');
}

export function initWhisperPanel() {
  document.getElementById('chat-toggle-btn').addEventListener('click', toggleWhisperPanel);
  document.getElementById('whisper-reply-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendWhisperReply();
  });
  // Wire close (✕) button in whisper panel header
  document.querySelectorAll('#whisper-panel button').forEach(btn => {
    if (btn.textContent.trim() === '✕') btn.addEventListener('click', toggleWhisperPanel);
  });
  document.querySelector('#whisper-footer button')?.addEventListener('click', sendWhisperReply);
  document.getElementById('whisper-new-msgs').addEventListener('click', whisperScrollToBottom);

  document.getElementById('whisper-log').addEventListener('scroll', () => {
    if (!_activeWhisperTab || _activeWhisperTab === USERS_TAB) return;
    const log = document.getElementById('whisper-log');
    _whisperConvos.get(_activeWhisperTab).scrollTop = log.scrollTop;
    _checkWhisperScroll();
  });

  const dragHandle = document.getElementById('whisper-drag-handle');
  const panel = document.getElementById('whisper-panel');
  let dragState = null;
  dragHandle.addEventListener('pointerdown', e => {
    // Never intercept clicks inside the tabs bar or on any button.
    if (e.target.closest('#whisper-tabs') || e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    // Record intent but do NOT capture yet — capturing here breaks button clicks.
    dragState = { pointerId: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, startTime: Date.now(), captured: false };
  });
  dragHandle.addEventListener('pointermove', e => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    if (!dragState.captured) {
      if (Date.now() - dragState.startTime < 600) return;
      // Capture only after the hold threshold — valid to call from pointermove.
      dragHandle.setPointerCapture(e.pointerId);
      dragState.captured = true;
      dragHandle.style.cursor = 'grabbing';
    }
    const x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  e.clientX - dragState.ox));
    const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - dragState.oy));
    panel.style.left = x + 'px'; panel.style.top = y + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  });
  // Clean up on the document so a release outside the handle never leaves dragState stale.
  document.addEventListener('pointerup',     e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } });
  document.addEventListener('pointercancel', e => { if (dragState && dragState.pointerId === e.pointerId) { dragState = null; dragHandle.style.cursor = 'grab'; } });
}
