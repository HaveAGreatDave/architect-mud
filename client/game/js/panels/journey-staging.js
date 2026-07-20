// Journey staging overlay — the pre-crossing muster.
//
// A Tablet-OS-themed window that pops when you `journey` (or walk off the edge):
// your kit, your party, lore for the road ahead, a ready-check, and a private
// party-comms chat (the waiting room). Rendered from the server's
// `journey_staging` payload; the buttons send commands via window._sendRaw.
// Chat lines arrive live as `journey_staging_chat` and append without a rebuild.
// It closes on { close: true } — which the server sends right before the
// crossing's move payloads render the void behind it.

let el = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function chatLineHtml(l) {
  return `<div class="jstage-chat-msg${l.you ? ' me' : ''}">
    <span class="jstage-chat-from">${l.leader ? '<span class="jstage-crown" title="party leader">♛</span>' : ''}${esc(l.handle)}</span>
    <span class="jstage-chat-text">${esc(l.message)}</span>
  </div>`;
}

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'journey-staging';
  el.className = 'jstage-overlay';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

export function closeJourneyStaging() {
  if (el) el.style.display = 'none';
}

// A single comms line pushed live while the muster is open — append in place so
// we don't clobber a half-typed message or the party's scroll position.
export function appendJourneyChat(line) {
  if (!el || el.style.display === 'none' || !line) return;
  const log = el.querySelector('.jstage-chat-log');
  if (!log) return;
  const empty = log.querySelector('.jstage-chat-empty');
  if (empty) empty.remove();
  log.insertAdjacentHTML('beforeend', chatLineHtml(line));
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

export function openJourneyStaging(msg) {
  if (!msg || msg.close) { closeJourneyStaging(); return; }
  const node = ensureEl();

  // Preserve a half-typed comms message across a full re-render (ready/party change).
  const draft = node.querySelector('.jstage-chat-input')?.value || '';

  const inv = msg.inventory || [];
  const invRows = inv.length
    ? inv.map(it => `<li><span class="jstage-item">${esc(it.name)}</span>${it.qty > 1 ? `<span class="jstage-qty">×${it.qty}</span>` : ''}</li>`).join('')
    : '<li class="jstage-empty">You carry nothing. That is a decision.</li>';

  const party = msg.party || [];
  const partyRows = party.map(p => `
    <li class="${p.ready ? 'jstage-p-ready' : ''}">
      <span class="jstage-dot">${p.ready ? '✓' : '○'}</span>
      <span class="jstage-who">${p.leader ? '<span class="jstage-crown" title="party leader">♛</span>' : ''}${esc(p.handle)}${p.you ? '<span class="jstage-tag jstage-tag-you">you</span>' : ''}</span>
      <span class="jstage-pstate">${p.ready ? 'READY' : 'holding'}</span>
    </li>`).join('');

  const readyCount = party.filter(p => p.ready).length;
  const dests = (msg.dests || []).join('&nbsp; · &nbsp;') || 'the unknown';
  const btnLabel = msg.youReady ? '✓ Ready — holding for the party' : (msg.solo ? 'Set Out ▸' : 'Ready Up ▸');
  const btnClass = msg.youReady ? 'jstage-btn jstage-btn-done' : 'jstage-btn jstage-btn-go';

  // Private comms only make sense with a party — hide it when you set out alone.
  const leaderHandle = (party.find(p => p.leader) || {}).handle || 'the leader';
  const chat = msg.chat || [];
  const chatLog = chat.length ? chat.map(chatLineHtml).join('') : '<div class="jstage-chat-empty">No word yet. Rally the party.</div>';
  const chatSection = msg.solo ? '' : `
      <div class="jstage-chat">
        <div class="jstage-colhead">Party Comms <span class="jstage-count"><span class="jstage-crown">♛</span> ${esc(leaderHandle)}</span></div>
        <div class="jstage-chat-log">${chatLog}</div>
        <div class="jstage-chat-row">
          <input class="jstage-chat-input" type="text" maxlength="300" placeholder="Message the party…" autocomplete="off">
          <button class="jstage-chat-send" data-jstage="say">Send</button>
        </div>
      </div>`;

  node.innerHTML = `
    <div class="jstage-panel">
      <div class="jstage-topbar"><span class="jstage-os">◈ ARCHITECT&nbsp;OS</span><span class="jstage-mode">EXPEDITION&nbsp;MUSTER</span></div>
      <div class="jstage-head">
        <div class="jstage-title">The Crossing</div>
        <div class="jstage-route">${esc(msg.region || 'the frontier')} &nbsp;⟶&nbsp; ${dests}</div>
      </div>
      <div class="jstage-lore">${esc(msg.lore || '')}</div>
      <div class="jstage-cols">
        <div class="jstage-col">
          <div class="jstage-colhead">Your Kit</div>
          <ul class="jstage-list jstage-inv">${invRows}</ul>
        </div>
        <div class="jstage-col">
          <div class="jstage-colhead">The Party <span class="jstage-count">${readyCount}/${party.length} ready</span></div>
          <ul class="jstage-list jstage-party">${partyRows}</ul>
        </div>
      </div>
      ${chatSection}
      <div class="jstage-foot">
        <button class="jstage-btn jstage-btn-cancel" data-jstage="cancel">Stand Down</button>
        <button class="${btnClass}" data-jstage="ready" ${msg.youReady ? 'disabled' : ''}>${btnLabel}</button>
      </div>
      <div class="jstage-hint">${msg.solo ? 'You set out alone. The waste keeps no company.' : 'Every hand must ready before the party walks off the edge.'}</div>
    </div>`;

  const cancelBtn = node.querySelector('[data-jstage="cancel"]');
  if (cancelBtn) cancelBtn.onclick = () => window._sendRaw && window._sendRaw('journey cancel');
  const readyBtn = node.querySelector('[data-jstage="ready"]');
  if (readyBtn && !msg.youReady) readyBtn.onclick = () => window._sendRaw && window._sendRaw('ready');

  const chatInput = node.querySelector('.jstage-chat-input');
  if (chatInput) {
    chatInput.value = draft;
    const send = () => {
      const t = (chatInput.value || '').trim();
      if (!t) return;
      window._sendRaw && window._sendRaw('journey say ' + t);
      chatInput.value = '';
      chatInput.focus();
    };
    const sendBtn = node.querySelector('[data-jstage="say"]');
    if (sendBtn) sendBtn.onclick = send;
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    const log = node.querySelector('.jstage-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  node.style.display = 'flex';
}
