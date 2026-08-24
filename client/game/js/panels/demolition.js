// DEMOLITION — the graphical boards for rigging and defusing a charge.
//
// Both are skins over demolitiongame.js; there is no game logic in this file at
// all, which is what keeps this and textdemolition.js honestly the same game.
//
// Two boards, one chassis:
//   RIG     a fuse dial, then a needle sweeping a tolerance band. Three leads.
//   DEFUSE  a loom of leads, a tension meter, and a clock that is really running.
import { esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip } from './minigame-common.js';
import {
  setDemoSkin, startRig, startDefuse, stop as stopGame, demoState,
  rigFuse, rigCommit, defuseMove, defuseProbe, defuseCut, defuseSecondsLeft,
} from './demolitiongame.js';

let _overlay = null;
let _close = null;
let _opts = null;
let _reported = false;

const TRACK = 44;   // needle track cells

// The rig board is the only one in the game that reports a NUMBER as well as an
// outcome: the fuse the player chose. The server clamps it on arrival — a client
// is never trusted with how long anybody has to react.
function report(won, st) {
  if (_reported) return;
  _reported = true;
  _opts?.onResult?.({ won: !!won, fuse: st?.kind === 'rig' ? st.fuse : undefined });
}

// ── Painting ────────────────────────────────────────────────────────────────

function paintRig(st) {
  const board = _overlay?.querySelector('.dm-board');
  if (!board) return;
  if (st.phase === 'fuse') {
    board.innerHTML =
      `<div class="dm-fuse">
        <div class="dm-fuse-label">FUSE</div>
        <div class="dm-fuse-dial"><button class="dm-step" data-step="-5">&#9664;</button>
          <span class="dm-fuse-n">${st.fuse}</span><span class="dm-fuse-u">s</span>
          <button class="dm-step" data-step="5">&#9654;</button></div>
        <div class="dm-fuse-hint">Short is worth more and leaves you less. ${st.fuseMin}&ndash;${st.fuseMax} seconds.</div>
        <button class="dm-btn dm-arm">SEAT THE LEADS &rarr;</button>
      </div>`;
    return;
  }
  const cells = [];
  const lo = Math.round((0.5 - st.band / 2) * TRACK);
  const hi = Math.round((0.5 + st.band / 2) * TRACK);
  const at = Math.round(st.pos * TRACK);
  for (let i = 0; i <= TRACK; i++) {
    if (i === at) cells.push('<i class="dm-nd"></i>');
    else if (i >= lo && i <= hi) cells.push('<i class="dm-bd"></i>');
    else cells.push('<i class="dm-tk"></i>');
  }
  const pips = Array.from({ length: 3 }, (_, i) =>
    `<i class="dm-pip ${i < st.seated ? 'on' : ''}"></i>`).join('');
  board.innerHTML =
    `<div class="dm-seat">
      <div class="dm-track ${st.last === 'bad' ? 'shake' : ''}">${cells.join('')}</div>
      <div class="dm-row"><span class="dm-lbl">LEADS</span> ${pips}
        <span class="dm-lbl dm-right">FUMBLES ${st.fumbles}/3</span></div>
      <button class="dm-btn dm-commit">SEAT (space)</button>
    </div>`;
}

function paintDefuse(st) {
  const board = _overlay?.querySelector('.dm-board');
  if (!board) return;
  const left = defuseSecondsLeft();
  const rows = st.leads.map((l, i) => {
    const sel = i === st.cursor ? ' sel' : '';
    const reading = l.probed ? `${l.tension} mV` : '&mdash;&mdash;&mdash;';
    return `<div class="dm-lead${sel}" data-i="${i}">
        <i class="dm-wire dm-${l.colour}"></i>
        <span class="dm-cn">${l.colour.toUpperCase()}</span>
        <span class="dm-rd">${reading}</span>
        ${l.cut ? '<span class="dm-cut">CUT</span>' : ''}
      </div>`;
  }).join('');
  board.innerHTML =
    `<div class="dm-defuse">
      <div class="dm-clock ${left < 10 ? 'hot' : ''}">${left.toFixed(1)}<span class="dm-fuse-u">s</span></div>
      <div class="dm-loom">${rows}</div>
      <div class="dm-note">${esc(st.note || 'Probe a lead to read its tension. The shunt reads against the run.')}</div>
      <div class="dm-actions">
        <button class="dm-btn dm-probe">PROBE (&minus;${st.probeCost}s)</button>
        <button class="dm-btn dm-danger dm-cut">CUT</button>
      </div>
    </div>`;
}

const SKIN = {
  board: (st) => (st.kind === 'rig' ? paintRig(st) : paintDefuse(st)),
  status: (html) => { const s = _overlay?.querySelector('.dm-status'); if (s) s.innerHTML = html; },
  frame: (st) => (st.kind === 'rig' ? paintRig(st) : paintDefuse(st)),
  finish: (st, won, info) => {
    const s = _overlay?.querySelector('.dm-status');
    if (s) {
      s.innerHTML = info?.expired
        ? '<span class="dm-bad">OUT OF TIME.</span>'
        : won
          ? '<span class="dm-ok">' + (st.kind === 'rig' ? 'SEATED. Walk away.' : 'SHUNT CUT. The count stops.') + '</span>'
          : '<span class="dm-bad">' + (st.kind === 'rig' ? 'The charge is scrap.' : 'Wrong lead.') + '</span>';
    }
    // An expired defuse board reports NOTHING: the server owns what happens to a
    // charge whose fuse ran out, and a client claiming a loss here would be a
    // second opinion on an authoritative fact.
    if (!info?.expired) report(won, st);
    setTimeout(() => close(), won ? 1100 : 1900);
  },
};

// ── Input ───────────────────────────────────────────────────────────────────

function onKey(e) {
  const st = demoState();
  if (!_overlay || !st) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  if (st.kind === 'rig') {
    if (e.code === 'Space') { e.preventDefault(); rigCommit(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); rigFuse(5); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); rigFuse(-5); }
    return;
  }
  if (e.key === 'ArrowUp') { e.preventDefault(); defuseMove(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); defuseMove(1); }
  else if (e.key.toLowerCase() === 'p') { e.preventDefault(); defuseProbe(); }
  else if (e.key === 'Enter') { e.preventDefault(); defuseCut(); }
}

function wire() {
  _overlay.addEventListener('click', (e) => {
    const step = e.target.closest('.dm-step');
    if (step) return rigFuse(Number(step.dataset.step));
    if (e.target.closest('.dm-arm') || e.target.closest('.dm-commit')) return rigCommit();
    if (e.target.closest('.dm-probe')) return defuseProbe();
    if (e.target.closest('.dm-cut')) return defuseCut();
    const lead = e.target.closest('.dm-lead');
    // Clicking a lead selects it; the two verbs stay on the buttons so a misclick
    // on a wire can never be the cut.
    if (lead) { const st = demoState(); if (st) defuseMove(Number(lead.dataset.i) - st.cursor); }
  });
}

// ── Open / close ────────────────────────────────────────────────────────────

function open(kind, opts) {
  ensureChassisStyles();
  ensureStyles();
  close();
  _opts = { skill: 4, difficulty: 5, deviceName: 'CHARGE', onResult: null, ...opts };
  _reported = false;
  const title = kind === 'rig' ? 'CHARGE &middot; ARMING' : 'CHARGE &middot; DISARM';
  const html =
    `<div class="dm-panel mg-chassis">
      ${deviceHeader('&#9762;', title, 'TARGET &middot; ' + esc(_opts.deviceName).toUpperCase())}
      <div class="dm-bezel mg-bezel">${bezelScrews()}<div class="dm-screen mg-screen"><div class="dm-board"></div>${crtOverlays()}</div></div>
      ${deckStrip('DET BUS', 'FUSE')}
      <div class="dm-status"></div>
      <div class="dm-actions dm-foot"><button class="dm-btn dm-abort">Abort</button></div>
    </div>`;
  const mounted = mountOverlay({ id: 'demolition-overlay', html, onClose: () => stopGame() });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.querySelector('.mg-close')?.addEventListener('click', close);
  _overlay.querySelector('.dm-abort')?.addEventListener('click', close);
  wire();
  window.addEventListener('keydown', onKey);
  setDemoSkin(SKIN);
  const st = kind === 'rig' ? startRig(_opts) : startDefuse(_opts);
  SKIN.status(kind === 'rig'
    ? 'Set the fuse, then catch the needle in the band. Three leads.'
    : 'Probe costs time you do not have. Cut the shunt.');
  return !!st;
}

export function openBombRig(opts = {}) { return open('rig', opts); }
export function openBombDefuse(opts = {}) { return open('defuse', opts); }

export function close() {
  window.removeEventListener('keydown', onKey);
  stopGame();
  setDemoSkin(null);
  if (_close) { _close(); _close = null; }
  _overlay = null;
}

function ensureStyles() {
  if (document.getElementById('demolition-styles')) return;
  const st = document.createElement('style');
  st.id = 'demolition-styles';
  st.textContent = `
    .dm-panel { --dm-hot:#ff5a3c; --dm-ok:#46e05a; width:min(560px,94vw); }
    .dm-board { padding:14px 16px; font-family:'JetBrains Mono',monospace; color:#cfe6d8; }
    .dm-fuse { text-align:center; }
    .dm-fuse-label { letter-spacing:.28em; font-size:.7rem; color:#7fa392; }
    .dm-fuse-dial { display:flex; align-items:center; justify-content:center; gap:12px; margin:10px 0 4px; }
    .dm-fuse-n { font-size:2.6rem; font-weight:700; color:var(--dm-hot); text-shadow:0 0 14px rgba(255,90,60,.5); }
    .dm-fuse-u { font-size:1rem; color:#7fa392; margin-left:2px; }
    .dm-fuse-hint { font-size:.76rem; color:#7fa392; margin-bottom:12px; }
    .dm-step { background:none; border:1px solid #2c4438; color:#cfe6d8; padding:2px 9px; cursor:pointer; }
    .dm-track { display:flex; gap:1px; margin:18px 0 10px; height:34px; align-items:stretch; }
    .dm-track i { flex:1 1 auto; }
    .dm-tk { background:#1b2a24; }
    .dm-bd { background:rgba(70,224,90,.28); }
    .dm-nd { background:var(--dm-hot); box-shadow:0 0 10px rgba(255,90,60,.9); }
    .dm-track.shake { animation:dmshake .22s linear; }
    @keyframes dmshake { 25%{transform:translateX(-3px)} 75%{transform:translateX(3px)} }
    .dm-row { display:flex; align-items:center; gap:8px; font-size:.74rem; letter-spacing:.16em; color:#7fa392; }
    .dm-right { margin-left:auto; }
    .dm-pip { width:11px; height:11px; border:1px solid #2c4438; display:inline-block; }
    .dm-pip.on { background:var(--dm-ok); border-color:var(--dm-ok); }
    .dm-clock { font-size:2.2rem; font-weight:700; text-align:center; color:#cfe6d8; }
    .dm-clock.hot { color:var(--dm-hot); }
    .dm-loom { margin:10px 0; }
    .dm-lead { display:flex; align-items:center; gap:10px; padding:4px 8px; border:1px solid transparent; cursor:pointer; }
    .dm-lead.sel { border-color:#46e05a; background:rgba(70,224,90,.08); }
    .dm-wire { width:26px; height:4px; display:inline-block; }
    .dm-red{background:#e0453a}.dm-blue{background:#4a90d9}.dm-green{background:#46e05a}
    .dm-amber{background:#e0a030}.dm-white{background:#e8e8e8}.dm-grey{background:#7e8a99}
    .dm-cn { width:64px; font-size:.74rem; letter-spacing:.12em; }
    .dm-rd { color:#7fe3ff; font-size:.82rem; }
    .dm-cut { color:var(--dm-hot); font-size:.7rem; letter-spacing:.14em; }
    .dm-note { font-size:.78rem; color:#7fa392; min-height:2.2em; }
    .dm-actions { display:flex; gap:8px; padding:0 16px 12px; }
    .dm-foot { padding-top:8px; }
    .dm-btn { background:none; border:1px solid #2c4438; color:#cfe6d8; padding:6px 14px; cursor:pointer; letter-spacing:.1em; font-size:.78rem; }
    .dm-btn:hover { border-color:#46e05a; }
    .dm-danger { border-color:#5a2c24; color:#ffb0a2; }
    .dm-danger:hover { border-color:var(--dm-hot); }
    .dm-status { padding:6px 16px; min-height:1.6em; font-size:.82rem; }
    .dm-ok { color:var(--dm-ok); }
    .dm-bad { color:var(--dm-hot); }
    @media (prefers-reduced-motion: reduce) { .dm-track.shake { animation:none; } }
  `;
  document.head.appendChild(st);
}
