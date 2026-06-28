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
        top: 60px;
        right: 20px;
        width: 540px;
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 80px);
        background: color-mix(in srgb, var(--bg) 92%, #7c3aed 8%);
        border: 1px solid #7c3aed;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        z-index: 600;
        font-family: var(--font);
        font-size: 12px;
        box-shadow: 0 8px 32px rgba(124,58,237,0.25);
      }
      #ghost-dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid #7c3aed44;
        color: #a78bfa;
        font-size: 11px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: move;
        user-select: none;
        flex-shrink: 0;
      }
      #ghost-zone-label {
        color: var(--text);
        text-transform: none;
        letter-spacing: 0;
        font-size: 12px;
      }
      #ghost-feed {
        flex: 1;
        overflow-y: auto;
        padding: 10px 12px;
        min-height: 280px;
        max-height: 420px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        line-height: 1.5;
      }
      .ghost-msg { color: var(--text-dim); }
      .ghost-msg.ghost-look { color: var(--text); }
      .ghost-msg.ghost-event { color: #6b7280; font-style: italic; }
      .ghost-msg.ghost-say { color: #d1fae5; }
      .ghost-msg.ghost-system { color: #9f7aea; }
      .ghost-msg.ghost-error { color: var(--red); }
      .ghost-msg.ghost-info { color: #a78bfa; }
      #ghost-input-row {
        display: flex;
        gap: 6px;
        padding: 8px 12px;
        border-top: 1px solid #7c3aed44;
        flex-shrink: 0;
      }
      #ghost-cmd {
        flex: 1;
        background: var(--bg3);
        border: 1px solid #7c3aed66;
        color: var(--text);
        font-family: var(--font);
        font-size: 12px;
        padding: 5px 8px;
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
      <div id="ghost-feed"></div>
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
  }

  function makeDraggable(el, handle) {
    let ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      function onMove(e) {
        el.style.left = (e.clientX - ox) + 'px';
        el.style.top  = (e.clientY - oy) + 'px';
        el.style.right = 'auto';
      }
      function onUp() {
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
        appendFeed(msg.message, 'ghost-look', true);
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
        if (msg.message) appendFeed(msg.message, 'ghost-msg', true);
        break;
    }
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
