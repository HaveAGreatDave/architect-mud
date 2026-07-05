// Splice lab report — the A+…F grade card the server fires (type:'splice_report')
// after a splice resolves. Big letter grade, the compound's potency, and a note.
// F is a bad batch (red); catastrophe never gets here (it's its own text beat).
// Reuses the themed .confirm-window chrome (see arrest.js / confirm.js).

let _el = null;

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function close() { _el?.remove(); _el = null; }

const GRADE_CLASS = { 'A+': 'sr-a', 'A': 'sr-a', 'B': 'sr-b', 'C': 'sr-c', 'D': 'sr-d', 'F': 'sr-f' };

// msg: { grade, outcome:'success'|'badbatch', name, potency, doses, note }
export function showSpliceReport(msg) {
  close();
  const grade = msg.grade || '?';
  const cls = GRADE_CLASS[grade] || 'sr-c';
  const bad = msg.outcome === 'badbatch';
  const el = document.createElement('div');
  el.className = 'confirm-window splice-report';
  el.innerHTML = `
    <div class="confirm-drag-handle">
      <span class="confirm-title">Splice · Lab Report</span>
      <button class="confirm-x" title="Dismiss">✕</button>
    </div>
    <div class="confirm-body">
      <div class="sr-grade ${cls}">${esc(grade)}</div>
      <div class="sr-name">${bad ? 'unstable ' : ''}${esc(msg.name || 'compound')}</div>
      <div class="sr-row"><span>Potency</span><b>${Math.max(0, msg.potency || 0)}%</b></div>
      ${msg.batch > 1 ? `<div class="sr-row"><span>Doses made</span><b>${msg.batch}</b></div>` : ''}
      ${msg.doses > 1 ? `<div class="sr-row"><span>Dose weight</span><b>${msg.doses}×</b></div>` : ''}
      ${msg.note ? `<div class="sr-note">${esc(msg.note)}</div>` : ''}
      <div class="confirm-actions">
        <button class="confirm-ok">${bad ? 'Bag it anyway' : 'Bag it'}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  _el = el;
  el.querySelector('.confirm-x').addEventListener('click', close);
  el.querySelector('.confirm-ok').addEventListener('click', close);
  el.querySelector('.confirm-ok').focus();
}
