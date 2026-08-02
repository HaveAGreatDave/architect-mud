// CARD MACHINE + PACK OPENING — the vending terminal and the foil-tear reveal.
//
// Two overlays, deliberately separate, because they are two different moments.
// The MACHINE is a thing you stand in front of and press buttons on: an ATM-shaped
// terminal with a lit product window, an odds board and your balance, modelled on
// #atm-box through the shared minigame chassis so it reads as the same class of
// hardware. The REVEAL is a thing that happens to you: fullscreen, no chrome, no
// controls but "next".
//
// THE RULE THIS MODULE IS BUILT AROUND: the client decides nothing. Every card,
// its rarity, whether it's a dupe and the fully-rendered face all arrive from the
// server in the `cardpack_open` payload (plugins/cards/index.js). This file owns
// PACING and PRESENTATION only. That matters more here than in most panels — a
// reveal is the one place a player would be quickest to suspect the animation of
// choosing the outcome, and it can't, because the outcome was decided and granted
// before the first frame drew.
//
// The text log always lands alongside the overlay, so closing this mid-reveal
// costs the player nothing but the show.
import { sendCmd, sendCmdSilent } from '../net.js';
import { refreshInventory } from './inventory-state.js';
import { sfx, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays } from './minigame-common.js';

// ── the rarity ladder, as presentation ────────────────────────────────────────
// One table drives colour, ray count, screen flash, the pre-flip HOLD and the
// post-flip DWELL. Keeping them in one row per rank is what stops the ladder
// going ragged — you can read straight down it and see that every rung is more
// than the one below on every axis, which is the property the whole reveal
// depends on and the easiest one to break by tuning a single case in isolation.
//
// `hold` is the pause between the card arriving and it flipping. It is the
// suspense, and it is also literally the SFX riser: cards-flip-legendary spends
// its first 440ms climbing, so a legendary's 460ms hold means the chord lands on
// the same frame the face does.
const RARITY = {
  common:    { color: '#8b98a8', glow: 0.15, rays: 0,  flash: 0,    shake: 0,    hold: 90,  dwell: 820,  sfx: 'cards-flip-common',    label: 'COMMON' },
  uncommon:  { color: '#57d47c', glow: 0.3,  rays: 0,  flash: 0.08, shake: 0,    hold: 130, dwell: 980,  sfx: 'cards-flip-uncommon',  label: 'UNCOMMON' },
  rare:      { color: '#4aa8ff', glow: 0.5,  rays: 10, flash: 0.16, shake: 0.25, hold: 240, dwell: 1500, sfx: 'cards-flip-rare',      label: 'RARE' },
  epic:      { color: '#b374ff', glow: 0.72, rays: 16, flash: 0.3,  shake: 0.55, hold: 340, dwell: 2050, sfx: 'cards-flip-epic',      label: 'EPIC' },
  legendary: { color: '#ffc23d', glow: 1,    rays: 24, flash: 0.5,  shake: 1,    hold: 460, dwell: 2750, sfx: 'cards-flip-legendary', label: 'LEGENDARY' },
  architect: { color: '#ff5470', glow: 1,    rays: 28, flash: 0.6,  shake: 1,    hold: 540, dwell: 3000, sfx: 'cards-flip-architect', label: 'ARCHITECT' },
};
const rarity = r => RARITY[r] || RARITY.common;

// A rare-or-better pull earns the full treatment: rays, flash, a held beat. Below
// that the card just turns over — which is the point. If a Common got confetti,
// a Legendary would have nothing left to be.
const isBig = r => (RARITY[r]?.rays || 0) > 0;

// ── styles ────────────────────────────────────────────────────────────────────
// Injected once rather than living in styles.css, following the minigame overlays:
// this is a self-contained fullscreen cinematic and nothing else in the client
// styles against it.
function ensurePackStyles() {
  if (document.getElementById('cardpack-styles')) return;
  const s = document.createElement('style');
  s.id = 'cardpack-styles';
  s.textContent = `
  /* ── the reveal overlay ───────────────────────────────────────────────── */
  #cardpack-overlay { position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at 50% 45%, rgba(14,20,30,0.86), rgba(2,4,7,0.97) 70%);
    backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); overflow:hidden;
    font-family:'Courier New', monospace; user-select:none; }
  #cardpack-overlay .cp-stage { position:relative; width:min(94vw,760px); height:min(88vh,640px);
    display:flex; align-items:center; justify-content:center; }

  /* Ambient rake of light behind everything, tinted by the current card. */
  #cardpack-overlay .cp-ambient { position:absolute; inset:-40%; pointer-events:none; opacity:0;
    background:radial-gradient(circle at 50% 50%, var(--cp-accent,#fff) 0%, transparent 62%);
    transition:opacity .45s ease; mix-blend-mode:screen; }

  /* ── the sealed sleeve ────────────────────────────────────────────────── */
  .cp-pack { position:relative; width:230px; height:330px; cursor:pointer;
    transform-origin:50% 55%; animation:cp-pack-idle 3.4s ease-in-out infinite; }
  .cp-pack-body { position:absolute; inset:0; border-radius:8px; overflow:hidden;
    background:linear-gradient(148deg,#12212e 0%,#20455c 18%,#7fd8e8 33%,#2a5f7a 44%,#123044 58%,#6b52a8 72%,#2b2352 84%,#101a2a 100%);
    box-shadow:0 26px 60px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 0 40px rgba(0,0,0,0.5); }
  /* The holographic sweep: a hard specular band raked across the foil. It is the
     single cue that says "this is foil, not paper" before anything moves. */
  .cp-pack-body::after { content:''; position:absolute; inset:-60%;
    background:linear-gradient(74deg, transparent 38%, rgba(255,255,255,0.72) 47%, rgba(190,255,255,0.9) 50%, rgba(255,255,255,0.6) 53%, transparent 62%);
    animation:cp-holo 2.6s linear infinite; mix-blend-mode:overlay; }
  .cp-pack-print { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:10px; text-align:center; text-shadow:0 2px 8px rgba(0,0,0,0.85); z-index:2; }
  .cp-pack-mark { font-size:40px; color:#eaf6ff; filter:drop-shadow(0 0 12px rgba(140,220,255,0.9)); }
  .cp-pack-brand { font-size:15px; letter-spacing:5px; color:#fff; font-weight:700; }
  .cp-pack-sub { font-size:9px; letter-spacing:3px; color:rgba(230,245,255,0.75); }
  .cp-pack-count { margin-top:14px; font-size:10px; letter-spacing:2px; color:rgba(255,255,255,0.6);
    border-top:1px solid rgba(255,255,255,0.22); border-bottom:1px solid rgba(255,255,255,0.22); padding:5px 12px; }
  /* Scored seam — the thing you are about to tear, so it is drawn as a real
     feature of the object rather than implied by the animation. */
  .cp-pack-seam { position:absolute; left:0; right:0; top:26px; height:12px; z-index:3;
    background:repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 5px, transparent 5px 10px);
    opacity:.55; }
  .cp-pack-hint { position:absolute; left:50%; bottom:-46px; transform:translateX(-50%); white-space:nowrap;
    font-size:11px; letter-spacing:3px; color:#9fd8ff; animation:cp-blink 1.5s ease-in-out infinite; }

  @keyframes cp-pack-idle { 0%,100%{transform:rotate(-2.2deg) translateY(0)} 50%{transform:rotate(2.2deg) translateY(-10px)} }
  @keyframes cp-holo { from{transform:translateX(-55%)} to{transform:translateX(55%)} }
  @keyframes cp-blink { 0%,100%{opacity:.35} 50%{opacity:1} }

  /* Tearing: the top strip rips free and spins off, the body drops and fades. */
  .cp-pack.tearing { animation:cp-pack-shake .28s ease-in-out 2; }
  .cp-pack.tearing .cp-pack-seam { animation:cp-seam-run .34s linear forwards; }
  .cp-pack.torn .cp-pack-top { animation:cp-strip-away .8s cubic-bezier(.3,.7,.4,1) forwards; }
  .cp-pack.torn .cp-pack-body, .cp-pack.torn .cp-pack-print { animation:cp-body-drop .8s cubic-bezier(.4,0,.7,1) forwards; }
  .cp-pack-top { position:absolute; left:-4px; right:-4px; top:-4px; height:36px; z-index:4; border-radius:8px 8px 2px 2px;
    background:linear-gradient(148deg,#20455c,#7fd8e8 40%,#2a5f7a);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,0.2); opacity:0; }
  .cp-pack.torn .cp-pack-top { opacity:1; }
  @keyframes cp-pack-shake { 0%,100%{transform:translateX(0) rotate(0)} 25%{transform:translateX(-7px) rotate(-2deg)} 75%{transform:translateX(7px) rotate(2deg)} }
  @keyframes cp-seam-run { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0 0 0)} }
  @keyframes cp-strip-away { to{transform:translate(210px,-190px) rotate(58deg); opacity:0} }
  @keyframes cp-body-drop { to{transform:translateY(150px) scale(.86); opacity:0} }

  /* Foil flecks thrown off the tear. */
  .cp-fleck { position:absolute; width:7px; height:9px; pointer-events:none; z-index:5;
    background:linear-gradient(140deg,#cfeeff,#5aa8c8); border-radius:1px;
    animation:cp-fleck-fly var(--d,1s) cubic-bezier(.15,.6,.4,1) forwards; }
  @keyframes cp-fleck-fly { to{ transform:translate(var(--tx),var(--ty)) rotate(var(--rot)); opacity:0 } }

  /* ── the card ─────────────────────────────────────────────────────────── */
  .cp-card-wrap { position:relative; width:min(78vw,340px); perspective:1400px; }
  .cp-card { position:relative; width:100%; aspect-ratio:5/7; transform-style:preserve-3d;
    transition:transform .62s cubic-bezier(.3,.9,.3,1); transform:rotateY(180deg) translateY(28px) scale(.9); }
  .cp-card.in { transform:rotateY(180deg) translateY(0) scale(1); }
  .cp-card.flipped { transform:rotateY(0deg); }
  .cp-card-side { position:absolute; inset:0; backface-visibility:hidden; -webkit-backface-visibility:hidden;
    border-radius:12px; overflow:hidden; box-shadow:0 22px 55px rgba(0,0,0,0.7); }

  /* Reverse — the Mint's house back. Every card in the game shares it, which is
     what makes the flip mean anything: until it turns, you have no information. */
  .cp-back { transform:rotateY(180deg); background:
      repeating-linear-gradient(45deg, rgba(255,255,255,0.035) 0 6px, transparent 6px 12px),
      linear-gradient(160deg,#0d1a26,#1d3f57 45%,#0a1420);
    border:1px solid rgba(140,210,255,0.28); display:flex; align-items:center; justify-content:center; }
  .cp-back-mark { font-size:56px; color:rgba(150,225,255,0.5); text-shadow:0 0 26px rgba(90,190,255,0.55); }

  /* Obverse — the server-rendered face, dropped in whole. */
  .cp-front { background:linear-gradient(170deg,#0b1118,#131c26); padding:12px;
    border:1px solid color-mix(in srgb, var(--cp-accent,#fff) 55%, transparent);
    box-shadow:0 0 0 1px rgba(0,0,0,0.6), 0 0 34px color-mix(in srgb, var(--cp-accent,#fff) calc(var(--cp-glow,0) * 60%), transparent);
    overflow-y:auto; }
  .cp-front .card-face { display:block; font-size:12px; line-height:1.5; }

  /* Rank plate under the card. */
  .cp-rank { margin-top:16px; text-align:center; font-size:13px; letter-spacing:6px; font-weight:700;
    color:var(--cp-accent,#fff); text-shadow:0 0 16px color-mix(in srgb, var(--cp-accent,#fff) 70%, transparent);
    opacity:0; transition:opacity .3s ease .12s; }
  .cp-card.flipped ~ .cp-rank { opacity:1; }
  .cp-sub { margin-top:5px; text-align:center; font-size:10px; letter-spacing:2px; color:#7f8f9f; opacity:0;
    transition:opacity .3s ease .2s; }
  .cp-card.flipped ~ .cp-sub { opacity:1; }
  .cp-dupe-tag { color:#c07b3a; }

  /* A PLAYER card is somebody real. It gets a banner no NPC card can earn — the
     asymmetry is the point of the whole system, so it is stated on screen. */
  .cp-player-banner { position:absolute; top:-30px; left:50%; transform:translateX(-50%) scale(.7);
    white-space:nowrap; font-size:10px; letter-spacing:4px; font-weight:700; padding:4px 14px; border-radius:3px;
    color:#04121a; background:linear-gradient(90deg,#7fe8ff,#fff,#7fe8ff); opacity:0;
    box-shadow:0 0 24px rgba(140,230,255,0.8); transition:opacity .35s ease, transform .35s cubic-bezier(.2,1.5,.4,1); }
  .cp-card.flipped ~ .cp-player-banner { opacity:1; transform:translateX(-50%) scale(1); }

  /* Rays — a fixed fan behind the card, scaled per rank by how many spokes exist. */
  .cp-rays { position:absolute; left:50%; top:45%; width:0; height:0; pointer-events:none; z-index:-1; opacity:0; }
  .cp-rays.on { animation:cp-rays-burst 1.5s ease-out forwards; }
  .cp-ray { position:absolute; left:0; top:0; width:3px; height:min(70vh,520px); transform-origin:50% 0;
    background:linear-gradient(180deg, color-mix(in srgb, var(--cp-accent,#fff) 85%, transparent), transparent 68%); }
  @keyframes cp-rays-burst { 0%{opacity:0; transform:scale(.25) rotate(0)} 22%{opacity:.9} 100%{opacity:.22; transform:scale(1) rotate(26deg)} }

  /* Screen flash on the flip — opacity comes from the rarity row, so a Common's
     is literally zero rather than "very small". */
  .cp-flash { position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; z-index:20; }
  .cp-flash.on { animation:cp-flash-hit .5s ease-out forwards; }
  @keyframes cp-flash-hit { 0%{opacity:var(--cp-flash,0)} 100%{opacity:0} }

  .cp-stage.shake { animation:cp-stage-shake .42s cubic-bezier(.36,.07,.19,.97); }
  @keyframes cp-stage-shake { 10%,90%{transform:translateX(calc(-2px * var(--cp-shake,0)))}
    20%,80%{transform:translateX(calc(4px * var(--cp-shake,0)))}
    30%,50%,70%{transform:translateX(calc(-7px * var(--cp-shake,0)))}
    40%,60%{transform:translateX(calc(7px * var(--cp-shake,0)))} }

  /* Sparkle motes on a big pull. */
  .cp-mote { position:absolute; width:4px; height:4px; border-radius:50%; pointer-events:none; z-index:6;
    background:var(--cp-accent,#fff); box-shadow:0 0 10px var(--cp-accent,#fff);
    animation:cp-mote-rise var(--d,1.4s) ease-out forwards; }
  @keyframes cp-mote-rise { 0%{opacity:0; transform:translate(0,0) scale(.4)} 15%{opacity:1}
    100%{opacity:0; transform:translate(var(--tx),var(--ty)) scale(1.1)} }

  /* ── progress pips + footer ───────────────────────────────────────────── */
  .cp-pips { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); display:flex; gap:7px; }
  .cp-pip { width:22px; height:3px; border-radius:2px; background:rgba(255,255,255,0.16); transition:background .3s, box-shadow .3s; }
  .cp-pip.done { background:var(--pipc,#8b98a8); box-shadow:0 0 8px var(--pipc,#8b98a8); }
  .cp-skip { position:absolute; top:16px; right:20px; font-size:10px; letter-spacing:2px; color:#5d6d7d;
    cursor:pointer; padding:6px 10px; border:1px solid rgba(255,255,255,0.12); border-radius:3px; }
  .cp-skip:hover { color:#c8d8e8; border-color:rgba(255,255,255,0.3); }

  /* ── the summary ──────────────────────────────────────────────────────── */
  .cp-summary { display:flex; flex-direction:column; align-items:center; gap:14px; width:100%; max-height:100%; }
  .cp-sum-head { font-size:13px; letter-spacing:5px; color:#c8d8e8; }
  .cp-sum-grid { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; overflow-y:auto; padding:4px; }
  .cp-sum-card { width:118px; border-radius:7px; padding:8px; cursor:default;
    background:linear-gradient(170deg,#0c141c,#141d28);
    border:1px solid color-mix(in srgb, var(--c,#8b98a8) 60%, transparent);
    box-shadow:0 0 16px color-mix(in srgb, var(--c,#8b98a8) 22%, transparent); }
  .cp-sum-rank { font-size:8px; letter-spacing:2px; color:var(--c,#8b98a8); }
  .cp-sum-name { font-size:11px; color:#dfe9f2; margin-top:4px; word-break:break-word; }
  .cp-sum-type { font-size:9px; color:#63737f; margin-top:2px; }
  .cp-sum-dupe { font-size:8px; color:#c07b3a; margin-top:4px; letter-spacing:1px; }
  .cp-sum-note { font-size:11px; color:#8b98a8; }
  .cp-btns { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
  .cp-btn { font-family:inherit; font-size:11px; letter-spacing:2px; padding:9px 18px; cursor:pointer; border-radius:4px;
    background:linear-gradient(180deg,#16222e,#0c1219); color:#a9c4d8; border:1px solid rgba(120,190,240,0.35); }
  .cp-btn:hover { color:#eaf6ff; border-color:rgba(160,225,255,0.8); box-shadow:0 0 16px rgba(90,180,240,0.32); }
  .cp-btn.primary { color:#04121a; background:linear-gradient(180deg,#7fe8ff,#37a8d8); border-color:#9ff0ff; font-weight:700; }
  .cp-btn:disabled { opacity:.4; cursor:not-allowed; box-shadow:none; }

  /* ── the machine terminal ─────────────────────────────────────────────── */
  #cardmach-overlay { position:fixed; inset:0; z-index:9100; display:flex; align-items:center; justify-content:center;
    background:rgba(3,6,10,0.78); backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
    font-family:'Courier New', monospace; }
  #cardmach-overlay .cm-box { --mg-accent:#7fe8ff; --mg-base:#0d151d; width:min(94vw,470px); padding:0 0 14px;
    background:linear-gradient(180deg,#182633,#0d151d 42%,#080d13); }
  #cardmach-overlay .mg-bezel { margin:12px; }
  .cm-screen { position:relative; min-height:170px; padding:14px 16px; overflow:hidden;
    background:radial-gradient(ellipse at 50% 0%, #0b2530, #04101a 75%); color:#7fe8ff; font-size:12px; line-height:1.6; }
  .cm-slots { display:flex; gap:8px; margin-bottom:12px; }
  .cm-slot { flex:1; text-align:center; padding:10px 4px; border:1px solid rgba(127,232,255,0.3); border-radius:4px;
    background:linear-gradient(180deg, rgba(127,232,255,0.09), transparent); }
  .cm-slot.sold { opacity:.32; border-style:dashed; }
  .cm-slot-id { font-size:9px; letter-spacing:2px; color:rgba(127,232,255,0.65); }
  .cm-slot-art { font-size:22px; margin:3px 0; }
  .cm-slot-price { font-size:11px; color:#fff; }
  .cm-odds { display:flex; gap:4px; margin:10px 0 4px; align-items:flex-end; height:34px; }
  .cm-odd { flex:1; text-align:center; }
  .cm-odd-bar { height:22px; display:flex; align-items:flex-end; justify-content:center; }
  .cm-odd-bar i { display:block; width:70%; border-radius:1px 1px 0 0; background:var(--c,#8b98a8);
    box-shadow:0 0 8px var(--c,#8b98a8); }
  .cm-odd-lbl { font-size:8px; letter-spacing:1px; color:#5d7d8d; margin-top:3px; }
  .cm-rows { border-top:1px solid rgba(127,232,255,0.2); margin-top:8px; padding-top:8px; }
  .cm-row { display:flex; justify-content:space-between; }
  .cm-row b { color:#fff; }
  .cm-deck { display:flex; gap:9px; padding:0 16px; }
  .cm-deck .cp-btn { flex:1; }
  .cm-tray { margin:10px 16px 0; height:26px; border-radius:3px;
    background:linear-gradient(180deg,#05080c,#0d141b); box-shadow:inset 0 3px 9px rgba(0,0,0,0.9);
    display:flex; align-items:center; justify-content:center; font-size:9px; letter-spacing:3px; color:#3d4d5d; }
  .cm-tray.loaded { color:#7fe8ff; text-shadow:0 0 10px rgba(127,232,255,0.7); animation:cp-blink 1.6s ease-in-out infinite; }
  .cm-dead { color:#5d6d7d; text-align:center; padding:34px 10px; letter-spacing:2px; }

  @media (prefers-reduced-motion: reduce) {
    #cardpack-overlay *, #cardmach-overlay * { animation-duration:.01ms !important; animation-iteration-count:1 !important;
      transition-duration:.01ms !important; }
  }
  `;
  document.head.appendChild(s);
}

// ── the machine ───────────────────────────────────────────────────────────────
let machine = null;   // { overlay, close, data }

export function openCardMachinePanel(msg) {
  ensureChassisStyles();
  ensurePackStyles();
  if (machine) machine.close();

  const mounted = mountOverlay({
    id: 'cardmach-overlay',
    html: `<div class="mg-chassis cm-box">
      ${deviceHeader('◈', 'COLDWATER MINT', esc(String(msg.machine || 'CARD DISPENSER')).toUpperCase())}
      <div class="mg-bezel">${bezelScrews()}<div class="mg-screen cm-screen" id="cm-screen"></div>${crtOverlays()}</div>
      <div class="cm-tray" id="cm-tray">EMPTY TRAY</div>
      <div class="cm-deck" style="margin-top:12px">
        <button class="cp-btn primary" id="cm-buy">BUY SLEEVE</button>
        <button class="cp-btn" id="cm-open">TEAR ONE OPEN</button>
      </div>
    </div>`,
    onClose: () => { machine = null; },
  });
  machine = { ...mounted, data: msg };
  mounted.overlay.querySelector('.mg-close').addEventListener('click', () => mounted.close());
  mounted.overlay.querySelector('#cm-buy').addEventListener('click', () => {
    // The button sends the ordinary verb. Nothing here transacts — the server
    // re-checks power, price and balance, exactly as it would for a typed command.
    sendCmdSilent('buypack confirm');
  });
  mounted.overlay.querySelector('#cm-open').addEventListener('click', () => {
    mounted.close();
    sendCmdSilent('openpack');
  });
  renderMachine();
  sfx('cards-slide');
}

// Live patch after a vend — the panel stays open so you can buy a second sleeve
// without walking away and back.
export function updateCardMachine(patch) {
  if (!machine) return;
  Object.assign(machine.data, patch);
  renderMachine();
}

export function closeCardMachine() { machine?.close(); }
export function isCardMachineOpen() { return !!machine; }

function renderMachine() {
  if (!machine) return;
  const d = machine.data;
  const screen = machine.overlay.querySelector('#cm-screen');
  const total = d.pool?.total || 0;

  if (!total) {
    screen.innerHTML = `<div class="cm-dead">— NO STOCK —<br><br>Nobody has minted anything yet.<br>The racks behind the glass are empty.</div>`;
  } else {
    const by = d.pool?.byRank || {};
    const ranks = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    // The odds board is drawn from the LIVE pool, so a rank nobody has minted
    // shows as a flat nub rather than an advertised chance that cannot pay out.
    const max = Math.max(1, ...ranks.map(r => by[r] || 0));
    screen.innerHTML =
      `<div class="cm-slots">` +
        [1, 2, 3].map(n => `<div class="cm-slot${n === 3 ? ' sold' : ''}">` +
          `<div class="cm-slot-id">A${n}</div><div class="cm-slot-art">▤</div>` +
          `<div class="cm-slot-price">${n === 3 ? 'SOLD OUT' : '₵' + d.price}</div></div>`).join('') +
      `</div>` +
      `<div style="font-size:9px;letter-spacing:2px;color:#5d7d8d">IN THE POOL — ${total} CARD${total === 1 ? '' : 'S'}</div>` +
      `<div class="cm-odds">` + ranks.map(r => {
        const n = by[r] || 0;
        const h = n ? Math.max(3, Math.round((n / max) * 22)) : 2;
        return `<div class="cm-odd" style="--c:${rarity(r).color}">` +
          `<div class="cm-odd-bar"><i style="height:${h}px"></i></div>` +
          `<div class="cm-odd-lbl">${rarity(r).label.slice(0, 4)}</div></div>`;
      }).join('') + `</div>` +
      `<div class="cm-rows">` +
        `<div class="cm-row"><span>ON YOU</span><b>₵${(d.credits ?? 0).toLocaleString()}</b></div>` +
        `<div class="cm-row"><span>SLEEVE</span><b>₵${d.price}</b></div>` +
        `<div class="cm-row"><span>DUPLICATE BUY-BACK</span><b>₵${d.scrapValue}</b></div>` +
      `</div>`;
  }

  const packs = d.packs || 0;
  const tray = machine.overlay.querySelector('#cm-tray');
  tray.classList.toggle('loaded', packs > 0);
  tray.textContent = packs ? `${packs} UNOPENED SLEEVE${packs === 1 ? '' : 'S'} ON YOU` : 'EMPTY TRAY';
  machine.overlay.querySelector('#cm-open').disabled = packs < 1;
  machine.overlay.querySelector('#cm-buy').disabled = !total || (d.credits ?? 0) < d.price;
}

// The vend response: play the hardware, patch the panel, and let the log line
// through. The offer to open it NOW is the tray button lighting up — you are
// already standing at the machine, so a second modal on top would be noise.
export function cardMachineVend(msg) {
  sfx('cards-vend');
  if (machine) updateCardMachine({ credits: msg.credits, packs: msg.packs });
  refreshInventory();
}

// ── the reveal ────────────────────────────────────────────────────────────────
let show = null;

export function isPackRevealOpen() { return !!show; }

export function openPackReveal(msg) {
  ensurePackStyles();
  if (show) show.close();
  const cards = Array.isArray(msg.cards) ? msg.cards : [];
  if (!cards.length) return;
  closeCardMachine();

  const mounted = mountOverlay({
    id: 'cardpack-overlay',
    closeOnBackdrop: false,     // a stray click mid-reveal must not eat the show
    // Space and Enter mirror the click; Escape closes, via mountOverlay itself.
    onKey: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); } },
    html: `<div class="cp-stage" id="cp-stage">
        <div class="cp-ambient" id="cp-ambient"></div>
        <div class="cp-flash" id="cp-flash"></div>
        <div id="cp-slot"></div>
        <div class="cp-pips" id="cp-pips"></div>
      </div>
      <div class="cp-skip" id="cp-skip">SKIP ▸</div>`,
    onClose: () => { clearTimers(); show = null; },
  });

  show = {
    ...mounted, cards, idx: -1, phase: 'sealed', timers: [],
    scrapped: msg.scrapped || 0, scrapValue: msg.scrapValue || 0, packs: msg.packs || 0,
  };

  mounted.overlay.querySelector('#cp-skip').addEventListener('click', (e) => { e.stopPropagation(); toSummary(); });
  // Anywhere on the stage advances. One affordance, always the same one.
  mounted.overlay.addEventListener('click', () => advance());
  renderPips();
  renderSealed();
  refreshInventory();
}

function clearTimers() { if (show) { show.timers.forEach(clearTimeout); show.timers = []; } }
function later(fn, ms) { if (show) show.timers.push(setTimeout(fn, ms)); }

function advance() {
  if (!show) return;
  if (show.phase === 'sealed') { tear(); return; }
  if (show.phase === 'revealing') { clearTimers(); nextCard(); return; }
  if (show.phase === 'dealt') { clearTimers(); nextCard(); return; }
}

function renderPips() {
  const pips = show.overlay.querySelector('#cp-pips');
  pips.innerHTML = show.cards.map(() => `<span class="cp-pip"></span>`).join('');
}

function renderSealed() {
  const slot = show.overlay.querySelector('#cp-slot');
  slot.innerHTML = `<div class="cp-pack" id="cp-pack">
      <div class="cp-pack-body"></div>
      <div class="cp-pack-top"></div>
      <div class="cp-pack-seam"></div>
      <div class="cp-pack-print">
        <div class="cp-pack-mark">◈</div>
        <div class="cp-pack-brand">COLDWATER</div>
        <div class="cp-pack-sub">MINT · SERIES 1</div>
        <div class="cp-pack-count">FOIL SLEEVE</div>
      </div>
      <div class="cp-pack-hint">CLICK TO TEAR</div>
    </div>`;
}

function tear() {
  if (!show || show.phase !== 'sealed') return;
  show.phase = 'tearing';
  const pack = show.overlay.querySelector('#cp-pack');
  const hint = show.overlay.querySelector('.cp-pack-hint');
  if (hint) hint.remove();
  pack.classList.add('tearing');
  sfx('cards-tear');
  later(() => {
    pack.classList.add('torn');
    throwFlecks(pack);
  }, 320);
  later(() => { show.phase = 'revealing'; nextCard(); }, 1000);
}

// Foil comes off in bits. Positions and vectors are random per tear so two
// openings never look identical — the cards are the only thing that repeats.
function throwFlecks(host) {
  for (let i = 0; i < 16; i++) {
    const f = document.createElement('span');
    f.className = 'cp-fleck';
    f.style.left = `${18 + Math.random() * 64}%`;
    f.style.top = `${4 + Math.random() * 22}%`;
    f.style.setProperty('--tx', `${(Math.random() - 0.5) * 340}px`);
    f.style.setProperty('--ty', `${-90 - Math.random() * 230}px`);
    f.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
    f.style.setProperty('--d', `${0.7 + Math.random() * 0.7}s`);
    host.appendChild(f);
  }
}

function nextCard() {
  if (!show) return;
  show.idx++;
  if (show.idx >= show.cards.length) { toSummary(); return; }

  const card = show.cards[show.idx];
  const R = rarity(card.rarity);
  const stage = show.overlay.querySelector('#cp-stage');
  const slot = show.overlay.querySelector('#cp-slot');
  const ambient = show.overlay.querySelector('#cp-ambient');
  show.phase = 'dealt';

  stage.style.setProperty('--cp-accent', R.color);
  stage.style.setProperty('--cp-glow', String(R.glow));
  stage.style.setProperty('--cp-flash', String(R.flash));
  stage.style.setProperty('--cp-shake', String(R.shake));

  slot.innerHTML = `<div class="cp-card-wrap">
      <div class="cp-rays" id="cp-rays">${Array.from({ length: R.rays }, (_, i) =>
        `<span class="cp-ray" style="transform:rotate(${(360 / Math.max(1, R.rays)) * i}deg) translateX(-50%)"></span>`).join('')}</div>
      <div class="cp-card" id="cp-card">
        <div class="cp-card-side cp-back"><span class="cp-back-mark">◈</span></div>
        <div class="cp-card-side cp-front">${card.face || `<span class="card-face">${esc(card.name)}</span>`}</div>
      </div>
      ${card.subject_type === 'player' ? `<div class="cp-player-banner">PLAYER CARD</div>` : ''}
      <div class="cp-rank">${R.label}</div>
      <div class="cp-sub">${esc(card.name)} · ${esc(card.subject_type)}${card.dupe ? ` · <span class="cp-dupe-tag">DUPLICATE, ₵${show.scrapValue}</span>` : ''}</div>
    </div>`;

  const el = slot.querySelector('#cp-card');
  sfx('cards-slide');
  requestAnimationFrame(() => el.classList.add('in'));

  // The hold. A Common barely has one; a Legendary sits on the riser for the
  // better part of half a second before it turns.
  later(() => {
    if (!show) return;
    show.phase = 'revealing';
    el.classList.add('flipped');
    sfx(R.sfx);
    if (card.dupe) later(() => sfx('cards-dupe'), 340);
    if (card.subject_type === 'player') later(() => sfx('cards-player-sting'), 120);

    ambient.style.opacity = String(0.06 + R.glow * 0.2);
    show.overlay.querySelector('#cp-flash').classList.add('on');
    later(() => show?.overlay.querySelector('#cp-flash')?.classList.remove('on'), 520);

    if (isBig(card.rarity)) {
      slot.querySelector('#cp-rays')?.classList.add('on');
      if (R.shake) { stage.classList.add('shake'); later(() => stage.classList.remove('shake'), 460); }
      throwMotes(slot.querySelector('.cp-card-wrap'), Math.round(R.rays * 0.8));
    }

    const pip = show.overlay.querySelectorAll('.cp-pip')[show.idx];
    if (pip) { pip.style.setProperty('--pipc', R.color); pip.classList.add('done'); }

    // Auto-advance after the dwell. Clicking early skips ahead; nothing waits on
    // input, so a player can watch the whole sleeve without touching anything.
    later(() => nextCard(), R.dwell);
  }, R.hold);
}

function throwMotes(host, n) {
  if (!host) return;
  for (let i = 0; i < n; i++) {
    const m = document.createElement('span');
    m.className = 'cp-mote';
    m.style.left = `${Math.random() * 100}%`;
    m.style.top = `${55 + Math.random() * 45}%`;
    m.style.setProperty('--tx', `${(Math.random() - 0.5) * 180}px`);
    m.style.setProperty('--ty', `${-120 - Math.random() * 200}px`);
    m.style.setProperty('--d', `${1 + Math.random() * 0.9}s`);
    host.appendChild(m);
    setTimeout(() => m.remove(), 2200);
  }
}

function toSummary() {
  if (!show) return;
  clearTimers();
  show.phase = 'done';
  sfx('cards-stack');
  const skip = show.overlay.querySelector('#cp-skip');
  if (skip) skip.remove();

  const best = show.cards.reduce((a, c) =>
    Object.keys(RARITY).indexOf(c.rarity) > Object.keys(RARITY).indexOf(a.rarity) ? c : a, show.cards[0]);

  show.overlay.querySelector('#cp-slot').innerHTML = `<div class="cp-summary">
      <div class="cp-sum-head" style="color:${rarity(best.rarity).color}">${show.cards.length} CARDS · BEST PULL ${rarity(best.rarity).label}</div>
      <div class="cp-sum-grid">${show.cards.map(c => {
        const R = rarity(c.rarity);
        return `<div class="cp-sum-card" style="--c:${R.color}">
          <div class="cp-sum-rank">${R.label}</div>
          <div class="cp-sum-name">${esc(c.name)}</div>
          <div class="cp-sum-type">${esc(c.subject_type)}</div>
          ${c.dupe ? `<div class="cp-sum-dupe">DUPLICATE</div>` : ''}
        </div>`;
      }).join('')}</div>
      ${show.scrapped ? `<div class="cp-sum-note">Duplicates in there — <b style="color:#c07b3a">₵${show.scrapped}</b> if you scrap them at a mint.</div>` : ''}
      <div class="cp-btns">
        <button class="cp-btn" id="cp-shelf">SEE THE SHELF</button>
        ${show.packs > 0 ? `<button class="cp-btn primary" id="cp-again">TEAR ANOTHER (${show.packs})</button>` : ''}
        <button class="cp-btn" id="cp-done">DONE</button>
      </div>
    </div>`;

  const wire = (id, fn) => show.overlay.querySelector(id)?.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  wire('#cp-done', () => show.close());
  wire('#cp-shelf', () => { show.close(); sendCmd('cards'); });
  wire('#cp-again', () => { show.close(); sendCmdSilent('openpack'); });
}
