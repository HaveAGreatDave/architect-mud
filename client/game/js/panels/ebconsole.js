// EMERGENCY BROADCAST CONSOLE — the control surface for the Echelon's special
// MediaDeck (see the broadcast plugin's `ebs` command). One switch that seizes every
// tuned set in Architect, a SOURCE (the loaded bulletin, or a live camera on the
// studio floor), and a TICKER that scrolls along the bottom of every screen in the
// city while the system is up.
//
// Self-mounted overlay (no fixed markup in index.html): the server pushes
// `emergency_console` with the full state, this renders it, and every control sends
// an `ebs …` command whose reply is a fresh `emergency_console` that re-renders here.
// Nothing is decided locally — the panel is a skin over verbs a player could type,
// which is what lets the Display Mode `log` rung use the same system with no panel
// at all.

import { sendCmdSilent } from '../net.js';

let _overlay = null;
let _data = null;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const send = (cmd) => sendCmdSilent(cmd);

function ensureStyles() {
  if (document.getElementById('ebconsole-styles')) return;
  const s = document.createElement('style');
  s.id = 'ebconsole-styles';
  s.textContent = `
    #ebconsole-overlay { position:fixed; inset:0; z-index:9100; display:flex; align-items:center; justify-content:center;
      background:rgba(10,2,2,0.74); backdrop-filter:blur(2px); font-family:'Courier New',monospace; }
    #ebconsole-overlay .eb-box { width:min(560px,95vw); max-height:90vh; overflow-y:auto; color:#ffc9a8;
      background:linear-gradient(180deg,#2a1410 0%,#190b08 8%,#0b0504 100%); border:1px solid #55251a; border-radius:8px; padding:14px 16px 16px;
      box-shadow:0 18px 50px rgba(0,0,0,0.75), 0 0 40px rgba(255,90,40,0.13); }
    #ebconsole-overlay .eb-head { display:flex; align-items:center; justify-content:space-between; font-size:13px; letter-spacing:2px; color:#ff6a33; font-weight:bold; }
    #ebconsole-overlay .eb-sub { font-size:10px; letter-spacing:3px; color:#8a5f4c; margin:2px 0 10px; }
    #ebconsole-overlay .eb-close { background:none; border:none; color:#8a6b58; font-size:15px; cursor:pointer; }
    #ebconsole-overlay .eb-close:hover { color:#ff4a2b; }
    /* The switch. It is the biggest thing on the panel because it is the only
       control that changes what the whole city is looking at. */
    #ebconsole-overlay .eb-switch { display:flex; align-items:center; gap:12px; padding:11px 12px; margin-bottom:10px;
      border:1px solid #55251a; border-radius:4px; background:#170a07; }
    #ebconsole-overlay .eb-switch.live { border-color:#ff3b1f; background:#24090a; animation:eb-onair 2.1s ease-in-out infinite; }
    @keyframes eb-onair { 0%,100% { box-shadow:inset 0 0 0 rgba(255,59,31,0); } 50% { box-shadow:inset 0 0 26px rgba(255,59,31,0.22); } }
    #ebconsole-overlay .eb-lamp { width:13px; height:13px; border-radius:50%; background:#3a1712; border:1px solid #55251a; flex:none; }
    #ebconsole-overlay .eb-switch.live .eb-lamp { background:#ff3b1f; border-color:#ff8a6a; box-shadow:0 0 12px #ff3b1f; }
    #ebconsole-overlay .eb-state { flex:1; font-size:13px; color:#ffd8c4; }
    #ebconsole-overlay .eb-state .eb-tag { display:block; font-size:10px; letter-spacing:1px; color:#8a5f4c; }
    #ebconsole-overlay .eb-t { background:#1e0d09; color:#ffc9a8; border:1px solid #55251a; border-radius:2px; cursor:pointer;
      font-family:inherit; font-size:13px; font-weight:bold; padding:6px 9px; letter-spacing:1px; }
    #ebconsole-overlay .eb-t:hover { color:#ff6a33; border-color:#ff6a33; }
    #ebconsole-overlay .eb-t.on { color:#0a0403; background:#ff3b1f; border-color:#ff3b1f; }
    #ebconsole-overlay .eb-t.off { color:#0a0403; background:#46e05a; border-color:#46e05a; }
    #ebconsole-overlay .eb-mode { display:flex; gap:8px; margin:10px 0 2px; }
    #ebconsole-overlay .eb-mode .eb-t { flex:1; }
    #ebconsole-overlay .eb-sec { font-size:10px; letter-spacing:2px; color:#a8735a; margin:12px 0 5px; text-transform:uppercase; }
    #ebconsole-overlay .eb-row { display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid #3a1a12; border-radius:3px;
      margin-bottom:4px; background:#130807; font-size:12px; cursor:pointer; }
    #ebconsole-overlay .eb-row:hover { border-color:#ff6a33; }
    #ebconsole-overlay .eb-row.cur { border-color:#46e05a; background:#0e1a10; }
    #ebconsole-overlay .eb-num { color:#8a5f4c; font-size:10px; width:20px; }
    #ebconsole-overlay .eb-name { flex:1; color:#ffd8c4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #ebconsole-overlay .eb-air { color:#46e05a; font-size:10px; letter-spacing:1px; }
    #ebconsole-overlay .eb-empty { color:#5d382c; font-size:11px; padding:6px 2px; letter-spacing:1px; }
    #ebconsole-overlay .eb-ticker { display:flex; gap:6px; margin-top:4px; }
    #ebconsole-overlay .eb-ticker input { flex:1; background:#130807; border:1px solid #55251a; border-radius:3px; color:#ffd8c4;
      font-family:inherit; font-size:12px; padding:6px 8px; }
    #ebconsole-overlay .eb-ticker input:focus { outline:none; border-color:#ff6a33; }
    /* The strip as it will look on a set: the console shows the crawl it is about to
       put across the city rather than only the text field it was typed into. */
    #ebconsole-overlay .eb-strip { margin-top:6px; overflow:hidden; border:1px solid #3a1a12; border-radius:3px; background:#0b0504; padding:3px 0; }
    #ebconsole-overlay .eb-strip span { display:inline-block; white-space:nowrap; color:#ffc940; font-size:11px; letter-spacing:1px;
      padding-left:100%; animation:eb-crawl 14s linear infinite; }
    @keyframes eb-crawl { from { transform:translateX(0); } to { transform:translateX(-100%); } }
    #ebconsole-overlay .eb-note { font-size:10px; color:#8a5f4c; margin-top:8px; line-height:1.5; }
  `;
  document.head.appendChild(s);
}

export function openEmergencyConsole(data) {
  ensureStyles();
  _data = data;
  if (!_overlay) {
    _overlay = document.createElement('div');
    _overlay.id = 'ebconsole-overlay';
    _overlay.addEventListener('mousedown', (e) => { if (e.target === _overlay) closeEmergencyConsole(); });
    document.body.appendChild(_overlay);
    window.addEventListener('keydown', _onKey);
  }
  render();
}

export function closeEmergencyConsole() {
  if (!_overlay) return;
  window.removeEventListener('keydown', _onKey);
  _overlay.remove();
  _overlay = null;
  _data = null;
}

function _onKey(e) { if (e.key === 'Escape') closeEmergencyConsole(); }

function render() {
  const d = _data;
  if (!_overlay || !d) return;
  const on = !!d.on;
  const mode = d.mode === 'live' ? 'live' : 'cassette';
  const cameras = d.cameras || [];
  const cassettes = d.cassettes || [];

  const camRows = cameras.length ? cameras.map((c, i) => `
    <div class="eb-row${c.key === d.camera ? ' cur' : ''}" data-cam="${i + 1}">
      <span class="eb-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="eb-name">${esc(c.label)}</span>
      <span class="eb-num">${c.droid ? 'DROID' : esc(String(c.direction || 'all')).toUpperCase()}</span>
      ${c.key === d.camera ? '<span class="eb-air">◉ CUT TO</span>' : ''}
    </div>`).join('') : '<div class="eb-empty">— NO CAMERA IN THIS ROOM —</div>';

  const tapeRows = cassettes.length ? cassettes.map((c, i) => `
    <div class="eb-row${c.id === d.activeCassetteId ? ' cur' : ''}" data-tape="${i + 1}">
      <span class="eb-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="eb-name">${esc(c.name)}</span>
      ${c.id === d.activeCassetteId ? '<span class="eb-air">▶ LOADED</span>' : ''}
    </div>`).join('') : '<div class="eb-empty">— NO BULLETIN LOADED —</div>';

  // What the switch would put on air right now, which is not always what is on air:
  // a source changed mid-broadcast re-cuts, but the readout says which is which.
  const nowLine = on
    ? `${d.airingMode === 'live' ? 'LIVE' : 'CASSETTE'} · ${esc(d.airingSource || '—')}`
    : 'nothing — every set is on its own channel';

  _overlay.innerHTML = `
    <div class="eb-box">
      <div class="eb-head"><span>▓ EMERGENCY BROADCAST SYSTEM</span><button class="eb-close" aria-label="Close">✕</button></div>
      <div class="eb-sub">${esc(d.deckName || 'CONSOLE')}</div>
      <div class="eb-switch${on ? ' live' : ''}">
        <span class="eb-lamp"></span>
        <div class="eb-state"><span class="eb-tag">${on ? 'SEIZING EVERY SET IN ARCHITECT' : 'SYSTEM OFF'}</span>${nowLine}</div>
        <button class="eb-t ${on ? 'on' : 'off'}" data-act="${on ? 'off' : 'on'}">${on ? '■ DISABLE' : '▲ ENABLE'}</button>
      </div>
      <div class="eb-mode">
        <button class="eb-t ${mode === 'cassette' ? 'on' : ''}" data-src="cassette">▤ CASSETTE</button>
        <button class="eb-t ${mode === 'live' ? 'on' : ''}" data-src="live">◉ LIVE STUDIO</button>
      </div>
      ${mode === 'live'
        ? `<div class="eb-sec">Studio cameras — cut to air</div><div>${camRows}</div>`
        : `<div class="eb-sec">Bulletin</div><div>${tapeRows}</div>`}
      <div class="eb-sec">Ticker — scrolls along the bottom of every screen</div>
      <div class="eb-ticker">
        <input id="eb-ticker-input" maxlength="${d.tickerMax || 200}" placeholder="Type what the city reads along the bottom…" value="${esc(d.ticker || '')}">
        <button class="eb-t" data-act="ticker-set">SET</button>
        <button class="eb-t" data-act="ticker-clear">CLEAR</button>
      </div>
      ${d.ticker ? `<div class="eb-strip"><span>${esc(d.ticker)}</span></div>` : ''}
      <div class="eb-note">${mode === 'live'
        ? 'LIVE puts this room on every screen in the city. What is said in here goes out with it.'
        : 'CASSETTE plays the loaded bulletin on a loop until the system is switched off.'}</div>
    </div>`;

  _overlay.querySelector('.eb-close').addEventListener('click', closeEmergencyConsole);
  _overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const act = b.getAttribute('data-act');
    if (act === 'ticker-set') { const v = _overlay.querySelector('#eb-ticker-input').value.trim(); send(`ebs ticker ${v || 'off'}`); }
    else if (act === 'ticker-clear') send('ebs ticker off');
    else send(`ebs ${act}`);
  }));
  _overlay.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => send(`ebs source ${b.getAttribute('data-src')}`)));
  _overlay.querySelectorAll('[data-cam]').forEach(r => r.addEventListener('click', () => send(`ebs cam ${r.getAttribute('data-cam')}`)));
  _overlay.querySelectorAll('[data-tape]').forEach(r => r.addEventListener('click', () => send(`ebs tape ${r.getAttribute('data-tape')}`)));
  // Enter in the ticker field is the same act as pressing SET — a crawl is a line you
  // type, and reaching for the mouse to send it is the wrong shape for that.
  _overlay.querySelector('#eb-ticker-input')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    send(`ebs ticker ${v || 'off'}`);
  });
}
