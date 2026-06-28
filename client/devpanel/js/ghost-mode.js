// Ghost Mode — in-panel floating dialog with live zone observation
// Opens a dedicated WebSocket to the game server tagged as a ghost session.
// The admin's real character is not moved; ghost location is independent.

(function () {
  let ghostWs = null;
  let currentGhostZoneId = null;

  function injectStyles() {
    if (document.getElementById('ghost-mode-styles')) return;
    const style = document.createElement('style');
    style.id = 'ghost-mode-styles';
    style.textContent = `
      #ghost-dialog {
        position: fixed;
        top: 50px;
        left: 50%;
        transform: translateX(-50%);
        width: min(1000px, calc(100vw - 40px));
        height: min(720px, calc(100vh - 70px));
        background: var(--bg, #05050a);
        border: 1px solid #7c3aed;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        z-index: 600;
        font-family: var(--font, 'Courier New', monospace);
        font-size: 13px;
        box-shadow: 0 8px 32px rgba(124,58,237,0.35);
      }
      #ghost-dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 14px;
        border-bottom: 1px solid #7c3aed44;
        color: #a78bfa;
        font-size: 11px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: move;
        user-select: none;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--bg, #05050a) 90%, #7c3aed 10%);
        border-radius: 4px 4px 0 0;
      }
      #ghost-zone-label {
        color: var(--text, #e8e8f5);
        text-transform: none;
        letter-spacing: 0;
        font-size: 13px;
      }
      #ghost-body {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }
      /* Top pane: zone look / description */
      #ghost-area-pane {
        flex: 0 0 220px;
        overflow-y: auto;
        padding: 10px 14px;
        background: var(--bg, #05050a);
        color: var(--text-bright, #ffffff);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.55;
        font-size: 13px;
      }
      #ghost-area-pane::-webkit-scrollbar { width: 5px; }
      #ghost-area-pane::-webkit-scrollbar-track { background: var(--bg2, #0d0d16); }
      #ghost-area-pane::-webkit-scrollbar-thumb { background: #7c3aed55; border-radius: 3px; }
      /* Resize handle */
      #ghost-resize-handle {
        flex: 0 0 5px;
        background: #7c3aed33;
        cursor: ns-resize;
        transition: background 0.15s;
      }
      #ghost-resize-handle:hover,
      #ghost-resize-handle.dragging {
        background: #7c3aed;
      }
      /* Bottom pane: event log */
      #ghost-feed {
        flex: 1;
        overflow-y: auto;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        background: var(--bg, #05050a);
        line-height: 1.5;
      }
      #ghost-feed > :first-child { margin-top: auto; }
      #ghost-feed::-webkit-scrollbar { width: 5px; }
      #ghost-feed::-webkit-scrollbar-track { background: var(--bg2, #0d0d16); }
      #ghost-feed::-webkit-scrollbar-thumb { background: #7c3aed55; border-radius: 3px; }
      .ghost-msg {
        padding: 2px 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .ghost-msg.ghost-event   { color: var(--text-dim, #8888a8); font-style: italic; }
      .ghost-msg.ghost-say     { color: var(--cyan, #28e5ff); }
      .ghost-msg.ghost-system  { color: var(--text-dim, #8888a8); font-style: italic; }
      .ghost-msg.ghost-output  { color: var(--text, #e8e8f5); }
      .ghost-msg.ghost-error   { color: var(--red, #ff3b5c); }
      .ghost-msg.ghost-info    { color: #a78bfa; }
      #ghost-input-row {
        display: flex;
        gap: 6px;
        padding: 8px 14px;
        border-top: 1px solid #7c3aed44;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--bg, #05050a) 95%, #7c3aed 5%);
      }
      #ghost-cmd {
        flex: 1;
        background: var(--bg3, #15151f);
        border: 1px solid #7c3aed66;
        color: var(--text, #e8e8f5);
        font-family: var(--font, 'Courier New', monospace);
        font-size: 13px;
        padding: 6px 10px;
        outline: none;
        border-radius: 2px;
      }
      #ghost-cmd:focus { border-color: #7c3aed; }
    `;
    document.head.appendChild(style);
  }

  function openGhostDialog(zoneId) {
    injectStyles();
    directAPI('/ghost/token', 'POST', { zoneId }).then(res => {
      if (res.error) { toast(`Ghost mode failed: ${res.error}`, true); return; }
      currentGhostZoneId = zoneId;
      buildDialog();
      connectGhostWs(res.token);
    });
  }

  function buildDialog() {
    const existing = document.getElementById('ghost-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'ghost-dialog';
    dialog.innerHTML = `
      <div id="ghost-dialog-header">
        <span>👻 GHOST MODE &mdash; <span id="ghost-zone-label">Connecting...</span></span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="action-btn" onclick="ghostMaterialize()" title="Teleport your character here and switch to the game client">Materialize</button>
          <button class="action-btn danger" onclick="closeGhostDialog()">✕ Exit</button>
        </div>
      </div>
      <div id="ghost-body">
        <div id="ghost-area-pane"><span style="color:#7c3aed88;font-style:italic">Entering zone...</span></div>
        <div id="ghost-resize-handle"></div>
        <div id="ghost-feed"></div>
      </div>
      <div id="ghost-input-row">
        <input id="ghost-cmd" type="text" placeholder="look · go north · haunt &lt;player&gt;" autocomplete="off" spellcheck="false">
        <button class="action-btn" onclick="sendGhostCommand()">Send</button>
      </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById('ghost-cmd').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendGhostCommand();
    });
    document.getElementById('ghost-cmd').focus();

    makeDraggable(dialog, document.getElementById('ghost-dialog-header'));
    makeResizable(
      document.getElementById('ghost-resize-handle'),
      document.getElementById('ghost-area-pane')
    );
  }

  function makeDraggable(el, handle) {
    let ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
      // don't interfere with button clicks inside the header
      if (e.target.tagName === 'BUTTON') return;
      el.style.transform = 'none';
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      function onMove(e) {
        el.style.left = (e.clientX - ox) + 'px';
        el.style.top  = (e.clientY - oy) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function makeResizable(handle, pane) {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('dragging');
      const startY = e.clientY;
      const startH = pane.getBoundingClientRect().height;
      function onMove(e) {
        const newH = Math.max(80, Math.min(startH + (e.clientY - startY), 560));
        pane.style.flex = `0 0 ${newH}px`;
      }
      function onUp() {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function connectGhostWs(token) {
    if (ghostWs) ghostWs.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ghostWs = new WebSocket(`${proto}//${location.host}`);

    ghostWs.addEventListener('open', () => {
      ghostWs.send(JSON.stringify({ type: 'auth_ghost', token }));
    });

    ghostWs.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleGhostMessage(msg);
    });

    ghostWs.addEventListener('close', () => {
      appendFeed('Connection closed.', 'ghost-info');
    });

    ghostWs.addEventListener('error', () => {
      appendFeed('WebSocket error.', 'ghost-error');
    });
  }

  const DIRECTIONS = new Set(['north','south','east','west','up','down','in','out','n','s','e','w','u','d']);
  const DIR_EXPAND = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down' };

  function sendGhostCommand() {
    const input = document.getElementById('ghost-cmd');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    input.value = '';

    if (!ghostWs || ghostWs.readyState !== WebSocket.OPEN) {
      appendFeed('Not connected.', 'ghost-error');
      return;
    }

    const lower = raw.toLowerCase();
    if (lower === 'look' || lower === 'l') {
      ghostWs.send(JSON.stringify({ type: 'ghost_command', command: 'look' }));
      return;
    }
    if (lower.startsWith('go ')) {
      const dir = DIR_EXPAND[lower.slice(3)] || lower.slice(3);
      ghostWs.send(JSON.stringify({ type: 'ghost_command', command: 'move', direction: dir }));
      return;
    }
    if (DIRECTIONS.has(lower)) {
      const dir = DIR_EXPAND[lower] || lower;
      ghostWs.send(JSON.stringify({ type: 'ghost_command', command: 'move', direction: dir }));
      return;
    }
    if (lower.startsWith('haunt ')) {
      const target = raw.slice(6).trim();
      if (target) ghostWs.send(JSON.stringify({ type: 'ghost_command', command: 'haunt', target }));
      return;
    }
    appendFeed(`Unknown: ${raw}. Try: look, go &lt;dir&gt;, haunt &lt;player&gt;`, 'ghost-error');
  }

  function handleGhostMessage(msg) {
    switch (msg.type) {
      case 'ghost_auth_success':
        break; // look result follows immediately
      case 'ghost_auth_fail':
        appendFeed(msg.message || 'Auth failed.', 'ghost-error');
        break;
      case 'ghost_look': {
        const label = document.getElementById('ghost-zone-label');
        if (label) label.textContent = msg.zoneName || msg.zone || '';
        if (msg.zone) currentGhostZoneId = msg.zone;
        setAreaPane(msg.message);
        break;
      }
      case 'ghost_haunt_result':
        appendFeed(msg.message, 'ghost-info');
        break;
      case 'ghost_error':
        appendFeed(msg.message, 'ghost-error');
        break;
      case 'zone_event':
        if (msg.message) appendFeed(msg.message, 'ghost-event', true);
        break;
      case 'say':
        if (msg.message) appendFeed(msg.message, 'ghost-say', true);
        break;
      case 'system':
        if (msg.message) appendFeed(msg.message, 'ghost-system', true);
        break;
      case 'output':
        if (msg.message) appendFeed(msg.message, 'ghost-output', true);
        break;
    }
  }

  function setAreaPane(html) {
    const pane = document.getElementById('ghost-area-pane');
    if (!pane) return;
    pane.innerHTML = html || '';
    pane.scrollTop = 0;
  }

  function appendFeed(html, cls, isHtml) {
    const feed = document.getElementById('ghost-feed');
    if (!feed) return;
    const div = document.createElement('div');
    div.className = `ghost-msg ${cls || ''}`;
    if (isHtml) {
      div.innerHTML = html;
    } else {
      div.textContent = html;
    }
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }

  async function ghostMaterialize() {
    if (!currentGhostZoneId) { toast('No ghost zone to materialize to.', true); return; }
    if (!devPlayerId) { toast('Not logged in.', true); return; }
    const res = await directAPI(`/players/${devPlayerId}/teleport`, 'POST', { zoneId: currentGhostZoneId });
    if (res.error) { toast(`Teleport failed: ${res.error}`, true); return; }
    closeGhostDialog();
    await launchPlayerClient();
  }

  function closeGhostDialog() {
    if (ghostWs) { ghostWs.close(); ghostWs = null; }
    const dialog = document.getElementById('ghost-dialog');
    if (dialog) dialog.remove();
    currentGhostZoneId = null;
  }

  window.openGhostDialog  = openGhostDialog;
  window.ghostMaterialize = ghostMaterialize;
  window.closeGhostDialog = closeGhostDialog;
  window.sendGhostCommand = sendGhostCommand;
})();
