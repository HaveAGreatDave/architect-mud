// SLOT CABINET — the graphical face of `spin`.
//
// THE RULE, same as the card reveal's: the client decides nothing. The reels,
// the payout and the new balance all arrive in the `slots_spin` payload
// (plugins/slots/index.js), already rolled and already paid. This file owns the
// spin-down and the noise. It cannot change what the reels land on, and that
// matters here more than almost anywhere else in the game — a slot machine is
// the one surface a player is entitled to be suspicious of.
//
// The character box always lands in the log alongside this, so closing the
// cabinet mid-spin costs nothing but the animation. That is what makes the
// bottom Display Mode rung's suppression safe (server stamps `render:'log'`).
//
// It is a CABINET, not the shared minigame CRT chassis: a lit marquee, three
// glass reel windows, a payline, and a lever. No scanlines — there's no tube in
// a bandit, there's a light box and a lot of chrome.
import { sendCmd } from '../net.js';
import { refreshInventory } from './inventory-state.js';
import { sfx, esc, mountOverlay } from './minigame-common.js';
import { prefersReducedMotion } from '/shared/settings.js';

let live = null;

// ── the ladder, as presentation ──────────────────────────────────────────────
// One row per outcome band, read off the server's `mult`. Same discipline as the
// card rarity table: every rung is more than the one below on every axis, so the
// ladder can't go ragged by tuning one case.
function band(mult, jackpot) {
  if (jackpot)     return { key: 'jackpot', color: '#ffc23d', glow: 1,   shake: 1,   rain: 90, hold: 900, sfx: 'cards-flip-legendary' };
  if (mult >= 20)  return { key: 'big',     color: '#b374ff', glow: .78, shake: .6,  rain: 40, hold: 700, sfx: 'cards-flip-epic' };
  if (mult >= 8)   return { key: 'win',     color: '#4aa8ff', glow: .55, shake: .25, rain: 0,  hold: 520, sfx: 'cards-flip-rare' };
  if (mult > 0)    return { key: 'small',   color: '#57d47c', glow: .32, shake: 0,   rain: 0,  hold: 380, sfx: 'cards-flip-uncommon' };
  return             { key: 'none',    color: '#8b98a8', glow: .12, shake: 0,   rain: 0,  hold: 260, sfx: 'cards-flip-common' };
}

// Reel stop timings. Staggered, and the LAST reel is the slowest by a wide
// margin: the whole feeling of a bandit is the third reel taking its time while
// the first two already match. Every machine that has ever worked does this.
const STOP = [1100, 1650, 2500];

function ensureStyles() {
  if (document.getElementById('slots-styles')) return;
  const st = document.createElement('style');
  st.id = 'slots-styles';
  st.textContent = `
  #slots-overlay { position:fixed; inset:0; z-index:260; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 40%, rgba(30,16,44,.86), rgba(4,4,8,.96) 70%); backdrop-filter:blur(3px); }
  .sl-cab { position:relative; width:min(92vw,430px); padding:18px 20px 20px;
    background:linear-gradient(#241c2e,#15111c 60%,#0e0b13);
    border:1px solid var(--accent); border-radius:14px;
    box-shadow:0 0 0 1px rgba(255,255,255,.05) inset, 0 24px 70px rgba(0,0,0,.7),
      0 0 var(--sl-halo,30px) color-mix(in srgb, var(--sl-c,#8b98a8) 55%, transparent); }

  /* Marquee. It is the CABINET's name, handed over by the server, never a venue
     baked in here — that is how it went stale last time. */
  .sl-marquee { text-align:center; font-size:0.9375rem; letter-spacing:5px; font-weight:700;
    color:var(--sl-c,#ffd15c); text-shadow:0 0 12px var(--sl-c,#ffd15c), 0 0 34px var(--sl-c,#ffd15c);
    animation:sl-buzz 5s ease-in-out infinite; }
  @keyframes sl-buzz { 0%,92%,100%{opacity:1} 94%{opacity:.55} 96%{opacity:1} 97%{opacity:.7} }
  .sl-house { text-align:center; font-size:0.5625rem; letter-spacing:3px; color:var(--text-dim); margin-top:3px; }

  /* The glass. Three windows, an inset shadow top and bottom so the strip reads
     as passing BEHIND something rather than sliding on a page. */
  .sl-glass { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:16px 0 10px;
    padding:10px; background:#07060a; border-radius:8px; border:1px solid #322a3d; position:relative; }
  .sl-win { position:relative; height:112px; overflow:hidden; border-radius:5px;
    background:linear-gradient(#151119,#221c2b 45%,#151119); }
  .sl-win::after { content:''; position:absolute; inset:0; pointer-events:none; border-radius:5px;
    box-shadow:inset 0 14px 16px -10px #000, inset 0 -14px 16px -10px #000,
      inset 0 0 0 1px rgba(255,255,255,.045); }
  .sl-strip { position:absolute; left:0; right:0; top:0; display:flex; flex-direction:column;
    align-items:center; will-change:transform; }
  .sl-sym { height:112px; line-height:112px; font-size:2.6rem; text-align:center; width:100%;
    color:#e9e2f5; text-shadow:0 2px 0 rgba(0,0,0,.6); }

  /* The payline. Dim until the reels stop, then it takes the band's colour —
     which is the single clearest "you won" cue on the cabinet. */
  .sl-payline { position:absolute; left:6px; right:6px; top:50%; height:2px; margin-top:-1px;
    background:#3a3247; transition:background .25s ease, box-shadow .25s ease; }
  .sl-cab.settled .sl-payline { background:var(--sl-c); box-shadow:0 0 14px var(--sl-c), 0 0 30px var(--sl-c); }

  .sl-verdict { text-align:center; min-height:2.4em; font-size:0.8125rem; letter-spacing:2px;
    color:var(--sl-c,#8b98a8); text-shadow:0 0 14px color-mix(in srgb, var(--sl-c,#fff) 60%, transparent);
    opacity:0; transform:translateY(6px); transition:opacity .3s ease, transform .3s ease; }
  .sl-cab.settled .sl-verdict { opacity:1; transform:none; }
  .sl-tally { text-align:center; font-size:0.6875rem; color:var(--text-dim); margin-top:2px; }

  .sl-row { display:flex; gap:8px; align-items:center; justify-content:center; margin-top:14px; }
  .sl-btn { background:transparent; border:1px solid var(--accent); color:var(--accent);
    font-family:inherit; font-size:0.6875rem; letter-spacing:1.5px; padding:7px 15px; border-radius:3px; cursor:pointer; }
  .sl-btn:hover:not(:disabled) { background:var(--accent); color:var(--bg); }
  .sl-btn:disabled { opacity:.4; cursor:default; }
  .sl-bet { width:74px; background:#0c0a11; border:1px solid #3a3247; color:var(--text);
    font-family:inherit; font-size:0.6875rem; padding:7px 8px; border-radius:3px; text-align:center; }

  /* The lever. Purely decorative and deliberately so — it MIRRORS the pull, it
     never causes it, because the pull is a command the server answers. */
  .sl-lever { position:absolute; right:-16px; top:96px; width:12px; height:96px; }
  .sl-lever i { position:absolute; left:3px; top:14px; width:6px; height:82px; background:#4b4358; border-radius:3px;
    transform-origin:50% 100%; transition:transform .5s cubic-bezier(.3,1.4,.5,1); }
  .sl-lever b { position:absolute; left:-4px; top:0; width:20px; height:20px; border-radius:50%;
    background:radial-gradient(circle at 34% 30%, #ff8fa3, #c22040 60%, #6d1024);
    transform-origin:50% 480%; transition:transform .5s cubic-bezier(.3,1.4,.5,1); }
  .sl-cab.pulling .sl-lever i { transform:rotate(38deg); }
  .sl-cab.pulling .sl-lever b { transform:rotate(38deg); }

  .sl-cab.shake { animation:sl-shake .5s ease-out; }
  @keyframes sl-shake { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-5px,3px)}
    45%{transform:translate(5px,-3px)} 70%{transform:translate(-3px,-2px)} }

  .sl-coin { position:absolute; top:-6%; width:8px; height:8px; border-radius:50%; pointer-events:none;
    background:var(--sl-c,#ffc23d); box-shadow:0 0 10px var(--sl-c,#ffc23d); opacity:0;
    animation:sl-coin-fall var(--d,2.4s) linear forwards; }
  @keyframes sl-coin-fall { 0%{opacity:0; transform:translate(0,0) rotate(0)} 10%{opacity:1}
    100%{opacity:0; transform:translate(var(--dx,0),108vh) rotate(720deg)} }

  .sl-x { position:absolute; top:8px; right:12px; background:none; border:none; color:var(--text-dim);
    font-family:inherit; font-size:0.8125rem; cursor:pointer; }
  .sl-hint { text-align:center; font-size:0.5625rem; letter-spacing:1.5px; color:var(--text-dim); margin-top:9px; opacity:.75; }

  @media (prefers-reduced-motion: reduce) {
    .sl-marquee { animation:none; }
    .sl-cab.shake { animation:none; }
    .sl-coin { display:none; }
    .sl-strip { transition:none !important; }
  }`;
  document.head.appendChild(st);
}

// A strip long enough that the spin never shows its seam, ending on the symbol
// the SERVER chose. The landing symbol is the last cell, so the transform that
// stops the reel is arithmetic, not a search.
function buildStrip(symbols, land, loops) {
  const cells = [];
  for (let i = 0; i < loops; i++) {
    for (const s of symbols) cells.push(s);
  }
  cells.push(land);
  return cells;
}

export function openSlotsPanel(msg) {
  ensureStyles();
  // A second pull while one is on screen re-uses the cabinet rather than
  // stacking overlays — `spin` is spammable by design (the box is clickable).
  if (live) { live.close(); live = null; }

  const B = band(msg.mult || 0, !!msg.jackpot);
  const reduced = prefersReducedMotion();
  const syms = (msg.symbols && msg.symbols.length ? msg.symbols : ['7', '$', '★', '♦', '♣', '♠']);

  const mounted = mountOverlay({
    id: 'slots-overlay',
    closeOnBackdrop: true,
    onKey: (e, close) => {
      // The handler is on WINDOW, and the command input keeps focus behind the
      // cabinet — so an unguarded Space/Enter meant every character typed and
      // every command sent pulled the lever again. That is a player being
      // charged for spins they never asked for, on the one surface they are
      // entitled to be suspicious of. Typing is never a pull; the cabinet's own
      // bet field is the one exception, where Enter means "go".
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing && !(e.key === 'Enter' && el.id === 'sl-bet')) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pullAgain(); }
    },
    onClose: () => { live = null; },
    html: `
      <div class="sl-cab" id="sl-cab" style="--sl-c:${B.color}; --sl-halo:${Math.round(20 + B.glow * 60)}px">
        <button class="sl-x" title="Close">✕</button>
        <div class="sl-marquee">${esc(msg.marquee || 'SLOTS')}</div>
        <div class="sl-house">${esc(msg.machineName || '')}</div>
        <div class="sl-glass">
          ${[0, 1, 2].map(i => `<div class="sl-win"><div class="sl-strip" id="sl-strip-${i}"></div></div>`).join('')}
          <div class="sl-payline"></div>
        </div>
        <div class="sl-verdict" id="sl-verdict"></div>
        <div class="sl-tally" id="sl-tally"></div>
        <div class="sl-row">
          <input class="sl-bet" id="sl-bet" type="number" value="${msg.bet}" min="${msg.min ?? 1}" max="${msg.max ?? 9999}" aria-label="Bet in credits">
          <button class="sl-btn" id="sl-pull">PULL</button>
        </div>
        <div class="sl-hint">SPACE PULLS · ESC WALKS AWAY</div>
        <div class="sl-lever"><i></i><b></b></div>
      </div>`,
  });
  live = mounted;
  const cab = mounted.overlay.querySelector('#sl-cab');

  mounted.overlay.querySelector('.sl-x').addEventListener('click', () => { sfx('cards-ui'); mounted.close(); });

  function pullAgain() {
    const betEl = mounted.overlay.querySelector('#sl-bet');
    const bet = Math.max(1, parseInt(betEl.value, 10) || msg.bet);
    // The command is the authority. The panel does not roll, does not pay, and
    // does not pre-empt — it asks for a spin exactly as typing `spin 25` would,
    // and the next payload replaces this cabinet.
    sendCmd(`spin ${bet}`);
  }
  mounted.overlay.querySelector('#sl-pull').addEventListener('click', (e) => { e.stopPropagation(); pullAgain(); });

  // ── the spin ────────────────────────────────────────────────────────────────
  const LOOPS = [7, 9, 12];
  [0, 1, 2].forEach((i) => {
    const strip = mounted.overlay.querySelector(`#sl-strip-${i}`);
    const cells = buildStrip(syms, msg.reels[i], LOOPS[i]);
    strip.innerHTML = cells.map(s => `<div class="sl-sym">${esc(s)}</div>`).join('');
    // Start with the LAST cell parked in the window, then animate from the top:
    // the strip travels its whole length and arrives on the server's symbol.
    const travel = (cells.length - 1) * 112;
    strip.style.transform = `translateY(-0px)`;
    if (reduced) {
      // No travel at all — the symbol is simply there. The result is the
      // information; the spinning is the decoration, and this rung skips it.
      strip.style.transform = `translateY(${-travel}px)`;
      return;
    }
    requestAnimationFrame(() => {
      strip.style.transition = `transform ${STOP[i]}ms cubic-bezier(.12,.62,.16,1)`;
      strip.style.transform = `translateY(${-travel}px)`;
    });
  });

  cab.classList.add('pulling');
  sfx('cards-slide');
  setTimeout(() => cab.classList.remove('pulling'), 520);

  // Each reel lands with its own click, so the third one arriving is an EVENT.
  if (!reduced) [0, 1, 2].forEach(i => setTimeout(() => { if (live === mounted) sfx('cards-ui'); }, STOP[i]));

  const settleAt = reduced ? 0 : STOP[2] + 120;
  setTimeout(() => {
    if (live !== mounted) return;
    cab.classList.add('settled');
    const v = mounted.overlay.querySelector('#sl-verdict');
    const t = mounted.overlay.querySelector('#sl-tally');
    v.textContent = msg.jackpot ? '★ JACKPOT ★'
      : msg.mult ? `${String(msg.label || 'WINNER').toUpperCase()} ×${msg.mult}`
      : 'NO LUCK';
    t.textContent = msg.mult
      ? `+₵ ${Number(msg.winnings).toLocaleString()}   ·   balance ₵ ${Number(msg.balance).toLocaleString()}`
      : `bet ₵ ${msg.bet}   ·   balance ₵ ${Number(msg.balance).toLocaleString()}`;
    sfx(B.sfx);
    if (B.shake && !reduced) { cab.classList.add('shake'); setTimeout(() => cab.classList.remove('shake'), 520); }
    if (B.rain && !reduced) rainCoins(mounted.overlay, B.rain);
    refreshInventory();
  }, settleAt);

  return mounted;
}

export function closeSlotsPanel() { if (live) { live.close(); live = null; } }

function rainCoins(host, n) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'sl-coin';
    c.style.left = `${Math.random() * 100}%`;
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
    c.style.setProperty('--d', `${1.8 + Math.random() * 2.2}s`);
    c.style.animationDelay = `${Math.random() * 1.2}s`;
    host.appendChild(c);
    setTimeout(() => c.remove(), 5200);
  }
}
