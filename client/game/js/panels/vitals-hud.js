// The vitals HUD: HP, stamina, hunger, thirst and credits as thin segmented bars in a
// corner of the ROOM view (the Room Stage). It doesn't show outside ROOM. Three modes, kept per browser:
//   always  the HUD is always up
//   auto    it shows itself only when something needs you: HP below full or just hit,
//           stamina falling fast or low, hunger or thirst low (a brief flash that comes
//           round more often the worse it gets)
//   off     no HUD; the sidebar bars are unchanged either way
// The button beside the sidebar's Vitals label cycles the mode. Holding V in ROOM
// shows every row in any mode.
//
// It reads the same player push as the sidebar (updateVitals in render.js) and decides nothing.
import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./vitals-hud.css', import.meta.url));
const MODES = ['auto', 'always', 'off'];
const KEY = 'vitalsHudMode';
const SEGS = 10;

const STATS = [
  { key: 'hp',  label: 'HP',  title: 'Health' },
  { key: 'sta', label: 'STA', title: 'Stamina' },
  { key: 'hun', label: 'FOOD', title: 'Hunger' },
  { key: 'thi', label: 'H2O', title: 'Thirst' },
];

let mode = 'auto';
try { mode = MODES.includes(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : 'auto'; } catch {}

let root = null, btn = null;
const last = {};                 // key -> { pct, t }
const showUntil = {};            // key -> ms timestamp it stays up until
const nextFlash = {};            // hunger/thirst: when the next reminder is due
let hideTimer = 0;
let peek = false;                // V held in ROOM: show every row, whatever the mode

// Hold V in ROOM to see the whole HUD. Ignored while typing or with a modifier.
function peekKey(e, down) {
  if (e.key !== 'v' && e.key !== 'V') return;
  if (down && (e.ctrlKey || e.metaKey || e.altKey)) return;
  if (!document.body.classList.contains('room-stage-on')) return;
  if (down && e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (peek === down) return;
  peek = down;
  apply(performance.now());
}
window.addEventListener('keydown', (e) => peekKey(e, true));
window.addEventListener('keyup', (e) => peekKey(e, false));
window.addEventListener('blur', () => { if (peek) { peek = false; apply(performance.now()); } });

// ROOM only: the HUD lives inside #room-stage and goes with it. CSS hides it whenever
// body lacks room-stage-on; a body-class observer moves it into each new stage.
function place() {
  const stage = document.getElementById('room-stage');
  if (root && stage && root.parentElement !== stage) stage.appendChild(root);
}
function mount() {
  if (root) { place(); return true; }
  if (!document.body) return false;
  new MutationObserver(place).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const host = document.getElementById('room-stage') || document.body;
  if (!document.getElementById('vitals-hud-css')) {
    const s = document.createElement('style');
    s.id = 'vitals-hud-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  root = document.createElement('div');
  root.id = 'vitals-hud';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Vitals');
  root.innerHTML = STATS.map((s) => `
    <div class="vh-row" data-k="${s.key}" title="${s.title}">
      <span class="vh-lbl">${s.label}</span>
      <span class="vh-segs">${'<i></i>'.repeat(SEGS)}</span>
      <span class="vh-num">--</span>
    </div>`).join('') + `
    <div class="vh-row vh-cred" data-k="cr" title="Credits">
      <span class="vh-lbl">₵</span><span class="vh-num vh-cr-val">--</span><span class="vh-cr-delta"></span>
    </div>
    <div class="vh-wet" data-w="dry" title="Dry">
      <svg viewBox="0 0 10 13" aria-hidden="true"><defs><clipPath id="vh-drop-clip"><path d="M5 .8C3.3 3.6 1 6 1 8.6a4 4 0 0 0 8 0C9 6 6.7 3.6 5 .8Z"/></clipPath></defs>
        <rect class="vh-fill" x="0" y="0" width="10" height="13" clip-path="url(#vh-drop-clip)"/>
        <path class="vh-drop" d="M5 .8C3.3 3.6 1 6 1 8.6a4 4 0 0 0 8 0C9 6 6.7 3.6 5 .8Z"/></svg>
    </div>`;
  host.appendChild(root);
  mountButton();
  return true;
}

function mountButton() {
  const host = document.getElementById('vitals-edit-host');
  if (!host || btn) return;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vh-mode-btn';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    try { localStorage.setItem(KEY, mode); } catch {}
    paintButton();
    apply(performance.now());
  });
  host.prepend(btn);
  paintButton();
}

function paintButton() {
  if (!btn) return;
  btn.textContent = { auto: 'HUD·A', always: 'HUD', off: 'HUD·' }[mode];
  btn.classList.toggle('off', mode === 'off');
  btn.title = {
    auto: 'Vitals HUD: shows only when needed. Click for always on.',
    always: 'Vitals HUD: always on. Click to turn off.',
    off: 'Vitals HUD: off. Click for show-when-needed.',
  }[mode];
}

// How badly a stat wants your attention, 0 (fine) to 3 (critical).
function severity(pct) {
  if (pct < 15) return 3;
  if (pct < 30) return 2;
  if (pct < 50) return 1;
  return 0;
}

function judge(key, pct, now) {
  const prev = last[key];
  last[key] = { pct, t: now };
  if (key === 'hp') {
    if (prev && pct < prev.pct - 0.5) showUntil.hp = now + 8000;   // just hit
    if (pct < 100) showUntil.hp = Math.max(showUntil.hp || 0, now + 4000);
    return;
  }
  if (key === 'sta') {
    const dt = prev ? (now - prev.t) / 1000 : 0;
    const rate = prev && dt > 0 ? (prev.pct - pct) / dt : 0;        // % per second lost
    if (rate > 1.5 || pct < 35) showUntil.sta = now + 5000;
    return;
  }
  // Hunger and thirst: an occasional reminder, more often as it gets worse.
  const sev = severity(pct);
  if (!sev) { nextFlash[key] = 0; return; }
  const worse = prev && severity(prev.pct) < sev;
  if (worse || !nextFlash[key] || now >= nextFlash[key]) {
    showUntil[key] = now + (sev === 3 ? 8000 : 5000);
    nextFlash[key] = now + [0, 180000, 90000, 30000][sev];
  }
}

function apply(now) {
  if (!root) return;
  root.hidden = mode === 'off' && !peek;
  let any = false, soonest = Infinity;
  for (const { key } of [...STATS, { key: 'cr' }]) {
    const row = root.querySelector(`.vh-row[data-k="${key}"]`);
    const up = mode === 'always' || peek || (showUntil[key] || 0) > now;
    row.classList.toggle('vh-hide', !up);
    if (up) any = true;
    if (mode === 'auto' && (showUntil[key] || 0) > now) soonest = Math.min(soonest, showUntil[key]);
  }
  root.classList.toggle('vh-empty', !any);
  clearTimeout(hideTimer);
  if (soonest < Infinity) hideTimer = setTimeout(() => apply(performance.now()), soonest - now + 50);
}

export function updateVitalsHud(p) {
  if (!mount()) return;
  const now = performance.now();
  const vals = {
    hp: [p.hp, p.hp_max || 100],
    sta: [p.stamina, p.stamina_max || 100],
    hun: [p.hunger, 100],
    thi: [p.thirst, 100],
  };
  for (const { key } of STATS) {
    const [v, max] = vals[key];
    if (v == null) continue;
    const pct = Math.max(0, Math.min(100, (v / max) * 100));
    const row = root.querySelector(`.vh-row[data-k="${key}"]`);
    const lit = Math.ceil((pct / 100) * SEGS);
    row.querySelectorAll('.vh-segs i').forEach((seg, i) => seg.classList.toggle('on', i < lit));
    row.querySelector('.vh-num').textContent = Math.round(v);
    row.dataset.sev = String(severity(pct));
    if (last[key] && pct < last[key].pct - 0.5) {
      row.classList.remove('vh-hit'); void row.offsetWidth; row.classList.add('vh-hit');
    }
    judge(key, pct, now);
  }
  // Credits: a plain readout. In auto it shows for a few seconds when the balance moves.
  if (p.credits !== undefined) {
    const c = Math.round(Number(p.credits) || 0);
    const row = root.querySelector('.vh-row[data-k="cr"]');
    row.querySelector('.vh-cr-val').textContent = c.toLocaleString();
    const d = row.querySelector('.vh-cr-delta');
    if (last.cr != null && c !== last.cr) {
      const diff = c - last.cr;
      d.textContent = (diff > 0 ? '+' : '') + diff.toLocaleString();
      d.className = 'vh-cr-delta ' + (diff > 0 ? 'up' : 'down');
      showUntil.cr = now + 5000;
    } else if (!((showUntil.cr || 0) > now)) d.textContent = '';
    last.cr = c;
  }
  // Wetness, the 0-100 the environment pane bands: under 10 dry, under 50 wet, then soaked.
  if (p.wetness != null) {
    const w = Number(p.wetness) || 0;
    const band = w >= 50 ? 'soaked' : w >= 10 ? 'wet' : 'dry';
    const el = root.querySelector('.vh-wet');
    if (el.dataset.w !== band) { el.dataset.w = band; el.title = band[0].toUpperCase() + band.slice(1); }
  }
  apply(now);
}
