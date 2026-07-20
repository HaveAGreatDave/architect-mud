// Journey staging overlay — the pre-crossing muster.
//
// A Tablet-OS-themed window that pops when you `journey` (or walk off the edge):
// your kit, your party, lore for the road ahead, and a ready-check. Rendered from
// the server's `journey_staging` payload; the buttons send commands via
// window._sendRaw. It closes on { close: true } — which the server sends right
// before the crossing's move payloads render the void behind it.

let el = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

export function openJourneyStaging(msg) {
  if (!msg || msg.close) { closeJourneyStaging(); return; }
  const node = ensureEl();

  const inv = msg.inventory || [];
  const invRows = inv.length
    ? inv.map(it => `<li><span class="jstage-item">${esc(it.name)}</span>${it.qty > 1 ? `<span class="jstage-qty">×${it.qty}</span>` : ''}</li>`).join('')
    : '<li class="jstage-empty">You carry nothing. That is a decision.</li>';

  const party = msg.party || [];
  const partyRows = party.map(p => `
    <li class="${p.ready ? 'jstage-p-ready' : ''}">
      <span class="jstage-dot">${p.ready ? '✓' : '○'}</span>
      <span class="jstage-who">${esc(p.handle)}${p.leader ? '<span class="jstage-tag">lead</span>' : ''}${p.you ? '<span class="jstage-tag jstage-tag-you">you</span>' : ''}</span>
      <span class="jstage-pstate">${p.ready ? 'READY' : 'holding'}</span>
    </li>`).join('');

  const readyCount = party.filter(p => p.ready).length;
  const dests = (msg.dests || []).join('&nbsp; · &nbsp;') || 'the unknown';
  const btnLabel = msg.youReady ? '✓ Ready — holding for the party' : (msg.solo ? 'Set Out ▸' : 'Ready Up ▸');
  const btnClass = msg.youReady ? 'jstage-btn jstage-btn-done' : 'jstage-btn jstage-btn-go';

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

  node.style.display = 'flex';
}
