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

let live = null;

function ensureStyles() {
  if (document.getElementById('cardmint-styles')) return;
  const st = document.createElement('style');
  st.id = 'cardmint-styles';
  st.textContent = `
  #cardmint-overlay { position:fixed; inset:0; z-index:265; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 35%, rgba(38,30,18,.88), rgba(4,4,6,.96) 70%); backdrop-filter:blur(3px); }
  .cm-press { position:relative; width:min(94vw,520px); max-height:94vh; overflow-y:auto;
    background:linear-gradient(#2a241c,#191410 62%,#100d0a);
    border:1px solid #b98b3e; border-radius:6px; padding:16px 18px 18px;
    box-shadow:0 0 0 1px rgba(255,255,255,.05) inset, 0 26px 70px rgba(0,0,0,.75), 0 0 42px rgba(185,139,62,.18); }
  .cm-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:10px; }
  .cm-brand { font-size:0.8125rem; letter-spacing:5px; color:#e8c07a; text-shadow:0 0 12px rgba(232,192,122,.5); }
  .cm-sub { font-size:0.5625rem; letter-spacing:2px; color:var(--text-dim); }

  /* The bed. The card sits in it under a platen that comes down on STRIKE. */
  .cm-bed { position:relative; background:#0b0908; border:1px solid #3a2f22; border-radius:4px;
    padding:14px; overflow:hidden; }
  .cm-card { position:relative; z-index:2; transition:transform .3s ease, filter .3s ease; }
  .cm-platen { position:absolute; left:0; right:0; top:-102%; height:100%; z-index:4; pointer-events:none;
    background:linear-gradient(#6b5734,#3a2f1c 60%,#241d12);
    border-bottom:3px solid #c79b4b; box-shadow:0 12px 26px rgba(0,0,0,.7); }
  .cm-press.striking .cm-platen { animation:cm-stamp 1.15s cubic-bezier(.5,0,.2,1) forwards; }
  @keyframes cm-stamp {
    0%   { top:-102%; }
    38%  { top:0%; }
    52%  { top:0%; }
    100% { top:-102%; }
  }
  .cm-press.striking .cm-card { animation:cm-squash 1.15s cubic-bezier(.5,0,.2,1); }
  @keyframes cm-squash {
    0%,36% { transform:none; }
    44%    { transform:scaleY(.94) translateY(3px); filter:brightness(1.6); }
    60%    { transform:none; }
  }
  /* The foil pass, after the platen lifts: one hard specular band raked across
     the finished face. It's the moment the thing stops being stock. */
  .cm-foil { position:absolute; inset:0; z-index:5; pointer-events:none; opacity:0;
    background:linear-gradient(74deg, transparent 40%, rgba(255,236,190,.75) 50%, transparent 60%);
    mix-blend-mode:screen; }
  .cm-press.foiling .cm-foil { opacity:1; animation:cm-foil-run .9s ease-out; }
  @keyframes cm-foil-run { from{transform:translateX(-110%)} to{transform:translateX(110%)} }
  .cm-press.shake { animation:cm-shake .42s ease-out; }
  @keyframes cm-shake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-4px,3px)}
    55%{transform:translate(4px,-2px)} 80%{transform:translate(-2px,-1px)} }

  .cm-serial { text-align:center; margin-top:8px; font-size:0.75rem; letter-spacing:3px;
    color:#e8c07a; opacity:0; transition:opacity .4s ease .2s; }
  .cm-press.struck .cm-serial { opacity:1; }

  /* The quote bench. */
  .cm-bench { margin-top:12px; border-top:1px solid #3a2f22; padding-top:11px; }
  .cm-label { display:block; font-size:0.5625rem; letter-spacing:2px; color:var(--text-dim); margin-bottom:5px; }
  .cm-quote { width:100%; box-sizing:border-box; resize:vertical; min-height:3.2em;
    background:#0b0908; border:1px solid #3a2f22; color:var(--text); border-radius:3px;
    font-family:inherit; font-size:0.8125rem; line-height:1.45; padding:8px 9px; }
  .cm-quote:focus { outline:none; border-color:#b98b3e; box-shadow:0 0 0 2px rgba(185,139,62,.22); }
  .cm-count { float:right; font-variant-numeric:tabular-nums; }
  .cm-count.over { color:var(--red); }
  .cm-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px; }
  .cm-chip { background:transparent; border:1px solid #3a2f22; color:var(--text-dim);
    font-family:inherit; font-size:0.625rem; padding:3px 7px; border-radius:2px; cursor:pointer;
    max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cm-chip:hover { border-color:#b98b3e; color:#e8c07a; }

  .cm-warn { margin-top:9px; font-size:0.6875rem; color:var(--yellow); line-height:1.5; }
  .cm-err { margin-top:7px; font-size:0.6875rem; color:var(--red); min-height:1.2em; }
  .cm-row { display:flex; gap:8px; align-items:center; margin-top:12px; }
  .cm-btn { background:transparent; border:1px solid #b98b3e; color:#e8c07a; font-family:inherit;
    font-size:0.6875rem; letter-spacing:1.5px; padding:8px 15px; border-radius:3px; cursor:pointer; }
  .cm-btn:hover:not(:disabled) { background:#b98b3e; color:#100d0a; }
  .cm-btn:disabled { opacity:.4; cursor:default; }
  .cm-btn.ghost { border-color:#3a2f22; color:var(--text-dim); }
  .cm-fee { margin-left:auto; font-size:0.6875rem; color:var(--text-dim); }
  .cm-x { position:absolute; top:9px; right:12px; background:none; border:none; color:var(--text-dim);
    font-family:inherit; font-size:0.8125rem; cursor:pointer; }

  @media (prefers-reduced-motion: reduce) {
    .cm-press.striking .cm-platen, .cm-press.striking .cm-card,
    .cm-press.foiling .cm-foil, .cm-press.shake { animation:none; }
    .cm-press.foiling .cm-foil { opacity:0; }
  }`;
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

export function closeCardMintPanel() { if (live) { live.close(); live = null; } }
