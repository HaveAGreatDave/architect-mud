// Arrest booking record — a dismissible popup the server fires (type:'arrest_notice')
// when you're processed into Precinct 9 holding. Shows the charge, your sentence,
// that your property was seized, and the fine levied against your account. Purely
// informational: it just closes. Modeled on the confirm.js themed window.

let _el = null;

function makeDraggable(win, handle) {
  let ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const r = win.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    win.style.transform = 'none';
    win.style.left = r.left + 'px';
    win.style.top = r.top + 'px';
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const x = Math.max(0, Math.min(globalThis.innerWidth - win.offsetWidth, e.clientX - ox));
    const y = Math.max(0, Math.min(globalThis.innerHeight - win.offsetHeight, e.clientY - oy));
    win.style.left = x + 'px';
    win.style.top = y + 'px';
  });
  handle.addEventListener('pointerup', () => { handle.style.cursor = 'grab'; });
}

function close() { _el?.remove(); _el = null; }

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// msg: { charge, stars, sentence, confiscated, fine, held }
export function showArrestNotice(msg) {
  close();
  const stars = Math.max(0, Math.min(5, msg.stars || 0));
  const starBar = `<span class="arrest-stars">${'★'.repeat(stars)}<span class="arrest-stars-empty">${'★'.repeat(5 - stars)}</span></span>`;
  const held = msg.held || 0;
  const fine = msg.fine || 0;
  const refund = held - fine;
  const refundCls = refund < 0 ? 'arrest-debt' : '';

  const el = document.createElement('div');
  el.className = 'confirm-window arrest-window';
  el.innerHTML = `
    <div class="confirm-drag-handle">
      <span class="confirm-title">Precinct 9 · Booking Record</span>
      <button class="confirm-x" title="Dismiss">✕</button>
    </div>
    <div class="confirm-body">
      <div class="arrest-banner">⛓ YOU HAVE BEEN PROCESSED INTO HOLDING ${starBar}</div>
      <div class="arrest-row"><span class="arrest-label">Charge</span><span class="arrest-val">${esc(msg.charge || 'multiple outstanding warrants')}</span></div>
      <div class="arrest-row"><span class="arrest-label">Sentence</span><span class="arrest-val">${esc(msg.sentence || '—')}</span></div>
      <div class="arrest-row"><span class="arrest-label">Property</span><span class="arrest-val">${msg.confiscated || 0} item(s) seized — contraband logged to evidence, the rest returned on release</span></div>
      <div class="arrest-row"><span class="arrest-label">Cash seized</span><span class="arrest-val">₵${held.toLocaleString()} — held at the desk</span></div>
      <div class="arrest-row"><span class="arrest-label">Fine (on release)</span><span class="arrest-val arrest-fine">−₵${fine.toLocaleString()}</span></div>
      <div class="arrest-row"><span class="arrest-label">Returned on release</span><span class="arrest-val ${refundCls}">₵${refund.toLocaleString()}</span></div>
      <div class="confirm-actions">
        <button class="confirm-ok">Acknowledge</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  _el = el;

  makeDraggable(el, el.querySelector('.confirm-drag-handle'));
  el.querySelector('.confirm-x').addEventListener('click', close);
  el.querySelector('.confirm-ok').addEventListener('click', close);
  el.querySelector('.confirm-ok').focus();
}
