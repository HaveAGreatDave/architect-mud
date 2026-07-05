// Apprehend prompt — the split-second "submit or run" a cop gives you when they
// catch up at ≤3.5★ (server fires type:'apprehend_prompt'). A draining bar counts
// down a reflex-scaled window; SUBMIT (or letting it run out) comes quietly, RUN
// wrenches free (+2★ and the chase is back on). Resolves via `apprehendresolve`.

import { sendCmdSilent } from '../net.js';

let _el = null, _timer = null, _resolved = false;

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function onKey(e) {
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resolve('run'); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resolve('submit'); }
}

function cleanup() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  document.removeEventListener('keydown', onKey);
  _el?.remove(); _el = null;
}

// One choice only — a button and the auto-timeout must never both fire.
function resolve(choice) {
  if (_resolved) return;
  _resolved = true;
  sendCmdSilent(`apprehendresolve ${choice === 'run' ? 'run' : 'submit'}`);
  cleanup();
}

// msg: { officer, seconds, stars }
export function openApprehendPrompt(msg) {
  cleanup();
  _resolved = false;
  const seconds = Math.max(1, Number(msg.seconds) || 3);
  const officer = msg.officer || 'An officer';

  const el = document.createElement('div');
  el.className = 'apprehend-window';
  el.innerHTML = `
    <div class="apprehend-badge">⛓ DETAINED</div>
    <div class="apprehend-officer">${esc(officer)} has a hand on you. Comply — or bolt.</div>
    <div class="apprehend-bar"><div class="apprehend-fill"></div></div>
    <div class="apprehend-actions">
      <button class="apprehend-submit">SUBMIT</button>
      <button class="apprehend-run">RUN</button>
    </div>
    <div class="apprehend-hint">Do nothing and you comply. <span class="apprehend-keys">[Enter] submit · [R] run</span></div>`;
  document.body.appendChild(el);
  _el = el;

  const fill = el.querySelector('.apprehend-fill');
  el.querySelector('.apprehend-submit').addEventListener('click', () => resolve('submit'));
  el.querySelector('.apprehend-run').addEventListener('click', () => resolve('run'));
  document.addEventListener('keydown', onKey);

  const total = seconds * 1000;
  const deadline = Date.now() + total;
  _timer = setInterval(() => {
    const left = deadline - Date.now();
    fill.style.width = `${Math.max(0, Math.min(100, (left / total) * 100)).toFixed(1)}%`;
    if (left <= 0) resolve('submit');
  }, 50);
}
