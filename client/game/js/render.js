import { state } from './state.js';

export function appendMsg(text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.textContent = text;
  document.getElementById('output').appendChild(el);
  scrollOutput();
}

export function appendHtml(html, cls = '') {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.innerHTML = html;
  document.getElementById('output').appendChild(el);
  scrollOutput();
}

export function scrollOutput() {
  const out = document.getElementById('output');
  out.scrollTop = out.scrollHeight;
}

export function updateVitals(p) {
  setBar('hp', p.hp, p.hp_max || 100);
  setBar('san', p.sanity, p.sanity_max || 100);
  setBar('hun', p.hunger, 100);
  setBar('thi', p.thirst, 100);
  setBar('sta', p.stamina, p.stamina_max || 100);
  setBar('rad', p.radiation, 100, true);
  if (p.credits !== undefined) {
    const el = document.getElementById('header-credits-val');
    if (el) el.textContent = p.credits;
  }
}

function setBar(id, val, max, inverse = false) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  const low = inverse ? pct > 60 : pct < 25;
  for (const suffix of ['', '-m']) {
    const bar = document.getElementById(`${id}-bar${suffix}`);
    const valEl = document.getElementById(`${id}-val${suffix}`);
    if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('low', low); }
    if (valEl) valEl.textContent = Math.round(val);
  }
}

export function parseZoneInfo(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const zoneName = tmp.querySelector('.zone-name')?.textContent;
  if (zoneName) document.getElementById('zone-name-display').textContent = zoneName;

  const text = tmp.textContent;
  const exitsMatch = text.match(/Exits:\s*([^\n]+)/);
  const exitsEl = document.getElementById('exits-display');
  exitsEl.innerHTML = '';
  if (exitsMatch) {
    const dirs = exitsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const dir of dirs) {
      const btn = document.createElement('button');
      btn.className = 'exit-btn';
      btn.textContent = dir;
      btn.onclick = () => import('./net.js').then(m => m.sendCmd(dir));
      exitsEl.appendChild(btn);
    }
  }
}

export function showDevPanelButton() {
  const btn = document.getElementById('dev-panel-btn');
  if (btn) btn.style.display = '';
  const dbg = document.getElementById('debug-whisper-btn');
  if (dbg) dbg.style.display = '';
}
