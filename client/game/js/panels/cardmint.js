// THE COLDWATER MINT — the press you strike your own card on.
//
// Deliberately NOT the ARCHITECT DRAFT cabinet from cardpack.js. That is a
// vending machine: a lit marquee, product behind glass, a delivery flap. This is
// a PRESS — a heavy steel frame, a platen that comes down, a stock tray and a
// finished-work slot. You are not buying something here, you are making one.
//
// THE RULE, as everywhere else in this system: the client decides nothing. The
// card face arrives fully rendered from the server (`renderCard`, the same one
// the shelf and the pack reveal use) and this file never composes a card, never
// picks a quote and never validates one — it sends `mintquote <line>` and draws
// whatever comes back. That matters here more than in the reveal, because the
// quote is the one part a player types: if the panel rendered its own preview of
// a line the server would later refuse, the card you looked at and the card you
// paid for would be different objects.
//
// Every control is a verb a player could have typed (`mintquote`, `mint`,
// `mint confirm`), so the text path and the panel path cannot drift.
import { sendCmd } from '../net.js';
import { sfx, esc, mountOverlay } from './minigame-common.js';
import { prefersReducedMotion } from '/shared/settings.js';
import { loadCss } from '../../../shared/dom.js';

// cardmint.css ships beside this file and is fetched when the module loads, so ensureStyles
// still applies it synchronously on first open. See loadCss in client/shared/dom.js.
const MINT_CSS = await loadCss(new URL('./cardmint.css', import.meta.url));

let live = null;

function ensureStyles() {
  if (document.getElementById('cardmint-styles')) return;
  const st = document.createElement('style');
  st.id = 'cardmint-styles';
  st.textContent = MINT_CSS;
  document.head.appendChild(st);
}

export function openCardMintPanel(msg) {
  ensureStyles();
  if (live) { live.close(); live = null; }

  const budget = Number(msg.quoteBudget) || 90;
  const mounted = mountOverlay({
    id: 'cardmint-overlay',
    closeOnBackdrop: true,
    onClose: () => { live = null; },
    html: `
      <div class="cm-press" id="cm-press">
        <button class="cm-x" title="Close">✕</button>
        <div class="cm-head">
          <span class="cm-brand">THE COLDWATER MINT</span>
          <span class="cm-sub">${esc(msg.machineName || 'press')}</span>
        </div>
        <div class="cm-bed">
          <div class="cm-card" id="cm-card">${msg.face || ''}</div>
          <div class="cm-platen"></div>
          <div class="cm-foil"></div>
        </div>
        <div class="cm-serial" id="cm-serial"></div>
        <div class="cm-bench">
          <label class="cm-label" for="cm-quote">THE LINE ON THE CARD
            <span class="cm-count" id="cm-count"></span></label>
          <textarea class="cm-quote" id="cm-quote" maxlength="${budget * 2}"
            placeholder="Write what it should say, or leave it and it prints what you were heard saying."></textarea>
          <div class="cm-chips" id="cm-chips"></div>
          <div class="cm-err" id="cm-err" role="alert"></div>
        </div>
        ${msg.gaps?.length ? `<div class="cm-warn">${msg.gaps.map(g => `• ${g}`).join('<br>')}</div>` : ''}
        <div class="cm-row">
          <button class="cm-btn" id="cm-strike">STRIKE IT</button>
          <button class="cm-btn ghost" id="cm-set">SET LINE</button>
          <span class="cm-fee">₵${Number(msg.fee).toLocaleString('en-US')} · you have ₵${Number(msg.credits).toLocaleString('en-US')}</span>
        </div>
      </div>`,
  });
  live = mounted;

  const q = mounted.overlay.querySelector('#cm-quote');
  const count = mounted.overlay.querySelector('#cm-count');
  const err = mounted.overlay.querySelector('#cm-err');
  const setBtn = mounted.overlay.querySelector('#cm-set');
  const strikeBtn = mounted.overlay.querySelector('#cm-strike');

  q.value = msg.quote || '';
  const paint = () => {
    const n = q.value.trim().replace(/\s+/g, ' ').length;
    count.textContent = `${n}/${budget}`;
    count.classList.toggle('over', n > budget);
    // Advisory only. The SERVER decides whether a line is acceptable — this just
    // stops you discovering the limit by being refused.
    setBtn.disabled = n > budget;
  };
  q.addEventListener('input', paint);
  paint();

  // Things you were overheard saying, offered as a starting point rather than as
  // the only option. Clicking one fills the box; it is still sent through
  // `mintquote` like anything you typed.
  const chips = mounted.overlay.querySelector('#cm-chips');
  for (const line of (msg.overheard || [])) {
    const b = document.createElement('button');
    b.className = 'cm-chip';
    b.type = 'button';
    b.title = line;
    b.textContent = line.length > 44 ? `${line.slice(0, 43)}…` : line;
    b.addEventListener('click', (e) => { e.stopPropagation(); q.value = line; paint(); q.focus(); sfx('cards-ui'); });
    chips.appendChild(b);
  }

  mounted.overlay.querySelector('.cm-x').addEventListener('click', () => { sfx('cards-ui'); mounted.close(); });

  setBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    err.textContent = '';
    const line = q.value.trim().replace(/\s+/g, ' ');
    sfx('cards-ui');
    // `mint` re-runs after, so the card in the bed is redrawn from the server's
    // own build rather than patched here. If the line is refused, the error lands
    // in the log and the bed simply doesn't change.
    sendCmd(line ? `mintquote ${line}` : 'mintquote clear');
    sendCmd('mint');
  });

  strikeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (strikeBtn.disabled) return;
    strikeBtn.disabled = true;
    setBtn.disabled = true;
    // The line in the box is committed FIRST, so what you are looking at is what
    // gets struck even if you never pressed SET.
    const line = q.value.trim().replace(/\s+/g, ' ');
    if (line && line !== (msg.quote || '')) sendCmd(`mintquote ${line}`);
    sendCmd('mint confirm');
  });

  // Escape closes, Ctrl/Cmd+Enter strikes — the textarea eats a bare Enter.
  mounted.overlay.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); strikeBtn.click(); }
  });

  setTimeout(() => q.focus(), 60);
  return mounted;
}

// The strike landed. Server has already taken the money and cut the card; this
// only plays it. If the panel was closed in between, the log still carries the
// whole thing, so there is nothing to recover.
export function cardMintStruck(msg) {
  if (!live) return;
  const press = live.overlay.querySelector('#cm-press');
  const card = live.overlay.querySelector('#cm-card');
  const serial = live.overlay.querySelector('#cm-serial');
  if (!press) return;
  const reduced = prefersReducedMotion();

  const finish = () => {
    if (msg.face) card.innerHTML = msg.face;
    press.classList.add('struck');
    serial.textContent = `№ ${String(msg.serial ?? 0).padStart(4, '0')}  ·  SERIES ${msg.series ?? 1}`;
  };

  if (reduced) { finish(); sfx('cards-flip-rare'); return; }

  press.classList.add('striking');
  sfx('cards-slide');
  // The platen lands at 38% of 1150ms. The slam, the flash and the swap all
  // happen on that frame, so the card you end up with is the one the press hit.
  setTimeout(() => {
    press.classList.add('shake');
    sfx('cards-flip-epic');
    finish();
    setTimeout(() => press.classList.remove('shake'), 440);
  }, 440);
  setTimeout(() => {
    press.classList.remove('striking');
    press.classList.add('foiling');
    sfx('cards-flip-legendary');
    setTimeout(() => press.classList.remove('foiling'), 950);
  }, 1160);
}

