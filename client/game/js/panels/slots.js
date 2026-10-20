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
import { loadCss } from '../../../shared/dom.js';

// slots.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const SLOTS_CSS = await loadCss(new URL('./slots.css', import.meta.url));

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
  st.textContent = SLOTS_CSS;
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
