// ALARM PANEL — the graphical board for disarming a shop's intruder alarm.
//
// A skin over alarmgame.js; there is no game logic in this file at all, which is
// what keeps this and textalarm.js honestly the same game.
//
// The fascia is off and you are looking at a terminal block. Each terminal shows
// its own tag and the tag it runs to. One is live. Latch them along the loop
// before the clock the SERVER is keeping runs out.
import { esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { setAlarmSkin, startAlarm, stopAlarm, alarmState, alarmLatch, alarmSecondsLeft, alarmWanted } from './alarmgame.js';

let _overlay = null;
let _close = null;
let _opts = null;
let _reported = false;

function report(won) {
  if (_reported) return;
  _reported = true;
  _opts?.onResult?.({ won: !!won });
}

// ── Painting ────────────────────────────────────────────────────────────────

// ⚠ THE GRID IS REBUILT ONLY WHEN THE STATE CHANGES, NEVER PER FRAME.
//
// The obvious shape here is demolition's — `frame` calls `paint`, `paint` sets
// `board.innerHTML`, and the clock comes along for the ride. That is fine for a
// board whose controls are two fixed buttons at the bottom, and it is BROKEN for
// one whose controls ARE the thing being repainted: a browser click is a
// mousedown and a mouseup on the same element, so replacing every terminal
// sixty times a second means a real player's click frequently lands on an
// element that no longer exists by the time they let go. Nothing throws, the
// board just ignores you at random.
//
// So the grid repaints on a signature of what is actually drawn, and the clock —
// the only thing that moves between latches — is written straight into its own
// node. Found in a browser; no headless check could have seen it, because
// `.click()` fires synchronously on an element you are already holding.
let _sig = '';

function paint(st, force = false) {
  const board = _overlay?.querySelector('.al-board');
  if (!board) return;
  const wanted = alarmWanted();
  const sig = `${st.step}|${st.strikesLeft}|${st.note}|${st.terminals.map(t => `${t.tag}${t.latched ? 'L' : ''}${t.burnt ? 'B' : ''}`).join(',')}`;
  if (!force && sig === _sig) return;
  _sig = sig;
  const rows = st.terminals.map((t, i) => {
    const cls = t.burnt ? 'burnt' : t.latched ? 'latched' : t.live ? 'live' : '';
    const state = t.burnt ? 'BURNT' : t.latched ? 'OPEN' : t.live ? 'LIVE' : '';
    return `<button class="al-term ${cls}" data-i="${i}" ${t.burnt || t.latched ? 'disabled' : ''}>
        <span class="al-tag">${t.tag}</span>
        <span class="al-arrow">&rarr;</span>
        <span class="al-next">${t.next || 'END'}</span>
        <span class="al-state">${state}</span>
      </button>`;
  }).join('');
  const pips = Array.from({ length: st.strikes }, (_, i) =>
    `<i class="al-pip ${i < st.strikesLeft ? 'on' : ''}"></i>`).join('');
  board.innerHTML =
    `<div class="al-head">
       <span>LOOP <b>${st.step}</b>/${st.chain.length}</span>
       <span class="al-seek">SEEKING <b>${wanted || '&mdash;'}</b></span>
       <span class="al-right">TOLERANCE ${pips}</span>
     </div>
     <div class="al-grid">${rows}</div>
     <div class="al-note">${esc(st.note || 'The live terminal is marked. Follow where it runs.')}</div>`;
}

const SKIN = {
  // A fresh game can share a signature with the one before it (step 0, no
  // strikes spent, same opening note), so the first paint is forced.
  board: (st) => { _sig = ''; paint(st, true); },

  status: (html) => {
    const s = _overlay?.querySelector('.al-status');
    if (s) s.innerHTML = html;
  },

  frame: (st) => {
    paint(st);           // no-op unless something actually changed
    const left = alarmSecondsLeft();
    const clock = _overlay?.querySelector('.al-clock');
    if (clock) {
      clock.textContent = left.toFixed(1);
      // A quarter left is where the room's own chirping has already sped up, so
      // the board agreeing with it is the two surfaces telling one story.
      clock.classList.toggle('hot', left <= st.seconds * 0.25);
    }
    setDeckLevel(_overlay, Math.max(0, left / st.seconds));
  },

  finish: (st, won, info) => {
    paint(st, true);
    const s = _overlay?.querySelector('.al-status');
    if (s) {
      s.innerHTML = info?.expired
        ? '<span class="al-bad">OUT OF TIME.</span>'
        : won
          ? '<span class="al-ok">LOOP OPEN. The panel goes dark.</span>'
          : '<span class="al-bad">LATCHED OUT.</span>';
    }
    // ⚠ An expired board reports NOTHING. The server's sweep owns an alarm whose
    // window ran out, and a client claiming a loss here would be a second opinion
    // on an authoritative fact — and would damage the deck for a race the player
    // never actually lost.
    if (!info?.expired) report(won);
    setTimeout(() => close(), won ? 1100 : 1900);
  },
};

// ── Input ───────────────────────────────────────────────────────────────────

function onKey(e) {
  const st = alarmState();
  if (!_overlay || !st) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  // Number keys latch by position — the fastest input there is, and this board is
  // about speed.
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= st.terminals.length) {
    e.preventDefault();
    alarmLatch(n - 1);
  }
}

function wire() {
  _overlay.addEventListener('click', (e) => {
    const term = e.target.closest('.al-term');
    if (term) alarmLatch(Number(term.dataset.i));
  });
}

// ── Open / close ────────────────────────────────────────────────────────────

export function openAlarmPanel(opts = {}) {
  ensureChassisStyles();
  ensureStyles();
  close();
  _opts = { skill: 4, difficulty: 5, seconds: 30, deviceName: 'ALARM', onResult: null, ...opts };
  _reported = false;
  const html =
    `<div class="al-panel mg-chassis">
      ${deviceHeader('&#9888;', 'INTRUDER PANEL &middot; DISARM', esc(_opts.deviceName).toUpperCase())}
      <div class="al-bezel mg-bezel">${bezelScrews()}<div class="al-screen mg-screen">
        <div class="al-clock">&mdash;</div>
        <div class="al-board"></div>${crtOverlays()}
      </div></div>
      ${deckStrip('LOOP BUS', 'WINDOW')}
      <div class="al-status"></div>
      <div class="al-actions al-foot"><button class="al-btn al-abort">Back off</button></div>
    </div>`;
  const mounted = mountOverlay({ id: 'alarmpanel-overlay', html, onClose: () => stopAlarm() });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close')?.addEventListener('click', close);
  _overlay.querySelector('.al-abort')?.addEventListener('click', close);
  wire();
  window.addEventListener('keydown', onKey);
  setAlarmSkin(SKIN);
  const st = startAlarm(_opts);
  SKIN.status('Follow the loop. Latching the wrong terminal burns it out.');
  return !!st;
}

export function close() {
  window.removeEventListener('keydown', onKey);
  stopAlarm();
  setAlarmSkin(null);
  if (_close) { _close(); _close = null; }
  _overlay = null;
}

function ensureStyles() {
  if (document.getElementById('alarmpanel-styles')) return;
  const st = document.createElement('style');
  st.id = 'alarmpanel-styles';
  st.textContent = `
    .al-panel { --al-hot:#ff5a3c; --al-ok:#46e05a; --al-amber:#e0a030; width:min(580px,94vw); }
    .al-board { padding:4px 16px 14px; font-family:'JetBrains Mono',monospace; color:#cfe6d8; }
    .al-clock { font-size:2.1rem; font-weight:700; text-align:center; color:#cfe6d8; padding-top:10px; font-family:'JetBrains Mono',monospace; }
    .al-clock.hot { color:var(--al-hot); }
    .al-head { display:flex; align-items:center; gap:12px; font-size:.72rem; letter-spacing:.14em; color:#7fa392; margin:6px 0 10px; }
    .al-right { margin-left:auto; }
    .al-seek b { color:var(--al-amber); }
    .al-pip { width:10px; height:10px; border:1px solid #2c4438; display:inline-block; margin-left:3px; }
    .al-pip.on { background:var(--al-ok); border-color:var(--al-ok); }
    .al-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:6px; }
    .al-term { display:flex; align-items:center; gap:7px; padding:7px 9px; background:#131d19;
      border:1px solid #2c4438; color:#cfe6d8; cursor:pointer; font-family:inherit; font-size:.84rem; text-align:left; }
    .al-term:hover:not(:disabled) { border-color:var(--al-ok); }
    .al-term:disabled { cursor:default; }
    .al-term.live { border-color:var(--al-amber); box-shadow:inset 0 0 12px rgba(224,160,48,.18); }
    .al-term.latched { border-color:var(--al-ok); color:#6f8f7f; }
    .al-term.burnt { border-color:#3a2420; color:#5c4038; text-decoration:line-through; }
    .al-tag { font-weight:700; letter-spacing:.06em; }
    .al-arrow { color:#5d7a6b; }
    .al-next { color:#7fe3ff; }
    .al-state { margin-left:auto; font-size:.6rem; letter-spacing:.12em; color:#7fa392; }
    .al-note { font-size:.78rem; color:#7fa392; min-height:2.2em; margin-top:10px; }
    .al-actions { display:flex; gap:8px; padding:0 16px 12px; }
    .al-foot { padding-top:8px; }
    .al-btn { background:none; border:1px solid #2c4438; color:#cfe6d8; padding:6px 14px; cursor:pointer; letter-spacing:.1em; font-size:.78rem; }
    .al-btn:hover { border-color:var(--al-ok); }
    .al-status { padding:6px 16px; min-height:1.6em; font-size:.82rem; }
    .al-ok { color:var(--al-ok); }
    .al-bad { color:var(--al-hot); }
  `;
  document.head.appendChild(st);
}
