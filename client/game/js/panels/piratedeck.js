// PIRATE CONSOLE — the control surface for a media deck you've seized (see the
// broadcast plugin's Signal Hijack / `air` command). Runs the station's schedule
// from anywhere: a recorded QUEUE you build from your carried cassettes/microreels
// and the station's own library, transport controls (play/stop/skip/loop), and a
// breaking-news CRAWL to taunt the city while you hold the air.
//
// Self-mounted overlay (no fixed markup in index.html): the server pushes
// `pirate_console` with the full state, this renders it, and every control sends
// an `air …` command whose reply is a fresh `pirate_console` that re-renders here.

import { sendCmdSilent } from '../net.js';

let _overlay = null;
let _data = null;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const send = (cmd) => sendCmdSilent(cmd);

function ensureStyles() {
  if (document.getElementById('piratedeck-styles')) return;
  const s = document.createElement('style');
  s.id = 'piratedeck-styles';
  s.textContent = `
    #piratedeck-overlay { position:fixed; inset:0; z-index:9100; display:flex; align-items:center; justify-content:center;
      background:rgba(8,2,6,0.72); backdrop-filter:blur(2px); font-family:'Courier New',monospace; }
    #piratedeck-overlay .pd-box { width:min(560px,95vw); max-height:90vh; overflow-y:auto; color:#ff8fb0;
      background:linear-gradient(180deg,#2a1420 0%,#1a0c14 8%,#0c060a 100%); border:1px solid #4a2030; border-radius:8px; padding:14px 16px 16px;
      box-shadow:0 18px 50px rgba(0,0,0,0.7), 0 0 40px rgba(255,95,138,0.14); }
    #piratedeck-overlay .pd-head { display:flex; align-items:center; justify-content:space-between; font-size:13px; letter-spacing:2px; color:#ff5f8a; font-weight:bold; }
    #piratedeck-overlay .pd-sub { font-size:10px; letter-spacing:3px; color:#7a5866; margin:2px 0 10px; }
    #piratedeck-overlay .pd-close { background:none; border:none; color:#8a6b78; font-size:15px; cursor:pointer; }
    #piratedeck-overlay .pd-close:hover { color:#ff4a5b; }
    #piratedeck-overlay .pd-now { display:flex; align-items:center; gap:10px; padding:9px 10px; margin-bottom:10px; border:1px solid #4a2030; border-radius:4px; background:#150a11; }
    #piratedeck-overlay .pd-now-air { flex:1; font-size:13px; color:#ffd0de; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #piratedeck-overlay .pd-now-air .pd-tag { color:#7a5866; font-size:10px; letter-spacing:1px; display:block; }
    #piratedeck-overlay .pd-t { background:#1c0e16; color:#ff8fb0; border:1px solid #4a2030; border-radius:2px; cursor:pointer; font-family:inherit; font-size:13px; font-weight:bold; padding:6px 9px; letter-spacing:1px; }
    #piratedeck-overlay .pd-t:hover { color:#ff5f8a; border-color:#ff5f8a; }
    #piratedeck-overlay .pd-t.on { color:#0a0406; background:#46e05a; border-color:#46e05a; }
    #piratedeck-overlay .pd-sec { font-size:10px; letter-spacing:2px; color:#a06678; margin:12px 0 5px; text-transform:uppercase; }
    #piratedeck-overlay .pd-row { display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid #331722; border-radius:3px; margin-bottom:4px; background:#120810; font-size:12px; }
    #piratedeck-overlay .pd-row.cur { border-color:#46e05a; background:#0e1a12; }
    #piratedeck-overlay .pd-num { color:#7a5866; font-size:10px; width:20px; }
    #piratedeck-overlay .pd-name { flex:1; color:#ffd0de; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #piratedeck-overlay .pd-mini { color:#c98aa0; font-size:9px; border:1px solid #4a2030; border-radius:2px; padding:0 3px; }
    #piratedeck-overlay .pd-air { color:#46e05a; font-size:10px; letter-spacing:1px; }
    #piratedeck-overlay .pd-ico { background:none; border:none; color:#8a6b78; cursor:pointer; font-size:12px; padding:0 3px; font-family:inherit; }
    #piratedeck-overlay .pd-ico:hover { color:#ff8fb0; }
    #piratedeck-overlay .pd-ico.x:hover { color:#ff4a5b; }
    #piratedeck-overlay .pd-pool .pd-row { cursor:pointer; }
    #piratedeck-overlay .pd-pool .pd-row:hover { border-color:#ff5f8a; }
    #piratedeck-overlay .pd-empty { color:#5a3a48; font-size:11px; padding:6px 2px; letter-spacing:1px; }
    #piratedeck-overlay .pd-crawl { display:flex; gap:6px; margin-top:4px; }
    #piratedeck-overlay .pd-crawl input { flex:1; background:#120810; border:1px solid #4a2030; border-radius:3px; color:#ffd0de; font-family:inherit; font-size:12px; padding:6px 8px; }
    #piratedeck-overlay .pd-crawl input:focus { outline:none; border-color:#ff5f8a; }
  `;
  document.head.appendChild(s);
}

export function openPirateConsole(data) {
  ensureStyles();
  _data = data;
  if (!_overlay) {
    _overlay = document.createElement('div');
    _overlay.id = 'piratedeck-overlay';
    _overlay.addEventListener('mousedown', (e) => { if (e.target === _overlay) closePirateConsole(); });
    document.body.appendChild(_overlay);
    window.addEventListener('keydown', _onKey);
  }
  render();
}

export function closePirateConsole() {
  if (!_overlay) return;
  window.removeEventListener('keydown', _onKey);
  _overlay.remove();
  _overlay = null;
  _data = null;
}

function _onKey(e) { if (e.key === 'Escape') closePirateConsole(); }

function render() {
  const d = _data;
  if (!_overlay || !d) return;
  const playing = d.playing;
  const loop = d.loop || 'queue';
  const loopNext = { off: 'item', item: 'queue', queue: 'off' }[loop];
  const queue = d.queue || [];
  const pool = d.pool || [];

  const queueRows = queue.length ? queue.map((it, i) => `
    <div class="pd-row${i === d.cursor ? ' cur' : ''}">
      <span class="pd-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="pd-name">${esc(it.name)}</span>
      ${it.mini ? '<span class="pd-mini">µREEL</span>' : ''}
      ${i === d.cursor ? '<span class="pd-air">▶ ON AIR</span>' : ''}
      <button class="pd-ico" data-move-up="${i}" title="Move up">▲</button>
      <button class="pd-ico" data-move-dn="${i}" title="Move down">▼</button>
      <button class="pd-ico x" data-remove="${i + 1}" title="Remove">✕</button>
    </div>`).join('') : '<div class="pd-empty">— QUEUE EMPTY — add from your pool below —</div>';

  const poolRows = pool.length ? pool.map(p => `
    <div class="pd-row" data-add="${esc(p.id)}">
      <span class="pd-name">${esc(p.name)}</span>
      ${p.mini ? '<span class="pd-mini">µREEL</span>' : ''}
      <span class="pd-num">${p.src === 'carried' ? 'TAPE' : 'LIB'}</span>
      <button class="pd-ico" title="Add to queue">＋</button>
    </div>`).join('') : '<div class="pd-empty">— NOTHING TO ADD — carry cassettes or seize a library —</div>';

  _overlay.innerHTML = `
    <div class="pd-box">
      <div class="pd-head"><span>◈ PIRATE CONSOLE</span><button class="pd-close" aria-label="Close">✕</button></div>
      <div class="pd-sub">${esc(d.stationName || 'STATION')} · ${playing ? '● ON AIR' : '⏸ STOPPED'}</div>
      <div class="pd-now">
        <div class="pd-now-air"><span class="pd-tag">NOW AIRING</span>${esc(d.nowAiring || '— dead air —')}</div>
        <button class="pd-t ${playing ? 'on' : ''}" data-act="${playing ? 'stop' : 'play'}" title="${playing ? 'Stop' : 'Play'}">${playing ? '⏸' : '▶'}</button>
        <button class="pd-t" data-act="skip" title="Skip to next">⏭</button>
        <button class="pd-t" data-loop="${loopNext}" title="Loop: ${loop} → ${loopNext}">↻ ${loop.toUpperCase()}</button>
      </div>
      <div class="pd-sec">Queue</div>
      <div class="pd-queue">${queueRows}</div>
      <div class="pd-sec">Add from your pool</div>
      <div class="pd-pool">${poolRows}</div>
      <div class="pd-sec">Breaking-news crawl</div>
      <div class="pd-crawl">
        <input id="pd-crawl-input" maxlength="200" placeholder="Scroll a message across the city…" value="${esc(d.crawl || '')}">
        <button class="pd-t" data-act="crawl-set">SET</button>
        <button class="pd-t" data-act="crawl-clear">CLEAR</button>
      </div>
    </div>`;

  _overlay.querySelector('.pd-close').addEventListener('click', closePirateConsole);
  _overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const act = b.getAttribute('data-act');
    if (act === 'crawl-set') { const v = _overlay.querySelector('#pd-crawl-input').value.trim(); send(`air crawl ${v || 'off'}`); }
    else if (act === 'crawl-clear') send('air crawl off');
    else send(`air ${act}`);
  }));
  _overlay.querySelectorAll('[data-loop]').forEach(b => b.addEventListener('click', () => send(`air loop ${b.getAttribute('data-loop')}`)));
  _overlay.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => send(`air remove ${b.getAttribute('data-remove')}`)));
  _overlay.querySelectorAll('[data-move-up]').forEach(b => b.addEventListener('click', () => { const i = +b.getAttribute('data-move-up'); if (i > 0) send(`air move ${i + 1} ${i}`); }));
  _overlay.querySelectorAll('[data-move-dn]').forEach(b => b.addEventListener('click', () => { const i = +b.getAttribute('data-move-dn'); if (i < queue.length - 1) send(`air move ${i + 1} ${i + 2}`); }));
  _overlay.querySelectorAll('[data-add]').forEach(r => r.addEventListener('click', () => send(`air add ${r.getAttribute('data-add')}`)));
}
