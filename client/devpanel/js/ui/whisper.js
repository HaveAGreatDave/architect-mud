const USERS_TAB = '__users__';
const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);

// Channels devpanel admins always have access to
const CHANNELS = [
  { id: '#system', permanent: true, systemOnly: true },
  { id: '#arcnet', permanent: true, systemOnly: false },
];

const WHISPER_CONVO_KEY = 'dev_whisper_convos';
const WHISPER_SETTINGS_KEY = 'dev_whisper_settings';
const WHISPER_MAX_MSGS = 100;

// Emoji shortcodes: typing :code: auto-replaces with the emoji as you type.
// Covers every emoji in the picker below (multiple aliases per glyph).
const EMOJI_SHORTCODES = {
  joy: '😂', lol: '😂', laugh: '😂',
  skull: '💀', dead: '💀',
  fire: '🔥', lit: '🔥',
  zap: '⚡', lightning: '⚡',
  rad: '☢️', radiation: '☢️', nuke: '☢️',
  syringe: '💉', needle: '💉',
  blood: '🩸',
  knife: '🗡️', dagger: '🗡️',
  bomb: '💣',
  clown: '🤡',
  devil: '😈', imp: '😈',
  angry_devil: '👿', devilrage: '👿',
  robot: '🤖', bot: '🤖',
  alien: '👾',
  brain: '🧠',
  eye: '👁️',
  sick: '🤢', nauseated: '🤢',
  rage: '😤', huff: '😤',
  cry: '😭', sob: '😭',
  100: '💯', hundred: '💯',
  shaka: '🤙',
  wave: '👋',
  salute: '🫡',
  heart: '❤️',
  sparkles: '✨',
  boom: '💥', explosion: '💥',
  target: '🎯', dart: '🎯', bullseye: '🎯',
  ruins: '🏚️',
  pill: '💊',
  smoke: '🚬', cig: '🚬',
  beer: '🍺',
  money: '💰', cash: '💰',
};

// Classic text emoticons that auto-convert inline as you type (alongside the
// :shortcode: syntax above). Ordered longest-first so multi-char faces win.
const EMOTICONS = [
  [":'(", "😭"],
  [">:(", "😠"],
  [":-)", "😊"],
  [":-D", "😃"],
  [":-(", "😢"],
  [":-P", "😛"],
  [":-p", "😛"],
  [":-O", "😮"],
  [":-o", "😮"],
  [":-/", "😕"],
  [";-)", "😉"],
  [":)", "😊"],
  [":D", "😃"],
  [":(", "😢"],
  [":P", "😛"],
  [":p", "😛"],
  [":O", "😮"],
  [":o", "😮"],
  [":/", "😕"],
  [":|", "😐"],
  [";)", "😉"],
  ["<3", "❤️"],
  ["xD", "😆"],
  ["XD", "😆"],
];

// On input, replace a completed emoji token immediately before the cursor —
// either a :shortcode: or a classic text emoticon.
function _emojiAutoReplace(inp) {
  const pos = inp.selectionStart ?? inp.value.length;
  const before = inp.value.slice(0, pos);
  const _swap = (len, emoji) => {
    const start = pos - len;
    inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(pos);
    inp.selectionStart = inp.selectionEnd = start + emoji.length;
  };
  // :shortcode: — a completed token ending in a colon.
  const m = before.match(/:([a-z0-9_+-]+):$/i);
  if (m) {
    const emoji = EMOJI_SHORTCODES[m[1].toLowerCase()];
    if (emoji) return _swap(m[0].length, emoji);
  }
  // Text emoticons — only when preceded by whitespace/start, so URLs (http://)
  // and mid-word colons don't trip it.
  for (const [token, emoji] of EMOTICONS) {
    if (!before.endsWith(token)) continue;
    const start = pos - token.length;
    if (start > 0 && !/\s/.test(before[start - 1])) continue;
    return _swap(token.length, emoji);
  }
}

let _panelOpen = false;
let _activeTab = '#system';
const _convos = new Map(); // tabKey → { messages: [], unread: 0, scrollTop, playerId? }
let _onlinePlayers = [];
let _pollTimer = null;
let _lastPollTs = Date.now(); // ms timestamp; poll fetches messages since this
let _myHandle = null;
// Most recently opened DM — kept pinned as a single quick-access strip tab.
let _lastPmTab = null;

// Window/text size settings
let _windowSize = 'small'; // 'small' | 'medium' | 'large'
let _textSize = 'medium';  // 'small' | 'medium' | 'large'
const FONT_SIZES = { small: '5pt', medium: '8pt', large: '11pt' };

// Stored MOTD data (raw templates + dynamic text) and cached measured dims
let _motdData = null;
let _motdDims = {};

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _isChannel(key) {
  return !!CHANNELS.find(c => c.id === key);
}

function _isSystemOnly(key) {
  return !!CHANNELS.find(c => c.id === key)?.systemOnly;
}

function _getConvo(key) {
  if (!_convos.has(key)) _convos.set(key, { messages: [], unread: 0, scrollTop: 999999 });
  return _convos.get(key);
}

// Optimistic echo bookkeeping: a channel line you send is rendered immediately,
// then the 3s poll returns the server's stored copy. Record each optimistic line
// here and consume the matching poll echo so it isn't shown twice. Entries
// self-expire so a dropped echo can't wedge the list. (Back-to-back matching on
// the last message alone was fragile — two quick sends echoed back together as a
// batch each re-appended, producing a duplicated pair.)
const _pendingSelfEchoes = [];
const _SELF_ECHO_TTL = 15000;

function _consumeSelfEcho(tab, message) {
  const now = Date.now();
  let matched = false;
  for (let i = _pendingSelfEchoes.length - 1; i >= 0; i--) {
    const e = _pendingSelfEchoes[i];
    if (now - e.ts > _SELF_ECHO_TTL) { _pendingSelfEchoes.splice(i, 1); continue; }
    if (!matched && e.tab === tab && e.message === message) {
      _pendingSelfEchoes.splice(i, 1);
      matched = true;
    }
  }
  return matched;
}

// ── Persistence ─────────────────────────────────────────────────────────────────

function _loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(WHISPER_SETTINGS_KEY) || '{}');
    if (['small', 'medium', 'large'].includes(s.windowSize)) _windowSize = s.windowSize;
    if (['small', 'medium', 'large'].includes(s.textSize)) _textSize = s.textSize;
  } catch {}
}

function _saveSettings() {
  try {
    localStorage.setItem(WHISPER_SETTINGS_KEY, JSON.stringify({ windowSize: _windowSize, textSize: _textSize }));
  } catch {}
}

function _saveConvos() {
  try {
    const toSave = {};
    for (const [key, convo] of _convos) {
      if (_isChannel(key) || key === USERS_TAB) continue;
      toSave[key] = convo.messages.slice(-WHISPER_MAX_MSGS);
    }
    localStorage.setItem(WHISPER_CONVO_KEY, JSON.stringify(toSave));
  } catch (e) { console.error('[whisper] save failed:', e); }
}

function _loadConvos() {
  try {
    const saved = JSON.parse(localStorage.getItem(WHISPER_CONVO_KEY) || '{}');
    for (const [key, messages] of Object.entries(saved)) {
      if (!Array.isArray(messages) || messages.length === 0) continue;
      _convos.set(key, { messages, unread: 0, scrollTop: 999999 });
    }
  } catch (e) { console.error('[whisper] load failed:', e); }
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
  if (document.hidden) return; // tab not visible — skip; next tick after refocus catches up via `since`
  const since = _lastPollTs;
  try {
    const data = await API(`/channels/messages?since=${since}`);
    let maxTs = since;
    for (const [channelId, messages] of Object.entries(data || {})) {
      for (const m of messages) {
        _receiveChannelMsg(channelId, m.from, m.message);
        if (m.ts > maxTs) maxTs = m.ts;
      }
    }
    // Advance the cursor by the newest *server* timestamp we actually saw — never
    // the local clock. `created_at` is DB-stamped; a browser clock running behind
    // the DB would keep the last row `> since` on every poll, re-fetching it
    // forever (the last line repeats over and over).
    _lastPollTs = maxTs;
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

function _selectMotdSize() {
  if (_windowSize === 'large') return 'big';
  if (_windowSize === 'medium') return 'medium';
  return 'small';
}

// Lay a list of strings into the space a border token occupied — word-wrap each
// to totalSpace and pad back out to the right border so the box stays square.
// Borderless callers get one unwrapped line per item. Mirror of the game client's
// helper (client/game/js/panels/whisper.js) so the admin preview matches players.
function _fitBorderLines(prefix, rborder, totalSpace, items) {
  if (!rborder) {
    const flat = items.length ? items : [''];
    return flat.map(l => prefix + l).join('\n');
  }
  const contLeft = rborder + ' '.repeat(Math.max(0, prefix.length - 1));
  const out = [];
  for (const item of items) {
    const s = String(item);
    if (s.length <= totalSpace) { out.push(s); continue; }
    const words = s.split(' ');
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (test.length > totalSpace) { if (cur) out.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) out.push(cur);
  }
  if (!out.length) out.push('');
  return out.map((l, i) => {
    const pad = ' '.repeat(Math.max(0, totalSpace - l.length));
    return (i === 0 ? prefix : contLeft) + l + pad + rborder;
  }).join('\n');
}

function _applyMotdSubstitutions(template, handle, dynamicText, newsLines) {
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
  text = text.replace(/^(.*?)<news>( *)(║?)$/gm, (_, prefix, spaces, rborder) => {
    const totalSpace = spaces.length + 6; // "<news>".length
    const items = newsLines && newsLines.length ? newsLines : ['[No recent broadcasts available]'];
    return _fitBorderLines(prefix, rborder, totalSpace, items);
  });
  return text;
}

// Render each MOTD size off-screen to measure natural width + height, so the panel
// can size itself even when #system isn't the active tab.
function _measureMotdDims() {
  if (!_motdData) return;
  const handle = _myHandle || 'Admin';
  const fs = FONT_SIZES[_textSize];
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:-9999px;left:0;visibility:hidden;pointer-events:none;width:max-content';
  document.body.appendChild(host);
  for (const size of ['big', 'medium', 'small']) {
    const template = _motdData[size] || '';
    if (!template) { _motdDims[size] = { w: 0, h: 0 }; continue; }
    const rendered = _applyMotdSubstitutions(template, handle, _motdData.dynamic || '', _motdData.news || []);
    const pre = document.createElement('pre');
    pre.style.cssText = `font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;font-size:${fs}`;
    pre.textContent = rendered;
    host.appendChild(pre);
    const rect = pre.getBoundingClientRect();
    _motdDims[size] = { w: Math.ceil(rect.width) + 40, h: Math.ceil(rect.height) + 82 };
    host.removeChild(pre);
  }
  document.body.removeChild(host);
}

function _setSystemMOTD(renderedText) {
  const convo = _getConvo('#system');
  convo.messages = [{ from: 'SYSTEM', message: renderedText, isMOTD: true, ts: Date.now() }];
  convo.unread = 0;
  convo.scrollTop = 0;
  convo.stickBottom = false; // MOTD reads from the top, never auto-scrolls
  if (_panelOpen && _activeTab === '#system') {
    _renderLog();
    const log = document.getElementById('whisper-log');
    if (log) log.scrollTop = 0;
  }
}

function _rerenderMotd() {
  if (!_motdData) return;
  const template = _motdData[_selectMotdSize()] || '';
  if (!template) return;
  _setSystemMOTD(_applyMotdSubstitutions(template, _myHandle || 'Admin', _motdData.dynamic || '', _motdData.news || []));
}

async function _loadMotd() {
  try {
    const data = await API('/motd');
    if (!data || data.error) return;
    _motdData = {
      big: data.big || '',
      medium: data.medium || '',
      small: data.small || '',
      dynamic: data.dynamic || '',
      news: Array.isArray(data.news) ? data.news : [],
    };
    _measureMotdDims();
    _applyWindowSize();
    _rerenderMotd();
  } catch {}
}

// ── Panel size / text size ──────────────────────────────────────────────────────

function _applyWindowSize() {
  const panel = document.getElementById('whisper-panel');
  if (!panel) return;
  const dims = _motdDims[_selectMotdSize()];
  const fallbackW = { small: 340, medium: 500, large: 700 }[_windowSize];
  const fallbackH = { small: 380, medium: 480, large: 600 }[_windowSize];
  const maxW = Math.floor(window.innerWidth * 0.95);
  const maxH = Math.floor(window.innerHeight * 0.92);
  panel.style.width = Math.min(Math.max(dims?.w || fallbackW, 150), maxW) + 'px';
  panel.style.height = Math.min(Math.max(dims?.h || fallbackH, 150), maxH) + 'px';
  _refreshCogMenu();
}

function _applyTextSize() {
  const fs = FONT_SIZES[_textSize];
  const log = document.getElementById('whisper-log');
  if (log) log.style.fontSize = fs;
  const inp = document.getElementById('whisper-input');
  if (inp) inp.style.fontSize = fs;
  _refreshCogMenu();
}

function _refreshCogMenu() {
  const menu = document.getElementById('whisper-cog-menu');
  if (!menu) return;
  menu.querySelectorAll('[data-winsize]').forEach(btn => {
    const active = btn.dataset.winsize === _windowSize;
    btn.style.background = active ? 'var(--bg3)' : 'transparent';
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    btn.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
  });
  menu.querySelectorAll('[data-txtsize]').forEach(btn => {
    const active = btn.dataset.txtsize === _textSize;
    btn.style.background = active ? 'var(--bg3)' : 'transparent';
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    btn.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
  });
}

// ── Toggle / open ─────────────────────────────────────────────────────────────

function toggleWhisperPanel() {
  _panelOpen = !_panelOpen;
  const panel = document.getElementById('whisper-panel');
  panel.style.display = _panelOpen ? 'flex' : 'none';
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = _panelOpen ? 'var(--accent)' : '';
  if (_panelOpen) {
    _applyWindowSize();
    _applyTextSize();
    _switchTab(_activeTab);
    _fetchOnline();
    _startPoll();
    if (_activeTab !== USERS_TAB) document.getElementById('whisper-input')?.focus();
  } else {
    _stopPoll();
  }
  _updateBadge();
}

function openWhisper(id, handle) {
  const convo = _getConvo(handle);
  convo.unread = 0;
  convo.playerId = id;  // cache so send doesn't need to re-fetch
  if (!_isChannel(handle) && handle !== USERS_TAB) _lastPmTab = handle;
  _switchTab(handle);
  if (!_panelOpen) {
    _panelOpen = true;
    document.getElementById('whisper-panel').style.display = 'flex';
    const btn = document.getElementById('whisper-nav-btn');
    if (btn) btn.style.color = 'var(--accent)';
    _applyWindowSize();
    _applyTextSize();
    _startPoll();
  }
  if (!_isSystemOnly(handle)) document.getElementById('whisper-input')?.focus();
  _updateBadge();
}

// Open a channel/DM tab by key (channels have no player id).
function _openTab(key) {
  _getConvo(key);
  if (!_isChannel(key) && key !== USERS_TAB) _lastPmTab = key;
  _switchTab(key);
  if (!_isSystemOnly(key)) document.getElementById('whisper-input')?.focus();
  _updateBadge();
}

function closeWhisper() {
  _panelOpen = false;
  document.getElementById('whisper-panel').style.display = 'none';
  const btn = document.getElementById('whisper-nav-btn');
  if (btn) btn.style.color = '';
  _stopPoll();
  _updateBadge();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function _switchTab(key) {
  _activeTab = key;
  const convo = _convos.get(key);
  if (convo) convo.unread = 0;
  _updateBadge();
  _refreshTabs();
  _renderLog();
  const footer = document.getElementById('whisper-footer');
  if (footer) footer.style.display = (key === USERS_TAB || _isSystemOnly(key)) ? 'none' : 'flex';
  if (key === USERS_TAB) _fetchOnline();
}

function _refreshTabs() {
  const tabs = document.getElementById('whisper-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';

  const mkPip = () => {
    const pip = document.createElement('span');
    pip.textContent = '!';
    pip.style.cssText = 'position:absolute;top:-5px;left:-5px;background:var(--red);color:#fff;font-size:9px;font-weight:bold;width:12px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;pointer-events:none';
    return pip;
  };

  const mkTab = (label, key, color, unread) => {
    const active = _activeTab === key;
    const btn = document.createElement('button');
    btn.style.cssText = `position:relative;background:${active ? 'var(--bg3)' : 'transparent'};border:1px solid ${active ? color : 'var(--border)'};color:${active ? color : 'var(--text-dim)'};font-family:var(--font);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;white-space:nowrap;flex-shrink:0`;
    btn.textContent = label;
    btn.onclick = () => _switchTab(key);
    if (unread > 0) btn.appendChild(mkPip());
    tabs.appendChild(btn);
    return btn;
  };

  // Count DM unread (for the Chats hub pip), excluding the pinned quick-access tab.
  let pmUnread = 0;
  for (const [key, convo] of _convos) {
    if (_isChannel(key) || key === USERS_TAB) continue;
    if (key !== _lastPmTab && convo.unread > 0) pmUnread += convo.unread;
  }

  mkTab('Chats', USERS_TAB, 'var(--purple)', pmUnread);
  for (const ch of CHANNELS) mkTab(ch.id, ch.id, 'var(--yellow)', _convos.get(ch.id)?.unread || 0);

  // One DM stays pinned here as a quick-access tab (the last one opened); it has
  // no close button — closing happens from the Chats hub, and switching DMs
  // re-pins this slot. Keeps the strip from sprawling off-screen.
  if (_lastPmTab && _convos.has(_lastPmTab) && !_isChannel(_lastPmTab)) {
    const active = _activeTab === _lastPmTab;
    const convo = _convos.get(_lastPmTab);
    const btn = mkTab(_lastPmTab, _lastPmTab, 'var(--accent)', active ? 0 : (convo?.unread || 0));
    btn.onclick = () => _openTab(_lastPmTab);
  }
}

function _closeTab(key) {
  _saveConvos();
  _convos.delete(key);
  // Re-pin the quick-access slot to another remaining DM (if any).
  if (_lastPmTab === key) {
    _lastPmTab = null;
    for (const [k] of _convos) {
      if (_isChannel(k) || k === USERS_TAB) continue;
      _lastPmTab = k;
      break;
    }
  }
  if (_activeTab === key) _switchTab(USERS_TAB);
  else { _refreshTabs(); _updateBadge(); }
}

// ── Log render ────────────────────────────────────────────────────────────────

function _renderLog() {
  const log = document.getElementById('whisper-log');
  if (!log) return;
  if (_activeTab === USERS_TAB) {
    _renderUsersTab(log);
    document.getElementById('whisper-new-msgs').style.display = 'none';
    return;
  }
  const convo = _convos.get(_activeTab);
  if (!convo) return;
  // Was the view pinned to the bottom before this rebuild? A fresh convo
  // (stickBottom undefined) defaults to pinned; #system pins to the top.
  const stick = convo.stickBottom !== false;
  log.innerHTML = '';
  if (convo.messages.length === 0) {
    log.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px 0">No messages yet.</div>';
    document.getElementById('whisper-new-msgs').style.display = 'none';
    return;
  }
  for (const m of convo.messages) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border)';
    if (m.isMOTD) {
      el.innerHTML = `<pre style="font-family:var(--font-mono);white-space:pre;margin:0;line-height:1.3;tab-size:4;color:var(--text);font-size:${FONT_SIZES[_textSize]}">${_esc(m.message)}</pre>`;
    } else {
      const nameColor = m.isMe ? 'var(--text-dim)' : 'var(--purple)';
      const body = m.isHtml ? m.message : renderMarkup(m.message);
      el.innerHTML = `<div style="font-size:10px;color:${nameColor};margin-bottom:2px;font-style:${m.isMe ? 'italic' : ''}">${_esc(m.from)}</div><div style="color:var(--text)">${body}</div>`;
    }
    log.appendChild(el);
  }
  log.scrollTop = stick ? log.scrollHeight : convo.scrollTop || 0;
  _checkScroll();
}

function _renderUsersTab(log) {
  let html = '';

  // Open DM conversations — the scalable home for whispers.
  const pms = [];
  for (const [key, convo] of _convos) {
    if (_isChannel(key) || key === USERS_TAB) continue;
    pms.push([key, convo]);
  }
  if (pms.length > 0) {
    html += '<div style="padding:4px 0 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Conversations</div>';
    for (const [key, convo] of pms) {
      const h = _esc(key);
      const badge = convo.unread > 0
        ? `<span style="background:var(--red);color:#fff;font-size:9px;font-weight:bold;min-width:12px;height:12px;padding:0 3px;border-radius:2px;display:inline-flex;align-items:center;justify-content:center">${convo.unread}</span>`
        : '';
      html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 0;border-bottom:1px solid var(--border)"><button data-pm="${h}" data-id="${_esc(convo.playerId || '')}" style="flex:1;text-align:left;background:transparent;border:none;color:var(--text);font-family:var(--font);font-size:12px;cursor:pointer;padding:0">${h}</button>${badge}<button data-pm-close="${h}" title="Close conversation" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-size:11px;line-height:1;width:16px;height:16px;padding:0;cursor:pointer;border-radius:2px">×</button></div>`;
    }
  }

  html += '<div style="padding:8px 0 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Channels</div>';
  for (const ch of CHANNELS) {
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--yellow)">${ch.id}</span><button data-channel="${_esc(ch.id)}" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font);font-size:9px;padding:2px 6px;cursor:pointer;border-radius:2px">open</button></div>`;
  }

  html += '<div style="padding:10px 0 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Online now</div>';
  html += _onlinePlayers.length
    ? _onlinePlayers.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--text)">${_esc(p.handle)}${p.current_zone === null ? ' <span style="color:var(--text-dim);font-size:10px">[dev]</span>' : ''}</span><button data-whisper="${_esc(p.handle)}" data-id="${_esc(p.id)}" style="background:transparent;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0 2px;line-height:1">💬</button></div>`).join('')
    : '<div style="padding:8px 0;color:var(--text-dim);font-size:11px">No players online.</div>';
  html += '<div style="padding:6px 0"><button id="whisper-refresh-btn" style="width:100%;background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:4px;cursor:pointer;border-radius:2px">↻ Refresh</button></div>';

  log.innerHTML = html;

  log.querySelectorAll('[data-pm]').forEach(btn => {
    btn.addEventListener('click', () => openWhisper(btn.dataset.id || null, btn.dataset.pm));
  });
  log.querySelectorAll('[data-pm-close]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); _closeTab(btn.dataset.pmClose); _renderUsersTab(log); });
  });
  log.querySelectorAll('[data-channel]').forEach(btn => {
    btn.addEventListener('click', () => _openTab(btn.dataset.channel));
  });
  log.querySelectorAll('[data-whisper]').forEach(btn => {
    btn.addEventListener('click', () => openWhisper(btn.dataset.id, btn.dataset.whisper));
  });
  log.querySelector('#whisper-refresh-btn')?.addEventListener('click', _fetchOnline);
}

// ── Scroll ──────────────────────────────────────────────────────────────────────

function _checkScroll() {
  const log = document.getElementById('whisper-log');
  const pill = document.getElementById('whisper-new-msgs');
  if (!log || !pill) return;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  if (nearBottom) pill.style.display = 'none';
}

function _scrollToBottom() {
  const log = document.getElementById('whisper-log');
  if (log) log.scrollTop = log.scrollHeight;
  document.getElementById('whisper-new-msgs').style.display = 'none';
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function _openWhisperByHandle(handle) {
  await _fetchOnline();
  const found = _onlinePlayers.find(p => p.handle.toLowerCase() === handle.toLowerCase());
  if (!found) { toast(`"${handle}" is not online.`, true); return; }
  openWhisper(found.id, found.handle);
}

async function _sendMessage() {
  const input = document.getElementById('whisper-input');
  const raw = input?.value?.trim();
  if (!raw || _activeTab === USERS_TAB) return;

  // Client-only commands
  if (raw.toLowerCase() === '.markup') {
    input.value = '';
    _appendToLog(MARKUP_HELP_HTML);
    return;
  }
  const whisperCmd = raw.match(/^whisper\s+(\S+)$/i);
  if (whisperCmd) {
    input.value = '';
    _openWhisperByHandle(whisperCmd[1]);
    return;
  }

  // Expand $tokens (dev only resolves $name) before sending
  const msg = raw.toLowerCase() === '.status' ? expandTokens(STATUS_TEMPLATE) : expandTokens(raw);

  const ch = CHANNELS.find(c => c.id === _activeTab);
  if (ch) {
    if (ch.systemOnly) return;
    const from = _myHandle || 'Admin';
    const r = await API(`/channels/${encodeURIComponent(_activeTab.replace(/^#/, ''))}/message`, 'POST', { message: msg, handle: from });
    if (r?.error) { toast(r.error, true); return; }
    input.value = '';
    // Echo locally right away instead of waiting for the next 3s poll; record it
    // so _receiveChannelMsg drops the poll's copy of this exact line.
    const convo = _getConvo(_activeTab);
    convo.messages.push({ from, message: msg, ts: Date.now() });
    if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
    convo.stickBottom = true;
    _pendingSelfEchoes.push({ tab: _activeTab, message: msg, ts: Date.now() });
    _renderLog();
    return;
  }

  // DM — use cached player ID from when the tab was opened, fall back to online list
  const convo = _getConvo(_activeTab);
  const pid = convo.playerId || _onlinePlayers.find(p => p.handle === _activeTab)?.id;
  if (!pid) { toast(`${_activeTab} is not online.`, true); return; }
  const r = await API(`/players/${pid}/whisper`, 'POST', { message: msg });
  if (r?.error) { toast(r.error, true); return; }
  convo.messages.push({ from: 'You', message: msg, isMe: true, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  convo.stickBottom = true; // sending your own line re-pins to the bottom
  _saveConvos();
  input.value = '';
  _renderLog();
}

// Append raw HTML into the active tab's log (used by .markup help).
function _appendToLog(html) {
  const log = document.getElementById('whisper-log');
  if (!log || _activeTab === USERS_TAB) return;
  const div = document.createElement('div');
  div.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border)';
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ── Receive ───────────────────────────────────────────────────────────────────

function _receiveChannelMsg(channelId, from, message) {
  if (!_isChannel(channelId)) return;
  // Your own optimistically-shown line is echoed back by the poll — drop that copy.
  if (from === (_myHandle || 'Admin') && _consumeSelfEcho(channelId, message)) return;
  const convo = _getConvo(channelId);
  convo.messages.push({ from, message, ts: Date.now() });
  if (convo.messages.length > WHISPER_MAX_MSGS) convo.messages.shift();
  if (_panelOpen && _activeTab === channelId) {
    _renderLog();
    document.getElementById('whisper-new-msgs').style.display =
      convo.stickBottom === false ? 'block' : 'none';
  } else {
    convo.unread++;
    _updateBadge();
    if (_panelOpen) _refreshTabs();
  }
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function _updateBadge() {
  let total = 0;
  for (const c of _convos.values()) total += c.unread;
  const btn = document.getElementById('whisper-nav-btn');
  if (!btn) return;
  const label = '💬 Chat';
  if (total > 0 && !_panelOpen) {
    btn.textContent = `${label} (${total})`;
    btn.style.color = 'var(--red)';
  } else {
    btn.textContent = label;
    btn.style.color = _panelOpen ? 'var(--accent)' : '';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

let _inited = false;
function initWhisperPanel() {
  if (_inited) return;
  _inited = true;
  _myHandle = typeof devHandle !== 'undefined' ? devHandle : null;
  _loadSettings();
  _loadConvos();
  for (const ch of CHANNELS) _getConvo(ch.id);
  // Re-pin the last DM if one was restored from storage.
  for (const [k] of _convos) {
    if (_isChannel(k) || k === USERS_TAB) continue;
    _lastPmTab = k;
  }
  _refreshTabs();
  _renderLog();
  _updateBadge();

  window.addEventListener('beforeunload', _saveConvos);

  const whisperInput = document.getElementById('whisper-input');
  whisperInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _sendMessage();
  });
  whisperInput?.addEventListener('input', () => _emojiAutoReplace(whisperInput));
  document.getElementById('whisper-send-btn')?.addEventListener('click', _sendMessage);
  document.getElementById('whisper-new-msgs')?.addEventListener('click', _scrollToBottom);
  document.getElementById('whisper-scroll-bottom')?.addEventListener('click', _scrollToBottom);

  // Per-convo scroll memory + new-msgs pill dismissal
  document.getElementById('whisper-log')?.addEventListener('scroll', () => {
    if (!_activeTab || _activeTab === USERS_TAB) return;
    const log = document.getElementById('whisper-log');
    const convo = _convos.get(_activeTab);
    if (convo) {
      convo.scrollTop = log.scrollTop;
      convo.stickBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    }
    _checkScroll();
  });

  // Close button
  document.querySelector('#whisper-panel [data-close]')?.addEventListener('click', closeWhisper);

  // ── Cog menu (window/text size) ──────────────────────────────────────────────
  const cogBtn = document.getElementById('whisper-cog-btn');
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
        _measureMotdDims();
        _applyWindowSize();
        _rerenderMotd();
        cogMenu.style.display = 'none';
      });
    });
  }

  // ── Emoji picker ─────────────────────────────────────────────────────────────
  const EMOJIS = ['😂', '💀', '🔥', '⚡', '☢️', '💉', '🩸', '🗡️', '💣', '🤡', '😈', '👿', '🤖', '👾', '🧠', '👁️', '🤢', '😤', '😭', '💯', '🤙', '👋', '🫡', '❤️', '✨', '💥', '🎯', '🏚️', '💊', '🚬', '🍺', '💰'];
  const footer = document.getElementById('whisper-footer');
  const sendBtn = document.getElementById('whisper-send-btn');
  if (footer && sendBtn) {
    const emojiBtn = document.createElement('button');
    emojiBtn.textContent = '😊';
    emojiBtn.title = 'Insert emoji';
    emojiBtn.style.cssText = 'background:transparent;border:1px solid var(--border);color:var(--text);font-size:14px;padding:3px 7px;cursor:pointer;border-radius:2px;flex-shrink:0;line-height:1';

    const emojiPicker = document.createElement('div');
    emojiPicker.style.cssText = 'display:none;position:absolute;bottom:calc(100% + 4px);right:0;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px;gap:4px;flex-wrap:wrap;width:220px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.4)';

    for (const emoji of EMOJIS) {
      const b = document.createElement('button');
      b.textContent = emoji;
      const code = Object.keys(EMOJI_SHORTCODES).find(k => EMOJI_SHORTCODES[k] === emoji);
      if (code) b.title = `:${code}:`;
      b.style.cssText = 'background:transparent;border:none;font-size:18px;cursor:pointer;padding:2px;border-radius:2px;line-height:1';
      b.addEventListener('mouseenter', () => { b.style.background = 'var(--bg3)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      b.addEventListener('click', () => {
        const inp = document.getElementById('whisper-input');
        if (!inp) return;
        const start = inp.selectionStart ?? inp.value.length;
        const end = inp.selectionEnd ?? inp.value.length;
        inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
        inp.selectionStart = inp.selectionEnd = start + emoji.length;
        inp.focus();
        emojiPicker.style.display = 'none';
      });
      emojiPicker.appendChild(b);
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
    footer.insertBefore(emojiWrap, sendBtn);
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────
  const dragHandle = document.getElementById('whisper-drag-handle');
  const panel = document.getElementById('whisper-panel');
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
    const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - dragState.ox));
    const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - dragState.oy));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
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

// ── Channel history on open ───────────────────────────────────────────────────

async function _loadChannelHistory() {
  try {
    const data = await API('/channels/messages?since=0');
    let maxTs = 0;
    for (const [channelId, messages] of Object.entries(data || {})) {
      const convo = _getConvo(channelId);
      if (convo.messages.length === 0) {
        for (const m of messages) convo.messages.push({ from: m.from, message: m.message, ts: m.ts });
      }
      for (const m of messages) if (m.ts > maxTs) maxTs = m.ts;
    }
    // Seed the poll cursor from the newest *server* timestamp we loaded, not the
    // local clock — otherwise a browser clock behind the DB re-fetches the last
    // history line on the first poll. Fall back to now() when there's no history.
    _lastPollTs = Math.max(Date.now(), maxTs);
    if (_panelOpen && _isChannel(_activeTab)) _renderLog();
  } catch {}
}
