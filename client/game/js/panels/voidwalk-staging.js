// Voidwalk staging overlay — the pre-crossing muster.
//
// A Tablet-OS-themed window that pops when you `voidwalk` (or walk off the edge):
// your kit, your party, lore for the road ahead, a ready-check, and a private
// party-comms chat (the waiting room). Rendered from the server's
// `voidwalk_staging` payload; the buttons send commands via window._sendRaw.
// Chat lines arrive live as `voidwalk_staging_chat` and append without a rebuild.
// It closes on { close: true } — which the server sends right before the
// crossing's move payloads render the void behind it.

let el = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function chatLineHtml(l) {
  return `<div class="vwstage-chat-msg${l.you ? ' me' : ''}">
    <span class="vwstage-chat-from">${l.leader ? '<span class="vwstage-crown" title="party leader">♛</span>' : ''}${esc(l.handle)}</span>
    <span class="vwstage-chat-text">${esc(l.message)}</span>
  </div>`;
}

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'voidwalk-staging';
  el.className = 'vwstage-overlay';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

export function closeVoidwalkStaging() {
  if (el) el.style.display = 'none';
}

// A single comms line pushed live while the muster is open — append in place so
// we don't clobber a half-typed message or the party's scroll position.
export function appendVoidwalkChat(line) {
  if (!el || el.style.display === 'none' || !line) return;
  const log = el.querySelector('.vwstage-chat-log');
  if (!log) return;
  const empty = log.querySelector('.vwstage-chat-empty');
  if (empty) empty.remove();
  log.insertAdjacentHTML('beforeend', chatLineHtml(line));
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

export function openVoidwalkStaging(msg) {
  if (!msg || msg.close) { closeVoidwalkStaging(); return; }
  const node = ensureEl();

  // Preserve a half-typed comms message across a full re-render (ready/party change).
  const draft = node.querySelector('.vwstage-chat-input')?.value || '';

  const inv = msg.inventory || [];
  const invRows = inv.length
    ? inv.map(it => `<li><span class="vwstage-item">${esc(it.name)}</span>${it.qty > 1 ? `<span class="vwstage-qty">×${it.qty}</span>` : ''}</li>`).join('')
    : '<li class="vwstage-empty">You carry nothing. That is a decision.</li>';

  const party = msg.party || [];
  const partyRows = party.map(p => `
    <li class="${p.ready ? 'vwstage-p-ready' : ''}">
      <span class="vwstage-dot">${p.ready ? '✓' : '○'}</span>
      <span class="vwstage-who">${p.leader ? '<span class="vwstage-crown" title="party leader">♛</span>' : ''}${esc(p.handle)}${p.you ? '<span class="vwstage-tag vwstage-tag-you">you</span>' : ''}</span>
      <span class="vwstage-pstate">${p.ready ? 'READY' : 'holding'}</span>
    </li>`).join('');

  const readyCount = party.filter(p => p.ready).length;
  const dests = (msg.dests || []).join('&nbsp; · &nbsp;') || 'the unknown';
  const btnLabel = msg.youReady ? '✓ Ready — holding for the party' : (msg.solo ? 'Walk Off The Edge ▸' : 'Ready Up ▸');
  const btnClass = msg.youReady ? 'vwstage-btn vwstage-btn-done' : 'vwstage-btn vwstage-btn-go';

  // Private comms only make sense with a party — hide it when you set out alone.
  const leaderHandle = (party.find(p => p.leader) || {}).handle || 'the leader';
  const chat = msg.chat || [];
  const chatLog = chat.length ? chat.map(chatLineHtml).join('') : '<div class="vwstage-chat-empty">No word yet. Rally the party.</div>';
  const chatSection = msg.solo ? '' : `
      <div class="vwstage-chat">
        <div class="vwstage-colhead">Party Comms <span class="vwstage-count"><span class="vwstage-crown">♛</span> ${esc(leaderHandle)}</span></div>
        <div class="vwstage-chat-log">${chatLog}</div>
        <div class="vwstage-chat-row">
          <input class="vwstage-chat-input" type="text" maxlength="300" placeholder="Message the party…" autocomplete="off">
          <button class="vwstage-chat-send" data-vwstage="say">Send</button>
        </div>
      </div>`;

  node.innerHTML = `
    <div class="vwstage-panel">
      <span class="vwstage-corner tl"></span><span class="vwstage-corner tr"></span>
      <span class="vwstage-corner bl"></span><span class="vwstage-corner br"></span>
      <div class="vwstage-topbar"><span class="vwstage-os">◈ VOIDLINK</span><span class="vwstage-mode">MUSTER&nbsp;·&nbsp;OFF-GRID&nbsp;EGRESS</span></div>
      <div class="vwstage-head">
        <div class="vwstage-title" data-text="VOIDWALKING">VOIDWALKING</div>
        <div class="vwstage-route"><span class="vwstage-from">${esc(msg.region || 'the frontier')}</span><span class="vwstage-arrow">⟶⟶⟶</span><span class="vwstage-to">${dests}</span></div>
        <div class="vwstage-rule"><span class="vwstage-rule-tag">NO ROADS · NO RESCUE · NO RECORD</span></div>
      </div>
      <div class="vwstage-lore">${esc(msg.lore || '')}</div>
      <div class="vwstage-cols">
        <div class="vwstage-col">
          <div class="vwstage-colhead">Your Kit</div>
          <ul class="vwstage-list vwstage-inv">${invRows}</ul>
        </div>
        <div class="vwstage-col">
          <div class="vwstage-colhead">The Party <span class="vwstage-count">${readyCount}/${party.length} ready</span></div>
          <ul class="vwstage-list vwstage-party">${partyRows}</ul>
        </div>
      </div>
      ${chatSection}
      <div class="vwstage-foot">
        <button class="vwstage-btn vwstage-btn-cancel" data-vwstage="cancel">Stand Down</button>
        <button class="${btnClass}" data-vwstage="ready" ${msg.youReady ? 'disabled' : ''}>${btnLabel}</button>
      </div>
      <div class="vwstage-hint">${msg.solo ? 'You set out alone. The waste keeps no company.' : 'Every hand must ready before the party walks off the edge.'}</div>
    </div>`;

  // The overlay buttons issue real commands — send them as { type:'command' }
  // messages (sendRaw serializes the object straight to the socket; a bare string
  // would arrive as JSON `"ready"` and be dropped by the server's dispatcher).
  const sendCmd = cmd => window._sendRaw && window._sendRaw({ type: 'command', command: cmd });
  const cancelBtn = node.querySelector('[data-vwstage="cancel"]');
  if (cancelBtn) cancelBtn.onclick = () => sendCmd('voidwalk cancel');
  const readyBtn = node.querySelector('[data-vwstage="ready"]');
  if (readyBtn && !msg.youReady) readyBtn.onclick = () => sendCmd('ready');

  const chatInput = node.querySelector('.vwstage-chat-input');
  if (chatInput) {
    chatInput.value = draft;
    const send = () => {
      const t = (chatInput.value || '').trim();
      if (!t) return;
      sendCmd('voidwalk say ' + t);
      chatInput.value = '';
      chatInput.focus();
    };
    const sendBtn = node.querySelector('[data-vwstage="say"]');
    if (sendBtn) sendBtn.onclick = send;
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    const log = node.querySelector('.vwstage-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  node.style.display = 'flex';
}
