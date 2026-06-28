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

      /* ── Area pane (top): auto-sizes to content, max 50% of dialog height ── */
      #ghost-area-pane {
        flex: 0 0 auto;
        max-height: 50%;
        overflow-y: auto;
        padding: 10px 14px;
        background: var(--bg, #05050a);
        display: flex;
        flex-direction: column;
      }
      #ghost-area-pane::-webkit-scrollbar { width: 5px; }
      #ghost-area-pane::-webkit-scrollbar-track { background: var(--bg2, #0d0d16); }
      #ghost-area-pane::-webkit-scrollbar-thumb { background: #7c3aed55; border-radius: 3px; }
      #ghost-area-content {
        flex: 0 0 auto;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.55;
        font-size: 13px;
      }

      /* ── Resize handle ── */
      #ghost-resize-handle {
        flex: 0 0 6px;
        background: var(--border, #2a2a40);
        cursor: ns-resize;
        transition: background 0.15s;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        overflow: visible;
        position: relative;
        flex-shrink: 0;
      }
      #ghost-resize-handle:hover,
      #ghost-resize-handle.dragging { background: #7c3aed; }
      #ghost-resize-reset {
        display: none;
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 9px;
        color: var(--text-dim, #8888a8);
        background: var(--bg2, #0d0d16);
        border: 1px solid var(--border, #2a2a40);
        padding: 1px 5px;
        border-radius: 2px;
        cursor: pointer;
        user-select: none;
        line-height: 1.4;
        z-index: 1;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      #ghost-resize-handle.manual #ghost-resize-reset { display: block; }
      #ghost-resize-reset:hover { color: #a78bfa; border-color: #7c3aed; }

      /* ── Feed pane (bottom): scrolling event log ── */
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

      /* ── Message types — mirror client .msg-* ── */
      .ghost-msg {
        padding: 2px 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .ghost-msg.msg-system   { color: var(--text-dim, #8888a8); font-style: italic; }
      .ghost-msg.msg-say      { color: var(--cyan, #28e5ff); }
      .ghost-msg.msg-zone-event,
      .ghost-msg.msg-ambient  { color: var(--text-dim, #8888a8); font-style: italic; }
      .ghost-msg.msg-combat   { color: var(--orange, #ff9a3c); }
      .ghost-msg.msg-combat-incoming { color: var(--red, #ff3b5c); }
      .ghost-msg.msg-move     { color: var(--cyan, #28e5ff); opacity: 0.85; }
      .ghost-msg.msg-loot     { color: var(--green, #39ff8f); }
      .ghost-msg.msg-error    { color: var(--red, #ff3b5c); }
      .ghost-msg.msg-info     { color: #a78bfa; }
      .ghost-msg.msg-output   { color: var(--text, #e8e8f5); }
      .ghost-msg.msg-death    { color: var(--red, #ff3b5c); font-weight: bold; }
      .ghost-msg.msg-separator { color: var(--border, #2a2a40); margin: 4px 0; }

      /* ── Rich text classes used inside server HTML output ── */
      #ghost-area-content .zone-name,
      #ghost-feed .zone-name {
        color: var(--accent, #ff2ec4);
        font-size: 15px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 2px;
      }
      #ghost-area-content .zone-danger,
      #ghost-feed .zone-danger { font-size: 11px; padding: 1px 5px; border-radius: 2px; }
      #ghost-area-content .zone-danger-safe,
      #ghost-feed .zone-danger-safe   { color: var(--green, #39ff8f); border: 1px solid var(--green, #39ff8f); }
      #ghost-area-content .zone-danger-low,
      #ghost-feed .zone-danger-low    { color: var(--yellow, #f5e642); border: 1px solid var(--yellow, #f5e642); }
      #ghost-area-content .zone-danger-medium,
      #ghost-feed .zone-danger-medium { color: var(--orange, #ff9a3c); border: 1px solid var(--orange, #ff9a3c); }
      #ghost-area-content .zone-danger-high,
      #ghost-feed .zone-danger-high   { color: var(--red, #ff3b5c); border: 1px solid var(--red, #ff3b5c); }
      #ghost-area-content .zone-danger-lethal,
      #ghost-feed .zone-danger-lethal { color: var(--red, #ff3b5c); border: 1px solid var(--red, #ff3b5c); background: rgba(224,85,85,0.15); }
      #ghost-area-content .exits-label,
      #ghost-area-content .npcs-label,
      #ghost-area-content .players-label,
      #ghost-area-content .items-label,
      #ghost-area-content .enemies-label,
      #ghost-area-content .corpses-label,
      #ghost-area-content .furniture-label,
      #ghost-area-content .rooms-label,
      #ghost-area-content .buildings-label,
      #ghost-feed .exits-label,
      #ghost-feed .npcs-label,
      #ghost-feed .players-label,
      #ghost-feed .items-label,
      #ghost-feed .corpses-label,
      #ghost-feed .furniture-label,
      #ghost-feed .rooms-label,
      #ghost-feed .buildings-label { color: var(--text-dim, #8888a8); }
      #ghost-area-content .enemies-label,
      #ghost-feed .enemies-label { color: var(--orange, #ff9a3c); }
      #ghost-area-content .apartment-label,
      #ghost-feed .apartment-label { color: var(--cyan, #28e5ff); font-weight: 600; }
      #ghost-area-content .rad-warning,
      #ghost-feed .rad-warning { color: var(--green, #39ff8f); font-size: 11px; }
      #ghost-area-content .pvp-warning,
      #ghost-feed .pvp-warning { color: var(--red, #ff3b5c); font-size: 11px; }
      #ghost-area-content .light-level,
      #ghost-feed .light-level { display: block; font-size: 11px; font-style: italic; margin: 2px 0; }
      #ghost-area-content .light-clear,
      #ghost-feed .light-clear { color: var(--text-dim, #8888a8); }
      #ghost-area-content .light-dim,
      #ghost-feed .light-dim   { color: var(--yellow, #f5e642); }
      #ghost-area-content .light-dark,
      #ghost-feed .light-dark  { color: var(--red, #ff3b5c); }
      #ghost-area-content .hit-part,
      #ghost-feed .hit-part    { color: var(--cyan, #28e5ff); }
      #ghost-area-content .dmg-dealt,
      #ghost-area-content .dmg-taken,
      #ghost-feed .dmg-dealt,
      #ghost-feed .dmg-taken   { color: var(--text-bright, #fff); font-weight: bold; }
      #ghost-area-content .dmg-type,
      #ghost-feed .dmg-type    { color: var(--purple, #b86bff); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
      #ghost-area-content .crit-tag,
      #ghost-feed .crit-tag    { color: var(--yellow, #f5e642); font-weight: bold; }
      #ghost-area-content .item-rarity-uncommon,
      #ghost-feed .item-rarity-uncommon { color: var(--green, #39ff8f); }
      #ghost-area-content .item-rarity-rare,
      #ghost-feed .item-rarity-rare     { color: var(--cyan, #28e5ff); }
      #ghost-area-content .item-rarity-very_rare,
      #ghost-feed .item-rarity-very_rare { color: var(--purple, #b86bff); }
      #ghost-area-content .action-link,
      #ghost-feed .action-link {
        color: var(--accent, #ff2ec4);
        text-decoration: underline;
        cursor: pointer;
      }
      #ghost-area-content .exit-link,
      #ghost-feed .exit-link { color: var(--cyan, #28e5ff); }
      #ghost-area-content .status-flags,
      #ghost-feed .status-flags { color: var(--cyan, #28e5ff); font-size: 12px; }

      /* ── Input row ── */
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
        <div id="ghost-area-pane">
          <div id="ghost-area-content"><span style="color:#7c3aed88;font-style:italic">Entering zone...</span></div>
        </div>
        <div id="ghost-resize-handle"><span id="ghost-resize-reset">auto</span></div>
        <div id="ghost-feed"></div>
      </div>
      <div id="ghost-input-row">
        <input id="ghost-cmd" type="text" placeholder="look · go north · haunt &lt;player&gt;" autocomplete="off" spellcheck="false">
        <button class="action-btn" onclick="sendGhostCommand()">Send</button>
      </div>
    `;
    document.body.appendChild(dialog);

    setupResizeHandle();

    document.getElementById('ghost-cmd').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendGhostCommand();
    });
    document.getElementById('ghost-cmd').focus();

    makeDraggable(dialog, document.getElementById('ghost-dialog-header'));
  }

  function setupResizeHandle() {
    const handle   = document.getElementById('ghost-resize-handle');
    const resetBtn = document.getElementById('ghost-resize-reset');
    const pane     = document.getElementById('ghost-area-pane');
    const body     = document.getElementById('ghost-body');

    function setAuto() {
      pane.style.height = '';
      pane.style.maxHeight = '';
      handle.classList.remove('manual');
    }

    function setManual(px) {
      pane.style.height = px + 'px';
      pane.style.maxHeight = 'none';
      handle.classList.add('manual');
    }

    // When new look content arrives in auto mode, reset so pane re-fits
    pane.addEventListener('contentupdate', () => {
      if (!handle.classList.contains('manual')) setAuto();
    });

    resetBtn.addEventListener('click', e => { e.stopPropagation(); setAuto(); });
    handle.addEventListener('dblclick', () => setAuto());

    let startY, startH;
    handle.addEventListener('mousedown', e => {
      if (e.target === resetBtn) return;
      startY = e.clientY;
      startH = pane.getBoundingClientRect().height;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';

      function onMove(e) {
        const bodyH = body.getBoundingClientRect().height;
        const newH = Math.min(bodyH - 80, Math.max(40, startH + (e.clientY - startY)));
        setManual(newH);
      }
      function onUp() {
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function makeDraggable(el, handle) {
    let ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
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
      appendFeed('Connection closed.', 'msg-info');
    });

    ghostWs.addEventListener('error', () => {
      appendFeed('WebSocket error.', 'msg-error');
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
      appendFeed('Not connected.', 'msg-error');
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
    appendFeed(`Unknown: ${raw}. Try: look, go &lt;dir&gt;, haunt &lt;player&gt;`, 'msg-error');
  }

  function handleGhostMessage(msg) {
    switch (msg.type) {
      case 'ghost_auth_success':
        break; // look result follows immediately
      case 'ghost_auth_fail':
        appendFeed(msg.message || 'Auth failed.', 'msg-error');
        break;
      case 'ghost_look': {
        const label = document.getElementById('ghost-zone-label');
        if (label) label.textContent = msg.zoneName || msg.zone || '';
        if (msg.zone) currentGhostZoneId = msg.zone;
        setAreaContent(msg.message);
        break;
      }
      case 'ghost_haunt_result':
        appendFeed(msg.message, 'msg-info', true);
        break;
      case 'ghost_error':
        appendFeed(msg.message, 'msg-error');
        break;
      case 'zone_event':
        if (msg.message) appendFeed(msg.message, 'msg-zone-event', true);
        break;
      case 'say':
        if (msg.message) appendFeed(msg.message, 'msg-say', true);
        break;
      case 'system':
        if (msg.message) appendFeed(msg.message, 'msg-system', true);
        break;
      case 'output':
        if (msg.message) appendFeed(msg.message, 'msg-output', true);
        break;
    }
  }

  function setAreaContent(html) {
    const content = document.getElementById('ghost-area-content');
    const pane    = document.getElementById('ghost-area-pane');
    if (!content || !pane) return;
    content.innerHTML = html || '';
    pane.scrollTop = 0;
    pane.dispatchEvent(new CustomEvent('contentupdate'));
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
